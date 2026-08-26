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
/// fino a perdere il grafo).
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

/// Costante di tempo dell'inseguimento esponenziale, in millisecondi.
const TIME_CONSTANT = 90;

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
export function zoomAtPoint(c: Camera, factor: number, screenPoint: Point): Camera {
  const m = screenToWorld(c, screenPoint);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.scale * factor));
  return { scale, tx: screenPoint.x - m.x * scale, ty: screenPoint.y - m.y * scale };
}

/// Fit «F»: la scala più grande che contiene i bound nel viewport lasciando il
/// margine `pad` da ogni lato, poi il rettangolo centrato. I bound degeneri
/// (un solo nodo) non devono produrre una scala infinita: `1e-6` è il pavimento
/// dei lati e il clamp tiene la scala nei limiti.
export function fit(b: WorldBound, v: Viewport, pad = 0.08): Camera {
  const bw = Math.max(1e-6, b.maxX - b.minX);
  const bh = Math.max(1e-6, b.maxY - b.minY);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(v.w / bw, v.h / bh) * (1 - 2 * pad)));
  return {
    scale,
    tx: (v.w - bw * scale) / 2 - b.minX * scale,
    ty: (v.h - bh * scale) / 2 - b.minY * scale,
  };
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
  /// Inerzia del pan, in px di schermo per frame.
  vx: number;
  vy: number;
}

export function createMotionState(): MotionState {
  return { scale: 1, tx: 0, ty: 0, targetScale: 1, targetTx: 0, targetTy: 0, vx: 0, vy: 0 };
}

/// Un passo di inseguimento. Pura: stesso stato + stesso dt → stesso
/// risultato, e non tocca lo stato in ingresso. L'inerzia decade di 0.9 «per
/// frame» per scelta dichiarata: l'inerzia è un gesto, non una fisica, e
/// legarla a dt significherebbe misurare il tempo di un sentimento.
export function stepCamera(st: MotionState, dt: number): MotionState {
  const k = 1 - Math.exp(-dt / TIME_CONSTANT);
  const tx = st.tx + st.vx;
  const ty = st.ty + st.vy;
  return {
    scale: st.scale + (st.targetScale - st.scale) * k,
    tx: tx + (st.targetTx - tx) * k,
    ty: ty + (st.targetTy - ty) * k,
    targetScale: st.targetScale,
    targetTx: st.targetTx,
    targetTy: st.targetTy,
    vx: st.vx * 0.9,
    vy: st.vy * 0.9,
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
  pan(dx: number, dy: number): void;
  centerOn(worldX: number, worldY: number, scale: number, v: Viewport): void;
  fit(b: WorldBound, v: Viewport): void;
  step(dt: number): Camera;
  ready(): boolean;
}

export function createCameraState(reducedMotion = false): CameraState {
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
      const z = zoomAtPoint(base, factor, { x, y });
      st = { ...st, targetScale: z.scale, targetTx: z.tx, targetTy: z.ty };
      if (reduced) arrive();
    },
    pan(dx, dy) {
      // Il pan muove insieme corrente e bersaglio e deposita la velocità
      // nell'inerzia: al rilascio la camera continua, poi l'inseguimento la
      // riporta morbida sul punto di arrivo.
      st = {
        ...st,
        tx: st.tx + dx,
        ty: st.ty + dy,
        targetTx: st.targetTx + dx,
        targetTy: st.targetTy + dy,
        vx: reduced ? 0 : st.vx + dx,
        vy: reduced ? 0 : st.vy + dy,
      };
    },
    centerOn(worldX, worldY, scale, v) {
      // Come per zoom: si sposta il bersaglio; la corrente lo insegue con
      // `step`. Salti istantanei della corrente riservati al fit iniziale
      // (`set` con `jump`).
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      st = { ...st, targetScale: s, targetTx: v.w / 2 - worldX * s, targetTy: v.h / 2 - worldY * s };
      if (reduced) arrive();
    },
    fit(b, v) {
      const f = fit(b, v);
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
        Math.abs(st.vx) < 0.1 &&
        Math.abs(st.vy) < 0.1
      );
    },
  };
}
