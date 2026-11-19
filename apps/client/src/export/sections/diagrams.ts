// La sezione Diagrammi dello spazio «Esporta in PDF» (E28, T75; il prototipo
// `PXS` "diagrammi", passo 29).
//
// Dall'alto: i sei stili per l'esportazione (com'è nella nota, come il tema
// di stampa, i quattro stili con la carta), ognuno con la sua miniatura nei
// colori che disegnano davvero (`paletteFor`); passarci sopra lo mostra sulle
// pagine prima di sceglierlo. Sotto, la riga che dice a che cosa vale e, se
// qualche diagramma ha uno stile suo (il clic sulla pagina, T76), il
// collegamento che li toglie. Poi i quattro colori dati a mano (nodi,
// decisioni, inizio e fine, linee), ognuno con la sua tavolozza, un colore
// qualsiasi e il codice; infine il fondo del diagramma sì o no.
//
// Tutto finisce nel profilo (`diagrammi`, i colori `diagramma-*`): come si
// disegna lo decide `export/vectors.ts`. `%% stile:` nella nota non cambia.

import { plural, t, type Key } from "../../i18n/strings";
import { diagramStylePreference, type DiagramStyleId } from "../../theme/diagram-style";
import { iconEl } from "../../ui/icons";
import type { DiagramPalette } from "../../ui/mermaid-styles";
import type { ExportProfile } from "../profile";
import { DIAGRAM_COLOR_KEYS, diagramPrintLook, EXPORT_DIAGRAM_STYLES, exportDiagramStyle, type ExportDiagramStyle } from "../vectors";
import type { ExportSection, SectionContext } from "./index";

/// La tavolozza dei colori dati a mano: gli inchiostri del prototipo
/// (`PXPAL.i`), scuri abbastanza da reggere una scritta chiara sopra.
export const DIAGRAM_INKS = [
  "#000000", "#18231c", "#1b2430", "#006e46", "#1f4f8f", "#5a3a8a",
  "#8d2d63", "#b3261e", "#a4552a", "#8f4a00", "#6f5600", "#5d6962",
] as const;

const COLOR_NAMES: Readonly<Record<(typeof DIAGRAM_COLOR_KEYS)[number]["part"], Key>> = {
  nodes: "pdf_export.diagrams.color.nodes",
  decisions: "pdf_export.diagrams.color.decisions",
  ends: "pdf_export.diagrams.color.ends",
  lines: "pdf_export.diagrams.color.lines",
};

const HEX6 = /^#[0-9a-f]{6}$/iu;

/// Il nome di uno stile dell'esportazione, nei pulsanti.
export function exportDiagramStyleName(style: ExportDiagramStyle): string {
  if (style === "nota") return t("pdf_export.diagrams.style.nota");
  if (style === "tema") return t("pdf_export.diagrams.style.tema");
  return t(`mermaid.style.${style}` as Key);
}

/// Ciò che vale, per la testa della sezione chiusa.
export function diagramsSummary(profile: ExportProfile): string {
  const style = exportDiagramStyle(profile.diagrammi.stile);
  if (style === "nota") return t("pdf_export.diagrams.note");
  if (style === "tema") return t("pdf_export.diagrams.theme");
  return t(`mermaid.style.${style}` as Key);
}

// Le tavolozze arrivano con `mermaid-styles.ts`, che sta fuori dal ponte dei
// documenti: la prima volta le miniature si colorano appena arrivano.
type Styles = typeof import("../../ui/mermaid-styles");
let styles: Styles | null = null;
let loading: Promise<Styles> | null = null;
function loadStyles(): Promise<Styles> {
  return loading ??= import("../../ui/mermaid-styles").then((module) => (styles = module)).catch((error) => {
    loading = null;
    throw error;
  });
}

/// Quale riga dei colori è aperta: una alla volta, e resta aperta quando il
/// pannello si ridisegna.
let openColor: string | null = null;

/// La tavolozza che disegna uno stile sulla carta di stampa.
function swatchPalette(module: Styles, style: ExportDiagramStyle, profile: ExportProfile): DiagramPalette {
  const tokens = diagramPrintLook(profile).tokens;
  const base: DiagramStyleId = style === "tema" ? "armonia" : style === "nota" ? diagramStylePreference() : style;
  return module.paletteFor(base, "light", "normal", base === "armonia" ? (name) => tokens[name] ?? null : undefined);
}

function paintSwatch(swatch: HTMLElement, palette: DiagramPalette): void {
  const vars: Record<string, string> = {
    paper: palette.paper ?? palette.ground,
    node: palette.primary.fill,
    "node-border": palette.primary.border,
    choice: palette.secondary.fill,
    "choice-border": palette.secondary.border,
    pill: palette.tertiary.fill,
    "pill-border": palette.tertiary.border,
  };
  for (const [name, value] of Object.entries(vars)) swatch.style.setProperty(`--export-dg-${name}`, value);
}

function button(className: string, label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  if (label) element.textContent = label;
  return element;
}

function styleGrid(context: SectionContext): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "export-dg-styles";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("pdf_export.diagrams.styles"));
  const current = exportDiagramStyle(context.profile.diagrammi.stile);
  const swatches: [HTMLElement, ExportDiagramStyle][] = [];
  for (const style of EXPORT_DIAGRAM_STYLES) {
    const choice = button("export-dg-style", "");
    choice.id = `export-dg-style-${style}`;
    choice.dataset["dg"] = style;
    choice.setAttribute("aria-pressed", String(style === current));
    const swatch = document.createElement("span");
    swatch.className = "export-dg-swatch";
    swatch.dataset["s"] = style === "nota" || style === "tema" ? (style === "nota" ? diagramStylePreference() : "armonia") : style;
    swatch.setAttribute("aria-hidden", "true");
    for (const part of ["node", "choice", "pill"]) {
      const shape = document.createElement("i");
      shape.className = `export-dg-swatch-${part}`;
      swatch.append(shape);
    }
    const name = document.createElement("span");
    name.textContent = exportDiagramStyleName(style);
    choice.append(swatch, name);
    choice.addEventListener("click", () => {
      previewing = null;
      context.change(withStyle(base, style));
    });
    // Sopra uno stile, le pagine lo mostrano; uscendo dalla griglia tornano
    // allo stile scelto.
    choice.addEventListener("pointerenter", () => {
      if (previewing === style) return;
      previewing = style;
      context.change(withStyle(base, style), { live: true });
    });
    swatches.push([swatch, style]);
    grid.append(choice);
  }
  const base = context.profile;
  let previewing: ExportDiagramStyle | null = null;
  grid.addEventListener("pointerleave", () => {
    if (previewing === null) return;
    previewing = null;
    context.change(base, { live: true });
  });
  const paint = (module: Styles) => {
    for (const [swatch, style] of swatches) paintSwatch(swatch, swatchPalette(module, style, base));
  };
  if (styles) paint(styles);
  else void loadStyles().then(paint, () => undefined);
  return grid;
}

function withStyle(profile: ExportProfile, style: ExportDiagramStyle): ExportProfile {
  return { ...profile, diagrammi: { ...profile.diagrammi, stile: style } };
}

function withColor(profile: ExportProfile, key: string, value: string | null): ExportProfile {
  const colori = { ...profile.colori };
  if (value === null) delete colori[key];
  else colori[key] = value;
  return { ...profile, colori };
}

function scopeNote(context: SectionContext): HTMLElement {
  const note = document.createElement("p");
  note.className = "export-note";
  note.append(t("pdf_export.diagrams.scope"));
  const own = context.diagrams?.own ?? 0;
  if (own > 0) {
    const clear = button("export-link export-link-inline", plural(own, "pdf_export.diagrams.clear_own.one", "pdf_export.diagrams.clear_own.other"));
    clear.id = "export-dg-clear-own";
    clear.addEventListener("click", () => context.diagrams?.clearOwn());
    note.append(" ", clear);
  }
  return note;
}

function colorRow(context: SectionContext, key: string, name: string): HTMLElement {
  const value = context.profile.colori[key];
  const own = value !== undefined && HEX6.test(value);
  const open = openColor === key;
  const row = document.createElement("div");
  row.className = "export-dg-color";
  row.classList.toggle("is-open", open);
  row.dataset["hl"] = key;
  const head = button("export-dg-color-head", "");
  head.id = `export-dg-color-${key}`;
  head.setAttribute("aria-expanded", String(open));
  const chip = document.createElement("i");
  chip.className = "export-dg-chip";
  chip.classList.toggle("is-none", !own);
  if (own) chip.style.background = value;
  const label = document.createElement("span");
  label.textContent = name;
  const code = document.createElement("code");
  code.textContent = own ? value : t("pdf_export.diagrams.color.of_style");
  head.append(chip, label);
  if (own) {
    const mine = document.createElement("em");
    mine.textContent = t("pdf_export.diagrams.color.own");
    head.append(mine);
  }
  head.append(code);
  head.addEventListener("click", () => {
    openColor = open ? null : key;
    // Il pannello si rifà col fuoco su questa testa (per `id`).
    context.change(context.profile);
  });
  row.append(head);
  if (own) {
    const reset = button("export-dg-reset", "");
    reset.id = `export-dg-reset-${key}`;
    reset.setAttribute("aria-label", t("pdf_export.diagrams.color.reset"));
    reset.title = t("pdf_export.diagrams.color.reset");
    const svg = iconEl("history");
    if (svg) reset.append(svg);
    reset.addEventListener("click", () => context.change(withColor(context.profile, key, null)));
    row.append(reset);
  }
  if (!open) return row;
  const palette = document.createElement("div");
  palette.className = "export-dg-palette";
  // Un colore scritto dal vivo cambia le pagine e la riga, non il pannello.
  const showLive = (next: string) => {
    chip.classList.remove("is-none");
    chip.style.background = next;
    code.textContent = next;
  };
  for (const ink of DIAGRAM_INKS) {
    const pick = button("export-dg-ink", "");
    pick.id = `export-dg-ink-${key}-${ink.slice(1)}`;
    pick.style.background = ink;
    pick.setAttribute("aria-label", ink);
    pick.setAttribute("aria-pressed", String(own && value.toLowerCase() === ink));
    pick.addEventListener("click", () => context.change(withColor(context.profile, key, ink)));
    palette.append(pick);
  }
  const any = document.createElement("label");
  any.className = "export-dg-pick";
  any.title = t("pdf_export.diagrams.color.pick_title");
  const input = document.createElement("input");
  input.type = "color";
  input.value = own ? value.toLowerCase() : "#888888";
  input.setAttribute("aria-label", t("pdf_export.diagrams.color.pick", { name }));
  input.addEventListener("input", () => {
    showLive(input.value);
    hex.value = input.value;
    context.change(withColor(context.profile, key, input.value.toLowerCase()), { live: true });
  });
  input.addEventListener("change", () => context.change(withColor(context.profile, key, input.value.toLowerCase())));
  const svg = iconEl("export-color");
  any.append(input);
  if (svg) any.append(svg);
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "export-dg-hex";
  hex.value = own ? value : "";
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute("aria-label", t("pdf_export.diagrams.color.hex"));
  hex.addEventListener("input", () => {
    if (!HEX6.test(hex.value)) return;
    showLive(hex.value.toLowerCase());
    context.change(withColor(context.profile, key, hex.value.toLowerCase()), { live: true });
  });
  hex.addEventListener("change", () => {
    if (HEX6.test(hex.value)) context.change(withColor(context.profile, key, hex.value.toLowerCase()));
    else hex.value = own ? value : "";
  });
  palette.append(any, hex);
  row.append(palette);
  return row;
}

function paperToggle(context: SectionContext): HTMLElement {
  const on = context.profile.diagrammi.fondo;
  const toggle = button("export-dg-toggle", "");
  toggle.id = "export-dg-paper";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(on));
  const text = document.createElement("span");
  text.append(t("pdf_export.diagrams.paper"));
  const hint = document.createElement("small");
  hint.textContent = t("pdf_export.diagrams.paper.hint");
  text.append(hint);
  const knob = document.createElement("i");
  knob.setAttribute("aria-hidden", "true");
  toggle.append(text, knob);
  toggle.addEventListener("click", () => {
    const profile = context.profile;
    context.change({ ...profile, diagrammi: { ...profile.diagrammi, fondo: !profile.diagrammi.fondo } });
  });
  return toggle;
}

/// Il corpo della sezione. Il pannello non lo ridisegna a ogni cambio (rifà
/// solo le teste): si ridisegna da sé a gesto finito, col fuoco dov'era.
export function diagramsBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-dg";
  const local: SectionContext = {
    get profile() {
      return context.profile;
    },
    change(next, options) {
      context.change(next, options);
      if (!options?.live) redraw();
    },
    open: (id) => context.open(id),
    get diagrams() {
      return context.diagrams;
    },
  };
  const build = (): HTMLElement[] => {
    const colors = document.createElement("div");
    colors.className = "export-dg-colors";
    colors.setAttribute("role", "group");
    colors.setAttribute("aria-label", t("pdf_export.diagrams.colors"));
    for (const { key, part } of DIAGRAM_COLOR_KEYS) colors.append(colorRow(local, key, t(COLOR_NAMES[part])));
    const colorsNote = document.createElement("p");
    colorsNote.className = "export-note";
    colorsNote.textContent = t("pdf_export.diagrams.colors_note");
    return [styleGrid(local), scopeNote(local), colors, colorsNote, paperToggle(local)];
  };
  const redraw = () => {
    if (!body.isConnected) return;
    const active = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement.id : "";
    body.replaceChildren(...build());
    if (active) body.querySelector<HTMLElement>(`#${CSS.escape(active)}`)?.focus({ preventScroll: true });
  };
  body.append(...build());
  return body;
}

export const DIAGRAMS_SECTION: ExportSection = {
  id: "diagrammi",
  title: "pdf_export.section.diagrams",
  summary: diagramsSummary,
  body: diagramsBody,
};
