// Il campo a righe di Scrittura: una vista ProseMirror sul profilo a righe
// (`lines.ts`), montata su un elemento che chi la usa ha già messo nella
// pagina. Chi la usa tiene il modello e decide che cosa fa una battuta; la
// vista tiene il DOM, la scelta, la composizione (accenti, giapponese) e i
// segni del correttore.
//
// - **Il campo scrive, la vista mostra**: `set` mette righe e scelta. Gli
//   eventi che il campo gestisce (`events`) passano prima di ProseMirror;
//   uno gestito non arriva alla vista.
// - **Ciò che il browser cambia da sé**, come una composizione o un
//   trascinamento, la vista lo applica e lo dice con `onBrowserChange`.
import { EditorState, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Lifetime } from "../../ui/lifetime";
import { createWritingView } from "../view";
import { attrsOf, caretOf, docLines, linesDoc, linesSchema, posOf, type LineCaret, type LinesProfileOptions, type WrittenLine } from "./lines";

/// Gli eventi che il campo gestisce prima della vista: `true` se l'ha fatto.
export interface LineWriterEvents {
  readonly beforeinput?: (event: InputEvent) => boolean;
  readonly keydown?: (event: KeyboardEvent) => boolean;
  readonly paste?: (event: ClipboardEvent) => boolean;
}

/// Un tratto segnato, come lo segna il correttore.
export interface LineMark {
  readonly from: LineCaret;
  readonly to: LineCaret;
  readonly className: string;
  /// Che cosa dice il tratto al passaggio del puntatore.
  readonly title?: string;
}

export interface LineWriterOptions {
  /// L'elemento che diventa il campo: resta quello, con le sue classi.
  readonly element: HTMLElement;
  readonly lifetime: Lifetime;
  readonly profile: LinesProfileOptions;
  readonly events: LineWriterEvents;
  /// Il browser ha cambiato il testo da sé: le righe di adesso.
  readonly onBrowserChange: (lines: WrittenLine[]) => void;
  /// La scelta si è spostata, senza cambiare il testo.
  readonly onSelect?: () => void;
}

export interface LineWriter {
  /// Le righe `lines`, con la scelta da `anchor` a `focus` se c'è.
  set(lines: readonly WrittenLine[], anchor?: LineCaret, focus?: LineCaret): void;
  /// Le righe come le mostra il campo.
  lines(): WrittenLine[];
  /// La scelta: quella del documento se sta nel campo, se no l'ultima della
  /// vista, che resta mentre il fuoco è altrove.
  selection(): { anchor: LineCaret; focus: LineCaret } | null;
  /// Dà il fuoco al campo, con la sua scelta.
  focus(): void;
  select(anchor: LineCaret, focus?: LineCaret): void;
  /// Il punto di un punto del DOM; `null` fuori dal campo.
  caretAt(node: Node, offset: number): LineCaret | null;
  /// Il punto sotto le coordinate della finestra; `null` fuori dal testo.
  caretAtPoint(x: number, y: number): LineCaret | null;
  /// Gli elementi delle righe.
  rows(): HTMLElement[];
  /// Vero mentre il browser compone.
  readonly composing: boolean;
  /// I tratti segnati, al posto di quelli di prima. Un tratto vale finché la
  /// sua riga non cambia testo.
  mark(marks: readonly LineMark[]): void;
  /// Lo stile CSS di ogni riga, in ordine. La vista ridisegna le sue righe:
  /// uno stile scritto a mano su una riga lo perderebbe.
  styleRows(styles: readonly string[]): void;
}

export function createLineWriter(options: LineWriterOptions): LineWriter {
  const { element, profile } = options;
  const schema = linesSchema(profile);
  /// I tratti segnati, ciascuno col testo della sua riga quando è stato
  /// segnato.
  let marks: ReadonlyArray<{ readonly mark: LineMark; readonly text: string }> = [];
  let rowStyles: readonly string[] = [];
  let decorations = DecorationSet.empty;

  /// I segni del correttore, e l'aspetto di ogni pezzo: un elemento solo,
  /// con la classe e lo stile di tutti i suoi attributi.
  const decorate = (doc: EditorState["doc"]): void => {
    const found: Decoration[] = [];
    let row = 0;
    doc.forEach((line, pos) => {
      const style = rowStyles[row++];
      if (style !== undefined && style !== "") found.push(Decoration.node(pos, pos + line.nodeSize, { style }));
    });
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const attrs = attrsOf(node.marks);
      if (attrs !== null) found.push(Decoration.inline(pos, pos + node.nodeSize, { class: profile.pieceClass, style: profile.css(attrs) }));
      return false;
    });
    // Una riga che ha cambiato testo perde i suoi tratti.
    marks = marks.filter(({ mark, text }) => mark.from.line < doc.childCount && doc.child(mark.from.line).textContent === text);
    for (const { mark } of marks) {
      const from = posOf(doc, mark.from);
      const to = posOf(doc, mark.to);
      if (to > from) found.push(Decoration.inline(from, to, mark.title === undefined ? { class: mark.className } : { class: mark.className, title: mark.title }));
    }
    decorations = DecorationSet.create(doc, found);
  };

  const make = (lines: readonly WrittenLine[], anchor?: LineCaret, focus?: LineCaret): EditorState => {
    const doc = linesDoc(schema, lines);
    decorate(doc);
    const selection = anchor === undefined ? undefined : TextSelection.create(doc, posOf(doc, anchor), posOf(doc, focus ?? anchor));
    return EditorState.create({ schema, doc, selection });
  };

  const handled =
    <E extends Event>(handler: ((event: E) => boolean) | undefined) =>
    (_view: unknown, event: E): boolean =>
      handler?.(event) ?? false;

  const writing = createWritingView({
    place: { mount: element },
    state: make([]),
    lifetime: options.lifetime,
    onChange(state, tr) {
      if (!tr.docChanged) {
        if (tr.selectionSet) options.onSelect?.();
        return;
      }
      decorate(state.doc);
      options.onBrowserChange(docLines(state.doc));
    },
    props: {
      decorations: () => decorations,
      handleDOMEvents: {
        beforeinput: handled(options.events.beforeinput),
        keydown: handled(options.events.keydown),
        paste: handled(options.events.paste),
      },
    },
  });
  const view = writing.view;

  /// Nessun cambio del testo: soltanto le decorazioni, ridisegnate.
  const redecorate = (): void => {
    decorate(view.state.doc);
    view.dispatch(view.state.tr.setMeta("fub-decorations", true));
  };

  /// Il punto del DOM della posizione `pos`.
  const pointOf = (pos: number): [Node, number] => {
    const { node, offset } = view.domAtPos(pos, -1);
    return [node, offset];
  };

  const caretAt = (node: Node, offset: number): LineCaret | null => {
    if (!element.contains(node)) return null;
    try {
      return caretOf(view.state.doc, view.posAtDOM(node, offset));
    } catch {
      return null;
    }
  };

  return {
    set(lines, anchor, focus) {
      // Le stesse righe non rifanno il DOM: una composizione in corso, la
      // scelta e il fuoco restano.
      if (!view.state.doc.eq(linesDoc(schema, lines))) writing.reset(make(lines, anchor, focus));
      if (anchor !== undefined) this.select(anchor, focus);
    },
    lines: () => docLines(view.state.doc),
    selection() {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode == null ? null : caretAt(selection.anchorNode, selection.anchorOffset);
      const focus = selection?.focusNode == null ? null : caretAt(selection.focusNode, selection.focusOffset);
      if (anchor !== null && focus !== null) return { anchor, focus };
      const kept = view.state.selection;
      return { anchor: caretOf(view.state.doc, kept.anchor), focus: caretOf(view.state.doc, kept.head) };
    },
    focus: () => writing.focus(),
    select(anchor, focus = anchor) {
      const doc = view.state.doc;
      const from = posOf(doc, anchor);
      const to = posOf(doc, focus);
      if (!view.state.selection.eq(TextSelection.create(doc, from, to))) view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
      // La scelta del documento, come la vede chi legge il DOM, anche col
      // fuoco altrove.
      const selection = document.getSelection();
      if (selection === null) return;
      const [a, ao] = pointOf(from);
      const [f, fo] = pointOf(to);
      try {
        selection.setBaseAndExtent(a, ao, f, fo);
      } catch {
        // Un punto che il browser non accetta lascia la scelta com'era.
      }
    },
    caretAt,
    caretAtPoint(x, y) {
      try {
        const found = view.posAtCoords({ left: x, top: y });
        return found === null ? null : caretOf(view.state.doc, found.pos);
      } catch {
        // Senza disposizione (un DOM senza layout) non c'è un punto.
        return null;
      }
    },
    rows: () => [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(profile.lineClass)),
    get composing() {
      return view.composing;
    },
    mark(next) {
      const doc = view.state.doc;
      marks = next.filter((mark) => mark.from.line < doc.childCount).map((mark) => ({ mark, text: doc.child(mark.from.line).textContent }));
      redecorate();
    },
    styleRows(next) {
      if (next.length === rowStyles.length && next.every((style, i) => style === rowStyles[i])) return;
      rowStyles = next;
      redecorate();
    },
  };
}
