import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { catalogFor } from "../../i18n/strings";
import { editorPhrases, TRANSLATED_PHRASES } from "./phrases";

/// Le frasi che i pacchetti di CodeMirror installati chiedono davvero, lette
/// dal loro codice: un pacchetto aggiornato con una frase nuova è rosso qui.
function phrasesAsked(): Set<string> {
  // Con `import.meta.glob` di Vite e non con `node:fs`, come gli altri presidi
  // che leggono sorgenti (`ink/boundary.test.ts`).
  const sources = import.meta.glob("/node_modules/@codemirror/*/dist/index.js", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const found = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const m of source.matchAll(/phrase\((?:[\w.]+,\s*)?"([^"]+)"/g)) found.add(m[1]!);
    for (const m of source.matchAll(/phrase\(\w+(?:\.\w+)? \? "([^"]+)" : "([^"]+)"\)/g)) {
      found.add(m[1]!);
      found.add(m[2]!);
    }
  }
  if (found.size < 10) throw new Error(`lette poche frasi (${found.size}): il glob non trova CodeMirror`);
  return found;
}

describe("le frasi di CodeMirror", () => {
  it("ogni frase che CodeMirror chiede ha una traduzione", () => {
    const missing = [...phrasesAsked()].filter((p) => !TRANSLATED_PHRASES.includes(p));
    expect(missing).toEqual([]);
  });

  it("in italiano il pannello dice «Trova», non «Find»", () => {
    const it = catalogFor("it");
    expect(it["editor.cm.find"]).toBe("Trova");
    expect(it["editor.cm.replaced_all"]).toContain("$");
    const state = EditorState.create({ extensions: editorPhrases() });
    // La lingua dei test è quella di `navigator`; la frase passa comunque dal catalogo.
    expect(state.phrase("Find")).toBe(catalogFor(navigator.language)["editor.cm.find"]);
    expect(state.phrase("replaced $ matches", 3)).toMatch(/3/);
  });
});
