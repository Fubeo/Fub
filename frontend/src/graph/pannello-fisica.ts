// Il pannello delle impostazioni del grafo: preset, fisica e grafica. È il
// gemello editor della `conf` che `config.ts` persiste e `grafico.ts` consuma.
//
// Il montaggio è tutto qui: il pannello costruisce il suo DOM (un bottone
// ingranaggio + un popover), lo appende l'orchestratore shell. L'i18n è
// iniettato come `testi()`: il pannello non chiama `t` direttamente, perché
// i test non devono conoscere le lingue — l'orchestratore costruisce il
// `TestiPannello` da `t` e lo ripassa a `aggiornaLingua` al cambio lingua.
//
// Le etichette dei campi sono chiavi piatte in `campi`; i range min/max/step
// sono statici qui (duplicati dai `clampConf*` di `tipi.ts`, che non esportano
// i range): il pannello è l'unica superficie che li mostra all'utente, e
// tenerli accanto al markup è più leggibile di un import di costanti.

import type { ConfFisica, ConfGrafica, ConfGrafo } from "./sim/tipi";
import { confGraficaPredefinita, confOrganica } from "./sim/tipi";
import { applicaPreset } from "./config";

export interface TestiPannello {
  titolo: string;
  preset: string;
  riscalda: string;
  sblocca: string;
  reimposta: string;
  apri: string;
  chiudi: string;
  /// Nome preset → etichetta (include "custom").
  presets: Record<string, string>;
  /// Chiave campo → etichetta.
  campi: Record<string, string>;
}

export interface OpzioniPannello {
  /// La conf viva che il pannello muta. La grafica va fusa in place
  /// (`Object.assign`) e non sostituita: il pittore chiude sull'oggetto.
  conf: ConfGrafo;
  /// Chiamato a ogni cambio (slider, checkbox, preset, reimposta).
  onCambia: (conf: ConfGrafo) => void;
  onRiscalda: () => void;
  onSbloccaPanni: () => void;
  /// Ritorna i testi nella lingua corrente. Chiamato al montaggio e a ogni
  /// cambio lingua.
  testi: () => TestiPannello;
  /// Opzionale: dove rimettere il focus quando il popover si chiude con Esc
  /// (il canvas del grafo, di solito).
  riportaFocus?: () => void;
}

export interface PannelloFisica {
  /// L'elemento da appendere nell'host del grafo.
  elemento: HTMLElement;
  /// Rilegge tutti i testi e riapplica le etichette. Da chiamare al cambio
  /// lingua.
  aggiornaLingua(): void;
  /// Rimuove i listener e l'elemento dal DOM. Idempotente.
  distruggi(): void;
}

/// Un campo numerico con il suo range. I range sono gli stessi di
/// `clampConfFisica`/`clampConfGrafica`: tenuti qui perché il pannello è la
/// sola vista che li mostra, e `tipi.ts` non li esporta (non vuole dare una
/// superficie ai slider di terzi). Il `passo` è scelto per leggibilità dello
/// slider, non per la precisione del clamp (il clamp arrotonda comunque).
interface CampoSlider {
  chiave: string;
  min: number;
  max: number;
  passo: number;
}

const SLIDER_FISICI: CampoSlider[] = [
  { chiave: "repulsione", min: 200, max: 20000, passo: 200 },
  { chiave: "lunghezzaBase", min: 40, max: 400, passo: 5 },
  { chiave: "rigiditaMolla", min: 0.01, max: 1, passo: 0.01 },
  { chiave: "smorzamentoMolla", min: 0, max: 1, passo: 0.01 },
  { chiave: "gravita", min: 0, max: 0.2, passo: 0.005 },
  { chiave: "attrito", min: 0.5, max: 0.98, passo: 0.01 },
  { chiave: "maxVelocita", min: 100, max: 4000, passo: 100 },
  { chiave: "pesoGrado", min: 0, max: 3, passo: 0.05 },
  { chiave: "theta", min: 0.5, max: 1.2, passo: 0.01 },
  { chiave: "jitter", min: 0, max: 1, passo: 0.01 },
  { chiave: "raffreddamento", min: 0.9, max: 0.999, passo: 0.001 },
];

const SLIDER_GRAFICI: CampoSlider[] = [
  { chiave: "curvaturaArchi", min: 0, max: 1, passo: 0.01 },
  { chiave: "densitaEtichette", min: 0, max: 1, passo: 0.01 },
];

const TOGGLE_FISICI = ["collisioni"] as const;
const TOGGLE_GRAFICI = ["glow", "pulse", "trail", "griglia"] as const;

const NOMI_PRESET = ["organica", "costellazione", "alveare", "nebulosa", "rigido", "custom"] as const;

/// L'ingranaggio: un SVG inline piccolo. Niente emoji (vietate dalle regole),
/// niente immagine esterna (una dipendenza di troppo per un'icona).
const SVG_INGRANAGGIO =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4-1.5-.3a7.6 7.6 0 0 0-.5-1.3l.9-1.3a.6.6 0 0 0-.1-.8l-1.4-1.4a.6.6 0 0 0-.8-.1l-1.3.9a7.6 7.6 0 0 0-1.3-.5L14.7 5a.6.6 0 0 0-.6-.5h-2a.6.6 0 0 0-.6.5l-.3 1.5a7.6 7.6 0 0 0-1.3.5l-1.3-.9a.6.6 0 0 0-.8.1L6.4 7.7a.6.6 0 0 0-.1.8l.9 1.3a7.6 7.6 0 0 0-.5 1.3L5.2 11.6a.6.6 0 0 0-.5.6v2a.6.6 0 0 0 .5.6l1.5.3a7.6 7.6 0 0 0 .5 1.3l-.9 1.3a.6.6 0 0 0 .1.8l1.4 1.4a.6.6 0 0 0 .8.1l1.3-.9a7.6 7.6 0 0 0 1.3.5l.3 1.5a.6.6 0 0 0 .6.5h2a.6.6 0 0 0 .6-.5l.3-1.5a7.6 7.6 0 0 0 1.3-.5l1.3.9a.6.6 0 0 0 .8-.1l1.4-1.4a.6.6 0 0 0 .1-.8l-.9-1.3a7.6 7.6 0 0 0 .5-1.3l1.5-.3a.6.6 0 0 0 .5-.6v-2a.6.6 0 0 0-.6-.6z"/>' +
  "</svg>";

export function creaPannelloFisica(o: OpzioniPannello): PannelloFisica {
  const { conf } = o;
  const radice = document.createElement("div");
  radice.className = "graph-panel";

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "graph-panel-toggle";
  gear.setAttribute("aria-haspopup", "true");
  gear.setAttribute("aria-expanded", "false");
  gear.innerHTML = SVG_INGRANAGGIO;
  radice.append(gear);

  const popover = document.createElement("div");
  popover.className = "graph-panel-popover";
  popover.hidden = true;
  radice.append(popover);

  const titolo = document.createElement("h2");
  titolo.className = "graph-panel-titolo";
  popover.append(titolo);

  const rigaPreset = document.createElement("label");
  rigaPreset.className = "graph-panel-campo graph-panel-preset";
  const presetLabel = document.createElement("span");
  presetLabel.className = "graph-panel-nome";
  rigaPreset.append(presetLabel);
  const select = document.createElement("select");
  select.className = "graph-panel-select";
  rigaPreset.append(select);
  popover.append(rigaPreset);

  // Riferimenti ai valori numerici mostrati accanto agli slider: si
  // aggiornano sull'input e si resettano sul cambio preset/reimposta.
  const valori: Record<string, HTMLElement> = {};
  // Riferimenti agli input per poterli risincronizzare sui valori della conf
  // quando un preset li cambia dall'esterno.
  const inputFisici: Record<string, HTMLInputElement> = {};
  const inputGraficiSlider: Record<string, HTMLInputElement> = {};
  const toggleFisici: Record<string, HTMLInputElement> = {};
  const toggleGrafici: Record<string, HTMLInputElement> = {};

  const sezioneFisica = document.createElement("div");
  sezioneFisica.className = "graph-panel-sezione";
  const etichettaFisica = document.createElement("div");
  etichettaFisica.className = "graph-panel-sezione-titolo";
  sezioneFisica.append(etichettaFisica);
  popover.append(sezioneFisica);

  for (const c of SLIDER_FISICI) {
    const riga = document.createElement("label");
    riga.className = "graph-panel-campo";
    const nome = document.createElement("span");
    nome.className = "graph-panel-nome";
    riga.append(nome);
    const valore = document.createElement("span");
    valore.className = "graph-panel-valore";
    riga.append(valore);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.passo);
    input.value = String((conf.fisica as unknown as Record<string, number>)[c.chiave]);
    riga.append(input);
    sezioneFisica.append(riga);
    valori[c.chiave] = valore;
    inputFisici[c.chiave] = input;
    nome.textContent = c.chiave; // placeholder, sovrascritto da aggiornaLingua
    aggiornaValore(c.chiave, input.value);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      // La fisica è un nuovo oggetto: il grafico la sostituirà (nuovo
      // riferimento) a ogni impostaConf, qui si riassegna per coerenza.
      conf.fisica = { ...conf.fisica, [c.chiave]: v } as ConfFisica;
      conf.preset = "custom";
      aggiornaValore(c.chiave, input.value);
      o.onCambia(conf);
    });
  }

  for (const chiave of TOGGLE_FISICI) {
    const riga = creaToggle(chiave, conf.fisica[chiave], (v) => {
      conf.fisica = { ...conf.fisica, [chiave]: v } as ConfFisica;
      conf.preset = "custom";
      o.onCambia(conf);
    });
    sezioneFisica.append(riga.elemento);
    toggleFisici[chiave] = riga.input;
  }

  const sezioneGrafica = document.createElement("div");
  sezioneGrafica.className = "graph-panel-sezione";
  const etichettaGrafica = document.createElement("div");
  etichettaGrafica.className = "graph-panel-sezione-titolo";
  sezioneGrafica.append(etichettaGrafica);
  popover.append(sezioneGrafica);

  for (const chiave of TOGGLE_GRAFICI) {
    const riga = creaToggle(chiave, conf.grafica[chiave], (v) => {
      // La grafica si fonde in place: il pittore chiude sull'oggetto vivo e
      // sostituirlo lo orfanerebbe. `Object.assign` muta lo stesso riferimento.
      Object.assign(conf.grafica, { [chiave]: v } as Partial<ConfGrafica>);
      o.onCambia(conf);
    });
    sezioneGrafica.append(riga.elemento);
    toggleGrafici[chiave] = riga.input;
  }

  for (const c of SLIDER_GRAFICI) {
    const riga = document.createElement("label");
    riga.className = "graph-panel-campo";
    const nome = document.createElement("span");
    nome.className = "graph-panel-nome";
    riga.append(nome);
    const valore = document.createElement("span");
    valore.className = "graph-panel-valore";
    riga.append(valore);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.passo);
    input.value = String((conf.grafica as unknown as Record<string, number>)[c.chiave]);
    riga.append(input);
    sezioneGrafica.append(riga);
    valori[c.chiave] = valore;
    inputGraficiSlider[c.chiave] = input;
    nome.textContent = c.chiave;
    aggiornaValore(c.chiave, input.value);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      Object.assign(conf.grafica, { [c.chiave]: v } as Partial<ConfGrafica>);
      aggiornaValore(c.chiave, input.value);
      o.onCambia(conf);
    });
  }

  const azioni = document.createElement("div");
  azioni.className = "graph-panel-azioni";
  const btnRiscalda = document.createElement("button");
  btnRiscalda.type = "button";
  const btnSblocca = document.createElement("button");
  btnSblocca.type = "button";
  const btnReimposta = document.createElement("button");
  btnReimposta.type = "button";
  azioni.append(btnRiscalda, btnSblocca, btnReimposta);
  popover.append(azioni);

  function aggiornaValore(chiave: string, v: string): void {
    const el = valori[chiave];
    if (el) el.textContent = formatta(v);
  }

  function formatta(v: string): string {
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

  function creaToggle(chiave: string, iniziale: boolean, onCambia: (v: boolean) => void): { elemento: HTMLElement; input: HTMLInputElement } {
    const riga = document.createElement("label");
    riga.className = "graph-panel-campo graph-panel-toggle";
    const nome = document.createElement("span");
    nome.className = "graph-panel-nome";
    riga.append(nome);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = iniziale;
    // `data-campo` rende il checkbox selezionabile per chiave nei test e
    // nello stile futuro, senza contare sull'ordine nel DOM.
    input.dataset.campo = chiave;
    riga.append(input);
    input.addEventListener("change", () => onCambia(input.checked));
    return { elemento: riga, input };
  }


  /// Aggiorna gli input fisici (slider + toggle) ai valori correnti della
  /// conf. Chiamata dopo un cambio preset e dopo «Reimposta», quando la
  /// conf cambia dall'esterno del gesto diretto dell'utente.
  function sincronizzaInput(): void {
    for (const c of SLIDER_FISICI) {
      const v = (conf.fisica as unknown as Record<string, number>)[c.chiave];
      const input = inputFisici[c.chiave];
      if (input) {
        input.value = String(v);
        aggiornaValore(c.chiave, input.value);
      }
    }
    for (const chiave of TOGGLE_FISICI) {
      const input = toggleFisici[chiave];
      if (input) input.checked = conf.fisica[chiave];
    }
    for (const c of SLIDER_GRAFICI) {
      const v = (conf.grafica as unknown as Record<string, number>)[c.chiave];
      const input = inputGraficiSlider[c.chiave];
      if (input) {
        input.value = String(v);
        aggiornaValore(c.chiave, input.value);
      }
    }
    for (const chiave of TOGGLE_GRAFICI) {
      const input = toggleGrafici[chiave];
      if (input) input.checked = conf.grafica[chiave];
    }
  }

  function impostaPreset(nome: string): void {
    if (nome === "custom") return;
    conf.fisica = applicaPreset(nome);
    conf.preset = nome;
    sincronizzaInput();
    o.onCambia(conf);
  }

  function reimposta(): void {
    conf.fisica = confOrganica();
    // La grafica va fusa in place: il pittore chiude sull'oggetto vivo.
    Object.assign(conf.grafica, confGraficaPredefinita());
    conf.preset = "organica";
    sincronizzaInput();
    select.value = "organica";
    o.onCambia(conf);
  }

  // --- i listener -------------------------------------------------------

  let aperto = false;

  function apriPopover(): void {
    aperto = true;
    popover.hidden = false;
    gear.setAttribute("aria-expanded", "true");
    // Il focus dentro il popover: la select è il primo controllo, così la
    // tastiera ci cade sopra e lo screen reader annuncia il preset prima
    // degli slider.
    const primo = popover.querySelector<HTMLElement>("select, input, button");
    if (primo) primo.focus();
  }

  function chiudiPopover(): void {
    aperto = false;
    popover.hidden = true;
    gear.setAttribute("aria-expanded", "false");
    gear.focus();
    if (o.riportaFocus) o.riportaFocus();
  }

  gear.addEventListener("click", () => {
    if (aperto) chiudiPopover();
    else apriPopover();
  });

  select.addEventListener("change", () => {
    impostaPreset(select.value);
  });

  // Esc chiude il popover e rimette il focus sul canvas del grafo: il
  // pannello è un ospite della superficie, Esc lo congeda. Il listener è
  // sul popover (il focus è dentro quando aperto).
  popover.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && aperto) {
      e.preventDefault();
      chiudiPopover();
    }
  });

  btnRiscalda.addEventListener("click", () => o.onRiscalda());
  btnSblocca.addEventListener("click", () => o.onSbloccaPanni());
  btnReimposta.addEventListener("click", () => reimposta());

  function aggiornaLingua(): void {
    const testi = o.testi();
    titolo.textContent = testi.titolo;
    presetLabel.textContent = testi.preset;
    etichettaFisica.textContent = testi.titolo;
    etichettaGrafica.textContent = testi.titolo;
    btnRiscalda.textContent = testi.riscalda;
    btnSblocca.textContent = testi.sblocca;
    btnReimposta.textContent = testi.reimposta;
    gear.setAttribute("aria-label", testi.apri);

    // La select: ricostruisce le option con le nuove etichette, conservando
    // la selezione corrente.
    const valoreCorrente = select.value;
    select.replaceChildren();
    for (const nome of NOMI_PRESET) {
      const opt = document.createElement("option");
      opt.value = nome;
      opt.textContent = testi.presets[nome] ?? nome;
      select.append(opt);
    }
    select.value = valoreCorrente || conf.preset;

    // Le etichette dei campi: ogni nome span riceve la sua chiave.
    for (const c of SLIDER_FISICI) {
      const label = sezioneFisica.querySelector<HTMLElement>(`input[type="range"][min="${c.min}"]`);
      if (label) {
        const nome = label.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (nome) nome.textContent = testi.campi[c.chiave] ?? c.chiave;
      }
    }
    for (const c of SLIDER_GRAFICI) {
      const input = inputGraficiSlider[c.chiave];
      if (input) {
        const nome = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (nome) nome.textContent = testi.campi[c.chiave] ?? c.chiave;
      }
    }
    for (const chiave of TOGGLE_FISICI) {
      const input = toggleFisici[chiave];
      if (input) {
        const nome = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (nome) nome.textContent = testi.campi[chiave] ?? chiave;
      }
    }
    for (const chiave of TOGGLE_GRAFICI) {
      const input = toggleGrafici[chiave];
      if (input) {
        const nome = input.parentElement?.querySelector<HTMLElement>(".graph-panel-nome");
        if (nome) nome.textContent = testi.campi[chiave] ?? chiave;
      }
    }
  }

  let distrutto = false;

  function distruggi(): void {
    if (distrutto) return;
    distrutto = true;
    // I listener vivono sui nodi che rimuoviamo: il GC li porta via con loro.
    // Non c'è un `removeEventListener` esplicito perché il DOM se ne va tutto.
    radice.remove();
  }

  // Primo popolamento: etichette e valori.
  aggiornaLingua();
  sincronizzaInput();
  select.value = conf.preset;

  return { elemento: radice, aggiornaLingua, distruggi };
}