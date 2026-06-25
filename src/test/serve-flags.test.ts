// Tests for --provider / --model flag validation in serve/index.ts

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import os from "os"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { resolveFromFlags_test } from "../serve/index.ts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vampire-flags-test-"))
  process.env.CLAUDECODE_LLM_ADAPTER_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.CLAUDECODE_LLM_ADAPTER_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const authSet = (id: string, cred: Auth.Info) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      yield* svc.set(id, cred)
    }).pipe(
      Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer))),
    ) as Effect.Effect<void, never, never>,
  )

const authAll = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.all()
    }).pipe(
      Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer))),
    ) as Effect.Effect<Record<string, Auth.Info>, never, never>,
  )

// ---------------------------------------------------------------------------
// resolveFromFlags_test — exported test helper that returns a result instead
// of calling process.exit, so we can assert on it
// ---------------------------------------------------------------------------

describe("--provider / --model flag validation", () => {
  test("valid provider + model resolves without prompts", async () => {
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-test" }))
    const credentials = await authAll()

    const result = await resolveFromFlags_test(
      { provider: "anthropic", model: "claude-opus-4-5" },
      credentials,
    )
    expect(result.type).toBe("ok")
    if (result.type === "ok") {
      expect(result.providerId).toBe("anthropic")
      expect(result.modelId).toBe("claude-opus-4-5")
    }
  })

  test("unknown provider returns error", async () => {
    const credentials = await authAll()
    const result = await resolveFromFlags_test(
      { provider: "nonexistent-provider", model: "some-model" },
      credentials,
    )
    expect(result.type).toBe("error")
    if (result.type === "error") expect(result.message).toContain("Unknown provider")
  })

  test("missing credential returns error", async () => {
    // No credential stored for anthropic
    const credentials = await authAll()
    const result = await resolveFromFlags_test(
      { provider: "anthropic", model: "claude-opus-4-5" },
      credentials,
    )
    expect(result.type).toBe("error")
    if (result.type === "error") expect(result.message).toContain("No credential found")
  })

  test("wrong model for provider returns error", async () => {
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-test" }))
    const credentials = await authAll()
    const result = await resolveFromFlags_test(
      { provider: "anthropic", model: "gpt-99-nonexistent" },
      credentials,
    )
    expect(result.type).toBe("error")
    if (result.type === "error") expect(result.message).toContain("not available")
  })

  test("valid openai provider + model resolves correctly", async () => {
    await authSet("openai", new Auth.Api({ type: "api", key: "sk-oai" }))
    const credentials = await authAll()
    const result = await resolveFromFlags_test(
      { provider: "openai", model: "gpt-4o" },
      credentials,
    )
    expect(result.type).toBe("ok")
    if (result.type === "ok") {
      expect(result.providerId).toBe("openai")
      expect(result.modelId).toBe("gpt-4o")
    }
  })
})
