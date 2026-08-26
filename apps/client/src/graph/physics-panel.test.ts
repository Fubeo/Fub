// @vitest-environment happy-dom
// Test di `physics-panel.ts`: il pannello delle impostazioni del grafo.
// I testi sono iniettati (il pannello non chiama `t`): così i test non
// conoscono le lingue e verificano solo il comportamento del DOM.

import { describe, expect, it, beforeEach } from "vitest";
import { createPhysicsPanel, type PanelCopy } from "./physics-panel";
import type { GraphConfig } from "./sim/types";
import { defaultGraphicsConfig, organicConfig } from "./sim/types";

// --- i testi finti ----------------------------------------------------------

function copy(): PanelCopy {
  return {
    title: "Fisica del grafo",
    preset: "Personalità",
    warm: "Riscalda",
    unpin: "Sblocca nodi",
    reset: "Reimposta",
    open: "Apri impostazioni",
    close: "Chiudi impostazioni",
    presets: {
      "organica": "Organica",
      "costellazione": "Costellazione",
      "alveare": "Alveare",
      "nebulosa": "Nebulosa",
      "rigido": "Rigido",
      "custom": "Personalizzata",
    },
    fields: {
      repulsion: "Repulsione",
      baseLength: "Lunghezza molle",
      springStiffness: "Rigidità molle",
      springDamping: "Smorzamento",
      gravity: "Gravità",
      friction: "Attrito",
      maxSpeed: "Velocità massima",
      degreeWeight: "Peso del degree",
      collisions: "Collisioni",
      theta: "Apertura Barnes-Hut",
      jitter: "Jitter iniziale",
      cooling: "Raffreddamento",
      glow: "Bagliore",
      pulse: "Pulsazione",
      trail: "Scie",
      grid: "Grid",
      edgeCurvature: "Curvatura archi",
      labelDensity: "Densità etichette",
    },
  };
}

function initialConfig(): GraphConfig {
  return {
    physics: organicConfig(),
    graphics: defaultGraphicsConfig(),
    preset: "organica",
  };
}

describe("createPhysicsPanel", () => {
  let config: GraphConfig;
  let changes: GraphConfig[];
  let warmCalled: boolean;
  let unpinCalled: boolean;

  beforeEach(() => {
    config = initialConfig();
    changes = [];
    warmCalled = false;
    unpinCalled = false;
  });

  function create() {
    return createPhysicsPanel({
      config,
      onChange: (c) => changes.push(c),
      onWarm: () => {
        warmCalled = true;
      },
      onUnpinAll: () => {
        unpinCalled = true;
      },
      copy,
    });
  }

  it("costruisce il DOM: un bottone gear e un popover nascosto", () => {
    const p = create();
    const toggle = p.element.querySelector("button.graph-panel-toggle");
    const popover = p.element.querySelector(".graph-panel-popover");
    expect(toggle).not.toBeNull();
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute("hidden")).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    p.destroy();
  });

  it("il click sul gear apre il popover e inverte aria-expanded", () => {
    const p = create();
    const toggle = p.element.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    toggle.click();
    const popover = p.element.querySelector<HTMLElement>(".graph-panel-popover")!;
    expect(popover.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Un secondo click chiude.
    toggle.click();
    expect(popover.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    p.destroy();
  });

  it("cambio slider fisico: onChange con preset custom e il nuovo valore", () => {
    const p = create();
    const slider = p.element.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    slider!.value = "5000";
    slider!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changes.length).toBe(1);
    expect(changes[0].preset).toBe("custom");
    expect(changes[0].physics.repulsion).toBe(5000);
    p.destroy();
  });

  it("toggle grafico (glow): onChange senza cambiare il preset", () => {
    const p = create();
    const checkbox = p.element.querySelector<HTMLInputElement>('input[data-field="glow"]');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.length).toBe(1);
    expect(changes[0].preset).toBe("organica");
    expect(changes[0].graphics.glow).toBe(false);
    p.destroy();
  });

  it("cambio preset: onChange con la physics del preset e preset aggiornato", () => {
    const p = create();
    const select = p.element.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    select.value = "rigido";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.length).toBe(1);
    expect(changes[0].preset).toBe("rigido");
    // La fisica del pannello è ora quella del preset rigido.
    expect(config.physics.repulsion).toBe(organicConfig().repulsion);
    expect(config.physics.springStiffness).toBe(0.35);
    p.destroy();
  });

  it("reimposta: riporta a organica + graphics predefinita", () => {
    const p = create();
    // Prima cambia qualcosa.
    const select = p.element.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    select.value = "rigido";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    changes.length = 0;
    // Poi reimposta.
    const resetButton = Array.from(p.element.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Reimposta",
    )!;
    resetButton.click();
    expect(changes.length).toBe(1);
    expect(changes[0].preset).toBe("organica");
    expect(config.physics).toEqual(organicConfig());
    expect(config.graphics).toEqual(defaultGraphicsConfig());
    p.destroy();
  });

  it("warm: chiama onRiscalda", () => {
    const p = create();
    const btn = Array.from(p.element.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Riscalda",
    )!;
    btn.click();
    expect(warmCalled).toBe(true);
    p.destroy();
  });

  it("sblocca: chiama onSbloccaPanni", () => {
    const p = create();
    const btn = Array.from(p.element.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Sblocca nodi",
    )!;
    btn.click();
    expect(unpinCalled).toBe(true);
    p.destroy();
  });

  it("Esc chiude il popover aperto e chiama riportaFocus", () => {
    let focusRestored = false;
    const p = createPhysicsPanel({
      config,
      onChange: (c) => changes.push(c),
      onWarm: () => {},
      onUnpinAll: () => {},
      copy,
      restoreFocus: () => {
        focusRestored = true;
      },
    });
    const toggle = p.element.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    toggle.click();
    const popover = p.element.querySelector<HTMLElement>(".graph-panel-popover")!;
    expect(popover.hidden).toBe(false);
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(focusRestored).toBe(true);
    p.destroy();
  });

  it("aggiornaLingua: riapplica le etichette", () => {
    const p = create();
    const toggle = p.element.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    expect(toggle.getAttribute("aria-label")).toBe("Apri impostazioni");
    // Forza un cambio di testi.
    p.updateLanguage();
    // Verifica che la select ha le option.
    const select = p.element.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("Organica");
    expect(options).toContain("Rigido");
    expect(options).toContain("Personalizzata");
    p.destroy();
  });

  it("distruggi: rimuove l'elemento dal DOM", () => {
    const p = create();
    document.body.append(p.element);
    expect(document.body.contains(p.element)).toBe(true);
    p.destroy();
    expect(document.body.contains(p.element)).toBe(false);
  });

  it("il select mostra il preset iniziale della config", () => {
    config.preset = "rigido";
    const p = create();
    const select = p.element.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    expect(select.value).toBe("rigido");
    p.destroy();
  });
});