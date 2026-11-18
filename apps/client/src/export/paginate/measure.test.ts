// @vitest-environment happy-dom
// La misura della resa per la stampa (T69b). happy-dom non dispone la pagina:
// le prove danno a ogni elemento e a ogni pezzo di testo il suo rettangolo, e
// guardano che le scatole escano giuste, con la stima e con le righe.

import { afterEach, describe, expect, it, vi } from "vitest";
import { bandsOf, blockId, lineRows, printBlocks, PrintMeasure } from "./measure";
import { boxHeight } from "./model";

type Rect = { top: number; bottom: number };

const rect = ({ top, bottom }: Rect, left = 0, width = 600) =>
  ({ top, bottom, left, right: left + width, width, height: bottom - top, x: left, y: top, toJSON() { return this; } }) as DOMRect;

const NOTE = `
  <article class="print-page"><h1>Nota</h1><div class="print-body markdown-rendered">
    <h2 data-md-from="0">Titolo</h2>
    <p data-md-from="10" style="line-height: 20px">uno due tre <span>quattro</span></p>
    <ul><li data-md-from="30" style="line-height: 20px"><p>voce</p></li><li data-md-from="40" style="line-height: 20px">due <img alt="icona"></li></ul>
    <pre data-md-from="50" style="line-height: 18px"><code>a
b
c</code><button class="markdown-code-copy">Copia</button></pre>
    <div class="markdown-table-scroll"><table data-md-from="60"><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table></div>
    <hr data-md-from="70">
    <figure data-md-from="80"><img alt="foto"></figure>
    <p data-md-from="90" hidden>nascosto</p>
  </div></article>`;

/// Mette la nota nel documento e dà i rettangoli: la radice comincia a 50.
function mount() {
  const root = document.createElement("div");
  root.innerHTML = NOTE;
  document.body.append(root);
  const rects = new Map<Element, Rect>();
  const texts = new Map<Node, Rect[]>();
  const q = (selector: string) => root.querySelector(selector)!;
  const textOf = (selector: string) => q(selector).firstChild!;
  rects.set(root, { top: 50, bottom: 1000 });
  rects.set(q(".print-page > h1"), { top: 50, bottom: 90 });
  rects.set(q("h2"), { top: 110, bottom: 140 });
  // Il paragrafo: tre righe da 20 px, la terza col pezzo in `span`.
  rects.set(q("p[data-md-from='10']"), { top: 150, bottom: 210 });
  texts.set(textOf("p[data-md-from='10']"), [{ top: 152, bottom: 168 }, { top: 172, bottom: 188 }]);
  texts.set(textOf("p[data-md-from='10'] span"), [{ top: 192, bottom: 208 }]);
  rects.set(q("li[data-md-from='30']"), { top: 220, bottom: 240 });
  texts.set(textOf("li[data-md-from='30'] p"), [{ top: 222, bottom: 238 }]);
  rects.set(q("li[data-md-from='40']"), { top: 240, bottom: 270 });
  texts.set(textOf("li[data-md-from='40']"), [{ top: 248, bottom: 264 }]);
  rects.set(q("li[data-md-from='40'] img"), { top: 242, bottom: 268 });
  // Il codice: tre righe da 18 px e 10 px di riquadro sopra e sotto.
  rects.set(q("pre"), { top: 280, bottom: 354 });
  texts.set(textOf("pre code"), [{ top: 290, bottom: 308 }, { top: 308, bottom: 326 }, { top: 326, bottom: 344 }]);
  texts.set(textOf(".markdown-code-copy"), [{ top: 284, bottom: 300 }]);
  rects.set(q(".markdown-table-scroll"), { top: 370, bottom: 460 });
  rects.set(q("thead"), { top: 370, bottom: 400 });
  const rows = root.querySelectorAll("tbody tr");
  rects.set(rows[0], { top: 400, bottom: 430 });
  rects.set(rows[1], { top: 430, bottom: 460 });
  rects.set(q("hr"), { top: 480, bottom: 481 });
  rects.set(q("figure"), { top: 500, bottom: 800 });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rect(rects.get(this) ?? { top: 0, bottom: 0 });
  });
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const list = (texts.get(this.startContainer) ?? []).map((r) => rect(r));
    return Object.assign(list, { item: (i: number) => list[i] ?? null }) as unknown as DOMRectList;
  });
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("i blocchi della resa", () => {
  it("scende nella pagina di stampa e negli elenchi; ciò che è nascosto non c'è", () => {
    const root = mount();
    const blocks = printBlocks(root);
    expect(blocks.map((b) => b.tagName)).toEqual(["H1", "H2", "P", "LI", "LI", "PRE", "DIV", "HR", "FIGURE"]);
    expect(blocks.map((b, i) => blockId(b, i))).toEqual(["titolo", "md:0", "md:10", "md:30", "md:40", "md:50", "blocco:6", "md:70", "md:80"]);
  });
});

describe("la stima", () => {
  it("un rettangolo per blocco, le righe uguali dall'interlinea", () => {
    const measure = new PrintMeasure(mount());
    const at = (i: number) => measure.measure(i, "stima");
    expect(at(0)).toEqual({ box: { kind: "heading", id: "titolo", level: 1, height: 40 }, top: 0, bottom: 40, exact: true });
    expect(at(1).box).toEqual({ kind: "heading", id: "md:0", level: 2, height: 30 });
    // Tre righe di solo testo, alte un multiplo dell'interlinea: la stima è
    // già la misura (uno `span` non cambia l'altezza delle righe).
    expect(at(2)).toEqual({ box: { kind: "paragraph", id: "md:10", lines: [20, 20, 20] }, top: 100, bottom: 160, exact: true });
    // La voce «larga» col suo paragrafo: esatta.
    expect(at(3)).toMatchObject({ box: { kind: "paragraph", lines: [20] }, exact: true });
    // La voce con un'immagine in linea: alta 30, non un multiplo; da misurare.
    expect(at(4)).toMatchObject({ box: { kind: "paragraph" }, exact: false });
    expect(boxHeight(at(4).box)).toBeCloseTo(30);
    // Il codice si misura sempre riga per riga.
    expect(at(5)).toMatchObject({ box: { kind: "code" }, exact: false });
    expect(boxHeight(at(5).box)).toBeCloseTo(74);
    expect(at(6)).toEqual({ box: { kind: "table", id: "blocco:6", header: 30, rows: [30, 30] }, top: 320, bottom: 410, exact: false });
    expect(at(7).box).toEqual({ kind: "separator", id: "md:70", height: 1 });
    expect(at(8)).toEqual({ box: { kind: "block", id: "md:80", height: 300 }, top: 450, bottom: 750, exact: true });
    measure.dispose();
  });
});

describe("le righe", () => {
  it("raggruppa i rettangoli per riga e taglia a metà fra una riga e l'altra", () => {
    const measure = new PrintMeasure(mount());
    // Il paragrafo: tagli a 20 e 40 (fra 168 e 172, fra 188 e 192).
    expect(measure.measure(2, "righe").box).toEqual({ kind: "paragraph", id: "md:10", lines: [20, 20, 20] });
    // La voce con l'immagine: una riga sola, alta quanto la voce.
    expect(measure.measure(4, "righe").box).toEqual({ kind: "paragraph", id: "md:40", lines: [30] });
    // Il codice: il bottone «Copia» non è una riga; il riquadro sta nella
    // prima e nell'ultima.
    const code = measure.measure(5, "righe").box;
    expect(code).toEqual({ kind: "code", id: "md:50", lines: [28, 18, 28] });
    // La tabella: l'intestazione e la cima di ogni riga.
    expect(measure.measure(6, "righe")).toMatchObject({ box: { kind: "table", header: 30, rows: [30, 30] }, exact: true });
    measure.dispose();
  });

  it("un esponente o una formula in linea stanno sulla riga che toccano", () => {
    expect(lineRows([
      { top: 100, bottom: 116 },
      { top: 96, bottom: 106 },
      { top: 120, bottom: 136 },
      { top: 118, bottom: 142 },
    ])).toEqual([{ top: 96, bottom: 116 }, { top: 118, bottom: 142 }]);
  });

  it("le fasce coprono il blocco: la prima comincia col blocco, l'ultima finisce con lui", () => {
    const bands = bandsOf([{ top: 105, bottom: 121 }, { top: 125, bottom: 141 }], 100, 50);
    expect(bands).toEqual([23, 27]);
    expect(bands.reduce((a, b) => a + b)).toBe(50);
    expect(bandsOf([], 100, 40)).toEqual([40]);
  });
});
