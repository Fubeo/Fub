// @vitest-environment happy-dom
// Le tavolozze dei diagrammi: complete, valide e leggibili in ogni stile, luce
// e contrasto. Il contrasto è quello WCAG: 4.5 per il testo, 3 per i tratti.

import { describe, expect, it } from "vitest";
import { DIAGRAM_STYLE_IDS } from "../theme/diagram-style";
import {
  decorateSvg,
  FLOW_NODE_SPACING,
  FLOW_RANK_SPACING,
  fontFaceCss,
  mermaidStyleConfig,
  PAPER_MARGIN,
  themeCssFor,
  themeVariablesFor,
} from "./mermaid-drawing";
import {
  contrast,
  type DiagramContrast,
  type DiagramLight,
  type DiagramPalette,
  EDGE_STROKE,
  mix,
  paletteFor,
  parseHex,
  readableOn,
  swatchesOf,
} from "./mermaid-styles";

const LIGHTS: DiagramLight[] = ["light", "dark"];
const LEVELS: DiagramContrast[] = ["normal", "high"];

const CASES = DIAGRAM_STYLE_IDS.flatMap((style) =>
  LIGHTS.flatMap((light) => LEVELS.map((level) => ({ style, light, level }))));

/// Ogni coppia testo/fondo che un diagramma disegna davvero.
function textPairs(p: DiagramPalette, v: Record<string, unknown>): [string, string, string][] {
  const s = (key: string) => String(v[key]);
  const pairs: [string, string, string][] = [
    ["inchiostro/fondo", p.ink, p.ground],
    ["attenuato/fondo", p.muted, p.ground],
    ["nodo", s("primaryTextColor"), s("primaryColor")],
    ["secondario", s("secondaryTextColor"), s("secondaryColor")],
    ["terziario", s("tertiaryTextColor"), s("tertiaryColor")],
    ["nota", s("noteTextColor"), s("noteBkgColor")],
    ["gruppo", p.cluster.text, p.cluster.fill],
    ["attore", s("actorTextColor"), s("actorBkg")],
    ["etichetta arco", s("textColor"), s("edgeLabelBackground")],
    ["etichetta sequenza", s("labelTextColor"), s("labelBoxBkgColor")],
    ["stato", s("stateLabelColor"), s("stateBkg")],
    ["errore", s("errorTextColor"), s("errorBkgColor")],
    ["attività", s("taskTextColor"), s("taskBkgColor")],
    ["attività fatta", s("taskTextDarkColor"), s("doneTaskBkgColor")],
    ["attività critica", s("taskTextDarkColor"), s("critBkgColor")],
    ["attività attiva", s("taskTextDarkColor"), s("activeTaskBkgColor")],
    ["commit", s("commitLabelColor"), s("commitLabelBackground")],
    ["tag", s("tagLabelColor"), s("tagLabelBackground")],
    ["numero sequenza", s("sequenceNumberColor"), s("signalColor")],
  ];
  for (let i = 1; i <= 4; i++) pairs.push([`quadrante ${i}`, s(`quadrant${i}TextFill`), s(`quadrant${i}Fill`)]);
  for (let i = 0; i < 12; i++) pairs.push([`serie ${i}`, s(`cScaleLabel${i}`), s(`cScale${i}`)]);
  for (let i = 0; i < 8; i++) pairs.push([`ramo ${i}`, s(`gitBranchLabel${i}`), s(`git${i}`)]);
  // Il percorso utente scrive i riquadri col colore del testo.
  for (let i = 0; i < 8; i++) pairs.push([`percorso ${i}`, s("textColor"), s(`fillType${i}`)]);
  return pairs;
}

function hexes(value: unknown, path: string, out: [string, string][]): void {
  // La tavolozza di xyChart è una lista separata da virgole: si prova a parte.
  if (typeof value === "string" && value.startsWith("#") && !value.includes(",")) out.push([path, value]);
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) hexes(inner, `${path}.${key}`, out);
  }
}

describe("i colori", () => {
  it("mescola, misura e sceglie il più leggibile", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#12345g")).toBeNull();
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(readableOn("#ffffff", ["#eeeeee", "#666666"])).toBe("#666666");
    // Nessun candidato basta: si spinge verso il polo finché basta.
    const pushed = readableOn("#ffffff", ["#cccccc"]);
    expect(contrast(pushed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("le tavolozze", () => {
  it.each(CASES)("$style $light $level: il testo si legge su ogni fondo", ({ style, light, level }) => {
    const p = paletteFor(style, light, level);
    const v = themeVariablesFor(p);
    const target = 4.5;
    const failures = textPairs(p, v)
      .map(([name, text, background]) => ({ name, text, background, ratio: contrast(text, background) }))
      .filter(({ ratio }) => ratio < target)
      .map(({ name, text, background, ratio }) => `${name}: ${text} su ${background} = ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
    if (level === "high") expect(contrast(p.ink, p.ground)).toBeGreaterThanOrEqual(7);
  });

  it.each(CASES)("$style $light $level: tratti e bordi si vedono", ({ style, light, level }) => {
    const p = paletteFor(style, light, level);
    expect(contrast(p.line, p.ground), "linea").toBeGreaterThanOrEqual(3);
    expect(contrast(p.accent, p.ground), "accento").toBeGreaterThanOrEqual(3);
  });

  it.each(CASES)("$style $light $level: variabili complete e colori validi", ({ style, light, level }) => {
    const p = paletteFor(style, light, level);
    const v = themeVariablesFor(p);
    for (const key of [
      "background", "primaryColor", "primaryTextColor", "primaryBorderColor", "lineColor", "textColor",
      "noteBkgColor", "clusterBkg", "edgeLabelBackground", "actorBkg", "taskBkgColor", "pieStrokeColor",
      "quadrant1Fill", "requirementBackground", "archEdgeColor",
      ...Array.from({ length: 12 }, (_, i) => [`cScale${i}`, `cScaleLabel${i}`, `cScalePeer${i}`, `cScaleInv${i}`, `pie${i + 1}`]).flat(),
      ...Array.from({ length: 8 }, (_, i) => [`git${i}`, `gitInv${i}`, `gitBranchLabel${i}`, `fillType${i}`]).flat(),
    ]) {
      expect(v[key], key).toBeDefined();
    }
    expect(v.darkMode).toBe(light === "dark");
    expect((v.xyChart as { plotColorPalette: string }).plotColorPalette.split(",")).toHaveLength(12);
    const colors: [string, string][] = [];
    hexes(v, "v", colors);
    expect(colors.length).toBeGreaterThan(100);
    for (const [path, color] of colors) expect(parseHex(color), path).not.toBeNull();
    for (const color of (v.xyChart as { plotColorPalette: string }).plotColorPalette.split(",")) {
      expect(parseHex(color)).not.toBeNull();
    }
  });

  it("gli stili sono davvero diversi, e la luce li cambia", () => {
    const papers = new Set(DIAGRAM_STYLE_IDS.map((style) => paletteFor(style, "light").primary.fill));
    expect(papers.size).toBe(DIAGRAM_STYLE_IDS.length);
    for (const style of DIAGRAM_STYLE_IDS) {
      const day = paletteFor(style, "light");
      const night = paletteFor(style, "dark");
      expect(day.dark).toBe(false);
      expect(night.dark).toBe(true);
      expect(day.ground).not.toBe(night.ground);
      expect(swatchesOf(day)).toHaveLength(6);
    }
    expect(paletteFor("blueprint", "light").font).toBe("mono");
    expect(paletteFor("acquerello", "light").font).toBe("literata");
    expect(paletteFor("armonia", "light").paper).toBeNull();
  });

  it("Armonia segue i token del tema, e scarta quelli illeggibili", () => {
    const tokens: Record<string, string> = { ground: "#ffffff", "--doc-fg": "#101010", "--accent": "#d11d6a" };
    const p = paletteFor("armonia", "light", "normal", (name) => tokens[name] ?? null);
    expect(p.ground).toBe("#ffffff");
    expect(p.ink).toBe("#101010");
    expect(p.accent).toBe("#d11d6a");
    // Il nodo primario è una velatura dell'accento, col testo della nota.
    expect(p.primary.fill).toBe(mix("#d11d6a", "#ffffff", 0.14));
    expect(p.primary.text).toBe("#101010");
    // Un token che non è un esadecimale vale come assente.
    const odd = paletteFor("armonia", "dark", "normal", () => "rgb(1, 2, 3)");
    expect(odd.ground).toBe(paletteFor("armonia", "dark").ground);
  });

  it("l'alto contrasto rinforza i tratti", () => {
    for (const style of DIAGRAM_STYLE_IDS) {
      expect(paletteFor(style, "light", "high").stroke).toBeGreaterThan(paletteFor(style, "light").stroke);
    }
  });
});

describe("la configurazione di Mermaid", () => {
  it("usa il tema base, il carattere dello stile e il CSS che arrotonda", () => {
    const p = paletteFor("blueprint", "dark");
    const config = mermaidStyleConfig("blueprint", p);
    expect(config.theme).toBe("base");
    expect(String(config.fontFamily)).toContain("JetBrains Mono");
    expect(String(config.themeCSS)).toContain("stroke-dasharray:6 4");
    expect(themeCssFor("armonia", paletteFor("armonia", "light"))).toContain("rx:10px");
  });

  it("il tracciato è uno solo: gomiti arrotondati e le distanze del prototipo, in ogni stile", () => {
    for (const { style, light, level } of CASES) {
      expect(mermaidStyleConfig(style, paletteFor(style, light, level)).flowchart, `${style} ${light} ${level}`)
        .toMatchObject({ curve: "rounded", rankSpacing: FLOW_RANK_SPACING, nodeSpacing: FLOW_NODE_SPACING });
    }
    expect([FLOW_RANK_SPACING, FLOW_NODE_SPACING]).toEqual([58, 34]);
  });

  it("i collegamenti hanno lo spessore del prototipo in ogni stile, più netto nell'alto contrasto", () => {
    for (const { style, light, level } of CASES) {
      const p = paletteFor(style, light, level);
      expect(p.edge, `${style} ${light} ${level}`).toBe(level === "high" ? EDGE_STROKE + 0.6 : EDGE_STROKE);
      const css = themeCssFor(style, p);
      expect(css).toContain(`.messageLine1{stroke-width:${p.edge}px;stroke-linecap:round;stroke-linejoin:round;}`);
      // Nessuno stile lo cambia dopo: lo spessore dei collegamenti compare una volta.
      expect(css.match(/\.flowchart-link[^{]*\{stroke-width/g), style).toHaveLength(1);
      // Il tratteggio non si chiude sotto i capi tondi.
      expect(css).toContain(".flowchart-link.edge-pattern-dotted,.flowchart-link.edge-pattern-dashed,.messageLine1{stroke-dasharray:4 4;}");
      // L'etichetta su un ritaglio pieno della carta, nel colore attenuato.
      expect(css).toContain(`.edgeLabel rect{fill:${p.paper ?? p.ground};opacity:1;rx:5px;ry:5px;}`);
      expect(css).toContain(`.edgeLabel .label text,.edgeLabel .label tspan{fill:${p.muted};}`);
      expect(contrast(p.muted, p.paper ?? p.ground), `${style} ${light} ${level}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("i nodi tinti portano la loro etichetta leggibile, e solo negli stili a colori", () => {
    for (const { style, light, level } of CASES) {
      const p = paletteFor(style, light, level);
      const css = themeCssFor(style, p);
      const tinted = [...css.matchAll(/:nth-child\((\d+)n\+(\d+)\)>rect\.label-container[^{]*\{fill:(#[0-9a-f]{6});[^}]*\}[^{]*\{fill:(#[0-9a-f]{6});/g)];
      expect(tinted.length, `${style} ${light}`).toBe(p.nodeHues);
      for (const [, , , fill, text] of tinted) {
        expect(contrast(text!, fill!), `${style} ${light} ${level} ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(paletteFor("inchiostro", "light").nodeHues).toBe(0);
    expect(paletteFor("aurora", "light").nodeHues).toBeGreaterThan(0);
  });

  it("i colori del sankey restano ai suoi nodi, che non hanno classe", () => {
    const css = themeCssFor("aurora", paletteFor("aurora", "light"));
    expect(css).toContain(">rect:not([class]){fill:");
    expect(css).not.toMatch(/\.node:nth-child\(12n\+\d+\) rect\{/);
  });

  it("il Gantt ha una larghezza sua, e il percorso utente il carattere dello stile", () => {
    const config = mermaidStyleConfig("blueprint", paletteFor("blueprint", "light"));
    expect((config.gantt as { useWidth: number }).useWidth).toBeGreaterThan(0);
    expect((config.journey as { taskFontFamily: string }).taskFontFamily).toContain("JetBrains Mono");
  });

  it("il CSS resta pittura: niente che sposti o misuri", () => {
    for (const style of DIAGRAM_STYLE_IDS) {
      const css = themeCssFor(style, paletteFor(style, "dark"));
      expect(css).not.toMatch(/font-size|padding|margin|width:(?!\d)|@import|url\(/);
    }
  });

  it("la regola del carattere porta i byte in linea", () => {
    const css = fontFaceCss("literata", "AAAA");
    expect(css).toContain('font-family:"Literata Variable"');
    expect(css).toContain("url(data:font/woff2;base64,AAAA)");
  });
});

describe("la tavola", () => {
  const svg = (inner: string) => new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" id="d1" width="100%" viewBox="0 0 200 100" style="max-width: 200px;"><style>#d1{}</style><g>${inner}</g></svg>`,
    "image/svg+xml",
  );

  it("allarga il viewBox del margine e mette la carta sotto il disegno", () => {
    const doc = svg("");
    const width = decorateSvg(doc, paletteFor("blueprint", "light"), fontFaceCss("mono", "AAAA"));
    const root = doc.documentElement;
    expect(width).toBe(200 + 2 * PAPER_MARGIN);
    expect(root.getAttribute("viewBox")).toBe(`${-PAPER_MARGIN} ${-PAPER_MARGIN} ${200 + 2 * PAPER_MARGIN} ${100 + 2 * PAPER_MARGIN}`);
    expect(root.getAttribute("style")).toContain(`max-width: ${200 + 2 * PAPER_MARGIN}px`);
    // Una larghezza in percentuale resta com'è.
    expect(root.getAttribute("width")).toBe("100%");
    const children = [...root.children].map((child) => child.localName);
    expect(children.slice(0, 3)).toEqual(["style", "defs", "rect"]);
    expect(root.children[0]!.textContent).toContain("@font-face");
    expect(root.querySelector("rect.fub-paper")!.getAttribute("style")).toBe("fill:url(#d1-paper)");
    expect(root.querySelector("pattern#d1-paper")).not.toBeNull();
  });

  it("Armonia non ha carta: la larghezza non cambia", () => {
    const doc = svg("");
    expect(decorateSvg(doc, paletteFor("armonia", "dark"), null)).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(doc.querySelector("rect.fub-paper")).toBeNull();
  });

  // I marcatori come li scrive Mermaid 11: le punte dei flussi, la freccia
  // delle sequenze, e punte che dicono qualcosa con la forma.
  const MARKERS = [
    `<marker id="d1_flowchart-v2-pointEnd" class="marker flowchart-v2" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrowMarkerPath" style="stroke-width: 1; stroke-dasharray: 1, 0;"/></marker>`,
    `<marker id="d1_flowchart-v2-pointStart" class="marker flowchart-v2" viewBox="0 0 10 10" refX="4.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 5 L 10 10 L 10 0 z" class="arrowMarkerPath" style="stroke-width: 1;"/></marker>`,
    `<marker id="d1_flowchart-v2-pointEnd-margin" class="marker flowchart-v2" viewBox="0 0 11.5 14" refX="11.5" refY="7" markerWidth="10.5" markerHeight="14" orient="auto"><path d="M 0 0 L 11.5 7 L 0 14 z"/></marker>`,
    `<marker id="d1-arrowhead" refX="7.9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M -1 0 L 10 5 L 0 10 z"/></marker>`,
    `<marker id="d1_stateDiagram-barbEnd" refX="19" refY="7" markerWidth="20" markerHeight="14"><path d="M 19,7 L9,13 L14,7 L9,1 Z"/></marker>`,
    `<marker id="d1_classDiagram-extensionEnd" viewBox="0 0 10 10" refX="18" refY="7"><path d="M 1,1 V 13 L18,7 Z"/></marker>`,
  ].join("");
  const edges = (n: number) => Array.from({ length: n }, (_, i) =>
    `<path class="flowchart-link" d="M0 ${i}L10 ${i}" marker-end="url(#d1_flowchart-v2-pointEnd)"/>`).join("");

  it("le punte dei flussi e delle sequenze sono quelle sottili del prototipo, a un soffio dal nodo", () => {
    for (const style of DIAGRAM_STYLE_IDS) {
      const doc = svg(`<defs>${MARKERS}</defs>${edges(3)}`);
      decorateSvg(doc, paletteFor(style, "light"), null);
      const marker = (id: string) => doc.getElementById(id)!;
      const path = (id: string) => marker(id).querySelector("path")!;

      const end = marker("d1_flowchart-v2-pointEnd");
      expect(path(end.id).getAttribute("d")).toBe("M0.6 1.4L9.6 5 0.6 8.6 2.6 5z");
      expect(path(end.id).getAttribute("style")).toBe("stroke:none");
      expect(end.getAttribute("markerWidth")).toBe("9");
      // Mermaid ferma il tratto a 4 dal bordo: la cima arriva a 1.8 dal bordo,
      // e la fine del tratto cade nel pieno, fra l'incavo (2.6) e la cima.
      const refX = Number(end.getAttribute("refX"));
      expect((9.6 - refX) * 0.9).toBeCloseTo(4 - 1.8, 2);
      expect(refX).toBeGreaterThan(2.6);
      const start = marker("d1_flowchart-v2-pointStart");
      expect(path(start.id).getAttribute("d")).toBe("M9.4 1.4L0.4 5 9.4 8.6 7.4 5z");
      expect((Number(start.getAttribute("refX")) - 0.4) * 0.9).toBeCloseTo(4 - 1.8, 2);
      expect(Number(start.getAttribute("refX"))).toBeLessThan(7.4);
      // La freccia delle sequenze ha la stessa forma, con la cima dove era.
      const head = marker("d1-arrowhead");
      expect(path(head.id).getAttribute("d")).toBe("M1.9 1.76L10 5 1.9 8.24 3.7 5z");
      expect(head.getAttribute("refX")).toBe("7.9");
      // Le altre restano come Mermaid le disegna.
      expect(path("d1_flowchart-v2-pointEnd-margin").getAttribute("d")).toBe("M 0 0 L 11.5 7 L 0 14 z");
      expect(path("d1_stateDiagram-barbEnd").getAttribute("d")).toBe("M 19,7 L9,13 L14,7 L9,1 Z");
      expect(path("d1_classDiagram-extensionEnd").getAttribute("d")).toBe("M 1,1 V 13 L18,7 Z");
    }
  });

  it("con 500 archi si toccano solo i marcatori condivisi, non i collegamenti", () => {
    const doc = svg(`<defs>${MARKERS}</defs>${edges(500)}`);
    const before = [...doc.querySelectorAll("path.flowchart-link")].map((edge) => edge.outerHTML);
    decorateSvg(doc, paletteFor("armonia", "dark"), null);
    const after = [...doc.querySelectorAll("path.flowchart-link")].map((edge) => edge.outerHTML);
    expect(after).toEqual(before);
    expect(doc.querySelectorAll("marker")).toHaveLength(6);
    expect(doc.getElementById("d1_flowchart-v2-pointEnd")!.querySelector("path")!.getAttribute("d"))
      .toBe("M0.6 1.4L9.6 5 0.6 8.6 2.6 5z");
  });

  it("ogni percentuale della torta si legge sulla sua fetta", () => {
    const p = paletteFor("inchiostro", "light");
    const doc = svg(
      `<path class="pieCircle" fill="${p.series[0]}"/><path class="pieCircle" fill="${p.series[3]}"/>`
      + `<text class="slice" style="text-anchor: middle;">60%</text><text class="slice">40%</text>`,
    );
    decorateSvg(doc, p, null);
    const labels = [...doc.querySelectorAll("text.slice")];
    labels.forEach((label, i) => {
      const color = /fill:(#[0-9a-f]{6})/.exec(label.getAttribute("style") ?? "")![1]!;
      expect(contrast(color, p.series[i === 0 ? 0 : 3]!)).toBeGreaterThanOrEqual(4.5);
    });
    expect(labels[0]!.getAttribute("style")).toContain("text-anchor: middle");
  });
});
