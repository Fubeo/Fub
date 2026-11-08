// Il tema dell'editor di testo: le classi, non i colori.
//
// Prima qui c'era una riga sola — `import { oneDark }` — e i colori della
// superficie del documento erano dichiarati due volte: nei fogli del tema, dove
// li leggono la Lettura e la Live, e dentro `@codemirror/theme-one-dark`, dove
// li leggeva la Sorgente. Poi i colori sono diventati `var(--…)` scritti qui,
// con `EditorView.theme`: una lista sola, ma fuori dalla pelle, e un tema che
// cambiava i ruoli non poteva vestire l'editor di testo come veste il resto
// (issue #242).
//
// Adesso l'editor di testo si veste come ogni altro componente: i colori, i
// caratteri e i segni stanno nella pelle, sotto le classi `.cm-*`
// (`theme/scrittoio/skin/editors.css`), e gli hook sono nel contratto del tema
// (`theme/author/contract.json`). Qui resta ciò che solo CodeMirror sa fare:
// dire a ogni pezzo di sintassi la sua classe, e dichiarare la luce.
//
// Cambiare tema non ricostruisce l'editor: cambia il foglio montato e i colori
// seguono, documento e cronologia di undo intatti.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import type { Theme } from "../../theme/theme";

/// Le regole di sintassi: i raggruppamenti di tag di One Dark, ciascuno con la
/// sua classe `fub-syn-*`. Il colore lo dà la pelle con i ruoli `--syn-*`,
/// così un tema che ridichiara `--syn-string` cambia la stringa in **tutti** i
/// linguaggi, e una pelle può vestire un gruppo senza toccare gli altri.
///
/// L'ordine conta e non è decorativo, due volte. `t.link` compare in due
/// gruppi — gli operatori e il collegamento — e in `HighlightStyle` vince
/// l'ultimo. E un pezzo di testo può avere più classi insieme (un collegamento
/// dentro un titolo): la pelle scrive le regole nello stesso ordine di queste
/// righe, e la regola che viene dopo vince. Riordinare una delle due liste
/// cambia la resa.
const syntaxStyle = HighlightStyle.define([
  { tag: t.keyword, class: "fub-syn-keyword" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], class: "fub-syn-name" },
  { tag: [t.function(t.variableName), t.labelName], class: "fub-syn-function" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], class: "fub-syn-constant" },
  { tag: [t.definition(t.name), t.separator], class: "fub-syn-definition" },
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
    class: "fub-syn-type",
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    class: "fub-syn-operator",
  },
  { tag: [t.meta, t.comment], class: "fub-syn-comment" },
  { tag: t.strong, class: "fub-syn-strong" },
  { tag: t.monospace, class: "fub-syn-monospace" },
  { tag: t.emphasis, class: "fub-syn-emphasis" },
  { tag: t.strikethrough, class: "fub-syn-strikethrough" },
  { tag: t.link, class: "fub-syn-link" },
  // Il testo del titolo in Sorgente usa lo stesso inchiostro della resa
  // (`doc-heading`, che vale come il corpo): solo i `#` restano sintassi
  // (processingInstruction). `--syn-heading` resta per gli altri linguaggi.
  { tag: t.heading, class: "fub-syn-heading" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], class: "fub-syn-atom" },
  { tag: [t.processingInstruction, t.string, t.inserted], class: "fub-syn-string" },
  { tag: t.invalid, class: "fub-syn-invalid" },
]);

/// La sintassi di serie, senza colori: le classi della pelle.
const syntax = syntaxHighlighting(syntaxStyle);

/// Il tema dell'editor per una delle due luci.
///
/// Non c'è un colore che dipenda dall'argomento — li risolve la pelle — ma
/// **una** cosa sì: il flag `dark`, che CodeMirror non usa per colorare bensì
/// per dichiarare in che luce si trova, e da cui dipendono la resa dei
/// controlli nativi dentro l'editor e la variante dei suoi stili di base che
/// la pelle copre. È l'unica ragione per cui questa è una funzione.
export function editorTheme(theme: Theme): Extension {
  return [
    // `EditorView.theme` accetta le opzioni solo insieme a delle regole: il
    // flag va su un tema vuoto.
    EditorView.theme({}, { dark: theme === "dark" }),
    syntax,
  ];
}
