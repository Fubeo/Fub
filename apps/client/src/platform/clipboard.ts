// Gli appunti della shell attiva: l'unica porta da cui la shell scrive negli
// appunti di sistema, e da cui li legge.
//
// Di serie sono gli appunti della webview (`navigator.clipboard`), che però non
// ci sono dappertutto: mancano fuori da un contesto sicuro, in alcune webview
// mobili e nei banchi. Una shell che ne ha di suoi (un plugin nativo, un ponte
// verso la finestra madre) li dichiara qui; nessun pannello sa quali sta
// usando, e nessuno ripete il controllo di disponibilità a modo suo.
import type { Teardown } from "../ui/lifetime";

/// Scrive `text` negli appunti; rifiuta se il sistema non lo consente.
export type ClipboardWriter = (text: string) => Promise<void>;

/// Ciò che si scrive negli appunti in una volta: per ogni tipo, i byte, o la
/// promessa dei byte, che il sistema aspetta.
export type ClipboardContent = Readonly<Record<string, Blob | Promise<Blob>>>;

/// Un elemento degli appunti letti: i tipi che porta, e i byte di uno.
export interface ClipboardEntry {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

/// Gli appunti con più tipi di una shell: si scrivono insieme, e si leggono.
export interface RichClipboard {
  /// Scrive i tipi di `content` insieme; rifiuta se il sistema non lo
  /// consente, o se la promessa di un tipo rifiuta.
  write(content: ClipboardContent): Promise<void>;
  /// Gli elementi negli appunti; rifiuta se il sistema non lo consente.
  read(): Promise<readonly ClipboardEntry[]>;
  /// Vero se `write` accetta il tipo `type`.
  supports(type: string): boolean;
}

/// In questa shell gli appunti non ci sono. Diverso da un rifiuto del sistema,
/// che arriva con l'errore di chi li possiede.
export class ClipboardUnavailable extends Error {
  constructor() {
    super("no clipboard is available in this shell");
    this.name = "ClipboardUnavailable";
  }
}

interface Declared {
  readonly text: ClipboardWriter;
  readonly rich: RichClipboard | null;
}

let declared: Declared | null = null;

/** Dichiara gli appunti della shell attiva: il testo e, se li ha, quelli con
 *  più tipi; il teardown li ritira. Una shell che dichiara i suoi appunti
 *  senza `rich` non ne ha con più tipi. */
export function declareClipboard(writer: ClipboardWriter, rich: RichClipboard | null = null): Teardown {
  const entry: Declared = { text: writer, rich };
  declared = entry;
  return () => {
    if (declared === entry) declared = null;
  };
}

const webview = (): Clipboard | undefined => (typeof navigator === "undefined" ? undefined : navigator.clipboard);

/// Gli appunti della webview, quando ci sono.
function webviewClipboard(text: string): Promise<void> {
  const clipboard = webview();
  if (!clipboard) return Promise.reject(new ClipboardUnavailable());
  return clipboard.writeText(text);
}

/// Gli appunti con più tipi della webview: il testo e il PNG dove si
/// scrivono, gli altri tipi dove il motore dice di accettarli.
const webviewRich: RichClipboard = {
  write(content) {
    const clipboard = webview();
    if (typeof ClipboardItem !== "function" || typeof clipboard?.write !== "function") return Promise.reject(new ClipboardUnavailable());
    return clipboard.write([new ClipboardItem(content)]);
  },
  read() {
    const clipboard = webview();
    if (typeof clipboard?.read !== "function") return Promise.reject(new ClipboardUnavailable());
    return clipboard.read();
  },
  supports(type) {
    if (typeof ClipboardItem !== "function" || typeof webview()?.write !== "function") return false;
    if (type === "text/plain" || type === "image/png") return true;
    const supports = (ClipboardItem as { supports?: (type: string) => boolean }).supports;
    return typeof supports === "function" && supports.call(ClipboardItem, type);
  },
};

const richClipboard = (): RichClipboard | null => (declared === null ? webviewRich : declared.rich);

/// Scrive testo negli appunti della shell attiva. La scrittura parte subito,
/// dentro il gesto che l'ha chiesta (alcuni motori la negano fuori da lì), e
/// ogni esito, anche l'assenza degli appunti, arriva dalla promessa: nessuno
/// deve prevedere un'eccezione sincrona.
export function writeClipboardText(text: string): Promise<void> {
  try {
    return (declared?.text ?? webviewClipboard)(text);
  } catch (error) {
    return Promise.reject(error);
  }
}

/// Vero se `writeClipboardData` scrive il tipo `type` negli appunti della
/// shell attiva: per sapere, prima di prepararlo, se serve.
export function clipboardSupports(type: string): boolean {
  try {
    return richClipboard()?.supports(type) ?? false;
  } catch {
    return false;
  }
}

/// Scrive i tipi di `content` insieme negli appunti della shell attiva, come
/// `writeClipboardText`: subito, e ogni esito dalla promessa.
export function writeClipboardData(content: ClipboardContent): Promise<void> {
  try {
    const rich = richClipboard();
    return rich === null ? Promise.reject(new ClipboardUnavailable()) : rich.write(content);
  } catch (error) {
    return Promise.reject(error);
  }
}

/// Gli elementi negli appunti della shell attiva. Il sistema può chiedere il
/// permesso a chi usa l'app, o negarlo: ogni esito dalla promessa.
export function readClipboard(): Promise<readonly ClipboardEntry[]> {
  try {
    const rich = richClipboard();
    return rich === null ? Promise.reject(new ClipboardUnavailable()) : rich.read();
  } catch (error) {
    return Promise.reject(error);
  }
}
