import { describe, expect, it, vi } from "vitest";
import { createLinkTargetHub, type LinkTargetQueries } from "./link-targets";

// UX-016: quali wikilink portano a una nota che non c'è. Le domande partono
// insieme, una per link nuovo; un errore dell'indice non dice «manca»; a un
// cambio dell'indice si richiedono soltanto i link che mancavano.

function setup(exists: Set<string>) {
  let now = 1_000;
  let vault: string | null = "/v";
  const resolve = vi.fn(async (page: string, _from: string | undefined) => (exists.has(page) ? `${page}.md` : null));
  const queries: LinkTargetQueries = { resolve, vault: () => vault, now: () => now };
  const hub = createLinkTargetHub(queries);
  const changed = vi.fn();
  hub.watch(changed);
  return {
    hub, resolve, changed,
    tick: (ms: number) => { now += ms; },
    close: () => { vault = null; },
  };
}

describe("i link alle note che non ci sono", () => {
  it("non dice «manca» prima della risposta, poi sì, con un avviso solo", async () => {
    const { hub, resolve, changed } = setup(new Set(["Nota B"]));
    expect(hub.missing("Nota B", "a.md")).toBe(false);
    expect(hub.missing("Inesistente", "a.md")).toBe(false);
    await hub.settled();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(hub.missing("Nota B", "a.md")).toBe(false);
    expect(hub.missing("Inesistente", "a.md")).toBe(true);
    // Chiesto di nuovo non rifà la domanda.
    await hub.settled();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("lo stesso nome da due note si chiede due volte: le cartelle contano", async () => {
    const { hub, resolve } = setup(new Set());
    hub.missing("X", "a/uno.md");
    hub.missing("X", "b/due.md");
    await hub.settled();
    expect(resolve.mock.calls.map(([page, from]) => [page, from])).toEqual([["X", "a/uno.md"], ["X", "b/due.md"]]);
  });

  it("un indice che non risponde lascia il link come si mostrava", async () => {
    const { hub, resolve, changed } = setup(new Set());
    resolve.mockRejectedValueOnce(new Error("giù"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    hub.missing("Y", "a.md");
    await hub.settled();
    quiet.mockRestore();
    expect(hub.missing("Y", "a.md")).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    // Il prossimo cambio dell'indice la richiede.
    hub.refresh();
    await hub.settled();
    expect(hub.missing("Y", "a.md")).toBe(true);
  });

  it("una nota creata fa esistere il link al cambio dell'indice; quelli che c'erano non si richiedono", async () => {
    const exists = new Set(["C'è"]);
    const { hub, resolve, changed } = setup(exists);
    hub.missing("C'è", "a.md");
    hub.missing("Nuova", "a.md");
    await hub.settled();
    resolve.mockClear();
    changed.mockClear();
    exists.add("Nuova");
    hub.refresh();
    await hub.settled();
    expect(resolve.mock.calls.map(([page]) => page)).toEqual(["Nuova"]);
    expect(hub.missing("Nuova", "a.md")).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("una nota tolta o spostata richiede tutti i link recenti, non i vecchi", async () => {
    const exists = new Set(["A", "B"]);
    const { hub, resolve, tick } = setup(exists);
    hub.missing("A", "n.md");
    await hub.settled();
    tick(11 * 60_000);
    hub.missing("B", "n.md");
    await hub.settled();
    resolve.mockClear();
    exists.delete("B");
    hub.moved();
    await hub.settled();
    expect(resolve.mock.calls.map(([page]) => page)).toEqual(["B"]);
    expect(hub.missing("B", "n.md")).toBe(true);
  });

  it("un vault nuovo dimentica tutto, e una risposta del vault di prima non entra", async () => {
    const { hub, changed, resolve } = setup(new Set());
    hub.missing("Z", "a.md");
    await hub.settled();
    expect(hub.missing("Z", "a.md")).toBe(true);
    changed.mockClear();
    hub.forget();
    expect(changed).toHaveBeenCalledTimes(1);
    let release!: () => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { release = () => done(null); }));
    expect(hub.missing("Z", "a.md")).toBe(false);
    await Promise.resolve();
    hub.forget();
    release();
    await hub.settled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("senza vault non chiede niente", async () => {
    const { hub, resolve, close } = setup(new Set());
    close();
    hub.missing("W", "a.md");
    await hub.settled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
