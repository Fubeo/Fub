// @vitest-environment happy-dom
// Le tavolozze dei diagrammi: complete, valide e leggibili in ogni stile, luce
// e contrasto. Il contrasto è quello WCAG: 4.5 per il testo, 3 per i tratti.

import { describe, expect, it } from "vitest";
import { DIAGRAM_STYLE_IDS } from "../theme/diagram-style";
import {
  decorateSvg,
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
    expect(config.flowchart).toMatchObject({ curve: "linear" });
    expect(mermaidStyleConfig("aurora", paletteFor("aurora", "light")).flowchart).toMatchObject({ curve: "basis" });
    expect(String(config.themeCSS)).toContain("stroke-dasharray:6 4");
    expect(themeCssFor("armonia", paletteFor("armonia", "light"))).toContain("rx:10px");
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
