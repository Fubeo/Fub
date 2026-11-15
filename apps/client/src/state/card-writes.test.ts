// La parte della porta delle schede che c'è dall'avvio: le schede che
// scrivono tengono aperta la loro sessione, e la porta vera arriva al primo
// uso senza montare niente dopo che la shell se n'è andata.

import { describe, expect, it, vi } from "vitest";
import type { CardEditorHub } from "./card-editors";
import { cardStopped, cardWrites, cardWriting, lazyCardEditorHub, releaseSession } from "./card-writes";

/// Una porta finta: ricorda le chiamate, e `open` dà un editor finto.
function fakeHub(): CardEditorHub & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    open: async (path) => {
      calls.push(`open ${path}`);
      return { path } as never;
    },
    openText: async (_host, text) => {
      calls.push(`openText ${text}`);
      return { text } as never;
    },
    written: () => {
      calls.push("written");
      return true;
    },
    failed: () => true,
    holds: (path) => path === "a.md",
    renamed: () => calls.push("renamed"),
    refreshReadOnly: () => calls.push("refreshReadOnly"),
    setTheme: () => calls.push("setTheme"),
    destroyAll: () => calls.push("destroyAll"),
  };
}

/// Un caricamento che si risolve quando lo dice la prova.
function deferredLoad(hub: CardEditorHub) {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const create = vi.fn(() => hub);
  const load = vi.fn(() => new Promise<() => CardEditorHub>((ok, ko) => {
    resolve = () => ok(create);
    reject = ko;
  }));
  return { load, create, resolve: () => resolve(), reject: (error: unknown) => reject(error) };
}

const host = () => ({}) as HTMLElement;

/// Le sessioni della finestra come le tiene `DocumentSessionCollection`: una
/// prenotazione (`retain`) fa rispondere `active` a `release`.
function fakeSessions() {
  const intents = new Map<string, number>();
  const released: string[] = [];
  return {
    released,
    retain: vi.fn((path: string) => {
      intents.set(path, (intents.get(path) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        intents.set(path, (intents.get(path) ?? 1) - 1);
      };
    }),
    release: vi.fn(async (path: string) => {
      if ((intents.get(path) ?? 0) > 0) return { kind: "active" } as const;
      released.push(path);
      return { kind: "closed", dirty: false } as const;
    }),
  };
}

/// La finestra attorno alla porta: nessun riquadro mostra niente.
function fakeWindow(sessions = fakeSessions(), shown: (path: string) => boolean = () => false) {
  return { sessions: () => sessions, shownInPane: shown };
}

/// Lascia girare le promesse già risolte.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = { compact: false, readOnly: false } as never;

describe("releaseSession", () => {
  it("lascia la sessione, ma non quella su cui una scheda scrive", async () => {
    const release = vi.fn(async () => ({ kind: "closed" }) as never);
    const writer = { session: { id: "a.md" } };
    cardWriting(writer);
    try {
      expect(cardWrites("a.md")).toBe(true);
      expect(await releaseSession("a.md", { release })).toEqual({ kind: "active" });
      expect(release).not.toHaveBeenCalled();
    } finally {
      cardStopped(writer);
    }
    expect(cardWrites("a.md")).toBe(false);
    expect(await releaseSession("a.md", { release })).toEqual({ kind: "closed" });
    expect(release).toHaveBeenCalledWith("a.md");
  });
});

describe("lazyCardEditorHub", () => {
  it("non carica niente finché nessuno apre, e le domande sincrone hanno la risposta di una porta vuota", () => {
    const { load } = deferredLoad(fakeHub());
    const hub = lazyCardEditorHub(load, fakeWindow());
    expect(hub.holds("a.md")).toBe(false);
    expect(hub.written("card-editor:1", {} as never)).toBe(false);
    expect(hub.failed("card-editor:1", new Error("x"))).toBe(false);
    hub.renamed();
    hub.refreshReadOnly();
    hub.setTheme({} as never);
    hub.destroyAll();
    expect(load).not.toHaveBeenCalled();
  });

  it("alla prima apertura carica il modulo una volta, e poi passa tutto alla porta vera", async () => {
    const real = fakeHub();
    const { load, create, resolve } = deferredLoad(real);
    const hub = lazyCardEditorHub(load, fakeWindow());
    const first = hub.open("a.md", host(), options);
    const second = hub.openText!(host(), "testo", {} as never);
    resolve();
    expect(await first).toEqual({ path: "a.md" });
    expect(await second).toEqual({ text: "testo" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(hub.holds("a.md")).toBe(true);
    expect(hub.written("card-editor:1", {} as never)).toBe(true);
    hub.setTheme({} as never);
    hub.destroyAll();
    expect(real.calls).toEqual(["open a.md", "openText testo", "written", "setTheme", "destroyAll"]);
  });

  it("un'apertura in attesa del modulo quando la shell se ne va non monta niente", async () => {
    const real = fakeHub();
    const { load, create, resolve } = deferredLoad(real);
    const hub = lazyCardEditorHub(load, fakeWindow());
    const pending = hub.open("a.md", host(), options);
    hub.destroyAll();
    resolve();
    expect(await pending).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(real.calls).toEqual([]);
    // Un'apertura dopo, a shell di nuovo su, apre davvero.
    expect(await hub.open("b.md", host(), options)).toEqual({ path: "b.md" });
    expect(real.calls).toEqual(["open b.md"]);
  });

  it("un caricamento fallito arriva a chi apre, e la prossima apertura riprova", async () => {
    const real = fakeHub();
    const first = deferredLoad(real);
    let attempt = 0;
    const load = vi.fn(() => (++attempt === 1 ? first.load() : Promise.resolve(() => real)));
    const hub = lazyCardEditorHub(load, fakeWindow());
    const failing = hub.open("a.md", host(), options);
    first.reject(new Error("chunk mancante"));
    await expect(failing).rejects.toThrow("chunk mancante");
    expect(await hub.open("a.md", host(), options)).toEqual({ path: "a.md" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("un'apertura in attesa del modulo tiene la sessione: un riquadro che la lascia non la chiude", async () => {
    const sessions = fakeSessions();
    const { load, resolve } = deferredLoad(fakeHub());
    const hub = lazyCardEditorHub(load, fakeWindow(sessions));
    const pending = hub.open("a.md", host(), options);
    expect(hub.holds("a.md")).toBe(true);
    // Il riquadro di «a.md» si chiude mentre il modulo arriva.
    expect(await releaseSession("a.md", sessions)).toEqual({ kind: "active" });
    expect(sessions.released).toEqual([]);
    resolve();
    expect(await pending).toEqual({ path: "a.md" });
    // La porta vera ha l'editor: la sessione resta, e la lascerà lei.
    await settled();
    expect(sessions.released).toEqual([]);
  });

  it("un'apertura che rinuncia lascia la sessione che nessuno guarda più, non quella di un riquadro", async () => {
    const real = fakeHub();
    real.open = async () => null;
    real.holds = () => false;
    const sessions = fakeSessions();
    let shown = true;
    const hub = lazyCardEditorHub(async () => () => real, fakeWindow(sessions, () => shown));
    expect(await hub.open("a.md", host(), options)).toBeNull();
    await settled();
    expect(sessions.released).toEqual([]);
    shown = false;
    expect(await hub.open("a.md", host(), options)).toBeNull();
    await settled();
    expect(sessions.released).toEqual(["a.md"]);
    expect(hub.holds("a.md")).toBe(false);
  });

  it("un modulo che non arriva lascia la sessione presa per l'apertura", async () => {
    const sessions = fakeSessions();
    const hub = lazyCardEditorHub(() => Promise.reject(new Error("chunk mancante")), fakeWindow(sessions));
    await expect(hub.open("a.md", host(), options)).rejects.toThrow("chunk mancante");
    await settled();
    expect(sessions.released).toEqual(["a.md"]);
  });
});
