// Il vault della prova con Obsidian delle schede vive
// (`tests/fixtures/prova-obsidian-schede/`, T56): la nota `Schede vive.md`
// deve avere ogni specie che una nota mostra come scheda, e ogni file che
// nomina deve esserci, tranne quello che manca apposta. Così la prova che si
// chiede a chi ha Obsidian copre davvero tutte le specie, anche quando ne
// nasce una nuova.
//
// I file si contano con `import.meta.glob`, come le baseline di
// `scene.test.ts`: `tsconfig.json` non ha i tipi di Node.
import { describe, expect, it } from "vitest";

import { noteCardKindOf, type CardKind } from "../src/editors/core/cards/contract";
import note from "../../../tests/fixtures/prova-obsidian-schede/Schede vive.md?raw";

const ROOT = "../../../tests/fixtures/prova-obsidian-schede/";
const files = Object.keys(
  import.meta.glob("../../../tests/fixtures/prova-obsidian-schede/**/*", { eager: true, query: "?url", import: "default" }),
).map((path) => path.slice(ROOT.length));

/// Il file che manca apposta: la scheda «File mancante».
const MISSING = "Contratto vecchio.pdf";

/// Le specie che una nota mostra come scheda viva: tutte quelle di
/// `noteCardKindOf` tranne la nota (la trasclusione viva) e l'immagine, che la
/// nota mostra a modo suo.
const NOTE_CARD_KINDS: readonly CardKind[] = ["pdf", "sheet", "document", "drawing", "canvas", "craft", "file"];

/// Gli embed della nota, col nome del file senza parte né misura.
const embeds = [...note.matchAll(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((match) => match[1]!);

describe("il vault della prova con Obsidian delle schede vive", () => {
  it("la nota ha ogni specie di scheda viva", () => {
    const kinds = new Set(embeds.map((name) => noteCardKindOf(name)));
    for (const kind of NOTE_CARD_KINDS) expect(kinds, `manca la specie «${kind}»`).toContain(kind);
  });

  it("ogni file nominato c'è, nella cartella degli allegati, tranne quello che manca apposta", () => {
    for (const name of embeds) {
      if (name === MISSING) {
        expect(files.some((file) => file.endsWith(`/${name}`))).toBe(false);
        continue;
      }
      expect(files, `manca ${name}`).toContain(`Allegati/${name}`);
    }
    expect(embeds).toContain(MISSING);
  });

  it("ogni allegato è nominato dalla nota e nella tabella del README", async () => {
    const readme = (await import("../../../tests/fixtures/prova-obsidian-schede/README.md?raw")).default;
    for (const file of files.filter((path) => path.startsWith("Allegati/"))) {
      expect(embeds, `${file} non è nella nota`).toContain(file.slice("Allegati/".length));
      expect(readme, `${file} non è nel README`).toContain(`\`${file}\``);
    }
  });
});
