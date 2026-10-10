// La finestra «Esporta» di un disegno: che cosa esce (il disegno, la
// selezione, le tavole), in che formato, a che misura, con che sfondo e, per
// il PDF, su che pagina (`export-plan.ts`), con l'anteprima accanto e la sua
// misura sotto.
//
// L'anteprima è la derivazione dell'export (`scene/export.ts`), la stessa che
// l'host fa prima di scrivere il file, come immagine coi caratteri dell'app e
// le immagini del vault, come la Lettura: sopra una scacchiera dove il file è
// trasparente, sul bianco per il JPEG e per il PDF. Con più file, o più
// pagine, si sfogliano uno alla volta. La misura è quella del file: i pixel
// come li conta l'host, o le pagine in millimetri.
//
// Una pagina del PDF che non è quella di sempre si vede intera: la carta,
// il disegno al suo posto con l'abbondanza intorno, e i segni, con lo stesso
// conto dell'host (`scene/print.ts`). Sotto, la misura della carta e del
// disegno, e quanto è ridotto o ingrandito.
//
// Sotto l'anteprima, i caratteri che il disegno nomina e non può caricare: il
// file li scrive con altri, come l'anteprima.
//
// Dalla tastiera si usa tutta: Tab va da un gruppo all'altro e le frecce
// scelgono dentro il gruppo, come in ogni gruppo di pulsanti di scelta;
// Invio esporta anche da un pulsante di scelta o da una casella; Esc chiude,
// e il fuoco torna dov'era.

import { resolvedLanguage } from "../../../i18n/strings";
import type { FontNotes } from "../fonts/vault";
import { actions, openFrame } from "../../../ui/dialogs";
import { svgSize } from "../../media/image-view";
import { picture, type FontSheets } from "../picture";
import { imageDataUri, imageRefs, READ_IMAGE_BYTES } from "../read-images";
import { deriveExport, exportFrame, measureExport, SIDE_MAX, type ExportScope } from "../scene/export";
import {
  BLEED_MAX_MM,
  MARGIN_MAX_MM,
  markShapes,
  PAPER_MAX_MM,
  PAPER_MIN_MM,
  paperNamed,
  printLayout,
  PT_PER_MM,
  PT_PER_PX,
  type MarkShapes,
  type Orientation,
  type PrintFit,
  type PrintSetup,
  type PrintSheet,
} from "../scene/print";
import { t, plural } from "../strings";
import {
  backgroundOf,
  chosenBoards,
  EXPORT_FORMATS,
  EXPORT_PAPERS,
  EXPORT_SCALES,
  exportPieces,
  exportRequest,
  initialState,
  isRaster,
  memoryOf,
  offered,
  PLAIN_PRINT,
  printSetup,
  printTrouble,
  ready,
  selectionTrouble,
  validPixels,
  type ExportFormat,
  type ExportMemory,
  type ExportPaper,
  type ExportScene,
  type ExportState,
  type ExportWhat,
  type PrintTrouble,
} from "./export-plan";

export interface ExportDialogOptions {
  /// Il nome del disegno, nel titolo.
  readonly name: string;
  /// Il testo del disegno, salvato.
  readonly text: string;
  readonly scene: ExportScene;
  /// Quanti oggetti scelti ricevono un id quando si esporta la selezione:
  /// la finestra lo dice. Il testo li ha già.
  readonly named?: number;
  readonly memory: ExportMemory | null;
  readonly fonts: FontSheets;
  /// Ciò che il disegno dice dei suoi caratteri, e chi avvisa quando cambia:
  /// la finestra dice quelli che non carica, e rifà l'anteprima quando una
  /// faccia arriva.
  readonly fontNotes?: { fontNotes(): FontNotes; watch(listener: () => void): () => void };
  /// Legge un'immagine del vault per l'anteprima, senza leggerla se pesa più
  /// di `limit` byte; senza, le immagini sono segnaposti.
  readonly read?: (path: string, limit: number) => Promise<Blob | null>;
  /// Vero se c'è la parte «Pagina di stampa del PDF»: senza, il gruppo
  /// «Pagina» non c'è e il PDF ha la pagina di sempre, ma le scelte che si
  /// ricordano restano per quando torna.
  readonly print?: boolean;
}

/// Ciò che la finestra sceglie: la richiesta per l'host, come l'avviso
/// chiama ciò che esce, e le scelte da ricordare.
export interface ExportChoice {
  readonly target: string;
  readonly options: Record<string, unknown>;
  readonly label: string;
  readonly memory: ExportMemory;
}

/// Quanti millimetri è un'unità del disegno: un pixel CSS, 1/96 di pollice.
const MM_PER_UNIT = 25.4 / 96;
/// Il nome dell'elemento radice dei segni dell'anteprima.
const SVG_ROOT = "svg";
const SVG_NS = "http://www.w3.org/2000/svg";

/// Apre «Esporta». Torna la scelta, o `null` se chi esporta rinuncia.
export function exportDialog(options: ExportDialogOptions): Promise<ExportChoice | null> {
  const { scene } = options;
  const id = ++dialogs;
  return new Promise((resolve) => {
    let settled = false;
    /// Smette di seguire i caratteri del disegno.
    let stopFonts: (() => void) | undefined;
    const urls: string[] = [];
    const settle = (value: ExportChoice | null): void => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      stopFonts?.();
      for (const url of urls) URL.revokeObjectURL(url);
      frame.close();
      resolve(value);
    };
    const frame = openFrame(t("draw.export.title", { name: options.name }), () => settle(null));
    frame.box.classList.add("draw-export");
    const form = document.createElement("form");
    form.className = "palette-form";
    form.noValidate = true;
    const layout = document.createElement("div");
    layout.className = "draw-export-layout";
    const choices = document.createElement("div");
    choices.className = "draw-export-choices";

    let state = initialState(scene, options.memory);
    const printing = options.print === true;
    /// Lo stato che si esporta: senza la pagina di stampa, la pagina di
    /// sempre.
    const sent = (): ExportState => (printing ? state : { ...state, print: PLAIN_PRINT });

    // --- Che cosa ----------------------------------------------------------

    const whatGroup = group(t("draw.export.what"));
    const what = new Map<ExportWhat, HTMLInputElement>();
    what.set("drawing", radio(whatGroup, `draw-export-what-${id}`, "drawing", t("draw.export.what.drawing")));
    let selectionHint: HTMLElement | null = null;
    if (scene.selection !== null) {
      const { count } = scene.selection;
      const input = radio(whatGroup, `draw-export-what-${id}`, "selection", plural(count, "draw.export.what.selection.one", "draw.export.what.selection.other", { count: number(count) }));
      what.set("selection", input);
      const trouble = selectionTrouble(scene.selection);
      const named = options.named ?? 0;
      if (trouble !== null) {
        input.disabled = true;
        selectionHint = hint(whatGroup, `draw-export-selection-${id}`, t(trouble === "unnamed" ? "draw.export.selection.unnamed" : "draw.export.selection.empty"));
      } else if (named > 0) {
        const text = plural(named, "draw.export.selection.named.one", "draw.export.selection.named.other", { count: number(named) });
        selectionHint = hint(whatGroup, `draw-export-selection-${id}`, text);
      }
      if (selectionHint !== null) input.setAttribute("aria-describedby", selectionHint.id);
    }
    const boardChecks = new Map<string, HTMLInputElement>();
    let boardList: HTMLElement | null = null;
    if (scene.boards.length > 0) {
      what.set("boards", radio(whatGroup, `draw-export-what-${id}`, "boards", t("draw.export.what.boards")));
      boardList = document.createElement("div");
      boardList.className = "draw-export-boards";
      boardList.setAttribute("role", "group");
      boardList.setAttribute("aria-label", t("draw.export.boards"));
      for (const board of scene.boards) {
        const check = checkbox(boardList, board.name);
        check.checked = !state.off.has(board.id);
        boardChecks.set(board.id, check);
      }
      whatGroup.append(boardList);
    }

    // --- Il formato --------------------------------------------------------

    const formatGroup = group(t("draw.export.format"));
    const format = new Map<ExportFormat, HTMLInputElement>();
    const formatRow = document.createElement("div");
    formatRow.className = "draw-export-row";
    formatGroup.append(formatRow);
    for (const each of EXPORT_FORMATS) {
      format.set(each, radio(formatRow, `draw-export-format-${id}`, each, t(`draw.export.format.${each}`)));
    }
    const formatHint = hint(formatGroup, `draw-export-format-hint-${id}`, "");
    formatGroup.setAttribute("aria-describedby", formatHint.id);

    // --- La misura ---------------------------------------------------------

    const sizeGroup = group(t("draw.export.size"));
    const sizeRow = document.createElement("div");
    sizeRow.className = "draw-export-row";
    sizeGroup.append(sizeRow);
    const scales = new Map<number, HTMLInputElement>();
    for (const scale of EXPORT_SCALES) {
      scales.set(scale, radio(sizeRow, `draw-export-size-${id}`, String(scale), t("draw.export.scale", { scale })));
    }
    const byWidth = radio(sizeRow, `draw-export-size-${id}`, "width", t("draw.export.width"));
    const widthField = document.createElement("label");
    widthField.className = "draw-export-width";
    const width = document.createElement("input");
    width.type = "number";
    width.inputMode = "numeric";
    width.min = "1";
    width.max = String(SIDE_MAX);
    width.step = "1";
    width.setAttribute("aria-label", t("draw.export.width.field"));
    const unit = document.createElement("span");
    unit.textContent = t("draw.export.width.unit");
    unit.setAttribute("aria-hidden", "true");
    widthField.append(width, unit);
    sizeGroup.append(widthField);

    // --- Lo sfondo ---------------------------------------------------------

    const backgroundGroup = group(t("draw.export.background"));
    const backgroundRow = document.createElement("div");
    backgroundRow.className = "draw-export-row";
    backgroundGroup.append(backgroundRow);
    const paper = radio(backgroundRow, `draw-export-background-${id}`, "paper", t("draw.export.background.paper"));
    const none = radio(backgroundRow, `draw-export-background-${id}`, "none", t("draw.export.background.none"));
    const backgroundHint = hint(backgroundGroup, `draw-export-background-hint-${id}`, t("draw.export.background.jpeg"));
    none.setAttribute("aria-describedby", backgroundHint.id);

    // --- La pagina del PDF -------------------------------------------------

    const printGroup = group(t("draw.export.print"));
    const paperField = document.createElement("label");
    paperField.className = "draw-export-field";
    const paperName = document.createElement("span");
    paperName.textContent = t("draw.export.print.paper");
    const paperSelect = document.createElement("select");
    paperSelect.className = "draw-export-select";
    for (const each of EXPORT_PAPERS) {
      const option = document.createElement("option");
      option.value = each;
      option.textContent = paperLabel(each);
      paperSelect.append(option);
    }
    paperField.append(paperName, paperSelect);
    const customRow = document.createElement("div");
    customRow.className = "draw-export-row";
    const customWidth = millimetres(customRow, t("draw.export.print.custom.width"), PAPER_MIN_MM, PAPER_MAX_MM);
    const customHeight = millimetres(customRow, t("draw.export.print.custom.height"), PAPER_MIN_MM, PAPER_MAX_MM);
    const orientationSet = subgroup(t("draw.export.print.orientation"));
    const orientations = new Map<Orientation, HTMLInputElement>();
    for (const each of ["auto", "portrait", "landscape"] as const) {
      orientations.set(each, radio(orientationSet, `draw-export-orientation-${id}`, each, t(`draw.export.print.orientation.${each}`)));
    }
    const fitSet = subgroup(t("draw.export.print.fit"));
    const fits = new Map<PrintFit, HTMLInputElement>();
    for (const each of ["shrink", "page"] as const) {
      fits.set(each, radio(fitSet, `draw-export-fit-${id}`, each, t(`draw.export.print.fit.${each}`)));
    }
    const edgeRow = document.createElement("div");
    edgeRow.className = "draw-export-row";
    const margin = millimetres(edgeRow, t("draw.export.print.margin"), 0, MARGIN_MAX_MM);
    const marginField = margin.parentElement!;
    const bleed = millimetres(edgeRow, t("draw.export.print.bleed"), 0, BLEED_MAX_MM);
    const bleedHint = hint(printGroup, `draw-export-bleed-hint-${id}`, t("draw.export.print.bleed.hint"));
    bleed.setAttribute("aria-describedby", bleedHint.id);
    const marksSet = subgroup(t("draw.export.print.marks"));
    const marksRow = document.createElement("div");
    marksRow.className = "draw-export-row";
    marksSet.append(marksRow);
    const crop = checkbox(marksRow, t("draw.export.print.marks.crop"));
    const registration = checkbox(marksRow, t("draw.export.print.marks.registration"));
    printGroup.insertBefore(paperField, bleedHint);
    printGroup.insertBefore(customRow, bleedHint);
    printGroup.insertBefore(orientationSet, bleedHint);
    printGroup.insertBefore(fitSet, bleedHint);
    printGroup.insertBefore(edgeRow, bleedHint);
    printGroup.append(marksSet);

    choices.append(whatGroup, formatGroup, sizeGroup, printGroup, backgroundGroup);

    // --- L'anteprima -------------------------------------------------------

    const preview = document.createElement("div");
    preview.className = "draw-export-preview";
    const stage = document.createElement("div");
    stage.className = "draw-export-stage";
    // La pagina: il file come si vede, o la carta del PDF col disegno al suo
    // posto e i segni sopra.
    const sheetBox = document.createElement("div");
    sheetBox.className = "draw-export-sheet";
    const image = document.createElement("img");
    image.className = "draw-export-image";
    image.decoding = "async";
    const marks = document.createElementNS(SVG_NS, SVG_ROOT);
    marks.classList.add("draw-export-marks");
    marks.setAttribute("aria-hidden", "true");
    marks.setAttribute("preserveAspectRatio", "none");
    sheetBox.append(image, marks);
    stage.append(sheetBox);
    const pager = document.createElement("div");
    pager.className = "draw-export-pager";
    const previous = pagerButton(pager, t("draw.export.previous"), "‹");
    const page = document.createElement("span");
    page.className = "draw-export-page";
    page.setAttribute("aria-live", "polite");
    const next = pagerButton(pager, t("draw.export.next"), "›");
    pager.insertBefore(page, next);
    const measure = document.createElement("p");
    measure.className = "draw-export-measure";
    measure.setAttribute("aria-live", "polite");
    preview.append(stage, pager, measure);
    const fontsHint = hint(preview, `draw-export-fonts-${id}`, "");
    fontsHint.setAttribute("aria-live", "polite");
    /// Dice le famiglie che il disegno non carica: non ci sono, superano il
    /// tetto o il browser non le legge.
    const sayFonts = (): void => {
      const notes = options.fontNotes?.fontNotes();
      const names = notes === undefined ? [] : [...notes.missing, ...notes.over, ...notes.failed];
      fontsHint.hidden = names.length === 0;
      fontsHint.textContent = names.length === 0 ? "" : t("draw.export.fonts", { families: new Intl.ListFormat(resolvedLanguage(), { type: "conjunction" }).format(names) });
    };
    sayFonts();

    layout.append(choices, preview);

    // --- Lo stato ----------------------------------------------------------

    /// Il pezzo che l'anteprima mostra.
    let shown = 0;
    /// I testi derivati, per ambito, sfondo e abbondanza: si rifanno solo se
    /// cambiano.
    const derived = new Map<string, string>();
    /// Le immagini del vault lette per l'anteprima, per percorso, e quanto
    /// pesano tutte insieme.
    const sources = new Map<string, string>();
    let spent = 0;
    /// Il giro dell'anteprima: uno più recente rende vecchi gli altri.
    let round = 0;
    /// La misura della pagina che si vede: in unità del disegno, o in punti
    /// per la carta del PDF.
    let natural: { readonly width: number; readonly height: number } | null = null;

    /// La pagina il più grande possibile nello stage, senza deformarla: anche
    /// un disegno piccolo si vede bene.
    const fit = (): void => {
      if (natural === null || natural.width <= 0 || natural.height <= 0) return;
      const style = getComputedStyle(stage);
      const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (!(width > 0 && height > 0)) return;
      const scale = Math.min(width / natural.width, height / natural.height);
      sheetBox.style.width = `${natural.width * scale}px`;
      sheetBox.style.height = `${natural.height * scale}px`;
    };
    // Lo stage cambia misura con la finestra, e quando le scelte vanno sopra.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(() => fit());
    observer?.observe(stage);
    // Una faccia arrivata, o una famiglia che non si carica: la riga e
    // l'anteprima si rifanno.
    stopFonts = options.fontNotes?.watch(() => {
      sayFonts();
      refresh();
    });

    const derive = (scope: ExportScope, bleed = 0): string => {
      const background = backgroundOf(state);
      const key = JSON.stringify([scope, background, bleed]);
      let text = derived.get(key);
      if (text === undefined) {
        text = deriveExport(options.text, scope, background, bleed);
        derived.set(key, text);
      }
      return text;
    };

    /// La pagina del PDF di `scope` con `setup`, come la scrive l'host: il
    /// testo derivato con l'abbondanza, che sulla carta è in millimetri e
    /// nella derivazione in pixel della pagina, quindi divisa per la scala;
    /// la carta; il rettangolo del disegno e i segni, in punti.
    const printPage = (scope: ExportScope, setup: PrintSetup): PrintPage => {
      const frame = setup.bleed > 0 ? exportFrame(options.text, scope) : null;
      const bled = frame === null ? 0 : (setup.bleed * PX_PER_MM) / printLayout(frame[0], frame[1], setup).scale;
      const text = derive(scope, bled);
      const size = svgSize(text);
      const drawn = size === null ? null : ([size.width, size.height] as const);
      const trim = frame ?? drawn;
      const unbled = frame === null && setup.bleed > 0;
      if (drawn === null || trim === null) return { text, sheet: null, drawing: [0, 0, 0, 0], shapes: { lines: [], circles: [] }, plain: true, unbled };
      const page = frame === null ? { ...setup, bleed: 0 } : setup;
      const sheet = printLayout(trim[0], trim[1], page);
      const points = PT_PER_PX * sheet.scale;
      const outset = [(drawn[0] - trim[0]) / 2, (drawn[1] - trim[1]) / 2] as const;
      return {
        text,
        sheet,
        drawing: [sheet.trim[0] - outset[0] * points, sheet.trim[1] - outset[1] * points, drawn[0] * points, drawn[1] * points],
        shapes: markShapes(sheet, page.marks),
        plain: page.paper === null && page.bleed <= 0 && !page.marks.crop && !page.marks.registration,
        unbled,
      };
    };

    /// La pagina che si vede: il file intero, o la carta del PDF con il
    /// disegno nel rettangolo `drawing` e i segni `shapes`.
    const place = (page: { readonly width: number; readonly height: number }, drawing: readonly number[] | null, shapes: MarkShapes): void => {
      const [x, y, w, h] = drawing ?? [0, 0, page.width, page.height];
      image.style.left = `${(x! / page.width) * 100}%`;
      image.style.top = `${(y! / page.height) * 100}%`;
      image.style.width = `${(w! / page.width) * 100}%`;
      image.style.height = `${(h! / page.height) * 100}%`;
      sheetBox.dataset.paper = drawing === null ? "file" : "print";
      marks.setAttribute("viewBox", `0 0 ${page.width} ${page.height}`);
      marks.replaceChildren();
      for (const [x1, y1, x2, y2] of shapes.lines) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        marks.append(line);
      }
      for (const [cx, cy, r] of shapes.circles) {
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", String(cx));
        circle.setAttribute("cy", String(cy));
        circle.setAttribute("r", String(r));
        marks.append(circle);
      }
    };

    /// Le scelte dei campi, nello stato.
    const read = (): ExportState => {
      const chosen = (map: ReadonlyMap<string, HTMLInputElement>): string | undefined => [...map].find(([, input]) => input.checked)?.[0];
      const off = new Set<string>();
      for (const [board, check] of boardChecks) if (!check.checked) off.add(board);
      const scale = [...scales].find(([, input]) => input.checked)?.[0];
      return {
        what: (chosen(what) as ExportWhat | undefined) ?? state.what,
        off,
        format: (chosen(format) as ExportFormat | undefined) ?? state.format,
        size: byWidth.checked ? { pixels: Number(width.value) } : { scale: scale ?? 2 },
        background: none.checked ? "none" : "paper",
        print: {
          paper: paperSelect.value as ExportPaper,
          custom: [millimetresOf(customWidth), millimetresOf(customHeight)],
          orientation: (chosen(orientations) as Orientation | undefined) ?? state.print.orientation,
          margin: millimetresOf(margin),
          fit: (chosen(fits) as PrintFit | undefined) ?? state.print.fit,
          bleed: millimetresOf(bleed),
          crop: crop.checked,
          registration: registration.checked,
        },
      };
    };

    /// I campi come dice `state`.
    const write = (): void => {
      what.get(state.what)!.checked = true;
      format.get(state.format)!.checked = true;
      if ("pixels" in state.size) {
        byWidth.checked = true;
        width.value = String(state.size.pixels);
      } else {
        scales.get(state.size.scale)!.checked = true;
      }
      (state.background === "none" ? none : paper).checked = true;
      const print = state.print;
      paperSelect.value = print.paper;
      customWidth.value = String(print.custom[0]);
      customHeight.value = String(print.custom[1]);
      orientations.get(print.orientation)!.checked = true;
      fits.get(print.fit)!.checked = true;
      margin.value = String(print.margin);
      bleed.value = String(print.bleed);
      crop.checked = print.crop;
      registration.checked = print.registration;
    };

    /// I campi che valgono con le scelte di adesso, e le frasi che li
    /// spiegano.
    const enable = (): void => {
      const boards = state.what === "boards";
      for (const check of boardChecks.values()) check.disabled = !boards;
      const raster = isRaster(state.format);
      sizeGroup.hidden = !raster;
      width.disabled = !raster || !byWidth.checked;
      width.required = raster && byWidth.checked;
      const jpeg = state.format === "jpeg";
      none.disabled = jpeg;
      backgroundHint.hidden = !jpeg;
      if (jpeg) paper.checked = true;
      formatHint.textContent = t(`draw.export.format.${state.format}.hint`);
      // La pagina del PDF: margini, orientamento e adattamento soltanto con
      // una carta col suo formato; l'orientamento di una carta su misura è
      // come è scritta. Ciò che non si vede non si controlla.
      const pdf = state.format === "pdf" && printing;
      const sheet = state.print.paper !== "fit";
      const custom = state.print.paper === "custom";
      printGroup.hidden = !pdf;
      customRow.hidden = !custom;
      orientationSet.hidden = !sheet || custom;
      fitSet.hidden = !sheet;
      marginField.hidden = !sheet;
      customWidth.disabled = customHeight.disabled = !pdf || !custom;
      margin.disabled = !pdf || !sheet;
      bleed.disabled = !pdf;
      // Le frasi degli errori che `reportValidity` mostra.
      const firstCheck = boardChecks.values().next().value;
      firstCheck?.setCustomValidity(boards && chosenBoards(state, scene).length === 0 ? t("draw.export.boards.empty") : "");
      width.setCustomValidity(raster && byWidth.checked && !validPixels(Number(width.value)) ? t("draw.export.width.invalid", { max: number(SIDE_MAX) }) : "");
      const trouble = pdf ? printTrouble(state.print) : null;
      const sizes = { min: number(PAPER_MIN_MM), max: number(PAPER_MAX_MM) };
      for (const input of [customWidth, customHeight]) {
        input.setCustomValidity(trouble === "custom" && !withinMillimetres(input) ? t("draw.export.print.custom.invalid", sizes) : "");
      }
      margin.setCustomValidity(trouble === "margin" ? t("draw.export.print.margin.invalid", { max: number(MARGIN_MAX_MM) }) : trouble === "room" ? t("draw.export.print.room") : "");
      bleed.setCustomValidity(trouble === "bleed" ? t("draw.export.print.bleed.invalid", { max: number(BLEED_MAX_MM) }) : "");
    };

    const refresh = (): void => {
      state = read();
      enable();
      state = read();
      const pieces = exportPieces(state, scene);
      if (shown >= pieces.length) shown = pieces.length - 1;
      if (shown < 0) shown = 0;
      const piece = pieces[shown];
      const many = pieces.length > 1;
      pager.hidden = !many;
      previous.disabled = shown === 0;
      next.disabled = shown >= pieces.length - 1;
      if (many && piece !== undefined) {
        const key = state.format === "pdf" ? "draw.export.page" : "draw.export.file";
        page.textContent = t(key, { index: number(shown + 1), count: number(pieces.length), name: piece.board ?? "" });
      }
      stage.dataset.backdrop = state.format === "jpeg" || state.format === "pdf" ? "white" : "checker";
      if (piece === undefined || !offered(scene, state.what)) {
        measure.textContent = state.what === "boards" ? t("draw.export.boards.empty") : "";
        sheetBox.hidden = true;
        return;
      }
      const trouble = state.format === "pdf" && printing ? printTrouble(state.print) : null;
      if (trouble !== null) {
        measure.textContent = troubleText(trouble);
        sheetBox.hidden = true;
        return;
      }
      let text: string;
      let printed: PrintPage | null = null;
      try {
        if (state.format === "pdf" && printing) printed = printPage(piece.scope, printSetup(state.print));
        text = printed?.text ?? derive(piece.scope);
      } catch {
        measure.textContent = t("draw.export.failed");
        sheetBox.hidden = true;
        return;
      }
      sheetBox.hidden = false;
      image.alt = piece.board === null ? t("draw.export.preview") : t("draw.export.preview.board", { name: piece.board });
      if (printed !== null && !printed.plain && printed.sheet !== null) {
        const sheet = printed.sheet;
        measure.textContent = printMeasureText(sheet);
        natural = { width: sheet.width, height: sheet.height };
        place(natural, printed.drawing, printed.shapes);
      } else {
        const size = svgSize(text);
        measure.textContent = size === null ? "" : measureText(state, size.width, size.height);
        natural = size;
        if (size !== null) place(size, null, { lines: [], circles: [] });
      }
      if (printed?.unbled) measure.textContent = `${measure.textContent} ${t("draw.export.print.unbled")}`.trim();
      fit();
      void show(text, ++round);
    };

    /// Mostra `text` nell'anteprima, coi caratteri e le immagini che ha.
    const show = async (text: string, mine: number): Promise<void> => {
      const refs = imageRefs(text);
      let css = options.fonts.now(text);
      display(picture(text, css ?? "", refs, sources));
      let changed = false;
      if (css === null) {
        css = await options.fonts.load(text);
        changed = true;
      }
      for (const path of new Set(refs.flatMap((ref) => (ref.path === null || sources.has(ref.path) ? [] : [ref.path])))) {
        const room = READ_IMAGE_BYTES - spent;
        if (options.read === undefined || room <= 0) break;
        const blob = await options.read(path, room).catch(() => null);
        const uri = blob === null || blob.size > room ? null : await imageDataUri(blob);
        if (uri === null) continue;
        sources.set(path, uri);
        spent += blob!.size;
        changed = true;
      }
      if (changed && !settled && mine === round) display(picture(text, options.fonts.now(text) ?? css, refs, sources));
    };

    const display = (svg: string): void => {
      if (settled) return;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      urls.push(url);
      image.src = url;
      // Resta l'URL di adesso, e quello di prima finché l'immagine non cambia.
      while (urls.length > 2) URL.revokeObjectURL(urls.shift()!);
    };

    write();
    refresh();

    form.addEventListener("change", (event) => {
      // Una scala scelta dopo la larghezza la lascia; la larghezza scelta
      // parte dalla misura di adesso.
      if (event.target === byWidth && !validPixels(Number(width.value))) width.value = String(startWidth());
      refresh();
      if (event.target === byWidth) {
        width.focus();
        width.select();
      }
    });
    width.addEventListener("input", refresh);
    for (const input of [customWidth, customHeight, margin, bleed]) input.addEventListener("input", refresh);
    previous.addEventListener("click", () => {
      shown -= 1;
      refresh();
      if (previous.disabled) next.focus();
    });
    next.addEventListener("click", () => {
      shown += 1;
      refresh();
      if (next.disabled) previous.focus();
    });

    /// La larghezza da cui parte il campo: quella del pezzo di adesso alla
    /// scala che era scelta.
    const startWidth = (): number => {
      const piece = exportPieces(state, scene)[shown];
      let text: string | null = null;
      try {
        text = piece === undefined ? null : derive(piece.scope);
      } catch {
        text = null;
      }
      const size = text === null ? null : svgSize(text);
      const scale = "scale" in state.size ? state.size.scale : 2;
      return size === null ? 1920 : measureExport(size.width, size.height, { scale }).width;
    };

    const row = actions(t("draw.export.go"), () => settle(null));
    form.append(layout, row);
    // Invio esporta anche da un pulsante di scelta o da una casella, dove il
    // browser non lo farebbe da solo.
    form.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (target instanceof HTMLInputElement && (target.type === "radio" || target.type === "checkbox")) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!ready(sent(), scene)) return;
      const request = exportRequest(sent(), scene, { selection: t("draw.export.suffix"), exported: t("draw.export.suffix.exported") });
      settle({ ...request, label: labelOf(state, scene), memory: memoryOf(state) });
    });
    frame.box.append(form);
    // Il fuoco sulla scelta di adesso del primo gruppo.
    what.get(state.what)!.focus();
  });
}

let dialogs = 0;

/// Pixel CSS per millimetro: 96 per pollice, 25,4 millimetri per pollice.
const PX_PER_MM = PT_PER_MM / PT_PER_PX;

/// La pagina del PDF di un pezzo: il testo da mostrare, la carta (`null` se
/// il testo non dice la sua misura), il rettangolo del disegno e i segni, in
/// punti, e se è la pagina di sempre.
interface PrintPage {
  readonly text: string;
  readonly sheet: PrintSheet | null;
  readonly drawing: readonly [number, number, number, number];
  readonly shapes: MarkShapes;
  readonly plain: boolean;
  /// Vero se l'abbondanza chiesta non c'è, perché il disegno intero non dice
  /// la sua misura.
  readonly unbled: boolean;
}

/// Il nome di una carta nell'elenco: col formato, la sua misura.
function paperLabel(paper: ExportPaper): string {
  if (paper === "fit" || paper === "custom") return t(`draw.export.print.paper.${paper}`);
  const [short, long] = paperNamed(paper)!;
  return t("draw.export.print.paper.named", { name: t(`draw.export.print.paper.${paper}`), width: number(short, 1), height: number(long, 1) });
}

/// La frase di ciò che impedisce di esportare una pagina del PDF.
function troubleText(trouble: PrintTrouble): string {
  if (trouble === "custom") return t("draw.export.print.custom.invalid", { min: number(PAPER_MIN_MM), max: number(PAPER_MAX_MM) });
  if (trouble === "margin") return t("draw.export.print.margin.invalid", { max: number(MARGIN_MAX_MM) });
  if (trouble === "bleed") return t("draw.export.print.bleed.invalid", { max: number(BLEED_MAX_MM) });
  return t("draw.export.print.room");
}

/// La misura di una pagina del PDF: la carta e il disegno da tagliare in
/// millimetri, e la scala del disegno.
export function printMeasureText(sheet: PrintSheet): string {
  const mm = (points: number): string => number(points / PT_PER_MM, 1);
  const percent = new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 }).format(sheet.scale);
  return t("draw.export.print.measure", {
    width: mm(sheet.width),
    height: mm(sheet.height),
    trimWidth: mm(sheet.trim[2]),
    trimHeight: mm(sheet.trim[3]),
    percent,
  });
}

/// Come l'avviso dell'avvio chiama ciò che esce: «PNG», «PNG della
/// selezione», «PDF di 3 tavole».
export function labelOf(state: ExportState, scene: ExportScene): string {
  const name = t(`draw.export.format.${state.format}`);
  if (state.what === "selection") return t("draw.export.label.selection", { format: name });
  if (state.what === "boards") {
    const count = chosenBoards(state, scene).length;
    return plural(count, "draw.export.label.boards.one", "draw.export.label.boards.other", { format: name, count: number(count) });
  }
  return name;
}

/// La misura del file di un rettangolo di `width` × `height` unità: i pixel
/// per PNG e JPEG, come li conta l'host, le unità per l'SVG, i millimetri
/// della pagina per il PDF.
export function measureText(state: ExportState, width: number, height: number): string {
  if (isRaster(state.format)) {
    const size = measureExport(width, height, state.size);
    const args = { width: number(size.width), height: number(size.height) };
    return size.reduced ? t("draw.export.pixels.reduced", { ...args, side: number(SIDE_MAX) }) : t("draw.export.pixels", args);
  }
  if (state.format === "svg") return t("draw.export.units", { width: number(width, 2), height: number(height, 2) });
  return t("draw.export.millimetres", { width: number(width * MM_PER_UNIT, 1), height: number(height * MM_PER_UNIT, 1) });
}

/// `value` nella lingua di chi guarda, con al più `places` decimali.
function number(value: number, places = 0): string {
  return new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: places }).format(value);
}

/// Un gruppo di campi col suo titolo.
function group(title: string): HTMLFieldSetElement {
  const set = document.createElement("fieldset");
  set.className = "draw-export-group";
  const legend = document.createElement("legend");
  legend.textContent = title;
  set.append(legend);
  return set;
}

/// Un pulsante di scelta col suo nome accanto.
function radio(parent: HTMLElement, name: string, value: string, label: string): HTMLInputElement {
  const field = document.createElement("label");
  field.className = "draw-export-option";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  const text = document.createElement("span");
  text.textContent = label;
  field.append(input, text);
  parent.append(field);
  return input;
}

/// Una casella col suo nome accanto.
function checkbox(parent: HTMLElement, label: string): HTMLInputElement {
  const field = document.createElement("label");
  field.className = "draw-export-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  const text = document.createElement("span");
  text.textContent = label;
  field.append(input, text);
  parent.append(field);
  return input;
}

/// Un gruppo di scelte dentro un gruppo, col suo titolo più piccolo.
function subgroup(title: string): HTMLFieldSetElement {
  const set = document.createElement("fieldset");
  set.className = "draw-export-subgroup";
  const legend = document.createElement("legend");
  legend.textContent = title;
  set.append(legend);
  return set;
}

/// Un campo di millimetri da `min` a `max`, col suo nome prima e l'unità
/// dopo.
function millimetres(parent: HTMLElement, label: string, min: number, max: number): HTMLInputElement {
  const field = document.createElement("label");
  field.className = "draw-export-field";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.min = String(min);
  input.max = String(max);
  input.step = "any";
  const unit = document.createElement("span");
  unit.className = "draw-export-unit";
  unit.textContent = t("draw.export.print.unit");
  unit.setAttribute("aria-hidden", "true");
  field.append(name, input, unit);
  parent.append(field);
  return input;
}

/// I millimetri scritti in `input`: un campo vuoto non è un numero.
function millimetresOf(input: HTMLInputElement): number {
  return input.value.trim() === "" ? Number.NaN : Number(input.value);
}

/// Vero se `input` ha una misura fra il suo minimo e il suo massimo.
function withinMillimetres(input: HTMLInputElement): boolean {
  const value = millimetresOf(input);
  return Number.isFinite(value) && value >= Number(input.min) && value <= Number(input.max);
}

/// Una frase sotto un gruppo, che lo spiega.
function hint(parent: HTMLElement, id: string, text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "draw-export-hint";
  element.id = id;
  element.textContent = text;
  parent.append(element);
  return element;
}

function pagerButton(parent: HTMLElement, label: string, glyph: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "draw-export-turn";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = glyph;
  parent.append(button);
  return button;
}
