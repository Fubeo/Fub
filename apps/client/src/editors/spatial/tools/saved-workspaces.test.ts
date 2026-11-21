// Il formato di `draw.workspaces`: come si legge una voce, e che cosa resta
// com'era quando si scrive accanto a una voce che non si capisce.
import { describe, expect, it } from "vitest";
import {
  eliminaSpazio,
  leggiSpazi,
  leggiVoce,
  nuovoIdSpazio,
  rinominaSpazio,
  salvaSpazio,
  scriviVoce,
  spaziUsabili,
  type SpazioSalvato,
} from "./saved-workspaces";

const mio: SpazioSalvato = { id: "mio", nome: "Mio", colonna: ["pen", "select"], scheda: "layers", sezione: "pennelli", righelli: true };
const altro: SpazioSalvato = { id: "altro", nome: "Altro", colonna: [], scheda: "design", sezione: null, righelli: false };
const rotta = "{non è json";
const piuNuova = '{"v":2,"id":"futuro","nome":"Futuro","forma":"nuova"}';

describe("una voce di draw.workspaces", () => {
  it("scrive la versione per prima e si legge com'è scritta", () => {
    const raw = scriviVoce(mio);
    expect(raw.startsWith('{"v":1,')).toBe(true);
    expect(leggiVoce(raw)).toEqual({ kind: "spazio", raw, spazio: mio });
  });

  it("una versione più nuova si mostra col suo nome, e non si usa", () => {
    expect(leggiVoce(piuNuova)).toEqual({ kind: "piuNuova", raw: piuNuova, nome: "Futuro" });
    expect(spaziUsabili(leggiSpazi([piuNuova]))).toEqual([]);
  });

  it("una voce rotta non si usa: non è JSON, non è un oggetto, o le manca un campo", () => {
    for (const raw of [rotta, "[1,2]", "42", '{"v":1,"id":"x"}', '{"v":1,"id":"x","nome":"X","colonna":[],"scheda":"storia","sezione":null,"righelli":false}', '{"id":"x","nome":"X"}']) {
      expect(leggiVoce(raw).kind, raw).toBe("rotta");
    }
  });

  it("un nome vuoto o solo di spazi è rotto", () => {
    expect(leggiVoce(scriviVoce({ ...mio, nome: "   " })).kind).toBe("rotta");
  });
});

describe("salvare, rinominare ed eliminare", () => {
  it("aggiunge in fondo, e riporta tali e quali le voci rotte e le più nuove", () => {
    const raws = [rotta, scriviVoce(altro), piuNuova];
    const nuovo = salvaSpazio(raws, mio);
    expect(nuovo).toEqual([rotta, scriviVoce(altro), piuNuova, scriviVoce(mio)]);
  });

  it("uno spazio con lo stesso nome sostituisce il suo, col suo id e nello stesso posto", () => {
    const raws = [scriviVoce(altro), scriviVoce(mio)];
    const nuovo = salvaSpazio(raws, { ...mio, nome: "MIO", id: "nuovo-id", righelli: false });
    expect(nuovo).toEqual([scriviVoce(altro), scriviVoce({ ...mio, nome: "MIO", righelli: false })]);
  });

  it("un nome che è di una voce più nuova non si prende, e l'elenco non cambia", () => {
    expect(salvaSpazio([piuNuova], { ...mio, nome: "futuro" })).toBe("nome-occupato");
  });

  it("rinomina uno spazio, e rifiuta un nome già usato da un altro", () => {
    const raws = [scriviVoce(mio), scriviVoce(altro)];
    expect(rinominaSpazio(raws, "mio", " Tabella ")).toEqual([scriviVoce({ ...mio, nome: "Tabella" }), scriviVoce(altro)]);
    expect(rinominaSpazio(raws, "mio", "altro")).toBe("nome-occupato");
    expect(rinominaSpazio(raws, "mio", "Mio")).toEqual([scriviVoce(mio), scriviVoce(altro)]);
    expect(rinominaSpazio(raws, "fantasma", "Nuovo")).toBe("non-trovato");
  });

  it("elimina solo lo spazio indicato, lasciando le voci che non si capiscono", () => {
    expect(eliminaSpazio([rotta, scriviVoce(mio), piuNuova, scriviVoce(altro)], "mio")).toEqual([rotta, piuNuova, scriviVoce(altro)]);
    expect(eliminaSpazio([scriviVoce(mio)], "fantasma")).toBe("non-trovato");
  });

  it("un id nuovo non è quello di nessuna voce, nemmeno rotta", () => {
    const raws = [rotta, scriviVoce(altro)];
    const id = nuovoIdSpazio(raws, 100);
    expect(id).toMatch(/^salvato-/);
    expect(raws.some((raw) => raw.includes(id))).toBe(false);
  });
});
