import { describe, expect, it } from "vitest";

// warmup.mjs sta fuori dal confine TypeScript del browser, come stage.mjs.
// @ts-expect-error modulo JavaScript del banco senza dichiarazione.
const { lazyEditorModules } = await import("./warmup.mjs");

// La radice del client; il modulo legge i file da lì, e un `import()` che non
// porta a un file lo fa fallire. Su Windows il percorso dell'URL comincia con
// `/C:`: la barra davanti all'unità si toglie.
const ROOT = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

describe("i moduli che il server del banco scalda", () => {
  const modules: string[] = lazyEditorModules(ROOT);

  it("comprendono ogni editor caricato con un import() alla prima apertura", () => {
    for (const editor of [
      "./src/editors/canvas/surface.ts",
      "./src/editors/spatial/lazy.ts",
      "./src/editors/spatial/surface.ts",
      "./src/editors/spatial/pdf/surface.ts",
      "./src/editors/rich/surface.ts",
      "./src/editors/grid/engine.ts",
      "./src/editors/base/surface.ts",
      "./src/editors/craft/surface.ts",
      "./src/editors/media/image-view.ts",
    ]) {
      expect(modules, editor).toContain(editor);
    }
  });

  it("sono file del client, senza pacchetti", () => {
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(module.startsWith("./src/"), module).toBe(true);
    }
    expect(modules.some((module) => module.includes("pdfjs-dist"))).toBe(false);
  });
});
