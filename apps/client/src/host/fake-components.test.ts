// `components_map` e `components_apply` dell'host finto: le risposte che l'host
// vero ha dato sul vault di prova con «Studio» (`__fixtures__/components-scenario.json`,
// generato da `crates/fub-app/tests/ts_mirror_app.rs`). Il finto non ha un
// risolutore: serve quelle, e ciò che lo scenario non ha lo rifiuta.
import { describe, expect, it } from "vitest";
import { COMPONENT_SCENARIO, createFakeHost } from "./fake";

describe("la pagina «Componenti» nell'host finto", () => {
  it("serve la mappa del vault di prova con il profilo «Studio»", async () => {
    const api = createFakeHost().module.api;
    const map = await api.componentsMap();
    expect(map.profilo).toBe("studio");
    expect(map.righe.find((row) => row.id === "fub.template")?.acceso).toBe(true);
    expect(map.profili.find((profile) => profile.nome === "solo-pdf")?.piu_avanti).toBe(true);
  });

  it("accendere chiede «Attivati anche…», spegnere un requisito è `Richiesto`", async () => {
    const api = createFakeHost().module.api;

    // Spegnere la penna con lavagna e PDF accesi: un rifiuto tipato, non un errore.
    const penna = await api.componentsApply({ azione: "spegni", id: "fub.penna" });
    expect(penna).toEqual({ risposta: "rifiuto", rifiuto: "richiesto", id: "fub.penna", da: ["fub.lavagna", "fub.pdf"] });

    // Le proprietà spente con chi le richiede, poi il modello riacceso: torna
    // anche ciò che il modello richiede.
    const off = await api.componentsApply({ azione: "spegni", id: "fub.properties", anche_questi: true }, true);
    expect(off.risposta === "esito" && off.effetto.spenti_anche).toEqual(["fub.base", "fub.template"]);
    expect((await api.componentsMap()).righe.find((row) => row.id === "fub.properties")?.acceso).toBe(false);

    // Senza `apply` è una prova: dice che cosa cambierebbe e non cambia niente.
    const dry = await api.componentsApply({ azione: "accendi", id: "fub.template" });
    expect(dry.risposta === "esito" && [dry.applicato, dry.effetto.accesi_anche]).toEqual([false, ["fub.properties"]]);
    expect((await api.componentsMap()).righe.find((row) => row.id === "fub.template")?.acceso).toBe(false);

    const on = await api.componentsApply({ azione: "accendi", id: "fub.template" }, true);
    expect(on.risposta === "esito" && [on.applicato, on.effetto.accesi_anche]).toEqual([true, ["fub.properties"]]);
    const after = await api.componentsMap();
    expect(after.righe.find((row) => row.id === "fub.properties")?.acceso).toBe(true);
    // La mappa dopo è quella che l'host ha dato dopo la stessa scelta.
    const recorded = COMPONENT_SCENARIO.scelte.find((choice) => choice.apply && choice.azione.azione === "accendi" && choice.azione.id === "fub.template");
    expect(after).toEqual(COMPONENT_SCENARIO.mappe[recorded!.dopo]);
  });

  it("un id sconosciuto è un rifiuto `sconosciuto`", async () => {
    const api = createFakeHost().module.api;
    expect(await api.componentsApply({ azione: "accendi", id: "fub.inesistente" })).toEqual({
      risposta: "rifiuto",
      rifiuto: "sconosciuto",
      id: "fub.inesistente",
    });
  });

  it("a vault chiuso i due comandi rispondono l'errore dell'host", async () => {
    const api = createFakeHost({ root: null }).module.api;
    await expect(api.componentsMap()).rejects.toEqual(COMPONENT_SCENARIO.senza_vault.components_map);
    await expect(api.componentsApply({ azione: "profilo", nome: "studio" })).rejects.toEqual(
      COMPONENT_SCENARIO.senza_vault.components_apply,
    );
    expect(COMPONENT_SCENARIO.senza_vault.components_map.kind).toBe("not_found");
  });

  it("una scelta che l'host non ha registrato non si inventa", async () => {
    const api = createFakeHost().module.api;
    await expect(api.componentsApply({ azione: "accendi", id: "fub.draw" }, true)).rejects.toThrow(/no recorded answer/);
  });
});
