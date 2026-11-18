// **Annulla e ripeti nei campi di testo** della shell: il filtro dell'albero,
// la palette, la rinomina, i campi delle impostazioni.
//
// Un campo del browser ha già la sua pila dell'annullamento, ma il tasto che
// la usa non è suo: lo dà chi ospita la pagina. Chromium e Safari lo legano da
// sé; WebKitGTK no (la tabella dei tasti di GTK 3 non ha «annulla», e un
// browser come Epiphany lo lega lui), e l'app nel Mac senza il menu Modifica
// nemmeno. Così in Fub su Linux Ctrl+Z in un campo non faceva niente
// (IMP-008). La pila c'è anche lì, e `execCommand("undo")` la usa: qui si
// riconosce il tasto, e `ui/keyboard.ts` lo applica quando nessun comando
// dell'app lo ha preso.
//
// CodeMirror e gli editor ricchi (`contenteditable`) hanno la loro pila e i
// loro tasti, e non passano di qui. Fuori da un campo, lo stesso tasto su un
// pannello del documento (Sostituisci, Revisioni, l'ispettore) va alla pila
// del documento attivo (`ui/off-sheet-keys.ts`).
import type { KeyboardPlatform } from "./commands";

export type FieldHistoryStep = "undo" | "redo";

/// Il gesto della pila di un campo che questo tasto chiede, se ne chiede uno.
///
/// Mac: ⌘Z annulla, ⇧⌘Z ripete. Altrove: Ctrl+Z annulla, Ctrl+Maiusc+Z e
/// Ctrl+Y ripetono, come nei campi di GTK 4 e di Windows. Con Alt è un altro
/// accordo (Ctrl+Alt+Z è «annulla l'ultima operazione sul vault»).
export function fieldHistoryStep(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  platform: KeyboardPlatform,
): FieldHistoryStep | null {
  if (e.altKey) return null;
  const mac = platform === "mac";
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !mac && !e.shiftKey) return "redo";
  return null;
}

/// I tipi di `input` in cui si scrive: lì un tasto muove il cursore o cancella.
/// Una casella, un bottone o un cursore a scorrimento non hanno un tasto di
/// testo da perdere.
export const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "time"]);

/// Vero per un campo di testo semplice in cui si può scrivere: `input` di
/// testo e `textarea`, non un `contenteditable`.
export function isPlainTextField(target: EventTarget | null, textInputs: ReadonlySet<string>): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) return textInputs.has(target.type.toLowerCase()) && !target.readOnly && !target.disabled;
  return false;
}

/// Un campo in cui si scrive: `input` di testo, `textarea`, `contenteditable`
/// (CodeMirror e il foglio ricco compresi).
export function isWritingField(target: EventTarget | null): boolean {
  if (isPlainTextField(target, TEXT_INPUT_TYPES)) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

/// Esegue il passo sulla pila del campo col fuoco. Vero se il documento lo ha
/// fatto: allora il tasto è consumato.
export function runFieldHistory(step: FieldHistoryStep, doc: Document = document): boolean {
  if (typeof doc.execCommand !== "function") return false;
  try {
    return doc.execCommand(step);
  } catch {
    return false;
  }
}
