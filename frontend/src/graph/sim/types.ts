// I tipi condivisi del grafo 2.0: il contratto fra motore fisico, disegno e
// configurazione. Vive in `sim/` perché è la simulazione a dare la forma ai
// numeri, ma non importa DOM e non importa il motore: è il file che
// `render/*`, `interaction.ts`, `config.ts` e `chart.ts` guardano per
// sapere com'è fatto un grafo. Chi lo cambia cambia tutti: per questo è
// ghiacciato durante lo sviluppo in parallelo (vedi `graph.md` §9).
//
// La scelta strutturale è l'SoA: niente array di oggetti `SimNode`, ma
// `Float32Array` fratelli. Nel loop caldo — che gira anche duemila volte per
// frame — un oggetto per nodo è una cacce al puntatore per campo e una
// pressione sul GC a ogni respiro; qui ogni campo è un passaggio lineare su
// memoria contigua, e i buffer `fx/fy` delle forze si riusano senza mai
// allocare dentro il frame.

/// Ciò che arriva nel `payload` del nodo custom `fub:graph`. La forma la
/// decide `fub_features::graph` e non cambia (contratto §0 di `graph.md`):
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
  /// Archi per indice + curvatura stabile per arco (§5.3 di `graph.md`):
  /// due archi a↔b si separano in due curve speculari invece di giacersi
  /// sopra.
  from: Uint32Array;
  to: Uint32Array;
  curvature: Float32Array;
  n: number;
  m: number;
}

/// Livelli di qualità: la taglia del grafo cambia quanto costa un frame, non
/// quanta fisica fa (§3.4 di `graph.md`).
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
  /// Richiamo verso il centro (0,0), per unità di massa.
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
  /// Entità del jitter iniziale della semina, in frazione di `baseLength`.
  jitter: number;
  /// Decadimento dell'alpha per passo (0.985 ≈ si assesta in ~3 s).
  cooling: number;
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
export function organicConfig(): PhysicsConfig {
  return {
    repulsion: 2400,
    baseLength: 120,
    springStiffness: 0.12,
    springDamping: 0.55,
    gravity: 0.02,
    friction: 0.86,
    maxSpeed: 900,
    degreeWeight: 0.8,
    collisions: true,
    theta: 0.9,
    jitter: 0.35,
    cooling: 0.985,
  };
}

export function defaultGraphicsConfig(): GraphicsConfig {
  return {
    glow: true,
    pulse: true,
    trail: true,
    grid: true,
    edgeCurvature: 1,
    labelDensity: 0.5,
  };
}

/// I preset: personalità fisiche, non solo numeri. Il nome è la chiave i18n
/// `graph.preset.<name>` e il pannello li elenca nell'ordine qui sotto.
export const PRESETS: Record<string, () => PhysicsConfig> = {
  "organica": organicConfig,
  "costellazione": () => ({
    ...organicConfig(),
    repulsion: 6000,
    springStiffness: 0.04,
    gravity: 0.005,
    friction: 0.9,
  }),
  "alveare": () => ({ ...organicConfig(), gravity: 0.08, collisions: true, friction: 0.8 }),
  "nebulosa": () => ({ ...organicConfig(), friction: 0.96, springStiffness: 0.06, jitter: 0.8 }),
  "rigido": () => ({
    ...organicConfig(),
    springStiffness: 0.35,
    springDamping: 0.85,
    friction: 0.7,
    maxSpeed: 400,
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
  const n = data.nodes.length;
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
    id: [],
    from: new Uint32Array(data.edges.length),
    to: new Uint32Array(data.edges.length),
    curvature: new Float32Array(data.edges.length),
    n: 0,
    m: 0,
  };
  const indice = new Map<string, number>();
  for (const id of data.nodes) {
    if (indice.has(id)) continue;
    indice.set(id, s.n);
    s.id.push(id);
    s.n++;
  }
  const rng = mulberry32(seed);
  // Semina a girasole (fibonacci sunflower): distribuzione uniforme sul
  // disco, niente anelli concentrici, e col jitter deterministico nessun
  // nodo parte esattamente sopra un altro.
  const step = config.baseLength * 0.9;
  const angoloOro = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < s.n; i++) {
    const r = step * Math.sqrt(i + rng() * config.jitter);
    const t = i * angoloOro;
    s.x[i] = r * Math.cos(t);
    s.y[i] = r * Math.sin(t);
  }
  for (const e of data.edges) {
    const da = indice.get(e.from);
    const a = indice.get(e.to);
    if (da === undefined || a === undefined || da === a) continue;
    s.from[s.m] = da;
    s.to[s.m] = a;
    s.degree[da]++;
    s.degree[a]++;
    // Curvatura stabile per coppia: hash dell'identità, non della posizione
    // — sopravvive al movimento e separa gli archi bidirezionali.
    s.curvature[s.m] = (((fnv1a(e.from + "|" + e.to) % 1000) / 1000 - 0.5) * 0.44) * 1;
    s.m++;
  }
  for (let i = 0; i < s.n; i++) {
    s.mass[i] = 1 + Math.log1p(s.degree[i]) * config.degreeWeight;
    s.radius[i] = 4 + Math.min(9, Math.sqrt(s.degree[i]) * 1.7);
  }
  return s;
}

/// Il seme di un vault: hash degli id ordinati. Due aperture dello stesso
/// grafo partono identiche; un documento nuovo cambia il disegno, ed è
/// giusto che lo cambi.
export function seedOf(data: GraphData): number {
  return fnv1a([...data.nodes].sort().join("\n"));
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
