// Il disegno di un diagramma in uno dei cinque stili: le variabili del tema
// `base` di Mermaid, il CSS che le rifinisce, il carattere incorporato e la
// tavola (carta, trama, margine) attorno all'SVG.
//
// Le tavolozze stanno in `mermaid-styles.ts`, che serve anche al menu degli
// stili e alle strisce di colore; questo modulo serve soltanto quando si
// disegna, e si carica insieme a Mermaid (`ui/mermaid.ts`), fuori dal chunk
// del documento.
//
// Tutto qui è puro — niente DOM, tranne `decorateSvg` che lavora su un
// documento SVG già analizzato — e si prova senza Mermaid.

import type { DiagramStyleId } from "../theme/diagram-style";
import {
  contrast,
  DIAGRAM_FONTS,
  inkTint,
  mix,
  parseHex,
  readableOn,
  seriesBorder,
  seriesLabel,
  type DiagramFont,
  type DiagramPalette,
} from "./mermaid-styles";

/// Un colore di testo solo per tutte le fette di una torta: quello col
/// contrasto minimo più alto fra inchiostro e carta.
function pieLabel(p: DiagramPalette): string {
  const candidates = [p.ink, p.ground, "#ffffff", "#111111"];
  let best = candidates[0]!;
  let bestWorst = 0;
  for (const candidate of candidates) {
    const worst = Math.min(...p.series.map((color) => contrast(candidate, color)));
    if (worst > bestWorst) {
      bestWorst = worst;
      best = candidate;
    }
  }
  return best;
}

/// La regola `@font-face` che porta il carattere dentro l'SVG.
export function fontFaceCss(font: DiagramFont, base64: string): string {
  const { family } = DIAGRAM_FONTS[font];
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;`
    + `src:url(data:font/woff2;base64,${base64}) format("woff2");}`;
}

// ---------------------------------------------------------------------------
// Le variabili di Mermaid.
// ---------------------------------------------------------------------------

/// Tutte le variabili del tema `base` che i diagrammi leggono. Ogni colore
/// è scritto: nessuno lo deriva Mermaid, che scurirebbe e invertirebbe a modo
/// suo le serie e le etichette.
export function themeVariablesFor(p: DiagramPalette): Record<string, unknown> {
  const font = DIAGRAM_FONTS[p.font];
  const paper = p.paper ?? p.ground;
  const soft = (color: string, amount: number) => mix(color, p.ground, amount);
  const v: Record<string, unknown> = {
    darkMode: p.dark,
    background: paper,
    fontFamily: font.stack,
    fontSize: `${font.size}px`,
    primaryColor: p.primary.fill,
    primaryTextColor: p.primary.text,
    primaryBorderColor: p.primary.border,
    secondaryColor: p.secondary.fill,
    secondaryTextColor: p.secondary.text,
    secondaryBorderColor: p.secondary.border,
    tertiaryColor: p.tertiary.fill,
    tertiaryTextColor: p.tertiary.text,
    tertiaryBorderColor: p.tertiary.border,
    noteBkgColor: p.note.fill,
    noteTextColor: p.note.text,
    noteBorderColor: p.note.border,
    lineColor: p.line,
    arrowheadColor: p.line,
    textColor: p.ink,
    titleColor: p.ink,
    border1: p.primary.border,
    border2: p.tertiary.border,
    mainBkg: p.primary.fill,
    nodeBkg: p.primary.fill,
    nodeBorder: p.primary.border,
    nodeTextColor: p.primary.text,
    clusterBkg: p.cluster.fill,
    clusterBorder: p.cluster.border,
    defaultLinkColor: p.line,
    edgeLabelBackground: paper,
    errorBkgColor: soft(p.accent, 0.18),
    errorTextColor: readableOn(soft(p.accent, 0.18), [p.ink]),
    // Sequenze.
    actorBkg: p.primary.fill,
    actorBorder: p.primary.border,
    actorTextColor: p.primary.text,
    actorLineColor: soft(p.line, 0.6),
    signalColor: p.line,
    signalTextColor: p.ink,
    labelBoxBkgColor: p.secondary.fill,
    labelBoxBorderColor: p.secondary.border,
    labelTextColor: p.secondary.text,
    loopTextColor: p.ink,
    activationBkgColor: p.tertiary.fill,
    activationBorderColor: p.tertiary.border,
    sequenceNumberColor: readableOn(p.line, [paper, p.ink]),
    // Stati.
    labelColor: p.ink,
    stateBkg: p.primary.fill,
    stateLabelColor: p.primary.text,
    labelBackgroundColor: paper,
    altBackground: p.tertiary.fill,
    compositeBackground: paper,
    compositeTitleBackground: p.primary.fill,
    compositeBorder: p.primary.border,
    transitionColor: p.line,
    transitionLabelColor: p.ink,
    specialStateColor: p.line,
    innerEndBackground: p.primary.border,
    // Classi, entità, requisiti.
    classText: p.primary.text,
    attributeBackgroundColorOdd: soft(p.primary.fill, 0.55),
    attributeBackgroundColorEven: p.primary.fill,
    rowOdd: soft(p.primary.fill, 0.55),
    rowEven: p.primary.fill,
    requirementBackground: p.primary.fill,
    requirementBorderColor: p.primary.border,
    requirementBorderSize: String(p.stroke),
    requirementTextColor: p.primary.text,
    relationColor: p.line,
    relationLabelBackground: paper,
    relationLabelColor: p.ink,
    personBkg: p.primary.fill,
    personBorder: p.primary.border,
    // Gantt.
    sectionBkgColor: soft(p.series[0]!, 0.22),
    altSectionBkgColor: paper,
    sectionBkgColor2: soft(p.series[1]!, 0.22),
    excludeBkgColor: soft(p.muted, 0.12),
    taskBorderColor: p.primary.border,
    taskBkgColor: p.primary.fill,
    taskTextColor: p.primary.text,
    taskTextLightColor: p.primary.text,
    taskTextOutsideColor: p.ink,
    taskTextDarkColor: p.ink,
    taskTextClickableColor: p.accent,
    activeTaskBorderColor: p.accent,
    activeTaskBkgColor: p.secondary.fill,
    gridColor: soft(p.line, 0.3),
    doneTaskBkgColor: soft(p.muted, 0.28),
    doneTaskBorderColor: p.muted,
    critBorderColor: p.accent,
    critBkgColor: soft(p.accent, 0.3),
    todayLineColor: p.accent,
    vertLineColor: p.accent,
    // Torta.
    pieTitleTextColor: p.ink,
    pieSectionTextColor: pieLabel(p),
    pieLegendTextColor: p.ink,
    pieStrokeColor: paper,
    pieStrokeWidth: "2px",
    pieOuterStrokeColor: paper,
    pieOuterStrokeWidth: "0px",
    pieOpacity: "1",
    // Percorso utente.
    faceColor: p.note.fill,
    // Quadranti.
    quadrant1Fill: soft(p.series[0]!, 0.2),
    quadrant2Fill: soft(p.series[1]!, 0.2),
    quadrant3Fill: soft(p.series[2]!, 0.2),
    quadrant4Fill: soft(p.series[3]!, 0.2),
    quadrant1TextFill: p.ink,
    quadrant2TextFill: p.ink,
    quadrant3TextFill: p.ink,
    quadrant4TextFill: p.ink,
    quadrantPointFill: p.accent,
    quadrantPointTextFill: p.ink,
    quadrantXAxisTextFill: p.ink,
    quadrantYAxisTextFill: p.ink,
    quadrantInternalBorderStrokeFill: soft(p.line, 0.45),
    quadrantExternalBorderStrokeFill: p.line,
    quadrantTitleFill: p.ink,
    // Grafici.
    xyChart: {
      backgroundColor: paper,
      titleColor: p.ink,
      dataLabelColor: p.ink,
      legendTextColor: p.ink,
      xAxisTitleColor: p.ink,
      xAxisLabelColor: p.muted,
      xAxisTickColor: p.muted,
      xAxisLineColor: p.line,
      yAxisTitleColor: p.ink,
      yAxisLabelColor: p.muted,
      yAxisTickColor: p.muted,
      yAxisLineColor: p.line,
      plotColorPalette: p.series.join(","),
    },
    radar: {
      axisColor: p.line,
      graticuleColor: soft(p.line, 0.5),
      curveOpacity: 0.4,
    },
    // Rami.
    commitLabelColor: p.ink,
    commitLabelBackground: p.secondary.fill,
    tagLabelColor: p.primary.text,
    tagLabelBackground: p.primary.fill,
    tagLabelBorder: p.primary.border,
    // Architettura.
    archEdgeColor: p.line,
    archEdgeArrowColor: p.line,
    archGroupBorderColor: p.cluster.border,
    scaleLabelColor: p.ink,
  };
  for (let i = 0; i < 12; i++) {
    const color = p.series[i % p.series.length]!;
    const label = seriesLabel(p, color);
    v[`cScale${i}`] = color;
    v[`cScaleLabel${i}`] = label;
    v[`cScaleInv${i}`] = label;
    v[`cScalePeer${i}`] = mix(p.ink, color, 0.25);
    v[`pie${i + 1}`] = color;
  }
  for (let i = 0; i < 8; i++) {
    const color = p.series[i]!;
    v[`git${i}`] = color;
    v[`gitInv${i}`] = seriesLabel(p, color);
    v[`gitBranchLabel${i}`] = seriesLabel(p, color);
    v[`fillType${i}`] = inkTint(p, color);
    v[`venn${i + 1}`] = color;
  }
  for (let i = 0; i < 5; i++) {
    v[`surface${i}`] = soft(p.primary.fill, 1 - i * 0.08);
    v[`surfacePeer${i}`] = soft(p.primary.border, 0.5 - i * 0.05);
  }
  return v;
}

/// Il CSS che Mermaid mette dentro l'SVG, sotto l'id del diagramma: angoli,
/// tratti, pesi. Solo proprietà di pittura e geometria: la misura delle
/// etichette resta quella che Mermaid ha calcolato.
export function themeCssFor(style: DiagramStyleId, p: DiagramPalette): string {
  const r = p.radius;
  const s = p.stroke;
  const rules = [
    `.node rect,.node polygon,.node circle,.node ellipse,.node path{stroke-width:${s}px;}`,
    `.node rect{rx:${r}px;ry:${r}px;}`,
    `.cluster rect{rx:${r + 2}px;ry:${r + 2}px;stroke-width:${s}px;}`,
    `.flowchart-link,.edgePath .path,.transition,.relation,.messageLine0,.messageLine1{stroke-width:${s}px;stroke-linecap:round;stroke-linejoin:round;}`,
    `.edgeLabel,.edgeLabel p,.labelBkg{background-color:${p.paper ?? p.ground};}`,
    `.edgeLabel rect{fill:${p.paper ?? p.ground};}`,
    `.actor,.note,.labelBox,rect.task,rect.section{rx:${Math.min(r, 8)}px;ry:${Math.min(r, 8)}px;}`,
    `.titleText,.pieTitleText,.cluster-label .nodeLabel{font-weight:600;}`,
    `.actor-man circle,.actor-man line{stroke:${p.primary.border};fill:${p.primary.fill};}`,
    // Sankey: i nodi — i soli rettangoli senza classe — prendono la serie (il
    // motore ha una sua tavolozza fissa), gli archi un velo neutro, le
    // etichette l'inchiostro.
    ...p.series.map((color, i) => `.nodes>.node:nth-child(${p.series.length}n+${i + 1})>rect:not([class]){fill:${color};}`),
    `.node-labels text{fill:${p.ink};}`,
    // Nodi tinti: forma, bordo ed etichetta dallo stesso colore.
    ...nodeHueRules(p),
    // Gantt: d3 scrive le linee della griglia con `currentColor`, che vince
    // sul colore che Mermaid dà al gruppo.
    `.grid .tick line{stroke:${mix(p.line, p.ground, 0.3)};}`,
    // Percorso utente: facce e bocche nei toni dello stile, e gli attori
    // nella serie (il motore fissa i suoi colori al primo caricamento).
    `.face{stroke:${p.muted};}`,
    `.mouth{stroke:${p.muted};}`,
    ...p.series.slice(0, 6).map((color, i) => `circle.actor-${i}{fill:${color};stroke:${seriesBorder(p, color)};}`),
    `.links .link{mix-blend-mode:normal!important;}`,
    `.mindmap-node .node-bkg,.section-root rect{stroke-width:0;}`,
  ];
  switch (style) {
    case "aurora":
      rules.push(
        `.node rect,.node polygon,.node circle,.node ellipse,.actor,.note,.cluster rect{filter:drop-shadow(0 2px 5px ${p.dark ? "rgba(0,0,0,0.45)" : "rgba(76,29,149,0.16)"});}`,
        `.flowchart-link,.edgePath .path{stroke-width:${s + 0.25}px;}`,
      );
      break;
    case "blueprint":
      rules.push(
        `.cluster rect{stroke-dasharray:6 4;}`,
        `.node rect,.node polygon,.node circle,.node ellipse{fill-opacity:${p.dark ? 0.85 : 1};}`,
        `.edgeLabel,.edgeLabel p{letter-spacing:0.02em;}`,
      );
      break;
    case "inchiostro":
      rules.push(
        `.cluster rect{stroke-dasharray:1 3;stroke-linecap:round;}`,
        `.marker,marker path{stroke-width:1px;}`,
      );
      break;
    case "acquerello":
      rules.push(
        `.node rect,.node polygon,.node circle,.node ellipse{stroke-opacity:0.85;}`,
        `.cluster rect{stroke-dasharray:3 3;}`,
      );
      break;
    default:
      break;
  }
  return rules.join("");
}

/// Le tinte alternate dei nodi. Le forme sono i figli diretti con la classe
/// `label-container` (rettangolo, rombo, cerchio); le classi UML, disegnate
/// a tratti, restano del primario.
function nodeHueRules(p: DiagramPalette): string[] {
  const n = Math.min(p.nodeHues, p.series.length);
  const rules: string[] = [];
  for (let i = 0; i < n; i++) {
    const color = p.series[i]!;
    const node = `.nodes>.node:nth-child(${n}n+${i + 1})`;
    rules.push(
      `${node}>rect.label-container,${node}>polygon.label-container,${node}>circle.label-container{fill:${color};stroke:${seriesBorder(p, color)};}`,
      `${node}>.label text,${node}>.label .nodeLabel{fill:${seriesLabel(p, color)};color:${seriesLabel(p, color)};}`,
    );
  }
  return rules;
}

/// La configurazione di Mermaid per uno stile: tema `base`, variabili, CSS.
export function mermaidStyleConfig(style: DiagramStyleId, p: DiagramPalette): Record<string, unknown> {
  return {
    theme: "base",
    themeVariables: themeVariablesFor(p),
    themeCSS: themeCssFor(style, p),
    fontFamily: DIAGRAM_FONTS[p.font].stack,
    look: "classic",
    flowchart: { curve: style === "blueprint" ? "linear" : "basis", padding: 14 },
    sankey: { linkColor: mix(p.line, p.ground, 0.45), showValues: true },
    // Il Gantt misura il contenitore della resa, che è fuori pagina: senza una
    // larghezza propria si disegna a 1200 e poi si rimpicciolisce illeggibile.
    // Le date dell'asse sono corte, o a quella larghezza si accavallano; un
    // `axisFormat` nel sorgente vince comunque.
    gantt: {
      useWidth: 760, fontSize: 12, sectionFontSize: 12, barHeight: 22, barGap: 6,
      leftPadding: 88, rightPadding: 96, gridLineStartPadding: 36, axisFormat: "%d/%m",
    },
    journey: { taskFontFamily: DIAGRAM_FONTS[p.font].stack },
  };
}

// ---------------------------------------------------------------------------
// La tavola: carta, trama, margine.
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
/// Il margine della carta attorno al disegno, in unità del viewBox.
export const PAPER_MARGIN = 18;

function svgElement(doc: Document, name: string, attributes: Record<string, string | number>): Element {
  const element = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/// Le percentuali di una torta hanno un colore solo in Mermaid; qui ognuna
/// prende quello leggibile sulla sua fetta. Fette e testi nascono dagli stessi
/// dati, nello stesso ordine.
function sliceLabels(root: Element, p: DiagramPalette): void {
  const slices = root.querySelectorAll("path.pieCircle");
  root.querySelectorAll("text.slice").forEach((label, i) => {
    const color = slices[i]?.getAttribute("fill") ?? "";
    if (parseHex(color)) label.setAttribute("style", `${label.getAttribute("style") ?? ""};fill:${seriesLabel(p, color)}`);
  });
}

/// Mette carta e carattere dentro l'SVG di Mermaid: il margine, la trama sotto
/// il disegno, la regola `@font-face` in testa; e dà alle etichette delle
/// fette un colore leggibile. Restituisce la larghezza naturale nuova, o
/// `null` se non cambia (niente carta, o un viewBox illeggibile).
export function decorateSvg(doc: Document, p: DiagramPalette, fontCss: string | null): number | null {
  const root = doc.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS) return null;
  sliceLabels(root, p);
  if (fontCss) {
    const style = svgElement(doc, "style", {});
    style.textContent = fontCss;
    root.insertBefore(style, root.firstChild);
  }
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2]! <= 0 || box[3]! <= 0) return null;
  if (p.paper === null) return null;
  const m = PAPER_MARGIN;
  const [x, y, w, h] = [box[0]! - m, box[1]! - m, box[2]! + 2 * m, box[3]! + 2 * m];
  root.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  const declared = /max-width:\s*([\d.]+)px/.exec(root.getAttribute("style") ?? "");
  if (declared) root.setAttribute("style", (root.getAttribute("style") ?? "").replace(declared[0], `max-width: ${w}px`));
  for (const [name, grow] of [["width", w], ["height", h]] as const) {
    const value = root.getAttribute(name);
    if (value !== null && /^[\d.]+(px)?$/.test(value)) root.setAttribute(name, String(grow));
  }

  const defs = svgElement(doc, "defs", {});
  const id = `${root.getAttribute("id") ?? "fub"}-paper`;
  let paint = p.paper;
  if (p.texture === "grid" && p.texture2) {
    const minor = svgElement(doc, "pattern", { id: `${id}-minor`, width: 12, height: 12, patternUnits: "userSpaceOnUse" });
    minor.append(svgElement(doc, "path", { d: "M 12 0 L 0 0 0 12", fill: "none", stroke: p.texture2, "stroke-width": 0.5 }));
    const major = svgElement(doc, "pattern", { id, x, y, width: 60, height: 60, patternUnits: "userSpaceOnUse" });
    major.append(
      svgElement(doc, "rect", { width: 60, height: 60, fill: p.paper }),
      svgElement(doc, "rect", { width: 60, height: 60, fill: `url(#${id}-minor)` }),
      svgElement(doc, "path", { d: "M 60 0 L 0 0 0 60", fill: "none", stroke: p.texture2, "stroke-width": 1.1 }),
    );
    defs.append(minor, major);
    paint = `url(#${id})`;
  } else if (p.texture === "glow" || p.texture === "paper") {
    const gradient = svgElement(doc, "radialGradient", {
      id, cx: "50%", cy: p.texture === "glow" ? "35%" : "45%", r: p.texture === "glow" ? "75%" : "85%",
    });
    const inner = p.texture === "glow" ? (p.texture2 ?? p.paper) : p.paper;
    const outer = p.texture === "glow" ? p.paper : (p.texture2 ?? p.paper);
    gradient.append(
      svgElement(doc, "stop", { offset: "0%", "stop-color": inner }),
      svgElement(doc, "stop", { offset: "100%", "stop-color": outer }),
    );
    defs.append(gradient);
    paint = `url(#${id})`;
  }
  // Lo stile in linea vince sulle regole di Mermaid che dipingono i `rect`.
  const sheet = svgElement(doc, "rect", { x, y, width: w, height: h, style: `fill:${paint}`, class: "fub-paper" });
  const after = fontCss ? root.firstChild?.nextSibling ?? null : root.firstChild;
  root.insertBefore(defs, after);
  root.insertBefore(sheet, defs.nextSibling);
  return Math.ceil(w);
}
