// TUI — interactive terminal display that runs concurrently with the HTTP server.
//
// Shows: active provider/model, server address, request count, pending-change
// indicator when a model switch is queued but an in-flight request is running.
//
// Model picker is triggered by pressing 'm'. The TUI writes the new model to
// the shared active-model Ref. In-flight requests complete on their snapshot;
// the next request picks up the new model.
//
// Implemented as a lightweight raw-terminal UI (no heavy framework) so it
// remains a thin wrapper around readline and process.stdout.

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "../login/providers.ts"
import { modelsForProvider } from "./model-catalog.ts"
import { setActiveModel } from "./active-model.ts"
import { buildModel } from "./build-model.ts"
import type { ServerHandle } from "./server.ts"

// ── TUI state ─────────────────────────────────────────────────────────────────

interface TuiState {
  providerId: string
  modelId: string
  port: number
  requestCount: number
  inFlight: number
  pendingChange: boolean
}

// ── Terminal helpers ──────────────────────────────────────────────────────────

const ESC = "\x1b["
const CLEAR_LINE = `${ESC}2K\r`
const HIDE_CURSOR = `${ESC}?25l`
const SHOW_CURSOR = `${ESC}?25h`

function renderStatus(state: TuiState): string {
  const model = `${state.modelId} (${state.providerId})`
  const addr = `http://localhost:${state.port}`
  const stats = `${state.inFlight} in-flight | ${state.requestCount} total`
  const pending = state.pendingChange ? "  ⟳ model change pending…" : ""
  return `${CLEAR_LINE}🧛 vampire-llm-proxy | ${model} | ${addr} | ${stats}${pending} | [m] switch model  `
}

// ── Request counter (exported so server.ts can update it) ────────────────────

export let requestCount = 0
export let inFlightCount = 0

export function incrementRequest(): void {
  requestCount++
  inFlightCount++
}
export function decrementInFlight(): void {
  if (inFlightCount > 0) inFlightCount--
}

// ── TUI loop ─────────────────────────────────────────────────────────────────

export async function runTui(
  initialState: { providerId: string; modelId: string },
  server: ServerHandle,
  credentials: Record<string, Auth.Info>,
): Promise<void> {
  // Hide cursor for cleaner display
  process.stdout.write(HIDE_CURSOR)

  const cleanup = () => {
    process.stdout.write(SHOW_CURSOR + "\n")
  }

  process.on("exit", cleanup)
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)

  let currentModel = { ...initialState }
  let pendingChange = false

  // Status refresh loop
  const refreshLoop = async () => {
    while (true) {
      const status: TuiState = {
        ...currentModel,
        port: server.port,
        requestCount,
        inFlight: inFlightCount,
        pendingChange,
      }
      process.stdout.write(renderStatus(status))
      await sleep(200)

      // Clear pending indicator once in-flight drops to 0 after a change
      if (pendingChange && inFlightCount === 0) pendingChange = false
    }
  }

  // Keyboard input loop — detect 'm' keypress to open model picker
  const inputLoop = async () => {
    if (!process.stdin.isTTY) return

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf-8")

    process.stdin.on("data", async (key: string) => {
      if (key === "\u0003") {
        // Ctrl+C
        cleanup()
        server.stop()
        process.exit(0)
      }

      if (key.toLowerCase() === "m") {
        // Pause status rendering while the picker is open
        process.stdout.write(SHOW_CURSOR + "\n")

        const result = await openModelPicker(credentials)
        if (result) {
          pendingChange = inFlightCount > 0
          currentModel = result
          setActiveModel({
            ...result,
            model: buildModel(result.providerId, result.modelId, credentials[result.providerId]!),
          })
          p.log.success(`Switched to ${result.modelId} (${result.providerId})`)
        }

        process.stdout.write(HIDE_CURSOR)
      }
    })
  }

  // Run both loops concurrently (they never return in normal operation)
  await Promise.all([refreshLoop(), inputLoop()])
}

// ── Model picker (same logic as serve/index.ts but invokable mid-session) ────

async function openModelPicker(
  credentials: Record<string, Auth.Info>,
): Promise<{ providerId: string; modelId: string } | null> {
  const availableProviders = providers.filter(
    (prov) => credentials[prov.id] !== undefined && modelsForProvider(prov.id).length > 0,
  )

  if (availableProviders.length === 0) {
    p.log.error("No authenticated providers found.")
    return null
  }

  const selectedProvider = await p.select({
    message: "Select a provider",
    options: availableProviders.map((prov) => ({ value: prov.id, label: prov.name })),
  })

  if (p.isCancel(selectedProvider)) return null

  const availableModels = modelsForProvider(selectedProvider as string)
  const selectedModel = await p.select({
    message: "Select a model",
    options: availableModels.map((m) => ({ value: m.modelId, label: m.displayName })),
  })

  if (p.isCancel(selectedModel)) return null

  return { providerId: selectedProvider as string, modelId: selectedModel as string }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
