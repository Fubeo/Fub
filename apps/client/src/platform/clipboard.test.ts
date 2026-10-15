import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clipboardSupports,
  ClipboardUnavailable,
  declareClipboard,
  readClipboard,
  writeClipboardData,
  writeClipboardText,
  type ClipboardContent,
  type ClipboardEntry,
  type RichClipboard,
} from "./clipboard";

/// Tutti i `.ts` sotto `src/`, contenuto compreso (vedi
/// `host/no-tauri-outside-host.test.ts` per il perché di `import.meta.glob`).
const sources = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Un uso degli appunti della webview, anche con `?.`.
const WEBVIEW_CLIPBOARD = /\bnavigator\s*\??\.\s*clipboard\b/;

/// Le righe di codice, senza quelle di commento: un commento che nomina gli
/// appunti della webview non li usa.
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});

function webview(writeText: ((text: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

describe("gli appunti della shell", () => {
  it("di serie scrivono negli appunti della webview", async () => {
    const written: string[] = [];
    webview(async (text) => { written.push(text); });
    await writeClipboardText("uno");
    expect(written).toEqual(["uno"]);
  });

  it("dicono che non ci sono, invece di lanciare", async () => {
    webview(undefined);
    await expect(writeClipboardText("uno")).rejects.toBeInstanceOf(ClipboardUnavailable);
  });

  it("sono quelli dichiarati dalla shell finché la shell non li ritira", async () => {
    const webviewText: string[] = [];
    const shellText: string[] = [];
    webview(async (text) => { webviewText.push(text); });
    const retire = declareClipboard(async (text) => { shellText.push(text); });
    await writeClipboardText("dichiarati");
    retire();
    await writeClipboardText("di serie");
    expect(shellText).toEqual(["dichiarati"]);
    expect(webviewText).toEqual(["di serie"]);
  });

  it("un rifiuto sincrono della shell arriva dalla promessa", async () => {
    const retire = declareClipboard(() => { throw new Error("negato"); });
    try {
      await expect(writeClipboardText("x")).rejects.toThrow("negato");
    } finally {
      retire();
    }
  });

  it("con più tipi, di serie sono quelli della webview: il testo e il PNG, e gli altri tipi che il motore accetta", async () => {
    /// Un `ClipboardItem` come quello dei motori, che accetta l'SVG.
    class Item {
      static supports = (type: string): boolean => type === "image/svg+xml";
      constructor(readonly content: ClipboardContent) {}
    }
    vi.stubGlobal("ClipboardItem", Item);
    const written: Item[][] = [];
    const entry: ClipboardEntry = { types: ["text/plain"], getType: async () => new Blob(["ciao"]) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: Item[]) => void written.push(items),
        read: async () => [entry],
      },
    });
    expect(["text/plain", "image/png", "image/svg+xml", "text/html"].map(clipboardSupports)).toEqual([true, true, true, false]);
    const content = { "text/plain": new Blob(["<svg/>"]) };
    await writeClipboardData(content);
    expect(written.map((items) => items.map((item) => item.content))).toEqual([[content]]);
    expect(await readClipboard()).toEqual([entry]);
    // Senza `supports` vale ciò che ogni motore accetta.
    vi.stubGlobal("ClipboardItem", class {});
    expect(["text/plain", "image/png", "image/svg+xml"].map(clipboardSupports)).toEqual([true, true, false]);
  });

  it("con più tipi, dove non ci sono lo dicono, invece di lanciare", async () => {
    webview(async () => undefined);
    expect(clipboardSupports("text/plain")).toBe(false);
    await expect(writeClipboardData({})).rejects.toBeInstanceOf(ClipboardUnavailable);
    await expect(readClipboard()).rejects.toBeInstanceOf(ClipboardUnavailable);
  });

  it("con più tipi, sono quelli della shell che li dichiara; una shell che non li ha non ne ha", async () => {
    const shell: RichClipboard = {
      write: async () => {
        throw new Error("negato");
      },
      read: async () => [],
      supports: (type) => type === "image/png",
    };
    const retire = declareClipboard(async () => undefined, shell);
    try {
      expect(clipboardSupports("image/png")).toBe(true);
      expect(clipboardSupports("text/plain")).toBe(false);
      await expect(writeClipboardData({})).rejects.toThrow("negato");
      expect(await readClipboard()).toEqual([]);
    } finally {
      retire();
    }
    const plain = declareClipboard(async () => undefined);
    try {
      expect(clipboardSupports("image/png")).toBe(false);
      await expect(readClipboard()).rejects.toBeInstanceOf(ClipboardUnavailable);
    } finally {
      plain();
    }
  });

  it("nessun altro modulo usa gli appunti della webview", () => {
    const offenders = Object.entries(sources)
      .filter(([key]) => key !== "./clipboard.ts" && !key.endsWith(".test.ts"))
      .filter(([, text]) => WEBVIEW_CLIPBOARD.test(code(text)))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
    // Il presidio legge davvero i sources e riconosce un uso quando c'è.
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(WEBVIEW_CLIPBOARD.test(code(sources["./clipboard.ts"]))).toBe(true);
  });
});
