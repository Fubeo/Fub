// La maniglia e il «+» (H3), il menu del blocco (H4) e il trascinamento (H5,
// E2). Una colonna a sinistra del testo con due pulsanti per il blocco sotto
// il puntatore, per quello del cursore e per quello che ha il fuoco; sugli
// schermi senza passaggio restano sul blocco del cursore. Stanno nello
// scorrimento dell'editor, non nel contenuto: non sono nel file, non si
// copiano, e il cursore non ci entra.
//
// La maniglia sono i due occhi del marchio; presi, si socchiudono. Il blocco
// in mano è il blocco vero, compatto (al più 104 px), e dove cadrà si apre il
// posto: la regola sta in `place.ts`, senza DOM. I rettangoli si misurano alla
// presa e di nuovo soltanto se cambia la parte montata da CodeMirror; per
// fotogramma si scrivono soltanto `transform` e `opacity`; il documento cambia
// al rilascio, in una transazione.
import { EditorSelection, type EditorState, type Extension, Facet } from "@codemirror/state";
import { BlockType, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../../../ui/menu";
import { displayBinding } from "../../../../../ui/commands";
import { writeClipboardText } from "../../../../../platform/clipboard";
import { type Lifetime, openLifetime } from "../../../../../ui/lifetime";
import { iconEl } from "../../../../../ui/icons";
import { attachTooltip } from "../../../../../ui/tooltip";
import { openSlashAt, slashAvailable } from "../slash";
import { liveStrings } from "../strings";
import { blockGesture } from "../block-gesture";
import { detailsOf, setDetailsDefault } from "../details-live";
import type { DetailsPair } from "../details";
import { colorsAt, CONTENT_COLORS, lineText, setContentColor, type ColorKind, type ContentColor } from "../color";
import { blockAnchor, blockLink } from "./anchor";
import { columnsRun, dropAsColumn, intoColumns } from "./columns";
import { withLineBreaks } from "../../../line-breaks";
import { blockModel, blockStartingAt, innermostAt, kindName, type Block } from "./model";
import { type BlockRun, isListItem, moveRun, moveSiblings, nestRun, outdentRun, pinnedFirst, sectionAt, siblingsOf } from "./move";
import { blockSelection, cursorBlock, deleteRun, duplicateRun, runOfSelection, selectBlocks, setBlockSelection } from "./selection";
import { canTransform, targetOf, transformTo, type TransformTarget, unwrap } from "./transform";
import {
  announceGesture, dragPose, type DragPose, isPageHeader, LIFT_SCALE, ownsRow, partedShift, type PartedRun, samePose, setDragPose,
} from "./motion";
import {
  besideSide, heldHeight, type Lean, leanOf, magnet, NEST_PX, neighbourAt, nextPlace, type PlaceGeometry, shiftOf,
  shownTop, sideways, slotTop, tailShift,
} from "./place";
import { animate, halt, liveState, type Motion, motionLevel, onFrame } from "../../../../../moto";
import { markPresence } from "../../../../core/presence";
import { dropOffers, type SurfaceDropDocument, watchDropOffers } from "../../../../core/registry";
import { type DropTarget, placeTargets, targetAt } from "./drop-targets";
import { edgeDepth, edgeScroll, type EdgeScroll } from "./autoscroll";
import type { Teardown } from "../../../../../ui/lifetime";

export interface BlocksOptions {
  /// La nota e il suo vault: i posti fuori dalla colonna (i titoli della sua
  /// Struttura) si chiedono per lei. Senza, il blocco staccato dal testo non
  /// ha bersagli e torna al suo posto.
  readonly document?: () => SurfaceDropDocument | null;
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
  /// Esc è di chi ospita l'editor, che con lui ne esce (una scheda della
  /// lavagna): sul testo Esc non seleziona il blocco del cursore e passa
  /// all'ospite; una selezione di blocchi già fatta la chiude ancora.
  readonly escapeLeaves?: boolean;
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
  return key ? blockStartingAt(blocks, key.from, key.depth) : -1;
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
      return { changes: { from: end, insert: withLineBreaks(state, insert) }, cursor: end + insert.length };
    }
  }
  const indent = /^\s*/.exec(first)![0];
  const insert = `\n\n${block.depth > 0 ? indent : ""}`;
  return { changes: { from: end, insert: withLineBreaks(state, insert) }, cursor: end + insert.length };
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

/// Lo stato di un trascinamento: dove è partito, e — preso il blocco — ciò
/// che si è misurato alla presa e dove cadrebbe.
interface Drag {
  readonly pointer: number;
  /// Al tocco la presa chiede una pressione lunga, non un movimento.
  readonly touch: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly key: BlockKey;
  readonly life: Lifetime;
  moving: boolean;
  x: number;
  y: number;
  hold: Hold | null;
}

/// Il blocco in mano.
interface Hold {
  /// La tratta e i suoi fratelli (indici di blocco) alla presa; `others`
  /// sono i fratelli fuori dalla tratta, nell'ordine dei vicini di `geo`.
  readonly run: BlockRun;
  readonly sibs: readonly number[];
  readonly others: readonly number[];
  /// Le misure della presa, nelle coordinate dello scorrimento.
  geo: PlaceGeometry;
  /// Il posto fra i vicini, e che cosa farebbe il rilascio oltre al posto.
  place: number;
  lean: Lean;
  beside: { readonly target: number; readonly side: "left" | "right" } | null;
  /// Il blocco in mano (`el`, che si sposta per fotogramma), la sua carta
  /// (che cresce alla presa) e le etichette.
  readonly el: HTMLElement;
  readonly card: HTMLElement;
  readonly shade: HTMLElement;
  readonly to: HTMLElement;
  /// Il posto che si apre fra i vicini.
  readonly slot: HTMLElement;
  /// Dove sta il blocco in mano a riposo (px nello scorrimento), quanto è
  /// alto, e dove la maniglia lo tiene (px dal suo bordo alto).
  readonly left: number;
  readonly held: number;
  readonly grab: number;
  /// Lo scorrimento e la colonna del testo, letti alla presa.
  readonly scroller: { readonly top: number; readonly left: number; readonly bottom: number };
  /// Quanto (px) le altezze di CodeMirror sbagliano dove sta davvero il
  /// blocco: un widget di blocco col margine (la testata della pagina) non
  /// entra nella mappa delle altezze. Letto alla presa, vale per ogni misura.
  readonly skew: number;
  /// La scala della vista (una scheda sulla lavagna con lo zoom): i px dello
  /// schermo diviso questa danno i px di CodeMirror.
  readonly sx: number;
  readonly sy: number;
  /// Dove sta ogni fratello fuori dalla tratta fra i vicini di `geo`.
  readonly otherIndex: ReadonlyMap<number, number>;
  /// Il posto per cui la posa delle righe è già scritta: a posto fermo, un
  /// movimento del puntatore non la ricalcola.
  partedKey: string;
  readonly column: { readonly left: number; readonly right: number };
  /// I bordi del testo (la colonna senza il suo rientro), px dello schermo:
  /// oltre 90 px da lì il blocco si stacca.
  readonly text: { readonly left: number; readonly right: number };
  /// Staccato dal testo: è il cartellino sotto il puntatore, nello strato
  /// sopra la finestra, e il posto è tornato all'origine.
  free: boolean;
  /// La scala del cartellino (largo al più 250 px).
  readonly freeScale: number;
  /// I bersagli fuori dalla colonna, chiesti alla shell quando il blocco si
  /// stacca e di nuovo quando la finestra scorre o la shell li ridisegna, e
  /// quello sotto il puntatore.
  targets: readonly DropTarget[];
  hot: DropTarget | null;
  /// Gli ascolti accesi mentre il blocco è staccato (lo scorrimento della
  /// finestra, i ridisegni della shell) e la rimisura in attesa.
  watching: Teardown | null;
  remeasure: number | null;
  /// Il cartellino lasciato senza bersaglio torna a casa da questa scala.
  shrunk: number | null;
  /// Lo scorrimento al bordo: il suo stato e il ciclo che lo fa.
  readonly edge: EdgeScroll;
  scrolling: Teardown | null;
  /// Il titolo della sezione d'origine, e l'ultima cosa annunciata.
  readonly section: string | null;
  said: string;
  /// Dove il blocco vuole andare e dove si vede, rispetto al posto di
  /// riposo; l'inclinazione quando corre di lato.
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  tilt: number;
  /// Il ciclo dei fotogrammi che porta il blocco dove vuole andare: acceso
  /// solo finché non c'è arrivato, così a puntatore fermo tutto riposa.
  frames: Teardown | null;
  /// Il blocco in mano sta tornando a casa dopo il rilascio: la sua copia e
  /// il posto restano finché non arriva.
  flying: boolean;
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

/// Il bordo sinistro di ciò che si vede del blocco: il testo, o il bordo di
/// un widget più largo della colonna (una scheda, una tabella larga), così
/// «+» e maniglia stanno sempre a sinistra di ciò che si vede.
function visibleLeft(view: EditorView, block: Block, text: number): number {
  const node = view.domAtPos(block.from).node;
  let row = node instanceof Element ? node : node.parentElement;
  while (row && row.parentElement !== view.contentDOM) row = row.parentElement;
  if (!row || row.classList.contains("cm-line")) return text;
  const box = (row.firstElementChild ?? row).getBoundingClientRect();
  return box.width > 0 ? Math.min(text, box.left) : text;
}

/// Oltre quanti px dal testo il blocco in mano si stacca (px dello schermo).
const FREE_PX = 90;
/// Il cartellino: largo al più 250 px e mai più dell'86% del blocco, col suo
/// angolo 14 px a destra e 16 px sotto il puntatore.
const FREE_WIDTH = 250;
const FREE_SCALE = 0.86;
const FREE_X = 14;
const FREE_Y = 16;
/// Il rimpicciolimento allo stacco, come nel prototipo (`.lift-c`:
/// `transform .24s cubic-bezier(0.3, 1.45, 0.5, 1)`).
const FREE_MS = 240;
const FREE_EASING = "cubic-bezier(0.3, 1.45, 0.5, 1)";
/// Di quanto il puntatore deve muoversi perché un clic diventi un trascinamento.
const SLOP = 4;
/// Al tocco, quanto (ms) va tenuto premuto perché il blocco si prenda.
const TOUCH_HOLD_MS = 300;
/// La presa: il blocco cresce e l'ombra si forma in 240 ms, con una molla
/// appena accennata.
const LIFT_MS = 240;
const LIFT_EASING = "cubic-bezier(0.3, 1.45, 0.5, 1)";
/// I vicini scivolano in 300 ms, superando l'arrivo di un paio di pixel.
const PART_MS = 300;
const PART_EASING = "cubic-bezier(0.22, 1.18, 0.36, 1)";
/// Il posto entra in dissolvenza in 200 ms; l'etichetta della sezione
/// cresce in 180 ms con un rimbalzo.
const SLOT_IN_MS = 200;
const TAG_IN_MS = 180;
const TAG_IN_EASING = "cubic-bezier(0.3, 1.4, 0.5, 1)";
/// Il margine fra il blocco in mano e i bordi della parte visibile (px).
const KEEP_IN = 4;
/// Il rientro della carta attorno alle righe del blocco in mano (px).
const CARD_PAD = 8;
/// L'inclinazione più grande del blocco che corre di lato (gradi).
const TILT_MAX = 1;

/// Un colpetto aptico, se il sistema lo offre.
function tap(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Nessun motore aptico: niente.
  }
}

/// Mette `el` nello strato sopra la finestra (`on`) o ve lo toglie. Lì non lo
/// tagliano né lo scorrimento né il riquadro, e resta dov'è nel DOM: la pelle
/// e le variabili del documento lo raggiungono come prima. Un motore senza
/// popover lo lascia nella pagina, fisso (`position: fixed` della forma).
function topLayer(el: HTMLElement, on: boolean): void {
  if (typeof el.showPopover !== "function") return;
  try {
    if (on) {
      el.setAttribute("popover", "manual");
      el.showPopover();
    } else if (el.hasAttribute("popover")) {
      if (el.matches(":popover-open")) el.hidePopover();
      el.removeAttribute("popover");
    }
  } catch {
    // Lo strato non c'è: resta fisso nella pagina.
  }
}

/// Dove comincia (px dall'inizio del documento) la prima riga di testo che
/// comincia in `pos`. Il blocco di riga di CodeMirror comprende i widget
/// messi prima della riga: la testata della pagina, in cima alla nota, non è
/// del primo blocco e non si conta.
function textTop(view: EditorView, pos: number): number {
  const line = view.lineBlockAt(pos);
  if (!Array.isArray(line.type)) return line.top;
  for (const part of line.type) {
    if (part.type === BlockType.WidgetBefore && part.from === 0) continue;
    return part.top;
  }
  return line.top;
}

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
  /// I widget di blocco (una tabella, una scheda) messi in posa a mano: le
  /// decorazioni di riga della posa non li raggiungono.
  readonly posed = new Set<HTMLElement>();
  /// Il blocco lasciato che torna a casa: `land` lo posa subito.
  returning: { land(quiet?: boolean): void } | null = null;
  readonly hoverable: boolean;

  constructor(readonly view: EditorView) {
    this.hoverable = typeof matchMedia !== "function" || matchMedia("(hover: hover)").matches;
    this.root.className = "cm-fub-block-handles";
    markPresence(this.root, "hover");
    this.root.hidden = true;
    this.add.type = "button";
    this.add.className = "cm-fub-block-add";
    // Il «+» è disegnato, come gli occhi della maniglia: non dipende dal
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
    // I due occhi, e gli stessi socchiusi mentre il blocco è in mano: le
    // figure sono fra le icone della shell, e un tema le può ridisegnare.
    for (const [name, className] of [["grip-eyes", "cm-fub-block-grip-eyes"], ["grip-eyes-held", "cm-fub-block-grip-held"]] as const) {
      const eyes = document.createElement("span");
      eyes.className = className;
      eyes.setAttribute("aria-hidden", "true");
      const svg = iconEl(name);
      if (svg) eyes.append(svg);
      this.grip.append(eyes);
    }
    this.root.append(this.add, this.grip);
    this.drop.className = "cm-fub-block-drop";
    markPresence(this.drop, "request");
    this.drop.hidden = true;
    view.scrollDOM.append(this.root, this.drop);
    this.life.add(attachTooltip(this.grip, liveStrings.t("blocks.grip.hint")));
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
      // La pressione lunga del tocco è la presa, non il menu.
      if (this.drag) return;
      if (event.target instanceof Node && this.grip.contains(event.target)) {
        const pointer = event.button === 2 && (event.clientX !== 0 || event.clientY !== 0);
        this.openMenu(pointer, pointer ? event : null);
      }
    });
    life.listen(this.grip, "pointerdown", (event) => this.startDrag(event));
    this.schedule();
  }

  update(update: ViewUpdate): void {
    const returning = this.returning;
    if (returning && update.docChanged) queueMicrotask(() => returning.land());
    const drag = this.drag;
    if (drag) {
      // Il testo cambiato da fuori durante il gesto (un altro riquadro, il
      // disco), anche prima che il blocco sia preso: il gesto si annulla e il
      // testo nuovo vince. Non si può spedire una transazione dentro un
      // aggiornamento: appena dopo.
      // Il blocco non torna a casa volando: casa può non esserci più.
      if (update.docChanged) {
        queueMicrotask(() => {
          if (this.drag !== drag) return;
          this.endDrag(false);
          this.returning?.land();
        });
      }
      // La parte montata da CodeMirror è cambiata: si rimisura.
      else if (drag.hold && (update.viewportChanged || update.geometryChanged)) this.remeasure(drag);
      // CodeMirror può aver rifatto i widget: la posa si riscrive a DOM nuovo.
      if (drag.hold) {
        this.view.requestMeasure({ key: "cm-fub-drag-widgets", read: () => null, write: () => this.poseWidgets() });
      }
    }
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
    // La testata della pagina non è un blocco: sopra di lei (e sul
    // frontmatter che copre) le maniglie non compaiono.
    if (target instanceof Element && target.closest(".cm-fub-page")) {
      if (this.hovered) {
        this.hovered = null;
        this.schedule();
      }
      return;
    }
    const pos = this.view.posAtCoords({ x, y }, false);
    const blocks = this.view.state.field(blockModel).blocks;
    const found = innermostAt(blocks, pos);
    const key = found >= 0 ? keyOf(blocks[found]!) : null;
    if (key && this.hovered && key.from === this.hovered.from && key.depth === this.hovered.depth) return;
    if (key) this.hovered = key;
    this.schedule();
  }

  /// Il blocco che le maniglie servono adesso.
  current(): number {
    const state = this.view.state;
    if (state.readOnly) return -1;
    // Una misura chiesta prima di spegnere i blocchi (`editor.blocks`) può
    // arrivare dopo: senza il modello non c'è niente da servire.
    const model = state.field(blockModel, false);
    if (!model) return -1;
    const blocks = model.blocks;
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
          left: visibleLeft(view, block, coords.left) - scroller.left + view.scrollDOM.scrollLeft,
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
        // Le maniglie si rimettono a ogni battuta, e quasi sempre restano dove
        // erano: si scrive solo ciò che cambia, perché in WebKit anche un
        // attributo riscritto uguale invalida lo stile e fa ridipingere (C6).
        if (this.root.hidden) this.root.hidden = false;
        const active = String(this.hoverable && this.hovered !== null && place.key.from === this.hovered.from);
        if (this.root.dataset.active !== active) this.root.dataset.active = active;
        if (this.grip.getAttribute("aria-label") !== place.label) this.grip.setAttribute("aria-label", place.label);
        const style = this.root.style;
        const top = `${place.top}px`;
        const left = `${place.left}px`;
        const height = `${place.height}px`;
        if (style.top !== top) style.top = top;
        if (style.left !== left) style.left = left;
        if (style.height !== height) style.height = height;
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
    // Spenti i blocchi (`editor.blocks`) mentre il menu era aperto, il modello
    // non c'è più: la voce non fa niente.
    const model = state.field(blockModel, false);
    if (!model) return;
    const blocks = model.blocks;
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
      // Su e giù si vedono solo se la tratta può davvero muoversi: il primo
      // testo sotto il frontmatter non sale, e il frontmatter non scende.
      moveRun(view.state, blocks, run, -1) !== null && {
        label: liveStrings.t("blocks.menu.up"), hint: displayBinding("Mod-Shift-ArrowUp"), run: act(moveSpec(-1)),
      },
      moveRun(view.state, blocks, run, 1) !== null && {
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
    // Un blocco che sta ancora tornando a casa si posa prima della presa nuova.
    this.returning?.land();
    const blocks = this.view.state.field(blockModel).blocks;
    const index = indexOf(blocks, this.shown);
    if (index < 0) return;
    const life = openLifetime();
    const touch = event.pointerType === "touch";
    const drag: Drag = {
      pointer: event.pointerId, touch, startX: event.clientX, startY: event.clientY, key: keyOf(blocks[index]!), life,
      moving: false, x: event.clientX, y: event.clientY, hold: null,
    };
    this.drag = drag;
    // Presa, gli occhi si socchiudono, e restano così finché il blocco è in mano.
    this.grip.dataset.held = "true";
    life.add(() => delete this.grip.dataset.held);
    try { this.grip.setPointerCapture(event.pointerId); } catch { /* un puntatore finto */ }
    const lift = (): void => {
      if (drag.moving || this.drag !== drag) return;
      drag.moving = true;
      this.view.dom.classList.add("cm-fub-blocks-dragging");
      if (this.menu) closeContextMenu();
      this.liftUp(drag);
      if (drag.touch) tap();
      this.track();
    };
    // Al tocco il blocco si prende tenendo premuto: un movimento prima è
    // uno scorrimento, e il gesto non parte.
    if (touch) {
      const timer = setTimeout(lift, TOUCH_HOLD_MS);
      life.add(() => clearTimeout(timer));
    }
    life.listen(this.grip, "pointermove", (move) => {
      if (move.pointerId !== drag.pointer) return;
      drag.x = move.clientX;
      drag.y = move.clientY;
      if (!drag.moving) {
        const far = Math.hypot(move.clientX - drag.startX, move.clientY - drag.startY) >= SLOP;
        if (!far) return;
        if (drag.touch) return this.endDrag(false);
        lift();
        return;
      }
      this.track();
    });
    life.listen(this.grip, "pointerup", () => this.endDrag(true));
    life.listen(this.grip, "pointercancel", () => this.endDrag(false));
    life.listen(this.grip, "lostpointercapture", () => this.endDrag(false));
    // Una finestra che perde il fuoco interrompe il gesto: il blocco torna.
    life.listen(window, "blur", () => this.endDrag(false));
    life.listen(window, "keydown", (key) => {
      if (key.key !== "Escape" || !drag.moving) return;
      key.preventDefault();
      key.stopPropagation();
      this.endDrag(false);
    }, { capture: true });
    // Scorrendo, il blocco in mano resta sotto il puntatore. Vicino ai bordi
    // la vista scorre da sola (`edge`), soltanto quando lo si chiede.
    life.listen(this.view.scrollDOM, "scroll", () => this.track());
  }

  /// Le misure della presa, nelle coordinate dello scorrimento: dove stanno
  /// i fratelli come se la tratta in mano non ci fosse. Soltanto l'altezza
  /// delle righe di CodeMirror, niente layout.
  measure(run: BlockRun, sibs: readonly number[], base: number): PlaceGeometry {
    const view = this.view;
    const blocks = view.state.field(blockModel).blocks;
    const top = (i: number) => textTop(view, blocks[i]!.from) + base;
    const bottom = (i: number) => view.lineBlockAt(blocks[i]!.to).bottom + base;
    const a = sibs.indexOf(run.first);
    const b = sibs.indexOf(run.last);
    const runTop = top(run.first);
    const height = Math.max(0, bottom(run.last) - runTop);
    const gap = Math.max(0, b + 1 < sibs.length ? top(sibs[b + 1]!) - (runTop + height) : a > 0 ? runTop - bottom(sibs[a - 1]!) : 0);
    const neighbours = sibs.flatMap((i, k) => {
      if (k >= a && k <= b) return [];
      const t = top(i);
      return [{ top: t - (k > b ? height + gap : 0), height: Math.max(0, bottom(i) - t) }];
    });
    const pinned = pinnedFirst(blocks, sibs);
    return { neighbours, origin: a, top: runTop, height, gap, floor: pinned ? 1 : 0, ...(pinned && a === 0 ? { fixed: true } : {}) };
  }

  /// Da coordinate del documento a quelle dello scorrimento.
  docBase(scroller: { top: number }, sy: number): number {
    return (this.view.documentTop - scroller.top) / sy + this.view.scrollDOM.scrollTop;
  }

  /// La parte montata è cambiata: le misure si rifanno e la posa si ridice.
  remeasure(drag: Drag): void {
    this.view.requestMeasure({
      key: "cm-fub-drag-measure",
      read: () => {
        const hold = drag.hold;
        if (!hold || this.drag !== drag) return null;
        return this.measure(hold.run, hold.sibs, this.docBase(hold.scroller, hold.sy) + hold.skew);
      },
      write: (geo) => {
        const hold = drag.hold;
        if (!geo || !hold || this.drag !== drag) return;
        hold.geo = { ...geo, top: hold.geo.top };
        hold.partedKey = "";
        // Siamo dentro l'aggiornamento di CodeMirror, che non accetta una
        // transazione: la posa nuova delle righe si scrive appena dopo.
        queueMicrotask(() => {
          if (this.drag === drag && drag.hold === hold) this.layout(drag, false);
        });
      },
    });
  }

  /// Prende il blocco: il blocco vero, largo com'era e mai più alto di
  /// 104 px, galleggia sopra il foglio e segue il puntatore; al suo posto si
  /// apre il posto, grigio finché è quello d'origine. Sale soltanto ciò che
  /// appartiene al tratto del blocco: la testata della pagina e i widget degli
  /// altri blocchi restano fermi.
  liftUp(drag: Drag): void {
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, drag.key);
    if (index < 0) return;
    const run = runFor(state, blocks, index);
    const span = { from: blocks[run.first]!.from, to: blocks[run.last]!.to };
    const rows = Array.from(view.contentDOM.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && ownsRow(view, child, span));
    if (rows.length === 0) return;
    const scrollDOM = view.scrollDOM;
    const box = scrollDOM.getBoundingClientRect();
    const scroller = { top: box.top, left: box.left, bottom: box.bottom };
    const content = view.contentDOM.getBoundingClientRect();
    // I bordi del testo: la colonna senza il suo rientro.
    const contentStyle = getComputedStyle(view.contentDOM);
    const text = {
      left: content.left + (parseFloat(contentStyle.paddingLeft) || 0) * (view.scaleX || 1),
      right: content.right - (parseFloat(contentStyle.paddingRight) || 0) * (view.scaleX || 1),
    };
    // Una vista scalata (una scheda sulla lavagna con lo zoom): i rettangoli
    // sono px dello schermo, le altezze di CodeMirror e gli stili px suoi.
    const sx = view.scaleX || 1;
    const sy = view.scaleY || 1;
    // Una riga col suo primo figlio: una scheda o una tabella più larga
    // della colonna resta intera in mano.
    const rects = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      const kid = row.firstElementChild?.getBoundingClientRect();
      if (!kid || kid.width <= 0) return rect;
      return { top: rect.top, height: rect.height, left: Math.min(rect.left, kid.left), right: Math.max(rect.right, kid.right) };
    });
    const rowsLeft = Math.min(...rects.map((rect) => rect.left));
    const width = (Math.max(...rects.map((rect) => rect.right)) - rowsLeft) / sx;
    const sibs = siblingsOf(blocks, run.first);
    const toScrollX = (x: number) => (x - scroller.left) / sx + scrollDOM.scrollLeft;
    const toScrollY = (y: number) => (y - scroller.top) / sy + scrollDOM.scrollTop;
    // La prima riga del blocco dice dove sta davvero: le altezze di
    // CodeMirror si correggono di quanto sbagliano lì (la testata della
    // pagina ha un margine che la mappa delle altezze non conosce). La riga
    // si legge a riposo, come per le maniglie: un moto in corsa non conta.
    const base = this.docBase(scroller, sy);
    const first = this.measure(run, sibs, base);
    const moving = liveState(rows[0]!)?.pose.y ?? 0;
    const skew = rects[0]!.height > 0 ? toScrollY(rects[0]!.top) - moving - first.top : 0;
    const geo = Math.abs(skew) < 0.5 ? first : this.measure(run, sibs, base + skew);
    const held = heldHeight(geo.height);
    const left = toScrollX(rowsLeft) - CARD_PAD;
    // La maniglia resta sotto il puntatore: il punto della presa, dentro il
    // blocco compatto.
    const grab = Math.max(12, Math.min(held - 12, toScrollY(drag.startY) - geo.top));
    const gripRect = this.grip.getBoundingClientRect();
    const gripBox = { left: gripRect.left, width: gripRect.width / sx, height: gripRect.height / sy };

    const el = document.createElement("div");
    el.className = "cm-fub-block-lift";
    el.setAttribute("aria-hidden", "true");
    // Una copia: niente fuoco dentro, e nessun id doppio.
    el.setAttribute("inert", "");
    el.style.left = `${left}px`;
    el.style.top = `${geo.top}px`;
    el.style.width = `${width + 2 * CARD_PAD}px`;
    el.style.height = `${held}px`;
    const shade = document.createElement("div");
    shade.className = "cm-fub-block-lift-shade";
    const card = document.createElement("div");
    card.className = "cm-fub-block-lift-card";
    if (geo.height > held) card.dataset.clipped = "true";
    // Dentro un contenuto finto, perché le righe copiate prendano la pelle.
    const inner = document.createElement("div");
    inner.className = view.contentDOM.className;
    inner.style.padding = "0";
    // Il respiro di una riga può dipendere da dove sta (un titolo che non è
    // il primo figlio): la copia tiene quello che aveva al suo posto.
    for (const row of rows) {
      const copy = row.cloneNode(true) as HTMLElement;
      const style = getComputedStyle(row);
      copy.style.paddingTop = style.paddingTop;
      copy.style.paddingBottom = style.paddingBottom;
      inner.append(copy);
    }
    for (const node of [inner, ...Array.from(inner.querySelectorAll("[id]"))]) node.removeAttribute("id");
    card.append(inner);
    const reduced = motionLevel() === "reduced";
    // Un blocco alto si fa compatto davanti agli occhi: la sua copia intera
    // sta sopra la carta e svanisce mentre i vicini salgono, e l'ombra si
    // accorcia con lei. Soltanto `opacity` e `transform`.
    const tall = geo.height > held && !reduced ? document.createElement("div") : null;
    if (tall) {
      tall.className = "cm-fub-block-lift-full";
      tall.style.height = `${geo.height}px`;
      tall.append(inner.cloneNode(true));
    }
    const grip = document.createElement("span");
    grip.className = "cm-fub-block-lift-grip";
    const eyes = iconEl("grip-eyes-held");
    if (eyes) grip.append(eyes);
    grip.style.left = `${toScrollX(gripBox.left) - left}px`;
    grip.style.top = `${grab - gripBox.height / 2}px`;
    grip.style.width = `${gripBox.width}px`;
    grip.style.height = `${gripBox.height}px`;
    const tags = document.createElement("span");
    tags.className = "cm-fub-block-lift-tags";
    const count = sibs.filter((i) => i >= run.first && i <= run.last).length;
    if (count > 1 || geo.height > held) {
      const more = document.createElement("span");
      more.className = "cm-fub-block-lift-more";
      more.textContent = count > 1 ? liveStrings.t("blocks.drag.count", { count: String(count) }) : kindName(blocks[run.first]!);
      tags.append(more);
    }
    const to = document.createElement("span");
    to.className = "cm-fub-block-lift-to";
    to.hidden = true;
    tags.append(to);
    el.append(shade, card, ...(tall ? [tall] : []), grip, tags);

    const slot = document.createElement("div");
    slot.className = "cm-fub-block-slot";
    slot.dataset.home = "true";
    slot.style.left = `${left}px`;
    slot.style.width = `${width + 2 * CARD_PAD}px`;
    slot.style.height = `${held}px`;
    scrollDOM.append(slot, el);
    drag.life.add(() => {
      if (drag.hold?.flying) return;
      el.remove();
      slot.remove();
    });

    const others = sibs.filter((i) => i < run.first || i > run.last);
    drag.hold = {
      run, sibs, others, geo, place: geo.origin, lean: "none", beside: null,
      el, card, shade, to, slot, left, held, grab, scroller,
      column: { left: content.left, right: content.right }, text,
      free: false, freeScale: Math.min(FREE_SCALE, FREE_WIDTH / (width + 2 * CARD_PAD)), targets: [], hot: null, watching: null, remeasure: null, shrunk: null,
      edge: edgeScroll(), scrolling: null,
      section: sectionAt(state, blocks, span.from, span), said: "",
      skew: Math.abs(skew) < 0.5 ? 0 : skew,
      sx, sy, otherIndex: new Map(others.map((i, k) => [i, k])), partedKey: "",
      tx: 0, ty: 0, cx: 0, cy: 0, tilt: 0, frames: null, flying: false,
    };
    const hold = drag.hold;
    drag.life.add(() => {
      hold.frames?.();
      hold.frames = null;
      hold.el.style.willChange = "";
      this.stopScroll(hold);
      this.unwatchTargets(hold);
      hold.hot?.hover(false);
      hold.hot = null;
    });
    // I vicini sotto un blocco alto salgono scivolando, non a scatto.
    this.layout(drag, true);
    // Il posto entra in dissolvenza.
    animate(slot, { from: { opacity: 0 }, duration: SLOT_IN_MS, easing: "ease-out" });
    // La presa: cresce dell'1,5% (la scala a riposo sta nel CSS) e l'ombra si
    // forma.
    animate(card, { from: { scale: 1 / LIFT_SCALE }, duration: LIFT_MS, easing: LIFT_EASING });
    if (tall) {
      const grow = geo.height / held;
      animate(shade, {
        from: { scaleX: 1 / LIFT_SCALE, scaleY: grow / LIFT_SCALE, y: ((grow - 1) * held) / 2, opacity: 0 },
        duration: PART_MS,
        easing: PART_EASING,
      });
      void animate(tall, { from: { opacity: 1 }, to: { opacity: 0 }, duration: SLOT_IN_MS, easing: "ease-out" }).finished.then(() => tall.remove());
    } else {
      animate(shade, { from: { scale: 1 / LIFT_SCALE, opacity: 0 }, duration: LIFT_MS, easing: LIFT_EASING });
    }
  }

  /// Il blocco in mano va verso dove vuole andare: col moto ridotto ci salta,
  /// altrimenti si accende il ciclo dei fotogrammi, che si spegne all'arrivo.
  chase(drag: Drag): void {
    const hold = drag.hold;
    if (!hold) return;
    if (motionLevel() === "reduced") return this.follow(drag, true);
    if (hold.frames) return;
    // Uno strato suo soltanto mentre corre. Uno strato tenuto tiene la
    // griglia dei pixel di quando è nato, e il testo che il compositore sposta
    // si sfoca di mezzo pixel; fermo, senza, si ridisegna nitido dov'è.
    hold.el.style.willChange = "transform";
    hold.frames = onFrame(() => this.follow(drag));
  }

  /// Dove cadrebbe il blocco col puntatore dov'è: il posto fra i vicini, il
  /// gesto di lato, l'etichetta e l'annuncio.
  track(): void {
    const drag = this.drag;
    const hold = drag?.hold;
    if (!drag || !hold) return;
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    if (indexOf(blocks, drag.key) < 0) return this.endDrag(false);
    // Oltre 90 px dal testo il blocco si stacca: è il cartellino, e cerca i
    // suoi bersagli fuori dalla colonna.
    if (drag.x < hold.text.left - FREE_PX || drag.x > hold.text.right + FREE_PX) return this.trackFree(drag, hold);
    if (hold.free) this.unfree(hold, true);
    this.edgeScroll(drag, hold);
    const scrollDOM = view.scrollDOM;
    const pointerY = (drag.y - hold.scroller.top) / hold.sy + scrollDOM.scrollTop;
    const dx = (drag.x - drag.startX) / hold.sx;
    // Il blocco in mano non esce mai dalla parte visibile.
    // (Una vista senza altezza, mai impaginata, non ha bordi da rispettare.)
    const lo = scrollDOM.scrollTop + KEEP_IN;
    const hi = scrollDOM.scrollTop + scrollDOM.clientHeight - hold.held - KEEP_IN;
    const wanted = pointerY - hold.grab;
    const top = scrollDOM.clientHeight > 0 ? Math.max(lo, Math.min(Math.max(lo, hi), wanted)) : wanted;
    const geo = hold.geo;
    hold.place = nextPlace(geo, hold.place, top + hold.held / 2);
    const first = blocks[hold.run.first]!;
    const list = isListItem(first);
    const n = hold.others.length;
    // Sull'ultimo ottavo a destra o a sinistra di un vicino: «Accanto».
    hold.beside = null;
    const side = geo.fixed ? null : besideSide(drag.x, drag.startX, hold.column.left, hold.column.right, list);
    if (side) {
      const k = neighbourAt(geo, geo.origin, pointerY);
      const target = k >= 0 ? hold.others[k]! : -1;
      if (target >= 0 && dropAsColumn(state, blocks, hold.run, target, side)) {
        hold.beside = { target, side };
        hold.place = geo.origin;
      }
    }
    const above = hold.place > 0 ? blocks[hold.others[hold.place - 1]!] : undefined;
    const parent = first.parent >= 0 ? blocks[first.parent] : undefined;
    hold.lean = hold.beside ? "none" : leanOf(dx, {
      list,
      canNest: isListItem(above),
      canOutdent: isListItem(parent) && hold.place === n,
    });
    hold.tx = sideways(dx);
    const slotAt = slotTop(geo, hold.place);
    hold.ty = top - geo.top + (hold.beside ? 0 : magnet(slotAt - top));
    this.layout(drag, true);
    this.chase(drag);
  }

  /// Il blocco staccato dal testo: il cartellino segue il puntatore, il posto
  /// torna all'origine, e il bersaglio sotto il puntatore si accende.
  trackFree(drag: Drag, hold: Hold): void {
    if (!hold.free) this.goFree(drag, hold);
    this.stopScroll(hold);
    hold.place = hold.geo.origin;
    hold.lean = "none";
    hold.beside = null;
    this.pointTarget(drag, hold);
    hold.tx = drag.x + FREE_X;
    hold.ty = drag.y + FREE_Y;
    this.layout(drag, true);
    this.chase(drag);
  }

  /// Dove sta sullo schermo il blocco in mano a riposo (senza `transform`),
  /// nello scorrimento.
  restOnScreen(hold: Hold): { x: number; y: number } {
    const scrollDOM = this.view.scrollDOM;
    return {
      x: hold.scroller.left + (hold.left - scrollDOM.scrollLeft) * hold.sx,
      y: hold.scroller.top + (hold.geo.top - scrollDOM.scrollTop) * hold.sy,
    };
  }

  /// Il blocco in mano si stacca: passa nello strato sopra la finestra (così
  /// raggiunge la Struttura, fuori dal riquadro), in coordinate dello schermo,
  /// rimpicciolisce col moto del prototipo (240 ms, la curva che supera
  /// l'arrivo di un soffio) e chiede alla shell i bersagli.
  goFree(drag: Drag, hold: Hold): void {
    const rest = this.restOnScreen(hold);
    hold.cx = rest.x + hold.cx * hold.sx;
    hold.cy = rest.y + hold.cy * hold.sy;
    hold.free = true;
    const el = hold.el;
    el.style.setProperty("--fub-block-free-scale", hold.freeScale.toFixed(3));
    el.style.left = "0px";
    el.style.top = "0px";
    el.dataset.free = "true";
    topLayer(el, true);
    hold.tx = hold.cx;
    hold.ty = hold.cy;
    this.follow(drag, true);
    // La transizione CSS non c'è (il moto la spegne dentro l'editor): la
    // carta e l'ombra partono dalla grandezza di presa e calano al riposo
    // del cartellino. Col moto ridotto ci arrivano subito.
    if (motionLevel() !== "reduced") {
      const from = LIFT_SCALE / hold.freeScale;
      for (const part of [hold.card, hold.shade]) {
        animate(part, { from: { scale: from }, duration: FREE_MS, easing: FREE_EASING });
      }
    }
    this.measureTargets(drag, hold);
    this.watchTargets(drag, hold);
  }

  /// Chiede alla shell i bersagli di adesso, e riaccende quello sotto il
  /// puntatore: allo stacco, e poi a ogni scorrimento o ridisegno.
  measureTargets(drag: Drag, hold: Hold): void {
    const doc = this.view.state.facet(blocksOptions).document?.() ?? null;
    const state = this.view.state;
    hold.targets = doc === null ? [] : placeTargets(state, state.field(blockModel).blocks, hold.run, dropOffers(doc));
    // Il bersaglio di prima appartiene a misure vecchie: si spegne sempre, e
    // si riaccende quello nuovo sotto il puntatore (anche la stessa riga).
    hold.hot?.hover(false);
    hold.hot = null;
    this.pointTarget(drag, hold);
  }

  /// Accende il bersaglio sotto il puntatore e spegne quello di prima; se
  /// cambia, ridice l'etichetta e l'annuncio.
  pointTarget(drag: Drag, hold: Hold): boolean {
    const hot = targetAt(hold.targets, drag.x, drag.y);
    if (hot === hold.hot) return false;
    hold.hot?.hover(false);
    hot?.hover(true);
    hold.hot = hot;
    return true;
  }

  /// Mentre il blocco è staccato, i bersagli si rimisurano quando qualcosa
  /// sotto di lui scorre (la rotella funziona anche col puntatore catturato:
  /// in cattura sulla finestra, così vale per ogni scorrimento) e quando la
  /// shell ridisegna i suoi posti. Una rimisura per fotogramma al più, mai
  /// a ogni movimento del puntatore.
  watchTargets(drag: Drag, hold: Hold): void {
    this.unwatchTargets(hold);
    const win = this.view.dom.ownerDocument.defaultView ?? window;
    const soon = () => {
      if (hold.remeasure !== null) return;
      hold.remeasure = win.requestAnimationFrame(() => {
        hold.remeasure = null;
        if (this.drag !== drag || drag.hold !== hold || !hold.free) return;
        this.measureTargets(drag, hold);
        this.layout(drag, false);
      });
    };
    win.addEventListener("scroll", soon, { capture: true, passive: true });
    const stopWatching = watchDropOffers(soon);
    hold.watching = () => {
      win.removeEventListener("scroll", soon, { capture: true });
      stopWatching();
      if (hold.remeasure !== null) win.cancelAnimationFrame(hold.remeasure);
      hold.remeasure = null;
    };
  }

  unwatchTargets(hold: Hold): void {
    hold.watching?.();
    hold.watching = null;
  }

  /// Il blocco torna nel testo: di nuovo nello scorrimento, da dove si vede
  /// adesso. `grow`: la carta torna alla sua grandezza col moto della presa.
  unfree(hold: Hold, grow: boolean): void {
    if (!hold.free) return;
    hold.free = false;
    this.unwatchTargets(hold);
    hold.hot?.hover(false);
    hold.hot = null;
    hold.targets = [];
    const el = hold.el;
    topLayer(el, false);
    delete el.dataset.free;
    el.style.left = `${hold.left}px`;
    el.style.top = `${hold.geo.top}px`;
    const rest = this.restOnScreen(hold);
    hold.cx = (hold.cx - rest.x) / hold.sx;
    hold.cy = (hold.cy - rest.y) / hold.sy;
    hold.tx = hold.cx;
    hold.ty = hold.cy;
    const tilt = hold.tilt === 0 ? "" : ` rotate(${hold.tilt.toFixed(3)}deg)`;
    el.style.transform = `translate(${hold.cx.toFixed(2)}px, ${hold.cy.toFixed(2)}px)${tilt}`;
    if (grow && motionLevel() !== "reduced") {
      const from = hold.freeScale / LIFT_SCALE;
      for (const part of [hold.card, hold.shade]) {
        animate(part, { from: { scale: from }, duration: LIFT_MS, easing: LIFT_EASING });
      }
    }
  }

  /// Lo scorrimento al bordo: acceso mentre il puntatore sta nella fascia,
  /// spento fuori, in cima o in fondo alla nota e quando il blocco si stacca.
  edgeScroll(drag: Drag, hold: Hold): void {
    if (edgeDepth(drag.y, hold.scroller.top, hold.scroller.bottom) === 0) return this.stopScroll(hold);
    if (hold.scrolling) return;
    const scrollDOM = this.view.scrollDOM;
    hold.scrolling = onFrame((elapsed) => {
      if (this.drag !== drag || drag.hold !== hold || hold.free) return this.stopScroll(hold);
      const depth = edgeDepth(drag.y, hold.scroller.top, hold.scroller.bottom);
      if (depth === 0) return this.stopScroll(hold);
      const px = hold.edge.step(depth, elapsed);
      if (px === 0) return;
      // In cima o in fondo si ferma. Il confronto è coi limiti dello
      // scorrimento, non con la posizione di prima: con uno zoom frazionario
      // un passo di un px può arrotondarsi a zero a metà nota.
      const max = scrollDOM.scrollHeight - scrollDOM.clientHeight;
      const at = scrollDOM.scrollTop;
      if (px < 0 ? at <= 0 : at >= max - 0.5) return this.stopScroll(hold);
      scrollDOM.scrollTop = Math.max(0, Math.min(max, at + px));
    });
  }

  stopScroll(hold: Hold): void {
    hold.scrolling?.();
    hold.scrolling = null;
    hold.edge.reset();
  }

  /// Il posto, i vicini scostati, l'etichetta e l'annuncio per lo stato di
  /// `hold`. `slide`: i vicini che cambiano posto ci arrivano scivolando.
  layout(drag: Drag, slide: boolean): void {
    const hold = drag.hold;
    if (!hold) return;
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const geo = hold.geo;
    const place = hold.place;
    const n = hold.others.length;
    // Il posto: alto quanto il blocco in mano, fondo d'accento; grigio
    // sull'origine. Un rientro più in là o più in qua per annidare o portare fuori.
    const slot = hold.slot;
    const indent = hold.lean === "nest" ? NEST_PX : hold.lean === "outdent" ? -NEST_PX : 0;
    const wasTop = parseFloat(slot.style.top);
    const wasLeft = parseFloat(slot.style.left) - hold.left;
    const nowTop = slotTop(geo, place);
    slot.hidden = hold.beside !== null;
    slot.style.top = `${nowTop}px`;
    slot.style.left = `${hold.left + indent}px`;
    if (place === geo.origin && hold.lean === "none") slot.dataset.home = "true";
    else delete slot.dataset.home;
    if (slide && Number.isFinite(wasTop) && (wasTop !== nowTop || wasLeft !== indent)) {
      animate(slot, { from: { x: wasLeft - indent, y: wasTop - nowTop }, duration: PART_MS, easing: PART_EASING });
    }
    // «Accanto»: una barra verticale sul bordo del vicino.
    if (hold.beside) {
      const k = hold.otherIndex.get(hold.beside.target)!;
      const t = shownTop(geo, k, geo.origin);
      const h = geo.neighbours[k]!.height;
      const x = hold.beside.side === "right" ? hold.column.right : hold.column.left;
      this.drop.hidden = false;
      this.drop.dataset.beside = "true";
      this.drop.style.top = `${t}px`;
      this.drop.style.left = `${(x - hold.scroller.left) / hold.sx + view.scrollDOM.scrollLeft - 1}px`;
      this.drop.style.width = "2px";
      this.drop.style.height = `${Math.max(16, h)}px`;
    } else {
      this.drop.hidden = true;
      delete this.drop.dataset.beside;
    }
    // La posa delle righe dipende soltanto dal posto: a posto fermo resta.
    const key = hold.beside ? "beside" : String(place);
    if (key !== hold.partedKey) {
      hold.partedKey = key;
      this.part(this.partedFor(hold), slide);
    }
    // L'etichetta, soltanto quando serve, e l'annuncio a ogni cambio.
    const pos = place < n ? blocks[hold.others[place]!]!.from : n > 0 ? blocks[hold.others[n - 1]!]!.to + 1 : blocks[hold.run.first]!.from;
    const span = { from: blocks[hold.run.first]!.from, to: blocks[hold.run.last]!.to };
    const section = sectionAt(state, blocks, pos, span);
    const moved = place !== geo.origin && !hold.beside;
    const label = hold.free
      ? hold.hot?.label ?? ""
      : moved && section !== hold.section
        ? (section === null ? liveStrings.t("blocks.drag.top") : liveStrings.t("blocks.drag.in", { name: section }))
        : "";
    const appears = hold.to.hidden && label !== "";
    hold.to.hidden = label === "";
    hold.to.textContent = label;
    if (appears) animate(hold.to, { from: { scale: 0.85, opacity: 0 }, duration: TAG_IN_MS, easing: TAG_IN_EASING });
    this.announce(hold, blocks, section);
  }

  /// La frase per chi non vede: «Posizione 4 di 14, in «I conti»», o dove
  /// il gesto di lato porta il blocco.
  announce(hold: Hold, blocks: readonly Block[], section: string | null): void {
    const state = this.view.state;
    const name = (index: number) => gripExcerpt(state, blocks, index) || kindName(blocks[index]!);
    let text: string;
    if (hold.free) {
      text = hold.hot?.label ?? liveStrings.t("blocks.drag.free");
    } else if (hold.beside) {
      text = liveStrings.t("blocks.drag.beside", { name: name(hold.beside.target) });
    } else if (hold.lean === "nest") {
      text = liveStrings.t("blocks.drag.nest", { name: name(hold.others[hold.place - 1]!) });
    } else if (hold.lean === "outdent") {
      text = liveStrings.t("blocks.drag.outdent", { name: name(blocks[hold.run.first]!.parent) });
    } else {
      const n = String(hold.place + 1);
      const total = String(hold.others.length + 1);
      text = section === null
        ? liveStrings.t("blocks.drag.place", { n, total })
        : liveStrings.t("blocks.drag.place.in", { n, total, name: section });
    }
    if (text === hold.said) return;
    // Alla presa il blocco è al suo posto: l'annuncio parte dal primo cambio.
    const first = hold.said === "";
    hold.said = text;
    if (!first) announceGesture(this.view, text);
  }

  /// Le righe scostate per il posto di `hold`: ogni vicino col suo tratto
  /// (e le righe vuote che lo seguono), poi il resto della nota.
  partedFor(hold: Hold): PartedRun[] {
    const blocks = this.view.state.field(blockModel).blocks;
    const geo = hold.geo;
    const place = hold.beside ? geo.origin : hold.place;
    const out: PartedRun[] = [];
    const push = (from: number, to: number, dy: number) => {
      if (to < from) return;
      const last = out[out.length - 1];
      if (last && last.dy === dy && last.to + 1 >= from) out[out.length - 1] = { ...last, to };
      else out.push({ from, to, dy });
    };
    const sibs = hold.sibs;
    sibs.forEach((i, at) => {
      const k = hold.otherIndex.get(i);
      if (k === undefined) return;
      const end = at + 1 < sibs.length ? blocks[sibs[at + 1]!]!.from - 1 : blocks[i]!.to;
      push(blocks[i]!.from, end, shiftOf(geo, k, place));
    });
    const tail = blocks[sibs[sibs.length - 1]!]!.to + 1;
    push(tail, this.view.state.doc.length, tailShift(geo));
    return out;
  }

  /// Il blocco in mano raggiunge il puntatore: in due o tre fotogrammi, e
  /// inclinandosi appena quando corre di lato. Soltanto `transform`.
  follow(drag: Drag, now = false): void {
    const hold = drag.hold;
    if (!hold) return;
    const reduced = motionLevel() === "reduced";
    if (reduced || now) {
      hold.cx = hold.tx;
      hold.cy = hold.ty;
      hold.tilt = 0;
    } else {
      const vx = hold.tx - hold.cx;
      hold.cx += vx * 0.5;
      hold.cy += (hold.ty - hold.cy) * 0.72;
      hold.tilt += (Math.max(-TILT_MAX, Math.min(TILT_MAX, vx * 0.045)) - hold.tilt) * 0.18;
      if (Math.abs(hold.tx - hold.cx) < 0.05) hold.cx = hold.tx;
      if (Math.abs(hold.ty - hold.cy) < 0.05) hold.cy = hold.ty;
      if (Math.abs(hold.tilt) < 0.005 && hold.cx === hold.tx) hold.tilt = 0;
    }
    const tilt = hold.tilt === 0 ? "" : ` rotate(${hold.tilt.toFixed(3)}deg)`;
    hold.el.style.transform = `translate(${hold.cx.toFixed(2)}px, ${hold.cy.toFixed(2)}px)${tilt}`;
    // Arrivato: il ciclo si spegne, e si riaccende al prossimo movimento.
    if (hold.cx === hold.tx && hold.cy === hold.ty && hold.tilt === 0 && hold.frames) {
      hold.frames();
      hold.frames = null;
      hold.el.style.willChange = "";
    }
  }

  /// Il tratto del blocco in mano, nella posa di adesso.
  liftedSpan(): { from: number; to: number } | null {
    return this.view.state.field(dragPose).lifted;
  }

  /// Dove si vede adesso il blocco in mano rispetto al posto da cui è
  /// partito, con la scala che ha in quell'istante (anche a metà presa), e
  /// fin dove si vedeva.
  liftPose(drag: Drag): { x: number; y: number; scale: number; clip?: number } | null {
    const hold = drag.hold;
    if (!hold) return null;
    const rect = hold.card.getBoundingClientRect();
    const scrollDOM = this.view.scrollDOM;
    // Tutto in px di CodeMirror, come le righe che la posa muove.
    const x = (rect.left - hold.scroller.left) / hold.sx + scrollDOM.scrollLeft - hold.left;
    const y = (rect.top - hold.scroller.top) / hold.sy + scrollDOM.scrollTop - hold.geo.top;
    const scale = hold.card.offsetWidth > 0 ? rect.width / hold.sx / hold.card.offsetWidth : 1;
    return {
      x,
      y,
      scale,
      ...(hold.geo.height > hold.held ? { clip: hold.held } : {}),
    };
  }

  /// Mette le righe nella posa `parted`, e quelle che cambiano posto ci
  /// arrivano scivolando da dove si vedevano (`slide`).
  part(parted: PartedRun[], slide: boolean, hold: Hold | null | undefined = this.drag?.hold): void {
    if (!hold) return;
    const view = this.view;
    const pose = view.state.field(dragPose);
    const lifted = { from: view.state.field(blockModel).blocks[hold.run.first]!.from, to: view.state.field(blockModel).blocks[hold.run.last]!.to };
    const next: DragPose = { lifted, parted };
    if (samePose(pose, next)) return;
    const was = pose.parted;
    const rows: { el: Element; pos: number; y: number }[] = [];
    if (slide) {
      for (const child of Array.from(view.contentDOM.children)) {
        if (isPageHeader(child)) continue;
        let pos: number;
        try {
          pos = view.posAtDOM(child, 0);
        } catch {
          continue;
        }
        if (partedShift(was, pos) === partedShift(parted, pos)) continue;
        const live = liveState(child);
        rows.push({ el: child, pos, y: live?.pose.y ?? 0 });
      }
    }
    view.dispatch({ effects: setDragPose.of(next) });
    this.poseWidgets();
    for (const row of rows) {
      halt(row.el);
      animate(row.el, {
        from: { y: row.y + partedShift(was, row.pos) - partedShift(parted, row.pos) },
        duration: PART_MS,
        easing: PART_EASING,
      });
    }
  }

  /// `quiet`: lo smontaggio, che non può più toccare la vista.
  /// I widget di blocco nella posa del trascinamento: invisibili se sono del
  /// blocco in mano, scostati come le righe se stanno sotto il posto.
  /// Soltanto `opacity` e `translate`, come le decorazioni delle righe.
  poseWidgets(): void {
    const view = this.view;
    const pose = view.state.field(dragPose);
    const seen = new Set<HTMLElement>();
    for (const child of Array.from(view.contentDOM.children)) {
      if (!(child instanceof HTMLElement) || child.classList.contains("cm-line") || isPageHeader(child)) continue;
      let pos: number;
      try {
        pos = view.posAtDOM(child, 0);
      } catch {
        continue;
      }
      const lifted = !!pose.lifted && pos >= pose.lifted.from && pos <= pose.lifted.to;
      const dy = partedShift(pose.parted, pos);
      if (!lifted && dy === 0) continue;
      child.style.opacity = lifted ? "0" : "";
      child.style.translate = dy === 0 ? "" : `0 ${dy}px`;
      seen.add(child);
    }
    for (const el of this.posed) {
      if (seen.has(el)) continue;
      el.style.opacity = "";
      el.style.translate = "";
    }
    this.posed.clear();
    for (const el of seen) this.posed.add(el);
  }

  /// I widget di blocco tornano come li vuole CodeMirror.
  unposeWidgets(): void {
    for (const el of this.posed) {
      el.style.opacity = "";
      el.style.translate = "";
    }
    this.posed.clear();
  }

  endDrag(commit: boolean, quiet = false): void {
    let flying = false;
    try {
      flying = this.finishDrag(commit, quiet);
    } finally {
      // Dopo la transazione: il moto della posa legge i widget dov'erano.
      // Se il blocco torna a casa, lo fa il suo arrivo.
      if (!flying) this.unposeWidgets();
    }
  }

  /// Vero se il blocco lasciato torna a casa volando (`flyHome`).
  finishDrag(commit: boolean, quiet: boolean): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    const hold = drag.hold;
    // Il cartellino: sul bersaglio è il bersaglio a dire dove va il blocco;
    // altrimenti torna nel testo, piccolo com'è, e da lì vola a casa.
    const target = commit && !quiet && hold?.free ? hold.hot : null;
    if (hold?.free) {
      this.unfree(hold, false);
      if (!target) {
        hold.shrunk = hold.freeScale;
        for (const part of [hold.card, hold.shade]) {
          part.style.transformOrigin = "0 0";
          part.style.transform = `scale(${hold.freeScale / LIFT_SCALE})`;
        }
      }
    }
    // Dove si vedeva il blocco in mano rispetto al posto vecchio: da lì
    // parte la posa, o il ritorno se il gesto non sposta niente. Si legge
    // prima che il blocco in mano se ne vada.
    const lift = drag.moving ? this.liftPose(drag) : null;
    // Se il gesto non sposta niente, la copia in mano torna a casa da dov'è:
    // resta in pagina oltre la fine del gesto. Altrimenti se ne va qui sotto.
    const keep = !quiet && drag.moving && !!hold && motionLevel() !== "reduced";
    if (keep) hold.flying = true;
    drag.life.close();
    let flew = false;
    try {
      flew = this.release(drag, hold, lift, commit, quiet, target);
    } finally {
      if (keep && !flew) {
        hold.flying = false;
        hold.el.remove();
        hold.slot.remove();
      }
    }
    return flew;
  }

  /// Il rilascio vero e proprio: la transazione della posa, o il ritorno.
  release(drag: Drag, hold: Hold | null, lift: ReturnType<HandlesView["liftPose"]>, commit: boolean, quiet: boolean, target: DropTarget | null = null): boolean {
    this.drop.hidden = true;
    delete this.drop.dataset.beside;
    this.view.dom.classList.remove("cm-fub-blocks-dragging");
    if (!drag.moving) return false;
    // Il clic che segue il rilascio: lo consuma la maniglia, o lo azzera il
    // prossimo trascinamento.
    this.swallowClick = true;
    if (drag.touch && !quiet) tap();
    const settle = (): boolean => {
      if (hold?.flying) return this.flyHome(hold);
      const lead = this.liftedSpan();
      if (quiet || (!lift && !lead)) return false;
      this.view.dispatch({
        effects: setDragPose.of(null),
        annotations: blockGesture.of({ kind: "drop", say: "", ...(lead ? { lead } : {}), ...(lift ? { lift } : {}) }),
      });
      return false;
    };
    if (!commit || !hold) return settle();
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const index = indexOf(blocks, drag.key);
    if (index < 0) return settle();
    const run = runFor(state, blocks, index);
    if (target) return this.dropOn(target, run);
    if (hold.beside) {
      const spec = dropAsColumn(state, blocks, run, hold.beside.target, hold.beside.side);
      if (!spec) return settle();
      view.dispatch({ ...spec, effects: [setBlockSelection.of(null), setDragPose.of(null)], annotations: blockGesture.of({ kind: "columns" }) });
      view.focus();
      return false;
    }
    const n = hold.others.length;
    let spec;
    if (hold.lean === "nest") spec = nestRun(state, blocks, run, hold.others[hold.place - 1]!);
    else if (hold.lean === "outdent") spec = outdentRun(state, blocks, run);
    else if (hold.place !== hold.geo.origin) spec = moveSiblings(state, blocks, run.first, run.last, hold.place < n ? hold.others[hold.place]! : -1);
    if (!spec) return settle();
    const { follow, moved, origin, ...move } = spec;
    const value = state.field(blockSelection, false);
    const effects = [
      setDragPose.of(null),
      ...(value ? [setBlockSelection.of({ anchor: follow(value.anchor) ?? value.anchor, head: follow(value.head) ?? value.head, depth: value.depth })] : []),
    ];
    // La posa parte da dove si vedeva il blocco in mano.
    const gesture = blockGesture.of({ kind: "drop", origin, lead: moved, ...(lift ? { lift } : {}) });
    view.dispatch({ ...move, userEvent: "move.drop", effects, annotations: gesture });
    view.focus();
    return false;
  }

  /// Il rilascio sul bersaglio fuori dalla colonna: il blocco va dove il
  /// bersaglio dice («In fondo a …»), in un passo d'annullamento, e la vista
  /// lo porta al centro. Nessun volo: il blocco ricompare al suo posto nuovo.
  dropOn(target: DropTarget, run: BlockRun): boolean {
    const view = this.view;
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const spec = target.drop(state, blocks, run);
    if (!spec) {
      if (state.field(dragPose).lifted) view.dispatch({ effects: setDragPose.of(null), annotations: blockGesture.of({ kind: "drop", say: "" }) });
      return false;
    }
    const { follow, moved, origin, scrollIntoView: _scroll, ...move } = spec;
    const value = state.field(blockSelection, false);
    view.dispatch({
      ...move,
      userEvent: "move.drop",
      effects: [
        setDragPose.of(null),
        EditorView.scrollIntoView(moved.from, { y: "center" }),
        ...(value ? [setBlockSelection.of({ anchor: follow(value.anchor) ?? value.anchor, head: follow(value.head) ?? value.head, depth: value.depth })] : []),
      ],
      annotations: blockGesture.of({ kind: "drop", origin, lead: moved }),
    });
    view.focus();
    return false;
  }

  /// Il blocco lasciato senza spostarlo (Esc, o rilasciato al suo posto)
  /// torna a casa da dov'è e con la grandezza che ha in quell'istante, anche
  /// a metà presa: la carta vola, l'ombra, il posto e le etichette svaniscono,
  /// i vicini tornano scivolando. All'arrivo la copia se ne va e le righe vere,
  /// identiche e allo stesso posto, riappaiono.
  ///
  /// Ogni corsa parte da dove si vede la sua: il moto continua quelle a metà.
  /// Lo stato finale è già nel DOM (moto torna al CSS, a corsa finita).
  flyHome(hold: Hold): boolean {
    const { el, card, shade, slot } = hold;
    this.part([], true, hold);
    const runs: Motion[] = [];
    const timing = { duration: PART_MS, easing: PART_EASING };
    const fade = { duration: SLOT_IN_MS, easing: "ease-out" };
    // La copia segue il puntatore scrivendo in linea: da lì parte il volo.
    const { cx: x, cy: y, tilt: rotate } = hold;
    el.style.transform = "";
    runs.push(animate(el, { from: { x, y, rotate }, ...timing }));
    // La carta torna alla grandezza vera: la scala del CSS per l'inversa.
    // Il cartellino parte dalla sua scala, dal suo angolo.
    const shrunk = hold.shrunk === null ? null : { scale: hold.shrunk / LIFT_SCALE };
    card.style.transform = `scale(${1 / LIFT_SCALE})`;
    runs.push(animate(card, { ...(shrunk ? { from: shrunk } : {}), to: { scale: 1 / LIFT_SCALE }, ...timing }));
    for (const gone of [shade, slot, ...el.querySelectorAll<HTMLElement>(".cm-fub-block-lift-tags, .cm-fub-block-lift-grip")]) {
      gone.style.opacity = "0";
      if (gone === shade && shrunk) gone.style.transform = "";
      runs.push(animate(gone, { ...(gone === shade && shrunk ? { from: shrunk } : {}), to: { opacity: 0 }, ...(gone === shade ? timing : fade) }));
    }
    // Un blocco alto torna intero: la sua copia completa ricompare sopra la
    // carta mentre i vicini scendono.
    const inner = card.firstElementChild;
    if (hold.geo.height > hold.held && inner) {
      const full = document.createElement("div");
      full.className = "cm-fub-block-lift-full";
      full.style.height = `${hold.geo.height}px`;
      full.append(inner.cloneNode(true));
      card.after(full);
      runs.push(animate(full, { from: { opacity: 0 }, ...timing }));
    }
    let landed = false;
    const flight = {
      land: (quiet = false): void => {
        if (landed) return;
        landed = true;
        if (this.returning === flight) this.returning = null;
        for (const run of runs) run.cancel();
        hold.flying = false;
        el.remove();
        slot.remove();
        this.unposeWidgets();
        if (!quiet && this.view.state.field(dragPose).lifted) this.view.dispatch({ effects: setDragPose.of(null) });
      },
    };
    this.returning = flight;
    void runs[0]!.finished.then(() => flight.land());
    return true;
  }

  destroy(): void {
    this.returning?.land(true);
    // Il menu del blocco non sopravvive alle maniglie: spenti i blocchi, le
    // sue voci non avrebbero più un blocco su cui lavorare.
    if (this.menu) closeContextMenu();
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
      // Il «+» e la maniglia si toccano, come nel prototipo.
      gap: "0",
      transform: "translateX(calc(-100% - 0.4rem))",
    },
    ".cm-fub-block-handles[hidden]": { display: "none" },
    ".cm-fub-block-add, .cm-fub-block-grip": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      // Un bersaglio di 24×24, come nel prototipo.
      width: "24px",
      height: "24px",
      padding: "0",
      border: "0",
      borderRadius: "6px",
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
    // Gli occhi: aperti a riposo, socchiusi mentre il blocco è in mano.
    ".cm-fub-block-grip-eyes, .cm-fub-block-grip-held, .cm-fub-block-lift-grip": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
    },
    ".cm-fub-block-grip-eyes svg, .cm-fub-block-grip-held svg, .cm-fub-block-lift-grip svg": { width: "18px", height: "18px" },
    ".cm-fub-block-grip-held svg path, .cm-fub-block-lift-grip svg path": { strokeWidth: "2.6" },
    ".cm-fub-block-grip-held": { display: "none" },
    ".cm-fub-block-grip[data-held] .cm-fub-block-grip-eyes": { display: "none" },
    ".cm-fub-block-grip[data-held] .cm-fub-block-grip-held": { display: "inline-flex" },
    // Col blocco in mano, la maniglia vera resta (tiene il puntatore) ma
    // non si vede: la sua copia sta sul blocco in mano.
    "&.cm-fub-blocks-dragging .cm-fub-block-handles": { opacity: "0" },
    // Il blocco in mano: sta nello scorrimento, sopra il foglio; si sposta
    // soltanto con `transform`.
    ".cm-fub-block-lift": {
      position: "absolute",
      zIndex: "6",
      pointerEvents: "none",
      transformOrigin: "24px 50%",
    },
    // In mano la carta e la sua ombra sono più grandi dell'1,5%, dal bordo
    // sinistro: la presa ci arriva da 1/LIFT_SCALE, la posa riparte da qui.
    ".cm-fub-block-lift-shade, .cm-fub-block-lift-card": {
      position: "absolute",
      inset: "0",
      borderRadius: "10px",
      scale: String(LIFT_SCALE),
      transformOrigin: "0 50%",
    },
    // La copia intera di un blocco alto, che alla presa svanisce dalla
    // grandezza vera (la carta, sotto, parte da lì).
    ".cm-fub-block-lift-full": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      overflow: "hidden",
      padding: "0 8px",
      boxSizing: "border-box",
      borderRadius: "10px",
      opacity: "0",
      pointerEvents: "none",
    },
    ".cm-fub-block-lift-card": { overflow: "hidden", padding: "0 8px", boxSizing: "border-box" },
    ".cm-fub-block-lift-card > .cm-content, .cm-fub-block-lift-full > .cm-content": { minHeight: "0", width: "100%" },
    // Un blocco alto, tagliato: sfuma verso il fondo (il colore è della pelle).
    ".cm-fub-block-lift-card[data-clipped]::after": {
      content: '""',
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "0",
      height: "30px",
      pointerEvents: "none",
    },
    ".cm-fub-block-lift-grip": { position: "absolute", borderRadius: "6px" },
    ".cm-fub-block-lift-tags": {
      position: "absolute",
      right: "8px",
      bottom: "6px",
      zIndex: "1",
      display: "flex",
      gap: "5px",
      fontSize: "11.5px",
      fontWeight: "600",
      lineHeight: "1",
      whiteSpace: "nowrap",
    },
    ".cm-fub-block-lift-more, .cm-fub-block-lift-to": { padding: "5px 7px", borderRadius: "6px" },
    ".cm-fub-block-lift-to": { paddingInline: "8px" },
    ".cm-fub-block-lift-to[hidden]": { display: "none" },
    // Il cartellino, staccato dal testo (il `.lift.free` del prototipo): sta
    // nello strato sopra la finestra, fisso, in coordinate dello schermo. Il
    // popover del motore non porta né cornice né fondo né margini.
    ".cm-fub-block-lift[data-free]": {
      position: "fixed",
      inset: "auto",
      left: "0",
      top: "0",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      overflow: "visible",
    },
    // Carta e ombra si fanno piccole dal loro angolo: largo al più 250 px.
    // La scala è una variabile della forma, non un valore della pelle.
    ".cm-fub-block-lift[data-free] .cm-fub-block-lift-card, .cm-fub-block-lift[data-free] .cm-fub-block-lift-shade": {
      scale: "var(--fub-block-free-scale, 0.86)",
      transformOrigin: "0 0",
    },
    // Le etichette passano sotto il cartellino, a sinistra.
    ".cm-fub-block-lift[data-free] .cm-fub-block-lift-tags": {
      right: "auto",
      left: "8px",
      bottom: "auto",
      top: "calc(var(--fub-block-free-scale, 0.86) * 100% + 6px)",
    },
    // Il posto dove cadrà, alto quanto il blocco in mano.
    ".cm-fub-block-slot": { position: "absolute", zIndex: "1", borderRadius: "10px", pointerEvents: "none", boxSizing: "border-box" },
    ".cm-fub-block-slot[hidden]": { display: "none" },
    // «Accanto»: una barra verticale sul bordo del vicino.
    ".cm-fub-block-drop": { position: "absolute", zIndex: "3", height: "2px", borderRadius: "1px", pointerEvents: "none" },
    ".cm-fub-block-drop[hidden]": { display: "none" },
    "&.cm-fub-blocks-selecting .cm-selectionBackground": { display: "none" },
    "&.cm-fub-blocks-selecting .cm-content ::selection": { background: "transparent" },
  }),
];

