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
import { DRAW } from "./anatomia/draw";
import { DRAW_DIALOGS } from "./anatomia/draw-dialogs";
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
import type { Layer, PartAnatomy, ShellComponent } from "./anatomia/types";

export { LAYERS, STATE_NAMES } from "./anatomia/types";
export type { ComponentState, Layer, PartAnatomy, ShellComponent, StateName } from "./anatomia/types";

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
  DRAW,
  MEDIA,
  NODES,
  GRAPH,
  MENUS,
  LAUNCHER,
  CENTRES,
  DRAW_DIALOGS,
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

/**
 * Le classi dell'aspetto del contenuto (`theme/content-look.ts`), che la shell
 * mette sulla radice della regione del contenuto. Sono hook anche quando la
 * pelle della casa non le nomina: un frammento scrive `.look-tema
 * .rich-heading`, e la meccanica di `look-file` e `look-adattato` sta in
 * `structure.css`, che non si tematizza.
 */
export const LOOK_HOOKS: readonly string[] = ["look-tema", "look-file", "look-adattato"];

/** Le classi che una pelle `theme-2` può nominare. */
export const HOOKS: readonly string[] = [
  ...new Set([...PARTS.flatMap((part) => part.components.flatMap((component) => component.hooks)), ...LOOK_HOOKS]),
];

/** Gli hook di un pezzo: ciò che il suo CSS deve nominare, né più né meno. */
export function hooksOf(part: string): readonly string[] {
  const found = PARTS.find((candidate) => candidate.part === part);
  return found ? [...new Set(found.components.flatMap((component) => component.hooks))] : [];
}

/** Lo strato di un hook in un componente: il suo, quello del componente o
 * quello del pezzo. */
function layerIn(part: PartAnatomy, component: ShellComponent, hook: string): Layer {
  return component.layers?.[hook] ?? component.layer ?? part.layer;
}

/**
 * Gli hook che due componenti dichiarano di due strati diversi, come
 * `hook: strato, strato`. Il presidio lo vuole vuoto: un hook ha uno strato
 * solo, e chi lo condivide lo dichiara uguale.
 */
export const LAYER_CONFLICTS: readonly string[] = (() => {
  const seen = new Map<string, Set<Layer>>();
  for (const part of PARTS) {
    for (const component of part.components) {
      for (const hook of component.hooks) {
        const layers = seen.get(hook) ?? new Set<Layer>();
        layers.add(layerIn(part, component, hook));
        seen.set(hook, layers);
      }
    }
  }
  return [...seen].filter(([, layers]) => layers.size > 1).map(([hook, layers]) => `${hook}: ${[...layers].join(", ")}`);
})();

/** Lo strato di ogni hook; per uno conteso vale il primo che lo dichiara. */
export const HOOK_LAYERS: Readonly<Record<string, Layer>> = (() => {
  const layers: Record<string, Layer> = {};
  for (const part of PARTS) {
    for (const component of part.components) {
      for (const hook of component.hooks) layers[hook] ??= layerIn(part, component, hook);
    }
  }
  for (const hook of LOOK_HOOKS) layers[hook] ??= "contenuto";
  return layers;
})();
