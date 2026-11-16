// Il segno dei commenti nel margine destro (E16, prototipo `.bub`): le
// iniziali di chi ha cominciato e il numero dei messaggi, all'altezza del
// testo commentato. Il clic apre la discussione.
//
// In Scrittura il margine è un pezzo della vista sopra il contenuto, come i
// livelli di CodeMirror, ma coi pulsanti raggiungibili da tastiera. Si leggono
// soltanto i commenti dei tratti visibili, e una modifica li rilegge solo se
// lì c'è un `{>>`: una battuta in una nota senza commenti costa la ricerca di
// tre caratteri. Quando il margine non ha posto (la finestra stretta, il
// telefono) il segno sta nel testo, subito dopo il commento.
//
// In Lettura lo stesso segno sta nel margine della resa, all'altezza del passo
// (`mark.comment-range`).
import { StateEffect, StateField, type EditorState, type Extension, type Range, type Text, type Transaction } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxForm } from "../../../../../host/contract";
import type { Lifetime } from "../../../../../ui/lifetime";
import { liveStrings } from "../strings";
import { discussionAnchor, discussionsIn, type Discussion } from "./model";
import { readArchive } from "./resolve";
import { mayHaveComments } from "./syntax";
import { avatar } from "./thread";

/// Un segno: dove si guarda il commento, chi ha cominciato, quanti messaggi.
export interface MarginMark {
  readonly anchor: number;
  readonly end: number;
  readonly author: string | null;
  readonly count: number;
}

export function marginMarks(discussions: readonly Discussion[]): MarginMark[] {
  return discussions.map((each) => ({
    anchor: discussionAnchor(each.thread),
    end: each.thread.to,
    author: each.messages[0]?.author ?? null,
    count: each.messages.length,
  }));
}

/// Il nome accessibile di un segno.
export function markLabel(mark: Pick<MarginMark, "author" | "count">): string {
  const author = mark.author ?? liveStrings.t("comments.unnamed");
  return liveStrings.plural(mark.count, "comments.bubble.one", "comments.bubble", { author, count: mark.count });
}

/// Il segno, pulsante: nel margine (`cm-fub-comment-bubble`) o nel testo
/// (`cm-fub-comment-sign`).
export function markButton(mark: MarginMark, className: string, active: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.anchor = String(mark.anchor);
  button.setAttribute("aria-label", markLabel(mark));
  button.setAttribute("aria-haspopup", "dialog");
  button.title = markLabel(mark);
  if (active) button.dataset.active = "";
  button.append(avatar(mark.author), String(mark.count));
  return button;
}

/// Lo spazio che il segno chiede nel margine (px): sotto, il segno sta nel
/// testo.
export const MARGIN_ROOM_PX = 72;
/// La distanza minima fra due segni (px), come nel prototipo.
const MARK_STEP_PX = 32;
/// Il segno sale di poco per stare in asse con la riga (px).
const MARK_LIFT_PX = 2;
/// Dal bordo destro della pagina al segno (px).
const MARK_INSET_PX = 14;

/// Le tre altezze, col segno che non si sovrappone al precedente.
export function stack(tops: readonly number[]): number[] {
  let last = -Infinity;
  return tops.map((top) => {
    const placed = Math.max(top, last + MARK_STEP_PX);
    last = placed;
    return placed;
  });
}

export interface MarginHost {
  forms(): readonly SyntaxForm[] | undefined;
  /// Il commento aperto, per il segno acceso.
  active(): number | null;
  open(anchor: number): void;
}

/// Il segno nel testo, quando il margine non ha posto.
class SignWidget extends WidgetType {
  constructor(readonly mark: MarginMark, readonly active: boolean, readonly host: MarginHost) {
    super();
  }
  eq(other: SignWidget): boolean {
    return other.mark.anchor === this.mark.anchor && other.mark.author === this.mark.author
      && other.mark.count === this.mark.count && other.active === this.active;
  }
  toDOM(): HTMLElement {
    const button = markButton(this.mark, "cm-fub-comment-sign", this.active);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.host.open(this.mark.anchor);
    });
    return button;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const refresh = StateEffect.define<null>();

/// Il margine dei commenti in Scrittura. `refreshActive` lo rifà quando il
/// commento aperto cambia.
export function commentMargin(host: MarginHost): { extension: Extension; refreshActive: StateEffect<null> } {
  const plugin = ViewPlugin.fromClass(class {
    marks: MarginMark[] = [];
    decorations: DecorationSet = Decoration.none;
    narrow = false;
    readonly dom: HTMLElement;
    private readonly buttons = new Map<number, HTMLButtonElement>();
    private readonly measure = { key: this, read: () => this.read(), write: (m: Measured) => this.write(m) };
    private pendingNarrow: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-fub-comment-margin";
      this.dom.setAttribute("role", "group");
      this.dom.setAttribute("aria-label", liveStrings.t("comments.panel"));
      view.scrollDOM.append(this.dom);
      this.marks = this.collect();
      this.decorations = this.signs();
      view.requestMeasure(this.measure);
    }

    collect(): MarginMark[] {
      const { state } = this.view;
      const found: Discussion[] = [];
      const seen = new Set<number>();
      for (const visible of this.view.visibleRanges) {
        if (!mayHaveComments(state.doc.sliceString(visible.from, visible.to))) continue;
        for (const each of discussionsIn(state, visible.from, visible.to, host.forms())) {
          if (seen.has(each.thread.from)) continue;
          seen.add(each.thread.from);
          found.push(each);
        }
      }
      return marginMarks(found.sort((a, b) => a.thread.from - b.thread.from));
    }

    signs(): DecorationSet {
      if (!this.narrow || this.marks.length === 0) return Decoration.none;
      const active = host.active();
      const ranges: Range<Decoration>[] = this.marks.map((mark) =>
        Decoration.widget({ widget: new SignWidget(mark, mark.anchor === active, host), side: 1 }).range(mark.end));
      return Decoration.set(ranges, true);
    }

    update(update: ViewUpdate): void {
      const again = update.docChanged || update.viewportChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refresh)));
      if (again) {
        this.marks = this.collect();
        this.decorations = this.signs();
      }
      if (again || update.geometryChanged || update.heightChanged) this.view.requestMeasure(this.measure);
    }

    read(): Measured {
      const view = this.view;
      const style = getComputedStyle(view.contentDOM);
      const room = parseFloat(style.paddingRight || "0");
      const narrow = room < MARGIN_ROOM_PX;
      if (narrow || this.marks.length === 0) return { narrow, edge: 0, room, tops: [] };
      const base = view.scrollDOM.getBoundingClientRect();
      const top = base.top - view.scrollDOM.scrollTop;
      const left = base.left - view.scrollDOM.scrollLeft;
      const edge = view.contentDOM.getBoundingClientRect().right - left - room;
      const tops = this.marks.map((mark) => {
        const coords = view.coordsAtPos(mark.anchor, 1) ?? view.coordsAtPos(mark.anchor, -1);
        return coords ? coords.top - top - MARK_LIFT_PX : null;
      });
      return { narrow, edge, room, tops };
    }

    write(measured: Measured): void {
      if (measured.narrow !== this.narrow) {
        this.narrow = measured.narrow;
        this.view.dom.dataset.commentMargin = this.narrow ? "inline" : "side";
        // Le decorazioni non si cambiano mentre si misura: un giro dopo.
        if (this.pendingNarrow === null) {
          this.pendingNarrow = setTimeout(() => {
            this.pendingNarrow = null;
            this.view.dispatch({ effects: refresh.of(null) });
          }, 0);
        }
      }
      const active = host.active();
      const shown = new Set<number>();
      const placed: { mark: MarginMark; top: number }[] = [];
      const known = this.marks.map((mark, i) => ({ mark, top: measured.tops[i] ?? null }))
        .filter((each): each is { mark: MarginMark; top: number } => each.top !== null);
      const tops = stack(known.map((each) => each.top));
      known.forEach((each, i) => placed.push({ mark: each.mark, top: tops[i]! }));
      this.dom.style.left = `${Math.round(measured.edge)}px`;
      this.dom.style.width = `${Math.round(measured.room)}px`;
      for (const { mark, top } of measured.narrow ? [] : placed) {
        shown.add(mark.anchor);
        let button = this.buttons.get(mark.anchor);
        const label = markLabel(mark);
        if (!button || button.getAttribute("aria-label") !== label || button.querySelector(".cm-fub-comment-avatar")?.textContent !== avatar(mark.author).textContent) {
          const fresh = markButton(mark, "cm-fub-comment-bubble", mark.anchor === active);
          fresh.addEventListener("mousedown", (event) => event.preventDefault());
          fresh.addEventListener("click", () => host.open(Number(fresh.dataset.anchor)));
          if (button) button.replaceWith(fresh);
          else this.dom.append(fresh);
          button = fresh;
          this.buttons.set(mark.anchor, button);
        }
        button.style.top = `${Math.round(top)}px`;
        button.style.right = `${MARK_INSET_PX}px`;
        button.toggleAttribute("data-active", mark.anchor === active);
      }
      for (const [anchor, button] of this.buttons) {
        if (shown.has(anchor)) continue;
        button.remove();
        this.buttons.delete(anchor);
      }
    }

    destroy(): void {
      if (this.pendingNarrow !== null) clearTimeout(this.pendingNarrow);
      this.dom.remove();
      delete this.view.dom.dataset.commentMargin;
      this.buttons.clear();
    }
  }, { decorations: (value) => value.decorations });
  return { extension: plugin, refreshActive: refresh.of(null) };
}

interface Measured {
  readonly narrow: boolean;
  readonly edge: number;
  readonly room: number;
  readonly tops: readonly (number | null)[];
}

/// Il margine della Lettura: lo stesso segno accanto a ogni passo commentato
/// della resa `reading`. Ogni resa lo rifà; il disposer lo toglie.
export function mountReadingMargin(
  reading: HTMLElement,
  discussions: readonly Discussion[],
  open: (anchor: number) => void,
  life: Lifetime,
): void {
  for (const old of reading.querySelectorAll(":scope > .cm-fub-comment-margin")) old.remove();
  const marks = marginMarks(discussions).filter((mark) => mark.anchor !== mark.end);
  if (marks.length === 0) return;
  const margin = document.createElement("div");
  margin.className = "cm-fub-comment-margin cm-fub-comment-margin-reading";
  margin.setAttribute("role", "group");
  margin.setAttribute("aria-label", liveStrings.t("comments.panel"));
  reading.append(margin);
  life.add(() => margin.remove());
  const passageOf = (mark: MarginMark) => reading.querySelector<HTMLElement>(`mark.comment-range[data-md-from="${mark.anchor}"]`);
  const signs: HTMLElement[] = [];
  life.add(() => {
    for (const sign of signs) sign.remove();
  });
  const place = () => {
    const style = getComputedStyle(reading);
    const narrow = parseFloat(style.paddingRight || "0") < MARGIN_ROOM_PX;
    margin.hidden = narrow;
    reading.dataset.commentMargin = narrow ? "inline" : "side";
    // Stretta, il segno sta nel testo, subito dopo il passo.
    if (narrow && signs.length === 0) {
      for (const mark of marks) {
        const sign = markButton(mark, "cm-fub-comment-sign", false);
        passageOf(mark)?.after(sign);
        signs.push(sign);
      }
    } else if (!narrow && signs.length > 0) {
      for (const sign of signs.splice(0)) sign.remove();
    }
    if (narrow) return;
    const box = reading.getBoundingClientRect();
    const room = parseFloat(style.paddingRight || "0");
    margin.style.left = `${Math.round(reading.clientWidth - room)}px`;
    margin.style.width = `${Math.round(room)}px`;
    const items = marks.map((mark) => {
      const at = passageOf(mark);
      return { mark, top: at ? at.getBoundingClientRect().top - box.top + reading.scrollTop - MARK_LIFT_PX : null };
    }).filter((each): each is { mark: MarginMark; top: number } => each.top !== null);
    const tops = stack(items.map((each) => each.top));
    margin.replaceChildren(...items.map((each, i) => {
      const button = markButton(each.mark, "cm-fub-comment-bubble", false);
      button.style.top = `${Math.round(tops[i]!)}px`;
      button.style.right = `${MARK_INSET_PX}px`;
      return button;
    }));
  };
  life.listen(reading, "click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(".cm-fub-comment-bubble, .cm-fub-comment-sign");
    if (!button || !reading.contains(button)) return;
    event.preventDefault();
    open(Number(button.dataset.anchor));
  });
  // Le immagini e i caratteri arrivano dopo: si rimette a posto quando la resa
  // cambia misura.
  if (typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(() => place());
    watch.observe(reading);
    life.add(() => watch.disconnect());
  }
  place();
}

// ── L'archivio dei risolti, nascosto in Scrittura ─────────────────────────

/// I tratti dell'archivio: le discussioni attaccate sono un tratto solo.
export function archiveRuns(doc: Text): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  for (const each of readArchive(doc)) {
    const last = runs[runs.length - 1];
    if (last && doc.lineAt(last.to).number + 1 === doc.lineAt(each.from).number) last.to = each.to;
    else runs.push({ from: each.from, to: each.to });
  }
  return runs;
}

interface ArchiveView {
  readonly runs: readonly { from: number; to: number }[];
  readonly decorations: DecorationSet;
}

function archiveDecorations(state: EditorState, runs: readonly { from: number; to: number }[]): DecorationSet {
  const head = state.selection.main.head;
  const hidden = runs.filter((run) => head < run.from || head > run.to)
    .map((run) => Decoration.replace({ block: true }).range(run.from, run.to));
  return Decoration.set(hidden, true);
}

/// Una modifica tocca una riga con `%%`, prima o dopo? Solo allora l'archivio
/// si rilegge: le altre battute spostano i tratti e basta.
function touchesArchive(tr: Transaction): boolean {
  let touched = false;
  const before = tr.startState.doc;
  const after = tr.newDoc;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (touched) return;
    const a = before.sliceString(before.lineAt(fromA).from, before.lineAt(toA).to);
    const b = after.sliceString(after.lineAt(fromB).from, after.lineAt(toB).to);
    touched = a.includes("%%") || b.includes("%%");
  });
  return touched;
}

/// In Scrittura l'archivio in fondo alla nota non si vede: i suoi commenti
/// `%%` sparirebbero lasciando righe vuote, e qui spariscono le righe. Col
/// cursore dentro (lo si raggiunge con le frecce) torna com'è scritto. In
/// Sorgente questa estensione non c'è: l'archivio si legge.
export const hiddenArchive = StateField.define<ArchiveView>({
  create(state) {
    const runs = archiveRuns(state.doc);
    return { runs, decorations: archiveDecorations(state, runs) };
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    let runs = value.runs;
    if (tr.docChanged) {
      runs = touchesArchive(tr)
        ? archiveRuns(tr.newDoc)
        : runs.map((run) => ({ from: tr.changes.mapPos(run.from, 1), to: tr.changes.mapPos(run.to, -1) }));
    }
    if (runs.length === 0 && value.runs.length === 0) return value;
    return { runs, decorations: archiveDecorations(tr.state, runs) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/// In Lettura: il paragrafo dell'archivio (che la resa lascia vuoto) non
/// occupa posto.
export function hideReadingArchive(reading: HTMLElement, doc: Text): void {
  for (const run of archiveRuns(doc)) {
    const block = reading.querySelector<HTMLElement>(`p[data-md-from="${run.from}"]`);
    if (block && block.textContent?.trim() === "") block.hidden = true;
  }
}
