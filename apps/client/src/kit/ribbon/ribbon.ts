// La barra multifunzione: le schede di `types.ts` sopra un editor, come in
// Excel e in Word.
//
// Non sa scrivere niente da sé: ogni controllo dà un comando del catalogo di
// chi la monta (`RibbonOptions.command`), e lo stato che mostra (premuto,
// spento con la sua ragione, un valore) lo legge a ogni aggiornamento dalla
// vista. Un controllo il cui comando il catalogo non serve non si vede; un
// gruppo senza controlli, nemmeno; una scheda senza gruppi, nemmeno.
//
// La tastiera è quella di Office: Alt da solo (o F10) mostra le lettere delle
// schede, una lettera sceglie la scheda e mostra quelle dei controlli, Esc
// torna indietro. Dentro una scheda i controlli sono una barra degli strumenti
// WAI-ARIA: un solo controllo nel Tab, le frecce fra gli altri, Esc torna
// all'editor. Il puntatore non prende il fuoco ai pulsanti, così la selezione
// resta quella scelta.
//
// Quando la barra è stretta i gruppi si raccolgono da destra, ciascuno in un
// pulsante che apre il suo contenuto in un riquadro.
//
// Come il resto del kit non ha testo suo: le etichette e le frasi arrivano da
// chi la monta, e le classi portano il suo prefisso (`grid-ribbon-…`), perché
// le pelli che lo vestono restino le sue.
import { labelButton, setPressed, type ButtonChord } from "../button";
import { openPopover, type PopoverHandle } from "../popover";
import { createTabs, type TabsHandle } from "../tabs";
import { identifier } from "../../ui/a11y";
import { iconEl } from "../../ui/icons";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../ui/menu";
import { setTooltip } from "../../ui/tooltip";
import {
  groupControls,
  type ButtonControl,
  type CheckControl,
  type ExtraControl,
  type FieldControl,
  type KitControl,
  type MenuControl,
  type MenuEntry,
  type Params,
  type RibbonColumn,
  type RibbonGroup,
  type RibbonTab,
  type SelectControl,
  type SplitControl,
  type Text,
} from "./types";

/// Lo stato di un comando del catalogo: se c'è, è servito.
export interface RibbonCommandState {
  readonly id: string;
  readonly enabled: boolean;
  readonly reason?: string | null;
}

/// Le frasi della barra stessa, nella lingua di chi la monta.
export interface RibbonStrings {
  /// Il nome della fila delle schede.
  label(): string;
  collapse(): string;
  expand(): string;
  /// Il suggerimento di un controllo spento.
  unavailable(label: string, reason: string): string;
  /// Un menu senza voci servite.
  empty(): string;
  /// Il nome della mini-barra.
  mini(): string;
  /// Il nome della fila dei pulsanti accanto alle schede (`quick`).
  quick?(): string;
}

/// Una voce del menu del tasto destro, con la forma del menu dell'editor
/// (`SurfaceMenuItem`).
export interface RibbonMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly checked?: boolean;
  readonly items?: readonly RibbonMenuItem[];
  readonly run?: () => void;
}

/// Un controllo montato.
export interface RibbonItem<V, C, K extends string> {
  readonly control: C;
  readonly group: RibbonGroup<C, K>;
  readonly wrap: HTMLElement;
  /// Visibile adesso.
  shown: boolean;
  update(view: V): void;
  /// Ciò che fa la sua lettera.
  activate(): void;
  relabel(): void;
}

/// I pezzi della barra con cui chi la monta disegna le sue specie di
/// controllo (`RibbonOptions.extra`).
export interface RibbonParts<V, K extends string> {
  readonly life: Lifetime;
  /// La classe `name` col prefisso della barra.
  cls(name: string): string;
  /// Un id nuovo col prefisso della barra.
  id(): string;
  t(key: K): string;
  wrap(control: ExtraControl<V, K>): HTMLElement;
  button(control: ExtraControl<V, K>, label: () => string, onPress: (button: HTMLButtonElement) => void): HTMLButtonElement;
  chevron(): Element;
  /// Spento con la ragione del catalogo nel suggerimento, o acceso.
  availability(el: HTMLElement, id: string, label: string): void;
  /// Un nome da riscrivere quando cambia la lingua.
  relabel(name: () => void): void;
  /// Dà il comando `id`.
  give(id: string, params: Params | null | undefined): void;
  view(): V;
  closePopover(): void;
  /// Apre `content` in un riquadro sotto `anchor`; `local` si chiude con lui.
  showPopover(anchor: HTMLElement, content: HTMLElement, label: string, local: Lifetime, className?: string): void;
  /// Le frecce fra le caselle di una griglia di `columns` colonne.
  gridKeys(lifetime: Lifetime, container: HTMLElement, cells: readonly HTMLButtonElement[], columns: number): void;
}

export interface RibbonOptions<V, K extends string, X extends ExtraControl<V, K>> {
  /// Dove sta la barra; il suo genitore ascolta Alt e F10.
  readonly host: HTMLElement;
  /// Il prefisso delle classi e degli id: `grid-ribbon`.
  readonly prefix: string;
  /// Il prefisso degli id delle voci di sottomenu del tasto destro.
  readonly menuPrefix: string;
  readonly tabs: readonly RibbonTab<KitControl<V, K> | X, K>[];
  /// Gli id dei controlli della prima scheda che la mini-barra mostra.
  readonly mini: readonly string[];
  /// Le icone della freccia in giù e in su.
  readonly chevrons: { readonly down: string; readonly up: string };
  readonly strings: RibbonStrings;
  t(key: K): string;
  /// I comandi che il catalogo serve adesso.
  commands(): readonly RibbonCommandState[];
  /// Se adesso si danno comandi: altrimenti la barra non si vede.
  commandable(): boolean;
  /// La vista che i controlli leggono.
  view(): V;
  /// Se il contesto di una scheda contestuale c'è.
  contextShown(context: string, view: V): boolean;
  command(id: string, params: string): void;
  /// Apre la finestra `id`; `anchor` è il controllo che la chiede, per chi
  /// la apre in un riquadro sotto di lui.
  openDialog(id: string, params: string, anchor: HTMLElement): void;
  /// L'accordo del comando `id`, per il suggerimento e `aria-keyshortcuts`.
  chord?(id: string): ButtonChord | null;
  /// I pulsanti accanto alle schede, sempre a portata (Annulla, Ripeti).
  readonly quick?: readonly ButtonControl<V, K>[];
  /// Scrive il testo di una voce `write`.
  write?(text: string): void;
  /// L'azione della shell `action`, se la shell la offre adesso.
  shell?(action: string): (() => void) | null;
  /// Torna all'editor.
  focus(): void;
  /// Si iscrive al cambio di lingua, e torna come smettere.
  languages(listener: () => void): () => void;
  /// Disegna un controllo di una specie che la barra non conosce.
  extra?(control: X, group: RibbonGroup<KitControl<V, K> | X, K>, parts: RibbonParts<V, K>): RibbonItem<V, KitControl<V, K> | X, K>;
}

export interface Ribbon<V, K extends string> {
  readonly element: HTMLElement;
  /// Rilegge subito lo stato.
  refresh(): void;
  /// Rilegge al prossimo fotogramma: per i richiami che arrivano a raffica.
  schedule(): void;
  /// Le voci di `entries` per il menu del tasto destro: quelle che il
  /// catalogo serve adesso, vuote se non si danno comandi.
  contextMenu(entries: (view: V) => readonly MenuEntry<K>[]): RibbonMenuItem[];
  /// Monta la mini-barra in `host` e torna come toglierla. I suoi controlli
  /// sono della barra e vivono con lei: smontarla li stacca soltanto.
  mountMini(host: HTMLElement): () => void;
  destroy(): void;
}

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

export function mountRibbon<V, K extends string, X extends ExtraControl<V, K> = never>(options: RibbonOptions<V, K, X>): Ribbon<V, K> {
  type C = KitControl<V, K> | X;
  type Item = RibbonItem<V, C, K>;
  interface Group {
    readonly spec: RibbonGroup<C, K>;
    readonly element: HTMLElement;
    readonly body: HTMLElement;
    readonly toggle: HTMLButtonElement;
    readonly items: Item[];
    collapsed: boolean;
    relabel(): void;
  }
  interface Tab {
    readonly spec: RibbonTab<C, K>;
    readonly panel: HTMLElement;
    readonly toolbar: HTMLElement;
    readonly groups: Group[];
    /// Rimette il Tab su un controllo che c'è.
    readonly settle: (target: HTMLElement | null) => void;
  }
  const life = openLifetime();
  const host = options.host;
  const root = host.parentElement ?? host;
  const { strings, t } = options;
  const cls = (name: string): string => `${options.prefix}-${name}`;
  const text = (value: Text<K>): string => (typeof value === "string" ? t(value) : value.raw);

  const element = document.createElement("div");
  element.className = options.prefix;
  const head = document.createElement("div");
  head.className = cls("head");
  const tablist = document.createElement("div");
  tablist.className = cls("tabs");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = cls("toggle");
  toggle.tabIndex = -1;
  const quickBar = document.createElement("div");
  quickBar.className = cls("quick");
  quickBar.setAttribute("role", "toolbar");
  if (options.quick?.length) head.append(quickBar);
  head.append(tablist, toggle);
  const panels = document.createElement("div");
  panels.className = cls("panels");
  element.append(head, panels);
  host.append(element);

  let states = new Map<string, RibbonCommandState>();
  const served = (id: string): boolean => states.has(id);
  const stateOf = (id: string): RibbonCommandState | undefined => states.get(id);
  let collapsed = false;
  let popover: PopoverHandle | null = null;
  let menuOpen = false;
  let menuTicket = 0;
  const relabels: (() => void)[] = [];

  function give(id: string, params: Params | null | undefined): void {
    closePopover();
    endPeek();
    options.command(id, JSON.stringify(params ?? {}));
  }

  function shellAction(action: string): void {
    closePopover();
    endPeek();
    options.shell?.(action)?.();
  }

  function ask(dialog: string, params: Params | null | undefined, anchor: HTMLElement): void {
    closePopover();
    endPeek();
    options.openDialog(dialog, JSON.stringify(params ?? {}), anchor);
  }

  // ── I menu ────────────────────────────────────────────────────────────
  const entryServed = (entry: MenuEntry<K>): boolean =>
    (entry.id === undefined || served(entry.id)) && (entry.requires ?? []).every(served);

  /// Le voci che il catalogo serve, come le vuole il menu della shell. Il
  /// separatore di una voce che non c'è passa alla prossima che c'è.
  function menuItems(entries: readonly MenuEntry<K>[], anchor: HTMLElement, chosen?: (entry: MenuEntry<K>) => void): MenuItem[] {
    const items: MenuItem[] = [];
    let separate = false;
    for (const entry of entries) {
      separate ||= entry.separator === true;
      if (!entryServed(entry)) continue;
      const state = entry.id ? stateOf(entry.id) : undefined;
      const disabled = state !== undefined && !state.enabled;
      items.push({
        label: text(entry.label),
        separator: separate && items.length > 0,
        disabled,
        icon: entry.icon,
        swatches: entry.swatches,
        description: disabled && state?.reason ? state.reason : entry.description,
        choice: entry.choice,
        checked: entry.checked,
        submenu: entry.submenu !== undefined,
        run: () => runEntry(entry, anchor, chosen),
      });
      separate = false;
    }
    return items;
  }

  function runEntry(entry: MenuEntry<K>, anchor: HTMLElement, chosen?: (entry: MenuEntry<K>) => void): void {
    if (entry.submenu) {
      openMenu(anchor, entry.submenu(), chosen);
      return;
    }
    if (entry.write !== undefined) {
      options.write?.(entry.write);
      return;
    }
    if (!entry.id) return;
    chosen?.(entry);
    if (entry.dialog) ask(entry.dialog, entry.params, anchor);
    else give(entry.id, entry.params);
  }

  /// Apre il menu `source` sotto `anchor`. Le voci che arrivano dopo (le
  /// funzioni di una categoria) aprono il menu quando arrivano, se nel
  /// frattempo non se n'è chiesto un altro.
  function openMenu(
    anchor: HTMLElement,
    source: readonly MenuEntry<K>[] | Promise<readonly MenuEntry<K>[]>,
    chosen?: (entry: MenuEntry<K>) => void,
  ): void {
    const ticket = ++menuTicket;
    const show = (entries: readonly MenuEntry<K>[]) => {
      if (life.closed || ticket !== menuTicket || !anchor.isConnected) return;
      closePopover();
      const items = menuItems(entries, anchor, chosen);
      anchor.setAttribute("aria-expanded", "true");
      menuOpen = true;
      showContextMenu(anchor, items.length ? items : [{ label: strings.empty(), disabled: true, run: () => {} }], {
        labelledBy: anchor.id,
        onClose: () => {
          menuOpen = false;
          anchor.setAttribute("aria-expanded", "false");
        },
      });
    };
    if (source instanceof Promise) source.then(show, () => show([]));
    else show(source);
  }

  // ── Il menu del tasto destro ──────────────────────────────────────────
  /// Le voci di `entries` come le vuole il menu dell'editor. Un sottomenu
  /// senza voci servite sparisce; uno che arriva dopo (una promessa) non c'è.
  function surfaceItems(entries: readonly MenuEntry<K>[]): RibbonMenuItem[] {
    const items: RibbonMenuItem[] = [];
    for (const entry of entries) {
      if (entry.submenu) {
        if (!(entry.requires ?? []).every(served)) continue;
        const children = entry.submenu();
        if (children instanceof Promise) continue;
        const inner = surfaceItems(children);
        if (inner.length)
          items.push({
            id: `${options.menuPrefix}${text(entry.label)}`,
            label: text(entry.label),
            icon: entry.icon,
            items: inner,
          });
        continue;
      }
      if (!entry.id || !entryServed(entry)) continue;
      const id = entry.id;
      const state = stateOf(id);
      const off = state !== undefined && !state.enabled;
      items.push({
        id,
        label: text(entry.label),
        icon: entry.icon,
        enabled: !off,
        description: off && state?.reason ? state.reason : entry.description,
        checked: entry.checked,
        run: () => {
          if (entry.dialog) ask(entry.dialog, entry.params, element);
          else give(id, entry.params);
        },
      });
    }
    return items;
  }

  function contextMenu(entries: (view: V) => readonly MenuEntry<K>[]): RibbonMenuItem[] {
    if (life.closed || !options.commandable()) return [];
    states = new Map(options.commands().map((state) => [state.id, state]));
    return surfaceItems(entries(options.view()));
  }

  // ── La mini-barra ─────────────────────────────────────────────────────
  // Si costruisce la prima volta che serve, con i controlli della prima
  // scheda: gli stessi pulsanti, le stesse tendine, lo stesso stato.
  let mini: {
    readonly element: HTMLElement;
    readonly items: readonly Item[];
  } | null = null;

  function buildMini(): {
    readonly element: HTMLElement;
    readonly items: readonly Item[];
  } {
    const element = document.createElement("div");
    element.className = cls("mini");
    element.setAttribute("role", "group");
    const items: Item[] = [];
    const first = options.tabs[0];
    for (const id of first ? options.mini : []) {
      for (const spec of first!.groups) {
        const control = groupControls(spec).find((one) => {
          const kit = one as KitControl<V, K>;
          return (kit.kind === "button" || kit.kind === "select") && kit.id === id;
        });
        if (!control) continue;
        const one = item(control, spec);
        items.push(one);
        element.append(one.wrap);
        break;
      }
    }
    for (const control of element.querySelectorAll<HTMLElement>("button, select")) control.tabIndex = 0;
    // Un gesto dalla mini-barra chiude il menu: le sue voci parlerebbero
    // della selezione com'era.
    life.listen(element, "click", (event) => {
      if ((event.target as Element | null)?.closest("button")) queueMicrotask(closeContextMenu);
    });
    life.listen(element, "change", () => queueMicrotask(closeContextMenu));
    const name = () => element.setAttribute("aria-label", strings.mini());
    name();
    relabels.push(name);
    return { element, items };
  }

  function refreshMini(): void {
    if (!mini) return;
    states = new Map(options.commands().map((state) => [state.id, state]));
    const view = options.view();
    for (const one of mini.items) {
      one.shown = visible(one.control, view);
      one.wrap.hidden = !one.shown;
      if (one.shown) one.update(view);
    }
  }

  function mountMini(host: HTMLElement): () => void {
    if (life.closed || !options.commandable()) return () => {};
    mini ??= buildMini();
    refreshMini();
    host.append(mini.element);
    const element = mini.element;
    return () => element.remove();
  }

  function closePopover(): void {
    popover?.close();
    popover = null;
  }

  // ── I pezzi dei controlli ─────────────────────────────────────────────
  function figure(control: { icon?: string; glyph?: string | (() => string); className?: string }): Element | null {
    if (control.icon) return iconEl(control.icon);
    const said = control.glyph;
    if (!said) return null;
    const glyph = document.createElement("span");
    glyph.className = cls("glyph");
    if (control.className) glyph.classList.add(control.className);
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = typeof said === "function" ? said() : said;
    if (typeof said === "function") relabels.push(() => (glyph.textContent = said()));
    return glyph;
  }

  function chevron(): Element {
    const svg = iconEl(options.chevrons.down);
    const holder = document.createElement("span");
    holder.className = cls("chevron");
    holder.setAttribute("aria-hidden", "true");
    if (svg) holder.append(svg);
    return holder;
  }

  /// Un pulsante della barra: grande (figura sopra il nome) o piccolo.
  function button(control: C, label: () => string, onPress: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.id = identifier(options.prefix);
    el.className = `${cls("button")} ${control.size === "large" ? cls("large") : cls("small")}`;
    el.tabIndex = -1;
    const shape = figure(control);
    if (shape) el.append(shape);
    const caption = document.createElement("span");
    caption.className = cls("label");
    caption.hidden = control.size !== "large" && control.labelled !== true;
    el.append(caption);
    const name = () => {
      caption.textContent = label();
      labelButton(el, label(), chordOf(control) ?? undefined);
    };
    name();
    relabels.push(name);
    // Spento col perché, resta raggiungibile e dice il perché; ma il clic,
    // Invio e Spazio non lo premono.
    const spent = () => el.getAttribute("aria-disabled") === "true";
    life.listen(el, "click", () => {
      if (!spent()) onPress(el);
    });
    const hold = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && spent()) event.preventDefault();
    };
    life.listen(el, "keydown", hold);
    life.listen(el, "keyup", hold);
    return el;
  }

  /// L'accordo del comando del controllo, se chi monta la barra ne dà.
  function chordOf(control: C): ButtonChord | null {
    const id = (control as { readonly id?: unknown }).id;
    return typeof id === "string" ? (options.chord?.(id) ?? null) : null;
  }

  /// Spento con la ragione del catalogo nel suggerimento, o acceso; acceso,
  /// il suggerimento dice anche l'accordo.
  function availability(el: HTMLElement, state: RibbonCommandState | undefined, label: string): void {
    const off = state !== undefined && !state.enabled;
    if (off) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
    const chord = state ? options.chord?.(state.id) : null;
    setTooltip(el, off && state?.reason ? strings.unavailable(label, state.reason) : chord?.display ? `${label} (${chord.display})` : label);
  }

  function wrap(control: C): HTMLElement {
    const el = document.createElement("span");
    el.className = cls("item");
    el.dataset.keytip = control.keytip;
    const id = (control as { readonly id?: unknown }).id;
    if (typeof id === "string") el.dataset.command = id;
    return el;
  }

  /// La freccia di un pulsante diviso, che apre un menu o un riquadro.
  function arrowButton(popup: "menu" | "dialog"): HTMLButtonElement {
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.id = identifier(options.prefix);
    arrow.className = `${cls("button")} ${cls("arrow")}`;
    arrow.tabIndex = -1;
    arrow.setAttribute("aria-haspopup", popup);
    arrow.setAttribute("aria-expanded", "false");
    arrow.append(chevron());
    return arrow;
  }

  // ── I controlli ───────────────────────────────────────────────────────
  function buttonItem(control: ButtonControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    let view: V | null = null;
    const press = button(
      control,
      () => t(control.label),
      () => {
        const now = view ?? options.view();
        const params = typeof control.params === "function" ? control.params(now) : control.params;
        const dialog = typeof control.dialog === "function" ? control.dialog(now) : control.dialog;
        if (control.shell) shellAction(control.shell);
        else if (dialog) ask(dialog, params, press);
        else give(control.id, params);
      },
    );
    el.append(press);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        if (control.pressed) setPressed(press, control.pressed(next));
        availability(press, stateOf(control.id), t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  function splitItem(control: SplitControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    el.classList.add(cls("split"));
    let last: Params | undefined = control.params;
    let view: V | null = null;
    const main = button(
      control,
      () => t(control.label),
      () => give(control.id, last),
    );
    const arrow = arrowButton("menu");
    const name = () => labelButton(arrow, t(control.menuLabel));
    name();
    relabels.push(name);
    const remember = (entry: MenuEntry<K>) => {
      if (!control.remember || entry.id !== control.id) return;
      last = entry.params;
      const shape = entry.icon ? iconEl(entry.icon) : null;
      const old = main.querySelector("svg");
      if (shape && old) old.replaceWith(shape);
    };
    const open = () => openMenu(arrow, control.menu(view ?? options.view()), remember);
    life.listen(arrow, "click", open);
    el.append(main, arrow);
    if (control.size === "large") el.classList.add(cls("split-large"));
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        if (control.pressed) setPressed(main, control.pressed(next));
        availability(main, stateOf(control.id), t(control.label));
      },
      // Un pulsante che ripete l'ultima scelta, dalla tastiera si vuole
      // sceglierla.
      activate: () => (control.remember ? open() : main.click()),
      relabel: () => {},
    };
  }

  function menuItem(control: MenuControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    let view: V | null = null;
    const press = button(
      control,
      () => t(control.label),
      (anchor) => openMenu(anchor, control.items(view ?? options.view())),
    );
    press.setAttribute("aria-haspopup", "menu");
    press.setAttribute("aria-expanded", "false");
    press.append(chevron());
    el.append(press);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        availability(press, undefined, t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  function selectItem(control: SelectControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    el.classList.add(cls("field"));
    const select = document.createElement("select");
    select.className = cls("select");
    select.id = identifier(options.prefix);
    select.tabIndex = -1;
    select.style.width = `${control.width}px`;
    const caption = document.createElement("label");
    caption.className = "sr-only";
    caption.htmlFor = select.id;
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: V | null = null;
    life.listen(select, "change", () => {
      const params = control.params(select.value);
      if (params) give(control.id, params);
    });
    el.append(caption, select);
    const fill = (next: V) => {
      const choices = control.options(next);
      const value = control.value(next);
      const wanted =
        value === null || !choices.some((option) => option.value === value) ? [{ value: "", label: { raw: "" } }, ...choices] : choices;
      const same = select.options.length === wanted.length && wanted.every((option, at) => select.options[at]!.value === option.value);
      if (!same) {
        select.replaceChildren(
          ...wanted.map((option) => {
            const el = document.createElement("option");
            el.value = option.value;
            el.textContent = text(option.label);
            return el;
          }),
        );
      }
      select.value = value !== null && wanted.some((option) => option.value === value) ? value : "";
    };
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        fill(next);
        availability(select, stateOf(control.id), t(control.label));
        select.disabled = stateOf(control.id)?.enabled === false;
      },
      activate: () => select.focus(),
      // Le voci tradotte (i formati dei numeri) si riscrivono.
      relabel: () => {
        if (!view) return;
        select.replaceChildren();
        fill(view);
      },
    };
  }

  function checkItem(control: CheckControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    const label = document.createElement("label");
    label.className = cls("check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.tabIndex = -1;
    box.id = identifier(options.prefix);
    label.htmlFor = box.id;
    const caption = document.createElement("span");
    label.append(box, caption);
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: V | null = null;
    life.listen(box, "change", () => give(control.id, control.params(box.checked, view ?? options.view())));
    // Invio come Spazio: per la tastiera una casella è un comando.
    life.listen(box, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      box.click();
    });
    el.append(label);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        box.checked = control.checked(next);
        const state = stateOf(control.id);
        box.disabled = state?.enabled === false;
        setTooltip(label, state?.enabled === false && state.reason ? strings.unavailable(t(control.label), state.reason) : "");
      },
      activate: () => box.click(),
      relabel: () => {},
    };
  }

  function fieldItem(control: FieldControl<V, K>, group: RibbonGroup<C, K>): Item {
    const el = wrap(control);
    el.classList.add(cls("field"));
    const caption = document.createElement("label");
    caption.className = cls("field-label");
    const input = document.createElement("input");
    input.type = "text";
    input.className = cls("input");
    input.id = identifier(options.prefix);
    input.tabIndex = -1;
    input.style.width = `${control.width}px`;
    caption.htmlFor = input.id;
    const name = () => {
      caption.textContent = t(control.label);
    };
    name();
    relabels.push(name);
    let view: V | null = null;
    let shown = "";
    const commit = () => {
      const value = input.value.trim();
      if (value === "" || value === shown) {
        input.value = shown;
        return;
      }
      shown = value;
      give(control.id, control.params(value, view ?? options.view()));
    };
    life.listen(input, "change", commit);
    life.listen(input, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        options.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        input.value = shown;
        options.focus();
      }
    });
    el.append(caption, input);
    return {
      control,
      group,
      wrap: el,
      shown: true,
      update(next) {
        view = next;
        shown = control.value(next);
        if (document.activeElement !== input) input.value = shown;
        input.disabled = stateOf(control.id)?.enabled === false;
      },
      activate: () => {
        input.focus();
        input.select();
      },
      relabel: () => {},
    };
  }

  const parts: RibbonParts<V, K> = {
    life,
    cls,
    id: () => identifier(options.prefix),
    t,
    wrap: (control) => wrap(control as C),
    button: (control, label, onPress) => button(control as C, label, onPress),
    chevron,
    availability: (el, id, label) => availability(el, stateOf(id), label),
    relabel: (name) => {
      relabels.push(name);
    },
    give,
    view: () => options.view(),
    closePopover,
    showPopover: (anchor, content, label, local, className) => showPopover(anchor, content, label, local, className),
    gridKeys,
  };

  function item(control: C, group: RibbonGroup<C, K>): Item {
    const kit = control as KitControl<V, K>;
    switch (kit.kind) {
      case "button":
        return buttonItem(kit, group);
      case "split":
        return splitItem(kit, group);
      case "menu":
        return menuItem(kit, group);
      case "select":
        return selectItem(kit, group);
      case "check":
        return checkItem(kit, group);
      case "field":
        return fieldItem(kit, group);
      default: {
        if (!options.extra) throw new Error(`controllo senza disegno: ${(control as X).kind}`);
        return options.extra(control as X, group, parts);
      }
    }
  }

  /// Se il catalogo serve il controllo.
  function visible(control: C, view: V): boolean {
    if (control.when && !control.when(view)) return false;
    const kit = control as KitControl<V, K>;
    if (kit.kind === "button" && kit.shell && !options.shell?.(kit.shell)) return false;
    if (kit.kind !== "menu") return served((control as { readonly id: string }).id);
    if (kit.requires) return kit.requires.every(served);
    const items = kit.items(view);
    return !(items instanceof Promise) && items.some(entryServed);
  }

  /// Le frecce fra le caselle di una griglia di `columns` colonne.
  function gridKeys(lifetime: Lifetime, container: HTMLElement, cells: readonly HTMLButtonElement[], columns: number): void {
    lifetime.listen(container, "keydown", (event) => {
      const at = cells.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      const step = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -columns,
        ArrowDown: columns,
      }[event.key];
      const next = event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1 : step === undefined ? null : at + step;
      if (next === null) return;
      event.preventDefault();
      const target = cells[next];
      if (!target) return;
      cells[at]!.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    });
  }

  function showPopover(anchor: HTMLElement, content: HTMLElement, label: string, local: Lifetime, className = cls("popover")): void {
    anchor.setAttribute("aria-expanded", "true");
    const handle = openPopover({
      anchor,
      content,
      label,
      className,
      lifetime: life,
      onClose: () => {
        local.close();
        anchor.setAttribute("aria-expanded", "false");
        if (popover === handle) popover = null;
      },
    });
    popover = handle;
  }

  // ── Gruppi e schede ───────────────────────────────────────────────────
  function mountColumn(column: RibbonColumn<C>, group: RibbonGroup<C, K>, into: HTMLElement, items: Item[]): void {
    if (!("rows" in column)) {
      const one = item(column, group);
      items.push(one);
      into.append(one.wrap);
      return;
    }
    const stack = document.createElement("div");
    stack.className = cls("stack");
    for (const controls of column.rows) {
      const row = document.createElement("div");
      row.className = cls("row");
      for (const control of controls) {
        const one = item(control, group);
        items.push(one);
        row.append(one.wrap);
      }
      stack.append(row);
    }
    into.append(stack);
  }

  function mountGroup(spec: RibbonGroup<C, K>, toolbar: HTMLElement): Group {
    const element = document.createElement("div");
    element.className = cls("group");
    element.setAttribute("role", "group");
    element.dataset.group = spec.id;
    const body = document.createElement("div");
    body.className = cls("group-body");
    const items: Item[] = [];
    for (const column of spec.columns) mountColumn(column, spec, body, items);
    const caption = document.createElement("div");
    caption.className = cls("group-label");
    caption.setAttribute("aria-hidden", "true");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `${cls("button")} ${cls("large")} ${cls("group-toggle")}`;
    toggle.tabIndex = -1;
    toggle.hidden = true;
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-expanded", "false");
    const shape = iconEl(spec.icon);
    if (shape) toggle.append(shape);
    const toggleLabel = document.createElement("span");
    toggleLabel.className = cls("label");
    toggle.append(toggleLabel, chevron());
    element.append(body, caption, toggle);
    toolbar.append(element);
    const group: Group = {
      spec,
      element,
      body,
      toggle,
      items,
      collapsed: false,
      relabel: () => {
        element.setAttribute("aria-label", t(spec.label));
        caption.textContent = t(spec.label);
        toggleLabel.textContent = t(spec.label);
        labelButton(toggle, t(spec.label));
      },
    };
    group.relabel();
    relabels.push(group.relabel);
    life.listen(toggle, "click", () => openGroup(group));
    return group;
  }

  /// Il contenuto di un gruppo raccolto, in un riquadro sotto il suo pulsante.
  function openGroup(group: Group): void {
    closePopover();
    closeContextMenu();
    const local = openLifetime();
    const box = document.createElement("div");
    box.className = cls("popup-group");
    box.setAttribute("role", "toolbar");
    box.append(group.body);
    local.add(() => {
      group.element.prepend(group.body);
    });
    roving(local, box);
    showPopover(group.toggle, box, t(group.spec.label), local);
  }

  function collapseGroup(group: Group, on: boolean): void {
    group.collapsed = on;
    group.element.dataset.collapsed = String(on);
    group.toggle.hidden = !on;
  }

  const tabs: Tab[] = options.tabs.map((spec) => {
    const panel = document.createElement("div");
    panel.className = cls("panel");
    panel.dataset.tab = spec.id;
    panel.hidden = true;
    const toolbar = document.createElement("div");
    toolbar.className = cls("toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-orientation", "horizontal");
    panel.append(toolbar);
    panels.append(panel);
    const groups = spec.groups.map((group) => mountGroup(group, toolbar));
    relabels.push(() => toolbar.setAttribute("aria-label", t(spec.label)));
    const settle = roving(life, toolbar);
    return { spec, panel, toolbar, groups, settle };
  });

  // ── I pulsanti accanto alle schede ────────────────────────────────────
  const quickGroup: RibbonGroup<C, K> = { id: "quick", label: (options.quick?.[0]?.label ?? "") as K, icon: "", keytip: "", columns: options.quick ?? [] };
  const quickItems: Item[] = (options.quick ?? []).map((control) => {
    const one = buttonItem(control, quickGroup);
    quickBar.append(one.wrap);
    return one;
  });
  const settleQuick = roving(life, quickBar);
  relabels.push(() => {
    const name = strings.quick?.();
    if (name) quickBar.setAttribute("aria-label", name);
  });

  // ── La barra degli strumenti di una scheda ────────────────────────────
  /// Nascosto da qualcosa dentro `container`: il pannello di una scheda non
  /// scelta è nascosto, ma i suoi controlli restano in ordine.
  function hiddenWithin(control: HTMLElement, container: HTMLElement): boolean {
    for (let at: HTMLElement | null = control; at && at !== container; at = at.parentElement) if (at.hidden) return true;
    return false;
  }

  function focusables(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("button, select, input")].filter(
      (control) =>
        !(control as HTMLButtonElement).disabled &&
        !hiddenWithin(control, container) &&
        control.closest(`[data-collapsed="true"] > .${cls("group-body")}`) === null,
    );
  }

  /// Il controllo che sta nel Tab, e le frecce fra gli altri. Restituisce
  /// chi rimette il Tab a posto quando i controlli cambiano.
  function roving(lifetime: Lifetime, container: HTMLElement): (target: HTMLElement | null) => void {
    let current: HTMLElement | null = null;
    const settle = (target: HTMLElement | null) => {
      const all = focusables(container);
      const wanted = target ?? current;
      current = wanted && all.includes(wanted) ? wanted : (all[0] ?? null);
      for (const control of container.querySelectorAll<HTMLElement>("button, select, input")) {
        control.tabIndex = control === current ? 0 : -1;
      }
    };
    lifetime.listen(container, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) event.preventDefault();
    });
    lifetime.listen(container, "focusin", (event) => {
      if (event.target instanceof HTMLElement) settle(event.target);
    });
    lifetime.listen(container, "keydown", (event) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape") {
        if (container.classList.contains(cls("popup-group"))) return;
        event.preventDefault();
        options.focus();
        return;
      }
      if (target instanceof HTMLInputElement && target.type === "text") return;
      if (event.key === "ArrowDown" && target.getAttribute("aria-haspopup")) {
        event.preventDefault();
        target.click();
        return;
      }
      const all = focusables(container);
      const at = all.indexOf(target);
      if (at < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = (at + 1) % all.length;
      else if (event.key === "ArrowLeft") next = (at - 1 + all.length) % all.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = all.length - 1;
      if (next === null) return;
      event.preventDefault();
      settle(all[next]!);
      all[next]!.focus();
    });
    settle(null);
    return settle;
  }

  // ── Le schede visibili ────────────────────────────────────────────────
  let tabsLife: Lifetime | null = null;
  let tabsHandle: TabsHandle | null = null;
  let shownTabs = "";
  let selected = options.tabs[0]?.id ?? "";

  function mountTabs(visible: readonly Tab[], force: boolean): void {
    const signature = visible.map((tab) => tab.spec.id).join(" ");
    if (signature === shownTabs && !force) return;
    shownTabs = signature;
    tabsLife?.close();
    const local = openLifetime();
    tabsLife = local;
    for (const tab of tabs) tab.panel.hidden = true;
    if (!visible.some((tab) => tab.spec.id === selected)) selected = visible[0]?.spec.id ?? options.tabs[0]?.id ?? "";
    tabsHandle = createTabs({
      tablist,
      tabs: visible.map((tab) => ({
        id: tab.spec.id,
        label: t(tab.spec.label),
        panel: tab.panel,
      })),
      selected,
      label: strings.label(),
      lifetime: local,
      onSelect: (id) => {
        selected = id;
        scheduleFit();
      },
    });
    for (const tab of visible) {
      const button = tabsHandle.tab(tab.spec.id);
      if (!button) continue;
      button.dataset.keytip = tab.spec.keytip;
      if (tab.spec.contextual) button.classList.add(cls("contextual"));
    }
    // Una scheda scelta mentre la barra è ritirata si apre finché non si
    // torna all'editor; due click la ritirano o la riaprono, come in Office.
    local.listen(tablist, "click", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab") && collapsed) peek(true);
    });
    local.listen(tablist, "dblclick", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab")) setCollapsed(!collapsed);
    });
    local.listen(tablist, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest(".kit-tab")) event.preventDefault();
    });
  }

  function chooseTab(id: string): void {
    if (!tabsHandle) return;
    tabsHandle.select(id);
    selected = tabsHandle.selected() ?? selected;
    scheduleFit();
  }

  /// La barra ritirata mostra una scheda per un gesto: un comando, un clic o
  /// il fuoco fuori dalla barra la ritirano di nuovo.
  let peeking = false;
  function peek(on: boolean): void {
    peeking = on && collapsed;
    if (peeking) element.dataset.peek = "true";
    else delete element.dataset.peek;
    panels.hidden = collapsed && !peeking;
    if (peeking) scheduleFit();
  }
  function endPeek(): void {
    if (peeking) peek(false);
  }
  life.listen(root, "pointerdown", (event) => {
    if (peeking && !element.contains(event.target as Node | null)) endPeek();
  });
  life.listen(root, "focusin", (event) => {
    if (peeking && !element.contains(event.target as Node | null)) endPeek();
  });

  function setCollapsed(on: boolean): void {
    collapsed = on;
    peeking = false;
    delete element.dataset.peek;
    element.dataset.collapsed = String(on);
    panels.hidden = on;
    toggle.setAttribute("aria-expanded", String(!on));
    labelButton(toggle, on ? strings.expand() : strings.collapse());
    toggle.replaceChildren(iconEl(on ? options.chevrons.down : options.chevrons.up) ?? "");
    if (on) closePopover();
    else scheduleFit();
  }
  life.listen(toggle, "click", () => setCollapsed(!collapsed));
  life.listen(toggle, "mousedown", (event) => event.preventDefault());

  // ── Quando la barra è stretta ─────────────────────────────────────────
  let fitFrame: number | null = null;
  function scheduleFit(): void {
    if (fitFrame !== null || life.closed) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      fit();
    });
  }
  life.add(() => {
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    fitFrame = null;
  });

  /// Raccoglie i gruppi da destra finché la scheda non sta nella barra:
  /// prima i pulsanti piccoli perdono il nome, poi i gruppi si chiudono.
  function fit(): void {
    const tab = tabs.find((each) => each.spec.id === selected);
    if (!tab || collapsed || element.hidden) return;
    if (popover && tab.groups.some((group) => group.toggle.getAttribute("aria-expanded") === "true")) return;
    const toolbar = tab.toolbar;
    const overflows = () => toolbar.scrollWidth > toolbar.clientWidth + 1;
    tab.panel.dataset.compact = "false";
    for (const group of tab.groups) collapseGroup(group, false);
    if (!overflows()) return;
    tab.panel.dataset.compact = "true";
    // Nell'ordine della scheda, se lo dichiara; altrimenti da destra.
    const open = tab.groups.filter((group) => !group.element.hidden);
    const order = tab.spec.fold
      ? tab.spec.fold.flatMap((id) => open.filter((group) => group.spec.id === id))
      : [...open].reverse();
    for (const group of order) {
      if (!overflows()) break;
      collapseGroup(group, true);
    }
    // Dentro i gruppi raccolti il fuoco non ha più dove stare.
    const focus = document.activeElement as HTMLElement | null;
    if (focus && toolbar.contains(focus) && !focusables(toolbar).includes(focus)) options.focus();
    tab.settle(null);
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(element);
    life.add(() => observer.disconnect());
  }

  // ── Le lettere ────────────────────────────────────────────────────────
  interface Tip {
    readonly keytip: string;
    readonly anchor: HTMLElement;
    readonly run: () => void;
  }
  let tipsLife: Lifetime | null = null;
  let armed = false;

  function editing(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(EDITABLE) !== null && !host.contains(target);
  }

  function tabTips(): Tip[] {
    const quickTips = quickItems
      .filter((one) => one.shown)
      .map((one) => ({ keytip: one.control.keytip, anchor: one.wrap, run: () => one.activate() }));
    return quickTips.concat(tabs
      .filter((tab) => shownTabs.split(" ").includes(tab.spec.id))
      .map((tab) => ({
        keytip: tab.spec.keytip,
        anchor: tabsHandle?.tab(tab.spec.id) ?? tab.panel,
        run: () => {
          if (collapsed) peek(true);
          chooseTab(tab.spec.id);
          // La scheda si è appena mostrata: i gruppi si raccolgono prima che
          // si contino le lettere.
          fit();
          showTips(controlTips(tab), () => showTips(tabTips(), null));
        },
      })));
  }

  function controlTips(tab: Tab): Tip[] {
    const tips: Tip[] = [];
    for (const group of tab.groups) {
      if (group.element.hidden) continue;
      if (group.collapsed) {
        tips.push({
          keytip: group.spec.keytip,
          anchor: group.toggle,
          run: () => openGroup(group),
        });
        continue;
      }
      for (const one of group.items) {
        if (one.shown)
          tips.push({
            keytip: one.control.keytip,
            anchor: one.wrap,
            run: () => one.activate(),
          });
      }
    }
    return tips;
  }

  function hideTips(): void {
    tipsLife?.close();
    tipsLife = null;
  }

  /// Mostra le lettere `tips`; Esc torna a `back`, o chiude.
  function showTips(tips: readonly Tip[], back: (() => void) | null): void {
    hideTips();
    if (tips.length === 0) return;
    const local = openLifetime();
    tipsLife = local;
    element.dataset.keytips = "true";
    local.add(() => delete element.dataset.keytips);
    let typed = "";
    const badges = tips.map((tip) => {
      const badge = document.createElement("span");
      badge.className = cls("keytip");
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = tip.keytip;
      tip.anchor.append(badge);
      local.add(() => badge.remove());
      return badge;
    });
    const narrow = () => {
      tips.forEach((tip, at) => {
        badges[at]!.hidden = !tip.keytip.startsWith(typed);
      });
    };
    local.listen(
      document,
      "keydown",
      (event) => {
        if (event.key === "Shift" || event.key === "Control" || event.key === "Meta") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          if (typed !== "") {
            typed = "";
            narrow();
          } else if (back) {
            back();
          } else {
            hideTips();
          }
          return;
        }
        if (event.key === "Alt" || event.key === "F10" || event.key === "Tab") {
          hideTips();
          return;
        }
        if (event.key === "Backspace") {
          typed = typed.slice(0, -1);
          narrow();
          return;
        }
        if (event.key.length !== 1) return;
        typed += event.key.toUpperCase();
        const exact = tips.find((tip) => tip.keytip === typed);
        if (exact) {
          hideTips();
          exact.run();
          return;
        }
        if (!tips.some((tip) => tip.keytip.startsWith(typed))) {
          hideTips();
          return;
        }
        narrow();
      },
      { capture: true },
    );
    local.listen(document, "mousedown", hideTips, { capture: true });
    local.listen(window, "blur", hideTips);
  }

  life.add(hideTips);
  life.listen(root, "keydown", (event) => {
    if (tipsLife || element.hidden) return;
    // Ctrl+F1 ritira la barra e la riapre, come in Office.
    if (event.key === "F1" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      setCollapsed(!collapsed);
      return;
    }
    if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (editing(event.target)) return;
      event.preventDefault();
      showTips(tabTips(), null);
      return;
    }
    armed = event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !editing(event.target);
  });
  life.listen(root, "keyup", (event) => {
    if (event.key !== "Alt" || !armed) return;
    armed = false;
    if (tipsLife || element.hidden) return;
    event.preventDefault();
    showTips(tabTips(), null);
  });
  life.listen(root, "mousedown", () => {
    armed = false;
  });

  // ── L'aggiornamento ───────────────────────────────────────────────────
  function refresh(): void {
    if (life.closed) return;
    states = new Map(options.commands().map((state) => [state.id, state]));
    const on = options.commandable();
    element.hidden = !on;
    if (!on) {
      closePopover();
      if (menuOpen) closeContextMenu();
      hideTips();
      return;
    }
    const view = options.view();
    const shown: Tab[] = [];
    for (const tab of tabs) {
      let any = false;
      for (const group of tab.groups) {
        let groupAny = false;
        for (const one of group.items) {
          one.shown = visible(one.control, view);
          one.wrap.hidden = !one.shown;
          if (one.shown) {
            one.update(view);
            groupAny = true;
          }
        }
        group.element.hidden = !groupAny;
        any ||= groupAny;
      }
      if (any && (tab.spec.contextual === undefined || options.contextShown(tab.spec.contextual, view))) shown.push(tab);
    }
    mountTabs(shown, false);
    for (const one of quickItems) {
      one.shown = visible(one.control, view);
      one.wrap.hidden = !one.shown;
      if (one.shown) one.update(view);
    }
    settleQuick(null);
    for (const tab of tabs) tab.settle(null);
    if (mini?.element.isConnected) refreshMini();
    scheduleFit();
  }

  let frame: number | null = null;
  function schedule(): void {
    if (frame !== null || life.closed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  }
  life.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });

  function relabel(): void {
    for (const name of relabels) name();
    for (const tab of tabs) for (const group of tab.groups) for (const one of group.items) one.relabel();
    labelButton(toggle, collapsed ? strings.expand() : strings.collapse());
  }

  relabel();
  setCollapsed(false);
  life.add(
    options.languages(() => {
      relabel();
      refresh();
      mountTabs(
        tabs.filter((tab) => shownTabs.split(" ").includes(tab.spec.id)),
        true,
      );
    }),
  );
  refresh();

  return {
    element,
    refresh,
    schedule,
    contextMenu,
    mountMini,
    destroy() {
      closePopover();
      if (menuOpen) closeContextMenu();
      mini?.element.remove();
      mini = null;
      tabsLife?.close();
      tabsLife = null;
      life.close();
      element.remove();
    },
  };
}
