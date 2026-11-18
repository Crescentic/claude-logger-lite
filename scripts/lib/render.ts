// Turns a session's events into the Markdown log. Pure: no file system, no
// clock, so it can be unit tested directly.

import path from "node:path"
import { ofType, type SessionEvent } from "./types.ts"

/** Wraps text in a Markdown code span that survives backticks inside it. */
export function codeSpan(text: string): string {
  const runs = String(text).match(/`+/g) ?? []
  const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1)
  const pad = /^`|`$/.test(text) ? " " : ""
  return `${fence}${pad}${text}${pad}${fence}`
}

// Front matter values are always double-quoted. A JSON string is a valid YAML
// double-quoted scalar, so branch names like `#12-fix` or paths holding `: `
// can't be misread as comments or mappings.
export function yamlString(value: unknown): string {
  return JSON.stringify(String(value ?? ""))
}

/** Flattens newlines to ` ⏎ ` and cuts the text to `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = String(text).replace(/\r?\n/g, " ⏎ ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function clock(iso: string): string {
  return iso.slice(11, 19)
}

function displayPath(root: string, p: string): string {
  if (!p) return ""
  const rel = path.relative(root, path.resolve(root, p))
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p
}

export function render(events: SessionEvent[], { maxCommand = 500 } = {}): string {
  const [start] = ofType(events, "start")
  if (!start) return ""
  const end = ofType(events, "end").at(-1)
  const last = events.at(-1) ?? start
  const files = ofType(events, "file")
  const commands = ofType(events, "cmd")
  const resumes = ofType(events, "resume")
  const project = path.basename(start.root)
  const repoLine = start.repo
    ? `${start.repo}${start.branch ? ` (${start.branch})` : ""}`
    : start.branch || "not a git repository"

  const out = [
    "---",
    `session_id: ${yamlString(start.sessionId)}`,
    `cwd: ${yamlString(start.cwd)}`,
    `git_repo: ${yamlString(start.repo)}`,
    `git_branch: ${yamlString(start.branch)}`,
    `started: ${yamlString(start.t)}`,
    `ended: ${yamlString(end ? end.t : "")}`,
    `last_activity: ${yamlString(last.t)}`,
    "---",
    "",
    `# Claude Code Session: ${project}`,
    "",
    `**Started:** ${start.t}${start.late ? " (logging began mid-session)" : ""}`,
    `**Working dir:** ${codeSpan(start.cwd)}`,
    `**Repo:** ${repoLine}`,
  ]
  if (resumes.length) {
    const list = resumes.map((e) => `${e.t}${e.source ? ` (${e.source})` : ""}`)
    out.push(`**Restarted:** ${list.join(", ")}`)
  }
  const carried = start.carried
  if (carried) {
    out.push(`**Continued:** ${carried.at} (earlier entries kept from this log)`)
  }

  out.push("", "## Files Touched")
  out.push(...(carried?.files ?? []))
  for (const e of files) {
    out.push(`- \`${clock(e.t)}\` ${e.verb} ${codeSpan(displayPath(start.root, e.path))}`)
  }

  out.push("", "## Commands Run")
  out.push(...(carried?.commands ?? []))
  for (const e of commands) {
    const desc = e.description ? ` — ${oneLine(e.description, 200)}` : ""
    const tool = e.tool === "Bash" ? "" : ` (${e.tool})`
    out.push(
      `- \`${clock(e.t)}\`${tool} ${codeSpan(oneLine(e.command, maxCommand))}${desc}`
    )
  }

  out.push("", "## Session End", "")
  if (end) {
    out.push(`**Ended:** ${end.t}${end.reason ? ` (${end.reason})` : ""}`, "")
    if (end.gitStatus === null) {
      out.push(`**Final git status:** unavailable (${end.gitError || "unknown reason"})`)
    } else {
      out.push("**Final git status:**", "```", end.gitStatus || "clean", "```")
    }
  } else {
    out.push(`_Not ended yet. Last activity: ${last.t}_`)
  }
  return out.join("\n") + "\n"
}

/** What `parseLog` can recover from a log that `render` wrote. */
export interface ParsedLog {
  sessionId: string
  started: string
  late: boolean
  files: string[]
  commands: string[]
}

function frontMatterValue(md: string, key: string): string {
  const end = md.startsWith("---\n") ? md.indexOf("\n---", 3) : -1
  if (end === -1) return ""
  const match = new RegExp(`^${key}: (.*)$`, "m").exec(md.slice(0, end))
  const raw = match?.[1]?.trim() ?? ""
  if (!raw.startsWith('"')) return raw // Logs from before values were quoted.
  try {
    return String(JSON.parse(raw))
  } catch {
    return ""
  }
}

function sectionEntries(md: string, heading: string): string[] {
  const start = md.indexOf(`\n## ${heading}\n`)
  if (start === -1) return []
  const next = md.indexOf("\n## ", start + 1)
  return md
    .slice(start, next === -1 ? undefined : next)
    .split("\n")
    .filter((line) => line.startsWith("- "))
}

/** Reads back a log's session details and entry lines. Lines are kept verbatim. */
export function parseLog(md: string): ParsedLog {
  return {
    sessionId: frontMatterValue(md, "session_id"),
    started: frontMatterValue(md, "started"),
    late: md.includes("(logging began mid-session)"),
    files: sectionEntries(md, "Files Touched"),
    commands: sectionEntries(md, "Commands Run"),
  }
}
