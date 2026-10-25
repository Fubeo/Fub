// @vitest-environment happy-dom
//
// I fogli di Pagina e di Lettura: un foglio per interruzione di pagina e per
// fine di sezione che comincia a pagina nuova, con l'intestazione e il piè
// che ne seguono. Sono della vista: il documento non cambia.
//
// happy-dom non impagina: la misura si prova con una scrivania finta, dove
// ogni spazio comincia dove il testo lo porterebbe, più gli spazi prima.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { sectionName } from "./breaks";
import { RichEngine } from "./engine";
import { DEFAULT_PAGE } from "./page";
import { parseProjection, type Block, type Page, type RunningText } from "./projection";
import { PX_PER_PT, SHEET_GAP, sheetAt, sheetLayout, sheetPlan, type Sheet } from "./sheets";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const LETTER: Page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
const NUMBERED: RunningText = { lines: [["Pagina ", { field: "page" }, " di ", { field: "pages" }]] };
const FOOT: RunningText = { lines: [["Riservato"]] };

const para = (x: string, extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c: [{ t: "text", x }] }) as Block;

/// Un salto pagina nel primo paragrafo; una sezione che continua sullo stesso
/// foglio e una che comincia alla pagina dopo. La prima sezione ha la sua
/// intestazione, l'ultima il suo piè.
const BLOCKS: readonly Block[] = [
  para("uno\u000cdue"),
  para("tre", { sect: "s1", page: LETTER, header: NUMBERED }),
  para("quattro", { sect: "s2", page: { ...LETTER, start: "continuous" } }),
  para("cinque"),
];

function engine(blocks: readonly Block[] = BLOCKS, head: object = { page: LETTER, footer: FOOT }): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...head, blocks }));
  engines.push(made);
  return made;
}

describe("il piano dei fogli", () => {
  it("un foglio per salto pagina e per sezione a pagina nuova, non per una che continua", () => {
    const e = engine();
    const plan = sheetPlan(e.state.doc);
    expect(plan.sections).toHaveLength(3);
    expect(plan.cuts.map((cut) => [cut.block, cut.name])).toEqual([
      [false, t("rich.break.page")],
      [true, sectionName(LETTER)],
    ]);
    // La sezione che continua non apre un foglio: il secondo foglio è della
    // prima sezione, il terzo dell'ultima.
    expect(plan.sheets.map((sheet) => sheet.section)).toEqual([0, 0, 2]);
    // L'intestazione della prima sezione vale anche per quelle dopo, che non
    // ne hanno una; il piè è soltanto dell'ultima.
    expect(plan.sheets.map((sheet) => [sheet.header, sheet.footer])).toEqual([
      [NUMBERED, null],
      [NUMBERED, null],
      [NUMBERED, FOOT],
    ]);
    // Il salto apre il foglio subito dopo di sé; la sezione dopo il suo segno.
    const brk = e.state.doc.child(0).child(1);
    expect(brk.type.name).toBe("brk");
    expect(plan.cuts[0]!.at).toBe(plan.cuts[0]!.node + brk.nodeSize);
    expect(e.state.doc.nodeAt(plan.cuts[1]!.node)?.type.name).toBe("section");
    expect(sheetAt(plan, 2)).toBe(0);
    expect(sheetAt(plan, plan.cuts[0]!.at)).toBe(1);
    expect(sheetAt(plan, e.state.doc.content.size - 1)).toBe(2);
  });

  it("senza una pagina (l'ODT) c'è un foglio A4 solo, e una sezione non taglia", () => {
    const e = engine([para("uno", { sect: "s1" }), para("due")], {});
    const plan = sheetPlan(e.state.doc);
    expect(plan.cuts).toEqual([]);
    expect(plan.sheets).toEqual([{ section: 0, page: DEFAULT_PAGE, header: null, footer: null }]);
  });

  it("gli spazi e i segni dei tagli sono decorazioni: il documento non cambia", () => {
    const e = engine();
    const before = e.getDoc();
    const gaps = [...document.querySelectorAll<HTMLElement>(".rich-sheet-gap")];
    expect(gaps.map((gap) => gap.tagName)).toEqual(["SPAN", "DIV"]);
    for (const gap of gaps) {
      expect(gap.getAttribute("aria-hidden")).toBe("true");
      expect(gap.contentEditable).toBe("false");
    }
    // Il salto e la fine della sezione che taglia non sono più righe; quella
    // che continua sì.
    const cut = [...document.querySelectorAll(".rich-cut")];
    expect(cut.map((element) => element.className)).toEqual(["rich-break rich-break-page rich-cut", "rich-section rich-cut"]);
    expect(document.querySelectorAll(".rich-section:not(.rich-cut)")).toHaveLength(1);
    expect(e.getDoc()).toBe(before);
    expect(parseProjection(e.getDoc()).blocks).toHaveLength(BLOCKS.length);
  });
});

describe("i fogli sulla scrivania", () => {
  const letter: Sheet = { section: 0, page: LETTER, header: null, footer: null };
  const pageH = LETTER.h * PX_PER_PT;
  const margin = 72 * PX_PER_PT;

  it("un foglio è alto la sua pagina, e il testo dopo comincia al margine del foglio dopo", () => {
    const layout = sheetLayout([letter, letter], [500], 700);
    expect(layout.boxes).toEqual([
      { top: 0, height: pageH },
      { top: pageH + SHEET_GAP, height: pageH },
    ]);
    expect(layout.gaps).toEqual([pageH + SHEET_GAP + margin - 500]);
    expect(layout.height).toBe(2 * pageH + SHEET_GAP);
  });

  it("un foglio il cui testo non ci sta si allunga, non si spezza", () => {
    const layout = sheetLayout([letter, letter], [1200], 1300);
    expect(layout.boxes[0]).toEqual({ top: 0, height: 1200 + margin });
    expect(layout.boxes[1]!.top).toBe(1200 + margin + SHEET_GAP);
    expect(layout.gaps[0]).toBe(margin + SHEET_GAP + margin);
  });
});

/// Una scrivania finta: larga quanto un Letter al 100 %, ogni spazio comincia
/// a 400 px più 300 per ognuno prima, più l'altezza degli spazi prima, e il
/// testo finisce 300 px dopo l'ultimo.
function fakeDesk(scale = 1): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = (top: number, height: number, width = 0) => ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("rich-desk")) return rect(0, 3000 * scale, LETTER.w * PX_PER_PT * scale);
    const gaps = [...document.querySelectorAll<HTMLElement>(".rich-sheet-gap")];
    const heights = gaps.map((gap) => Number.parseFloat(gap.style.height) || 0);
    const at = (i: number) => (400 + 300 * i + heights.slice(0, i).reduce((a, b) => a + b, 0)) * scale;
    const index = gaps.indexOf(this);
    if (index >= 0) return rect(at(index), heights[index]! * scale);
    return rect(0, at(gaps.length));
  });
}

describe("la misura", () => {
  beforeEach(() => fakeDesk());

  it("scrive gli spazi, disegna i fogli con i numeri veri e si ferma", () => {
    const e = engine();
    expect(e.editRunning("footer")).toBe(true);
    const sheets = [...document.querySelectorAll<HTMLElement>(".rich-sheet")];
    expect(sheets).toHaveLength(3);
    expect(sheets.map((sheet) => sheet.querySelector(".rich-sheet-head")?.textContent)).toEqual(["Pagina 1 di 3", "Pagina 2 di 3", "Pagina 3 di 3"]);
    expect(sheets.map((sheet) => sheet.querySelector(".rich-sheet-foot")?.textContent ?? null)).toEqual([null, null, "Riservato"]);
    const pageH = LETTER.h * PX_PER_PT;
    expect(sheets.map((sheet) => sheet.style.top)).toEqual(["0px", `${pageH + SHEET_GAP}px`, `${2 * (pageH + SHEET_GAP)}px`]);
    const gaps = [...document.querySelectorAll<HTMLElement>(".rich-sheet-gap")];
    // Il testo del foglio dopo comincia al suo margine: 400 px + lo spazio.
    expect(400 + Number.parseFloat(gaps[0]!.style.height)).toBeCloseTo(pageH + SHEET_GAP + 72 * PX_PER_PT, 3);
    // Il nome di ogni taglio sta fra due fogli.
    expect([...document.querySelectorAll(".rich-sheet-name")].map((name) => name.textContent)).toEqual([t("rich.break.page"), sectionName(LETTER)]);
    // Una seconda misura non riscrive niente.
    const written = gaps.map((gap) => gap.style.height);
    e.editRunning("footer");
    expect([...document.querySelectorAll<HTMLElement>(".rich-sheet-gap")].map((gap) => gap.style.height)).toEqual(written);
  });

  it("con lo zoom le misure tornano in px della carta", () => {
    vi.restoreAllMocks();
    fakeDesk(1.5);
    expect(engine().editRunning("footer")).toBe(true);
    const gap = document.querySelector<HTMLElement>(".rich-sheet-gap")!;
    expect(400 + Number.parseFloat(gap.style.height)).toBeCloseTo(LETTER.h * PX_PER_PT + SHEET_GAP + 72 * PX_PER_PT, 3);
  });
});
