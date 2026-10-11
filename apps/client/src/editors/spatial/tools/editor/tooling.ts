// L'editor del disegno: gli strumenti, la pipeline della penna e le guide
// intelligenti. Un pezzo di createDrawEditor (`../editor.ts`): lavora sul
// contesto che i pezzi condividono.

import { promptForm } from "../../../../ui/form-dialog";
import { formatNumber } from "../../number";
import type { InkPointerType } from "../../pen/pen-input";
import type { Bounds } from "../../scene/geometry";
import { apply, compose, type Point } from "../../scene/matrix";
import type { ContainerNode } from "../../scene/model";
import type { Tool } from "../../scene/analysis";
import { t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { destination, destinationIn, destinationInto, NewIds, type Destination } from "../edit";
import { rectBounds } from "../boards";
import { pull, upright, type Axis as FrameAxis } from "../frame";
import {
  anchorsOf,
  GUIDE_PX,
  GuideIndex,
  measure as measureBetween,
  nearer,
  ON_GUIDE,
  type Edge as GuideEdge,
  type GuideLine,
  type GuideTarget,
  type Spacing,
} from "../guides";
import { nodeKey, parseKey } from "../nodes";
import type { PenNode } from "../bezier";
import { snapPoint } from "../grid";
import { turnTo, type View } from "../../view";
import { SceneIndex, type Unit } from "../hit";
import { COVER_COLOR, customColor, DEFAULT_COLOR, HIGHLIGHTER_COLOR, RECENT_COLORS, swatchOf } from "../palette";
import { featuresFor, toolAfter, toolsOf, type Feature, type Level, type ToolId } from "../registry";
import type { PolygonTool } from "../shapes";
import { HIT_PX, NO_KEYS } from "./constants";
import type { EditorContext } from "./context";
import { disjoint, layerRefusal, layerTitle, translated } from "./helpers";
import type { DrawStyle, NodeGrab, NodesGesture } from "./types";

/// Quanti strumenti di prima l'editor ricorda per il menu radiale.
const RECENT_MAX = 6;

/// Ciò che le guide intelligenti mostrano: le linee su cui sta ciò che si
/// muove, e le distanze uguali.
interface GuideView {
  readonly lines: readonly GuideLine[];
  readonly spacings: readonly Spacing[];
}

/// I nomi dei bordi e dei centri da dire, per asse.
const EDGE_NAMES: readonly [Readonly<Record<GuideEdge, DrawKey>>, Readonly<Record<GuideEdge, DrawKey>>] = [
  { min: "draw.guides.edge.left", mid: "draw.guides.edge.center_x", max: "draw.guides.edge.right", point: "draw.guides.edge.point" },
  { min: "draw.guides.edge.top", mid: "draw.guides.edge.center_y", max: "draw.guides.edge.bottom", point: "draw.guides.edge.point" },
];

/// Ciò che gli strumenti, la pipeline della penna e le guide intelligenti dà agli altri pezzi dell'editor.
export interface ToolingContext {
  setLevel: (next: Level, custom?: readonly string[]) => void;
  setTool: (id: ToolId) => void;
  rememberColors: (...codes: string[]) => void;
  setColor: (value: string, from?: { readonly swatch: string | null } | null) => void;
  setWidth: (value: number) => void;
  chooseColor: () => Promise<void>;
  pickTool: (id: ToolId) => void;
  setPolygonTool: (next: PolygonTool) => void;
  cancelGesture: () => void;
  target: (ids: NewIds) => Destination | null;
  gridOn: (at?: ReadonlySet<Feature>) => boolean;
  snapped: (p: Point) => Point;
  smartOn: (at?: ReadonlySet<Feature>) => boolean;
  guidesOn: (at?: ReadonlySet<Feature>) => boolean;
  guideReach: (pointer: InkPointerType) => number;
  pageBox: () => Bounds | null;
  seenUnits: (open?: readonly ContainerNode[]) => readonly Unit[];
  isolatedUnit: () => Unit | null;
  seenTargets: (skipped: ReadonlySet<string>, open: readonly ContainerNode[], view: Bounds | null) => GuideTarget[];
  rulerTargets: (skip: number | null) => GuideTarget[];
  guidesFor: (owner: object, skip: readonly string[], points?: () => readonly Point[], skipGuide?: number | null) => GuideIndex;
  guided: (p: Point, guides: () => GuideIndex, pointer: InkPointerType) => Point;
  nodeDragTo: (g: NodesGesture, grab: Extract<NodeGrab, { readonly origin: Point }>) => Point;
  noNodes: readonly PenNode[];
  bezierGuides: () => GuideIndex;
  /// Le guide si vedono, e le misure con Alt: col gesto che finisce, o col
  /// tasto lasciato, vanno tolte.
  guiding: boolean;
  measured: boolean;
  guideHandles: () => OverlayHandle[];
  snapNote: () => string;
  noted: (text: string, note: string) => string;
  /// Dove sta il puntatore che passa sul foglio: le misure con Alt partono
  /// da lì.
  pointerAt: { readonly at: Point; readonly pointer: InkPointerType } | null;
  measureHandles: () => OverlayHandle[];
}

/// Monta gli strumenti, la pipeline della penna e le guide intelligenti.
export function installTooling(ctx: EditorContext): void {
  const {
    profile, folio, has, styles, style, toolLabel, widthsNow, live, showSurfaceHint, showToolMode, customLabel, suggestions, field, indexer, boardsNow,
    chosenSheet, sheetAt, editable, isolatedNode, isolatedThrough, isolationSteps, currentIndex, currentPage, announce, showPage, surfaceSize, showGrid,
    setCamera, stepNow, lengthText, lengthSpoken, guidesShown, showGuideLines, viewCenter, selectedUnits, pickedIn, editedUnits, showGrip, showHandles,
    labelOf, showPanelByDefault, syncProperties, currentLayer, syncControls, nameOfNode, options
  } = ctx;
  // --- Strumenti --------------------------------------------------------------

  function setLevel(next: Level, custom: readonly string[] = ctx.picked): void {
    ctx.picked = custom;
    const offered = featuresFor(next, ctx.picked, profile);
    if (next === ctx.level && offered.size === ctx.features.size && [...offered].every((feature) => ctx.features.has(feature))) return;
    ctx.finishText();
    // Il tracciato della penna di Bézier si conclude prima che la penna se
    // ne vada.
    if (!offered.has("bezier")) {
      cancelGesture();
      ctx.finishBezier(false, true);
    }
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
    // Senza i colori del documento il colore non segue più un campione; senza
    // i colori a piacere la barra non ha un campione per uno di loro: chi lo
    // usava riparte dai colori di partenza, che la barra mostra.
    if (!has("swatches")) for (const each of Object.values(styles)) each.swatch = null;
    if (!has("colors")) {
      const starts: Readonly<Record<Tool | "cover", string>> = { pen: DEFAULT_COLOR, highlighter: HIGHLIGHTER_COLOR, cover: COVER_COLOR };
      for (const [name, each] of Object.entries(styles) as Array<[Tool | "cover", DrawStyle]>) {
        if (swatchOf(each.color) !== null) continue;
        each.color = starts[name];
        each.swatch = null;
      }
    }
    showSurfaceHint();
    showGrid();
    showGuideLines();
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
    // Cambiare strumento conclude il tracciato della penna di Bézier, come in
    // Inkscape: ciò che ne dice la fine precede il nome dello strumento.
    let finished = "";
    if (id !== ctx.tool) {
      ctx.finishText();
      cancelGesture();
      const before = live.textContent;
      ctx.finishBezier(false, true);
      // E applica il ritaglio, come in Illustrator.
      ctx.applyCrop();
      if (live.textContent !== before) finished = (live.textContent ?? "").trim();
      ctx.recentTools = [ctx.tool, ...ctx.recentTools.filter((each) => each !== ctx.tool && each !== id)].slice(0, RECENT_MAX);
      ctx.forgetBuilder();
      // Il punto scelto dello Spessore è dello strumento, e le immagini
      // aperte del contagocce, e il capo scelto della sfumatura: il punto
      // scelto è anche del pannello.
      ctx.widthPicked = null;
      ctx.widthHover = null;
      ctx.dropperHover = null;
      ctx.dropPixels();
      ctx.gradientGrip = null;
      ctx.gradientTap = null;
    }
    ctx.tool = id;
    // Lo strumento Tavola sceglie le tavole, non gli oggetti: la selezione si
    // lascia, e senza una tavola scelta si sceglie quella che si guarda.
    if (id === "board") {
      ctx.selection = [];
      if (chosenSheet() === null) ctx.boardChosen = ctx.sheetInView();
    }
    syncControls();
    // La cornice è dello strumento Selezione, il nome della tavola scelta
    // si fa più scuro con lo strumento Tavola.
    showPage();
    showHandles();
    showGrip(null);
    // Il contagocce mostra subito che cosa vede sotto il puntatore, e lo
    // strumento Sfumatura che cosa sposterebbe.
    if (id === "eyedropper" && ctx.pointerAt !== null) ctx.hoverDropper(ctx.pointerAt.at, ctx.pointerAt.pointer);
    if (id === "gradient" && ctx.pointerAt !== null) ctx.hoverGradient(ctx.pointerAt.at, ctx.pointerAt.pointer);
    ctx.connectorHover = null;
    if (id === "connector" && ctx.pointerAt !== null) ctx.hoverConnector(ctx.pointerAt.at, ctx.pointerAt.pointer);
    const named = t("draw.announce.tool", { tool: t(toolLabel(id)) });
    // Con lo strumento Nodi, anche di che cosa si modificano i nodi; col
    // Costruttore, su quante regioni lavora; con lo strumento Tavola, quale
    // tavola è scelta; col contagocce, dove va ciò che prende; con lo
    // strumento Sfumatura, dove va la sfumatura.
    const sheet = id === "board" ? chosenSheet() : null;
    const target =
      id === "nodes"
        ? ctx.targetText()
        : id === "builder"
          ? ctx.builderText()
          : id === "eyedropper"
            ? ctx.dropperFor()
            : id === "gradient"
              ? ctx.gradientFor()
              : sheet !== null
                ? ctx.sheetText(sheet)
                : id === "pen" || id === "highlighter"
                  ? ctx.symmetryText()
                  : "";
    announce([finished, named, target].filter((part) => part !== "").join(" "));
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
  /// personalizzati, tranne quello che viene dai colori del documento
  /// (`from`), che li offrono già; `from.swatch` è il campione da cui viene,
  /// che gli oggetti nuovi usano. Anche il colore di prima resta fra i
  /// recenti, per il menu radiale.
  function setColor(value: string, from: { readonly swatch: string | null } | null = null): void {
    const code = customColor(value);
    if (code === null) return;
    if (swatchOf(code) === null) {
      if (!has("colors") && from === null) return;
      ctx.custom = code;
    }
    const before = style();
    const swatch = from?.swatch ?? null;
    const written: string[] = [];
    if (swatch === null) written.push(code);
    if (before.swatch === null) written.push(before.color);
    rememberColors(...written);
    style().color = code;
    style().swatch = swatch;
    syncControls();
    // Mentre si scrive, il colore va a ciò che è scelto nel campo, o a ciò
    // che si scriverà; e così il tracciato della penna.
    restyleTyping("fill", code);
    if (ctx.drafting !== null) ctx.showBezier();
  }
  ctx.setColor = setColor;

  function setWidth(value: number): void {
    if (!widthsNow().some((option) => option.value === value)) return;
    style().width = value;
    syncControls();
    if (ctx.tool === "text") restyleTyping("font-size", formatNumber(value, 2));
    if (ctx.drafting !== null) ctx.showBezier();
  }
  ctx.setWidth = setWidth;

  /// Il colore o il corpo che la barra dà mentre si scrive: a ciò che è
  /// scelto nel campo; senza scelta, a tutto un testo nuovo, che è della
  /// barra, e a ciò che si scriverà in uno che c'era.
  function restyleTyping(name: "fill" | "font-size", value: string): void {
    if (ctx.typing === null) return;
    if (ctx.typing.key === null) field.restyleWhole(name, value);
    else field.restyle(name, value);
    ctx.placeText();
  }

  /// «Altro colore…»: il codice, o il selettore del sistema. Un colore della
  /// tavolozza sceglie il suo campione.
  async function chooseColor(): Promise<void> {
    if (ctx.asking || !editable() || !has("colors")) return;
    ctx.asking = true;
    cancelGesture();
    try {
      const answer = await promptForm({
        title: t("draw.color.dialog"),
        fields: [{ id: "color", label: t("draw.color.code"), value: style().color, kind: "color" }],
      });
      if (answer === null || ctx.disposed) return;
      const code = customColor(answer.color ?? "");
      if (code === null) return;
      setColor(code);
      const swatch = swatchOf(code);
      announce(t("draw.announce.color", { color: swatch === null ? customLabel() : t(swatch.label) }));
    } finally {
      ctx.asking = false;
    }
  }
  ctx.chooseColor = chooseColor;

  /// Lo strumento `id` scelto dalla barra o dal suo tasto. Il Poligono scelto
  /// di nuovo passa dal poligono alla stella, e ritorno; la penna di Bézier
  /// alla Curvatura, e ritorno.
  function pickTool(id: ToolId): void {
    if (id === "polygon" && ctx.tool === "polygon") togglePolygon();
    else if (id === "bezier" && ctx.tool === "bezier") toggleCurvature();
    else setTool(id);
  }
  ctx.pickTool = pickTool;

  /// Lo strumento Poligono come `next`: la forma che si sta tirando, il
  /// pulsante e il pannello lo seguono.
  function setPolygonTool(next: PolygonTool): void {
    const turned = next.shape !== ctx.polygonTool.shape;
    ctx.polygonTool = next;
    if (turned) showToolMode("polygon");
    if (ctx.current?.kind === "shape" && ctx.current.tool === "polygon") ctx.drawShape(ctx.current);
    syncProperties();
  }
  ctx.setPolygonTool = setPolygonTool;

  /// Dal poligono alla stella, e ritorno, anche a metà gesto.
  function togglePolygon(): void {
    setPolygonTool({ ...ctx.polygonTool, shape: ctx.polygonTool.shape === "star" ? "polygon" : "star" });
    announce(t("draw.announce.tool", { tool: t(toolLabel("polygon")) }));
  }

  /// Dalla penna alla Curvatura, e ritorno. Il tracciato in corso resta: i
  /// nodi che ha tengono il loro modo, i prossimi prendono l'altro. Il gesto
  /// in corso finisce come era cominciato.
  function toggleCurvature(): void {
    ctx.curvature = !ctx.curvature;
    ctx.curveTap = null;
    showToolMode("bezier");
    if (ctx.drafting !== null) ctx.showBezier();
    else showHandles();
    announce(t("draw.announce.tool", { tool: t(toolLabel("bezier")) }));
  }

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

  // --- Le guide intelligenti -------------------------------------------------

  /// Le guide intelligenti agganciano agli oggetti e alla pagina: se il
  /// livello le offre, accese. `at` sono le parti da guardare, di solito
  /// quelle di adesso.
  const smartOn = (at: ReadonlySet<Feature> = ctx.features): boolean => at.has("guides") && ctx.grid.guides;
  ctx.smartOn = smartOn;

  /// Le guide del documento agganciano: se si vedono, e ce n'è una.
  const rulerGuidesOn = (at: ReadonlySet<Feature> = ctx.features): boolean => guidesShown(at) && (ctx.scene.root.guides?.length ?? 0) > 0;

  /// Qualcosa aggancia ciò che si muove: le guide intelligenti, o quelle del
  /// documento.
  const guidesOn = (at: ReadonlySet<Feature> = ctx.features): boolean => smartOn(at) || rulerGuidesOn(at);
  ctx.guidesOn = guidesOn;

  /// La soglia delle guide nella scena, per il puntatore `pointer`.
  const guideReach = (pointer: InkPointerType): number => GUIDE_PX[pointer] / ctx.camera.scale;
  ctx.guideReach = guideReach;

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

  /// I gruppi che contengono gli oggetti di chiave `keys`, fino al livello:
  /// chi si sposta da dentro un gruppo si allinea ai suoi fratelli, e non al
  /// gruppo che lo contiene.
  const openedBy = (keys: readonly string[]): ContainerNode[] => {
    const index = currentIndex();
    const out: ContainerNode[] = [];
    for (const key of keys) {
      for (let at = index.get(key)?.node.parent ?? null; at !== null && at.parent !== null && at.details?.role !== "layer"; at = at.parent) out.push(at);
    }
    return out;
  };

  /// Il gruppo isolato come oggetto, che riceve ciò che si disegna; `null`
  /// senza gruppo isolato. Un simbolo ha le coordinate dell'istanza da cui
  /// lo si modifica.
  const isolatedUnit = (): Unit | null => (isolatedNode() === null ? null : currentIndex().scope());
  ctx.isolatedUnit = isolatedUnit;

  /// Gli oggetti che si vedono nella vista `view`, o tutti senza, come
  /// bersagli delle guide: tranne quelli di chiave in `skipped`, e coi
  /// gruppi `open` aperti.
  const seenTargets = (skipped: ReadonlySet<string>, open: readonly ContainerNode[], view: Bounds | null): GuideTarget[] => {
    const out: GuideTarget[] = [];
    for (const unit of seenUnits(open)) {
      const box = unit.geometry ?? unit.bounds;
      if (box === null || skipped.has(unit.key) || (view !== null && disjoint(box, view))) continue;
      out.push({ kind: "object", box, key: unit.key });
    }
    return out;
  };
  ctx.seenTargets = seenTargets;

  /// Le guide del documento come bersagli, se agganciano, tranne la guida
  /// `skip`.
  const rulerTargets = (skip: number | null): GuideTarget[] => {
    if (!rulerGuidesOn()) return [];
    const out: GuideTarget[] = [];
    (ctx.scene.root.guides ?? []).forEach((guide, i) => {
      if (i === skip) return;
      out.push({ kind: "guide", box: { min: [guide.at, guide.at], max: [guide.at, guide.at] }, key: String(i), axis: guide.axis === "x" ? 0 : 1 });
    });
    return out;
  };
  ctx.rulerTargets = rulerTargets;

  /// I bersagli di `owner`, un gesto o i nodi della penna di Bézier, presi la
  /// prima volta che servono e tenuti finché la scena e la vista restano
  /// quelle: con le guide intelligenti gli oggetti che si vedono nella
  /// vista, tranne quelli di chiave `skip`, la pagina, o le tavole che si
  /// vedono, e i punti `points`; con le guide del documento, quelle, tranne
  /// la guida `skipGuide`. Ci si allinea a ciò che si guarda; un foglio non
  /// ancora disposto, senza misure, vede tutto.
  let guideCache: { readonly owner: object; readonly index: SceneIndex; readonly view: View; readonly guides: GuideIndex } | null = null;
  const guidesFor = (owner: object, skip: readonly string[], points: () => readonly Point[] = () => [], skipGuide: number | null = null): GuideIndex => {
    const index = currentIndex();
    if (guideCache !== null && guideCache.owner === owner && guideCache.index === index && guideCache.view === ctx.camera) return guideCache.guides;
    const targets: GuideTarget[] = [];
    if (smartOn()) {
      const size = surfaceSize();
      const view = size.w > 0 && size.h > 0 ? ctx.viewBounds() : null;
      targets.push(...seenTargets(new Set(skip), openedBy(skip), view));
      // Con le tavole, ognuna fa da pagina.
      const list = boardsNow();
      for (const board of list) if (view === null || !disjoint(board.box, view)) targets.push({ kind: "page", box: board.box, key: board.id });
      const page = list.length === 0 ? pageBox() : null;
      if (page !== null) targets.push({ kind: "page", box: page, key: "" });
      for (const p of points()) targets.push({ kind: "node", box: { min: p, max: p }, key: "" });
    }
    targets.push(...rulerTargets(skipGuide));
    const guides = new GuideIndex(targets);
    guideCache = { owner, index, view: ctx.camera, guides };
    return guides;
  };
  ctx.guidesFor = guidesFor;

  /// Un punto di un gesto, con la griglia e con le guide di `guides`: lungo
  /// ciascun asse sulla riga o sul bersaglio più vicino, a pari distanza sul
  /// bersaglio, finché Ctrl o ⌘ non è tenuto.
  const guided = (p: Point, guides: () => GuideIndex, pointer: InkPointerType): Point => {
    if (ctx.free) return p;
    const line = gridOn() ? snapPoint(p, stepNow()) : null;
    if (!guidesOn()) return line ?? p;
    const index = guides();
    const reach = guideReach(pointer);
    const along = (axis: FrameAxis): number => nearer(p[axis], index.nearest(axis, p[axis], reach), line === null ? null : line[axis]);
    return [along(0), along(1)];
  };
  ctx.guided = guided;

  /// I nodi delle forme che si modificano che restano fermi, nella scena:
  /// bersagli delle guide. Con `moving` si muovono quelli scelti; senza, si
  /// muove una maniglia, che si allinea anche al suo nodo.
  const fixedNodes = (moving: boolean): Point[] => {
    const out: Point[] = [];
    for (const edit of ctx.edits) {
      const chosen = moving ? pickedIn(edit) : NO_KEYS;
      edit.subs.forEach((sub, s) => {
        sub.nodes.forEach((node, at) => {
          if (!chosen.has(nodeKey(s, at))) out.push(apply(edit.matrix, node));
        });
      });
    }
    return out;
  };

  /// Dove il trascinamento `g` porta il nodo o la maniglia presi, con la
  /// griglia e con le guide: un nodo si allinea agli altri oggetti e ai nodi
  /// che restano fermi, una maniglia anche al suo nodo.
  const nodeDragTo = (g: NodesGesture, grab: Extract<NodeGrab, { readonly origin: Point }>): Point => {
    const p: Point = [grab.origin[0] + g.end![0] - g.from![0], grab.origin[1] + g.end![1] - g.from![1]];
    return guided(p, () => guidesFor(g, editedUnits(), () => fixedNodes(grab.kind === "node" && !grab.pull)), g.pointer);
  };
  ctx.nodeDragTo = nodeDragTo;

  /// I nodi della penna di Bézier, finché il tracciato non ne ha.
  const noNodes: readonly PenNode[] = [];
  ctx.noNodes = noNodes;

  /// I bersagli della penna di Bézier: gli oggetti e i nodi già posati.
  const bezierGuides = (): GuideIndex => {
    const nodes = ctx.drafting?.nodes ?? noNodes;
    return guidesFor(nodes, [], () => nodes.map((node) => node.at));
  };
  ctx.bezierGuides = bezierGuides;

  /// Ciò che le guide mostrano adesso: le linee del gesto in corso, o del
  /// punto che la penna di Bézier poserebbe; per uno spostamento anche le
  /// distanze uguali. `null` se le guide non agganciano.
  const guideView = (): GuideView | null => {
    if (ctx.free || !guidesOn()) return null;
    const point = (index: GuideIndex, p: Point): GuideView => {
      const box: Bounds = { min: p, max: p };
      return { lines: [...index.lines(0, box, [{ value: p[0], edge: "point" }]), ...index.lines(1, box, [{ value: p[1], edge: "point" }])], spacings: [] };
    };
    // Le linee di ciò che si è spostato in `moved`, e le distanze uguali.
    const movedView = (index: GuideIndex, moved: Bounds): GuideView => {
      const lines: GuideLine[] = [];
      const spacings: Spacing[] = [];
      for (const axis of [0, 1] as const) {
        lines.push(...index.lines(axis, moved, anchorsOf(moved, axis)));
        const spacing = index.spacing(axis, moved);
        if (spacing !== null) spacings.push(spacing);
      }
      return { lines, spacings };
    };
    // Una forma tirata dal pannello mostra a che cosa si è agganciata.
    if (ctx.shapeDrag?.box != null) return movedView(guidesFor(ctx.shapeDrag, []), ctx.shapeDrag.box);
    const g = ctx.current;
    if (g?.kind === "select" && g.mode === "move") {
      const box = ctx.geometryOf(g.units);
      if (box === null) return null;
      return movedView(guidesFor(g, g.units.map((unit) => unit.key)), translated(box, ...ctx.moveDelta(g))!);
    }
    if (g?.kind === "board" && g.mode === "move" && g.sheet !== null) return movedView(ctx.boardGuides(g), translated(rectBounds(g.sheet.rect), ...ctx.boardDelta(g))!);
    if (g?.kind === "board" && g.mode === "resize" && g.rect !== null && g.grip !== null) {
      // I bordi tirati.
      const box = rectBounds(g.rect);
      const index = ctx.boardGuides(g);
      const lines: GuideLine[] = [];
      for (const axis of [0, 1] as const) {
        const direction = pull(g.grip, axis);
        if (direction !== 0) lines.push(...index.lines(axis, box, [{ value: direction > 0 ? box.max[axis] : box.min[axis], edge: direction > 0 ? "max" : "min" }]));
      }
      return { lines, spacings: [] };
    }
    if (g?.kind === "board" && g.mode === "draw") {
      const end = ctx.drawnEnd(g);
      return end === null ? null : point(ctx.boardGuides(g), end);
    }
    if (g?.kind === "select" && g.mode === "resize" && g.grip !== null && g.matrix !== null) {
      const { grip, frame } = g.grip;
      if (grip === "rotate" || !upright(frame.matrix)) return null;
      // La geometria dopo il ridimensionamento, e i bordi tirati.
      const m = compose(g.matrix, frame.matrix);
      const a = apply(m, frame.geometry.min);
      const b = apply(m, frame.geometry.max);
      const box: Bounds = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
      const index = guidesFor(g, g.units.map((unit) => unit.key));
      const lines: GuideLine[] = [];
      for (const axis of [0, 1] as const) {
        const direction = pull(grip, axis);
        if (direction === 0) continue;
        const value = (direction > 0 ? b : a)[axis];
        const edge: GuideEdge = Math.abs(value - box.min[axis]) <= Math.abs(value - box.max[axis]) ? "min" : "max";
        lines.push(...index.lines(axis, box, [{ value, edge }]));
      }
      return { lines, spacings: [] };
    }
    if (g?.kind === "shape") {
      const ends = ctx.shapeEnds(g, g.to);
      return ends === null ? null : point(guidesFor(g, []), apply(g.to.matrix, ends[1]));
    }
    if (g?.kind === "nodes" && g.dragging && g.from !== null && g.end !== null && ctx.edits.length > 0) {
      const grab = g.grab;
      if (grab?.kind !== "node" && grab?.kind !== "handle") return null;
      return point(guidesFor(g, editedUnits(), () => fixedNodes(grab.kind === "node" && !grab.pull)), nodeDragTo(g, grab));
    }
    if (g?.kind === "bezier" && g.mode === "path") {
      if (g.reshaped === null) return null;
      const [s, at] = parseKey(g.reshaped.key);
      return point(guidesFor(g, editedUnits()), apply(g.path!.edit.matrix, g.reshaped.subs[s]!.nodes[at]!));
    }
    if (g?.kind === "bezier" && g.mode !== null && g.curve) {
      // La Curvatura sposta punti, non maniglie.
      if (g.dragging) return point(g.mode === "add" ? bezierGuides() : ctx.curveGuides(g), ctx.curveMoved(g));
      return g.mode === "add" ? point(bezierGuides(), g.at!) : null;
    }
    if (g?.kind === "bezier" && g.mode !== null) {
      const p = g.dragging ? ctx.bezierHandle(g) : g.mode === "add" ? g.at : null;
      return p === null ? null : point(bezierGuides(), p);
    }
    if (g === null && ctx.tool === "bezier" && ctx.hover !== null && ctx.drawing() !== null) return point(bezierGuides(), ctx.bezierPoint(ctx.hover.at, ctx.hover.pointer));
    if (g?.kind === "gradient" && g.dragging && g.snapped !== null) return point(ctx.gradientGuides(g), g.snapped);
    return null;
  };

  ctx.guiding = false;
  ctx.measured = false;

  /// Le linee delle guide, coi segni e le distanze, e gli spazi uguali. La
  /// distanza da un oggetto in linea si scrive una volta, sulla linea dei
  /// centri se c'è, e non se la scrivono già le distanze uguali.
  const guideHandles = (): OverlayHandle[] => {
    const view = guideView();
    if (view === null) return [];
    const out: OverlayHandle[] = [];
    const along = (line: GuideLine, value: number): Point => (line.axis === 0 ? [line.value, value] : [value, line.value]);
    for (const line of view.lines) {
      out.push({ kind: "guide", from: along(line, line.from), to: along(line, line.to), dashed: false });
      for (const mark of line.marks) {
        const [x, y] = along(line, mark);
        out.push({ kind: "cross", x, y });
      }
    }
    const written = new Set<string>();
    const spaced = (axis: FrameAxis, [from, to]: readonly [number, number]): boolean =>
      view.spacings.some((spacing) => spacing.axis === axis && spacing.gaps.some((gap) => Math.abs(gap.from - from) <= ON_GUIDE && Math.abs(gap.to - to) <= ON_GUIDE));
    const middleFirst = [...view.lines].sort((a, b) => Number(b.source === "mid") - Number(a.source === "mid"));
    for (const line of middleFirst) {
      if (line.gap === null) continue;
      const key = `${line.axis} ${line.gap[0]} ${line.gap[1]}`;
      if (written.has(key) || spaced(line.axis === 0 ? 1 : 0, line.gap)) continue;
      written.add(key);
      out.push({ kind: "measure", from: along(line, line.gap[0]), to: along(line, line.gap[1]), text: lengthText(line.gap[1] - line.gap[0]) });
    }
    for (const { axis, gap, gaps } of view.spacings) {
      for (const { from, to, across } of gaps) {
        const at = (along: number): Point => (axis === 0 ? [along, across] : [across, along]);
        out.push({ kind: "measure", from: at(from), to: at(to), text: lengthText(gap) });
      }
    }
    return out;
  };
  ctx.guideHandles = guideHandles;

  /// Una linea a parole: quale bordo o centro di ciò che si è mosso sta in
  /// linea con quale dell'oggetto, della tavola, della pagina o del nodo.
  const lineText = ({ axis, source, target, edge }: GuideLine): string => {
    const names = EDGE_NAMES[axis];
    const from = t(names[source]);
    if (target.kind === "node") return t("draw.guides.node", { source: from });
    if (target.kind === "guide") return t("draw.guides.line", { source: from });
    const same = source === edge;
    if (target.kind === "page" && target.key === "") return same ? t("draw.guides.page.same", { source: from }) : t("draw.guides.page", { source: from, edge: t(names[edge]) });
    // Una tavola si dice come un oggetto, col suo nome.
    const unit = seenUnits().find((each) => each.key === target.key);
    const name = unit !== undefined ? labelOf(unit) : (ctx.boardById(target.key)?.name ?? target.key);
    return same ? t("draw.guides.object.same", { source: from, name }) : t("draw.guides.object", { source: from, edge: t(names[edge]), name });
  };

  /// A che cosa si è agganciato il gesto di adesso, a parole, da dire alla
  /// fine: per ciascun asse le distanze uguali, o una linea, prima con un
  /// oggetto che con la pagina. Vuoto se niente.
  const snapNote = (): string => {
    const view = guideView();
    if (view === null) return "";
    const parts: string[] = [];
    for (const axis of [0, 1] as const) {
      const spacing = view.spacings.find((each) => each.axis === axis);
      if (spacing !== undefined) {
        parts.push(t(axis === 0 ? "draw.guides.spaced.x" : "draw.guides.spaced.y", { gap: lengthSpoken(spacing.gap) }));
        continue;
      }
      // Prima un oggetto o un nodo, poi una guida, poi la pagina.
      const lines = view.lines.filter((line) => line.axis === axis);
      const line = lines.find((each) => each.target.kind !== "page" && each.target.kind !== "guide") ?? lines.find((each) => each.target.kind === "guide") ?? lines[0];
      if (line !== undefined) parts.push(lineText(line));
    }
    return parts.length === 0 ? "" : t("draw.guides.snapped", { parts: parts.join("; ") });
  };
  ctx.snapNote = snapNote;

  /// `text` e, dopo, la nota delle guide, se c'è.
  const noted = (text: string, note: string): string => (note === "" ? text : `${text} ${note}`);
  ctx.noted = noted;

  ctx.pointerAt = null;

  /// Con Alt e una selezione, le distanze fra la sua geometria e quella
  /// dell'oggetto sotto il puntatore, bloccati compresi, o della tavola o
  /// della pagina, se il puntatore ci sta sopra fuori dagli oggetti. Il
  /// riquadro misurato si vede tratteggiato.
  const measureHandles = (): OverlayHandle[] => {
    if (!ctx.alt || ctx.current !== null || ctx.pressed !== null || ctx.pointerAt === null || ctx.tool !== "select" || !has("guides") || ctx.selection.length === 0) return [];
    const a = ctx.geometryOf(selectedUnits());
    if (a === null) return [];
    const { at: p, pointer } = ctx.pointerAt;
    const chosen = new Set(ctx.selection);
    const tolerance = HIT_PX[pointer] / ctx.camera.scale;
    const units = seenUnits();
    let b: Bounds | null = null;
    for (let i = units.length - 1; i >= 0 && b === null; i--) {
      const unit = units[i]!;
      if (!chosen.has(unit.key) && unit.hits(p, tolerance)) b = unit.geometry ?? unit.bounds;
    }
    const sheet = b === null ? sheetAt(p) : null;
    if (sheet !== null) b = rectBounds(sheet.rect);
    if (b === null) return [];
    const { measures, extensions } = measureBetween(a, b);
    const corners: Point[] = [b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]];
    return [
      ...corners.map((corner, i): OverlayHandle => ({ kind: "guide", from: corner, to: corners[(i + 1) % 4]!, dashed: true })),
      ...extensions.map(([from, to]): OverlayHandle => ({ kind: "guide", from, to, dashed: true })),
      ...measures.map(({ from, to, value }): OverlayHandle => ({ kind: "measure", from, to, text: lengthText(value) })),
    ];
  };
  ctx.measureHandles = measureHandles;
}
