import { describe, expect, it } from "vitest";
import { labelBlocks, layoutBlocks, type Extent, type Room } from "./tables";

/// La misura delle prove: dieci pixel per lettera, venti per riga.
const extent = (html: string): Extent => ({ width: 10 * html.replace(/<[^>]*>/g, "").length, height: 20 });

describe("labelBlocks", () => {
  it("non trova niente in un'etichetta senza tabella, o con una tabella vuota", () => {
    expect(labelBlocks("<b>testo</b><br>altro")).toBeNull();
    expect(labelBlocks("<table></table>")).toBeNull();
    expect(labelBlocks("<table><tr></tr></table>")).toBeNull();
  });

  it("legge la tabella, i suoi bordi, i margini e le celle con quello che dicono", () => {
    const blocks = labelBlocks(
      '<table border="2" bordercolor="#FF0000" cellpadding="4" cellspacing="3" style="margin: 0 auto; background-color: #ffffcc">' +
        "<thead><tr><th>A</th></tr></thead>" +
        '<tbody><tr><td bgcolor="#00ff00" align="center" valign="bottom" width="30" style="border: 2px solid blue; padding: 5px 1px" colspan="999" rowspan="0">x<table><tr><td>dentro</td></tr></table></td></tr></tbody>' +
        "</table>",
    );
    const none = { width: null, fill: null, align: null, valign: null, border: null, padding: null };
    expect(blocks).toEqual([
      {
        kind: "table",
        table: {
          rows: [
            { cells: [{ html: "A", header: true, columns: 1, rows: 1, ...none }], height: null, fill: null, align: null, valign: null },
            {
              cells: [
                {
                  // Una tabella dentro una cella resta il suo testo.
                  html: "x<table><tr><td>dentro</td></tr></table>",
                  header: false,
                  columns: 64,
                  rows: 1,
                  width: { value: 30, percent: false },
                  fill: "#00ff00",
                  align: "middle",
                  valign: "bottom",
                  border: { width: 2, color: "#0000ff" },
                  padding: 5,
                },
              ],
              height: null,
              fill: null,
              align: null,
              valign: null,
            },
          ],
          frame: { width: 2, color: "#ff0000" },
          grid: { width: 1, color: "#ff0000" },
          padding: 4,
          spacing: 3,
          width: null,
          height: null,
          fill: "#ffffcc",
          centred: true,
        },
      },
    ]);
  });

  it("coi bordi uniti non lascia spazio fra le celle, e lo stile può togliere la cornice", () => {
    const collapsed = labelBlocks('<table border="3" style="border-collapse: collapse"><tr><td>a</td></tr></table>')![0]!;
    expect(collapsed.kind === "table" && [collapsed.table.frame, collapsed.table.grid, collapsed.table.spacing]).toEqual([{ width: 1, color: "#808080" }, { width: 1, color: "#808080" }, 0]);
    const framed = labelBlocks('<table border="1" style="border: none"><tr><td>a</td></tr></table>')![0]!;
    expect(framed.kind === "table" && [framed.table.frame, framed.table.grid]).toEqual([null, { width: 1, color: "#808080" }]);
    const bare = labelBlocks("<table><tr><td>a</td></tr></table>")![0]!;
    expect(bare.kind === "table" && [bare.table.frame, bare.table.grid, bare.table.padding, bare.table.spacing]).toEqual([null, null, 1, 2]);
  });

  it("tiene il testo prima e dopo la tabella, e chiude una tabella lasciata aperta", () => {
    const blocks = labelBlocks("<b>Titolo</b><br><table><tr><td>a<td>b</tr><tr><td>c</table><div></div>fine<table><tr><td>d");
    expect(blocks?.map((block) => (block.kind === "html" ? block.html : block.table.rows.map((row) => row.cells.map((cell) => cell.html))))).toEqual([
      "<b>Titolo</b><br>",
      [["a", "b"], ["c"]],
      "<div></div>fine",
      [["d"]],
    ]);
  });

  it("legge il fondo e gli allineamenti delle righe", () => {
    const blocks = labelBlocks('<table><tr style="background: #eee url(x.png)" align="right" valign="top" height="40"><td>a</td></tr></table>');
    const row = blocks![0]!.kind === "table" ? blocks![0]!.table.rows[0]! : null;
    expect(row && { fill: row.fill, align: row.align, valign: row.valign, height: row.height }).toEqual({ fill: "#eeeeee", align: "end", valign: "top", height: { value: 40, percent: false } });
  });
});

describe("layoutBlocks", () => {
  it("misura le colonne sul testo più lungo e mette la tabella in mezzo", () => {
    const blocks = labelBlocks('<table border="1" cellpadding="2" cellspacing="0"><tr><td>ab</td><td>abcd</td></tr><tr><td>x</td><td>y</td></tr></table>')!;
    const room: Room = { box: { min: [0, 0], max: [200, 100] }, width: null, height: null, align: "middle", valign: "middle" };
    const grid = { width: 1, color: "#808080" };
    const cell = (box: [number, number, number, number]) => ({
      box: { min: [box[0], box[1]], max: [box[2], box[3]] },
      inner: { min: [box[0] + 3, box[1] + 3], max: [box[2] - 3, box[3] - 3] },
      header: false,
      align: "start",
      valign: "middle",
      fill: null,
      border: grid,
    });
    // Le colonne: il testo più i margini, 2 + 2, e il bordo, 1 + 1.
    expect(layoutBlocks(blocks, room, extent)).toEqual([
      {
        kind: "table",
        box: { min: [63, 23], max: [137, 77] },
        fill: null,
        border: grid,
        cells: [
          { ...cell([64, 24, 90, 50]), html: "ab" },
          { ...cell([90, 24, 136, 50]), html: "abcd" },
          { ...cell([64, 50, 90, 76]), html: "x" },
          { ...cell([90, 50, 136, 76]), html: "y" },
        ],
      },
    ]);
  });

  it("dà alle colonne i percenti della tabella, e alle righe il di più dell'altezza", () => {
    const blocks = labelBlocks('<b>Titolo</b><table width="100%" height="100" cellspacing="0" cellpadding="0"><tr><th colspan="2">T</th></tr><tr><td width="25%">a</td><td>b</td></tr></table>fine')!;
    const room: Room = { box: { min: [10, 10], max: [210, 210] }, width: 200, height: 200, align: "start", valign: "top" };
    const plain = { header: false, align: "start", valign: "middle", fill: null, border: null };
    const at = (box: [number, number, number, number]) => ({ box: { min: [box[0], box[1]], max: [box[2], box[3]] }, inner: { min: [box[0], box[1]], max: [box[2], box[3]] } });
    expect(layoutBlocks(blocks, room, extent)).toEqual([
      { kind: "html", html: "<b>Titolo</b>", box: { min: [10, 10], max: [210, 30] } },
      {
        kind: "table",
        box: { min: [10, 30], max: [210, 130] },
        fill: null,
        border: null,
        cells: [
          // L'intestazione sta in mezzo, e copre le due colonne.
          { ...at([10, 30, 210, 80]), ...plain, html: "T", header: true, align: "middle" },
          { ...at([10, 80, 60, 130]), ...plain, html: "a" },
          { ...at([60, 80, 210, 130]), ...plain, html: "b" },
        ],
      },
      { kind: "html", html: "fine", box: { min: [10, 130], max: [210, 150] } },
    ]);
  });

  it("restringe le colonne che chiedono più della tabella, e le celle prendono fondo e allineamenti dalla riga", () => {
    const blocks = labelBlocks('<table width="100" cellspacing="0" cellpadding="0"><tr bgcolor="#123456" align="right" valign="bottom"><td width="150">a</td><td width="50">b</td></tr></table>')!;
    const room: Room = { box: { min: [0, 0], max: [100, 20] }, width: null, height: null, align: "start", valign: "top" };
    const [table] = layoutBlocks(blocks, room, extent);
    expect(table?.kind === "table" && table.cells.map((cell) => [cell.box.min[0], cell.box.max[0], cell.fill, cell.align, cell.valign])).toEqual([
      [0, 75, "#123456", "end", "bottom"],
      [75, 100, "#123456", "end", "bottom"],
    ]);
  });
});
