// Tests for --login provider definitions and credential-persistence logic.
// These test the auth-storage seam: given a known credential, does it get
// written with the correct shape by the same code path --login uses?
//
// The actual interactive prompts (stdin) are not tested here; they depend
// on @clack/prompts which requires a real TTY. The seam we test is
// saveCredential() behaviour and the oauth device-start shape.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { FSUtil } from "../fs-util.ts"
import * as Auth from "../auth/index.ts"
import { providers } from "../login/providers.ts"

// ---------------------------------------------------------------------------
// Per-test isolated temp dir
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vampire-login-test-"))
  process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const runAuth = <A, E>(effect: Effect.Effect<A, E, Auth.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer))),
    ) as Effect.Effect<A, E, never>,
  )

const authSet = (id: string, cred: Auth.Info) =>
  runAuth(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      yield* svc.set(id, cred)
    }),
  )

const authGet = (id: string) =>
  runAuth(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.get(id)
    }),
  )

// ---------------------------------------------------------------------------
// Provider catalog sanity
// ---------------------------------------------------------------------------

describe("Login — provider catalog", () => {
  test("every provider has a non-empty id and name", () => {
    for (const prov of providers) {
      expect(prov.id.length).toBeGreaterThan(0)
      expect(prov.name.length).toBeGreaterThan(0)
    }
  })

  test("github-copilot is an oauth provider", () => {
    const copilot = providers.find((p) => p.id === "github-copilot")
    expect(copilot?.authType).toBe("oauth")
  })

  test("xai is an oauth provider", () => {
    const xai = providers.find((p) => p.id === "xai")
    expect(xai?.authType).toBe("oauth")
  })

  test("anthropic, openai, google are api-key providers", () => {
    for (const id of ["anthropic", "openai", "google"]) {
      const prov = providers.find((p) => p.id === id)
      expect(prov?.authType).toBe("api")
    }
  })

  test("azure has resourceName metadata field", () => {
    const azure = providers.find((p) => p.id === "azure")
    expect(azure?.authType).toBe("api")
    if (azure?.authType === "api") {
      expect(azure.metadata?.some((m) => m.key === "resourceName")).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Credential persistence — simulates what --login does after collecting input
// ---------------------------------------------------------------------------

describe("Login — api credential persistence", () => {
  test("api key credential is written with correct shape", async () => {
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-ant-test" }))
    const stored = await authGet("anthropic")
    expect(stored).toMatchObject({ type: "api", key: "sk-ant-test" })
  })

  test("api key with metadata (Azure) is written correctly", async () => {
    await authSet(
      "azure",
      new Auth.Api({ type: "api", key: "azure-key", metadata: { resourceName: "my-resource" } }),
    )
    const stored = await authGet("azure")
    expect(stored).toMatchObject({ type: "api", key: "azure-key", metadata: { resourceName: "my-resource" } })
  })

  test("second --login for a new provider merges with existing", async () => {
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-ant" }))
    await authSet("openai", new Auth.Api({ type: "api", key: "sk-oai" }))

    expect(await authGet("anthropic")).toMatchObject({ key: "sk-ant" })
    expect(await authGet("openai")).toMatchObject({ key: "sk-oai" })
  })

  test("re-running --login for same provider replaces old key", async () => {
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-old" }))
    await authSet("anthropic", new Auth.Api({ type: "api", key: "sk-new" }))

    const stored = await authGet("anthropic")
    expect(stored).toMatchObject({ key: "sk-new" })
  })
})

describe("Login — oauth credential persistence", () => {
  test("github-copilot oauth credential is written with correct shape", async () => {
    await authSet(
      "github-copilot",
      new Auth.Oauth({ type: "oauth", access: "gha_access", refresh: "gha_refresh", expires: 0 }),
    )
    const stored = await authGet("github-copilot")
    expect(stored).toMatchObject({ type: "oauth", access: "gha_access", refresh: "gha_refresh" })
  })

  test("xai oauth credential is written with expiry", async () => {
    const expires = Date.now() + 3600_000
    await authSet("xai", new Auth.Oauth({ type: "oauth", access: "xai_access", refresh: "xai_refresh", expires }))
    const stored = await authGet("xai")
    expect(stored).toMatchObject({ type: "oauth", expires })
  })
})
