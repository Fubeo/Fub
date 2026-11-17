// La mini-barra: i gesti di formato sul testo scelto (E8), come la Mini
// Toolbar di Word e la barra scura del prototipo dell'editor (`.minibar`).
//
// In quest'ordine: Trasforma (lo stesso «Trasforma in» dello stile del blocco
// della barra, `transformItems`), B, I, U, S, codice, Collega, Colore (i nove
// colori del testo e del fondo), Commenta. Ogni pulsante esegue l'azione
// dell'editor che esegue la sua scorciatoia, con la stessa voce
// d'annullamento, e la scorciatoia che la superficie dice è scritta nel suo
// suggerimento: nessun comando nuovo, nessuna copia dei gesti.
//
// Ha due inneschi e una sola regola, l'impostazione `editor.minibar`: sopra il
// menu del tasto destro (lo slot `strip` di `ui/menu.ts`: un menu che le
// finirebbe sopra la prende in testa, E29) e sul testo scelto (la bolla,
// `selection-bubble.ts`). Una superficie con una mini-barra sua (`miniBar()`,
// un documento di Word, un foglio) usa quella.
//
// La shell scrive la scelta su `#app` (`data-minibar`), come fa con la barra
// spenta (`data-formatbar-off`): qui la si legge senza chiedere all'host.
//
// Lo stato dei pulsanti (premuto, spento) si rilegge con `refresh`, quando chi
// la mostra lo chiede: la bolla lo fa al fotogramma in cui la posa, mai a ogni
// evento della superficie mentre nessuno la vede.
import type { CommandSpec } from "../host/contract";
import type { SurfaceMiniBar } from "../editors/core/editor-menu";
import type { SurfaceEditorActions } from "../editors/core/editor-actions";
import { t, type Key } from "../i18n/strings";
import { rovingToolbar } from "../kit/toolbar-keys";
import { openPopover, type PopoverHandle } from "../kit/popover";
import { ariaBinding, displayBinding } from "../ui/commands";
import { icon, iconEl, registerIcon } from "../ui/icons";
import { openLifetime } from "../ui/lifetime";
import { closeContextMenu, showContextMenu, type ContextMenuOptions, type MenuItem } from "../ui/menu";
import { attachTooltip } from "../ui/tooltip";
import { identifier } from "../ui/a11y";
import { canTransform, transformItems, transformOffered, type FormatBarHost } from "./format-bar";

export type MiniBarMode = "auto" | "always" | "menu" | "off";

/// L'impostazione che la sceglie.
export const MINIBAR_SETTING = "editor.minibar";

/// L'azione di «Commenta» (T22): il primo messaggio della discussione sulla
/// selezione, con Ctrl/⌘ Alt M.
export const COMMENT_ACTION = "markdown.comment.add";
/// L'azione di «Collega»: il gesto di Mod-k (il riquadro «Collegamento» in
/// Live e in Blocchi, il wikilink in Sorgente).
export const LINK_ACTION = "markdown.link.edit";

/// I nove colori dei Blocchi, nell'ordine del prototipo: «Predefinito» non è
/// un campione, si toglie un colore scegliendolo di nuovo.
export const MINIBAR_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type MiniBarColor = (typeof MINIBAR_COLORS)[number];

/// Le due righe del colore: l'azione che le dà il nome.
const COLOR_ROWS = [
  { prefix: "markdown.color", label: "mini_bar.color.text", data: "color" },
  { prefix: "markdown.background", label: "mini_bar.color.fill", data: "fill" },
] as const;

/// Un pulsante che esegue un'azione dell'editor, e com'è disegnato: una
/// lettera (B, I, U, S come nel prototipo) o una figura.
interface ActionButton {
  readonly action: string;
  readonly label: Key;
  readonly glyph?: { readonly text: string; readonly kind: "bold" | "italic" | "underline" | "strike" };
  readonly icon?: string;
  /// Il nome scritto accanto alla figura («Commenta»).
  readonly named?: boolean;
}

/// I gruppi della barra, divisi da un filo: un gruppo che la superficie non
/// sa fare non c'è, e il suo filo con lui.
type Slot = ActionButton | "transform" | "color";
const GROUPS: readonly (readonly Slot[])[] = [
  ["transform"],
  [
    { action: "markdown.bold", label: "mini_bar.bold", glyph: { text: "B", kind: "bold" } },
    { action: "markdown.italic", label: "mini_bar.italic", glyph: { text: "I", kind: "italic" } },
    { action: "markdown.underline", label: "mini_bar.underline", glyph: { text: "U", kind: "underline" } },
    { action: "markdown.strikethrough", label: "mini_bar.strike", glyph: { text: "S", kind: "strike" } },
    { action: "markdown.code", label: "mini_bar.code", icon: "fmt-code" },
  ],
  [{ action: LINK_ACTION, label: "mini_bar.link", icon: "fmt-link" }, "color"],
  [{ action: COMMENT_ACTION, label: "mini_bar.comment", icon: "comment", named: true }],
];

/// Le figure che la barra di formato non ha: il fumetto di «Commenta», lo
/// stesso dei commenti (`comments/thread.ts`), sulla griglia di 24.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  comment: ["M3.75 5.25h16.5v11.25H10.5L6 20.25V16.5H3.75z"],
};

/// Quanto dopo una chiusura «fuori» il clic sul grilletto è lo stesso gesto.
const TOGGLE_GRACE_MS = 400;

function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// Un valore dell'impostazione, o `auto` per ciò che non si conosce.
export function miniBarModeOf(value: unknown): MiniBarMode {
  return value === "always" || value === "menu" || value === "off" ? value : "auto";
}

/// La scelta corrente, come la shell l'ha scritta su `#app`.
export function miniBarMode(): MiniBarMode {
  return miniBarModeOf(document.getElementById("app")?.dataset["minibar"]);
}

/// La bolla sul testo scelto: con `auto` soltanto a barra del foglio spenta.
export function bubbleWanted(mode: MiniBarMode, barOff: boolean): boolean {
  return mode === "always" || (mode === "auto" && barOff);
}

/// Ciò di cui la mini-barra ha bisogno da chi la ospita: la stessa porta della
/// barra di formato.
export type MiniBarHost = Pick<FormatBarHost, "surface" | "writing" | "focusPane" | "runCommand">;

export interface MiniBar {
  readonly element: HTMLElement;
  /// Ridisegna se cambiano i comandi, la superficie o la lingua.
  update(specs: readonly CommandSpec[]): void;
  /// Rilegge lo stato dei pulsanti: premuto, spento.
  refresh(): void;
  /// Un suo menu (Trasforma, Colore) è aperto.
  holding(): boolean;
  destroy(): void;
}

/// Il nome di un'azione con la sua scorciatoia, come lo dice il suggerimento.
function withChord(label: string, chord: string | null): string {
  const shown = displayBinding(chord);
  return shown ? `${label} (${shown})` : label;
}

function setAttr(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function createMiniBar(host: MiniBarHost): MiniBar {
  ensureIcons();
  const element = document.createElement("div");
  element.className = "mini-bar";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-label", t("mini_bar.label"));
  element.hidden = true;
  const life = openLifetime();
  /// Ciò che il disegno corrente possiede: i suggerimenti, i menu aperti.
  let drawn = openLifetime();
  let signature = "";
  let titles: ReadonlyMap<string, string> = new Map();
  let refreshers: (() => void)[] = [];
  let colors: PopoverHandle | null = null;
  let closedOutsideAt = -Infinity;

  const actions = (): SurfaceEditorActions | undefined => host.surface()?.editorActions;

  /// Un gesto: l'azione della scorciatoia, sulla selezione che l'editor ha
  /// ancora (il puntatore non gli toglie il fuoco).
  function run(action: string, focusText = false): void {
    host.focusPane();
    if (focusText) host.surface()?.focus?.();
    actions()?.run(action);
    refresh();
  }

  // Il puntatore non prende il fuoco: resta all'editor, con la sua selezione.
  life.listen(element, "mousedown", (event) => {
    if ((event.target as Element | null)?.closest("button")) event.preventDefault();
  });
  const keys = rovingToolbar(element, {
    controls: () => [...element.querySelectorAll<HTMLButtonElement>("button")],
    onEscape: () => host.surface()?.focus?.(),
  }, life);

  function button(className: string, label: string, chord: string | null): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `mini-bar-button ${className}`.trim();
    control.tabIndex = -1;
    control.setAttribute("aria-label", label);
    const aria = ariaBinding(chord);
    if (aria) control.setAttribute("aria-keyshortcuts", aria);
    drawn.add(attachTooltip(control, withChord(label, chord)));
    return control;
  }

  function caret(control: HTMLElement): void {
    const figure = iconEl("fmt-chevron-down");
    if (!figure) return;
    figure.classList.add("mini-bar-caret");
    control.append(figure);
  }

  function drawAction(spec: ActionButton, surface: SurfaceEditorActions): HTMLButtonElement {
    const label = t(spec.label);
    const control = button(spec.named ? "mini-bar-named" : "", label, surface.chord(spec.action));
    control.dataset.command = spec.action;
    if (spec.glyph) {
      const glyph = document.createElement("span");
      glyph.className = `mini-bar-glyph is-${spec.glyph.kind}`;
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = spec.glyph.text;
      control.append(glyph);
    }
    const figure = spec.icon ? iconEl(spec.icon) : null;
    if (figure) control.append(figure);
    if (spec.named) {
      const text = document.createElement("span");
      text.className = "mini-bar-text";
      text.textContent = label;
      control.append(text);
    }
    // Commenta, Collega aprono qualcosa in cui si scrive: il fuoco va al testo
    // prima, così ciò che si apre torna lì.
    const opens = spec.action === COMMENT_ACTION || spec.action === LINK_ACTION;
    control.addEventListener("click", () => run(spec.action, opens));
    refreshers.push(() => {
      const state = actions()?.editable() ? actions()!.state(spec.action) : { enabled: false, active: null };
      if (control.disabled !== !state.enabled) control.disabled = !state.enabled;
      setAttr(control, "aria-pressed", state.active === null ? null : String(state.active));
    });
    return control;
  }

  function openMenu(trigger: HTMLButtonElement, items: readonly MenuItem[], options: Omit<ContextMenuOptions, "onClose">): void {
    const box = trigger.getBoundingClientRect();
    trigger.setAttribute("aria-expanded", "true");
    showContextMenu(new MouseEvent("click", { clientX: box.left, clientY: box.bottom }), [...items], {
      ...options,
      onClose: () => trigger.setAttribute("aria-expanded", "false"),
    });
  }

  /// «Trasforma»: il menu dello stile del blocco, per il blocco della
  /// selezione (il primo, se ne prende più d'uno).
  function drawTransform(): HTMLButtonElement {
    const label = t("mini_bar.transform");
    const control = button("mini-bar-named mini-bar-transform", label, null);
    control.dataset.command = "mini-bar.transform";
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
    const figure = iconEl("sync");
    if (figure) control.append(figure);
    const text = document.createElement("span");
    text.className = "mini-bar-text";
    text.textContent = label;
    control.append(text);
    caret(control);
    control.addEventListener("click", () => {
      const surface = actions();
      if (!surface?.editable()) return;
      const items = transformItems(surface, titles, (id) => run(id, true));
      if (items.length > 0) openMenu(control, items, { title: t("format_bar.style.menu"), label: t("format_bar.style.menu") });
    });
    refreshers.push(() => {
      const disabled = !canTransform(actions(), titles);
      if (control.disabled !== disabled) control.disabled = disabled;
    });
    return control;
  }

  /// «Colore»: le due righe dei nove colori, testo e fondo. Un campione già
  /// scelto lo toglie.
  function drawColor(): HTMLButtonElement {
    const label = t("mini_bar.color");
    const control = button("mini-bar-color", label, null);
    control.dataset.command = "mini-bar.color";
    control.setAttribute("aria-haspopup", "dialog");
    control.setAttribute("aria-expanded", "false");
    const mark = document.createElement("span");
    mark.className = "mini-bar-color-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "A";
    control.append(mark);
    caret(control);
    control.addEventListener("click", (event) => {
      // Il clic sul grilletto col pannello aperto lo chiude: la pressione lo
      // ha già chiuso come gesto «fuori», e il clic non lo riapre.
      if (performance.now() - closedOutsideAt < TOGGLE_GRACE_MS) return;
      // Aperto dalla tastiera (Invio, Spazio: `detail` 0) il fuoco va al
      // campione; col puntatore resta dov'era, come per gli altri pulsanti,
      // e nessuna didascalia spunta su un campione che nessuno ha indicato.
      openColors(control, event.detail === 0);
    });
    refreshers.push(() => {
      const surface = actions();
      const disabled = !surface?.editable() || !COLOR_ROWS.some((row) =>
        MINIBAR_COLORS.some((color) => surface.has(`${row.prefix}.${color}`) && surface.state(`${row.prefix}.${color}`).enabled));
      if (control.disabled !== disabled) control.disabled = disabled;
    });
    return control;
  }

  function openColors(trigger: HTMLButtonElement, takeFocus: boolean): void {
    const surface = actions();
    if (!surface?.editable()) return;
    // La vita del pannello: i suggerimenti dei campioni, e lui stesso.
    const handleLife = openLifetime();
    drawn.add(() => handleLife.close());
    const content = document.createElement("div");
    content.className = "mini-bar-colors-body";
    const swatches: HTMLButtonElement[] = [];
    let chosen: HTMLButtonElement | null = null;
    const columns = MINIBAR_COLORS.length;
    const focusSwatch = (swatch: HTMLButtonElement): void => {
      for (const each of swatches) each.tabIndex = each === swatch ? 0 : -1;
      swatch.focus({ preventScroll: true });
    };
    for (const row of COLOR_ROWS) {
      const name = document.createElement("div");
      name.className = "mini-bar-colors-label";
      name.id = identifier("mini-bar-colors");
      name.textContent = t(row.label);
      const grid = document.createElement("div");
      grid.className = "mini-bar-swatches";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-labelledby", name.id);
      for (const color of MINIBAR_COLORS) {
        const action = `${row.prefix}.${color}`;
        const colorName = t(`mini_bar.color.${color}` as Key);
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "mini-bar-swatch";
        swatch.dataset[row.data] = color;
        swatch.dataset.command = action;
        swatch.tabIndex = -1;
        // Come nel prototipo: una «A» su ogni campione, colorata nella riga del
        // testo, sul fondo tinto nella riga dello sfondo.
        swatch.textContent = "A";
        const state = surface.has(action) ? surface.state(action) : { enabled: false, active: null };
        const active = state.active === true;
        swatch.disabled = !state.enabled;
        swatch.setAttribute("aria-pressed", String(active));
        swatch.setAttribute("aria-label", colorName);
        const tip = active ? t("mini_bar.color.clear", { color: colorName }) : colorName;
        const untip = attachTooltip(swatch, `${t(row.label)} · ${tip}`);
        swatch.addEventListener("click", () => {
          const pick = active ? `${row.prefix}.default` : action;
          handle.close();
          run(surface.has(pick) ? pick : action, true);
        });
        swatches.push(swatch);
        handleLife.add(untip);
        if (active && chosen === null) chosen = swatch;
        grid.append(swatch);
      }
      content.append(name, grid);
    }
    // Le frecce si muovono nella griglia: a destra e a sinistra nella riga, in
    // su e in giù fra testo e fondo; Home ed End ai capi della riga.
    content.addEventListener("keydown", (event) => {
      const at = swatches.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      const row = Math.floor(at / columns);
      const col = at % columns;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = row * columns + Math.min(columns - 1, col + 1);
      else if (event.key === "ArrowLeft") next = row * columns + Math.max(0, col - 1);
      else if (event.key === "ArrowDown") next = Math.min(COLOR_ROWS.length - 1, row + 1) * columns + col;
      else if (event.key === "ArrowUp") next = Math.max(0, row - 1) * columns + col;
      else if (event.key === "Home") next = row * columns;
      else if (event.key === "End") next = row * columns + columns - 1;
      if (next === null) return;
      event.preventDefault();
      focusSwatch(swatches[next]!);
    });
    trigger.setAttribute("aria-expanded", "true");
    const handle = openPopover({
      anchor: trigger,
      content,
      placement: "bottom",
      align: "start",
      label: t("mini_bar.color"),
      className: "mini-bar-colors",
      autoFocus: false,
      lifetime: handleLife,
      onClose: (reason) => {
        if (reason === "outside" && trigger.matches(":hover")) closedOutsideAt = performance.now();
        trigger.setAttribute("aria-expanded", "false");
        if (colors === handle) colors = null;
        handleLife.close();
      },
    });
    // Dentro il menu del tasto destro un clic qui non è «fuori» dal menu.
    handle.element.dataset.menuKeep = "";
    colors = handle;
    const first = chosen ?? swatches.find((swatch) => !swatch.disabled) ?? swatches[0];
    if (first && takeFocus) focusSwatch(first);
    else if (first) first.tabIndex = 0;
  }

  function rule(): HTMLElement {
    const line = document.createElement("span");
    line.className = "mini-bar-rule";
    line.setAttribute("aria-hidden", "true");
    return line;
  }

  /// Che cosa c'è in questa superficie, nell'ordine: ciò che decide il disegno.
  function present(surface: SurfaceEditorActions | undefined): (readonly Slot[])[] {
    if (!surface || !host.writing()) return [];
    return GROUPS.map((group) => group.filter((slot) => {
      // Ciò che c'è, non ciò che adesso si può: la barra non cambia forma
      // per uno stato (spento resta al suo posto).
      if (slot === "transform") return transformOffered(surface, titles);
      if (slot === "color") return COLOR_ROWS.some((row) => MINIBAR_COLORS.some((color) => surface.has(`${row.prefix}.${color}`)));
      return surface.has(slot.action);
    })).filter((group) => group.length > 0);
  }

  function rebuild(groups: readonly (readonly Slot[])[], surface: SurfaceEditorActions): void {
    colors?.close();
    drawn.close();
    drawn = openLifetime();
    refreshers = [];
    element.replaceChildren();
    groups.forEach((group, index) => {
      if (index > 0) element.append(rule());
      for (const slot of group) {
        if (slot === "transform") element.append(drawTransform());
        else if (slot === "color") element.append(drawColor());
        else element.append(drawAction(slot, surface));
      }
    });
    element.setAttribute("aria-label", t("mini_bar.label"));
    refresh();
  }

  function refresh(): void {
    if (life.closed) return;
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    for (const each of refreshers) each();
    const current = keys.refresh();
    if (focused instanceof HTMLButtonElement && focused.disabled) current?.focus();
  }

  function update(specs: readonly CommandSpec[]): void {
    if (life.closed) return;
    titles = new Map(specs.map((spec) => [spec.id, spec.title]));
    const surface = actions();
    const groups = present(surface);
    // La lingua e le scorciatoie fanno parte della forma.
    const shape = t("mini_bar.label") + "#" + groups.map((group) => group.map((slot) =>
      typeof slot === "string" ? slot : `${slot.action}=${surface?.chord(slot.action) ?? ""}`).join(",")).join("|");
    const empty = groups.length === 0;
    if (element.hidden !== empty) element.hidden = empty;
    if (shape !== signature) {
      signature = shape;
      if (surface) rebuild(groups, surface);
      else element.replaceChildren();
    } else {
      refresh();
    }
  }

  return {
    element,
    update,
    refresh,
    holding: () => element.querySelector("[aria-expanded='true']") !== null,
    destroy() {
      colors?.close();
      drawn.close();
      life.close();
      element.remove();
    },
  };
}

/// Monta la mini-barra del menu dentro `host`, e torna come smontarla. Un
/// gesto fatto dalla barra chiude il menu: il testo è già cambiato, le voci
/// parlerebbero dello stato di prima.
export function mountMiniBar(
  barHost: MiniBarHost,
  specs: readonly CommandSpec[],
  own: SurfaceMiniBar | null,
): ((host: HTMLElement) => () => void) | null {
  if (miniBarMode() === "off") return null;
  if (own) return (host) => own.mount(host);
  return (host) => {
    const bar = createMiniBar({
      ...barHost,
      focusPane: () => {
        barHost.focusPane();
        queueMicrotask(closeContextMenu);
      },
    });
    bar.update(specs);
    host.classList.add("context-strip-mini");
    host.append(bar.element);
    return () => {
      bar.destroy();
      host.classList.remove("context-strip-mini");
    };
  };
}
