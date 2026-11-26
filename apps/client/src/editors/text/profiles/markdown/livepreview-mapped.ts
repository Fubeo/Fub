// La scrittura «Live»: i blocchi disegnati da Markdown e la posizione nel sorgente sotto il puntatore.
import { type EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { taskChecked } from "../../../../rules/mirrored";
import { dispatchTaskToggles } from "./task-toggle";
import { linkModifier } from "./link-gesture";
import type { MarkdownBlock } from "./render-types";
import { mountMarkdown } from "./mount";
import { withLineBreaks } from "../../line-breaks";
import type { LivePreviewCallbacks } from "./livepreview-model";

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
export function realignMounted(view: EditorView, root: HTMLElement): void {
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

export function interactiveTarget(target: Element | null, event: MouseEvent): boolean {
  if (!target) return false;
  // L'editor di una trasclusione viva (`transclusion.ts`) ha cursore e
  // selezione suoi: la nota che ospita non sposta il suo. Il testo di un
  // blocco sincronizzato (T30) apre quell'editor al clic.
  if (target.closest("button, input, select, textarea, summary, [data-ui-slot], [data-transclusion-editing], [data-transclusion-direct] > .transclusion-body, .tag[data-tag]")) return true;
  // Mod-clic segue un link e apre un'immagine del vault a tutta finestra: il
  // gesto lo gestisce la resa (`mount.ts`), l'editor non sposta il cursore.
  // Alt col clic su un wikilink è la sbirciata (T20): niente cursore in più.
  if (event.altKey && !event.ctrlKey && !event.metaKey && target.closest("a[data-wikilink-page], a.internal-path")) return true;
  return !!target.closest("a, img[data-vault-id]") && linkModifier(event);
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

export class MarkdownWidget extends WidgetType {
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
        dispatchTaskToggles(view, [{ symbol: position, insert: taskChecked(marker[1]!) ? " " : "x" }], { userEvent: "input" });
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
        // `body` e la modifica vanno a capo con "\n": nella nota entrano con i suoi a capo.
        view.dispatch({ changes: { from: start + edit.from, to: start + edit.to, insert: withLineBreaks(view.state, edit.insert) }, userEvent: "input" });
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
