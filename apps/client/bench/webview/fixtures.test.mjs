// Il PDF di S11 scritto a mano (`multipagePdf`): pdf.js, lo stesso motore
// dell'app, lo apre senza ricostruire la tabella `xref`, conta le pagine e
// ne legge il testo.
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { BIG_PDF, PDF_PAGE, multipagePdf } from "./fixtures.mjs";

describe("il PDF di più pagine di S11", () => {
  it("gli scarti della tabella xref puntano agli oggetti", () => {
    const bytes = multipagePdf(3);
    const text = bytes.toString("latin1");
    const start = Number(/startxref\n(\d+)\n/.exec(text)[1]);
    expect(text.slice(start, start + 5)).toBe("xref\n");
    const rows = text.slice(start).split("\n").slice(3).filter((row) => row.endsWith(" n "));
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((row, index) => {
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true);
    });
  });

  it("pdf.js lo apre con tutte le pagine e il loro testo", async () => {
    const loading = getDocument({ data: new Uint8Array(multipagePdf(BIG_PDF.pages)), isEvalSupported: false, stopAtErrors: true });
    const pdf = await loading.promise;
    try {
      expect(pdf.numPages).toBe(BIG_PDF.pages);
      const last = await pdf.getPage(BIG_PDF.pages);
      expect(last.view).toEqual([0, 0, PDF_PAGE.width, PDF_PAGE.height]);
      const content = await last.getTextContent();
      const words = content.items.map((item) => item.str).join(" ");
      expect(words).toContain(`Capitolo ${BIG_PDF.pages}`);
      expect(words).toContain(`Riga 100 della pagina ${BIG_PDF.pages}`);
    } finally {
      await loading.destroy();
    }
  });
});
