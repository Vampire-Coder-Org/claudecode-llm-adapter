// Proxy-specific path configuration.
// Credentials and config are stored at ~/.config/vampire-llm-proxy/
//
// Override for tests: set VAMPIRE_LLM_PROXY_CONFIG_DIR to a temp directory
// to isolate file-system operations from the real config.
import path from "path"
import os from "os"
import fs from "fs/promises"
import { xdgConfig } from "xdg-basedir"

const app = "vampire-llm-proxy"

// Path is a set of getters so VAMPIRE_LLM_PROXY_CONFIG_DIR is read at
// call-time, not at import-time. This lets tests set the env var in
// beforeEach and have it take effect for every subsequent call.
export const Path = {
  get config(): string {
    const override = process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR
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
if (!process.env.VAMPIRE_LLM_PROXY_CONFIG_DIR) {
  await fs.mkdir(Path.config, { recursive: true })
}
