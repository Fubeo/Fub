// L'unità e le guide del documento, due attributi della radice (formato della
// scena, unità e guide): `fub:units` dice in che unità la superficie scrive
// misure e posizioni, `fub:guides` porta le guide tirate dai righelli. Nessuno
// dei due cambia il disegno, e gli altri programmi li ignorano.
//
// È `rulers.rs` di `fub-scene`, regola per regola: i casi scritti a mano in
// `__fixtures__/scene-rulers/cases.json` valgono per tutte e due le letture.
// Un valore fuori grammatica non si usa e resta nel file com'è (S011).

import { number as svgNumber } from "./values";

/// Le unità del documento. Il file resta in unità utente: l'unità cambia
/// soltanto come la superficie scrive i numeri.
export type LengthUnit = "px" | "mm" | "cm" | "in" | "pt";

/// Le unità, nell'ordine in cui la superficie le propone.
export const UNITS: readonly LengthUnit[] = ["px", "mm", "cm", "in", "pt"];

/// L'ordine di «Cambia unità» (`document.switchUnits`, VectorCraft: Switch Units), lo stesso
/// del menu dei righelli di VectorCraft (punti, pica, pollici, millimetri, centimetri, pixel,
/// piedi e pollici, metri, iarde, piedi) con le sole unità che il file di Fub sa scrivere.
const SWITCH_ORDER: readonly LengthUnit[] = ["pt", "in", "mm", "cm", "px"];

/// L'unità dopo `unit` per «Cambia unità»: l'ultima torna alla prima.
export function nextUnit(unit: LengthUnit): LengthUnit {
  return SWITCH_ORDER[(SWITCH_ORDER.indexOf(unit) + 1) % SWITCH_ORDER.length]!;
}

/// Quante unità utente vale un'unità: 96 per pollice, come in CSS.
export const UNIT_SIZE: Readonly<Record<LengthUnit, number>> = {
  px: 1,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  pt: 96 / 72,
};

/// Le guide di un documento, al più.
export const MAX_GUIDES = 1000;

/// Una guida: `x` è una retta verticale, alla coordinata x della radice; `y`
/// una orizzontale. Una guida bloccata non si trascina. `board` è l'id della
/// tavola a cui appartiene, `layer` quello del livello su cui sta: senza, la
/// guida è del foglio intero e di nessun livello.
export interface RulerGuide {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly locked: boolean;
  readonly board?: string;
  readonly layer?: string;
}

/// Gli spazi fra le parti di una guida: quelli di SVG.
const SPACES = /[ \t\n\r\f]+/;

/// L'unità scritta in `fub:units`, oppure `null` se il valore non è una delle
/// cinque, scritta così.
export function parseUnits(value: string): LengthUnit | null {
  return (UNITS as readonly string[]).includes(value) ? (value as LengthUnit) : null;
}

/// Le guide scritte in `fub:guides`, nell'ordine del file, oppure `null` se
/// il valore è fuori grammatica o ne porta più di [`MAX_GUIDES`]. Un valore
/// vuoto, o di soli spazi, non ha guide.
export function parseGuides(value: string): readonly RulerGuide[] | null {
  if (value.split(SPACES).every((word) => word === "")) return [];
  const entries = value.split(";");
  if (entries.length > MAX_GUIDES) return null;
  const guides: RulerGuide[] = [];
  for (const entry of entries) {
    const [axis, at, ...rest] = entry.split(SPACES).filter((word) => word !== "");
    if (axis !== "x" && axis !== "y") return null;
    const position = at === undefined ? null : svgNumber(at);
    if (position === null) return null;
    let locked = false;
    let board: string | undefined;
    let layer: string | undefined;
    // Le parti dopo il numero, in qualunque ordine, ognuna al più una volta.
    for (const part of rest) {
      if (part === "locked" && !locked) locked = true;
      else if (part.startsWith("board=") && part.length > 6 && board === undefined) board = part.slice(6);
      else if (part.startsWith("layer=") && part.length > 6 && layer === undefined) layer = part.slice(6);
      else return null;
    }
    // `-0` è `0`: una guida non ha segno.
    guides.push({
      axis,
      at: position + 0,
      locked,
      ...(board === undefined ? {} : { board }),
      ...(layer === undefined ? {} : { layer }),
    });
  }
  return guides;
}
