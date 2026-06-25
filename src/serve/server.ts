// HTTP server — exposes the OpenAI-compatible and Anthropic-compatible
// REST endpoints. Bun's native HTTP server handles concurrency.
//
// Endpoints:
//   POST /v1/messages       — Anthropic Messages API (primary)
//   GET  /v1/models         — Returns the active model (OpenAI format)
//   POST /v1/chat/completions — OpenAI Chat Completions (added in Slice 7)

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

// ── Layer shared across all requests ─────────────────────────────────────────

const llmLayer = LLMClient.layer.pipe(
  Layer.provide(RequestExecutor.layer),
  Layer.provide(FetchHttpClient.layer),
)

// ── Request handlers ──────────────────────────────────────────────────────────

async function handleMessages(req: Request): Promise<Response> {
  const active = getActiveModel()
  if (!active) {
    return new Response(JSON.stringify({ error: "No active model" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: AnthropicRequestBody
  try {
    body = (await req.json()) as AnthropicRequestBody
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Ignore body.model — always use the pre-selected model
  const llmRequest = translateRequest(body, active.model)
  const translationState = makeTranslationState(active.modelId)

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    start(controller) {
      // Emit the opening message_start event immediately
      controller.enqueue(encoder.encode(messageStartEvent(translationState)))

      const stream = LLMClient.stream(llmRequest).pipe(
        Stream.map((event) => translateEvent(event, translationState)),
        Stream.filter((chunk) => chunk.length > 0),
        Stream.tap((chunk) => Effect.sync(() => controller.enqueue(encoder.encode(chunk)))),
        Stream.runDrain,
        Effect.provide(llmLayer),
      )

      Effect.runPromise(stream as Effect.Effect<void, never, never>)
        .catch((err) => {
          // Emit an error event so the client knows something went wrong
          const errChunk = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: String(err) } })}\n\n`
          controller.enqueue(encoder.encode(errChunk))
        })
        .finally(() => controller.close())
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

function handleModels(): Response {
  const active = getActiveModel()
  const models = active
    ? [
        {
          id: active.modelId,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: active.providerId,
        },
      ]
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
    async fetch(req) {
      const url = new URL(req.url)

      // CORS preflight
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

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        return handleMessages(req)
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return handleModels()
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  return {
    port: server.port ?? port,
    stop: () => server.stop(),
  }
}
