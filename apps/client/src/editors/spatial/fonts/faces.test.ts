// I vettori della scelta delle facce (`__fixtures__/scene-fonts/choose.json`),
// condivisi con `fonts.rs` di `fub-features`: per ogni caso le facce dei file
// `files`, nell'ordine dell'anagrafe, la famiglia `family`, ciò che si chiede
// `request` e la faccia `expect`, `null` se la famiglia non c'è; o, senza
// `request`, la famiglia generica che la famiglia scrive dopo di sé.

import { describe, expect, it } from "vitest";
import vectors from "../../../__fixtures__/scene-fonts/choose.json";
import {
  choose,
  cssFamily,
  cssString,
  familyGeneric,
  fubFamily,
  isFontFile,
  liveFamily,
  parseFamilies,
  sameFamily,
  shownFamily,
  vaultNames,
  writtenFamily,
  type FaceInfo,
  type FontRequest,
  type Generic,
} from "./faces";

interface ChooseVector {
  readonly name: string;
  readonly files: readonly (readonly FaceInfo[])[];
  readonly family: string;
  readonly request?: FontRequest;
  readonly expect: { readonly file: number; readonly face: number; readonly coordinates: readonly { tag: string; value: number }[] } | { readonly generic: Generic } | null;
}

describe("la scelta delle facce", () => {
  const all = vectors as unknown as readonly ChooseVector[];

  it("ha i vettori dell'export", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
  });

  for (const vector of all) {
    it(vector.name, () => {
      const expected = vector.expect;
      if (expected !== null && "generic" in expected) {
        expect(familyGeneric(vector.files, vector.family)).toBe(expected.generic);
        return;
      }
      expect(choose(vector.files, vector.family, vector.request!)).toEqual(expected);
    });
  }
});

describe("i nomi delle famiglie", () => {
  it("sono la stessa famiglia senza badare al caso, ma soltanto nell'ASCII", () => {
    expect(sameFamily("Roboto Flex", "roboto FLEX")).toBe(true);
    expect(sameFamily("Ärger", "ärger")).toBe(false);
    expect(sameFamily("İnter", "inter")).toBe(false);
    expect(fubFamily("jetbrains mono")).toBe("JetBrains Mono");
    expect(fubFamily("Inter Display")).toBeNull();
  });

  it("riconoscono i file di caratteri dall'estensione", () => {
    expect(isFontFile("Caratteri/Roboto.ttf")).toBe(true);
    expect(isFontFile("Caratteri/ROBOTO.WOFF2")).toBe(true);
    expect(isFontFile("a.otf")).toBe(true);
    expect(isFontFile("a.woff")).toBe(true);
    expect(isFontFile("a.ttc")).toBe(false);
    expect(isFontFile("Caratteri/.ttf")).toBe(false);
    expect(isFontFile("ttf")).toBe(false);
    expect(isFontFile("note.md")).toBe(false);
  });

  it("si scrivono per i CSS fra virgolette se non sono una parola", () => {
    expect(cssFamily("Inter")).toBe("Inter");
    expect(cssFamily("JetBrains Mono")).toBe('"JetBrains Mono"');
    expect(cssFamily('Un "nome"')).toBe('"Un \\"nome\\""');
  });

  it("si scrivono come stringhe dei CSS dentro un foglio nel markup", () => {
    expect(cssString("Inter, sans-serif")).toBe('"Inter, sans-serif"');
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(cssString("<a>&\n")).toBe('"\\3c a\\3e \\26 \\a "');
  });

  it("si scrivono in un font-family che il browser e l'export rileggono uguale", () => {
    expect(writtenFamily("Roboto")).toBe("Roboto");
    expect(writtenFamily("Roboto Flex")).toBe('"Roboto Flex"');
    expect(writtenFamily("serif")).toBe('"serif"');
    expect(writtenFamily("Café")).toBe('"Café"');
    expect(writtenFamily('Un "nome"')).toBe("'Un \"nome\"'");
    for (const name of ["", " Roboto", "a\\b", "a\tb", `l'"x"`]) expect(writtenFamily(name), name).toBeNull();
    for (const name of ["Roboto", "Roboto Flex", "serif", "Café", 'Un "nome"', "Noto 日本語", "1Up"]) {
      expect(parseFamilies(`${writtenFamily(name)}, sans-serif`), name).toEqual([{ name }, { generic: "sans-serif" }]);
    }
  });
});

describe("font-family come lo legge l'export", () => {
  it("legge nomi, parole e famiglie generiche", () => {
    expect(parseFamilies("Inter, sans-serif")).toEqual([{ name: "Inter" }, { generic: "sans-serif" }]);
    expect(parseFamilies("'Noto Sans JP',  JetBrains   Mono ,monospace")).toEqual([{ name: "Noto Sans JP" }, { name: "JetBrains Mono" }, { generic: "monospace" }]);
    expect(parseFamilies('"serif", Serif')).toEqual([{ name: "serif" }, { name: "Serif" }]);
    expect(parseFamilies("")).toEqual([]);
    expect(parseFamilies("Inter,")).toEqual([{ name: "Inter" }]);
    expect(parseFamilies("'', Inter")).toEqual([{ name: "Inter" }]);
    expect(parseFamilies("Noto 日本語")).toEqual([{ name: "Noto 日本語" }]);
  });

  it("non legge ciò che svgtypes non legge", () => {
    expect(parseFamilies("Inter, ")).toBeNull();
    expect(parseFamilies("'Inter' , serif")).toBeNull();
    expect(parseFamilies("Café")).toBeNull();
    expect(parseFamilies("'Inter")).toBeNull();
    expect(parseFamilies("1Inter")).toBeNull();
  });

  it("dà i nomi da cercare nel vault", () => {
    expect(vaultNames("Roboto, 'roboto ', Inter, serif, 'Noto Sans'")).toEqual(["Roboto", "Noto Sans"]);
    expect(vaultNames("Café")).toEqual([]);
  });
});

describe("la famiglia viva", () => {
  const vault = (name: string): string | null => (sameFamily(name, "Roboto") ? "fubdraw-vault-1" : null);

  it("dà le famiglie di Fub al posto delle generiche e dopo tutte", () => {
    expect(liveFamily("Inter, sans-serif")).toBe('Inter, Literata, "JetBrains Mono"');
    expect(liveFamily("monospace")).toBe('"JetBrains Mono", Literata, Inter');
    expect(liveFamily("cursive, fantasy")).toBe('Literata, Inter, "JetBrains Mono"');
    expect(liveFamily("literata")).toBe('Literata, Inter, "JetBrains Mono"');
  });

  it("salta ciò che non c'è e ciò che non si legge, e comincia da Literata", () => {
    expect(liveFamily("Arial, Helvetica")).toBe('Literata, Inter, "JetBrains Mono"');
    expect(liveFamily("Inter, ")).toBe('Literata, Inter, "JetBrains Mono"');
    expect(liveFamily("")).toBe('Literata, Inter, "JetBrains Mono"');
  });

  it("dice con quale famiglia si vede un testo", () => {
    expect(shownFamily("Arial, sans-serif")).toBe("Inter");
    expect(shownFamily("Roboto, monospace")).toBe("JetBrains Mono");
    expect(shownFamily("")).toBe("Literata");
    expect(shownFamily("Inter, ")).toBe("Literata");
    expect(shownFamily("Arial, roboto, serif", (name) => (vault(name) === null ? null : name))).toBe("roboto");
    expect(shownFamily("Roboto, serif", () => null)).toBe("Literata");
  });

  it("dà il nome registrato a una famiglia del vault", () => {
    expect(liveFamily("Arial, ROBOTO, monospace", vault)).toBe('fubdraw-vault-1, "JetBrains Mono", Literata, Inter');
    expect(liveFamily("Roboto, sans-serif", () => null)).toBe('Inter, Literata, "JetBrains Mono"');
  });
});
