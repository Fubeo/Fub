// Il contesto di una scheda che scrive in un foglio (N6 T42, T43): il nome
// della cella attiva e la sua formula, nella forma della barra della formula
// della griglia (`.grid-formula-bar`, `.grid-cell-name`,
// `.grid-formula-editor`). Lo stesso codice lo mostra la lavagna, nella riga
// delle opzioni, e la nota, nel gruppo «Foglio» della barra di formato: chi
// lo ospita decide soltanto dove sta e come si veste.
//
// Sta fuori da `editors/core/cards/` perché la barra di formato delle note la
// carica all'avvio, mentre l'ospite delle schede si spegne e arriva soltanto
// con la lavagna (`NOT_AT_STARTUP` in `vite.config.ts`): dal contratto prende
// soltanto un tipo, che sparisce nel build.

import type { CardEditorContext } from "./cards/contract";

/// La barra montata: l'elemento e come cambiarne il testo, senza rifarla.
export interface CardFormulaBar {
  readonly element: HTMLElement;
  show(context: CardEditorContext): void;
}

/// Una barra della formula vuota; `show` le dà la cella e la formula.
export function cardFormulaBar(): CardFormulaBar {
  const element = document.createElement("div");
  element.className = "grid-formula-bar";
  const cell = document.createElement("span");
  cell.className = "grid-cell-name";
  const formula = document.createElement("div");
  formula.className = "grid-formula-editor";
  // La classe è quella della lavagna, dove è nata (T42).
  const text = document.createElement("span");
  text.className = "canvas-formula-text";
  formula.append(text);
  element.append(cell, formula);
  return {
    element,
    show(context) {
      cell.textContent = context.cell;
      text.textContent = context.formula;
      text.title = context.formula;
    },
  };
}
