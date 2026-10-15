// La camera: come si guarda il mondo. Un punto mondo `p` finisce sullo schermo
// in `p·scale + traslazione`: zoom al cursore, fit, inerzia del pan sono tutte
// variazioni di questi tre numeri. Il file è puro — nessun DOM — perché il
// round-trip `screenToWorld(worldToScreen(p)) ≈ p` e l'invarianza dello zoom
// al cursore sono ciò che garantisce che il grafo non «scivoli» sotto il
// puntatore.
//
// Lo smoothing vive in due metà: `stepCamera` (pura, testabile da sola) e la
// factory `createCameraState` che la tiene assieme a un bersaglio da inseguire.
// Il perché dell'inseguimento: rotella e tasti producono salti di scala, e un
// salto istantaneo disorienta; inseguire il bersaglio a costante di tempo
// 90 ms rende lo zoom morbido senza mai restare indietro in modo percepibile.
//
// Vive in `spatial/`, fuori dal grafo: non sa nulla di nodi e archi, e chi la
// usa sceglie i suoi limiti di scala.

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export interface WorldBound {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/// La scala è clampata qui, una volta sola: nessun chiamante deve ricordarsi
/// di controllare i limiti (erano un bug del codice di prima, che zoommava
/// fino a perdere il grafo). I limiti li sceglie chi usa la camera e li passa
/// a ogni funzione che clampa.
export interface ScaleLimits {
  readonly min: number;
  readonly max: number;
}

/// I limiti del grafo: il default di ogni funzione che clampa.
export const GRAPH_SCALE_LIMITS: ScaleLimits = { min: 0.05, max: 8 };

/// Costante di tempo dell'inseguimento esponenziale, in millisecondi.
const TIME_CONSTANT = 90;

/// Costante di tempo dell'inerzia del pan, in millisecondi: dopo il rilascio
/// la vista scorre ancora per circa `INERTIA_MS` × velocità, poi si ferma.
export const INERTIA_MS = 300;

/// Sotto questa velocità (px/ms) l'inerzia è finita: meno di un decimo di
/// pixel per frame.
const INERTIA_REST = 0.005;

export function worldToScreen(c: Camera, p: Point): Point {
  return { x: p.x * c.scale + c.tx, y: p.y * c.scale + c.ty };
}

export function screenToWorld(c: Camera, p: Point): Point {
  return { x: (p.x - c.tx) / c.scale, y: (p.y - c.ty) / c.scale };
}

/// Zoom al cursore: il punto sotto il puntatore deve restare fermo. Si calcola
/// dov'è nel mondo prima dello zoom e si sceglie la traslazione che lo rimette
/// lì dopo. Il clamp della scala non rompe l'invarianza — il punto mondo non
/// dipende dalla scala nuova — rende solo il fattore effettivo più piccolo.
export function zoomAtPoint(
  c: Camera,
  factor: number,
  screenPoint: Point,
  limits: ScaleLimits = GRAPH_SCALE_LIMITS,
): Camera {
  const m = screenToWorld(c, screenPoint);
  const scale = Math.min(limits.max, Math.max(limits.min, c.scale * factor));
  return { scale, tx: screenPoint.x - m.x * scale, ty: screenPoint.y - m.y * scale };
}

/// Fit «F»: la scala più grande che contiene i bound nel viewport lasciando il
/// margine `pad` da ogni lato, poi il rettangolo centrato. I bound degeneri
/// (un solo nodo) non devono produrre una scala infinita: `1e-6` è il pavimento
/// dei lati e il clamp tiene la scala nei limiti.
///
/// `reserve` sono px di schermo tenuti liberi a destra dei bound, dentro il
/// margine: il posto delle etichette. Non mangia mai più di metà della
/// larghezza utile, e il rettangolo centrato è quello con la riserva.
export function fit(
  b: WorldBound,
  v: Viewport,
  pad = 0.08,
  reserve = 0,
  limits: ScaleLimits = GRAPH_SCALE_LIMITS,
): Camera {
  const bw = Math.max(1e-6, b.maxX - b.minX);
  const bh = Math.max(1e-6, b.maxY - b.minY);
  const kept = Math.min(Math.max(0, reserve), (v.w * (1 - 2 * pad)) / 2);
  // Con una riserva la larghezza utile è positiva, quindi `1 - 2·pad` lo è.
  const w = kept > 0 ? v.w - kept / (1 - 2 * pad) : v.w;
  const scale = Math.min(limits.max, Math.max(limits.min, Math.min(w / bw, v.h / bh) * (1 - 2 * pad)));
  return {
    scale,
    tx: (v.w - bw * scale - kept) / 2 - b.minX * scale,
    ty: (v.h - bh * scale) / 2 - b.minY * scale,
  };
}

/// Il fit che lascia posto alle etichette. Stanno a destra del nodo, in px di
/// schermo a corpo fisso: quanto sporgono oltre il bordo destro dei bound
/// dipende dalla scala, e la scala dallo spazio che resta. `overhang` risponde
/// alla prima domanda; pochi giri bastano alla seconda, e la riserva tenuta è
/// la più grande vista, così un giro che sbaglia sbaglia per eccesso.
export function fitWithOverhang(
  b: WorldBound,
  v: Viewport,
  overhang: (scale: number, b: WorldBound) => number,
  pad = 0.08,
  limits: ScaleLimits = GRAPH_SCALE_LIMITS,
): Camera {
  let c = fit(b, v, pad, 0, limits);
  let reserve = 0;
  for (let round = 0; round < 4; round++) {
    const next = overhang(c.scale, b);
    if (!(next > reserve + 0.5)) break;
    reserve = next;
    c = fit(b, v, pad, reserve, limits);
  }
  return c;
}

/// Lo stato inseguito: i tre valori correnti, i tre bersagli, e la velocità
/// residua del pan. I bersagli sono ciò che le azioni dell'utente toccano; la
/// corrente è ciò che il pittore legge, e li avvicina `stepCamera`.
export interface MotionState {
  scale: number;
  tx: number;
  ty: number;
  targetScale: number;
  targetTx: number;
  targetTy: number;
  /// Inerzia del pan, in px di schermo per millisecondo.
  vx: number;
  vy: number;
}

export function createMotionState(): MotionState {
  return { scale: 1, tx: 0, ty: 0, targetScale: 1, targetTx: 0, targetTy: 0, vx: 0, vy: 0 };
}

/// Un passo di inseguimento. Pura: stesso stato + stesso dt → stesso
/// risultato, e non tocca lo stato in ingresso.
///
/// L'inerzia sposta **insieme** la camera e il suo bersaglio: prima muoveva
/// solo la corrente, e l'inseguimento la riportava indietro verso un bersaglio
/// rimasto fermo — la vista scattava avanti e tornava come un elastico. Lo
/// spostamento è l'integrale esatto di v·e^(−t/τ) sul passo, quindi la stessa
/// spinta porta alla stessa distanza a 30, 60 o 144 Hz.
export function stepCamera(st: MotionState, dt: number): MotionState {
  const k = 1 - Math.exp(-dt / TIME_CONSTANT);
  const decay = Math.exp(-dt / INERTIA_MS);
  const driftX = st.vx * INERTIA_MS * (1 - decay);
  const driftY = st.vy * INERTIA_MS * (1 - decay);
  const tx = st.tx + driftX;
  const ty = st.ty + driftY;
  const targetTx = st.targetTx + driftX;
  const targetTy = st.targetTy + driftY;
  const vx = st.vx * decay;
  const vy = st.vy * decay;
  const resting = Math.abs(vx) < INERTIA_REST && Math.abs(vy) < INERTIA_REST;
  return {
    scale: st.scale + (st.targetScale - st.scale) * k,
    tx: tx + (targetTx - tx) * k,
    ty: ty + (targetTy - ty) * k,
    targetScale: st.targetScale,
    targetTx,
    targetTy,
    vx: resting ? 0 : vx,
    vy: resting ? 0 : vy,
  };
}

/// La factory usata dal ciclo di vita: le azioni (pan, zoom, fit) scrivono i
/// bersagli, `step(dt)` insegue e ritorna la camera corrente, `ready()`
/// dice quando il rAF può spegnersi.
export interface CameraState {
  state(): Camera;
  /// Imposta i bersagli; con `jump` la corrente salta subito lì (il fit
  /// iniziale non deve essere inseguito dal primo frame).
  set(c: Camera, jump?: boolean): void;
  setReducedMotion(reduced: boolean): void;
  zoom(factor: number, x: number, y: number): void;
  /// Sposta la vista di (dx, dy) px, subito e senza inerzia: è il gesto che
  /// segue il puntatore. Ferma un'inerzia ancora in corso.
  pan(dx: number, dy: number): void;
  /// Lascia andare la vista alla velocità del gesto (px/ms): l'inerzia.
  fling(vx: number, vy: number): void;
  centerOn(worldX: number, worldY: number, scale: number, v: Viewport): void;
  fit(b: WorldBound, v: Viewport): void;
  step(dt: number): Camera;
  ready(): boolean;
}

/// `overhang`, se c'è, è lo sporto delle etichette che `fit` lascia libero
/// (vedi `fitWithOverhang`). `limits` vale per zoom, `centerOn` e fit.
export function createCameraState(
  reducedMotion = false,
  overhang?: (scale: number, b: WorldBound) => number,
  limits: ScaleLimits = GRAPH_SCALE_LIMITS,
): CameraState {
  let st = createMotionState();
  let reduced = reducedMotion;
  const current = (): Camera => ({ scale: st.scale, tx: st.tx, ty: st.ty });
  const arrive = (): void => {
    st = { ...st, scale: st.targetScale, tx: st.targetTx, ty: st.targetTy, vx: 0, vy: 0 };
  };
  return {
    state: current,
    setReducedMotion(value) {
      reduced = value;
      if (reduced) arrive();
    },
    set(c, jump = false) {
      if (jump || reduced) {
        st = { ...st, scale: c.scale, tx: c.tx, ty: c.ty, targetScale: c.scale, targetTx: c.tx, targetTy: c.ty, vx: reduced ? 0 : st.vx, vy: reduced ? 0 : st.vy };
      } else {
        st = { ...st, targetScale: c.scale, targetTx: c.tx, targetTy: c.ty };
      }
    },
    zoom(factor, x, y) {
      // Lo zoom si applica al **bersaglio**: se l'utente ruota la rotella in
      // rapida successione, ogni giro parte da dov'era diretto il precedente e
      // la sequenza non perde zoom a metà inseguimento. La corrente non si
      // tocca: la muove solo `step`, che la insegue morbida.
      const base: Camera = { scale: st.targetScale, tx: st.targetTx, ty: st.targetTy };
      const z = zoomAtPoint(base, factor, { x, y }, limits);
      st = { ...st, targetScale: z.scale, targetTx: z.tx, targetTy: z.ty };
      if (reduced) arrive();
    },
    pan(dx, dy) {
      // Il pan muove insieme corrente e bersaglio: la vista resta attaccata
      // al puntatore. L'inerzia la decide il rilascio (`fling`), con la
      // velocità vera del gesto.
      st = {
        ...st,
        tx: st.tx + dx,
        ty: st.ty + dy,
        targetTx: st.targetTx + dx,
        targetTy: st.targetTy + dy,
        vx: 0,
        vy: 0,
      };
    },
    fling(vx, vy) {
      if (reduced) return;
      st = { ...st, vx, vy };
    },
    centerOn(worldX, worldY, scale, v) {
      // Come per zoom: si sposta il bersaglio; la corrente lo insegue con
      // `step`. Salti istantanei della corrente riservati al fit iniziale
      // (`set` con `jump`).
      const s = Math.min(limits.max, Math.max(limits.min, scale));
      st = { ...st, targetScale: s, targetTx: v.w / 2 - worldX * s, targetTy: v.h / 2 - worldY * s };
      if (reduced) arrive();
    },
    fit(b, v) {
      const f = overhang ? fitWithOverhang(b, v, overhang, undefined, limits) : fit(b, v, undefined, undefined, limits);
      st = { ...st, targetScale: f.scale, targetTx: f.tx, targetTy: f.ty };
    },
    step(dt) {
      if (reduced) arrive();
      else st = stepCamera(st, dt);
      return current();
    },
    ready() {
      return (
        Math.abs(st.scale - st.targetScale) < 0.001 &&
        Math.abs(st.tx - st.targetTx) < 0.5 &&
        Math.abs(st.ty - st.targetTy) < 0.5 &&
        st.vx === 0 &&
        st.vy === 0
      );
    },
  };
}
