import { describe, expect, it, vi } from "vitest";
import { commandProfileStore, defaultProfile, geometryOf, MM, paperColorsOf, paperSize, printSettingsOf, type ExportProfile } from "./profile";
import { layoutChanged } from "./paginate/slices";
import { printTheme } from "./themes";

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

  it("i colori del profilo vanno sulle variabili della carta, e uno scritto male resta quello del tema", () => {
    const profile = { ...defaultProfile(), colori: { testo: "#112233", link: "rosso", carta: "#fafafa" } };
    const colors = paperColorsOf(profile);
    expect(colors["--doc-fg"]).toBe("#112233");
    expect(colors["--text"]).toBe("#112233");
    expect(colors["--doc-bg"]).toBe("#fafafa");
    expect(colors["--doc-link"]).toBe(printTheme("fub").colors.link);
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

describe("i profili salvati, coi comandi del core (T79)", () => {
  const outcome = (ns: string, payload: unknown) => ({ notify: null, effect: { kind: "custom", ns, payload }, undo: null }) as never;

  it("elenca i profili, i predefiniti e quello che vale per la nota", async () => {
    const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) =>
      outcome("fub.pdf.profiles", {
        profiles: [
          { id: "relazione", name: "Relazione", future: false, profile: { versione: 1, nome: "Relazione", tema: "relazione" } },
          { id: "rotto", name: "rotto", future: false, profile: null, error: "…" },
          { id: "", name: "senza id" },
        ],
        vault_default: "relazione",
        type_default: null,
        note_type: { doc: "Tipi/Libro.md", name: "Libro" },
        effective: { id: "relazione", from: "vault" },
      }),
    );
    const shelf = await commandProfileStore(invoke).list("Dune.md");
    expect(invoke).toHaveBeenCalledWith("pdf.profiles", { note: "Dune.md" }, "apply");
    expect(shelf.profiles.map((p) => [p.id, p.profile?.tema ?? null])).toEqual([["relazione", "relazione"], ["rotto", null]]);
    // Ciò che il file non dice viene da «Di serie».
    expect(shelf.profiles[0]?.profile?.pagina).toEqual(defaultProfile().pagina);
    expect(shelf).toMatchObject({ vaultDefault: "relazione", typeDefault: null, noteType: { doc: "Tipi/Libro.md", name: "Libro" }, effective: "relazione" });
  });

  it("un profilo nuovo non porta la versione di quello da cui nasce; uno salvato sopra sì", async () => {
    const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => outcome("fub.pdf.profile", { id: "mio" }));
    const store = commandProfileStore(invoke);
    const future = { ...defaultProfile(), nome: "Mio", versione: 9 } as ExportProfile;
    expect(await store.save(null, future)).toBe("mio");
    const fresh = JSON.parse(String(invoke.mock.calls[0]?.[1]["profile"]));
    expect(fresh.versione).toBeUndefined();
    expect(invoke.mock.calls[0]?.[1]["id"]).toBeUndefined();
    await store.save("mio", future);
    expect(JSON.parse(String(invoke.mock.calls[1]?.[1]["profile"])).versione).toBe(9);
    await store.setDefault("mio", "type", "Dune.md");
    expect(invoke).toHaveBeenLastCalledWith("pdf.profile_default", { id: "mio", scope: "type", note: "Dune.md" }, "apply");
  });
});
