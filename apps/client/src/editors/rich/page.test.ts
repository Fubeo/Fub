// @vitest-environment happy-dom
//
// La pagina delle sezioni nella superficie ricca: si legge dalla proiezione,
// si cambia per la sezione del cursore e si riscrive come il codec la vuole.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import { MARGIN_PRESETS, pageAt, pageStyle, PAPER_SIZES, paperName, setColumns, setLandscape, setMargins, setPaper, validPage } from "./page";
import { parseProjection, type Block, type Page, type Para } from "./projection";
import { mountStrip } from "./strip";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const LETTER: Page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
const para = (x: string, extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c: [{ t: "text", x }] }) as Block;

/// Due sezioni: la prima chiusa dal suo paragrafo, l'ultima sul documento.
function engine(page: Page | null = LETTER, track = false): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  const blocks = [para("uno", page ? { sect: "s1", page } : { sect: "s1" }), para("due")];
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(track ? { track: true } : {}), ...(page ? { page } : {}), blocks }));
  engines.push(made);
  return made;
}

const first = (e: RichEngine) => (parseProjection(e.getDoc()).blocks[0] as Para).page;
const last = (e: RichEngine) => parseProjection(e.getDoc()).page;

describe("pagina", () => {
  it("si rilegge e si riscrive com'era", () => {
    const e = engine({ ...LETTER, cols: 2 });
    expect(first(e)).toEqual({ ...LETTER, cols: 2 });
    // Riscritta dalla superficie, con i numeri come li scrive serde.
    e.select(4);
    e.dispatch(e.state.tr.insertText("!"));
    expect(e.getDoc()).toContain(`"page":{"w":612.0,"h":792.0,"top":72.0,"bottom":72.0,"left":72.0,"right":72.0,"cols":2}`);
  });

  it("si cambia per la sezione del cursore, e l'ultima sta sul documento", () => {
    const e = engine();
    e.select(2);
    expect(pageAt(e.state)?.pos).toBe(5);
    expect(e.apply(setLandscape(true))).toBe(true);
    expect(first(e)).toEqual({ ...LETTER, w: 792, h: 612 });
    expect(last(e)).toEqual(LETTER);
    e.select(e.state.doc.content.size - 2);
    expect(pageAt(e.state)?.pos).toBeNull();
    const a4 = PAPER_SIZES.find((s) => s.name === "A4")!;
    expect(e.apply(setPaper(a4.w, a4.h))).toBe(true);
    expect(last(e)).toEqual({ ...LETTER, w: 595.3, h: 841.9 });
    expect(paperName(last(e)!, PAPER_SIZES)).toBe("A4");
    // Girata, la carta resta nel suo verso.
    e.select(2);
    expect(e.apply(setPaper(a4.w, a4.h))).toBe(true);
    expect(first(e)).toMatchObject({ w: 841.9, h: 595.3 });
    expect(e.apply(setColumns(3))).toBe(true);
    expect(first(e)?.cols).toBe(3);
    expect(e.apply(setColumns(1))).toBe(true);
    expect(first(e)?.cols).toBeUndefined();
    // Si disfa come ogni modifica.
    e.run("text.undo");
    expect(first(e)?.cols).toBe(3);
  });

  it("i margini si arrotondano al ventesimo di punto, e quelli troppo grandi non si prendono", () => {
    const e = engine();
    e.select(2);
    expect(e.apply(setMargins({ top: 72, bottom: 72, left: 56.6929, right: 56.6929 }))).toBe(true);
    expect(first(e)).toMatchObject({ left: 56.7, right: 56.7 });
    const before = e.getDoc();
    expect(e.apply(setMargins({ top: 72, bottom: 72, left: 300, right: 300 }))).toBe(false);
    expect(e.apply(setMargins({ top: -1, bottom: 72, left: 72, right: 72 }))).toBe(false);
    expect(e.apply(setColumns(13))).toBe(false);
    expect(e.getDoc()).toBe(before);
    expect(validPage({ ...LETTER, w: 5 })).toBe(false);
    expect(validPage({ ...LETTER, top: Number.NaN })).toBe(false);
    expect(MARGIN_PRESETS.every((m) => validPage({ ...LETTER, ...m }))).toBe(true);
  });

  it("il foglio prende la carta e i margini del documento", () => {
    const e = engine({ ...LETTER, left: 90 });
    const sheet = document.querySelector<HTMLElement>(".rich-content")!;
    expect(sheet.style.maxWidth).toContain("612pt");
    expect(pageStyle({ ...LETTER, left: 90 })).toContain("padding: 72pt min(72pt, 11.765%) 72pt min(90pt, 14.706%)");
    e.select(e.state.doc.content.size - 2);
    e.apply(setLandscape(true));
    expect(sheet.style.maxWidth).toContain("792pt");
    expect(pageStyle(null)).toEqual([]);
  });

  it("senza una pagina nel formato non c'è niente da cambiare, e la striscia non la offre", () => {
    const e = engine(null);
    expect(pageAt(e.state)).toBeNull();
    expect(e.apply(setLandscape(true))).toBe(false);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const button = [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.page"))!;
    expect(button.parentElement!.hidden).toBe(true);
    strip.destroy();
  });

  it("mentre si registra la pagina non si cambia", () => {
    const e = engine(LETTER, true);
    e.select(2);
    const before = e.getDoc();
    e.apply(setLandscape(true));
    expect(e.getDoc()).toBe(before);
    const strip = mountStrip(e, () => null, { review: true });
    document.body.append(strip.element);
    const button = [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.page"))!;
    expect(button.parentElement!.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    strip.destroy();
  });

  it("la striscia sceglie carta, verso, margini e colonne", () => {
    const e = engine();
    e.select(2);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const button = [...strip.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.page"))!;
    button.click();
    const field = (label: string) => {
      const caption = [...document.querySelectorAll("label")].find((l) => l.textContent === label)!;
      return document.getElementById(caption.htmlFor) as HTMLInputElement & HTMLSelectElement;
    };
    const change = (control: HTMLInputElement | HTMLSelectElement, value: string) => {
      control.value = value;
      control.dispatchEvent(new Event("change"));
    };
    expect(field(t("rich.page.size")).value).toBe("Letter");
    expect(field(t("rich.page.margins")).value).toBe("normal");
    expect(field(t("rich.page.left")).value).toBe("2.54");
    change(field(t("rich.page.size")), "A4");
    change(field(t("rich.page.orientation")), "landscape");
    change(field(t("rich.page.margins")), "narrow");
    change(field(t("rich.page.columns")), "2");
    expect(first(e)).toEqual({ w: 841.9, h: 595.3, top: 36, bottom: 36, left: 36, right: 36, cols: 2 });
    change(field(t("rich.page.left")), "2");
    expect(first(e)?.left).toBe(56.7);
    expect(field(t("rich.page.margins")).value).toBe("");
    // Troppo: non si prende, e l'avviso lo dice.
    change(field(t("rich.page.right")), "40");
    expect(first(e)?.right).toBe(36);
    expect(field(t("rich.page.right")).value).toBe("1.27");
    const alert = document.querySelector<HTMLElement>("[role=alert]")!;
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe(t("rich.page.too_large"));
    strip.destroy();
  });
});
