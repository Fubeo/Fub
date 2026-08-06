// Live preview stile Obsidian: la riga col cursore mostra la sorgente, le
// altre mostrano la resa (marcatori nascosti, testo stilato, widget al posto
// di righelli e checkbox).
//
// Due vincoli architetturali, decisi in docs/todo.md §6:
//
// - Le decorazioni leggono **l'albero Lezer** di `lang-markdown`, non gli
//   `Span` del modello Rust: il tree è già in code unit UTF-16 (la valuta di
//   CodeMirror), si aggiorna a ogni battuta senza IPC, e il problema
//   byte↔UTF-16 non esiste proprio. Gli `Span` restano per le decorazioni
//   semantiche di M3.
// - La sintassi che il parser non conosce (wikilink, i tratti fra
//   delimitatori, tag, checkbox) si riconosce **per riga**, e non qui: la
//   riconosce `rules/sintassi.ts`, che è il posto unico in cui la shell
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
import {
  delimitatoriInline,
  parseWikilinkInner,
  scanTags,
  tratti,
  voceDiLista,
  wikilink,
} from "../rules/sintassi";

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
  const attive = new Set<number>();
  for (const r of state.selection.ranges) {
    const da = state.doc.lineAt(r.from).number;
    const a = state.doc.lineAt(r.to).number;
    for (let n = da; n <= a; n++) attive.add(n);
  }
  return attive;
}

// I delimitatori inline **dichiarati**, letti una volta sola al caricamento
// del modulo: `==` non è scritto in questo file, è il trigger di
// `HighlightRule`. Una sintassi inline registrata in Rust si decora da sé.
const INLINE_DICHIARATI = delimitatoriInline();

// Il nome dell'attributo con cui il payload viaggia nel DOM, scritto **una**
// volta: chi lo posa e chi lo rilegge stanno a trecento righe di distanza, e
// finché erano due letterali (`attributes:` di qua, `dataset.` di là) un refuso
// non compilava male — semplicemente non trovava niente, e il click non faceva
// nulla. `dataset` non serve più, e non è un dettaglio: la sua forma camelCase
// è una **terza** grafia dello stesso nome.
const ATTR_WIKILINK = "data-fub-target";
const ATTR_TAG = "data-fub-tag";

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
): LiveDeco[] {
  const out: LiveDeco[] = [];
  const doc = state.doc;
  const attiva = (pos: number) => activeLines.has(doc.lineAt(pos).number);

  // Terreno vietato al livello regex: codice inline e URL (un `==` da base64
  // o un `#frammento` non sono sintassi Obsidian). I blocchi di codice
  // escludono righe intere, quindi viaggiano come numeri di riga.
  const esclusioni: { from: number; to: number }[] = [];
  const righeDiCodice = new Set<number>();
  const libero = (a: number, b: number) =>
    esclusioni.every((r) => b <= r.from || a >= r.to);
  // Dedupe delle decorazioni di riga: blocchi annidati (citazione dentro
  // citazione) non devono impilare due volte la stessa classe.
  const righeCitazione = new Set<number>();

  // Decorazione di riga per ogni riga del nodo, clampata a [from, to]:
  // due range visibili che toccano lo stesso blocco non devono duplicare.
  const perRiga = (
    nodo: { from: number; to: number },
    viste: Set<number>,
    kind: LiveDecoKind,
  ) => {
    const prima = doc.lineAt(Math.max(nodo.from, from)).number;
    const ultima = doc.lineAt(Math.min(nodo.to, to)).number;
    for (let n = prima; n <= ultima; n++) {
      if (viste.has(n)) continue;
      viste.add(n);
      const riga = doc.line(n);
      out.push({ from: riga.from, to: riga.from, kind });
    }
  };

  // Il contenuto tra i marcatori di apertura e chiusura di un nodo inline
  // (enfasi, barrato, codice): i marcatori si nascondono da soli al passaggio
  // dell'iterazione, qui si marca solo il testo in mezzo.
  const marcaContenuto = (
    nodo: { node: { getChildren(name: string): { from: number; to: number }[] } },
    marcatore: string,
    kind: LiveDecoKind,
  ) => {
    const marks = nodo.node.getChildren(marcatore);
    if (marks.length < 2) return;
    const da = marks[0].to;
    const a = marks[marks.length - 1].from;
    if (da < a) out.push({ from: da, to: a, kind });
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter(nodo) {
      const heading = /^ATXHeading([1-6])$/.exec(nodo.name);
      if (heading) {
        const marks = nodo.node.getChildren("HeaderMark");
        if (!marks.length) return;
        // Lo spazio dopo i `#` (e quello prima dei `#` di chiusura) fa parte
        // del marcatore percepito: nasconderlo evita il testo che "salta".
        let testoDa = marks[0].to;
        if (doc.sliceString(testoDa, testoDa + 1) === " ") testoDa++;
        let testoA = nodo.to;
        const chiusura = marks.length > 1 ? marks[marks.length - 1] : null;
        if (chiusura) {
          testoA = chiusura.from;
          while (testoA > testoDa && doc.sliceString(testoA - 1, testoA) === " ") testoA--;
        }
        if (!attiva(nodo.from)) {
          out.push({ from: nodo.from, to: testoDa, kind: "hide" });
          if (chiusura && testoA < nodo.to) out.push({ from: testoA, to: nodo.to, kind: "hide" });
        }
        if (testoDa < testoA) {
          out.push({ from: testoDa, to: testoA, kind: ("h" + heading[1]) as LiveDecoKind });
        }
        return;
      }

      switch (nodo.name) {
        // I marcatori inline si nascondono ciascuno secondo la **propria**
        // riga: un'enfasi a cavallo di due righe mostra solo il marcatore
        // della riga attiva, e nessun replace attraversa il fine riga.
        case "EmphasisMark":
        case "StrikethroughMark":
          if (!attiva(nodo.from)) out.push({ from: nodo.from, to: nodo.to, kind: "hide" });
          return;
        case "StrongEmphasis":
          marcaContenuto(nodo, "EmphasisMark", "strong");
          return;
        case "Emphasis":
          marcaContenuto(nodo, "EmphasisMark", "em");
          return;
        case "Strikethrough":
          marcaContenuto(nodo, "StrikethroughMark", "strike");
          return;

        case "InlineCode": {
          // I CodeMark si gestiscono qui e non in un case globale: quelli
          // delle fence NON vanno nascosti.
          const marks = nodo.node.getChildren("CodeMark");
          for (const m of marks) {
            if (!attiva(m.from)) out.push({ from: m.from, to: m.to, kind: "hide" });
          }
          marcaContenuto(nodo, "CodeMark", "code");
          esclusioni.push({ from: nodo.from, to: nodo.to });
          return false;
        }

        case "FencedCode":
        case "CodeBlock": {
          // Sfondo di riga, fence visibili (niente hide), e righe intere
          // sottratte al livello regex: dentro il codice `[[x]]` è codice.
          perRiga(nodo, righeDiCodice, "codeblock-line");
          return false;
        }

        case "Blockquote":
          perRiga(nodo, righeCitazione, "quote-line");
          return; // i figli (QuoteMark, paragrafi con enfasi) proseguono
        case "QuoteMark":
          out.push({ from: nodo.from, to: nodo.to, kind: "quote-mark" });
          return;

        case "HorizontalRule":
          if (!attiva(nodo.from)) out.push({ from: nodo.from, to: nodo.to, kind: "hr" });
          return;

        case "URL":
          esclusioni.push({ from: nodo.from, to: nodo.to });
          return;

        case "Link": {
          // Fuori dalla riga attiva resta solo il testo: `[` e `](url…)`
          // spariscono. Un link spezzato su più righe non si tocca (i
          // replace non devono mai attraversare un fine riga).
          const marks = nodo.node.getChildren("LinkMark");
          // Senza URL è un reference link o un `[testo]` nudo — spesso il
          // cuore di un `[[wikilink]]`, che il parser non conosce: qui non si
          // tocca niente, altrimenti i suoi `[`/`]` nascosti si accavallano
          // ai replace del livello regex.
          if (marks.length < 2 || !nodo.node.getChildren("URL").length) return;
          const testoDa = marks[0].to;
          const testoA = marks[1].from;
          if (testoDa < testoA) out.push({ from: testoDa, to: testoA, kind: "link" });
          const unaRiga = doc.lineAt(nodo.from).number === doc.lineAt(nodo.to).number;
          if (unaRiga && !attiva(nodo.from)) {
            out.push({ from: nodo.from, to: testoDa, kind: "hide" });
            if (testoA < nodo.to) out.push({ from: testoA, to: nodo.to, kind: "hide" });
          }
          return;
        }
      }
    },
  });

  // Secondo strato: la sintassi Obsidian, riga per riga. Va DOPO il giro
  // sull'albero perché le esclusioni (codice, URL) devono già esserci tutte.
  const primaRiga = doc.lineAt(from).number;
  const ultimaRiga = doc.lineAt(to).number;
  for (let n = primaRiga; n <= ultimaRiga; n++) {
    if (righeDiCodice.has(n)) continue;
    const riga = doc.line(n);
    const testo = riga.text;
    const rigaAttiva = activeLines.has(n);

    // Wikilink ed embed. Il match diventa a sua volta un'esclusione: un
    // `#heading` o un `|` dentro `[[…]]` non sono un tag né altro.
    for (const w of wikilink(testo)) {
      const inizio = riga.from + w.from;
      const fine = riga.from + w.to;
      if (!libero(inizio, fine)) continue;
      esclusioni.push({ from: inizio, to: fine });
      const internoDa = riga.from + w.internoDa;
      const internoA = riga.from + w.internoA;
      // Il payload porta il riferimento **intero**: pagina, heading e blocco.
      // Portava la sola pagina, quindi `Mod-click` su `[[Nota#Sezione]]`
      // apriva la nota in cima mentre lo stesso link in Lettura arrivava alla
      // sezione — due risposte per lo stesso link (§4.4).
      const data = w.bersaglio;
      if (rigaAttiva) {
        // Sorgente visibile ma link comunque cliccabile e stilato.
        out.push({ from: internoDa, to: internoA, kind: "wikilink", data });
      } else {
        // Un solo hide copre `![[` (o `[[`) e, se c'è l'alias, anche `Pagina|`.
        const mostraDa =
          w.alias === null ? internoDa : internoDa + w.bersaglio.length + 1;
        out.push({ from: inizio, to: mostraDa, kind: "hide" });
        out.push({ from: mostraDa, to: internoA, kind: "wikilink", data });
        out.push({ from: internoA, to: fine, kind: "hide" });
      }
    }

    // I tratti fra delimitatori **dichiarati** (`==evidenziato==` e chi verrà):
    // il mark resta anche sulla riga attiva, spariscono solo i marcatori.
    for (const t of tratti(testo, INLINE_DICHIARATI)) {
      const inizio = riga.from + t.from;
      const fine = riga.from + t.to;
      if (!libero(inizio, fine)) continue;
      if (!rigaAttiva) {
        out.push({ from: inizio, to: riga.from + t.contenutoDa, kind: "hide" });
        out.push({ from: riga.from + t.contenutoA, to: fine, kind: "hide" });
      }
      out.push({
        from: riga.from + t.contenutoDa,
        to: riga.from + t.contenutoA,
        kind: "highlight",
      });
    }

    // Tag: mai nascosti, sempre marcati (e cliccabili) — anche sulla riga
    // attiva. La regola è quella del contratto (`scan_tags`), non una regex di
    // qua: era più stretta, e `vedi.#tag` restava senza decorazione mentre il
    // modello lo indicizzava.
    for (const t of scanTags(testo)) {
      const tagDa = riga.from + t.from;
      const tagA = riga.from + t.to;
      if (!libero(tagDa, tagA)) continue;
      out.push({ from: tagDa, to: tagA, kind: "tag", data: t.name });
    }

    // Checkbox a inizio voce: fuori dalla riga attiva il `[ ]`/`[x]` diventa
    // un widget; il barrato leggero sulla voce fatta resta sempre.
    const voce = voceDiLista(testo);
    if (voce && voce.symbol !== null) {
      const parA = riga.from + voce.boxTo; // subito dopo `]`
      const spuntata = taskChecked(voce.symbol);
      if (!rigaAttiva) {
        out.push({ from: parA - 3, to: parA, kind: "checkbox", data: spuntata ? "x" : " " });
      }
      if (spuntata && parA + 1 < riga.to) {
        out.push({ from: parA + 1, to: riga.to, kind: "done" });
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
class RighelloWidget extends WidgetType {
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
  constructor(readonly spuntata: boolean) {
    super();
  }
  eq(altro: CheckboxWidget) {
    return altro.spuntata === this.spuntata;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.spuntata;
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
const nascosto = Decoration.replace({});
const righello = Decoration.replace({ widget: new RighelloWidget() });
const boxVuota = Decoration.replace({ widget: new CheckboxWidget(false) });
const boxSpuntata = Decoration.replace({ widget: new CheckboxWidget(true) });
const lineaCodice = Decoration.line({ class: "cm-fub-codeblock" });
const lineaCitazione = Decoration.line({ class: "cm-fub-quote" });
const marchi: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
  (["h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "strike", "code", "link", "highlight", "done", "quote-mark"] as const).map(
    (kind) => [kind, Decoration.mark({ class: `cm-fub-${kind}` })],
  ),
);

function inDecorazione(d: LiveDeco): Decoration {
  switch (d.kind) {
    case "hide":
      return nascosto;
    case "hr":
      return righello;
    case "checkbox":
      return d.data === "x" ? boxSpuntata : boxVuota;
    case "codeblock-line":
      return lineaCodice;
    case "quote-line":
      return lineaCitazione;
    // Il payload viaggia nel DOM come data-attribute: il gestore del click
    // lo rilegge da lì, senza mappe posizione→dato da tenere sincronizzate.
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
      return marchi[d.kind]!;
  }
}

function gestisciClick(e: MouseEvent, view: EditorView, cb: LivePreviewCallbacks): boolean {
  if (e.button !== 0) return false;
  const bersaglio = e.target instanceof HTMLElement ? e.target : null;
  if (!bersaglio) return false;

  // Checkbox: si modifica il testo, non il widget — la decorazione nuova
  // arriva da sola col docChanged.
  if (bersaglio instanceof HTMLInputElement && bersaglio.classList.contains("cm-fub-checkbox")) {
    const pos = view.posAtDOM(bersaglio);
    const tre = view.state.doc.sliceString(pos, pos + 3);
    if (/^\[[ xX]\]$/.test(tre)) {
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: tre[1] === " " ? "x" : " " },
      });
      e.preventDefault();
      return true;
    }
    return false;
  }

  const wikilink = bersaglio.closest<HTMLElement>(".cm-fub-wikilink");
  if (wikilink && (e.ctrlKey || e.metaKey)) {
    // L'attributo porta il bersaglio come sta scritto nella sorgente: qui lo
    // si ripassa dalla stessa grammatica di prima, invece di ri-serializzarlo.
    const rif = parseWikilinkInner(wikilink.getAttribute(ATTR_WIKILINK) ?? "");
    cb.openWikilink(rif.page, rif.heading, rif.block);
    e.preventDefault();
    return true;
  }

  const tag = bersaglio.closest<HTMLElement>(".cm-fub-tag");
  if (tag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    cb.searchTag(tag.getAttribute(ATTR_TAG) ?? "");
    e.preventDefault();
    return true;
  }
  return false;
}

// Il tema del modulo: solo classi cm-fub-*, dentro l'estensione. I **valori**
// dei colori vengono però dalle variabili della superficie del documento
// (`--doc-*` in `style.css`): sono gli stessi che usa la modalità Lettura, e
// tenerne due copie significherebbe che passare da Live a Lettura cambia i
// colori della stessa nota. Le variabili hanno un fallback, così l'estensione
// resta montabile anche senza il CSS della shell.
const tema = EditorView.baseTheme({
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
  },
  "&light .cm-fub-link, &light .cm-fub-wikilink": { color: "var(--doc-link, #2f6bd8)" },
  "&dark .cm-fub-link, &dark .cm-fub-wikilink": { color: "var(--doc-link, #82aaff)" },
  ".cm-fub-highlight": { background: "var(--doc-highlight, rgba(255, 205, 0, 0.35))" },
  "&dark .cm-fub-highlight": { background: "var(--doc-highlight, rgba(255, 205, 0, 0.28))" },
  ".cm-fub-tag": {
    background: "var(--doc-fill, rgba(135, 135, 135, 0.18))",
    borderRadius: "1em",
    padding: "0 0.45em",
    fontSize: "0.95em",
    cursor: "pointer",
  },
  "&light .cm-fub-tag": { color: "var(--doc-link, #2f6bd8)" },
  "&dark .cm-fub-tag": { color: "var(--doc-link, #82aaff)" },
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
export function livePreview(callbacks: LivePreviewCallbacks): Extension {
  // Due insiemi dalla stessa passata: tutte le decorazioni per la resa, e i
  // soli replace come atomicRanges (il cursore scavalca i marcatori nascosti
  // invece di incagliarsi dentro).
  const costruisci = (view: EditorView): [DecorationSet, DecorationSet] => {
    const attive = activeLinesOf(view.state);
    const decorazioni: Range<Decoration>[] = [];
    const atomiche: Range<Decoration>[] = [];
    for (const r of view.visibleRanges) {
      for (const d of computeDecorations(view.state, attive, r.from, r.to)) {
        const deco = inDecorazione(d);
        if (d.kind === "quote-line" || d.kind === "codeblock-line") {
          decorazioni.push(deco.range(d.from));
          continue;
        }
        const range = deco.range(d.from, d.to);
        decorazioni.push(range);
        if (d.kind === "hide" || d.kind === "hr" || d.kind === "checkbox") {
          atomiche.push(range);
        }
      }
    }
    return [Decoration.set(decorazioni, true), Decoration.set(atomiche, true)];
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorazioni: DecorationSet;
      atomiche: DecorationSet;
      constructor(view: EditorView) {
        [this.decorazioni, this.atomiche] = costruisci(view);
      }
      update(u: ViewUpdate) {
        // selectionSet: la riga attiva è cambiata anche a documento fermo.
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          [this.decorazioni, this.atomiche] = costruisci(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorazioni,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.atomiche ?? Decoration.none),
      eventHandlers: {
        mousedown(e, view) {
          return gestisciClick(e, view, callbacks);
        },
      },
    },
  );

  return [tema, plugin];
}
