// Le etichette nelle forme nell'editor (Disegni, etichette; formato della
// scena, etichette): il testo scritto dentro un rettangolo, un rombo,
// un'ellisse o una forma delle raccolte, come nei diagrammi. Chi ha
// un'etichetta, e il riquadro del suo testo, sono di `label-hosts.ts`.
//
// - **L'etichetta sta al centro del riquadro del testo**, girata come la
//   forma e mai rovesciata da uno specchio, larga quanto il riquadro meno un
//   margine per parte, e ci va a capo. Non cresce con la forma: il corpo
//   resta quello scritto, come in Visio e PowerPoint, e ciò che non ci sta
//   in altezza esce sopra e sotto in parti uguali.
// - **Seguire** ([`followLabels`]) è un seguito del motore, come per i
//   connettori: dopo un'operazione che cambia la forma o l'etichetta,
//   l'etichetta torna al centro e va di nuovo a capo, nello stesso passo e
//   nello stesso annulla. Spostata da sola si stacca e resta un testo; così
//   anche quando la forma se ne va, esce dal gruppo o non è più chiusa.
// - **Una forma ha un'etichetta sola:** la prima che la nomina. Una forma in
//   un livello riceve l'etichetta in un gruppo nuovo con lei; una che sta già
//   in un gruppo la riceve accanto, nel suo gruppo. Un'etichetta svuotata se
//   ne va, e il gruppo che teneva soltanto lei e la sua forma si scioglie,
//   se nessuno lo nomina: la forma torna com'era.

import type { Bounds } from "../scene/geometry";
import { apply, compose, invert, rotate, translate, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { length } from "../scene/values";
import { elemOf, holdsEffects, nodeOf, Plan, unwrapIn, wrapIn, type Arranged } from "./arrange";
import { gesture, NewIds, transformValue } from "./edit";
import { among, lockedAbove, movedBy, SceneMatrices, touchedBy } from "./follow";
import { elemBounds, type Unit } from "./hit";
import { labelable, labelOf, labelledPair, labelTarget, textBox } from "./label-hosts";
import { textRich } from "./look";
import type { Measure } from "./measure";
import { lineText, richElem, type Rich, type RichLine } from "./rich";
import { replaceElem } from "./topath";
import { fontIn, reflow, WRAP, wrapOf, wrapValue } from "./wrap";

/// Il margine fra il riquadro del testo e le righe, per parte, in unità
/// della scena.
export const LABEL_PAD = 6;

/// Dove stanno sopra e sotto la linea di base i bordi di una riga, in volte
/// il corpo: come li misura il riquadro di un testo.
export const ASCENT_EM = 0.8;
export const DESCENT_EM = 0.25;

/// La distanza sotto la quale due numeri di una trasformazione sono gli
/// stessi: come li scrive il file, a quattro decimali.
const STILL = 1e-4;

// ---------------------------------------------------------------------------
// Dove sta l'etichetta.
// ---------------------------------------------------------------------------

/// Il riquadro del testo di una forma nella scena: il centro, l'angolo
/// delle righe in gradi, e la larghezza.
export interface LabelFrame {
  readonly centre: Point;
  readonly angle: number;
  readonly width: number;
}

/// Il riquadro del testo di `shape` nella scena, che `m` porta dalle sue
/// coordinate; `null` se non ne ha uno.
export function labelFrame(shape: ElementPart, m: Matrix): LabelFrame | null {
  const box = textBox(shape);
  if (box === null) return null;
  const centre = apply(m, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
  let angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  // Uno specchio non rovescia le righe: restano dritte, girate al più di un
  // quarto di giro da una parte o dall'altra.
  if (m[0] * m[3] - m[1] * m[2] < 0) {
    if (angle > 90) angle -= 180;
    else if (angle <= -90) angle += 180;
  }
  return { centre, angle, width: Math.hypot(m[0], m[1]) * (box.max[0] - box.min[0]) };
}

/// La larghezza delle righe nel riquadro `frame` per un testo di corpo
/// `size`: il riquadro meno il margine, almeno il corpo.
export function labelWidth(frame: LabelFrame, size: number): number {
  return Number(wrapValue(Math.max(size, frame.width - 2 * LABEL_PAD)));
}

/// Il corpo della prima riga di `rich`.
export function sizeOf(rich: Rich): number {
  return fontIn(rich, rich.lines[0] ?? { attrs: {}, spans: [] }, null).size;
}

/// L'altezza a metà delle righe di `rich`, nelle sue coordinate: fra la cima
/// delle maiuscole della prima riga scritta e il fondo dell'ultima, come il
/// riquadro di un testo. Senza niente da leggere, quella della prima riga.
export function blockMiddle(rich: Rich): number {
  let y = length(rich.attrs.y ?? "0") ?? 0;
  let top = Infinity;
  let bottom = -Infinity;
  let first: { readonly y: number; readonly size: number } | null = null;
  for (const line of rich.lines) {
    y += line.attrs.dy === undefined ? 0 : (length(line.attrs.dy) ?? 0);
    const size = fontIn(rich, line, null).size;
    first ??= { y, size };
    if (lineText(line) === "") continue;
    top = Math.min(top, y - ASCENT_EM * size);
    bottom = Math.max(bottom, y + DESCENT_EM * size);
  }
  if (top <= bottom) return (top + bottom) / 2;
  const only = first ?? { y, size: sizeOf(rich) };
  return only.y + ((DESCENT_EM - ASCENT_EM) / 2) * only.size;
}

/// Il centro del riquadro delle righe di `rich` in orizzontale, nelle sue
/// coordinate: il punto d'ancoraggio per un testo da punto, e per uno in
/// area il mezzo del riquadro, con ogni allineamento.
function blockCentre(rich: Rich): number {
  const x = length(rich.attrs.x ?? "0") ?? 0;
  const width = wrapOf(rich);
  if (width === null) return x;
  const anchor = (rich.attrs["text-anchor"] ?? rich.inherited["text-anchor"] ?? "start").trim();
  const share = anchor === "middle" ? 0.5 : anchor === "end" ? 1 : 0;
  return x + (0.5 - share) * width;
}

/// Dalle coordinate di un'etichetta `rich` alla scena, perché stia al centro
/// di `frame`, girata con lui.
export function labelScene(frame: LabelFrame, rich: Rich): Matrix {
  return compose(translate(frame.centre[0], frame.centre[1]), compose(rotate(frame.angle), translate(-blockCentre(rich), -blockMiddle(rich))));
}

/// Il `transform` di un'etichetta `rich` al centro di `frame`, in un
/// genitore che la scena vede con `parent`; `undefined` se il genitore
/// schiaccia il piano.
export function labelTransform(frame: LabelFrame, rich: Rich, parent: Matrix): string | null | undefined {
  const back = invert(parent);
  return back === null ? undefined : transformValue(compose(back, labelScene(frame, rich)));
}

/// Dove sta nella scena l'etichetta `rich`, al centro di `frame`: la pagina
/// cresce se ne esce, come per ogni testo.
function extentIn(frame: LabelFrame, rich: Rich): Bounds | null {
  return elemBounds(richElem({ tag: "text", attrs: {} }, rich), labelScene(frame, rich));
}

/// Dove starà nella scena l'etichetta `rich` di `shape`, quando il seguito
/// l'avrà rimessa al centro e di nuovo a capo. `null` se la forma non ha un
/// riquadro del testo.
export function labelExtent(shape: ElementPart, rich: Rich, measure: Measure): Bounds | null {
  const frame = labelFrame(shape, new SceneMatrices().of(shape));
  return frame === null ? null : extentIn(frame, fitted(rich, frame, measure));
}

/// Vero se le due trasformazioni si scrivono uguali, o quasi.
function sameTransform(a: Matrix, b: Matrix): boolean {
  return a.every((value, i) => Math.abs(value - b[i]!) <= (i < 4 ? STILL : 10 * STILL));
}

// ---------------------------------------------------------------------------
// Seguire.
// ---------------------------------------------------------------------------

/// I testi del disegno che nominano una forma, in ordine di documento.
function scan(model: DocumentModel): ElementPart[] {
  const out: ElementPart[] = [];
  const walk = (container: ElementPart): void => {
    if (container.kind !== "container") return;
    for (const child of elementChildren(container)) {
      const details = child.details;
      if (details === null) continue;
      if (details.inside !== undefined) out.push(child);
      else if (child.kind === "container" && (details.role === "layer" || details.role === "group" || details.role === "link")) walk(child);
    }
  };
  walk(model.root);
  return out;
}

/// L'etichetta `rich` larga quanto vuole `frame`: di nuovo a capo se la
/// larghezza è un'altra. Un testo da punto resta com'è.
function fitted(rich: Rich, frame: LabelFrame, measure: Measure): Rich {
  const was = wrapOf(rich);
  if (was === null) return rich;
  const width = labelWidth(frame, sizeOf(rich));
  if (wrapValue(width) === wrapValue(was)) return rich;
  return reflow({ ...rich, attrs: { ...rich.attrs, [WRAP]: wrapValue(width) } }, width, measure).rich;
}

/// Vero se `a` e `b` hanno le stesse righe, coi loro attributi e i loro
/// pezzi.
function sameLines(a: readonly RichLine[], b: readonly RichLine[]): boolean {
  return a.length === b.length && a.every((line, i) => JSON.stringify(line) === JSON.stringify(b[i]));
}

/// Le operazioni che tengono le etichette al centro delle loro forme, dopo
/// un'operazione che ha toccato `touched`; il motore le applica nello
/// stesso passo. `op` è l'operazione chiesta: un'etichetta che sposta da
/// sola, senza la sua forma, si stacca. `null` se non c'è niente da fare.
export function followLabels(model: DocumentModel, touched: ReadonlySet<string>, find: (id: string) => ElementPart | null, measure: Measure, op: Op | null = null): Op | null {
  if (touched.size === 0) return null;
  const labels = scan(model);
  if (labels.length === 0) return null;
  const { changes, removed } = touchedBy(touched, find);
  const moved = op === null ? new Set<string>() : movedBy(op);
  const matrices = new SceneMatrices();
  const ops: Op[] = [];
  let plan: Plan | null = null;
  for (const label of labels) {
    const id = label.facts.id;
    const inside = label.details!.inside!;
    if (id === null || lockedAbove(label)) continue;
    const detach = (): void => {
      ops.push({ op: "set", id, attrs: { "fub:inside": null } });
    };
    const shape = labelTarget(label);
    if (shape === null) {
      // La forma se n'è andata, è uscita dal gruppo o non è più chiusa:
      // l'etichetta resta un testo. Un testo che nessuno ha toccato resta
      // com'è scritto.
      const there = find(inside);
      if (removed.has(inside) || changes.under(label) || (there !== null && changes.changed(there))) detach();
      continue;
    }
    if (!changes.changed(shape) && !changes.under(label)) continue;
    if (among(label, moved) && !among(shape, moved)) {
      detach();
      continue;
    }
    const rich = textRich(label);
    const frame = labelFrame(shape, matrices.of(shape));
    if (rich === null || frame === null || label.parent === null) continue;
    const next = fitted(rich, frame, measure);
    const back = invert(matrices.of(label.parent));
    if (back === null) continue;
    const m = compose(back, labelScene(frame, next));
    const lines = sameLines(rich.lines, next.lines);
    if (lines && next === rich && sameTransform(m, matrices.own(label))) continue;
    if (lines) {
      const attrs: Record<string, string | null> = { transform: transformValue(m) };
      if (next !== rich) attrs[WRAP] = next.attrs[WRAP]!;
      ops.push({ op: "set", id, attrs });
      continue;
    }
    // Le righe sono altre: il testo si riscrive intero, al suo posto.
    const old = elemOf(label);
    if (old === null) continue;
    plan ??= new Plan(model, new NewIds((taken) => find(taken) !== null));
    const transform = transformValue(m);
    const attrs: Record<string, string> = { ...next.attrs };
    if (transform === null) delete attrs.transform;
    else attrs.transform = transform;
    replaceElem(plan, label, richElem(old, { ...next, attrs }));
  }
  if (plan !== null) ops.push(...plan.finish([]).ops);
  return gesture(ops);
}

// ---------------------------------------------------------------------------
// Dare un'etichetta.
// ---------------------------------------------------------------------------

/// Dove va l'etichetta nuova di `unit`, una forma che può averne una e non
/// ce l'ha: il riquadro nella scena, e il genitore che la riceverà. `null`
/// se non si sa.
export function labelPlace(model: DocumentModel, unit: Unit): { readonly frame: LabelFrame; readonly parent: Matrix } | null {
  const shape = nodeOf(model, unit);
  if (!labelable(shape) || labelOf(shape) !== null || shape.parent === null) return null;
  const matrices = new SceneMatrices();
  const frame = labelFrame(shape, matrices.of(shape));
  return frame === null ? null : { frame, parent: matrices.of(shape.parent) };
}

/// Le operazioni che danno a `unit` l'etichetta `draft`, le righe con i
/// loro pezzi e gli attributi del testo, senza posto: al centro della
/// forma, larga quanto il suo riquadro, in un gruppo con lei o accanto a lei
/// nel suo gruppo. La selezione dopo è il gruppo nuovo, o la forma che
/// stava già in un gruppo; `extent` è dove starà l'etichetta nella scena.
/// `null` se la forma non può averne una o ce l'ha già.
export function labelOps(model: DocumentModel, unit: Unit, draft: Rich, measure: Measure, ids: NewIds): (Arranged & { readonly extent: Bounds | null }) | null {
  const shape = nodeOf(model, unit);
  const place = labelPlace(model, unit);
  if (place === null || shape.parent === null) return null;
  const plan = new Plan(model, ids);
  const shapeId = plan.idOf(shape);
  const inGroup = shape.parent.details?.role === "group";
  const group = inGroup ? plan.idOf(shape.parent) : wrapIn(plan, [unit], "g", {});
  if (group === null) return null;
  const width = labelWidth(place.frame, sizeOf(draft));
  const attrs: Record<string, string> = { ...draft.attrs, id: ids.next("object"), "fub:inside": shapeId, [WRAP]: wrapValue(width), x: "0", y: "0", "text-anchor": "middle" };
  delete attrs.transform;
  const rich = reflow({ ...draft, attrs, lines: draft.lines.map((line) => ({ ...line, attrs: { ...line.attrs, x: "0" } })) }, width, measure).rich;
  const transform = labelTransform(place.frame, rich, place.parent);
  if (transform === undefined) return null;
  if (transform !== null) attrs.transform = transform;
  const elem = richElem({ tag: "text", attrs: {} }, { ...rich, attrs });
  plan.ops.push({ op: "add", parent: group, pos: inGroup ? { after: shapeId } : { last: true }, elem });
  return { ...plan.finish([inGroup ? shapeId : group]), extent: extentIn(place.frame, rich) };
}

/// Vero se un elemento del disegno nomina `id`: un connettore agganciato a
/// lui, un `url(#id)` o un `href="#id"`.
function namedIn(model: DocumentModel, id: string): boolean {
  const names = (node: ElementPart): boolean => {
    const ends = node.details?.connector;
    if (ends !== undefined && (ends.from?.id === id || ends.to?.id === id)) return true;
    if ((node.kind === "leaf" ? node.refs : node.facts.refs).includes(id)) return true;
    return node.kind === "container" && elementChildren(node).some(names);
  };
  return names(model.root);
}

/// Le operazioni che tolgono l'etichetta `label`, che sta nel gruppo
/// `group`. Il gruppo si scioglie se teneva soltanto la forma e lei, senza
/// titolo, descrizione né effetti, e se niente lo nomina: un connettore
/// agganciato a lui o un riferimento nel disegno, o una parte estranea che
/// lo cita (`cited`). La selezione dopo è la forma.
export function unlabelOps(model: DocumentModel, label: Unit, group: Unit | null, ids: NewIds, cited: (id: string) => boolean): Arranged {
  const plan = new Plan(model, ids);
  const node = nodeOf(model, label);
  const shape = labelTarget(node);
  const id = plan.idOf(node);
  const container = group === null ? null : nodeOf(model, group);
  const loose =
    container !== null &&
    shape !== null &&
    container === node.parent &&
    labelledPair(container) !== null &&
    elementChildren(container).length === 2 &&
    !holdsEffects(container) &&
    (container.facts.id === null || !(namedIn(model, container.facts.id) || cited(container.facts.id)));
  // Prima si scioglie il gruppo, poi se ne va l'etichetta: i percorsi del
  // piano sono quelli di prima.
  const keys = loose ? unwrapIn(plan, [group!], () => true).freed.filter((each) => each !== id) : shape === null ? [] : [plan.idOf(shape)];
  plan.ops.push({ op: "remove", target: id });
  return plan.finish(keys);
}
