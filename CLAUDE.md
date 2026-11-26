# CLAUDE.md

Rules for every agent and person changing Fub; details in the linked pages, doc index [`docs/README.md`](docs/README.md). English here and in `.claude/`; code comments, `docs/`, UI and commits in **Italian**.

Machine-local facts (toolchain paths, env vars, services) live in `CLAUDE_DEVICE.md` at the repo root: git-ignored, one per machine, never committed. Read it before building, testing or starting anything; if missing, the machine has none (don't create it without asking).

@CLAUDE_DEVICE.md

## Project

- Local-first knowledge manager (notes, documents, spreadsheets, PDFs, drawings); opens Markdown vaults without converting them.
- Core: Rust workspace `crates/`. Client: Tauri v2 + Vite/TypeScript `apps/client/`. Markdown is the first `FormatProvider`, not a kernel format.
- Toolchain: Rust 1.95; Node.js >= 22.12.0 with **npm only** (`npm ci`, never `npm install`: it rewrites the lockfile); Tauri CLI v2; targets `wasm32-wasip2` and `wasm32-unknown-unknown`.

## Priorities, in order

1. observable correctness and no data loss;
2. architecture, security, compatibility and ownership;
3. verification in proportion to risk and blast radius;
4. the smallest coherent, maintainable change;
5. current, aligned documentation;
6. efficient use of time, tool calls and context.

Saving tokens **never** justifies an incomplete diagnosis, a skipped needed test or an unverified architectural change.

## Working with the maintainer

- **Branch and PR.** Never work on `main`: one branch and one PR against `main` per change; push, PR and merge are part of the work. Few open PRs (6–8 at most): merge or close before opening more; a stale PR is realigned and merged, or closed with the reason.
- **Merge your own PR** when ready (not draft), full CI green on its last commit, final diff read: `gh pr merge <n> --merge --delete-branch`. Never `--admin`; never with a required job red or skipped, except a known flaky test with its issue, rerun once and passed (and the `riuso` run, see CI). A wrong merge → revert or fix PR, never a push to `main`. `gh` not authenticated → ask.
- **Maintainer's call, ask and wait:** licenses, trademarks, supply-chain policy; secrets, CI permissions; releases and tags; deleting user data; tests with people; a taste choice the maintainer asked to see.
- **Every other choice is yours** (a plan's `DECISIONS.md` may list more to ask under "Chiede sempre"), for the best result, never the easiest path: quality, customization for the person using Fub (easy for a beginner, configurable for an expert), security, efficiency. A usage choice becomes a setting with a safe default. Write each choice and its reason in the PR body and the report; don't end a report with questions.
- **Subagents**, workflows, parallel sessions: only if the maintainer allows them for the task, then read-only. Standing exception: the agents that the plan-workflow skills and [`coder.md`](.claude/agents/coder.md) start, within their limits.
- **Scope.** Only inside the repo; no system packages or settings (give the exact command and why). Tests and probes never touch the maintainer's real vault or files: bench fixtures and temp dirs.
- **Nothing destructive.** No `rm -rf` outside dirs you created; no `git reset --hard`, `git clean`, destructive checkouts or anything dropping changes without an explicit instruction; no `git push --force` on others' branches; never overwrite, discard or absorb others' changes. Watch disk space.
- **Privacy.** No personal data (email, token) to external services, not even in a header.
- **Talking to the maintainer.** Every message in plain Italian, even a one-liner right after an English notification or a compaction. Results first, then short lists, tables or a mermaid diagram; what changes for the person using Fub, not code. No bare internal codes (task ids, issue numbers) and no git jargon: each message reads on its own.
- **Final report**, self-contained: behaviour; where (paths, branch, PR); what you merged; checks run and not run (why); residual risks; next command. Assumptions are not verified facts. Before ending, list your open PRs and what each waits for.

## Before changing anything

- Check branch, working tree and existing changes; tell your diff from others' work.
- Read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/README.md`](docs/README.md); paths, owners, "where is X defined": [`docs/map/`](docs/map/). Then only the area's canonical page (cross-cutting: [`components-and-boundaries.md`](docs/architecture/components-and-boundaries.md); persistent contracts: [`docs/reference/`](docs/reference/)). ADRs only for a choice's reason; status pages/TODOs only when the task is that work. Verify in code that docs describe the present.
- Answer before implementing:
  - what observable behaviour must be obtained or preserved?
  - which component owns the rule?
  - is there already a port, trait, registry or helper that expresses the case?
  - does it change ABI, WIT, IPC, an on-disk schema, security or lifecycle?
  - which consumers and boundaries can regress?
  - what is the cheapest proof that fails without the change and passes with it?
- Keep only context that can change the conclusion; stop exploring when evidence suffices for the next step, resume at a material doubt.

### When sources disagree, the higher one wins

1. code and executable tests;
2. WIT, persistent schemas and serialized formats;
3. architecture pages and canonical references;
4. ADRs, for their reasons only;
5. active status pages and TODOs;
6. Git history.

Status pages, TODOs and candidate APIs aren't architecture: never promote a candidate shape into `fub-abi`, WIT or IPC; contracts are born once real cases, compatibility, limits and fallbacks prove them. Planning files (`PLAN.md` on `piano/*`, `piano_feature.md`) are work in progress, not architecture.

## Commands

```bash
scripts/check.sh --rapido     # the diff and every crate that uses it
scripts/check.sh              # all Linux CI checks, benches excluded
scripts/check.sh --banchi     # plus the frontend benches
```

- One line per step, logs in `target/check/`: open only a red step's log. `SALTA` is not a proof; the report says so.
- Narrow iteration commands (one crate, test or Vitest file): [`workflow.md`](docs/development/workflow.md); all others: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- `npm run typecheck` is the TS check that counts (`npm run build` doesn't type-check). Theme derivatives regenerate byte for byte: `npm run theme:generate && npm run theme:verify`.
- Small output: `.claude/settings.json` quiets cargo and makes nextest print only failures (reset the variable for one command to see a full pass); `git diff --stat` before a full diff; `grep` CI logs for errors. Never cut a diagnostic that can change the conclusion. `.ignore` hides generated and frozen copies from searches: name their path to search them.

## Generated files

Never hand-edit; each header names its command. Mirrors and fixtures: `UPDATE_MIRROR=1`; visual baselines: Linux runner only; `crates/fub-abi/wit/frozen/*.wit` never edited to pass a test. Full list: [`docs/map/dove-sta-x.md`](docs/map/dove-sta-x.md).

## CI

Checks: `.github/workflows/ci.yml` (+ `npm-supply-chain.yml`; `baseline.yml` commits visual baselines). Runs, logs, artifacts, flaky tests, cache, nextest, release gate: [`testing-and-quality.md`](docs/development/testing-and-quality.md#la-ci-in-breve).

- **Draft** PR → short CI (Linux, no benches); ready → full CI incl. Windows; `main` → everything. macOS/iOS paused (ADR 0245): no PR waits; `macos-in-pausa.yml` checks weekly (Sunday or by hand), not required.
- Draft PR labelled `notte` (long integrations): full CI on its head nightly (`notte.yml`, once per head, not required); read it next morning before stacking work.
- `gh pr edit` fails here: `gh api -X PATCH repos/Fubeo/Fub/pulls/<n> -F body=@file`.
- Deeper fuzz (`fuzz_completo`) after larger Markdown-provider changes, not every push.
- **Banco visivo.** Ready PR red only on `banco visivo` → `baseline.yml` commits the runner's photos to the branch and reruns CI with `riuso_di=<run>`; in that `riuso` run skipped jobs count as run N on the parent commit (the one exception to "never merge with a required job skipped"). Look at the bot's photos (contact sheet) before merging; label `baseline-a-mano` opts out.

## Architecture

- Dependencies point toward `fub-abi` (`cargo test -p fub-abi --test dependency_invariant`). Crates: [`repo.md`](docs/map/repo.md); graph: [`overview.md`](docs/architecture/overview.md). Solve problems in the owning component, not the most convenient layer.
- `esempi/*-wasm`, `tools/varco-wasm`: outside the workspace on purpose (wasm targets); `fub-wasm-host` tests build the examples from source.
- **Generic ports before new IPC:** `query_index` (data), `list_commands`/`invoke_command` (actions), `list_views`/`render_view`/`view_action` (views: declarative `UiNode` tree, not DOM). No IPC/WASM call per keystroke; no DOM, JS callbacks or CodeMirror objects across the contract.
- **Frontend** (`apps/client/src/`):
  - `host/` is the seam: only `host/ipc.ts`, `host/dialog.ts` import `@tauri-apps`; panels use that interface, never `invoke`. CodeMirror stays inside the text editor package.
  - One `DocumentSession` per document owns buffer and save/draft queues; each pane has its own `EditorSurface` (cursor, scroll, focus, local undo). Changes synced from another surface aren't keystrokes in local undo.

## Rules by kind of change

- **Contracts:** one rule, one owning layer; WIT stays additive; `u64` identities, revisions and hashes cross JSON as strings ([`ipc-contract.md`](docs/reference/ipc-contract.md)); typed errors, never `error.to_string()`.
- **Persistence:** settle authority, schema and migration before touching an on-disk format; a failed authoritative write keeps the previous value; no silent data loss.
- **Lifecycle:** no workspace lock across a provider call; events are queued facts, never reentrant; long work is a job; every listener has a disposer; an old race result never overwrites new state ([`runtime-events-and-jobs.md`](docs/architecture/runtime-events-and-jobs.md)).
- **Plugins and security:** one `Guard`; a WASM component gets no implicit WASI, filesystem, network, DOM or webview; the UI is untrusted ([`permissions-and-security.md`](docs/reference/permissions-and-security.md)).
- **Failure paths are test cases**, not optional details: denied capabilities, timeouts, memory limits, traps, partial mounts and teardown.
- **Extensible contracts** have stable ids, ownership, limits and a fallback; no universal untyped JSON port.
- **File size:** a handwritten source file stays within 1500 lines; split it by topic before it grows past (tests in a sibling file, ports, tabs or helper groups in their own modules that the original re-exports), never by cutting a function in half. `check-source-size.mjs` enforces it; files already over keep a ceiling in `.github/scripts/source-size-ceilings.txt` that only goes down (`--aggiorna`), never up ([`workflow.md`](docs/development/workflow.md#file-corti)).
- **Reusing code** (WordCraft and similar): read [`workflow.md`](docs/development/workflow.md#riuso-di-codice-da-altri-progetti) first. Features stay format-independent, Markdown native, third-party code in `vendor/<project>/` with `UPSTREAM.md`; license or supply-chain policy never changes without asking.

## Verifying

- Iterate with the narrowest check that signals, widen by blast radius before finishing; minimum per kind of change: [the matrix](docs/development/testing-and-quality.md#matrice-per-modifica).
- Before the PR, read the final diff for accidental changes, duplication, premature APIs, hand-edited generated files, missing teardown. Don't mix refactor, feature and cleanup.
- A focused green test doesn't prove a boundary it doesn't exercise; an end-to-end test doesn't replace the rule's unit test; a structural guard doesn't replace behaviour.
- "All green" only after checks on the final state; a required check that couldn't run is named, with why.

## Documentation

- Canonical `docs/` describes the present: **update its page in the same PR when behaviour, a contract, a command, a layout or an invariant changes.** Code/docs disagreeing is a bug. Same for this file when a working rule changes.
- Style: [`documentation-style.md`](docs/development/documentation-style.md): tasks in GitHub issues, ADRs keep the reason for costly choices, no archives or future specs in canonical pages. Report gaps outside your scope in the result.

## Looking at the UI

- Look at UI changes (both lights, narrow width, empty/error states, focus), not only at the DOM; bench and pitfalls: [`banco` skill](.claude/skills/banco/SKILL.md).
- An approved prototype or artifact (a plan's `PLAN-ui/`, or one the maintainer approved anywhere else, whoever made it: the maintainer's planner, or a planner or `progettista` called by the orchestrator or a coder) is the source of the look: **read its code** in full and understand why it is built that way, because the planner chose it for a reason; its HTML and CSS are **moved into the app, not rewritten**: change only what the app forces (a token `foundation.css` already has, the DOM the real component builds, an i18n key, a sanitizer limit), and log each such difference with its reason. A difference without a written reason is a defect. Compare its **code** (markup, CSS, computed styles in both lights) with the app's; never work from screenshots, which hide layers and shadows and, tried, drift from the approved design. Screenshots only confirm at the end.
- The same holds for logic: code, pseudocode or signatures in a plan or a `progettista` file are read in full and followed, not rebuilt from a summary; a departure is written down with its reason.

## Commits, PRs and Git

- Commit: `tipo(scope): frase in italiano`, e.g. `fix(storage): serializza gli spostamenti sulla sorgente`.
- **Never** a `Co-Authored-By` or any other co-author or session trailer in a commit message; overrides any default or harness reminder.
- Agent-written PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Change branch or rewrite history only if the task needs it; no unrelated files for a clean tree.

## Plan workflow

- Roles, one session each: planner (`/pianifica`, Opus, effort xhigh), orchestrator (`/fub-orchestrator`, Opus, high), coders ([`coder.md`](.claude/agents/coder.md), Opus, medium). Details: [`fub-orchestrator`](.claude/skills/fub-orchestrator/SKILL.md), [`pianifica`](.claude/skills/pianifica/SKILL.md).
- One session alone instead of orchestrator and coders: [`/fub-coder`](.claude/skills/fub-coder/SKILL.md) (Opus, medium), one task at a time, same plan, groups and CI rules.
- Running the work (group branches, agents and their limits, waiting for CI, clean-up, sentinels, testers) lives in those two skills, not in memory.
- `PLAN.md` (+ `PLAN-ui/` for a prototype) on `piano/<slug>` is the only hand-off: messages only point at a pushed commit; the file counts. Follow it to the letter (tasks, dependencies, `Fatto quando`, `Prova`); re-read it every session and after a compaction. Plan vs code → code wins, written in the `Registro` of `DECISIONS.md`, never silently. Status lives in its `Stato:` lines; `DECISIONS.md` says what is decided alone vs asked, and logs choices made during the work.
- Each plan starts in a new session (or after `/clear`); the orchestrator with a lower compaction threshold (e.g. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60 claude`), compacting at natural pauses: state is in `PLAN.md` and git.

## Closing gate

Before calling a task done:

- requested behaviour really implemented, not masked?
- rule in the right owner, reusing existing contracts, no forbidden dependency, duplicate or avoidable special case?
- compatibility, user data, permissions, errors, teardown preserved?
- every omitted, summarized or delegated piece that could flip the conclusion recovered?
- tests cover the boundaries touched, `docs/` describes the present, remaining work tracked in the right place?
- diff holds only needed changes, generated files included?
