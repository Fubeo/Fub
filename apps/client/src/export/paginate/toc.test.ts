// Il frontespizio, l'indice in due passate e i numeri delle pagine (T73).

import { describe, expect, it } from "vitest";
import type { Page, Placement } from "./model";
import {
  frontMatter,
  headingsOf,
  PENDING,
  roman,
  sectionHeadings,
  sectionsByPage,
  sheetsOf,
  splitToc,
  tocHeadings,
  type FrontSettings,
  type TocEntry,
  type TocHeading,
} from "./toc";

const BASE: FrontSettings = { cover: false, toc: true, roman: false, firstWithoutHeader: false, depth: 2 };

function heading(box: number, level: number, text: string, id = `md:${box}`): TocHeading {
  return { box, id, level, text, number: "" };
}

/// Ogni voce alta 20, il titolo «Indice» 40, la pagina 100: tre voci sulla
/// prima pagina, cinque sulle altre.
const measure = (entries: readonly TocEntry[]) => ({ page: 100, heading: 40, rows: entries.map(() => 20) });

describe("i numeri romani", () => {
  it("vanno da i a mmmcmxcix, e fuori restano cifre", () => {
    expect([1, 2, 3, 4, 5, 9, 14, 40, 90, 400, 1994].map(roman)).toEqual(["i", "ii", "iii", "iv", "v", "ix", "xiv", "xl", "xc", "cd", "mcmxciv"]);
    expect(roman(0)).toBe("0");
    expect(roman(4000)).toBe("4000");
  });
});

describe("i fogli e i loro numeri", () => {
  it("senza frontespizio né indice le pagine della nota contano da 1", () => {
    const sheets = sheetsOf({ ...BASE, toc: false }, 0, 3);
    expect(sheets.map((s) => [s.kind, s.number, s.total, s.header])).toEqual([
      ["pagina", "1", "3", true],
      ["pagina", "2", "3", true],
      ["pagina", "3", "3", true],
    ]);
  });

  it("con i numeri arabi il frontespizio non si conta e l'indice è la pagina 1", () => {
    const sheets = sheetsOf({ ...BASE, cover: true }, 2, 3);
    expect(sheets.map((s) => [s.kind, s.number, s.total, s.header, s.footer])).toEqual([
      ["frontespizio", "", "", false, false],
      ["indice", "1", "5", true, true],
      ["indice", "2", "5", true, true],
      ["pagina", "3", "5", true, true],
      ["pagina", "4", "5", true, true],
      ["pagina", "5", "5", true, true],
    ]);
  });

  it("con i numeri romani frontespizio e indice contano i, ii…, la nota riparte da 1", () => {
    const sheets = sheetsOf({ ...BASE, cover: true, roman: true }, 2, 2);
    expect(sheets.map((s) => [s.kind, s.number, s.total])).toEqual([
      ["frontespizio", "i", "iii"],
      ["indice", "ii", "iii"],
      ["indice", "iii", "iii"],
      ["pagina", "1", "2"],
      ["pagina", "2", "2"],
    ]);
  });

  it("la prima pagina senza testata è la prima dopo il frontespizio, e il piè resta", () => {
    const sheets = sheetsOf({ ...BASE, cover: true, firstWithoutHeader: true }, 1, 2);
    expect(sheets.map((s) => [s.kind, s.header, s.footer])).toEqual([
      ["frontespizio", false, false],
      ["indice", false, true],
      ["pagina", true, true],
      ["pagina", true, true],
    ]);
  });

  it("finché le pagine non sono contate il totale è «…»", () => {
    const sheets = sheetsOf(BASE, 1, 2, false);
    expect(sheets.map((s) => s.total)).toEqual([PENDING, PENDING, PENDING]);
  });
});

describe("le voci dell'indice", () => {
  const all = [heading(0, 1, "Nome della nota", "titolo"), heading(1, 2, "Premessa"), heading(3, 3, "Il luogo"), heading(5, 2, "   "), heading(6, 4, "Dettaglio"), heading(8, 1, "Allegati")];

  it("arrivano ai Titoli 2, o anche ai 3; senza il nome della nota né i titoli vuoti", () => {
    expect(tocHeadings(all, 2).map((h) => h.text)).toEqual(["Premessa", "Allegati"]);
    expect(tocHeadings(all, 3).map((h) => h.text)).toEqual(["Premessa", "Il luogo", "Allegati"]);
  });

  it("dalle scatole impaginate, col testo e il numero della resa", () => {
    const boxes = [
      { kind: "heading", id: "titolo", level: 1, height: 40 },
      { kind: "paragraph", id: "md:10", lines: [20] },
      { kind: "heading", id: "md:20", level: 2, height: 30 },
    ] as const;
    const read = (box: number) => ({ text: box === 2 ? "  Il  luogo\n" : "Nome", number: box === 2 ? "1" : "" });
    expect(headingsOf(boxes, read)).toEqual([
      { box: 0, id: "titolo", level: 1, text: "Nome", number: "" },
      { box: 2, id: "md:20", level: 2, text: "Il luogo", number: "1" },
    ]);
  });
});

describe("l'indice più lungo di una pagina", () => {
  it("va a capo fra le voci; il titolo sta solo sulla prima", () => {
    expect(splitToc({ page: 100, heading: 40, rows: Array(12).fill(20) })).toEqual([3, 5, 4]);
  });

  it("una voce più alta della pagina sta da sola", () => {
    expect(splitToc({ page: 100, heading: 40, rows: [20, 150, 20] })).toEqual([1, 1, 1]);
  });

  it("senza voci non ha pagine", () => {
    expect(splitToc({ page: 100, heading: 40, rows: [] })).toEqual([]);
  });
});

describe("l'indice in due passate", () => {
  // Dieci titoli, uno per pagina della nota: l'indice prende due pagine
  // (tre voci, poi sette che stanno in cinque e due).
  const headings = Array.from({ length: 10 }, (_, i) => heading(i * 2, 2, `Capitolo ${i + 1}`));
  const firstPage = Array.from({ length: 20 }, (_, box) => Math.floor(box / 2));

  it("la seconda passata numera le pagine dopo quelle dell'indice", () => {
    const front = frontMatter({ settings: BASE, headings, flowPages: 10, final: true, firstPage, measure });
    expect(front.toc.map((page) => page.length)).toEqual([3, 5, 2]);
    expect(front.front).toBe(3);
    // Tre pagine d'indice: il primo capitolo è a pagina 4.
    expect(front.toc.flat().map((entry) => entry.page)).toEqual(["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]);
    expect(front.sheets[front.sheets.length - 1]).toMatchObject({ kind: "pagina", number: "13", total: "13" });
  });

  it("col frontespizio e i numeri romani la nota riparte da 1", () => {
    const front = frontMatter({ settings: { ...BASE, cover: true, roman: true }, headings, flowPages: 10, final: true, firstPage, measure });
    expect(front.front).toBe(4);
    expect(front.toc.flat().map((entry) => entry.page)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(front.sheets.slice(0, 4).map((sheet) => sheet.number)).toEqual(["i", "ii", "iii", "iv"]);
  });

  it("se i numeri veri allungano l'indice, si rifà finché non resta fermo", () => {
    // Una voce che porta un numero da 10 in su va a capo: alta il doppio. La
    // prima passata (indice di due pagine) dà numeri da 10: l'indice ne
    // prende quattro, e la terza passata lo conferma.
    const wide = (entries: readonly TocEntry[]) => ({ page: 100, heading: 40, rows: entries.map((e) => (Number(e.page) >= 10 ? 40 : 20)) });
    const passes: string[][] = [];
    const front = frontMatter({
      settings: BASE,
      headings: headings.slice(0, 6),
      flowPages: 20,
      final: true,
      firstPage: firstPage.map((page) => page + 7),
      measure: (entries) => {
        passes.push(entries.map((e) => e.page));
        return wide(entries);
      },
    });
    expect(passes.length).toBe(3);
    const tocPages = front.toc.length;
    expect(tocPages).toBe(4);
    expect(front.toc.flat().map((entry) => entry.page)).toEqual(headings.slice(0, 6).map((_, i) => String(tocPages + 8 + i)));
    expect(splitToc(wide(front.toc.flat())).length).toBe(tocPages);
  });

  it("finché l'impaginatore non ha finito, l'indice aspetta i suoi numeri", () => {
    const front = frontMatter({ settings: BASE, headings, flowPages: 10, final: false, firstPage: null, measure });
    expect(front.toc.flat().every((entry) => entry.page === PENDING)).toBe(true);
    expect(front.sheets[0].total).toBe(PENDING);
  });

  it("una nota senza titoli non ha indice", () => {
    const front = frontMatter({ settings: { ...BASE, cover: true }, headings: [heading(0, 1, "Nome", "titolo")], flowPages: 2, final: true, firstPage: [0, 0], measure });
    expect(front.toc).toEqual([]);
    expect(front.sheets.map((sheet) => sheet.kind)).toEqual(["frontespizio", "pagina", "pagina"]);
    expect(front.sheets.map((sheet) => sheet.number)).toEqual(["", "1", "2"]);
  });

  it("con l'indice spento non si misura niente", () => {
    let measured = 0;
    const front = frontMatter({ settings: { ...BASE, toc: false }, headings, flowPages: 10, final: true, firstPage, measure: (entries) => (measured++, measure(entries)) });
    expect(measured).toBe(0);
    expect(front.front).toBe(0);
  });
});

describe("la sezione corrente", () => {
  const at = (box: number, extra: Partial<Placement> = {}): Placement => ({ box, id: `b${box}`, part: "corpo", from: 0, to: 10, column: 0, y: 0, scale: 1, continued: false, continues: false, ...extra });
  const page = (...placements: Placement[]): Page => ({ placements, notes: [] });

  it("è l'ultimo titolo cominciato prima; quello della pagina se la apre", () => {
    const sections = new Map([[1, "Premessa"], [4, "Il luogo"], [7, "Allegati"]]);
    const pages = [
      page(at(0), at(1), at(2)),
      page(at(2, { continued: true }), at(3), at(4)),
      page(at(5)),
      page(at(7), at(8)),
    ];
    expect(sectionsByPage(pages, sections)).toEqual(["Premessa", "Premessa", "Il luogo", "Allegati"]);
  });

  it("prima del primo titolo è vuota, e un titolo vuoto non apre una sezione", () => {
    const sections = sectionHeadings([heading(0, 1, "Nome", "titolo"), heading(2, 2, "  "), heading(4, 3, "Sotto"), heading(5, 2, "Fine")]);
    expect([...sections.entries()]).toEqual([[5, "Fine"]]);
    expect(sectionsByPage([page(at(0), at(2)), page(at(4), at(5))], sections)).toEqual(["", "Fine"]);
  });
});
