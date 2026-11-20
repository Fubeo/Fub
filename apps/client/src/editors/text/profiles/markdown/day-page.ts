// La pagina del giorno (E17, T39): in fondo alla giornaliera, dopo l'ultima
// riga, i compiti che scadono quel giorno, le note con quella data in una
// proprietà e le note cambiate quel giorno.
//
// La disegna il componente dei template (la vista `day_page`,
// `crates/fub-features/src/template/view/day.rs`), che legge l'indice
// all'apertura e a ogni evento dell'indice, mai per battuta: qui si presta
// soltanto il posto. Il posto è un widget di blocco dopo l'ultima riga, quindi
// la pagina non entra nel documento: non si scrive nel file, non si seleziona
// col testo, copiare non la copia e l'export legge il file.
//
// Il contenitore vive quanto l'editor, non quanto il widget: CodeMirror toglie
// dal DOM un widget che esce dalla vista, e rimontare la vista a ogni
// scorrimento vorrebbe dire rileggere l'indice per niente. Spento il
// componente dei template, la vista non è dichiarata e la pagina non c'è.
import { type EditorState, type Extension, Facet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { embedView } from "../../../../ui/embedded-views";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { liveStrings } from "./strings";

/// La vista del componente dei template (`DAY_PAGE_VIEW`).
export const DAY_PAGE_VIEW = "day_page";

/// La giornaliera aperta: la nota e il giorno che il suo nome dice.
export interface DayPageTarget {
  readonly doc: string;
  /// `AAAA-MM-GG`.
  readonly date: string;
}

/// Chi sa se la nota aperta è una giornaliera: letto quando lo stato nasce
/// (un cambio di modalità ricrea il campo). `null`: non lo è, e la pagina non
/// c'è.
export interface DayPageSource {
  current(): DayPageTarget | null;
}

const daySource = Facet.define<DayPageSource, DayPageSource | null>({ combine: (values) => values[0] ?? null });

/// Il contenitore della pagina e la vita della vista montata, uno per editor.
class DayPageHost {
  private element: HTMLElement | null = null;
  private life: Lifetime | null = null;
  private key = "";

  /// Il contenitore della giornaliera `target`: lo stesso finché la nota e il
  /// giorno restano quelli.
  elementFor(target: DayPageTarget): HTMLElement {
    const key = `${target.doc}\n${target.date}`;
    if (this.element && this.key === key) return this.element;
    this.close();
    this.key = key;
    const page = document.createElement("section");
    page.className = "cm-day-page";
    page.contentEditable = "false";
    page.setAttribute("aria-label", liveStrings.t("daypage.label"));
    const body = document.createElement("div");
    body.className = "cm-day-page-body";
    const waiting = document.createElement("p");
    waiting.className = "cm-day-page-note";
    waiting.textContent = liveStrings.t("daypage.loading");
    body.append(waiting);
    page.append(body);
    const life = openLifetime();
    // Il componente dei template spento: la pagina sparisce; riacceso, torna.
    embedView(DAY_PAGE_VIEW, body, { doc: target.doc, date: target.date }, life, {
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
    this.key = "";
  }
}

const hostPlugin = ViewPlugin.fromClass(class {
  readonly host = new DayPageHost();
  destroy(): void { this.host.close(); }
});

class DayPageWidget extends WidgetType {
  constructor(readonly target: DayPageTarget) { super(); }

  override eq(other: DayPageWidget): boolean {
    return other.target.doc === this.target.doc && other.target.date === this.target.date;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.plugin(hostPlugin)?.host;
    // Senza il plugin (non succede: vanno insieme) un contenitore vuoto.
    return host ? host.elementFor(this.target) : document.createElement("section");
  }

  /// La pagina non è testo: puntatore e tasti restano suoi.
  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 160;
  }
}

interface DayValue {
  readonly target: DayPageTarget | null;
  readonly decorations: DecorationSet;
}

function decorate(state: EditorState, target: DayPageTarget | null): DayValue {
  if (!target) return { target, decorations: Decoration.none };
  const widget = Decoration.widget({ widget: new DayPageWidget(target), block: true, side: 1 });
  return { target, decorations: Decoration.set([widget.range(state.doc.length)]) };
}

const dayField = StateField.define<DayValue>({
  create: (state) => decorate(state, state.facet(daySource)?.current() ?? null),
  update(value, transaction) {
    // Il widget resta dopo l'ultima riga: una modifica lo rimette in fondo,
    // con lo stesso widget (e quindi lo stesso DOM).
    return transaction.docChanged ? decorate(transaction.state, value.target) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// La pagina del giorno in fondo alla giornaliera, se `source` dice che la
/// nota aperta lo è.
export function dayPage(source: DayPageSource): Extension {
  return [daySource.of(source), hostPlugin, dayField];
}

/// La giornaliera che lo stato mostra, o `null` (i test).
export function dayPageOf(state: EditorState): DayPageTarget | null {
  return state.field(dayField, false)?.target ?? null;
}
