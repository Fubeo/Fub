// Il blocco vivo (N13): i gesti dei Blocchi si vedono accadere.
//
// Le righe sono di CodeMirror, che le può ricreare: non si anima l'elemento
// vecchio. Un gesto di blocco porta `blockGesture` sulla transazione; qui si
// leggono i riquadri delle righe in vista quando il DOM è ancora quello di
// prima (l'`update` dei plugin viene prima di quello della vista), li si
// rilegge appena il DOM nuovo è scritto (un `updateListener`, prima del
// fotogramma) e si anima ogni riga dal posto vecchio al nuovo, con le molle
// di `moto`. Lo stato è già quello finale al primo
// fotogramma; finita la corsa sull'elemento non resta niente.
//
// Una battuta normale non anima niente: oltre all'annotazione si riconoscono
// soltanto i gesti che si fanno scrivendo — un a capo che fa nascere una
// riga, un Backspace che ne toglie una, «##␣» che cambia la specie del
// blocco — e costano un confronto del modello, non una lettura del layout.
// Con «ridotto» non si sposta niente: resta la sola dissolvenza di chi nasce.
//
// Sopra le righe sta un livello (`layer()`) col velo della selezione di
// blocchi; l'alone dell'atterraggio, le immagini di chi se ne va e quella
// sollevata stanno nello scorrimento, fuori dal contenuto. Ogni gesto ha la
// sua frase nella regione viva.
import { type ChangeSet, type EditorState, type Extension, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, layer, type LayerMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { animate, halt, liveState, motionLevel, prepareExit, springValue, stagger, STAGGER_MAX, type Ghost, type Motion, type Pose, type SpringValue } from "../../../../../moto";
import { openLifetime } from "../../../../../ui/lifetime";
import { softCursor } from "../../../soft-cursor";
import { blockGesture, type BlockGesture } from "../block-gesture";
import { liveStrings } from "../strings";
import { blockModel, kindName, type Block } from "./model";
import { siblingsOf } from "./move";
import { blockSelection, runOfSelection } from "./selection";

/// Oltre questo numero di righe in moto, sola dissolvenza: un gesto che
/// sposta mezza nota non deve far scorrere mezza nota.
export const MOVING_MAX = 60;
/// Quanto oltre la vista (px) una riga si anima ancora.
const MARGIN = 200;
/// La scala del blocco sollevato.
export const LIFT_SCALE = 1.015;
/// Da dove scende chi nasce, e dove sale chi se ne va (px).
const BORN_Y = -8;
const GONE_Y = -4;
/// Le uscite: chi se ne va, e chi sale al suo posto entro lo stesso tempo.
const GONE_MS = 120;
const FOLD_MS = 110;
const RISE_DELAY = 20;
/// Da quanto sotto (px) entrano le parti della pagina.
const ARRIVE_Y = 6;
/// Lo sfalsamento di chi entra uno dopo l'altro.
const EACH_MS = 12;
/// La durata della dissolvenza quando le righe in moto sono troppe.
const CROWD_MS = 140;
/// Il tempo (ms) dopo una modifica in cui il cursore non scivola: è una
/// raffica di battute.
const BURST_MS = 400;

/// Il riquadro di una riga del contenuto, e da che posizione comincia.
interface Box {
  readonly el: HTMLElement;
  readonly pos: number;
  /// Riga o widget, più la posizione: la testata della pagina e la prima
  /// riga cominciano tutte e due a 0.
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /// La dimensione del carattere, letta soltanto dove serve (una trasformazione).
  readonly font: number;
}

function boxKey(el: Element, pos: number): string {
  return `${el.classList.contains("cm-line") ? "l" : "w"}${pos}`;
}

/// La dimensione del carattere del testo di una riga: la più grande fra i suoi
/// testi, perché un titolo porta la sua dimensione su un segno dentro la riga,
/// non sulla riga, e accanto può avere segni più piccoli (l'etichetta del
/// livello, un codice in linea). I widget non contano.
function textSize(el: HTMLElement): number {
  let size = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent?.trim() || !parent || parent.closest("[contenteditable=false]")) continue;
    size = Math.max(size, parseFloat(getComputedStyle(parent).fontSize) || 0);
  }
  return size || parseFloat(getComputedStyle(el).fontSize) || 0;
}

/// Le righe del contenuto in vista, con un margine: gli elementi figli del
/// contenuto, righe e widget di blocco. `font` dice di chi leggere il carattere.
function visibleBoxes(view: EditorView, font: (pos: number) => boolean = () => false): Box[] {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const out: Box[] = [];
  for (const child of Array.from(view.contentDOM.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = child.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom < scroller.top - MARGIN || rect.top > scroller.bottom + MARGIN) continue;
    let pos: number;
    try {
      pos = view.posAtDOM(child, 0);
    } catch {
      continue;
    }
    out.push({
      el: child,
      pos,
      key: boxKey(child, pos),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      // Una riga ancora in corsa si vede scalata: conta la dimensione vista.
      font: font(pos) ? textSize(child) * (liveState(child)?.pose.scaleY ?? 1) : 0,
    });
  }
  return out;
}

/// Un tratto cambiato: prima e dopo, con il testo che c'era e quello nuovo.
interface Changed {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

function changedRanges(changes: ChangeSet): Changed[] {
  const out: Changed[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => out.push({ fromA, toA, fromB, toB }));
  return out;
}

/// La posizione dopo il `k`-esimo a capo di `text` a partire da `from`, se c'è
/// entro `to`.
function afterBreak(doc: EditorState["doc"], from: number, to: number, k: number): number | null {
  if (k === 0) return from;
  let seen = 0;
  const iter = doc.iterRange(from, to);
  let at = from;
  for (let next = iter.next(); !next.done; next = iter.next()) {
    if (next.lineBreak) {
      at += 1;
      if (++seen === k) return at;
      continue;
    }
    for (let i = 0; i < next.value.length; i++) {
      at += 1;
      if (next.value.charCodeAt(i) === 10 && ++seen === k) return at;
    }
  }
  return null;
}

/// Quanti a capo ci sono fra `from` e `to`.
function breaksBetween(doc: EditorState["doc"], from: number, to: number): number {
  return to <= from ? 0 : doc.lineAt(to).number - doc.lineAt(from).number;
}

/// Da dove viene, nel documento di prima, la riga che nel nuovo comincia in
/// `pos`: l'annotazione la sa dire per chi l'ha riscritta; dentro un testo
/// sostituito si conta per righe, la `k`-esima con la `k`-esima; altrove la
/// posizione si riporta indietro. `null`: è nata ora.
function originOf(update: ViewUpdate, ranges: readonly Changed[], gesture: BlockGesture, pos: number): number | null {
  const told = gesture.origin?.(pos);
  if (told !== undefined && told !== null) return told;
  const before = update.startState.doc;
  const after = update.state.doc;
  for (const range of ranges) {
    if (range.toB <= range.fromB || pos < range.fromB || pos > range.toB) continue;
    const k = breaksBetween(after, range.fromB, pos);
    if (k === 0 && before.lineAt(range.fromA).from !== range.fromA) return null;
    return afterBreak(before, range.fromA, range.toA, k);
  }
  return update.changes.invertedDesc.mapPos(pos, 1);
}

/// Il blocco più interno che contiene `pos`, per bisezione sui blocchi di
/// primo livello e poi giù fra i figli.
export function blockAt(blocks: readonly Block[], pos: number): Block | null {
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.from <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // `found` è l'ultimo che comincia prima di `pos`: lui o un suo antenato.
  for (let i = found; i >= 0; i = blocks[i]!.parent) {
    if (pos <= blocks[i]!.to) return blocks[i]!;
  }
  return null;
}

/// C'è un a capo nel testo che le modifiche inseriscono, o in quello che tolgono.
function breaks(update: ViewUpdate, side: "inserted" | "deleted"): boolean {
  let found = false;
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (found) return;
    found = side === "inserted" ? inserted.lines > 1 : breaksBetween(update.startState.doc, fromA, toA) > 0;
  });
  return found;
}

/// I gesti che si fanno scrivendo. Una battuta che non cambia la specie del
/// blocco né il numero delle righe non è un gesto.
export function inferGesture(update: ViewUpdate): BlockGesture | null {
  const tr = update.transactions.find((each) => each.docChanged);
  if (!tr || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null;
  const input = tr.isUserEvent("input");
  if (!input && !tr.isUserEvent("delete")) return null;
  if (input && breaks(update, "inserted")) return { kind: "born" };
  if (!input && breaks(update, "deleted")) return { kind: "gone" };
  const before = update.startState.field(blockModel, false)?.blocks;
  const after = update.state.field(blockModel, false)?.blocks;
  if (!before || !after) return null;
  const head = update.state.selection.main.head;
  const now = blockAt(after, head);
  const was = blockAt(before, update.startState.selection.main.head);
  if (!now || !was || (now.kind === was.kind && now.level === was.level)) return null;
  return { kind: "transform", lead: { from: now.from, to: now.to } };
}

/// Il posto di un blocco fra i fratelli, detto a parole: «il terzo».
export function placeName(index: number): string {
  const n = index + 1;
  return n <= 10
    ? liveStrings.t(`blocks.place.${n}` as "blocks.place.1")
    : liveStrings.t("blocks.place.n", { n: String(n) });
}

/// La frase della regione viva per un gesto, nel documento nuovo.
export function gesturePhrase(state: EditorState, gesture: BlockGesture): string | null {
  // Una frase vuota: il gesto si vede e non si dice (un trascinamento annullato).
  if (gesture.say !== undefined) return gesture.say || null;
  const blocks = state.field(blockModel, false)?.blocks;
  const lead = gesture.lead && blocks ? blockAt(blocks, gesture.lead.from) : null;
  switch (gesture.kind) {
    case "drop":
    case "swap": {
      if (!lead || !blocks) return liveStrings.t("blocks.moved");
      const index = blocks.indexOf(lead);
      return liveStrings.t("blocks.moved.at", { place: placeName(siblingsOf(blocks, index).indexOf(index)) });
    }
    case "transform":
      return lead ? liveStrings.t("blocks.transformed", { kind: kindName(lead) }) : null;
    case "born":
      return liveStrings.t("blocks.born");
    case "gone":
      return liveStrings.t("blocks.gone");
    case "columns":
      return liveStrings.t("blocks.columned");
    default:
      return null;
  }
}

/// Le righe del documento nuovo dentro `range`.
function inside(range: { from: number; to: number } | undefined, pos: number): boolean {
  return !!range && pos >= range.from && pos <= range.to;
}

/// I segni che una trasformazione fa entrare: la casella, il punto, l'icona
/// di un riquadro, la freccia di un ripiegabile.
const MARKS = ".cm-fub-checkbox, .cm-fub-details-arrow, .cm-fub-callout-icon";

/// L'origine della trasformazione di `el` in px dal suo angolo.
function originPx(el: Element): [number, number] {
  const match = /^(-?[\d.]+)px (-?[\d.]+)px/.exec(getComputedStyle(el).transformOrigin ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

/// Ciò che il plugin ha letto prima del gesto.
interface Before {
  readonly gesture: BlockGesture;
  readonly boxes: ReadonlyMap<string, Box>;
  readonly ghosts: ReadonlyMap<string, Ghost>;
  /// Le righe che una trasformazione ha colto ancora in corsa: la loro
  /// immagine si spegne dov'è mentre la riga nuova appare, perché a metà
  /// crescita la riga è più larga o più stretta del suo riquadro di riposo e
  /// ripartire dalla sola scala del testo ne farebbe saltare i bordi.
  readonly handoffs: ReadonlyMap<string, Ghost>;
  readonly ranges: readonly Changed[];
  readonly update: ViewUpdate;
  /// I fondi colorati di prima, per il colore.
  readonly tints: readonly { left: number; top: number; width: number; height: number; color: string }[];
}

class BlockMotion {
  readonly life = openLifetime();
  /// La regione viva dei gesti.
  readonly live = document.createElement("div");
  /// Ciò che sta sopra le righe senza essere un segno del livello: l'alone.
  readonly float = document.createElement("div");
  /// Dove posano le immagini delle righe che se ne vanno: un contenuto finto,
  /// perché prendano la pelle delle righe vere.
  readonly ghostLayer = document.createElement("div");
  private alternate = false;
  /// Il cursore morbido: lo spostamento visibile del livello dei cursori.
  private cursorX: SpringValue | null = null;
  private cursorY: SpringValue | null = null;
  private lastEdit = 0;
  /// Ciò che `play` ha letto e che `flush` anima.
  private pending: Before | null = null;

  constructor(readonly view: EditorView) {
    this.live.className = "cm-fub-block-live";
    this.live.setAttribute("aria-live", "polite");
    this.live.setAttribute("aria-atomic", "true");
    this.float.className = "cm-fub-block-float";
    this.float.setAttribute("aria-hidden", "true");
    this.ghostLayer.className = view.contentDOM.className;
    this.ghostLayer.style.padding = "0";
    this.float.append(this.ghostLayer);
    view.dom.append(this.live);
    view.scrollDOM.append(this.float);
    this.life.add(() => {
      this.live.remove();
      this.float.remove();
    });
    view.requestMeasure({ read: () => null, write: () => this.arrive() });
  }

  /// La pagina che arriva: copertina, icona e titolo entrano uno dopo l'altro.
  arrive(): void {
    if (motionLevel() === "reduced") return;
    const parts = this.view.contentDOM.querySelectorAll(".cm-fub-page-cover, .cm-fub-page-icon, .cm-fub-page-title");
    stagger(parts, (el) => animate(el, { from: { y: ARRIVE_Y, opacity: 0 }, spring: "wide" }), { each: EACH_MS, max: STAGGER_MAX });
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.lastEdit = Date.now();
    const told = update.transactions.map((tr) => tr.annotation(blockGesture)).find((each) => each !== undefined);
    const gesture = told ?? (update.docChanged ? inferGesture(update) : null);
    if (gesture) {
      const phrase = gesturePhrase(update.state, gesture);
      if (phrase) this.say(phrase);
      this.play(update, gesture);
    } else if (update.selectionSet && !update.docChanged) {
      this.glide(update);
    }
  }

  say(text: string): void {
    // Una frase uguale alla precedente si rilegge: cambia di uno spazio.
    this.alternate = !this.alternate;
    this.live.textContent = this.alternate ? text : `${text} `;
  }

  play(update: ViewUpdate, gesture: BlockGesture): void {
    const level = motionLevel();
    // Col moto ridotto resta soltanto la dissolvenza di chi nasce.
    if (level === "reduced" && gesture.kind !== "born") return;
    const view = this.view;
    const ranges = changedRanges(update.changes);
    const reduced = level === "reduced";
    // Il DOM è ancora quello di prima.
    const old = reduced ? [] : visibleBoxes(view, (pos) => gesture.kind === "transform" && ranges.some((range) => pos >= range.fromA && pos <= range.toA));
    const boxes = new Map(old.map((box) => [box.key, box]));
    // Prima le righe che una trasformazione coglie in corsa: la loro immagine
    // fa anche da uscita, se poi nessuna riga nuova viene da loro.
    const handoffs = new Map<string, Ghost>();
    if (gesture.kind === "transform") {
      for (const box of old) if (box.font > 0 && liveState(box.el)) handoffs.set(box.key, prepareExit(box.el));
    }
    const ghosts = new Map<string, Ghost>();
    if (!reduced && !gesture.origin) {
      for (const box of old) {
        if (handoffs.has(box.key)) continue;
        // Una riga che comincia dentro un tratto tolto, o subito dopo: se
        // nessuna riga nuova viene da lei, se ne va (lo si sa soltanto dopo,
        // ma l'immagine si prende adesso).
        const removed = ranges.some((range) => range.toA > range.fromA && box.pos >= range.fromA && box.pos <= range.toA);
        const hidden = gesture.hides && box.pos >= gesture.hides.from && box.pos <= gesture.hides.to;
        if (removed || hidden) ghosts.set(box.key, prepareExit(box.el));
      }
    }
    const tints = gesture.kind === "color" && !reduced ? this.readTints(update, ranges) : [];
    const before: Before = { gesture, boxes, ghosts, handoffs, ranges, update, tints };
    // Il DOM nuovo si legge appena CodeMirror lo ha scritto, prima che il
    // fotogramma lo mostri (`flush`, da `updateListener`): aspettare il ciclo
    // delle misure lascerebbe vedere un fotogramma col blocco già arrivato, e
    // un gesto che ne interrompe un altro salterebbe.
    this.pending = before;
  }

  /// Il gesto in sospeso, col DOM ormai quello nuovo.
  flush(): void {
    const before = this.pending;
    this.pending = null;
    if (before) this.animate(before, this.measureAfter(before));
  }

  /// Il fondo colorato delle righe che il colore tocca, prima del gesto.
  readTints(update: ViewUpdate, ranges: readonly Changed[]): Before["tints"] {
    const out: { left: number; top: number; width: number; height: number; color: string }[] = [];
    for (const range of ranges) {
      const line = this.view.domAtPos(range.fromA).node;
      const el = line instanceof HTMLElement ? line : line.parentElement;
      const row = el?.closest(".cm-line");
      if (!row) continue;
      for (const mark of Array.from(row.querySelectorAll<HTMLElement>("[class*='fub-bg-']"))) {
        const color = getComputedStyle(mark).backgroundColor;
        for (const rect of Array.from(mark.getClientRects())) {
          out.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, color });
        }
      }
    }
    void update;
    return out;
  }

  /// I riquadri di dopo, a corse ferme: una corsa viva sull'elemento che
  /// CodeMirror ha tenuto ripartirebbe da dov'è, non dal posto vecchio.
  measureAfter(before: Before): { boxes: Box[]; live: Map<Element, ReturnType<typeof liveState>> } {
    const live = new Map<Element, ReturnType<typeof liveState>>();
    for (const child of Array.from(this.view.contentDOM.children)) {
      const state = liveState(child);
      if (!state) continue;
      live.set(child, state);
      halt(child);
    }
    const transform = before.gesture.kind === "transform";
    const lead = before.gesture.lead;
    return {
      boxes: visibleBoxes(this.view, (pos) => transform && (inside(lead, pos) || before.ranges.some((range) => pos >= range.fromB && pos <= range.toB))),
      live,
    };
  }

  animate(before: Before, after: { boxes: Box[]; live: Map<Element, ReturnType<typeof liveState>> }): void {
    const { gesture, boxes, ghosts, handoffs, update } = before;
    const reduced = motionLevel() === "reduced";
    const matched = new Set<string>();
    const born: Box[] = [];
    const moves: { box: Box; from: Pose; lead: boolean }[] = [];
    const pairs: { box: Box; was: Box; lead: boolean }[] = [];
    for (const box of after.boxes) {
      const origin = originOf(update, before.ranges, gesture, box.pos);
      const was = origin === null ? undefined : boxes.get(boxKey(box.el, origin));
      if (origin === null || (!was && !reduced && origin !== null && this.bornHere(before, box.pos))) {
        born.push(box);
        continue;
      }
      if (!was) continue;
      matched.add(was.key);
      pairs.push({ box, was, lead: inside(gesture.lead, box.pos) });
    }
    // L'immagine sollevata era il protagonista intero, scalato dal suo bordo
    // alto: ogni sua riga riparte da dove si vedeva lì dentro.
    const leadTop = Math.min(...pairs.filter((pair) => pair.lead).map((pair) => pair.was.top));
    for (const { box, was, lead } of pairs) {
      const lift = lead && gesture.lift ? gesture.lift : null;
      const scale = lift
        ? lift.scale ?? 1
        : gesture.kind === "transform" && was.font > 0 && box.font > 0 ? was.font / box.font : 1;
      const [ox, oy] = scale !== 1 ? originPx(box.el) : [0, 0];
      const top = lift ? leadTop + lift.y + scale * (was.top - leadTop) : was.top;
      const x = was.left + (lift?.x ?? 0) - box.left - ox * (1 - scale);
      const y = top - box.top - oy * (1 - scale);
      const live = after.live.get(box.el);
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && scale === 1 && !live) continue;
      const handoff = handoffs.get(was.key);
      if (handoff) handoff.play({ layer: this.ghostLayer, to: { opacity: 0 }, duration: GONE_MS, easing: "ease-out" });
      moves.push({ box, from: { x, y, ...(scale !== 1 ? { scale } : {}), ...(handoff ? { opacity: 0 } : {}) }, lead });
    }
    const leaving = [...ghosts, ...handoffs].filter(([key]) => !matched.has(key)).map(([, ghost]) => ghost);
    const exit = gesture.kind === "fold" ? FOLD_MS : GONE_MS;
    const crowd = moves.length > MOVING_MAX;
    // Chi se ne va: in dissolvenza alzandosi, entro il tempo dell'uscita.
    for (const ghost of leaving) ghost.play({ layer: this.ghostLayer, to: { y: GONE_Y, opacity: 0 }, duration: exit, easing: "ease-out" });
    const rising = leaving.length > 0;
    for (const { box, from, lead } of moves) {
      const live = after.live.get(box.el);
      if (crowd) {
        animate(box.el, { from: { opacity: 0.4 }, duration: CROWD_MS, easing: "ease-out" });
        continue;
      }
      animate(box.el, {
        from,
        ...(live ? { velocity: live.velocity } : {}),
        // Chi sale al posto di ciò che esce finisce col tempo dell'uscita.
        ...(rising ? { delay: RISE_DELAY, duration: exit - RISE_DELAY, easing: "ease-out" } : { spring: lead && gesture.kind === "drop" ? "jelly" : "soft" }),
      });
    }
    // Chi nasce scende di poco e appare; aprendo un ripiegabile, uno dopo
    // l'altro. Col moto ridotto, la sola dissolvenza.
    stagger(born, (box) => animate(box.el, {
      from: { y: BORN_Y, opacity: 0 },
      spring: "soft",
      whenReduced: "fade",
    }), { each: gesture.kind === "fold" ? EACH_MS : 0, max: STAGGER_MAX });
    if (reduced) return;
    this.extras(gesture, after.boxes, before);
  }

  /// Una riga del documento nuovo che nessuna riga vecchia in vista spiega,
  /// dentro un testo inserito: è nata ora anche se la posizione si riporta.
  bornHere(before: Before, pos: number): boolean {
    return before.gesture.kind === "fold" && !!before.gesture.lead && pos > before.gesture.lead.from && !before.boxes.has(`l${pos}`);
  }

  /// Ciò che ogni gesto aggiunge al moto delle righe.
  extras(gesture: BlockGesture, boxes: readonly Box[], before: Before): void {
    const leadBoxes = boxes.filter((box) => inside(gesture.lead, box.pos));
    switch (gesture.kind) {
      case "drop":
        this.halo(leadBoxes);
        break;
      case "transform":
        // Il segno nuovo entra con un rimbalzo; il punto di una voce è un
        // segno disegnato, e si muove il suo pseudo-elemento.
        for (const box of leadBoxes) {
          for (const mark of Array.from(box.el.querySelectorAll(MARKS))) animate(mark, { from: { scale: 0.6 }, spring: "jelly" });
          for (const bullet of Array.from(box.el.querySelectorAll(".cm-fub-bullet:not(.cm-fub-bullet-task)"))) {
            animate(bullet, { pseudo: "::before", from: { scale: 0.4 }, spring: "jelly" });
          }
        }
        break;
      case "fold": {
        const arrow = leadBoxes[0]?.el.querySelector(".cm-fub-details-arrow");
        const open = arrow?.getAttribute("aria-expanded") === "true";
        if (arrow) animate(arrow, { from: { rotate: open ? -90 : 90 }, spring: "snap" });
        break;
      }
      case "check":
        for (const box of leadBoxes) {
          for (const mark of Array.from(box.el.querySelectorAll(".cm-fub-checkbox"))) animate(mark, { from: { scale: 0.7 }, spring: "jelly" });
        }
        break;
      case "columns":
        for (const box of boxes) {
          for (const label of Array.from(box.el.querySelectorAll(".cm-fub-column-label"))) {
            animate(label, { from: { scaleX: 0 }, spring: "soft" });
          }
        }
        break;
      case "color":
        this.retreat(before.tints, leadBoxes);
        break;
      default:
        break;
    }
  }

  /// La sagoma di un riquadro, nello scorrimento, alle coordinate della finestra.
  placed(className: string, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
    const scroller = this.view.scrollDOM.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${rect.left - scroller.left + this.view.scrollDOM.scrollLeft}px`;
    el.style.top = `${rect.top - scroller.top + this.view.scrollDOM.scrollTop}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    this.float.append(el);
    return el;
  }

  /// L'alone d'accento che si spegne sul blocco appena posato.
  halo(boxes: readonly Box[]): void {
    if (boxes.length === 0) return;
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const el = this.placed("cm-fub-block-halo", { left, top, width: right - left, height: bottom - top });
    const motion = animate(el, { from: { opacity: 1 }, to: { opacity: 0 }, duration: 600, easing: "ease-out" });
    this.removeAfter(el, motion);
  }

  /// Il fondo vecchio si ritira verso destra, sotto il nuovo che è già lì; il
  /// testo riceve una passata del colore nuovo che si spegne.
  retreat(tints: Before["tints"], boxes: readonly Box[]): void {
    for (const tint of tints) {
      const el = this.placed("cm-fub-block-tint", tint);
      el.style.background = tint.color;
      this.removeAfter(el, animate(el, { from: { scaleX: 1 }, to: { scaleX: 0 }, spring: "snap" }));
    }
    for (const box of boxes) {
      const el = this.placed("cm-fub-block-pass", box);
      this.removeAfter(el, animate(el, { from: { opacity: 0.5 }, to: { opacity: 0 }, duration: 360, easing: "ease-out" }));
    }
  }

  removeAfter(el: HTMLElement, motion: Motion): void {
    if (!motion.running) {
      el.remove();
      return;
    }
    void motion.finished.then(() => el.remove());
  }

  /// Il cursore morbido: il livello dei cursori parte da dove si vedeva e
  /// scivola al posto nuovo. Mai durante una raffica di battute, mai col moto
  /// ridotto, mai per un salto più lungo della vista.
  glide(update: ViewUpdate): void {
    const view = this.view;
    if (!update.state.facet(softCursor) || motionLevel() === "reduced" || Date.now() - this.lastEdit < BURST_MS) return;
    const layerEl = view.scrollDOM.querySelector<HTMLElement>(":scope > .cm-cursorLayer");
    const cursor = layerEl?.querySelector(".cm-cursor-primary");
    if (!layerEl || !cursor) return;
    const was = cursor.getBoundingClientRect();
    const shownX = this.cursorX?.get() ?? 0;
    const shownY = this.cursorY?.get() ?? 0;
    view.requestMeasure({
      read: (v) => v.coordsAtPos(v.state.selection.main.head),
      write: (now) => {
        if (!now) return;
        // `was` comprende lo spostamento visibile di allora.
        const dx = was.left - shownX - now.left + shownX;
        const dy = was.top - shownY - now.top + shownY;
        if (Math.abs(dy) > view.scrollDOM.clientHeight || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return;
        const write = (): void => {
          const x = this.cursorX?.get() ?? 0;
          const y = this.cursorY?.get() ?? 0;
          layerEl.style.translate = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 ? "" : `${x}px ${y}px`;
        };
        this.cursorX ??= springValue({ spring: "soft", initial: 0, onUpdate: write, lifetime: this.life });
        this.cursorY ??= springValue({ spring: "soft", initial: 0, onUpdate: write, lifetime: this.life });
        this.cursorX.jump(dx);
        this.cursorY.jump(dy);
        this.cursorX.set(0);
        this.cursorY.set(0);
      },
    });
  }

  destroy(): void {
    this.life.close();
  }
}

export const blockMotion = ViewPlugin.fromClass(BlockMotion);

/// Chiamato da CodeMirror a DOM aggiornato, nella stessa battuta del gesto.
const flushMotion = EditorView.updateListener.of((update) => update.view.plugin(blockMotion)?.flush());

// ── La posa del trascinamento ────────────────────────────────────────────────

/// Ciò che il trascinamento tiene fermo finché dura: il posto vuoto del
/// blocco sollevato e i fratelli scostati per fargli spazio. Sta nelle
/// decorazioni perché CodeMirror riscrive gli attributi delle righe: una
/// proprietà messa a mano non durerebbe.
export interface DragPose {
  /// Il blocco sollevato, che resta come posto vuoto.
  readonly lifted: { readonly from: number; readonly to: number } | null;
  /// Le righe scostate e di quanto (px): soltanto quelle in vista.
  readonly parted: { readonly from: number; readonly to: number; readonly dy: number } | null;
}

export const setDragPose = StateEffect.define<DragPose | null>();

const STILL: DragPose = { lifted: null, parted: null };

export const dragPose = StateField.define<DragPose>({
  create: () => STILL,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setDragPose)) return effect.value ?? STILL;
    // Il testo cambia sotto un trascinamento soltanto da fuori: la posa si
    // scioglie, e il trascinamento la ricalcola al prossimo movimento.
    return tr.docChanged ? STILL : value;
  },
});

const LIFTED = Decoration.line({ class: "cm-fub-block-lifted" });

/// Una decorazione per ogni riga di `[from, to]`.
function eachLine(doc: Text, from: number, to: number, deco: Decoration, out: Range<Decoration>[]): void {
  for (let pos = Math.max(0, from); pos <= Math.min(to, doc.length);) {
    const line = doc.lineAt(pos);
    out.push(deco.range(line.from));
    pos = line.to + 1;
  }
}

const poseDecorations = EditorView.decorations.compute([dragPose], (state): DecorationSet => {
  const pose = state.field(dragPose);
  if (pose === STILL) return Decoration.none;
  const out: Range<Decoration>[] = [];
  if (pose.lifted) eachLine(state.doc, pose.lifted.from, pose.lifted.to, LIFTED, out);
  if (pose.parted) {
    const parted = Decoration.line({ attributes: { style: `translate: 0 ${pose.parted.dy}px` } });
    eachLine(state.doc, pose.parted.from, pose.parted.to, parted, out);
  }
  return Decoration.set(out, true);
});

// ── La selezione di blocchi, sopra le righe ─────────────────────────────────

/// Un riquadro della selezione. `delay` c'è soltanto per chi è appena
/// entrato nella selezione: chi è ridisegnato per altre ragioni non rientra.
class SelectedMarker implements LayerMarker {
  constructor(
    readonly key: number,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly delay: number | null,
  ) {}

  draw(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-fub-block-mark";
    this.place(el);
    if (this.delay !== null) animate(el, { from: { opacity: 0 }, delay: this.delay, spring: "snap" });
    return el;
  }

  place(el: HTMLElement): void {
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
  }

  update(el: HTMLElement, prev: LayerMarker): boolean {
    if (!(prev instanceof SelectedMarker) || prev.key !== this.key) return false;
    this.place(el);
    return true;
  }

  eq(other: LayerMarker): boolean {
    return other instanceof SelectedMarker && other.key === this.key &&
      other.left === this.left && other.top === this.top && other.width === this.width && other.height === this.height;
  }
}

/// I blocchi selezionati l'ultima volta che il livello li ha disegnati, per
/// vista: chi c'era già non rientra.
const lastSelected = new WeakMap<EditorView, ReadonlySet<number>>();

/// I riquadri dei blocchi selezionati in vista, dall'inizio della prima riga
/// alla fine dell'ultima e larghi quanto il contenuto; chi entra ora entra
/// uno dopo l'altro.
export function selectedMarkers(view: EditorView): readonly LayerMarker[] {
  const state = view.state;
  const value = state.field(blockSelection, false);
  const before = lastSelected.get(view) ?? new Set<number>();
  const now = new Set<number>();
  const out: LayerMarker[] = [];
  const run = value ? runOfSelection(state.field(blockModel).blocks, value) : null;
  if (run) {
    const blocks = state.field(blockModel).blocks;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    // L'origine del livello, come la calcola CodeMirror.
    const left = content.left - scroller.left + view.scrollDOM.scrollLeft;
    const top = view.documentTop - scroller.top + view.scrollDOM.scrollTop;
    // Il velo copre la colonna del testo, non il margine del foglio: lo
    // dicono i rientri del contenuto e delle righe.
    const pads = [view.contentDOM, view.contentDOM.querySelector(".cm-line")].map((el) => (el ? getComputedStyle(el) : null));
    const inset = pads.reduce((sum, style) => sum + (parseFloat(style?.paddingLeft ?? "") || 0), 0);
    const width = content.width - inset - pads.reduce((sum, style) => sum + (parseFloat(style?.paddingRight ?? "") || 0), 0);
    const reduced = motionLevel() === "reduced";
    let fresh = 0;
    for (const index of siblingsOf(blocks, run.first).filter((i) => i >= run.first && i <= run.last)) {
      const block = blocks[index]!;
      if (block.to < view.viewport.from || block.from > view.viewport.to) continue;
      const first = view.lineBlockAt(Math.max(block.from, view.viewport.from));
      const last = view.lineBlockAt(Math.min(block.to, view.viewport.to));
      now.add(block.from);
      const delay = before.has(block.from) || reduced ? null : Math.min(fresh++, STAGGER_MAX - 1) * EACH_MS;
      out.push(new SelectedMarker(block.from, left + inset, top + first.top, width, last.bottom - first.top, delay));
    }
  }
  lastSelected.set(view, now);
  return out;
}

const selectionLayer = layer({
  above: true,
  class: "cm-fub-block-layer",
  // Una battuta senza selezione di blocchi non chiede nemmeno una misura.
  updateOnDocViewUpdate: false,
  update(update) {
    const now = update.state.field(blockSelection, false);
    const was = update.startState.field(blockSelection, false);
    if (!now && !was) return false;
    return now !== was || update.docChanged || update.viewportChanged || update.geometryChanged;
  },
  markers: selectedMarkers,
});

export const blockMotionExtension: Extension = [
  dragPose,
  poseDecorations,
  selectionLayer,
  blockMotion,
  flushMotion,
  EditorView.baseTheme({
    // Le righe si scalano dal loro angolo: un titolo cresce dal suo inizio.
    ".cm-content > .cm-line": { transformOrigin: "0 0" },
    ".cm-fub-block-live": {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap",
    },
    ".cm-fub-block-float": { position: "absolute", top: "0", left: "0", width: "0", height: "0", pointerEvents: "none", zIndex: "151" },
    ".cm-fub-block-halo, .cm-fub-block-tint, .cm-fub-block-pass": { position: "absolute", pointerEvents: "none", borderRadius: "4px" },
    ".cm-fub-block-tint": { transformOrigin: "100% 50%" },
    ".cm-fub-block-halo, .cm-fub-block-pass": { opacity: "0" },
    ".cm-fub-block-mark": { position: "absolute", pointerEvents: "none", borderRadius: "4px" },
    ".cm-fub-block-lifted": { opacity: "0" },
    ".cm-fub-block-lift": { position: "absolute", zIndex: "152", pointerEvents: "none", scale: String(LIFT_SCALE), transformOrigin: "0 50%" },
  }),
];
