// L'orchestratore del grafo 2.0: lega il motore, il pittore e l'interazione a un
// `requestAnimationFrame` che si accende quando c'è da animare e si spegne
// quando il grafo si quieta — niente polling, niente timer. Il pannello di
// fisica è un suo pari (l'editor della conf), non un figlio: il grafico non lo
// conosce, sa solo che qualcosa chiama `setConfig`.
//
// L'aggiramento del contratto: `Interaction` (lotto B) non espone `hovered`,
// ma `DrawState` lo vuole e il pittore ne fa il focus. Invece di toccare il
// lotto B, qui aggancchiamo i nostri `pointermove`/`pointerleave` sul canvas
// principale e richiamiamo `nodeAt` (pura, esportata da `interaction.ts`): la
// stessa hit-test che usa l'interazione, ma letta da noi. L'interazione tiene
// la sua macchina a stati (drag, pan, zoom, click) e riceve gli stessi eventi
// — i due ascoltatori coesistono, perché l'interazione cattura il puntatore
// solo al `pointerdown`, non al `pointermove`. L'attrito è nel report.

import type { PhysicsConfig, GraphicsConfig, GraphConfig, GraphData, Structure, Tier } from "./sim/types";
import {
  clampPhysicsConfig,
  clampGraphicsConfig,
  defaultGraphicsConfig,
  organicConfig,
  createStructure,
  seedOf,
} from "./sim/types";
import type { Quadtree } from "./sim/quadtree";
import { QuadtreePool, build } from "./sim/quadtree";
import { DT_MAX, calculateTier, step, type EngineState } from "./sim/engine";
import type { WorldBound, Camera, CameraState, Viewport } from "./render/camera";
import { createCameraState } from "./render/camera";
import type { Painter, DrawState } from "./render/painter";
import { createPainter } from "./render/painter";
import type { Interaction, InteractionOptions } from "./interaction";
import { createInteraction, nodeAt } from "./interaction";

/// L'alpha sotto cui il disegno è statico: il pittore non traccia trail né
/// pulse sotto questa soglia (sono le sue `TRAIL_THRESHOLD`/`PULSE_THRESHOLD`), quindi
/// tenere il rAF acceso sotto non produrrebbe nulla di visibile. È la soglia
/// di attività del loop.
const ACTIVE_THRESHOLD = 0.02;
/// Sopra questa dimensione (px) un riquadro è considerato visibile e ci si può
/// inquadrare il grafo. Sotto (tab nascosta, host collassato) il fit è
/// differito al momento in cui c'è davvero una superficie — questo chiude
/// strutturalmente il bug 2-1 (la sim non parte con k = 0 e scala 1).
const MIN_VIEW_SIZE = 50;
/// Passi di quiete prima del secondo fit: il grafo si è disteso, il fit
/// iniziale era sulla semina e ora contiene il grafo vero. Morbido: il loop
/// resta acceso finché la camera non converge, poi si spegne.
const QUIET_FIT_STEPS = 30;
/// Fattore dell'EMA dei millisecondi per frame: un filtro lento, perché il
/// tier non deve oscillare a ogni capriccio del GC.
const EMA_ALPHA = 0.1;

/// Una factory di pittore iniettabile per i test (happy-dom: `getContext`
/// ritorna null e il pittore vero è un no-op sicuro; i test vogliono però
/// osservare gli stati disegnati).
export type PainterFactory = (host: HTMLElement, config: GraphicsConfig) => Painter;
export type FactoryInteraction = (options: InteractionOptions) => Interaction;
export type Speaker = () => number;
export type Scheduler = (cb: () => void) => number;
export type Canceller = (id: number) => void;

export interface ChartOptions {
  /// I dati del provider `fub:graph`. Se assenti, un grafo vuoto (monta senza
  /// nodi è legittimo: il pannello e il conto vivono lo stesso).
  data?: GraphData;
  /// La conf iniziale; in sua assenza si usa la predefinita. Il grafico non
  /// si tiene un riferimento a questo oggetto: ne estrae fisica e grafica
  /// (clampate) e vive con quelli. `setConfig` sostituisce la fisica e
  /// muta in place la grafica viva che il pittore chiude.
  config?: GraphConfig;
  /// Per i test. Iniettare `createPainter`/`createInteraction` per osservare
  /// gli stati; `clock`/`schedule`/`cancel` per determinismo senza
  /// `performance.now` né `requestAnimationFrame` reali.
  createPainter?: PainterFactory;
  createInteraction?: FactoryInteraction;
  clock?: Speaker;
  schedule?: Scheduler;
  cancel?: Canceller;
}

export interface Chart {
  /// Aggancia i canvas, il pittore e l'interazione all'host e accende il
  /// primo frame. Idempotente.
  mount(host: HTMLElement): void;
  /// Stacca tutto: rAF, ResizeObserver, pittore, interazione, listener. Una
  /// seconda chiamata è un no-op.
  unmount(): void;
  /// Il gestore dell'apertura nota: lo assegna l'orchestratore shell dopo la
  /// creazione, perché il grafico non conosce `onAction`. Al click su un nodo,
  /// l'interazione lo chiama.
  open: (id: string) => void;
  /// Sostituisce l'insieme delle note aperte (per il quartiere acceso). Un
  /// cambio reale ridisegna una volta; un no-change non fa nulla.
  setOpenDocuments(openDocuments: ReadonlySet<string>): void;
  /// Applica una conf nuova: la fisica è sostituita (nuovo oggetto, clampato),
  /// la grafica è fusa nell'oggetto vivo che il pittore chiude (così non si
  /// perde la grafica sostituendo il riferimento). Il preset non è tracciato
  /// qui: lo gestiscono `config.ts` e il pannello.
  setConfig(config: GraphConfig): void;
  /// Riporta l'alpha al livello dato e azzera la quiete: la sim riparte.
  warm(livello: number): void;
  /// Toglie tutti i pin e il drag: i nodi tornano liberi.
  unpinNodes(): void;
  /// L'aria del canvas (role/aria-label) per la tastiera.
  setA11yLabel(text: string): void;
}

export function createChart(options: ChartOptions = {}): Chart {
  const data = options.data ?? { nodes: [], edges: [] };
  const initialConfig = options.config ?? { physics: organicConfig(), graphics: defaultGraphicsConfig(), preset: "organica" };
  const painterFactory = options.createPainter ?? createPainter;
  const interactionFactory = options.createInteraction ?? createInteraction;
  const clock = options.clock ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const schedule = options.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = options.cancel ?? ((id: number) => cancelAnimationFrame(id));

  // La fisica è sostituita a ogni `setConfig`: parte clampata, nuova quando
  // cambia. La grafica è un oggetto **vivo** che il pittore chiude per
  // riferimento: `setConfig` lo fonde in place, mai lo sostituisce, così il
  // pittore vede i nuovi valori senza doverlo ricreare.
  let physics: PhysicsConfig = clampPhysicsConfig(initialConfig.physics);
  const liveGraphics: GraphicsConfig = clampGraphicsConfig(initialConfig.graphics);

  let s: Structure | null = null;
  let cameraState: CameraState | null = null;
  let painter: Painter | null = null;
  let interaction: Interaction | null = null;
  let pool: QuadtreePool | null = null;
  let host: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let rafId: number | null = null;
  let unmounted = false;

  const openDocuments = new Set<string>();
  const engineState: EngineState = { alpha: 1, quietSince: 0 };
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
  const onMove = (e: PointerEvent): void => {
    if (!s || !cameraState) return;
    if (s.dragged >= 0) {
      // Durante un drag l'hover non ha senso: il nodo sotto il cursore è il
      // trascinato, e il pittore lo tratta già come attivo.
      if (hovered !== -1) {
        hovered = -1;
        requestRedraw();
      }
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const h = nodeAt(s, cameraState.state(), x, y);
    if (h !== hovered) {
      hovered = h;
      requestRedraw();
    }
  };
  const onLeave = (): void => {
    if (hovered !== -1) {
      hovered = -1;
      requestRedraw();
    }
  };

  /// L'apertura nota: assegnabile dall'esterno. Default no-op, così `mount`
  /// prima dell'assegnamento non esplode.
  let openExternal: (id: string) => void = () => {};

  /// Richiede un frame se non ne è già in volo uno. È il battito del loop:
  /// ogni gesto (drag, hover, cambio conf, resize) lo chiama, e il frame si
  /// autoprogramma solo se c'è ancora qualcosa da animare.
  function requestRedraw(): void {
    if (unmounted) return;
    if (rafId === null) rafId = schedule(frame);
  }

  /// Il bound del grafo in coordinate mondo. Duplicato minimo del calcolo
  /// interno del pittore: serve al fit e non è esportato. Un grafo vuoto o
  /// con nodi coincidenti ha un bound puntiforme — `fit` lo gestisce.
  function bound(): WorldBound {
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
  function resizeIfNeeded(v: Viewport | null): void {
    if (!v || !painter) return;
    if (W < 0 || v.w !== W || v.h !== H) {
      W = v.w;
      H = v.h;
      const dpr = (typeof window !== "undefined" && typeof window.devicePixelRatio === "number") ? window.devicePixelRatio : 1;
      painter.resize(W, H, dpr);
      painter.redrawBackground();
    }
  }

  /// Il loop è attivo finché c'è movimento visibile: la sim calda (alpha),
  /// la camera che converge, o un nodo trascinato. Il pulse è escluso: il
  /// pittore lo traccia solo con alpha > SOGLIA_PULSE, già coperta da alpha
  /// > SOGLIA_ATTIVO; aggiungerlo terrebbe il rAF acceso per sempre con
  /// nodi aperti e grafo fermo, senza produrre nulla.
  function active(): boolean {
    if (!s || !cameraState) return false;
    return engineState.alpha > ACTIVE_THRESHOLD || !cameraState.ready() || s.dragged >= 0;
  }

  /// Il frame: misura il dt, fa un passo di fisica se la sim è calda, un
  /// passo di camera sempre (l'inseguimento deve concludersi anche a grafo
  /// fermo), e disegna. Alla fine si riprogramma se c'è ancora movimento.
  function frame(): void {
    const id = rafId;
    rafId = null;
    if (unmounted || !host || !painter || !interaction || !cameraState || !s) {
      if (id !== null) cancel(id);
      return;
    }
    const t = clock();
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
    if (!resizeObserver || W < 0) resizeIfNeeded(v);

    // Fit iniziale differito: solo quando c'è una superficie vera. Il salta
    // evita che il primo frame insegua una camera che parte da (1,0,0).
    if (v && !fitInizialeFatto && v.w >= MIN_VIEW_SIZE && v.h >= MIN_VIEW_SIZE) {
      cameraState.fit(bound(), v);
      cameraState.set(cameraState.state(), true);
      fitInizialeFatto = true;
    }

    const tier: Tier = calculateTier(s.n, emaFrameMs);
    let q: Quadtree | null = null;
    if (tier >= 2 && s.n > 0) {
      if (!pool) pool = new QuadtreePool();
      q = build(s, pool);
    }

    if (engineState.alpha > ACTIVE_THRESHOLD) {
      step(s, physics, engineState, q, dtS);
      // Secondo fit, alla prima quiete: il grafo si è disteso e il fit
      // iniziale (sulla semina) è rimasto indietro. Morbido: il loop resta
      // acceso finché la camera non converge.
      if (fitInizialeFatto && !fitQuieteFatto && engineState.quietSince >= QUIET_FIT_STEPS && v) {
        fitQuieteFatto = true;
        cameraState.fit(bound(), v);
      }
    }

    const cam: Camera = cameraState.step(dtS);
    emaFrameMs = emaFrameMs * (1 - EMA_ALPHA) + dtS * 1000 * EMA_ALPHA;

    const state: DrawState = {
      s,
      camera: cam,
      openDocuments,
      hovered,
      dragged: s.dragged,
      focused: interaction.getFocusedNode(),
      alpha: engineState.alpha,
      tier,
      tempoMs,
    };
    painter.redraw(state);

    if (active()) requestRedraw();
  }

  function mount(h: HTMLElement): void {
    if (unmounted || host) return;
    host = h;
    s = createStructure(data, physics, seedOf(data));
    cameraState = createCameraState();
    painter = painterFactory(host, liveGraphics);
    // Il pittore crea i canvas; il principale è quello che riceve i pointer.
    // Lo si cerca per nome: il pittore non lo espone (e non deve, è un dettaglio
    // del suo montaggio). Se la factory è iniettata (test), il canvas può
    // mancare — in quel caso l'interazione iniettata deve non dipenderne.
    canvas = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
    if (canvas) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
    }
    const canvasPerInteraction = canvas ?? document.createElement("canvas");
    interaction = interactionFactory({
      canvas: canvasPerInteraction,
      structureRef: () => s as Structure,
      cameraState,
      actions: {
        open: (id: string) => openExternal(id),
        warm: (livello: number) => warm(livello),
        requestRedraw,
      },
    });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (unmounted) return;
        resizeIfNeeded(viewport());
        requestRedraw();
      });
      resizeObserver.observe(host);
    }
    requestRedraw();
  }

  function unmount(): void {
    if (unmounted) return;
    unmounted = true;
    if (rafId !== null) cancel(rafId);
    rafId = null;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (canvas) {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    }
    canvas = null;
    if (interaction) interaction.destroy();
    interaction = null;
    if (painter) painter.destroy();
    painter = null;
    cameraState = null;
    s = null;
    pool = null;
    host = null;
  }

  function setOpenDocuments(newItem: ReadonlySet<string>): void {
    if (openDocuments.size !== newItem.size) {
      openDocuments.clear();
      for (const id of newItem) openDocuments.add(id);
      requestRedraw();
      return;
    }
    let changed = false;
    for (const id of newItem) {
      if (!openDocuments.has(id)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    openDocuments.clear();
    for (const id of newItem) openDocuments.add(id);
    requestRedraw();
  }

  function setConfig(newCapacity: GraphConfig): void {
    // La fisica è un nuovo oggetto clampato: il motore la legge a ogni passo.
    physics = clampPhysicsConfig(newCapacity.physics);
    // La grafica si fonde nell'oggetto vivo che il pittore chiude: sostituirlo
    // orfano-rebbe il pittore, che continuerebbe a leggere il vecchio. Il
    // preset non serve al grafico (lo gestiscono config + pannello).
    Object.assign(liveGraphics, clampGraphicsConfig(newCapacity.graphics));
    if (painter) {
      painter.redrawBackground();
      requestRedraw();
    }
  }

  function warm(livello: number): void {
    if (engineState.alpha < livello) engineState.alpha = livello;
    engineState.quietSince = 0;
    fitQuieteFatto = false;
    requestRedraw();
  }

  function unpinNodes(): void {
    if (!s) return;
    for (let i = 0; i < s.n; i++) s.fixed[i] = 0;
    s.dragged = -1;
    requestRedraw();
  }

  function setA11yLabel(text: string): void {
    if (interaction) interaction.setA11yLabel(text);
  }

  return {
    mount,
    unmount,
    // Accessor: l'assegnamento esterno sostituisce il gestore interno senza
    // che l'interazione tenga un riferimento stantio alla vecchia closure.
    get open() {
      return openExternal;
    },
    set open(fn: (id: string) => void) {
      openExternal = fn;
    },
    setOpenDocuments,
    setConfig,
    warm,
    unpinNodes,
    setA11yLabel,
  };
}