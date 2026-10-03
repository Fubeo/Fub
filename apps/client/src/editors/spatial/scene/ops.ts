// Le operazioni sulla scena: la forma, i motivi di rifiuto e i limiti. Il
// motore che le applica è in `engine.ts`. Il contratto è in
// `docs/reference/scene-operations.md`, e i `§` dei commenti sono le sue
// sezioni.
//
// Le forme pubbliche sono quelle della tabella di §2, le stesse sulla rete e
// nell'undo. Quattro inverse hanno una forma in più, che scrive soltanto il
// motore: `add` con `slot` rimette esattamente ciò che un `remove` ha tolto,
// anche un elemento estraneo; `move` con `slot` riporta un elemento al punto
// esatto da cui è partito; `page` e `anchor` con `previous` rimettono i
// valori di prima, anche assenti. Non arrivano mai dalla rete: `parseWireOp`
// le rifiuta.

import { utf8Length } from "./text";
import type { Elem } from "./serialize";

/// La radice come genitore: non è un id valido.
export const ROOT = "#root";

/// Operazioni in un `batch`, contando anche quelle dei `batch` annidati.
export const MAX_BATCH = 10_000;

/// Il JSON di un'operazione, in byte UTF-8: basta per un'immagine incorporata
/// di 5 MiB.
export const MAX_OP_BYTES = 8 * 1024 * 1024;

/// Il valore di un attributo scritto da un'operazione, in byte UTF-8.
export const MAX_VALUE_BYTES = 512 * 1024;

/// L'`href` di un'immagine: 5 MiB di immagine in base64.
export const MAX_IMAGE_HREF_BYTES = 7 * 1024 * 1024;

/// I livelli di gruppi annidati: un livello è al primo, un gruppo dentro un
/// livello al secondo.
export const MAX_NESTING = 32;

/// Dove va un elemento fra i figli del genitore.
export type Pos = { readonly last: true } | { readonly first: true } | { readonly after: string };

/// Un elemento senza id: gli indici dei figli elemento dalla radice e il tag.
export interface PathTarget {
  readonly path: readonly number[];
  readonly tag: string;
}

/// Un elemento: il suo id, oppure il percorso se non ne ha.
export type Target = string | PathTarget;

/// Il punto esatto da cui un elemento è stato tolto. Lo scrive solo il
/// motore, nelle inverse di `remove` e di `move`.
export interface Slot {
  /// Il contenitore: `#root`, un id o un percorso.
  readonly parent: Target;
  /// L'elemento che precedeva il punto fra i figli; `null` se il punto
  /// viene prima di ogni figlio elemento.
  readonly after: Target | null;
  /// Quanti nodi che non sono elementi (commenti, istruzioni, testo) stanno
  /// fra quell'elemento, o il tag d'apertura, e il punto.
  readonly skip: number;
  /// Gli spazi che restano davanti al punto, così come sono scritti.
  readonly lead: string;
}

/// Gli attributi della radice e della carta prima di un `page`: un valore
/// `null` è un attributo assente. Lo scrive solo il motore, nell'inversa.
export interface PagePrevious {
  readonly root: Readonly<Record<"viewBox" | "width" | "height", string | null>>;
  readonly paper: Readonly<Record<"x" | "y" | "width" | "height", string | null>> | null;
}

export interface AddOp {
  readonly op: "add";
  readonly parent: string;
  readonly pos: Pos;
  readonly elem: Elem;
}

/// L'inversa di `remove`: rimette `gap` e `raw`, gli spazi e l'elemento
/// tolti, così come erano scritti.
export interface RestoreOp {
  readonly op: "add";
  readonly slot: Slot;
  readonly gap: string;
  readonly raw: string;
}

export interface RemoveOp {
  readonly op: "remove";
  readonly target: Target;
}

export interface SetOp {
  readonly op: "set";
  readonly id: string;
  readonly attrs: Readonly<Record<string, string | null>>;
}

export interface TextOp {
  readonly op: "text";
  readonly id: string;
  readonly lines: readonly string[];
}

export interface MoveOp {
  readonly op: "move";
  readonly target: Target;
  readonly parent: string;
  readonly pos: Pos;
}

/// L'inversa di `move`: riporta l'elemento al punto da cui è partito, con
/// gli spazi che lo precedevano.
export interface ReturnOp {
  readonly op: "move";
  readonly target: Target;
  readonly slot: Slot;
  readonly gap: string;
}

export interface IdentOp {
  readonly op: "ident";
  readonly path: readonly number[];
  readonly tag: string;
  readonly id: string | null;
}

export interface PageOp {
  readonly op: "page";
  readonly viewBox: string;
  readonly previous?: PagePrevious;
}

export interface MetaOp {
  readonly op: "meta";
  readonly title?: string | null;
  readonly desc?: string | null;
}

export interface AdoptOp {
  readonly op: "adopt";
  readonly undo?: boolean;
}

/// I valori di `fub:digest` e `fub:pages` sulla radice prima di un
/// `anchor`, così come erano scritti: `null` è un attributo assente. Lo scrive
/// solo il motore, nell'inversa.
export interface AnchorPrevious {
  readonly digest: string | null;
  readonly pages: string | null;
}

/// Lega le annotazioni di un PDF alla versione che si annota: l'impronta
/// (`sha256:` e 64 cifre minuscole) e il numero di pagine sulla radice
/// (`docs/reference/annotation-format.md`). Quello che manca resta com'è, ma
/// almeno uno c'è.
export interface AnchorOp {
  readonly op: "anchor";
  readonly digest?: string;
  readonly pages?: number;
  readonly previous?: AnchorPrevious;
}

export interface BatchOp {
  readonly op: "batch";
  readonly ops: readonly Op[];
  readonly label?: string;
}

/// Un'operazione sulla scena.
export type Op =
  | AddOp
  | RestoreOp
  | RemoveOp
  | SetOp
  | TextOp
  | MoveOp
  | ReturnOp
  | IdentOp
  | PageOp
  | MetaOp
  | AdoptOp
  | AnchorOp
  | BatchOp;

/// Perché un'operazione viene rifiutata (§3).
export type Reason =
  | "missing-target"
  | "missing-parent"
  | "missing-anchor"
  | "duplicate-id"
  | "invalid-elem"
  | "locked"
  | "foreign"
  | "cycle"
  | "limit"
  | "read-only";

const OP_NAMES: ReadonlySet<string> = new Set(["add", "remove", "set", "text", "move", "ident", "page", "meta", "adopt", "anchor", "batch"]);

/// Un'operazione arrivata dalla rete, già letta dal JSON: la stessa, se ha
/// una forma pubblica e sta nei limiti, oppure il motivo del rifiuto. La
/// validazione vera la fa il motore: qui si scartano le forme che solo il
/// motore scrive e i messaggi troppo grandi.
export function parseWireOp(value: unknown): { readonly op: Op } | { readonly reason: Reason; readonly detail: string } {
  let count = 0;
  const check = (op: unknown): { reason: Reason; detail: string } | null => {
    if (op === null || typeof op !== "object" || Array.isArray(op)) return { reason: "invalid-elem", detail: "operazione assente" };
    const record = op as Record<string, unknown>;
    if (typeof record.op !== "string" || !OP_NAMES.has(record.op)) {
      return { reason: "invalid-elem", detail: `operazione sconosciuta: ${JSON.stringify(record.op)}` };
    }
    if ("slot" in record || "raw" in record || "gap" in record || "previous" in record) {
      return { reason: "invalid-elem", detail: `forma di ${record.op} riservata al motore` };
    }
    if (record.op !== "batch") {
      count++;
      if (utf8Length(JSON.stringify(op)) > MAX_OP_BYTES) return { reason: "limit", detail: `${record.op} oltre ${MAX_OP_BYTES} byte` };
      return null;
    }
    if (!Array.isArray(record.ops)) return { reason: "invalid-elem", detail: "batch senza ops" };
    for (const inner of record.ops) {
      const problem = check(inner);
      if (problem !== null) return problem;
      if (count > MAX_BATCH) return { reason: "limit", detail: `batch oltre ${MAX_BATCH} operazioni` };
    }
    return null;
  };
  const problem = check(value);
  return problem === null ? { op: value as Op } : problem;
}
