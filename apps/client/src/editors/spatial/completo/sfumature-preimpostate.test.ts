// Le sfumature preimpostate del motore (K6 T15, giro 6): la porta legge l'elenco, salva col lato
// davanti e lo rimette, toglie una salvata; un rifiuto del motore è «vuoto», un motore che non c'è è
// «assente». I nomi delle 55 preimpostate del motore si mostrano tutti nella lingua; una salvata col
// suo nome. Il nome per salvare non è mai vuoto né già preso, senza badare alle maiuscole.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { nomeDelTema, nomeDellaPreimpostata } from "./sfumature-nomi";
import { creaPortaPreimpostate, preimpostateDi, problemaDelNome } from "./sfumature-preimpostate";

/// I nomi che il motore dà alle sue preimpostate (`gradient.presets.list`, come nei casi di
/// `crates/fub-disegno/tests/famiglie/aspetto.json`).
const DEL_MOTORE = [
  "Spectrum", "Soft Spectrum", "Red to Amber", "Orange to Yellow", "Amber to Lime", "Yellow to Green", "Lime to Teal",
  "Green to Cyan", "Teal to Azure", "Cyan to Blue", "Azure to Violet", "Blue to Magenta", "Violet to Red", "Magenta to Orange",
  "Dawn", "Noon", "Sunset", "Dusk", "Night", "Overcast", "White to Black", "Light Grays", "Dark Grays", "Warm Grays",
  "Cool Grays", "Fade to Transparent", "White Fade", "Vignette", "Coral and Navy", "Plum and Lime", "Teal and Gold",
  "Indigo and Peach", "Forest and Rose", "Red Glow", "Orange Glow", "Amber Glow", "Yellow Glow", "Lime Glow", "Green Glow",
  "Teal Glow", "Cyan Glow", "Azure Glow", "Blue Glow", "Violet Glow", "Magenta Glow", "Gold", "Silver", "Bronze", "Copper",
  "Brass", "Chrome", "Rose Gold", "Gunmetal", "Platinum", "Pewter",
];

const LETTURA = {
  presets: [
    {
      name: "Dawn",
      library: "Sky Gradients",
      builtIn: true,
      gradient: { kind: "linear", angle: 0, stops: [{ offset: 0, color: [1, 0.5, 0], opacity: 1, midpoint: 0.5 }, { offset: 1, color: [0, 0, 1], opacity: 0.25, midpoint: 0.5 }] },
    },
    {
      name: "Mare",
      library: null,
      builtIn: false,
      gradient: { kind: "radial", angle: 0, stops: [{ offset: 0, color: [0, 0, 0], opacity: 1 }, { offset: 1, color: [1, 1, 1], opacity: 1 }] },
    },
    // Una riga che non si legge (un punto solo) si salta.
    { name: "Rotta", library: null, builtIn: false, gradient: { kind: "linear", stops: [{ offset: 0, color: [0, 0, 0], opacity: 1 }] } },
  ],
};

function esito(reading: unknown, refused: string | null = null) {
  return { revision: "1", preview: null, ops: "[]", selection: [], losses: [], refused, frame: null, reading };
}

/// Un motore finto che risponde a ogni comando con `risposte[id]`.
function motoreFinto(risposte: Record<string, unknown>) {
  const comando = vi.fn((passo: { id: string }) => Promise.resolve(risposte[passo.id] ?? esito(null)));
  const sessione = { comando } as unknown as SessioneMotore;
  const motore = { pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

const pronta = { famiglia: vi.fn(() => Promise.resolve({ kind: "pronta" as const })) } as never;

describe("le sfumature preimpostate", () => {
  it("l'elenco converte i colori del motore e salta le righe che non si leggono", () => {
    const elenco = preimpostateDi(LETTURA);
    expect(elenco.map((p) => p.nome)).toEqual(["Dawn", "Mare"]);
    expect(elenco[0]).toMatchObject({ tema: "Sky Gradients", delMotore: true, tipo: "linear" });
    expect(elenco[0]!.punti).toEqual([
      { offset: 0, color: "#ff8000", opacity: 1 },
      { offset: 1, color: "#0000ff", opacity: 0.25 },
    ]);
    expect(elenco[1]).toMatchObject({ tema: null, delMotore: false, tipo: "radial" });
    expect(preimpostateDi(null)).toEqual([]);
  });

  it("ogni preimpostata del motore ha un nome nella lingua; una salvata resta com'è", () => {
    const nomi = DEL_MOTORE.map((nome) => nomeDellaPreimpostata(nome, true));
    for (const [i, nome] of nomi.entries()) expect(nome, DEL_MOTORE[i]).not.toBe(DEL_MOTORE[i]);
    expect(new Set(nomi).size).toBe(DEL_MOTORE.length);
    expect(nomeDellaPreimpostata("Dawn", true)).toBe("Alba");
    expect(nomeDellaPreimpostata("Red to Amber", true)).toBe("Da rosso ad ambra");
    expect(nomeDellaPreimpostata("Orange to Yellow", true)).toBe("Da arancione a giallo");
    expect(nomeDellaPreimpostata("Coral and Navy", true)).toBe("Corallo e blu notte");
    expect(nomeDellaPreimpostata("Teal Glow", true)).toBe("Bagliore verde acqua");
    expect(nomeDellaPreimpostata("Dawn", false)).toBe("Dawn");
    expect(nomeDellaPreimpostata("Una nuova", true)).toBe("Una nuova");
    expect(nomeDelTema("Metallic Gradients")).toBe("Metalli");
    expect(nomeDelTema(null)).toBe("Salvate");
  });

  it("il nome per salvare non è vuoto né già preso, nel nome del motore o in quello mostrato", () => {
    const elenco = preimpostateDi(LETTURA);
    expect(problemaDelNome("   ", elenco)).toBe("vuoto");
    expect(problemaDelNome("dawn", elenco)).toBe("preso");
    expect(problemaDelNome(" ALBA ", elenco)).toBe("preso");
    expect(problemaDelNome("mare", elenco)).toBe("preso");
    expect(problemaDelNome("Lago", elenco)).toBeNull();
  });

  it("la porta legge l'elenco con la famiglia aspetto", async () => {
    const { motore, comando } = motoreFinto({ "disegno.gradient.presets.list": esito(LETTURA) });
    const porta = creaPortaPreimpostate({ motore, carica: pronta, vita: openLifetime(), selezione: () => ["oa"] });
    const elenco = await porta.elenco();
    expect(elenco.kind).toBe("pronte");
    expect(elenco.kind === "pronte" && elenco.preimpostate).toHaveLength(2);
    expect(comando).toHaveBeenCalledWith({ id: "disegno.gradient.presets.list", selection: [], value: {}, preview: false });
  });

  it("salvare il contorno lo porta davanti, salva con la selezione e rimette davanti il riempimento", async () => {
    const { motore, comando } = motoreFinto({ "disegno.gradient.presets.save": esito({ name: "Lago" }) });
    const porta = creaPortaPreimpostate({ motore, carica: pronta, vita: openLifetime(), selezione: () => ["oa1a1a1a1"] });
    expect(await porta.salva(" Lago ", "stroke", "fill")).toEqual({ kind: "fatto", nome: "Lago" });
    expect(comando.mock.calls.map(([passo]) => passo)).toEqual([
      { id: "disegno.paint.toggleActive", selection: [], value: { fill: false }, preview: false },
      { id: "disegno.gradient.presets.save", selection: ["oa1a1a1a1"], value: { name: "Lago" }, preview: false },
      { id: "disegno.paint.toggleActive", selection: [], value: { fill: true }, preview: false },
    ]);
  });

  it("un rifiuto del motore è vuoto; togliere manda il nome", async () => {
    const { motore, comando } = motoreFinto({
      "disegno.gradient.presets.save": esito(null, "empty"),
      "disegno.gradient.presets.delete": esito({ deleted: "Mare" }),
    });
    const porta = creaPortaPreimpostate({ motore, carica: pronta, vita: openLifetime(), selezione: () => [] });
    expect(await porta.salva("Lago", "fill", "fill")).toEqual({ kind: "vuoto" });
    // Col lato già davanti non si rimette niente.
    expect(comando.mock.calls.filter(([passo]) => passo.id === "disegno.paint.toggleActive")).toHaveLength(1);
    expect(await porta.togli("Mare")).toEqual({ kind: "fatto", nome: "Mare" });
    expect(comando).toHaveBeenLastCalledWith({ id: "disegno.gradient.presets.delete", selection: [], value: { name: "Mare" }, preview: false });
  });

  it("le preferenze del motore più nuove o rotte bloccano salvare e togliere col perché", async () => {
    for (const [prefs, perche] of [["newer", "nuove"], ["broken", "rotte"]] as const) {
      const rifiuto = esito({ prefs }, "unsupported");
      const { motore } = motoreFinto({ "disegno.gradient.presets.save": rifiuto, "disegno.gradient.presets.delete": rifiuto });
      const porta = creaPortaPreimpostate({ motore, carica: pronta, vita: openLifetime(), selezione: () => [] });
      expect(await porta.salva("Lago", "stroke", "fill")).toEqual({ kind: "bloccato", perche });
      expect(await porta.togli("Mare")).toEqual({ kind: "bloccato", perche });
    }
  });

  it("senza motore, con una famiglia in errore o con la vita chiusa è assente", async () => {
    const senza = creaPortaPreimpostate({ motore: null, carica: pronta, vita: openLifetime(), selezione: () => [] });
    expect(await senza.elenco()).toEqual({ kind: "assente" });
    const { motore, comando } = motoreFinto({});
    const errore = { famiglia: () => Promise.resolve({ kind: "errore" }) } as never;
    expect(await creaPortaPreimpostate({ motore, carica: errore, vita: openLifetime(), selezione: () => [] }).togli("Mare")).toEqual({ kind: "assente" });
    const vita = openLifetime();
    vita.close();
    expect(await creaPortaPreimpostate({ motore, carica: pronta, vita, selezione: () => [] }).salva("Lago", "fill", "fill")).toEqual({ kind: "assente" });
    expect(comando).not.toHaveBeenCalled();
  });
});
