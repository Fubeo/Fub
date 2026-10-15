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
//
// La cronologia si percorre anche a salti, per il suo pannello: `goTo` porta
// a un punto qualsiasi, annullando o ripetendo in un colpo i passi in mezzo.
// Un punto è il numero del passo dopo cui sta (`Step.serial`), che resta suo
// finché il passo è nella pila; `start` è il punto prima del passo più
// vecchio. Sui punti si mettono i segni, coi loro nomi, che durano quanto la
// sessione: un segno se ne va quando il suo punto non si raggiunge più,
// perché un gesto nuovo ha tolto i passi da ripetere o la pila ha dimenticato
// i più vecchi. Il segno di un passo che esce perché non si annulla, o non si
// ripete, passa al punto prima.

import type { DrawKey } from "../strings";
import { mergeUndo, type Applied, type Outcome, type Replayed, type SceneEngine, type Undo } from "../scene/engine";

/// I passi che la pila ricorda: oltre, il più vecchio si dimentica.
export const HISTORY_LIMIT = 1000;

/// Quanto può passare fra due passi perché si fondano, in millisecondi.
export const MERGE_MS = 500;

/// Un gesto applicato.
export interface Step {
  /// Il numero del passo, e il punto della cronologia dopo di lui: resta lo
  /// stesso quando il passo si fonde, si annulla o si ripete.
  readonly serial: number;
  /// Il nome del gesto, per gli annunci: «Annullato: Rettangolo».
  readonly label: DrawKey;
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

/// Un salto nella cronologia (`goTo`).
export interface Jump {
  /// Indietro, annullando, o avanti, ripetendo.
  readonly direction: "undo" | "redo";
  /// I passi annullati o ripetuti, nell'ordine in cui il salto li ha fatti.
  readonly steps: readonly Step[];
  /// Il passo che non si è annullato, o ripetuto, e ha fermato il salto: non
  /// è più nella cronologia.
  readonly failed: Step | null;
  /// L'esito del motore per tutto il salto.
  readonly replayed: Replayed;
}

/// Un segno su un punto della cronologia.
export interface Mark {
  /// Il numero del segno, che resta suo anche quando cambia nome o punto.
  readonly id: number;
  readonly name: string;
  /// Il punto: il numero del passo dopo cui sta, o `start`.
  readonly at: number;
}

export class History {
  private readonly past: Step[] = [];
  private readonly future: Step[] = [];
  private serials = 0;
  private first = 0;
  private lost = false;
  private signs: Mark[] = [];
  private marksMade = 0;
  private changes = 0;

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

  /// Il punto prima del passo più vecchio.
  get start(): number {
    return this.first;
  }

  /// Vero se la pila ha dimenticato i passi più vecchi: il punto di partenza
  /// non è più il disegno com'era quando si è aperto.
  get trimmed(): boolean {
    return this.lost;
  }

  /// Il punto dove si è adesso.
  get position(): number {
    return this.past[this.past.length - 1]?.serial ?? this.first;
  }

  /// Cresce a ogni cambiamento della cronologia o dei suoi segni: chi la
  /// mostra ridisegna solo quando cambia.
  get revision(): number {
    return this.changes;
  }

  /// Quanti passi sono fatti: i primi di `steps()`.
  get done(): number {
    return this.past.length;
  }

  /// I passi, dal più vecchio: quelli fatti, poi quelli da ripetere, dal
  /// prossimo.
  steps(): readonly Step[] {
    return [...this.past, ...this.future.slice().reverse()];
  }

  /// I segni, nell'ordine dei loro punti e, sullo stesso punto, in quello in
  /// cui sono stati messi.
  get marks(): readonly Mark[] {
    return this.signs;
  }

  /// Quanti segni si sono messi da quando il disegno è aperto, anche se
  /// tolti: il numero del prossimo nome di partenza.
  get marked(): number {
    return this.marksMade;
  }

  /// Ricorda un gesto applicato, fuso col passo in cima se può: i passi da
  /// ripetere non valgono più, e nemmeno i loro segni.
  record(label: DrawKey, applied: Applied): void {
    if (applied.duplicate) return;
    this.future.length = 0;
    this.changes++;
    const at = this.clock();
    const top = this.past[this.past.length - 1];
    const near = top !== undefined && top.label === label && at - top.at <= MERGE_MS;
    const merged = near ? mergeUndo(top.undo, applied.undo) : null;
    if (merged !== null) {
      this.past[this.past.length - 1] = { serial: top!.serial, label, undo: merged, at };
    } else {
      this.past.push({ serial: ++this.serials, label, undo: applied.undo, at });
      if (this.past.length > this.limit) {
        this.first = this.past.splice(0, this.past.length - this.limit).pop()!.serial;
        this.lost = true;
      }
    }
    this.prune();
  }

  undo(engine: SceneEngine): Replay | null {
    return this.closed(this.replay(engine, this.past, this.future));
  }

  redo(engine: SceneEngine): Replay | null {
    return this.closed(this.replay(engine, this.future, this.past));
  }

  /// Va al punto `position`, annullando o ripetendo in un colpo i passi fino
  /// a lì. Si ferma al primo passo che non si annulla o non si ripete, che
  /// esce dalla cronologia. `null` se si è già lì o il punto non c'è.
  goTo(engine: SceneEngine, position: number): Jump | null {
    if (position === this.position) return null;
    let direction: Jump["direction"];
    let from: Step[];
    let to: Step[];
    let count: number;
    const back = position === this.first ? -1 : this.past.findIndex((step) => step.serial === position);
    if (position === this.first || back >= 0) {
      [direction, from, to, count] = ["undo", this.past, this.future, this.past.length - 1 - back];
    } else {
      const ahead = this.future.findIndex((step) => step.serial === position);
      if (ahead < 0) return null;
      [direction, from, to, count] = ["redo", this.future, this.past, this.future.length - ahead];
    }
    const steps = from.slice(from.length - count).reverse();
    const replayed = engine.undoAll(steps.map((step) => step.undo));
    const done = replayed.undos.length;
    const failed = replayed.rejected === null ? null : steps[done]!;
    from.length -= done + (failed === null ? 0 : 1);
    steps.slice(0, done).forEach((step, at) => to.push({ ...step, undo: replayed.undos[at]!, at: -Infinity }));
    if (failed !== null) this.moveMarks(failed.serial);
    return this.closed({ direction, steps: steps.slice(0, done), failed, replayed });
  }

  /// Mette un segno chiamato `name` dove si è adesso. Il passo in cima si
  /// chiude: il gesto dopo il segno non si fonde con quello prima.
  mark(name: string): Mark {
    const sign = { id: ++this.marksMade, name, at: this.position };
    this.signs = [...this.signs, sign].sort(byPoint);
    return this.closed(sign);
  }

  /// Cambia il nome del segno `id`. `false` se non c'è più.
  rename(id: number, name: string): boolean {
    if (!this.signs.some((sign) => sign.id === id)) return false;
    this.signs = this.signs.map((sign) => (sign.id === id ? { ...sign, name } : sign));
    this.changes++;
    return true;
  }

  /// Toglie il segno `id`. `false` se non c'era.
  unmark(id: number): boolean {
    const kept = this.signs.filter((sign) => sign.id !== id);
    if (kept.length === this.signs.length) return false;
    this.signs = kept;
    this.changes++;
    return true;
  }

  /// Dimentica tutto, per un altro disegno: i passi, i segni e la loro
  /// numerazione.
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.first = this.serials;
    this.lost = false;
    this.signs = [];
    this.marksMade = 0;
    this.changes++;
  }

  private replay(engine: SceneEngine, from: Step[], to: Step[]): Replay | null {
    const step = from.pop();
    if (step === undefined) return null;
    const outcome = engine.undo(step.undo);
    if (outcome.outcome === "applied") to.push({ ...step, undo: outcome.undo, at: -Infinity });
    else this.moveMarks(step.serial);
    return { step, outcome };
  }

  /// Chiude il passo in cima dopo un annulla, un ripeti, un salto o un
  /// segno: il gesto dopo ne apre uno nuovo.
  private closed<T>(result: T): T {
    const top = this.past[this.past.length - 1];
    if (top !== undefined) this.past[this.past.length - 1] = { ...top, at: -Infinity };
    this.changes++;
    return result;
  }

  /// I segni del passo `serial`, che è uscito dalla cronologia, vanno dove si
  /// è adesso: il punto prima di lui.
  private moveMarks(serial: number): void {
    if (!this.signs.some((sign) => sign.at === serial)) return;
    const here = this.position;
    this.signs = this.signs.map((sign) => (sign.at === serial ? { ...sign, at: here } : sign)).sort(byPoint);
  }

  /// Toglie i segni dei punti che non si raggiungono più.
  private prune(): void {
    if (this.signs.length === 0) return;
    const reached = new Set([this.first, ...this.past.map((step) => step.serial), ...this.future.map((step) => step.serial)]);
    this.signs = this.signs.filter((sign) => reached.has(sign.at));
  }
}

/// L'ordine dei segni: i punti crescono col tempo, e i segni sullo stesso
/// punto vanno nell'ordine in cui sono stati messi.
function byPoint(a: Mark, b: Mark): number {
  return a.at - b.at || a.id - b.id;
}
