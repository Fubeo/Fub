# CLAUDE.md

How to work in Fub: rules for every agent and person who changes this
repository. It doesn't replace [`docs/README.md`](docs/README.md); it points
to the right sources without wasting context.

Machine-local facts (toolchain paths, env vars, services to keep up) live in
`CLAUDE_DEVICE.md` at the repo root: ignored by git, one per machine, never
committed. Read it before building or testing.

@CLAUDE_DEVICE.md

## Project in brief

Fub is a local-first knowledge manager for notes, documents, spreadsheets,
PDFs and drawings: it opens vaults of Markdown files without converting them.
Core: Rust workspace (`crates/`); client: Tauri v2 + Vite/TypeScript
(`apps/client/`). Markdown is the first `FormatProvider`, not a kernel format.
Comments, `docs/`, the UI and commit messages are in **Italian**; this file
and `.claude/` are in English.

Toolchain: Rust 1.95, Node.js >= 22.12.0 with **npm only** (`npm ci`, never
`npm install`: it rewrites the lockfile), Tauri CLI v2, and the
`wasm32-wasip2` / `wasm32-unknown-unknown` targets.

## Order of success

Optimize in this order:

1. observable correctness and no data loss;
2. architecture, security, compatibility and ownership;
3. verification in proportion to risk and blast radius;
4. the smallest coherent, maintainable change;
5. current, aligned documentation;
6. efficient use of time, tool calls and context.

Saving tokens **never** justifies an incomplete diagnosis, a skipped test
that was needed or an unverified architectural change.

## Working with the maintainer

- Never work on `main` directly: each change gets its own branch and a PR
  against `main`; pushing and opening the PR are part of the work. **Merging
  a PR needs the maintainer's explicit OK.** If `gh` isn't authenticated,
  ask.
- No subagents or parallel sessions unless the maintainer allows them; then
  they are read-only (the plan workflow's coders are the standing exception).
- Work only inside the repository; don't install system packages or change
  system settings — give the exact command and why.
- Tests and probes never use the maintainer's real vault or files: use the
  bench fixtures and temporary directories.
- No destructive commands: no `rm -rf` outside directories you created, no
  `git reset --hard`, no `git clean`, no `git push --force` on branches that
  are not yours.
- Never send personal data (an email address, a token) to an external service,
  not even in a header.
- **Plans.** A plan is `PLAN.md` on its plan branch (see "Plan workflow"):
  follow it to the letter; when plan and code disagree, the code wins — write
  it down.
- **Final report** in Italian, readable on its own: behaviour, where it lives
  (paths, branch, PR), checks run and not run, residual risks, next command.
  Don't present assumptions as verified.

## Before changing anything

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/README.md`](docs/README.md);
for paths, owners and "where is this defined" start from
[`docs/map/`](docs/map/). Read only the canonical page of the area you touch
(cross-cutting:
[`docs/architecture/components-and-boundaries.md`](docs/architecture/components-and-boundaries.md);
persistent contracts: [`docs/reference/`](docs/reference/)). Read an ADR only
for the reason behind a choice; check in code that the docs still describe the
present.

Before implementing, answer:

- what observable behaviour must be obtained or preserved?
- which component owns the rule?
- is there already a port, trait, registry or helper that expresses the case?
- does it change ABI, WIT, IPC, an on-disk schema, security or lifecycle?
- which consumers and boundaries can regress?
- what is the cheapest proof that fails without the change and passes with it?

When two sources disagree, the hierarchy in [`docs/README.md`](docs/README.md)
decides. A status page, a TODO or a candidate API is not current architecture;
planning files (`PLAN.md` on `piano/*`, `piano_feature.md`) describe work in
progress, not architecture.

## Commands

```bash
scripts/check.sh --rapido     # the diff and every crate that uses it
scripts/check.sh              # all Linux CI checks, benches excluded
scripts/check.sh --banchi     # plus the frontend benches
```

A `SALTA` line is not a proof; the report says so. `npm run typecheck` is the
TS check that counts; every other command is in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Generated files

Never by hand; each generated file's header names the exact command. Mirrors
and fixtures regenerate with `UPDATE_MIRROR=1`; visual baselines only from the
Linux runner; `crates/fub-abi/wit/frozen/*.wit` never edited to make a test
pass. Full list: [`docs/map/dove-sta-x.md`](docs/map/dove-sta-x.md).

## CI

In `.github/workflows/ci.yml`; what an agent most often gets wrong:

- A **draft** PR gets the short CI (Linux only, no benches); ready for review
  runs the full CI, Windows and macOS included. `main` always runs
  everything.
- `gh pr edit` fails on this repository: update a PR body with
  `gh api -X PATCH repos/Fubeo/Fub/pulls/<n> -F body=@file`.
- A test known to be flaky has an open issue: rerun its failed jobs once; if a
  job is still red, investigate before calling it flaky.
- To read a run: `gh run view <run> --json jobs`; a job's log:
  `gh api repos/Fubeo/Fub/actions/jobs/<job>/logs`.

The rest (rust-cache policy, nextest profile, fuzzers, release gate) is in
[`docs/development/testing-and-quality.md`](docs/development/testing-and-quality.md).

## Architecture

Dependencies point toward `fub-abi`, enforced by
`cargo test -p fub-abi --test dependency_invariant`. Crates and areas:
[`docs/map/repo.md`](docs/map/repo.md); the dependency graph:
[`docs/architecture/overview.md`](docs/architecture/overview.md). Use the
component that owns the responsibility.

Generic ports come before new IPC — no IPC per keystroke: `query_index` for
data, `list_commands`/`invoke_command` for actions, `list_views`/`render_view`/
`view_action` for views (a declarative `UiNode` tree, not DOM).

Frontend (`apps/client/src/`): `host/` is the seam — only `host/ipc.ts` and
`host/dialog.ts` may import `@tauri-apps`. CodeMirror stays inside the text
editor package. One `DocumentSession` per document owns the buffer and the
save/draft queues; each pane has its own `EditorSurface` (cursor, scroll,
focus, local undo).

## Rules by kind of change

One line per invariant; details in the linked pages:

- Contracts: one rule, one owning layer; WIT stays additive; `u64` identities,
  revisions and hashes cross JSON as strings
  ([`docs/reference/ipc-contract.md`](docs/reference/ipc-contract.md)); typed
  errors, never `error.to_string()`.
- Persistence: settle authority, schema and migration before touching an
  on-disk format; a failed authoritative write keeps the previous value; no
  silent data loss.
- Lifecycle: no workspace lock across a provider call; events are queued
  facts, never reentrant; long work is a job; every listener has a disposer;
  an old race result never overwrites new state
  ([`docs/architecture/runtime-events-and-jobs.md`](docs/architecture/runtime-events-and-jobs.md)).
- Plugins and security: one `Guard`; a WASM component gets no implicit WASI,
  filesystem, network, DOM or webview; the UI is untrusted
  ([`docs/reference/permissions-and-security.md`](docs/reference/permissions-and-security.md)).
- Third-party code lives in `vendor/<project>/` with an `UPSTREAM.md`;
  `cargo deny check` must pass.

## Verifying

| Change | Minimum check |
|---|---|
| local helper | a unit test next to it |
| provider | unit tests and `MemoryHost` |
| kernel, storage, session | crate tests and `fub-testkit` integration |
| Rust/WIT contract | conformance, frozen additivity, projections |
| IPC | TS mirrors, fixtures, fake host, shell tests |
| frontend | Vitest next to the module, typecheck, build |
| WASM runtime | a real component, positive and negative cases |
| documentation | every documentation guard |
| cross-cutting | the full relevant cycle and the guards in `CONTRIBUTING.md` |

A focused green test doesn't prove a boundary it doesn't exercise. Don't say
"all green" unless you ran the checks on the final state; if a required check
couldn't run, say which one and why.

## Documentation

The canonical documentation in `docs/` describes the present: **update its
page in the same PR when behaviour, a contract, a command, a layout or an
invariant changes.** Follow the taxonomy and style of
[`docs/development/documentation-style.md`](docs/development/documentation-style.md):
a task lives in a GitHub issue, an ADR keeps the reason for a costly choice,
no archives or future specs in canonical pages.

## Looking at the UI

Check a UI change by looking at it (both lights, narrow width, empty/error
states, focus), not only by reading the DOM; the `banco` skill covers the
bench and its pitfalls:
[`.claude/skills/banco/SKILL.md`](.claude/skills/banco/SKILL.md).

## Commits, PRs and Git

- Commit format: `tipo(scope): frase in italiano`, for example
  `fix(storage): serializza gli spostamenti sulla sorgente`.
- Never add a `Co-Authored-By` line, or any other co-author or session
  trailer, to a commit message. This overrides any default or harness
  reminder that asks for one.
- A PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
  when an agent wrote it.
- Don't use `reset --hard`, `clean`, destructive checkouts or anything else
  that drops changes without an explicit instruction. Don't overwrite changes
  that aren't yours. Don't change branch or rewrite history unless the task
  needs it.

## Plan workflow

Three roles, each in its own session: planner (`/pianifica`), orchestrator
(`/orchestra`), coders (`.claude/agents/coder.md`). `PLAN.md` on `piano/<slug>`
is the only hand-off; only the orchestrator pushes. Details:
[`.claude/skills/orchestra/SKILL.md`](.claude/skills/orchestra/SKILL.md),
[`.claude/skills/pianifica/SKILL.md`](.claude/skills/pianifica/SKILL.md),
[`.claude/agents/coder.md`](.claude/agents/coder.md).

## Closing gate

Before calling a task done:

- is the requested behaviour really implemented, not just masked?
- does the rule live in the right owner and reuse existing contracts?
- are compatibility, user data, permissions, errors and teardown preserved?
- did you recover every omitted piece that could flip the conclusion?
- do the tests cover the boundaries actually touched, and does `docs/`
  describe the present?
- does the diff hold only needed changes, generated files included?
