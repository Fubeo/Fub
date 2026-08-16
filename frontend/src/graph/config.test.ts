// @vitest-environment happy-dom
// Test di `config.ts`: persistenza e clamping della conf del grafo.
//
// `localStorage` in happy-dom esiste e funziona; lo si azzera per isolare i
// test. I casi coprono il round-trip, i dati non fidati (JSON storto, valori
// fuori range), l'assenza di `localStorage`, e il fatto che il preset vince
// sui numeri salvati (tranne «custom»).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CHIAVE_CONF,
  applicaPreset,
  caricaConf,
  confPredefinita,
  salvaConf,
} from "./config";
import { ConfFisica, PRESETTI, confGraficaPredefinita, confOrganica } from "./sim/tipi";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confPredefinita", () => {
  it("parte da organica con la grafica predefinita", () => {
    const c = confPredefinita();
    expect(c.preset).toBe("organica");
    expect(c.fisica).toEqual(confOrganica());
    expect(c.grafica).toEqual(confGraficaPredefinita());
  });
});

describe("applicaPreset", () => {
  it("ritorna la fisica del preset e clona (non lo stesso oggetto)", () => {
    const a = applicaPreset("organica");
    const b = applicaPreset("organica");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("costellazione ha repulsione più alta di organica", () => {
    expect(applicaPreset("costellazione").repulsione).toBeGreaterThan(confOrganica().repulsione);
  });

  it("un nome sconosciuto ripiega su organica", () => {
    expect(applicaPreset("marziana")).toEqual(confOrganica());
  });
});

describe("caricaConf", () => {
  it("senza nulla salvato dà la predefinita", () => {
    const c = caricaConf();
    expect(c.preset).toBe("organica");
    expect(c.fisica).toEqual(confOrganica());
  });

  it("senza localStorage non lancia e dà la predefinita", () => {
    vi.stubGlobal("localStorage", undefined);
    const c = caricaConf();
    expect(c.preset).toBe("organica");
  });

  it("JSON storto dà la predefinita", () => {
    localStorage.setItem(CHIAVE_CONF, "{non è json");
    const c = caricaConf();
    expect(c.preset).toBe("organica");
  });

  it("un oggetto salvato non-oggetto dà la predefinita", () => {
    localStorage.setItem(CHIAVE_CONF, "42");
    expect(caricaConf().preset).toBe("organica");
  });

  it("round-trip: ciò che si salva si rilegge", () => {
    const c = {
      fisica: { ...confOrganica(), repulsione: 5000, collisioni: false },
      grafica: { ...confGraficaPredefinita(), griglia: false },
      preset: "custom" as const,
    };
    salvaConf(c);
    const letta = caricaConf();
    expect(letta.fisica.repulsione).toBe(5000);
    expect(letta.fisica.collisioni).toBe(false);
    expect(letta.grafica.griglia).toBe(false);
    expect(letta.preset).toBe("custom");
  });

  it("il preset vince sui numeri salvati (preset != custom)", () => {
    // Salva un preset «rigido» con una fisica storta: al rileggere, il preset
    // ricostruisce la fisica da `PRESETTI.rigido()`, ignorando i numeri.
    salvaConf({
      fisica: { repulsione: 9999, attrito: 0.5 } as Partial<ConfFisica> as ConfFisica,
      grafica: confGraficaPredefinita(),
      preset: "rigido",
    });
    const letta = caricaConf();
    expect(letta.preset).toBe("rigido");
    expect(letta.fisica).toEqual(PRESETTI.rigido());
    expect(letta.fisica.repulsione).toBe(confOrganica().repulsione);
  });

  it("valori fuori range vengono clamapati al rileggere", () => {
    salvaConf({
      fisica: { repulsione: 1e9, attrito: -5, theta: 99 } as Partial<ConfFisica> as ConfFisica,
      grafica: confGraficaPredefinita(),
      preset: "custom",
    });
    const letta = caricaConf();
    expect(letta.fisica.repulsione).toBe(20000);
    expect(letta.fisica.attrito).toBe(0.5);
    expect(letta.fisica.theta).toBe(1.2);
  });

  it("un preset sconosciuto salvato ripiega su organica", () => {
    salvaConf({ fisica: confOrganica(), grafica: confGraficaPredefinita(), preset: "fantasma" });
    const letta = caricaConf();
    expect(letta.preset).toBe("organica");
  });
});

describe("salvaConf", () => {
  it("non lancia se localStorage è assente", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => salvaConf(confPredefinita())).not.toThrow();
  });

  it("clampa prima di scrivere: un valore storto non arriva al supporto", () => {
    salvaConf({
      fisica: { ...confOrganica(), repulsione: 1e9 },
      grafica: confGraficaPredefinita(),
      preset: "custom",
    });
    const raw = localStorage.getItem(CHIAVE_CONF);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { fisica: { repulsione: number } };
    expect(parsed.fisica.repulsione).toBe(20000);
  });
});