// @vitest-environment happy-dom
// Test di `grafico.ts`: l'orchestratore. Tutto è iniettato per determinismo:
// il pittore e l'interazione sono stub che registrano gli stati disegnati e
// le azioni; l'orologio e il `requestAnimationFrame` sono finti e si fanno
// avanzare a mano. Niente `performance.now`, niente Canvas2D, niente RO reali.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { creaGrafico, type Grafico, type OpzioniGrafico } from "./grafico";
import type { ConfGrafica, ConfGrafo, DatiGrafo, Struttura } from "./sim/tipi";
import { confGraficaPredefinita, confOrganica } from "./sim/tipi";
import type { AzioniInterazione, Interazione, OpzioniInterazione } from "./interazione";
import type { Pittore, StatoDisegno } from "./render/pittore";

// --- i dati di prova --------------------------------------------------------

const DATI: DatiGrafo = {
  nodes: ["n0", "n1", "n2", "n3"],
  edges: [
    { from: "n0", to: "n1" },
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ],
};

const CONF: ConfGrafo = {
  fisica: { ...confOrganica(), raffreddamento: 0.9 },
  grafica: confGraficaPredefinita(),
  preset: "custom",
};

// --- gli stub (con tipo nominato, non ReturnType) --------------------------

interface ChiamatePittore {
  ridisegna: number;
  ridisegnaSfondo: number;
  ridimensiona: number;
  distruggi: number;
}

interface StubPittore extends Pittore {
  stati: StatoDisegno[];
  grafica: ConfGrafica;
  chiamate: ChiamatePittore;
}

interface ChiamateInterazione {
  distruggi: number;
  impostaEtichettaA11y: number;
  focusNodo: number;
}

interface StubInterazione extends Interazione {
  azioni: AzioniInterazione | null;
  struttura: () => Struttura;
  focalizzato: number;
  chiamate: ChiamateInterazione;
}

// Le factory catturano l'ultima istanza creata, così i test possono leggerla.
let ultimoPittore: StubPittore | null = null;
let ultimaInterazione: StubInterazione | null = null;

function factoryPittore(): (host: HTMLElement, grafica: ConfGrafica) => StubPittore {
  return (host: HTMLElement, grafica: ConfGrafica) => {
    // Il pittore vero crea i canvas; lo stub fa lo stesso perché il grafico
    // cerca `canvas.graph-main` per agganciare i listener dell'hover.
    const bg = document.createElement("canvas");
    bg.className = "graph-bg";
    const main = document.createElement("canvas");
    main.className = "graph-main";
    host.append(bg, main);
    const p: StubPittore = {
      stati: [],
      grafica,
      chiamate: { ridisegna: 0, ridisegnaSfondo: 0, ridimensiona: 0, distruggi: 0 },
      ridisegna(stato) {
        p.chiamate.ridisegna++;
        p.stati.push(stato);
      },
      ridisegnaSfondo() {
        p.chiamate.ridisegnaSfondo++;
      },
      aggiornaTinte() {},
      ridimensiona() {
        p.chiamate.ridimensiona++;
      },
      distruggi() {
        p.chiamate.distruggi++;
      },
    };
    ultimoPittore = p;
    return p;
  };
}

function factoryInterazione(): (o: OpzioniInterazione) => StubInterazione {
  return (o: OpzioniInterazione) => {
    const stub: StubInterazione = {
      azioni: o.azioni,
      struttura: o.strutturaRef,
      focalizzato: -1,
      chiamate: { distruggi: 0, impostaEtichettaA11y: 0, focusNodo: 0 },
      distruggi() {
        stub.chiamate.distruggi++;
      },
      impostaEtichettaA11y() {
        stub.chiamate.impostaEtichettaA11y++;
      },
      focusNodo(i: number) {
        stub.chiamate.focusNodo++;
        stub.focalizzato = i;
      },
      leggiFocalizzato() {
        return stub.focalizzato;
      },
    };
    ultimaInterazione = stub;
    return stub;
  };
}

// --- l'orologio e il rAF finti ---------------------------------------------

interface Finestra {
  t: number;
  coda: Array<() => void>;
  contatore: number;
  cancellati: number[];
}

function finestraVuota(): Finestra {
  return { t: 0, coda: [], contatore: 1, cancellati: [] };
}

function programmaFinestra(f: Finestra): (cb: () => void) => number {
  return (cb: () => void) => {
    const id = f.contatore++;
    f.coda.push(cb);
    return id;
  };
}

function cancellaFinestra(f: Finestra): (id: number) => void {
  return (id: number) => {
    f.cancellati.push(id);
  };
}

/// Esegue la coda dei rAF finché si svuota o si raggiunge il tetto. L'orologio
/// avanza di 16.7 ms (≈60 fps) a ogni frame.
function esegui(f: Finestra, max = 5000): void {
  let n = 0;
  while (f.coda.length > 0 && n < max) {
    const cb = f.coda.shift()!;
    f.t += 16.7;
    cb();
    n++;
  }
}

function hostFinto(): HTMLElement {
  return document.createElement("div");
}

function opzioniBase(f: Finestra): OpzioniGrafico {
  return {
    dati: DATI,
    conf: CONF,
    creaPittore: factoryPittore(),
    creaInterazione: factoryInterazione(),
    orologio: () => f.t,
    programma: programmaFinestra(f),
    cancella: cancellaFinestra(f),
  };
}

// --- i test ----------------------------------------------------------------

describe("creaGrafico", () => {
  let f: Finestra;
  let g: Grafico;

  beforeEach(() => {
    f = finestraVuota();
    ultimoPittore = null;
    ultimaInterazione = null;
    g = creaGrafico(opzioniBase(f));
  });

  afterEach(() => {
    g.smonta();
    vi.unstubAllGlobals();
  });

  it("monta e disegna: la struttura ha 4 nodi e 3 archi", () => {
    g.monta(hostFinto());
    esegui(f, 5);
    expect(ultimoPittore).not.toBeNull();
    expect(ultimoPittore!.stati.length).toBeGreaterThan(0);
    expect(ultimoPittore!.stati[0].s.n).toBe(4);
    expect(ultimoPittore!.stati[0].s.m).toBe(3);
  });

  it("il loop si spegne quando la sim si raffredda (alpha <= 0.02)", () => {
    g.monta(hostFinto());
    esegui(f, 5000);
    // Con raffreddamento 0.9 e ~60 fps, alpha decade sotto 0.02 in ~25 passi.
    expect(f.coda.length).toBe(0);
    const ultimo = ultimoPittore!.stati[ultimoPittore!.stati.length - 1];
    expect(ultimo.alpha).toBeLessThanOrEqual(0.02);
  });

  it("apri: il gestore assegnato riceve l'id quando l'interazione chiama azioni.apri", () => {
    g.monta(hostFinto());
    let chiamato = "";
    g.apri = (id: string) => {
      chiamato = id;
    };
    esegui(f, 3);
    expect(ultimaInterazione).not.toBeNull();
    ultimaInterazione!.azioni!.apri("n2");
    expect(chiamato).toBe("n2");
  });

  it("riscalda: riporta alpha al livello e riaccende il loop", () => {
    g.monta(hostFinto());
    esegui(f, 5000);
    g.riscalda(1);
    expect(f.coda.length).toBeGreaterThan(0);
    // Un frame: alpha parte da 1 e il primo passo lo riduce di un fattore
    // di raffreddamento — ma deve restare alto (vicino a 0.9 con raffreddamento 0.9).
    esegui(f, 1);
    const ultimo = ultimoPittore!.stati[ultimoPittore!.stati.length - 1];
    expect(ultimo.alpha).toBeGreaterThanOrEqual(0.85);
  });

  it("impostaAperti: un cambio reale ridisegna; un no-change no", () => {
    g.monta(hostFinto());
    esegui(f, 5000);
    const prima = ultimoPittore!.stati.length;
    g.impostaAperti(new Set());
    esegui(f, 5);
    expect(ultimoPittore!.stati.length).toBe(prima);
    g.impostaAperti(new Set(["n1"]));
    esegui(f, 5);
    expect(ultimoPittore!.stati.length).toBeGreaterThan(prima);
    const ultimo = ultimoPittore!.stati[ultimoPittore!.stati.length - 1];
    expect(ultimo.aperti.has("n1")).toBe(true);
  });

  it("impostaConf: sostituisce la fisica e fonde la grafica viva (stesso rif)", () => {
    g.monta(hostFinto());
    esegui(f, 5000);
    const graficaPrima = ultimoPittore!.grafica;
    g.impostaConf({
      fisica: { ...confOrganica(), repulsione: 9999, raffreddamento: 0.9 },
      grafica: { ...confGraficaPredefinita(), glow: false, griglia: false },
      preset: "custom",
    });
    esegui(f, 5);
    expect(ultimoPittore!.grafica).toBe(graficaPrima);
    expect(graficaPrima.glow).toBe(false);
    expect(graficaPrima.griglia).toBe(false);
  });

  it("sbloccaNodi: azzera i fissi e il trascinato", () => {
    g.monta(hostFinto());
    esegui(f, 3);
    const s = ultimaInterazione!.struttura();
    s.fisso[0] = 1;
    s.trascinato = 2;
    g.sbloccaNodi();
    esegui(f, 3);
    expect(s.fisso[0]).toBe(0);
    expect(s.trascinato).toBe(-1);
  });

  it("il loop si spegne dopo aver rilasciato un nodo trascinato", () => {
    g.monta(hostFinto());
    esegui(f, 5000);
    expect(f.coda.length).toBe(0);
    const s = ultimaInterazione!.struttura();
    // Trascinato tiene il loop acceso.
    s.trascinato = 0;
    g.riscalda(0.3);
    esegui(f, 5);
    // Rilasciato: il loop si spegne.
    s.trascinato = -1;
    esegui(f, 5000);
    expect(f.coda.length).toBe(0);
  });

  it("hover: un pointermove su un nodo disegna un frame con hovered >= 0", () => {
    const host = hostFinto();
    g.monta(host);
    esegui(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    expect(canvas).not.toBeNull();
    // La semina mette i nodi attorno all'origine in coordinate mondo.
    // getBoundingClientRect in happy-dom ritorna 0,0, quindi clientX/Y
    // passano diretti a nodoIn. Con scala 1 e traslazione 0, il nodo i è
    // a schermo in (s.x[i], s.y[i]).
    const s = ultimaInterazione!.struttura();
    const before = ultimoPittore!.stati.length;
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    esegui(f, 5);
    expect(ultimoPittore!.stati.length).toBeGreaterThan(before);
    const ultimo = ultimoPittore!.stati[ultimoPittore!.stati.length - 1];
    expect(ultimo.hovered).toBeGreaterThanOrEqual(0);
  });

  it("pointerleave: azzera hovered e ridisegna", () => {
    const host = hostFinto();
    g.monta(host);
    esegui(f, 5000);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    const s = ultimaInterazione!.struttura();
    // Prima un move che colpisce un nodo (hovered >= 0), poi leave.
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: s.x[0], clientY: s.y[0] }),
    );
    esegui(f, 5);
    const primaLeave = ultimoPittore!.stati.length;
    canvas!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    esegui(f, 5);
    expect(ultimoPittore!.stati.length).toBeGreaterThan(primaLeave);
    const ultimo = ultimoPittore!.stati[ultimoPittore!.stati.length - 1];
    expect(ultimo.hovered).toBe(-1);
  });

  it("smonta: distrugge pittore e interazione, ferma il loop", () => {
    g.monta(hostFinto());
    esegui(f, 3);
    g.smonta();
    expect(ultimoPittore!.chiamate.distruggi).toBe(1);
    expect(ultimaInterazione!.chiamate.distruggi).toBe(1);
    const prima = ultimoPittore!.stati.length;
    esegui(f, 10);
    expect(ultimoPittore!.stati.length).toBe(prima);
  });

  it("impostaEtichettaA11y: delega all'interazione", () => {
    g.monta(hostFinto());
    esegui(f, 3);
    g.impostaEtichettaA11y("etichetta di prova");
    expect(ultimaInterazione!.chiamate.impostaEtichettaA11y).toBe(1);
  });

  it("fit iniziale differito: con viewport 0 la camera resta a scala 1", () => {
    // happy-dom: getBoundingClientRect ritorna 0,0 → viewport 0 → fit differito.
    g.monta(hostFinto());
    esegui(f, 10);
    expect(ultimoPittore!.stati[0].camera.scala).toBe(1);
  });
});