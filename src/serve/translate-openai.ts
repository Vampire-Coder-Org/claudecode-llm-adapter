// Translate an incoming OpenAI Chat Completions API request body into the
// canonical LLMRequest used by the llm package's protocol layer.
// Also provides translation of LLMEvents back to OpenAI SSE format.

import {
  GenerationOptions,
  LLMRequest,
  Message,
  SystemPart,
  ToolDefinition,
  ToolResultPart,
  ToolCallPart,
  type ContentPart,
} from "../llm/schema/index.ts"
import type { Model, LLMEvent } from "../llm/schema/index.ts"
import type { ToolCallID } from "../llm/schema/ids.ts"

// ── OpenAI wire types ─────────────────────────────────────────────────────────

interface OpenAITextContent { type: "text"; text: string }
interface OpenAIImageContent { type: "image_url"; image_url: { url: string; detail?: string } }
interface OpenAIToolCallContent {
  type: "tool_use" | "tool_call"
  id: string
  function: { name: string; arguments: string }
}

type OpenAIContentPart = OpenAITextContent | OpenAIImageContent | OpenAIToolCallContent

interface OpenAIToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
}

interface OpenAITool {
  type: "function"
  function: { name: string; description?: string; parameters?: Record<string, unknown> }
}

export interface OpenAIRequestBody {
  model?: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  stop?: string | string[]
  tools?: OpenAITool[]
}

// ── Request translation ───────────────────────────────────────────────────────

export function translateOpenAIRequest(body: OpenAIRequestBody, model: Model): LLMRequest {
  // Extract system messages from the message list
  const systemParts: string[] = []
  const restMessages: OpenAIMessage[] = []

  for (const msg of body.messages) {
    if (msg.role === "system") {
      systemParts.push(typeof msg.content === "string" ? msg.content : "")
    } else {
      restMessages.push(msg)
    }
  }

  const messages = restMessages.flatMap(translateOpenAIMessage)

  const generation = new GenerationOptions({
    ...(body.max_tokens !== undefined && { maxTokens: body.max_tokens }),
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { topP: body.top_p }),
    ...(body.stop !== undefined && {
      stopSequences: Array.isArray(body.stop) ? body.stop : [body.stop],
    }),
  })

  const tools = body.tools?.map(translateOpenAITool)

  return new LLMRequest({
    model,
    messages,
    system: systemParts.length > 0 ? [SystemPart.make(systemParts.join("\n"))] : [],
    generation,
    tools: (tools ?? []) as ReadonlyArray<ToolDefinition>,
  })
}

function translateOpenAIMessage(msg: OpenAIMessage): Message[] {
  // Tool result message
  if (msg.role === "tool") {
    const content = typeof msg.content === "string" ? msg.content : ""
    return [
      Message.tool(
        ToolResultPart.make({
          id: (msg.tool_call_id ?? "") as ToolCallID,
          name: msg.name ?? "",
          result: content,
        }),
      ),
    ]
  }

  // User message
  if (msg.role === "user") {
    const parts: ContentPart[] = []
    const content = msg.content

    if (typeof content === "string") {
      parts.push({ type: "text", text: content })
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") parts.push({ type: "text", text: part.text })
      }
    }

    return parts.length > 0 ? [Message.user(parts)] : []
  }

  // Assistant message
  if (msg.role === "assistant") {
    const parts: ContentPart[] = []
    const content = msg.content

    if (typeof content === "string" && content) {
      parts.push({ type: "text", text: content })
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") parts.push({ type: "text", text: part.text })
      }
    }

    // Tool calls from the assistant
    for (const tc of msg.tool_calls ?? []) {
      let input: unknown
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        input = {}
      }
      parts.push(
        ToolCallPart.make({
          id: tc.id as ToolCallID,
          name: tc.function.name,
          input,
        }),
      )
    }

    return parts.length > 0 ? [Message.assistant(parts)] : []
  }

  return []
}

function translateOpenAITool(tool: OpenAITool): ToolDefinition {
  return ToolDefinition.make({
    name: tool.function.name,
    description: tool.function.description ?? tool.function.name,
    inputSchema: tool.function.parameters ?? {},
  })
}

// ── Response translation — LLMEvent → OpenAI SSE ─────────────────────────────

export interface OpenAITranslationState {
  messageId: string
  modelId: string
  blockIndex: number
}

export function makeOpenAITranslationState(modelId: string): OpenAITranslationState {
  return {
    messageId: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    modelId,
    blockIndex: 0,
  }
}

export function openAIStartEvent(state: OpenAITranslationState): string {
  return openAIChunk(state, [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }])
}

export function translateOpenAIEvent(event: LLMEvent, state: OpenAITranslationState): string {
  switch (event.type) {
    case "text-delta":
      return openAIChunk(state, [{ index: 0, delta: { content: event.text }, finish_reason: null }])

    case "tool-input-start":
      state.blockIndex++
      return openAIChunk(state, [
        {
          index: state.blockIndex,
          delta: {
            tool_calls: [
              {
                index: state.blockIndex,
                id: event.id,
                type: "function",
                function: { name: event.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ])

    case "tool-input-delta":
      return openAIChunk(state, [
        {
          index: state.blockIndex,
          delta: { tool_calls: [{ index: state.blockIndex, function: { arguments: event.text } }] },
          finish_reason: null,
        },
      ])

    case "finish": {
      const stopReason = event.reason === "tool-calls" ? "tool_calls" : "stop"
      return (
        openAIChunk(state, [{ index: 0, delta: {}, finish_reason: stopReason }]) + `data: [DONE]\n\n`
      )
    }

    default:
      return ""
  }
}

function openAIChunk(
  state: OpenAITranslationState,
  choices: Array<{ index: number; delta: Record<string, unknown>; finish_reason: string | null }>,
): string {
  return `data: ${JSON.stringify({
    id: state.messageId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: state.modelId,
    choices,
  })}\n\n`
}
