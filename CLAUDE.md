# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the proxy
bun run src/index.ts --login
bun run src/index.ts --serve [--port 3234] [--provider <id> --model <id>]

# Tests
bun test                        # all tests
bun test src/test/serve.test.ts # single file

# Type checking
bun run typecheck               # tsc --noEmit
```

## Architecture

This is a **local LLM proxy** — a single-binary Bun process that accepts requests in either Anthropic Messages or OpenAI Chat Completions format and routes them to a single upstream provider/model selected at startup. All responses are streamed as SSE; the `model` field in any incoming request is always ignored.

### Two-layer abstraction in `src/llm/`

The core LLM routing uses a four-axis composition model defined in `src/llm/route/`:

| Axis | File | Responsibility |
|------|------|----------------|
| **Protocol** | `route/protocol.ts` | Wire API shape (body schema + streaming state machine): `AnthropicMessages`, `OpenAIChat`, `BedrockConverse`, `Gemini`, etc. |
| **Endpoint** | `route/endpoint.ts` | Where to send the request (base URL + path) |
| **Auth** | `route/auth.ts` | How to authenticate (Bearer, API key, AWS SigV4, etc.) |
| **Framing** | `route/framing.ts` | How to cut the byte stream into protocol frames (SSE, AWS binary event-stream) |

A `Route` is assembled from these four pieces via `Route.make(...)`. Provider facades (`src/llm/providers/`) pre-wire these for each supported upstream. `LLMClient` (in `route/client.ts`) is the Effect service that compiles an `LLMRequest` → provider body → prepared transport → `Stream<LLMEvent>`.

### Serve layer (`src/serve/`)

- **`active-model.ts`** — process-global Effect `Ref` holding the currently selected `{providerId, modelId, model}`. HTTP handlers snapshot it atomically at request start; TUI writes to it on model switch.
- **`server.ts`** — Bun HTTP server. Three endpoints: `POST /v1/messages` (Anthropic), `POST /v1/chat/completions` (OpenAI), `GET /v1/models`. Each translates the incoming wire format → canonical `LLMRequest` → `LLMClient.stream()` → re-serialises events back to the caller's expected wire format.
- **`translate-request.ts`** / **`translate-openai.ts`** — Anthropic/OpenAI wire → `LLMRequest` translation.
- **`translate-response.ts`** / **`translate-openai.ts`** (response half) — `LLMEvent` stream → Anthropic SSE / OpenAI SSE re-serialisation.
- **`build-model.ts`** — maps `(providerId, modelId, credential)` → concrete `Model`. GitHub Copilot Claude models need a special route override because they speak `AnthropicMessages` at `/v1/messages` rather than the Copilot Chat Completions path.
- **`tui.ts`** — raw-terminal status bar (200 ms refresh, `m` key triggers model picker). Skipped when stdout is not a TTY.

### Auth & credentials (`src/auth/`, `src/login/`)

Credentials stored at `~/.config/vampire-llm-proxy/auth.json` (XDG). Schema is discriminated union: `api | oauth | wellknown`, identical to OpenCode's format so files are interoperable.

- `--login` runs `src/login/index.ts` — interactive prompt for API key providers, device-code OAuth for GitHub Copilot and xAI.
- Auth can be fully overridden via `VAMPIRE_LLM_PROXY_AUTH_CONTENT` (JSON string) for CI/containers.
- Config dir can be redirected via `VAMPIRE_LLM_PROXY_CONFIG_DIR` — used in tests to isolate filesystem state.

### Effect usage

The codebase uses Effect 4.x throughout `src/llm/`. The serve layer (`src/serve/`) bridges Effect and plain async with `Effect.runPromise(...)`. Do not introduce `async/await` deep inside `src/llm/` — keep Effect pipelines there. The `RequestExecutor` Effect service wraps `FetchHttpClient` and handles retries/rate-limit back-off.

### Adding a new provider

1. Add a `ProviderDef` entry to `src/login/providers.ts`.
2. Add model entries to `src/serve/model-catalog.ts`.
3. Create `src/llm/providers/<name>.ts` — wire `Protocol` + `Endpoint` + `Auth` into a `Route`, expose a `configure(options).model(id)` facade.
4. Handle the new `providerId` in `src/serve/build-model.ts`.

### Test strategy

Tests in `src/test/` use `bun:test`. Integration tests (`serve.test.ts`) spin up a mock upstream via `Bun.serve(port: 0)`, start the proxy against it, and make real HTTP requests — no mocking of internal Effect services. Set `VAMPIRE_LLM_PROXY_CONFIG_DIR` to a temp dir in test `beforeAll` to prevent touching `~/.config`.
