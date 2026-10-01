// I tipi condivisi del grafo 2.0: il contratto fra motore fisico, disegno e
// configurazione. Vive in `sim/` perché è la simulazione a dare la forma ai
// numeri, ma non importa DOM e non importa il motore: è il file che
// `render/*`, `interaction.ts`, `config.ts` e `chart.ts` guardano per
// sapere com'è fatto un grafo. Chi lo cambia cambia tutti: per questo è
// ghiacciato durante lo sviluppo in parallelo (vedi `../../../../docs/product/search-links-and-graph.md` §9).
//
// La scelta strutturale è l'SoA: niente array di oggetti `SimNode`, ma
// `Float32Array` fratelli. Nel loop caldo — che gira anche duemila volte per
// frame — un oggetto per nodo è una cacce al puntatore per campo e una
// pressione sul GC a ogni respiro; qui ogni campo è un passaggio lineare su
// memoria contigua, e i buffer `fx/fy` delle forze si riusano senza mai
// allocare dentro il frame.

/// Ciò che arriva nel `payload` del nodo custom `fub:graph`. La forma la
/// decide `fub_features::graph` e non cambia (contratto §0 di `../../../../docs/product/search-links-and-graph.md`):
/// tutto il resto — grado, massa, raggio — si ricava di qua.
export interface GraphData {
  nodes: string[];
  edges: { from: string; to: string }[];
}

/// La struttura del grafo in forma SoA. Indici ovunque: un arco è una coppia
/// di interi, un drag è l'indice del nodo trascinato.
export interface Structure {
  /// Posizione e velocità in coordinate **mondo** (px di mondo, non di
  /// schermo: la scala sta nella camera, non qui).
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /// Accelerazioni accumulate nel passo corrente (per unità di massa — le
  /// molle dividono per la massa del nodo, il resto no): buffer di lavoro
  /// riusato, si azzera all'inizio di ogni `step`.
  fx: Float32Array;
  fy: Float32Array;
  /// Bersaglio del puntatore per il nodo in drag (coordinate mondo): il
  /// trascinamento è una molla corta rigidissima, non un teleport — così il
  /// nodo arriva col suo carico di velocità e il rilascio lo lascia partire.
  px: Float32Array;
  py: Float32Array;
  /// Massa e raggio: dipendono solo dal grado, che non cambia dopo la
  /// creazione. 1 + log(1+grado)·pesoGrado — gli hub pesano e camminano
  /// piano, i satelliti li orbitano: è gran parte della «soddisfazione».
  mass: Float32Array;
  radius: Float32Array;
  degree: Uint16Array;
  /// 0 libero · 1 bloccato (pin, doppio click) · 2 trascinato.
  fixed: Uint8Array;
  /// Indice del nodo trascinato, −1 se nessuno. La molla del puntatore in
  /// `forze.ts` guarda solo questo.
  dragged: number;
  /// Identità: l'unico pezzo non numerico, letto fuori dal loop caldo.
  id: string[];
  /// Archi per indice + curvatura stabile per arco (§5.3 di `../../../../docs/product/search-links-and-graph.md`):
  /// due archi a↔b si separano in due curve speculari invece di giacersi
  /// sopra.
  from: Uint32Array;
  to: Uint32Array;
  curvature: Float32Array;
  n: number;
  m: number;
}

/// Livelli di qualità: la taglia del grafo cambia quanto costa un frame, non
/// quanta fisica fa (§3.4 di `../../../../docs/product/search-links-and-graph.md`).
export type Tier = 1 | 2 | 3;

export interface PhysicsConfig {
  /// Costante di repulsione fra coppie (accelerazione ∝ repulsione·mj/d²).
  repulsion: number;
  /// Distanza di riposo base delle molle, in px di mondo.
  baseLength: number;
  /// Rigidità delle molle.
  springStiffness: number;
  /// Quota dello smorzamento criticamente smorzato lungo l'arco: 1 = il
  /// sistema non oscilla mai, 0 = molle vive.
  springDamping: number;
  /// Richiamo verso il centro (0,0), per unità di massa. Debole: tiene
  /// insieme componenti e note isolate, ma non schiaccia il grafo in un disco
  /// a densità uniforme che ignora gli archi.
  gravity: number;
  /// Ritenzione di velocità per passo (dt = 1/60 fisso).
  friction: number;
  /// Tetto di velocità in px di mondo al secondo.
  maxSpeed: number;
  /// Quanto pesa il grado nella massa.
  degreeWeight: number;
  /// Correzioni posizionali di collisione attive.
  collisions: boolean;
  /// Apertura di Barnes-Hut (solo tier ≥ 2).
  theta: number;
  /// Quanto la semina piega i rami, in radianti: a 0 una catena parte
  /// dritta, sopra serpeggia. Pesa anche un poco sulle lunghezze di partenza.
  jitter: number;
  /// Decadimento dell'alpha per passo (0.985 ≈ si assesta in ~3 s).
  cooling: number;
  /// Restituzione degli urti: 0 i nodi si fermano a contatto, 0.9 rimbalzano
  /// quasi come biglie. La correzione di posizione non cambia.
  bounce: number;
}

/// Il pozzo del magnete (pressione lunga sul vuoto): un'attrazione verso un
/// punto di mondo entro un raggio. Stato d'interazione, non configurazione:
/// lo tiene il grafico e lo passa al motore finché il gesto dura.
export interface Well {
  x: number;
  y: number;
  radius: number;
  /// Accelerazione al centro, in px di mondo al secondo quadrato.
  strength: number;
}

export interface GraphicsConfig {
  glow: boolean;
  pulse: boolean;
  trail: boolean;
  grid: boolean;
  /// Moltiplicatore 0..1 sulla curvatura stabile degli archi.
  edgeCurvature: number;
  /// 0..1 — quanto sono dense le etichette.
  labelDensity: number;
  /// 0..1 — quanta gelatina: nodi che si schiacciano e si allungano, archi che
  /// vibrano. Solo resa: 0 la spegne, e il layout non cambia comunque.
  wobble: number;
}

export interface GraphConfig {
  physics: PhysicsConfig;
  graphics: GraphicsConfig;
  /// Nome del preset attivo, `"custom"` appena si tocca uno slider.
  preset: string;
}

/// La configurazione predefinita: il preset «organico». Ogni numero qui è un
/// punto di partenza provato per la sensazione giusta su un vault medio, e
/// ogni campo ha un range in `clampConf`: il pannello manda valori umani, il
/// motore riceve valori già validi.
///
/// Le molle sono sottosmorzate e l'attrito è leggero: un nodo trascinato si
/// porta dietro il suo quartiere, che ondeggia e si riassesta, e un nodo
/// lanciato torna indietro come una fionda. Era sovrasmorzato — 0.86 per
/// passo toglieva il 99,99% della velocità al secondo — e niente oscillava.
/// La forma d'equilibrio non dipende dallo smorzamento, e la ricottura del
/// motore spegne comunque il moto quando la temperatura scende.
///
/// La gravità è debole e la repulsione più ampia: con la gravità di prima la
/// repulsione 1/d riempiva un disco a densità uniforme, qualunque fossero gli
/// archi, e le foglie finivano dove c'era posto, non accanto al loro nodo.
export function organicConfig(): PhysicsConfig {
  return {
    repulsion: 3600,
    baseLength: 120,
    springStiffness: 0.12,
    springDamping: 0.18,
    gravity: 0.008,
    friction: 0.955,
    maxSpeed: 2400,
    degreeWeight: 0.8,
    collisions: true,
    theta: 0.9,
    jitter: 0.35,
    cooling: 0.985,
    bounce: 0.3,
  };
}

export function defaultGraphicsConfig(): GraphicsConfig {
  // La scia è una scelta, non il default: mentre il grafo si distende
  // impastava archi ed etichette in una macchia.
  return {
    glow: true,
    pulse: true,
    trail: false,
    grid: true,
    edgeCurvature: 1,
    labelDensity: 0.5,
    wobble: 0.5,
  };
}

/// I preset: personalità fisiche, non solo numeri. Il nome è la chiave i18n
/// `graph.preset.<name>` e il pannello li elenca nell'ordine qui sotto.
export const PRESETS: Record<string, () => PhysicsConfig> = {
  "organica": organicConfig,
  "gelatina": () => ({
    ...organicConfig(),
    springStiffness: 0.18,
    springDamping: 0.06,
    friction: 0.975,
    maxSpeed: 3000,
    bounce: 0.7,
  }),
  "costellazione": () => ({
    ...organicConfig(),
    repulsion: 9000,
    springStiffness: 0.04,
    springDamping: 0.3,
    gravity: 0.002,
    friction: 0.96,
    bounce: 0.2,
  }),
  "alveare": () => ({ ...organicConfig(), gravity: 0.032, collisions: true, friction: 0.93, bounce: 0.5 }),
  "nebulosa": () => ({ ...organicConfig(), friction: 0.97, springStiffness: 0.06, jitter: 0.8, bounce: 0.15 }),
  "rigido": () => ({
    ...organicConfig(),
    springStiffness: 0.35,
    springDamping: 0.85,
    friction: 0.7,
    maxSpeed: 400,
    bounce: 0,
  }),
};

/// Validazione: i valori esterni (pannello, localStorage) non sono fidati.
/// Ritorna una copia clampana — mai mutare l'input.
export function clampPhysicsConfig(c: Partial<PhysicsConfig>): PhysicsConfig {
  const d = organicConfig();
  const num = (v: unknown, min: number, max: number, def: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    repulsion: num(c.repulsion, 200, 20000, d.repulsion),
    baseLength: num(c.baseLength, 40, 400, d.baseLength),
    springStiffness: num(c.springStiffness, 0.01, 1, d.springStiffness),
    springDamping: num(c.springDamping, 0, 1, d.springDamping),
    gravity: num(c.gravity, 0, 0.2, d.gravity),
    friction: num(c.friction, 0.5, 0.98, d.friction),
    maxSpeed: num(c.maxSpeed, 100, 4000, d.maxSpeed),
    degreeWeight: num(c.degreeWeight, 0, 3, d.degreeWeight),
    collisions: typeof c.collisions === "boolean" ? c.collisions : d.collisions,
    theta: num(c.theta, 0.5, 1.2, d.theta),
    jitter: num(c.jitter, 0, 1, d.jitter),
    cooling: num(c.cooling, 0.9, 0.999, d.cooling),
    bounce: num(c.bounce, 0, 0.9, d.bounce),
  };
}

export function clampGraphicsConfig(c: Partial<GraphicsConfig>): GraphicsConfig {
  const d = defaultGraphicsConfig();
  const num = (v: unknown, min: number, max: number, def: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    glow: typeof c.glow === "boolean" ? c.glow : d.glow,
    pulse: typeof c.pulse === "boolean" ? c.pulse : d.pulse,
    trail: typeof c.trail === "boolean" ? c.trail : d.trail,
    grid: typeof c.grid === "boolean" ? c.grid : d.grid,
    edgeCurvature: num(c.edgeCurvature, 0, 1, d.edgeCurvature),
    labelDensity: num(c.labelDensity, 0, 1, d.labelDensity),
    wobble: num(c.wobble, 0, 1, d.wobble),
  };
}

/// FNV-1a: hash stabile di stringa, per semi e curvature. Non serve
/// crittografia, serve che due aperture dello stesso vault facciano lo stesso
/// disegno.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/// mulberry32: RNG deterministico per la semina. Niente `Math.random` nel
/// grafo — era la convenzione del codice di prima e resta.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Costruisce la struttura dai dati del provider. Pura: stesso input + stesso
/// seme → stessa struttura, testabile senza DOM.
///
/// Il grado si conta **dopo** aver scartato self-loop e archi con estremità
/// sconosciute — era già giusto nel codice di prima e il report scout 1 lo
/// ha verificato. Gli id duplicati si tengono una volta sola: un payload
/// storto arriva da un provider, e un provider può essere di terzi.
export function createStructure(data: GraphData, config: PhysicsConfig, seed: number): Structure {
  const ids = [...new Set(data.nodes)].sort();
  const n = ids.length;
  const s: Structure = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    fx: new Float32Array(n),
    fy: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    mass: new Float32Array(n),
    radius: new Float32Array(n),
    degree: new Uint16Array(n),
    fixed: new Uint8Array(n),
    dragged: -1,
    id: ids,
    from: new Uint32Array(data.edges.length),
    to: new Uint32Array(data.edges.length),
    curvature: new Float32Array(data.edges.length),
    n: 0,
    m: 0,
  };
  const index = new Map<string, number>();
  for (const id of ids) {
    index.set(id, s.n);
    s.n++;
  }
  const edges = data.edges
    .filter((e) => {
      const fromIndex = index.get(e.from);
      const toIndex = index.get(e.to);
      return (
        fromIndex !== undefined &&
        toIndex !== undefined &&
        fromIndex !== toIndex
      );
    })
    .sort((a, b) =>
      a.from < b.from
        ? -1
        : a.from > b.from
          ? 1
          : a.to < b.to
            ? -1
            : a.to > b.to
              ? 1
              : 0,
    );
  for (const e of edges) {
    const fromIndex = index.get(e.from)!;
    const toIndex = index.get(e.to)!;
    s.from[s.m] = fromIndex;
    s.to[s.m] = toIndex;
    s.degree[fromIndex]++;
    s.degree[toIndex]++;
    // Curvatura stabile per coppia: hash dell'identità, non della posizione
    // — sopravvive al movimento e separa gli archi bidirezionali.
    s.curvature[s.m] = (((fnv1a(e.from + "|" + e.to) % 1000) / 1000 - 0.5) * 0.44) * 1;
    s.m++;
  }
  for (let i = 0; i < s.n; i++) {
    s.mass[i] = 1 + Math.log1p(s.degree[i]) * config.degreeWeight;
    s.radius[i] = 4 + Math.min(9, Math.sqrt(s.degree[i]) * 1.7);
  }
  seedLayout(s, config, mulberry32(seed));
  return s;
}

// ── Lunghezze di riposo ───────────────────────────────────────────────────
// Un nodo ha bisogno di spazio attorno in proporzione a quanti vicini ha:
// le sue foglie gli stanno in un ventaglio, e il ventaglio deve contenerle
// senza che si tocchino. Erano lunghezze che crescevano col grado e basta:
// le foglie di un hub finivano a più di due lunghezze base, in mezzo ai nodi
// degli altri, coi loro archi che attraversavano il grafo.

/// La distanza minima di una foglia dal suo nodo, in lunghezze base.
export const LEAF_REST = 0.6;
/// Lo spazio fra due foglie vicine sullo stesso ventaglio, in lunghezze base.
const LEAF_GAP = 0.5;
/// La parte di giro che un ventaglio occupa: il resto guarda verso gli altri
/// vicini del nodo.
const FAN_ARC = 0.8;
/// Oltre questi vicini il ventaglio non allarga più il raggio in proporzione
/// ma con la radice: sessanta foglie fanno un soffione a più strati, non un
/// anello enorme con il resto del grafo chiuso dentro.
const CROWD_KNEE = 12;

/// Il raggio del ventaglio di un nodo con `degree` vicini, in lunghezze base.
export function crowdRadius(degree: number): number {
  const linear = (k: number): number => Math.max(LEAF_REST, (k * LEAF_GAP) / (2 * Math.PI * FAN_ARC));
  return degree > CROWD_KNEE ? linear(CROWD_KNEE) * Math.sqrt(degree / CROWD_KNEE) : linear(degree);
}

/// La lunghezza di riposo di ogni arco, in lunghezze base. Pura: dipende
/// solo dalla topologia, che non cambia dopo la creazione. Una foglia (grado
/// 1) sta sul ventaglio del suo nodo; due nodi che non sono foglie si tengono
/// alla distanza del ventaglio più grande, così ciascuno sta sul bordo del
/// ventaglio dell'altro e non dentro; mai sotto una lunghezza base.
export function restLengths(s: Structure): Float32Array {
  const out = new Float32Array(s.m);
  for (let e = 0; e < s.m; e++) {
    const i = s.from[e];
    const j = s.to[e];
    const leafI = s.degree[i] === 1;
    const leafJ = s.degree[j] === 1;
    if (leafI && leafJ) out[e] = LEAF_REST;
    else if (leafI) out[e] = crowdRadius(s.degree[j]);
    else if (leafJ) out[e] = crowdRadius(s.degree[i]);
    else out[e] = Math.max(1, crowdRadius(s.degree[i]), crowdRadius(s.degree[j]));
  }
  return out;
}

// ── Semina ────────────────────────────────────────────────────────────────
// La posizione di partenza decide gran parte del disegno finale: la fisica
// scende nel minimo più vicino, e un arco che parte attraverso il grafo ci
// resta. Prima le note prendevano i posti di una spirale in ordine di
// visita, e le foglie di uno stesso nodo finivano a 137° l'una dall'altra,
// sparse per tutto il disco. Qui ogni componente è un albero di visita dal
// suo nodo più collegato, e ogni nodo apre i suoi figli a ventaglio dalla
// parte opposta a quella da cui è arrivato, alla loro lunghezza di riposo:
// le foglie nascono attorno al loro nodo, e i sottoalberi grandi prendono il
// centro del ventaglio. Gli archi che l'albero non usa li sistema la fisica.

/// Semina deterministica: stesso grafo e stesso seme, stesse posizioni. Il
/// `jitter` della conf piega i rami (radianti): a 0 le catene partono dritte,
/// e una catena sotto repulsione resta una riga rigida.
function seedLayout(s: Structure, config: PhysicsConfig, rng: () => number): void {
  const n = s.n;
  if (n === 0) return;
  const L0 = config.baseLength;
  const rest = restLengths(s);
  // Adiacenza compatta, con l'arco di ogni vicino: il figlio sa la sua
  // lunghezza di riposo senza cercarla.
  const start = new Uint32Array(n + 1);
  for (let e = 0; e < s.m; e++) {
    start[s.from[e] + 1]++;
    start[s.to[e] + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const adjacent = new Uint32Array(2 * s.m);
  const via = new Uint32Array(2 * s.m);
  for (let e = 0; e < s.m; e++) {
    adjacent[fill[s.from[e]]] = s.to[e];
    via[fill[s.from[e]]++] = e;
    adjacent[fill[s.to[e]]] = s.from[e];
    via[fill[s.to[e]]++] = e;
  }

  // Le componenti, ciascuna visitata in ampiezza dal suo nodo più collegato
  // (a parità decide l'indice).
  const parent = new Int32Array(n).fill(-1);
  const parentEdge = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const roots = Array.from({ length: n }, (_, i) => i).sort((a, b) => s.degree[b] - s.degree[a] || a - b);
  const components: number[][] = [];
  for (const root of roots) {
    if (seen[root]) continue;
    seen[root] = 1;
    const order = [root];
    for (let h = 0; h < order.length; h++) {
      const v = order[h];
      for (let a = start[v]; a < start[v + 1]; a++) {
        const w = adjacent[a];
        if (seen[w]) continue;
        seen[w] = 1;
        parent[w] = v;
        parentEdge[w] = via[a];
        order.push(w);
      }
    }
    components.push(order);
  }
  components.sort((a, b) => b.length - a.length || a[0] - b[0]);

  // Posizioni dentro ogni componente, radice nell'origine.
  const size = new Float64Array(n).fill(1);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const children: number[][] = Array.from({ length: n }, () => []);
  const reach: number[] = [];
  for (const order of components) {
    for (let h = order.length - 1; h > 0; h--) size[parent[order[h]]] += size[order[h]];
    for (let h = 1; h < order.length; h++) children[parent[order[h]]].push(order[h]);
    for (const v of order) {
      const kids = children[v];
      if (kids.length === 0) continue;
      // I sottoalberi grandi al centro del ventaglio, i piccoli e le foglie ai
      // lati: i rami lunghi partono dritti, lontano da dove si arriva.
      kids.sort((a, b) => size[b] - size[a] || a - b);
      const fan: number[] = [];
      for (let k = 0; k < kids.length; k++) {
        if (k % 2 === 0) fan.push(kids[k]);
        else fan.unshift(kids[k]);
      }
      let total = 0;
      for (const c of fan) total += Math.sqrt(size[c]);
      const p = parent[v];
      const root = p < 0;
      const heading = root ? 0 : Math.atan2(y[v] - y[p], x[v] - x[p]);
      // La radice apre tutto il giro; gli altri un ventaglio che cresce coi
      // figli, e lascia sempre libera la parte verso il padre.
      const spread = root ? 2 * Math.PI : Math.min(2 * Math.PI * FAN_ARC, Math.max(Math.PI / 2, (fan.length * Math.PI) / 5));
      const bend = fan.length === 1 ? 1 : 0.3;
      let before = 0;
      for (const c of fan) {
        const w = Math.sqrt(size[c]);
        const slot = (spread * (before + w / 2)) / total;
        before += w;
        const angle = (root ? slot : heading - spread / 2 + slot) + config.jitter * bend * (rng() * 2 - 1);
        const length = rest[parentEdge[c]] * L0 * (1 + 0.15 * config.jitter * (rng() * 2 - 1));
        x[c] = x[v] + length * Math.cos(angle);
        y[c] = y[v] + length * Math.sin(angle);
      }
    }
    let r = 0;
    for (const v of order) r = Math.max(r, Math.hypot(x[v], y[v]));
    reach.push(r + L0 * 0.5);
  }

  // Le componenti attorno alla più grande, su una spirale che tiene conto
  // del loro ingombro: le note isolate finiscono in un anello appena fuori.
  const golden = Math.PI * (3 - Math.sqrt(5));
  let area = 0;
  for (let k = 0; k < components.length; k++) {
    let cx = 0;
    let cy = 0;
    if (k > 0) {
      const distance = Math.sqrt(area) + reach[k];
      cx = distance * Math.cos(k * golden);
      cy = distance * Math.sin(k * golden);
    }
    area += reach[k] * reach[k];
    for (const v of components[k]) {
      s.x[v] = x[v] + cx;
      s.y[v] = y[v] + cy;
    }
  }
}

/// Il seme di un vault: hash degli id ordinati. Due aperture dello stesso
/// grafo partono identiche; un documento nuovo cambia il disegno, ed è
/// giusto che lo cambi.
export function seedOf(data: GraphData): number {
  return fnv1a([...new Set(data.nodes)].sort().join("\n"));
}

/// Grado in uscita e in entrata di un nodo: per il tooltip e le etichette,
/// fuori dal loop caldo.
export function degreeOf(s: Structure, i: number): { out: number; in: number } {
  let out = 0;
  let incoming = 0;
  for (let e = 0; e < s.m; e++) {
    if (s.from[e] === i) out++;
    if (s.to[e] === i) incoming++;
  }
  return { out, in: incoming };
}
