// Diagrammi e formule nell'esportazione in PDF (E28, T75).
//
// Tre cose, tutte fra la resa per la stampa e il core:
//
// - **L'aspetto dei diagrammi** per l'esportazione, dalla sezione Diagrammi
//   del profilo: com'è nella nota, come il tema di stampa (Armonia coi colori
//   della carta) o uno dei quattro stili col fondo; uno stile diverso per un
//   diagramma solo (la memoria della nota, T68); quattro colori dati a mano
//   (nodi, decisioni, inizio e fine, linee) che vincono sullo stile; il fondo
//   sì o no. `overrideFor` ne fa l'aspetto imposto a ogni diagramma montato
//   (`DiagramLookOverride` di `ui/mermaid.ts`): `%% stile:` nella nota non si
//   tocca.
// - **La resa pronta per le pagine** (`preparePrintVectors`): un diagramma
//   con un errore mostra l'ultimo disegno buono che lo spazio ha visto, se no
//   il riquadro «non disegnato» col problema; una formula o un diagramma più
//   larghi della colonna si rimpiccioliscono per starci, e la pagina lo dice.
// - **L'SVG passato al core** (`svgForCore`, `vectorOf`): il disegno di un
//   diagramma è un `<img>` di un SVG con un foglio di stile suo, che `usvg`
//   legge solo in parte (niente `:nth-child`, niente `~`). Qui ogni elemento
//   prende i suoi valori calcolati come attributi di presentazione, il foglio
//   se ne va e le scritte restano `<text>`: `svg2pdf` ne fa vettori e testo
//   vero, che si seleziona. Le radici e le frecce delle formule sono SVG in
//   linea, che la misura (`probe.ts`) passa già così.

import { t } from "../i18n/strings";
import { DIAGRAM_STYLE_IDS, type DiagramStyleId } from "../theme/diagram-style";
import { drawnDiagramSvg, type DiagramLookOverride } from "../ui/mermaid";
import type { DiagramOwnColors } from "../ui/mermaid-styles";
import { adoptSheet } from "../ui/stylesheets";
import { ColorReader, SVG_PAINT } from "./probe";
import { paperColorsOf, type ExportProfile } from "./profile";

// --- L'aspetto dei diagrammi ------------------------------------------------

/// Lo stile dei diagrammi nell'esportazione: `nota` (com'è nella nota),
/// `tema` (Armonia coi colori del tema di stampa) o uno dei quattro stili che
/// hanno una carta loro.
export type ExportDiagramStyle = "nota" | "tema" | Exclude<DiagramStyleId, "armonia">;

/// Gli stili nell'ordine in cui la sezione li offre (il prototipo, passo 29).
export const EXPORT_DIAGRAM_STYLES: readonly ExportDiagramStyle[] = [
  "nota",
  "tema",
  ...DIAGRAM_STYLE_IDS.filter((id): id is Exclude<DiagramStyleId, "armonia"> => id !== "armonia"),
];

/// Lo stile di un valore del profilo: uno che questa versione non conosce si
/// mostra com'è nella nota, come lo disegnerebbe il core.
export function exportDiagramStyle(value: string | null | undefined): ExportDiagramStyle {
  return (EXPORT_DIAGRAM_STYLES as readonly string[]).includes(value ?? "") ? (value as ExportDiagramStyle) : "nota";
}

/// I quattro colori dati a mano, con la loro chiave nel profilo
/// (`ChiaveColore` del core) e la parte del diagramma che dipingono.
export const DIAGRAM_COLOR_KEYS = [
  { key: "diagramma-nodi", part: "nodes" },
  { key: "diagramma-decisioni", part: "decisions" },
  { key: "diagramma-inizio-fine", part: "ends" },
  { key: "diagramma-linee", part: "lines" },
] as const satisfies readonly { key: string; part: keyof DiagramOwnColors }[];

const HEX6 = /^#[0-9a-f]{6}$/iu;

/// I colori dei diagrammi che il profilo dà a mano; uno scritto male non c'è.
export function diagramOwnColors(profile: ExportProfile): DiagramOwnColors {
  const colors: { -readonly [K in keyof DiagramOwnColors]: string } = {};
  for (const { key, part } of DIAGRAM_COLOR_KEYS) {
    const value = profile.colori[key];
    if (value !== undefined && HEX6.test(value)) colors[part] = value.toLowerCase();
  }
  return colors;
}

/// Tutto ciò che decide come escono i diagrammi di una nota.
export interface DiagramPrintLook {
  readonly style: ExportDiagramStyle;
  readonly paper: boolean;
  readonly colors: DiagramOwnColors;
  /// La carta del tema di stampa, nei nomi che Armonia legge.
  readonly tokens: Readonly<Record<string, string>>;
  /// Lo stile dato a un diagramma solo, per la sua posizione nella nota.
  readonly each: ReadonlyMap<number, ExportDiagramStyle>;
}

/// I token di Armonia (`ARMONIA_TOKENS`) presi dalla carta di stampa: solo i
/// colori pieni, quelli che una tavolozza sa mescolare.
function printTokens(profile: ExportProfile): Record<string, string> {
  const paper = paperColorsOf(profile);
  const tokens: Record<string, string> = {};
  const take = (name: string, value: string | undefined) => {
    if (value !== undefined && HEX6.test(value)) tokens[name] = value.toLowerCase();
  };
  take("ground", paper["--doc-bg"]);
  take("--doc-fg", paper["--doc-fg"]);
  take("--muted", paper["--muted"]);
  take("--accent", paper["--accent"] ?? profile.colori["accento"]);
  for (const name of ["--syn-function", "--syn-keyword", "--syn-string", "--syn-literal", "--syn-operator", "--syn-name", "--syn-type"]) {
    take(name, paper[name]);
  }
  return tokens;
}

export function diagramPrintLook(profile: ExportProfile, each: ReadonlyMap<number, string> = new Map()): DiagramPrintLook {
  const own = new Map<number, ExportDiagramStyle>();
  for (const [index, style] of each) {
    if (Number.isSafeInteger(index) && index >= 0) own.set(index, exportDiagramStyle(style));
  }
  return {
    style: exportDiagramStyle(profile.diagrammi.stile),
    paper: profile.diagrammi.fondo,
    colors: diagramOwnColors(profile),
    tokens: printTokens(profile),
    each: own,
  };
}

/// Una firma dell'aspetto: se cambia, i diagrammi si ridisegnano.
export function diagramLookKey(look: DiagramPrintLook): string {
  return JSON.stringify([look.style, look.paper, look.colors, look.tokens, [...look.each].sort(([a], [b]) => a - b)]);
}

/// L'aspetto imposto al diagramma `index` della nota (`null`: un diagramma di
/// una nota trasclusa, che prende lo stile di tutti). `null` lascia il
/// diagramma com'è nella nota: nessuno stile scelto, nessun colore, il fondo.
export function overrideFor(look: DiagramPrintLook, index: number | null): DiagramLookOverride | null {
  const style = (index === null ? undefined : look.each.get(index)) ?? look.style;
  const changes = {
    ...(Object.keys(look.colors).length > 0 ? { colors: look.colors } : {}),
    ...(look.paper ? {} : { paper: false, ...(look.tokens["ground"] ? { ground: look.tokens["ground"] } : {}) }),
  };
  if (style === "nota") return Object.keys(changes).length > 0 ? changes : null;
  if (style === "tema") return { ...changes, style: "armonia", tokens: look.tokens };
  return { ...changes, style };
}

// --- La resa pronta per le pagine -------------------------------------------

/// Gli ultimi disegni buoni dei diagrammi di una nota, per la loro posizione:
/// vivono quanto lo spazio d'esportazione, attraverso le rese nuove.
export class DiagramMemory {
  private readonly good = new Map<number, string>();
  private readonly urls = new Map<number, string>();

  remember(index: number, svg: string): void {
    if (this.good.get(index) === svg) return;
    this.good.set(index, svg);
    this.forgetUrl(index);
  }

  /// L'indirizzo dell'ultimo disegno buono, o `null` se non ce n'è.
  url(index: number): string | null {
    const svg = this.good.get(index);
    if (svg === undefined) return null;
    let url = this.urls.get(index);
    if (url === undefined) {
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      this.urls.set(index, url);
    }
    return url;
  }

  /// Il disegno di un indirizzo che questa memoria ha dato.
  svgOf(url: string): string | null {
    for (const [index, own] of this.urls) if (own === url) return this.good.get(index) ?? null;
    return null;
  }

  dispose(): void {
    for (const index of [...this.urls.keys()]) this.forgetUrl(index);
    this.good.clear();
  }

  private forgetUrl(index: number): void {
    const url = this.urls.get(index);
    if (url === undefined) return;
    URL.revokeObjectURL(url);
    this.urls.delete(index);
  }
}

/// Le misure che servono a capire se un pezzo sta nella colonna: le prove le
/// danno finte, happy-dom non dispone.
export interface FitMeasure {
  /// Quanto è largo il contenuto e quanto lo spazio che ha.
  widths(element: HTMLElement): { readonly content: number; readonly room: number };
}

const DOM_MEASURE: FitMeasure = {
  widths: (element) => ({ content: element.scrollWidth, room: element.clientWidth }),
};

/// Sotto questa misura un pezzo non si rimpicciolisce di più: oltre si
/// leggerebbe male anche stampato, e tanto vale tagliarlo.
export const MIN_FIT = 0.3;

const INDEX = "exportDiagram";
const FIT = "data-export-fit";

/// Prepara la resa montata (`page`, larga quanto la colonna) per le pagine.
/// Si chiama a ogni nuova impaginazione: ciò che ha fatto la volta prima lo
/// rifà da capo, perché la colonna può essere cambiata.
export function preparePrintVectors(page: HTMLElement, memory: DiagramMemory, measure: FitMeasure = DOM_MEASURE): void {
  numberDiagrams(page);
  for (const figure of page.querySelectorAll<HTMLElement>(".mermaid-diagram")) {
    const index = figure.dataset[INDEX] === undefined ? -1 : Number(figure.dataset[INDEX]);
    if (figure.dataset.state === "ready") {
      if (index < 0) continue;
      const image = figure.querySelector<HTMLImageElement>(".mermaid-diagram-view img");
      const svg = image ? drawnDiagramSvg(image) : null;
      if (svg !== null) memory.remember(index, svg);
    } else if (figure.dataset.state === "error" && !figure.hasAttribute("data-export-last-good")) {
      showLastGood(figure, index, memory);
    }
  }
  fitToColumn(page, measure);
}

/// Ogni diagramma della nota ha la sua posizione, la stessa che conta chi lo
/// monta (`mountMermaidBlocks`), scritta una volta: un riquadro messo al suo
/// posto la tiene, e le posizioni non scivolano. Quelli di una nota trasclusa
/// non ne hanno: prendono lo stile di tutti, e non hanno memoria.
function numberDiagrams(page: HTMLElement): void {
  let index = 0;
  for (const element of page.querySelectorAll<HTMLElement>(".mermaid-diagram, [data-export-diagram]")) {
    if (element.closest(".embed")) continue;
    if (element.dataset[INDEX] === undefined) element.dataset[INDEX] = String(index);
    index++;
  }
}

/// Un diagramma con un errore: l'ultimo disegno buono, se lo spazio ne ha
/// visto uno (pieno, come starà sulla carta: l'errore lo dice la nota); se
/// no il riquadro «non disegnato» col problema, come ciò che non arriva in
/// tempo (`markUndrawn`).
function showLastGood(figure: HTMLElement, index: number, memory: DiagramMemory): void {
  const problem = figure.querySelector<HTMLElement>("[role=status]")?.textContent?.trim() ?? "";
  const url = index < 0 ? null : memory.url(index);
  if (url !== null) {
    figure.setAttribute("data-export-last-good", "");
    const view = figure.querySelector<HTMLElement>(".mermaid-diagram-view");
    const image = view?.querySelector<HTMLImageElement>("img");
    if (view && image) {
      image.src = url;
      image.hidden = false;
      image.removeAttribute("width");
      view.style.setProperty("display", "grid");
    }
    for (const node of figure.querySelectorAll<HTMLElement>("[role=status], details")) node.hidden = true;
    figure.classList.remove("is-stale");
    return;
  }
  const box = document.createElement("div");
  box.className = "print-undrawn";
  box.setAttribute("role", "img");
  if (index >= 0) {
    box.dataset[INDEX] = String(index);
  }
  const name = figure.querySelector(".mermaid-diagram-caption-text")?.textContent?.trim() || t("print.undrawn.diagram");
  const state = problem ? t("pdf_export.diagram.undrawn", { problem }) : t("print.undrawn");
  box.setAttribute("aria-label", `${name}, ${state}`);
  for (const attribute of ["data-md-from", "data-md-to"]) {
    const value = figure.getAttribute(attribute);
    if (value !== null) box.setAttribute(attribute, value);
  }
  const label = document.createElement("span");
  label.className = "print-undrawn-name";
  label.textContent = name;
  const said = document.createElement("span");
  said.className = "print-undrawn-state";
  said.textContent = state;
  box.append(label, said);
  figure.replaceWith(box);
}

/// Le formule e i diagrammi più larghi della colonna si rimpiccioliscono per
/// starci (lo `zoom` cambia anche l'altezza che l'impaginatore misura), e una
/// riga sotto lo dice. Prima si torna alla misura vera.
function fitToColumn(page: HTMLElement, measure: FitMeasure): void {
  for (const element of page.querySelectorAll<HTMLElement>(`[${FIT}]`)) {
    element.style.removeProperty("zoom");
    element.style.removeProperty("--diagram-min-width");
    element.removeAttribute(FIT);
  }
  for (const note of page.querySelectorAll(".export-fit-note")) note.remove();
  // Le formule: il riquadro scorre di lato, il contenuto è la formula.
  for (const block of page.querySelectorAll<HTMLElement>(".math-block")) {
    const formula = block.querySelector<HTMLElement>(".katex-display") ?? block.firstElementChild;
    if (!(formula instanceof HTMLElement)) continue;
    const { content, room } = measure.widths(block);
    if (!(content > room + 1) || !(room > 0)) continue;
    const scale = Math.max(MIN_FIT, room / content);
    formula.style.setProperty("zoom", String(round(scale)));
    formula.setAttribute(FIT, "");
    block.append(fitNote("pdf_export.fit.formula", scale));
  }
  // I diagrammi: la tavola scorre di lato oltre il 72% della misura; sulla
  // carta non scorre niente, e il disegno scende fino a starci.
  for (const view of page.querySelectorAll<HTMLElement>(".mermaid-diagram .mermaid-diagram-view")) {
    const image = view.querySelector<HTMLImageElement>("img");
    if (!image || image.hidden) continue;
    const { content, room } = measure.widths(view);
    if (!(content > room + 1) || !(room > 0)) continue;
    const natural = image.width > 0 ? image.width : content;
    const scale = Math.max(MIN_FIT, room / Math.max(natural, content));
    image.style.setProperty("--diagram-min-width", "0px");
    image.setAttribute(FIT, "");
    view.closest(".mermaid-diagram")?.append(fitNote("pdf_export.fit.diagram", scale));
  }
}

function fitNote(key: "pdf_export.fit.formula" | "pdf_export.fit.diagram", scale: number): HTMLElement {
  const note = document.createElement("p");
  note.className = "export-fit-note";
  note.textContent = t(key, { percent: String(Math.round(scale * 100)) });
  return note;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// --- L'SVG passato al core --------------------------------------------------

/// Le proprietà del testo che il foglio di un diagramma dà alle sue scritte.
const TEXT_PAINT = ["font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing"] as const;

const SVG_NS = "http://www.w3.org/2000/svg";

/// L'SVG di un diagramma pronto per `usvg`: ogni elemento coi suoi valori
/// calcolati scritti come attributi di presentazione, senza fogli di stile,
/// script né `foreignObject`, con le scritte come `<text>`. `null` se il
/// testo non è un SVG. Si calcola montando una copia fuori dallo schermo: il
/// foglio del diagramma diventa un foglio costruito (la CSP non lascia
/// montare un `<style>`) e gli stili in linea passano dal CSSOM.
export function svgForCore(markup: string, doc: Document = document): string | null {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS || parsed.querySelector("parsererror")) return null;
  for (const node of root.querySelectorAll("script, foreignObject")) node.remove();
  const css = Array.from(root.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n").replace(/@font-face\s*\{[^}]*\}/gu, "");
  for (const style of root.querySelectorAll("style")) style.remove();
  // Gli stili in linea si tolgono dal documento analizzato (che la CSP non
  // governa) prima di copiarlo nella pagina, e ci tornano dal CSSOM.
  const inline = new Map<number, string>();
  const parsedAll = [root, ...root.querySelectorAll("*")];
  parsedAll.forEach((element, i) => {
    const value = element.getAttribute("style");
    if (value === null) return;
    inline.set(i, value);
    element.removeAttribute("style");
  });
  const live = doc.importNode(root, true) as unknown as SVGSVGElement;
  const liveAll = [live, ...live.querySelectorAll("*")];
  for (const [i, value] of inline) {
    const element = liveAll[i];
    if (element instanceof SVGElement || element instanceof HTMLElement) element.style.cssText = value;
  }
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  host.append(live);
  const sheet = css.trim() ? adoptSheet(css, doc) : null;
  doc.body.append(host);
  const colors = new ColorReader();
  try {
    parsedAll.forEach((target, i) => {
      const source = liveAll[i];
      if (!source) return;
      const style = doc.defaultView?.getComputedStyle(source) ?? getComputedStyle(source);
      const write = (property: string) => {
        const value = style.getPropertyValue(property).trim();
        if (!value) return;
        target.setAttribute(property, property === "fill" || property === "stroke" ? colors.css(value) : value);
      };
      for (const property of SVG_PAINT) write(property);
      if (source.localName === "text" || source.localName === "tspan") for (const property of TEXT_PAINT) write(property);
    });
  } finally {
    host.remove();
    sheet?.dispose();
  }
  // `usvg` vuole una misura: quella in percentuale di Mermaid (`100%`, con
  // `max-width` nello stile) diventa quella della `viewBox`.
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/u).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
    for (const [name, size] of [["width", box[2]!], ["height", box[3]!]] as const) {
      if (!/^\d+(\.\d+)?(px)?$/u.test(root.getAttribute(name) ?? "")) root.setAttribute(name, String(size));
    }
  }
  root.setAttribute("xmlns", SVG_NS);
  return new XMLSerializer().serializeToString(root);
}

/// Il vettore di un'immagine della resa, per la misura (`ProbeOptions.vectorOf`):
/// l'SVG di un diagramma disegnato, o il suo ultimo disegno buono, pronto per
/// `usvg`; `null` per un'immagine che non è un diagramma, che passa come
/// immagine.
export function vectorOf(image: HTMLImageElement, memory?: DiagramMemory): string | null {
  const src = image.getAttribute("src") ?? "";
  const svg = drawnDiagramSvg(image) ?? (memory && src ? memory.svgOf(src) : null);
  return svg === null ? null : svgForCore(svg);
}
