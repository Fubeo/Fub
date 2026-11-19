// @vitest-environment happy-dom
// Le proprietà sotto il titolo (T74): nessuna, in evidenza (le prime quattro,
// senza le chiavi della testata né le etichette), tutte; i valori scritti per
// chi legge; il blocco si toglie col resto dei cambi.

import { describe, expect, it } from "vitest";
import { ContentChanges } from "./changes";
import { applyProperties, propertyText, shownProperties } from "./properties";

const ENTRIES = [
  { key: "icon", value: "📄" },
  { key: "stato", value: "bozza" },
  { key: "tags", value: ["lavoro", "riunioni"] },
  { key: "autore", value: "[[Persone/Anna Rossi|Anna]]" },
  { key: "scadenza", value: "2026-11-04" },
  { key: "fatto", value: false },
  { key: "ore", value: 1234.5 },
  { key: "vuota", value: null },
  { key: "stato", value: "pronta" },
];

describe("le proprietà della nota", () => {
  it("si scrivono per chi legge", () => {
    expect(propertyText(["a", "b"])).toBe("a, b");
    expect(propertyText("[[Persone/Anna Rossi]]")).toBe("Anna Rossi");
    expect(propertyText("[[Persone/Anna Rossi|Anna]]")).toBe("Anna");
    expect(propertyText(true)).toBe("Sì");
    expect(propertyText(null)).toBe("");
    expect(propertyText("2026-11-04")).toMatch(/2026/);
    expect(propertyText("2026-02-31")).toBe("2026-02-31");
  });

  it("«No» non ne mostra nessuna", () => {
    expect(shownProperties(ENTRIES, "nessuna")).toEqual([]);
  });

  it("in evidenza: le prime quattro, senza icona né etichette, l'ultima scrittura della chiave vince", () => {
    const shown = shownProperties(ENTRIES, "in-evidenza");
    expect(shown.map((p) => p.label)).toEqual(["stato", "autore", "scadenza", "fatto"]);
    expect(shown[0]!.value).toBe("pronta");
  });

  it("tutte: anche le etichette, senza le chiavi della testata e senza quelle vuote", () => {
    const shown = shownProperties(ENTRIES, "tutte");
    expect(shown.map((p) => p.label)).toEqual(["stato", "tags", "autore", "scadenza", "fatto", "ore"]);
    expect(shown[1]!.value).toBe("lavoro, riunioni");
  });

  it("stanno sotto il titolo, e i cambi disfatti le tolgono", () => {
    const page = document.createElement("article");
    page.className = "print-page";
    page.innerHTML = `<h1>Nota</h1><div class="print-body markdown-rendered"><p>testo</p></div>`;
    const changes = new ContentChanges();
    const block = applyProperties(page, shownProperties(ENTRIES, "in-evidenza"), changes)!;
    expect(page.children[1]).toBe(block);
    expect(block.querySelectorAll("dt")).toHaveLength(4);
    expect(block.getAttribute("aria-label")).toBe("Proprietà della nota");
    changes.undo();
    expect(page.querySelector(".export-properties")).toBeNull();
  });

  it("nessuna proprietà da mostrare, nessun blocco", () => {
    const page = document.createElement("article");
    expect(applyProperties(page, [], new ContentChanges())).toBeNull();
    expect(page.childElementCount).toBe(0);
  });
});
