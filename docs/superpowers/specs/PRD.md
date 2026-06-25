# PRD: claudecode-llm-adapter

## Problem Statement

AI coding agents such as Claude Code, Cursor, and similar harness tools are tightly coupled to a single LLM provider's API key and endpoint. Users who want to route these agents through a different provider, share credentials across multiple agents without exposing raw API keys, or switch models on demand — cannot do so without reconfiguring every agent individually and managing credentials in multiple places.

There is no self-hosted, provider-agnostic proxy that speaks the industry-standard OpenAI and Anthropic wire formats, handles all provider authentication flows automatically, and lets users hot-swap models without restarting their agents.

## Solution

`claudecode-llm-adapter` is a local CLI tool and HTTP proxy server. It authenticates against any LLM provider that the harness tools e.g Claude Code, Cursor support, stores credentials in its own credential file, and exposes OpenAI-compatible and Anthropic-compatible REST endpoints on localhost. Agent tools point their base URL at the proxy instead of the provider directly. The proxy injects credentials, translates request and response formats to match the selected provider's native wire protocol, and streams responses back to the caller. The active provider and model can be changed on demand via an interactive TUI without restarting the server.

## User Stories

1. As a developer, I want to run `claudecode-llm-adapter --login` so that I can authenticate against an LLM provider without manually managing API keys in every agent tool I use.
2. As a developer, I want to be prompted to select a provider during `--login` so that I can choose which provider to authenticate against from the full list of supported providers.
3. As a developer, I want API-key-based providers to prompt me to enter my API key during `--login` so that I can store my credentials securely in one place.
4. As a developer, I want OAuth-based providers (e.g. GitHub Copilot) to open a browser and complete the OAuth flow during `--login` so that I am not required to manually generate tokens.
5. As a developer, I want my credentials stored in `~/.config/claudecode-llm-adapter/auth.json` with owner-only permissions so that other users on the same machine cannot read my API keys.
7. As a developer, I want to run `claudecode-llm-adapter --serve` so that I can start the proxy HTTP server.
8. As a developer, I want to be prompted to select a provider and model at `--serve` startup so that I can control which model all proxied requests are routed to.
9. As a developer, I want the proxy to default to port `3234` so that I have a predictable local address without configuration.
10. As a developer, I want to pass `--port <number>` to `--serve` so that I can run the proxy on a port that does not conflict with other local services.
11. As a developer, I want the proxy to expose `POST /v1/messages` in Anthropic wire format so that I can point Claude Code's `ANTHROPIC_BASE_URL` at the proxy.
12. As a developer, I want the proxy to expose `POST /v1/chat/completions` in OpenAI wire format so that I can point any OpenAI-compatible agent tool at the proxy.
13. As a developer, I want the proxy to expose `GET /v1/models` so that agent tools that query available models receive a valid response describing the currently active model.
14. As a developer, I want the proxy to ignore the `model` field in incoming requests so that agents cannot override my selected model, regardless of what they send.
15. As a developer, I want the proxy to inject my stored credentials automatically before forwarding requests to the provider so that I never need to configure API keys inside agent tools.
16. As a developer, I want the proxy to translate incoming Anthropic-format requests into the selected provider's native wire format so that I can route Claude Code requests to any supported provider, not just Anthropic.
17. As a developer, I want the proxy to translate incoming OpenAI-format requests into the selected provider's native wire format so that I can route OpenAI-format agent requests to any supported provider.
18. As a developer, I want provider responses to be translated back into the caller's expected format (Anthropic or OpenAI SSE) so that agent tools receive well-formed responses they can parse.
19. As a developer, I want streaming responses to be forwarded as Server-Sent Events so that I see incremental output in my agent tool as the model generates it.
20. As a developer, I want in-flight streaming requests to complete on the model that was active when the request started so that my agent's current response is not corrupted by a model switch.
21. As a developer, I want a live TUI running in the same terminal process as the HTTP server so that I can monitor and control the proxy without opening a second terminal.
22. As a developer, I want the TUI to show the currently active provider and model so that I always know which model is handling my agent's requests.
23. As a developer, I want to change the active provider and model from the TUI while the server is running so that I can hot-swap models without restarting the proxy or reconfiguring my agent tools.
24. As a developer, I want the TUI to show a pending-change indicator when a model change is queued but an in-flight request is still completing on the old model so that I know the switch has been registered but not yet applied.
25. As a developer, I want model changes to take effect on the next request after any in-flight request completes so that there is a clean handoff with no dropped or split responses.
26. As a developer, I want long-running `--serve` sessions to automatically refresh expiring OAuth tokens without requiring me to re-run `--login`.
27. As a developer, I want to be able to set `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` to a JSON string so that I can run the proxy in CI or containers without writing credentials to disk.
28. As a developer, I want the proxy to surface a clear error if I run `--serve` before running `--login` for any provider so that I understand why the server cannot start.
29. As a developer, I want multiple concurrent requests from the same or different agent tools to be routed to the same active model simultaneously so that the proxy handles parallel agent activity correctly.
30. As a developer, I want the proxy process to exit cleanly on `Ctrl+C` or `SIGTERM`, completing any in-flight requests before shutting down so that my agent does not receive a torn response.

## Implementation Decisions

- **Runtime and language.** TypeScript with Bun as the runtime and Effect as the core concurrency and dependency-injection framework. This allows the internal `llm` protocol layer to be used reliably.

- **Internal structure.** The project is divided into distinct packages internally:
  - `src/llm` — provider protocol implementations, route composition, schema definitions, and the streaming client. This is the translation layer that lowers Anthropic/OpenAI-format requests into provider-native wire format and raises provider-native SSE events back into normalised events.
  - `src/login` — authentication flow implementations for all supported providers (API key entry and OAuth browser flows).
  - `src/auth` — provider credential resolution and the `FSUtil` read/write helpers.

- **Credential storage.** Credentials are stored at `~/.config/claudecode-llm-adapter/auth.json` with `0o600` file permissions. The JSON schema is a flat object keyed by provider ID, where each value is one of three discriminated-union variants — `{ type: "api", key, metadata? }`, `{ type: "oauth", refresh, access, expires, accountId?, enterpriseUrl? }`, or `{ type: "wellknown", key, token }`. The full contents of the file can be overridden via the `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` environment variable, which takes precedence over the file on disk.

- **Active model state.** A single process-global reactive state cell holds the active `{ provider, model, credentials }` snapshot. The HTTP request handler captures a snapshot of this cell at the moment a request is accepted. The TUI writes a new value to the cell when the user changes the model. The cell is implemented as an Effect `Ref` to guarantee atomic reads and writes without data races.

- **Model field override.** The `model` field in all incoming request bodies is unconditionally ignored. The proxy substitutes the model ID from the active model state snapshot before forwarding.

- **Request translation pipeline.** Incoming requests are accepted in either Anthropic Messages API format (`POST /v1/messages`) or OpenAI Chat Completions format (`POST /v1/chat/completions`). The pipeline is:
  1. Parse and normalise the incoming request into the `LLMRequest` canonical form.
  2. Substitute the active model.
  3. Look up credentials from the active model state snapshot.
  4. Lower the canonical request into the selected provider's native wire format using the extracted `llm` package protocol layer.
  5. Inject provider credentials via the route's `Auth` mechanism.
  6. Forward to the provider and stream the response.
  7. Raise provider-native SSE events back to normalised `LLMEvent`s.
  8. Serialise normalised events back into the caller's expected format (Anthropic SSE or OpenAI SSE depending on which endpoint was called).

- **HTTP server.** A Bun HTTP server handles all three endpoints. The server and TUI run as concurrent Effect fibres within the same process. The server is bound to `0.0.0.0:3234` by default; the port is configurable via `--port`.

- **TUI.** A terminal UI runs in the foreground of `--serve`, implemented using lightweight CLI status line techniques. The TUI displays: active provider and model, server address and port, request count, and a pending-change indicator. A keyboard shortcut opens the provider/model picker without stopping the server.

- **OAuth token refresh.** Token refresh behaves automatically for long-running `--serve` sessions. Expiring tokens refresh without requiring me to re-run `--login`.

- **`GET /v1/models` response.** Returns a single entry describing the currently active model in OpenAI models-list format, so that agent tools that call this endpoint on startup receive a parseable response.

- **Graceful shutdown.** On `SIGTERM` or `SIGINT`, the server stops accepting new connections, waits for all in-flight streaming requests to complete or time out (10-second hard limit), then exits.

- **`--login` flow.** Running `--login` prompts the user to select a provider, then runs the appropriate authentication flow. For API-key providers, the user is prompted to enter their key. For OAuth providers, a browser is opened to complete the flow. The resulting credential is written to `auth.json` using the discriminated-union schema described above. Multiple `--login` invocations merge into the existing `auth.json` rather than replacing it.

## Testing Decisions

**What makes a good test.** Tests assert on externally observable behaviour — what request was forwarded to the upstream provider, what response was returned to the caller, and what side effects occurred on disk (e.g. `auth.json` contents). Tests do not assert on internal module structure, private function signatures, or Effect layer composition details.

**Seam 1 — HTTP integration seam (primary).** The proxy server is started in test mode. The upstream provider HTTP endpoint is intercepted using the same `scriptedResponses` / recorded-cassette mechanism used in `packages/llm/test/`. Tests send real HTTP requests to `localhost:{testPort}` and assert on:
- The forwarded request body received by the mock provider (correct provider-native format, auth headers injected, `model` field substituted).
- The response stream returned to the caller (correct Anthropic or OpenAI SSE format, correct event sequence).
- That the `model` field sent by the caller was ignored and the active model was used instead.
- That two concurrent requests both complete successfully against the same active model.
- That a model state change mid-test does not affect an already-started streaming response, but does affect the next request.

This seam covers request translation, response translation, auth injection, model-field override, streaming, concurrency, and model hot-swap behaviour in a single test surface.

**Seam 2 — Auth storage seam.** Tests invoke the `--login` path programmatically against a mocked auth flow and assert on the contents and permissions of the resulting `auth.json` file. Tests also verify that `--serve` loads credentials from `auth.json` correctly for each credential type (`api`, `oauth`, `wellknown`), and that `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` overrides the file.

**Prior art.** `src/test/` — tests use HTTP intercepts and Effect test environments to cover the seams above.

## Out of Scope

- **Multi-model routing.** The proxy serves one model at a time. Per-request model selection based on the request body is not supported.
- **MCP server authentication.** `mcp-auth.json` and MCP OAuth flows are not implemented.
- **External account tokens.** Any external or cloud account synchronization is not replicated.
- **Cost tracking or usage accounting.** No billing, token counting, or cost estimation is exposed to callers.
- **Request logging or audit trails.** The proxy does not persist request or response bodies.
- **Multi-tenant or multi-user access.** The proxy is a single-user local tool. No per-caller authentication is implemented.
- **Embeddings, image generation, or speech endpoints.** Only chat-completion endpoints are in scope.
- **Legacy `POST /v1/completions` endpoint.** Only the chat completions and messages endpoints are implemented.
- **Web UI.** Model switching is TUI-only. No browser-based control panel is provided.
- **Windows support.** The initial implementation targets macOS and Linux. Windows path handling and OAuth browser launch behaviour are not tested.
- **Detection or reuse of external credential stores.** The proxy always uses its own `~/.config/claudecode-llm-adapter/auth.json` and does not read from other applications' data directories.

## Further Notes

- Claude Code uses `ANTHROPIC_BASE_URL` to point at a custom Anthropic-compatible endpoint. The proxy's `POST /v1/messages` endpoint must be byte-compatible with what Claude Code expects, including the SSE event tag names and the `content_block_delta` / `message_delta` event structure.
- The proxy is intentionally single-model-at-a-time. If future requirements call for per-request model routing, that is a separate feature requiring a new routing design and is explicitly out of scope here.

---

## Addendum: `--provider` / `--model` Flags for Non-Interactive Startup

### Added User Stories

31. As a developer, I want to run `claudecode-llm-adapter --serve --provider <id> --model <id>` so that I can start the proxy without going through the interactive picker every time.
32. As a developer, after completing the interactive model selection, I want the proxy to print the equivalent non-interactive command so that I can copy it for future use.
33. As a developer, I want the proxy to fail immediately with a clear error if `--provider` or `--model` is given alone (not both) so that I understand the correct usage.
34. As a developer, I want the proxy to fail fast with a clear message if the specified `--provider` is unknown so that I can correct it without starting the server.
35. As a developer, I want the proxy to fail fast with a clear message if no credential is stored for the specified `--provider` so that I know I need to run `--login` first.
36. As a developer, I want the proxy to fail fast with a clear message listing known model IDs if the specified `--model` does not belong to the specified provider's catalog so that I can correct it.
37. As a developer, I want GitHub Copilot Enterprise to fetch its live model list when `--provider github-copilot-enterprise` is passed with an invalid `--model`, display a warning, and prompt me to select a valid model so that I can recover without re-running the command.
38. As a developer, I want the skip-prompt hint to NOT be printed when I already passed `--provider` and `--model` as flags, since I already know the command.

### Added Implementation Decisions

- `--provider` and `--model` are CLI flags accepted only by `--serve`. They must always be provided together; providing only one is a fatal error at the CLI entry point before any provider logic runs.
- Validation order: (1) provider known in catalog, (2) credential exists in auth.json, (3) model exists in provider's catalog (or live API for Copilot). Each step fails fast with a specific error message.
- For `github-copilot` and `github-copilot-enterprise`: validation uses the live Copilot `/models` API (same fetch path as the interactive picker). An invalid model triggers a warning message followed by an interactive model picker — the user is not required to re-run the command.
- For all other providers: validation is against the hardcoded model catalog only. Unknown model IDs are always a hard failure.
- The skip-prompt hint is printed to the console only after a successful **interactive** model selection. It is suppressed when flags were already supplied.
- The hint format is: `claudecode-llm-adapter --serve --provider {id} --model {id}` (no port, since port has its own independent flag).
- The proxy is intentionally single-model-at-a-time. If future requirements call for per-request model routing, that is a separate feature requiring a new routing design and is explicitly out of scope here.
