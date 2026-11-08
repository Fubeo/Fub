// @vitest-environment happy-dom
//
// **Le icone del tema** (PA T40), dal lato del tema: il manifest `theme-2`
// nomina un set (`icons: "icons.json"`), il fascio lo porta fra gli asset, il
// cancello ne chiede ogni voce alla regola rispecchiata, e il set cambia nello
// stesso giro dei canali CSS. «Annulla anteprima» e il ritorno alla serie
// tornano alle icone di serie, e le icone già nella pagina si ridisegnano.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeHost, iconSetBytes, iconTheme, fontTheme } from "../host/fake";
import sheetLight from "./scrittoio/sheet-light.css?raw";
import seriesSkin from "./scrittoio/skin.css?raw";
import {
  mountMirroredTheme,
  mountThemeBundle,
  mountedTheme,
  themeIconSet,
  validateThemeBundle,
  type ThemeBundle,
  type ThemeBundleManifest,
} from "./loader";
import { THEME_ICON_LIMITS } from "../rules/mirrored";
import { SCRITTOIO_SERIES } from "./scrittoio/series";
import { icon, themeIcons } from "../ui/icons";

const box = vi.hoisted(() => ({ api: null as unknown }));

const icone = iconTheme("acme.icone");
const caratteri = fontTheme("acme.caratteri");
const fake = createFakeHost({
  themes: [icone.info, caratteri.info],
  themePayloads: { ...icone.payloads, ...caratteri.payloads },
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

function system(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
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

const MANIFEST = icone.info.manifest as ThemeBundleManifest;
const PAYLOAD = icone.payloads["acme.icone:light"]!;
const ASSET = "theme://acme.icone/icons.json";
const SERIES_SEARCH = icon("search");
const SERIES_BUNDLE: ThemeBundle = {
  manifest: SCRITTOIO_SERIES.manifest,
  sheet: sheetLight,
  skin: seriesSkin,
  assets: {},
};

function bundle(overrides: { icons?: unknown; assets?: Record<string, unknown> } = {}): ThemeBundle {
  return {
    manifest: "icons" in overrides ? ({ ...MANIFEST, icons: overrides.icons } as ThemeBundleManifest) : MANIFEST,
    sheet: sheetLight,
    skin: PAYLOAD.skin ?? undefined,
    assets: overrides.assets ?? PAYLOAD.assets,
    inherited: { skin: seriesSkin },
  };
}

function iconReasons(overrides: Parameters<typeof bundle>[0]): string[] {
  return validateThemeBundle(bundle(overrides), "light").filter((reason) => reason.startsWith("icone"));
}

function searchPath(): string | null {
  return document.querySelector('svg[data-icon="search"] path')?.getAttribute("d") ?? null;
}

describe("il cancello legge il set di icone del fascio", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    expect(mountThemeBundle(SERIES_BUNDLE, "light")).toEqual({ mounted: true });
  });

  it("un set che regge passa, e il loader lo legge com'è", () => {
    expect(iconReasons({})).toEqual([]);
    expect(themeIconSet(MANIFEST, PAYLOAD.assets)).toEqual(icone.set);
  });

  it("ripete i controlli dell'host sul fascio, che resta non fidato", () => {
    const withSet = (set: unknown) => ({ assets: { [ASSET]: [...new TextEncoder().encode(JSON.stringify(set))] } });

    expect(iconReasons(withSet({ search: ['M0 0"/><script>alert(1)</script><path d="'] })).join()).toContain("comandi e numeri");
    expect(iconReasons(withSet({ search: ["M0 0<"] })).join()).toContain("comandi e numeri");
    expect(iconReasons(withSet({ Search: ["M0 0h1"] })).join()).toContain("lettere minuscole");
    expect(iconReasons(withSet({ search: [] })).join()).toContain("da 1 a 8 tracciati");
    expect(iconReasons(withSet({ search: Array.from({ length: 9 }, () => "M0 0h1") })).join()).toContain("da 1 a 8 tracciati");
    expect(iconReasons(withSet({ search: ["M".repeat(THEME_ICON_LIMITS.icon_bytes + 1)] })).join()).toContain(
      `superano ${THEME_ICON_LIMITS.icon_bytes} byte`,
    );
    const many = Object.fromEntries(Array.from({ length: 513 }, (_, n) => [`icona-${n}`, ["M0 0h1"]]));
    expect(iconReasons(withSet(many)).join()).toContain("513 ridisegnate, al massimo 512");
    expect(iconReasons(withSet(["search"])).join()).toContain("non è un oggetto");

    expect(iconReasons({ assets: { [ASSET]: [...new TextEncoder().encode("{ non è json")] } }).join()).toContain("non è JSON");
    expect(iconReasons({ assets: { [ASSET]: [0xff, 0xfe, 0x7b, 0x7d] } }).join()).toContain("non è JSON in UTF-8");
    expect(iconReasons({ assets: {} }).join()).toContain("manca dal fascio");
    expect(iconReasons({ icons: "manifest.json" }).join()).toContain("<nome>.json");
    expect(iconReasons({ icons: "../icons.json" }).join()).toContain("<nome>.json");
    const big = { [ASSET]: iconSetBytes({ search: ["M".repeat(THEME_ICON_LIMITS.set_bytes)] }) };
    expect(iconReasons({ assets: big }).join()).toContain(`supera ${THEME_ICON_LIMITS.set_bytes} byte`);
  });

  it("un nome che oggi nessuno disegna non rifiuta il tema", () => {
    expect(icone.set).toHaveProperty("modulo-spento");
    expect(iconReasons({})).toEqual([]);
  });

  it("un fascio rifiutato lascia il set di prima", () => {
    expect(mountThemeBundle(bundle(), "light")).toEqual({ mounted: true });
    expect(themeIcons()).toEqual(icone.set);

    const bad = { [ASSET]: iconSetBytes({ search: ["M0 0<"] }) };
    const rejected = mountThemeBundle(bundle({ assets: bad }), "light", () => {});
    expect(rejected.mounted).toBe(false);
    expect(themeIcons()).toEqual(icone.set);
  });

  it("la finestra di un documento rispecchia il set, ripassandolo dalla regola", () => {
    mountThemeBundle(bundle(), "light");
    const mirrored = mountedTheme();
    expect(mirrored.icons).toEqual(icone.set);

    expect(mountThemeBundle(SERIES_BUNDLE, "light")).toEqual({ mounted: true });
    mountMirroredTheme(mirrored);
    expect(themeIcons()).toEqual(icone.set);

    mountMirroredTheme({ ...mirrored, icons: { search: ['M0"/><script>'] } });
    expect(themeIcons()).toEqual({});
    mountMirroredTheme(mirrored);
    mountMirroredTheme({ ...mirrored, icons: undefined });
    expect(themeIcons()).toEqual({});
  });
});

describe("la shell monta le icone del tema e torna alla serie", () => {
  beforeAll(async () => {
    system();
    const catalog = await themeCatalog();
    expect(catalog.map((info) => info.manifest.id)).toEqual(["acme.icone", "acme.caratteri"]);
  });

  beforeEach(async () => {
    system();
    document.head.innerHTML = "";
    document.body.innerHTML = `<button>${icon("search")}</button>`;
    localStorage.clear();
    await cancelThemePreview();
    await selectTheme(SERIES_THEME_ID, "light");
  });

  it("scelto il tema, le icone già nella pagina hanno la sua figura", async () => {
    expect(searchPath()).toBe("M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z");
    await selectTheme("acme.icone", "light");

    expect(currentThemeId()).toBe("acme.icone");
    expect(searchPath()).toBe(icone.set.search![0]);
    expect(icon("vault")).toContain(icone.set.folder![0]);
  });

  it("«Annulla anteprima» torna alla serie", async () => {
    await previewTheme("acme.icone", "light");
    expect(searchPath()).toBe(icone.set.search![0]);

    await cancelThemePreview();

    expect(currentThemeId()).toBe(SERIES_THEME_ID);
    expect(themeIcons()).toEqual({});
    expect(icon("search")).toBe(SERIES_SEARCH);
    expect(searchPath()).not.toBe(icone.set.search![0]);
  });

  it("il ritorno alla serie e il cambio di tema tornano alle icone di serie", async () => {
    await selectTheme("acme.icone", "light");
    await selectTheme("acme.caratteri", "light");
    expect(themeIcons()).toEqual({});
    expect(icon("search")).toBe(SERIES_SEARCH);

    await selectTheme("acme.icone", "light");
    await selectTheme(SERIES_THEME_ID, "light");
    expect(themeIcons()).toEqual({});
    expect(searchPath()).not.toBe(icone.set.search![0]);
  });
});
