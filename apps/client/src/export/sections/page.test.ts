// @vitest-environment happy-dom
// La sezione Pagina dello spazio «Esporta in PDF» (T72), nello spazio vero:
// il formato e la misura tua (anche assurda), il verso e le colonne, i
// margini pronti e scritti (anche più larghi della pagina), lo specchio, la
// filigrana e le guide sulle pagine.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { printBlocks } from "../paginate/measure";
import type { BlockSource, Scheduler } from "../paginate/slices";
import { defaultProfile, MM } from "../profile";
import { openExportSpace, type ExportSpace } from "../space";

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
  space.openSection("pagina");
  await settle();
});

afterEach(() => {
  space.close();
  app.remove();
  document.querySelectorAll(".print-host, .export-measure").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => space.element.querySelector<T>(selector)!;
const summary = () => $('.export-section[data-section="pagina"] .export-section-summary').textContent;
const type = (selector: string, value: string, event: "input" | "change" = "change") => {
  const input = $<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event(event));
};

describe("la sezione Pagina", () => {
  it("il formato, il verso e le colonne si scelgono, e la testa lo dice", async () => {
    $("#export-page-format-A5").click();
    $("#export-page-orientation-true").click();
    $("#export-page-columns-2").click();
    expect(space.profile.pagina).toMatchObject({ formato: "A5", orizzontale: true });
    expect(space.profile.testo.colonne).toBe(2);
    expect(summary()).toContain("A5");
    expect($("#export-page-format-A5").getAttribute("aria-checked")).toBe("true");
  });

  it("la misura tua parte da quella di prima, e una assurda resta scritta in rosso senza toccare la pagina", async () => {
    $("#export-page-format-proprio").click();
    expect(space.profile.pagina).toMatchObject({ formato: "proprio", misura_propria: [210, 297] });
    type("#export-page-width", "160");
    expect(space.profile.pagina.misura_propria).toEqual([160, 297]);
    const before = space.profile;
    type("#export-page-width", "9000");
    expect(space.profile).toBe(before);
    expect($("#export-page-width").getAttribute("aria-invalid")).toBe("true");
    expect($("#export-page-width").isConnected).toBe(true);
    expect($("#export-page-note").hidden).toBe(false);
    expect($("#export-page-note").textContent).toMatch(/^Un lato del foglio va da 50 a 1189 mm: la pagina resta /u);
  });

  it("i margini pronti e scritti; uno più largo della pagina diventa il più largo possibile, e la frase lo dice", async () => {
    $("#export-page-margins-larghi").click();
    expect(space.profile.pagina.margini).toEqual({ sopra: 32, destra: 34, sotto: 32, sinistra: 34 });
    type("#export-page-margin-sinistra", "40");
    expect(space.profile.pagina.margini.sinistra).toBe(40);
    expect($("#export-page-margins-larghi").getAttribute("aria-checked")).toBe("false");
    $("#export-page-format-A5").click();
    type("#export-page-margin-destra", "300");
    // A5 è largo 148 mm: 40 a sinistra e 30 di testo lasciano 70 a destra,
    // che è anche il massimo.
    expect(space.profile.pagina.margini.destra).toBe(70);
    type("#export-page-margin-sinistra", "70");
    expect(space.profile.pagina.margini.sinistra).toBe(48);
    expect($("#export-page-note").textContent).toBe("Un margine va da 5 a 70 mm e lascia al testo almeno 30 mm. Sinistra: 48 mm.");
  });

  it("un numero di margine cancellato torna quello di prima", () => {
    type("#export-page-margin-sopra", "");
    expect($<HTMLInputElement>("#export-page-margin-sopra").value).toBe("25");
    expect(space.profile.pagina.margini.sopra).toBe(25);
  });

  it("le pagine mostrano le guide coi margini, a specchio sulle pari, e la filigrana", async () => {
    expect($(".export-doc").dataset["guides"]).toBe("true");
    const first = $('.export-slot[data-page="0"] .export-page');
    expect(first.style.getPropertyValue("--export-margin-left")).toBe(`${Math.round(22 * MM * 100) / 100}px`);
    expect(first.querySelectorAll(".export-guide").length).toBe(4);
    $("#export-page-mirror").click();
    type("#export-page-margin-sinistra", "35");
    await settle();
    expect(space.profile.pagina.specchio).toBe(true);
    type("#export-page-watermark", "BOZZA");
    await settle();
    expect(space.profile.pagina.filigrana).toBe("BOZZA");
    expect($(".export-watermark").textContent).toBe("BOZZA");
    expect($(".export-watermark").getAttribute("aria-hidden")).toBe("true");
  });

  it("la filigrana tiene al più 18 caratteri", () => {
    type("#export-page-watermark", "x".repeat(40));
    expect(space.profile.pagina.filigrana.length).toBe(18);
  });

  it("chiusa la Pagina, le guide si nascondono", async () => {
    $('.export-section[data-section="pagina"] .export-section-head').click();
    await settle();
    expect($(".export-doc").dataset["guides"]).toBe("false");
    expect(defaultProfile().pagina.specchio).toBe(false);
  });
});
