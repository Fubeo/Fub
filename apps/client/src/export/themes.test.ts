// @vitest-environment happy-dom
// I temi di stampa (T71): otto temi coi loro colori e il loro testo, i tuoi
// colori sopra, il contrasto, il bianco e nero e il risparmio d'inchiostro,
// e un colore che cambia solo le variabili dell'aspetto.

import { describe, expect, it } from "vitest";
import { layoutChanged } from "./paginate/slices";
import { defaultProfile, printSettingsOf, PRINT_THEMES, type ExportProfile } from "./profile";
import {
  contrast,
  contrastOf,
  grayOf,
  lookVariables,
  numberHeadings,
  ownCount,
  PAGE_COLORS,
  pageColorsOf,
  PALETTES,
  parseColor,
  printTheme,
  textOf,
  THEME_IDS,
  typeVariables,
  withColor,
  withoutOwn,
} from "./themes";

function profile(change: Partial<ExportProfile> = {}): ExportProfile {
  return { ...defaultProfile(), ...change };
}

describe("i temi di stampa", () => {
  it("sono gli otto del core, nello stesso ordine, ognuno con gli undici colori scritti bene", () => {
    expect(THEME_IDS).toEqual([...PRINT_THEMES]);
    for (const id of THEME_IDS) {
      const theme = printTheme(id);
      expect(Object.keys(theme.colors)).toEqual([...PAGE_COLORS]);
      for (const value of Object.values(theme.colors)) expect(parseColor(value)).toBe(value);
    }
    for (const palette of Object.values(PALETTES)) for (const value of palette) expect(parseColor(value)).toBe(value);
  });

  it("ogni tema regge il contrasto che chiede alle tue scelte", () => {
    for (const id of THEME_IDS) {
      const report = contrastOf(printTheme(id).colors);
      expect(report.textLow, id).toBe(false);
      expect(report.accentLow, id).toBe(false);
    }
  });

  it("un tema che questa versione non conosce è Fub", () => {
    expect(printTheme("futuro")).toBe(printTheme("fub"));
    expect(pageColorsOf(profile({ tema: "futuro" }))).toEqual(printTheme("fub").colors);
  });

  it("il tema decide caratteri e impostazione, finché non decidi tu", () => {
    expect(textOf(profile({ tema: "rivista" }))).toMatchObject({ colonne: 2, giustificato: true, corpo: 10, scala_titoli: 1.36 });
    expect(textOf(profile({ tema: "relazione" }))).toMatchObject({ carattere_testo: "hanken", titoli_numerati: true, corpo: 10.5 });
    expect(textOf(profile({ tema: "classico" }))).toMatchObject({ paragrafi: "rientro", allineamento_titoli: "centro" });
    const mine = profile({ tema: "rivista", testo: { sillabazione: true, colonne: 1, corpo: 12, carattere_testo: "sconosciuto" } });
    expect(textOf(mine)).toMatchObject({ colonne: 1, corpo: 12, carattere_testo: "newsreader" });
    expect(printSettingsOf(profile({ tema: "rivista" })).layout.columns).toBe(2);
    expect(printSettingsOf(mine).layout.columns).toBe(1);
  });

  it("le variabili del testo: il corpo in pixel, la scala dei titoli, il rientro e i numeri", () => {
    const vars = typeVariables(profile({ tema: "classico" }));
    expect(vars["--text-reading"]).toBe("14.667px");
    expect(vars["--print-h2"]).toBe("1.44em");
    expect(vars["--print-text-align"]).toBe("justify");
    expect(vars["--print-heading-align"]).toBe("center");
    expect(vars["--print-indent"]).toBe("1.5em");
    expect(vars["--print-heading-numbers"]).toBe("none");
    expect(typeVariables(profile({ tema: "relazione" }))["--print-heading-numbers"]).toBe("inline");
  });

  it("cambiare tema rifà l'impaginazione solo se il tema cambia le misure", () => {
    const fub = printSettingsOf(profile());
    expect(layoutChanged(fub.layout, printSettingsOf(profile({ tema: "notte" })).layout)).toBe(false);
    expect(layoutChanged(fub.layout, printSettingsOf(profile({ tema: "rivista" })).layout)).toBe(true);
  });
});

describe("i colori della pagina", () => {
  it("un colore cambia solo le variabili dell'aspetto, mai le misure", () => {
    const before = printSettingsOf(profile());
    for (const key of PAGE_COLORS) {
      const after = printSettingsOf(withColor(profile(), key, "#123456"));
      expect(layoutChanged(before.layout, after.layout), key).toBe(false);
      expect(after.layout.type).toEqual(before.layout.type);
      expect(after.look.colors).not.toEqual(before.look.colors);
    }
    const gray = printSettingsOf(profile({ inchiostro: { bianco_e_nero: true, risparmio: false } }));
    const save = printSettingsOf(profile({ inchiostro: { bianco_e_nero: false, risparmio: true } }));
    expect(layoutChanged(before.layout, gray.layout)).toBe(false);
    expect(layoutChanged(before.layout, save.layout)).toBe(false);
  });

  it("ogni colore va sulle sue variabili, e sostituisce i colori dell'app che la resa legge", () => {
    const vars = lookVariables(withColor(withColor(profile(), "accento", "#aa0000"), "riquadri", "#eeeeff"));
    expect(vars["--print-accent"]).toBe("#aa0000");
    expect(vars["--accent"]).toBe("#aa0000");
    expect(vars["--print-callout"]).toBe("#eeeeff");
    const theme = printTheme("fub").colors;
    expect(vars["--doc-bg"]).toBe(theme.carta);
    expect(vars["--sheet-2"]).toBe(theme.codice);
    expect(vars["--border"]).toBe(theme.linee);
    expect(vars["--print-table-head"]).toBe(theme["intestazioni-tabella"]);
    expect(vars["--print-callout-edge"]).toBe("transparent");
    expect(vars["--print-filter"]).toBeUndefined();
  });

  it("i tuoi colori restano cambiando tema", () => {
    const mine = withColor(profile({ tema: "fub" }), "titoli", "#880000");
    const quaderno = { ...mine, tema: "quaderno" };
    expect(pageColorsOf(quaderno).titoli).toBe("#880000");
    expect(pageColorsOf(quaderno).carta).toBe(printTheme("quaderno").colors.carta);
    // L'anteprima di un altro tema tiene i tuoi colori sopra.
    expect(pageColorsOf(mine, "notte").titoli).toBe("#880000");
  });

  it("un colore scritto male resta quello del tema; scritto a mano si legge come il core", () => {
    expect(parseColor("#ABC")).toBe("#aabbcc");
    expect(parseColor(" #1F4F8F ")).toBe("#1f4f8f");
    expect(parseColor("1f4f8f")).toBe("#1f4f8f");
    for (const bad of ["", "#12", "#12345", "#1234567", "rosso", "#ggg000", "rgb(0,0,0)"]) expect(parseColor(bad), bad).toBeNull();
    const broken = profile({ colori: { testo: "rosso", link: "#12" } });
    expect(pageColorsOf(broken).testo).toBe(printTheme("fub").colors.testo);
    expect(pageColorsOf(broken).link).toBe(printTheme("fub").colors.link);
  });

  it("«tuo» si conta e si toglie: uno per uno o tutti", () => {
    const mine = withColor(withColor(profile({ testo: { sillabazione: false, corpo: 12 } }), "testo", "#000000"), "carta", "#fafafa");
    expect(ownCount(mine)).toBe(3);
    const one = withColor(mine, "carta", null);
    expect(one.colori).toEqual({ testo: "#000000" });
    const none = withoutOwn(mine);
    expect(ownCount(none)).toBe(0);
    // La sillabazione non è del tema: resta.
    expect(none.testo.sillabazione).toBe(false);
  });
});

describe("il contrasto", () => {
  it("si calcola come WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("avvisa sotto 4,5 a 1 per il testo e sotto 3 a 1 per l'accento, a ogni colore", () => {
    const fine = contrastOf(pageColorsOf(profile()));
    expect(fine.textLow).toBe(false);
    const pale = contrastOf(pageColorsOf(withColor(profile(), "testo", "#999999")));
    expect(pale.textLow).toBe(true);
    expect(pale.accentLow).toBe(false);
    const accent = contrastOf(pageColorsOf(withColor(profile(), "accento", "#bbbbbb")));
    expect(accent.textLow).toBe(false);
    expect(accent.accentLow).toBe(true);
    // Il confine: 4,5 esatto non avvisa.
    expect(contrastOf({ ...printTheme("fub").colors, testo: "#767676", carta: "#ffffff" }).textLow).toBe(false);
  });
});

describe("bianco e nero, risparmio d'inchiostro, carta scura", () => {
  it("il bianco e nero fa grigio ogni colore, e anche ciò che i colori non raggiungono", () => {
    const gray = profile({ inchiostro: { bianco_e_nero: true, risparmio: false } });
    for (const value of Object.values(pageColorsOf(gray))) expect(value).toBe(grayOf(value));
    const vars = lookVariables(gray);
    // Un diagramma colorato, le immagini, i colori scritti nella nota.
    expect(vars["--print-filter"]).toBe("grayscale(1)");
    expect(vars["--doc-color-red"]).toBe(grayOf(vars["--doc-color-red"]));
  });

  it("il risparmio d'inchiostro: carta bianca, niente fondi, e la Notte diventa leggibile", () => {
    const save = pageColorsOf(profile({ tema: "notte", inchiostro: { bianco_e_nero: false, risparmio: true } }));
    expect(save.carta).toBe("#ffffff");
    expect(save.riquadri).toBe("#ffffff");
    expect(save.testo).toBe("#111111");
    expect(contrastOf(save).textLow).toBe(false);
    const vars = lookVariables(profile({ inchiostro: { bianco_e_nero: false, risparmio: true } }));
    // Un fondo uguale alla carta prende il filo delle linee.
    expect(vars["--print-callout-edge"]).toBe(printTheme("fub").colors.linee);
    expect(vars["--print-code-edge"]).toBe(printTheme("fub").colors.linee);
  });

  it("la Notte all'esportazione: carta scura col codice e il testo colorato chiari", () => {
    const night = lookVariables(profile({ tema: "notte" }));
    const day = lookVariables(profile());
    expect(night["--doc-bg"]).toBe("#131c16");
    expect(contrast(night["--syn-keyword"], night["--doc-bg"])).toBeGreaterThan(4.5);
    expect(contrast(night["--doc-color-blue"], night["--doc-bg"])).toBeGreaterThan(4.5);
    expect(night["--syn-keyword"]).not.toBe(day["--syn-keyword"]);
  });
});

describe("i titoli numerati", () => {
  it("numerano tre livelli dal più alto che la nota usa", () => {
    const root = document.createElement("article");
    root.innerHTML = '<h1>Nota</h1><div class="markdown-rendered"><h2>A</h2><h3>a</h3><h3>b</h3><h4>x</h4><h5>oltre</h5><h2>B</h2><h3>c</h3></div>';
    numberHeadings(root);
    const numbers = [...root.querySelectorAll(".markdown-rendered :is(h2, h3, h4, h5)")].map((h) => h.getAttribute("data-print-number"));
    expect(numbers).toEqual(["1", "1.1", "1.2", "1.2.1", null, "2", "2.1"]);
    // Il titolo della pagina non è della nota.
    expect(root.querySelector("h1")?.hasAttribute("data-print-number")).toBe(false);
    numberHeadings(root);
    expect(root.querySelector("h3")?.getAttribute("data-print-number")).toBe("1.1");
  });
});
