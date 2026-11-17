// La macchina da scrivere (`editor.typewriter`, spenta di serie): la riga del
// cursore resta a metà altezza del foglio e il testo le scorre sotto.
//
// Nessun lavoro in più alla battuta. Una transazione che CodeMirror farebbe
// già scorrere fino al cursore (`scrollIntoView`: la battuta, le frecce,
// Annulla) chiede lo stesso scorrimento «al centro» invece che «quanto
// basta». CodeMirror lo misura e lo scrive nel passo di misura che fa
// comunque dopo ogni battuta: nessuna lettura di layout nostra, nessun
// fotogramma in più. Se la riga non è cambiata il cursore è già al centro e
// lo scorrimento vale zero: il foglio non si muove.
//
// Il puntatore non conta: il clic, la selezione col mouse e il trascinamento
// lasciano il testo dov'è, perché la riga scelta resti sotto la mano. Una
// modifica arrivata da un altro riquadro (`sync`) non chiede scorrimento e
// non muove questo foglio.
//
// In cima a una nota il testo non scende oltre l'inizio: lo scorrimento non
// va sotto lo zero. In fondo il foglio ha mezzo schermo di carta bianca in
// più (`cm-fub-typewriter`), così anche l'ultima riga arriva a metà.
import { EditorState, Facet, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/// Lo spazio in fondo al testo: la metà dell'altezza della finestra basta
/// sempre a portare l'ultima riga a metà del foglio, che non è più alto della
/// finestra. Una classe e una regola del tema, non uno stile scritto per
/// ogni misura: la CSP rifiuta gli attributi `style`.
const room = EditorView.baseTheme({
  "&.cm-fub-typewriter .cm-content": { paddingBottom: "50vh" },
});

/// La transazione chiede di portare il cursore in vista, e non viene dal
/// puntatore: è quella che la macchina da scrivere porta al centro.
export function centresCursor(tr: Transaction): boolean {
  if (!tr.scrollIntoView) return false;
  if (tr.isUserEvent("select.pointer") || tr.isUserEvent("input.drop") || tr.isUserEvent("move")) return false;
  if (tr.docChanged) return true;
  return tr.newSelection.main.head !== tr.startState.selection.main.head;
}

const centre = EditorState.transactionExtender.of((tr) => {
  if (!tr.startState.facet(typewriter) || !centresCursor(tr)) return null;
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) };
});

/// Accesa, la riga del cursore resta a metà. Il motore la scrive in un
/// compartimento (`engine.ts`, come `smartLists`). Spenta, l'estensore guarda
/// la faccetta e lascia la transazione com'è, e l'editor non ha la classe.
export const typewriter = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
  enables: (facet) => [
    centre,
    EditorView.editorAttributes.compute([facet], (state): Record<string, string> => (state.facet(facet) ? { class: "cm-fub-typewriter" } : {})),
    room,
  ],
});
