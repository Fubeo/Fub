---
name: banco
description: How to look at a Fub UI change in the headless bench (Playwright + the real shell with a fake host), write probes and screenshots, and avoid the known pitfalls (rejected skin, a11y bench, visual baselines). Use before checking any change under apps/client visually.
---

# Looking at the UI in a headless browser

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
