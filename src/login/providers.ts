// Provider catalog — defines every supported provider, its display name,
// auth method, and what prompts are needed to collect credentials.
//
// authType "api"   → prompt for a static key (+ optional metadata fields)
// authType "oauth" → run a device-code or browser OAuth flow

export interface ApiProviderDef {
  readonly id: string
  readonly name: string
  readonly authType: "api"
  readonly keyLabel: string
  readonly keyPlaceholder?: string
  readonly metadata?: ReadonlyArray<{
    readonly key: string
    readonly label: string
    readonly placeholder?: string
  }>
}

export interface OAuthProviderDef {
  readonly id: string
  readonly name: string
  readonly authType: "oauth"
  readonly flow: "github-copilot" | "github-copilot-enterprise" | "xai"
}

export type ProviderDef = ApiProviderDef | OAuthProviderDef

export const providers: ProviderDef[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  {
    id: "anthropic",
    name: "Anthropic",
    authType: "api",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
  },
  // ── OpenAI ───────────────────────────────────────────────────────────────
  {
    id: "openai",
    name: "OpenAI",
    authType: "api",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
  },
  // ── Google ───────────────────────────────────────────────────────────────
  {
    id: "google",
    name: "Google (Gemini)",
    authType: "api",
    keyLabel: "Google AI API key",
  },
  // ── Azure OpenAI ─────────────────────────────────────────────────────────
  {
    id: "azure",
    name: "Azure OpenAI",
    authType: "api",
    keyLabel: "Azure API key",
    metadata: [{ key: "resourceName", label: "Azure resource name", placeholder: "my-azure-resource" }],
  },
  // ── Amazon Bedrock ───────────────────────────────────────────────────────
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    authType: "api",
    keyLabel: "AWS access key ID",
    metadata: [
      { key: "secretAccessKey", label: "AWS secret access key" },
      { key: "region", label: "AWS region", placeholder: "us-east-1" },
    ],
  },
  // ── Cloudflare Workers AI ────────────────────────────────────────────────
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    authType: "api",
    keyLabel: "Cloudflare API token",
    metadata: [{ key: "accountId", label: "Cloudflare account ID" }],
  },
  // ── GitHub Copilot ───────────────────────────────────────────────────────
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    authType: "oauth",
    flow: "github-copilot",
  },
  // ── GitHub Copilot Enterprise ─────────────────────────────────────────────
  {
    id: "github-copilot-enterprise",
    name: "GitHub Copilot Enterprise",
    authType: "oauth",
    flow: "github-copilot-enterprise",
  },
  // ── xAI (Grok) ───────────────────────────────────────────────────────────
  {
    id: "xai",
    name: "xAI (Grok)",
    authType: "oauth",
    flow: "xai",
  },
  // ── OpenRouter ───────────────────────────────────────────────────────────
  {
    id: "openrouter",
    name: "OpenRouter",
    authType: "api",
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "sk-or-...",
  },
  // ── OpenAI-compatible (custom endpoint) ──────────────────────────────────
  {
    id: "openai-compatible",
    name: "OpenAI-compatible (custom endpoint)",
    authType: "api",
    keyLabel: "API key",
    metadata: [{ key: "baseURL", label: "Base URL", placeholder: "https://api.example.com/v1" }],
  },
]
