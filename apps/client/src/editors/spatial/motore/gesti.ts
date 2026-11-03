// I gesti del disegno sul motore (K5): gli strumenti Selezione, Rettangolo,
// Ellisse, Linea e Freccia del profilo «vector» chiedono al motore del
// disegno che cosa fare, invece di farlo da sé.
//
// - **La penna di Fub guida.** I campioni arrivano dalla stessa pipeline di
//   ogni strumento (`ink/dom/pointer-adapter`, stabilizzati e senza il
//   palmo), in coordinate di scena: il primo diventa `down`, gli altri
//   `drag`, il rilascio `up`. Maiusc, Alt e Ctrl/⌘ sono quelli dell'evento
//   del puntatore in corso.
// - **Un fotogramma, una richiesta.** I campioni si accumulano; a ogni
//   fotogramma, se nessuna richiesta del gesto è in volo, partono gli eventi
//   nuovi come `preview`, e l'esito si disegna con i segni di oggi: la forma
//   sullo strato dell'anteprima (`showShape`), la selezione trasformata come
//   bozza del painter, il riquadro di selezione e le cornici. Una richiesta
//   porta al più `MAX_GESTURE_EVENTS` eventi: un gesto lungo si spezza.
// - **Un gesto, un passo.** Al rilascio parte `commit`: le operazioni
//   dell'esito passano una per una da `parseWireOp` e si applicano insieme
//   con `ctx.commit`, col nome dello strumento di oggi; i connettori che
//   seguono li aggiunge il seguito del motore della scena nello stesso passo
//   (`following` di `state.ts`). La selezione diventa quella dell'esito.
// - **Uno alla volta.** Un gesto parte dopo che l'esito del precedente è
//   stato applicato: la copia del motore lo ha già avuto, e la selezione di
//   partenza è quella di dopo.
// - **Il motore che si apre.** Se al primo gesto la sessione si sta ancora
//   aprendo, il gesto aspetta al più `ATTESA_APERTURA_MS`; poi non fa
//   niente. Un motore che smette di rispondere ferma il gesto, e i gesti
//   dopo tornano agli strumenti di oggi.
//
// La penna, l'evidenziatore, la gomma e la nota non passano mai di qua: sono
// di Fub, e non chiamano il motore.

import { MAX_GESTURE_EVENTS, type DrawingOutcome, type DrawingPointer, type DrawingRefusal, type DrawingTool } from "../../../host/contract";
import type { InkSample } from "../../../ink/sample";
import type { PaintNode } from "../painter/paint";
import { angleOf, frameSize, gripAt, type Frame } from "../tools/frame";
import { IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { parseWireOp, type Op, type Reason } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { plural, t, type DrawKey } from "../strings";
import { gesture as asGesture, transformedMatrix, transformValue } from "../tools/edit";
import { ADDED, DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX } from "../tools/editor/constants";
import type { EditorContext } from "../tools/editor/context";
import { layerRefusal, layerTitle } from "../tools/editor/helpers";
import type { GestureBase, MotoreGesture } from "../tools/editor/types";
import type { ToolId } from "../tools/registry";
import type { GestoMotore, MotoreAssente, SessioneMotore } from "./sessione";

/// Quanto un gesto aspetta il motore che si sta ancora aprendo.
export const ATTESA_APERTURA_MS = 2_000;

/// Gli strumenti del disegno che passano dal motore, col loro nome nel
/// contratto.
export const STRUMENTI_DEL_MOTORE: ReadonlyMap<ToolId, DrawingTool> = new Map<ToolId, DrawingTool>([
  ["select", "select"],
  ["rect", "rect"],
  ["ellipse", "ellipse"],
  ["line", "line"],
  ["arrow", "arrow"],
]);

/// Il motore del disegno come lo vede l'editor: la sessione, che può essere
/// ancora in apertura.
export interface MotoreDelDisegno {
  /// La sessione aperta; `"apertura"` finché si apre; `null` se il motore
  /// non c'è (spento, in errore, chiuso).
  adesso(): SessioneMotore | "apertura" | null;
  /// La sessione appena è aperta, aspettando al più `ms`; `null` se il
  /// motore non c'è o non si è aperto in tempo.
  pronta(ms: number): Promise<SessioneMotore | null>;
}

/// Il motore di un disegno aperto, per chi l'ha aperto: lo chiude.
export interface MotoreAperto extends MotoreDelDisegno {
  chiudi(): Promise<void>;
}

/// Il motore che `apertura` apre: `apriSessione` di `sessione.ts`.
export function motoreDa(apertura: Promise<SessioneMotore | MotoreAssente>): MotoreAperto {
  let stato: SessioneMotore | "apertura" | null = "apertura";
  let chiuso = false;
  const attese = new Set<() => void>();
  const sveglia = (): void => {
    const pronti = [...attese];
    attese.clear();
    for (const each of pronti) each();
  };
  void apertura.then(
    (aperta) => {
      if (aperta.kind === "sessione" && chiuso) void aperta.chiudi();
      stato = aperta.kind === "sessione" && !chiuso ? aperta : null;
      sveglia();
    },
    () => {
      stato = null;
      sveglia();
    },
  );
  const adesso = (): SessioneMotore | "apertura" | null => {
    if (stato !== null && stato !== "apertura" && stato.stato() !== "aperta") stato = null;
    return stato;
  };
  return {
    adesso,
    pronta(ms) {
      if (adesso() !== "apertura") return Promise.resolve(intera(adesso()));
      return new Promise((resolve) => {
        const fatto = (): void => {
          clearTimeout(timer);
          attese.delete(fatto);
          resolve(intera(adesso()));
        };
        const timer = setTimeout(() => {
          attese.delete(fatto);
          resolve(null);
        }, ms);
        attese.add(fatto);
      });
    },
    async chiudi() {
      if (chiuso) return;
      chiuso = true;
      const aperta = adesso();
      stato = null;
      sveglia();
      if (aperta !== null && aperta !== "apertura") await aperta.chiudi();
    },
  };
}

/// La sessione, se è aperta.
const intera = (stato: SessioneMotore | "apertura" | null): SessioneMotore | null => (stato === null || stato === "apertura" ? null : stato);

/// `events` a pezzi di al più `max`, nell'ordine: un pezzo per richiesta.
export function aPezzi<T>(events: readonly T[], max: number = MAX_GESTURE_EVENTS): T[][] {
  const pezzi: T[][] = [];
  for (let from = 0; from < events.length; from += max) pezzi.push(events.slice(from, from + max));
  return pezzi;
}

/// Le operazioni di un esito, ognuna passata da `parseWireOp`: l'array, o
/// perché non vale.
export function opsDellEsito(ops: string | null): { readonly ops: readonly Op[] } | { readonly reason: Reason; readonly detail: string } {
  if (ops === null) return { ops: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(ops);
  } catch {
    return { reason: "invalid-elem", detail: "le operazioni non sono JSON" };
  }
  if (!Array.isArray(parsed)) return { reason: "invalid-elem", detail: "le operazioni non sono un array" };
  const out: Op[] = [];
  for (const each of parsed) {
    const read = parseWireOp(each);
    if ("reason" in read) return read;
    out.push(read.op);
  }
  return { ops: out };
}

/// `value` come elemento della scena, se ne ha la forma; `null` altrimenti.
export function elemDi(value: unknown): Elem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tag !== "string" || record.tag === "") return null;
  const attrs = record.attrs;
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  if (!Object.values(attrs).every((each) => typeof each === "string")) return null;
  const children: Elem[] = [];
  if (record.children !== undefined) {
    if (!Array.isArray(record.children)) return null;
    for (const child of record.children) {
      const elem = elemDi(child);
      if (elem === null) return null;
      children.push(elem);
    }
  }
  if (record.text !== undefined && record.text !== null && typeof record.text !== "string") return null;
  return {
    tag: record.tag,
    attrs: attrs as Record<string, string>,
    ...(children.length > 0 ? { children } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
  };
}

/// Sei numeri finiti, o `null`.
function matriceDi(value: unknown): Matrix | null {
  if (!Array.isArray(value) || value.length !== 6 || !value.every((each) => typeof each === "number" && Number.isFinite(each))) return null;
  return value as unknown as Matrix;
}

/// Quattro numeri finiti, o `null`.
function riquadroDi(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((each) => typeof each === "number" && Number.isFinite(each))) return null;
  return value as unknown as readonly [number, number, number, number];
}

/// Il motivo a parole di un'operazione che non vale.
const MOTIVI: Partial<Record<Reason, DrawKey>> = { limit: "draw.reason.limit" };

/// Che cosa l'inizio, i campioni, la fine e l'annullo di un gesto sul motore
/// danno agli altri pezzi dell'editor.
export interface GestiMotoreContext {
  /// Il gesto sul motore dello strumento di adesso; `null` se lo strumento
  /// lo fa da sé: senza motore, sul foglio delle annotazioni, dentro un
  /// gruppo isolato, o con uno strumento che non passa dal motore.
  motoreBegin: (base: GestureBase) => MotoreGesture | null;
  motoreSamples: (g: MotoreGesture, samples: readonly InkSample[]) => void;
  motoreEnd: (g: MotoreGesture) => void;
  motoreCancel: (g: MotoreGesture) => void;
}

/// Ciò che il gesto tiene e gli altri pezzi non leggono.
interface Interno {
  /// La sessione e la richiesta di base, prese alla prima richiesta; la
  /// sessione è `null` se il motore non c'era.
  readonly avvio: Promise<{ readonly sessione: SessioneMotore; readonly base: Omit<GestoMotore, "phase" | "events"> } | null>;
  /// Le richieste del gesto, una dopo l'altra.
  catena: Promise<unknown>;
  /// Il primo punto, l'oggetto sotto di lui e la cornice di allora.
  from: Point | null;
  hit: string | null;
  frame: Frame | null;
}

/// Monta i gesti sul motore.
export function installGestiMotore(ctx: EditorContext): void {
  const porta = ctx.options.motore;
  const interni = new WeakMap<MotoreGesture, Interno>();
  /// L'esito dell'ultimo gesto applicato: il gesto dopo parte da lì.
  let ultimo: Promise<unknown> = Promise.resolve();

  const evento = (kind: DrawingPointer["kind"], sample: { readonly x: number; readonly y: number; readonly p?: number }): DrawingPointer => ({
    kind,
    x: sample.x,
    y: sample.y,
    pressure: kind === "up" ? 0 : (sample.p ?? 0.5),
    shift: ctx.shift,
    alt: ctx.alt,
    cmd: ctx.free,
  });

  /// La matrice del livello `layer`, o di dove andrebbe una forma nuova: le
  /// forme dell'anteprima stanno nelle sue coordinate.
  const layerMatrix = (layer: string | null): Matrix => {
    const found = layer === null ? undefined : ctx.currentIndex().layers.find((each) => each.id === layer);
    return found?.matrix ?? ctx.destinationNow()?.matrix ?? IDENTITY;
  };

  const motoreBegin = (base: GestureBase): MotoreGesture | null => {
    if (porta === undefined || ctx.folio !== undefined || ctx.isolatedNode() !== null) return null;
    const tool = STRUMENTI_DEL_MOTORE.get(ctx.tool);
    if (tool === undefined || porta.adesso() === null) return null;
    const layer = ctx.has("layers") ? (ctx.currentLayer()?.id ?? null) : null;
    const g: MotoreGesture = {
      ...base,
      kind: "motore",
      tool,
      pending: [],
      inFlight: false,
      sent: 0,
      last: null,
      frame: null,
      ended: false,
      intent: tool === "select" ? null : "shape",
      label: tool === "select" ? "draw.action.move" : ctx.toolLabel(ctx.tool),
      before: ctx.selection,
      layer,
      matrix: null,
      marquee: null,
      units: [],
      lines: null,
    };
    const precedente = ultimo;
    const shape = tool !== "select";
    // La richiesta di base si prende quando parte: dopo l'esito del gesto
    // di prima, con la selezione che ha lasciato.
    const avvio = precedente.then(() => porta.pronta(ATTESA_APERTURA_MS)).then((sessione) => {
      if (sessione === null || ctx.disposed) return null;
      g.before = ctx.selection;
      const { color, width } = ctx.style();
      return {
        sessione,
        base: {
          tool,
          layer,
          selection: [...ctx.selection],
          zoom: ctx.camera.scale,
          snap: { grid: ctx.gridOn() ? ctx.stepNow() : null, free: ctx.free },
          style: shape ? { stroke: color, width, fill: null } : null,
          text: null,
        },
      };
    });
    interni.set(g, { avvio, catena: avvio, from: null, hit: null, frame: null });
    return g;
  };
  ctx.motoreBegin = motoreBegin;

  /// Manda `events` nella fase `phase`, dopo le richieste già partite del
  /// gesto: l'esito, o `null` se non c'è (motore assente, sessione chiusa,
  /// gesto che non è partito).
  const send = (g: MotoreGesture, phase: GestoMotore["phase"], events: DrawingPointer[]): Promise<DrawingOutcome | null> => {
    const inner = interni.get(g)!;
    g.sent += events.length;
    const request = inner.catena.then(() => inner.avvio).then(async (started) => {
      if (started === null) return null;
      const outcome = await started.sessione.gesto({ ...started.base, phase, events });
      return outcome === null || "kind" in outcome ? null : outcome;
    }).catch((error: unknown): null => {
      console.error(error);
      return null;
    });
    inner.catena = request;
    return request;
  };

  /// Chiede il fotogramma che manderà gli eventi nuovi.
  const schedule = (g: MotoreGesture): void => {
    if (g.frame !== null || g.ended || ctx.disposed) return;
    g.frame = requestAnimationFrame(() => {
      g.frame = null;
      flushPreview(g);
    });
  };
  ctx.life.add(() => {
    const g = ctx.current;
    if (g?.kind === "motore" && g.frame !== null) cancelAnimationFrame(g.frame);
  });

  const flushPreview = (g: MotoreGesture): void => {
    if (g.ended || g.inFlight || g.pending.length === 0 || ctx.disposed) return;
    const events = g.pending.splice(0, MAX_GESTURE_EVENTS);
    g.inFlight = true;
    void send(g, "preview", events).then((outcome) => {
      g.inFlight = false;
      if (g.ended || ctx.disposed || ctx.current !== g) return;
      if (outcome !== null) showPreview(g, outcome);
      if (g.pending.length > 0) schedule(g);
    });
  };

  /// Il primo punto della Selezione: che cosa il gesto fa, per il nome del
  /// passo e per l'annuncio, come lo sceglie lo strumento di oggi.
  const firstPoint = (g: MotoreGesture, p: Point): void => {
    const inner = interni.get(g)!;
    inner.from = p;
    if (g.tool !== "select") return;
    const view = ctx.frameNow();
    const grip = view === null ? null : gripAt(view, p, ctx.camera.scale, g.pointer);
    inner.frame = view?.frame ?? null;
    if (grip !== null) {
      g.intent = grip === "rotate" ? "rotate" : "resize";
      g.label = grip === "rotate" ? "draw.action.rotate" : "draw.action.resize";
      return;
    }
    const hit = ctx.currentIndex().at(p, HIT_PX[g.pointer] / ctx.camera.scale);
    inner.hit = hit?.key ?? null;
    g.intent = hit === null ? "marquee" : "move";
    g.label = "draw.action.move";
  };

  const motoreSamples = (g: MotoreGesture, samples: readonly InkSample[]): void => {
    if (g.ended) return;
    for (const sample of samples) {
      const kind = g.last === null ? "down" : "drag";
      if (g.last === null) firstPoint(g, [sample.x, sample.y]);
      const event = evento(kind, sample);
      // Il puntatore che torna sul punto di prima, coi tasti di prima (il
      // rilascio arriva anche come campione), non dice niente di nuovo.
      const last = g.last;
      if (last !== null && last.x === event.x && last.y === event.y && last.shift === event.shift && last.alt === event.alt && last.cmd === event.cmd) continue;
      g.pending.push(event);
      g.last = event;
    }
    schedule(g);
  };
  ctx.motoreSamples = motoreSamples;

  /// L'anteprima di un esito: la forma, la selezione trasformata e il
  /// riquadro di selezione.
  const showPreview = (g: MotoreGesture, outcome: DrawingOutcome): void => {
    ctx.readFirst(() => {
      const preview = outcome.preview;
      if (outcome.selection.join("\n") !== ctx.selection.join("\n")) {
        ctx.selection = ctx.inOrder(outcome.selection);
        ctx.syncControls();
      }
      ctx.showShape(elemDi(preview?.shape ?? null), layerMatrix(g.layer));
      g.marquee = riquadroDi(preview?.marquee ?? null);
      g.matrix = matriceDi(preview?.matrix ?? null);
      if (g.matrix === null) {
        ctx.painter.setDraft(null);
      } else {
        if (g.units.length === 0) g.units = ctx.selectedUnits();
        const transforms = new Map<PaintNode, string | null>();
        const carried = new Map<object, Matrix>();
        for (const unit of g.units) {
          const next = transformedMatrix(unit, g.matrix);
          if (next === null) continue;
          const value = transformValue(next);
          for (const paint of unit.paints) transforms.set(paint, value);
          ctx.followImages(carried, unit, next);
        }
        const paths = ctx.followingDraft(g, g.matrix, transforms);
        ctx.painter.setDraft({ transforms, carried, paths });
      }
      ctx.showHandles();
    });
  };

  /// Via l'anteprima del gesto.
  const clearPreview = (g: MotoreGesture): void => {
    g.matrix = null;
    g.marquee = null;
    ctx.showShape(null, IDENTITY);
    ctx.painter.setDraft(null);
  };

  const motoreEnd = (g: MotoreGesture): void => {
    if (g.ended) return;
    g.ended = true;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    if (g.last !== null) g.pending.push(evento("up", g.last));
    const pezzi = aPezzi(g.pending.splice(0));
    // Gli eventi oltre il tetto di una richiesta partono prima, come
    // anteprime che non si disegnano.
    for (const pezzo of pezzi.slice(0, -1)) void send(g, "preview", pezzo);
    const outcome = send(g, "commit", pezzi[pezzi.length - 1] ?? []);
    const tap = tapOf(g);
    const done = outcome.then((esito) => {
      if (ctx.disposed) return;
      if (esito === null) {
        clearPreview(g);
        ctx.showHandles();
        return;
      }
      applyOutcome(g, esito, tap);
    });
    ultimo = done;
  };
  ctx.motoreEnd = motoreEnd;

  /// Un tocco della Selezione su un oggetto, senza trascinare: per il doppio
  /// tocco, che isola un gruppo come oggi.
  const tapOf = (g: MotoreGesture): { readonly key: string; readonly at: Point; readonly time: number } | null => {
    const inner = interni.get(g)!;
    if (g.tool !== "select" || g.intent !== "move" || inner.hit === null || inner.from === null || g.last === null || ctx.shift) return null;
    const moved = Math.hypot(g.last.x - inner.from[0], g.last.y - inner.from[1]) * ctx.camera.scale;
    return moved <= DRAG_PX[g.pointer] ? { key: inner.hit, at: inner.from, time: performance.now() } : null;
  };

  /// L'esito del rilascio: le operazioni in un passo, la selezione, e lo si
  /// dice.
  const applyOutcome = (g: MotoreGesture, outcome: DrawingOutcome, tap: ReturnType<typeof tapOf>): void => {
    clearPreview(g);
    if (outcome.refused !== null) {
      ctx.select(outcome.selection);
      refuse(g, outcome.refused);
      return;
    }
    const read = opsDellEsito(outcome.ops);
    if ("reason" in read) {
      console.error(`motore del disegno: un'operazione dell'esito non vale (${read.reason}): ${read.detail}`);
      ctx.select(g.before);
      ctx.announce(t("draw.rejected", { reason: t(MOTIVI[read.reason] ?? "draw.reason.invalid") }));
      return;
    }
    const inner = interni.get(g)!;
    if (read.ops.length > 0) {
      if (ctx.commit(g.label, asGesture(read.ops)) === null) {
        ctx.select(g.before);
        return;
      }
      ctx.lastTap = null;
      ctx.select(outcome.selection);
      ctx.announce(said(g, inner));
      return;
    }
    ctx.select(outcome.selection);
    if (g.tool !== "select") {
      ctx.showHandles();
      return;
    }
    if (doubleTap(g, tap)) return;
    ctx.announceSelection();
  };

  /// Il doppio tocco su un gruppo lo isola, come con lo strumento di oggi.
  const doubleTap = (g: MotoreGesture, tap: ReturnType<typeof tapOf>): boolean => {
    const previous = ctx.lastTap;
    ctx.lastTap = tap;
    if (tap === null || previous === null || previous.key !== tap.key || tap.time - previous.time > DOUBLE_TAP_MS) return false;
    const apart = Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * ctx.camera.scale;
    if (apart > DOUBLE_TAP_PX[g.pointer]) return false;
    const unit = ctx.currentIndex().get(tap.key);
    if (unit === null || !ctx.isolable(unit) || !ctx.isolate(unit, tap.at, g.pointer)) return false;
    ctx.lastTap = null;
    return true;
  };

  /// Che cosa si dice di un gesto che ha scritto.
  const said = (g: MotoreGesture, inner: Interno): string => {
    if (g.intent === "shape") return `${t(ADDED[g.tool as "rect" | "ellipse" | "line" | "arrow"])} ${ctx.objects()}`;
    const units = ctx.selectedUnits();
    const moved = plural(units.length, "draw.moved.one", "draw.moved.other");
    const after = g.intent === "resize" || g.intent === "rotate" ? ctx.frameOf(units) : null;
    if (after === null) return moved;
    if (g.intent === "resize") {
      const [width, height] = frameSize(after);
      return t("draw.resized", { width: ctx.lengthSpoken(width), height: ctx.lengthSpoken(height) });
    }
    const before = inner.frame === null ? 0 : angleOf(inner.frame.matrix);
    let turn = angleOf(after.matrix) - before;
    turn = ((((turn + 180) % 360) + 360) % 360) - 180;
    return t(turn > 0 ? "draw.rotated.clockwise" : "draw.rotated.counter", { angle: ctx.degreesText(Math.abs(turn)) });
  };

  /// Un gesto che il motore non ha fatto, detto come lo dicono gli
  /// strumenti di oggi (i testi del motore arrivano con T21).
  const refuse = (g: MotoreGesture, refused: DrawingRefusal): void => {
    ctx.showHandles();
    switch (refused) {
      case "empty":
        if (g.tool === "select") ctx.announceSelection();
        return;
      case "locked":
      case "hidden": {
        const layer = g.layer === null ? ctx.currentLayer() : (ctx.currentIndex().layers.find((each) => each.id === g.layer) ?? null);
        const key = layer === null ? null : layerRefusal(layer);
        if (layer === null || key === null) ctx.announce(t("draw.no_layer"));
        else ctx.announce(t(key, { name: layerTitle(layer) }));
        return;
      }
      case "unmapped":
      case "unsupported":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.foreign") }));
        return;
      case "too_large":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.limit") }));
        return;
      case "stale":
      case "closed":
      case "not_ready":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
        return;
    }
  };

  const motoreCancel = (g: MotoreGesture): void => {
    if (g.ended) return;
    g.ended = true;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    g.pending.length = 0;
    // Il motore lascia il gesto solo se ne ha visto qualcosa.
    if (g.sent > 0) void send(g, "cancel", []);
    clearPreview(g);
    if (g.before.join("\n") !== ctx.selection.join("\n")) ctx.select(g.before);
  };
  ctx.motoreCancel = motoreCancel;
}
