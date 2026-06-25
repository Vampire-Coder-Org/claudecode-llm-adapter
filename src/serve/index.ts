// --serve entry point.
// 1. Load credentials from auth.json
// 2. Show interactive model picker
// 3. Lock in the selected model (Effect Ref)
// 4. Start HTTP server
// 5. Start TUI (concurrent with server)
// 6. Graceful SIGINT/SIGTERM shutdown

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "../login/providers.ts"
import { modelsForProvider } from "./model-catalog.ts"
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
  const available = providers.filter(
    (prov) => credentials[prov.id] !== undefined && modelsForProvider(prov.id).length > 0,
  )

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

  const models = modelsForProvider(selectedProvider as string)
  const selectedModel = await p.select({
    message: "Select a model",
    options: models.map((m) => ({ value: m.modelId, label: m.displayName })),
  })

  if (p.isCancel(selectedModel)) {
    p.cancel("Cancelled.")
    process.exit(0)
  }

  return { providerId: selectedProvider as string, modelId: selectedModel as string }
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

  // TUI blocks until process exits (Ctrl+C or SIGTERM handled inside)
  await runTui({ providerId, modelId }, server, credentials)
}
