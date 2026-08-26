// @vitest-environment happy-dom
//
// **Il cancello dei temi** (§29.2, §29.3): un fascio si monta solo se passa
// ogni cancello, e un rifiuto lascia il tema precedente attivo e si dice
// come Trouble, non come console.warn.
//
// Il caricatore (`theme/loader.ts`) valida l'intero fascio — manifest, foglio,
// pelle, asset — e solo a cancello verde sostituisce i due strati in una sola
// commit atomica (`replaceTheme`). I motivi di rifiuto sono una lista: nessun
// cancello accorcia il report del successivo, e ognuno nomina ciò che è
// sbagliato — il ruolo mancante, l'hook sconosciuto, la coppia di contrasto
// caduta sotto la soglia AA.
//
// I fogli qui sotto sono quelli veri di serie (`?raw`), mutati da una riga:
// è il dogfooding del contratto — la serie passa dallo stesso cancello di
// un tema di terzi — e una mutazione mirata fa cadere **un** cancello solo,
// senza dover riscrivere a mano l'inventario dei ruoli obbligatori.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_ENGINE } from "../host/contract";
import { clearHistory, recentNotices, type ThemeTrouble } from "../ui/notify";
import sheetLight from "./serie/sheet-light.css?raw";
import sheetDark from "./serie/sheet-dark.css?raw";
import sheetLightHigh from "./serie/sheet-light-high.css?raw";
import sheetDarkHigh from "./serie/sheet-dark-high.css?raw";
import skin from "./serie/skin.css?raw";
import benchManifest from "../../theme/author/sample/manifest.json";
import benchSheet from "../../theme/author/sample/sheet-light.css?raw";
import benchSkin from "../../theme/author/sample/skin.css?raw";
import {
  count,
  mountThemeBundle,
  validateThemeBundle,
  THEME_MOTION,
  type ThemeBundleManifest,
  type ThemeMountResult,
} from "./loader";

const SERIES_MANIFEST: ThemeBundleManifest = {
  id: "fub.serie",
  name: "Fub di serie",
  version: "1.0.0",
  engine: THEME_ENGINE,
  lights: ["dark", "light"],
  asset_namespace: "theme://fub.serie/",
  motion: THEME_MOTION,
};

function bundle(sheet: string, skinText?: string) {
  return { manifest: SERIES_MANIFEST, sheet, skin: skinText, assets: {} };
}

beforeEach(() => {
  document.head.innerHTML = "";
});

describe("il cancello monta solo ciò che è valido", () => {
  it("il tema banco non-serie passa dalla stessa porta", () => {
    const result = mountThemeBundle(
      { manifest: benchManifest, sheet: benchSheet, skin: benchSkin, assets: {} },
      "light",
    );

    expect(result.mounted).toBe(true);
    expect(document.head.querySelector('style[data-fub="foglio"]')?.textContent).toBe(benchSheet);
  });

  it("un tema valido monta foglio e pelle in una sola commit", () => {
    const result = mountThemeBundle(bundle(sheetLight, skin), "light");

    expect(result.mounted).toBe(true);
    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);
    expect(document.head.querySelector('style[data-fub="foglio"]')?.textContent).toBe(sheetLight);
    expect(document.head.querySelector('style[data-fub="pelle"]')?.textContent).toBe(skin);
  });

  it("due mount consecutivi lasciano un solo foglio e una sola pelle", () => {
    // Il montaggio è per sostituzione anche attraverso il cancello: il primo
    // fascio cede il posto al secondo, e nessun canale ne accatasta due.
    mountThemeBundle(bundle(sheetLight, skin), "light");
    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);

    mountThemeBundle(bundle(sheetDark, skin), "dark");

    expect(count("foglio"), "il secondo mount sostituisce, non accatasta").toBe(1);
    expect(count("pelle")).toBe(1);
    expect(document.head.querySelector('style[data-fub="foglio"]')?.textContent).toBe(sheetDark);
  });

  it("la serie passa dal validatore in tutte e quattro le varianti", () => {
    // Dogfooding: i fogli di serie non sono codificati nell'app — passano dal
    // cancello come un tema di terzi, e questo banco lo dice a ogni variante.
    for (const [light, sheet] of [
      ["light", sheetLight],
      ["dark", sheetDark],
      ["light", sheetLightHigh],
      ["dark", sheetDarkHigh],
    ] as const) {
      const reasons = validateThemeBundle(bundle(sheet, skin), light);
      expect(reasons, `${light} deve passare il cancello senza motivi`).toEqual([]);
    }
  });
});

describe("un rifiuto nomina la ragione, lascia il tema precedente e si dice come Trouble", () => {
  function rejected(
    sheet: string,
    report: (trouble: ThemeTrouble) => void,
    light: "light" | "dark" = "light",
  ): ThemeMountResult {
    return mountThemeBundle(bundle(sheet, skin), light, report);
  }

  it("un ruolo mancante rifiuta nominandolo, e lascia lo stato intatto", () => {
    const sheet = sheetLight.replace(/--muted: [^;]+;/, "");
    const troubles: ThemeTrouble[] = [];
    const report = (trouble: ThemeTrouble) => troubles.push(trouble);

    const result = rejected(sheet, report);

    expect(result.mounted).toBe(false);
    expect(troubles).toHaveLength(1);
    expect(troubles[0].theme).toBe("Fub di serie");
    expect(troubles[0].reasons.join("\n")).toContain("ruolo --muted mancante");
    expect(count("foglio"), "un foglio rifiutato non si monta").toBe(0);
    expect(count("pelle"), "la pelle del fascio rifiutato non si monta").toBe(0);
  });

  it("un hook fuori dal vocabolario rifiuta nominandolo", () => {
    const sheet = `${sheetLight}\n.ui-estraneo { color: var(--text); }`;
    const troubles: ThemeTrouble[] = [];

    const result = rejected(sheet, (trouble) => troubles.push(trouble));

    expect(result.mounted).toBe(false);
    expect(troubles[0].reasons.join("\n")).toContain("hook .ui-estraneo non dichiarato");
  });

  it("un contrasto caduto sotto la soglia AA rifiuta nominando la coppia", () => {
    // `--muted` torna quasi del colore del fondo: la coppia `--muted` su
    // `--bg` (il corpo dell'app) scende sotto 4.5:1 e il cancello lo dice.
    const sheet = sheetLight.replace(/--muted: [^;]+;/, "--muted: #d4d4da;");
    const troubles: ThemeTrouble[] = [];

    const result = rejected(sheet, (trouble) => troubles.push(trouble));

    expect(result.mounted).toBe(false);
    expect(troubles[0].reasons.join("\n")).toContain("contrasto: --muted su --bg");
  });

  it("un rifiuto lascia attivo il tema precedente, strato per strato", () => {
    // Il fascio nuovo è rifiutato: foglio e pelle restano quelli del fascio
    // precedente — la sostituzione avviene solo a cancello verde.
    const first = mountThemeBundle(bundle(sheetLight, skin), "light");
    expect(first.mounted).toBe(true);

    const sheet = sheetLight.replace(/--muted: [^;]+;/, "");
    const second = rejected(sheet, () => {});

    expect(second.mounted).toBe(false);
    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);
    expect(document.head.querySelector('style[data-fub="foglio"]')?.textContent).toBe(sheetLight);
    expect(document.head.querySelector('style[data-fub="pelle"]')?.textContent).toBe(skin);
  });

  it("un rifiuto è un Trouble via notify, e non un console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      clearHistory();
      const sheet = sheetLight.replace(/--muted: [^;]+;/, "");
      const result = mountThemeBundle(bundle(sheet, skin), "light");

      expect(result.mounted).toBe(false);
      expect(warn, "il cancello non parla per console").not.toHaveBeenCalled();
      const notice = recentNotices()[0];
      expect(notice).toBeDefined();
      expect(notice.text).toContain("Tema «Fub di serie» rifiutato");
      expect(notice.text).toContain("ruolo --muted mancante");
      expect(notice.tone).toBe("guasto");
    } finally {
      warn.mockRestore();
    }
  });
});
