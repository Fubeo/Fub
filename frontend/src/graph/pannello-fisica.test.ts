// @vitest-environment happy-dom
// Test di `pannello-fisica.ts`: il pannello delle impostazioni del grafo.
// I testi sono iniettati (il pannello non chiama `t`): così i test non
// conoscono le lingue e verificano solo il comportamento del DOM.

import { describe, expect, it, beforeEach } from "vitest";
import { creaPannelloFisica, type TestiPannello } from "./pannello-fisica";
import type { ConfGrafo } from "./sim/tipi";
import { confGraficaPredefinita, confOrganica } from "./sim/tipi";

// --- i testi finti ----------------------------------------------------------

function testi(): TestiPannello {
  return {
    titolo: "Fisica del grafo",
    preset: "Personalità",
    riscalda: "Riscalda",
    sblocca: "Sblocca nodi",
    reimposta: "Reimposta",
    apri: "Apri impostazioni",
    chiudi: "Chiudi impostazioni",
    presets: {
      organica: "Organica",
      costellazione: "Costellazione",
      alveare: "Alveare",
      nebulosa: "Nebulosa",
      rigido: "Rigido",
      custom: "Personalizzata",
    },
    campi: {
      repulsione: "Repulsione",
      lunghezzaBase: "Lunghezza molle",
      rigiditaMolla: "Rigidità molle",
      smorzamentoMolla: "Smorzamento",
      gravita: "Gravità",
      attrito: "Attrito",
      maxVelocita: "Velocità massima",
      pesoGrado: "Peso del grado",
      collisioni: "Collisioni",
      theta: "Apertura Barnes-Hut",
      jitter: "Jitter iniziale",
      raffreddamento: "Raffreddamento",
      glow: "Bagliore",
      pulse: "Pulsazione",
      trail: "Scie",
      griglia: "Griglia",
      curvaturaArchi: "Curvatura archi",
      densitaEtichette: "Densità etichette",
    },
  };
}

function confIniziale(): ConfGrafo {
  return {
    fisica: confOrganica(),
    grafica: confGraficaPredefinita(),
    preset: "organica",
  };
}

describe("creaPannelloFisica", () => {
  let conf: ConfGrafo;
  let cambi: ConfGrafo[];
  let riscaldaChiamato: boolean;
  let sbloccaChiamato: boolean;

  beforeEach(() => {
    conf = confIniziale();
    cambi = [];
    riscaldaChiamato = false;
    sbloccaChiamato = false;
  });

  function crea() {
    return creaPannelloFisica({
      conf,
      onCambia: (c) => cambi.push(c),
      onRiscalda: () => {
        riscaldaChiamato = true;
      },
      onSbloccaPanni: () => {
        sbloccaChiamato = true;
      },
      testi,
    });
  }

  it("costruisce il DOM: un bottone gear e un popover nascosto", () => {
    const p = crea();
    const toggle = p.elemento.querySelector("button.graph-panel-toggle");
    const popover = p.elemento.querySelector(".graph-panel-popover");
    expect(toggle).not.toBeNull();
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute("hidden")).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    p.distruggi();
  });

  it("il click sul gear apre il popover e inverte aria-expanded", () => {
    const p = crea();
    const toggle = p.elemento.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    toggle.click();
    const popover = p.elemento.querySelector<HTMLElement>(".graph-panel-popover")!;
    expect(popover.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Un secondo click chiude.
    toggle.click();
    expect(popover.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    p.distruggi();
  });

  it("cambio slider fisico: onCambia con preset custom e il nuovo valore", () => {
    const p = crea();
    const slider = p.elemento.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    slider!.value = "5000";
    slider!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cambi.length).toBe(1);
    expect(cambi[0].preset).toBe("custom");
    expect(cambi[0].fisica.repulsione).toBe(5000);
    p.distruggi();
  });

  it("toggle grafico (glow): onCambia senza cambiare il preset", () => {
    const p = crea();
    const checkbox = p.elemento.querySelector<HTMLInputElement>('input[data-campo="glow"]');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cambi.length).toBe(1);
    expect(cambi[0].preset).toBe("organica");
    expect(cambi[0].grafica.glow).toBe(false);
    p.distruggi();
  });

  it("cambio preset: onCambia con la fisica del preset e preset aggiornato", () => {
    const p = crea();
    const select = p.elemento.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    select.value = "rigido";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cambi.length).toBe(1);
    expect(cambi[0].preset).toBe("rigido");
    // La fisica del pannello è ora quella del preset rigido.
    expect(conf.fisica.repulsione).toBe(confOrganica().repulsione);
    expect(conf.fisica.rigiditaMolla).toBe(0.35);
    p.distruggi();
  });

  it("reimposta: riporta a organica + grafica predefinita", () => {
    const p = crea();
    // Prima cambia qualcosa.
    const select = p.elemento.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    select.value = "rigido";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    cambi.length = 0;
    // Poi reimposta.
    const btnReimposta = Array.from(p.elemento.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Reimposta",
    )!;
    btnReimposta.click();
    expect(cambi.length).toBe(1);
    expect(cambi[0].preset).toBe("organica");
    expect(conf.fisica).toEqual(confOrganica());
    expect(conf.grafica).toEqual(confGraficaPredefinita());
    p.distruggi();
  });

  it("riscalda: chiama onRiscalda", () => {
    const p = crea();
    const btn = Array.from(p.elemento.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Riscalda",
    )!;
    btn.click();
    expect(riscaldaChiamato).toBe(true);
    p.distruggi();
  });

  it("sblocca: chiama onSbloccaPanni", () => {
    const p = crea();
    const btn = Array.from(p.elemento.querySelectorAll<HTMLButtonElement>(".graph-panel-azioni button")).find(
      (b) => b.textContent === "Sblocca nodi",
    )!;
    btn.click();
    expect(sbloccaChiamato).toBe(true);
    p.distruggi();
  });

  it("Esc chiude il popover aperto e chiama riportaFocus", () => {
    let focusRimesso = false;
    const p = creaPannelloFisica({
      conf,
      onCambia: (c) => cambi.push(c),
      onRiscalda: () => {},
      onSbloccaPanni: () => {},
      testi,
      riportaFocus: () => {
        focusRimesso = true;
      },
    });
    const toggle = p.elemento.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    toggle.click();
    const popover = p.elemento.querySelector<HTMLElement>(".graph-panel-popover")!;
    expect(popover.hidden).toBe(false);
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(focusRimesso).toBe(true);
    p.distruggi();
  });

  it("aggiornaLingua: riapplica le etichette", () => {
    const p = crea();
    const toggle = p.elemento.querySelector<HTMLButtonElement>("button.graph-panel-toggle")!;
    expect(toggle.getAttribute("aria-label")).toBe("Apri impostazioni");
    // Forza un cambio di testi.
    p.aggiornaLingua();
    // Verifica che la select ha le option.
    const select = p.elemento.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("Organica");
    expect(options).toContain("Rigido");
    expect(options).toContain("Personalizzata");
    p.distruggi();
  });

  it("distruggi: rimuove l'elemento dal DOM", () => {
    const p = crea();
    document.body.append(p.elemento);
    expect(document.body.contains(p.elemento)).toBe(true);
    p.distruggi();
    expect(document.body.contains(p.elemento)).toBe(false);
  });

  it("il select mostra il preset iniziale della conf", () => {
    conf.preset = "rigido";
    const p = crea();
    const select = p.elemento.querySelector<HTMLSelectElement>("select.graph-panel-select")!;
    expect(select.value).toBe("rigido");
    p.distruggi();
  });
});