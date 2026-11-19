// Le schede vive sulla carta (E28, T74; il prototipo «Schede vive:
// L'anteprima, Solo il nome», `.pcard`, `.plink`, `.pshot`, passo 29).
//
// Nella nota un file incorporato da solo in un paragrafo (`![[Contratto.pdf]]`,
// `![[Conti.xlsx#Budget]]`) è una scheda viva (T41); nella resa per la stampa
// è la sua anteprima: la prima pagina del PDF, la parte del foglio. Tre scelte:
//
// - l'anteprima: com'è nella resa, col nome del file sotto (se la resa non lo
//   scrive già);
// - solo il nome: una riga con la specie e il nome, al posto dell'anteprima;
// - per un PDF, tutte le sue pagine in coda: al suo posto la riga del nome,
//   che dice dove sono, e in fondo al documento le pagine del PDF, una per
//   foglio, ognuna alta al più quanto la pagina. Le pagine le disegna pdf.js
//   (`ExportSpaceOptions.cardPages`) prima di impaginare; finché non sono
//   pronte, o se il PDF non si legge, il PDF esce con la sua anteprima.
//   Una scheda che non è un PDF esce con l'anteprima.

import { plural, t } from "../../i18n/strings";
import { mediaKindOfId } from "../../editors/media/media-types";
import { FORMAT_ICON, formatKindOf } from "../../ui/format-kind";
import { iconEl } from "../../ui/icons";
import type { ContentChanges } from "./changes";
import type { CardsChoice } from "./choices";

/// Le pagine di un PDF incorporato, già disegnate: al più `canvases.length`
/// delle `total` del file.
export interface CardPages {
  readonly canvases: readonly HTMLCanvasElement[];
  readonly total: number;
}

/// Quante pagine di un PDF vanno in coda, al più: oltre, una riga dice
/// quante restano nel file.
export const APPENDIX_PAGE_LIMIT = 200;

/// L'altezza che la didascalia di una pagina in coda tiene sotto di lei.
const APPENDIX_CAPTION = 36;

function extensionOf(page: string): string | null {
  const base = page.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0 || point === base.length - 1) return null;
  return base.slice(point + 1).toLowerCase();
}

/// Se il file `page` nella nota è una scheda viva: la stessa regola di
/// `isLiveCardFile` (`markdown/live-cards.ts`), senza portarsi dietro
/// l'editor. No per una nota, una Base, un'immagine (l'SVG sì), un suono,
/// un video, i dati di una foto.
export function isCardFile(page: string): boolean {
  const extension = extensionOf(page.split("#")[0] ?? page);
  if (extension === null) return false;
  if (extension === "md" || extension === "markdown" || extension === "base") return false;
  const media = mediaKindOfId(page);
  if ((media === "image" && extension !== "svg") || media === "audio" || media === "video") return false;
  const format = formatKindOf(page);
  if (format === "note") return false;
  if (format === "photo" && extension !== "pcraft") return false;
  return true;
}

/// Le schede vive della resa, nell'ordine della nota.
export function cardSlots(page: ParentNode): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".embed[data-embed-page]")].filter((slot) => isCardFile(slot.dataset["embedPage"] ?? ""));
}

/// Il nome di una scheda come si legge: il file e la parte mostrata.
export function cardName(slot: HTMLElement): string {
  const page = slot.dataset["embedPage"] ?? "";
  const name = page.split("/").pop() || page;
  const part = slot.dataset["embedHeading"];
  return part ? `${name} › ${part}` : name;
}

/// La riga del nome (il prototipo `.plink`): l'icona della specie del file
/// (un foglio, un documento, un disegno) o la freccia per un PDF e per ciò
/// che non ha un'icona, poi il nome, nel colore dei link.
function nameLine(slot: HTMLElement, note: string | null): HTMLElement {
  const target = slot.dataset["embedPage"] ?? "";
  const line = document.createElement("p");
  line.className = "export-card-name";
  const kind = formatKindOf(target);
  const glyph = kind ? iconEl(FORMAT_ICON[kind]) : null;
  if (glyph) {
    glyph.setAttribute("aria-hidden", "true");
    line.append(glyph);
  } else {
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    line.append(arrow);
  }
  const name = document.createElement("span");
  name.textContent = cardName(slot);
  line.append(name);
  if (note) {
    const small = document.createElement("span");
    small.className = "export-card-note";
    small.textContent = note;
    line.append(small);
  }
  return line;
}

export interface CardsApplied {
  /// I PDF che vogliono le pagine in coda e non le hanno ancora: chi impagina
  /// le chiede e rifà la misura quando arrivano.
  readonly wanted: readonly string[];
}

/// La colonna del testo: le pagine in coda ci stanno dentro.
export interface CardFrame {
  readonly width: number;
  readonly height: number;
}

export function applyCards(
  page: HTMLElement,
  choice: CardsChoice,
  pages: ReadonlyMap<string, CardPages | null>,
  frame: CardFrame,
  changes: ContentChanges,
): CardsApplied {
  const wanted: string[] = [];
  const appendix: { slot: HTMLElement; pages: CardPages }[] = [];
  for (const slot of cardSlots(page)) {
    const target = slot.dataset["embedPage"] ?? "";
    const pdf = mediaKindOfId(target) === "pdf";
    if (choice === "solo-nome") {
      const line = nameLine(slot, null);
      slot.before(line);
      changes.add(line);
      changes.hide(slot);
      continue;
    }
    if (choice === "pagine-in-coda" && pdf) {
      const ready = pages.get(target);
      if (ready === undefined) {
        if (!wanted.includes(target)) wanted.push(target);
      } else if (ready !== null && ready.canvases.length > 0) {
        const line = nameLine(slot, t("pdf_export.content.cards.at_end"));
        slot.before(line);
        changes.add(line);
        changes.hide(slot);
        if (!appendix.some((entry) => entry.slot.dataset["embedPage"] === target)) appendix.push({ slot, pages: ready });
        continue;
      }
    }
    // L'anteprima, col nome sotto se la resa non ne scrive uno.
    if (!slot.querySelector("figcaption, .export-card-caption")) {
      const caption = document.createElement("span");
      caption.className = "export-card-caption";
      caption.textContent = cardName(slot);
      slot.append(caption);
      changes.add(caption);
    }
  }
  if (appendix.length > 0) appendPages(page, appendix, frame, changes);
  return { wanted };
}

/// In fondo al documento, le pagine dei PDF: un titolo per PDF, poi una
/// figura per pagina, ridotta perché stia nella colonna e nella pagina.
function appendPages(page: HTMLElement, appendix: readonly { slot: HTMLElement; pages: CardPages }[], frame: CardFrame, changes: ContentChanges): void {
  const body = page.querySelector<HTMLElement>(".print-body") ?? page;
  for (const { slot, pages } of appendix) {
    const name = (slot.dataset["embedPage"] ?? "").split("/").pop() ?? "";
    const title = document.createElement("h2");
    title.className = "export-appendix-title";
    title.textContent = t("pdf_export.content.cards.appendix", { name });
    body.append(title);
    changes.add(title);
    const shown = pages.canvases.slice(0, APPENDIX_PAGE_LIMIT);
    shown.forEach((canvas, index) => {
      const figure = document.createElement("figure");
      figure.className = "export-appendix-page";
      const ratio = canvas.width > 0 ? canvas.height / canvas.width : 1.414;
      const room = Math.max(40, frame.height - APPENDIX_CAPTION);
      const width = Math.max(1, Math.min(frame.width, room / ratio));
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(width * ratio)}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", t("pdf_export.content.cards.page", { name, n: index + 1, total: pages.total }));
      const caption = document.createElement("figcaption");
      caption.textContent = t("pdf_export.content.cards.page", { name, n: index + 1, total: pages.total });
      figure.append(canvas, caption);
      body.append(figure);
      changes.add(figure);
    });
    const rest = pages.total - shown.length;
    if (rest > 0) {
      const more = document.createElement("p");
      more.className = "export-appendix-more";
      more.textContent = plural(rest, "pdf_export.content.cards.more.one", "pdf_export.content.cards.more.other", { name });
      body.append(more);
      changes.add(more);
    }
  }
}
