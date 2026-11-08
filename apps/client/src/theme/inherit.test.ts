// @vitest-environment happy-dom
//
// **La pelle che eredita** (ADR 0240): un tema con `extends: "fub.serie"`
// non sostituisce la pelle di serie, la lascia nel canale `pelle` e aggiunge
// la sua in `pelle-tema`, subito dopo. Una regola del tema vince così su
// quella di serie a parità di specificità, e un componente che il tema non
// nomina resta vestito dalla serie. Un tema senza `extends` monta gli stessi
// elementi di prima, e niente di un tema che eredita resta montato quando si
// torna indietro.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeInfo, ThemePayload } from "../host/contract";
import { createFakeHost, extendingTheme } from "../host/fake";
import sheetLight from "./scrittoio/sheet-light.css?raw";
import sheetDark from "./scrittoio/sheet-dark.css?raw";
import sheetDarkHigh from "./scrittoio/sheet-dark-high.css?raw";
import seriesSkin from "./scrittoio/skin.css?raw";
import { count, mountThemeBundle, validateThemeBundle, type ThemeBundleManifest } from "./loader";
import { SCRITTOIO_SERIES } from "./scrittoio/series";

const box = vi.hoisted(() => ({ api: null as unknown }));

/** La pelle di un tema che eredita: tre regole, e tutto il resto è della serie. */
const THEME_SKIN = [
  ".shell-tooltip { white-space: nowrap; }",
  ".titlebar-shortcut { font-weight: 700; }",
  ".link-card-title { text-transform: uppercase; }",
  "",
].join("\n");

/** Un tema che porta tutto da sé: il foglio di serie con una riga sua. */
const OWN_SHEET = sheetLight.replace("  color-scheme: light;", "  color-scheme: normal;");
const OWN_SKIN = ".shell-tooltip { white-space: pre; }\n";

const carta = extendingTheme("acme.carta");
const cartaManifest = carta.info.manifest;
const cartaPayloads: Record<string, ThemePayload> = {
  "acme.carta:light": { manifest: cartaManifest, light: "light", sheet: null, skin: THEME_SKIN, assets: {} },
  "acme.carta:dark": { manifest: cartaManifest, light: "dark", sheet: null, skin: THEME_SKIN, assets: {} },
};
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
  themes: [carta.info, piena],
  themePayloads: {
    ...cartaPayloads,
    "acme.piena:light": { manifest: piena.manifest, light: "light", sheet: OWN_SHEET, skin: OWN_SKIN, assets: {} },
  },
});

// Le impostazioni non sono ciò che si prova qui: scriverle non fa nulla.
box.api = new Proxy(fake.module.api, {
  get: (target, key) => (key === "setSetting" ? async () => {} : Reflect.get(target, key)),
});
vi.mock("../host/ipc", () => ({
  // Il finto si costruisce dopo che `vi.mock` è stato sollevato: si passa da qui.
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

const contrast = { high: false };
function system(light: "light" | "dark" = "light"): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-contrast: more)" ? contrast.high : light === "dark",
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

const SERIES_MANIFEST: ThemeBundleManifest = SCRITTOIO_SERIES.manifest;
const INHERITING_MANIFEST: ThemeBundleManifest = cartaManifest;

describe("il caricatore monta la pelle del tema sopra quella di serie", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("un tema senza extends monta gli stessi elementi di prima", () => {
    const result = mountThemeBundle({ manifest: SERIES_MANIFEST, sheet: sheetLight, skin: seriesSkin, assets: {} }, "light");

    expect(result.mounted).toBe(true);
    expect(layers()).toEqual(["foglio", "pelle"]);
    expect(text("foglio")).toBe(sheetLight);
    expect(text("pelle")).toBe(seriesSkin);
    expect(count("pelle-tema")).toBe(0);
  });

  it("un tema con extends e una pelle di tre regole lascia la pelle di serie e aggiunge la sua dopo", () => {
    const result = mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );

    expect(result).toEqual({ mounted: true });
    expect(layers()).toEqual(["foglio", "pelle", "pelle-tema"]);
    expect(text("pelle")).toBe(seriesSkin);
    expect(text("pelle-tema")).toBe(THEME_SKIN);
  });

  it("una regola del tema vince su quella di serie a parità di specificità, e ciò che non nomina resta di serie", () => {
    mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    document.body.innerHTML = '<div class="shell-tooltip">a</div><div class="segmented">b</div>';
    const tooltip = document.body.querySelector<HTMLElement>(".shell-tooltip")!;
    const segmented = document.body.querySelector<HTMLElement>(".segmented")!;

    // `.shell-tooltip` ha `white-space: normal` nella serie, `nowrap` nel tema.
    expect(getComputedStyle(tooltip).whiteSpace).toBe("nowrap");
    // Le altre proprietà della stessa regola restano quelle di serie.
    expect(getComputedStyle(tooltip).position).toBe("fixed");
    expect(getComputedStyle(tooltip).pointerEvents).toBe("none");
    // Un componente che il tema non nomina ha lo stile di serie.
    expect(getComputedStyle(segmented).display).toBe("inline-flex");
  });

  it("le preferenze e i frammenti restano dopo ogni pelle", () => {
    const preferences = document.createElement("style");
    preferences.dataset.fub = "preferenze";
    const snippets = document.createElement("style");
    snippets.dataset.fub = "snippets";
    document.head.append(preferences, snippets);

    mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    expect(layers()).toEqual(["foglio", "pelle", "pelle-tema", "preferenze", "snippets"]);

    preferences.remove();
    mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    expect(layers(), "senza preferenze i frammenti restano ultimi").toEqual(["foglio", "pelle", "pelle-tema", "snippets"]);
  });

  it("per un tema che eredita una pelle assente o vuota è il caso normale", () => {
    for (const skin of [undefined, "", "  \n"]) {
      document.head.innerHTML = "";
      const bundle = { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin, assets: {}, inherited: { skin: seriesSkin } };
      expect(validateThemeBundle(bundle, "light")).toEqual([]);
      expect(mountThemeBundle(bundle, "light").mounted).toBe(true);
      expect(layers()).toEqual(["foglio", "pelle"]);
      expect(text("pelle")).toBe(seriesSkin);
    }
    // Chi non eredita e porta una pelle vuota ha ancora perso un file.
    expect(validateThemeBundle({ manifest: SERIES_MANIFEST, sheet: sheetLight, skin: "", assets: {} }, "light"))
      .toContain("fascio: pelle vuota");
  });

  it("la pelle del tema passa lo stesso cancello, e un rifiuto lascia tutto com'era", () => {
    mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    const reports: string[][] = [];
    const result = mountThemeBundle(
      {
        manifest: INHERITING_MANIFEST,
        sheet: sheetLight,
        skin: ".ui-estraneo { color: red; }",
        assets: {},
        inherited: { skin: seriesSkin },
      },
      "light",
      (trouble) => reports.push([...trouble.reasons]),
    );

    expect(result.mounted).toBe(false);
    expect(reports[0]!.join("\n")).toContain("pelle:");
    expect(text("pelle-tema")).toBe(THEME_SKIN);
    expect(text("pelle")).toBe(seriesSkin);
  });

  it("un tema che eredita ed è rifiutato torna alla serie, pulita", () => {
    // È ciò che fa `apply` dopo un rifiuto: rimonta il fascio di serie, che non
    // eredita, e con lui `pelle-tema` se ne va.
    mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    const rejected = mountThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: sheetDark, skin: ".ui-estraneo { color: red; }", assets: {}, inherited: { skin: seriesSkin } },
      "dark",
      () => {},
    );
    expect(rejected.mounted).toBe(false);

    const series = mountThemeBundle({ manifest: SERIES_MANIFEST, sheet: sheetDark, skin: seriesSkin, assets: {} }, "dark");

    expect(series.mounted).toBe(true);
    expect(layers()).toEqual(["foglio", "pelle"]);
    expect(text("foglio")).toBe(sheetDark);
    expect(text("pelle")).toBe(seriesSkin);
  });

  it("il foglio di serie che il tema eredita passa ruoli e contrasti come ogni foglio", () => {
    const broken = sheetLight.replace(/--muted: [^;]+;/, "");
    const reasons = validateThemeBundle(
      { manifest: INHERITING_MANIFEST, sheet: broken, skin: THEME_SKIN, assets: {}, inherited: { skin: seriesSkin } },
      "light",
    );
    expect(reasons.join("\n")).toContain("ruolo --muted mancante");
  });

  it("un tema che dichiara extends senza portare cosa eredita è rifiutato", () => {
    const reasons = validateThemeBundle({ manifest: INHERITING_MANIFEST, sheet: sheetLight, skin: THEME_SKIN, assets: {} }, "light");
    expect(reasons.join("\n")).toContain("fascio: eredita da fub.serie");
  });
});

describe("la shell compone il tema che eredita e non lascia resti", () => {
  beforeAll(async () => {
    system("light");
    const catalog = await themeCatalog();
    expect(catalog.map((info) => info.manifest.id)).toEqual(["acme.carta", "acme.piena"]);
  });

  beforeEach(async () => {
    contrast.high = false;
    system("light");
    document.head.innerHTML = "";
    localStorage.clear();
    await cancelThemePreview();
    await selectTheme(SERIES_THEME_ID, "light");
  });

  it("un tema senza foglio prende quello di serie della stessa luce, con la pelle di serie sotto la sua", async () => {
    await selectTheme("acme.carta", "light");

    expect(currentThemeId()).toBe("acme.carta");
    expect(text("foglio")).toBe(sheetLight);
    expect(text("pelle")).toBe(seriesSkin);
    expect(text("pelle-tema")).toBe(THEME_SKIN);
  });

  it("con il contrasto alto un tema senza foglio usa il foglio di serie del contrasto alto", async () => {
    contrast.high = true;
    system("dark");
    await selectTheme("acme.carta", "dark");

    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(text("foglio")).toBe(sheetDarkHigh);
    expect(text("pelle-tema")).toBe(THEME_SKIN);
  });

  it("«Annulla anteprima» non lascia resti", async () => {
    await previewTheme("acme.carta", "light");
    expect(count("pelle-tema")).toBe(1);

    await cancelThemePreview();

    expect(currentThemeId()).toBe(SERIES_THEME_ID);
    expect(count("pelle-tema")).toBe(0);
    expect(text("pelle")).toBe(seriesSkin);
    expect(text("foglio")).toBe(sheetLight);
  });

  it("la luce che cambia con l'anteprima aperta tiene la pelle del tema sopra quella di serie", async () => {
    await previewTheme("acme.carta", "light");
    await previewTheme("acme.carta", "dark");

    expect(text("foglio")).toBe(sheetDark);
    expect(count("pelle")).toBe(1);
    expect(text("pelle-tema")).toBe(THEME_SKIN);

    await cancelThemePreview();
    expect(count("pelle-tema")).toBe(0);
  });

  it("da un tema che eredita a uno che non eredita e ritorno, nessun canale resta di troppo", async () => {
    await selectTheme("acme.carta", "light");
    await selectTheme("acme.piena", "light");

    expect(text("foglio")).toBe(OWN_SHEET);
    expect(text("pelle")).toBe(OWN_SKIN);
    expect(count("pelle-tema")).toBe(0);

    await selectTheme("acme.carta", "light");
    expect(layers().filter((layer) => layer !== "preferenze")).toEqual(["foglio", "pelle", "pelle-tema"]);
    expect(text("pelle")).toBe(seriesSkin);

    await selectTheme(SERIES_THEME_ID, "light");
    expect(count("pelle-tema")).toBe(0);
  });
});
