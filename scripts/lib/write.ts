// Rebuilds a session's Markdown log from its event file, under a lock.

import fs from "node:fs"
import path from "node:path"
import { isInside, withLock, writeFileAtomic } from "./files.ts"
import { debugLog } from "./paths.ts"
import { render } from "./render.ts"
import { ensureGitignore, readEvents } from "./store.ts"
import { ofType, type Env } from "./types.ts"

/** Renders the events in `file` to the session's Markdown log. */
export function writeLog(env: Env, file: string): void {
  withLock(file, () => {
    const events = readEvents(file)
    const [start] = ofType(events, "start")
    if (!start) return
    // If the project was deleted or moved mid-session, don't recreate its
    // folders just to hold the log.
    if (isInside(start.root, start.log) && !fs.existsSync(start.root)) {
      debugLog(env, { level: "SKIP", reason: "project folder no longer exists", session_id: start.sessionId })
      return
    }
    const maxCommand = Number(env.SESSION_LOGGER_MAX_COMMAND) || 500
    const dir = path.dirname(start.log)
    fs.mkdirSync(dir, { recursive: true })
    ensureGitignore(env, dir)
    writeFileAtomic(start.log, render(events, { maxCommand }))
  })
}
