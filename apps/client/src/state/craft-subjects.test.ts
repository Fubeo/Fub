// I PDF e i documenti di cui l'anteprima la fa un'app (T31): quali sono,
// dall'estensione, e le estensioni dei documenti allineate al contratto di
// `fub.craft`. Senza DOM: il contratto si legge come testo, col `?raw` di
// Vite (vedi `ui/format-kind.test.ts`), che sotto happy-dom il server non serve.
import { describe, expect, it } from "vitest";
import { appPreviewSubject, DOCUMENT_EXTENSIONS } from "./craft-previews";
import CONTRACT_RS from "../../../../crates/fub-format-craft/src/contract.rs?raw";

function declared(name: string): string[] {
  const found = new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\];`).exec(CONTRACT_RS);
  expect(found, name).not.toBeNull();
  return [...found![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("i PDF e i documenti, di cui l'anteprima la fa un'app", () => {
  it("le estensioni dei documenti sono quelle del contratto", () => {
    expect([...DOCUMENT_EXTENSIONS]).toEqual(declared("DOCUMENT_EXTENSIONS"));
    expect(declared("PDF_EXTENSIONS")).toEqual(["pdf"]);
  });

  it("si riconoscono dall'estensione, in qualunque maiuscola, e nient'altro", () => {
    expect(appPreviewSubject("Manuali/guida.pdf")).toBe("pdf");
    expect(appPreviewSubject("GUIDA.PDF")).toBe("pdf");
    expect(appPreviewSubject("guida.pdf#page=3")).toBe("pdf");
    expect(appPreviewSubject("Lettera.docx")).toBe("document");
    expect(appPreviewSubject("vecchio.DOC")).toBe("document");
    expect(appPreviewSubject("verbale.odt")).toBe("document");
    expect(appPreviewSubject("lettera.rtf")).toBe("document");
    expect(appPreviewSubject("Disegni/logo.vectorcraft")).toBeNull();
    expect(appPreviewSubject("conti.xlsx")).toBeNull();
    expect(appPreviewSubject("Note/pdf")).toBeNull();
    expect(appPreviewSubject(".docx")).toBeNull();
  });
});
