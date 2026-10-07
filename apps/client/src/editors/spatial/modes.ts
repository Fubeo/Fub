// I profili `vector` e `pdf`, le loro modalità e i loro export, senza il codice
// del disegno: la famiglia `canvas` li dichiara all'avvio, e la superficie si
// carica solo quando si apre un disegno o delle annotazioni (`lazy.ts`).

import { t } from "../../i18n/strings";
import type { SurfaceExport, SurfaceMode } from "../core/registry";

export const VECTOR_PROFILE = "vector";

/// Disegno, dove si scrive sulla resa, e Lettura, il documento intero come
/// immagine.
export const VECTOR_MODES: readonly SurfaceMode[] = [
  { id: "draw", label: () => t("mode.draw"), presentation: "surface", contextMode: "live_preview" },
  { id: "read", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading" },
];

/// I due export di un disegno (`draw.png` e `draw.pdf` del bundle `fub.draw`).
/// Valgono per ogni documento del formato, anche per uno che si guarda
/// soltanto.
export const VECTOR_EXPORTS: readonly SurfaceExport[] = [
  { target: "draw.png", label: () => t("draw.export.png"), detail: () => t("draw.export.png.desc") },
  { target: "draw.pdf", label: () => t("draw.export.pdf"), detail: () => t("draw.export.pdf.desc") },
];

export const PDF_PROFILE = "pdf";

/// Annota, dove si scrive sulle pagine del PDF, e Lettura, dove le pagine si
/// sfogliano e accanto c'è l'elenco delle annotazioni. Gli id sono quelli del
/// disegno: la shell ricorda la modalità per famiglia.
export const PDF_MODES: readonly SurfaceMode[] = [
  { id: "draw", label: () => t("mode.annotate"), presentation: "surface", contextMode: "live_preview" },
  { id: "read", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading" },
];

/// I due export delle annotazioni (`draw.annotated-pdf` e `draw.redacted-pdf`
/// del bundle `fub.draw`), con parole che non si confondono: il PDF annotato
/// tiene sotto le coperture ciò che coprono, il PDF redatto no. La parola fra
/// parentesi nel nome del file è nella lingua di chi esporta.
export const PDF_EXPORTS: readonly SurfaceExport[] = [
  {
    target: "draw.annotated-pdf",
    label: () => t("pdf.export.annotated"),
    detail: () => t("pdf.export.annotated.desc"),
    options: () => ({ suffix: t("pdf.export.annotated.suffix") }),
  },
  {
    target: "draw.redacted-pdf",
    label: () => t("pdf.export.redacted"),
    detail: () => t("pdf.export.redacted.desc"),
    options: () => ({ suffix: t("pdf.export.redacted.suffix") }),
  },
];
