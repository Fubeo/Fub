// L'editor del disegno: gli strati del foglio e il painter. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { Lifetime } from "../../../../ui/lifetime";
import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import { pathOf, tagName, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../../scene/model";
import { SVG_NS } from "../../scene/read";
import { t } from "../../strings";
import { createOverlay, type SceneOverlay } from "../../painter/overlay";
import { PaintBuilder, type Page, type PaintScene, type PaintSource } from "../../painter/paint";
import { createSvgPainter, type ScenePainter } from "../../painter/svg-dom";
import { NewIds, pageFor } from "../edit";
import { boardAt, boardsOf, pageRect, type Board } from "../boards";
import type { LineEnd } from "../connectors";
import type { ConnectorKind } from "../../scene/connectors";
import { SceneIndex, SceneIndexer } from "../hit";
import type { DrawImages } from "../editor";
import { INK_KEY, inkCopyKey, PAGE_SHEET } from "./constants";
import { inlineChrome, type DrawChrome, type DrawPanelId, type DrawPanelPiece } from "./chrome/hosts";
import type { EditorContext } from "./context";
import { nodeAtPath } from "./helpers";
import type { Entered, Sheet } from "./types";

/// Un passo del percorso dell'isolamento: il contenitore, ciò che lo
/// rappresenta dove sta, lui o per un simbolo l'istanza da cui ci si entra,
/// e quante delle istanze da cui si è entrati servono per arrivarci.
interface IsolationStep {
  readonly node: ContainerNode;
  readonly pick: ElementPart;
  readonly through: number;
}

/// I marcatori delle anteprime dei connettori, uno per editor: l'id deve
/// essere unico nella pagina.
let previewTips = 0;

/// Ciò che la barra del ritaglio, gli strati del foglio e il painter dà agli altri pezzi dell'editor.
export interface StageContext {
  /// Dove stanno barra, colonna, foglio e pannelli.
  chrome: DrawChrome;
  /// Vero se i pannelli stanno in schede di chi ospita l'editor: aprirne uno
  /// chiede la scheda `id`, e la cromatura li apre e li chiude quando la
  /// scheda si monta e si smonta (C1).
  routed: (id: DrawPanelId, open: boolean) => boolean;
  /// Ciò che chiede il pulsante di un pannello: aprirlo se è chiuso; con le
  /// schede, sempre mostrarlo.
  toggles: (element: HTMLElement) => boolean;
  /// Il tipo del prossimo connettore: l'ultimo scelto nel pannello.
  connectorKind: ConnectorKind;
  /// I capi dei connettori che si possono prendere, per l'indice `index`.
  lineEndsFor: { readonly index: SceneIndex; readonly ends: readonly LineEnd[] } | null;
  previewTip: string;
  stage: HTMLDivElement;
  dock: HTMLDivElement;
  paper: HTMLDivElement;
  sheetLayer: HTMLDivElement;
  gridMark: SVGSVGElement;
  gridMinor: SVGPathElement;
  gridMajor: SVGPathElement;
  images: DrawImages | undefined;
  painter: ScenePainter;
  previewCamera: SVGGElement;
  previewLayer: SVGGElement;
  nameLayer: HTMLDivElement;
  overlay: SceneOverlay;
  /// Quante copie in simmetria del tratto in corso lo strato può mostrare.
  inkCopies: number;
  clearInk: () => void;
  cursorMark: HTMLDivElement;
  builder: PaintBuilder;
  indexer: SceneIndexer;
  paintSource: () => PaintSource;
  scene: PaintScene;
  index: SceneIndex | null;
  /// Le tavole del disegno di adesso, cercate una volta per scena. Il foglio
  /// delle annotazioni non ne ha.
  boards: readonly Board[] | null;
  boardsNow: () => readonly Board[];
  /// Ciò che lo strumento Tavola ha scelto: l'id di una tavola, [`PAGE_SHEET`]
  /// per la pagina di un disegno senza tavole, `null` per niente. Resta
  /// quando si cambia strumento, e lo si ritrova tornando.
  boardChosen: string | null;
  chosenSheet: () => Sheet | null;
  sheetAt: (p: Point) => Sheet | null;
  editable: () => boolean;
  isolatedNode: () => ContainerNode | null;
  isolatedThrough: () => readonly LeafNode[];
  isolationOf: (node: ContainerNode, through: readonly LeafNode[]) => NonNullable<{ readonly key: string; readonly path: readonly number[]; readonly tag: string; readonly through: readonly Entered[]; } | null>;
  isolationSteps: () => IsolationStep[] | null;
  isolationChain: () => object[] | null;
  currentIndex: () => SceneIndex;
  currentPage: () => Page | null;
  grownPage: (bounds: Bounds | null) => string | null;
  newIds: () => NewIds;
}

/// Monta gli strati del foglio e il painter.
export function installStage(ctx: EditorContext): void {
  const {
    life, folio, drawingFonts, pictureFonts, root, header, toolbar, surface, live, surfaceHint, tree, historyPanel, suggestions, accessPanel,
    panel, arrangeBar, isolationBar, linkLayer, progressBar, describeBar, host, options
  } = ctx;
  ctx.connectorKind = "elbow";
  ctx.lineEndsFor = null;
  /// L'id del marcatore dell'anteprima di un connettore nuovo.
  const previewTip = `draw-preview-tip-${++previewTips}`;
  ctx.previewTip = previewTip;

  // Il foglio con la sua barra e, accanto, i pannelli: l'albero degli
  // oggetti, le proprietà e, in fondo, la cronologia e
  // l'accessibilità.
  const stage = document.createElement("div");
  ctx.stage = stage;
  stage.className = "draw-stage";
  stage.append(surface, linkLayer, arrangeBar, isolationBar, progressBar, describeBar);
  const dock = document.createElement("div");
  ctx.dock = dock;
  dock.className = "draw-dock";
  dock.hidden = true;
  dock.append(tree.element, panel.element, historyPanel.element, accessPanel.element);
  header.append(ctx.topStart, toolbar);
  if (folio?.controls) header.append(folio.controls);
  header.append(ctx.topEnd);
  const chrome = options.chrome ?? inlineChrome();
  ctx.chrome = chrome;
  /// Vero mentre la cromatura apre o chiude un pannello nella sua scheda.
  let placing = false;
  ctx.routed = (id, open) => {
    if (chrome.reveal === undefined || placing) return false;
    if (open) chrome.reveal(id);
    return true;
  };
  ctx.toggles = (element) => element.hidden || chrome.reveal !== undefined;
  const piece = (element: HTMLElement, offered: () => boolean, show: (open: boolean) => void): DrawPanelPiece => {
    const placed = (open: boolean) => () => {
      placing = true;
      try {
        show(open);
      } finally {
        placing = false;
      }
    };
    return { element, offered, open: placed(true), close: placed(false) };
  };
  const { has } = ctx;
  chrome.place(host, {
    root,
    top: header,
    rail: ctx.railColumn,
    stage,
    dock,
    // Le schede dell'ispettore: il documento o l'oggetto, l'albero, ciò che
    // si inserisce, la cronologia, la verifica.
    panels: [
      {
        id: "design",
        title: () => t("draw.chrome.tab.design"),
        icon: "draw-design",
        pieces: [
          piece(panel.element, () => has("properties"), (open) => ctx.showPanel(open, false, false)),
        ],
      },
      { id: "layers", title: () => t("draw.chrome.tab.layers"), icon: "draw-layers", pieces: [piece(tree.element, () => true, (open) => ctx.showObjects(open, false))] },
      { id: "history", title: () => t("draw.chrome.tab.history"), icon: "draw-history", pieces: [piece(historyPanel.element, () => has("history"), (open) => ctx.showHistory(open, false))] },
      { id: "accessibility", title: () => t("draw.chrome.tab.accessibility"), icon: "draw-access", pieces: [piece(accessPanel.element, () => has("accessibility"), (open) => ctx.showAccess(open, false))] },
    ],
    tail: [suggestions.element, surfaceHint, live],
  });

  // La carta, la griglia, il painter, poi l'anteprima delle forme, poi lo
  // strato sopra: l'ordine in cui si vedono. La carta è bianca in ogni tema:
  // è il fondo su cui il disegno si legge anche fuori dall'editor, e su cui
  // S009 misura il contrasto del tratto.
  const paper = document.createElement("div");
  ctx.paper = paper;
  paper.className = "draw-page";
  paper.setAttribute("aria-hidden", "true");
  // Con le tavole, ognuna ha la sua carta, e fra l'una e l'altra c'è il
  // tavolo, come in Illustrator.
  const sheetLayer = document.createElement("div");
  ctx.sheetLayer = sheetLayer;
  sheetLayer.className = "draw-sheets";
  sheetLayer.setAttribute("aria-hidden", "true");
  surface.append(paper, sheetLayer);
  // Sul foglio delle annotazioni la carta porta la pagina del PDF.
  if (folio !== undefined) paper.append(folio.background);
  // Le righe sottili e, una ogni cinque, quelle marcate.
  const gridMark = document.createElementNS(SVG_NS, "svg");
  ctx.gridMark = gridMark;
  gridMark.setAttribute("class", "draw-grid");
  gridMark.setAttribute("aria-hidden", "true");
  const gridMinor = document.createElementNS(SVG_NS, "path");
  ctx.gridMinor = gridMinor;
  const gridMajor = document.createElementNS(SVG_NS, "path");
  ctx.gridMajor = gridMajor;
  gridMajor.setAttribute("data-major", "");
  gridMark.append(gridMinor, gridMajor);
  surface.append(gridMark);
  const images = options.images;
  ctx.images = images;
  const painter = createSvgPainter(surface, life, {
    fonts: pictureFonts,
    families: drawingFonts,
    ...(images === undefined ? {} : { images: (href: string, owner: Lifetime) => images.url(href, owner) }),
  });
  ctx.painter = painter;
  const preview = document.createElementNS(SVG_NS, "svg");
  preview.setAttribute("class", "draw-preview");
  preview.setAttribute("aria-hidden", "true");
  const previewCamera = document.createElementNS(SVG_NS, "g");
  ctx.previewCamera = previewCamera;
  const previewLayer = document.createElementNS(SVG_NS, "g");
  ctx.previewLayer = previewLayer;
  previewCamera.append(previewLayer);
  preview.append(previewCamera);
  surface.append(preview);
  // I nomi delle tavole, sopra il disegno, che non li copre.
  const nameLayer = document.createElement("div");
  ctx.nameLayer = nameLayer;
  nameLayer.className = "draw-sheets";
  nameLayer.setAttribute("aria-hidden", "true");
  surface.append(nameLayer);
  const overlay = createOverlay(surface, life);
  ctx.overlay = overlay;
  ctx.inkCopies = 0;
  /// Toglie dallo strato il tratto in corso, con le sue copie in simmetria.
  const clearInk = (): void => {
    overlay.setInk(INK_KEY, null);
    for (let k = 0; k < ctx.inkCopies; k++) overlay.setInk(inkCopyKey(k), null);
    ctx.inkCopies = 0;
  };
  ctx.clearInk = clearInk;
  // Il cursore del foglio: si vede quando lo muove la tastiera.
  const cursorMark = document.createElement("div");
  ctx.cursorMark = cursorMark;
  cursorMark.className = "draw-cursor";
  cursorMark.setAttribute("aria-hidden", "true");
  cursorMark.hidden = true;
  surface.append(cursorMark);

  const builder = new PaintBuilder();
  ctx.builder = builder;
  // Col foglio si sceglie e si cerca solo nei gruppi della pagina.
  const indexer = new SceneIndexer(builder, (id) => ctx.engine.holder(id), folio === undefined ? null : (model) => folio.scope(model));
  ctx.indexer = indexer;
  /// Col foglio il painter disegna una vista del documento: la stessa
  /// radice coi soli gruppi della pagina. È sempre lo stesso oggetto per lo
  /// stesso motore, così il painter riusa ciò che ha già disegnato.
  let folioView: {
    readonly of: DocumentModel;
    readonly root: ContainerNode;
    readonly model: { bom: string; parts: DocumentModel["parts"]; root: ContainerNode };
  } | null = null;
  const paintSource = (): PaintSource => {
    const model = ctx.engine.model;
    if (folio === undefined || model === null) return ctx.engine;
    if (folioView === null || folioView.of !== model) {
      const root: ContainerNode = { ...model.root };
      folioView = { of: model, root, model: { bom: model.bom, parts: [], root } };
    }
    const shown = new Set<ContainerNode>(folio.scope(model));
    Object.assign(folioView.root, model.root, {
      parts: model.root.parts.filter((part) => typeof part === "string" || (part.kind === "container" && shown.has(part))),
    });
    const real = model.root;
    const root = folioView.root;
    folioView.model.parts = model.parts.map((part) => (part === real ? root : part));
    return { model: folioView.model, holder: (id) => ctx.engine.holder(id) };
  };
  ctx.paintSource = paintSource;
  ctx.scene = builder.build(paintSource());
  ctx.index = null;
  const EMPTY = new SceneIndex([], []);

  ctx.boards = null;
  const boardsNow = (): readonly Board[] => (ctx.boards ??= ctx.engine.model === null || folio !== undefined ? [] : boardsOf(ctx.engine.model));
  ctx.boardsNow = boardsNow;
  ctx.boardChosen = null;

  /// La tavola scelta, o la pagina; `null` se non c'è più.
  const chosenSheet = (): Sheet | null => {
    if (ctx.boardChosen === null) return null;
    const list = boardsNow();
    if (ctx.boardChosen === PAGE_SHEET) {
      const page = ctx.scene.root.page;
      return page === null || list.length > 0 ? null : { board: null, rect: pageRect(page) };
    }
    const board = list.find((each) => each.id === ctx.boardChosen);
    return board === undefined ? null : { board, rect: board.rect };
  };
  ctx.chosenSheet = chosenSheet;

  /// La tavola sotto `p`, la più piccola se più d'una, o la pagina di un
  /// disegno senza tavole, se `p` ci sta dentro; `null` fuori.
  const sheetAt = (p: Point): Sheet | null => {
    const list = boardsNow();
    const board = boardAt(list, p);
    if (board !== null) return { board, rect: board.rect };
    const page = ctx.scene.root.page;
    if (list.length > 0 || page === null) return null;
    const rect = pageRect(page);
    return p[0] >= rect[0] && p[0] <= rect[0] + rect[2] && p[1] >= rect[1] && p[1] <= rect[1] + rect[3] ? { board: null, rect } : null;
  };
  ctx.sheetAt = sheetAt;

  const editable = (): boolean => !ctx.locked && ctx.engine.status === "fubdraw" && ctx.engine.model !== null;
  ctx.editable = editable;

  /// Il gruppo isolato nel disegno di adesso; `null` se non ce n'è, se non
  /// c'è più, o se dentro non si sceglie più: bloccato, nascosto, o dentro
  /// uno che lo è. Si cerca per id, poi al suo posto, dove un oggetto con un
  /// altro id non è lui; così le istanze da cui si entra in un simbolo, e
  /// se una non c'è più non c'è più nemmeno il simbolo isolato.
  const isolatedNode = (): ContainerNode | null => {
    const model = ctx.engine.model;
    if (ctx.isolation === null || model === null) return null;
    if (ctx.isolatedFor?.model === model) return ctx.isolatedFor.node;
    const wanted = ctx.isolation;
    const found = <T extends ElementPart>(key: string, path: readonly number[], fits: (node: ElementPart | null) => node is T): T | null => {
      let node: ElementPart | null = key.startsWith("@") ? null : ctx.engine.holder(key);
      if (!fits(node)) {
        node = nodeAtPath(model, path);
        if (node !== null && node.facts.id !== null && node.facts.id !== key) node = null;
      }
      return fits(node) ? node : null;
    };
    const instance = (node: ElementPart | null): node is LeafNode => node !== null && node.kind === "leaf" && node.details?.role === "instance";
    const through: LeafNode[] = [];
    for (const entry of wanted.through) {
      const node = found(entry.key, entry.path, instance);
      if (node === null) {
        ctx.isolatedFor = { model, node: null, through: [] };
        return null;
      }
      through.push(node);
    }
    const node = found(wanted.key, wanted.path, (each): each is ContainerNode =>
      each !== null && each.kind === "container" && tagName(each) === wanted.tag && indexer.opens(model, each, through));
    ctx.isolatedFor = { model, node, through: node === null ? [] : through };
    if (node !== null) ctx.isolation = { ...isolationOf(node, through), tag: wanted.tag };
    return node;
  };
  ctx.isolatedNode = isolatedNode;

  /// Le istanze da cui si è entrati nel simbolo isolato, o in quello che
  /// contiene il gruppo isolato, dalla più esterna; nessuna fuori dai
  /// simboli.
  const isolatedThrough = (): readonly LeafNode[] => (isolatedNode() === null ? [] : ctx.isolatedFor!.through);
  ctx.isolatedThrough = isolatedThrough;

  /// L'isolamento di `node`, in cui si entra dalle istanze `through`.
  const isolationOf = (node: ContainerNode, through: readonly LeafNode[]): NonNullable<typeof ctx.isolation> => ({
    key: ctx.keyOfNode(node),
    path: pathOf(node),
    tag: tagName(node),
    through: through.map((each) => ({ key: ctx.keyOfNode(each), path: pathOf(each) })),
  });
  ctx.isolationOf = isolationOf;

  /// Il contenitore isolato e chi lo contiene, dal figlio della radice in
  /// giù: dal contenuto di un simbolo si risale all'istanza da cui ci si è
  /// entrati, e da lì a chi la contiene.
  const isolationSteps = (): IsolationStep[] | null => {
    const node = isolatedNode();
    if (node === null) return null;
    const through = isolatedThrough();
    const steps: IsolationStep[] = [];
    let depth = through.length;
    for (let at: ContainerNode | null = node; at !== null && at.parent !== null; ) {
      if (at.details?.role !== "symbol") {
        steps.unshift({ node: at, pick: at, through: depth });
        at = at.parent;
        continue;
      }
      const instance = through[depth - 1];
      if (instance === undefined) return null;
      steps.unshift({ node: at, pick: instance, through: depth });
      depth--;
      at = instance.parent;
    }
    return steps;
  };
  ctx.isolationSteps = isolationSteps;

  /// Ciò che il painter non attenua: i contenitori del percorso fino al
  /// primo simbolo, e l'istanza da cui ci si entra, che lo mostra.
  const isolationChain = (): object[] | null => {
    const steps = isolationSteps();
    if (steps === null) return null;
    const first = steps.findIndex((step) => step.node.details?.role === "symbol");
    if (first < 0) return steps.map((step) => step.node);
    return [...steps.slice(0, first).map((step) => step.node), ...builder.paintsOf(steps[first]!.pick).slice(0, 1)];
  };
  ctx.isolationChain = isolationChain;

  /// Gli oggetti che si scelgono: quelli in cima, o i figli del gruppo
  /// isolato.
  const currentIndex = (): SceneIndex => {
    if (ctx.index === null) ctx.index = ctx.engine.model === null ? EMPTY : indexer.index(ctx.engine.model, isolatedNode(), isolatedThrough());
    return ctx.index;
  };
  ctx.currentIndex = currentIndex;

  /// La pagina: quella del foglio, o quella della radice.
  const currentPage = (): Page | null => (folio === undefined ? ctx.scene.root.page : folio.page());
  ctx.currentPage = currentPage;

  /// Il `viewBox` della pagina allargata per tenere `bounds`; `null` se
  /// basta com'è. La pagina del foglio non si allarga.
  const grownPage = (bounds: Bounds | null): string | null => (folio === undefined ? pageFor(ctx.scene.root.page, bounds) : null);
  ctx.grownPage = grownPage;

  const newIds = (): NewIds => new NewIds((id) => ctx.engine.holder(id) !== null);
  ctx.newIds = newIds;
}
