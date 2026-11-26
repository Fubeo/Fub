// I preset del Disegno completo: gli stessi id del registro e del Rust, e
// l'applicazione che apre la scheda, la sezione se c'è, e prepara le famiglie.
import { describe, expect, it } from "vitest";
import { SPAZI_COMPLETO } from "../tools/registry";
import type { Caricatore } from "./carica";
import { applicaSpazio, presetDi, PRESET, SPAZIO_COMPLETO, type EffettiSpazio } from "./spazi";

/// Un caricatore finto: registra le famiglie chieste, senza caricare niente.
function caricatoreFinto(): { caricatore: Caricatore; chieste: string[] } {
  const chieste: string[] = [];
  const caricatore = {
    famiglia: async (id: string) => {
      chieste.push(id);
      return { kind: "pronta" as const };
    },
  } as unknown as Caricatore;
  return { caricatore, chieste };
}

/// Gli effetti che registrano ciò che hanno ricevuto. `sezioni` dice quali
/// sezioni l'ispettore ha: le altre si saltano.
function effettiFinti(sezioni: readonly string[]): { effetti: EffettiSpazio; schede: string[]; aperte: string[]; saltate: string[] } {
  const schede: string[] = [];
  const aperte: string[] = [];
  const saltate: string[] = [];
  const effetti: EffettiSpazio = {
    scheda: (scheda) => {
      schede.push(scheda);
    },
    sezione: (id) => {
      if (sezioni.includes(id)) {
        aperte.push(id);
        return true;
      }
      saltate.push(id);
      return false;
    },
  };
  return { effetti, schede, aperte, saltate };
}

describe("i preset del Disegno completo", () => {
  it("sono gli otto del registro, nello stesso ordine, e ognuno si trova per id", () => {
    expect(PRESET.map((preset) => preset.id)).toEqual([...SPAZI_COMPLETO]);
    for (const preset of PRESET) expect(presetDi(preset.id)).toBe(preset);
    expect(presetDi("full")).toBeNull();
    expect(presetDi("inventato")).toBeNull();
  });

  it("lo spazio di serie non apre niente e non prepara niente", () => {
    expect(SPAZIO_COMPLETO).toMatchObject({ id: "full", scheda: "design", sezione: null, famiglie: [] });
  });

  it("Automazione apre i Livelli, la sezione Azioni e prepara la sua famiglia", () => {
    const { caricatore, chieste } = caricatoreFinto();
    const { effetti, schede, aperte, saltate } = effettiFinti(["azioni"]);
    applicaSpazio(presetDi("automazione")!, effetti, caricatore);
    expect(schede).toEqual(["layers"]);
    expect(aperte).toEqual(["azioni"]);
    expect(saltate).toEqual([]);
    expect(chieste).toEqual(["automazione"]);
  });

  it("una sezione che l'ispettore non ha si salta, e lo spazio va avanti", () => {
    const { caricatore, chieste } = caricatoreFinto();
    const { effetti, aperte, saltate } = effettiFinti([]);
    applicaSpazio(presetDi("web")!, effetti, caricatore);
    expect(saltate).toEqual(["simboli"]);
    expect(aperte).toEqual([]);
    expect(chieste).toEqual(["web", "simboli"]);
  });

  it("Ricalco non ha sezione: l'ispettore non ne riceve nessuna", () => {
    const { caricatore } = caricatoreFinto();
    const { effetti, schede, saltate } = effettiFinti([]);
    applicaSpazio(presetDi("ricalco")!, effetti, caricatore);
    expect(schede).toEqual(["layers"]);
    expect(saltate).toEqual([]);
  });

  it("i righelli e la fila sono dati dei preset, e la fila è accesa in tutti", () => {
    expect(presetDi("completo-classico")).toMatchObject({ righelli: true, fila: true });
    expect(presetDi("automazione")).toMatchObject({ righelli: false });
    expect(PRESET.every((preset) => preset.fila)).toBe(true);
  });
});
