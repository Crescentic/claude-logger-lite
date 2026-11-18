#!/usr/bin/env node
// Entry point for the plugin's hooks: `node hook.mjs <start|tool|stop|end>`,
// with the hook's JSON input on stdin.
//
// This file is plain JavaScript on purpose. The logic lives in logger.ts, which
// Node runs by stripping its types (Node 22.18 and later). On an older Node,
// loading it fails, so this file catches that, notes it in the debug log, and
// still exits 0 so the session carries on.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MIN_NODE = "22.18"

/** @returns {string} */
function readStdin() {
  if (process.stdin.isTTY) return ""
  try {
    return fs.readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

/** @param {string} reason */
function noteFailure(reason) {
  try {
    const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
    const dir = path.join(config, "hooks-logs")
    fs.mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString()
    const line = JSON.stringify({ ts, hook: "session-logger", level: "ERROR", event: process.argv[2], error: reason })
    fs.appendFileSync(path.join(dir, `${ts.slice(0, 10)}.jsonl`), line + "\n")
  } catch {
    // Best effort.
  }
}

if (process.env.SESSION_LOGGER_DISABLE !== "1") {
  try {
    if (!process.features.typescript) {
      throw new Error(
        `Node ${process.version} can't run TypeScript; session-logger needs Node ${MIN_NODE} or later`
      )
    }
    const { run } = await import("./logger.ts")
    run(process.argv.slice(2), process.env, readStdin())
  } catch (err) {
    noteFailure(String(/** @type {Error} */ (err)?.message ?? err).slice(0, 300))
  }
}
process.exit(0)
