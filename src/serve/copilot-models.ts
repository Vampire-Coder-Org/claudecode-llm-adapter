// Fetch available models dynamically from the GitHub Copilot /models API.
//
// Works for both github.com Copilot and Copilot Enterprise — the caller
// passes the correct baseURL and token.

import type { ModelEntry } from "./model-catalog.ts"

const API_VERSION = "2026-06-01"

interface RawModel {
  id: string
  name: string
  version: string
  model_picker_enabled: boolean
  supported_endpoints?: string[]
  policy?: { state?: string }
  capabilities: {
    family: string
    limits?: {
      max_output_tokens?: number
      max_prompt_tokens?: number
      max_context_window_tokens?: number
    }
    supports: {
      tool_calls?: boolean
    }
  }
}

function isUsable(m: RawModel): boolean {
  // Must be picker-enabled, not disabled by policy, and have basic limits
  if (!m.model_picker_enabled) return false
  if (m.policy?.state === "disabled") return false
  if (m.capabilities.limits?.max_output_tokens === undefined) return false
  if (m.capabilities.limits?.max_prompt_tokens === undefined) return false
  return true
}

function displayName(providerId: string, m: RawModel): string {
  const prefix = providerId === "github-copilot-enterprise" ? "GHE Copilot" : "GitHub Copilot"
  return `${prefix} — ${m.name}`
}

/**
 * Fetch the model list from the Copilot API.
 *
 * @param baseURL  e.g. "https://api.githubcopilot.com" or
 *                      "https://copilot-api.github.example.com"
 * @param token    The GitHub access/refresh token used as Bearer auth
 * @param providerId  "github-copilot" or "github-copilot-enterprise"
 * @returns Resolved model entries, or null if the request fails
 */
export async function fetchCopilotModels(
  baseURL: string,
  token: string,
  providerId: string,
): Promise<ModelEntry[] | null> {
  try {
    const res = await fetch(`${baseURL}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "claudecode-llm-adapter/0.1.0",
        "X-GitHub-Api-Version": API_VERSION,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) return null

    const json = (await res.json()) as { data?: unknown[] }
    if (!Array.isArray(json.data)) return null

    return json.data
      .filter((raw): raw is RawModel => {
        if (!raw || typeof raw !== "object") return false
        const m = raw as RawModel
        return typeof m.id === "string" && typeof m.name === "string" && isUsable(m)
      })
      .map((m): ModelEntry => ({
        providerId,
        modelId: m.id,
        displayName: displayName(providerId, m),
      }))
  } catch {
    return null
  }
}

/**
 * Derive the Copilot API base URL from a stored credential.
 * Enterprise credentials carry an enterpriseUrl in the oauth variant.
 */
export function copilotBaseURL(cred: { type: string; enterpriseUrl?: string }): string {
  if (cred.type === "oauth" && cred.enterpriseUrl) {
    const domain = cred.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    return `https://copilot-api.${domain}`
  }
  return "https://api.githubcopilot.com"
}

/**
 * Extract the bearer token from a stored credential.
 */
export function copilotToken(cred: { type: string; access?: string; refresh?: string; key?: string }): string {
  if (cred.type === "oauth") return (cred.refresh ?? cred.access) ?? ""
  if (cred.type === "api") return cred.key ?? ""
  return ""
}
