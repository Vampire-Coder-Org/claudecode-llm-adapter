// HTTP integration seam tests for --serve MVP (Issue #5).
//
// Strategy: start a local mock HTTP server that returns scripted Anthropic SSE
// responses, configure the Anthropic provider to point at the mock, start the
// proxy server, make real HTTP requests, assert on response format and content.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startServer } from "../serve/server.ts"
import { setActiveModel } from "../serve/active-model.ts"
import * as Anthropic from "../llm/providers/anthropic.ts"
import type { ServerHandle } from "../serve/server.ts"

// ── Anthropic SSE fixture ─────────────────────────────────────────────────────

const ANTHROPIC_SSE_RESPONSE =
  `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-haiku-3-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n` +
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
  `event: ping\ndata: {"type":"ping"}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}\n\n` +
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`

// ── Mock upstream server ──────────────────────────────────────────────────────

let mockServer: ReturnType<typeof Bun.serve>
let mockPort: number
let proxyServer: ServerHandle
let proxyPort: number

beforeAll(async () => {
  // Start mock Anthropic upstream
  mockServer = Bun.serve({
    port: 0, // random free port
    fetch() {
      return new Response(ANTHROPIC_SSE_RESPONSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
  mockPort = mockServer.port ?? 0

  // Configure Anthropic provider pointing at the mock upstream
  const provider = Anthropic.configure({
    apiKey: "test-key",
    baseURL: `http://localhost:${mockPort}`,
  })
  const model = provider.model("claude-haiku-3-5")

  setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model })

  // Start the proxy
  proxyServer = startServer(0)
  proxyPort = proxyServer.port
})

afterAll(() => {
  proxyServer.stop()
  mockServer.stop()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HTTP integration — POST /v1/messages", () => {
  test("returns 200 with text/event-stream content-type", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "ignored-model-field",
        messages: [{ role: "user", content: "Say hello" }],
        max_tokens: 100,
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("model field in request body is ignored — active model is always used", async () => {
    // We send a fake model name; the proxy must use the pre-selected model
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
    // The mock upstream always returns "Hello!" so the SSE must contain it
    expect(body).toContain("Hello!")
    expect(body).toContain("message_start")
    expect(body).toContain("message_stop")
  })

  test("response contains valid Anthropic SSE event sequence", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 50,
      }),
    })

    const body = await res.text()

    // Required SSE event types in order
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
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 50,
        }),
      }).then((r) => r.text())

    const [res1, res2] = await Promise.all([request(), request()])
    expect(res1).toContain("message_stop")
    expect(res2).toContain("message_stop")
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

describe("HTTP integration — GET /v1/models", () => {
  test("returns the active model in OpenAI list format", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/models`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { object: string; data: Array<{ id: string; owned_by: string }> }
    expect(body.object).toBe("list")
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe("claude-haiku-3-5")
    expect(body.data[0]?.owned_by).toBe("anthropic")
  })
})

describe("HTTP integration — unknown routes", () => {
  test("unknown path returns 404", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/unknown`)
    expect(res.status).toBe(404)
  })
})
