// Inactive blocks share their HTML renderer with Reading. Active blocks keep
// source coordinates, native selections and the existing inline decorations.
import {
  StateEffect,
  type EditorState,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  EditorSelection,
  Facet,
  Prec,
  RangeSet,
  RangeValue,
  type SelectionRange,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";
import { taskChecked } from "../../../../rules/mirrored";
import { hidesPageBreak } from "../../../../rules/page-break";
import { dueLook, liveProjection, liveTaskEnd, localDay, projectedDue } from "./task-due";
import { projectedReminder } from "./task-reminder";
import { openLifetime } from "../../../../ui/lifetime";
import { figureMask, PAGE_FIGURES } from "../../../../ui/page-mark";
import type { SyntaxForm } from "../../../../host/contract";
import {
  inlineDelimiters,
  scanTags,
  textSpans,
  listItem,
  wikilink,
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
import { decodeDestination, decodeEntities, normalizeLabel } from "./link-syntax";
import { FOOTNOTE_DEFINITION } from "./grammar";
import { commentCopy } from "./comments/copy";
import { commentDecorations, commentEditing } from "./comments/mask";
import { threadCuts } from "./comments/syntax";
import { emptyPairsExtension } from "./empty-pair";
import { edgeSpaces } from "./edge-space";
import { keepMarks } from "./keep-marks";
import { signsOnFirstLetter } from "./format-toggle";
import type { MarkdownBlock, MarkdownDocument, MarkdownLinkDefinition } from "./render-types";
import { isVaultPath } from "./media";
import {
  containerMath,
  embedHtml,
  figureHtml,
  commentsDeclared,
  containerComments,
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
  writtenLink,
  type DollarMath,
  type NativeInline,
} from "./render-inline";
import { mediaKindOfId } from "../../../media/media-types";
import { TableWidget, tableGrids, tableOfBlock } from "./table-widget";
import { propertiesExtension } from "./properties";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { pendingGuide } from "./pending";
import { liveHints } from "./hints";
import {
  choosingBlocks,
  DiagramLiveWidget,
  diagramBlockKeys,
  diagramSourceLines,
  fenceBody,
} from "./diagram-live";
import { dayPage } from "./day-page";
import { typePage } from "./type-page";
import { calloutGestures } from "./callout";
import { detailsLive } from "./details-live";
import { calloutHead } from "./callout-head";
import { hangingIndent } from "./hanging";
import {
  blockTex,
  blockTexRange,
  MathBlockEditWidget,
  MathBlockLiveWidget,
  mathPopovers,
  mathTouchable,
  typingMathBlock,
} from "./math-live";
import { imageGestures } from "./image-live";
import { CodeHeaderWidget, codeBlocks, codeWrapChanged, codeWraps } from "./code-block";
import { blockPrefixes } from "./block-prefix";
import { linkDialogOpener } from "./link-dialog";
import { topChanges } from "./top-changes";
import { mergeRanges, RowSweep, SpanIndex, symmetricDifference, uncovered } from "./live-spans";
import {
  bareUrl,
  bareWikilink,
  linkCardGestures,
  linkCardsChanged,
  LinkCardWidget,
  noteCardGestures,
  NoteCardWidget,
} from "./link-card";
import { holdsLiveCard, liveCardEmbed, LiveCardWidget, type LiveCardEmbed } from "./live-cards";
import { cellShownAsValue, cellValueRef, onlyCellValues } from "./cell-value";
import {
  ATTR_FOOTNOTE,
  type CardTarget,
  INLINE_MARKS,
  INLINE_SYNTAX,
  type LiveDeco,
  type LiveDecoKind,
  type LivePreviewCallbacks,
  NOTE_HOLD_DELAY_MS,
  type Reveal,
  footnoteLabelsField,
  footnoteLabelsOf,
  lineReveal,
  namesSomething,
  pageIconsChanged,
  revealOf,
  touchesFootnoteLine,
} from "./livepreview-model";
import {
  HEADING_LINES,
  codeHeaderLine,
  columnIndex,
  fenceCloseLine,
  firstFootnoteReference,
  formulaIn,
  handleClick,
  inDecoration,
} from "./livepreview-widgets";
import {
  LINE_KINDS,
  hiddenDeletion,
  hiddenGroupDeletion,
  keepPunctuation,
  wholePills,
} from "./livepreview-pills";
import {
  MarkdownWidget,
  interactiveTarget,
  realignMounted,
  sourcePositionAtPoint,
} from "./livepreview-mapped";
import { theme } from "./livepreview-theme";

export {
  activeLinesOf,
  footnoteLabels,
  footnoteLabelsField,
  pageIconsChanged,
  revealOf,
} from "./livepreview-model";
export type { LiveDeco, LiveDecoKind, LivePreviewCallbacks, Reveal } from "./livepreview-model";
export { hiddenDeletion, hiddenGroupDeletion, wholePill, wholePills } from "./livepreview-pills";
export { firstFootnoteReference, pillLabel, reminderTitle } from "./livepreview-widgets";
export { sourcePositionAtPoint, sourcePositionInMapped } from "./livepreview-mapped";

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
  cells = false,
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
  // Il giro sull'albero le raccoglie in fila; il secondo strato le legge da un
  // indice ordinato (`SpanIndex`), a cui aggiunge i wikilink che trova.
  const exclusions: { from: number; to: number }[] = [];
  // Le entità HTML risolte (UX-102): si posano alla fine, fuori dai wikilink,
  // che le leggono come lettere, e da ciò che il secondo strato esclude.
  const entities: LiveDeco[] = [];
  let excluded: SpanIndex | null = null;
  const codeRows = new Set<number>();
  const isFree = (a: number, b: number) => !(excluded ??= new SpanIndex(exclusions)).overlaps(a, b);
  // Dedupe delle decorazioni di riga: blocchi annidati (citazione dentro
  // citazione) non devono impilare due volte la stessa classe.
  const quoteRows = new Set<number>();
  // Il giorno di chi guarda, per dire se una scadenza è vicina, e le
  // pastiglie delle scadenze, che si posano per ultime (`wholePill`).
  const today = localDay();
  // Le pastiglie, ognuna col tratto del suo compito: la riga della casella e
  // quelle che la continuano.
  const pills: { pill: LiveDeco; from: number; to: number }[] = [];

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
  // Le formule di un contenitore vengono in fila e separate, come le legge
  // `scanDollarMath`: allora quelle che toccano un nodo si trovano con una
  // ricerca binaria. Se no, si guardano tutte.
  let aroundOrdered = true;
  const crossesFormula = (node: { from: number; to: number }): boolean => {
    const crosses = (math: DollarMath) =>
      math.from < node.to && node.from < math.to && (math.from < node.from || node.to < math.to);
    if (!aroundOrdered) return around.some(crosses);
    let low = 0;
    let high = around.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (around[middle]!.to <= node.from) low = middle + 1;
      else high = middle;
    }
    for (let at = low; at < around.length && around[at]!.from < node.to; at++) if (crosses(around[at]!)) return true;
    return false;
  };
  const collectFormulas = (container: SyntaxNode): string => {
    const text = doc.sliceString(container.from, container.to);
    const found = containerMath(text, container);
    around = found.formulas;
    aroundOrdered = around.every((math, at) => math.from <= math.to && (at === 0 || around[at - 1]!.to <= math.from));
    if (found.formulas.length === 0) return text;
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
    return text;
  };

  // Gli inline che il modello del provider ha come nodi, raccolti per
  // contenitore con la regola della Lettura (`nativeInlines`): un evidenziato,
  // un commento o una nota in riga non li attraversano. Un blocco HTML non ha
  // testo del modello. Qui le definizioni dei riferimenti non si conoscono, e
  // un link conta soltanto se ha la destinazione scritta.
  const natives: NativeInline[] = [];
  const opaqueBlocks: { from: number; to: number }[] = [];
  // I commenti CriticMarkup (`comments/`), con la sintassi `fub:comments`
  // accesa: i loro messaggi, dove l'albero non si decora.
  const commentsOn = commentsDeclared(forms);
  const messages: { from: number; to: number }[] = [];
  // I messaggi che possono ancora contenere un nodo: l'albero si visita per
  // inizio crescente, e un messaggio finito prima del nodo non ne conterrà
  // più nessuno.
  let liveMessages: { from: number; to: number }[] = [];
  let messagesSeen = 0;
  const inMessage = (from: number, to: number): boolean => {
    for (; messagesSeen < messages.length; messagesSeen++) liveMessages.push(messages[messagesSeen]!);
    if (liveMessages.length === 0) return false;
    liveMessages = liveMessages.filter((message) => message.to > from);
    return liveMessages.some((message) => message.from <= from && to <= message.to);
  };
  const sliceDoc = (from: number, to: number) => doc.sliceString(from, to);
  const liveLink = (link: SyntaxNode): NativeInline | null => writtenLink(sliceDoc, link);

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
      // Ciò che sta dentro un messaggio di un commento non è testo della nota:
      // né enfasi né link né codice, e sparisce col messaggio.
      if (messages.length > 0 && node.from < node.to && inMessage(node.from, node.to)) return false;
      if (isMathContainer(node.name)) {
        const text = collectFormulas(node.node);
        const found = nativeInlines(node.node, node.from, node.to, liveLink, around);
        natives.push(...found);
        // I commenti del contenitore: i segni e i messaggi tagliano il testo
        // per evidenziati, `%%`, wikilink e tag, e si disegnano qui.
        if (commentsOn) {
          for (const thread of containerComments(text, node.node, found, around)) {
            for (const cut of threadCuts(thread)) {
              natives.push(cut);
              exclusions.push(cut);
            }
            messages.push(...thread.messages);
            out.push(...commentDecorations(thread, reveal, doc));
          }
        }
      }
      // Ciò che sta in una formula non è sintassi, e un nodo che ne attraversa
      // una senza contenerla il provider non lo legge: come in Lettura non si
      // decora, e se ne visitano i figli. Un marcatore segue il suo nodo.
      const owner = INLINE_MARKS.has(node.name) ? node.node.parent : node.node;
      if (owner && INLINE_SYNTAX.has(owner.name) && around.length > 0 && crossesFormula(owner)) return;
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
            // Col cursore fra `[!` e `]` il tipo si sta scrivendo: resta
            // sorgente finché la `]` non lo chiude (IMP-6108).
            if (reveal.prefix(open.from, open.from + head.title.from) || reveal.inside(markFrom, open.from + head.title.from)) out.push({ from: markFrom, to: markTo, kind: "near" });
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
        // `&amp;`, `&lt;`, `&#39;` si leggono risolte, come in Lettura: il
        // widget prende il posto della sorgente, che torna col cursore accanto.
        // Un nome che HTML non conosce (`&nonesiste;`) resta testo, anche là.
        case "Entity": {
          const raw = doc.sliceString(node.from, node.to);
          const text = decodeEntities(raw);
          if (text !== raw && !reveal.source(node.from, node.to, node.from)) entities.push({ from: node.from, to: node.to, kind: "entity", data: text });
          return;
        }
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
        case "CommentBlock": {
          exclusions.push({ from: node.from, to: node.to });
          opaqueBlocks.push({ from: node.from, to: node.to });
          // L'interruzione di pagina a mano (D17, `<!-- pagina -->`) non si
          // vede, come in Lettura: la si ritrova sulla riga del cursore, per
          // cancellarla.
          if (node.name === "CommentBlock" && hidesPageBreak(doc, node.from, node.to, reveal)) out.push({ from: node.from, to: node.to, kind: "hide" });
          return false;
        }

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
  // Gli inline nativi e i blocchi opachi di ogni riga, con un cursore che
  // scende con le righe invece di filtrare tutta la vista a ogni riga.
  const nativeRows = new RowSweep(natives);
  const opaqueRows = new RowSweep(opaqueBlocks);
  // I segni già posati, per il promemoria di un compito: un indice che si
  // aggiorna con ciò che è arrivato dall'ultima volta.
  let marked: SpanIndex | null = null;
  let markedUpTo = 0;
  const touchesMark = (a: number, b: number): boolean => {
    if (!marked) {
      marked = new SpanIndex(out.filter((d) => !LINE_KINDS.has(d.kind)));
      markedUpTo = out.length;
    }
    for (; markedUpTo < out.length; markedUpTo++) if (!LINE_KINDS.has(out[markedUpTo]!.kind)) marked.add(out[markedUpTo]!);
    return marked.overlaps(a, b);
  };
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
    const rowNatives: NativeInline[] = nativeRows.at(row.from, row.to);
    for (const { math } of rowFormulas) if (!lostFormulas.has(math)) rowNatives.push(math);
    const rowCuts = [...nativeCuts(rowNatives).filter((cut) => cut.from < row.to && row.from < cut.to), ...opaqueRows.at(row.from, row.to)]
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
      excluded!.add({ from: rangeStart, to: rangeEnd });
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
      // Il valore di una cella in mezzo al testo (T53), fuori dal cursore come
      // un'immagine; da solo nel paragrafo è la scheda di foglio, a meno che
      // l'embed dica `|value`.
      if (cells && w.embed && !w.block && cellValueRef(w.page, w.heading) !== null
        && (!aloneAt(rangeStart, rangeEnd) || cellShownAsValue(w.alias))
        && (reveal.policy === "mai" || !reveal.source(rangeStart, rangeEnd, rangeStart))) {
        out.push({ from: rangeStart, to: rangeEnd, kind: "cell-value", data: w.target });
        continue;
      }
      if (reveal.policy !== "mai" && !(embedImage && imageShown(rangeStart, rangeEnd)) && reveal.source(rangeStart, rangeEnd, rangeStart)) {
        // Sorgente visibile ma link comunque cliccabile e stilato.
        out.push({ from: innerFrom, to: innerA, kind: "wikilink", data, writing: true });
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
        // Col cursore accanto, anche con `mai`, lo si sta scrivendo (UX-016).
        out.push({ from: showFrom, to: innerA, kind: "wikilink", data, ...(reveal.near(rangeStart, rangeEnd) ? { writing: true as const } : {}) });
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
      // La scadenza è una pastiglia anche sulla riga attiva: un segno sul
      // testo, che resta com'è e si scrive dentro la pastiglia. La regola
      // legge il testo del compito — il primo paragrafo, righe che lo
      // continuano comprese — senza la sintassi (`task-due.ts`), come la
      // ricerca e la vista: una data dentro un codice conta, un indirizzo no.
      const tree = syntaxTree(state);
      const taskEnd = liveTaskEnd(tree, boxFrom, row.to);
      const source = taskEnd > row.to ? doc.sliceString(row.from, taskEnd) : text;
      const projection = liveProjection(tree, source, row.from, paragraphEnd, taskEnd);
      const due = projectedDue(projection);
      // Il promemoria: una pastiglia al posto del testo, fuori dal cursore,
      // quando il suo tratto è tutto testo del compito (niente segni in
      // mezzo che un widget nasconderebbe) e non tocca altre decorazioni;
      // altrimenti, e col cursore dentro, il testo resta e si segna.
      const reminder = projectedReminder(projection);
      if (reminder) {
        const [from, to] = reminder.source;
        const look = reminder.when === null ? "bad" : checked ? "done" : "open";
        const data = `${look} ${reminder.when ?? ""}`;
        const touched = touchesMark(from, to);
        if (reminder.when !== null && reminder.whole && !touched && !reveal.marks(from, to, from)) {
          out.push({ from, to, kind: "task-reminder", data });
        } else if (!touched) {
          out.push({ from, to, kind: "task-reminder-source", data });
        }
      }
      if (due) {
        const look = dueLook(due, checked, today);
        pills.push({
          pill: { from: due.source[0], to: due.source[1], kind: "task-due", data: look === "plain" ? undefined : look },
          from: row.from,
          to: Math.max(taskEnd, row.to),
        });
      }
    }
  }

  keepPunctuation(doc, out);
  for (const entity of entities) if (isFree(entity.from, entity.to)) out.push(entity);
  out.push(...wholePills(pills, out));
  // A pari tratto la pastiglia viene prima, cioè fuori: CodeMirror annida per
  // primo il segno che trova per primo.
  out.sort((a, b) => a.from - b.from || a.to - b.to || Number(b.kind === "task-due") - Number(a.kind === "task-due"));
  return out;
}

const GAP = Decoration.line({ class: "cm-markdown-gap" });

/// La prima riga dopo un blocco reso quando il cursore sta su una delle sue
/// righe vuote: la riga del cursore si vede, e lo stacco sotto il blocco (il
/// suo padding, `cm-markdown-block` e `tb-frame` nella pelle) le cede il
/// posto, così il testo che segue non si sposta (#411, A-01).
const GAP_LEAD = Decoration.line({ class: "cm-markdown-gap-lead" });

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
    /// Un paragrafo che è soltanto un indirizzo o un wikilink: la sua scheda
    /// (K8, E11).
    readonly linkCard: CardTarget | undefined,
    /// Un paragrafo che è soltanto l'embed di un file: la sua scheda viva (T41).
    readonly liveCard: LiveCardEmbed | undefined,
    /// La scelta che la selezione ha dettato: blocco reso o sorgente, righe
    /// vuote dopo nascoste o no. Uguale, il candidato resta quello di prima.
    readonly decision: string,
  ) {
    super();
  }
  decided(decision: string): CandidateMark {
    return new CandidateMark(this.block, this.offset, this.length, this.grid, this.linkCard, this.liveCard, decision);
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
      // Un paragrafo di soli valori di cella (T53) è testo: i valori stanno
      // in riga, come in mezzo a una frase.
      const media = block.kind === "paragraph" && onlyMedia(block.source)
        && !(callbacks.cellValues !== undefined && onlyCellValues(block.source));
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
    const note = !rendered && !url && callbacks.linkCard?.note && block.kind === "paragraph" ? bareWikilink(block.source) : null;
    const card: CardTarget | undefined = url ? { kind: "web", url } : note ? { kind: "note", ...note } : undefined;
    const live = rendered && callbacks.liveCards && block.kind === "paragraph" ? liveCardEmbed(block.source) ?? undefined : undefined;
    if (!card && !live) {
      if (!rendered) return null;
      if (policy !== "riga" && block.kind === "paragraph" && onlyImages(block.source)) return null;
    }
    const from = lineStart(source, block.from);
    const next = following ? lineStart(source, following.from) : source.length;
    const mark = new CandidateMark(block, block.from - from, block.to - block.from, card || live ? false : grid, card, live, "");
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
    const { linkCard, grid, liveCard } = mark;
    if (liveCard !== undefined && callbacks.liveCards) {
      // Col cursore dentro l'embed si scrive com'è; scelta coi Blocchi la
      // scheda resta scheda, come un diagramma (E19).
      if (touched(state, from, to) && !choosingBlocks(state)) return { decision: "s", ranges };
      ranges.push(Decoration.replace({ block: true, widget: new LiveCardWidget(liveCard, callbacks.liveCards) }).range(from, to));
      return { decision: "c", ranges };
    }
    if (linkCard !== undefined) {
      // Col cursore dentro, l'indirizzo (o il wikilink) si scrive com'è.
      if (touched(state, from, to) || !callbacks.linkCard) return { decision: "s", ranges };
      if (linkCard.kind === "note") {
        // Finché la nota non è nota (la domanda in corso, un link che non
        // porta a niente) il paragrafo resta il suo link.
        const seen = callbacks.linkCard.note?.(linkCard.page) ?? { kind: "missing" as const };
        if (seen.kind !== "card") return { decision: `n${seen.kind}`, ranges };
        const widget = new NoteCardWidget(linkCard.page, linkCard.heading, linkCard.block, linkCard.alias, seen.card);
        ranges.push(Decoration.replace({ block: true, widget }).range(from, to));
        return { decision: "ncard", ranges };
      }
      const card = callbacks.linkCard.view(linkCard.url);
      ranges.push(Decoration.replace({ block: true, widget: new LinkCardWidget(linkCard.url, card) }).range(from, to));
      return { decision: `k${card.kind}`, ranges };
    }
    const block = movedBlock(mark.block, from + mark.offset);
    if (!grid && block.kind === "math" && touched(state, from, to) && mathTouchable(state) && blockTexRange(state, from)
      && !typingMathBlock(state, from)) {
      // Un blocco `$$` toccato si modifica sul posto, senza il suo LaTeX (T60).
      ranges.push(Decoration.replace({ block: true, widget: new MathBlockEditWidget(from, blockTex(block.source)) }).range(from, to));
      return { decision: "mx", ranges };
    }
    const mermaid = block.kind === "diagram" && /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/i.test(block.source);
    // Un diagramma scelto coi Blocchi si vede disegnato: si sceglie, non si
    // scrive (E26).
    // Così le colonne (o una citazione) con dentro una scheda viva (T41): il
    // testo si guarda solo se il blocco è toccato da una scelta di blocchi.
    const chosenObject = (): boolean => choosingBlocks(state)
      && (mermaid || (callbacks.liveCards !== undefined && holdsLiveCard(block.source)));
    if (!grid && touched(state, from, to) && !chosenObject()) {
      // Un diagramma toccato si scrive come codice, e il disegno gli sta
      // accanto (C5, E26).
      if (mermaid) {
        ranges.push(...diagramSourceLines(state, from, to));
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
    const first = lineFrom;
    let open = false;
    while (lineFrom !== -1 && lineFrom < next) {
      const end = source.indexOf("\n", lineFrom);
      const lineTo = end === -1 ? source.length : end;
      const blank = !/\S/.test(source.slice(lineFrom, lineTo));
      if (blank && !touched(state, lineFrom, lineTo)) {
        ranges.push(GAP.range(lineFrom));
        decision += "g";
      } else {
        // Una riga vuota col cursore si vede e prende lo stacco del blocco.
        if (blank) open = true;
        decision += blank ? "o" : "-";
      }
      if (end === -1) break;
      lineFrom = end + 1;
    }
    if (open) ranges.push(GAP_LEAD.range(first));
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
    // Un tratto rifatto perde le sue decorazioni: quelle che cominciano dentro,
    // e in fondo alla nota anche quelle posate proprio sulla fine. Il disegno
    // accanto alla sorgente di un blocco toccato (la formula `$$`, il
    // diagramma) sta alla fine del blocco, e in fondo alla nota la fine del
    // blocco è la fine del tratto: senza, ogni battuta ne lasciava uno in più
    // (IMP-6101, IMP-6102). Più avanti, la fine è l'inizio del tratto dopo, e
    // ciò che vi comincia è suo.
    const end = state.doc.length;
    for (const { from, to } of cleared) {
      const own = (start: number) => start >= from && (start < to || to === end);
      candidates = candidates.update({ filterFrom: from, filterTo: to, filter: (_from, _to, mark) => !dropped.has(mark) });
      decorations = decorations.update({ filterFrom: from, filterTo: to, filter: (start) => !own(start) });
      gaps = gaps.update({ filterFrom: from, filterTo: to, filter: (start) => !own(start) });
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
      for (const item of computeDecorations(state, active, visible.from, visible.to, forms, callbacks.cellValues !== undefined)) {
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
          if (item.kind === "hide" || item.kind === "hr" || item.kind === "checkbox" || item.kind === "math" || item.kind === "entity"
            || item.kind === "image" || item.kind === "cell-value" || item.kind === "link-pill" || item.kind === "footnote-back" || item.kind === "task-reminder"
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
        // La pastiglia del promemoria apre la scelta del giorno e dell'ora.
        const reminder = target?.closest<HTMLElement>(".cm-fub-reminder");
        if (reminder && event.button === 0) {
          event.preventDefault();
          const at = view.posAtDOM(reminder);
          void import("./reminder-picker").then((picker) => picker.openReminderPicker(view, at, reminder), () => {});
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
          // Una vita per trascinamento: la chiudono il rilascio e `destroy`.
          const drag = openLifetime();
          const end = () => {
            drag.close();
            owner.endDrag = undefined;
          };
          owner.endDrag = end;
          drag.listen(view.dom.ownerDocument, "mousemove", move);
          drag.listen(view.dom.ownerDocument, "mouseup", end);
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
  // La parola intera (Mod-Backspace, Mod-Canc; Alt su macOS, come in
  // `defaultKeymap`) salta i segni nello stesso modo, fino alla parola che si
  // vede.
  const deleteWordNear = (forward: boolean) => (view: EditorView): boolean => {
    if (view.state.facet(liveReveal) !== "mai" || view.state.readOnly) return false;
    const hidden = view.plugin(plugin)?.hidden;
    if (!hidden) return false;
    const plan = hiddenGroupDeletion(view.state, hidden, forward);
    if (!plan) return false;
    view.dispatch(plan);
    return true;
  };
  const deleteKeys = Prec.high(keymap.of([
    { key: "Backspace", run: deleteNear(false) },
    { key: "Delete", run: deleteNear(true) },
    { key: "Mod-Backspace", mac: "Alt-Backspace", run: deleteWordNear(false) },
    { key: "Mod-Delete", mac: "Alt-Delete", run: deleteWordNear(true) },
  ]));
  // Le schede delle note che il testo ha (anche quelle ancora link, la nota
  // che non c'è o la domanda in corso): l'editor le tiene finché le ha, e chi
  // le possiede richiede soltanto quelle tenute (`state/note-cards.ts`). Si
  // ricontano poco dopo che i candidati cambiano, non a ogni battuta.
  const linkSource = callbacks.linkCard;
  const noteHolds = linkSource?.holdNote ? ViewPlugin.fromClass(class {
    held = new Map<string, () => void>();
    timer: ReturnType<typeof setTimeout> | null = null;
    candidates: RangeSet<CandidateMark> | null = null;
    constructor(readonly view: EditorView) { this.count(); }
    update(update: ViewUpdate): void {
      if (update.state.field(blocks, false)?.candidates === this.candidates || this.timer !== null) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.count();
      }, NOTE_HOLD_DELAY_MS);
    }
    count(): void {
      const value = this.view.state.field(blocks, false);
      this.candidates = value?.candidates ?? null;
      const pages = new Set<string>();
      value?.candidates.between(0, this.view.state.doc.length, (_from, _to, mark) => {
        if (mark.linkCard?.kind === "note") pages.add(mark.linkCard.page);
      });
      for (const [page, release] of this.held) {
        if (pages.has(page)) continue;
        this.held.delete(page);
        release();
      }
      for (const page of pages) {
        if (!this.held.has(page)) this.held.set(page, linkSource.holdNote!(page));
      }
    }
    destroy(): void {
      if (this.timer !== null) clearTimeout(this.timer);
      for (const release of this.held.values()) release();
      this.held.clear();
    }
  }) : [];
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
    commentEditing(forms), commentCopy(forms),
    callbacks.linkCard?.note ? noteCardGestures(callbacks) : [],
    callbacks.liveCards ? callbacks.liveCards.extension() : [],
    noteHolds,
    diagramBlockKeys,
    callbacks.dayPage ? dayPage(callbacks.dayPage) : [],
    callbacks.typePage ? typePage(callbacks.typePage) : [],
  ];
}
