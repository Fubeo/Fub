// @vitest-environment happy-dom
// Le sezioni Tema e Colori dello spazio «Esporta in PDF» (T71), nello spazio
// vero: il passaggio su un tema lo mostra sulle pagine senza sceglierlo, il
// clic lo sceglie; un colore cambia solo le variabili delle pagine; il
// contrasto si ricalcola; «tuo» e «torna al tema»; un codice scritto male.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { printBlocks } from "../paginate/measure";
import type { BlockSource, Scheduler } from "../paginate/slices";
import { openExportSpace, type ExportSpace } from "../space";
import { printTheme } from "../themes";

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

function fakeMeasure(page: HTMLElement): BlockSource {
  const blocks = printBlocks(page);
  return {
    count: blocks.length,
    measure(index) {
      const top = index * 230;
      return { box: { kind: "paragraph", id: `blocco:${index}`, lines: Array.from({ length: 10 }, () => 22) }, top, bottom: top + 220, exact: true };
    },
  };
}

const NOTE = { html: "<h2>Uno</h2><p>Testo</p><h3>Due</h3><p>Altro</p>", parts: [] } as unknown as RenderedDocument;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let app: HTMLElement;
let space: ExportSpace;

beforeEach(async () => {
  app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  space = openExportSpace({ doc: "nota.md", title: "Nota", render: async () => NOTE, container: app, behind: [], scheduler: NOW, measure: fakeMeasure, waitMs: 10 });
  await settle();
  space.openSection("tema");
  space.openSection("colori");
});

afterEach(() => {
  space.close();
  app.remove();
  document.querySelectorAll(".print-host, .export-measure").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => space.element.querySelector<T>(selector)!;
const doc = () => $(".export-doc");
const variable = (name: string) => doc().style.getPropertyValue(name);
const pointer = (target: Element, type: string) => target.dispatchEvent(new Event(type, { bubbles: type !== "pointerleave" }));

describe("la sezione Tema", () => {
  it("mostra gli otto temi, col tema scelto premuto e ciò che è", () => {
    const cards = [...space.element.querySelectorAll<HTMLButtonElement>(".export-theme")];
    expect(cards.map((card) => card.dataset["theme"])).toEqual(["fub", "classico", "relazione", "rivista", "accademico", "quaderno", "essenziale", "notte"]);
    expect(cards.map((card) => card.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false", "false", "false"]);
    expect(cards[3].textContent).toBe("AaRivista");
    expect($("#export-theme-about").textContent).toBe("Verde, testo con grazie. Passa su un tema per vederlo sulle pagine prima di sceglierlo.");
  });

  it("il passaggio su un tema lo mostra sulle pagine senza sceglierlo; uscendo torna", () => {
    const layouts = space.paginator.layouts;
    pointer($('[data-theme="rivista"]'), "pointerover");
    expect(variable("--doc-bg")).toBe(printTheme("rivista").colors.carta);
    expect(variable("--print-accent")).toBe(printTheme("rivista").colors.accento);
    // Rivista ha due colonne: le pagine si rifanno.
    expect(space.paginator.layouts).toBeGreaterThan(layouts);
    expect(space.profile.tema).toBe("fub");
    expect($("#export-theme-about").textContent).toBe("Due colonne, titoli grandi.");
    expect($('[data-section="tema"] .export-section-summary').textContent).toBe("Fub");
    pointer($(".export-themes"), "pointerleave");
    expect(variable("--print-accent")).toBe(printTheme("fub").colors.accento);
    expect($("#export-theme-about").textContent).toContain("Verde, testo con grazie");
  });

  it("un clic sceglie il tema: la testa lo dice e il fuoco resta sulla carta", () => {
    const card = $<HTMLButtonElement>('[data-theme="notte"]');
    card.focus();
    card.click();
    expect(space.profile.tema).toBe("notte");
    expect(variable("--doc-bg")).toBe("#131c16");
    expect($('[data-section="tema"] .export-section-summary').textContent).toBe("Notte");
    expect($('[data-theme="notte"]').getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement?.id).toBe("export-theme-notte");
  });

  it("le regolazioni tue restano cambiando tema, e si tolgono tutte insieme", () => {
    $<HTMLButtonElement>("#export-color-titoli").click();
    $<HTMLButtonElement>("#export-swatch-titoli-b3261e").click();
    $<HTMLButtonElement>('[data-theme="quaderno"]').click();
    expect(space.profile.colori).toEqual({ titoli: "#b3261e" });
    expect(variable("--doc-heading")).toBe("#b3261e");
    expect($('[data-section="tema"] .export-section-summary').textContent).toBe("Quaderno · 1 regolazione tua");
    const reset = $<HTMLButtonElement>("#export-theme-reset");
    expect(reset.textContent).toBe("Togli la regolazione tua e torna al tema");
    reset.click();
    expect(space.profile.colori).toEqual({});
    expect(space.profile.tema).toBe("quaderno");
    expect(variable("--doc-heading")).toBe(printTheme("quaderno").colors.titoli);
    expect(space.element.querySelector("#export-theme-reset")).toBeNull();
  });
});

describe("la sezione Colori", () => {
  it("mostra gli undici colori del tema, ognuno col suo codice", () => {
    const rows = [...space.element.querySelectorAll<HTMLElement>(".export-color")];
    expect(rows.map((row) => row.querySelector(".export-color-name")?.textContent)).toEqual(["Carta", "Testo", "Titoli", "Accento", "Link", "Testo secondario", "Linee", "Evidenziato", "Riquadri", "Codice", "Intestazioni di tabella"]);
    expect(rows[0].querySelector(".export-color-code")?.textContent).toBe("#ffffff");
    expect(space.element.querySelector(".export-color-own")).toBeNull();
    expect($("#export-contrast").textContent).toMatch(/^Testo sulla carta: contrasto 1\d,\d a 1 · ottimo$/u);
  });

  it("un tondo pronto cambia solo le variabili delle pagine, e la riga dice «tuo»", () => {
    const layouts = space.paginator.layouts;
    $<HTMLButtonElement>("#export-color-accento").click();
    expect($("#export-color-palette-accento").querySelectorAll(".export-swatch")).toHaveLength(12);
    const swatch = $<HTMLButtonElement>("#export-swatch-accento-8d2d63");
    swatch.focus();
    swatch.click();
    expect(space.paginator.layouts).toBe(layouts);
    expect(variable("--print-accent")).toBe("#8d2d63");
    expect(variable("--accent")).toBe("#8d2d63");
    expect($('[data-color="accento"] .export-color-own').textContent).toBe("tuo");
    expect($("#export-swatch-accento-8d2d63").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement?.id).toBe("export-swatch-accento-8d2d63");
    expect($('[data-section="colori"] .export-section-summary').textContent).toBe("1 tuo");
    // Torna al colore del tema, uno per uno.
    $<HTMLButtonElement>("#export-color-reset-accento").click();
    expect(space.profile.colori).toEqual({});
    expect(variable("--print-accent")).toBe(printTheme("fub").colors.accento);
    expect(document.activeElement?.id).toBe("export-color-accento");
  });

  it("il codice a mano: dal vivo se è un colore, e uno scritto male non entra e lo dice", () => {
    $<HTMLButtonElement>("#export-color-testo").click();
    const hex = $<HTMLInputElement>("#export-hex-testo");
    const panel = $(".export-side").firstElementChild;
    hex.value = "#9";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    expect(hex.hasAttribute("aria-invalid")).toBe(false);
    hex.value = "#999999";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    // Dal vivo: le pagine e il contrasto cambiano, il pannello no.
    expect(variable("--doc-fg")).toBe("#999999");
    expect($(".export-side").firstElementChild).toBe(panel);
    expect($("#export-contrast").textContent).toContain("basso: stampato si legge male");
    expect($("#export-contrast").classList.contains("is-low")).toBe(true);
    hex.value = "verde";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    hex.dispatchEvent(new Event("change", { bubbles: true }));
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect($("#export-hex-error-testo").hidden).toBe(false);
    expect(space.profile.colori["testo"]).toBe("#999999");
    expect(variable("--doc-fg")).toBe("#999999");
  });

  it("Esc nel codice rimette il colore di prima senza chiudere lo spazio", () => {
    $<HTMLButtonElement>("#export-color-link").click();
    const hex = $<HTMLInputElement>("#export-hex-link");
    hex.value = "#ff0000";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    expect(variable("--doc-link")).toBe("#ff0000");
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(space.element.isConnected).toBe(true);
    expect(space.profile.colori).toEqual({});
    expect(variable("--doc-link")).toBe(printTheme("fub").colors.link);
  });

  it("l'accento troppo chiaro si avvisa a parte", () => {
    $<HTMLButtonElement>("#export-color-accento").click();
    $<HTMLButtonElement>("#export-swatch-accento-000000").click();
    const hex = $<HTMLInputElement>("#export-hex-accento");
    hex.value = "#dddddd";
    hex.dispatchEvent(new Event("change", { bubbles: true }));
    const line = $("#export-contrast");
    expect(line.textContent).toContain("Accento sulla carta:");
    expect(line.textContent).toContain("troppo chiaro per titoli e link");
    expect(line.classList.contains("is-low")).toBe(true);
  });

  it("il passaggio su un colore contorna sulle pagine dove è usato", () => {
    pointer($('[data-color="titoli"] .export-color-name'), "pointerover");
    expect(doc().dataset["highlight"]).toBe("titoli");
    pointer($('[data-color="carta"] .export-color-code'), "pointerover");
    expect(doc().dataset["highlight"]).toBe("carta");
    pointer($(".export-colors"), "pointerleave");
    expect(doc().dataset["highlight"]).toBeUndefined();
  });

  it("bianco e nero e risparmio d'inchiostro sono interruttori che dicono lo stato", () => {
    const gray = $<HTMLButtonElement>("#export-colors-gray");
    expect(gray.getAttribute("role")).toBe("switch");
    expect(gray.getAttribute("aria-checked")).toBe("false");
    gray.click();
    expect(space.profile.inchiostro.bianco_e_nero).toBe(true);
    expect(variable("--print-filter")).toBe("grayscale(1)");
    expect($("#export-colors-gray").getAttribute("aria-checked")).toBe("true");
    expect($('[data-section="colori"] .export-section-summary').textContent).toBe("Bianco e nero");
    $<HTMLButtonElement>("#export-colors-gray").click();
    expect(variable("--print-filter")).toBe("");
    $<HTMLButtonElement>("#export-colors-save").click();
    expect(space.profile.inchiostro.risparmio).toBe(true);
    expect(variable("--print-callout")).toBe("#ffffff");
  });
});
