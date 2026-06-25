// Auth service — credential storage for claudecode-llm-adapter.
//
// Credentials are stored at ~/.config/claudecode-llm-adapter/auth.json with 0o600
// permissions.
//
// Schema variants (discriminated by "type"):
//   { type: "api",       key, metadata? }
//   { type: "oauth",     refresh, access, expires, accountId?, enterpriseUrl? }
//   { type: "wellknown", key, token }
//
// The file can be fully overridden by setting CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT
// to a JSON string with the same shape — useful for CI / container deployments.

import { Context, Effect, Layer, Record, Result, Schema } from "effect"
import { Path } from "../global"
import { FSUtil } from "../fs-util"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({
  discriminator: "type",
  identifier: "Auth",
})
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@vampire/Auth") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      // Env-var override for CI / containers
      if (process.env.CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT) as Record<string, Info>
        } catch {}
      }

      const data = (yield* fsys
        .readJson(Path.authFile)
        .pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>

      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete (data as Record<string, unknown>)[key]
      delete (data as Record<string, unknown>)[norm + "/"]
      yield* fsys
        .writeJson(Path.authFile, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete (data as Record<string, unknown>)[key]
      delete (data as Record<string, unknown>)[norm]
      yield* fsys
        .writeJson(Path.authFile, data, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.layer))
