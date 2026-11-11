// Le fonti di una lavagna (N6 T77, S16 di `lavagna.md`): per ogni file che
// le schede mostrano, che cosa ne mostrano. Le pagine di un PDF (`#page=N`,
// le schede di «Spargi le pagine», le pagine e la zona di `fub:parts`), le
// sezioni di una nota (`#Titolo` e `fub:parts` `sections`) o il file intero.
//
// Qui non c'è né DOM né IPC: si leggono le schede, come le legge la tela, e
// si dà l'elenco. Quante pagine ha un PDF e quali sezioni ha una nota non lo
// dice la lavagna: li chiede l'ispettore (`chrome/inspector.ts`), che mette
// insieme le une e le altre in una barra (`sourceBar`).
//
// Un pezzo usato porta alla scheda che lo mostra: per questo ogni uso tiene
// la posizione della scheda fra le schede lette (`boardCards`), che dà il
// byte dove comincia il suo oggetto.

import { cardKindOf, type CardKind } from "./cards";
import { sectionHeading } from "./excerpt";
import type { CanvasNode } from "./model";
import { cardParts } from "./parts";

/// Una pagina di un PDF sulla lavagna: la prima scheda (in ordine di file)
/// che la mostra.
export interface SourcePage {
  readonly page: number;
  readonly card: number;
}

/// Una sezione di una nota sulla lavagna, come sta dopo il `#`
/// (`Varianza`, `Capitolo#Varianza`), con la prima scheda che la mostra.
export interface SourceSection {
  readonly key: string;
  readonly card: number;
}

/// Un file mostrato da almeno una scheda.
export interface BoardSource {
  /// Il file nel vault, senza `#…`.
  readonly path: string;
  /// Il nome che si legge: l'ultimo pezzo del percorso.
  readonly name: string;
  /// La specie del file, come la scheda (`cardKindOf`).
  readonly kind: CardKind;
  /// Le schede del file: la loro posizione fra le schede lette, in ordine.
  readonly cards: readonly number[];
  /// Le pagine usate, dalla più bassa.
  readonly pages: readonly SourcePage[];
  /// Le sezioni usate, nell'ordine in cui la lavagna le incontra.
  readonly sections: readonly SourceSection[];
  /// La prima scheda che mostra il file intero, o `null`.
  readonly whole: number | null;
}

/// Il file e il `subpath` di una scheda di file: `Nota.md#Titolo` vale come
/// `file: "Nota.md"` con `subpath: "#Titolo"`, come per la tela.
function targetOf(node: CanvasNode): { readonly path: string; readonly subpath: string | null } | null {
  if (node.type !== "file" || typeof node.file !== "string") return null;
  const file = node.file;
  const hash = file.indexOf("#");
  const path = hash < 0 ? file : file.slice(0, hash);
  if (path.trim() === "") return null;
  const subpath = typeof node.subpath === "string" && node.subpath ? node.subpath : hash < 0 ? null : file.slice(hash);
  return { path, subpath };
}

/// La pagina di `#page=3` (da 1), come la legge la scheda del PDF; `null` se
/// il `subpath` non ne dice una.
export function subpathPage(subpath: string | null): number | null {
  if (subpath === null) return null;
  const match = /(?:^#|&)page=(\d+)(?:&|$)/.exec(subpath);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/// Le pagine, le sezioni o il file intero che una scheda mostra.
type Use =
  | { readonly kind: "pages"; readonly pages: readonly number[] }
  | { readonly kind: "sections"; readonly keys: readonly string[] }
  | { readonly kind: "whole" }
  | { readonly kind: "other" };

function useOf(node: CanvasNode, kind: CardKind, subpath: string | null): Use {
  // Le parti valide di `fub:parts` prima; un campo che si conserva senza
  // mostrarlo vale come se non ci fosse, e conta il `subpath`, come per la scheda.
  const parts = cardParts(node);
  if (parts?.kind === "pages") return { kind: "pages", pages: parts.pages };
  if (parts?.kind === "region") return { kind: "pages", pages: [parts.page] };
  if (parts?.kind === "sections") {
    const keys = parts.sections.filter((key) => sectionHeading(key) !== null);
    return keys.length > 0 ? { kind: "sections", keys } : { kind: "whole" };
  }
  // La zona di un'immagine è dell'immagine intera: la barra ha un pezzo solo.
  if (parts?.kind === "image") return { kind: "whole" };
  if (subpath === null || subpath === "#") return { kind: "whole" };
  if (kind === "pdf") {
    const page = subpathPage(subpath);
    return page === null ? { kind: "whole" } : { kind: "pages", pages: [page] };
  }
  if (kind === "note") {
    // `#^blocco` non è una sezione: la scheda mostra un blocco della nota,
    // che la barra delle sezioni non sa dove mettere.
    const key = subpath.replace(/^#/, "");
    return sectionHeading(key) === null ? { kind: "other" } : { kind: "sections", keys: [key] };
  }
  return { kind: "whole" };
}

/// Il nome che si legge di un file: `Corsi/Lezione 4.pdf` → `Lezione 4.pdf`.
export function sourceName(path: string): string {
  return path.split("/").pop() || path;
}

const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/// Le fonti di una lavagna: ogni file che almeno una scheda mostra, in ordine
/// di nome (poi di percorso, per due file con lo stesso nome in cartelle
/// diverse). `nodes` sono le schede lette (`boardCards`): la posizione di una
/// scheda in `nodes` è quella che gli usi tengono.
export function boardSources(nodes: readonly CanvasNode[]): BoardSource[] {
  interface Building {
    path: string;
    kind: CardKind;
    cards: number[];
    pages: Map<number, number>;
    sections: Map<string, number>;
    whole: number | null;
  }
  const byPath = new Map<string, Building>();
  nodes.forEach((node, at) => {
    const target = targetOf(node);
    if (target === null) return;
    const kind = cardKindOf(node) ?? "file";
    let source = byPath.get(target.path);
    if (!source) {
      source = { path: target.path, kind, cards: [], pages: new Map(), sections: new Map(), whole: null };
      byPath.set(target.path, source);
    }
    source.cards.push(at);
    const use = useOf(node, kind, target.subpath);
    switch (use.kind) {
      case "pages":
        for (const page of use.pages) if (!source.pages.has(page)) source.pages.set(page, at);
        break;
      case "sections":
        for (const key of use.keys) if (!source.sections.has(key)) source.sections.set(key, at);
        break;
      case "whole":
        if (source.whole === null) source.whole = at;
        break;
      case "other":
        break;
    }
  });
  return [...byPath.values()]
    .map((source): BoardSource => ({
      path: source.path,
      name: sourceName(source.path),
      kind: source.kind,
      cards: source.cards,
      pages: [...source.pages].map(([page, card]) => ({ page, card })).sort((a, b) => a.page - b.page),
      sections: [...source.sections].map(([key, card]) => ({ key, card })),
      whole: source.whole,
    }))
    .sort((a, b) => ORDER.compare(a.name, b.name) || ORDER.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// --- la barra ---------------------------------------------------------------------

/// Oltre questi pezzi la barra di un PDF mette più pagine in un pezzo: un
/// libro di mille pagine resta una barra che si legge e si attraversa.
export const SOURCE_BAR_MAX_PIECES = 200;

/// Un pezzo della barra: una pagina (o più, in un PDF lungo), una sezione o il
/// file intero. `card` è la scheda che lo mostra, `null` se non è sulla lavagna.
export type SourcePiece =
  | { readonly kind: "pages"; readonly from: number; readonly to: number; readonly card: number | null }
  | { readonly kind: "section"; readonly key: string; readonly text: string; readonly card: number | null }
  | { readonly kind: "whole"; readonly card: number | null };

/// Ciò che si sa del file, oltre la lavagna: quante pagine ha un PDF; le
/// sezioni di una nota (`key` come le scrive il selettore, `text` il titolo).
export interface SourceFacts {
  /// `null`: non si sa (ancora).
  readonly pages?: number | null;
  /// `null`: non si sa (ancora). Vuoto: la nota non ha titoli.
  readonly sections?: readonly { readonly key: string; readonly text: string }[] | null;
}

/// La riga di un file: la barra, se si sa disegnarla, e le pagine usate che
/// si dicono a parole quando non si sa quante pagine ha il PDF («pp. 3, 7»).
export interface SourceBar {
  readonly pieces: readonly SourcePiece[];
  readonly loose: readonly number[];
}

/// Che cosa chiedere del file per disegnarne la barra: quante pagine ha un
/// PDF, le sezioni di una nota; `null` se la barra non ne ha bisogno.
export function sourceNeeds(source: BoardSource): "pages" | "sections" | null {
  if (source.whole !== null && source.pages.length === 0 && source.sections.length === 0) return null;
  if (source.kind === "pdf") return "pages";
  if (source.kind === "note") return "sections";
  return null;
}

/// La barra di un file: il file intero se le schede lo mostrano solo intero;
/// per un PDF le pagine (da `facts.pages`), per una nota le sezioni (da
/// `facts.sections`), sennò il file intero. Un PDF di cui non si sa quante
/// pagine ha non ha barra: le sue pagine usate stanno in `loose`. Una nota
/// senza titoli ha il pezzo «tutta»; le sezioni usate che il sommario non ha
/// più restano in fondo, così la barra dice ciò che c'è sulla lavagna.
export function sourceBar(source: BoardSource, facts: SourceFacts): SourceBar {
  // Il file solo intero, come il prototipo: un pezzo che riempie la barra.
  if (source.whole !== null && source.pages.length === 0 && source.sections.length === 0) {
    return { pieces: [{ kind: "whole", card: source.whole }], loose: [] };
  }
  if (source.kind === "pdf") return pdfBar(source, facts.pages ?? null);
  if (source.kind === "note") return noteBar(source, facts.sections ?? null);
  return { pieces: [{ kind: "whole", card: source.whole ?? source.cards[0] ?? null }], loose: [] };
}

function pdfBar(source: BoardSource, count: number | null): SourceBar {
  const usedPages = source.pages;
  if (count === null || count < 1) {
    if (usedPages.length > 0) return { pieces: [], loose: usedPages.map((one) => one.page) };
    return { pieces: [{ kind: "whole", card: source.whole ?? source.cards[0] ?? null }], loose: [] };
  }
  const total = Math.max(count, usedPages[usedPages.length - 1]?.page ?? 0);
  const step = Math.ceil(total / SOURCE_BAR_MAX_PIECES);
  const cardOf = new Map(usedPages.map((one) => [one.page, one.card]));
  const pieces: SourcePiece[] = [];
  for (let from = 1; from <= total; from += step) {
    const to = Math.min(total, from + step - 1);
    let card: number | null = null;
    for (let page = from; page <= to && card === null; page++) card = cardOf.get(page) ?? null;
    // Il PDF intero sulla lavagna: ogni pagina c'è, e porta a quella scheda.
    if (card === null && source.whole !== null) card = source.whole;
    pieces.push({ kind: "pages", from, to, card });
  }
  return { pieces, loose: [] };
}

function noteBar(source: BoardSource, sections: SourceFacts["sections"]): SourceBar {
  const used = source.sections;
  if (sections === null || sections === undefined || sections.length === 0) {
    // Senza sommario (o senza titoli) la nota è un pezzo solo: «tutta». È
    // usato se una scheda mostra la nota, intera o in parte.
    if ((sections !== null && sections !== undefined) || used.length === 0) {
      return { pieces: [{ kind: "whole", card: source.whole ?? used[0]?.card ?? null }], loose: [] };
    }
    return { pieces: used.map((one) => ({ kind: "section", key: one.key, text: sectionHeading(one.key) ?? one.key, card: one.card })), loose: [] };
  }
  // Una chiave usata trova la sua sezione per chiave intera; se no per il
  // titolo più interno, quando nella nota c'è un titolo solo con quel testo.
  const byText = new Map<string, number>();
  for (const section of sections) byText.set(section.text, (byText.get(section.text) ?? 0) + 1);
  const matched = new Set<string>();
  const cardOf = (section: { readonly key: string; readonly text: string }): number | null => {
    let card: number | null = null;
    for (const one of used) {
      const heading = sectionHeading(one.key);
      if (one.key === section.key || (byText.get(section.text) === 1 && heading === section.text)) {
        matched.add(one.key);
        if (card === null) card = one.card;
      }
    }
    // La nota intera sulla lavagna: ogni sezione c'è.
    return card ?? source.whole;
  };
  const pieces: SourcePiece[] = sections.map((section) => ({ kind: "section", key: section.key, text: section.text, card: cardOf(section) }));
  for (const one of used) {
    if (!matched.has(one.key)) pieces.push({ kind: "section", key: one.key, text: sectionHeading(one.key) ?? one.key, card: one.card });
  }
  return { pieces, loose: [] };
}
