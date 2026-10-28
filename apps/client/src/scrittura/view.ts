// La vista di Scrittura: un `EditorView` di ProseMirror con un owner. Chi la
// crea dà lo stato di partenza e ascolta ogni transazione; la vista si
// distrugge col suo `Lifetime`, una volta sola.
import type { EditorState, Transaction } from "prosemirror-state";
import { EditorView, type DirectEditorProps } from "prosemirror-view";
import type { Lifetime } from "../ui/lifetime";

export interface WritingViewOptions {
  /// Dove la vista mette il suo elemento, o l'elemento che diventa la vista
  /// (`{ mount }`).
  readonly place: HTMLElement | { readonly mount: HTMLElement };
  readonly state: EditorState;
  readonly lifetime: Lifetime;
  /// Dopo ogni transazione applicata, con lo stato nuovo.
  readonly onChange?: (state: EditorState, tr: Transaction) => void;
  /// Le altre proprietà della vista (eventi, attributi, viste dei nodi).
  readonly props?: Omit<DirectEditorProps, "state" | "dispatchTransaction">;
}

export interface WritingView {
  readonly view: EditorView;
  /// Lo stato di adesso.
  readonly state: EditorState;
  /// Sostituisce lo stato, senza passare da `onChange`.
  reset(state: EditorState): void;
  focus(): void;
  /// Vero dopo la distruzione.
  readonly destroyed: boolean;
}

export function createWritingView(options: WritingViewOptions): WritingView {
  let destroyed = false;
  const view: EditorView = new EditorView(options.place, {
    ...options.props,
    state: options.state,
    dispatchTransaction(tr) {
      if (destroyed) return;
      const next = view.state.apply(tr);
      view.updateState(next);
      options.onChange?.(next, tr);
    },
  });
  options.lifetime.add(() => {
    if (destroyed) return;
    destroyed = true;
    view.destroy();
  });
  return {
    view,
    get state() {
      return view.state;
    },
    reset(state) {
      if (!destroyed) view.updateState(state);
    },
    focus() {
      if (!destroyed) view.focus();
    },
    get destroyed() {
      return destroyed;
    },
  };
}
