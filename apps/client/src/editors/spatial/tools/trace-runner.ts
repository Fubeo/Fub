// Chi ricalca un'immagine per la barra di «Ricalca immagine»: il ricalco
// (`trace.ts`) gira in un worker, `trace-worker.ts`, e la barra resta
// pronta mentre una foto si ricalca. Dove i worker non ci sono, come nei
// test, gira nella pagina, caricato solo quando serve.
//
// - **Conta l'ultima richiesta.** Mentre un cursore corre, i ricalchi
//   chiesti nel frattempo aspettano, e di loro si fa solo l'ultimo; uno
//   superato torna `null`. Un ricalco che non serve più e corre già da
//   [`RESTART_MS`] si ferma: il worker riparte con l'immagine, che costa
//   meno che aspettarlo.
// - **L'immagine resta qui**, e il worker ne riceve una copia: può
//   ripartire quante volte serve.

import type { Raster, Traced } from "./trace";
import type { TracePreset, TraceSettings } from "./trace-settings";

/// Ciò che la pagina chiede al worker: l'immagine, poi le impostazioni
/// pronte di un preset o un ricalco, ognuno col suo numero.
export type TraceMessage =
  | { readonly kind: "image"; readonly raster: Raster }
  | { readonly kind: "settings"; readonly id: number; readonly preset: TracePreset }
  | { readonly kind: "trace"; readonly id: number; readonly settings: TraceSettings };

/// Ciò che il worker risponde, col numero della richiesta.
export type TraceAnswer =
  | { readonly id: number; readonly settings: TraceSettings }
  | { readonly id: number; readonly traced: Traced }
  | { readonly id: number; readonly failed: true };

/// Chi ricalca un'immagine: la tiene, e ricalca con le impostazioni che
/// riceve.
export interface Tracer {
  /// Le impostazioni pronte di `preset` per l'immagine. Rifiuta se il
  /// ricalco non riesce a partire.
  settings(preset: TracePreset): Promise<TraceSettings>;
  /// Il ricalco con `settings`; `null` se nel frattempo ne è stato chiesto
  /// un altro. Rifiuta se il ricalco non riesce.
  trace(settings: TraceSettings): Promise<Traced | null>;
  /// Lascia l'immagine, e ferma il ricalco in corso.
  dispose(): void;
}

/// Chi ricalca `raster`.
export type TracerFactory = (raster: Raster) => Tracer;

/// Quanto può correre un ricalco che non serve più, in millisecondi, prima
/// che il worker si fermi e riparta.
export const RESTART_MS = 150;

/// Il minimo di un worker che serve qui: `Worker` del browser lo è.
export interface TraceWorker {
  onmessage: ((event: MessageEvent<TraceAnswer>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: TraceMessage): void;
  terminate(): void;
}

interface Pending<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

/// Chi ricalca `raster` nei worker che `spawn` crea, uno alla volta;
/// `now` dà il tempo in millisecondi.
export function workerTracer(raster: Raster, spawn: () => TraceWorker, now: () => number = () => performance.now()): Tracer {
  let worker: TraceWorker | null = null;
  let next = 0;
  let disposed = false;
  const asked = new Map<number, Pending<TraceSettings>>();
  /// Il ricalco in corso, da quando, e quello che aspetta il suo turno.
  let running: { readonly id: number; readonly since: number; readonly answer: Pending<Traced | null> } | null = null;
  let waiting: { readonly settings: TraceSettings; readonly answer: Pending<Traced | null> } | null = null;

  const failAll = (): void => {
    const error = new Error("ricalco non riuscito");
    for (const pending of asked.values()) pending.reject(error);
    asked.clear();
    running?.answer.reject(error);
    running = null;
    waiting?.answer.reject(error);
    waiting = null;
    worker?.terminate();
    worker = null;
  };

  const run = (settings: TraceSettings, answer: Pending<Traced | null>): void => {
    const id = next++;
    running = { id, since: now(), answer };
    started().postMessage({ kind: "trace", id, settings });
  };

  const answered = (data: TraceAnswer): void => {
    const pending = asked.get(data.id);
    if (pending !== undefined) {
      asked.delete(data.id);
      if ("settings" in data) pending.resolve(data.settings);
      else pending.reject(new Error("ricalco non riuscito"));
      return;
    }
    if (running === null || running.id !== data.id) return;
    const { answer } = running;
    running = null;
    if ("traced" in data) answer.resolve(data.traced);
    else answer.reject(new Error("ricalco non riuscito"));
    if (waiting !== null) {
      const { settings, answer: later } = waiting;
      waiting = null;
      run(settings, later);
    }
  };

  const started = (): TraceWorker => {
    if (worker !== null) return worker;
    const born = spawn();
    born.onmessage = (event) => answered(event.data);
    born.onerror = () => failAll();
    born.postMessage({ kind: "image", raster });
    worker = born;
    return born;
  };

  return {
    settings(preset) {
      if (disposed) return Promise.reject(new Error("ricalco chiuso"));
      return new Promise((resolve, reject) => {
        const id = next++;
        asked.set(id, { resolve, reject });
        try {
          started().postMessage({ kind: "settings", id, preset });
        } catch {
          failAll();
        }
      });
    },
    trace(settings) {
      if (disposed) return Promise.reject(new Error("ricalco chiuso"));
      return new Promise((resolve, reject) => {
        const answer = { resolve, reject };
        waiting?.answer.resolve(null);
        waiting = null;
        try {
          if (running === null) {
            run(settings, answer);
          } else if (now() - running.since >= RESTART_MS && asked.size === 0) {
            // Il ricalco in corso non serve più, e potrebbe durare: il
            // worker riparte.
            running.answer.resolve(null);
            running = null;
            worker?.terminate();
            worker = null;
            run(settings, answer);
          } else {
            waiting = { settings, answer };
          }
        } catch {
          failAll();
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running?.answer.resolve(null);
      waiting?.answer.resolve(null);
      running = waiting = null;
      const error = new Error("ricalco chiuso");
      for (const pending of asked.values()) pending.reject(error);
      asked.clear();
      worker?.terminate();
      worker = null;
    },
  };
}

/// Chi ricalca `raster` nella pagina, col ricalco che `load` carica: dove
/// non ci sono worker. Un ricalco superato prima di partire torna `null`.
export function inlineTracer(raster: Raster, load: () => Promise<typeof import("./trace")>): Tracer {
  let latest = 0;
  let disposed = false;
  return {
    async settings(preset) {
      const { presetSettings } = await load();
      if (disposed) throw new Error("ricalco chiuso");
      return presetSettings(preset, raster);
    },
    async trace(settings) {
      const mine = ++latest;
      const { trace } = await load();
      if (disposed || mine !== latest) return null;
      return trace(raster, settings);
    },
    dispose() {
      disposed = true;
    },
  };
}
