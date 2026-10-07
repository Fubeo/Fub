// I campi del pannello delle proprietà (livello Standard): che cosa mostra,
// della selezione o del documento, coi nomi, le unità e i limiti. L'editor
// raccoglie ciò che serve e scrive i cambi; qui c'è come ciò che raccoglie
// diventa campi, e come un valore scritto torna un cambio.
//
// - **Posizione e misure come la cornice.** X e Y sono l'angolo in alto a
//   sinistra della cornice, anche di un oggetto ruotato; larghezza e altezza
//   le misure lungo i suoi lati, contorno compreso, quelle che la cornice
//   dice mentre la si tira; la rotazione è l'angolo del suo lato in alto. Più
//   oggetti hanno il riquadro comune, finché non ruotano insieme.
// - **Le lunghezze nell'unità del documento**, coi decimali dei campi dei
//   righelli. Lo spessore e il corpo del testo sono in punti, come nei
//   programmi di disegno e di impaginazione, e in pixel in un documento in
//   pixel.
// - **Un lato che non scala**, come quello di una linea dritta, si vede e
//   non si scrive; e un lato non scende sotto la misura a cui lo riducono i
//   tasti, se non lo era già.
// - **Ciò che il livello non offre non c'è**: i colori a piacere, gli estremi
//   e gli angoli del contorno, «Disponi», «Trasforma», la griglia, le guide e
//   i righelli. Il tratteggio c'è dallo Standard, accanto allo spessore.
// - **La forma dei poligoni, delle stelle e dei rettangoli**: il tipo, i
//   lati o le punte, il raggio interno di una stella e il raggio degli
//   angoli, nella scena come la larghezza (`reshape.ts`).
// - **Senza selezione, il disegno**: la pagina, l'unità, la descrizione, e
//   come si vede il foglio. Il titolo resta nella barra. Con lo strumento
//   Poligono, prima, la forma che disegna.

import { apply } from "../scene/matrix";
import { MAX_COUNT, MIN_COUNT, type PolygonalShape } from "../scene/parametric";
import { UNITS, type LengthUnit } from "../scene/rulers";
import { t, type DrawKey } from "../strings";
import type { Axis, Edge, Order } from "./arrange";
import { angleOf, frameSize, MIN_SIZE, scales, type Frame } from "./frame";
import type { Grid } from "./grid";
import { ANCHORS, type Anchor, type Look, type LookChange } from "./look";
import { CAPS, DASHES, JOINS, type Cap, type Dash, type Join, type OutlineChange, type OutlineLook } from "./outline";
import {
  ACTION_LABELS,
  type ActionId,
  type ActionState,
  type ChoiceOption,
  type FieldId,
  type FieldState,
  type NumberState,
  type PropertiesView,
} from "./properties";
import { ANGLE_UNITS, lengthUnits, PERCENT_UNITS } from "./quantity";
import type { Feature } from "./registry";
import type { PaintSample } from "./resources";
import type { ShapeChange, ShapeFacts } from "./reshape";
import { FIELD_PLACES, fieldMin, fromUnit, toUnit } from "./rulers";
import { MIN_RATIO } from "./shapes";
import { TEXT_FAMILIES, TEXT_SIZE } from "./text";
import { MAX_SCALE_PERCENT, MAX_SKEW } from "./transform";

/// Il nome di ogni unità, come lo dicono i menu e il pannello.
export const UNIT_NAMES: Readonly<Record<LengthUnit, DrawKey>> = {
  px: "draw.unit.px",
  mm: "draw.unit.mm",
  cm: "draw.unit.cm",
  in: "draw.unit.in",
  pt: "draw.unit.pt",
};

/// I nomi dei tratteggi, degli estremi e degli angoli del contorno.
export const DASH_LABELS: Readonly<Record<Dash, DrawKey>> = {
  solid: "draw.outline.solid",
  dashed: "draw.outline.dashed",
  dotted: "draw.outline.dotted",
  dashdot: "draw.outline.dashdot",
};

export const CAP_LABELS: Readonly<Record<Cap, DrawKey>> = {
  butt: "draw.outline.butt",
  round: "draw.outline.round_cap",
  square: "draw.outline.square",
};

export const JOIN_LABELS: Readonly<Record<Join, DrawKey>> = {
  miter: "draw.outline.miter",
  round: "draw.outline.round_join",
  bevel: "draw.outline.bevel",
};

/// I nomi dell'allineamento del testo, e le loro icone.
const ANCHOR_LABELS: Readonly<Record<Anchor, DrawKey>> = {
  start: "draw.properties.anchor.start",
  middle: "draw.properties.anchor.middle",
  end: "draw.properties.anchor.end",
};

/// Gli stili del testo, dal più grande: il corpo, in unità della scena, e il
/// peso insieme. «Testo» è il corpo di un testo nuovo, e gli altri stanno
/// sulle misure della barra.
export const TEXT_PRESETS: ReadonlyArray<{ readonly id: string; readonly size: number; readonly weight: number; readonly label: DrawKey }> = [
  { id: "title", size: 64, weight: 700, label: "draw.properties.preset.title" },
  { id: "subtitle", size: 48, weight: 600, label: "draw.properties.preset.subtitle" },
  { id: "heading", size: 40, weight: 600, label: "draw.properties.preset.heading" },
  { id: "body", size: TEXT_SIZE, weight: 400, label: "draw.properties.preset.body" },
  { id: "caption", size: 24, weight: 400, label: "draw.properties.preset.caption" },
];

/// I pesi del menu, coi loro nomi: quelli che i caratteri di Fub hanno.
const WEIGHTS: ReadonlyArray<{ readonly value: number; readonly label: DrawKey }> = [
  { value: 300, label: "draw.properties.weight.light" },
  { value: 400, label: "draw.properties.weight.normal" },
  { value: 500, label: "draw.properties.weight.medium" },
  { value: 600, label: "draw.properties.weight.semibold" },
  { value: 700, label: "draw.properties.weight.bold" },
  { value: 800, label: "draw.properties.weight.extrabold" },
  { value: 900, label: "draw.properties.weight.black" },
];

/// Gli interruttori di «Enfasi», coi nomi, che sono anche quelli del passo
/// di annulla; le icone sono `draw-text-…`.
const EMPHASES: Readonly<Record<"bold" | "italic" | "underline" | "strike", DrawKey>> = {
  bold: "draw.text.bold",
  italic: "draw.text.italic",
  underline: "draw.text.underline",
  strike: "draw.text.strike",
};

const EMPHASIS_IDS = Object.keys(EMPHASES) as Array<keyof typeof EMPHASES>;

/// Da quale peso un testo è in grassetto, per l'interruttore.
const BOLD = 600;

/// I tipi di forma di un poligono, coi nomi e le icone degli strumenti.
const SHAPE_KINDS: ReadonlyArray<{ readonly value: PolygonalShape; readonly label: DrawKey; readonly icon: string }> = [
  { value: "polygon", label: "draw.tool.polygon", icon: "draw-polygon" },
  { value: "star", label: "draw.tool.star", icon: "draw-star" },
];

/// Il nome del passo di annulla di ogni campo di «Forma».
export const SHAPE_ACTIONS: Readonly<Partial<Record<FieldId, DrawKey>>> = {
  shape: "draw.action.shape_kind",
  count: "draw.action.count",
  inner: "draw.action.inner",
  corner: "draw.action.corner",
};

/// Che cosa fa un comando di «Disponi».
export type ActionCommand =
  | { readonly kind: "align"; readonly edge: Edge }
  | { readonly kind: "distribute"; readonly axis: Axis }
  | { readonly kind: "order"; readonly order: Order };

export const ACTION_COMMANDS: Readonly<Record<ActionId, ActionCommand>> = {
  "align-left": { kind: "align", edge: "left" },
  "align-center": { kind: "align", edge: "center" },
  "align-right": { kind: "align", edge: "right" },
  "align-top": { kind: "align", edge: "top" },
  "align-middle": { kind: "align", edge: "middle" },
  "align-bottom": { kind: "align", edge: "bottom" },
  "distribute-x": { kind: "distribute", axis: "x" },
  "distribute-y": { kind: "distribute", axis: "y" },
  "order-front": { kind: "order", order: "front" },
  "order-forward": { kind: "order", order: "forward" },
  "order-backward": { kind: "order", order: "backward" },
  "order-back": { kind: "order", order: "back" },
};

/// Il nome del passo di annulla di ogni campo dell'aspetto.
export const LOOK_ACTIONS: Readonly<Partial<Record<FieldId, DrawKey>>> = {
  fill: "draw.action.fill",
  stroke: "draw.action.outline_color",
  strokeWidth: "draw.action.stroke_width",
  opacity: "draw.action.opacity",
  preset: "draw.action.text_style",
  family: "draw.action.font",
  size: "draw.action.font_size",
  weight: "draw.action.font_weight",
  leading: "draw.action.leading",
  spacing: "draw.action.letter_spacing",
  anchor: "draw.action.text_align",
};

/// Il nome del passo di annulla del campo dell'aspetto `id` scritto con
/// `value`: per «Enfasi», quello dell'interruttore.
export function lookAction(id: FieldId, value: number | string | boolean): DrawKey | null {
  if (id !== "emphasis") return LOOK_ACTIONS[id] ?? null;
  const which = EMPHASIS_IDS.find((each) => typeof value === "string" && value.startsWith(`${each}:`));
  return which === undefined ? null : EMPHASES[which];
}

/// L'unità dello spessore e del corpo del testo: i punti, tranne in un
/// documento in pixel.
export function lookUnit(unit: LengthUnit): LengthUnit {
  return unit === "px" ? "px" : "pt";
}

/// La selezione, come la legge l'editor.
export interface SelectionFacts {
  /// Le chiavi degli oggetti scelti, una per riga.
  readonly keys: string;
  /// Che cosa è scelto, a parole: «Rettangolo», «3 oggetti».
  readonly subject: string;
  readonly count: number;
  /// La cornice; `null` se gli oggetti scelti non disegnano niente.
  readonly frame: Frame | null;
  /// Il lucchetto delle proporzioni.
  readonly ratio: boolean;
  readonly look: Look;
  /// Il contorno dei contorni scelti; `null` se non ce ne sono.
  readonly outline: OutlineLook | null;
  /// Vero se c'è a che cosa allinearli: la pagina, per un oggetto solo.
  readonly alignable: boolean;
  /// Gli oggetti scelti che disegnano qualcosa: quelli che si distribuiscono.
  readonly drawn: number;
  /// Gli spostamenti nell'ordine che cambierebbero qualcosa.
  readonly orders: ReadonlySet<Order>;
  /// I poligoni, le stelle e i rettangoli scelti; `null` se non ce ne sono.
  readonly shape: ShapeFacts | null;
}

/// Il disegno, quando non c'è niente di scelto.
export interface DocumentFacts {
  /// La pagina, in unità della scena; `null` se il disegno non ne ha.
  readonly page: { readonly width: number; readonly height: number } | null;
  readonly desc: string;
}

export interface FieldsInput {
  /// Le parti che il livello offre.
  readonly features: ReadonlySet<Feature>;
  /// L'unità del documento.
  readonly unit: LengthUnit;
  readonly editable: boolean;
  /// La selezione; `null` se non c'è niente di scelto.
  readonly selection: SelectionFacts | null;
  readonly document: DocumentFacts;
  readonly grid: Grid;
  /// Vero se c'è la barra della selezione, che si può affiancare.
  readonly bar: boolean;
  /// Vero se il pannello ospita gli attributi.
  readonly attributes: boolean;
  /// La forma che disegna lo strumento Poligono, se è lo strumento di
  /// adesso: senza selezione il pannello la mostra.
  readonly tool: ShapeFacts | null;
}

/// Un campo di una lunghezza, `value` in unità della scena, mostrata in
/// `unit`.
const lengthField = (label: string, value: number, unit: LengthUnit, relative: boolean, extra: Partial<NumberState> = {}): NumberState => ({
  kind: "number",
  label,
  value: toUnit(value, unit),
  unit,
  units: lengthUnits(unit),
  relative,
  places: FIELD_PLACES[unit],
  ...extra,
});

/// Un campo in gradi.
const degreesField = (label: string, value: number | null, extra: Partial<NumberState> = {}): NumberState => ({
  kind: "number",
  label,
  value,
  unit: "°",
  units: ANGLE_UNITS,
  relative: false,
  places: 2,
  ...extra,
});

/// I campi di «Forma» di `facts`, con le lunghezze in `unit`; `note` sotto il
/// primo.
function shapeFields(fields: Partial<Record<FieldId, FieldState>>, facts: ShapeFacts, unit: LengthUnit, note: string | null): void {
  const noted = note === null ? {} : { note };
  if (facts.shape.count > 0) {
    fields.shape = {
      kind: "segment",
      label: t("draw.properties.shape_kind"),
      value: facts.shape.value,
      options: SHAPE_KINDS.map((kind) => ({ value: kind.value, label: t(kind.label), icon: kind.icon })),
      ...noted,
    };
    const counted = facts.shape.value === "star" ? "draw.properties.points" : facts.shape.value === "polygon" ? "draw.properties.sides" : "draw.properties.count";
    fields.count = { kind: "number", label: t(counted), value: facts.count.value, unit: "", units: {}, relative: false, places: 0, min: MIN_COUNT, max: MAX_COUNT };
  }
  if (facts.ratio.count > 0) {
    fields.inner = {
      kind: "number",
      label: t("draw.properties.inner"),
      value: facts.ratio.value === null ? null : facts.ratio.value * 100,
      unit: "%",
      units: PERCENT_UNITS,
      relative: false,
      places: 1,
      min: MIN_RATIO * 100,
      max: 100,
    };
  }
  if (facts.corner.count > 0) {
    fields.corner = {
      kind: "number",
      label: t("draw.properties.corner"),
      value: facts.corner.value === null ? null : toUnit(facts.corner.value, unit),
      unit,
      units: lengthUnits(unit),
      relative: true,
      places: FIELD_PLACES[unit],
      min: 0,
      ...(facts.shape.count > 0 ? {} : noted),
    };
  }
}

/// Il nome di un carattere: la famiglia prima del ripiego.
const familyName = (family: string): string => family.split(",")[0]!.trim();

/// Ciò che il pannello mostra.
export function propertiesView(input: FieldsInput): PropertiesView {
  const { selection, unit } = input;
  const has = (feature: Feature): boolean => input.features.has(feature);
  const fields: Partial<Record<FieldId, FieldState>> = {};
  const actions: Partial<Record<ActionId, ActionState>> = {};

  if (selection !== null) {
    // --- Posizione e misure ---
    const frame = selection.frame;
    if (frame !== null) {
      const [x, y] = apply(frame.matrix, frame.box.min);
      const size = frameSize(frame);
      fields.x = lengthField("X", x, unit, false);
      fields.y = lengthField("Y", y, unit, false);
      const side = (axis: 0 | 1, label: DrawKey): NumberState =>
        lengthField(t(label), size[axis], unit, true, {
          min: fieldMin(Math.min(size[axis], MIN_SIZE), unit),
          ...(scales(frame, axis) ? {} : { disabled: true }),
        });
      fields.width = side(0, "draw.field.width");
      fields.height = side(1, "draw.field.height");
      fields.ratio = { kind: "press", label: t("draw.properties.ratio"), on: selection.ratio, ...(scales(frame, 0) && scales(frame, 1) ? {} : { disabled: true }) };
      fields.rotation = degreesField(t("draw.properties.rotation"), angleOf(frame.matrix));
    }

    // --- Forma, con lo strumento che la disegna ---
    if (has("polygon") && selection.shape !== null) shapeFields(fields, selection.shape, unit, null);

    // --- Aspetto ---
    const { look, outline } = selection;
    const thin = lookUnit(unit);
    const sampled = (value: string | null): { sample?: PaintSample } => {
      const sample = value === null ? undefined : look.samples.get(value);
      return sample === undefined ? {} : { sample };
    };
    if (has("colors") && look.fill.count > 0) fields.fill = { kind: "paint", label: t("draw.properties.fill"), value: look.fill.value, ...sampled(look.fill.value) };
    if (has("colors") && look.stroke.count > 0) fields.stroke = { kind: "paint", label: t("draw.properties.stroke"), value: look.stroke.value, ...sampled(look.stroke.value) };
    if (look.width.count > 0) {
      fields.strokeWidth = {
        kind: "number",
        label: t("draw.properties.stroke_width"),
        value: look.width.value === null ? null : toUnit(look.width.value, thin),
        unit: thin,
        units: lengthUnits(thin),
        relative: true,
        places: FIELD_PLACES[thin],
        min: 0,
      };
    }
    if (look.opacity.count > 0) {
      fields.opacity = {
        kind: "number",
        label: t("draw.properties.opacity"),
        value: look.opacity.value === null ? null : look.opacity.value * 100,
        unit: "%",
        units: PERCENT_UNITS,
        relative: false,
        places: 0,
        min: 0,
        max: 100,
      };
    }
    if (outline !== null) {
      const dashes: ChoiceOption[] = DASHES.map((dash) => ({ value: dash, label: t(DASH_LABELS[dash]) }));
      // Un tratteggio che non è del menu c'è, col suo valore.
      if (outline.dash === "custom") dashes.push({ value: "custom", label: t("draw.outline.custom", { value: outline.custom ?? "" }) });
      if (outline.dashable) fields.dash = { kind: "choice", label: t("draw.properties.dash"), value: outline.dash, options: dashes };
      if (has("outline")) {
        fields.cap = { kind: "choice", label: t("draw.properties.cap"), value: outline.cap, options: CAPS.map((cap) => ({ value: cap, label: t(CAP_LABELS[cap]) })) };
        fields.join = { kind: "choice", label: t("draw.properties.join"), value: outline.join, options: JOINS.map((join) => ({ value: join, label: t(JOIN_LABELS[join]) })) };
      }
    }

    // --- Testo ---
    if (look.size.count > 0) {
      const { size, weight } = look;
      const preset = size.value === null || weight.value === null ? undefined : TEXT_PRESETS.find((each) => Math.abs(each.size - size.value!) < 1e-6 && each.weight === weight.value);
      const presets: ChoiceOption[] = TEXT_PRESETS.map((each) => ({ value: each.id, label: t(each.label) }));
      // Un testo che non è di nessuno stile è su misura; uno misto non è
      // nessuno dei due.
      const mixed = size.value === null || weight.value === null;
      if (!mixed && preset === undefined) presets.push({ value: "custom", label: t("draw.properties.preset.custom") });
      fields.preset = { kind: "choice", label: t("draw.properties.preset"), value: mixed ? null : (preset?.id ?? "custom"), options: presets };
    }
    if (look.family.count > 0) {
      const families: ChoiceOption[] = TEXT_FAMILIES.map((family) => ({ value: family, label: familyName(family) }));
      const current = look.family.value;
      // Un carattere che non è dei tre c'è, col suo nome; uno che nessuno
      // scrive è quello di serie.
      if (current === "") families.unshift({ value: "", label: t("draw.properties.family.default") });
      else if (current !== null && !TEXT_FAMILIES.includes(current)) families.push({ value: current, label: familyName(current) || current });
      fields.family = { kind: "choice", label: t("draw.properties.family"), value: current, options: families };
    }
    if (look.size.count > 0) {
      fields.size = {
        kind: "number",
        label: t("draw.properties.size"),
        value: look.size.value === null ? null : toUnit(look.size.value, thin),
        unit: thin,
        units: lengthUnits(thin),
        relative: true,
        places: FIELD_PLACES[thin],
        min: fieldMin(Math.min(look.size.value ?? MIN_SIZE, MIN_SIZE), thin),
      };
    }
    if (look.weight.count > 0) {
      const weights: ChoiceOption[] = WEIGHTS.map((each) => ({ value: String(each.value), label: t(each.label) }));
      const current = look.weight.value;
      // Un peso che non è del menu c'è, col suo numero.
      if (current !== null && !WEIGHTS.some((each) => each.value === current)) {
        weights.push({ value: String(current), label: String(current) });
        weights.sort((a, b) => Number(a.value) - Number(b.value));
      }
      fields.weight = { kind: "choice", label: t("draw.properties.weight"), value: current === null ? null : String(current), options: weights };
      const lit: Record<keyof typeof EMPHASES, boolean | null> = {
        bold: current === null ? null : current >= BOLD,
        italic: look.italic.value,
        underline: look.underline.value,
        strike: look.strike.value,
      };
      fields.emphasis = {
        kind: "toggles",
        label: t("draw.properties.emphasis"),
        options: EMPHASIS_IDS.map((which) => ({ value: which, label: t(EMPHASES[which]), icon: `draw-text-${which}`, on: lit[which] })),
      };
    }
    // L'interlinea c'è se un testo scelto ha più righe.
    if (look.leading.count > 0) {
      const leading = look.leading.value === null ? null : look.leading.value * 100;
      fields.leading = { kind: "number", label: t("draw.properties.leading"), value: leading, unit: "%", units: PERCENT_UNITS, relative: true, places: 0, min: Math.min(leading ?? 50, 50) };
    }
    if (look.spacing.count > 0) {
      const spacing = look.spacing.value === null ? null : look.spacing.value * 100;
      fields.spacing = { kind: "number", label: t("draw.properties.spacing"), value: spacing, unit: "%", units: PERCENT_UNITS, relative: true, places: 1, min: Math.min(spacing ?? -50, -50) };
    }
    if (look.anchor.count > 0) {
      fields.anchor = {
        kind: "segment",
        label: t("draw.properties.anchor"),
        value: look.anchor.value,
        options: ANCHORS.map((anchor) => ({ value: anchor, label: t(ANCHOR_LABELS[anchor]), icon: `draw-anchor-${anchor}` })),
      };
    }

    // --- Disponi ---
    if (has("arrange")) {
      for (const [id, command] of Object.entries(ACTION_COMMANDS) as Array<[ActionId, ActionCommand]>) {
        const label = t(ACTION_LABELS[id]);
        if (command.kind === "align") {
          actions[id] = {
            label: selection.count === 1 ? t("draw.align.to_page", { action: label }) : label,
            ...(selection.alignable ? {} : { disabled: true }),
          };
        } else if (command.kind === "distribute") {
          actions[id] = selection.drawn < 3 ? { label, disabled: true, note: t("draw.distribute.few") } : { label };
        } else {
          actions[id] = selection.orders.has(command.order) ? { label } : { label, disabled: true };
        }
      }
    }

    // --- Trasforma ---
    if (has("transform")) {
      const percent = (label: DrawKey): NumberState => ({
        kind: "number",
        label: t(label),
        value: 100,
        unit: "%",
        units: PERCENT_UNITS,
        relative: false,
        places: 2,
        min: -MAX_SCALE_PERCENT,
        max: MAX_SCALE_PERCENT,
      });
      fields.turn = degreesField(t("draw.properties.turn"), 0);
      fields.scaleX = percent("draw.properties.scale_x");
      fields.scaleY = percent("draw.properties.scale_y");
      fields.skewX = degreesField(t("draw.properties.skew_x"), 0, { min: -MAX_SKEW, max: MAX_SKEW });
      fields.skewY = degreesField(t("draw.properties.skew_y"), 0, { min: -MAX_SKEW, max: MAX_SKEW });
    }
  } else {
    // --- Forma, dello strumento ---
    if (input.tool !== null) shapeFields(fields, input.tool, unit, t("draw.properties.shape_tool"));

    // --- Documento ---
    const { page, desc } = input.document;
    if (page !== null) {
      const min = fieldMin(1, unit);
      fields.pageWidth = lengthField(t("draw.field.page_width"), page.width, unit, true, { min });
      fields.pageHeight = lengthField(t("draw.field.page_height"), page.height, unit, true, { min });
    }
    fields.unit = { kind: "choice", label: t("draw.properties.unit"), value: unit, options: UNITS.map((each) => ({ value: each, label: t(UNIT_NAMES[each]) })) };
    fields.desc = { kind: "text", label: t("draw.field.desc"), value: desc };

    // --- Vista ---
    const { grid } = input;
    if (has("grid")) {
      fields.grid = { kind: "switch", label: t("draw.grid.show"), on: grid.shown };
      fields.snap = { kind: "switch", label: t("draw.grid.snap"), on: grid.snap };
    }
    if (has("guides")) fields.guides = { kind: "switch", label: t("draw.feature.guides"), on: grid.guides };
    if (has("rulers")) {
      fields.rulers = { kind: "switch", label: t("draw.rulers.show"), on: grid.rulers };
      fields.rulerGuides = { kind: "switch", label: t("draw.rulers.guides.show"), on: grid.rulerGuides };
    }
    if (input.bar) fields.bar = { kind: "switch", label: t("draw.bar.beside"), on: grid.bar };
  }

  return {
    // Un'unità nuova lascia cadere i valori scritti a metà, come una
    // selezione nuova.
    key: selection === null ? `document\n${unit}${input.tool === null ? "" : `\n${input.tool.shape.value}`}` : `selection\n${unit}\n${selection.keys}`,
    subject: selection === null ? t("draw.properties.drawing") : selection.subject,
    editable: input.editable,
    fields,
    actions,
    attributes: selection !== null && input.attributes,
  };
}

/// Il cambio dell'aspetto che scrive il campo `id` col valore `value`, nelle
/// unità del documento `unit`; `null` se il campo non è dell'aspetto, o il
/// valore non è suo.
export function lookChange(id: FieldId, value: number | string | boolean, unit: LengthUnit): LookChange | null {
  switch (id) {
    case "fill":
      return typeof value === "string" ? { fill: value } : null;
    case "stroke":
      return typeof value === "string" ? { stroke: value } : null;
    case "strokeWidth":
      return typeof value === "number" ? { width: fromUnit(value, lookUnit(unit)) } : null;
    case "opacity":
      return typeof value === "number" ? { opacity: value / 100 } : null;
    case "family":
      return typeof value === "string" && value !== "" ? { family: value } : null;
    case "size":
      return typeof value === "number" ? { size: fromUnit(value, lookUnit(unit)) } : null;
    case "preset": {
      const preset = TEXT_PRESETS.find((each) => each.id === value);
      return preset === undefined ? null : { preset: { size: preset.size, weight: preset.weight } };
    }
    case "weight": {
      const weight = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
      return weight >= 1 && weight <= 1000 ? { weight } : null;
    }
    case "emphasis": {
      const [which, on] = typeof value === "string" ? value.split(":") : [];
      if (on !== "true" && on !== "false") return null;
      const lit = on === "true";
      if (which === "bold") return { weight: lit ? 700 : 400 };
      if (which === "italic") return { italic: lit };
      if (which === "underline") return { underline: lit };
      return which === "strike" ? { strike: lit } : null;
    }
    case "leading":
      return typeof value === "number" && value > 0 ? { leading: value / 100 } : null;
    case "spacing":
      return typeof value === "number" ? { spacing: value / 100 } : null;
    case "anchor":
      return (ANCHORS as readonly unknown[]).includes(value) ? { anchor: value as Anchor } : null;
    default:
      return null;
  }
}

/// Il cambio di «Forma» che scrive il campo `id` col valore `value`, con le
/// lunghezze in `unit`; `null` se il campo non è della forma, o il valore non
/// è suo.
export function shapeChange(id: FieldId, value: number | string | boolean, unit: LengthUnit): ShapeChange | null {
  switch (id) {
    case "shape":
      return value === "polygon" || value === "star" ? { shape: value } : null;
    case "count":
      return typeof value === "number" ? { count: value } : null;
    case "inner":
      return typeof value === "number" ? { ratio: value / 100 } : null;
    case "corner":
      return typeof value === "number" ? { corner: fromUnit(value, unit) } : null;
    default:
      return null;
  }
}

/// Il cambio del contorno che scrive il campo `id` col valore `value`;
/// `null` se il campo non è del contorno, o il valore non è suo.
export function outlineChange(id: FieldId, value: number | string | boolean): OutlineChange | null {
  if (id === "dash" && (DASHES as readonly unknown[]).includes(value)) return { dash: value as Dash };
  if (id === "cap" && (CAPS as readonly unknown[]).includes(value)) return { cap: value as Cap };
  if (id === "join" && (JOINS as readonly unknown[]).includes(value)) return { join: value as Join };
  return null;
}
