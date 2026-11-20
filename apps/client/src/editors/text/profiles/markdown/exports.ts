import type { SurfaceExport } from "../../../core/registry";
import { t } from "../../../../i18n/strings";

/// Gli export di una nota dal menu del riquadro. Li esegue il core sul
/// documento salvato (`export.run`) e il file arriva al centro attività, con
/// il rapporto di ciò che non vi è entrato.
///
/// L'HTML è la resa di stampa con le immagini e le note incorporate dentro il
/// file. Il PDF non è qui: «PDF…» del menu apre lo spazio «Esporta in PDF»
/// (`panels/document.ts`), che mostra le pagine vere; il vecchio id
/// `importers.pdf.single` resta, nel core, sinonimo di `pdf.export_note`.
export const MARKDOWN_EXPORTS: readonly SurfaceExport[] = [
  {
    target: "importers.html",
    label: () => t("markdown.export.html"),
    detail: () => t("markdown.export.html.desc"),
  },
];
