// Build a concrete Model value from a provider id, model id, and stored
// credential. Shared between the --serve startup flow and the TUI model picker.

import * as Anthropic from "../llm/providers/anthropic.ts"
import * as OpenAI from "../llm/providers/openai.ts"
import * as Google from "../llm/providers/google.ts"
import * as GithubCopilot from "../llm/providers/github-copilot.ts"
import * as Xai from "../llm/providers/xai.ts"
import type { Info as AuthInfo } from "../auth/index.ts"
import type { Model } from "../llm/schema/index.ts"

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
    case "github-copilot": {
      const token = cred.type === "oauth" ? cred.access : cred.type === "api" ? cred.key : undefined
      const enterpriseUrl = cred.type === "oauth" ? cred.enterpriseUrl : undefined
      const baseURL = enterpriseUrl
        ? `https://copilot-api.${enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
        : "https://api.githubcopilot.com"
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
