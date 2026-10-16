// L'editor del disegno: il Costruttore di forme, le Forbici e il Coltello. Un
// pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { resolvedLanguage } from "../../../../i18n/strings";
import type { InkPointerType } from "../../../../ink/dom/pen-input";
import { pointAt } from "../../scene/curves";
import { BoundsBuilder } from "../../scene/geometry";
import { apply, invert, type Point } from "../../scene/matrix";
import { pathOf } from "../../scene/model";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle, RegionTone } from "../../painter/overlay";
import { mappedBounds } from "../edit";
import { nodeOf, Plan } from "../arrange";
import { crossings, cutAt, mapSubs, nodeSpot } from "../cut";
import { cuttable, dsOf, knifePieces, piecesOf, tipsOfCut, writePieces } from "../scissors";
import { builderOf, buildOps, type Builder, type BuildRefused } from "../builder";
import { curveAt, kindOf, linkAt, nodeAt, parseKey, writeNodes, type Link, type Subpath } from "../nodes";
import type { Nodable, NoNodes } from "../nodable";
import { DRAG_PX, HIT_PX, LASSO_MAX_POINTS, LASSO_STEP_PX, NO_NODES, NODE_PX, NODE_SHAPES } from "./constants";
import type { EditorContext } from "./context";
import { innerNode } from "./helpers";
import type { BuilderGesture, CutGesture, CutSpot } from "./types";

/// Il Costruttore guarda il tratto del puntatore fra un campione e l'altro a
/// passi di tanti pixel dello schermo: una regione stretta non si salta.
const BUILDER_STEP_PX = 3;

/// Che cosa si dice quando il Costruttore non fa un'operazione.
const BUILD_REFUSALS: Readonly<Record<BuildRefused["reason"], DrawKey>> = {
  whole: "draw.builder.whole",
  foreign: "draw.builder.foreign",
  failed: "draw.builder.unsolved",
};

/// Ciò che il Costruttore di forme, le Forbici e il Coltello dà agli altri pezzi dell'editor.
export interface CuttingContext {
  builderNow: () => Builder | null;
  forgetBuilder: () => void;
  builderText: () => string;
  regionHandles: () => OverlayHandle[];
  hoverRegion: (p: Point | null, pointer: InkPointerType) => void;
  builderAdd: (g: BuilderGesture, p: Point) => void;
  builderUpdate: (g: BuilderGesture) => void;
  builderEnd: (g: BuilderGesture) => void;
  builderKeysOn: () => boolean;
  visitRegion: (at: number) => boolean;
  walkRegions: (step: 1 | -1) => boolean;
  pickRegion: () => void;
  buildChosen: (erase: boolean) => boolean;
  cutSpotAt: (p: Point, pointer: InkPointerType) => CutSpot | DrawKey;
  cutSpotText: (found: CutSpot) => string;
  hoverCut: (p: Point | null, pointer: InkPointerType) => void;
  cutHandles: () => OverlayHandle[];
  cutAdd: (g: CutGesture, p: Point) => void;
  cutEnd: (g: CutGesture) => void;
}

/// Monta il Costruttore di forme, le Forbici e il Coltello.
export function installCutting(ctx: EditorContext): void {
  const {
    has, editable, currentIndex, newIds, announce, selectedUnits, inOrder, nodableAt, showHandles, labelOf, syncControls, select, frameBounds,
    cancelGesture, marqueed
  } = ctx;
  // --- Il Costruttore di forme -------------------------------------------------

  /// Il Costruttore sugli oggetti scelti, rifatto quando cambiano la scena o
  /// la selezione: allora la regione sotto il puntatore, quella a cui si è
  /// arrivati e quelle scelte si perdono. `null` se lo strumento non è lui,
  /// se non c'è niente di scelto o se il calcolo non riesce.
  const builderNow = (): Builder | null => {
    const model = ctx.engine.model;
    if (ctx.tool !== "builder" || !has("builder") || !editable() || model === null) return null;
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    if (ctx.building === null || ctx.building.index !== index || ctx.building.keys !== keys) {
      const units = selectedUnits();
      const found = units.length === 0 ? null : builderOf(model, units);
      const builder = found === "complex" ? null : found;
      ctx.building = { index, keys, builder, complex: found === "complex", inverse: builder === null ? null : invert(builder.matrix) };
      ctx.regionHover = -1;
      ctx.regionActive = -1;
      ctx.regionsChosen = [];
    }
    return ctx.building.builder;
  };
  ctx.builderNow = builderNow;

  /// Il Costruttore si rifà da capo: lo strumento è cambiato.
  const forgetBuilder = (): void => {
    ctx.building = null;
    ctx.regionHover = -1;
    ctx.regionActive = -1;
    ctx.regionsChosen = [];
  };
  ctx.forgetBuilder = forgetBuilder;

  /// La regione del Costruttore nel punto `p` della scena, o -1.
  const regionAt = (p: Point): number => {
    const builder = builderNow();
    const inverse = ctx.building?.inverse ?? null;
    return builder === null || inverse === null ? -1 : builder.regions.at(apply(inverse, p));
  };

  /// Su che cosa lavora il Costruttore, a parole: quante regioni hanno le
  /// forme scelte, e quanti oggetti scelti non sono forme; o perché niente.
  const builderText = (): string => {
    if (!has("builder") || !editable()) return "";
    if (ctx.selection.length === 0) return t("draw.builder.none");
    const builder = builderNow();
    if (builder === null) return t(ctx.building?.complex === true ? "draw.builder.complex" : "draw.builder.failed");
    const parts: string[] = [];
    const count = builder.regions.regions.length;
    const shapes = builder.shapes.length;
    if (shapes > 0 && count === 0) parts.push(t("draw.builder.empty"));
    else if (shapes === 1) parts.push(plural(count, "draw.builder.regions.single.one", "draw.builder.regions.single.other"));
    else if (shapes > 1) parts.push(plural(count, "draw.builder.regions.one", "draw.builder.regions.other", { shapes }));
    const others = builder.selected.length - shapes;
    if (others > 0) parts.push(plural(others, "draw.builder.not_shapes.one", "draw.builder.not_shapes.other"));
    return parts.join(" ");
  };
  ctx.builderText = builderText;

  /// La selezione e, col Costruttore, su che cosa lavora.
  const announcePicked = (): void => {
    const picked = ctx.selection.length === 0 ? "" : plural(ctx.selection.length, "draw.selected.one", "draw.selected.other");
    announce([picked, builderText()].filter((part) => part !== "").join(" "));
  };

  /// La regione `at` di `builder` a parole: quale, di quante, e le forme che
  /// la coprono, dalla più in alto, che le dà lo stile se la si unisce.
  const regionText = (builder: Builder, at: number): string => {
    const names = [...builder.regions.regions[at]!.cover].reverse().map((k) => labelOf(builder.shapes[k]!));
    const values = {
      index: at + 1,
      total: builder.regions.regions.length,
      shapes: new Intl.ListFormat(resolvedLanguage(), { type: "conjunction" }).format(names),
    };
    return t(ctx.regionsChosen.includes(at) ? "draw.builder.region.chosen" : "draw.builder.region", values);
  };

  /// Le regioni del Costruttore, appena segnate. Quella sotto il puntatore
  /// si accende; quelle che il gesto prende e quelle scelte si riempiono, o
  /// con Alt si tratteggiano, perché si tolgono; quella a cui si è arrivati
  /// con Tab ha il bordo spesso. Mentre si scelgono gli oggetti, nessuna.
  const regionHandles = (): OverlayHandle[] => {
    const g = ctx.current?.kind === "builder" ? ctx.current : null;
    if (g?.mode === "objects") return [];
    const builder = builderNow();
    if (builder === null) return [];
    const taken = new Set(g === null ? ctx.regionsChosen : g.dragging ? g.crossed : g.crossed.slice(0, 1));
    return builder.regions.regions.map((region, r): OverlayHandle => {
      const tone: RegionTone = taken.has(r)
        ? g !== null && ctx.alt ? "erase" : "chosen"
        : g === null && r === ctx.regionHover ? (ctx.alt ? "erase" : "hover") : "plain";
      return { kind: "region", segments: region.segments, matrix: builder.matrix, tone, active: r === ctx.regionActive };
    });
  };
  ctx.regionHandles = regionHandles;

  /// Il puntatore passa sopra `p` senza premere: col Costruttore la regione
  /// sotto si accende. Il dito non passa: tocca.
  const hoverRegion = (p: Point | null, pointer: InkPointerType): void => {
    const next = p !== null && pointer !== "touch" ? regionAt(p) : -1;
    if (next === ctx.regionHover) return;
    ctx.regionHover = next;
    showHandles();
  };
  ctx.hoverRegion = hoverRegion;

  /// Unisce le regioni `chosen` del Costruttore in una forma, con lo stile
  /// della prima, o con `erase` le toglie, in un passo di annulla; e dice
  /// che cosa resta.
  const build = (chosen: readonly number[], erase: boolean): void => {
    const builder = builderNow();
    const model = ctx.engine.model;
    if (builder === null || model === null || chosen.length === 0) return;
    const built = buildOps(model, builder, chosen, erase, newIds());
    if ("reason" in built) {
      announce(t(BUILD_REFUSALS[built.reason]));
      return;
    }
    const label: DrawKey = erase ? "draw.action.build_erase" : chosen.length === 1 ? "draw.action.build_separate" : "draw.action.build_merge";
    if (ctx.arrange(label, built) === null) return;
    const done = erase
      ? plural(chosen.length, "draw.builder.erased.one", "draw.builder.erased.other")
      : chosen.length === 1 ? t("draw.builder.separated") : plural(chosen.length, "draw.builder.merged.one", "draw.builder.merged.other");
    const removed = built.removed === 0 ? "" : plural(built.removed, "draw.builder.removed.one", "draw.builder.removed.other");
    announce([done, removed, builderText()].filter((part) => part !== "").join(" "));
  };

  /// Il punto `p` del gesto del Costruttore. Il primo decide che cosa fa il
  /// gesto: le regioni, se cade su una senza Maiusc, o gli oggetti. Poi le
  /// regioni che il tratto attraversa si aggiungono, guardate a passi sullo
  /// schermo, e la scia lo segue.
  const builderAdd = (g: BuilderGesture, p: Point): void => {
    if (g.from === null || g.end === null) {
      g.from = p;
      g.end = p;
      g.additive = ctx.shift;
      const at = ctx.shift ? -1 : regionAt(p);
      g.mode = at >= 0 ? "regions" : "objects";
      if (at >= 0) {
        g.crossed.push(at);
        g.trail.push(p);
      }
      return;
    }
    const last = g.end;
    g.end = p;
    if (!g.dragging && Math.hypot(p[0] - g.from[0], p[1] - g.from[1]) * ctx.camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    if (g.mode !== "regions") return;
    const steps = Math.max(1, Math.ceil((Math.hypot(p[0] - last[0], p[1] - last[1]) * ctx.camera.scale) / BUILDER_STEP_PX));
    for (let i = 1; i <= steps; i++) {
      const at = regionAt([last[0] + ((p[0] - last[0]) * i) / steps, last[1] + ((p[1] - last[1]) * i) / steps]);
      if (at >= 0 && !g.crossed.includes(at)) g.crossed.push(at);
    }
    const tail = g.trail[g.trail.length - 1]!;
    if (Math.hypot(p[0] - tail[0], p[1] - tail[1]) * ctx.camera.scale < LASSO_STEP_PX) return;
    g.trail.push(p);
    if (g.trail.length > LASSO_MAX_POINTS) {
      const kept = g.trail.filter((_, at) => at % 2 === 0 || at === g.trail.length - 1);
      g.trail.splice(0, g.trail.length, ...kept);
    }
  };
  ctx.builderAdd = builderAdd;

  /// Il riquadro del Costruttore sceglie gli oggetti dentro, come quello
  /// della Selezione; con Maiusc li aggiunge a quelli di prima.
  const builderMarquee = (g: BuilderGesture): void => {
    if (g.from === null || g.end === null) return;
    ctx.selection = inOrder([...(g.additive ? g.base : []), ...marqueed(g.from, g.end).map((unit) => unit.key)]);
    syncControls();
  };

  const builderUpdate = (g: BuilderGesture): void => {
    if (g.mode === "objects" && g.dragging) builderMarquee(g);
    showHandles();
  };
  ctx.builderUpdate = builderUpdate;

  /// Il gesto del Costruttore finisce. Sulle regioni un trascinamento unisce
  /// quelle attraversate e un tocco separa la sua, o con Alt le toglie. Sugli
  /// oggetti il riquadro resta, e un tocco sceglie l'oggetto sotto, o il
  /// vuoto; uno già scelto tiene la selezione com'è, e con Maiusc lo si
  /// toglie.
  const builderEnd = (g: BuilderGesture): void => {
    ctx.current = null;
    if (g.mode === "regions") {
      showHandles();
      build(g.dragging ? g.crossed : g.crossed.slice(0, 1), ctx.alt);
      return;
    }
    if (g.mode === null || g.from === null) {
      showHandles();
      return;
    }
    if (g.dragging) {
      builderMarquee(g);
    } else {
      const key = currentIndex().at(g.from, HIT_PX[g.pointer] / ctx.camera.scale)?.key ?? null;
      if (g.additive) {
        if (key !== null) select(g.base.includes(key) ? g.base.filter((each) => each !== key) : [...g.base, key]);
      } else if (key === null || !g.base.includes(key)) {
        select(key === null ? [] : [key]);
      }
    }
    showHandles();
    announcePicked();
  };
  ctx.builderEnd = builderEnd;

  /// Vero se i tasti valgono per le regioni: il Costruttore ne ha, e la
  /// tastiera non sta premendo.
  const builderKeysOn = (): boolean => ctx.tool === "builder" && ctx.pressed === null && (builderNow()?.regions.regions.length ?? 0) > 0;
  ctx.builderKeysOn = builderKeysOn;

  /// Porta alla regione `at` del Costruttore: la segna col bordo spesso, la
  /// porta in vista e la dice. `false` se non c'è.
  const visitRegion = (at: number): boolean => {
    cancelGesture();
    const builder = builderNow();
    const region = builder?.regions.regions[at];
    if (builder === null || region === undefined) return false;
    ctx.regionActive = at;
    frameBounds(mappedBounds({ min: region.min, max: region.max }, builder.matrix));
    showHandles();
    announce(regionText(builder, at));
    return true;
  };
  ctx.visitRegion = visitRegion;

  /// Tab col Costruttore: la regione dopo quella a cui si è, o con Maiusc
  /// quella prima; da nessuna, la prima o l'ultima. Oltre le estremità,
  /// `false`: il Tab esce dal foglio.
  const walkRegions = (step: 1 | -1): boolean => {
    const total = builderNow()?.regions.regions.length ?? 0;
    return visitRegion(ctx.regionActive < 0 ? (step > 0 ? 0 : total - 1) : ctx.regionActive + step);
  };
  ctx.walkRegions = walkRegions;

  /// Spazio col Costruttore: sceglie la regione a cui si è arrivati, o
  /// quella sotto il cursore, o la lascia se era scelta.
  const pickRegion = (): void => {
    const builder = builderNow();
    if (builder === null) return;
    const at = ctx.regionActive >= 0 ? ctx.regionActive : regionAt(ctx.cursorPoint());
    if (at < 0) {
      announce(t("draw.builder.nowhere"));
      return;
    }
    const lead = at === ctx.regionActive ? "" : `${regionText(builder, at)} `;
    ctx.regionActive = at;
    const was = ctx.regionsChosen.includes(at);
    ctx.regionsChosen = was ? ctx.regionsChosen.filter((r) => r !== at) : [...ctx.regionsChosen, at];
    showHandles();
    announce(`${lead}${t(was ? "draw.builder.unpicked" : "draw.builder.picked", { count: ctx.regionsChosen.length })}`);
  };
  ctx.pickRegion = pickRegion;

  /// Invio o Canc col Costruttore: unisce le regioni scelte, o con `erase` le
  /// toglie; senza, fa lo stesso con quella a cui si è arrivati. `false` se
  /// non ce n'è nessuna.
  const buildChosen = (erase: boolean): boolean => {
    const chosen = ctx.regionsChosen.length > 0 ? [...ctx.regionsChosen] : ctx.regionActive >= 0 ? [ctx.regionActive] : [];
    if (chosen.length === 0) return false;
    build(chosen, erase);
    return true;
  };
  ctx.buildChosen = buildChosen;

  // --- Le Forbici e il Coltello ------------------------------------------------

  /// Perché la forma `nodable` non si taglia, a parole.
  const uncutText = (nodable: Nodable | NoNodes): DrawKey =>
    typeof nodable === "string"
      ? NO_NODES[nodable]
      : nodable.kind === "arrow" ? "draw.scissors.arrow" : nodable.kind === "width" ? "draw.scissors.width" : "draw.nodes.stroke";

  /// Dove le Forbici tagliano vicino a `p`, un punto della scena: sul
  /// contorno della forma più in alto che vi passa, nel nodo se ci cade.
  /// Altrimenti perché no: la forma sotto non si taglia, o lì non passa un
  /// contorno.
  const cutSpotAt = (p: Point, pointer: InkPointerType): CutSpot | DrawKey => {
    const index = currentIndex();
    const near = NODE_PX[pointer] / ctx.camera.scale;
    const reach = HIT_PX[pointer] / ctx.camera.scale;
    const around = Math.max(near, reach);
    let refusal: DrawKey | null = null;
    for (let i = index.units.length - 1; i >= 0; i--) {
      const unit = index.units[i]!;
      if (!unit.hits(p, around)) continue;
      const shapes = unit.shapes();
      for (let k = shapes.length - 1; k >= 0; k--) {
        const { leaf, matrix } = shapes[k]!;
        const nodable = nodableAt(leaf);
        if (typeof nodable === "string" || !cuttable(nodable)) {
          if (unit.shapeAt(p, around) === leaf) refusal ??= uncutText(nodable);
          continue;
        }
        const node = nodeAt(nodable.subs, matrix, p, near);
        if (node !== null) {
          const [s, at] = parseKey(node);
          return { unit, leaf, nodable, matrix, spot: nodeSpot(nodable.subs, s, at), node, at: apply(matrix, nodable.subs[s]!.nodes[at]!) };
        }
        const spot = linkAt(nodable.subs, matrix, p, reach);
        if (spot !== null) {
          const { from, curve } = curveAt(nodable.subs[spot.sub]!, spot.link);
          return { unit, leaf, nodable, matrix, spot, node: null, at: apply(matrix, pointAt(from, curve, spot.t)) };
        }
      }
    }
    return refusal ?? "draw.scissors.miss";
  };
  ctx.cutSpotAt = cutSpotAt;

  /// Dove tagliano le Forbici, a parole: il nodo o il contorno, e di quale
  /// oggetto.
  const cutSpotText = (found: CutSpot): string => {
    const name = labelOf(found.unit);
    if (found.node === null) return t("draw.scissors.cursor.edge", { name });
    const [s, at] = parseKey(found.node);
    const before = found.nodable.subs.slice(0, s).reduce((sum, sub) => sum + sub.nodes.length, 0);
    return t("draw.scissors.cursor.node", { index: before + at + 1, name });
  };
  ctx.cutSpotText = cutSpotText;

  /// Il puntatore, o il cursore della tastiera, passa sopra `p` senza
  /// premere: con le Forbici si vede dove taglierebbero. Il dito non passa:
  /// tocca.
  const hoverCut = (p: Point | null, pointer: InkPointerType): void => {
    let next: typeof ctx.cutHover = null;
    if (p !== null && pointer !== "touch" && ctx.tool === "scissors" && has("scissors") && editable()) {
      const found = cutSpotAt(p, pointer);
      if (typeof found !== "string") next = { index: currentIndex(), spot: found };
    }
    if (next === null && ctx.cutHover === null) return;
    ctx.cutHover = next;
    showHandles();
  };
  ctx.hoverCut = hoverCut;

  /// Le Forbici sopra un contorno: il contorno e i nodi della forma, più
  /// tenui, e la croce dove tagliano. Il Coltello: la sua scia, o con Alt la
  /// linea dritta dal primo punto.
  const cutHandles = (): OverlayHandle[] => {
    const g = ctx.current?.kind === "cut" ? ctx.current : null;
    if (g !== null) {
      if (!g.dragging || g.from === null || g.end === null) return [];
      return [{ kind: "trail", points: ctx.alt ? [g.from, g.end] : [...g.trail, g.end] }];
    }
    const hovered = ctx.cutHover;
    if (hovered === null || ctx.tool !== "scissors" || hovered.index !== currentIndex()) return [];
    const { nodable, matrix, at } = hovered.spot;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(nodable.subs), matrix, hint: true }];
    for (const sub of nodable.subs) {
      sub.nodes.forEach((node, k) => {
        const [x, y] = apply(matrix, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, k) ? kindOf(sub, k) : "corner"], selected: false, hint: true });
      });
    }
    out.push({ kind: "cross", x: at[0], y: at[1] });
    return out;
  };
  ctx.cutHandles = cutHandles;

  /// Il punto `p` del gesto delle Forbici: oltre la soglia del trascinamento
  /// è il Coltello, e la scia lo segue.
  const cutAdd = (g: CutGesture, p: Point): void => {
    if (g.from === null) {
      g.from = p;
      g.end = p;
      g.trail.push(p);
      return;
    }
    g.end = p;
    if (!g.dragging && Math.hypot(p[0] - g.from[0], p[1] - g.from[1]) * ctx.camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    const tail = g.trail[g.trail.length - 1]!;
    if (Math.hypot(p[0] - tail[0], p[1] - tail[1]) * ctx.camera.scale < LASSO_STEP_PX) return;
    g.trail.push(p);
    if (g.trail.length > LASSO_MAX_POINTS) {
      const kept = g.trail.filter((_, at) => at % 2 === 0 || at === g.trail.length - 1);
      g.trail.splice(0, g.trail.length, ...kept);
    }
  };
  ctx.cutAdd = cutAdd;

  /// Il gesto delle Forbici finisce: un tocco taglia dove tocca, un
  /// trascinamento è il Coltello.
  const cutEnd = (g: CutGesture): void => {
    ctx.current = null;
    if (g.from === null || g.end === null) {
      showHandles();
      return;
    }
    if (g.dragging) {
      const tail = g.trail[g.trail.length - 1]!;
      const points = ctx.alt ? [g.from, g.end] : tail[0] === g.end[0] && tail[1] === g.end[1] ? [...g.trail] : [...g.trail, g.end];
      showHandles();
      knife(points);
      return;
    }
    const found = cutSpotAt(g.from, g.pointer);
    showHandles();
    if (typeof found === "string") announce(t(found));
    else snip(found);
  };
  ctx.cutEnd = cutEnd;

  /// Le Forbici tagliano in `found`, in un passo di annulla: ogni pezzo
  /// diventa un oggetto, e i pezzi sono la selezione. Di una forma in un
  /// gruppo, il gruppo.
  const snip = (found: CutSpot): void => {
    const model = ctx.engine.model;
    if (model === null) return;
    const cut = cutAt(found.nodable.subs, [found.spot]);
    if (cut === null) {
      announce(t("draw.scissors.end"));
      return;
    }
    const written = dsOf(piecesOf(cut));
    if (written === null) {
      announce(t("draw.unchanged"));
      return;
    }
    const plan = new Plan(model, newIds());
    const node = nodeOf(model, { path: pathOf(found.leaf) });
    const keys = writePieces(plan, node, written, tipsOfCut(cut));
    if (keys === null) {
      announce(t("draw.nodes.unwritable"));
      return;
    }
    const picked = found.unit.node === found.leaf ? keys : [plan.keyOf(found.unit.node, found.unit.key)];
    if (ctx.arrange("draw.action.scissors", plan.finish(picked)) === null) return;
    announce(written.length === 1 ? t("draw.scissors.opened") : t("draw.scissors.split", { count: written.length }));
  };

  /// Il Coltello lungo `points`, una spezzata della scena, in un passo di
  /// annulla: divide le forme chiuse che attraversa da parte a parte e
  /// taglia i tracciati aperti dove li incrocia. Taglia gli oggetti scelti,
  /// o senza selezione quelli che attraversa; i pezzi sono la selezione
  /// dopo, e di una forma in un gruppo il gruppo.
  const knife = (points: readonly Point[]): void => {
    const model = ctx.engine.model;
    if (model === null || points.length < 2) return;
    const blade: Subpath[] = [{ nodes: [...points], links: points.slice(1).map((): Link => ({ kind: "line" })), closed: false }];
    const reach = new BoundsBuilder();
    for (const p of points) reach.include(p);
    const box = reach.finish()!;
    const units = ctx.selection.length > 0
      ? selectedUnits()
      : currentIndex().units.filter(({ bounds }) => bounds !== null && bounds.max[0] >= box.min[0] && bounds.min[0] <= box.max[0] && bounds.max[1] >= box.min[1] && bounds.min[1] <= box.max[1]);
    const plan = new Plan(model, newIds());
    const picked: string[] = [];
    let objects = 0;
    let pieces = 0;
    let skipped = 0;
    for (const unit of units) {
      let inside = false;
      for (const { leaf, matrix } of unit.shapes()) {
        const inverse = invert(matrix);
        if (inverse === null) continue;
        const local = mapSubs(blade, inverse);
        const nodable = nodableAt(leaf);
        if (typeof nodable === "string") {
          if (unit.node === leaf && points.some((p, k) => k > 0 && unit.touches(points[k - 1]!, p, 0))) skipped++;
          continue;
        }
        if (!cuttable(nodable)) {
          if (crossings(nodable.subs, local).length > 0) skipped++;
          continue;
        }
        const knifed = knifePieces(nodable.subs, local);
        if (knifed === null) continue;
        const { pieces: written, tips } = knifed;
        const node = nodeOf(model, { path: pathOf(leaf) });
        // Una forma che non si riscrive si prova prima a parte: le sue
        // operazioni a metà non entrano nel passo delle altre.
        if (writePieces(new Plan(model, newIds()), node, written, tips) === null) {
          skipped++;
          continue;
        }
        const keys = writePieces(plan, node, written, tips)!;
        objects++;
        pieces += written.length;
        if (unit.node === leaf) picked.push(...keys);
        else inside = true;
      }
      if (inside) picked.push(plan.keyOf(unit.node, unit.key));
    }
    const rest = skipped === 0 ? "" : ` ${plural(skipped, "draw.knife.skipped.one", "draw.knife.skipped.other")}`;
    if (objects === 0) {
      announce(`${t("draw.knife.none")}${rest}`);
      return;
    }
    if (ctx.arrange("draw.action.knife", plan.finish(picked)) === null) return;
    announce(`${plural(objects, "draw.knife.cut.one", "draw.knife.cut.other", { pieces })}${rest}`);
  };
}
