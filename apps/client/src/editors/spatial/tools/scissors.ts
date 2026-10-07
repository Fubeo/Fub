// Le Forbici, il Coltello e «Unisci» sugli oggetti del disegno (livello
// Esperto): i pezzi di un taglio diventano oggetti, e i tracciati uniti uno
// solo. La geometria è in `cut.ts`; qui le operazioni. Senza DOM.
//
// - **Ogni pezzo è un oggetto a sé**, da spostare da solo, come in
//   Illustrator. Il primo prende il posto della forma tagliata, col suo id,
//   insieme ai sottotracciati che il taglio non tocca; gli altri le stanno
//   sopra, uno sull'altro, con id nuovi e il suo aspetto. Una forma che non
//   era un tracciato lo diventa.
// - **«Unisci» tiene il tracciato più in basso**, come le operazioni
//   booleane: i sottotracciati degli altri arrivano nelle sue coordinate e
//   si uniscono ai suoi, e gli altri se ne vanno. Un tracciato solo si
//   chiude.

import { parsePath } from "../scene/geometry";
import { compose, invert } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { pathData } from "../scene/serialize";
import { nodeOf, Plan, type Arranged } from "./arrange";
import { combine } from "./boolean";
import { crossings, cutAt, joinPaths, mapSubs, type Cut, type Joined } from "./cut";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { nodableOf, type Nodable } from "./nodable";
import { parseKey, writeNodes, type Subpath } from "./nodes";
import { lookOf, rewriteShape } from "./topath";

/// I `d` `written`, se si rileggono tutti; `null` se uno ha numeri fuori
/// dal formato.
const readable = (written: readonly string[]): string[] | null => (written.every((d) => parsePath(d) !== null) ? [...written] : null);

/// I `d` degli oggetti `objects`, uno per oggetto; `null` se uno non si
/// rilegge.
export const dsOf = (objects: readonly (readonly Subpath[])[]): string[] | null => readable(objects.map((subs) => pathData(writeNodes(subs))));

/// Vero se `nodable` si taglia e si unisce: un tracciato o una forma. Una
/// freccia ha un'asta sola fra due capi, e un tratto a penna resta un
/// tratto solo.
export const cuttable = (nodable: Nodable): boolean => nodable.kind !== "arrow" && nodable.kind !== "stroke" && nodable.kind !== "width";

/// I sottotracciati di un taglio raccolti in oggetti: il primo coi
/// sottotracciati che il taglio non tocca e il primo pezzo, poi un oggetto
/// per pezzo, nell'ordine del tracciato.
export function piecesOf(cut: Cut): Subpath[][] {
  const pieces = new Set(cut.ends.map((key) => parseKey(key)[0]));
  const out: Subpath[][] = [[]];
  let first = true;
  cut.subs.forEach((sub, s) => {
    if (!pieces.has(s)) out[0]!.push(sub);
    else if (first) {
      out[0]!.push(sub);
      first = false;
    } else out.push([sub]);
  });
  return out;
}

/// I pezzi, ognuno un `d`, che lascia il Coltello lungo `blade` sulla forma
/// coi sottotracciati `subs`, nelle stesse coordinate. Una forma chiusa si
/// divide lungo il tratto, con la divisione delle booleane: un tratto che
/// entra e non esce non divide niente. Un tracciato aperto si taglia dove
/// il tratto lo incrocia. `null` se niente si taglia, o se la forma ha
/// sottotracciati chiusi e aperti insieme.
export function knifePieces(subs: readonly Subpath[], blade: readonly Subpath[]): string[] | null {
  const spots = crossings(subs, blade);
  if (subs.every((sub) => sub.closed)) {
    // Per entrare e uscire, almeno due incroci.
    if (spots.length < 2) return null;
    const result = combine("division", [
      { segments: writeNodes(subs), evenOdd: false, written: true },
      { segments: writeNodes(blade), evenOdd: false, written: false },
    ]);
    return result === null || result.length < 2 ? null : readable(result.map(pathData));
  }
  if (subs.some((sub) => sub.closed)) return null;
  const cut = cutAt(subs, spots);
  return cut === null ? null : dsOf(piecesOf(cut));
}

/// Scrive i pezzi `pieces`, ognuno un `d`, al posto della forma `node`: il
/// primo nella forma, gli altri sopra di lei. Gli id dei pezzi, dal primo;
/// `null` se la forma ha parti che un'operazione non sa scrivere.
export function writePieces(plan: Plan, node: ElementPart, pieces: readonly string[]): string[] | null {
  const id = plan.idOf(node);
  if (!rewriteShape(plan, node, pieces[0]!)) return null;
  const keys = [id];
  const look = lookOf(node);
  for (const d of pieces.slice(1)) {
    const piece = plan.ids.next("object");
    plan.ops.push({ op: "add", parent: plan.parentOf(node), pos: { after: keys[keys.length - 1]! }, elem: { tag: "path", attrs: { ...look, id: piece, d } } });
    keys.push(piece);
  }
  return keys;
}

/// Vero se fra `units` c'è un tracciato o una forma con un sottotracciato
/// aperto: ciò che «Unisci» unisce.
export const holdsOpenPath = (model: DocumentModel, units: readonly Unit[]): boolean =>
  units.some((unit) => {
    const found = nodableOf(nodeOf(model, unit));
    return typeof found !== "string" && cuttable(found) && found.subs.some((sub) => !sub.closed);
  });

/// «Unisci» pronto: le operazioni, e ciò che ne esce.
export interface JoinedOps extends Arranged {
  readonly joined: Joined;
}

/// Perché «Unisci» non si fa:
/// - `none`, niente di scelto;
/// - `not_paths`, `count` oggetti scelti non sono tracciati o forme: gruppi,
///   testi, immagini, frecce, tratti a penna;
/// - `closed`, un tracciato scelto è chiuso;
/// - `line`, una linea sola non ha niente da chiudere;
/// - `foreign`, il tracciato più in basso ha parti che un'operazione non sa
///   riscrivere;
/// - `failed`, la geometria non si risolve.
export type JoinRefused =
  | { readonly reason: "none" | "closed" | "line" | "foreign" | "failed" }
  | { readonly reason: "not_paths"; readonly count: number };

/// «Unisci» su `units`, in ordine di documento: i loro sottotracciati
/// aperti diventano uno solo, nel più in basso. Due capi più vicini di
/// `merge`, nella scena, diventano un nodo solo.
export function joinOps(model: DocumentModel, units: readonly Unit[], merge: number, ids: NewIds): JoinedOps | JoinRefused {
  if (units.length === 0) return { reason: "none" };
  const nodes = units.map((unit) => nodeOf(model, unit));
  const found = nodes.map((node) => nodableOf(node));
  const others = found.filter((each) => typeof each === "string" || !cuttable(each)).length;
  if (others > 0) return { reason: "not_paths", count: others };
  const bottom = units[0]!;
  const into = invert(bottom.matrix);
  if (into === null) return { reason: "failed" };
  const pieces = units.flatMap((unit, at) => {
    const subs = (found[at] as Nodable).subs;
    return at === 0 ? subs : mapSubs(subs, compose(into, unit.matrix));
  });
  if (pieces.some((piece) => piece.closed)) return { reason: "closed" };
  const local = merge * Math.sqrt(Math.abs(into[0] * into[3] - into[1] * into[2]));
  const joined = joinPaths(pieces, local);
  if (joined === null) return { reason: pieces.length === 1 ? "line" : "failed" };
  const written = dsOf([[joined.sub]]);
  if (written === null) return { reason: "failed" };
  const plan = new Plan(model, ids);
  const id = plan.idOf(nodes[0]!);
  if (!rewriteShape(plan, nodes[0]!, written[0]!)) return { reason: "foreign" };
  for (const other of nodes.slice(1)) plan.ops.push({ op: "remove", target: plan.idOf(other) });
  return { ...plan.finish([id]), joined };
}
