# CLAUDE.md

How to work in Fub: rules for every agent and person who changes this
repository. It doesn't replace [`docs/README.md`](docs/README.md); it points
to the right sources without wasting context.

Machine-local facts (toolchain paths, env vars, services to keep up) live in
`CLAUDE_DEVICE.md` at the repo root: ignored by git, one per machine, never
committed. Read it before building, testing or starting anything. If it is
missing, the machine has no special instructions: don't create it without
asking.

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
- No subagents, workflows or parallel sessions unless the maintainer allows them
  for that task; then they are read-only (the plan workflow's coders are the
  standing exception).
- Work only inside the repository; don't install system packages or change
  system settings — give the exact command and why.
- Tests and probes never use the maintainer's real vault or files: use the
  bench fixtures and temporary directories.
- No destructive commands: no `rm -rf` outside directories you created, no
  `git reset --hard`, no `git clean`, no `git push --force` on branches that
  are not yours. Keep an eye on disk space.
- Never send personal data (an email address, a token) to an external service,
  not even in a header.
- **Plans.** A plan is `PLAN.md` on its plan branch (see "Plan workflow"):
  follow it to the letter and re-read it at the start of every session. When
  plan and code disagree, the code wins — write it down. Status lives in the
  plan's `Stato:` lines, decisions in `DECISIONS.md`.
- **Final report** in Italian, readable on its own: behaviour, where it lives
  (paths, branch, PR), checks run and not run (and why), residual risks, next
  command. Don't present assumptions as verified.

## Before changing anything

First, check the branch, the working tree and the changes already there: tell
your diff apart from work that isn't yours, and don't discard, rewrite or absorb
unrelated work.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/README.md`](docs/README.md);
for paths, owners and "where is this defined" start from
[`docs/map/`](docs/map/). Read only the canonical page of the area you touch
(cross-cutting:
[`docs/architecture/components-and-boundaries.md`](docs/architecture/components-and-boundaries.md);
persistent contracts: [`docs/reference/`](docs/reference/)). Read an ADR only
for the reason behind a choice, and status pages or TODOs only when the task is
about that work. Check in code that the docs still describe the present.

Before implementing, answer:

- what observable behaviour must be obtained or preserved?
- which component owns the rule?
- is there already a port, trait, registry or helper that expresses the case?
- does it change ABI, WIT, IPC, an on-disk schema, security or lifecycle?
- which consumers and boundaries can regress?
- what is the cheapest proof that fails without the change and passes with it?

Keep only the context that can change the conclusion; stop exploring once the
evidence is enough for the next step, and resume as soon as a material doubt
appears.

When sources disagree, the higher one wins: code and executable tests; WIT,
persistent schemas and serialized formats; architecture pages and canonical
references; ADRs, for their reasons only; active status pages and TODOs; Git
history ([`docs/README.md`](docs/README.md)). A status page, a TODO or a
candidate API is not current architecture: don't promote a candidate shape into
`fub-abi`, WIT or IPC. Contracts are born when real cases, compatibility, limits
and fallbacks have proved them. Planning files (`PLAN.md` on `piano/*`,
`piano_feature.md`) describe work in progress, not architecture.

## Commands

```bash
scripts/check.sh --rapido     # the diff and every crate that uses it
scripts/check.sh              # all Linux CI checks, benches excluded
scripts/check.sh --banchi     # plus the frontend benches
```

One line per step; full logs go to `target/check/`. A `SALTA` line is not a
proof; the report says so. The narrow commands for iterating (one crate, one
test file, one Vitest file) are in
[`docs/development/workflow.md`](docs/development/workflow.md).
`npm run typecheck` is the TS check that counts; `npm run build` does not
type-check. Theme derivatives must regenerate byte for byte:
`npm run theme:generate && npm run theme:verify`. Every other command is in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Keep command output small. `.claude/settings.json` makes cargo quiet and
nextest print only failures; set the variable back for one command if you need
a passing run in full. `scripts/check.sh` prints one line per step: open only
the log of a red step. Read `git diff --stat` before a full diff, and filter CI
logs with `grep` for the errors instead of reading them whole. Never cut a
diagnostic that can change the conclusion.

## Generated files

Never edit them by hand; each generated file's header names the exact command.
Mirrors and fixtures regenerate with `UPDATE_MIRROR=1`; visual baselines only
from the Linux runner; `crates/fub-abi/wit/frozen/*.wit` is never edited to make
a test pass. Full list: [`docs/map/dove-sta-x.md`](docs/map/dove-sta-x.md).

## CI

The checks live in `.github/workflows/ci.yml` (and `npm-supply-chain.yml`).

- A **draft** PR gets the short CI (Linux only, no benches); ready for review
  runs the full CI, Windows and macOS included. `main` always runs everything.
- `gh pr edit` fails on this repository: update a PR body with
  `gh api -X PATCH repos/Fubeo/Fub/pulls/<n> -F body=@file`.
- Ask for the deeper fuzz run (`fuzz_completo`) after larger changes to the
  Markdown provider, not on every push.

How to read runs, logs and artifacts, flaky tests, cache, nextest and the
release gate: [`docs/development/testing-and-quality.md`](docs/development/testing-and-quality.md#la-ci-in-breve).

## Architecture

Dependencies point toward `fub-abi`, enforced by
`cargo test -p fub-abi --test dependency_invariant`. Crates and areas:
[`docs/map/repo.md`](docs/map/repo.md); the dependency graph:
[`docs/architecture/overview.md`](docs/architecture/overview.md). Use the
component that owns the responsibility; don't solve a problem in the most
convenient layer. `esempi/*-wasm` and `tools/varco-wasm` sit outside the
workspace on purpose (they target wasm); `fub-wasm-host` tests build the
examples from source.

Generic ports come before new IPC: `query_index` for data,
`list_commands`/`invoke_command` for actions, `list_views`/`render_view`/
`view_action` for views (a declarative `UiNode` tree, not DOM). No IPC or WASM
call per keystroke, and no DOM, JavaScript callbacks or CodeMirror objects cross
the contract.

Frontend (`apps/client/src/`): `host/` is the seam — only `host/ipc.ts` and
`host/dialog.ts` may import `@tauri-apps`; panels use that interface, never
`invoke`. CodeMirror stays inside the text editor package. One `DocumentSession`
per document owns the buffer and the save/draft queues; each pane has its own
`EditorSurface` (cursor, scroll, focus, local undo). Changes synced from another
surface are not keystrokes in the local undo history.

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
- Denied capabilities, timeouts, memory limits, traps, partial mounts and
  teardown are test cases, not optional details.
- An extensible contract has stable ids, ownership, limits and a fallback; no
  universal untyped JSON port.

### Reusing code from other projects

Before reusing code from WordCraft or similar projects, read
[`docs/development/workflow.md`](docs/development/workflow.md#riuso-di-codice-da-altri-progetti):
features stay independent of formats, Markdown stays native, third-party code
lives in `vendor/<project>/` with an `UPSTREAM.md`, and the license or
supply-chain policy never changes without asking.

## Verifying

Iterate with the narrowest check that gives a signal, then widen it by blast
radius before finishing. Before the PR, read the final diff for accidental
changes, duplication, premature APIs, hand-edited generated files and missing
teardown. Don't mix refactor, feature and cleanup in one change. The minimum
check for each kind of change is the matrix in
[`docs/development/testing-and-quality.md`](docs/development/testing-and-quality.md#matrice-per-modifica).

A focused green test doesn't prove a boundary it doesn't exercise. An
end-to-end test doesn't replace the unit test of the rule, and a structural
guard doesn't replace behaviour. Don't say "all green" unless you ran the checks
on the final state; if a required check couldn't run, say which one and why.

## Documentation

The canonical documentation in `docs/` describes the present: **update its
page in the same PR when behaviour, a contract, a command, a layout or an
invariant changes.** Follow the taxonomy and style of
[`docs/development/documentation-style.md`](docs/development/documentation-style.md):
a task lives in a GitHub issue, an ADR keeps the reason for a costly choice,
no archives or future specs in canonical pages. Code and docs that disagree are
a bug. Update this file the same way when a working rule changes. If you find a
gap outside your scope, report it in the result.

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
  needs it. Don't add unrelated files just to get a clean working tree.

## Plan workflow

Three roles, each in its own session: planner (`/pianifica`, Opus, effort
xhigh), orchestrator (`/orchestra`, Opus, effort high), coders
(`.claude/agents/coder.md`, Opus, effort medium). `PLAN.md` (and `PLAN-ui/` for a
prototype) on `piano/<slug>` is the only hand-off: a message only points at a
pushed commit, and the file is what counts. `DECISIONS.md` says what the
orchestrator decides alone and what it asks, and logs the choices made during
the work. Coders never push, open PRs or touch CI; only the orchestrator pushes,
once per integrated task, to a draft PR. Start each plan in a new session (or
after `/clear`), and start the orchestrator with a lower compaction threshold,
for example `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60 claude`; compact at natural
pauses, because the state is in `PLAN.md` and git. Details:
[`.claude/skills/orchestra/SKILL.md`](.claude/skills/orchestra/SKILL.md),
[`.claude/skills/pianifica/SKILL.md`](.claude/skills/pianifica/SKILL.md),
[`.claude/agents/coder.md`](.claude/agents/coder.md).

## Closing gate

Before calling a task done:

- is the requested behaviour really implemented, not just masked?
- does the rule live in the right owner and reuse existing contracts, without a
  forbidden dependency, a duplicate or an avoidable special case?
- are compatibility, user data, permissions, errors and teardown preserved?
- did you recover every omitted, summarized or delegated piece that could flip
  the conclusion?
- do the tests cover the boundaries actually touched, does `docs/` describe the
  present, and is the remaining work tracked in the right place?
- does the diff hold only needed changes, generated files included?
