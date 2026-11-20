# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Claude Code uses the `version` in `.claude-plugin/plugin.json` to decide when
installed copies need updating, so every release bumps it there and in
`package.json`.

## [Unreleased]

### Added

- Opt-in stress test for parallel appends to the event file (`npm run stress`,
  or the manual **Stress test** workflow to run it on Windows, macOS and Linux).

## [0.2.0] - 2026-11-20

First public release.

### Changed

- **Breaking:** requires Node.js 22.18 or later (was 20). The plugin is now
  written in TypeScript, which Node runs directly, so users still install and
  build nothing. On an older Node the hooks do nothing, exit cleanly, and write
  the reason to the debug log.
- Hooks now run `scripts/hook.mjs`, which loads `scripts/logger.ts`.
- Front matter values are now double-quoted, so branch names such as `#12-fix`
  and paths containing `: ` parse correctly as YAML. Tools that read the front
  matter with a YAML parser get the same values as before; tools that matched
  the raw text may need updating.

### Fixed

- **Final git status** no longer says `clean` when it couldn't be read. It now
  says why: not a git repository, git not found, timed out, or the project
  folder is gone.
- A session resumed after its event file expired (30 idle days), or after
  `CLAUDE_CONFIG_DIR` changed, now continues its existing log, keeping
  earlier entries, instead of starting a second log.
- A damaged event file (a crash during its first write) no longer stops the
  session's log from ever being written. It's rebuilt from the events that can
  still be read.
- A session whose working folder doesn't exist no longer creates that folder,
  and a project deleted mid-session is no longer recreated to hold its log.

## 0.1.0 - 2026-11-13

Internal release, not published.

### Added

- First release: one Markdown log per session with files touched, commands run,
  and final git status.
- Settings: `SESSION_LOGGER_DIR`, `SESSION_LOGGER_GITIGNORE`,
  `SESSION_LOGGER_MAX_COMMAND`, `SESSION_LOGGER_DISABLE`.

[Unreleased]: https://github.com/Crescentic/claude-logger-lite/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Crescentic/claude-logger-lite/releases/tag/v0.2.0
