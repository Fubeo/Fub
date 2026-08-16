// L'orchestratore del grafo 2.0: lega il motore, il pittore e l'interazione a un
// `requestAnimationFrame` che si accende quando c'è da animare e si spegne
// quando il grafo si quieta — niente polling, niente timer. Il pannello di
// fisica è un suo pari (l'editor della conf), non un figlio: il grafico non lo
// conosce, sa solo che qualcosa chiama `impostaConf`.
//
// L'aggiramento del contratto: `Interazione` (lotto B) non espone `hovered`,
// ma `StatoDisegno` lo vuole e il pittore ne fa il focus. Invece di toccare il
// lotto B, qui aggancchiamo i nostri `pointermove`/`pointerleave` sul canvas
// principale e richiamiamo `nodoIn` (pura, esportata da `interazione.ts`): la
// stessa hit-test che usa l'interazione, ma letta da noi. L'interazione tiene
// la sua macchina a stati (drag, pan, zoom, click) e riceve gli stessi eventi
// — i due ascoltatori coesistono, perché l'interazione cattura il puntatore
// solo al `pointerdown`, non al `pointermove`. L'attrito è nel report.

import type { ConfFisica, ConfGrafica, ConfGrafo, DatiGrafo, Struttura, Tier } from "./sim/tipi";
import {
  clampConfFisica,
  clampConfGrafica,
  confGraficaPredefinita,
  confOrganica,
  creaStruttura,
  semeDi,
} from "./sim/tipi";
import type { Quadtree } from "./sim/quadtree";
import { PoolQuad, costruisci } from "./sim/quadtree";
import { DT_MAX, calcolaTier, passo, type StatoMotore } from "./sim/motore";
import type { BoundMondo, Camera, CameraStato, Viewport } from "./render/camera";
import { creaCameraStato } from "./render/camera";
import type { Pittore, StatoDisegno } from "./render/pittore";
import { creaPittore } from "./render/pittore";
import type { Interazione, OpzioniInterazione } from "./interazione";
import { creaInterazione, nodoIn } from "./interazione";

/// L'alpha sotto cui il disegno è statico: il pittore non traccia trail né
/// pulse sotto questa soglia (sono le sue `SOGLIA_TRAIL`/`SOGLIA_PULSE`), quindi
/// tenere il rAF acceso sotto non produrrebbe nulla di visibile. È la soglia
/// di attività del loop.
const SOGLIA_ATTIVO = 0.02;
/// Sopra questa dimensione (px) un riquadro è considerato visibile e ci si può
/// inquadrare il grafo. Sotto (tab nascosta, host collassato) il fit è
/// differito al momento in cui c'è davvero una superficie — questo chiude
/// strutturalmente il bug 2-1 (la sim non parte con k = 0 e scala 1).
const VISTA_MINIMA = 50;
/// Passi di quiete prima del secondo fit: il grafo si è disteso, l'inquadra
/// iniziale era sulla semina e ora contiene il grafo vero. Morbido: il loop
/// resta acceso finché la camera non converge, poi si spegne.
const FIT_QUIETE_PASSI = 30;
/// Fattore dell'EMA dei millisecondi per frame: un filtro lento, perché il
/// tier non deve oscillare a ogni capriccio del GC.
const EMA_ALFA = 0.1;

/// Una factory di pittore iniettabile per i test (happy-dom: `getContext`
/// ritorna null e il pittore vero è un no-op sicuro; i test vogliono però
/// osservare gli stati disegnati).
export type FactoryPittore = (host: HTMLElement, conf: ConfGrafica) => Pittore;
export type FactoryInterazione = (opzioni: OpzioniInterazione) => Interazione;
export type Oratore = () => number;
export type Programmatore = (cb: () => void) => number;
export type Cancellatore = (id: number) => void;

export interface OpzioniGrafico {
  /// I dati del provider `fub:graph`. Se assenti, un grafo vuoto (monta senza
  /// nodi è legittimo: il pannello e il conto vivono lo stesso).
  dati?: DatiGrafo;
  /// La conf iniziale; in sua assenza si usa la predefinita. Il grafico non
  /// si tiene un riferimento a questo oggetto: ne estrae fisica e grafica
  /// (clampate) e vive con quelli. `impostaConf` sostituisce la fisica e
  /// muta in place la grafica viva che il pittore chiude.
  conf?: ConfGrafo;
  /// Per i test. Iniettare `creaPittore`/`creaInterazione` per osservare
  /// gli stati; `orologio`/`programma`/`cancella` per determinismo senza
  /// `performance.now` né `requestAnimationFrame` reali.
  creaPittore?: FactoryPittore;
  creaInterazione?: FactoryInterazione;
  orologio?: Oratore;
  programma?: Programmatore;
  cancella?: Cancellatore;
}

export interface Grafico {
  /// Aggancia i canvas, il pittore e l'interazione all'host e accende il
  /// primo frame. Idempotente.
  monta(host: HTMLElement): void;
  /// Stacca tutto: rAF, ResizeObserver, pittore, interazione, listener. Una
  /// seconda chiamata è un no-op.
  smonta(): void;
  /// Il gestore dell'apertura nota: lo assegna l'orchestratore shell dopo la
  /// creazione, perché il grafico non conosce `onAction`. Al click su un nodo,
  /// l'interazione lo chiama.
  apri: (id: string) => void;
  /// Sostituisce l'insieme delle note aperte (per il quartiere acceso). Un
  /// cambio reale ridisegna una volta; un no-change non fa nulla.
  impostaAperti(aperti: ReadonlySet<string>): void;
  /// Applica una conf nuova: la fisica è sostituita (nuovo oggetto, clampato),
  /// la grafica è fusa nell'oggetto vivo che il pittore chiude (così non si
  /// perde la grafica sostituendo il riferimento). Il preset non è tracciato
  /// qui: lo gestiscono `config.ts` e il pannello.
  impostaConf(conf: ConfGrafo): void;
  /// Riporta l'alpha al livello dato e azzera la quiete: la sim riparte.
  riscalda(livello: number): void;
  /// Toglie tutti i pin e il drag: i nodi tornano liberi.
  sbloccaNodi(): void;
  /// L'aria del canvas (role/aria-label) per la tastiera.
  impostaEtichettaA11y(testo: string): void;
}

export function creaGrafico(opzioni: OpzioniGrafico = {}): Grafico {
  const dati = opzioni.dati ?? { nodes: [], edges: [] };
  const confIniziale = opzioni.conf ?? { fisica: confOrganica(), grafica: confGraficaPredefinita(), preset: "organica" };
  const factoryPittore = opzioni.creaPittore ?? creaPittore;
  const factoryInterazione = opzioni.creaInterazione ?? creaInterazione;
  const ora = opzioni.orologio ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const programma = opzioni.programma ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancella = opzioni.cancella ?? ((id: number) => cancelAnimationFrame(id));

  // La fisica è sostituita a ogni `impostaConf`: parte clampata, nuova quando
  // cambia. La grafica è un oggetto **vivo** che il pittore chiude per
  // riferimento: `impostaConf` lo fonde in place, mai lo sostituisce, così il
  // pittore vede i nuovi valori senza doverlo ricreare.
  let fisica: ConfFisica = clampConfFisica(confIniziale.fisica);
  const graficaViva: ConfGrafica = clampConfGrafica(confIniziale.grafica);

  let s: Struttura | null = null;
  let cameraStato: CameraStato | null = null;
  let pittore: Pittore | null = null;
  let interazione: Interazione | null = null;
  let pool: PoolQuad | null = null;
  let host: HTMLElement | null = null;
  let osservatore: ResizeObserver | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let idRAF: number | null = null;
  let smontato = false;

  const aperti = new Set<string>();
  const statoMotore: StatoMotore = { alpha: 1, quietaDa: 0 };
  // L'hover letto dai nostri listener sul canvas: l'interazione non lo espone,
  // e il pittore lo vuole per il focus. −1 = nessuno.
  let hovered = -1;
  let emaFrameMs = 16.7;
  let primaOra = 0;
  let ultimaOra = 0;
  let W = -1;
  let H = -1;
  let fitInizialeFatto = false;
  let fitQuieteFatto = false;
  // I listener che aggiungiamo al canvas per l'hover; tenuti per rimuoverli.
  const suMove = (e: PointerEvent): void => {
    if (!s || !cameraStato) return;
    if (s.trascinato >= 0) {
      // Durante un drag l'hover non ha senso: il nodo sotto il cursore è il
      // trascinato, e il pittore lo tratta già come attivo.
      if (hovered !== -1) {
        hovered = -1;
        richiediRidisegno();
      }
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const h = nodoIn(s, cameraStato.stato(), x, y);
    if (h !== hovered) {
      hovered = h;
      richiediRidisegno();
    }
  };
  const suLeave = (): void => {
    if (hovered !== -1) {
      hovered = -1;
      richiediRidisegno();
    }
  };

  /// L'apertura nota: assegnabile dall'esterno. Default no-op, così `monta`
  /// prima dell'assegnamento non esplode.
  let apriEsterno: (id: string) => void = () => {};

  /// Richiede un frame se non ne è già in volo uno. È il battito del loop:
  /// ogni gesto (drag, hover, cambio conf, resize) lo chiama, e il frame si
  /// autoprogramma solo se c'è ancora qualcosa da animare.
  function richiediRidisegno(): void {
    if (smontato) return;
    if (idRAF === null) idRAF = programma(frame);
  }

  /// Il bound del grafo in coordinate mondo. Duplicato minimo del calcolo
  /// interno del pittore: serve al fit e non è esportato. Un grafo vuoto o
  /// con nodi coincidenti ha un bound puntiforme — `inquadra` lo gestisce.
  function bound(): BoundMondo {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    if (s) {
      for (let i = 0; i < s.n; i++) {
        if (s.x[i] < minX) minX = s.x[i];
        if (s.y[i] < minY) minY = s.y[i];
        if (s.x[i] > maxX) maxX = s.x[i];
        if (s.y[i] > maxY) maxY = s.y[i];
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  }

  function viewport(): Viewport | null {
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  /// Ridimensiona il pittore se la superficie è cambiata. Con il
  /// ResizeObserver presente scatta solo al primo frame e su resize reale;
  /// senza (happy-dom senza RO) è il fallback per-frame, ma il confronto
  /// evita di ridipingere a parità di dimensioni.
  function ridimensionaSeServe(v: Viewport | null): void {
    if (!v || !pittore) return;
    if (W < 0 || v.w !== W || v.h !== H) {
      W = v.w;
      H = v.h;
      const dpr = (typeof window !== "undefined" && typeof window.devicePixelRatio === "number") ? window.devicePixelRatio : 1;
      pittore.ridimensiona(W, H, dpr);
      pittore.ridisegnaSfondo();
    }
  }

  /// Il loop è attivo finché c'è movimento visibile: la sim calda (alpha),
  /// la camera che converge, o un nodo trascinato. Il pulse è escluso: il
  /// pittore lo traccia solo con alpha > SOGLIA_PULSE, già coperta da alpha
  /// > SOGLIA_ATTIVO; aggiungerlo terrebbe il rAF acceso per sempre con
  /// nodi aperti e grafo fermo, senza produrre nulla.
  function attivo(): boolean {
    if (!s || !cameraStato) return false;
    return statoMotore.alpha > SOGLIA_ATTIVO || !cameraStato.pronto() || s.trascinato >= 0;
  }

  /// Il frame: misura il dt, fa un passo di fisica se la sim è calda, un
  /// passo di camera sempre (l'inseguimento deve concludersi anche a grafo
  /// fermo), e disegna. Alla fine si riprogramma se c'è ancora movimento.
  function frame(): void {
    const id = idRAF;
    idRAF = null;
    if (smontato || !host || !pittore || !interazione || !cameraStato || !s) {
      if (id !== null) cancella(id);
      return;
    }
    const t = ora();
    if (primaOra === 0) {
      primaOra = t;
      ultimaOra = t;
    }
    const dtS = Math.min(Math.max(0, (t - ultimaOra) / 1000), DT_MAX);
    ultimaOra = t;
    const tempoMs = t - primaOra;

    const v = viewport();
    // Senza RO (happy-dom) il resize si controlla qui; con RO l'osservatore
    // fa il suo lavoro e il confronto qui è a costo zero.
    if (!osservatore || W < 0) ridimensionaSeServe(v);

    // Fit iniziale differito: solo quando c'è una superficie vera. Il salta
    // evita che il primo frame insegua una camera che parte da (1,0,0).
    if (v && !fitInizialeFatto && v.w >= VISTA_MINIMA && v.h >= VISTA_MINIMA) {
      cameraStato.inquadra(bound(), v);
      cameraStato.imposta(cameraStato.stato(), true);
      fitInizialeFatto = true;
    }

    const tier: Tier = calcolaTier(s.n, emaFrameMs);
    let q: Quadtree | null = null;
    if (tier >= 2 && s.n > 0) {
      if (!pool) pool = new PoolQuad();
      q = costruisci(s, pool);
    }

    if (statoMotore.alpha > SOGLIA_ATTIVO) {
      passo(s, fisica, statoMotore, q, dtS);
      // Secondo fit, alla prima quiete: il grafo si è disteso e l'inquadra
      // iniziale (sulla semina) è rimasto indietro. Morbido: il loop resta
      // acceso finché la camera non converge.
      if (fitInizialeFatto && !fitQuieteFatto && statoMotore.quietaDa >= FIT_QUIETE_PASSI && v) {
        fitQuieteFatto = true;
        cameraStato.inquadra(bound(), v);
      }
    }

    const cam: Camera = cameraStato.passo(dtS);
    emaFrameMs = emaFrameMs * (1 - EMA_ALFA) + dtS * 1000 * EMA_ALFA;

    const stato: StatoDisegno = {
      s,
      camera: cam,
      aperti,
      hovered,
      trascinato: s.trascinato,
      focalizzato: interazione.leggiFocalizzato(),
      alpha: statoMotore.alpha,
      tier,
      tempoMs,
    };
    pittore.ridisegna(stato);

    if (attivo()) richiediRidisegno();
  }

  function monta(h: HTMLElement): void {
    if (smontato || host) return;
    host = h;
    s = creaStruttura(dati, fisica, semeDi(dati));
    cameraStato = creaCameraStato();
    pittore = factoryPittore(host, graficaViva);
    // Il pittore crea i canvas; il principale è quello che riceve i pointer.
    // Lo si cerca per nome: il pittore non lo espone (e non deve, è un dettaglio
    // del suo montaggio). Se la factory è iniettata (test), il canvas può
    // mancare — in quel caso l'interazione iniettata deve non dipenderne.
    canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    if (canvas) {
      canvas.addEventListener("pointermove", suMove);
      canvas.addEventListener("pointerleave", suLeave);
    }
    const canvasPerInterazione = canvas ?? document.createElement("canvas");
    interazione = factoryInterazione({
      canvas: canvasPerInterazione,
      strutturaRef: () => s as Struttura,
      cameraStato,
      azioni: {
        apri: (id: string) => apriEsterno(id),
        riscalda: (livello: number) => riscalda(livello),
        richiediRidisegno,
      },
    });
    if (typeof ResizeObserver !== "undefined") {
      osservatore = new ResizeObserver(() => {
        if (smontato) return;
        ridimensionaSeServe(viewport());
        richiediRidisegno();
      });
      osservatore.observe(host);
    }
    richiediRidisegno();
  }

  function smonta(): void {
    if (smontato) return;
    smontato = true;
    if (idRAF !== null) cancella(idRAF);
    idRAF = null;
    if (osservatore) osservatore.disconnect();
    osservatore = null;
    if (canvas) {
      canvas.removeEventListener("pointermove", suMove);
      canvas.removeEventListener("pointerleave", suLeave);
    }
    canvas = null;
    if (interazione) interazione.distruggi();
    interazione = null;
    if (pittore) pittore.distruggi();
    pittore = null;
    cameraStato = null;
    s = null;
    pool = null;
    host = null;
  }

  function impostaAperti(nuovo: ReadonlySet<string>): void {
    if (aperti.size !== nuovo.size) {
      aperti.clear();
      for (const id of nuovo) aperti.add(id);
      richiediRidisegno();
      return;
    }
    let cambiato = false;
    for (const id of nuovo) {
      if (!aperti.has(id)) {
        cambiato = true;
        break;
      }
    }
    if (!cambiato) return;
    aperti.clear();
    for (const id of nuovo) aperti.add(id);
    richiediRidisegno();
  }

  function impostaConf(nuova: ConfGrafo): void {
    // La fisica è un nuovo oggetto clampato: il motore la legge a ogni passo.
    fisica = clampConfFisica(nuova.fisica);
    // La grafica si fonde nell'oggetto vivo che il pittore chiude: sostituirlo
    // orfano-rebbe il pittore, che continuerebbe a leggere il vecchio. Il
    // preset non serve al grafico (lo gestiscono config + pannello).
    Object.assign(graficaViva, clampConfGrafica(nuova.grafica));
    if (pittore) {
      pittore.ridisegnaSfondo();
      richiediRidisegno();
    }
  }

  function riscalda(livello: number): void {
    if (statoMotore.alpha < livello) statoMotore.alpha = livello;
    statoMotore.quietaDa = 0;
    fitQuieteFatto = false;
    richiediRidisegno();
  }

  function sbloccaNodi(): void {
    if (!s) return;
    for (let i = 0; i < s.n; i++) s.fisso[i] = 0;
    s.trascinato = -1;
    richiediRidisegno();
  }

  function impostaEtichettaA11y(testo: string): void {
    if (interazione) interazione.impostaEtichettaA11y(testo);
  }

  return {
    monta,
    smonta,
    // Accessor: l'assegnamento esterno sostituisce il gestore interno senza
    // che l'interazione tenga un riferimento stantio alla vecchia closure.
    get apri() {
      return apriEsterno;
    },
    set apri(fn: (id: string) => void) {
      apriEsterno = fn;
    },
    impostaAperti,
    impostaConf,
    riscalda,
    sbloccaNodi,
    impostaEtichettaA11y,
  };
}