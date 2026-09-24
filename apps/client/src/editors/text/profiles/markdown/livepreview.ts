// Inactive blocks share their HTML renderer with Reading. Active blocks keep
// source coordinates, native selections and the existing inline decorations.
import type { EditorState, Extension, Range } from "@codemirror/state";
import { EditorSelection, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
// La lettura binaria di una casella è una regola del contratto, non del
// disegno: `[/]`, `[-]`, `[>]` sono stati che esistono e non sono "fatto".
import { taskChecked } from "../../../../rules/mirrored";
import { t } from "../../../../i18n/strings";
import { isAllowedLink } from "../../../../ui/sanitize";
import type { SyntaxForm } from "../../../../host/contract";
import {
  inlineDelimiters,
  parseWikilinkInner,
  scanTags,
  spans,
  listItem,
  wikilink,
} from "../../../../rules/syntax";
import { findTrailingAnchor, renderMarkdownState } from "./render";
import type { MarkdownBlock, MarkdownDocument, MountMarkdown } from "./render-types";
import { mountMarkdown } from "../../../../ui/markdown";
import { mountMathBlocks } from "../../../../ui/math";
import { scanInlineMath } from "./render-inline";

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
  mountRendered?: MountMarkdown;
}

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
  // decorazioni di riga (from == to == inizio riga)
  | "quote-line"
  | "codeblock-line";

export interface LiveDeco {
  from: number;
  to: number;
  kind: LiveDecoKind;
  /// Payload per i kind che ne hanno uno: il bersaglio di un wikilink come sta
  /// scritto (`Nota#Sezione^blocco`), il nome di un tag, "x"/" " per lo stato
  /// di una checkbox.
  data?: string;
}

/// Le righe "attive" (numeri 1-based): ogni riga toccata da una selezione.
/// Su queste righe la sorgente resta visibile — è il cuore della modalità
/// live preview, e va ricalcolato a ogni selectionSet.
export function activeLinesOf(state: EditorState): Set<number> {
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).number;
    const line = state.doc.lineAt(r.to);
    const to = r.to > r.from && r.to === line.from ? line.number - 1 : line.number;
    for (let n = from; n <= to; n++) active.add(n);
  }
  return active;
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

/// La funzione pura al centro del modulo: dallo stato (albero Lezer + testo)
/// e dalle righe attive produce la lista ordinata degli intervalli da
/// decorare, limitata a [from, to] (i range visibili, quando chiama il
/// plugin; l'intero documento nei test).
///
/// Invarianti che il plugin dà per acquisiti: i replace ("hide", "hr",
/// "checkbox") non attraversano mai un fine riga e non si sovrappongono tra
/// loro; dentro codice (inline, fence, indentato), URL e markup HTML la
/// sintassi Obsidian non viene riconosciuta; l'output è ordinato per `from`.
export function computeDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from = 0,
  to = state.doc.length,
  forms?: readonly SyntaxForm[],
): LiveDeco[] {
  const out: LiveDeco[] = [];
  const declaredInline = inlineDelimiters(forms);
  const doc = state.doc;
  const active = (pos: number) => activeLines.has(doc.lineAt(pos).number);

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

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const heading = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const marks = node.node.getChildren("HeaderMark");
        if (!marks.length) return;
        if (heading[1] === "Setext") {
          // Nel Setext il contenuto è sulla riga precedente al marcatore:
          // nascondere il nodo intero cancellerebbe proprio il titolo.
          const underline = marks[marks.length - 1];
          const title = doc.lineAt(node.from);
          if (!active(underline.from)) {
            out.push({ from: underline.from, to: underline.to, kind: "hide" });
          }
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
        if (!active(node.from)) {
          out.push({ from: node.from, to: textFrom, kind: "hide" });
          if (close && textEnd < node.to) out.push({ from: textEnd, to: node.to, kind: "hide" });
        }
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
          if (!active(node.from)) out.push({ from: node.from, to: node.to, kind: "hide" });
          return;
        case "StrongEmphasis":
          markContent(node, "EmphasisMark", "strong");
          return;
        case "Emphasis":
          markContent(node, "EmphasisMark", "em");
          return;
        case "Strikethrough":
          markContent(node, "StrikethroughMark", "strike");
          return;

        case "InlineCode": {
          // I CodeMark si gestiscono qui e non in un case globale: quelli
          // delle fence NON vanno nascosti.
          const marks = node.node.getChildren("CodeMark");
          for (const m of marks) {
            if (!active(m.from)) out.push({ from: m.from, to: m.to, kind: "hide" });
          }
          markContent(node, "CodeMark", "code");
          exclusions.push({ from: node.from, to: node.to });
          return false;
        }

        case "FencedCode":
        case "CodeBlock": {
          // Sfondo di riga, fence visibili (niente hide), e righe intere
          // sottratte al livello regex: dentro il codice `[[x]]` è codice.
          forRow(node, codeRows, "codeblock-line");
          return false;
        }

        case "Blockquote":
          forRow(node, quoteRows, "quote-line");
          return; // i figli (QuoteMark, paragrafi con enfasi) proseguono
        case "QuoteMark":
          out.push({ from: node.from, to: node.to, kind: "quote-mark" });
          return;

        case "HorizontalRule":
          if (!active(node.from)) out.push({ from: node.from, to: node.to, kind: "hr" });
          return;

        case "URL":
          exclusions.push({ from: node.from, to: node.to });
          return;
        // HTML grezzo e commenti: il testo letterale del markup non è sintassi
        // Obsidian (un `#frag` in un attributo non è un tag). Il testo FRA i
        // tag resta decorabile: di là lo si legge come prosa.
        case "HTMLTag":
        case "Comment":
          exclusions.push({ from: node.from, to: node.to });
          return;
        case "HTMLBlock":
        case "CommentBlock":
          exclusions.push({ from: node.from, to: node.to });
          return false;

        case "Link": {
          // Fuori dalla riga attiva resta solo il testo: `[` e `](url…)`
          // spariscono. Un link spezzato su più righe non si tocca (i
          // replace non devono mai attraversare un fine riga).
          const marks = node.node.getChildren("LinkMark");
          // Senza URL è un reference link o un `[testo]` nudo — spesso il
          // cuore di un `[[wikilink]]`, che il parser non conosce: qui non si
          // tocca niente, altrimenti i suoi `[`/`]` nascosti si accavallano
          // ai replace del livello regex.
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
          if (singleRow && !active(node.from)) {
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
    const rowActive = activeLines.has(n);

    // I commenti prima di tutto il resto: ciò che contengono (link, tag,
    // evidenziati) non è sintassi viva. Fuori dalla riga attiva spariscono
    // interi, delimitatori compresi; sulla riga attiva restano, attenuati.
    for (const t of spans(text, declaredInline)) {
      if (t.name !== "fub:comments") continue;
      const rangeStart = row.from + t.from;
      const rangeEnd = row.from + t.to;
      if (!isFree(rangeStart, rangeEnd)) continue;
      exclusions.push({ from: rangeStart, to: rangeEnd });
      out.push(
        rowActive
          ? { from: rangeStart, to: rangeEnd, kind: "highlight", data: "comment" }
          : { from: rangeStart, to: rangeEnd, kind: "hide" },
      );
    }

    // Wikilink ed embed. Il match diventa a sua volta un'esclusione: un
    // `#heading` o un `|` dentro `[[…]]` non sono un tag né altro.
    for (const w of wikilink(text)) {
      // Senza pagina e senza punto (`[[]]`, `[[ ]]`) non c'è niente da
      // nominare (cfr. `names_host` nel contratto): niente hide, niente mark,
      // niente click. `[[#Sezione]]` nomina questa nota e resta.
      if (w.page.trim() === "" && (w.heading ?? "") === "" && (w.block ?? "").trim() === "") {
        continue;
      }
      const rangeStart = row.from + w.from;
      const rangeEnd = row.from + w.to;
      if (!isFree(rangeStart, rangeEnd)) continue;
      exclusions.push({ from: rangeStart, to: rangeEnd });
      const innerFrom = row.from + w.innerFrom;
      const innerA = row.from + w.innerA;
      // Il payload porta il riferimento **intero**: pagina, heading e blocco.
      // Portava la sola pagina, quindi `Mod-click` su `[[Nota#Sezione]]`
      // apriva la nota in cima mentre lo stesso link in Lettura arrivava alla
      // sezione — due risposte per lo stesso link (§4.4).
      const data = w.target;
      if (rowActive) {
        // Sorgente visibile ma link comunque cliccabile e stilato.
        out.push({ from: innerFrom, to: innerA, kind: "wikilink", data });
      } else {
        // `![[foto.png|120]]`: il dopo-barra è una dimensione, non un alias. Si
        // mostra il bersaglio e sparisce `|120`, come in Lettura.
        if (w.embed && w.alias !== null && /^\s*\d{1,5}(?:x\d{1,5})?\s*$/.test(w.alias)) {
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
        out.push({ from: innerA, to: rangeEnd, kind: "hide" });
      }
    }

    // I tratti fra delimitatori **dichiarati** (`==evidenziato==` e chi verrà):
    // il mark resta anche sulla riga attiva, spariscono solo i marcatori.
    for (const t of spans(text, declaredInline)) {
      const rangeStart = row.from + t.from;
      const rangeEnd = row.from + t.to;
      if (!isFree(rangeStart, rangeEnd)) continue;
      const className = t.name.slice(t.name.lastIndexOf(":") + 1);
      if (className === "comments") continue;
      if (!rowActive) {
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
    if (!rowActive && (n === doc.lines || doc.line(n + 1).text.trim() === "")) {
      const anchor = findTrailingAnchor(text);
      if (anchor) {
        const anchorFrom = row.from + anchor.start;
        if (isFree(anchorFrom, row.to)) out.push({ from: anchorFrom, to: row.from + text.trimEnd().length, kind: "hide" });
      }
    }

    // Formule in riga: fuori dalla riga attiva il TeX diventa la formula
    // resa, sulla riga attiva resta sorgente. La regola del riconoscimento è
    // quella della Lettura (`scanInlineMath`), non una seconda regex.
    if (!rowActive) {
      for (const math of scanInlineMath(text)) {
        const mathFrom = row.from + math.from;
        const mathTo = row.from + math.to;
        if (!isFree(mathFrom, mathTo)) continue;
        exclusions.push({ from: mathFrom, to: mathTo });
        out.push({ from: mathFrom, to: mathTo, kind: "math", data: text.slice(math.contentFrom, math.contentTo) });
      }
    }

    // Tag: mai nascosti, sempre marcati (e cliccabili) — anche sulla riga
    // attiva. La regola è quella del contratto (`scan_tags`), non una regex di
    // qua: era più stretta, e `vedi.#tag` restava senza decorazione mentre il
    // modello lo indicizzava.
    for (const t of scanTags(text)) {
      const tagFrom = row.from + t.from;
      const tagA = row.from + t.to;
      if (!isFree(tagFrom, tagA)) continue;
      out.push({ from: tagFrom, to: tagA, kind: "tag", data: t.name });
    }

    // Checkbox a inizio voce: fuori dalla riga attiva il `[ ]`/`[x]` diventa
    // un widget; il barrato leggero sulla voce fatta resta sempre.
    const entry = listItem(text);
    if (entry && entry.symbol !== null && entry.boxFrom >= 0) {
      const boxFrom = row.from + entry.boxFrom;
      const paragraphEnd = row.from + entry.boxTo; // subito dopo `]`
      const checked = taskChecked(entry.symbol);
      if (!rowActive) {
        out.push({ from: boxFrom, to: paragraphEnd, kind: "checkbox", data: checked ? "x" : " " });
      }
      if (checked && paragraphEnd + 1 < row.to) {
        out.push({ from: paragraphEnd + 1, to: row.to, kind: "done" });
      }
    }
  }

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

// ---------------------------------------------------------------------------
// Da qui in giù: widget, gesti DOM, tema e lifecycle del plugin CM6.

const mathTeardowns = new WeakMap<HTMLElement, () => void>();

/// Una formula in riga resa al posto del suo `$…$` fuori dalla riga attiva.
/// Il motore è quello della Lettura (`mountMathBlocks`), caricato solo quando
/// una formula c'è; lo smontaggio del widget chiude anche il suo caricamento.
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

/// La linea resa al posto di `---`/`***` fuori dalla riga attiva.
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
const quoteLine = Decoration.line({ class: "cm-fub-quote" });
const marksMap: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
  (["h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "strike", "code", "link", "highlight", "done", "quote-mark"] as const).map(
    (kind) => [kind, Decoration.mark({ class: `cm-fub-${kind}` })],
  ),
);

function inDecoration(d: LiveDeco): Decoration {
  switch (d.kind) {
    case "hide":
      return hidden;
    case "hr":
      return ruler;
    case "checkbox":
      return d.data === "x" ? checkedBox : boxEmpty;
    case "math":
      return Decoration.replace({ widget: new InlineMathWidget(d.data ?? "") });
    case "codeblock-line":
      return codeLine;
    case "quote-line":
      return quoteLine;
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
    case "wikilink":
      return Decoration.mark({
        class: "cm-fub-wikilink",
        attributes: { [ATTR_WIKILINK]: d.data ?? "" },
      });
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
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: taskChecked(threeChars[1]) ? " " : "x" },
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
// (`--doc-*` in `theme/serie/foglio-scuro.css`): sono gli stessi che usa la modalità Lettura, e
// tenerne due copie significherebbe che passare da Live a Lettura cambia i
// colori della stessa nota. Le variabili hanno un fallback, così l'estensione
// resta montabile anche senza il CSS della shell.
const theme = EditorView.baseTheme({
  ".cm-markdown-gap": { height: "0", lineHeight: "0", fontSize: "0", padding: "0" },
  ".cm-fub-h1": { fontSize: "var(--text-3xl, 1.5em)", fontWeight: "700" },
  ".cm-fub-h2": { fontSize: "var(--text-2xl, 1.35em)", fontWeight: "700" },
  ".cm-fub-h3": { fontSize: "var(--text-xl, 1.2em)", fontWeight: "500" },
  ".cm-fub-h4": { fontSize: "var(--text-lg, 1.1em)", fontWeight: "700" },
  ".cm-fub-h5": { fontSize: "var(--text-sm, 0.9em)", fontWeight: "700" },
  ".cm-fub-h6": { fontSize: "var(--text-sm, 0.9em)", fontWeight: "500" },
  ".cm-fub-h1, .cm-fub-h2, .cm-fub-h3, .cm-fub-h4, .cm-fub-h5, .cm-fub-h6": {
    color: "var(--doc-heading, var(--doc-fg))", lineHeight: "var(--leading-tight, 1.2)",
  },
  ".cm-fub-h1 > span, .cm-fub-h2 > span, .cm-fub-h3 > span, .cm-fub-h4 > span, .cm-fub-h5 > span, .cm-fub-h6 > span": {
    color: "inherit",
  },
  ".cm-fub-strong": { fontWeight: "700" },
  ".cm-fub-em": { fontStyle: "italic" },
  ".cm-fub-strike": { textDecoration: "line-through" },
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
});

/// L'estensione live preview, pronta da montare in `editor.ts` accanto a
/// `markdown()`. I callback sono iniettati dalla shell: qui non si sa cosa
/// significhi "aprire una nota".
const mountedBlocks = new WeakMap<HTMLElement, {
  from: number; source: string; dependencies: string; readOnly: boolean; dispose: () => void;
  anchors: ReadonlyMap<string, number>;
}>();

function interactiveTarget(target: Element | null, event: MouseEvent): boolean {
  if (!target) return false;
  if (target.closest("button, input, select, textarea, summary, [data-ui-slot], .tag[data-tag]")) return true;
  return !!target.closest("a") && (event.ctrlKey || event.metaKey);
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
  constructor(
    readonly block: MarkdownBlock,
    readonly dependencies: string,
    readonly readOnly: boolean,
    readonly callbacks: LivePreviewCallbacks,
    readonly anchors: ReadonlyMap<string, number>,
  ) { super(); }
  get estimatedHeight(): number {
    return Math.max(1, Math.ceil(this.block.source.length / 70)) * 28 + 8;
  }
  eq(other: MarkdownWidget): boolean {
    if (this.block.from !== other.block.from || this.block.to !== other.block.to
      || this.block.source !== other.block.source || this.dependencies !== other.dependencies
      || this.readOnly !== other.readOnly || this.anchors.size !== other.anchors.size) return false;
    for (const [key, value] of this.anchors) if (other.anchors.get(key) !== value) return false;
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-markdown-block markdown-rendered";
    root.contentEditable = "false";
    root.dataset.sourceFrom = String(this.block.from);
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
        const position = mountedBlocks.get(root)?.anchors.get(decoded);
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
      anchors: this.anchors,
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
    mounted.anchors = this.anchors;
    const delta = this.block.from - mounted.from;
    if (delta) {
      for (const element of root.querySelectorAll<HTMLElement>("[data-md-from], [data-md-to], [data-md-task]")) {
        if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
        for (const key of ["mdFrom", "mdTo", "mdTask"] as const) {
          const value = element.dataset[key];
          if (value !== undefined) element.dataset[key] = String(Number(value) + delta);
        }
      }
      mounted.from = this.block.from;
      root.dataset.sourceFrom = String(this.block.from);
    }
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

export function livePreview(
  callbacks: LivePreviewCallbacks,
  forms?: readonly SyntaxForm[],
): Extension {
  interface RenderState {
    document: MarkdownDocument;
    decorations: DecorationSet;
    replaced: readonly { from: number; to: number }[];
  }
  const touched = (state: EditorState, from: number, to: number) =>
    state.selection.ranges.some((range) => range.from <= to && range.to >= from);
  const blocks = StateField.define<RenderState>({
    create(state) { return buildBlocks(state, renderMarkdownState(state, forms)); },
    update(value, transaction) {
      const changed = transaction.docChanged;
      if (!changed && !transaction.selection && transaction.startState.readOnly === transaction.state.readOnly) return value;
      return buildBlocks(transaction.state, changed ? renderMarkdownState(transaction.state, forms) : value.document);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
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
  function buildBlocks(state: EditorState, document: MarkdownDocument): RenderState {
    const ranges: Range<Decoration>[] = [];
    const replaced: { from: number; to: number }[] = [];
    for (let index = 0; index < document.blocks.length; index++) {
      const block = document.blocks[index]!;
      const from = state.doc.lineAt(block.from).from;
      if (INLINE_KINDS.has(block.kind) || touched(state, from, block.to)) continue;
      const to = block.to;
      const next = document.blocks[index + 1] ? state.doc.lineAt(document.blocks[index + 1]!.from).from : state.doc.length;
      ranges.push(Decoration.replace({
        block: true,
        widget: new MarkdownWidget(block, document.dependencies, state.readOnly, callbacks, document.anchors),
      }).range(from, to));
      replaced.push({ from, to });
      let line = state.doc.lineAt(to);
      let number = line.number + (line.from < to ? 1 : 0);
      while (number <= state.doc.lines) {
        line = state.doc.line(number++);
        if (line.from >= next) break;
        if (!line.text.trim() && !touched(state, line.from, line.to)) {
          ranges.push(Decoration.line({ class: "cm-markdown-gap" }).range(line.from));
        }
      }
    }
    return { document, decorations: Decoration.set(ranges, true), replaced };
  }
  const buildInline = (view: EditorView): [DecorationSet, DecorationSet] => {
    const active = activeLinesOf(view.state);
    const replaced = view.state.field(blocks).replaced;
    const decorations: Range<Decoration>[] = [];
    const atomic: Range<Decoration>[] = [];
    const seen = new Set<string>();
    for (const visible of view.visibleRanges) {
      for (const item of computeDecorations(view.state, active, visible.from, visible.to, forms)) {
        if (replaced.some((range) => item.from >= range.from && item.from < range.to)) continue;
        const key = `${item.from}:${item.to}:${item.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const decoration = inDecoration(item);
        if (item.kind === "quote-line" || item.kind === "codeblock-line") {
          decorations.push(decoration.range(item.from));
        } else {
          const range = decoration.range(item.from, item.to);
          decorations.push(range);
          if (item.kind === "hide" || item.kind === "hr" || item.kind === "checkbox" || item.kind === "math") atomic.push(range);
        }
      }
    }
    return [Decoration.set(decorations, true), Decoration.set(atomic, true)];
  };
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;
    endDrag: (() => void) | undefined;
    constructor(view: EditorView) {
      [this.decorations, this.atomicRanges] = buildInline(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || update.startState.field(blocks) !== update.state.field(blocks)) {
        [this.decorations, this.atomicRanges] = buildInline(update.view);
      }
    }
    destroy() { this.endDrag?.(); }
  }, {
    decorations: (value) => value.decorations,
    provide: (extension) => EditorView.atomicRanges.of((view) => view.plugin(extension)?.atomicRanges ?? Decoration.none),
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target instanceof Element ? event.target : null;
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
    },
  });
  return [theme, blocks, plugin];
}
