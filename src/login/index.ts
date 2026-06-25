// --login command implementation.
// Uses @clack/prompts for interactive terminal UI.
// Supports API-key providers and OAuth device-code providers.

import * as p from "@clack/prompts"
import { Effect, Layer } from "effect"
import * as Auth from "../auth/index.ts"
import { FSUtil } from "../fs-util.ts"
import { providers } from "./providers.ts"
import { startCopilotDeviceFlow } from "./oauth-copilot.ts"
import { startXaiDeviceFlow } from "./oauth-xai.ts"

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runLogin(): Promise<void> {
  p.intro("claudecode-llm-adapter — login")

  // ── Provider selection ────────────────────────────────────────────────────
  const selected = await p.select({
    message: "Select a provider to authenticate",
    options: providers.map((prov) => ({
      value: prov.id,
      label: prov.name,
      hint: prov.authType === "oauth" ? "browser OAuth" : "API key",
    })),
  })

  if (p.isCancel(selected)) {
    p.cancel("Login cancelled.")
    process.exit(0)
  }

  const providerDef = providers.find((x) => x.id === selected)!

  if (providerDef.authType === "api") {
    await loginApiKey(providerDef as import("./providers.ts").ApiProviderDef)
  } else {
    await loginOAuth(providerDef as import("./providers.ts").OAuthProviderDef)
  }
}

// ---------------------------------------------------------------------------
// API-key flow
// ---------------------------------------------------------------------------

async function loginApiKey(prov: import("./providers.ts").ApiProviderDef): Promise<void> {
  const key = await p.password({
    message: prov.keyLabel,
    ...(prov.keyPlaceholder ? { validate: (v) => (!v ? "API key is required" : undefined) } : {}),
  })

  if (p.isCancel(key)) {
    p.cancel("Login cancelled.")
    process.exit(0)
  }

  const metadata: Record<string, string> = {}

  if (prov.metadata) {
    for (const field of prov.metadata) {
      const value = await p.text({
        message: field.label,
        placeholder: field.placeholder,
        validate: (v) => (!v ? `${field.label} is required` : undefined),
      })

      if (p.isCancel(value)) {
        p.cancel("Login cancelled.")
        process.exit(0)
      }

      metadata[field.key] = value as string
    }
  }

  const cred = new Auth.Api({
    type: "api",
    key: key as string,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  })

  await saveCredential(prov.id, cred)
  p.outro(`Authenticated as ${prov.name}. Credentials saved.`)
}

// ---------------------------------------------------------------------------
// OAuth device-code flow
// ---------------------------------------------------------------------------

async function loginOAuth(prov: import("./providers.ts").OAuthProviderDef): Promise<void> {
  const spinner = p.spinner()
  spinner.start("Starting OAuth device authorization…")

  let deviceStart: { verificationUri: string; userCode: string; poll: () => Promise<Auth.Oauth> }

  try {
    if (prov.flow === "github-copilot") {
      const result = await startCopilotDeviceFlow()
      deviceStart = {
        verificationUri: result.verificationUri,
        userCode: result.userCode,
        poll: async () => {
          const r = await result.poll()
          return new Auth.Oauth({
            type: "oauth",
            access: r.access,
            refresh: r.refresh,
            expires: r.expires,
          })
        },
      }
    } else if (prov.flow === "github-copilot-enterprise") {
      // Prompt for the enterprise server URL before starting the device flow
      spinner.stop("Enterprise URL needed.")

      const rawUrl = await p.text({
        message: "GitHub Enterprise server URL",
        placeholder: "https://github.example.com  or  github.example.com",
        validate: (v) => {
          if (!v) return "Enterprise URL is required"
          const normalized = v.replace(/^https?:\/\//, "").replace(/\/$/, "")
          if (!normalized.includes(".")) return "Enter a valid hostname (e.g. github.example.com)"
        },
      })

      if (p.isCancel(rawUrl)) {
        p.cancel("Login cancelled.")
        process.exit(0)
      }

      const enterpriseUrl = (rawUrl as string).replace(/^https?:\/\//, "").replace(/\/$/, "")
      spinner.start("Starting OAuth device authorization…")

      const result = await startCopilotDeviceFlow(enterpriseUrl)
      deviceStart = {
        verificationUri: result.verificationUri,
        userCode: result.userCode,
        poll: async () => {
          const r = await result.poll()
          return new Auth.Oauth({
            type: "oauth",
            access: r.access,
            refresh: r.refresh,
            expires: r.expires,
            enterpriseUrl: r.enterpriseUrl ?? enterpriseUrl,
          })
        },
      }
    } else {
      const result = await startXaiDeviceFlow()
      deviceStart = {
        verificationUri: result.verificationUri,
        userCode: result.userCode,
        poll: async () => {
          const r = await result.poll()
          return new Auth.Oauth({
            type: "oauth",
            access: r.access,
            refresh: r.refresh,
            expires: r.expires,
          })
        },
      }
    }
  } catch (err) {
    spinner.stop("Failed to start device authorization.")
    p.log.error(String(err))
    process.exit(1)
  }

  spinner.stop("Device authorization started.")

  p.log.info(`Open this URL in your browser:\n\n  ${deviceStart.verificationUri}\n`)
  p.log.info(`Enter this code when prompted:\n\n  ${deviceStart.userCode}\n`)
  p.log.info("Waiting for you to complete authorization in the browser…")

  const waitSpinner = p.spinner()
  waitSpinner.start("Polling for token…")

  let cred: Auth.Oauth
  try {
    cred = await deviceStart.poll()
  } catch (err) {
    waitSpinner.stop("Authorization failed.")
    p.log.error(String(err))
    process.exit(1)
  }

  waitSpinner.stop("Token received.")
  await saveCredential(prov.id, cred)
  p.outro(`Authenticated as ${prov.name}. Credentials saved.`)
}

// ---------------------------------------------------------------------------
// Persist credential via the auth service
// ---------------------------------------------------------------------------

async function saveCredential(providerId: string, cred: Auth.Info): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      yield* svc.set(providerId, cred)
    }).pipe(Effect.provide(Auth.layer.pipe(Layer.provide(FSUtil.layer)))) as Effect.Effect<void, never, never>,
  )
}
