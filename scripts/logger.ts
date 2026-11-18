// session-logger: writes a Markdown log of each Claude Code session.
//
// `hook.mjs` calls `run()` with the event name (`start`, `tool`, `stop` or
// `end`) and the hook's JSON input. It must never block or break a session, so
// every failure is swallowed and noted in the debug log.
//
// The pieces live in ./lib: types, paths, git, files (locking, safe writes),
// store (event files), render (Markdown) and write (rebuilding the log).

import { finalStatus } from "./lib/git.ts"
import { debugLog } from "./lib/paths.ts"
import { appendEvent, ensureSession, pruneOldState, readEvents } from "./lib/store.ts"
import {
  ofType,
  type CmdEvent,
  type Env,
  type FileEvent,
  type HookInput,
  type SessionInput,
  type Verb,
} from "./lib/types.ts"
import { writeLog } from "./lib/write.ts"

const FILE_TOOLS: Record<string, Verb> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
}
const SHELL_TOOLS = new Set(["Bash", "PowerShell"])
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

function toolEvent(input: HookInput): FileEvent | CmdEvent | null {
  const name = input.tool_name ?? ""
  const args = input.tool_input ?? {}
  const t = new Date().toISOString()
  const verb = FILE_TOOLS[name]
  if (verb) {
    const p = args.file_path ?? args.notebook_path
    return typeof p === "string" && p ? { type: "file", t, tool: name, verb, path: p } : null
  }
  if (SHELL_TOOLS.has(name) && args.command) {
    return {
      type: "cmd",
      t,
      tool: name,
      command: String(args.command),
      description: args.description ? String(args.description) : "",
    }
  }
  return null
}

export function handle(event: string | undefined, input: HookInput, env: Env): void {
  const id = input.session_id
  if (typeof id !== "string" || !SESSION_ID.test(id)) {
    debugLog(env, { level: "SKIP", reason: "missing or unsafe session_id", event })
    return
  }
  const session: SessionInput = { ...input, session_id: id }

  if (event === "start") {
    const ensured = ensureSession(env, session, { source: input.source })
    if (!ensured) return
    const { file, created } = ensured
    if (!created) {
      appendEvent(file, { type: "resume", t: new Date().toISOString(), source: input.source ?? "" })
    }
    pruneOldState(env)
    writeLog(env, file)
    return
  }

  if (event === "tool") {
    const entry = toolEvent(input)
    if (!entry) return
    const file = ensureSession(env, session, { late: true })?.file
    if (!file) return
    appendEvent(file, entry)
    writeLog(env, file)
    debugLog(env, { level: "APPEND", session_id: id, tool: entry.tool })
    return
  }

  if (event === "stop") {
    const file = ensureSession(env, session, { late: true })?.file
    if (!file) return
    appendEvent(file, { type: "stop", t: new Date().toISOString() })
    writeLog(env, file)
    return
  }

  if (event === "end") {
    const file = ensureSession(env, session, { late: true })?.file
    if (!file) return
    const [start] = ofType(readEvents(file), "start")
    appendEvent(file, {
      type: "end",
      t: new Date().toISOString(),
      reason: input.reason ?? "",
      ...(start ? finalStatus(start.root) : { gitStatus: null, gitError: "session details missing" }),
    })
    writeLog(env, file)
    debugLog(env, { level: "END", session_id: id, file: start?.log })
    return
  }

  debugLog(env, { level: "SKIP", reason: `unknown event ${event}`, session_id: id })
}

export function run(argv: string[], env: Env, stdinText: string): void {
  if (env.SESSION_LOGGER_DISABLE === "1") return
  let input: unknown
  try {
    input = JSON.parse(stdinText || "{}")
  } catch {
    debugLog(env, { level: "SKIP", reason: "input is not JSON", event: argv[0] })
    return
  }
  if (!input || typeof input !== "object") return
  const hookInput = input as HookInput
  try {
    handle(argv[0], hookInput, env)
  } catch (err) {
    debugLog(env, {
      level: "ERROR",
      event: argv[0],
      session_id: hookInput.session_id,
      error: String((err as Error | null)?.message ?? err).slice(0, 300),
    })
  }
}
