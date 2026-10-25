// @vitest-environment happy-dom
//
// Il moto della carta: il punto di lettura resta dov'era quando la modalità
// cambia, e un foglio nasce o si toglie con una corsa soltanto quando lo fa
// ciò che si scrive. Un documento aperto o cambiato da fuori non muove niente.
//
// happy-dom non impagina: i rettangoli vengono da una scrivania finta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualDriver, setMotionDriver, type ManualDriver } from "../../moto";
import { RichEngine } from "./engine";
import { keepReadingPoint, readingPoint } from "./rich-motion";
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
    expect(driver.plays).toHaveLength(0);
    // Un salto scritto in fondo: il foglio nuovo esce dal bordo di quello sopra.
    e.select(e.state.doc.content.size - 1);
    expect(e.run("rich.break.page")).toBe(true);
    measure(e);
    const sheets = [...document.querySelectorAll<HTMLElement>(".rich-sheets > .rich-sheet")];
    expect(sheets).toHaveLength(4);
    const entered = sheetPlays().find((play) => play.el === sheets[3]!.firstElementChild);
    expect(entered?.keyframes[0]?.opacity).toBe(0);
    // Il testo non si muove: nessuna corsa fuori dalle sagome.
    expect(driver.plays.every((play) => play.el.classList.contains("rich-sheet-paper"))).toBe(true);
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
    driver.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".rich-sheet-ghost")).toBeNull();
  });
});
