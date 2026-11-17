// Il diagramma mentre lo si scrive (C5): col cursore in un ```mermaid il
// sorgente si modifica sotto la testata del codice e, sotto, resta il disegno,
// rifatto dopo 300 ms di quiete. Ogni resa ha la sua generazione: una resa
// vecchia che finisce tardi non sostituisce quella nuova. Una resa sbagliata
// non toglie l'ultima buona: sotto compare l'avviso, e il disegno resta.
//
// Il disegno ha il menu del tasto destro (E26) come nella resa: qui lo stile
// «Questo» e l'orientamento si scrivono nel recinto che sta sopra. Col blocco
// del diagramma scelto (i Blocchi), Invio apre il sorgente, Spazio ingrandisce,
// Ctrl C copia come immagine, e il tasto Menu (o Maiusc F10) apre il menu.
import { EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, WidgetType } from "@codemirror/view";
import { createMermaidView, type MermaidView, type MermaidViewOptions } from "../../../../ui/mermaid";
import type { SourceEdit } from "../../../../theme/diagram-style";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { withLineBreaks } from "../../line-breaks";
import { blockSelection, runOfSelection, setBlockSelection } from "./blocks/selection";
import { modelOf } from "./blocks/transform";
import { liveStrings } from "./strings";

/// La quiete dopo l'ultima battuta prima di ridisegnare.
export const DIAGRAM_QUIET_MS = 300;

/// Il corpo di un recinto: senza la riga d'apertura e senza quella di chiusura.
export function fenceBody(source: string): string {
  const lines = source.split("\n");
  lines.shift();
  if (lines.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join("\n");
}

/// La prima riga dell'errore: il resto (il punto, i token attesi) è del sorgente
/// che si ha davanti.
const firstLine = (text: string) => text.split("\n", 1)[0]!.trim();

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
  /// Il corpo che il recinto ha adesso, anche prima che la quiete lo disegni.
  body: string;
  readonly notice: HTMLElement;

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
    root.append(this.notice);
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
    this.root.insertBefore(element, this.notice);
    const settle = () => {
      if (this.life.closed || request !== this.generation || this.trying !== view) return;
      const state = element.dataset.state;
      if (state === "ready") {
        observer.disconnect();
        this.shown?.destroy();
        this.shown?.element.remove();
        this.shown = view;
        this.trying = null;
        element.classList.remove("cm-fub-diagram-trying");
        this.notice.hidden = true;
        this.measure();
      } else if (state === "error") {
        observer.disconnect();
        if (this.shown) {
          // L'ultima resa buona resta; l'errore lo dice l'avviso.
          this.notice.textContent = liveStrings.t("live.diagram.error", { reason: firstLine(element.querySelector('[role="status"]')?.textContent ?? "") });
          this.notice.hidden = false;
          view.destroy();
          element.remove();
          this.trying = null;
        } else {
          this.shown = view;
          this.trying = null;
          element.classList.remove("cm-fub-diagram-trying");
        }
        this.measure();
      }
    };
    const observer = new MutationObserver(settle);
    observer.observe(element, { attributes: true, attributeFilter: ["data-state"] });
    this.life.add(() => observer.disconnect());
    settle();
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

/// Sotto il sorgente di un diagramma toccato, il suo disegno.
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
    const controller = new DiagramLive(root, this.body, () => view.requestMeasure(), createMermaidView, {
      editSource: view.state.readOnly ? undefined : (edit) => { editFenceBody(view, end(), body(), edit); },
      revealSource: () => {
        const start = fenceBodyStart(view.state, end(), body());
        if (start === null) return;
        view.dispatch({ selection: { anchor: start }, effects: [setBlockSelection.of(null), EditorView.scrollIntoView(start)], userEvent: "select" });
        view.focus();
      },
    });
    live.set(root, controller);
    return root;
  }
  /// Lo stesso posto, un corpo nuovo: il disegno resta e si rifà dopo la quiete.
  updateDOM(root: HTMLElement): boolean {
    const controller = live.get(root);
    if (!controller) return false;
    controller.schedule(this.body);
    controller.body = this.body;
    return true;
  }
  destroy(root: HTMLElement): void {
    live.get(root)?.dispose();
    live.delete(root);
  }
  ignoreEvent(): boolean { return true; }
}

/// Il diagramma che i Blocchi hanno scelto, da solo: il suo recinto, e il
/// disegno sotto, se c'è già.
function selectedDiagram(view: EditorView): { from: number; to: number; controller: DiagramLive | null } | null {
  const value = view.state.field(blockSelection, false);
  if (!value) return null;
  const blocks = modelOf(view.state);
  const run = runOfSelection(blocks, value);
  if (!run || run.first !== run.last) return null;
  const block = blocks[run.first]!;
  if (!MERMAID_OPENER.test(view.state.doc.lineAt(block.from).text)) return null;
  let controller: DiagramLive | null = null;
  for (const root of view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-diagram-live")) {
    let at = -1;
    try { at = view.posAtDOM(root); } catch { continue; }
    if (at >= block.from && at <= block.to + 1) {
      controller = live.get(root) ?? null;
      break;
    }
  }
  return { from: block.from, to: block.to, controller };
}

/// Il punto dove aprire il menu dalla tastiera: dentro l'angolo in alto a
/// sinistra del disegno, o all'inizio del recinto.
function menuPoint(view: EditorView, chosen: { from: number; controller: DiagramLive | null }): { x: number; y: number } {
  const box = chosen.controller?.view?.element.getBoundingClientRect();
  if (box && box.width > 0) return { x: box.left + 16, y: box.top + 16 };
  const at = view.coordsAtPos(chosen.from);
  return { x: at?.left ?? 0, y: at?.bottom ?? 0 };
}

/// I tasti del diagramma scelto come blocco. Stanno sopra quelli della
/// selezione dei blocchi: lì Invio torna al testo in fondo al blocco.
export const diagramBlockKeys: Extension = Prec.highest(keymap.of([
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
      chosen.controller?.view?.enlarge();
      return true;
    },
  },
  {
    key: "Mod-c",
    run: (view) => {
      const drawn = selectedDiagram(view)?.controller?.view;
      if (!drawn || drawn.element.dataset.state !== "ready") return false;
      void drawn.copy();
      return true;
    },
  },
  ...["Shift-F10", "ContextMenu"].map((key) => ({
    key,
    run: (view: EditorView) => {
      const chosen = selectedDiagram(view);
      const drawn = chosen?.controller?.view;
      if (!chosen || !drawn) return false;
      drawn.menu(menuPoint(view, chosen), false);
      return true;
    },
  })),
]));
