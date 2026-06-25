// Hardcoded model catalog per provider.
// Displayed in the --serve model picker.

export interface ModelEntry {
  readonly providerId: string
  readonly modelId: string
  readonly displayName: string
}

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
  // ── GitHub Copilot ──────────────────────────────────────────────────────
  { providerId: "github-copilot", modelId: "claude-opus-4-5", displayName: "GitHub Copilot — Claude Opus 4.5" },
  { providerId: "github-copilot", modelId: "claude-sonnet-4-5", displayName: "GitHub Copilot — Claude Sonnet 4.5" },
  { providerId: "github-copilot", modelId: "gpt-4.1", displayName: "GitHub Copilot — GPT-4.1" },
  { providerId: "github-copilot", modelId: "gpt-4o", displayName: "GitHub Copilot — GPT-4o" },
  // ── xAI ─────────────────────────────────────────────────────────────────
  { providerId: "xai", modelId: "grok-3", displayName: "Grok 3" },
  { providerId: "xai", modelId: "grok-3-mini", displayName: "Grok 3 Mini" },
  { providerId: "xai", modelId: "grok-2-1212", displayName: "Grok 2" },
]

export function modelsForProvider(providerId: string): ModelEntry[] {
  return modelCatalog.filter((m) => m.providerId === providerId)
}
