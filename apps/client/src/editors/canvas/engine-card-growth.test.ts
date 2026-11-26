// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: la scheda di testo cresce, e i suoi tasti (T44).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CARD_PAUSE_MS, CanvasEngine } from "./engine";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { canvasSource, cardText, mounted, openLive, press, readCanvas, textPort, type, withTextPort } from "./engine-test-support";

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

describe("CanvasEngine: la scheda di testo cresce, e i suoi tasti (T44)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Un'impaginazione finta: ogni carattere è largo 10 px, ogni riga alta 20; il
  // testo ha 8 px di margine per lato e la testata della scheda è alta 28.
  const CHAR = 10;
  const LINE = 20;
  const PAD = 16;
  const HEAD = 28;

  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id);
  const boxOf = (engine: CanvasEngine, id: string): number[] => {
    const node = nodeOf(engine, id)!;
    return [node.x, node.y, node.width, node.height];
  };
  const shown = (article: HTMLElement): number[] => [parseFloat(article.style.width), parseFloat(article.style.height)];
  /** La scheda in cui si scrive: quella del campo o dell'editor aperto. */
  const writingCard = (host: HTMLElement): string | undefined =>
    host.querySelector<HTMLElement>(".canvas-text-editor, .canvas-text-live")?.closest<HTMLElement>(".canvas-node")?.dataset.node;

  /** La larghezza del testo su una riga sola, e l'altezza che vuole in una scheda larga `width`. */
  function layout(text: string, width: number): { natural: number; height: number } {
    const rows = text.split("\n");
    const inner = width - PAD;
    return {
      natural: Math.max(...rows.map((row) => row.length * CHAR)),
      height: rows.reduce((sum, row) => sum + Math.max(1, Math.ceil((row.length * CHAR) / inner)), 0) * LINE,
    };
  }

  /** La scheda prende la misura dal suo stile, come una scheda vera; `max-content` è il suo testo su una riga. */
  function fakeArticle(article: HTMLElement, text: () => string): void {
    Object.defineProperty(article, "offsetWidth", {
      configurable: true,
      get: () => (article.style.width === "max-content" ? layout(text(), 10_000).natural + PAD : parseFloat(article.style.width) || 0),
    });
    Object.defineProperty(article, "offsetHeight", { configurable: true, get: () => parseFloat(article.style.height) || 0 });
  }

  /** Il campo semplice aperto: va a capo alla larghezza della scheda, e scorre se il testo esce. */
  function fakeField(host: HTMLElement): HTMLTextAreaElement {
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    const article = input.closest<HTMLElement>(".canvas-node")!;
    fakeArticle(article, () => input.value);
    const width = (): number => (parseFloat(article.style.width) || 0) - PAD;
    const height = (): number => (parseFloat(article.style.height) || 0) - HEAD;
    Object.defineProperty(input, "clientWidth", { configurable: true, get: width });
    Object.defineProperty(input, "scrollWidth", {
      configurable: true,
      get: () => (input.style.whiteSpace === "pre" ? Math.max(width(), layout(input.value, 10_000).natural) : width()),
    });
    Object.defineProperty(input, "clientHeight", { configurable: true, get: height });
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => Math.max(height(), layout(input.value, parseFloat(article.style.width) || 0).height),
    });
    return input;
  }

  function field(host: HTMLElement, id: string): HTMLTextAreaElement {
    card(host, id).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return fakeField(host);
  }

  it("mentre si scrive la scheda si allarga col testo fino a 480 px, poi va a capo e cresce in altezza; da sola non si restringe", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = field(host, "t");
    const article = card(host, "t");
    // Il testo sta nei 240 px: niente cambia.
    type(input, "a".repeat(20));
    expect(shown(article)).toEqual([240, 140]);
    // 30 caratteri vogliono 300 px: la scheda si allarga subito, agganciata a 8.
    type(input, "a".repeat(30));
    expect(shown(article)).toEqual([320, 140]);
    expect(changes).toHaveLength(0);
    expect(readCanvas(engine.pendingText()!).nodes[0]!.width).toBe(320);
    // La misura va nel .canvas col testo, nello stesso commit.
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(boxOf(engine, "t")).toEqual([40, 40, 320, 140]);
    expect(cardText(engine)).toBe("a".repeat(30));
    // Una parola di 600 px senza spazi: la scheda si ferma a 480 e va a capo.
    type(input, "x".repeat(60));
    expect(shown(article)).toEqual([480, 140]);
    // Dieci righe così sono venti righe a capo, 400 px: la scheda cresce in altezza.
    const long = Array.from({ length: 10 }, () => "x".repeat(60)).join("\n");
    type(input, long);
    expect(shown(article)).toEqual([480, 432]);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(2);
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 432]);
    // Un testo corto non la restringe.
    type(input, "ab");
    press(input, "Escape");
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 432]);
    expect(cardText(engine)).toBe("ab");
    expect(shown(article)).toEqual([480, 432]);
    engine.destroy();
  });

  it("una scheda ridimensionata a mano non si allarga più scrivendo, ma cresce in altezza", () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const zoom = Number(/scale\(([\d.e+-]+)\)/.exec(stage.style.transform)![1]);
    const grip = card(host, "t").querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 100 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100 - 40 * zoom, clientY: 100 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "mouse", clientX: 100 - 40 * zoom, clientY: 100 }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 200, 140]);
    const input = field(host, "t");
    // 12 righe di 30 caratteri: a 200 px vanno a capo, 24 righe, 480 px di testo.
    type(input, Array.from({ length: 12 }, () => "a".repeat(30)).join("\n"));
    press(input, "Escape");
    expect(boxOf(engine, "t")).toEqual([40, 40, 200, 512]);
    engine.destroy();
  });

  it("anche nell'editor delle note la scheda cresce col testo che mostra", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    const article = card(host, "t");
    let text = live.text;
    fakeArticle(article, () => text);
    const height = (): number => (parseFloat(article.style.height) || 0) - HEAD;
    Object.defineProperty(live.area, "clientHeight", { configurable: true, get: height });
    Object.defineProperty(live.area, "scrollHeight", {
      configurable: true,
      get: () => Math.max(height(), layout(text, parseFloat(article.style.width) || 0).height),
    });
    text = "b".repeat(33);
    live.typed(text);
    // 330 px di testo e 16 di margine: 346, agganciati a 352.
    expect(shown(article)).toEqual([352, 140]);
    text = Array.from({ length: 8 }, () => "b".repeat(50)).join("\n");
    live.typed(text);
    // 500 px non stanno in 480: ogni riga va a capo, 16 righe, 320 px di testo.
    expect(shown(article)).toEqual([480, 352]);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 352]);
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("Esc esce dalla scrittura e lascia la scheda scelta; il secondo Esc toglie la scelta", async () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const input = field(host, "t");
    type(input, "Scelta");
    press(input, "Escape");
    expect(writingCard(host)).toBeUndefined();
    expect(engine.selectedText()).toEqual({ primary: "Scelta", secondary: [] });
    expect(card(host, "t").classList.contains("selected")).toBe(true);
    const viewport = viewportOf(host);
    expect(document.activeElement).toBe(viewport);
    expect(press(viewport, "Escape").defaultPrevented).toBe(true);
    expect(engine.selectedText()).toBeNull();
    engine.destroy();

    // Lo stesso nell'editor delle note.
    vi.useRealTimers();
    const { port, opened } = textPort();
    const other = mounted(canvasSource(), withTextPort(port));
    await openLive(other.host);
    press(opened[0]!.area, "Escape");
    expect(opened[0]!.destroyed).toBe(true);
    expect(other.engine.selectedText()?.primary).toBe("vedi [[Altra]] e #tag");
    press(viewportOf(other.host), "Escape");
    expect(other.engine.selectedText()).toBeNull();
    other.engine.destroy();
  });

  it("Ctrl+Invio registra, chiude e apre sotto una scheda nuova larga uguale, già in scrittura", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = field(host, "t");
    type(input, "a".repeat(30));
    expect(press(input, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(cardText(engine)).toBe("a".repeat(30));
    // Il testo e la misura nuova in un commit, la scheda nuova in un altro.
    expect(changes).toHaveLength(2);
    expect(boxOf(engine, "t")).toEqual([40, 40, 320, 140]);
    const nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes).toHaveLength(5);
    const fresh = nodes[nodes.length - 1]!;
    expect(fresh.type).toBe("text");
    expect(fresh.text).toBe("");
    // 24 px sotto, larga come lei; il gruppo sotto non la sposta.
    expect([fresh.x, fresh.y, fresh.width, fresh.height]).toEqual([40, 204, 320, 160]);
    expect(writingCard(host)).toBe(fresh.id);
    expect(document.activeElement).toBe(host.querySelector(".canvas-text-editor"));
    expect(engine.selectedText()).toEqual({ primary: "", secondary: [] });
    // Scritta, resta; il primo annulla toglie il suo testo, il secondo lei, il terzo il testo di «t».
    const next = fakeField(host);
    type(next, "Dopo");
    press(next, "Escape");
    expect(cardText(engine, fresh.id)).toBe("Dopo");
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, fresh.id)).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    engine.destroy();
  });

  it("Ctrl+Maiusc+Invio apre la scheda nuova a destra, collegata con un filo; se cadrebbe su un'altra scende", () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const input = field(host, "t");
    type(input, "Prima");
    expect(press(input, "Enter", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    const doc = readCanvas(engine.getDoc());
    const fresh = doc.nodes[doc.nodes.length - 1]!;
    // A destra di «t» c'è il file (400, 40): scende sotto di lui, poi sotto il
    // link (400, 240), fino al primo posto libero.
    expect([fresh.x, fresh.y, fresh.width, fresh.height]).toEqual([304, 364, 240, 160]);
    const wire = doc.edges.find((edge) => edge.toNode === fresh.id)!;
    expect([wire.fromNode, wire.fromSide, wire.toSide]).toEqual(["t", "right", "left"]);
    expect(writingCard(host)).toBe(fresh.id);
    engine.destroy();
  });

  it("la scheda nuova scende al primo posto libero, cercato al più 20 volte; poi cade sopra l'altra", () => {
    vi.useFakeTimers();
    // Sotto «t» una colonna di schede a 24 px l'una dall'altra; con `hole`, un
    // buco dopo la seconda.
    const column = (count: number, hole: boolean): string => JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 0, y: 0, width: 240, height: 100, text: "su" },
        ...Array.from({ length: count }, (_, k) => ({
          id: `c${k}`, type: "text", x: 0, y: 124 + k * 124 + (hole && k >= 2 ? 200 : 0), width: 240, height: 100, text: String(k),
        })),
      ],
      edges: [],
    });
    let { engine, host } = mounted(column(5, true));
    press(field(host, "t"), "Enter", { ctrlKey: true });
    let nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes[nodes.length - 1]!.y).toBe(372);
    engine.destroy();

    ({ engine, host } = mounted(column(25, false)));
    press(field(host, "t"), "Enter", { ctrlKey: true });
    nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes[nodes.length - 1]!.y).toBe(124);
    engine.destroy();
  });

  it("in sola lettura Ctrl+Invio non fa niente", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    engine.setReadOnly(true);
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    const viewport = viewportOf(host);
    viewport.focus();
    press(viewport, "Enter", { ctrlKey: true });
    press(viewport, "Enter", { ctrlKey: true, shiftKey: true });
    expect(changes).toHaveLength(0);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    engine.destroy();
  });

  it("una scheda nuova lasciata vuota sparisce uscendo, senza un passo d'annulla, anche dopo un testo cancellato", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    type(field(host, "t"), "Uno");
    press(host.querySelector(".canvas-text-editor")!, "Enter", { ctrlKey: true });
    const before = changes[0]!.text;
    let fresh = writingCard(host)!;
    // Ctrl+Invio nella scheda nuova ancora vuota non ne apre un'altra.
    press(host.querySelector(".canvas-text-editor")!, "Enter", { ctrlKey: true });
    expect(writingCard(host)).toBe(fresh);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(5);
    press(host.querySelector(".canvas-text-editor")!, "Escape");
    expect(nodeOf(engine, fresh)).toBeUndefined();
    // Il testo torna ai byte di prima della scheda nuova.
    expect(engine.getDoc()).toBe(before);
    // L'annulla dopo è quello del testo di «t»: della scheda nuova non resta niente.
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(engine.redo()).toBe(true);
    expect(engine.redo()).toBe(false);
    expect(cardText(engine)).toBe("Uno");

    // Scritto e registrato, poi cancellato tutto: uscendo se ne va lo stesso.
    const prior = engine.getDoc();
    press(field(host, "t"), "Enter", { ctrlKey: true });
    fresh = writingCard(host)!;
    const next = fakeField(host);
    type(next, "per sbaglio");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    type(next, "");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(cardText(engine, fresh)).toBe("");
    next.blur();
    expect(nodeOf(engine, fresh)).toBeUndefined();
    expect(engine.getDoc()).toBe(prior);

    // L'annulla della tela mentre si scrive nella scheda nuova vuota: è lei che si annulla.
    press(field(host, "t"), "Enter", { ctrlKey: true });
    fresh = writingCard(host)!;
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, fresh)).toBeUndefined();
    expect(cardText(engine)).toBe("Uno");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    engine.destroy();
  });

  it("una scheda vuota che c'era già non sparisce, né una vecchia a cui si cancella tutto il testo", () => {
    vi.useFakeTimers();
    const source = JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "vecchia" },
        { id: "e", type: "text", x: 400, y: 40, width: 240, height: 140, text: "" },
      ],
      edges: [],
    });
    const { engine, host, changes } = mounted(source);
    press(field(host, "e"), "Escape");
    expect(nodeOf(engine, "e")).toBeDefined();
    expect(changes).toHaveLength(0);
    const input = field(host, "t");
    type(input, "");
    press(input, "Escape");
    expect(cardText(engine)).toBe("");
    expect(changes).toHaveLength(1);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(2);
    engine.destroy();
  });
});
