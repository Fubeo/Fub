// @vitest-environment happy-dom
//
// **I caratteri del tema** (PA T39): un manifest `theme-2` dichiara i suoi
// caratteri (`fonts`), e il loader scrive da sé le regole `@font-face` nel
// canale `caratteri-tema`, coi valori del manifest e l'URL `data:` del file.
// Il CSS del tema resta senza `@font-face`: un `src:` scritto a mano potrebbe
// chiamare la rete. Cambiato tema, il canale si svuota.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeInfo, ThemePayload } from "../host/contract";
import { createFakeHost, extendingTheme, fakeWoff2, fontTheme } from "../host/fake";
import sheetLight from "./scrittoio/sheet-light.css?raw";
import sheetDark from "./scrittoio/sheet-dark.css?raw";
import seriesSkin from "./scrittoio/skin.css?raw";
import seriesFonts from "./scrittoio/fonts.css?raw";
import {
  count,
  mountThemeBundle,
  MAX_THEME_FONT_BYTES,
  SERIES_FONT_FAMILIES,
  themeFontFaces,
  validateThemeBundle,
  type ThemeBundle,
  type ThemeBundleManifest,
} from "./loader";
import { SCRITTOIO_SERIES } from "./scrittoio/series";

const box = vi.hoisted(() => ({ api: null as unknown }));

const CARTA_SKIN = ".shell-tooltip { white-space: nowrap; }\n";
const caratteri = fontTheme("acme.caratteri");
const carta = extendingTheme("acme.carta");
const piena: ThemeInfo = {
  manifest: {
    id: "acme.piena",
    name: "Piena",
    version: "1.0.0",
    engine: "theme-2",
    lights: ["light"],
    asset_namespace: "theme://acme.piena/",
    motion: ["opacity", "transform"],
  },
  trust: "community",
};
const fake = createFakeHost({
  themes: [caratteri.info, carta.info, piena],
  themePayloads: {
    ...caratteri.payloads,
    // Il foglio e la pelle del finto non passano il cancello: qui la carta
    // eredita il foglio e porta una pelle di una regola, senza caratteri.
    "acme.carta:light": { ...carta.payloads["acme.carta:light"]!, sheet: null, skin: CARTA_SKIN },
    "acme.carta:dark": { ...carta.payloads["acme.carta:dark"]!, skin: CARTA_SKIN },
    "acme.piena:light": {
      manifest: piena.manifest,
      light: "light",
      sheet: sheetLight,
      skin: seriesSkin,
      assets: {},
    } satisfies ThemePayload,
  },
});

box.api = new Proxy(fake.module.api, {
  get: (target, key) => (key === "setSetting" ? async () => {} : Reflect.get(target, key)),
});
vi.mock("../host/ipc", () => ({
  api: new Proxy({}, { get: (_target, key) => Reflect.get(box.api as object, key) }),
}));

const {
  SERIES_THEME_ID,
  cancelThemePreview,
  currentThemeId,
  previewTheme,
  selectTheme,
  themeCatalog,
} = await import("./theme");

function system(light: "light" | "dark" = "light"): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-contrast: more)" ? false : light === "dark",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

function text(layer: string): string | null {
  return document.head.querySelector(`style[data-fub="${layer}"]`)?.textContent ?? null;
}

function layers(): string[] {
  return [...document.head.querySelectorAll<HTMLStyleElement>("style[data-fub]")].map(
    (element) => element.dataset.fub ?? "",
  );
}

const MANIFEST = caratteri.info.manifest as ThemeBundleManifest;
const PAYLOAD = caratteri.payloads["acme.caratteri:light"]!;
const SERIES_MANIFEST: ThemeBundleManifest = SCRITTOIO_SERIES.manifest;

function bundle(overrides: Partial<ThemeBundle> & { fonts?: unknown } = {}): ThemeBundle {
  const { fonts, ...rest } = overrides;
  return {
    manifest: fonts === undefined ? MANIFEST : ({ ...MANIFEST, fonts } as ThemeBundleManifest),
    sheet: sheetLight,
    skin: PAYLOAD.skin ?? undefined,
    assets: PAYLOAD.assets,
    inherited: { skin: seriesSkin },
    ...rest,
  };
}

describe("il loader scrive le regole dei caratteri del tema", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("una regola per voce, coi valori del manifest e l'URL data: del file", () => {
    const rules = themeFontFaces(MANIFEST, PAYLOAD.assets)!;
    const normal = btoa(String.fromCharCode(...fakeWoff2(12)));
    const italic = btoa(String.fromCharCode(...fakeWoff2(9)));

    expect(rules).toBe([
      "@font-face {",
      '  font-family: "Carta Serif";',
      "  font-style: normal;",
      "  font-weight: 400;",
      "  font-display: swap;",
      `  src: url("data:font/woff2;base64,${normal}") format("woff2");`,
      "}",
      "",
      "@font-face {",
      '  font-family: "Carta Serif";',
      "  font-style: italic;",
      "  font-weight: 400;",
      "  font-display: swap;",
      `  src: url("data:font/woff2;base64,${italic}") format("woff2");`,
      "}",
      "",
    ].join("\n"));
    expect(rules).not.toContain("theme://");
    expect(themeFontFaces(SERIES_MANIFEST, {})).toBeUndefined();
  });

  it("le regole vanno in caratteri-tema, subito dopo i caratteri di serie e prima del foglio", () => {
    const series = document.createElement("style");
    series.dataset.fub = "caratteri";
    const preferences = document.createElement("style");
    preferences.dataset.fub = "preferenze";
    document.head.append(series, preferences);

    expect(mountThemeBundle(bundle(), "light")).toEqual({ mounted: true });

    expect(layers()).toEqual(["caratteri", "caratteri-tema", "foglio", "pelle", "pelle-tema", "preferenze"]);
    expect(text("caratteri-tema")).toBe(themeFontFaces(MANIFEST, PAYLOAD.assets));
    expect(text("pelle-tema")).toContain('font-family: "Carta Serif", var(--font-ui)');
  });

  it("un tema senza caratteri svuota il canale, e uno rifiutato lo lascia com'era", () => {
    mountThemeBundle(bundle(), "light");
    expect(count("caratteri-tema")).toBe(1);

    const rejected = mountThemeBundle(
      bundle({ skin: ".ui-estraneo { color: red; }" }),
      "light",
      () => {},
    );
    expect(rejected.mounted).toBe(false);
    expect(count("caratteri-tema")).toBe(1);

    mountThemeBundle({ manifest: SERIES_MANIFEST, sheet: sheetDark, skin: seriesSkin, assets: {} }, "dark");
    expect(count("caratteri-tema")).toBe(0);
    expect(layers()).toEqual(["foglio", "pelle"]);
  });

  it("un @font-face scritto nella pelle o nel foglio è ancora rifiutato", () => {
    const face = '@font-face { font-family: "Carta Serif"; src: url("theme://acme.caratteri/fonts/carta.woff2"); }\n';
    const skin = validateThemeBundle(bundle({ skin: `${face}${PAYLOAD.skin}` }), "light").join("\n");
    expect(skin).toMatch(/^pelle: .*font-face/m);
    const sheet = validateThemeBundle(bundle({ sheet: `${face}${sheetLight}` }), "light").join("\n");
    expect(sheet).toMatch(/^foglio: .*font-face/m);
  });

  it("il cancello ripete i controlli dell'host sul fascio, che resta non fidato", () => {
    const reasons = (fonts: unknown, assets = PAYLOAD.assets) =>
      validateThemeBundle(bundle({ fonts, assets }), "light").filter((reason) => reason.startsWith("caratteri"));
    const one = (patch: Record<string, unknown>) => [{ family: "Carta Serif", file: "fonts/carta.woff2", weight: 400, style: "normal", ...patch }];

    expect(reasons(MANIFEST.fonts)).toEqual([]);
    expect(reasons(one({ file: "https://example.com/carta.woff2" })).join()).toContain("non è fonts/<nome>.woff2");
    expect(reasons(one({ file: "fonts/assente.woff2" })).join()).toContain("manca dal fascio");
    expect(reasons(one({}), { "theme://acme.caratteri/fonts/carta.woff2": [0, 1, 0, 0, 9] }).join()).toContain("non è WOFF2");
    expect(reasons(one({ family: "Inter Variable" })).join()).toContain("famiglia di serie");
    expect(reasons(one({ family: "monospace" })).join()).toContain("parola chiave");
    expect(reasons(one({ family: 'Carta"; src: url(x)' })).join()).toContain("lettere, cifre");
    expect(reasons(one({ weight: 950 })).join()).toContain("fra 100 e 900");
    expect(reasons(one({ style: "oblique" })).join()).toContain("normal o italic");
    expect(reasons([...one({}), ...one({})]).join()).toContain("due volte");
    expect(reasons("tanti").join()).toContain("non è una lista");

    const nine = Array.from({ length: 9 }, (_, n) => ({ family: `Carta ${n}`, file: "fonts/carta.woff2", weight: 400, style: "normal" }));
    expect(reasons(nine).join()).toContain("9 dichiarati, al massimo 8");

    const big = { "theme://acme.caratteri/fonts/carta.woff2": fakeWoff2(MAX_THEME_FONT_BYTES + 1) };
    expect(reasons(one({}), big).join()).toContain(`supera ${MAX_THEME_FONT_BYTES} byte`);
  });

  it("l'elenco delle famiglie di serie è quello del foglio dei caratteri di serie", () => {
    const inSheet = [...new Set([...seriesFonts.matchAll(/font-family:\s*"([^"]+)"/g)].map((match) => match[1]))];
    expect([...SERIES_FONT_FAMILIES].sort()).toEqual(inSheet.sort());
  });
});

describe("la shell monta i caratteri del tema e non lascia resti", () => {
  beforeAll(async () => {
    system("light");
    const catalog = await themeCatalog();
    expect(catalog.map((info) => info.manifest.id)).toEqual(["acme.caratteri", "acme.carta", "acme.piena"]);
  });

  beforeEach(async () => {
    system("light");
    document.head.innerHTML = "";
    localStorage.clear();
    await cancelThemePreview();
    await selectTheme(SERIES_THEME_ID, "light");
  });

  it("scelto il tema, le sue regole sono in caratteri-tema", async () => {
    await selectTheme("acme.caratteri", "light");

    expect(currentThemeId()).toBe("acme.caratteri");
    expect(count("caratteri-tema")).toBe(1);
    expect(text("caratteri-tema")).toContain('font-family: "Carta Serif"');
    expect(text("caratteri-tema")).toContain("data:font/woff2;base64,");
  });

  it("«Annulla anteprima» svuota il canale", async () => {
    await previewTheme("acme.caratteri", "light");
    expect(count("caratteri-tema")).toBe(1);

    await cancelThemePreview();

    expect(currentThemeId()).toBe(SERIES_THEME_ID);
    expect(count("caratteri-tema")).toBe(0);
  });

  it("il ritorno alla serie e il cambio di tema svuotano il canale", async () => {
    await selectTheme("acme.caratteri", "light");
    await selectTheme("acme.carta", "light");
    expect(count("caratteri-tema")).toBe(0);
    expect(count("pelle-tema")).toBe(1);

    await selectTheme("acme.caratteri", "light");
    await selectTheme("acme.piena", "light");
    expect(count("caratteri-tema")).toBe(0);

    await selectTheme("acme.caratteri", "light");
    await selectTheme(SERIES_THEME_ID, "light");
    expect(count("caratteri-tema")).toBe(0);
  });
});
