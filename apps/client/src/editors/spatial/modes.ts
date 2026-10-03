// I profili `vector` e `pdf` e le loro modalità, senza il codice del disegno:
// la famiglia `canvas` li dichiara all'avvio, e la superficie si carica solo
// quando si apre un disegno o delle annotazioni (`lazy.ts`).

import { t } from "../../i18n/strings";
import type { SurfaceMode } from "../core/registry";

export const VECTOR_PROFILE = "vector";

/// Disegno, dove si scrive sulla resa, e Lettura, il documento intero come
/// immagine.
export const VECTOR_MODES: readonly SurfaceMode[] = [
  { id: "draw", label: () => t("mode.draw"), presentation: "surface", contextMode: "live_preview" },
  { id: "read", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading" },
];

export const PDF_PROFILE = "pdf";

/// Annota, dove si scrive sulle pagine del PDF, e Lettura, dove le pagine si
/// sfogliano e accanto c'è l'elenco delle annotazioni. Gli id sono quelli del
/// disegno: la shell ricorda la modalità per famiglia.
export const PDF_MODES: readonly SurfaceMode[] = [
  { id: "draw", label: () => t("mode.annotate"), presentation: "surface", contextMode: "live_preview" },
  { id: "read", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading" },
];
