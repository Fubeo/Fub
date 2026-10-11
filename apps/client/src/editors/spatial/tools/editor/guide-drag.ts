// L'editor del disegno: il gesto delle guide del documento. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { symmetryMatrices } from "../symmetry";
import { brushForInput, PF1_DEFAULTS } from "../../ink/brush";
import { pf1Outline } from "../../ink/pf1";
import { INK_MAX_SAMPLES, quantizeInk } from "../../ink/sample";
import type { StrokeStart } from "../../pen/pen-input";
import { compose, type Point } from "../../scene/matrix";
import { ROOT } from "../../scene/ops";
import { MAX_GUIDES, writeGuides, type RulerGuide } from "../../scene/rulers";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { gripAt, type Axis as FrameAxis } from "../frame";
import { nearer } from "../guides";
import { snapValue } from "../grid";
import { guideDialog } from "../guide-dialog";
import { touchDialog } from "../touch-dialog";
import { GUIDE_HIT_PX, guideAt } from "../rulers";
import { toScene, toScreen } from "../../view";
import { HIGHLIGHTER_OPACITY } from "../palette";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, INK_KEY, inkCopyKey } from "./constants";
import type { EditorContext } from "./context";
import { straight } from "./helpers";
import type { Gesture, GestureBase, GuideGesture, InkGesture, RefusedGesture } from "./types";

/// Ciò che il gesto delle guide del documento dà agli altri pezzi dell'editor.
export interface GuideDragContext {
  guideUpdate: (g: GuideGesture, p: Point) => void;
  guideLabel: () => OverlayHandle[];
  guideEnd: (g: GuideGesture, time: number) => void;
  lockGuide: (index: number, lock: boolean) => void;
  deleteGuide: (index: number) => void;
  lockAllGuides: (lock: boolean) => void;
  deleteAllGuides: () => void;
  touchSettings: () => Promise<void>;
  editGuides: (focus: number | null) => Promise<void>;
  begin: (start: StrokeStart) => Gesture;
  straightened: (g: InkGesture) => boolean;
  drawInk: (g: InkGesture) => void;
}

/// Monta il gesto delle guide del documento.
export function installGuideDrag(ctx: EditorContext): void {
  const {
    has, style, surface, overlay, editable, newIds, announce, docUnit, stepNow, lengthText, lengthSpoken, guidesShown, viewArea, rulerAt, showGuideLines,
    sceneLevel, axisCursor, viewCenter, resolveNodes, frameNow, showGrip, showHandles, commit, cancelGesture, target, gridOn, guidesOn, guideReach,
    guidesFor, options
  } = ctx;
  // --- Il gesto delle guide del documento ----------------------------------------

  /// Le guide del documento da scrivere, o perché non si può: le guide
  /// scritte che non si leggono non si riscrivono a gesti, e lo si dice.
  const writableGuides = (): readonly RulerGuide[] | null => {
    const guides = ctx.scene.root.guides;
    if (guides === null) announce(t("draw.guides.unreadable"));
    return guides;
  };

  /// Le guide nascoste si fanno vedere per chi ne aggiunge: è ciò che vuole
  /// vedere. Lo dice l'annuncio della guida.
  const revealGuides = (): void => {
    if (ctx.grid.rulerGuides) return;
    ctx.grid = { ...ctx.grid, rulerGuides: true };
    options.onGridChange?.(ctx.grid);
  };

  /// Scrive le guide `next` in un passo di annulla `label`, e dice `text`.
  const commitGuides = (label: DrawKey, next: readonly RulerGuide[], text: string): boolean => {
    ctx.settleCrop();
    if (commit(label, { op: "set", id: ROOT, attrs: { "fub:guides": writeGuides(next) } }) === null) return false;
    announce(text);
    return true;
  };

  /// Il gesto di una guida, se il puntatore è sceso su un righello o su una
  /// guida: un righello ne tira una nuova, quello in alto un'orizzontale e
  /// quello a sinistra una verticale; con lo strumento Selezione una guida
  /// libera si sposta. Le maniglie della cornice vengono prima delle guide,
  /// le guide prima degli oggetti. `null` se il gesto non è di una guida.
  const guideStart = (base: GestureBase): GuideGesture | RefusedGesture | null => {
    const down = ctx.downAt;
    if (down === null || !has("rulers")) return null;
    const ruler = rulerAt(down);
    if (ruler === "corner") return { ...base, kind: "refused" };
    const p = toScene(ctx.camera, down);
    if (ruler !== null) {
      if (!editable()) return { ...base, kind: "refused" };
      const guides = writableGuides();
      if (guides === null) return { ...base, kind: "refused" };
      if (guides.length >= MAX_GUIDES) {
        announce(t("draw.guides.full", { count: MAX_GUIDES }));
        return { ...base, kind: "refused" };
      }
      // Sul foglio girato il righello in alto tira la guida della scena che
      // si vede più orizzontale, quello a sinistra la più verticale.
      const level = sceneLevel();
      const axis = ruler === "top" ? (level ? "y" : "x") : level ? "x" : "y";
      return { ...base, kind: "guide", axis, index: null, from: down, offset: 0, at: axis === "x" ? p[0] : p[1], away: true, moved: false };
    }
    if (ctx.tool !== "select" || !editable() || !guidesShown() || ctx.cropping !== null) return null;
    const guides = ctx.scene.root.guides;
    if (guides === null) return null;
    const view = frameNow();
    if (view !== null && gripAt(view, p, ctx.camera.scale, base.pointer) !== null) return null;
    const index = guideAt(guides, ctx.camera, down, GUIDE_HIT_PX[base.pointer], true);
    if (index === null) return null;
    const guide = guides[index]!;
    const offset = guide.at - (guide.axis === "x" ? p[0] : p[1]);
    return { ...base, kind: "guide", axis: guide.axis, index, from: down, offset, at: guide.at, away: false, moved: false };
  };

  /// Dove va la guida del gesto `g` per il valore `value` della scena: sulla
  /// riga della griglia o sul bersaglio più vicino, a pari distanza sul
  /// bersaglio, finché Ctrl o ⌘ non è tenuto; a due decimali, come la
  /// scrive il file.
  const guideValue = (g: GuideGesture, value: number): number => {
    let at = value;
    if (!ctx.free) {
      const axis: FrameAxis = g.axis === "x" ? 0 : 1;
      const line = gridOn() ? snapValue(value, stepNow()) : null;
      const target = guidesOn() ? guidesFor(g, [], () => [], g.index).nearest(axis, value, guideReach(g.pointer)) : null;
      at = nearer(value, target, line);
    }
    return Math.round(at * 100) / 100 || 0;
  };

  /// Il gesto `g` col puntatore in `p`, nella scena: la guida lo segue, e
  /// sopra un righello o fuori dal foglio si rilascia per toglierla.
  const guideUpdate = (g: GuideGesture, p: Point): void => {
    const [x, y] = toScreen(ctx.camera, p);
    if (!g.moved && Math.hypot(x - g.from[0], y - g.from[1]) <= DRAG_PX[g.pointer]) return;
    if (!g.moved) showGrip(axisCursor(g.axis));
    g.moved = true;
    g.away = x < 0 || y < 0 || x > surface.clientWidth || y > surface.clientHeight || rulerAt([x, y]) !== null;
    g.at = guideValue(g, (g.axis === "x" ? p[0] : p[1]) + g.offset);
    showGuideLines();
    showHandles();
  };
  ctx.guideUpdate = guideUpdate;

  /// Accanto al puntatore che tira una guida: dove sta, o che rilasciata se
  /// ne va. Resta nella parte del foglio che si vede, fuori dai righelli.
  const guideLabel = (): OverlayHandle[] => {
    const g = ctx.current?.kind === "guide" ? ctx.current : null;
    if (g === null || !g.moved || ctx.pointerAt === null) return [];
    const area = viewArea();
    const [px, py] = toScreen(ctx.camera, ctx.pointerAt.at);
    const x = Math.min(Math.max(px, area.x + 48), area.x + area.w - 48);
    const y = Math.min(Math.max(py + 8, area.y + 4), area.y + area.h - 24);
    const [ax, ay] = toScene(ctx.camera, [x, y]);
    return [{ kind: "label", x: ax, y: ay, text: g.away ? t("draw.guide.drop") : lengthText(g.at) }];
  };
  ctx.guideLabel = guideLabel;

  /// La fine del gesto `g`: una guida nuova entra se è sul foglio, una che
  /// c'era va dove l'ha portata o, sopra un righello, se ne va. Un tocco fermo
  /// non cambia niente; due tocchi sulla stessa guida aprono «Guide».
  const guideEnd = (g: GuideGesture, time: number): void => {
    ctx.current = null;
    showGrip(null);
    showGuideLines();
    showHandles();
    if (!g.moved) {
      if (g.index === null) return;
      const tap = ctx.lastGuideTap;
      const twice = tap !== null && tap.index === g.index && time - tap.time <= DOUBLE_TAP_MS && Math.hypot(tap.at[0] - g.from[0], tap.at[1] - g.from[1]) <= DOUBLE_TAP_PX[g.pointer];
      ctx.lastGuideTap = twice ? null : { index: g.index, time, at: g.from };
      if (twice) void editGuides(g.index);
      return;
    }
    ctx.lastGuideTap = null;
    const guides = ctx.scene.root.guides;
    if (guides === null) return;
    const vertical = g.axis === "x";
    if (g.index === null) {
      if (g.away) return;
      revealGuides();
      const text = t(vertical ? "draw.guide.added.x" : "draw.guide.added.y", { at: lengthSpoken(g.at) });
      commitGuides("draw.action.guide_add", [...guides, { axis: g.axis, at: g.at, locked: false }], text);
      return;
    }
    const before = guides[g.index];
    if (before === undefined) return;
    if (g.away) {
      commitGuides("draw.action.guide_delete", guides.filter((_, i) => i !== g.index), t(vertical ? "draw.guide.deleted.x" : "draw.guide.deleted.y"));
      return;
    }
    if (g.at === before.at) return;
    const text = t(vertical ? "draw.guide.moved.x" : "draw.guide.moved.y", { at: lengthSpoken(g.at) });
    commitGuides("draw.action.guide_move", guides.map((each, i) => (i === g.index ? { ...each, at: g.at } : each)), text);
  };
  ctx.guideEnd = guideEnd;

  /// Blocca o sblocca la guida `index`: bloccata, il puntatore la attraversa.
  const lockGuide = (index: number, lock: boolean): void => {
    const guides = writableGuides();
    if (guides === null || guides[index] === undefined || guides[index]!.locked === lock) return;
    const next = guides.map((each, i) => (i === index ? { ...each, locked: lock } : each));
    commitGuides(lock ? "draw.action.guide_lock" : "draw.action.guide_unlock", next, t(lock ? "draw.guide.locked" : "draw.guide.unlocked"));
  };
  ctx.lockGuide = lockGuide;

  /// Elimina la guida `index`.
  const deleteGuide = (index: number): void => {
    const guides = writableGuides();
    const guide = guides?.[index];
    if (guides === null || guide === undefined) return;
    commitGuides("draw.action.guide_delete", guides.filter((_, i) => i !== index), t(guide.axis === "x" ? "draw.guide.deleted.x" : "draw.guide.deleted.y"));
  };
  ctx.deleteGuide = deleteGuide;

  /// Blocca o sblocca tutte le guide.
  const lockAllGuides = (lock: boolean): void => {
    const guides = writableGuides();
    if (guides === null || guides.every((each) => each.locked === lock)) return;
    commitGuides("draw.action.guides", guides.map((each) => ({ ...each, locked: lock })), t(lock ? "draw.guides.all_locked" : "draw.guides.all_unlocked"));
  };
  ctx.lockAllGuides = lockAllGuides;

  /// Elimina tutte le guide, in un passo di annulla.
  const deleteAllGuides = (): void => {
    const guides = writableGuides();
    if (guides === null || guides.length === 0) return;
    commitGuides("draw.action.guides", [], plural(guides.length, "draw.guides.deleted.one", "draw.guides.deleted.other"));
  };
  ctx.deleteAllGuides = deleteAllGuides;

  /// «Guide…»: le guide coi numeri, nell'unità del documento, col fuoco
  /// sulla guida `focus`. Ciò che cambia si scrive in un passo di annulla.
  /// «Penna e dita…»: i gesti delle dita e la curva della pressione della
  /// penna, di questo dispositivo. Valgono anche in sola lettura, come la
  /// griglia: sono della vista, non del disegno.
  async function touchSettings(): Promise<void> {
    if (ctx.asking || !has("gestures")) return;
    ctx.finishText();
    cancelGesture();
    ctx.asking = true;
    try {
      const answer = await touchDialog({ twist: ctx.grid.twist, taps: ctx.grid.taps, pen: ctx.grid.pen });
      if (answer === null || ctx.disposed) return;
      ctx.changeGrid({ ...ctx.grid, ...answer });
    } finally {
      ctx.asking = false;
    }
  }
  ctx.touchSettings = touchSettings;

  async function editGuides(focus: number | null): Promise<void> {
    if (ctx.asking || !editable() || !has("rulers")) return;
    ctx.finishText();
    cancelGesture();
    ctx.asking = true;
    try {
      const center = toScene(ctx.camera, viewCenter());
      const before = ctx.scene.root.guides;
      const answer = await guideDialog({ guides: before, unit: docUnit(), center, focus });
      if (answer === null || ctx.disposed || !editable()) return;
      // Mentre la finestra era aperta il disegno può essere cambiato: si
      // scrive ciò che la finestra mostra, se è diverso da ciò che c'è.
      const now = ctx.scene.root.guides;
      if (now !== null && writeGuides(answer) === writeGuides(now)) return;
      if (answer.length > (now?.length ?? 0)) revealGuides();
      commitGuides("draw.action.guides", answer, t("draw.guides.changed"));
    } finally {
      ctx.asking = false;
    }
  }
  ctx.editGuides = editGuides;

  const begin = (start: StrokeStart): Gesture => {
    const base = { stroke: start.id, pointer: start.pointerType };
    // Un righello o una guida sotto il puntatore prendono il gesto, con
    // qualunque strumento il righello, con la Selezione la guida.
    const guide = start.id >= 0 ? guideStart(base) : null;
    if (guide !== null) return guide;
    if (!editable()) return { ...base, kind: "refused" };
    // Il centro della simmetria prende il gesto della penna che lo tocca.
    const center = ctx.symmetryStart(base);
    if (center !== null) return center;
    // Mentre si ritaglia, il gesto è del ritaglio.
    if (ctx.cropping !== null && ctx.tool === "select") return { ...base, kind: "crop", from: null, end: null, grab: null, start: null, offset: [0, 0], dragging: false };
    switch (ctx.tool) {
      case "pen":
      case "highlighter": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        // L'evidenziatore ha lo spessore costante e le punte piatte, come un
        // pennarello a scalpello: la pressione non lo cambia.
        let brush = ctx.tool === "highlighter"
          ? { ...PF1_DEFAULTS, size: width, thinning: 0, capStart: false, capEnd: false, sim: false }
          : brushForInput({ ...PF1_DEFAULTS, size: width, sim: false }, start.pressure);
        // Il seguito di un tratto chiuso al limite non si assottiglia alla
        // giunzione.
        if (start.continued) brush = { ...brush, taperStart: 0 };
        return {
          ...base,
          kind: "ink",
          tool: ctx.tool,
          color,
          brush,
          to,
          ids,
          scene: [],
          local: [],
          predicted: [],
          began: start.timeStamp,
          holds: ctx.tool === "pen" && start.id >= 0 && !start.continued,
          still: null,
          held: null,
          copies: ctx.symmetryShown() ? symmetryMatrices(ctx.symmetryNow()) : [],
        };
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
      case "cover":
      case "polygon": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        return { ...base, kind: "shape", tool: ctx.tool, color, width, to, ids, from: null, end: null };
      }
      case "connector":
        return { ...base, kind: "connector", ids: newIds(), from: null, end: null, grab: null, start: null, hook: null, dragging: false };
      case "bezier": {
        // Il livello si guarda a ogni nodo: se non riceve più, lo si dice e
        // il nodo non entra.
        const to = target(newIds());
        if (to === null) return { ...base, kind: "refused" };
        return { ...base, kind: "bezier", to, curve: ctx.curvature, mode: null, path: null, reshaped: null, index: -1, from: null, end: null, at: null, dragging: false };
      }
      case "eraser":
        return { ...base, kind: "erase", last: null, marked: new Map() };
      case "note":
        return { ...base, kind: "note", at: null };
      case "select":
        return {
          ...base,
          kind: "select",
          from: null,
          end: null,
          mode: "pending",
          units: [],
          base: [],
          release: null,
          source: null,
          hit: null,
          grip: null,
          corner: null,
          area: null,
          matrix: null,
          angle: 0,
          lines: null,
        };
      case "lasso":
        return { ...base, kind: "lasso", points: [], base: [...ctx.selection], mode: ctx.shift ? "add" : ctx.alt ? "remove" : "replace", dragging: false };
      case "board":
        return { ...base, kind: "board", from: null, end: null, mode: "pending", plan: "draw", sheet: null, grip: null, carried: [], source: null, rect: null };
      case "eyedropper":
        // L'anteprima del gesto prende il posto di quella che passava.
        ctx.dropperHover = null;
        return { ...base, kind: "dropper", at: null, seen: null };
      case "nodes":
        resolveNodes();
        return {
          ...base,
          kind: "nodes",
          from: null,
          end: null,
          grab: null,
          dragging: false,
          nodes: ctx.nodeSelection,
          shapes: ctx.edits.map((edit) => edit.path),
          selection: [...ctx.selection],
          draft: null,
          side: null,
          reshaped: null,
          missed: null,
        };
      case "builder":
        return { ...base, kind: "builder", from: null, end: null, mode: null, additive: false, crossed: [], trail: [], base: [...ctx.selection], dragging: false };
      case "scissors":
        return { ...base, kind: "cut", from: null, end: null, trail: [], dragging: false };
      case "width":
        return { ...base, kind: "width", from: null, end: null, spot: null, shape: null, index: -1, side: 0, dragging: false };
      case "text":
        // Il tocco che ha concluso un testo non ne apre un altro.
        return ctx.closedTyping ? { ...base, kind: "refused" } : { ...base, kind: "text", from: null, end: null, dragging: false };
      case "gradient":
        return {
          ...base,
          kind: "gradient",
          from: null,
          end: null,
          read: null,
          grab: null,
          dragging: false,
          change: null,
          only: null,
          place: null,
          stops: null,
          stop: null,
          torn: null,
          snapped: null,
        };
    }
  };
  ctx.begin = begin;

  /// L'evidenziatore con Maiusc traccia dritto, dal primo punto all'ultimo.
  const straightened = (g: InkGesture): boolean => g.tool === "highlighter" && ctx.shift;
  ctx.straightened = straightened;

  const drawInk = (g: InkGesture): void => {
    const samples = straightened(g)
      ? straight(g.local)
      : g.local.length + g.predicted.length <= INK_MAX_SAMPLES
        ? [...g.local, ...g.predicted]
        : g.local;
    let outline: ReturnType<typeof pf1Outline> = [];
    if (samples.length > 0) {
      try {
        outline = pf1Outline(quantizeInk(samples), g.brush, { last: false });
      } catch {
        outline = [];
      }
    }
    const opacity = g.tool === "highlighter" ? Number(HIGHLIGHTER_OPACITY) : 1;
    const ink = outline.length === 0 ? null : { outline, matrix: g.to.matrix, color: g.color, opacity };
    overlay.setInk(INK_KEY, ink);
    // Le copie in simmetria: lo stesso contorno, portato nella scena.
    g.copies.forEach((m, k) => overlay.setInk(inkCopyKey(k), ink === null ? null : { ...ink, matrix: compose(m, g.to.matrix) }));
    ctx.inkCopies = Math.max(ctx.inkCopies, g.copies.length);
    overlay.flush();
  };
  ctx.drawInk = drawInk;
}
