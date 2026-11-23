# Fub, what it is and how it looks

Read this page before designing anything for Fub: a `/pianifica` plan, a
prototype ([prototipo.md](prototipo.md)), a
[`progettista`](../../agents/progettista.md) design that changes what people
see. A plan or a prototype that doesn't feel like Fub is not finished, however
correct it is. This page only points at the sources; when it and a source
disagree, the source wins (code and tests first, as `CLAUDE.md` says).

## The maintainer's criterion

In their words: «voglio ottenere la qualità massima possibile e non mi interessa
di finire tutto subito, anzi, meglio che aspettiamo piuttosto che vedere subito
un risultato mediocre. Voglio che tutto funzioni alla perfezione, che la scelta
sia la più open, che dia più possibilità all'utente, la più flessibile, la più
solida, la più sicura. Non voglio fare una scelta pigra in nessun caso».

So, in this order: no data loss; security; more choice for the person using
Fub (a setting whose default does the most prudent thing); open, compatible
formats; then everything else. Never a lazy choice, never a «per ora» without
a reason. The general order of success is in `CLAUDE.md`; what the
orchestrator decides alone and what it asks is in `DECISIONS.md` («Il
criterio» and the sections after it).

## What Fub is

Read [`docs/product/overview.md`](../../../docs/product/overview.md)
(«Principi»).

- A knowledge manager, an operating system for knowledge, used for anything:
  notes, documents, spreadsheets, PDFs, drawings, boards.
- **Local-first.** Opening, editing and searching need no account and no
  network.
- **The user's files stay authoritative.** They stay files that other programs
  read and write (Obsidian, Word, Excel, LibreOffice…). Fub never converts a
  file to edit it and never overwrites a source with a lossy result: what it
  can't keep, it says, and it keeps the rest byte for byte.
- **Formats are providers**, features are registered, extensions go through
  the same ports as official code (see «Architecture» in `CLAUDE.md`). A new
  need first looks for an existing registry, port, kit piece or command.
- **The person decides.** Space, density, look, tools, keys: when people can
  reasonably want different things, it is a setting, with the prudent choice
  as default. Nothing happens behind their back (an external app never starts
  on its own; a consent is asked once and can be changed in Settings).
- **One way across Fub.** The same gesture, the same piece, the same words in
  every editor. A new editor reuses the kit (`apps/client/src/kit/`) before
  it adds a piece; a piece two editors need goes into the kit.
- The interface speaks **simple Italian**, with real sentences, never a raw
  key, an id or a technical term the person doesn't need. Strings live in
  `apps/client/src/i18n/`.

## How Fub looks

The window is the **Scrittoio** (ADR
[0208](../../../docs/decisions/0208-la-finestra-e-lo-scrittoio.md)): sheets on a
desk, drawers at the sides, a thin chrome around the work. The maintainer's own
words for its style: «moderno, minimale e stondato».

- **Content first.** Every surface has three layers (ADR
  [0222](../../../docs/decisions/0222-tre-strati-e-l-aspetto-del-contenuto.md)):
  the frame (bars, panels, menus) and Fub's marks belong to the theme; the
  content belongs to the file or the theme as the mode declares. The frame is
  quiet so the content leads.
- **Rounded, soft, light.** Controls and chips use the theme's radii
  (`--radius-control`, `--radius-chip`), the accent shows as soft washes
  (`--accent-soft`, `--accent-veil`) more than as filled blocks, surfaces are
  separated by space and a low shadow more than by lines. Never invent a
  colour or a size: the values come from the theme recipe
  (`apps/client/src/theme/scrittoio/recipe.ts`, generated into
  `sheet-*.css` by `npm run theme:generate`), the pieces are dressed by
  `apps/client/src/theme/scrittoio/structure.css` and
  `apps/client/src/theme/scrittoio/skin/` (start from `foundation.css`).
- **No clutter.** Line icons (`apps/client/src/ui/icons.ts`); no ornaments;
  few visible borders and dividers; group labels and secondary commands only
  where they help. A toolbar or a ribbon is the kit's
  (`kit/options-bar.ts`, `kit/tool-rail.ts`, `kit/ribbon/`) in Fub's skin,
  never a look copied from another program.
- **Colours:** a colour is chosen with the kit's well and picker
  (`kit/color/well.ts`, `kit/color/picker.ts`); the eight suggested colours
  (the Okabe–Ito palette, `apps/client/src/ink/palette.ts`) appear as round,
  named swatches, never as coloured shapes («formine»): the maintainer finds
  them ugly.
- **The person sizes the chrome.** How much space the bars around the sheets
  take is the person's choice (`chrome.compactness`,
  `apps/client/src/shells/scrittoio/space.ts`); the sheets' tabs are not part
  of it.
- **One motion.** Movement comes from `apps/client/src/moto/` (springs, calm
  and reduced levels); nothing animates on its own outside work in progress.
- **No inline styles.** The CSP refuses a `<style>` or a `style` attribute in
  markup: a prototype's CSS goes into skin files, never into the page
  ([`docs/reference/styles-and-csp.md`](../../../docs/reference/styles-and-csp.md)
  lists the four ways a style may take).
- **Everyone.** Light and dark, high contrast and forced colours, 700 px and
  the phone, mouse, keyboard, touch and pen. Every command reachable by
  keyboard; the accessibility bench (`npm run bench:a11y` in `apps/client/`)
  is part of «done». How to look at the result:
  [`../banco/SKILL.md`](../banco/SKILL.md) and
  [`docs/development/visual-bench.md`](../../../docs/development/visual-bench.md).

## The style, seen

These pages are the maintainer's approved references. Read them (`Artifact
read`, when you have the tool) before designing something similar.

| What | Where |
|---|---|
| the Scrittoio, the window as a whole | https://claude.ai/artifact/5ubTMYNwh9sxEmTLZT7zK3 |
| the Scrittoio refinement (motion, less noise) | https://claude.ai/artifact/J5XARE6UHZmhDhMBgbgNvu |
| the drawing editor | https://claude.ai/artifact/7E7gZgAkEBF9wo6W9beQKo |
| the board's pens | https://claude.ai/artifact/23QQ85Cw2sZA19A2r6Pxg5 |
| the Craft file previews | https://claude.ai/artifact/KyrZ98WWLkJTHbPHDHbNAh |

And the code that is already the style: `apps/client/src/kit/`,
`apps/client/src/ui/menu.ts`, and in `apps/client/src/theme/scrittoio/skin/`
the files `controls.css`, `menus.css`, `kit.css`, `drawers.css`, `frame.css`.

## Choosing like Fub

When a choice is yours (a planner's assumption, a design detail the plan
leaves open), prefer, in this order:

1. the option that loses nothing and can be undone;
2. the one that keeps files open and compatible with other programs;
3. the one that gives the person the choice, with the prudent default;
4. the one that reuses a piece Fub already has, so Fub behaves one way;
5. between two that are equally good, the quieter one on screen.

Write the choice and its reason where the plan keeps its assumptions
(`Assunzioni` in `PLAN.md`), so the maintainer can read it and change it.
