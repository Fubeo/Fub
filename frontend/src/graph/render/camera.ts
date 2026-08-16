// La camera: come si guarda il mondo. Un punto mondo `p` finisce sullo schermo
// in `p·scala + traslazione`: zoom al cursore, fit, inerzia del pan sono tutte
// variazioni di questi tre numeri. Il file è puro — nessun DOM — perché il
// round-trip `schermoInMondo(mondoInSchermo(p)) ≈ p` e l'invarianza dello zoom
// al cursore sono ciò che garantisce che il grafo non «scivoli» sotto il
// puntatore.
//
// Lo smoothing vive in due metà: `passoCamera` (pura, testabile da sola) e la
// factory `creaCameraStato` che la tiene assieme a un bersaglio da inseguire.
// Il perché dell'inseguimento: rotella e tasti producono salti di scala, e un
// salto istantaneo disorienta; inseguire il bersaglio a costante di tempo
// 90 ms rende lo zoom morbido senza mai restare indietro in modo percepibile.

export interface Punto {
  x: number;
  y: number;
}

export interface Camera {
  scala: number;
  tx: number;
  ty: number;
}

export interface BoundMondo {
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
export const MIN_SCALA = 0.05;
export const MAX_SCALA = 8;

/// Costante di tempo dell'inseguimento esponenziale, in millisecondi.
const COSTANTE_TEMPO = 90;

export function mondoInSchermo(c: Camera, p: Punto): Punto {
  return { x: p.x * c.scala + c.tx, y: p.y * c.scala + c.ty };
}

export function schermoInMondo(c: Camera, p: Punto): Punto {
  return { x: (p.x - c.tx) / c.scala, y: (p.y - c.ty) / c.scala };
}

/// Zoom al cursore: il punto sotto il puntatore deve restare fermo. Si calcola
/// dov'è nel mondo prima dello zoom e si sceglie la traslazione che lo rimette
/// lì dopo. Il clamp della scala non rompe l'invarianza — il punto mondo non
/// dipende dalla scala nuova — rende solo il fattore effettivo più piccolo.
export function zoomAlPunto(c: Camera, fattore: number, puntoSchermo: Punto): Camera {
  const m = schermoInMondo(c, puntoSchermo);
  const scala = Math.min(MAX_SCALA, Math.max(MIN_SCALA, c.scala * fattore));
  return { scala, tx: puntoSchermo.x - m.x * scala, ty: puntoSchermo.y - m.y * scala };
}

/// Fit «F»: la scala più grande che contiene i bound nel viewport lasciando il
/// margine `pad` da ogni lato, poi il rettangolo centrato. I bound degeneri
/// (un solo nodo) non devono produrre una scala infinita: `1e-6` è il pavimento
/// dei lati e il clamp tiene la scala nei limiti.
export function inquadra(b: BoundMondo, v: Viewport, pad = 0.08): Camera {
  const bw = Math.max(1e-6, b.maxX - b.minX);
  const bh = Math.max(1e-6, b.maxY - b.minY);
  const scala = Math.min(MAX_SCALA, Math.max(MIN_SCALA, Math.min(v.w / bw, v.h / bh) * (1 - 2 * pad)));
  return {
    scala,
    tx: (v.w - bw * scala) / 2 - b.minX * scala,
    ty: (v.h - bh * scala) / 2 - b.minY * scala,
  };
}

/// Lo stato inseguito: i tre valori correnti, i tre bersagli, e la velocità
/// residua del pan. I bersagli sono ciò che le azioni dell'utente toccano; la
/// corrente è ciò che il pittore legge, e li avvicina `passoCamera`.
export interface StatoCamera {
  scala: number;
  tx: number;
  ty: number;
  targetScala: number;
  targetTx: number;
  targetTy: number;
  /// Inerzia del pan, in px di schermo per frame.
  vx: number;
  vy: number;
}

export function creaStatoCamera(): StatoCamera {
  return { scala: 1, tx: 0, ty: 0, targetScala: 1, targetTx: 0, targetTy: 0, vx: 0, vy: 0 };
}

/// Un passo di inseguimento. Pura: stesso stato + stesso dt → stesso
/// risultato, e non tocca lo stato in ingresso. L'inerzia decade di 0.9 «per
/// frame» per scelta dichiarata: l'inerzia è un gesto, non una fisica, e
/// legarla a dt significherebbe misurare il tempo di un sentimento.
export function passoCamera(st: StatoCamera, dt: number): StatoCamera {
  const k = 1 - Math.exp(-dt / COSTANTE_TEMPO);
  const tx = st.tx + st.vx;
  const ty = st.ty + st.vy;
  return {
    scala: st.scala + (st.targetScala - st.scala) * k,
    tx: tx + (st.targetTx - tx) * k,
    ty: ty + (st.targetTy - ty) * k,
    targetScala: st.targetScala,
    targetTx: st.targetTx,
    targetTy: st.targetTy,
    vx: st.vx * 0.9,
    vy: st.vy * 0.9,
  };
}

/// La factory usata dal ciclo di vita: le azioni (pan, zoom, fit) scrivono i
/// bersagli, `passo(dt)` insegue e ritorna la camera corrente, `pronto()`
/// dice quando il rAF può spegnersi.
export interface CameraStato {
  stato(): Camera;
  /// Imposta i bersagli; con `salta` la corrente salta subito lì (il fit
  /// iniziale non deve essere inseguito dal primo frame).
  imposta(c: Camera, salta?: boolean): void;
  zoom(fattore: number, x: number, y: number): void;
  pan(dx: number, dy: number): void;
  centraSu(mondoX: number, mondoY: number, scala: number, v: Viewport): void;
  inquadra(b: BoundMondo, v: Viewport): void;
  passo(dt: number): Camera;
  pronto(): boolean;
}

export function creaCameraStato(): CameraStato {
  let st = creaStatoCamera();
  const corrente = (): Camera => ({ scala: st.scala, tx: st.tx, ty: st.ty });
  return {
    stato: corrente,
    imposta(c, salta = false) {
      if (salta) {
        st = { ...st, scala: c.scala, tx: c.tx, ty: c.ty, targetScala: c.scala, targetTx: c.tx, targetTy: c.ty };
      } else {
        st = { ...st, targetScala: c.scala, targetTx: c.tx, targetTy: c.ty };
      }
    },
    zoom(fattore, x, y) {
      // Lo zoom si applica al **bersaglio**: se l'utente ruota la rotella in
      // rapida successione, ogni giro parte da dov'era diretto il precedente e
      // la sequenza non perde zoom a metà inseguimento. La corrente non si
      // tocca: la muove solo `passo`, che la insegue morbida.
      const base: Camera = { scala: st.targetScala, tx: st.targetTx, ty: st.targetTy };
      const z = zoomAlPunto(base, fattore, { x, y });
      st = { ...st, targetScala: z.scala, targetTx: z.tx, targetTy: z.ty };
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
        vx: st.vx + dx,
        vy: st.vy + dy,
      };
    },
    centraSu(mondoX, mondoY, scala, v) {
      // Come per zoom: si sposta il bersaglio; la corrente lo insegue con
      // `passo`. Salti istantanei della corrente riservati al fit iniziale
      // (`imposta` con `salta`).
      const s = Math.min(MAX_SCALA, Math.max(MIN_SCALA, scala));
      st = { ...st, targetScala: s, targetTx: v.w / 2 - mondoX * s, targetTy: v.h / 2 - mondoY * s };
    },
    inquadra(b, v) {
      const f = inquadra(b, v);
      st = { ...st, targetScala: f.scala, targetTx: f.tx, targetTy: f.ty };
    },
    passo(dt) {
      st = passoCamera(st, dt);
      return corrente();
    },
    pronto() {
      return (
        Math.abs(st.scala - st.targetScala) < 0.001 &&
        Math.abs(st.tx - st.targetTx) < 0.5 &&
        Math.abs(st.ty - st.targetTy) < 0.5 &&
        Math.abs(st.vx) < 0.1 &&
        Math.abs(st.vy) < 0.1
      );
    },
  };
}
