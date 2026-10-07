// La finestra «Esporta» di un disegno: che cosa esce (il disegno, la
// selezione, le tavole), in che formato, a che misura e con che sfondo
// (`export-plan.ts`), con l'anteprima accanto e la sua misura sotto.
//
// L'anteprima è la derivazione dell'export (`scene/export.ts`), la stessa che
// l'host fa prima di scrivere il file, come immagine coi caratteri dell'app e
// le immagini del vault, come la Lettura: sopra una scacchiera dove il file è
// trasparente, sul bianco per il JPEG e per il PDF. Con più file, o più
// pagine, si sfogliano uno alla volta. La misura è quella del file: i pixel
// come li conta l'host, o le pagine in millimetri.
//
// Dalla tastiera si usa tutta: Tab va da un gruppo all'altro e le frecce
// scelgono dentro il gruppo, come in ogni gruppo di pulsanti di scelta;
// Invio esporta anche da un pulsante di scelta o da una casella; Esc chiude,
// e il fuoco torna dov'era.

import { resolvedLanguage } from "../../../i18n/strings";
import { actions, openFrame } from "../../../ui/dialogs";
import { svgSize } from "../../media/image-view";
import { picture, type FontSheets } from "../picture";
import { imageDataUri, imageRefs, READ_IMAGE_BYTES } from "../read-images";
import { deriveExport, measureExport, SIDE_MAX, type ExportScope } from "../scene/export";
import { t, plural } from "../strings";
import {
  backgroundOf,
  chosenBoards,
  EXPORT_FORMATS,
  EXPORT_SCALES,
  exportPieces,
  exportRequest,
  initialState,
  isRaster,
  memoryOf,
  offered,
  ready,
  selectionTrouble,
  validPixels,
  type ExportFormat,
  type ExportMemory,
  type ExportScene,
  type ExportState,
  type ExportWhat,
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
  /// Legge un'immagine del vault per l'anteprima, senza leggerla se pesa più
  /// di `limit` byte; senza, le immagini sono segnaposti.
  readonly read?: (path: string, limit: number) => Promise<Blob | null>;
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

/// Apre «Esporta». Torna la scelta, o `null` se chi esporta rinuncia.
export function exportDialog(options: ExportDialogOptions): Promise<ExportChoice | null> {
  const { scene } = options;
  const id = ++dialogs;
  return new Promise((resolve) => {
    let settled = false;
    const urls: string[] = [];
    const settle = (value: ExportChoice | null): void => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
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

    choices.append(whatGroup, formatGroup, sizeGroup, backgroundGroup);

    // --- L'anteprima -------------------------------------------------------

    const preview = document.createElement("div");
    preview.className = "draw-export-preview";
    const stage = document.createElement("div");
    stage.className = "draw-export-stage";
    const image = document.createElement("img");
    image.className = "draw-export-image";
    image.decoding = "async";
    stage.append(image);
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

    layout.append(choices, preview);

    // --- Lo stato ----------------------------------------------------------

    /// Il pezzo che l'anteprima mostra.
    let shown = 0;
    /// I testi derivati, per ambito e sfondo: si rifanno solo se cambiano.
    const derived = new Map<string, string>();
    /// Le immagini del vault lette per l'anteprima, per percorso, e quanto
    /// pesano tutte insieme.
    const sources = new Map<string, string>();
    let spent = 0;
    /// Il giro dell'anteprima: uno più recente rende vecchi gli altri.
    let round = 0;
    /// La misura del pezzo che si vede, in unità del disegno.
    let natural: { readonly width: number; readonly height: number } | null = null;

    /// L'immagine il più grande possibile nello stage, senza deformarla: anche
    /// un disegno piccolo si vede bene.
    const fit = (): void => {
      if (natural === null || natural.width <= 0 || natural.height <= 0) return;
      const style = getComputedStyle(stage);
      const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (!(width > 0 && height > 0)) return;
      const scale = Math.min(width / natural.width, height / natural.height);
      image.style.width = `${natural.width * scale}px`;
      image.style.height = `${natural.height * scale}px`;
    };
    // Lo stage cambia misura con la finestra, e quando le scelte vanno sopra.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(() => fit());
    observer?.observe(stage);

    const derive = (scope: ExportScope): string => {
      const background = backgroundOf(state);
      const key = JSON.stringify([scope, background]);
      let text = derived.get(key);
      if (text === undefined) {
        text = deriveExport(options.text, scope, background);
        derived.set(key, text);
      }
      return text;
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
    };

    /// I campi che valgono con le scelte di adesso, e le frasi che li
    /// spiegano.
    const enable = (): void => {
      const boards = state.what === "boards";
      for (const check of boardChecks.values()) check.disabled = !boards;
      const raster = isRaster(state.format);
      sizeGroup.hidden = !raster;
      width.disabled = !byWidth.checked;
      width.required = byWidth.checked;
      const jpeg = state.format === "jpeg";
      none.disabled = jpeg;
      backgroundHint.hidden = !jpeg;
      if (jpeg) paper.checked = true;
      formatHint.textContent = t(`draw.export.format.${state.format}.hint`);
      // Le frasi degli errori che `reportValidity` mostra.
      const firstCheck = boardChecks.values().next().value;
      firstCheck?.setCustomValidity(boards && chosenBoards(state, scene).length === 0 ? t("draw.export.boards.empty") : "");
      width.setCustomValidity(byWidth.checked && !validPixels(Number(width.value)) ? t("draw.export.width.invalid", { max: number(SIDE_MAX) }) : "");
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
        image.hidden = true;
        return;
      }
      let text: string;
      try {
        text = derive(piece.scope);
      } catch {
        measure.textContent = t("draw.export.failed");
        image.hidden = true;
        return;
      }
      image.hidden = false;
      image.alt = piece.board === null ? t("draw.export.preview") : t("draw.export.preview.board", { name: piece.board });
      const size = svgSize(text);
      measure.textContent = size === null ? "" : measureText(state, size.width, size.height);
      natural = size;
      fit();
      void show(text, ++round);
    };

    /// Mostra `text` nell'anteprima, coi caratteri e le immagini che ha.
    const show = async (text: string, mine: number): Promise<void> => {
      const refs = imageRefs(text);
      display(picture(text, options.fonts.now(text) ?? "", refs, sources));
      let changed = false;
      if (options.fonts.now(text) === null) {
        await options.fonts.load(text);
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
      if (changed && !settled && mine === round) display(picture(text, options.fonts.now(text) ?? "", refs, sources));
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
      if (!ready(state, scene)) return;
      const request = exportRequest(state, scene, { selection: t("draw.export.suffix"), exported: t("draw.export.suffix.exported") });
      settle({ ...request, label: labelOf(state, scene), memory: memoryOf(state) });
    });
    frame.box.append(form);
    // Il fuoco sulla scelta di adesso del primo gruppo.
    what.get(state.what)!.focus();
  });
}

let dialogs = 0;

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
