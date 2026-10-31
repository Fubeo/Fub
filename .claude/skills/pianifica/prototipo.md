# The prototype of a graphic task

Read this when the work changes what people see. The prototype is the screen
built in code before the real work, to look at and to reuse: a coder moves its
pieces into the real files, they don't redraw it.

## Where it lives

- One page per screen: `PLAN-ui/<schermata>.html`, committed with `PLAN.md` on
  the plan branch.
- Show it to the user as an Artifact (load the `artifact-design` guidance as the
  Artifact tool asks). Without the Artifact tool, render it with Playwright and
  show the screenshots.
- The user comments on the page; you change the file and republish to the same
  link. Approved means the user said so.

## Built from Fub, not from scratch

Read before drawing:

- `apps/client/src/theme/scrittoio/skin/<piece>.css`, the skin of the area, and
  `foundation.css` for the shared tokens;
- `apps/client/src/theme/scrittoio/anatomia/<piece>.ts`, the classes (hooks)
  and states the piece already has;
- the component you are changing, to mirror the DOM it builds.

Then:

- **Tokens:** use Fub's CSS custom properties with their real names. Copy the
  values the page needs, for both lights, into the prototype's `:root`, marked
  `/* da foundation.css */`. Never invent a colour or a size the theme has.
- **Classes:** reuse the existing hooks. A new class follows the naming of the
  piece and is listed in the plan's `Dal prototipo` table, because the coder
  must add it to the anatomy.
- **CSS:** one `<style>` block per destination file, opened by a comment with
  the destination (`/* → skin/drawers.css */`). Only the `theme-2` vocabulary of
  `src/ui/sanitize-css.ts`: one rejected rule leaves the whole app unstyled.
  Before asking for approval, run the CSS through `sanitizeThemeCss` in a
  throwaway Vitest probe and fix every rule it drops.
- **Structure:** the same elements, roles, ARIA and classes the component will
  build. No framework, no inline `style` (`check-inline-theme` forbids it).
- **Text:** real Italian strings, each with `data-i18n="<key>"` naming its key.
- **Accessibility:** controls named with `label[for]`; a command reacts to
  Enter and Space once each (the a11y bench checks both).

## What the page shows

A bar at the top of the page, outside the screen itself, switches between:

- every state: empty, full, loading, error, focus on the main control;
- light and dark;
- full width and 700 px.

Use realistic sample data, edge cases included: a very long name, zero items,
500 items.

## What goes in the plan

- `Prototipo:` in the header, with the approval date.
- The `Dal prototipo` table: each piece, its destination file, its task.
- In each graphic task, `Fatto quando` names the comparison: the bench
  screenshot, light and dark, matches the prototype.
