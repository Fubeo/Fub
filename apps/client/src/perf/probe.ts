// La sonda delle prestazioni (N0): quanto passa da un tasto, un clic o un
// tratto di penna al fotogramma che lo mostra, e quanti fotogrammi sono lunghi,
// nella WebView vera (WebKitGTK, WebKit, WebView2) e non nel Chromium dei
// banchi.
//
// Spenta di default; la accende l'impostazione di macchina `perf.probe`. Accesa
// non manda niente fuori: tiene i campioni in memoria e li consegna a chi li
// chiede da `window.__fubProbe`, cioè il banco guidato da WebDriver
// (`bench/webview/`).
//
// Le due misure, e perché così:
// - **dall'evento al fotogramma**: `event.timeStamp` e `performance.now()`
//   usano lo stesso orologio; il primo `requestAnimationFrame` gira prima di
//   disegnare il fotogramma con la modifica, il secondo dopo che quel
//   fotogramma è stato consegnato. Un campione in volo alla volta per specie:
//   cento `pointermove` in un fotogramma sono un fotogramma, non cento;
// - **i fotogrammi lunghi** dalla distanza fra due `requestAnimationFrame`,
//   perché WebKit non ha `PerformanceObserver("longtask")`.
import type { Lifetime } from "../ui/lifetime";

export type InputKind = "key" | "pointer" | "pen";

/// Conteggio, mediana, 95° percentile e massimo, in ms.
export interface Summary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface FrameSummary extends Summary {
  /// Fotogrammi oltre 33 ms: due fotogrammi a 60 Hz, uno saltato.
  readonly over33: number;
  /// Fotogrammi oltre 50 ms: un salto che si vede.
  readonly over50: number;
}

export interface ProbeReport {
  readonly userAgent: string;
  /// Dall'evento al fotogramma consegnato che lo mostra, per specie.
  readonly input: Record<InputKind, Summary>;
  /// La distanza fra due fotogrammi mentre la sonda era accesa.
  readonly frames: FrameSummary;
  /// Le attese con nome (`waitFor`): dall'ultimo gesto al fotogramma che mostra
  /// il segno atteso.
  readonly marks: Record<string, Summary>;
  /// Dall'inizio della pagina alla prima nota disegnata, se c'è stata.
  readonly coldStart: number | null;
}

/// L'orologio e i fotogrammi: quelli del browser, o finti nei test.
export interface ProbeClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

/// I fotogrammi del browser. Chi li chiede ne tiene il numero e li cancella
/// allo spegnimento (`pending` nella sonda, `handle` nell'avvio a freddo).
const BROWSER_CLOCK: ProbeClock = {
  now: () => performance.now(),
  request: (callback) => {
    const frame = requestAnimationFrame(callback);
    return frame;
  },
  cancel: (frame) => cancelAnimationFrame(frame),
};

/// La regola dei percentili: il valore al rango `ceil(p · n)`, senza
/// interpolare, così un p95 è sempre un campione vero.
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]!) };
}

export interface Probe {
  start(): void;
  stop(): ProbeReport;
  /// Aspetta che `selector` compaia (e, con `text`, che dica quel testo) e
  /// misura dall'ultimo gesto al fotogramma consegnato che lo mostra. `false`
  /// se non arriva entro `timeout` ms o se la sonda si ferma prima.
  waitFor(name: string, selector: string, timeout: number, text?: string): Promise<boolean>;
  /// Il primo fotogramma con una nota (`watchColdStart`): resta nel referto
  /// anche quando la misura riparte.
  recordColdStart(ms: number): void;
}

export function createProbe(lifetime: Lifetime, clock: ProbeClock = BROWSER_CLOCK): Probe {
  let running = false;
  let input: Record<InputKind, number[]> = { key: [], pointer: [], pen: [] };
  let gaps: number[] = [];
  let marks: Record<string, number[]> = {};
  let lastGesture: number | null = null;
  let coldStart: number | null = null;
  /// I fotogrammi chiesti e non ancora arrivati: si cancellano tutti allo
  /// spegnimento, così una sonda spenta non lascia niente in coda.
  const pending = new Set<number>();
  const inFlight = new Set<InputKind>();
  /// Le attese aperte: chi si ferma le chiude con `false`, invece di lasciare
  /// una promessa che nessun fotogramma risolverà più.
  const waiting = new Set<(shown: boolean) => void>();

  const nextFrame = (callback: (time: number) => void): void => {
    const handle = clock.request((time) => {
      pending.delete(handle);
      callback(time);
    });
    pending.add(handle);
  };
  const cancelAll = (): void => {
    for (const handle of pending) clock.cancel(handle);
    pending.clear();
    inFlight.clear();
    for (const settle of [...waiting]) settle(false);
  };

  const measure = (event: Event, kind: InputKind): void => {
    if (!running) return;
    lastGesture = event.timeStamp;
    if (inFlight.has(kind)) return;
    inFlight.add(kind);
    const start = event.timeStamp;
    nextFrame(() => nextFrame(() => {
      inFlight.delete(kind);
      if (running) input[kind].push(clock.now() - start);
    }));
  };
  const kindOf = (event: Event): InputKind =>
    (event as PointerEvent).pointerType === "pen" ? "pen" : "pointer";

  // In cattura e passivi: la sonda guarda, non decide niente e non ritarda chi
  // ascolta dopo di lei.
  lifetime.listen(document, "keydown", (event) => measure(event, "key"), { capture: true, passive: true });
  lifetime.listen(document, "pointerdown", (event) => measure(event, kindOf(event)), { capture: true, passive: true });
  lifetime.listen(document, "pointermove", (event) => {
    // Il movimento conta solo per la penna: il mouse che passa non mostra niente.
    if (kindOf(event) === "pen") measure(event, "pen");
  }, { capture: true, passive: true });

  const watchFrames = (last: number): void => {
    nextFrame((now) => {
      if (!running) return;
      gaps.push(now - last);
      watchFrames(now);
    });
  };

  lifetime.add(() => {
    running = false;
    cancelAll();
  });

  return {
    start() {
      if (lifetime.closed) return;
      cancelAll();
      input = { key: [], pointer: [], pen: [] };
      gaps = [];
      marks = {};
      lastGesture = null;
      running = true;
      watchFrames(clock.now());
    },
    stop() {
      running = false;
      cancelAll();
      const frames = summarize(gaps);
      return {
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        input: { key: summarize(input.key), pointer: summarize(input.pointer), pen: summarize(input.pen) },
        frames: { ...frames, over33: gaps.filter((gap) => gap > 33).length, over50: gaps.filter((gap) => gap > 50).length },
        marks: Object.fromEntries(Object.entries(marks).map(([name, values]) => [name, summarize(values)])),
        coldStart,
      };
    },
    recordColdStart(ms) {
      coldStart = Math.round(ms);
    },
    waitFor(name, selector, timeout, text) {
      const since = lastGesture ?? clock.now();
      const deadline = clock.now() + timeout;
      const matches = (): boolean => {
        const found = document.querySelector(selector);
        return found !== null && (text === undefined || (found.textContent ?? "").includes(text));
      };
      return new Promise((done) => {
        const resolve = (shown: boolean): void => {
          if (!waiting.delete(resolve)) return;
          done(shown);
        };
        waiting.add(resolve);
        if (!running) return resolve(false);
        const look = (): void => {
          if (!running) return resolve(false);
          if (matches()) {
            // Visto in questo fotogramma: il prossimo lo disegna, quello dopo
            // sa che è stato consegnato.
            nextFrame(() => nextFrame(() => {
              if (!running) return resolve(false);
              (marks[name] ??= []).push(clock.now() - since);
              resolve(true);
            }));
            return;
          }
          if (clock.now() >= deadline) return resolve(false);
          nextFrame(look);
        };
        nextFrame(look);
      });
    },
  };
}

/// Il primo fotogramma con una nota: dall'inizio della pagina (`timeOrigin`)
/// alla prima riga di un editor disegnata. Si guarda a ogni fotogramma per al
/// più `timeout` ms, poi si smette: la sonda non resta a girare per sempre.
export function watchColdStart(
  lifetime: Lifetime,
  selector: string,
  timeout: number,
  sink: (ms: number) => void,
  clock: ProbeClock = BROWSER_CLOCK,
): void {
  let handle: number | null = null;
  const look = (): void => {
    handle = null;
    if (lifetime.closed || clock.now() > timeout) return;
    if (document.querySelector(selector)) {
      handle = clock.request(() => {
        handle = clock.request(() => {
          handle = null;
          if (!lifetime.closed) sink(clock.now());
        });
      });
      return;
    }
    handle = clock.request(look);
  };
  handle = clock.request(look);
  lifetime.add(() => {
    if (handle !== null) clock.cancel(handle);
  });
}
