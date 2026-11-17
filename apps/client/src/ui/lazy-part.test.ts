// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyPart, loadLazyParts } from "./lazy-part";
import * as notices from "./notify";

/// Un `import()` che la prova fa arrivare (`arrive`) o fallire (`fail`).
function deferred<T>(): { importer: () => Promise<T>; arrive: (value: T) => void; fail: (error: Error) => void; calls: () => number } {
  let calls = 0;
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  let pending = new Promise<T>((ok, ko) => { resolve = ok; reject = ko; });
  return {
    importer: () => {
      calls++;
      return pending;
    },
    arrive: (value) => resolve(value),
    fail: (error) => {
      reject(error);
      pending = new Promise<T>((ok, ko) => { resolve = ok; reject = ko; });
    },
    calls: () => calls,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("un pezzo che arriva con un import()", () => {
  it("i gesti prima del codice aspettano, in ordine, e nessuno si perde; dopo, il gesto è nello stesso giro", async () => {
    const source = deferred<{ name: string }>();
    const part = lazyPart(source.importer);
    const seen: string[] = [];
    part.run((module) => seen.push(`primo ${module.name}`));
    part.run((module) => seen.push(`secondo ${module.name}`));
    expect(part.current()).toBeNull();
    expect(seen).toEqual([]);
    // Una richiesta sola, anche con due gesti in coda.
    expect(source.calls()).toBe(1);
    source.arrive({ name: "modulo" });
    await part.load();
    expect(seen).toEqual(["primo modulo", "secondo modulo"]);
    part.run((module) => seen.push(`terzo ${module.name}`));
    expect(seen[seen.length - 1]).toBe("terzo modulo");
    expect(part.current()).toEqual({ name: "modulo" });
  });

  it("un gesto di chi non c'è più non si fa", async () => {
    const source = deferred<number>();
    const part = lazyPart(source.importer);
    const gesture = vi.fn();
    let alive = true;
    part.run(gesture, () => alive);
    alive = false;
    source.arrive(1);
    await part.load();
    expect(gesture).not.toHaveBeenCalled();
  });

  it("un import() che non riesce lo dice, e il gesto dopo riprova", async () => {
    const said = vi.spyOn(notices, "notify").mockImplementation(() => {});
    const source = deferred<number>();
    const part = lazyPart(source.importer);
    const gesture = vi.fn();
    part.run(gesture);
    source.fail(new Error("chunk mancante"));
    await expect(part.load()).rejects.toThrow("chunk mancante");
    await vi.waitFor(() => expect(said).toHaveBeenCalledTimes(1));
    expect(said.mock.calls[0]![1]).toBe("guasto");
    expect(said.mock.calls[0]![0]).toContain("chunk mancante");
    expect(gesture).not.toHaveBeenCalled();
    part.run(gesture);
    source.arrive(7);
    await part.load();
    expect(gesture).toHaveBeenCalledWith(7);
  });

  it("il riscaldamento chiede il codice a thread libero, una volta sola", async () => {
    const idle = vi.fn((run: () => void, _options?: { timeout?: number }) => {
      run();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    const source = deferred<string>();
    const part = lazyPart(source.importer);
    part.warm();
    part.warm();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]![1]).toEqual({ timeout: 1500 });
    expect(source.calls()).toBe(1);
    source.arrive("pronto");
    await loadLazyParts();
    expect(part.current()).toBe("pronto");
    // Arrivato, il riscaldamento non chiede più niente.
    part.warm();
    expect(idle).toHaveBeenCalledTimes(1);
  });
});
