// L'ordine con cui la shell decide chi può consumare un gesto di tastiera.
//
// Questo modulo è deliberatamente puro: il DOM resta in `ui/keyboard.ts`, che
// osserva fuoco e overlay e passa qui soltanto fatti già misurati. Così la
// priorità non è più una lista speciale dentro l'ascoltatore, ma una regola
// nominata e testabile anche senza una webview.
import type { KeyChord, ResultKeys, Waiting } from "./commands";

/// I sette livelli di consumo, dal contesto più vicino al gesto a quello più
/// generale. L'ordine è parte del contratto della tastiera.
export const ARBITRATION_LAYERS = [
  "popup / transitory overlay",
  "local editor in edit",
  "active surface commands",
  "active profile",
  "document commands",
  "pane commands",
  "global commands",
] as const;

export type ArbitrationLayer = (typeof ARBITRATION_LAYERS)[number];

/// Punto di estensione per una superficie o un profilo che dichiari un gesto.
/// Oggi entrambi restano vuoti: Markdown e plain text affidano i loro comandi
/// locali alla keymap di CodeMirror.
export type GestureConsumer = (gesture: KeyChord) => boolean;

/// Fatti osservati dall'ascoltatore DOM e consumatori futuri della superficie.
export interface ArbitrationContext {
  overlayOpen: boolean;
  editorFocused: boolean;
  waiting: Waiting | null;
  passedToEditor: ReadonlySet<string>;
  surfaceConsumes?: GestureConsumer;
  profileConsumes?: GestureConsumer;
}

/// La superficie attiva non dichiara ancora comandi propri.
export function surfaceConsumes(
  gesture: KeyChord,
  consumer?: GestureConsumer,
): boolean {
  return consumer?.(gesture) ?? false;
}

/// Il profilo attivo non dichiara ancora comandi propri.
export function profileConsumes(
  gesture: KeyChord,
  consumer?: GestureConsumer,
): boolean {
  return consumer?.(gesture) ?? false;
}

/// Il livello «editor locale in modifica»: con il fuoco nell'editor e senza una
/// sequenza in corso, solo gli accordi dichiarati qui restano a CodeMirror.
export function localEditorConsumes(
  result: ResultKeys,
  context: Pick<ArbitrationContext, "editorFocused" | "waiting" | "passedToEditor">,
): boolean {
  return (
    result.type === "esegue" &&
    context.waiting === null &&
    context.editorFocused &&
    context.passedToEditor.has(result.entry.id)
  );
}

/// Classifica i soli comandi della shell negli ultimi tre livelli.
///
/// Il registro resta unico e `advance(allCommands())` resta il matcher. Questa
/// piccola domanda serve soltanto a dare un nome all'ordine, quando un comando
/// viene esaminato, senza creare registri paralleli.
export type ShellCommandLayer = "document" | "pane" | "global";

export function shellCommandLayer(id: string): ShellCommandLayer | null {
  if (!id.startsWith("shell.")) return null;
  if (id.startsWith("shell.doc.")) return "document";
  if (id.startsWith("shell.pane.") || id.startsWith("shell.mode.")) return "pane";
  return "global";
}

/// Applica l'ordine di arbitrato a ciò che il matcher ha trovato.
///
/// `advance` continua a essere la sola funzione che riconosce gli accordi e le
/// sequenze. Qui si decide soltanto se il risultato può arrivare all'esecutore:
/// un overlay aperto passa il tasto, poi l'editor locale, poi i due punti di
/// estensione ancora vuoti; i comandi del documento, del riquadro e globali
/// restano il risultato del matcher.
export function arbitrate(
  result: ResultKeys,
  gesture: KeyChord,
  context: ArbitrationContext,
): ResultKeys {
  // Un overlay già aperto possiede il gesto qualunque sia il risultato del
  // matcher: non si deve eseguire un comando della shell sotto la sua UI.
  if (context.overlayOpen) return { type: "passa" };

  // Dentro un editor, i tre accordi condivisi restano a CodeMirror solo quando
  // non è già partita una sequenza della shell.
  if (localEditorConsumes(result, context)) return { type: "passa" };

  // Questi due hook precedono i comandi della shell. Sono no-op oggi, ma la
  // firma permette a una superficie o a un profilo futuri di consumare il
  // gesto senza un secondo ascoltatore globale o un command bus.
  if (surfaceConsumes(gesture, context.surfaceConsumes)) return { type: "passa" };
  if (profileConsumes(gesture, context.profileConsumes)) return { type: "passa" };

  return result;
}
