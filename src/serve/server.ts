// HTTP server — exposes the OpenAI-compatible and Anthropic-compatible
// REST endpoints. Bun's native HTTP server handles concurrency.
//
// Endpoints:
//   POST /v1/messages          — Anthropic Messages API
//   POST /v1/chat/completions  — OpenAI Chat Completions
//   GET  /v1/models            — Returns the active model (OpenAI format)

import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLMClient } from "../llm/route/client.ts"
import { RequestExecutor } from "../llm/route/executor.ts"
import { getActiveModel } from "./active-model.ts"
import { translateRequest, type AnthropicRequestBody } from "./translate-request.ts"
import {
  makeTranslationState,
  messageStartEvent,
  translateEvent,
} from "./translate-response.ts"
import {
  translateOpenAIRequest,
  makeOpenAITranslationState,
  openAIStartEvent,
  translateOpenAIEvent,
  type OpenAIRequestBody,
} from "./translate-openai.ts"
import { log } from "../logger.ts"

// ── Layer shared across all requests ─────────────────────────────────────────

const llmLayer = LLMClient.layer.pipe(
  Layer.provide(RequestExecutor.layer),
  Layer.provide(FetchHttpClient.layer),
)

// ── Streaming helper ──────────────────────────────────────────────────────────

function streamLLM(
  req: Request,
  llmRequest: ReturnType<typeof translateRequest>,
  firstChunk: string,
  toChunk: (event: import("../llm/schema/index.ts").LLMEvent) => string,
  active: { providerId: string; modelId: string },
): Response {
  const encoder = new TextEncoder()
  const startMs = Date.now()

  log.request(req, active.providerId, active.modelId)

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(firstChunk))

      const stream = LLMClient.stream(llmRequest).pipe(
        Stream.map((event) => toChunk(event)),
        Stream.filter((chunk) => chunk.length > 0),
        Stream.tap((chunk) => Effect.sync(() => controller.enqueue(encoder.encode(chunk)))),
        Stream.runDrain,
        Effect.provide(llmLayer),
      )

      Effect.runPromise(stream as Effect.Effect<void, never, never>)
        .catch((err) => {
          log.streamError(err)
          const errChunk = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: String(err) } })}\n\n`
          try { controller.enqueue(encoder.encode(errChunk)) } catch {}
        })
        .finally(() => {
          log.response(req, Date.now() - startMs, 200)
          try { controller.close() } catch {}
        })
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

// ── Request handlers ──────────────────────────────────────────────────────────

async function handleMessages(req: Request): Promise<Response> {
  const active = getActiveModel()
  if (!active) {
    log.warn("POST /v1/messages: no active model")
    return new Response(JSON.stringify({ error: "No active model" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: AnthropicRequestBody
  try {
    body = (await req.json()) as AnthropicRequestBody
  } catch (err) {
    log.warn("POST /v1/messages: invalid JSON", { error: String(err) })
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Ignore body.model — always use the pre-selected model
  const llmRequest = translateRequest(body, active.model)
  const state = makeTranslationState(active.modelId)
  return streamLLM(req, llmRequest, messageStartEvent(state), (event) => translateEvent(event, state), active)
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const active = getActiveModel()
  if (!active) {
    log.warn("POST /v1/chat/completions: no active model")
    return new Response(JSON.stringify({ error: "No active model" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: OpenAIRequestBody
  try {
    body = (await req.json()) as OpenAIRequestBody
  } catch (err) {
    log.warn("POST /v1/chat/completions: invalid JSON", { error: String(err) })
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Ignore body.model — always use the pre-selected model
  const llmRequest = translateOpenAIRequest(body, active.model)
  const state = makeOpenAITranslationState(active.modelId)
  return streamLLM(req, llmRequest, openAIStartEvent(state), (event) => translateOpenAIEvent(event, state), active)
}

function handleModels(): Response {
  const active = getActiveModel()
  const models = active
    ? [{ id: active.modelId, object: "model", created: Math.floor(Date.now() / 1000), owned_by: active.providerId }]
    : []

  return new Response(JSON.stringify({ object: "list", data: models }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

// ── Server ────────────────────────────────────────────────────────────────────

export interface ServerHandle {
  readonly port: number
  readonly stop: () => void
}

export function startServer(port: number): ServerHandle {
  const server = Bun.serve({
    port,
    // Disable idle timeout — SSE streaming responses can be long-lived.
    // Bun's default 10s idle timeout kills connections mid-stream.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
          },
        })
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") return handleMessages(req)
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") return handleChatCompletions(req)
      if (req.method === "GET" && url.pathname === "/v1/models") return handleModels()

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  return { port: server.port ?? port, stop: () => server.stop() }
}
