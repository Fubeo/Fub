// La testata della pagina in Scrittura: l'adattatore di CodeMirror per
// `../page/header.ts`. Qui stanno il widget di blocco in cima alla nota, il
// campo che lo rifà quando cambiano frontmatter, titolo o riga dei dati, i
// tasti che entrano e escono dalla testata e i gesti che scrivono nel testo
// (una proprietà, la voce della descrizione, il link a una sottopagina).
// La testata vera, il suo DOM e i suoi riquadri sono gli stessi della Lettura.
import { EditorSelection, type EditorState, type Extension, Prec, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { propertiesDisplay } from "../../../properties-display";
import {
  addProperty,
  frontmatterOpen,
  headerShowsProperties,
  lastEntry,
  openPropertyAt,
  propertyBlock,
  propertyList,
  setProperty,
  type PropertyBlock,
} from "../properties";
import { blocksOptions, type BlocksOptions } from "./handles";
import { withLineBreaks } from "../../../line-breaks";
import { noteFactsElement, noteFactsOf, sameLabels, type NoteFactsLabels } from "../note-facts";
import { pageData as pageDataOf, pageStops, renderPageHeader, samePage, type PageData, type PageHost } from "../page/header";

export { PAGE_FONTS, pageClassesWith, type PageData, type PageFont } from "../page/header";

/// La riga dei dati mostra le etichette: allora `tags:` non è una riga della
/// testata.
function factTags(state: EditorState): boolean {
  return (noteFactsOf(state)?.tags.length ?? 0) > 0;
}

/// La testata di questo stato, con le opzioni dei Blocchi.
export function pageData(state: EditorState, options: BlocksOptions = state.facet(blocksOptions)): PageData {
  const block = propertyBlock(state);
  return pageDataOf(state, options, state.facet(propertiesDisplay), block, block ? frontmatterOpen(state, block) : false, factTags(state));
}

/// Dove comincia il testo della pagina: dopo il frontmatter, se c'è.
function bodyStart(state: EditorState): number {
  const block = propertyBlock(state);
  if (!block) return 0;
  return Math.min(state.doc.length, block.to + 1);
}

/// Scrive una proprietà della pagina con un passo d'annullamento suo.
/// Non scrive mai ciò che non saprebbe riscrivere: in un frontmatter che YAML
/// non legge non scrive niente; una voce con un commento, un'ancora, un
/// alias o in una forma che la riscrittura perderebbe non la tocca, e apre lo
/// YAML su di lei; un valore uguale a quello che c'è non lo riscrive.
function writeProperty(view: EditorView, key: string, value: string | number | readonly string[] | null): void {
  if (view.state.readOnly) return;
  const block = propertyBlock(view.state);
  if (block?.unreadable) return;
  const entry = block ? lastEntry(block.entries, key) : undefined;
  if (entry) {
    const same = value !== null && entry.value === (typeof value === "object" ? value.join(", ") : String(value));
    if (same) return;
    if (!entry.simple) {
      openPropertyAt(view, entry.from);
      return;
    }
  }
  const change = setProperty(view.state, key, value);
  if (change) view.dispatch({ changes: change, userEvent: "input" });
}

/// Una voce `key:` da scrivere: se c'è già il cursore va alla sua fine,
/// altrimenti nasce prima della chiusura (o col frontmatter, in cima) e il
/// cursore ci entra, dopo i due punti. Lo YAML si apre lì.
export function addPropertyKey(view: EditorView, key: string): void {
  const state = view.state;
  if (state.readOnly) return;
  const block = propertyBlock(state);
  const entry = block ? lastEntry(block.entries, key) : undefined;
  if (entry) {
    openPropertyAt(view, entry.from);
    return;
  }
  const line = `${key}: `;
  if (!block) {
    const at = state.doc.sliceString(0, 1) === "﻿" ? 1 : 0;
    view.dispatch({ changes: { from: at, insert: `---\n${line}\n---\n` }, selection: { anchor: at + 4 + line.length }, scrollIntoView: true, userEvent: "input" });
  } else {
    const closing = state.doc.line(block.closing);
    view.dispatch({ changes: { from: closing.from, insert: `${line}\n` }, selection: { anchor: closing.from + line.length }, scrollIntoView: true, userEvent: "input" });
  }
  view.focus();
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
  return { from: end.to, insert: withLineBreaks(state, insert), cursor: end.to + insert.length };
}

/// Rilegge la testata: dopo una rinomina il titolo è cambiato fuori dal testo.
const refreshPage = StateEffect.define<null>();

/// «Altre N proprietà» aperto o chiuso: dura quanto l'editor, e una testata
/// rifatta (una battuta nel frontmatter) lo ritrova.
const setPageMore = StateEffect.define<boolean>();
const pageMore = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => transaction.effects.reduce((open, effect) => effect.is(setPageMore) ? effect.value : open, value),
});

/// Il fuoco al testo, sulla prima riga dopo il frontmatter.
function toBody(view: EditorView): void {
  view.dispatch({ selection: EditorSelection.cursor(bodyStart(view.state)), scrollIntoView: true, userEvent: "select" });
  view.focus();
}

/// Ciò che la testata chiede, fatto sull'editor. `root` è la testata
/// disegnata: un riquadro che si chiude la rifà, se nel frattempo è cambiata.
function hostFor(view: EditorView, root: HTMLElement): PageHost {
  const options = view.state.facet(blocksOptions);
  const subpage = options.subpage;
  return {
    writing: true,
    mountImage: options.mountImage,
    writeProperty: (key, value) => writeProperty(view, key, value),
    classes: () => propertyList(view.state, "cssclasses"),
    rename: options.rename,
    notify: options.notify,
    subpage: subpage ? async (name) => {
      const problem = await subpage(name).catch((error: unknown) => error instanceof Error ? error.message : String(error));
      if (problem) {
        view.state.facet(blocksOptions).notify?.(problem, "guasto");
        return;
      }
      if (view.state.readOnly) return;
      const at = subpageLink(view.state, name);
      view.dispatch({ changes: { from: at.from, insert: at.insert }, selection: EditorSelection.cursor(at.cursor), userEvent: "input", scrollIntoView: true });
      view.focus();
    } : undefined,
    openProperty: (at) => void openPropertyAt(view, at),
    addProperty: () => {
      if (addProperty({ state: view.state, dispatch: (transaction) => view.dispatch(transaction) })) view.focus();
    },
    addDescription: () => addPropertyKey(view, "description"),
    toBody: () => toBody(view),
    focusText: () => view.focus(),
    refresh: () => view.dispatch({ effects: refreshPage.of(null) }),
    measure: () => view.requestMeasure(),
    more: {
      get open() { return view.state.field(pageMore, false) ?? false; },
      set: (open) => view.dispatch({ effects: setPageMore.of(open) }),
    },
    popover: (open) => {
      const shown = drawn.get(root);
      if (!shown) return;
      shown.popover = open;
      // Chiuso il riquadro, la testata rimasta indietro si rifà adesso.
      if (!open && shown.pending && !shown.closing && root.isConnected) {
        const data = view.state.field(pageHeader, false)?.data;
        if (data) draw(root, view, data);
      }
    },
  };
}

/// Una testata disegnata: ciò che mostra, la sua vita, quella della riga dei
/// dati, e se ha un riquadro aperto (allora non si rifà: `pending`).
interface Drawn {
  data: PageData;
  life: Lifetime;
  facts: Lifetime;
  popover: boolean;
  pending: boolean;
  closing: boolean;
}
const drawn = new WeakMap<HTMLElement, Drawn>();

/// Il controllo col fuoco, riconosciuto dopo un rifacimento: la classe, e il
/// testo che porta (lo stesso pulsante in una testata nuova).
function focusKey(element: Element): string {
  return `${element.className}\u0000${element.getAttribute("aria-label") ?? element.textContent ?? ""}`;
}

/// Disegna `data` in `root`, al posto della testata che c'era. Ciò che si sta
/// facendo resta: il titolo che si scrive (valore, selezione, fuoco) e il
/// fuoco su un pulsante che c'è ancora. La vita vecchia si chiude prima di
/// togliere il campo, così la sua uscita non rinomina.
function draw(root: HTMLElement, view: EditorView, data: PageData): void {
  const before = drawn.get(root);
  const active = root.ownerDocument.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? active : null;
  const title = root.querySelector<HTMLInputElement>("input.cm-fub-page-title");
  const typed = title && before && title.value !== before.data.title
    ? { value: title.value, start: title.selectionStart, end: title.selectionEnd, direction: title.selectionDirection }
    : null;
  const key = focused ? focusKey(focused) : null;
  if (before) {
    before.closing = true;
    before.facts.close();
    before.life.close();
  }
  const life = openLifetime();
  const facts = openLifetime();
  life.add(() => drawn.get(root)?.facts.close());
  drawn.set(root, { data, life, facts, popover: false, pending: false, closing: false });
  renderPageHeader(data, hostFor(view, root), life, root);
  placeFacts(root, view, facts);
  const field = root.querySelector<HTMLInputElement>("input.cm-fub-page-title");
  if (field && typed && !field.readOnly) {
    field.value = typed.value;
    if (focused === title) field.setSelectionRange(typed.start, typed.end, typed.direction ?? undefined);
  }
  if (focused === title && field) {
    field.focus({ preventScroll: true });
  } else if (key) {
    const same = [...root.querySelectorAll<HTMLElement>("button, input, [tabindex]")].find((element) => focusKey(element) === key);
    (same ?? null)?.focus({ preventScroll: true });
  }
}

/// Mette in fondo alla testata la riga dei dati dello stato, al posto di
/// quella che c'era; la sua vita è `facts`, chiusa a ogni rifacimento.
function placeFacts(root: HTMLElement, view: EditorView, facts: Lifetime): void {
  root.querySelector(":scope > .note-facts")?.remove();
  const row = noteFactsElement(view.state, facts);
  if (row) root.append(row);
}

class PageHeaderWidget extends WidgetType {
  constructor(readonly data: PageData, readonly facts: NoteFactsLabels | null) { super(); }

  override eq(other: PageHeaderWidget): boolean {
    return samePage(other.data, this.data) && sameLabels(other.facts, this.facts);
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    draw(root, view, this.data);
    return root;
  }

  /// La testata si aggiorna sul posto. Cambiata solo la riga dei dati, si
  /// rifà la riga. Cambiato altro (il frontmatter scritto da un altro
  /// riquadro, una rinomina), si rifà la testata e il titolo che si sta
  /// scrivendo resta; con un riquadro aperto (l'icona, la copertina) si
  /// aspetta che si chiuda, perché non sparisca sotto le mani.
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const before = drawn.get(dom);
    if (!before) return false;
    if (samePage(before.data, this.data)) {
      before.facts.close();
      before.facts = openLifetime();
      placeFacts(dom, view, before.facts);
      return true;
    }
    if (before.popover) {
      before.pending = true;
      return true;
    }
    draw(dom, view, this.data);
    return true;
  }

  override destroy(dom: HTMLElement): void {
    const shown = drawn.get(dom);
    if (shown) {
      shown.closing = true;
      shown.life.close();
    }
    drawn.delete(dom);
  }

  /// La testata è un modulo, non testo: tasti e puntatore restano suoi.
  override ignoreEvent(): boolean {
    return true;
  }
}

interface PageState {
  readonly data: PageData;
  readonly facts: NoteFactsLabels | null;
  /// Il frontmatter letto: si rilegge solo quando una modifica lo tocca.
  readonly block: PropertyBlock | null;
  readonly decorations: DecorationSet;
}

function compute(state: EditorState, block: PropertyBlock | null): PageState {
  const data = pageDataOf(state, state.facet(blocksOptions), state.facet(propertiesDisplay), block, block ? frontmatterOpen(state, block) : false, factTags(state));
  const facts = noteFactsOf(state);
  const widget = Decoration.widget({ widget: new PageHeaderWidget(data, facts), block: true, side: -1 });
  return { data, facts, block, decorations: Decoration.set([widget.range(0)]) };
}

/// Una modifica che può cambiare il frontmatter: dentro di lui o subito
/// dopo; senza frontmatter, sulla prima riga, o dovunque se la prima riga è
/// già un `---` che aspetta la sua chiusura.
function frontmatterTouched(block: PropertyBlock | null, transaction: Transaction): boolean {
  if (!transaction.docChanged) return false;
  if (block) return transaction.changes.touchesRange(0, block.to + 1) !== false;
  const first = transaction.startState.doc.line(1);
  if (first.text.replace(/^﻿/, "").trim() === "---") return true;
  return transaction.changes.touchesRange(0, first.to + 1) !== false;
}

/// Il titolo viene dalle opzioni, che il testo non avverte quando cambiano:
/// si rilegge a ogni transazione, che costa una chiamata e un confronto. Il
/// frontmatter si rilegge soltanto quando una modifica lo tocca: una battuta
/// nel testo non lo ripassa.
const pageHeader = StateField.define<PageState>({
  create: (state) => compute(state, propertyBlock(state)),
  update(value, transaction) {
    const state = transaction.state;
    const touched = frontmatterTouched(value.block, transaction);
    const block = touched ? propertyBlock(state) : value.block;
    const options = state.facet(blocksOptions);
    // Un cursore che entra nel frontmatter o ne esce apre e chiude lo YAML;
    // ogni altro movimento lascia la testata com'è.
    const opened = value.data.properties !== null && block !== null && frontmatterOpen(state, block) !== value.data.properties.open;
    const still = !touched && !opened && transaction.effects.length === 0
      && transaction.startState.facet(propertiesDisplay) === state.facet(propertiesDisplay)
      && transaction.startState.readOnly === state.readOnly
      && transaction.startState.facet(blocksOptions) === options
      && (options.page?.() ?? "") === value.data.title
      && (options.folderPage?.() ?? false) === value.data.folder;
    if (still) return transaction.docChanged ? { ...value, decorations: value.decorations.map(transaction.changes) } : value;
    const next = compute(state, block);
    if (samePage(next.data, value.data) && sameLabels(next.facts, value.facts)) {
      return { data: value.data, facts: value.facts, block, decorations: value.decorations.map(transaction.changes) };
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// La prima riga che si vede: dopo il frontmatter quando la testata lo
/// copre, altrimenti la prima del file.
function firstVisibleLine(state: EditorState): number {
  const block = state.field(pageHeader, false)?.block ?? null;
  if (!block || block.unreadable || frontmatterOpen(state, block)) return 1;
  return state.doc.lineAt(Math.min(state.doc.length, block.to + 1)).number;
}

/// ↑ sulla prima riga torna su, nella testata: sull'ultima voce, che dal
/// titolo in giù è la più vicina al testo (come in Notion).
const toHeader = Prec.high(keymap.of([{
  key: "ArrowUp",
  run: (view) => {
    const main = view.state.selection.main;
    if (!main.empty || view.state.selection.ranges.length > 1) return false;
    if (view.state.doc.lineAt(main.head).number > firstVisibleLine(view.state)) return false;
    const header = view.dom.querySelector<HTMLElement>(".cm-fub-page");
    const stops = header ? pageStops(header) : [];
    const last = stops[stops.length - 1];
    if (!last) return false;
    last.focus();
    if (last instanceof HTMLInputElement) last.select();
    return true;
  },
}]));

/// Le regole dei riquadri della testata, che si aprono fuori dal foglio. La
/// testata stessa la disegna la pelle (`skin/document.css`), in Scrittura e
/// in Lettura.
const theme = EditorView.baseTheme({
  ".cm-fub-page-picker": { display: "grid", gap: "0.5em", padding: "0.5em", width: "17em" },
  ".cm-fub-page-emoji": { display: "flex", flexWrap: "wrap", gap: "2px", maxHeight: "12em", overflowY: "auto" },
  ".cm-fub-page-emoji-choice > svg": { width: "1em", height: "1em", verticalAlign: "-0.1em" },
  ".cm-fub-page-emoji-choice": { width: "2em", height: "2em", padding: "0", border: "none", background: "none", fontSize: "1.2em", cursor: "pointer" },
  ".cm-fub-page-actions": { display: "flex", gap: "0.5em", justifyContent: "flex-end" },
});

export const pageHeaderExtension: Extension = [pageMore, pageHeader, headerShowsProperties.of(true), toHeader, theme];
