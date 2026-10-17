// Lo stabilizzatore del tratto: leviga i campioni del puntatore prima che
// diventino inchiostro, per chi ha la mano che trema o scrive col mouse.
//
// Due modi:
//
// - **la corda** (`pulledString`, il «lazy mouse»): il pennino è legato al
//   puntatore da una corda lunga `amount × 100` pixel dello schermo e si muove
//   solo quando la corda è tesa, dalla parte del puntatore. Un tremito più
//   corto della corda non muove niente;
// - **la media** (esponenziale): a ogni 16 ms di tempo del tratto il pennino
//   percorre una frazione della strada verso il puntatore. Conta il tempo e
//   non il numero di eventi: lo stesso gesto dà lo stesso tratto con un mouse a
//   1000 Hz e con uno a 60 Hz. Con `catchUp` il pennino continua ad avvicinarsi
//   anche se il puntatore si ferma, senza si ferma con lui.
//
// Con `catchUpOnEnd` il tratto finisce dov'è finito il puntatore, non dove era
// rimasto indietro il pennino.
//
// Derivato da codice di PhotoCraft, Copyright (c) 2026 ArtCraft Team and the
// PhotoCraft contributors, sotto licenza MIT: il testo è in
// `THIRD_PARTY_NOTICES.md`, alla radice. È la copia TypeScript
// di `crates/fub-ink/src/stabilizer.rs`, e la fixture `ink-samples.json` le
// obbliga a rispondere allo stesso modo.

import type { InkSample } from "../sample";

/// La lunghezza massima della corda con `amount` a 1, in pixel dello schermo.
export const MAX_STRING_PX = 100;

/// Il tempo del tratto in cui la media percorre la sua frazione di strada, in
/// millisecondi.
export const SMOOTHING_STEP_MS = 16;

/// Quanti passi al più per un evento: un evento dopo una lunga pausa non
/// produce una raffica di campioni.
const MAX_STEPS = 64;

/// La media più lenta: con `amount` a 1 il pennino fa comunque il 5 % della
/// strada a ogni passo.
const SLOWEST = 0.95;

/// Come si stabilizza un tratto.
export interface StabilizerConfig {
  /// Da 0 (spento) a 1 (il massimo).
  readonly amount: number;
  /// La corda invece della media.
  readonly pulledString: boolean;
  /// Con la media, il pennino continua ad avvicinarsi al puntatore fermo.
  readonly catchUp: boolean;
  /// Il tratto finisce dove è finito il puntatore.
  readonly catchUpOnEnd: boolean;
}

/// Lo stabilizzatore spento: i campioni restano come sono.
export const NO_STABILIZER: StabilizerConfig = {
  amount: 0,
  pulledString: false,
  catchUp: true,
  catchUpOnEnd: true,
};

/// Vero se la configurazione cambia i campioni.
export function stabilizerActive(config: StabilizerConfig): boolean {
  return Number.isFinite(config.amount) && config.amount > 0;
}

/// Lo stabilizzatore di un tratto: si alimenta un campione alla volta e
/// restituisce i campioni del pennino.
export class Stabilizer {
  private readonly zoom: number;
  private pos: InkSample | null = null;
  private lastInput: InkSample | null = null;

  /// `zoom` sono i pixel dello schermo per unità della scena; un valore non
  /// finito o più piccolo di 0,01 vale 0,01.
  constructor(private readonly config: StabilizerConfig, zoom: number) {
    this.zoom = Number.isFinite(zoom) ? Math.max(zoom, 0.01) : 1;
  }

  /// Vero se lo stabilizzatore cambia i campioni.
  get active(): boolean {
    return stabilizerActive(this.config);
  }

  /// Alimenta un campione del puntatore: i campioni del pennino per lui,
  /// nessuno se il pennino non si muove, più d'uno se recupera.
  push(p: InkSample, out: InkSample[]): void {
    const prevInput = this.lastInput;
    this.lastInput = p;
    if (!this.active) {
      out.push(p);
      return;
    }
    const pos = this.pos;
    if (pos === null) {
      this.pos = p;
      out.push(p);
      return;
    }
    const amount = Math.min(Math.max(this.config.amount, 0), 1);
    if (this.config.pulledString) {
      const len = (amount * MAX_STRING_PX) / this.zoom;
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > len) {
        const k = (d - len) / d;
        const next: InkSample = { ...p, x: pos.x + dx * k, y: pos.y + dy * k };
        this.pos = next;
        out.push(next);
      }
      return;
    }
    // La media: a ogni passo di tempo il pennino fa la frazione `a` della
    // strada verso il puntatore, così la sensazione non dipende da quanto
    // spesso il dispositivo riporta. Senza tempi, un passo per campione.
    const a = 1 - Math.min(amount, SLOWEST);
    const dt = prevInput === null ? 0 : p.t - prevInput.t;
    const still = prevInput !== null && prevInput.x === p.x && prevInput.y === p.y;
    if (still && !this.config.catchUp) {
      // Senza recupero il pennino si ferma mentre il puntatore è fermo.
      return;
    }
    let iters = 1;
    let step = a;
    if (dt > 0 && Number.isFinite(dt)) {
      const steps = dt / SMOOTHING_STEP_MS;
      iters = Math.min(Math.max(Math.ceil(steps), 1), MAX_STEPS);
      // Ciascuna delle `iters` mosse copre `steps / iters` passi.
      step = 1 - (1 - a) ** (Math.min(steps, MAX_STEPS) / iters);
    }
    let cur = pos;
    for (let i = 0; i < iters; i++) {
      cur = { ...p, x: cur.x + (p.x - cur.x) * step, y: cur.y + (p.y - cur.y) * step };
      out.push(cur);
    }
    this.pos = cur;
  }

  /// La fine del tratto: con `catchUpOnEnd` il pennino finisce dov'è l'ultimo
  /// campione del puntatore.
  finish(out: InkSample[]): void {
    if (!this.active || !this.config.catchUpOnEnd) return;
    const { pos, lastInput: last } = this;
    if (pos !== null && last !== null && (pos.x !== last.x || pos.y !== last.y)) {
      this.pos = last;
      out.push(last);
    }
  }
}
