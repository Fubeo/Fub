// Il blocco del cursore, in concentrazione (T24): le righe del blocco che
// contiene il cursore (o la scelta) portano `cm-fub-cursor-block`, e la pelle
// attenua le altre (`structure.css`).
//
// Il blocco è il tratto di righe non vuote attorno al cursore, fino alla riga
// vuota prima e dopo: in Markdown è il paragrafo anche quando va a capo a mano,
// la citazione, l'elenco, il titolo col suo testo attaccato. Vale per ogni
// linguaggio e per ogni modalità del testo, senza leggere la grammatica.
//
// Fuori dalla concentrazione non fa niente: guarda un booleano e lascia la
// decorazione vuota. Dentro, a ogni transazione che muove il cursore o cambia
// il testo cerca i due bordi (righe contate, al più `REACH` per parte) e segna
// le sole righe montate da CodeMirror (`visibleRanges`): una nota lunga o una
// scelta di tutto il testo non costano più della pagina che si vede.
import { type Extension, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { concentrating } from "../../state/concentration";

/// Quante righe si guardano, per parte, prima di dire che il blocco finisce
/// lì: un blocco più lungo resta acceso fin dove arriva lo sguardo.
const REACH = 400;

/// La concentrazione è cambiata: il motore lo dice a ogni editor.
export const refreshCursorBlock = StateEffect.define<null>();

const lit = Decoration.line({ class: "cm-fub-cursor-block" });

function blank(view: EditorView, number: number): boolean {
  return view.state.doc.line(number).text.trim() === "";
}

/// Le righe del blocco del cursore, dalla prima all'ultima (numeri di riga).
export function cursorBlockLines(view: EditorView): { first: number; last: number } {
  const { doc, selection } = view.state;
  const main = selection.main;
  let first = doc.lineAt(main.from).number;
  let last = doc.lineAt(main.to).number;
  if (!blank(view, first)) {
    for (let step = 0; step < REACH && first > 1 && !blank(view, first - 1); step += 1) first -= 1;
  }
  if (!blank(view, last)) {
    for (let step = 0; step < REACH && last < doc.lines && !blank(view, last + 1); step += 1) last += 1;
  }
  return { first, last };
}

function decorate(view: EditorView): DecorationSet {
  if (!concentrating()) return Decoration.none;
  const { first, last } = cursorBlockLines(view);
  const { doc } = view.state;
  const marks = [];
  for (const range of view.visibleRanges) {
    const from = Math.max(first, doc.lineAt(range.from).number);
    const to = Math.min(last, doc.lineAt(range.to).number);
    for (let number = from; number <= to; number += 1) marks.push(lit.range(doc.line(number).from));
  }
  return Decoration.set(marks, true);
}

export const cursorBlock: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate): void {
      const asked = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshCursorBlock)));
      if (!asked && this.decorations === Decoration.none && !concentrating()) return;
      if (asked || update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
