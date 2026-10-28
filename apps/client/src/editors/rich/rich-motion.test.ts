// @vitest-environment happy-dom
//
// Il moto della carta: il punto di lettura resta dov'era quando la modalità
// cambia, e un foglio nasce o si toglie con una corsa soltanto quando lo fa
// ciò che si scrive. Un documento aperto o cambiato da fuori non muove niente.
//
// happy-dom non impagina: i rettangoli vengono da una scrivania finta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../moto";
import { RichEngine } from "./engine";
import { keepReadingPoint, lineBoxes, readingPoint, RichMotion } from "./rich-motion";
import type { Block, Page } from "./projection";
import { PX_PER_PT } from "./sheets";

let engines: RichEngine[] = [];
let driver: ManualDriver | null = null;
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
  setMotionDriver(null);
  setMotionPreference("system");
  driver = null;
});

const rect = (top: number, height: number, width = 0) => ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe("il punto di lettura", () => {
  /// Una vista che scorre su tre blocchi alti 100 px, dopo `lead` px.
  function column() {
    const page = document.createElement("div");
    const content = document.createElement("div");
    const blocks = [0, 1, 2].map(() => content.appendChild(document.createElement("p")));
    page.append(content);
    document.body.append(page);
    const layout = { lead: 0 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const i = blocks.indexOf(this as HTMLParagraphElement);
      if (i >= 0) return rect(layout.lead + 100 * i - page.scrollTop, 100);
      return rect(0, 300);
    });
    return { page, content, blocks, layout };
  }

  it("il paragrafo in cima alla vista prima del cambio è in cima anche dopo", () => {
    const { page, content, blocks, layout } = column();
    page.scrollTop = 130;
    const point = readingPoint(page, content, 0)!;
    expect(point.block).toBe(blocks[1]);
    expect(point.ratio).toBeCloseTo(0.3, 6);
    // In Pagina il testo comincia sotto il margine del foglio: 96 px più giù.
    layout.lead = 96;
    expect(keepReadingPoint(page, point)).toBe(true);
    expect(page.scrollTop).toBe(226);
    expect(readingPoint(page, content, 0)).toEqual(point);
  });

  it("senza blocchi non c'è un punto, e un blocco tolto non si insegue", () => {
    const { page, content, blocks } = column();
    const point = readingPoint(page, content, 0)!;
    blocks[0]!.remove();
    expect(keepReadingPoint(page, point)).toBe(false);
    content.replaceChildren();
    expect(readingPoint(page, content, 0)).toBeNull();
  });
});

const LETTER: Page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
const para = (x: string): Block => ({ t: "para", role: { kind: "body" }, c: [{ t: "text", x }] }) as Block;

/// Come in `sheets.test.ts`: ogni spazio comincia a 400 px più 300 per ognuno
/// prima, più l'altezza degli spazi prima.
function fakeDesk(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("rich-desk")) return rect(0, 6000, LETTER.w * PX_PER_PT);
    const gaps = [...document.querySelectorAll<HTMLElement>(".rich-sheet-gap")];
    const heights = gaps.map((gap) => Number.parseFloat(gap.style.height) || 0);
    const at = (i: number) => 400 + 300 * i + heights.slice(0, i).reduce((a, b) => a + b, 0);
    const index = gaps.indexOf(this);
    if (index >= 0) return rect(at(index), heights[index]!);
    return rect(0, at(gaps.length));
  });
}

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, page: LETTER, blocks }));
  engines.push(made);
  return made;
}

/// La misura dei fogli, come al fotogramma dopo una modifica.
const measure = (e: RichEngine) => e.editRunning("footer") && document.querySelector<HTMLElement>(".rich-running-area")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const sheetPlays = () => driver!.plays.filter((play) => play.el.classList.contains("rich-sheet-paper") || play.el.classList.contains("rich-sheet-ghost"));
/// Le corse che non sono l'attenuazione del corpo mentre `measure` apre il piè.
const notDimming = () => driver!.plays.filter((play) => !play.keyframes.every((frame) => Object.keys(frame).every((key) => key === "opacity" || key === "offset")));

describe("il foglio che nasce", () => {
  it("aperto o cambiato da fuori non muove niente; un salto scritto apre un foglio che esce da quello sopra", () => {
    fakeDesk();
    driver = createManualDriver();
    setMotionDriver(driver);
    const e = engine([para("uno\u000cdue"), para("tre")]);
    measure(e);
    expect(document.querySelectorAll(".rich-sheets > .rich-sheet")).toHaveLength(2);
    // Un documento che arriva da fuori con un foglio in più.
    e.syncDoc(JSON.stringify({ format: "fub-rich", version: 1, page: LETTER, blocks: [para("uno\u000cdue\u000ctre"), para("quattro")] }));
    measure(e);
    expect(document.querySelectorAll(".rich-sheets > .rich-sheet")).toHaveLength(3);
    expect(notDimming()).toHaveLength(0);
    // Un salto scritto in fondo: il foglio nuovo esce dal bordo di quello sopra.
    e.select(e.state.doc.content.size - 1);
    expect(e.run("rich.break.page")).toBe(true);
    measure(e);
    const sheets = [...document.querySelectorAll<HTMLElement>(".rich-sheets > .rich-sheet")];
    expect(sheets).toHaveLength(4);
    const entered = sheetPlays().find((play) => play.el === sheets[3]!.firstElementChild);
    expect(entered?.keyframes[0]?.opacity).toBe(0);
    // Il testo non si muove: nessuna corsa fuori dalle sagome.
    expect(notDimming().every((play) => play.el.classList.contains("rich-sheet-paper"))).toBe(true);
  });

  it("un salto scritto in mezzo apre un elemento nuovo: i fogli dopo restano i loro", () => {
    fakeDesk();
    driver = createManualDriver();
    setMotionDriver(driver);
    const e = engine([para("uno\u000cdue"), para("tre")]);
    measure(e);
    const [first, second] = [...document.querySelectorAll<HTMLElement>(".rich-sheets > .rich-sheet")];
    e.select(2);
    e.run("rich.break.page");
    measure(e);
    const opened = [...document.querySelectorAll<HTMLElement>(".rich-sheets > .rich-sheet")];
    expect(opened).toHaveLength(3);
    expect([opened[0], opened[2]]).toEqual([first, second]);
    expect(opened[1]!.firstElementChild?.className).toBe("rich-sheet-paper");
    // Tolto il salto, se ne va il suo elemento, e il foglio dopo resta il suo.
    e.run("text.undo");
    measure(e);
    const closed = [...document.querySelectorAll<HTMLElement>(".rich-sheets > .rich-sheet")];
    expect(closed).toHaveLength(2);
    expect(closed[0]).toBe(first);
    expect(closed[1]).toBe(second);
  });

  it("tolto il salto, la sua sagoma si dissolve e non resta", async () => {
    fakeDesk();
    driver = createManualDriver();
    setMotionDriver(driver);
    const e = engine([para("uno\u000cdue"), para("tre")]);
    measure(e);
    e.select(e.state.doc.content.size - 1);
    e.run("rich.break.page");
    measure(e);
    e.run("text.undo");
    measure(e);
    expect(document.querySelectorAll(".rich-sheets > .rich-sheet")).toHaveLength(2);
    const ghost = sheetPlays().find((play) => play.el.classList.contains("rich-sheet-ghost"));
    expect(ghost).toBeDefined();
    // Un disegno che arriva mentre si dissolve non la toglie a metà.
    e.syncDoc(JSON.stringify({ format: "fub-rich", version: 1, page: LETTER, blocks: [para("uno\u000cdue"), para("tre!")] }));
    measure(e);
    expect(ghost!.el.isConnected).toBe(true);
    driver.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".rich-sheet-ghost")).toBeNull();
  });
});

describe("l'intestazione sul foglio", () => {
  it("il corpo si attenua a 0,45 in 220 ms e torna; dall'intestazione al piè resta attenuato", () => {
    fakeDesk();
    driver = createManualDriver();
    setMotionDriver(driver);
    const e = engine([para("uno"), para("due")]);
    const content = document.querySelector<HTMLElement>(".rich-content")!;
    const dims = () => driver!.plays.filter((play) => play.el === content);
    expect(e.editRunning("header")).toBe(true);
    expect(dims()).toHaveLength(1);
    const opening = dims()[0]!;
    expect(opening.timing.duration).toBe(220);
    expect([opening.keyframes[0]?.opacity, opening.keyframes[opening.keyframes.length - 1]?.opacity]).toEqual([1, 0.45]);
    expect(document.querySelector(".rich-desk-running")).not.toBeNull();
    // Il piè al posto dell'intestazione: nessuna corsa nuova.
    expect(e.editRunning("footer")).toBe(true);
    expect(dims()).toHaveLength(1);
    driver.advance(400);
    document.querySelector<HTMLElement>(".rich-running-area")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rich-desk-running")).toBeNull();
    expect(dims()).toHaveLength(2);
    expect(dims()[1]!.keyframes[0]?.opacity).toBe(0.45);
    driver.advance(400);
    expect(content.getAttribute("style") ?? "").not.toContain("opacity");
  });
});

describe("andare a un punto", () => {
  /// Una vista alta 300 px su una scrivania alta 3000, con lo zoom a 1.
  function view() {
    const page = document.createElement("div");
    const desk = page.appendChild(document.createElement("div"));
    const layer = desk.appendChild(document.createElement("div"));
    const content = desk.appendChild(document.createElement("div"));
    document.body.append(page);
    Object.defineProperty(page, "clientHeight", { value: 300 });
    Object.defineProperty(page, "scrollHeight", { value: 3000 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === desk) return rect(-page.scrollTop, 3000, 800);
      return rect(0, 300, 800);
    });
    const motion = new RichMotion({ page, desk, layer, content: () => content, scale: () => 1, measure: () => undefined });
    return { page, desk, motion };
  }
  const line = (top: number, left = 100, width = 200) => ({ top, left, width, height: 20 });

  it("i rettangoli del testo si uniscono in una riga per altezza", () => {
    expect(lineBoxes([line(40, 300, 50), line(10, 100, 80), line(12, 180, 40), { top: 50, left: 0, width: 5, height: 0 }])).toEqual([
      { left: 100, top: 10, width: 120, height: 22 },
      { left: 300, top: 40, width: 50, height: 20 },
    ]);
  });

  it("un punto fuori vista arriva a un terzo; poi l'anello si stringe, sfuma e se ne va", async () => {
    driver = createManualDriver();
    setMotionDriver(driver);
    const { page, desk, motion } = view();
    motion.goTo([line(1200), line(1220)], true);
    // L'anello aspetta che la vista sia arrivata.
    expect(desk.querySelector(".rich-goto-ring")).toBeNull();
    let rings: HTMLElement[] = [];
    for (let ms = 0; ms < 2000 && rings.length === 0; ms += 1000 / 60) {
      driver.advance(1000 / 60);
      rings = [...desk.querySelectorAll<HTMLElement>(".rich-goto-ring")];
    }
    expect(rings).toHaveLength(2);
    expect(Math.abs(page.scrollTop - 1100)).toBeLessThanOrEqual(24);
    // Sulla scrivania, dove sta il testo: scorre con lui.
    expect(rings[0]!.style.top).toBe("1200px");
    expect(rings[0]!.getAttribute("aria-hidden")).toBe("true");
    const play = driver.plays.find((p) => p.el === rings[0]);
    expect(play?.keyframes[0]?.opacity).toBe(1);
    expect(play?.keyframes[play.keyframes.length - 1]?.opacity).toBe(0);
    driver.advance(1000);
    expect(page.scrollTop).toBeCloseTo(1100, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.querySelector(".rich-goto-ring")).toBeNull();
    motion.destroy();
  });

  it("un punto che si vede già non fa scorrere; un salto nuovo toglie l'anello di prima", () => {
    driver = createManualDriver();
    setMotionDriver(driver);
    const { page, desk, motion } = view();
    motion.goTo([line(120)], true);
    motion.goTo([line(160)], true);
    driver.advance(1000);
    expect(page.scrollTop).toBe(0);
    expect(desk.querySelectorAll(".rich-goto-ring")).toHaveLength(1);
    motion.destroy();
    expect(desk.querySelector(".rich-goto-ring")).toBeNull();
  });

  it("nel livello ridotto lo scorrimento salta e l'anello non c'è", () => {
    driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    const { page, desk, motion } = view();
    motion.goTo([line(2000)], true);
    expect(page.scrollTop).toBe(1900);
    expect(desk.querySelector(".rich-goto-ring")).toBeNull();
    expect(driver.plays).toHaveLength(0);
    motion.destroy();
  });
});
