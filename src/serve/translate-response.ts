// Translate normalized LLMEvents from the llm package into Anthropic
// Messages API SSE format.
//
// Anthropic SSE event sequence for a streaming response:
//   message_start → content_block_start → ping → content_block_delta* →
//   content_block_stop → message_delta → message_stop

import type { LLMEvent } from "../llm/schema/index.ts"

// ── SSE helpers ─────────────────────────────────────────────────────────────

export function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

// ── State threaded through translation ──────────────────────────────────────

export interface TranslationState {
  messageId: string
  inputTokens: number
  outputTokens: number
  blockIndex: number
  modelId: string
}

export function makeTranslationState(modelId: string): TranslationState {
  return {
    messageId: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    inputTokens: 0,
    outputTokens: 0,
    blockIndex: 0,
    modelId,
  }
}

// Emit the Anthropic message_start event that opens the stream
export function messageStartEvent(state: TranslationState): string {
  return sseEvent("message_start", {
    type: "message_start",
    message: {
      id: state.messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: state.modelId,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
}

// ── Event translator ─────────────────────────────────────────────────────────

// Returns zero or more SSE chunks for a single LLMEvent.
// The state object is mutated in place (block index, token counts).
export function translateEvent(event: LLMEvent, state: TranslationState): string {
  switch (event.type) {
    case "step-start": {
      // Emit a ping to keep the connection alive and signal the block
      return sseEvent("ping", { type: "ping" })
    }

    case "text-start": {
      const chunk =
        sseEvent("content_block_start", {
          type: "content_block_start",
          index: state.blockIndex,
          content_block: { type: "text", text: "" },
        }) + sseEvent("ping", { type: "ping" })
      return chunk
    }

    case "text-delta": {
      return sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.blockIndex,
        delta: { type: "text_delta", text: event.text },
      })
    }

    case "text-end": {
      const chunk = sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.blockIndex,
      })
      state.blockIndex++
      return chunk
    }

    case "reasoning-start": {
      const chunk = sseEvent("content_block_start", {
        type: "content_block_start",
        index: state.blockIndex,
        content_block: { type: "thinking", thinking: "" },
      })
      return chunk
    }

    case "reasoning-delta": {
      return sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.blockIndex,
        delta: { type: "thinking_delta", thinking: event.text },
      })
    }

    case "reasoning-end": {
      const chunk = sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.blockIndex,
      })
      state.blockIndex++
      return chunk
    }

    case "tool-input-start": {
      const chunk = sseEvent("content_block_start", {
        type: "content_block_start",
        index: state.blockIndex,
        content_block: { type: "tool_use", id: event.id, name: event.name, input: {} },
      })
      return chunk
    }

    case "tool-input-delta": {
      return sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.blockIndex,
        delta: { type: "input_json_delta", partial_json: event.text },
      })
    }

    case "tool-input-end": {
      const chunk = sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.blockIndex,
      })
      state.blockIndex++
      return chunk
    }

    case "finish": {
      const usage = event.usage
      if (usage?.inputTokens !== undefined) state.inputTokens = usage.inputTokens
      if (usage?.outputTokens !== undefined) state.outputTokens = usage.outputTokens

      const stopReason = translateFinishReason(event.reason)

      return (
        sseEvent("message_delta", {
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: state.outputTokens },
        }) +
        sseEvent("message_stop", { type: "message_stop" })
      )
    }

    default:
      return ""
  }
}

function translateFinishReason(reason: string): string {
  switch (reason) {
    case "stop":
    case "end-turn":
    case "end_turn":
      return "end_turn"
    case "max-tokens":
    case "length":
      return "max_tokens"
    case "tool-calls":
    case "tool_calls":
      return "tool_use"
    default:
      return "end_turn"
  }
}
