// xAI (Grok) OAuth — device-code flow.
// Logic extracted from OpenCode's packages/opencode/src/plugin/xai.ts

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const SCOPE = "openid profile email offline_access grok-cli:access api:access"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const DEFAULT_INTERVAL_MS = 5_000
const MIN_INTERVAL_MS = 1_000
const SLOW_DOWN_INCREMENT_MS = 5_000
const POLLING_SAFETY_MARGIN_MS = 3_000

export interface XaiOAuthResult {
  readonly type: "success"
  readonly access: string
  readonly refresh: string
  readonly expires: number
}

export interface XaiDeviceStart {
  readonly verificationUri: string
  readonly userCode: string
  readonly poll: () => Promise<XaiOAuthResult>
}

export async function startXaiDeviceFlow(): Promise<XaiDeviceStart> {
  const verifier = generateRandomString(64)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(hash)

  const res = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `vampire-llm-proxy/0.1.0`,
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString(),
  })

  if (!res.ok) throw new Error(`xAI device authorization request failed: ${res.status}`)

  const data = (await res.json()) as {
    verification_uri: string
    user_code: string
    device_code: string
    expires_in?: number
    interval?: number
  }

  const poll = async (): Promise<XaiOAuthResult> => {
    let interval = Math.max((data.interval ?? 5) * 1_000, MIN_INTERVAL_MS)
    const expiresAt = Date.now() + (data.expires_in ?? 300) * 1_000

    while (Date.now() < expiresAt) {
      await sleep(interval + POLLING_SAFETY_MARGIN_MS)

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": `vampire-llm-proxy/0.1.0`,
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: data.device_code,
          grant_type: DEVICE_CODE_GRANT_TYPE,
          code_verifier: verifier,
        }).toString(),
      })

      if (!tokenRes.ok) throw new Error(`xAI token request failed: ${tokenRes.status}`)

      const token = (await tokenRes.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        error?: string
        interval?: number
      }

      if (token.access_token) {
        return {
          type: "success",
          access: token.access_token,
          refresh: token.refresh_token ?? token.access_token,
          expires: token.expires_in ? Date.now() + token.expires_in * 1_000 : 0,
        }
      }

      if (token.error === "authorization_pending") continue

      if (token.error === "slow_down") {
        const extra = (token.interval ?? 0) * 1_000 || SLOW_DOWN_INCREMENT_MS
        interval = Math.max(interval + extra, MIN_INTERVAL_MS)
        continue
      }

      if (token.error) throw new Error(`xAI OAuth error: ${token.error}`)
    }

    throw new Error("xAI device authorization expired")
  }

  return { verificationUri: data.verification_uri, userCode: data.user_code, poll }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length]!)
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
