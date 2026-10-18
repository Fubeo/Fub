// La striscia del carattere della superficie ricca: tipo e dimensione del
// carattere, colori, sottolineato, apice e pedice, maiuscole, «Copia formato»;
// e del paragrafo: stile, allineamento, rientri, interlinea e spaziature.
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
import { onLanguage, t, type Key } from "../../i18n/strings";
import {
  FONT_SIZES,
  LINE_SPACINGS,
  selectedLayout,
  selectedStyle,
  setColor,
  setFont,
  setHighlight,
  setLayout,
  setLineSpacing,
  setSize,
  setStyle,
  type StylePick,
} from "./commands";
import type { RichEngine } from "./engine";
import { COLOR_AUTO, HIGHLIGHT_DEFAULT, LAYOUT_LENGTHS, type LayoutLength } from "./projection";

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

export function mountStrip(engine: RichEngine, chord: (id: string) => string | null): RichStrip {
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
