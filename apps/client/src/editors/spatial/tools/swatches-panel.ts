// I colori del documento, come sezione del pannello delle proprietà
// (livello Standard): i campioni, i colori che il disegno usa, contati, e i
// colori scelti di recente, che ricorda la macchina. Un clic dà il colore
// alla selezione, al riempimento o al contorno secondo «Applica a»; senza
// selezione è il colore con cui si disegna. Che cosa mostrare, e ogni
// cambio, li decide l'editor; qui c'è come si vede, si sceglie e si
// raggiunge.
//
// - **Tre griglie.** I campioni nell'ordine del documento, con «+» che ne fa
//   uno; i colori usati dal più usato, e quanti restano fuori; i recenti dal
//   più recente. Ogni griglia è una barra col roving tabindex: destra e
//   sinistra vanno al vicino, su e giù alla riga sopra e sotto, Inizio e
//   Fine ai capi.
// - **Un colore si dà con un gesto.** Clic, Invio o Spazio lo danno al
//   bersaglio, e con Maiusc all'altro; il clic destro, Maiusc+F10 o il tasto
//   del menu aprono il menu del colore; su un campione F2 lo rinomina e Canc
//   lo elimina.
// - **Mai il solo colore.** Ogni colore ha un nome che si sente e si legge
//   nel suggerimento, con quanti oggetti lo mostrano: un campione il suo, un
//   colore della tavolozza il suo, gli altri il codice. La forma è quella
//   della tavolozza, o l'anello di un colore a piacere; il colore di adesso
//   ha `aria-current`, che la pelle segna come la scelta della barra.
// - **Si scrive al suo posto.** «Nuovo campione…», «Rendi campione…»,
//   «Rinomina…» e «Cambia colore…» aprono un modulo sotto i campioni: Invio,
//   o il suo pulsante, lo conferma; Esc lo chiude e il fuoco torna al colore
//   da cui era partito. Un nome vuoto o di un altro campione, e un colore
//   che non si legge, si dicono accanto, e il modulo resta.
// - **Il fuoco non si perde.** Un colore preso col puntatore non prende il
//   fuoco, come gli altri pulsanti del pannello; quando un colore col fuoco
//   se ne va, il fuoco passa al vicino.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { displayBinding } from "../../../ui/commands";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";
import { plural, t } from "../strings";
import { cleanName, NAME_MAX } from "./naming";
import { customColor, swatchOf } from "./palette";
import { freshSwatchName, swatchNameProblem, swatchPaint } from "./swatches";

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il clic destro
/// che il tasto del menu manda dietro non ne apre un altro.
const KEYED_MENU_MS = 1000;

/// Le icone della sezione, col costrutto di `ui/icons.ts`: il più di «Nuovo
/// campione…».
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-swatches-add": ["M12 5v14", "M5 12h14"],
};

/// Dove va un colore della sezione.
export type PaintTarget = "fill" | "stroke";

/// Un campione del documento, come lo mostra la sezione.
export interface SwatchChip {
  readonly id: string;
  /// Il nome, già pulito.
  readonly name: string;
  /// `#rrggbb` minuscolo.
  readonly color: string;
  /// Quanti elementi lo mostrano.
  readonly uses: number;
}

/// Un colore che il disegno usa scritto.
export interface UsedChip {
  /// `#rrggbb` minuscolo.
  readonly color: string;
  /// Quanti elementi lo mostrano.
  readonly uses: number;
}

/// Ciò che la sezione mostra.
export interface ColorsView {
  /// Nell'ordine del documento.
  readonly swatches: readonly SwatchChip[];
  /// Dal più usato.
  readonly used: readonly UsedChip[];
  /// Quanti colori usati restano fuori da `used`.
  readonly hidden: number;
  /// I colori scelti di recente, `#rrggbb`, dal più recente.
  readonly recent: readonly string[];
  /// Dove va un colore: i bersagli che la selezione ha, nessuno se non ne
  /// ha; `null` senza selezione, e allora un colore è quello con cui si
  /// disegna.
  readonly targets: readonly PaintTarget[] | null;
  /// Il colore di ogni bersaglio, come lo legge il pannello: `url(#id)` per
  /// un campione, `#rrggbb`, `none`; `null` se è misto.
  readonly current: Readonly<Partial<Record<PaintTarget, string | null>>>;
  /// Il colore con cui si disegna, `#rrggbb`.
  readonly drawing: string;
  /// Il campione da cui viene il colore con cui si disegna, se viene da
  /// uno: gli oggetti nuovi lo usano.
  readonly drawingSwatch: string | null;
}

/// Un colore da dare: il valore che si scrive, il colore che si vede e il
/// nome con cui si dice.
export interface ColorChoice {
  /// `#rrggbb`, o `url(#id) #rrggbb` per un campione.
  readonly value: string;
  /// `#rrggbb`.
  readonly color: string;
  readonly name: string;
}

export interface SwatchesPanelOptions {
  /// Dà `choice` al bersaglio `target` della selezione, o con `null` a ciò
  /// che si disegna. `null` se è fatto, altrimenti perché no.
  onApply(choice: ColorChoice, target: PaintTarget | null): string | null;
  /// Un campione nuovo di nome `name`, già pulito e libero, e colore
  /// `color`: con `link`, chi usa `color` scritto passa a lui. Come
  /// `onApply`.
  onCreate(name: string, color: string, link: boolean): string | null;
  /// Chi usa scritto il colore del campione `id` passa a lui.
  onLink(id: string): string | null;
  /// Il nome nuovo del campione `id`, già pulito, libero e diverso.
  onRename(id: string, name: string): string | null;
  /// Il colore nuovo del campione `id`, `#rrggbb`, diverso.
  onRecolor(id: string, color: string): string | null;
  onDelete(id: string): string | null;
  /// Sceglie gli oggetti che mostrano `value`: `#rrggbb`, o `url(#id)` per
  /// un campione.
  onSelect(value: string): string | null;
  /// «Applica a» cambia.
  onTarget(target: PaintTarget): void;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

export interface SwatchesPanel {
  /// La sezione: «Applica a», le griglie e il modulo.
  readonly element: HTMLElement;
  /// Mostra `view`; falso `editable` in sola lettura, dove i colori si
  /// guardano e si sceglie chi li usa.
  update(view: ColorsView, editable: boolean): void;
  /// Il bersaglio scelto in «Applica a», anche se la selezione di adesso
  /// non l'ha.
  target(): PaintTarget;
  /// Sceglie il bersaglio di «Applica a» senza dirlo all'editor: l'ha
  /// scelto l'altra sezione.
  setTarget(target: PaintTarget): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

type GroupKind = "swatches" | "used" | "recent";

/// Un colore di una griglia.
interface Entry {
  readonly group: GroupKind;
  /// La chiave nella griglia: l'id del campione, o il colore.
  readonly key: string;
  /// `#rrggbb`.
  readonly color: string;
  readonly swatch: SwatchChip | null;
  /// Quanti elementi lo mostrano; `null` per un recente.
  readonly uses: number | null;
}

interface Group {
  readonly kind: GroupKind;
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly grid: HTMLElement;
  readonly note: HTMLElement;
  /// I pulsanti dei colori, per chiave.
  readonly chips: Map<string, HTMLButtonElement>;
  /// I colori disegnati, per chiave, nell'ordine della griglia.
  entries: Map<string, Entry>;
  /// La chiave del pulsante a cui si è andati, che tiene il Tab finché c'è.
  current: string | null;
}

/// Il modulo aperto.
interface Form {
  readonly mode: "new" | "make" | "rename" | "recolor";
  /// Il campione che si rinomina o si ricolora.
  readonly id: string | null;
  /// Il colore che «Rendi campione…» fa diventare un campione.
  readonly color: string | null;
  /// Il colore da cui è partito, dove torna il fuoco.
  readonly origin: { readonly group: GroupKind; readonly key: string } | null;
}

/// La chiave del pulsante «Nuovo campione…», l'ultimo dei campioni.
const ADD = "+";

/// Il nome di un colore scritto: quello della tavolozza, o il codice.
function colorName(code: string): string {
  const swatch = swatchOf(code);
  return swatch === null ? code : t(swatch.label);
}

/// La chiave di un campione in un valore `url(#id)`, o `null`.
function referenceId(value: string | null | undefined): string | null {
  const match = value === null || value === undefined ? null : /^url\(#([^)]+)\)/.exec(value);
  return match === null ? null : match[1]!;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createSwatchesPanel(life: Lifetime, options: SwatchesPanelOptions): SwatchesPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-swatches";

  let view: ColorsView = { swatches: [], used: [], hidden: 0, recent: [], targets: null, current: {}, drawing: "#000000", drawingSwatch: null };
  let editable = false;
  /// Il bersaglio scelto in «Applica a», finché l'editor vive.
  let chosen: PaintTarget = "fill";
  let form: Form | null = null;
  /// Il campione nuovo, per nome, che prende il fuoco quando arriva.
  let awaited: string | null = null;
  let keyedMenu = -Infinity;
  let numbers: { language: string; format: Intl.NumberFormat } | null = null;

  const numeral = (value: number): string => {
    const language = resolvedLanguage();
    if (numbers?.language !== language) numbers = { language, format: new Intl.NumberFormat(language) };
    return numbers.format.format(value);
  };

  // --- «Applica a» --------------------------------------------------------------

  const targetRow = document.createElement("div");
  targetRow.className = "draw-swatches-target";
  const targetLabel = document.createElement("span");
  targetLabel.className = "draw-properties-label";
  targetLabel.id = identifier("draw-swatches-target");
  // Una barra come le altre scelte del pannello: la scelta ha il filo
  // sotto, che la dice anche a chi non distingue i due fondi.
  const targetBar = document.createElement("div");
  targetBar.className = "draw-properties-bar";
  targetBar.setAttribute("role", "toolbar");
  targetBar.setAttribute("aria-labelledby", targetLabel.id);
  const targetButtons = new Map<PaintTarget, HTMLButtonElement>();
  for (const target of ["fill", "stroke"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-button";
    button.dataset.target = target;
    targetBar.append(button);
    targetButtons.set(target, button);
    life.listen(button, "click", () => {
      if (chosen === target) return;
      chosen = target;
      options.onTarget(target);
      paint();
    });
  }
  targetRow.append(targetLabel, targetBar);
  targetRow.hidden = true;
  element.append(targetRow);
  // «Applica a» è una barra: il Tab va al bersaglio scelto, le frecce
  // all'altro.
  life.listen(targetBar, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const buttons = [...targetButtons.values()];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    buttons.forEach((button, index) => (button.tabIndex = index === next ? 0 : -1));
    buttons[next]!.focus();
  });

  /// Il bersaglio di un clic: quello scelto, se la selezione l'ha, o quello
  /// che ha; `null` senza selezione o senza bersagli.
  const effective = (): PaintTarget | null => {
    const targets = view.targets;
    if (targets === null || targets.length === 0) return null;
    return targets.includes(chosen) ? chosen : targets[0]!;
  };

  // --- Le griglie ---------------------------------------------------------------

  const groups = new Map<GroupKind, Group>();
  for (const kind of ["swatches", "used", "recent"] as const) {
    const root = document.createElement("div");
    root.className = "draw-swatches-group";
    root.dataset.group = kind;
    root.setAttribute("role", "group");
    const heading = document.createElement("h4");
    heading.className = "draw-swatches-heading";
    heading.id = identifier("draw-swatches-heading");
    root.setAttribute("aria-labelledby", heading.id);
    const grid = document.createElement("div");
    grid.className = "draw-swatches-grid";
    grid.setAttribute("role", "toolbar");
    grid.setAttribute("aria-labelledby", heading.id);
    const note = document.createElement("p");
    note.className = "draw-properties-note";
    note.hidden = true;
    root.append(heading, grid, note);
    element.append(root);
    groups.set(kind, { kind, root, heading, grid, note, chips: new Map(), entries: new Map(), current: null });
  }
  const swatchGroup = groups.get("swatches")!;

  // «Nuovo campione…», in fondo ai campioni.
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "draw-button draw-swatches-add";
  addButton.dataset.key = ADD;
  const addIcon = iconEl("draw-swatches-add");
  if (addIcon !== null) addButton.append(addIcon);
  swatchGroup.grid.append(addButton);

  /// Il nome di un colore, che si sente: col codice per un campione, e con
  /// quanti oggetti lo mostrano.
  const labelOf = (entry: Entry): string => {
    const name = entry.swatch === null ? colorName(entry.color) : t("draw.colors.swatch", { name: entry.swatch.name, code: entry.color });
    if (entry.uses === null) return name;
    const uses = entry.uses === 0 ? t("draw.colors.uses.none") : plural(entry.uses, "draw.colors.uses.one", "draw.colors.uses.other", { count: numeral(entry.uses) });
    return `${name}, ${uses}`;
  };

  /// Che cosa fa un clic, per il suggerimento.
  const hintText = (): string => {
    const targets = view.targets;
    if (targets === null) return t("draw.colors.hint.drawing");
    const target = effective();
    if (target === null) return t("draw.colors.hint.none");
    const lines = [t(target === "fill" ? "draw.colors.hint.fill" : "draw.colors.hint.stroke")];
    if (targets.length > 1) lines.push(t(target === "fill" ? "draw.colors.hint.other_stroke" : "draw.colors.hint.other_fill"));
    return lines.join("\n");
  };

  /// Vero se `entry` è il colore di adesso: del bersaglio, o senza
  /// selezione quello con cui si disegna.
  const isCurrent = (entry: Entry): boolean => {
    const target = effective();
    if (view.targets === null) return entry.swatch === null ? view.drawingSwatch === null && entry.color === view.drawing : entry.swatch.id === view.drawingSwatch;
    if (target === null) return false;
    const value = view.current[target];
    if (value === null || value === undefined) return false;
    return entry.swatch === null ? value === entry.color : referenceId(value) === entry.swatch.id;
  };

  const entriesOf = (kind: GroupKind): Entry[] => {
    switch (kind) {
      case "swatches":
        return view.swatches.map((swatch) => ({ group: kind, key: swatch.id, color: swatch.color, swatch, uses: swatch.uses }));
      case "used":
        return view.used.map((used) => ({ group: kind, key: used.color, color: used.color, swatch: null, uses: used.uses }));
      case "recent":
        return view.recent.map((color) => ({ group: kind, key: color, color, swatch: null, uses: null }));
    }
  };

  const createChip = (group: Group, key: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-button draw-swatches-chip";
    button.id = identifier("draw-swatches-chip");
    button.dataset.key = key;
    const frame = document.createElement("span");
    frame.className = "draw-swatch-frame";
    const color = document.createElement("span");
    color.className = "draw-swatch";
    frame.append(color);
    button.append(frame);
    if (group.kind !== "recent") {
      const count = document.createElement("span");
      count.className = "draw-swatches-count";
      count.setAttribute("aria-hidden", "true");
      button.append(count);
    }
    group.chips.set(key, button);
    return button;
  };

  /// I pulsanti della griglia di `group` che prendono il fuoco, in ordine.
  const buttonsOf = (group: Group): HTMLButtonElement[] =>
    [...group.grid.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.hidden);

  /// Dà il Tab a un pulsante solo della griglia: quello a cui si è andati,
  /// se c'è ancora, se no il colore di adesso, se no il primo.
  const syncTab = (group: Group): void => {
    const buttons = buttonsOf(group);
    const current =
      buttons.find((button) => button.dataset.key === group.current) ?? buttons.find((button) => button.getAttribute("aria-current") === "true") ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  };

  const renderGroup = (group: Group): void => {
    const entries = entriesOf(group.kind);
    const hint = hintText();
    const next = new Map<string, Entry>();
    const order: HTMLButtonElement[] = [];
    for (const entry of entries) {
      next.set(entry.key, entry);
      const button = group.chips.get(entry.key) ?? createChip(group, entry.key);
      const frame = button.firstElementChild as HTMLElement;
      frame.dataset.shape = swatchOf(entry.color)?.shape ?? "ring";
      (frame.firstElementChild as HTMLElement).style.setProperty("--swatch", entry.color);
      const count = button.querySelector<HTMLElement>(".draw-swatches-count");
      if (count !== null) setText(count, entry.uses === null ? "" : numeral(entry.uses));
      const label = labelOf(entry);
      button.setAttribute("aria-label", label);
      button.title = `${label}\n${hint}`;
      if (isCurrent(entry)) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      order.push(button);
    }
    for (const [key, button] of group.chips) {
      if (next.has(key)) continue;
      button.remove();
      group.chips.delete(key);
    }
    if (group.kind === "swatches") order.push(addButton);
    // Si spostano soltanto i pulsanti fuori posto: uno che si sposta perde
    // il fuoco.
    const focused = document.activeElement;
    order.forEach((button, at) => {
      if (group.grid.children[at] !== button) group.grid.insertBefore(button, group.grid.children[at] ?? null);
    });
    if (focused instanceof HTMLElement && focused !== document.activeElement && group.grid.contains(focused)) focused.focus({ preventScroll: true });
    group.entries = next;
  };

  /// Il colore di `button`, se è un colore di una griglia.
  const entryOf = (button: Element | null): Entry | null => {
    const chip = button?.closest<HTMLButtonElement>(".draw-swatches-chip") ?? null;
    if (chip === null || !element.contains(chip)) return null;
    const group = groups.get(chip.closest<HTMLElement>(".draw-swatches-group")!.dataset.group as GroupKind)!;
    return group.entries.get(chip.dataset.key!) ?? null;
  };

  const chipOf = (group: GroupKind, key: string): HTMLButtonElement | null => groups.get(group)!.chips.get(key) ?? null;

  // --- I gesti ------------------------------------------------------------------

  const refusal = (): string => t("draw.rejected", { reason: t("draw.reason.read_only") });
  const report = (failure: string | null): void => {
    if (failure !== null) options.announce(failure);
  };

  const choiceOf = (entry: Entry): ColorChoice => ({
    value: entry.swatch === null ? entry.color : swatchPaint(entry.swatch),
    color: entry.color,
    name: entry.swatch?.name ?? colorName(entry.color),
  });

  /// Dà il colore di `entry` al bersaglio, o con `other` all'altro.
  const apply = (entry: Entry, other: boolean): void => {
    if (!editable) return options.announce(refusal());
    if (view.targets === null) return report(options.onApply(choiceOf(entry), null));
    let target = effective();
    if (target === null) return options.announce(t("draw.colors.hint.none"));
    const flipped: PaintTarget = target === "fill" ? "stroke" : "fill";
    if (other && view.targets.includes(flipped)) target = flipped;
    report(options.onApply(choiceOf(entry), target));
  };

  const applyTo = (entry: Entry, target: PaintTarget): void => {
    if (!editable) return options.announce(refusal());
    report(options.onApply(choiceOf(entry), target));
  };

  const remove = (entry: Entry): void => {
    if (entry.swatch === null) return;
    if (!editable) return options.announce(refusal());
    report(options.onDelete(entry.swatch.id));
  };

  const selectShowing = (entry: Entry): void => {
    report(options.onSelect(entry.swatch === null ? entry.color : `url(#${entry.swatch.id})`));
  };

  const menuItems = (entry: Entry): MenuItem[] => {
    const off = !editable;
    const items: MenuItem[] = [];
    const targets = view.targets;
    if (targets === null) {
      items.push({ label: t("draw.colors.menu.drawing"), disabled: off, run: () => apply(entry, false) });
    } else {
      for (const target of ["fill", "stroke"] as const) {
        if (targets.includes(target)) items.push({ label: t(`draw.colors.menu.${target}`), disabled: off, run: () => applyTo(entry, target) });
      }
    }
    const first = items.length;
    const swatch = entry.swatch;
    if (swatch !== null) {
      items.push(
        { label: t("draw.colors.menu.rename"), hint: displayBinding("F2"), disabled: off, run: () => openForm({ mode: "rename", id: swatch.id, color: null, origin: { group: entry.group, key: entry.key } }) },
        { label: t("draw.colors.menu.recolor"), disabled: off, run: () => openForm({ mode: "recolor", id: swatch.id, color: null, origin: { group: entry.group, key: entry.key } }) },
        {
          label: t("draw.colors.menu.select_swatch"),
          disabled: swatch.uses === 0,
          ...(swatch.uses === 0 ? { description: t("draw.colors.menu.unused") } : {}),
          run: () => selectShowing(entry),
        },
        {
          label: t("draw.colors.menu.delete"),
          separator: true,
          danger: true,
          hint: displayBinding("Delete"),
          description: t("draw.colors.menu.delete.note"),
          disabled: off,
          run: () => remove(entry),
        },
      );
    } else {
      items.push({ label: t("draw.colors.menu.make"), disabled: off, run: () => openForm({ mode: "make", id: null, color: entry.color, origin: { group: entry.group, key: entry.key } }) });
      if (entry.uses !== null) {
        for (const each of view.swatches) {
          if (each.color !== entry.color) continue;
          items.push({ label: t("draw.colors.menu.link", { name: each.name }), description: t("draw.colors.menu.link.note"), disabled: off, run: () => report(options.onLink(each.id)) });
        }
        items.push({ label: t("draw.colors.menu.select_color"), run: () => selectShowing(entry) });
      }
    }
    if (first > 0 && items.length > first) items[first]!.separator = true;
    return items;
  };

  /// Apre il menu di `entry`: sotto il suo pulsante, o dove si è cliccato.
  const openMenu = (entry: Entry, at: MouseEvent | null): void => {
    const chip = chipOf(entry.group, entry.key);
    if (chip === null) return;
    let point = at;
    if (point === null) {
      const box = chip.getBoundingClientRect();
      point = new MouseEvent("contextmenu", { clientX: box.left, clientY: box.bottom + 4, bubbles: true, cancelable: true });
    }
    showContextMenu(point, menuItems(entry), { labelledBy: chip.id });
  };

  // --- La tastiera e il puntatore -------------------------------------------------

  /// Il pulsante della riga sopra o sotto `from` più vicino in orizzontale;
  /// senza disposizione, come una fila, il precedente o il seguente.
  const vertical = (buttons: readonly HTMLButtonElement[], from: HTMLButtonElement, step: 1 | -1): HTMLButtonElement | null => {
    const box = from.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return buttons[buttons.indexOf(from) + step] ?? null;
    const middle = box.left + box.width / 2;
    let best: HTMLButtonElement | null = null;
    let bestRow = Infinity;
    let bestGap = Infinity;
    for (const button of buttons) {
      const other = button.getBoundingClientRect();
      const row = (other.top - box.top) * step;
      // La riga dopo, nel verso: almeno mezzo pulsante più in là.
      if (row < box.height / 2) continue;
      const gap = Math.abs(other.left + other.width / 2 - middle);
      if (row < bestRow - 1 || (Math.abs(row - bestRow) <= 1 && gap < bestGap)) {
        best = button;
        bestRow = row;
        bestGap = gap;
      }
    }
    return best;
  };

  for (const group of groups.values()) {
    const { grid } = group;
    life.listen(grid, "keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !grid.contains(target)) return;
      const buttons = buttonsOf(group);
      const at = buttons.indexOf(target);
      const entry = entryOf(target);
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      let next: HTMLButtonElement | null | undefined;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && plain)) {
        if (entry === null) return;
        keyedMenu = event.timeStamp;
        openMenu(entry, null);
      } else if (!plain) {
        return;
      } else if (event.key === "Enter" || event.key === " ") {
        if (entry === null) {
          if (event.shiftKey) return;
          startNew();
        } else {
          apply(entry, event.shiftKey);
        }
      } else if (event.shiftKey) {
        return;
      } else if (event.key === "ArrowRight") {
        next = buttons[(at + 1) % buttons.length];
      } else if (event.key === "ArrowLeft") {
        next = buttons[(at - 1 + buttons.length) % buttons.length];
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        next = vertical(buttons, target, event.key === "ArrowDown" ? 1 : -1);
        // In cima o in fondo il fuoco resta dov'è.
        next ??= target;
      } else if (event.key === "Home") {
        next = buttons[0];
      } else if (event.key === "End") {
        next = buttons[buttons.length - 1];
      } else if (event.key === "F2" && entry?.swatch != null) {
        if (!editable) options.announce(refusal());
        else openForm({ mode: "rename", id: entry.swatch.id, color: null, origin: { group: entry.group, key: entry.key } });
      } else if ((event.key === "Delete" || event.key === "Backspace") && entry?.swatch != null) {
        remove(entry);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (next != null && next !== target) {
        group.current = next.dataset.key ?? null;
        syncTab(group);
        next.focus();
      }
    });
    life.listen(grid, "focusin", (event) => {
      if (event.target instanceof HTMLButtonElement && grid.contains(event.target)) {
        group.current = event.target.dataset.key ?? null;
        syncTab(group);
      }
    });
    life.listen(grid, "click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button === null || !grid.contains(button)) return;
      if (button === addButton) {
        startNew();
        return;
      }
      const entry = entryOf(button);
      if (entry !== null) apply(entry, event.shiftKey);
    });
    // Il clic destro, o la pressione lunga, aprono il menu del colore sotto
    // il puntatore; quello che il tasto del menu manda dietro no, perché il
    // menu è già aperto.
    life.listen(grid, "contextmenu", (event) => {
      if (event.timeStamp - keyedMenu < KEYED_MENU_MS) {
        keyedMenu = -Infinity;
        event.preventDefault();
        return;
      }
      const entry = entryOf(event.target as Element | null);
      if (entry === null) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(entry, event);
    });
  }

  // --- Il modulo ------------------------------------------------------------------

  const formRoot = document.createElement("div");
  formRoot.className = "draw-swatches-form";
  formRoot.setAttribute("role", "group");
  formRoot.hidden = true;
  const formTitle = document.createElement("p");
  formTitle.className = "draw-swatches-form-title";
  formTitle.id = identifier("draw-swatches-form");
  formRoot.setAttribute("aria-labelledby", formTitle.id);

  const textInput = (): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "draw-properties-input";
    input.id = identifier("draw-swatches-field");
    input.autocomplete = "off";
    input.enterKeyHint = "done";
    return input;
  };
  const labelFor = (input: HTMLInputElement): HTMLLabelElement => {
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = input.id;
    return label;
  };

  const nameInput = textInput();
  nameInput.maxLength = NAME_MAX;
  nameInput.spellcheck = true;
  nameInput.setAttribute("autocapitalize", "sentences");
  const nameLabel = labelFor(nameInput);
  const nameRow = document.createElement("div");
  nameRow.className = "draw-swatches-form-row";
  nameRow.append(nameLabel, nameInput);

  const colorInput = textInput();
  colorInput.spellcheck = false;
  colorInput.setAttribute("autocapitalize", "off");
  const colorLabel = labelFor(colorInput);
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "draw-properties-picker";
  const colorBox = document.createElement("div");
  colorBox.className = "draw-properties-paint";
  colorBox.append(colorInput, picker);
  const colorRow = document.createElement("div");
  colorRow.className = "draw-swatches-form-row";
  colorRow.append(colorLabel, colorBox);

  const formError = document.createElement("p");
  formError.className = "draw-properties-error";
  formError.id = identifier("draw-swatches-error");
  formError.hidden = true;

  const formActions = document.createElement("div");
  formActions.className = "draw-swatches-form-actions";
  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "draw-button draw-properties-apply";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "draw-button draw-properties-apply";
  formActions.append(submitButton, cancelButton);
  formRoot.append(formTitle, nameRow, colorRow, formError, formActions);
  // Il modulo sta sotto i campioni, che sono ciò che cambia.
  swatchGroup.root.append(formRoot);

  /// Dice nel modulo che cosa non va, accanto a `input` se è suo.
  const showFormError = (text: string | null, input: HTMLInputElement | null): void => {
    formError.hidden = text === null;
    setText(formError, text ?? "");
    for (const each of [nameInput, colorInput]) {
      if (text !== null && each === input) {
        each.setAttribute("aria-invalid", "true");
        each.setAttribute("aria-describedby", formError.id);
      } else {
        each.removeAttribute("aria-invalid");
        each.removeAttribute("aria-describedby");
      }
    }
  };

  const formFail = (text: string, input: HTMLInputElement | null): void => {
    showFormError(text, input);
    options.announce(text);
    (input ?? (nameRow.hidden ? colorInput : nameInput)).focus({ preventScroll: true });
  };

  /// Il colore da cui parte un campione nuovo: quello del bersaglio, se è
  /// un colore o un campione, se no quello con cui si disegna.
  const startColor = (): string => {
    const target = effective();
    const value = target === null ? undefined : view.current[target];
    if (value !== null && value !== undefined) {
      const code = customColor(value);
      if (code !== null) return code;
      const swatch = view.swatches.find((each) => each.id === referenceId(value));
      if (swatch !== undefined) return swatch.color;
    }
    return view.drawing;
  };

  const swatchById = (id: string | null): SwatchChip | undefined => view.swatches.find((swatch) => swatch.id === id);

  /// I testi del modulo; chiuso, quelli di «Nuovo campione», perché anche
  /// nascosto ogni pulsante abbia il suo nome.
  const relabelForm = (): void => {
    const swatch = swatchById(form?.id ?? null);
    switch (form?.mode ?? "new") {
      case "new":
        setText(formTitle, t("draw.colors.form.new"));
        break;
      case "make":
        setText(formTitle, t("draw.colors.form.make", { code: form!.color! }));
        break;
      case "rename":
        setText(formTitle, t("draw.colors.form.rename", { name: swatch?.name ?? "" }));
        break;
      case "recolor":
        setText(formTitle, t("draw.colors.form.recolor", { name: swatch?.name ?? "" }));
        break;
    }
    setText(submitButton, t(form === null || form.mode === "new" || form.mode === "make" ? "draw.colors.form.create" : "draw.colors.form.apply"));
  };

  function openForm(next: Form): void {
    if (!editable) return options.announce(refusal());
    closeContextMenu();
    form = next;
    const swatch = swatchById(next.id);
    nameRow.hidden = next.mode === "recolor";
    colorRow.hidden = next.mode === "rename" || next.mode === "make";
    const start = next.mode === "make" ? next.color! : next.mode === "new" ? startColor() : (swatch?.color ?? view.drawing);
    // Un campione nuovo prende il nome del colore della tavolozza, o
    // «Campione»: il codice, dopo un cambio di colore, direbbe il falso.
    const base = swatchOf(start) === null ? t("draw.colors.form.default") : colorName(start);
    nameInput.value = next.mode === "rename" ? (swatch?.name ?? "") : freshSwatchName(view.swatches, base);
    colorInput.value = start;
    picker.value = start;
    showFormError(null, null);
    relabelForm();
    formRoot.hidden = false;
    const input = nameRow.hidden ? colorInput : nameInput;
    input.focus({ preventScroll: true });
    input.select();
    formRoot.scrollIntoView?.({ block: "nearest" });
  }

  /// «Nuovo campione…».
  function startNew(): void {
    openForm({ mode: "new", id: null, color: null, origin: { group: "swatches", key: ADD } });
  }

  /// Chiude il modulo; il fuoco va al campione `name`, se c'è o quando
  /// arriva, o al colore da cui il modulo era partito.
  const closeForm = (name: string | null): void => {
    const state = form;
    form = null;
    formRoot.hidden = true;
    showFormError(null, null);
    relabelForm();
    if (state === null) return;
    if (name !== null) {
      awaited = name;
      if (focusAwaited()) return;
    }
    const origin = state.origin === null ? null : chipOf(state.origin.group, state.origin.key) ?? (state.origin.key === ADD ? addButton : null);
    (origin ?? buttonsOf(swatchGroup)[0] ?? element).focus({ preventScroll: true });
  };

  /// Il fuoco al campione nuovo che si aspetta, se è arrivato.
  const focusAwaited = (): boolean => {
    if (awaited === null) return false;
    const swatch = view.swatches.find((each) => each.name === awaited);
    const chip = swatch === undefined ? null : chipOf("swatches", swatch.id);
    if (chip === null) return false;
    awaited = null;
    swatchGroup.current = swatch!.id;
    syncTab(swatchGroup);
    chip.focus({ preventScroll: true });
    return true;
  };

  const submit = (): void => {
    const state = form;
    if (state === null) return;
    if (!editable) return formFail(refusal(), null);
    const swatch = swatchById(state.id);
    if ((state.mode === "rename" || state.mode === "recolor") && swatch === undefined) return closeForm(null);
    let name = "";
    if (state.mode !== "recolor") {
      name = cleanName(nameInput.value);
      const problem = swatchNameProblem(view.swatches, name, state.id);
      if (problem !== null) {
        const text = problem === "empty" ? t("draw.colors.problem.empty") : t(problem === "taken" ? "draw.colors.problem.taken" : "draw.colors.problem.reads_color", { name });
        return formFail(text, nameInput);
      }
    }
    let color = state.color ?? "";
    if (state.mode === "new" || state.mode === "recolor") {
      const code = customColor(colorInput.value);
      if (code === null) return formFail(t("draw.colors.problem.color"), colorInput);
      color = code;
    }
    let failure: string | null = null;
    if (state.mode === "new" || state.mode === "make") failure = options.onCreate(name, color, state.mode === "make");
    else if (state.mode === "rename" && name !== swatch!.name) failure = options.onRename(swatch!.id, name);
    else if (state.mode === "recolor" && color !== swatch!.color) failure = options.onRecolor(swatch!.id, color);
    if (failure !== null) return formFail(failure, null);
    closeForm(state.mode === "new" || state.mode === "make" ? name : null);
  };

  life.listen(formRoot, "keydown", (event) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (event.key === "Escape" && plain) {
      closeForm(null);
    } else if (event.key === "Enter" && plain && event.target instanceof HTMLInputElement && event.target.type === "text") {
      submit();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  life.listen(submitButton, "click", () => submit());
  life.listen(cancelButton, "click", () => closeForm(null));
  // Il selettore del sistema e il codice si seguono.
  life.listen(picker, "input", () => {
    colorInput.value = picker.value;
    showFormError(null, null);
  });
  life.listen(colorInput, "input", () => {
    const code = customColor(colorInput.value);
    if (code !== null) picker.value = code;
  });

  // --- Mostrare -----------------------------------------------------------------

  /// Ridisegna con la vista di adesso, tenendo il fuoco.
  function paint(): void {
    const focused = document.activeElement;
    const was = focused instanceof HTMLButtonElement ? entryOf(focused) : null;
    const wasAt = was === null ? -1 : buttonsOf(groups.get(was.group)!).indexOf(focused as HTMLButtonElement);
    const targets = view.targets;
    targetRow.hidden = targets === null || targets.length < 2;
    const target = effective();
    const roving = targetBar.contains(document.activeElement);
    for (const [each, button] of targetButtons) {
      button.setAttribute("aria-pressed", String(each === target));
      // Il Tab va al bersaglio scelto, se il fuoco non è già nella barra.
      if (!roving) button.tabIndex = each === target ? 0 : -1;
    }
    for (const group of groups.values()) renderGroup(group);
    groups.get("recent")!.root.hidden = view.recent.length === 0;
    addButton.hidden = false;
    if (editable) addButton.removeAttribute("aria-disabled");
    else addButton.setAttribute("aria-disabled", "true");
    const swatchNote = view.swatches.length === 0 ? t(editable ? "draw.colors.swatches.empty" : "draw.colors.swatches.empty.read_only") : "";
    swatchGroup.note.hidden = swatchNote === "";
    setText(swatchGroup.note, swatchNote);
    const used = groups.get("used")!;
    const usedNote =
      view.used.length === 0
        ? t("draw.colors.used.empty")
        : view.hidden > 0
          ? plural(view.hidden, "draw.colors.more.one", "draw.colors.more.other", { count: numeral(view.hidden) })
          : "";
    used.note.hidden = usedNote === "";
    setText(used.note, usedNote);
    used.grid.hidden = view.used.length === 0;
    for (const group of groups.values()) syncTab(group);
    // Un campione che si rinominava o si ricolorava e se n'è andato chiude
    // il modulo.
    if (form !== null && (form.mode === "rename" || form.mode === "recolor") && swatchById(form.id) === undefined) closeForm(null);
    else relabelForm();
    if (focusAwaited()) return;
    // Un colore col fuoco che se n'è andato lo lascia al vicino.
    if (was !== null && !(document.activeElement instanceof HTMLElement && element.contains(document.activeElement))) {
      const group = groups.get(was.group)!;
      const buttons = buttonsOf(group);
      const next = buttons[Math.min(wasAt, buttons.length - 1)];
      if (next !== undefined && !group.grid.hidden) {
        group.current = next.dataset.key ?? null;
        syncTab(group);
        next.focus({ preventScroll: true });
      } else {
        element.closest<HTMLElement>("[tabindex]")?.focus({ preventScroll: true });
      }
    }
  }

  const relabel = (): void => {
    setText(targetLabel, t("draw.colors.target"));
    setText(targetButtons.get("fill")!, t("draw.properties.fill"));
    setText(targetButtons.get("stroke")!, t("draw.properties.stroke"));
    setText(swatchGroup.heading, t("draw.colors.swatches"));
    setText(groups.get("used")!.heading, t("draw.colors.used"));
    setText(groups.get("recent")!.heading, t("draw.colors.recent"));
    const add = t("draw.colors.add");
    addButton.setAttribute("aria-label", add);
    addButton.title = add;
    setText(nameLabel, t("draw.colors.form.name"));
    setText(colorLabel, t("draw.colors.form.color"));
    picker.setAttribute("aria-label", t("draw.colors.form.picker"));
    setText(cancelButton, t("draw.colors.form.cancel"));
    paint();
  };
  relabel();

  return {
    element,
    update(next, nextEditable) {
      view = next;
      editable = nextEditable;
      // In sola lettura il modulo non scrive più.
      if (!editable && form !== null) closeForm(null);
      paint();
    },
    target: () => chosen,
    setTarget(target) {
      if (chosen === target) return;
      chosen = target;
      paint();
    },
    relabel,
  };
}
