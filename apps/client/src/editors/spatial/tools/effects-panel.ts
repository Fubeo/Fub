// Gli effetti degli oggetti scelti, come sezione del pannello delle
// proprietà (livello Esperto): l'elenco delle ombre, dei bagliori e della
// sfocatura in ordine di disegno, e i campi dell'effetto aperto. Come
// l'Aspetto di Illustrator e gli Effetti di Figma. Che cosa mostrare, e ogni
// cambio, li decide l'editor, con [`effectsOps`]; qui c'è come si vede, si
// scrive e si raggiunge.
//
// - **Una riga per effetto:** l'occhio che lo mostra o lo nasconde (premuto
//   se si vede, e figura diversa se no, così lo stato non sta nel solo
//   colore), il nome, che apre e chiude i suoi campi e dice, chiuso, i
//   valori in breve, e il pulsante che lo toglie. Una riga sola è aperta
//   alla volta, e resta aperta finché la selezione è la stessa; un effetto
//   nuovo si apre.
// - **I campi si scrivono come gli altri del pannello**: i numeri si
//   calcolano (`quantity.ts`), su e giù li cambiano di 1, con Maiusc di 10, e
//   partono subito, e i passi che si seguono hanno il nome dell'effetto,
//   perché la cronologia li unisca; Invio o lasciare il campo scrive, Esc
//   riporta com'era e, di nuovo, torna al foglio. Un valore che non va
//   resta scritto e segnato, col messaggio accanto. Le lunghezze sono
//   nell'unità dello spessore del contorno. Il colore è un codice, un nome o
//   il nome di un campione, che si copia: un effetto non resta legato a un
//   campione.
// - **Più oggetti con gli stessi effetti** li mostrano e li cambiano
//   insieme. Con effetti diversi la sezione lo dice, e offre di darli tutti
//   uguali, quelli del primo oggetto che ne ha, o di toglierli; «Aggiungi
//   effetto» aggiunge a ciascuno, in fondo alla sua lista.
// - **Un filtro di un altro programma** si vede e si toglie; un effetto
//   nuovo lo sostituisce. Un ritaglio o una maschera, o parti che non si
//   leggono, dicono perché non si danno effetti.
// - **Il fuoco resta sul controllo usato**: le righe si aggiornano sul
//   posto. Tolta una riga, va al nome della seguente, o della precedente, o
//   a «Aggiungi effetto». Un effetto aggiunto dalla tastiera prende il
//   fuoco, perché si scriva subito; col puntatore il fuoco resta dov'era.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import type { DocumentModel, ElementPart } from "../scene/model";
import type { LengthUnit } from "../scene/rulers";
import { t, type DrawKey } from "../strings";
import {
  defaultEffect,
  EFFECT_KINDS,
  effectsRefusal,
  effectsStates,
  MAX_EFFECTS,
  MAX_OFFSET,
  MAX_SPREAD,
  writeEffects,
  type Effect,
  type EffectKind,
  type EffectsChange,
  type EffectsState,
} from "./effects";
import type { Measure } from "./measure";
import { customColor } from "./palette";
import { evaluate, lengthUnits, PERCENT_UNITS, type QuantityProblem } from "./quantity";
import { FIELD_PLACES, fromUnit, toUnit } from "./rulers";

/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-effect-add": ["M12 5v14", "M5 12h14"],
  "draw-effect-remove": ["M5 12h14"],
  "draw-effect-shown": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  "draw-effect-hidden": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M4 4l16 16"],
  "draw-effect-chevron": ["M8 10l4 4 4-4"],
};

/// Oltre questo numero di oggetti scelti non si chiede a ciascuno se prende
/// gli effetti: la misura di un gruppo o di un testo costa, e mille oggetti
/// si leggono entro un fotogramma. Il rifiuto arriva allora con il cambio.
const REFUSAL_LIMIT = 64;

const PROBLEMS: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

const KIND_NAMES: Readonly<Record<EffectKind, DrawKey>> = {
  shadow: "draw.effects.kind.shadow",
  "inner-shadow": "draw.effects.kind.inner-shadow",
  glow: "draw.effects.kind.glow",
  "inner-glow": "draw.effects.kind.inner-glow",
  blur: "draw.effects.kind.blur",
};

/// I nomi dei passi della cronologia, per genere di effetto. Un cambio di
/// campo prende il nome dell'effetto: i passi che si seguono, con lo stesso
/// nome, si uniscono.
const ADD_ACTIONS: Readonly<Record<EffectKind, DrawKey>> = {
  shadow: "draw.action.effect_add.shadow",
  "inner-shadow": "draw.action.effect_add.inner-shadow",
  glow: "draw.action.effect_add.glow",
  "inner-glow": "draw.action.effect_add.inner-glow",
  blur: "draw.action.effect_add.blur",
};
const REMOVE_ACTIONS: Readonly<Record<EffectKind, DrawKey>> = {
  shadow: "draw.action.effect_remove.shadow",
  "inner-shadow": "draw.action.effect_remove.inner-shadow",
  glow: "draw.action.effect_remove.glow",
  "inner-glow": "draw.action.effect_remove.inner-glow",
  blur: "draw.action.effect_remove.blur",
};
const SHOW_ACTIONS: Readonly<Record<EffectKind, DrawKey>> = {
  shadow: "draw.action.effect_show.shadow",
  "inner-shadow": "draw.action.effect_show.inner-shadow",
  glow: "draw.action.effect_show.glow",
  "inner-glow": "draw.action.effect_show.inner-glow",
  blur: "draw.action.effect_show.blur",
};
const HIDE_ACTIONS: Readonly<Record<EffectKind, DrawKey>> = {
  shadow: "draw.action.effect_hide.shadow",
  "inner-shadow": "draw.action.effect_hide.inner-shadow",
  glow: "draw.action.effect_hide.glow",
  "inner-glow": "draw.action.effect_hide.inner-glow",
  blur: "draw.action.effect_hide.blur",
};

/// Perché non si danno effetti, a parole.
const REFUSALS = {
  clipped: "draw.effects.refused.clipped",
  unknown: "draw.effects.refused.unknown",
} as const;

// ---------------------------------------------------------------------------
// I campi di un effetto.
// ---------------------------------------------------------------------------

type FieldId = "dx" | "dy" | "blur" | "size" | "radius" | "color" | "opacity";

interface FieldSpec {
  readonly id: FieldId;
  readonly label: DrawKey;
  /// Come si scrive: una lunghezza, una percentuale o un colore.
  readonly kind: "length" | "percent" | "color";
  /// Dove sta nella griglia della riga: una colonna di due, o tutta.
  readonly column: "1" | "2" | "all";
  /// I limiti, in unità della scena per le lunghezze e in percentuale per
  /// l'opacità.
  readonly min?: number;
  readonly max?: number;
}

const FIELD_SPECS: Readonly<Record<FieldId, FieldSpec>> = {
  dx: { id: "dx", label: "draw.effects.field.dx", kind: "length", column: "1", min: -MAX_OFFSET, max: MAX_OFFSET },
  dy: { id: "dy", label: "draw.effects.field.dy", kind: "length", column: "2", min: -MAX_OFFSET, max: MAX_OFFSET },
  blur: { id: "blur", label: "draw.effects.field.blur", kind: "length", column: "1", min: 0, max: MAX_SPREAD },
  size: { id: "size", label: "draw.effects.field.size", kind: "length", column: "1", min: 0, max: MAX_SPREAD },
  radius: { id: "radius", label: "draw.effects.field.radius", kind: "length", column: "1", min: 0, max: MAX_SPREAD },
  opacity: { id: "opacity", label: "draw.effects.field.opacity", kind: "percent", column: "2", min: 0, max: 100 },
  color: { id: "color", label: "draw.effects.field.color", kind: "color", column: "all" },
};

/// I campi di ogni genere, nell'ordine in cui si vedono e si raggiungono col
/// Tab: la sfocatura e l'opacità dividono una riga, il colore ha la sua.
const KIND_FIELDS: Readonly<Record<EffectKind, readonly FieldId[]>> = {
  shadow: ["dx", "dy", "blur", "opacity", "color"],
  "inner-shadow": ["dx", "dy", "blur", "opacity", "color"],
  glow: ["size", "opacity", "color"],
  "inner-glow": ["size", "opacity", "color"],
  blur: ["radius"],
};

/// Il valore del campo `id` di `effect`: in unità della scena, in frazione o
/// come codice colore.
function read(effect: Effect, id: FieldId): number | string | undefined {
  return (effect as unknown as Readonly<Record<string, number | string | undefined>>)[id];
}

/// `effect` col campo `id` a `value`.
function written(effect: Effect, id: FieldId, value: number | string): Effect {
  return { ...effect, [id]: value } as Effect;
}

/// `value` ai centesimi, come lo scrive il file.
const hundredths = (value: number): number => Math.round(value * 100) / 100 || 0;

const clamp = (value: number, min: number | undefined, max: number | undefined): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/// L'opacità in percentuale, ai centesimi, come la mostra il campo.
const percentOf = (opacity: number): number => hundredths(opacity * 100);

/// La frazione di una percentuale, ai decimillesimi, come la scrive il file.
const fractionOf = (percent: number): number => Math.round(percent * 100) / 10000;

// ---------------------------------------------------------------------------
// Che cosa si mostra.
// ---------------------------------------------------------------------------

/// Gli effetti degli oggetti scelti: nessuno; gli stessi in tutti; diversi,
/// con quelli del primo che ne ha; o il filtro di un altro programma.
export type EffectsBody =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly effects: readonly Effect[] }
  | { readonly kind: "mixed"; readonly first: readonly Effect[] | null }
  | { readonly kind: "other" };

/// Un campione del documento, che il colore di un effetto copia per nome.
export interface EffectSwatch {
  readonly name: string;
  /// `#rrggbb` minuscolo.
  readonly color: string;
}

/// Ciò che la sezione mostra.
export interface EffectsPanelView {
  /// Che cosa si mostra: una chiave diversa lascia cadere i valori scritti
  /// a metà e chiude la riga aperta.
  readonly key: string;
  /// Quanti sono gli oggetti scelti.
  readonly count: number;
  readonly body: EffectsBody;
  /// Perché non si danno effetti agli oggetti scelti, se uno non li prende.
  readonly refusal: "clipped" | "unknown" | null;
  /// Vero se un oggetto ha già [`MAX_EFFECTS`] effetti, e se ha già una
  /// sfocatura: un effetto in più, o un'altra sfocatura, non ci sta.
  readonly full: boolean;
  readonly blurred: boolean;
  /// L'unità delle lunghezze, quella dello spessore del contorno.
  readonly unit: LengthUnit;
  readonly swatches: readonly EffectSwatch[];
}

export interface EffectsViewInput {
  readonly model: DocumentModel;
  /// Gli oggetti scelti, in ordine di selezione.
  readonly nodes: readonly ElementPart[];
  /// Come si misurano i testi, per sapere se un oggetto prende gli effetti.
  readonly measure: Measure;
  readonly key: string;
  readonly unit: LengthUnit;
  readonly swatches: readonly EffectSwatch[];
}

/// Come si distinguono due stati: gli effetti scritti come nel file, o la
/// parola del filtro d'altri, o niente.
function signatureOf(state: EffectsState): string {
  return state.kind === "none" ? "" : state.kind === "other" ? "\u0000other" : writeEffects(state.effects);
}

/// La sezione per gli oggetti `nodes`; `null` se non c'è, perché nessuno
/// prende effetti (livelli, carta, tavole). Gli stati si leggono tutti
/// insieme (`effectsStates`), e la domanda se un oggetto prende gli effetti
/// si fa soltanto a pochi oggetti, e si ferma al primo che dice di no.
export function effectsView(input: EffectsViewInput): EffectsPanelView | null {
  const { model, nodes } = input;
  if (nodes.length === 0) return null;
  let refusal: "clipped" | "unknown" | null = null;
  if (nodes.length <= REFUSAL_LIMIT) {
    for (const node of nodes) {
      const why = effectsRefusal(model, node, input.measure);
      if (why === null) continue;
      if (why === "kind") return null;
      refusal = why;
      break;
    }
  }
  const states = effectsStates(model, nodes);
  const first = signatureOf(states[0]!);
  let same = true;
  let full = false;
  let blurred = false;
  let firstWith: readonly Effect[] | null = null;
  for (const state of states) {
    if (same && signatureOf(state) !== first) same = false;
    if (state.kind !== "effects") continue;
    if (firstWith === null) firstWith = state.effects;
    if (state.effects.length >= MAX_EFFECTS) full = true;
    if (state.effects.some((effect) => effect.kind === "blur")) blurred = true;
  }
  let body: EffectsBody;
  if (!same) body = { kind: "mixed", first: firstWith };
  else if (states[0]!.kind === "effects") body = { kind: "list", effects: states[0]!.effects };
  else body = { kind: states[0]!.kind === "other" ? "other" : "none" };
  return { key: input.key, count: nodes.length, body, refusal, full, blurred, unit: input.unit, swatches: input.swatches };
}

// ---------------------------------------------------------------------------
// La sezione.
// ---------------------------------------------------------------------------

export interface EffectsPanelOptions {
  /// Dà `change` agli effetti degli oggetti scelti, col nome `label` nella
  /// cronologia. `null` se è fatto, altrimenti perché no.
  onChange(change: EffectsChange, label: DrawKey): string | null;
  /// Apre la sezione, se è chiusa: un effetto aggiunto si vede.
  reveal(): void;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

export interface EffectsPanel {
  /// Il corpo della sezione: le note, l'elenco e i comandi.
  readonly element: HTMLElement;
  /// «Aggiungi effetto», che sta nell'intestazione della sezione.
  readonly add: HTMLButtonElement;
  /// Mostra `view`; falso `editable` in sola lettura, dove gli effetti si
  /// guardano soltanto.
  update(view: EffectsPanelView, editable: boolean): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Un campo di una riga.
interface Field {
  readonly spec: FieldSpec;
  readonly root: HTMLElement;
  readonly label: HTMLLabelElement;
  /// Il nome, l'unità che si sente con lui, e quella che si vede accanto al
  /// numero.
  readonly name: HTMLElement;
  readonly spoken: HTMLElement;
  readonly unit: HTMLElement | null;
  readonly input: HTMLInputElement;
  /// Il selettore del sistema, per il colore.
  readonly picker: HTMLInputElement | null;
  /// Il testo scritto nel campo l'ultima volta: un campo che dice altro ha
  /// un valore scritto a metà.
  shown: string;
}

/// Una riga dell'elenco.
interface Row {
  readonly root: HTMLElement;
  readonly show: HTMLButtonElement;
  readonly name: HTMLButtonElement;
  readonly chip: HTMLElement;
  readonly title: HTMLElement;
  readonly summary: HTMLElement;
  readonly spoken: HTMLElement;
  readonly remove: HTMLButtonElement;
  readonly fields: HTMLElement;
  readonly error: HTMLElement;
  /// Il genere per cui i campi sono fatti.
  kind: EffectKind | null;
  inputs: Field[];
  /// Quale figura ha l'occhio: `true` l'occhio aperto.
  eye: boolean | null;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createEffectsPanel(life: Lifetime, options: EffectsPanelOptions): EffectsPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-effects";

  let view: EffectsPanelView = { key: "", count: 0, body: { kind: "none" }, refusal: null, full: false, blurred: false, unit: "pt", swatches: [] };
  let editable = false;
  /// La riga aperta, per posto; `null` nessuna.
  let open: number | null = null;
  /// Vero mentre un cambio è in corso: la selezione può prendere un'altra
  /// chiave (un oggetto che riceve un id), ma è la stessa.
  let carry = false;
  /// Vero mentre le righe si ridisegnano: un campo che se ne va non scrive.
  let painting = false;
  /// Il selettore del sistema mostra un colore non ancora scelto.
  let picking: Field | null = null;
  let formats: { language: string; byPlaces: Map<number, Intl.NumberFormat> } | null = null;

  /// `value` con al più `places` decimali, senza separatore delle migliaia,
  /// che un campo non rilegge.
  const numberText = (value: number, places: number): string => {
    const language = resolvedLanguage();
    if (formats?.language !== language) formats = { language, byPlaces: new Map() };
    let format = formats.byPlaces.get(places);
    if (format === undefined) {
      format = new Intl.NumberFormat(language, { maximumFractionDigits: places, useGrouping: false });
      formats.byPlaces.set(places, format);
    }
    const factor = 10 ** places;
    return format.format(Math.round(value * factor) / factor || 0);
  };

  /// Una lunghezza della scena, nell'unità del disegno.
  const lengthText = (value: number): string => numberText(toUnit(value, view.unit), FIELD_PLACES[view.unit]);

  /// Il testo con cui il campo `spec` mostra il valore `value` di un effetto.
  const textOf = (spec: FieldSpec, value: number | string | undefined): string => {
    if (value === undefined) return "";
    if (spec.kind === "color") return String(value);
    if (spec.kind === "percent") return numberText(percentOf(value as number), 2);
    return lengthText(value as number);
  };

  /// Il valore del campo come lo dice il testo, nell'unità del campo.
  const shownNumber = (spec: FieldSpec, value: number): number => (spec.kind === "percent" ? percentOf(value) : Number(lengthText(value)));

  const unitOf = (spec: FieldSpec): string => (spec.kind === "percent" ? "%" : spec.kind === "length" ? view.unit : "");

  // --- Le parti ---------------------------------------------------------------

  const state = document.createElement("p");
  state.className = "draw-effects-state";
  state.hidden = true;
  const note = document.createElement("p");
  note.className = "draw-properties-note";
  note.hidden = true;
  const list = document.createElement("div");
  list.className = "draw-effects-list";
  list.setAttribute("role", "list");
  list.hidden = true;
  const actions = document.createElement("div");
  actions.className = "draw-effects-actions";
  actions.hidden = true;
  const useButton = document.createElement("button");
  useButton.type = "button";
  useButton.className = "draw-button";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "draw-button";
  actions.append(useButton, clearButton);
  element.append(state, note, list, actions);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "draw-button draw-effects-add";
  add.id = identifier("draw-effects-add");
  add.setAttribute("aria-haspopup", "menu");
  add.setAttribute("aria-expanded", "false");
  const addGlyph = iconEl("draw-effect-add");
  if (addGlyph !== null) add.append(addGlyph);

  const rows: Row[] = [];

  /// Segna `button` come un gesto che adesso non si usa, che resta
  /// raggiungibile e dice perché.
  const offWhen = (button: HTMLElement, off: boolean): void => {
    if (off) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  };

  const readOnly = (): string => t("draw.rejected", { reason: t("draw.reason.read_only") });

  const effects = (): readonly Effect[] => (view.body.kind === "list" ? view.body.effects : []);

  // --- Le righe -----------------------------------------------------------------

  const glyphButton = (className: string, parent: HTMLElement): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    parent.append(button);
    return button;
  };

  const createRow = (): Row => {
    const root = document.createElement("div");
    root.className = "draw-effect";
    root.setAttribute("role", "listitem");
    const head = document.createElement("div");
    head.className = "draw-effect-head";
    const show = glyphButton("draw-effect-show", head);
    show.setAttribute("aria-pressed", "true");
    const name = glyphButton("draw-effect-name", head);
    name.setAttribute("aria-expanded", "false");
    const chip = document.createElement("span");
    chip.className = "draw-effect-chip";
    chip.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "draw-effect-title";
    title.id = identifier("draw-effect-title");
    const summary = document.createElement("span");
    summary.className = "draw-effect-summary";
    summary.setAttribute("aria-hidden", "true");
    const spoken = document.createElement("span");
    spoken.className = "sr-only";
    const chevron = iconEl("draw-effect-chevron");
    name.append(chip, title, summary, spoken);
    if (chevron !== null) name.append(chevron);
    const remove = glyphButton("draw-effect-remove", head);
    const removeGlyph = iconEl("draw-effect-remove");
    if (removeGlyph !== null) remove.append(removeGlyph);
    const fields = document.createElement("div");
    fields.className = "draw-effect-fields";
    fields.id = identifier("draw-effect-fields");
    fields.setAttribute("role", "group");
    fields.hidden = true;
    name.setAttribute("aria-controls", fields.id);
    const error = document.createElement("p");
    error.className = "draw-properties-error";
    error.id = identifier("draw-effect-error");
    error.hidden = true;
    root.append(head, fields);
    list.append(root);
    return { root, show, name, chip, title, summary, spoken, remove, fields, error, kind: null, inputs: [], eye: null };
  };

  /// Un campo di `spec`, nella griglia di `row`.
  const createField = (row: Row, spec: FieldSpec): Field => {
    const root = document.createElement("div");
    root.className = "draw-properties-field";
    root.dataset.column = spec.column;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "draw-properties-input";
    input.id = identifier("draw-effect-field");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.enterKeyHint = "done";
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = input.id;
    const name = document.createElement("span");
    const spoken = document.createElement("span");
    spoken.className = "sr-only";
    label.append(name, spoken);
    let unit: HTMLElement | null = null;
    let picker: HTMLInputElement | null = null;
    const box = document.createElement("div");
    if (spec.kind === "color") {
      box.className = "draw-properties-paint";
      picker = document.createElement("input");
      picker.type = "color";
      picker.className = "draw-properties-picker";
      box.append(input, picker);
    } else {
      input.setAttribute("role", "spinbutton");
      input.inputMode = "decimal";
      box.className = "draw-properties-number";
      unit = document.createElement("span");
      unit.className = "draw-properties-unit";
      unit.setAttribute("aria-hidden", "true");
      box.append(input, unit);
    }
    root.append(label, box);
    row.fields.append(root);
    return { spec, root, label, name, spoken, unit, input, picker, shown: "" };
  };

  /// Rifà i campi di `row` per il genere `kind`.
  const buildFields = (row: Row, kind: EffectKind): void => {
    row.fields.replaceChildren();
    row.inputs = KIND_FIELDS[kind].map((id) => createField(row, FIELD_SPECS[id]));
    row.fields.append(row.error);
    row.kind = kind;
  };

  const showError = (row: Row, field: Field | null, text: string | null): void => {
    row.error.hidden = text === null;
    setText(row.error, text ?? "");
    for (const each of row.inputs) {
      if (text !== null && each === field) {
        each.input.setAttribute("aria-invalid", "true");
        each.input.setAttribute("aria-describedby", row.error.id);
      } else {
        each.input.removeAttribute("aria-invalid");
        each.input.removeAttribute("aria-describedby");
      }
    }
  };

  /// Mostra `text` in `field`, a meno che non vi si stia scrivendo; con
  /// `fresh` anche allora.
  const showField = (row: Row, field: Field, text: string, fresh: boolean): void => {
    const editing = document.activeElement === field.input && field.input.value !== field.shown;
    field.shown = text;
    if (editing && !fresh) return;
    field.input.value = text;
    if (field.input.getAttribute("aria-invalid") === "true") showError(row, null, null);
  };

  /// Il riassunto di `effect` a parole brevi, e quello che si sente.
  const summaryOf = (effect: Effect): { readonly short: string; readonly spoken: string } => {
    switch (effect.kind) {
      case "shadow":
      case "inner-shadow": {
        const values = { x: lengthText(effect.dx), y: lengthText(effect.dy), blur: lengthText(effect.blur), opacity: numberText(percentOf(effect.opacity), 2) };
        return { short: t("draw.effects.summary.shadow", values), spoken: t("draw.effects.spoken.shadow", values) };
      }
      case "glow":
      case "inner-glow": {
        const values = { size: lengthText(effect.size), opacity: numberText(percentOf(effect.opacity), 2) };
        return { short: t("draw.effects.summary.glow", values), spoken: t("draw.effects.spoken.glow", values) };
      }
      case "blur": {
        const values = { radius: lengthText(effect.radius) };
        return { short: t("draw.effects.summary.blur", values), spoken: t("draw.effects.spoken.blur", values) };
      }
    }
  };

  const paintRow = (row: Row, index: number, effect: Effect, fresh: boolean): void => {
    if (row.kind !== effect.kind) {
      buildFields(row, effect.kind);
      fresh = true;
    }
    const name = t(KIND_NAMES[effect.kind]);
    const isOpen = open === index;
    row.root.toggleAttribute("data-hidden", effect.hidden);
    row.root.toggleAttribute("data-open", isOpen);
    row.root.dataset.kind = effect.kind;
    setText(row.title, name);
    const { short, spoken } = summaryOf(effect);
    setText(row.summary, short);
    setText(row.spoken, `, ${spoken}`);
    row.summary.hidden = isOpen;
    row.spoken.hidden = isOpen;
    row.name.setAttribute("aria-expanded", String(isOpen));
    row.fields.hidden = !isOpen;
    row.fields.setAttribute("aria-label", t("draw.effects.fields", { name }));
    const color = read(effect, "color");
    row.chip.hidden = color === undefined;
    if (color !== undefined) row.chip.style.setProperty("--effect-color", String(color));
    // Il nome dell'occhio resta lo stesso, e lo stato lo dice `aria-pressed`;
    // il suggerimento dice che cosa farebbe.
    row.show.setAttribute("aria-pressed", String(!effect.hidden));
    row.show.setAttribute("aria-label", t("draw.effects.show", { name }));
    row.show.title = t(effect.hidden ? "draw.effects.show" : "draw.effects.hide", { name });
    offWhen(row.show, !editable);
    if (row.eye !== !effect.hidden) {
      row.eye = !effect.hidden;
      const glyph = iconEl(row.eye ? "draw-effect-shown" : "draw-effect-hidden");
      row.show.replaceChildren(...(glyph === null ? [] : [glyph]));
    }
    const removeName = t("draw.effects.remove", { name });
    row.remove.setAttribute("aria-label", removeName);
    row.remove.title = removeName;
    offWhen(row.remove, !editable);
    for (const field of row.inputs) {
      const { spec } = field;
      const value = read(effect, spec.id);
      setText(field.name, t(spec.label));
      const unit = unitOf(spec);
      setText(field.spoken, unit === "" ? "" : ` (${unit})`);
      if (field.unit !== null) setText(field.unit, unit);
      showField(row, field, textOf(spec, value), fresh);
      field.input.readOnly = !editable;
      if (spec.kind === "color") {
        if (field.picker !== null) {
          field.picker.setAttribute("aria-label", t("draw.properties.picker", { label: t(spec.label) }));
          field.picker.disabled = !editable;
          if (picking !== field) field.picker.value = String(value);
        }
      } else {
        const shown = shownNumber(spec, value as number);
        field.input.setAttribute("aria-valuenow", String(shown));
        field.input.setAttribute("aria-valuetext", `${field.shown} ${unit}`);
        if (spec.kind === "percent") {
          field.input.setAttribute("aria-valuemin", "0");
          field.input.setAttribute("aria-valuemax", "100");
        } else {
          field.input.setAttribute("aria-valuemin", String(Number(lengthText(spec.min ?? 0))));
          field.input.setAttribute("aria-valuemax", String(Number(lengthText(spec.max ?? 0))));
        }
      }
    }
  };

  // --- Mostrare -----------------------------------------------------------------

  let lastKey = "";

  function paint(fresh = false): void {
    painting = true;
    try {
      const body = view.body;
      const notes: string[] = [];
      let headline = "";
      let clear: string | null = null;
      if (body.kind === "none" && view.refusal === null) notes.push(t("draw.effects.none"));
      else if (body.kind === "mixed") {
        headline = t("draw.effects.mixed");
        notes.push(body.first === null ? t("draw.effects.mixed.none") : t("draw.effects.mixed.first", { names: body.first.map((effect) => t(KIND_NAMES[effect.kind])).join(", ") }));
        clear = t("draw.effects.mixed.clear");
      } else if (body.kind === "other") {
        headline = t("draw.effects.other");
        notes.push(t("draw.effects.other.note"));
        clear = t("draw.effects.other.clear");
      }
      if (view.refusal !== null) notes.push(t(REFUSALS[view.refusal]));
      state.hidden = headline === "";
      setText(state, headline);
      note.hidden = notes.length === 0;
      setText(note, notes.join(" "));
      useButton.hidden = body.kind !== "mixed";
      setText(useButton, t("draw.effects.mixed.all"));
      offWhen(useButton, !editable || (body.kind === "mixed" && body.first === null));
      clearButton.hidden = clear === null;
      setText(clearButton, clear ?? t("draw.effects.mixed.clear"));
      offWhen(clearButton, !editable);
      actions.hidden = clear === null;

      const shown = effects();
      if (body.kind !== "list") open = null;
      else if (open !== null && open >= shown.length) open = null;
      list.hidden = shown.length === 0;
      list.setAttribute("aria-label", t("draw.properties.effects"));
      while (rows.length < shown.length) rows.push(createRow());
      while (rows.length > shown.length) rows.pop()!.root.remove();
      shown.forEach((effect, index) => paintRow(rows[index]!, index, effect, fresh));

      const addName = t("draw.effects.add");
      add.setAttribute("aria-label", addName);
      add.title = addName;
      offWhen(add, !editable || view.refusal !== null);
    } finally {
      painting = false;
    }
  }

  // --- Gli effetti sul disegno ----------------------------------------------------

  /// Manda `change` all'editor, col nome `label`; la riga aperta diventa
  /// `next`. `null` se è fatto, altrimenti perché no, già detto a voce se
  /// `loud`.
  const send = (change: EffectsChange, label: DrawKey, next: number | null, loud = true): string | null => {
    if (!editable) {
      if (loud) options.announce(readOnly());
      return readOnly();
    }
    const before = open;
    open = next;
    carry = true;
    let failure: string | null;
    try {
      failure = options.onChange(change, label);
    } finally {
      carry = false;
    }
    if (failure === null) return null;
    open = before;
    if (loud) options.announce(failure);
    return failure;
  };

  const toggleHidden = (index: number): void => {
    const effect = effects()[index];
    if (effect === undefined) return;
    const next = { ...effect, hidden: !effect.hidden } as Effect;
    const name = t(KIND_NAMES[effect.kind]);
    if (send({ kind: "set", effects: effects().map((each, at) => (at === index ? next : each)) }, (next.hidden ? HIDE_ACTIONS : SHOW_ACTIONS)[effect.kind], open) === null) {
      options.announce(t(next.hidden ? "draw.effects.hidden" : "draw.effects.shown", { name }));
    }
  };

  const removeEffect = (index: number): void => {
    const effect = effects()[index];
    const row = rows[index];
    if (effect === undefined || row === undefined) return;
    const focused = row.root.contains(document.activeElement);
    const left = effects().filter((_, at) => at !== index);
    const next = open === null || open === index ? null : open > index ? open - 1 : open;
    if (send({ kind: "set", effects: left }, REMOVE_ACTIONS[effect.kind], next) !== null) return;
    options.announce(t("draw.effects.removed", { name: t(KIND_NAMES[effect.kind]) }));
    if (!focused) return;
    // Il fuoco va alla riga che prende il posto, o alla precedente, o al
    // comando che ne aggiunge.
    (rows[index]?.name ?? rows[index - 1]?.name ?? add).focus({ preventScroll: true });
  };

  const addEffect = (kind: EffectKind, focus: boolean): void => {
    options.reveal();
    const index = view.body.kind === "list" ? view.body.effects.length : view.body.kind === "mixed" ? null : 0;
    if (send({ kind: "add", effect: defaultEffect(kind) }, ADD_ACTIONS[kind], index) !== null) return;
    options.announce(t("draw.effects.added", { name: t(KIND_NAMES[kind]) }));
    if (focus && index !== null) rows[index]?.name.focus({ preventScroll: true });
    if (index !== null) rows[index]?.root.scrollIntoView?.({ block: "nearest" });
  };

  const useForAll = (): void => {
    if (view.body.kind !== "mixed" || view.body.first === null) return;
    if (send({ kind: "set", effects: view.body.first }, "draw.action.effects_all", null) === null) {
      options.announce(t("draw.effects.applied", { count: String(view.count) }));
    }
  };

  const clearAll = (): void => {
    const filter = view.body.kind === "other";
    if (send({ kind: "clear" }, filter ? "draw.action.filter_clear" : "draw.action.effects_clear", null) === null) {
      options.announce(t(filter ? "draw.effects.filter_cleared" : "draw.effects.cleared"));
    }
  };

  // --- Scrivere i campi -------------------------------------------------------------

  /// Il campo di cui `target` è il controllo, con la sua riga.
  const locate = (target: EventTarget | null): { readonly row: Row; readonly index: number; readonly field: Field } | null => {
    if (!(target instanceof Node)) return null;
    const index = rows.findIndex((row) => row.root.contains(target));
    const row = rows[index];
    if (row === undefined) return null;
    const field = row.inputs.find((each) => each.input === target || each.picker === target);
    return field === undefined ? null : { row, index, field };
  };

  const fail = (row: Row, field: Field, text: string, loud: boolean): false => {
    showError(row, field, text);
    if (loud) options.announce(text);
    return false;
  };

  /// Il colore scritto: un codice, un nome, o un campione del documento per
  /// nome, senza badare alle maiuscole; `null` se non è un colore.
  const colorOf = (text: string): string | null => {
    const name = text.trim().toLocaleLowerCase();
    const swatch = name === "" ? undefined : view.swatches.find((each) => each.name.toLocaleLowerCase() === name);
    return swatch?.color ?? customColor(text);
  };

  /// Il valore scritto in `field`, per il disegno, o il messaggio di che cosa
  /// non va. `current` è il valore di adesso dell'effetto.
  const valueOf = (field: Field, text: string, current: number | string): { readonly value: number | string } | { readonly problem: string } => {
    const { spec } = field;
    if (spec.kind === "color") {
      const code = colorOf(text);
      return code === null ? { problem: t("draw.effects.problem.color") } : { value: code };
    }
    const units = spec.kind === "percent" ? PERCENT_UNITS : lengthUnits(view.unit);
    const out = evaluate(text, { units, current: shownNumber(spec, current as number), relative: spec.kind === "length" });
    if ("problem" in out) return { problem: t(PROBLEMS[out.problem], { units: Object.keys(units).join(", ") }) };
    if (spec.kind === "percent") return { value: fractionOf(clamp(hundredths(out.value), spec.min, spec.max)) };
    return { value: clamp(hundredths(fromUnit(out.value, view.unit)), spec.min, spec.max) };
  };

  /// Scrive `value` in `field` dell'effetto `index`, col campo che dice già
  /// il testo nuovo. Falso, e il campo resta com'era scritto, se il disegno
  /// non lo accetta.
  const commitValue = (row: Row, index: number, field: Field, value: number | string, loud: boolean): boolean => {
    const effect = effects()[index];
    if (effect === undefined) return true;
    const draft = field.input.value;
    const before = field.shown;
    // Il campo dice già il valore nuovo: l'aggiornamento che arriva mentre
    // l'editor lo scrive non lo prende per un valore scritto a metà.
    field.input.value = field.shown = textOf(field.spec, value);
    showError(row, null, null);
    const next = written(effect, field.spec.id, value);
    const failure = send({ kind: "set", effects: effects().map((each, at) => (at === index ? next : each)) }, KIND_NAMES[effect.kind], open, false);
    if (failure === null) return true;
    field.shown = before;
    field.input.value = draft;
    return fail(row, field, failure, loud);
  };

  const commit = (at: { readonly row: Row; readonly index: number; readonly field: Field }, loud: boolean): boolean => {
    const { row, index, field } = at;
    const effect = effects()[index];
    if (effect === undefined || !editable || field.input.value === field.shown) return true;
    const current = read(effect, field.spec.id)!;
    const out = valueOf(field, field.input.value, current);
    if ("problem" in out) return fail(row, field, out.problem, loud);
    if (out.value === current) {
      field.input.value = field.shown;
      showError(row, null, null);
      return true;
    }
    return commitValue(row, index, field, out.value, loud);
  };

  /// Su e giù: il valore di adesso, o quello scritto, cambia di `delta` e
  /// parte.
  const step = (at: { readonly row: Row; readonly index: number; readonly field: Field }, delta: number): void => {
    const { row, index, field } = at;
    const effect = effects()[index];
    if (effect === undefined) return;
    if (!editable) return options.announce(readOnly());
    const { spec } = field;
    const current = read(effect, spec.id) as number;
    let base = shownNumber(spec, current);
    if (field.input.value !== field.shown && field.input.value.trim() !== "") {
      const typed = valueOf(field, field.input.value, current);
      if ("problem" in typed) {
        fail(row, field, typed.problem, true);
        return;
      }
      base = shownNumber(spec, typed.value as number);
    }
    // I limiti sono della scena: si passano per l'unità del campo.
    const shown = base + delta;
    const value =
      spec.kind === "percent"
        ? fractionOf(clamp(hundredths(shown), spec.min, spec.max))
        : clamp(hundredths(fromUnit(shown, view.unit)), spec.min, spec.max);
    if (value === current) {
      field.input.value = field.shown;
      return;
    }
    commitValue(row, index, field, value, true);
  };

  // --- I gesti ------------------------------------------------------------------

  /// L'indice della riga di cui `target` è un controllo dell'intestazione.
  const headOf = (target: EventTarget | null, selector: string): number => {
    const button = target instanceof Element ? target.closest(selector) : null;
    return button === null ? -1 : rows.findIndex((row) => row.root.contains(button));
  };

  life.listen(element, "click", (event) => {
    const target = event.target;
    let index = headOf(target, ".draw-effect-show");
    if (index >= 0) return toggleHidden(index);
    index = headOf(target, ".draw-effect-remove");
    if (index >= 0) return removeEffect(index);
    index = headOf(target, ".draw-effect-name");
    if (index >= 0) {
      open = open === index ? null : index;
      paint();
    }
  });

  life.listen(useButton, "click", () => {
    if (!editable) return options.announce(readOnly());
    useForAll();
  });
  life.listen(clearButton, "click", () => {
    if (!editable) return options.announce(readOnly());
    clearAll();
  });

  /// Le voci di «Aggiungi effetto»: ciascuna dice, se non si può, perché.
  const menuItems = (focus: boolean): MenuItem[] =>
    EFFECT_KINDS.map((kind): MenuItem => {
      const why = !editable
        ? readOnly()
        : view.refusal !== null
          ? t(REFUSALS[view.refusal])
          : view.full
            ? t("draw.effects.full", { max: String(MAX_EFFECTS) })
            : kind === "blur" && view.blurred
              ? t("draw.effects.full.blur")
              : null;
      return {
        label: t(KIND_NAMES[kind]),
        ...(why === null ? {} : { disabled: true, description: why }),
        run: () => addEffect(kind, focus),
      };
    });

  const openMenu = (): void => {
    const keyboard = document.activeElement === add;
    add.setAttribute("aria-expanded", "true");
    showContextMenu(add, menuItems(keyboard), { labelledBy: add.id, onClose: () => add.setAttribute("aria-expanded", "false") });
  };
  life.listen(add, "click", openMenu);
  life.listen(add, "keydown", (event) => {
    if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });

  life.listen(element, "keydown", (event) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const at = locate(event.target);
    if (at !== null) {
      const { row, field } = at;
      if (event.key === "Escape" && plain && !event.shiftKey) {
        // Senza niente da annullare, Esc torna al foglio, come negli altri
        // campi.
        if (field.input.value === field.shown) return;
        field.input.value = field.shown;
        showError(row, null, null);
        if (field.picker !== null) field.picker.value = customColor(field.shown) ?? field.picker.value;
      } else if (event.key === "Enter" && plain && !event.shiftKey && event.target === field.input) {
        commit(at, true);
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain && field.spec.kind !== "color" && event.target === field.input) {
        step(at, (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Sulle intestazioni delle righe: le frecce passano da un nome all'altro,
    // Canc toglie l'effetto.
    const index = headOf(event.target, ".draw-effect-head button");
    if (index < 0 || !plain || event.shiftKey) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!editable) options.announce(readOnly());
      else removeEffect(index);
    } else if (event.target instanceof Element && event.target.closest(".draw-effect-name") !== null) {
      let to: number | null = null;
      if (event.key === "ArrowDown") to = Math.min(index + 1, rows.length - 1);
      else if (event.key === "ArrowUp") to = Math.max(index - 1, 0);
      else if (event.key === "Home") to = 0;
      else if (event.key === "End") to = rows.length - 1;
      if (to === null) return;
      rows[to]?.name.focus({ preventScroll: true });
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(element, "focusout", (event) => {
    if (painting) return;
    const at = locate(event.target);
    // Un campo che se n'è andato non scrive: il valore a metà era per ciò
    // che mostrava prima.
    if (at === null || at.row.fields.hidden || event.target === at.field.picker || !at.row.root.isConnected) return;
    commit(at, false);
  });

  // Il selettore del sistema: il campo mostra il colore mentre lo si muove,
  // e lo scrive quando lo si sceglie.
  life.listen(element, "input", (event) => {
    const at = locate(event.target);
    if (at === null || at.field.picker === null || event.target !== at.field.picker || !editable) return;
    picking = at.field;
    at.field.input.value = at.field.picker.value.toLowerCase();
    at.row.chip.style.setProperty("--effect-color", at.field.picker.value);
  });
  life.listen(element, "change", (event) => {
    const at = locate(event.target);
    if (at === null || at.field.picker === null || event.target !== at.field.picker) return;
    picking = null;
    if (!editable) return options.announce(readOnly());
    if (!commit(at, true)) paint();
  });
  life.listen(element, "focusin", (event) => {
    if (picking === null) return;
    const at = locate(event.target);
    if (at?.field === picking) return;
    // Il selettore si è chiuso senza scegliere: il campo torna al disegno.
    const field = picking;
    picking = null;
    field.input.value = field.shown;
    paint();
  });

  const relabel = (): void => {
    formats = null;
    paint(true);
  };
  relabel();

  return {
    element,
    add,
    update(next, nextEditable) {
      const focused = element.contains(document.activeElement);
      const fresh = next.key !== lastKey && !carry;
      if (fresh) open = null;
      lastKey = next.key;
      view = next;
      editable = nextEditable;
      paint(fresh);
      // Un fuoco che la riga lasciando ha perso resta nella sezione.
      if (focused && !element.contains(document.activeElement) && !element.hidden) add.focus({ preventScroll: true });
    },
    relabel,
  };
}
