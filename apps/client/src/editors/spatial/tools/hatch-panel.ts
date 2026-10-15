// La campitura degli oggetti scelti, come sezione del pannello delle
// proprietà (livello Standard): il tipo, in un menu, e i campi della
// campitura. All'Esperto il menu offre anche i motivi del documento, e un
// motivo scelto si rinomina e si elimina da qui. Che cosa mostrare, e ogni
// cambio, li decide l'editor, con [`hatchOps`]; qui c'è come si vede, si
// sceglie e si raggiunge.
//
// - **Il menu del tipo** è un pulsante che dice la scelta di adesso, con la
//   sua figura, e ne apre le voci: Nessuna e le cinque campiture pronte,
//   ciascuna con la sua figura; all'Esperto, sotto, i motivi del documento
//   per nome e, dopo una riga, «Motivo dalla selezione». Una campitura
//   personalizzata, il motivo di un altro programma e una scelta mista si
//   leggono nel pulsante, e non sono voci da scegliere. Una scelta vale per
//   tutti gli oggetti scelti che hanno un riempimento.
// - **I campi sono della campitura**: il colore delle righe, il fondo (un
//   colore, o nessuno), il passo, lo spessore (il diametro, se sono tutti
//   puntini) e l'angolo. Appaiono quando almeno un oggetto ha una campitura
//   di FubDraw, e cambiano quelle: gli altri oggetti restano come sono, e
//   una nota lo dice. Le lunghezze sono nell'unità dello spessore del
//   contorno, l'angolo in gradi. Un valore misto è vuoto, e dice «Misto».
// - **I campi si scrivono come gli altri del pannello**: i numeri si
//   calcolano (`quantity.ts`), su e giù li cambiano di 1, con Maiusc di 10, e
//   partono subito; ogni genere di cambio ha il suo nome nella cronologia,
//   e i passi che si seguono con lo stesso nome si uniscono. Invio o
//   lasciare il campo scrive, Esc riporta com'era e, di nuovo, torna al
//   foglio. Un valore che non va resta scritto e segnato, col messaggio
//   accanto. Un colore è un codice, un nome, o il nome di un campione del
//   documento, di cui si scrive il colore: la campitura non resta legata a
//   un campione. Il suo campione apre i colori del documento e quelli della
//   tavolozza; il fondo ha anche «Nessuno».
// - **Un motivo del documento scelto** (Esperto) ha il suo nome, che si
//   riscrive, e «Elimina motivo»: chi lo usava torna a un colore pieno.
//   Il nome segue le regole dei nomi dei colori del documento.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import type { LengthUnit } from "../scene/rulers";
import { plural, t, type DrawKey } from "../strings";
import { clampSpacing, clampWidth, HATCH_PRESETS, MAX_SPACING, MIN_SPACING, MIN_WIDTH, normalAngle, type HatchPreset } from "./hatches";
import { cleanName } from "./naming";
import { customColor, PALETTE, swatchOf } from "./palette";
import type { HatchChange, HatchChoice, HatchView } from "./patterns";
import { ANGLE_UNITS, evaluate, lengthUnits, type QuantityProblem } from "./quantity";
import { FIELD_PLACES, fromUnit, toUnit } from "./rulers";
import { swatchNameProblem } from "./swatches";

/// Il riquadro di ogni figura: lo stesso delle altre icone di una sezione.
const FRAME = "M4 4h16v16H4z";

/// Un puntino della figura delle puntinate: un cerchietto pieno per il tratto.
const dot = (x: number, y: number): string => `M${x - 0.6} ${y}a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0-1.2 0z`;

/// Le icone della sezione, col costrutto di `ui/icons.ts`: la figura di
/// ogni campitura pronta, di una personalizzata e di un motivo.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-hatch-none": [FRAME, "M4 20 20 4"],
  "draw-hatch-diagonal": [FRAME, "M4 12 12 4", "M4 20 20 4", "M12 20l8-8"],
  "draw-hatch-cross": [FRAME, "M4 12 12 4", "M4 20 20 4", "M12 20l8-8", "M12 4l8 8", "M4 4l16 16", "M4 12l8 8"],
  "draw-hatch-horizontal": [FRAME, "M4 8h16", "M4 12h16", "M4 16h16"],
  "draw-hatch-dots": [FRAME, dot(8, 8), dot(16, 8), dot(12, 12), dot(8, 16), dot(16, 16)],
  "draw-hatch-grid": [FRAME, "M4 9.33h16", "M4 14.67h16", "M9.33 4v16", "M14.67 4v16"],
  "draw-hatch-custom": [FRAME, "M4 9c3-3 5 3 8 0s5 3 8 0", "M4 15c3-3 5 3 8 0s5 3 8 0"],
  "draw-hatch-pattern": [FRAME, "M12 4v8h8", "M4 12h8v8"],
};

/// Il nome della figura di una scelta del menu; `null` per la scelta mista,
/// che non ne ha una.
export function hatchIcon(choice: HatchChoice | null): string | null {
  if (choice === null) return null;
  if (choice === "none" || choice === "custom") return `draw-hatch-${choice}`;
  if (choice === "other" || choice.startsWith("pattern:")) return "draw-hatch-pattern";
  return `draw-hatch-${choice}`;
}

const PRESET_LABELS: Readonly<Record<HatchPreset, DrawKey>> = {
  diagonal: "draw.hatch.preset.diagonal",
  cross: "draw.hatch.preset.cross",
  horizontal: "draw.hatch.preset.horizontal",
  dots: "draw.hatch.preset.dots",
  grid: "draw.hatch.preset.grid",
};

const PROBLEMS: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// Un campione del documento, che il colore di un campo scrive per nome.
export interface HatchSwatch {
  readonly id: string;
  readonly name: string;
  /// `#rrggbb` minuscolo.
  readonly color: string;
}

/// Un motivo del documento: il nome com'è scritto, e il suo colore medio.
export interface HatchMotif {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/// Ciò che la sezione mostra.
export interface HatchPanelView {
  /// Che cosa si mostra: una chiave diversa lascia cadere i valori scritti
  /// a metà.
  readonly key: string;
  /// Le campiture delle parti riempite degli oggetti scelti
  /// ([`hatchView`](./patterns.ts)).
  readonly hatch: HatchView;
  /// L'unità delle lunghezze, quella dello spessore del contorno.
  readonly unit: LengthUnit;
  /// I campioni del documento, che il colore di un campo scrive per nome.
  readonly swatches: readonly HatchSwatch[];
  /// I motivi del documento, per dire il nome di quello in uso.
  readonly motifs: readonly HatchMotif[];
  /// Vero all'Esperto: il menu offre i motivi e «Motivo dalla selezione», e
  /// un motivo scelto si rinomina e si elimina.
  readonly expert: boolean;
}

export interface HatchPanelOptions {
  /// Dà `change` alle campiture degli oggetti scelti, col nome `label` nella
  /// cronologia. `null` se è fatto, altrimenti perché no.
  onChange(change: HatchChange, label: DrawKey): string | null;
  /// «Motivo dalla selezione»: lo fa l'editor, che dice com'è andata.
  onMotif(): void;
  /// Perché «Motivo dalla selezione» non si fa con gli oggetti scelti, a
  /// parole; `null` se si fa. Si chiede quando il menu si apre.
  motifReason(): string | null;
  /// Dà il nome `name` al motivo `id`. `null` se è fatto, altrimenti perché
  /// no.
  onRename(id: string, name: string): string | null;
  /// Elimina il motivo `id`. `null` se è fatto, altrimenti perché no.
  onDelete(id: string): string | null;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

export interface HatchPanel {
  /// Il corpo della sezione: la nota, il menu e i campi.
  readonly element: HTMLElement;
  /// Mostra `view`; falso `editable` in sola lettura, dove la campitura si
  /// guarda soltanto.
  update(view: HatchPanelView, editable: boolean): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

type FieldId = "color" | "background" | "spacing" | "width" | "angle" | "name";

/// Un campo, col testo che ha scritto il disegno.
interface Field {
  readonly id: FieldId;
  readonly root: HTMLElement;
  readonly label: HTMLLabelElement;
  /// Il nome, l'unità che si sente con lui, e quella che si vede accanto al
  /// numero.
  readonly name: HTMLElement;
  readonly spoken: HTMLElement | null;
  readonly unit: HTMLElement | null;
  readonly input: HTMLInputElement;
  /// Il campione che apre i colori, e il selettore del sistema.
  readonly chip: HTMLButtonElement | null;
  readonly frame: HTMLElement | null;
  readonly swatch: HTMLElement | null;
  readonly picker: HTMLInputElement | null;
  /// Dove dice che cosa non va.
  readonly error: HTMLElement;
  /// Il testo scritto nel campo l'ultima volta: un campo che dice altro ha
  /// un valore scritto a metà.
  shown: string;
}

/// Il nome del passo della cronologia di ogni campo.
const ACTIONS: Readonly<Record<Exclude<FieldId, "name">, DrawKey>> = {
  color: "draw.action.hatch_color",
  background: "draw.action.hatch_background",
  spacing: "draw.action.hatch_spacing",
  width: "draw.action.hatch_width",
  angle: "draw.action.hatch_angle",
};

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/// L'id del motivo del documento che `choice` dice, se lo dice.
function motifIdOf(choice: HatchChoice | null): string | null {
  return choice !== null && choice.startsWith("pattern:") ? choice.slice("pattern:".length) : null;
}

export function createHatchPanel(life: Lifetime, options: HatchPanelOptions): HatchPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-hatch";

  const EMPTY: HatchView = { count: 0, hatched: 0, choice: "none", kind: null, angle: null, spacing: null, width: null, color: null, background: null };
  let view: HatchPanelView = { key: "", hatch: EMPTY, unit: "pt", swatches: [], motifs: [], expert: false };
  let editable = false;
  /// Vero mentre un cambio è in corso: la selezione può prendere un'altra
  /// chiave, ma è la stessa.
  let carry = false;
  /// Vero mentre i campi si ridisegnano: un campo che se ne va non scrive.
  let painting = false;
  /// Il selettore del sistema mostra un colore non ancora scelto.
  let picking: Field | null = null;
  let lastKey = "";
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

  /// Una lunghezza della scena come numero, nell'unità del disegno e coi
  /// decimali che il campo mostra.
  const shownLength = (value: number): number => {
    const factor = 10 ** FIELD_PLACES[view.unit];
    return Math.round(toUnit(value, view.unit) * factor) / factor || 0;
  };

  const readOnly = (): string => t("draw.rejected", { reason: t("draw.reason.read_only") });

  /// Segna `control` come un gesto che adesso non si usa, che resta
  /// raggiungibile e dice perché.
  const offWhen = (control: HTMLElement, off: boolean): void => {
    if (off) control.setAttribute("aria-disabled", "true");
    else control.removeAttribute("aria-disabled");
  };

  // --- Le parti ---------------------------------------------------------------

  const note = document.createElement("p");
  note.className = "draw-properties-note";
  note.hidden = true;

  // Il menu del tipo: il nome sta nel pulsante, che lo dice insieme alla
  // scelta; quello che si vede non si ripete a chi ascolta.
  const kindRoot = document.createElement("div");
  kindRoot.className = "draw-properties-field";
  kindRoot.dataset.column = "all";
  kindRoot.dataset.field = "hatch-kind";
  const kindLabel = document.createElement("span");
  kindLabel.className = "draw-properties-label";
  kindLabel.id = identifier("draw-hatch-label");
  kindLabel.setAttribute("aria-hidden", "true");
  const kindButton = document.createElement("button");
  kindButton.type = "button";
  kindButton.className = "draw-button draw-properties-menu";
  kindButton.id = identifier("draw-hatch-menu");
  kindButton.setAttribute("aria-haspopup", "menu");
  kindButton.setAttribute("aria-expanded", "false");
  const kindPicture = document.createElement("span");
  kindPicture.className = "draw-properties-menu-picture";
  kindPicture.setAttribute("aria-hidden", "true");
  const kindText = document.createElement("span");
  kindText.className = "draw-properties-menu-text";
  kindButton.append(kindPicture, kindText);
  const arrow = iconEl("draw-section");
  if (arrow !== null) kindButton.append(arrow);
  kindRoot.append(kindLabel, kindButton);
  /// La figura che il pulsante mostra adesso.
  let drawn: string | null = null;

  const fields = document.createElement("div");
  fields.className = "draw-hatch-fields";
  fields.setAttribute("role", "group");
  fields.hidden = true;
  const fieldsError = document.createElement("p");
  fieldsError.className = "draw-properties-error";
  fieldsError.id = identifier("draw-hatch-error");
  fieldsError.hidden = true;

  const motifGroup = document.createElement("div");
  motifGroup.className = "draw-hatch-motif";
  motifGroup.setAttribute("role", "group");
  motifGroup.hidden = true;
  const motifError = document.createElement("p");
  motifError.className = "draw-properties-error";
  motifError.id = identifier("draw-hatch-error");
  motifError.hidden = true;

  element.append(note, kindRoot, fields, motifGroup);

  const textInput = (): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "draw-properties-input";
    input.id = identifier("draw-hatch-field");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.enterKeyHint = "done";
    return input;
  };

  /// Un campo nella griglia di `parent`, alla colonna `column`: un colore (col
  /// campione e il selettore), un numero (con la sua unità) o un nome.
  const createField = (parent: HTMLElement, id: FieldId, column: "1" | "2" | "all", error: HTMLElement): Field => {
    const root = document.createElement("div");
    root.className = "draw-properties-field";
    root.dataset.column = column;
    root.dataset.field = `hatch-${id}`;
    const input = textInput();
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = input.id;
    const name = document.createElement("span");
    let spoken: HTMLElement | null = null;
    let unit: HTMLElement | null = null;
    let chip: HTMLButtonElement | null = null;
    let frame: HTMLElement | null = null;
    let swatch: HTMLElement | null = null;
    let picker: HTMLInputElement | null = null;
    const box = document.createElement("div");
    if (id === "color" || id === "background") {
      box.className = "draw-properties-paint";
      chip = document.createElement("button");
      chip.type = "button";
      chip.className = "draw-button draw-properties-chip";
      chip.id = identifier("draw-hatch-chip");
      chip.setAttribute("aria-haspopup", "menu");
      chip.setAttribute("aria-expanded", "false");
      frame = document.createElement("span");
      frame.className = "draw-swatch-frame";
      swatch = document.createElement("span");
      swatch.className = "draw-swatch";
      frame.append(swatch);
      chip.append(frame);
      picker = document.createElement("input");
      picker.type = "color";
      picker.className = "draw-properties-picker";
      box.append(chip, input, picker);
      label.append(name);
    } else if (id === "name") {
      input.spellcheck = true;
      input.setAttribute("autocapitalize", "sentences");
      box.className = "draw-properties-name";
      box.append(input);
      label.append(name);
    } else {
      input.setAttribute("role", "spinbutton");
      input.inputMode = "decimal";
      box.className = "draw-properties-number";
      spoken = document.createElement("span");
      spoken.className = "sr-only";
      unit = document.createElement("span");
      unit.className = "draw-properties-unit";
      unit.setAttribute("aria-hidden", "true");
      box.append(input, unit);
      label.append(name, spoken);
    }
    root.append(label, box);
    parent.append(root);
    return { id, root, label, name, spoken, unit, input, chip, frame, swatch, picker, error, shown: "" };
  };

  const colorField = createField(fields, "color", "all", fieldsError);
  const backgroundField = createField(fields, "background", "all", fieldsError);
  const spacingField = createField(fields, "spacing", "1", fieldsError);
  const widthField = createField(fields, "width", "2", fieldsError);
  const angleField = createField(fields, "angle", "1", fieldsError);
  fields.append(fieldsError);
  const nameField = createField(motifGroup, "name", "all", motifError);
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "draw-button";
  motifGroup.append(deleteButton, motifError);
  const allFields = [colorField, backgroundField, spacingField, widthField, angleField, nameField];

  // --- Ciò che si mostra ----------------------------------------------------------

  const motifs = (): readonly HatchMotif[] => view.motifs;

  /// Il motivo del documento che gli oggetti scelti hanno tutti.
  const chosenMotif = (): HatchMotif | null => {
    const id = motifIdOf(view.hatch.choice);
    return id === null ? null : (motifs().find((each) => each.id === id) ?? null);
  };

  /// Come il menu dice la scelta di adesso.
  const choiceText = (): string => {
    const choice = view.hatch.choice;
    if (choice === null) return t("draw.properties.mixed");
    if (choice === "none") return t("draw.hatch.none");
    if (choice === "custom") return t("draw.hatch.custom");
    if (choice === "other") return t("draw.hatch.other");
    if (motifIdOf(choice) !== null) return chosenMotif()?.name ?? t("draw.hatch.other");
    return t(PRESET_LABELS[choice as HatchPreset]);
  };

  /// Il colore che il campo `field` mostra e l'ultimo scritto: `#rrggbb`,
  /// `none` per un fondo che manca, `null` se misto.
  const colorOf = (field: Field): string | null => (field === colorField ? view.hatch.color : view.hatch.background);

  /// Il testo di un colore nel campo: il codice, «Nessuno» per il fondo che
  /// manca, vuoto se misto.
  const colorText = (value: string | null): string => (value === null ? "" : value === "none" ? t("draw.properties.none") : value);

  /// Il testo con cui `field` mostra il disegno.
  const textOf = (field: Field): string => {
    const hatch = view.hatch;
    switch (field.id) {
      case "color":
      case "background":
        return colorText(colorOf(field));
      case "spacing":
        return hatch.spacing === null ? "" : lengthText(hatch.spacing);
      case "width":
        return hatch.width === null ? "" : lengthText(hatch.width);
      case "angle":
        return hatch.angle === null ? "" : numberText(hatch.angle, 2);
      case "name":
        return chosenMotif()?.name ?? "";
    }
  };

  // --- Gli errori -----------------------------------------------------------------

  const showError = (field: Field | null, errorOf: HTMLElement, text: string | null): void => {
    errorOf.hidden = text === null;
    setText(errorOf, text ?? "");
    for (const each of allFields) {
      if (each.error !== errorOf) continue;
      if (text !== null && each === field) {
        each.input.setAttribute("aria-invalid", "true");
        each.input.setAttribute("aria-describedby", errorOf.id);
      } else {
        each.input.removeAttribute("aria-invalid");
        each.input.removeAttribute("aria-describedby");
      }
    }
  };

  /// Dice che cosa non va in `field`, e a voce se `loud`. Torna falso.
  const fail = (field: Field, text: string, loud: boolean): false => {
    showError(field, field.error, text);
    if (loud) options.announce(text);
    return false;
  };

  // --- Mostrare -----------------------------------------------------------------

  /// Mostra `text` in `field`, a meno che non vi si stia scrivendo; con
  /// `fresh` anche allora.
  const showField = (field: Field, text: string, fresh: boolean): void => {
    const editing = document.activeElement === field.input && field.input.value !== field.shown;
    field.shown = text;
    if (editing && !fresh) return;
    field.input.value = text;
    if (field.input.getAttribute("aria-invalid") === "true") showError(null, field.error, null);
  };

  /// Il campione di un campo di colore: la forma e il colore di `value`.
  const showChip = (field: Field, value: string | null): void => {
    if (field.frame === null || field.swatch === null) return;
    const code = value === null || value === "none" ? null : customColor(value);
    field.frame.dataset.shape = value === null ? "mixed" : value === "none" ? "none" : code === null ? "mixed" : (swatchOf(code)?.shape ?? "ring");
    if (code === null) field.swatch.style.removeProperty("--swatch");
    else field.swatch.style.setProperty("--swatch", code);
  };

  /// Scrive nel campo di un numero il nome, l'unità e i limiti.
  const paintNumber = (field: Field, name: DrawKey, value: number | null, text: string, unit: string, limits: { readonly min: number; readonly max: number }, fresh: boolean): void => {
    setText(field.name, t(name));
    if (field.spoken !== null) setText(field.spoken, unit === "" ? "" : ` (${unit})`);
    if (field.unit !== null) setText(field.unit, unit);
    showField(field, text, fresh);
    field.input.readOnly = !editable;
    field.input.placeholder = value === null ? t("draw.properties.mixed") : "";
    if (value === null) {
      field.input.removeAttribute("aria-valuenow");
      field.input.setAttribute("aria-valuetext", t("draw.properties.mixed"));
    } else {
      field.input.setAttribute("aria-valuenow", String(field === angleField ? Math.round(value * 100) / 100 : shownLength(value)));
      field.input.setAttribute("aria-valuetext", unit === "" ? text : `${text} ${unit}`);
    }
    field.input.setAttribute("aria-valuemin", String(limits.min));
    field.input.setAttribute("aria-valuemax", String(limits.max));
  };

  const paintColor = (field: Field, name: DrawKey, fresh: boolean): void => {
    const value = colorOf(field);
    setText(field.name, t(name));
    showField(field, colorText(value), fresh);
    field.input.readOnly = !editable;
    field.input.placeholder = value === null ? t("draw.properties.mixed") : "";
    const label = t(name);
    const chipText = t("draw.properties.swatches", { label });
    field.chip!.setAttribute("aria-label", chipText);
    field.chip!.title = chipText;
    field.chip!.disabled = !editable;
    field.picker!.setAttribute("aria-label", t("draw.properties.picker", { label }));
    field.picker!.disabled = !editable;
    // Mentre il selettore mostra un colore, il campione lo segue.
    if (picking !== field) {
      showChip(field, field.input.value === field.shown ? value : (customColor(field.input.value) ?? value));
      field.picker!.value = value === null || value === "none" ? "#000000" : value;
    }
  };

  function paint(fresh = false): void {
    painting = true;
    try {
      const hatch = view.hatch;
      // La nota: ciò che i campi non raggiungono.
      let noteText = "";
      if (hatch.choice === "other") noteText = t("draw.hatch.note.other");
      else if (hatch.choice === null && hatch.hatched === 0) noteText = t("draw.hatch.note.mixed");
      else if (hatch.choice === null && hatch.hatched < hatch.count) noteText = plural(hatch.hatched, "draw.hatch.note.some.one", "draw.hatch.note.some.other");
      note.hidden = noteText === "";
      setText(note, noteText);

      // Il menu: il nome del campo, la scelta e la sua figura.
      setText(kindLabel, t("draw.hatch.kind"));
      const summary = choiceText();
      setText(kindText, summary);
      const picture = hatchIcon(hatch.choice);
      if (picture !== drawn) {
        const glyph = picture === null ? null : iconEl(picture);
        kindPicture.replaceChildren(...(glyph === null ? [] : [glyph]));
        drawn = picture;
      }
      const spoken = t("draw.properties.menu_name", { label: t("draw.hatch.kind"), value: summary });
      kindButton.setAttribute("aria-label", spoken);
      kindButton.title = spoken;
      offWhen(kindButton, !editable);

      // I campi della campitura.
      fields.hidden = hatch.hatched === 0;
      fields.setAttribute("aria-label", t("draw.action.hatch"));
      const dots = hatch.kind === "dots";
      paintColor(colorField, "draw.hatch.color", fresh);
      paintColor(backgroundField, "draw.hatch.background", fresh);
      paintNumber(
        spacingField,
        "draw.hatch.spacing",
        hatch.spacing,
        textOf(spacingField),
        view.unit,
        { min: shownLength(MIN_SPACING), max: shownLength(MAX_SPACING) },
        fresh,
      );
      paintNumber(
        widthField,
        dots ? "draw.hatch.diameter" : "draw.hatch.width",
        hatch.width,
        textOf(widthField),
        view.unit,
        { min: shownLength(MIN_WIDTH), max: shownLength(hatch.spacing ?? MAX_SPACING) },
        fresh,
      );
      paintNumber(angleField, "draw.hatch.angle", hatch.angle, textOf(angleField), "°", { min: -180, max: 180 }, fresh);

      // Il motivo del documento scelto, all'Esperto.
      const motif = view.expert ? chosenMotif() : null;
      motifGroup.hidden = motif === null;
      motifGroup.setAttribute("aria-label", t("draw.hatch.motif.group", { name: motif?.name ?? "" }));
      setText(nameField.name, t("draw.hatch.name"));
      showField(nameField, textOf(nameField), fresh);
      nameField.input.readOnly = !editable;
      setText(deleteButton, t("draw.hatch.delete"));
      offWhen(deleteButton, !editable);
    } finally {
      painting = false;
    }
  }

  // --- La campitura sul disegno ---------------------------------------------------

  /// Manda `change` all'editor, col nome `label`. `null` se è fatto,
  /// altrimenti perché no, già detto a voce se `loud`.
  const send = (change: HatchChange, label: DrawKey, loud = true): string | null => {
    if (!editable) {
      if (loud) options.announce(readOnly());
      return readOnly();
    }
    carry = true;
    let failure: string | null;
    try {
      failure = options.onChange(change, label);
    } finally {
      carry = false;
    }
    if (failure !== null && loud) options.announce(failure);
    return failure;
  };

  /// Manda `change` per `field`, che dice già `text`; falso, e il campo
  /// resta com'era scritto, se il disegno non l'accetta.
  const sendFrom = (field: Field, change: HatchChange, label: DrawKey, text: string, loud: boolean): boolean => {
    const draft = field.input.value;
    const before = field.shown;
    // Il campo dice già il valore nuovo: l'aggiornamento che arriva mentre
    // l'editor lo scrive non lo prende per un valore scritto a metà.
    field.input.value = field.shown = text;
    showError(null, field.error, null);
    const failure = send(change, label, false);
    if (failure === null) return true;
    field.shown = before;
    field.input.value = draft;
    return fail(field, failure, loud);
  };

  // --- Il menu --------------------------------------------------------------------

  /// Sceglie `change` dal menu del tipo; una scelta già in corso non cambia
  /// niente.
  const choose = (change: HatchChange): void => {
    send(change, "none" in change ? "draw.action.hatch_none" : "draw.action.hatch");
  };

  const menuItems = (): MenuItem[] => {
    const choice = view.hatch.choice;
    const items: MenuItem[] = [
      {
        label: t("draw.hatch.none"),
        icon: "draw-hatch-none",
        choice: "radio",
        checked: choice === "none",
        ...(choice === "none" ? { selected: true } : {}),
        run: () => {
          if (view.hatch.choice !== "none") choose({ none: true });
        },
      },
      ...HATCH_PRESETS.map(
        (preset): MenuItem => ({
          label: t(PRESET_LABELS[preset]),
          icon: `draw-hatch-${preset}`,
          choice: "radio",
          checked: choice === preset,
          ...(choice === preset ? { selected: true } : {}),
          run: () => {
            if (view.hatch.choice !== preset) choose({ preset });
          },
        }),
      ),
    ];
    if (!view.expert) return items;
    motifs().forEach((motif, at) => {
      const value = `pattern:${motif.id}` as const;
      items.push({
        label: motif.name,
        icon: "draw-hatch-pattern",
        choice: "radio",
        checked: choice === value,
        separator: at === 0,
        swatches: [motif.color],
        ...(choice === value ? { selected: true } : {}),
        run: () => {
          if (view.hatch.choice !== value) choose({ pattern: motif.id });
        },
      });
    });
    const reason = editable ? options.motifReason() : readOnly();
    items.push({
      label: t("draw.hatch.motif.make"),
      separator: true,
      disabled: reason !== null,
      ...(reason === null ? {} : { description: reason }),
      run: () => options.onMotif(),
    });
    return items;
  };

  const openMenu = (): void => {
    if (!editable) return options.announce(readOnly());
    kindButton.setAttribute("aria-expanded", "true");
    showContextMenu(kindButton, menuItems(), { labelledBy: kindLabel.id, onClose: () => kindButton.setAttribute("aria-expanded", "false") });
  };
  life.listen(kindButton, "click", openMenu);
  life.listen(kindButton, "keydown", (event) => {
    if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });

  // --- I colori -------------------------------------------------------------------

  /// Il colore scritto: un codice, un nome, o un campione del documento per
  /// nome, senza badare alle maiuscole; il fondo anche «nessuno», che è
  /// `"none"`. `null` se non è un colore.
  const colorWritten = (field: Field, text: string): string | null => {
    const name = text.trim().toLocaleLowerCase();
    if (field === backgroundField && (name === "none" || name === t("draw.properties.none").toLocaleLowerCase())) return "none";
    const swatch = name === "" ? undefined : view.swatches.find((each) => each.name.toLocaleLowerCase() === name);
    return swatch?.color ?? customColor(text);
  };

  /// Scrive `code`, `#rrggbb` o `none` per il fondo, nel campo di colore
  /// `field`.
  const writeColor = (field: Field, code: string, loud: boolean): boolean => {
    if (code === colorOf(field)) {
      field.input.value = field.shown = colorText(code);
      showError(null, field.error, null);
      showChip(field, code);
      return true;
    }
    const change: HatchChange = field === colorField ? { color: code } : { background: code === "none" ? null : code };
    showChip(field, code);
    field.picker!.value = code === "none" ? field.picker!.value : code;
    const done = sendFrom(field, change, ACTIONS[field.id as "color" | "background"], colorText(code), loud);
    if (!done) showChip(field, colorOf(field));
    return done;
  };

  const commitColor = (field: Field, text: string, loud: boolean): boolean => {
    const code = colorWritten(field, text);
    if (code === null) return fail(field, t(field === backgroundField ? "draw.properties.problem.paint.swatch" : "draw.effects.problem.color"), loud);
    return writeColor(field, code, loud);
  };

  /// Le voci del campione di `field`: «Nessuno», se il campo lo vuole, i
  /// campioni del documento e i colori della tavolozza, ciascuno col suo
  /// nome; quello di adesso è segnato. Ogni voce scrive il colore.
  const chipItems = (field: Field): MenuItem[] => {
    const current = colorOf(field);
    const item = (label: string, code: string, extra: Partial<MenuItem> = {}): MenuItem => ({
      label,
      choice: "radio",
      checked: current === code,
      ...(code === "none" ? {} : { swatches: [code] }),
      ...extra,
      run: () => {
        writeColor(field, code, true);
      },
    });
    const groups: MenuItem[][] = [
      view.swatches.map((swatch) => item(swatch.name, swatch.color, { description: t("draw.colors.menu.swatch_note", { code: swatch.color }) })),
      PALETTE.map((swatch) => item(t(swatch.label), swatch.color)),
    ];
    const items: MenuItem[] = field === backgroundField ? [item(t("draw.properties.none"), "none")] : [];
    for (const group of groups) {
      if (group.length === 0) continue;
      group[0]!.separator = items.length > 0;
      items.push(...group);
    }
    return items;
  };

  const openChip = (field: Field): void => {
    if (!editable) return options.announce(readOnly());
    const chip = field.chip!;
    chip.setAttribute("aria-expanded", "true");
    showContextMenu(chip, chipItems(field), { labelledBy: chip.id, onClose: () => chip.setAttribute("aria-expanded", "false") });
  };
  for (const field of [colorField, backgroundField]) life.listen(field.chip!, "click", () => openChip(field));

  // --- I numeri -------------------------------------------------------------------

  /// Il valore scritto in `field`, per il disegno, in unità della scena o in
  /// gradi, o il messaggio di che cosa non va.
  const numberWritten = (field: Field, text: string): { readonly value: number } | { readonly problem: string } => {
    const hatch = view.hatch;
    if (field === angleField) {
      const out = evaluate(text, { units: ANGLE_UNITS, current: hatch.angle, relative: false });
      if ("problem" in out) return { problem: t(PROBLEMS[out.problem], { units: Object.keys(ANGLE_UNITS).join(", ") }) };
      return { value: normalAngle(out.value) };
    }
    const units = lengthUnits(view.unit);
    const current = field === spacingField ? hatch.spacing : hatch.width;
    const out = evaluate(text, { units, current: current === null ? null : shownLength(current), relative: true });
    if ("problem" in out) return { problem: t(PROBLEMS[out.problem], { units: Object.keys(units).join(", ") }) };
    const scene = fromUnit(out.value, view.unit);
    return { value: field === spacingField ? clampSpacing(scene) : clampWidth(scene, hatch.spacing ?? MAX_SPACING) };
  };

  /// Il nome del passo della cronologia di un campo di numero.
  const numberLabel = (field: Field): DrawKey => (field === widthField && view.hatch.kind === "dots" ? "draw.action.hatch_diameter" : ACTIONS[field.id as "spacing" | "width" | "angle"]);

  /// Il testo con cui un campo di numero dice `value`.
  const numberShown = (field: Field, value: number): string => (field === angleField ? numberText(value, 2) : lengthText(value));

  /// Il valore di adesso del campo di numero `field`; `null` se misto.
  const currentOf = (field: Field): number | null => (field === angleField ? view.hatch.angle : field === spacingField ? view.hatch.spacing : view.hatch.width);

  const changeOf = (field: Field, value: number): HatchChange => (field === angleField ? { angle: value } : field === spacingField ? { spacing: value } : { width: value });

  /// Scrive `value` nel campo di numero `field`.
  const writeNumber = (field: Field, value: number, loud: boolean): boolean => {
    if (value === currentOf(field)) {
      field.input.value = field.shown;
      showError(null, field.error, null);
      return true;
    }
    return sendFrom(field, changeOf(field, value), numberLabel(field), numberShown(field, value), loud);
  };

  const commitNumber = (field: Field, loud: boolean): boolean => {
    if (!editable || field.input.value === field.shown) return true;
    const out = numberWritten(field, field.input.value);
    if ("problem" in out) return fail(field, out.problem, loud);
    return writeNumber(field, out.value, loud);
  };

  /// Su e giù: il valore di adesso, o quello scritto, cambia di `delta` e
  /// parte. Un valore misto senza niente di scritto non ha da dove partire.
  const step = (field: Field, delta: number): void => {
    if (!editable) return options.announce(readOnly());
    let base: number | null;
    const typed = field.input.value !== field.shown && field.input.value.trim() !== "";
    if (typed) {
      const out = numberWritten(field, field.input.value);
      if ("problem" in out) {
        fail(field, out.problem, true);
        return;
      }
      base = out.value;
    } else {
      base = currentOf(field);
    }
    if (base === null) {
      options.announce(t("draw.properties.problem.mixed"));
      return;
    }
    let value: number;
    if (field === angleField) {
      value = normalAngle(base + delta);
    } else {
      // Il passo si conta nell'unità del campo, come lo si legge.
      const scene = fromUnit(shownLength(base) + delta, view.unit);
      value = field === spacingField ? clampSpacing(scene) : clampWidth(scene, view.hatch.spacing ?? MAX_SPACING);
    }
    writeNumber(field, value, true);
  };

  // --- Il motivo ------------------------------------------------------------------

  /// I campioni e i motivi del documento, per i nomi.
  const names = (): ReadonlyArray<{ readonly id: string; readonly name: string }> => [...view.swatches, ...motifs()];

  const commitName = (loud: boolean): boolean => {
    const motif = chosenMotif();
    const field = nameField;
    if (motif === null || !view.expert || !editable || field.input.value === field.shown) return true;
    const name = cleanName(field.input.value);
    const problem = swatchNameProblem(names(), name, motif.id);
    if (problem !== null) {
      const text = problem === "empty" ? t("draw.colors.problem.empty") : t(problem === "taken" ? "draw.hatch.problem.taken" : "draw.colors.problem.reads_color", { name });
      return fail(field, text, loud);
    }
    if (name === motif.name) {
      field.input.value = field.shown;
      showError(null, field.error, null);
      return true;
    }
    const draft = field.input.value;
    const before = field.shown;
    field.input.value = field.shown = name;
    showError(null, field.error, null);
    carry = true;
    let failure: string | null;
    try {
      failure = options.onRename(motif.id, name);
    } finally {
      carry = false;
    }
    if (failure === null) return true;
    field.shown = before;
    field.input.value = draft;
    return fail(field, failure, loud);
  };

  life.listen(deleteButton, "click", () => {
    const motif = chosenMotif();
    if (motif === null) return;
    if (!editable) return options.announce(readOnly());
    carry = true;
    let failure: string | null;
    try {
      failure = options.onDelete(motif.id);
    } finally {
      carry = false;
    }
    if (failure !== null) {
      showError(nameField, motifError, failure);
      options.announce(failure);
      return;
    }
    // Il motivo se n'è andato con i suoi campi: il fuoco resta nella
    // sezione, al menu.
    kindButton.focus({ preventScroll: true });
  });

  // --- I tasti --------------------------------------------------------------------

  /// Il campo di cui `target` è il controllo che si scrive o il selettore.
  const locate = (target: EventTarget | null): Field | null => (target instanceof Node ? (allFields.find((each) => each.input === target || each.picker === target) ?? null) : null);

  life.listen(element, "keydown", (event) => {
    const field = locate(event.target);
    if (field === null || event.target !== field.input) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Escape" && plain && !event.shiftKey) {
      // Senza niente da annullare, Esc torna al foglio, come negli altri
      // campi.
      if (field.input.value === field.shown) return;
      field.input.value = field.shown;
      showError(null, field.error, null);
      if (field.picker !== null) field.picker.value = customColor(field.shown) ?? field.picker.value;
      if (field.chip !== null) showChip(field, colorOf(field));
    } else if (event.key === "Enter" && plain && !event.shiftKey) {
      if (field === nameField) commitName(true);
      else if (field === colorField || field === backgroundField) {
        if (field.input.value !== field.shown) commitColor(field, field.input.value, true);
      } else commitNumber(field, true);
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain && (field === spacingField || field === widthField || field === angleField)) {
      step(field, (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(element, "focusout", (event) => {
    if (painting) return;
    const field = locate(event.target);
    // Un campo che se n'è andato non scrive: il valore a metà era per ciò
    // che mostrava prima.
    if (field === null || event.target === field.picker || field.root.closest("[hidden]") !== null) return;
    if (field === nameField) commitName(false);
    else if (field === colorField || field === backgroundField) {
      if (field.input.value !== field.shown) commitColor(field, field.input.value, false);
    } else commitNumber(field, false);
  });

  // Mentre si scrive un colore, il campione lo segue; uno che non si legge
  // lascia quello di adesso.
  life.listen(element, "input", (event) => {
    const field = locate(event.target);
    if (field === null || field.chip === null) return;
    const picker = field.picker;
    if (picker !== null && event.target === picker) {
      if (!editable) return;
      picking = field;
      field.input.value = picker.value.toLowerCase();
      showChip(field, picker.value);
    } else if (event.target === field.input) {
      showChip(field, colorWritten(field, field.input.value) ?? colorOf(field));
    }
  });

  // Il selettore del sistema scrive quando si sceglie.
  life.listen(element, "change", (event) => {
    const field = locate(event.target);
    if (field === null || field.picker === null || event.target !== field.picker) return;
    picking = null;
    if (!editable) return options.announce(readOnly());
    if (!commitColor(field, field.picker.value, true)) paint();
  });

  life.listen(element, "focusin", (event) => {
    if (picking === null) return;
    const field = locate(event.target);
    if (field === picking) return;
    // Il selettore si è chiuso senza scegliere: il campo torna al disegno.
    const back = picking;
    picking = null;
    back.input.value = back.shown;
    paint();
  });

  const relabel = (): void => {
    formats = null;
    paint(true);
  };
  relabel();

  /// Vero se `node`, dentro la sezione, sta in un pezzo nascosto.
  const hiddenWithin = (node: Element): boolean => {
    for (let at: Element | null = node; at !== null && at !== element; at = at.parentElement) if ((at as HTMLElement).hidden) return true;
    return false;
  };

  return {
    element,
    update(next, nextEditable) {
      const active = document.activeElement;
      const focused = element.contains(active);
      const fresh = next.key !== lastKey && !carry;
      lastKey = next.key;
      view = next;
      editable = nextEditable;
      paint(fresh);
      // Un campo che se n'è andato lascia il fuoco al menu, nella sezione.
      if (focused && active instanceof Element && hiddenWithin(active)) kindButton.focus({ preventScroll: true });
    },
    relabel,
  };
}
