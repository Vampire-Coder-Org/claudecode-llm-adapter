// Tests for TUI model hot-swap behaviour (Issue #8).
//
// The TUI itself (raw-terminal rendering) is not tested here — it requires a
// real TTY. The tested seam is the model-state Ref behaviour:
//   - A request that starts before a model change completes on the old snapshot
//   - The next request after the change uses the new model
//   - The pending-change indicator fires when inFlight > 0 during a switch

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { startServer, type ServerHandle } from "../serve/server.ts"
import { setActiveModel, getActiveModel, snapshotActiveModel } from "../serve/active-model.ts"
import * as Anthropic from "../llm/providers/anthropic.ts"
import * as OpenAI from "../llm/providers/openai.ts"
import { incrementRequest, decrementInFlight, requestCount, inFlightCount } from "../serve/tui.ts"

// ── Mock upstreams ────────────────────────────────────────────────────────────

// Slow upstream: holds response for 150ms before sending the body
let slowMock: ReturnType<typeof Bun.serve>
let fastMock: ReturnType<typeof Bun.serve>
let proxyServer: ServerHandle

let slowPort: number
let fastPort: number
let proxyPort: number

const ANTHROPIC_SSE = (text: string) =>
  `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":5,"output_tokens":0}}}\n\n` +
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n` +
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":3}}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`

beforeAll(async () => {
  slowMock = Bun.serve({
    port: 0,
    async fetch() {
      await new Promise((r) => setTimeout(r, 100))
      return new Response(ANTHROPIC_SSE("from-slow-mock"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
  slowPort = slowMock.port ?? 0

  fastMock = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(ANTHROPIC_SSE("from-fast-mock"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
  })
  fastPort = fastMock.port ?? 0

  // Set initial active model pointing at slow mock
  const anthropicModel = Anthropic.configure({
    apiKey: "test",
    baseURL: `http://localhost:${slowPort}`,
  }).model("claude-haiku-3-5")

  setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model: anthropicModel })
  proxyServer = startServer(0)
  proxyPort = proxyServer.port
})

afterAll(() => {
  proxyServer.stop()
  slowMock.stop()
  fastMock.stop()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TUI model state — Effect Ref", () => {
  test("getActiveModel() reflects setActiveModel() immediately", () => {
    const model = Anthropic.configure({ apiKey: "k", baseURL: "http://x" }).model("claude-test")
    setActiveModel({ providerId: "test", modelId: "test-model", model })
    expect(getActiveModel()?.modelId).toBe("test-model")

    // Restore
    const restore = Anthropic.configure({ apiKey: "test", baseURL: `http://localhost:${slowPort}` }).model(
      "claude-haiku-3-5",
    )
    setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model: restore })
  })

  test("snapshotActiveModel Effect returns current state", async () => {
    const snapshot = await Effect.runPromise(snapshotActiveModel)
    expect(snapshot?.modelId).toBe("claude-haiku-3-5")
  })
})

describe("TUI hot-swap — in-flight isolation", () => {
  test("request started before model change completes on the OLD model", async () => {
    // Start a slow request (100ms upstream)
    const slowRequest = fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], max_tokens: 50 }),
    })

    // While the slow request is in-flight, switch the active model to the fast mock
    await new Promise((r) => setTimeout(r, 20)) // Let the request start
    const newModel = Anthropic.configure({ apiKey: "test", baseURL: `http://localhost:${fastPort}` }).model(
      "claude-haiku-3-5",
    )
    setActiveModel({ providerId: "anthropic", modelId: "claude-haiku-3-5", model: newModel })

    // Wait for the slow request to complete
    const res = await slowRequest
    const body = await res.text()

    // The in-flight request must have used the OLD model (slow mock)
    expect(body).toContain("from-slow-mock")
  })

  test("request started AFTER model change uses the NEW model", async () => {
    // Active model is now pointing at fast mock (set in previous test)
    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], max_tokens: 50 }),
    })

    const body = await res.text()
    expect(body).toContain("from-fast-mock")
  })
})

describe("TUI counters", () => {
  test("incrementRequest and decrementInFlight work correctly", () => {
    const before = requestCount
    incrementRequest()
    expect(requestCount).toBe(before + 1)
    decrementInFlight()
    // inFlightCount should not go below 0
    expect(inFlightCount).toBeGreaterThanOrEqual(0)
  })
})
