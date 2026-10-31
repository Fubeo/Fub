// La testata della pagina (H12) e il suo menu «…» (H13): in Blocchi, in cima,
// l'icona (`icon:`), la copertina (`cover:`) e il titolo, con le proprietà
// subito sotto. Il titolo è il nome del file, e per la pagina di una cartella
// (`X/_index.md`, decisione 0229) il nome della cartella: si scrive in riga, e
// cambiarlo è una rinomina, del file o della cartella. Icona, copertina,
// larghezza e carattere stanno nel frontmatter, scritti col codice delle
// proprietà: il file resta Markdown, e Sorgente mostra le stesse righe.
import { EditorSelection, type EditorState, type Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { createList, openPopover, textField, type PopoverHandle } from "../../../../../kit";
import { catalogLanguage, resolvedLanguage } from "../../../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { matchEmoji } from "../completions";
import { propertyBlock, propertyList, propertyValue, setProperty } from "../properties";
import { imageHtml } from "../render-inline";
import { liveStrings } from "../strings";
import { blocksOptions, type BlocksOptions } from "./handles";

/// Le classi della pagina che il menu «…» scrive in `cssclasses`; il tema le
/// applica al riquadro (`fub-note--*`). Le altre classi della nota restano.
export const PAGE_FONTS = ["serif", "sans", "mono"] as const;
export type PageFont = (typeof PAGE_FONTS)[number];

/// Ciò che la testata mostra, letto dallo stato e dalle opzioni.
export interface PageData {
  readonly title: string;
  readonly folder: boolean;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly classes: readonly string[];
  readonly readOnly: boolean;
  readonly renamable: boolean;
  readonly subpages: boolean;
}

export function pageData(state: EditorState, options: BlocksOptions = state.facet(blocksOptions)): PageData {
  const icon = propertyValue(state, "icon")?.trim() || null;
  const cover = propertyValue(state, "cover")?.trim() || null;
  return {
    title: options.page?.() ?? "",
    folder: options.folderPage?.() ?? false,
    icon,
    cover,
    classes: propertyList(state, "cssclasses"),
    readOnly: state.readOnly,
    renamable: options.rename !== undefined,
    subpages: options.subpage !== undefined,
  };
}

function sameData(a: PageData, b: PageData): boolean {
  return a.title === b.title && a.folder === b.folder && a.icon === b.icon && a.cover === b.cover
    && a.readOnly === b.readOnly && a.renamable === b.renamable && a.subpages === b.subpages
    && a.classes.length === b.classes.length && a.classes.every((name, i) => name === b.classes[i]);
}

/// Le classi dopo un gesto del menu: `wide` e `small` si accendono e si
/// spengono, il carattere è uno solo (o quello del tema, `null`).
export function pageClassesWith(
  classes: readonly string[],
  change: { readonly toggle: "wide" | "small" } | { readonly font: PageFont | null },
): string[] {
  if ("toggle" in change) {
    return classes.includes(change.toggle) ? classes.filter((name) => name !== change.toggle) : [...classes, change.toggle];
  }
  const rest = classes.filter((name) => !(PAGE_FONTS as readonly string[]).includes(name));
  return change.font ? [...rest, change.font] : rest;
}

/// Dove comincia il testo della pagina: dopo il frontmatter, se c'è.
function bodyStart(state: EditorState): number {
  const block = propertyBlock(state);
  if (!block) return 0;
  return Math.min(state.doc.length, block.to + 1);
}

/// Scrive una proprietà della pagina con un passo d'annullamento suo.
function writeProperty(view: EditorView, key: string, value: string | readonly string[] | null): void {
  if (view.state.readOnly) return;
  const change = setProperty(view.state, key, value);
  if (change) view.dispatch({ changes: change, userEvent: "input" });
}

/// Rilegge la testata: dopo una rinomina il titolo è cambiato fuori dal testo.
const refreshPage = StateEffect.define<null>();

const lives = new WeakMap<HTMLElement, Lifetime>();

class PageHeaderWidget extends WidgetType {
  constructor(readonly data: PageData) { super(); }

  override eq(other: PageHeaderWidget): boolean {
    return sameData(other.data, this.data);
  }

  toDOM(view: EditorView): HTMLElement {
    const data = this.data;
    const life = openLifetime();
    const root = document.createElement("div");
    root.className = "cm-fub-page";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", liveStrings.t("page.label"));
    lives.set(root, life);
    let popover: PopoverHandle | null = null;
    const closePopover = () => {
      popover?.close();
      popover = null;
    };
    life.add(closePopover);

    if (data.cover) {
      const cover = document.createElement("div");
      cover.className = "cm-fub-page-cover";
      if (view.state.facet(blocksOptions).mountImage) {
        const unmount = view.state.facet(blocksOptions).mountImage!(cover, imageHtml("", data.cover));
        life.add(unmount);
      }
      const measure = () => view.requestMeasure();
      life.listen(cover, "load", measure, { capture: true });
      root.append(cover);
    }

    const tools = document.createElement("div");
    tools.className = "cm-fub-page-tools";
    const tool = (label: string, run: (button: HTMLButtonElement) => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-fub-page-tool";
      button.textContent = label;
      life.listen(button, "click", () => run(button));
      return button;
    };

    const iconButton = (anchor: HTMLButtonElement) => {
      closePopover();
      popover = openIconPicker(view, anchor, data, life, () => { popover = null; });
    };
    const coverButton = (anchor: HTMLButtonElement) => {
      closePopover();
      popover = openCoverDialog(view, anchor, data, life, () => { popover = null; });
    };
    const subpageButton = (anchor: HTMLButtonElement) => {
      closePopover();
      popover = openSubpageDialog(view, anchor, data, life, () => { popover = null; });
    };
    const moreButton = (anchor: HTMLButtonElement) => {
      closePopover();
      popover = openPageMenu(view, anchor, data, life, () => { popover = null; });
    };

    if (data.icon) {
      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = "cm-fub-page-icon";
      icon.textContent = data.icon;
      icon.setAttribute("aria-label", liveStrings.t("page.icon.change", { icon: data.icon }));
      icon.disabled = data.readOnly;
      life.listen(icon, "click", () => iconButton(icon));
      root.append(icon);
    }
    if (!data.readOnly) {
      if (!data.icon) tools.append(tool(liveStrings.t("page.icon.add"), iconButton));
      tools.append(tool(liveStrings.t(data.cover ? "page.cover.change" : "page.cover.add"), coverButton));
      if (data.subpages) tools.append(tool(liveStrings.t("page.subpage.add"), subpageButton));
      const more = tool("⋯", moreButton);
      more.classList.add("cm-fub-page-more");
      more.setAttribute("aria-label", liveStrings.t("page.more"));
      more.setAttribute("aria-haspopup", "menu");
      tools.append(more);
      root.append(tools);
    }

    const title = document.createElement("input");
    title.type = "text";
    title.className = "cm-fub-page-title";
    title.value = data.title;
    title.spellcheck = false;
    title.autocomplete = "off";
    title.setAttribute("aria-label", liveStrings.t("page.title"));
    title.title = liveStrings.t(data.folder ? "page.title.folder" : "page.title.file");
    title.readOnly = data.readOnly || !data.renamable;
    root.append(title);

    let busy = false;
    const toBody = () => {
      const at = bodyStart(view.state);
      view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true, userEvent: "select" });
      view.focus();
    };
    const commit = async (): Promise<void> => {
      const options = view.state.facet(blocksOptions);
      const name = title.value.trim();
      if (busy || title.readOnly || !options.rename) return;
      if (name === "" || name === data.title) {
        title.value = data.title;
        return;
      }
      busy = true;
      title.readOnly = true;
      root.setAttribute("aria-busy", "true");
      const problem = await options.rename(name).catch((error: unknown) => error instanceof Error ? error.message : String(error));
      busy = false;
      root.removeAttribute("aria-busy");
      if (life.closed) return;
      title.readOnly = false;
      if (problem) {
        title.value = data.title;
        options.notify?.(problem, "guasto");
        return;
      }
      view.dispatch({ effects: refreshPage.of(null) });
    };
    life.listen(title, "keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void commit();
        toBody();
      } else if (event.key === "Escape") {
        event.preventDefault();
        title.value = data.title;
        toBody();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        toBody();
      }
    });
    life.listen(title, "blur", () => void commit());
    return root;
  }

  override destroy(dom: HTMLElement): void {
    lives.get(dom)?.close();
    lives.delete(dom);
  }

  /// La testata è un modulo, non testo: tasti e puntatore restano suoi.
  override ignoreEvent(): boolean {
    return true;
  }
}

/// La scelta dell'icona: un campo che cerca fra le emoji (italiano e inglese)
/// e la griglia dei risultati; «Togli l'icona» se ce n'è una.
function openIconPicker(view: EditorView, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  const grid = document.createElement("div");
  grid.className = "cm-fub-page-emoji";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", liveStrings.t("page.icon.picker"));
  const language = catalogLanguage(resolvedLanguage()) === "it" ? "it" : "en";
  let first: string | null = null;
  const choose = (char: string | null) => {
    popover.close();
    writeProperty(view, "icon", char);
    view.focus();
  };
  let asked = 0;
  const show = (query: string) => {
    const question = ++asked;
    void import("../emoji-data").then(({ EMOJI }) => {
      if (question !== asked || own.closed) return;
      const found = query.trim() ? matchEmoji(EMOJI, query.trim(), language) : EMOJI.slice(0, 40).map((entry) => ({ char: entry.char, name: (language === "it" ? entry.it : entry.en)[0] ?? "" }));
      first = found[0]?.char ?? null;
      grid.replaceChildren(...found.map(({ char, name }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cm-fub-page-emoji-choice";
        button.textContent = char;
        button.setAttribute("aria-label", name.replace(/_/g, " "));
        button.title = name.replace(/_/g, " ");
        own.listen(button, "click", () => choose(char));
        return button;
      }));
      if (found.length === 0) {
        const none = document.createElement("p");
        none.className = "cm-fub-page-empty";
        none.textContent = liveStrings.t("page.icon.none");
        grid.append(none);
      }
    }, () => {});
  };
  const search = textField({
    label: liveStrings.t("page.icon.search"),
    labelHidden: true,
    placeholder: liveStrings.t("page.icon.search"),
    lifetime: own,
    onInput: (value) => show(value),
    onSubmit: () => { if (first) choose(first); },
  });
  body.append(search.element, grid);
  if (data.icon) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cm-fub-page-tool";
    remove.textContent = liveStrings.t("page.icon.remove");
    own.listen(remove, "click", () => choose(null));
    body.append(remove);
  }
  show("");
  const popover = openPopover({
    anchor,
    content: body,
    label: liveStrings.t("page.icon.picker"),
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      closed();
    },
  });
  search.focus();
  return popover;
}

/// La copertina: un'immagine del vault (il path, come in `![](…)`) o un
/// indirizzo; «Togli la copertina» se ce n'è una.
function openCoverDialog(view: EditorView, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  const apply = () => {
    const value = field.value().trim();
    popover.close();
    writeProperty(view, "cover", value || null);
    view.focus();
  };
  const field = textField({
    label: liveStrings.t("page.cover.field"),
    value: data.cover ?? "",
    lifetime: own,
    onSubmit: apply,
  });
  const actions = document.createElement("div");
  actions.className = "cm-fub-page-actions";
  const use = document.createElement("button");
  use.type = "button";
  use.className = "cm-fub-page-tool";
  use.textContent = liveStrings.t("page.cover.apply");
  own.listen(use, "click", apply);
  actions.append(use);
  if (data.cover) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cm-fub-page-tool";
    remove.textContent = liveStrings.t("page.cover.remove");
    own.listen(remove, "click", () => {
      popover.close();
      writeProperty(view, "cover", null);
      view.focus();
    });
    actions.append(remove);
  }
  body.append(field.element, actions);
  const popover = openPopover({
    anchor,
    content: body,
    label: liveStrings.t("page.cover.dialog"),
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      closed();
    },
  });
  field.focus();
  return popover;
}

/// Dove va il link alla sottopagina: in una riga vuota, se il cursore ci sta,
/// altrimenti in un paragrafo suo dopo il blocco del cursore.
export function subpageLink(state: EditorState, name: string): { from: number; insert: string; cursor: number } {
  const link = `[[${name}]]`;
  const line = state.doc.lineAt(Math.max(state.selection.main.head, bodyStart(state)));
  if (line.text.trim() === "") return { from: line.from, insert: link, cursor: line.from + link.length };
  let end = line;
  while (end.number < state.doc.lines && state.doc.line(end.number + 1).text.trim() !== "") end = state.doc.line(end.number + 1);
  const insert = `\n\n${link}`;
  return { from: end.to, insert, cursor: end.to + insert.length };
}

/// «Nuova sottopagina»: il nome, e che cosa succederà alla pagina. Se la
/// pagina non è ancora quella di una cartella, il riquadro lo dice prima di
/// «Crea»: è la domanda. A cose fatte il link `[[Nome]]` entra nel testo.
function openSubpageDialog(view: EditorView, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  let busy = false;
  const create = async () => {
    const options = view.state.facet(blocksOptions);
    const name = field.value().trim();
    if (busy || !options.subpage || name === "") return;
    busy = true;
    popover.close();
    const problem = await options.subpage(name).catch((error: unknown) => error instanceof Error ? error.message : String(error));
    if (problem) {
      options.notify?.(problem, "guasto");
      return;
    }
    if (view.state.readOnly) return;
    const at = subpageLink(view.state, name);
    view.dispatch({ changes: { from: at.from, insert: at.insert }, selection: EditorSelection.cursor(at.cursor), userEvent: "input", scrollIntoView: true });
    view.focus();
  };
  const field = textField({
    label: liveStrings.t("page.subpage.field"),
    lifetime: own,
    onSubmit: () => void create(),
  });
  const note = document.createElement("p");
  note.className = "cm-fub-page-note";
  note.textContent = liveStrings.t(data.folder ? "page.subpage.inside" : "page.subpage.move", { page: data.title });
  const actions = document.createElement("div");
  actions.className = "cm-fub-page-actions";
  const make = document.createElement("button");
  make.type = "button";
  make.className = "cm-fub-page-tool";
  make.textContent = liveStrings.t("page.subpage.create");
  own.listen(make, "click", () => void create());
  actions.append(make);
  body.append(field.element, note, actions);
  const popover = openPopover({
    anchor,
    content: body,
    label: liveStrings.t("page.subpage.dialog"),
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      closed();
    },
  });
  field.focus();
  return popover;
}

interface PageMenuItem {
  readonly id: string;
  readonly label: string;
  readonly role: "menuitemcheckbox" | "menuitemradio" | "separator";
  readonly checked: boolean;
  readonly run: () => void;
}

/// Il menu «…»: larghezza piena, testo piccolo, carattere. Scrive
/// `cssclasses` e lascia le classi che non sono sue.
function openPageMenu(view: EditorView, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const write = (change: Parameters<typeof pageClassesWith>[1]) => () => {
    popover.close();
    const next = pageClassesWith(propertyList(view.state, "cssclasses"), change);
    writeProperty(view, "cssclasses", next.length ? next : null);
    view.focus();
  };
  const font = PAGE_FONTS.find((name) => data.classes.includes(name)) ?? null;
  const items: PageMenuItem[] = [
    { id: "wide", label: liveStrings.t("page.wide"), role: "menuitemcheckbox", checked: data.classes.includes("wide"), run: write({ toggle: "wide" }) },
    { id: "small", label: liveStrings.t("page.small"), role: "menuitemcheckbox", checked: data.classes.includes("small"), run: write({ toggle: "small" }) },
    { id: "font-default", label: `${liveStrings.t("page.font")}: ${liveStrings.t("page.font.default")}`, role: "menuitemradio", checked: font === null, run: write({ font: null }) },
    ...PAGE_FONTS.map((name): PageMenuItem => ({
      id: `font-${name}`,
      label: `${liveStrings.t("page.font")}: ${liveStrings.t(`page.font.${name}`)}`,
      role: "menuitemradio",
      checked: font === name,
      run: write({ font: name }),
    })),
  ];
  const list = document.createElement("div");
  list.className = "cm-fub-block-menu";
  list.setAttribute("aria-label", liveStrings.t("page.more"));
  const handle = createList<PageMenuItem>({
    container: list,
    role: "menu",
    items,
    key: (item) => item.id,
    render: (item, row) => {
      // Il segno della scelta in vigore: l'aria lo dice con `aria-checked`.
      const check = document.createElement("span");
      check.className = "cm-fub-page-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = item.checked ? "✓" : "";
      const label = document.createElement("span");
      label.textContent = item.label;
      row.replaceChildren(check, label);
      row.setAttribute("role", item.role);
      row.setAttribute("aria-checked", String(item.checked));
    },
    onActivate: (item) => item.run(),
    focus: "roving",
    lifetime: own,
  });
  handle.setActive(items[0]!.id);
  const popover = openPopover({
    anchor,
    content: list,
    label: liveStrings.t("page.more"),
    placement: "bottom",
    align: "end",
    className: "cm-fub-block-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      closed();
    },
  });
  anchor.setAttribute("aria-expanded", "true");
  own.add(() => anchor.setAttribute("aria-expanded", "false"));
  return popover;
}

interface PageState {
  readonly data: PageData;
  readonly decorations: DecorationSet;
}

function decorate(data: PageData): PageState {
  const widget = Decoration.widget({ widget: new PageHeaderWidget(data), block: true, side: -1 });
  return { data, decorations: Decoration.set([widget.range(0)]) };
}

/// Il titolo viene dalle opzioni, che il testo non avverte quando cambiano:
/// si rilegge a ogni transazione, che costa una chiamata e un confronto.
const pageHeader = StateField.define<PageState>({
  create: (state) => decorate(pageData(state)),
  update(value, transaction) {
    const next = pageData(transaction.state);
    if (!transaction.docChanged && sameData(next, value.data)) return value;
    if (sameData(next, value.data)) return { data: value.data, decorations: value.decorations.map(transaction.changes) };
    return decorate(next);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// ↑ sulla prima riga porta al titolo, come in Notion.
const toTitle = Prec.high(keymap.of([{
  key: "ArrowUp",
  run: (view) => {
    const main = view.state.selection.main;
    if (!main.empty || view.state.selection.ranges.length > 1 || view.state.doc.lineAt(main.head).number !== 1) return false;
    const title = view.dom.querySelector<HTMLInputElement>(".cm-fub-page-title");
    if (!title) return false;
    title.focus();
    title.select();
    return true;
  },
}]));

const theme = EditorView.baseTheme({
  ".cm-fub-page": { position: "relative", margin: "0 0 0.4em", cursor: "default" },
  ".cm-fub-page-cover": {
    height: "11em",
    margin: "0 0 0.8em",
    overflow: "hidden",
    borderRadius: "8px",
    background: "rgba(135, 135, 135, 0.08)",
  },
  ".cm-fub-page-cover img": { display: "block", width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" },
  ".cm-fub-page-cover p": { margin: "0", height: "100%" },
  ".cm-fub-page-icon": {
    display: "block",
    margin: "0 0 0.1em",
    padding: "0",
    border: "none",
    background: "none",
    fontSize: "2.6em",
    lineHeight: "1.2",
    cursor: "pointer",
  },
  ".cm-fub-page-tools": { display: "flex", flexWrap: "wrap", gap: "0.25em", minHeight: "1.8em", opacity: "0" },
  ".cm-fub-page:hover .cm-fub-page-tools, .cm-fub-page:focus-within .cm-fub-page-tools": { opacity: "1" },
  ".cm-fub-page-tool": {
    padding: "0.15em 0.5em",
    border: "none",
    borderRadius: "4px",
    background: "none",
    color: "var(--doc-muted, inherit)",
    font: "inherit",
    fontSize: "0.85em",
    cursor: "pointer",
  },
  ".cm-fub-page-title": {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    margin: "0",
    padding: "0",
    border: "none",
    background: "none",
    color: "inherit",
    font: "inherit",
    fontSize: "2.1em",
    fontWeight: "700",
    lineHeight: "1.25",
  },
  ".cm-fub-page-picker": { display: "grid", gap: "0.5em", padding: "0.5em", width: "17em" },
  ".cm-fub-page-emoji": { display: "flex", flexWrap: "wrap", gap: "2px", maxHeight: "12em", overflowY: "auto" },
  ".cm-fub-page-emoji-choice": { width: "2em", height: "2em", padding: "0", border: "none", background: "none", fontSize: "1.2em", cursor: "pointer" },
  ".cm-fub-page-actions": { display: "flex", gap: "0.5em", justifyContent: "flex-end" },
});

export const pageHeaderExtension: Extension = [pageHeader, toTitle, theme];
