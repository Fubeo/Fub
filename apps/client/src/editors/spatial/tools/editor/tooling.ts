// L'editor del disegno: gli strumenti e la pipeline della penna. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { InkPointerType } from "../../../../ink/input/pointer";
import { MAX_PEN_SIZE, MIN_PEN_SIZE } from "../../../../ink/pens";
import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { ContainerNode } from "../../scene/model";
import type { Tool } from "../../scene/analysis";
import { t } from "../../strings";
import { destination, destinationIn, destinationInto, NewIds, type Destination } from "../edit";
import { snapPoint } from "../grid";
import { turnTo } from "../../view";
import { SceneIndex, type Unit } from "../hit";
import { COVER_COLOR, customColor, DEFAULT_COLOR, HIGHLIGHTER_COLOR, RECENT_COLORS, swatchOf } from "../palette";
import { featuresFor, toolAfter, toolsOf, type Feature, type Level, type ToolId } from "../registry";
import type { EditorContext } from "./context";
import { layerRefusal, layerTitle } from "./helpers";
import type { DrawStyle } from "./types";

/// Quanti strumenti di prima l'editor ricorda per il menu radiale.
const RECENT_MAX = 6;

/// Ciò che gli strumenti, la pipeline della penna e le guide intelligenti dà agli altri pezzi dell'editor.
export interface ToolingContext {
  setLevel: (next: Level, custom?: readonly string[]) => void;
  setTool: (id: ToolId) => void;
  rememberColors: (...codes: string[]) => void;
  setColor: (value: string) => void;
  setWidth: (value: number) => void;
  pickTool: (id: ToolId) => void;
  cancelGesture: () => void;
  target: (ids: NewIds) => Destination | null;
  gridOn: (at?: ReadonlySet<Feature>) => boolean;
  snapped: (p: Point) => Point;
  pageBox: () => Bounds | null;
  seenUnits: (open?: readonly ContainerNode[]) => readonly Unit[];
  isolatedUnit: () => Unit | null;
  noted: (text: string, note: string) => string;
  /// Dove sta il puntatore che passa sul foglio: la corda dello
  /// stabilizzatore arriva lì.
  pointerAt: { readonly at: Point; readonly pointer: InkPointerType } | null;
}

/// Monta gli strumenti e la pipeline della penna.
export function installTooling(ctx: EditorContext): void {
  const {
    profile, folio, has, styles, style, toolLabel, widthsNow, showSurfaceHint, suggestions, indexer, isolatedNode, isolatedThrough, isolationSteps, currentIndex, currentPage, announce, showPage, showGrid,
    setCamera, stepNow, viewCenter, showGrip, showHandles,
    showPanelByDefault, currentLayer, syncControls, nameOfNode, options
  } = ctx;
  // --- Strumenti --------------------------------------------------------------

  function setLevel(next: Level, custom: readonly string[] = ctx.picked): void {
    ctx.picked = custom;
    const offered = featuresFor(next, ctx.picked, profile);
    if (next === ctx.level && offered.size === ctx.features.size && [...offered].every((feature) => ctx.features.has(feature))) return;
    const hadPanel = has("properties");
    ctx.level = next;
    ctx.features = offered;
    // Senza la vista girata, il foglio torna dritto.
    if (!has("gestures") && ctx.camera.angle !== 0) setCamera(turnTo(ctx.camera, 0, viewCenter()));
    ctx.tools = toolsOf(ctx.features);
    if (!ctx.tools.some((spec) => spec.id === ctx.tool)) {
      cancelGesture();
      ctx.tool = toolAfter(ctx.tools, ctx.tool, profile);
    }
    // Senza i colori a piacere la barra non ha un campione per uno di loro:
    // chi lo usava riparte dai colori di partenza, che la barra mostra.
    if (!has("colors")) {
      const starts: Readonly<Record<Tool | "cover", string>> = { pen: DEFAULT_COLOR, highlighter: HIGHLIGHTER_COLOR, cover: COVER_COLOR };
      for (const [name, each] of Object.entries(styles) as Array<[Tool | "cover", DrawStyle]>) {
        if (swatchOf(each.color) !== null) continue;
        each.color = starts[name];
      }
    }
    showSurfaceHint();
    showGrid();
    syncControls();
    suggestions.relabel();
    // Il pannello arriva come lo vuole chi disegna.
    if (!hadPanel && has("properties")) showPanelByDefault();
    // I righelli vanno e vengono col livello, e la cornice con loro.
    showHandles();
  }
  ctx.setLevel = setLevel;

  function setTool(id: ToolId): void {
    if (!ctx.tools.some((spec) => spec.id === id)) return;
    if (id !== ctx.tool) {
      cancelGesture();
      ctx.recentTools = [ctx.tool, ...ctx.recentTools.filter((each) => each !== ctx.tool && each !== id)].slice(0, RECENT_MAX);
    }
    ctx.tool = id;
    syncControls();
    showPage();
    showHandles();
    showGrip(null);
    ctx.hoverNib(ctx.pointerAt?.at ?? null, ctx.pointerAt?.pointer ?? "mouse");
    announce(t("draw.announce.tool", { tool: t(toolLabel(id)) }));
  }
  ctx.setTool = setTool;

  /// Mette `codes`, colori `#rrggbb` appena scelti, il primo come il più
  /// recente, davanti ai colori recenti, e lo dice a chi monta l'editor. I
  /// recenti sono colori scritti: un campione ha la sua griglia, e da un
  /// recente si scriverebbe staccato da lui.
  function rememberColors(...codes: string[]): void {
    const next = [...codes, ...ctx.recentColors].filter((each, at, all) => all.indexOf(each) === at).slice(0, RECENT_COLORS);
    if (next.length === ctx.recentColors.length && next.every((each, at) => each === ctx.recentColors[at])) return;
    ctx.recentColors = next;
    options.onColorsChange?.(ctx.recentColors);
  }
  ctx.rememberColors = rememberColors;

  /// Il colore dello strumento di adesso, `value` come lo legge
  /// `customColor`. Un colore fuori dalla tavolozza chiede i colori
  /// personalizzati. Anche il colore di prima resta fra i recenti, per il
  /// menu radiale.
  function setColor(value: string): void {
    const code = customColor(value);
    if (code === null) return;
    if (swatchOf(code) === null) {
      if (!has("colors")) return;
      ctx.custom = code;
    }
    rememberColors(code, style().color);
    style().color = code;
    syncControls();
  }
  ctx.setColor = setColor;

  function setWidth(value: number): void {
    // La Penna e l'Evidenziatore prendono ogni misura da 0,25 a 200; gli
    // altri soltanto quelle della barra.
    const free = (ctx.tool === "pen" || ctx.tool === "highlighter") && value >= MIN_PEN_SIZE && value <= MAX_PEN_SIZE;
    if (!free && !widthsNow().some((option) => option.value === value)) return;
    style().width = value;
    syncControls();
  }
  ctx.setWidth = setWidth;

  /// Lo strumento `id` scelto dalla barra o dal suo tasto.
  function pickTool(id: ToolId): void {
    setTool(id);
  }
  ctx.pickTool = pickTool;


  function cancelGesture(): void {
    if (ctx.pressed !== null) ctx.cancelPress();
    else if (ctx.current !== null) ctx.pen.cancel();
  }
  ctx.cancelGesture = cancelGesture;

  // --- La pipeline della penna ------------------------------------------------

  /// Il livello che riceve: quello corrente, quando l'interfaccia offre i
  /// livelli; senza, il più alto che si vede e non è bloccato; sul foglio
  /// delle annotazioni, il gruppo della pagina. Se non c'è o non riceve, lo
  /// si dice, e il gesto non scrive.
  const target = (ids: NewIds): Destination | null => {
    if (folio !== undefined) {
      const model = ctx.engine.model;
      const to = model === null ? null : folio.destination(model, currentIndex(), ids, (id) => ctx.engine.holder(id) !== null);
      if (to === null) announce(t("draw.no_page"));
      return to;
    }
    // Con un gruppo isolato, ciò che si disegna entra lì, in cima.
    const group = isolatedUnit();
    if (group !== null) {
      const to = destinationInto(group, ids);
      if (to === null) announce(t("draw.layer.flat", { name: nameOfNode(group.node) }));
      return to;
    }
    const layer = has("layers") ? currentLayer() : null;
    if (layer === null) {
      const to = destination(currentIndex(), ids);
      if (to === null) announce(t("draw.no_layer"));
      return to;
    }
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    if (refusal !== null) {
      announce(t(refusal, { name }));
      return null;
    }
    const to = destinationIn(layer, ids);
    if (to === null) announce(t("draw.layer.flat", { name }));
    return to;
  };
  ctx.target = target;

  /// La griglia aggancia: se il livello la offre, con l'aggancio acceso. `at`
  /// sono le parti da guardare, di solito quelle di adesso.
  const gridOn = (at: ReadonlySet<Feature> = ctx.features): boolean => at.has("grid") && ctx.grid.snap;
  ctx.gridOn = gridOn;

  /// Un punto di un gesto: sull'incrocio più vicino quando la griglia
  /// aggancia e Ctrl o ⌘ non è tenuto.
  const snapped = (p: Point): Point => (gridOn() && !ctx.free ? snapPoint(p, stepNow()) : p);
  ctx.snapped = snapped;

  /// La pagina nella scena, se c'è.
  const pageBox = (): Bounds | null => {
    const page = currentPage();
    return page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };
  ctx.pageBox = pageBox;

  /// Gli oggetti che si vedono nel disegno di adesso, anche nei livelli
  /// bloccati. Del gruppo isolato e dei contenitori `open` i figli uno per
  /// uno; quelli senza `open` si tengono finché la scena non cambia.
  let seenCache: { readonly index: SceneIndex; readonly units: readonly Unit[] } | null = null;
  const seenUnits = (open: readonly ContainerNode[] = []): readonly Unit[] => {
    const index = currentIndex();
    const model = ctx.engine.model;
    if (model === null) return [];
    const opened = new Set([...(isolationSteps() ?? []).map((step) => step.node), ...open]);
    const through = isolatedThrough();
    if (open.length > 0) return indexer.seen(model, opened, through);
    if (seenCache?.index !== index) seenCache = { index, units: indexer.seen(model, opened, through) };
    return seenCache.units;
  };
  ctx.seenUnits = seenUnits;

  /// Il gruppo isolato come oggetto, che riceve ciò che si disegna; `null`
  /// senza gruppo isolato. Un simbolo ha le coordinate dell'istanza da cui
  /// lo si modifica.
  const isolatedUnit = (): Unit | null => (isolatedNode() === null ? null : currentIndex().scope());
  ctx.isolatedUnit = isolatedUnit;

  /// `text` e, dopo, la nota delle guide, se c'è.
  const noted = (text: string, note: string): string => (note === "" ? text : `${text} ${note}`);
  ctx.noted = noted;

  ctx.pointerAt = null;

}
