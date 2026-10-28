// @vitest-environment happy-dom
//
// La pagina delle sezioni nella superficie ricca: si legge dalla proiezione,
// si cambia per la sezione del cursore e si riscrive come il codec la vuole.
import { afterEach, describe, expect, it } from "vitest";
import { t, type Key } from "../../i18n/strings";
import { RichEngine } from "./engine";
import {
  formatLength,
  MARGIN_PRESETS,
  pageAt,
  pageVariables,
  previewVariables,
  PAPER_SIZES,
  paperLabel,
  paperName,
  parseLength,
  runningOf,
  runningText,
  setColumns,
  setLandscape,
  setMargins,
  setPaper,
  setRunning,
  validPage,
} from "./page";
import { parseProjection, type Block, type Page, type Para, type RunningText } from "./projection";
import { mountProperties } from "./properties";
import { mountRichRibbon } from "./ribbon";
import type { RichSide } from "./side";
import { closeContextMenu } from "../../ui/menu";

let engines: RichEngine[] = [];
afterEach(() => {
  closeContextMenu();
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const LETTER: Page = { w: 612, h: 792, top: 72, bottom: 72, left: 72, right: 72 };
const para = (x: string, extra: object = {}): Block => ({ t: "para", role: { kind: "body" }, ...extra, c: [{ t: "text", x }] }) as Block;

/// Due sezioni: la prima chiusa dal suo paragrafo, l'ultima sul documento.
function engine(page: Page | null = LETTER, track = false, head: { header?: RunningText; footer?: RunningText } = {}): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  const blocks = [para("uno", page ? { sect: "s1", page } : { sect: "s1" }), para("due")];
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, ...(track ? { track: true } : {}), ...(page ? { page } : {}), ...head, blocks }));
  engines.push(made);
  return made;
}

const field = (label: string) => {
  const caption = [...document.querySelectorAll("label")].find((l) => l.textContent === label)!;
  return document.getElementById(caption.htmlFor) as HTMLInputElement & HTMLSelectElement;
};
/// Le voci di una galleria, col nome e se sono spente; il menu si richiude.
const entries = (root: HTMLElement, label: string) => {
  gallery(root, label).click();
  const items = [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")].map((el) => [
    el.querySelector(".menu-label")?.textContent ?? el.textContent,
    el.getAttribute("aria-disabled") === "true",
  ]);
  closeContextMenu();
  return items;
};
/// Il pulsante di una galleria della barra, per il suo nome.
const gallery = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label)!;
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

  it("la scrivania prende la carta e i margini del documento, in punti veri", () => {
    const e = engine({ ...LETTER, left: 90 });
    const desk = document.querySelector<HTMLElement>(".rich-desk")!;
    // Letter: 612 × 792 pt, cioè 816 × 1056 px CSS al 100 %.
    expect(desk.style.getPropertyValue("--page-w")).toBe("612pt");
    expect(desk.style.getPropertyValue("--page-h")).toBe("792pt");
    expect(desk.style.getPropertyValue("--page-left")).toBe("90pt");
    expect(desk.style.getPropertyValue("--page-right")).toBe("72pt");
    // Nessuna misura dipende dal riquadro, né un ruolo del tema sta sull'elemento.
    expect(desk.getAttribute("style")).not.toMatch(/%|min\(|var\(/);
    expect(desk.querySelector(":scope > .rich-sheets > .rich-sheet")).not.toBeNull();
    expect(desk.querySelector(":scope > .rich-content")).not.toBeNull();
    // La scrivania è larga quanto il primo foglio: girare l'ultima sezione
    // gira soltanto il suo foglio.
    e.select(e.state.doc.content.size - 2);
    e.apply(setLandscape(true));
    expect(desk.style.getPropertyValue("--page-w")).toBe("612pt");
    e.select(2);
    e.apply(setLandscape(true));
    expect(desk.style.getPropertyValue("--page-w")).toBe("792pt");
    expect(desk.style.getPropertyValue("--page-h")).toBe("612pt");
  });

  it("A4 misura 595,3 × 841,9 pt, e senza una pagina non si scrive niente", () => {
    const a4 = { w: 595.3, h: 841.9, top: 56.7, bottom: 56.7, left: 56.7, right: 56.7 };
    expect(pageVariables(a4)).toEqual({
      "--page-w": "595.3pt",
      "--page-h": "841.9pt",
      "--page-top": "56.7pt",
      "--page-right": "56.7pt",
      "--page-bottom": "56.7pt",
      "--page-left": "56.7pt",
    });
    expect(pageVariables(null)).toEqual({});
  });

  it("l'anteprima ha le proporzioni della carta e i margini in parte dei lati", () => {
    expect(previewVariables(LETTER)).toEqual({
      "--preview-ratio": "612 / 792",
      "--preview-top": "9.1%",
      "--preview-bottom": "9.1%",
      "--preview-left": "11.8%",
      "--preview-right": "11.8%",
      "--preview-columns": "1",
    });
    // Un margine più grande del foglio si ferma al foglio.
    expect(previewVariables({ ...LETTER, left: 1000, cols: 2 })["--preview-left"]).toBe("100%");
    expect(previewVariables({ ...LETTER, cols: 2 })["--preview-columns"]).toBe("2");
  });

  it("senza una pagina nel formato (l'ODT) Proprietà dice l'A4 su cui si vede, e non lo cambia", () => {
    const e = engine(null);
    expect(pageAt(e.state)).toBeNull();
    expect(e.apply(setLandscape(true))).toBe(false);
    const host = document.createElement("div");
    document.body.append(host);
    const shown = mountProperties(e, "odt", host);
    const controls = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".rich-side-section:first-of-type input, .rich-side-section:first-of-type select")];
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect(host.textContent).toContain(t("rich.page.default"));
    expect(field(t("rich.page.size")).value).toBe("A4");
    expect(field(t("rich.page.left")).value).toBe("2");
    expect(host.textContent).toContain(t("rich.prop.format.odt"));
    // La barra non offre le gallerie, e dice perché; Proprietà sì.
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    expect(entries(ribbon.element, t("rich.page.margins"))).toEqual([
      ...MARGIN_PRESETS.map((m) => [t(`rich.page.margins.${m.id}` as Key), true]),
      [t("rich.prop.more"), false],
    ]);
    ribbon.destroy();
    shown.close();
    expect(host.childElementCount).toBe(0);
  });

  it("mentre si registra la pagina non si cambia, e Proprietà la legge", () => {
    const e = engine(LETTER, true);
    e.select(2);
    const before = e.getDoc();
    e.apply(setLandscape(true));
    expect(e.getDoc()).toBe(before);
    const ribbon = mountRichRibbon(e, () => null, { review: true });
    document.body.append(ribbon.element);
    expect(entries(ribbon.element, t("rich.page.orientation"))).toEqual([
      [t("rich.page.portrait"), true],
      [t("rich.page.landscape"), true],
      [t("rich.prop.more"), false],
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    const shown = mountProperties(e, "docx", host);
    expect(field(t("rich.page.size")).disabled).toBe(true);
    expect(field(t("rich.page.size")).value).toBe("Letter");
    shown.close();
    ribbon.destroy();
  });

  it("Proprietà sceglie carta, verso, margini e colonne, con l'anteprima", () => {
    const e = engine();
    e.select(2);
    const host = document.createElement("div");
    document.body.append(host);
    const shown = mountProperties(e, "docx", host);
    const change = (control: HTMLInputElement | HTMLSelectElement, value: string) => {
      control.value = value;
      control.dispatchEvent(new Event("change"));
    };
    const preview = host.querySelector<HTMLElement>(".rich-side-preview")!;
    expect(preview.getAttribute("role")).toBe("img");
    expect(preview.getAttribute("aria-label")).toBe(t("rich.prop.preview", { paper: paperLabel("Letter"), orientation: t("rich.page.portrait"), columns: "1" }));
    expect(field(t("rich.page.size")).value).toBe("Letter");
    expect(field(t("rich.page.margins")).value).toBe("normal");
    expect(field(t("rich.page.left")).value).toBe("2,54");
    change(field(t("rich.page.size")), "A4");
    change(field(t("rich.page.orientation")), "landscape");
    change(field(t("rich.page.margins")), "narrow");
    change(field(t("rich.page.columns")), "2");
    expect(first(e)).toEqual({ w: 841.9, h: 595.3, top: 36, bottom: 36, left: 36, right: 36, cols: 2 });
    expect(preview.style.getPropertyValue("--preview-ratio")).toBe("841.9 / 595.3");
    expect(preview.style.getPropertyValue("--preview-columns")).toBe("2");
    change(field(t("rich.page.left")), "2");
    expect(first(e)?.left).toBe(56.7);
    // Rimesso com'era, il margine non si riscrive arrotondato.
    change(field(t("rich.page.left")), "2");
    expect(first(e)?.left).toBe(56.7);
    expect(field(t("rich.page.margins")).value).toBe("");
    // Troppo: non si prende, e l'avviso lo dice.
    change(field(t("rich.page.right")), "40");
    expect(first(e)?.right).toBe(36);
    expect(field(t("rich.page.right")).value).toBe("1,27");
    const alert = host.querySelector<HTMLElement>("[role=alert]")!;
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe(t("rich.page.too_large"));
    // Una pagina cambiata altrove si rilegge.
    e.apply(setLandscape(false));
    expect(field(t("rich.page.orientation")).value).toBe("portrait");
    shown.close();
  });

  it("le gallerie della barra cambiano la pagina, e «…» apre Proprietà", () => {
    const e = engine();
    e.select(2);
    const asked: string[] = [];
    const side = { panels: [], show: (id: string) => (asked.push(id), true), destroy: () => {} } as unknown as RichSide;
    const ribbon = mountRichRibbon(e, () => null, {}, { side });
    document.body.append(ribbon.element);
    const pick = (menu: string, entry: string) => {
      gallery(ribbon.element, menu).click();
      const item = [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")].find((el) => el.textContent?.startsWith(entry))!;
      expect(item, entry).toBeDefined();
      item.click();
      closeContextMenu();
    };
    gallery(ribbon.element, t("rich.page.margins")).click();
    const checked = [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")].filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain(t("rich.page.margins.normal"));
    closeContextMenu();
    pick(t("rich.page.margins"), t("rich.page.margins.narrow"));
    pick(t("rich.page.orientation"), t("rich.page.landscape"));
    pick(t("rich.page.size"), paperLabel("A4"));
    pick(t("rich.page.columns"), "3");
    expect(first(e)).toEqual({ w: 841.9, h: 595.3, top: 36, bottom: 36, left: 36, right: 36, cols: 3 });
    pick(t("rich.page.columns"), t("rich.prop.more"));
    expect(asked).toEqual(["properties"]);
    ribbon.destroy();
  });

  it("un'intestazione si scrive come testo, con i numeri di pagina come codici", () => {
    const header: RunningText = { lines: [["Lettera — pagina ", { field: "page" }, " di ", { field: "pages" }], []] };
    expect(runningText(header)).toBe("Lettera — pagina {PAGE} di {NUMPAGES}\n");
    expect(runningOf("Lettera — pagina {PAGE} di {NUMPAGES}\n")).toEqual(header);
    expect(runningOf("{PAGE}")).toEqual({ lines: [[{ field: "page" }]] });
    expect(runningOf("")).toBeNull();
    // Bloccata, o con un codice scritto come testo, non si modifica.
    expect(runningText({ ...header, locked: true })).toBeNull();
    expect(runningText({ lines: [["scrivi {PAGE} qui"]] })).toBeNull();
  });

  it("si mette, si cambia e si toglie per la sezione del cursore", () => {
    const locked: RunningText = { lines: [["logo"]], locked: true };
    const e = engine(LETTER, false, { footer: locked });
    e.select(2);
    expect(e.apply(setRunning("header", { lines: [["Prima"]] }))).toBe(true);
    expect((parseProjection(e.getDoc()).blocks[0] as Para).header).toEqual({ lines: [["Prima"]] });
    expect(parseProjection(e.getDoc()).header).toBeUndefined();
    e.select(e.state.doc.content.size - 2);
    expect(e.apply(setRunning("header", runningOf("Pagina {PAGE}")))).toBe(true);
    expect(parseProjection(e.getDoc()).header).toEqual({ lines: [["Pagina ", { field: "page" }]] });
    // Quella bloccata resta.
    const before = e.getDoc();
    expect(e.apply(setRunning("footer", null))).toBe(false);
    expect(e.getDoc()).toBe(before);
    expect(e.apply(setRunning("header", null))).toBe(true);
    expect(parseProjection(e.getDoc()).header).toBeUndefined();
    e.run("text.undo");
    expect(parseProjection(e.getDoc()).header).toEqual({ lines: [["Pagina ", { field: "page" }]] });
  });
});

describe("le misure come Word", () => {
  it("2,54 cm sono un pollice, e tornano 2,54 cm", () => {
    expect(parseLength("2,54", "cm")).toBe(72);
    expect(parseLength("2,54 cm", "cm")).toBe(72);
    expect(parseLength("2.54", "cm")).toBe(72);
    expect(formatLength(72, "cm", "it-IT")).toBe("2,54");
    expect(formatLength(parseLength("2,54", "cm")!, "cm", "it-IT")).toBe("2,54");
  });

  it("ogni misura scritta con due decimali torna identica dopo il giro in punti", () => {
    for (let hundredths = 0; hundredths <= 1000; hundredths++) {
      const text = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2, useGrouping: false }).format(hundredths / 100);
      expect(formatLength(parseLength(text, "cm")!, "cm", "it-IT"), text).toBe(text);
    }
    for (let tenths = 0; tenths <= 1000; tenths++) {
      const text = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: false }).format(tenths / 10);
      expect(formatLength(parseLength(text, "pt")!, "pt", "it-IT"), text).toBe(text);
    }
  });

  it("i punti sono al ventesimo, come li conserva un .docx", () => {
    expect(parseLength("1", "cm")).toBe(28.35);
    expect(parseLength("12,5 pt", "pt")).toBe(12.5);
    expect(parseLength("-0,5", "cm")).toBe(-14.15);
  });

  it("un campo vuoto segue lo stile, un testo che non è un numero non vale", () => {
    expect(parseLength("  ", "cm")).toBeNull();
    expect(parseLength("due", "cm")).toBeUndefined();
    expect(parseLength("1,2,3", "pt")).toBeUndefined();
  });

  it("la virgola è dell'italiano, il punto dell'inglese, senza migliaia", () => {
    expect(formatLength(1190.55, "pt", "it-IT")).toBe("1190,6");
    expect(formatLength(1190.55, "pt", "en-US")).toBe("1190.6");
  });

  it("le carte hanno il nome italiano", () => {
    expect(paperLabel("Letter")).toBe(t("rich.paper.letter"));
    expect(paperLabel("Legal")).toBe(t("rich.paper.legal"));
    expect(paperLabel("A4")).toBe("A4");
  });
});

describe("le interruzioni", () => {
  it("la fine di una sezione dice dove comincia quella dopo, e lo tiene quando la pagina cambia", () => {
    const e = engine(LETTER);
    const end = () => document.querySelector<HTMLElement>(".rich-section")!;
    expect(end().dataset.name).toBe(`${t("rich.break.section")} · ${t("rich.break.next_page")}`);
    e.setDoc(JSON.stringify({ format: "fub-rich", version: 1, page: { ...LETTER, start: "continuous" }, blocks: [para("uno", { sect: "s1", page: LETTER }), para("due")] }));
    expect(end().dataset.name).toBe(`${t("rich.break.section")} · ${t("rich.break.continuous")}`);
    expect(end().getAttribute("aria-label")).toBe(end().dataset.name);
    // I margini cambiati non fanno ricominciare la sezione a pagina nuova.
    e.select(e.state.doc.content.size - 2);
    expect(e.apply(setMargins({ top: 36, bottom: 36, left: 36, right: 36 }))).toBe(true);
    expect(last(e)?.start).toBe("continuous");
    expect(e.getDoc()).toContain(`"right":36.0,"start":"continuous"}`);
    expect(end().dataset.name).toBe(`${t("rich.break.section")} · ${t("rich.break.continuous")}`);
    // Un inizio che il formato non conosce è una proiezione malformata.
    expect(() => parseProjection(JSON.stringify({ format: "fub-rich", version: 1, page: { ...LETTER, start: "domani" }, blocks: [para("x")] }))).toThrow();
  });

  it("senza una pagina la fine di una sezione dice soltanto la fine", () => {
    engine(null);
    expect(document.querySelector<HTMLElement>(".rich-section")!.dataset.name).toBe(t("rich.break.section"));
  });

  it("un salto pagina e un salto di colonna hanno il loro nome", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
    engines.push(made);
    made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks: [para("a\fb\u000ec")] }));
    const page = document.querySelector<HTMLElement>(".rich-break-page")!;
    expect(page.dataset.name).toBe(t("rich.break.page"));
    expect(page.getAttribute("role")).toBe("separator");
    expect(document.querySelector<HTMLElement>(".rich-break-column")!.getAttribute("aria-label")).toBe(t("rich.break.column"));
  });
});
