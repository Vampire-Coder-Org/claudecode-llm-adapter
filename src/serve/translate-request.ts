// Translate an incoming Anthropic Messages API request body into the
// canonical LLMRequest used by the llm package's protocol layer.

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
import type { Model } from "../llm/schema/index.ts"
import type { ToolCallID } from "../llm/schema/ids.ts"

// ── Anthropic wire types ─────────────────────────────────────────────────────

interface AnthropicTextContent { type: "text"; text: string }
interface AnthropicImageContent { type: "image"; source: { type: string; media_type?: string; data?: string; url?: string } }
interface AnthropicToolUseContent { type: "tool_use"; id: string; name: string; input: unknown }
interface AnthropicToolResultContent { type: "tool_result"; tool_use_id: string; content: string | AnthropicTextContent[] }

type AnthropicContentPart =
  | AnthropicTextContent
  | AnthropicImageContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicContentPart[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface AnthropicRequestBody {
  model?: string // ignored — active model always wins
  messages: AnthropicMessage[]
  system?: string | Array<{ type: "text"; text: string }>
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
}

// ── Translation ──────────────────────────────────────────────────────────────

export function translateRequest(body: AnthropicRequestBody, model: Model): LLMRequest {
  const messages = body.messages.flatMap(translateMessage)

  const systemText = body.system
    ? typeof body.system === "string"
      ? body.system
      : body.system.map((s) => s.text).join("\n")
    : undefined

  const generation = new GenerationOptions({
    ...(body.max_tokens !== undefined && { maxTokens: body.max_tokens }),
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { topP: body.top_p }),
    ...(body.stop_sequences !== undefined && { stopSequences: body.stop_sequences }),
  })

  const tools = body.tools?.map(translateTool)

  return new LLMRequest({
    model,
    messages,
    system: systemText !== undefined ? [SystemPart.make(systemText)] : [],
    generation,
    tools: (tools ?? []) as ReadonlyArray<ToolDefinition>,
  })
}

function translateMessage(msg: AnthropicMessage): Message[] {
  const content = msg.content

  if (typeof content === "string") {
    return msg.role === "user" ? [Message.user(content)] : [Message.assistant(content)]
  }

  if (msg.role === "user") {
    const toolResults: ToolResultPart[] = []
    const userParts: ContentPart[] = []

    for (const part of content) {
      if (part.type === "tool_result") {
        const resultContent =
          typeof part.content === "string" ? part.content : part.content.map((c) => c.text).join("")
        toolResults.push(
          ToolResultPart.make({
            id: part.tool_use_id as ToolCallID,
            name: "",
            result: resultContent,
          }),
        )
      } else if (part.type === "text") {
        userParts.push({ type: "text", text: part.text })
      }
    }

    const messages: Message[] = []
    for (const tr of toolResults) messages.push(Message.tool(tr))
    if (userParts.length > 0) messages.push(Message.user(userParts))
    return messages
  }

  // assistant role — text and tool_use parts
  const assistantParts: ContentPart[] = []

  for (const part of content) {
    if (part.type === "text") {
      assistantParts.push({ type: "text", text: part.text })
    } else if (part.type === "tool_use") {
      assistantParts.push(
        ToolCallPart.make({
          id: part.id as ToolCallID,
          name: part.name,
          input: part.input,
        }),
      )
    }
  }

  return assistantParts.length > 0 ? [Message.assistant(assistantParts)] : []
}

function translateTool(tool: AnthropicTool): ToolDefinition {
  return ToolDefinition.make({
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: tool.input_schema,  // field name is inputSchema, not parameters
  })
}
