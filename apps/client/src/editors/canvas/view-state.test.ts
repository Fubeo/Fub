// Riaprire dove eri (N6 T36): la forma dello stato di vista `canvas.view:…`,
// i suoi limiti, la versione sconosciuta e lo stato rotto, la fila della
// memoria e il registratore con il suo ritardo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_VIEW_PAGES_MAX,
  CANVAS_VIEW_SELECTION_MAX,
  CANVAS_VIEW_WRITE_DELAY_MS,
  CanvasViewRecorder,
  canvasViewKey,
  createCanvasViewMemory,
  parseCanvasView,
  serializeCanvasView,
  type CanvasViewMemory,
  type CanvasViewSnapshot,
  type CanvasViewStore,
} from "./view-state";

const DOC = "Lavagne/studio.canvas";

/** Gli stati di vista in memoria, con ogni scrittura in ordine. */
function memoryStore(initial: Record<string, unknown> = {}) {
  const states = new Map<string, unknown>(Object.entries(initial));
  const writes: { key: string; value: unknown }[] = [];
  let failWrites = false;
  let failReads = false;
  const store: CanvasViewStore = {
    get: async (key) => {
      if (failReads) throw new Error("lettura negata");
      return states.get(key) ?? null;
    },
    set: async (key, value) => {
      if (failWrites) throw new Error("disco pieno");
      writes.push({ key, value });
      states.set(key, value);
    },
  };
  return {
    store,
    states,
    writes,
    failWrites: (on: boolean) => {
      failWrites = on;
    },
    failReads: (on: boolean) => {
      failReads = on;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("la forma dello stato", () => {
  it("la chiave nomina la lavagna", () => {
    expect(canvasViewKey(DOC)).toBe("canvas.view:Lavagne/studio.canvas");
  });

  it("legge camera, scelta e pagine della versione 1", () => {
    const read = parseCanvasView({
      version: 1,
      camera: { x: -120, y: 40.5, zoom: 0.8 },
      selection: ["a", "b"],
      pages: { p1: 3, p2: 1 },
    });
    expect(read.kind).toBe("state");
    if (read.kind !== "state") return;
    expect(read.view.camera).toEqual({ x: -120, y: 40.5, zoom: 0.8 });
    expect(read.view.selection).toEqual(["a", "b"]);
    expect([...read.view.pages]).toEqual([["p1", 3], ["p2", 1]]);
    expect(read.extra).toEqual({});
  });

  it("una versione che non conosce è di un'altra versione", () => {
    expect(parseCanvasView({ version: 2, camera: { x: 0, y: 0, zoom: 1 } }).kind).toBe("foreign");
    expect(parseCanvasView({ version: "1" }).kind).toBe("foreign");
    expect(parseCanvasView({ version: null }).kind).toBe("foreign");
  });

  it.each([null, undefined, 3, "testo", [], [1, 2], { camera: { x: 0, y: 0, zoom: 1 } }])(
    "uno stato rotto (%j) vale nessuno stato",
    (value) => {
      expect(parseCanvasView(value).kind).toBe("empty");
    },
  );

  it("nella versione 1 i campi sbagliati valgono vuoti e le voci sbagliate si saltano", () => {
    const read = parseCanvasView({
      version: 1,
      camera: { x: 0, y: Number.NaN, zoom: 1 },
      selection: ["a", 4, "", "a", null, "b"],
      pages: { p1: 0, p2: 2.5, p3: "4", p4: 6, "": 2 },
    });
    if (read.kind !== "state") throw new Error("atteso uno stato");
    expect(read.view.camera).toBeNull();
    expect(read.view.selection).toEqual(["a", "b"]);
    expect([...read.view.pages]).toEqual([["p4", 6]]);
    for (const camera of [{ x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: -1 }, { x: "0", y: 0, zoom: 1 }, [0, 0, 1]]) {
      const other = parseCanvasView({ version: 1, camera });
      expect(other.kind === "state" && other.view.camera).toBeNull();
    }
  });

  it("conserva i campi in più, e li riscrive", () => {
    const read = parseCanvasView({ version: 1, selection: [], pages: {}, snap: { open: true }, grid: 8 });
    if (read.kind !== "state") throw new Error("atteso uno stato");
    expect(read.extra).toEqual({ snap: { open: true }, grid: 8 });
    const written = serializeCanvasView({ camera: { x: 1, y: 2, zoom: 1.5 }, selection: ["n"], pages: new Map([["p", 2]]) }, read.extra);
    expect(written).toEqual({
      snap: { open: true },
      grid: 8,
      version: 1,
      camera: { x: 1, y: 2, zoom: 1.5 },
      selection: ["n"],
      pages: { p: 2 },
    });
  });

  it("«Nascondi il navigatore» si scrive solo spento, e si rilegge (T55)", () => {
    const hidden = parseCanvasView({ version: 1, selection: [], pages: {}, navigator: false });
    if (hidden.kind !== "state") throw new Error("atteso uno stato");
    expect(hidden.view.navigatorHidden).toBe(true);
    expect(hidden.extra).toEqual({});
    expect(serializeCanvasView(hidden.view)).toEqual({ version: 1, selection: [], pages: {}, navigator: false });
    // Acceso non si scrive; un valore che non è `false` vale acceso.
    for (const navigator of [true, "no", { open: false }, undefined]) {
      const read = parseCanvasView({ version: 1, navigator });
      if (read.kind !== "state") throw new Error("atteso uno stato");
      expect(read.view.navigatorHidden).toBeUndefined();
      expect(serializeCanvasView(read.view, read.extra)).toEqual({ version: 1, selection: [], pages: {} });
    }
  });

  it("i campi in più non coprono quelli di questo client", () => {
    const written = serializeCanvasView(
      { camera: null, selection: [], pages: new Map() },
      { version: 9, selection: ["x"], pages: { x: 3 }, camera: { x: 9, y: 9, zoom: 9 }, dark: { a: true } },
    );
    expect(written).toEqual({ dark: { a: true }, version: 1, selection: [], pages: {} });
  });

  it("si ricordano al più 500 schede scelte, le prime", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `n${i}`);
    const written = serializeCanvasView({ camera: null, selection: ids, pages: new Map() });
    expect(written.selection).toEqual(ids.slice(0, CANVAS_VIEW_SELECTION_MAX));
    const read = parseCanvasView({ version: 1, selection: ids });
    expect(read.kind === "state" && read.view.selection.length).toBe(CANVAS_VIEW_SELECTION_MAX);
  });

  it("si ricordano al più 1000 pagine, le più recenti", () => {
    const pages = new Map(Array.from({ length: 1200 }, (_, i) => [`p${i}`, i + 1] as const));
    const written = serializeCanvasView({ camera: null, selection: [], pages });
    const kept = Object.keys(written.pages as Record<string, number>);
    expect(kept.length).toBe(CANVAS_VIEW_PAGES_MAX);
    expect(kept[0]).toBe("p200");
    expect(kept[kept.length - 1]).toBe("p1199");
    const read = parseCanvasView({ version: 1, pages: Object.fromEntries(pages) });
    if (read.kind !== "state") throw new Error("atteso uno stato");
    expect(read.view.pages.size).toBe(CANVAS_VIEW_PAGES_MAX);
    expect(read.view.pages.has("p199")).toBe(false);
    expect(read.view.pages.get("p1199")).toBe(1200);
  });
});

describe("la memoria", () => {
  it("legge e scrive sotto la chiave della lavagna", async () => {
    const store = memoryStore();
    const memory = createCanvasViewMemory(store.store);
    await memory.write(DOC, { version: 1 });
    expect(store.states.get("canvas.view:Lavagne/studio.canvas")).toEqual({ version: 1 });
    expect(await memory.read(DOC)).toEqual({ version: 1 });
    expect(await memory.read("altra.canvas")).toBeNull();
  });

  it("una lettura aspetta le scritture chieste prima, anche lente", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const states = new Map<string, unknown>();
    const memory = createCanvasViewMemory({
      get: async (key) => states.get(key) ?? null,
      set: async (key, value) => {
        await slow;
        states.set(key, value);
      },
    });
    void memory.write(DOC, { version: 1, selection: ["chiusa"] });
    const read = memory.read(DOC);
    release();
    expect(await read).toEqual({ version: 1, selection: ["chiusa"] });
  });

  it("una scrittura che fallisce non ferma la fila", async () => {
    const store = memoryStore();
    const memory = createCanvasViewMemory(store.store);
    store.failWrites(true);
    await expect(memory.write(DOC, { version: 1 })).rejects.toThrow("disco pieno");
    store.failWrites(false);
    await memory.write(DOC, { version: 1, selection: ["dopo"] });
    expect(await memory.read(DOC)).toEqual({ version: 1, selection: ["dopo"] });
  });
});

describe("il registratore", () => {
  let view: { camera: { x: number; y: number; zoom: number }; selection: string[]; navigatorHidden?: boolean } | null;
  const snapshot = (): CanvasViewSnapshot => (view ? { camera: { ...view.camera }, selection: [...view.selection], navigatorHidden: view.navigatorHidden } : null);

  beforeEach(() => {
    vi.useFakeTimers();
    view = { camera: { x: 0, y: 0, zoom: 1 }, selection: [] };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function recorder(store: ReturnType<typeof memoryStore>, memory: CanvasViewMemory = createCanvasViewMemory(store.store)) {
    return new CanvasViewRecorder(memory, DOC, snapshot);
  }

  it("dà la vista ricordata e le sue pagine", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: { version: 1, camera: { x: 5, y: 6, zoom: 2 }, selection: ["a"], pages: { p: 4 } } });
    const memo = recorder(store);
    const read = await memo.begin();
    expect(read?.camera).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(read?.selection).toEqual(["a"]);
    expect(memo.page("p")).toBe(4);
    expect(memo.page("q")).toBeNull();
  });

  it("senza stato dà null, e la prima scrittura lo crea", async () => {
    const store = memoryStore();
    const memo = recorder(store);
    expect(await memo.begin()).toBeNull();
    view!.camera = { x: 10, y: 20, zoom: 0.5 };
    memo.changed();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    expect(store.writes).toEqual([{ key: canvasViewKey(DOC), value: { version: 1, camera: { x: 10, y: 20, zoom: 0.5 }, selection: [], pages: {} } }]);
  });

  it("scrive 500 ms dopo l'ultimo cambio, una volta", async () => {
    const store = memoryStore();
    const memo = recorder(store);
    await memo.begin();
    for (let i = 1; i <= 5; i++) {
      view!.camera = { x: i, y: 0, zoom: 1 };
      memo.changed();
      await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS - 100);
    }
    expect(store.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(store.writes.length).toBe(1);
    expect((store.writes[0]!.value as { camera: unknown }).camera).toEqual({ x: 5, y: 0, zoom: 1 });
    // Lo stesso stato non si riscrive.
    memo.changed();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    expect(store.writes.length).toBe(1);
  });

  it("lo stato letto non si riscrive uguale", async () => {
    const stored = { version: 1, camera: { x: 0, y: 0, zoom: 1 }, selection: [], pages: {} };
    const store = memoryStore({ [canvasViewKey(DOC)]: stored });
    const memo = recorder(store);
    await memo.begin();
    memo.changed();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    expect(store.writes).toEqual([]);
  });

  it("prima che la lettura arrivi non scrive niente, nemmeno chiudendo", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: { version: 1, camera: { x: 7, y: 7, zoom: 1 } } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memo = recorder(store, {
      read: async (doc) => {
        await gate;
        return store.store.get(canvasViewKey(doc));
      },
      write: (doc, value) => store.store.set(canvasViewKey(doc), value),
    });
    const reading = memo.begin();
    memo.changed();
    memo.close();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    release();
    // La lettura arrivata dopo la chiusura non vale più.
    expect(await reading).toBeNull();
    expect(store.writes).toEqual([]);
  });

  it("alla chiusura scrive subito l'ultimo stato, e dopo più niente", async () => {
    const store = memoryStore();
    const memo = recorder(store);
    await memo.begin();
    view!.selection = ["a", "b"];
    memo.changed();
    memo.close();
    await settle();
    expect(store.writes.length).toBe(1);
    expect((store.writes[0]!.value as { selection: unknown }).selection).toEqual(["a", "b"]);
    view!.selection = ["c"];
    memo.changed();
    memo.pageChanged("p", 3);
    memo.flush();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS * 2);
    expect(store.writes.length).toBe(1);
    expect(await memo.begin()).toBeNull();
  });

  it("una versione che non conosce si ignora e non si riscrive mai", async () => {
    const foreign = { version: 2, camera: { x: 1, y: 1, zoom: 1 }, nuovo: true };
    const store = memoryStore({ [canvasViewKey(DOC)]: foreign });
    const memo = recorder(store);
    expect(await memo.begin()).toBeNull();
    view!.camera = { x: 50, y: 50, zoom: 2 };
    memo.changed();
    memo.pageChanged("p", 2);
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    memo.close();
    await settle();
    expect(store.writes).toEqual([]);
    expect(store.states.get(canvasViewKey(DOC))).toEqual(foreign);
    // La pagina voltata vale lo stesso per questa apertura.
    expect(memo.page("p")).toBe(2);
  });

  it("uno stato rotto vale nessuno stato, e si sostituisce", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: "non è uno stato" });
    const memo = recorder(store);
    expect(await memo.begin()).toBeNull();
    memo.changed();
    memo.close();
    await settle();
    expect(store.states.get(canvasViewKey(DOC))).toEqual({ version: 1, camera: { x: 0, y: 0, zoom: 1 }, selection: [], pages: {} });
  });

  it("riscrivendo conserva i campi in più della versione 1", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: { version: 1, selection: [], pages: {}, snap: { open: false }, dark: { a: true } } });
    const memo = recorder(store);
    await memo.begin();
    view!.camera = { x: 3, y: 4, zoom: 1 };
    memo.changed();
    memo.close();
    await settle();
    expect(store.states.get(canvasViewKey(DOC))).toEqual({
      snap: { open: false },
      dark: { a: true },
      version: 1,
      camera: { x: 3, y: 4, zoom: 1 },
      selection: [],
      pages: {},
    });
  });

  it("il navigatore spento torna all'apertura e si ricorda col resto (T55)", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: { version: 1, selection: [], pages: {}, navigator: false } });
    const memo = recorder(store);
    expect((await memo.begin())?.navigatorHidden).toBe(true);
    view = { camera: { x: 1, y: 1, zoom: 1 }, selection: [] };
    memo.changed();
    memo.close();
    await settle();
    // Riacceso: il campo sparisce.
    expect(store.states.get(canvasViewKey(DOC))).toEqual({ version: 1, camera: { x: 1, y: 1, zoom: 1 }, selection: [], pages: {} });
    const again = recorder(store);
    await again.begin();
    view = { camera: { x: 1, y: 1, zoom: 1 }, selection: [], navigatorHidden: true };
    again.changed();
    again.close();
    await settle();
    expect(store.states.get(canvasViewKey(DOC))).toEqual({ version: 1, camera: { x: 1, y: 1, zoom: 1 }, selection: [], pages: {}, navigator: false });
  });

  it("le pagine: la più recente va in fondo, e quelle voltate mentre si leggeva vincono", async () => {
    const store = memoryStore({ [canvasViewKey(DOC)]: { version: 1, pages: { a: 2, b: 5, c: 1 } } });
    const memo = recorder(store);
    const reading = memo.begin();
    memo.pageChanged("b", 9);
    await reading;
    expect(memo.page("b")).toBe(9);
    memo.pageChanged("a", 3);
    memo.pageChanged("x", 0);
    memo.close();
    await settle();
    const written = store.states.get(canvasViewKey(DOC)) as { pages: Record<string, number> };
    expect(Object.entries(written.pages)).toEqual([["c", 1], ["b", 9], ["a", 3]]);
  });

  it("una scrittura che fallisce lascia una riga nel registro e la lavagna va avanti", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    const memo = recorder(store);
    await memo.begin();
    store.failWrites(true);
    view!.camera = { x: 1, y: 1, zoom: 1 };
    memo.changed();
    await vi.advanceTimersByTimeAsync(CANVAS_VIEW_WRITE_DELAY_MS);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    // La prossima scrittura riprova, anche con lo stesso stato.
    store.failWrites(false);
    memo.changed();
    memo.close();
    await settle();
    expect(store.writes.length).toBe(1);
  });

  it("una lettura che fallisce: si parte come oggi e non si scrive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    store.failReads(true);
    const memo = recorder(store);
    expect(await memo.begin()).toBeNull();
    memo.changed();
    memo.close();
    await settle();
    expect(store.writes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("senza nulla da mostrare non scrive", async () => {
    const store = memoryStore();
    const memo = recorder(store);
    await memo.begin();
    view = null;
    memo.changed();
    memo.close();
    await settle();
    expect(store.writes).toEqual([]);
  });

  it("una nuova apertura scrive prima lo stato di quella di prima, e la lettura vecchia non vale", async () => {
    const store = memoryStore();
    const memo = recorder(store);
    await memo.begin();
    view!.selection = ["prima"];
    memo.changed();
    const first = memo.begin();
    const second = memo.begin();
    expect(await first).toBeNull();
    expect((await second)?.selection).toEqual(["prima"]);
  });

  it("due lavagne aperte sullo stesso file: vince l'ultima scrittura, senza errori", async () => {
    const store = memoryStore();
    const memory = createCanvasViewMemory(store.store);
    const a = recorder(store, memory);
    const b = recorder(store, memory);
    await a.begin();
    await b.begin();
    view!.selection = ["da-a"];
    a.changed();
    a.close();
    view!.selection = ["da-b"];
    b.changed();
    b.close();
    await settle();
    expect((store.states.get(canvasViewKey(DOC)) as { selection: unknown }).selection).toEqual(["da-b"]);
  });
});
