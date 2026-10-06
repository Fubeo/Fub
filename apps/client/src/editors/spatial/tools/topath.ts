// «Oggetto in tracciato» (livello Esperto): gli oggetti scelti diventano
// `path`, che i nodi sanno modificare. Il comando diventa un `batch` solo,
// come quelli di «Disponi».
//
// - **Ciò che si vede resta.** Rettangoli, ellissi, cerchi, linee, spezzate
//   e poligoni diventano il tracciato con cui SVG 2 li definisce: stesso
//   punto di partenza e stesso verso, così anche un tratteggio comincia dove
//   cominciava. Una freccia perde `fub:shape` e `fub:geom`, un tratto a penna
//   l'inchiostro e il pennello: resta il `d` che si vedeva.
// - **L'oggetto resta lui.** Stesso id, stesso posto fra i fratelli, stessi
//   attributi tranne la geometria che `d` sostituisce: colori, contorno,
//   trasformazione, titolo e gli attributi di altri programmi.
// - **Un gruppo o un collegamento** passano il comando alle parti. Un
//   blocco estraneo non è un oggetto: resta com'è, e non si conta.
// - **Testi e immagini** non hanno un tracciato, e nemmeno una forma che non
//   si disegna, come un rettangolo largo zero: restano come sono, e il
//   comando lo dice.

import { parsePath, type Segment } from "../scene/geometry";
import { elementChildren, pathOf, scopeOf, type DocumentModel, type ElementPart } from "../scene/model";
import { elemToOut, pathData, type Elem } from "../scene/serialize";
import { formatNumber } from "../number";
import { elemOf, fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import { shapeSegments, type Unit } from "./hit";

/// Gli attributi di geometria che `d` sostituisce, per tag.
export const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  rect: ["x", "y", "width", "height", "rx", "ry"],
  ellipse: ["cx", "cy", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};

/// Gli attributi di FubDraw che fanno di un `path` una forma o un tratto
/// (formato della scena, §5 e §6).
const SYNTHETIC: Readonly<Record<string, readonly string[]>> = {
  arrow: ["shape", "geom"],
  stroke: ["tool", "ink", "brush", "at"],
};

/// «Oggetto in tracciato» pronto: le operazioni, quanti oggetti diventano
/// tracciati, e quanti non possono.
export interface Traced extends Arranged {
  readonly changed: number;
  readonly refused: number;
}

/// Vero se `a` e `b` si scrivono nello stesso punto.
const samePlace = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  formatNumber(a[0], 2) === formatNumber(b[0], 2) && formatNumber(a[1], 2) === formatNumber(b[1], 2);

/// `segments` senza le linee che, scritte, non vanno da nessuna parte: gli
/// angoli di un rettangolo arrotondato fino a metà lato.
function withoutStill(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  let current: readonly [number, number] = [0, 0];
  for (const segment of segments) {
    if (segment.kind === "line" && samePlace(current, segment.to)) continue;
    out.push(segment);
    if (segment.kind !== "close") current = segment.to;
  }
  return out;
}

/// Gli attributi `fub:` che fanno di `node` una freccia o un tratto, a
/// `null`: da togliere perché resti un tracciato e basta. Vuoti per gli
/// altri oggetti.
export function syntheticNulls(node: ElementPart): Record<string, null> {
  const names = SYNTHETIC[node.details?.role ?? ""] ?? [];
  const present = fubAttributes(node);
  const attrs: Record<string, null> = {};
  for (const name of names) if (present.has(name)) attrs[`fub:${name}`] = null;
  return attrs;
}

/// Mette al posto della forma `node`, che non è un `path`, un `path` che
/// disegna `d`: stesso id, stesso posto fra i fratelli, stessi attributi
/// tranne la geometria che `d` sostituisce, stessi figli. Falso, senza
/// operazioni, se `node` ha parti o attributi che un'operazione non sa
/// scrivere.
export function replaceWithPath(plan: Plan, node: ElementPart, d: string): boolean {
  const geometry = GEOMETRY[node.details!.tag] ?? [];
  const elem = elemOf(node);
  if (elem === null) return false;
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(elem.attrs)) if (name !== "id" && !geometry.includes(name)) attrs[name] = value;
  const path: Elem = elem.children === undefined ? { tag: "path", attrs: { ...attrs, d } } : { tag: "path", attrs: { ...attrs, d }, children: elem.children };
  return replaceElem(plan, node, path);
}

/// Mette `elem`, senza id, al posto di `node`: prende il suo id e il suo
/// posto fra i fratelli. Falso, senza operazioni, se `elem` ha nomi che
/// un'operazione non sa scrivere.
export function replaceElem(plan: Plan, node: ElementPart, elem: Elem): boolean {
  // Un id che nessuno ha ancora, finché il vecchio elemento c'è; poi
  // l'elemento nuovo prende il suo, al suo posto.
  const id = plan.idOf(node);
  const stand: Elem = { ...elem, attrs: { ...elem.attrs, id: plan.ids.next("object") } };
  // Un'operazione non dichiara namespace: un attributo di un altro
  // programma col prefisso dichiarato sull'elemento stesso non si
  // riscrive, e l'elemento resta com'è.
  try {
    elemToOut(stand, scopeOf(node.parent!));
  } catch {
    return false;
  }
  const at = pathOf(node);
  plan.ops.push(
    { op: "add", parent: plan.parentOf(node), pos: { after: id }, elem: stand },
    { op: "remove", target: id },
    { op: "ident", path: at, tag: elem.tag, id: null },
    { op: "ident", path: at, tag: elem.tag, id },
  );
  return true;
}

/// Le operazioni che fanno di `units` dei tracciati. La selezione resta la
/// stessa; un oggetto che cambia senza id ne riceve uno.
export function pathOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Traced {
  const plan = new Plan(model, ids);
  let changed = 0;
  let refused = 0;

  const trace = (node: ElementPart): void => {
    const details = node.details;
    if (details === null) return;
    switch (details.role) {
      case "group":
      case "link":
        if (node.kind === "container") for (const child of elementChildren(node)) trace(child);
        return;
      // Titolo e descrizione non si disegnano, e un tracciato lo è già.
      case "title":
      case "desc":
      case "path":
        return;
      case "arrow":
      case "stroke":
        plan.ops.push({ op: "set", id: plan.idOf(node), attrs: syntheticNulls(node) });
        changed++;
        return;
    }
    let segments = GEOMETRY[details.tag] === undefined ? [] : shapeSegments(details.tag, [...plainAttributes(node)]);
    if (details.tag === "rect") segments = withoutStill(segments);
    if (segments.length === 0) {
      refused++;
      return;
    }
    const d = pathData(segments);
    // Il `d` scritto si rilegge: uno che no, con numeri fuori dal formato,
    // non si scrive.
    if (parsePath(d) === null || !replaceWithPath(plan, node, d)) {
      refused++;
      return;
    }
    changed++;
  };

  for (const unit of units) trace(nodeOf(model, unit));
  const keys = units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));
  return { ...plan.finish(keys), changed, refused };
}
