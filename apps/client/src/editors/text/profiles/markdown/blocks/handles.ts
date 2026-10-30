// La maniglia e il «+» (H3), il menu del blocco (H4) e il trascinamento (H5).
// Una colonna a sinistra del testo con due pulsanti per il blocco sotto il
// puntatore, per quello del cursore e per quello che ha il fuoco; sugli
// schermi senza passaggio restano sul blocco del cursore. Stanno nello
// scorrimento dell'editor, non nel contenuto: non sono nel file, non si
// copiano, e il cursore non ci entra.
import { EditorSelection, type EditorState, type Extension, Facet } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../../../ui/menu";
import { displayBinding } from "../../../../../ui/commands";
import { writeClipboardText } from "../../../../../platform/clipboard";
import { type Lifetime, openLifetime } from "../../../../../ui/lifetime";
import { openSlashAt, slashAvailable } from "../slash";
import { liveStrings } from "../strings";
import { blockGesture } from "../block-gesture";
import { detailsOf, setDetailsDefault } from "../details-live";
import type { DetailsPair } from "../details";
import { colorsAt, CONTENT_COLORS, lineText, setContentColor, type ColorKind, type ContentColor } from "../color";
import { blockAnchor, blockLink } from "./anchor";
import { columnsRun, dropAsColumn, intoColumns } from "./columns";
import { blockModel, kindName, type Block } from "./model";
import { type BlockRun, moveRun, moveSiblings, siblingsOf } from "./move";
import { blockSelection, cursorBlock, deleteRun, duplicateRun, runOfSelection, selectBlocks, setBlockSelection } from "./selection";
import { canTransform, targetOf, transformTo, type TransformTarget, unwrap } from "./transform";
import { dragPose, type DragPose, LIFT_SCALE, setDragPose } from "./motion";
import { animate, halt, liveState } from "../../../../../moto";

export interface BlocksOptions {
  /// Il nome della pagina, per il link al blocco: `[[Pagina#^id]]`.
  readonly page?: () => string | null;
  /// Dice all'utente com'è andata un'azione che non si vede nel testo.
  readonly notify?: (message: string, tone: "info" | "guasto") => void;
  /// La nota è la pagina di una cartella (`X/_index.md`): il titolo è il nome
  /// della cartella, e cambiarlo rinomina la cartella.
  readonly folderPage?: () => boolean;
  /// Rinomina la pagina col titolo scritto nella testata: `null` se è andata,
  /// altrimenti la frase che dice perché no. Senza, il titolo non si modifica.
  readonly rename?: (name: string) => Promise<string | null>;
  /// Monta un'immagine (l'HTML della resa) nella copertina, e ne dà lo
  /// smontaggio: la stessa resa delle immagini della Live.
  readonly mountImage?: (root: HTMLElement, html: string) => () => void;
  /// «Nuova sottopagina»: la pagina diventa quella della sua cartella, se non
  /// lo è già, e lì nasce `name`. `null` se è andata, altrimenti la frase che
  /// dice perché no. Senza, la testata non la offre.
  readonly subpage?: (name: string) => Promise<string | null>;
}

export const blocksOptions = Facet.define<BlocksOptions, BlocksOptions>({ combine: (values) => values[0] ?? {} });

/// Un blocco detto con ciò che sopravvive alle modifiche: dove comincia e a
/// che profondità sta.
interface BlockKey {
  readonly from: number;
  readonly depth: number;
}

function keyOf(block: Block): BlockKey {
  return { from: block.from, depth: block.depth };
}

function indexOf(blocks: readonly Block[], key: BlockKey | null): number {
  if (!key) return -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.from > key.from) break;
    if (block.from === key.from && block.depth === key.depth) return i;
  }
  return -1;
}

const TARGET_NAMES: Record<TransformTarget, () => string> = {
  paragraph: () => liveStrings.t("blocks.kind.paragraph"),
  heading1: () => liveStrings.t("blocks.kind.heading", { level: "1" }),
  heading2: () => liveStrings.t("blocks.kind.heading", { level: "2" }),
  heading3: () => liveStrings.t("blocks.kind.heading", { level: "3" }),
  heading4: () => liveStrings.t("blocks.kind.heading", { level: "4" }),
  heading5: () => liveStrings.t("blocks.kind.heading", { level: "5" }),
  heading6: () => liveStrings.t("blocks.kind.heading", { level: "6" }),
  bullet: () => liveStrings.t("blocks.kind.bullet"),
  ordered: () => liveStrings.t("blocks.kind.ordered"),
  task: () => liveStrings.t("blocks.kind.task"),
  quote: () => liveStrings.t("blocks.kind.quote"),
  callout: () => liveStrings.t("blocks.kind.callout"),
  code: () => liveStrings.t("blocks.kind.code"),
  details: () => liveStrings.t("blocks.kind.details"),
};

/// I bersagli di «Trasforma in», nell'ordine dei tasti di Notion.
export const TARGETS: readonly TransformTarget[] = [
  "paragraph", "heading1", "heading2", "heading3", "bullet", "ordered", "task", "quote", "callout", "code", "details",
];

/// Quanto del testo del blocco dice la maniglia.
const EXCERPT = 40;

/// Il testo con cui il blocco si fa riconoscere: la prima riga non vuota,
/// accorciata; vuoto per un blocco che non ne ha.
function gripExcerpt(state: EditorState, blocks: readonly Block[], index: number): string {
  const block = blocks[index]!;
  const parts = canTransform(block) ? unwrap(state, blocks, index) : null;
  const raw = (parts?.own.find((line) => line.trim() !== "") ?? (block.kind === "paragraph" ? state.doc.lineAt(block.from).text : "")).trim();
  return raw.length > EXCERPT ? `${raw.slice(0, EXCERPT - 1)}…` : raw;
}

/// I gruppi di voci in fila, con una riga fra l'uno e l'altro; un gruppo
/// rimasto vuoto non lascia righe doppie.
function groupGaps(groups: readonly (readonly MenuItem[])[]): MenuItem[] {
  return groups.filter((group) => group.length > 0).flatMap((group, at) =>
    group.map((item, index) => (at > 0 && index === 0 ? { ...item, separator: true } : item)));
}

/// «grigio» → «Grigio»: i colori dei sottomenu si leggono come voci.
const capitalized = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/// Il nome accessibile della maniglia: «Blocco: Titolo 2, Cose da fare».
export function gripLabel(state: EditorState, blocks: readonly Block[], index: number): string {
  const block = blocks[index]!;
  const text = gripExcerpt(state, blocks, index);
  const kind = kindName(block);
  return text === "" ? liveStrings.t("blocks.grip", { kind }) : liveStrings.t("blocks.grip.text", { kind, text });
}

/// La riga nuova che «+» aggiunge sotto il blocco: una voce sorella per una
/// voce, un paragrafo vuoto altrimenti. Ridà la modifica e dove va il cursore.
export function addBelow(state: EditorState, blocks: readonly Block[], index: number): { changes: { from: number; insert: string }; cursor: number } {
  const block = blocks[index]!;
  const end = blocks[index]!.to;
  const first = state.doc.lineAt(block.from).text;
  if (block.kind === "bullet" || block.kind === "task" || block.kind === "ordered") {
    const head = /^(\s*)([-*+]|(\d{1,9})([.)]))/.exec(first);
    if (head) {
      const marker = head[3] ? `${Number(head[3]) + 1}${head[4]}` : head[2]!;
      const insert = `\n${head[1]}${marker} ${block.kind === "task" ? "[ ] " : ""}`;
      return { changes: { from: end, insert }, cursor: end + insert.length };
    }
  }
  const indent = /^\s*/.exec(first)![0];
  const insert = `\n\n${block.depth > 0 ? indent : ""}`;
  return { changes: { from: end, insert }, cursor: end + insert.length };
}

/// La tratta su cui lavorano menu e trascinamento: la selezione di blocchi se
/// comprende il blocco, altrimenti il blocco da solo.
function runFor(state: EditorState, blocks: readonly Block[], index: number): BlockRun {
  const value = state.field(blockSelection, false);
  const run = value ? runOfSelection(blocks, value) : null;
  if (run && blocks[run.first]!.parent === blocks[index]!.parent && index >= run.first && index <= run.last) return run;
  return { first: index, last: index };
}

/// I blocchi che «Colore» sa colorare, e quanta parte: tutto il paragrafo, o
/// la prima riga degli altri (il titolo, la voce, la citazione).
const COLORABLE: Partial<Record<Block["kind"], "all" | "first">> = {
  paragraph: "all", heading: "first", bullet: "first", ordered: "first", task: "first", quote: "first",
};

/// I tratti di testo che «Colore» tocca nei blocchi della tratta di `index`,
/// dal fondo: cambiarne uno non sposta quelli prima.
export function colorRanges(state: EditorState, blocks: readonly Block[], index: number): { from: number; to: number }[] {
  const run = runFor(state, blocks, index);
  const ranges: { from: number; to: number }[] = [];
  for (const i of siblingsOf(blocks, run.first).filter((i) => i >= run.first && i <= run.last)) {
    const block = blocks[i]!;
    const span = COLORABLE[block.kind];
    const range = span && lineText(state, block.from, span === "all" ? block.to : block.from);
    if (range) ranges.push(range);
  }
  return ranges.reverse();
}

/// Il ripiegabile il cui blocco comincia alla riga di `from`.
function detailsAt(state: EditorState, from: number): DetailsPair | undefined {
  return detailsOf(state).pairs.find((pair) => state.doc.lineAt(pair.open.from).from === from);
}

/// Lo stato di un trascinamento: dove è partito e dove cadrebbe.
interface Drag {
  readonly pointer: number;
  readonly startY: number;
  readonly key: BlockKey;
  readonly life: Lifetime;
  moving: boolean;
  x: number;
  y: number;
  /// Il fratello davanti a cui cadrebbe, `-1` in fondo, `null` da nessuna parte.
  before: number | null;
  /// Il fratello sul cui bordo destro cadrebbe, come colonna accanto (K3).
  beside: number | null;
  /// L'immagine sollevata del blocco (N13), con lo scorrimento di quando è
  /// partita: segue il puntatore anche mentre la vista scorre. Col moto
  /// ridotto c'è lo stesso, ferma: è uno stato, e soltanto i passaggi saltano.
  lift: { readonly el: HTMLElement; readonly scroll: number } | null;
}

/// Dove sarebbero le coordinate `seen` della riga di `pos` a corsa finita: il
/// moto dei Blocchi (N13) può star portando la riga altrove, e le maniglie
/// vanno dove la riga arriva, non dove passa. Le righe si scalano dal loro
/// angolo (`motion.ts`).
function atRest(view: EditorView, pos: number, seen: { left: number; right: number; top: number; bottom: number }) {
  const node = view.domAtPos(pos).node;
  const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
  const live = line ? liveState(line) : null;
  if (!line || !live) return seen;
  const rect = line.getBoundingClientRect();
  const { x = 0, y = 0, scaleX = 1, scaleY = 1 } = live.pose;
  const left = rect.left - x;
  const top = rect.top - y;
  return {
    left: left + (seen.left - rect.left) / scaleX,
    right: left + (seen.right - rect.left) / scaleX,
    top: top + (seen.top - rect.top) / scaleY,
    bottom: top + (seen.bottom - rect.top) / scaleY,
  };
}

/// La parte destra del testo, in frazione della sua larghezza, dove un blocco
/// lasciato va accanto a quello sotto il puntatore invece che fra le righe.
const BESIDE = 0.8;

/// Il margine dove la vista scorre da sola durante un trascinamento.
const EDGE = 40;
/// Di quanto il puntatore deve muoversi perché un clic diventi un trascinamento.
const SLOP = 4;

class HandlesView {
  readonly life = openLifetime();
  readonly root = document.createElement("div");
  readonly add = document.createElement("button");
  readonly grip = document.createElement("button");
  readonly drop = document.createElement("div");
  hovered: BlockKey | null = null;
  /// Il blocco della maniglia che ha il fuoco, o del menu aperto.
  pinned: BlockKey | null = null;
  shown: BlockKey | null = null;
  /// Il menu della maniglia è aperto.
  menu = false;
  drag: Drag | null = null;
  /// Il clic che segue un trascinamento non apre il menu.
  swallowClick = false;
  readonly hoverable: boolean;

  constructor(readonly view: EditorView) {
    this.hoverable = typeof matchMedia !== "function" || matchMedia("(hover: hover)").matches;
    this.root.className = "cm-fub-block-handles";
    this.root.hidden = true;
    this.add.type = "button";
    this.add.className = "cm-fub-block-add";
    // Il «+» è disegnato, come i puntini della maniglia: non dipende dal
    // carattere del documento, che lo farebbe piccolo o sottile.
    const plus = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    plus.setAttribute("class", "cm-fub-block-add-plus");
    plus.setAttribute("viewBox", "0 0 12 12");
    plus.setAttribute("aria-hidden", "true");
    const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
    cross.setAttribute("d", "M6 1.5v9M1.5 6h9");
    plus.append(cross);
    this.add.append(plus);
    this.add.setAttribute("aria-label", liveStrings.t("blocks.add"));
    this.grip.type = "button";
    this.grip.className = "cm-fub-block-grip";
    this.grip.setAttribute("aria-haspopup", "menu");
    this.grip.setAttribute("aria-expanded", "false");
    const dots = document.createElement("span");
    dots.className = "cm-fub-block-grip-dots";
    dots.setAttribute("aria-hidden", "true");
    this.grip.append(dots);
    this.root.append(this.add, this.grip);
    this.drop.className = "cm-fub-block-drop";
    this.drop.hidden = true;
    view.scrollDOM.append(this.root, this.drop);
    this.life.add(() => {
      this.root.remove();
      this.drop.remove();
    });

    const life = this.life;
    life.listen(view.scrollDOM, "mousemove", (event) => this.pointAt(event.clientX, event.clientY, event.target));
    life.listen(view.scrollDOM, "mouseleave", () => {
      this.hovered = null;
      this.schedule();
    });
    // Un clic sui pulsanti non toglie il fuoco al testo: Tab, Invio e Spazio
    // invece li raggiungono e li premono.
    life.listen(this.root, "mousedown", (event) => event.preventDefault());
    life.listen(this.root, "focusin", () => {
      this.pinned = this.shown;
    });
    life.listen(this.root, "focusout", (event) => {
      if (this.menu || this.root.contains(event.relatedTarget as Node | null)) return;
      this.pinned = null;
      this.schedule();
    });
    life.listen(this.add, "click", () => this.addBlock());
    // Col mouse il menu si apre senza l'anello su una voce; da Invio o Spazio
    // (un clic senza `detail`) la prima voce ha già il fuoco.
    life.listen(this.grip, "click", (event) => {
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      this.openMenu(event.detail > 0);
    });
    // Il tasto destro sulla maniglia è il menu del blocco, non quello del testo.
    life.listen(this.root, "contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.target instanceof Node && this.grip.contains(event.target)) {
        const pointer = event.button === 2 && (event.clientX !== 0 || event.clientY !== 0);
        this.openMenu(pointer, pointer ? event : null);
      }
    });
    life.listen(this.grip, "pointerdown", (event) => this.startDrag(event));
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const map = (key: BlockKey | null) => (key ? { from: update.changes.mapPos(key.from, 1), depth: key.depth } : null);
      this.hovered = map(this.hovered);
      this.pinned = map(this.pinned);
    }
    if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.viewportChanged ||
      update.state.field(blockModel) !== update.startState.field(blockModel)) {
      this.schedule();
    }
  }

  /// Il blocco sotto il punto `(x, y)` della finestra.
  pointAt(x: number, y: number, target: EventTarget | null): void {
    if (this.drag || (target instanceof Node && this.root.contains(target))) return;
    const pos = this.view.posAtCoords({ x, y }, false);
    const blocks = this.view.state.field(blockModel).blocks;
    let found = -1;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (block.from > pos) break;
      if (pos <= block.to) found = i;
    }
    const key = found >= 0 ? keyOf(blocks[found]!) : null;
    if (key && this.hovered && key.from === this.hovered.from && key.depth === this.hovered.depth) return;
    if (key) this.hovered = key;
    this.schedule();
  }

  /// Il blocco che le maniglie servono adesso.
  current(): number {
    const state = this.view.state;
    if (state.readOnly) return -1;
    const blocks = state.field(blockModel).blocks;
    for (const key of [this.pinned, this.hoverable ? this.hovered : null]) {
      const index = indexOf(blocks, key);
      if (index >= 0) return index;
    }
    if (!this.view.hasFocus) return -1;
    const value = state.field(blockSelection, false);
    if (value) {
      const run = runOfSelection(blocks, value);
      if (run) return run.head;
    }
    return cursorBlock(state, blocks);
  }

  schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const index = this.current();
        if (index < 0) return null;
        const blocks = view.state.field(blockModel).blocks;
        const block = blocks[index]!;
        const line = view.state.doc.lineAt(block.from);
        const start = line.from + /^\s*/.exec(line.text)![0].length;
        const seen = view.coordsAtPos(Math.min(start, line.to), 1) ?? view.coordsAtPos(line.from, 1);
        if (!seen) return null;
        const coords = atRest(view, block.from, seen);
        const scroller = view.scrollDOM.getBoundingClientRect();
        const lineBlock = view.lineBlockAt(block.from);
        // Centrate sulla prima riga di testo, non sul blocco di riga: un
        // titolo ha aria sopra, e le maniglie starebbero in alto.
        const glyph = coords.bottom - coords.top;
        return {
          index,
          key: keyOf(block),
          label: gripLabel(view.state, blocks, index),
          left: coords.left - scroller.left + view.scrollDOM.scrollLeft,
          top: glyph > 0
            ? coords.top - scroller.top + view.scrollDOM.scrollTop
            : lineBlock.top + view.documentTop - scroller.top + view.scrollDOM.scrollTop,
          height: glyph > 0 ? glyph : lineBlock.height,
        };
      },
      write: (place) => {
        if (!place) {
          this.shown = null;
          if (!this.root.contains(document.activeElement)) this.root.hidden = true;
          return;
        }
        this.shown = place.key;
        this.root.hidden = false;
        this.root.dataset.active = String(this.hoverable && this.hovered !== null && place.key.from === this.hovered.from);
        this.grip.setAttribute("aria-label", place.label);
        this.root.style.top = `${place.top}px`;
        this.root.style.left = `${place.left}px`;
        this.root.style.height = `${place.height}px`;
      },
    });
  }

  /// «+»: una riga nuova sotto il blocco, col cursore dentro, e il «/» aperto
  /// lì quando l'editor lo ha.
  addBlock(): void {
    const view = this.view;
    const blocks = view.state.field(blockModel).blocks;
    const index = indexOf(blocks, this.shown);
    if (index < 0 || view.state.readOnly) return;
    const { changes, cursor } = addBelow(view.state, blocks, index);
    const slash = slashAvailable(view.state);
    const insert = slash ? `${changes.insert}/` : changes.insert;
    view.dispatch({ changes: { from: changes.from, insert }, selection: EditorSelection.cursor(slash ? cursor + 1 : cursor), userEvent: "input", scrollIntoView: true });
    if (slash) openSlashAt(view, cursor);
    this.pinned = null;
    view.focus();
  }

  /// Il menu del blocco, sotto la maniglia: lo stesso menu del tasto destro
  /// del resto di Fub, coi suoi gruppi, le scorciatoie e ciò che elimina in
  /// fondo. Mentre è aperto i blocchi su cui lavora restano selezionati, così
  /// si vede che cosa toccherà, e i tasti della selezione (Mod-d, Canc) sono
  /// quelli che le voci dicono.
  openMenu(pointer = false, at: MouseEvent | null = null): void {
    if (this.menu) closeContextMenu();
    const view = this.view;
    const blocks = view.state.field(blockModel).blocks;
    const index = indexOf(blocks, this.shown);
    if (index < 0) return;
    const run = runFor(view.state, blocks, index);
    const value = view.state.field(blockSelection, false);
    if (!value || runOfSelection(blocks, value)?.first !== run.first) view.dispatch(selectBlocks(view.state, blocks, run.first, run.last));
    this.pinned = keyOf(blocks[index]!);
    const key = this.pinned;
    const act = (run: () => void) => () => {
      run();
      view.focus();
    };
    const excerpt = gripExcerpt(view.state, blocks, index);
    this.menu = true;
    this.grip.setAttribute("aria-expanded", "true");
    showContextMenu(at ?? this.grip, this.mainItems(key, act), {
      pointer,
      header: { icon: "outline", kind: liveStrings.t("blocks.menu.head"), ...(excerpt ? { name: excerpt } : {}) },
      onClose: () => {
        this.menu = false;
        this.grip.setAttribute("aria-expanded", "false");
        this.pinned = null;
        this.schedule();
      },
    });
  }

  /// Ritrova il blocco e la sua tratta al momento dell'azione: il testo può
  /// essere cambiato mentre il menu era aperto.
  withRun(key: BlockKey, run: (state: EditorState, blocks: readonly Block[], found: BlockRun, index: number) => void): void {
    const state = this.view.state;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, key);
    if (index < 0 || state.readOnly) return;
    run(state, blocks, runFor(state, blocks, index), index);
    this.pinned = null;
  }

  mainItems(key: BlockKey, act: (run: () => void) => () => void): MenuItem[] {
    const view = this.view;
    const blocks = view.state.field(blockModel).blocks;
    const index = indexOf(blocks, key);
    const run = runFor(view.state, blocks, index);
    const sibs = siblingsOf(blocks, run.first);
    const transformable = sibs.filter((i) => i >= run.first && i <= run.last).some((i) => canTransform(blocks[i]!));
    const moveSpec = (dir: -1 | 1) => () =>
      this.withRun(key, (state, all, found) => {
        const spec = moveRun(state, all, found, dir);
        if (!spec) return;
        const { follow, origin, moved, ...move } = spec;
        const value = state.field(blockSelection, false);
        const effects = value
          ? [setBlockSelection.of({ anchor: follow(value.anchor) ?? value.anchor, head: follow(value.head) ?? value.head, depth: value.depth })]
          : [];
        view.dispatch({ ...move, effects });
      });
    const colors = this.colorItems(key, act);
    // Ciò che adesso non si può fare non si vede: una voce grigia senza un
    // perché è soltanto rumore.
    const groups: (MenuItem | false)[][] = [[
      transformable && { label: liveStrings.t("blocks.menu.transform"), items: this.transformItems(key, act) },
      colors.length > 0 && { label: liveStrings.t("blocks.menu.color"), items: colors },
      // Un ripiegabile: se la nota lo apre già aperto (K2). La freccia
      // invece apre e chiude soltanto nella vista.
      blocks[index]?.kind === "details" && {
        label: liveStrings.t("blocks.menu.details-open"),
        choice: "checkbox",
        checked: detailsAt(view.state, blocks[index]!.from)?.head.open === true,
        run: act(() => this.withRun(key, (state, all, _found, at) => {
          const pair = detailsAt(state, all[at]!.from);
          const spec = pair && setDetailsDefault(state, pair.open.from, !pair.head.open);
          if (spec) view.dispatch(spec);
        })),
      },
    ], [
      {
        label: liveStrings.t("blocks.menu.duplicate"),
        hint: displayBinding("Mod-d"),
        run: act(() => this.withRun(key, (state, all, found) => view.dispatch(duplicateRun(state, all, found)))),
      },
      run.first === run.last && { label: liveStrings.t("blocks.menu.link"), run: act(() => this.copyLink(key)) },
    ], [
      sibs.indexOf(run.first) > 0 && {
        label: liveStrings.t("blocks.menu.up"), hint: displayBinding("Mod-Shift-ArrowUp"), run: act(moveSpec(-1)),
      },
      sibs.indexOf(run.last) < sibs.length - 1 && {
        label: liveStrings.t("blocks.menu.down"), hint: displayBinding("Mod-Shift-ArrowDown"), run: act(moveSpec(1)),
      },
      // Il blocco col fratello che lo segue, o la tratta, uno per colonna (K3).
      columnsRun(view.state, blocks, run) !== null && {
        label: liveStrings.t("blocks.menu.columns"),
        run: act(() => this.withRun(key, (state, all, found) => {
          const picked = columnsRun(state, all, found);
          if (picked) view.dispatch({ ...intoColumns(state, all, picked), annotations: blockGesture.of({ kind: "columns" }) });
        })),
      },
    ], [
      {
        label: liveStrings.t("blocks.menu.delete"),
        hint: displayBinding("Delete"),
        danger: true,
        run: act(() => this.withRun(key, (state, all, found) => view.dispatch(deleteRun(state, all, found)))),
      },
    ]];
    return groupGaps(groups.map((group) => group.filter((item): item is MenuItem => item !== false)));
  }

  transformItems(key: BlockKey, act: (run: () => void) => () => void): MenuItem[] {
    const view = this.view;
    const blocks = view.state.field(blockModel).blocks;
    const index = indexOf(blocks, key);
    const current = index >= 0 ? targetOf(blocks[index]!) : null;
    return TARGETS.map((target): MenuItem => ({
      label: TARGET_NAMES[target](),
      choice: "radio",
      checked: target === current,
      separator: target === "bullet" || target === "quote",
      run: act(() => this.withRun(key, (state, all, found) => {
        const sibs = siblingsOf(all, found.first).filter((i) => i >= found.first && i <= found.last);
        transformTo(target, sibs)({ state, dispatch: (tr) => view.dispatch(tr) });
      })),
    }));
  }

  colorRanges(key: BlockKey): { from: number; to: number }[] {
    const blocks = this.view.state.field(blockModel).blocks;
    const index = indexOf(blocks, key);
    return index < 0 ? [] : colorRanges(this.view.state, blocks, index);
  }

  /// «Colore ▸»: «Testo ▸» e «Fondo ▸», coi nove colori e il predefinito.
  /// È spuntato il colore che hanno tutti; senza niente da colorare, niente.
  colorItems(key: BlockKey, act: (run: () => void) => () => void): MenuItem[] {
    const view = this.view;
    const ranges = this.colorRanges(key);
    if (ranges.length === 0) return [];
    const shared = (kind: ColorKind): ContentColor | null | undefined => {
      const found = new Set(ranges.map((range) => colorsAt(view.state.update({ selection: EditorSelection.range(range.from, range.to) }).state)[kind]));
      return found.size === 1 ? [...found][0] : undefined;
    };
    return (["text", "fill"] as const).map((kind): MenuItem => {
      const current = shared(kind);
      return {
        label: liveStrings.t(kind === "text" ? "blocks.menu.color.text" : "blocks.menu.color.fill"),
        items: [null, ...CONTENT_COLORS].map((color): MenuItem => ({
          label: color
            ? capitalized(liveStrings.t(`blocks.color.${color}` as const))
            : liveStrings.t(kind === "text" ? "blocks.menu.color.default" : "blocks.menu.color.none"),
          choice: "radio",
          checked: current === color,
          ...(color ? { swatches: [kind === "text" ? `var(--doc-color-${color})` : `var(--doc-tint-${color})`] } : {}),
          run: act(() => {
            for (const range of this.colorRanges(key)) {
              setContentColor(kind, color, range)({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
            }
          }),
        })),
      };
    });
  }

  /// Scrive l'id se manca e copia il link; lo dice, perché negli appunti non
  /// si vede.
  copyLink(key: BlockKey): void {
    const view = this.view;
    const options = view.state.facet(blocksOptions);
    this.withRun(key, (state, blocks, _run, index) => {
      const anchor = blockAnchor(state, blocks, index);
      if (anchor.changes) view.dispatch({ changes: anchor.changes, userEvent: "input" });
      const link = blockLink(options.page?.() ?? null, anchor.fragment);
      writeClipboardText(link).then(
        () => options.notify?.(liveStrings.t("blocks.link.copied", { link }), "info"),
        (error: unknown) => options.notify?.(liveStrings.t("blocks.link.failed", { reason: error instanceof Error ? error.message : String(error) }), "guasto"),
      );
    });
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.drag || this.view.state.readOnly) return;
    this.swallowClick = false;
    const blocks = this.view.state.field(blockModel).blocks;
    const index = indexOf(blocks, this.shown);
    if (index < 0) return;
    const life = openLifetime();
    const drag: Drag = { pointer: event.pointerId, startY: event.clientY, key: keyOf(blocks[index]!), life, moving: false, x: event.clientX, y: event.clientY, before: null, beside: null, lift: null };
    this.drag = drag;
    try { this.grip.setPointerCapture(event.pointerId); } catch { /* un puntatore finto */ }
    life.listen(this.grip, "pointermove", (move) => {
      if (move.pointerId !== drag.pointer) return;
      drag.x = move.clientX;
      drag.y = move.clientY;
      if (!drag.moving && Math.abs(move.clientY - drag.startY) < SLOP) return;
      if (!drag.moving) {
        drag.moving = true;
        this.view.dom.classList.add("cm-fub-blocks-dragging");
        if (this.menu) closeContextMenu();
        this.liftUp(drag);
      }
      this.track();
    });
    life.listen(this.grip, "pointerup", () => this.endDrag(true));
    life.listen(this.grip, "pointercancel", () => this.endDrag(false));
    life.listen(this.grip, "lostpointercapture", () => this.endDrag(false));
    life.listen(window, "keydown", (key) => {
      if (key.key !== "Escape" || !drag.moving) return;
      key.preventDefault();
      key.stopPropagation();
      this.endDrag(false);
    }, { capture: true });
    // Vicino ai bordi la vista scorre, e la linea d'arrivo la segue.
    const timer = setInterval(() => {
      if (!drag.moving) return;
      const box = this.view.scrollDOM.getBoundingClientRect();
      const speed = drag.y < box.top + EDGE ? -(box.top + EDGE - drag.y) : drag.y > box.bottom - EDGE ? drag.y - (box.bottom - EDGE) : 0;
      if (speed === 0) return;
      this.view.scrollDOM.scrollTop += Math.max(-24, Math.min(24, speed / 2));
      this.track();
    }, 16);
    life.add(() => clearInterval(timer));
  }

  /// Dove cadrebbe il blocco con il puntatore a `drag.y`, e la linea che lo dice.
  track(): void {
    const drag = this.drag;
    if (!drag) return;
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, drag.key);
    if (index < 0) return this.endDrag(false);
    const run = runFor(state, blocks, index);
    const sibs = siblingsOf(blocks, run.first);
    if (drag.lift) drag.lift.el.style.translate = `0 ${this.liftOffset(drag)}px`;
    const height = drag.y - view.documentTop;
    const content = view.contentDOM.getBoundingClientRect();
    const scroller = view.scrollDOM.getBoundingClientRect();
    // Sul bordo destro di un fratello fuori dalla tratta: accanto, in colonna.
    drag.beside = null;
    if (drag.x > content.left + content.width * BESIDE) {
      for (const sib of sibs) {
        if (sib >= run.first && sib <= run.last) continue;
        const top = view.lineBlockAt(blocks[sib]!.from).top;
        const bottom = view.lineBlockAt(blocks[sib]!.to).bottom;
        if (height < top || height > bottom) continue;
        if (!dropAsColumn(state, blocks, run, sib)) break;
        drag.beside = sib;
        drag.before = null;
        this.drop.hidden = false;
        this.drop.dataset.beside = "true";
        this.drop.style.top = `${top + view.documentTop - scroller.top + view.scrollDOM.scrollTop}px`;
        this.drop.style.left = `${content.right - scroller.left + view.scrollDOM.scrollLeft - 2}px`;
        this.drop.style.width = "2px";
        this.drop.style.height = `${Math.max(16, bottom - top)}px`;
        this.part(drag, null);
        return;
      }
    }
    delete this.drop.dataset.beside;
    this.drop.style.height = "";
    let gap = 0;
    for (const sib of sibs) {
      const top = view.lineBlockAt(blocks[sib]!.from).top;
      const bottom = view.lineBlockAt(blocks[sib]!.to).bottom;
      if (height > (top + bottom) / 2) gap++;
    }
    const before = gap < sibs.length ? sibs[gap]! : -1;
    const a = sibs.indexOf(run.first);
    const b = sibs.indexOf(run.last);
    // Davanti a sé o subito dopo di sé non si sposta niente.
    drag.before = gap >= a && gap <= b + 1 ? null : before;
    this.part(drag, drag.before === null ? null : this.parting(blocks, sibs, run, a, b, gap));
    if (drag.before === null) {
      this.drop.hidden = true;
      return;
    }
    const edge = before === -1 ? view.lineBlockAt(blocks[sibs[sibs.length - 1]!]!.to).bottom : view.lineBlockAt(blocks[before]!.from).top;
    const first = view.coordsAtPos(blocks[sibs[0]!]!.from, 1);
    const left = (first?.left ?? content.left) - scroller.left + view.scrollDOM.scrollLeft;
    this.drop.hidden = false;
    this.drop.style.top = `${edge + view.documentTop - scroller.top + view.scrollDOM.scrollTop - 1}px`;
    this.drop.style.left = `${left}px`;
    this.drop.style.width = `${Math.max(40, content.right - (first?.left ?? content.left))}px`;
  }

  /// Solleva il blocco: un'immagine delle sue righe galleggia sopra il
  /// foglio e segue il puntatore, mentre al suo posto resta il vuoto.
  liftUp(drag: Drag): void {
    const view = this.view;
    const span = this.liftedSpan(drag);
    if (!span) return;
    const rows = Array.from(view.contentDOM.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) return false;
      try {
        const pos = view.posAtDOM(child, 0);
        return pos >= span.from && pos <= span.to;
      } catch {
        return false;
      }
    });
    if (rows.length === 0) return;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const rects = rows.map((row) => row.getBoundingClientRect());
    const top = Math.min(...rects.map((rect) => rect.top));
    const left = Math.min(...rects.map((rect) => rect.left));
    const el = document.createElement("div");
    el.className = "cm-fub-block-lift";
    el.setAttribute("aria-hidden", "true");
    el.style.top = `${top - scroller.top + view.scrollDOM.scrollTop}px`;
    el.style.left = `${left - scroller.left + view.scrollDOM.scrollLeft}px`;
    el.style.width = `${Math.max(...rects.map((rect) => rect.right)) - left}px`;
    // Dentro un contenuto finto, perché le righe copiate prendano la pelle.
    const inner = document.createElement("div");
    inner.className = view.contentDOM.className;
    inner.style.padding = "0";
    for (const row of rows) inner.append(row.cloneNode(true));
    el.append(inner);
    view.scrollDOM.append(el);
    drag.life.add(() => el.remove());
    drag.lift = { el, scroll: view.scrollDOM.scrollTop };
    view.dispatch({ effects: setDragPose.of({ lifted: span, parted: null }) });
    animate(el, { from: { scale: 1 / LIFT_SCALE }, spring: "snap" });
  }

  /// Il tratto del blocco trascinato, o di quello sollevato adesso.
  liftedSpan(drag: Drag | null = null): { from: number; to: number } | null {
    const state = this.view.state;
    if (!drag) return state.field(dragPose).lifted;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, drag.key);
    if (index < 0) return null;
    const run = runFor(state, blocks, index);
    return { from: blocks[run.first]!.from, to: blocks[run.last]!.to };
  }

  /// Di quanto (px) l'immagine sollevata sta sotto il posto vecchio.
  liftOffset(drag: Drag): number {
    return drag.lift ? drag.y - drag.startY + this.view.scrollDOM.scrollTop - drag.lift.scroll : 0;
  }

  /// Dove si vede adesso l'immagine sollevata rispetto al posto da cui è
  /// partita, con la scala che ha in quell'istante (anche a metà salita).
  liftPose(drag: Drag): { x: number; y: number; scale: number } | null {
    if (!drag.lift) return null;
    const { el } = drag.lift;
    const scrollDOM = this.view.scrollDOM;
    const scroller = scrollDOM.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const left = parseFloat(el.style.left) + scroller.left - scrollDOM.scrollLeft;
    const top = parseFloat(el.style.top) + scroller.top - scrollDOM.scrollTop;
    return { x: rect.left - left, y: rect.top - top, scale: el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1 };
  }

  /// Le righe che si scostano perché il blocco cada davanti al fratello
  /// `gap`: scendendo, quelle fra il suo posto e l'arrivo salgono a coprire il
  /// vuoto; salendo, quelle fra l'arrivo e il suo posto scendono a fargli
  /// spazio. Soltanto le righe in vista.
  parting(blocks: readonly Block[], sibs: readonly number[], run: BlockRun, a: number, b: number, gap: number): DragPose["parted"] {
    const view = this.view;
    const top = view.lineBlockAt(blocks[run.first]!.from).top;
    const height = b + 1 < sibs.length
      ? view.lineBlockAt(blocks[sibs[b + 1]!]!.from).top - top
      : view.lineBlockAt(blocks[run.last]!.to).bottom - top;
    const [from, to, dy] = gap > b + 1
      ? [blocks[sibs[b + 1]!]!.from, blocks[sibs[gap - 1]!]!.to, -height]
      : [blocks[sibs[gap]!]!.from, blocks[sibs[a - 1]!]!.to, height];
    const shown = { from: Math.max(from, view.viewport.from), to: Math.min(to, view.viewport.to) };
    return shown.from > shown.to ? null : { ...shown, dy };
  }

  /// Mette le righe nella posa `parted`, e quelle che cambiano posto ci
  /// arrivano scivolando da dove si vedevano.
  part(drag: Drag, parted: DragPose["parted"]): void {
    if (!drag.lift) return;
    const view = this.view;
    const pose = view.state.field(dragPose);
    const was = pose.parted;
    if (was === parted || (was && parted && was.from === parted.from && was.to === parted.to && was.dy === parted.dy)) return;
    const shift = (value: DragPose["parted"], pos: number) => (value && pos >= value.from && pos <= value.to ? value.dy : 0);
    const rows: { el: Element; pos: number; y: number }[] = [];
    for (const child of Array.from(view.contentDOM.children)) {
      let pos: number;
      try {
        pos = view.posAtDOM(child, 0);
      } catch {
        continue;
      }
      if (shift(was, pos) === shift(parted, pos)) continue;
      const live = liveState(child);
      rows.push({ el: child, pos, y: live?.pose.y ?? 0 });
    }
    view.dispatch({ effects: setDragPose.of({ lifted: pose.lifted, parted }) });
    for (const row of rows) {
      const live = liveState(row.el);
      halt(row.el);
      animate(row.el, {
        from: { y: row.y + shift(was, row.pos) - shift(parted, row.pos) },
        ...(live ? { velocity: live.velocity } : {}),
        spring: "soft",
      });
    }
  }

  /// `quiet`: lo smontaggio, che non può più toccare la vista.
  endDrag(commit: boolean, quiet = false): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    // Dove si vedeva l'immagine sollevata rispetto al posto vecchio: da lì
    // parte l'atterraggio, o il ritorno se il gesto non sposta niente. Si
    // legge prima che l'immagine se ne vada.
    const lift = drag.moving ? this.liftPose(drag) : null;
    drag.life.close();
    this.drop.hidden = true;
    this.view.dom.classList.remove("cm-fub-blocks-dragging");
    if (!drag.moving) return;
    // Il clic che segue il rilascio: lo consuma la maniglia, o lo azzera il
    // prossimo trascinamento.
    this.swallowClick = true;
    const settle = (): void => {
      const lead = this.liftedSpan();
      if (quiet || (!lift && !lead)) return;
      this.view.dispatch({
        effects: setDragPose.of(null),
        annotations: blockGesture.of({ kind: "drop", say: "", ...(lead ? { lead } : {}), ...(lift ? { lift } : {}) }),
      });
    };
    if (!commit || (drag.before === null && drag.beside === null)) return settle();
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, drag.key);
    if (index < 0) return;
    const run = runFor(state, blocks, index);
    if (drag.beside !== null) {
      const spec = dropAsColumn(state, blocks, run, drag.beside);
      if (!spec) return settle();
      view.dispatch({ ...spec, effects: [setBlockSelection.of(null), setDragPose.of(null)], annotations: blockGesture.of({ kind: "columns" }) });
      view.focus();
      return;
    }
    if (drag.before === null) return settle();
    const spec = moveSiblings(state, blocks, run.first, run.last, drag.before);
    if (!spec) return settle();
    const { follow, origin, moved, ...move } = spec;
    const value = state.field(blockSelection, false);
    const effects = [
      setDragPose.of(null),
      ...(value ? [setBlockSelection.of({ anchor: follow(value.anchor) ?? value.anchor, head: follow(value.head) ?? value.head, depth: value.depth })] : []),
    ];
    // L'atterraggio parte da dove si vedeva l'immagine sollevata.
    const gesture = blockGesture.of({ kind: "drop", origin, lead: moved, ...(lift ? { lift } : {}) });
    view.dispatch({ ...move, userEvent: "move.drop", effects, annotations: gesture });
    view.focus();
  }

  destroy(): void {
    this.endDrag(false, true);
    this.view.dom.classList.remove("cm-fub-blocks-dragging");
    this.life.close();
  }
}

/// Le maniglie: esportate perché i test guardino il menu senza un layout.
export const handlesView = ViewPlugin.fromClass(HandlesView);

export const blockHandles: Extension = [
  handlesView,
  EditorView.baseTheme({
    // I colori sono della pelle (`document.css`); qui soltanto la forma.
    ".cm-fub-block-handles": {
      position: "absolute",
      // Sopra il margine dei numeri (che CodeMirror tiene a 200): il «+» ci
      // cade dentro per metà.
      zIndex: "201",
      display: "flex",
      alignItems: "center",
      gap: "2px",
      transform: "translateX(calc(-100% - 0.4rem))",
    },
    ".cm-fub-block-handles[hidden]": { display: "none" },
    ".cm-fub-block-add, .cm-fub-block-grip": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "1.4rem",
      height: "1.5rem",
      padding: "0",
      border: "0",
      borderRadius: "4px",
      background: "transparent",
      cursor: "pointer",
      font: "inherit",
      fontSize: "1rem",
      lineHeight: "1",
    },
    ".cm-fub-block-grip": { cursor: "grab", touchAction: "none" },
    "&.cm-fub-blocks-dragging .cm-fub-block-grip": { cursor: "grabbing" },
    ".cm-fub-block-add-plus": {
      width: "0.75rem",
      height: "0.75rem",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
    },
    ".cm-fub-block-grip-dots": {
      width: "0.5rem",
      height: "0.85rem",
      backgroundImage: "radial-gradient(circle, currentColor 1.2px, transparent 1.4px)",
      backgroundSize: "0.25rem 0.28rem",
    },
    ".cm-fub-block-drop": { position: "absolute", zIndex: "3", height: "2px", borderRadius: "1px", pointerEvents: "none" },
    ".cm-fub-block-drop[hidden]": { display: "none" },
    "&.cm-fub-blocks-selecting .cm-selectionBackground": { display: "none" },
    "&.cm-fub-blocks-selecting .cm-content ::selection": { background: "transparent" },
  }),
];

