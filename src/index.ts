#!/usr/bin/env bun
// claudecode-llm-adapter — CLI entry point

const args = process.argv.slice(2)
const command = args[0]

const flag = (name: string) => {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : undefined
}

const port = Number(flag("--port") ?? "3234")
const providerFlag = flag("--provider")
const modelFlag = flag("--model")

if (!command) {
  console.log("Usage: claudecode-llm-adapter <--login | --serve> [options]")
  console.log("       --serve [--port <n>] [--provider <id> --model <id>]")
  process.exit(0)
}

// --provider and --model must always be passed together
if ((providerFlag && !modelFlag) || (!providerFlag && modelFlag)) {
  console.error("Error: --provider and --model must be used together.")
  console.error("Usage: claudecode-llm-adapter --serve --provider <id> --model <id>")
  process.exit(1)
}

if (command === "--login") {
  const { runLogin } = await import("./login/index.ts")
  await runLogin()
  process.exit(0)
}

if (command === "--serve") {
  const { runServe } = await import("./serve/index.ts")
  await runServe(port, providerFlag && modelFlag ? { provider: providerFlag, model: modelFlag } : undefined)
  // runServe keeps the process alive — no process.exit here
} else {
  console.error(`Unknown command: ${command}`)
  console.error("Usage: claudecode-llm-adapter <--login | --serve> [--port <number>]")
  process.exit(1)
}
