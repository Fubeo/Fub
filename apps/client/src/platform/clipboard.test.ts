import { afterEach, describe, expect, it } from "vitest";
import { ClipboardUnavailable, declareClipboard, writeClipboardText } from "./clipboard";

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
