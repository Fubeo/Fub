// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clipboardData, clipboardRows, cutDestination, cutMoves, htmlTableRows, pasteTargets } from "./clipboard";

describe("pasteTargets", () => {
  it("da una cella sola, il blocco una volta dall'angolo", () => {
    expect(pasteTargets({ r0: 2, c0: 1, r1: 2, c1: 1 }, { rows: 2, columns: 3 })).toEqual([{ r0: 2, c0: 1, r1: 3, c1: 3 }]);
  });

  it("un valore, o un blocco che entra un numero intero di volte, riempie la selezione", () => {
    expect(pasteTargets({ r0: 0, c0: 0, r1: 1, c1: 1 }, { rows: 1, columns: 1 })).toHaveLength(4);
    expect(pasteTargets({ r0: 0, c0: 0, r1: 3, c1: 0 }, { rows: 2, columns: 1 })).toEqual([
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      { r0: 2, c0: 0, r1: 3, c1: 0 },
    ]);
  });

  it("un blocco che non entra va una volta sola", () => {
    expect(pasteTargets({ r0: 0, c0: 0, r1: 2, c1: 0 }, { rows: 2, columns: 1 })).toEqual([{ r0: 0, c0: 0, r1: 1, c1: 0 }]);
    expect(pasteTargets({ r0: 0, c0: 0, r1: 2, c1: 0 }, { rows: 0, columns: 0 })).toEqual([]);
  });
});

describe("tabelle HTML", () => {
  it("legge celle unite, a capo e spazi come li mostra il programma", () => {
    const html = `<html><body><!--StartFragment--><table>
      <tr><td rowspan="2">A</td><td colspan="2"><p>uno</p><p>due</p></td></tr>
      <tr><td>&nbsp;b </td><td>c<br>d</td></tr>
      </table></body></html>`;
    expect(htmlTableRows(html)).toEqual([
      ["A", "uno\ndue", ""],
      ["", "b", "c\nd"],
    ]);
  });

  it("senza tabella, o con quella di Fub, vale il testo", () => {
    expect(htmlTableRows("<p>prosa</p>")).toBeNull();
    const own = clipboardData([[{ input: "=A1+1", shown: "2" }]]);
    expect(own.text).toBe("=A1+1\n");
    expect(own.html).toContain("<td>2</td>");
    expect(clipboardRows(own.text, own.html)).toEqual([["=A1+1"]]);
    expect(clipboardRows("a\tb\n", "<table><tr><td>x</td></tr></table>")).toEqual([["x"]]);
  });

  it("l'HTML in uscita non lascia passare marcature", () => {
    expect(clipboardData([[{ input: "", shown: "<b>&" }]]).html).toContain("<td>&lt;b&gt;&amp;</td>");
  });
});

describe("il segno del taglio", () => {
  const mark = { range: { r0: 1, c0: 0, r1: 2, c1: 0 }, text: "Ada\nBea\n" };

  it("sposta se gli appunti e le celle dicono ancora il taglio", () => {
    expect(cutMoves(mark, "Ada\r\nBea\r\n", "Ada\nBea\n")).toBe(true);
    expect(cutMoves(mark, "altro", "Ada\nBea\n")).toBe(false);
    expect(cutMoves(mark, "Ada\nBea\n", "Cleo\nBea\n")).toBe(false);
  });

  it("va all'angolo della selezione, grande quanto il taglio", () => {
    expect(cutDestination(mark.range, { r0: 3, c0: 1, r1: 5, c1: 4 })).toEqual({ r0: 3, c0: 1, r1: 4, c1: 1 });
  });
});
