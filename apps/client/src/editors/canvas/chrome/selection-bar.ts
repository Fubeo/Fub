// La barra della selezione della lavagna (T51, «Che cosa si riusa» di
// `lavagna.md`): sopra le schede scelte, le azioni che servono senza andare al
// menu, come la barra «Disponi» del disegno (`.draw-arrange`), con l'aspetto
// del prototipo (`PLAN-ui/lavagna-impianto.html`, la barra con una, tre e venti
// schede).
//
// - **Quando c'è.** Lo dice una regola pura, `selectionBarWanted`: delle schede
//   scelte, nessun gesto in corso (il puntatore giù, la rotella, un volo), la
//   penna su e nessuno che scrive dentro una scheda. La tela la chiede a fine
//   gesto, mai durante: durante, la barra non c'è.
// - **Dove sta.** `selectionBarPlace`: sopra il riquadro delle schede scelte,
//   centrata, dentro la vista, con lo spazio del titolo sopra la scheda (T39);
//   al bordo alto va sotto. È `bubblePlace` della bolla del testo. Con le
//   schede tutte fuori dalla vista la barra non c'è.
// - **Le azioni** le dice `selectionBarActions`: Colore (il menu di T47),
//   Collega, Raggruppa, «Allinea e distribuisci» con più schede, Apri con una
//   (se si apre), Togli dalla lavagna. Ognuna è un comando del catalogo
//   (`commands.ts`): il nome, il tasto nel suggerimento, spenta col perché
//   (`aria-disabled`, così il lettore di schermo ci arriva e lo sente); in sola
//   lettura il catalogo spegne quelle che cambiano il file.
// - **Sempre gli stessi elementi**, creati una volta: la barra cambia quali
//   mostra, non li rifà, così il fuoco non si perde e ogni ascoltatore sta
//   nella vita della lavagna.
// - **La tastiera.** Una `toolbar` con un solo punto di tabulazione: le frecce
//   fra i pulsanti, Inizio e Fine ai capi, Esc torna alla lavagna.

import { bubblePlace } from "../../../panels/selection-bubble";
import { t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { displayCanvasKey, type CanvasCommand } from "./commands";
import { ensureCanvasIcons } from "./icons";
import { paintColorChip, type CanvasChosenColor } from "./options";

/// Il momento della lavagna che decide se la barra c'è.
export interface SelectionBarMoment {
  /// Quante schede sono scelte (i fili da soli non contano).
  readonly chosen: number;
  /// Un gesto in corso: il puntatore giù, la rotella che gira, un volo.
  readonly gesture: boolean;
  /// Una penna è giù.
  readonly pen: boolean;
  /// Si scrive dentro una scheda (il campo del testo, una scheda attiva).
  readonly writing: boolean;
}

/// La barra c'è adesso?
export function selectionBarWanted(moment: SelectionBarMoment): boolean {
  return moment.chosen > 0 && !moment.gesture && !moment.pen && !moment.writing;
}

/// I comandi della barra, nell'ordine, con `chosen` schede scelte; `open` è il
/// comando che apre la sola scheda scelta (`canvas.open`, `canvas.open_url`),
/// `null` se non si apre.
export function selectionBarActions(chosen: number, open: string | null): string[] {
  if (chosen <= 0) return [];
  const actions = ["canvas.color_menu", "canvas.connect", "canvas.group"];
  if (chosen > 1) actions.push("canvas.align_menu");
  if (chosen === 1 && open !== null) actions.push(open);
  actions.push("canvas.delete");
  return actions;
}

/// Un riquadro sullo schermo, in pixel della vista.
export interface SelectionBarBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/// Lo spazio del titolo sopra la scheda (T39): la barra sta sopra anche lui,
/// a 26 px dalla scheda come nel prototipo (`bubblePlace` ne mette 8).
export const SELECTION_BAR_TITLE_ROOM = 18;
/// Sotto, a 10 px dalla scheda come nel prototipo.
const BELOW_ROOM = 2;

/// Dove va una barra larga e alta `size` sopra le schede scelte `box`, dentro
/// la vista `view`: `null` se le schede sono tutte fuori dalla vista.
export function selectionBarPlace(
  box: SelectionBarBox,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } | null {
  if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite)) return null;
  if (box.right <= 0 || box.bottom <= 0 || box.left >= view.width || box.top >= view.height) return null;
  return bubblePlace(
    { left: box.left, top: box.top - SELECTION_BAR_TITLE_ROOM, right: box.right, bottom: box.bottom + BELOW_ROOM },
    size,
    view,
  );
}

/// Che cosa la barra mostra: le schede scelte, sullo schermo.
export interface SelectionBarShow {
  /// Quante schede sono scelte.
  readonly chosen: number;
  /// Il comando che apre la sola scheda scelta, o `null`.
  readonly open: string | null;
  /// Il riquadro delle schede scelte, in pixel della vista.
  readonly box: SelectionBarBox;
  /// La misura della vista.
  readonly view: { width: number; height: number };
  /// Lo scarto della vista nel contenitore della barra.
  readonly offset?: { left: number; top: number };
}

export interface CanvasSelectionBarContext {
  readonly lifetime: Lifetime;
  /// I comandi della lavagna adesso (il catalogo con ciò che fanno).
  readonly commands: () => readonly CanvasCommand[];
  /// Esegue il comando `id`, se si può; `trigger` è il pulsante della barra
  /// che l'ha chiesto (i menu ci si aprono sotto).
  readonly run: (id: string, trigger: HTMLButtonElement) => void;
  /// Il colore delle schede scelte.
  readonly color: () => CanvasChosenColor;
  /// Esc nella barra: il fuoco torna alla lavagna.
  readonly back: () => void;
}

export interface CanvasSelectionBar {
  /// La barra, `.canvas-selection-bar`.
  readonly element: HTMLElement;
  /// La barra si vede.
  readonly shown: boolean;
  /// Mostra la barra per queste schede, al suo posto; se le schede sono fuori
  /// dalla vista la nasconde.
  show(what: SelectionBarShow): void;
  /// Nasconde la barra.
  hide(): void;
  /// Ridice nomi, perché e colore (la lingua, la sola lettura, il colore).
  relabel(): void;
}

/// L'icona di ogni comando della barra.
const ICON: Readonly<Record<string, string>> = {
  "canvas.connect": "canvas-connect",
  "canvas.group": "draw-group",
  "canvas.align_menu": "draw-align",
  "canvas.open": "draw-open-link",
  "canvas.open_url": "draw-open-link",
  "canvas.delete": "trash",
};

/// I comandi che aprono un menu sotto il pulsante.
const MENUS = new Set(["canvas.color_menu", "canvas.align_menu"]);

/// Monta la barra della selezione, nascosta.
export function createCanvasSelectionBar(ctx: CanvasSelectionBarContext): CanvasSelectionBar {
  ensureCanvasIcons();
  const { lifetime } = ctx;
  const element = document.createElement("div");
  element.className = "canvas-selection-bar";
  element.setAttribute("role", "toolbar");
  element.hidden = true;

  const buttons = new Map<string, HTMLButtonElement>();
  /// I comandi mostrati adesso, nell'ordine.
  let actions: string[] = [];

  const button = (command: string): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "canvas-button";
    control.tabIndex = -1;
    control.dataset.command = command;
    control.hidden = true;
    if (MENUS.has(command)) {
      control.id = identifier("canvas-selection-menu");
      control.setAttribute("aria-haspopup", "menu");
      control.setAttribute("aria-expanded", "false");
    }
    lifetime.listen(control, "click", (event) => {
      event.preventDefault();
      if (control.getAttribute("aria-disabled") === "true") return;
      ctx.run(command, control);
    });
    buttons.set(command, control);
    element.append(control);
    return control;
  };

  // Il colore: il pallino come lo dipinge la lavagna (T47).
  const colorButton = button("canvas.color_menu");
  const chip = document.createElement("span");
  chip.className = "kit-color-chip canvas-selection-chip";
  chip.setAttribute("aria-hidden", "true");
  colorButton.append(chip);
  for (const command of ["canvas.connect", "canvas.group", "canvas.align_menu", "canvas.open", "canvas.open_url", "canvas.delete"]) {
    const control = button(command);
    const svg = iconEl(ICON[command]!);
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      control.append(svg);
    }
  }

  /// I pulsanti che si vedono, nell'ordine.
  const reachable = (): HTMLButtonElement[] =>
    [...element.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden);

  /// Un solo punto di tabulazione: quello che aveva il fuoco, o il primo.
  const rove = (focus?: HTMLButtonElement): void => {
    const all = reachable();
    if (all.length === 0) return;
    const keep = focus ?? all.find((control) => control.tabIndex === 0) ?? all[0]!;
    for (const control of buttons.values()) control.tabIndex = control === keep ? 0 : -1;
  };
  lifetime.listen(element, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      ctx.back();
      return;
    }
    const all = reachable();
    const at = all.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = all[(next + all.length) % all.length]!;
    rove(target);
    target.focus();
  });

  /// Nome, suggerimento, tasto e perché di un pulsante.
  const paint = (control: HTMLButtonElement, command: CanvasCommand | undefined, name?: string): void => {
    if (!command) {
      control.hidden = true;
      return;
    }
    const label = name ?? command.label;
    const first = command.keys[0];
    const keys = first === undefined ? "" : displayCanvasKey(first);
    const why = command.disabled();
    const said = why === null ? label : t("canvas.options.off", { name: label, why });
    if (control.getAttribute("aria-label") !== said) control.setAttribute("aria-label", said);
    setTooltip(control, keys && why === null ? `${label} (${keys})` : said);
    if (first === undefined) control.removeAttribute("aria-keyshortcuts");
    else control.setAttribute("aria-keyshortcuts", displayCanvasKey(first, "other"));
    if (why === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
  };

  const relabel = (): void => {
    if (lifetime.closed) return;
    element.setAttribute("aria-label", t("canvas.selection_bar"));
    if (element.hidden) return;
    const catalog = new Map(ctx.commands().map((command) => [command.id, command]));
    const color = ctx.color();
    const colorName = paintColorChip(chip, color);
    for (const [id, control] of buttons) {
      if (!actions.includes(id)) {
        control.hidden = true;
        continue;
      }
      control.hidden = false;
      paint(control, catalog.get(id), id === "canvas.color_menu" ? t("canvas.options.color_value", { name: colorName }) : undefined);
    }
    rove();
  };

  let shown = false;
  const hide = (): void => {
    if (!shown && element.hidden) return;
    shown = false;
    // Il fuoco che era nella barra (Togli, un tasto) torna alla lavagna.
    const focused = element.contains(document.activeElement);
    element.hidden = true;
    if (focused) ctx.back();
  };

  const show = (what: SelectionBarShow): void => {
    if (lifetime.closed) return;
    const next = selectionBarActions(what.chosen, what.open);
    if (next.length === 0) {
      hide();
      return;
    }
    actions = next;
    // Nascosta non ha misura: si mostra prima, poi si misura e si mette.
    element.hidden = false;
    relabel();
    const size = { width: element.offsetWidth, height: element.offsetHeight };
    const at = selectionBarPlace(what.box, size, what.view);
    if (!at) {
      hide();
      return;
    }
    shown = true;
    const offset = what.offset ?? { left: 0, top: 0 };
    element.style.left = `${at.left + offset.left}px`;
    element.style.top = `${at.top + offset.top}px`;
  };

  relabel();
  return {
    element,
    get shown() {
      return shown;
    },
    show,
    hide,
    relabel,
  };
}
