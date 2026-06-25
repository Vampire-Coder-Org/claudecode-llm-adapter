// Model catalog — hardcoded entries for non-Copilot providers.
// For GitHub Copilot and GitHub Copilot Enterprise the live model list
// is fetched from the Copilot /models API via resolveModels().

import { fetchCopilotModels, copilotBaseURL, copilotToken } from "./copilot-models.ts"
import type { Info as AuthInfo } from "../auth/index.ts"

export interface ModelEntry {
  readonly providerId: string
  readonly modelId: string
  readonly displayName: string
}

// Hardcoded catalog for non-Copilot providers
export const modelCatalog: ModelEntry[] = [
  // ── Anthropic ───────────────────────────────────────────────────────────
  { providerId: "anthropic", modelId: "claude-opus-4-5", displayName: "Claude Opus 4.5" },
  { providerId: "anthropic", modelId: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
  { providerId: "anthropic", modelId: "claude-haiku-3-5", displayName: "Claude Haiku 3.5" },
  { providerId: "anthropic", modelId: "claude-3-7-sonnet-20250219", displayName: "Claude 3.7 Sonnet" },
  { providerId: "anthropic", modelId: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet" },
  { providerId: "anthropic", modelId: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku" },
  { providerId: "anthropic", modelId: "claude-3-opus-20240229", displayName: "Claude 3 Opus" },
  // ── OpenAI ──────────────────────────────────────────────────────────────
  { providerId: "openai", modelId: "gpt-4.1", displayName: "GPT-4.1" },
  { providerId: "openai", modelId: "gpt-4.1-mini", displayName: "GPT-4.1 Mini" },
  { providerId: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
  { providerId: "openai", modelId: "gpt-4o-mini", displayName: "GPT-4o Mini" },
  { providerId: "openai", modelId: "o3", displayName: "o3" },
  { providerId: "openai", modelId: "o4-mini", displayName: "o4-mini" },
  // ── Google ──────────────────────────────────────────────────────────────
  { providerId: "google", modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { providerId: "google", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  { providerId: "google", modelId: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
  // ── GitHub Copilot (github.com) — fallback only ──────────────────────────
  // These are used only when the live /models API call fails.
  { providerId: "github-copilot", modelId: "claude-opus-4-5", displayName: "GitHub Copilot — Claude Opus 4.5" },
  { providerId: "github-copilot", modelId: "claude-sonnet-4-5", displayName: "GitHub Copilot — Claude Sonnet 4.5" },
  { providerId: "github-copilot", modelId: "gpt-4.1", displayName: "GitHub Copilot — GPT-4.1" },
  { providerId: "github-copilot", modelId: "gpt-4o", displayName: "GitHub Copilot — GPT-4o" },
  // ── GitHub Copilot Enterprise — fallback only ────────────────────────────
  { providerId: "github-copilot-enterprise", modelId: "claude-opus-4-5", displayName: "GHE Copilot — Claude Opus 4.5" },
  { providerId: "github-copilot-enterprise", modelId: "claude-sonnet-4-5", displayName: "GHE Copilot — Claude Sonnet 4.5" },
  { providerId: "github-copilot-enterprise", modelId: "claude-haiku-3-5", displayName: "GHE Copilot — Claude Haiku 3.5" },
  { providerId: "github-copilot-enterprise", modelId: "gpt-4.1", displayName: "GHE Copilot — GPT-4.1" },
  { providerId: "github-copilot-enterprise", modelId: "gpt-4o", displayName: "GHE Copilot — GPT-4o" },
  { providerId: "github-copilot-enterprise", modelId: "gpt-4o-mini", displayName: "GHE Copilot — GPT-4o Mini" },
  // ── xAI ─────────────────────────────────────────────────────────────────
  { providerId: "xai", modelId: "grok-3", displayName: "Grok 3" },
  { providerId: "xai", modelId: "grok-3-mini", displayName: "Grok 3 Mini" },
  { providerId: "xai", modelId: "grok-2-1212", displayName: "Grok 2" },
]

/** Returns hardcoded models for a provider (used as fallback). */
export function modelsForProvider(providerId: string): ModelEntry[] {
  return modelCatalog.filter((m) => m.providerId === providerId)
}

const COPILOT_PROVIDERS = new Set(["github-copilot", "github-copilot-enterprise"])

/**
 * Resolve the model list for a provider.
 *
 * For GitHub Copilot providers: fetch live from the /models API, fall back
 * to the hardcoded catalog if the request fails or times out.
 *
 * For all other providers: return the hardcoded catalog immediately.
 */
export async function resolveModels(
  providerId: string,
  cred: AuthInfo,
): Promise<{ models: ModelEntry[]; live: boolean }> {
  if (COPILOT_PROVIDERS.has(providerId)) {
    const baseURL = copilotBaseURL(cred)
    const token = copilotToken(cred)
    const live = await fetchCopilotModels(baseURL, token, providerId)
    if (live && live.length > 0) return { models: live, live: true }
    // API unreachable or empty — fall back to hardcoded list
    return { models: modelsForProvider(providerId), live: false }
  }
  return { models: modelsForProvider(providerId), live: true }
}
