import type { Mermaid } from "mermaid";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";
import { fetchLocal } from "../editors/core/local-fetch";
import { onLanguage, t } from "../i18n/strings";
import { DURATION, prepareExit } from "../moto";
import type { PopoverHandle } from "../kit/popover";
import { clipboardSupports, writeClipboardData, writeClipboardText } from "../platform/clipboard";
import { on } from "../state/store";
import {
  DIAGRAM_STYLE_IDS,
  DIAGRAM_STYLE_SETTING,
  diagramStylePreference,
  frontmatterEnd,
  onDiagramStyleChange,
  ownDiagramStyle,
  setDiagramStylePreference,
  styleDirective,
  styleDirectiveEdit,
  type DiagramStyleId,
  type SourceEdit,
} from "../theme/diagram-style";
import { identifier } from "./a11y";
import { displayBinding } from "./commands";
import {
  openDiagramMenu,
  type DiagramDirection,
  type DiagramMenuModel,
  type DiagramScope,
  type DiagramSwatchColors,
} from "./diagram-menu";
import { openLightbox, svgSource } from "./lightbox";
import { openLifetime, type Teardown } from "./lifetime";
import { registerCustomRenderer } from "./custom";
import { closeContextMenu, showContextMenu, type MenuPoint } from "./menu";
import {
  DIAGRAM_FONTS,
  paletteFor,
  type DiagramContrast,
  type DiagramFont,
  type DiagramLight,
  type TokenReader,
} from "./mermaid-styles";
import { notify } from "./notify";
import { withPageNonce } from "./stylesheets";
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

/// Le note che il diagramma nomina, come in Obsidian: un nodo con la classe
/// `internal-link` (`class A internal-link`) è un link alla nota col suo testo.
/// Diventano wikilink nell'elenco dei link, mai nodi SVG nella shell.
function diagramNotes(svg: Document): string[] {
  if (svg.documentElement.localName !== "svg" || svg.documentElement.namespaceURI !== SVG_NAMESPACE) return [];
  const notes: string[] = [];
  for (const node of svg.querySelectorAll("g")) {
    if (node.namespaceURI !== SVG_NAMESPACE || !node.classList.contains("internal-link")) continue;
    const label = Array.from(node.querySelectorAll("text"), (text) => text.textContent ?? "")
      .join(" ").replace(/\s+/gu, " ").trim();
    if (label && !notes.includes(label)) notes.push(label);
  }
  return notes;
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
  "--doc-bg", "--doc-fg", "--muted", "--accent", "--warning",
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
    // Armonia sta sulla pagina senza fondo (E26): il suo fondo è la pagina.
    const ground = paintedHex(context, [paper]);
    if (!ground) return values;
    values.set("ground", ground);
    for (const name of THEME_TOKENS.slice(1)) {
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

/// L'aspetto del diagramma: `preview`, lo stile in anteprima dal menu, vince
/// su quello scritto e sulla preferenza finché dura.
function lookOf(source: string, appearance: DiagramLight | undefined, preview: DiagramStyleId | null = null): Look {
  const own = ownDiagramStyle(source);
  const style = preview ?? own ?? diagramStylePreference();
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
    pending = fetchLocal(DIAGRAM_FONTS[font].file)
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
  readonly notes: readonly string[];
  readonly description: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly background: string;
  /// Il disegno per la vista: lo stesso senza la carta, che la tavola sotto
  /// l'immagine dipinge da sé (E26) per tutta la larghezza della colonna.
  /// Lo schermo intero, gli appunti e l'esportazione usano `svg`, con la carta.
  readonly view: string;
  /// La carta della tavola: `null` per Armonia, che sta sulla pagina.
  readonly board: { readonly paper: string; readonly texture: string; readonly tint: string } | null;
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

// ---------------------------------------------------------------------------
// Il sorgente che il menu legge e riscrive: il titolo, la direzione del flusso.
// ---------------------------------------------------------------------------

/// Il `title` del frontmatter di Mermaid, senza virgolette; `null` se non c'è.
export function diagramTitle(source: string): string | null {
  const end = frontmatterEnd(source);
  if (end === 0) return null;
  for (const line of source.slice(0, end).split("\n").slice(1, -1)) {
    const match = /^\s*title\s*:\s*(.*?)\s*$/.exec(line.replace(/\r$/, ""));
    if (!match) continue;
    const value = match[1]!.replace(/^(["'])(.*)\1$/, "$2").trim();
    return value || null;
  }
  return null;
}

/// La direzione di un diagramma di flusso, come la scrive Mermaid.
export type FlowDirectionWritten = "TD" | "TB" | "LR" | "RL" | "BT";

export interface FlowLine {
  /// La direzione scritta, o `null` se la riga non ne ha una (vale TB).
  readonly direction: FlowDirectionWritten | null;
  /// Dove sta la direzione nel sorgente; senza direzione, il punto dopo la
  /// parola `flowchart` o `graph`, dove si scrive.
  readonly from: number;
  readonly to: number;
}

const FLOW_LINE = /^([ \t]*(?:flowchart(?:-elk)?|graph))(?:([ \t]+)(TD|TB|LR|RL|BT))?(?=$|[\s;])/i;

/// La riga che apre un diagramma di flusso: la prima che non è vuota, un
/// commento o il frontmatter. `null` se il diagramma non è un flusso.
export function flowLine(source: string): FlowLine | null {
  let from = frontmatterEnd(source);
  while (from <= source.length) {
    const end = source.indexOf("\n", from);
    const to = end < 0 ? source.length : end;
    const line = source.slice(from, to).replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("%%")) {
      const match = FLOW_LINE.exec(line);
      if (!match) return null;
      const head = match[1]!.length;
      if (!match[3]) return { direction: null, from: from + head, to: from + head };
      const start = from + head + match[2]!.length;
      return { direction: match[3]!.toUpperCase() as FlowDirectionWritten, from: start, to: start + match[3]!.length };
    }
    if (end < 0) break;
    from = end + 1;
  }
  return null;
}

/// La modifica che dà al flusso la direzione `direction`: soltanto la parola
/// della direzione, il resto della riga resta com'è. `null` se il diagramma
/// non è un flusso o va già in quella direzione.
export function flowDirectionEdit(source: string, direction: DiagramDirection): SourceEdit | null {
  const line = flowLine(source);
  if (!line) return null;
  const now = line.direction === "TB" || line.direction === null ? "TD" : line.direction;
  if (now === direction && line.direction !== null) return null;
  if (line.direction === null) return direction === "TD" ? null : { from: line.from, to: line.to, insert: ` ${direction}` };
  return { from: line.from, to: line.to, insert: direction };
}

// ---------------------------------------------------------------------------
// Il menu del tasto destro, come dati.
// ---------------------------------------------------------------------------

export interface DiagramMenuInput {
  readonly source: string;
  /// Lo stile che il diagramma mostra adesso (senza anteprima).
  readonly style: DiagramStyleId;
  readonly light: DiagramLight;
  readonly contrast: DiagramContrast;
  readonly read: TokenReader;
  /// Il sorgente si può riscrivere: c'è chi scrive e la nota non è in sola lettura.
  readonly editable: boolean;
  /// C'è chi apre il sorgente (Scrittura).
  readonly revealable: boolean;
  /// Il disegno c'è: ingrandire, copiare ed esportare hanno qualcosa.
  readonly ready: boolean;
}

/// I colori della miniatura di uno stile, presi dalla tavolozza che lo disegna.
function swatchColors(style: DiagramStyleId, input: DiagramMenuInput): DiagramSwatchColors {
  const palette = paletteFor(style, input.light, input.contrast, style === "armonia" ? input.read : undefined);
  return {
    paper: palette.paper ?? palette.ground,
    node: palette.primary.fill,
    nodeBorder: palette.primary.border,
    choice: palette.secondary.fill,
    choiceBorder: palette.secondary.border,
    pill: palette.tertiary.fill,
    pillBorder: palette.tertiary.border,
    line: palette.line,
  };
}

/// Che cosa offre il tasto destro su un diagramma (E26).
export function diagramMenuModel(input: DiagramMenuInput): DiagramMenuModel {
  const written = styleDirective(input.source);
  const own = written?.style ?? null;
  const unknown = written && !own ? written.name : null;
  const flow = flowLine(input.source);
  const current: DiagramDirection | null = !flow ? null
    : flow.direction === "LR" ? "LR"
      : flow.direction === null || flow.direction === "TD" || flow.direction === "TB" ? "TD"
        : null;
  let notice: string | null = null;
  if (unknown !== null) {
    notice = t(unknown ? "mermaid.menu.unknown" : "mermaid.menu.unknown_empty", { name: unknown, style: t(`mermaid.style.${input.style}`) });
  } else if (own && !input.editable) {
    notice = t("mermaid.style.fixed", { name: t(`mermaid.style.${own}`) });
  }
  return {
    kind: t("mermaid.menu.kind"),
    title: diagramTitle(input.source),
    styleLabel: t("mermaid.menu.style"),
    styles: DIAGRAM_STYLE_IDS.map((id) => ({
      id,
      label: t(`mermaid.style.${id}`),
      colors: swatchColors(id, input),
      checked: id === input.style,
    })),
    notice,
    scopeLabel: t("mermaid.menu.scope"),
    scopes: [
      { id: "this", label: t("mermaid.menu.scope.this"), disabled: !input.editable },
      { id: "all", label: t("mermaid.menu.scope.all"), disabled: false },
    ],
    // Parte da «Questo» quando il diagramma ha già uno stile suo, scritto.
    scope: own !== null && input.editable ? "this" : "all",
    orientation: flow === null ? null : {
      label: t("mermaid.menu.orientation"),
      options: [
        { id: "TD", label: t("mermaid.menu.orientation.down"), icon: "diagram-down" },
        { id: "LR", label: t("mermaid.menu.orientation.right"), icon: "diagram-right" },
      ],
      current,
      disabled: !input.editable,
    },
    actions: [
      ...(input.revealable ? [{ id: "source" as const, label: t("mermaid.menu.source"), icon: "code", hint: displayBinding("Enter"), disabled: false }] : []),
      { id: "enlarge", label: t("mermaid.menu.enlarge"), icon: "diagram-enlarge", hint: displayBinding("Space"), disabled: !input.ready },
      { id: "copy", label: t("mermaid.menu.copy"), icon: "copy", hint: displayBinding("Mod-c"), disabled: !input.ready },
      { id: "export", label: t("mermaid.menu.export"), icon: "diagram-export", note: t("mermaid.menu.export.note"), disabled: !input.ready },
    ],
  };
}

/// Il testo che negli appunti accompagna l'immagine: il recinto intero, così
/// incollato in una nota torna un diagramma.
export function diagramFence(source: string): string {
  const longest = Math.max(2, ...Array.from(source.matchAll(/`{3,}/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}mermaid\n${source.replace(/\n$/, "")}\n${fence}`;
}

/// Una voce scritta nel diagramma lo dice una volta per sessione: poi si sa.
let toldWritten = false;

export interface MermaidView {
  readonly element: HTMLElement;
  /// Apre il menu del diagramma nel punto `at`. `pointer`: aperto dal puntatore.
  menu(at: MenuPoint, pointer: boolean): void;
  /// Il diagramma a tutta finestra; `false` se non c'è ancora un disegno.
  enlarge(): boolean;
  /// L'immagine, l'SVG e il sorgente negli appunti, insieme.
  copy(): Promise<void>;
  destroy(): void;
}

export interface MermaidViewOptions {
  /// Apre il sorgente del diagramma, dove lo si scrive (Scrittura).
  revealSource?: () => void;
  onResize?: () => void;
  /// La luce del diagramma, invece di quella del tema: la stampa è chiara.
  appearance?: DiagramLight;
  /// Scrive nel sorgente una modifica del corpo: lo stile di questo diagramma,
  /// la direzione del flusso. C'è dove il sorgente si può modificare.
  editSource?: (edit: SourceEdit) => void;
  /// Mostra le note dei nodi `internal-link` come wikilink: soltanto dove chi
  /// monta la resa li apre (Live e Lettura), non in una vista dichiarativa.
  noteLinks?: boolean;
}

/** A diagram is an image, never active SVG/HTML in the shell. The source is
 * always available, including syntax errors and unavailable lazy chunks.
 *
 * A riposo e al passaggio c'è soltanto il disegno (E26): niente barra, niente
 * pulsanti. Le azioni stanno nel menu del tasto destro (`menu`) e nei tasti
 * del blocco scelto, che chiamano `enlarge` e `copy`. */
export function createMermaidView(source: string, options: MermaidViewOptions = {}): MermaidView {
  const life = openLifetime();
  const element = document.createElement("figure");
  element.className = "mermaid-diagram";
  element.contentEditable = "false";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  // Il disegno: l'immagine, e sopra, per il tempo di una dissolvenza,
  // l'immagine di prima.
  const stage = document.createElement("div");
  stage.className = "mermaid-diagram-view";
  const image = document.createElement("img");
  stage.append(image);
  const linkList = document.createElement("nav");
  linkList.hidden = true;
  const linkItems = document.createElement("ul");
  linkList.append(linkItems);
  image.hidden = true;
  image.decoding = "async";
  // Il sorgente si vede soltanto quando il disegno non c'è: un errore, un
  // diagramma troppo grande. Col disegno sta nella nota, e il menu lo apre.
  const details = document.createElement("details");
  details.hidden = true;
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");
  pre.tabIndex = 0;
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  details.append(summary, pre);
  element.append(status, stage, linkList, details);

  let generation = 0;
  let url: string | undefined;
  let phase: "loading" | "ready" | "error" = "loading";
  let reason = "";
  let accessibleDescription = "";
  /// Lo stile in anteprima dal menu, finché il puntatore ci sta sopra.
  let preview: DiagramStyleId | null = null;
  let look = lookOf(source, options.appearance, preview);
  let shown: Rendered | null = null;
  const labels = () => {
    element.setAttribute("aria-label", t("mermaid.diagram"));
    linkList.setAttribute("aria-label", t("mermaid.links"));
    image.alt = accessibleDescription || t("mermaid.diagram");
    summary.textContent = t("mermaid.source");
    pre.setAttribute("aria-label", t("mermaid.source"));
    status.textContent = phase === "error" ? t("mermaid.error", { reason }) : t("mermaid.loading");
    status.hidden = phase === "ready";
    details.hidden = phase !== "error";
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
  // Il diagramma a tutta finestra, con lo zoom: dal menu, da Spazio o dal clic.
  const enlarge = (): boolean => {
    const rendered = shown;
    if (!rendered) return false;
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
    return true;
  };
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
    // Un wikilink come quelli del testo: lo apre chi monta la resa.
    for (const page of options.noteLinks ? rendered.notes : []) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.className = "wikilink";
      anchor.setAttribute("href", "#");
      anchor.dataset.wikilinkPage = page;
      anchor.textContent = page;
      item.append(anchor);
      items.push(item);
    }
    // Un altro stile sullo stesso diagramma: i colori sfumano dai vecchi ai
    // nuovi (220 ms), invece di scattare. Col moto ridotto, niente.
    if (shown !== null && shown !== rendered && !image.hidden && image.isConnected) {
      prepareExit(image).play({ to: { opacity: 0 }, duration: DURATION.short, easing: "ease-out" });
    }
    // Ogni vista ha il suo URL, anche quando la resa viene dalla cache: così
    // lo revoca da sola, senza contare chi altro lo mostra.
    const nextUrl = URL.createObjectURL(new Blob([rendered.view], { type: "image/svg+xml" }));
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
    // La tavola prende la carta dello stile; Armonia non ne ha, e sta sulla pagina.
    if (rendered.board) {
      element.style.setProperty("--diagram-paper", rendered.board.paper);
      element.style.setProperty("--diagram-paper-tint", rendered.board.tint);
      element.dataset.diagramTexture = rendered.board.texture;
    } else {
      element.style.removeProperty("--diagram-paper");
      element.style.removeProperty("--diagram-paper-tint");
      delete element.dataset.diagramTexture;
    }
    shown = rendered;
    phase = "ready";
    labels();
    resize();
  };

  /// `soft`: un'anteprima dal menu, che non spegne il disegno che c'è: resta,
  /// coi suoi link, finché arriva l'altro.
  const render = (soft = false) => {
    const request = ++generation;
    const current = () => !life.closed && request === generation;
    look = lookOf(source, options.appearance, preview);
    const wanted = look;
    if (!soft || shown === null) {
      linkItems.replaceChildren();
      linkList.hidden = true;
      phase = "loading";
    }
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
        // Mermaid misura le etichette col foglio che mette in un `<style>`:
        // con il nonce della pagina la CSP lo lascia valere.
        const result = await withPageNonce(() => mermaid.render(identifier("fub-mermaid"), source, staging));
        const svgDocument = new DOMParser().parseFromString(result.svg, "image/svg+xml");
        const description = Array.from(svgDocument.querySelectorAll("title, desc"))
          .map((node) => node.textContent?.trim()).filter(Boolean).join(". ");
        const links = diagramLinks(svgDocument);
        const notes = diagramNotes(svgDocument);
        // Carta, carattere ed etichette delle fette entrano nell'SVG prima che
        // diventi un'immagine: dopo, niente della pagina lo raggiunge più.
        const isSvg = svgDocument.documentElement.localName === "svg";
        const widened = isSvg ? decorateSvg(svgDocument, palette, font ? fontFaceCss(palette.font, font) : null) : null;
        const width = widened ?? naturalWidth(svgDocument);
        const box = boxOf(svgDocument);
        const svg = isSvg ? new XMLSerializer().serializeToString(svgDocument) : result.svg;
        // La vista senza il foglio della carta: la tavola lo dipinge sotto.
        const paperSheet = isSvg ? svgDocument.querySelector("rect.fub-paper") : null;
        paperSheet?.remove();
        const view = paperSheet ? new XMLSerializer().serializeToString(svgDocument) : svg;
        const rendered: Rendered = {
          svg,
          view,
          links,
          notes,
          description,
          width,
          height: box && width !== null ? (box.height * width) / box.width : null,
          background: palette.paper ?? palette.ground,
          board: palette.paper === null ? null : {
            paper: palette.paper,
            texture: palette.texture,
            tint: palette.texture2 ?? palette.paper,
          },
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
  /// accento, stile scelto o in anteprima.
  const refresh = () => {
    if (lookOf(source, options.appearance, preview).key === look.key && phase !== "error") return;
    render();
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
  life.add(() => observer.disconnect());
  life.add(onDiagramStyleChange(refresh));
  life.add(on("theme", refresh));

  // ── Il menu del tasto destro ────────────────────────────────────────────
  let menu: PopoverHandle | null = null;
  life.add(() => menu?.close("lifetime"));

  const copy = async (): Promise<void> => {
    const rendered = shown;
    if (!rendered) return;
    const text = diagramFence(source);
    try {
      if (clipboardSupports("image/png")) {
        // Le promesse dei byte entrano subito negli appunti, dentro il gesto:
        // alcuni motori non lasciano scrivere dopo.
        const png = pngOf(rendered).then((bytes) => new Blob([bytes as BlobPart], { type: "image/png" }));
        png.catch(() => undefined);
        await writeClipboardData({
          "image/png": png,
          ...(clipboardSupports("image/svg+xml") ? { "image/svg+xml": new Blob([standaloneSvg(rendered)], { type: "image/svg+xml" }) } : {}),
          "text/plain": new Blob([text], { type: "text/plain" }),
        });
        notify(t("mermaid.copy.done"), "info");
      } else {
        await writeClipboardText(text);
        notify(t("mermaid.copy.text_only"), "info");
      }
    } catch (error) {
      notify(t("mermaid.copy.failed", { reason: errorText(error) }), "guasto");
    }
  };

  const exportMenu = (at: MenuPoint): void => {
    const rendered = shown;
    if (!rendered) return;
    showContextMenu(at, [
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
    ], { header: { icon: "diagram-mark", kind: t("mermaid.menu.kind"), ...(diagramTitle(source) ? { name: diagramTitle(source)! } : {}) } });
  };

  const setPreview = (style: DiagramStyleId | null): void => {
    const next = style === lookOf(source, options.appearance, null).style ? null : style;
    if (next === preview) return;
    preview = next;
    if (lookOf(source, options.appearance, preview).key !== look.key || phase === "error") render(true);
  };

  const choose = (style: DiagramStyleId, scope: DiagramScope): void => {
    preview = null;
    if (scope === "this" && options.editSource) {
      const edit = styleDirectiveEdit(source, style);
      if (edit) {
        options.editSource(edit);
        if (!toldWritten) {
          toldWritten = true;
          notify(t("mermaid.style.written", { name: style }), "info");
        }
      } else {
        refresh();
      }
      return;
    }
    // Per tutti: la preferenza, e via la scelta scritta in questo diagramma.
    const own = styleDirective(source);
    if (own && options.editSource) {
      const edit = styleDirectiveEdit(source, null);
      if (edit) options.editSource(edit);
    }
    void chooseStyle(style);
    refresh();
    notify(t("mermaid.style.for_all", { name: t(`mermaid.style.${style}`) }), "info");
  };

  const openMenu = (at: MenuPoint, pointer: boolean): void => {
    menu?.close("manual");
    closeContextMenu();
    const base = lookOf(source, options.appearance, null);
    const model = diagramMenuModel({
      source,
      style: base.style,
      light: base.light,
      contrast: base.contrast,
      read: base.read,
      editable: options.editSource !== undefined,
      revealable: options.revealSource !== undefined,
      ready: shown !== null,
    });
    menu = openDiagramMenu(at, model, {
      preview: setPreview,
      choose,
      orient: (direction) => {
        const edit = flowDirectionEdit(source, direction);
        if (edit) options.editSource?.(edit);
      },
      act: (action, point) => {
        if (action === "source") options.revealSource?.();
        else if (action === "enlarge") enlarge();
        else if (action === "copy") void copy();
        else exportMenu(point);
      },
    }, {
      pointer,
      onClose: () => { menu = null; },
    });
  };

  life.listen(element, "contextmenu", (event: MouseEvent) => {
    // Un menu già preso più dentro vince; un link del diagramma e il sorgente
    // hanno quello di sempre; Maiusc lascia il menu del sistema, come nel
    // resto della nota.
    if (event.defaultPrevented || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest("a, pre, summary")) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, !fromKeyboard(event));
  });

  render();
  return {
    element,
    menu: openMenu,
    enlarge,
    copy,
    destroy: () => life.close(),
  };
}

/// Un `contextmenu` nato dal mouse e non dalla tastiera (il tasto Menu,
/// Maiusc+F10), che ha un punto vero.
function fromKeyboard(event: MouseEvent): boolean {
  return event.button !== 2 || (event.clientX === 0 && event.clientY === 0);
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
      noteLinks: true,
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
