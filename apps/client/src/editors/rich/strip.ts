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
import { labelButton, openPopover, setPressed, type PopoverHandle } from "../../kit";
import { ariaBinding, displayBinding } from "../../ui/commands";
import { openLifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { errorText } from "../../host/errors";
import { onLanguage, t, type Key } from "../../i18n/strings";
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
  FIND_ACTION,
  LINK_ACTION,
} from "./commands";
import type { RichEngine } from "./engine";
import { COLOR_AUTO, HIGHLIGHT_DEFAULT, LAYOUT_LENGTHS, type LayoutLength } from "./projection";
import { imageMime } from "./schema";
import { countText, findMatches, nextMatch, replaceAll, replaceMatch, type FindQuery, type TextCount } from "./review";

/// Ciò che la striscia chiede alla shell.
export interface RichMedia {
  /// Un'immagine del vault scelta da chi scrive: i suoi byte, `null` se la
  /// scelta è annullata, `"unreadable"` se non si legge o pesa troppo.
  readonly pickImage?: () => Promise<Blob | "unreadable" | null>;
}

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

export function mountStrip(engine: RichEngine, chord: (id: string) => string | null, media: RichMedia = {}): RichStrip {
  const life = openLifetime();
  const element = document.createElement("div");
  element.className = "rich-strip";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  const prefix = `rich-strip-${(ids += 1)}`;
  let popover: PopoverHandle | null = null;
  const relabel: (() => void)[] = [];

  function group(): HTMLElement {
    const el = document.createElement("div");
    el.className = "rich-strip-group";
    element.append(el);
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
  const type = group();
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

  // ── Gesti che commutano ───────────────────────────────────────────────
  const toggles = group();
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
  const colors = group();
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
  const tools = group();
  const painter = button(() => t("rich.painter"), null, () => engine.togglePainter());
  // Il pennello.
  painter.append(icon(["M5 3h12v6H5z", "M17 6h2v5h-8v3", "M10 14h2v7h-2z"]));
  painter.classList.add("rich-strip-painter");
  setPressed(painter, false);
  tools.append(painter);

  // ── Il paragrafo ──────────────────────────────────────────────────────
  const paragraph = group();
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
  const insert = group();
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
  life.add(engine.onAsk(LINK_ACTION, () => openLink(link)));

  // ── Revisione ─────────────────────────────────────────────────────────
  const review = group();
  const find = button(() => t("rich.find"), FIND_ACTION, () => engine.run(FIND_ACTION));
  find.append(icon(["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20"]));
  find.setAttribute("aria-haspopup", "dialog");
  const count = button(() => t("rich.count"), null, (anchor) => openCount(anchor));
  count.append(icon(["M4 6h10", "M4 10h16", "M4 14h12", "M4 18h7", "M17 16v4", "M15 18h4"]));
  count.setAttribute("aria-haspopup", "dialog");
  review.append(find, count);
  life.add(engine.onAsk(FIND_ACTION, () => openFind(find)));

  /// Trova e sostituisci: le occorrenze si vedono nel testo mentre si scrive
  /// ciò che si cerca; Invio va alla prossima, Maiusc+Invio alla precedente.
  function openFind(anchor: HTMLButtonElement): void {
    popover?.close();
    const form = document.createElement("form");
    form.className = "rich-strip-swatches";
    form.style.display = "grid";
    form.style.gridTemplateColumns = "auto 220px";
    form.style.alignItems = "center";
    const field = (control: HTMLInputElement, label: Key, wide = false) => {
      control.id = `${prefix}-find-${form.childElementCount}`;
      const caption = document.createElement("label");
      caption.htmlFor = control.id;
      caption.textContent = t(label);
      if (wide) {
        // Una casella con la sua etichetta accanto, su tutta la riga.
        const row = document.createElement("span");
        row.style.gridColumn = "1 / -1";
        row.append(control, " ", caption);
        form.append(row);
        return;
      }
      control.className = "rich-strip-select";
      form.append(caption, control);
    };
    const text = document.createElement("input");
    text.type = "text";
    const selected = engine.selectedText();
    if (selected && !selected.includes("\n") && selected.length <= 200) text.value = selected;
    field(text, "rich.find.text");
    const replacement = document.createElement("input");
    replacement.type = "text";
    field(replacement, "rich.find.replace");
    const matchCase = document.createElement("input");
    matchCase.type = "checkbox";
    field(matchCase, "rich.find.case", true);
    const wholeWord = document.createElement("input");
    wholeWord.type = "checkbox";
    field(wholeWord, "rich.find.word", true);
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.style.gridColumn = "1 / -1";
    status.style.margin = "0";
    const actions = document.createElement("div");
    actions.style.gridColumn = "1 / -1";
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "4px";
    actions.style.justifyContent = "flex-end";
    const action = (label: Key, onPress: () => void, submit = false) => {
      const control = document.createElement("button");
      control.type = submit ? "submit" : "button";
      control.className = "rich-strip-swatch-none";
      control.textContent = t(label);
      if (!submit) life.listen(control, "click", onPress);
      actions.append(control);
      return control;
    };
    const query = (): FindQuery => ({ text: text.value, matchCase: matchCase.checked, wholeWord: wholeWord.checked });
    let current = -1;
    const show = (index: number, said?: string) => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      current = index >= 0 && index < matches.length ? index : -1;
      engine.find(text.value === "" ? null : query(), current);
      status.textContent =
        said ??
        (text.value === ""
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
    const previous = action("rich.find.previous", () => step(-1));
    const next = action("rich.find.next", () => step(1), true);
    const replaceOne = action("rich.find.replace_one", () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      const match = matches[current];
      if (!match) {
        step(1);
        return;
      }
      engine.apply(replaceMatch(query(), match, replacement.value), false);
      step(1);
    });
    const replaceEvery = action("rich.find.replace_all", () => {
      const total = findMatches(engine.read((state) => state.doc), query()).length;
      if (!engine.apply(replaceAll(query(), replacement.value), false)) return;
      show(-1, t("rich.find.replaced", { n: String(total) }));
    });
    form.append(status, actions);
    const refind = () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      // Da dove sta il cursore, come quando si comincia a scrivere.
      const from = engine.read((state) => state.selection.from);
      const at = matches.findIndex((m) => m.from >= from);
      show(matches.length === 0 ? -1 : at < 0 ? 0 : at);
    };
    life.listen(text, "input", refind);
    life.listen(matchCase, "change", refind);
    life.listen(wholeWord, "change", refind);
    life.listen(form, "submit", (event) => {
      event.preventDefault();
      step(1);
    });
    life.listen(form, "keydown", (event) => {
      if (event.key !== "Enter" || !event.shiftKey || event.target !== text) return;
      event.preventDefault();
      step(-1);
    });
    popover = openPopover({
      anchor,
      content: form,
      label: t("rich.find"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
        engine.find(null);
      },
    });
    anchor.setAttribute("aria-expanded", "true");
    refind();
    text.focus();
    text.select();
  }

  /// Parole, caratteri e paragrafi del documento e, se c'è, della selezione.
  function openCount(anchor: HTMLButtonElement): void {
    popover?.close();
    const table = document.createElement("table");
    table.className = "rich-strip-swatches";
    table.style.display = "table";
    const { doc, from, to, empty } = engine.read(({ doc, selection }) => ({ doc, from: selection.from, to: selection.to, empty: selection.empty }));
    const columns: { label: Key; count: TextCount }[] = [
      ...(empty ? [] : [{ label: "rich.count.selection" as Key, count: countText(doc, from, to) }]),
      { label: "rich.count.document", count: countText(doc) },
    ];
    const cell = (tag: "th" | "td", content: string, scope?: string) => {
      const el = document.createElement(tag);
      el.textContent = content;
      if (scope) el.scope = scope;
      if (tag === "td") el.style.textAlign = "end";
      el.style.padding = "2px 6px";
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
      const name = cell("th", t(`rich.count.${key}` as Key), "row");
      name.style.textAlign = "start";
      row.append(name, ...columns.map((column) => cell("td", format.format(column.count[key]))));
      table.append(row);
    }
    popover = openPopover({
      anchor,
      content: table,
      label: t("rich.count"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
  }

  /// La griglia delle dimensioni: righe e colonne fino alla cella indicata,
  /// col mouse o con le frecce.
  function openTable(anchor: HTMLButtonElement): void {
    popover?.close();
    const ROWS = 8;
    const COLS = 10;
    const box = document.createElement("div");
    box.className = "rich-strip-swatches";
    // Una colonna sola: la griglia, sotto le sue dimensioni.
    box.style.gridTemplateColumns = "auto";
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${COLS}, 20px)`;
    grid.style.gap = "2px";
    const size = document.createElement("p");
    size.setAttribute("aria-hidden", "true");
    size.style.margin = "0";
    size.style.textAlign = "center";
    const cells: HTMLButtonElement[] = [];
    for (let r = 1; r <= ROWS; r += 1) {
      for (let c = 1; c <= COLS; c += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "rich-strip-swatch";
        cell.style.width = cell.style.height = "20px";
        cell.dataset.rows = String(r);
        cell.dataset.cols = String(c);
        cell.setAttribute("aria-label", t("rich.table.cells", { rows: String(r), cols: String(c) }));
        cell.tabIndex = r === 1 && c === 1 ? 0 : -1;
        cells.push(cell);
      }
    }
    grid.append(...cells);
    box.append(grid, size);
    const at = (target: EventTarget | null) => (target instanceof HTMLButtonElement && cells.includes(target) ? target : null);
    const show = (rows: number, cols: number) => {
      for (const cell of cells) {
        const inside = Number(cell.dataset.rows) <= rows && Number(cell.dataset.cols) <= cols;
        cell.style.backgroundColor = inside ? "var(--accent-wash)" : "";
      }
      size.textContent = t("rich.table.size", { rows: String(rows), cols: String(cols) });
    };
    const point = (target: EventTarget | null) => {
      const cell = at(target);
      if (cell) show(Number(cell.dataset.rows), Number(cell.dataset.cols));
    };
    show(1, 1);
    life.listen(grid, "pointerover", (event) => point(event.target));
    life.listen(grid, "focusin", (event) => point(event.target));
    life.listen(grid, "click", (event) => {
      const cell = at(event.target);
      if (!cell) return;
      popover?.close();
      engine.apply(insertTable(Number(cell.dataset.rows), Number(cell.dataset.cols)));
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
    popover = openPopover({
      anchor,
      content: box,
      label: t("rich.table"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
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
    const form = document.createElement("form");
    form.className = "rich-strip-swatches";
    form.style.display = "grid";
    form.style.gridTemplateColumns = "auto 220px";
    form.style.alignItems = "center";
    const caption = (control: HTMLElement, label: Key) => {
      control.id = `${prefix}-note-${form.childElementCount}`;
      control.className = "rich-strip-select";
      const text = document.createElement("label");
      text.htmlFor = control.id;
      text.textContent = t(label);
      form.append(text, control);
    };
    const text = document.createElement("input");
    text.type = "text";
    text.required = true;
    text.maxLength = 4000;
    caption(text, "rich.note.text");
    const kind = document.createElement("select");
    for (const [value, label] of [["foot", "rich.note.foot"], ["end", "rich.note.end"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(label);
      kind.append(option);
    }
    caption(kind, "rich.note.kind");
    const actions = document.createElement("div");
    actions.style.gridColumn = "1 / -1";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.className = "rich-strip-swatch-none";
    apply.textContent = t("rich.note.apply");
    actions.append(apply);
    form.append(actions);
    life.listen(form, "submit", (event) => {
      event.preventDefault();
      if (!engine.apply(insertNote(text.value, kind.value === "end"), false)) return;
      popover?.close();
      engine.focus();
    });
    popover = openPopover({
      anchor,
      content: form,
      label: t("rich.note"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
    text.focus();
  }

  /// L'indirizzo del link sulla selezione o al cursore; senza selezione,
  /// anche il testo da scrivere.
  function openLink(anchor: HTMLButtonElement): void {
    popover?.close();
    const current = engine.read(linkAt);
    const typing = !current && engine.read((state) => state.selection.empty);
    const form = document.createElement("form");
    form.className = "rich-strip-swatches";
    form.style.display = "grid";
    form.style.gridTemplateColumns = "auto 220px";
    form.style.alignItems = "center";
    const field = (input: HTMLInputElement, label: Key) => {
      input.id = `${prefix}-link-${form.childElementCount}`;
      input.className = "rich-strip-select";
      const caption = document.createElement("label");
      caption.htmlFor = input.id;
      caption.textContent = t(label);
      form.append(caption, input);
    };
    const address = document.createElement("input");
    address.type = "text";
    address.inputMode = "url";
    address.placeholder = "https://";
    address.value = current?.href ?? "";
    field(address, "rich.link.address");
    const text = document.createElement("input");
    text.type = "text";
    if (typing) field(text, "rich.link.text");
    const problem = document.createElement("p");
    problem.setAttribute("role", "alert");
    problem.style.gridColumn = "1 / -1";
    problem.style.margin = "0";
    problem.hidden = true;
    const actions = document.createElement("div");
    actions.style.gridColumn = "1 / -1";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    const done = (applied: boolean) => {
      if (!applied) return;
      popover?.close();
      engine.focus();
    };
    if (current) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rich-strip-swatch-none";
      remove.textContent = t("rich.link.remove");
      life.listen(remove, "click", () => done(engine.apply(setLink(null), false)));
      actions.append(remove);
    }
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.className = "rich-strip-swatch-none";
    apply.textContent = t("rich.link.apply");
    actions.append(apply);
    form.append(problem, actions);
    life.listen(form, "submit", (event) => {
      event.preventDefault();
      const href = address.value.trim();
      if (href === "") {
        done(current ? engine.apply(setLink(null), false) : true);
        return;
      }
      const applied = engine.apply(setLink(href, typing ? text.value : undefined), false);
      problem.textContent = t("rich.link.invalid");
      problem.hidden = applied;
      done(applied);
    });
    popover = openPopover({
      anchor,
      content: form,
      label: t("rich.link"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
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

  /// La spaziatura del paragrafo: interlinea, rientri e spazi prima e dopo,
  /// in punti. Un campo vuoto segue lo stile.
  function openSpacing(anchor: HTMLButtonElement): void {
    popover?.close();
    const form = document.createElement("div");
    form.className = "rich-strip-swatches";
    form.style.display = "grid";
    form.style.gridTemplateColumns = "auto 96px";
    form.style.alignItems = "center";
    const field = (control: HTMLElement, label: string) => {
      control.id = `${prefix}-spacing-${form.childElementCount}`;
      control.classList.add("rich-strip-select");
      const caption = document.createElement("label");
      caption.htmlFor = control.id;
      caption.textContent = label;
      form.append(caption, control);
    };
    const line = document.createElement("select");
    const current = engine.read((state) => selectedLayout(state, "line"));
    const shown = current && "multiple" in current ? String(current.multiple) : current ? "other" : current === undefined ? "" : "mixed";
    const values = ["", ...LINE_SPACINGS.map(String), ...(shown === "other" || shown === "mixed" ? [shown] : [])];
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent =
        value === "" ? t("rich.spacing.style") : value === "other" ? t("rich.spacing.other") : value === "mixed" ? "" : value;
      line.append(option);
    }
    line.value = shown;
    life.listen(line, "change", () => {
      if (line.value === "other" || line.value === "mixed") return;
      engine.apply(setLineSpacing(line.value === "" ? null : Number(line.value)), false);
    });
    field(line, t("rich.spacing.line"));
    for (const key of LAYOUT_LENGTHS) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      if (key !== "first") input.min = "0";
      input.placeholder = t("rich.spacing.style");
      const value = engine.read((state) => selectedLayout(state, key));
      input.value = typeof value === "number" ? String(value) : "";
      life.listen(input, "change", () => {
        const n = input.value.trim() === "" ? null : Number(input.value);
        if (n !== null && !Number.isFinite(n)) return;
        engine.apply(setLayout({ [key]: n } as { [K in LayoutLength]?: number | null }), false);
      });
      field(input, t(`rich.spacing.${key}` as Key));
    }
    popover = openPopover({
      anchor,
      content: form,
      label: t("rich.spacing"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
  }

  function openColors(anchor: HTMLButtonElement, kind: "color" | "highlight"): void {
    popover?.close();
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
    popover = openPopover({
      anchor,
      content: grid,
      label: t(kind === "color" ? "rich.color" : "rich.highlight"),
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
      },
    });
    anchor.setAttribute("aria-expanded", "true");
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
    const fonts = [...new Set([...COMMON_FONTS, ...engine.fonts(), ...(look.font ? [look.font] : [])])].sort((a, b) =>
      a.localeCompare(b),
    );
    options(font, fonts, look.font, (v) => v);
    const sizes = [...new Set([...FONT_SIZES, ...(look.size !== null ? [look.size] : [])])].sort((a, b) => a - b);
    options(size, sizes.map(String), look.size === null ? null : String(look.size), (v) => v);
    for (const { spec, control } of toggleButtons) {
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
