import { describe, expect, it } from "vitest";
import type { Note, NoteKind } from "./diagram";
import type { Count } from "./index";
import { countText, noteText, reportOrder } from "./report";

const COUNT: Count = { objects: 0, shapes: 0, texts: 0, lines: 0, ink: 0, images: 0, layers: 1, boards: 0 };

/// Ogni genere di nota, come lo dichiara `diagram.ts`.
const KINDS: readonly NoteKind[] = ["hand-font", "rough", "fill", "tip", "route", "stencil", "image", "reduced", "embed", "link", "unknown", "html", "shadow", "placeholder"];

describe("il rapporto dell'importazione", () => {
  it("dice quanto c'è, senza ciò che manca e senza il livello che ogni disegno ha", () => {
    expect(countText({ ...COUNT, objects: 6, shapes: 1, texts: 2, lines: 3 })).toBe("1 forma, 2 testi, 3 linee");
    expect(countText({ ...COUNT, objects: 3, ink: 1, images: 2, boards: 1, layers: 2 })).toBe("1 tratto a mano libera, 2 immagini, 1 tavola, 2 livelli");
    expect(countText({ ...COUNT, boards: 2 })).toBe("2 tavole");
  });

  it("ha una frase per ogni genere di nota, al singolare e al plurale", () => {
    for (const kind of KINDS) {
      const one = noteText({ kind, count: 1, sample: "" });
      const many = noteText({ kind, count: 4, sample: "" });
      expect(one, kind).not.toContain("draw.import");
      expect(one, kind).not.toContain("{");
      expect(many, kind).toContain("4");
      expect(many, kind).not.toBe(one);
    }
  });

  it("aggiunge l'esempio dove dice qualcosa, accorciato se è lungo", () => {
    expect(noteText({ kind: "stencil", count: 2, sample: "mxgraph.aws4.lambda" })).toBe(
      "2 forme che FubDraw non ha si disegnano come le più vicine, di solito rettangoli. Per esempio: «mxgraph.aws4.lambda».",
    );
    expect(noteText({ kind: "fill", count: 1, sample: "zigzag" })).not.toContain("zigzag»");
    expect(noteText({ kind: "html", count: 1, sample: "img" })).not.toContain("«img»");
    const long = noteText({ kind: "link", count: 1, sample: `https://example.com/${"a".repeat(200)}` });
    expect(long).toContain("…»");
    expect(long.length).toBeLessThan(200);
  });

  it("mette prima ciò che resta fuori, poi ciò che entra cambiato", () => {
    const notes: Note[] = [
      { kind: "hand-font", count: 1, sample: "Virgil" },
      { kind: "tip", count: 2, sample: "" },
      { kind: "image", count: 1, sample: "" },
      { kind: "unknown", count: 1, sample: "mermaid" },
    ];
    expect(reportOrder(notes).map((note) => note.kind)).toEqual(["unknown", "image", "tip", "hand-font"]);
  });
});
