// --serve entry point.
// 1. Load credentials from auth.json
// 2. Show interactive model picker
// 3. Lock in the selected model
// 4. Start the HTTP server
// 5. Print status and handle graceful shutdown

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "../login/providers.ts"
import { modelsForProvider } from "./model-catalog.ts"
import { setActiveModel } from "./active-model.ts"
import { startServer } from "./server.ts"
import * as Anthropic from "../llm/providers/anthropic.ts"
import * as OpenAI from "../llm/providers/openai.ts"
import * as Google from "../llm/providers/google.ts"
import * as GithubCopilot from "../llm/providers/github-copilot.ts"
import * as Xai from "../llm/providers/xai.ts"
import type { Model } from "../llm/schema/index.ts"

// ── Load all stored credentials ───────────────────────────────────────────────

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

// ── Build a Model from provider id + model id + stored credential ─────────────

function buildModel(providerId: string, modelId: string, cred: Auth.Info): Model {
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
      // GitHub Copilot requires an explicit baseURL.
      const token = cred.type === "oauth" ? cred.access : cred.type === "api" ? cred.key : undefined
      const enterpriseUrl = cred.type === "oauth" ? cred.enterpriseUrl : undefined
      const baseURL = enterpriseUrl
        ? `https://copilot-api.${enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
        : "https://api.githubcopilot.com"
      return GithubCopilot.configure({
        baseURL,
        ...(token ? { apiKey: token } : {}),
      }).model(modelId)
    }
    case "xai": {
      const apiKey = cred.type === "api" ? cred.key : cred.type === "oauth" ? cred.access : undefined
      return Xai.configure(apiKey ? { apiKey } : {}).model(modelId)
    }
    default:
      throw new Error(`Unsupported provider for --serve: ${providerId}`)
  }
}

// ── Interactive model picker ──────────────────────────────────────────────────

async function pickModel(
  credentials: Record<string, Auth.Info>,
): Promise<{ providerId: string; modelId: string }> {
  // Filter providers to those with stored credentials and known models
  const availableProviders = providers.filter(
    (prov) => credentials[prov.id] !== undefined && modelsForProvider(prov.id).length > 0,
  )

  if (availableProviders.length === 0) {
    p.log.error("No authenticated providers found. Run `vampire-llm-proxy --login` first.")
    process.exit(1)
  }

  const selectedProvider = await p.select({
    message: "Select a provider",
    options: availableProviders.map((prov) => ({ value: prov.id, label: prov.name })),
  })

  if (p.isCancel(selectedProvider)) {
    p.cancel("Cancelled.")
    process.exit(0)
  }

  const availableModels = modelsForProvider(selectedProvider as string)

  const selectedModel = await p.select({
    message: "Select a model",
    options: availableModels.map((m) => ({ value: m.modelId, label: m.displayName })),
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

  let model: Model
  try {
    model = buildModel(providerId, modelId, cred)
  } catch (err) {
    p.log.error(`Failed to configure provider: ${err}`)
    process.exit(1)
  }

  setActiveModel({ providerId, modelId, model })

  const server = startServer(port)
  const actualPort = server.port

  p.log.success(`Active model: ${modelId} (${providerId})`)
  p.log.info(`Listening on http://localhost:${actualPort}`)
  p.log.info("POST /v1/messages  — Anthropic Messages API")
  p.log.info("GET  /v1/models    — Active model")
  p.log.info("Press Ctrl+C to stop.")

  const shutdown = () => {
    p.log.info("Shutting down…")
    server.stop()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}
