// I fogli intorno a un'impaginazione: frontespizio, indice, e su ogni foglio
// testata e piè. Li usano lo spazio «Esporta in PDF» (`space.ts`) e
// l'esportazione fuori dallo schermo (`headless-run.ts`, T79): una regola
// sola, così il PDF chiesto da un agente ha gli stessi fogli di quello dello
// spazio.

import type { ExportPages, PageDecor } from "./pages";
import { printBlocks } from "./paginate/measure";
import type { PrintLayout, SlicedResult } from "./paginate/slices";
import { frontMatter, headingsOf, sectionHeadings, sectionsByPage, type FrontSettings, type TocEntry, type TocHeading, type TocMetrics } from "./paginate/toc";
import type { ExportProfile } from "./profile";
import { drawCover, drawTocPage, type CoverFacts } from "./sections/cover-toc";
import { drawHeaderFooter } from "./sections/header-footer";

/// Le misure dell'indice quando il foglio non si dispone (happy-dom): il
/// titolo e ogni voce come li disegna la pelle col corpo di serie.
const TOC_FALLBACK = { heading: 48, row: 22 };

/// Le scelte del profilo che decidono i fogli.
export function frontSettingsOf(profile: ExportProfile): FrontSettings {
  return {
    cover: profile.frontespizio.frontespizio,
    toc: profile.frontespizio.indice,
    roman: profile.testata.numeri_romani,
    firstWithoutHeader: profile.testata.prima_pagina_senza,
    depth: profile.frontespizio.profondita_indice,
  };
}

/// Chi misura l'indice su un foglio fuori dalla vista, coi caratteri delle
/// pagine: quanto è alto il titolo e ogni voce. Si rimisura solo se cambiano
/// le voci, la pagina o i caratteri.
export function tocMeasurer(pages: ExportPages, layout: () => PrintLayout): (entries: readonly TocEntry[]) => TocMetrics {
  let measured: { key: string; metrics: TocMetrics } | null = null;
  return (entries) => {
    const { page, type } = layout();
    const key = JSON.stringify([page, type, entries.map((entry) => [entry.level, entry.text, entry.number, entry.page])]);
    if (measured?.key === key) return measured.metrics;
    const metrics = pages.measureSheet(page, (body) => {
      const toc = drawTocPage(body, entries, true);
      const rows = [...toc.querySelectorAll<HTMLElement>(".export-toc-row")];
      const top = toc.getBoundingClientRect().top;
      const first = rows[0]?.getBoundingClientRect();
      const heights = rows.map((row) => row.getBoundingClientRect().height);
      // Senza disposizione (happy-dom) tutto è alto 0: le misure di serie.
      if (!first || heights.every((height) => height === 0)) {
        return { page: body.clientHeight || page.height - page.margin.top - page.margin.bottom, heading: TOC_FALLBACK.heading, rows: rows.map(() => TOC_FALLBACK.row) };
      }
      return { page: page.height - page.margin.top - page.margin.bottom, heading: Math.max(0, first.top - top), rows: heights };
    });
    measured = { key, metrics };
    return metrics;
  };
}

export interface DecorInput {
  readonly result: SlicedResult;
  /// Dove il paginatore ha montato la resa misurata.
  readonly host: HTMLElement;
  readonly profile: ExportProfile;
  readonly layout: PrintLayout;
  readonly cover: CoverFacts;
  readonly measureToc: (entries: readonly TocEntry[]) => TocMetrics;
}

/// I fogli di un'impaginazione, e i titoli della nota da cui vengono indice
/// e segnalibri.
export function decorOf(input: DecorInput): { readonly decor: PageDecor; readonly headings: readonly TocHeading[] } {
  const { result, profile, cover } = input;
  const page = input.host.querySelector<HTMLElement>(".print-page");
  const blocks = page ? printBlocks(page) : [];
  const headings = headingsOf(result.boxes, (box) => {
    const block = blocks[result.blocks[box] ?? -1];
    return { text: block?.textContent ?? "", number: block?.dataset["printNumber"] ?? "" };
  });
  const front = frontMatter({
    settings: frontSettingsOf(profile),
    headings,
    flowPages: result.pagination.pages.length,
    final: result.final,
    firstPage: result.firstPage,
    measure: input.measureToc,
  });
  const sections = sectionsByPage(result.pagination.pages, sectionHeadings(headings));
  const geometry = input.layout.page;
  const decor: PageDecor = {
    sheets: front.sheets,
    front: front.front,
    draw(sheetPage, body, sheet, ordinal) {
      if (sheet.kind === "frontespizio") drawCover(body, cover, geometry.margin);
      else if (sheet.kind === "indice") drawTocPage(body, front.toc[sheet.index] ?? [], sheet.index === 0);
      const section = sheet.kind === "pagina" ? (sections[sheet.index] ?? "") : "";
      drawHeaderFooter(sheetPage, geometry, profile.testata, cover, sheet, section, profile.pagina.specchio && ordinal % 2 === 1);
    },
  };
  return { decor, headings };
}
