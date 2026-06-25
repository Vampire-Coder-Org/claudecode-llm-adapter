// Active model state — shared between the HTTP server and the TUI.
//
// Uses an Effect Ref for atomic reads and writes so model changes
// are never partially visible across concurrent request fibres.
//
// HTTP request handlers snapshot the Ref at request-start and hold
// that snapshot for the lifetime of the request. TUI writes a new
// value atomically when the user confirms a model switch.

import { Effect, Ref } from "effect"
import type { Model } from "../llm/schema/index.ts"

export interface ActiveModelState {
  readonly providerId: string
  readonly modelId: string
  readonly model: Model
}

// Process-global Ref initialised lazily on first call to initActiveModel().
let _ref: Ref.Ref<ActiveModelState | null> | null = null

export function initActiveModel(initial: ActiveModelState): Effect.Effect<Ref.Ref<ActiveModelState | null>> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<ActiveModelState | null>(initial)
    _ref = ref
    return ref
  })
}

// Synchronous setters/getters for compatibility with non-Effect code (tests, CLI stubs).
// These wrap the Ref if initialised, or fall back to a plain mutable cell.

let _fallback: ActiveModelState | null = null

export function setActiveModel(state: ActiveModelState): void {
  _fallback = state
  if (_ref) Effect.runSync(Ref.set(_ref, state))
}

export function getActiveModel(): ActiveModelState | null {
  if (_ref) return Effect.runSync(Ref.get(_ref))
  return _fallback
}

export function requireActiveModel(): ActiveModelState {
  const state = getActiveModel()
  if (!state) throw new Error("No active model selected. Run --serve first.")
  return state
}

// Effect-native snapshot — used by the HTTP handler so it captures state
// atomically at the moment the request is accepted.
export const snapshotActiveModel: Effect.Effect<ActiveModelState | null> = Effect.gen(function* () {
  if (_ref) return yield* Ref.get(_ref)
  return _fallback
})
