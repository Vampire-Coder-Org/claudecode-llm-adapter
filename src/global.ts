// Proxy-specific path configuration.
// Credentials and config are stored at ~/.config/vampire-llm-proxy/
import path from "path"
import os from "os"
import fs from "fs/promises"
import { xdgConfig } from "xdg-basedir"

const app = "vampire-llm-proxy"

// Prefer XDG_CONFIG_HOME if set, otherwise fall back to ~/.config
const configBase = xdgConfig ?? path.join(os.homedir(), ".config")

export const Path = {
  config: path.join(configBase, app),
  get authFile() {
    return path.join(Path.config, "auth.json")
  },
}

// Ensure config directory exists on import
await fs.mkdir(Path.config, { recursive: true })
