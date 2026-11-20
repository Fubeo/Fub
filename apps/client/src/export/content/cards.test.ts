// @vitest-environment happy-dom
// Le schede vive sulla carta (T74): l'anteprima col nome, solo il nome, o per
// un PDF tutte le sue pagine in coda (una nota del PDF dice dove sono).

import { describe, expect, it } from "vitest";
import { applyCards, cardSlots, isCardFile, type CardPages } from "./cards";
import { ContentChanges } from "./changes";

const FRAME = { width: 600, height: 900 };

function page(): HTMLElement {
  const root = document.createElement("article");
  root.className = "print-page";
  root.innerHTML = `<h1>Nota</h1><div class="print-body markdown-rendered">
    <div class="embed" data-embed-page="Documenti/Contratto.pdf"><figure><img alt=""><figcaption>Contratto.pdf</figcaption></figure></div>
    <div class="embed" data-embed-page="Conti.xlsx" data-embed-heading="Budget"><table><tr><td>1</td></tr></table></div>
    <div class="embed embed-loaded" data-embed-page="Idee"><p>nota</p></div>
  </div>`;
  document.body.append(root);
  return root;
}

function canvases(count: number): HTMLCanvasElement[] {
  return Array.from({ length: count }, () => Object.assign(document.createElement("canvas"), { width: 200, height: 283 }));
}

describe("le schede vive", () => {
  it("sono i file mostrati come scheda: non le note, le Basi, le foto", () => {
    expect(isCardFile("Contratto.pdf")).toBe(true);
    expect(isCardFile("Conti.xlsx#Budget")).toBe(true);
    expect(isCardFile("schema.svg")).toBe(true);
    expect(isCardFile("Idee.md")).toBe(false);
    expect(isCardFile("Opere.base")).toBe(false);
    expect(isCardFile("foto.png")).toBe(false);
    expect(isCardFile("Idee")).toBe(false);
    expect(cardSlots(page())).toHaveLength(2);
  });

  it("l'anteprima resta, col nome sotto quando la resa non lo scrive", () => {
    const root = page();
    const changes = new ContentChanges();
    applyCards(root, "anteprima", new Map(), FRAME, changes);
    const captions = root.querySelectorAll(".export-card-caption");
    expect([...captions].map((c) => c.textContent)).toEqual(["Conti.xlsx › Budget"]);
    changes.undo();
    expect(root.querySelector(".export-card-caption")).toBeNull();
  });

  it("solo il nome: una riga al posto dell'anteprima", () => {
    const root = page();
    const changes = new ContentChanges();
    applyCards(root, "solo-nome", new Map(), FRAME, changes);
    const names = [...root.querySelectorAll(".export-card-name")].map((line) => line.textContent);
    expect(names).toEqual(["→Contratto.pdf", "Conti.xlsx › Budget"]);
    expect([...root.querySelectorAll<HTMLElement>(".embed")].map((slot) => slot.hidden)).toEqual([true, true, false]);
    changes.undo();
    expect(root.querySelectorAll(".export-card-name")).toHaveLength(0);
    expect([...root.querySelectorAll<HTMLElement>(".embed")].some((slot) => slot.hidden)).toBe(false);
  });

  it("le pagine in coda: prima si chiedono, intanto il PDF esce con l'anteprima", () => {
    const root = page();
    const applied = applyCards(root, "pagine-in-coda", new Map(), FRAME, new ContentChanges());
    expect(applied.wanted).toEqual(["Documenti/Contratto.pdf"]);
    expect(root.querySelector<HTMLElement>(".embed")!.hidden).toBe(false);
  });

  it("le pagine in coda: arrivate, stanno in fondo, una per figura, alte al più quanto la pagina", () => {
    const root = page();
    const pages = new Map<string, CardPages | null>([["Documenti/Contratto.pdf", { canvases: canvases(3), total: 3 }]]);
    const changes = new ContentChanges();
    const applied = applyCards(root, "pagine-in-coda", pages, FRAME, changes);
    expect(applied.wanted).toEqual([]);
    const body = root.querySelector(".print-body")!;
    expect(body.querySelector(".export-card-name")!.textContent).toContain("le pagine sono in fondo al PDF");
    const figures = body.querySelectorAll(".export-appendix-page");
    expect(figures).toHaveLength(3);
    expect(body.lastElementChild).toBe(figures[2]);
    expect(body.querySelector(".export-appendix-title")!.textContent).toBe("Contratto.pdf");
    expect(figures[1]!.querySelector("figcaption")!.textContent).toBe("Contratto.pdf · pagina 2 di 3");
    const canvas = figures[0]!.querySelector("canvas")!;
    expect(parseFloat(canvas.style.width)).toBeLessThanOrEqual(FRAME.width);
    expect(parseFloat(canvas.style.height)).toBeLessThanOrEqual(FRAME.height);
    // Il foglio di calcolo non è un PDF: resta con la sua anteprima.
    expect(root.querySelectorAll<HTMLElement>(".embed")[1]!.hidden).toBe(false);
    changes.undo();
    expect(body.querySelectorAll(".export-appendix-page, .export-appendix-title")).toHaveLength(0);
  });

  it("un PDF più lungo del limite dice quante pagine restano nel file", () => {
    const root = page();
    const pages = new Map<string, CardPages | null>([["Documenti/Contratto.pdf", { canvases: canvases(2), total: 250 }]]);
    applyCards(root, "pagine-in-coda", pages, FRAME, new ContentChanges());
    expect(root.querySelector(".export-appendix-more")!.textContent).toBe("Altre 248 pagine di Contratto.pdf restano nel file.");
  });

  it("un PDF che non si legge esce con l'anteprima", () => {
    const root = page();
    const pages = new Map<string, CardPages | null>([["Documenti/Contratto.pdf", null]]);
    const applied = applyCards(root, "pagine-in-coda", pages, FRAME, new ContentChanges());
    expect(applied.wanted).toEqual([]);
    expect(root.querySelector(".export-appendix-page")).toBeNull();
    expect(root.querySelector<HTMLElement>(".embed")!.hidden).toBe(false);
  });
});
