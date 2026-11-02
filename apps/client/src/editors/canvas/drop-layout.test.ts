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
    expect(bornSize("sheet")).toEqual({ width: 480, height: 304 });
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

  it("aggancia a 8 px e non scende sotto la misura minima", () => {
    const odd = bornSize("image", { width: 1000, height: 333 });
    expect(odd).toEqual({ width: 480, height: 160 });
    expect(bornSize("image", { width: 10_000, height: 10 })).toEqual({
      width: 480,
      height: DROP_MIN_SIZE,
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
    expect(bornSize("pdf", { width: 595, height: 842 })).toEqual({
      width: 360,
      height: 512,
    });
    expect(bornSize("pdf", { width: 842, height: 595 })).toEqual({
      width: 360,
      height: 256,
    });
  });

  it("ignora la misura del contenuto per le altre specie", () => {
    expect(bornSize("note", { width: 4000, height: 1000 })).toEqual({
      width: 320,
      height: 240,
    });
    expect(bornSize("sheet", { width: 10, height: 10 })).toEqual({
      width: 480,
      height: 304,
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

  it("aggancia il punto e le misure a 8 px", () => {
    const { cards } = dropLayout(
      [item("a.md", 321, 243), item("b.md", 100, 100)],
      { x: 13, y: 21 },
    );
    expect(cards[0]).toEqual({
      path: "a.md",
      x: 16,
      y: 24,
      width: 320,
      height: 240,
    });
    for (const card of cards) {
      for (const value of [card.x, card.y, card.width, card.height])
        expect(Math.abs(value % DROP_SNAP)).toBe(0);
    }
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
      { path: "b.xlsx", x: 480 + DROP_GAP, y: 0, width: 480, height: 304 },
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
