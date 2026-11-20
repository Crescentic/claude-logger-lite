# Security policy

session-logger writes the shell commands Claude runs to disk, and a command can
contain a token or password. We treat anything that leaks those logs, or writes
them somewhere the user didn't expect, as a security issue.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository.

Include what you did, what you expected, what happened, and your OS, Node.js
and Claude Code versions. We aim to reply within 7 days and will credit you in
the release notes unless you'd rather we didn't.

## Supported versions

Only the latest release gets fixes.

## In scope

- Logs or event files written outside the configured locations
- Logs escaping the self-`.gitignore` when `SESSION_LOGGER_GITIGNORE` is unset
- Path traversal through hook input (for example a crafted `session_id`)
- Anything that lets hook input run code

## Out of scope

- Secrets that appear in a log because Claude ran a command containing them.
  That is documented behaviour; the log folder ignores itself in git by default.
  The same goes for the event files in `~/.claude/session-logger/sessions/`,
  which keep the full command for 30 days after the session's last activity,
  whatever `SESSION_LOGGER_MAX_COMMAND` is set to. Delete a session's `.jsonl`
  file there to remove it sooner. Masking secrets is tracked in
  [#2](https://github.com/Crescentic/claude-logger-lite/issues/2).
