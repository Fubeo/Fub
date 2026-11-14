// Il nodo grezzo di una scheda (T59, «Avanzate» nella parte «Scheda»): i suoi
// campi come tabella chiave-valore, ognuno come JSON com'è nel file. È puro:
// legge un nodo, e dice se una modifica scritta a mano si può prendere. Il
// commit lo fa l'ispettore, col nucleo di N3.
//
// - **Che cosa si vede.** Ogni campo del nodo, nell'ordine del file, campi
//   sconosciuti compresi: un campo di un altro programma si legge e si cambia
//   come testo, e si conserva.
// - **Che cosa non si cambia qui.** `id` (è l'identità della scheda), `type`
//   (il tipo non si cambia così), i campi `fub:` di Fub, che hanno una forma
//   loro: `fub:ink` si cambia con la penna, gli altri (`fub:parts`) dal loro
//   editor.
// - **Che cosa si controlla prima di prendere un valore.** Il JSON; per
//   `x`, `y`, `width`, `height` un numero finito, e per le misure non meno di
//   `DROP_MIN_SIZE`; per i testi noti una stringa (o `null`, che nel file vale
//   come assente).

import type { CanvasNode } from "../model";
import { DROP_MIN_SIZE } from "../drop-layout";

/** Il perché un campo non si cambia dalla tabella. */
export type RawLock = "id" | "type" | "ink" | "shape";

/** Un campo del nodo, come lo mostra la tabella. */
export interface RawField {
  readonly key: string;
  /** Il valore come JSON, com'è nel file (un testo fra virgolette). */
  readonly text: string;
  /** Perché non si cambia, o `null` se si cambia come testo. */
  readonly lock: RawLock | null;
}

/** Perché un valore scritto non si prende. */
export type RawProblem = RawLock | "json" | "number" | "text" | "small";

export type RawEdit = { readonly node: CanvasNode } | { readonly problem: RawProblem };

/** I campi numerici della scheda: un numero finito. */
const NUMBER_KEYS: ReadonlySet<string> = new Set(["x", "y", "width", "height"]);
/** Le misure: non meno del minimo di una scheda. */
const SIZE_KEYS: ReadonlySet<string> = new Set(["width", "height"]);
/** I campi di testo noti: una stringa, o `null` che vale come assente. */
const TEXT_KEYS: ReadonlySet<string> = new Set(["color", "text", "file", "subpath", "url", "label", "background", "backgroundStyle"]);

/** Perché il campo `key` non si cambia dalla tabella, o `null`. */
export function rawLock(key: string): RawLock | null {
  if (key === "id") return "id";
  if (key === "type") return "type";
  if (key === "fub:ink") return "ink";
  if (key.startsWith("fub:")) return "shape";
  return null;
}

/** I campi del nodo nell'ordine del file, ognuno col suo JSON. */
export function rawFields(node: CanvasNode): RawField[] {
  return Object.keys(node).map((key) => ({ key, text: JSON.stringify(node[key]), lock: rawLock(key) }));
}

/**
 * Il nodo con il campo `key` scritto come JSON `text`, o il perché non si
 * prende. Un campo nuovo finisce in fondo; uno esistente tiene il suo posto.
 */
export function setRawField(node: CanvasNode, key: string, text: string): RawEdit {
  const lock = rawLock(key);
  if (lock !== null) return { problem: lock };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: "json" };
  }
  if (NUMBER_KEYS.has(key)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return { problem: "number" };
    if (SIZE_KEYS.has(key) && value < DROP_MIN_SIZE) return { problem: "small" };
  } else if (TEXT_KEYS.has(key) && value !== null && typeof value !== "string") {
    return { problem: "text" };
  }
  return { node: { ...node, [key]: value } as CanvasNode };
}
