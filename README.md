# session-logger

[![CI](https://github.com/Crescentic/claude-logger-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Crescentic/claude-logger-lite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Claude Code plugin that keeps a Markdown log of each session in the project it
ran in: which files Claude read or changed, which shell commands it ran, and
the git status when the session ended. One file per session, written as the
session goes, so a crashed or still-running session still has a log.

Use it to:

- **Review what an agent did** before you commit, especially after a long or
  unattended session.
- **Keep an audit trail** of the commands run in a repository.
- **Hand work over**: attach a session log to a pull request so reviewers see
  how a change was made.

No dependencies, no network calls, no prompts or replies recorded.

```
docs/sessions/logs/2026-11-13_0714_de810c3a.md
```

~~~markdown
---
session_id: "de810c3a-05d0-453e-ad4b-df24433d92b4"
cwd: "D:\\work\\my-app"
git_repo: "acme/my-app"
git_branch: "feat/login"
started: "2026-11-13T07:14:25.937Z"
ended: "2026-11-13T07:31:02.118Z"
last_activity: "2026-11-13T07:31:02.118Z"
---

# Claude Code Session: my-app

## Files Touched
- `07:14:30` read `package.json`
- `07:16:12` edit `src/login.ts`

## Commands Run
- `07:17:40` `npm test` — Run the tests

## Session End

**Ended:** 2026-11-13T07:31:02.118Z (prompt_input_exit)

**Final git status:**
```
 M src/login.ts
```
~~~

Times are UTC.

## Install

Needs Node.js 22.18 or later on your `PATH`. The plugin is written in
TypeScript, and Node runs it directly, so there's nothing to install or build.
On an older Node the plugin does nothing and writes the reason to its debug log
(see below).

Inside Claude Code:

```
/plugin marketplace add Crescentic/claude-logger-lite
/plugin install session-logger@session-logger
```

Or from a shell:

```
claude plugin marketplace add Crescentic/claude-logger-lite
claude plugin install session-logger@session-logger
```

You'll be asked to pick a scope. User scope logs every project you open;
project scope logs only that project, and is written to the project's
`.claude/settings.json` so teammates get it too.

To install from a local clone instead, pass its path to
`marketplace add` in place of `Crescentic/claude-logger-lite`.

## Settings

Set these as environment variables, or in the `env` block of
`~/.claude/settings.json` (or a project's `.claude/settings.json`).

| Variable | Default | What it does |
| --- | --- | --- |
| `SESSION_LOGGER_DIR` | `docs/sessions/logs` | Where logs go. Relative paths are from the git root (or the working directory outside git). |
| `SESSION_LOGGER_GITIGNORE` | on | The log folder gets a `.gitignore` holding `*`, so logs stay out of commits. Set to `0` to commit them. |
| `SESSION_LOGGER_MAX_COMMAND` | `500` | Longest command text kept, in characters. |
| `SESSION_LOGGER_DISABLE` | off | Set to `1` to turn logging off. |

## What it records, and what it doesn't

- **Files:** `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`. Paths inside
  the project are shown relative to its root.
- **Commands:** `Bash` and `PowerShell`, with Claude's description of each.
- **Not recorded:** your prompts, Claude's replies, tool output, searches
  (`Grep`, `Glob`), web fetches, MCP tools, or tool calls that failed.

Commands are written as Claude ran them, so a token pasted into a command lands
in the log. That is why the log folder ignores itself in git by default.

## How it works

Four hooks call `scripts/hook.mjs`, which loads `scripts/logger.ts`: `SessionStart`, `PostToolUse` (for the
tools above), `Stop` (after each reply, to update `last_activity`) and
`SessionEnd`. Each event is appended to a small file in
`~/.claude/session-logger/sessions/`, and the Markdown log is rebuilt from
it, so hooks that fire at once (parallel tool calls) don't lose entries. Those
event files are deleted after 30 days.

- A session that started before the plugin was installed gets a log from its
  first tracked tool call, marked "logging began mid-session".
- When a session that already has a log starts again under the same session
  id (after `/compact`, for example), it keeps writing to that log, and the
  restart is listed under **Restarted**. A command that starts a new session
  id starts a new log.
- If a session's event file is gone but its log isn't (it was idle for more
  than 30 days and then resumed, or `CLAUDE_CONFIG_DIR` changed), it keeps
  writing to the same log. Earlier entries are kept, and the point where it
  picked up is listed under **Continued**.
- A session that never ended cleanly shows "Not ended yet" and its last
  activity.
- **Final git status** is `clean` only when git confirmed it. If it couldn't
  be read, the log says why: not a git repository, git not found, timed out,
  or the project folder no longer exists.
- Nothing is logged for a session whose working folder doesn't exist, and the
  plugin never creates a project folder just to hold a log.
- The hook never fails or slows a session on purpose: errors are swallowed,
  and it always exits 0. Problems go to
  `~/.claude/hooks-logs/<date>.jsonl` (`level: "ERROR"` or `"SKIP"`).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
ground rules, and look for issues labelled **good first issue**. Please report
security problems privately, as described in [SECURITY.md](SECURITY.md).

```
npm install                                    # TypeScript, for type checking only
npm run check                                  # type check, then node --test
claude --plugin-dir /path/to/claude-logger-lite    # try it in one session
claude plugin validate /path/to/claude-logger-lite
```

## License

[MIT](LICENSE)
