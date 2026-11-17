// «Da riga a blocco» e ritorno (T65, E27): la formula cambia posto, e nel file
// passa da `$…$` a `$$…$$` su righe sue, o indietro. È un gesto della persona
// (il tasto destro, «Posto» nei tre puntini): niente cambia da solo. Le altre
// formule e il testo intorno restano byte per byte.
//
// Un blocco sta da solo nel suo paragrafo (`mathBlock`): una formula in mezzo
// a una frase la divide in tre, la frase prima, il blocco, la frase dopo,
// separati da righe vuote. Si cambia posto soltanto in un paragrafo della
// nota, non in una citazione, in un elenco o in una tabella, dove le righe
// nuove porterebbero i loro segni.
import type { EditorState } from "@codemirror/state";
import type { FormulaAt } from "../menu";

/// Una modifica che cambia posto alla formula, e dove sta poi la formula.
export interface PlaceChange {
  readonly changes: { readonly from: number; readonly to: number; readonly insert: string };
  /// L'inizio della formula nella nota dopo la modifica.
  readonly at: number;
  /// Il TeX nel posto nuovo.
  readonly tex: string;
}

/// Un dollaro non protetto da `\`.
function hasDollar(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === "$") return true;
  }
  return false;
}

/// Un `%` non protetto da `\`: un commento del TeX, che su una riga sola
/// spegnerebbe il resto della formula.
function hasComment(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === "%") return true;
  }
  return false;
}

/// La formula in riga diventa un blocco `$$` su righe sue.
export function toBlock(state: EditorState, formula: FormulaAt): PlaceChange | null {
  if (formula.block || !formula.plain) return null;
  const tex = formula.tex.trim();
  if (!tex) return null;
  const { from, to } = formula.container;
  const before = state.sliceDoc(from, formula.from).replace(/\s+$/, "");
  const after = state.sliceDoc(formula.to, to).replace(/^\s+/, "");
  const head = before ? `${before}\n\n` : "";
  const insert = `${head}$$\n${tex}\n$$${after ? `\n\n${after}` : ""}`;
  return { changes: { from, to, insert }, at: from + head.length, tex };
}

/// Il blocco `$$` diventa una formula in riga, da sola nel suo paragrafo. Gli
/// a capo del TeX diventano spazi; con un commento (`%`) non si può.
export function toInline(formula: FormulaAt): PlaceChange | null {
  if (!formula.block || !formula.plain) return null;
  if (hasComment(formula.tex)) return null;
  const tex = formula.tex.replace(/\s*\n\s*/g, " ").trim();
  if (!tex || hasDollar(tex)) return null;
  return { changes: { from: formula.from, to: formula.to, insert: `$${tex}$` }, at: formula.from, tex };
}
