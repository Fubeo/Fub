import { describe, expect, it } from "vitest";
import fixture from "../../__fixtures__/xlsx-grid.json";
import type { GridBytesSession, GridBytesWindow, GridTable } from "../../host/contract";
import {
  cellKey,
  decimalSeparator,
  fileInput,
  keyPosition,
  localInput,
  validateBytesSession,
  validateBytesWindow,
  workbookView,
  WORKBOOK_SCALE,
} from "./workbook";

/// Una copia della fixture del provider, da cambiare in un test.
function copy<T>(value: T): T {
  return structuredClone(value);
}

const session = fixture.session as GridBytesSession;
const windows = fixture.windows as GridBytesWindow[];

const TABLE: GridTable = {
  name: "Spese",
  row: 0,
  column: 0,
  rows: 2,
  columns: 2,
  header_row: true,
  totals_row: false,
  banded_rows: true,
  banded_columns: false,
  first_column: false,
  last_column: false,
  filter_button: true,
  style: "TableStyleMedium2",
};

describe("una cartella di Excel sulla versione 2", () => {
  it("disegna i fogli visibili della sessione, con le misure e le celle delle finestre", () => {
    for (const window of windows) validateBytesWindow(window, session);
    const view = workbookView(session, windows, null);
    // Il foglio nascosto non è fra quelli da mostrare.
    expect(view.workbook.sheets.map((sheet) => sheet.name)).toEqual(["Conti", "Note"]);
    expect(view.active).toBe(0);
    expect(view.notices).toEqual([{ code: "uncomputed", count: 1 }]);

    const conti = view.workbook.sheets[0];
    expect(conti.rows).toHaveLength(session.sheets[0].row_count);
    expect(conti.rows[0].height).toBeCloseTo(20 * WORKBOOK_SCALE);
    expect(conti.rows[3].height).toBeCloseTo(32 * WORKBOOK_SCALE);
    expect(conti.rows[5].hidden).toBe(true);
    expect(conti.columns[0].width).toBeCloseTo(140 * WORKBOOK_SCALE);
    expect(conti.columns[3].hidden).toBe(true);

    const cell = (row: number, column: number) => view.sheets[0].cells.get(cellKey({ row, column }));
    expect(cell(0, 0)?.cell).toEqual({
      row: "r0",
      column: "c0",
      input: "Voce",
      style: { bold: true, italic: true, text_color: "#FF0000", horizontal: "center" },
    });
    // La griglia mostra il valore formattato; l'input da scrivere sta a parte.
    expect(cell(1, 2)?.cell.input).toBe("50.00%");
    expect(cell(1, 2)?.bytes.input).toBe("0.5");
    expect(cell(2, 2)?.bytes.input).toBe("=B3/B4");
    expect(cell(4, 5)?.bytes.lock).toBe("spill");
    // H1 è vuota e unita a G1: arriva col suo blocco.
    expect(cell(0, 7)?.bytes).toMatchObject({ input: "", lock: "merged" });
    expect(cell(0, 7)?.cell.input).toBeUndefined();
    expect(view.sheets[1].cells.get(cellKey({ row: 0, column: 0 }))?.cell.input).toBe("Una nota");
  });

  it("una riga che nessuna finestra ha letto tiene la misura che aveva", () => {
    const first = workbookView(session, windows, null);
    const later = workbookView(session, [], first);
    expect(later.workbook.sheets[0].rows[3]).toEqual(first.workbook.sheets[0].rows[3]);
    expect(later.sheets[0].cells.size).toBe(0);
    const fresh = workbookView(session, [], null);
    expect(fresh.workbook.sheets[0].rows[3].id).toBe("__grid_row_s1_3");
    expect(fresh.workbook.sheets[0].rows[3].height).toBeUndefined();
  });

  it("segna le formule non aggiornate e le celle in conflitto", () => {
    const edited = fixture.edit.window as GridBytesWindow;
    validateBytesWindow(edited, { ...session, revision: fixture.edit.commit.revision });
    const view = workbookView(session, [edited], null);
    const cell = (row: number, column: number) => view.sheets[0].cells.get(cellKey({ row, column }))?.bytes;
    expect(cell(1, 1)?.input).toBe("900");
    expect(cell(3, 1)).toMatchObject({ input: "=SUM(B2:B3)", display: "680", stale: true });

    const conflict = fixture.conflict.session as GridBytesSession;
    validateBytesSession(conflict);
    expect(conflict.conflicts).toEqual([{ sheet: "s1", row: "r1", column: "c1" }]);
    const marked = workbookView(conflict, [fixture.conflict.window as GridBytesWindow], null);
    expect(marked.sheets[0].cells.get(cellKey({ row: 1, column: 1 }))?.bytes).toMatchObject({ input: "900", conflict: true });
  });

  it("rifiuta una sessione o una finestra che non si può disegnare", () => {
    validateBytesSession(session);
    const sessions: ((value: GridBytesSession) => void)[] = [
      (value) => { value.active = "s9"; },
      (value) => { value.hidden = ["s1", "s2", "s3"]; },
      (value) => { value.sheets[1].id = "s1"; },
      (value) => { value.sheets[0].row_count = -1; },
      (value) => { value.notices = [{ code: "", count: 1 }]; },
      (value) => { value.book.theme_colors.pop(); },
      (value) => { value.book.theme_colors[0] = "white"; },
      (value) => { value.book.names = [""]; },
      (value) => { value.book.calculation = "sometimes" as never; },
      (value) => { value.book.font = ""; },
      (value) => { value.book.font_size = 0; },
    ];
    for (const change of sessions) {
      const value = copy(session);
      change(value);
      expect(() => validateBytesSession(value)).toThrow();
    }
    const windowChanges: ((value: GridBytesWindow) => void)[] = [
      (value) => { value.revision = "altra"; },
      (value) => { value.total_rows += 1; },
      (value) => { value.rows[1].index = 7; },
      (value) => { value.cells[0].key.row = "r999"; },
      (value) => { value.cells[0].key.sheet = "s2"; },
      (value) => { value.view.mode = "outline" as never; },
      (value) => { value.tables = [{ ...TABLE, name: "" }]; },
      (value) => { value.tables = [{ ...TABLE, rows: 0 }]; },
      (value) => { value.tables = [{ ...TABLE, row: value.total_rows }]; },
      (value) => { value.objects[0].kind = "smartart" as never; },
      (value) => { value.objects[0].row = session.sheets[0].row_count; },
      (value) => { value.objects[0].width = -1; },
      (value) => { value.objects[0].dx = Number.NaN; },
      (value) => { value.objects[0].missing = "lost" as never; },
      (value) => { value.objects[0].media!.mime = "image/tiff"; },
      (value) => { value.objects[0].media!.key = "../a"; },
      (value) => { value.objects[0].media!.data = "non è base64"; },
      (value) => { value.objects[1].shape!.fill = "red"; },
      (value) => { value.objects[1].shape!.kind = "cloud" as never; },
      (value) => { value.objects[1].shape!.font_size = 0; },
      (value) => { value.objects[2].svg = "<script>alert(1)</script>"; },
      (value) => { value.objects = Array.from({ length: 10_000 }, () => copy(windows[0].objects[1])); },
    ];
    for (const change of windowChanges) {
      const value = copy(windows[0]);
      change(value);
      expect(() => validateBytesWindow(value, session)).toThrow();
    }
  });

  it("tiene ogni tabella una volta, anche se più finestre la toccano", () => {
    const first = copy(windows[0]);
    const second = copy(windows[0]);
    first.tables = [TABLE];
    second.tables = [{ ...TABLE, totals_row: true }];
    for (const window of [first, second]) validateBytesWindow(window, session);
    const view = workbookView(session, [first, second], null);
    expect(view.sheets[0].tables).toEqual([{ ...TABLE, totals_row: true }]);
    expect(view.sheets[1].tables).toEqual([]);
  });

  it("tiene ogni oggetto una volta, con i byte dell'immagine se una finestra li ha", () => {
    const first = copy(windows[0]);
    const second = copy(windows[0]);
    first.objects[0].media!.data = null;
    second.objects = second.objects.slice().reverse();
    for (const window of [first, second]) validateBytesWindow(window, session);
    const view = workbookView(session, [first, second], null);
    const objects = view.sheets[0].objects;
    expect(objects.map((object) => `${object.kind}:${object.id}`)).toEqual(["image:1", "shape:2", "chart:3"]);
    expect(objects[0].media?.data).toBe(windows[0].objects[0].media!.data);
    expect(view.sheets[1].objects).toEqual([]);
  });

  it("le chiavi delle celle tornano posizioni", () => {
    expect(keyPosition(cellKey({ row: 1_048_575, column: 16_383 }))).toEqual({ row: 1_048_575, column: 16_383 });
    expect(keyPosition(cellKey({ row: 3, column: 0 }))).toEqual({ row: 3, column: 0 });
  });
});

describe("l'input di una cella nella lingua", () => {
  it("prende il separatore decimale della lingua", () => {
    expect(decimalSeparator("it")).toBe(",");
    expect(decimalSeparator("en")).toBe(".");
  });

  it("mostra i numeri del file con la virgola, e lascia il resto", () => {
    expect(localInput("0.5", ",")).toBe("0,5");
    expect(localInput("-1.25e3", ",")).toBe("-1,25e3");
    expect(localInput("0.5", ".")).toBe("0.5");
    for (const input of ["=B3/B4", "1.2.3", "'0.5", "TRUE", "2023-03-15", ""]) {
      expect(localInput(input, ",")).toBe(input);
    }
  });

  it("scrive nel file ciò che si legge, e non indovina un numero col punto", () => {
    for (const input of ["0.5", "-1.25e3", "800", "Affitto", "=SUM(B2:B3)", "'0.5"]) {
      expect(fileInput(localInput(input, ","), ",")).toBe(input);
    }
    expect(fileInput("1,5", ",")).toBe("1.5");
    // In italiano `1.500` è mille e cinquecento: resta il testo scritto.
    expect(fileInput("1.500", ",")).toBe("'1.500");
    expect(fileInput("1.500", ".")).toBe("1.500");
    expect(fileInput("1,5", ".")).toBe("1,5");
  });
});
