// Il diagramma mentre lo si scrive (C5, E26): col cursore in un ```mermaid il
// sorgente si scrive nelle righe della nota e il disegno gli sta accanto, metà
// e metà (uno sopra l'altro quando il foglio è stretto), rifatto dopo 300 ms
// di quiete. Ogni resa ha la sua generazione: una resa vecchia che finisce
// tardi non sostituisce quella nuova. Una resa sbagliata non toglie l'ultima
// buona: resta attenuata, e sotto il sorgente una riga dice dove sta l'errore.
// «Fatto» nella testata, o Esc, chiude il sorgente e sceglie il blocco.
//
// Le righe del sorgente restano di CodeMirror (Vim, annulla, ricerca): il
// disegno è un widget sotto il recinto che sale accanto alle righe, fuori dal
// flusso, e il widget tiene nel flusso soltanto ciò che il disegno supera.
// Così l'altezza che CodeMirror misura è quella vera.
//
// Il disegno ha il menu del tasto destro (E26) come nella resa: qui lo stile
// «Questo» e l'orientamento si scrivono nel recinto che sta sopra. Col blocco
// del diagramma scelto (i Blocchi) si vede il solo disegno: Invio apre il
// sorgente, Spazio ingrandisce, Ctrl C copia come immagine, e il tasto Menu
// (o Maiusc F10) apre il menu.
import { EditorSelection, Prec, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType } from "@codemirror/view";
import { animate } from "../../../../moto";
import { createMermaidView, mermaidViewOf, type DiagramProblem, type MermaidView, type MermaidViewOptions } from "../../../../ui/mermaid";
import type { SourceEdit } from "../../../../theme/diagram-style";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { withLineBreaks } from "../../line-breaks";
import { blockSelection, runOfSelection, selectBlocks, setBlockSelection, vimOn } from "./blocks/selection";
import { modelOf } from "./blocks/transform";
import { liveStrings } from "./strings";

/// La quiete dopo l'ultima battuta prima di ridisegnare.
export const DIAGRAM_QUIET_MS = 300;
/// Un disegno nuovo entra in 200 ms, e i blocchi sotto scivolano insieme.
export const DIAGRAM_ENTER_MS = 200;
const ENTER_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
/// Le righe sotto che scivolano al più, e quanto oltre la vista (px).
const SLIDE_MAX = 60;
const SLIDE_MARGIN = 200;

/// Il corpo di un recinto: senza la riga d'apertura e senza quella di chiusura.
export function fenceBody(source: string): string {
  const lines = source.split("\n");
  lines.shift();
  if (lines.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join("\n");
}

/// Ciò che la disposizione legge (fase di lettura di CodeMirror) prima di
/// scrivere: quanto sale il disegno per stare accanto al sorgente, se ci sta
/// accanto, le altezze del disegno, della riga dell'errore e del widget.
export interface DiagramLayout {
  /// Dalla cima della testata del recinto alla cima del widget (px).
  readonly lift: number;
  /// Il disegno sta accanto al sorgente (il foglio è largo): lo dice la pelle.
  readonly beside: boolean;
  readonly figure: number;
  readonly notice: number;
  readonly height: number;
}

/// Disegna i corpi che riceve, uno alla volta e tenendo l'ultimo buono. Il
/// disegno è un `MermaidView`: lo stato `ready`/`error` lo dice il suo
/// `data-state`.
export class DiagramLive {
  readonly life: Lifetime = openLifetime();
  private generation = 0;
  private shown: MermaidView | null = null;
  private trying: MermaidView | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private source: string;
  /// L'altezza del widget prima dell'ultimo cambio di disegno: i blocchi
  /// sotto scivolano da lì, alla prossima disposizione.
  private slideFrom: number | null = null;
  private rest = 0;
  /// Il corpo che il recinto ha adesso, anche prima che la quiete lo disegni.
  body: string;
  /// La riga sotto il sorgente che dice dove sta l'errore.
  readonly notice: HTMLElement;
  /// Lo spazio nel flusso per la parte del disegno più alta del sorgente.
  readonly spacer: HTMLElement;
  /// Il problema dell'ultima resa, se non è riuscita.
  problem: DiagramProblem | null = null;

  constructor(
    readonly root: HTMLElement,
    source: string,
    private readonly measure: () => void,
    private readonly make = createMermaidView,
    /// Chi scrive nel recinto e chi ne apre il sorgente: dati a ogni resa.
    private readonly gestures: Pick<MermaidViewOptions, "editSource" | "revealSource"> = {},
  ) {
    this.source = source;
    this.body = source;
    this.notice = document.createElement("p");
    this.notice.className = "cm-fub-diagram-notice";
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    this.spacer = document.createElement("div");
    this.spacer.className = "cm-fub-diagram-rest";
    this.spacer.setAttribute("aria-hidden", "true");
    root.append(this.notice, this.spacer);
    this.life.add(() => {
      clearTimeout(this.timer);
      this.trying?.destroy();
      this.shown?.destroy();
      this.trying = null;
      this.shown = null;
    });
    this.draw(source);
  }

  /// Un corpo nuovo: si disegna dopo la quiete, se nel frattempo non ne arriva un altro.
  schedule(source: string): void {
    if (this.life.closed || source === this.source) return;
    this.source = source;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.draw(this.source), DIAGRAM_QUIET_MS);
  }

  private draw(source: string): void {
    if (this.life.closed) return;
    const request = ++this.generation;
    this.trying?.destroy();
    this.trying?.element.remove();
    const view = this.make(source, { ...this.gestures, onResize: this.measure });
    this.trying = view;
    const element = view.element;
    element.classList.add("cm-fub-diagram-trying");
    this.root.insertBefore(element, this.spacer);
    const settle = () => {
      if (this.life.closed || request !== this.generation || this.trying !== view) return;
      const state = element.dataset.state;
      if (state === "ready") {
        observer.disconnect();
        const before = this.shown ? this.root.getBoundingClientRect().height : null;
        const previous = this.shown;
        previous?.destroy();
        previous?.element.remove();
        previous?.caption.remove();
        this.shown = view;
        this.trying = null;
        element.classList.remove("cm-fub-diagram-trying");
        this.root.append(view.caption);
        this.problem = null;
        this.notice.hidden = true;
        this.notice.replaceChildren();
        // Il disegno nuovo entra (200 ms); il primo è già lì.
        if (previous) {
          animate(element.querySelector(".mermaid-diagram-view") ?? element, {
            from: { opacity: 0.25 }, duration: DIAGRAM_ENTER_MS, easing: "ease-out", whenReduced: "none", lifetime: this.life,
          });
          this.slideFrom = before;
        }
        this.measure();
      } else if (state === "error") {
        observer.disconnect();
        this.problem = view.problem;
        if (this.shown && this.shown.element.dataset.state === "ready") {
          // L'ultima resa buona resta, attenuata; l'errore lo dice la riga.
          this.shown.element.classList.add("is-stale");
          view.destroy();
          element.remove();
          this.trying = null;
        } else {
          this.shown?.destroy();
          this.shown?.element.remove();
          this.shown?.caption.remove();
          this.shown = view;
          this.trying = null;
          element.classList.remove("cm-fub-diagram-trying");
          this.root.append(view.caption);
        }
        this.tell(this.problem, this.shown.element.dataset.state === "ready");
        this.measure();
      }
    };
    const observer = new MutationObserver(settle);
    observer.observe(element, { attributes: true, attributeFilter: ["data-state"] });
    this.life.add(() => observer.disconnect());
    settle();
  }

  /// La riga dell'errore: «Riga 12: …», in chiaro, e se il disegno di prima
  /// resta, lo dice.
  private tell(problem: DiagramProblem | null, kept: boolean): void {
    const parts: (Node | string)[] = [];
    const text = problem?.text ?? "";
    const sentence = /[.!?…]$/.test(text) ? text : `${text}.`;
    if (problem?.line != null) {
      const where = document.createElement("b");
      where.textContent = liveStrings.t("live.diagram.line", { line: String(problem.line) });
      parts.push(where, `: ${sentence}`);
    } else {
      parts.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
    }
    if (kept) parts.push(` ${liveStrings.t("live.diagram.kept")}`);
    this.notice.replaceChildren(...parts);
    this.notice.hidden = false;
  }

  /// La fase di lettura: le misure che la disposizione usa. `lift` lo dà chi
  /// sa dove sta il recinto (il widget).
  read(lift: number): DiagramLayout {
    // Accanto il foglio mostra lo spazio sotto il sorgente; uno sopra l'altro
    // lo toglie (`skin/diagrams.css`, `@container sheet`).
    const beside = getComputedStyle(this.spacer).display !== "none";
    const figure = this.shown?.element;
    return {
      lift,
      beside,
      figure: figure && figure.dataset.state === "ready" ? figure.getBoundingClientRect().height : 0,
      notice: this.notice.hidden ? 0 : this.notice.getBoundingClientRect().height,
      height: this.root.getBoundingClientRect().height,
    };
  }

  /// La fase di scrittura: il disegno sale di `lift` accanto al sorgente, e
  /// nel flusso resta ciò che supera il sorgente e la riga dell'errore. Se il
  /// disegno è appena cambiato d'altezza, i blocchi sotto scivolano. `true`
  /// se l'altezza del widget è cambiata.
  write(layout: DiagramLayout): boolean {
    this.root.style.setProperty("--diagram-lift", `${Math.round(layout.lift)}px`);
    const rest = layout.beside ? Math.max(0, Math.ceil(layout.figure - layout.lift - layout.notice)) : 0;
    const before = this.rest;
    if (rest !== before) {
      this.rest = rest;
      this.root.style.setProperty("--diagram-rest", `${rest}px`);
    }
    const from = this.slideFrom;
    this.slideFrom = null;
    // L'altezza dopo questa scrittura: quella letta, con lo spazio nuovo.
    if (from !== null) this.slide(layout.height - before + rest - from);
    return rest !== before;
  }

  /// Le righe sotto il widget scendono (o salgono) di `delta` px in 200 ms,
  /// invece di saltare. Soltanto quelle in vista, e non più di `SLIDE_MAX`.
  private slide(delta: number): void {
    if (Math.abs(delta) < 1 || !this.root.isConnected) return;
    const limit = (this.root.ownerDocument.defaultView?.innerHeight ?? 0) + SLIDE_MARGIN;
    let count = 0;
    for (let line = this.root.nextElementSibling; line && count < SLIDE_MAX; line = line.nextElementSibling, count++) {
      if (line.getBoundingClientRect().top > limit) break;
      animate(line, { from: { y: -delta }, duration: DIAGRAM_ENTER_MS, easing: ENTER_EASING, whenReduced: "none" });
    }
  }

  /// Il disegno che si vede, se c'è: quello che il menu e i tasti usano.
  get view(): MermaidView | null {
    return this.shown;
  }

  dispose(): void {
    this.life.close();
  }
}

/// La riga che apre un recinto Mermaid.
const MERMAID_OPENER = /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/i;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})\s*$/;

/// Dove comincia il corpo `body` del recinto che finisce in `end` (dove sta
/// il widget): `null` se il testo non è più quello che il disegno ha letto,
/// o se il recinto non si apre con ```mermaid. Un recinto dentro una citazione
/// o un elenco ha prefissi per riga, e lì non si scrive.
export function fenceBodyStart(state: EditorState, end: number, body: string): number | null {
  const doc = state.doc;
  if (end < 0 || end > doc.length) return null;
  const last = doc.lineAt(end);
  // Chiuso: il corpo finisce alla riga prima della chiusura; aperto fino in
  // fondo: alla fine della riga.
  const closed = FENCE_CLOSER.test(last.text) && last.number > 1 && !MERMAID_OPENER.test(last.text);
  const bodyEnd = closed ? last.from - 1 : last.to;
  const start = body === "" && closed ? last.from : bodyEnd - body.length;
  if (start < 1 || doc.sliceString(start, start + body.length) !== body) return null;
  const opener = doc.lineAt(start - 1);
  if (opener.to !== start - 1 || !MERMAID_OPENER.test(opener.text)) return null;
  return start;
}

/// Scrive nel corpo del recinto che finisce in `end` la modifica `edit`,
/// fatta su `body`. Niente, se il testo è cambiato o la nota è in sola lettura.
export function editFenceBody(view: EditorView, end: number, body: string, edit: SourceEdit): boolean {
  if (view.state.readOnly) return false;
  const start = fenceBodyStart(view.state, end, body);
  if (start === null || edit.from < 0 || edit.to < edit.from || edit.to > body.length) return false;
  view.dispatch({ changes: { from: start + edit.from, to: start + edit.to, insert: withLineBreaks(view.state, edit.insert) }, userEvent: "input" });
  return true;
}

const live = new WeakMap<HTMLElement, DiagramLive>();

/// Sotto il sorgente di un diagramma toccato, il suo disegno: accanto alle
/// righe del recinto quando il foglio è largo, sotto quando è stretto.
export class DiagramLiveWidget extends WidgetType {
  constructor(readonly body: string) { super(); }
  get estimatedHeight(): number { return 240; }
  eq(other: DiagramLiveWidget): boolean { return other.body === this.body; }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-fub-diagram-live markdown-rendered";
    root.contentEditable = "false";
    root.setAttribute("aria-label", liveStrings.t("live.diagram.preview"));
    root.setAttribute("role", "group");
    // Il corpo si rilegge al momento del gesto: un widget riusato ne ha uno nuovo.
    const body = () => live.get(root)?.body ?? this.body;
    const end = () => {
      try { return view.posAtDOM(root); } catch { return -1; }
    };
    // Quanto sale il disegno: dalla cima della testata del recinto alla cima
    // del widget, nelle misure di CodeMirror (anche se la testata è fuori vista).
    const lift = (): number => {
      const start = fenceBodyStart(view.state, end(), body());
      if (start === null || !root.isConnected) return 0;
      const opener = view.state.doc.lineAt(start - 1);
      const top = view.lineBlockAt(opener.from).top;
      return Math.max(0, root.getBoundingClientRect().top - view.documentTop - top);
    };
    const place = (): void => {
      view.requestMeasure({
        key: root,
        read: () => live.get(root)?.read(lift()) ?? null,
        write: (layout) => {
          // L'altezza cambiata va riletta da CodeMirror, che la conta.
          if (layout && live.get(root)?.write(layout)) view.requestMeasure();
        },
      });
    };
    const controller = new DiagramLive(root, this.body, place, createMermaidView, {
      editSource: view.state.readOnly ? undefined : (edit) => { editFenceBody(view, end(), body(), edit); },
      revealSource: () => {
        const start = fenceBodyStart(view.state, end(), body());
        if (start === null) return;
        view.dispatch({ selection: { anchor: start }, effects: [setBlockSelection.of(null), EditorView.scrollIntoView(start)], userEvent: "select" });
        view.focus();
      },
    });
    // Le righe del sorgente vanno a capo in un altro modo quando la colonna
    // cambia larghezza: il disegno sale di nuovo.
    let width = -1;
    const resize = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next === width) return;
      width = next;
      place();
    });
    resize.observe(root);
    controller.life.add(() => resize.disconnect());
    live.set(root, controller);
    place();
    return root;
  }
  /// Lo stesso posto, un corpo nuovo: il disegno resta e si rifà dopo la
  /// quiete; intanto risale accanto alle righe, che possono essere cambiate.
  updateDOM(root: HTMLElement, view: EditorView): boolean {
    const controller = live.get(root);
    if (!controller) return false;
    controller.schedule(this.body);
    controller.body = this.body;
    view.requestMeasure();
    return true;
  }
  destroy(root: HTMLElement): void {
    live.get(root)?.dispose();
    live.delete(root);
  }
  ignoreEvent(): boolean { return true; }
}

/// Le righe del sorgente di un diagramma aperto: la pelle le stringe a metà
/// colonna, accanto al disegno.
export const diagramSourceLine = Decoration.line({ class: "cm-fub-diagram-src" });

/// Le righe di un recinto da `from` a `to`, strette a metà accanto al disegno.
export function diagramSourceLines(state: EditorState, from: number, to: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (let n = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number; n <= last; n++) {
    out.push(diagramSourceLine.range(state.doc.line(n).from));
  }
  return out;
}

/// Una selezione di blocchi in corso: i diagrammi che tocca si vedono come
/// disegni, non come sorgente (si scelgono, non si scrivono).
export function choosingBlocks(state: EditorState): boolean {
  return state.field(blockSelection, false) != null;
}

/// Il recinto Mermaid che contiene `pos`, come blocco della nota.
function diagramBlockAt(state: EditorState, pos: number): { index: number; from: number; to: number } | null {
  const blocks = modelOf(state);
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]!;
    if (block.from > pos || block.to < pos) continue;
    if (MERMAID_OPENER.test(state.doc.lineAt(block.from).text)) return { index, from: block.from, to: block.to };
  }
  return null;
}

/// Chiude il sorgente del diagramma che contiene `pos` («Fatto», Esc): coi
/// Blocchi il diagramma resta scelto, e si vede il solo disegno; senza, il
/// cursore va alla riga dopo il recinto (o a quella prima). `false` se `pos`
/// non sta in un diagramma o non c'è dove andare.
export function leaveDiagramSource(view: EditorView, pos: number): boolean {
  const state = view.state;
  const fence = diagramBlockAt(state, pos);
  if (!fence) return false;
  // Il fuoco prima della scelta: prenderlo dopo rileggerebbe la selezione.
  if (!view.hasFocus) view.focus();
  if (state.field(blockSelection, false) !== undefined) {
    view.dispatch({ ...selectBlocks(view.state, modelOf(view.state), fence.index, fence.index), userEvent: "select" });
    return true;
  }
  const last = state.doc.lineAt(fence.to);
  const first = state.doc.lineAt(fence.from);
  const target = last.number < state.doc.lines ? state.doc.line(last.number + 1).from
    : first.number > 1 ? state.doc.line(first.number - 1).to
      : null;
  if (target === null) return false;
  view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true, userEvent: "select" });
  return true;
}

/// Il disegno che si vede in `[from, to]`: quello accanto al sorgente aperto,
/// o quello reso del blocco chiuso.
function drawnIn(view: EditorView, from: number, to: number): MermaidView | null {
  for (const root of view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-diagram-live, .mermaid-diagram")) {
    let at = -1;
    try { at = view.posAtDOM(root); } catch { continue; }
    if (at < from || at > to + 1) continue;
    const drawn = live.get(root)?.view ?? mermaidViewOf(root);
    if (drawn) return drawn;
  }
  return null;
}

/// Il diagramma che i Blocchi hanno scelto, da solo: il suo recinto, e il
/// disegno, se c'è già.
function selectedDiagram(view: EditorView): { from: number; to: number; drawn: MermaidView | null } | null {
  const value = view.state.field(blockSelection, false);
  if (!value) return null;
  const blocks = modelOf(view.state);
  const run = runOfSelection(blocks, value);
  if (!run || run.first !== run.last) return null;
  const block = blocks[run.first]!;
  if (!MERMAID_OPENER.test(view.state.doc.lineAt(block.from).text)) return null;
  return { from: block.from, to: block.to, drawn: drawnIn(view, block.from, block.to) };
}

/// Il punto dove aprire il menu dalla tastiera: dentro l'angolo in alto a
/// sinistra del disegno, o all'inizio del recinto.
function menuPoint(view: EditorView, chosen: { from: number; drawn: MermaidView | null }): { x: number; y: number } {
  const box = chosen.drawn?.element.getBoundingClientRect();
  if (box && box.width > 0) return { x: box.left + 16, y: box.top + 16 };
  const at = view.coordsAtPos(chosen.from);
  return { x: at?.left ?? 0, y: at?.bottom ?? 0 };
}

/// I tasti del diagramma scelto come blocco, ed Esc nel suo sorgente. Stanno
/// sopra quelli della selezione dei blocchi: lì Invio torna al testo in fondo
/// al blocco.
export const diagramBlockKeys: Extension = Prec.highest(keymap.of([
  {
    key: "Escape",
    // Esc nel sorgente lo chiude e sceglie il blocco. Con Vim Esc è di Vim, e
    // una selezione di blocchi già fatta la chiude la selezione stessa.
    run: (view) => {
      if (view.composing || vimOn(view) || view.state.field(blockSelection, false)) return false;
      const { main } = view.state.selection;
      if (view.state.selection.ranges.length > 1 || !diagramBlockAt(view.state, main.head)) return false;
      return leaveDiagramSource(view, main.head);
    },
  },
  {
    key: "Enter",
    run: (view) => {
      const chosen = selectedDiagram(view);
      if (!chosen) return false;
      // Il sorgente: il cursore all'inizio del corpo, dopo la riga che apre.
      const line = view.state.doc.lineAt(chosen.from);
      const anchor = Math.min(line.to + 1, view.state.doc.length);
      view.dispatch({ selection: EditorSelection.cursor(anchor), effects: [setBlockSelection.of(null), EditorView.scrollIntoView(anchor)], userEvent: "select" });
      return true;
    },
  },
  {
    key: "Space",
    // Sempre preso: lasciato al testo, lo spazio sostituirebbe il recinto.
    run: (view) => {
      const chosen = selectedDiagram(view);
      if (!chosen) return false;
      chosen.drawn?.enlarge();
      return true;
    },
  },
  {
    key: "Mod-c",
    run: (view) => {
      const drawn = selectedDiagram(view)?.drawn;
      if (!drawn || drawn.element.dataset.state !== "ready") return false;
      void drawn.copy();
      return true;
    },
  },
  ...["Shift-F10", "ContextMenu"].map((key) => ({
    key,
    run: (view: EditorView) => {
      const chosen = selectedDiagram(view);
      if (!chosen?.drawn) return false;
      chosen.drawn.menu(menuPoint(view, chosen), false);
      return true;
    },
  })),
]));
