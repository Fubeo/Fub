// La scrittura «Live»: i widget (formule, immagini, link, caselle, promemoria), le decorazioni e il clic.
import { type EditorState, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { taskChecked } from "../../../../rules/mirrored";
import { dispatchTaskToggles } from "./task-toggle";
import { resolvedLanguage, t } from "../../../../i18n/strings";
import {
  alarmFigure,
  reminderLabel,
  reminderLong,
  reminderNotificationsOn,
  reminderPassed,
  reminderTimeOf,
} from "./task-reminder";
import { isAllowedLink } from "../../../../ui/sanitize";
import { readPageMark } from "../../../../ui/page-mark";
import { parseWikilinkInner } from "../../../../rules/syntax";
import { decodeDestination, normalizeLabel, routeHref } from "./link-syntax";
import { followPath, followWikilink, textLinkGesture } from "./link-gesture";
import { FOOTNOTE_DEFINITION } from "./grammar";
import { mountMarkdown } from "./mount";
import { mountMathBlocks } from "./math";
import { CalloutTypeWidget } from "./callout";
import { blockGesture } from "./block-gesture";
import { calloutHead } from "./callout-head";
import { type LiveFormula } from "./math-live";
import { CodeHeaderWidget } from "./code-block";
import { liveStrings } from "./strings";
import { markPresence } from "../../../core/presence";
import { cellValueRef, CellValueWidget } from "./cell-value";
import {
  ATTR_FOOTNOTE,
  ATTR_HREF,
  ATTR_TAG,
  ATTR_WIKILINK,
  type LiveDeco,
  type LiveDecoKind,
  type LivePreviewCallbacks,
  activeLinesOf,
} from "./livepreview-model";
import { interactiveTarget } from "./livepreview-mapped";

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
export function formulaIn(set: DecorationSet | undefined, pos: number, side: -1 | 0 | 1): LiveFormula | null {
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
export function columnIndex(node: SyntaxNode, doc: Text): number | null {
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

/// Il carattere che un'entità nomina, al posto della sua sorgente: il testo
/// del file non cambia, e col cursore accanto torna `&amp;`.
class EntityWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: EntityWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    return span;
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
    markPresence(handle, "request");
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

export const codeHeaderLine = Decoration.line({ class: "cm-fub-code-header-line" });

export const fenceCloseLine = Decoration.line({ class: "cm-fub-fence-close-line" });

export const HEADING_LINES: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
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

const commentRange = Decoration.mark({ class: "cm-fub-comment-range" });

const commentRangeOn = Decoration.mark({ class: "cm-fub-comment-range cm-fub-comment-range-on" });

const dueMark = Decoration.mark({ class: "cm-fub-due" });

const dueNearMark = Decoration.mark({ class: "cm-fub-due cm-fub-due-near" });

const dueOverdueMark = Decoration.mark({ class: "cm-fub-due cm-fub-due-overdue" });

/// La pastiglia del promemoria (T36): la sveglia e l'ora, col giorno se non
/// è oggi. Il clic apre la scelta del giorno e dell'ora (`reminder-picker.ts`,
/// dal gestore del `mousedown`); il passaggio dice quando suona, se è passato,
/// se il compito è fatto e se le notifiche sono spente, letto al momento.
class ReminderWidget extends WidgetType {
  constructor(readonly data: string) { super(); }
  eq(other: ReminderWidget) { return other.data === this.data; }
  toDOM() {
    const [look, ...rest] = this.data.split(" ");
    const written = rest.join(" ");
    const when = reminderTimeOf(written);
    const el = document.createElement("span");
    el.className = look === "done" ? "cm-fub-reminder cm-fub-reminder-done" : "cm-fub-reminder";
    el.dataset.reminder = written;
    const text = document.createElement("span");
    text.textContent = when ? reminderLabel(when, new Date(), resolvedLanguage()) : written;
    el.append(alarmFigure(), text);
    const describe = () => {
      el.title = reminderTitle(look === "done", when);
    };
    describe();
    el.addEventListener("pointerenter", describe);
    return el;
  }
  ignoreEvent() { return false; }
}

/// Ciò che il passaggio dice di un promemoria: quando suona (o che è
/// passato, o che il compito è fatto) e, con le notifiche spente, che resta
/// nella nota senza suonare.
export function reminderTitle(done: boolean, when: { date: string; time: string } | null, now = new Date()): string {
  if (!when) return liveStrings.t("reminder.unreadable");
  const long = reminderLong(when, resolvedLanguage());
  const head = done
    ? liveStrings.t("reminder.title.done", { when: long })
    : reminderPassed(when, now)
      ? liveStrings.t("reminder.title.passed", { when: long })
      : liveStrings.t("reminder.title", { when: long });
  return done || reminderNotificationsOn() ? head : `${head} ${liveStrings.t("reminder.title.off")}`;
}

const taskMark = Decoration.mark({ class: "cm-fub-bullet cm-fub-bullet-task" });

const marksMap: Partial<Record<LiveDecoKind, Decoration>> = Object.fromEntries(
  (["h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "strike", "sup", "sub", "code", "link", "highlight", "done", "quote-mark", "near", "nobreak", "footnote-label"] as const).map(
    (kind) => [kind, Decoration.mark({ class: `cm-fub-${kind}` })],
  ),
);

export function inDecoration(d: LiveDeco, callbacks: LivePreviewCallbacks): Decoration {
  switch (d.kind) {
    case "hide":
      return hidden;
    case "hr":
      return ruler;
    case "checkbox":
      return d.data === "x" ? checkedBox : boxEmpty;
    case "math":
      return Decoration.replace({ widget: new InlineMathWidget(d.data ?? "") });
    case "entity":
      return Decoration.replace({ widget: new EntityWidget(d.data ?? "") });
    case "image":
      return Decoration.replace({ widget: new InlineImageWidget(d.data ?? "", d.to - d.from, d.selected === true, callbacks) });
    case "cell-value": {
      const target = parseWikilinkInner(d.data ?? "");
      const ref = cellValueRef(target.page, target.heading);
      // Senza la porta `computeDecorations` non lo produce; un riferimento
      // che non si rilegge resta nascosto come il resto dell'embed.
      return ref && callbacks.cellValues ? Decoration.replace({ widget: new CellValueWidget(ref, callbacks.cellValues) }) : hidden;
    }
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
    case "comment-range":
      return d.data === "on" ? commentRangeOn : commentRange;
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
      // La nota che non c'è ancora (UX-016): a tratti. Al passaggio lo dice la
      // scheda del collegamento (`sheets/link-card.ts`), con «Crea la nota»: un
      // `title` sopra sarebbe un secondo avviso. Il link che si sta scrivendo
      // non lo chiede.
      const missing = target.page !== "" && d.writing !== true && callbacks.missing?.(target.page) === true;
      return Decoration.mark({
        class: person ? "cm-fub-wikilink cm-fub-person" : "cm-fub-wikilink",
        attributes: {
          ...(missing ? { "data-wikilink-missing": "" } : {}),
          [ATTR_WIKILINK]: d.data ?? "",
          "data-wikilink-page": target.page,
          ...(mark?.kind === "text" ? { "data-page-icon": mark.text } : {}),
          ...(mark?.kind === "figure" ? { "data-page-figure": mark.name } : {}),
          ...(target.heading ? { "data-wikilink-heading": target.heading } : {}),
          ...(target.block ? { "data-wikilink-block": target.block } : {}),
        },
      });
    }
    case "task-reminder":
      return Decoration.replace({ widget: new ReminderWidget(d.data ?? "") });
    case "task-reminder-source": {
      const [look, ...rest] = (d.data ?? "").split(" ");
      const when = reminderTimeOf(rest.join(" "));
      const variant = look === "bad" ? " cm-fub-reminder-bad" : look === "done" ? " cm-fub-reminder-done" : "";
      return Decoration.mark({ class: `cm-fub-reminder-text${variant}`, attributes: { title: reminderTitle(look === "done", when) } });
    }
    case "task-due":
      if (d.data === "near") return dueNearMark;
      if (d.data === "overdue") return dueOverdueMark;
      // Il titolo dice perché, nella lingua dell'interfaccia di adesso.
      if (d.data === "bad") {
        return Decoration.mark({ class: "cm-fub-due cm-fub-due-bad", attributes: { title: liveStrings.t("tasks.due.unreadable") } });
      }
      return dueMark;
    case "tag":
      return Decoration.mark({
        class: "cm-fub-tag",
        attributes: { [ATTR_TAG]: d.data ?? "" },
      });
    default:
      return marksMap[d.kind]!;
  }
}

export function handleClick(e: MouseEvent, view: EditorView, cb: LivePreviewCallbacks): boolean {
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
      // La spunta passa dalla ricorrenza (`task-toggle.ts`): un compito `🔁`
      // spuntato fa nascere il successivo nella stessa transazione.
      dispatchTaskToggles(view, [{ symbol: pos + 1, insert: checked ? "x" : " " }], (mapPos) => ({
        annotations: blockGesture.of({ kind: "check", lead: { from: mapPos(line.from), to: mapPos(line.to) }, say: liveStrings.t(checked ? "blocks.checked" : "blocks.unchecked") }),
        // Come ogni battuta di contenuto: senza, la modifica cade fuori dalla
        // history nativa dell'editor.
        userEvent: "input",
      }));
      e.preventDefault();
      return true;
    }
    return false;
  }

  if (e.type === "click") return false;

  // Il clic che apre un link nel testo (Ctrl, Cmd sul Mac) e Alt col clic:
  // la regola di `open-link.ts`, la stessa della Lettura e delle schede.
  const gesture = textLinkGesture(e);
  const wikilink = target.closest<HTMLElement>(".cm-fub-wikilink");
  if (wikilink && gesture) {
    // L'attributo porta il bersaglio come sta scritto nella sorgente: qui lo
    // si ripassa dalla stessa grammatica di prima, invece di ri-serializzarlo.
    const labelledBy = parseWikilinkInner(wikilink.getAttribute(ATTR_WIKILINK) ?? "");
    void followWikilink(cb, labelledBy.page, labelledBy.heading, labelledBy.block, gesture);
    e.preventDefault();
    return true;
  }

  const link = target.closest<HTMLElement>(".cm-fub-link");
  if (link && gesture) {
    const href = link.getAttribute(ATTR_HREF);
    // Naviga solo ciò che il sanitizzatore lascia passare (stessa policy di
    // Lettura): `javascript:…`, `data:…` e i protocol-relative restano fermi.
    if (!href || !isAllowedLink(href)) return false;
    const route = routeHref(href);
    if (route.kind === "path") {
      if (!cb.openPath || route.path === "") return false;
      void followPath(cb, route.path, gesture);
      e.preventDefault();
      return true;
    }
    if (gesture === "peek") return false;
    window.open(href, "_blank", "noopener,noreferrer");
    e.preventDefault();
    return true;
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
