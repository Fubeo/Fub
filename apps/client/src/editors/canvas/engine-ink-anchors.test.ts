// @vitest-environment happy-dom
// L'inchiostro sulla pagina di un PDF (N6 T19, D-4 a): un tratto che comincia
// sulla pagina che la scheda mostra prende l'ancora `page`; sulla scheda ma
// fuori dalla pagina l'ancora `card` di N4. Il tratto di pagina si vede solo
// quando la scheda mostra la sua pagina: voltata la pagina sparisce, tornati
// ricompare. La scheda PDF è finta: dice la pagina e dove sta (`pageBox`), e
// avvisa con `pageShown` come la vera (`cards/pdf.ts`). Sopra la griglia di
// una scheda di foglio (T38, D-6 b) il tratto è della cella e la segue quando
// il foglio scorre; la scheda di foglio è finta allo stesso modo (`cellAt`,
// `cellRect`, `cellsShown`, come `grid/card.ts`).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseInkBrush } from "../../ink/brush";
import { CanvasEngine, type CanvasChange } from "./engine";
import { createCardRegistry, type CardCellBox, type CardContext, type CardPageBox, type CardRenderer, type CardSnapshot, type CardSnapshots } from "./cards";
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

describe("l'inchiostro sul contenuto di un'immagine (T39)", () => {
  const brush = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
  /// Una scheda d'immagine 400 × 200 con un tratto scritto a 400 × 200.
  const IMAGE = {
    id: "img",
    type: "file",
    x: 0,
    y: 200,
    width: 400,
    height: 200,
    file: "Foto/lavagna.png",
    "fub:ink": {
      v: 1,
      strokes: [{ id: "s", tool: "pen", brush, color: "#0072b2", anchor: { kind: "card", width: 400, height: 200 }, ink: "1 s100 cxy 1000,1000 100,100" }],
    },
  };

  /// Una scheda d'immagine finta che dice la proporzione `shown.aspect`.
  function fakeImage() {
    const shown: { aspect: number | null; context: CardContext | null } = { aspect: 1, context: null };
    const renderer: CardRenderer = {
      kinds: ["image"],
      mount(_node, host, _mode, context) {
        shown.context = context;
        host.append(document.createElement("canvas"));
        return { setMode: () => {}, contentAspect: () => shown.aspect, destroy: () => {} };
      },
    };
    /// L'immagine cambia (il file sostituito): la scheda lo dice alla tela.
    const replace = (aspect: number | null) => {
      shown.aspect = aspect;
      shown.context?.contentShown?.();
    };
    return { renderer, replace };
  }

  const viewBox = (host: HTMLElement) => card(host, "img").querySelector(".canvas-ink-card > svg")?.getAttribute("viewBox") ?? null;

  it("il viewBox è il riquadro del contenuto nella misura scritta, e segue l'immagine che cambia", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const image = fakeImage();
    const source = JSON.stringify({ nodes: [IMAGE], edges: [] });
    const engine = new CanvasEngine(host, {
      surfaceId: "ink-content",
      formatId: "canvas",
      documentId: "lavagna.canvas",
      onChange: () => {},
      onSelectionChange: () => {},
      onPickFile: () => null,
      cards: { registry: createCardRegistry([image.renderer]), snapshots: memorySnapshots(), watch: () => () => {} },
    });
    engine.setDoc(source);
    // Un'immagine quadrata in 400 × 200: 200 × 200 a x = 100.
    expect(viewBox(host)).toBe("100 0 200 200");
    // Il file sostituito con un'immagine 4:1: 400 × 100 a y = 50.
    image.replace(4);
    expect(viewBox(host)).toBe("0 50 400 100");
    // Non si vede niente: l'inchiostro segue tutta la scheda, come in N4.
    image.replace(null);
    expect(viewBox(host)).toBe("0 0 400 200");
    // Solo resa: il file non cambia.
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("il Lazo sposta un tratto su un'immagine ridimensionata con un'altra proporzione dove dice il puntatore, e lo spessore si vede come è chiesto (T98)", () => {
    // Un'immagine 2:1 scritta in una scheda 300 × 300 (l'immagine 300 × 150 a
    // y = 75) e ora in una 600 × 200 (400 × 200 a x = 100): s = 4/3, e il
    // punto (150, 150) dell'ancora sta in (300, 100) nella scheda, cioè in
    // (300, 300) sulla lavagna. Senza la proporzione il nucleo userebbe
    // s = min(600/300, 200/300) = 2/3 e il tratto andrebbe al doppio.
    const resized = {
      ...IMAGE,
      width: 600,
      height: 200,
      "fub:ink": {
        v: 1,
        strokes: [{ id: "s", tool: "pen", brush, color: "#0072b2", anchor: { kind: "card", width: 300, height: 300 }, ink: "1 s100 cxy 15000,15000 1000,0 1000,0" }],
      },
    };
    const host = document.createElement("div");
    document.body.append(host);
    const image = fakeImage();
    image.replace(2);
    const changes: CanvasChange[] = [];
    const engine = new CanvasEngine(host, {
      surfaceId: "ink-content-lasso",
      formatId: "canvas",
      documentId: "lavagna.canvas",
      onChange: (change) => changes.push(change),
      onSelectionChange: () => {},
      onPickFile: () => null,
      cards: { registry: createCardRegistry([image.renderer]), snapshots: memorySnapshots(), watch: () => () => {} },
    });
    engine.setDoc(JSON.stringify({ nodes: [resized], edges: [] }));
    expect(viewBox(host)).toBe("0 75 300 150");
    engine.commands().find((command) => command.id === "canvas.tool.lasso")!.run();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    const mouse = { pointerId: 1, pointerType: "mouse" } as const;
    const drag = (world: readonly (readonly [number, number])[]) => {
      const cam = camera(host);
      const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
      viewport.dispatchEvent(pointerEvent("pointerdown", { ...mouse, ...at(world[0]!), button: 0, buttons: 1 }));
      for (const point of world.slice(1)) viewport.dispatchEvent(pointerEvent("pointermove", { ...mouse, ...at(point), button: -1, buttons: 1 }));
      viewport.dispatchEvent(pointerEvent("pointerup", { ...mouse, ...at(world[world.length - 1]!), button: 0, buttons: 0 }));
    };
    // Il giro attorno al tratto, da (300, 300) a (326,7, 300) sulla lavagna.
    drag([[280, 280], [350, 280], [350, 320], [280, 320], [280, 282]]);
    expect(host.querySelectorAll(".canvas-stage > .canvas-lasso .canvas-lasso-chosen path")).toHaveLength(1);
    // Preso sul tratto e lasciato 30 più a destra e 20 più in basso.
    drag([[313, 300], [330, 310], [343, 320]]);
    const [moved] = strokesOf(lastText(changes), "img");
    // (30, 20) della lavagna sono (22,5, 15) nell'ancora: il punto
    // (172,5, 165) sta in (100 + 4/3 · 172,5, −100 + 4/3 · 165) = (330, 120)
    // nella scheda, (330, 320) sulla lavagna, cioè (300 + 30, 300 + 20).
    expect(moved).toMatchObject({ anchor: { kind: "card", width: 300, height: 300 }, ink: "1 s100 cxy 17250,16500 1000,0 1000,0" });

    // Lo spessore dalla barra della selezione: 12 pixel dello schermo sono
    // 12 / zoom unità della lavagna, e nell'ancora si dividono per s = 4/3.
    host.querySelector<HTMLButtonElement>('.canvas-selection-bar [data-command="canvas.stroke_width"]')!.click();
    const slider = document.querySelector<HTMLInputElement>(".canvas-stroke-popover .canvas-pen-width")!;
    slider.value = "12";
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    const [widened] = strokesOf(lastText(changes), "img");
    expect(parseInkBrush(String(widened!.brush)).size).toBeCloseTo((12 / camera(host).zoom) * 0.75, 2);
    engine.destroy();
  });
});

const lastText = (changes: readonly CanvasChange[]) => changes[changes.length - 1]!.text;

describe("l'inchiostro sulle celle di un foglio (T38)", () => {
  /// La scheda di foglio: 412 × 308 in (0, 300), con le intestazioni di
  /// `grid/card.ts` (52 a sinistra, 28 in alto) e celle di 120 × 28: tre
  /// colonne e dieci righe in vista.
  const SHEET = { id: "fogli", type: "file", x: 0, y: 300, width: 412, height: 308, file: "Conti/2025.xlsx" };
  const ROW_HEADER = 52;
  const COLUMN_HEADER = 28;
  const ROW = 28;
  const COLUMN = 120;

  /// Una scheda di foglio finta che scorre per righe intere, come la vera:
  /// dice le celle disegnate (`cellAt`, `cellRect`) e avvisa con
  /// `cellsShown` dopo averle spostate.
  function fakeSheet() {
    const state: { top: number; context: CardContext | null; sheet: string } = { top: 0, context: null, sheet: "Conti 2025" };
    const box = (row: number, column: number): CardCellBox | null => {
      if (row < state.top || row >= state.top + 10 || column < 0 || column >= 3) return null;
      const cell = `${String.fromCharCode(65 + column)}${row + 1}`;
      const rect = { x: ROW_HEADER + column * COLUMN, y: COLUMN_HEADER + (row - state.top) * ROW, width: COLUMN, height: ROW };
      return { sheet: state.sheet, cell, rect, zoom: 1 };
    };
    const renderer: CardRenderer = {
      kinds: ["sheet"],
      mount(_node, host, _mode, context) {
        state.context = context;
        host.append(document.createElement("div"));
        return {
          setMode: () => {},
          cellAt: ({ x, y }) =>
            x < ROW_HEADER || y < COLUMN_HEADER
              ? null
              : box(Math.floor((y - COLUMN_HEADER) / ROW) + state.top, Math.floor((x - ROW_HEADER) / COLUMN)),
          cellRect: (sheet, cell) => {
            const match = /^([A-Z])(\d+)$/.exec(cell);
            return sheet === state.sheet && match ? box(Number(match[2]) - 1, match[1]!.charCodeAt(0) - 65) : null;
          },
          destroy: () => {},
        };
      },
    };
    /// Il foglio scorre di `rows` righe dentro la scheda.
    const scroll = (rows: number) => {
      state.top = Math.max(0, state.top + rows);
      state.context?.cellsShown?.();
    };
    /// Il foglio mostrato si chiama `name` (rinominato in un riquadro accanto).
    const rename = (name: string) => {
      state.sheet = name;
      state.context?.cellsShown?.();
    };
    return { renderer, scroll, rename };
  }

  function sheetMounted(source = JSON.stringify({ nodes: [SHEET], edges: [] })) {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: CanvasChange[] = [];
    const sheet = fakeSheet();
    const engine = new CanvasEngine(host, {
      surfaceId: "ink-cells",
      formatId: "canvas",
      documentId: "lavagna.canvas",
      onChange: (change) => changes.push(change),
      onSelectionChange: () => {},
      onPickFile: () => null,
      cards: { registry: createCardRegistry([sheet.renderer]), snapshots: memorySnapshots(), watch: () => () => {} },
    });
    engine.setDoc(source);
    return { engine, host, changes, sheet };
  }

  /// B3 nella scheda con il foglio in cima: x 172, y 84.
  const B3 = { x: ROW_HEADER + COLUMN, y: COLUMN_HEADER + 2 * ROW };
  /// Un tratto sopra B3, in coordinate della lavagna.
  const ON_B3: [number, number][] = [
    [SHEET.x + B3.x + 8, SHEET.y + B3.y + 6],
    [SHEET.x + B3.x + 40, SHEET.y + B3.y + 12],
    [SHEET.x + B3.x + 80, SHEET.y + B3.y + 20],
  ];
  /// L'SVG della cella dei tratti nella scheda, se li disegna.
  const cellSvg = (host: HTMLElement) => card(host, "fogli").querySelector<SVGElement>(".canvas-ink-card svg[data-ink-cell] > svg");
  /// Dove la scheda mette l'angolo della cella dei tratti.
  const at = (host: HTMLElement) => {
    const inner = cellSvg(host);
    return inner ? [Number(inner.getAttribute("x")), Number(inner.getAttribute("y"))] : null;
  };

  it("scrive sopra B3; il foglio scorre e il tratto segue B3, sparisce quando esce e ricompare quando torna", () => {
    const { host, changes, sheet } = sheetMounted();
    pen(host, card(host, "fogli"), ON_B3);
    expect(changes).toHaveLength(1);
    const [stroke] = strokesOf(changes[0]!.text, "fogli");
    expect(stroke!.anchor).toEqual({ kind: "cell", sheet: "Conti 2025", cell: "B3" });
    // In pixel del foglio dall'angolo di B3.
    expect(String(stroke!.ink)).toMatch(/^1 s100 c[a-z]+ 800,600,/);
    const id = String(stroke!.id);
    expect(drawn(host, "fogli")).toEqual([id]);
    expect(at(host)).toEqual([B3.x, B3.y]);
    // Tagliato alla scheda; dentro, i pixel del foglio al 100%.
    const clipped = card(host, "fogli").querySelector<SVGElement>(".canvas-ink-card svg[data-ink-cell]")!;
    expect(clipped.style.overflow).toBe("hidden");
    expect(cellSvg(host)!.getAttribute("viewBox")).toBe(`0 0 ${COLUMN} ${ROW}`);

    // Tre righe giù, in due volte: due, e B3 è la prima riga, il tratto con
    // lei, subito; la terza, B3 esce e il tratto non c'è.
    sheet.scroll(2);
    expect(at(host)).toEqual([B3.x, COLUMN_HEADER]);
    sheet.scroll(1);
    expect(drawn(host, "fogli")).toEqual([]);
    // Tre righe su: B3 torna al suo posto, e il tratto con lei.
    sheet.scroll(-3);
    expect(drawn(host, "fogli")).toEqual([id]);
    expect(at(host)).toEqual([B3.x, B3.y]);
    // Lo zoom della lavagna col foglio scorso non cambia il posto nella scheda.
    sheet.scroll(1);
    const before = camera(host).zoom;
    const tick = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    Object.defineProperties(tick, { ctrlKey: { value: true }, clientX: { value: 100 }, clientY: { value: 100 } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(tick);
    expect(camera(host).zoom).not.toBe(before);
    expect(at(host)).toEqual([B3.x, B3.y - ROW]);
    // Il foglio rinominato altrove: la cella non c'è più, il tratto resta nel file.
    sheet.rename("Altro");
    expect(drawn(host, "fogli")).toEqual([]);
    sheet.rename("Conti 2025");
    expect(drawn(host, "fogli")).toEqual([id]);
    // Scorrere non scrive.
    expect(changes).toHaveLength(1);
  });

  it("sopra le intestazioni il tratto è della scheda, come in N4", () => {
    const { host, changes } = sheetMounted();
    pen(host, card(host, "fogli"), [[SHEET.x + 100, SHEET.y + 6], [SHEET.x + 140, SHEET.y + 10], [SHEET.x + 180, SHEET.y + 14]]);
    const [stroke] = strokesOf(changes[0]!.text, "fogli");
    expect(stroke!.anchor).toEqual({ kind: "card", width: SHEET.width, height: SHEET.height });
  });

  it("la gomma prende il tratto di cella dove si vede dopo lo scorrimento, non dove era", () => {
    const { host, changes, sheet } = sheetMounted();
    pen(host, card(host, "fogli"), ON_B3);
    const id = String(strokesOf(changes[0]!.text, "fogli")[0]!.id);
    sheet.scroll(2);
    const across = SHEET.x + B3.x + 40;
    // Dove B3 era: niente.
    eraser(host, card(host, "fogli"), [[across, SHEET.y + B3.y], [across, SHEET.y + B3.y + 30]]);
    expect(changes).toHaveLength(1);
    // Dove B3 è adesso: il tratto va via.
    eraser(host, card(host, "fogli"), [[across, SHEET.y + COLUMN_HEADER - 5], [across, SHEET.y + COLUMN_HEADER + 30]]);
    expect(changes).toHaveLength(2);
    expect(strokesOf(changes[1]!.text, "fogli").map((each) => each.id)).not.toContain(id);
  });

  it("un file con l'ancora di cella si apre sulla sua cella; un'ancora che non vale resta nel file e non si vede", () => {
    const brush = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const layer = {
      v: 1,
      strokes: [
        { id: "b", tool: "pen", brush, color: "#0072b2", anchor: { kind: "cell", sheet: "Conti 2025", cell: "C4" }, ink: "1 s100 cxy 500,500 100,100" },
        { id: "z", tool: "pen", brush, color: "#0072b2", anchor: { kind: "cell", sheet: "Conti 2025", cell: "b4" }, ink: "1 s100 cxy 500,500 100,100" },
      ],
    };
    const source = JSON.stringify({ nodes: [{ ...SHEET, "fub:ink": layer }], edges: [] });
    const { engine, host, sheet } = sheetMounted(source);
    expect(drawn(host, "fogli")).toEqual(["b"]);
    expect(at(host)).toEqual([ROW_HEADER + 2 * COLUMN, COLUMN_HEADER + 3 * ROW]);
    sheet.scroll(4);
    expect(drawn(host, "fogli")).toEqual([]);
    expect(engine.getDoc()).toBe(source);
  });
});

const ERASER_PEN = { pointerId: 9, pointerType: "pen" } as const;

/// Una passata del retro della penna sui punti `world` della lavagna.
function eraser(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[]): void {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  target.dispatchEvent(pointerEvent("pointerdown", { ...ERASER_PEN, ...at(world[0]!), button: 5, buttons: 32, pressure: 0.5, timeStamp: clock }));
  for (const point of world.slice(1)) {
    clock += 8;
    target.dispatchEvent(pointerEvent("pointermove", { ...ERASER_PEN, ...at(point), button: -1, buttons: 32, pressure: 0.5, timeStamp: clock }));
  }
  const end = clock + 4;
  clock += 100;
  document.dispatchEvent(pointerEvent("pointerup", { ...ERASER_PEN, ...at(world[world.length - 1]!), button: 5, buttons: 0, pressure: 0, timeStamp: end }));
}
