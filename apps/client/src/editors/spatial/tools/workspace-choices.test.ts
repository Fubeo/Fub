// L'elenco degli spazi del menu della banda: che cosa si sceglie, che cosa è
// grigio e perché, e quale spazio è in uso quando il Completo non c'è.
import { describe, expect, it } from "vitest";
import { t } from "../strings";
import { scriviVoce, type SpazioSalvato } from "./saved-workspaces";
import { spaziDisponibili } from "./workspace-choices";

const mio: SpazioSalvato = { id: "salvato-1", nome: "Mio", colonna: [], scheda: "layers", sezione: null, righelli: true };
const salvati = [scriviVoce(mio)];
const futuro = '{"v":2,"id":"futuro","nome":"Futuro"}';

const stato = (over: Partial<Parameters<typeof spaziDisponibili>[0]>) => ({
  space: "full",
  componente: true,
  fallito: false,
  savedRaw: [] as string[],
  ...over,
});

describe("l'elenco degli spazi del menu", () => {
  it("con il Completo acceso e riuscito, i preset si scelgono e lo spazio in uso è quello scritto", () => {
    const dati = spaziDisponibili(stato({ space: "automazione" }));
    expect(dati.corrente.id).toBe("automazione");
    const preset = dati.elenco.filter((voce) => voce.group === "completo");
    expect(preset).toHaveLength(8);
    expect(preset.every((voce) => voce.enabled)).toBe(true);
  });

  it("con il componente spento i preset sono grigi, con il perché, e lo spazio in uso è il Completo nativo", () => {
    const dati = spaziDisponibili(stato({ space: "automazione", componente: false }));
    expect(dati.corrente.id).toBe("full");
    const preset = dati.elenco.filter((voce) => voce.group === "completo");
    expect(preset.every((voce) => !voce.enabled && voce.reason === t("draw.workspace.off.reason"))).toBe(true);
  });

  it("se il Completo non si è caricato, i suoi spazi non si scelgono e lo dice «Riprova prima»", () => {
    const dati = spaziDisponibili(stato({ space: "web", fallito: true }));
    expect(dati.corrente.id).toBe("full");
    const web = dati.elenco.find((voce) => voce.id === "web");
    expect(web).toMatchObject({ enabled: false, reason: t("draw.workspace.load.first") });
  });

  it("gli spazi salvati si elencano dopo i preset, e una voce di versione più nuova si mostra spenta", () => {
    const dati = spaziDisponibili(stato({ space: "salvato-1", savedRaw: [...salvati, futuro] }));
    expect(dati.corrente).toMatchObject({ id: "salvato-1", name: "Mio", group: "salvato", enabled: true });
    const coda = dati.elenco.slice(-2);
    expect(coda[0]).toMatchObject({ id: "salvato-1", group: "salvato" });
    expect(coda[1]).toMatchObject({ enabled: false, name: "Futuro", reason: t("draw.workspace.saved.newer") });
  });

  it("uno spazio salvato con il componente spento vale Completo, senza cambiare il valore scritto", () => {
    const dati = spaziDisponibili(stato({ space: "salvato-1", componente: false, savedRaw: salvati }));
    expect(dati.corrente.id).toBe("full");
  });

  it("uno spazio che nessuno conosce vale Completo", () => {
    const dati = spaziDisponibili(stato({ space: "inventato", savedRaw: salvati }));
    expect(dati.corrente.id).toBe("full");
  });
});
