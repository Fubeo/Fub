// Le Basi sulla carta (E28, T74; il prototipo `pxBase`, «Base «Opere» ·
// vista tabella», passo 29).
//
// Nella nota una Base in tabella disegna solo le righe che si vedono, in una
// finestra alta al più 560 px che scorre, con la barra delle viste, dei
// filtri e di «Nuova». Sulla carta niente scorre: la finestra si allunga
// fino all'ultima riga (la Base disegna allora tutte le righe), la barra e
// la riga «Nuova nota» escono, e sotto la tabella una riga dice quale Base e
// quale vista. Il blocco si misura come una tabella (`data-print-table`):
// una Base di mille righe continua nella pagina dopo fra due righe, con
// l'intestazione ripetuta.
//
// Una Base arriva dopo la resa (il suo codice e le sue righe si chiedono a
// parte): finché la tabella non c'è, `pending` lo dice e chi impagina
// riprova.

import { plural, t } from "../../i18n/strings";
import type { ContentChanges } from "./changes";

/// Le parti della Base che sulla carta non servono: si toccano, non si leggono.
const CHROME = ".base-bar, .base-search-row, .base-strip, .base-written, .base-add-row";

/// Il blocco della resa che contiene `element`: il figlio del corpo (o della
/// pagina di stampa) dentro cui sta.
export function topBlockOf(element: HTMLElement, page: HTMLElement): HTMLElement {
  let block = element;
  while (block.parentElement && block.parentElement !== page) {
    const parent = block.parentElement;
    if (parent.classList.contains("markdown-rendered") || parent.classList.contains("print-body")) break;
    block = parent;
  }
  return block;
}

/// Il nome di una Base dal suo embed (`![[Opere.base#Arrivate]]`): il file
/// senza `.base` e la vista; una Base scritta nella nota non ha nome.
function baseCaption(surface: HTMLElement, rows: number): string {
  const embed = surface.closest<HTMLElement>(".embed[data-embed-page]");
  const page = embed?.dataset["embedPage"] ?? "";
  const name = (page.split("/").pop() ?? "").replace(/\.base$/iu, "");
  const view = embed?.dataset["embedHeading"] ?? "";
  const count = plural(rows, "pdf_export.content.base.rows.one", "pdf_export.content.base.rows.other");
  const head = name ? t("pdf_export.content.base.named", { name }) : t("pdf_export.content.base");
  return [head, view ? t("pdf_export.content.base.view", { view }) : "", count].filter(Boolean).join(" · ");
}

export interface BasesApplied {
  /// Le Basi trovate, già distese per la carta.
  readonly tables: number;
  /// Una Base non ha ancora la sua tabella (le righe arrivano): riprovare.
  readonly pending: boolean;
}

/// Una Base della resa non ha ancora disegnato la sua vista: la sua parte
/// non è montata, o le righe non sono arrivate.
export function basesPending(page: ParentNode): boolean {
  for (const host of page.querySelectorAll<HTMLElement>('[data-custom-kind="base"]')) {
    const surface = host.querySelector(".base-surface");
    if (!surface) return true;
    const body = surface.querySelector(".base-body");
    if (body && body.childElementCount === 0) return true;
  }
  return false;
}

export function applyBases(page: HTMLElement, changes: ContentChanges): BasesApplied {
  let tables = 0;
  const pending = basesPending(page);
  for (const surface of page.querySelectorAll<HTMLElement>(".base-surface")) {
    const viewport = surface.querySelector<HTMLElement>(".base-table-viewport");
    const table = viewport?.querySelector<HTMLTableElement>("table");
    if (!viewport || !table) {
      // Un'altra vista (schede, bacheca, calendario): esce com'è, senza la barra.
      for (const chrome of surface.querySelectorAll<HTMLElement>(CHROME)) changes.hide(chrome);
      continue;
    }
    for (const chrome of surface.querySelectorAll<HTMLElement>(CHROME)) changes.hide(chrome);
    // La finestra alta quanto tutte le righe: la Base, allo scorrimento,
    // disegna quelle che ci stanno, cioè tutte.
    changes.style(viewport, "max-height", "none");
    changes.style(viewport, "overflow", "visible");
    viewport.dispatchEvent(new Event("scroll"));
    changes.later(() => viewport.dispatchEvent(new Event("scroll")));
    const rows = surface.querySelectorAll("tr[data-doc]").length;
    const caption = document.createElement("p");
    caption.className = "export-base-caption";
    caption.textContent = baseCaption(surface, rows);
    surface.append(caption);
    changes.add(caption);
    const block = topBlockOf(surface, page);
    changes.attribute(block, "data-print-table", "");
    tables++;
  }
  return { tables, pending };
}
