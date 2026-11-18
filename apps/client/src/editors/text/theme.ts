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
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, syntaxTree } from "@codemirror/language";
import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { highlightTree, tags as t, type Highlighter } from "@lezer/highlight";
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
export const syntaxStyle = HighlightStyle.define([
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

/// Sotto questa distanza in caratteri due tratti visibili si evidenziano in
/// una passata sola, col pezzo nascosto in mezzo (vedi `highlightVisible`).
const JOIN_GAP = 4_000;

/// Dà a `add`, in ordine, le classi della sintassi dell'albero nei tratti
/// visibili `ranges` (ordinati e disgiunti), tagliate ai tratti: le stesse
/// che l'evidenziatore di CodeMirror dà chiamando `highlightTree` una volta
/// per tratto.
///
/// Nella Live i blocchi resi spezzano il tratto della vista in molti pezzi, e
/// ogni chiamata riparte dalla radice dell'albero. Qui i tratti vicini si
/// uniscono in una chiamata sola, e ciò che cade fuori si scarta: il lavoro
/// sprecato sotto un blocco reso resta sotto `JOIN_GAP` caratteri, mentre un
/// recinto lungo reso in un widget non si evidenzia.
export function highlightVisible(
  tree: Tree,
  highlighter: Highlighter,
  ranges: readonly { from: number; to: number }[],
  add: (from: number, to: number, classes: string) => void,
  joinGap = JOIN_GAP,
): void {
  let start = 0;
  while (start < ranges.length) {
    let end = start;
    while (end + 1 < ranges.length && ranges[end + 1]!.from - ranges[end]!.to <= joinGap) end += 1;
    if (end === start) {
      highlightTree(tree, highlighter, add, ranges[start]!.from, ranges[start]!.to);
    } else {
      let index = start;
      highlightTree(tree, highlighter, (from, to, classes) => {
        while (ranges[index]!.to <= from) index += 1;
        for (let i = index; i <= end && ranges[i]!.from < to; i += 1) {
          const cut = Math.max(from, ranges[i]!.from);
          const upto = Math.min(to, ranges[i]!.to);
          if (upto > cut) add(cut, upto, classes);
        }
      }, ranges[start]!.from, ranges[end]!.to);
    }
    start = end + 1;
  }
}

/// L'evidenziatore della sintassi: quello di `syntaxHighlighting` di
/// CodeMirror, con le stesse regole per rifarsi, che lavora sui tratti
/// visibili con `highlightVisible`.
const highlightPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private tree: Tree;
  private decoratedTo: number;
  private readonly marks = new Map<string, Decoration>();
  constructor(view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.decorations = this.build(view);
    this.decoratedTo = view.viewport.to;
  }
  update(update: ViewUpdate): void {
    const tree = syntaxTree(update.state);
    const { viewport } = update.view;
    const decoratedTo = update.changes.mapPos(this.decoratedTo, 1);
    // L'albero non arriva ancora in fondo alla vista e quella già colorata
    // copre la vista: si sposta, come fa CodeMirror, in attesa dell'albero.
    if (tree.length < viewport.to && tree.type === this.tree.type && decoratedTo >= viewport.to) {
      this.decorations = this.decorations.map(update.changes);
      this.decoratedTo = decoratedTo;
    } else if (tree !== this.tree || update.viewportChanged) {
      this.tree = tree;
      this.decorations = this.build(update.view);
      this.decoratedTo = viewport.to;
    }
  }
  private build(view: EditorView): DecorationSet {
    if (!this.tree.length) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    highlightVisible(this.tree, syntaxStyle, view.visibleRanges, (from, to, classes) => {
      let mark = this.marks.get(classes);
      if (!mark) this.marks.set(classes, mark = Decoration.mark({ class: classes }));
      builder.add(from, to, mark);
    });
    return builder.finish();
  }
}, { decorations: (value) => value.decorations });

/// Le classi della sintassi (i colori li dà la pelle). `Prec.high` come
/// l'evidenziatore di CodeMirror: i segni della sintassi stanno dentro le
/// altre decorazioni a segno.
const visibleHighlighting: Extension = [
  Prec.high(highlightPlugin),
  ...(syntaxStyle.module ? [EditorView.styleModule.of(syntaxStyle.module)] : []),
];

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
    visibleHighlighting,
  ];
}

