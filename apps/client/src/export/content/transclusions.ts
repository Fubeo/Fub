// Le trasclusioni svolte, con la provenienza (E28, T74; il prototipo `.ptx`,
// `.ptx-s`, «da Riunioni / 2026-11-04 › Decisioni», passo 29).
//
// Nella resa per la stampa una nota riportata (`![[Nota#Sezione]]`) è già
// svolta: il suo testo sta dentro la nota, col filo a sinistra. Sulla carta
// non c'è il passaggio del puntatore che dice da dove viene, e sotto il testo
// riportato una riga piccola lo scrive: la nota (con le sue cartelle), la
// sezione o il blocco. Una nota che riporta sé stessa, o una catena troppo
// lunga, non si svolge (lo decide la resa): la riga dice anche perché.
//
// Le schede vive (un PDF, un foglio) e i media non sono trasclusioni: le
// tiene `cards.ts`, o la resa com'è.

import { t } from "../../i18n/strings";
import { mediaKindOfId } from "../../editors/media/media-types";
import type { ContentChanges } from "./changes";
import { isCardFile } from "./cards";

/// Il percorso di una nota come si legge: le cartelle separate da « / »,
/// senza `.md`.
export function notePathText(page: string): string {
  return page
    .replace(/\.(md|markdown)$/iu, "")
    .split("/")
    .filter(Boolean)
    .join(" / ");
}

/// Da dove viene una trasclusione: «da Riunioni / 2026-11-04 › Decisioni».
export function provenanceText(page: string, heading: string | null, block: string | null): string {
  const where = notePathText(page);
  const part = block ? t("pdf_export.content.from_block", { block }) : heading ? heading.split("#").join(" › ") : "";
  return part ? t("pdf_export.content.from_part", { note: where, part }) : t("pdf_export.content.from", { note: where });
}

/// Le trasclusioni di note nella resa: gli embed con una pagina che non è un
/// file mostrato come scheda né un media.
export function noteEmbeds(page: ParentNode): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".embed[data-embed-page]")].filter((slot) => {
    const target = slot.dataset["embedPage"] ?? "";
    if (slot.dataset["cellValue"] !== undefined || slot.classList.contains("unresolved")) return false;
    if (/\.base$/iu.test(target)) return false;
    if (target && (isCardFile(target) || mediaKindOfId(target) !== "other")) return false;
    return true;
  });
}

export function applyTransclusions(page: HTMLElement, documentTitle: string, changes: ContentChanges): number {
  const slots = noteEmbeds(page);
  for (const slot of slots) {
    // `![[#Sezione]]` riporta una sezione della nota stessa: la pagina vuota.
    const target = slot.dataset["embedPage"] || documentTitle;
    const line = document.createElement("span");
    line.className = "export-source";
    let text = provenanceText(target, slot.dataset["embedHeading"] ?? null, slot.dataset["embedBlock"] ?? null);
    const reason = slot.dataset["embedNote"];
    if (reason && (slot.classList.contains("embed-cycle") || slot.classList.contains("embed-too-deep"))) text = `${text} · ${reason}`;
    line.textContent = text;
    slot.append(line);
    changes.add(line);
    // La ragione la dice la riga: la resa non la ripete fra parentesi.
    if (reason) changes.attribute(slot, "data-print-told", "");
  }
  return slots.length;
}
