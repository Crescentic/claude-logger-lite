// Shapes of the data session-logger handles: the hook input from Claude Code,
// and the events it stores for each session, plus two helpers for narrowing
// them.

export type Env = Record<string, string | undefined>

/** The JSON Claude Code sends a hook on stdin (only the fields we use). */
export interface HookInput {
  session_id?: unknown
  cwd?: string
  source?: string
  reason?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
}

/** Hook input whose `session_id` has been checked. */
export interface SessionInput extends HookInput {
  session_id: string
}

export type Verb = "read" | "write" | "edit"

export interface StartEvent {
  type: "start"
  t: string
  sessionId: string
  cwd: string
  root: string
  repo: string
  branch: string
  source: string
  late: boolean
  /** Absolute path of the Markdown log. */
  log: string
  /** Entries kept from an existing log when the event file had to be recreated. */
  carried?: CarriedEntries
}

/**
 * Lines taken verbatim from an existing log, for when a session's event file
 * is gone (expired after 30 idle days, or a different CLAUDE_CONFIG_DIR) but
 * its log is still there.
 */
export interface CarriedEntries {
  /** When the event file was recreated. */
  at: string
  files: string[]
  commands: string[]
}

export interface FileEvent {
  type: "file"
  t: string
  tool: string
  verb: Verb
  path: string
}

export interface CmdEvent {
  type: "cmd"
  t: string
  tool: string
  command: string
  description: string
}

export interface ResumeEvent {
  type: "resume"
  t: string
  source: string
}

export interface StopEvent {
  type: "stop"
  t: string
}

export interface EndEvent {
  type: "end"
  t: string
  reason: string
  /** `git status --short`: "" when clean, `null` when it couldn't be read. */
  gitStatus: string | null
  /** Why `gitStatus` is null. */
  gitError?: string
}

export type SessionEvent = StartEvent | FileEvent | CmdEvent | ResumeEvent | StopEvent | EndEvent

/** The events of one kind, typed as that kind. */
export function ofType<K extends SessionEvent["type"]>(
  events: SessionEvent[],
  type: K
): Extract<SessionEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SessionEvent, { type: K }> => e.type === type)
}

/** The `code` of a Node.js system error (such as `EEXIST`), if it has one. */
export function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}
