// Accumulo delle forze (accelerazioni, vedi nota) e correzioni posizionali di
// collisione. Il motore chiama `accumulateForces` una volta per passo e
// `collisions` subito dopo l'integrazione.
//
// Nota sui nomi: `fx`/`fy` nella `Structure` si chiamano «forza» ma
// contengono **accelerazioni** (per unità di massa). Tutte le formule del
// contratto sono già in forma di accelerazione — `a += repulsion·mj/d²`,
// `a += −gravity·p` — e il motore integra `v += fx·dt` senza dividere per la
// massa. Le molle invece nascono come forza (la rigidità è in N/px) e qui
// vengono divise per la massa del nodo: è l'unico punto in cui la massa
// entra, ed è per questo che un hub pesante accelera piano sotto la molla.

import { FORWARD_CELLS, fillGrid, gridOf, hashCell, type Grid } from "./grid";
import { visit } from "./quadtree";
import type { Quadtree } from "./quadtree";
import type { PhysicsConfig, Structure, Tier, Well } from "./types";
import { restLengths } from "./types";

// ── Stato della callback Barnes-Hut ──────────────────────────────────────
// `accumulateForces` non può passare lo stato per nodo alla callback di `visit`
// senza allocare una closure per ogni nodo. Invece usa questi slot di
// modulo, impostati prima di ogni `visit`: `step` è sincrono e
// single-threaded, quindi non c'è rischio di reentrancy.
let forceStructure: Structure | null = null;
let forceIndex = -1;
let forceRepulsion = 0;

/// La scala dei tempi della fisica. I coefficienti della conf (repulsione,
/// rigidità, gravità) sono tarati «per passo», ma il motore integra in
/// secondi: presi alla lettera davano a una molla un periodo di diciotto
/// secondi, e il grafo si fermava a metà strada, ancora disteso e in moto.
/// Moltiplicare tutte le accelerazioni per lo stesso fattore non cambia la
/// forma d'equilibrio — dipende solo dai rapporti fra le forze — ma soltanto
/// quanto in fretta ci si arriva: con questo valore un vault di qualche
/// centinaio di note si assesta in due o tre secondi. La molla del puntatore
/// non passa di qui: è un controllo, tarato sul dt.
export const TIME_SCALE = 400;

/// La distanza alla quale la repulsione vale quanto valeva con la legge
/// 1/d² dei preset: lunghezza di riposo del preset organico. Sotto spinge
/// meno (le sovrapposizioni le risolvono le collisioni), sopra di più.
export const REPULSION_REFERENCE = 120;

/// La repulsione cala come 1/d, non 1/d². In due dimensioni l'inverso del
/// quadrato si spegne troppo presto: la gravità, lineare, schiacciava i vault
/// grandi in un disco sempre più fitto, e le collisioni ci ribollivano dentro.
/// Con 1/d la densità d'equilibrio non dipende dal numero di note, e un grafo
/// da mille nodi è solo più grande di uno da cento. `d2` è il quadrato della
/// distanza; il `+ 64` ammorbidisce la singolarità a 8 px, come prima.
/// Restituisce il modulo già diviso per la distanza, il fattore che moltiplica
/// (dx, dy): una radice sola per coppia invece di due.
function repulsionOverDistance(strength: number, d2: number): number {
  return strength / (REPULSION_REFERENCE * Math.sqrt((d2 + 64) * d2));
}

/// Il dt del passo corrente: la molla del puntatore ne ha bisogno per
/// tarare i guadagni (deadbeat: k = 1/dt², c = 1/dt). Il motore la imposta
/// prima di `accumulateForces`; il default 1/60 basta per i test che chiamano
/// `accumulateForces` direttamente senza drag.
let forceDt = 1 / 60;

/// Imposta il dt del passo corrente. Chiamata dal motore prima di
/// `accumulateForces`; esportata perché il contratto di `accumulateForces` non
/// porta il dt (lo gestisce il motore, non la forza).
export function setDt(dt: number): void {
  forceDt = dt;
}

/// Callback per la repulsione Barnes-Hut: riceve (dx, dy, d2, massa) dal
/// quadtree e accumula l'accelerazione sul nodo `indiceForze`. I nodi
/// coincidenti (d2 < 1e-4) si saltano: nel ramo BH non si può applicare
/// l'offset deterministico (la callback non sa quale coppia sia), e i nodi
/// coincidenti vengono separati dalla griglia di collisione.
function bhRepulsion(dx: number, dy: number, d2: number, mass: number): void {
  if (d2 < 1e-4) return;
  const s = forceStructure!;
  // dx,dy puntano dal nodo di query (i) al nodo j (x_j − x_i). La repulsione
  // spinge i LONTANO da j: lungo −(dx,dy), cioè verso (x_i − x_j).
  const scale = repulsionOverDistance(forceRepulsion * mass, d2);
  s.fx[forceIndex] -= scale * dx;
  s.fy[forceIndex] -= scale * dy;
}

/// Lo smorzamento dentro il pozzo del magnete, per secondo: senza, i nodi
/// attratti ci orbiterebbero attorno all'infinito invece di raccogliersi.
export const WELL_DAMPING = 6;
/// La distanza, in frazione del raggio, sotto cui l'attrazione del pozzo si
/// ammorbidisce: al centro non c'è una singolarità che scaglia i nodi.
const WELL_SOFT = 0.15;

/// Azzera `fx`/`fy` e le riempie con repulsione + molle + gravità + spazio
/// personale + distanza dagli archi + pozzo del magnete + molla del
/// puntatore. Per tier 1 (o quadtree assente) la repulsione è esatta O(n²);
/// per tier ≥ 2 usa Barnes-Hut. `alpha` è la temperatura del motore: la
/// distanza dagli archi vale solo a grafo quasi freddo. Zero allocazioni
/// dopo il primo passo: la callback è una funzione di modulo, non una closure
/// per nodo, e griglia e lunghezze di riposo si tengono per struttura.
export function accumulateForces(
  s: Structure,
  config: PhysicsConfig,
  q: Quadtree | null,
  tier: Tier,
  well: Well | null = null,
  alpha = 1,
): void {
  const n = s.n;
  const fx = s.fx;
  const fy = s.fy;
  for (let i = 0; i < n; i++) {
    fx[i] = 0;
    fy[i] = 0;
  }

  // ── Repulsione ────────────────────────────────────────────────────────
  if (q !== null && tier >= 2) {
    forceStructure = s;
    forceRepulsion = config.repulsion * TIME_SCALE;
    for (let i = 0; i < n; i++) {
      forceIndex = i;
      visit(q, config.theta, s.x[i], s.y[i], bhRepulsion);
    }
  } else {
    // O(n²) esatta. Loop j > i con contributo a entrambi: metà del costo,
    // simmetria esatta (le masse uguali danno momento zero al bit).
    const repulsion = config.repulsion * TIME_SCALE;
    for (let i = 0; i < n; i++) {
      const xi = s.x[i];
      const yi = s.y[i];
      for (let j = i + 1; j < n; j++) {
        let dx = s.x[j] - xi;
        let dy = s.y[j] - yi;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) {
          // Nodi coincidenti: offset deterministico dal vecchio codice —
          // separazione monotona, niente jitter casuale, e stabile perché
          // la spinta ha direzione fissa finché restano sovrapposti.
          dx = 0.5 + (i % 3) * 0.1;
          dy = 0.5 - (j % 3) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        // dx,dy = x_j − x_i (da i a j). Repulsione: i si allontana da j
        // (lungo −û), j si allontana da i (lungo +û). La massa del vicino
        // entra: un hub respinge di più.
        const scale = repulsionOverDistance(repulsion, d2);
        const fi = scale * s.mass[j];
        const fj = scale * s.mass[i];
        fx[i] -= fi * dx;
        fy[i] -= fi * dy;
        fx[j] += fj * dx;
        fy[j] += fj * dy;
      }
    }
  }

  // ── Molle con dashpot ─────────────────────────────────────────────────
  const k = config.springStiffness * TIME_SCALE;
  const L0 = config.baseLength;
  const damping = config.springDamping;
  const rest = restOf(s);
  for (let e = 0; e < s.m; e++) {
    const i = s.from[e];
    const j = s.to[e];
    const mi = s.mass[i];
    const mj = s.mass[j];
    let dx = s.x[i] - s.x[j];
    let dy = s.y[i] - s.y[j];
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) {
      // Nodi coincidenti legati da un arco: versore indefinito. Offset
      // deterministico (come la repulsione), basato sull'indice dell'arco.
      dx = 0.5 + (e % 3) * 0.1;
      dy = 0.5 - (e % 3) * 0.1;
      d = Math.sqrt(dx * dx + dy * dy);
    }
    const ux = dx / d;
    const uy = dy / d;
    // Lunghezza di riposo: una foglia sta sul ventaglio del suo nodo, due
    // nodi collegati a distanza dei loro ventagli (`restLengths`).
    const l0e = L0 * rest[e];
    // Velocità relativa lungo l'asse della molla (positiva = si allontana).
    const vrel = (s.vx[i] - s.vx[j]) * ux + (s.vy[i] - s.vy[j]) * uy;
    // Massa ridotta per lo smorzamento: il dashpot è criticamente smorzato
    // sulla massa ridotta, non su quella del singolo nodo.
    const mrid = mi + mj > 0 ? (mi * mj) / (mi + mj) : 0;
    const cd = damping * 2 * Math.sqrt(k * mrid);
    // fmod = k·(d − L0) + c_d·vrel. Forza su i = −fmod·û, su j = +fmod·û.
    // d > L0 → fmod > 0 → a_i = −fmod·û (verso j): attrattiva. ✓
    const fmod = k * (d - l0e) + cd * vrel;
    if (mi > 0) {
      fx[i] -= (fmod * ux) / mi;
      fy[i] -= (fmod * uy) / mi;
    }
    if (mj > 0) {
      fx[j] += (fmod * ux) / mj;
      fy[j] += (fmod * uy) / mj;
    }
  }

  // ── Gravità ───────────────────────────────────────────────────────────
  // Richiamo verso l'origine, per unità di massa. Il nodo trascinato è
  // esentato: la molla del puntatore lo governa. Le note isolate ne
  // sentono di più: senza archi niente le trattiene, e con la gravità debole
  // del resto finivano lontane e rimpicciolivano l'inquadratura.
  const g = config.gravity * TIME_SCALE;
  if (g !== 0) {
    const t = s.dragged;
    for (let i = 0; i < n; i++) {
      if (i === t) continue;
      const gi = s.degree[i] === 0 ? g * ORPHAN_GRAVITY : g;
      fx[i] += -gi * s.x[i];
      fy[i] += -gi * s.y[i];
    }
  }

  // ── Spazio personale e distanza dagli archi ───────────────────────────
  // Forze a corto raggio sulla griglia dei vicini: fino a duemila nodi,
  // come le collisioni. La distanza dagli archi cresce solo mentre il grafo
  // si raffredda: da caldo un nodo deve poter attraversare un arco, o il
  // groviglio della partenza resterebbe congelato.
  if (tier < 3 && n > 1) {
    personalSpace(s, L0);
    const clearance = alpha >= CLEARANCE_ALPHA ? 0 : (CLEARANCE_ALPHA - alpha) / CLEARANCE_ALPHA;
    if (clearance > 0 && s.m > 0) edgeClearance(s, L0, clearance);
  }

  // ── Pozzo del magnete ─────────────────────────────────────────────────
  // Un'attrazione verso il puntatore che cala a zero sul bordo del raggio,
  // come (1 − d/R)², più uno smorzamento con la stessa forma: i nodi vicini
  // si raccolgono attorno al puntatore e lo seguono, quelli fuori non
  // sentono niente. Accelerazione, non forza: un hub arriva come una foglia,
  // e il pozzo lo trascinano insieme.
  if (well !== null && well.strength > 0 && well.radius > 0) {
    const R = well.radius;
    const soft2 = (R * WELL_SOFT) * (R * WELL_SOFT);
    for (let i = 0; i < n; i++) {
      if (s.fixed[i] !== 0) continue;
      const dx = well.x - s.x[i];
      const dy = well.y - s.y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2);
      const fall = (1 - d / R) * (1 - d / R);
      const pull = (well.strength * fall) / Math.sqrt(d2 + soft2);
      fx[i] += pull * dx - WELL_DAMPING * fall * s.vx[i];
      fy[i] += pull * dy - WELL_DAMPING * fall * s.vy[i];
    }
  }

  // ── Molla del puntatore (drag) ────────────────────────────────────────
  // Deadbeat: k = 1/dt², c = 1/dt. Con Euler semi-implicito il nodo raggiunge
  // il bersaglio in un passo e si ferma al successivo, a ogni dt ≤ 1/30, e
  // l'accelerazione è indipendente dalla massa. Si sovrascrive (non si
  // somma): il drag è un controllo, non una forza fisica — il nodo segue il
  // mouse esattamente, e le collisioni spingono gli altri fuori strada.
  const t = s.dragged;
  if (t >= 0) {
    const kp = 1 / (forceDt * forceDt);
    const cp = 1 / forceDt;
    fx[t] = kp * (s.px[t] - s.x[t]) - cp * s.vx[t];
    fy[t] = kp * (s.py[t] - s.y[t]) - cp * s.vy[t];
  }
}

// ── Forze a corto raggio ──────────────────────────────────────────────────

/// Le lunghezze di riposo di una struttura, calcolate una volta: dipendono
/// solo dalla topologia, che non cambia dopo la creazione.
const rests = new WeakMap<Structure, Float32Array>();

function restOf(s: Structure): Float32Array {
  let r = rests.get(s);
  if (!r || r.length !== s.m) {
    r = restLengths(s);
    rests.set(s, r);
  }
  return r;
}

/// La gravità delle note isolate, rispetto a quella degli altri: le tiene in
/// un anello appena fuori dal grafo. Molto di più e cadrebbero dentro, nei
/// vuoti fra i gruppi, dove la repulsione di un anello di nodi si annulla.
export const ORPHAN_GRAVITY = 1.5;

/// Lo spazio personale di un nodo, in lunghezze base, e la spinta al contatto
/// (per passo, scalata come le altre da `TIME_SCALE`). Sotto questa distanza
/// due nodi si allontanano con una molla corta: la repulsione 1/d da sola li
/// lasciava a un passo l'uno dall'altro nelle zone fitte, con le etichette
/// che si coprivano. Lineare nella compenetrazione, zero al bordo: nessun
/// salto quando un nodo entra o esce.
export const PERSONAL_SPACE = 0.45;
const PERSONAL_PUSH = 15;

/// La distanza di un nodo dagli archi che non sono suoi, in lunghezze base,
/// la spinta al contatto e la temperatura sotto cui comincia a valere. Un nodo
/// appoggiato su un arco sembra collegato a chi non lo è.
export const EDGE_CLEARANCE = 0.3;
const EDGE_PUSH = 10;
export const CLEARANCE_ALPHA = 0.15;
/// Un arco che copre più celle di così attraversa mezzo grafo: la sua
/// distanza la fanno le altre forze, e il passo resta O(m).
const EDGE_CELLS_MAX = 1024;

function personalSpace(s: Structure, L0: number): void {
  const R = PERSONAL_SPACE * L0;
  const push = PERSONAL_PUSH * TIME_SCALE;
  const g = gridOf(s);
  fillGrid(g, s, R);
  const head = g.head;
  const fx = s.fx;
  const fy = s.fy;
  for (let i = 0; i < s.n; i++) {
    const cxi = g.cellX[i];
    const cyi = g.cellY[i];
    for (let o = 0; o < FORWARD_CELLS.length; o++) {
      const cx = cxi + FORWARD_CELLS[o][0];
      const cy = cyi + FORWARD_CELLS[o][1];
      let j = head[hashCell(g, cx, cy)];
      for (; j >= 0; j = g.next[j]) {
        if (o === 0 && j >= i) continue;
        if (g.cellX[j] !== cx || g.cellY[j] !== cy) continue;
        let dx = s.x[j] - s.x[i];
        let dy = s.y[j] - s.y[i];
        let d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        if (d2 < 1e-4) {
          // Coincidenti: la stessa direzione deterministica della repulsione.
          dx = 0.5 + (i % 3) * 0.1;
          dy = 0.5 - (j % 3) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const a = (push * (R - d)) / (R * d);
        fx[i] -= a * dx;
        fy[i] -= a * dy;
        fx[j] += a * dx;
        fy[j] += a * dy;
      }
    }
  }
}

/// Ogni nodo più vicino di `EDGE_CLEARANCE` a un arco non suo ne viene
/// spinto via lungo la perpendicolare, e i due estremi dell'arco ricevono la
/// spinta opposta divisa secondo dove cade il nodo: niente moto netto dal
/// nulla. `strength` 0..1 è la rampa di temperatura.
function edgeClearance(s: Structure, L0: number, strength: number): void {
  const R = EDGE_CLEARANCE * L0;
  const push = EDGE_PUSH * TIME_SCALE * strength;
  const g = gridOf(s);
  fillGrid(g, s, R);
  const head = g.head;
  const fx = s.fx;
  const fy = s.fy;
  for (let e = 0; e < s.m; e++) {
    const a = s.from[e];
    const b = s.to[e];
    const ax = s.x[a];
    const ay = s.y[a];
    const vx = s.x[b] - ax;
    const vy = s.y[b] - ay;
    const L2 = vx * vx + vy * vy;
    if (L2 < 1e-6) continue;
    const cx0 = Math.floor((Math.min(ax, s.x[b]) - R) / R);
    const cx1 = Math.floor((Math.max(ax, s.x[b]) + R) / R);
    const cy0 = Math.floor((Math.min(ay, s.y[b]) - R) / R);
    const cy1 = Math.floor((Math.max(ay, s.y[b]) + R) / R);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > EDGE_CELLS_MAX) continue;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let i = head[hashCell(g, cx, cy)];
        for (; i >= 0; i = g.next[i]) {
          if (i === a || i === b) continue;
          if (g.cellX[i] !== cx || g.cellY[i] !== cy) continue;
          // Il punto dell'arco più vicino al nodo; oltre gli estremi il nodo
          // è vicino a un nodo, non all'arco, e ci pensa lo spazio personale.
          const t = ((s.x[i] - ax) * vx + (s.y[i] - ay) * vy) / L2;
          if (t <= 0 || t >= 1) continue;
          const dx = s.x[i] - (ax + t * vx);
          const dy = s.y[i] - (ay + t * vy);
          const d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const f = (push * (R - d)) / (R * d);
          fx[i] += f * dx;
          fy[i] += f * dy;
          fx[a] -= f * dx * (1 - t);
          fy[a] -= f * dy * (1 - t);
          fx[b] -= f * dx * t;
          fy[b] -= f * dy * t;
        }
      }
    }
  }
}

// ── Collisioni ────────────────────────────────────────────────────────────
// Correzione posizionale sulla griglia dei vicini (`grid.ts`). O(n) atteso,
// non O(n²): il contratto `collisions(s, config)` non porta il quadtree.
// Due iterazioni: la prima separa, la seconda assesta (le posizioni cambiano,
// quindi la griglia si riempie di nuovo).

/// Raggio massimo possibile: `4 + min(9, sqrt(degree)·1.7)` con grado
/// Uint16 → 13. La cella deve contenere la coppia più grande che collide
/// (d < r_i + r_j + 4 ≤ 30), quindi 2·13 + 4 = 30.
const MAX_RADIUS = 4 + Math.min(9, Math.sqrt(65535) * 1.7);
const CELL_SIZE = 2 * MAX_RADIUS + 4;

// ── Urti forti ────────────────────────────────────────────────────────────
// Gli urti più veloci di `IMPACT_SPEED` si annotano qui, perché il grafico ne
// faccia un'onda e una scossa di gelatina: solo resa, il motore non li
// rilegge. Buffer di modulo a capienza fissa, azzerato a ogni `collisions`:
// il grafico lo legge subito dopo il passo, nello stesso frame sincrono.

/// La velocità d'avvicinamento (px di mondo al secondo) oltre la quale un urto
/// si vede: sotto, i nodi che si sfiorano mentre il grafo si assesta.
export const IMPACT_SPEED = 600;
/// Quanti urti si annotano per passo; gli altri si perdono, e va bene così.
export const IMPACT_CAPACITY = 8;
/// Un urto: indice i, indice j, velocità d'avvicinamento, normale (ux, uy)
/// da j verso i.
export const IMPACT_STRIDE = 5;
/// Gli urti forti dell'ultimo passo, in righe di `IMPACT_STRIDE`: la vista è
/// del modulo e vale fino al prossimo passo. Se ne leggono `impactCount()`.
export const IMPACTS: Readonly<Float32Array> = new Float32Array(IMPACT_CAPACITY * IMPACT_STRIDE);
const impactData = IMPACTS as Float32Array;
let impactTotal = 0;

export function impactCount(): number {
  return impactTotal;
}

/// Svuota il registro: il motore lo chiama a ogni passo, anche quando le
/// collisioni sono spente (tier 3), perché due grafi in due riquadri
/// condividono il modulo e uno non deve leggere gli urti dell'altro.
export function clearImpacts(): void {
  impactTotal = 0;
}

/// Due iterazioni posizionali. I nodi bloccati (fisso 1) e trascinati
/// (fisso 2) non si muovono: fanno da muro, e il nodo libero assorbe tutto
/// l'overlap. La spinta è inversamente proporzionale alla massa (il leggero
/// si muove di più), divisa a metà quando entrambi sono liberi.
export function collisions(s: Structure, config: PhysicsConfig): void {
  impactTotal = 0;
  if (!config.collisions || s.n < 2) return;
  const g = gridOf(s);
  const bounce = config.bounce;
  for (let iter = 0; iter < 2; iter++) sweepCollisions(s, g, bounce);
}

function sweepCollisions(s: Structure, g: Grid, bounce: number): void {
  const n = s.n;
  const head = g.head;
  fillGrid(g, s, CELL_SIZE);
  // Esamina le coppie: stessa cella (j < i) + 4 celle avanti.
  for (let i = 0; i < n; i++) {
    const cxi = g.cellX[i];
    const cyi = g.cellY[i];
    const ri = s.radius[i];
    const movesI = s.fixed[i] === 0;
    for (let o = 0; o < FORWARD_CELLS.length; o++) {
      const cx = cxi + FORWARD_CELLS[o][0];
      const cy = cyi + FORWARD_CELLS[o][1];
      const h = hashCell(g, cx, cy);
      let j = head[h];
      while (j >= 0) {
        // Stessa cella: solo j < i (dedupe). Celle avanti: tutte le j.
        if (o === 0 && j >= i) {
          j = g.next[j];
          continue;
        }
        // Verifica cella esatta (collisioni di hash).
        if (g.cellX[j] !== cx || g.cellY[j] !== cy) {
          j = g.next[j];
          continue;
        }
        resolvePair(s, i, j, ri, movesI, bounce);
        j = g.next[j];
      }
    }
  }
}

function resolvePair(
  s: Structure,
  i: number,
  j: number,
  ri: number,
  movesI: boolean,
  bounce: number,
): void {
  const movesJ = s.fixed[j] === 0;
  if (!movesI && !movesJ) return;
  let dx = s.x[i] - s.x[j];
  let dy = s.y[i] - s.y[j];
  let d = Math.sqrt(dx * dx + dy * dy);
  const overlap = ri + s.radius[j] + 4 - d;
  if (overlap <= 0) return;
  if (d < 1e-9) {
    // Coincidenti: offset deterministico (i, j) per direzione stabile.
    dx = 0.5 + (i % 3) * 0.1;
    dy = 0.5 - (j % 3) * 0.1;
    d = Math.sqrt(dx * dx + dy * dy);
  }
  const ux = dx / d;
  const uy = dy / d;
  const mi = s.mass[i];
  const mj = s.mass[j];
  // Urto lungo la normale: la correzione di posizione da sola lasciava
  // intatta la velocità che li portava l'uno dentro l'altro, e al passo dopo
  // si rientrava — il tremolio dei nodi a contatto. Si toglie la componente
  // che avvicina e se ne restituisce la parte `bounce` nel verso opposto,
  // divisa come la spinta: a 0 si fermano a contatto, sopra rimbalzano. Il
  // secondo sweep vede già una velocità che separa, e non rimbalza due volte.
  const approach = (s.vx[i] - s.vx[j]) * ux + (s.vy[i] - s.vy[j]) * uy;
  if (approach < 0) {
    const impulse = approach * (1 + bounce);
    if (movesI && movesJ) {
      const tot = mi + mj > 0 ? mi + mj : 1;
      s.vx[i] -= (impulse * mj / tot) * ux;
      s.vy[i] -= (impulse * mj / tot) * uy;
      s.vx[j] += (impulse * mi / tot) * ux;
      s.vy[j] += (impulse * mi / tot) * uy;
    } else if (movesI) {
      s.vx[i] -= impulse * ux;
      s.vy[i] -= impulse * uy;
    } else {
      s.vx[j] += impulse * ux;
      s.vy[j] += impulse * uy;
    }
    if (-approach > IMPACT_SPEED && impactTotal < IMPACT_CAPACITY) {
      const o = impactTotal * IMPACT_STRIDE;
      impactData[o] = i;
      impactData[o + 1] = j;
      impactData[o + 2] = -approach;
      impactData[o + 3] = ux;
      impactData[o + 4] = uy;
      impactTotal++;
    }
  }
  if (movesI && movesJ) {
    // Entrambi liberi: split a metà, inversamente proporzionale alla massa.
    const tot = mi + mj > 0 ? mi + mj : 1;
    const pushI = (overlap * 0.5 * mj) / tot;
    const pushJ = (overlap * 0.5 * mi) / tot;
    s.x[i] += ux * pushI;
    s.y[i] += uy * pushI;
    s.x[j] -= ux * pushJ;
    s.y[j] -= uy * pushJ;
  } else if (movesI) {
    // j è un muro: i assorbe tutto l'overlap.
    s.x[i] += ux * overlap;
    s.y[i] += uy * overlap;
  } else {
    // i è un muro: j assorbe tutto.
    s.x[j] -= ux * overlap;
    s.y[j] -= uy * overlap;
  }
}