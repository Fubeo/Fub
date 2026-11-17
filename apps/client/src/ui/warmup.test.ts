// @vitest-environment happy-dom
// La coda dei riscaldamenti: parte tardi, aspetta il silenzio prima di ogni
// passo, uno alla volta, e si ferma col suo padrone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "./lifetime";
import { createWarmups, type Warmups } from "./warmup";

let lifetime: Lifetime;
let warmups: Warmups;
const options = { startMs: 1000, quietMs: 300, frame: (run: () => void) => void setTimeout(run, 16), now: () => Date.now() };

/// Lascia girare timer e promesse per `ms` millisecondi finti.
const pass = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
const press = (): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
};

beforeEach(() => {
  vi.useFakeTimers();
  lifetime = openLifetime();
  warmups = createWarmups();
});

afterEach(() => {
  lifetime.close();
  vi.useRealTimers();
});

describe("i riscaldamenti", () => {
  it("chiusa la vita, la coda riparte con una vita nuova", async () => {
    const first = openLifetime();
    warmups.start(first, options);
    first.close();
    const done: string[] = [];
    warmups.register(async (next) => {
      await next();
      done.push("dopo");
    });
    await pass(5000);
    expect(done, "la vita chiusa non fa partire niente").toEqual([]);

    warmups.start(lifetime, options);
    await pass(2000);
    expect(done).toEqual(["dopo"]);
  });

  it("non partono prima di `start` né prima del ritardo, poi girano nell'ordine", async () => {
    const done: string[] = [];
    warmups.register(async (next) => {
      await next();
      done.push("uno");
    });
    warmups.register(async (next) => {
      await next();
      done.push("due");
    });
    await pass(5000);
    expect(done, "senza `start` niente").toEqual([]);

    warmups.start(lifetime, options);
    await pass(900);
    expect(done).toEqual([]);
    await pass(1000);
    expect(done).toEqual(["uno", "due"]);
  });

  it("un passo aspetta che la tastiera stia ferma, e fra due passi torna il silenzio", async () => {
    const done: string[] = [];
    warmups.register(async (next) => {
      await next();
      done.push("primo");
      // Un tasto arriva mentre il primo passo gira.
      press();
      await next();
      done.push("secondo");
    });
    warmups.start(lifetime, options);
    // Si scrive per due secondi, un tasto ogni 100 ms: niente gira.
    for (let i = 0; i < 20; i++) {
      press();
      await pass(100);
    }
    expect(done).toEqual([]);
    await pass(250);
    expect(done).toEqual(["primo"]);
    await pass(200);
    expect(done, "il tasto rimanda il secondo passo").toEqual(["primo"]);
    await pass(200);
    expect(done).toEqual(["primo", "secondo"]);
  });

  it("un compito registrato a coda partita gira anche lui", async () => {
    const done: string[] = [];
    warmups.start(lifetime, options);
    await pass(3000);
    warmups.register(async (next) => {
      await next();
      done.push("tardi");
    });
    await pass(400);
    expect(done).toEqual(["tardi"]);
  });

  it("un errore non ferma i compiti dopo", async () => {
    const done: string[] = [];
    warmups.register(async (next) => {
      await next();
      throw new Error("canvas assente");
    });
    warmups.register(async (next) => {
      await next();
      done.push("dopo");
    });
    warmups.start(lifetime, options);
    await pass(2000);
    expect(done).toEqual(["dopo"]);
  });

  it("smontato prima non gira, e a metà si ferma al passo dopo", async () => {
    const done: string[] = [];
    const remove = warmups.register(async (next) => {
      await next();
      done.push("tolto");
    });
    remove();
    const stop = warmups.register(async (next) => {
      await next();
      done.push("primo");
      stop();
      await next();
      done.push("secondo");
    });
    warmups.start(lifetime, options);
    await pass(3000);
    expect(done).toEqual(["primo"]);
  });

  it("chiusa la vita la coda si ferma e non lascia timer", async () => {
    const done: string[] = [];
    warmups.register(async (next) => {
      await next();
      done.push("mai");
    });
    warmups.start(lifetime, options);
    await pass(500);
    lifetime.close();
    await pass(5000);
    expect(done).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dice se ha ancora lavoro: in attesa del ritardo, in corso, finito", async () => {
    let release: () => void = () => undefined;
    warmups.register(async (next) => {
      await next();
      await new Promise<void>((resolve) => (release = resolve));
    });
    expect(warmups.pending(), "senza `start` non gira niente").toBe(false);

    warmups.start(lifetime, options);
    expect(warmups.pending(), "un compito aspetta che scada il ritardo").toBe(true);
    await pass(2000);
    expect(warmups.pending(), "il compito è a metà").toBe(true);
    release();
    await pass(0);
    expect(warmups.pending()).toBe(false);

    warmups.register(async (next) => {
      await next();
    });
    expect(warmups.pending(), "un compito registrato dopo è lavoro nuovo").toBe(true);
    await pass(1000);
    expect(warmups.pending()).toBe(false);
  });

  it("a vita chiusa non c'è niente in sospeso", async () => {
    warmups.register(async (next) => {
      await next();
    });
    warmups.start(lifetime, options);
    expect(warmups.pending()).toBe(true);
    lifetime.close();
    expect(warmups.pending()).toBe(false);
  });
});
