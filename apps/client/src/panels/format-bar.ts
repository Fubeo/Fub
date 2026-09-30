// La barra di formattazione di un riquadro: i comandi che un plugin offre in
// `CommandSurface::Toolbar`, disegnati come pulsanti sopra il testo.
//
// # Chi decide cosa
//
// - **Il plugin** decide quali pulsanti ci sono, in che ordine, e come si
//   chiamano (titolo e descrizione localizzati dal suo catalogo). Spento il
//   plugin, i suoi comandi escono da `list_commands` e la barra con loro.
// - **La superficie** esegue le azioni dell'editor e ne dice lo stato: premuto
//   dove il cursore è già in grassetto, spento fuori da una tabella. Un id
//   che è un'azione della superficie si esegue qui, senza attraversare l'IPC:
//   cursore e cronologia locale sono suoi (0190), e la dichiarazione del
//   comando è la promessa (`CommandSurface::Toolbar`).
// - **Questo modulo** decide la resa: icona, gruppo e menu a tendina di ogni
//   azione che conosce, il ripiego a una riga, la tastiera. È la stessa
//   divisione della rail con le icone delle view.
//
// Un comando offerto qui che non è un'azione dell'editor è un pulsante col suo
// titolo, eseguito come dalla palette. Un'azione che la superficie montata non
// conosce non si disegna: un foglio non ha titoli Markdown da offrire.
//
// # Tastiera
//
// Il modello è quello della barra degli strumenti WAI-ARIA: un solo punto di
// tabulazione, le frecce si spostano fra i pulsanti, Home ed End ai capi,
// Escape torna al testo. Il puntatore non toglie il fuoco all'editor: la
// selezione su cui il pulsante agisce resta dov'era.
import type { CommandSpec } from "../host/contract";
import type { EditorSurface } from "../editors/core/registry";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../editors/core/editor-actions";
import { t, type Key } from "../i18n/strings";
import { ariaBinding, displayBinding } from "../ui/commands";
import { iconEl, registerIcon } from "../ui/icons";
import { openLifetime, type Teardown } from "../ui/lifetime";
import { showContextMenu, type MenuItem } from "../ui/menu";
import { attachTooltip } from "../ui/tooltip";

/// I gruppi, nell'ordine in cui si incontrano: un gruppo nuovo comincia dove
/// cambia quello del pulsante, quindi l'ordine resta del plugin.
type GroupId = "history" | "block" | "inline" | "links" | "lists" | "blocks" | "table" | "other";

const GROUP_LABELS: Record<GroupId, Key> = {
  history: "format_bar.group.history",
  block: "format_bar.group.block",
  inline: "format_bar.group.inline",
  links: "format_bar.group.links",
  lists: "format_bar.group.lists",
  blocks: "format_bar.group.blocks",
  table: "format_bar.group.table",
  other: "format_bar.group.other",
};

/// Come si presenta un'azione dell'editor. `menu`: sta nel menu a tendina del
/// gruppo invece che in riga (i sei titoli, le operazioni sulla tabella).
interface Look {
  readonly icon: string;
  readonly group: GroupId;
  readonly menu?: boolean;
}

/// Le azioni dell'editor che questa shell sa disegnare. L'elenco dei nomi è il
/// vocabolario del contratto (`docs/reference/ipc-contract.md`).
export const ACTION_LOOKS: Readonly<Record<string, Look>> = {
  "text.undo": { icon: "fmt-undo", group: "history" },
  "text.redo": { icon: "fmt-redo", group: "history" },
  "markdown.paragraph": { icon: "", group: "block", menu: true },
  "markdown.heading.1": { icon: "", group: "block", menu: true },
  "markdown.heading.2": { icon: "", group: "block", menu: true },
  "markdown.heading.3": { icon: "", group: "block", menu: true },
  "markdown.heading.4": { icon: "", group: "block", menu: true },
  "markdown.heading.5": { icon: "", group: "block", menu: true },
  "markdown.heading.6": { icon: "", group: "block", menu: true },
  "markdown.bold": { icon: "fmt-bold", group: "inline" },
  "markdown.italic": { icon: "fmt-italic", group: "inline" },
  "markdown.strikethrough": { icon: "fmt-strike", group: "inline" },
  "markdown.highlight": { icon: "fmt-highlight", group: "inline" },
  "markdown.code": { icon: "fmt-code", group: "inline" },
  "markdown.math": { icon: "fmt-math", group: "inline" },
  "markdown.comment": { icon: "fmt-comment", group: "inline" },
  "markdown.clear": { icon: "fmt-clear", group: "inline" },
  "markdown.link": { icon: "fmt-link", group: "links" },
  "markdown.wikilink": { icon: "fmt-wikilink", group: "links" },
  "markdown.image": { icon: "fmt-image", group: "links" },
  "markdown.footnote": { icon: "footnote", group: "links" },
  "markdown.list.bullet": { icon: "fmt-bullets", group: "lists" },
  "markdown.list.ordered": { icon: "fmt-numbers", group: "lists" },
  "markdown.list.task": { icon: "fmt-tasks", group: "lists" },
  "markdown.list.indent": { icon: "fmt-indent", group: "lists" },
  "markdown.list.dedent": { icon: "fmt-outdent", group: "lists" },
  "markdown.quote": { icon: "fmt-quote", group: "blocks" },
  "markdown.callout": { icon: "fmt-callout", group: "blocks" },
  "markdown.codeblock": { icon: "fmt-codeblock", group: "blocks" },
  "markdown.mathblock": { icon: "fmt-mathblock", group: "blocks" },
  "markdown.rule": { icon: "fmt-rule", group: "blocks" },
  "markdown.table": { icon: "fmt-table", group: "table" },
  "markdown.table.row.before": { icon: "", group: "table", menu: true },
  "markdown.table.row.after": { icon: "", group: "table", menu: true },
  "markdown.table.row.up": { icon: "", group: "table", menu: true },
  "markdown.table.row.down": { icon: "", group: "table", menu: true },
  "markdown.table.row.delete": { icon: "", group: "table", menu: true },
  "markdown.table.column.before": { icon: "", group: "table", menu: true },
  "markdown.table.column.after": { icon: "", group: "table", menu: true },
  "markdown.table.column.left": { icon: "", group: "table", menu: true },
  "markdown.table.column.right": { icon: "", group: "table", menu: true },
  "markdown.table.column.delete": { icon: "", group: "table", menu: true },
  "markdown.table.sort.ascending": { icon: "", group: "table", menu: true },
  "markdown.table.sort.descending": { icon: "", group: "table", menu: true },
};

/// Le figure della barra, col costrutto del set (`ui/icons.ts`): soltanto
/// tracciati in una griglia 24×24. Le registra chi monta le barre.
const FORMAT_ICONS: Readonly<Record<string, readonly string[]>> = {
  "fmt-undo": ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "fmt-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "fmt-bold": ["M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"],
  "fmt-italic": ["M10 5h8", "M6 19h8", "M14 5 10 19"],
  "fmt-strike": [
    "M5 12h14",
    "M16 7.5C15.3 6 13.8 5 12 5c-2.5 0-4 1.4-4 3 0 1.2.8 2.2 2.4 3",
    "M8 16.5c.7 1.5 2.2 2.5 4 2.5 2.5 0 4-1.4 4-3 0-.7-.2-1.3-.7-1.8",
  ],
  "fmt-highlight": ["M9 11l-5 5v3h3l5-5", "M9 11l6-6 4 4-6 6z", "M14 20h6"],
  "fmt-code": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5"],
  "fmt-math": ["M18 5H6l6 7-6 7h12"],
  "fmt-comment": [
    "M3 3l18 18",
    "M10.6 6.1c.5-.1.9-.1 1.4-.1 5 0 9 6 9 6a17 17 0 0 1-2.6 3.2",
    "M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1",
  ],
  "fmt-clear": ["M4 7V5h12v2", "M10 5 8 19", "M14 14l6 6", "M20 14l-6 6"],
  "fmt-link": [
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
    "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ],
  "fmt-wikilink": ["M7 5H4v14h3", "M10 8H8v8h2", "M17 5h3v14h-3", "M14 8h2v8h-2"],
  "fmt-image": ["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  "fmt-bullets": ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"],
  "fmt-numbers": ["M10 6h10M10 12h10M10 18h10", "M4 4.5 5.5 4v5", "M4 14.5c.3-.9 2.5-.9 2.5.5S4 17 4 19h2.5"],
  "fmt-tasks": ["M11 6h9M11 12h9M11 18h9", "M4 4h4v4H4z", "M4 10h4v4H4z", "M4.8 12l.9.9L7.4 11", "M4 16h4v4H4z"],
  "fmt-indent": ["M4 5h16M11 10h9M11 14h9M4 19h16", "M4 9l3 3-3 3"],
  "fmt-outdent": ["M4 5h16M11 10h9M11 14h9M4 19h16", "M7 9l-3 3 3 3"],
  "fmt-quote": ["M5 5v14", "M9 8h10M9 12h10M9 16h6"],
  "fmt-callout": ["M4 4h16v16H4z", "M12 11v5", "M12 8h.01"],
  "fmt-codeblock": ["M4 4h16v16H4z", "M10 10l-2 2 2 2", "M14 10l2 2-2 2"],
  "fmt-mathblock": ["M4 4h16v16H4z", "M15 8H9l3 4-3 4h6"],
  "fmt-rule": ["M3 12h18", "M8 6h8M8 18h8"],
  "fmt-table": ["M4 5h16v14H4z", "M4 10h16M4 14.5h16", "M10 5v14"],
  "fmt-chevron-down": ["M6 9l6 6 6-6"],
  "fmt-more": ["M6 12h.01M12 12h.01M18 12h.01"],
};

/// Quanti montaggi tengono registrate le figure, e come ritirarle.
let iconHolders = 0;
let retireIcons: Teardown | null = null;

/// Registra le figure della barra e restituisce il ritiro di questa presa.
/// Le figure restano finché qualcuno le tiene: un rimontaggio del pannello
/// prima dello smontaggio del precedente non le ridichiara (il repertorio
/// rifiuta un nome già disegnato).
export function registerFormatIcons(): Teardown {
  if (iconHolders === 0) {
    const retire = Object.entries(FORMAT_ICONS).map(([name, paths]) => registerIcon(name, paths));
    retireIcons = () => {
      for (const stop of retire) stop();
    };
  }
  iconHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    iconHolders -= 1;
    if (iconHolders === 0) {
      retireIcons?.();
      retireIcons = null;
    }
  };
}

/// Ciò di cui la barra ha bisogno dal riquadro che la ospita.
export interface FormatBarHost {
  /// La superficie montata adesso, se c'è.
  surface(): EditorSurface | null;
  /// La modalità corrente è di scrittura (non una resa da leggere).
  writing(): boolean;
  /// Rende attivo il riquadro nel layout, senza spostare il fuoco del DOM.
  focusPane(): void;
  /// Esegue un comando che non è un'azione dell'editor, come la palette.
  runCommand(id: string): void;
}

export interface FormatBar {
  readonly element: HTMLElement;
  /// Ridisegna la barra: comandi, superficie o modalità cambiati.
  update(specs: readonly CommandSpec[]): void;
  destroy(): void;
}

interface Entry {
  readonly spec: CommandSpec;
  /// L'azione dell'editor, o `null` per un comando qualunque.
  readonly action: string | null;
  readonly icon: string;
}

interface Group {
  readonly id: GroupId;
  readonly inline: Entry[];
  readonly menu: Entry[];
}

/// I gruppi da disegnare per questa superficie, nell'ordine dei comandi.
export function toolbarGroups(specs: readonly CommandSpec[], actions: SurfaceEditorActions | undefined): Group[] {
  const groups: Group[] = [];
  for (const spec of specs) {
    if (!spec.surfaces.includes("toolbar")) continue;
    const look = ACTION_LOOKS[spec.id];
    let entry: Entry;
    let group: GroupId;
    let menu = false;
    if (actions?.has(spec.id)) {
      entry = { spec, action: spec.id, icon: look?.icon ?? "" };
      group = look?.group ?? "other";
      menu = look?.menu === true;
    } else if (look) {
      // Un'azione che questa superficie non sa eseguire: niente pulsante.
      continue;
    } else {
      entry = { spec, action: null, icon: "" };
      group = "other";
    }
    let last = groups[groups.length - 1];
    if (!last || last.id !== group) {
      last = { id: group, inline: [], menu: [] };
      groups.push(last);
    }
    (menu ? last.menu : last.inline).push(entry);
  }
  return groups;
}

function hintOf(actions: SurfaceEditorActions | undefined, entry: Entry): string | null {
  return entry.action ? actions?.chord(entry.action) ?? null : entry.spec.keybinding;
}

/// Monta una barra vuota; `update` la riempie.
export function createFormatBar(host: FormatBarHost): FormatBar {
  const element = document.createElement("div");
  element.className = "format-bar";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-label", t("format_bar.label"));
  element.hidden = true;
  const life = openLifetime();
  /// Ciò che il disegno corrente possiede: suggerimenti, iscrizione alla
  /// superficie. Si scioglie a ogni ridisegno della struttura.
  let drawn = openLifetime();
  let signature = "";
  let groups: Group[] = [];
  let observed: SurfaceEditorActions | null = null;
  /// I controlli che portano stato: pulsanti in riga e grilletti dei menu.
  let refreshers: (() => void)[] = [];
  let groupEls: HTMLElement[] = [];
  let overflowButton: HTMLButtonElement | null = null;
  /// Il controllo che riceve il Tab: l'ultimo toccato, o il primo.
  let current: HTMLButtonElement | null = null;
  let frame: number | null = null;

  const actions = (): SurfaceEditorActions | undefined => host.surface()?.editorActions;
  const stateOf = (entry: Entry): EditorActionState => {
    if (!entry.action) return { enabled: true, active: null };
    const surface = actions();
    if (!surface || !surface.editable()) return ACTION_UNAVAILABLE;
    return surface.state(entry.action);
  };

  function run(entry: Entry): void {
    host.focusPane();
    if (!entry.action) {
      host.runCommand(entry.spec.id);
      return;
    }
    actions()?.run(entry.action);
    refresh();
  }

  // Il puntatore non prende il fuoco: resta all'editor, con la sua selezione.
  life.listen(element, "mousedown", (event) => {
    if ((event.target as Element | null)?.closest("button")) event.preventDefault();
  });
  life.listen(element, "keydown", (event) => {
    const controls = focusable();
    const at = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (at + 1) % controls.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + controls.length) % controls.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = controls.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      host.surface()?.focus?.();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    focusControl(controls[next]!);
  });
  life.listen(element, "focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && element.contains(target)) roving(target);
  });

  /// I controlli raggiungibili adesso: visibili e non spenti.
  function focusable(): HTMLButtonElement[] {
    return [...element.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => !button.disabled && !button.closest("[hidden]"));
  }

  function roving(target: HTMLButtonElement | null): void {
    const controls = focusable();
    current = target && controls.includes(target) ? target : controls[0] ?? null;
    for (const button of element.querySelectorAll<HTMLButtonElement>("button")) {
      button.tabIndex = button === current ? 0 : -1;
    }
  }

  function focusControl(button: HTMLButtonElement): void {
    roving(button);
    button.focus();
  }

  function button(className: string, label: string, hint: string | null): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.tabIndex = -1;
    control.setAttribute("aria-label", label);
    const shown = displayBinding(hint);
    const aria = ariaBinding(hint);
    if (aria) control.setAttribute("aria-keyshortcuts", aria);
    drawn.add(attachTooltip(control, shown ? `${label} (${shown})` : label));
    return control;
  }

  function drawInline(entry: Entry): HTMLButtonElement {
    const control = button("format-bar-button", entry.spec.title, hintOf(actions(), entry));
    control.dataset.command = entry.spec.id;
    const figure = entry.icon ? iconEl(entry.icon) : null;
    if (figure) control.append(figure);
    else control.textContent = entry.spec.title;
    control.addEventListener("click", () => run(entry));
    refreshers.push(() => {
      const state = stateOf(entry);
      control.disabled = !state.enabled;
      if (state.active === null) control.removeAttribute("aria-pressed");
      else control.setAttribute("aria-pressed", String(state.active));
    });
    return control;
  }

  function menuItems(entries: readonly Entry[]): MenuItem[] {
    const surface = actions();
    return entries.map((entry) => {
      const state = stateOf(entry);
      return {
        label: entry.spec.title,
        disabled: !state.enabled,
        selected: state.active === true,
        hint: displayBinding(hintOf(surface, entry)) || undefined,
        run: () => run(entry),
      };
    });
  }

  function openMenu(trigger: HTMLButtonElement, items: MenuItem[]): void {
    const box = trigger.getBoundingClientRect();
    trigger.setAttribute("aria-expanded", "true");
    showContextMenu(
      new MouseEvent("click", { clientX: box.left, clientY: box.bottom }),
      items,
      { onClose: () => trigger.setAttribute("aria-expanded", "false") },
    );
  }

  /// Il grilletto del menu di un gruppo. Nello stile del paragrafo dice lo
  /// stile corrente («Titolo 2»), come il selettore di un elaboratore di testi.
  function drawMenu(group: Group): HTMLButtonElement {
    const style = group.id === "block";
    const label = style ? t(GROUP_LABELS[group.id]) : t("format_bar.table.more");
    const trigger = button(style ? "format-bar-menu format-bar-style" : "format-bar-menu", label, null);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const text = document.createElement("span");
    text.className = "format-bar-menu-label";
    const chevron = iconEl("fmt-chevron-down");
    trigger.append(text);
    if (chevron) trigger.append(chevron);
    trigger.addEventListener("click", () => openMenu(trigger, menuItems(group.menu)));
    refreshers.push(() => {
      const states = group.menu.map(stateOf);
      trigger.disabled = !states.some((state) => state.enabled);
      if (!style) return;
      const active = group.menu[states.findIndex((state) => state.active === true)];
      text.textContent = active?.spec.title ?? label;
      trigger.setAttribute("aria-label", active ? `${label}: ${active.spec.title}` : label);
    });
    return trigger;
  }

  function drawOverflow(): HTMLButtonElement {
    const more = button("format-bar-menu format-bar-overflow", t("format_bar.overflow"), null);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    const figure = iconEl("fmt-more");
    if (figure) more.append(figure);
    more.hidden = true;
    more.addEventListener("click", () => {
      const items: MenuItem[] = [];
      groups.forEach((group, index) => {
        if (!groupEls[index]?.hidden) return;
        const entries = menuItems([...group.inline, ...group.menu]);
        if (entries[0]) entries[0] = { ...entries[0], separator: items.length > 0 };
        items.push(...entries);
      });
      openMenu(more, items);
    });
    return more;
  }

  /// Quanti gruppi entrano in una riga: gli ultimi scendono nel menu «altri».
  function fit(): void {
    if (element.hidden || !overflowButton) return;
    for (const group of groupEls) group.hidden = false;
    overflowButton.hidden = true;
    if (element.scrollWidth <= element.clientWidth) return;
    overflowButton.hidden = false;
    for (let index = groupEls.length - 1; index > 0; index--) {
      if (element.scrollWidth <= element.clientWidth) break;
      groupEls[index]!.hidden = true;
    }
    roving(current);
  }

  // Senza `ResizeObserver` (un banco senza layout) la barra resta intera.
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(() => fit());
  observer?.observe(element);
  life.add(() => observer?.disconnect());

  function refresh(): void {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    for (const update of refreshers) update();
    roving(current);
    // Il pulsante a fuoco si è spento (annulla senza più niente da annullare):
    // il fuoco resta nella barra invece di cadere sulla pagina.
    if (focused instanceof HTMLButtonElement && focused.disabled) current?.focus();
  }

  /// Lo stato cambia a ogni movimento del cursore: si ridisegna al più una
  /// volta per fotogramma.
  function scheduleRefresh(): void {
    if (frame !== null || life.closed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  }
  life.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
  });

  function rebuild(next: Group[], surface: SurfaceEditorActions | undefined): void {
    drawn.close();
    drawn = openLifetime();
    groups = next;
    refreshers = [];
    groupEls = [];
    current = null;
    element.replaceChildren();
    element.setAttribute("aria-label", t("format_bar.label"));
    for (const group of groups) {
      const box = document.createElement("div");
      box.className = "format-bar-group";
      box.dataset.group = group.id;
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", t(GROUP_LABELS[group.id]));
      for (const entry of group.inline) box.append(drawInline(entry));
      if (group.menu.length > 0) box.append(drawMenu(group));
      groupEls.push(box);
      element.append(box);
    }
    overflowButton = drawOverflow();
    element.append(overflowButton);
    observed = surface ?? null;
    // Una barra vuota non ha stato da seguire: niente iscrizione, niente
    // lavoro a ogni movimento del cursore.
    if (surface && groups.length > 0) {
      const stopActions = surface.subscribe(scheduleRefresh);
      drawn.add(stopActions);
    }
    refresh();
    fit();
  }

  return {
    element,
    update(specs) {
      if (life.closed) return;
      const surface = host.surface()?.editorActions;
      const next = host.writing() ? toolbarGroups(specs, surface) : [];
      // La lingua fa parte della forma: gruppi ed etichette sono della shell.
      const shape = t("format_bar.label") + "#" + next.map((group) =>
        `${group.id}:${group.inline.map((e) => `${e.spec.id}=${e.spec.title}`).join(",")}` +
        `|${group.menu.map((e) => `${e.spec.id}=${e.spec.title}`).join(",")}`
      ).join(";");
      element.hidden = next.length === 0;
      if (shape === signature && surface === (observed ?? undefined)) {
        refresh();
        fit();
        return;
      }
      signature = shape;
      rebuild(next, surface);
    },
    destroy() {
      drawn.close();
      life.close();
      element.remove();
    },
  };
}
