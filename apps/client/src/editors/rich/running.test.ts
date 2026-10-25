// @vitest-environment happy-dom
//
// L'intestazione e il piè sul foglio, scritti sul posto: i numeri sono
// gettoni, non codici fra graffe; il testo scritto diventa l'intestazione
// della sezione del foglio con un passo che si annulla; una bloccata non si
// apre.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { setRunningAt } from "./page";
import { parseProjection, type Block, type Page, type Para, type RunningText } from "./projection";
import { mountRichRibbon } from "./ribbon";
import { fillRunning, readRunning } from "./running";
import { PX_PER_PT, SheetDesk, sheetPlan } from "./sheets";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const LETTER: Page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
const para = (x: string, extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c: [{ t: "text", x }] }) as Block;

/// Due sezioni, due fogli: la prima chiusa dal suo paragrafo, l'ultima sul
/// documento.
function engine(head: { header?: RunningText; footer?: RunningText; readonly?: string; track?: boolean } = {}): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, page: LETTER, ...head, blocks: [para("uno", { sect: "s1", page: LETTER }), para("due")] }));
  engines.push(made);
  return made;
}

/// Una scrivania finta, larga un Letter: lo spazio comincia a 400 px, il testo
/// finisce 300 px dopo.
function fakeDesk(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = (top: number, height: number, width = 0) => ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("rich-desk")) return rect(0, 3000, LETTER.w * PX_PER_PT);
    const gap = document.querySelector<HTMLElement>(".rich-sheet-gap");
    const height = gap ? Number.parseFloat(gap.style.height) || 0 : 0;
    if (this === gap) return rect(400, height);
    return rect(0, 700 + height);
  });
}

const header = (e: RichEngine) => parseProjection(e.getDoc()).header;
const ownHeader = (e: RichEngine) => (parseProjection(e.getDoc()).blocks[0] as Para).header;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

describe("il campo dell'intestazione", () => {
  it("i numeri sono gettoni, e il campo torna le righe com'erano", () => {
    const area = document.createElement("div");
    const running: RunningText = { lines: [["Lettera — pagina ", { field: "page" }, " di ", { field: "pages" }], ["seconda riga"]] };
    fillRunning(area, running);
    const tokens = [...area.querySelectorAll<HTMLElement>(".rich-token")];
    expect(tokens.map((token) => [token.dataset.field, token.textContent, token.contentEditable])).toEqual([
      ["page", t("rich.running.page"), "false"],
      ["pages", t("rich.running.pages"), "false"],
    ]);
    expect(area.textContent).not.toContain("{");
    expect(readRunning(area)).toEqual(running);
    // Un codice scritto è testo, non un numero.
    area.replaceChildren("scrivi {PAGE} qui");
    expect(readRunning(area)).toEqual({ lines: [["scrivi {PAGE} qui"]] });
    // Un a capo che il browser scrive come blocco, e quello in fondo.
    area.innerHTML = "uno<div>due</div><br>";
    expect(readRunning(area)).toEqual({ lines: [["uno"], ["due"]] });
    area.replaceChildren();
    expect(readRunning(area)).toBeNull();
  });

  it("una sezione per il segno a `pos` si cambia senza il cursore", () => {
    const e = engine();
    e.select(e.state.doc.content.size - 2);
    expect(e.apply(setRunningAt("header", 5, { lines: [["Prima"]] }))).toBe(true);
    expect(ownHeader(e)).toEqual({ lines: [["Prima"]] });
    expect(header(e)).toBeUndefined();
    // Un `pos` che non è una fine di sezione non vale.
    expect(e.apply(setRunningAt("header", 1, { lines: [["No"]] }))).toBe(false);
  });
});

describe("sul foglio", () => {
  beforeEach(() => fakeDesk());

  it("la barra apre l'intestazione del foglio del cursore, e il gettone va dove si scriveva", () => {
    const e = engine({ footer: { lines: [["logo"]], locked: true } });
    e.select(e.state.doc.content.size - 2);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.header"] button')!.click();
    const field = document.querySelector<HTMLElement>(".rich-running")!;
    expect(field.getAttribute("aria-label")).toBe(t("rich.running.label", { kind: t("rich.hf.header"), n: 2 }));
    expect(document.querySelector(".rich-desk-running")).not.toBeNull();
    const area = field.querySelector<HTMLElement>(".rich-running-area")!;
    expect(area.getAttribute("role")).toBe("textbox");
    area.append("Pagina ");
    const range = document.createRange();
    range.setStart(area, 1);
    range.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    button(t("rich.hf.page")).click();
    expect(area.querySelector(".rich-token")?.getAttribute("data-field")).toBe("page");
    // Esc chiude e scrive, con un passo solo.
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rich-running")).toBeNull();
    expect(document.querySelector(".rich-desk-running")).toBeNull();
    expect(header(e)).toEqual({ lines: [["Pagina ", { field: "page" }]] });
    e.run("text.undo");
    expect(header(e)).toBeUndefined();
    ribbon.destroy();
  });

  it("chiuso senza cambiare niente non scrive; una bloccata non si apre", () => {
    const e = engine({ header: { lines: [["Lettera"]] }, footer: { lines: [["logo"]], locked: true } });
    e.select(e.state.doc.content.size - 2);
    const before = e.getDoc();
    expect(e.editRunning("header")).toBe(true);
    document.querySelector<HTMLElement>(".rich-running-area")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(e.getDoc()).toBe(before);
    expect(e.editRunning("footer")).toBe(false);
    expect(document.querySelector(".rich-running")).toBeNull();
    // La barra dice perché.
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    const footer = ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.footer"] button')!;
    expect(footer.getAttribute("aria-disabled")).toBe("true");
    footer.focus();
    expect(document.getElementById(footer.getAttribute("aria-describedby")!)!.textContent).toContain(t("rich.hf.locked"));
    expect(ribbon.element.querySelector('[data-command="rich.header"] button')!.getAttribute("aria-disabled")).not.toBe("true");
    ribbon.destroy();
  });

  it("in sola lettura e mentre si registra non si apre", () => {
    expect(engine({ readonly: "protected" }).editRunning("header")).toBe(false);
    const shell = engine();
    shell.setReadOnly(true);
    expect(shell.editRunning("header")).toBe(false);
    expect(engine({ track: true }).editRunning("header")).toBe(false);
  });

  it("da Scrittura la barra porta in Pagina", () => {
    const e = engine();
    const asked: string[] = [];
    const ribbon = mountRichRibbon(e, () => null, {}, {
      display: { mode: () => "writing", setMode: (next) => asked.push(next), look: () => "tema", setLook: () => {} },
    });
    document.body.append(ribbon.element);
    ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.footer"] button')!.click();
    expect(asked).toEqual(["document"]);
    ribbon.destroy();
  });

  it("il doppio clic apre nel margine di sopra o di sotto di un foglio, non nel testo", () => {
    const e = engine();
    const desk = document.querySelector<HTMLElement>(".rich-desk")!;
    const sheets = new SheetDesk(desk, desk.querySelector<HTMLElement>(".rich-sheets")!);
    const content = desk.querySelector<HTMLElement>(".rich-content")!;
    sheets.bind({ dom: content } as never, sheetPlan(e.state.doc));
    expect(sheets.measure()).toBe(true);
    const pt = PX_PER_PT;
    expect(sheets.zoneAt(300, 30)).toEqual({ sheet: 0, kind: "header" });
    expect(sheets.zoneAt(300, 300)).toBeNull();
    expect(sheets.zoneAt(300, LETTER.h * pt - 10)).toEqual({ sheet: 0, kind: "footer" });
    const second = sheets.box(1)!;
    expect(sheets.zoneAt(300, second.top + 10)).toEqual({ sheet: 1, kind: "header" });
    // Fra due fogli non c'è niente.
    expect(sheets.zoneAt(300, second.top - 5)).toBeNull();
    sheets.destroy();
  });
});
