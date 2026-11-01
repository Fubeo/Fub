// Il pannello delle proprietà (livello Standard): com'è fatta e come si vede
// la selezione, in campi che si scrivono, accanto al foglio; senza
// selezione, il documento e la vista. Che cosa mostra lo decide l'editor, e
// lui scrive ogni cambio; qui c'è come si legge, si scrive e si raggiunge.
//
// - **Sezioni che si chiudono.** Posizione e misure, Forma, Aspetto, Testo e
//   Disponi; senza selezione Documento e Vista. L'intestazione di una
//   sezione è il pulsante che la apre e la chiude, e il pannello dice
//   all'editor quali sono chiuse, che le ricorda.
// - **Un campo misto dice «Misto»** e non ha valore: scriverlo dà il valore a
//   tutti gli oggetti scelti, in un passo.
// - **Un colore si scrive** come codice, come nome (`red`) o col nome di un
//   campione del documento, o si sceglie dal menu del suo campione; sotto,
//   il contrasto con la carta, col rapporto e il livello di WCAG.
// - **I numeri si calcolano** (`quantity.ts`): `120+15`, `25mm`, `50%`. Su e
//   giù cambiano il valore di 1, con Maiusc di 10, e partono subito: i passi
//   che si seguono hanno lo stesso nome, e la cronologia li unisce.
// - **Un valore parte con Invio, o lasciando il campo**, come negli
//   attributi; Esc lo riporta a com'era, e di nuovo torna al foglio. Un
//   valore che non va resta scritto e segnato, col messaggio accanto.
// - **Il disegno può cambiare mentre si scrive**: un campo col fuoco e un
//   valore scritto a metà non si tocca; una selezione nuova lo riporta a
//   com'è.
// - **I pulsanti non prendono il fuoco al clic**, come quelli della barra
//   della selezione: dopo «Allinea a sinistra» Canc elimina ancora. Dalla
//   tastiera, una fila di pulsanti è una barra col roving tabindex.
// - **Un campo a menu** è un pulsante che dice la scelta di adesso, con la
//   sua figura, e ne apre le voci: Invio, Spazio e le frecce su e giù lo
//   aprono sulla voce segnata, Esc lo chiude e riporta il fuoco al pulsante.
//   Una voce è una scelta fra le altre, segnata, o un comando; la scelta
//   parte come quella di un elenco.
// - **Il pannello tiene i suoi tasti**, come quello degli attributi: le
//   scorciatoie del foglio non partono da qui.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { ensureDrawIcons } from "../icons";
import type { Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";
import { createColorPicker, type ColorPicker } from "../../../kit/color/picker";
import { openPopover, type PopoverHandle } from "../../../kit/popover";
import { drawPickerText } from "./color-text";
import { contrast, MIN_CONTRAST, MIN_TEXT_CONTRAST, over } from "../scene/analysis";
import { paint } from "../scene/values";
import { t, type DrawKey } from "../strings";
import { cleanName } from "./naming";
import { customColor, PALETTE, swatchOf } from "./palette";
import { evaluate, type QuantityProblem } from "./quantity";
import type { PaintSample } from "./resources";

/// Le sezioni, nell'ordine in cui si vedono.
export type SectionId =
  | "place"
  | "arrange"
  | "look"
  | "fill"
  | "stroke"
  | "text"
  | "exportSelection"
  | "document"
  | "view";

export type NumberId =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "strokeWidth"
  | "opacity"
  | "size"
  | "leading"
  | "spacing"
  | "pageWidth"
  | "pageHeight";

export type PaintId = "fill" | "stroke";
export type ChoiceId = "dash" | "preset" | "family" | "weight" | "pagePreset" | "unit";
/// I campi a menu: le punte delle linee, all'inizio e alla fine.
export type MenuId = "tipStart" | "tipEnd";
export type SwitchId = "grid" | "snap" | "bar";
export type FieldId = NumberId | PaintId | ChoiceId | MenuId | SwitchId | "ratio" | "emphasis" | "anchor" | "pageOrientation" | "desc";

export type ActionId =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-x"
  | "distribute-y"
  | "order-front"
  | "order-forward"
  | "order-backward"
  | "order-back";

interface FieldBase {
  /// Il nome del campo, come si legge e come si sente.
  readonly label: string;
  /// Una riga sotto il campo, detta con lui.
  readonly note?: string;
  /// C'è, ma adesso non si cambia.
  readonly disabled?: boolean;
}

/// Un numero, nell'unità del campo.
export interface NumberState extends FieldBase {
  readonly kind: "number";
  /// Il valore; `null` se la selezione ne ha più d'uno.
  readonly value: number | null;
  /// La sigla dell'unità accanto al valore, o `""`.
  readonly unit: string;
  /// Le unità che il campo accetta, minuscole, e quanto vale ciascuna
  /// nell'unità del campo (`quantity.ts`).
  readonly units: Readonly<Record<string, number>>;
  /// Vero se `%` è una parte del valore.
  readonly relative: boolean;
  /// I decimali che il campo mostra, e a cui arrotonda ciò che si scrive.
  readonly places: number;
  readonly min?: number;
  readonly max?: number;
}

/// Un colore: `#rrggbb`, `none`, `url(#id)` per una risorsa, o com'è
/// scritto ciò che non è un colore.
export interface PaintState extends FieldBase {
  readonly kind: "paint";
  readonly value: string | null;
  /// Come si mostra `value` se è una sfumatura, un motivo o un campione del
  /// disegno.
  readonly sample?: PaintSample;
  /// Su che cosa si misura il contrasto del colore; senza, non si misura.
  readonly contrast?: PaintContrast;
}

/// Il contrasto di un colore con la carta: il colore della carta, `#rrggbb`;
/// l'opacità con cui il colore le sta sopra; vero `text` se il colore è di
/// testi, che chiedono di più. Le soglie sono quelle di WCAG 2.2: per il
/// testo normale 4,5:1 (AA) e 7:1 (AAA), per quello grande 3:1 e 4,5:1, per
/// una forma 3:1.
export interface PaintContrast {
  readonly paper: string;
  readonly alpha: number;
  readonly text: boolean;
}

/// Un campione del documento, come lo scrive il campo di un colore.
export interface FieldSwatch {
  readonly id: string;
  /// Il nome, già pulito.
  readonly name: string;
  /// `#rrggbb` minuscolo.
  readonly color: string;
}

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  /// Una riga di separazione prima della voce, fra gruppi di voci.
  readonly separator?: boolean;
}

/// Una scelta fra voci.
export interface ChoiceState extends FieldBase {
  readonly kind: "choice";
  readonly value: string | null;
  readonly options: readonly ChoiceOption[];
}

/// Una voce del menu di un campo a menu.
export interface MenuOption {
  /// Ciò che si scrive scegliendola.
  readonly value: string;
  readonly label: string;
  /// L'icona accanto al nome (`ui/icons.ts`); senza, il nome soltanto.
  readonly icon?: string;
  /// La voce di adesso: è segnata, e da lei parte il fuoco quando il menu si
  /// apre. Sceglierla di nuovo non cambia niente.
  readonly checked?: boolean;
  /// C'è, ma adesso non si sceglie.
  readonly disabled?: boolean;
  /// Una riga di separazione prima della voce.
  readonly separator?: boolean;
  /// Un comando e non una scelta fra le altre: non ha uno stato da segnare,
  /// e si dà ogni volta che lo si sceglie.
  readonly action?: boolean;
  /// Una riga sotto il nome: che cosa fa la voce, o perché adesso non si
  /// sceglie.
  readonly note?: string;
}

/// Una scelta da un menu: un pulsante che dice quella di adesso e apre le
/// voci.
export interface MenuChoiceState extends FieldBase {
  readonly kind: "menu";
  /// Il valore di adesso, che dà la figura del pulsante: quella della voce
  /// che lo ha; `null` se la selezione ne ha più d'uno.
  readonly value: string | null;
  /// La scelta di adesso a parole, sul pulsante e per chi ascolta; senza, il
  /// nome della voce di `value`, o «Misto».
  readonly summary?: string;
  readonly options: readonly MenuOption[];
}

/// Un interruttore della vista: si cambia anche in un documento che si legge
/// soltanto.
export interface SwitchState extends FieldBase {
  readonly kind: "switch";
  readonly on: boolean;
}

/// Un pulsante che resta premuto, come il lucchetto delle proporzioni.
export interface PressState extends FieldBase {
  readonly kind: "press";
  readonly on: boolean;
}

export interface SegmentOption extends ChoiceOption {
  readonly icon: string;
}

/// Una scelta fra pochi pulsanti con un'icona, come l'allineamento del testo.
export interface SegmentState extends FieldBase {
  readonly kind: "segment";
  readonly value: string | null;
  readonly options: readonly SegmentOption[];
}

/// Un interruttore di una fila: acceso, spento, o `null` se una parte
/// della scelta l'ha e un'altra no.
export interface ToggleOption extends SegmentOption {
  readonly on: boolean | null;
}

/// Una fila di interruttori con un'icona, come grassetto e corsivo. Ognuno
/// scrive `valore:true` o `valore:false`: acceso se era spento o misto.
export interface TogglesState extends FieldBase {
  readonly kind: "toggles";
  readonly options: readonly ToggleOption[];
}

/// Un testo di più righe.
export interface TextState extends FieldBase {
  readonly kind: "text";
  readonly value: string;
}

export type FieldState = NumberState | PaintState | ChoiceState | MenuChoiceState | SwitchState | PressState | SegmentState | TogglesState | TextState;

/// Un comando: il nome, e perché adesso non si usa.
export interface ActionState {
  readonly label: string;
  readonly disabled?: boolean;
  readonly note?: string;
}

/// Che cosa mostra il pannello.
export interface PropertiesView {
  /// Che cosa si mostra: la selezione, o il documento. Una chiave diversa
  /// lascia cadere i valori scritti a metà.
  readonly key: string;
  /// Che cosa si mostra, a parole: «Rettangolo», «3 oggetti».
  readonly subject: string;
  readonly editable: boolean;
  /// I campi che ci sono; quelli che mancano non si vedono, e una sezione
  /// senza niente nemmeno.
  readonly fields: Readonly<Partial<Record<FieldId, FieldState>>>;
  readonly actions: Readonly<Partial<Record<ActionId, ActionState>>>;
  /// Vero se c'è «Esporta la selezione».
  readonly exportSelection?: boolean;
  /// I campioni del documento, che i campi dei colori scrivono per nome e
  /// offrono nel menu del loro campione.
  readonly swatches?: readonly FieldSwatch[];
  /// I colori scelti di recente, dal più recente, per lo stesso menu.
  readonly recent?: readonly string[];
}

export interface PropertiesOptions {
  /// Le sezioni chiuse, come le ha ricordate l'editor.
  readonly closed: readonly SectionId[];
  /// Scrive un valore: `null` se il disegno l'ha accettato, altrimenti la
  /// ragione per cui no.
  onChange(id: FieldId, value: number | string | boolean): string | null;
  onAction(id: ActionId): void;
  /// Una sezione si apre o si chiude.
  onSection(id: SectionId, open: boolean): void;
  /// «Esporta…» di «Esporta la selezione»: la finestra, sulla selezione.
  onExportSelection?(): void;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
  /// Esc su un campo senza niente da annullare: il fuoco torna al foglio.
  onLeave(): void;
}

export interface Properties {
  /// Il pannello: titolo, oggetto, sezioni.
  readonly element: HTMLElement;
  /// Fra il titolo e le sezioni: ciò che l'editor ci mette (il titolo del
  /// disegno).
  readonly lead: HTMLElement;
  update(view: PropertiesView): void;
  /// Il fuoco al primo campo che si scrive, o al pannello.
  focus(): void;
  /// Apre la sezione `id` e le dà il fuoco. Falso se la sezione non c'è.
  focusSection(id: SectionId): boolean;
  /// Chiude le sezioni `ids` e apre le altre, come le ricorda l'editor,
  /// senza dirglielo.
  setClosed(ids: readonly SectionId[]): void;
  /// Riscrive i testi nella lingua di adesso: quelli dei campi arrivano con
  /// la vista dopo.
  relabel(): void;
}

/// Dove sta un campo nella griglia della sezione: una colonna di due, la
/// colonna stretta di un pulsante, o tutta la riga.
type Column = "1" | "2" | "3" | "all";

interface Spec {
  readonly id: FieldId;
  readonly kind: FieldState["kind"];
  readonly section: SectionId;
  readonly column: Column;
}

/// I campi, nell'ordine in cui si vedono.
const SPECS: readonly Spec[] = [
  { id: "x", kind: "number", section: "place", column: "1" },
  { id: "y", kind: "number", section: "place", column: "2" },
  { id: "width", kind: "number", section: "place", column: "1" },
  { id: "height", kind: "number", section: "place", column: "2" },
  { id: "ratio", kind: "press", section: "place", column: "3" },
  { id: "rotation", kind: "number", section: "place", column: "1" },
  { id: "opacity", kind: "number", section: "look", column: "1" },
  { id: "fill", kind: "paint", section: "fill", column: "all" },
  { id: "stroke", kind: "paint", section: "stroke", column: "all" },
  { id: "strokeWidth", kind: "number", section: "stroke", column: "1" },
  { id: "dash", kind: "choice", section: "stroke", column: "all" },
  { id: "tipStart", kind: "menu", section: "stroke", column: "all" },
  { id: "tipEnd", kind: "menu", section: "stroke", column: "all" },
  { id: "preset", kind: "choice", section: "text", column: "all" },
  { id: "family", kind: "choice", section: "text", column: "all" },
  { id: "size", kind: "number", section: "text", column: "1" },
  { id: "weight", kind: "choice", section: "text", column: "2" },
  { id: "emphasis", kind: "toggles", section: "text", column: "all" },
  { id: "leading", kind: "number", section: "text", column: "1" },
  { id: "spacing", kind: "number", section: "text", column: "2" },
  { id: "anchor", kind: "segment", section: "text", column: "all" },
  { id: "pagePreset", kind: "choice", section: "document", column: "all" },
  { id: "pageOrientation", kind: "segment", section: "document", column: "all" },
  { id: "pageWidth", kind: "number", section: "document", column: "1" },
  { id: "pageHeight", kind: "number", section: "document", column: "2" },
  { id: "unit", kind: "choice", section: "document", column: "all" },
  { id: "desc", kind: "text", section: "document", column: "all" },
  { id: "grid", kind: "switch", section: "view", column: "all" },
  { id: "snap", kind: "switch", section: "view", column: "all" },
  { id: "bar", kind: "switch", section: "view", column: "all" },
];

const SECTIONS: ReadonlyArray<{ readonly id: SectionId; readonly label: DrawKey }> = [
  { id: "place", label: "draw.properties.selection" },
  { id: "arrange", label: "draw.properties.arrange" },
  { id: "look", label: "draw.properties.look" },
  { id: "fill", label: "draw.properties.fill" },
  { id: "stroke", label: "draw.properties.stroke" },
  { id: "text", label: "draw.properties.text" },
  { id: "exportSelection", label: "draw.properties.export_section" },
  { id: "document", label: "draw.properties.document_section" },
  { id: "view", label: "draw.properties.view_section" },
];

/// I comandi di «Disponi», in tre barre: allineare, distribuire, ordinare.
const ACTION_ROWS: ReadonlyArray<{ readonly label: DrawKey; readonly actions: readonly ActionId[] }> = [
  { label: "draw.properties.align", actions: ["align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom"] },
  { label: "draw.properties.distribute", actions: ["distribute-x", "distribute-y"] },
  { label: "draw.order", actions: ["order-front", "order-forward", "order-backward", "order-back"] },
];

/// I nomi dei comandi prima che l'editor dica i suoi: un pulsante ha sempre
/// un nome, anche nascosto.
export const ACTION_LABELS: Readonly<Record<ActionId, DrawKey>> = {
  "align-left": "draw.align.left",
  "align-center": "draw.align.center",
  "align-right": "draw.align.right",
  "align-top": "draw.align.top",
  "align-middle": "draw.align.middle",
  "align-bottom": "draw.align.bottom",
  "distribute-x": "draw.distribute.x",
  "distribute-y": "draw.distribute.y",
  "order-front": "draw.order.front",
  "order-forward": "draw.order.forward",
  "order-backward": "draw.order.backward",
  "order-back": "draw.order.back",
};

/// I nomi dei campi che hanno pulsanti, prima che l'editor dica i suoi.
const DEFAULT_LABELS: Readonly<Partial<Record<FieldId, DrawKey>>> = {
  fill: "draw.properties.fill",
  stroke: "draw.properties.stroke",
  ratio: "draw.properties.ratio",
};

const PROBLEMS: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// Il formato dei numeri dei campi, nella lingua di adesso: senza
/// separatore delle migliaia, che un campo non rilegge.
const formats = new Map<number, Intl.NumberFormat>();
function numberText(value: number, places: number): string {
  let format = formats.get(places);
  if (format === undefined) {
    format = new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: places, useGrouping: false });
    formats.set(places, format);
  }
  const factor = 10 ** places;
  return format.format(Math.round(value * factor) / factor || 0);
}

const rounded = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor || 0;
};

/// Un campo disegnato.
interface Line {
  readonly spec: Spec;
  /// Il campo intero: nome, controllo, nota ed errore.
  readonly root: HTMLElement;
  /// Il nome che si vede.
  readonly name: HTMLElement;
  readonly note: HTMLElement;
  readonly error: HTMLElement;
  /// Il controllo che prende il fuoco e che il nome nomina.
  readonly control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLElement;
  /// La sigla dell'unità accanto al numero, e quella che si sente col nome.
  readonly unit: HTMLElement | null;
  readonly spoken: HTMLElement | null;
  /// Il campione e il selettore di un colore, e la riga del contrasto.
  readonly chip: HTMLButtonElement | null;
  readonly chipFrame: HTMLElement | null;
  readonly chipColor: HTMLElement | null;
  readonly contrast: HTMLElement | null;
  /// I pulsanti di una scelta a pulsanti, per valore.
  readonly segments: Map<string, HTMLButtonElement>;
  /// La figura e il testo del pulsante di un campo a menu.
  readonly picture: HTMLElement | null;
  readonly caption: HTMLElement | null;
  state: FieldState | null;
  /// Il testo scritto nel campo l'ultima volta: un campo che dice altro ha
  /// un valore scritto a metà.
  shown: string;
  /// Le voci della scelta disegnate, per non rifarle a ogni aggiornamento; di
  /// un campo a menu, l'icona del pulsante.
  options: string;
}

interface Section {
  readonly id: SectionId;
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly title: HTMLElement;
  readonly body: HTMLElement;
  open: boolean;
}

/// Un colore scritto nel campo: il valore che si scrive nel disegno e il
/// testo con cui il campo lo mostra.
interface WrittenPaint {
  readonly value: string;
  readonly text: string;
}

/// Il colore scritto nel campo: `none`, un campione del documento per nome,
/// senza badare alle maiuscole, o un colore; `null` se non è niente di
/// questo. Il nome di un campione vale prima del nome di un colore: è del
/// disegno.
function paintOf(text: string, swatches: readonly FieldSwatch[]): WrittenPaint | null {
  const lower = text.trim().toLocaleLowerCase();
  if (lower === "none" || lower === t("draw.properties.none").toLocaleLowerCase()) return { value: "none", text: t("draw.properties.none") };
  const name = cleanName(text).toLocaleLowerCase();
  const swatch = name === "" ? undefined : swatches.find((each) => each.name.toLocaleLowerCase() === name);
  if (swatch !== undefined) return { value: `url(#${swatch.id}) ${swatch.color}`, text: swatch.name };
  const code = customColor(text);
  return code === null ? null : { value: code, text: code };
}

/// L'id della risorsa che `value` usa, `url(#id)` con o senza ripiego;
/// `null` se non ne usa una.
function referenceOf(value: string | null): string | null {
  const match = value === null ? null : /^url\(#([^)\s]+)\)/.exec(value);
  return match === null ? null : match[1]!;
}

/// Vero se `a` e `b` sono lo stesso colore: due usi della stessa risorsa lo
/// sono, quale che sia il ripiego.
function samePaint(a: string | null, b: string | null): boolean {
  const used = referenceOf(a);
  return used !== null || referenceOf(b) !== null ? used === referenceOf(b) : a === b;
}

/// Un colore come lo mostra il campo: un campione o un motivo del documento
/// col suo nome, una sfumatura, una campitura o un altro motivo con quello
/// del tipo.
function paintShown(value: string | null, sample?: PaintSample): string {
  if (value === null) return "";
  if (sample?.kind === "swatch" || sample?.kind === "motif") return cleanName(sample.name);
  if (sample !== undefined) return t(`draw.properties.${sample.kind}`);
  return value === "none" ? t("draw.properties.none") : value;
}

/// Il colore che si vede di `value`, `#rrggbb`: quello di un campione, o il
/// colore scritto; `null` per il nessuno, il misto e le altre risorse.
function seenColor(value: string | null, sample?: PaintSample): string | null {
  if (sample?.kind === "swatch") return sample.color;
  return value === null || sample !== undefined ? null : customColor(value);
}

/// La forma del campione di un colore: quella della tavolozza, l'anello di
/// un colore a piacere, il nessuno, il misto, la sfumatura, la campitura e
/// il motivo. Un campione del documento ha la forma del suo colore.
function chipShape(value: string | null, sample?: PaintSample): string {
  if (sample !== undefined && sample.kind !== "swatch") return sample.kind === "motif" ? "pattern" : sample.kind;
  if (value === null) return "mixed";
  if (value === "none") return "none";
  const code = seenColor(value, sample);
  if (code === null) return "mixed";
  return "circle";
}

/// Le soglie di AAA di WCAG 2.2: il testo normale, e il grande.
const AAA_TEXT = 7;
const AAA_LARGE_TEXT = 4.5;

/// Il formato del rapporto di contrasto, nella lingua di adesso.
let ratioFormat: { readonly language: string; readonly numbers: Intl.NumberFormat } | null = null;

/// Il rapporto di contrasto scritto, in centesimi per difetto: un 4,499 non
/// si legge 4,5, che passerebbe.
function ratioText(ratio: number): string {
  const language = resolvedLanguage();
  if (ratioFormat?.language !== language) {
    ratioFormat = { language, numbers: new Intl.NumberFormat(language, { maximumFractionDigits: 2, useGrouping: false }) };
  }
  return ratioFormat.numbers.format(Math.floor(ratio * 100) / 100);
}

/// Il contrasto del colore `code` con la carta di `against`, a parole: per
/// un testo il livello del testo normale e di quello grande, per una forma
/// se basta. `null` se la carta non si sa.
function contrastText(code: string, against: PaintContrast): string | null {
  const color = paint(code);
  const paper = paint(against.paper);
  if (color === null || color === "none" || paper === null || paper === "none") return null;
  const ratio = contrast(over(color, against.alpha, paper), paper);
  const shown = ratioText(ratio);
  if (!against.text) return t(ratio >= MIN_CONTRAST ? "draw.properties.contrast.shape" : "draw.properties.contrast.shape_low", { ratio: shown });
  const grade = (aa: number, aaa: number): string => (ratio >= aaa ? "AAA" : ratio >= aa ? "AA" : t("draw.properties.contrast.fail"));
  return t("draw.properties.contrast.text", { ratio: shown, normal: grade(MIN_TEXT_CONTRAST, AAA_TEXT), large: grade(MIN_CONTRAST, AAA_LARGE_TEXT) });
}

export function createProperties(life: Lifetime, options: PropertiesOptions): Properties {
  ensureDrawIcons();
  const element = document.createElement("section");
  element.className = "draw-properties";
  element.id = identifier("draw-properties");
  element.tabIndex = -1;
  const header = document.createElement("div");
  header.className = "draw-properties-header";
  const heading = document.createElement("h2");
  heading.className = "draw-properties-title";
  heading.id = identifier("draw-properties-title");
  const subjectLine = document.createElement("p");
  subjectLine.className = "draw-properties-subject";
  header.append(heading, subjectLine);
  const scroller = document.createElement("div");
  scroller.className = "draw-properties-scroll";
  const lead = document.createElement("div");
  lead.className = "draw-properties-lead";
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, lead, scroller);

  let view: PropertiesView = { key: "", subject: "", editable: false, fields: {}, actions: {} };
  /// Vero mentre i campi si ridisegnano: un campo che se ne va non scrive.
  let rendering = false;
  const closed = new Set(options.closed);

  // --- Le sezioni -------------------------------------------------------------

  const sections = new Map<SectionId, Section>();
  for (const { id } of SECTIONS) {
    const root = document.createElement("div");
    root.className = "draw-properties-section";
    root.dataset.section = id;
    root.setAttribute("role", "group");
    const title = document.createElement("h3");
    title.className = "draw-properties-heading";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "draw-properties-toggle";
    toggle.id = identifier("draw-properties-section");
    const text = document.createElement("span");
    text.className = "draw-properties-toggle-text";
    toggle.append(text);
    const chevron = iconEl("draw-section");
    if (chevron !== null) toggle.append(chevron);
    title.append(toggle);
    const body = document.createElement("div");
    body.className = "draw-properties-body";
    body.id = identifier("draw-properties-body");
    toggle.setAttribute("aria-controls", body.id);
    root.setAttribute("aria-labelledby", toggle.id);
    root.append(title, body);
    root.hidden = true;
    scroller.append(root);
    const section: Section = { id, root, toggle, title: text, body, open: !closed.has(id) };
    sections.set(id, section);
    showOpen(section);
    life.listen(toggle, "click", () => setOpen(section, !section.open));
  }

  function showOpen(section: Section): void {
    section.toggle.setAttribute("aria-expanded", String(section.open));
    section.body.hidden = !section.open;
  }

  function setOpen(section: Section, open: boolean): void {
    if (section.open === open) return;
    // Il fuoco in una sezione che si chiude va alla sua intestazione.
    if (!open && section.body.contains(document.activeElement)) section.toggle.focus({ preventScroll: true });
    section.open = open;
    showOpen(section);
    options.onSection(section.id, open);
  }

  // --- Le barre di pulsanti ---------------------------------------------------

  /// Una fila di pulsanti col roving tabindex: uno solo prende il Tab, le
  /// frecce, Inizio e Fine passano agli altri. Torna la funzione che rimette
  /// il Tab dove va, dopo che i pulsanti sono cambiati.
  const rove = (bar: HTMLElement): (() => void) => {
    let current: HTMLButtonElement | null = null;
    const focusable = (): HTMLButtonElement[] => [...bar.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden && !control.disabled);
    const sync = (): void => {
      const controls = focusable();
      if (current === null || !controls.includes(current)) {
        current = controls.find((control) => control.getAttribute("aria-pressed") === "true") ?? controls[0] ?? null;
      }
      for (const control of bar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === current ? 0 : -1;
    };
    life.listen(bar, "keydown", (event) => {
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
      sync();
      current.focus();
    });
    life.listen(bar, "focusin", (event) => {
      if (event.target instanceof HTMLButtonElement && bar.contains(event.target)) {
        current = event.target;
        sync();
      }
    });
    return sync;
  };
  const roves: Array<() => void> = [];

  // --- I comandi di «Disponi» ---------------------------------------------------

  const actionButtons = new Map<ActionId, HTMLButtonElement>();
  const actionBars: Array<{ readonly bar: HTMLElement; readonly label: DrawKey }> = [];
  const arrangeBody = sections.get("arrange")!.body;
  const arrangeRows = document.createElement("div");
  arrangeRows.className = "draw-properties-actions";
  arrangeBody.append(arrangeRows);
  for (const row of ACTION_ROWS) {
    const bar = document.createElement("div");
    bar.className = "draw-properties-bar";
    bar.setAttribute("role", "toolbar");
    for (const id of row.actions) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "draw-button draw-properties-action";
      control.dataset.action = id;
      const glyph = iconEl(`draw-${id}`);
      if (glyph !== null) control.append(glyph);
      bar.append(control);
      actionButtons.set(id, control);
      /// Un comando che adesso non si usa resta raggiungibile, e dice
      /// perché.
      const refused = (): boolean => {
        const state = view.actions[id];
        if (state === undefined) return true;
        if (state.disabled !== true && view.editable) return false;
        options.announce(state.note ?? state.label);
        return true;
      };
      life.listen(control, "click", () => {
        if (!refused()) options.onAction(id);
      });
      // Da tastiera uno spento non fa clic: lo dice soltanto.
      life.listen(control, "keydown", (event) => {
        if ((event.key !== "Enter" && event.key !== " ") || control.getAttribute("aria-disabled") !== "true") return;
        event.preventDefault();
        refused();
      });
    }
    arrangeRows.append(bar);
    actionBars.push({ bar, label: row.label });
    roves.push(rove(bar));
  }

  // --- I campi ----------------------------------------------------------------

  const lines = new Map<FieldId, Line>();

  /// Il nome e la nota di un campo, e l'errore.
  const parts = (spec: Spec): { root: HTMLElement; note: HTMLElement; error: HTMLElement } => {
    const root = document.createElement("div");
    root.className = "draw-properties-field";
    root.dataset.field = spec.id;
    root.dataset.column = spec.column;
    root.hidden = true;
    const note = document.createElement("p");
    note.className = "draw-properties-note";
    note.id = identifier("draw-properties-note");
    note.hidden = true;
    const error = document.createElement("p");
    error.className = "draw-properties-error";
    error.id = identifier("draw-properties-error");
    error.hidden = true;
    return { root, note, error };
  };

  const textInput = (): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "draw-properties-input";
    input.id = identifier("draw-properties-field");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.enterKeyHint = "done";
    return input;
  };

  const labelFor = (control: HTMLElement): HTMLLabelElement => {
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = control.id;
    return label;
  };

  const createLine = (spec: Spec): Line => {
    const { root, note, error } = parts(spec);
    let name: HTMLElement;
    let control: Line["control"];
    let unit: HTMLElement | null = null;
    let spoken: HTMLElement | null = null;
    let chip: HTMLButtonElement | null = null;
    let chipFrame: HTMLElement | null = null;
    let chipColor: HTMLElement | null = null;
    let contrast: HTMLElement | null = null;
    let picture: HTMLElement | null = null;
    let caption: HTMLElement | null = null;
    const segments = new Map<string, HTMLButtonElement>();
    switch (spec.kind) {
      case "number": {
        const input = textInput();
        input.setAttribute("role", "spinbutton");
        name = labelFor(input);
        spoken = document.createElement("span");
        spoken.className = "sr-only";
        unit = document.createElement("span");
        unit.className = "draw-properties-unit";
        unit.setAttribute("aria-hidden", "true");
        const box = document.createElement("div");
        box.className = "draw-properties-number";
        box.append(input, unit);
        root.append(name, box, note, error);
        control = input;
        break;
      }
      case "paint": {
        const input = textInput();
        name = labelFor(input);
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "draw-button draw-properties-chip";
        chip.setAttribute("aria-haspopup", "dialog");
        chip.setAttribute("aria-expanded", "false");
        chip.id = identifier("draw-properties-chip");
        chipFrame = document.createElement("span");
        chipFrame.className = "draw-swatch-frame";
        chipColor = document.createElement("span");
        chipColor.className = "draw-swatch";
        chipFrame.append(chipColor);
        chip.append(chipFrame);
        const row = document.createElement("div");
        row.className = "draw-properties-paint";
        row.append(chip, input);
        contrast = document.createElement("p");
        contrast.className = "draw-properties-note draw-properties-contrast";
        contrast.id = identifier("draw-properties-contrast");
        contrast.hidden = true;
        root.append(name, row, note, contrast, error);
        control = input;
        break;
      }
      case "choice": {
        const select = document.createElement("select");
        select.className = "draw-properties-input";
        select.id = identifier("draw-properties-field");
        name = labelFor(select);
        root.append(name, select, note, error);
        control = select;
        break;
      }
      case "menu": {
        // Il nome sta nel pulsante, che lo dice insieme alla scelta: quello
        // che si vede non si ripete a chi ascolta.
        name = document.createElement("span");
        name.className = "draw-properties-label";
        name.id = identifier("draw-properties-label");
        name.setAttribute("aria-hidden", "true");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "draw-button draw-properties-menu";
        button.id = identifier("draw-properties-menu");
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        picture = document.createElement("span");
        picture.className = "draw-properties-menu-picture";
        picture.setAttribute("aria-hidden", "true");
        caption = document.createElement("span");
        caption.className = "draw-properties-menu-text";
        button.append(picture, caption);
        const arrow = iconEl("draw-section");
        if (arrow !== null) button.append(arrow);
        root.append(name, button, note, error);
        control = button;
        break;
      }
      case "text": {
        const area = document.createElement("textarea");
        area.className = "draw-properties-input";
        area.id = identifier("draw-properties-field");
        area.rows = 3;
        area.spellcheck = true;
        name = labelFor(area);
        root.append(name, area, note, error);
        control = area;
        break;
      }
      case "switch": {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "draw-properties-check";
        box.id = identifier("draw-properties-field");
        const label = labelFor(box);
        label.classList.add("draw-properties-switch");
        name = document.createElement("span");
        label.append(box, name);
        root.append(label, note, error);
        control = box;
        break;
      }
      case "press": {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "draw-button draw-properties-press";
        const glyph = iconEl("draw-ratio");
        if (glyph !== null) button.append(glyph);
        // Il nome è del pulsante: non c'è un'etichetta da vedere.
        name = document.createElement("span");
        name.hidden = true;
        root.append(button, note, error);
        control = button;
        break;
      }
      case "segment":
      case "toggles": {
        name = document.createElement("span");
        name.className = "draw-properties-label";
        name.id = identifier("draw-properties-label");
        const bar = document.createElement("div");
        bar.className = "draw-properties-bar";
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-labelledby", name.id);
        root.append(name, bar, note, error);
        roves.push(rove(bar));
        control = bar;
        break;
      }
    }
    return { spec, root, name, note, error, control, unit, spoken, chip, chipFrame, chipColor, contrast, segments, picture, caption, state: null, shown: "", options: "" };
  };

  // Un campo entra nella sua sezione la prima volta che ha di che mostrarsi:
  // il suo nome viene dallo stato, e un campo senza nome non deve esistere,
  // nemmeno nascosto.
  for (const spec of SPECS) {
    const line = createLine(spec);
    lines.set(spec.id, line);
    // Un secondo clic sul campione chiude il selettore, come dice
    // `aria-expanded`.
    if (line.chip !== null) life.listen(line.chip, "click", () => (choosing?.line === line ? choosing.popover.close() : openPicker(line)));
    if (spec.kind === "press") life.listen(line.control, "click", () => press(line));
    // Un secondo clic sul pulsante lo chiude, come dice `aria-expanded`.
    if (spec.kind === "menu") life.listen(line.control, "click", () => (line.control.getAttribute("aria-expanded") === "true" ? closeContextMenu() : openMenu(line)));
    if (spec.kind === "choice" || spec.kind === "switch") life.listen(line.control, "change", () => choose(line));
  }

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "draw-button draw-properties-export";
  life.listen(exportButton, "click", () => options.onExportSelection?.());
  sections.get("exportSelection")!.body.append(exportButton);

  /// Mette il campo al suo posto, nell'ordine di `SPECS`, prima del campo
  /// seguente già entrato.
  const place = (line: Line): void => {
    if (line.root.parentElement !== null) return;
    const { section } = line.spec;
    let before: HTMLElement | null = null;
    for (let at = SPECS.indexOf(line.spec) + 1; at < SPECS.length; at += 1) {
      const spec = SPECS[at]!;
      const root = lines.get(spec.id)!.root;
      if (spec.section === section && root.parentElement !== null) {
        before = root;
        break;
      }
    }
    sections.get(section)!.body.insertBefore(line.root, before);
  };

  // --- Mostrare ---------------------------------------------------------------

  /// Chi descrive il campo: la nota, il contrasto e l'errore che si vedono.
  const describe = (line: Line): void => {
    const ids = [line.note, line.contrast, line.error].filter((part): part is HTMLElement => part !== null && !part.hidden).map((part) => part.id);
    if (ids.length === 0) line.control.removeAttribute("aria-describedby");
    else line.control.setAttribute("aria-describedby", ids.join(" "));
  };

  function showError(line: Line, text: string | null): void {
    line.error.hidden = text === null;
    line.error.textContent = text ?? "";
    // Un valore che non va è di un campo che si scrive o si sceglie.
    const control = line.control;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
      if (text === null) control.removeAttribute("aria-invalid");
      else control.setAttribute("aria-invalid", "true");
    }
    describe(line);
  }

  /// Il nome del campione e del selettore di un colore, e del lucchetto.
  const nameButtons = (line: Line, label: string): void => {
    if (line.chip !== null) {
      const chipText = t("draw.properties.swatches", { label });
      line.chip.setAttribute("aria-label", chipText);
      line.chip.title = chipText;
    } else if (line.spec.kind === "press") {
      line.control.setAttribute("aria-label", label);
      (line.control as HTMLButtonElement).title = label;
    }
  };

  /// Un pulsante che adesso non si usa resta raggiungibile, e dice com'è.
  const showOff = (control: HTMLElement, off: boolean): void => {
    if (off) control.setAttribute("aria-disabled", "true");
    else control.removeAttribute("aria-disabled");
  };

  function showChip(line: Line, value: string | null, sample?: PaintSample): void {
    if (line.chipFrame === null || line.chipColor === null) return;
    line.chipFrame.dataset.shape = chipShape(value, sample);
    const code = seenColor(value, sample);
    if (code === null) line.chipColor.style.removeProperty("--swatch");
    else line.chipColor.style.setProperty("--swatch", code);
    const image = sample?.image ?? null;
    if (image === null) line.chipColor.style.removeProperty("--swatch-image");
    else line.chipColor.style.setProperty("--swatch-image", image);
  }

  /// Il contrasto con la carta del colore `value` di `line`, se si misura:
  /// un colore, o un campione; non il nessuno, il misto o un'altra risorsa.
  function showContrast(line: Line, value: string | null, sample?: PaintSample): void {
    if (line.contrast === null) return;
    const against = (line.state as PaintState | null)?.contrast;
    const code = seenColor(value, sample);
    const text = against === undefined || code === null ? null : contrastText(code, against);
    line.contrast.hidden = text === null;
    if (line.contrast.textContent !== (text ?? "")) line.contrast.textContent = text ?? "";
    describe(line);
  }

  /// I campioni del documento che i campi conoscono.
  const fieldSwatches = (): readonly FieldSwatch[] => view.swatches ?? [];

  /// Come si mostra `value`, un colore scritto nel campo: un campione del
  /// documento col suo nome.
  const sampleOf = (value: string | null): PaintSample | undefined => {
    const id = referenceOf(value);
    const swatch = id === null ? undefined : fieldSwatches().find((each) => each.id === id);
    return swatch === undefined ? undefined : { kind: "swatch", image: null, name: swatch.name, color: swatch.color };
  };

  /// Vero se il campo di testo di `line` ha un valore scritto a metà da
  /// tenere: ha il fuoco, o un errore che non si è corretto.
  const keeps = (line: Line, fresh: boolean): boolean => {
    const control = line.control as HTMLInputElement | HTMLTextAreaElement;
    return !fresh && control.value !== line.shown && (document.activeElement === control || !line.error.hidden);
  };

  /// Scrive `text` nel campo di `line`, se non c'è un valore scritto a metà.
  const showText = (line: Line, text: string, fresh: boolean): void => {
    const control = line.control as HTMLInputElement | HTMLTextAreaElement;
    if (!keeps(line, fresh)) {
      if (control.value !== text) control.value = text;
      showError(line, null);
    }
    line.shown = text;
  };

  const paintNumber = (line: Line, state: NumberState, fresh: boolean): void => {
    const input = line.control as HTMLInputElement;
    line.name.textContent = state.label;
    line.spoken!.textContent = state.unit === "" ? "" : ` (${state.unit})`;
    line.name.append(line.spoken!);
    line.unit!.textContent = state.unit;
    line.unit!.hidden = state.unit === "";
    input.placeholder = state.value === null ? t("draw.properties.mixed") : "";
    const text = state.value === null ? "" : numberText(state.value, state.places);
    showText(line, text, fresh);
    if (state.value === null) input.removeAttribute("aria-valuenow");
    else input.setAttribute("aria-valuenow", String(rounded(state.value, state.places)));
    input.setAttribute("aria-valuetext", state.value === null ? t("draw.properties.mixed") : `${text}${state.unit === "" ? "" : ` ${state.unit}`}`);
    if (state.min === undefined) input.removeAttribute("aria-valuemin");
    else input.setAttribute("aria-valuemin", String(state.min));
    if (state.max === undefined) input.removeAttribute("aria-valuemax");
    else input.setAttribute("aria-valuemax", String(state.max));
    input.readOnly = !view.editable || state.disabled === true;
  };

  const paintPaint = (line: Line, state: PaintState, fresh: boolean): void => {
    const input = line.control as HTMLInputElement;
    line.name.textContent = state.label;
    input.placeholder = state.value === null ? t("draw.properties.mixed") : "";
    // Lo stato prima di tutto: il contrasto si misura su quello nuovo.
    line.state = state;
    showText(line, paintShown(state.value, state.sample), fresh);
    const written = keeps(line, false) ? (paintOf(input.value, fieldSwatches())?.value ?? state.value) : state.value;
    const sample = samePaint(written, state.value) ? state.sample : sampleOf(written);
    showChip(line, written, sample);
    showContrast(line, written, sample);
    nameButtons(line, state.label);
    const off = !view.editable || state.disabled === true;
    input.readOnly = off;
    line.chip!.disabled = off;
  };

  const paintChoice = (line: Line, state: ChoiceState): void => {
    const select = line.control as HTMLSelectElement;
    line.name.textContent = state.label;
    const signature = [state.value === null ? t("draw.properties.mixed") : "", ...state.options.map((option) => `${option.separator === true ? "-" : ""}${option.value}\u0000${option.label}`)].join("\u0002");
    if (signature !== line.options) {
      const entries: HTMLElement[] = state.options.flatMap((option) => {
        const entry = document.createElement("option");
        entry.value = option.value;
        entry.textContent = option.label;
        return option.separator === true ? [document.createElement("hr"), entry] : [entry];
      });
      // Il misto è una voce che si vede e non si sceglie.
      if (state.value === null) {
        const mixed = document.createElement("option");
        mixed.value = "";
        mixed.textContent = t("draw.properties.mixed");
        mixed.disabled = true;
        entries.unshift(mixed);
      }
      select.replaceChildren(...entries);
      line.options = signature;
    }
    select.value = state.value ?? "";
    select.disabled = !view.editable || state.disabled === true;
  };

  const paintMenu = (line: Line, state: MenuChoiceState): void => {
    const button = line.control as HTMLButtonElement;
    line.name.textContent = state.label;
    const current = state.value === null ? undefined : state.options.find((option) => option.value === state.value);
    const summary = state.summary ?? current?.label ?? t("draw.properties.mixed");
    line.caption!.textContent = summary;
    // La figura è l'icona della voce di adesso; una scelta mista non ne ha.
    const drawn = current?.icon ?? "";
    if (drawn !== line.options) {
      const glyph = drawn === "" ? null : iconEl(drawn);
      line.picture!.replaceChildren(...(glyph === null ? [] : [glyph]));
      line.options = drawn;
    }
    const spoken = t("draw.properties.menu_name", { label: state.label, value: summary });
    button.setAttribute("aria-label", spoken);
    button.title = spoken;
    showOff(button, !view.editable || state.disabled === true);
  };

  const paintSwitch = (line: Line, state: SwitchState): void => {
    line.name.textContent = state.label;
    const box = line.control as HTMLInputElement;
    box.checked = state.on;
    // La vista si cambia anche in un documento che si legge soltanto.
    box.disabled = state.disabled === true;
  };

  const paintPress = (line: Line, state: PressState): void => {
    const button = line.control as HTMLButtonElement;
    nameButtons(line, state.label);
    button.setAttribute("aria-pressed", String(state.on));
    showOff(button, !view.editable || state.disabled === true);
  };

  const paintSegment = (line: Line, state: SegmentState): void => {
    line.name.textContent = state.label;
    const bar = line.control;
    const signature = state.options.map((option) => `${option.value}\u0000${option.label}\u0000${option.icon}`).join("\u0002");
    if (signature !== line.options) {
      bar.replaceChildren();
      line.segments.clear();
      for (const option of state.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "draw-button draw-properties-segment";
        button.setAttribute("aria-label", option.label);
        button.title = option.label;
        const glyph = iconEl(option.icon);
        if (glyph !== null) button.append(glyph);
        life.listen(button, "click", () => pick(line, option.value));
        bar.append(button);
        line.segments.set(option.value, button);
      }
      line.options = signature;
    }
    for (const [value, button] of line.segments) {
      button.setAttribute("aria-pressed", String(value === state.value));
      showOff(button, !view.editable || state.disabled === true);
    }
  };

  const paintToggles = (line: Line, state: TogglesState): void => {
    line.name.textContent = state.label;
    const bar = line.control;
    const signature = state.options.map((option) => `${option.value}\u0000${option.label}\u0000${option.icon}`).join("\u0002");
    if (signature !== line.options) {
      bar.replaceChildren();
      line.segments.clear();
      for (const option of state.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "draw-button draw-properties-segment";
        button.setAttribute("aria-label", option.label);
        button.title = option.label;
        const glyph = iconEl(option.icon);
        if (glyph !== null) button.append(glyph);
        life.listen(button, "click", () => flip(line, option.value));
        bar.append(button);
        line.segments.set(option.value, button);
      }
      line.options = signature;
    }
    for (const option of state.options) {
      const button = line.segments.get(option.value)!;
      button.setAttribute("aria-pressed", option.on === null ? "mixed" : String(option.on));
      showOff(button, !view.editable || state.disabled === true);
    }
  };

  const paintText = (line: Line, state: TextState, fresh: boolean): void => {
    line.name.textContent = state.label;
    showText(line, state.value, fresh);
    (line.control as HTMLTextAreaElement).readOnly = !view.editable || state.disabled === true;
  };

  const paintLine = (line: Line, state: FieldState, fresh: boolean): void => {
    switch (state.kind) {
      case "number":
        paintNumber(line, state, fresh);
        break;
      case "paint":
        paintPaint(line, state, fresh);
        break;
      case "choice":
        paintChoice(line, state);
        break;
      case "menu":
        paintMenu(line, state);
        break;
      case "switch":
        paintSwitch(line, state);
        break;
      case "press":
        paintPress(line, state);
        break;
      case "segment":
        paintSegment(line, state);
        break;
      case "toggles":
        paintToggles(line, state);
        break;
      case "text":
        paintText(line, state, fresh);
        break;
    }
    line.state = state;
    const note = state.note ?? "";
    line.note.hidden = note === "";
    line.note.textContent = note;
    describe(line);
  };

  // --- Scrivere ---------------------------------------------------------------

  /// Dice che cosa non va in `line`, e a voce se `loud`. Torna falso.
  const fail = (line: Line, text: string, loud: boolean): false => {
    showError(line, text);
    if (loud) options.announce(text);
    return false;
  };

  /// Il numero scritto, nell'unità del campo e dentro i suoi
  /// limiti, o il messaggio di che cosa non va.
  const numberOf = (state: NumberState, text: string): number | string => {
    const out = evaluate(text, { units: state.units, current: state.value, relative: state.relative });
    if ("problem" in out) return t(PROBLEMS[out.problem], { units: Object.keys(state.units).join(", ") });
    let value = out.value;
    if (state.min !== undefined) value = Math.max(state.min, value);
    if (state.max !== undefined) value = Math.min(state.max, value);
    return rounded(value, state.places);
  };

  /// Manda `value` all'editor per `line`, scritto nel campo come `text`.
  /// Falso, e il campo resta com'era scritto, se il disegno non l'accetta.
  const send = (line: Line, value: number | string | boolean, text: string, loud: boolean): boolean => {
    const control = line.control as HTMLInputElement | HTMLTextAreaElement;
    const draft = control.value;
    const before = line.shown;
    // Il campo dice già il valore nuovo: l'aggiornamento che arriva mentre
    // l'editor lo scrive non lo prende per un valore scritto a metà.
    control.value = line.shown = text;
    showError(line, null);
    const failure = options.onChange(line.spec.id, value);
    if (failure === null) return true;
    line.shown = before;
    control.value = draft;
    return fail(line, failure, loud);
  };

  /// Scrive il numero di `line`, se è cambiato. Falso se non è partito.
  const commitNumber = (line: Line, loud: boolean): boolean => {
    const state = line.state as NumberState | null;
    const input = line.control as HTMLInputElement;
    if (state === null || !view.editable || state.disabled === true || input.value === line.shown) return true;
    const value = numberOf(state, input.value);
    if (typeof value === "string") return fail(line, value, loud);
    const text = numberText(value, state.places);
    if (state.value !== null && value === rounded(state.value, state.places) && text === line.shown) {
      input.value = line.shown;
      showError(line, null);
      return true;
    }
    return send(line, value, text, loud);
  };

  /// Su e giù: il valore di adesso, o quello scritto, cambia di `delta` e
  /// parte. Un campo misto senza niente di scritto non ha da dove partire.
  const step = (line: Line, delta: number): void => {
    const state = line.state as NumberState | null;
    const input = line.control as HTMLInputElement;
    if (state === null || !view.editable || state.disabled === true) return;
    let base: number | null = state.value;
    if (input.value !== line.shown && input.value.trim() !== "") {
      const typed = numberOf(state, input.value);
      if (typeof typed === "string") {
        fail(line, typed, true);
        return;
      }
      base = typed;
    }
    if (base === null) {
      options.announce(t("draw.properties.problem.mixed"));
      return;
    }
    let value = base + delta;
    if (state.min !== undefined) value = Math.max(state.min, value);
    if (state.max !== undefined) value = Math.min(state.max, value);
    value = rounded(value, state.places);
    const text = numberText(value, state.places);
    if (state.value !== null && value === rounded(state.value, state.places)) {
      input.value = line.shown;
      return;
    }
    send(line, value, text, true);
  };

  /// Riporta il campo del colore `line` a ciò che mostra il disegno.
  const revertPaint = (line: Line, state: PaintState): void => {
    (line.control as HTMLInputElement).value = line.shown;
    showError(line, null);
    showChip(line, state.value, state.sample);
    showContrast(line, state.value, state.sample);
  };

  /// Scrive il colore `text` in `line`, se è cambiato.
  function commitPaint(line: Line, text: string, loud: boolean): boolean {
    const state = line.state as PaintState | null;
    if (state === null || !view.editable || state.disabled === true) return true;
    if (text === line.shown) {
      revertPaint(line, state);
      return true;
    }
    const written = paintOf(text, fieldSwatches());
    if (written === null) return fail(line, t(fieldSwatches().length > 0 ? "draw.properties.problem.paint.swatch" : "draw.properties.problem.paint"), loud);
    return commitValue(line, written, loud);
  }

  /// Scrive in `line` il colore `written`, se è cambiato: lo stesso
  /// campione, anche con un altro ripiego, non cambia.
  function commitValue(line: Line, written: WrittenPaint, loud: boolean): boolean {
    const state = line.state as PaintState | null;
    if (state === null || !view.editable || state.disabled === true) return true;
    if (samePaint(written.value, state.value)) {
      revertPaint(line, state);
      return true;
    }
    (line.control as HTMLInputElement).value = written.text;
    return send(line, written.value, written.text, loud);
  }

  /// Scrive il testo di `line`, se è cambiato.
  const commitText = (line: Line, loud: boolean): boolean => {
    const state = line.state as TextState | null;
    const control = line.control as HTMLTextAreaElement;
    if (state === null || !view.editable || state.disabled === true || control.value === line.shown) return true;
    return send(line, control.value, control.value, loud);
  };

  /// Una scelta, o un interruttore, parte quando si fa.
  function choose(line: Line): void {
    const state = line.state;
    if (state === null) return;
    if (state.kind === "switch") {
      const box = line.control as HTMLInputElement;
      const failure = options.onChange(line.spec.id, box.checked);
      if (failure !== null) {
        box.checked = state.on;
        fail(line, failure, true);
      }
      return;
    }
    if (state.kind !== "choice" || !view.editable) return;
    const select = line.control as HTMLSelectElement;
    if (select.value === "" || select.value === state.value) return;
    const failure = options.onChange(line.spec.id, select.value);
    if (failure !== null) {
      select.value = state.value ?? "";
      fail(line, failure, true);
    } else {
      showError(line, null);
    }
  }

  function press(line: Line): void {
    const state = line.state;
    if (state === null || state.kind !== "press" || !view.editable || state.disabled === true) return;
    const failure = options.onChange(line.spec.id, !state.on);
    if (failure !== null) fail(line, failure, true);
    else showError(line, null);
  }

  function pick(line: Line, value: string): void {
    const state = line.state;
    if (state === null || state.kind !== "segment" || !view.editable || state.disabled === true || state.value === value) return;
    const failure = options.onChange(line.spec.id, value);
    if (failure !== null) fail(line, failure, true);
    else showError(line, null);
  }

  /// Il menu di un campo a menu, sotto il suo pulsante: le voci come le dà lo
  /// stato, e il fuoco parte dalla prima segnata.
  function openMenu(line: Line): void {
    const state = line.state;
    const button = line.control as HTMLButtonElement;
    if (state === null || state.kind !== "menu" || !view.editable || state.disabled === true) return;
    const items: MenuItem[] = state.options.map((option) => ({
      label: option.label,
      ...(option.icon === undefined ? {} : { icon: option.icon }),
      ...(option.note === undefined ? {} : { description: option.note }),
      ...(option.action === true ? {} : { choice: "radio" as const, checked: option.checked === true }),
      ...(option.checked === true ? { selected: true } : {}),
      ...(option.disabled === true ? { disabled: true } : {}),
      ...(option.separator === true ? { separator: true } : {}),
      run: () => chooseOption(line, option),
    }));
    button.setAttribute("aria-expanded", "true");
    showContextMenu(button, items, {
      labelledBy: line.name.id,
      onClose: () => button.setAttribute("aria-expanded", "false"),
    });
  }

  /// La voce `option` del menu di `line` è scelta: parte come la scelta di un
  /// elenco. Una voce già segnata non cambia niente. Il menu può essere
  /// rimasto aperto mentre il campo cambiava: conta com'è la voce adesso, non
  /// com'era quando si è aperto.
  function chooseOption(line: Line, option: MenuOption): void {
    const state = line.state;
    if (state === null || state.kind !== "menu" || !view.editable || state.disabled === true) return;
    const now = state.options.find((each) => each.value === option.value);
    if (now === undefined || now.disabled === true || (now.action !== true && now.checked === true)) return;
    const failure = options.onChange(line.spec.id, now.value);
    if (failure !== null) fail(line, failure, true);
    else showError(line, null);
  }

  /// Un interruttore della fila: si accende se era spento o misto, e si
  /// spegne se era acceso.
  function flip(line: Line, value: string): void {
    const state = line.state;
    if (state === null || state.kind !== "toggles" || !view.editable || state.disabled === true) return;
    const option = state.options.find((each) => each.value === value);
    if (option === undefined) return;
    const failure = options.onChange(line.spec.id, `${value}:${option.on !== true}`);
    if (failure !== null) fail(line, failure, true);
    else showError(line, null);
  }

  /// Il selettore del colore aperto, e per quale campo.
  let choosing: { readonly line: Line; readonly popover: PopoverHandle; readonly picker: ColorPicker } | null = null;
  life.add(() => choosing?.popover.close());

  /// Il selettore del kit sotto il campione di `line`: nessuno, i colori
  /// consigliati, i campioni del documento e i recenti, ciascuno col suo nome,
  /// poi un colore qualunque. Mentre si tira, il campo e il campione seguono;
  /// il colore parte quando la scelta finisce, in un passo. Un colore uguale a
  /// un campione del documento lo lega.
  function openPicker(line: Line): void {
    const state = line.state;
    const chip = line.chip!;
    if (state === null || state.kind !== "paint" || !view.editable) return;
    choosing?.popover.close();
    const swatches = fieldSwatches();
    const none = t("draw.properties.none");
    const writtenOf = (color: string): WrittenPaint => {
      if (color === "none") return { value: "none", text: none };
      const swatch = swatches.find((each) => each.color === color.toLowerCase());
      return swatch === undefined ? { value: color, text: color } : { value: `url(#${swatch.id}) ${swatch.color}`, text: swatch.name };
    };
    /// Un colore tirato e non ancora lasciato.
    let pending = false;
    const picker = createColorPicker({
      value: state.value === null ? null : (seenColor(state.value, state.sample) ?? (state.value === "none" ? "none" : null)),
      text: drawPickerText(),
      allowNone: true,
      recommended: PALETTE.map((swatch) => ({ color: swatch.color, name: t(swatch.label) })),
      documentColors: swatches.map((swatch) => ({ color: swatch.color, name: swatch.name || swatch.color })),
      recent: (view.recent ?? []).filter((code) => swatchOf(code) === null).map((code) => ({ color: code, name: code })),
      lifetime: life,
      onInput: (color) => {
        pending = true;
        (line.control as HTMLInputElement).value = color;
        showChip(line, color);
        showContrast(line, color);
        showError(line, null);
      },
      onChange: (color) => {
        pending = false;
        if (choosing?.line === line && line.state?.kind === "paint") commitValue(line, writtenOf(color), true);
      },
    });
    chip.setAttribute("aria-expanded", "true");
    const popover = openPopover({
      anchor: chip,
      content: picker.element,
      label: (state as PaintState).label,
      className: "kit-color-popover",
      lifetime: life,
      onClose: () => {
        chip.setAttribute("aria-expanded", "false");
        if (choosing?.popover === popover) choosing = null;
        // Un colore tirato e lasciato a metà torna a quello del disegno.
        const now = line.state;
        if (pending && now !== null && now.kind === "paint") revertPaint(line, now);
      },
    });
    choosing = { line, popover, picker };
    picker.focus();
  }

  // --- I tasti ----------------------------------------------------------------

  /// Il campo di cui `target` è il controllo che si scrive.
  const lineOf = (target: EventTarget | null): Line | null => {
    if (!(target instanceof HTMLElement)) return null;
    const root = target.closest<HTMLElement>(".draw-properties-field");
    const line = root === null ? undefined : lines.get(root.dataset.field as FieldId);
    return line !== undefined && line.control === target ? line : null;
  };

  const writes = (line: Line): boolean => line.spec.kind === "number" || line.spec.kind === "paint" || line.spec.kind === "text";

  life.listen(element, "keydown", (event) => {
    const line = lineOf(event.target);
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Escape" && plain && !event.shiftKey) {
      const control = line !== null && writes(line) ? (line.control as HTMLInputElement | HTMLTextAreaElement) : null;
      if (control !== null && control.value !== line!.shown) {
        if (line!.spec.kind === "paint") {
          revertPaint(line!, line!.state as PaintState);
        } else {
          control.value = line!.shown;
          showError(line!, null);
        }
      } else {
        options.onLeave();
      }
    } else if (event.key === "Enter" && !event.altKey && !event.shiftKey && line !== null && writes(line)) {
      if (line.spec.kind === "text") {
        // In un testo di più righe Invio va a capo; Ctrl o ⌘ e Invio lo
        // scrive.
        if (!(event.ctrlKey || event.metaKey)) return;
        commitText(line, true);
      } else if (!plain) {
        return;
      } else if (line.spec.kind === "number") {
        commitNumber(line, true);
      } else {
        commitPaint(line, (line.control as HTMLInputElement).value, true);
      }
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain && line !== null && line.spec.kind === "number") {
      step(line, (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain && !event.shiftKey && line !== null && line.spec.kind === "menu") {
      // Invio e Spazio lo aprono da soli, col clic del pulsante; le frecce no.
      openMenu(line);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // Mentre si scrive un colore, il campione e il contrasto lo seguono; uno
  // che non si legge lascia quelli di adesso.
  life.listen(element, "input", (event) => {
    const line = lineOf(event.target);
    if (line !== null && line.spec.kind === "paint") {
      const written = paintOf((line.control as HTMLInputElement).value, fieldSwatches());
      const state = line.state as PaintState;
      const value = written?.value ?? state.value;
      const sample = written === null || samePaint(value, state.value) ? state.sample : sampleOf(value);
      showChip(line, value, sample);
      showContrast(line, value, sample);
    }
  });

  life.listen(element, "focusout", (event) => {
    if (rendering) return;
    const line = lineOf(event.target);
    // Un campo che se n'è andato non scrive: il valore a metà era per ciò
    // che mostrava prima.
    if (line === null || line.root.hidden) return;
    if (line.spec.kind === "number") commitNumber(line, false);
    else if (line.spec.kind === "paint") commitPaint(line, (line.control as HTMLInputElement).value, false);
    else if (line.spec.kind === "text") commitText(line, false);
  });

  // Un pulsante preso col puntatore non prende il fuoco: resta al foglio,
  // con le sue scorciatoie, o al campo in cui si scrive.
  life.listen(element, "mousedown", (event) => {
    const pressed = (event.target as Element | null)?.closest("button:not(.draw-properties-toggle)");
    if (pressed) event.preventDefault();
  });

  // --- Il pannello ------------------------------------------------------------

  /// Il primo controllo di `section` che prende il fuoco.
  const firstIn = (section: Section): HTMLElement | null => {
    for (const candidate of section.body.querySelectorAll<HTMLElement>("input, select, textarea, button")) {
      if (candidate.closest("[hidden]") !== null) continue;
      if (candidate instanceof HTMLButtonElement && candidate.tabIndex < 0) continue;
      if ((candidate as HTMLInputElement).disabled) continue;
      return candidate;
    }
    return null;
  };

  const relabel = (): void => {
    formats.clear();
    heading.textContent = t("draw.properties");
    for (const { id, label } of SECTIONS) sections.get(id)!.title.textContent = t(label);
    for (const { bar, label } of actionBars) bar.setAttribute("aria-label", t(label));
    for (const [id, control] of actionButtons) {
      const text = view.actions[id]?.label ?? t(ACTION_LABELS[id]);
      control.setAttribute("aria-label", text);
      if (view.actions[id] === undefined) control.title = text;
    }
    for (const [id, key] of Object.entries(DEFAULT_LABELS) as Array<[FieldId, DrawKey]>) {
      const line = lines.get(id)!;
      nameButtons(line, line.state?.label ?? t(key));
    }
    exportButton.textContent = t("draw.chrome.export.dialog");
  };

  const update = (next: PropertiesView): void => {
    const fresh = next.key !== view.key;
    view = next;
    subjectLine.textContent = next.subject;
    subjectLine.hidden = next.subject === "";
    const lost = scroller.contains(document.activeElement) ? document.activeElement : null;
    const shown = new Set<SectionId>();
    rendering = true;
    try {
      for (const spec of SPECS) {
        const line = lines.get(spec.id)!;
        const state = next.fields[spec.id];
        if (state === undefined || state.kind !== spec.kind) {
          line.root.hidden = true;
          continue;
        }
        paintLine(line, state, fresh);
        place(line);
        line.root.hidden = false;
        shown.add(spec.section);
      }
      for (const [id, control] of actionButtons) {
        const state = next.actions[id];
        control.hidden = state === undefined;
        if (state === undefined) continue;
        shown.add("arrange");
        control.setAttribute("aria-label", state.label);
        control.title = state.note === undefined ? state.label : `${state.label} — ${state.note}`;
        const off = state.disabled === true || !next.editable;
        if (off) control.setAttribute("aria-disabled", "true");
        else control.removeAttribute("aria-disabled");
      }
      for (const { bar } of actionBars) bar.hidden = [...bar.children].every((control) => (control as HTMLElement).hidden);
      if (next.exportSelection === true && options.onExportSelection !== undefined) shown.add("exportSelection");
      for (const section of sections.values()) section.root.hidden = !shown.has(section.id);
    } finally {
      rendering = false;
    }
    for (const sync of roves) sync();
    // Il fuoco in un campo che se n'è andato resta nel pannello: alla sua
    // sezione, se c'è ancora.
    if (lost !== null && (lost as HTMLElement).closest("[hidden]") !== null) {
      const section = [...sections.values()].find((each) => each.root.contains(lost));
      if (section !== undefined && !section.root.hidden) section.toggle.focus({ preventScroll: true });
      else element.focus({ preventScroll: true });
    }
  };

  relabel();

  return {
    element,
    lead,
    update,
    focus() {
      for (const section of sections.values()) {
        if (section.root.hidden || !section.open) continue;
        const first = firstIn(section);
        if (first !== null) {
          first.focus({ preventScroll: true });
          return;
        }
      }
      element.focus({ preventScroll: true });
    },
    focusSection(id) {
      const section = sections.get(id)!;
      if (section.root.hidden) return false;
      setOpen(section, true);
      section.root.scrollIntoView?.({ block: "nearest" });
      (firstIn(section) ?? section.toggle).focus({ preventScroll: true });
      return true;
    },
    setClosed(ids) {
      const shut = new Set(ids);
      for (const section of sections.values()) {
        const open = !shut.has(section.id);
        if (section.open === open) continue;
        if (!open && section.body.contains(document.activeElement)) section.toggle.focus({ preventScroll: true });
        section.open = open;
        showOpen(section);
      }
    },
    relabel,
  };
}
