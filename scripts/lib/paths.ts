// Where session-logger keeps things, and the debug log.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Env } from "./types.ts"

export const HOOK = "session-logger"
const DEBUG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function configDir(env: Env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
}

/** Folder holding each session's event file. */
export function stateDir(env: Env): string {
  return path.join(configDir(env), HOOK, "sessions")
}

/** Folder holding this plugin's daily debug logs. */
export function debugDir(env: Env): string {
  return path.join(configDir(env), HOOK, "debug")
}

export function eventsPath(env: Env, sessionId: string): string {
  return path.join(stateDir(env), `${sessionId}.jsonl`)
}

/** Folder for a project's Markdown logs: `SESSION_LOGGER_DIR`, from the project root. */
export function logDir(env: Env, root: string): string {
  const dir = env.SESSION_LOGGER_DIR
  return dir ? path.resolve(root, dir) : path.join(root, "docs", "sessions", "logs")
}

export function logFileName(startedIso: string, sessionId: string): string {
  const day = startedIso.slice(0, 10)
  const hhmm = startedIso.slice(11, 13) + startedIso.slice(14, 16)
  return `${day}_${hhmm}_${sessionId.slice(0, 8)}.md`
}

/** Appends one line to `<config>/session-logger/debug/<date>.jsonl`. Never throws. */
export function debugLog(env: Env, entry: Record<string, unknown>): void {
  try {
    const dir = debugDir(env)
    fs.mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString()
    const line = JSON.stringify({ ts, hook: HOOK, ...entry })
    fs.appendFileSync(path.join(dir, `${ts.slice(0, 10)}.jsonl`), line + "\n")
  } catch {
    // The debug log is best effort too.
  }
}

/** Deletes daily debug files untouched for 30 days. Never throws. */
export function pruneOldDebugLogs(env: Env): void {
  try {
    const dir = debugDir(env)
    const cutoff = Date.now() - DEBUG_MAX_AGE_MS
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
      const file = path.join(dir, name)
      try {
        const stat = fs.lstatSync(file)
        if (stat.isFile() && stat.mtimeMs < cutoff) fs.rmSync(file, { force: true })
      } catch {
        // Gone already, or not ours to delete: keep checking the other files.
      }
    }
  } catch {
    // Missing or unreadable debug folder.
  }
}
