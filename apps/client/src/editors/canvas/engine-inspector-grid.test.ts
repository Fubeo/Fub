// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: l'ispettore (T59), il selettore delle sezioni (T74), griglia e guide (T71).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import { canvasCoreReady } from "./wasm/core";
import { DEFAULT_PREFERENCES, type CanvasPreferences } from "./preferences";
import { CARD_PANEL_ID, createCanvasInspector } from "./chrome/inspector";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { canvasSource, mounted, readCanvas } from "./engine-test-support";

// Le impostazioni della lavagna (T35): il motore monta `watchPreferences`, e la
// prova tiene le sue funzioni per cambiare «La rotella del mouse» a lavagna
// aperta, come farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// Le notifiche della shell (T70, «Estrai in una nota»): la prova legge che
// cosa dicono e quale gesto offrono. Il resto del modulo è quello vero.
const notices = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/notify")>()),
  notify: notices.notify,
}));

// Il nucleo si carica una volta: dopo, la tela si apre subito.
beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("l'ispettore sul motore (T59)", () => {
  it("una modifica da «Avanzate» si annulla con gli stessi byte di prima", () => {
    const { engine } = mounted();
    const before = engine.getDoc();
    const byteOf = (needle: string) => new TextEncoder().encode(before.slice(0, before.indexOf(needle))).length;
    // Scegliere una scheda dal sorgente la sceglie anche per l'ispettore.
    expect(engine.revealSource(byteOf('{"id":"t"'))).toBe(true);
    expect(engine.selection()).toEqual({ nodes: ["t"], edges: [] });
    const inspector = createCanvasInspector({
      source: () => engine.getDoc(),
      reveal: () => false,
      edit: {
        selection: () => engine.selection(),
        doc: () => engine.doc(),
        commit: (patches) => engine.commitPatches(patches),
        readOnly: () => false,
      },
    });
    inspector.offer(true);
    const panel = inspector.panels.list().find((each) => each.id === CARD_PANEL_ID)!;
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = panel.mount(host);
    host.querySelector<HTMLButtonElement>(".canvas-inspector-disclosure")!.click();
    const x = [...host.querySelectorAll<HTMLTableRowElement>(".canvas-inspector-raw tr")]
      .find((row) => row.querySelector("th")?.textContent === "x")!
      .querySelector<HTMLInputElement>("input")!;
    x.value = "300";
    x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(engine.doc()!.nodes.find((node) => node.id === "t")!.x).toBe(300);
    expect(engine.getDoc()).not.toBe(before);
    // Un commit solo: un annulla riporta il testo di prima, byte per byte, e poi non ce n'è un altro.
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    expect(engine.undo()).toBe(false);
    unmount();
  });
});

describe("il selettore delle sezioni (T74)", () => {
  const NOTE = "Note/Relazione.md";
  const HEADINGS = [
    { level: 1, text: "Relazione" },
    { level: 2, text: "Scopo" },
    { level: 2, text: "Misure" },
    { level: 2, text: "Calcoli" },
  ];

  function setup(overrides: Partial<CanvasEngineOptions> = {}, headings = HEADINGS, paths = [NOTE]) {
    const outline = vi.fn(async (_path: string) => headings);
    const show = vi.fn(async (_path: string, heading: string | null, host: HTMLElement) => {
      host.textContent = heading ?? "";
    });
    const made = mounted(canvasSource(), {
      attachments: { deposit: vi.fn(), resolvePaths: async () => paths },
      parts: { outline, show },
      ...overrides,
    });
    return { ...made, outline, show };
  }

  function drop(host: HTMLElement, alt = false): void {
    const data = { files: [], items: [], types: [], getData: () => "" } as unknown as DataTransfer;
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: 200 }, clientY: { value: 120 }, altKey: { value: alt } });
    host.querySelector<HTMLElement>(".canvas-viewport")!.dispatchEvent(event);
  }

  const picker = (): HTMLElement | null => document.querySelector<HTMLElement>(".canvas-parts-picker");
  const field = (): HTMLInputElement => picker()!.querySelector<HTMLInputElement>(".canvas-parts-field > input")!;
  const row = (name: string): HTMLElement =>
    [...picker()!.querySelectorAll<HTMLElement>(".canvas-parts-row")].find((one) => one.textContent === name)!;
  const born = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes.find((node) => node.file === NOTE);
  const enter = (): void => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  /** Il tasto destro sulla scheda `id`: la sceglie e torna il menu. */
  const menuOn = (engine: CanvasEngine, host: HTMLElement, id: string) => {
    const element = host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  };

  async function dropped(made: ReturnType<typeof setup>): Promise<void> {
    drop(made.host);
    await vi.waitFor(() => expect(picker()).not.toBeNull());
  }

  it("rilasciando una nota con più titoli la scheda nasce intera e accanto si apre il selettore, col campo pronto", async () => {
    const made = setup();
    await dropped(made);
    expect(made.changes).toHaveLength(1);
    expect(born(made.engine)?.subpath).toBeUndefined();
    expect(made.outline).toHaveBeenCalledWith(NOTE);
    expect(picker()!.querySelector(".canvas-parts-title")!.textContent).toBe(t("canvas.parts.title", { name: "Relazione" }));
    expect([...picker()!.querySelectorAll(".canvas-parts-row")].map((one) => one.textContent)).toEqual(["Relazione", "Scopo", "Misure", "Calcoli"]);
    expect(document.activeElement).toBe(field());
    made.engine.destroy();
    expect(picker()).toBeNull();
  });

  it("Esc, la crocetta o un clic fuori tengono tutta la nota: niente cambia", async () => {
    const made = setup();
    await dropped(made);
    const before = made.engine.getDoc();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(picker()).toBeNull();
    expect(made.engine.getDoc()).toBe(before);
    // «Parti…» lo riapre; la crocetta e un clic fuori lo chiudono allo stesso modo.
    menuOn(made.engine, made.host, born(made.engine)!.id);
    const command = made.engine.commands().find((one) => one.id === "canvas.parts")!;
    expect(command.disabled()).toBeNull();
    command.run();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    picker()!.querySelector<HTMLButtonElement>(".canvas-parts-close")!.click();
    expect(picker()).toBeNull();
    command.run();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(picker()).toBeNull();
    expect(made.engine.getDoc()).toBe(before);
    expect(made.changes).toHaveLength(1);
    made.engine.destroy();
  });

  it("Alt tenuto al rilascio salta il selettore", async () => {
    const made = setup();
    drop(made.host, true);
    await vi.waitFor(() => expect(made.changes).toHaveLength(1));
    await Promise.resolve();
    expect(made.outline).not.toHaveBeenCalled();
    expect(picker()).toBeNull();
    made.engine.destroy();
  });

  it("«Selettore delle parti» spento nelle Impostazioni: la scheda nasce intera e basta", async () => {
    const made = setup();
    for (const apply of watched.appliers) apply({ ...DEFAULT_PREFERENCES, partsPicker: false });
    drop(made.host);
    await vi.waitFor(() => expect(made.changes).toHaveLength(1));
    await Promise.resolve();
    expect(made.outline).not.toHaveBeenCalled();
    expect(picker()).toBeNull();
    made.engine.destroy();
  });

  it("niente selettore per una nota con un titolo solo, per più file insieme e senza la porta del sommario", async () => {
    const one = setup({}, [{ level: 1, text: "Solo" }]);
    drop(one.host);
    await vi.waitFor(() => expect(one.outline).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker()).toBeNull();
    // Il sommario letto spegne «Parti…», col perché.
    menuOn(one.engine, one.host, born(one.engine)!.id);
    expect(one.engine.commands().find((command) => command.id === "canvas.parts")!.disabled()).toBe(t("canvas.commands.why.no_sections"));
    one.engine.destroy();
    const many = setup({}, HEADINGS, [NOTE, "Note/Altra.md"]);
    drop(many.host);
    await vi.waitFor(() => expect(many.changes).toHaveLength(1));
    await Promise.resolve();
    expect(many.outline).not.toHaveBeenCalled();
    many.engine.destroy();
    const bare = mounted(canvasSource(), { attachments: { deposit: vi.fn(), resolvePaths: async () => [NOTE] } });
    expect(bare.engine.commands().some((command) => command.id === "canvas.parts")).toBe(false);
    bare.engine.destroy();
  });

  it("una sezione scrive il solo `subpath`, due anche `fub:parts` come dice canvas-parts.md; «Parti…» riapre con le sezioni di adesso; ogni scelta è un annulla", async () => {
    const made = setup();
    await dropped(made);
    row("Misure").click();
    expect(picker()!.querySelector(".kit-button")!.textContent).toBe(t("canvas.parts.put_section"));
    enter();
    expect(picker()).toBeNull();
    expect(made.changes).toHaveLength(2);
    const one = born(made.engine)!;
    expect(one.subpath).toBe("#Misure");
    expect(Object.prototype.hasOwnProperty.call(one, "fub:parts")).toBe(false);

    // «Parti…» dal menu della scheda, per prima: le sezioni di adesso già spuntate.
    const menu = menuOn(made.engine, made.host, one.id);
    const entry = (menu.context ?? [])[0] as SurfaceMenuItem;
    expect(entry.id).toBe("canvas.parts");
    expect(entry.label).toBe(t("canvas.parts"));
    entry.run!();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    expect(row("Misure").getAttribute("aria-selected")).toBe("true");
    expect(row("Scopo").getAttribute("aria-selected")).toBe("false");
    row("Scopo").click();
    expect(picker()!.querySelector(".kit-button")!.textContent).toBe(t("canvas.parts.put_sections", { n: 2 }));
    enter();
    const two = born(made.engine)!;
    // Nell'ordine della nota; il `subpath` è la prima.
    expect(two.subpath).toBe("#Scopo");
    expect(two["fub:parts"]).toEqual({ kind: "sections", sections: ["Scopo", "Misure"] });
    expect(made.engine.getDoc()).toContain('"subpath":"#Scopo"');
    expect(made.engine.getDoc()).toContain('"fub:parts":{"kind":"sections","sections":["Scopo","Misure"]}');
    expect(made.changes).toHaveLength(3);

    // Ogni scelta è un passo: la sezione sola, la nota intera, il vuoto.
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)!.subpath).toBe("#Misure");
    expect(made.engine.undo()).toBe(true);
    const whole = born(made.engine)!;
    expect(whole.subpath).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(whole, "fub:parts")).toBe(false);
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)).toBeUndefined();
    made.engine.destroy();
  });

  it("Invio subito dopo il rilascio scrive le sezioni in un solo commit: un annulla riporta la nota intera, un altro toglie la scheda", async () => {
    const made = setup();
    await dropped(made);
    row("Scopo").click();
    row("Calcoli").click();
    enter();
    expect(made.changes).toHaveLength(2);
    expect(born(made.engine)!["fub:parts"]).toEqual({ kind: "sections", sections: ["Scopo", "Calcoli"] });
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)!.subpath).toBeUndefined();
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)).toBeUndefined();
    made.engine.destroy();
  });

  it("la scheda annullata col selettore aperto lo chiude, e in sola lettura «Parti…» è spento", async () => {
    const made = setup();
    await dropped(made);
    expect(made.engine.undo()).toBe(true);
    expect(picker()).toBeNull();
    expect(made.engine.redo()).toBe(true);
    menuOn(made.engine, made.host, born(made.engine)!.id);
    made.engine.setReadOnly(true);
    expect(made.engine.commands().find((command) => command.id === "canvas.parts")!.disabled()).toBe(t("canvas.commands.why.read_only"));
    made.engine.destroy();
  });
});

describe("CanvasEngine: la griglia e le guide (T71)", () => {
  afterEach(() => {
    setReducedMotionPreference(false);
    vi.restoreAllMocks();
    applyPreferences({});
  });

  /** `t` ferma in alto a sinistra (40, 40, 240 × 160), `m` da spostare più in basso. */
  function guideBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 160, text: "ferma" },
        { id: "m", type: "text", x: 100, y: 300, width: 100, height: 60, text: "mossa" },
      ],
      edges: [],
    });
  }

  /** Tre schede in fila (`p`, `q` con uno spazio di 160), e `m` sotto, da portare nel posto dopo `q`. */
  function rowBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "p", type: "text", x: 40, y: 300, width: 100, height: 60, text: "uno" },
        { id: "q", type: "text", x: 300, y: 300, width: 100, height: 60, text: "due" },
        { id: "m", type: "text", x: 100, y: 440, width: 60, height: 60, text: "tre" },
      ],
      edges: [],
    });
  }

  /** `t` (40, 40, 240 × 160) e `f` a destra (404, 300): il lato destro di `t` s'aggancia a `f`. */
  function edgeBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 160, text: "ferma" },
        { id: "f", type: "text", x: 404, y: 300, width: 240, height: 140, text: "vicina" },
      ],
      edges: [],
    });
  }

  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const gridOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-grid")!;
  const guidesOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".canvas-guide")];
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  const zoomOf = (host: HTMLElement): number => Number(/scale\(([\d.e+-]+)\)/.exec(host.querySelector<HTMLElement>(".canvas-stage")!.style.transform)![1]);

  /** La vista misura 800 × 600 a partire da (0, 0): happy-dom non dispone niente. */
  function sized(host: HTMLElement): void {
    vi.spyOn(viewportOf(host), "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
  }

  /** La lavagna al 100% subito (movimento ridotto): l'unità della lavagna è un pixel. */
  function atHundred(host: HTMLElement): void {
    setReducedMotionPreference(true);
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBe(1);
  }

  function pointer(target: EventTarget, type: string, init: PointerEventInit): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse", ...init }));
  }

  /** Le impostazioni cambiate a lavagna aperta, come da «Impostazioni» (T35). */
  function applyPreferences(patch: Partial<CanvasPreferences>): void {
    for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, ...patch });
  }

  /**
   * Trascina la scheda `id` di (dx, dy) unità (a zoom 1) dalla sua maniglia; lasciata lì se
   * `release` è falso. Alt sul premere è il trascinamento della vista (T53): i tasti del gesto
   * stanno sul movimento e sul rilascio.
   */
  function moveCard(host: HTMLElement, id: string, dx: number, dy: number, keys: PointerEventInit = {}, release = true): void {
    const handle = card(host, id).querySelector<HTMLElement>(".canvas-node-handle")!;
    pointer(handle, "pointerdown", { clientX: 500, clientY: 500 });
    pointer(viewportOf(host), "pointermove", { clientX: 500 + dx, clientY: 500 + dy, ...keys });
    if (release) releaseAt(host, dx, dy, keys);
  }

  function releaseAt(host: HTMLElement, dx: number, dy: number, init: PointerEventInit = {}): void {
    pointer(viewportOf(host), "pointerup", { clientX: 500 + dx, clientY: 500 + dy, ...init });
  }

  /** Tira l'angolo `corner` di `id` di (dx, dy) unità (a zoom 1), senza rilasciarlo: il rilascio lo fa il chiamante. */
  function pullCorner(host: HTMLElement, id: string, corner: string, dx: number, dy: number): void {
    const grip = card(host, id).querySelector<HTMLElement>(`.canvas-resize[data-corner="${corner}"]`)!;
    pointer(grip, "pointerdown", { clientX: 100, clientY: 100, buttons: 1, pointerId: 7 });
    pointer(viewportOf(host), "pointermove", { clientX: 100 + dx, clientY: 100 + dy, buttons: 1, pointerId: 7 });
  }

  it("una scheda che si sposta s'aggancia al bordo di un'altra, non alla griglia, e la guida si vede mentre tira", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    // Il bordo sinistro di `m` va a 45: la griglia darebbe 48, il bordo di `t` è 40.
    moveCard(host, "m", -55, 0, {}, false);
    expect(guidesOf(host).some((line) => line.dataset.kind === "edge" && line.dataset.axis === "v")).toBe(true);
    releaseAt(host, -55, 0);
    expect(nodeOf(engine, "m").x).toBe(40);
    expect(guidesOf(host)).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, "m").x).toBe(100);
    engine.destroy();
  });

  it("il centro della scheda s'allinea al centro di un'altra, e la guida è di centro", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    // Il centro di `m` va a 162, a 2 unità dal centro di `t` (160): la griglia darebbe 112.
    moveCard(host, "m", 12, 0, {}, false);
    expect(guidesOf(host).some((line) => line.dataset.kind === "center")).toBe(true);
    releaseAt(host, 12, 0);
    expect(nodeOf(engine, "m").x).toBe(110);
    engine.destroy();
  });

  it("uno spazio uguale fra tre schede in fila si mostra con due segni, e porta la scheda al suo posto", () => {
    const { engine, host } = mounted(rowBoard());
    sized(host);
    atHundred(host);
    // Lo spazio fra `p` e `q` è 160: dopo `q` la scheda va a 560. Il bordo va a 565.
    moveCard(host, "m", 465, -140, {}, false);
    expect(guidesOf(host).filter((line) => line.dataset.kind === "gap")).toHaveLength(2);
    releaseAt(host, 465, -140);
    expect(nodeOf(engine, "m")).toMatchObject({ x: 560, y: 300 });
    engine.destroy();
  });

  it("tirando l'angolo di una scheda, il lato che tira s'aggancia a una scheda vicina", () => {
    const { engine, host } = mounted(edgeBoard());
    sized(host);
    atHundred(host);
    // Il lato destro di `t` va a 402, a 2 unità dal bordo di `f` (404).
    pullCorner(host, "t", "se", 122, 0);
    expect(guidesOf(host).some((line) => line.dataset.axis === "v")).toBe(true);
    pointer(viewportOf(host), "pointerup", { clientX: 222, clientY: 100, pointerId: 7 });
    expect(nodeOf(engine, "t")).toMatchObject({ x: 40, y: 40, width: 364, height: 160 });
    expect(guidesOf(host)).toHaveLength(0);
    engine.destroy();
  });

  it("Alt tenuto spegne l'aggancio per quel gesto: niente guide e niente griglia, la scheda va dove la porta il puntatore", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    moveCard(host, "m", -55, 0, { altKey: true }, false);
    expect(guidesOf(host)).toHaveLength(0);
    releaseAt(host, -55, 0, { altKey: true });
    expect(nodeOf(engine, "m")).toMatchObject({ x: 45, y: 300 });
    engine.destroy();
  });

  it("con canvas.snap spento non c'è aggancio né guide: la scheda va in unità intere", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    applyPreferences({ snap: false });
    moveCard(host, "m", -55, 0, {}, false);
    expect(guidesOf(host)).toHaveLength(0);
    releaseAt(host, -55, 0);
    expect(nodeOf(engine, "m")).toMatchObject({ x: 45, y: 300 });
    engine.destroy();
  });

  it("Ctrl+' mostra e nasconde la griglia, e i punti si vedono ogni 32 unità (T95)", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    const viewport = viewportOf(host);
    expect(gridOf(host).hidden).toBe(false);
    expect(gridOf(host).style.backgroundSize).toBe("32px 32px");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "'", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(gridOf(host).hidden).toBe(true);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "'", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("canvas.grid spento nasconde la griglia, acceso la mostra", () => {
    const { engine, host } = mounted(guideBoard());
    expect(gridOf(host).hidden).toBe(false);
    applyPreferences({ grid: false });
    expect(gridOf(host).hidden).toBe(true);
    applyPreferences({ grid: true });
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("sotto il 50% la griglia non si disegna, perché i punti sarebbero più fitti di 16 px", () => {
    const { engine, host } = mounted(guideBoard());
    const viewport = viewportOf(host);
    for (let i = 0; i < 30; i++) viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBe(0.05);
    expect(gridOf(host).hidden).toBe(true);
    for (let i = 0; i < 12; i++) viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBeGreaterThanOrEqual(0.5);
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("una guida lasciata in volo non sopravvive alla lavagna chiusa", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    moveCard(host, "m", -55, 0, {}, false);
    const layer = host.querySelector(".canvas-guides");
    expect(layer).not.toBeNull();
    engine.destroy();
    expect(layer!.isConnected).toBe(false);
  });
});
