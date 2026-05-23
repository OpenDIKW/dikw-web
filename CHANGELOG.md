# Changelog

All notable changes to `dikw-web` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers are standard three-digit SemVer (`MAJOR.MINOR.PATCH`); `package.json.version`
is the single source of truth. See `[0.0.2]` below for why the four-digit `VERSION`
file format introduced in `[0.0.1.0]` was dropped.

## [Unreleased]

## [0.0.2] - 2026-05-23

### Removed

- `VERSION` file (4-digit `MAJOR.MINOR.PATCH.MICRO` from `[0.0.1.0]`). The format
  was gstack `/ship`-specific and forced `package.json.version` into non-SemVer
  territory (`0.0.1.0`), which kneecaps any tool that validates SemVer
  (`npm version <bump>`, `semver.coerce()`, future Renovate / semantic-release).

### Changed

- `package.json.version` reverted to standard 3-digit SemVer (`0.0.2`); now the
  single source of truth for the project's version. `package-lock.json` re-synced.
- `CLAUDE.md` delivery workflow step 7 reverted to `gh pr create` as the primary
  PR-creation path. `/ship` is not used in this repo — its 4-digit `VERSION`
  requirement is incompatible with valid SemVer in `package.json`, and the
  individual sub-skills it orchestrates (`/code-review`, `/review`,
  `code-simplifier` subagent) can be invoked directly when useful. Bumping
  `package.json.version` and writing the matching `CHANGELOG.md` entry are now
  manual steps in the workflow.

## [0.0.1.0] - 2026-05-23

### Added

- `CLAUDE.md` "Working principles" section (Think before coding / Simplicity first
  / Surgical changes / Goal-driven execution) anchored against the project's
  `/v1/base/graph`, `src/styles.css` token system, and `#chat` canonical route.
- `CLAUDE.md` "Delivery workflow" — 8-step end-to-end loop from request clarification
  through TDD, codex-review rounds (max 3), `/simplify` / `/code-review xhigh`, Chrome
  MCP verification, doc walk (`CLAUDE.md` + `README.md` + `docs/*.md`), PR creation,
  and squash-merge with explicit `gh api .../reviews` + `/comments` pull.
- `CLAUDE.md` "Chat / agent rules" subsection covering right-rail session-scoped
  context, core-first tool preference, and the maintenance-action confirmation gate.
- `VERSION` + `CHANGELOG.md` scaffolding so the `/ship` delivery workflow can run
  end-to-end on this repo (bump version, write changelog entry, commit, push, open
  PR) instead of falling back to `gh pr create`.

### Changed

- `package.json` `version` synced to the four-digit `VERSION` (`0.0.1.0`); the
  package is `"private": true` and not published, so the extra digit has no
  registry impact.
- `CLAUDE.md` architecture notes corrected against the actual code: Graph page
  removed `wiki` / `source` / `all` scope toggle (only `search` + `hide-orphans`
  remain), `npm.cmd run build` line updated to mention `dist-server/standalone.mjs`,
  `dist-server/` added to the local/generated list.
- `CLAUDE.md` delivery workflow step 7 dropped the "this repo doesn't carry `/ship`
  scaffolding" caveat now that `VERSION` + `CHANGELOG.md` are in place; prefers
  `/ship` over plain `gh pr create`.
- `CLAUDE.md` delivery workflow step 4 replaced the non-existent `/simplify` and
  unsupported `/code-review xhigh` argument with the actually-installed
  `/code-review` plugin (five parallel Sonnet agents with confidence scoring) and
  the `code-simplifier` subagent for cleanup passes.
- `README.md` "Where canonical docs live" entry rewritten to point at `CLAUDE.md`
  as the operational guide for Claude Code sessions, and the `npm.cmd run build`
  row in the command table updated to match `CLAUDE.md` by mentioning `build:server`
  + `dist-server/standalone.mjs` (addresses CodeRabbit feedback on PR #33).
- `README.md` "Where canonical docs live" list extended with a `docs/adr/` entry
  so future Architecture Decision Records show up in the doc index.

### Removed

- `AGENTS.md` — superseded by `CLAUDE.md` now that Claude Code is the sole
  development surface; unique guidance (sidecar `coreUrl` rejection, token-never-displayed
  rule, `.env.agent.local` containment, generated-artifact ignore list) was integrated
  into `CLAUDE.md` rather than left in a parallel file.

