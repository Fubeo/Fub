// Le finestre della stampa: Imposta pagina e l'anteprima di stampa.
//
// Imposta pagina legge le impostazioni del foglio con il suo stesso comando
// dato senza parametri, che non cambia niente, e le scrive con l'OK nelle
// quattro schede di Excel. I margini si scrivono in centimetri, come in Excel
// in italiano; il provider li vuole in pollici. Intestazione e piè di pagina
// hanno le tre sezioni di Excel, con i suoi codici (`&P`, `&N`, `&D`…).
//
// L'anteprima è il PDF che la stampa produrrebbe adesso, con ciò che la
// sessione ha cambiato e non ha ancora salvato: lo dà il provider senza
// percorso, e la finestra ne disegna una pagina alla volta con il lettore dei
// PDF della shell. Un PDF oltre il limite del risultato non arriva: la
// finestra lo dice e lascia l'esportazione, che non ha quel limite.
import { textButton } from "../../../kit";
import type { PdfEngine } from "../../media/pdf-view";
import { PAPERS } from "../ribbon/tabs";
import type { DialogBuilder, DialogSpec, SpecAction } from "./host";
import { formDialog } from "./form";
import { renderFields, type FieldSpec, type Values } from "./fields";
import { cellName, columnIndex, columnLetters } from "./refs";
import { t } from "./strings";

/// Le impostazioni di stampa di un foglio come le rende il provider.
interface PrintSettings {
  readonly orientation?: unknown;
  readonly paper?: unknown;
  readonly margins?: unknown;
  readonly print_area?: unknown;
  readonly title_rows?: unknown;
  readonly title_cols?: unknown;
  readonly scale?: unknown;
  readonly fit_to?: unknown;
  readonly gridlines?: unknown;
  readonly headings?: unknown;
  readonly center_h?: unknown;
  readonly center_v?: unknown;
  readonly header?: unknown;
  readonly footer?: unknown;
}

/// I margini di Excel per un foglio nuovo, in pollici: sinistro, destro,
/// superiore, inferiore, intestazione, piè di pagina.
const DEFAULT_MARGINS = [0.7, 0.7, 0.75, 0.75, 0.3, 0.3] as const;
const MARGIN_KEYS = ["left", "right", "top", "bottom", "header", "footer"] as const;
const CM_PER_INCH = 2.54;

/// Le tre sezioni di un'intestazione o di un piè di pagina di Excel:
/// sinistra (`&L`), centro (`&C`) e destra (`&R`). Il testo prima di ogni
/// codice di sezione è del centro, come in Excel; `&&` è una e commerciale e
/// resta com'è, come gli altri codici.
export function splitHeaderFooter(spec: string): [string, string, string] {
  const sections: [string, string, string] = ["", "", ""];
  let at = 1;
  for (let index = 0; index < spec.length; index++) {
    const char = spec[index]!;
    const next = spec[index + 1];
    if (char === "&" && next !== undefined) {
      const section = { L: 0, C: 1, R: 2 }[next.toUpperCase()];
      if (section !== undefined) {
        at = section;
        index++;
        continue;
      }
      sections[at] += char + next;
      index++;
      continue;
    }
    sections[at] += char;
  }
  return sections;
}

/// Le tre sezioni in un'intestazione di Excel, con soltanto quelle scritte.
export function joinHeaderFooter(sections: readonly [string, string, string]): string {
  return ["&L", "&C", "&R"].map((code, index) => (sections[index] ? code + sections[index] : "")).join("");
}

const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const pair = (value: unknown): readonly [number, number] | null =>
  Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number") ? [value[0] as number, value[1] as number] : null;

/// Un'area di stampa del provider (`{start: {row, col}, end: {row, col}}`) in
/// A1; vuoto se non c'è.
function areaText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const { start, end } = value as { start?: { row?: unknown; col?: unknown }; end?: { row?: unknown; col?: unknown } };
  if (!start || !end) return "";
  const cells = [start.row, start.col, end.row, end.col];
  if (!cells.every((n) => typeof n === "number")) return "";
  const [row, column, lastRow, lastColumn] = cells as number[];
  const first = cellName(row!, column!);
  return row === lastRow && column === lastColumn ? first : `${first}:${cellName(lastRow!, lastColumn!)}`;
}

/// I valori della finestra dalle impostazioni del provider.
export function setupValues(settings: PrintSettings | null): Values {
  const margins = Array.isArray(settings?.margins) ? settings.margins : [];
  const fit = pair(settings?.fit_to);
  const rows = pair(settings?.title_rows);
  const columns = pair(settings?.title_cols);
  const [headerLeft, headerCenter, headerRight] = splitHeaderFooter(typeof settings?.header === "string" ? settings.header : "");
  const [footerLeft, footerCenter, footerRight] = splitHeaderFooter(typeof settings?.footer === "string" ? settings.footer : "");
  const values: Values = {
    orientation: settings?.orientation === "Landscape" ? "landscape" : "portrait",
    paper: typeof settings?.paper === "string" && settings.paper ? settings.paper : "Letter",
    fit: fit ? "fit" : "scale",
    scale: number(settings?.scale, 100),
    fitWidth: fit ? fit[0] : 1,
    fitHeight: fit ? fit[1] : 1,
    centerH: settings?.center_h === true,
    centerV: settings?.center_v === true,
    headerLeft,
    headerCenter,
    headerRight,
    footerLeft,
    footerCenter,
    footerRight,
    printArea: areaText(settings?.print_area),
    titleRows: rows ? `${rows[0] + 1}:${rows[1] + 1}` : "",
    titleCols: columns ? `${columnLetters(columns[0])}:${columnLetters(columns[1])}` : "",
    gridlines: settings?.gridlines === true,
    headings: settings?.headings === true,
  };
  const inches = MARGIN_KEYS.map((_, index) => number(margins[index], DEFAULT_MARGINS[index]));
  MARGIN_KEYS.forEach((key, index) => (values[key] = centimetres(inches[index]!)));
  values[READ_MARGINS] = inches;
  return values;
}

/// I margini letti, in pollici: un margine che la finestra mostra com'era
/// torna al provider con il valore del file, non con quello arrotondato ai
/// centesimi di centimetro.
const READ_MARGINS = "readMargins";

const centimetres = (inches: number): number => Math.round(inches * CM_PER_INCH * 100) / 100;

/// Le righe da ripetere: `1:2`, o una riga sola.
const ROWS = /^\$?(\d{1,7})(?::\$?(\d{1,7}))?$/;

/// I parametri di `pageLayout.pageSetup` dai valori, o la ragione per cui non
/// vanno ancora.
export function setupParams(values: Values): Record<string, unknown> | string {
  const field = (key: string): string => String(values[key] ?? "").trim();
  const titleRows = field("titleRows");
  if (titleRows && !ROWS.test(titleRows)) return t("grid.dialog.page.error.rows");
  const titleCols = field("titleCols");
  if (titleCols && !titleCols.split(":").every((part) => columnIndex(part.replace(/\$/g, "")) !== null)) {
    return t("grid.dialog.page.error.columns");
  }
  const margins: Record<string, number> = {};
  const read = Array.isArray(values[READ_MARGINS]) ? (values[READ_MARGINS] as readonly number[]) : [];
  MARGIN_KEYS.forEach((key, index) => {
    const shown = Number(values[key]);
    const before = read[index];
    margins[key] = before !== undefined && centimetres(before) === shown ? before : Math.round((shown / CM_PER_INCH) * 10_000) / 10_000;
  });
  const params: Record<string, unknown> = {
    orientation: values.orientation,
    paper: values.paper,
    margins,
    centerH: values.centerH === true,
    centerV: values.centerV === true,
    header: joinHeaderFooter([field("headerLeft"), field("headerCenter"), field("headerRight")]),
    footer: joinHeaderFooter([field("footerLeft"), field("footerCenter"), field("footerRight")]),
    printArea: field("printArea"),
    titleRows: titleRows && !titleRows.includes(":") ? `${titleRows}:${titleRows}` : titleRows,
    titleCols: titleCols && !titleCols.includes(":") ? `${titleCols}:${titleCols}` : titleCols,
    gridlines: values.gridlines === true,
    headings: values.headings === true,
  };
  if (values.fit === "fit") {
    params.fitWidth = values.fitWidth;
    params.fitHeight = values.fitHeight;
  } else {
    params.scale = values.scale;
  }
  return params;
}

const pageSetup: DialogBuilder = async (context) => {
  const read = await context.read("pageLayout.pageSetup");
  const values = setupValues(read && typeof read === "object" ? (read as PrintSettings) : null);
  const margin = (key: (typeof MARGIN_KEYS)[number]): FieldSpec => ({
    kind: "number",
    key,
    label: t(`grid.dialog.page.margin.${key}`),
    min: 0,
    max: 50,
    step: 0.1,
  });
  const section = (prefix: "header" | "footer"): FieldSpec => ({
    kind: "section",
    label: t(`grid.dialog.page.${prefix}`),
    fields: (["Left", "Center", "Right"] as const).map((side) => ({
      kind: "text" as const,
      key: `${prefix}${side}`,
      label: t(`grid.dialog.page.section.${side.toLowerCase() as "left" | "center" | "right"}`),
    })),
  });
  const page = typeof context.params.page === "string" ? context.params.page : undefined;
  return formDialog(context, {
    title: t("grid.dialog.page.title"),
    values,
    command: "pageLayout.pageSetup",
    className: "grid-dialog-wide",
    page,
    change: (key) => key === "fit",
    pages: [
      {
        id: "page",
        label: t("grid.dialog.page.tab.page"),
        fields: (v) => [
          {
            kind: "radio",
            key: "orientation",
            label: t("grid.dialog.page.orientation"),
            options: [
              { value: "portrait", label: t("grid.dialog.page.portrait") },
              { value: "landscape", label: t("grid.dialog.page.landscape") },
            ],
          },
          {
            kind: "radio",
            key: "fit",
            label: t("grid.dialog.page.scaling"),
            options: [
              { value: "scale", label: t("grid.dialog.page.adjust") },
              { value: "fit", label: t("grid.dialog.page.fit") },
            ],
          },
          { kind: "number", key: "scale", label: t("grid.dialog.page.scale"), min: 10, max: 400, disabled: v.fit !== "scale" },
          { kind: "number", key: "fitWidth", label: t("grid.dialog.page.fit_width"), min: 0, max: 32767, disabled: v.fit !== "fit" },
          { kind: "number", key: "fitHeight", label: t("grid.dialog.page.fit_height"), min: 0, max: 32767, disabled: v.fit !== "fit" },
          { kind: "note", text: t("grid.dialog.page.fit_note") },
          {
            kind: "select",
            key: "paper",
            label: t("grid.dialog.page.paper"),
            options: [...new Set([...PAPERS, String(v.paper)])].map((paper) => ({ value: paper, label: paper })),
          },
        ],
      },
      {
        id: "margins",
        label: t("grid.dialog.page.tab.margins"),
        fields: () => [
          { kind: "section", label: t("grid.dialog.page.margins"), fields: MARGIN_KEYS.map(margin) },
          {
            kind: "section",
            label: t("grid.dialog.page.center"),
            fields: [
              { kind: "check", key: "centerH", label: t("grid.dialog.page.center_h") },
              { kind: "check", key: "centerV", label: t("grid.dialog.page.center_v") },
            ],
          },
        ],
      },
      {
        id: "header",
        label: t("grid.dialog.page.tab.header"),
        fields: () => [section("header"), section("footer"), { kind: "note", text: t("grid.dialog.page.codes") }],
      },
      {
        id: "sheet",
        label: t("grid.dialog.page.tab.sheet"),
        fields: () => [
          { kind: "text", key: "printArea", label: t("grid.dialog.page.print_area"), placeholder: "A1:F40" },
          {
            kind: "section",
            label: t("grid.dialog.page.titles"),
            fields: [
              { kind: "text", key: "titleRows", label: t("grid.dialog.page.title_rows"), placeholder: "1:1" },
              { kind: "text", key: "titleCols", label: t("grid.dialog.page.title_cols"), placeholder: "A:A" },
            ],
          },
          {
            kind: "section",
            label: t("grid.dialog.page.print"),
            fields: [
              { kind: "check", key: "gridlines", label: t("grid.dialog.page.gridlines") },
              { kind: "check", key: "headings", label: t("grid.dialog.page.headings") },
            ],
          },
        ],
      },
    ],
    params: setupParams,
    extra: context.serves("file.printPreview")
      ? [
          {
            id: "preview",
            label: t("grid.dialog.page.preview"),
            // Prima si scrive, poi si guarda: l'anteprima mostra ciò che l'OK
            // avrebbe dato.
            run: async () => {
              const params = setupParams(values);
              if (typeof params === "string") {
                context.fail(params);
                return false;
              }
              if (!(await context.give("pageLayout.pageSetup", params))) return false;
              context.open("printPreview");
              return false;
            },
          },
        ]
      : undefined,
  });
};

/// Una pagina dell'anteprima, come la descrive il provider.
interface PreviewPage {
  readonly sheet: string;
  readonly range: string;
  readonly scale: number;
  readonly paper: string;
  readonly orientation: string;
}

function pagesOf(result: unknown): readonly PreviewPage[] {
  const list = result && typeof result === "object" ? (result as { pageList?: unknown }).pageList : null;
  if (!Array.isArray(list)) return [];
  return list.map((page: Record<string, unknown>) => ({
    sheet: String(page.sheet ?? ""),
    range: String(page.range ?? ""),
    scale: number(page.scale, 100),
    paper: String(page.paper ?? ""),
    orientation: String(page.orientation ?? ""),
  }));
}

/// I byte di un PDF in base64.
function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/// La larghezza della pagina disegnata quando il palco non si può misurare,
/// in pixel CSS.
const PREVIEW_WIDTH = 520;

/// La larghezza in pixel CSS di una pagina larga `width` e alta `height` punti
/// nel palco: intera, come la prima vista dell'anteprima di Excel, o con lo
/// zoom larga quanto il palco, da scorrere.
function pageWidth(stage: HTMLElement, width: number, height: number, zoomed: boolean): number {
  const style = getComputedStyle(stage);
  const inner = (size: number, start: string, end: string): number => size - (parseFloat(start) || 0) - (parseFloat(end) || 0);
  const across = inner(stage.clientWidth, style.paddingLeft, style.paddingRight);
  const down = inner(stage.clientHeight, style.paddingTop, style.paddingBottom);
  if (across <= 0 || down <= 0) return PREVIEW_WIDTH;
  return Math.floor(zoomed ? across : Math.min(across, (down * width) / height));
}

const printPreview: DialogBuilder = (context): DialogSpec => {
  const loader = context.engine.pdfLoader?.() ?? null;
  const values: Values = { sheets: context.params.sheets === "all" ? "all" : "active" };
  const body = document.createElement("div");
  body.className = "grid-dialog-form grid-dialog-preview";
  const fields = document.createElement("div");
  fields.className = "grid-dialog-fields";
  const nav = document.createElement("div");
  nav.className = "grid-dialog-toolbar";
  const counter = document.createElement("p");
  counter.className = "grid-dialog-note";
  counter.setAttribute("aria-live", "polite");
  const stage = document.createElement("div");
  stage.className = "grid-preview-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "grid-preview-page";
  canvas.setAttribute("role", "img");
  stage.append(canvas);
  const status = document.createElement("p");
  status.className = "grid-dialog-note";
  status.setAttribute("role", "status");
  body.append(fields, nav, counter, stage, status);

  let pdf: PdfEngine | null = null;
  let pages: readonly PreviewPage[] = [];
  let index = 0;
  let ticket = 0;
  let zoomed = false;
  context.life.add(() => {
    ticket++;
    pdf?.destroy();
    pdf = null;
  });

  const previous = textButton({ label: t("grid.dialog.preview.previous"), lifetime: context.life, onPress: () => void show(index - 1) });
  const next = textButton({ label: t("grid.dialog.preview.next"), lifetime: context.life, onPress: () => void show(index + 1) });
  const zoom = textButton({
    label: t("grid.dialog.preview.zoom"),
    lifetime: context.life,
    onPress: () => {
      zoomed = !zoomed;
      zoom.setAttribute("aria-pressed", String(zoomed));
      void show(index);
    },
  });
  zoom.setAttribute("aria-pressed", "false");
  nav.append(previous, next, zoom);

  function say(text: string): void {
    status.textContent = text;
  }

  async function show(at: number): Promise<void> {
    const engine = pdf;
    if (!engine || at < 0 || at >= engine.pageCount) return;
    index = at;
    const count = engine.pageCount;
    previous.disabled = at === 0;
    next.disabled = at >= count - 1;
    zoom.disabled = false;
    counter.textContent = t("grid.dialog.preview.page", { page: at + 1, pages: count });
    const described = pages[at];
    canvas.setAttribute(
      "aria-label",
      described
        ? t("grid.dialog.preview.describe", { page: at + 1, sheet: described.sheet, range: described.range, paper: described.paper, scale: described.scale })
        : t("grid.dialog.preview.page", { page: at + 1, pages: count }),
    );
    try {
      const [width, height] = await engine.pageSize(at);
      if (engine !== pdf) return;
      const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
      const shown = pageWidth(stage, width, height, zoomed);
      await engine.renderPage(at, canvas, (shown / width) * ratio);
      if (engine !== pdf) return;
      canvas.style.width = `${shown}px`;
      canvas.style.height = `${canvas.height / ratio}px`;
    } catch {
      say(t("grid.dialog.preview.failed"));
    }
  }

  async function load(): Promise<void> {
    const mine = ++ticket;
    pdf?.destroy();
    pdf = null;
    stage.hidden = true;
    previous.disabled = true;
    next.disabled = true;
    zoom.disabled = true;
    counter.textContent = "";
    say(t("grid.dialog.preview.loading"));
    const params = { sheets: values.sheets };
    const [preview, printed] = await Promise.all([context.read("file.printPreview", params), context.read("file.exportPdf", params)]);
    if (mine !== ticket) return;
    pages = pagesOf(preview);
    const answer = printed && typeof printed === "object" ? (printed as { base64?: unknown; tooLarge?: unknown; pages?: unknown }) : null;
    if (answer?.tooLarge === true) {
      say(t("grid.dialog.preview.too_large"));
      return;
    }
    if (typeof answer?.base64 !== "string" || answer.pages === 0) {
      say(answer?.pages === 0 ? t("grid.dialog.preview.empty") : t("grid.dialog.preview.failed"));
      return;
    }
    if (!loader) {
      say(t("grid.dialog.preview.no_reader", { pages: pages.length }));
      return;
    }
    try {
      const engine = await loader(decode(answer.base64));
      if (mine !== ticket) {
        engine.destroy();
        return;
      }
      pdf = engine;
    } catch {
      say(t("grid.dialog.preview.failed"));
      return;
    }
    say("");
    stage.hidden = false;
    await show(0);
  }

  renderFields(
    fields,
    [
      {
        kind: "select",
        key: "sheets",
        label: t("grid.dialog.preview.sheets"),
        options: [
          { value: "active", label: t("grid.dialog.preview.active") },
          { value: "all", label: t("grid.dialog.workbook") },
        ],
      },
    ],
    values,
    () => void load(),
    context.life,
  );
  void load();

  const exportPdf = context.engine.pdfExport?.() ?? null;
  const actions: SpecAction[] = [];
  if (context.serves("pageLayout.pageSetup")) {
    actions.push({ id: "setup", label: t("grid.dialog.preview.setup"), run: () => (context.open("pageSetup", {}, true), false) });
  }
  if (exportPdf) {
    actions.push({ id: "export", label: t("grid.dialog.preview.export"), run: () => (exportPdf(), true) });
  }
  actions.push({ id: "close", label: t("grid.dialog.close"), kind: "primary" });
  return { title: t("grid.dialog.preview.title"), body, actions, className: "grid-dialog-wide" };
};

/// L'anteprima apre Imposta pagina «tornando»: questa la ritrova quando
/// quella si chiude, e ridisegna il PDF con le impostazioni nuove.
export const PAGE_DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  pageSetup,
  printPreview,
};

