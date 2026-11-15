import { describe, expect, it } from "vitest";
import { CANVAS_MIN_SIZE, CANVAS_SNAP } from "./engine";
import { DROP_MIN_SIZE, DROP_SNAP, markdownTable, sortedDrop } from "./drop-layout";

// Le misure di nascita, la griglia del rilascio e il gruppo sono del nucleo
// (`add_card`, `layout`, `group`): li provano i vettori di `canvas-ops/` e di
// `canvas-layout.json`. Qui resta ciò che la tela fa da sé (T24).

function paths(names: readonly string[]): string[] {
  return sortedDrop(names.map((path) => ({ path }))).map((item) => item.path);
}

describe("le costanti della tela", () => {
  it("sono le stesse di engine.ts", () => {
    expect(DROP_SNAP).toBe(CANVAS_SNAP);
    expect(DROP_MIN_SIZE).toBe(CANVAS_MIN_SIZE);
  });
});

describe("sortedDrop", () => {
  it("ordina per nome, con i numeri in ordine di valore", () => {
    expect(paths(["foto 10.png", "foto 2.png", "Foto 1.png", "archivio.zip"])).toEqual([
      "archivio.zip",
      "Foto 1.png",
      "foto 2.png",
      "foto 10.png",
    ]);
  });

  it("ordina per nome del file, non per cartella, e a parità di nome per percorso", () => {
    expect(paths(["z/b.md", "y/voti.xlsx", "a/voti.xlsx", "m/a.md"])).toEqual([
      "m/a.md",
      "z/b.md",
      "a/voti.xlsx",
      "y/voti.xlsx",
    ]);
  });

  it("non dipende dall'ordine di arrivo, e non cambia la lista data", () => {
    const names = ["c.md", "a.md", "b.md", "a/a.md"];
    const given = names.map((path) => ({ path }));
    expect(paths([...names].reverse())).toEqual(paths(names));
    expect(sortedDrop(given)).not.toBe(given);
    expect(given.map((item) => item.path)).toEqual(names);
  });

  it("tiene le misure del contenuto di ogni file", () => {
    expect(sortedDrop([{ path: "b.png", contentSize: [4032, 3024] as const }, { path: "a.md" }])).toEqual([
      { path: "a.md" },
      { path: "b.png", contentSize: [4032, 3024] },
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
