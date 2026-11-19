// La proprietà proposta per le corsie di una Bacheca e per la data di un
// Calendario che il file non dice ancora (IMP-3809, IMP-3810).
import { describe, expect, it } from "vitest";
import type { BaseRow } from "./data";
import { byDatedRows, defaultDateKey, defaultLaneKey } from "./view-keys";

const day = (d: number) => ({ kind: "date", value: { year: 2026, month: 11, day: d, time: null } });
const row = (doc: string, properties: Record<string, unknown>): BaseRow => ({ doc, values: {}, properties });

describe("le corsie proposte", () => {
  const rows = [
    row("a.md", { scadenza: day(10), cliente: "Rossi", stato: "da fare", ore: 2, fatta: false, tag: ["fisco"] }),
    row("b.md", { scadenza: day(14), cliente: "Bianchi", stato: "in corso", ore: 3, fatta: true, tag: ["fisco"] }),
    row("c.md", { scadenza: day(17), cliente: "Verdi", stato: "da fare", ore: 2, fatta: false, tag: ["lavoro"] }),
  ];

  it("mai una data, un numero o una casella; la prima di testo con pochi valori", () => {
    expect(defaultLaneKey(["scadenza", "ore", "fatta", "cliente", "stato"], rows)).toBe("stato");
  });

  it("una lista con pochi valori fa corsie", () => {
    expect(defaultLaneKey(["scadenza", "tag", "stato"], rows)).toBe("tag");
  });

  it("se nessuna ha pochi valori, quella che ne ha meno", () => {
    const unique = [row("a.md", { cliente: "Rossi", titolo: "x" }), row("b.md", { cliente: "Bianchi", titolo: "y" })];
    expect(defaultLaneKey(["cliente", "titolo"], unique)).toBe("cliente");
  });

  it("una proprietà con anche una sola data non conta, e senza testo non c'è proposta", () => {
    const mixed = [row("a.md", { quando: "presto" }), row("b.md", { quando: day(3) }), row("c.md", { quando: "presto" })];
    expect(defaultLaneKey(["quando"], mixed)).toBeNull();
    expect(defaultLaneKey(["scadenza", "ore"], rows)).toBeNull();
    expect(defaultLaneKey([], rows)).toBeNull();
  });
});

describe("la data proposta", () => {
  const rows = [
    row("a.md", { "chiusa il": day(1), scadenza: day(10) }),
    row("b.md", { scadenza: day(14) }),
    row("c.md", { scadenza: day(17), inizio: "domani" }),
  ];

  it("la proprietà data che più note della vista hanno, non la prima", () => {
    expect(defaultDateKey(["chiusa il", "scadenza"], rows)).toBe("scadenza");
    expect(byDatedRows(["chiusa il", "inizio", "scadenza"], rows)).toEqual(["scadenza", "chiusa il", "inizio"]);
  });

  it("a pari numero vale l'ordine; senza proprietà data non c'è proposta", () => {
    expect(defaultDateKey(["b", "a"], [row("x.md", { a: day(1), b: day(2) })])).toBe("b");
    expect(defaultDateKey([], rows)).toBeNull();
  });
});
