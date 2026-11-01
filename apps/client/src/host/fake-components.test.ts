// `components_map` e `components_apply` dell'host finto: le risposte che l'host
// vero ha dato sul vault di prova con «Studio» (`__fixtures__/components-scenario.json`,
// generato da `crates/fub-app/tests/ts_mirror_app.rs`). Il finto non ha un
// risolutore: serve quelle, e ciò che lo scenario non ha lo rifiuta.
import { describe, expect, it } from "vitest";
import { gergoIn } from "../i18n/gergo";
import type { KernelEvent, PluginError } from "./contract";
import { COMPONENT_SCENARIO, createFakeHost, type FakeHost } from "./fake";

/// Gli eventi che arrivano alla shell, in ordine.
async function listen(host: FakeHost): Promise<KernelEvent[]> {
  const events: KernelEvent[] = [];
  await host.module.onKernelEvent((notice) => events.push(notice.event));
  return events;
}

/// Un giro del ciclo degli eventi: quello in cui il ponte consegna.
const delivered = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("i nomi arrivano già nella lingua del vault, con i gruppi in ordine", async () => {
    const map = await createFakeHost().module.api.componentsMap();
    for (const row of map.righe) {
      expect(row.nome, row.id).not.toMatch(/^component\./);
      expect(row.descrizione, row.id).not.toBe("");
      expect(map.gruppi.map((group) => group.id), row.id).toContain(row.gruppo);
    }
    expect(map.righe.find((row) => row.id === "fub.penna")?.nome).toBe("Penna");
    expect(map.righe.find((row) => row.id === "fub.pdf")?.ui).toEqual(["editors/media"]);
    expect(map.gruppi.map((group) => group.nome)).toEqual([
      "Scrivere", "Leggere", "Pensare", "Disegnare", "Ufficio", "Altro", "Di supporto",
    ]);
    expect(map.profili.find((profile) => profile.nome === "solo-note")?.etichetta).toBe("Solo note");
    // Ciò che la pagina legge non porta il gergo del codice.
    const texts = [
      ...map.righe.flatMap((row) => [row.nome, row.descrizione]),
      ...map.gruppi.map((group) => group.nome),
      ...map.profili.map((profile) => profile.etichetta),
    ];
    for (const text of texts) expect(gergoIn(text), text).toEqual([]);
  });

  it("da «Solo note»: il PDF accende la penna, la lavagna rimonta, la penna resta in attesa", async () => {
    const host = createFakeHost({ componentsStart: "solo-note" });
    const api = host.module.api;
    const events = await listen(host);
    const acceso = (map: Awaited<ReturnType<typeof api.componentsMap>>, id: string) =>
      map.righe.find((row) => row.id === id)?.acceso;

    const start = await api.componentsMap();
    expect(start.profilo).toBe("solo-note");
    expect([acceso(start, "fub.pdf"), acceso(start, "fub.lavagna")]).toEqual([false, false]);

    // «Accendi PDF»: la prova dice che arriva anche la penna, col suo nome.
    const dry = await api.componentsApply({ azione: "accendi", id: "fub.pdf" });
    expect(dry.risposta === "esito" && dry.effetto.accesi_anche).toEqual(["fub.penna"]);
    expect(start.righe.find((row) => row.id === "fub.penna")?.nome).toBe("Penna");
    await delivered();
    expect(events).toEqual([]);

    const pdf = await api.componentsApply({ azione: "accendi", id: "fub.pdf" }, true);
    expect(pdf.risposta === "esito" && pdf.applicato).toBe(true);
    // Gli eventi arrivano dopo la risposta, non con lei.
    expect(events).toEqual([]);
    await delivered();
    expect(events.map((event) => event.type)).toContain("setting_changed");
    expect(events.some((event) => event.type === "vault_closed")).toBe(false);
    expect(acceso(await api.componentsMap(), "fub.penna")).toBe(true);

    // La lavagna rimonta il vault: chiusura e riapertura, in quest'ordine.
    events.length = 0;
    await api.componentsApply({ azione: "accendi", id: "fub.lavagna" });
    await api.componentsApply({ azione: "accendi", id: "fub.lavagna" }, true);
    await delivered();
    const remount = events.filter((event) => event.type !== "setting_changed");
    expect(remount).toEqual([
      { type: "vault_closed", root: "/vault" },
      { type: "vault_opened", root: "/vault" },
    ]);

    // Spenti PDF e lavagna, la penna non serve più a nessuno: resta in attesa
    // di una risposta, anche dopo una seconda lettura.
    await api.componentsApply({ azione: "spegni", id: "fub.pdf" }, true);
    await api.componentsApply({ azione: "spegni", id: "fub.lavagna" }, true);
    for (const map of [await api.componentsMap(), await api.componentsMap()]) {
      expect(map.stato.in_attesa).toEqual(["fub.penna"]);
      expect(map.righe.find((row) => row.id === "fub.penna")?.perche).toBe("InAttesa");
    }

    // «Togli» o «Tieni» rispondono dallo stesso stato.
    const togli = await api.componentsApply({ azione: "rispondi", orfani: "togli" }, true);
    expect(togli.risposta === "esito" && togli.stato.in_attesa).toEqual([]);
    expect(acceso(await api.componentsMap(), "fub.penna")).toBe(false);
  });

  it("un guasto forzato arriva come errore e non cambia niente", async () => {
    const host = createFakeHost({ componentsStart: "solo-note" });
    const api = host.module.api;
    const events = await listen(host);
    const before = await api.componentsMap();
    const error: PluginError = { kind: "io", message: "disk full" };
    const restore = host.componentsFail(error);
    await expect(api.componentsApply({ azione: "accendi", id: "fub.pdf" }, true)).rejects.toEqual(error);
    await delivered();
    expect(events).toEqual([]);
    expect(await api.componentsMap()).toEqual(before);
    restore();
    const pdf = await api.componentsApply({ azione: "accendi", id: "fub.pdf" }, true);
    expect(pdf.risposta === "esito" && pdf.applicato).toBe(true);
  });

  it("una scelta fatta da fuori cambia lo stato e manda gli eventi, senza `componentsApply`", async () => {
    const host = createFakeHost({ componentsStart: "solo-note", root: "/Altro vault" });
    const events = await listen(host);
    host.componentsFromOutside({ azione: "accendi", id: "fub.pdf" });
    events.length = 0;
    const answer = host.componentsFromOutside({ azione: "accendi", id: "fub.lavagna" });
    expect(answer.risposta === "esito" && answer.applicato).toBe(true);
    expect(host.atGate("componentsApply")).toEqual([]);
    // Subito, e con la radice di questo vault.
    expect(events.filter((event) => event.type !== "setting_changed")).toEqual([
      { type: "vault_closed", root: "/Altro vault" },
      { type: "vault_opened", root: "/Altro vault" },
    ]);
    expect((await host.module.api.componentsMap()).righe.find((row) => row.id === "fub.lavagna")?.acceso).toBe(true);
    expect(() => host.componentsFromOutside({ azione: "accendi", id: "fub.draw" })).toThrow(/no recorded answer/);
  });

  it("parte da «Studio» di serie, e una partenza che lo scenario non ha lancia", () => {
    expect(COMPONENT_SCENARIO.partenze[COMPONENT_SCENARIO.profilo]).toBe(0);
    expect(() => createFakeHost({ componentsStart: "cucina" })).toThrow(/no start/);
  });
});
