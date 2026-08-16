// I tipi condivisi del grafo 2.0: il contratto fra motore fisico, disegno e
// configurazione. Vive in `sim/` perché è la simulazione a dare la forma ai
// numeri, ma non importa DOM e non importa il motore: è il file che
// `render/*`, `interazione.ts`, `config.ts` e `grafico.ts` guardano per
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
export interface DatiGrafo {
  nodes: string[];
  edges: { from: string; to: string }[];
}

/// La struttura del grafo in forma SoA. Indici ovunque: un arco è una coppia
/// di interi, un drag è l'indice del nodo trascinato.
export interface Struttura {
  /// Posizione e velocità in coordinate **mondo** (px di mondo, non di
  /// schermo: la scala sta nella camera, non qui).
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /// Accelerazioni accumulate nel passo corrente (per unità di massa — le
  /// molle dividono per la massa del nodo, il resto no): buffer di lavoro
  /// riusato, si azzera all'inizio di ogni `passo`.
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
  massa: Float32Array;
  raggio: Float32Array;
  grado: Uint16Array;
  /// 0 libero · 1 bloccato (pin, doppio click) · 2 trascinato.
  fisso: Uint8Array;
  /// Indice del nodo trascinato, −1 se nessuno. La molla del puntatore in
  /// `forze.ts` guarda solo questo.
  trascinato: number;
  /// Identità: l'unico pezzo non numerico, letto fuori dal loop caldo.
  id: string[];
  /// Archi per indice + curvatura stabile per arco (§5.3 di `graph.md`):
  /// due archi a↔b si separano in due curve speculari invece di giacersi
  /// sopra.
  da: Uint32Array;
  a: Uint32Array;
  curva: Float32Array;
  n: number;
  m: number;
}

/// Livelli di qualità: la taglia del grafo cambia quanto costa un frame, non
/// quanta fisica fa (§3.4 di `graph.md`).
export type Tier = 1 | 2 | 3;

export interface ConfFisica {
  /// Costante di repulsione fra coppie (accelerazione ∝ repulsione·mj/d²).
  repulsione: number;
  /// Distanza di riposo base delle molle, in px di mondo.
  lunghezzaBase: number;
  /// Rigidità delle molle.
  rigiditaMolla: number;
  /// Quota dello smorzamento criticamente smorzato lungo l'arco: 1 = il
  /// sistema non oscilla mai, 0 = molle vive.
  smorzamentoMolla: number;
  /// Richiamo verso il centro (0,0), per unità di massa.
  gravita: number;
  /// Ritenzione di velocità per passo (dt = 1/60 fisso).
  attrito: number;
  /// Tetto di velocità in px di mondo al secondo.
  maxVelocita: number;
  /// Quanto pesa il grado nella massa.
  pesoGrado: number;
  /// Correzioni posizionali di collisione attive.
  collisioni: boolean;
  /// Apertura di Barnes-Hut (solo tier ≥ 2).
  theta: number;
  /// Entità del jitter iniziale della semina, in frazione di `lunghezzaBase`.
  jitter: number;
  /// Decadimento dell'alpha per passo (0.985 ≈ si assesta in ~3 s).
  raffreddamento: number;
}

export interface ConfGrafica {
  glow: boolean;
  pulse: boolean;
  trail: boolean;
  griglia: boolean;
  /// Moltiplicatore 0..1 sulla curvatura stabile degli archi.
  curvaturaArchi: number;
  /// 0..1 — quanto sono dense le etichette.
  densitaEtichette: number;
}

export interface ConfGrafo {
  fisica: ConfFisica;
  grafica: ConfGrafica;
  /// Nome del preset attivo, `"custom"` appena si tocca uno slider.
  preset: string;
}

/// La configurazione predefinita: il preset «organico». Ogni numero qui è un
/// punto di partenza provato per la sensazione giusta su un vault medio, e
/// ogni campo ha un range in `clampConf`: il pannello manda valori umani, il
/// motore riceve valori già validi.
export function confOrganica(): ConfFisica {
  return {
    repulsione: 2400,
    lunghezzaBase: 120,
    rigiditaMolla: 0.12,
    smorzamentoMolla: 0.55,
    gravita: 0.02,
    attrito: 0.86,
    maxVelocita: 900,
    pesoGrado: 0.8,
    collisioni: true,
    theta: 0.9,
    jitter: 0.35,
    raffreddamento: 0.985,
  };
}

export function confGraficaPredefinita(): ConfGrafica {
  return {
    glow: true,
    pulse: true,
    trail: true,
    griglia: true,
    curvaturaArchi: 1,
    densitaEtichette: 0.5,
  };
}

/// I preset: personalità fisiche, non solo numeri. Il nome è la chiave i18n
/// `graph.preset.<nome>` e il pannello li elenca nell'ordine qui sotto.
export const PRESETTI: Record<string, () => ConfFisica> = {
  organica: confOrganica,
  costellazione: () => ({
    ...confOrganica(),
    repulsione: 6000,
    rigiditaMolla: 0.04,
    gravita: 0.005,
    attrito: 0.9,
  }),
  alveare: () => ({ ...confOrganica(), gravita: 0.08, collisioni: true, attrito: 0.8 }),
  nebulosa: () => ({ ...confOrganica(), attrito: 0.96, rigiditaMolla: 0.06, jitter: 0.8 }),
  rigido: () => ({
    ...confOrganica(),
    rigiditaMolla: 0.35,
    smorzamentoMolla: 0.85,
    attrito: 0.7,
    maxVelocita: 400,
  }),
};

/// Validazione: i valori esterni (pannello, localStorage) non sono fidati.
/// Ritorna una copia clampana — mai mutare l'input.
export function clampConfFisica(c: Partial<ConfFisica>): ConfFisica {
  const d = confOrganica();
  const num = (v: unknown, min: number, max: number, def: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    repulsione: num(c.repulsione, 200, 20000, d.repulsione),
    lunghezzaBase: num(c.lunghezzaBase, 40, 400, d.lunghezzaBase),
    rigiditaMolla: num(c.rigiditaMolla, 0.01, 1, d.rigiditaMolla),
    smorzamentoMolla: num(c.smorzamentoMolla, 0, 1, d.smorzamentoMolla),
    gravita: num(c.gravita, 0, 0.2, d.gravita),
    attrito: num(c.attrito, 0.5, 0.98, d.attrito),
    maxVelocita: num(c.maxVelocita, 100, 4000, d.maxVelocita),
    pesoGrado: num(c.pesoGrado, 0, 3, d.pesoGrado),
    collisioni: typeof c.collisioni === "boolean" ? c.collisioni : d.collisioni,
    theta: num(c.theta, 0.5, 1.2, d.theta),
    jitter: num(c.jitter, 0, 1, d.jitter),
    raffreddamento: num(c.raffreddamento, 0.9, 0.999, d.raffreddamento),
  };
}

export function clampConfGrafica(c: Partial<ConfGrafica>): ConfGrafica {
  const d = confGraficaPredefinita();
  const num = (v: unknown, min: number, max: number, def: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    glow: typeof c.glow === "boolean" ? c.glow : d.glow,
    pulse: typeof c.pulse === "boolean" ? c.pulse : d.pulse,
    trail: typeof c.trail === "boolean" ? c.trail : d.trail,
    griglia: typeof c.griglia === "boolean" ? c.griglia : d.griglia,
    curvaturaArchi: num(c.curvaturaArchi, 0, 1, d.curvaturaArchi),
    densitaEtichette: num(c.densitaEtichette, 0, 1, d.densitaEtichette),
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
export function mulberry32(seme: number): () => number {
  let a = seme >>> 0;
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
export function creaStruttura(dati: DatiGrafo, conf: ConfFisica, seme: number): Struttura {
  const n = dati.nodes.length;
  const s: Struttura = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    fx: new Float32Array(n),
    fy: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    massa: new Float32Array(n),
    raggio: new Float32Array(n),
    grado: new Uint16Array(n),
    fisso: new Uint8Array(n),
    trascinato: -1,
    id: [],
    da: new Uint32Array(dati.edges.length),
    a: new Uint32Array(dati.edges.length),
    curva: new Float32Array(dati.edges.length),
    n: 0,
    m: 0,
  };
  const indice = new Map<string, number>();
  for (const id of dati.nodes) {
    if (indice.has(id)) continue;
    indice.set(id, s.n);
    s.id.push(id);
    s.n++;
  }
  const rng = mulberry32(seme);
  // Semina a girasole (fibonacci sunflower): distribuzione uniforme sul
  // disco, niente anelli concentrici, e col jitter deterministico nessun
  // nodo parte esattamente sopra un altro.
  const passo = conf.lunghezzaBase * 0.9;
  const angoloOro = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < s.n; i++) {
    const r = passo * Math.sqrt(i + rng() * conf.jitter);
    const t = i * angoloOro;
    s.x[i] = r * Math.cos(t);
    s.y[i] = r * Math.sin(t);
  }
  for (const e of dati.edges) {
    const da = indice.get(e.from);
    const a = indice.get(e.to);
    if (da === undefined || a === undefined || da === a) continue;
    s.da[s.m] = da;
    s.a[s.m] = a;
    s.grado[da]++;
    s.grado[a]++;
    // Curvatura stabile per coppia: hash dell'identità, non della posizione
    // — sopravvive al movimento e separa gli archi bidirezionali.
    s.curva[s.m] = (((fnv1a(e.from + "|" + e.to) % 1000) / 1000 - 0.5) * 0.44) * 1;
    s.m++;
  }
  for (let i = 0; i < s.n; i++) {
    s.massa[i] = 1 + Math.log1p(s.grado[i]) * conf.pesoGrado;
    s.raggio[i] = 4 + Math.min(9, Math.sqrt(s.grado[i]) * 1.7);
  }
  return s;
}

/// Il seme di un vault: hash degli id ordinati. Due aperture dello stesso
/// grafo partono identiche; un documento nuovo cambia il disegno, ed è
/// giusto che lo cambi.
export function semeDi(dati: DatiGrafo): number {
  return fnv1a([...dati.nodes].sort().join("\n"));
}

/// Grado in uscita e in entrata di un nodo: per il tooltip e le etichette,
/// fuori dal loop caldo.
export function gradoDi(s: Struttura, i: number): { usc: number; entr: number } {
  let usc = 0;
  let entr = 0;
  for (let e = 0; e < s.m; e++) {
    if (s.da[e] === i) usc++;
    if (s.a[e] === i) entr++;
  }
  return { usc, entr };
}
