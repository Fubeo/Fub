// L'editor del disegno: gli annunci, la camera, l'unità e i righelli. Un pezzo
// di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { resolvedLanguage } from "../../../../i18n/strings";
import type { FormField } from "../../../../ui/form-dialog";
import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { LengthUnit } from "../../scene/rulers";
import { plural, t } from "../../strings";
import { pageRect, type Board, type Rect } from "../boards";
import { directionCursor, type GripCursor } from "../frame";
import { gridLines, gridStep } from "../grid";
import { unitSuffix } from "../guide-dialog";
import { fieldMin, fieldText, fromUnit, RULER_PX, toUnit, UNIT_PLACES } from "../rulers";
import { fitView, placedAt, toScene, toScreen, turnTo, viewTransform, zoomAt, type View } from "../../view";
import type { Feature } from "../registry";
import { DRAW_SCALE_LIMITS, FIT_PAD, OPEN_MARGIN_PX } from "./constants";
import type { EditorContext } from "./context";
import { union } from "./helpers";

/// Sotto questa larghezza sullo schermo, in pixel, una tavola non mostra il
/// suo nome: non ci starebbe una lettera.
const BOARD_NAME_PX = 24;

/// Le unità come le conosce `Intl`, che le scrive e le dice nella lingua di
/// adesso; il punto tipografico non è fra le sue.
const INTL_UNITS: Readonly<Record<LengthUnit, string | null>> = { px: null, mm: "millimeter", cm: "centimeter", in: "inch", pt: null };

/// Ciò che gli annunci, la camera, l'unità e i righelli dà agli altri pezzi dell'editor.
export interface ViewContext {
  announce: (text: string) => void;
  objects: () => string;
  selectionSaid: () => string;
  announceSelection: () => void;
  sheetRect: (board: Board | null) => Rect | null;
  showPage: () => void;
  surfaceSize: () => { readonly w: number; readonly h: number };
  readFirst: <T>(run: () => T) => T;
  rereadSize: () => void;
  showGrid: () => void;
  showCursor: () => void;
  setCamera: (next: View) => void;
  numberText: (value: number) => string;
  hundredthsText: (value: number) => string;
  docUnit: () => LengthUnit;
  stepNow: () => number;
  coordText: (value: number) => string;
  lengthText: (value: number) => string;
  lengthSpoken: (value: number) => string;
  lengthField: (id: string, label: string, value: number, min?: number) => FormField;
  fieldValue: (text: string) => number;
  rulersShown: (at?: ReadonlySet<Feature>) => boolean;
  guidesShown: (at?: ReadonlySet<Feature>) => boolean;
  viewArea: () => { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  rulerAt: (p: Point) => "top" | "left" | "corner" | null;
  /// Il riquadro della selezione che i righelli segnano, nella scena: lo
  /// tiene aggiornato `showHandles`, anche mentre la si sposta o la si
  /// ridimensiona.
  selectionBand: Bounds | null;
  showRulers: () => void;
  showGuideLines: () => void;
  localPoint: (clientX: number, clientY: number) => { x: number; y: number };
  sceneAt: (clientX: number, clientY: number) => Point;
  sceneLevel: () => boolean;
  axisCursor: (axis: "x" | "y") => GripCursor;
  viewCenter: () => Point;
  zoomBy: (factor: number) => void;
  fitted: (bounds: Bounds, area: ReturnType<() => { readonly x: number; readonly y: number; readonly w: number; readonly h: number; }>) => View;
  announceTurn: () => void;
  turnView: (angle: number) => void;
  fit: () => void;
  /// Inquadra la selezione, e lo dice se non c'è niente di scelto.
  fitSelection: () => void;
}

/// Monta gli annunci, la camera, l'unità e i righelli.
export function installView(ctx: EditorContext): void {
  const {
    life, folio, has, relabels, zoomText, turnText, root, surface, live, zoomLevel, turnButton, stage, paper, sheetLayer, gridMark, gridMinor, gridMajor,
    painter, previewCamera, nameLayer, guideLines, overlay, cursorMark, tickFormats, rulers, boardsNow, currentIndex, currentPage
  } = ctx;
  // --- Annunci ------------------------------------------------------------

  let echo = false;
  /// Il testo cambia sempre, anche quando la frase è la stessa di prima:
  /// uno spazio fermo in coda, alterno, la fa annunciare di nuovo.
  const announce = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };
  ctx.announce = announce;

  const objects = (): string =>
    folio === undefined
      ? plural(currentIndex().units.length, "draw.objects.one", "draw.objects.other")
      : plural(currentIndex().units.length, "draw.page.objects.one", "draw.page.objects.other");
  ctx.objects = objects;

  /// Quanti oggetti sono scelti, a parole.
  const selectionSaid = (): string => (ctx.selection.length === 0 ? t("draw.selected.none") : plural(ctx.selection.length, "draw.selected.one", "draw.selected.other"));
  ctx.selectionSaid = selectionSaid;

  const announceSelection = (): void => {
    announce(selectionSaid());
  };
  ctx.announceSelection = announceSelection;

  // --- Camera -------------------------------------------------------------

  const showZoom = (force = false): void => {
    const text = zoomText();
    if (!force && zoomLevel.textContent === text) return;
    zoomLevel.textContent = text;
    const label = t("draw.zoom_reset", { zoom: text });
    zoomLevel.setAttribute("aria-label", label);
    zoomLevel.title = label;
  };

  /// Mette la carta `element` sul rettangolo `rect` della scena. Sul foglio
  /// girato la carta gira attorno al suo angolo, l'origine della
  /// trasformazione.
  const placeSheet = (element: HTMLElement, [x, y, width, height]: Rect): void => {
    const [left, top] = toScreen(ctx.camera, [x, y]);
    element.style.transform = ctx.camera.angle === 0 ? `translate(${left}px, ${top}px)` : `translate(${left}px, ${top}px) rotate(${ctx.camera.angle}deg)`;
    element.style.width = `${ctx.camera.scale * width}px`;
    element.style.height = `${ctx.camera.scale * height}px`;
  };

  /// Il nome `element` della tavola `board`, sopra l'angolo in alto a
  /// sinistra del rettangolo `rect`, largo al più quanto lei, e girato col
  /// foglio. Una tavola troppo stretta sullo schermo non lo mostra.
  const placeName = (element: HTMLElement, board: Board, [x, y, width]: Rect, chosen: boolean): void => {
    const wide = ctx.camera.scale * width;
    element.hidden = wide < BOARD_NAME_PX;
    if (element.hidden) return;
    if (element.textContent !== board.name) element.textContent = board.name;
    const [left, top] = toScreen(ctx.camera, [x, y]);
    element.style.maxWidth = `${wide}px`;
    element.style.transform = `translate(${left}px, ${top}px) rotate(${ctx.camera.angle}deg) translateY(-100%)`;
    element.toggleAttribute("data-chosen", chosen);
  };

  /// Il rettangolo che il gesto dello strumento Tavola dà adesso alla
  /// tavola `board`, o alla pagina con `null`, mentre la sposta o ne tira una
  /// maniglia; `null` se il gesto non la tocca.
  const sheetRect = (board: Board | null): Rect | null => {
    const g = ctx.current?.kind === "board" ? ctx.current : null;
    if (g === null || g.sheet === null || g.rect === null || (g.mode !== "move" && g.mode !== "resize") || ctx.boardCopies(g)) return null;
    return (g.sheet.board?.id ?? null) === (board?.id ?? null) ? g.rect : null;
  };
  ctx.sheetRect = sheetRect;

  /// Le carte e i nomi delle tavole, una coppia per tavola, riusati da una
  /// volta all'altra.
  const boardSheets: HTMLElement[] = [];
  const boardNames: HTMLElement[] = [];

  /// La pagina sullo schermo, o le tavole, ognuna con la sua carta e il suo
  /// nome; senza pagina né tavole la carta è tutto il foglio.
  const showPage = (): void => {
    const page = currentPage();
    const list = boardsNow();
    surface.toggleAttribute("data-unbounded", page === null && list.length === 0);
    paper.hidden = page === null || list.length > 0;
    if (!paper.hidden) placeSheet(paper, sheetRect(null) ?? pageRect(page!));
    while (boardSheets.length < list.length) {
      const sheet = document.createElement("div");
      sheet.className = "draw-page";
      const name = document.createElement("div");
      name.className = "draw-sheet-name";
      sheetLayer.append(sheet);
      nameLayer.append(name);
      boardSheets.push(sheet);
      boardNames.push(name);
    }
    while (boardSheets.length > list.length) {
      boardSheets.pop()!.remove();
      boardNames.pop()!.remove();
    }
    const chosen = ctx.tool === "board" ? ctx.boardChosen : null;
    list.forEach((board, at) => {
      const rect = sheetRect(board) ?? board.rect;
      placeSheet(boardSheets[at]!, rect);
      placeName(boardNames[at]!, board, rect, board.id === chosen);
    });
    ctx.syncBoards();
  };
  ctx.showPage = showPage;

  /// Quanti giri di `readFirst` sono aperti, e la misura del foglio che
  /// hanno letto; `null` se va riletta.
  let rounds = 0;
  let surfaceBox: { readonly w: number; readonly h: number } | null = null;

  const readSurface = (): { readonly w: number; readonly h: number } => ({ w: surface.clientWidth, h: surface.clientHeight });

  /// La misura del foglio in pixel: quella letta all'inizio del giro, se ce
  /// n'è uno, o quella di adesso.
  const surfaceSize = (): { readonly w: number; readonly h: number } => (rounds === 0 ? readSurface() : (surfaceBox ??= readSurface()));
  ctx.surfaceSize = surfaceSize;

  /// Esegue `run` dopo aver letto la misura del foglio, prima di scrivere
  /// qualcosa nella pagina: chi la chiede nel giro non la rilegge. Leggere
  /// il layout dopo aver toccato il DOM costringe il browser a rifarlo
  /// subito, una volta per ogni lettura; letto prima, a layout pulito, non
  /// costa niente. Un giro dentro un altro è quello di fuori. Chi cambia la
  /// misura del foglio mentre il giro dura lo dice con `rereadSize`.
  const readFirst = <T,>(run: () => T): T => {
    if (rounds++ === 0) surfaceBox = readSurface();
    try {
      return run();
    } finally {
      if (--rounds === 0) surfaceBox = null;
    }
  };
  ctx.readFirst = readFirst;

  /// La misura del foglio può essere cambiata: la prossima richiesta, anche
  /// dentro un giro, la rilegge.
  const rereadSize = (): void => {
    surfaceBox = null;
  };
  ctx.rereadSize = rereadSize;

  /// La griglia sullo schermo, se il livello la offre e la si vuole vedere.
  const showGrid = (): void => {
    const shown = has("grid") && ctx.grid.shown;
    gridMark.style.display = shown ? "" : "none";
    if (!shown) return;
    gridMark.toggleAttribute("data-slanted", ctx.camera.angle % 90 !== 0);
    const size = surfaceSize();
    const lines = gridLines(ctx.camera, size.w, size.h, stepNow());
    gridMinor.setAttribute("d", lines.minor);
    gridMajor.setAttribute("d", lines.major);
  };
  ctx.showGrid = showGrid;

  /// Il cursore del foglio sullo schermo; pieno mentre la tastiera preme.
  const showCursor = (): void => {
    cursorMark.toggleAttribute("data-pressed", ctx.pressed !== null);
    if (ctx.cursor === null) return;
    const [x, y] = toScreen(ctx.camera, ctx.cursor);
    cursorMark.style.transform = `translate(${x}px, ${y}px)`;
  };
  ctx.showCursor = showCursor;

  /// L'angolo della vista nel suo pulsante, che si vede solo sul foglio
  /// girato.
  const showTurn = (force = false): void => {
    const text = ctx.camera.angle === 0 ? "" : turnText(ctx.camera.angle);
    turnButton.hidden = text === "";
    if (!force && turnButton.textContent === text) return;
    turnButton.textContent = text;
    const label = t("draw.turn.button", { angle: text });
    turnButton.setAttribute("aria-label", label);
    turnButton.title = label;
  };

  const setCamera = (next: View): void => {
    ctx.camera = next;
    painter.setView(next);
    overlay.setView(next);
    previewCamera.setAttribute("transform", viewTransform(next));
    showPage();
    showGrid();
    showGuideLines();
    showZoom();
    showTurn();
    showCursor();
    ctx.placeText();
    // Le cornici hanno un margine e le maniglie una misura sullo schermo; i
    // righelli seguono la cornice.
    ctx.showHandles();
    // Il fondo del foglio rende la parte della pagina che si vede.
    const size = surfaceSize();
    folio?.view?.(next, size.w, size.h);
  };
  ctx.setCamera = setCamera;
  /// Il formato delle coordinate dette a voce, nella lingua di adesso.
  let coordinates: Intl.NumberFormat | null = null;
  const numberText = (value: number): string =>
    (coordinates ??= new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 1 })).format(Math.round(value * 10) / 10 || 0);
  ctx.numberText = numberText;
  /// Il formato di un contrasto o di un corpo detti a voce, al centesimo.
  let hundredths: Intl.NumberFormat | null = null;
  const hundredthsText = (value: number): string =>
    (hundredths ??= new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 2, useGrouping: false })).format(value);
  ctx.hundredthsText = hundredthsText;
  relabels.push(() => {
    ctx.percent = null;
    ctx.degrees = null;
    showTurn(true);
    coordinates = null;
    hundredths = null;
    unitFormats = null;
    tickFormats.clear();
    showZoom(true);
    // Le tacche si riscrivono coi numeri della lingua nuova.
    if (rulersShown()) {
      rulers.show(null);
      showRulers();
    }
  });

  // --- L'unità del documento ----------------------------------------------------
  //
  // La scena misura in pixel; il documento dice in che unità si legge
  // (`fub:units`). Righelli, campi, misure e annunci la usano; il disegno, i
  // suoi spessori e i corpi del testo non cambiano.

  /// L'unità del documento di adesso.
  const docUnit = (): LengthUnit => ctx.scene.root.units;
  ctx.docUnit = docUnit;

  /// Il passo della griglia per il documento di adesso, in unità della scena:
  /// ogni unità ricorda il suo.
  const stepNow = (): number => gridStep(ctx.grid, docUnit());
  ctx.stepNow = stepNow;

  /// I formati dell'unità di adesso, nella lingua di adesso: il numero solo,
  /// e con l'unità scritta corta e per intero.
  let unitFormats: {
    readonly unit: LengthUnit;
    readonly plain: Intl.NumberFormat;
    readonly short: Intl.NumberFormat | null;
    readonly long: Intl.NumberFormat | null;
  } | null = null;
  const formatsNow = (): NonNullable<typeof unitFormats> => {
    const unit = docUnit();
    if (unitFormats?.unit !== unit) {
      const language = resolvedLanguage();
      const digits = { maximumFractionDigits: UNIT_PLACES[unit] };
      const intl = INTL_UNITS[unit];
      unitFormats = {
        unit,
        plain: new Intl.NumberFormat(language, digits),
        short: intl === null ? null : new Intl.NumberFormat(language, { ...digits, style: "unit", unit: intl, unitDisplay: "short" }),
        long: intl === null ? null : new Intl.NumberFormat(language, { ...digits, style: "unit", unit: intl, unitDisplay: "long" }),
      };
    }
    return unitFormats;
  };

  /// Una lunghezza della scena nell'unità del documento, ai decimali con cui
  /// l'unità si legge, e senza lo zero negativo.
  const inUnit = (value: number): number => {
    const unit = docUnit();
    const factor = 10 ** UNIT_PLACES[unit];
    return Math.round(toUnit(value, unit) * factor) / factor || 0;
  };

  /// Una coordinata nell'unità del documento: un numero solo, come nei campi
  /// X e Y.
  const coordText = (value: number): string => formatsNow().plain.format(inUnit(value));
  ctx.coordText = coordText;

  /// Una lunghezza come si legge: in pixel il numero solo, nelle altre unità
  /// con la sigla.
  const lengthText = (value: number): string => {
    const { unit, short } = formatsNow();
    if (unit === "px") return coordText(value);
    return short === null ? `${coordText(value)} ${unit}` : short.format(inUnit(value));
  };
  ctx.lengthText = lengthText;

  /// Una lunghezza come si dice: in pixel il numero solo, nelle altre unità
  /// col nome intero, che uno screen reader non deve indovinare da una sigla.
  const lengthSpoken = (value: number): string => {
    const { unit, long } = formatsNow();
    if (unit === "px") return coordText(value);
    if (long !== null) return long.format(inUnit(value));
    return plural(inUnit(value), "draw.unit.pt.one", "draw.unit.pt.other", { value: coordText(value) });
  };
  ctx.lengthSpoken = lengthSpoken;

  /// Un campo di una lunghezza: il nome con la sigla dell'unità, il valore
  /// in quell'unità ai decimali di un campo, e il minimo che la misura in
  /// unità della scena chiede.
  const lengthField = (id: string, label: string, value: number, min?: number): FormField => {
    const unit = docUnit();
    return {
      id,
      label: unitSuffix(label, unit),
      value: fieldText(value, unit),
      kind: "number",
      ...(min === undefined ? {} : { min: fieldMin(min, unit) }),
    };
  };
  ctx.lengthField = lengthField;

  /// Il valore di un campo di lunghezza scritto da chi lo cambia, in unità
  /// della scena, a due decimali come li scrive il file.
  const fieldValue = (text: string): number => Math.round(fromUnit(Number(text), docUnit()) * 100) / 100 || 0;
  ctx.fieldValue = fieldValue;

  // --- Righelli e guide del documento ---------------------------------------------

  /// I righelli si vedono: se il livello li offre e chi disegna li vuole.
  const rulersShown = (at: ReadonlySet<Feature> = ctx.features): boolean => at.has("rulers") && ctx.grid.rulers;
  ctx.rulersShown = rulersShown;

  /// Le guide del documento si vedono, e agganciano, se il livello offre i
  /// righelli e chi disegna le vuole.
  const guidesShown = (at: ReadonlySet<Feature> = ctx.features): boolean => at.has("rulers") && ctx.grid.rulerGuides;
  ctx.guidesShown = guidesShown;

  /// La parte del foglio che si vede, in pixel: i righelli coprono i bordi
  /// in alto e a sinistra, e ciò che si inquadra va accanto a loro.
  const viewArea = (): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } => {
    const inset = rulersShown() ? RULER_PX : 0;
    const size = surfaceSize();
    return { x: inset, y: inset, w: Math.max(0, size.w - inset), h: Math.max(0, size.h - inset) };
  };
  ctx.viewArea = viewArea;

  /// Dove sta il punto `p` del foglio rispetto ai righelli: su quello in
  /// alto, su quello a sinistra, sull'angolo fra i due, o su nessuno.
  const rulerAt = (p: Point): "top" | "left" | "corner" | null => {
    if (!rulersShown()) return null;
    const top = p[1] >= 0 && p[1] < RULER_PX;
    const left = p[0] >= 0 && p[0] < RULER_PX;
    return top && left ? "corner" : top ? "top" : left ? "left" : null;
  };
  ctx.rulerAt = rulerAt;

  ctx.selectionBand = null;

  /// I righelli sullo schermo, se si vedono: la pagina, la selezione e il
  /// puntatore. Il foglio sa se ci sono, e sposta le barre che galleggiano
  /// in cima.
  const showRulers = (): void => {
    const shown = rulersShown();
    stage.toggleAttribute("data-rulers", shown);
    if (!shown) {
      rulers.show(null);
      return;
    }
    const size = surfaceSize();
    rulers.show({
      camera: ctx.camera,
      width: size.w,
      height: size.h,
      unit: docUnit(),
      page: ctx.rulerPage(),
      selection: ctx.selectionBand,
      pointer: ctx.pointerAt?.at ?? null,
    });
  };
  ctx.showRulers = showRulers;

  /// Le guide del documento sullo schermo, se si vedono: quella sotto il
  /// puntatore accesa, e quella che si trascina dove la porta il gesto.
  const showGuideLines = (): void => {
    const g = ctx.current?.kind === "guide" ? ctx.current : null;
    // Una guida nuova si vede mentre la si tira anche con le guide nascoste.
    const guides = guidesShown() ? (ctx.scene.root.guides ?? []) : [];
    if (guides.length === 0 && (g === null || !g.moved)) {
      guideLines.show(null);
      return;
    }
    const size = surfaceSize();
    guideLines.show({
      camera: ctx.camera,
      width: size.w,
      height: size.h,
      guides,
      hot: g === null ? ctx.hotGuide : null,
      hidden: g?.index ?? null,
      moving: g === null || !g.moved ? null : { axis: g.axis, at: g.at, away: g.away },
    });
  };
  ctx.showGuideLines = showGuideLines;

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  ctx.localPoint = localPoint;

  /// Il punto della scena sotto il punto `clientX`, `clientY` del client.
  const sceneAt = (clientX: number, clientY: number): Point => {
    const local = localPoint(clientX, clientY);
    return toScene(ctx.camera, [local.x, local.y]);
  };
  ctx.sceneAt = sceneAt;

  /// Vero se l'asse x della scena si vede più orizzontale che verticale: sul
  /// foglio girato fino a 45°, o oltre 135°.
  const sceneLevel = (): boolean => Math.abs(ctx.camera.angle) <= 45 || Math.abs(ctx.camera.angle) >= 135;
  ctx.sceneLevel = sceneLevel;

  /// Il cursore di una guida della scena lungo `axis`, che si sposta di
  /// traverso: sul foglio girato gira con lei.
  const axisCursor = (axis: "x" | "y"): GripCursor => directionCursor(ctx.camera.angle + (axis === "x" ? 0 : 90));
  ctx.axisCursor = axisCursor;

  /// Il centro di ciò che si vede del foglio, sullo schermo.
  const viewCenter = (): Point => {
    const area = viewArea();
    return [area.x + area.w / 2, area.y + area.h / 2];
  };
  ctx.viewCenter = viewCenter;

  const zoomBy = (factor: number): void => {
    setCamera(zoomAt(ctx.camera, factor, viewCenter(), DRAW_SCALE_LIMITS));
  };
  ctx.zoomBy = zoomBy;

  /// `bounds` inquadrato in ciò che si vede del foglio, accanto ai righelli,
  /// all'angolo di adesso.
  const fitted = (bounds: Bounds, area: ReturnType<typeof viewArea>): View => fitView(bounds, area, FIT_PAD, ctx.camera.angle, DRAW_SCALE_LIMITS);
  ctx.fitted = fitted;

  /// Dice l'angolo della vista.
  const announceTurn = (): void => {
    announce(ctx.camera.angle === 0 ? t("draw.turn.straight") : t("draw.turn.at", { angle: turnText(ctx.camera.angle) }));
  };
  ctx.announceTurn = announceTurn;

  /// Gira la vista fino all'angolo `angle`, attorno al centro di ciò che si
  /// vede, e lo dice. Il disegno non cambia: l'angolo è solo della vista.
  function turnView(angle: number): void {
    if (!has("gestures") && angle !== 0) return;
    ctx.placed = true;
    setCamera(turnTo(ctx.camera, angle, viewCenter()));
    announceTurn();
  }
  ctx.turnView = turnView;

  function fit(): void {
    // L'inquadratura d'apertura, prima che chi disegna muova la vista: un
    // margine fisso, e al più il 100%, così un disegno piccolo non si gonfia.
    const opening = !ctx.placed;
    const page = currentPage();
    const list = boardsNow();
    // Con le tavole si inquadrano loro e il disegno: la pagina può essere
    // cresciuta oltre.
    let bounds: Bounds | null = page === null || list.length > 0 ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
    for (const board of list) bounds = union(bounds, board.box);
    // Con un gruppo isolato si inquadra lo stesso tutto il disegno.
    for (const unit of ctx.isolation === null ? currentIndex().units : ctx.seenUnits()) bounds = union(bounds, unit.bounds);
    const area = viewArea();
    if (area.w === 0 || area.h === 0) return;
    ctx.placed = true;
    if (bounds === null) {
      setCamera({ scale: 1, angle: ctx.camera.angle, tx: area.x, ty: area.y });
      return;
    }
    if (!opening) {
      setCamera(fitted(bounds, area));
      return;
    }
    const margin = Math.min(OPEN_MARGIN_PX, area.w / 4, area.h / 4);
    const inset = { x: area.x + margin, y: area.y + margin, w: area.w - 2 * margin, h: area.h - 2 * margin };
    const view = fitView(bounds, inset, 0, ctx.camera.angle, DRAW_SCALE_LIMITS);
    if (view.scale <= 1) {
      setCamera(view);
      return;
    }
    const center: Point = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
    setCamera(placedAt({ scale: 1, angle: view.angle, tx: 0, ty: 0 }, center, [area.x + area.w / 2, area.y + area.h / 2]));
  }
  ctx.fit = fit;

  ctx.fitSelection = () => {
    const bounds = ctx.boundsOf(ctx.selectedUnits());
    if (bounds === null) {
      ctx.announce(t("draw.fit.selection.none"));
      return;
    }
    ctx.placed = true;
    setCamera(fitted(bounds, viewArea()));
  };

  // Il primo inquadramento aspetta che il foglio abbia una misura.
  if (typeof ResizeObserver !== "undefined") {
    const sizeObserver = new ResizeObserver(() => {
      if (!ctx.placed) fit();
      else folio?.view?.(ctx.camera, surface.clientWidth, surface.clientHeight);
      showGrid();
      showGuideLines();
      showRulers();
      ctx.placeBar();
      if (ctx.panelPending && root.clientWidth > 0) ctx.showPanelByDefault();
    });
    sizeObserver.observe(surface);
    life.add(() => sizeObserver.disconnect());
  }
}
