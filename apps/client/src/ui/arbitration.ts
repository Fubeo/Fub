// L'ordine con cui la shell decide se può eseguire un gesto di tastiera.
//
// Questo modulo è deliberatamente puro: il DOM resta in `ui/keyboard.ts`, che
// osserva overlay e consumo locale e passa qui soltanto fatti già misurati.
import type { ResultKeys } from "./commands";

/// Fatti osservati dall'ascoltatore DOM.
export interface ArbitrationContext {
  overlayOpen: boolean;
  /// Una EditorView a fuoco ha già consumato l'evento che è risalito fin qui.
  localEditorConsumed: boolean;
}

/// Applica l'ordine di arbitrato a ciò che il matcher ha trovato.
///
/// `advance` continua a essere la sola funzione che riconosce accordi e
/// sequenze. Qui si decide soltanto se il risultato può arrivare all'esecutore:
/// un overlay aperto possiede il gesto; altrimenti lo possiede l'editor solo
/// quando la sua vera keymap ha già consumato questo evento.
export function arbitrate(result: ResultKeys, context: ArbitrationContext): ResultKeys {
  // Un overlay già aperto possiede il gesto qualunque sia il risultato del
  // matcher: non si deve eseguire un comando della shell sotto la sua UI.
  if (context.overlayOpen) return { type: "passa" };

  if (context.localEditorConsumed) return { type: "passa" };

  return result;
}
