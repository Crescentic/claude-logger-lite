// The event store: one JSONL file per session in `<config>/session-logger/sessions/`.
// Hooks only ever append to it, so hooks that fire at once can't lose each
// other's entries. The Markdown log is rebuilt from it (see write.ts).

import fs from "node:fs"
import path from "node:path"
import { isDirectory, withLock, writeFileAtomic } from "./files.ts"
import { projectInfo } from "./git.ts"
import { debugLog, eventsPath, logDir, logFileName, stateDir } from "./paths.ts"
import { parseLog, type ParsedLog } from "./render.ts"
import {
  errorCode,
  ofType,
  type Env,
  type SessionEvent,
  type SessionInput,
  type StartEvent,
} from "./types.ts"

const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// An event file without a start line is only treated as damaged once it's this
// old. A younger one may be mid-creation by a parallel hook.
const REPAIR_MIN_AGE_MS = 5_000

export function readEvents(file: string): SessionEvent[] {
  let text: string
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return []
  }
  const events: SessionEvent[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as SessionEvent)
    } catch {
      // A torn line from a crash: skip it.
    }
  }
  return events
}

export function appendEvent(file: string, event: SessionEvent): void {
  fs.appendFileSync(file, JSON.stringify(event) + "\n")
}

function ensureLogDir(env: Env, dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  // Commands can hold tokens, so the logs keep themselves out of git unless
  // the team opts in.
  if (env.SESSION_LOGGER_GITIGNORE === "0") return
  const ignore = path.join(dir, ".gitignore")
  try {
    fs.writeFileSync(ignore, "*\n", { flag: "wx" })
  } catch {
    // Already there, or not writable: leave it.
  }
}

/** This session's existing log in `dir`, if there is one. */
function findExistingLog(dir: string, sessionId: string): { file: string; log: ParsedLog } | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const suffix = `_${sessionId.slice(0, 8)}.md`
  for (const name of names) {
    if (!name.endsWith(suffix)) continue
    const file = path.join(dir, name)
    try {
      const log = parseLog(fs.readFileSync(file, "utf8"))
      if (log.sessionId === sessionId) return { file, log }
    } catch {
      // Unreadable: keep looking.
    }
  }
  return null
}

interface StartOptions {
  source: string
  late: boolean
  /** Copy entries from an existing log (only when no events survive). */
  carry: boolean
}

function startEvent(env: Env, sessionId: string, cwd: string, opts: StartOptions): StartEvent {
  const { root, repo, branch } = projectInfo(cwd)
  const t = new Date().toISOString()
  const dir = logDir(env, root)
  const start: StartEvent = {
    type: "start",
    t,
    sessionId,
    cwd,
    root,
    repo,
    branch,
    source: opts.source,
    late: opts.late,
    log: path.join(dir, logFileName(t, sessionId)),
  }

  // The session already has a log, but its event file is gone or damaged:
  // keep writing to that log instead of starting a second one.
  const existing = findExistingLog(dir, sessionId)
  if (existing) {
    start.log = existing.file
    start.t = existing.log.started || t
    start.late = existing.log.late
    if (opts.carry) {
      start.carried = { at: t, files: existing.log.files, commands: existing.log.commands }
    }
  }
  return start
}

function fileAgeMs(file: string): number {
  try {
    return Date.now() - fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Makes sure the session has an event file that starts with a `start` event,
 * creating or repairing it if needed. Returns null when the session can't be
 * logged (its working folder doesn't exist).
 *
 * `late` marks a session first seen after its SessionStart (installed
 * mid-session, or a missed start).
 */
export function ensureSession(
  env: Env,
  input: SessionInput,
  { source = "", late = false }: { source?: string | undefined; late?: boolean } = {}
): { file: string; created: boolean } | null {
  const file = eventsPath(env, input.session_id)
  const exists = fs.existsSync(file)
  if (exists) {
    if (ofType(readEvents(file), "start").length) return { file, created: false }
    if (fileAgeMs(file) < REPAIR_MIN_AGE_MS) return { file, created: false }
  }

  // Never create the working folder: if it's gone, there's nothing to log.
  const cwd = input.cwd || process.cwd()
  if (!isDirectory(cwd)) {
    debugLog(env, { level: "SKIP", reason: "working folder doesn't exist", session_id: input.session_id })
    return null
  }

  fs.mkdirSync(stateDir(env), { recursive: true })
  let start: StartEvent
  if (exists) {
    // Damaged: no readable start line, from a crash mid-write. Rebuild it
    // with a new start and every event that can still be read.
    start = startEvent(env, input.session_id, cwd, { source, late: true, carry: false })
    const repaired = withLock(file, () => {
      const events = readEvents(file)
      if (ofType(events, "start").length) return false // Another hook fixed it.
      const lines = [start, ...events].map((e) => JSON.stringify(e) + "\n")
      writeFileAtomic(file, lines.join(""))
      return true
    })
    if (!repaired) return { file, created: false }
    debugLog(env, { level: "REPAIR", session_id: input.session_id, file: start.log })
  } else {
    start = startEvent(env, input.session_id, cwd, { source, late, carry: true })
    try {
      fs.writeFileSync(file, JSON.stringify(start) + "\n", { flag: "wx" })
    } catch (err) {
      if (errorCode(err) === "EEXIST") return { file, created: false }
      throw err
    }
  }

  ensureLogDir(env, path.dirname(start.log))
  debugLog(env, {
    level: "START",
    session_id: input.session_id,
    file: start.log,
    late: start.late,
    continued: Boolean(start.carried),
  })
  return { file, created: true }
}

/** Deletes event files untouched for 30 days. Never throws. */
export function pruneOldState(env: Env): void {
  try {
    const dir = stateDir(env)
    const cutoff = Date.now() - STATE_MAX_AGE_MS
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue
      const file = path.join(dir, name)
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
    }
  } catch {
    // Nothing to prune.
  }
}
