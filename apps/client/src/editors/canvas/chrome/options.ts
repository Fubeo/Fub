// La riga delle opzioni della lavagna (T50, R1 di `lavagna.md`): sopra la
// lavagna, le opzioni dello strumento scelto nella colonna e delle schede
// scelte, sulla barra delle opzioni del kit (`kit/options-bar.ts`) come quella
// del disegno, con le classi del prototipo (`PLAN-ui/lavagna-impianto.html`).
//
// - **Che cosa mostra.** Lo dice una regola pura, `canvasOptionsMode`: con
//   Penna, Evidenziatore e Gomma il menu delle penne di N4 (`pen-menu.ts`,
//   montato qui com'è); con la Selezione e delle schede scelte il colore e
//   Disponi (davanti, dietro, «Allinea e distribuisci»); con la Selezione
//   senza schede, Collega e Testo una riga che spiega il gesto, e per
//   Collega le punte del filo che tira. La Vista (riduci, ingrandisci,
//   mostra tutto) chiude ogni riga ed è la prima ad andare in «…» quando non
//   c'è posto.
// - **Mentre si scrive in una scheda** la riga mostra la barra che chi scrive
//   le dà (`setWriting`): la barra di formato della nota (T41) o la formula
//   della cella (T42). Senza, torna allo strumento.
// - **Ogni controllo è un comando** del catalogo (`commands.ts`): il nome, il
//   tasto nel suggerimento, spento col perché (`aria-disabled`, così il
//   lettore di schermo ci arriva e lo sente); il clic lo esegue.
// - **I controlli sono sempre gli stessi elementi**, creati una volta: la
//   riga cambia quali mostra, non li rifà. Così il rialzo della penna resta
//   ancorato, il fuoco non si perde e ogni ascoltatore sta nella vita della
//   lavagna. Cambiando riga si chiudono il rialzo della penna e i menu che la
//   riga ha aperto.
// - **La tastiera.** Un solo punto di tabulazione nella riga, le frecce si
//   muovono fra i controlli (Inizio e Fine ai capi), come una `toolbar`.

import { createOptionsBar, type OptionItem, type OptionsBar } from "../../../kit/options-bar";
import { t, type Key } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";
import { setTooltip } from "../../../ui/tooltip";
import type { PenMenu } from "../pen-menu";
import {
  JSON_CANVAS_COLORS,
  NOTE_COLORS,
  colorChoiceOf,
  colorLook,
  colorMenuLabel,
  colorName,
  type CanvasColorChoice,
} from "../colors";
import {
  CANVAS_ALIGN,
  CANVAS_TIPS,
  displayCanvasKey,
  type CanvasCommand,
  type CanvasTip,
  type CanvasToolId,
} from "./commands";
import { ensureCanvasIcons } from "./icons";

/// Che cosa mostra la riga.
export type CanvasOptionsMode = "ink" | "select" | "cards" | "hand" | "text" | "connect" | "writing";

/// La riga per lo strumento `tool` con `chosen` schede scelte; `writing`
/// quando una scheda in scrittura ha dato la sua barra.
export function canvasOptionsMode(tool: CanvasToolId, chosen: number, writing: boolean): CanvasOptionsMode {
  if (writing) return "writing";
  switch (tool) {
    case "pen":
    case "highlighter":
    case "eraser":
      return "ink";
    case "select":
      return chosen > 0 ? "cards" : "select";
    default:
      return tool;
  }
}

/// Il colore delle schede scelte: `undefined` quello di serie, `null` colori
/// diversi.
export type CanvasChosenColor = string | null | undefined;

export interface CanvasOptionsContext {
  readonly lifetime: Lifetime;
  /// Lo strumento della colonna.
  readonly tool: () => CanvasToolId;
  /// Quante schede sono scelte.
  readonly chosen: () => number;
  /// Il colore delle schede scelte.
  readonly color: () => CanvasChosenColor;
  /// Le punte dei fili che Collega tira.
  readonly tips: () => CanvasTip;
  /// I comandi della lavagna adesso (il catalogo con ciò che fanno).
  readonly commands: () => readonly CanvasCommand[];
  /// Esegue il comando `id`, se si può.
  readonly run: (id: string) => void;
  /// Il menu delle penne di N4: la riga ne monta il pulsante.
  readonly penMenu: PenMenu;
  /// I pallini del menu dei colori (T47), come li dipinge la lavagna: il
  /// colore di ogni scelta. Senza, il menu non ha pallini.
  readonly swatches?: () => ReadonlyMap<string, string>;
}

export interface CanvasOptions {
  /// La riga, `.kit-options.canvas-options`.
  readonly element: HTMLElement;
  readonly bar: OptionsBar;
  /// Che cosa mostra adesso.
  readonly mode: CanvasOptionsMode;
  /// Ridice la riga per lo strumento, la scelta e la lingua di adesso.
  sync(): void;
  /// La barra di una scheda in scrittura (T41, T42), o `null` quando esce.
  setWriting(items: readonly OptionItem[] | null): void;
  /// Apre il menu dei colori delle schede scelte.
  openColorMenu(): void;
  /// Apre il menu «Allinea e distribuisci».
  openAlignMenu(): void;
  /// Chiude il rialzo della penna e i menu aperti dalla riga.
  closeMenus(): void;
}

/// Un controllo della riga legato a un comando.
interface Control {
  readonly element: HTMLButtonElement;
  readonly command: string;
  /// Il comando è una scelta fra altre: segnata quando vale.
  readonly checked?: () => boolean;
}

const SVG_ICON = (name: string): SVGElement | null => {
  const svg = iconEl(name);
  svg?.setAttribute("aria-hidden", "true");
  return svg;
};

/// Il nome di un colore delle schede: quello di `colors.ts`, o «Colori
/// diversi».
function wellColorName(color: CanvasChosenColor): string {
  return color === null ? t("canvas.options.color_mixed") : colorName(color);
}

/// Monta la riga delle opzioni della lavagna.
export function createCanvasOptions(ctx: CanvasOptionsContext): CanvasOptions {
  ensureCanvasIcons();
  const { lifetime } = ctx;
  const bar = createOptionsBar({ label: t("canvas.options"), moreLabel: t("canvas.options.more"), lifetime });
  const element = bar.element;
  element.classList.add("canvas-options");
  const more = element.querySelector<HTMLButtonElement>(".kit-options-more");

  const controls: Control[] = [];
  /// I gruppi e il loro nome, ridetto a ogni `sync`.
  const groups: Array<readonly [HTMLElement, Key]> = [];
  /// Il menu aperto dalla riga, finché è aperto.
  let menuFrom: HTMLButtonElement | null = null;

  const group = (role: "group" | "radiogroup", label: Key, ...children: HTMLElement[]): HTMLElement => {
    const box = document.createElement("div");
    box.className = "canvas-group";
    box.setAttribute("role", role);
    box.append(...children);
    groups.push([box, label]);
    return box;
  };
  /// Un elemento della riga: l'involucro che la barra mostra, nasconde o
  /// sposta in «…».
  const item = (id: string, priority: number, child: HTMLElement): OptionItem => {
    const wrap = document.createElement("div");
    wrap.className = "canvas-options-item";
    wrap.dataset.option = id;
    wrap.append(child);
    return { id, element: wrap, priority };
  };

  /// Un pulsante col suo comando; `action` resta il nome che la barra di N4
  /// gli dava (`data-canvas-action`).
  const button = (command: string, icon: string, action: string, extra: { checked?: () => boolean; run?: () => void } = {}): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "canvas-button";
    control.tabIndex = -1;
    control.dataset.canvasAction = action;
    control.dataset.command = command;
    const svg = SVG_ICON(icon);
    if (svg) control.append(svg);
    if (extra.checked) control.setAttribute("role", "radio");
    lifetime.listen(control, "click", (event) => {
      event.preventDefault();
      if (control.getAttribute("aria-disabled") === "true") return;
      if (extra.run) extra.run();
      else ctx.run(command);
    });
    controls.push({ element: control, command, ...(extra.checked ? { checked: extra.checked } : {}) });
    return control;
  };

  // La Vista: in ogni riga, l'ultima.
  const view = item("view", 0, group("group", "canvas.options.view",
    button("canvas.zoom_out", "draw-zoom-out", "zoom-out"),
    button("canvas.zoom_in", "draw-zoom-in", "zoom-in"),
    button("canvas.fit", "draw-fit", "fit"),
  ));

  // Il menu delle penne di N4, com'è: la riga gli dà solo l'aspetto dei suoi
  // pulsanti (`canvas-button` con un nome scritto).
  const pen = ctx.penMenu.button;
  pen.classList.add("canvas-button");
  pen.dataset.label = "";
  const penItem = item("pen", 2, group("group", "canvas.ink.pen", pen));

  // Il colore delle schede scelte: il pozzo del kit, che apre i colori del
  // catalogo (`canvas.color.*`) in un menu.
  const well = document.createElement("div");
  well.className = "kit-color-well";
  const wellButton = document.createElement("button");
  wellButton.type = "button";
  wellButton.className = "kit-color-well-button canvas-color-well";
  wellButton.dataset.canvasAction = "color-menu";
  wellButton.dataset.command = "canvas.color_menu";
  wellButton.id = identifier("canvas-color-well");
  wellButton.tabIndex = -1;
  wellButton.setAttribute("aria-haspopup", "menu");
  wellButton.setAttribute("aria-expanded", "false");
  const chip = document.createElement("span");
  chip.className = "kit-color-chip";
  chip.setAttribute("aria-hidden", "true");
  const chipName = document.createElement("span");
  chipName.className = "kit-color-well-name";
  wellButton.append(chip, chipName);
  well.append(wellButton);
  lifetime.listen(wellButton, "click", (event) => {
    event.preventDefault();
    if (wellButton.getAttribute("aria-disabled") === "true") return;
    ctx.run("canvas.color_menu");
  });
  const colorItem = item("color", 2, group("group", "canvas_menu.color", well));

  // Disponi: davanti, dietro, «Allinea e distribuisci».
  const align = button("canvas.align_menu", "draw-align", "align-menu");
  align.setAttribute("aria-haspopup", "menu");
  align.setAttribute("aria-expanded", "false");
  const arrangeItem = item("arrange", 1, group("group", "canvas.options.arrange",
    button("canvas.bring_front", "draw-order-front", "bring-front"),
    button("canvas.send_back", "draw-order-back", "send-back"),
    align,
  ));

  // Le punte dei fili che Collega tira.
  const TIP_ICON: Readonly<Record<CanvasTip, string>> = { none: "draw-tip-none", start: "draw-tip-triangle-start", end: "draw-tip-triangle-end" };
  const tipsItem = item("tips", 2, group("radiogroup", "canvas.options.tips",
    ...CANVAS_TIPS.map((tip) => button(`canvas.tips.${tip}`, TIP_ICON[tip], `tips-${tip}`, { checked: () => ctx.tips() === tip })),
  ));

  // La riga che spiega il gesto.
  const hint = document.createElement("span");
  hint.className = "canvas-options-hint";
  const hintItem = item("hint", 1, hint);
  const HINT: Partial<Record<CanvasOptionsMode, Key>> = {
    select: "canvas.options.select_hint",
    text: "canvas.options.text_hint",
    connect: "canvas.options.connect_hint",
  };

  let writing: readonly OptionItem[] | null = null;
  let shown: CanvasOptionsMode | null = null;

  const itemsFor = (mode: CanvasOptionsMode): readonly OptionItem[] => {
    switch (mode) {
      case "writing":
        return writing ?? [];
      case "ink":
        return [penItem, view];
      case "cards":
        return [colorItem, arrangeItem, view];
      case "select":
      case "text":
        return [hintItem, view];
      case "connect":
        return [hintItem, tipsItem, view];
      case "hand":
        return [view];
    }
  };

  /// I controlli della riga che si vedono, nell'ordine.
  const reachable = (): HTMLElement[] =>
    shown === "writing"
      ? []
      : [...element.querySelectorAll<HTMLElement>(".kit-options-row button")].filter((control) => !control.closest("[hidden]"));

  /// Un solo punto di tabulazione: quello che aveva il fuoco, o il primo.
  const rove = (focus?: HTMLElement): void => {
    const all = reachable();
    if (all.length === 0) return;
    const keep = focus ?? all.find((control) => control.tabIndex === 0) ?? all[0]!;
    for (const control of all) control.tabIndex = control === keep ? 0 : -1;
  };
  lifetime.listen(element, "keydown", (event) => {
    const all = reachable();
    const at = all.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = all[(next + all.length) % all.length]!;
    rove(target);
    target.focus();
  });

  const closeMenus = (): void => {
    ctx.penMenu.close();
    if (menuFrom) closeContextMenu();
  };
  lifetime.add(() => {
    if (menuFrom) closeContextMenu();
  });

  /// Apre il menu `items` sotto `trigger`, o sotto la riga se `trigger` non
  /// si vede (il comando arriva da Ctrl+/ con un'altra riga).
  const openMenu = (trigger: HTMLButtonElement, label: Key, items: MenuItem[]): void => {
    const visible = trigger.isConnected && !trigger.closest("[hidden]") && element.contains(trigger);
    const anchor = visible ? trigger : more && !more.hidden ? more : element;
    if (menuFrom) closeContextMenu();
    menuFrom = trigger;
    if (visible) trigger.setAttribute("aria-expanded", "true");
    showContextMenu(anchor, items, {
      ...(visible ? { labelledBy: trigger.id || (trigger.id = identifier("canvas-options-menu")) } : { label: t(label) }),
      onClose: () => {
        trigger.setAttribute("aria-expanded", "false");
        if (menuFrom === trigger) menuFrom = null;
      },
    });
  };

  /// La voce di menu del comando `id`.
  const entry = (catalog: ReadonlyMap<string, CanvasCommand>, id: string, extra: Partial<MenuItem> = {}): MenuItem | null => {
    const command = catalog.get(id);
    if (!command) return null;
    const why = command.disabled();
    return {
      label: command.label,
      ...(why === null ? {} : { disabled: true, description: why }),
      ...extra,
      run: () => ctx.run(id),
    };
  };
  const catalogNow = (): Map<string, CanvasCommand> => new Map(ctx.commands().map((command) => [command.id, command]));

  const openColorMenu = (): void => {
    const catalog = catalogNow();
    const current = ctx.color();
    // Lo stesso menu del tasto destro (T47): Nessuno e i sei, «Colori delle
    // note ›» coi nove, «Altro…»; segnata la scelta di adesso.
    const chosen = current === null ? null : colorChoiceOf(current);
    const swatches = ctx.swatches?.() ?? new Map<string, string>();
    const choice = (value: CanvasColorChoice, extra: Partial<MenuItem> = {}): MenuItem | null => {
      const swatch = swatches.get(value);
      return entry(catalog, `canvas.color.${value}`, {
        label: colorMenuLabel(value),
        choice: "radio",
        checked: chosen === value,
        ...(swatch === undefined ? {} : { swatches: [swatch] }),
        ...extra,
      });
    };
    const notes = NOTE_COLORS.map((color) => choice(color.id)).filter((one): one is MenuItem => one !== null);
    const items = [
      choice("none"),
      ...JSON_CANVAS_COLORS.map((value) => choice(value)),
      notes.length ? { label: t("canvas_menu.color.notes"), separator: true, items: notes } : null,
      choice("other"),
    ].filter((one): one is MenuItem => one !== null);
    openMenu(wellButton, "canvas.options.color_menu", items);
  };

  const openAlignMenu = (): void => {
    const catalog = catalogNow();
    const items = [
      ...CANVAS_ALIGN.map((axis) => entry(catalog, `canvas.align.${axis}`, { icon: `draw-align-${axis}` })),
      entry(catalog, "canvas.distribute_x", { icon: "draw-distribute-x", separator: true }),
      entry(catalog, "canvas.distribute_y", { icon: "draw-distribute-y" }),
    ].filter((one): one is MenuItem => one !== null);
    openMenu(align, "canvas.options.align_menu", items);
  };

  /// Nome, suggerimento, tasto, scelta e perché di un controllo.
  const paintControl = (control: HTMLButtonElement, command: CanvasCommand | undefined, checked?: boolean): void => {
    if (!command) {
      control.hidden = true;
      return;
    }
    control.hidden = false;
    const first = command.keys[0];
    const keys = first === undefined ? "" : displayCanvasKey(first);
    const why = command.disabled();
    const label = why === null ? command.label : t("canvas.options.off", { name: command.label, why });
    if (control.getAttribute("aria-label") !== label) control.setAttribute("aria-label", label);
    setTooltip(control, keys && why === null ? `${command.label} (${keys})` : label);
    if (first === undefined) control.removeAttribute("aria-keyshortcuts");
    else control.setAttribute("aria-keyshortcuts", displayCanvasKey(first, "other"));
    if (why === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
    if (checked !== undefined) control.setAttribute("aria-checked", String(checked));
  };

  const paint = (): void => {
    const catalog = catalogNow();
    for (const [box, label] of groups) {
      const name = t(label);
      if (box.getAttribute("aria-label") !== name) box.setAttribute("aria-label", name);
    }
    for (const control of controls) paintControl(control.element, catalog.get(control.command), control.checked?.());
    // Il pozzo: il colore delle schede scelte, col suo nome.
    const color = ctx.color();
    const name = wellColorName(color);
    if (chipName.textContent !== name) chipName.textContent = name;
    chip.classList.toggle("none", color === undefined || color === "");
    chip.classList.toggle("mixed", color === null);
    // Il pallino come la carta della scheda (T47): la chiave del colore e,
    // per un colore libero, il suo valore.
    const look = color === null ? null : colorLook(color);
    if (look) chip.dataset.canvasColor = look.key;
    else delete chip.dataset.canvasColor;
    if (look?.custom) chip.style.setProperty("--canvas-color", look.custom);
    else chip.style.removeProperty("--canvas-color");
    const wellCommand = catalog.get("canvas.color_menu");
    paintControl(wellButton, wellCommand);
    // Il pozzo dice il colore; il perché, se è spento, nel suggerimento.
    const why = wellCommand?.disabled() ?? null;
    const said = t("canvas.options.color_value", { name });
    const wellLabel = why === null ? said : t("canvas.options.off", { name: said, why });
    wellButton.setAttribute("aria-label", wellLabel);
    setTooltip(wellButton, wellLabel);
    const key = shown ? HINT[shown] : undefined;
    const text = key ? t(key) : "";
    if (hint.textContent !== text) hint.textContent = text;
    element.setAttribute("aria-label", t("canvas.options"));
    if (more) {
      more.setAttribute("aria-label", t("canvas.options.more"));
      setTooltip(more, t("canvas.options.more"));
    }
  };

  const sync = (): void => {
    if (lifetime.closed) return;
    const mode = canvasOptionsMode(ctx.tool(), ctx.chosen(), writing !== null);
    if (mode !== shown) {
      // Un'altra riga: il rialzo della penna e i menu della riga di prima si
      // chiudono (passando fra Penna, Evidenziatore e Gomma la riga resta).
      closeMenus();
      shown = mode;
      paint();
      bar.setItems(itemsFor(mode));
      rove();
      return;
    }
    paint();
    rove();
  };

  return {
    element,
    bar,
    get mode() {
      return shown ?? canvasOptionsMode(ctx.tool(), ctx.chosen(), writing !== null);
    },
    sync,
    setWriting(items) {
      writing = items && items.length > 0 ? items : null;
      // La barra di prima va via anche se la riga resta «in scrittura».
      if (shown === "writing") shown = null;
      sync();
    },
    openColorMenu,
    openAlignMenu,
    closeMenus,
  };
}
