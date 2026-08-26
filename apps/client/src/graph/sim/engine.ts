// Il motore: integra posizione e velocità (Euler semi-implicito), gestisce
// l'attrito, il tetto di velocità, il decadimento dell'alpha e il conteggio
// della quiete. Non decide niente di fisico — le forze stanno in `forze.ts`,
// l'albero in `quadtree.ts`. Qui si orchesta un passo di simulazione.
//
// Euler semi-implicito (v nuova → x nuova) è condizionalmente stabile per le
// molle: con dt ≤ 1/30 e le rigidità del preset organico non oscilla. Il
// clamp del dt a 1/30 protegge dai frame lunghi: un dt di 0.5 s farebbe
// esplodere l'integrazione, ma con 1/30 la fisica resta corretta (solo due
// volte più lenta di un frame normale).

import { accumulateForces, collisions, setDt } from "./forces";
import type { Quadtree } from "./quadtree";
import type { PhysicsConfig, Structure, Tier } from "./types";

/// Il dt di taratura della fisica: tutti i coefficienti (attrito, molle,
/// raffreddamento) sono pensati per 60 passi al secondo.
export const DT = 1 / 60;

/// Tetto del dt per passo: un frame lungo non fa esplodere la simulazione,
/// la rallenta soltanto. 1/30 = due volte il dt nominale.
export const DT_MAX = 1 / 30;

/// Energia cinetica media per nodo sotto la quale il grafo è considerato
/// «quieto» (px²/s²). Il grafico la usa per mostrare le etichette.
export const QUIET_THRESHOLD = 0.25;

/// Stato persistente del motore fra i passi. `alpha` è la temperatura: decade
/// per `cooling` e l'integrazione (chart.ts) la può riportare a 1
/// con un riscaldo. `quietSince` conta i passi consecutivi sotto soglia: il
/// grafico lo resetta al riscaldo.
export interface EngineState {
  alpha: number;
  quietSince: number;
}

/// Un passo di simulazione. `dt` è il tempo reale dall'ultimo frame
/// (clampano a `DT_MAX`); `q` è il quadtree ricostruito per questo frame, o
/// `null` per forzare la repulsione esatta (tier 1). Zero allocazioni dopo
/// il primo frame: il quadtree è già costruito, le forze usano slot di
/// modulo, le collisioni una griglia in WeakMap.
export function step(
  s: Structure,
  config: PhysicsConfig,
  state: EngineState,
  q: Quadtree | null,
  dt: number,
): void {
  const dtEff = dt < DT_MAX ? dt : DT_MAX;
  setDt(dtEff);
  // Il tier dipende solo da n: il motore non riceve l'EMA dei frame (quello
  // è un filtro del chiamante); qui si usa la base di `calculateTier`.
  const tier: Tier = s.n <= 400 ? 1 : s.n <= 2000 ? 2 : 3;
  accumulateForces(s, config, q, tier);

  const n = s.n;
  const maxV = config.maxSpeed;
  const friction = config.friction;
  for (let i = 0; i < n; i++) {
    const fixed = s.fixed[i];
    if (fixed === 1) {
      // Bloccato: velocità azzerata, posizione tenuta.
      s.vx[i] = 0;
      s.vy[i] = 0;
      continue;
    }
    // Semi-implicito: prima la velocità, poi la posizione.
    s.vx[i] += s.fx[i] * dtEff;
    s.vy[i] += s.fy[i] * dtEff;
    if (fixed !== 2) {
      // Libero: attrito + tetto di velocità. Il trascinato (fisso 2) no:
      // il deadbeat della molla del puntatore si regge su v = Δ/dt al primo
      // passo, e l'attrito o il clamp lo romperebbero.
      s.vx[i] *= friction;
      s.vy[i] *= friction;
      const v2 = s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i];
      if (v2 > maxV * maxV) {
        const inv = maxV / Math.sqrt(v2);
        s.vx[i] *= inv;
        s.vy[i] *= inv;
      }
    }
    s.x[i] += s.vx[i] * dtEff;
    s.y[i] += s.vy[i] * dtEff;
  }

  if (config.collisions) collisions(s, config);

  // Raffreddamento per secondo, non per frame: a dt nominale è un passo di
  // raffreddamento, a dt = 1/30 sono due (come due frame a 1/60).
  state.alpha *= Math.pow(config.cooling, dtEff * 60);

  if (energy(s) < QUIET_THRESHOLD) state.quietSince++;
  else state.quietSince = 0;
}

/// Energia cinetica media per nodo (px²/s²). Non normalizzata sul tetto di
/// velocità: la soglia `QUIET_THRESHOLD` è tarata sui valori reali.
export function energy(s: Structure): number {
  if (s.n === 0) return 0;
  let e = 0;
  for (let i = 0; i < s.n; i++) {
    e += 0.5 * s.mass[i] * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]);
  }
  return e / s.n;
}

/// Tier di repulsione dal numero di nodi e dall'EMA dei millisecondi per
/// frame. Base: n ≤ 400 → 1 (esatta), ≤ 2000 → 2 (Barnes-Hut), oltre → 3.
/// Frame lenti (ema > 22 ms) degradano al tier superiore (più economico),
/// frame veloci (ema < 12 ms) migliorano al tier inferiore (più preciso).
/// Clamp a [1, 3]. La funzione è stateless: il «per 5 s» è un filtro EMA
/// del chiamante, non roba del motore.
export function calculateTier(n: number, emaFrameMs: number): Tier {
  let t = n <= 400 ? 1 : n <= 2000 ? 2 : 3;
  if (emaFrameMs > 22) t++;
  else if (emaFrameMs < 12) t--;
  return (t < 1 ? 1 : t > 3 ? 3 : t) as Tier;
}