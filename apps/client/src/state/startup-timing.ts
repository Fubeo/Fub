// Quanto ha impiegato l'avvio, e dove.
//
// L'avvio si divide in tre tratti: la pagina (dalla navigazione all'inizio
// della shell: la webview e il caricamento degli script), la shell (router,
// avviso di sessione, accordi) e il vault (l'apertura dell'ultimo vault con le
// sue schede). Oltre una soglia l'avviso lo dice, col tratto più lungo, e i
// tempi si copiano per chi deve capire perché.
//
// L'orologio è passato da fuori: il banco e i test lo fermano o lo guidano.

export type StartupPhase = "page" | "shell" | "vault";

export interface StartupTimes {
  readonly phases: readonly { readonly phase: StartupPhase; readonly ms: number }[];
  readonly total: number;
}

/// Sopra questa durata l'avvio è lento: una scrivania che non risponde per
/// otto secondi non sembra più un programma che si apre.
export const SLOW_STARTUP_MS = 8000;

/// Un orologio che segna la fine di ogni tratto. Il primo comincia a zero,
/// cioè alla navigazione della pagina.
export function startupClock(now: () => number): {
  mark(phase: StartupPhase): void;
  times(): StartupTimes;
} {
  const phases: { phase: StartupPhase; ms: number }[] = [];
  let last = 0;
  return {
    mark(phase) {
      const at = now();
      phases.push({ phase, ms: Math.max(0, at - last) });
      last = Math.max(last, at);
    },
    times: () => ({ phases: [...phases], total: last }),
  };
}

/// Il tratto più lungo di un avvio lento, o `null` se l'avvio è stato svelto.
export function slowPhase(times: StartupTimes, threshold = SLOW_STARTUP_MS): StartupPhase | null {
  if (times.total < threshold || !times.phases.length) return null;
  return times.phases.reduce((slowest, each) => (each.ms > slowest.ms ? each : slowest)).phase;
}
