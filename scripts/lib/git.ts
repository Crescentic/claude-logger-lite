// Reading the project's git details. Nothing here throws: outside a
// repository, or without git installed, lookups come back empty and the final
// status says why it couldn't be read.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const GIT_TIMEOUT_MS = 5000

export type GitResult =
  | { ok: true; out: string }
  | { ok: false; reason: "missing" | "timeout" | "failed" }

export function runGit(cwd: string, args: string[]): GitResult {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    })
    return { ok: true, out: out.trimEnd() }
  } catch (err) {
    const e = err as (NodeJS.ErrnoException & { signal?: string | null }) | null
    // A missing cwd also reports ENOENT; callers check the folder first.
    if (e?.code === "ENOENT") return { ok: false, reason: "missing" }
    if (e?.code === "ETIMEDOUT" || e?.signal === "SIGTERM") return { ok: false, reason: "timeout" }
    return { ok: false, reason: "failed" }
  }
}

/** Git output, or "" if git couldn't answer. */
export function git(cwd: string, args: string[]): string {
  const result = runGit(cwd, args)
  return result.ok ? result.out : ""
}

/** `owner/repo` from an SSH or HTTPS remote URL. */
export function repoName(remoteUrl: string): string {
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())
  return match?.[1] ?? ""
}

export function projectInfo(cwd: string): { root: string; repo: string; branch: string } {
  const top = git(cwd, ["rev-parse", "--show-toplevel"])
  return {
    root: path.resolve(top || cwd),
    repo: repoName(git(cwd, ["remote", "get-url", "origin"])),
    branch:
      git(cwd, ["branch", "--show-current"]) ||
      git(cwd, ["rev-parse", "--short", "HEAD"]),
  }
}

export type FinalStatus = { gitStatus: string } | { gitStatus: null; gitError: string }

/** Path of `file` relative to `root` in git's notation, or null when outside. */
function relativeInside(root: string, file: string): string | null {
  const rel = path.relative(root, file)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

/**
 * `git status --short` at the end of a session. An empty string means clean;
 * `null` means it couldn't be read, with the reason in `gitError`.
 * `exclude` is a file (the session's own log) left out of the listing, so it
 * doesn't show up as noise when the log folder doesn't ignore itself.
 */
export function finalStatus(root: string, exclude?: string): FinalStatus {
  if (!fs.existsSync(root)) return { gitStatus: null, gitError: "the project folder no longer exists" }
  const args = ["status", "--short"]
  const rel = exclude ? relativeInside(root, exclude) : null
  if (rel) args.push("--", ".", `:(exclude)${rel}`)
  const status = runGit(root, args)
  if (status.ok) return { gitStatus: status.out }
  if (status.reason === "missing") return { gitStatus: null, gitError: "git was not found" }
  if (status.reason === "timeout") return { gitStatus: null, gitError: "git status timed out" }
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"])
  return { gitStatus: null, gitError: inside.ok ? "git status failed" : "not a git repository" }
}
