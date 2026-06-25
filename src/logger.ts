// Lightweight structured logger for vampire-llm-proxy.
// Writes to stdout with timestamps. No external dependencies.

type Level = "info" | "warn" | "error" | "debug"

function ts() {
  return new Date().toISOString()
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const prefix = `[${ts()}] [${level.toUpperCase().padEnd(5)}]`
  if (data && Object.keys(data).length > 0) {
    console.log(`${prefix} ${msg}`, JSON.stringify(data))
  } else {
    console.log(`${prefix} ${msg}`)
  }
}

export const log = {
  info:  (msg: string, data?: Record<string, unknown>) => write("info",  msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => write("warn",  msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),

  /** Log an incoming HTTP request */
  request(req: Request, providerId: string, modelId: string) {
    const url = new URL(req.url)
    write("info", `→ ${req.method} ${url.pathname}`, {
      provider: providerId,
      model: modelId,
      contentType: req.headers.get("content-type") ?? undefined,
    })
  },

  /** Log a completed streaming response */
  response(req: Request, durationMs: number, status: number) {
    const url = new URL(req.url)
    write("info", `← ${req.method} ${url.pathname} ${status} (${durationMs}ms)`)
  },

  /** Log a stream error that was caught and sent to the caller */
  streamError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    write("error", `stream error: ${msg}`, {
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5).join(" | ") : undefined,
    })
  },
}
