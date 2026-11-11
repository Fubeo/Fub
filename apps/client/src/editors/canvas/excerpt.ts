// La scheda-estratto (N6 T75, S8, S9 e S11 di `lavagna.md`): una scheda di
// nota che mostra solo alcune sezioni del file vero, scelte col selettore
// (T74) e scritte in `fub:parts` o nel solo `subpath` (T73).
//
// Un estratto si riconosce dalla testata (D-21 (a), T39: sopra la scheda):
// accanto al nome della fonte le parti in colore d'accento («§ Varianza ·
// § Media») e ↗, che apre la fonte accanto alla prima sezione; Ctrl+clic
// (Cmd+clic) su ↗ la apre nel riquadro. Qui stanno le regole pure (quali
// sezioni mostra una scheda, come si chiamano, dove porta ↗) e la testata;
// il corpo lo rende la scheda di nota (`cards/note.ts`), i gesti e «Mostra
// tutto il file» li fa la tela (`engine.ts`).
//
// In v1 gli estratti sono delle note; quelli dei PDF arrivano con T82.

import { t } from "../../i18n/strings";
import { cardKindOf } from "./cards";
import type { CanvasNode } from "./model";
import { nodeParts, type CanvasParts } from "./parts";

/// Il segno di una sezione nella testata e nel corpo.
export const SECTION_SIGN = "§";

/// Una scheda-estratto di nota: le sezioni che mostra, nell'ordine scelto.
export interface NoteExcerpt {
  readonly kind: "sections";
  /// Le chiavi come stanno dopo il `#` (`Varianza`, `Capitolo#Varianza`).
  readonly sections: readonly string[];
}

/// Il titolo che una chiave cerca: `Varianza` → `Varianza`, `A#B` → `B` (il
/// più interno, come i link di Obsidian); `^blocco` o vuota → `null`, cioè
/// non una sezione.
export function sectionHeading(key: string): string | null {
  const parts = key.split("#").map((part) => part.trim()).filter((part) => part !== "");
  const last = parts[parts.length - 1];
  if (last === undefined || last.startsWith("^")) return null;
  return last;
}

/// Le sezioni che una scheda di nota mostra: quelle di un `fub:parts` di
/// sezioni letto e provato (`parts`), sennò quella del `subpath` (`#Titolo`,
/// anche `#Capitolo#Titolo`); vuoto per la nota intera o un blocco `#^id`.
export function excerptSections(parts: CanvasParts | null | undefined, subpath: string | null | undefined): string[] {
  if (parts?.kind === "sections") return parts.sections.filter((key) => sectionHeading(key) !== null);
  if (typeof subpath !== "string" || sectionHeading(subpath) === null) return [];
  return [subpath.replace(/^#/, "")];
}

/// La scheda è un estratto di nota? Le sezioni le dicono `fub:parts` (se si
/// legge) o il `subpath`, come per la scheda di nota.
export function noteExcerptOf(node: CanvasNode): NoteExcerpt | null {
  if (node.type !== "file" || typeof node.file !== "string" || cardKindOf(node) !== "note") return null;
  const read = nodeParts(node);
  const parts = read?.state === "ok" ? read.parts : null;
  const sections = excerptSections(parts, typeof node.subpath === "string" ? node.subpath : null);
  return sections.length > 0 ? { kind: "sections", sections } : null;
}

/// Il nome di una sezione come si legge: «§ Varianza».
export function sectionLabel(key: string): string {
  return `${SECTION_SIGN} ${sectionHeading(key) ?? key}`;
}

/// Le parti della testata: «§ Varianza · § Media».
export function excerptPartsLabel(excerpt: NoteExcerpt): string {
  return excerpt.sections.map(sectionLabel).join(" · ");
}

/// Dove porta ↗: il file alla prima sezione, nella forma di «Apri»
/// (`/Cartella/Nota.md#Varianza`).
export function excerptSourcePath(file: string, excerpt: NoteExcerpt): string {
  return `/${file.replace(/^\/+/, "")}#${excerpt.sections[0]}`;
}

/// Il nome della fonte, senza cartelle né estensione, per il nome di ↗.
function sourceName(file: string): string {
  const base = file.split("/").pop() || file;
  return base.replace(/\.[^.]+$/, "") || base;
}

/// Un titolo `#` del testo di una nota: il livello, il testo e dove sta.
interface NoteHeading {
  readonly level: number;
  /// Il testo senza `#` né spazi ai lati, in minuscolo: si confronta così.
  readonly text: string;
  /// Dove comincia la riga del titolo (unità UTF-16 del testo).
  readonly start: number;
}

/// I titoli `#` di una nota, in ordine: fuori dai blocchi di codice e dalle
/// proprietà in testa (`---`), come `headingOffset` dell'editor delle schede.
/// Un `---` in testa che non si chiude non apre le proprietà: è una riga.
function noteHeadings(text: string, properties = text.startsWith("---\n") || text.startsWith("---\r\n")): NoteHeading[] {
  const headings: NoteHeading[] = [];
  let at = 0;
  let fence: string | null = null;
  let front = properties;
  let first = true;
  for (const line of text.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, "");
    if (front) {
      if (!first && /^(---|\.\.\.)\s*$/.test(bare)) front = false;
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(bare);
      if (fence !== null) {
        if (opening && opening[1]!.startsWith(fence)) fence = null;
      } else if (opening) {
        fence = opening[1]!;
      } else {
        const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(bare);
        if (match) headings.push({ level: match[1]!.length, text: (match[2] ?? "").trim().toLowerCase(), start: at });
      }
    }
    first = false;
    at += line.length;
  }
  return front ? noteHeadings(text, false) : headings;
}

/// Il testo di una sezione: dalla riga del suo titolo al titolo dopo di
/// livello uguale o più alto (o alla fine), senza le righe vuote in coda.
/// `key` è come dopo il `#`: `Varianza`, o `Capitolo#Varianza` (il titolo
/// cercato dentro la sezione del capitolo, come Obsidian). Senza maiuscole.
/// `null` se la nota non ha quella sezione.
export function noteSectionText(text: string, key: string): string | null {
  const wanted = key.split("#").map((part) => part.trim().toLowerCase()).filter((part) => part !== "");
  if (wanted.length === 0 || wanted[wanted.length - 1]!.startsWith("^")) return null;
  const headings = noteHeadings(text);
  // Lo spazio in cui si cerca: all'inizio la nota intera, poi la sezione trovata.
  let from = 0;
  let to = headings.length;
  let found = -1;
  for (const part of wanted) {
    found = -1;
    for (let index = from; index < to; index++) {
      if (headings[index]!.text === part) {
        found = index;
        break;
      }
    }
    if (found < 0) return null;
    const level = headings[found]!.level;
    let end = found + 1;
    while (end < headings.length && headings[end]!.level > level) end++;
    from = found + 1;
    to = end;
  }
  const start = headings[found]!.start;
  const stop = to < headings.length ? headings[to]!.start : text.length;
  return text.slice(start, stop).replace(/\s+$/, "");
}

/// Il testo delle sezioni `keys` di una nota, nell'ordine dato, separate da
/// una riga vuota; `missing` le chiavi che la nota non ha più (non si copiano).
export function noteSectionsText(text: string, keys: readonly string[]): { readonly text: string; readonly missing: readonly string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const section = noteSectionText(text, key);
    if (section === null) missing.push(key);
    else found.push(section);
  }
  return { text: found.join("\n\n"), missing };
}

/// Mette la testata dell'estratto nella riga del titolo della scheda (T39),
/// prima di →: le parti e ↗ (`data-excerpt-open`, il gesto lo prende la
/// tela). Con `excerpt` `null` la toglie. Aggiorna sul posto: chiamata a ogni
/// resa, tocca il DOM solo se qualcosa è cambiato.
export function syncExcerptHead(article: HTMLElement, handle: HTMLElement, before: Element | null, file: string | null, excerpt: NoteExcerpt | null): void {
  let parts = handle.querySelector<HTMLElement>(":scope > .canvas-excerpt-parts");
  let open = handle.querySelector<HTMLButtonElement>(":scope > .canvas-excerpt-open");
  if (excerpt === null || file === null) {
    parts?.remove();
    open?.remove();
    delete article.dataset.cardExcerpt;
    return;
  }
  if (article.dataset.cardExcerpt !== excerpt.kind) article.dataset.cardExcerpt = excerpt.kind;
  if (!parts) {
    parts = document.createElement("span");
    parts.className = "canvas-excerpt-parts";
  }
  if (!open) {
    open = document.createElement("button");
    open.type = "button";
    open.className = "canvas-excerpt-open";
    open.dataset.excerptOpen = "";
    open.textContent = "↗";
  }
  const label = excerptPartsLabel(excerpt);
  if (parts.textContent !== label) parts.textContent = label;
  const partsName = t("canvas.excerpt.parts", { parts: label });
  if (parts.getAttribute("aria-label") !== partsName) parts.setAttribute("aria-label", partsName);
  const openName = t("canvas.excerpt.open", { name: sourceName(file) });
  if (open.getAttribute("aria-label") !== openName) {
    open.setAttribute("aria-label", openName);
    open.title = openName;
  }
  const anchor = before !== null && before.parentElement === handle ? before : null;
  if (parts.nextElementSibling !== open || open.nextElementSibling !== anchor || parts.parentElement !== handle) {
    handle.insertBefore(parts, anchor);
    handle.insertBefore(open, anchor);
  }
}
