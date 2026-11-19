// Il frontespizio, l'indice e i numeri delle pagine (E28, T73), senza DOM.
//
// Le pagine dello spazio «Esporta in PDF» sono tre specie di fogli, in
// quest'ordine: il frontespizio (se c'è), le pagine dell'indice (se c'è e la
// nota ha titoli), poi le pagine della nota che l'impaginatore ha tagliato
// (`rules.ts`, `slices.ts`). Qui si decide quanti fogli sono, che numero porta
// ciascuno e che cosa dice l'indice.
//
// I numeri:
// - il frontespizio non mostra né testata né piè;
// - con i numeri arabi il frontespizio non si conta: l'indice è pagina 1 e la
//   nota continua da lì, il totale le conta tutte e due;
// - con i numeri romani (`numeri_romani`) frontespizio e indice si contano
//   «i, ii, iii…» (il frontespizio è la i, senza mostrarla), la nota riparte
//   da 1 e il suo totale conta solo le sue pagine;
// - «prima pagina senza testata» toglie la testata al primo foglio che ne
//   avrebbe una (il primo dopo il frontespizio); il piè resta.
//
// L'indice si fa in due passate: la prima lo misura coi numeri ancora da
// scrivere e dice quante pagine prende; da lì si sa da che numero comincia
// la nota, e la seconda scrive i numeri veri e lo misura di nuovo. Se la
// seconda misura cambia il numero delle sue pagine (un numero più largo manda
// a capo un titolo lungo), si rifà finché non resta fermo. Finché
// l'impaginatore non ha finito, la pagina di un titolo non è sicura e
// l'indice dice «…».
//
// La «sezione corrente» della testata è l'ultimo Titolo 1 o 2 cominciato
// prima della pagina; se la pagina comincia con un titolo così, o se nessuno
// è ancora cominciato, quello della pagina.

import type { Box, Page } from "./model";

/// Che cosa sta su un foglio.
export type SheetKind = "frontespizio" | "indice" | "pagina";

/// Un foglio dello spazio, nell'ordine in cui esce.
export interface Sheet {
  readonly kind: SheetKind;
  /// Per una pagina della nota l'indice in `Pagination.pages`; per una pagina
  /// dell'indice quale delle sue pagine; 0 per il frontespizio.
  readonly index: number;
  /// Il numero come si stampa («3», «ii»); vuoto sul frontespizio.
  readonly number: string;
  /// Il totale della stessa numerazione, per «pagina di pagine»: «…»
  /// finché le pagine della nota non sono contate.
  readonly total: string;
  readonly header: boolean;
  readonly footer: boolean;
}

/// Le scelte del profilo che contano qui.
export interface FrontSettings {
  readonly cover: boolean;
  readonly toc: boolean;
  readonly roman: boolean;
  readonly firstWithoutHeader: boolean;
  /// Fino a che livello di titolo arriva l'indice: 2 o 3.
  readonly depth: number;
}

/// Il segno di ciò che non è ancora sicuro.
export const PENDING = "…";

/// L'identità del titolo che la resa mette in cima (il nome della nota,
/// `blockId` in `measure.ts`): non è una voce dell'indice né una sezione.
export const TITLE_ID = "titolo";

/// Un numero romano minuscolo, da 1 a 3999; oltre (o sotto) le cifre arabe.
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const steps: readonly [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let rest = n;
  let out = "";
  for (const [value, digits] of steps) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

/// I fogli, dati quante pagine prende l'indice e quante la nota. `final`
/// dice se il conto delle pagine della nota è sicuro.
export function sheetsOf(settings: FrontSettings, tocPages: number, flowPages: number, final = true): Sheet[] {
  const sheets: Sheet[] = [];
  const front = (settings.cover ? 1 : 0) + tocPages;
  const flowTotal = final ? String(flowPages) : PENDING;
  // Con i numeri arabi il frontespizio non si conta: indice e nota insieme.
  const arabicTotal = final ? String(tocPages + flowPages) : PENDING;
  let headerTaken = false;
  const header = () => {
    if (headerTaken || !settings.firstWithoutHeader) {
      headerTaken = true;
      return true;
    }
    headerTaken = true;
    return false;
  };
  if (settings.cover) sheets.push({ kind: "frontespizio", index: 0, number: settings.roman ? roman(1) : "", total: settings.roman ? roman(front) : "", header: false, footer: false });
  for (let i = 0; i < tocPages; i++) {
    const ordinal = (settings.cover ? 1 : 0) + i + 1;
    sheets.push({
      kind: "indice",
      index: i,
      number: settings.roman ? roman(ordinal) : String(i + 1),
      total: settings.roman ? roman(front) : arabicTotal,
      header: header(),
      footer: true,
    });
  }
  for (let i = 0; i < flowPages; i++) {
    sheets.push({
      kind: "pagina",
      index: i,
      number: settings.roman ? String(i + 1) : String(tocPages + i + 1),
      total: settings.roman ? flowTotal : arabicTotal,
      header: header(),
      footer: true,
    });
  }
  return sheets;
}

/// Un titolo della nota, come lo vede l'indice.
export interface TocHeading {
  /// L'indice della scatola in `SlicedResult.boxes`.
  readonly box: number;
  readonly id: string;
  readonly level: number;
  readonly text: string;
  /// Il numero del titolo (`data-print-number`), vuoto se non ne ha.
  readonly number: string;
}

/// Una voce dell'indice col numero della sua pagina.
export interface TocEntry extends TocHeading {
  readonly page: string;
}

/// I titoli che vanno nell'indice: quelli fino al livello `depth`, senza il
/// nome della nota in cima e senza i titoli vuoti.
export function tocHeadings(headings: readonly TocHeading[], depth: number): TocHeading[] {
  const limit = depth >= 3 ? 3 : 2;
  return headings.filter((heading) => heading.id !== TITLE_ID && heading.level <= limit && heading.text.trim() !== "");
}

/// Le misure di un indice: l'altezza utile della pagina, quella del titolo
/// «Indice» (sulla prima pagina sola) e quella di ogni voce, nell'ordine.
export interface TocMetrics {
  readonly page: number;
  readonly heading: number;
  readonly rows: readonly number[];
}

/// Quante voci stanno su ogni pagina dell'indice. Ogni pagina ha almeno una
/// voce, anche se è più alta della pagina; senza voci, nessuna pagina.
export function splitToc(metrics: TocMetrics): number[] {
  const pages: number[] = [];
  let used = metrics.heading;
  let count = 0;
  for (const row of metrics.rows) {
    if (count > 0 && used + row > metrics.page + 0.5) {
      pages.push(count);
      used = 0;
      count = 0;
    }
    used += row;
    count++;
  }
  if (count > 0) pages.push(count);
  return pages;
}

/// Il frontespizio, l'indice e i numeri di tutti i fogli.
export interface FrontMatter {
  readonly sheets: readonly Sheet[];
  /// Le voci di ogni pagina dell'indice.
  readonly toc: readonly (readonly TocEntry[])[];
  /// Quanti fogli vengono prima delle pagine della nota.
  readonly front: number;
}

export interface FrontInput {
  readonly settings: FrontSettings;
  /// Tutti i titoli della nota impaginata, nell'ordine.
  readonly headings: readonly TocHeading[];
  /// Quante pagine ha la nota, e se il conto è sicuro.
  readonly flowPages: number;
  readonly final: boolean;
  /// La pagina (da 0) dove comincia ogni scatola: `null` finché
  /// l'impaginatore non ha finito.
  readonly firstPage: readonly number[] | null;
  /// Misura le voci dell'indice, coi numeri che porteranno.
  readonly measure: (entries: readonly TocEntry[]) => TocMetrics;
}

/// Quante volte al più si rifà l'indice perché i numeri lo cambiano.
const MAX_PASSES = 4;

/// Le due passate dell'indice: misura senza numeri, numera, rimisura coi
/// numeri veri finché le sue pagine non restano quelle.
export function frontMatter(input: FrontInput): FrontMatter {
  const { settings } = input;
  const headings = settings.toc ? tocHeadings(input.headings, settings.depth) : [];
  // Prima passata: i numeri non ci sono ancora, si misura col più largo
  // possibile (le cifre del totale), così la seconda di solito conferma.
  const widest = "0".repeat(String(input.flowPages + headings.length + 1).length);
  let entries: TocEntry[] = headings.map((heading) => ({ ...heading, page: widest }));
  let split = headings.length > 0 ? splitToc(input.measure(entries)) : [];
  let sheets = sheetsOf(settings, split.length, input.flowPages, input.final);
  for (let pass = 0; pass < MAX_PASSES && headings.length > 0; pass++) {
    entries = numbered(headings, sheets, input.firstPage);
    const again = splitToc(input.measure(entries));
    if (again.length === split.length) {
      split = again;
      break;
    }
    split = again;
    sheets = sheetsOf(settings, split.length, input.flowPages, input.final);
  }
  // L'ultima passata può aver cambiato le pagine: i numeri seguono i fogli.
  if (headings.length > 0) entries = numbered(headings, sheets, input.firstPage);
  const toc: TocEntry[][] = [];
  let at = 0;
  for (const count of split) {
    toc.push(entries.slice(at, at + count));
    at += count;
  }
  return { sheets, toc, front: sheets.length - input.flowPages };
}

function numbered(headings: readonly TocHeading[], sheets: readonly Sheet[], firstPage: readonly number[] | null): TocEntry[] {
  const flow = sheets.filter((sheet) => sheet.kind === "pagina");
  return headings.map((heading) => {
    const page = firstPage?.[heading.box];
    const sheet = page !== undefined && page >= 0 ? flow[page] : undefined;
    return { ...heading, page: sheet?.number ?? PENDING };
  });
}

/// La sezione corrente di ogni pagina della nota (per la testata): il testo
/// dell'ultimo titolo di sezione cominciato. `sections` dà, per indice di
/// scatola, il testo dei titoli che aprono una sezione.
export function sectionsByPage(pages: readonly Page[], sections: ReadonlyMap<number, string>): string[] {
  const out: string[] = [];
  let current = "";
  for (const page of pages) {
    const begun = page.placements.filter((placement) => placement.part === "corpo" && !placement.continued && sections.has(placement.box)).map((placement) => sections.get(placement.box) ?? "");
    const first = page.placements.find((placement) => placement.part === "corpo");
    const opens = first !== undefined && !first.continued && sections.has(first.box);
    out.push(begun.length > 0 && (opens || current === "") ? begun[0] : current);
    if (begun.length > 0) current = begun[begun.length - 1];
  }
  return out;
}

/// I titoli che aprono una sezione: i Titoli 1 e 2 non vuoti, senza il nome
/// della nota in cima.
export function sectionHeadings(headings: readonly TocHeading[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const heading of headings) {
    if (heading.id === TITLE_ID || heading.level > 2) continue;
    const text = heading.text.trim();
    if (text) out.set(heading.box, text);
  }
  return out;
}

/// I titoli fra le scatole impaginate: `text` legge testo e numero del
/// blocco della resa (`blocks[box]`).
export function headingsOf(boxes: readonly Box[], text: (box: number) => { readonly text: string; readonly number: string }): TocHeading[] {
  const out: TocHeading[] = [];
  boxes.forEach((box, index) => {
    if (box.kind !== "heading") return;
    const read = text(index);
    out.push({ box: index, id: box.id, level: box.level, text: read.text.replace(/\s+/gu, " ").trim(), number: read.number });
  });
  return out;
}
