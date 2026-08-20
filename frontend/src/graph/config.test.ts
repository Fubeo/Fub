// @vitest-environment happy-dom
// Test di `config.ts`: persistenza e clamping della conf del grafo.
//
// `localStorage` in happy-dom esiste e funziona; lo si azzera per isolare i
// test. I casi coprono il round-trip, i dati non fidati (JSON storto, valori
// fuori range), l'assenza di `localStorage`, e il fatto che il preset vince
// sui numeri salvati (tranne «custom»).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CONFIG_KEY,
  applyPreset,
  loadConfig,
  defaultConfig,
  saveConfig,
} from "./config";
import { PhysicsConfig, PRESETS, defaultGraphicsConfig, organicConfig } from "./sim/types";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultConfig", () => {
  it("parte da organica con la graphics predefinita", () => {
    const c = defaultConfig();
    expect(c.preset).toBe("organica");
    expect(c.physics).toEqual(organicConfig());
    expect(c.graphics).toEqual(defaultGraphicsConfig());
  });
});

describe("applyPreset", () => {
  it("ritorna la physics del preset e clona (non lo stesso oggetto)", () => {
    const a = applyPreset("organica");
    const b = applyPreset("organica");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("costellazione ha repulsion più alta di organica", () => {
    expect(applyPreset("costellazione").repulsion).toBeGreaterThan(organicConfig().repulsion);
  });

  it("un nome sconosciuto ripiega su organica", () => {
    expect(applyPreset("marziana")).toEqual(organicConfig());
  });
});

describe("loadConfig", () => {
  it("senza nulla salvato dà la predefinita", () => {
    const c = loadConfig();
    expect(c.preset).toBe("organica");
    expect(c.physics).toEqual(organicConfig());
  });

  it("senza localStorage non lancia e dà la predefinita", () => {
    vi.stubGlobal("localStorage", undefined);
    const c = loadConfig();
    expect(c.preset).toBe("organica");
  });

  it("JSON storto dà la predefinita", () => {
    localStorage.setItem(CONFIG_KEY, "{non è json");
    const c = loadConfig();
    expect(c.preset).toBe("organica");
  });

  it("un oggetto salvato non-oggetto dà la predefinita", () => {
    localStorage.setItem(CONFIG_KEY, "42");
    expect(loadConfig().preset).toBe("organica");
  });

  it("round-trip: ciò che si salva si rilegge", () => {
    const c = {
      physics: { ...organicConfig(), repulsion: 5000, collisions: false },
      graphics: { ...defaultGraphicsConfig(), grid: false },
      preset: "custom" as const,
    };
    saveConfig(c);
    const read = loadConfig();
    expect(read.physics.repulsion).toBe(5000);
    expect(read.physics.collisions).toBe(false);
    expect(read.graphics.grid).toBe(false);
    expect(read.preset).toBe("custom");
  });

  it("il preset vince sui numeri salvati (preset != custom)", () => {
    // Salva un preset «rigido» con una fisica storta: al rileggere, il preset
    // ricostruisce la fisica da `PRESETS["rigido"]()`, ignorando i numeri.
    saveConfig({
      physics: { repulsion: 9999, friction: 0.5 } as Partial<PhysicsConfig> as PhysicsConfig,
      graphics: defaultGraphicsConfig(),
      preset: "rigido",
    });
    const read = loadConfig();
    expect(read.preset).toBe("rigido");
    expect(read.physics).toEqual(PRESETS["rigido"]());
    expect(read.physics.repulsion).toBe(organicConfig().repulsion);
  });

  it("valori fuori range vengono clamapati al rileggere", () => {
    saveConfig({
      physics: { repulsion: 1e9, friction: -5, theta: 99 } as Partial<PhysicsConfig> as PhysicsConfig,
      graphics: defaultGraphicsConfig(),
      preset: "custom",
    });
    const read = loadConfig();
    expect(read.physics.repulsion).toBe(20000);
    expect(read.physics.friction).toBe(0.5);
    expect(read.physics.theta).toBe(1.2);
  });

  it("un preset sconosciuto salvato ripiega su organica", () => {
    saveConfig({ physics: organicConfig(), graphics: defaultGraphicsConfig(), preset: "fantasma" });
    const read = loadConfig();
    expect(read.preset).toBe("organica");
  });
});

describe("saveConfig", () => {
  it("non lancia se localStorage è assente", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveConfig(defaultConfig())).not.toThrow();
  });

  it("clampa prima di scrivere: un valore storto non arriva al supporto", () => {
    saveConfig({
      physics: { ...organicConfig(), repulsion: 1e9 },
      graphics: defaultGraphicsConfig(),
      preset: "custom",
    });
    const raw = localStorage.getItem(CONFIG_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { physics: { repulsion: number } };
    expect(parsed.physics.repulsion).toBe(20000);
  });
});