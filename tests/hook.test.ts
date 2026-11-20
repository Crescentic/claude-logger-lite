import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { Env } from "../scripts/lib/types.ts"

// End-to-end tests: they run the hook the way Claude Code does, through the
// launcher, as a separate process, with JSON on stdin. Pure helpers are unit
// tested in lib.test.ts.
const SCRIPT = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url))

interface Sandbox {
  base: string
  config: string
  project: string
  env: Env
}

function sandbox(): Sandbox {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "session-logger-"))
  const config = path.join(base, "config")
  const project = path.join(base, "project")
  fs.mkdirSync(project)
  const env: Env = { ...process.env, CLAUDE_CONFIG_DIR: config }
  delete env.SESSION_LOGGER_DIR
  delete env.SESSION_LOGGER_DISABLE
  return { base, config, project, env }
}

function hook(
  box: Sandbox,
  event: string,
  input: unknown,
  extraEnv: Env = {},
  nodeArgs: string[] = []
): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [...nodeArgs, SCRIPT, event], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...box.env, ...extraEnv },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, `hook ${event} exited ${result.status}: ${result.stderr}`)
  assert.equal(result.stdout, "", "hooks must print nothing")
  return result
}

function hookAsync(box: Sandbox, event: string, input: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, event], { env: box.env })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
    child.stdin.end(JSON.stringify(input))
  })
}

function logs(box: Sandbox, dir = path.join(box.project, "docs", "sessions", "logs")): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
}

function section(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}`)
  const next = md.indexOf("\n## ", start + 1)
  return md.slice(start, next === -1 ? undefined : next)
}

const ID = "abcd1234-0000-4000-8000-000000000001"
const HAS_GIT = spawnSync("git", ["--version"]).status === 0

function eventFile(box: Sandbox): string {
  return path.join(box.config, "session-logger", "sessions", `${ID}.jsonl`)
}

function bash(box: Sandbox, command: string, cwd = box.project): object {
  return { session_id: ID, cwd, tool_name: "Bash", tool_input: { command } }
}

test("a full session lands each entry in its own section", () => {
  const box = sandbox()
  const base = { session_id: ID, cwd: box.project }
  hook(box, "start", { ...base, source: "startup" })
  hook(box, "tool", {
    ...base,
    tool_name: "Read",
    tool_input: { file_path: path.join(box.project, "package.json") },
  })
  hook(box, "tool", {
    ...base,
    tool_name: "Bash",
    tool_input: { command: "npm test", description: "Run the tests" },
  })
  hook(box, "tool", {
    ...base,
    tool_name: "Edit",
    tool_input: { file_path: path.join(box.project, "src", "a.ts") },
  })
  hook(box, "end", { ...base, reason: "prompt_input_exit" })

  const [md, ...rest] = logs(box)
  assert.ok(md)
  assert.equal(rest.length, 0)
  assert.match(md, new RegExp(`^---\\nsession_id: "${ID}"\\n`))
  assert.match(md, /^ended: "\d{4}-/m)

  const files = section(md, "Files Touched")
  assert.match(files, /read `package\.json`/)
  assert.match(files, new RegExp(`edit \`src[\\\\/]a\\.ts\``))
  assert.doesNotMatch(files, /npm test/)

  const commands = section(md, "Commands Run")
  assert.match(commands, /`npm test` — Run the tests/)

  assert.match(section(md, "Session End"), /\*\*Ended:\*\* .* \(prompt_input_exit\)/)
})

test("a session first seen mid-way still gets a log", () => {
  const box = sandbox()
  hook(box, "tool", {
    session_id: ID,
    cwd: box.project,
    tool_name: "Bash",
    tool_input: { command: "ls" },
  })
  const [md] = logs(box)
  assert.ok(md, "log was created without a SessionStart")
  assert.match(md, /logging began mid-session/)
  assert.match(md, /_Not ended yet\. Last activity: /)
})

test("a second SessionStart (compact, resume) reuses the same log", () => {
  const box = sandbox()
  const base = { session_id: ID, cwd: box.project }
  hook(box, "start", { ...base, source: "startup" })
  hook(box, "start", { ...base, source: "compact" })
  const all = logs(box)
  assert.equal(all.length, 1)
  assert.match(all[0] ?? "", /\*\*Restarted:\*\* .* \(compact\)/)
})

test("parallel tool hooks all make it into the log", async () => {
  const box = sandbox()
  const base = { session_id: ID, cwd: box.project }
  hook(box, "start", base)
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      hookAsync(box, "tool", {
        ...base,
        tool_name: "Bash",
        tool_input: { command: `echo run-${i}` },
      })
    )
  )
  hook(box, "stop", base)
  const [md = ""] = logs(box)
  for (let i = 0; i < 8; i++) assert.match(md, new RegExp(`echo run-${i}`))
})

test("the hook never fails the session, whatever it is given", () => {
  const box = sandbox()
  hook(box, "tool", "not json")
  hook(box, "tool", "")
  hook(box, "tool", "null")
  hook(box, "start", { cwd: box.project })
  hook(box, "start", { session_id: "../../escape", cwd: box.project })
  hook(box, "nonsense", { session_id: ID, cwd: box.project })
  hook(box, "tool", { session_id: ID, cwd: box.project, tool_name: "Bash" })
  hook(box, "start", { session_id: ID, cwd: path.join(box.base, "missing") })
  assert.equal(fs.existsSync(path.join(box.base, "escape.jsonl")), false)
})

// ---------- git status at the end ----------

test("outside a git repository, the final status says so instead of 'clean'", () => {
  const box = sandbox()
  hook(box, "start", { session_id: ID, cwd: box.project })
  hook(box, "end", { session_id: ID, cwd: box.project })
  const [md = ""] = logs(box)
  assert.match(md, /\*\*Final git status:\*\* unavailable \(not a git repository\)/)
  assert.doesNotMatch(md, /clean/)
})

test("when git isn't installed, the final status says so", () => {
  const box = sandbox()
  for (const key of Object.keys(box.env)) if (key.toUpperCase() === "PATH") delete box.env[key]
  box.env.PATH = fs.mkdtempSync(path.join(box.base, "empty-path-"))
  hook(box, "start", { session_id: ID, cwd: box.project })
  hook(box, "end", { session_id: ID, cwd: box.project })
  const [md = ""] = logs(box)
  assert.match(md, /unavailable \(git was not found\)/)
})

test("a clean repository is reported as clean", { skip: !HAS_GIT && "git not installed" }, () => {
  const box = sandbox()
  spawnSync("git", ["init", "-q"], { cwd: box.project })
  hook(box, "start", { session_id: ID, cwd: box.project })
  hook(box, "end", { session_id: ID, cwd: box.project })
  const [md = ""] = logs(box)
  assert.match(md, /\*\*Final git status:\*\*\n```\nclean\n```/)
})

const GITIGNORE_OFF = { SESSION_LOGGER_GITIGNORE: "0" }

/** The fenced block under **Final git status:** in a log. */
function statusBlock(md: string): string {
  return /\*\*Final git status:\*\*\n```\n([\s\S]*?)\n```/.exec(md)?.[1] ?? ""
}

function committedProject(box: Sandbox): void {
  spawnSync("git", ["init", "-q"], { cwd: box.project })
  fs.writeFileSync(path.join(box.project, "tracked.txt"), "one\n")
  spawnSync("git", ["add", "."], { cwd: box.project })
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"], {
    cwd: box.project,
  })
}

test("with the gitignore off, the session's own log stays out of the final status", { skip: !HAS_GIT && "git not installed" }, () => {
  const box = sandbox()
  committedProject(box)
  hook(box, "start", { session_id: ID, cwd: box.project }, GITIGNORE_OFF)
  fs.writeFileSync(path.join(box.project, "tracked.txt"), "two\n")
  hook(box, "end", { session_id: ID, cwd: box.project }, GITIGNORE_OFF)
  const [md = ""] = logs(box)
  const status = statusBlock(md)
  assert.match(status, /tracked\.txt/, "real changes are still reported")
  assert.doesNotMatch(status, /docs\/sessions\/logs/, "the log's own line must be filtered out")
})

test("with the gitignore off, a log that is the only change still reads clean", { skip: !HAS_GIT && "git not installed" }, () => {
  const box = sandbox()
  committedProject(box)
  hook(box, "start", { session_id: ID, cwd: box.project }, GITIGNORE_OFF)
  hook(box, "end", { session_id: ID, cwd: box.project }, GITIGNORE_OFF)
  const [md = ""] = logs(box)
  assert.match(md, /\*\*Final git status:\*\*\n```\nclean\n```/)
})

test("a log in a custom folder inside the project stays out of the final status", { skip: !HAS_GIT && "git not installed" }, () => {
  const box = sandbox()
  committedProject(box)
  const env = { ...GITIGNORE_OFF, SESSION_LOGGER_DIR: "notes/claude" }
  hook(box, "start", { session_id: ID, cwd: box.project }, env)
  fs.writeFileSync(path.join(box.project, "tracked.txt"), "two\n")
  hook(box, "end", { session_id: ID, cwd: box.project }, env)
  const [md = ""] = logs(box, path.join(box.project, "notes", "claude"))
  const status = statusBlock(md)
  assert.match(status, /tracked\.txt/, "real changes are still reported")
  assert.doesNotMatch(status, /notes\/claude/, "the log's own line must be filtered out")
})

// ---------- recovering the event file ----------

test("a session whose event file is gone keeps its log and its entries", () => {
  const box = sandbox()
  hook(box, "start", { session_id: ID, cwd: box.project })
  hook(box, "tool", bash(box, "echo before"))
  const [before = ""] = logs(box)
  const started = /^started: (.*)$/m.exec(before)?.[1]

  // As if it expired after 30 idle days, or CLAUDE_CONFIG_DIR changed.
  fs.rmSync(eventFile(box))
  hook(box, "tool", bash(box, "echo after"))

  const all = logs(box)
  assert.equal(all.length, 1, "no second log")
  const md = all[0] ?? ""
  assert.match(section(md, "Commands Run"), /echo before[\s\S]*echo after/)
  assert.match(md, /\*\*Continued:\*\* /)
  assert.equal(/^started: (.*)$/m.exec(md)?.[1], started, "start time kept")
})

test("a damaged event file is rebuilt with the events that can still be read", () => {
  const box = sandbox()
  const file = eventFile(box)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const salvaged = { type: "cmd", t: "2026-11-13T07:15:00.000Z", tool: "Bash", command: "echo salvaged", description: "" }
  fs.writeFileSync(file, '{"type":"sta\n' + JSON.stringify(salvaged) + "\n")
  const old = new Date(Date.now() - 60_000)
  fs.utimesSync(file, old, old)

  hook(box, "tool", bash(box, "echo new"))

  const [md = ""] = logs(box)
  assert.match(section(md, "Commands Run"), /echo salvaged[\s\S]*echo new/)
  assert.match(md, /logging began mid-session/)
})

// ---------- never creating folders that don't exist ----------

test("a session in a folder that doesn't exist creates nothing", () => {
  const box = sandbox()
  const missing = path.join(box.base, "missing")
  hook(box, "start", { session_id: ID, cwd: missing })
  hook(box, "tool", bash(box, "ls", missing))
  assert.equal(fs.existsSync(missing), false)
  assert.equal(fs.existsSync(eventFile(box)), false)
})

test("a project deleted mid-session isn't recreated by the log", () => {
  const box = sandbox()
  hook(box, "start", { session_id: ID, cwd: box.project })
  fs.rmSync(box.project, { recursive: true, force: true })
  hook(box, "tool", bash(box, "ls"))
  hook(box, "end", { session_id: ID, cwd: box.project })
  assert.equal(fs.existsSync(box.project), false)
})

test("on a Node that can't run TypeScript, the hook exits 0 and says why", () => {
  const box = sandbox()
  hook(box, "start", { session_id: ID, cwd: box.project }, {}, ["--no-experimental-strip-types"])
  assert.deepEqual(logs(box), [])
  const dir = path.join(box.config, "hooks-logs")
  const debug = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("")
  assert.match(debug, /"level":"ERROR".*needs Node 22\.18 or later/)
})

test("tools it doesn't track leave nothing behind", () => {
  const box = sandbox()
  hook(box, "tool", {
    session_id: ID,
    cwd: box.project,
    tool_name: "Grep",
    tool_input: { pattern: "x" },
  })
  assert.deepEqual(logs(box), [])
})

test("SESSION_LOGGER_DIR moves the logs, and they ignore themselves in git", () => {
  const box = sandbox()
  const env = { SESSION_LOGGER_DIR: "notes/claude" }
  hook(box, "start", { session_id: ID, cwd: box.project }, env)
  const dir = path.join(box.project, "notes", "claude")
  assert.equal(logs(box, dir).length, 1)
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "*\n")
})

test("SESSION_LOGGER_DISABLE=1 writes nothing", () => {
  const box = sandbox()
  hook(box, "start", { session_id: ID, cwd: box.project }, { SESSION_LOGGER_DISABLE: "1" })
  assert.deepEqual(logs(box), [])
  assert.equal(fs.existsSync(box.config), false)
})
