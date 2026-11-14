// La riga dei dati sotto il titolo, dentro l'editor Markdown: «Modificata
// 07:30 · 3 collegamenti · #tema #banco».
//
// I dati arrivano da fuori (`state/note-facts.ts`, passato dalla shell): qui
// si decide soltanto come si scrivono e dove stanno. La riga non entra mai
// nel documento: in Live è un widget di blocco dopo la riga del primo titolo
// (senza titolo, in cima al testo), nei Blocchi la mette la testata della
// pagina (`blocks/page.ts`), in Lettura la superficie la mette dopo il primo
// `h1`. In Sorgente non c'è.
//
// Un widget di blocco non si seleziona col testo, il cursore lo salta con le
// frecce e copiare non lo copia: il testo copiato è quello del documento.
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet, type Range, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { plural, t } from "../../../../i18n/strings";
import type { NoteFacts } from "../../../../state/note-facts";
import { iconEl } from "../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { relativeTime } from "../../../../ui/when";
import type { Tree } from "@lezer/common";
import { frontmatterRange } from "./render";
import { topChanges } from "./top-changes";

/// I due gesti della riga.
export interface NoteFactsActions {
  /// «3 collegamenti»: la scheda Collegamenti dell'ispettore.
  openLinks(): void;
  /// Un'etichetta: la cerca, come il clic su un tag nel testo.
  searchTag(tag: string): void;
}

/// La riga come si scrive adesso, nella lingua e all'ora di chi guarda.
/// `null` per una parte vuota.
export interface NoteFactsLabels {
  readonly modified: string | null;
  readonly links: string | null;
  readonly tags: readonly string[];
}

/// Le parole della riga; `null` se tutte e tre le parti sono vuote, e allora
/// la riga non c'è.
export function noteFactsLabels(facts: NoteFacts | null, now: number = Date.now()): NoteFactsLabels | null {
  if (!facts) return null;
  const modified = facts.modified === null ? null : t("note_facts.modified", { when: relativeTime(facts.modified, now) });
  const links = facts.links > 0 ? plural(facts.links, "note_facts.links.one", "note_facts.links", { count: facts.links }) : null;
  if (modified === null && links === null && facts.tags.length === 0) return null;
  return { modified, links, tags: facts.tags };
}

export function sameLabels(a: NoteFactsLabels | null, b: NoteFactsLabels | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.modified === b.modified && a.links === b.links
    && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
}

/// Una parte che si preme: col fuoco, e Invio o Spazio la premono una volta.
function pressable(element: HTMLElement, role: "button" | "link", run: () => void, life: Lifetime): void {
  element.tabIndex = 0;
  element.setAttribute("role", role);
  life.listen(element, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  // Il tasto fa un clic vero, come un pulsante nativo: chi ascolta i clic
  // (le tecnologie assistive, la prova da tastiera del banco) lo vede, e
  // l'azione parte una volta sola, dal ramo del clic.
  life.listen(element, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    element.click();
  });
}

function fact(iconName: string, text: string): HTMLElement {
  const part = document.createElement("span");
  part.className = "note-fact";
  const drawn = iconEl(iconName);
  if (drawn) part.append(drawn);
  const words = document.createElement("span");
  words.textContent = text;
  part.append(words);
  return part;
}

/// La riga: `div.note-facts[contenteditable=false][role=group]`, con una
/// `span.note-fact` per parte. I gesti ascoltano finché `life` è vivo.
export function renderNoteFacts(labels: NoteFactsLabels, actions: NoteFactsActions, life: Lifetime): HTMLElement {
  const row = document.createElement("div");
  row.className = "note-facts";
  row.contentEditable = "false";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", t("note_facts.label"));
  if (labels.modified !== null) row.append(fact("clock", labels.modified));
  if (labels.links !== null) {
    const links = fact("backlink", labels.links);
    links.title = t("note_facts.links.open");
    pressable(links, "button", () => actions.openLinks(), life);
    row.append(links);
  }
  if (labels.tags.length > 0) {
    const tags = document.createElement("span");
    tags.className = "note-fact note-fact-tags";
    for (const name of labels.tags) {
      const tag = document.createElement("span");
      tag.className = "note-tag";
      tag.dataset.tag = name;
      tag.textContent = `#${name}`;
      pressable(tag, "link", () => actions.searchTag(name), life);
      tags.append(tag);
    }
    row.append(tags);
  }
  return row;
}

// --- dentro CodeMirror -------------------------------------------------------

/// Chi tiene i dati per la superficie: quelli di adesso, letti quando lo
/// stato nasce (un cambio di modalità ricrea il campo), e i gesti.
export interface NoteFactsHost {
  current(): NoteFacts | null;
  readonly actions: NoteFactsActions;
}

const noteFactsHost = Facet.define<NoteFactsHost, NoteFactsHost | null>({ combine: (values) => values[0] ?? null });

/// I dati nuovi, o gli stessi da riscrivere (la lingua è cambiata).
export const noteFactsChanged = StateEffect.define<NoteFacts | null>();

interface FactsValue {
  readonly facts: NoteFacts | null;
  readonly labels: NoteFactsLabels | null;
}

function valueOf(facts: NoteFacts | null): FactsValue {
  return { facts, labels: noteFactsLabels(facts) };
}

/// I dati della nota dentro lo stato dell'editor: la Live e la testata dei
/// Blocchi li leggono da qui.
export const noteFactsField = StateField.define<FactsValue>({
  create: (state) => valueOf(state.facet(noteFactsHost)?.current() ?? null),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(noteFactsChanged)) continue;
      const next = valueOf(effect.value);
      value = sameLabels(next.labels, value.labels) ? { facts: next.facts, labels: value.labels } : next;
    }
    return value;
  },
});

/// Le parole della riga nello stato, o `null` se non c'è riga (o i dati non
/// sono montati, come in Sorgente).
export function noteFactsOf(state: EditorState): NoteFactsLabels | null {
  return state.field(noteFactsField, false)?.labels ?? null;
}

/// La riga da mettere in un widget di questo stato, o `null`.
export function noteFactsElement(state: EditorState, life: Lifetime): HTMLElement | null {
  const labels = noteFactsOf(state);
  const host = state.facet(noteFactsHost);
  return labels && host ? renderNoteFacts(labels, host.actions, life) : null;
}

const lives = new WeakMap<HTMLElement, Lifetime>();

class NoteFactsWidget extends WidgetType {
  constructor(readonly labels: NoteFactsLabels, readonly actions: NoteFactsActions) { super(); }

  override eq(other: NoteFactsWidget): boolean {
    return sameLabels(other.labels, this.labels);
  }

  toDOM(): HTMLElement {
    const life = openLifetime();
    const row = renderNoteFacts(this.labels, this.actions, life);
    lives.set(row, life);
    return row;
  }

  override destroy(dom: HTMLElement): void {
    lives.get(dom)?.close();
    lives.delete(dom);
  }

  /// La riga non è testo: puntatore e tasti restano suoi.
  override ignoreEvent(): boolean {
    return true;
  }
}

/// Il primo titolo di primo livello del testo, dopo il frontmatter: dove la
/// riga si mette, e da quale albero viene.
interface FirstHeading {
  readonly tree: Tree;
  /// Dove comincia il testo, dopo il frontmatter.
  readonly bodyFrom: number;
  readonly heading: { readonly from: number; readonly to: number } | null;
  /// Quanti nodi di primo livello l'ultimo aggiornamento ha guardato.
  readonly visited: number;
}

const isHeading1 = (name: string) => name === "ATXHeading1" || name === "SetextHeading1";

/// Il primo titolo scorrendo i nodi di primo livello dall'inizio.
function scanHeading(state: EditorState): FirstHeading {
  const front = frontmatterRange(state.doc);
  const bodyFrom = front ? front.to : 0;
  const tree = syntaxTree(state);
  const cursor = tree.cursor();
  let heading: FirstHeading["heading"] = null;
  let visited = 0;
  if (cursor.firstChild()) {
    do {
      visited++;
      if (cursor.from < bodyFrom) continue;
      if (isHeading1(cursor.name)) {
        heading = { from: cursor.from, to: cursor.to };
        break;
      }
    } while (cursor.nextSibling());
  }
  return { tree, bodyFrom, heading, visited };
}

/// Il primo titolo dopo una modifica, guardando soltanto i nodi che cambia
/// (`topChanges`). `null` quando non basta: il frontmatter si sposta, la
/// modifica non si lascia seguire, o il titolo di prima smette di esserlo e
/// quello dopo va cercato.
function nextHeading(value: FirstHeading, tr: Transaction): FirstHeading | null {
  const front = frontmatterRange(tr.state.doc);
  const bodyFrom = front ? front.to : 0;
  if (bodyFrom !== tr.changes.mapPos(value.bodyFrom)) return null;
  const changed = topChanges(tr, value.tree);
  if (!changed) return null;
  const tree = syntaxTree(tr.state);
  const visited = changed.nodes.length;
  const was = value.heading;
  // Prima del tratto riletto i nodi sono quelli di prima.
  if (was && was.to <= changed.start) return { tree, bodyFrom, heading: was, visited };
  const found = changed.nodes.find((node) => node.from >= bodyFrom && isHeading1(node.name));
  if (found) return { tree, bodyFrom, heading: { from: found.from, to: found.to }, visited };
  // Dopo il tratto i nodi sono quelli di prima, spostati.
  if (changed.resync === null) return { tree, bodyFrom, heading: null, visited };
  if (!was) return { tree, bodyFrom, heading: null, visited };
  if (was.from >= changed.resync) {
    return { tree, bodyFrom, heading: { from: was.from + changed.delta, to: was.to + changed.delta }, visited };
  }
  return null;
}

/// Dove sta la riga in Live: dopo la riga del primo titolo di primo livello,
/// e senza titolo in cima al testo (dopo il frontmatter, se c'è).
export function noteFactsPlace(state: EditorState): { at: number; side: 1 | -1 } {
  return placeOf(state, scanHeading(state));
}

function placeOf(state: EditorState, first: FirstHeading): { at: number; side: 1 | -1 } {
  if (first.heading !== null) return { at: state.doc.lineAt(first.heading.to).to, side: 1 };
  if (first.bodyFrom > 0) return { at: state.doc.lineAt(Math.max(first.bodyFrom - 1, 0)).to, side: 1 };
  return { at: 0, side: -1 };
}

interface LiveFacts {
  readonly decorations: DecorationSet;
  readonly first: FirstHeading;
}

function liveFactsOf(state: EditorState, first: FirstHeading): LiveFacts {
  const labels = noteFactsOf(state);
  const host = state.facet(noteFactsHost);
  if (!labels || !host) return { decorations: Decoration.none, first };
  const { at, side } = placeOf(state, first);
  const widget: Range<Decoration> = Decoration.widget({ widget: new NoteFactsWidget(labels, host.actions), block: true, side }).range(at);
  return { decorations: Decoration.set([widget]), first };
}

/// La riga della Live. Un campo e non un plugin, perché un widget di blocco
/// lo può dare solo lo stato; si ricalcola quando cambiano i dati, il testo o
/// l'albero (che arriva a pezzi). Il primo titolo si segue modifica per
/// modifica: una battuta non scorre la nota.
const liveFacts = StateField.define<LiveFacts>({
  create: (state) => liveFactsOf(state, scanHeading(state)),
  update(value, transaction) {
    const treeChanged = syntaxTree(transaction.state) !== value.first.tree;
    if (!transaction.docChanged && !treeChanged && !transaction.effects.some((effect) => effect.is(noteFactsChanged))) return value;
    const first = transaction.docChanged ? nextHeading(value.first, transaction) ?? scanHeading(transaction.state)
      : treeChanged ? scanHeading(transaction.state)
      : value.first;
    return liveFactsOf(transaction.state, first);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// Quanti nodi di primo livello l'ultimo aggiornamento della riga ha guardato
/// per trovare il primo titolo. Per i test, che contano il lavoro di una battuta.
export function noteFactsVisited(state: EditorState): number | null {
  return state.field(liveFacts, false)?.first.visited ?? null;
}

/// Le estensioni della riga per una superficie: `field` va montato in Live e
/// nei Blocchi (la testata ci legge), `live` solo in Live.
export interface NoteFactsExtensions {
  readonly field: Extension;
  readonly live: Extension;
}

export function noteFactsExtensions(host: NoteFactsHost): NoteFactsExtensions {
  return {
    field: [noteFactsHost.of(host), noteFactsField],
    live: liveFacts,
  };
}
