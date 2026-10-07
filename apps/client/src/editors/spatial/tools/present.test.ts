// @vitest-environment happy-dom
// Presentare: le tavole una alla volta, coi tasti, il mouse e il dito; lo
// schermo di fine, gli schermi vuoti, il laser e l'inchiostro che svanisce;
// lo schermo intero e il riquadro fisso; ciò che la presentazione dice, e
// che il disegno resta com'era.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { INK_MS, present, slidesOf, START_MS, STILL_MS, type Presentation, type PresentOptions } from "./present";
import { LAYER } from "./test-support";

/// Una tavola larga 400 e alta 200, al posto `n` della fila.
const view = (id: string, n: number, title: string, desc = ""): string =>
  `<view id="${id}" fub:role="board" viewBox="${n * 480} 0 400 200"><title>${title}</title>${desc === "" ? "" : `<desc>${desc}</desc>`}</view>`;

const IDS = ["b00000001", "b00000002", "b00000003", "b00000004", "b00000005"] as const;
const NAMES = ["Copertina", "Evaporazione", "Condensazione", "Pioggia", "Ritorno"] as const;

const BOARDS = doc(
  `<title>Il ciclo dell’acqua</title>`
    + IDS.map((id, n) => view(id, n, NAMES[n]!, n === 1 ? "Il sole  scalda\n il mare." : "")).join("")
    + `${LAYER}<rect id="o1a2b3c4d" x="10" y="10" width="20" height="20" fill="#336699"/></g>`,
);

/// I caratteri dell'app, senza leggerli.
const FONTS = { now: (): string => "", load: async (): Promise<string> => "" };

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;
const PEN = { pointerId: 7, pointerType: "pen" } as const;
const FINGER = { pointerId: 11, pointerType: "touch" } as const;

let owner: Lifetime;
let shown: Presentation | null;
let exits: (string | null)[];
let urls: { url: string; blob: Blob }[];
let revoked: string[];
let clock = 100;

beforeEach(() => {
  vi.useFakeTimers();
  owner = openLifetime();
  shown = null;
  exits = [];
  urls = [];
  revoked = [];
  // happy-dom non misura: lo schermo è 1000 per 500, e una tavola 400 per
  // 200 lo riempie.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:fub/${urls.length + 1}`;
    urls.push({ url, blob: blob as Blob });
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));
});

afterEach(() => {
  owner.close();
  setReducedMotionPreference(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function start(text = BOARDS, extra: Partial<PresentOptions> = {}): Presentation {
  const engine = SceneEngine.open(text);
  shown = present({ text, model: engine.model!, page: null, extent: null, from: null, fonts: FONTS, onExit: (id) => exits.push(id), ...extra }, owner);
  return shown;
}

/// Lascia finire le preparazioni delle immagini, che non aspettano timer.
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

const root = (): HTMLElement => shown!.element;
const stage = (): HTMLElement => root().querySelector<HTMLElement>(".draw-present-stage")!;
const said = (): string => (root().querySelector('[role="status"]')?.textContent ?? "").trim();
const images = (): HTMLImageElement[] => [...root().querySelectorAll<HTMLImageElement>("img.draw-present-board")];
/// L'immagine che si vede, per il suo testo alternativo; `null` se nessuna.
const seen = (): string | null => images().find((img) => !img.hidden)?.alt ?? null;
const endScreen = (): HTMLElement => root().querySelector<HTMLElement>(".draw-present-end")!;
const cover = (): HTMLElement => root().querySelector<HTMLElement>(".draw-present-blank")!;
const laser = (): HTMLElement => root().querySelector<HTMLElement>(".draw-present-laser")!;
const strokes = (): SVGPathElement[] => [...root().querySelectorAll<SVGPathElement>(".draw-present-ink path")];

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

/// Un evento del puntatore sullo stage; `pointerleave`, che non risale,
/// sulla presentazione, che il puntatore lascia uscendo dalla finestra.
function pointer(type: string, init: PointerEventInit): void {
  const event = new PointerEvent(type, { bubbles: type !== "pointerleave", cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, ...init });
  Object.defineProperty(event, "timeStamp", { value: (clock += 8) });
  (type === "pointerleave" ? root() : stage()).dispatchEvent(event);
}

/// Un trascinamento, o un clic se i punti sono uno solo.
function drag(points: readonly (readonly [number, number])[], who: PointerEventInit = MOUSE): void {
  const [x0, y0] = points[0]!;
  pointer("pointerdown", { ...who, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0 });
  for (const [x, y] of points.slice(1)) pointer("pointermove", { ...who, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y });
  const [x1, y1] = points[points.length - 1]!;
  pointer("pointerup", { ...who, button: 0, buttons: 0, pressure: 0, clientX: x1, clientY: y1 });
}

/// Il dito che scorre da `from` a `to`.
function swipe(from: readonly [number, number], to: readonly [number, number]): void {
  pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, clientX: from[0], clientY: from[1] });
  pointer("pointermove", { ...FINGER, button: -1, buttons: 1, clientX: to[0], clientY: to[1] });
  pointer("pointerup", { ...FINGER, button: 0, buttons: 0, clientX: to[0], clientY: to[1] });
}

const board = (n: number): string => `${NAMES[n - 1]}, tavola ${n} di 5.`;

describe("le tavole della presentazione", () => {
  it("sono quelle del disegno nel loro ordine, col nome e la descrizione", () => {
    const engine = SceneEngine.open(BOARDS);
    const slides = slidesOf({ text: BOARDS, model: engine.model!, page: null, extent: null });
    expect(slides.map((slide) => slide.id)).toEqual(IDS);
    expect(slides.map((slide) => slide.alt)).toEqual(["Copertina", "Evaporazione. Il sole scalda il mare.", "Condensazione", "Pioggia", "Ritorno"]);
    expect(slides[2]!.rect).toEqual([960, 0, 400, 200]);
  });

  it("senza tavole sono una sola: la pagina, o ciò che il disegno disegna con un margine", () => {
    const paged = doc(`<title>Schizzo</title><desc>Una prova.</desc>${LAYER}<rect id="o1a2b3c4d" x="10" y="10" width="20" height="20"/></g>`);
    const model = SceneEngine.open(paged).model!;
    expect(slidesOf({ text: paged, model, page: { x: 0, y: 0, width: 100, height: 100 }, extent: null })).toEqual([
      { id: null, name: "Schizzo", alt: "Schizzo. Una prova.", rect: [0, 0, 100, 100] },
    ]);
    const bare = doc(`${LAYER}<rect id="o1a2b3c4d" x="10" y="10" width="20" height="20"/></g>`);
    const loose = SceneEngine.open(bare).model!;
    expect(slidesOf({ text: bare, model: loose, page: { x: 0, y: 0, width: 100, height: 100 }, extent: null })[0]!.name).toBe("Pagina");
    // Il margine è il 2 % del lato più lungo, e il rettangolo si allarga ai
    // numeri interi.
    expect(slidesOf({ text: bare, model: loose, page: null, extent: { min: [10, 10], max: [110, 60] } })).toEqual([
      { id: null, name: "Il disegno", alt: "Il disegno", rect: [8, 8, 104, 54] },
    ]);
    expect(slidesOf({ text: bare, model: loose, page: null, extent: null })[0]!.rect).toBeNull();
  });
});

describe("presentare", () => {
  it("parte dalla prima tavola, la ritaglia come l'embed e la dice", async () => {
    start();
    expect(document.activeElement).toBe(stage());
    expect(root().getAttribute("role")).toBe("dialog");
    expect(said()).toBe("");
    vi.advanceTimersByTime(START_MS);
    expect(said()).toBe("Presentazione: Copertina, tavola 1 di 5. Esc per uscire.");
    await settle();
    expect(seen()).toBe("Copertina");
    const first = await urls[0]!.blob.text();
    expect(urls[0]!.blob.type).toBe("image/svg+xml");
    expect(first).toMatch(/^<svg[^>]* viewBox="0 0 400 200" width="400" height="200"/);
    // La tavola è al centro e il più grande possibile.
    const frame = root().querySelector<HTMLElement>(".draw-present-frame")!;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(["0px", "0px", "1000px", "500px"]);
    expect(checkAccessibility(root()), formatIssues(checkAccessibility(root()))).toEqual([]);
  });

  it("prepara la tavola di adesso, poi la seguente e la precedente, e libera le lontane", async () => {
    start(BOARDS, { from: IDS[1] });
    await settle();
    const boxes = await Promise.all(urls.map(async ({ blob }) => /viewBox="(\d+) /.exec(await blob.text())![1]));
    expect(boxes).toEqual(["480", "960", "0"]);
    key("End");
    await settle();
    // Restano le tavole a due passi dall'ultima: la prima e la seconda se ne
    // vanno.
    expect(images().map((img) => img.alt).sort()).toEqual(["Condensazione", "Pioggia", "Ritorno"]);
    expect(revoked.sort()).toEqual(["blob:fub/1", "blob:fub/3"]);
    shown!.close();
    expect(revoked.sort()).toEqual(urls.map(({ url }) => url).sort());
    expect(document.querySelector(".draw-present")).toBeNull();
  });

  it("trova la tavola da cui parte per id, non per nome", async () => {
    const twins = doc(`${view("b00000001", 0, "Uguale")}${view("b00000002", 1, "Uguale")}`);
    start(twins, { from: "b00000002" });
    vi.advanceTimersByTime(START_MS);
    expect(said()).toBe("Presentazione: Uguale, tavola 2 di 2. Esc per uscire.");
    key("Escape");
    expect(exits).toEqual(["b00000002"]);
  });

  it("un disegno senza tavole è una tavola sola, e il passo dopo è la fine", async () => {
    const paged = doc(`<title>Schizzo</title>${LAYER}<rect id="o1a2b3c4d" x="10" y="10" width="20" height="20"/></g>`);
    start(paged, { page: { x: 0, y: 0, width: 100, height: 100 } });
    await settle();
    expect(seen()).toBe("Schizzo");
    expect(await urls[0]!.blob.text()).toMatch(/viewBox="0 0 100 100" width="100" height="100"/);
    key("ArrowRight");
    expect(endScreen().hidden).toBe(false);
    key("ArrowRight");
    expect(exits).toEqual([null]);
  });
});

describe("muoversi fra le tavole", () => {
  it("coi tasti avanti e indietro, la prima e l'ultima", async () => {
    start();
    for (const name of ["ArrowRight", "ArrowDown", " ", "PageDown"]) {
      const event = key(name);
      expect(event.defaultPrevented, name).toBe(true);
    }
    expect(said()).toBe(board(5));
    for (const name of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) key(name);
    expect(said()).toBe(board(1));
    key("n");
    key("Enter");
    expect(said()).toBe(board(3));
    key("p");
    expect(said()).toBe(board(2));
    key("End");
    await settle();
    expect(said()).toBe(board(5));
    expect(seen()).toBe("Ritorno");
    key("Home");
    expect(said()).toBe(board(1));
  });

  it("dalla prima non torna all'ultima, e dopo l'ultima c'è lo schermo di fine", async () => {
    start();
    key("ArrowLeft");
    expect(said()).toBe("Copertina è la prima tavola.");
    key("End");
    key("ArrowRight");
    expect(endScreen().hidden).toBe(false);
    expect(endScreen().textContent).toContain("Fine della presentazione");
    expect(seen()).toBeNull();
    expect(said()).toBe("Fine della presentazione. Un altro passo avanti, o Esc, per uscire.");
    key("ArrowLeft");
    expect(endScreen().hidden).toBe(true);
    expect(said()).toBe(board(5));
    key("ArrowRight");
    expect(exits).toEqual([]);
    key(" ");
    expect(exits).toEqual([IDS[4]]);
    expect(document.querySelector(".draw-present")).toBeNull();
  });

  it("un numero e Invio vanno alla tavola con quel numero", () => {
    start();
    key("4");
    expect(said()).toBe("");
    key("Enter");
    expect(said()).toBe(board(4));
    key("1");
    key("2");
    key("Backspace");
    key("Enter");
    expect(said()).toBe(board(1));
    key("9");
    key("Enter");
    expect(said()).toBe("Non c’è la tavola 9: le tavole sono 5.");
    // Un altro tasto lascia perdere il numero.
    key("3");
    key("ArrowRight");
    key("Enter");
    expect(said()).toBe(board(3));
  });

  it("un clic del mouse va avanti, un trascinamento no", () => {
    start();
    drag([[500, 250]]);
    expect(said()).toBe(board(2));
    drag([[500, 250], [502, 252]]);
    expect(said()).toBe(board(3));
    drag([[100, 100], [200, 150], [300, 200]]);
    expect(said()).toBe(board(3));
    // Il tasto destro non va avanti.
    pointer("pointerdown", { ...MOUSE, button: 2, buttons: 2, clientX: 10, clientY: 10 });
    pointer("pointerup", { ...MOUSE, button: 2, buttons: 0, clientX: 10, clientY: 10 });
    expect(said()).toBe(board(3));
  });

  it("il dito che scorre cambia tavola; toccare o scorrere in verticale no", () => {
    start();
    swipe([800, 250], [600, 260]);
    expect(said()).toBe(board(2));
    swipe([200, 250], [400, 240]);
    expect(said()).toBe(board(1));
    swipe([800, 250], [600, 260]);
    expect(said()).toBe(board(2));
    swipe([500, 100], [520, 300]);
    swipe([500, 250], [460, 250]);
    pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, clientX: 500, clientY: 250 });
    pointer("pointerup", { ...FINGER, button: 0, buttons: 0, clientX: 500, clientY: 250 });
    expect(said()).toBe(board(2));
    // Due dita sono un altro gesto.
    pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, clientX: 800, clientY: 250 });
    pointer("pointerdown", { pointerId: 12, pointerType: "touch", button: 0, buttons: 1, clientX: 800, clientY: 300 });
    pointer("pointerup", { ...FINGER, button: 0, buttons: 0, clientX: 600, clientY: 250 });
    pointer("pointerup", { pointerId: 12, pointerType: "touch", button: 0, buttons: 0, clientX: 600, clientY: 300 });
    expect(said()).toBe(board(2));
    expect(strokes()).toEqual([]);
  });

  it("il palmo di chi scrive con la penna non cambia tavola", () => {
    start();
    vi.advanceTimersByTime(START_MS);
    const first = said();
    expect(first).toContain(board(1));
    // La penna sospesa: il dito che scorre è il palmo.
    pointer("pointermove", { ...PEN, button: -1, buttons: 0, clientX: 300, clientY: 200 });
    swipe([800, 250], [600, 260]);
    expect(said()).toBe(first);
    // Il palmo già giù quando la penna si appoggia.
    pointer("pointerleave", { ...PEN, button: -1, buttons: 0, clientX: 300, clientY: 200 });
    pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, clientX: 800, clientY: 250 });
    drag([[300, 200], [340, 220]], PEN);
    pointer("pointerup", { ...FINGER, button: 0, buttons: 0, clientX: 600, clientY: 250 });
    expect(said()).toBe(first);
    expect(strokes()).toHaveLength(1);
    // La penna lontana: il dito torna a scorrere.
    pointer("pointerleave", { ...PEN, button: -1, buttons: 0, clientX: 340, clientY: 220 });
    swipe([800, 250], [600, 260]);
    expect(said()).toBe(board(2));
  });

  it("i tasti restano nella presentazione, e quelli con Ctrl vanno al browser", () => {
    start();
    const below = vi.fn();
    document.addEventListener("keydown", below);
    try {
      key("ArrowRight");
      key("z");
      const reload = key("F5");
      expect(reload.defaultPrevented).toBe(true);
      const zoom = key("ArrowRight", { ctrlKey: true });
      expect(zoom.defaultPrevented).toBe(false);
      expect(below).not.toHaveBeenCalled();
      expect(said()).toBe(board(2));
    } finally {
      document.removeEventListener("keydown", below);
    }
  });
});

describe("gli schermi vuoti", () => {
  it("B e W, o il punto e la virgola, li mettono e li tolgono senza muoversi", () => {
    start();
    key("ArrowRight");
    key("b");
    expect(cover().hidden).toBe(false);
    expect(cover().dataset.blank).toBe("black");
    expect(said()).toBe("Schermo nero.");
    key("B");
    expect(cover().hidden).toBe(true);
    expect(said()).toBe(board(2));
    key(",");
    expect(cover().dataset.blank).toBe("white");
    expect(said()).toBe("Schermo bianco.");
    key(".");
    expect(cover().dataset.blank).toBe("black");
    // Un passo, avanti o indietro, toglie lo schermo vuoto e resta dov'è.
    key("ArrowRight");
    expect(cover().hidden).toBe(true);
    expect(said()).toBe(board(2));
    key("w");
    key("ArrowLeft");
    expect(said()).toBe(board(2));
    key("W");
    key("End");
    expect(said()).toBe(board(2));
    // Tenere premuto non lampeggia.
    key("b");
    key("b", { repeat: true });
    expect(cover().dataset.blank).toBe("black");
    // Un numero e Invio vanno dove dicono.
    key("4");
    key("Enter");
    expect(cover().hidden).toBe(true);
    expect(said()).toBe(board(4));
  });

  it("dallo schermo di fine, lo schermo vuoto torna alla fine", () => {
    start();
    key("End");
    key("ArrowRight");
    key("b");
    key("ArrowRight");
    expect(exits).toEqual([]);
    expect(said()).toBe("Fine della presentazione. Un altro passo avanti, o Esc, per uscire.");
  });
});

describe("il laser", () => {
  it("segue il mouse e la penna sospesa, e sparisce fermo tre secondi", () => {
    start();
    expect(laser().hidden).toBe(true);
    expect(root().hasAttribute("data-laser")).toBe(true);
    pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 200 });
    expect(laser().hidden).toBe(false);
    expect(laser().style.transform).toBe("translate(300px, 200px)");
    expect(root().hasAttribute("data-still")).toBe(false);
    vi.advanceTimersByTime(STILL_MS - 1);
    expect(laser().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(laser().hidden).toBe(true);
    expect(root().hasAttribute("data-still")).toBe(true);
    pointer("pointermove", { ...PEN, button: -1, buttons: 0, pressure: 0, clientX: 40, clientY: 50 });
    expect(laser().hidden).toBe(false);
    expect(laser().style.transform).toBe("translate(40px, 50px)");
    pointer("pointerleave", { ...PEN, button: -1, buttons: 0, clientX: 40, clientY: 50 });
    expect(laser().hidden).toBe(true);
  });

  it("L lo spegne e lo riaccende, e lo dice; spento, il cursore sparisce fermo", () => {
    start();
    key("l");
    expect(said()).toBe("Laser spento.");
    expect(root().hasAttribute("data-laser")).toBe(false);
    pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 200 });
    expect(laser().hidden).toBe(true);
    expect(root().hasAttribute("data-still")).toBe(false);
    vi.advanceTimersByTime(STILL_MS);
    expect(root().hasAttribute("data-still")).toBe(true);
    key("L");
    expect(said()).toBe("Laser acceso.");
    expect(root().hasAttribute("data-laser")).toBe(true);
  });
});

describe("l'inchiostro", () => {
  it("il mouse trascinato scrive in rosso, e il tratto svanisce tre secondi dopo la fine", () => {
    start();
    drag([[100, 100], [200, 150], [300, 200]]);
    expect(strokes()).toHaveLength(1);
    const stroke = strokes()[0]!;
    expect(stroke.getAttribute("d")).toMatch(/^M/);
    vi.advanceTimersByTime(INK_MS - 1);
    expect(stroke.hasAttribute("data-fading")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(stroke.hasAttribute("data-fading")).toBe(true);
    // La fine della transizione lo toglie.
    stroke.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(strokes()).toEqual([]);
    // Senza transizione, si toglie lo stesso.
    drag([[100, 100], [300, 200]], PEN);
    expect(strokes()).toHaveLength(1);
    vi.advanceTimersByTime(INK_MS);
    expect(strokes()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(strokes()).toEqual([]);
  });

  it("la penna scrive anche un punto, e il dito no", () => {
    start();
    drag([[500, 250]], PEN);
    expect(strokes()).toHaveLength(1);
    expect(said()).toBe("");
    swipe([500, 250], [510, 250]);
    expect(strokes()).toHaveLength(1);
  });

  it("col moto ridotto svanisce di colpo", () => {
    setReducedMotionPreference(true);
    start();
    drag([[100, 100], [300, 200]]);
    expect(strokes()).toHaveLength(1);
    vi.advanceTimersByTime(INK_MS);
    expect(strokes()).toEqual([]);
  });

  it("E lo cancella tutto, e cambiare tavola o schermo lo toglie", () => {
    start();
    key("e");
    expect(said()).toBe("Non c’è inchiostro da cancellare.");
    drag([[100, 100], [300, 200]]);
    drag([[400, 100], [600, 200]]);
    expect(strokes()).toHaveLength(2);
    key("E");
    expect(strokes()).toEqual([]);
    expect(said()).toBe("Inchiostro cancellato.");
    drag([[100, 100], [300, 200]]);
    key("ArrowRight");
    expect(strokes()).toEqual([]);
    drag([[100, 100], [300, 200]]);
    key("w");
    expect(strokes()).toEqual([]);
    // Sullo schermo vuoto non si scrive.
    drag([[100, 100], [300, 200]]);
    expect(strokes()).toEqual([]);
  });

  it("non entra nel disegno", async () => {
    const text = BOARDS;
    const engine = SceneEngine.open(text);
    start(text, { model: engine.model! });
    drag([[100, 100], [300, 200]]);
    key("ArrowRight");
    await settle();
    key("Escape");
    expect(engine.text).toBe(text);
    for (const { blob } of urls) expect(await blob.text()).not.toContain("draw-present");
  });
});

describe("uscire", () => {
  it("Esc esce e dice all'editor la tavola dov'era arrivata", () => {
    start();
    key("ArrowRight");
    key("ArrowRight");
    const escape = key("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(exits).toEqual([IDS[2]]);
    expect(document.querySelector(".draw-present")).toBeNull();
    // Il primo annuncio non arriva dopo l'uscita.
    vi.advanceTimersByTime(START_MS);
  });

  it("il fuoco torna dov'era", () => {
    const sheet = document.createElement("div");
    sheet.tabIndex = 0;
    document.body.append(sheet);
    sheet.focus();
    start();
    expect(document.activeElement).toBe(stage());
    key("Escape");
    expect(document.activeElement).toBe(sheet);
  });

  it("senza la Fullscreen API è un riquadro fisso, con gli stessi tasti", () => {
    expect(typeof HTMLElement.prototype.requestFullscreen).not.toBe("function");
    start();
    expect(root().parentElement).toBe(document.body);
    expect(root().classList.contains("draw-present")).toBe(true);
    key("ArrowRight");
    expect(said()).toBe(board(2));
    key("Escape");
    expect(exits).toEqual([IDS[1]]);
  });

  describe("con lo schermo intero", () => {
    let full: Element | null;
    let request: ReturnType<typeof vi.fn>;
    let exit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      full = null;
      request = vi.fn(function (this: HTMLElement) {
        full = this;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      });
      exit = vi.fn(() => {
        full = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      });
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, writable: true, value: request });
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
      Object.defineProperty(document, "exitFullscreen", { configurable: true, writable: true, value: exit });
    });

    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
      delete (document as Partial<Document> & { fullscreenElement?: unknown }).fullscreenElement;
      delete (document as Partial<Document>).exitFullscreen;
    });

    it("la presentazione lo chiede per sé, e lo lascia quando esce", () => {
      start();
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.contexts[0]).toBe(root());
      expect(request.mock.calls[0]).toEqual([{ navigationUI: "hide" }]);
      expect(full).toBe(root());
      key("ArrowRight");
      key("Escape");
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exits).toEqual([IDS[1]]);
    });

    it("uscire dallo schermo intero da fuori esce dalla presentazione", () => {
      start();
      key("End");
      full = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      expect(exits).toEqual([IDS[4]]);
      expect(document.querySelector(".draw-present")).toBeNull();
    });

    it("rifiutato, resta il riquadro fisso", async () => {
      request.mockImplementation(() => Promise.reject(new Error("no")));
      start();
      await settle();
      key("ArrowRight");
      expect(said()).toBe(board(2));
      document.dispatchEvent(new Event("fullscreenchange"));
      expect(exits).toEqual([]);
    });
  });

  it("l'editor che se ne va la porta via senza dirgli niente, e una sola è aperta", () => {
    const first = start();
    expect(start()).toBe(first);
    expect(document.querySelectorAll(".draw-present")).toHaveLength(1);
    owner.close();
    expect(document.querySelector(".draw-present")).toBeNull();
    expect(exits).toEqual([]);
    owner = openLifetime();
    expect(start()).not.toBe(first);
  });

  it("con l'editor già andato non resta niente, e la prossima si apre", () => {
    owner.close();
    start();
    expect(document.querySelector(".draw-present")).toBeNull();
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(START_MS);
    owner = openLifetime();
    const next = start();
    expect(document.querySelectorAll(".draw-present")).toHaveLength(1);
    expect(next.element.isConnected).toBe(true);
  });
});
