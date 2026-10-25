// La striscia del carattere della superficie ricca: tipo e dimensione del
// carattere, colori, sottolineato, apice e pedice, maiuscole, «Copia formato»;
// e del paragrafo: stile, allineamento, rientri, interlinea e spaziature;
// ciò che si inserisce: link, tabelle, immagini, note e salti di pagina e di
// colonna; la revisione: trova e sostituisci, il conteggio delle parole.
//
// La barra di formattazione della shell porta gesti che commutano, dichiarati
// dai plugin per id; un carattere o un colore sono valori, e la loro scelta è
// della superficie che li sa scrivere. Questa striscia sta sopra la pagina e
// si carica col motore. È una barra degli strumenti WAI-ARIA: un solo
// controllo nel Tab, le frecce fra gli altri, Esc torna al testo. Il puntatore
// non prende il fuoco ai pulsanti, così la selezione del testo resta dov'è.
import type { Command } from "prosemirror-state";
import { labelButton, openPopover, setPressed, textButton, textField, type ButtonKind, type PopoverHandle } from "../../kit";
import { identifier } from "../../ui/a11y";
import { ariaBinding, displayBinding } from "../../ui/commands";
import { openLifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { errorText } from "../../host/errors";
import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import {
  FONT_SIZES,
  insertImage,
  insertNote,
  insertTable,
  LINE_SPACINGS,
  linkAt,
  selectedLayout,
  selectedStyle,
  setColor,
  setFont,
  setHighlight,
  setLayout,
  setLineSpacing,
  setLink,
  setSize,
  setStyle,
  type StylePick,
  COMMENT_ACTION,
  FIND_ACTION,
  LINK_ACTION,
} from "./commands";
import { addComment, anchorsOf, canComment, commentsOf, deleteComment, goToComment, replyComment, resolveComment } from "./comments";
import type { RichEngine } from "./engine";
import { COLOR_AUTO, HIGHLIGHT_DEFAULT, LAYOUT_LENGTHS, PAGE_FIELDS, type LayoutLength } from "./projection";
import { imageMime } from "./schema";
import { insertToc } from "./toc";
import {
  columns,
  FIELD_CODES,
  formatLength,
  landscape,
  MARGIN_PRESETS,
  pageAt,
  PAPER_SIZES,
  paperLabel,
  paperName,
  parseLength,
  runningOf,
  runningText,
  setColumns,
  setLandscape,
  setMargins,
  setPaper,
  setRunning,
} from "./page";
import { reviewAuthor, setReviewAuthor, setTracking } from "./track";
import { countText, findMatches, goToRevision, nextMatch, replaceAll, replaceMatch, type FindQuery, type TextCount } from "./review";

/// I gesti delle revisioni tracciate, con il loro segno.
const REVISION_BUTTONS: readonly { id: string; lines: readonly string[] }[] = [
  { id: "rich.rev.previous", lines: ["M15 6l-6 6 6 6"] },
  { id: "rich.rev.next", lines: ["M9 6l6 6-6 6"] },
  { id: "rich.rev.accept", lines: ["M5 12l5 5 9-10"] },
  { id: "rich.rev.reject", lines: ["M6 6l12 12", "M18 6 6 18"] },
  { id: "rich.rev.accept_all", lines: ["M2 12l5 5 9-10", "M12 16l1 1 9-10"] },
  { id: "rich.rev.reject_all", lines: ["M4 4h16v16H4z", "M8 8l8 8", "M16 8l-8 8"] },
];

/// Ciò che la striscia chiede alla shell.
export interface RichMedia {
  /// Un'immagine del vault scelta da chi scrive: i suoi byte, `null` se la
  /// scelta è annullata, `"unreadable"` se non si legge o pesa troppo.
  readonly pickImage?: () => Promise<Blob | "unreadable" | null>;
  /// Il formato scrive commenti nuovi e registra le modifiche.
  readonly review?: boolean;
}

/// I gruppi della striscia, nell'ordine in cui si vedono. `emphasis`
/// (grassetto, corsivo, sottolineato) c'è soltanto quando lo si chiede: nella
/// striscia intera quei gesti stanno nella barra di formattazione.
export type RichStripGroup = "type" | "emphasis" | "toggles" | "colors" | "tools" | "paragraph" | "insert" | "layout" | "review";

/// La mini-barra del menu, come la Mini Toolbar di Word: il carattere, la
/// dimensione, l'enfasi e «Copia formato». Senza i comandi che aprono un
/// modulo: il menu si chiude al primo gesto e lo porterebbe con sé.
export const RICH_MINI_GROUPS: readonly RichStripGroup[] = ["type", "emphasis", "tools"];

export interface RichStripOptions {
  /// Soltanto questi gruppi; senza, la striscia intera.
  readonly only?: readonly RichStripGroup[];
}

/// Il grassetto, il corsivo e il sottolineato della mini-barra.
const EMPHASES: readonly { id: string; label: Key; glyph: string; className: string }[] = [
  { id: "markdown.bold", label: "rich.bold", glyph: "B", className: "rich-strip-bold" },
  { id: "markdown.italic", label: "rich.italic", glyph: "I", className: "rich-strip-italic" },
  { id: "rich.underline", label: "rich.underline", glyph: "U", className: "rich-strip-underline" },
];

/// La colonna del testo di una pagina Letter con i margini di Word, in punti:
/// un'immagine nuova più grande si riduce a starci, come la riduce Word.
const TEXT_WIDTH_PT = 468;
const TEXT_HEIGHT_PT = 648;

/// La misura in punti di un'immagine di `width` × `height` pixel CSS, entro la
/// colonna del testo e senza deformarla.
export function fitImage(width: number, height: number): { w: number; h: number } | null {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  const w = width * 0.75;
  const h = height * 0.75;
  const scale = Math.min(1, TEXT_WIDTH_PT / w, TEXT_HEIGHT_PT / h);
  const round = (n: number) => Math.max(1, Math.round(n * 100) / 100);
  return { w: round(w * scale), h: round(h * scale) };
}

/// I byte in base64, a pezzi: `String.fromCharCode` non regge un'immagine
/// intera in una chiamata.
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/// Un'immagine pronta da inserire: i byte di un PNG, JPEG o GIF e la misura.
async function placedImage(blob: Blob): Promise<{ data: string; w: number; h: number } | null> {
  const data = base64(new Uint8Array(await blob.arrayBuffer()));
  if (imageMime(data) === null) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const size = fitImage(bitmap.width, bitmap.height);
  bitmap.close();
  return size && { data, ...size };
}

/// I caratteri proposti sempre, oltre a quelli del documento.
export const COMMON_FONTS: readonly string[] = [
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Liberation Sans",
  "Liberation Serif",
  "Times New Roman",
  "Verdana",
];

interface Swatch {
  readonly name: string;
  readonly hex: string;
}

/// I colori standard del testo di Word.
export const TEXT_COLORS: readonly Swatch[] = [
  { name: "black", hex: "#000000" },
  { name: "gray50", hex: "#808080" },
  { name: "dark_red", hex: "#c00000" },
  { name: "red", hex: "#ff0000" },
  { name: "orange", hex: "#ffc000" },
  { name: "yellow", hex: "#ffff00" },
  { name: "light_green", hex: "#92d050" },
  { name: "green", hex: "#00b050" },
  { name: "light_blue", hex: "#00b0f0" },
  { name: "blue", hex: "#0070c0" },
  { name: "dark_blue", hex: "#002060" },
  { name: "purple", hex: "#7030a0" },
];

/// Gli evidenziatori di Word: un `.docx` non ne scrive altri.
export const HIGHLIGHT_COLORS: readonly Swatch[] = [
  { name: "yellow", hex: HIGHLIGHT_DEFAULT },
  { name: "bright_green", hex: "#00ff00" },
  { name: "turquoise", hex: "#00ffff" },
  { name: "pink", hex: "#ff00ff" },
  { name: "blue", hex: "#0000ff" },
  { name: "red", hex: "#ff0000" },
  { name: "dark_blue", hex: "#000080" },
  { name: "teal", hex: "#008080" },
  { name: "green", hex: "#008000" },
  { name: "violet", hex: "#800080" },
  { name: "dark_red", hex: "#800000" },
  { name: "dark_yellow", hex: "#808000" },
  { name: "gray50", hex: "#808080" },
  { name: "gray25", hex: "#c0c0c0" },
  { name: "black", hex: "#000000" },
  { name: "white", hex: "#ffffff" },
];

const colorName = (swatch: Swatch): string => t(`rich.color.name.${swatch.name}` as Key);

/// I gesti che commutano, con l'id del catalogo e il segno che li mostra.
const TOGGLES: readonly { id: string; label: Key; glyph: string; className?: string; smallCaps?: boolean }[] = [
  { id: "rich.underline", label: "rich.underline", glyph: "U", className: "rich-strip-underline" },
  { id: "rich.superscript", label: "rich.superscript", glyph: "x²" },
  { id: "rich.subscript", label: "rich.subscript", glyph: "x₂" },
  { id: "rich.caps", label: "rich.caps", glyph: "AA" },
  { id: "rich.small_caps", label: "rich.small_caps", glyph: "Aa", smallCaps: true },
];

/// Gli allineamenti, con l'id del catalogo e le righe che li disegnano.
const ALIGNS: readonly { id: string; label: Key; lines: readonly string[] }[] = [
  { id: "rich.align.left", label: "rich.align.left", lines: ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"] },
  { id: "rich.align.center", label: "rich.align.center", lines: ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"] },
  { id: "rich.align.right", label: "rich.align.right", lines: ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"] },
  { id: "rich.align.justify", label: "rich.align.justify", lines: ["M4 6h16", "M4 10h16", "M4 14h16", "M4 18h16"] },
];

/// I ruoli della galleria degli stili, prima degli stili del documento.
const ROLE_STYLES: readonly string[] = ["body", "h:1", "h:2", "h:3", "h:4", "h:5", "h:6", "quote"];

export interface RichStrip {
  readonly element: HTMLElement;
  /// Rilegge l'aspetto della selezione e lo stato dei gesti.
  refresh(): void;
  destroy(): void;
}

let ids = 0;

/// Un'icona disegnata col tratto delle icone della shell.
function icon(paths: readonly string[]): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function mountStrip(
  engine: RichEngine,
  chord: (id: string) => string | null,
  media: RichMedia = {},
  stripOptions: RichStripOptions = {},
): RichStrip {
  const life = openLifetime();
  const element = document.createElement("div");
  element.className = stripOptions.only ? "rich-strip rich-strip-mini" : "rich-strip";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  const prefix = `rich-strip-${(ids += 1)}`;
  let popover: PopoverHandle | null = null;
  const relabel: (() => void)[] = [];

  const shown = (name: RichStripGroup): boolean => (stripOptions.only ? stripOptions.only.includes(name) : name !== "emphasis");

  /// Un gruppo della striscia. Uno che non si mostra resta fuori dal
  /// documento: i suoi controlli esistono e si aggiornano, nessuno li vede.
  function group(name: RichStripGroup): HTMLElement {
    const el = document.createElement("div");
    el.className = "rich-strip-group";
    // Il lettore di schermo annuncia il gruppo entrando: «Paragrafo», poi il
    // controllo.
    el.setAttribute("role", "group");
    const label = () => el.setAttribute("aria-label", t(`rich.strip.group.${name}`));
    label();
    relabel.push(label);
    if (shown(name)) element.append(el);
    return el;
  }

  function button(label: () => string, id: string | null, onPress: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "rich-strip-button";
    control.tabIndex = -1;
    const name = () => {
      const hint = id ? chord(id) : null;
      const display = displayBinding(hint);
      labelButton(control, label(), display ? { display, aria: ariaBinding(hint) ?? undefined } : undefined);
    };
    name();
    relabel.push(name);
    life.listen(control, "click", () => onPress(control));
    return control;
  }

  function select(className: string, label: Key, onChange: (value: string) => void): HTMLSelectElement {
    const control = document.createElement("select");
    control.className = `rich-strip-select ${className}`;
    control.id = `${prefix}-${className}`;
    control.tabIndex = -1;
    const caption = document.createElement("label");
    caption.className = "sr-only";
    caption.htmlFor = control.id;
    const name = () => {
      caption.textContent = t(label);
    };
    name();
    relabel.push(name);
    life.listen(control, "change", () => onChange(control.value));
    const holder = document.createElement("span");
    holder.className = "rich-strip-field";
    holder.append(caption, control);
    return control;
  }

  // ── Tipo e dimensione ─────────────────────────────────────────────────
  const type = group("type");
  const font = select("rich-strip-font", "rich.font", (value) => {
    if (value) engine.apply(setFont(value));
  });
  const size = select("rich-strip-size", "rich.size", (value) => {
    const pt = Number(value);
    if (Number.isFinite(pt) && pt > 0) engine.apply(setSize(pt));
  });
  type.append(font.parentElement!, size.parentElement!);
  const grow = button(() => t("rich.font.grow"), "rich.font.grow", () => engine.run("rich.font.grow"));
  grow.textContent = "A⁺";
  const shrink = button(() => t("rich.font.shrink"), "rich.font.shrink", () => engine.run("rich.font.shrink"));
  shrink.textContent = "A⁻";
  type.append(grow, shrink);

  // ── Enfasi (soltanto nella mini-barra) ────────────────────────────────
  const emphasis = group("emphasis");
  const emphasisButtons = (shown("emphasis") ? EMPHASES : []).map((spec) => {
    const control = button(() => t(spec.label), spec.id, () => engine.run(spec.id));
    control.textContent = spec.glyph;
    control.classList.add(spec.className);
    control.dataset.action = spec.id;
    setPressed(control, false);
    emphasis.append(control);
    return { spec, control };
  });

  // ── Gesti che commutano ───────────────────────────────────────────────
  const toggles = group("toggles");
  const toggleButtons = TOGGLES.map((spec) => {
    const control = button(() => t(spec.label), spec.id, () => engine.run(spec.id));
    control.textContent = spec.glyph;
    if (spec.className) control.classList.add(spec.className);
    // Il maiuscoletto si mostra com'è: il segno `ᴀ` manca in molti caratteri.
    if (spec.smallCaps) control.style.fontVariantCaps = "small-caps";
    control.dataset.action = spec.id;
    setPressed(control, false);
    toggles.append(control);
    return { spec, control };
  });

  // ── Colori ────────────────────────────────────────────────────────────
  const colors = group("colors");
  const colorButton = button(() => t("rich.color"), null, (anchor) => openColors(anchor, "color"));
  const colorBar = document.createElement("span");
  colorBar.className = "rich-strip-bar";
  colorButton.append("A", colorBar);
  colorButton.setAttribute("aria-haspopup", "dialog");
  const highlightButton = button(() => t("rich.highlight"), null, (anchor) => openColors(anchor, "highlight"));
  const highlightBar = document.createElement("span");
  highlightBar.className = "rich-strip-bar";
  highlightButton.append("ab", highlightBar);
  highlightButton.classList.add("rich-strip-marker");
  highlightButton.setAttribute("aria-haspopup", "dialog");
  colors.append(colorButton, highlightButton);

  // ── Copia formato ─────────────────────────────────────────────────────
  const tools = group("tools");
  const painter = button(() => t("rich.painter"), null, () => engine.togglePainter());
  // Il pennello.
  painter.append(icon(["M5 3h12v6H5z", "M17 6h2v5h-8v3", "M10 14h2v7h-2z"]));
  painter.classList.add("rich-strip-painter");
  setPressed(painter, false);
  tools.append(painter);

  // ── Il paragrafo ──────────────────────────────────────────────────────
  const paragraph = group("paragraph");
  const style = select("rich-strip-style", "rich.style", (value) => {
    const pick = stylePick(value);
    if (pick) engine.apply(setStyle(pick, engine.documentLook()));
  });
  style.style.width = "148px";
  paragraph.append(style.parentElement!);
  const alignButtons = ALIGNS.map((spec) => {
    const control = button(() => t(spec.label), spec.id, () => engine.run(spec.id));
    control.append(icon(spec.lines));
    control.dataset.action = spec.id;
    setPressed(control, false);
    paragraph.append(control);
    return { spec, control };
  });
  const dedent = button(() => t("rich.indent.decrease"), "rich.indent.decrease", () => engine.run("rich.indent.decrease"));
  dedent.append(icon(["M11 6h9", "M11 10h9", "M11 14h9", "M11 18h9", "M7 9l-3 3 3 3"]));
  const indent = button(() => t("rich.indent.increase"), "rich.indent.increase", () => engine.run("rich.indent.increase"));
  indent.append(icon(["M11 6h9", "M11 10h9", "M11 14h9", "M11 18h9", "M4 9l3 3-3 3"]));
  const spacing = button(() => t("rich.spacing"), null, (anchor) => openSpacing(anchor));
  spacing.append(icon(["M11 6h9", "M11 12h9", "M11 18h9", "M5 4v16", "M3 6l2-2 2 2", "M3 18l2 2 2-2"]));
  spacing.setAttribute("aria-haspopup", "dialog");
  paragraph.append(dedent, indent, spacing);

  // ── Inserisci ─────────────────────────────────────────────────────────
  const insert = group("insert");
  const link = button(() => t("rich.link"), "rich.link", () => engine.run("rich.link"));
  link.append(icon(["M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1", "M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"]));
  link.dataset.action = "rich.link";
  link.setAttribute("aria-haspopup", "dialog");
  const pageBreak = button(() => t("rich.break.page"), "rich.break.page", () => engine.run("rich.break.page"));
  pageBreak.append(icon(["M5 3v5h14V3", "M5 21v-5h14v5", "M4 12h2", "M9 12h2", "M13 12h2", "M18 12h2"]));
  const columnBreak = button(() => t("rich.break.column"), "rich.break.column", () => engine.run("rich.break.column"));
  columnBreak.append(icon(["M4 5h6", "M4 9h6", "M4 13h6", "M14 11h6", "M14 15h6", "M14 19h6", "M12 3v18"]));
  const table = button(() => t("rich.table"), null, (anchor) => openTable(anchor));
  table.append(icon(["M4 5h16v14H4z", "M4 10h16", "M4 15h16", "M10 5v14"]));
  table.setAttribute("aria-haspopup", "dialog");
  const merge = button(() => t("rich.table.merge"), "rich.table.merge", () => engine.run("rich.table.merge"));
  merge.append(icon(["M4 5h16v14H4z", "M7 12h4", "M9 10l2 2-2 2", "M17 12h-4", "M15 10l-2 2 2 2"]));
  const split = button(() => t("rich.table.split"), "rich.table.split", () => engine.run("rich.table.split"));
  split.append(icon(["M4 5h16v14H4z", "M12 5v14", "M9 12H6", "M7.5 10.5 6 12l1.5 1.5", "M15 12h3", "M16.5 10.5 18 12l-1.5 1.5"]));
  const image = button(() => t("rich.image"), null, () => void addImage());
  image.append(icon(["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 9.5h.01"]));
  image.hidden = media.pickImage === undefined;
  const note = button(() => t("rich.note"), null, (anchor) => openNote(anchor));
  note.append(icon(["M5 4h14v10l-5 6H5z", "M14 20v-6h5", "M8 8h8", "M8 11h5"]));
  note.setAttribute("aria-haspopup", "dialog");
  insert.append(link, table, merge, split, image, note, pageBreak, columnBreak);
  // Chi chiede un link, una ricerca o un commento lo chiede alla striscia
  // che ne mostra il pulsante: la mini-barra non risponde al posto suo.
  if (shown("insert")) life.add(engine.onAsk(LINK_ACTION, () => openLink(link)));

  // ── Pagina ────────────────────────────────────────────────────────────
  // Soltanto in un formato che ha una pagina (il docx, non l'odt).
  const layout = group("layout");
  const pageButton = button(() => t("rich.page"), null, (anchor) => openPage(anchor));
  pageButton.append(icon(["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 12h7", "M9 15h7", "M9 18h4"]));
  pageButton.setAttribute("aria-haspopup", "dialog");
  const runningButton = button(() => t("rich.hf"), null, (anchor) => openRunning(anchor));
  runningButton.append(icon(["M6 3h12v18H6z", "M9 6h6", "M9 18h6", "M6 9h12", "M6 15h12"]));
  runningButton.setAttribute("aria-haspopup", "dialog");
  const tocButton = button(() => t("rich.toc"), null, () => engine.apply(insertToc(t("rich.toc.title"))));
  tocButton.append(icon(["M4 6h2", "M9 6h11", "M6 11h2", "M11 11h9", "M6 16h2", "M11 16h9"]));
  layout.append(pageButton, runningButton, tocButton);

  // ── Revisione ─────────────────────────────────────────────────────────
  const review = group("review");
  const find = button(() => t("rich.find"), FIND_ACTION, () => engine.run(FIND_ACTION));
  find.append(icon(["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20"]));
  find.setAttribute("aria-haspopup", "dialog");
  const count = button(() => t("rich.count"), null, (anchor) => openCount(anchor));
  count.append(icon(["M4 6h10", "M4 10h16", "M4 14h12", "M4 18h7", "M17 16v4", "M15 18h4"]));
  count.setAttribute("aria-haspopup", "dialog");
  const comments = button(() => t("rich.comments"), null, (anchor) => openComments(anchor, false));
  comments.append(icon(["M4 5h16v11H9l-5 4z", "M8 9h8", "M8 12h5"]));
  comments.setAttribute("aria-haspopup", "dialog");
  const track = button(() => t("rich.track"), null, (anchor) => openTrack(anchor));
  track.append(icon(["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4", "M14 20h6"]));
  track.setAttribute("aria-haspopup", "dialog");
  review.append(find, count, comments, track);
  if (shown("review")) {
    life.add(engine.onAsk(FIND_ACTION, () => openFind(find)));
    life.add(engine.onAsk(COMMENT_ACTION, () => openComments(comments, true)));
  }
  // Le revisioni tracciate: si vedono soltanto in un documento che ne ha.
  const revisionButtons = REVISION_BUTTONS.map((spec) => {
    const control = button(() => t(spec.id as Key), spec.id, () => engine.run(spec.id));
    control.append(icon(spec.lines));
    control.dataset.action = spec.id;
    review.append(control);
    return control;
  });

  // ── I riquadri ────────────────────────────────────────────────────────
  // Ogni riquadro della striscia ha un titolo che gli dà il nome, i campi con
  // la loro `label[for]` sopra, come quelli del kit, e in fondo le azioni:
  // pulsanti del kit, con la principale per ultima. È un `form`: Invio in un
  // campo è la sua azione principale, dove ne ha una che si invia.

  interface Panel {
    readonly root: HTMLFormElement;
    readonly body: HTMLElement;
    readonly actions: HTMLElement;
    readonly titleId: string;
  }

  /// Un riquadro col suo titolo. `pairs` mette i campi a due a due.
  function panel(title: string, layout: "stack" | "pairs" = "stack"): Panel {
    const root = document.createElement("form");
    root.className = "rich-strip-panel";
    const heading = document.createElement("h2");
    heading.className = "rich-strip-panel-title";
    heading.id = identifier(`${prefix}-panel`);
    heading.textContent = title;
    const body = document.createElement("div");
    body.className = layout === "pairs" ? "rich-strip-panel-body rich-strip-panel-pairs" : "rich-strip-panel-body";
    const actions = document.createElement("div");
    actions.className = "rich-strip-panel-actions";
    root.append(heading, body, actions);
    // Un riquadro senza un'azione da inviare non ricarica niente con Invio.
    life.listen(root, "submit", (event) => event.preventDefault());
    return { root, body, actions, titleId: heading.id };
  }

  /// Apre il riquadro sotto il suo pulsante.
  function showPanel(anchor: HTMLButtonElement, card: Panel, onClose?: () => void): void {
    if (card.actions.childElementCount === 0) card.actions.remove();
    popover = openPopover({
      anchor,
      content: card.root,
      labelledBy: card.titleId,
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
        onClose?.();
      },
    });
    anchor.setAttribute("aria-expanded", "true");
  }

  /// Un'azione del riquadro. Quella che si invia (`submit`) la fa il `form`.
  function action(into: HTMLElement, label: string, onPress: () => void, kind: ButtonKind = "normal", submit = false): HTMLButtonElement {
    const control = textButton({ label, kind, onPress: submit ? () => {} : onPress, lifetime: life });
    if (submit) control.type = "submit";
    into.append(control);
    return control;
  }

  /// «Fine»: chiude un riquadro le cui scelte valgono già.
  function finish(card: Panel): HTMLButtonElement {
    return action(card.actions, t("rich.panel.done"), () => {
      popover?.close();
      engine.focus();
    }, "primary");
  }

  /// Un campo di testo del kit.
  function text(into: HTMLElement, label: string, value = "", placeholder?: string): HTMLInputElement {
    const field = textField({ label, value, ...(placeholder === undefined ? {} : { placeholder }), lifetime: life });
    into.append(field.element);
    return field.input;
  }

  /// Una scelta o un'area di testo vestite come i campi del kit.
  function labelled<T extends HTMLSelectElement | HTMLTextAreaElement>(into: HTMLElement, control: T, label: string): T {
    control.id = identifier(`${prefix}-field`);
    control.classList.add("kit-field-input");
    const field = document.createElement("div");
    field.className = control instanceof HTMLTextAreaElement ? "kit-field rich-strip-panel-area" : "kit-field";
    const caption = document.createElement("label");
    caption.className = "kit-field-label";
    caption.htmlFor = control.id;
    caption.textContent = label;
    const box = document.createElement("div");
    box.className = "kit-field-box";
    box.append(control);
    field.append(caption, box);
    into.append(field);
    return control;
  }

  function choice(values: readonly (readonly [string, string])[]): HTMLSelectElement {
    const control = document.createElement("select");
    for (const [value, label] of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      control.append(option);
    }
    return control;
  }

  /// Una casella con il suo nome accanto.
  function check(into: HTMLElement, label: string): HTMLInputElement {
    const row = document.createElement("label");
    row.className = "rich-strip-panel-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    row.append(box, label);
    into.append(row);
    return box;
  }

  /// Una riga di testo del riquadro: uno stato, un avviso, una spiegazione.
  function remark(into: HTMLElement, role?: "status" | "alert"): HTMLParagraphElement {
    const line = document.createElement("p");
    line.className = "rich-strip-panel-note";
    if (role) line.setAttribute("role", role);
    into.append(line);
    return line;
  }

  /// Trova e sostituisci: le occorrenze si vedono nel testo mentre si scrive
  /// ciò che si cerca; Invio va alla prossima, Maiusc+Invio alla precedente.
  function openFind(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.find"));
    const selected = engine.selectedText();
    const what = text(card.body, t("rich.find.text"), selected && !selected.includes("\n") && selected.length <= 200 ? selected : "");
    const replacement = text(card.body, t("rich.find.replace"));
    const matchCase = check(card.body, t("rich.find.case"));
    const wholeWord = check(card.body, t("rich.find.word"));
    const status = remark(card.body, "status");
    const query = (): FindQuery => ({ text: what.value, matchCase: matchCase.checked, wholeWord: wholeWord.checked });
    let current = -1;
    const show = (index: number, said?: string) => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      current = index >= 0 && index < matches.length ? index : -1;
      engine.find(what.value === "" ? null : query(), current);
      status.textContent =
        said ??
        (what.value === ""
          ? ""
          : matches.length === 0
            ? t("rich.find.none")
            : t("rich.find.count", { current: String(current + 1), total: String(matches.length) }));
      for (const control of [previous, next, replaceOne, replaceEvery]) control.disabled = matches.length === 0;
      return matches;
    };
    const step = (direction: 1 | -1) => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      show(engine.read((state) => nextMatch(state, matches, direction)));
    };
    const previous = action(card.actions, t("rich.find.previous"), () => step(-1));
    const next = action(card.actions, t("rich.find.next"), () => {}, "normal", true);
    const replaceOne = action(card.actions, t("rich.find.replace_one"), () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      const match = matches[current];
      if (!match) {
        step(1);
        return;
      }
      engine.apply(replaceMatch(query(), match, replacement.value), false);
      step(1);
    });
    const replaceEvery = action(card.actions, t("rich.find.replace_all"), () => {
      const total = findMatches(engine.read((state) => state.doc), query()).length;
      if (!engine.apply(replaceAll(query(), replacement.value), false)) return;
      show(-1, t("rich.find.replaced", { n: String(total) }));
    }, "primary");
    const refind = () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      // Da dove sta il cursore, come quando si comincia a scrivere.
      const from = engine.read((state) => state.selection.from);
      const at = matches.findIndex((m) => m.from >= from);
      show(matches.length === 0 ? -1 : at < 0 ? 0 : at);
    };
    life.listen(what, "input", refind);
    life.listen(matchCase, "change", refind);
    life.listen(wholeWord, "change", refind);
    life.listen(card.root, "submit", () => step(1));
    life.listen(card.root, "keydown", (event) => {
      if (event.key !== "Enter" || !event.shiftKey || event.target !== what) return;
      event.preventDefault();
      step(-1);
    });
    showPanel(anchor, card, () => engine.find(null));
    refind();
    what.focus();
    what.select();
  }

  /// Parole, caratteri e paragrafi del documento e, se c'è, della selezione.
  function openCount(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.count"));
    const table = document.createElement("table");
    table.className = "rich-strip-count";
    const { doc, from, to, empty } = engine.read(({ doc, selection }) => ({ doc, from: selection.from, to: selection.to, empty: selection.empty }));
    const columns: { label: Key; count: TextCount }[] = [
      ...(empty ? [] : [{ label: "rich.count.selection" as Key, count: countText(doc, from, to) }]),
      { label: "rich.count.document", count: countText(doc) },
    ];
    const cell = (tag: "th" | "td", content: string, scope?: string) => {
      const el = document.createElement(tag);
      el.textContent = content;
      if (scope) el.scope = scope;
      return el;
    };
    if (!empty) {
      const head = document.createElement("tr");
      head.append(cell("td", ""), ...columns.map((column) => cell("th", t(column.label), "col")));
      table.append(head);
    }
    const format = new Intl.NumberFormat(document.documentElement.lang || undefined);
    for (const key of ["words", "characters", "visible", "paragraphs"] as const) {
      const row = document.createElement("tr");
      row.append(cell("th", t(`rich.count.${key}` as Key), "row"), ...columns.map((column) => cell("td", format.format(column.count[key]))));
      table.append(row);
    }
    card.body.append(table);
    finish(card);
    showPanel(anchor, card);
  }

  /// I commenti del documento, con le risposte sotto, e uno nuovo sulla
  /// selezione. Ogni gesto è una battuta del documento.
  function openComments(anchor: HTMLButtonElement, writing: boolean): void {
    popover?.close();
    const card = panel(t("rich.comments"));
    card.root.classList.add("rich-strip-comments");
    const area = (into: HTMLElement, label: string, rows: number) => {
      const said = document.createElement("textarea");
      said.rows = rows;
      said.required = true;
      said.maxLength = 4000;
      return labelled(into, said, label);
    };
    const author = document.createElement("input");
    author.type = "text";
    author.required = true;
    author.maxLength = 200;
    author.value = reviewAuthor();
    life.listen(author, "input", () => setReviewAuthor(author.value));
    /// Il campo dell'autore, dove serve: è uno solo, e si sposta.
    const authorField = (into: HTMLElement) => {
      const field = textField({ label: t("rich.comment.author"), lifetime: life });
      field.element.querySelector(".kit-field-box")!.replaceChildren(author);
      author.id = field.input.id;
      author.className = "kit-field-input";
      into.append(field.element);
    };
    const by = () => author.value.trim();
    const done = (applied: boolean) => {
      if (!applied) return false;
      render();
      return true;
    };

    // Un commento nuovo, sulla selezione: l'azione principale del riquadro.
    const said = area(card.body, t("rich.comment.text"), 3);
    const hint = remark(card.body);
    let apply: HTMLButtonElement | null = null;
    if (media.review) {
      authorField(card.body);
      apply = action(card.actions, t("rich.comment.apply"), () => {}, "primary", true);
    } else {
      said.closest(".kit-field")!.remove();
    }
    life.listen(card.root, "submit", () => {
      if (!media.review) return;
      if (!by()) {
        author.focus();
        return;
      }
      if (done(engine.apply(addComment(said.value, by()), false))) said.value = "";
    });

    const list = document.createElement("div");
    list.className = "rich-strip-comment-list";
    // L'elenco sta dopo le azioni del commento nuovo: si legge dall'alto.
    card.root.append(list);

    const when = (at: string | undefined) => {
      const date = at ? new Date(at) : null;
      return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : (at ?? "");
    };
    /// Il commento con le sue risposte, ciascuna rientrata sotto.
    function thread(id: number, depth: number, all: ReturnType<typeof commentsOf>, placed: ReadonlySet<number>, into: HTMLElement): void {
      const comment = all.find((c) => c.id === id)!;
      const item = document.createElement("article");
      item.className = depth > 0 ? "rich-strip-comment rich-strip-comment-reply" : "rich-strip-comment";
      if (comment.done) item.dataset.done = "";
      const head = document.createElement("strong");
      head.className = "rich-strip-comment-head";
      head.textContent = [comment.by || t("rich.rev.anonymous"), when(comment.at), comment.done ? t("rich.comment.resolved") : ""]
        .filter(Boolean)
        .join(" · ");
      const body = document.createElement("p");
      body.className = "rich-strip-comment-text";
      body.textContent = comment.text ?? "";
      item.append(head, body);
      if (depth === 0) {
        const actions = document.createElement("div");
        actions.className = "rich-strip-comment-actions";
        const go = action(actions, t("rich.comment.go"), () => {
          if (engine.apply(goToComment(id))) popover?.close();
        });
        go.disabled = !placed.has(id);
        const reply = action(actions, t("rich.comment.reply"), () => {
          reply.disabled = true;
          // La risposta è un `form` suo, dentro l'articolo e non nel riquadro.
          const answer = document.createElement("form");
          answer.className = "rich-strip-comment-answer";
          const answerText = area(answer, t("rich.comment.reply.text"), 2);
          if (!by()) authorField(answer);
          const send = document.createElement("div");
          send.className = "rich-strip-panel-actions";
          action(send, t("rich.comment.reply"), () => {}, "primary", true);
          answer.append(send);
          life.listen(answer, "submit", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!by()) {
              author.focus();
              return;
            }
            done(engine.apply(replyComment(id, answerText.value, by()), false));
          });
          item.append(answer);
          answerText.focus();
        });
        reply.disabled = !media.review;
        action(actions, t(comment.done ? "rich.comment.reopen" : "rich.comment.resolve"), () => {
          done(engine.apply(resolveComment(id, !comment.done), false));
        });
        action(actions, t("rich.comment.delete"), () => {
          done(engine.apply(deleteComment(id), false));
        });
        item.append(actions);
      }
      into.append(item);
      for (const child of all) if (child.parent === id) thread(child.id, depth + 1, all, placed, into);
    }

    function render(): void {
      const all = engine.read((state) => commentsOf(state.doc));
      const placed = engine.read((state) => {
        const out = new Set<number>();
        for (const [id, place] of anchorsOf(state.doc)) if (place.start !== undefined && place.end !== undefined) out.add(id);
        return out;
      });
      const can = media.review === true && engine.read(canComment);
      said.disabled = !can;
      if (apply) apply.disabled = !can;
      hint.textContent = media.review ? (can ? "" : t("rich.comment.need_selection")) : t("rich.comment.unsupported");
      hint.hidden = hint.textContent === "";
      list.replaceChildren();
      const ids = new Set(all.map((c) => c.id));
      for (const comment of all) {
        if (comment.parent === undefined || !ids.has(comment.parent)) thread(comment.id, 0, all, placed, list);
      }
      if (all.length === 0) remark(list).textContent = t("rich.comment.none");
    }
    render();
    showPanel(anchor, card);
    if (writing && !said.disabled) said.focus();
    else list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  /// Registra le modifiche: chi le scrive, e l'interruttore. Mentre si
  /// registra, ciò che si scrive è una revisione di quell'autore.
  function openTrack(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.track"));
    const on = engine.tracking();
    remark(card.body).textContent = t(on ? "rich.track.on" : "rich.track.off");
    const author = text(card.body, t("rich.comment.author"), reviewAuthor());
    author.maxLength = 200;
    life.listen(author, "input", () => setReviewAuthor(author.value));
    const submit = action(card.actions, t(on ? "rich.track.stop" : "rich.track.start"), () => {}, "primary", true);
    life.listen(card.root, "submit", () => {
      if (!on && author.value.trim() === "") {
        author.focus();
        return;
      }
      engine.apply(setTracking(!on));
      popover?.close();
    });
    showPanel(anchor, card);
    (on ? submit : author).focus();
  }

  /// La griglia delle dimensioni: righe e colonne fino alla cella indicata,
  /// col mouse o con le frecce. «Inserisci» mette quella indicata.
  function openTable(anchor: HTMLButtonElement): void {
    popover?.close();
    const ROWS = 8;
    const COLS = 10;
    const card = panel(t("rich.table"));
    const grid = document.createElement("div");
    grid.className = "rich-strip-table-grid";
    const size = remark(card.body);
    size.setAttribute("aria-hidden", "true");
    const cells: HTMLButtonElement[] = [];
    for (let r = 1; r <= ROWS; r += 1) {
      for (let c = 1; c <= COLS; c += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "rich-strip-swatch rich-strip-table-cell";
        cell.dataset.rows = String(r);
        cell.dataset.cols = String(c);
        cell.setAttribute("aria-label", t("rich.table.cells", { rows: String(r), cols: String(c) }));
        cell.tabIndex = r === 1 && c === 1 ? 0 : -1;
        cells.push(cell);
      }
    }
    grid.append(...cells);
    card.body.prepend(grid);
    let chosen = { rows: 2, cols: 2 };
    const at = (target: EventTarget | null) => (target instanceof HTMLButtonElement && cells.includes(target) ? target : null);
    const show = (rows: number, cols: number) => {
      chosen = { rows, cols };
      for (const cell of cells) {
        cell.toggleAttribute("data-inside", Number(cell.dataset.rows) <= rows && Number(cell.dataset.cols) <= cols);
      }
      size.textContent = t("rich.table.size", { rows: String(rows), cols: String(cols) });
    };
    const point = (target: EventTarget | null) => {
      const cell = at(target);
      if (cell) show(Number(cell.dataset.rows), Number(cell.dataset.cols));
    };
    const place = () => {
      popover?.close();
      engine.apply(insertTable(chosen.rows, chosen.cols));
    };
    show(chosen.rows, chosen.cols);
    life.listen(grid, "pointerover", (event) => point(event.target));
    life.listen(grid, "focusin", (event) => point(event.target));
    life.listen(grid, "click", (event) => {
      if (at(event.target)) place();
    });
    life.listen(grid, "keydown", (event) => {
      const cell = at(event.target);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[event.key];
      if (!cell || step === undefined) return;
      const next = cells[cells.indexOf(cell) + step];
      event.preventDefault();
      if (!next) return;
      cell.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
    action(card.actions, t("rich.table.apply"), place, "primary");
    showPanel(anchor, card);
  }

  /// Un'immagine del vault, alla sua misura entro la colonna del testo.
  async function addImage(): Promise<void> {
    const pick = media.pickImage;
    if (!pick) return;
    let picked: Blob | "unreadable" | null;
    try {
      picked = await pick();
    } catch (error) {
      if (!life.closed) notify(errorText(error), "guasto");
      return;
    }
    if (picked === null || life.closed) return;
    const placed = picked === "unreadable" ? null : await placedImage(picked).catch(() => null);
    // La superficie può essersi chiusa mentre l'immagine si leggeva.
    if (life.closed) return;
    if (!placed) {
      notify(t("rich.image.unreadable"), "guasto");
      return;
    }
    engine.apply(insertImage(placed.data, placed.w, placed.h));
  }

  /// Il testo di una nota nuova e dove va: a piè di pagina o in chiusura.
  function openNote(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.note"));
    const said = text(card.body, t("rich.note.text"));
    said.required = true;
    said.maxLength = 4000;
    const kind = labelled(
      card.body,
      choice([
        ["foot", t("rich.note.foot")],
        ["end", t("rich.note.end")],
      ]),
      t("rich.note.kind"),
    );
    action(card.actions, t("rich.note.apply"), () => {}, "primary", true);
    life.listen(card.root, "submit", () => {
      if (!engine.apply(insertNote(said.value, kind.value === "end"), false)) return;
      popover?.close();
      engine.focus();
    });
    showPanel(anchor, card);
    said.focus();
  }

  /// L'indirizzo del link sulla selezione o al cursore; senza selezione,
  /// anche il testo da scrivere.
  function openLink(anchor: HTMLButtonElement): void {
    popover?.close();
    const current = engine.read(linkAt);
    const typing = !current && engine.read((state) => state.selection.empty);
    const card = panel(t("rich.link"));
    const address = text(card.body, t("rich.link.address"), current?.href ?? "", "https://");
    address.inputMode = "url";
    const words = typing ? text(card.body, t("rich.link.text")) : null;
    const problem = remark(card.body, "alert");
    problem.hidden = true;
    const done = (applied: boolean) => {
      if (!applied) return;
      popover?.close();
      engine.focus();
    };
    if (current) action(card.actions, t("rich.link.remove"), () => done(engine.apply(setLink(null), false)), "danger");
    action(card.actions, t("rich.link.apply"), () => {}, "primary", true);
    life.listen(card.root, "submit", () => {
      const href = address.value.trim();
      if (href === "") {
        done(current ? engine.apply(setLink(null), false) : true);
        return;
      }
      const applied = engine.apply(setLink(href, words ? words.value : undefined), false);
      problem.textContent = t("rich.link.invalid");
      problem.hidden = applied;
      done(applied);
    });
    showPanel(anchor, card);
    address.focus();
  }

  function stylePick(value: string): StylePick | null {
    if (value === "body") return { role: { kind: "body" } };
    if (value === "quote") return { role: { kind: "quote" } };
    if (value.startsWith("h:")) return { role: { kind: "heading", level: Number(value.slice(2)) } };
    if (value.startsWith("s:")) {
      const found = engine.styles().find((s) => s.id === value.slice(2));
      if (found) return { s: found.id, ...(found.f ? { f: found.f } : {}) };
    }
    return null;
  }

  function styleName(value: string): string {
    if (value === "body") return t("rich.style.body");
    if (value === "quote") return t("rich.style.quote");
    if (value.startsWith("h:")) return t("rich.style.heading", { n: value.slice(2) });
    return engine.styles().find((s) => s.id === value.slice(2))?.name ?? value.slice(2);
  }

  /// La spaziatura del paragrafo: interlinea in righe o esatta in punti,
  /// rientri in centimetri, spazi prima e dopo in punti, come in Word, con la
  /// virgola della lingua. Un campo vuoto segue lo stile; un campo lasciato
  /// com'era non riscrive niente, perché l'arrotondamento non diventi una
  /// modifica. Ogni scelta vale subito: «Fine» chiude.
  function openSpacing(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.spacing"), "pairs");
    const language = resolvedLanguage();
    const current = engine.read((state) => selectedLayout(state, "line"));
    const shown = !current ? (current === undefined ? "" : "mixed") : "multiple" in current ? String(current.multiple) : "exactly" in current ? "exactly" : "at_least";
    const values = ["", ...LINE_SPACINGS.map(String), "exactly", ...(shown === "at_least" || shown === "mixed" ? [shown] : [])];
    const line = labelled(
      card.body,
      choice(
        values.map((value): [string, string] => [
          value,
          value === "" ? t("rich.spacing.style")
          : value === "exactly" ? t("rich.spacing.exactly")
          : value === "at_least" ? t("rich.spacing.at_least")
          : value === "mixed" ? ""
          : new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(Number(value)),
        ]),
      ),
      t("rich.spacing.line"),
    );
    line.value = shown;
    // L'interlinea esatta (o minima) in punti: si scrive solo con quella scelta.
    const exact = current && !("multiple" in current) ? ("exactly" in current ? current.exactly : current.at_least) : null;
    const points = text(card.body, t("rich.spacing.points"), exact === null ? "" : formatLength(exact, "pt", language));
    points.inputMode = "decimal";
    points.disabled = exact === null;
    life.listen(line, "change", () => {
      points.disabled = line.value !== "exactly" && line.value !== "at_least";
      if (line.value === "at_least" || line.value === "mixed") return;
      if (line.value === "exactly") {
        const n = parseLength(points.value, "pt") ?? 12;
        if (n === undefined || n <= 0) return;
        points.value = formatLength(n, "pt", language);
        engine.apply(setLayout({ line: { exactly: n } }), false);
        return;
      }
      engine.apply(setLineSpacing(line.value === "" ? null : Number(line.value)), false);
    });
    life.listen(points, "change", () => {
      const n = parseLength(points.value, "pt");
      if (n === null || n === undefined || n <= 0) return;
      engine.apply(setLayout({ line: line.value === "at_least" ? { at_least: n } : { exactly: n } }), false);
    });
    for (const key of LAYOUT_LENGTHS) {
      const unit = key === "before" || key === "after" ? "pt" : "cm";
      const value = engine.read((state) => selectedLayout(state, key));
      const input = text(card.body, t(`rich.spacing.${key}` as Key), typeof value === "number" ? formatLength(value, unit, language) : "", t("rich.spacing.style"));
      input.inputMode = "decimal";
      const was = input.value;
      life.listen(input, "change", () => {
        if (input.value.trim() === was) return;
        const n = parseLength(input.value, unit);
        if (n === undefined || (n !== null && n < 0 && key !== "first")) return;
        engine.apply(setLayout({ [key]: n } as { [K in LayoutLength]?: number | null }), false);
      });
    }
    finish(card);
    showPanel(anchor, card);
  }

  /// La pagina della sezione del cursore: carta, verso, margini (in
  /// centimetri) e colonne. Ogni scelta si applica subito, e i campi si
  /// rileggono da ciò che il documento ha preso.
  function openPage(anchor: HTMLButtonElement): void {
    popover?.close();
    const card = panel(t("rich.page"), "pairs");
    // Una pagina che il codec rifiuterebbe non si prende: i campi tornano a
    // ciò che c'è, e l'avviso dice perché.
    const apply = (command: Command) => {
      const applied = engine.apply(command, false);
      fill();
      problem.hidden = applied;
    };
    const paper = labelled(card.body, choice([...PAPER_SIZES.map((s): [string, string] => [s.name, paperLabel(s.name)]), ["", t("rich.page.custom")]]), t("rich.page.size"));
    life.listen(paper, "change", () => {
      const size = PAPER_SIZES.find((s) => s.name === paper.value);
      if (size) apply(setPaper(size.w, size.h));
    });
    const turn = labelled(
      card.body,
      choice([
        ["portrait", t("rich.page.portrait")],
        ["landscape", t("rich.page.landscape")],
      ]),
      t("rich.page.orientation"),
    );
    life.listen(turn, "change", () => apply(setLandscape(turn.value === "landscape")));
    const preset = labelled(card.body, choice([...MARGIN_PRESETS.map((m): [string, string] => [m.id, t(`rich.page.margins.${m.id}` as Key)]), ["", t("rich.page.custom")]]), t("rich.page.margins"));
    life.listen(preset, "change", () => {
      const margins = MARGIN_PRESETS.find((m) => m.id === preset.value);
      if (margins) apply(setMargins(margins));
    });
    const language = resolvedLanguage();
    const sides = (["top", "bottom", "left", "right"] as const).map((side) => {
      const input = text(card.body, t(`rich.page.${side}` as Key));
      input.inputMode = "decimal";
      life.listen(input, "change", () => {
        const points = parseLength(input.value, "cm");
        const page = engine.read(pageAt)?.page;
        // Il margine lasciato com'era non si riscrive arrotondato.
        if (points === null || points === undefined || points < 0 || !page || input.value.trim() === formatLength(page[side], "cm", language)) return fill();
        apply(setMargins({ top: page.top, bottom: page.bottom, left: page.left, right: page.right, [side]: points }));
      });
      return { side, input };
    });
    const cols = labelled(card.body, choice([1, 2, 3].map((n): [string, string] => [String(n), String(n)])), t("rich.page.columns"));
    life.listen(cols, "change", () => apply(setColumns(Number(cols.value))));
    const problem = remark(card.body, "alert");
    problem.textContent = t("rich.page.too_large");
    const fill = () => {
      problem.hidden = true;
      const page = engine.read(pageAt)?.page;
      if (!page) return void popover?.close();
      paper.value = paperName(page, PAPER_SIZES) ?? "";
      turn.value = landscape(page) ? "landscape" : "portrait";
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      preset.value =
        MARGIN_PRESETS.find((m) => near(m.top, page.top) && near(m.bottom, page.bottom) && near(m.left, page.left) && near(m.right, page.right))?.id ?? "";
      for (const { side, input } of sides) input.value = formatLength(page[side], "cm", language);
      const n = columns(page);
      if (![...cols.options].some((o) => o.value === String(n))) cols.append(choice([[String(n), String(n)]]).options[0]!);
      cols.value = String(n);
    };
    fill();
    finish(card);
    showPanel(anchor, card);
  }

  /// L'intestazione e il piè di pagina della sezione del cursore, come
  /// testo: una riga per paragrafo, i numeri di pagina con il loro codice.
  /// Ogni battuta si applica subito; vuoto, la sezione mostra quello della
  /// sezione prima.
  function openRunning(anchor: HTMLButtonElement): void {
    popover?.close();
    const at = engine.read(pageAt);
    if (!at) return;
    const card = panel(t("rich.hf"));
    let last: HTMLTextAreaElement | null = null;
    const areas = (["header", "footer"] as const).map((kind) => {
      const area = document.createElement("textarea");
      area.rows = 2;
      area.placeholder = t("rich.hf.inherit");
      const running = at[kind];
      const said = running ? runningText(running) : "";
      area.value = said ?? running!.lines.map((line) => line.map((piece) => (typeof piece === "string" ? piece : FIELD_CODES[piece.field])).join("")).join("\n");
      area.readOnly = said === null;
      if (area.readOnly) area.title = t("rich.hf.locked");
      life.listen(area, "focus", () => {
        last = area;
      });
      life.listen(area, "input", () => engine.apply(setRunning(kind, runningOf(area.value)), false));
      return labelled(card.body, area, t(`rich.hf.${kind}`));
    });
    const fields = document.createElement("div");
    fields.className = "rich-strip-panel-fields";
    for (const field of PAGE_FIELDS) {
      const add = action(fields, t(`rich.hf.${field}`), () => {
        const area = last ?? areas.find((a) => !a.readOnly);
        if (!area || area.readOnly) return;
        area.setRangeText(FIELD_CODES[field], area.selectionStart, area.selectionEnd, "end");
        area.focus();
        area.dispatchEvent(new Event("input"));
      });
      // Il campo va dove si scriveva: il bottone non prende il fuoco.
      life.listen(add, "mousedown", (event) => event.preventDefault());
    }
    card.body.append(fields);
    const locked = remark(card.body);
    locked.textContent = t("rich.hf.locked");
    locked.hidden = !areas.some((area) => area.readOnly);
    finish(card);
    showPanel(anchor, card);
  }

  /// I colori: un campione si applica subito e chiude.
  function openColors(anchor: HTMLButtonElement, kind: "color" | "highlight"): void {
    popover?.close();
    const card = panel(t(kind === "color" ? "rich.color" : "rich.highlight"));
    const grid = document.createElement("div");
    grid.className = "rich-strip-swatches";
    const pick = (value: string | null) => {
      popover?.close();
      engine.apply(kind === "color" ? setColor(value) : setHighlight(value));
    };
    const plain = document.createElement("button");
    plain.type = "button";
    plain.className = "rich-strip-swatch-none";
    plain.textContent = t(kind === "color" ? "rich.color.auto" : "rich.highlight.none");
    life.listen(plain, "click", () => pick(kind === "color" ? COLOR_AUTO : null));
    grid.append(plain);
    for (const swatch of kind === "color" ? TEXT_COLORS : HIGHLIGHT_COLORS) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rich-strip-swatch";
      cell.style.backgroundColor = swatch.hex;
      cell.dataset.color = swatch.hex;
      labelButton(cell, colorName(swatch));
      life.listen(cell, "click", () => pick(swatch.hex));
      grid.append(cell);
    }
    if (kind === "color") {
      const custom = document.createElement("label");
      custom.className = "rich-strip-swatch-custom";
      const input = document.createElement("input");
      input.type = "color";
      input.value = engine.look().color?.startsWith("#") ? engine.look().color! : "#000000";
      custom.append(input, t("rich.color.custom"));
      life.listen(input, "change", () => pick(input.value.toLowerCase()));
      grid.append(custom);
    }
    card.body.append(grid);
    showPanel(anchor, card);
  }

  // ── La barra degli strumenti ──────────────────────────────────────────
  let current: HTMLElement | null = null;
  const controls = (): HTMLElement[] =>
    [...element.querySelectorAll<HTMLElement>("button, select")].filter(
      (control) => !(control as HTMLButtonElement).disabled,
    );
  function roving(target: HTMLElement | null): void {
    const all = controls();
    current = target && all.includes(target) ? target : all[0] ?? null;
    for (const control of element.querySelectorAll<HTMLElement>("button, select")) {
      control.tabIndex = control === current ? 0 : -1;
    }
  }
  life.listen(element, "mousedown", (event) => {
    if ((event.target as Element | null)?.closest("button")) event.preventDefault();
  });
  life.listen(element, "focusin", (event) => {
    if (event.target instanceof HTMLElement && element.contains(event.target)) roving(event.target);
  });
  life.listen(element, "keydown", (event) => {
    const all = controls();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (at + 1) % all.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + all.length) % all.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      engine.focus();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    roving(all[next]!);
    all[next]!.focus();
  });

  function options(control: HTMLSelectElement, values: readonly string[], value: string | null, show: (v: string) => string): void {
    const wanted = value === null ? ["", ...values] : values;
    const same =
      control.options.length === wanted.length && wanted.every((v, i) => control.options[i]!.value === v);
    if (!same) {
      control.replaceChildren(
        ...wanted.map((v) => {
          const option = document.createElement("option");
          option.value = v;
          option.textContent = v === "" ? "" : show(v);
          return option;
        }),
      );
    }
    control.value = value ?? "";
  }

  function refresh(): void {
    const editable = engine.editable();
    element.hidden = !editable;
    if (!editable) {
      popover?.close();
      return;
    }
    const look = engine.look();
    // Mentre si registra, il formato non si cambia: non ha una revisione.
    const free = !engine.tracking();
    const fonts = [...new Set([...COMMON_FONTS, ...engine.fonts(), ...(look.font ? [look.font] : [])])].sort((a, b) =>
      a.localeCompare(b),
    );
    options(font, fonts, look.font, (v) => v);
    const sizes = [...new Set([...FONT_SIZES, ...(look.size !== null ? [look.size] : [])])].sort((a, b) => a - b);
    options(size, sizes.map(String), look.size === null ? null : String(look.size), (v) => v);
    for (const { spec, control } of [...emphasisButtons, ...toggleButtons]) {
      const state = engine.actionState(spec.id);
      control.disabled = !state.enabled;
      setPressed(control, state.active === true);
    }
    for (const control of [grow, shrink]) control.disabled = !engine.actionState(control === grow ? "rich.font.grow" : "rich.font.shrink").enabled;
    const styleValues = [...ROLE_STYLES, ...engine.styles().map((s) => `s:${s.id}`)];
    const chosen = engine.read(selectedStyle);
    options(style, styleValues, chosen !== null && styleValues.includes(chosen) ? chosen : null, styleName);
    for (const { spec, control } of alignButtons) {
      const state = engine.actionState(spec.id);
      control.disabled = !state.enabled;
      setPressed(control, state.active === true);
    }
    const linkState = engine.actionState("rich.link");
    link.disabled = !linkState.enabled;
    setPressed(link, linkState.active === true);
    find.disabled = !engine.actionState(FIND_ACTION).enabled;
    pageBreak.disabled = !engine.actionState("rich.break.page").enabled;
    columnBreak.disabled = !engine.actionState("rich.break.column").enabled;
    table.disabled = !engine.editable() || !engine.read(insertTable(1, 1));
    image.disabled = note.disabled = !engine.read(insertNote("·", false));
    merge.disabled = !engine.actionState("rich.table.merge").enabled;
    split.disabled = !engine.actionState("rich.table.split").enabled;
    comments.hidden = !media.review && engine.read((state) => commentsOf(state.doc).length === 0);
    track.hidden = !media.review && !engine.tracking();
    setPressed(track, engine.tracking());
    layout.hidden = engine.read(pageAt) === null;
    for (const control of [font, size, style, colorButton, highlightButton, painter, spacing, pageButton, runningButton, tocButton]) control.disabled = !free;
    if (free) tocButton.disabled = !engine.read(insertToc(""));
    if (!free) table.disabled = true;
    const tracked = engine.read(goToRevision(1));
    for (const control of revisionButtons) {
      control.hidden = !tracked;
      control.disabled = !tracked || !engine.actionState(control.dataset.action!).enabled;
    }
    dedent.disabled = !engine.actionState("rich.indent.decrease").enabled;
    indent.disabled = !engine.actionState("rich.indent.increase").enabled;
    colorBar.style.backgroundColor = look.color && look.color !== COLOR_AUTO ? look.color : "currentColor";
    highlightBar.style.backgroundColor = look.hl ?? "transparent";
    highlightBar.dataset.empty = String(look.hl === null);
    setPressed(painter, engine.painterArmed());
    if (!current || !element.contains(current) || (current as HTMLButtonElement).disabled) roving(null);
  }

  function name(): void {
    element.setAttribute("aria-label", t("rich.strip"));
    for (const label of relabel) label();
  }
  name();
  life.add(onLanguage(() => {
    name();
    refresh();
  }));
  life.add(engine.subscribe(refresh));
  roving(font);
  refresh();

  return {
    element,
    refresh,
    destroy() {
      popover?.close();
      life.close();
      element.remove();
    },
  };
}
