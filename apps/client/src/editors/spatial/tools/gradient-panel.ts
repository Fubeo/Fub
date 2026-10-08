// La sfumatura degli oggetti scelti, come sezione del pannello delle
// proprietà (livello Standard): il tipo, i punti su una barra, i campi del
// punto scelto, le sfumature pronte, l'angolo e, all'Esperto, come continua
// oltre i capi. Che cosa mostrare, e ogni cambio, li decide l'editor; qui
// c'è come si vede, si sceglie e si raggiunge.
//
// - **«Applica a» è quello dei colori del documento**: riempimento o
//   contorno, lo stesso nelle due sezioni.
// - **La barra mostra la sfumatura** su una scacchiera, che fa vedere la
//   trasparenza, coi punti sotto. Un clic sulla barra aggiunge un punto del
//   colore che si vede lì; un punto si trascina lungo la barra, e lontano
//   da lei si toglie, se ne restano almeno due. Mentre si trascina il
//   disegno lo mostra; lasciato, è un passo solo.
// - **Ogni punto è un cursore** (`role="slider"`) con un posto suo nel
//   Tab, come nei cursori a più capi: le frecce lo spostano dell'1%, con
//   Maiusc del 10%, Pagina su e giù del 10%, Inizio e Fine ai capi; Canc lo
//   toglie, Ins o + ne aggiunge uno a metà col seguente. Il punto col fuoco
//   è il punto scelto.
// - **I campi sono del punto scelto**: il colore, scritto o dal selettore
//   del sistema, che il disegno mostra mentre lo si muove; la posizione e
//   l'opacità, che si calcolano e si scrivono come gli altri campi del
//   pannello. Il punto scelto è lo stesso sulla barra e, con lo strumento
//   Sfumatura, sul foglio.
// - **Più oggetti con sfumature diverse** hanno il tipo, le sfumature
//   pronte, «Inverti» e l'angolo, che valgono per ciascuno coi suoi colori;
//   un colore pieno ha il tipo e le sfumature pronte, e una nota dice che
//   cosa ne nasce.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import { t, type DrawKey } from "../strings";
import {
  fadeOf,
  GRADIENT_PRESETS,
  movedStop,
  SPREADS,
  stopAt,
  withStop,
  type GradientChange,
  type GradientKind,
  type GradientPreset,
  type GradientStop,
  type GradientView,
  type Spread,
} from "./gradients";
import { customColor, swatchOf } from "./palette";
import { ANGLE_UNITS, evaluate, PERCENT_UNITS, type QuantityProblem } from "./quantity";
import type { PaintTarget } from "./swatches-panel";

/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-gradient-add": ["M12 5v14", "M5 12h14"],
  "draw-gradient-remove": ["M5 12h14"],
  "draw-gradient-reverse": ["M4 8h14", "M14 4l4 4-4 4", "M20 16H6", "M10 12l-4 4 4 4"],
  "draw-gradient-presets": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
};

/// Quanto lontano dalla barra, in pixel CSS, un punto trascinato si toglie.
const TEAR_PX = 32;

/// Di quanto il puntatore si sposta prima che un punto preso si muova.
const DRAG_PX = 3;

/// Quanto si sposta un punto con le frecce, e con Maiusc o Pagina su e giù.
const STEP = 0.01;
const BIG_STEP = 0.1;

const KINDS: readonly (GradientKind | "color")[] = ["color", "linear", "radial"];

const KIND_LABELS: Readonly<Record<GradientKind | "color", DrawKey>> = {
  color: "draw.gradient.kind.color",
  linear: "draw.gradient.kind.linear",
  radial: "draw.gradient.kind.radial",
};

const SPREAD_LABELS: Readonly<Record<Spread, DrawKey>> = {
  pad: "draw.gradient.spread.pad",
  reflect: "draw.gradient.spread.reflect",
  repeat: "draw.gradient.spread.repeat",
};

const PROBLEMS: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// Ciò che la sezione mostra.
export interface GradientPanelView {
  /// Che cosa si mostra: una chiave diversa lascia cadere i valori scritti
  /// a metà.
  readonly key: string;
  /// La sfumatura di ogni bersaglio che la selezione ha.
  readonly channels: Readonly<Partial<Record<PaintTarget, GradientView>>>;
  /// Il punto scelto della sfumatura comune; `null` per il primo.
  readonly stop: number | null;
  /// Vero al livello Esperto, dove c'è «Oltre i capi».
  readonly expert: boolean;
  /// I campioni del documento, che il colore di un punto scrive per nome.
  readonly swatches: readonly { readonly name: string; readonly color: string }[];
}

export interface GradientPanelOptions {
  /// Dà `change` alla sfumatura del bersaglio `target` della selezione, col
  /// nome `label` nella cronologia. `null` se è fatto, altrimenti perché no.
  onChange(target: PaintTarget, change: GradientChange, label: DrawKey): string | null;
  /// Mostra `change` sul disegno senza scriverlo; `null` toglie ciò che si
  /// mostrava.
  onPreview(target: PaintTarget, change: GradientChange | null): void;
  /// Il punto scelto cambia: `null` nessuno.
  onStop(index: number | null): void;
  /// «Applica a» cambia.
  onTarget(target: PaintTarget): void;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

export interface GradientPanel {
  /// La sezione: «Applica a», il tipo, la barra, i campi e i comandi.
  readonly element: HTMLElement;
  /// Mostra `view`; falso `editable` in sola lettura, dove la sfumatura si
  /// guarda soltanto.
  update(view: GradientPanelView, editable: boolean): void;
  /// Il bersaglio scelto in «Applica a», anche se la selezione di adesso
  /// non l'ha.
  target(): PaintTarget;
  /// Sceglie il bersaglio di «Applica a» senza dirlo all'editor: l'ha
  /// scelto l'altra sezione.
  setTarget(target: PaintTarget): void;
  /// Vero se la sezione mostra i punti di una sfumatura.
  hasStops(): boolean;
  /// Il fuoco al colore del punto scelto, col testo scelto perché lo si
  /// riscriva subito. Falso se la sezione non mostra punti.
  focusColor(): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Un campo che si scrive, col testo che mostra del disegno.
interface Field {
  readonly input: HTMLInputElement;
  readonly root: HTMLElement;
  readonly label: HTMLLabelElement;
  /// Dove dice che cosa non va.
  readonly error: HTMLElement;
  shown: string;
}

/// Un punto che si trascina.
interface Drag {
  readonly pointer: number;
  readonly index: number;
  readonly target: PaintTarget;
  /// I punti di quando è partito.
  readonly from: readonly GradientStop[];
  readonly startX: number;
  /// Dove sta adesso, da 0 a 1.
  at: number;
  /// Vero se è lontano dalla barra, e lasciato si toglie.
  torn: boolean;
  /// Vero se si è mosso.
  moved: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/// `value` al decimillesimo: una posizione come la scrive il file.
const fourth = (value: number): number => Math.round(value * 1e4) / 1e4;

/// Il colore di un punto per CSS: `#rrggbb`, o `#rrggbbaa` se è trasparente.
function cssColor(stop: { readonly color: string; readonly opacity: number }): string {
  if (stop.opacity >= 1) return stop.color;
  return `${stop.color}${Math.round(clamp01(stop.opacity) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/// La sfumatura di `stops` da sinistra a destra, per CSS.
export function stripImage(stops: readonly GradientStop[]): string {
  if (stops.length === 0) return "none";
  if (stops.length === 1) return `linear-gradient(to right, ${cssColor(stops[0]!)}, ${cssColor(stops[0]!)})`;
  return `linear-gradient(to right, ${stops.map((stop) => `${cssColor(stop)} ${fourth(stop.offset * 100)}%`).join(", ")})`;
}

/// Quattro colori lungo `stops`, per la striscia di una voce del menu.
const samples = (stops: readonly GradientStop[]): string[] => [0, 1 / 3, 2 / 3, 1].map((at) => cssColor(stopAt(stops, at)));

/// Vero se `a` e `b` sono gli stessi punti.
function sameStops(a: readonly GradientStop[], b: readonly GradientStop[]): boolean {
  return a.length === b.length && a.every((stop, at) => stop.color === b[at]!.color && Math.abs(stop.offset - b[at]!.offset) < 1e-4 && Math.abs(stop.opacity - b[at]!.opacity) < 1e-4);
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/// L'angolo `degrees` fra -180 escluso e 180, come lo dice il pannello.
function normalized(degrees: number): number {
  const turned = (((degrees + 180) % 360) + 360) % 360 - 180;
  return turned === -180 ? 180 : turned;
}

export function createGradientPanel(life: Lifetime, options: GradientPanelOptions): GradientPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-gradient";

  let view: GradientPanelView = { key: "", channels: {}, stop: null, expert: false, swatches: [] };
  let editable = false;
  /// Il bersaglio scelto in «Applica a», finché l'editor vive.
  let chosen: PaintTarget = "fill";
  let drag: Drag | null = null;
  /// Il punto della barra che prende il fuoco quando c'è.
  let refocus: number | null = null;
  /// Che cosa mostravano i campi del punto e l'angolo: un punto o una
  /// selezione diversi li riportano al disegno.
  let fieldsOf = "";
  let angleOf = "";
  /// Vero mentre il selettore del sistema mostra un colore non ancora
  /// scelto.
  let picking = false;
  let formats: { language: string; plain: Intl.NumberFormat } | null = null;

  /// `value` con al più un decimale, senza separatore delle migliaia, che un
  /// campo non rilegge.
  const numberText = (value: number, places = 1): string => {
    const language = resolvedLanguage();
    if (formats?.language !== language) formats = { language, plain: new Intl.NumberFormat(language, { maximumFractionDigits: 2, useGrouping: false }) };
    const factor = 10 ** places;
    return formats.plain.format(Math.round(value * factor) / factor || 0);
  };
  const percent = (share: number): string => `${numberText(share * 100)}%`;

  /// Il nome di un colore: quello della tavolozza, o il codice.
  const colorName = (code: string): string => {
    const swatch = swatchOf(code);
    return swatch === null ? code : t(swatch.label);
  };

  /// Il nome di un punto: il colore, e l'opacità se è trasparente.
  const stopName = (stop: GradientStop): string =>
    stop.opacity >= 1 ? colorName(stop.color) : t("draw.gradient.stop.alpha", { color: colorName(stop.color), opacity: percent(stop.opacity) });

  // --- Ciò che si mostra ----------------------------------------------------------

  const targets = (): PaintTarget[] => (["fill", "stroke"] as const).filter((each) => (view.channels[each]?.count ?? 0) > 0);

  /// Il bersaglio dei gesti: quello scelto, se la selezione l'ha, o quello
  /// che ha; `null` senza bersagli.
  const effective = (): PaintTarget | null => {
    const all = targets();
    if (all.length === 0) return null;
    return all.includes(chosen) ? chosen : all[0]!;
  };

  const channel = (): GradientView | null => {
    const target = effective();
    return target === null ? null : (view.channels[target] ?? null);
  };

  const stops = (): readonly GradientStop[] => channel()?.look?.stops ?? [];

  /// Il punto scelto, fra quelli che ci sono; -1 senza punti.
  const selected = (): number => {
    const count = stops().length;
    return count === 0 ? -1 : Math.min(Math.max(view.stop ?? 0, 0), count - 1);
  };

  const refusal = (): string => t("draw.rejected", { reason: t("draw.reason.read_only") });

  /// Manda `change` all'editor; il punto scelto diventa `stop`. `null` se è
  /// fatto, altrimenti perché no, già detto se `loud`.
  const send = (change: GradientChange, label: DrawKey, stop: number | null, loud = true): string | null => {
    const target = effective();
    if (target === null) return null;
    const failure = editable ? options.onChange(target, change, label) : refusal();
    if (failure !== null) {
      if (loud) options.announce(failure);
      return failure;
    }
    options.onStop(stop);
    return null;
  };

  // --- Le barre di pulsanti -----------------------------------------------------

  /// Una fila di pulsanti col roving tabindex, come nel resto del pannello:
  /// il Tab va al pulsante premuto, le frecce, Inizio e Fine agli altri.
  const rove = (bar: HTMLElement): (() => void) => {
    let current: HTMLButtonElement | null = null;
    const focusable = (): HTMLButtonElement[] => [...bar.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden);
    const sync = (): void => {
      const controls = focusable();
      if (current === null || !controls.includes(current) || !bar.contains(document.activeElement)) {
        current = controls.find((control) => control.getAttribute("aria-pressed") === "true") ?? controls[0] ?? null;
      }
      for (const control of bar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === current ? 0 : -1;
    };
    life.listen(bar, "keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const controls = focusable();
      const at = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % controls.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + controls.length) % controls.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = controls.length - 1;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      current = controls[next]!;
      for (const control of controls) control.tabIndex = control === current ? 0 : -1;
      current.focus();
    });
    life.listen(bar, "focusin", (event) => {
      if (event.target instanceof HTMLButtonElement && bar.contains(event.target)) {
        current = event.target;
        for (const control of bar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === current ? 0 : -1;
      }
    });
    return sync;
  };

  /// Una riga col nome sopra e una barra di pulsanti, nominata da lui.
  const choiceRow = (className: string): { root: HTMLElement; label: HTMLElement; bar: HTMLElement } => {
    const root = document.createElement("div");
    root.className = className;
    const label = document.createElement("span");
    label.className = "draw-properties-label";
    label.id = identifier("draw-gradient-label");
    const bar = document.createElement("div");
    bar.className = "draw-properties-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-labelledby", label.id);
    root.append(label, bar);
    element.append(root);
    return { root, label, bar };
  };

  const textButton = (bar: HTMLElement): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-button";
    bar.append(button);
    return button;
  };

  const iconButton = (bar: HTMLElement, name: string): HTMLButtonElement => {
    const button = textButton(bar);
    button.classList.add("draw-properties-action");
    const glyph = iconEl(name);
    if (glyph !== null) button.append(glyph);
    return button;
  };

  /// Segna `button` come un gesto che adesso non si usa, che resta
  /// raggiungibile e dice perché.
  const offWhen = (button: HTMLElement, off: boolean): void => {
    if (off) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  };

  // --- «Applica a» --------------------------------------------------------------

  const targetRow = choiceRow("draw-gradient-target");
  const targetButtons = new Map<PaintTarget, HTMLButtonElement>();
  for (const target of ["fill", "stroke"] as const) {
    const button = textButton(targetRow.bar);
    button.dataset.target = target;
    targetButtons.set(target, button);
    life.listen(button, "click", () => {
      if (chosen === target) return;
      chosen = target;
      options.onTarget(target);
      paint();
    });
  }
  const syncTargets = rove(targetRow.bar);

  // --- Il tipo ------------------------------------------------------------------

  const kindRow = choiceRow("draw-gradient-row");
  const kindButtons = new Map<GradientKind | "color", HTMLButtonElement>();
  for (const kind of KINDS) {
    const button = textButton(kindRow.bar);
    button.dataset.kind = kind;
    kindButtons.set(kind, button);
    life.listen(button, "click", () => {
      const current = channel();
      if (current === null || current.kind === kind) return;
      send({ kind }, "draw.action.gradient_kind", kind === "color" ? null : Math.max(selected(), 0));
    });
  }
  const syncKinds = rove(kindRow.bar);

  const note = document.createElement("p");
  note.className = "draw-properties-note";
  note.hidden = true;
  element.append(note);

  // --- La barra dei punti -------------------------------------------------------

  const stopsRoot = document.createElement("div");
  stopsRoot.className = "draw-gradient-stops";
  stopsRoot.setAttribute("role", "group");
  const stopsLabel = document.createElement("span");
  stopsLabel.className = "draw-properties-label";
  stopsLabel.id = identifier("draw-gradient-stops");
  stopsRoot.setAttribute("aria-labelledby", stopsLabel.id);
  const bar = document.createElement("div");
  bar.className = "draw-gradient-bar";
  // La barra si usa col puntatore; dalla tastiera, i punti e «Aggiungi un
  // punto» fanno lo stesso.
  const strip = document.createElement("div");
  strip.className = "draw-gradient-strip";
  strip.setAttribute("aria-hidden", "true");
  bar.append(strip);
  stopsRoot.append(stopsLabel, bar);
  element.append(stopsRoot);
  const thumbs: HTMLElement[] = [];

  const createThumb = (): HTMLElement => {
    const thumb = document.createElement("div");
    thumb.className = "draw-gradient-thumb";
    thumb.setAttribute("role", "slider");
    thumb.setAttribute("aria-valuemin", "0");
    thumb.setAttribute("aria-valuemax", "100");
    thumb.setAttribute("aria-orientation", "horizontal");
    thumb.tabIndex = 0;
    const color = document.createElement("span");
    color.className = "draw-gradient-thumb-color";
    thumb.append(color);
    bar.append(thumb);
    return thumb;
  };

  /// Il punto della barra di `target`, se lo è.
  const thumbOf = (target: EventTarget | null): HTMLElement | null => {
    const thumb = target instanceof Element ? target.closest<HTMLElement>(".draw-gradient-thumb") : null;
    return thumb !== null && bar.contains(thumb) ? thumb : null;
  };

  const focusThumb = (index: number): void => {
    const thumb = thumbs[index];
    if (thumb === undefined) {
      refocus = index;
      return;
    }
    refocus = null;
    thumb.focus({ preventScroll: true });
  };

  /// Mostra i punti `list` sulla barra, col punto `index` scelto.
  const paintBar = (list: readonly GradientStop[], index: number): void => {
    strip.style.setProperty("--gradient-image", stripImage(list));
    while (thumbs.length < list.length) thumbs.push(createThumb());
    while (thumbs.length > list.length) thumbs.pop()!.remove();
    const count = String(list.length);
    list.forEach((stop, at) => {
      const thumb = thumbs[at]!;
      thumb.dataset.index = String(at);
      thumb.style.setProperty("--at", String(fourth(stop.offset)));
      thumb.style.setProperty("--stop", cssColor(stop));
      thumb.setAttribute("aria-valuenow", String(Math.round(stop.offset * 1000) / 10));
      thumb.setAttribute("aria-valuetext", t("draw.gradient.stop.value", { color: stopName(stop), at: percent(stop.offset) }));
      thumb.setAttribute("aria-label", t("draw.gradient.stop", { index: String(at + 1), count }));
      thumb.toggleAttribute("data-selected", at === index);
      thumb.removeAttribute("data-torn");
      offWhen(thumb, !editable);
    });
  };

  // --- I campi del punto scelto ---------------------------------------------------

  const fields = document.createElement("div");
  fields.className = "draw-gradient-fields";
  fields.setAttribute("role", "group");
  const stopTitle = document.createElement("p");
  stopTitle.className = "draw-gradient-stop-title";
  stopTitle.id = identifier("draw-gradient-stop");
  fields.setAttribute("aria-labelledby", stopTitle.id);
  fields.append(stopTitle);
  stopsRoot.append(fields);

  const textInput = (): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "draw-properties-input";
    input.id = identifier("draw-gradient-field");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.enterKeyHint = "done";
    return input;
  };

  /// Un campo nella griglia della sezione, alla colonna `column`.
  const createField = (parent: HTMLElement, column: string, input: HTMLInputElement, box: HTMLElement, error: HTMLElement): Field => {
    const root = document.createElement("div");
    root.className = "draw-properties-field";
    root.dataset.column = column;
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = input.id;
    root.append(label, box);
    parent.append(root);
    return { input, root, label, error, shown: "" };
  };

  /// Un numero con la sua unità accanto.
  const numberBox = (input: HTMLInputElement, unit: string): HTMLElement => {
    input.setAttribute("role", "spinbutton");
    input.inputMode = "decimal";
    const box = document.createElement("div");
    box.className = "draw-properties-number";
    const shown = document.createElement("span");
    shown.className = "draw-properties-unit";
    shown.setAttribute("aria-hidden", "true");
    shown.textContent = unit;
    box.append(input, shown);
    return box;
  };

  const stopError = document.createElement("p");
  stopError.className = "draw-properties-error";
  stopError.id = identifier("draw-gradient-error");
  stopError.hidden = true;

  const colorInput = textInput();
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "draw-properties-picker";
  const colorBox = document.createElement("div");
  colorBox.className = "draw-properties-paint";
  colorBox.append(colorInput, picker);
  const colorField = createField(fields, "all", colorInput, colorBox, stopError);
  const offsetInput = textInput();
  const offsetField = createField(fields, "1", offsetInput, numberBox(offsetInput, "%"), stopError);
  const opacityInput = textInput();
  const opacityField = createField(fields, "2", opacityInput, numberBox(opacityInput, "%"), stopError);
  const removeButton = iconButton(fields, "draw-gradient-remove");
  removeButton.classList.add("draw-gradient-remove");
  fields.append(stopError);
  const stopFields = [colorField, offsetField, opacityField];

  // --- I comandi ----------------------------------------------------------------

  const actions = document.createElement("div");
  actions.className = "draw-properties-bar";
  actions.setAttribute("role", "toolbar");
  element.append(actions);
  const addButton = iconButton(actions, "draw-gradient-add");
  const reverseButton = iconButton(actions, "draw-gradient-reverse");
  const presetsButton = iconButton(actions, "draw-gradient-presets");
  presetsButton.id = identifier("draw-gradient-presets");
  presetsButton.setAttribute("aria-haspopup", "menu");
  const syncActions = rove(actions);

  // --- L'angolo e oltre i capi ----------------------------------------------------

  const more = document.createElement("div");
  more.className = "draw-gradient-fields";
  element.append(more);
  const angleError = document.createElement("p");
  angleError.className = "draw-properties-error";
  angleError.id = identifier("draw-gradient-error");
  angleError.hidden = true;
  const angleInput = textInput();
  const angleField = createField(more, "1", angleInput, numberBox(angleInput, "°"), angleError);
  more.append(angleError);

  const spreadRow = choiceRow("draw-gradient-row");
  const spreadButtons = new Map<Spread, HTMLButtonElement>();
  for (const spread of SPREADS) {
    const button = textButton(spreadRow.bar);
    button.dataset.spread = spread;
    spreadButtons.set(spread, button);
    life.listen(button, "click", () => {
      if (channel()?.look?.spread === spread) return;
      send({ spread }, "draw.action.gradient_spread", selected());
    });
  }
  const syncSpreads = rove(spreadRow.bar);

  // --- I gesti sui punti ----------------------------------------------------------

  /// Aggiunge un punto in `at`, del colore che si vede lì.
  const addAt = (at: number, focus: boolean): void => {
    const list = stops();
    if (list.length === 0) return;
    const out = withStop(list, at);
    if (send({ stops: out.stops }, "draw.action.gradient_stop_add", out.index) !== null) return;
    options.announce(t("draw.gradient.added", { index: String(out.index + 1), at: percent(out.stops[out.index]!.offset) }));
    if (focus) focusThumb(out.index);
  };

  /// Aggiunge un punto a metà fra `index` e il seguente, o il precedente se
  /// è l'ultimo.
  const addAfter = (index: number, focus: boolean): void => {
    const list = stops();
    const stop = list[index];
    if (stop === undefined) return;
    const next = list[index + 1];
    const before = list[index - 1];
    addAt(next !== undefined ? (stop.offset + next.offset) / 2 : before !== undefined ? (before.offset + stop.offset) / 2 : stop.offset, focus);
  };

  /// Toglie il punto `index`, se ne restano almeno due.
  const removeStop = (index: number, focus: boolean): void => {
    const list = stops();
    if (index < 0 || index >= list.length) return;
    if (!editable) return options.announce(refusal());
    if (list.length <= 2) return options.announce(t("draw.gradient.problem.last"));
    const next = list.filter((_, at) => at !== index);
    const chosenNext = Math.min(index, next.length - 1);
    if (send({ stops: next }, "draw.action.gradient_stop_remove", chosenNext) !== null) return;
    options.announce(t("draw.gradient.removed", { index: String(index + 1) }));
    if (focus) focusThumb(chosenNext);
  };

  /// Porta il punto `index` in `at`; il fuoco lo segue.
  const moveStop = (index: number, at: number): void => {
    const list = stops();
    const stop = list[index];
    if (stop === undefined) return;
    const to = fourth(clamp01(at));
    if (to === stop.offset) return;
    const out = movedStop(list, index, to);
    if (send({ stops: out.stops }, "draw.action.gradient_stop_move", out.index) !== null) return;
    focusThumb(out.index);
  };

  /// Toglie il trascinamento, e ciò che il disegno ne mostrava.
  const cancelDrag = (): void => {
    const done = drag;
    if (done === null) return;
    drag = null;
    options.onPreview(done.target, null);
    paint();
  };

  life.listen(bar, "pointerdown", (event) => {
    if (event.button !== 0 || drag !== null) return;
    const thumb = thumbOf(event.target);
    if (thumb === null) return;
    // Il punto prende il fuoco, e niente si seleziona trascinando.
    event.preventDefault();
    const index = Number(thumb.dataset.index);
    thumb.focus({ preventScroll: true });
    if (index !== selected()) options.onStop(index);
    const target = effective();
    const list = stops();
    if (!editable || target === null || list[index] === undefined) return;
    thumb.setPointerCapture?.(event.pointerId);
    drag = { pointer: event.pointerId, index, target, from: list, startX: event.clientX, at: list[index]!.offset, torn: false, moved: false };
  });

  life.listen(bar, "pointermove", (event) => {
    const now = drag;
    if (now === null || event.pointerId !== now.pointer) return;
    const box = strip.getBoundingClientRect();
    const area = bar.getBoundingClientRect();
    const torn = now.from.length > 2 && (event.clientY < area.top - TEAR_PX || event.clientY > area.bottom + TEAR_PX);
    if (!now.moved && !torn && Math.abs(event.clientX - now.startX) < DRAG_PX) return;
    now.moved = true;
    now.torn = torn;
    if (box.width > 0) now.at = fourth(clamp01((event.clientX - box.left) / box.width));
    const next = torn ? now.from.filter((_, at) => at !== now.index) : movedStop(now.from, now.index, now.at).stops;
    const thumb = thumbs[now.index];
    thumb?.style.setProperty("--at", String(now.at));
    thumb?.toggleAttribute("data-torn", torn);
    strip.style.setProperty("--gradient-image", stripImage(next));
    options.onPreview(now.target, { stops: next });
  });

  life.listen(bar, "pointerup", (event) => {
    const done = drag;
    if (done === null || event.pointerId !== done.pointer) return;
    drag = null;
    options.onPreview(done.target, null);
    if (!done.moved || effective() !== done.target) {
      paint();
      return;
    }
    if (done.torn) {
      removeStop(done.index, true);
    } else {
      const out = movedStop(done.from, done.index, done.at);
      if (done.at === done.from[done.index]!.offset || send({ stops: out.stops }, "draw.action.gradient_stop_move", out.index) !== null) paint();
      else focusThumb(out.index);
    }
  });

  // Un trascinamento che il sistema interrompe non scrive niente.
  life.listen(bar, "pointercancel", (event) => {
    if (drag !== null && event.pointerId === drag.pointer) cancelDrag();
  });
  life.listen(bar, "lostpointercapture", (event) => {
    if (drag !== null && event.pointerId === drag.pointer) cancelDrag();
  });

  // Un clic sulla barra aggiunge un punto lì, che prende il fuoco.
  life.listen(strip, "click", (event) => {
    if (!editable) return options.announce(refusal());
    const box = strip.getBoundingClientRect();
    if (box.width <= 0) return;
    addAt(fourth(clamp01((event.clientX - box.left) / box.width)), true);
  });

  life.listen(bar, "focusin", (event) => {
    const thumb = thumbOf(event.target);
    if (thumb === null || drag !== null) return;
    const index = Number(thumb.dataset.index);
    if (index !== selected()) options.onStop(index);
  });

  life.listen(bar, "keydown", (event) => {
    const thumb = thumbOf(event.target);
    if (thumb === null) return;
    if (event.key === "Escape") {
      if (drag === null) return;
      thumb.releasePointerCapture?.(drag.pointer);
      cancelDrag();
    } else if (event.ctrlKey || event.metaKey || event.altKey || drag !== null) {
      return;
    } else {
      const index = Number(thumb.dataset.index);
      const stop = stops()[index];
      if (stop === undefined) return;
      const step = event.shiftKey ? BIG_STEP : STEP;
      let to: number | null = null;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          to = stop.offset + step;
          break;
        case "ArrowLeft":
        case "ArrowDown":
          to = stop.offset - step;
          break;
        case "PageUp":
          to = stop.offset + BIG_STEP;
          break;
        case "PageDown":
          to = stop.offset - BIG_STEP;
          break;
        case "Home":
          to = 0;
          break;
        case "End":
          to = 1;
          break;
        case "Delete":
        case "Backspace":
          removeStop(index, true);
          break;
        case "Insert":
        case "+":
          if (!editable) options.announce(refusal());
          else addAfter(index, true);
          break;
        default:
          return;
      }
      if (to !== null) {
        if (!editable) options.announce(refusal());
        else moveStop(index, to);
      }
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // --- Scrivere i campi -----------------------------------------------------------

  const showError = (field: Field, text: string | null): void => {
    field.error.hidden = text === null;
    setText(field.error, text ?? "");
    for (const each of [...stopFields, angleField]) {
      if (each.error !== field.error) continue;
      if (text !== null && each === field) {
        each.input.setAttribute("aria-invalid", "true");
        each.input.setAttribute("aria-describedby", field.error.id);
      } else {
        each.input.removeAttribute("aria-invalid");
        each.input.removeAttribute("aria-describedby");
      }
    }
  };

  /// Dice che cosa non va in `field`, e a voce se `loud`. Torna falso.
  const fail = (field: Field, text: string, loud: boolean): false => {
    showError(field, text);
    if (loud) options.announce(text);
    return false;
  };

  /// Manda `change` per `field`, che dice già `text`; falso, e il campo
  /// resta com'era scritto, se il disegno non l'accetta.
  const sendFrom = (field: Field, change: GradientChange, label: DrawKey, stop: number | null, text: string, loud: boolean): boolean => {
    const draft = field.input.value;
    const before = field.shown;
    // Il campo dice già il valore nuovo: l'aggiornamento che arriva mentre
    // l'editor lo scrive non lo prende per un valore scritto a metà.
    field.input.value = field.shown = text;
    showError(field, null);
    const failure = send(change, label, stop, false);
    if (failure === null) return true;
    field.shown = before;
    field.input.value = draft;
    return fail(field, failure, loud);
  };

  /// Il colore scritto: un codice, un nome, o un campione del documento per
  /// nome, senza badare alle maiuscole; `null` se non è un colore.
  const colorOf = (text: string): string | null => {
    const name = text.trim().toLocaleLowerCase();
    const swatch = name === "" ? undefined : view.swatches.find((each) => each.name.toLocaleLowerCase() === name);
    return swatch?.color ?? customColor(text);
  };

  /// I punti con il punto scelto cambiato da `edit`.
  const editedStops = (edit: (stop: GradientStop) => GradientStop): GradientStop[] | null => {
    const list = stops();
    const index = selected();
    if (index < 0) return null;
    return list.map((stop, at) => (at === index ? edit(stop) : stop));
  };

  const commitColor = (text: string, loud: boolean): boolean => {
    const field = colorField;
    const index = selected();
    const stop = stops()[index];
    if (stop === undefined || !editable) return true;
    const code = colorOf(text);
    if (code === null) return fail(field, t("draw.gradient.problem.color"), loud);
    if (code === stop.color) {
      field.input.value = field.shown = code;
      picker.value = code;
      showError(field, null);
      return true;
    }
    return sendFrom(field, { stops: editedStops((each) => ({ ...each, color: code }))! }, "draw.action.gradient_stop_color", index, code, loud);
  };

  /// Il numero scritto in `field`, in percentuale e fra 0 e 100, o il
  /// messaggio di che cosa non va.
  const percentOf = (text: string, current: number): number | string => {
    const out = evaluate(text, { units: PERCENT_UNITS, current, relative: false });
    if ("problem" in out) return t(PROBLEMS[out.problem], { units: "%" });
    return Math.round(Math.min(100, Math.max(0, out.value)) * 10) / 10;
  };

  /// Scrive la posizione o l'opacità del punto scelto, `value` in
  /// percentuale.
  const sendPercent = (field: Field, value: number, loud: boolean): boolean => {
    const index = selected();
    const stop = stops()[index];
    if (stop === undefined) return true;
    const text = numberText(value);
    const share = fourth(value / 100);
    if (field === offsetField) {
      if (share === stop.offset) {
        field.input.value = field.shown = text;
        showError(field, null);
        return true;
      }
      const out = movedStop(stops(), index, share);
      return sendFrom(field, { stops: out.stops }, "draw.action.gradient_stop_move", out.index, text, loud);
    }
    if (share === fourth(stop.opacity)) {
      field.input.value = field.shown = text;
      showError(field, null);
      return true;
    }
    return sendFrom(field, { stops: editedStops((each) => ({ ...each, opacity: share }))! }, "draw.action.gradient_stop_opacity", index, text, loud);
  };

  /// La posizione o l'opacità del punto scelto, in percentuale.
  const currentPercent = (field: Field): number | null => {
    const stop = stops()[selected()];
    if (stop === undefined) return null;
    return Math.round((field === offsetField ? stop.offset : stop.opacity) * 1000) / 10;
  };

  const commitPercent = (field: Field, loud: boolean): boolean => {
    if (!editable || field.input.value === field.shown) return true;
    const current = currentPercent(field);
    if (current === null) return true;
    const value = percentOf(field.input.value, current);
    if (typeof value === "string") return fail(field, value, loud);
    return sendPercent(field, value, loud);
  };

  const commitAngle = (loud: boolean): boolean => {
    const field = angleField;
    const current = channel()?.angle ?? null;
    if (!editable || field.input.value === field.shown) return true;
    const out = evaluate(field.input.value, { units: ANGLE_UNITS, current, relative: false });
    if ("problem" in out) return fail(field, t(PROBLEMS[out.problem], { units: Object.keys(ANGLE_UNITS).join(", ") }), loud);
    const angle = Math.round(normalized(out.value) * 100) / 100;
    if (current !== null && angle === current) {
      field.input.value = field.shown = numberText(angle, 2);
      showError(field, null);
      return true;
    }
    return sendFrom(field, { angle }, "draw.action.gradient_angle", selected() < 0 ? null : selected(), numberText(angle, 2), loud);
  };

  /// Su e giù: il valore di adesso, o quello scritto, cambia di `delta` e
  /// parte. Un angolo misto senza niente di scritto non ha da dove partire.
  const step = (field: Field, delta: number): void => {
    if (!editable) return options.announce(refusal());
    const angle = field === angleField;
    let base = angle ? (channel()?.angle ?? null) : currentPercent(field);
    if (field.input.value !== field.shown && field.input.value.trim() !== "") {
      const out = evaluate(field.input.value, { units: angle ? ANGLE_UNITS : PERCENT_UNITS, current: base, relative: false });
      if ("problem" in out) {
        fail(field, t(PROBLEMS[out.problem], { units: angle ? Object.keys(ANGLE_UNITS).join(", ") : "%" }), true);
        return;
      }
      base = out.value;
    }
    if (base === null) {
      options.announce(t("draw.properties.problem.mixed"));
      return;
    }
    if (angle) {
      const value = Math.round(normalized(base + delta) * 100) / 100;
      sendFrom(field, { angle: value }, "draw.action.gradient_angle", selected() < 0 ? null : selected(), numberText(value, 2), true);
      return;
    }
    const value = Math.round(Math.min(100, Math.max(0, base + delta)) * 10) / 10;
    if (value === currentPercent(field)) {
      field.input.value = field.shown;
      return;
    }
    sendPercent(field, value, true);
  };

  /// Il campo di cui `target` è il controllo.
  const fieldOf = (target: EventTarget | null): Field | null => [...stopFields, angleField].find((field) => field.input === target) ?? null;

  const commitField = (field: Field, loud: boolean): boolean => {
    if (field === colorField) return field.input.value === field.shown || commitColor(field.input.value, loud);
    if (field === angleField) return commitAngle(loud);
    return commitPercent(field, loud);
  };

  life.listen(element, "keydown", (event) => {
    const field = fieldOf(event.target);
    if (field === null) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Escape" && plain && !event.shiftKey) {
      // Senza niente da annullare, Esc torna al foglio, come negli altri
      // campi.
      if (field.input.value === field.shown) return;
      field.input.value = field.shown;
      showError(field, null);
      if (field === colorField) picker.value = customColor(field.shown) ?? picker.value;
    } else if (event.key === "Enter" && plain && !event.shiftKey) {
      commitField(field, true);
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain && field !== colorField) {
      step(field, (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(element, "focusout", (event) => {
    const field = fieldOf(event.target);
    // Un campo che se n'è andato non scrive: il valore a metà era per ciò
    // che mostrava prima.
    if (field === null || field.root.closest("[hidden]") !== null) return;
    commitField(field, false);
  });

  // Il selettore del sistema: il disegno mostra il colore mentre lo si
  // muove, e lo scrive quando lo si sceglie.
  life.listen(picker, "input", () => {
    const target = effective();
    const list = editedStops((stop) => ({ ...stop, color: picker.value.toLowerCase() }));
    if (target === null || list === null || !editable) return;
    picking = true;
    colorInput.value = picker.value.toLowerCase();
    strip.style.setProperty("--gradient-image", stripImage(list));
    options.onPreview(target, { stops: list });
  });
  const endPicking = (): void => {
    if (!picking) return;
    picking = false;
    const target = effective();
    if (target !== null) options.onPreview(target, null);
  };
  life.listen(picker, "change", () => {
    endPicking();
    if (!editable) return options.announce(refusal());
    if (!commitColor(picker.value, true)) paint();
  });
  life.listen(picker, "blur", () => {
    if (!picking) return;
    endPicking();
    colorInput.value = colorField.shown;
    paint();
  });

  // --- I comandi ----------------------------------------------------------------

  life.listen(removeButton, "click", () => removeStop(selected(), false));
  life.listen(addButton, "click", () => {
    if (!editable) return options.announce(refusal());
    addAfter(Math.max(selected(), 0), false);
  });
  life.listen(reverseButton, "click", () => {
    const list = stops();
    send({ reverse: true }, "draw.action.gradient_reverse", list.length === 0 ? null : list.length - 1 - selected());
  });

  const applyPreset = (preset: GradientPreset): void => {
    send(preset.stops === null ? { fade: true } : { stops: preset.stops }, "draw.action.gradient_preset", 0);
  };

  const presetItems = (): MenuItem[] => {
    const look = channel()?.look ?? null;
    return GRADIENT_PRESETS.map((preset): MenuItem => {
      // La dissolvenza è del primo colore che la sfumatura comune ha.
      const shown = preset.stops ?? (look === null ? null : fadeOf(look.stops[0]!.color));
      return {
        label: t(preset.label),
        ...(preset.stops === null ? { description: t("draw.gradient.preset.fade.note") } : {}),
        ...(shown === null ? {} : { swatches: samples(shown) }),
        choice: "radio",
        checked: look !== null && shown !== null && sameStops(look.stops, shown),
        disabled: !editable,
        run: () => applyPreset(preset),
      };
    });
  };

  life.listen(presetsButton, "click", (event) => {
    const at = event.detail === 0 || (event.clientX === 0 && event.clientY === 0) ? presetsButton : event;
    showContextMenu(at, presetItems(), { labelledBy: presetsButton.id });
  });

  // --- Mostrare -----------------------------------------------------------------

  /// Mostra `text` in `field`, a meno che non vi si stia scrivendo; con
  /// `fresh` anche allora.
  const showField = (field: Field, text: string, fresh: boolean): void => {
    const editing = document.activeElement === field.input && field.input.value !== field.shown;
    field.shown = text;
    if (editing && !fresh) return;
    field.input.value = text;
    if (field.input.getAttribute("aria-invalid") === "true") showError(field, null);
  };

  function paint(): void {
    const all = targets();
    const target = effective();
    const current = channel();
    targetRow.root.hidden = all.length < 2;
    for (const [each, button] of targetButtons) button.setAttribute("aria-pressed", String(each === target));
    syncTargets();
    for (const [kind, button] of kindButtons) {
      button.setAttribute("aria-pressed", String(current?.kind === kind));
      offWhen(button, !editable);
    }
    syncKinds();
    const gradients = current?.gradients ?? 0;
    const look = current?.look ?? null;
    const noteText =
      current === null ? "" : look === null && gradients > 0 ? t("draw.gradient.note.mixed") : gradients > 0 ? "" : current.kind === "other" ? t("draw.gradient.note.other") : t("draw.gradient.note.color");
    note.hidden = noteText === "";
    setText(note, noteText);

    // La barra e il punto scelto.
    stopsRoot.hidden = look === null;
    bar.toggleAttribute("data-readonly", !editable);
    const index = selected();
    const list = look?.stops ?? [];
    if (look !== null && drag === null && !picking) paintBar(list, index);
    const stop = list[index];
    const shownKey = `${view.key}\n${target}\n${index}`;
    const fresh = shownKey !== fieldsOf;
    fieldsOf = shownKey;
    if (stop !== undefined) {
      setText(stopTitle, t("draw.gradient.stop", { index: String(index + 1), count: String(list.length) }));
      if (!picking) {
        showField(colorField, stop.color, fresh);
        if (customColor(colorInput.value) !== null) picker.value = customColor(colorInput.value)!;
      }
      showField(offsetField, numberText(stop.offset * 100), fresh);
      showField(opacityField, numberText(stop.opacity * 100), fresh);
      offsetInput.setAttribute("aria-valuenow", String(Math.round(stop.offset * 1000) / 10));
      opacityInput.setAttribute("aria-valuenow", String(Math.round(stop.opacity * 1000) / 10));
    }
    // Il nome c'è anche senza un punto, quando la barra non si vede.
    const remove = t("draw.gradient.stop.remove", { index: String(Math.max(index, 0) + 1) });
    removeButton.setAttribute("aria-label", remove);
    removeButton.title = list.length <= 2 ? `${remove} — ${t("draw.gradient.problem.last")}` : remove;
    offWhen(removeButton, !editable || list.length <= 2);
    for (const field of stopFields) field.input.readOnly = !editable;
    picker.disabled = !editable;

    // I comandi.
    addButton.hidden = look === null;
    reverseButton.hidden = gradients === 0;
    presetsButton.hidden = current === null;
    actions.hidden = current === null;
    for (const button of [addButton, reverseButton, presetsButton]) offWhen(button, !editable);
    syncActions();

    // L'angolo, per tutte le sfumature della selezione.
    more.hidden = gradients === 0;
    const angle = current?.angle ?? null;
    showField(angleField, angle === null ? "" : numberText(angle, 2), view.key + target !== angleOf);
    angleOf = view.key + target;
    angleInput.placeholder = angle === null && gradients > 0 ? t("draw.properties.mixed") : "";
    if (angle === null) angleInput.removeAttribute("aria-valuenow");
    else angleInput.setAttribute("aria-valuenow", String(angle));
    angleInput.readOnly = !editable;

    spreadRow.root.hidden = !view.expert || look === null;
    for (const [spread, button] of spreadButtons) {
      button.setAttribute("aria-pressed", String(look?.spread === spread));
      offWhen(button, !editable);
    }
    syncSpreads();

    // Il fuoco va al punto che lo aspettava; uno che se n'è andato lo lascia
    // al vicino.
    if (refocus !== null && thumbs[refocus] !== undefined) focusThumb(refocus);
  }

  const relabel = (): void => {
    formats = null;
    setText(targetRow.label, t("draw.colors.target"));
    setText(targetButtons.get("fill")!, t("draw.properties.fill"));
    setText(targetButtons.get("stroke")!, t("draw.properties.stroke"));
    setText(kindRow.label, t("draw.gradient.kind"));
    for (const [kind, button] of kindButtons) setText(button, t(KIND_LABELS[kind]));
    setText(stopsLabel, t("draw.gradient.stops"));
    strip.title = t("draw.gradient.stops.hint");
    setText(colorField.label, t("draw.gradient.stop.color"));
    picker.setAttribute("aria-label", t("draw.properties.picker", { label: t("draw.gradient.stop.color") }));
    setText(offsetField.label, t("draw.gradient.stop.offset"));
    setText(opacityField.label, t("draw.gradient.stop.opacity"));
    actions.setAttribute("aria-label", t("draw.properties.gradient"));
    for (const [button, key] of [
      [addButton, "draw.gradient.add"],
      [reverseButton, "draw.gradient.reverse"],
      [presetsButton, "draw.gradient.presets"],
    ] as const) {
      const text = t(key);
      button.setAttribute("aria-label", text);
      button.title = text;
    }
    setText(angleField.label, t("draw.gradient.angle"));
    setText(spreadRow.label, t("draw.gradient.spread"));
    for (const [spread, button] of spreadButtons) setText(button, t(SPREAD_LABELS[spread]));
    paint();
  };
  relabel();

  return {
    element,
    update(next, nextEditable) {
      view = next;
      editable = nextEditable;
      // Un trascinamento di un'altra selezione, o in sola lettura, finisce.
      if (drag !== null && (!editable || effective() !== drag.target)) cancelDrag();
      paint();
    },
    target: () => chosen,
    setTarget(target) {
      if (chosen === target) return;
      chosen = target;
      paint();
    },
    hasStops: () => !stopsRoot.hidden,
    focusColor() {
      if (stopsRoot.hidden) return false;
      colorField.root.scrollIntoView?.({ block: "nearest" });
      colorInput.focus({ preventScroll: true });
      colorInput.select();
      return true;
    },
    relabel,
  };
}
