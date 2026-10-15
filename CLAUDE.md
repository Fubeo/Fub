# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The working rules for agents live in `AGENTS.md` (in Italian) and apply in full.
This file adds a quick reference on top of them.

@AGENTS.md

## Project in brief

Fub is a local-first writing workspace: it opens vaults of Markdown files without
converting them. The core is a Rust workspace (`crates/`). The client is Tauri v2
plus Vite/TypeScript (`apps/client/`). Markdown is the first `FormatProvider`,
not a format built into the kernel. The code, comments, docs and commit messages
are written in **Italian**, so match that.

Toolchain: Rust 1.89, Node.js >=22.12.0 with **npm only** (`npm ci`, never
`npm install` during setup: it rewrites the lockfile). Tauri CLI v2. The
`wasm32-wasip2` target is needed for the full `fub-wasm-host` tests.

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
command that must stay in CI, between `ci-required:start/end`. The full set of
checks is in `.github/workflows/ci.yml`. The frontend CI job also runs
`check-codemirror-boundary`, `check-listeners`, `check-races` and
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
- Visual baselines (`apps/client/bench/baseline/`) are Linux-runner specific.
  Do not regenerate them on another OS.
- `crates/fub-abi/wit/frozen/*.wit` are frozen snapshots. The
  `wit_additivity` test enforces additive-only changes, so never edit a frozen
  file to make it pass.

## Architecture

Dependencies point toward `fub-abi`. The layering is enforced by tests
(`cargo test -p fub-abi --test dependency_invariant`) and by Node guards:

- `fub-abi`: shared types, traits, errors and rules, plus the WIT contract
  (`wit/fub/abi.wit`, `fub:abi`). It has no storage, Tauri, Wasmtime or Markdown.
- `fub-kernel`: workspace, path identity, storage (cap-std, handle-rooted),
  indices, query, events, policy (a single `Guard`), trash, drafts and
  versioning. It knows nothing about Tauri, Wasmtime or Markdown.
- `fub-host`: the composition root (`mount.rs`, `session.rs`, `registry.rs`).
  It owns workspace custody, jobs, watcher, settings and provider wiring. No Tauri.
- `fub-app`: the Tauri binary. It holds thin IPC commands that delegate to
  `fub-host` early, and it serializes contract shapes.
- `fub-wasm-host`: the only crate that names `wasmtime`. It runs third-party
  components with the same traits as native providers.
- Format providers: `fub-format-markdown`, `-sheet`, `-canvas` and `-base`.
  `fub-features` holds the official features, each behind its own Cargo feature
  and not allowed to import the others. CI builds it with
  `--no-default-features`.
- `fub-sdk`: the author API plus the `MemoryHost` test bench. `fub-testkit`:
  host/kernel integration fixtures, used only as a dev-dependency.
- `esempi/*-wasm` and `tools/varco-wasm` are deliberately **excluded** from the
  workspace because they target wasm. `fub-wasm-host` tests build the examples
  from source.

Generic ports come before new IPC. Use `query_index` for data,
`list_commands`/`invoke_command` for actions and
`list_views`/`render_view`/`view_action` for views, which return a declarative
`UiNode` tree and not DOM. `u64` identities, revisions and hashes cross JSON as
strings.

Frontend (`apps/client/src/`):

- `host/` is the seam. It holds `contract.ts` (the TS mirror of the IPC shapes),
  `ipc.ts` (real) and `fake.ts` (tests). Only `host/ipc.ts` and
  `host/dialog.ts` may import `@tauri-apps`, and a test enforces this.
- `main.ts` starts the **Scrittoio**, the one window: `shells/scrittoio/bootstrap.ts`
  composes it on top of `desktop-shell.ts` (sessions, panes, commands). The
  frame, sheets, launcher, preferences and the in-app confirm live in
  `shells/scrittoio/`. `kit/` holds the UI primitives (button, field, list,
  tabs, popover, dialog, splitter, hover card), `moto/` the springs, FLIP and
  gestures. `entrypoints/mobile*` and `shells/mobile` are the mobile boundary.
- `state/document-session.ts`: there is one `DocumentSession` per document,
  created only by `DocumentSessionCollection`. It owns the in-memory buffer, the
  save and draft queues, conflicts, rename and delete. Each pane has its own
  `EditorSurface`, resolved by `DocumentSurfaceRegistry` from `format_id` and
  `source_kind`. That surface owns the cursor, scroll, focus and a local
  CodeMirror history.
- `editors/text/engine.ts` (`TextEngine`) owns the CodeMirror `EditorView`.
  CodeMirror imports must stay inside the text editor package, which
  `check-codemirror-boundary.mjs` enforces. Profiles such as Markdown live
  under `editors/text/profiles/`.
- Every global listener, timer or observer needs an owner and a disposer, which
  `check-listeners.mjs` enforces.

Canonical docs start at `docs/README.md`. For cross-cutting work read
`docs/architecture/components-and-boundaries.md`, and before touching a public
or persistent contract read the relevant page in `docs/reference/`. Planning
files at the root (`todo.md`, `piano_*.md`, `HANDOFF-*.md`) describe work in
progress, not current architecture.

## Looking at the UI in a headless browser

Check a UI change by looking at it, not only by reading the DOM. The bench
(`apps/client/bench/`) runs the real shell in Playwright's pinned Chromium.
`vite.bench.config.ts` swaps only the seam: `host/ipc.ts` becomes
`bench/fake-ipc.ts` and `host/dialog.ts` becomes `bench/fake-dialog.ts`. No
file in `src/` knows the bench exists, so keep it that way.

### Harness

- `bench/stage.mjs` exports the harness:
  - `openStage()` starts Vite on port 1431 and the browser.
  - `openPage(browser, light)` fixes the viewport (1280×800), locale, time zone,
    reduced motion and clock.
  - `prepareScene(page, scene, light, base, sceneUrl)` waits for
    `document.documentElement.dataset.bench === "ready"` and the fonts.
- The scenes and their URLs are in `bench/scene.mjs`. The light comes from
  `?light=dark|light`.
- `window.bench` lets a script drive the fake host from outside with `emit`,
  `fault(port, reason)`, `throttle(port)` and `calls`. Use it for error, pending
  and event states. One catch: the fake `setSetting` writes the value before a
  `fault` rejects the call.
- Bench output goes to `bench/.output/`:
  - `attuale/` holds the latest photos;
  - `differenze/` holds the diffs;
  - `foglio-di-contatto.html` is the contact sheet;
  - `accessibilita/accessibilita.json` is the a11y report, with `failures` and
    `incompletes` per scene.

### Probes

- Put a temporary probe script in `apps/client/bench/` as a dotfile, for
  example `bench/.probe-x.mjs`. From there, bare imports of `vite` and
  `playwright` resolve. Delete it when you are done and never commit it.
- Write screenshots to a scratch directory, never into the repo. Open the PNGs
  and look at them.
- Look at both lights, a narrow width (`page.setViewportSize`, for example
  700×800), scrolled states, empty and error states, and focus.
- If a state needs data the bench fixture lacks, you can extend
  `bench/fake-ipc.ts` temporarily. Take the shots, then restore the file byte
  for byte and confirm with `git diff --quiet bench/fake-ipc.ts`.
  - Don't wrap the fixture in a second Vite config: that broke startup with a
    `metadata` error.

### Rules and pitfalls

- **Rejected skin.** The skin goes through the theme CSS sanitizer
  (`src/ui/sanitize-css.ts`). If one rule is rejected, the **whole page renders
  unstyled**; `src/theme/gate.test.ts` catches this.
  - The house series is **`theme-2`** (`src/theme/scrittoio/`), whose
    vocabulary admits `minmax()`, `row-gap`, `oklch()` and `color-mix()`. A
    `theme-1` theme (and any CSS snippet) still gets the narrow profile, where
    `minmax()`, `scroll-margin-top` and `row-gap` are rejected.
  - After editing `src/theme/scrittoio/skin/*.css`, run
    `npm run theme:generate && npm run theme:verify` and
    `npx vitest run src/theme/scrittoio`. Add every new class to the hooks of
    that piece in `src/theme/scrittoio/anatomia/`, or the anatomy test fails.
- **a11y bench (`npm run bench:a11y`):**
  - It treats `button`, `summary` and elements with role `checkbox`, `radio` or
    `switch` as commands: Enter **and** Space must each produce exactly one
    click. A native checkbox with `role="switch"` therefore needs an Enter
    handler.
  - axe counts a label clipped by a scroll container as not visible. Name
    controls with an explicit `label[for]`, which can be `.sr-only`, rather than
    `aria-labelledby` pointing at a label that may be scrolled away.
- **Visual baselines.** On `server-di-fub` the local bench reproduced 38 of 44
  runner baselines pixel for pixel, so a local `bench:verify` diff is a real
  signal. Still, never rewrite `bench/baseline/` locally. Take the images from
  the runner's `banco-visivo` artifact after the push:
  `gh api .../artifacts/<id>/zip`, because `gh run download` refuses that zip.
- **Flaky redraw test.** Under the full Vitest run on this machine,
  `src/redraw.test.ts` can hit its 5 s timeout. It does so at a clean HEAD too.
  Run it alone to confirm.

### On `server-di-fub` (no sudo, no system Chromium libraries)

Node is user-local, and Chromium's missing libraries and fonts were extracted
without root, from `apt-get download` plus `dpkg-deb -x`. Before any bench or
probe, from `apps/client/`:

```bash
export PATH=$HOME/.local/opt/node/bin:$PATH \
  LD_LIBRARY_PATH=$HOME/.local/opt/chrome-libs/root/usr/lib/x86_64-linux-gnu \
  FONTCONFIG_FILE=$HOME/.local/opt/chrome-libs/fonts.conf
```

- Without `FONTCONFIG_FILE`, Chromium aborts on the first page with a Skia
  `FATAL`.
- If the browser is missing, run `npx --no-install playwright install
  chromium`. Then check `ldd` on `chrome-headless-shell` for libraries that are
  still `not found`.
- The user watches the app live from their laptop over Tailscale at
  `http://100.122.193.79:5173/`. The config lives outside the repo, in
  `~/.cache/fub-live/`. Start it from `apps/client/` with
  `npx --no-install vite --config ~/.cache/fub-live/vite.live.config.mjs`.

## Commits

The format is `tipo(scope): frase in italiano`, for example
`fix(storage): serializza gli spostamenti sulla sorgente`.
