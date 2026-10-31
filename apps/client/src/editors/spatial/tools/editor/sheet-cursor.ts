// L'editor del disegno: il cursore del foglio. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { INK_MAX_SAMPLES, type InkSample } from "../../../../ink/sample";
import type { StrokeStart } from "../../../../ink/input/session";
import type { Point } from "../../scene/matrix";
import { t } from "../../strings";
import { lineBeyond, snapValue } from "../grid";
import { panned, toScene, toScreen } from "../../view";
import { HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { sign } from "./helpers";

/// Un campione ogni tanti pixel quando il cursore traccia, a un intervallo
/// da mouse: il tratto da tastiera è fitto come uno col puntatore.
const CURSOR_SAMPLE_PX = 4;

const CURSOR_SAMPLE_MS = 16;

/// Quanto il cursore resta lontano dal bordo del foglio, in pixel: oltre, la
/// vista lo segue.
const CURSOR_MARGIN_PX = 24;

/// Ciò che il cursore del foglio dà agli altri pezzi dell'editor.
export interface SheetCursorContext {
  cursorPoint: () => Point;
  moveCursor: (dx: number, dy: number) => void;
  moveCursorOnGrid: (x: number, y: number, lines: number) => void;
  press: (timeStamp: number) => void;
  release: () => void;
  cancelPress: () => void;
}

/// Monta il cursore del foglio.
export function installSheetCursor(ctx: EditorContext): void {
  const {
    life, surface, live, cursorMark,
    editable, currentIndex, announce, coordText, labelOf, showCursor, setCamera, stepNow, viewArea, viewCenter, cancelGesture, handlers
  } = ctx;
  // --- Il cursore del foglio ----------------------------------------------------
  //
  // La tastiera disegna con gli stessi gesti del puntatore: Spazio preme e,
  // di nuovo, rilascia, e in mezzo le frecce portano il cursore. I campioni
  // vanno ai gestori della pipeline come quelli di un mouse, così ogni
  // strumento funziona da tastiera senza un secondo codice.

  /// Il cursore dov'è, o al centro di ciò che si vede.
  const cursorPoint = (): Point => {
    ctx.cursor ??= toScene(ctx.camera, viewCenter());
    return ctx.cursor;
  };
  ctx.cursorPoint = cursorPoint;

  /// La vista segue il cursore quando arriva al bordo, o sotto i righelli.
  const keepInView = (p: Point): void => {
    const { x: left, y: top, w, h } = viewArea();
    if (w === 0 || h === 0) return;
    const margin = Math.min(CURSOR_MARGIN_PX, w / 4, h / 4);
    const [sx, sy] = toScreen(ctx.camera, p);
    const x = sx - left;
    const y = sy - top;
    const dx = x < margin ? margin - x : x > w - margin ? w - margin - x : 0;
    const dy = y < margin ? margin - y : y > h - margin ? h - margin - y : 0;
    if (dx === 0 && dy === 0) return;
    ctx.placed = true;
    setCamera(panned(ctx.camera, dx, dy));
  };


  /// Il gesto da tastiera arriva a `p`, con un campione ogni
  /// [`CURSOR_SAMPLE_PX`] pixel. Al limite dei campioni si rilascia.
  const trace = (p: Point): void => {
    const g = ctx.pressed;
    if (g === null) return;
    const [x0, y0] = g.at;
    const steps = Math.max(1, Math.ceil((Math.hypot(p[0] - x0, p[1] - y0) * ctx.camera.scale) / CURSOR_SAMPLE_PX));
    const samples: InkSample[] = [];
    for (let i = 1; i <= steps && g.samples.length + samples.length < INK_MAX_SAMPLES; i++) {
      g.time += CURSOR_SAMPLE_MS;
      samples.push({ x: x0 + ((p[0] - x0) * i) / steps, y: y0 + ((p[1] - y0) * i) / steps, t: g.time });
    }
    g.at = p;
    g.samples.push(...samples);
    if (samples.length > 0) {
      handlers.onSamples(g.start.id, samples);
      handlers.onSettled?.(g.start.id);
    }
    if (g.samples.length >= INK_MAX_SAMPLES) release();
  };

  /// Dove è il cursore, e che cosa c'è sotto.
  const announceCursor = (): void => {
    const p = cursorPoint();
    const at = t("draw.cursor.at", { x: coordText(p[0]), y: coordText(p[1]) });
    const hit = ctx.pressed === null ? currentIndex().at(p, HIT_PX.mouse / ctx.camera.scale) : null;
    announce(hit === null ? at : `${at}: ${labelOf(hit)}`);
  };

  /// Porta il cursore in `next`, un punto della scena.
  const placeCursor = (next: Point): void => {
    ctx.cursor = next;
    cursorMark.hidden = false;
    keepInView(next);
    showCursor();
    trace(next);
    announceCursor();
  };

  /// Muove il cursore di (`dx`, `dy`) pixel dello schermo.
  const moveCursor = (dx: number, dy: number): void => {
    const [x, y] = cursorPoint();
    if (ctx.camera.angle === 0) {
      placeCursor([x + dx / ctx.camera.scale, y + dy / ctx.camera.scale]);
      return;
    }
    // Sul foglio girato, dove punta sullo schermo.
    const [ox, oy] = toScene(ctx.camera, [0, 0]);
    const [px, py] = toScene(ctx.camera, [dx, dy]);
    placeCursor([x + px - ox, y + py - oy]);
  };
  ctx.moveCursor = moveCursor;

  /// Con l'aggancio, una freccia porta il cursore all'incrocio `lines` righe
  /// più in là nel suo verso, e sulla riga più vicina sull'altro asse.
  const moveCursorOnGrid = (x: number, y: number, lines: number): void => {
    const [cx, cy] = cursorPoint();
    placeCursor([
      x === 0 ? snapValue(cx, stepNow()) : lineBeyond(cx, stepNow(), sign(x), lines),
      y === 0 ? snapValue(cy, stepNow()) : lineBeyond(cy, stepNow(), sign(y), lines),
    ]);
  };
  ctx.moveCursorOnGrid = moveCursorOnGrid;

  /// Spazio: il gesto comincia dove è il cursore.
  const press = (timeStamp: number): void => {
    if (ctx.pressed !== null || !editable()) return;
    cancelGesture();
    const at = cursorPoint();
    const start: StrokeStart = { id: --ctx.keyStrokes, pointerType: "mouse", pressure: false, timeStamp, continued: false, role: "ink" };
    const first: InkSample = { x: at[0], y: at[1], t: 0 };
    ctx.pressed = { start, samples: [first], at, time: 0 };
    cursorMark.hidden = false;
    showCursor();
    handlers.onStart(start);
    handlers.onSamples(start.id, [first]);
    handlers.onSettled?.(start.id);
    announce(t("draw.cursor.down"));
  };
  ctx.press = press;

  /// Spazio di nuovo, o Invio: il gesto finisce e scrive. Se non dice niente
  /// lui, si dice che il cursore è su.
  function release(): void {
    const g = ctx.pressed;
    if (g === null) return;
    ctx.pressed = null;
    showCursor();
    const before = live.textContent;
    handlers.onEnd({ ...g.start, samples: g.samples, tilt: false, split: false });
    if (live.textContent === before) announce(t("draw.cursor.up"));
  }
  ctx.release = release;

  /// Il gesto da tastiera non scrive niente.
  function cancelPress(): void {
    const g = ctx.pressed;
    if (g === null) return;
    ctx.pressed = null;
    showCursor();
    handlers.onCancel(g.start.id, "api");
  }
  ctx.cancelPress = cancelPress;

  // Il fuoco che lascia il foglio porta via il gesto e il cursore.
  life.listen(surface, "blur", () => {
    cancelPress();
    cursorMark.hidden = true;
  });
}
