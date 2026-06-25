// --serve entry point.
// 1. Load credentials from auth.json
// 2. Show interactive model picker (live Copilot API for copilot providers)
// 3. Lock in the selected model (Effect Ref)
// 4. Start HTTP server
// 5. Start TUI (concurrent with server)
// 6. Graceful SIGINT/SIGTERM shutdown

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "../login/providers.ts"
import { resolveModels } from "./model-catalog.ts"
import { setActiveModel, initActiveModel } from "./active-model.ts"
import { startServer } from "./server.ts"
import { buildModel } from "./build-model.ts"
import { runTui } from "./tui.ts"

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

// ── Model picker ──────────────────────────────────────────────────────────────

async function pickModel(
  credentials: Record<string, Auth.Info>,
): Promise<{ providerId: string; modelId: string }> {
  // For initial provider filter, use the hardcoded catalog length as a proxy —
  // Copilot providers always have hardcoded fallbacks so they show up here.
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

  // Fetch live models (shows spinner for Copilot providers)
  const spinner = p.spinner()
  const isCopilot = providerId === "github-copilot" || providerId === "github-copilot-enterprise"
  if (isCopilot) spinner.start("Fetching available models from Copilot API…")

  const { models, live } = await resolveModels(providerId, cred)

  if (isCopilot) {
    if (live) {
      spinner.stop(`Fetched ${models.length} models from Copilot API.`)
    } else {
      spinner.stop("Could not reach Copilot API — using fallback model list.")
    }
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

export async function runServe(port: number): Promise<void> {
  p.intro("vampire-llm-proxy — serve")

  const credentials = await loadCredentials()
  const { providerId, modelId } = await pickModel(credentials)
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
