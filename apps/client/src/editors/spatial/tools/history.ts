// Annulla e ripeti di una superficie (operazioni sulla scena, §7): una pila
// di undo del motore, uno per gesto. Una sincronizzazione da un'altra
// superficie non entra nella pila, e la pila resta quando la scena si
// ricostruisce dal testo autorevole: il motore nuovo applica l'inversa, che
// fallisce in modo esplicito se il bersaglio non c'è più.
//
// Un passo che non si annulla, o non si ripete, esce dalla pila da solo: gli
// altri restano, perché toccano altri oggetti e valgono ancora. Chi chiama lo
// annuncia.
//
// Due passi di fila con lo stesso nome, a meno di `MERGE_MS` l'uno
// dall'altro, diventano uno se il motore li sa comporre (`mergeUndo`: le
// stesse chiavi degli stessi elementi, nessun cambiamento in mezzo). Così una
// serie di piccoli spostamenti si annulla in un colpo. Un annulla o un ripeti
// chiude il passo in cima.

import type { Key } from "../../../i18n/strings";
import { mergeUndo, type Applied, type Outcome, type SceneEngine, type Undo } from "../scene/engine";

/// I passi che la pila ricorda: oltre, il più vecchio si dimentica.
export const HISTORY_LIMIT = 1000;

/// Quanto può passare fra due passi perché si fondano, in millisecondi.
export const MERGE_MS = 500;

/// Un gesto applicato.
export interface Step {
  /// Il nome del gesto, per gli annunci: «Annullato: Rettangolo».
  readonly label: Key;
  readonly undo: Undo;
  /// Quando è arrivata l'ultima operazione del passo; `-Infinity` per un
  /// passo chiuso, che non si fonde più.
  readonly at: number;
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

  constructor(
    private readonly limit = HISTORY_LIMIT,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /// Ricorda un gesto applicato, fuso col passo in cima se può: i passi da
  /// ripetere non valgono più.
  record(label: Key, applied: Applied): void {
    if (applied.duplicate) return;
    this.future.length = 0;
    const at = this.clock();
    const top = this.past[this.past.length - 1];
    const near = top !== undefined && top.label === label && at - top.at <= MERGE_MS;
    const merged = near ? mergeUndo(top.undo, applied.undo) : null;
    if (merged !== null) {
      this.past[this.past.length - 1] = { label, undo: merged, at };
      return;
    }
    this.past.push({ label, undo: applied.undo, at });
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }

  undo(engine: SceneEngine): Replay | null {
    return this.closed(this.replay(engine, this.past, this.future));
  }

  redo(engine: SceneEngine): Replay | null {
    return this.closed(this.replay(engine, this.future, this.past));
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  private replay(engine: SceneEngine, from: Step[], to: Step[]): Replay | null {
    const step = from.pop();
    if (step === undefined) return null;
    const outcome = engine.undo(step.undo);
    if (outcome.outcome === "applied") to.push({ label: step.label, undo: outcome.undo, at: -Infinity });
    return { step, outcome };
  }

  /// Chiude il passo in cima dopo un annulla o un ripeti: il gesto dopo ne
  /// apre uno nuovo.
  private closed(replay: Replay | null): Replay | null {
    const top = this.past[this.past.length - 1];
    if (top !== undefined) this.past[this.past.length - 1] = { ...top, at: -Infinity };
    return replay;
  }
}
