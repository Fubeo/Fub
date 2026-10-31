# CLAUDE.md

How to work in Fub: the rules for every agent, and every person, who changes
this repository. It doesn't replace the canonical documentation
([`docs/README.md`](docs/README.md)). It helps you pick the right sources,
change the right layer and bring enough evidence, without wasting time or
context.

What holds only on the computer you are running on (local toolchain paths,
environment variables, services that must stay up) lives in `CLAUDE_DEVICE.md`
at the repo root. It is ignored by git, there's one per machine, and it is never
committed. Read it before building, testing or starting anything. If it's
missing, the machine has no special instructions; don't create it without
asking.

@CLAUDE_DEVICE.md

## Project in brief

Fub is a local-first writing workspace: it opens vaults of Markdown files without
converting them. The core is a Rust workspace (`crates/`). The client is Tauri v2
plus Vite/TypeScript (`apps/client/`). Markdown is the first `FormatProvider`,
not a format built into the kernel. The code, comments and docs are written in
**English**; the user interface and commit messages stay in Italian.

Toolchain: Rust 1.95, Node.js >=22.12.0 with **npm only** (`npm ci`, never
`npm install` during setup: it rewrites the lockfile). Tauri CLI v2. The
`wasm32-wasip2` target is needed for the full `fub-wasm-host` tests.

## Order of success

Optimize in this order:

1. observable correctness and no data loss;
2. architecture, security, compatibility and ownership;
3. verification in proportion to risk and blast radius;
4. the smallest coherent, maintainable change;
5. current, aligned documentation;
6. efficient use of time, tool calls and context.

Saving tokens **never** justifies an incomplete diagnosis, a skipped test that
was needed or an unverified architectural change.

## Working with the maintainer

- Never work on `main` directly: each change gets its own branch and a PR
  against `main`. Pushing your branch and opening the PR are part of the work.
  **Merging a PR needs the maintainer's explicit OK.** If `gh` isn't
  authenticated, ask.
- No subagents, workflows or parallel sessions unless the maintainer allows them
  for that task; then they are read-only.
- Work only inside the repository (and `piani/`, see below). Don't install
  system packages or change system settings: give the exact command and why it
  is needed.
- Tests and probes never use the maintainer's real vault or files: use the bench
  fixtures and temporary directories.
- No destructive commands: no `rm -rf` outside directories you created, no
  `git reset --hard`, no `git clean`, no `git push --force` on branches that are
  not yours. Keep an eye on disk space.
- Never send personal data (an email address, a token) to an external service,
  not even in a header.
- **Plans.** When the maintainer gives a plan, follow it to the letter and
  re-read it at the start of every session. When the plan and the code
  disagree, the code wins: write the difference down. Work status, open
  questions and the differences go in `piani/STATO.md`. `piani/` is untracked.
- **Final report** in Italian, readable on its own: the behaviour obtained,
  where it lives (paths, branch, PR), the checks run, the checks not run and
  why, real residual risks, and the next command if there is one. Don't present
  assumptions as verified results.

## Before changing anything

1. Check the branch, the working tree and the changes already there. Don't
   discard, rewrite or absorb unrelated work.
2. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the map in
   [`docs/README.md`](docs/README.md).
3. Identify the behaviour asked for, the owner of the rule and the lowest test
   that can prove it.
4. Read **only** the canonical page of the area and the deeper pages you need.
   For cross-cutting work read
   [`docs/architecture/components-and-boundaries.md`](docs/architecture/components-and-boundaries.md).
5. If you touch a public or persistent contract, read the matching page in
   [`docs/reference/`](docs/reference/).
6. Read an ADR (`docs/decisions/`) only when you need the reason for a choice
   or you are weighing a change to it. Read roadmaps and TODOs only when the
   task is about that work.
7. Check in the code and the tests that the documentation still describes the
   present before you build on it.

Before implementing, you must be able to answer:

- what observable behaviour must be obtained or preserved?
- which component owns the rule?
- is there already a port, trait, registry or helper that expresses the case?
- does it change ABI, WIT, IPC, an on-disk schema, security or lifecycle?
- which consumers and boundaries can regress?
- what is the cheapest proof that fails without the change and passes with it?

### Which source wins

1. code and executable tests;
2. WIT, persistent schemas and serialized formats;
3. architecture pages and canonical references;
4. ADRs, only for the reasons behind decisions;
5. active status, roadmaps and TODOs;
6. Git history.

A roadmap, a TODO or a candidate API is **not** current architecture. Don't
promote a future shape into `fub-abi`, WIT or IPC just because it is described
in detail. Public contracts are born when real cases, compatibility, limits and
fallbacks have proved them. The planning files at the root (`todo.md`,
`issues.md`, `piano_*.md`, `HANDOFF-*.md`) describe work in progress.

### Context

Keep everything that can change the conclusion and drop the noise. Start from
likely paths, symbols, imports, tests or modules; don't map the whole
repository without a concrete reason. Don't dump huge logs, diffs, generated
files or dependency trees when a targeted view keeps the useful part. Don't
truncate diagnostics you may need: if an output was cut, fetch the missing part
when it can change the diagnosis. Don't repeat unchanged reads or commands for
reassurance. Stop exploring when the evidence is enough for a concrete next
step, and resume as soon as a material doubt appears.

## Commands

From the repo root (Rust):

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --no-fail-fast
cargo test -p fub-kernel                      # one crate
cargo test -p fub-kernel --test trash         # one integration test file
cargo test -p fub-kernel --lib storage::      # unit tests filtered by path
cargo tauri dev --config crates/fub-app/tauri.conf.json   # run the desktop app
```

From `apps/client/` (frontend):

```bash
npm ci
npm run typecheck        # the authoritative TS check; `npm run build` (Vite) does not type-check
npm test                 # vitest run
npx vitest run src/host/mirror.test.ts   # one test file
npx vitest run -t "name"                 # tests matching a name
npm run build
npm run theme:generate && npm run theme:verify   # theme derivatives, must regenerate byte-identical
npm run bench:verify / bench:a11y / bench:graph-scale   # visual, a11y and graph benches (Playwright chromium)
```

Documentation and repo guards are Node scripts in `.github/scripts/`, for example
`node .github/scripts/check-doc-links.mjs`. `CONTRIBUTING.md` lists every
command that must stay in CI, between `ci-required:start/end`. The frontend CI
job also runs `check-codemirror-boundary`, `check-listeners`, `check-races` and
`check-npm-copies`.

### Generated files

Never edit these by hand. Regenerate them from the Rust source:

- `apps/client/src/host/enums.generated.ts`:
  `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`
- the other TS mirrors and fixtures (`src/__fixtures__/mirror-samples*.json`,
  key and syntax mirrors) use the same `UPDATE_MIRROR=1` pattern. Examples:
  `-p fub-app --test ts_mirror_app`, `-p fub-features --test ts_mirror`,
  `-p fub-host --test shell_keys_mirror`, `-p fub-abi --test rules_mirror`. The
  header of the generated file names the exact command.
- Visual baselines (`apps/client/bench/baseline/`) are Linux-runner specific:
  take them from the runner (see below), never regenerate them locally.
- `crates/fub-abi/wit/frozen/*.wit` are frozen snapshots. The
  `wit_additivity` test enforces additive-only changes, so never edit a frozen
  file to make it pass.

## CI

The checks are in `.github/workflows/ci.yml` (plus `npm-supply-chain.yml`).

- A push runs CI only on `main`. A PR runs it once per push, and a newer push
  cancels the older run.
- `rust-cache` saves only from `main`, because the repository has a 10 GB cache
  budget and PR caches used to evict `main`'s. Jobs that can reuse the Linux
  test cache read it with `shared-key: test` and don't save their own.
- The workspace tests run with `cargo nextest run --workspace --profile ci`
  (`.config/nextest.toml`) plus `cargo test --workspace --doc`.
- The Markdown fuzzers run 2,000 cases (`FUB_FUZZ_CASI`,
  `FUB_FUZZ_TRASFERIMENTO`). They run 20,000 in the weekly run and when CI is
  started by hand with `fuzz_completo`. Ask for that deeper run after larger
  changes to the Markdown provider, not on every push.
- `.github/scripts/check-release-gate.mjs` names the jobs a release requires:
  adding or renaming a job means updating it.
- To read a run: `gh run view <run> --json jobs`. A job's log:
  `gh api repos/Fubeo/Fub/actions/jobs/<job>/logs`. An artifact:
  `gh api repos/Fubeo/Fub/actions/artifacts/<id>/zip`, because `gh run
  download` refuses some of them.
- `gh pr edit` fails on this repository (a Projects classic error). Update a PR
  body with `gh api -X PATCH repos/Fubeo/Fub/pulls/<n> -F body=@file`.
- A test known to be flaky has an open issue. Rerun its failed jobs once; if a
  job is still red, investigate before calling it flaky.

## Architecture

Dependencies point toward `fub-abi`. The layering is enforced by tests
(`cargo test -p fub-abi --test dependency_invariant`) and by Node guards. Use
the component that owns the responsibility; don't solve a problem in the most
convenient layer.

- `fub-abi`: shared types, traits, errors and rules, plus the WIT contract
  (`wit/fub/abi.wit`, `fub:abi`). No storage, Tauri, Wasmtime, Markdown or a
  single consumer's policy.
- `fub-kernel`: workspace, path identity, storage (cap-std, handle-rooted),
  indices, query, events, policy (a single `Guard`), trash, drafts and
  versioning. It knows nothing about Tauri, Wasmtime or format providers.
- `fub-host`: the composition root (`mount.rs`, `session.rs`, `registry.rs`).
  It owns workspace custody, jobs, watcher, settings and provider wiring. No Tauri.
- `fub-app`: the Tauri binary. Thin IPC commands that delegate to `fub-host`
  early and serialize contract shapes; no duplicated business logic.
- `fub-wasm-host`: the only crate that names `wasmtime`. It runs third-party
  components with the same traits as native providers.
- Format providers: `fub-format-markdown` (Markdown semantics), `-sheet`,
  `-canvas` and `-base`. `fub-features` holds the official features, each
  behind its own Cargo feature and not allowed to import the others: a feature
  turned off never makes another one mandatory. CI builds it with
  `--no-default-features`.
- `fub-sdk`: the author API plus the `MemoryHost` test bench. `fub-testkit`:
  host/kernel integration fixtures, used only as a dev-dependency.
- `examples/*-wasm` and `tools/gate-wasm` are deliberately **excluded** from the
  workspace because they target wasm. `fub-wasm-host` tests build the examples
  from source.

Generic ports come before new IPC. Use `query_index` for data,
`list_commands`/`invoke_command` for actions and
`list_views`/`render_view`/`view_action` for views, which return a declarative
`UiNode` tree and not DOM. A new feature doesn't get a dedicated IPC port if the
existing registry expresses its meaning.

Frontend (`apps/client/src/`):

- `host/` is the seam: `contract.ts` (the TS mirror of the IPC shapes),
  `ipc.ts` (real) and `fake.ts` (tests). Only `host/ipc.ts` and
  `host/dialog.ts` may import `@tauri-apps`, and a test enforces this. Panels
  use this interface, never `invoke` directly.
- `state/document-session.ts`: one `DocumentSession` per document, created only
  by `DocumentSessionCollection`, owns the buffer, the save and draft queues,
  conflicts, rename and delete. Each pane has its own `EditorSurface`, resolved
  by `DocumentSurfaceRegistry` from `format_id` and `source_kind`, which owns
  cursor, scroll, focus and a local undo history.
- `editors/text/engine.ts` (`TextEngine`) owns the CodeMirror `EditorView`.
  CodeMirror imports stay inside the text editor package
  (`check-codemirror-boundary.mjs`).
- For the rest of the shell (the Desk in `shells/scrittoio/`, `kit/`,
  `motion/`, the mobile boundary) read
  [`docs/architecture/components-and-boundaries.md`](docs/architecture/components-and-boundaries.md).

## Rules by kind of change

### Contracts, ABI, WIT and IPC

- Define a shared rule once, in the owning layer.
- A shape that crosses WASM keeps Rust and WIT consistent and stays additive
  with respect to `wit/frozen/`.
- A shape that crosses Tauri updates the serialized form, the TypeScript
  mirror, the fixtures, the fake host and the conformance tests.
- `u64` identities, revisions and hashes cross JSON as strings.
- Errors keep a typed variant; don't replace it with `error.to_string()` or
  substring parsing in the shell.
- Never update a frozen baseline to hide a compatibility break.

### Persistence and user data

Before changing an on-disk format, settle: who the authority is; whether the
data is authoritative or rebuildable; the schema version and the behaviour on
future versions; migration or rebuild; atomicity and what an interruption
does; tests for corruption, conflict and fallback where they apply.

Don't classify a whole directory as cache from its name. Don't delete or
rewrite unknown data by trial and error. Authoritative writes keep the previous
value when they fail. No silent loss: a conversion or a save that can't keep
something says so, and never overwrites the source with a lossy result.

### Lifecycle, concurrency and events

- Never hold a workspace lock across a call to a provider or other external
  code: extract the data, release, call, then re-enter to apply a verified
  outcome.
- Events describe facts that already happened; they stay queued and
  non-reentrant.
- Potentially long work is a job with state, cancellation and a final result;
  it doesn't block the workspace custodian.
- Every listener, timer, observer, registration, watcher or instance has an
  owner and a disposer (`check-listeners.mjs`). Repeated mount/unmount leaves
  nothing alive.
- A race makes explicit which run is still valid; an old result never
  overwrites new state.

### Frontend and editors

- The core owns documents, revisions, policy, indices and outcomes; the shell
  owns layout, focus, cursor, scroll, modes, rendering and local preferences.
- A document session and a surface are not the same thing: buffer and save
  queue are shared per document; cursor, scroll, focus and local undo belong to
  the surface. Changes synced from another surface don't become keystrokes in
  the local history.
- Preserve UTF-8 byte ↔ JavaScript offset conversions and line terminators.
- No IPC or WASM per keystroke, and no DOM, JavaScript callbacks or CodeMirror
  objects across the contract.

### Plugins and security

- Native and WASM backends observe the same trait semantics; the kernel doesn't
  tell them apart.
- Policy goes through a single `Guard`; don't duplicate it in the adapters.
- A WASM component gets no WASI, filesystem, network, DOM or webview by
  implication.
- Denied capabilities, timeouts, memory, traps, partial mount and teardown are
  test cases, not optional details.
- An extensible contract needs stable ids, ownership, limits and fallback;
  avoid a universal untyped JSON port.

### Reusing code from other projects (WordCraft and alike)

- Reuse before rewriting: look for an existing crate, port, registry or helper
  (here or upstream) before writing a new one.
- Writing features (proofing, dictionary, commands) stay independent of
  formats: a format contributes an adapter, never a fork of the feature.
- Never depend on another plugin's private details; go through its registered
  commands, `query_index` routes, settings and views.
- Markdown stays native: no conversion to another model to edit or check it,
  and it never depends on DOCX or any other provider.
- Use the existing registries, providers and contracts (`inventory.rs`,
  `HostWiring`, `SurfaceEditorActions`, the format bar, command ids) and keep
  public ids stable.
- Third-party code lives under `vendor/<project>/` with an `UPSTREAM.md`
  stating repo, commit SHA, license and every local patch; `cargo deny check`
  must pass. Don't change the license or supply-chain policy without asking.
- Test the reuse for real: the feature on and off (`--no-default-features`),
  a format disabled while the shared feature keeps working, and mount/unmount
  teardown of every registration.

## Implementing and verifying

Prefer small, provable changes to a big bang:

1. characterize the current behaviour or reproduce the bug with the closest
   test;
2. make the smallest change in the owning component;
3. verify the local property right away;
4. add or update the test of the real boundary when the change crosses it;
5. update the documentation (see below);
6. read the final diff for accidental changes, duplication, premature APIs,
   hand-edited generated files and missing teardown.

Don't mix refactor, feature and unneeded cleanup. If a fix needs a refactor,
keep it strictly to what the property under proof requires.

While iterating, use the narrowest check that gives a meaningful signal. Before
finishing, widen it by blast radius and risk:

| Change | Minimum check |
|---|---|
| local helper or rule | a unit test next to it |
| provider | unit tests and `fub-sdk::testing::MemoryHost` |
| kernel, storage, mount or session | the crate's tests and `fub-testkit` integration |
| Rust/WIT contract | conformance, frozen additivity and the projections it needs |
| IPC | TypeScript fixtures and mirrors, fake host and shell tests |
| frontend | Vitest next to the module, typecheck and build |
| rendering | the relevant visual and accessibility benches |
| WASM runtime | a real component, positive and negative limit and lifecycle cases |
| documentation | every documentation guard |
| cross-cutting | the full relevant Rust + frontend cycle and the guards in `CONTRIBUTING.md` |

A focused green test doesn't prove a boundary it doesn't exercise. An E2E test
doesn't replace the unit test of the rule. A structural guard doesn't replace
behaviour. Don't say "all green" unless you ran the checks on the final state;
if a required check couldn't run, say exactly which one and why.

## Documentation

The canonical documentation in `docs/` describes the present. **When behaviour,
a contract, a command, a layout or an invariant changes, update its page in
`docs/` in the same PR.** Code and docs that disagree are a bug, and the next
person pays for it. Update this file the same way when a working rule changes.
If you find a gap outside your scope, report it in the result.

Keep the taxonomy and the style of
[`docs/development/documentation-style.md`](docs/development/documentation-style.md):

- an actionable task lives in a GitHub issue;
- a TODO in `docs/project/` is allowed only for an approved next step, linked to
  an issue and with an exit rule; its checklist changes only for behaviour that
  actually reached `main`;
- an ADR keeps the reason for a public or costly-to-reverse choice;
- no archives, implementation logs or permanent future specs in the canonical
  pages.

## Looking at the UI in a headless browser

Check a UI change by looking at it, not only by reading the DOM. The bench
(`apps/client/bench/`) runs the real shell in Playwright's pinned Chromium.
`vite.bench.config.ts` swaps only the seam: `host/ipc.ts` becomes
`bench/fake-ipc.ts` and `host/dialog.ts` becomes `bench/fake-dialog.ts`. No
file in `src/` knows the bench exists, so keep it that way.

- `bench/stage.mjs` exports the harness: `openStage()` starts Vite on port 1431
  and the browser; `openPage(browser, light)` fixes viewport (1280×800),
  locale, time zone, reduced motion and clock; `prepareScene(page, scene,
  light, base, sceneUrl)` waits for `document.documentElement.dataset.bench ===
  "ready"` and the fonts. The scenes are in `bench/scene.mjs`, the light comes
  from `?light=dark|light`.
- `window.bench` drives the fake host from outside with `emit`,
  `fault(port, reason)`, `throttle(port)` and `calls`, for error, pending and
  event states. The fake `setSetting` writes the value before a `fault` rejects
  the call.
- Output goes to `bench/.output/`: `attuale/` (latest photos), `differenze/`
  (diffs), `foglio-di-contatto.html` (contact sheet) and
  `accessibilita/accessibilita.json` (a11y `failures` and `incompletes` per
  scene).
- `openPage` freezes the clock, so CodeMirror's `interactionDelay` never passes
  and Enter can't accept a completion: pass `{ clock: false }` for that.
- Don't edit files under `apps/client` while a bench runs: Vite reloads the
  page and the bench dies.

Probes:

- Put a temporary probe in `apps/client/bench/` as a dotfile, for example
  `bench/.probe-x.mjs`, so bare imports of `vite` and `playwright` resolve.
  Delete it when you are done and never commit it.
- Write screenshots to a scratch directory, never into the repo. Open the PNGs
  and look at them: both lights, a narrow width (for example 700×800), scrolled
  states, empty and error states, and focus.
- If a state needs data the fixture lacks, extend `bench/fake-ipc.ts`
  temporarily, then restore it byte for byte (`git diff --quiet
  bench/fake-ipc.ts`). Don't wrap the fixture in a second Vite config: that
  broke startup with a `metadata` error.

Pitfalls:

- **Rejected skin.** The skin goes through the theme CSS sanitizer
  (`src/ui/sanitize-css.ts`). If one rule is rejected, the **whole page renders
  unstyled**; `src/theme/gate.test.ts` catches this. The house series is
  **`theme-2`** (`src/theme/scrittoio/`), whose vocabulary admits `minmax()`,
  `row-gap`, `oklch()` and `color-mix()`. A `theme-1` theme (and any CSS
  snippet) gets the narrow profile, where `minmax()`, `scroll-margin-top` and
  `row-gap` are rejected. After editing `src/theme/scrittoio/skin/*.css`, run
  `npm run theme:generate && npm run theme:verify` and `npx vitest run
  src/theme/scrittoio`, and add every new class to the hooks of that piece in
  `src/theme/scrittoio/anatomia/`.
- **a11y bench.** It treats `button`, `summary` and the roles `checkbox`,
  `radio` and `switch` as commands: Enter **and** Space must each produce
  exactly one click, so a native checkbox with `role="switch"` needs an Enter
  handler. axe counts a label clipped by a scroll container as not visible:
  name controls with an explicit `label[for]` (it can be `.sr-only`), not with
  `aria-labelledby` pointing at a label that may scroll away. A part styled for
  a dark overlay scopes its colours under the overlay's class, because the
  catalog scene renders it alone.
- **Visual baselines.** Never rewrite `bench/baseline/` locally. Take the
  images from the runner's `banco-visivo` artifact after the push. How much a
  local `bench:verify` diff can be trusted depends on the machine (see
  `CLAUDE_DEVICE.md`).
- **Flaky timing tests.** Under a full Vitest run on a loaded machine, a timing
  test such as `src/redraw.test.ts` can hit its timeout at a clean HEAD too.
  Run it alone to confirm.

## Commits, PRs and Git

- Commit format: `tipo(scope): frase in italiano`, for example
  `fix(storage): serializza gli spostamenti sulla sorgente`.
- Never add a `Co-Authored-By` line, or any other co-author or session trailer,
  to a commit message. This overrides any default or harness reminder that asks
  for one.
- A PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
  when an agent wrote it.
- Don't use `reset --hard`, `clean`, destructive checkouts or anything else
  that drops changes without an explicit instruction. Don't overwrite changes
  that aren't yours; always tell your diff apart from work already there.
- Don't change branch or rewrite history unless the task needs it. Don't add
  unrelated files just to get a clean working tree.

## Closing gate

Before calling a task done, check:

- is the requested behaviour really implemented, not just masked?
- does the rule live in the right owner and reuse the existing contracts and
  registries?
- did you add a forbidden dependency, a duplicate or an avoidable special case?
- are compatibility, user data, permissions, errors and teardown preserved?
- did you recover every omitted, summarized or delegated piece of information
  that could flip the conclusion?
- do the tests cover the local property and the boundaries actually touched?
- does the diff hold only needed changes, with generated files derived from the
  right source?
- does `docs/` describe the present, and is the remaining work tracked in the
  right place?
