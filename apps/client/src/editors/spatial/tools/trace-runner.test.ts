// Chi ricalca per la barra: il worker riceve l'immagine e una richiesta
// alla volta; dei ricalchi chiesti mentre uno corre conta l'ultimo, e uno
// che non serve più si ferma ripartendo il worker. Un worker finto risponde
// quando lo dice il test.

import { describe, expect, it } from "vitest";
import type { Raster, Traced } from "./trace";
import { inlineTracer, RESTART_MS, workerTracer, type TraceAnswer, type TraceMessage, type TraceWorker } from "./trace-runner";
import { presetSettings } from "./trace";
import type { TraceSettings } from "./trace-settings";

const RASTER: Raster = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };

const settings = (detail: number): TraceSettings => ({ preset: "bw", threshold: 128, colors: 2, detail, ignoreWhite: true });

const traced = (detail: number): Traced => ({ width: 2, height: 1, shapes: [], nodes: detail, colors: 0 });

/// Un worker finto: tiene ciò che riceve, e risponde con `answer`.
class FakeWorker implements TraceWorker {
  onmessage: ((event: MessageEvent<TraceAnswer>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: TraceMessage[] = [];
  terminated = false;

  postMessage(message: TraceMessage): void {
    this.received.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /// L'ultima richiesta ricevuta, che non sia l'immagine.
  last(): Exclude<TraceMessage, { kind: "image" }> {
    const requests = this.received.filter((message): message is Exclude<TraceMessage, { kind: "image" }> => message.kind !== "image");
    const found = requests[requests.length - 1];
    if (found === undefined) throw new Error("nessuna richiesta");
    return found;
  }

  answer(data: TraceAnswer): void {
    this.onmessage?.({ data } as MessageEvent<TraceAnswer>);
  }

  /// Risponde all'ultimo ricalco chiesto col dettaglio delle sue
  /// impostazioni come numero di nodi.
  finish(): void {
    const asked = this.last();
    if (asked.kind !== "trace") throw new Error("non è un ricalco");
    this.answer({ id: asked.id, traced: traced(asked.settings.detail) });
  }
}

/// Un ricalco nei worker finti, col tempo che il test sposta.
function tracing(): { tracer: ReturnType<typeof workerTracer>; workers: FakeWorker[]; clock: { now: number } } {
  const workers: FakeWorker[] = [];
  const clock = { now: 0 };
  const tracer = workerTracer(
    RASTER,
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    () => clock.now,
  );
  return { tracer, workers, clock };
}

describe("workerTracer", () => {
  it("il worker riceve l'immagine, poi le richieste col loro numero", async () => {
    const { tracer, workers } = tracing();
    const asked = tracer.settings("bw");
    expect(workers).toHaveLength(1);
    const [worker] = workers;
    expect(worker!.received[0]).toEqual({ kind: "image", raster: RASTER });
    const request = worker!.last();
    expect(request).toMatchObject({ kind: "settings", preset: "bw" });
    worker!.answer({ id: request.id, settings: settings(40) });
    expect(await asked).toEqual(settings(40));
    const done = tracer.trace(settings(40));
    worker!.finish();
    expect(await done).toEqual(traced(40));
    expect(workers).toHaveLength(1);
  });

  it("dei ricalchi chiesti mentre uno corre si fa solo l'ultimo; gli altri tornano null", async () => {
    const { tracer, workers } = tracing();
    const first = tracer.trace(settings(1));
    const second = tracer.trace(settings(2));
    const third = tracer.trace(settings(3));
    expect(await second).toBeNull();
    const [worker] = workers;
    // Il primo corre ancora: risponde, poi parte il terzo.
    worker!.finish();
    expect(await first).toEqual(traced(1));
    expect(worker!.last()).toMatchObject({ kind: "trace", settings: settings(3) });
    worker!.finish();
    expect(await third).toEqual(traced(3));
    expect(worker!.received.filter((message) => message.kind === "trace")).toHaveLength(2);
  });

  it("un ricalco che non serve più e corre da tanto si ferma: il worker riparte con l'immagine", async () => {
    const { tracer, workers, clock } = tracing();
    const slow = tracer.trace(settings(1));
    clock.now = RESTART_MS;
    const fresh = tracer.trace(settings(2));
    expect(await slow).toBeNull();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.received[0]).toEqual({ kind: "image", raster: RASTER });
    // Una risposta del worker fermato non conta.
    workers[0]!.answer({ id: 0, traced: traced(1) });
    workers[1]!.finish();
    expect(await fresh).toEqual(traced(2));
  });

  it("non ferma il worker mentre aspetta le impostazioni di un tipo", async () => {
    const { tracer, workers, clock } = tracing();
    const asked = tracer.settings("photo");
    const slow = tracer.trace(settings(1));
    clock.now = RESTART_MS * 2;
    const fresh = tracer.trace(settings(2));
    expect(workers).toHaveLength(1);
    const [worker] = workers;
    const request = worker!.received.find((message) => message.kind === "settings")!;
    if (request.kind !== "settings") throw new Error("non è una richiesta di impostazioni");
    worker!.answer({ id: request.id, settings: settings(9) });
    expect(await asked).toEqual(settings(9));
    worker!.finish();
    expect(await slow).toEqual(traced(1));
    worker!.finish();
    expect(await fresh).toEqual(traced(2));
  });

  it("un ricalco che non riesce rifiuta; un errore del worker rifiuta tutto ciò che aspetta", async () => {
    const { tracer, workers } = tracing();
    const failed = tracer.trace(settings(1));
    const [worker] = workers;
    worker!.answer({ id: worker!.last().id, failed: true });
    await expect(failed).rejects.toThrow();
    const asked = tracer.settings("bw");
    const running = tracer.trace(settings(2));
    const waiting = tracer.trace(settings(3));
    worker!.onerror?.({} as ErrorEvent);
    await expect(asked).rejects.toThrow();
    await expect(running).rejects.toThrow();
    await expect(waiting).rejects.toThrow();
    expect(worker!.terminated).toBe(true);
    // Il ricalco dopo trova un worker nuovo.
    const again = tracer.trace(settings(4));
    expect(workers).toHaveLength(2);
    workers[1]!.finish();
    expect(await again).toEqual(traced(4));
  });

  it("chiuso, ferma il worker: i ricalchi tornano null, le impostazioni rifiutano", async () => {
    const { tracer, workers } = tracing();
    const asked = tracer.settings("bw");
    const running = tracer.trace(settings(1));
    const waiting = tracer.trace(settings(2));
    tracer.dispose();
    expect(await running).toBeNull();
    expect(await waiting).toBeNull();
    await expect(asked).rejects.toThrow();
    expect(workers[0]!.terminated).toBe(true);
    await expect(tracer.trace(settings(3))).rejects.toThrow();
  });
});

describe("inlineTracer", () => {
  it("ricalca nella pagina col ricalco che carica; uno superato prima di partire torna null", async () => {
    const tracer = inlineTracer(RASTER, () => import("./trace"));
    expect(await tracer.settings("sketch")).toEqual(presetSettings("sketch", RASTER));
    const first = tracer.trace(settings(10));
    const second = tracer.trace(settings(20));
    expect(await first).toBeNull();
    expect((await second)!.width).toBe(2);
    tracer.dispose();
    expect(await tracer.trace(settings(30))).toBeNull();
  });
});
