// Build a concrete Model value from a provider id, model id, and stored
// credential. Shared between the --serve startup flow and the TUI model picker.
//
// GitHub Copilot (github.com and Enterprise) exposes two distinct API surfaces:
//   - GPT models  → POST /v1/chat/completions  (OpenAI Chat protocol)
//   - Claude models → POST /v1/messages        (Anthropic Messages protocol)
// We must use the correct protocol per model family or the endpoint returns 404.

import * as Anthropic from "../llm/providers/anthropic.ts"
import * as OpenAI from "../llm/providers/openai.ts"
import * as Google from "../llm/providers/google.ts"
import * as GithubCopilot from "../llm/providers/github-copilot.ts"
import * as Xai from "../llm/providers/xai.ts"
import * as AnthropicMessages from "../llm/protocols/anthropic-messages.ts"
import { AuthOptions } from "../llm/route/auth-options.ts"
import type { Info as AuthInfo } from "../auth/index.ts"
import type { Model } from "../llm/schema/index.ts"

/** True for any model ID belonging to the Anthropic Claude family. */
const isClaude = (modelId: string) => modelId.toLowerCase().startsWith("claude")

export function buildModel(providerId: string, modelId: string, cred: AuthInfo): Model {
  switch (providerId) {
    case "anthropic": {
      const apiKey = cred.type === "api" ? cred.key : undefined
      return Anthropic.configure(apiKey ? { apiKey } : {}).model(modelId)
    }
    case "openai": {
      const apiKey = cred.type === "api" ? cred.key : undefined
      return OpenAI.configure(apiKey ? { apiKey } : {}).model(modelId)
    }
    case "google": {
      const apiKey = cred.type === "api" ? cred.key : undefined
      return Google.configure(apiKey ? { apiKey } : {}).model(modelId)
    }
    case "github-copilot":
    case "github-copilot-enterprise": {
      const token = cred.type === "oauth" ? cred.access : cred.type === "api" ? cred.key : undefined
      const enterpriseUrl = cred.type === "oauth" ? cred.enterpriseUrl : undefined
      const baseURL = enterpriseUrl
        ? `https://copilot-api.${enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
        : "https://api.githubcopilot.com"

      if (isClaude(modelId)) {
        // Claude models at GitHub Copilot speak Anthropic Messages API (/v1/messages).
        // The AnthropicMessages route appends "/messages" to baseURL, so we must
        // include /v1 in the baseURL to produce the correct full URL.
        const auth = AuthOptions.bearer({ apiKey: token ?? "" }, [])
        const route = AnthropicMessages.route.with({ endpoint: { baseURL: `${baseURL}/v1` }, auth })
        return route.model({ id: modelId })
      }

      // GPT and other models use the standard GitHub Copilot OpenAI Chat route.
      return GithubCopilot.configure({ baseURL, ...(token ? { apiKey: token } : {}) }).model(modelId)
    }
    case "xai": {
      const apiKey = cred.type === "api" ? cred.key : cred.type === "oauth" ? cred.access : undefined
      return Xai.configure(apiKey ? { apiKey } : {}).model(modelId)
    }
    default:
      throw new Error(`Unsupported provider for --serve: ${providerId}`)
  }
}
