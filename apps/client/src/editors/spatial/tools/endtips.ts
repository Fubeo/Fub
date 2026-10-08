// Le punte delle linee quando un comando taglia, unisce, chiude, combina o
// riscrive i nodi di un tracciato. Senza DOM.
//
// - **Un comando decide soltanto di chi è ogni punta.** Ogni capo di ciò che
//   esce ha la punta di un capo di ciò che entra, o nessuna: copia il
//   riferimento `url(#…)` del capo di partenza, com'è scritto, o lo toglie.
//   Il colore giusto e il capo giusto, un `marker-start` che nomina un
//   marcatore di fine, li rimette il seguito delle punte (`tips.ts`), nello
//   stesso passo. Un marcatore che non è della raccolta si copia allo stesso
//   modo, dentro lo stesso disegno.
// - **Una punta segue il suo capo.** Un tracciato disegna `marker-start` sul
//   primo vertice e `marker-end` sull'ultimo: se un comando li lascia dove
//   sono, niente cambia. Se il capo di una punta si unisce a un altro e non
//   è più un capo, la punta se ne va con lui; se un capo si toglie con i suoi
//   nodi, il vertice che prende il suo posto la tiene, come lo disegna SVG.
// - **Un risultato senza capi non ha punte**: un tracciato chiuso, una
//   regione. `marker-mid` non lo scrive FubDraw, e resta com'è dove un
//   comando non dice che il risultato non ha marcatori.

import { reference } from "../scene/values";
import type { TipEnd } from "./tips";

/// L'attributo che nomina la punta del capo `end`.
export const tipName = (end: TipEnd): "marker-start" | "marker-end" => (end === "start" ? "marker-start" : "marker-end");

/// Il riferimento che `own`, gli attributi di una parte, scrive al capo
/// `end`, com'è scritto; `null` se non ne ha uno `url(#…)`.
export function tipRef(own: ReadonlyMap<string, string>, end: TipEnd): string | null {
  const value = own.get(tipName(end));
  return value !== undefined && reference(value) !== null ? value : null;
}

/// Di chi è la punta di un capo dopo un comando: la punta che la stessa
/// parte ha adesso a quel capo, o a quello opposto, che il seguito capovolge;
/// nessuna; o il riferimento di un'altra parte.
export type EndTip = TipEnd | null | { readonly ref: string };

/// Le punte dei due capi di una parte dopo un comando.
export interface EndTips {
  readonly start: EndTip;
  readonly end: EndTip;
}

/// Una parte che non ha più capi: niente punte.
export const NO_TIPS: EndTips = { start: null, end: null };

/// Gli attributi che portano `own`, gli attributi di una parte, alle punte
/// di `tips`: solo quelli che cambiano, `null` per toglierli.
export function tipAttrs(own: ReadonlyMap<string, string>, tips: EndTips): Record<string, string | null> {
  const attrs: Record<string, string | null> = {};
  for (const end of ["start", "end"] as const) {
    const given = tips[end];
    const wanted = given === null ? null : typeof given === "string" ? tipRef(own, given) : given.ref;
    const now = tipRef(own, end);
    if (wanted === null) {
      if (now !== null) attrs[tipName(end)] = null;
    } else if (now === null || reference(now) !== reference(wanted)) {
      attrs[tipName(end)] = wanted;
    }
  }
  return attrs;
}

/// Il capo di un'altra parte da cui un capo prende la punta: `owner` è la
/// parte, nell'ordine in cui il comando le nomina.
export interface TipSource {
  readonly owner: number;
  readonly end: TipEnd;
}

/// Le punte di due parti unite in una: ogni capo di quella che resta dice
/// da quale capo di quale parte prende la sua; `others` sono gli attributi
/// delle parti dopo la prima, nell'ordine di `owner`, e la prima è `own`.
export function pooledTips(others: ReadonlyArray<ReadonlyMap<string, string>>, sources: { readonly start: TipSource | null; readonly end: TipSource | null }): EndTips {
  const of = (source: TipSource | null): EndTip => {
    if (source === null) return null;
    if (source.owner === 0) return source.end;
    const ref = tipRef(others[source.owner - 1]!, source.end);
    return ref === null ? null : { ref };
  };
  return { start: of(sources.start), end: of(sources.end) };
}

/// `look`, gli attributi di una forma senza la sua geometria, per un pezzo
/// nuovo che le sta accanto: con le punte dei capi di `keep` e senza le
/// altre. `marker-mid` resta.
export function keepTips(look: Readonly<Record<string, string>>, keep: { readonly start: boolean; readonly end: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(look)) {
    if ((name === "marker-start" && !keep.start) || (name === "marker-end" && !keep.end)) continue;
    out[name] = value;
  }
  return out;
}

/// Gli attributi dei marcatori di `own` da togliere, a `null`, perché il
/// risultato è una regione e non ne ha: `marker-start`, `marker-mid` e
/// `marker-end`, quelli che ha.
export function bareAttrs(own: ReadonlyMap<string, string>): Record<string, null> {
  const attrs: Record<string, null> = {};
  for (const name of ["marker-start", "marker-mid", "marker-end"]) if (own.has(name)) attrs[name] = null;
  return attrs;
}

/// `look` senza i marcatori, per un pezzo che è una regione.
export function bareLook(look: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(look)) if (name !== "marker-start" && name !== "marker-mid" && name !== "marker-end") out[name] = value;
  return out;
}
