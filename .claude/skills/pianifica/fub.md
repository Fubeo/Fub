# Fub, what it is and how it looks

Give this page to every planner before it designs anything: the `/pianifica`
session, a planner subagent launched by `/orchestra` or `/orchestra-auto`, a
prototype. A plan or a prototype that doesn't feel like Fub is not finished,
however correct it is. This page points at the sources; when it and a source
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
a reason.

## What Fub is

Read [`docs/product/overview.md`](../../../docs/product/overview.md) («Principi»).

- A knowledge manager, an operating system for knowledge, used for anything:
  notes, documents, spreadsheets, PDFs, drawings, boards.
- **Local-first.** Opening, editing and searching need no account and no
  network.
- **The user's files stay authoritative.** They stay files that other programs
  read and write (Obsidian, Word, Excel, LibreOffice…). Fub never converts a
  file to edit it and never overwrites a source with a lossy result: what it
  can't keep, it says, and it keeps the rest byte for byte.
- **Formats are providers**, features are registered, extensions go through
  the same ports as official code. A new need first looks for an existing
  registry, port, kit piece or command.
- **The person decides.** Space, density, look, tools, keys: when people can
  reasonably want different things, it is a setting, with the prudent choice
  as default. Nothing happens behind their back (an external app never starts
  on its own; a consent is asked once and can be changed in Settings).
- **One way across Fub.** The same gesture, the same piece, the same words in
  every editor (for example the pen's thickness slider on the board, in
  drawings and in documents). A new editor reuses the kit before it adds a
  piece.
- The interface speaks **simple Italian**, with real sentences, never a raw
  key or a technical term the person doesn't need.

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
  separated by space and a low shadow more than by lines. Read the real tokens
  in `apps/client/src/theme/scrittoio/skin/foundation.css` and
  `structure.css`; never invent a colour or a size.
- **No clutter.** Line icons; no ornaments; few visible borders and dividers;
  group labels and secondary commands only where they help. It must not look
  like Office or a generic toolbar: the maintainer turned down a sheets ribbon
  prototype for being «troppo simile a excel e a tutti gli altri editor
  simili» (K3, 2026-11-03).
- **Colours:** a colour is chosen with the kit's well and picker; the eight
  suggested colours appear as round, named swatches. The coloured Okabe–Ito
  «formine» must not appear anywhere: the maintainer finds them ugly.
- **The person sizes the chrome.** How much space the bars around the sheets
  take is the person's choice (`chrome.compactness`); the sheets' tabs are not
  part of it.
- **One motion.** Movement comes from `apps/client/src/moto/` (springs,
  the calm mode, reduced motion); nothing animates on its own outside work in
  progress.
- **Everyone.** Light and dark, high contrast and forced colours, 700 px and
  the phone, mouse, keyboard, touch and pen. Every command reachable by
  keyboard; the accessibility bench is part of «done».

## The style, seen

These pages are the maintainer's approved references. Read them (`Artifact
read`, when you have the tool) before designing something similar; the
prototypes also live as files on their plan branches.

| What | Where |
|---|---|
| the Scrittoio, the window as a whole | https://claude.ai/artifact/5ubTMYNwh9sxEmTLZT7zK3 |
| the Scrittoio refinement (motion, less noise) | https://claude.ai/artifact/J5XARE6UHZmhDhMBgbgNvu |
| the drawing editor | https://claude.ai/artifact/7E7gZgAkEBF9wo6W9beQKo |
| the board's pens (N4) | https://claude.ai/artifact/23QQ85Cw2sZA19A2r6Pxg5, `piano/n4-inchiostro:PLAN-ui/lavagna-penne.html` |
| the Craft previews (N7) | https://claude.ai/artifact/KyrZ98WWLkJTHbPHDHbNAh, `piano/n7-file-craft:PLAN-ui/craft-anteprime.html` |

And the code that is already the style: `apps/client/src/kit/`, `src/ui/menu.ts`,
`src/theme/scrittoio/skin/` (`controls.css`, `menus.css`, `kit.css`,
`drawers.css`, `frame.css`).

## Choosing like Fub

When a choice is yours (a planner's assumption, an `/orchestra-auto`
decision), prefer, in this order:

1. the option that loses nothing and can be undone;
2. the one that keeps files open and compatible with other programs;
3. the one that gives the person the choice, with the prudent default;
4. the one that reuses a piece Fub already has, so Fub behaves one way;
5. between two that are equally good, the quieter one on screen.

Write the choice and its reason where the plan keeps its assumptions, so the
maintainer can read it and change it.
