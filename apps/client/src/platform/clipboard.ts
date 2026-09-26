// Gli appunti della shell attiva: l'unica porta da cui la shell scrive testo
// negli appunti di sistema.
//
// Di serie sono gli appunti della webview (`navigator.clipboard`), che però non
// ci sono dappertutto: mancano fuori da un contesto sicuro, in alcune webview
// mobili e nei banchi. Una shell che ne ha di suoi (un plugin nativo, un ponte
// verso la finestra madre) li dichiara qui; nessun pannello sa quali sta
// usando, e nessuno ripete il controllo di disponibilità a modo suo.
import type { Teardown } from "../ui/lifetime";

/// Scrive `text` negli appunti; rifiuta se il sistema non lo consente.
export type ClipboardWriter = (text: string) => Promise<void>;

/// In questa shell gli appunti non ci sono. Diverso da un rifiuto del sistema,
/// che arriva con l'errore di chi li possiede.
export class ClipboardUnavailable extends Error {
  constructor() {
    super("no clipboard is available in this shell");
    this.name = "ClipboardUnavailable";
  }
}

let declared: ClipboardWriter | null = null;

/** Dichiara gli appunti della shell attiva; il teardown li ritira. */
export function declareClipboard(writer: ClipboardWriter): Teardown {
  declared = writer;
  return () => {
    if (declared === writer) declared = null;
  };
}

/// Gli appunti della webview, quando ci sono.
function webviewClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) return Promise.reject(new ClipboardUnavailable());
  return clipboard.writeText(text);
}

/// Scrive testo negli appunti della shell attiva. La scrittura parte subito,
/// dentro il gesto che l'ha chiesta (alcuni motori la negano fuori da lì), e
/// ogni esito, anche l'assenza degli appunti, arriva dalla promessa: nessuno
/// deve prevedere un'eccezione sincrona.
export function writeClipboardText(text: string): Promise<void> {
  try {
    return (declared ?? webviewClipboard)(text);
  } catch (error) {
    return Promise.reject(error);
  }
}
