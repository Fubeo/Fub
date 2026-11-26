// **Il presidio della struttura**: `structure.css` è quello che i pezzi di
// `scrittoio/structure/` compongono, e i pezzi sono quelli che l'ordine
// elenca. Le ragioni sono quelle del presidio della pelle (`skin.test.ts`):
// byte per byte, perché i pezzi siano la sorgente e il file montato un
// derivato; e le due liste, perché un pezzo scritto e mai elencato non esca
// in silenzio da una struttura più corta.
import { describe, expect, it } from "vitest";

import { ORDER, assemble } from "./scrittoio/structure/order";
import structure from "./scrittoio/structure.css?raw";

/// I pezzi come stanno sulla cartella: chiave = nome del file senza estensione.
const ON_DISK: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("./scrittoio/structure/*.css", { query: "?raw", import: "default", eager: true }),
  ).map(([assetPath, text]) => [
    assetPath.replace(/^.*\/(.+)\.css$/, "$1"),
    text as string,
  ]),
);

describe("la struttura è quella che i suoi pezzi compongono", () => {
  it("byte per byte", () => {
    expect(
      assemble(ON_DISK),
      "structure.css non è quello che i suoi pezzi producono: «npm run theme:generate». " +
        "Una regola scritta a mano nel file montato sparisce alla prima rigenerazione.",
    ).toBe(structure);
  });

  it("ogni pezzo sulla cartella ha un posto nell'ordine", () => {
    expect(Object.keys(ON_DISK).sort()).toEqual([...ORDER].sort());
  });

  it("e nessun pezzo è vuoto", () => {
    for (const [name, text] of Object.entries(ON_DISK)) {
      expect(text.replace(/\/\*[\s\S]*?\*\//g, "").trim(), `${name}.css è vuoto`).not.toBe("");
    }
  });

  it("il filetto dice da quale pezzo viene ciò che segue", () => {
    for (const part of ORDER) {
      expect(structure, `manca il filetto di ${part}.css`).toContain(`/* ── structure/${part}.css `);
    }
  });
});
