// L'editor del disegno: ricalcare e ritagliare le immagini. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { MenuItem } from "../../../../ui/menu";
import type { InkPointerType } from "../../pen/pen-input";
import type { Bounds } from "../../scene/geometry";
import { apply, IDENTITY, invert, type Matrix, type Point } from "../../scene/matrix";
import { elementsIn } from "../../scene/model";
import { MAX_EDIT_BYTES, MAX_ELEMENTS } from "../../scene/read";
import { utf8Length } from "../../scene/text";
import { MAX_VALUE_BYTES } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { href as parseHref } from "../../scene/values";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { evaluate, lengthUnits, type QuantityProblem } from "../quantity";
import { resourceHome } from "../resources";
import { effectsState } from "../effects";
import { gripCursor, type GripCursor } from "../frame";
import type { BooleanKind } from "../boolean";
import { combineOps, isShape, type Refused } from "../combine";
import { unitSuffix } from "../guide-dialog";
import { fieldText, fromUnit, toUnit } from "../rulers";
import { toScreen } from "../../view";
import type { Unit } from "../hit";
import { dataBlob } from "../images";
import { inkShapeOps, isPenStroke } from "../inkshape";
import {
  cropOps,
  croppedImages,
  cropState,
  dragCrop,
  marginsOf,
  MIN_CROP,
  slideImage,
  uncropOps,
  withMargins,
  type Crop,
  type CropHandle,
  type Margins,
} from "../crop";
import { imageWindow, traceOps, tracedGroup, traceSource, weightOf } from "../trace-ops";
import { inlineTracer, workerTracer, type TracerFactory } from "../trace-runner";
import { MAX_SHAPES, TRACE_PRESETS, type TracePreset, type TraceSettings } from "../trace-settings";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import { holdsPath, insideBounds, scaleOf } from "./helpers";
import type { CropGesture, Tracing } from "./types";

/// I pixel di un'immagine che «Ricalca immagine» legge, al più: quattro
/// volte quelli su cui lavora il ricalco, che li rimpicciolisce con la
/// media dei pixel, meglio del browser.
const TRACE_PIXELS = 8_000_000;

/// Chi ricalca se chi monta l'editor non lo dice: un worker e, dove non
/// ce ne sono, la pagina, col ricalco caricato quando serve.
const defaultTracer: TracerFactory = (raster) =>
  typeof Worker === "function"
    ? workerTracer(raster, () => new Worker(new URL("../trace-worker.ts", import.meta.url), { type: "module" }))
    : inlineTracer(raster, () => import("../trace"));

/// Il lato più corto di un ritaglio mentre lo si tira, in pixel.
const CROP_MIN_PX = 4;

/// L'asse di ogni margine del ritaglio: 0 orizzontale, 1 verticale.
const CROP_AXES: Readonly<Record<keyof Margins, 0 | 1>> = { top: 1, right: 0, bottom: 1, left: 0 };

/// Vero se `a` e `b` sono lo stesso riquadro.
function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.min[0] === b.min[0] && a.min[1] === b.min[1] && a.max[0] === b.max[0] && a.max[1] === b.max[1];
}

/// La distanza di `p` dal segmento da `a` a `b`.
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/// Le operazioni booleane, nell'ordine del menu: il nome della voce e quello
/// del passo di annulla.
const BOOLEANS: ReadonlyArray<{ readonly kind: BooleanKind; readonly label: DrawKey; readonly action: DrawKey }> = [
  { kind: "union", label: "draw.boolean.union", action: "draw.action.union" },
  { kind: "difference", label: "draw.boolean.difference", action: "draw.action.difference" },
  { kind: "intersection", label: "draw.boolean.intersection", action: "draw.action.intersection" },
  { kind: "exclusion", label: "draw.boolean.exclusion", action: "draw.action.exclusion" },
  { kind: "division", label: "draw.boolean.division", action: "draw.action.division" },
];

/// Che cosa si dice quando un'operazione booleana non si fa.
const REFUSALS: Readonly<Record<Exclude<Refused["reason"], "not_shapes">, DrawKey>> = {
  few: "draw.boolean.few",
  empty: "draw.boolean.empty",
  whole: "draw.boolean.whole",
  foreign: "draw.boolean.foreign",
  failed: "draw.boolean.failed",
};

/// Ciò che ricalcare e ritagliare le immagini dà agli altri pezzi dell'editor.
export interface ImageCommandsContext {
  openTracing: () => Promise<void>;
  showTracing: () => void;
  syncTracing: () => void;
  closeTracing: () => void;
  openCrop: (focus: boolean) => void;
  closeCrop: () => void;
  cancelCrop: () => void;
  applyCrop: (quiet?: boolean) => void;
  settleCrop: () => (key: string) => string;
  syncCrop: () => void;
  showCrop: () => void;
  showCropBar: (all?: boolean) => void;
  cropHandles: () => OverlayHandle[];
  cropCursor: (p: Point, pointer: InkPointerType) => GripCursor | "move" | null;
  cropStart: (g: CropGesture, p: Point) => void;
  cropUpdate: (g: CropGesture) => void;
  cropEnd: (g: CropGesture, time: number) => void;
  slideCrop: (x: number, y: number) => void;
  uncropSelection: () => void;
  holdsPenStroke: (unit: Unit) => boolean;
  shapeSelectedInk: () => void;
  booleanItems: () => MenuItem[];
}

/// Monta ricalcare e ritagliare le immagini.
export function installImageCommands(ctx: EditorContext): void {
  const {
    life, has, surface, traceBar, presetSelect, thresholdRange, colorsRange, detailRange, whiteInput, whiteField, traceStatus, traceApply, traceCancel,
    settingsLast, cropBar, cropSides, cropStatus, cropApply, cropCancel, painter, editable, currentIndex, newIds, announce, docUnit, lengthSpoken,
    selectedUnits, measuresText, showGrip, showHandles, closeDescriptions, select, setTool, cancelGesture, arranging, arrange, closePaths, options
  } = ctx;
  // --- Ricalca immagine ----------------------------------------------------------

  /// «Ricalca immagine…»: la barra si apre sull'immagine scelta da sola, ne
  /// legge i pixel che si vedono e la ricalca, col tipo e i valori
  /// dell'ultima volta.
  async function openTracing(): Promise<void> {
    const units = arranging("trace");
    if (units === null) return;
    const unit = units.length === 1 && units[0]!.role === "image" ? units[0]! : null;
    const source = unit === null ? null : traceSource(unit.node);
    if (unit === null || source === null) {
      announce(t("draw.trace_image.none"));
      return;
    }
    const kind = parseHref(source.href).kind;
    if (kind === "remote") {
      announce(t("draw.trace_image.remote"));
      return;
    }
    if (ctx.codec === null || (kind !== "vault" && kind !== "data")) {
      announce(t("draw.image.unreadable"));
      return;
    }
    closePaths();
    closeDescriptions();
    closeTracing();
    const now: Tracing = { key: unit.key, source, loaded: ctx.loads, ready: null, presets: 0, settled: 0, asked: 0, answered: 0, shown: null, applying: false, failed: false };
    ctx.tracing = now;
    presetSelect.value = ctx.presetLast;
    showTracing();
    presetSelect.focus({ preventScroll: true });
    const gone = (): boolean => ctx.tracing !== now;
    const port = options.images;
    const blob = kind === "data" ? dataBlob(source.href) : port === undefined ? null : await port.read(source.href).catch(() => null);
    if (gone()) return;
    const decoded = blob === null ? null : await ctx.codec.decode(blob).catch(() => null);
    if (gone()) {
      decoded?.close();
      return;
    }
    let seen: ReturnType<typeof imageWindow> = null;
    let pixels: ImageData | null = null;
    if (decoded !== null) {
      try {
        seen = imageWindow(source.box, source.aspect, [decoded.width, decoded.height]);
        pixels = seen === null ? null : decoded.pixels?.(seen.pixels, TRACE_PIXELS) ?? null;
      } finally {
        decoded.close();
      }
    }
    if (seen === null || pixels === null) {
      closeTracing();
      // Un file del vault che non si apre forse non c'è più; un data URI
      // che non si legge non è un'immagine che il disegno sa leggere.
      announce(t(blob === null && kind === "vault" ? "draw.image.gone" : "draw.image.unreadable"));
      return;
    }
    now.ready = { tracer: (options.tracer ?? defaultTracer)({ width: pixels.width, height: pixels.height, data: pixels.data }), target: seen.target };
    showTracing();
    await loadPreset(now);
  }
  ctx.openTracing = openTracing;

  /// Le impostazioni del tipo scelto, quelle pronte per l'immagine coi
  /// valori dell'ultima volta; poi il ricalco. Un tipo scelto nel frattempo
  /// vince.
  async function loadPreset(now: Tracing): Promise<void> {
    const ready = now.ready;
    if (ready === null) return;
    const preset = presetNow();
    const asked = ++now.presets;
    showTracing();
    let settings: TraceSettings;
    try {
      settings = await ready.tracer.settings(preset);
    } catch {
      if (ctx.tracing !== now) return;
      closeTracing();
      announce(t("draw.trace_image.failed"));
      return;
    }
    if (ctx.tracing !== now || asked !== now.presets) return;
    now.settled = asked;
    const last = settingsLast.get(preset);
    showSettings(last === undefined ? settings : { ...last, threshold: preset === "bw" ? settings.threshold : last.threshold });
    traceNow();
  }

  /// Il tipo scelto nella barra.
  function presetNow(): TracePreset {
    return TRACE_PRESETS.find((preset) => preset === presetSelect.value) ?? "colors";
  }

  /// Le impostazioni scritte nella barra.
  function settingsNow(): TraceSettings {
    return {
      preset: presetNow(),
      threshold: Number(thresholdRange.input.value),
      colors: Number(colorsRange.input.value),
      detail: Number(detailRange.input.value),
      ignoreWhite: whiteInput.checked,
    };
  }

  /// Scrive `settings` nella barra.
  function showSettings(settings: TraceSettings): void {
    presetSelect.value = settings.preset;
    thresholdRange.input.value = String(Math.round(settings.threshold));
    colorsRange.input.value = String(settings.colors);
    detailRange.input.value = String(settings.detail);
    whiteInput.checked = settings.ignoreWhite;
    for (const range of [thresholdRange, colorsRange, detailRange]) range.show();
    showTracing();
  }

  /// Chiede il ricalco coi valori della barra: quando arriva, lo mostrano
  /// l'anteprima e la barra. Uno superato da un altro già arrivato non
  /// conta.
  function traceNow(): void {
    const now = ctx.tracing;
    const ready = now?.ready ?? null;
    // Le impostazioni di un tipo appena scelto ricalcano quando arrivano.
    if (now === null || ready === null || now.settled < now.presets) return;
    const asked = ++now.asked;
    now.failed = false;
    showTracing();
    ready.tracer.trace(settingsNow()).then(
      (traced) => {
        if (ctx.tracing !== now || traced === null || asked <= now.answered) return;
        const unit = currentIndex().get(now.key);
        if (unit === null) return;
        now.answered = asked;
        now.shown = { traced, group: tracedGroup(unit.node, traced, ready.target, null) };
        coverTracing();
        showTracing();
        if (now.applying && asked === now.asked) applyTracing();
      },
      () => {
        if (ctx.tracing !== now || asked !== now.asked) return;
        now.answered = asked;
        now.failed = true;
        now.applying = false;
        showTracing();
      },
    );
  }

  /// La barra com'è adesso: i campi del tipo scelto, spenti finché
  /// l'immagine si legge o finché arrivano le impostazioni del tipo, che li
  /// riscrivono; e ciò che il ricalco ha trovato.
  function showTracing(): void {
    const now = ctx.tracing;
    traceBar.hidden = now === null;
    if (now === null) return;
    const preset = presetNow();
    const ink = preset === "bw" || preset === "sketch";
    thresholdRange.field.hidden = !ink;
    colorsRange.field.hidden = ink;
    whiteField.hidden = ink;
    for (const control of [thresholdRange.input, colorsRange.input, detailRange.input, whiteInput]) control.disabled = now.ready === null || now.settled < now.presets;
    traceStatus.textContent = tracingStatus(now);
  }
  ctx.showTracing = showTracing;

  /// Ciò che dice la barra: che si legge o si ricalca, o che cosa ha
  /// trovato il ricalco, e se il disegno non lo regge.
  function tracingStatus(now: Tracing): string {
    if (now.ready === null) return t("draw.trace_image.reading");
    if (now.failed) return t("draw.trace_image.failed");
    if (now.shown === null || now.settled < now.presets || now.answered < now.asked) return t("draw.trace_image.working");
    const { traced, group } = now.shown;
    if (traced.shapes.length === 0) return t("draw.trace_image.empty");
    const found = t("draw.trace_image.result", {
      shapes: plural(traced.shapes.length, "draw.trace_image.shapes.one", "draw.trace_image.shapes.other"),
      nodes: plural(traced.nodes, "draw.trace_image.nodes.one", "draw.trace_image.nodes.other"),
      tints: plural(traced.colors, "draw.trace_image.tints.one", "draw.trace_image.tints.other"),
    });
    const capped = traced.shapes.length >= MAX_SHAPES ? [t("draw.trace_image.capped", { count: MAX_SHAPES })] : [];
    const problem = traceProblem(group);
    return [found, ...capped, ...(problem === null ? [] : [problem])].join(" ");
  }

  /// Perché il gruppo `group` non entra nel disegno; `null` se entra.
  function traceProblem(group: Elem): string | null {
    const model = ctx.engine.model;
    const weight = weightOf(group);
    if (weight.longest > MAX_VALUE_BYTES) return t("draw.trace_image.intricate");
    if (utf8Length(ctx.engine.text) + weight.bytes > MAX_EDIT_BYTES) return t("draw.trace_image.heavy", { limit: ctx.sizeText(MAX_EDIT_BYTES) });
    if (model !== null && elementsIn(model.root) + weight.elements > MAX_ELEMENTS) return t("draw.trace_image.crowded", { count: MAX_ELEMENTS });
    return null;
  }

  /// Al posto dell'immagine il gruppo dell'ultimo ricalco, o l'immagine se
  /// non ce n'è; il painter cambia solo se è cambiato.
  function coverTracing(): void {
    const now = ctx.tracing;
    const unit = now === null ? null : currentIndex().get(now.key);
    const group = now?.shown?.group ?? null;
    const next = unit === null || group === null ? null : { paints: unit.paints, group };
    if (next?.paints === ctx.covered?.paints && next?.group === ctx.covered?.group) return;
    ctx.covered = next;
    painter.setCovers(next === null ? null : new Map(next.paints.map((paint) => [paint, next.group])));
  }

  /// Dopo ogni cambio: la barra si chiude se il livello o il documento non
  /// la vogliono più, se l'immagine non è più scelta da sola, o se cambia
  /// che cosa se ne vede. Una trasformazione no: l'anteprima la segue.
  function syncTracing(): void {
    const now = ctx.tracing;
    if (now === null) return;
    const unit = currentIndex().get(now.key);
    const source = unit === null ? null : traceSource(unit.node);
    const same = source !== null
      && source.href === now.source.href
      && source.aspect === now.source.aspect
      && [0, 1].every((axis) => source.box.min[axis] === now.source.box.min[axis] && source.box.max[axis] === now.source.box.max[axis]);
    if (!has("trace") || !editable() || ctx.loads !== now.loaded || ctx.selection.length !== 1 || ctx.selection[0] !== now.key || !same) {
      closeTracing();
      return;
    }
    coverTracing();
    showTracing();
  }
  ctx.syncTracing = syncTracing;

  /// Chiude la barra e toglie l'anteprima; il ricalco in corso si ferma, e
  /// il fuoco, se era nella barra, torna al foglio.
  function closeTracing(): void {
    const now = ctx.tracing;
    if (now === null) return;
    const focused = traceBar.contains(document.activeElement);
    ctx.tracing = null;
    now.ready?.tracer.dispose();
    traceBar.hidden = true;
    coverTracing();
    if (focused) surface.focus({ preventScroll: true });
  }
  ctx.closeTracing = closeTracing;

  /// «Applica» e Invio: il ricalco si scrive, in un passo di annulla, e la
  /// barra si chiude. Se l'ultimo ricalco non è ancora arrivato, lo
  /// aspetta; se non c'è niente da scrivere, la barra resta e dice perché.
  function applyTracing(): void {
    const now = ctx.tracing;
    if (now === null) return;
    const ready = now.ready;
    if (ready === null || now.settled < now.presets || now.answered < now.asked) {
      now.applying = true;
      return;
    }
    now.applying = false;
    const shown = now.shown;
    const model = ctx.engine.model;
    const unit = currentIndex().get(now.key);
    if (model === null || unit === null) return;
    if (now.failed || shown === null || shown.traced.shapes.length === 0) {
      announce(tracingStatus(now));
      return;
    }
    const problem = traceProblem(shown.group);
    if (problem !== null) {
      announce(problem);
      return;
    }
    const settings = settingsNow();
    ctx.presetLast = settings.preset;
    settingsLast.set(settings.preset, settings);
    const arranged = traceOps(model, unit.node, shown.traced, ready.target, newIds());
    closeTracing();
    surface.focus({ preventScroll: true });
    if (arrange("draw.action.trace_image", arranged) !== null) {
      announce(plural(shown.traced.shapes.length, "draw.trace_image.done.one", "draw.trace_image.done.other"));
    }
  }

  life.listen(presetSelect, "change", () => {
    const now = ctx.tracing;
    if (now !== null) void loadPreset(now);
  });
  for (const range of [thresholdRange, colorsRange, detailRange]) life.listen(range.input, "input", () => traceNow());
  life.listen(whiteInput, "change", () => traceNow());
  life.listen(traceApply, "click", () => applyTracing());
  life.listen(traceCancel, "click", () => closeTracing());
  // Come nella barra dei tracciati: Invio in un campo applica, Esc chiude.
  life.listen(traceBar, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTracing();
      surface.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    applyTracing();
  });
  life.add(() => {
    ctx.tracing?.ready?.tracer.dispose();
    ctx.tracing = null;
  });

  // --- Ritaglia immagine --------------------------------------------------------

  /// L'immagine che si ritaglia, nell'indice di adesso.
  const cropUnit = (): Unit | null => (ctx.cropping === null ? null : currentIndex().get(ctx.cropping.key));

  /// Quanto un'unità dell'immagine è lunga nella scena, lungo i suoi due
  /// assi: i margini si scrivono come si vedono.
  const cropScale = (unit: Unit | null): Point => {
    const m = unit?.matrix ?? IDENTITY;
    return [Math.hypot(m[0], m[1]) || 1, Math.hypot(m[2], m[3]) || 1];
  };

  /// Le misure di `bounds`, un riquadro dell'immagine `unit`, come si
  /// vedono nella scena: da leggere, o da dire con `spoken`.
  const cropMeasures = (bounds: Bounds, unit: Unit | null, spoken: boolean): string => {
    const [sx, sy] = cropScale(unit);
    const width = (bounds.max[0] - bounds.min[0]) * sx;
    const height = (bounds.max[1] - bounds.min[1]) * sy;
    return spoken ? `${lengthSpoken(width)} × ${lengthSpoken(height)}` : measuresText([width, height]);
  };

  /// Quanto dell'immagine si vede col ritaglio `crop`, a parole: da
  /// leggere nella barra, o da dire con `spoken`.
  const cropSize = (crop: Crop, unit: Unit | null, spoken = false): string =>
    sameBounds(crop.rect, crop.box)
      ? t("draw.crop.whole")
      : t("draw.crop.size", { size: cropMeasures(crop.rect, unit, spoken), whole: cropMeasures(crop.box, unit, spoken) });

  /// I margini del ritaglio `crop`, a parole.
  const cropMargins = (crop: Crop, unit: Unit | null): string => {
    const [sx, sy] = cropScale(unit);
    const margins = marginsOf(crop);
    return t("draw.crop.margins", {
      top: lengthSpoken(margins.top * sy),
      right: lengthSpoken(margins.right * sx),
      bottom: lengthSpoken(margins.bottom * sy),
      left: lengthSpoken(margins.left * sx),
    });
  };

  /// «Ritaglia», e il doppio tocco su un'immagine: l'immagine scelta da
  /// sola mostra i segni del ritaglio, e la barra in fondo i margini. Dalla
  /// barra il fuoco va al primo margine; dal foglio resta lì.
  function openCrop(focus: boolean): void {
    const units = arranging("crop", false);
    if (units === null) return;
    const unit = units.length === 1 && units[0]!.role === "image" ? units[0]! : null;
    const state = unit === null ? null : cropState(ctx.engine.model!, unit.node);
    if (unit === null || state === null) {
      announce(t("draw.crop.none"));
      return;
    }
    // Di nuovo sulla stessa immagine: il ritaglio resta com'è.
    if (ctx.cropping?.key === unit.key) {
      if (focus) cropSides[0]!.input.focus({ preventScroll: true });
      return;
    }
    if (state.kind === "other") {
      announce(t("draw.crop.other"));
      return;
    }
    // Il ritaglio viene dopo gli effetti, e li taglierebbe.
    if (state.kind === "free" && effectsState(ctx.engine.model!, unit.node).kind !== "none") {
      announce(t("draw.crop.effects"));
      return;
    }
    closeDescriptions();
    closePaths();
    closeTracing();
    // I segni si tirano con la Selezione: lo strumento Selezione li mostra.
    if (ctx.tool !== "select") setTool("select");
    ctx.cropping = { key: unit.key, loaded: ctx.loads, start: state.crop, crop: state.crop };
    ctx.cropTap = null;
    showCropBar(true);
    showCrop();
    if (focus) {
      const first = cropSides[0]!.input;
      first.focus({ preventScroll: true });
      first.select();
    }
    announce(t("draw.crop.hint"));
  }
  ctx.openCrop = openCrop;

  /// Chiude il ritaglio senza scriverlo: l'immagine si vede com'è, e il
  /// fuoco, se era nella barra, torna al foglio.
  function closeCrop(): void {
    if (ctx.cropping === null) return;
    const focused = cropBar.contains(document.activeElement);
    if (ctx.current?.kind === "crop") cancelGesture();
    ctx.cropping = null;
    ctx.cropTap = null;
    cropBar.hidden = true;
    painter.setCrops(null);
    showGrip(null);
    showHandles();
    if (focused) surface.focus({ preventScroll: true });
  }
  ctx.closeCrop = closeCrop;

  /// Esc e «Annulla»: il ritaglio si chiude com'era, e lo si dice.
  function cancelCrop(): void {
    if (ctx.cropping === null) return;
    closeCrop();
    announce(t("draw.crop.cancelled"));
  }
  ctx.cancelCrop = cancelCrop;

  /// Invio, «Applica», un tocco fuori dall'immagine o due dentro: il
  /// ritaglio si scrive in un passo di annulla, e si chiude. Con `quiet`,
  /// un ritaglio che non cambia niente si chiude senza dirlo.
  function applyCrop(quiet = false): void {
    const now = ctx.cropping;
    if (now === null) return;
    const model = ctx.engine.model;
    const unit = cropUnit();
    if (model === null || unit === null || !editable()) {
      closeCrop();
      return;
    }
    const ops = cropOps(model, unit.node, now.crop, newIds());
    closeCrop();
    if (ops.length === 0) {
      if (!quiet) announce(t("draw.unchanged"));
      return;
    }
    // Un ritaglio che, scritto, lascia l'immagine intera la toglie.
    const whole = ops.some((op) => op.op === "set" && op.attrs["clip-path"] === null);
    // Un'immagine senza id ne riceve uno, che diventa la sua chiave.
    const named = ops.find((op) => op.op === "ident" && op.id !== null && op.path.join(".") === unit.path.join("."));
    const key = named?.op === "ident" && named.id !== null ? named.id : unit.key;
    if (arrange("draw.action.crop", { ops, keys: [key] }) === null) return;
    announce(whole ? t("draw.crop.removed") : t("draw.cropped", { size: cropMeasures(now.crop.rect, unit, true) }));
  }
  ctx.applyCrop = applyCrop;

  /// Prima di un comando che cambia il disegno o la selezione: il ritaglio
  /// aperto si applica, come scegliendo altro, così il comando vede
  /// l'immagine ritagliata e i passi di annulla sono due, «Ritaglio» e il
  /// suo. Mai dentro `refresh`, che non scrive. Scrivere il ritaglio può
  /// cambiare le chiavi per percorso, perché `fub-defs` nasce per prima fra i
  /// figli della radice, e l'immagine senza id ne riceve uno: chi ha già in
  /// mano delle chiavi, da un pannello, le fa passare per ciò che rende.
  function settleCrop(): (key: string) => string {
    const now = ctx.cropping;
    if (now === null) return (key) => key;
    const homed = ctx.engine.model !== null && resourceHome(ctx.engine.model) !== null;
    applyCrop(true);
    const model = ctx.engine.model;
    const shifted = !homed && model !== null && resourceHome(model) !== null;
    const image = ctx.selection.length === 1 ? ctx.selection[0]! : now.key;
    return (key) => {
      if (key === now.key) return image;
      const path = shifted ? /^@(\d+)(.*)$/.exec(key) : null;
      return path === null ? key : `@${Number(path[1]) + 1}${path[2]}`;
    };
  }
  ctx.settleCrop = settleCrop;

  /// Dopo ogni cambio: il ritaglio si chiude se il livello, il documento o
  /// lo strumento non lo vogliono più, se l'immagine non è più scelta da
  /// sola, o se il suo ritaglio è cambiato da un'altra parte. Una
  /// trasformazione no: i segni la seguono.
  function syncCrop(): void {
    const now = ctx.cropping;
    if (now === null) return;
    const unit = cropUnit();
    const state = unit === null || ctx.engine.model === null ? null : cropState(ctx.engine.model, unit.node);
    const same = state !== null && state.kind !== "other" && sameBounds(state.crop.box, now.start.box) && sameBounds(state.crop.rect, now.start.rect);
    if (!has("crop") || !editable() || ctx.tool !== "select" || ctx.loads !== now.loaded || ctx.selection.length !== 1 || ctx.selection[0] !== now.key || !same) {
      closeCrop();
      return;
    }
    showCropBar();
    showCrop();
  }
  ctx.syncCrop = syncCrop;

  /// L'anteprima del ritaglio di adesso: il painter mostra l'immagine
  /// intera attenuata e sopra la parte che resta, lo strato sopra i segni.
  function showCrop(): void {
    const now = ctx.cropping;
    const unit = cropUnit();
    painter.setCrops(now === null || unit === null ? null : new Map(unit.paints.map((paint) => [paint, now.crop])));
    if (now !== null) cropStatus.textContent = cropSize(now.crop, unit);
    showHandles();
  }
  ctx.showCrop = showCrop;

  /// La barra com'è adesso: i nomi dei margini con l'unità del documento,
  /// e i margini del ritaglio. Quello che si sta scrivendo resta com'è,
  /// tranne con `all`, dopo un trascinamento o un tasto sul foglio.
  function showCropBar(all = false): void {
    const now = ctx.cropping;
    cropBar.hidden = now === null;
    const unit = docUnit();
    for (const { side, name } of cropSides) name.textContent = unitSuffix(t(`draw.crop.${side}`), unit);
    if (now === null) return;
    const scale = cropScale(cropUnit());
    const margins = marginsOf(now.crop);
    for (const { side, input } of cropSides) {
      if (!all && input === document.activeElement) continue;
      input.value = fieldText(margins[side] * scale[CROP_AXES[side]], unit);
    }
    cropStatus.textContent = cropSize(now.crop, cropUnit());
  }
  ctx.showCropBar = showCropBar;

  /// Le parole di ciò che non va in un margine scritto, come nei campi del
  /// pannello delle proprietà.
  const MARGIN_PROBLEMS: Readonly<Record<QuantityProblem, DrawKey>> = {
    empty: "draw.properties.problem.empty",
    syntax: "draw.properties.problem.syntax",
    unit: "draw.properties.problem.unit",
    relative: "draw.properties.problem.relative",
    finite: "draw.properties.problem.finite",
  };

  /// Un margine scritto nella barra: gli altri restano come sono, e il
  /// ritaglio cambia se il margine lascia abbastanza dell'immagine. Un campo
  /// vuoto o illeggibile non cambia niente: la barra lo dice, e lasciato il
  /// campo il margine si riscrive com'è. Si legge come i campi di
  /// «Trasforma»: la virgola o il punto, le operazioni, le unità.
  function cropFromField(side: keyof Margins, input: HTMLInputElement): void {
    const now = ctx.cropping;
    if (now === null) return;
    const unit = docUnit();
    const scale = cropScale(cropUnit())[CROP_AXES[side]];
    const written = evaluate(input.value, { units: lengthUnits(unit), current: toUnit(marginsOf(now.crop)[side] * scale, unit), relative: true });
    if ("problem" in written) {
      cropStatus.textContent = t(MARGIN_PROBLEMS[written.problem], { units: Object.keys(lengthUnits(unit)).join(", ") });
      return;
    }
    // Un margine non è mai sotto lo zero, e lo zero non ha segno.
    const value = Math.round(fromUnit(Math.max(0, written.value), unit) * 100) / 100 / scale;
    const next = Number.isFinite(value) ? withMargins(now.crop, { ...marginsOf(now.crop), [side]: value }) : null;
    if (next === null) {
      cropStatus.textContent = t("draw.crop.invalid");
      return;
    }
    now.crop = next;
    showCrop();
  }

  for (const { side, input } of cropSides) {
    life.listen(input, "input", () => cropFromField(side, input));
    // Lasciato il campo, i margini si riscrivono come valgono.
    life.listen(input, "change", () => showCropBar(true));
  }
  life.listen(cropApply, "click", () => applyCrop());
  life.listen(cropCancel, "click", () => cancelCrop());
  // Come nella barra dei tracciati: Invio in un campo applica, Esc annulla.
  life.listen(cropBar, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelCrop();
      surface.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    applyCrop();
    surface.focus({ preventScroll: true });
  });

  /// I segni del ritaglio, con le linee dei terzi mentre lo si tira.
  const cropHandles = (): OverlayHandle[] => {
    const now = ctx.cropping;
    const unit = cropUnit();
    if (now === null || unit === null) return [];
    const { min, max } = now.crop.rect;
    const thirds = ctx.current?.kind === "crop" && ctx.current.dragging && ctx.current.grab !== "outside";
    return [{ kind: "crop", x: min[0], y: min[1], width: max[0] - min[0], height: max[1] - min[1], matrix: unit.matrix, thirds }];
  };
  ctx.cropHandles = cropHandles;

  /// Il segno del ritaglio sotto `p`, nella scena, col puntatore `pointer`:
  /// un angolo vicino, se no un lato; `null` se nessuno. Dentro il ritaglio
  /// i segni arrivano al più a un quarto del lato più corto, come quelli
  /// disegnati: il resto sposta l'immagine, anche in un ritaglio piccolo.
  const cropHandleAt = (crop: Crop, matrix: Matrix, p: Point, pointer: InkPointerType): CropHandle | null => {
    const at = toScreen(ctx.camera, p);
    const { min, max } = crop.rect;
    const spot = (local: Point): Point => toScreen(ctx.camera, apply(matrix, local));
    const [ax, ay] = spot(min);
    const [bx, by] = spot([max[0], min[1]]);
    const [cx, cy] = spot([min[0], max[1]]);
    const inverse = invert(matrix);
    const within = inverse !== null && insideBounds(crop.rect, apply(inverse, p));
    const reach = within ? Math.min(NODE_PX[pointer], Math.min(Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay)) / 4) : NODE_PX[pointer];
    let best: CropHandle | null = null;
    let nearest = reach;
    for (const [handle, local] of [["nw", min], ["ne", [max[0], min[1]]], ["se", max], ["sw", [min[0], max[1]]]] as const) {
      const [x, y] = spot(local as Point);
      const away = Math.hypot(x - at[0], y - at[1]);
      if (away <= nearest) {
        nearest = away;
        best = handle;
      }
    }
    if (best !== null) return best;
    for (const [handle, from, to] of [["n", min, [max[0], min[1]]], ["e", [max[0], min[1]], max], ["s", [min[0], max[1]], max], ["w", min, [min[0], max[1]]]] as const) {
      const away = segmentDistance(at, spot(from as Point), spot(to as Point));
      if (away <= nearest) {
        nearest = away;
        best = handle;
      }
    }
    return best;
  };

  /// Il punto del segno `handle` sul rettangolo `rect`.
  const cropSpot = (rect: Bounds, handle: CropHandle): Point => {
    const x = handle.includes("w") ? rect.min[0] : handle.includes("e") ? rect.max[0] : (rect.min[0] + rect.max[0]) / 2;
    const y = handle.includes("n") ? rect.min[1] : handle.includes("s") ? rect.max[1] : (rect.min[1] + rect.max[1]) / 2;
    return [x, y];
  };

  /// Il cursore sopra il punto `p` della scena mentre si ritaglia: un
  /// segno tira, l'immagine si sposta.
  const cropCursor = (p: Point, pointer: InkPointerType): GripCursor | "move" | null => {
    const now = ctx.cropping;
    const unit = cropUnit();
    if (now === null || unit === null) return null;
    const handle = cropHandleAt(now.crop, unit.matrix, p, pointer);
    if (handle !== null) return gripCursor({ matrix: unit.matrix, box: now.crop.rect, geometry: now.crop.rect }, handle, ctx.camera.angle);
    const inverse = invert(unit.matrix);
    return inverse !== null && insideBounds(now.crop.box, apply(inverse, p)) ? "move" : null;
  };
  ctx.cropCursor = cropCursor;

  /// Il primo punto di un gesto sul ritaglio: un segno lo tira, l'immagine
  /// si sposta sotto, e fuori un tocco lo applica.
  const cropStart = (g: CropGesture, p: Point): void => {
    g.from = p;
    const now = ctx.cropping;
    const unit = cropUnit();
    const inverse = unit === null ? null : invert(unit.matrix);
    if (now === null || unit === null || inverse === null) return;
    g.start = now.crop;
    const handle = cropHandleAt(now.crop, unit.matrix, p, g.pointer);
    if (handle !== null) {
      const local = apply(inverse, p);
      const spot = cropSpot(now.crop.rect, handle);
      g.grab = handle;
      g.offset = [spot[0] - local[0], spot[1] - local[1]];
    } else {
      g.grab = insideBounds(now.crop.box, apply(inverse, p)) ? "slide" : "outside";
    }
    if (g.grab !== "outside") showGrip(cropCursor(p, g.pointer));
  };
  ctx.cropStart = cropStart;

  /// Il gesto `g` col puntatore in `end`: oltre la soglia del
  /// trascinamento, il segno preso tira il ritaglio, con Maiusc nelle sue
  /// proporzioni e con Alt attorno al centro, o l'immagine si sposta sotto.
  const cropUpdate = (g: CropGesture): void => {
    if (g.from === null || g.end === null) return;
    if (!g.dragging) {
      const [ax, ay] = toScreen(ctx.camera, g.from);
      const [bx, by] = toScreen(ctx.camera, g.end);
      if (Math.hypot(bx - ax, by - ay) <= DRAG_PX[g.pointer]) return;
      g.dragging = true;
      ctx.cropTap = null;
    }
    const now = ctx.cropping;
    const unit = cropUnit();
    if (now === null || unit === null || g.start === null || g.grab === null || g.grab === "outside") return;
    const inverse = invert(unit.matrix);
    if (inverse === null) return;
    const to = apply(inverse, g.end);
    if (g.grab === "slide") {
      const from = apply(inverse, g.from);
      now.crop = slideImage(g.start, [to[0] - from[0], to[1] - from[1]]);
    } else {
      const k = scaleOf(unit.matrix) * ctx.camera.scale;
      const min = Math.max(MIN_CROP, k > 0 ? CROP_MIN_PX / k : MIN_CROP);
      now.crop = dragCrop(g.start, g.grab, [to[0] + g.offset[0], to[1] + g.offset[1]], { ratio: ctx.shift, centered: ctx.alt, min });
    }
    showCropBar(true);
    showCrop();
  };
  ctx.cropUpdate = cropUpdate;

  /// Il gesto `g` finito: un tocco fuori applica e sceglie ciò che tocca,
  /// due dentro applicano; un trascinamento dice quanto si vede, e fuori
  /// non fa niente.
  const cropEnd = (g: CropGesture, time: number): void => {
    // Il ritaglio è quello dei modificatori di quando il puntatore si alza.
    if (g.dragging) cropUpdate(g);
    ctx.current = null;
    showGrip(null);
    const now = ctx.cropping;
    if (now === null || g.from === null) return;
    if (g.dragging) {
      showHandles();
      if (g.grab !== "outside") announce(g.grab === "slide" ? cropMargins(now.crop, cropUnit()) : cropSize(now.crop, cropUnit(), true));
      return;
    }
    if (g.grab === "outside") {
      // Come chiudere il ritaglio e toccare: ciò che si tocca si sceglie, con
      // Maiusc si aggiunge a ciò che era scelto, con Ctrl o ⌘ si sceglie
      // dentro i gruppi.
      applyCrop();
      const index = currentIndex();
      const reach = HIT_PX[g.pointer] / ctx.camera.scale;
      const hit = ctx.free && has("selection") ? index.deepAt(g.from, reach) : index.at(g.from, reach);
      if (hit === null) {
        if (!ctx.shift) select([]);
      } else if (ctx.shift && has("selection")) {
        // Aggiunto un oggetto, il gruppo scelto che lo contiene lo lascia; uno
        // già scelto si toglie.
        select(ctx.selection.includes(hit.key)
          ? ctx.selection.filter((key) => key !== hit.key)
          : [...selectedUnits().filter((unit) => !holdsPath(unit.path, hit.path)).map((unit) => unit.key), hit.key]);
      } else {
        select([hit.key]);
      }
      return;
    }
    const previous = ctx.cropTap;
    ctx.cropTap = { time, at: g.from };
    if (previous !== null && time - previous.time <= DOUBLE_TAP_MS && Math.hypot(g.from[0] - previous.at[0], g.from[1] - previous.at[1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer]) {
      applyCrop();
    }
  };
  ctx.cropEnd = cropEnd;

  /// Le frecce mentre si ritaglia: l'immagine si sposta sotto il ritaglio
  /// di `x`, `y` nella scena.
  const slideCrop = (x: number, y: number): void => {
    const now = ctx.cropping;
    const unit = cropUnit();
    const inverse = unit === null ? null : invert(unit.matrix);
    if (now === null || unit === null || inverse === null) return;
    const [a, b, c, d] = inverse;
    const next = slideImage(now.crop, [a * x + c * y, b * x + d * y]);
    if (sameBounds(next.box, now.crop.box)) return;
    now.crop = next;
    showCropBar(true);
    showCrop();
    announce(cropMargins(next, unit));
  };
  ctx.slideCrop = slideCrop;

  /// «Togli il ritaglio»: le immagini scelte tornano intere, qualunque
  /// ritaglio abbiano, in un passo di annulla.
  function uncropSelection(): void {
    const units = arranging("crop");
    if (units === null) return;
    const count = croppedImages(ctx.engine.model!, units).length;
    if (count === 0) {
      announce(t("draw.uncrop.none"));
      return;
    }
    if (arrange("draw.action.uncrop", uncropOps(ctx.engine.model!, units, newIds())) !== null) announce(plural(count, "draw.uncropped.one", "draw.uncropped.other"));
  }
  ctx.uncropSelection = uncropSelection;

  /// Vero se `unit` è un tratto a penna, o ne contiene uno che non è
  /// bloccato.
  function holdsPenStroke(unit: Unit): boolean {
    if (unit.role === "group" || unit.role === "link") return currentIndex().children(unit).some(holdsPenStroke);
    return isPenStroke(unit.node);
  }
  ctx.holdsPenStroke = holdsPenStroke;

  /// «Rendi forma», dal livello Standard: ogni tratto a penna scelto diventa
  /// la forma a cui somiglia, in un passo di annulla. Quelli che non
  /// somigliano a una forma restano inchiostro, e lo si dice.
  function shapeSelectedInk(): void {
    const units = arranging("recognize");
    if (units === null) return;
    const shaped = inkShapeOps(ctx.engine.model!, currentIndex(), units, newIds());
    const refused = shaped.refused === 0 ? "" : ` ${plural(shaped.refused, "draw.shaped.refused.one", "draw.shaped.refused.other")}`;
    if (shaped.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.to_shape", shaped, shaped.extent) !== null) announce(`${plural(shaped.changed, "draw.shaped.one", "draw.shaped.other")}${refused}`);
  }
  ctx.shapeSelectedInk = shapeSelectedInk;

  /// Perché un'operazione booleana non si fa, a parole.
  const refusal = (refused: Refused): string =>
    refused.reason === "not_shapes" ? plural(refused.count, "draw.boolean.not_shapes.one", "draw.boolean.not_shapes.other") : t(REFUSALS[refused.reason]);

  /// Un'operazione booleana, dal livello Esperto: la forma più in basso fra
  /// quelle scelte diventa il risultato, o i pezzi della divisione, e le
  /// altre se ne vanno.
  function combineSelection(kind: BooleanKind): void {
    const units = arranging("boolean");
    if (units === null) return;
    const combined = combineOps(ctx.engine.model!, units, kind, newIds());
    if ("reason" in combined) {
      announce(refusal(combined));
      return;
    }
    const { label, action } = BOOLEANS.find((entry) => entry.kind === kind)!;
    if (arrange(action, combined) === null) return;
    announce(kind === "division" ? t("draw.divided", { count: combined.pieces }) : plural(units.length, "draw.combined.one", "draw.combined.other", { action: t(label) }));
  }

  /// Le voci delle operazioni booleane: spente, e dicono perché, se fra gli
  /// oggetti scelti c'è qualcosa che non è una forma, o se le forme sono
  /// poche.
  const booleanItems = (): MenuItem[] => {
    const units = selectedUnits();
    const others = units.filter((unit) => !isShape(unit)).length;
    return BOOLEANS.map(({ kind, label }) => {
      const reason = others > 0
        ? refusal({ reason: "not_shapes", count: others })
        : units.length < (kind === "union" ? 1 : 2) ? refusal({ reason: "few" }) : null;
      return { label: t(label), disabled: reason !== null, ...(reason === null ? {} : { description: reason }), run: () => combineSelection(kind) };
    });
  };
  ctx.booleanItems = booleanItems;
}
