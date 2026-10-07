// Lo spessore variabile sul documento (livello Esperto): lo strumento
// Spessore e i profili del menu del contorno. Il contorno di una forma
// diventa una linea a spessore variabile, che il file scrive come forma piena
// del colore del contorno, con la linea e il profilo in `fub:geom`. Ogni
// comando diventa un `batch` solo, come quelli di «Disponi»; il profilo è in
// `profile.ts`.
//
// - **Una forma col contorno lo diventa al primo cambio**: la sua linea, con
//   gli estremi e gli angoli del contorno, uniforme col suo spessore. Senza
//   riempimento la linea prende il posto della forma e il suo id; piena,
//   la forma diventa un gruppo come in «Contorno in tracciato», col
//   riempimento sotto e la linea sopra.
// - **Il profilo uniforme riporta il contorno**: la linea torna un tracciato
//   col contorno del suo colore, spesso quanto il punto più largo, con gli
//   estremi e gli angoli che aveva.
// - **Una linea sola.** Un tracciato di più pezzi, un contorno tratteggiato,
//   un tratto a penna, una freccia, un testo e un'immagine restano come
//   sono, e il comando li conta.

import { pathOf, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { pathData } from "../scene/serialize";
import { spineOf, type WidthPoint } from "../scene/varwidth";
import { fubAttributes, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { strokeAsWidth, strokeOf, widthAsStroke } from "./paths";
import { flippedProfile, presetProfile, profileWidth, swappedProfile, widthAttrs, type Preset, type WidthShape } from "./profile";
import { replaceElem } from "./topath";

/// Una forma che lo strumento Spessore e i profili cambiano: la linea a
/// spessore variabile che è, o che diventa dal suo contorno.
export interface WidthTarget {
  readonly node: ElementPart;
  readonly shape: WidthShape;
  /// Vero se la forma non è ancora una linea a spessore variabile: il suo
  /// contorno lo diventa quando si scrive.
  readonly converts: boolean;
}

/// Perché una forma non ha una linea a spessore variabile: non ha un
/// contorno che si vede, il contorno è tratteggiato, la linea ha più pezzi,
/// viene da un altro programma, o non è una forma con una linea.
export type NoWidth = "unstroked" | "dashed" | "pieces" | "foreign" | "kind";

/// I ruoli il cui contorno diventa una linea a spessore variabile.
const CONVERTIBLE: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "ngon", "star"]);

/// La linea a spessore variabile di `node`, o perché non ne ha una.
export function widthTarget(node: ElementPart): WidthTarget | NoWidth {
  const details = node.details;
  if (details === null) return "foreign";
  if (details.role === "width") {
    const v = details.varwidth;
    return v === undefined ? "kind" : { node, shape: { cap: v.cap, join: v.join, profile: v.profile, spine: spineOf(v) }, converts: false };
  }
  if (!CONVERTIBLE.has(details.role)) return "kind";
  const stroke = strokeOf(node);
  if (stroke === null) return "unstroked";
  if (stroke.style.dashes.length > 0) return "dashed";
  if (stroke.segments.filter((segment) => segment.kind === "move").length !== 1) return "pieces";
  const h = stroke.style.width / 2;
  const profile: WidthPoint[] = [
    [0, h, h],
    [1, h, h],
  ];
  return { node, shape: { cap: stroke.style.cap, join: stroke.style.join, profile, spine: stroke.segments }, converts: true };
}

/// Scrive in `plan` la linea di `target` come `shape`: una linea a spessore
/// variabile cambia `fub:geom` e `d`, una forma lo diventa. Il percorso
/// della linea nel modello dopo le operazioni: dove stava la forma, o nel
/// gruppo che ne prende il posto, per ultima. `null`, senza operazioni, se
/// la linea non si scrive o la forma ha parti che non si scrivono.
export function writeWidth(plan: Plan, target: WidthTarget, shape: WidthShape): number[] | null {
  const written = widthAttrs(shape);
  if (written === null) return null;
  const path = pathOf(target.node);
  if (target.converts) {
    const elem = strokeAsWidth(target.node, written.geom, written.d, plan.ids);
    if (elem === null || !replaceElem(plan, target.node, elem)) return null;
    return elem.tag === "g" ? [...path, elem.children!.length - 1] : path;
  }
  const attrs: Record<string, string> = {};
  if (fubAttributes(target.node).get("geom") !== written.geom) attrs["fub:geom"] = written.geom;
  if (plainAttributes(target.node).get("d") !== written.d) attrs.d = written.d;
  if (Object.keys(attrs).length > 0) plan.ops.push({ op: "set", id: plan.idOf(target.node), attrs } satisfies Op);
  return path;
}

/// Scrive in `plan` la linea a spessore variabile di `target` come un
/// contorno uniforme spesso `width`. Falso, senza operazioni, se ha parti
/// che non si scrivono.
function writeStroke(plan: Plan, target: WidthTarget, width: number): boolean {
  const elem = widthAsStroke(target.node, pathData(target.shape.spine), width, target.shape.cap, target.shape.join);
  return elem !== null && replaceElem(plan, target.node, elem);
}

// ---------------------------------------------------------------------------
// I profili del menu.
// ---------------------------------------------------------------------------

/// Una voce dei profili: un profilo pronto, o il profilo rovesciato lungo la
/// linea o coi lati scambiati.
export type ProfileChange = { readonly preset: Preset } | { readonly flip: "along" | "across" };

/// I profili pronti: le operazioni; quante forme cambiano; quante il comando
/// non riguarda, come un testo o un contorno tratteggiato; e quante non
/// riesce a scrivere.
export interface Profiled extends Arranged {
  readonly changed: number;
  readonly skipped: number;
  readonly refused: number;
}

/// Ciò che diventa la linea di `target` con `change`: una linea nuova, il
/// contorno uniforme spesso tanto, o niente se resta com'è.
function profiled(target: WidthTarget, change: ProfileChange): WidthShape | { readonly stroke: number } | null {
  const { shape } = target;
  const width = profileWidth(shape.profile);
  if ("flip" in change) {
    // Un contorno uniforme resta uguale.
    if (target.converts) return null;
    return { ...shape, profile: change.flip === "along" ? flippedProfile(shape.profile) : swappedProfile(shape.profile) };
  }
  if (change.preset === "uniform") return target.converts ? null : { stroke: width };
  // La goccia finisce tonda dalla parte piena.
  return { ...shape, profile: presetProfile(change.preset, width), cap: change.preset === "drop" ? "round" : shape.cap };
}

/// Vero se `a` e `b` hanno lo stesso profilo, la stessa linea e gli stessi
/// estremi e angoli.
const sameShape = (a: WidthShape, b: WidthShape): boolean =>
  a.cap === b.cap && a.join === b.join && a.spine === b.spine && a.profile.length === b.profile.length &&
  a.profile.every((point, k) => point.every((value, i) => value === b.profile[k]![i]));

/// Le operazioni che danno `change` alle forme di `units`, e dentro i
/// gruppi e i collegamenti alle parti non bloccate. La selezione resta la
/// stessa.
export function profileOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], change: ProfileChange, ids: NewIds): Profiled {
  const plan = new Plan(model, ids);
  let [changed, skipped, refused] = [0, 0, 0];
  const visit = (unit: Unit): void => {
    if (unit.role === "group" || unit.role === "link") {
      for (const child of index.children(unit)) visit(child);
      return;
    }
    const target = widthTarget(unit.node);
    if (typeof target === "string") {
      skipped++;
      return;
    }
    const next = profiled(target, change);
    if (next === null || ("profile" in next && sameShape(next, target.shape))) return;
    if ("stroke" in next ? writeStroke(plan, target, next.stroke) : writeWidth(plan, target, next) !== null) changed++;
    else refused++;
  };
  for (const unit of units) visit(unit);
  return { ...plan.finish(units.map((unit) => plan.keyOf(unit.node, unit.key))), changed, skipped, refused };
}

/// Vero se fra `units`, o dentro i loro gruppi, c'è una forma che i profili
/// cambiano.
export function holdsWidth(index: SceneIndex, units: readonly Unit[]): boolean {
  return units.some((unit) => (unit.role === "group" || unit.role === "link" ? holdsWidth(index, index.children(unit)) : typeof widthTarget(unit.node) !== "string"));
}

/// I profili delle linee a spessore variabile di `units`, e dentro i loro
/// gruppi: per segnare nel menu quello che hanno tutte.
export function widthsOf(index: SceneIndex, units: readonly Unit[]): WidthShape[] {
  const out: WidthShape[] = [];
  const visit = (unit: Unit): void => {
    if (unit.role === "group" || unit.role === "link") for (const child of index.children(unit)) visit(child);
    else {
      const target = widthTarget(unit.node);
      if (typeof target !== "string") out.push(target.shape);
    }
  };
  for (const unit of units) visit(unit);
  return out;
}
