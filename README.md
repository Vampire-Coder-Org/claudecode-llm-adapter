# vampire-llm-proxy

A local LLM proxy that exposes OpenAI-compatible and Anthropic-compatible REST endpoints, handles provider authentication, and lets you hot-swap models on demand.

## Usage

```bash
# Authenticate a provider
vampire-llm-proxy --login

# Start the proxy server (default port 3234)
vampire-llm-proxy --serve

# Start on a custom port
vampire-llm-proxy --serve --port 8080
```

Point any agent tool (e.g. Claude Code via `ANTHROPIC_BASE_URL`) at `http://localhost:3234` and the proxy handles the rest.

## Credentials

Stored at `~/.config/vampire-llm-proxy/auth.json` with `0o600` permissions. Can be overridden via `VAMPIRE_LLM_PROXY_AUTH_CONTENT` for CI/container use.
