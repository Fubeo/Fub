// Il menu del diagramma (E26): il tasto destro su un diagramma Mermaid, largo
// quanto il menu del posto (316 px). Dall'alto: la testata, le cinque
// miniature dello stile, «Vale per», «Orientamento» (solo nei flussi), e le
// quattro azioni.
//
// Qui c'è soltanto il disegno e la tastiera: che cosa offrire lo decide il
// modello che `ui/mermaid.ts` compone (`diagramMenuModel`), e ogni gesto torna
// a lui come una chiamata di `DiagramMenuHandlers`. La superficie è un
// popover del kit vestito come il menu del posto (`context-menu
// menu-at-point`): le righe sono quelle del kit, la testata e l'elenco quelli
// del menu, e i pezzi suoi (miniature, scelte a due) stanno in
// `skin/diagrams.css`.
//
// La tastiera: il Tab passa dalle miniature a «Vale per», a «Orientamento» e
// alle azioni; dentro le miniature e le scelte a due vanno le frecce ← →,
// dentro le azioni ↑ ↓. Arrivare su una miniatura la mostra sul diagramma,
// come passarci sopra col puntatore; Invio o Spazio la sceglie.
import { openPopover, type PopoverHandle } from "../kit/popover";
import { createRow, markLit } from "../kit/row";
import { rovingToolbar } from "../kit/toolbar-keys";
import type { DiagramStyleId } from "../theme/diagram-style";
import { icon, iconEl, registerIcon } from "./icons";
import { openLifetime, type Lifetime } from "./lifetime";
import { menuKeys, type MenuPoint } from "./menu";

/// I colori di una miniatura: la carta, il nodo, la scelta, la pillola, il
/// collegamento.
export interface DiagramSwatchColors {
  readonly paper: string;
  readonly node: string;
  readonly nodeBorder: string;
  readonly choice: string;
  readonly choiceBorder: string;
  readonly pill: string;
  readonly pillBorder: string;
  readonly line: string;
}

export interface DiagramMenuStyle {
  readonly id: DiagramStyleId;
  readonly label: string;
  readonly colors: DiagramSwatchColors;
  /// Lo stile che il diagramma mostra.
  readonly checked: boolean;
}

export type DiagramScope = "this" | "all";
export type DiagramDirection = "TD" | "LR";
export type DiagramActionId = "source" | "enlarge" | "copy" | "export";

export interface DiagramMenuAction {
  readonly id: DiagramActionId;
  readonly label: string;
  readonly icon: string;
  /// La scorciatoia, nella forma di `displayBinding`.
  readonly hint?: string;
  /// A destra, in grigio, dove non c'è una scorciatoia.
  readonly note?: string;
  readonly disabled: boolean;
}

/// Che cosa il menu offre, già nella lingua dell'interfaccia.
export interface DiagramMenuModel {
  /// La testata: «Diagramma» e il titolo del frontmatter, se c'è.
  readonly kind: string;
  readonly title: string | null;
  readonly styleLabel: string;
  readonly styles: readonly DiagramMenuStyle[];
  /// Una riga sotto le miniature: uno stile scritto che non esiste, o uno che
  /// il sorgente chiede e che qui non si può riscrivere.
  readonly notice: string | null;
  readonly scopeLabel: string;
  readonly scopes: readonly { readonly id: DiagramScope; readonly label: string; readonly disabled: boolean }[];
  readonly scope: DiagramScope;
  /// `null` fuori dai diagrammi di flusso: la riga non c'è.
  readonly orientation: {
    readonly label: string;
    readonly options: readonly { readonly id: DiagramDirection; readonly label: string; readonly icon: string }[];
    /// La direzione scritta, se è una delle due.
    readonly current: DiagramDirection | null;
    readonly disabled: boolean;
  } | null;
  readonly actions: readonly DiagramMenuAction[];
}

export interface DiagramMenuHandlers {
  /// Mostra lo stile sul diagramma, senza sceglierlo; `null` rimette il suo.
  preview(style: DiagramStyleId | null): void;
  choose(style: DiagramStyleId, scope: DiagramScope): void;
  orient(direction: DiagramDirection): void;
  act(action: DiagramActionId, at: MenuPoint): void;
}

export interface DiagramMenuOptions {
  /// Aperto dal puntatore: il fuoco resta sulla superficie, senza anello su
  /// una voce. Dalla tastiera va alla miniatura scelta.
  readonly pointer: boolean;
  readonly onClose?: () => void;
}

/// Le figure del menu, nella griglia di 24 delle icone (dal prototipo).
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "diagram-mark": ["M4 4h6v5H4z", "M14 15h6v5h-6z", "M7 9v4h10v2"],
  "diagram-enlarge": ["M14.25 3.75h6v6M20.25 3.75 13.5 10.5M9.75 20.25h-6v-6M3.75 20.25l6.75-6.75"],
  "diagram-export": ["M13.5 4.5h6v6M19.5 4.5 12 12", "M17.25 14.25v4.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h4.5"],
  "diagram-down": ["M6.75 9.3 12 14.7l5.25-5.4"],
  "diagram-right": ["M9.3 6.75 14.7 12l-5.4 5.25"],
};

/// Registra le figure che il repertorio non ha ancora. Restano: come le
/// figure dei commenti, sono poche e di nessun altro.
export function registerDiagramIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

const SVG = "http://www.w3.org/2000/svg";

/// La miniatura di uno stile: un nodo, un collegamento, una scelta e una
/// pillola, coi colori dello stile (le proprietà `--diagram-swatch-*`).
function swatchFigure(colors: DiagramSwatchColors): HTMLSpanElement {
  const frame = document.createElement("span");
  frame.className = "diagram-menu-swatch";
  frame.setAttribute("aria-hidden", "true");
  for (const [name, value] of Object.entries({
    paper: colors.paper,
    node: colors.node,
    "node-border": colors.nodeBorder,
    choice: colors.choice,
    "choice-border": colors.choiceBorder,
    pill: colors.pill,
    "pill-border": colors.pillBorder,
    line: colors.line,
  })) frame.style.setProperty(`--diagram-swatch-${name}`, value);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 50 34");
  svg.setAttribute("focusable", "false");
  const shape = (tag: string, cls: string, attrs: Record<string, string>): void => {
    const node = document.createElementNS(SVG, tag);
    node.setAttribute("class", cls);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  };
  shape("path", "diagram-menu-swatch-line", { d: "M16 13v5M25 24h7" });
  shape("rect", "diagram-menu-swatch-node", { x: "6", y: "4.5", width: "20", height: "8.5", rx: "2.5" });
  shape("path", "diagram-menu-swatch-choice", { d: "M16 18l9 6-9 6-9-6z" });
  shape("rect", "diagram-menu-swatch-pill", { x: "32", y: "19.5", width: "13", height: "9", rx: "4.5" });
  frame.append(svg);
  return frame;
}

/// Una scelta a due («Questo» e «Tutti»): pulsanti premuti o no, fra cui si
/// passa con le frecce.
function segments<T extends string>(
  options: readonly { readonly id: T; readonly label: string; readonly icon?: string; readonly disabled?: boolean }[],
  pressed: T | null,
  name: string,
  life: Lifetime,
  onPress: (id: T, button: HTMLButtonElement) => void,
): { element: HTMLElement; buttons: HTMLButtonElement[] } {
  const set = document.createElement("span");
  set.className = "diagram-menu-segments";
  set.setAttribute("role", "group");
  set.setAttribute("aria-label", name);
  const buttons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "diagram-menu-segment";
    button.dataset.value = option.id;
    button.setAttribute("aria-pressed", String(option.id === pressed));
    if (option.disabled) button.disabled = true;
    if (option.icon) {
      const glyph = iconEl(option.icon);
      if (glyph) {
        glyph.setAttribute("aria-hidden", "true");
        button.append(glyph);
      }
    }
    button.append(option.label);
    life.listen(button, "click", () => onPress(option.id, button));
    set.append(button);
    return button;
  });
  rovingToolbar(set, { controls: () => buttons }, life).refresh(buttons.find((b) => b.getAttribute("aria-pressed") === "true") ?? null);
  return { element: set, buttons };
}

/// Una riga del menu: il nome a sinistra, la scelta a due a destra.
function choiceRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "diagram-menu-row";
  const name = document.createElement("span");
  name.className = "diagram-menu-row-name";
  name.setAttribute("aria-hidden", "true");
  name.textContent = label;
  row.append(name, control);
  return row;
}

/// Apre il menu nel punto `at`. Torna la sua maniglia: chiuderla rimette lo
/// stile del diagramma se nessuno ne è stato scelto.
export function openDiagramMenu(
  at: MenuPoint,
  model: DiagramMenuModel,
  handlers: DiagramMenuHandlers,
  options: DiagramMenuOptions,
): PopoverHandle {
  registerDiagramIcons();
  const life = openLifetime();
  let chosen = false;
  let previewing = false;
  let scope = model.scope;
  const content = document.createDocumentFragment();

  // La testata: come quella del menu del posto, non si sceglie.
  const head = document.createElement("div");
  head.className = "menu-head";
  head.setAttribute("aria-hidden", "true");
  const mark = iconEl("diagram-mark");
  if (mark) head.append(mark);
  const kind = document.createElement("span");
  kind.className = "menu-head-kind";
  kind.textContent = model.kind;
  head.append(kind);
  if (model.title) {
    const name = document.createElement("span");
    name.className = "menu-head-name";
    name.textContent = model.title;
    head.append(name);
  }
  content.append(head);

  // Lo stile: cinque miniature, una scelta fra cinque.
  const styleHead = document.createElement("div");
  styleHead.className = "diagram-menu-label";
  styleHead.textContent = model.styleLabel;
  styleHead.setAttribute("aria-hidden", "true");
  const grid = document.createElement("div");
  grid.className = "diagram-menu-styles";
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", model.styleLabel);
  const preview = (style: DiagramStyleId | null): void => {
    if (chosen) return;
    previewing = style !== null;
    handlers.preview(style);
  };
  const radios = model.styles.map((style) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "diagram-menu-style";
    button.dataset.diagramStyle = style.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(style.checked));
    const label = document.createElement("span");
    label.className = "diagram-menu-style-name";
    label.textContent = style.label;
    button.append(swatchFigure(style.colors), label);
    life.listen(button, "pointerenter", () => preview(style.id));
    life.listen(button, "focus", () => preview(style.id));
    life.listen(button, "click", () => {
      chosen = true;
      handlers.choose(style.id, scope);
      popover.close("manual");
    });
    grid.append(button);
    return button;
  });
  rovingToolbar(grid, { controls: () => radios }, life).refresh(radios.find((b) => b.getAttribute("aria-checked") === "true") ?? null);
  // Uscire dalle miniature, col puntatore o col fuoco, rimette lo stile.
  life.listen(grid, "pointerleave", () => {
    if (!grid.contains(document.activeElement)) preview(null);
  });
  life.listen(grid, "focusout", (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Node && grid.contains(event.relatedTarget))) preview(null);
  });
  content.append(styleHead, grid);

  if (model.notice) {
    const notice = document.createElement("p");
    notice.className = "diagram-menu-notice";
    notice.textContent = model.notice;
    content.append(notice);
  }

  // Vale per: questo diagramma, o tutti quelli senza uno stile loro.
  const scopes = segments(model.scopes, model.scope, model.scopeLabel, life, (id, button) => {
    scope = id;
    for (const each of scopes.buttons) each.setAttribute("aria-pressed", String(each === button));
  });
  content.append(choiceRow(model.scopeLabel, scopes.element));

  // L'orientamento, nei flussi: riscrive la prima riga. Il sorgente cambia, e
  // un altro gesto del menu leggerebbe quello di prima: il menu si chiude.
  if (model.orientation) {
    const orientation = segments(
      model.orientation.options.map((option) => ({ ...option, disabled: model.orientation!.disabled })),
      model.orientation.current,
      model.orientation.label,
      life,
      (id) => {
        if (id === model.orientation!.current) return;
        handlers.orient(id);
        popover.close("manual");
      },
    );
    content.append(choiceRow(model.orientation.label, orientation.element));
  }

  const rule = document.createElement("div");
  rule.className = "menu-separator";
  rule.setAttribute("role", "separator");
  content.append(rule);

  // Le azioni: righe del kit, fra cui si va con ↑ ↓.
  const list = document.createElement("div");
  list.className = "menu-items diagram-menu-actions";
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", model.kind);
  const rows = model.actions.map((action) => {
    const drawn = createRow({
      label: action.label,
      icon: action.icon,
      holdIcon: true,
      ...(action.note && !action.hint ? { note: action.note } : {}),
      ...(action.hint ? { keys: menuKeys(action.hint) } : {}),
      disabled: action.disabled,
      role: "menuitem",
      parts: { icon: "menu-icon", label: "menu-label", note: "menu-description", keys: "menu-hint" },
    });
    const button = drawn.element as HTMLButtonElement;
    button.dataset.action = action.id;
    button.tabIndex = -1;
    if (action.hint) button.setAttribute("aria-keyshortcuts", action.hint);
    life.listen(button, "pointerenter", () => markLit(button, true));
    life.listen(button, "pointerleave", () => markLit(button, false));
    life.listen(button, "focus", () => markLit(button, true));
    life.listen(button, "blur", () => markLit(button, false));
    life.listen(button, "click", () => {
      if (action.disabled) return;
      chosen = true;
      popover.close("manual");
      handlers.act(action.id, at);
    });
    list.append(button);
    return button;
  });
  const usable = (): HTMLButtonElement[] => rows.filter((row) => row.getAttribute("aria-disabled") !== "true");
  const first = usable()[0];
  if (first) first.tabIndex = 0;
  life.listen(list, "keydown", (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const live = usable();
    const index = live.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key as "ArrowDown" | "ArrowUp"];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + live.length) % live.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = live.length - 1;
    if (next === null) return;
    event.preventDefault();
    for (const row of rows) row.tabIndex = -1;
    live[next]!.tabIndex = 0;
    live[next]!.focus();
  });
  content.append(list);

  const popover = openPopover({
    anchor: { getBoundingClientRect: () => ({ left: at.x, top: at.y, width: 0, height: 0 }) },
    content,
    label: model.title ? `${model.kind} · ${model.title}` : model.kind,
    className: "context-menu menu-at-point diagram-menu",
    gap: 0,
    autoFocus: false,
    lifetime: life,
    onClose: () => {
      // Un'anteprima rimasta, se nessuno stile è stato scelto, torna indietro.
      if (!chosen && previewing) handlers.preview(null);
      life.close();
      options.onClose?.();
    },
  });
  const checked = radios.find((b) => b.getAttribute("aria-checked") === "true") ?? radios[0];
  if (options.pointer || !checked) popover.element.focus({ preventScroll: true });
  else checked.focus({ preventScroll: true });
  return popover;
}
