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

/// Sotto questa temperatura lo smorzamento cresce col freddo, fino a
/// moltiplicare l'attrito per `ANNEAL_FLOOR` all'alpha zero.
export const ANNEAL_ALPHA = 0.12;
export const ANNEAL_FLOOR = 0.55;

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
  // La fisica segue solo n: il contratto per cardinalità non cambia con lo
  // schermo né col carico. Il gradino economico di `calculateTier` tocca la
  // resa, non l'algoritmo.
  const tier = baseTier(s.n);
  accumulateForces(s, config, q, tier);

  const n = s.n;
  const maxV = config.maxSpeed;
  // L'attrito è «per passo a 60 Hz»: lo si porta al dt vero, o a 30 fps il
  // grafo avrebbe metà dello smorzamento al secondo e oscillerebbe di più. Col
  // freddo si aggiunge smorzamento (ricottura): sotto `ANNEAL_ALPHA` il moto
  // residuo si spegne dolcemente, e quando il loop si ferma non resta niente
  // di congelato a mezz'aria.
  const heat = state.alpha >= ANNEAL_ALPHA ? 1 : state.alpha / ANNEAL_ALPHA;
  const friction = Math.pow(config.friction * (ANNEAL_FLOOR + (1 - ANNEAL_FLOOR) * heat), dtEff * 60);
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

  if (config.collisions && tier < 3) collisions(s, config);

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

/// Il tier per cardinalità: n ≤ 400 → 1 (repulsione esatta), ≤ 2000 → 2
/// (Barnes-Hut e collisioni), oltre → 3 (Barnes-Hut, niente collisioni).
export function baseTier(n: number): Tier {
  return n <= 400 ? 1 : n <= 2000 ? 2 : 3;
}

/// Il budget minimo di un fotogramma per il tier: quello a 60 Hz. Uno schermo
/// più veloce dà più fluidità quando il lavoro ci sta, mai un grafo più povero.
export const TIER_BUDGET_MS = 1000 / 60;
/// Frame più lunghi di così, rispetto al budget, sono lenti: a 60 Hz è la
/// soglia di 22 ms di sempre.
export const TIER_SLOW = 1.3;
/// Sotto questo rapporto i frame sono tornati nel budget.
export const TIER_FAST = 1.1;
/// Quanto resta il gradino economico prima di poter risalire. Il gradino
/// rimette i frame nel budget da sé: senza attesa si revocherebbe a ogni
/// manciata di fotogrammi, e le etichette lampeggerebbero.
export const TIER_HOLD_MS = 5000;

/// Il tier di resa, dal numero di nodi e dall'EMA della durata dei frame. Si
/// parte dalla base per cardinalità e si scende di un gradino (più economico)
/// quando i frame durano più di `TIER_SLOW` budget; si risale quando tornano
/// sotto `TIER_FAST`, ma non prima di `TIER_HOLD_MS` dall'ultimo cambio. Mai
/// sopra la base: un frame veloce su uno schermo a 144 Hz rimetteva la
/// repulsione esatta su duemila nodi, che rallentava, e il tier rimbalzava.
/// Il budget è il periodo del tetto dei fotogrammi, mai sotto `TIER_BUDGET_MS`.
export function calculateTier(
  n: number,
  current: Tier,
  emaFrameMs: number,
  budgetMs: number,
  heldMs: number,
): Tier {
  const base = baseTier(n);
  const cheap = (base < 3 ? base + 1 : 3) as Tier;
  const budget = budgetMs > TIER_BUDGET_MS ? budgetMs : TIER_BUDGET_MS;
  if (current !== cheap || cheap === base) return emaFrameMs > budget * TIER_SLOW ? cheap : base;
  if (heldMs < TIER_HOLD_MS) return cheap;
  return emaFrameMs < budget * TIER_FAST ? base : cheap;
}
