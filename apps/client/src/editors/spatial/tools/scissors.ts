// Le Forbici, il Coltello e «Unisci» sugli oggetti del disegno (livello
// Esperto): i pezzi di un taglio diventano oggetti, e i tracciati uniti uno
// solo. La geometria è in `cut.ts`; qui le operazioni. Senza DOM.
//
// - **Ogni pezzo è un oggetto a sé**, da spostare da solo, come in
//   Illustrator. Il primo prende il posto della forma tagliata, col suo id,
//   insieme ai sottotracciati che il taglio non tocca; gli altri le stanno
//   sopra, uno sull'altro, con id nuovi e il suo aspetto. Una forma che non
//   era un tracciato lo diventa.
// - **Le punte stanno ai capi del tracciato di partenza** (`endtips.ts`). La
//   punta d'inizio resta sul pezzo che comincia dove cominciava il tracciato,
//   quella di fine su quello che finisce dove finiva; gli altri pezzi non ne
//   hanno, e nemmeno quelli di un sottotracciato chiuso che il taglio apre,
//   o di una forma divisa dal Coltello.
// - **«Unisci» tiene il tracciato più in basso**, come le operazioni
//   booleane: i sottotracciati degli altri arrivano nelle sue coordinate e
//   si uniscono ai suoi, e gli altri se ne vanno. Un tracciato solo si
//   chiude. Il risultato prende la punta d'inizio del capo che ne è
//   diventato l'inizio, e quella di fine del capo che ne è diventato la fine:
//   un tracciato chiuso non ne ha, e quelli che se ne vanno si portano via le
//   loro.

import { parsePath } from "../scene/geometry";
import { compose, invert } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { pathData } from "../scene/serialize";
import { nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { combine } from "./boolean";
import { crossings, cutAt, joinPaths, mapSubs, type Cut, type Joined, type PieceEnd } from "./cut";
import type { NewIds } from "./edit";
import { keepTips, pooledTips, tipAttrs, type TipSource } from "./endtips";
import type { Unit } from "./hit";
import { nodableOf, type Nodable } from "./nodable";
import { nodeKey, parseKey, writeNodes, type Subpath } from "./nodes";
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

/// Quali sottotracciati di `cut` formano ogni oggetto, come indici di
/// `cut.subs`: il primo con i sottotracciati che il taglio non tocca e il
/// primo pezzo, poi uno per pezzo, nell'ordine del tracciato.
function groupsOf(cut: Cut): number[][] {
  const pieces = new Set(cut.ends.map((key) => parseKey(key)[0]));
  const out: number[][] = [[]];
  let first = true;
  cut.subs.forEach((_, s) => {
    if (!pieces.has(s)) out[0]!.push(s);
    else if (first) {
      out[0]!.push(s);
      first = false;
    } else out.push([s]);
  });
  return out;
}

/// I sottotracciati di un taglio raccolti in oggetti: il primo coi
/// sottotracciati che il taglio non tocca e il primo pezzo, poi un oggetto
/// per pezzo, nell'ordine del tracciato.
export const piecesOf = (cut: Cut): Subpath[][] => groupsOf(cut).map((group) => group.map((s) => cut.subs[s]!));

/// Le punte che un pezzo tiene: quella d'inizio se comincia dove cominciava
/// la forma tagliata, quella di fine se finisce dove finiva.
export interface PieceTips {
  readonly start: boolean;
  readonly end: boolean;
}

const NO_PIECE_TIPS: PieceTips = { start: false, end: false };

/// Le punte di ogni oggetto di `piecesOf(cut)`. La forma comincia dove
/// comincia il primo sottotracciato e finisce dove finisce l'ultimo: ha
/// ancora la punta d'inizio l'oggetto che porta il primo, se il taglio non
/// lo ha aperto in quel nodo, e quella di fine l'oggetto che porta l'ultimo.
/// I capi che il taglio ha fatto sono in `cut.ends`.
export function tipsOfCut(cut: Cut): PieceTips[] {
  const last = cut.subs.length - 1;
  const tail = cut.subs[last];
  if (tail === undefined) return [];
  const ends = new Set<string>(cut.ends);
  const starts = !ends.has(nodeKey(0, 0));
  const finishes = !ends.has(nodeKey(last, tail.nodes.length - 1));
  return groupsOf(cut).map((group) => ({ start: starts && group[0] === 0, end: finishes && group[group.length - 1] === last }));
}

/// I pezzi che lascia il Coltello, ognuno un `d`, con le punte che ognuno
/// tiene.
export interface Knifed {
  readonly pieces: string[];
  readonly tips: PieceTips[];
}

/// I pezzi, ognuno un `d`, che lascia il Coltello lungo `blade` sulla forma
/// coi sottotracciati `subs`, nelle stesse coordinate, con le punte che
/// tiene ciascuno. Una forma chiusa si divide lungo il tratto, con la
/// divisione delle booleane: un tratto che entra e non esce non divide
/// niente, e i pezzi sono regioni, senza punte. Un tracciato aperto si
/// taglia dove il tratto lo incrocia. `null` se niente si taglia, o se la
/// forma ha sottotracciati chiusi e aperti insieme.
export function knifePieces(subs: readonly Subpath[], blade: readonly Subpath[]): Knifed | null {
  const spots = crossings(subs, blade);
  if (subs.every((sub) => sub.closed)) {
    // Per entrare e uscire, almeno due incroci.
    if (spots.length < 2) return null;
    const result = combine("division", [
      { segments: writeNodes(subs), evenOdd: false, written: true },
      { segments: writeNodes(blade), evenOdd: false, written: false },
    ]);
    const pieces = result === null || result.length < 2 ? null : readable(result.map(pathData));
    return pieces === null ? null : { pieces, tips: pieces.map(() => NO_PIECE_TIPS) };
  }
  if (subs.some((sub) => sub.closed)) return null;
  const cut = cutAt(subs, spots);
  const pieces = cut === null ? null : dsOf(piecesOf(cut));
  return cut === null || pieces === null ? null : { pieces, tips: tipsOfCut(cut) };
}

/// Scrive i pezzi `pieces`, ognuno un `d`, al posto della forma `node`: il
/// primo nella forma, gli altri sopra di lei. `tips` dice le punte che ogni
/// pezzo tiene della forma: le altre se ne vanno. Gli id dei pezzi, dal
/// primo; `null` se la forma ha parti che un'operazione non sa scrivere.
export function writePieces(plan: Plan, node: ElementPart, pieces: readonly string[], tips: readonly PieceTips[]): string[] | null {
  const id = plan.idOf(node);
  if (!rewriteShape(plan, node, pieces[0]!)) return null;
  const keys = [id];
  const kept = (at: number): PieceTips => tips[at] ?? NO_PIECE_TIPS;
  const lost = tipAttrs(plainAttributes(node), { start: kept(0).start ? "start" : null, end: kept(0).end ? "end" : null });
  if (Object.keys(lost).length > 0) plan.ops.push({ op: "set", id, attrs: lost });
  const look = lookOf(node);
  pieces.slice(1).forEach((d, at) => {
    const piece = plan.ids.next("object");
    plan.ops.push({ op: "add", parent: plan.parentOf(node), pos: { after: keys[keys.length - 1]! }, elem: { tag: "path", attrs: { ...keepTips(look, kept(at + 1)), id: piece, d } } });
    keys.push(piece);
  });
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
  // Di ogni pezzo, l'oggetto da cui viene e se è il primo e l'ultimo dei suoi
  // sottotracciati: soltanto i capi di quelli portano le punte.
  const owners: Array<{ readonly unit: number; readonly first: boolean; readonly last: boolean }> = [];
  const pieces = units.flatMap((unit, at) => {
    const subs = (found[at] as Nodable).subs;
    subs.forEach((_, s) => owners.push({ unit: at, first: s === 0, last: s === subs.length - 1 }));
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
  // Le punte: ogni capo del tracciato unito ha quella del capo di un pezzo
  // che è stato, se era il primo o l'ultimo vertice del suo oggetto.
  const source = (end: PieceEnd | null): TipSource | null => {
    const owner = end === null ? undefined : owners[end.piece];
    return end === null || owner === undefined || (end.end === "start" ? !owner.first : !owner.last) ? null : { owner: owner.unit, end: end.end };
  };
  const own = plainAttributes(nodes[0]!);
  const tips = tipAttrs(own, pooledTips(nodes.slice(1).map(plainAttributes), { start: source(joined.start), end: source(joined.end) }));
  if (Object.keys(tips).length > 0) plan.ops.push({ op: "set", id, attrs: tips });
  for (const other of nodes.slice(1)) plan.ops.push({ op: "remove", target: plan.idOf(other) });
  return { ...plan.finish([id]), joined };
}
