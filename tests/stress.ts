import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

// Opt-in stress test for parallel appends to the event file (run it with
// `npm run stress`). It is not named *.test.ts on purpose, so `npm test` and
// CI skip it: it spawns hundreds of processes. It checks that every line of
// the event file parses and that every command made it into the log.
//
//   SESSION_LOGGER_STRESS_HOOKS   parallel hooks per round (default 50)
//   SESSION_LOGGER_STRESS_ROUNDS  rounds (default 5)
const SCRIPT = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url))
const HOOKS = Number(process.env.SESSION_LOGGER_STRESS_HOOKS) || 50
const ROUNDS = Number(process.env.SESSION_LOGGER_STRESS_ROUNDS) || 5
const ID = "11111111-2222-3333-4444-555555555555"

function run(env: NodeJS.ProcessEnv, event: string, input: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, event], { env })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
    child.stdin.end(JSON.stringify(input))
  })
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "session-logger-stress-"))
const config = path.join(base, "config")
const project = path.join(base, "project")
fs.mkdirSync(project)
const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: config }
delete env.SESSION_LOGGER_DIR
delete env.SESSION_LOGGER_DISABLE

try {
  const eventFile = path.join(config, "session-logger", "sessions", `${ID}.jsonl`)
  const input = { session_id: ID, cwd: project }
  await run(env, "start", input)
  const started = Date.now()
  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(
      Array.from({ length: HOOKS }, (_, i) =>
        run(env, "tool", {
          ...input,
          tool_name: "Bash",
          tool_input: { command: `echo r${round}-h${i}` },
        })
      )
    )
  }
  const elapsed = Date.now() - started

  const lines = fs.readFileSync(eventFile, "utf8").split("\n").filter((l) => l.trim())
  let torn = 0
  const seen = new Set<string>()
  for (const line of lines) {
    try {
      seen.add(JSON.stringify(JSON.parse(line)))
    } catch {
      torn++
    }
  }
  assert.equal(torn, 0, `${torn} line(s) in the event file are not valid JSON`)

  const text = lines.join("\n")
  const missing: string[] = []
  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i < HOOKS; i++) {
      // Trailing quote: "echo r1-h1" must not match "echo r1-h10".
      if (!text.includes(`echo r${round}-h${i}"`)) missing.push(`r${round}-h${i}`)
    }
  }
  assert.equal(missing.length, 0, `missing from the event file: ${missing.join(", ")}`)

  console.log(
    `ok: ${ROUNDS} rounds x ${HOOKS} parallel hooks, ${lines.length} lines, none torn, none missing (${elapsed} ms)`
  )
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
