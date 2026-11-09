// I temi dell'host finto: un tema che parte dalla serie arriva come lo
// consegna l'host vero, col campo `extends` e `sheet: null` per la luce
// senza foglio.
import { describe, expect, it } from "vitest";
import { createFakeHost, extendingTheme } from "./fake";

describe("i temi nell'host finto", () => {
  it("dà un tema con extends, e la luce senza foglio arriva con sheet null", async () => {
    const theme = extendingTheme();
    const api = createFakeHost({ themes: [theme.info], themePayloads: theme.payloads }).module.api;

    const themes = await api.listThemes();
    expect(themes.map((info) => [info.manifest.id, info.manifest.extends])).toEqual([["acme.carta", "fub.serie"]]);

    const light = await api.readTheme("acme.carta", "light");
    expect(light.sheet).toContain("--carta");
    const dark = await api.readTheme("acme.carta", "dark");
    expect(dark.sheet).toBeNull();
    expect(dark.manifest.extends).toBe("fub.serie");
  });
});
