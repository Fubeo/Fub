// Annulla e ripeti di una superficie (piano §5, «Undo»): una pila di undo
// del motore, uno per gesto. Una sincronizzazione da un'altra superficie non
// entra nella pila, e la pila resta quando la scena si ricostruisce dal testo
// autorevole (DEC-08): il motore nuovo applica l'inversa, che fallisce in
// modo esplicito se il bersaglio non c'è più.
//
// Un passo che non si annulla, o non si ripete, esce dalla pila da solo: gli
// altri restano, perché toccano altri oggetti e valgono ancora. Chi chiama lo
// annuncia.

import type { Key } from "../../../i18n/strings";
import type { Applied, Outcome, SceneEngine, Undo } from "../scene/engine";

/// I passi che la pila ricorda: oltre, il più vecchio si dimentica.
export const HISTORY_LIMIT = 1000;

/// Un gesto applicato.
export interface Step {
  /// Il nome del gesto, per gli annunci: «Annullato: Rettangolo».
  readonly label: Key;
  readonly undo: Undo;
}

/// Un passo annullato o ripetuto, con l'esito del motore. Se l'esito è un
/// rifiuto, il passo non è più nella cronologia.
export interface Replay {
  readonly step: Step;
  readonly outcome: Outcome;
}

export class History {
  private readonly past: Step[] = [];
  private readonly future: Step[] = [];

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /// Ricorda un gesto applicato: i passi da ripetere non valgono più.
  record(label: Key, applied: Applied): void {
    if (applied.duplicate) return;
    this.past.push({ label, undo: applied.undo });
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future.length = 0;
  }

  undo(engine: SceneEngine): Replay | null {
    return this.replay(engine, this.past, this.future);
  }

  redo(engine: SceneEngine): Replay | null {
    return this.replay(engine, this.future, this.past);
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  private replay(engine: SceneEngine, from: Step[], to: Step[]): Replay | null {
    const step = from.pop();
    if (step === undefined) return null;
    const outcome = engine.undo(step.undo);
    if (outcome.outcome === "applied") to.push({ label: step.label, undo: outcome.undo });
    return { step, outcome };
  }
}
