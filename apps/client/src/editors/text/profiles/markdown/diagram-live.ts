// Il diagramma mentre lo si scrive (C5): col cursore in un ```mermaid il
// sorgente si modifica sotto la testata del codice e, sotto, resta il disegno,
// rifatto dopo 300 ms di quiete. Ogni resa ha la sua generazione: una resa
// vecchia che finisce tardi non sostituisce quella nuova. Una resa sbagliata
// non toglie l'ultima buona: sotto compare l'avviso, e il disegno resta.
import { EditorView, WidgetType } from "@codemirror/view";
import { createMermaidView, type MermaidView } from "../../../../ui/mermaid";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
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
  readonly notice: HTMLElement;

  constructor(readonly root: HTMLElement, source: string, private readonly measure: () => void, private readonly make = createMermaidView) {
    this.source = source;
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
    const view = this.make(source, { onResize: this.measure });
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

  dispose(): void {
    this.life.close();
  }
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
    live.set(root, new DiagramLive(root, this.body, () => view.requestMeasure()));
    return root;
  }
  /// Lo stesso posto, un corpo nuovo: il disegno resta e si rifà dopo la quiete.
  updateDOM(root: HTMLElement): boolean {
    const controller = live.get(root);
    if (!controller) return false;
    controller.schedule(this.body);
    return true;
  }
  destroy(root: HTMLElement): void {
    live.get(root)?.dispose();
    live.delete(root);
  }
  ignoreEvent(): boolean { return true; }
}
