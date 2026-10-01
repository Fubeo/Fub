// I giochi del grafo come impulsi: funzioni pure che cambiano le velocità dei
// nodi e lasciano al motore il resto — molle, rimbalzi, ricottura. Nessuna
// tocca una posizione, e nessuna muove un nodo bloccato (pin, fisso 1) o
// trascinato (fisso 2): il pin è un impegno dell'utente, il drag il suo gesto.
//
// Deterministiche: la scossa prende i numeri da un `mulberry32` che il grafico
// semina, mai da `Math.random`.

import type { Structure } from "./types";

/// Una scossa: ogni nodo libero riceve una spinta di direzione casuale e
/// modulo fra metà e intero `speed` (px di mondo al secondo). I nodi pesanti
/// (gli hub) sobbalzano meno delle foglie: la spinta cala come 1/√massa.
export function shake(s: Structure, rng: () => number, speed: number): void {
  for (let i = 0; i < s.n; i++) {
    // I numeri si consumano anche per i nodi bloccati: la scossa di un nodo
    // non dipende da quali altri sono bloccati.
    const angle = rng() * Math.PI * 2;
    const amount = (0.5 + 0.5 * rng()) * speed;
    if (s.fixed[i] !== 0) continue;
    const k = amount / Math.sqrt(s.mass[i] > 0 ? s.mass[i] : 1);
    s.vx[i] += k * Math.cos(angle);
    s.vy[i] += k * Math.sin(angle);
  }
}

/// L'inerzia della sfera di neve: quando la vista cambia velocità di colpo, i
/// nodi restano indietro. `dvx, dvy` è la variazione di velocità della vista in
/// px di mondo al secondo; i nodi ricevono la stessa variazione cambiata di
/// segno, di meno gli hub.
export function slosh(s: Structure, dvx: number, dvy: number): void {
  for (let i = 0; i < s.n; i++) {
    if (s.fixed[i] !== 0) continue;
    const k = 1 / Math.sqrt(s.mass[i] > 0 ? s.mass[i] : 1);
    s.vx[i] -= dvx * k;
    s.vy[i] -= dvy * k;
  }
}

/// Un'onda d'urto dal punto (x, y): ogni nodo libero riceve una spinta
/// radiale che vale `speed` al centro e cala come e^(−d/radius). Un nodo
/// esattamente al centro non ha direzione e resta dov'è.
export function shockwave(s: Structure, x: number, y: number, radius: number, speed: number): void {
  if (!(radius > 0)) return;
  for (let i = 0; i < s.n; i++) {
    if (s.fixed[i] !== 0) continue;
    const dx = s.x[i] - x;
    const dy = s.y[i] - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) continue;
    const k = (speed * Math.exp(-d / radius)) / d;
    s.vx[i] += dx * k;
    s.vy[i] += dy * k;
  }
}
