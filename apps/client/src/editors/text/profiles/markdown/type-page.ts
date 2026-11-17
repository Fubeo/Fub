// La pagina del tipo (E5, T33): in fondo alla nota di un tipo, dopo l'ultima
// riga, le note di quel tipo con le sue proprietà in evidenza.
//
// La disegna il componente delle proprietà (la vista `note_type_page`,
// `crates/fub-features/src/properties/type_page.rs`), che legge l'indice
// all'apertura e a ogni evento dell'indice, mai per battuta: qui si presta
// soltanto il posto, come per la pagina del giorno (`./day-page`), di cui
// riprende la forma e l'aspetto. Il posto è un widget di blocco dopo l'ultima
// riga, quindi la pagina non entra nel documento: non si scrive nel file (e
// quindi nemmeno nel modello che il tipo copia nelle note nuove), non si
// seleziona col testo, copiare non la copia e l'export legge il file.
//
// Che la nota sia un tipo lo si sa dopo, da una domanda al core: chi apre la
// nota lo dice con [`refreshTypePage`], che rilegge la fonte. Spento il
// componente delle proprietà la vista non è dichiarata e la pagina non c'è.
import { type EditorState, type Extension, Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { embedView } from "../../../../ui/embedded-views";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { liveStrings } from "./strings";

/// La vista del componente delle proprietà (`NOTE_TYPE_PAGE_VIEW`).
export const TYPE_PAGE_VIEW = "note_type_page";

/// Chi sa se la nota aperta è un tipo: la nota del tipo, o `null` se non lo è
/// (o non lo si sa ancora).
export interface TypePageSource {
  current(): string | null;
}

const typeSource = Facet.define<TypePageSource, TypePageSource | null>({ combine: (values) => values[0] ?? null });

/// Il contenitore della pagina e la vita della vista montata, uno per editor.
class TypePageHost {
  private element: HTMLElement | null = null;
  private life: Lifetime | null = null;
  private doc = "";

  /// Il contenitore del tipo `doc`: lo stesso finché il tipo resta quello.
  elementFor(doc: string): HTMLElement {
    if (this.element && this.doc === doc) return this.element;
    this.close();
    this.doc = doc;
    // L'aspetto è quello della pagina del giorno: lo stesso posto in fondo
    // alla nota, con gli stessi gruppi e righe.
    const page = document.createElement("section");
    page.className = "cm-day-page";
    page.dataset.typePage = "";
    page.contentEditable = "false";
    page.setAttribute("aria-label", liveStrings.t("typepage.label"));
    const body = document.createElement("div");
    body.className = "cm-day-page-body";
    const waiting = document.createElement("p");
    waiting.className = "cm-day-page-note";
    waiting.textContent = liveStrings.t("typepage.loading");
    body.append(waiting);
    page.append(body);
    const life = openLifetime();
    // Il componente delle proprietà spento: la pagina sparisce; riacceso, torna.
    embedView(TYPE_PAGE_VIEW, body, { doc }, life, {
      lost: () => { page.hidden = true; },
      found: () => { page.hidden = false; },
    });
    this.element = page;
    this.life = life;
    return page;
  }

  close(): void {
    this.life?.close();
    this.life = null;
    this.element = null;
    this.doc = "";
  }
}

const hostPlugin = ViewPlugin.fromClass(class {
  readonly host = new TypePageHost();
  destroy(): void { this.host.close(); }
});

class TypePageWidget extends WidgetType {
  constructor(readonly doc: string) { super(); }

  override eq(other: TypePageWidget): boolean {
    return other.doc === this.doc;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.plugin(hostPlugin)?.host;
    return host ? host.elementFor(this.doc) : document.createElement("section");
  }

  /// La pagina non è testo: puntatore e tasti restano suoi.
  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 160;
  }
}

interface TypeValue {
  readonly doc: string | null;
  readonly decorations: DecorationSet;
}

function decorate(state: EditorState, doc: string | null): TypeValue {
  if (!doc) return { doc, decorations: Decoration.none };
  const widget = Decoration.widget({ widget: new TypePageWidget(doc), block: true, side: 1 });
  return { doc, decorations: Decoration.set([widget.range(state.doc.length)]) };
}

/// La fonte ha cambiato idea: la nota è diventata un tipo, o non lo è più.
const reread = StateEffect.define<null>();

const typeField = StateField.define<TypeValue>({
  create: (state) => decorate(state, state.facet(typeSource)?.current() ?? null),
  update(value, transaction) {
    if (transaction.effects.some((effect) => effect.is(reread))) {
      return decorate(transaction.state, transaction.state.facet(typeSource)?.current() ?? null);
    }
    // Il widget resta dopo l'ultima riga: una modifica lo rimette in fondo,
    // con lo stesso widget (e quindi lo stesso DOM).
    return transaction.docChanged ? decorate(transaction.state, value.doc) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// La pagina del tipo in fondo alla nota, se `source` dice che è un tipo.
export function typePage(source: TypePageSource): Extension {
  return [typeSource.of(source), hostPlugin, typeField];
}

/// Rilegge la fonte: la pagina compare, sparisce o passa a un altro tipo.
/// Niente se la vista non ha la pagina o la risposta è la stessa.
export function refreshTypePage(view: EditorView): void {
  const value = view.state.field(typeField, false);
  if (!value) return;
  const next = view.state.facet(typeSource)?.current() ?? null;
  if (next === value.doc) return;
  view.dispatch({ effects: reread.of(null) });
}

/// Il tipo di cui lo stato mostra la pagina, o `null` (i test).
export function typePageOf(state: EditorState): string | null {
  return state.field(typeField, false)?.doc ?? null;
}
