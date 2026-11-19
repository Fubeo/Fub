// @vitest-environment happy-dom
// Testata e piè, frontespizio e indice dello spazio «Esporta in PDF» (T73),
// nello spazio vero: i sei posti e il loro menu, il testo tuo, i tre
// interruttori; il frontespizio con le proprietà della nota; l'indice coi
// numeri delle pagine che la testata stampa; nessuno di questi cambi rifà
// l'impaginazione della nota.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { blockId, printBlocks } from "../paginate/measure";
import type { BlockSource, Scheduler } from "../paginate/slices";
import { defaultProfile, type ExportProfile } from "../profile";
import { openExportSpace, type ExportSpace, type ExportSpaceOptions } from "../space";
import { coverFactsOf, propertyText } from "./cover-toc";
import { displayPath, slotText, withSlot } from "./header-footer";

const NOW: Scheduler = {
  now: () => 0,
  soon(task) {
    queueMicrotask(task);
    return () => {};
  },
  idle(task) {
    queueMicrotask(task);
    return () => {};
  },
};

/// I titoli sono titoli alti 40, il resto paragrafi di dieci righe da 22:
/// quattro paragrafi per pagina A4, più o meno.
function fakeMeasure(page: HTMLElement): BlockSource {
  const blocks = printBlocks(page);
  let top = 0;
  const tops: number[] = [];
  for (const block of blocks) {
    tops.push(top);
    top += /^H[1-6]$/.test(block.tagName) ? 50 : 230;
  }
  return {
    count: blocks.length,
    measure(index) {
      const element = blocks[index];
      const id = blockId(element, index);
      if (/^H[1-6]$/.test(element.tagName)) {
        return { box: { kind: "heading", id, level: Number(element.tagName[1]) as 1 | 2 | 3, height: 40 }, top: tops[index], bottom: tops[index] + 40, exact: true };
      }
      return { box: { kind: "paragraph", id, lines: Array.from({ length: 10 }, () => 22) }, top: tops[index], bottom: tops[index] + 220, exact: true };
    },
  };
}

function paragraphs(from: number, count: number): string {
  return Array.from({ length: count }, (_, i) => `<p data-md-from="${from + i}">Testo ${from + i}</p>`).join("");
}

/// Tre capitoli lunghi: ognuno comincia in una pagina diversa.
const NOTE = {
  html: `<h2 data-md-from="1">Premessa</h2>${paragraphs(10, 5)}<h2 data-md-from="2">Il luogo</h2>${paragraphs(20, 6)}<h3 data-md-from="3">La sala</h3>${paragraphs(30, 2)}<h2 data-md-from="4">Allegati</h2>${paragraphs(40, 1)}`,
  parts: [],
} as unknown as RenderedDocument;

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let app: HTMLElement;
let space: ExportSpace;

function open(extra: Partial<ExportSpaceOptions> = {}): ExportSpace {
  space = openExportSpace({ doc: "Progetti/Mostra/Relazione.md", title: "Relazione", render: async () => NOTE, container: app, behind: [], scheduler: NOW, measure: fakeMeasure, waitMs: 10, ...extra });
  return space;
}

beforeEach(() => {
  app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
});

afterEach(() => {
  space?.close();
  app.remove();
  document.querySelectorAll(".print-host, .export-measure, #context-menu").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

const slots = () => [...space.element.querySelectorAll<HTMLElement>(".export-slot")];
/// Il nome di una voce dell'indice, senza il numero del titolo davanti.
const tocName = (row: Element) => [...(row.querySelector(".export-toc-name")?.childNodes ?? [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("");
const cells = (slot: Element, kind: "header" | "footer") => [...slot.querySelectorAll(`.export-${kind} .export-header-cell`)].map((cell) => cell.textContent);

function withFront(cover: boolean, toc: boolean, extra: Partial<ExportProfile> = {}): ExportProfile {
  const base = defaultProfile();
  return { ...base, frontespizio: { ...base.frontespizio, frontespizio: cover, indice: toc }, ...extra };
}

describe("la testata e il piè sulle pagine", () => {
  it("col profilo di serie: il titolo in alto a destra col filo, «pagina di pagine» in basso al centro", async () => {
    open();
    await settle();
    const all = slots();
    expect(all.length).toBeGreaterThan(2);
    expect(cells(all[0], "header")).toEqual(["", "", "Relazione"]);
    expect(all[0].querySelector(".export-header")?.classList.contains("has-rule")).toBe(true);
    expect(cells(all[1], "footer")).toEqual(["", `2 / ${all.length}`, ""]);
  });

  it("la sezione corrente, la data, il percorso, l'autore e un testo tuo; nessuna nuova impaginazione", async () => {
    open({ properties: async () => [{ key: "autore", value: "Ada Lovelace" }] });
    await settle();
    const layouts = space.paginator.layouts;
    const base = defaultProfile();
    space.setProfile({
      ...base,
      testata: {
        ...base.testata,
        posti: { "sopra-sinistra": { voce: "sezione" }, "sopra-centro": { voce: "testo", testo: "Riservato" }, "sopra-destra": { voce: "percorso" }, "sotto-sinistra": { voce: "autore" }, "sotto-destra": { voce: "pagina" } },
      },
    });
    await settle();
    expect(space.paginator.layouts).toBe(layouts);
    const all = slots();
    // La prima pagina comincia col capitolo «Premessa».
    expect(cells(all[0], "header")).toEqual(["Premessa", "Riservato", "Progetti / Mostra / Relazione"]);
    expect(cells(all[0], "footer")).toEqual(["Ada Lovelace", "", "1"]);
    // La sezione è quella in corso in cima alla pagina, o quella che la pagina
    // apre col suo primo blocco.
    let current = "";
    for (const slot of all) {
      const blocks = [...slot.querySelectorAll(".export-fascia")].map((band) => band.querySelector("h1, h2, h3, p"));
      const opens = blocks[0]?.tagName === "H2" ? blocks[0]!.textContent : null;
      expect(cells(slot, "header")[0]).toBe(opens ?? (current || [...slot.querySelectorAll(".export-fascia h2")][0]?.textContent || ""));
      const begun = [...slot.querySelectorAll(".export-fascia h2")];
      if (begun.length > 0) current = begun[begun.length - 1].textContent ?? "";
    }
    expect(new Set(all.map((slot) => cells(slot, "header")[0]))).toEqual(new Set(["Premessa", "Il luogo"]));
  });

  it("senza nulla in testata il filo non c'è; la prima pagina può restare senza testata", async () => {
    const base = defaultProfile();
    open({ profile: { ...base, testata: { ...base.testata, posti: { "sotto-centro": { voce: "pagina" } }, prima_pagina_senza: true } } });
    await settle();
    const all = slots();
    expect(all[0].querySelector(".export-header")).toBeNull();
    expect(all[1].querySelector(".export-header")?.classList.contains("has-rule")).toBe(false);
    expect(cells(all[0], "footer")).toEqual(["", "1", ""]);
  });

  it("a specchio, nelle pagine pari sinistra e destra si scambiano", async () => {
    const base = defaultProfile();
    open({ profile: { ...base, pagina: { ...base.pagina, specchio: true } } });
    await settle();
    const all = slots();
    expect(cells(all[0], "header")).toEqual(["", "", "Relazione"]);
    expect(cells(all[1], "header")).toEqual(["Relazione", "", ""]);
  });
});

describe("il frontespizio e l'indice", () => {
  it("il frontespizio ha icona, titolo, proprietà, chi e quando; il titolo non apre più la nota", async () => {
    open({
      profile: withFront(true, false),
      properties: async () => [
        { key: "icon", value: "📘" },
        { key: "autore", value: ["Ada", "Charles"] },
        { key: "luogo", value: "[[Luoghi/Sala grande|la sala grande]]" },
        { key: "inaugurazione", value: "2026-04-11" },
        { key: "tags", value: ["mostra"] },
      ],
    });
    await settle();
    const [cover, first] = slots();
    expect(cover.getAttribute("aria-label")).toBe("Frontespizio");
    expect(cover.querySelector(".export-header, .export-footer")).toBeNull();
    expect(cover.querySelector(".export-cover-icon")?.textContent).toBe("📘");
    expect(cover.querySelector(".export-cover-title")?.textContent).toBe("Relazione");
    expect(cover.querySelector(".export-cover-properties")?.textContent).toBe("luogo: la sala grande · inaugurazione: 11 aprile 2026");
    expect(cover.querySelector(".export-cover-foot b")?.textContent).toBe("Ada, Charles");
    // Il frontespizio non si conta: la nota comincia dalla pagina 1, senza il
    // titolo in cima.
    expect(cells(first, "footer")[1]).toMatch(/^1 \/ \d+$/);
    expect(first.textContent).not.toContain("Relazione​");
    expect(space.paginator.host.querySelector<HTMLElement>(".print-page > h1")?.hidden).toBe(true);
  });

  it("l'indice ha i numeri che le pagine stampano, fino ai Titoli 2 o anche ai 3", async () => {
    open({ profile: withFront(true, true) });
    await settle();
    const all = slots();
    const toc = all[1];
    expect(toc.getAttribute("aria-label")).toBe("Indice, pagina 1");
    expect(toc.querySelector(".export-toc-title")?.textContent).toBe("Indice");
    const rows = [...toc.querySelectorAll(".export-toc-row")].map((row) => [tocName(row), row.querySelector(".export-toc-page")?.textContent]);
    expect(rows.map(([name]) => name)).toEqual(["Premessa", "Il luogo", "Allegati"]);
    // Il numero di ogni voce è quello che il piè stampa sulla pagina dove il
    // titolo comincia.
    for (const [name, page] of rows) {
      const where = all.find((slot) => [...slot.querySelectorAll(".export-fascia h2")].some((heading) => heading.textContent === name));
      expect(where, name ?? "").toBeDefined();
      expect(cells(where!, "footer")[1]).toBe(`${page} / ${all.length - 1}`);
    }
    expect(space.element.querySelector(".export-band-pages")?.textContent).toBe(`${all.length} pagine`);

    space.setProfile({ ...space.profile, frontespizio: { ...space.profile.frontespizio, profondita_indice: 3 } });
    await settle();
    expect([...slots()[1].querySelectorAll(".export-toc-row")].map(tocName)).toEqual(["Premessa", "Il luogo", "La sala", "Allegati"]);
  });

  it("coi numeri romani frontespizio e indice contano i, ii e la nota riparte da 1", async () => {
    const profile = withFront(true, true);
    open({ profile: { ...profile, testata: { ...profile.testata, numeri_romani: true } } });
    await settle();
    const all = slots();
    expect(cells(all[1], "footer")).toEqual(["", "ii / ii", ""]);
    expect(cells(all[2], "footer")).toEqual(["", `1 / ${all.length - 2}`, ""]);
  });

  it("una nota senza titoli non ha indice", async () => {
    open({ profile: withFront(false, true), render: async () => ({ html: paragraphs(0, 3), parts: [] }) as unknown as RenderedDocument });
    await settle();
    expect(space.element.querySelector(".export-toc")).toBeNull();
  });
});

describe("le due sezioni del pannello", () => {
  it("un posto si sceglie dal suo menu, e il testo tuo si scrive nel suo campo", async () => {
    open();
    await settle();
    space.openSection("testata");
    const left = space.element.querySelector<HTMLButtonElement>("#export-header-sopra-sinistra")!;
    expect(left.textContent).toBe("+");
    expect(left.getAttribute("aria-label")).toBe("Testata, a sinistra: Niente");
    left.click();
    const items = [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")];
    expect(items.map((item) => item.textContent?.replace("✓", "").trim())).toEqual(["Niente", "Titolo della nota", "Sezione", "Data", "Pagina", "Pagina di pagine", "Autore", "Percorso nel vault", "Un testo tuo"]);
    items[8].click();
    await settle();
    expect(space.profile.testata.posti["sopra-sinistra"]).toEqual({ voce: "testo", testo: "" });
    const input = space.element.querySelector<HTMLInputElement>("#export-header-text-sopra-sinistra")!;
    expect(document.activeElement).toBe(input);
    input.value = "Bozza";
    input.dispatchEvent(new Event("input"));
    // Mentre si scrive le pagine seguono e il campo resta lo stesso.
    expect(space.element.querySelector("#export-header-text-sopra-sinistra")).toBe(input);
    expect(cells(slots()[0], "header")[0]).toBe("Bozza");
    input.dispatchEvent(new Event("change"));
    expect(space.profile.testata.posti["sopra-sinistra"]).toEqual({ voce: "testo", testo: "Bozza" });
    expect(space.element.querySelector('[data-section="testata"] .export-section-summary')?.textContent).toBe("Testo, Titolo, Pagina");
  });

  it("gli interruttori della testata e del frontespizio", async () => {
    open();
    await settle();
    space.openSection("testata");
    space.openSection("fronte");
    space.element.querySelector<HTMLButtonElement>("#export-header-rule")!.click();
    expect(space.profile.testata.filo).toBe(false);
    space.element.querySelector<HTMLButtonElement>("#export-header-roman")!.click();
    expect(space.profile.testata.numeri_romani).toBe(true);
    expect(space.element.querySelector("#export-front-depth-2")).toBeNull();
    space.element.querySelector<HTMLButtonElement>("#export-front-toc")!.click();
    expect(space.profile.frontespizio.indice).toBe(true);
    const deeper = space.element.querySelector<HTMLButtonElement>("#export-front-depth-3")!;
    expect(space.element.querySelector("#export-front-depth-2")?.getAttribute("aria-checked")).toBe("true");
    deeper.click();
    expect(space.profile.frontespizio.profondita_indice).toBe(3);
    space.element.querySelector<HTMLButtonElement>("#export-front-bookmarks")!.click();
    expect(space.profile.frontespizio.segnalibri).toBe(false);
    expect(space.element.querySelector('[data-section="fronte"] .export-section-summary')?.textContent).toBe("Indice");
  });
});

describe("i valori", () => {
  it("una proprietà si scrive per chi legge", () => {
    expect(propertyText(["Ada", "[[Persone/Charles Babbage]]"])).toBe("Ada, Charles Babbage");
    expect(propertyText(true)).toBe("sì");
    expect(propertyText(2026)).toBe("2026");
    expect(propertyText("2026-02-30")).toBe("2026-02-30");
    expect(propertyText({ a: 1 })).toBe("");
  });

  it("il frontespizio prende al più quattro proprietà, senza icona, etichette, tipo e autore", () => {
    const facts = coverFactsOf([
      { key: "tipo", value: "[[Tipi/Relazione]]" },
      { key: "icon", value: "fub:book" },
      { key: "author", value: "Ada" },
      { key: "a", value: "1" },
      { key: "b", value: "" },
      { key: "c", value: "3" },
      { key: "d", value: "4" },
      { key: "e", value: "5" },
      { key: "f", value: "6" },
    ]);
    expect(facts.author).toBe("Ada");
    expect(facts.icon).toBe("fub:book");
    expect(facts.properties.map((p) => p.label)).toEqual(["a", "c", "d", "e"]);
  });

  it("un posto scrive la sua voce; un posto vuoto esce dal profilo", () => {
    const facts = { title: "T", path: displayPath("A/B/Nota.md"), author: "", date: "1 gennaio 2026" };
    const sheet = { kind: "pagina" as const, index: 0, number: "3", total: "9", header: true, footer: true };
    expect(facts.path).toBe("A / B / Nota");
    expect(slotText({ voce: "pagina-di-pagine" }, facts, sheet, "")).toBe("3 / 9");
    expect(slotText({ voce: "sezione" }, facts, sheet, "")).toBe("");
    expect(slotText({ voce: "futuro" }, facts, sheet, "S")).toBe("");
    const base = defaultProfile().testata;
    expect(Object.keys(withSlot(base, "sopra-destra", null).posti)).toEqual(["sotto-centro"]);
  });
});
