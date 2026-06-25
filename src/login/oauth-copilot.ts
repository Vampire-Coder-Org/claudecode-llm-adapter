// GitHub Copilot OAuth — device-code flow (RFC 8628).
// Logic extracted from OpenCode's packages/opencode/src/plugin/github-copilot/copilot.ts

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
const API_VERSION = "2026-06-01"
const DEVICE_CODE_URL = "https://github.com/login/device/code"
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
const POLLING_SAFETY_MARGIN_MS = 3_000

export interface CopilotOAuthResult {
  readonly type: "success"
  readonly access: string
  readonly refresh: string
  readonly expires: number
  readonly enterpriseUrl?: string
}

export interface CopilotDeviceStart {
  readonly verificationUri: string
  readonly userCode: string
  readonly poll: () => Promise<CopilotOAuthResult>
}

export async function startCopilotDeviceFlow(enterpriseUrl?: string): Promise<CopilotDeviceStart> {
  const domain = enterpriseUrl ? enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "github.com"
  const deviceCodeUrl = `https://${domain}/login/device/code`
  const accessTokenUrl = `https://${domain}/login/oauth/access_token`

  const res = await fetch(deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `vampire-llm-proxy/0.1.0`,
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "read:user" }),
  })

  if (!res.ok) throw new Error(`GitHub device code request failed: ${res.status}`)

  const data = (await res.json()) as {
    verification_uri: string
    user_code: string
    device_code: string
    interval: number
  }

  const poll = async (): Promise<CopilotOAuthResult> => {
    let interval = data.interval * 1_000

    while (true) {
      await sleep(interval + POLLING_SAFETY_MARGIN_MS)

      const tokenRes = await fetch(accessTokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": `vampire-llm-proxy/0.1.0`,
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: data.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })

      if (!tokenRes.ok) throw new Error(`GitHub token request failed: ${tokenRes.status}`)

      const token = (await tokenRes.json()) as {
        access_token?: string
        error?: string
        interval?: number
      }

      if (token.access_token) {
        return {
          type: "success",
          access: token.access_token,
          refresh: token.access_token,
          expires: 0,
          ...(enterpriseUrl ? { enterpriseUrl: domain } : {}),
        }
      }

      if (token.error === "authorization_pending") continue

      if (token.error === "slow_down") {
        const serverInterval = token.interval
        interval =
          serverInterval && typeof serverInterval === "number" && serverInterval > 0
            ? serverInterval * 1_000
            : interval + 5_000
        continue
      }

      if (token.error) throw new Error(`GitHub OAuth error: ${token.error}`)
    }
  }

  return { verificationUri: data.verification_uri, userCode: data.user_code, poll }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Re-export CLIENT_ID so it can be referenced in tests or other modules
export { CLIENT_ID, API_VERSION, DEVICE_CODE_URL, ACCESS_TOKEN_URL }
