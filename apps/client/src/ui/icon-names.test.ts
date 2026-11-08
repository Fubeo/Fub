// @vitest-environment happy-dom
//
// **I nomi che un tema può ridisegnare** (PA T40). Un tema ridisegna per nome
// le icone che ci sono: la serie di `ui/icons.ts` e quelle che i moduli
// registrano quando si montano. L'elenco sta in
// `theme/author/icon-names.json`, e il README del kit autore lo riporta
// (`npm run theme:generate`). Questa prova monta ogni registrazione, chiede i
// nomi a `iconNames()` e pretende che l'elenco sia quello: un'icona nuova, o
// rinominata, non cambia in silenzio ciò che i temi possono ridisegnare.
import { afterEach, describe, expect, it } from "vitest";

import names from "../../theme/author/icon-names.json";
import { iconNames } from "./icons";
import { openLifetime } from "./lifetime";
import { THEME_ICON_LIMITS, themeIconFault } from "../rules/mirrored";
import { mountFrameIcons } from "../shells/scrittoio/icons";
import { ensureDrawIcons } from "../editors/spatial/icons";
import { useRichIcons } from "../editors/rich/icons";
import { useRibbonIcons } from "../editors/grid/ribbon/icons";
import { registerFormatIcons } from "../panels/format-bar";
import { createColorPicker, type ColorPickerText } from "../kit/color/picker";

/// I moduli che chiamano `registerIcon`, e la prova li monta tutti qui sopra.
/// Un modulo nuovo che registra icone va aggiunto alla prova e all'elenco.
const REGISTRARS = [
  "../shells/scrittoio/icons.ts",
  "../editors/spatial/icons.ts",
  "../editors/rich/icons.ts",
  "../editors/grid/ribbon/icons.ts",
  "../panels/format-bar.ts",
  "../kit/color/picker.ts",
];

const sources = import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const TEXT: ColorPickerText = {
  area: "area",
  areaValue: () => "area",
  hue: "hue",
  alpha: "alpha",
  format: "format",
  formats: { hex: "hex", rgb: "rgb", hsl: "hsl", oklch: "oklch" },
  code: "code",
  invalid: "invalid",
  eyedropper: "eyedropper",
  recommended: "recommended",
  documentColors: "documentColors",
  recent: "recent",
  theme: "theme",
  none: "none",
};

const life = openLifetime();
afterEach(() => document.body.replaceChildren());

describe("i nomi che un tema può ridisegnare", () => {
  it("sono quelli dell'elenco del kit autore, con ogni registrazione montata", () => {
    mountFrameIcons(life);
    ensureDrawIcons();
    life.add(useRichIcons());
    life.add(useRibbonIcons());
    life.add(registerFormatIcons());
    createColorPicker({
      value: "#000000",
      text: TEXT,
      eyedropper: async () => null,
      onChange: () => {},
      lifetime: life,
    });

    const drawn = [...new Set(iconNames())].sort();
    expect(
      drawn,
      `aggiorna theme/author/icon-names.json, poi npm run theme:generate:\n${JSON.stringify(drawn, null, 2)}`,
    ).toEqual(names);
    life.close();
  });

  it("ogni nome si può ridisegnare, e ci stanno tutti in un set", () => {
    for (const name of names) expect(themeIconFault(name, ["M0 0h1"]), name).toBeNull();
    expect(names.length).toBeLessThanOrEqual(THEME_ICON_LIMITS.icons);
  });

  it("chi registra icone è fra i moduli che la prova monta", () => {
    const callers = Object.entries(sources)
      .filter(([path]) => path !== "./icons.ts" && !/\.test\.ts$/.test(path))
      .filter(([, text]) => /\bregisterIcon\(/.test(text))
      .map(([path]) => path)
      .sort();
    expect(callers).toEqual([...REGISTRARS].sort());
  });
});
