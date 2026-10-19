import type { SurfaceExport } from "../../../core/registry";
import { t } from "../../../../i18n/strings";

/// Gli export di una nota dal menu del riquadro. Li esegue il core sul
/// documento salvato (`export.run`) e il file arriva al centro attività, con
/// il rapporto di ciò che non vi è entrato.
///
/// L'HTML è la resa di stampa con le immagini e le note incorporate dentro il
/// file; il PDF è il testo statico, senza diagrammi né viste: per quelli c'è
/// «Stampa», che il sistema salva anche in PDF.
export const MARKDOWN_EXPORTS: readonly SurfaceExport[] = [
  {
    target: "importers.html",
    label: () => t("markdown.export.html"),
    detail: () => t("markdown.export.html.desc"),
  },
  {
    target: "importers.pdf.single",
    label: () => t("markdown.export.pdf"),
    detail: () => t("markdown.export.pdf.desc"),
  },
];
