// @vitest-environment happy-dom
// L'inchiostro sulla pagina di un PDF (N6 T19, D-4 a): un tratto che comincia
// sulla pagina che la scheda mostra prende l'ancora `page`; sulla scheda ma
// fuori dalla pagina l'ancora `card` di N4. Il tratto di pagina si vede solo
// quando la scheda mostra la sua pagina: voltata la pagina sparisce, tornati
// ricompare. La scheda PDF è finta: dice la pagina e dove sta (`pageBox`), e
// avvisa con `pageShown` come la vera (`cards/pdf.ts`).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import { createCardRegistry, type CardContext, type CardPageBox, type CardRenderer, type CardSnapshot, type CardSnapshots } from "./cards";
import { canvasCoreReady } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

/// La scheda PDF: 300 × 480 in (600, 0); la pagina A4 larga quanto la scheda
/// sotto una testata alta 40.
const PDF = { id: "doc", type: "file", x: 600, y: 0, width: 300, height: 480, file: "carta.pdf" };
const NOTE = { id: "t", type: "text", x: 0, y: 0, width: 200, height: 100, text: "nota" };
const BOARD = JSON.stringify({ nodes: [NOTE, PDF], edges: [] });
const PAGE_RECT = { x: 0, y: 40, width: 300, height: (300 * 842) / 595 };

/// Una scheda PDF finta che mostra la pagina `shown.page` (o nessuna con `null`).
function fakePdf() {
  const shown: { page: number | null; context: CardContext | null } = { page: 2, context: null };
  const renderer: CardRenderer = {
    kinds: ["pdf"],
    mount(_node, host, _mode, context) {
      shown.context = context;
      const content = document.createElement("div");
      content.className = "fake-pdf";
      host.append(content);
      return {
        setMode: () => {},
        page: () => shown.page ?? 1,
        pageBox: (): CardPageBox | null =>
          shown.page === null ? null : { page: shown.page, size: { width: 595, height: 842 }, rect: PAGE_RECT },
        destroy: () => {},
      };
    },
  };
  /// La scheda volta alla pagina `page`: l'immagine nuova è in vista.
  const turn = (page: number | null) => {
    shown.page = page;
    shown.context?.pageShown?.();
  };
  return { renderer, turn };
}

function memorySnapshots(): CardSnapshots {
  const map = new Map<string, CardSnapshot>();
  return {
    get: (path, part) => map.get(`${path}\n${part}`),
    put: (path, part, snapshot) => map.set(`${path}\n${part}`, snapshot),
    forget: () => map.clear(),
  };
}

function mounted(source = BOARD) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const pdf = fakePdf();
  const engine = new CanvasEngine(host, {
    surfaceId: "ink-anchors",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onPickFile: () => null,
    cards: { registry: createCardRegistry([pdf.renderer]), snapshots: memorySnapshots(), watch: () => () => {} },
  });
  engine.setDoc(source);
  return { engine, host, changes, pdf };
}

function pointerEvent(type: string, init: PointerEventInit & { readonly timeStamp?: number }): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, ...rest });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

function camera(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

let clock = 0;

/// Un tratto della penna per i punti `world` della lavagna, su `target`.
function pen(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[]): void {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  const base = { pointerId: 7, pointerType: "pen" } as const;
  target.dispatchEvent(pointerEvent("pointerdown", { ...base, ...at(world[0]!), button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
  for (const point of world.slice(1)) {
    clock += 8;
    target.dispatchEvent(pointerEvent("pointermove", { ...base, ...at(point), button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
  }
  const end = clock + 4;
  clock += 100;
  document.dispatchEvent(pointerEvent("pointerup", { ...base, ...at(world[world.length - 1]!), button: 0, buttons: 0, pressure: 0, timeStamp: end }));
}

type Json = Record<string, unknown>;
function strokesOf(text: string, id: string): Json[] {
  const doc = JSON.parse(text) as { nodes: Json[] };
  const layer = doc.nodes.find((node) => node.id === id)?.["fub:ink"] as { strokes?: Json[] } | undefined;
  return layer?.strokes ?? [];
}

const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
/// Gli id dei tratti disegnati nella scheda `id`.
const drawn = (host: HTMLElement, id: string) =>
  [...card(host, id).querySelectorAll(".canvas-ink-card path[data-ink-stroke]")].map((path) => path.getAttribute("data-ink-stroke"));
/// Gli id dei tratti disegnati sulla pagina, nella scheda `id`.
const onPage = (host: HTMLElement, id: string) =>
  [...card(host, id).querySelectorAll(".canvas-ink-card svg[data-ink-page] path[data-ink-stroke]")].map((path) => path.getAttribute("data-ink-stroke"));

/// Un tratto che comincia sulla pagina (sotto la testata) e resta nella scheda.
const ON_PAGE: [number, number][] = [[650, 100], [680, 120], [720, 130]];
/// Un tratto sulla testata della scheda, sopra la pagina.
const ON_HEADER: [number, number][] = [[650, 12], [690, 16], [730, 20]];

describe("l'inchiostro sulla pagina di un PDF", () => {
  it("scrive sulla pagina 2, va alla 3 e il tratto sparisce, torna alla 2 e ricompare", () => {
    const { host, changes, pdf } = mounted();
    pen(host, card(host, "doc"), ON_PAGE);
    expect(changes).toHaveLength(1);
    const [stroke] = strokesOf(changes[0]!.text, "doc");
    expect(stroke!.anchor).toEqual({ kind: "page", page: 2, width: 595, height: 842 });
    // In punti PDF dall'angolo della pagina: (650 − 600) · 595/300 ≈ 99,17 e (100 − 40) · 595/300 = 119.
    expect(String(stroke!.ink)).toMatch(/^1 s100 c[a-z]+ 9917,11900,/);
    const id = String(stroke!.id);
    expect(onPage(host, "doc")).toEqual([id]);
    const inner = card(host, "doc").querySelector(".canvas-ink-card svg[data-ink-page] > svg")!;
    expect(inner.getAttribute("viewBox")).toBe("0 0 595 842");
    expect(inner.getAttribute("y")).toBe("40");

    pdf.turn(3);
    expect(drawn(host, "doc")).toEqual([]);
    pdf.turn(2);
    expect(onPage(host, "doc")).toEqual([id]);
    // La scheda che non mostra nessuna pagina non lo mostra.
    pdf.turn(null);
    expect(drawn(host, "doc")).toEqual([]);
    // Il testo non è cambiato: voltare pagina non scrive.
    expect(changes).toHaveLength(1);
  });

  it("scrive fuori dalla pagina, sulla scheda: l'ancora card di N4, che si vede su ogni pagina", () => {
    const { host, changes, pdf } = mounted();
    pen(host, card(host, "doc"), ON_HEADER);
    const [stroke] = strokesOf(changes[0]!.text, "doc");
    expect(stroke!.anchor).toEqual({ kind: "card", width: 300, height: 480 });
    const id = String(stroke!.id);
    expect(drawn(host, "doc")).toEqual([id]);
    expect(onPage(host, "doc")).toEqual([]);
    pdf.turn(3);
    expect(drawn(host, "doc")).toEqual([id]);
  });

  it("un tratto che parte sulla pagina e ne esce resta della pagina", () => {
    const { host, changes } = mounted();
    pen(host, card(host, "doc"), [[650, 60], [660, 30], [670, 20]]);
    const [stroke] = strokesOf(changes[0]!.text, "doc");
    expect((stroke!.anchor as Json).kind).toBe("page");
  });

  it("annulla e ripeti ridisegnano il tratto di pagina solo sulla sua pagina", () => {
    const { engine, host, changes, pdf } = mounted();
    pen(host, card(host, "doc"), ON_PAGE);
    const id = String(strokesOf(changes[0]!.text, "doc")[0]!.id);
    expect(engine.undo()).toBe(true);
    expect(drawn(host, "doc")).toEqual([]);
    pdf.turn(3);
    expect(engine.redo()).toBe(true);
    expect(drawn(host, "doc")).toEqual([]);
    pdf.turn(2);
    expect(onPage(host, "doc")).toEqual([id]);
  });

  it("un file con l'ancora di pagina si apre e si vede sulla sua pagina, anche in sola lettura; i tratti di N4 restano identici", () => {
    const brush = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const layer = {
      v: 1,
      strokes: [
        { id: "p", tool: "pen", brush, color: "#0072b2", anchor: { kind: "page", page: 2, width: 595, height: 842 }, ink: "1 s100 cxy 5000,5000 100,100" },
        { id: "c", tool: "pen", brush, color: "#0072b2", anchor: { kind: "card", width: 300, height: 480 }, ink: "1 s100 cxy 1000,1000 100,100" },
        { id: "x", tool: "pen", brush, color: "#0072b2", anchor: { kind: "page", page: 0, width: 595, height: 842 }, ink: "1 s100 cxy 1000,1000 100,100" },
      ],
    };
    const source = JSON.stringify({ nodes: [NOTE, { ...PDF, "fub:ink": layer }], edges: [] });
    const { engine, host, changes, pdf } = mounted(source);
    engine.setReadOnly(true);
    expect(drawn(host, "doc")).toEqual(["p", "c"]);
    pdf.turn(5);
    expect(drawn(host, "doc")).toEqual(["c"]);
    // In sola lettura la penna non scrive.
    pdf.turn(2);
    pen(host, card(host, "doc"), ON_PAGE);
    expect(changes).toHaveLength(0);
    // Il testo è quello del file, byte per byte: l'ancora che non vale resta.
    expect(engine.getDoc()).toBe(source);
  });
});
