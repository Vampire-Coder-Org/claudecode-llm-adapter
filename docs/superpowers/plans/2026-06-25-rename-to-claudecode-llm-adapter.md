# Rename to claudecode-llm-adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from `vampire-llm-proxy` to `claudecode-llm-adapter`, removing all OpenCode attributions and updating every reference across source, config, tests, and docs.

**Architecture:** Pure rename — no functional changes. All files stay in place; only string values, comments, env var names, CLI bin name, config directory path, and Effect service identifiers change. Auth file format (`auth.json` schema) is unchanged.

**Tech Stack:** Bun, TypeScript, Effect 4.x

## Global Constraints

- New package name: `claudecode-llm-adapter`
- New CLI binary: `claudecode-llm-adapter`
- New config dir: `~/.config/claudecode-llm-adapter/`
- New env vars: `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR`, `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT`
- New Effect service tags: `@claudecode/LLMClient`, `@claudecode/LLM/RequestExecutor`, `@claudecode/LLM/WebSocketExecutor`
- New TS path alias: `@claudecode-ai/schema/llm`
- New User-Agent: `claudecode-llm-adapter/0.1.0`
- Auth file format (`auth.json` schema) is **unchanged** — no migration needed
- No new functionality, no file moves, no structural changes
- All tests must pass after changes: `bun test`

---

### Task 1: Update package.json and tsconfig.json

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces: new bin name `claudecode-llm-adapter`, new TS path alias `@claudecode-ai/schema/llm`

- [ ] **Step 1: Update package.json**

Replace the entire file content:

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "claudecode-llm-adapter",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": {
    "claudecode-llm-adapter": "./src/index.ts"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clack/prompts": "^1.6.0",
    "@smithy/eventstream-codec": "4.2.14",
    "@smithy/util-utf8": "4.2.2",
    "aws4fetch": "1.0.20",
    "effect": "4.0.0-beta.83",
    "xdg-basedir": "5.1.0"
  },
  "devDependencies": {
    "@tsconfig/bun": "1.0.9",
    "@types/bun": "1.3.13",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Update tsconfig.json path alias**

Replace only the `paths` block in `tsconfig.json`:

```json
"paths": {
  "@claudecode-ai/schema/llm": ["./src/schema/llm.ts"]
}
```

Full file after change:

```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "types": ["bun-types"],
    "paths": {
      "@claudecode-ai/schema/llm": ["./src/schema/llm.ts"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Verify typecheck still passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json
git commit -m "chore: rename package to claudecode-llm-adapter"
```

---

### Task 2: Update env vars and config path (`src/global.ts` and `src/auth/index.ts`)

**Files:**
- Modify: `src/global.ts`
- Modify: `src/auth/index.ts`

**Interfaces:**
- Produces: `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR`, `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` env vars; config dir `~/.config/claudecode-llm-adapter/`

- [ ] **Step 1: Rewrite `src/global.ts`**

```typescript
// Proxy-specific path configuration.
// Credentials and config are stored at ~/.config/claudecode-llm-adapter/
//
// Override for tests: set CLAUDECODE_LLM_ADAPTER_CONFIG_DIR to a temp directory
// to isolate file-system operations from the real config.
import path from "path"
import os from "os"
import fs from "fs/promises"
import { xdgConfig } from "xdg-basedir"

const app = "claudecode-llm-adapter"

// Path is a set of getters so CLAUDECODE_LLM_ADAPTER_CONFIG_DIR is read at
// call-time, not at import-time. This lets tests set the env var in
// beforeEach and have it take effect for every subsequent call.
export const Path = {
  get config(): string {
    const override = process.env.CLAUDECODE_LLM_ADAPTER_CONFIG_DIR
    if (override) return override
    const base = xdgConfig ?? path.join(os.homedir(), ".config")
    return path.join(base, app)
  },
  get authFile(): string {
    return path.join(Path.config, "auth.json")
  },
}

// Ensure the real config directory exists on first import.
// Tests redirect to a pre-existing temp dir, so this only matters at runtime.
if (!process.env.CLAUDECODE_LLM_ADAPTER_CONFIG_DIR) {
  await fs.mkdir(Path.config, { recursive: true })
}
```

- [ ] **Step 2: Update env var references in `src/auth/index.ts`**

Change the header comment block (lines 1–14) to:

```typescript
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
```

Change the env var check inside `all` (around line 84):

```typescript
if (process.env.CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT) {
  try {
    return JSON.parse(process.env.CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT) as Record<string, Info>
  } catch {}
}
```

- [ ] **Step 3: Run tests to verify nothing broke**

```bash
bun test src/test/auth.test.ts
```

Expected: all tests pass (the test files still reference old env var names — that's fixed in Task 4).

Actually skip running tests until Task 4 updates the test files. Just do a typecheck:

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/global.ts src/auth/index.ts
git commit -m "chore: rename env vars and config dir to claudecode-llm-adapter"
```

---

### Task 3: Update Effect service tags and schema shim

**Files:**
- Modify: `src/llm/route/client.ts`
- Modify: `src/llm/route/executor.ts`
- Modify: `src/llm/route/transport/websocket.ts`
- Modify: `src/llm/schema/ids.ts`
- Modify: `src/llm/schema/messages.ts`
- Modify: `src/schema/llm.ts`

**Interfaces:**
- Produces: Effect service tags `@claudecode/LLMClient`, `@claudecode/LLM/RequestExecutor`, `@claudecode/LLM/WebSocketExecutor`; TS import alias `@claudecode-ai/schema/llm`

- [ ] **Step 1: Update service tag in `src/llm/route/client.ts`**

Find line:
```typescript
export class Service extends Context.Service<Service, Interface>()("@opencode/LLMClient") {}
```

Replace with:
```typescript
export class Service extends Context.Service<Service, Interface>()("@claudecode/LLMClient") {}
```

- [ ] **Step 2: Update service tag in `src/llm/route/executor.ts`**

Find line:
```typescript
export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/RequestExecutor") {}
```

Replace with:
```typescript
export class Service extends Context.Service<Service, Interface>()("@claudecode/LLM/RequestExecutor") {}
```

- [ ] **Step 3: Update service tag in `src/llm/route/transport/websocket.ts`**

Find line:
```typescript
export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/WebSocketExecutor") {}
```

Replace with:
```typescript
export class Service extends Context.Service<Service, Interface>()("@claudecode/LLM/WebSocketExecutor") {}
```

- [ ] **Step 4: Update import alias in `src/llm/schema/ids.ts`**

Find line:
```typescript
import { ProviderMetadata } from "@opencode-ai/schema/llm"
```

Replace with:
```typescript
import { ProviderMetadata } from "@claudecode-ai/schema/llm"
```

- [ ] **Step 5: Update import alias in `src/llm/schema/messages.ts`**

Find line:
```typescript
import { ToolContent, ToolFileContent, ToolTextContent } from "@opencode-ai/schema/llm"
```

Replace with:
```typescript
import { ToolContent, ToolFileContent, ToolTextContent } from "@claudecode-ai/schema/llm"
```

- [ ] **Step 6: Update shim comment in `src/schema/llm.ts`**

Replace the first two lines:
```typescript
// Shim for @opencode-ai/schema/llm
// These are the only types consumed by src/llm/ from the OpenCode schema package.
```

With:
```typescript
// Local shim that satisfies the @claudecode-ai/schema/llm TypeScript path alias.
// Defines the minimal types consumed by src/llm/ for tool content and provider metadata.
```

- [ ] **Step 7: Verify typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/llm/route/client.ts src/llm/route/executor.ts src/llm/route/transport/websocket.ts src/llm/schema/ids.ts src/llm/schema/messages.ts src/schema/llm.ts
git commit -m "chore: update Effect service tags and schema alias to claudecode namespace"
```

---

### Task 4: Update CLI strings, User-Agent, and source comments

**Files:**
- Modify: `src/index.ts`
- Modify: `src/login/index.ts`
- Modify: `src/login/oauth-copilot.ts`
- Modify: `src/login/oauth-xai.ts`
- Modify: `src/serve/index.ts`
- Modify: `src/serve/copilot-models.ts`
- Modify: `src/serve/tui.ts`
- Modify: `src/logger.ts`
- Modify: `src/llm/providers/github-copilot.ts`
- Modify: `src/llm/protocols/gemini.ts`

**Interfaces:**
- Produces: all user-visible strings use `claudecode-llm-adapter`; no OpenCode attributions remain in comments

- [ ] **Step 1: Update `src/index.ts`**

Replace all three occurrences of `vampire-llm-proxy` in console strings:

```typescript
// Line 2 comment:
// claudecode-llm-adapter — CLI entry point

// Line 17:
console.log("Usage: claudecode-llm-adapter <--login | --serve> [options]")
console.log("       --serve [--port <n>] [--provider <id> --model <id>]")

// Line 25:
console.error("Usage: claudecode-llm-adapter --serve --provider <id> --model <id>")

// Line 41:
console.error("Usage: claudecode-llm-adapter <--login | --serve> [--port <number>]")
```

- [ ] **Step 2: Update `src/login/index.ts`**

```typescript
// Line 18:
p.intro("claudecode-llm-adapter — login")
```

- [ ] **Step 3: Update `src/login/oauth-copilot.ts`**

Replace the header comment (lines 1–3):
```typescript
// GitHub Copilot OAuth — device-code flow (RFC 8628).
```

Replace both `User-Agent` strings (lines 34 and 59):
```typescript
"User-Agent": `claudecode-llm-adapter/0.1.0`,
```

- [ ] **Step 4: Update `src/login/oauth-xai.ts`**

Replace the header comment (lines 1–2):
```typescript
// xAI OAuth — device-code flow (RFC 8628).
```

Replace both `User-Agent` strings (lines 36 and 67):
```typescript
"User-Agent": `claudecode-llm-adapter/0.1.0`,
```

- [ ] **Step 5: Update `src/serve/index.ts`**

```typescript
// Line 120:
p.log.error("No authenticated providers found. Run `claudecode-llm-adapter --login` first.")

// Line 168:
p.intro("claudecode-llm-adapter — serve")

// Line 182:
`Next time you can skip the prompts:\n\n  claudecode-llm-adapter --serve --provider ${providerId} --model ${modelId}\n`,
```

- [ ] **Step 6: Update `src/serve/copilot-models.ts`**

Replace header comment (lines 1–6):
```typescript
// Fetch available models dynamically from the GitHub Copilot /models API.
//
// Works for both github.com Copilot and Copilot Enterprise — the caller
// passes the correct baseURL and token.
```

Replace `User-Agent` (line 64):
```typescript
"User-Agent": "claudecode-llm-adapter/0.1.0",
```

- [ ] **Step 7: Update `src/serve/tui.ts`**

Replace the `renderStatus` return string (line 46):
```typescript
return `${CLEAR_LINE}claudecode-llm-adapter | ${model} | ${addr} | ${stats}${pending} | [m] switch model  `
```

- [ ] **Step 8: Update `src/logger.ts` comment**

Replace line 1:
```typescript
// Lightweight structured logger for claudecode-llm-adapter.
```

- [ ] **Step 9: Update `src/llm/providers/github-copilot.ts` comment**

Replace line 10:
```typescript
// GitHub Copilot has no canonical public URL — callers must supply `baseURL` explicitly.
```

- [ ] **Step 10: Update `src/llm/protocols/gemini.ts` comment**

Find the comment (around line 153):
```typescript
//    keys on non-object scalars. Mirrors OpenCode's historical Gemini rules.
```

Replace with:
```typescript
//    keys on non-object scalars.
```

- [ ] **Step 11: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/index.ts src/login/index.ts src/login/oauth-copilot.ts src/login/oauth-xai.ts src/serve/index.ts src/serve/copilot-models.ts src/serve/tui.ts src/logger.ts src/llm/providers/github-copilot.ts src/llm/protocols/gemini.ts
git commit -m "chore: update CLI strings, User-Agent, and comments to claudecode-llm-adapter"
```

---

### Task 5: Update test files

**Files:**
- Modify: `src/test/auth.test.ts`
- Modify: `src/test/login.test.ts`
- Modify: `src/test/serve-flags.test.ts`

**Interfaces:**
- Consumes: `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR`, `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` from Task 2

- [ ] **Step 1: Update `src/test/auth.test.ts`**

Replace all occurrences of `VAMPIRE_LLM_PROXY_CONFIG_DIR` → `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR` (lines 18, 22).

Replace all occurrences of `VAMPIRE_LLM_PROXY_AUTH_CONTENT` → `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT` (lines 213, 216, 219, 226, 230, 232).

- [ ] **Step 2: Update `src/test/login.test.ts`**

Replace all occurrences of `VAMPIRE_LLM_PROXY_CONFIG_DIR` → `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR` (lines 26, 30).

- [ ] **Step 3: Update `src/test/serve-flags.test.ts`**

Replace all occurrences of `VAMPIRE_LLM_PROXY_CONFIG_DIR` → `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR` (lines 20, 24).

- [ ] **Step 4: Run the full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/test/auth.test.ts src/test/login.test.ts src/test/serve-flags.test.ts
git commit -m "chore: update test env var references to CLAUDECODE_LLM_ADAPTER"
```

---

### Task 6: Update README.md and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite `README.md`**

```markdown
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
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the `## Commands` section — update the `bun run` examples to use `claudecode-llm-adapter`:

```markdown
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
```

In the `## Auth & credentials` section replace:

- `~/.config/vampire-llm-proxy/auth.json` → `~/.config/claudecode-llm-adapter/auth.json`
- `VAMPIRE_LLM_PROXY_AUTH_CONTENT` → `CLAUDECODE_LLM_ADAPTER_AUTH_CONTENT`
- `VAMPIRE_LLM_PROXY_CONFIG_DIR` → `CLAUDECODE_LLM_ADAPTER_CONFIG_DIR`
- Remove "identical to OpenCode's format so files are interoperable" — just say "credentials are stored at the XDG config path"

- [ ] **Step 3: Final check — grep for any remaining OpenCode or vampire references**

```bash
grep -rn "opencode\|OpenCode\|vampire-llm-proxy\|vampire_llm_proxy\|VAMPIRE_LLM" src/ package.json README.md CLAUDE.md tsconfig.json 2>/dev/null
```

Expected: no matches.

- [ ] **Step 4: Run full test suite one final time**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for claudecode-llm-adapter rename"
```
