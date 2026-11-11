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
