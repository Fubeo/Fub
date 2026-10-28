// L'editor del disegno: Riproduci (P12). Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.
//
// Il disegno si riscrive sul foglio coi tempi veri dei campioni (`../replay.ts`),
// a 1×, 2× o 4×: il pittore mostra i tratti che non sono ancora arrivati
// nascosti e quello in corso fino al campione di adesso. Il file non cambia.
// Un tocco, un tasto o la fine la chiudono; col movimento ridotto non parte, e
// si vede il disegno finito. Il tempo lo dà un orologio con owner, a passi di
// un fotogramma: la riproduzione non è inchiostro in corso, e DEC-26 vieta
// `requestAnimationFrame` soltanto a quello.

import type { Unit } from "../hit";
import { reducedMotion } from "../../../../theme/reduced-motion";
import type { PaintNode } from "../../painter/paint";
import { t } from "../../strings";
import { replayFrame, replayPlan, type ReplayPlan } from "../replay";
import type { EditorContext } from "./context";

/// Le velocità che si scelgono.
export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/// Ogni quanto si ridisegna, in millisecondi.
const REPLAY_STEP_MS = 16;

export interface ReplayContext {
  /// Vero mentre il disegno si riproduce.
  replaying: () => boolean;
  /// Riproduce il disegno a `speed`.
  replay: (speed: ReplaySpeed) => void;
  /// Ferma la riproduzione, e il disegno torna com'è.
  stopReplay: () => void;
}

export function installReplay(ctx: EditorContext): void {
  const { life, surface, painter, announce } = ctx;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: { plan: ReplayPlan; began: number; speed: ReplaySpeed } | null = null;

  /// I tratti di `units`, anche dentro i gruppi e i collegamenti.
  const strokesIn = (units: readonly Unit[]): Unit[] =>
    units.flatMap((unit) => (unit.role === "group" || unit.role === "link" ? strokesIn(ctx.currentIndex().children(unit)) : [unit]));

  const show = (): void => {
    if (running === null) return;
    const at = (performance.now() - running.began) * running.speed;
    const frame = replayFrame(running.plan, at);
    if (frame.done) {
      stopReplay();
      announce(t("draw.replay.done"));
      return;
    }
    const hidden = new Set<PaintNode>();
    for (const unit of frame.hidden) for (const paint of unit.paints) hidden.add(paint);
    const paths = new Map<PaintNode, string>();
    for (const [unit, d] of frame.partial) paths.set(unit.paints[0]!, d);
    painter.setDraft({ hidden, paths });
  };

  const stopReplay = (): void => {
    if (running === null) return;
    running = null;
    clearInterval(timer);
    timer = undefined;
    painter.setDraft(null);
    surface.removeAttribute("data-replaying");
  };
  ctx.stopReplay = stopReplay;

  const replay = (speed: ReplaySpeed): void => {
    stopReplay();
    ctx.cancelGesture();
    if (reducedMotion()) {
      announce(t("draw.replay.reduced"));
      return;
    }
    const plan = replayPlan(strokesIn(ctx.currentIndex().units));
    if (plan.strokes.length === 0) {
      announce(t("draw.replay.none"));
      return;
    }
    running = { plan, began: performance.now(), speed };
    surface.setAttribute("data-replaying", "");
    announce(t("draw.replay.started", { speed: String(speed) }));
    show();
    timer = setInterval(show, REPLAY_STEP_MS);
  };
  ctx.replay = replay;
  ctx.replaying = () => running !== null;

  // Un tocco o un tasto la fermano; il tasto non fa altro.
  life.listen(surface, "pointerdown", () => stopReplay(), { capture: true });
  life.listen(
    surface,
    "keydown",
    (event: KeyboardEvent) => {
      if (running === null) return;
      event.preventDefault();
      event.stopPropagation();
      stopReplay();
      announce(t("draw.replay.stopped"));
    },
    { capture: true },
  );
  life.add(() => clearInterval(timer));
}
