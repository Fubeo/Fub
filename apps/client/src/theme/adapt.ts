// I colori di un file portati su un'altra carta: l'aspetto «adattato».
//
// Un documento o un foglio di calcolo porta i suoi colori, scelti per la carta
// bianca su cui li ha visti chi li ha scritti. Sulla carta scura del tema
// quegli stessi colori non si leggono più: il nero sparisce, il blu di un
// collegamento scende a 2:1. L'aspetto adattato tiene la *tinta* che il file ha
// scelto e cambia soltanto la chiarezza, finché il colore regge sulla carta
// nuova quanto reggeva su quella vecchia.
//
// # La regola, in tre righe
//
// - il colore tiene il contrasto che aveva sulla carta del file, ma non scende
//   sotto la soglia di legge (4,5:1, o 3:1 per il testo grande) e non sale oltre
//   l'inchiostro della carta nuova: un nero scelto nel file diventa
//   l'inchiostro, non un bianco che abbaglia;
// - cambia soltanto la chiarezza in OKLCH; il croma scende solo quando il
//   colore uscirebbe da sRGB, che è la scelta di `oklch.ts`;
// - un fondo e il suo testo si correggono in coppia: prima il fondo rispetto
//   alla carta, poi il testo rispetto al fondo nuovo.
//
// # Perché qui, e una volta sola
//
// Perché i clienti sono più d'uno — il documento, la griglia — e devono dare lo
// stesso colore allo stesso valore. La griglia ne dipinge migliaia per
// schermata: ogni carta ha la sua cache.

import { channels, contrast } from "./contrast";
import { fromHex, toHex } from "./oklch";

/// La carta su cui si porta il colore: il fondo e l'inchiostro del tema. `from`
/// è la carta per cui il file ha scelto i suoi colori, il bianco se non dice
/// altro.
export type Paper = { readonly bg: string; readonly ink: string; readonly from?: string };

/// La soglia del testo normale e del testo grande (da 24 px, o 18,66 px in
/// grassetto). Un fondo non ha soglia: conta soltanto la distanza dalla carta.
export const TEXT_MINIMUM = 4.5;
export const LARGE_MINIMUM = 3;

/// Che cosa sta portando: il testo (normale o grande) o un fondo.
export type Use = "text" | "large" | "fill";

/// L'inchiostro del testo per cui il file ha scelto «automatico»: il nero sul
/// bianco.
export const AUTO_INK = "#000000";

/// Grande, per la soglia del contrasto: da 18 pt, o da 14 pt in grassetto.
export function textUse(pt: number, bold: boolean): Exclude<Use, "fill"> {
  return pt >= 18 || (bold && pt >= 14) ? "large" : "text";
}

export type Adapter = {
  /// Il colore di un testo, o di un fondo, sulla carta.
  readonly color: (color: string, use?: Use) => string;
  /// Un fondo con il suo testo: il fondo si porta sulla carta, il testo sul
  /// fondo nuovo.
  readonly pair: (fill: string, text: string, use?: Exclude<Use, "fill">) => { fill: string; text: string };
};

const adapters = new Map<string, Adapter>();

/// L'adattatore di una carta, sempre lo stesso per la stessa carta.
export function adapter(paper: Paper): Adapter {
  const bg = hex(paper.bg) ?? paper.bg;
  const ink = hex(paper.ink) ?? paper.ink;
  const from = hex(paper.from ?? "#ffffff") ?? "#ffffff";
  const key = `${bg} ${ink} ${from}`;
  const known = adapters.get(key);
  if (known) return known;
  const cache = new Map<string, string>();
  const color = (value: string, use: Use = "text"): string => {
    const id = `${use} ${value}`;
    let done = cache.get(id);
    if (done === undefined) {
      done = adapt(value, from, bg, ink, use);
      cache.set(id, done);
    }
    return done;
  };
  const made: Adapter = {
    color,
    pair: (fill, text, use = "text") => {
      const moved = color(fill, "fill");
      const original = hex(fill);
      return { fill: moved, text: original ? adapter({ bg: moved, ink, from: original }).color(text, use) : color(text, use) };
    },
  };
  adapters.set(key, made);
  return made;
}

/// Un colore portato da una carta all'altra. Un valore che non è un colore
/// pieno (`auto`, una variabile, un'alfa) torna com'è: deciderlo è di chi lo
/// scrive.
export function adapt(color: string, from: string, to: string, ink: string, use: Use = "text"): string {
  const value = hex(color);
  if (!value) return color;
  const minimum = use === "fill" ? 1 : use === "large" ? LARGE_MINIMUM : TEXT_MINIMUM;
  const stop = contrast(ink, to);
  // Il colore va dalla parte dell'inchiostro. Se l'inchiostro non regge sulla
  // carta (un fondo chiaro di una cella, su una carta scura), va dalla parte
  // in cui c'è più distanza, e non c'è un tetto.
  const inkSide = stop >= minimum;
  const up = inkSide ? lightness(ink) > lightness(to) : contrast("#ffffff", to) > contrast("#000000", to);
  const wanted = Math.max(minimum, Math.min(contrast(value, from), inkSide ? stop : Infinity));
  const { c, h } = fromHex(value);
  const at = (l: number) => toHex({ l, c, h });
  // La chiarezza più vicina alla carta che arriva al contrasto voluto. La
  // bisezione ha giri fissi, come in `oklch.ts`: lo stesso colore dà sempre
  // gli stessi byte.
  let near = lightness(to);
  let far = up ? 1 : 0;
  if (contrast(at(far), to) <= wanted) return at(far);
  for (let i = 0; i < 24; i += 1) {
    const middle = (near + far) / 2;
    if (contrast(at(middle), to) >= wanted) far = middle;
    else near = middle;
  }
  return at(far);
}

function lightness(color: string): number {
  return fromHex(color).l;
}

/// `#rrggbb` minuscolo, o `null` se il valore non è un colore pieno.
function hex(color: string): string | null {
  try {
    return `#${channels(color)
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return null;
  }
}
