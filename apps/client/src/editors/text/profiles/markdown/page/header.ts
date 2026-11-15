// La testata della pagina (E3, H12, H13), la stessa in Scrittura e in
// Lettura: in quest'ordine la copertina, l'icona, il titolo, le proprietà in
// evidenza, «Altre N proprietà», «Aggiungi una proprietà» e la riga dei dati.
// In Sorgente non c'è: il frontmatter si legge com'è.
//
// Il titolo è il nome del file, e per la pagina di una cartella
// (`X/_index.md`, decisione 0229) il nome della cartella: in Scrittura si
// scrive in riga, e cambiarlo è una rinomina. Icona, copertina, larghezza e
// carattere stanno nel frontmatter, scritti col codice delle proprietà
// (toppe mirate: commenti e ordine del YAML restano). Il file resta
// Markdown, e Sorgente mostra le stesse righe.
//
// Qui c'è soltanto il DOM e i suoi gesti, detti a un `PageHost`: chi ospita la
// testata (l'adattatore di CodeMirror, `../blocks/page.ts`, o la Lettura,
// `mountReadingHeader`) sa scrivere, rinominare e portare il cursore.
import type { EditorState } from "@codemirror/state";
import { createList, openPopover, textField, type PopoverHandle } from "../../../../../kit";
import { catalogLanguage, resolvedLanguage, t } from "../../../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { iconEl } from "../../../../../ui/icons";
import { drawPageMark, figureLabel, figureValue, PAGE_FIGURES, pageMarkLabel, pageMarkValue } from "../../../../../ui/page-mark";
import { markPresence } from "../../../../core/presence";
import type { PropertiesDisplay } from "../../../properties-display";
import { matchEmoji } from "../completions";
import { lastEntry, listItems, propertyBlock, type PropertyBlock } from "../properties";
import { liveStrings } from "../strings";
import { coverElement, coverYOf } from "./cover";
import { featuredProperties, propertiesElement, samePageProperties, type PageProperties } from "./featured";

export type { PageProperties } from "./featured";

/// Le classi della pagina che il menu «…» scrive in `cssclasses`; il tema le
/// applica al riquadro (`fub-note--*`). Le altre classi della nota restano.
export const PAGE_FONTS = ["serif", "sans", "mono"] as const;
export type PageFont = (typeof PAGE_FONTS)[number];

/// Ciò che la testata sa della pagina da chi la ospita.
export interface PageOptions {
  /// Il nome della pagina: il titolo.
  readonly page?: () => string | null;
  /// Dice all'utente com'è andata un'azione che non si vede nel testo.
  readonly notify?: (message: string, tone: "info" | "guasto") => void;
  /// La nota è la pagina di una cartella (`X/_index.md`).
  readonly folderPage?: () => boolean;
  /// Rinomina la pagina: `null` se è andata, altrimenti il perché no.
  readonly rename?: (name: string) => Promise<string | null>;
  /// Monta un'immagine (l'HTML della resa) e ne dà lo smontaggio.
  readonly mountImage?: (root: HTMLElement, html: string) => () => void;
  /// «Nuova sottopagina»: `null` se è andata, altrimenti il perché no.
  readonly subpage?: (name: string) => Promise<string | null>;
}

/// Ciò che la testata mostra, letto dallo stato e dalle opzioni.
export interface PageData {
  readonly title: string;
  readonly folder: boolean;
  readonly icon: string | null;
  readonly cover: string | null;
  /// `cover-y:`, da 0 a 100; `null` il centro.
  readonly coverY: number | null;
  readonly classes: readonly string[];
  readonly description: boolean;
  readonly readOnly: boolean;
  readonly renamable: boolean;
  readonly subpages: boolean;
  /// Il frontmatter non si legge: la testata lo dice e non ci scrive.
  readonly unreadable: boolean;
  /// Le proprietà della testata; `null` in `source`, dove resta lo YAML.
  readonly properties: PageProperties | null;
}

/// La testata di questo stato. `block` è il frontmatter già letto, se chi
/// chiama lo ha; `factTags` dice che la riga dei dati mostra le etichette (se
/// no, `tags:` è una proprietà come le altre).
export function pageData(
  state: EditorState,
  options: PageOptions,
  display: PropertiesDisplay,
  block: PropertyBlock | null = propertyBlock(state),
  open = false,
  factTags = false,
): PageData {
  const entries = block?.entries ?? [];
  const value = (key: string) => lastEntry(entries, key)?.value ?? null;
  const split = featuredProperties(entries, factTags);
  const unreadable = block?.unreadable ?? false;
  return {
    title: options.page?.() ?? "",
    folder: options.folderPage?.() ?? false,
    // Un'emoji o una figura (`icon: fub:book`); un path o un indirizzo
    // scritto da un'altra app non è un'icona (`page-mark.ts`).
    icon: pageMarkValue(value("icon")),
    cover: value("cover")?.trim() || null,
    coverY: coverYOf(value("cover-y")),
    classes: listItems(value("cssclasses")),
    description: entries.some((entry) => entry.key === "description"),
    readOnly: state.readOnly,
    renamable: options.rename !== undefined,
    subpages: options.subpage !== undefined,
    unreadable,
    // Un frontmatter che non si legge la testata lo dice anche in `source`:
    // gli strumenti tacciono, e la ragione si legge lì.
    properties: display === "source" && !unreadable ? null : {
      display: display === "hidden" ? "hidden" : "visible",
      featured: split.featured,
      rest: split.rest,
      unreadable,
      open,
    },
  };
}

/// La stessa testata, a parte la riga dei dati.
export function samePage(a: PageData, b: PageData): boolean {
  return a.title === b.title && a.folder === b.folder && a.icon === b.icon && a.cover === b.cover
    && a.coverY === b.coverY && a.description === b.description
    && a.readOnly === b.readOnly && a.renamable === b.renamable && a.subpages === b.subpages
    && a.unreadable === b.unreadable
    && a.classes.length === b.classes.length && a.classes.every((name, i) => name === b.classes[i])
    && samePageProperties(a.properties, b.properties);
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

/// Chi ospita la testata: Scrittura (l'editor) o Lettura.
export interface PageHost {
  /// Scrittura: il titolo è un campo, gli strumenti compaiono al passaggio.
  /// Lettura: la testata si guarda.
  readonly writing: boolean;
  readonly mountImage?: (root: HTMLElement, html: string) => () => void;
  /// Scrive (o toglie, con `null`) una proprietà della pagina, con un passo
  /// d'annullamento suo.
  writeProperty(key: string, value: string | number | readonly string[] | null): void;
  /// Le classi della pagina adesso, per il menu «…».
  classes(): readonly string[];
  /// Rinomina col titolo scritto; `null` se è andata.
  rename?(name: string): Promise<string | null>;
  notify?(message: string, tone: "info" | "guasto"): void;
  /// «Nuova sottopagina»: crea, scrive il link e dice com'è andata.
  subpage?(name: string): Promise<void>;
  /// Il valore di una proprietà premuto: lo YAML si apre su quella voce.
  openProperty(at: number): void;
  /// «Aggiungi una proprietà».
  addProperty(): void;
  /// «Aggiungi una descrizione»: la voce `description:` da scrivere.
  addDescription(): void;
  /// ↓ dall'ultima voce della testata, Invio ed Esc dal titolo: al testo.
  toBody(): void;
  /// Dopo una scelta in un riquadro: il fuoco torna al testo.
  focusText(): void;
  /// Il titolo è cambiato fuori dal testo (una rinomina riuscita).
  refresh(): void;
  /// L'altezza della testata è cambiata.
  measure(): void;
  /// «Altre N proprietà» aperto o chiuso.
  readonly more: { readonly open: boolean; set(open: boolean): void };
  /// Un riquadro della testata (icona, copertina, sottopagina, «…») si è
  /// aperto o chiuso: chi ospita non rifà la testata sotto un riquadro aperto.
  popover?(open: boolean): void;
}

/// La testata di `data`, in `root` (svuotata) o in un elemento nuovo. Ogni
/// ascoltatore e ogni riquadro aperto vivono in `life`.
export function renderPageHeader(data: PageData, host: PageHost, life: Lifetime, root: HTMLElement = document.createElement("div")): HTMLElement {
  const editable = host.writing && !data.readOnly;
  // In un frontmatter che non si legge non si scrive niente: niente
  // strumenti, niente icona da cambiare, niente copertina da spostare.
  const writable = editable && !data.unreadable;
  root.replaceChildren();
  root.removeAttribute("aria-busy");
  root.className = "cm-fub-page";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", liveStrings.t("page.label"));
  if (data.cover) root.dataset.cover = "true";
  else delete root.dataset.cover;
  let popover: PopoverHandle | null = null;
  const closePopover = () => {
    popover?.close();
    popover = null;
  };
  life.add(closePopover);
  const opener = (open: typeof openIconPicker) => (anchor: HTMLElement) => {
    closePopover();
    host.popover?.(true);
    popover = open(host, anchor, data, life, () => {
      popover = null;
      host.popover?.(false);
    });
  };
  const iconButton = opener(openIconPicker);
  const coverButton = opener(openCoverDialog);
  const subpageButton = opener(openSubpageDialog);
  // Gli strumenti che la riga ha nascosto perché non ci stavano: il menu «⋯»
  // li offre in cima, e li apre dallo stesso «⋯».
  let crowded: () => readonly PageMenuAction[] = () => [];
  const moreButton = opener((host, anchor, data, life, closed) => openPageMenu(host, anchor, data, life, closed, crowded()));

  if (data.cover) {
    root.append(coverElement(data.cover, data.coverY, {
      editable: writable,
      mountImage: host.mountImage,
      change: coverButton,
      reposition: (y) => host.writeProperty("cover-y", y),
      measure: () => host.measure(),
    }, life));
  }

  // Un `fub:` che questa versione non sa disegnare non si mostra, e torna
  // «Aggiungi un'icona» per sceglierne un'altra.
  const label = pageMarkLabel(data.icon);
  if (data.icon && label !== null) {
    const icon = document.createElement(host.writing ? "button" : "span");
    icon.className = "cm-fub-page-icon";
    drawPageMark(icon, data.icon);
    if (icon instanceof HTMLButtonElement) {
      icon.type = "button";
      icon.setAttribute("aria-label", liveStrings.t("page.icon.change", { icon: label }));
      icon.disabled = !writable;
      life.listen(icon, "click", () => iconButton(icon));
    } else {
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", label);
    }
    root.append(icon);
  }

  if (writable) {
    const tools = document.createElement("div");
    tools.className = "cm-fub-page-tools";
    markPresence(tools, "hover");
    // Come nel prototipo: la figura davanti, poi il nome.
    const actions = new Map<HTMLButtonElement, PageMenuAction>();
    const tool = (icon: string | null, text: string, run: (button: HTMLButtonElement) => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-fub-page-tool";
      if (text) actions.set(button, { id: `tool-${actions.size}`, label: text, run });
      const figure = icon ? iconEl(icon) : null;
      figure?.setAttribute("aria-hidden", "true");
      // Senza la figura (il set non la porta) resta il nome, o «⋯».
      const name = document.createElement("span");
      name.textContent = text || (figure ? "" : "⋯");
      button.replaceChildren(...(figure ? [figure] : []), ...(name.textContent ? [name] : []));
      life.listen(button, "click", () => run(button));
      tools.append(button);
      return button;
    };
    if (label === null) tool("fmt-icon", liveStrings.t("page.icon.add"), iconButton);
    if (!data.cover) tool("fmt-cover", liveStrings.t("page.cover.add"), coverButton);
    if (!data.description) tool("fmt-text", liveStrings.t("page.description.add"), () => host.addDescription());
    if (data.subpages) tool("notes", liveStrings.t("page.subpage.add"), subpageButton);
    const more = tool("fmt-more", "", moreButton);
    more.classList.add("cm-fub-page-more");
    more.setAttribute("aria-label", liveStrings.t("page.more"));
    more.setAttribute("aria-haspopup", "menu");
    root.append(tools);
    crowded = () => [...actions].filter(([button]) => button.hidden).map(([, action]) => action);
    fitTools(tools, more, life);
  }

  root.append(host.writing ? titleField(data, host, root, life) : titleHeading(data));

  if (data.properties) {
    const section = propertiesElement(data.properties, {
      editable: writable,
      open: (at) => host.openProperty(at),
      add: () => host.addProperty(),
      more: host.more,
      measure: () => host.measure(),
    }, life);
    if (section) root.append(section);
  }

  // ↑ ↓ fra il titolo e le voci della testata; dall'ultima, il testo.
  if (host.writing) {
    life.listen(root, "keydown", (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const stops = pageStops(root);
      const index = stops.indexOf(event.target as HTMLElement);
      if (index === -1) return;
      event.preventDefault();
      event.stopPropagation();
      const next = stops[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
      else if (event.key === "ArrowDown") host.toBody();
    });
  }
  return root;
}

/// I posti della testata dove si ferma ↑ ↓: il titolo, i valori delle
/// proprietà, «Altre N» e «Aggiungi una proprietà».
export function pageStops(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-page-nav]")];
}

/// Il titolo in Lettura: il nome, come intestazione.
function titleHeading(data: PageData): HTMLElement {
  const title = document.createElement("div");
  title.className = "cm-fub-page-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "1");
  title.textContent = data.title;
  return title;
}

/// Il titolo in Scrittura: un campo. Invio o l'uscita rinominano, Esc torna
/// al nome di prima; Invio ed Esc portano al testo.
function titleField(data: PageData, host: PageHost, root: HTMLElement, life: Lifetime): HTMLInputElement {
  const title = document.createElement("input");
  title.type = "text";
  title.className = "cm-fub-page-title";
  title.dataset.pageNav = "";
  title.value = data.title;
  title.spellcheck = false;
  title.autocomplete = "off";
  title.setAttribute("aria-label", liveStrings.t("page.title"));
  title.title = liveStrings.t(data.folder ? "page.title.folder" : "page.title.file");
  title.readOnly = data.readOnly || !data.renamable || !host.rename;
  let busy = false;
  const commit = async (): Promise<void> => {
    const name = title.value.trim();
    if (busy || title.readOnly || !host.rename) return;
    if (name === "" || name === data.title) {
      title.value = data.title;
      return;
    }
    busy = true;
    title.readOnly = true;
    root.setAttribute("aria-busy", "true");
    const problem = await host.rename(name).catch((error: unknown) => error instanceof Error ? error.message : String(error));
    busy = false;
    root.removeAttribute("aria-busy");
    if (life.closed) return;
    title.readOnly = false;
    if (problem) {
      title.value = data.title;
      host.notify?.(problem, "guasto");
      return;
    }
    host.refresh();
  };
  life.listen(title, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void commit();
      host.toBody();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      title.value = data.title;
      host.toBody();
    }
  });
  life.listen(title, "blur", () => void commit());
  return title;
}

/// La scelta dell'icona: un campo che cerca fra le emoji (italiano e inglese)
/// e la griglia dei risultati; «Togli l'icona» se ce n'è una.
function openIconPicker(host: PageHost, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  const grid = document.createElement("div");
  grid.className = "cm-fub-page-emoji";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", liveStrings.t("page.icon.picker"));
  // Le figure del set, prima delle emoji come nel selettore dell'esplora:
  // scritte nel frontmatter come `icon: fub:<nome>`. La ricerca le filtra per
  // nome, come le emoji.
  const figures = document.createElement("div");
  figures.className = "cm-fub-page-emoji cm-fub-page-figures";
  figures.setAttribute("role", "group");
  figures.setAttribute("aria-label", t("icons.figures"));
  // Una figura che nessuno disegna adesso (la stella senza la cornice) non
  // si offre.
  const figureButtons = PAGE_FIGURES.flatMap((name) => {
    const drawn = iconEl(name);
    if (!drawn) return [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-fub-page-emoji-choice";
    button.dataset.icon = figureValue(name);
    button.append(drawn);
    button.setAttribute("aria-label", figureLabel(name));
    button.title = figureLabel(name);
    own.listen(button, "click", () => choose(figureValue(name)));
    figures.append(button);
    return [{ name, button }];
  });
  const language = catalogLanguage(resolvedLanguage()) === "it" ? "it" : "en";
  let first: string | null = null;
  const choose = (char: string | null) => {
    popover.close();
    host.writeProperty("icon", char);
    host.focusText();
  };
  let asked = 0;
  const show = (query: string) => {
    const question = ++asked;
    const wanted = query.trim().toLocaleLowerCase();
    let shown = 0;
    for (const { name, button } of figureButtons) {
      button.hidden = wanted !== "" && !figureLabel(name).toLocaleLowerCase().includes(wanted) && !name.includes(wanted);
      if (!button.hidden) shown++;
    }
    figures.hidden = shown === 0;
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
  body.append(search.element, figures, grid);
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

/// La copertina: un'immagine del vault (il path, come in `![](…)`), un colore
/// (`#a3c4f3`) o un indirizzo; «Togli la copertina» se ce n'è una.
function openCoverDialog(host: PageHost, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  const apply = () => {
    const value = field.value().trim();
    popover.close();
    host.writeProperty("cover", value || null);
    host.focusText();
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
      host.writeProperty("cover", null);
      host.focusText();
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

/// «Nuova sottopagina»: il nome, e che cosa succederà alla pagina. Se la
/// pagina non è ancora quella di una cartella, il riquadro lo dice prima di
/// «Crea»: è la domanda. A cose fatte chi ospita scrive il link.
function openSubpageDialog(host: PageHost, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker";
  let busy = false;
  const create = async () => {
    const name = field.value().trim();
    if (busy || !host.subpage || name === "") return;
    busy = true;
    popover.close();
    await host.subpage(name);
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
  readonly role: "menuitem" | "menuitemcheckbox" | "menuitemradio" | "separator";
  readonly checked: boolean;
  readonly run: () => void;
}

/// Uno strumento della testata, come voce del menu «⋯» quando la riga non
/// ha posto per lui: `run` riceve il pulsante da cui aprire il suo riquadro.
interface PageMenuAction {
  readonly id: string;
  readonly label: string;
  readonly run: (anchor: HTMLButtonElement) => void;
}

/// La riga degli strumenti è una riga sola, alta 28 px come nel prototipo:
/// quando i pulsanti non ci stanno, si nascondono dalla fine (non «⋯», che
/// resta l'ultimo) e il menu «⋯» li offre. Si rifà a ogni cambio di
/// larghezza; un pulsante nascosto torna appena c'è posto.
export function fitTools(tools: HTMLElement, more: HTMLButtonElement, life: Lifetime): void {
  const fit = () => {
    const buttons = [...tools.querySelectorAll<HTMLButtonElement>(":scope > .cm-fub-page-tool")].filter((button) => button !== more);
    for (const button of buttons) button.hidden = false;
    for (let index = buttons.length - 1; index >= 0 && tools.scrollWidth > tools.clientWidth + 1; index -= 1) {
      buttons[index]!.hidden = true;
    }
  };
  fit();
  if (typeof ResizeObserver !== "function") return;
  let width = -1;
  const observer = new ResizeObserver(() => {
    const next = tools.clientWidth;
    if (next === width) return;
    width = next;
    fit();
  });
  observer.observe(tools);
  life.add(() => observer.disconnect());
}

/// Il menu «…»: larghezza piena, testo piccolo, carattere. Scrive
/// `cssclasses` e lascia le classi che non sono sue.
function openPageMenu(host: PageHost, anchor: HTMLElement, data: PageData, life: Lifetime, closed: () => void, crowded: readonly PageMenuAction[] = []): PopoverHandle {
  const own = openLifetime();
  const write = (change: Parameters<typeof pageClassesWith>[1]) => () => {
    popover.close();
    const next = pageClassesWith(host.classes(), change);
    host.writeProperty("cssclasses", next.length ? next : null);
    host.focusText();
  };
  const font = PAGE_FONTS.find((name) => data.classes.includes(name)) ?? null;
  const items: PageMenuItem[] = [
    ...crowded.map((action): PageMenuItem => ({
      id: action.id,
      label: action.label,
      role: "menuitem",
      checked: false,
      run: () => {
        popover.close();
        if (anchor instanceof HTMLButtonElement && anchor.isConnected) action.run(anchor);
      },
    })),
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
      const text = document.createElement("span");
      text.textContent = item.label;
      row.replaceChildren(check, text);
      row.setAttribute("role", item.role);
      if (item.role === "menuitem") row.removeAttribute("aria-checked");
      else row.setAttribute("aria-checked", String(item.checked));
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

/// La testata della Lettura: si mette in cima alla resa di `reading`, prima
/// di tutto, e ci resta quando la resa si rifà da sé (un embed arrivato:
/// `data-md-pinned`, `mount.ts`). Il frontmatter reso
/// (`block-frontmatter-unparsed`) lo nasconde la pelle quando le proprietà
/// stanno nella testata (`data-page-props` sul contenitore); in `source` e
/// quando non si legge resta, sotto il titolo. Dà lo smontaggio.
export function mountReadingHeader(
  reading: HTMLElement,
  state: EditorState,
  options: PageOptions,
  display: PropertiesDisplay,
  more: PageHost["more"],
  factTags = false,
): () => void {
  const life = openLifetime();
  const block = propertyBlock(state);
  const data = pageData(state, options, display, block, false, factTags);
  const noop = () => {};
  const root = renderPageHeader(data, {
    writing: false,
    mountImage: options.mountImage,
    writeProperty: noop,
    classes: () => data.classes,
    openProperty: noop,
    addProperty: noop,
    addDescription: noop,
    toBody: noop,
    focusText: noop,
    refresh: noop,
    measure: noop,
    more,
  }, life);
  root.dataset.mdPinned = "";
  reading.prepend(root);
  if (block && data.properties && !block.unreadable) reading.dataset.pageProps = "header";
  return () => {
    life.close();
    root.remove();
    delete reading.dataset.pageProps;
  };
}
