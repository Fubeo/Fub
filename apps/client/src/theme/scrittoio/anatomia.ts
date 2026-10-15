/**
 * L'inventario chiuso della shell Scrittoio: i pezzi, i loro componenti e gli
 * hook che una pelle `theme-2` può nominare.
 *
 * Qui non si elenca nessun hook: ogni pezzo dichiara i suoi nel modulo che gli
 * sta accanto (`anatomia/<pezzo>.ts`), e questo file li somma nell'ordine della
 * pelle. Un hook nominato da due pezzi (lo stato `selected`, il testo `muted`)
 * compare in tutti e due i moduli e una volta sola nell'unione.
 */
import { ORDER } from "./skin/order";
import { CENTRES } from "./anatomia/centres";
import { CONTROLS } from "./anatomia/controls";
import { DOCUMENT } from "./anatomia/document";
import { DRAWERS } from "./anatomia/drawers";
import { EDITORS } from "./anatomia/editors";
import { FOUNDATION } from "./anatomia/foundation";
import { FRAME } from "./anatomia/frame";
import { GRAPH } from "./anatomia/graph";
import { KIT } from "./anatomia/kit";
import { LAUNCHER } from "./anatomia/launcher";
import { MEDIA } from "./anatomia/media";
import { MENUS } from "./anatomia/menus";
import { MOTION } from "./anatomia/motion";
import { NODES } from "./anatomia/nodes";
import { SEARCH } from "./anatomia/search";
import { SETTINGS } from "./anatomia/settings";
import { SHEETS } from "./anatomia/sheets";
import { TREE } from "./anatomia/tree";
import { WELCOME } from "./anatomia/welcome";
import type { PartAnatomy, ShellComponent } from "./anatomia/types";

export { STATE_NAMES } from "./anatomia/types";
export type { ComponentState, PartAnatomy, ShellComponent, StateName } from "./anatomia/types";

const DECLARED: readonly PartAnatomy[] = [
  FOUNDATION,
  CONTROLS,
  KIT,
  FRAME,
  DRAWERS,
  TREE,
  SEARCH,
  SHEETS,
  DOCUMENT,
  EDITORS,
  MEDIA,
  NODES,
  GRAPH,
  MENUS,
  LAUNCHER,
  CENTRES,
  SETTINGS,
  WELCOME,
  MOTION,
];

/** I pezzi, nell'ordine in cui la pelle si monta. */
export const PARTS: readonly PartAnatomy[] = ORDER.map((name) => {
  const part = DECLARED.find((candidate) => candidate.part === name);
  if (!part) throw new Error(`anatomia: il pezzo «${name}» non ha un modulo`);
  return part;
});

/** Ogni componente, con il pezzo che lo veste. */
export const COMPONENTS: readonly (ShellComponent & { readonly part: string })[] = PARTS.flatMap((part) =>
  part.components.map((component) => ({ ...component, part: part.part })),
);

/** Le classi che una pelle `theme-2` può nominare. */
export const HOOKS: readonly string[] = [
  ...new Set(PARTS.flatMap((part) => part.components.flatMap((component) => component.hooks))),
];

/** Gli hook di un pezzo: ciò che il suo CSS deve nominare, né più né meno. */
export function hooksOf(part: string): readonly string[] {
  const found = PARTS.find((candidate) => candidate.part === part);
  return found ? [...new Set(found.components.flatMap((component) => component.hooks))] : [];
}
