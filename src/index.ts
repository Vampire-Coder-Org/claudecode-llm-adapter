#!/usr/bin/env bun
// vampire-llm-proxy — CLI entry point
// Slice 1: stubs only. Business logic lands in subsequent slices.

const args = process.argv.slice(2)
const command = args[0]
const portFlagIdx = args.indexOf("--port")
const port = portFlagIdx !== -1 ? Number(args[portFlagIdx + 1]) : 3234

if (!command) {
  console.log("Usage: vampire-llm-proxy <--login | --serve> [--port <number>]")
  process.exit(0)
}

if (command === "--login") {
  console.log("--login: not yet implemented")
  process.exit(0)
}

if (command === "--serve") {
  console.log(`--serve: not yet implemented (port: ${port})`)
  process.exit(0)
}

console.error(`Unknown command: ${command}`)
console.error("Usage: vampire-llm-proxy <--login | --serve> [--port <number>]")
process.exit(1)
