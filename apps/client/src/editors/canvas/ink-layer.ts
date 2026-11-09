// Lo strato d'inchiostro della lavagna: la penna sopra le schede.
//
// Prende la penna sul viewport con l'adattatore del browser
// (`ink/dom/pointer-adapter.ts`), disegna la scia del tratto in corso e
// consegna il tratto finito a chi lo scrive (`onStroke`). Non conosce il
// formato né le schede: i campioni arrivano in coordinate della lavagna
// (`toWorld`) e il resto lo decide la lavagna.
//
// - **Chi ferma l'evento.** L'adattatore ascolta in cattura sul viewport; un
//   secondo ascoltatore in cattura, registrato dopo di lui, legge il ruolo che
//   la sessione ha appena dato al puntatore. Se scrive o cancella (`ink`,
//   `erase`, `barrel`), o se è una penna, l'evento si ferma lì (`stopImmediatePropagation`, che
//   vale anche quando il bersaglio è il viewport stesso) e il suo default no:
//   la lavagna non seleziona, non sposta, non prende il fuoco e non seleziona
//   testo, e la penna scrive anche sulla testata, sulla maniglia o su un campo
//   in modifica, che resta com'è. Il `click` e il `dblclick` fatti col
//   puntatore dopo un tratto, fino al `pointerdown` seguente, si fermano allo
//   stesso modo: il doppio tocco della penna non crea una scheda. Il dito è
//   `navigate` e il mouse `ignore`, finché la lavagna non lo fa scrivere
//   (`setMouse("ink")`): i loro eventi arrivano alla lavagna.
// - **La scia.** Un SVG `canvas-ink-wet` nel viewport, fuori dallo
//   stage, con la trasformazione della camera (`setCamera`); un percorso per
//   tratto, rifatto con `StrokePreview` una volta per evento (`onSettled`).
//   Alla fine del tratto la scia resta finché `settle(id)` non la toglie, nello
//   stesso giro in cui la lavagna aggiunge l'asciutto: niente buchi fra i due.
//   Un tratto annullato toglie subito la sua scia.
// - **Il silenzio della penna.** Ogni tratto chiama `quiet.enter()` quando
//   comincia e `quiet.leave()` una volta sola quando finisce o si annulla.

import { attachInkInput, type InkInput, type ScenePoint } from "../../ink/dom/pointer-adapter";
import type { InkBrush } from "../../ink/brush";
import type { InkPointerType } from "../../ink/input/pointer";
import { strokes, type MousePolicy, type PointerRole } from "../../ink/input/roles";
import type { CancelReason, FinishedStroke } from "../../ink/input/session";
import { penLook } from "../../ink/pens";
import { outlinePath } from "../../ink/pf1";
import type { PenQuiet } from "../../ink/quiet";
import type { InkSample } from "../../ink/sample";
import { StrokePreview } from "../../ink/tools/stroke";
import type { StrokeInput } from "../../ink/tools/tool";
import { openLifetime, type Lifetime } from "../../ui/lifetime";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Come scrive la penna in un tratto: pennello, colore e strumento.
export interface InkLook {
  readonly brush: InkBrush;
  /// Il colore del file, che va nell'attributo `fill`.
  readonly color: string;
  /// L'id dello strumento (`pen`, `highlighter`…).
  readonly tool: string;
}

/// Un tratto finito, in coordinate della lavagna, con il suo aspetto.
export interface InkLayerStroke extends FinishedStroke {
  readonly brush: InkBrush;
  readonly color: string;
  readonly tool: string;
}

export interface InkLayerOptions {
  /// L'elemento che riceve la penna e ospita la scia.
  readonly viewport: HTMLElement;
  /// Da coordinate del client a coordinate della lavagna, con la camera di
  /// adesso.
  readonly toWorld: (clientX: number, clientY: number) => ScenePoint;
  /// L'aspetto del tratto che comincia: si legge una volta, all'inizio.
  readonly look: (input: StrokeInput) => InkLook;
  /// La punta (e il mouse che scrive) cancella invece di scrivere: lo
  /// strumento Gomma del menu della penna. Si legge all'inizio di ogni
  /// tratto; il retro della penna e il tasto laterale cancellano sempre.
  readonly tipErases?: () => boolean;
  readonly quiet: PenQuiet;
  /// Un tratto della punta è finito: la scia resta finché non si chiama
  /// `settle(id)`. Un tratto spezzato al limite dei campioni arriva a pezzi,
  /// uno per id (`split`, `continued`).
  readonly onStroke: (stroke: InkLayerStroke) => void;
  /// Un tratto, della punta o della gomma, non c'è più: niente si scrive.
  readonly onCancel?: (id: number, reason: CancelReason) => void;
  /// Comincia una passata di gomma (retro della penna o tasto laterale), col
  /// tipo del puntatore che la fa: prima di ogni suo `onErase`.
  readonly onEraseStart?: (id: number, pointerType: InkPointerType) => void;
  /// Punti nuovi di una passata di gomma (retro della penna o tasto
  /// laterale), in coordinate della lavagna.
  readonly onErase?: (id: number, points: readonly InkSample[]) => void;
  /// La passata di gomma `id` è finita.
  readonly onEraseEnd?: (id: number) => void;
  /// Che cosa fa il tasto principale del mouse quando lo strato nasce
  /// (default `ignore`: il mouse resta alla lavagna).
  readonly mouse?: MousePolicy;
}

export interface InkLayer {
  /// La camera della lavagna: la scia la segue, anche durante un tratto.
  setCamera(x: number, y: number, zoom: number): void;
  /// Toglie la scia del tratto finito `id`. Su un id che non ha scia non fa
  /// niente.
  settle(id: number): void;
  /// Un tratto è in corso.
  readonly drawing: boolean;
  /// Il ruolo che la sessione dà adesso al puntatore giù `pointerId`, `null`
  /// se non lo conosce: un dito `ignore` è il palmo (`ink/input/roles.ts`).
  /// Solo lettura: la lavagna lo usa per non muoversi col palmo.
  roleOf(pointerId: number): PointerRole | null;
  /// Che cosa fa il tasto principale del mouse dal prossimo appoggio: `ink`
  /// scrive, `ignore` lo lascia alla lavagna. Un tratto già giù finisce com'è.
  setMouse(policy: MousePolicy): void;
  /// Annulla il tratto in corso.
  cancel(): void;
  /// Annulla il tratto in corso, toglie la scia e ogni ascoltatore.
  /// Idempotente; lo fa anche la chiusura di `owner`.
  destroy(): void;
}

/// Un tratto aperto o finito che ha ancora la sua scia.
interface Trail {
  readonly kind: "ink" | "erase";
  /// L'aspetto e l'anteprima, solo per la punta e finché il tratto è aperto.
  look: InkLook | null;
  preview: StrokePreview | null;
  samples: InkSample[];
  predicted: readonly InkSample[];
  path: SVGPathElement | null;
  /// Il tratto non ha ancora avuto né fine né annullamento.
  open: boolean;
  /// Il tratto ha chiamato `quiet.enter()` e non ancora `quiet.leave()`.
  quiet: boolean;
}

/// Monta lo strato su `options.viewport`. Vive finché `owner` non si chiude o
/// finché non si chiama `destroy`.
export function mountInkLayer(options: InkLayerOptions, owner: Lifetime): InkLayer {
  const { viewport, quiet } = options;
  const life = openLifetime();
  const trails = new Map<number, Trail>();
  let zoom = 1;
  let destroyed = false;
  /// L'ultimo `pointerdown` era di un puntatore che scrive o cancella: i
  /// `click` e `dblclick` che seguono sono suoi.
  let swallow = false;

  const wet = document.createElementNS(SVG_NS, "svg");
  wet.setAttribute("class", "canvas-ink-wet");
  wet.setAttribute("aria-hidden", "true");
  viewport.append(wet);

  function leave(trail: Trail): void {
    if (!trail.quiet) return;
    trail.quiet = false;
    quiet.leave();
  }

  function drop(id: number): void {
    const trail = trails.get(id);
    if (!trail) return;
    trails.delete(id);
    trail.path?.remove();
  }

  function paint(id: number): void {
    const trail = trails.get(id);
    if (!trail || !trail.preview || !trail.look) return;
    const outline = trail.preview.outline(trail.samples, trail.predicted, false);
    const d = outline.length > 2 ? outlinePath(outline) : "";
    if (!trail.path) {
      trail.path = document.createElementNS(SVG_NS, "path");
      trail.path.setAttribute("fill", trail.look.color);
      // Trasparente come l'asciutto, senza `multiply` (A22).
      const covers = penLook(trail.look.brush, trail.look.tool).opacity;
      if (covers < 1) trail.path.setAttribute("fill-opacity", String(covers));
      wet.append(trail.path);
    }
    trail.path.setAttribute("d", d);
  }

  const input: InkInput = attachInkInput(viewport, {
    toScene: (clientX, clientY) => options.toWorld(clientX, clientY),
    touch: "navigate",
    mouse: options.mouse ?? "ignore",
    scale: () => zoom,
    onStart: (stroke) => {
      const trail: Trail = {
        kind: stroke.role === "ink" && !(options.tipErases?.() ?? false) ? "ink" : "erase",
        look: null,
        preview: null,
        samples: [],
        predicted: [],
        path: null,
        open: true,
        quiet: true,
      };
      // Prima il conto, poi l'aspetto: se `look` lancia, la fine o
      // l'annullamento che arrivano comunque chiudono il conto.
      trails.set(stroke.id, trail);
      quiet.enter();
      if (trail.kind === "erase") {
        options.onEraseStart?.(stroke.id, stroke.pointerType);
      } else {
        trail.look = options.look({ pressure: stroke.pressure, continued: stroke.continued });
        trail.preview = new StrokePreview(trail.look.brush);
      }
    },
    onSamples: (id, samples) => {
      const trail = trails.get(id);
      if (!trail) return;
      if (trail.kind === "erase") options.onErase?.(id, samples);
      else trail.samples.push(...samples);
    },
    onPredicted: (id, samples) => {
      const trail = trails.get(id);
      if (trail && trail.kind === "ink") trail.predicted = samples;
    },
    onSettled: (id) => paint(id),
    onEnd: (stroke) => {
      const trail = trails.get(stroke.id);
      if (!trail) return;
      const look = trail.look;
      // La scia resta, ma ciò che serviva a disegnarla no.
      trail.open = false;
      trail.look = null;
      trail.preview = null;
      trail.samples = [];
      trail.predicted = [];
      try {
        if (trail.kind === "erase") {
          drop(stroke.id);
          options.onEraseEnd?.(stroke.id);
        } else if (look) {
          options.onStroke({ ...stroke, brush: look.brush, color: look.color, tool: look.tool });
        } else {
          drop(stroke.id);
        }
      } catch (error) {
        // Chi scrive non ha preso il tratto: nessuno toglierà la sua scia.
        drop(stroke.id);
        throw error;
      } finally {
        leave(trail);
      }
    },
    onCancel: (id, reason) => {
      const trail = trails.get(id);
      if (!trail) return;
      drop(id);
      try {
        options.onCancel?.(id, reason);
      } finally {
        leave(trail);
      }
    },
  }, life);

  /// Ferma un evento della penna prima della lavagna, anche sul viewport stesso.
  function stop(event: Event): void {
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  // Dopo l'adattatore: il ruolo del puntatore è già deciso.
  life.listen(viewport, "pointerdown", (event) => {
    const role = input.roleOf(event.pointerId);
    // La penna non tocca mai la lavagna, nemmeno quando la sessione la ignora
    // (un secondo tratto mentre uno è in corso, un tasto che non conosce).
    swallow = event.pointerType === "pen" || (role !== null && strokes(role));
    if (swallow) stop(event);
  }, { capture: true });
  // Un `click` della tastiera (`detail` 0) non è della penna e passa.
  const afterStroke = (event: MouseEvent): void => {
    if (swallow && event.detail > 0) stop(event);
  };
  life.listen(viewport, "click", afterStroke, { capture: true });
  life.listen(viewport, "dblclick", afterStroke, { capture: true });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    // Prima l'adattatore: il tratto aperto si annulla e chiude il suo conto.
    input.destroy();
    life.close();
    for (const trail of trails.values()) leave(trail);
    trails.clear();
    wet.remove();
  }
  owner.add(destroy);

  return {
    setCamera(x, y, nextZoom) {
      zoom = nextZoom;
      wet.style.transform = `translate(${x}px, ${y}px) scale(${nextZoom})`;
    },
    settle(id) {
      const trail = trails.get(id);
      // Un tratto ancora aperto tiene la sua scia.
      if (trail && !trail.open) drop(id);
    },
    get drawing() {
      return input.drawing;
    },
    roleOf(pointerId) {
      return destroyed ? null : input.roleOf(pointerId);
    },
    setMouse(policy) {
      if (!destroyed) input.setMousePolicy(policy);
    },
    cancel() {
      if (!destroyed) input.cancel();
    },
    destroy,
  };
}
