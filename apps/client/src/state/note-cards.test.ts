// Le schede delle note (E11, T20): ciò che la scheda legge dalle proprietà.
import { describe, expect, it } from "vitest";
import type { DocumentMatch } from "../host/contract";
import { cardDate, isNoteDoc, noteCardOf } from "./note-cards";

function match(properties: Record<string, unknown>): DocumentMatch {
  return {
    doc: "Luoghi/Biblioteca civica.md",
    properties: Object.entries(properties).map(([key, value]) => ({ key, value })),
  } as unknown as DocumentMatch;
}

describe("la scheda della nota", () => {
  it("prende icona, descrizione, copertina e la prima data che c'è", () => {
    const card = noteCardOf("Luoghi/Biblioteca civica.md", match({
      icon: "📚",
      description: "Orari, sale e prestito",
      cover: "#cfe7d6",
      updated: "2026-11-10",
      created: "2025-01-02",
    }), "it");
    expect(card).toEqual({
      doc: "Luoghi/Biblioteca civica.md",
      title: "Biblioteca civica",
      icon: "📚",
      description: "Orari, sale e prestito",
      date: "10 novembre 2026",
      cover: "#cfe7d6",
    });
  });

  it("senza proprietà è il solo titolo; una descrizione lunga si taglia", () => {
    expect(noteCardOf("Nota.md", undefined, "it")).toEqual({ doc: "Nota.md", title: "Nota", icon: "", description: "", date: "", cover: "" });
    const long = noteCardOf("Nota.md", match({ description: "x".repeat(400) }), "it");
    expect(long.description.length).toBe(280);
    expect(long.description.endsWith("…")).toBe(true);
  });

  it("dice le date a parole; un testo breve resta com'è, uno lungo o una data impossibile no", () => {
    expect(cardDate("2026-11-10T08:30:00Z", "it")).toBe("10 novembre 2026");
    expect(cardDate("2026-02-30", "it")).toBe("2026-02-30");
    expect(cardDate("primavera 2026", "it")).toBe("primavera 2026");
    expect(cardDate("y".repeat(41), "it")).toBe("");
    expect(cardDate(null, "it")).toBe("");
  });

  it("è una scheda soltanto un link a una nota", () => {
    expect(isNoteDoc("a/Nota.md")).toBe(true);
    expect(isNoteDoc("a/Nota.MARKDOWN")).toBe(true);
    expect(isNoteDoc("Carte/Pianta.pdf")).toBe(false);
    expect(isNoteDoc("Conti.fubsheet")).toBe(false);
  });
});
