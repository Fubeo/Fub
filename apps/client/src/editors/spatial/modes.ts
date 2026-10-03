// Il profilo `vector` e le sue modalità, senza il codice del disegno: la
// famiglia `canvas` li dichiara all'avvio, e la superficie si carica solo
// quando si apre un disegno (`lazy.ts`).

import { t } from "../../i18n/strings";
import type { SurfaceMode } from "../core/registry";

export const VECTOR_PROFILE = "vector";

/// Disegno, dove si scrive sulla resa, e Lettura, il documento intero come
/// immagine.
export const VECTOR_MODES: readonly SurfaceMode[] = [
  { id: "draw", label: () => t("mode.draw"), presentation: "surface", contextMode: "live_preview" },
  { id: "read", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading" },
];
