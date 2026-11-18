// File system helpers shared by the event store and the log writer.

import fs from "node:fs"
import path from "node:path"
import { errorCode } from "./types.ts"

const LOCK_STALE_MS = 10_000
const LOCK_WAIT_MS = 3_000

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** True if `child` is `parent` or somewhere inside it. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

// Parallel tool calls fire hooks at once; a directory lock keeps one write
// from overwriting a newer one. If the lock can't be had, run anyway.
export function withLock<T>(target: string, fn: () => T): T {
  const lock = `${target}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  let held = false
  while (!held && Date.now() < deadline) {
    try {
      fs.mkdirSync(lock)
      held = true
    } catch (err) {
      if (errorCode(err) !== "EEXIST") break
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }
      sleep(25)
    }
  }
  try {
    return fn()
  } finally {
    if (held) fs.rmSync(lock, { recursive: true, force: true })
  }
}

/** Writes through a temp file and a rename, so readers never see half a file. */
export function writeFileAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  try {
    fs.renameSync(tmp, file)
  } catch {
    // Windows refuses the rename while an editor holds the file open.
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(file, text)
  }
}
