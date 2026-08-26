// Live preview stile Obsidian: la riga col cursore mostra la sorgente, le
// altre mostrano la resa (marcatori nascosti, testo stilato, widget al posto
// di righelli e checkbox).
//
// Due vincoli architetturali, decisi in ../../../docs/project/status.md §6:
//
// - Le decorazioni leggono **l'albero Lezer** di `lang-markdown`, non gli
//   `Span` del modello Rust: il tree è già in code unit UTF-16 (la valuta di
//   CodeMirror), si aggiorna a ogni battuta senza IPC, e il problema
//   byte↔UTF-16 non esiste proprio. Gli `Span` restano per le decorazioni
//   semantiche di M3.
// - La sintassi che il parser non conosce (wikilink, i tratti fra
//   delimitatori, tag, checkbox) si riconosce **per riga**, e non qui: la
//   riconosce `rules/syntax.ts`, che è il posto unico in cui la shell
//   interpreta la dichiarazione del contratto (§4.4, decisione 0115). Gli
//   indici che ne tornano sono già code unit, quindi accenti ed emoji non
//   spostano nulla. Prima queste regex stavano scritte qui, e le stesse
//   sintassi erano riscritte diverse in `editor-commands.ts` e in
//   `completions.ts`.
//
// Il modulo è diviso in due strati, e la divisione è ciò che lo rende
// testabile: `computeDecorations` è una funzione pura (stato → lista di
// intervalli), verificabile in node senza DOM; il `ViewPlugin` che la applica
// è un guscio sottile e non ha test. Il tema vive qui dentro come `baseTheme`
// (classi `cm-fub-*`): nessun CSS globale da tenere allineato.
//
// NB: barrato (`~~`) e nodi GFM esistono solo se l'editor monta
// `markdown({ base: markdownLanguage })`; con il default commonmark quelle
// decorazioni semplicemente non compaiono.
import type { EditorState, Extension, Range } from "@codemirror/state";
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
import { taskChecked } from "../rules/mirrored";
import type { SyntaxForm } from "../host/contract";
import {
  inlineDelimiters,
  parseWikilinkInner,
  scanTags,
  spans,
  listItem,
  wikilink,
} from "../rules/syntax";

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
/// loro; dentro codice (inline, fence, indentato) e URL la sintassi Obsidian
/// non viene riconosciuta; l'output è ordinato per `from`.
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

  // Terreno vietato al livello regex: codice inline e URL (un `==` da base64
  // o un `#frammento` non sono sintassi Obsidian). I blocchi di codice
  // escludono righe intere, quindi viaggiano come numeri di riga.
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
      const heading = /^ATXHeading([1-6])$/.exec(node.name);
      if (heading) {
        const marks = node.node.getChildren("HeaderMark");
        if (!marks.length) return;
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
          out.push({ from: textFrom, to: textEnd, kind: ("h" + heading[1]) as LiveDecoKind });
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
          const href = url ? doc.sliceString(url.from, url.to) : "";
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

    // Wikilink ed embed. Il match diventa a sua volta un'esclusione: un
    // `#heading` o un `|` dentro `[[…]]` non sono un tag né altro.
    for (const w of wikilink(text)) {
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
      if (!rowActive) {
        out.push({ from: rangeStart, to: row.from + t.contentFrom, kind: "hide" });
        out.push({ from: row.from + t.contentTo, to: rangeEnd, kind: "hide" });
      }
      const className = t.name.slice(t.name.lastIndexOf(":") + 1);
      out.push({
        from: row.from + t.contentFrom,
        to: row.from + t.contentTo,
        kind: "highlight",
        data: className === "highlight" ? undefined : className,
      });
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
// Da qui in giù: il guscio CM6 (widget, tema, plugin). Niente test — la
// logica sta tutta sopra.

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
    const pos = view.posAtDOM(target);
    const threeChars = view.state.doc.sliceString(pos, pos + 3);
    if (/^\[[^\]\n]\]$/.test(threeChars)) {
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: taskChecked(threeChars[1]) ? " " : "x" },
      });
      e.preventDefault();
      return true;
    }
    return false;
  }

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
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
      e.preventDefault();
      return true;
    }
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
  ".cm-fub-h1": { fontSize: "1.7em", fontWeight: "700" },
  ".cm-fub-h2": { fontSize: "1.5em", fontWeight: "700" },
  ".cm-fub-h3": { fontSize: "1.3em", fontWeight: "700" },
  ".cm-fub-h4": { fontSize: "1.15em", fontWeight: "700" },
  ".cm-fub-h5": { fontSize: "1em", fontWeight: "700" },
  ".cm-fub-h6": { fontSize: "0.9em", fontWeight: "700", opacity: "0.8" },
  ".cm-fub-strong": { fontWeight: "700" },
  ".cm-fub-em": { fontStyle: "italic" },
  ".cm-fub-strike": { textDecoration: "line-through" },
  ".cm-fub-code": {
    background: "var(--doc-fill, rgba(135, 135, 135, 0.16))",
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
export function livePreview(
  callbacks: LivePreviewCallbacks,
  forms?: readonly SyntaxForm[],
): Extension {
  // Due insiemi dalla stessa passata: tutte le decorazioni per la resa, e i
  // soli replace come atomicRanges (il cursore scavalca i marcatori nascosti
  // invece di incagliarsi dentro).
  const build = (view: EditorView): [DecorationSet, DecorationSet] => {
    const active = activeLinesOf(view.state);
    const decorations: Range<Decoration>[] = [];
    const atomicRanges: Range<Decoration>[] = [];
    const rendered = new Set<string>();
    for (const r of view.visibleRanges) {
      for (const d of computeDecorations(view.state, active, r.from, r.to, forms)) {
        const key = `${d.from}:${d.to}:${d.kind}:${d.data ?? ""}`;
        if (rendered.has(key)) continue;
        rendered.add(key);
        const deco = inDecoration(d);
        if (d.kind === "quote-line" || d.kind === "codeblock-line") {
          decorations.push(deco.range(d.from));
          continue;
        }
        const range = deco.range(d.from, d.to);
        decorations.push(range);
        if (d.kind === "hide" || d.kind === "hr" || d.kind === "checkbox") {
          atomicRanges.push(range);
        }
      }
    }
    return [Decoration.set(decorations, true), Decoration.set(atomicRanges, true)];
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomicRanges: DecorationSet;
      constructor(view: EditorView) {
        [this.decorations, this.atomicRanges] = build(view);
      }
      update(u: ViewUpdate) {
        // selectionSet: la riga attiva è cambiata anche a documento fermo.
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          [this.decorations, this.atomicRanges] = build(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.atomicRanges ?? Decoration.none),
      eventHandlers: {
        mousedown(e, view) {
          return handleClick(e, view, callbacks);
        },
      },
    },
  );

  return [theme, plugin];
}
