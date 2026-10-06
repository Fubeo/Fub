// Il Costruttore di forme (livello Esperto): sulle forme scelte, le regioni
// del loro arrangiamento planare si uniscono, si tolgono o si separano, come
// col Generatore forme di Illustrator. Ogni operazione diventa un `batch`
// solo.
//
// - **Le regioni** sono le facce dell'arrangiamento delle operazioni
//   booleane che stanno dentro almeno una forma scelta. Una forma che non si
//   riempie e non ha sottotracciati chiusi, come una linea, taglia soltanto:
//   divide le regioni che attraversa da parte a parte, e resta com'è.
// - **Unire** fa delle regioni una forma sola, con lo stile della forma più
//   in alto che copre la prima: le sta subito sopra, nel suo livello e con la
//   sua trasformazione. Se quella forma finisce tutta nell'unione, l'unione è
//   lei: stesso id, stesso posto, stessi figli.
// - **Ogni forma che copriva le regioni le perde.** Si riscrive come
//   tracciato, nelle sue coordinate e con le sue curve dove restano; una
//   forma che non ha più niente se ne va.
// - **Togliere** fa perdere le regioni alle forme che le coprono, e basta.
//   **Separare** una regione è unirla da sola.
// - Dopo restano scelti gli oggetti di prima che ci sono ancora, e l'unione.

import { parsePath, type Segment } from "../scene/geometry";
import { compose, invert, type Matrix } from "../scene/matrix";
import type { DocumentModel } from "../scene/model";
import { pathData } from "../scene/serialize";
import { nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { mapped, regionsOf, type Regions, type Shape } from "./boolean";
import { isShape } from "./combine";
import type { NewIds } from "./edit";
import { shapeSegments, type Unit } from "./hit";
import { lookOf, rewriteShape } from "./topath";

/// Le forme scelte per il Costruttore e le regioni del loro arrangiamento.
export interface Builder {
  /// Gli oggetti scelti, in ordine di documento.
  readonly selected: readonly Unit[];
  /// Le forme fra quelli, dalla più in basso: le regioni le contano così.
  readonly shapes: readonly Unit[];
  /// Vero per le forme che tagliano soltanto.
  readonly cuts: readonly boolean[];
  readonly regions: Regions;
  /// Dalle coordinate delle regioni, quelle della forma più in basso, alla
  /// scena.
  readonly matrix: Matrix;
  /// I segmenti di ogni forma nelle sue coordinate, com'è scritta.
  readonly local: readonly (readonly Segment[])[];
}

/// Perché il Costruttore non fa un'operazione:
/// - `whole`, la regione è già una forma intera;
/// - `foreign`, una forma ha parti che un'operazione non sa riscrivere;
/// - `failed`, la geometria non si risolve.
export interface BuildRefused {
  readonly reason: "whole" | "foreign" | "failed";
}

/// Un'operazione del Costruttore pronta: le operazioni, la selezione dopo,
/// e quante forme se ne vanno.
export interface BuiltOps extends Arranged {
  readonly removed: number;
}

/// I pezzi di spezzata oltre i quali il Costruttore rinuncia alle regioni:
/// le rifà a ogni cambio di selezione, e oltre questi ci vorrebbero secondi.
const LIVE_PIECES = 100_000;

const sameMatrix = (a: Matrix, b: Matrix): boolean => a.every((v, i) => v === b[i]);

/// Vero se `segments` hanno un sottotracciato chiuso: con `Z`, o che finisce
/// dove comincia.
function closes(segments: readonly Segment[]): boolean {
  let start: readonly [number, number] | null = null;
  let current: readonly [number, number] | null = null;
  const ends = (): boolean => start !== null && current !== null && current !== start && current[0] === start[0] && current[1] === start[1];
  for (const segment of segments) {
    if (segment.kind === "close") return true;
    if (segment.kind === "move") {
      if (ends()) return true;
      start = current = segment.to;
    } else {
      current = segment.to;
    }
  }
  return ends();
}

/// Il Costruttore sugli oggetti scelti `units`, in ordine di documento: le
/// forme fra loro, e le regioni. `"complex"` se le forme sono troppe, o
/// troppo complesse, per rifare le regioni a ogni scelta; `null` se il
/// calcolo non riesce.
export function builderOf(model: DocumentModel, units: readonly Unit[]): Builder | "complex" | null {
  const shapes = units.filter(isShape);
  const matrix = shapes[0]?.matrix ?? units[0]?.matrix ?? [1, 0, 0, 1, 0, 0];
  const into = invert(matrix);
  if (into === null) return null;
  const local = shapes.map((unit) => {
    const node = nodeOf(model, unit);
    return shapeSegments(node.details!.tag, [...plainAttributes(node)]);
  });
  const cuts = shapes.map((unit, k) => !unit.filled && !closes(local[k]!));
  const operands = shapes.map((unit, k): Shape => {
    // Il formato della scena non ha `fill-rule`: ogni forma si riempie con
    // nonzero, come la dipinge il painter.
    if (sameMatrix(unit.matrix, matrix)) return { segments: local[k]!, evenOdd: false, written: true };
    return { segments: mapped(local[k]!, compose(into, unit.matrix)), evenOdd: false, written: false };
  });
  const regions = regionsOf(operands, cuts, LIVE_PIECES);
  if (regions === null || regions === "complex") return regions;
  return { selected: units, shapes, cuts, regions, matrix, local };
}

/// Le operazioni che uniscono le regioni `chosen` di `builder`, o con
/// `erase` le tolgono: la prima dà lo stile all'unione.
export function buildOps(model: DocumentModel, builder: Builder, chosen: readonly number[], erase: boolean, ids: NewIds): BuiltOps | BuildRefused {
  const { regions, shapes } = builder;
  const set = new Set(chosen);
  const touched = [...new Set(chosen.flatMap((r) => regions.regions[r]!.cover))].sort((a, b) => a - b);
  const first = regions.regions[chosen[0]!]!.cover;
  const owner = erase ? -1 : first[first.length - 1]!;
  const rests = touched.map((k) => regions.path((r) => !set.has(r), k, k));
  const merged = erase ? [] : regions.path((r) => set.has(r), null, owner);
  if (merged === null || rests.some((rest) => rest === null)) return { reason: "failed" };
  // Una regione sola che è tutta una forma, e nient'altro: separarla non
  // cambia niente.
  if (!erase && chosen.length === 1 && touched.length === 1 && rests[0]!.length === 0) return { reason: "whole" };

  /// `segments`, nelle coordinate delle regioni, come `d` della forma `k`;
  /// `null` se non si scrive.
  const written = (k: number, segments: Segment[]): string | null => {
    const unit = shapes[k]!;
    let out = segments;
    if (!sameMatrix(unit.matrix, builder.matrix)) {
      const back = invert(unit.matrix);
      if (back === null) return null;
      out = mapped(segments, compose(back, builder.matrix));
    }
    const d = pathData(out);
    // Il `d` scritto si rilegge: uno che no, con numeri fuori dal formato, non
    // si scrive.
    return parsePath(d) === null ? null : d;
  };

  const plan = new Plan(model, ids);
  const nodes = shapes.map((unit) => nodeOf(model, unit));
  // Le forme che se ne vanno, per ultime: un elemento riscritto si nomina
  // anche col suo percorso, che deve restare quello di prima.
  const gone = new Set<number>();
  let reused = false;
  for (let i = 0; i < touched.length; i++) {
    const k = touched[i]!;
    const node = nodes[k]!;
    const rest = rests[i]!;
    // La forma che dà lo stile e finisce tutta nell'unione diventa l'unione.
    const whole = k === owner && rest.length === 0;
    const goal = whole ? merged : rest;
    if (goal.length === 0) {
      gone.add(k);
      continue;
    }
    reused ||= whole;
    const d = written(k, goal);
    if (d === null) return { reason: "failed" };
    // Una forma che resta disegnata com'era non si riscrive.
    if (d === pathData(builder.local[k]!)) continue;
    if (!rewriteShape(plan, node, d)) return { reason: "foreign" };
  }
  let piece: string | null = null;
  if (!erase && !reused) {
    const d = written(owner, merged);
    if (d === null) return { reason: "failed" };
    const node = nodes[owner]!;
    piece = plan.ids.next("object");
    plan.ops.push({ op: "add", parent: plan.parentOf(node), pos: { after: plan.idOf(node) }, elem: { tag: "path", attrs: { ...lookOf(node), id: piece, d } } });
  }
  for (const k of gone) plan.ops.push({ op: "remove", target: plan.idOf(nodes[k]!) });

  const keys: string[] = [];
  for (const unit of builder.selected) {
    const k = shapes.indexOf(unit);
    if (gone.has(k)) continue;
    keys.push(plan.idOf(nodeOf(model, unit)));
    if (k === owner && piece !== null) keys.push(piece);
  }
  return { ...plan.finish(keys), removed: gone.size };
}
