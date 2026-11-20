// @vitest-environment happy-dom
// Le letture locali con `fetch` non seguono redirect e non portano
// credenziali né referrer, come le tessere della mappa.

import { afterEach, describe, expect, it, vi } from "vitest";
import { appFile } from "../spatial/picture";
import { pngOf } from "./png";

const EXPECTED = { redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("le letture locali", () => {
  it("l'immagine da copiare come PNG si legge senza redirect né credenziali", async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const fetched = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, blob: async () => png }));
    vi.stubGlobal("fetch", fetched);
    const picture = { currentSrc: "fub-asset://localhost/a.png", src: "" } as HTMLImageElement;
    expect(await pngOf(picture)).toBe(png);
    expect(fetched).toHaveBeenCalledWith("fub-asset://localhost/a.png", expect.objectContaining(EXPECTED));
  });

  it("un file dell'app per i caratteri del disegno si legge senza redirect né credenziali", async () => {
    const font = new Blob([new Uint8Array([1, 2, 3])], { type: "font/woff2" });
    const fetched = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, blob: async () => font }));
    vi.stubGlobal("fetch", fetched);
    expect(await appFile("/fonts/literata.woff2")).toBe(font);
    expect(fetched).toHaveBeenCalledWith("/fonts/literata.woff2", expect.objectContaining(EXPECTED));
  });

  // Il presidio non dimostra il comportamento: i due test sopra lo fanno per
  // le letture che hanno un punto d'ingresso. Questo ferma il prossimo
  // `fetch` nudo, come quello dei caratteri dei diagrammi.
  it("nessun sorgente del client chiama fetch senza le opzioni delle letture locali", () => {
    const sources = import.meta.glob("../../**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const bare: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (path.endsWith(".test.ts") || path.endsWith("/local-fetch.ts")) continue;
      for (const match of text.matchAll(/(?<![\w.])fetch\(([^\n]*)/g)) {
        if (!match[1].includes("LOCAL_FETCH")) bare.push(`${path}: ${match[0].trim()}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
