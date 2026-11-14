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
});
