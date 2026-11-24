// Grassetto, Corsivo e Sottolineato del menu Testo (VectorCraft `type.bold`, `type.italic`,
// `type.underline`): voci del client che leggono il carattere del primo testo scelto dal motore
// (`document.node`) e mandano `text.setRangeStyle`. Grassetto e Corsivo passano alla faccia
// della famiglia che serve (`text.fontList`), come `toggle_face` di VectorCraft
// (`ui-egui/src/panels/character.rs`): niente grassetto o corsivo finti; una famiglia senza
// quella faccia resta com'è e la voce dice perché.

import { ATTESA_MOTORE_MS, type DipendenzeComando } from "./esegui";

/// Le parole del nome di uno stile che ne dicono il peso: uno stile senza nessuna è il peso
/// normale della famiglia.
const PESI = new Set([
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "book",
  "medium",
  "semibold",
  "demibold",
  "demi",
  "bold",
  "extrabold",
  "ultrabold",
  "heavy",
  "black",
  "ultra",
]);

/// Le parole del peso normale, dritto: non contano fra quelle che Grassetto e Corsivo tengono.
const NORMALI = new Set(["regular", "normal", "roman", "plain", "upright"]);

/// Una faccia letta dal nome del suo stile.
export interface Faccia {
  readonly grassetto: boolean;
  /// Il peso normale (nessuna parola di peso).
  readonly normale: boolean;
  readonly corsivo: boolean;
  /// Le altre parole, in ordine: `Narrow Italic` → `["narrow"]`.
  readonly resto: readonly string[];
}

/// La faccia dello stile `stile`: `Bold Italic` è grassetto e corsivo, `SemiBold` né normale né
/// grassetto, `Narrow Italic` normale e corsivo con `narrow` in più.
export function facciaDi(stile: string): Faccia {
  const parole = stile
    .split(/[ \-_]/)
    .filter((p) => p !== "")
    .map((p) => p.toLowerCase());
  const corsivo = parole.some((p) => p === "italic" || p === "oblique");
  const grassetto = parole.includes("bold");
  const normale = !parole.some((p) => PESI.has(p));
  const resto = parole.filter((p) => !PESI.has(p) && !NORMALI.has(p) && p !== "italic" && p !== "oblique").sort();
  return { grassetto, normale, corsivo, resto };
}

/// Lo stile di `stili` grassetto (o di peso normale) e corsivo (o dritto), con le stesse altre
/// parole di `come` (una faccia Narrow resta Narrow); il nome più corto, se ce ne sono più.
export function scegliFaccia(stili: readonly string[], grassetto: boolean, corsivo: boolean, come: string): string | null {
  const tieni = facciaDi(come).resto.join(" ");
  let scelto: string | null = null;
  for (const stile of stili) {
    const f = facciaDi(stile);
    if (f.corsivo !== corsivo || !(grassetto ? f.grassetto : f.normale) || f.resto.join(" ") !== tieni) continue;
    if (scelto === null || stile.length < scelto.length) scelto = stile;
  }
  return scelto;
}

/// Il nome inglese della faccia voluta, per il messaggio di una famiglia che non ce l'ha (come
/// VectorCraft: è il nome degli stili nei file dei caratteri).
export function nomeDellaFaccia(grassetto: boolean, corsivo: boolean): string {
  if (grassetto) return corsivo ? "Bold Italic" : "Bold";
  return corsivo ? "Italic" : "Regular";
}

/// Il carattere del primo pezzo di un testo, come lo dà `document.node`.
export interface CarattereDelTesto {
  readonly famiglia: string;
  readonly stile: string;
  readonly sottolineato: boolean;
}

/// Il carattere del primo testo dentro il nodo `nodo` (il nodo stesso o un discendente, in
/// ordine), o `null` se non ce n'è.
export function primoCarattere(nodo: unknown): CarattereDelTesto | null {
  const kind = (nodo as { kind?: unknown } | null | undefined)?.kind as
    | { readonly type?: unknown; readonly runs?: unknown; readonly children?: unknown }
    | undefined;
  if (kind === undefined || kind === null) return null;
  if (kind.type === "text" && Array.isArray(kind.runs)) {
    const stile = (kind.runs[0] as { style?: Record<string, unknown> } | undefined)?.style;
    if (stile === undefined) return null;
    return {
      famiglia: typeof stile["font_family"] === "string" ? stile["font_family"] : "",
      stile: typeof stile["font_style"] === "string" ? stile["font_style"] : "",
      sottolineato: stile["underline"] === true,
    };
  }
  if (Array.isArray(kind.children)) {
    for (const figlio of kind.children) {
      const trovato = primoCarattere(figlio);
      if (trovato !== null) return trovato;
    }
  }
  return null;
}

/// Una voce di stile del menu Testo.
export type VoceDiStile = "type.bold" | "type.italic" | "type.underline";

/// Le voci, nell'ordine del menu.
export const VOCI_DI_STILE: readonly VoceDiStile[] = ["type.bold", "type.italic", "type.underline"];

/// Cosa manda la voce: il valore di `text.setRangeStyle`, o la frase del perché non cambia niente.
export type PassoDiStile = { readonly valore: Readonly<Record<string, unknown>> } | { readonly perche: "famiglia"; readonly famiglia: string; readonly faccia: string };

/// Il passo della voce `voce` sul testo di carattere `carattere`, con le facce `stili` della sua
/// famiglia (servono solo a Grassetto e Corsivo).
export function passoDiStile(voce: VoceDiStile, carattere: CarattereDelTesto, stili: readonly string[]): PassoDiStile {
  if (voce === "type.underline") return { valore: { underline: !carattere.sottolineato } };
  const ora = facciaDi(carattere.stile);
  const grassetto = voce === "type.bold" ? !ora.grassetto : ora.grassetto;
  const corsivo = voce === "type.italic" ? !ora.corsivo : ora.corsivo;
  const nome = scegliFaccia(stili, grassetto, corsivo, carattere.stile);
  if (nome === null) return { perche: "famiglia", famiglia: carattere.famiglia, faccia: nomeDellaFaccia(grassetto, corsivo) };
  return { valore: { style: nome } };
}

/// Una lettura del motore (`reading`), o `null` se non risponde o rifiuta.
async function leggi(dipendenze: DipendenzeComando, id: string, value: unknown): Promise<unknown> {
  const sessione = await dipendenze.motore?.pronta(ATTESA_MOTORE_MS);
  if (sessione === null || sessione === undefined || dipendenze.vita.closed) return null;
  const esito = await sessione.comando({ id: `disegno.${id}`, selection: [], value, preview: false });
  if (esito === null || dipendenze.vita.closed || "kind" in esito || esito.refused !== null) return null;
  return esito.reading ?? null;
}

/// Il passo della voce `voce` sul primo testo scelto adesso, letto dal motore; `null` se il motore
/// non risponde o non c'è un testo scelto.
export async function passoSulTesto(dipendenze: DipendenzeComando, voce: VoceDiStile): Promise<PassoDiStile | null> {
  let carattere: CarattereDelTesto | null = null;
  for (const id of dipendenze.selezione()) {
    carattere = primoCarattere(await leggi(dipendenze, "document.node", { id }));
    if (carattere !== null) break;
  }
  if (carattere === null) return null;
  let stili: readonly string[] = [];
  if (voce !== "type.underline") {
    const lista = (await leggi(dipendenze, "text.fontList", { family: carattere.famiglia })) as { styles?: unknown } | null;
    stili = Array.isArray(lista?.styles) ? lista.styles.filter((s): s is string => typeof s === "string") : [];
  }
  return passoDiStile(voce, carattere, stili);
}
