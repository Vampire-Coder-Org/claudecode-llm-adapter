// --serve entry point.
// 1. Load credentials from auth.json
// 2. Resolve provider + model (from flags or interactive picker)
// 3. Lock in the selected model (Effect Ref)
// 4. Start HTTP server
// 5. Start TUI (concurrent with server)
// 6. Graceful SIGINT/SIGTERM shutdown

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "../login/providers.ts"
import { resolveModels, modelsForProvider } from "./model-catalog.ts"
import { setActiveModel, initActiveModel } from "./active-model.ts"
import { startServer } from "./server.ts"
import { buildModel } from "./build-model.ts"
import { runTui } from "./tui.ts"
import { copilotBaseURL, copilotToken, fetchCopilotModels } from "./copilot-models.ts"

export interface ServeFlags {
  readonly provider: string
  readonly model: string
}

// ── Load credentials ──────────────────────────────────────────────────────────

async function loadCredentials(): Promise<Record<string, Auth.Info>> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.all()
    }).pipe(
      Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer))),
    ) as Effect.Effect<Record<string, Auth.Info>, never, never>,
  )
}

// ── Flag-based resolution (non-interactive) ───────────────────────────────────

const COPILOT_PROVIDERS = new Set(["github-copilot", "github-copilot-enterprise"])

// Testable pure variant — returns a result instead of calling process.exit.
// The interactive (GHE re-prompt) path is not covered here since it requires a TTY.
export type FlagResolveResult =
  | { type: "ok"; providerId: string; modelId: string }
  | { type: "error"; message: string }
  | { type: "reprompt"; providerId: string; availableModels: { modelId: string; displayName: string }[] }

export async function resolveFromFlags_test(
  flags: ServeFlags,
  credentials: Record<string, Auth.Info>,
): Promise<FlagResolveResult> {
  const { provider: providerId, model: modelId } = flags

  const providerDef = providers.find((p) => p.id === providerId)
  if (!providerDef) return { type: "error", message: `Unknown provider: "${providerId}". Run --serve to see available providers.` }

  const cred = credentials[providerId]
  if (!cred) return { type: "error", message: `No credential found for "${providerId}". Run --login first.` }

  if (COPILOT_PROVIDERS.has(providerId)) {
    const baseURL = copilotBaseURL(cred)
    const token = copilotToken(cred)
    const liveModels = await fetchCopilotModels(baseURL, token, providerId)
    const modelList = liveModels ?? modelsForProvider(providerId)
    const found = modelList.find((m) => m.modelId === modelId)
    if (!found) return { type: "reprompt", providerId, availableModels: modelList }
    return { type: "ok", providerId, modelId }
  }

  const catalog = modelsForProvider(providerId)
  const found = catalog.find((m) => m.modelId === modelId)
  if (!found) {
    const known = catalog.map((m) => m.modelId).join(", ")
    return { type: "error", message: `Model "${modelId}" is not available for provider "${providerId}".\nKnown models: ${known || "(none)"}` }
  }

  return { type: "ok", providerId, modelId }
}

async function resolveFromFlags(
  flags: ServeFlags,
  credentials: Record<string, Auth.Info>,
): Promise<{ providerId: string; modelId: string }> {
  const result = await resolveFromFlags_test(flags, credentials)

  if (result.type === "error") {
    p.log.error(result.message)
    process.exit(1)
  }

  if (result.type === "reprompt") {
    p.log.warn(
      `Model "${flags.model}" was not found in the available model list for "${flags.provider}". Please select a valid model.`,
    )
    const selected = await p.select({
      message: "Select a model",
      options: result.availableModels.map((m) => ({ value: m.modelId, label: m.displayName })),
    })
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.")
      process.exit(0)
    }
    return { providerId: result.providerId, modelId: selected as string }
  }

  return { providerId: result.providerId, modelId: result.modelId }
}

// ── Interactive model picker ──────────────────────────────────────────────────

async function pickModel(
  credentials: Record<string, Auth.Info>,
): Promise<{ providerId: string; modelId: string }> {
  const available = providers.filter((prov) => credentials[prov.id] !== undefined)

  if (available.length === 0) {
    p.log.error("No authenticated providers found. Run `vampire-llm-proxy --login` first.")
    process.exit(1)
  }

  const selectedProvider = await p.select({
    message: "Select a provider",
    options: available.map((prov) => ({ value: prov.id, label: prov.name })),
  })

  if (p.isCancel(selectedProvider)) {
    p.cancel("Cancelled.")
    process.exit(0)
  }

  const providerId = selectedProvider as string
  const cred = credentials[providerId]!

  const spinner = p.spinner()
  const isCopilot = COPILOT_PROVIDERS.has(providerId)
  if (isCopilot) spinner.start("Fetching available models from Copilot API…")

  const { models, live } = await resolveModels(providerId, cred)

  if (isCopilot) {
    spinner.stop(live ? `Fetched ${models.length} models from Copilot API.` : "Could not reach Copilot API — using fallback model list.")
  }

  if (models.length === 0) {
    p.log.error(`No models available for ${providerId}.`)
    process.exit(1)
  }

  const selectedModel = await p.select({
    message: "Select a model",
    options: models.map((m) => ({ value: m.modelId, label: m.displayName })),
  })

  if (p.isCancel(selectedModel)) {
    p.cancel("Cancelled.")
    process.exit(0)
  }

  return { providerId, modelId: selectedModel as string }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runServe(port: number, flags?: ServeFlags): Promise<void> {
  p.intro("vampire-llm-proxy — serve")

  const credentials = await loadCredentials()

  let providerId: string
  let modelId: string
  const fromFlags = flags !== undefined

  if (fromFlags) {
    ;({ providerId, modelId } = await resolveFromFlags(flags, credentials))
  } else {
    ;({ providerId, modelId } = await pickModel(credentials))
    // Print the skip-prompt hint only after an interactive selection
    p.log.info(
      `Next time you can skip the prompts:\n\n  vampire-llm-proxy --serve --provider ${providerId} --model ${modelId}\n`,
    )
  }

  const cred = credentials[providerId]!
  const model = buildModel(providerId, modelId, cred)
  const initialState = { providerId, modelId, model }

  await Effect.runPromise(initActiveModel(initialState))
  setActiveModel(initialState)

  const server = startServer(port)

  process.on("SIGTERM", () => {
    server.stop()
    process.exit(0)
  })

  await runTui({ providerId, modelId }, server, credentials)
}
