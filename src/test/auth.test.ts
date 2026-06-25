import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { FSUtil } from "../fs-util.ts"
import * as Auth from "../auth/index.ts"
import { Path } from "../global.ts"

// ---------------------------------------------------------------------------
// Helpers — isolated temp dir per test via env var override
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vampire-auth-test-"))
  process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// Run an Effect that requires Auth.Service, providing the real layer over FSUtil
const runAuth = <A, E>(effect: Effect.Effect<A, E, Auth.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer))),
    ) as Effect.Effect<A, E, never>,
  )

// Convenience: call an auth method inside Effect.gen
const auth = {
  all: () =>
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.all()
    }),
  get: (id: string) =>
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.get(id)
    }),
  set: (id: string, info: Auth.Info) =>
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.set(id, info)
    }),
  remove: (id: string) =>
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      return yield* svc.remove(id)
    }),
}

// ---------------------------------------------------------------------------
// Missing file → empty record, not an error
// ---------------------------------------------------------------------------

describe("Auth storage — missing file", () => {
  test("all() returns empty record when auth.json does not exist", async () => {
    const result = await runAuth(auth.all())
    expect(result).toEqual({})
  })

  test("get() returns undefined when auth.json does not exist", async () => {
    const result = await runAuth(auth.get("anthropic"))
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// api credential — shape and permissions
// ---------------------------------------------------------------------------

describe("Auth storage — api credential", () => {
  test("set() writes api credential with correct shape", async () => {
    const cred = new Auth.Api({ type: "api", key: "sk-test-123" })
    await runAuth(auth.set("anthropic", cred))

    const raw = JSON.parse(await fs.readFile(Path.authFile, "utf-8"))
    expect(raw).toEqual({ anthropic: { type: "api", key: "sk-test-123" } })
  })

  test("set() creates auth.json with 0o600 permissions", async () => {
    const cred = new Auth.Api({ type: "api", key: "sk-test-123" })
    await runAuth(auth.set("anthropic", cred))

    const stat = await fs.stat(Path.authFile)
    // 0o600 = owner read+write only
    expect(stat.mode & 0o777).toBe(0o600)
  })

  test("get() retrieves stored api credential", async () => {
    const cred = new Auth.Api({ type: "api", key: "sk-test-456" })
    await runAuth(auth.set("openai", cred))

    const result = await runAuth(auth.get("openai"))
    expect(result).toMatchObject({ type: "api", key: "sk-test-456" })
  })

  test("api credential with metadata is stored and retrieved correctly", async () => {
    const cred = new Auth.Api({
      type: "api",
      key: "sk-azure",
      metadata: { resourceName: "my-resource" },
    })
    await runAuth(auth.set("azure", cred))

    const result = await runAuth(auth.get("azure"))
    expect(result).toMatchObject({
      type: "api",
      key: "sk-azure",
      metadata: { resourceName: "my-resource" },
    })
  })
})

// ---------------------------------------------------------------------------
// oauth credential
// ---------------------------------------------------------------------------

describe("Auth storage — oauth credential", () => {
  test("set() writes oauth credential with correct shape", async () => {
    const cred = new Auth.Oauth({
      type: "oauth",
      refresh: "refresh-tok",
      access: "access-tok",
      expires: 9999999999,
    })
    await runAuth(auth.set("github-copilot", cred))

    const raw = JSON.parse(await fs.readFile(Path.authFile, "utf-8"))
    expect(raw["github-copilot"]).toEqual({
      type: "oauth",
      refresh: "refresh-tok",
      access: "access-tok",
      expires: 9999999999,
    })
  })

  test("oauth credential with optional fields is stored correctly", async () => {
    const cred = new Auth.Oauth({
      type: "oauth",
      refresh: "rt",
      access: "at",
      expires: 1000000,
      accountId: "my-org",
      enterpriseUrl: "https://github.example.com",
    })
    await runAuth(auth.set("github-copilot", cred))
    const result = await runAuth(auth.get("github-copilot"))
    expect(result).toMatchObject({ accountId: "my-org", enterpriseUrl: "https://github.example.com" })
  })
})

// ---------------------------------------------------------------------------
// Merge behaviour
// ---------------------------------------------------------------------------

describe("Auth storage — merge behaviour", () => {
  test("set() for a second provider merges without removing the first", async () => {
    await runAuth(auth.set("anthropic", new Auth.Api({ type: "api", key: "sk-ant" })))
    await runAuth(auth.set("openai", new Auth.Api({ type: "api", key: "sk-oai" })))

    const raw = JSON.parse(await fs.readFile(Path.authFile, "utf-8"))
    expect(raw).toMatchObject({
      anthropic: { type: "api", key: "sk-ant" },
      openai: { type: "api", key: "sk-oai" },
    })
  })

  test("set() for same provider overwrites that entry only", async () => {
    await runAuth(auth.set("anthropic", new Auth.Api({ type: "api", key: "sk-old" })))
    await runAuth(auth.set("openai", new Auth.Api({ type: "api", key: "sk-oai" })))
    await runAuth(auth.set("anthropic", new Auth.Api({ type: "api", key: "sk-new" })))

    const result = await runAuth(auth.all())
    expect(result).toMatchObject({
      anthropic: { type: "api", key: "sk-new" },
      openai: { type: "api", key: "sk-oai" },
    })
  })
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("Auth storage — remove", () => {
  test("remove() deletes only the specified provider entry", async () => {
    await runAuth(auth.set("anthropic", new Auth.Api({ type: "api", key: "sk-ant" })))
    await runAuth(auth.set("openai", new Auth.Api({ type: "api", key: "sk-oai" })))
    await runAuth(auth.remove("anthropic"))

    const result = await runAuth(auth.all())
    expect(result).not.toHaveProperty("anthropic")
    expect(result).toHaveProperty("openai")
  })

  test("remove() on non-existent key is a no-op", async () => {
    await runAuth(auth.set("openai", new Auth.Api({ type: "api", key: "sk-oai" })))
    await runAuth(auth.remove("anthropic")) // does not exist — should not throw

    const result = await runAuth(auth.all())
    expect(result).toMatchObject({ openai: { type: "api", key: "sk-oai" } })
  })
})

// ---------------------------------------------------------------------------
// VAMPIRE_LLM_PROXY_AUTH_CONTENT env var override
// ---------------------------------------------------------------------------

describe("Auth storage — VAMPIRE_LLM_PROXY_AUTH_CONTENT override", () => {
  test("all() returns raw env var content when set", async () => {
    const override = { anthropic: { type: "api", key: "sk-from-env" } }
    process.env.VAMPIRE_LLM_PROXY_AUTH_CONTENT = JSON.stringify(override)

    try {
      const result = await runAuth(auth.all())
      // env var is returned as raw object (not schema-decoded) so compare loosely
      expect(result["anthropic"]).toMatchObject({ type: "api", key: "sk-from-env" })
    } finally {
      delete process.env.VAMPIRE_LLM_PROXY_AUTH_CONTENT
    }
  })

  test("all() reads file when VAMPIRE_LLM_PROXY_AUTH_CONTENT is unset", async () => {
    await runAuth(auth.set("openai", new Auth.Api({ type: "api", key: "sk-file" })))
    delete process.env.VAMPIRE_LLM_PROXY_AUTH_CONTENT

    const result = await runAuth(auth.all())
    expect(result).toMatchObject({ openai: { type: "api", key: "sk-file" } })
  })
})
