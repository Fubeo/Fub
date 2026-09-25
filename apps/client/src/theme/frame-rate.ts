// Il ritmo dei fotogrammi che la shell disegna da sé: il tetto scelto
// dall'utente (`appearance.frame-rate`) e il periodo dello schermo, stimato dai
// `requestAnimationFrame` stessi. Transizioni CSS e scorrimento li anima il
// browser al refresh dello schermo; i loop in proprio (il grafo) passano da qui
// per seguire lo stesso schermo, qualunque sia, e lo stesso tetto.

/// Il periodo di riferimento finché la stima non ha campioni.
export const REFERENCE_PERIOD_MS = 1000 / 60;
/// Gli intervalli guardati dalla stima: la mediana ignora i fotogrammi persi,
/// che sono il doppio del periodo e mai la maggioranza.
const WINDOW = 9;
/// Intervalli fuori da qui non sono un fotogramma dello schermo: due
/// callback nello stesso fotogramma, o una pausa (scheda nascosta).
const MIN_INTERVAL_MS = 1;
const MAX_INTERVAL_MS = 100;

/// I tetti che il core offre (`FRAME_RATE_CAPS` in fub-host/src/settings.rs).
const CAPS: readonly number[] = [240, 165, 144, 120, 90, 60, 30];

let cap = 0;

/// Il tetto in fps di un valore di `appearance.frame-rate`; 0 è il massimo
/// dello schermo, anche per un valore che non è fra i tetti offerti.
export function frameRateCapOf(value: unknown): number {
  const fps = typeof value === "string" ? Number(value) : NaN;
  return CAPS.includes(fps) ? fps : 0;
}

/// La preferenza dell'utente, riletta con le altre impostazioni d'aspetto. I
/// pacer la leggono a ogni fotogramma: nessuno deve essere avvisato.
export function setFrameRatePreference(value: unknown): void {
  cap = frameRateCapOf(value);
}

/// Il tetto in vigore, 0 = il massimo dello schermo.
export function frameRateCap(): number {
  return cap;
}

export interface FramePacer {
  /// A ogni callback di `requestAnimationFrame`, col suo istante (ms): se
  /// questo fotogramma va disegnato. Uno scartato lascia il loop acceso, che
  /// riprova al prossimo.
  admit(t: number): boolean;
  /// Il periodo dello schermo stimato (ms).
  displayPeriodMs(): number;
  /// Il periodo dei fotogrammi disegnati (ms): quello dello schermo, o del
  /// tetto se è più lento.
  periodMs(): number;
  /// Il periodo del tetto (ms), 0 senza tetto. È il budget di un fotogramma
  /// quando c'è: la stima dello schermo si allunga sotto carico, il tetto no.
  capPeriodMs(): number;
  /// Il loop si è fermato: la pausa non è un intervallo, e il primo
  /// fotogramma al risveglio passa subito.
  pause(): void;
}

/// Un pacer per loop. Il tetto tiene la media esatta: ogni fotogramma ammesso
/// sposta la scadenza di un intervallo, e passa il callback più vicino alla
/// scadenza (mezzo periodo di tolleranza). Un tetto che non divide il refresh
/// alterna così due distanze senza derivare, e uno sopra il refresh non
/// scarta niente.
export function createFramePacer(capOf: () => number = frameRateCap): FramePacer {
  const intervals = new Float64Array(WINDOW);
  const sorted = new Float64Array(WINDOW);
  let count = 0;
  let cursor = 0;
  let period = REFERENCE_PERIOD_MS;
  let lastCallback = -1;
  let deadline = -1;

  function observe(t: number): void {
    if (lastCallback >= 0) {
      const interval = t - lastCallback;
      if (interval >= MIN_INTERVAL_MS && interval <= MAX_INTERVAL_MS) {
        intervals[cursor] = interval;
        cursor = (cursor + 1) % WINDOW;
        if (count < WINDOW) count++;
        period = median();
      }
    }
    lastCallback = t;
  }

  function median(): number {
    for (let i = 0; i < count; i++) {
      const value = intervals[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > value) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = value;
    }
    return sorted[count >> 1];
  }

  return {
    admit(t) {
      observe(t);
      const fps = capOf();
      if (fps <= 0) {
        deadline = -1;
        return true;
      }
      const interval = 1000 / fps;
      if (deadline < 0) {
        deadline = t + interval;
        return true;
      }
      if (t < deadline - Math.min(period, interval) / 2) return false;
      // Indietro di più di un intervallo (un fotogramma lungo): si riparte da
      // qui invece di recuperare con una raffica.
      deadline = t - deadline > interval ? t + interval : deadline + interval;
      return true;
    },
    displayPeriodMs: () => period,
    periodMs() {
      const fps = capOf();
      return fps > 0 ? Math.max(period, 1000 / fps) : period;
    },
    capPeriodMs() {
      const fps = capOf();
      return fps > 0 ? 1000 / fps : 0;
    },
    pause() {
      lastCallback = -1;
      deadline = -1;
    },
  };
}
