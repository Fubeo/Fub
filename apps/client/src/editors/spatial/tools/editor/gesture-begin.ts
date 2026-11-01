// L'editor del disegno: l'inizio di un gesto e «Penna e dita…». Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { StrokeStart } from "../../../../ink/input/session";
import { penLook } from "../../../../ink/pens";
import { INK_TOOLS } from "../../../../ink/tools/registry";
import { StrokePreview } from "../../../../ink/tools/stroke";
import { EraseSweep } from "../../../../ink/tools/sweep";
import { compose } from "../../scene/matrix";
import { touchDialog } from "../touch-dialog";
import { INK_KEY, inkCopyKey } from "./constants";
import type { EditorContext } from "./context";
import type { Gesture, GestureBase, InkGesture } from "./types";

/// Ciò che l'inizio del gesto dà agli altri pezzi dell'editor.
export interface GestureBeginContext {
  touchSettings: () => Promise<void>;
  begin: (start: StrokeStart) => Gesture;
  straightened: (g: InkGesture) => boolean;
  drawInk: (g: InkGesture) => void;
}

/// Monta l'inizio del gesto.
export function installGestureBegin(ctx: EditorContext): void {
  const {
    has, style, overlay, editable, newIds, cancelGesture, target
  } = ctx;

  /// «Penna e dita…»: i gesti delle dita e la curva della pressione della
  /// penna, di questo dispositivo. Valgono anche in sola lettura, come la
  /// griglia: sono della vista, non del disegno.
  async function touchSettings(): Promise<void> {
    if (ctx.asking || !has("gestures")) return;
    cancelGesture();
    ctx.asking = true;
    try {
      const answer = await touchDialog({
        twist: ctx.grid.twist,
        taps: ctx.grid.taps,
        pen: ctx.grid.pen,
        ...(ctx.grid.steady === undefined ? {} : { steady: ctx.grid.steady }),
        ...(ctx.grid.barrel === undefined ? {} : { barrel: ctx.grid.barrel }),
      });
      if (answer === null || ctx.disposed) return;
      ctx.changeGrid({ ...ctx.grid, ...answer });
    } finally {
      ctx.asking = false;
    }
  }
  ctx.touchSettings = touchSettings;

  /// Il gesto della gomma, con la gomma scelta.
  const eraseGesture = (base: GestureBase): Gesture => {
    const tool = INK_TOOLS.erase("eraser");
    return tool === undefined ? { ...base, kind: "refused" } : { ...base, kind: "erase", sweep: new EraseSweep(tool, base.pointer), path: [], radius: null, cuts: new Map() };
  };

  const begin = (start: StrokeStart): Gesture => {
    const base = { stroke: start.id, pointer: start.pointerType };
    // La penna girata cancella con qualunque strumento; il tasto laterale fa
    // ciò che chi disegna ha scelto in «Penna e dita». Il menu radiale lo
    // apre il suo ascolto (`curvature-tool.ts`), non il tratto.
    if (start.role !== "ink") {
      const action = start.role === "erase" ? "eraser" : (ctx.grid.barrel ?? "radial");
      if (!editable()) return { ...base, kind: "refused" };
      if (action === "eraser") return eraseGesture(base);
      return { ...base, kind: "refused" };
    }
    if (!editable()) return { ...base, kind: "refused" };
    // Il righello preso in mezzo si sposta, con ogni strumento (P13).
    const ruler = ctx.rulerStart(base);
    if (ruler !== null) return ruler;
    switch (ctx.tool) {
      // La Mano e la Lente muovono la vista prima della pipeline
      // (`hand-zoom.ts`): il cursore da tastiera non disegna niente.
      case "hand":
      case "zoom":
        return { ...base, kind: "refused" };
      case "pen":
      case "highlighter": {
        // Che cosa fa lo strumento lo dice il registro dell'inchiostro
        // (`ink/tools`): la ricetta del pennello, la simmetria, la forma
        // tenendo fermo il tratto.
        const tool = INK_TOOLS.stroke(ctx.tool);
        if (tool === undefined) return { ...base, kind: "refused" };
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        const brush = tool.brush(width, { pressure: start.pressure, continued: start.continued }, ctx.penId);
        const edge = ctx.rulerEdgeAt(base.pointer, brush, to);
        return {
          ...base,
          kind: "ink",
          tool: ctx.tool,
          color,
          brush,
          opacity: ctx.inkOpacity[ctx.tool],
          to,
          ids,
          scene: [],
          local: [],
          predicted: [],
          preview: new StrokePreview(brush),
          began: start.timeStamp,
          // Un tratto lungo il righello è già una linea: non diventa una forma.
          holds: tool.capabilities.holdsToShape && start.id >= 0 && !start.continued && edge === null,
          still: null,
          held: null,
          copies: [],
          straight: false,
          ruler: edge,
        };
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
      case "cover": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return { ...base, kind: "refused" };
        const { color, width } = style();
        return { ...base, kind: "shape", tool: ctx.tool, color, width, to, ids, from: null, end: null };
      }
      case "eraser":
        return eraseGesture(base);
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
          matrix: null,
          angle: 0,
          lines: null,
        };
    }
  };
  ctx.begin = begin;

  /// Con lo strumento che lo prevede (penna, evidenziatore) e Maiusc, il
  /// tratto va dritto dal primo punto all'ultimo, a passi di 15°; lasciato
  /// Maiusc, resta dritto fino al rilascio.
  const straightened = (g: InkGesture): boolean =>
    (g.straight ||= ctx.shift && INK_TOOLS.stroke(g.tool)?.capabilities.straightWithModifier === true);
  ctx.straightened = straightened;

  const drawInk = (g: InkGesture): void => {
    const outline = g.preview.outline(g.local, g.predicted, straightened(g));
    const opacity = penLook(g.brush, g.tool).opacity * g.opacity;
    const ink = outline.length === 0 ? null : { outline, matrix: g.to.matrix, color: g.color, opacity };
    overlay.setInk(INK_KEY, ink);
    // Le copie in simmetria: lo stesso contorno, portato nella scena.
    g.copies.forEach((m, k) => overlay.setInk(inkCopyKey(k), ink === null ? null : { ...ink, matrix: compose(m, g.to.matrix) }));
    ctx.inkCopies = Math.max(ctx.inkCopies, g.copies.length);
    overlay.flush();
  };
  ctx.drawInk = drawInk;
}
