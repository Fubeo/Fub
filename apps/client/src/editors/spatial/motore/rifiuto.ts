// Il motivo a parole di un comando che il motore del disegno non ha fatto.
// Sta da solo, senza i gesti né gli strumenti dell'editor, perché lo usano sia
// i colori sul motore (`colori.ts`) sia i comandi del Disegno completo
// (`completo/esegui.ts`), che non deve tirarsi dietro la superficie.

import type { DrawingRefusal } from "../../../host/contract";
import type { DrawKey } from "../strings";

/// Il motivo a parole di un comando che il motore non ha fatto; `null` se
/// non c'è niente da dire (non cambiava niente).
export function motivoDelRifiuto(refused: DrawingRefusal): DrawKey | null {
  switch (refused) {
    case "empty":
      return null;
    case "locked":
    case "hidden":
      return "draw.reason.locked";
    case "unmapped":
    case "unsupported":
      return "draw.reason.foreign";
    case "too_large":
    case "no_memory":
      return "draw.reason.limit";
    case "stale":
    case "closed":
    case "not_ready":
    // I comandi diretti non chiedono anteprime né strumenti del motore: se
    // arrivano, la richiesta non era valida.
    case "no_preview":
    case "unknown_tool":
      return "draw.reason.invalid";
  }
}
