import type { Mermaid } from "mermaid";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import { writeClipboardText } from "../platform/clipboard";
import { on } from "../state/store";
import {
  DIAGRAM_STYLE_IDS,
  DIAGRAM_STYLE_SETTING,
  diagramStylePreference,
  onDiagramStyleChange,
  ownDiagramStyle,
  setDiagramStylePreference,
  styleDirective,
  styleDirectiveEdit,
  type DiagramStyleId,
  type SourceEdit,
} from "../theme/diagram-style";
import { identifier } from "./a11y";
import { openLightbox, svgSource } from "./lightbox";
import { openLifetime, type Teardown } from "./lifetime";
import { registerCustomRenderer } from "./custom";
import { showContextMenu, type MenuItem } from "./menu";
import {
  DIAGRAM_FONTS,
  paletteFor,
  swatchesOf,
  type DiagramContrast,
  type DiagramFont,
  type DiagramLight,
  type TokenReader,
} from "./mermaid-styles";
import { notify } from "./notify";
import { attributeValue, external, isAllowedLink } from "./sanitize";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Only explicit SVG anchors can become shell links; SVG nodes never cross into the shell. */
/// La larghezza con cui mermaid ha disegnato il diagramma: `max-width` nello
/// stile della radice, o la larghezza del `viewBox`.
export function naturalWidth(svg: Document): number | null {
  const root = svg.documentElement;
  const declared = /max-width:\s*([\d.]+)px/.exec(root.getAttribute("style") ?? "")?.[1];
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)[2];
  const width = Number(declared ?? box);
  return Number.isFinite(width) && width > 0 ? Math.ceil(width) : null;
}

function diagramLinks(svg: Document): Array<{ href: string; label: string }> {
  if (svg.documentElement.localName !== "svg" || svg.documentElement.namespaceURI !== SVG_NAMESPACE) return [];
  const links: Array<{ href: string; label: string }> = [];
  for (const anchor of svg.querySelectorAll("a")) {
    if (anchor.namespaceURI !== SVG_NAMESPACE || anchor.closest("foreignObject")) continue;
    const plain = anchor.getAttribute("href");
    const namespaced = anchor.getAttributeNS(XLINK_NAMESPACE, "href") ?? anchor.getAttribute("xlink:href");
    if (plain !== null && namespaced !== null && plain !== namespaced) continue;
    const href = plain ?? namespaced;
    if (href === null || href !== href.trim() || /[\s\x00-\x1F\x7F]/u.test(href)
      || /%(?![0-9a-f]{2})/iu.test(href) || !isAllowedLink(href)) continue;
    if (href.startsWith("#")) {
      if (href.length === 1) continue;
    } else if (/^https?:\/\//iu.test(href) || /^mailto:/iu.test(href)) {
      try {
        const parsed = new URL(href);
        if (parsed.protocol === "mailto:" ? !parsed.pathname || parsed.pathname.startsWith("//") : !parsed.hostname) continue;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    links.push({
      href: attributeValue("href", href),
      label: anchor.querySelector("text")?.textContent?.trim()
        || anchor.textContent?.trim() || href,
    });
  }
  return links;
}

const MAX_SOURCE_LENGTH = 50_000;
// Mermaid has process-wide configuration. Theme selection and rendering must
// share the same queue, not just calls to mermaid.render().
let rendering: Promise<unknown> = Promise.resolve();
let library: Promise<{ default: Mermaid }> | undefined;
// Variabili, CSS e tavola degli stili servono solo a disegnare: arrivano con
// Mermaid, non col documento.
let drawing: Promise<typeof import("./mermaid-drawing")> | undefined;

// ---------------------------------------------------------------------------
// L'aspetto di un diagramma: stile, luce, contrasto e — per Armonia — i token
// del tema da cui deriva i colori.
// ---------------------------------------------------------------------------

/// I token che Armonia legge, così come il tema montato li dichiara.
const THEME_TOKENS = [
  "--doc-bg", "--doc-fill-soft", "--doc-fg", "--muted", "--accent", "--warning",
  "--syn-function", "--syn-keyword", "--syn-string", "--syn-literal",
  "--syn-operator", "--syn-name", "--syn-type",
] as const;

/// I token già risolti, finché il tema dichiara gli stessi valori.
let tokenMemo: { raw: string; values: ReadonlyMap<string, string> } | null = null;

/// Un colore CSS qualsiasi (anche `color-mix()` o traslucido) in esadecimale,
/// dipinto a strati su una tela di un pixel. `null` senza tela o se lo strato di
/// fondo non è opaco.
function paintedHex(context: CanvasRenderingContext2D, layers: readonly string[]): string | null {
  context.clearRect(0, 0, 1, 1);
  for (const layer of layers) {
    context.fillStyle = "#010203";
    context.fillStyle = layer;
    if (context.fillStyle === "#010203") return null;
    context.fillRect(0, 0, 1, 1);
  }
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  if (a !== 255) return null;
  return `#${[r!, g!, b!].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function resolveTokens(raw: ReadonlyMap<string, string>): Map<string, string> {
  const values = new Map<string, string>();
  let context: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (!context) return values;
  // Il valore di una proprietà personalizzata è testo: lo risolve il motore
  // di stile, su un elemento che non si vede.
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const computed = (name: string): string | null => {
    const value = raw.get(name) ?? "";
    if (!value) return null;
    probe.style.color = "";
    probe.style.color = value;
    return probe.style.color ? getComputedStyle(probe).color : null;
  };
  try {
    const paper = computed("--doc-bg");
    if (!paper) return values;
    const ground = paintedHex(context, [paper, computed("--doc-fill-soft") ?? "transparent"]);
    if (!ground) return values;
    values.set("ground", ground);
    for (const name of THEME_TOKENS.slice(2)) {
      const color = computed(name);
      const hex = color ? paintedHex(context, [ground, color]) : null;
      if (hex) values.set(name, hex);
    }
  } finally {
    probe.remove();
  }
  return values;
}

/// I token del tema montato: la firma (per la cache) e il lettore.
function themeTokens(): { signature: string; read: TokenReader } {
  const styles = getComputedStyle(document.documentElement);
  const raw = new Map(THEME_TOKENS.map((name) => [name, styles.getPropertyValue(name).trim()]));
  const signature = [...raw.values()].join(";");
  if (tokenMemo?.raw !== signature) tokenMemo = { raw: signature, values: resolveTokens(raw) };
  const values = tokenMemo.values;
  return { signature: [...values.values()].join(","), read: (name) => values.get(name) ?? null };
}

interface Look {
  readonly style: DiagramStyleId;
  readonly light: DiagramLight;
  readonly contrast: DiagramContrast;
  /// Lo stile viene dal sorgente (`%% stile: …`), non dalla preferenza.
  readonly own: boolean;
  readonly read: TokenReader;
  readonly key: string;
}

function themeLight(): DiagramLight {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function lookOf(source: string, appearance: DiagramLight | undefined): Look {
  const own = ownDiagramStyle(source);
  const style = own ?? diagramStylePreference();
  const light = appearance ?? themeLight();
  const contrast = document.documentElement.dataset.contrast === "high" ? "high" : "normal";
  // Armonia prende i colori dal tema, ma soltanto se il tema è nella stessa
  // luce del diagramma: la stampa chiara di un tema scuro usa i valori di serie.
  const tokens = style === "armonia" && light === themeLight() ? themeTokens() : null;
  return {
    style,
    light,
    contrast,
    own: own !== null,
    read: tokens?.read ?? (() => null),
    key: [style, light, contrast, tokens?.signature ?? ""].join("|"),
  };
}

// ---------------------------------------------------------------------------
// Caratteri: misurati nella pagina, incorporati nell'SVG.
// ---------------------------------------------------------------------------

const fontData = new Map<DiagramFont, Promise<string | null>>();

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/// Il carattere dello stile in base64, letto una volta. `null` dove non ci sono
/// caratteri da caricare (i test) o se il file non arriva: l'SVG ricade allora
/// sui caratteri di sistema della pila.
function embeddedFont(font: DiagramFont): Promise<string | null> {
  if (typeof document.fonts?.load !== "function" || typeof fetch !== "function") return Promise.resolve(null);
  let pending = fontData.get(font);
  if (!pending) {
    pending = fetch(DIAGRAM_FONTS[font].file)
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
      .then((buffer) => base64Of(new Uint8Array(buffer)))
      .catch(() => {
        fontData.delete(font);
        return null;
      });
    fontData.set(font, pending);
  }
  return pending;
}

/// Mermaid misura le etichette nella pagina: il carattere deve esserci già,
/// o le misure sarebbero quelle del ripiego e le etichette uscirebbero.
async function fontReady(font: DiagramFont): Promise<void> {
  const { size, stack } = DIAGRAM_FONTS[font];
  try {
    await document.fonts?.load?.(`${size}px ${stack}`);
    await document.fonts?.load?.(`600 ${size}px ${stack}`);
  } catch {
    // Misurare col ripiego è peggio, non un errore.
  }
}

// ---------------------------------------------------------------------------
// La cache delle rese: un widget ricostruito, o un secondo diagramma uguale,
// non ridisegna.
// ---------------------------------------------------------------------------

interface Rendered {
  readonly svg: string;
  readonly links: ReadonlyArray<{ href: string; label: string }>;
  readonly description: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly background: string;
}

const CACHE_LIMIT = 64;
const cache = new Map<string, Rendered>();

function cached(key: string): Rendered | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function remember(key: string, rendered: Rendered): void {
  cache.delete(key);
  cache.set(key, rendered);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/// Svuota la cache: per i test, che rendono lo stesso sorgente con esiti finti
/// diversi.
export function forgetMermaidRenders(): void {
  cache.clear();
}

function boxOf(svg: Document): { width: number; height: number } | null {
  const box = (svg.documentElement.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !(box[2]! > 0) || !(box[3]! > 0)) return null;
  return { width: box[2]!, height: box[3]! };
}

// ---------------------------------------------------------------------------
// Esportare.
// ---------------------------------------------------------------------------

/// Il tipo del diagramma, per il nome del file: la prima parola che non è un
/// commento.
function diagramKind(source: string): string {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%") || trimmed === "---") continue;
    const word = /^[A-Za-z][\w-]*/.exec(trimmed)?.[0];
    return word ? word.toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  }
  return "";
}

function exportName(source: string, extension: string): string {
  const kind = diagramKind(source);
  return `${t("mermaid.export.name")}${kind ? `-${kind}` : ""}.${extension}`;
}

/// L'SVG con una misura sua, per chi lo apre fuori da Fub.
function standaloneSvg(rendered: Rendered): string {
  if (rendered.width === null || rendered.height === null) return rendered.svg;
  const doc = new DOMParser().parseFromString(rendered.svg, "image/svg+xml");
  doc.documentElement.setAttribute("width", String(Math.ceil(rendered.width)));
  doc.documentElement.setAttribute("height", String(Math.ceil(rendered.height)));
  return new XMLSerializer().serializeToString(doc);
}

/// Il PNG a doppia densità, sul fondo del diagramma: fuori da Fub la
/// trasparenza di Armonia diventerebbe il bianco o il nero di chi lo apre.
async function pngOf(rendered: Rendered): Promise<Uint8Array> {
  if (rendered.width === null || rendered.height === null) throw new Error(t("mermaid.export.no_size"));
  const width = Math.ceil(rendered.width * 2);
  const height = Math.ceil(rendered.height * 2);
  const url = URL.createObjectURL(new Blob([standaloneSvg(rendered)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("mermaid.export.no_canvas"));
    context.fillStyle = rendered.background;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(t("mermaid.export.no_canvas"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveExport(name: string, type: string, bytes: Uint8Array): Promise<void> {
  const outcome = await api.saveArtifact(name, type, Array.from(bytes));
  if (outcome.status === "saved") notify(t("mermaid.export.saved", { path: outcome.path }));
}

function exportFailed(error: unknown): void {
  notify(t("mermaid.export.failed", { reason: errorText(error) }), "guasto");
}

/// Sceglie lo stile di tutti i diagrammi. La preferenza cambia subito; il
/// valore scritto torna comunque dal tema quando l'impostazione è salvata.
async function chooseStyle(style: DiagramStyleId): Promise<void> {
  const before = diagramStylePreference();
  setDiagramStylePreference(style);
  try {
    await api.setSetting(DIAGRAM_STYLE_SETTING, style);
  } catch (error) {
    setDiagramStylePreference(before);
    notify(t("mermaid.style.failed", { reason: errorText(error) }), "guasto");
  }
}

function openMenu(trigger: HTMLButtonElement, items: MenuItem[]): void {
  trigger.setAttribute("aria-expanded", "true");
  showContextMenu(trigger, items, {
    onClose: () => trigger.setAttribute("aria-expanded", "false"),
  });
}

function swatchStrip(className: string, colors: readonly string[]): HTMLSpanElement {
  const strip = document.createElement("span");
  strip.className = className;
  strip.setAttribute("aria-hidden", "true");
  for (const color of colors) {
    const swatch = document.createElement("span");
    swatch.style.background = color;
    strip.append(swatch);
  }
  return strip;
}

export interface MermaidView {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface MermaidViewOptions {
  revealSource?: () => void;
  onResize?: () => void;
  /// La luce del diagramma, invece di quella del tema: la stampa è chiara.
  appearance?: DiagramLight;
  /// Scrive nel sorgente la modifica che dà (o toglie) lo stile a questo
  /// diagramma soltanto. C'è dove il sorgente si può modificare (Live).
  editSource?: (edit: SourceEdit) => void;
}

/** A diagram is an image, never active SVG/HTML in the shell. The source is
 * always available, including syntax errors and unavailable lazy chunks. */
export function createMermaidView(source: string, options: MermaidViewOptions = {}): MermaidView {
  const life = openLifetime();
  const element = document.createElement("figure");
  element.className = "mermaid-diagram";
  element.contentEditable = "false";
  const caption = document.createElement("figcaption");
  const name = document.createElement("span");
  name.textContent = "Mermaid";
  const bar = document.createElement("span");
  bar.className = "mermaid-bar";
  const action = (): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-action";
    return button;
  };
  const styleButton = action();
  styleButton.setAttribute("aria-haspopup", "menu");
  styleButton.setAttribute("aria-expanded", "false");
  const styleName = document.createElement("span");
  const exportButton = action();
  exportButton.setAttribute("aria-haspopup", "menu");
  exportButton.setAttribute("aria-expanded", "false");
  exportButton.hidden = true;
  const fullButton = action();
  fullButton.hidden = true;
  bar.append(styleButton, exportButton, fullButton);
  const reveal = options.revealSource ? action() : null;
  if (reveal) {
    life.listen(reveal, "click", () => options.revealSource?.());
    bar.append(reveal);
  }
  caption.append(name, bar);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const image = document.createElement("img");
  const linkList = document.createElement("nav");
  linkList.hidden = true;
  const linkItems = document.createElement("ul");
  linkList.append(linkItems);
  image.hidden = true;
  image.decoding = "async";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");
  pre.tabIndex = 0;
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  details.append(summary, pre);
  element.append(caption, status, image, linkList, details);

  let generation = 0;
  let url: string | undefined;
  let phase: "loading" | "ready" | "error" = "loading";
  let reason = "";
  let accessibleDescription = "";
  let look = lookOf(source, options.appearance);
  let shown: Rendered | null = null;
  const labels = () => {
    element.setAttribute("aria-label", t("mermaid.diagram"));
    linkList.setAttribute("aria-label", t("mermaid.links"));
    image.alt = accessibleDescription || t("mermaid.diagram");
    summary.textContent = t("mermaid.source");
    pre.setAttribute("aria-label", t("mermaid.source"));
    if (reveal) reveal.textContent = t("mermaid.edit");
    const styleLabel = t(`mermaid.style.${look.style}`);
    styleName.textContent = styleLabel;
    styleButton.replaceChildren(
      swatchStrip("mermaid-swatches", swatchesOf(paletteFor(look.style, look.light, look.contrast, look.read)).slice(1, 4)),
      styleName,
    );
    styleButton.setAttribute("aria-label", t(look.own ? "mermaid.style.button_own" : "mermaid.style.button", { name: styleLabel }));
    exportButton.textContent = t("mermaid.export");
    exportButton.hidden = phase !== "ready";
    fullButton.textContent = t("mermaid.fullscreen");
    fullButton.hidden = phase !== "ready";
    status.textContent = phase === "error" ? t("mermaid.error", { reason }) : t("mermaid.loading");
    status.hidden = phase === "ready";
    element.dataset.state = phase;
    element.dataset.diagramStyle = look.style;
    element.setAttribute("aria-busy", String(phase === "loading"));
  };
  const fail = (error: unknown) => {
    phase = "error";
    shown = null;
    reason = error instanceof Error ? error.message : String(error);
    reason = reason.slice(0, 1200);
    linkItems.replaceChildren();
    linkList.hidden = true;
    image.hidden = true;
    details.open = true;
    labels();
    options.onResize?.();
  };
  const resize = () => options.onResize?.();
  // Il diagramma a tutta finestra, con lo zoom: dal bottone o dall'immagine.
  const enlarge = () => {
    const rendered = shown;
    if (!rendered) return;
    openLightbox({
      source: svgSource(rendered.svg),
      label: accessibleDescription || t("mermaid.diagram"),
      caption: `Mermaid · ${diagramKind(source)}`,
      size: rendered.width !== null && rendered.height !== null
        ? { width: rendered.width, height: rendered.height }
        : null,
      background: rendered.background,
      vector: true,
    });
  };
  life.listen(fullButton, "click", enlarge);
  life.listen(image, "click", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    enlarge();
  });
  life.listen(details, "toggle", resize);
  life.listen(image, "load", resize);
  life.listen(image, "error", () => fail(new Error(t("mermaid.image_failed"))));
  life.add(onLanguage(labels));
  life.add(() => {
    generation++;
    linkItems.replaceChildren();
    linkList.hidden = true;
    if (url) URL.revokeObjectURL(url);
    image.removeAttribute("src");
  });

  const show = (rendered: Rendered) => {
    accessibleDescription = rendered.description;
    const items = rendered.links.map(({ href, label }) => {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      anchor.textContent = label;
      if (external(href)) {
        anchor.rel = "noopener noreferrer";
        anchor.target = "_blank";
      }
      item.append(anchor);
      return item;
    });
    // Ogni vista ha il suo URL, anche quando la resa viene dalla cache: così
    // lo revoca da sola, senza contare chi altro lo mostra.
    const nextUrl = URL.createObjectURL(new Blob([rendered.svg], { type: "image/svg+xml" }));
    if (url) URL.revokeObjectURL(url);
    url = nextUrl;
    image.src = nextUrl;
    // Un SVG servito come immagine con `width="100%"` non ha una larghezza
    // propria, e un diagramma di due nodi si allargava a tutto il riquadro.
    // La larghezza naturale è quella che mermaid dichiara; `max-width: 100%`
    // del tema continua a stringere i diagrammi grandi.
    if (rendered.width !== null) image.width = Math.ceil(rendered.width);
    else image.removeAttribute("width");
    linkItems.replaceChildren(...items);
    linkList.hidden = items.length === 0;
    image.hidden = false;
    shown = rendered;
    phase = "ready";
    labels();
    resize();
  };

  const render = () => {
    const request = ++generation;
    const current = () => !life.closed && request === generation;
    look = lookOf(source, options.appearance);
    const wanted = look;
    linkItems.replaceChildren();
    linkList.hidden = true;
    phase = "loading";
    labels();
    if (source.length > MAX_SOURCE_LENGTH) {
      fail(new Error(t("mermaid.too_large", { limit: MAX_SOURCE_LENGTH })));
      return;
    }
    const key = `${wanted.key}\n${source}`;
    const hit = cached(key);
    if (hit) {
      show(hit);
      return;
    }
    const task = rendering.then(async () => {
      if (!current()) return;
      const [{ default: mermaid }, { decorateSvg, fontFaceCss, mermaidStyleConfig }] = await Promise.all([
        library ??= import("mermaid").catch((error) => {
          library = undefined;
          throw error;
        }),
        drawing ??= import("./mermaid-drawing").catch((error) => {
          drawing = undefined;
          throw error;
        }),
      ]);
      if (!current()) return;
      const palette = paletteFor(wanted.style, wanted.light, wanted.contrast, wanted.read);
      const [font] = await Promise.all([embeddedFont(palette.font), fontReady(palette.font)]);
      if (!current()) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: MAX_SOURCE_LENGTH,
        maxEdges: 500,
        htmlLabels: false,
        ...mermaidStyleConfig(wanted.style, palette),
        // A note cannot relax the security policy or inject a global stylesheet.
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges",
          "suppressErrorRendering", "htmlLabels", "dompurifyConfig", "themeCSS", "themeVariables", "theme", "fontFamily"],
        dompurifyConfig: { FORBID_TAGS: ["style", "script", "iframe", "object", "img", "image"] },
      });
      const staging = document.createElement("div");
      staging.setAttribute("aria-hidden", "true");
      // SVG measurement needs layout, not display:none. This temporary root is
      // owned by the queued render and removed on success, failure, or teardown.
      staging.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:1200px";
      document.body.append(staging);
      try {
        const result = await mermaid.render(identifier("fub-mermaid"), source, staging);
        const svgDocument = new DOMParser().parseFromString(result.svg, "image/svg+xml");
        const description = Array.from(svgDocument.querySelectorAll("title, desc"))
          .map((node) => node.textContent?.trim()).filter(Boolean).join(". ");
        const links = diagramLinks(svgDocument);
        // Carta, carattere ed etichette delle fette entrano nell'SVG prima che
        // diventi un'immagine: dopo, niente della pagina lo raggiunge più.
        const isSvg = svgDocument.documentElement.localName === "svg";
        const widened = isSvg ? decorateSvg(svgDocument, palette, font ? fontFaceCss(palette.font, font) : null) : null;
        const width = widened ?? naturalWidth(svgDocument);
        const box = boxOf(svgDocument);
        const rendered: Rendered = {
          svg: isSvg ? new XMLSerializer().serializeToString(svgDocument) : result.svg,
          links,
          description,
          width,
          height: box && width !== null ? (box.height * width) / box.width : null,
          background: palette.paper ?? palette.ground,
        };
        // La resa vale anche se nel frattempo la vista è cambiata: un altro
        // diagramma uguale, o questo al ritorno, la ritrova.
        remember(key, rendered);
        if (!current()) return;
        show(rendered);
      } finally {
        staging.remove();
      }
    });
    // Failure of one diagram never poisons the queue for the rest of the note.
    rendering = task.catch((error) => { if (current()) fail(error); });
  };

  /// Ridisegna soltanto se l'aspetto è davvero cambiato: tema, contrasto,
  /// accento, stile scelto.
  const refresh = () => {
    if (lookOf(source, options.appearance).key === look.key && phase !== "error") return;
    render();
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
  life.add(() => observer.disconnect());
  life.add(onDiagramStyleChange(refresh));
  life.add(on("theme", refresh));

  const styleItems = (): MenuItem[] => {
    const own = styleDirective(source);
    const editable = options.editSource !== undefined;
    const items: MenuItem[] = DIAGRAM_STYLE_IDS.map((style) => ({
      label: t(`mermaid.style.${style}`),
      description: t(`mermaid.style.${style}.desc`),
      swatches: swatchesOf(paletteFor(style, look.light, look.contrast, style === "armonia" ? look.read : undefined)),
      choice: "radio" as const,
      checked: style === look.style,
      selected: style === look.style,
      run: () => {
        // Con uno stile suo, e il sorgente a portata di mano, la scelta resta
        // a questo diagramma; altrimenti è la preferenza di tutti.
        if (look.own && editable) {
          const edit = styleDirectiveEdit(source, style);
          if (edit) options.editSource?.(edit);
        } else {
          void chooseStyle(style);
        }
      },
    }));
    if (editable) {
      items.push({
        label: t("mermaid.style.only_here"),
        description: t(look.own ? "mermaid.style.only_here_on" : "mermaid.style.only_here_off"),
        choice: "checkbox",
        checked: look.own,
        separator: true,
        run: () => {
          const edit = styleDirectiveEdit(source, look.own ? null : look.style);
          if (edit) options.editSource?.(edit);
        },
      });
    } else if (own?.style) {
      items.unshift({
        label: t("mermaid.style.fixed", { name: t(`mermaid.style.${own.style}`) }),
        disabled: true,
        run: () => {},
      });
    }
    return items;
  };
  life.listen(styleButton, "click", () => openMenu(styleButton, styleItems()));

  const exportItems = (): MenuItem[] => {
    const rendered = shown;
    if (!rendered) return [];
    return [
      {
        label: t("mermaid.export.copy_svg"),
        run: () => void writeClipboardText(standaloneSvg(rendered))
          .then(() => notify(t("mermaid.export.copied")), exportFailed),
      },
      {
        label: t("mermaid.export.save_svg"),
        separator: true,
        run: () => void saveExport(exportName(source, "svg"), "image/svg+xml", new TextEncoder().encode(standaloneSvg(rendered)))
          .catch(exportFailed),
      },
      {
        label: t("mermaid.export.save_png"),
        run: () => void pngOf(rendered)
          .then((bytes) => saveExport(exportName(source, "png"), "image/png", bytes))
          .catch(exportFailed),
      },
    ];
  };
  life.listen(exportButton, "click", () => openMenu(exportButton, exportItems()));

  render();
  return { element, destroy: () => life.close() };
}

/** The native provider uses the same viewer; other engines keep their fallback. */
export function registerMermaidRenderer(): void {
  registerCustomRenderer("fub:diagram", (host, payload) => {
    const { source } = payload as { source: string };
    const diagram = createMermaidView(source, {
      onResize: () => host.dispatchEvent(new Event("markdown-resize", { bubbles: true })),
    });
    host.append(diagram.element);
    return diagram.destroy;
  }, (payload) => typeof payload === "object" && payload !== null
    && "engine" in payload && payload.engine === "mermaid"
    && "source" in payload && typeof payload.source === "string");
}

export interface MermaidBlockOptions {
  revealSource?: (sourceOffset: number) => void;
  /// Modifica il corpo del recinto che comincia a `fenceOffset`: `body` è il
  /// testo che il diagramma ha letto, perché chi scrive verifichi che sia ancora
  /// quello; `edit` è in offset di `body`.
  editFence?: (fenceOffset: number, body: string, edit: SourceEdit) => void;
  appearance?: DiagramLight;
}

/** Hydrates the same inert diagram component in Live, Reading and embeds. */
export function mountMermaidBlocks(container: HTMLElement, options: MermaidBlockOptions = {}): Teardown {
  const life = openLifetime();
  for (const code of container.querySelectorAll<HTMLElement>("pre > code")) {
    if (code.closest("[data-ui-slot]")) continue;
    if (!Array.from(code.classList).some((name) => name.toLowerCase() === "language-mermaid")) continue;
    const pre = code.parentElement!;
    // Only a fence the vault declares is a diagram: with the diagrams syntax
    // off, a mermaid fence stays code, as it does in the model.
    if (!pre.hasAttribute("data-declared-fence")) continue;
    const rawFrom = pre.dataset.mdFrom;
    const from = rawFrom !== undefined && /^\d+$/.test(rawFrom) ? Number(rawFrom) : NaN;
    const body = code.textContent ?? "";
    // La posizione si rilegge al momento del gesto: in Live il widget la
    // aggiorna quando il testo sopra il recinto cambia.
    const offset = () => {
      const current = diagram.element.dataset.mdFrom;
      return current !== undefined && /^\d+$/.test(current) ? Number(current) : NaN;
    };
    const mapped = Number.isSafeInteger(from);
    const diagram: MermaidView = createMermaidView(body, {
      revealSource: options.revealSource && mapped
        ? () => {
          const at = offset();
          if (Number.isSafeInteger(at)) options.revealSource?.(at);
        }
        : undefined,
      editSource: options.editFence && mapped
        ? (edit) => {
          const at = offset();
          if (Number.isSafeInteger(at)) options.editFence?.(at, body, edit);
        }
        : undefined,
      appearance: options.appearance,
      onResize: () => container.dispatchEvent(new Event("markdown-resize", { bubbles: true })),
    });
    // Preserve the coordinate space of the renderer that produced the fence.
    for (const attribute of Array.from(pre.attributes)) {
      if (attribute.name === "id" || attribute.name.startsWith("data-fub-source-") ||
          attribute.name === "data-md-from" || attribute.name === "data-md-to") {
        diagram.element.setAttribute(attribute.name, attribute.value);
      }
    }
    pre.replaceWith(diagram.element);
    life.add(diagram.destroy);
  }
  return () => life.close();
}
