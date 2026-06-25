// HTTP integration seam tests for Issues #5, #6, #7.
//
// Strategy: start a local mock HTTP server that returns scripted SSE
// responses, configure the provider to point at the mock, start the
// proxy server, make real HTTP requests, assert on response format and content.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startServer } from "../serve/server.ts"
import { setActiveModel } from "../serve/active-model.ts"
import * as Anthropic from "../llm/providers/anthropic.ts"
import * as OpenAI from "../llm/providers/openai.ts"
import type { ServerHandle } from "../serve/server.ts"

// ── Anthropic SSE fixture ─────────────────────────────────────────────────────

const ANTHROPIC_SSE =
  `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-haiku-3-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n` +
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
  `event: ping\ndata: {"type":"ping"}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}\n\n` +
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`

// OpenAI SSE fixture (what the upstream returns when routing through OpenAI provider)
const OPENAI_SSE =
  `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n` +
  `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi there!"},"finish_reason":null}]}\n\n` +
  `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n` +
  `data: [DONE]\n\n`

// ── Mock upstream and proxy servers ──────────────────────────────────────────

let anthropicMock: ReturnType<typeof Bun.serve>
let openaiMock: ReturnType<typeof Bun.serve>
let proxyServer: ServerHandle

let anthropicMockPort: number
let openaiMockPort: number
let proxyPort: number

beforeAll(async () => {
  // Mock Anthropic upstream
  anthropicMock = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(ANTHROPIC_SSE, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
  })
  anthropicMockPort = anthropicMock.port ?? 0

  // Mock OpenAI upstream
  openaiMock = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(OPENAI_SSE, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
  })
  openaiMockPort = openaiMock.port ?? 0

  // Start proxy pointing at Anthropic mock (default active model)
  const model = Anthropic.configure({
    apiKey: "test-key",
    baseURL: `http://localhost:${anthropicMockPort}`,
  }).model("claude-haiku-3-5")

  setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model })
  proxyServer = startServer(0)
  proxyPort = proxyServer.port
})

afterAll(() => {
  proxyServer.stop()
  anthropicMock.stop()
  openaiMock.stop()
})

// ── POST /v1/messages (Anthropic endpoint) ────────────────────────────────────

describe("POST /v1/messages — Anthropic endpoint", () => {
  test("returns 200 with text/event-stream content-type", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Say hello" }], max_tokens: 100 }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("model field in request body is ignored — active model always used", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-99-should-be-ignored",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 50,
      }),
    })

    const body = await res.text()
    expect(body).toContain("Hello!")
    expect(body).toContain("message_start")
    expect(body).toContain("message_stop")
  })

  test("response contains valid Anthropic SSE event sequence", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }], max_tokens: 50 }),
    })

    const body = await res.text()
    const events = body
      .split("\n")
      .filter((l) => l.startsWith("event:"))
      .map((l) => l.replace("event: ", "").trim())

    expect(events).toContain("message_start")
    expect(events).toContain("content_block_start")
    expect(events).toContain("content_block_stop")
    expect(events).toContain("message_stop")
  })

  test("two concurrent requests both complete successfully", async () => {
    const request = () =>
      fetch(`http://localhost:${proxyPort}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], max_tokens: 50 }),
      }).then((r) => r.text())

    const [r1, r2] = await Promise.all([request(), request()])
    expect(r1).toContain("message_stop")
    expect(r2).toContain("message_stop")
  })

  test("invalid JSON body returns 400", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    })
    expect(res.status).toBe(400)
  })
})

// ── Multi-provider routing (#6) — active model switch ────────────────────────

describe("Multi-provider routing — non-Anthropic provider via /v1/messages", () => {
  test("routing to OpenAI provider: Anthropic-format caller gets Anthropic SSE response", async () => {
    // Switch active model to OpenAI chat (pointing at the OpenAI mock)
    // Use .chat() to match the Chat Completions SSE format returned by the mock
    const openAIModel = OpenAI.configure({
      apiKey: "oai-test-key",
      baseURL: `http://localhost:${openaiMockPort}`,
    }).chat("gpt-4o")

    setActiveModel({ providerId: "openai", modelId: "gpt-4o", model: openAIModel })

    try {
      const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-should-be-ignored",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 50,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.text()

      // Caller gets Anthropic SSE format back even though upstream is OpenAI
      expect(body).toContain("message_start")
      expect(body).toContain("message_stop")
      // Text from the OpenAI mock response
      expect(body).toContain("Hi there!")
    } finally {
      // Restore Anthropic active model for subsequent tests
      const anthropicModel = Anthropic.configure({
        apiKey: "test-key",
        baseURL: `http://localhost:${anthropicMockPort}`,
      }).model("claude-haiku-3-5")
      setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model: anthropicModel })
    }
  })
})

// ── POST /v1/chat/completions (OpenAI endpoint, #7) ──────────────────────────

describe("POST /v1/chat/completions — OpenAI endpoint", () => {
  test("returns 200 with text/event-stream content-type", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 50,
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("model field is ignored — active model always used", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-99-should-be-ignored",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 50,
      }),
    })

    const body = await res.text()
    // Proxy uses active model (Anthropic) — response comes back as OpenAI SSE format
    expect(body).toContain("chat.completion.chunk")
    expect(body).toContain("[DONE]")
  })

  test("response contains OpenAI SSE chat.completion.chunk events", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }], max_tokens: 50 }),
    })

    const body = await res.text()
    const lines = body.split("\n").filter((l) => l.startsWith("data:") && l !== "data: [DONE]")
    const chunks = lines.map((l) => JSON.parse(l.replace("data: ", "")))

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]?.object).toBe("chat.completion.chunk")
    expect(body).toContain("[DONE]")
  })

  test("invalid JSON body returns 400", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad-json",
    })
    expect(res.status).toBe(400)
  })
})

// ── GET /v1/models ────────────────────────────────────────────────────────────

describe("GET /v1/models", () => {
  test("returns the active model in OpenAI list format", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/models`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { object: string; data: Array<{ id: string; owned_by: string }> }
    expect(body.object).toBe("list")
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe("claude-haiku-3-5")
  })
})

// ── Misc ──────────────────────────────────────────────────────────────────────

describe("HTTP misc", () => {
  test("unknown path returns 404", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/unknown`)
    expect(res.status).toBe(404)
  })
})
