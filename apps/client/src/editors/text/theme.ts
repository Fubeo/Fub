// Il tema dell'editor, scritto **con i token** invece che con dei colori.
//
// Prima qui c'era una riga sola — `import { oneDark }` — e sembrava la scelta
// più economica possibile. Costava però una cosa che non si vedeva: i colori
// della superficie del documento erano dichiarati **due volte**, una in
// `theme/serie/sheet-dark.css` (dove li leggono la modalità Lettura e la vivi
// una dentro il pacchetto `@codemirror/theme-one-dark` (dove li legge la
// modalità Sorgente). Le due liste erano uguali perché qualcuno le aveva
// ricopiate a mano, e il commento accanto ai token lo diceva: *«i valori
// vengono dal tema dell'editor»*. Una promessa del genere — «le tre modalità
// sono la stessa nota vista in tre modi» (FEATURES 4.1) — regge finché nessuno
// tocca un valore da un lato solo.
//
// Con un tema chiaro la cosa smetteva di essere teorica: `oneDark` è scuro per
// definizione, e non c'è nessun valore da cambiare in `theme/serie/sheet-dark.css`
// schiarirlo. O si montava un secondo pacchetto — e allora le liste diventavano
// tre — o i colori venivano da dove già stanno.
//
// Quindi vengono da lì: ogni colore qui sotto è un `var(--…)`. CodeMirror li
// passa a `StyleModule` senza guardarli, e il browser li risolve sull'elemento
// dell'editor come farebbe per qualunque altra regola — il che vuol dire che
// **cambiare tema non richiede di ricostruire l'editor**: cambia l'attributo
// sulla radice e i colori seguono, documento e cronologia di undo intatti.
//
// Le due tavolozze sono One Dark e One Light, che sono la stessa tavolozza in
// due luci (`theme/serie/sheet-dark.css` e `theme/serie/sheet-light.css`, `--syn-*`). Restare su quella famiglia invece
// di sceglierne una nuova è ciò che rende «la stessa nota, in due luci»
// un'affermazione vera e non due gusti affiancati.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import type { Theme } from "../../theme/theme";

/// Le regole di sintassi. Sono quelle di One Dark — stessi raggruppamenti di
/// tag, stesso ordine — con i colori sostituiti dai token: così il giorno che
/// un tema di terze parti (6.2) ridichiara `--syn-string`, cambia la stringa in
/// **tutti** i linguaggi, e non solo dove qualcuno si è ricordato di guardare.
///
/// L'ordine conta e non è decorativo: `t.link` compare due volte — una nel
/// gruppo degli operatori, una da solo con la sottolineatura — e in
/// `HighlightStyle` vince l'ultima. Riordinare queste righe cambia la resa.
const syntaxStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-keyword)" },
  {
    tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
    color: "var(--syn-name)",
  },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--syn-function)" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--syn-literal)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--doc-fg)" },
  {
    tag: [
      t.typeName,
      t.className,
      t.number,
      t.changed,
      t.annotation,
      t.modifier,
      t.self,
      t.namespace,
    ],
    color: "var(--syn-type)",
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: "var(--syn-operator)",
  },
  { tag: [t.meta, t.comment], color: "var(--syn-comment)" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.monospace, color: "var(--doc-fg)", backgroundColor: "var(--doc-fill)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--doc-link)", textDecoration: "underline" },
  // Il titolo ha un colore anche mentre lo si scrive: è la riga per cui esiste
  // `--doc-heading`, ed è la differenza più visibile fra Sorgente e Lettura se
  // una delle due la perde.
  { tag: t.heading, fontWeight: "bold", color: "var(--syn-heading)" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--syn-literal)" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--syn-string)" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
]);

/// Le superfici dell'editor: il foglio, il cursore, la selezione, il margine.
///
/// Quello che `theme/serie/skin.css` faceva da fuori con due regole su `#editor .cm-editor`
/// sta adesso qui, perché è **lo stesso lavoro**: un pezzo dei colori
/// dell'editor scritto nel foglio della shell e un pezzo dentro il tema era la
/// divisione che aveva prodotto il doppione di partenza.
const surfaces = EditorView.theme({
  "&": {
    color: "var(--doc-fg)",
    backgroundColor: "var(--doc-bg)",
  },
  ".cm-content": {
    caretColor: "var(--doc-caret)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-base)",
    lineHeight: "var(--leading-normal)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--doc-caret)",
  },
  // Le tre forme in cui una selezione si disegna: quella di CodeMirror quando
  // ha il fuoco, quella che resta quando lo perde, e quella del browser sul
  // testo. Servono tutte e tre — CodeMirror sceglie da sé quale usare a
  // seconda di come è configurato, e dichiararne una sola lascia un caso in cui
  // la selezione è invisibile.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--doc-selection)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--doc-active-line)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--doc-fill)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--doc-fill)",
    outline: "1px solid var(--doc-rule-soft)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--doc-bg)",
    color: "var(--doc-gutter-fg)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--doc-active-line)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--doc-gutter-fg)",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-elev)",
    color: "var(--text)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--doc-highlight)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--doc-selection)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    backgroundColor: "var(--doc-tooltip-bg)",
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "var(--doc-tooltip-bg)",
    borderBottomColor: "var(--doc-tooltip-bg)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--doc-active-line)",
      color: "var(--doc-fg)",
    },
  },
});

/// Il tema dell'editor per una delle due luci.
///
/// I colori non dipendono dall'argomento — li risolve il CSS — ma **una** cosa
/// sì: il flag `dark`, che CodeMirror non usa per colorare bensì per dichiarare
/// in che luce si trova, e da cui dipendono la resa dei controlli nativi dentro
/// l'editor e la scelta della variante scura dei suoi stili di base. È l'unica
/// ragione per cui questa è una funzione e non una costante.
export function editorTheme(theme: Theme): Extension {
  return [
    surfaces,
    // Il flag va su un tema **vuoto**: `EditorView.theme` accetta le opzioni
    // solo insieme a delle regole, e ricreare `superfici` a ogni cambio di tema
    // rigenererebbe un foglio di stile intero per un booleano.
    EditorView.theme({}, { dark: theme === "dark" }),
    syntaxHighlighting(syntaxStyle),
  ];
}
