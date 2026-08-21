// Il pannello delle impostazioni del grafo: preset, fisica e grafica. È il
// gemello editor della `config` che `config.ts` persiste e `chart.ts` consuma.
//
// Il montaggio è tutto qui: il pannello costruisce il suo DOM (un bottone
// ingranaggio + un popover), lo appende l'orchestratore shell. L'i18n è
// iniettato come `copy()`: il pannello non chiama `t` direttamente, perché
// i test non devono conoscere le lingue — l'orchestratore costruisce il
// `PanelCopy` da `t` e lo ripassa a `updateLanguage` al cambio lingua.
//
// Le etichette dei campi sono chiavi piatte in `fields`; i range min/max/step
// sono statici qui (duplicati dai `clampPhysicsConfig`/`clampGraphicsConfig` di `types.ts`, che non esportano
// i range): il pannello è l'unica superficie che li mostra all'utente, e
// tenerli accanto al markup è più leggibile di un import di costanti.

import type { PhysicsConfig, GraphicsConfig, GraphConfig } from "./sim/types";
import { defaultGraphicsConfig, organicConfig } from "./sim/types";
import { applyPreset as physicsPreset } from "./config";
import { icon } from "../ui/icons";

export interface PanelCopy {
  title: string;
  preset: string;
  warm: string;
  unpin: string;
  reset: string;
  open: string;
  close: string;
  /// Nome preset → etichetta (include "custom").
  presets: Record<string, string>;
  /// Chiave campo → etichetta.
  fields: Record<string, string>;
}

export interface PanelOptions {
  /// La conf viva che il pannello muta. La grafica va fusa in place
  /// (`Object.assign`) e non sostituita: il pittore chiude sull'oggetto.
  config: GraphConfig;
  /// Chiamato a ogni cambio (slider, checkbox, preset, reimposta).
  onChange: (config: GraphConfig) => void;
  onWarm: () => void;
  onUnpinAll: () => void;
  /// Ritorna i testi nella lingua corrente. Chiamato al montaggio e a ogni
  /// cambio lingua.
  copy: () => PanelCopy;
  /// Opzionale: dove rimettere il focus quando il popover si chiude con Esc
  /// (il canvas del grafo, di solito).
  restoreFocus?: () => void;
}

export interface PhysicsPanel {
  /// L'elemento da appendere nell'host del grafo.
  element: HTMLElement;
  /// Rilegge tutti i testi e riapplica le etichette. Da chiamare al cambio
  /// lingua.
  updateLanguage(): void;
  /// Rimuove i listener e l'elemento dal DOM. Idempotente.
  destroy(): void;
}

/// Un campo numerico con il suo range. I range sono gli stessi di
/// `clampPhysicsConfig`/`clampGraphicsConfig`: tenuti qui perché il pannello è la
/// sola vista che li mostra, e `types.ts` non li esporta (non vuole dare una
/// superficie ai slider di terzi). Il `step` è scelto per leggibilità dello
/// slider, non per la precisione del clamp (il clamp arrotonda comunque).
interface NumericField {
  key: string;
  min: number;
  max: number;
  step: number;
}

const PHYSICS_SLIDERS: NumericField[] = [
  { key: "repulsion", min: 200, max: 20000, step: 200 },
  { key: "baseLength", min: 40, max: 400, step: 5 },
  { key: "springStiffness", min: 0.01, max: 1, step: 0.01 },
  { key: "springDamping", min: 0, max: 1, step: 0.01 },
  { key: "gravity", min: 0, max: 0.2, step: 0.005 },
  { key: "friction", min: 0.5, max: 0.98, step: 0.01 },
  { key: "maxSpeed", min: 100, max: 4000, step: 100 },
  { key: "degreeWeight", min: 0, max: 3, step: 0.05 },
  { key: "theta", min: 0.5, max: 1.2, step: 0.01 },
  { key: "jitter", min: 0, max: 1, step: 0.01 },
  { key: "cooling", min: 0.9, max: 0.999, step: 0.001 },
];

const GRAPHICS_SLIDERS: NumericField[] = [
  { key: "edgeCurvature", min: 0, max: 1, step: 0.01 },
  { key: "labelDensity", min: 0, max: 1, step: 0.01 },
];

const PHYSICS_TOGGLES = ["collisions"] as const;
const GRAPHICS_TOGGLES = ["glow", "pulse", "trail", "grid"] as const;

const PRESET_NAMES = ["organica", "costellazione", "alveare", "nebulosa", "rigido", "custom"] as const;


export function createPhysicsPanel(o: PanelOptions): PhysicsPanel {
  const { config } = o;
  const root = document.createElement("div");
  root.className = "graph-panel";

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "graph-panel-toggle";
  gear.setAttribute("aria-haspopup", "true");
  gear.setAttribute("aria-expanded", "false");
  gear.innerHTML = icon("settings");
  root.append(gear);

  const popover = document.createElement("div");
  popover.className = "graph-panel-popover";
  popover.hidden = true;
  root.append(popover);

  const title = document.createElement("h2");
  title.className = "graph-panel-titolo";
  popover.append(title);

  const presetRow = document.createElement("label");
  presetRow.className = "graph-panel-campo graph-panel-preset";
  const presetLabel = document.createElement("span");
  presetLabel.className = "graph-panel-nome";
  presetRow.append(presetLabel);
  const select = document.createElement("select");
  select.className = "graph-panel-select";
  presetRow.append(select);
  popover.append(presetRow);

  // Riferimenti ai valori numerici mostrati accanto agli slider: si
  // aggiornano sull'input e si resettano sul cambio preset/reimposta.
  const values: Record<string, HTMLElement> = {};
  // Riferimenti agli input per poterli risincronizzare sui valori della conf
  // quando un preset li cambia dall'esterno.
  const physicsInputs: Record<string, HTMLInputElement> = {};
  const graphicsSliderInputs: Record<string, HTMLInputElement> = {};
  const physicsToggles: Record<string, HTMLInputElement> = {};
  const graphicsToggles: Record<string, HTMLInputElement> = {};

  const physicsSection = document.createElement("div");
  physicsSection.className = "graph-panel-sezione";
  const physicsLabel = document.createElement("div");
  physicsLabel.className = "graph-panel-sezione-titolo";
  physicsSection.append(physicsLabel);
  popover.append(physicsSection);

  for (const c of PHYSICS_SLIDERS) {
    const row = document.createElement("label");
    row.className = "graph-panel-campo";
    const name = document.createElement("span");
    name.className = "graph-panel-nome";
    row.append(name);
    const value = document.createElement("span");
    value.className = "graph-panel-valore";
    row.append(value);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    input.value = String((config.physics as unknown as Record<string, number>)[c.key]);
    row.append(input);
    physicsSection.append(row);
    values[c.key] = value;
    physicsInputs[c.key] = input;
    name.textContent = c.key; // placeholder, sovrascritto da aggiornaLingua
    updateValue(c.key, input.value);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      // La fisica è un nuovo oggetto: il grafico la sostituirà (nuovo
      // riferimento) a ogni impostaConf, qui si riassegna per coerenza.
      config.physics = { ...config.physics, [c.key]: v } as PhysicsConfig;
      config.preset = "custom";
      updateValue(c.key, input.value);
      o.onChange(config);
    });
  }

  for (const key of PHYSICS_TOGGLES) {
    const row = createToggle(key, config.physics[key], (v) => {
      config.physics = { ...config.physics, [key]: v } as PhysicsConfig;
      config.preset = "custom";
      o.onChange(config);
    });
    physicsSection.append(row.element);
    physicsToggles[key] = row.input;
  }

  const graphicsSection = document.createElement("div");
  graphicsSection.className = "graph-panel-sezione";
  const graphicsLabel = document.createElement("div");
  graphicsLabel.className = "graph-panel-sezione-titolo";
  graphicsSection.append(graphicsLabel);
  popover.append(graphicsSection);

  for (const key of GRAPHICS_TOGGLES) {
    const row = createToggle(key, config.graphics[key], (v) => {
      // La grafica si fonde in place: il pittore chiude sull'oggetto vivo e
      // sostituirlo lo orfanerebbe. `Object.assign` muta lo stesso riferimento.
      Object.assign(config.graphics, { [key]: v } as Partial<GraphicsConfig>);
      o.onChange(config);
    });
    graphicsSection.append(row.element);
    graphicsToggles[key] = row.input;
  }

  for (const c of GRAPHICS_SLIDERS) {
    const row = document.createElement("label");
    row.className = "graph-panel-campo";
    const name = document.createElement("span");
    name.className = "graph-panel-nome";
    row.append(name);
    const value = document.createElement("span");
    value.className = "graph-panel-valore";
    row.append(value);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    input.value = String((config.graphics as unknown as Record<string, number>)[c.key]);
    row.append(input);
    graphicsSection.append(row);
    values[c.key] = value;
    graphicsSliderInputs[c.key] = input;
    name.textContent = c.key;
    updateValue(c.key, input.value);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      Object.assign(config.graphics, { [c.key]: v } as Partial<GraphicsConfig>);
      updateValue(c.key, input.value);
      o.onChange(config);
    });
  }

  const actions = document.createElement("div");
  actions.className = "graph-panel-azioni";
  const warmButton = document.createElement("button");
  warmButton.type = "button";
  const unpinButton = document.createElement("button");
  unpinButton.type = "button";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  actions.append(warmButton, unpinButton, resetButton);
  popover.append(actions);

  function updateValue(key: string, v: string): void {
    const el = values[key];
    if (el) el.textContent = formatValue(v);
  }

  function formatValue(v: string): string {
    const n = parseFloat(v);
    if (Number.isFinite(n)) {
      // I decimali contano per rigidità/attrito (0.12) e sono rumore per
      // repulsione (2400): due cifre significative al massimo, senza
      // zeri finali.
      if (Math.abs(n) >= 10) return String(Math.round(n));
      return String(Number(n.toFixed(3)));
    }
    return v;
  }

  function createToggle(key: string, initial: boolean, onChange: (v: boolean) => void): { element: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement("label");
    row.className = "graph-panel-campo graph-panel-toggle";
    const name = document.createElement("span");
    name.className = "graph-panel-nome";
    row.append(name);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    // `data-field` rende il checkbox selezionabile per chiave nei test e
    // nello stile futuro, senza contare sull'ordine nel DOM.
    input.dataset.field = key;
    row.append(input);
    input.addEventListener("change", () => onChange(input.checked));
    return { element: row, input };
  }


  /// Aggiorna gli input fisici (slider + toggle) ai valori correnti della
  /// conf. Chiamata dopo un cambio preset e dopo «Reimposta», quando la
  /// conf cambia dall'esterno del gesto diretto dell'utente.
  function syncInputs(): void {
    for (const c of PHYSICS_SLIDERS) {
      const v = (config.physics as unknown as Record<string, number>)[c.key];
      const input = physicsInputs[c.key];
      if (input) {
        input.value = String(v);
        updateValue(c.key, input.value);
      }
    }
    for (const key of PHYSICS_TOGGLES) {
      const input = physicsToggles[key];
      if (input) input.checked = config.physics[key];
    }
    for (const c of GRAPHICS_SLIDERS) {
      const v = (config.graphics as unknown as Record<string, number>)[c.key];
      const input = graphicsSliderInputs[c.key];
      if (input) {
        input.value = String(v);
        updateValue(c.key, input.value);
      }
    }
    for (const key of GRAPHICS_TOGGLES) {
      const input = graphicsToggles[key];
      if (input) input.checked = config.graphics[key];
    }
  }

  function applyPreset(name: string): void {
    if (name === "custom") return;
    config.physics = physicsPreset(name);
    config.preset = name;
    syncInputs();
    o.onChange(config);
  }

  function reset(): void {
    config.physics = organicConfig();
    // La grafica va fusa in place: il pittore chiude sull'oggetto vivo.
    Object.assign(config.graphics, defaultGraphicsConfig());
    config.preset = "organica";
    syncInputs();
    select.value = "organica";
    o.onChange(config);
  }

  // --- i listener -------------------------------------------------------

  let isOpen = false;

  function openPopover(): void {
    isOpen = true;
    popover.hidden = false;
    gear.setAttribute("aria-expanded", "true");
    // Il focus dentro il popover: la select è il primo controllo, così la
    // tastiera ci cade sopra e lo screen reader annuncia il preset prima
    // degli slider.
    const first = popover.querySelector<HTMLElement>("select, input, button");
    if (first) first.focus();
  }

  function closePopover(): void {
    isOpen = false;
    popover.hidden = true;
    gear.setAttribute("aria-expanded", "false");
    gear.focus();
    if (o.restoreFocus) o.restoreFocus();
  }

  gear.addEventListener("click", () => {
    if (isOpen) closePopover();
    else openPopover();
  });

  select.addEventListener("change", () => {
    applyPreset(select.value);
  });

  // Esc chiude il popover e rimette il focus sul canvas del grafo: il
  // pannello è un ospite della superficie, Esc lo congeda. Il listener è
  // sul popover (il focus è dentro quando aperto).
  popover.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closePopover();
    }
  });

  warmButton.addEventListener("click", () => o.onWarm());
  unpinButton.addEventListener("click", () => o.onUnpinAll());
  resetButton.addEventListener("click", () => reset());

  function updateLanguage(): void {
    const copy = o.copy();
    title.textContent = copy.title;
    presetLabel.textContent = copy.preset;
    physicsLabel.textContent = copy.title;
    graphicsLabel.textContent = copy.title;
    warmButton.textContent = copy.warm;
    unpinButton.textContent = copy.unpin;
    resetButton.textContent = copy.reset;
    gear.setAttribute("aria-label", copy.open);

    // La select: ricostruisce le option con le nuove etichette, conservando
    // la selezione corrente.
    const currentValue = select.value;
    select.replaceChildren();
    for (const name of PRESET_NAMES) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = copy.presets[name] ?? name;
      select.append(opt);
    }
    select.value = currentValue || config.preset;

    // Le etichette dei campi: ogni nome span riceve la sua chiave.
    for (const c of PHYSICS_SLIDERS) {
      const label = physicsSection.querySelector<HTMLElement>(`input[type="range"][min="${c.min}"]`);
      if (label) {
        const name = label.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (name) name.textContent = copy.fields[c.key] ?? c.key;
      }
    }
    for (const c of GRAPHICS_SLIDERS) {
      const input = graphicsSliderInputs[c.key];
      if (input) {
        const name = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (name) name.textContent = copy.fields[c.key] ?? c.key;
      }
    }
    for (const key of PHYSICS_TOGGLES) {
      const input = physicsToggles[key];
      if (input) {
        const name = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (name) name.textContent = copy.fields[key] ?? key;
      }
    }
    for (const key of GRAPHICS_TOGGLES) {
      const input = graphicsToggles[key];
      if (input) {
        const name = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (name) name.textContent = copy.fields[key] ?? key;
      }
    }
  }

  let destroyed = false;

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    // I listener vivono sui nodi che rimuoviamo: il GC li porta via con loro.
    // Non c'è un `removeEventListener` esplicito perché il DOM se ne va tutto.
    root.remove();
  }

  // Primo popolamento: etichette e valori.
  updateLanguage();
  syncInputs();
  select.value = config.preset;

  return { element: root, updateLanguage, destroy };
}