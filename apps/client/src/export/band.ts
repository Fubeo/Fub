// La banda in fondo allo spazio «Esporta in PDF» (E28, T70; il prototipo
// `.px-band`, riga 1622): quante pagine, il formato, i margini, i
// segnalibri, i millisecondi dell'impaginazione.
//
// La banda si aggiorna a ogni impaginazione, ma chi ascolta sente soltanto il
// numero delle pagine, e solo quando cambia: una regione viva a parte, che
// non ripete il formato e i millisecondi a ogni gesto.

import { plural, t } from "../i18n/strings";
import { paperName } from "./sections/index";
import type { ExportProfile } from "./profile";

export interface BandFacts {
  /// Le pagine, quando sono sicure; `null` mentre l'impaginazione va avanti.
  readonly pages: number | null;
  /// I titoli che diventano segnalibri nel PDF; `null` se il profilo non li
  /// vuole.
  readonly bookmarks: number | null;
  /// I millisecondi di lavoro dell'impaginazione.
  readonly ms: number;
}

export interface Band {
  readonly element: HTMLElement;
  update(profile: ExportProfile, facts: BandFacts): void;
  /// Ciò che la banda dice quando non c'è ancora niente da contare: la resa
  /// che arriva, o perché non è arrivata.
  status(text: string): void;
  /// Il suggerimento a destra (i gesti sulla pagina); `null` lo toglie.
  setHint(text: string | null): void;
}

function span(className: string | null, text: string): HTMLSpanElement {
  const element = document.createElement("span");
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

/// I margini come li scrive il prototipo: sopra/destra/sotto/sinistra.
function marginsText(profile: ExportProfile): string {
  const { sopra, destra, sotto, sinistra } = profile.pagina.margini;
  const n = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  return t("pdf_export.band.margins", { margins: [sopra, destra, sotto, sinistra].map(n).join("/") });
}

export function createBand(): Band {
  const element = document.createElement("footer");
  element.className = "export-band";
  const info = document.createElement("div");
  info.className = "export-band-info";
  const spacer = span("export-spacer", "");
  const hint = span("export-band-hint", "");
  hint.hidden = true;
  const live = span("sr-only", "");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  element.append(info, spacer, hint, live);
  let announced: number | null = null;

  return {
    element,
    update(profile, facts) {
      const pages = document.createElement("b");
      pages.className = "export-band-pages";
      pages.textContent = facts.pages === null ? t("pdf_export.band.pages_pending") : plural(facts.pages, "pdf_export.band.pages.one", "pdf_export.band.pages.other");
      const parts: HTMLElement[] = [pages, span("export-band-fact", paperName(profile)), span("export-band-fact", marginsText(profile))];
      if (facts.bookmarks !== null) parts.push(span("export-band-fact", plural(facts.bookmarks, "pdf_export.band.bookmarks.one", "pdf_export.band.bookmarks.other")));
      parts.push(span("export-band-ms", t("pdf_export.band.ms", { ms: Math.max(0, Math.round(facts.ms)) })));
      info.replaceChildren(...parts);
      if (facts.pages !== null && facts.pages !== announced) {
        announced = facts.pages;
        live.textContent = plural(facts.pages, "pdf_export.band.pages.one", "pdf_export.band.pages.other");
      }
    },
    status(text) {
      info.replaceChildren(span("export-band-fact", text));
    },
    setHint(text) {
      hint.textContent = text ?? "";
      hint.hidden = text === null;
    },
  };
}
