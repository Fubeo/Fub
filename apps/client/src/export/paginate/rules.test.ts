// Le regole dell'impaginazione (E28), una per una, sul corpus di note misurate
// a mano (`corpus.ts`): senza DOM. Ogni prova mette il blocco in fondo a una
// pagina con un paragrafo di riempimento di righe da 22 px, così si sa quanto
// spazio resta; i conti sono nei commenti.

import { describe, expect, it } from "vitest";
import { A4_BODY, CODE_LINE, GAP, LINE, MM, ROW, TABLE_HEADER, callout, code, figure, formula, h1, h2, h3, manualBreak, para, report, table } from "./corpus";
import { boxHeight, type Box, type FlowBox, type PageFrame, type Pagination, type Placement } from "./model";
import { MIN_LINES, notePlacement, paginate, rulesOf } from "./rules";

/// Un A4 coi margini «Normali»: una colonna, note nel margine (22 mm).
const A4: PageFrame = { height: A4_BODY, columns: 1, noteMargin: 22 * MM };

/// Il riempimento: `lines` righe in cima alla pagina, che finiscono a
/// `lines × 22` px.
const fill = (lines: number) => para(lines);

/// Le fasce di una scatola, nell'ordine, con la loro pagina.
function bands(result: Pagination, box: Box): (Placement & { page: number })[] {
  return result.pages.flatMap((p, page) => p.placements.filter((x) => x.id === box.id && x.part !== "nota").map((x) => ({ ...x, page })));
}

function body(result: Pagination, box: Box) {
  return bands(result, box).filter((x) => x.part === "corpo");
}

/// Le garanzie che valgono per ogni impaginazione: ogni scatola intera una
/// volta sola, fasce contigue, niente fuori dalla pagina, niente sovrapposto,
/// nessuna pagina vuota se non per una nota vuota.
function invariants(boxes: readonly Box[], frame: PageFrame, result: Pagination): void {
  expect(result.pages.length).toBeGreaterThan(0);
  boxes.forEach((box) => {
    if (box.kind === "break") return;
    const parts = body(result, box);
    expect(parts.length, box.id).toBeGreaterThan(0);
    expect(parts[0].from).toBe(0);
    expect(parts[parts.length - 1].to).toBeCloseTo(boxHeight(box), 6);
    for (let k = 1; k < parts.length; k++) {
      expect(parts[k].from, box.id).toBeCloseTo(parts[k - 1].to, 6);
      // Una scatola va sempre avanti, di colonna in colonna.
      expect(parts[k].page * frame.columns + parts[k].column).toBeGreaterThan(parts[k - 1].page * frame.columns + parts[k - 1].column);
    }
  });
  result.pages.forEach((page, n) => {
    if (boxes.length > 0) expect(page.placements.length + page.notes.length, `pagina ${n}`).toBeGreaterThan(0);
    for (let column = 0; column < frame.columns; column++) {
      const here = page.placements.filter((p) => p.column === column).sort((a, b) => a.y - b.y);
      let bottom = 0;
      for (const p of here) {
        expect(p.y, `${p.id} a pagina ${n}`).toBeGreaterThanOrEqual(bottom - 0.5);
        bottom = p.y + (p.to - p.from) * p.scale;
        expect(bottom, `${p.id} a pagina ${n}`).toBeLessThanOrEqual(frame.height + 0.5);
      }
    }
    let noteBottom = 0;
    for (const note of page.notes) {
      expect(note.y).toBeGreaterThanOrEqual(noteBottom - 0.5);
      noteBottom = note.y + 1;
    }
  });
}

function run(boxes: Box[], frame: PageFrame = A4): Pagination {
  const result = paginate(boxes, frame);
  invariants(boxes, frame, result);
  return result;
}

describe("un titolo non resta solo in fondo", () => {
  it("va nella pagina dopo con l'inizio del paragrafo che lo segue", () => {
    // 38 righe finiscono a 836; il titolo andrebbe da 858 a 883,8, ma con le
    // due righe minime del paragrafo (9,7 + 44) si arriva a 937,5.
    const heading = h2();
    const next = para(5);
    const result = run([fill(38), heading, next]);
    expect(body(result, heading)).toEqual([expect.objectContaining({ page: 1, y: 0 })]);
    expect(body(result, next)[0]).toMatchObject({ page: 1, y: 25.8 + GAP });
  });

  it("resta se con lui stanno almeno due righe del seguito", () => {
    // 37 righe: il titolo fino a 861,8 e due righe fino a 915,5.
    const heading = h2();
    const next = para(5);
    const result = run([fill(37), heading, next]);
    expect(body(result, heading)[0].page).toBe(0);
    expect(body(result, next).map((p) => [p.page, p.to - p.from])).toEqual([[0, 2 * LINE], [1, 3 * LINE]]);
  });

  it("porta con sé una fila di titoli", () => {
    // 37 righe: titolo 2, titolo 3 e due righe non stanno (955,5).
    const second = h2();
    const third = h3();
    const result = run([fill(37), second, third, para(4)]);
    expect(body(result, second)[0]).toMatchObject({ page: 1, y: 0 });
    expect(body(result, third)[0]).toMatchObject({ page: 1, y: 25.8 + 18 });
  });

  it("aspetta un blocco che non si spezza, intero", () => {
    // 30 righe (660): titolo fino a 707,8, la figura (374,9) no.
    const heading = h2();
    const picture = figure();
    const result = run([fill(30), heading, picture]);
    expect(body(result, heading)[0].page).toBe(1);
    expect(body(result, picture)[0]).toMatchObject({ page: 1, scale: 1 });
  });

  it("una pagina di un titolo solo: prima di un'interruzione, o in fondo alla nota", () => {
    const alone = h1();
    const result = run([alone, manualBreak(), para(3)]);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].placements.map((p) => p.id)).toEqual([alone.id]);
    const last = h2();
    const end = run([fill(41), last]);
    expect(body(end, last)[0]).toMatchObject({ page: 1, y: 0 });
  });
});

describe("niente vedove e orfane", () => {
  it("un paragrafo che lascerebbe una riga sola in fondo va intero nella pagina dopo", () => {
    // 41 righe (902): il paragrafo comincia a 911,7, c'è posto per una riga.
    const p = para(6);
    const result = run([fill(41), p]);
    expect(body(result, p)).toEqual([expect.objectContaining({ page: 1, y: 0, from: 0, to: 6 * LINE })]);
  });

  it("non lascia una riga sola in cima alla pagina dopo", () => {
    // 38 righe (836): da 845,7 stanno 4 righe di 5, ma l'ultima resterebbe
    // sola: 3 qui e 2 di là.
    const p = para(5);
    const result = run([fill(38), p]);
    expect(body(result, p).map((x) => [x.page, x.from, x.to])).toEqual([[0, 0, 3 * LINE], [1, 3 * LINE, 5 * LINE]]);
  });

  it("un paragrafo di due righe a fine pagina non si spezza", () => {
    const p = para(2);
    const result = run([fill(41), p]);
    expect(body(result, p)).toEqual([expect.objectContaining({ page: 1, from: 0, to: 2 * LINE })]);
  });

  it("un paragrafo più lungo di una pagina tiene due righe a ogni taglio", () => {
    const p = para(90);
    const result = run([fill(41), p]);
    for (const part of body(result, p)) expect(part.to - part.from).toBeGreaterThanOrEqual(MIN_LINES * LINE - 0.01);
  });
});

describe("ciò che non si spezza", () => {
  it.each([
    ["una tabella corta", () => table(6), 34],
    ["una figura", () => figure(), 30],
    ["una formula", () => formula(), 41],
    ["un riquadro", () => callout(), 39],
  ])("%s va intera nella pagina dopo", (_name, make, lines) => {
    const block = make();
    const result = run([fill(lines), block]);
    expect(body(result, block)).toEqual([expect.objectContaining({ page: 1, y: 0, from: 0, to: boxHeight(block as FlowBox), scale: 1 })]);
  });

  it("una tabella corta è al più di sei righe, e sta in una pagina", () => {
    expect(rulesOf(table(6), A4_BODY).splits).toBe(false);
    expect(rulesOf(table(7), A4_BODY).splits).toBe(true);
    expect(rulesOf(table(3, 400), A4_BODY).splits).toBe(true);
  });
});

describe("una tabella lunga continua con l'intestazione", () => {
  it("si spezza fra due righe e ripete l'intestazione", () => {
    // 30 righe (660): da 669,7, dopo l'intestazione, stanno 8 righe da 29.
    const t = table(24);
    const result = run([fill(30), t]);
    const parts = bands(result, t);
    expect(parts.map((p) => [p.page, p.part, p.from, p.to, p.y])).toEqual([
      [0, "corpo", 0, TABLE_HEADER + 8 * ROW, 660 + GAP],
      [1, "intestazione", 0, TABLE_HEADER, 0],
      [1, "corpo", TABLE_HEADER + 8 * ROW, TABLE_HEADER + 24 * ROW, TABLE_HEADER],
    ]);
    expect(parts[0]).toMatchObject({ continued: false, continues: true });
    expect(parts[2]).toMatchObject({ continued: true, continues: false });
  });

  it("non lascia una riga sola nella pagina dopo", () => {
    // Stanno 8 righe di 9: ne vanno 7 e 2.
    const t = table(9);
    const result = run([fill(30), t]);
    const rows = body(result, t).map((p) => Math.round((p.to - p.from - (p.from === 0 ? TABLE_HEADER : 0)) / ROW));
    expect(rows).toEqual([7, 2]);
  });

  it("una tabella di una riga più alta della pagina si rimpicciolisce, con l'intestazione", () => {
    const t = table(1, 1200);
    const result = run([fill(10), t], { ...A4, fitLabel: 14 });
    const [only] = body(result, t);
    expect(only).toMatchObject({ page: 1, y: 0, from: 0, to: TABLE_HEADER + 1200 });
    expect(only.scale).toBeCloseTo((A4_BODY - 14) / (TABLE_HEADER + 1200), 6);
  });
});

describe("il codice si spezza fra le righe", () => {
  it("taglia sul bordo di una riga, con due righe da ogni parte", () => {
    // 30 righe (660): da 669,7 stanno la prima riga (28,8) e altre 12.
    const c = code(26);
    const result = run([fill(30), c]);
    const parts = body(result, c);
    expect(parts).toHaveLength(2);
    expect(parts[0].to).toBeCloseTo(28.8 + 12 * CODE_LINE, 6);
    expect(parts[1]).toMatchObject({ page: 1, y: 0, continued: true });
  });
});

describe("ciò che è più alto di una pagina si rimpicciolisce", () => {
  it("in cima alla pagina dopo, lasciando il posto per dirlo", () => {
    const big = figure(1500);
    const result = run([fill(10), big], { ...A4, fitLabel: 14 });
    const [only] = body(result, big);
    expect(only).toMatchObject({ page: 1, y: 0 });
    expect(only.scale).toBeCloseTo((A4_BODY - 14) / 1500, 6);
  });

  it("sotto il titolo che lo introduce", () => {
    const heading = h2();
    const big = figure(1500);
    const result = run([fill(10), heading, big], { ...A4, fitLabel: 14 });
    expect(body(result, heading)[0]).toMatchObject({ page: 1, y: 0 });
    const [only] = body(result, big);
    expect(only).toMatchObject({ page: 1, y: 25.8 + GAP });
    expect(only.scale).toBeCloseTo((A4_BODY - 25.8 - GAP - 14) / 1500, 6);
  });

  it("in cima a una pagina vuota resta lì", () => {
    const big = figure(2000);
    const result = run([big]);
    expect(result.pages).toHaveLength(1);
    expect(body(result, big)[0].scale).toBeCloseTo(A4_BODY / 2000, 6);
  });
});

describe("le interruzioni", () => {
  it("voltano pagina senza mai lasciare pagine bianche", () => {
    const a = para(2);
    const b = para(2);
    const result = run([manualBreak(), a, manualBreak(), manualBreak(), b, manualBreak()]);
    expect(result.pages).toHaveLength(2);
    expect(result.firstPage).toEqual([-1, 0, -1, -1, 1, -1]);
  });
});

describe("due colonne", () => {
  const two: PageFrame = { ...A4, columns: 2, noteMargin: 40 * MM };

  it("si riempie la prima colonna e poi la seconda, con le stesse regole", () => {
    const p = para(50);
    const result = run([p], two);
    expect(body(result, p).map((x) => [x.page, x.column, (x.to - x.from) / LINE])).toEqual([[0, 0, 42], [0, 1, 8]]);
  });

  it("un titolo in fondo alla prima colonna passa alla seconda", () => {
    const heading = h2();
    const result = run([fill(38), heading, para(4)], two);
    expect(body(result, heading)[0]).toMatchObject({ page: 0, column: 1, y: 0 });
  });

  it("un'interruzione volta pagina, non colonna", () => {
    const b = para(2);
    const result = run([para(2), manualBreak(), b], two);
    expect(body(result, b)[0]).toMatchObject({ page: 1, column: 0 });
  });

  it("le note vanno in fondo da sole", () => {
    expect(notePlacement(two)).toBe("fondo");
    const result = run([para(3, [{ id: "n", height: 40 }])], two);
    expect(result.notes).toBe("fondo");
    expect(result.pages[0].notes).toEqual([]);
    expect(result.pages[0].placements.filter((p) => p.part === "nota")).toHaveLength(1);
  });
});

describe("le note al margine", () => {
  it("stanno accanto al loro paragrafo, all'altezza del segno", () => {
    const p = para(4, [{ id: "a", height: 40, at: LINE }]);
    const result = run([fill(10), p]);
    expect(result.notes).toBe("margine");
    expect(result.pages[0].notes).toEqual([{ box: 1, id: "a", y: 10 * LINE + GAP + LINE, scale: 1 }]);
  });

  it("si mettono una sotto l'altra", () => {
    const result = run([para(1, [{ id: "a", height: 50 }]), para(1, [{ id: "b", height: 30 }])], { ...A4, noteGap: 6 });
    expect(result.pages[0].notes.map((n) => [n.id, n.y])).toEqual([["a", 0], ["b", 56]]);
  });

  it("salgono se sforerebbero in fondo, e passano alla pagina dopo se non c'è posto", () => {
    const up = run([fill(40), para(1, [{ id: "su", height: 120 }])]);
    expect(up.pages[0].notes[0].y).toBeCloseTo(A4_BODY - 120, 6);
    const over = run([para(1, [{ id: "alta", height: 850 }]), fill(30), para(1, [{ id: "dopo", height: 100 }])]);
    expect(over.pages).toHaveLength(2);
    expect(over.pages[1]).toEqual({ placements: [], notes: [{ box: 2, id: "dopo", y: 0, scale: 1 }] });
  });

  it("seguono il paragrafo spezzato nella pagina del loro segno", () => {
    // 38 righe (836): 4 righe qui, 2 di là; il segno è sulla sesta.
    const p = para(6, [{ id: "giù", height: 30, at: 5 * LINE }]);
    const result = run([fill(38), p]);
    expect(result.pages[0].notes).toEqual([]);
    expect(result.pages[1].notes).toEqual([{ box: 1, id: "giù", y: LINE, scale: 1 }]);
  });

  it("con il margine stretto vanno in fondo, col titolo che resta con la prima", () => {
    const narrow: PageFrame = { ...A4, noteMargin: 15 * MM, notesHeading: 30, noteGap: 6 };
    expect(notePlacement(narrow)).toBe("fondo");
    const result = run([fill(39), para(1, [{ id: "n", height: 60 }])], narrow);
    // Il titolo starebbe da 889,7 a 919,7, ma senza la nota: va con lei.
    expect(result.pages[1].placements.map((p) => [p.part, p.note ?? "", p.y])).toEqual([["titolo-note", "", 0], ["nota", "n", 36]]);
  });
});

describe("i casi limite", () => {
  it("una nota vuota esce come una pagina bianca", () => {
    const result = run([]);
    expect(result.pages).toEqual([{ placements: [], notes: [] }]);
    expect(result.firstPage).toEqual([]);
  });

  it("una pagina senza altezza è un errore, non un giro senza fine", () => {
    expect(() => paginate([para(1)], { ...A4, height: 0 })).toThrow(RangeError);
  });
});

describe("una nota vera del corpus", () => {
  /// Le regole, controllate su tutta l'impaginazione.
  function rules(boxes: Box[], frame: PageFrame, result: Pagination): void {
    boxes.forEach((box, i) => {
      if (box.kind === "break") return;
      const parts = body(result, box);
      const next = boxes[i + 1];
      // Un titolo comincia nella stessa colonna del blocco dopo.
      if (box.kind === "heading" && next && next.kind !== "break") {
        const first = body(result, next)[0];
        expect([first.page, first.column], box.id).toEqual([parts[0].page, parts[0].column]);
      }
      // Righe sole: mai.
      if ((box.kind === "paragraph" || box.kind === "code") && parts.length > 1) {
        const lines = box.lines;
        for (const part of parts) {
          let count = 0;
          let at = 0;
          for (const h of lines) {
            if (at >= part.from - 0.01 && at + h <= part.to + 0.01) count++;
            at += h;
          }
          expect(count, box.id).toBeGreaterThanOrEqual(MIN_LINES);
        }
      }
      // Ciò che non si spezza ha una fascia sola.
      if (!rulesOf(box, frame.height).splits) expect(parts, box.id).toHaveLength(1);
      // La tabella che continua ripete l'intestazione.
      if (box.kind === "table" && parts.length > 1) {
        expect(bands(result, box).filter((p) => p.part === "intestazione")).toHaveLength(parts.length - 1);
      }
    });
  }

  it("su un A4 con le note nel margine", () => {
    const boxes = report();
    const frame: PageFrame = { ...A4, fitLabel: 14, noteGap: 6 };
    const result = run(boxes, frame);
    rules(boxes, frame, result);
    // Cinque pagine: la figura lascia in fondo alla prima 244 px che non la
    // tengono; la tabella va 9 righe e 15; il codice 8 righe e 18; l'ultimo
    // paragrafo di sei righe non lascia la sua prima riga sola in fondo alla
    // quarta.
    expect(result.firstPage).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4]);
    expect(body(result, boxes[10]).map((p) => p.to - p.from)).toEqual([TABLE_HEADER + 9 * ROW, 15 * ROW]);
    expect(result.pages.flatMap((p) => p.notes.map((n) => n.id))).toEqual(["c1", "c2"]);
  });

  it("su due colonne con le note in fondo", () => {
    const boxes = report();
    const frame: PageFrame = { ...A4, columns: 2, notesHeading: 30, noteGap: 6 };
    const result = run(boxes, frame);
    rules(boxes, frame, result);
    const tail = result.pages[result.pages.length - 1].placements.slice(-3).map((p) => p.part);
    expect(tail).toEqual(["titolo-note", "nota", "nota"]);
  });

  it("le stesse scatole danno le stesse pagine", () => {
    const boxes = report();
    expect(paginate(boxes, A4)).toEqual(paginate(boxes, A4));
  });
});
