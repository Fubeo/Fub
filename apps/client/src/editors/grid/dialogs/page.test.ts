// @vitest-environment happy-dom
//
// Le finestre della stampa: le sezioni di intestazione e piè di pagina, i
// margini in centimetri sopra i pollici del provider, Imposta pagina che
// scrive ciò che legge, e l'anteprima che disegna il PDF della sessione o dice
// perché non può.
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../__fixtures__/xlsx-grid.json";
import type { GridCommandState } from "../../../host/contract";
import type { PdfEngine } from "../../media/pdf-view";
import type { GridRun } from "../engine";
import { mountGridDialogs, type DialogEngine, type GridDialogs } from "./host";
import { joinHeaderFooter, setupParams, setupValues, splitHeaderFooter } from "./page";
import { t } from "./strings";

describe("intestazione e piè di pagina", () => {
  it("dividono le tre sezioni di Excel e le rimettono insieme", () => {
    expect(splitHeaderFooter("&LSinistra&CPagina &P di &N&RDestra")).toEqual(["Sinistra", "Pagina &P di &N", "Destra"]);
    // Il testo prima di ogni codice di sezione è del centro.
    expect(splitHeaderFooter("Bilancio")).toEqual(["", "Bilancio", ""]);
    // `&&` è una e commerciale, non un codice di sezione.
    expect(splitHeaderFooter("&RA&&L")).toEqual(["", "", "A&&L"]);
    expect(joinHeaderFooter(["", "Bilancio", "&D"])).toBe("&CBilancio&R&D");
    expect(joinHeaderFooter(["", "", ""])).toBe("");
  });
});

const SETTINGS = {
  orientation: "Landscape",
  paper: "A4",
  margins: [0.7, 0.7, 0.75, 0.75, 0.3, 0.3],
  print_area: { start: { row: 0, col: 0 }, end: { row: 39, col: 5 } },
  title_rows: [0, 1],
  title_cols: [0, 0],
  scale: 100,
  fit_to: [1, 0],
  gridlines: true,
  headings: false,
  center_h: true,
  center_v: false,
  header: "&CBilancio",
  footer: "&RPagina &P",
};

describe("i valori di Imposta pagina", () => {
  it("leggono le impostazioni del provider in centimetri e in A1", () => {
    const values = setupValues(SETTINGS);
    expect(values).toMatchObject({
      orientation: "landscape",
      paper: "A4",
      fit: "fit",
      fitWidth: 1,
      fitHeight: 0,
      left: 1.78,
      top: 1.91,
      header: 0.76,
      printArea: "A1:F40",
      titleRows: "1:2",
      titleCols: "A:A",
      gridlines: true,
      centerH: true,
      headerCenter: "Bilancio",
      footerRight: "Pagina &P",
    });
  });

  it("un foglio senza impostazioni ha quelle di Excel", () => {
    expect(setupValues(null)).toMatchObject({ orientation: "portrait", paper: "Letter", fit: "scale", scale: 100, left: 1.78, printArea: "" });
  });

  it("tornano al provider in pollici, con una riga sola come intervallo", () => {
    const values = setupValues(SETTINGS);
    values.titleRows = "3";
    values.titleCols = "$B";
    const params = setupParams(values);
    expect(typeof params).toBe("object");
    const written = params as Record<string, unknown>;
    expect(written).toMatchObject({
      orientation: "landscape",
      titleRows: "3:3",
      titleCols: "$B:$B",
      printArea: "A1:F40",
      header: "&CBilancio",
      footer: "&RPagina &P",
      fitWidth: 1,
      fitHeight: 0,
    });
    expect(written.scale).toBeUndefined();
    const margins = written.margins as Record<string, number>;
    // Un margine che non è cambiato torna com'era nel file, non arrotondato.
    expect(margins.left).toBe(0.7);
    expect(margins.footer).toBe(0.3);
    values.top = 2.5;
    expect(((setupParams(values) as Record<string, unknown>).margins as Record<string, number>).top).toBeCloseTo(2.5 / 2.54, 4);
    // Con la proporzione al posto dell'adattamento si manda soltanto quella.
    values.fit = "scale";
    values.scale = 80;
    const scaled = setupParams(values) as Record<string, unknown>;
    expect(scaled.scale).toBe(80);
    expect(scaled.fitWidth).toBeUndefined();
  });

  it("righe o colonne da ripetere sbagliate non vanno al provider", () => {
    const values = setupValues(null);
    values.titleRows = "prima";
    expect(setupParams(values)).toBe(t("grid.dialog.page.error.rows"));
    values.titleRows = "";
    values.titleCols = "A:1";
    expect(setupParams(values)).toBe(t("grid.dialog.page.error.columns"));
  });
});

interface Fake {
  engine: DialogEngine;
  runs: [string, unknown][];
  queries: [string, unknown][];
  answers: Record<string, unknown>;
  exported: number;
}

function fake(options: { loader?: (bytes: Uint8Array) => Promise<PdfEngine>; exportPdf?: boolean } = {}): Fake {
  const state: Fake = { engine: null as unknown as DialogEngine, runs: [], queries: [], answers: {}, exported: 0 };
  const commands: GridCommandState[] = fixture.session.commands.map((command) => ({ ...command }));
  state.engine = {
    commands: () => commands,
    run: async (id, params = "{}"): Promise<GridRun> => {
      state.runs.push([id, JSON.parse(params)]);
      return { ok: true, result: JSON.stringify(state.answers[id] ?? null) };
    },
    query: async (id, params = "{}") => {
      state.queries.push([id, JSON.parse(params)]);
      return id in state.answers ? JSON.stringify(state.answers[id]) : null;
    },
    selectionRefs: () => ({ sheet: "Foglio1", range: "A1", active: "A1" }),
    selection: () => ({ focus: { row: 0, column: 0 } }),
    sheetNames: () => ["Foglio1"],
    hiddenSheets: () => [],
    sheetView: () => ({
      frozen_rows: 0,
      frozen_columns: 0,
      gridlines: true,
      headings: true,
      zoom: 100,
      right_to_left: false,
      mode: "normal",
      formulas: false,
      protected: false,
      print_gridlines: false,
      print_headings: false,
    }),
    tables: () => [],
    book: () => fixture.session.book as never,
    activeStyle: () => undefined,
    viewportSize: () => ({ width: 800, height: 600 }),
    lineSize: () => 20,
    writeFormula: () => true,
    focus: () => {},
    pdfLoader: () => options.loader ?? null,
    pdfExport: () => (options.exportPdf ? () => void (state.exported += 1) : null),
  };
  return state;
}

/// Un lettore di PDF finto: conta le pagine disegnate e lo smontaggio.
function reader(pageCount: number) {
  const seen = { loaded: [] as Uint8Array[], rendered: [] as number[], destroyed: 0 };
  const loader = async (bytes: Uint8Array): Promise<PdfEngine> => {
    seen.loaded.push(bytes);
    return {
      pageCount,
      search: async () => [],
      renderPage: async (index, canvas) => {
        seen.rendered.push(index);
        canvas.height = 792;
      },
      pageSize: async () => [612, 792] as const,
      renderArea: async () => true,
      destroy: () => {
        seen.destroyed += 1;
      },
    };
  };
  return { loader, seen };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function press(dialogs: GridDialogs, action: string): void {
  const button = dialogs.current()?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  expect(button, `manca l'azione ${action}`).toBeTruthy();
  button!.click();
}

function status(dialogs: GridDialogs): string {
  return dialogs.current()?.querySelector('[role="status"]')?.textContent ?? "";
}

let mounted: GridDialogs | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

const PREVIEW = {
  pages: 2,
  pageList: [
    { page: 1, sheet: "Foglio1", range: "A1:F40", scale: 100, paper: "A4", orientation: "portrait" },
    { page: 2, sheet: "Foglio1", range: "A41:F80", scale: 100, paper: "A4", orientation: "portrait" },
  ],
};

describe("le finestre della stampa", () => {
  it("Imposta pagina apre la scheda chiesta e scrive ciò che ha letto", async () => {
    const state = fake();
    state.answers["pageLayout.pageSetup"] = SETTINGS;
    mounted = mountGridDialogs(state.engine);
    expect(mounted.open({ id: "pageSetup", params: '{"page":"sheet"}' })).toBe(true);
    await settle();
    // Legge con il comando dato senza parametri, che non cambia niente.
    expect(state.queries).toEqual([["pageLayout.pageSetup", {}]]);
    const selected = mounted.current()?.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.getAttribute("data-tab")).toBe("sheet");
    const rows = mounted.current()?.querySelector<HTMLInputElement>('[data-key="titleRows"]');
    expect(rows?.value).toBe("1:2");
    press(mounted, "ok");
    await settle();
    expect(state.runs).toHaveLength(1);
    const [id, params] = state.runs[0]!;
    expect(id).toBe("pageLayout.pageSetup");
    expect(params).toMatchObject({ orientation: "landscape", paper: "A4", titleRows: "1:2", titleCols: "A:A", printArea: "A1:F40" });
  });

  it("l'anteprima disegna la prima pagina del PDF della sessione e smonta il lettore", async () => {
    const { loader, seen } = reader(2);
    const state = fake({ loader, exportPdf: true });
    state.answers["file.printPreview"] = PREVIEW;
    state.answers["file.exportPdf"] = { pages: 2, bytes: 5, base64: btoa("%PDF-") };
    mounted = mountGridDialogs(state.engine);
    expect(mounted.open({ id: "printPreview", params: "{}" })).toBe(true);
    await settle();
    expect(state.queries).toEqual([
      ["file.printPreview", { sheets: "active" }],
      ["file.exportPdf", { sheets: "active" }],
    ]);
    expect(new TextDecoder().decode(seen.loaded[0])).toBe("%PDF-");
    expect(seen.rendered).toEqual([0]);
    const canvas = mounted.current()?.querySelector("canvas");
    expect(canvas?.getAttribute("aria-label")).toBe(
      t("grid.dialog.preview.describe", { page: 1, sheet: "Foglio1", range: "A1:F40", paper: "A4", scale: 100 }),
    );
    expect(mounted.current()?.textContent).toContain(t("grid.dialog.preview.page", { page: 1, pages: 2 }));
    // Esporta passa alla shell e chiude.
    press(mounted, "export");
    await settle();
    expect(state.exported).toBe(1);
    expect(mounted.current()).toBeNull();
    expect(seen.destroyed).toBe(1);
  });

  it("l'anteprima dice perché non mostra le pagine", async () => {
    const state = fake();
    state.answers["file.printPreview"] = PREVIEW;
    state.answers["file.exportPdf"] = { pages: 2, bytes: 5, base64: btoa("%PDF-") };
    mounted = mountGridDialogs(state.engine);
    mounted.open({ id: "printPreview", params: "{}" });
    await settle();
    expect(status(mounted)).toBe(t("grid.dialog.preview.no_reader", { pages: 2 }));
    // Senza l'esportazione della shell non c'è il pulsante.
    expect(mounted.current()?.querySelector('[data-action="export"]')).toBeNull();
    mounted.destroy();

    const { loader, seen } = reader(1);
    const large = fake({ loader });
    large.answers["file.printPreview"] = PREVIEW;
    large.answers["file.exportPdf"] = { tooLarge: true };
    mounted = mountGridDialogs(large.engine);
    mounted.open({ id: "printPreview", params: "{}" });
    await settle();
    expect(status(mounted)).toBe(t("grid.dialog.preview.too_large"));
    expect(seen.loaded).toHaveLength(0);
    mounted.destroy();

    const empty = fake({ loader });
    empty.answers["file.printPreview"] = { pages: 0, pageList: [] };
    empty.answers["file.exportPdf"] = { pages: 0, bytes: 0, base64: "" };
    mounted = mountGridDialogs(empty.engine);
    mounted.open({ id: "printPreview", params: "{}" });
    await settle();
    expect(status(mounted)).toBe(t("grid.dialog.preview.empty"));
  });
});
