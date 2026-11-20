# Contributing to session-logger

Thanks for helping. Bug reports, fixes, docs and ideas are all welcome. Issues
labelled **good first issue** are small and self-contained, so they're a good
place to start.

## Ground rules

These keep the plugin safe to leave installed everywhere. Pull requests that
break them won't be merged.

1. **Never break or slow a session.** The hook must always exit 0, print
   nothing to stdout, and finish well inside its 15-second timeout. Errors are
   caught and sent to the debug log (`debugLog`), never thrown.
2. **No runtime dependencies.** The plugin runs on Node.js and its standard
   library alone, with no `npm install` or build step for users. TypeScript
   and `@types/node` are dev dependencies, used only for type checking.
3. **Record less, not more.** Prompts, replies and tool output stay out of the
   log. A new kind of data needs an issue first that explains why it is worth
   the privacy cost, and usually an opt-in setting.
4. **Works on Windows, macOS and Linux.** CI runs all three.

## Setup

```
git clone https://github.com/Crescentic/claude-logger-lite
cd claude-logger-lite
npm install
npm run check
```

You need Node.js 22.18 or later. Developing on the newest Node release is fine,
but the code must still run on 22.18 (see [TypeScript](#typescript)).

| Command | What it does |
| --- | --- |
| `npm test` | Runs the tests with `node --test` |
| `npm run typecheck` | Runs `tsc`, checking types only (nothing is emitted) |
| `npm run check` | Both of the above |
| `npm run stress` | Opt-in: 50 parallel hooks x 5 rounds, checks no event line is torn or lost (`SESSION_LOGGER_STRESS_HOOKS` / `_ROUNDS` change the size) |

To try your change in a real session:

```
claude --plugin-dir /path/to/claude-logger-lite
claude plugin validate /path/to/claude-logger-lite
```

Logs appear under `docs/sessions/logs/` in the project you open. If something
goes wrong, look in `~/.claude/hooks-logs/<date>.jsonl`.

## Layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest (name, version) |
| `.claude-plugin/marketplace.json` | Lets this repo be added as a marketplace |
| `hooks/hooks.json` | Which Claude Code events run the script |
| `scripts/hook.mjs` | Entry point the hooks run. Plain JavaScript, so it can report an unsupported Node instead of crashing |
| `scripts/logger.ts` | `run()` and the per-event logic (start, tool, stop, end) |
| `scripts/lib/types.ts` | Hook input and stored event types |
| `scripts/lib/paths.ts` | Where things are kept, and the debug log |
| `scripts/lib/git.ts` | Repository, branch and status lookups |
| `scripts/lib/store.ts` | Per-session event files: create, append, read, repair, prune |
| `scripts/lib/files.ts` | Locking, safe (temp file + rename) writes, folder checks |
| `scripts/lib/render.ts` | Events → Markdown, and reading a log back. Pure, so it's easy to unit test |
| `scripts/lib/write.ts` | Rebuilds the Markdown log from the event file |
| `tests/hook.test.ts` | End-to-end tests that run the real hook as a subprocess |
| `tests/lib.test.ts` | Fast in-process unit tests for the pure helpers |
| `tsconfig.json` | Type checking settings (`tsc` never emits files) |

## Making a change

1. For anything bigger than a small fix, open an issue first so we can agree
   on the approach.
2. Add or update a test. For behaviour across a session, use the `hook()`
   helper in `tests/hook.test.ts`, which runs the hook the way Claude Code
   does. For a pure helper, add a case to `tests/lib.test.ts`.
3. Run `npm run check`.
4. Update `README.md` if users will notice the change, and add a line under
   **Unreleased** in `CHANGELOG.md`.
5. Open a pull request and fill in the template.

New settings use environment variables named `SESSION_LOGGER_*`, need a
sensible default, and get a row in the README's settings table.

## TypeScript

Node runs `logger.ts` directly by stripping its types, with no compile step.
That has a few consequences, and `npm run typecheck` enforces all of them:

- **Only erasable syntax.** No `enum`, `namespace`, or constructor parameter
  properties. Use union types and plain objects instead.
- **Imports include the extension** (`./logger.ts`), and type-only imports use
  `import type` or an inline `type` modifier.
- **Write for the newest TypeScript, run on Node 22.18.** `lib` and
  `@types/node` are pinned to Node 22, so using a JavaScript or Node API that
  Node 22 lacks is a type error. The pin doesn't catch everything, so CI also
  runs the tests on Node 22.18, the active LTS, and the newest release.
- **Strict mode is on**, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Avoid `any` and `as` casts except where data
  comes from outside, such as hook input or a JSON line from disk.

Raising the minimum Node version is a breaking change. Do it in its own PR that
updates `engines` in `package.json`, `lib` and `@types/node`, the CI matrix,
`MIN_NODE` in `hook.mjs`, and the README.

## Style

Match what's there: ES modules, no semicolons, double quotes, two-space indent,
short functions, and comments that explain *why*.

## Releasing (maintainers)

1. Move the **Unreleased** notes in `CHANGELOG.md` under a new version heading.
2. Bump `version` in `.claude-plugin/plugin.json` and `package.json`. Claude
   Code only updates installed copies when this changes.
3. Commit, tag `vX.Y.Z`, push the tag, and create a GitHub release.

## Code of conduct

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md).
