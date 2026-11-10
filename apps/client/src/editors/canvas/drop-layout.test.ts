import { describe, expect, it } from "vitest";
import type { CardKind } from "./cards";
import { CANVAS_MIN_SIZE, CANVAS_SNAP } from "./engine";
import {
  DROP_GAP,
  DROP_GROUP_THRESHOLD,
  DROP_MIN_SIZE,
  DROP_SNAP,
  bornSize,
  dropLayout,
  markdownTable,
  spreadLayout,
  type DropCard,
  type DropItem,
} from "./drop-layout";

function item(
  path: string,
  width = 320,
  height = 160,
  kind: CardKind = "file",
): DropItem {
  return { path, kind, size: { width, height } };
}

function files(count: number): DropItem[] {
  return Array.from({ length: count }, (_, index) =>
    item(`cartella/f${index + 1}.bin`),
  );
}

/// Elementi di misure diverse, a turno: nota, foglio, immagine 16:9 (480×270)
/// e PDF di A4 (360×509), con le misure di nascita vere.
function mixedItems(count: number): DropItem[] {
  const kinds: readonly CardKind[] = ["note", "sheet", "image", "pdf"];
  return Array.from({ length: count }, (_, index) => {
    const kind = kinds[index % kinds.length]!;
    const content =
      kind === "image"
        ? { width: 1920, height: 1080 }
        : kind === "pdf"
          ? { width: 595, height: 842 }
          : undefined;
    return { path: `m${index}.bin`, kind, size: bornSize(kind, content) };
  });
}

/// Ogni colonna (asse `x`) o riga (asse `y`) parte al primo multiplo di 8 che
/// lascia almeno `DROP_GAP` dopo il bordo più lontano della precedente.
function expectFirstFit(cards: readonly DropCard[], axis: "x" | "y"): void {
  const size = axis === "x" ? "width" : "height";
  const starts = [...new Set(cards.map((card) => card[axis]))].sort(
    (a, b) => a - b,
  );
  for (let index = 1; index < starts.length; index++) {
    const previousEnd = Math.max(
      ...cards
        .filter((card) => card[axis] === starts[index - 1])
        .map((card) => card[axis] + card[size]),
    );
    expect(starts[index]! - previousEnd).toBeGreaterThanOrEqual(DROP_GAP);
    expect(starts[index]! - DROP_SNAP - previousEnd).toBeLessThan(DROP_GAP);
  }
}

describe("le costanti della tela", () => {
  it("sono le stesse di engine.ts", () => {
    expect(DROP_SNAP).toBe(CANVAS_SNAP);
    expect(DROP_MIN_SIZE).toBe(CANVAS_MIN_SIZE);
  });
});

describe("bornSize", () => {
  it("dà le misure di nascita di ogni specie", () => {
    expect(bornSize("note")).toEqual({ width: 320, height: 240 });
    expect(bornSize("document")).toEqual({ width: 320, height: 240 });
    expect(bornSize("sheet")).toEqual({ width: 480, height: 300 });
    expect(bornSize("pdf")).toEqual({ width: 360, height: 480 });
    expect(bornSize("web")).toEqual({ width: 320, height: 120 });
    expect(bornSize("file")).toEqual({ width: 320, height: 160 });
    expect(bornSize("craft")).toEqual({ width: 320, height: 160 });
  });

  it("porta il lato lungo di un'immagine a 480, con le sue proporzioni", () => {
    expect(bornSize("image", { width: 4000, height: 1000 })).toEqual({
      width: 480,
      height: 120,
    });
    expect(bornSize("image", { width: 1000, height: 4000 })).toEqual({
      width: 120,
      height: 480,
    });
    expect(bornSize("image", { width: 200, height: 200 })).toEqual({
      width: 480,
      height: 480,
    });
  });

  it("arrotonda a interi e non scende sotto la misura minima", () => {
    // 333 × 0,48 fa 159,84: l'intero più vicino è 160.
    const odd = bornSize("image", { width: 1000, height: 333 });
    expect(odd).toEqual({ width: 480, height: 160 });
    expect(bornSize("image", { width: 10_000, height: 10 })).toEqual({
      width: 480,
      height: DROP_MIN_SIZE,
    });
  });

  it("un'immagine 16:9 nasce 480×270, esatta", () => {
    expect(bornSize("image", { width: 1920, height: 1080 })).toEqual({
      width: 480,
      height: 270,
    });
  });

  it("un'immagine 1×4000 ha il lato corto a 40 px: lì la proporzione non si tiene", () => {
    expect(bornSize("image", { width: 1, height: 4000 })).toEqual({
      width: 40,
      height: 480,
    });
  });

  it("senza la misura del contenuto un PDF nasce 360×480", () => {
    expect(bornSize("pdf")).toEqual({ width: 360, height: 480 });
    expect(bornSize("pdf", { width: 0, height: 0 })).toEqual({
      width: 360,
      height: 480,
    });
  });

  it("dà a un'immagine senza misura la misura di serie", () => {
    expect(bornSize("image")).toEqual({ width: 480, height: 360 });
    expect(bornSize("image", { width: 0, height: 0 })).toEqual({
      width: 480,
      height: 360,
    });
    expect(bornSize("image", { width: Number.NaN, height: 100 })).toEqual({
      width: 480,
      height: 360,
    });
    expect(bornSize("image", { width: 100, height: -5 })).toEqual({
      width: 480,
      height: 360,
    });
  });

  it("dà al PDF 360 di larghezza con le proporzioni della prima pagina", () => {
    // 360 × 842 / 595 è 509,4: l'intero più vicino è 509, senza aggancio.
    expect(bornSize("pdf", { width: 595, height: 842 })).toEqual({
      width: 360,
      height: 509,
    });
    // 360 × 595 / 842 è 254,4.
    expect(bornSize("pdf", { width: 842, height: 595 })).toEqual({
      width: 360,
      height: 254,
    });
  });

  it("ignora la misura del contenuto per le altre specie", () => {
    expect(bornSize("note", { width: 4000, height: 1000 })).toEqual({
      width: 320,
      height: 240,
    });
    expect(bornSize("sheet", { width: 10, height: 10 })).toEqual({
      width: 480,
      height: 300,
    });
  });
});

describe("dropLayout", () => {
  it("con zero elementi non dispone niente", () => {
    expect(dropLayout([], { x: 100, y: 100 })).toEqual({
      cards: [],
      group: null,
    });
  });

  it("mette un elemento con l'angolo in alto a sinistra sul punto", () => {
    expect(dropLayout([item("a.md", 320, 240)], { x: 96, y: 200 })).toEqual({
      cards: [{ path: "a.md", x: 96, y: 200, width: 320, height: 240 }],
      group: null,
    });
  });

  it("aggancia un punto negativo senza zeri negativi", () => {
    expect(dropLayout([item("a.md")], { x: -3, y: -101 }).cards[0]).toEqual({
      path: "a.md",
      x: 0,
      y: -104,
      width: 320,
      height: 160,
    });
    expect(
      Object.is(dropLayout([item("a.md")], { x: -3, y: 0 }).cards[0]!.x, 0),
    ).toBe(true);
  });

  it("aggancia il punto a 8 px e lascia le misure intere", () => {
    const { cards } = dropLayout(
      [item("a.md", 321, 243), item("b.md", 100, 100)],
      { x: 13, y: 21 },
    );
    // Il punto 13, 21 va a 16, 24. La colonna dopo parte dove finisce la
    // prima più 24, cioè 361, e il primo multiplo di 8 da lì è 368.
    expect(cards).toEqual([
      { path: "a.md", x: 16, y: 24, width: 321, height: 243 },
      { path: "b.md", x: 368, y: 24, width: 100, height: 100 },
    ]);
    for (const card of cards) {
      for (const value of [card.x, card.y])
        expect(Math.abs(value % DROP_SNAP)).toBe(0);
    }
  });

  it("un rilascio a una posizione con decimali si aggancia, e le misure si arrotondano", () => {
    const { cards } = dropLayout([item("a.md", 320.4, 239.6)], {
      x: 13.5,
      y: 20.7,
    });
    expect(cards).toEqual([
      { path: "a.md", x: 16, y: 24, width: 320, height: 240 },
    ]);
  });

  it("la colonna dopo un punto negativo parte a 0, non a zero negativo", () => {
    // Da -72 con 42 di larghezza si arriva a -30; più 24 fa -6, e il primo
    // multiplo di 8 da lì è 0 (con `Math.ceil` verrebbe -0).
    const { cards } = dropLayout(
      [item("a.md", 42, 100), item("b.md", 100, 100)],
      { x: -72, y: 0 },
    );
    expect(cards[1]!.x).toBe(0);
  });

  it("un foglio alto 300 mette la riga sotto 328 px più in basso, con 28 px di spazio", () => {
    const sheets = ["a", "b", "c"].map((name): DropItem => ({
      path: `${name}.xlsx`,
      kind: "sheet",
      size: bornSize("sheet"),
    }));
    const { cards } = dropLayout(sheets, { x: 0, y: 0 });
    // 3 elementi: 2 colonne, 2 righe. 300 più 24 fa 324, che non è multiplo
    // di 8: la riga parte a 328.
    expect(
      cards.map((card) => [card.path, card.x, card.y, card.height]),
    ).toEqual([
      ["a.xlsx", 0, 0, 300],
      ["b.xlsx", 480 + DROP_GAP, 0, 300],
      ["c.xlsx", 0, 328, 300],
    ]);
  });

  it("con 47 elementi di misure diverse le posizioni sono multipli di 8, e ogni spazio è il primo che lascia 24 px", () => {
    const { cards, group } = dropLayout(mixedItems(47), { x: 13.5, y: 20.7 });
    expect(cards).toHaveLength(47);
    expect(group).not.toBeNull();
    // Il punto 13,5 e 20,7 si aggancia a 16 e 24.
    expect(cards[0]).toMatchObject({ x: 16, y: 24 });
    for (const card of cards) {
      for (const value of [card.x, card.y])
        expect(Math.abs(value % DROP_SNAP)).toBe(0);
    }
    expectFirstFit(cards, "x");
    expectFirstFit(cards, "y");
  });

  it("ordina per nome, con i numeri in ordine di valore", () => {
    const { cards } = dropLayout(
      [
        item("foto 10.png"),
        item("foto 2.png"),
        item("Foto 1.png"),
        item("archivio.zip"),
      ],
      { x: 0, y: 0 },
    );
    expect(cards.map((card) => card.path)).toEqual([
      "archivio.zip",
      "Foto 1.png",
      "foto 2.png",
      "foto 10.png",
    ]);
  });

  it("ordina per nome del file, non per cartella, e a parità di nome per percorso", () => {
    const { cards } = dropLayout(
      [
        item("z/b.md"),
        item("y/voti.xlsx"),
        item("a/voti.xlsx"),
        item("m/a.md"),
      ],
      { x: 0, y: 0 },
    );
    expect(cards.map((card) => card.path)).toEqual([
      "m/a.md",
      "z/b.md",
      "a/voti.xlsx",
      "y/voti.xlsx",
    ]);
  });

  it("non dipende dall'ordine di arrivo", () => {
    const items = [item("c.md"), item("a.md"), item("b.md"), item("a/a.md")];
    const once = dropLayout(items, { x: 0, y: 0 });
    const reversed = dropLayout([...items].reverse(), { x: 0, y: 0 });
    expect(reversed).toEqual(once);
  });

  it("dispone in ceil(sqrt(n)) colonne, per righe, con 24 px fra le schede", () => {
    const { cards } = dropLayout(files(5), { x: 0, y: 0 });
    // 5 elementi: 3 colonne, 2 righe.
    expect(cards.map((card) => [card.x, card.y])).toEqual([
      [0, 0],
      [320 + DROP_GAP, 0],
      [2 * (320 + DROP_GAP), 0],
      [0, 160 + DROP_GAP],
      [320 + DROP_GAP, 160 + DROP_GAP],
    ]);
  });

  it("fa ogni colonna larga quanto la sua scheda più larga e ogni riga alta quanto la più alta", () => {
    const { cards } = dropLayout(
      [
        item("1", 480, 304),
        item("2", 320, 120),
        item("3", 320, 240),
        item("4", 360, 480),
      ],
      { x: 0, y: 0 },
    );
    // 2 colonne: larghe 480 e 360; 2 righe: alte 304 e 480.
    expect(cards.map((card) => [card.path, card.x, card.y])).toEqual([
      ["1", 0, 0],
      ["2", 480 + DROP_GAP, 0],
      ["3", 0, 304 + DROP_GAP],
      ["4", 480 + DROP_GAP, 304 + DROP_GAP],
    ]);
  });

  it("non sovrappone mai due schede", () => {
    const sizes = [
      [480, 300],
      [320, 120],
      [120, 480],
      [360, 512],
      [320, 160],
      [480, 40],
      [40, 40],
    ];
    const { cards } = dropLayout(
      sizes.map(([width, height], index) => item(`n${index}`, width, height)),
      { x: 8, y: 8 },
    );
    for (const a of cards) {
      for (const b of cards) {
        if (a === b) continue;
        const apart =
          a.x + a.width + DROP_GAP <= b.x ||
          b.x + b.width + DROP_GAP <= a.x ||
          a.y + a.height + DROP_GAP <= b.y ||
          b.y + b.height + DROP_GAP <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("fino a 12 elementi non fa un gruppo", () => {
    expect(
      dropLayout(files(DROP_GROUP_THRESHOLD), { x: 0, y: 0 }).group,
    ).toBeNull();
  });

  it("con 13 elementi li raccoglie in un gruppo con 24 px di margine", () => {
    const { cards, group } = dropLayout(files(13), { x: 400, y: 200 });
    // 13 elementi: 4 colonne, 4 righe (l'ultima con una scheda).
    expect(cards).toHaveLength(13);
    expect(cards[12]).toMatchObject({ x: 400, y: 200 + 3 * (160 + DROP_GAP) });
    expect(group).toEqual({
      x: 400 - DROP_GAP,
      y: 200 - DROP_GAP,
      width: 4 * 320 + 3 * DROP_GAP + 2 * DROP_GAP,
      height: 4 * 160 + 3 * DROP_GAP + 2 * DROP_GAP,
    });
  });

  it("dispone 500 elementi in 23 colonne, dentro il gruppo, agganciati", () => {
    const { cards, group } = dropLayout(files(500), { x: 0, y: 0 });
    expect(cards).toHaveLength(500);
    expect(new Set(cards.map((card) => card.x)).size).toBe(23);
    expect(new Set(cards.map((card) => card.y)).size).toBe(22);
    expect(group).not.toBeNull();
    for (const card of cards) {
      expect(card.x - group!.x).toBeGreaterThanOrEqual(DROP_GAP);
      expect(card.y - group!.y).toBeGreaterThanOrEqual(DROP_GAP);
      expect(
        group!.x + group!.width - (card.x + card.width),
      ).toBeGreaterThanOrEqual(DROP_GAP);
      expect(
        group!.y + group!.height - (card.y + card.height),
      ).toBeGreaterThanOrEqual(DROP_GAP);
      for (const value of [card.x, card.y, card.width, card.height])
        expect(Math.abs(value % DROP_SNAP)).toBe(0);
    }
    for (const value of [group!.x, group!.y, group!.width, group!.height])
      expect(Math.abs(value % DROP_SNAP)).toBe(0);
  });

  it("dispone elementi con le misure di nascita delle loro specie", () => {
    const items: DropItem[] = [
      { path: "b.xlsx", kind: "sheet", size: bornSize("sheet") },
      {
        path: "a.png",
        kind: "image",
        size: bornSize("image", { width: 4000, height: 1000 }),
      },
    ];
    expect(dropLayout(items, { x: 0, y: 0 }).cards).toEqual([
      { path: "a.png", x: 0, y: 0, width: 480, height: 120 },
      { path: "b.xlsx", x: 480 + DROP_GAP, y: 0, width: 480, height: 300 },
    ]);
  });
});

describe("markdownTable", () => {
  it("fa della prima riga l'intestazione", () => {
    expect(
      markdownTable([
        ["Nome", "Voto"],
        ["Anna", "28"],
        ["Bruno", "30"],
      ]),
    ).toBe(
      [
        "| Nome | Voto |",
        "| --- | --- |",
        "| Anna | 28 |",
        "| Bruno | 30 |",
      ].join("\n"),
    );
  });

  it("fa una tabella anche di una cella sola", () => {
    expect(markdownTable([["42"]])).toBe("| 42 |\n| --- |");
  });

  it("allunga le righe corte con celle vuote", () => {
    expect(markdownTable([["a"], ["b", "c", "d"], []])).toBe(
      [
        "| a |  |  |",
        "| --- | --- | --- |",
        "| b | c | d |",
        "|  |  |  |",
      ].join("\n"),
    );
  });

  it("scrive le barre verticali come \\| e gli a capo come spazi", () => {
    expect(
      markdownTable([["a|b"], ["riga uno\nriga due\r\ntre\rquattro"]]),
    ).toBe(
      ["| a\\|b |", "| --- |", "| riga uno riga due tre quattro |"].join("\n"),
    );
  });

  it("senza celle dà la stringa vuota", () => {
    expect(markdownTable([])).toBe("");
    expect(markdownTable([[], []])).toBe("");
  });
});

describe("spreadLayout (T72)", () => {
  /** La scheda PDF di partenza, a sinistra delle pagine. */
  const beside = { x: 0, y: 0, width: 360, height: 480 };
  const page = (width = 360, height = 466) => ({ width, height });

  it("con nessuna pagina non dispone niente", () => {
    expect(spreadLayout([], beside)).toEqual({ rects: [], group: null });
  });

  it("mette la prima pagina accanto alla scheda, al primo multiplo di 8 che lascia 24 px", () => {
    expect(spreadLayout([page()], beside)).toEqual({
      rects: [{ x: 384, y: 0, width: 360, height: 466 }],
      group: null,
    });
  });

  it("va a capo ogni 10 pagine, e ogni riga parte dove parte la prima", () => {
    const { rects } = spreadLayout(Array.from({ length: 24 }, () => page()), beside);
    const rows = [...new Set(rects.map((rect) => rect.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(3);
    expect(rects.filter((rect) => rect.y === rows[0])).toHaveLength(10);
    expect(rects.filter((rect) => rect.y === rows[1])).toHaveLength(10);
    expect(rects.filter((rect) => rect.y === rows[2])).toHaveLength(4);
    for (const row of rows) {
      expect(Math.min(...rects.filter((rect) => rect.y === row).map((rect) => rect.x))).toBe(384);
    }
  });

  it("le posizioni sono multipli di 8, e ogni spazio è il primo che lascia 24 px, in riga e fra le righe", () => {
    const sizes = Array.from({ length: 24 }, (_, index) => page(360 + (index % 3) * 7, 466 - (index % 2) * 33));
    const { rects } = spreadLayout(sizes, beside);
    for (const rect of rects) {
      expect(rect.x % DROP_SNAP).toBe(0);
      expect(rect.y % DROP_SNAP).toBe(0);
    }
    const rows = [...new Set(rects.map((rect) => rect.y))].sort((a, b) => a - b);
    for (const row of rows) {
      const line = rects.filter((rect) => rect.y === row).sort((a, b) => a.x - b.x);
      for (let index = 1; index < line.length; index++) {
        const end = line[index - 1]!.x + line[index - 1]!.width;
        expect(line[index]!.x - end).toBeGreaterThanOrEqual(DROP_GAP);
        expect(line[index]!.x - DROP_SNAP - end).toBeLessThan(DROP_GAP);
      }
    }
    for (let index = 1; index < rows.length; index++) {
      const bottom = Math.max(...rects.filter((rect) => rect.y === rows[index - 1]).map((rect) => rect.y + rect.height));
      expect(rows[index]! - bottom).toBeGreaterThanOrEqual(DROP_GAP);
      expect(rows[index]! - DROP_SNAP - bottom).toBeLessThan(DROP_GAP);
    }
  });

  it("oltre 12 pagine un gruppo le raccoglie con 24 px di margine; fino a 12 no", () => {
    expect(spreadLayout(Array.from({ length: 12 }, () => page()), beside).group).toBeNull();
    const { rects, group } = spreadLayout(Array.from({ length: 13 }, () => page()), beside);
    expect(group).not.toBeNull();
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    // Il gruppo parte a 24 px dalla scheda accanto, e avvolge le pagine con 24 px per lato.
    expect(group).toEqual({ x: 360, y: -24, width: right - 384 + 48, height: bottom + 48 });
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(group!.x + DROP_GAP);
      expect(rect.y).toBeGreaterThanOrEqual(group!.y + DROP_GAP);
    }
  });

  it("arrotonda le misure a interi e non scende sotto la misura minima", () => {
    const { rects } = spreadLayout([{ width: 359.6, height: 10 }], beside);
    expect(rects[0]).toEqual({ x: 384, y: 0, width: 360, height: DROP_MIN_SIZE });
  });
});
