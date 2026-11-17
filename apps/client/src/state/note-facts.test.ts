// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KernelEvent, KernelNotice } from "../host/contract";

// Le letture vere passano dal canale dati: qui le si sostituisce per vedere
// che cosa chiedono.
const fake = vi.hoisted(() => ({
  tags: vi.fn(async (_doc: string): Promise<string[]> => []),
  links: vi.fn(async (_doc: string): Promise<number> => 0),
  entries: vi.fn(async (..._args: unknown[]) => ({ items: [] as { id: string; mtime: number }[], offset: 0, total: 0 })),
}));
vi.mock("../host/query", () => ({
  noteTags: fake.tags,
  backlinkCount: fake.links,
  vaultEntries: fake.entries,
}));

import { forwardNotice } from "./kernel";
import { emit } from "./store";
import {
  ENTRIES_WINDOW,
  followNoteFacts,
  INDEX_PORTS,
  INDEX_WATCH,
  modifiedFromEntries,
  noFacts,
  readNoteFacts,
  sameFacts,
  type NoteFacts,
  type NoteFactsPorts,
} from "./note-facts";

function notice(event: KernelEvent): KernelNotice {
  return { event, origin: { actor: { kind: "kernel" }, batch: null } };
}

/// Una promessa che si risolve quando lo dice il test.
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

function ports(over: Partial<NoteFactsPorts> = {}): NoteFactsPorts {
  return {
    tags: async () => ["tema", "banco"],
    links: async () => 3,
    modified: async () => 1_000,
    ...over,
  };
}

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
  vi.clearAllMocks();
});

describe("i tre dati di una nota", () => {
  it("modificata, collegamenti ed etichette, letti insieme", async () => {
    expect(await readNoteFacts("Benvenuto.md", ports())).toEqual({ modified: 1_000, links: 3, tags: ["tema", "banco"] });
  });

  it("una lettura che fallisce lascia vuota la sua parte, e le altre restano", async () => {
    const facts = await readNoteFacts("Benvenuto.md", ports({
      links: async () => { throw new Error("niente backlink"); },
      modified: async () => { throw new Error("niente anagrafe"); },
    }));
    expect(facts).toEqual({ modified: null, links: 0, tags: ["tema", "banco"] });
  });

  it("le parti vuote: una nota senza niente non ha riga, una con la sola data sì", () => {
    expect(noFacts({ modified: null, links: 0, tags: [] })).toBe(true);
    expect(noFacts({ modified: 5, links: 0, tags: [] })).toBe(false);
    expect(noFacts({ modified: null, links: 0, tags: ["a"] })).toBe(false);
    expect(sameFacts({ modified: 1, links: 2, tags: ["a"] }, { modified: 1, links: 2, tags: ["a"] })).toBe(true);
    expect(sameFacts({ modified: 1, links: 2, tags: ["a"] }, { modified: 1, links: 2, tags: ["b"] })).toBe(false);
  });

  it("le porte vere: etichette e collegamenti dall'indice, la data dall'anagrafe della cartella", async () => {
    fake.tags.mockResolvedValueOnce(["tema"]);
    fake.links.mockResolvedValueOnce(2);
    fake.entries.mockResolvedValueOnce({ items: [{ id: "Guida/Altra.md", mtime: 1 }, { id: "Guida/Nota.md", mtime: 42 }], offset: 0, total: 2 });
    expect(await readNoteFacts("Guida/Nota.md", INDEX_PORTS)).toEqual({ modified: 42, links: 2, tags: ["tema"] });
    expect(fake.tags).toHaveBeenCalledWith("Guida/Nota.md");
    expect(fake.links).toHaveBeenCalledWith("Guida/Nota.md");
    expect(fake.entries).toHaveBeenCalledWith(ENTRIES_WINDOW, "document", { path: "Guida", descendants: false });
    expect(ENTRIES_WINDOW).toEqual({ offset: 0, limit: 1000 });
  });

  it("una nota fuori dall'anagrafe (appena arrivata, mai salvata) non ha data", async () => {
    fake.entries.mockResolvedValueOnce({ items: [{ id: "Altra.md", mtime: 1 }], offset: 0, total: 1 });
    expect(await modifiedFromEntries("Nuova.md")).toBeNull();
    expect(fake.entries).toHaveBeenCalledWith(ENTRIES_WINDOW, "document", { path: "", descendants: false });
    // Un tempo a zero non è una data: il disco non l'ha detta.
    fake.entries.mockResolvedValueOnce({ items: [{ id: "Zero.md", mtime: 0 }], offset: 0, total: 1 });
    expect(await modifiedFromEntries("Zero.md")).toBeNull();
  });
});

describe("chi segue i dati", () => {
  it("un giro nuovo supera il vecchio: la risposta vecchia, arrivata dopo, non scrive", async () => {
    const slow = deferred<number>();
    const fast = deferred<number>();
    const answers = [slow, fast];
    let again = (): void => {};
    const drawn: NoteFacts[] = [];
    stops.push(followNoteFacts(
      () => "Benvenuto.md",
      (facts) => drawn.push(facts),
      ports({ links: () => answers.shift()!.promise }),
      (_doc, trigger) => {
        again = trigger;
        return () => {};
      },
    ));
    again();
    fast.resolve(7);
    await flush();
    slow.resolve(1);
    await flush();
    expect(drawn.map((facts) => facts.links)).toEqual([7]);
  });

  it("la nota rinominata mentre la lettura gira: vale l'ultima", async () => {
    let doc = "Vecchia.md";
    const first = deferred<number>();
    const asked: string[] = [];
    let again = (): void => {};
    const drawn: number[] = [];
    stops.push(followNoteFacts(
      () => doc,
      (facts) => drawn.push(facts.links),
      ports({
        links: (id) => {
          asked.push(id);
          return id === "Vecchia.md" ? first.promise : Promise.resolve(9);
        },
      }),
      (_doc, trigger) => {
        again = trigger;
        return () => {};
      },
    ));
    doc = "Nuova.md";
    again();
    await flush();
    first.resolve(1);
    await flush();
    expect(asked).toEqual(["Vecchia.md", "Nuova.md"]);
    expect(drawn).toEqual([9]);
  });

  it("smontato, una risposta in volo non scrive e le occasioni non rileggono", async () => {
    const late = deferred<number>();
    const read = vi.fn(() => late.promise);
    let again = (): void => {};
    const unwatch = vi.fn();
    const drawn = vi.fn();
    const stop = followNoteFacts(() => "Benvenuto.md", drawn, ports({ links: read }), (_doc, trigger) => {
      again = trigger;
      return unwatch;
    });
    stop();
    late.resolve(3);
    again();
    await flush();
    expect(drawn).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("si rilegge all'apertura, al salvataggio della nota e al segnale documents; mai a ogni battuta", async () => {
    const read = vi.fn(async () => 3);
    const drawn = vi.fn();
    stops.push(followNoteFacts(() => "Benvenuto.md", drawn, ports({ links: read }), INDEX_WATCH));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    // Le battute non sono eventi del kernel: un'altra nota scritta non conta.
    forwardNotice(notice({ type: "document_changed", id: "Altra.md" }));
    forwardNotice(notice({ type: "index_updated" }));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    // Il salvataggio riuscito: il kernel ha scritto la nota.
    forwardNotice(notice({ type: "document_changed", id: "Benvenuto.md" }));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    // Dentro un lotto, la nota fra quelle toccate.
    forwardNotice(notice({ type: "batch_ended", batch: "1", changed: ["Benvenuto.md"] }));
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    emit("documents");
    await flush();
    expect(read).toHaveBeenCalledTimes(4);
    expect(drawn).toHaveBeenCalledTimes(4);
  });
});
