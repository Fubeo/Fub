// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: trascinare e incollare (T15), la rotella (T35).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, MEASURE_IMAGE_TIMEOUT_MS, type CanvasDepositCards } from "./engine";
import type { CanvasDocument } from "./model";
import { ENTRIES_DRAG_TYPE } from "../../ui/drag-types";
import { t } from "../../i18n/strings";
import { CanvasDepositError } from "../../state/canvas-intake";
import { canvasCoreReady, openCoreNow } from "./wasm/core";
import { DEFAULT_PREFERENCES, type CanvasPreferences, type WheelAction } from "./preferences";
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

describe("CanvasEngine: trascinare e incollare (T15)", () => {
  const BASE_IDS = ["t", "f", "g", "w"];

  function viewport(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function transfer(values: Record<string, string> = {}, extra: Record<string, unknown> = {}): DataTransfer {
    return { files: [], items: [], types: Object.keys(values), getData: (type: string) => values[type] ?? "", ...extra } as unknown as DataTransfer;
  }

  function drop(host: HTMLElement, data: DataTransfer, x = 200, y = 120): void {
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
    viewport(host).dispatchEvent(event);
  }

  function paste(host: HTMLElement, data: DataTransfer): void {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    viewport(host).dispatchEvent(event);
  }

  function dragover(host: HTMLElement, data: DataTransfer, x = 200, y = 120): void {
    const event = new DragEvent("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
    viewport(host).dispatchEvent(event);
  }

  /** Le schede nate, nell'ordine del documento. */
  function born(engine: CanvasEngine): CanvasDocument["nodes"] {
    return readCanvas(engine.getDoc()).nodes.filter((node) => !BASE_IDS.includes(node.id));
  }

  it("più file nascono in griglia, in ordine di nome, con la misura della specie, e un annulla li toglie", async () => {
    const resolvePaths = vi.fn(async () => ["b/z.md", "a/foto 10.png", "x/libro.xlsx", "a/foto 2.png"]);
    const measureImage = vi.fn(async (path: string) => (path === "a/foto 2.png" ? { width: 1000, height: 500 } : null));
    let next = 0;
    const { engine, host, changes } = mounted(canvasSource(), {
      attachments: { deposit: vi.fn(), resolvePaths }, measureImage, newId: () => `d${++next}`,
    });
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const nodes = born(engine);
    expect(nodes.map((node) => node.file)).toEqual(["a/foto 2.png", "a/foto 10.png", "x/libro.xlsx", "b/z.md"]);
    // La misura: l'immagine misurata col lato lungo di 480, quella senza
    // misura 480×360, il foglio 480×304 (la misura di nascita del nucleo,
    // `born_size`), la nota 320×240.
    expect(nodes.map((node) => [node.width, node.height])).toEqual([[480, 240], [480, 360], [480, 304], [320, 240]]);
    // Le operazioni del rilascio (T24): un `add_card` per file con il suo id,
    // in ordine di nome, e la griglia del nucleo dal punto del rilascio.
    const first = nodes[0]!;
    const core = openCoreNow(canvasSource())!;
    const expected = core.preview(core.compile([
      { op: "add_card", id: "d1", file: "a/foto 2.png", content_size: [1000, 500] },
      { op: "add_card", id: "d2", file: "a/foto 10.png" },
      { op: "add_card", id: "d3", file: "x/libro.xlsx" },
      { op: "add_card", id: "d4", file: "b/z.md" },
      { op: "layout", ids: ["d1", "d2", "d3", "d4"], kind: "grid", x: first.x, y: first.y },
    ], 1n).patches);
    core.close();
    expect(engine.getDoc()).toBe(expected);
    expect(nodes[1]!.x).toBe(first.x + 504);
    expect(nodes[2]!.y).toBe(first.y + 384);
    expect(measureImage).toHaveBeenCalledTimes(2);
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("oltre 12 file nasce anche un gruppo «{count} file», sotto le schede, nello stesso annulla", async () => {
    const paths = Array.from({ length: 13 }, (_, index) => `note/n${index + 1}.md`);
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit: vi.fn(), resolvePaths: async () => paths } });
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const nodes = born(engine);
    expect(nodes).toHaveLength(14);
    expect(nodes[0]).toMatchObject({ type: "group", label: t("canvas.intake.group", { count: 13 }) });
    const group = nodes[0]!;
    for (const card of nodes.slice(1)) {
      expect(card.type).toBe("file");
      expect(card.x).toBeGreaterThanOrEqual(group.x + 24);
      expect(card.y).toBeGreaterThanOrEqual(group.y + 24);
      expect(card.x + card.width).toBeLessThanOrEqual(group.x + group.width - 24);
      expect(card.y + card.height).toBeLessThanOrEqual(group.y + group.height - 24);
    }
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("su una scheda di file il primo file ne prende il posto, gli altri nascono accanto (A-8)", async () => {
    const { engine, host, changes } = mounted(canvasSource(), {
      attachments: { deposit: vi.fn(), resolvePaths: async () => ["nuovo/uno.pdf", "nuovo/due.md"] },
    });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector('.canvas-node[data-node="f"]'));
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "f")!.file).toBe("nuovo/uno.pdf");
    expect(born(engine).map((node) => [node.file, node.width, node.height])).toEqual([["nuovo/due.md", 320, 240]]);
    vi.restoreAllMocks();
    engine.destroy();
  });

  it("una misura che fallisce o non arriva lascia quella di serie", async () => {
    vi.useFakeTimers();
    try {
      const measureImage = vi.fn((path: string) => (path.endsWith("a.png")
        ? Promise.reject(new Error("non si legge"))
        : new Promise<null>(() => {})));
      const { engine, host, changes } = mounted(canvasSource(), {
        attachments: { deposit: vi.fn(), resolvePaths: async () => ["a.png", "b.png"] }, measureImage,
      });
      drop(host, transfer());
      await vi.advanceTimersByTimeAsync(MEASURE_IMAGE_TIMEOUT_MS - 1);
      expect(changes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(changes).toHaveLength(1);
      expect(born(engine).map((node) => [node.file, node.width, node.height])).toEqual([["a.png", 480, 360], ["b.png", 480, 360]]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un deposito che l'host rifiuta con un errore tipizzato dice il suo messaggio, mai «[object Object]»", async () => {
    const deposit = vi.fn(async (): Promise<readonly string[]> => {
      throw { kind: "io", message: "disco pieno" };
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "x.png")] }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno"));
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("un deposito che l'host rifiuta lo dice nella barra, come prima", async () => {
    const deposit = vi.fn(async (): Promise<readonly string[]> => {
      throw new Error("troppo grande");
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "x.png")] }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("troppo grande"));
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("un deposito fermato a metà: le schede dei file già fatti nascono in un annulla solo, poi l'errore", async () => {
    const deposit = vi.fn(async (_files: readonly File[], _id: string, _cards: CanvasDepositCards): Promise<readonly string[]> => {
      throw new CanvasDepositError({ kind: "io", message: "disco pieno" }, ["Foto/a.png", "Foto/b.png"]);
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "a.png"), new File(["y"], "b.png"), new File(["z"], "c.png")] }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(born(engine).map((node) => node.file)).toEqual(["Foto/a.png", "Foto/b.png"]);
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno");
    // Le schede si ricordano per id: la porta le ripunta in un commit solo.
    const cards = deposit.mock.calls[0]![2];
    expect(cards.repoint([{ from: "Foto/a.png", to: "attachments/a.png" }, { from: "Foto/b.png", to: "attachments/b.png" }])).toBe(2);
    expect(born(engine).map((node) => node.file)).toEqual(["attachments/a.png", "attachments/b.png"]);
    expect(engine.undo()).toBe(true);
    expect(born(engine).map((node) => node.file)).toEqual(["Foto/a.png", "Foto/b.png"]);
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("il primo file rifiutato: solo l'errore, nessuna scheda, e gli appunti non diventano testo", async () => {
    const deposit = vi.fn(async (): Promise<readonly string[]> => {
      throw new CanvasDepositError({ kind: "io", message: "disco pieno" }, []);
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    paste(host, transfer({ "text/plain": "testo degli appunti" }, { files: [new File(["x"], "x.png")] }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno"));
    expect(changes).toHaveLength(0);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("la lavagna cambiata mentre il deposito si ferma: niente schede, ma l'errore si vede", async () => {
    let fail!: (error: unknown) => void;
    const deposit = vi.fn(() => new Promise<readonly string[]>((_resolve, reject) => { fail = reject; }));
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "tardi.png")] }));
    expect(deposit).toHaveBeenCalledTimes(1);
    const remote = JSON.parse(canvasSource());
    remote.nodes[0].text = "Versione remota";
    engine.syncDoc(JSON.stringify(remote));
    fail(new CanvasDepositError({ kind: "io", message: "disco pieno" }, ["attachments/tardi.png"]));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno"));
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(readCanvas(engine.getDoc()).nodes[0]!.text).toBe("Versione remota");
    engine.destroy();
  });

  it("incollare mette la scheda sotto il puntatore visto sulla vista, sennò al centro", async () => {
    const { engine, host, changes } = mounted();
    drop(host, transfer({ "text/plain": "lasciato" }), 300, 200);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const dropped = born(engine)[0]!;

    viewport(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    paste(host, transfer({ "text/plain": "sotto il puntatore" }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    const pointed = born(engine)[1]!;
    expect([pointed.text, pointed.x, pointed.y]).toEqual(["sotto il puntatore", dropped.x, dropped.y]);

    viewport(host).dispatchEvent(new PointerEvent("pointerleave", { clientX: 900, clientY: 900 }));
    paste(host, transfer({ "text/plain": "al centro" }));
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    const centered = born(engine)[2]!;
    expect(centered.text).toBe("al centro");
    expect([centered.x, centered.y]).not.toEqual([dropped.x, dropped.y]);
    engine.destroy();
  });

  it("le celle copiate diventano una scheda di testo con la tabella Markdown", async () => {
    const clipboardMarkdown = vi.fn(async () => "| x | y |\n| --- | --- |\n| 1 | 2 |");
    const { engine, host, changes } = mounted(canvasSource(), { clipboardMarkdown });
    paste(host, transfer({ "text/plain": "Nome\tVoto\nAda\t10|lode\n" }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(born(engine)[0]).toMatchObject({ type: "text", text: "| Nome | Voto |\n| --- | --- |\n| Ada | 10\\|lode |" });
    expect(clipboardMarkdown).not.toHaveBeenCalled();

    const html = transfer({ "text/plain": "x\ty\n1\t2", "text/html": "<meta charset=utf-8><table><tr><td>x</td></tr></table>" });
    paste(host, html);
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(clipboardMarkdown).toHaveBeenCalledWith(html);
    expect(born(engine)[1]).toMatchObject({ type: "text", text: "| x | y |\n| --- | --- |\n| 1 | 2 |" });

    // Una riga sola con una tabulazione resta testo.
    paste(host, transfer({ "text/plain": "solo\tuna" }));
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    expect(born(engine)[2]).toMatchObject({ type: "text", text: "solo\tuna" });
    engine.destroy();
  });

  it("incollare mentre si scrive in una scheda di testo va nel testo", async () => {
    const { engine, host, changes } = mounted();
    const field = document.createElement("textarea");
    viewport(host).append(field);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer({ "text/plain": "a\tb\nc\td" }) });
    field.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(false);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("trascinando file o voci dell'albero, rettangoli tratteggiati dove nasceranno; spariscono all'uscita e al rilascio", async () => {
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit: vi.fn(async () => []), resolvePaths: async () => [] } });
    const ghosts = () => [...host.querySelectorAll<HTMLElement>(".canvas-drop-ghost")];
    const files = transfer({}, { types: ["Files"], items: [{ kind: "file" }, { kind: "file" }, { kind: "file" }] });
    dragover(host, files);
    expect(ghosts()).toHaveLength(3);
    expect(ghosts().map((ghost) => [ghost.style.width, ghost.style.height])).toEqual([["320px", "160px"], ["320px", "160px"], ["320px", "160px"]]);
    viewport(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    expect(ghosts()).toHaveLength(0);

    // Oltre i dodici, la cornice del gruppo col numero (prototipo T25); di nuovo
    // sotto i dodici, i rettangoli senza numero.
    const many = transfer({}, { types: ["Files"], items: Array.from({ length: 13 }, () => ({ kind: "file" })) });
    dragover(host, many);
    expect(ghosts()).toHaveLength(1);
    expect(ghosts()[0]!.classList.contains("canvas-drop-ghost-group")).toBe(true);
    expect(ghosts()[0]!.textContent).toBe("13 file");
    dragover(host, files);
    expect(ghosts()).toHaveLength(3);
    expect(ghosts().some((ghost) => ghost.classList.contains("canvas-drop-ghost-group") || ghost.textContent !== "")).toBe(false);
    viewport(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));

    // Le voci dell'albero non si contano prima del rilascio: una.
    dragover(host, transfer({ [ENTRIES_DRAG_TYPE]: "", "text/plain": "" }));
    expect(ghosts()).toHaveLength(1);
    drop(host, transfer());
    expect(ghosts()).toHaveLength(0);

    // WebKit: nessun tipo leggibile, uno.
    dragover(host, transfer({}, { types: [], items: [] }));
    expect(ghosts()).toHaveLength(1);
    viewport(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));

    // Del testo da un'altra app non nasce come file: niente fantasmi.
    dragover(host, transfer({ "text/plain": "ciao" }));
    expect(ghosts()).toHaveLength(0);
    engine.destroy();
  });
});

/** Lo scatto della rotella come lo prova la tela: il delta, la unità e i tasti. */
type WheelInit = {
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly deltaMode?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly clientX?: number;
  readonly clientY?: number;
};

describe("CanvasEngine: la rotella (T35)", () => {
  /** La camera come la mostra la tela: la trasformazione dello stage. */
  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;

  /**
   * Uno scatto della rotella sul bersaglio, con il puntatore a (300, 200) se non si dice.
   * Il `WheelEvent` di happy-dom non prende tasti né punto dall'init: si mettono a mano.
   */
  function scroll(target: EventTarget, init: WheelInit = {}): WheelEvent {
    const { ctrlKey = false, metaKey = false, shiftKey = false, clientX = 300, clientY = 200, ...wheel } = init;
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...wheel });
    Object.defineProperties(event, {
      ctrlKey: { value: ctrlKey },
      metaKey: { value: metaKey },
      shiftKey: { value: shiftKey },
      clientX: { value: clientX },
      clientY: { value: clientY },
    });
    target.dispatchEvent(event);
    return event;
  }

  /** «La rotella del mouse» cambiata a lavagna aperta, come la manda un cambio da Impostazioni. */
  function setWheel(wheel: WheelAction): void {
    for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, wheel });
  }

  /** Il punto della lavagna sotto lo schermo (x, y), con la camera data. */
  function boardPoint(camera: { x: number; y: number; zoom: number }, x: number, y: number): { x: number; y: number } {
    return { x: (x - camera.x) / camera.zoom, y: (y - camera.y) / camera.zoom };
  }

  it("di serie la rotella sposta come prima, e Maiusc sposta di lato anche con il solo deltaY", () => {
    const { engine, host } = mounted();
    const start = cameraOf(host);
    scroll(viewportOf(host), { deltaY: 100 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 100 });
    scroll(viewportOf(host), { deltaX: 40 });
    expect(cameraOf(host)).toEqual({ ...start, x: start.x - 40, y: start.y - 100 });
    const mid = cameraOf(host);
    scroll(viewportOf(host), { deltaY: 100, shiftKey: true });
    expect(cameraOf(host)).toEqual({ ...mid, x: mid.x - 100 });
    engine.destroy();
  });

  it("«zoom»: la rotella ingrandisce intorno al puntatore; Maiusc e un gesto orizzontale spostano", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const start = cameraOf(host);
    const under = boardPoint(start, 300, 200);
    scroll(viewportOf(host), { deltaY: -100 });
    const zoomed = cameraOf(host);
    expect(zoomed.zoom).toBeCloseTo(start.zoom * 1.1, 9);
    // Il punto della lavagna sotto il puntatore resta sotto il puntatore.
    const kept = boardPoint(zoomed, 300, 200);
    expect(kept.x).toBeCloseTo(under.x, 6);
    expect(kept.y).toBeCloseTo(under.y, 6);
    // Maiusc con la rotella sposta di lato, senza ingrandire.
    scroll(viewportOf(host), { deltaY: 100, shiftKey: true });
    expect(cameraOf(host)).toEqual({ ...zoomed, x: zoomed.x - 100 });
    // Le due dita sul touchpad: una parte orizzontale sposta anche in «zoom».
    const panned = cameraOf(host);
    scroll(viewportOf(host), { deltaX: 30, deltaY: 10 });
    expect(cameraOf(host)).toEqual({ ...panned, x: panned.x - 30, y: panned.y - 10 });
    // Ctrl+rotella ingrandisce ancora.
    const beforeCtrl = cameraOf(host);
    scroll(viewportOf(host), { deltaY: -100, ctrlKey: true });
    expect(cameraOf(host).zoom).toBeCloseTo(beforeCtrl.zoom * 1.1, 9);
    engine.destroy();
  });

  it("sopra una scheda non attiva la rotella è della lavagna, e lo zoom la segue", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const before = cameraOf(host).zoom;
    const card = host.querySelector<HTMLElement>('.canvas-node[data-node="t"]')!;
    const event = scroll(card, { deltaY: -100 });
    expect(event.defaultPrevented).toBe(true);
    expect(cameraOf(host).zoom).toBeCloseTo(before * 1.1, 9);
    engine.destroy();
  });

  it("il pizzico (Ctrl o Cmd con la rotella) ingrandisce in tutte e due le scelte", () => {
    for (const wheel of ["pan", "zoom"] as const) {
      const { engine, host } = mounted();
      setWheel(wheel);
      const start = cameraOf(host);
      // Uno scatto piccolo, come lo manda il pizzico, e il browser non ingrandisce la pagina.
      const pinch = scroll(viewportOf(host), { deltaY: -0.5, ctrlKey: true });
      expect(pinch.defaultPrevented, wheel).toBe(true);
      expect(cameraOf(host).zoom, wheel).toBeCloseTo(start.zoom * 1.1, 9);
      // Ctrl senza parte verticale non ingrandisce e non sposta.
      const after = cameraOf(host);
      scroll(viewportOf(host), { deltaX: 5, ctrlKey: true });
      expect(cameraOf(host), wheel).toEqual(after);
      scroll(viewportOf(host), { deltaY: -0.5, metaKey: true });
      expect(cameraOf(host).zoom, wheel).toBeCloseTo(after.zoom * 1.1, 9);
      engine.destroy();
    }
  });

  it("«La rotella del mouse» cambiata a lavagna aperta vale dallo scatto dopo, e smette con la lavagna", () => {
    const watchers = watched.appliers.length;
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    setWheel("pan");
    scroll(viewport, { deltaY: 50 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 50 });
    setWheel("zoom");
    scroll(viewport, { deltaY: -50 });
    const zoomed = cameraOf(host);
    expect(zoomed.zoom).toBeCloseTo(start.zoom * 1.1, 9);
    setWheel("pan");
    scroll(viewport, { deltaY: 50 });
    expect(cameraOf(host)).toEqual({ ...zoomed, y: zoomed.y - 50 });
    engine.destroy();
    expect(watched.appliers).toHaveLength(watchers);
  });

  it("una riga vale 16 px e una pagina l'altezza della vista, qualunque sia la rotella", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    scroll(viewport, { deltaY: 3, deltaMode: 1 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 48 });
    const page = vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const lines = cameraOf(host);
    scroll(viewport, { deltaY: 1, deltaMode: 2 });
    expect(cameraOf(host)).toEqual({ ...lines, y: lines.y - 500 });
    const pages = cameraOf(host);
    scroll(viewport, { deltaX: 0.5, deltaMode: 2 });
    expect(cameraOf(host)).toEqual({ ...pages, x: pages.x - 400 });
    page.mockRestore();
    engine.destroy();
  });

  it("lo zoom ai limiti resta fermo, senza salto", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const viewport = viewportOf(host);
    for (let i = 0; i < 40; i++) scroll(viewport, { deltaY: -100 });
    expect(cameraOf(host).zoom).toBe(4);
    const top = cameraOf(host);
    scroll(viewport, { deltaY: -100 });
    expect(cameraOf(host).zoom).toBe(4);
    expect(cameraOf(host).x).toBeCloseTo(top.x, 6);
    expect(cameraOf(host).y).toBeCloseTo(top.y, 6);
    for (let i = 0; i < 80; i++) scroll(viewport, { deltaY: 100 });
    expect(cameraOf(host).zoom).toBe(0.05);
    const bottom = cameraOf(host);
    scroll(viewport, { deltaY: 100 });
    expect(cameraOf(host).zoom).toBe(0.05);
    expect(cameraOf(host).x).toBeCloseTo(bottom.x, 6);
    expect(cameraOf(host).y).toBeCloseTo(bottom.y, 6);
    engine.destroy();
  });
});
