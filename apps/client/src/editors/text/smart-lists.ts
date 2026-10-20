import { Facet } from "@codemirror/state";

/// Se `Invio` continua gli elenchi (impostazione `editor.smart-lists`). Una
/// faccetta, così il motore la accende e la spegne in un compartimento e i
/// profili la leggono dallo stato senza importare il motore.
export const smartLists = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});
