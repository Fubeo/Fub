import { describe, expect, it } from "vitest";
import { PRINT_PAPER } from "../editors/media/print-view";
import { defaultProfile, geometryOf, MM, paperColorsOf, paperSize, printSettingsOf, type ExportProfile } from "./profile";
import { layoutChanged } from "./paginate/slices";

function withPage(page: Partial<ExportProfile["pagina"]>): ExportProfile {
  const profile = defaultProfile();
  return { ...profile, pagina: { ...profile.pagina, ...page } };
}

describe("il profilo dell'esportazione dal lato della vista", () => {
  it("di serie è A4 verticale coi margini 25/22/25/22 mm, come Profilo::di_serie", () => {
    const profile = defaultProfile();
    expect(profile.nome).toBe("Di serie");
    expect(profile.tema).toBe("fub");
    expect(paperSize(profile.pagina)).toEqual([210, 297]);
    const geometry = geometryOf(profile.pagina);
    expect(geometry.width).toBeCloseTo(210 * MM, 1);
    expect(geometry.height).toBeCloseTo(297 * MM, 1);
    expect(geometry.margin.top).toBeCloseTo(25 * MM, 1);
    expect(geometry.margin.left).toBeCloseTo(22 * MM, 1);
  });

  it("orizzontale gira il foglio; una misura propria che non regge torna A4", () => {
    expect(paperSize(withPage({ formato: "A5", orizzontale: true }).pagina)).toEqual([210, 148]);
    expect(paperSize(withPage({ formato: "proprio", misura_propria: [100, 150] }).pagina)).toEqual([100, 150]);
    expect(paperSize(withPage({ formato: "proprio", misura_propria: [0, 150] }).pagina)).toEqual([210, 297]);
    expect(paperSize(withPage({ formato: "B5-sconosciuto" }).pagina)).toEqual([210, 297]);
  });

  it("i colori del profilo vanno sulle variabili della carta, e uno scritto male non entra", () => {
    const profile = { ...defaultProfile(), colori: { testo: "#112233", link: "rosso", carta: "#fafafa" } };
    const colors = paperColorsOf(profile);
    expect(colors["--doc-fg"]).toBe("#112233");
    expect(colors["--text"]).toBe("#112233");
    expect(colors["--doc-bg"]).toBe("#fafafa");
    expect(colors["--doc-link"]).toBe(PRINT_PAPER["--doc-link"]);
  });

  it("un colore cambia solo l'aspetto; la pagina e le interruzioni rifanno l'impaginazione", () => {
    const base = printSettingsOf(defaultProfile());
    const colored = printSettingsOf({ ...defaultProfile(), colori: { testo: "#000000" } });
    expect(layoutChanged(base.layout, colored.layout)).toBe(false);
    expect(colored.look.colors["--doc-fg"]).toBe("#000000");
    const landscape = printSettingsOf(withPage({ orizzontale: true }));
    expect(layoutChanged(base.layout, landscape.layout)).toBe(true);
    const breaks = printSettingsOf({ ...defaultProfile(), interruzioni: { ...defaultProfile().interruzioni, ogni_titolo_2: true } });
    expect(breaks.layout.breaks.everyHeading2).toBe(true);
    expect(layoutChanged(base.layout, breaks.layout)).toBe(true);
    const columns = printSettingsOf({ ...defaultProfile(), testo: { sillabazione: true, colonne: 2 } });
    expect(columns.layout.columns).toBe(2);
  });
});
