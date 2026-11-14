// Inactive blocks share their HTML renderer with Reading. Active blocks keep
// source coordinates, native selections and the existing inline decorations.
import { StateEffect, type EditorState, type Extension, type Range, type Text, type Transaction } from "@codemirror/state";
import {
  EditorSelection,
  Facet,
  findClusterBreak,
  Prec,
  RangeSet,
  RangeValue,
  type SelectionRange,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";
// La lettura binaria di una casella è una regola del contratto, non del
// disegno: `[/]`, `[-]`, `[>]` sono stati che esistono e non sono "fatto".
import { taskChecked } from "../../../../rules/mirrored";
import { t } from "../../../../i18n/strings";
import { isAllowedLink } from "../../../../ui/sanitize";
import { figureMask, PAGE_FIGURES, readPageMark } from "../../../../ui/page-mark";
import type { SyntaxForm } from "../../../../host/contract";
import {
  inlineDelimiters,
  parseWikilinkInner,
  scanTags,
  textSpans,
  listItem,
  wikilink,
  type FoundWikilink,
} from "../../../../rules/syntax";
import {
  blockOrigin,
  blocksAround,
  findTrailingAnchor,
  frontmatterRange,
  linkReferences,
  movedBlock,
  paragraphMathBlock,
  renderMarkdownState,
  renderMarkdownStatePrefix,
  renderPatch,
} from "./render";
import { decodeDestination, normalizeLabel } from "./link-syntax";
import { FOOTNOTE_DEFINITION } from "./grammar";
import { emptyPairsExtension } from "./empty-pair";
import { edgeSpaces } from "./edge-space";
import { keepMarks } from "./keep-marks";
import { signsOnFirstLetter } from "./format-toggle";
import type { MarkdownBlock, MarkdownDocument, MarkdownLinkDefinition, MountMarkdown } from "./render-types";
import { mountMarkdown } from "./mount";
import { mountMathBlocks } from "./math";
import { isVaultPath } from "./media";
import {
  containerMath,
  embedHtml,
  figureHtml,
  embedSizeOf,
  footnoteStands,
  FOOTNOTE_REFERENCE,
  imageHtml,
  inlineHtmlPartner,
  visibleText,
  isMathContainer,
  nativeCuts,
  nativeInlines,
  scanInlineFootnotes,
  type DollarMath,
  type NativeInline,
} from "./render-inline";
import { mediaKindOfId } from "../../../media/media-types";
import { TableWidget, tableGrids, tableOfBlock, type TableGridCallbacks } from "./table-widget";
import { propertiesExtension } from "./properties";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { pendingGuide } from "./pending";
import { liveHints } from "./hints";
import { DiagramLiveWidget, fenceBody } from "./diagram-live";
import { calloutGestures, CalloutTypeWidget } from "./callout";
import { detailsLive } from "./details-live";
import { blockGesture } from "./block-gesture";
import { calloutHead } from "./callout-head";
import { hangingIndent } from "./hanging";
import { blockTex, MathBlockLiveWidget, mathPopovers, type LiveFormula } from "./math-live";
import { imageGestures } from "./image-live";
import { CodeHeaderWidget, codeBlocks, codeWrapChanged, codeWraps } from "./code-block";
import { blockPrefixes } from "./block-prefix";
import { linkDialogOpener } from "./link-dialog";
import { liveStrings } from "./strings";
import { topChanges } from "./top-changes";
import { bareUrl, linkCardGestures, linkCardsChanged, LinkCardWidget, type LinkCardSource } from "./link-card";

/// I varchi verso il resto dell'app: il modulo non importa `api.ts` né tocca
/// lo stato — chi monta l'editor inietta cosa succede al click.
export interface LivePreviewCallbacks {
  /// `Mod-click` su un wikilink: riceve il **punto**, non solo la pagina.
  ///
  /// `page` vuota è `[[#Sezione]]`, cioè un link interno alla nota. `heading` e
  /// `block` sono il punto che il link nomina, quando lo nomina: arrivavano
  /// fin qui e venivano buttati, quindi `[[Nota#Sezione]]` cliccato
  /// nell'editor apriva la nota in cima mentre lo stesso link cliccato in
  /// Lettura arrivava alla sezione — due risposte per lo stesso link, che è la
  /// §4.4 nella sua forma più piccola.
  openWikilink(page: string, heading: string | null, block: string | null): void;
  /// Click semplice su un tag: riceve il nome senza `#` (es. "area/lavoro").
  searchTag(tag: string): void;
  /// `Alt-Invio` su un link relativo: il percorso, ancora codificato come
  /// path del vault, da risolvere rispetto al documento aperto.
  openPath?(path: string): void;
  mountRendered?: MountMarkdown;
  /// La griglia delle tabelle che ha il fuoco: chi monta l'editor la usa per
  /// la barra di formattazione. Assente, le griglie funzionano lo stesso.
  readonly tableGrid?: TableGridCallbacks;
  /// Il menu «/» c'è e si apre: il segnaposto della riga vuota lo nomina.
  slashEnabled?(): boolean;
  /// L'icona (`icon:`) della pagina che un wikilink nomina, mostrata prima del
  /// suo testo (K9). Quando le icone cambiano, chi monta l'editor manda
  /// [`pageIconsChanged`].
  pageIcon?(page: string): string | null;
  /// Il wikilink nomina una persona (K5, `state/people.ts`): si mostra come
  /// una pastiglia. Quando la cartella cambia arriva [`pageIconsChanged`].
  isPerson?(page: string): boolean;
  /// Le schede dei collegamenti (K8, `state/link-cards.ts`): senza, un URL da
  /// solo resta un link. Quando cambiano arriva [`linkCardsChanged`].
  readonly linkCard?: LinkCardSource;
}

/// Le icone delle pagine sono cambiate: i wikilink si ridecorano.
export const pageIconsChanged = StateEffect.define<null>();

/// Cosa fare di un intervallo. I `kind` sono il vocabolario condiviso tra la
/// funzione pura (che li produce, ed è ciò che i test verificano) e il plugin
/// (che li traduce in `Decoration`).
export type LiveDecoKind =
  // marcatore nascosto: replace vuoto, atomico per il cursore
  | "hide"
  // widget: linea resa al posto di `---`, checkbox reale al posto di `[ ]`
  | "hr"
  | "checkbox"
  // widget: formula in riga resa, `data` è il TeX
  | "math"
  // widget: immagine del vault in mezzo al testo, `data` è l'HTML della Lettura
  | "image"
  // widget: la pastiglia di un collegamento col cursore dentro, con `mai`, al
  // posto di `](url)` o di `]]`; `data` è la destinazione
  | "link-pill"
  // mark di stile sul testo (classi cm-fub-*)
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "strong"
  | "em"
  | "strike"
  | "code"
  | "link"
  | "wikilink"
  | "highlight"
  | "tag"
  | "done"
  | "quote-mark"
  | "sup"
  | "sub"
  // la definizione di una nota: l'etichetta che resta, e il ↩ al posto di
  // `]:` che porta al primo rimando (`data` è l'etichetta)
  | "footnote-label"
  | "footnote-back"
  // pezzo sostituito e punteggiatura che lo segue, che non vanno a capo divisi
  | "nobreak"
  // un segno che si vede ancora, rivelato con `elemento` o `riga`: più chiaro
  // della sintassi della Sorgente (`--doc-syntax-near`)
  | "near"
  // il segno di una voce d'elenco puntato fuori dalla riga attiva: un pallino
  // largo quanto il segno, o niente davanti a una casella (`data` "task")
  | "list-bullet"
  // decorazioni di riga (from == to == inizio riga)
  | "quote-line"
  // le righe di un callout toccato (`data` è il tipo), la sua pastiglia al
  // posto di `[!tipo]±` (`data` è il tipo e il segno) e il titolo
  | "callout-line"
  | "callout-type"
  | "callout-title"
  // `[!column]` in un `[!columns]` toccato (K3): l'etichetta della colonna
  // (`data` è il suo numero)
  | "column-label"
  | "codeblock-line"
  // la riga d'apertura di un recinto di codice: la testata con la lingua,
  // «A capo» e «Copia» (`data` è l'info string); e la riga di chiusura, che
  // non si vede
  | "code-header"
  | "fence-close"
  // la sorgente rivelata di una formula con `elemento`: `data` è il TeX, che
  // l'anteprima sopra la riga legge
  | "math-source"
  // il contenuto di una coppia di tag HTML ammessi: `data` è il nome del tag,
  // che la decorazione usa come elemento
  | "html";

export interface LiveDeco {
  from: number;
  to: number;
  kind: LiveDecoKind;
  /// Payload per i kind che ne hanno uno: il bersaglio di un wikilink come sta
  /// scritto (`Nota#Sezione^blocco`), il nome di un tag, "x"/" " per lo stato
  /// di una checkbox.
  data?: string;
  /// Un'immagine selezionata: la selezione copre esattamente i suoi byte.
  selected?: true;
}

/// Le righe "attive" (numeri 1-based): ogni riga toccata da una selezione.
/// Con la politica `riga` su queste righe la sorgente resta visibile; con le
/// altre vi si rivelano soltanto commenti e righe orizzontali.
export function activeLinesOf(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = state.selection.ranges,
): Set<number> {
  const active = new Set<number>();
  for (const r of ranges) {
    const from = state.doc.lineAt(r.from).number;
    const line = state.doc.lineAt(r.to);
    const to = r.to > r.from && r.to === line.from ? line.number - 1 : line.number;
    for (let n = from; n <= to; n++) active.add(n);
  }
  return active;
}

/// Che cosa della sintassi si vede, per una politica e le selezioni di uno
/// stato. Ogni ramo di `computeDecorations` chiede del proprio elemento: è qui,
/// e soltanto qui, che le tre politiche differiscono.
export interface Reveal {
  readonly policy: RevealPolicy;
  /// La riga logica `n` ha un cursore. Così si rivelano in ogni politica le
  /// righe orizzontali e i commenti, come prima che ci fosse una politica.
  row(n: number): boolean;
  /// I segni di un elemento in riga da `from` a `to`; `at` è il segno, e con
  /// `riga` conta la sua riga.
  marks(from: number, to: number, at: number): boolean;
  /// Il prefisso di un blocco, da `from` all'inizio del testo `to`: con
  /// `elemento` si rivela col cursore nel prefisso, non a inizio testo.
  prefix(from: number, to: number): boolean;
  /// Un elemento che la Live non sa ancora scrivere senza la sua sorgente: con
  /// `mai` ed `elemento` torna sorgente col cursore dentro.
  source(from: number, to: number, at: number): boolean;
  /// Un cursore tocca l'elemento: con `mai` è quando un collegamento mostra
  /// la sua pastiglia.
  near(from: number, to: number): boolean;
}

/// La rivelazione di uno stato. `ranges` sono le selezioni che contano: quelle
/// dello stato, o quelle tenute ferme durante una composizione.
export function revealOf(
  state: EditorState,
  policy: RevealPolicy,
  ranges: readonly { from: number; to: number }[] = state.selection.ranges,
): Reveal {
  let lines: Set<number> | null = null;
  const row = (n: number) => (lines ??= activeLinesOf(state, ranges)).has(n);
  const rowOf = (at: number) => row(state.doc.lineAt(at).number);
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
  const inPrefix = (from: number, to: number) => ranges.some((r) => r.from < to && (r.to > from || r.from === from));
  if (policy === "riga") {
    return {
      policy, row, marks: (_f, _t, at) => rowOf(at), prefix: (from) => rowOf(from), source: (_f, _t, at) => rowOf(at), near: touches,
    };
  }
  if (policy === "elemento") {
    return { policy, row, marks: touches, prefix: inPrefix, source: touches, near: touches };
  }
  return { policy, row, marks: () => false, prefix: () => false, source: touches, near: touches };
}

/// La politica `riga` sulle righe date: la forma dei test, e di chi chiama
/// `computeDecorations` con le righe attive.
function lineReveal(state: EditorState, lines: ReadonlySet<number>): Reveal {
  const rowOf = (at: number) => lines.has(state.doc.lineAt(at).number);
  return {
    policy: "riga",
    row: (n) => lines.has(n),
    marks: (_f, _t, at) => rowOf(at),
    prefix: (from) => rowOf(from),
    source: (_f, _t, at) => rowOf(at),
    near: (from) => rowOf(from),
  };
}

// Il nome dell'attributo con cui il payload viaggia nel DOM, scritto **una**
// volta: chi lo posa e chi lo rilegge stanno a trecento righe di distanza, e
// finché erano due letterali (`attributes:` di qua, `dataset.` di là) un refuso
// non compilava male — semplicemente non trovava niente, e il click non faceva
// nulla. `dataset` non serve più, e non è un dettaglio: la sua forma camelCase
// è una **terza** grafia dello stesso nome.
const ATTR_WIKILINK = "data-fub-target";
const ATTR_TAG = "data-fub-tag";
const ATTR_HREF = "data-fub-href";
const ATTR_FOOTNOTE = "data-fub-footnote";

/// I nodi in riga che l'albero decora o sottrae al livello regex, e i
/// marcatori che si nascondono col loro nodo.
const INLINE_SYNTAX = new Set([
  "StrongEmphasis", "Emphasis", "Strikethrough", "Superscript", "Subscript", "InlineCode", "URL", "HTMLTag", "Comment",
  "Image", "Link",
]);
const INLINE_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "SuperscriptMark", "SubscriptMark"]);

/// Senza pagina e senza punto (`[[]]`, `[[ ]]`) un wikilink non nomina niente
/// (cfr. `names_host` nel contratto): niente hide, niente mark, niente click.
/// `[[#Sezione]]` nomina questa nota e resta.
function namesSomething(w: FoundWikilink): boolean {
  return w.page.trim() !== "" || (w.heading ?? "") !== "" || (w.block ?? "").trim() !== "";
}

/// Le etichette delle note definite nel documento (`[^etichetta]:` in testa a
/// una riga), normalizzate come le legge la Lettura.
export function footnoteLabels(doc: EditorState["doc"]): ReadonlySet<string> {
  const labels = new Set<string>();
  for (let n = 1; n <= doc.lines; n++) {
    const found = FOOTNOTE_DEFINITION.exec(doc.line(n).text);
    if (found) labels.add(normalizeLabel(found[1]!));
  }
  return labels;
}

/// Se una modifica tocca una riga con `[^`, prima o dopo: soltanto lì una
/// definizione di nota può nascere, sparire o cambiare etichetta.
function touchesFootnoteLine(transaction: Transaction): boolean {
  const { startState, state, changes } = transaction;
  let touches = false;
  const lines = (doc: EditorState["doc"], from: number, to: number): boolean =>
    doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to).includes("[^");
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!touches) touches = lines(startState.doc, fromA, toA) || lines(state.doc, fromB, toB);
  });
  return touches;
}

/// Le etichette delle note, rilette soltanto quando una modifica tocca una
/// riga che può definirne una: una battuta nella prosa non scorre il file.
export const footnoteLabelsField = StateField.define<{ doc: EditorState["doc"]; labels: ReadonlySet<string> | null }>({
  create: (state) => ({ doc: state.doc, labels: null }),
  update(value, transaction) {
    if (!transaction.docChanged) return value;
    if (value.labels !== null && !touchesFootnoteLine(transaction)) return { doc: transaction.state.doc, labels: value.labels };
    return { doc: transaction.state.doc, labels: null };
  },
});

/// Le etichette delle note di uno stato: dal campo quando c'è (e le ha già
/// lette per questo documento), altrimenti scorrendo il testo.
function footnoteLabelsOf(state: EditorState): ReadonlySet<string> {
  const cached = state.field(footnoteLabelsField, false);
  if (!cached || cached.doc !== state.doc) return footnoteLabels(state.doc);
  if (cached.labels === null) (cached as { labels: ReadonlySet<string> | null }).labels = footnoteLabels(state.doc);
  return cached.labels!;
}

/// La funzione pura al centro del modulo: dallo stato (albero Lezer + testo)
/// e dalle righe attive produce la lista ordinata degli intervalli da
/// decorare, limitata a [from, to] (i range visibili, quando chiama il
/// plugin; l'intero documento nei test).
///
/// Invarianti che il plugin dà per acquisiti: i replace ("hide", "hr",
/// "checkbox") non attraversano mai un fine riga e non si sovrappongono tra
/// loro; dentro codice (inline, fence, indentato), URL e markup HTML tag e
/// wikilink non si riconoscono, dentro una formula nessuna sintassi in riga, ed
/// evidenziati e commenti stanno in un testo del modello come nel provider;
/// l'output è ordinato per `from`.
export function computeDecorations(
  state: EditorState,
  revealed: ReadonlySet<number> | Reveal,
  from = 0,
  to = state.doc.length,
  forms?: readonly SyntaxForm[],
): LiveDeco[] {
  const out: LiveDeco[] = [];
  const declaredInline = inlineDelimiters(forms);
  const doc = state.doc;
  const reveal = revealed instanceof Set ? lineReveal(state, revealed) : revealed as Reveal;
  // Un'immagine selezionata (D8) resta immagine anche con `elemento`, e la
  // sua sorgente non c'è mai con `mai`: la si cambia dal riquadro.
  const pictured = (from: number, to: number) =>
    reveal.policy !== "riga" && state.selection.ranges.some((r) => r.from === from && r.to === to);
  const imageShown = (from: number, to: number) =>
    reveal.policy === "mai" || pictured(from, to) || !reveal.source(from, to, from);

  // Terreno vietato al livello regex: codice inline, URL e markup HTML (un
  // `==` da base64, un `#frammento` o un `#id` in un attributo non sono
  // sintassi Obsidian). I blocchi di codice escludono righe intere, quindi
  // viaggiano come numeri di riga.
  const exclusions: { from: number; to: number }[] = [];
  const codeRows = new Set<number>();
  const isFree = (a: number, b: number) =>
    exclusions.every((r) => b <= r.from || a >= r.to);
  // Dedupe delle decorazioni di riga: blocchi annidati (citazione dentro
  // citazione) non devono impilare due volte la stessa classe.
  const quoteRows = new Set<number>();

  // Le formule fra dollari si leggono per contenitore con la regola della
  // Lettura (`containerMath`): un `$` aperto su una riga può chiudere sulla
  // seguente, e ogni riga che una formula tocca la conosce. Diventano widget
  // soltanto quelle su una riga sola, perché un replace non attraversa il fine
  // riga, e non quella che è tutto un paragrafo del documento: quella la
  // mostra il widget di blocco.
  const formulasByRow = new Map<number, { readonly math: DollarMath; readonly widget: boolean }[]>();
  const lostFormulas = new Set<DollarMath>();
  // Le formule del contenitore in cui sta l'iterazione: i contenitori non si
  // annidano, e ogni nodo in riga sta nell'ultimo aperto.
  let around: readonly DollarMath[] = [];
  const collectFormulas = (container: SyntaxNode) => {
    const text = doc.sliceString(container.from, container.to);
    const found = containerMath(text, container);
    around = found.formulas;
    if (found.formulas.length === 0) return;
    const block = container.name === "Paragraph" && container.parent?.name === "Document"
      && paragraphMathBlock(found, text) !== null;
    for (const math of found.formulas) {
      const first = doc.lineAt(math.from).number;
      const last = doc.lineAt(math.to).number;
      const entry = { math, widget: !block && first === last };
      for (let n = first; n <= last; n++) {
        const list = formulasByRow.get(n);
        if (list) list.push(entry);
        else formulasByRow.set(n, [entry]);
      }
    }
  };

  // Gli inline che il modello del provider ha come nodi, raccolti per
  // contenitore con la regola della Lettura (`nativeInlines`): un evidenziato,
  // un commento o una nota in riga non li attraversano. Un blocco HTML non ha
  // testo del modello. Qui le definizioni dei riferimenti non si conoscono, e
  // un link conta soltanto se ha la destinazione scritta.
  const natives: NativeInline[] = [];
  const opaqueBlocks: { from: number; to: number }[] = [];
  const liveLink = (link: SyntaxNode): NativeInline | null => {
    if (link.name === "Link" && FOOTNOTE_REFERENCE.test(doc.sliceString(link.from, link.to))) {
      return { from: link.from, to: link.to };
    }
    const marks = link.getChildren("LinkMark");
    const closer = marks.find((mark) => doc.sliceString(mark.from, mark.from + 1) === "]");
    if (!marks.length || !closer || !link.getChild("URL")) return null;
    if (link.name === "Image") return { from: link.from, to: link.to };
    return { from: link.from, to: link.to, content: { from: marks[0].to, to: closer.from } };
  };

  // Decorazione di riga per ogni riga del nodo, clampata a [from, to]:
  // due range visibili che toccano lo stesso blocco non devono duplicare.
  const forRow = (
    node: { from: number; to: number },
    views: Set<number>,
    kind: LiveDecoKind,
  ) => {
    const first = doc.lineAt(Math.max(node.from, from)).number;
    const last = doc.lineAt(Math.min(node.to, to)).number;
    for (let n = first; n <= last; n++) {
      if (views.has(n)) continue;
      views.add(n);
      const row = doc.line(n);
      out.push({ from: row.from, to: row.from, kind });
    }
  };

  // Il contenuto tra i marcatori di apertura e chiusura di un nodo inline
  // (enfasi, barrato, codice): i marcatori si nascondono da soli al passaggio
  // dell'iterazione, qui si marca solo il testo in mezzo.
  const markContent = (
    node: { node: { getChildren(name: string): { from: number; to: number }[] } },
    marker: string,
    kind: LiveDecoKind,
  ) => {
    const marks = node.node.getChildren(marker);
    if (marks.length < 2) return;
    const from = marks[0].to;
    const a = marks[marks.length - 1].from;
    if (from < a) out.push({ from: from, to: a, kind });
  };

  // L'HTML di un'immagine `![alt](path "titolo")` o `![alt][ref]` scritta su
  // una riga, se la destinazione è un path del vault o un indirizzo web;
  // `null` altrimenti. Un
  // riferimento si risolve con le definizioni della Lettura, lette una volta
  // sola e soltanto quando serve (L02).
  let references: ReadonlyMap<string, MarkdownLinkDefinition> | null = null;
  let footnotes: ReadonlySet<string> | null = null;
  const aloneAt = (from: number, to: number): boolean => {
    let paragraph: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
    while (paragraph && paragraph.name !== "Paragraph") paragraph = paragraph.parent;
    return !!paragraph && paragraph.from === from && doc.sliceString(to, paragraph.to).trim() === "";
  };
  const inlineImage = (node: SyntaxNode): string | null => {
    if (doc.lineAt(node.from).number !== doc.lineAt(node.to).number) return null;
    const marks = node.getChildren("LinkMark");
    const opener = marks[0];
    const closer = marks.find((mark) => doc.sliceString(mark.from, mark.from + 1) === "]");
    if (!opener || !closer) return null;
    const url = node.getChild("URL");
    const title = node.getChild("LinkTitle");
    let href: string;
    let caption: string | undefined;
    if (marks.some((mark) => mark.from > closer.from && doc.sliceString(mark.from, mark.from + 1) === "(")) {
      if (!url) return null;
      href = decodeDestination(doc.sliceString(url.from, url.to));
      caption = title ? doc.sliceString(title.from + 1, title.to - 1) : undefined;
    } else {
      const reference = node.getChild("LinkLabel");
      const label = (reference ? doc.sliceString(reference.from + 1, reference.to - 1) : "") || doc.sliceString(opener.to, closer.from);
      const definition = (references ??= linkReferences(state)).get(normalizeLabel(label));
      if (!definition) return null;
      ({ href, title: caption } = definition);
    }
    // Un'immagine remota si vede come in Lettura: un segnaposto che non la
    // carica e offre di scaricarla nel vault (L04).
    if (!isVaultPath(href) && !/^https?:\/\//i.test(href)) return null;
    const label = visibleText(doc, node);
    const image = imageHtml(label, href, caption);
    // Da sola nel suo paragrafo è una figura, con la didascalia dal testo
    // alternativo come in Lettura (K10).
    return aloneAt(node.from, node.to) ? figureHtml(image, label) ?? `<figure>${image}</figure>` : image;
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (isMathContainer(node.name)) {
        collectFormulas(node.node);
        natives.push(...nativeInlines(node.node, node.from, node.to, liveLink, around));
      }
      // Ciò che sta in una formula non è sintassi, e un nodo che ne attraversa
      // una senza contenerla il provider non lo legge: come in Lettura non si
      // decora, e se ne visitano i figli. Un marcatore segue il suo nodo.
      const owner = INLINE_MARKS.has(node.name) ? node.node.parent : node.node;
      if (owner && INLINE_SYNTAX.has(owner.name) && around.some((math) =>
        math.from < owner.to && owner.from < math.to && (math.from < owner.from || owner.to < math.to))) return;
      const heading = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const marks = node.node.getChildren("HeaderMark");
        if (!marks.length) return;
        if (heading[1] === "Setext") {
          // Nel Setext il contenuto è sulla riga precedente al marcatore:
          // nascondere il nodo intero cancellerebbe proprio il titolo.
          const underline = marks[marks.length - 1];
          const title = doc.lineAt(node.from);
          out.push({ from: underline.from, to: underline.to, kind: reveal.prefix(underline.from, underline.to + 1) ? "near" : "hide" });
          if (node.from < title.to) {
            out.push({
              from: node.from,
              to: title.to,
              kind: ("h" + heading[2]) as LiveDecoKind,
            });
          }
          return;
        }
        // Lo spazio dopo i `#` (e quello prima dei `#` di chiusura) fa parte
        // del marcatore percepito: nasconderlo evita il testo che "salta".
        let textFrom = marks[0].to;
        while (/[ \t]/.test(doc.sliceString(textFrom, textFrom + 1))) textFrom++;
        let textEnd = node.to;
        const close = marks.length > 1 ? marks[marks.length - 1] : null;
        if (close) {
          textEnd = close.from;
          while (textEnd > textFrom && doc.sliceString(textEnd - 1, textEnd) === " ") textEnd--;
        }
        const shown = reveal.prefix(node.from, textFrom);
        out.push({ from: node.from, to: shown ? marks[0].to : textFrom, kind: shown ? "near" : "hide" });
        if (close && textEnd < node.to) out.push({ from: shown ? close.from : textEnd, to: node.to, kind: shown ? "near" : "hide" });
        if (textFrom < textEnd) {
          out.push({ from: textFrom, to: textEnd, kind: ("h" + heading[2]) as LiveDecoKind });
        }
        return;
      }

      switch (node.name) {
        // I marcatori inline si nascondono ciascuno secondo la **propria**
        // riga: un'enfasi a cavallo di due righe mostra solo il marcatore
        // della riga attiva, e nessun replace attraversa il fine riga.
        case "EmphasisMark":
        case "StrikethroughMark":
        case "SuperscriptMark":
        case "SubscriptMark": {
          const element = node.node.parent ?? node.node;
          out.push({ from: node.from, to: node.to, kind: reveal.marks(element.from, element.to, node.from) ? "near" : "hide" });
          return;
        }
        case "StrongEmphasis":
          markContent(node, "EmphasisMark", "strong");
          return;
        case "Emphasis":
          markContent(node, "EmphasisMark", "em");
          return;
        case "Strikethrough":
          markContent(node, "StrikethroughMark", "strike");
          return;
        case "Superscript":
          markContent(node, "SuperscriptMark", "sup");
          return;
        case "Subscript":
          markContent(node, "SubscriptMark", "sub");
          return;

        case "InlineCode": {
          // I CodeMark si gestiscono qui e non in un case globale: quelli
          // delle fence NON vanno nascosti.
          const marks = node.node.getChildren("CodeMark");
          for (const m of marks) {
            out.push({ from: m.from, to: m.to, kind: reveal.marks(node.from, node.to, m.from) ? "near" : "hide" });
          }
          markContent(node, "CodeMark", "code");
          exclusions.push({ from: node.from, to: node.to });
          return false;
        }

        case "FencedCode":
        case "CodeBlock": {
          // Sfondo di riga e righe intere sottratte al livello regex: dentro
          // il codice `[[x]]` è codice.
          forRow(node, codeRows, "codeblock-line");
          // I recinti (C1): con `riga` si vedono sempre, con `elemento` col
          // cursore nel blocco, con `mai` mai. Al loro posto la testata e una
          // chiusura raccolta.
          if (node.name === "FencedCode" && reveal.policy !== "riga" && !(reveal.policy === "elemento" && reveal.source(node.from, node.to, node.from))) {
            const marks = node.node.getChildren("CodeMark");
            const open = doc.lineAt(node.from);
            if (marks[0] && open.from >= from && open.from <= to) {
              const info = node.node.getChild("CodeInfo");
              out.push({ from: node.from, to: open.to, kind: "code-header", data: info ? doc.sliceString(info.from, info.to) : "" });
            }
            const last = marks.length > 1 ? marks[marks.length - 1]! : null;
            const close = last ? doc.lineAt(last.from) : null;
            if (close && close.number !== open.number && close.from >= from && close.from <= to) {
              out.push({ from: close.from, to: close.to, kind: "fence-close" });
            }
          }
          return false;
        }

        case "Blockquote": {
          // Un callout col cursore dentro resta un riquadro (D1): le righe
          // hanno il fondo del tipo, `[!tipo]` è la pastiglia, il titolo si
          // scrive in riga.
          const open = doc.lineAt(node.from);
          const head = node.node.parent?.name === "Document" ? calloutHead(open.text) : null;
          if (!head) {
            // Una colonna di `[!columns]` (K3): `[!column]` è la sua etichetta.
            const column = columnIndex(node.node, doc);
            if (column !== null && open.from >= from && open.from <= to) {
              const inner = calloutHead(open.text)!;
              if (!reveal.prefix(open.from, open.from + inner.title.from)) {
                out.push({ from: open.from + inner.mark.from, to: open.from + inner.title.from, kind: "column-label", data: String(column) });
              }
            }
            forRow(node, quoteRows, "quote-line");
            return; // i figli (QuoteMark, paragrafi con enfasi) proseguono
          }
          const first = doc.lineAt(Math.max(node.from, from)).number;
          const last = doc.lineAt(Math.min(node.to, to)).number;
          for (let n = first; n <= last; n++) {
            if (quoteRows.has(n)) continue;
            quoteRows.add(n);
            out.push({ from: doc.line(n).from, to: doc.line(n).from, kind: "callout-line", data: head.type });
          }
          if (open.from >= from && open.from <= to) {
            const markFrom = open.from + head.mark.from;
            const markTo = open.from + head.mark.to;
            if (reveal.prefix(open.from, open.from + head.title.from)) out.push({ from: markFrom, to: markTo, kind: "near" });
            else out.push({ from: markFrom, to: open.from + head.title.from, kind: "callout-type", data: `${head.type}${head.fold ?? ""}` });
            if (head.title.to > head.title.from) out.push({ from: open.from + head.title.from, to: open.from + head.title.to, kind: "callout-title" });
          }
          return;
        }
        // Fuori dalla riga attiva il `>` sparisce con lo spazio che lo segue,
        // come i `#` di un titolo: della citazione resta il filo a sinistra.
        case "QuoteMark": {
          const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          if (reveal.prefix(node.from, end)) out.push({ from: node.from, to: node.to, kind: "quote-mark" });
          else out.push({ from: node.from, to: end, kind: "hide" });
          return;
        }

        // Il `-`, `*` o `+` di una voce puntata diventa un pallino: una
        // decorazione sul segno, che tiene la sua larghezza, e il clic resta
        // dove cade. Una voce con la casella ha già il suo segno.
        case "ListMark":
          if (node.node.parent?.parent?.name === "BulletList" && !reveal.prefix(node.from, node.to + 1)) {
            const task = node.node.nextSibling?.name === "Task";
            out.push({ from: node.from, to: node.to, kind: "list-bullet", data: task ? "task" : undefined });
          }
          return;

        case "HorizontalRule":
          if (!reveal.row(doc.lineAt(node.from).number)) out.push({ from: node.from, to: node.to, kind: "hr" });
          return;

        case "URL":
          exclusions.push({ from: node.from, to: node.to });
          return;
        // La barra di un escape (`\#`, `\*`) dice soltanto «leggilo come
        // lettera»: senza i segni non si vede, come in Lettura. Con `riga`
        // resta, come prima che ci fosse una politica.
        case "Escape":
          if (reveal.policy !== "riga" && !reveal.marks(node.from, node.to, node.from)) {
            out.push({ from: node.from, to: node.from + 1, kind: "hide" });
          }
          return;
        // HTML grezzo e commenti: il testo letterale del markup non è sintassi
        // Obsidian (un `#frag` in un attributo non è un tag). Il testo FRA i
        // tag resta decorabile: di là lo si legge come prosa.
        // Una coppia di tag ammessi nello stesso contenitore (D6): i tag
        // spariscono come i segni, e il contenuto prende l'elemento vero, con
        // lo stile della Lettura. Un tag non ammesso o senza compagno resta.
        case "HTMLTag": {
          exclusions.push({ from: node.from, to: node.to });
          const pair = inlineHtmlPartner((a, b) => doc.sliceString(a, b), node.node);
          if (!pair) return;
          const close = pair.close;
          if (reveal.marks(node.from, close.to, node.from)) {
            out.push({ from: node.from, to: node.to, kind: "near" }, { from: close.from, to: close.to, kind: "near" });
          } else {
            out.push({ from: node.from, to: node.to, kind: "hide" }, { from: close.from, to: close.to, kind: "hide" });
          }
          if (node.to < close.from) out.push({ from: node.to, to: close.from, kind: "html", data: pair.classes ? `${pair.name} ${pair.classes}` : pair.name });
          return;
        }
        case "Comment":
          exclusions.push({ from: node.from, to: node.to });
          return;
        case "HTMLBlock":
        case "CommentBlock":
          exclusions.push({ from: node.from, to: node.to });
          opaqueBlocks.push({ from: node.from, to: node.to });
          return false;

        case "Image": {
          // Un'immagine del vault fuori dalla riga attiva si vede come in
          // Lettura: stesso HTML, stessa idratazione; una remota, col suo
          // segnaposto. Restano sorgente gli altri schemi e le immagini su più
          // righe.
          const html = imageShown(node.from, node.to) ? inlineImage(node.node) : null;
          if (html === null) return;
          exclusions.push({ from: node.from, to: node.to });
          out.push({ from: node.from, to: node.to, kind: "image", data: html, ...(pictured(node.from, node.to) ? { selected: true } : {}) });
          return false;
        }

        case "Link": {
          // Fuori dalla riga attiva resta solo il testo: `[` e `](url…)`
          // spariscono. Un link spezzato su più righe non si tocca (i
          // replace non devono mai attraversare un fine riga).
          const marks = node.node.getChildren("LinkMark");
          // Senza URL è un reference link o un `[testo]` nudo — spesso il
          // cuore di un `[[wikilink]]`, che il parser non conosce: qui non si
          // tocca niente, altrimenti i suoi `[`/`]` nascosti si accavallano
          // ai replace del livello regex.
          // Il rimando a una nota diventa il suo apice, se la nota c'è: come in
          // Lettura, dove un rimando senza definizione resta testo.
          if (FOOTNOTE_REFERENCE.test(doc.sliceString(node.from, node.to))) {
            const label = normalizeLabel(doc.sliceString(node.from + 2, node.to - 1));
            const line = doc.lineAt(node.from);
            const definition = line.from === node.from && FOOTNOTE_DEFINITION.test(line.text);
            if (!definition && !reveal.marks(node.from, node.to, node.from) && (footnotes ??= footnoteLabelsOf(state)).has(label)) {
              out.push({ from: node.from, to: node.from + 2, kind: "hide" });
              out.push({ from: node.from + 2, to: node.to - 1, kind: "sup" });
              out.push({ from: node.to - 1, to: node.to, kind: "hide" });
            }
            return false;
          }
          if (marks.length < 2 || !node.node.getChildren("URL").length) return;
          const textFrom = marks[0].to;
          const textEnd = marks[1].from;
          const url = node.node.getChildren("URL")[0];
          const rawHref = url ? doc.sliceString(url.from, url.to) : "";
          // La destinazione può stare fra parentesi angolari (`[t](<a b>)`):
          // il parser le toglie prima di classificare, qui si fa lo stesso —
          // senza toccare la policy, che resta di `isAllowedLink`.
          const href =
            rawHref.length >= 2 && rawHref.startsWith("<") && rawHref.endsWith(">")
              ? rawHref.slice(1, -1)
              : rawHref;
          if (textFrom < textEnd) out.push({ from: textFrom, to: textEnd, kind: "link", data: href });
          const singleRow = doc.lineAt(node.from).number === doc.lineAt(node.to).number;
          // Con `mai` l'indirizzo non si vede mai: col cursore dentro, dopo il
          // testo, una pastiglia col dominio apre il riquadro «Collegamento».
          if (singleRow && reveal.policy === "mai") {
            out.push({ from: node.from, to: textFrom, kind: "hide" });
            if (textEnd < node.to) {
              out.push(reveal.near(node.from, node.to) && textFrom < textEnd
                ? { from: textEnd, to: node.to, kind: "link-pill", data: href }
                : { from: textEnd, to: node.to, kind: "hide" });
            }
          } else if (singleRow && !reveal.source(node.from, node.to, node.from)) {
            out.push({ from: node.from, to: textFrom, kind: "hide" });
            if (textEnd < node.to) out.push({ from: textEnd, to: node.to, kind: "hide" });
          }
          return;
        }
      }
    },
  });

  // Secondo strato: la sintassi Obsidian, riga per riga. Va DOPO il giro
  // sull'albero perché le esclusioni (codice, URL) devono già esserci tutte.
  const beforeRow = doc.lineAt(from).number;
  const lastLine = doc.lineAt(to).number;
  for (let n = beforeRow; n <= lastLine; n++) {
    if (codeRows.has(n)) continue;
    const row = doc.line(n);
    const text = row.text;
    const rowActive = reveal.row(n);

    // La definizione di una nota (`[^1]: testo`): resta l'etichetta, `[^`
    // sparisce e `]:` diventa un ↩ verso il primo rimando. Con `elemento` i
    // segni tornano col cursore nell'etichetta.
    const definition = FOOTNOTE_DEFINITION.exec(text);
    if (definition) {
      const labelFrom = row.from + 2;
      const labelTo = labelFrom + definition[1]!.length;
      const end = row.from + definition[0].length;
      if (isFree(row.from, end) && !reveal.marks(row.from, labelTo + 1, row.from)) {
        out.push({ from: row.from, to: labelFrom, kind: "hide" });
        out.push({ from: labelFrom, to: labelTo, kind: "footnote-label" });
        out.push({ from: labelTo, to: end, kind: "footnote-back", data: definition[1] });
      }
    }

    // Le formule si giudicano prima di ciò che la riga contiene, per posizione
    // come in Lettura e nel provider: ciò che apre dentro una formula non è
    // sintassi. Un wikilink aperto prima la esclude già in `containerMath`
    // (`[[a$]] b$`); qui la perde, su ogni sua riga, chi la racchiude senza
    // leggerla, come un'immagine del vault. Un evidenziato o un commento invece
    // non la attraversano: stanno in un testo del modello.
    const rowLinks = wikilink(text);
    const rowFormulas = formulasByRow.get(n) ?? [];
    const inFormula = (at: number) => rowFormulas.some(({ math }) =>
      !lostFormulas.has(math) && math.from <= at && at < math.to);
    for (const { math } of rowFormulas) if (!isFree(math.from, math.to)) lostFormulas.add(math);

    // Ciò che della riga non è testo del modello, in offset della riga: gli
    // inline nativi, le formule che restano, i marcatori delle note in riga che
    // reggono, e poi wikilink e tag man mano che si trovano.
    const rowNatives: NativeInline[] = natives.filter((native) => native.from < row.to && row.from < native.to);
    for (const { math } of rowFormulas) if (!lostFormulas.has(math)) rowNatives.push(math);
    const rowCuts = [...nativeCuts(rowNatives), ...opaqueBlocks]
      .filter((cut) => cut.from < row.to && row.from < cut.to)
      .map((cut) => ({ from: cut.from - row.from, to: cut.to - row.from }));
    for (const note of scanInlineFootnotes(text)) {
      if (!footnoteStands({ from: row.from + note.from, to: row.from + note.to }, rowNatives)) continue;
      rowCuts.push({ from: note.from, to: note.contentFrom }, { from: note.contentTo, to: note.to });
    }

    // Wikilink ed embed. Il match diventa a sua volta un'esclusione: un
    // `#heading` o un `|` dentro `[[…]]` non sono un tag né altro. Anche un
    // wikilink che non nomina niente è un nodo del provider, ma non si decora.
    for (const w of rowLinks) {
      const rangeStart = row.from + w.from;
      const rangeEnd = row.from + w.to;
      if (!isFree(rangeStart, rangeEnd) || inFormula(rangeStart)) continue;
      exclusions.push({ from: rangeStart, to: rangeEnd });
      rowCuts.push({ from: w.from, to: w.to });
      if (!namesSomething(w)) continue;
      const innerFrom = row.from + w.innerFrom;
      const innerA = row.from + w.innerA;
      // Il payload porta il riferimento **intero**: pagina, heading e blocco.
      // Portava la sola pagina, quindi `Mod-click` su `[[Nota#Sezione]]`
      // apriva la nota in cima mentre lo stesso link in Lettura arrivava alla
      // sezione — due risposte per lo stesso link (§4.4).
      const data = w.target;
      const embedImage = w.embed && !w.heading && !w.block && mediaKindOfId(w.page) === "image";
      if (reveal.policy !== "mai" && !(embedImage && imageShown(rangeStart, rangeEnd)) && reveal.source(rangeStart, rangeEnd, rangeStart)) {
        // Sorgente visibile ma link comunque cliccabile e stilato.
        out.push({ from: innerFrom, to: innerA, kind: "wikilink", data });
      } else {
        // Un'immagine incorporata si vede com'è in Lettura, anche in mezzo al
        // testo: il widget ha lo stesso HTML dell'embed reso.
        if (embedImage) {
          const html = embedHtml(w);
          out.push({ from: rangeStart, to: rangeEnd, kind: "image", data: aloneAt(rangeStart, rangeEnd) ? `<figure>${html}</figure>` : html, ...(pictured(rangeStart, rangeEnd) ? { selected: true } : {}) });
          continue;
        }
        // `![[foto.pdf|120]]`: il dopo-barra è una dimensione, non un alias. Si
        // mostra il bersaglio e sparisce `|120`, come in Lettura.
        if (w.embed && embedSizeOf(w.alias) !== null) {
          const targetTo = innerFrom + w.target.length;
          out.push({ from: rangeStart, to: innerFrom, kind: "hide" });
          out.push({ from: innerFrom, to: targetTo, kind: "wikilink", data });
          out.push({ from: targetTo, to: rangeEnd, kind: "hide" });
          continue;
        }
        // Un solo hide copre `![[` (o `[[`) e, se c'è l'alias, anche `Pagina|`.
        let showFrom = innerFrom + w.target.length + 1;
        if (w.alias === null) showFrom = innerFrom;
        while (showFrom < innerA && /[ \t]/.test(doc.sliceString(showFrom, showFrom + 1))) showFrom++;
        out.push({ from: rangeStart, to: showFrom, kind: "hide" });
        out.push({ from: showFrom, to: innerA, kind: "wikilink", data });
        // Di un wikilink con alias, col cursore dentro e `mai`, la pastiglia
        // dice quale nota: l'alias da solo non lo direbbe.
        const pill = reveal.policy === "mai" && w.alias !== null && !w.embed && reveal.near(rangeStart, rangeEnd);
        out.push(pill
          ? { from: innerA, to: rangeEnd, kind: "link-pill", data: `[[${data}]]` }
          : { from: innerA, to: rangeEnd, kind: "hide" });
      }
    }

    // Tag: mai nascosti, sempre marcati (e cliccabili) — anche sulla riga
    // attiva. La regola è quella del contratto (`scan_tags`), non una regex di
    // qua: era più stretta, e `vedi.#tag` restava senza decorazione mentre il
    // modello lo indicizzava. Il provider cerca i tag soltanto nel testo, mai
    // dentro una formula.
    for (const t of scanTags(text)) {
      const tagFrom = row.from + t.from;
      const tagA = row.from + t.to;
      if (!isFree(tagFrom, tagA) || inFormula(tagFrom)) continue;
      rowCuts.push({ from: t.from, to: t.to });
      out.push({ from: tagFrom, to: tagA, kind: "tag", data: t.name });
    }

    // Evidenziati e commenti, nell'ordine di dichiarazione, soltanto dentro un
    // testo del modello (`textSpans`): non contengono e non attraversano un
    // link, un wikilink, un tag, il codice, un'enfasi, una formula o una nota
    // in riga. Un commento fuori dalla riga attiva sparisce intero,
    // delimitatori compresi; sulla riga attiva resta, attenuato. Di un
    // evidenziato il mark resta anche sulla riga attiva, e spariscono solo i
    // marcatori.
    for (const t of textSpans(text, rowCuts, declaredInline)) {
      const rangeStart = row.from + t.from;
      const rangeEnd = row.from + t.to;
      const className = t.name.slice(t.name.lastIndexOf(":") + 1);
      if (className === "comments") {
        out.push(
          rowActive
            ? { from: rangeStart, to: rangeEnd, kind: "highlight", data: "comment" }
            : { from: rangeStart, to: rangeEnd, kind: "hide" },
        );
        continue;
      }
      if (!reveal.marks(rangeStart, rangeEnd, rangeStart)) {
        out.push({ from: rangeStart, to: row.from + t.contentFrom, kind: "hide" });
        out.push({ from: row.from + t.contentTo, to: rangeEnd, kind: "hide" });
      }
      out.push({
        from: row.from + t.contentFrom,
        to: row.from + t.contentTo,
        kind: "highlight",
        data: className === "highlight" ? undefined : className,
      });
    }

    // L'ID di blocco `^id` chiude l'**ultima** riga di un blocco: fuori dalla
    // riga attiva non si vede, come in Lettura. La regola è quella del
    // renderer (`findTrailingAnchor`), applicata solo dove un blocco finisce.
    if (n === doc.lines || doc.line(n + 1).text.trim() === "") {
      const anchor = findTrailingAnchor(text);
      const anchorFrom = anchor ? row.from + anchor.start : -1;
      if (anchor && !reveal.marks(anchorFrom, row.to, anchorFrom)) {
        if (isFree(anchorFrom, row.to)) out.push({ from: anchorFrom, to: row.from + text.trimEnd().length, kind: "hide" });
      }
    }

    // Formule: fuori dalla riga attiva il TeX diventa la formula resa, sulla
    // riga attiva resta sorgente.
    for (const { math, widget } of rowFormulas) {
      if (!widget || lostFormulas.has(math)) continue;
      // Con `mai` la formula resta resa anche col cursore accanto: il TeX si
      // scrive nel suo riquadro (C6). Con `elemento` la sorgente rivelata
      // porta il TeX, per l'anteprima sopra la riga.
      if (reveal.policy === "mai" || !reveal.source(math.from, math.to, math.from)) out.push({ from: math.from, to: math.to, kind: "math", data: math.tex });
      else if (reveal.policy === "elemento") out.push({ from: math.from, to: math.to, kind: "math-source", data: math.tex });
    }

    // Checkbox a inizio voce: fuori dalla riga attiva il `[ ]`/`[x]` diventa
    // un widget; il barrato leggero sulla voce fatta resta sempre.
    const entry = listItem(text);
    if (entry && entry.symbol !== null && entry.boxFrom >= 0) {
      const boxFrom = row.from + entry.boxFrom;
      const paragraphEnd = row.from + entry.boxTo; // subito dopo `]`
      const checked = taskChecked(entry.symbol);
      if (!reveal.prefix(boxFrom, paragraphEnd)) {
        out.push({ from: boxFrom, to: paragraphEnd, kind: "checkbox", data: checked ? "x" : " " });
      }
      if (checked && paragraphEnd + 1 < row.to) {
        out.push({ from: paragraphEnd + 1, to: row.to, kind: "done" });
      }
    }
  }

  keepPunctuation(doc, out);
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

const REPLACED: ReadonlySet<LiveDecoKind> = new Set(["hide", "math", "image", "link-pill", "footnote-back"]);

/// La punteggiatura che non comincia una riga.
const TRAILING_PUNCTUATION = /^[,.;:!?)\]»”’]+/;

/// Un pezzo sostituito (un segno nascosto, una formula, un'immagine, una
/// pastiglia) seguito da punteggiatura non va a capo da solo: la lettera prima
/// del pezzo, il pezzo e la punteggiatura stanno sotto un `cm-fub-nobreak`.
function keepPunctuation(doc: EditorState["doc"], out: LiveDeco[]): void {
  const glued: LiveDeco[] = [];
  for (const d of out) {
    if (!REPLACED.has(d.kind)) continue;
    if (d.from === d.to) continue;
    const line = doc.lineAt(d.from);
    if (d.to > line.to) continue;
    const after = TRAILING_PUNCTUATION.exec(doc.sliceString(d.to, Math.min(line.to, d.to + 8)));
    if (!after) continue;
    // La lettera prima, se c'è, nessun altro pezzo la sostituisce e nessuno
    // stile finisce su di lei: uno stile tagliato in due mostra il suo fondo
    // e il suo margine due volte («ricordar e»).
    const letter = d.from - 1;
    const free = letter >= line.from && !/\s/.test(doc.sliceString(letter, d.from))
      && !out.some((o) => o !== d && REPLACED.has(o.kind) && o.from <= letter && letter < o.to)
      && !out.some((o) => !REPLACED.has(o.kind) && o.kind !== "nobreak" && o.from <= letter && letter < o.to && o.to <= d.from);
    const before = free ? letter : d.from;
    glued.push({ from: before, to: d.to + after[0].length, kind: "nobreak" });
  }
  out.push(...glued);
}

/// Gli elementi in riga che hanno un segno d'apertura e uno di chiusura come
/// figli, e il nome di quei segni.
const MARKED_ELEMENTS: Readonly<Record<string, string>> = {
  StrongEmphasis: "EmphasisMark",
  Emphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  Superscript: "SuperscriptMark",
  Subscript: "SubscriptMark",
  InlineCode: "CodeMark",
};

/// L'elemento coi segni il cui contenuto è esattamente `from`–`to`: è quello
/// che una cancellazione lascerebbe vuoto.
function elementOfContent(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    const mark = MARKED_ELEMENTS[node.name];
    if (!mark) continue;
    const marks = node.getChildren(mark);
    if (marks.length >= 2 && marks[0]!.to === from && marks[marks.length - 1]!.from === to) return node;
    if (node.from < from && to < node.to) return null;
  }
  return null;
}

/// La cancellazione di un carattere con la politica `mai`, accanto ai segni
/// nascosti (`hidden`): il cursore salta i segni e cancella la lettera dopo
/// di loro, e una lettera che è tutto il contenuto del suo elemento porta via
/// anche i segni. `null` quando non c'è niente di questo, e vale il tasto di
/// sempre: una selezione, un segno a inizio o fine riga (il prefisso di un
/// blocco), una lettera qualunque.
export function hiddenDeletion(
  state: EditorState,
  hidden: RangeSet<Decoration>,
  forward: boolean,
): TransactionSpec | null {
  if (state.selection.ranges.some((range) => !range.empty)) return null;
  let special = false;
  let blocked = false;
  const result = state.changeByRange((range) => {
    let pos = range.head;
    let skipped = false;
    for (;;) {
      let next = -1;
      hidden.between(pos, pos, (from, to) => {
        if (!forward && to === pos && from < pos) next = from;
        if (forward && from === pos && to > pos) next = to;
      });
      if (next < 0) break;
      pos = next;
      skipped = true;
    }
    const line = state.doc.lineAt(pos);
    if ((!forward && pos === line.from) || (forward && pos === line.to)) {
      if (skipped) blocked = true;
      return { range };
    }
    const column = pos - line.from;
    const from = forward ? pos : line.from + findClusterBreak(line.text, column, false);
    const to = forward ? line.from + findClusterBreak(line.text, column, true) : pos;
    let element = elementOfContent(state, from, to);
    // `***x***`: l'elemento vuoto è tutto il contenuto di quello che lo
    // contiene, e se ne vanno anche i segni di fuori.
    for (let outer = element; outer; outer = elementOfContent(state, outer.from, outer.to)) element = outer;
    if (element) {
      special = true;
      return { changes: { from: element.from, to: element.to }, range: EditorSelection.cursor(element.from) };
    }
    if (skipped) special = true;
    return { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (!special || blocked) return null;
  return { ...result, scrollIntoView: true, userEvent: forward ? "delete.forward" : "delete.backward" };
}

// ---------------------------------------------------------------------------
// Da qui in giù: widget, gesti DOM, tema e lifecycle del plugin CM6.

const mathTeardowns = new WeakMap<HTMLElement, () => void>();

/// Una formula in riga resa al posto del suo `$…$` fuori dalla riga attiva.
/// Il motore è quello della Lettura (`mountMathBlocks`), caricato solo quando
/// una formula c'è; lo smontaggio del widget chiude anche il suo caricamento.
const ATTR_TEX = "data-fub-tex";

/// Il contenuto di un tag ammesso porta l'elemento vero; quelli che la Live
/// disegna già con una sua classe la portano anche.
const HTML_CLASSES: Readonly<Record<string, string>> = {
  mark: "cm-fub-highlight", sup: "cm-fub-sup", sub: "cm-fub-sub", code: "cm-fub-code", del: "cm-fub-strike",
  strong: "cm-fub-strong", em: "cm-fub-em",
};
const htmlMarks = new Map<string, Decoration>();
/// `data` è il nome del tag, seguito dalle classi dei colori se ne ha (K1).
function htmlMark(data: string): Decoration {
  let mark = htmlMarks.get(data);
  if (!mark) {
    const [name = "span", ...colors] = data.split(" ");
    mark = Decoration.mark({ tagName: name, class: ["cm-fub-html", HTML_CLASSES[name] ?? "", ...colors].filter(Boolean).join(" ") });
    htmlMarks.set(data, mark);
  }
  return mark;
}

/// La formula in riga della vista in `pos`, resa o rivelata: `side` 1 vuole
/// quella che comincia lì, -1 quella che finisce lì, 0 quella che lo contiene.
function formulaIn(set: DecorationSet | undefined, pos: number, side: -1 | 0 | 1): LiveFormula | null {
  let found: LiveFormula | null = null;
  set?.between(pos, pos, (from, to, decoration) => {
    const widget = decoration.spec.widget;
    const tex = widget instanceof InlineMathWidget ? widget.tex
      : decoration.spec.class === "cm-fub-math-source" ? String(decoration.spec.attributes?.[ATTR_TEX] ?? "") : null;
    if (tex === null) return;
    if (side === 1 ? from !== pos : side === -1 ? to !== pos : pos < from || pos > to) return;
    found = { from, to, tex };
    return false;
  });
  return found;
}

/// Il numero della colonna di `node`, se è un `[!column]` dentro un
/// `[!columns]` di primo livello; altrimenti `null`.
function columnIndex(node: SyntaxNode, doc: Text): number | null {
  const parent = node.parent;
  if (parent?.name !== "Blockquote" || parent.parent?.name !== "Document") return null;
  if (calloutHead(doc.lineAt(parent.from).text)?.type !== "columns") return null;
  if (calloutHead(doc.lineAt(node.from).text)?.type !== "column") return null;
  let index = 1;
  for (let other = node.prevSibling; other; other = other.prevSibling) if (other.name === "Blockquote") index++;
  return index;
}

/// L'etichetta di una colonna toccata, al posto di `[!column]`.
class ColumnLabelWidget extends WidgetType {
  constructor(readonly index: number) { super(); }
  eq(other: ColumnLabelWidget): boolean { return other.index === this.index; }
  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "cm-fub-column-label";
    label.textContent = liveStrings.t("live.columns.column", { index: String(this.index) });
    return label;
  }
}

class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  eq(other: InlineMathWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-fub-math";
    const formula = document.createElement("span");
    formula.className = "math-inline";
    formula.dataset.tex = this.tex;
    formula.textContent = this.tex;
    wrapper.appendChild(formula);
    mathTeardowns.set(wrapper, mountMathBlocks(wrapper));
    return wrapper;
  }
  destroy(dom: HTMLElement) {
    mathTeardowns.get(dom)?.();
    mathTeardowns.delete(dom);
  }
  ignoreEvent() {
    return false;
  }
}

const imageMounts = new WeakMap<HTMLElement, () => void>();

/// Un'immagine del vault in mezzo al testo, fuori dalla riga attiva. L'HTML è
/// quello della Lettura e lo monta la stessa resa (`mountRendered`):
/// sanificato, idratato con un lease del kernel, chiuso con lo smontaggio del
/// widget. Un clic la seleziona (`image-live.ts`): contorno e maniglia della
/// larghezza; Mod-clic apre l'immagine a tutta finestra.
class InlineImageWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly length: number,
    readonly selected: boolean,
    readonly callbacks: LivePreviewCallbacks,
  ) { super(); }
  eq(other: InlineImageWidget) {
    return other.html === this.html && other.length === this.length && other.selected === this.selected;
  }
  /// Selezionarla non la rimonta: cambia la classe, l'immagine resta caricata.
  updateDOM(dom: HTMLElement, _view: EditorView, from: this) {
    if (from.html !== this.html) return false;
    dom.dataset.fubImage = String(this.length);
    dom.classList.toggle("cm-fub-image-selected", this.selected);
    return true;
  }
  toDOM(view: EditorView) {
    const root = document.createElement("span");
    root.className = this.selected ? "cm-fub-image cm-fub-image-selected" : "cm-fub-image";
    root.dataset.fubImage = String(this.length);
    const unmount = this.callbacks.mountRendered
      ? this.callbacks.mountRendered(root, this.html, {})
      : mountMarkdown(root, this.html, {
        openWikilink: (page, heading, block) => this.callbacks.openWikilink(page, heading ?? null, block ?? null),
        searchTag: this.callbacks.searchTag,
      });
    // I byte arrivano dopo il widget: la riga cambia altezza quando l'immagine
    // si carica, e CodeMirror deve rimisurarla.
    const measure = () => view.requestMeasure();
    root.addEventListener("load", measure, true);
    root.addEventListener("markdown-resize", measure);
    const handle = document.createElement("span");
    handle.className = "cm-fub-image-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.title = liveStrings.t("live.image.handle");
    root.append(handle);
    imageMounts.set(root, () => {
      root.removeEventListener("load", measure, true);
      root.removeEventListener("markdown-resize", measure);
      unmount();
    });
    return root;
  }
  destroy(root: HTMLElement) {
    imageMounts.get(root)?.();
    imageMounts.delete(root);
  }
  ignoreEvent(event: Event) {
    return event instanceof MouseEvent && interactiveTarget(event.target instanceof Element ? event.target : null, event);
  }
}

/// La linea resa al posto di `---`/`***` fuori dalla riga attiva.
/// Ciò che la pastiglia di un collegamento dice: il dominio di un indirizzo,
/// «nota › titolo» di un wikilink, il percorso di un file.
export function pillLabel(destination: string): string {
  if (destination.startsWith("[[") && destination.endsWith("]]")) {
    const target = parseWikilinkInner(destination.slice(2, -2));
    return [target.page, target.heading ?? (target.block ? `^${target.block}` : null)].filter(Boolean).join(" › ");
  }
  if (/^mailto:/i.test(destination)) return destination.slice(7);
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) {
    try {
      const url = new URL(destination);
      return url.hostname ? url.hostname.replace(/^www\./, "") : destination;
    } catch {
      return destination;
    }
  }
  const path = decodeDestination(destination);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

class LinkPillWidget extends WidgetType {
  constructor(readonly destination: string) { super(); }
  eq(other: LinkPillWidget) { return other.destination === this.destination; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-fub-link-pill";
    el.textContent = pillLabel(this.destination);
    el.title = liveStrings.t("live.link.pill", { target: this.destination });
    return el;
  }
  ignoreEvent() { return false; }
}

/// Il ↩ di una definizione di nota: porta al primo rimando, come in Lettura.
class FootnoteBackWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: FootnoteBackWidget) { return other.label === this.label; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-fub-footnote-back";
    el.textContent = "↩";
    el.title = liveStrings.t("live.footnote.back");
    el.setAttribute(ATTR_FOOTNOTE, this.label);
    return el;
  }
  ignoreEvent() { return false; }
}

/// La fine del primo rimando a una nota (`[^etichetta]` che non sia la sua
/// definizione), o `null` se nessun testo la chiama.
export function firstFootnoteReference(doc: EditorState["doc"], label: string): number | null {
  const wanted = normalizeLabel(label);
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("[^")) continue;
    const definition = FOOTNOTE_DEFINITION.exec(line.text);
    for (const found of line.text.matchAll(/\[\^([^\] \t\r\n]+)\]/g)) {
      if (definition && found.index === 0) continue;
      if (normalizeLabel(found[1]!) === wanted) return line.from + found.index! + found[0].length;
    }
  }
  return null;
}

class RulerWidget extends WidgetType {
  eq() {
    return true; // tutti i righelli sono uguali: il DOM si riusa sempre
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-fub-hr";
    return el;
  }
}

/// La checkbox reale al posto di `[ ]`/`[x]`. Il click lo gestisce il plugin
/// (posAtDOM → modifica del testo sottostante), non il widget: la sorgente di
/// verità resta il documento.
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-fub-checkbox";
    box.tabIndex = -1; // il focus resta all'editor
    const labelKey = this.checked ? "editor.task.completed" : "editor.task.pending";
    box.dataset.i18nLabel = labelKey;
    box.setAttribute("aria-label", t(labelKey));
    return box;
  }
  ignoreEvent() {
    return false; // lascia arrivare il mousedown agli handler del plugin
  }
}

// Decorazioni riusate (una per kind): l'identità stabile permette a CM di
// confrontare e riusare il DOM tra un ricalcolo e l'altro.
const hidden = Decoration.replace({});
const ruler = Decoration.replace({ widget: new RulerWidget() });
const boxEmpty = Decoration.replace({ widget: new CheckboxWidget(false) });
const checkedBox = Decoration.replace({ widget: new CheckboxWidget(true) });
const codeLine = Decoration.line({ class: "cm-fub-codeblock" });
const codeHeaderLine = Decoration.line({ class: "cm-fub-code-header-line" });
const fenceCloseLine = Decoration.line({ class: "cm-fub-fence-close-line" });
const HEADING_LINES: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
  (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map(
    (kind) => [kind, Decoration.line({ class: `cm-fub-heading-line cm-fub-${kind}-line` })],
  ),
);
const quoteLine = Decoration.line({ class: "cm-fub-quote" });
const calloutTitle = Decoration.mark({ class: "cm-fub-callout-title" });
const calloutLines = new Map<string, Decoration>();
function calloutLine(type: string): Decoration {
  let line = calloutLines.get(type);
  if (!line) {
    line = Decoration.line({ class: "cm-fub-callout-line", attributes: { "data-callout": type } });
    calloutLines.set(type, line);
  }
  return line;
}
const bulletMark = Decoration.mark({ class: "cm-fub-bullet" });
const taskMark = Decoration.mark({ class: "cm-fub-bullet cm-fub-bullet-task" });
const marksMap: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
  (["h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "strike", "sup", "sub", "code", "link", "highlight", "done", "quote-mark", "near", "nobreak", "footnote-label"] as const).map(
    (kind) => [kind, Decoration.mark({ class: `cm-fub-${kind}` })],
  ),
);

function inDecoration(d: LiveDeco, callbacks: LivePreviewCallbacks): Decoration {
  switch (d.kind) {
    case "hide":
      return hidden;
    case "hr":
      return ruler;
    case "checkbox":
      return d.data === "x" ? checkedBox : boxEmpty;
    case "math":
      return Decoration.replace({ widget: new InlineMathWidget(d.data ?? "") });
    case "image":
      return Decoration.replace({ widget: new InlineImageWidget(d.data ?? "", d.to - d.from, d.selected === true, callbacks) });
    case "link-pill":
      return Decoration.replace({ widget: new LinkPillWidget(d.data ?? "") });
    case "footnote-back":
      return Decoration.replace({ widget: new FootnoteBackWidget(d.data ?? "") });
    case "codeblock-line":
      return codeLine;
    case "code-header":
      return Decoration.replace({ widget: new CodeHeaderWidget(d.data ?? "", true) });
    case "fence-close":
      return hidden;
    case "html":
      return htmlMark(d.data ?? "span");
    case "math-source":
      return Decoration.mark({ class: "cm-fub-math-source", attributes: { [ATTR_TEX]: d.data ?? "" } });
    case "list-bullet":
      return d.data === "task" ? taskMark : bulletMark;
    case "quote-line":
      return quoteLine;
    case "callout-line":
      return calloutLine(d.data ?? "");
    case "callout-type": {
      const data = d.data ?? "";
      const fold = data.endsWith("+") || data.endsWith("-") ? data.slice(-1) as "+" | "-" : null;
      return Decoration.replace({ widget: new CalloutTypeWidget(fold ? data.slice(0, -1) : data, fold) });
    }
    case "callout-title":
      return calloutTitle;
    case "column-label":
      return Decoration.replace({ widget: new ColumnLabelWidget(Number(d.data ?? "1")) });
    // Il payload viaggia nel DOM come data-attribute: il gestore del click
    // lo rilegge da lì, senza mappe posizione→dato da tenere sincronizzate.
    case "link":
      return Decoration.mark({
        class: "cm-fub-link",
        attributes: { [ATTR_HREF]: d.data ?? "" },
      });
    case "highlight":
      return d.data
        ? Decoration.mark({ class: `cm-fub-${d.data}` })
        : marksMap[d.kind]!;
    case "wikilink": {
      // Il bersaglio anche nel contratto che la resa dà alla shell
      // (`data-wikilink-*`, come in Lettura): chi guarda il link sotto il
      // puntatore, come l'anteprima al passaggio, non conosce la grammatica
      // di questo profilo.
      const target = parseWikilinkInner(d.data ?? "");
      // Un'emoji si scrive col `::before`; una figura del set ha la sua
      // maschera (`data-page-figure`); un `fub:` sconosciuto non si mostra.
      const mark = readPageMark(target.page ? callbacks.pageIcon?.(target.page) ?? null : null);
      const person = target.page !== "" && callbacks.isPerson?.(target.page) === true;
      return Decoration.mark({
        class: person ? "cm-fub-wikilink cm-fub-person" : "cm-fub-wikilink",
        attributes: {
          [ATTR_WIKILINK]: d.data ?? "",
          "data-wikilink-page": target.page,
          ...(mark?.kind === "text" ? { "data-page-icon": mark.text } : {}),
          ...(mark?.kind === "figure" ? { "data-page-figure": mark.name } : {}),
          ...(target.heading ? { "data-wikilink-heading": target.heading } : {}),
          ...(target.block ? { "data-wikilink-block": target.block } : {}),
        },
      });
    }
    case "tag":
      return Decoration.mark({
        class: "cm-fub-tag",
        attributes: { [ATTR_TAG]: d.data ?? "" },
      });
    default:
      return marksMap[d.kind]!;
  }
}

function handleClick(e: MouseEvent, view: EditorView, cb: LivePreviewCallbacks): boolean {
  if (e.button !== 0) return false;
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target) return false;

  // Checkbox: si modifica il testo, non il widget — la decorazione nuova
  // arriva da sola col docChanged.
  if (target instanceof HTMLInputElement && target.classList.contains("cm-fub-checkbox")) {
    // Il mousedown conserva la selezione; il click è l'unico gesto che
    // modifica il testo. Annullare anche il click in sola lettura impedisce
    // al controllo HTML di mostrare uno stato diverso dalla sorgente.
    if (e.type === "mousedown" || view.state.readOnly) {
      e.preventDefault();
      return true;
    }
    const pos = view.posAtDOM(target);
    const threeChars = view.state.doc.sliceString(pos, pos + 3);
    if (/^\[[^\]\n]\]$/.test(threeChars)) {
      const checked = !taskChecked(threeChars[1]);
      const line = view.state.doc.lineAt(pos);
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: checked ? "x" : " " },
        annotations: blockGesture.of({ kind: "check", lead: { from: line.from, to: line.to }, say: liveStrings.t(checked ? "blocks.checked" : "blocks.unchecked") }),
        // Come ogni battuta di contenuto: senza, la modifica cade fuori dalla
        // history nativa dell'editor.
        userEvent: "input",
      });
      e.preventDefault();
      return true;
    }
    return false;
  }

  if (e.type === "click") return false;

  const wikilink = target.closest<HTMLElement>(".cm-fub-wikilink");
  if (wikilink && (e.ctrlKey || e.metaKey)) {
    // L'attributo porta il bersaglio come sta scritto nella sorgente: qui lo
    // si ripassa dalla stessa grammatica di prima, invece di ri-serializzarlo.
    const labelledBy = parseWikilinkInner(wikilink.getAttribute(ATTR_WIKILINK) ?? "");
    cb.openWikilink(labelledBy.page, labelledBy.heading, labelledBy.block);
    e.preventDefault();
    return true;
  }

  const link = target.closest<HTMLElement>(".cm-fub-link");
  if (link && (e.ctrlKey || e.metaKey)) {
    const href = link.getAttribute(ATTR_HREF);
    // Naviga solo ciò che il sanitizzatore lascia passare (stessa policy di
    // Lettura): `javascript:…`, `data:…` e i protocol-relative restano fermi.
    if (href && isAllowedLink(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      e.preventDefault();
      return true;
    }
    return false;
  }

  const tag = target.closest<HTMLElement>(".cm-fub-tag");
  if (tag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const pos = view.posAtDOM(tag);
    if (activeLinesOf(view.state).has(view.state.doc.lineAt(pos).number)) return false;
    cb.searchTag(tag.getAttribute(ATTR_TAG) ?? "");
    e.preventDefault();
    return true;
  }
  return false;
}

// Il tema del modulo: solo classi cm-fub-*, dentro l'estensione. I **valori**
// dei colori vengono però dalle variabili della superficie del documento
// (`--doc-*` in `theme/scrittoio/sheet-dark.css`): sono gli stessi che usa la modalità Lettura, e
// tenerne due copie significherebbe che passare da Live a Lettura cambia i
// colori della stessa nota. Le variabili hanno un fallback, così l'estensione
// resta montabile anche senza il CSS della shell.
const theme = EditorView.baseTheme({
  ".cm-markdown-gap": { height: "0", lineHeight: "0", fontSize: "0", padding: "0" },
  // La stessa scala della Lettura (`preview.css`): relativa al corpo, e
  // sempre in discesa, in misura e in peso.
  ".cm-fub-h1": { fontSize: "max(1.75em, var(--text-3xl, 1.75em))", fontWeight: "700", letterSpacing: "-0.01em" },
  ".cm-fub-h2": { fontSize: "max(1.45em, var(--text-2xl, 1.45em))", fontWeight: "700", letterSpacing: "-0.005em" },
  ".cm-fub-h3": { fontSize: "1.22em", fontWeight: "650" },
  ".cm-fub-h4": { fontSize: "1.08em", fontWeight: "650" },
  ".cm-fub-h5": { fontSize: "0.85em", fontWeight: "700", letterSpacing: "var(--tracking-caps, 0.06em)", textTransform: "uppercase" },
  ".cm-fub-h6": { fontSize: "0.85em", fontWeight: "500", letterSpacing: "var(--tracking-caps, 0.06em)", textTransform: "uppercase" },
  ".cm-fub-heading-line": { paddingTop: "0.9em", paddingBottom: "0.2em" },
  ".cm-fub-h1-line": { paddingTop: "1.2em", borderBottom: "1px solid var(--doc-rule-soft, rgba(135, 135, 135, 0.3))", paddingBottom: "0.3em", marginBottom: "0.4em" },
  ".cm-fub-h2-line": { paddingTop: "1.1em" },
  ".cm-line:first-child.cm-fub-heading-line": { paddingTop: "0" },
  ".cm-fub-h1, .cm-fub-h2, .cm-fub-h3, .cm-fub-h4, .cm-fub-h5, .cm-fub-h6": {
    color: "var(--doc-heading, var(--doc-fg))", lineHeight: "var(--leading-tight, 1.2)",
  },
  ".cm-fub-h1 > span, .cm-fub-h2 > span, .cm-fub-h3 > span, .cm-fub-h4 > span, .cm-fub-h5 > span, .cm-fub-h6 > span": {
    color: "inherit",
  },
  ".cm-fub-strong": { fontWeight: "700" },
  ".cm-fub-em": { fontStyle: "italic" },
  ".cm-fub-strike": { textDecoration: "line-through" },
  ".cm-fub-sup": { verticalAlign: "super", fontSize: "0.75em", lineHeight: "0" },
  ".cm-fub-sub": { verticalAlign: "sub", fontSize: "0.75em", lineHeight: "0" },
  ".cm-fub-nobreak": { whiteSpace: "nowrap" },
  // I colori della nota e del segno rivelato sono della pelle (`document.css`).
  ".cm-fub-footnote-label": { fontWeight: "600" },
  ".cm-fub-footnote-back": { marginInline: "0.25em 0.5em", cursor: "pointer" },
  // Il segno resta nel testo, trasparente: il pallino gli sta sopra, largo
  // quanto lui.
  ".cm-fub-bullet, .cm-fub-bullet *": { color: "transparent" },
  ".cm-fub-bullet": { position: "relative" },
  ".cm-fub-bullet::before": {
    content: '"•"',
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    color: "var(--muted, rgba(135, 135, 135, 0.9))",
  },
  ".cm-fub-bullet-task::before": { content: "none" },
  ".cm-fub-code": {
    background: "var(--doc-fill, rgba(135, 135, 135, 0.16))",
    fontFamily: "var(--font-mono, monospace)",
    borderRadius: "3px",
    padding: "0 0.15em",
  },
  ".cm-fub-codeblock": { background: "var(--doc-fill-soft, rgba(135, 135, 135, 0.10))" },
  ".cm-fub-quote": {
    borderLeft: "3px solid var(--doc-rule, rgba(135, 135, 135, 0.45))",
    paddingLeft: "0.6em",
  },
  ".cm-fub-quote-mark": { color: "rgba(135, 135, 135, 0.8)" },
  // La pastiglia di un collegamento: piccola, dopo il testo, non è testo.
  ".cm-fub-link-pill": {
    display: "inline-block",
    marginLeft: "0.3em",
    padding: "0 0.45em",
    borderRadius: "999px",
    fontSize: "0.75em",
    lineHeight: "1.5",
    verticalAlign: "0.1em",
    // Colore e fondo sono della pelle (`document.css`).
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  ".cm-fub-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: "1px solid var(--doc-rule, rgba(135, 135, 135, 0.55))",
  },
  ".cm-fub-link, .cm-fub-wikilink": {
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    color: "var(--doc-link)",
  },
  // L'icona della pagina nominata, fuori dal testo: il cursore non la vede.
  ".cm-fub-wikilink[data-page-icon]::before": {
    content: "attr(data-page-icon)",
    marginInlineEnd: "0.2em",
    display: "inline-block",
    textDecoration: "none",
  },
  ".cm-fub-highlight": { background: "var(--doc-highlight, rgba(255, 205, 0, 0.35))" },
  "&dark .cm-fub-highlight": { background: "var(--doc-highlight, rgba(255, 205, 0, 0.28))" },
  ".cm-fub-tag": {
    background: "var(--doc-fill, rgba(135, 135, 135, 0.18))",
    borderRadius: "1em",
    padding: "0 0.45em",
    fontSize: "0.95em",
    cursor: "pointer",
    // Un solo colore per entrambe le luci: il valore vive nei token del
    // foglio (`--doc-link`) e cambia con la luce. Prima c'erano due regole
    // `&light`/`&dark` con fallback cablati (#2f6bd8, #82aaff) che non
    // coincidevano coi token — una terza copia della stessa coppia, e una
    // divergenza che si vedeva solo a tema non caricato.
    color: "var(--doc-link)",
  },
  ".cm-fub-done": { textDecoration: "line-through", opacity: "0.55" },
  ".cm-fub-checkbox": {
    cursor: "pointer",
    verticalAlign: "middle",
    margin: "0 0.4em 0 0",
  },
  // Un'immagine in mezzo al testo sta nella riga, con un tetto: una foto
  // grande si guarda in Lettura o a tutta finestra. Senza dimensioni scritte
  // (`alt|120`) i due tetti conservano le proporzioni.
  ".cm-fub-image": { position: "relative", display: "inline-block", maxWidth: "100%", verticalAlign: "bottom" },
  // La maniglia della larghezza, sul bordo destro dell'immagine selezionata;
  // i colori sono della pelle (`document.css`).
  ".cm-fub-image-handle": {
    display: "none",
    position: "absolute",
    right: "-5px",
    top: "50%",
    width: "10px",
    height: "28px",
    marginTop: "-14px",
    boxSizing: "border-box",
    cursor: "ew-resize",
    touchAction: "none",
  },
  ".cm-fub-image.cm-fub-image-selected .cm-fub-image-handle": { display: "block" },
  ".cm-fub-image-size": { position: "absolute", top: "4px", right: "4px", pointerEvents: "none" },
  ".cm-fub-image figure": { margin: "0" },
  // Da sola nel paragrafo l'immagine ha più spazio: è il contenuto, non una
  // parola del testo.
  ".cm-fub-image figure img": { maxHeight: "32em" },
  ".cm-fub-image figcaption": { textAlign: "center" },
  ".cm-fub-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "16em",
    height: "auto",
    objectFit: "contain",
    borderRadius: "var(--radius-sm, 4px)",
  },
  ".cm-fub-image .embed": { display: "inline-block", margin: "0", padding: "0", border: "0", background: "none" },
});

/// L'estensione live preview, pronta da montare in `editor.ts` accanto a
/// `markdown()`. I callback sono iniettati dalla shell: qui non si sa cosa
/// significhi "aprire una nota".
const mountedBlocks = new WeakMap<HTMLElement, {
  from: number; source: string; dependencies: string; readOnly: boolean; dispose: () => void;
}>();

/// Sposta di `delta` le coordinate sorgente scritte nel DOM di un blocco reso.
/// Una trasclusione e un componente di un provider hanno coordinate loro.
function shiftMounted(root: HTMLElement, delta: number): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-md-from], [data-md-to], [data-md-task]")) {
    if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
    for (const key of ["mdFrom", "mdTo", "mdTask"] as const) {
      const value = element.dataset[key];
      if (value !== undefined) element.dataset[key] = String(Number(value) + delta);
    }
  }
}

/// Riporta le coordinate di un blocco reso al punto in cui il widget sta ora.
///
/// Un widget spostato da una modifica sopra di lui resta lo stesso per
/// CodeMirror (`eq` non guarda la posizione) e il suo DOM non si rifà: le
/// coordinate scritte dentro si leggono al gesto (click, casella, diagramma),
/// e qui tornano vere subito dopo l'aggiornamento della vista.
function realignMounted(view: EditorView, root: HTMLElement): void {
  const mounted = mountedBlocks.get(root);
  if (!mounted) return;
  let start: number;
  try {
    start = view.posAtDOM(root);
  } catch {
    return;
  }
  const from = start + Number(root.dataset.mdOffset ?? 0);
  const delta = from - mounted.from;
  if (!delta) return;
  shiftMounted(root, delta);
  mounted.from = from;
  root.dataset.sourceFrom = String(from);
}

function interactiveTarget(target: Element | null, event: MouseEvent): boolean {
  if (!target) return false;
  if (target.closest("button, input, select, textarea, summary, [data-ui-slot], .tag[data-tag]")) return true;
  // Mod-clic segue un link e apre un'immagine del vault a tutta finestra: il
  // gesto lo gestisce la resa (`mount.ts`), l'editor non sposta il cursore.
  return !!target.closest("a, img[data-vault-id]") && (event.ctrlKey || event.metaKey);
}
/// La riga sorgente del blocco sotto il punto, senza leggere l'editor.
///
/// Il widget scrive `data-md-lines`: il numero di righe sorgente del blocco.
/// Il gestore del click riceve solo il DOM, e il testo del `.cm-content` è
/// sorgente più resa intercalata — non affettabile per offset. Con il numero
/// di righe sorgente e l'indice della riga resa, la riga cliccata è nota
/// senza leggere il documento.
function sourceLineCount(mapped: HTMLElement): number | null {
  const raw = mapped.dataset.mdLines;
  if (raw === undefined) return null;
  const count = Number(raw);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

///
/// Il testo reso non ha le stesse righe della sorgente: un codeblock di 4
/// righe è un solo `<pre>`, un elenco collassa i marcatori, l'highlight
/// spezza i nodi di testo. Contare i caratteri resi (`prefix.toString()` su
/// tutto il blocco) sbaglia riga — e spesso blocco. La mappa invece scende
/// per coordinate: il figlio con `data-md-*` sotto il punto vince, e dentro
/// di lui la colonna si misura dal suo inizio, non dall'inizio del blocco.
/// Ogni passo riusa le coordinate che il renderer ha già scritto.
function caretAtPoint(document: Document, x: number, y: number): { node: Node; offset: number } | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
  };
  const caret = caretDocument.caretPositionFromPoint?.(x, y);
  const range = caret ? null : caretDocument.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? range?.startContainer ?? null;
  if (!node) return null;
  return { node, offset: caret?.offset ?? range?.startOffset ?? 0 };
}

/// Il discendente mappato sotto il punto.
///
/// `elementFromPoint` vede il DOM reso per quello che è — span di highlight,
/// voci di elenco, celle — e il `closest` risale al primo antenato con
/// coordinate sorgente. Il `caretPositionFromPoint` resta per la colonna
/// dentro l'elemento trovato.
function mappedUnderPoint(root: HTMLElement, x: number, y: number): HTMLElement | null {
  const document = root.ownerDocument;
  const element = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  const mapped = element instanceof Element ? element.closest<HTMLElement>("[data-md-from][data-md-to]") : null;
  if (mapped && root.contains(mapped) && !mapped.closest(".embed-loaded, [data-ui-slot]")) return mapped;
  return null;
}

/// La colonna dentro l'elemento mappato, dal caret del browser.
///
/// Il prefisso si misura solo dentro il mappato sotto il punto — mai su
/// tutto il blocco — così le righe sopra non spostano la colonna. Fuori
/// dall'elemento (caret su un marcatore collassato) vale zero.
function columnInMapped(mapped: HTMLElement, caret: { node: Node; offset: number }): number {
  if (!mapped.contains(caret.node)) return 0;
  const prefix = mapped.ownerDocument.createRange();
  prefix.selectNodeContents(mapped);
  try {
    prefix.setEnd(caret.node, caret.offset);
  } catch {
    return 0;
  }
  return prefix.toString().length;
}

/// La posizione dentro un mappato noto, con caret noto.
///
/// Separata da `sourcePositionAtPoint` per poterla provare senza geometria
/// del browser: il chiamante passa il mappato sotto il punto e il caret.
export function sourcePositionInMapped(root: HTMLElement, mapped: HTMLElement, caret: { node: Node; offset: number } | null, y: number): number {
  const fallback = Number(root.dataset.sourceFrom ?? 0);
  const from = Number(mapped.dataset.mdFrom), to = Number(mapped.dataset.mdTo);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) return fallback;
  if (mapped.tagName === "PRE") {
    // Il `<pre>` è un solo mappato per N righe: la riga resa sotto il punto
    // si conta sul rettangolo, poi si cammina il documento vero riga per
    // riga — la vista CodeMirror è raggiungibile dal DOM.
    const widget = mapped.closest<HTMLElement>(".cm-markdown-block");
    const blockFrom = widget ? Number(widget.dataset.sourceFrom ?? NaN) : NaN;
    const lines = widget ? sourceLineCount(widget) : null;
    if (!Number.isSafeInteger(blockFrom) || lines === null) return from;
    const rows = Math.max(1, (mapped.textContent ?? "").split("\n").length);
    const row = renderedRowIndex(mapped, y, rows);
    return sourceLineAt(widget, blockFrom, row + 1);
  }
  if (!caret) return from;
  return Math.min(to, from + columnInMapped(mapped, caret));
}

/// L'offset di inizio della riga `row` del blocco, letto dalla vista.
///
/// Il widget conosce `sourceFrom` (inizio blocco) e `data-md-lines` (righe
/// sorgente): la vista dà la riga iniziale, poi si avanza di `row` righe.
function sourceLineAt(widget: HTMLElement | null, blockFrom: number, row: number): number {
  if (!widget) return blockFrom;
  const content = widget.closest(".cm-content");
  const view = content instanceof HTMLElement ? EditorView.findFromDOM(content) : null;
  if (!view) return blockFrom;
  try {
    const start = view.state.doc.lineAt(blockFrom).number;
    const target = Math.min(view.state.doc.lines, start + row);
    return view.state.doc.line(target).from;
  } catch {
    return blockFrom;
  }
}

/// La posizione del click in coordinate sorgente.
export function sourcePositionAtPoint(root: HTMLElement, x: number, y: number): number {
  const fallback = Number(root.dataset.sourceFrom ?? 0);
  const mapped = mappedUnderPoint(root, x, y);
  if (!mapped) return fallback;
  return sourcePositionInMapped(root, mapped, caretAtPoint(root.ownerDocument, x, y), y);
}

/// L'indice della riga resa sotto il punto, per un mappato multiriga.
///
/// Il `<pre>` non ha figli per riga: il rettangolo si divide in parti uguali
/// sul numero di righe del testo. Le righe rese e sorgente coincidono una a
/// una — il renderer non tocca il contenuto del codice.
function renderedRowIndex(mapped: HTMLElement, y: number, count = Math.max(1, (mapped.textContent ?? "").split("\n").length)): number {
  const rect = mapped.getBoundingClientRect();
  const rows = Math.max(1, count);
  const row = Math.floor(((y - rect.top) / Math.max(1, rect.height)) * rows);
  return Math.min(rows - 1, Math.max(0, row));
}

class MarkdownWidget extends WidgetType {
  /// Quanto il blocco comincia dopo l'inizio della riga su cui il widget sta.
  readonly offset: number;
  constructor(
    readonly block: MarkdownBlock,
    rangeFrom: number,
    readonly dependencies: string,
    readonly readOnly: boolean,
    readonly callbacks: LivePreviewCallbacks,
    /// Le ancore del documento di adesso, lette al gesto: non fanno parte del
    /// widget, che resta lo stesso quando un titolo altrove cambia posto.
    readonly anchorsOf: (state: EditorState) => ReadonlyMap<string, number>,
  ) {
    super();
    this.offset = block.from - rangeFrom;
  }
  get estimatedHeight(): number {
    return Math.max(1, Math.ceil(this.block.source.length / 70)) * 28 + 8;
  }
  /// La posizione non conta: un blocco spostato da una modifica sopra di lui
  /// tiene il suo DOM, e `realignMounted` ne corregge le coordinate.
  eq(other: MarkdownWidget): boolean {
    return this.block.source === other.block.source && this.dependencies === other.dependencies
      && this.readOnly === other.readOnly && this.offset === other.offset;
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-markdown-block markdown-rendered";
    root.contentEditable = "false";
    root.dataset.sourceFrom = String(this.block.from);
    root.dataset.mdOffset = String(this.offset);
    // Il click geometrico nel `<pre>` conta le righe sorgente: il widget le
    // scrive qui, così il gestore non deve leggere l'editor.
    root.dataset.mdLines = String(this.block.source.split("\n").length);
    // Il ritmo verticale della pelle distingue i titoli che aprono una
    // sezione: il kind con livello viaggia sul widget, così nessun
    // selettore `:has` deve risalire dal figlio al contenitore.
    if (this.block.kind === "heading") root.dataset.mdKind = "heading";
    else if (/^heading-[1-6]$/.test(this.block.kind)) root.dataset.mdKind = this.block.kind;
    const actions = {
      navigateFragment: (id: string) => {
        let decoded = id;
        try { decoded = decodeURIComponent(id); } catch { return false; }
        const position = this.anchorsOf(view.state).get(decoded);
        if (position === undefined) return false;
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position) });
        view.focus();
        return true;
      },
      toggleTask: this.readOnly ? undefined : (position: number) => {
        if (view.state.readOnly || position < 1 || position + 1 >= view.state.doc.length) return;
        const marker = view.state.doc.sliceString(position - 1, position + 2);
        if (!/^\[[^\]\r\n]\]$/.test(marker)) return;
        view.dispatch({
          changes: { from: position, to: position + 1, insert: taskChecked(marker[1]!) ? " " : "x" },
          userEvent: "input",
        });
      },
      openSource: (position: number) => {
        const anchor = Math.max(0, Math.min(view.state.doc.length, position));
        view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor), userEvent: "select.pointer" });
        view.focus();
      },
      editFence: this.readOnly ? undefined : (position: number, body: string, edit: { from: number; to: number; insert: string }) => {
        const doc = view.state.doc;
        if (view.state.readOnly || position < 0 || position > doc.length) return;
        // Il corpo comincia alla riga dopo quella che apre il recinto, e deve
        // essere ancora il testo che la resa ha letto: un recinto dentro una
        // citazione o un elenco ha prefissi per riga, e lì non si scrive.
        const opener = doc.lineAt(position);
        if (opener.number >= doc.lines) return;
        const start = opener.to + 1;
        if (edit.from < 0 || edit.to < edit.from || edit.to > body.length
          || doc.sliceString(start, start + body.length) !== body) return;
        view.dispatch({ changes: { from: start + edit.from, to: start + edit.to, insert: edit.insert }, userEvent: "input" });
      },
    };
    const unmount = this.callbacks.mountRendered
      ? this.callbacks.mountRendered(root, this.block.html, actions)
      : mountMarkdown(root, this.block.html, {
        ...actions,
        openWikilink: (page, heading, block) => this.callbacks.openWikilink(page, heading ?? null, block ?? null),
        searchTag: this.callbacks.searchTag,
      });
    const measure = () => view.requestMeasure();
    root.addEventListener("markdown-resize", measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(measure);
    observer?.observe(root);
    mountedBlocks.set(root, {
      from: this.block.from, source: this.block.source, dependencies: this.dependencies, readOnly: this.readOnly,
      dispose: () => {
        observer?.disconnect();
        root.removeEventListener("markdown-resize", measure);
        unmount();
      },
    });
    return root;
  }
  updateDOM(root: HTMLElement): boolean {
    const mounted = mountedBlocks.get(root);
    if (!mounted || mounted.source !== this.block.source || mounted.dependencies !== this.dependencies
      || mounted.readOnly !== this.readOnly) return false;
    const delta = this.block.from - mounted.from;
    if (delta) {
      shiftMounted(root, delta);
      mounted.from = this.block.from;
      root.dataset.sourceFrom = String(this.block.from);
    }
    root.dataset.mdOffset = String(this.offset);
    return true;
  }
  destroy(root: HTMLElement): void {
    mountedBlocks.get(root)?.dispose();
    mountedBlocks.delete(root);
  }
  ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" || interactiveTarget(event.target instanceof Element ? event.target : null, event as MouseEvent);
  }
}

const GAP = Decoration.line({ class: "cm-markdown-gap" });

/// Se `position` cade in uno degli intervalli, ordinati e disgiunti, che un
/// blocco reso copre.
function insideReplaced(replaced: readonly { from: number; to: number }[], position: number): boolean {
  let low = 0;
  let high = replaced.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (replaced[middle]!.to <= position) low = middle + 1;
    else high = middle;
  }
  const range = replaced[low];
  return range !== undefined && range.from <= position && position < range.to;
}

/// Gli intervalli che i blocchi resi coprono dentro `ranges`, in ordine e
/// disgiunti: fra le decorazioni dei blocchi soltanto i blocchi resi hanno
/// una lunghezza.
function replacedIn(decorations: DecorationSet, ranges: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  for (const range of ranges) {
    decorations.between(range.from, range.to, (from, to) => {
      if (to > from && (found.length === 0 || from >= found[found.length - 1]!.to)) found.push({ from, to });
    });
  }
  return found;
}

/// Un blocco che il cursore lontano lascia reso, fra i candidati della Live:
/// l'intervallo va dall'inizio della sua prima riga a quello del blocco dopo.
class CandidateMark extends RangeValue {
  constructor(
    /// Il blocco, con le posizioni di quando il candidato è nato.
    readonly block: MarkdownBlock,
    /// Quanto il blocco comincia dopo l'inizio del candidato.
    readonly offset: number,
    readonly length: number,
    /// Una tabella che la griglia sa leggere: resta griglia anche col cursore
    /// dentro, perché la griglia è il modo di scriverla.
    readonly grid: boolean,
    /// Un paragrafo che è soltanto un indirizzo: la sua scheda (K8).
    readonly linkCard: string | undefined,
    /// La scelta che la selezione ha dettato: blocco reso o sorgente, righe
    /// vuote dopo nascoste o no. Uguale, il candidato resta quello di prima.
    readonly decision: string,
  ) {
    super();
  }
  decided(decision: string): CandidateMark {
    return new CandidateMark(this.block, this.offset, this.length, this.grid, this.linkCard, decision);
  }
}

/// Il campo dei blocchi resi di una Live, per chi conta il suo lavoro.
interface LiveBlocksValue {
  readonly visited: number;
  readonly gaps: DecorationSet;
}
const liveBlocksField = Facet.define<StateField<LiveBlocksValue>, StateField<LiveBlocksValue> | undefined>({
  combine: (fields) => fields[0],
});

/// Le righe vuote che la Live nasconde dopo i blocchi resi, in tutto il
/// documento: la vista ne disegna soltanto quelle del suo tratto. Per i test.
export function liveGapLines(state: EditorState): DecorationSet | null {
  const field = state.facet(liveBlocksField);
  return field ? state.field(field, false)?.gaps ?? null : null;
}

/// Le righe nascoste del tratto della vista. Fuori dal tratto non si
/// disegnano, e una decorazione di riga non cambia le altezze che la vista
/// stima: così il confronto delle decorazioni a ogni aggiornamento resta
/// proporzionale al tratto, non a tutte le righe nascoste della nota.
const gapLines = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;
  private source: DecorationSet | null = null;
  constructor(view: EditorView) {
    this.build(view);
  }
  update(update: ViewUpdate): void {
    if (update.viewportChanged || liveGapLines(update.state) !== this.source) this.build(update.view);
  }
  private build(view: EditorView): void {
    const source = liveGapLines(view.state);
    this.source = source;
    if (!source) {
      this.decorations = Decoration.none;
      return;
    }
    const { from, to } = view.viewport;
    const ranges: Range<Decoration>[] = [];
    source.between(from, to, (start, _end, value) => {
      ranges.push(value.range(start));
    });
    this.decorations = Decoration.set(ranges);
  }
}, { decorations: (value) => value.decorations });

/// Quanti blocchi l'ultimo aggiornamento della Live ha guardato: tutti quando
/// si rifà da capo, quelli vicini alla modifica e alla selezione per una
/// battuta. `null` senza Live. Per i test, che contano il lavoro di una battuta.
export function liveBlocksVisited(state: EditorState): number | null {
  const field = state.facet(liveBlocksField);
  return field ? state.field(field, false)?.visited ?? null : null;
}

/// Le figure del set accanto ai wikilink: una regola per figura, con la sua
/// maschera. Si fanno quando si monta un editor e non al caricamento del
/// modulo, perché una figura può essere registrata da un modulo che si monta
/// dopo (la stella della cornice); si rifanno solo se le figure disegnate sono
/// cambiate. Una figura che nessuno disegna non ha regola, e non mostra niente.
let figureMarks: { key: string; theme: Extension } | null = null;

function figureTheme(): Extension {
  const masks = PAGE_FIGURES.map((name) => [name, figureMask(name)] as const).filter(([, mask]) => mask !== "");
  const key = masks.map(([name, mask]) => `${name}=${mask}`).join(" ");
  if (figureMarks?.key === key) return figureMarks.theme;
  const theme = EditorView.baseTheme(Object.fromEntries(masks.map(([name, mask]) => [
    // La forma dalla maschera, il colore dal testo del link, grande quanto
    // una lettera.
    `.cm-fub-wikilink[data-page-figure="${name}"]::before`,
    {
      content: "\"\"",
      width: "1em",
      height: "1em",
      marginInlineEnd: "0.2em",
      display: "inline-block",
      verticalAlign: "-0.15em",
      backgroundColor: "currentColor",
      maskImage: mask,
      maskRepeat: "no-repeat",
      maskSize: "100% 100%",
      WebkitMaskImage: mask,
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskSize: "100% 100%",
    },
  ])));
  figureMarks = { key, theme };
  return theme;
}

/// Quanto lavora il parser in ogni pezzo del resto di un documento grande, in
/// millisecondi: con la resa che ne segue sta dentro un fotogramma.
const PARSE_SLICE_MS = 8;

/// Il parser è arrivato in fondo al documento: la resa a metà si completa
/// anche se l'albero dello stato era già quello.
const restParsed = StateEffect.define<null>();

/// `run` quando la pagina è libera: `requestIdleCallback` dove c'è, e non
/// oltre 100 ms; altrimenti il prossimo giro del ciclo degli eventi. Torna
/// la funzione che lo annulla.
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: 100 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
}

/// Le decorazioni in riga raccolte da `collectInline`.
interface InlineRanges {
  readonly decorations: Range<Decoration>[];
  readonly atomic: Range<Decoration>[];
  readonly hidden: Range<Decoration>[];
  readonly seen: Set<string>;
  /// Quante righe `computeDecorations` ha letto.
  lines: number;
}

/// Da che cosa vengono le decorazioni in riga della Live.
interface InlineBasis {
  readonly visible: readonly { from: number; to: number }[];
  readonly ranges: readonly SelectionRange[];
  readonly replaced: readonly { from: number; to: number }[];
}

/// Quante righe l'ultimo aggiornamento delle decorazioni in riga ha letto, per
/// vista. Per i test, che contano il lavoro di una battuta.
const inlineVisited = new WeakMap<EditorView, number>();

/// Quante righe l'ultimo aggiornamento delle decorazioni in riga della Live ha
/// letto con `computeDecorations`.
export function liveInlineVisited(view: EditorView): number | null {
  return inlineVisited.get(view) ?? null;
}

/// I nodi di primo livello che toccano le righe da `from` a `to`, interi:
/// dall'inizio del primo a quello del nodo dopo l'ultimo (o alla fine del
/// testo). Le decorazioni in riga di un nodo dipendono soltanto da lui e
/// dalle sue righe attive.
function topCover(tree: Tree, doc: Text, from: number, to: number): { from: number; to: number } {
  const start = doc.lineAt(from).from;
  const end = doc.lineAt(to).to;
  const first = tree.topNode.childBefore(start);
  let next = tree.topNode.childAfter(end);
  while (next && next.from <= end) next = next.nextSibling;
  return { from: first ? Math.min(first.from, start) : 0, to: next ? next.from : tree.length };
}

/// I tratti coperti da uno dei due elenchi e non dall'altro.
function symmetricDifference(
  a: readonly { from: number; to: number }[],
  b: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const key = (range: { from: number; to: number }) => `${range.from}:${range.to}`;
  const inB = new Set(b.map(key));
  const inA = new Set(a.map(key));
  for (const range of a) if (!inB.has(key(range))) out.push(range);
  for (const range of b) if (!inA.has(key(range))) out.push(range);
  return out;
}

/// I tratti dove uno dei due elenchi copre il testo e l'altro no, coi punti
/// dove la copertura cambia in uno solo dei due: anche un bordo che si sposta
/// conta.
function uncovered(
  a: readonly { from: number; to: number }[],
  b: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const edges = (list: readonly { from: number; to: number }[]) => new Set(list.flatMap((range) => [range.from, range.to]));
  const inA = edges(a);
  const inB = edges(b);
  const covers = (list: readonly { from: number; to: number }[], pos: number) => list.some((range) => range.from <= pos && pos < range.to);
  const points = [...new Set([...inA, ...inB])].sort((x, y) => x - y);
  const out: { from: number; to: number }[] = [];
  for (let index = 0; index < points.length; index++) {
    const at = points[index]!;
    // Un bordo di uno soltanto: il nodo che lo tiene cambia taglio.
    if (inA.has(at) !== inB.has(at)) out.push({ from: at, to: at });
    const next = points[index + 1];
    if (next !== undefined && covers(a, at) !== covers(b, at)) out.push({ from: at, to: next });
  }
  return out;
}

/// I tratti in ordine, uniti quando si toccano.
function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  ranges.sort((x, y) => x.from - y.from);
  const out: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ from: range.from, to: range.to });
  }
  return out;
}

export function livePreview(
  callbacks: LivePreviewCallbacks,
  forms?: readonly SyntaxForm[],
): Extension {
  interface RenderState {
    document: MarkdownDocument;
    /// I blocchi rendibili, ognuno dall'inizio della sua prima riga a quello
    /// del blocco dopo, con la scelta che la selezione ha dettato. Una
    /// modifica li sposta tutti senza guardarli, e se ne rifanno soltanto
    /// quelli che la modifica o la selezione toccano.
    candidates: RangeSet<CandidateMark>;
    decorations: DecorationSet;
    /// Le righe vuote nascoste dopo i blocchi resi (`cm-markdown-gap`). Non
    /// stanno con i blocchi: CodeMirror confronta a ogni aggiornamento, punto
    /// per punto, tutte le decorazioni del campo, e queste righe la vista le
    /// prende soltanto nel suo tratto (`gapLines`).
    gaps: DecorationSet;
    /// `false`: la resa di un documento grande appena aperto, fin dove il
    /// parser è arrivato (`renderMarkdownStatePrefix`); `parseRest` la
    /// completa senza fermare la pagina.
    complete: boolean;
    /// Quanti blocchi l'ultimo aggiornamento ha guardato (`liveBlocksVisited`).
    visited: number;
  }
  const touched = (state: EditorState, from: number, to: number) =>
    state.selection.ranges.some((range) => range.from <= to && range.to >= from);
  const anchorsOf = (state: EditorState): ReadonlyMap<string, number> => state.field(blocks).document.anchors;
  const blocks = StateField.define<RenderState>({
    create(state) {
      const { document, complete } = renderMarkdownStatePrefix(state, forms);
      return buildAll(state, document, complete);
    },
    update(value, transaction) {
      const { state } = transaction;
      const changed = transaction.docChanged;
      const readOnlyChanged = transaction.startState.readOnly !== state.readOnly;
      if (state.facet(liveReveal) !== transaction.startState.facet(liveReveal)) {
        return buildAll(state, value.document, value.complete);
      }
      if (transaction.effects.some((effect) => effect.is(linkCardsChanged)) && !changed) {
        return buildAll(state, value.document, value.complete);
      }
      // La resa a metà di un documento grande si rifà a ogni modifica, fin
      // dove l'albero arriva, e quando l'albero arriva in fondo: gli alberi
      // intermedi del lavoratore del parser la rifarebbero tutta ogni volta.
      const treeDone = !changed && syntaxTreeAvailable(state) && (
        syntaxTree(transaction.startState) !== syntaxTree(state)
        || transaction.effects.some((effect) => effect.is(restParsed)));
      if (!value.complete && (changed || treeDone)) {
        const previous = { document: value.document, changes: transaction.changes };
        const { document, complete } = renderMarkdownStatePrefix(state, forms, previous);
        return buildAll(state, document, complete);
      }
      if (!changed && !transaction.selection && !readOnlyChanged) return value;
      if (!changed) {
        if (readOnlyChanged) return buildAll(state, value.document, value.complete);
        return patchBlocks(value, transaction, value.document) ?? buildAll(state, value.document, value.complete);
      }
      const document = renderMarkdownState(state, forms, { document: value.document, changes: transaction.changes });
      // Ogni widget confronta la sola lettura e le definizioni, e una scheda
      // nuova può cambiare tipo: allora si rifanno tutti.
      if (readOnlyChanged || document.dependencies !== value.document.dependencies
        || transaction.effects.some((effect) => effect.is(linkCardsChanged))) {
        return buildAll(state, document, true);
      }
      return patchBlocks(value, transaction, document) ?? buildAll(state, document, true);
    },
    provide: (field) => [EditorView.decorations.from(field, (value) => value.decorations), liveBlocksField.of(field)],
  });
  // Il resto di un documento grande: il parser di CodeMirror ci arriva a
  // pezzi brevi, quando la pagina è libera, e quando è in fondo una
  // transazione (`restParsed`) porta l'albero nello stato e la resa si completa. Il
  // lavoratore del parser, da solo, si ferma poco oltre la vista.
  const parseRest = ViewPlugin.fromClass(class {
    private cancel: (() => void) | null = null;
    constructor(private readonly view: EditorView) {
      this.schedule();
    }
    update(): void {
      this.schedule();
    }
    private schedule(): void {
      if (this.cancel || this.view.state.field(blocks).complete) return;
      this.cancel = whenIdle(() => {
        this.cancel = null;
        const { state } = this.view;
        if (state.field(blocks).complete) return;
        if (ensureSyntaxTree(state, state.doc.length, PARSE_SLICE_MS)) this.view.dispatch({ effects: restParsed.of(null) });
        else this.schedule();
      });
    }
    destroy(): void {
      this.cancel?.();
      this.cancel = null;
    }
  });
  // Le tabelle sono griglie (`table-widget.ts`), anche col cursore dentro: si
  // scrivono cella per cella, e la sorgente con le pipe è della modalità
  // Sorgente.
  // I widget coprono solo ciò che il testo non può dire: diagrammi resi,
  // immagini, embed e tabelle complesse non hanno coordinate riga-per-riga
  // nel testo e il click nativo non li raggiunge. Tutto il resto — titoli,
  // prosa, liste, citazioni, codice, hr, frontmatter — resta testo CodeMirror
  // con decorazioni inline: il click è `posAtCoords` nativo, sempre esatto,
  // senza mapping geometrico né mount per blocco.
  const INLINE_KINDS = new Set([
    "paragraph", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
    "heading", "list", "blockquote", "code", "incomplete", "hr",
    "frontmatter", "html", "definition", "footnote-definition",
  ]);
  // Un paragrafo fatto solo di immagini o embed (`![alt](x.png)`,
  // `![[foto.png|120]]`) non ha prosa da scrivere: fuori dal cursore si vede
  // reso, come in Lettura, e col cursore dentro torna sorgente.
  const MEDIA = String.raw`(?:!\[[^\]\n]*\]\([^)\n]*\)|!\[\[[^\]\n]+\]\])`;
  const ONLY_MEDIA = new RegExp(`^\\s*${MEDIA}(?:\\s+${MEDIA})*\\s*$`);
  const onlyMedia = (text: string): boolean => text.length < 4096 && ONLY_MEDIA.test(text);
  // Con `mai` ed `elemento` un paragrafo di sole immagini resta testo con le
  // immagini in riga (D8): un clic le seleziona, la maniglia le allarga, e la
  // sorgente non torna. Gli altri embed (note, PDF, disegni) restano blocchi.
  const MEDIA_ALL = new RegExp(MEDIA, "g");
  const onlyImages = (text: string): boolean => onlyMedia(text) && [...text.matchAll(MEDIA_ALL)].every(([found]) =>
    !found.startsWith("![[") || mediaKindOfId(found.slice(3, -2).split("|")[0]!.split("#")[0]!.trim()) === "image");
  // Che un blocco sia rendibile, e se è una griglia, dipende soltanto dal suo
  // testo: si ricorda per il blocco reso davvero, che una modifica altrove
  // lascia com'è.
  const shapes = new WeakMap<object, { rendered: boolean; grid: boolean }>();
  const shapeOf = (block: MarkdownBlock): { rendered: boolean; grid: boolean } => {
    const origin = blockOrigin(block);
    let shape = shapes.get(origin);
    if (!shape) {
      const media = block.kind === "paragraph" && onlyMedia(block.source);
      shape = { rendered: !INLINE_KINDS.has(block.kind) || media, grid: tableOfBlock(block) !== null };
      shapes.set(origin, shape);
    }
    return shape;
  };
  // Le righe si contano sul testo che la resa ha letto, lo stesso del
  // documento: cercare un a capo costa meno che scendere nell'albero delle
  // righe di CodeMirror, e lo si fa per ogni blocco a ogni battuta.
  const lineStart = (source: string, position: number): number => source.lastIndexOf("\n", position - 1) + 1;
  // La decorazione di un blocco reso torna la stessa finché il blocco viene
  // dalla stessa resa e niente di ciò che il widget confronta cambia: per
  // CodeMirror è la decorazione di prima, spostata, e non va confrontata.
  const widgets = new WeakMap<object, {
    offset: number; dependencies: string; readOnly: boolean; grid: boolean; decoration: Decoration;
  }>();
  function widgetOf(block: MarkdownBlock, from: number, dependencies: string, readOnly: boolean, grid: boolean): Decoration {
    const origin = blockOrigin(block);
    const offset = block.from - from;
    const kept = widgets.get(origin);
    if (kept && kept.offset === offset && kept.dependencies === dependencies && kept.readOnly === readOnly && kept.grid === grid) {
      return kept.decoration;
    }
    const decoration = Decoration.replace({
      block: true,
      widget: grid
        ? new TableWidget(block, from, dependencies, readOnly, callbacks)
        : new MarkdownWidget(block, from, dependencies, readOnly, callbacks, anchorsOf),
    });
    widgets.set(origin, { offset, dependencies, readOnly, grid, decoration });
    return decoration;
  }
  /// Il candidato di un blocco, se il blocco si può rendere: dall'inizio della
  /// sua prima riga all'inizio della riga del blocco dopo. La scelta è ancora
  /// da fare.
  function candidateOf(
    block: MarkdownBlock,
    following: MarkdownBlock | null,
    source: string,
    policy: RevealPolicy,
  ): Range<CandidateMark> | null {
    if (INLINE_KINDS.has(block.kind) && block.kind !== "paragraph") return null;
    const { rendered, grid } = shapeOf(block);
    const url = !rendered && callbacks.linkCard && block.kind === "paragraph" ? bareUrl(block.source) : null;
    if (!url) {
      if (!rendered) return null;
      if (policy !== "riga" && block.kind === "paragraph" && onlyImages(block.source)) return null;
    }
    const from = lineStart(source, block.from);
    const next = following ? lineStart(source, following.from) : source.length;
    const mark = new CandidateMark(block, block.from - from, block.to - block.from, url ? false : grid, url ?? undefined, "");
    return mark.range(from, Math.max(next, block.to));
  }
  /// La scelta di un candidato per la selezione di adesso, con le sue
  /// decorazioni: blocco reso o sorgente, righe vuote dopo nascoste o no.
  function decide(
    state: EditorState,
    document: MarkdownDocument,
    from: number,
    next: number,
    mark: CandidateMark,
  ): { decision: string; ranges: Range<Decoration>[] } {
    const ranges: Range<Decoration>[] = [];
    const to = from + mark.offset + mark.length;
    const { linkCard, grid } = mark;
    if (linkCard !== undefined) {
      // Col cursore dentro, l'indirizzo si scrive com'è.
      if (touched(state, from, to) || !callbacks.linkCard) return { decision: "s", ranges };
      const card = callbacks.linkCard.view(linkCard);
      ranges.push(Decoration.replace({ block: true, widget: new LinkCardWidget(linkCard, card) }).range(from, to));
      return { decision: `k${card.kind}`, ranges };
    }
    const block = movedBlock(mark.block, from + mark.offset);
    if (!grid && touched(state, from, to)) {
      // Un diagramma toccato si scrive come codice, e il disegno resta
      // sotto (C5).
      if (block.kind === "diagram" && /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/i.test(block.source)) {
        ranges.push(Decoration.widget({ block: true, side: 1, widget: new DiagramLiveWidget(fenceBody(block.source)) }).range(to));
      } else if (block.kind === "math") {
        // Così anche un blocco `$$` (C6).
        ranges.push(Decoration.widget({ block: true, side: 1, widget: new MathBlockLiveWidget(blockTex(block.source)) }).range(to));
      }
      return { decision: "s", ranges };
    }
    let decision = grid ? "t" : "r";
    ranges.push(widgetOf(block, from, document.dependencies, state.readOnly, grid).range(from, to));
    // Le righe dopo il blocco, fino al prossimo: dalla riga di `to` se
    // comincia lì, altrimenti dalla seguente.
    const { source } = document;
    const after = source.indexOf("\n", to);
    let lineFrom = lineStart(source, to) === to ? to : after === -1 ? -1 : after + 1;
    while (lineFrom !== -1 && lineFrom < next) {
      const end = source.indexOf("\n", lineFrom);
      const lineTo = end === -1 ? source.length : end;
      if (!/\S/.test(source.slice(lineFrom, lineTo)) && !touched(state, lineFrom, lineTo)) {
        ranges.push(GAP.range(lineFrom));
        decision += "g";
      } else {
        decision += "-";
      }
      if (end === -1) break;
      lineFrom = end + 1;
    }
    return { decision, ranges };
  }
  /// Candidati e decorazioni di tutto il documento: quando la Live parte, e
  /// quando una modifica cambia ciò che ogni blocco reso confronta.
  function buildAll(state: EditorState, document: MarkdownDocument, complete: boolean): RenderState {
    const policy = state.facet(liveReveal);
    const { source, blocks: all } = document;
    const marks: Range<CandidateMark>[] = [];
    const ranges: Range<Decoration>[] = [];
    const gaps: Range<Decoration>[] = [];
    for (let index = 0; index < all.length; index++) {
      const candidate = candidateOf(all[index]!, all[index + 1] ?? null, source, policy);
      if (!candidate) continue;
      const { decision, ranges: own } = decide(state, document, candidate.from, candidate.to, candidate.value);
      marks.push(candidate.value.decided(decision).range(candidate.from, candidate.to));
      for (const range of own) (range.value === GAP ? gaps : ranges).push(range);
    }
    return {
      document, candidates: RangeSet.of(marks), decorations: Decoration.set(ranges, true), gaps: Decoration.set(gaps, true),
      complete, visited: all.length,
    };
  }
  /// L'aggiornamento di una battuta o di un cursore che si muove: candidati e
  /// decorazioni di prima, spostati dalla modifica, e rifatti soltanto dove
  /// la resa ha lavorato (`renderPatch`) e dove la selezione, di prima o di
  /// adesso, tocca un candidato. `null` quando la resa è stata rifatta da capo.
  function patchBlocks(value: RenderState, transaction: Transaction, document: MarkdownDocument): RenderState | null {
    const { state } = transaction;
    const changed = transaction.docChanged;
    let { candidates, decorations, gaps } = value;
    const added: Range<CandidateMark>[] = [];
    const dropped = new Set<CandidateMark>();
    const ranges: Range<Decoration>[] = [];
    const gapRanges: Range<Decoration>[] = [];
    const cleared: { from: number; to: number }[] = [];
    let visited = 0;
    if (changed) {
      const span = renderPatch(document);
      if (!span) return null;
      candidates = candidates.map(transaction.changes);
      decorations = decorations.map(transaction.changes);
      gaps = gaps.map(transaction.changes);
      const { source } = document;
      const policy = state.facet(liveReveal);
      const { blocks: near, following } = blocksAround(document, span.from, span.to);
      const from = near.length > 0 ? lineStart(source, near[0]!.from) : span.from;
      const to = following ? Math.max(from, lineStart(source, following.from)) : source.length;
      candidates.between(from, to, (start, _end, mark) => {
        if (start >= from && start < to) dropped.add(mark);
      });
      for (let index = 0; index < near.length; index++) {
        visited++;
        const candidate = candidateOf(near[index]!, near[index + 1] ?? following, source, policy);
        if (!candidate) continue;
        const { decision, ranges: own } = decide(state, document, candidate.from, candidate.to, candidate.value);
        added.push(candidate.value.decided(decision).range(candidate.from, candidate.to));
        for (const range of own) (range.value === GAP ? gapRanges : ranges).push(range);
      }
      cleared.push({ from, to });
    }
    // La selezione di prima, portata dalla modifica, e quella di adesso: i
    // candidati che toccano rifanno la scelta, e cambiano se è diversa.
    const spans: { from: number; to: number }[] = [];
    for (const range of transaction.startState.selection.ranges) {
      spans.push(changed
        ? { from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) }
        : range);
    }
    for (const range of state.selection.ranges) spans.push(range);
    const seen = new Set<CandidateMark>();
    for (const span of spans) {
      candidates.between(span.from, span.to, (from, to, mark) => {
        if (dropped.has(mark) || seen.has(mark)) return;
        seen.add(mark);
        visited++;
        const { decision, ranges: own } = decide(state, document, from, to, mark);
        if (decision === mark.decision) return;
        dropped.add(mark);
        added.push(mark.decided(decision).range(from, to));
        for (const range of own) (range.value === GAP ? gapRanges : ranges).push(range);
        cleared.push({ from, to });
      });
    }
    if (!changed && cleared.length === 0) return value;
    for (const { from, to } of cleared) {
      candidates = candidates.update({ filterFrom: from, filterTo: to, filter: (_from, _to, mark) => !dropped.has(mark) });
      decorations = decorations.update({ filterFrom: from, filterTo: to, filter: (start) => start < from || start >= to });
      gaps = gaps.update({ filterFrom: from, filterTo: to, filter: (start) => start < from || start >= to });
    }
    candidates = candidates.update({ add: added, sort: true });
    decorations = decorations.update({ add: ranges, sort: true });
    gaps = gaps.update({ add: gapRanges, sort: true });
    return { document, candidates, decorations, gaps, complete: value.complete, visited };
  }
  /// Le decorazioni in riga dei tratti `ranges` (i visibili, o i loro pezzi
  /// da rifare): quelle che `computeDecorations` vi trova, fuori dai blocchi
  /// resi e dal frontmatter, e con `keep` soltanto quelle che vi cominciano.
  const collectInline = (
    state: EditorState,
    active: Reveal,
    replaced: readonly { from: number; to: number }[],
    ranges: readonly { from: number; to: number }[],
    keep: { from: number; to: number } | null,
    out: InlineRanges,
  ): void => {
    // Dentro il frontmatter non c'è Markdown: né riga orizzontale né titolo.
    const yaml = frontmatterRange(state.doc);
    for (const visible of ranges) {
      out.lines += state.doc.lineAt(visible.to).number - state.doc.lineAt(visible.from).number + 1;
      for (const item of computeDecorations(state, active, visible.from, visible.to, forms)) {
        if (keep && (item.from < keep.from || item.from >= keep.to)) continue;
        if (insideReplaced(replaced, item.from)) continue;
        if (yaml && item.from < yaml.to) continue;
        const key = `${item.from}:${item.to}:${item.kind}`;
        if (out.seen.has(key)) continue;
        out.seen.add(key);
        // «A capo» è della superficie: la testata lo legge dallo stato.
        const decoration = item.kind === "code-header" && !codeWraps(state, item.from)
          ? Decoration.replace({ widget: new CodeHeaderWidget(item.data ?? "", false) })
          : inDecoration(item, callbacks);
        // Un titolo porta anche la sua riga: lo stesso respiro verticale della
        // Lettura, così cambiare modalità non fa saltare la pagina.
        const level = HEADING_LINES[item.kind];
        if (level) {
          const lineStart = state.doc.lineAt(item.from).from;
          const lineKey = `line:${lineStart}`;
          if (!out.seen.has(lineKey)) {
            out.seen.add(lineKey);
            out.decorations.push(level.range(lineStart));
          }
        }
        if (item.kind === "quote-line" || item.kind === "codeblock-line" || item.kind === "callout-line") {
          out.decorations.push(decoration.range(item.from));
        } else {
          const range = decoration.range(item.from, item.to);
          out.decorations.push(range);
          if (item.kind === "hide" || item.kind === "hr" || item.kind === "checkbox" || item.kind === "math"
            || item.kind === "image" || item.kind === "link-pill" || item.kind === "footnote-back"
            || item.kind === "code-header" || item.kind === "fence-close" || item.kind === "callout-type" || item.kind === "column-label") out.atomic.push(range);
          // Le righe dei recinti nascosti: la testata, e la chiusura raccolta.
          if (item.kind === "code-header") out.decorations.push(codeHeaderLine.range(state.doc.lineAt(item.from).from));
          if (item.kind === "fence-close") out.decorations.push(fenceCloseLine.range(item.from));
          if (item.kind === "hide") out.hidden.push(range);
        }
      }
    }
  };
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    atomicRanges: DecorationSet = Decoration.none;
    /// I segni nascosti, che Backspace e Canc saltano.
    hidden: DecorationSet = Decoration.none;
    /// Le selezioni da cui si decide la rivelazione durante una composizione:
    /// quelle di quando è cominciata, portate avanti dalle modifiche. Fino a
    /// `compositionend` niente si rivela né si nasconde sotto le dita.
    held: readonly SelectionRange[] | null = null;
    endDrag: (() => void) | undefined;
    /// Da che cosa vengono le decorazioni: i tratti visibili, le selezioni
    /// che decidevano la rivelazione e i blocchi resi che coprivano il testo.
    /// Un aggiornamento rifà soltanto i nodi di primo livello dove uno di
    /// questi, o il testo, cambia.
    built: InlineBasis;
    constructor(view: EditorView) {
      this.built = this.rebuild(view);
    }
    private basis(view: EditorView, ranges: readonly SelectionRange[]): InlineBasis {
      return {
        visible: view.visibleRanges.map(({ from, to }) => ({ from, to })),
        ranges,
        replaced: replacedIn(view.state.field(blocks).decorations, view.visibleRanges),
      };
    }
    private rebuild(view: EditorView): InlineBasis {
      const ranges = this.held ?? view.state.selection.ranges;
      const basis = this.basis(view, ranges);
      const out: InlineRanges = { decorations: [], atomic: [], hidden: [], seen: new Set(), lines: 0 };
      collectInline(view.state, revealOf(view.state, view.state.facet(liveReveal), ranges), basis.replaced, basis.visible, null, out);
      this.decorations = Decoration.set(out.decorations, true);
      this.atomicRanges = Decoration.set(out.atomic, true);
      this.hidden = Decoration.set(out.hidden, true);
      inlineVisited.set(view, out.lines);
      return basis;
    }
    /// Le decorazioni rifatte soltanto nei nodi di primo livello che la
    /// modifica cambia (`topChanges`), in quelli che la selezione di prima o
    /// di adesso tocca, dove un blocco reso compare o sparisce e dove il
    /// tratto visibile si sposta; le altre restano, spostate. `false` quando
    /// qualcosa che vale per tutto il testo cambia: allora si rifà tutto.
    private patch(update: ViewUpdate): boolean {
      const { state, startState, changes, view } = update;
      const tree = syntaxTree(state);
      if (tree.length !== state.doc.length) return false;
      const before = startState.field(blocks);
      const after = state.field(blocks);
      if (before.document.dependencies !== after.document.dependencies || before.complete !== after.complete) return false;
      if (startState.readOnly !== state.readOnly) return false;
      const dirty: { from: number; to: number }[] = [];
      if (update.docChanged) {
        if (update.transactions.length !== 1) return false;
        const transaction = update.transactions[0]!;
        if (touchesFootnoteLine(transaction)) return false;
        const yamlBefore = frontmatterRange(startState.doc);
        const yamlAfter = frontmatterRange(state.doc);
        if ((yamlBefore || yamlAfter) && (!yamlBefore || !yamlAfter || changes.mapPos(yamlBefore.to) !== yamlAfter.to
          || changes.touchesRange(0, yamlBefore.to))) return false;
        const changed = topChanges(transaction, syntaxTree(startState));
        if (!changed) return false;
        dirty.push({ from: changed.start, to: changed.resync === null ? state.doc.length : changed.resync + changed.delta });
        // E il testo cambiato, anche fra due nodi: le decorazioni di prima vi
        // finiscono spostate.
        changes.iterChangedRanges((_fromA, _toA, fromB, toB) => dirty.push(topCover(tree, state.doc, fromB, toB)));
      } else if (syntaxTree(startState) !== tree) {
        return false;
      }
      const ranges = this.held ?? state.selection.ranges;
      const basis = this.basis(view, ranges);
      const old = this.built;
      // Le selezioni di prima e di adesso, e quelle che decidevano.
      const spans = [
        ...startState.selection.ranges, ...old.ranges,
      ].map((range) => ({ from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }));
      spans.push(...state.selection.ranges, ...ranges);
      for (const span of spans) dirty.push(topCover(tree, state.doc, span.from, span.to));
      // I blocchi resi che compaiono o spariscono.
      const mappedReplaced = old.replaced.map((range) => ({ from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) }));
      for (const range of symmetricDifference(mappedReplaced, basis.replaced)) dirty.push(topCover(tree, state.doc, range.from, range.to));
      // Il tratto visibile che si sposta: i nodi ai suoi bordi, di prima e di
      // adesso, e quelli che entrano o escono.
      const mappedVisible = old.visible.map((range) => ({ from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }));
      for (const range of uncovered(mappedVisible, basis.visible)) dirty.push(topCover(tree, state.doc, range.from, range.to));
      // Da inizio riga: un nodo rientrato comincia dopo il rientro, e le
      // decorazioni di riga del suo inizio stanno prima.
      const doc = state.doc;
      const merged = mergeRanges(dirty.map(({ from, to }) => ({
        from: doc.lineAt(from).from,
        to: to >= doc.length ? doc.length : doc.lineAt(to).from,
      })));
      const active = revealOf(state, state.facet(liveReveal), ranges);
      const out: InlineRanges = { decorations: [], atomic: [], hidden: [], seen: new Set(), lines: 0 };
      let decorations = this.decorations.map(changes);
      let atomic = this.atomicRanges.map(changes);
      let hidden = this.hidden.map(changes);
      for (const span of merged) {
        const drop = (from: number) => from < span.from || from >= span.to;
        decorations = decorations.update({ filterFrom: span.from, filterTo: span.to, filter: drop });
        atomic = atomic.update({ filterFrom: span.from, filterTo: span.to, filter: drop });
        hidden = hidden.update({ filterFrom: span.from, filterTo: span.to, filter: drop });
        const pieces: { from: number; to: number }[] = [];
        for (const visible of basis.visible) {
          const from = Math.max(visible.from, span.from);
          const to = Math.min(visible.to, span.to);
          if (from <= to) pieces.push({ from, to });
        }
        collectInline(state, active, basis.replaced, pieces, span, out);
      }
      this.decorations = decorations.update({ add: out.decorations, sort: true });
      this.atomicRanges = atomic.update({ add: out.atomic, sort: true });
      this.hidden = hidden.update({ add: out.hidden, sort: true });
      this.built = basis;
      inlineVisited.set(view, out.lines);
      return true;
    }
    update(update: ViewUpdate) {
      const composing = update.view.compositionStarted;
      const released = !composing && this.held !== null;
      if (composing) {
        this.held = (this.held ?? update.startState.selection.ranges).map((range) => range.map(update.changes));
      } else {
        this.held = null;
      }
      const whole = released
        || update.startState.facet(liveReveal) !== update.state.facet(liveReveal)
        || codeWrapChanged(update)
        || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(pageIconsChanged)));
      if (whole || update.docChanged || update.selectionSet || update.viewportChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || update.startState.field(blocks) !== update.state.field(blocks)) {
        if (whole || !this.patch(update)) this.built = this.rebuild(update.view);
      }
    }
    destroy() { this.endDrag?.(); }
  }, {
    decorations: (value) => value.decorations,
    provide: (extension) => EditorView.atomicRanges.of((view) => view.plugin(extension)?.atomicRanges ?? Decoration.none),
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target instanceof Element ? event.target : null;
        // La pastiglia di un collegamento apre il riquadro su quel collegamento.
        const pill = target?.closest<HTMLElement>(".cm-fub-link-pill");
        const opener = view.state.facet(linkDialogOpener);
        if (pill && opener && event.button === 0) {
          event.preventDefault();
          const at = view.posAtDOM(pill);
          view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer" });
          opener(view);
          return true;
        }
        // Il ↩ di una nota porta il cursore al suo primo rimando.
        const back = target?.closest<HTMLElement>(".cm-fub-footnote-back");
        if (back && event.button === 0) {
          event.preventDefault();
          const at = firstFootnoteReference(view.state.doc, back.getAttribute(ATTR_FOOTNOTE) ?? "");
          if (at !== null) view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer", scrollIntoView: true });
          return true;
        }
        // Una voce dell'indice (K4) porta al suo titolo col clic semplice:
        // non è testo da scrivere, il recinto si apre dalla sua riga.
        const entry = target?.closest<HTMLElement>(".fub-toc a[data-md-anchor]");
        if (entry && event.button === 0 && !event.shiftKey && !event.altKey) {
          const at = anchorsOf(view.state).get(entry.dataset.mdAnchor ?? "");
          if (at !== undefined) {
            event.preventDefault();
            view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer", effects: EditorView.scrollIntoView(at, { y: "start" }) });
            view.focus();
            return true;
          }
        }
        const root = target?.closest<HTMLElement>(".cm-markdown-block");
        // Fuori dai widget non si intercetta nulla: CodeMirror mappa il click
        // con `posAtCoords` nativo — riga e colonna esatte, nessun euristico.
        // Dentro un widget (diagramma, immagine, embed) il browser non ha
        // coordinate testo e decide la mappa per coordinate.
        if (!root) return false;
        if (interactiveTarget(target, event)) return handleClick(event, view, callbacks);
        if (event.button !== 0) return false;
        event.preventDefault();
        const position = sourcePositionAtPoint(root, event.clientX, event.clientY);
        const anchor = event.shiftKey ? view.state.selection.main.anchor : position;
        const ranges = event.altKey ? [...view.state.selection.ranges, EditorSelection.cursor(position)]
          : [EditorSelection.range(anchor, position)];
        view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), userEvent: "select.pointer" });
        view.focus();
        const owner = view.plugin(plugin);
        if (owner && !event.altKey) {
          owner.endDrag?.();
          const move = (next: MouseEvent) => {
            const under = view.dom.ownerDocument.elementFromPoint(next.clientX, next.clientY);
            const widget = under?.closest<HTMLElement>(".cm-markdown-block");
            const head = widget ? sourcePositionAtPoint(widget, next.clientX, next.clientY)
              : view.posAtCoords({ x: next.clientX, y: next.clientY });
            if (head !== null) view.dispatch({ selection: { anchor, head }, userEvent: "select.pointer" });
          };
          const end = () => {
            view.dom.ownerDocument.removeEventListener("mousemove", move);
            view.dom.ownerDocument.removeEventListener("mouseup", end);
            owner.endDrag = undefined;
          };
          owner.endDrag = end;
          view.dom.ownerDocument.addEventListener("mousemove", move);
          view.dom.ownerDocument.addEventListener("mouseup", end, { once: true });
        }
        return true;
      },
      click(event, view) { return handleClick(event, view, callbacks); },
      // La composizione finita libera la rivelazione: se non ha cambiato il
      // testo, nessuna transazione lo direbbe al plugin.
      compositionend(_event, view) {
        queueMicrotask(() => {
          if (!view.compositionStarted && view.plugin(plugin)?.held) view.dispatch({});
        });
        return false;
      },
    },
  });
  // Backspace e Canc accanto a un segno nascosto lo saltano e cancellano la
  // lettera, e l'ultima lettera di un elemento porta via i suoi segni: nel
  // file non resta un `****`. Soltanto con `mai`: con le altre politiche i
  // segni accanto al cursore si vedono, e si cancellano come sempre.
  const deleteNear = (forward: boolean) => (view: EditorView): boolean => {
    if (view.state.facet(liveReveal) !== "mai" || view.state.readOnly) return false;
    const hidden = view.plugin(plugin)?.hidden;
    if (!hidden) return false;
    const plan = hiddenDeletion(view.state, hidden, forward);
    if (!plan) return false;
    view.dispatch(plan);
    return true;
  };
  const deleteKeys = Prec.high(keymap.of([
    { key: "Backspace", run: deleteNear(false) },
    { key: "Delete", run: deleteNear(true) },
  ]));
  // Dopo che la vista ha posato il DOM: i blocchi resi che una modifica ha
  // spostato rimettono a posto le loro coordinate.
  // Un widget tenuto da una resa di prima può nascere dopo, quando scorre nella
  // vista: anche lui comincia con le coordinate del blocco da cui viene.
  const realign = EditorView.updateListener.of((update) => {
    // Una riconfigurazione che accende la Live non ha il campo nello stato di prima.
    if (!update.docChanged && !update.viewportChanged && update.startState.field(blocks, false) === update.state.field(blocks)) return;
    for (const root of update.view.contentDOM.querySelectorAll<HTMLElement>(":scope > .cm-markdown-block")) {
      realignMounted(update.view, root);
    }
  });
  return [
    theme, figureTheme(), footnoteLabelsField, blocks, gapLines, parseRest, plugin, blockPrefixes(), emptyPairsExtension(), pendingGuide(), edgeSpaces(), keepMarks(), signsOnFirstLetter(), codeBlocks(), calloutGestures(), detailsLive(), imageGestures(), hangingIndent(), mathPopovers((view, pos, side) => formulaIn(view.plugin(plugin)?.decorations, pos, side)), liveHints(() => callbacks.slashEnabled?.() ?? false), deleteKeys, realign, tableGrids(callbacks),
    propertiesExtension(),
    callbacks.linkCard ? linkCardGestures(callbacks.linkCard) : [],
  ];
}
