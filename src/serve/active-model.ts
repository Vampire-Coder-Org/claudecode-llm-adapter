// Active model state — shared between the HTTP server and the TUI.
//
// In Slice 5 this is a simple mutable cell. Slice 8 (TUI) upgrades it to an
// Effect Ref so model changes can be observed and applied atomically across
// concurrent request fibres.

import type { Model } from "../llm/schema/index.ts"

export interface ActiveModelState {
  readonly providerId: string
  readonly modelId: string
  readonly model: Model
}

let _state: ActiveModelState | null = null

export function setActiveModel(state: ActiveModelState): void {
  _state = state
}

export function getActiveModel(): ActiveModelState | null {
  return _state
}

export function requireActiveModel(): ActiveModelState {
  if (!_state) throw new Error("No active model selected. Run --serve first.")
  return _state
}
