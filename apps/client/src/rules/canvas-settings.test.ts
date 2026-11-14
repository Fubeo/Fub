// Il taglio di `canvas-settings.ts`: il modulo che lo stato di documento e
// l'importazione dei file trascinati portano già all'avvio non importa niente
// dell'editor della lavagna né dell'inchiostro. Il controllo del bundle
// (`vite.config.ts`) guarda il chunk d'avvio, e solo dopo una build; questo
// presidio cade qui, nel file che è cambiato.
//
// Il sorgente si legge come testo, col `?raw` di Vite, come
// `ink/boundary.test.ts`. Un presidio che non può cadere non vale nulla: per
// questo il test verifica prima di aver trovato le importazioni che controlla.
import { describe, expect, it } from "vitest";
import SOURCE from "./canvas-settings.ts?raw";
import * as neutral from "./canvas-settings";
import * as lavagna from "../editors/canvas/preferences";

/// Gli specificatori delle importazioni e riesportazioni statiche di un sorgente.
function staticImports(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']/gm)].map((match) => match[1]!);
}

describe("le impostazioni della lavagna senza la lavagna", () => {
  it("non importano niente dell'editor né dell'inchiostro", () => {
    const specifiers = staticImports(SOURCE);
    expect(specifiers).toContain("../host/contract");
    expect(specifiers).toContain("./mirrored");
    expect(specifiers.filter((specifier) => /(^|\/)(editors|ink)(\/|$)/.test(specifier))).toEqual([]);
  });

  it("`preferences.ts` riesporta le stesse impostazioni, non copie", () => {
    expect(lavagna.DEFAULT_PREFERENCES).toBe(neutral.DEFAULT_PREFERENCES);
    expect(lavagna.preferencesOf).toBe(neutral.preferencesOf);
    expect(lavagna.DROP_FOLDER_KEY).toBe(neutral.DROP_FOLDER_KEY);
  });
});
