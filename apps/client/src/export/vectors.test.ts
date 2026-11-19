// @vitest-environment happy-dom
// Diagrammi e formule nell'esportazione (T75): l'aspetto imposto a ogni
// diagramma dalla sezione Diagrammi, la resa pronta per le pagine (l'ultimo
// disegno buono, il riquadro «non disegnato», ciò che si rimpicciolisce) e
// l'SVG passato al core, coi valori calcolati come attributi e il testo vero.

import { afterEach, describe, expect, it } from "vitest";
import { defaultProfile, type ExportProfile } from "./profile";
import {
  DiagramMemory,
  diagramLookKey,
  diagramOwnColors,
  diagramPrintLook,
  EXPORT_DIAGRAM_STYLES,
  exportDiagramStyle,
  MIN_FIT,
  overrideFor,
  preparePrintVectors,
  svgForCore,
  vectorOf,
  type FitMeasure,
} from "./vectors";

function profileWith(change: Partial<ExportProfile>): ExportProfile {
  return { ...defaultProfile(), ...change };
}

afterEach(() => {
  document.body.replaceChildren();
  document.adoptedStyleSheets = [];
});

describe("l'aspetto dei diagrammi", () => {
  it("offre i sei stili del prototipo e legge come nella nota ciò che non conosce", () => {
    expect(EXPORT_DIAGRAM_STYLES).toEqual(["nota", "tema", "acquerello", "aurora", "blueprint", "inchiostro"]);
    expect(exportDiagramStyle("aurora")).toBe("aurora");
    expect(exportDiagramStyle("armonia")).toBe("nota");
    expect(exportDiagramStyle("pastello")).toBe("nota");
    expect(exportDiagramStyle(undefined)).toBe("nota");
  });

  it("prende i quattro colori dati a mano, non quelli scritti male né gli altri", () => {
    const profile = profileWith({ colori: { "diagramma-nodi": "#1F4F8F", "diagramma-linee": "rosso", "diagramma-inizio-fine": "#b3261e", accento: "#006e46" } });
    expect(diagramOwnColors(profile)).toEqual({ nodes: "#1f4f8f", ends: "#b3261e" });
  });

  it("lascia com'è un diagramma della nota senza stile, colori né fondo cambiati", () => {
    const look = diagramPrintLook(defaultProfile());
    expect(overrideFor(look, 0)).toBeNull();
    expect(overrideFor(look, null)).toBeNull();
  });

  it("dà i colori a mano anche a un diagramma com'è nella nota", () => {
    const look = diagramPrintLook(profileWith({ colori: { "diagramma-decisioni": "#8d2d63" } }));
    expect(overrideFor(look, 0)).toEqual({ colors: { decisions: "#8d2d63" } });
  });

  it("col tema di stampa disegna Armonia coi colori della carta", () => {
    const look = diagramPrintLook(profileWith({ diagrammi: { stile: "tema", fondo: true } }));
    const override = overrideFor(look, 0);
    expect(override?.style).toBe("armonia");
    expect(override?.tokens?.["ground"]).toMatch(/^#[0-9a-f]{6}$/u);
    expect(override?.tokens?.["--doc-fg"]).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("uno stile dato a un diagramma solo vince su quello di tutti, non sulle note trascluse", () => {
    const look = diagramPrintLook(profileWith({ diagrammi: { stile: "aurora", fondo: true } }), new Map([[1, "blueprint"], [-1, "inchiostro"]]));
    expect(overrideFor(look, 0)).toEqual({ style: "aurora" });
    expect(overrideFor(look, 1)).toEqual({ style: "blueprint" });
    expect(overrideFor(look, null)).toEqual({ style: "aurora" });
    expect(look.each.has(-1)).toBe(false);
  });

  it("senza fondo, il diagramma sta sulla carta della pagina", () => {
    const look = diagramPrintLook(profileWith({ diagrammi: { stile: "acquerello", fondo: false } }));
    const override = overrideFor(look, 0);
    expect(override?.style).toBe("acquerello");
    expect(override?.paper).toBe(false);
    expect(override?.ground).toBe(look.tokens["ground"]);
  });

  it("la firma cambia con lo stile, i colori, il fondo e gli stili di un diagramma solo", () => {
    const base = diagramLookKey(diagramPrintLook(defaultProfile()));
    expect(diagramLookKey(diagramPrintLook(defaultProfile()))).toBe(base);
    expect(diagramLookKey(diagramPrintLook(profileWith({ diagrammi: { stile: "aurora", fondo: true } })))).not.toBe(base);
    expect(diagramLookKey(diagramPrintLook(profileWith({ diagrammi: { stile: "nota", fondo: false } })))).not.toBe(base);
    expect(diagramLookKey(diagramPrintLook(profileWith({ colori: { "diagramma-linee": "#000000" } })))).not.toBe(base);
    expect(diagramLookKey(diagramPrintLook(defaultProfile(), new Map([[0, "aurora"]])))).not.toBe(base);
  });
});

/// Una figura di Mermaid come la monta `createMermaidView`.
function figure(state: "ready" | "error", problem = ""): HTMLElement {
  const element = document.createElement("figure");
  element.className = "mermaid-diagram";
  element.dataset.state = state;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = problem;
  const view = document.createElement("div");
  view.className = "mermaid-diagram-view";
  const image = document.createElement("img");
  image.hidden = state === "error";
  view.append(image);
  const details = document.createElement("details");
  details.hidden = state !== "error";
  element.append(status, view, details);
  return element;
}

const NO_OVERFLOW: FitMeasure = { widths: () => ({ content: 100, room: 100 }) };

describe("la resa pronta per le pagine", () => {
  it("un diagramma con un errore mostra l'ultimo disegno buono della stessa posizione", () => {
    const memory = new DiagramMemory();
    memory.remember(1, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const page = document.createElement("div");
    const good = figure("ready");
    const broken = figure("error", "Riga 2: manca una freccia");
    page.append(good, broken);
    preparePrintVectors(page, memory, NO_OVERFLOW);
    const image = broken.querySelector("img")!;
    expect(image.hidden).toBe(false);
    expect(image.getAttribute("src")).toMatch(/^blob:/u);
    expect(memory.svgOf(image.getAttribute("src")!)).toContain("<svg");
    expect(broken.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(true);
    expect(broken.querySelector<HTMLElement>("details")!.hidden).toBe(true);
    // Rifatta l'impaginazione, il disegno resta e non si moltiplica.
    preparePrintVectors(page, memory, NO_OVERFLOW);
    expect(page.querySelectorAll(".mermaid-diagram")).toHaveLength(2);
    memory.dispose();
  });

  it("senza un disegno buono, il riquadro «non disegnato» dice il problema", () => {
    const memory = new DiagramMemory();
    const page = document.createElement("div");
    const broken = figure("error", "Riga 2: manca una freccia");
    broken.setAttribute("data-md-from", "40");
    page.append(broken);
    preparePrintVectors(page, memory, NO_OVERFLOW);
    const box = page.querySelector<HTMLElement>(".print-undrawn")!;
    expect(box).not.toBeNull();
    expect(page.querySelector(".mermaid-diagram")).toBeNull();
    expect(box.textContent).toContain("Riga 2: manca una freccia");
    expect(box.getAttribute("aria-label")).toContain("Riga 2");
    expect(box.getAttribute("data-md-from")).toBe("40");
    expect(box.dataset.exportDiagram).toBe("0");
  });

  it("i diagrammi di una nota trasclusa non contano fra le posizioni della nota", () => {
    const memory = new DiagramMemory();
    const page = document.createElement("div");
    const embed = document.createElement("div");
    embed.className = "embed";
    const inner = figure("ready");
    embed.append(inner);
    const own = figure("ready");
    page.append(embed, own);
    preparePrintVectors(page, memory, NO_OVERFLOW);
    expect(inner.dataset.exportDiagram).toBeUndefined();
    expect(own.dataset.exportDiagram).toBe("0");
  });

  it("una formula più larga della colonna si rimpicciolisce e lo dice", () => {
    const page = document.createElement("div");
    const block = document.createElement("div");
    block.className = "math-block";
    const formula = document.createElement("span");
    formula.className = "katex-display";
    block.append(formula);
    page.append(block);
    const measure: FitMeasure = { widths: () => ({ content: 800, room: 400 }) };
    preparePrintVectors(page, new DiagramMemory(), measure);
    expect(formula.style.getPropertyValue("zoom")).toBe("0.5");
    expect(block.querySelector(".export-fit-note")?.textContent).toBe("formula al 50% per stare nella pagina");
    // Di nuovo, senza una seconda riga e dalla misura vera.
    preparePrintVectors(page, new DiagramMemory(), measure);
    expect(block.querySelectorAll(".export-fit-note")).toHaveLength(1);
    preparePrintVectors(page, new DiagramMemory(), NO_OVERFLOW);
    expect(formula.style.getPropertyValue("zoom")).toBe("");
    expect(block.querySelector(".export-fit-note")).toBeNull();
  });

  it("una formula enorme non scende sotto il minimo", () => {
    const page = document.createElement("div");
    const block = document.createElement("div");
    block.className = "math-block";
    const formula = document.createElement("span");
    formula.className = "katex-display";
    block.append(formula);
    page.append(block);
    preparePrintVectors(page, new DiagramMemory(), { widths: () => ({ content: 10_000, room: 400 }) });
    expect(Number(formula.style.getPropertyValue("zoom"))).toBe(MIN_FIT);
  });

  it("un diagramma più largo della colonna scende fino a starci", () => {
    const page = document.createElement("div");
    const ready = figure("ready");
    page.append(ready);
    preparePrintVectors(page, new DiagramMemory(), { widths: () => ({ content: 900, room: 600 }) });
    const image = ready.querySelector("img")!;
    expect(image.style.getPropertyValue("--diagram-min-width")).toBe("0px");
    expect(ready.querySelector(".export-fit-note")?.textContent).toBe("diagramma al 67% per stare nella pagina");
  });
});

describe("l'SVG passato al core", () => {
  const SVG = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 40\" width=\"100%\" style=\"max-width: 120px;\">",
    "<style>.node rect{fill:#ff0000;stroke:#0000ff;stroke-width:2px}.label{font-family:Inter;font-size:14px}@font-face{font-family:X;src:url(x.woff)}</style>",
    "<g class=\"node\"><rect width=\"40\" height=\"20\"/><text class=\"label\" x=\"4\" y=\"14\">Parti</text></g>",
    "<foreignObject width=\"10\" height=\"10\"><div>html</div></foreignObject>",
    "<script>alert(1)</script>",
    "</svg>",
  ].join("");

  it("scrive i valori calcolati come attributi, senza fogli, script né HTML", () => {
    const out = svgForCore(SVG)!;
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("@font-face");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("foreignObject");
    expect(out).not.toMatch(/\sstyle="/u);
    const rect = doc.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("rgba(255, 0, 0, 1)");
    expect(rect.getAttribute("stroke")).toBe("rgba(0, 0, 255, 1)");
    expect(rect.getAttribute("stroke-width")).toBe("2px");
  });

  it("le scritte restano testo, coi loro caratteri, e la misura viene dalla viewBox", () => {
    const out = svgForCore(SVG)!;
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const text = doc.querySelector("text")!;
    expect(text.textContent).toBe("Parti");
    expect(text.getAttribute("font-size")).toBe("14px");
    expect(text.getAttribute("font-family")).toContain("Inter");
    const root = doc.documentElement;
    expect(root.getAttribute("width")).toBe("120");
    expect(root.getAttribute("height")).toBe("40");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("non lascia niente nella pagina: né la copia montata né il foglio", () => {
    svgForCore(SVG);
    expect(document.body.children).toHaveLength(0);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });

  it("un testo che non è un SVG non passa", () => {
    expect(svgForCore("<html><body>no</body></html>")).toBeNull();
    expect(svgForCore("non è markup")).toBeNull();
  });

  it("un'immagine che non è un diagramma passa come immagine", () => {
    const image = document.createElement("img");
    image.src = "blob:altro";
    expect(vectorOf(image)).toBeNull();
  });

  it("l'ultimo disegno buono di un diagramma con un errore passa come vettore", () => {
    const memory = new DiagramMemory();
    memory.remember(0, SVG);
    const image = document.createElement("img");
    image.src = memory.url(0)!;
    const out = vectorOf(image, memory);
    expect(out).toContain("<text");
    expect(out).not.toContain("<style");
    memory.dispose();
  });
});
