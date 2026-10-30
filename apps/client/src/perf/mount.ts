// La sonda nella shell: accesa e spenta dall'impostazione di macchina
// `perf.probe`, consegnata a chi misura come `window.__fubProbe`.
//
// Spenta, non c'è: nessun ascoltatore, nessun fotogramma chiesto, nessun
// oggetto globale. Accesa, la guida un banco WebDriver (`bench/webview/`):
// `start()`, i gesti veri, `stop()` col referto.
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createProbe, watchColdStart, type Probe, type ProbeReport } from "./probe";

export const PERF_PROBE_SETTING = "perf.probe";

/// Dove la prima nota è disegnata: una riga di un editor di testo in un
/// riquadro.
const FIRST_NOTE = ".pane .cm-content .cm-line";
/// Oltre questo tempo dall'inizio della pagina l'avvio non si misura più.
const COLD_START_LIMIT_MS = 60_000;

/// Ciò che il banco vede: le promesse attraversano WebDriver (`executeAsync`).
export interface ProbeGlobal {
  start(): void;
  stop(): ProbeReport;
  waitFor(name: string, selector: string, timeout: number, text?: string): Promise<boolean>;
}

declare global {
  interface Window {
    __fubProbe?: ProbeGlobal;
  }
}

export function mountPerfProbe(lifetime: Lifetime): void {
  let active: { life: Lifetime; probe: Probe } | null = null;
  let generation = 0;

  const remove = (): void => {
    active?.life.close();
    active = null;
    delete window.__fubProbe;
  };
  const switchTo = (on: boolean): void => {
    if (on === (active !== null) || lifetime.closed) return;
    if (!on) return remove();
    const life = openLifetime();
    const probe = createProbe(life);
    watchColdStart(life, FIRST_NOTE, COLD_START_LIMIT_MS, (ms) => probe.recordColdStart(ms));
    active = { life, probe };
    window.__fubProbe = {
      start: () => probe.start(),
      stop: () => probe.stop(),
      waitFor: (name, selector, timeout, text) => probe.waitFor(name, selector, timeout, text),
    };
  };

  const reread = async (): Promise<void> => {
    const current = ++generation;
    let on = false;
    try {
      on = (await settings()).some((entry) => entry.spec.key === PERF_PROBE_SETTING && entry.value === true);
    } catch {
      // Le impostazioni non rispondono: la sonda resta com'era. Non è una
      // funzione dell'app, è uno strumento, e non vale un avviso.
      return;
    }
    if (current === generation) switchTo(on);
  };

  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (key === PERF_PROBE_SETTING) void reread();
  }));
  // Chiusa la vita, `switchTo` non accende più niente: lo smontaggio toglie
  // da sé.
  lifetime.add(() => {
    generation++;
    remove();
  });
  void reread();
}
