# claudecode-llm-adapter

Run one local server. Login once. Point Claude Code at it. Switch between providers and models from your terminal.

`claudecode-llm-adapter` is a local LLM adapter for Claude Code and other agent tools. It exposes Anthropic-compatible and OpenAI-compatible REST endpoints, translates requests and streaming responses across providers, and routes traffic to the active model you choose at startup or from the terminal UI.

## Quick start

```bash
# Authenticate a provider
claudecode-llm-adapter --login

# Start the adapter
claudecode-llm-adapter --serve
```

Point Claude Code at the adapter:

```bash
ANTHROPIC_BASE_URL=http://localhost:3234 claude
```

The adapter exposes:

| Endpoint | Compatibility |
|---|---|
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI Chat Completions API |
| `GET /v1/models` | OpenAI model list format |

## Start with a specific model

```bash
claudecode-llm-adapter --serve --provider github-copilot --model claude-sonnet-4
```

If you omit `--provider` and `--model`, the adapter opens an interactive picker.

## Authentication

```bash
claudecode-llm-adapter --login
```

Credentials are stored locally at:

```text
~/.config/claudecode-llm-adapter/auth.json
```

Use `--login` again to add or replace provider credentials.

## Notes

- Incoming request `model` fields are ignored. The active model selected by the adapter always wins.
- GitHub Copilot model availability is resolved from the live Copilot models API when possible, with a fallback catalog.
- GitHub Copilot API behavior is not guaranteed as a public/stable standalone API.

## Development

```bash
bun install
bun test
bun run typecheck
```
