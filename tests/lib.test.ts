// Unit tests for the pure helpers in scripts/lib. They run in-process, so
// they're fast; behaviour across a whole session is tested in hook.test.ts.

import { test } from "node:test"
import assert from "node:assert/strict"
import { repoName } from "../scripts/lib/git.ts"
import { logFileName } from "../scripts/lib/paths.ts"
import { codeSpan, oneLine, parseLog, render, yamlString } from "../scripts/lib/render.ts"
import type { SessionEvent, StartEvent } from "../scripts/lib/types.ts"

const ID = "abcd1234-0000-4000-8000-000000000001"
const T = "2026-11-13T07:14:25.937Z"

function startEvent(overrides: Partial<StartEvent> = {}): StartEvent {
  return {
    type: "start",
    t: T,
    sessionId: ID,
    cwd: "/work/app",
    root: "/work/app",
    repo: "acme/app",
    branch: "main",
    source: "",
    late: false,
    log: "",
    ...overrides,
  }
}

test("paths: logFileName uses the UTC start minute and a short session id", () => {
  assert.equal(logFileName(T, ID), "2026-11-13_0714_abcd1234.md")
})

test("git: repoName reads SSH and HTTPS remotes", () => {
  assert.equal(repoName("git@github.com:playground/App.git"), "playground/App")
  assert.equal(repoName("https://github.com/playground/App"), "playground/App")
  assert.equal(repoName(""), "")
})

test("render: codeSpan survives backticks", () => {
  assert.equal(codeSpan("ls"), "`ls`")
  assert.equal(codeSpan("echo `date`"), "`` echo `date` ``")
  assert.equal(codeSpan("a``b"), "```a``b```")
})

test("render: oneLine flattens newlines and truncates", () => {
  assert.equal(oneLine("a\nb", 100), "a ⏎ b")
  assert.equal(oneLine("abcdef", 4), "abc…")
})

test("render: yamlString always double-quotes", () => {
  assert.equal(yamlString("#12-fix"), '"#12-fix"')
  assert.equal(yamlString("C:\\work\\a: b"), '"C:\\\\work\\\\a: b"')
  assert.equal(yamlString(undefined), '""')
})

test("render: nothing to render without a start event", () => {
  assert.equal(render([]), "")
})

test("render: front matter quotes values YAML would otherwise misread", () => {
  const md = render([startEvent({ cwd: "/work/a: b", root: "/work/a: b", branch: "#12-fix" })])
  assert.match(md, /^git_branch: "#12-fix"$/m)
  assert.match(md, /^cwd: "\/work\/a: b"$/m)
  assert.match(md, /^ended: ""$/m)
})

test("render: commands from other shells name the tool, long ones are cut", () => {
  const events: SessionEvent[] = [
    startEvent(),
    { type: "cmd", t: T, tool: "PowerShell", command: "Get-ChildItem", description: "" },
    { type: "cmd", t: T, tool: "Bash", command: "x".repeat(50), description: "" },
  ]
  const md = render(events, { maxCommand: 20 })
  assert.match(md, /\(PowerShell\) `Get-ChildItem`/)
  assert.match(md, /`x{19}…`/)
})

test("render: an unreadable git status says why, an empty one says clean", () => {
  const end = { type: "end", t: T, reason: "" } as const
  const unavailable = render([startEvent(), { ...end, gitStatus: null, gitError: "git was not found" }])
  assert.match(unavailable, /\*\*Final git status:\*\* unavailable \(git was not found\)/)
  const clean = render([startEvent(), { ...end, gitStatus: "" }])
  assert.match(clean, /```\nclean\n```/)
})

test("render: carried entries come before new ones", () => {
  const md = render([
    startEvent({ carried: { at: T, files: ["- `07:00:00` read `old.ts`"], commands: ["- `07:00:01` `echo old`"] } }),
    { type: "cmd", t: T, tool: "Bash", command: "echo new", description: "" },
  ])
  assert.match(md, /\*\*Continued:\*\* /)
  assert.match(md, /read `old\.ts`/)
  assert.match(md, /`echo old`\n- `07:14:25` `echo new`/)
})

test("parseLog: reads back what render wrote", () => {
  const md = render([
    startEvent({ late: true }),
    { type: "file", t: T, tool: "Read", verb: "read", path: "/work/app/a.ts" },
    { type: "cmd", t: T, tool: "Bash", command: "npm test", description: "" },
  ])
  const parsed = parseLog(md)
  assert.equal(parsed.sessionId, ID)
  assert.equal(parsed.started, T)
  assert.equal(parsed.late, true)
  assert.deepEqual(parsed.files, ["- `07:14:25` read `a.ts`"])
  assert.deepEqual(parsed.commands, ["- `07:14:25` `npm test`"])
})

test("parseLog: reads logs from before front matter was quoted", () => {
  const md = `---\nsession_id: ${ID}\nstarted: ${T}\n---\n\n## Files Touched\n\n## Commands Run\n- \`07:00:00\` \`ls\`\n`
  const parsed = parseLog(md)
  assert.equal(parsed.sessionId, ID)
  assert.equal(parsed.started, T)
  assert.deepEqual(parsed.commands, ["- `07:00:00` `ls`"])
  assert.equal(parseLog("no front matter").sessionId, "")
})
