# claudecode-llm-adapter

A local LLM proxy that exposes OpenAI-compatible and Anthropic-compatible REST endpoints, handles provider authentication, and lets you hot-swap models on demand.

## Usage

```bash
# Authenticate a provider
claudecode-llm-adapter --login

# Start the proxy server (default port 3234)
claudecode-llm-adapter --serve

# Start on a custom port
claudecode-llm-adapter --serve --port 8080
```

Point any agent tool (e.g. Claude Code via `ANTHROPIC_BASE_URL`) at `http://localhost:3234` and the proxy handles the rest.

## Credentials

Stored at `~/.config/claudecode-llm-adapter/auth.json` with `0o600` permissions. Can be overridden via `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` for CI/container use.
