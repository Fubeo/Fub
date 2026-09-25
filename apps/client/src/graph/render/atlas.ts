// Lo sprite atlas dei nodi: la sfera col gradiente radiale e il suo alone
// vengono cotti una volta su un canvas offscreen, per ogni (colore × livello di
// risoluzione), e a runtime il disegno è un `drawImage` — il 90% del costo di
// `shadowBlur` a ogni frame sparisce (era il collo di bottiglia del codice di
// prima con 2000 nodi).
//
// I livelli sono **mipmap**: il raggio del core di ogni sprite è in pixel del
// dispositivo, e il nodo prende il più piccolo livello che copre il raggio che
// ha davvero sullo schermo (raggio di mondo × scala della camera × dpr). Così
// uno sprite non si ingrandisce mai (sfocato) e si rimpicciolisce al più di
// metà. Un nodo più grande dell'ultimo livello — pochi, a zoom alto — si
// disegna vettoriale, con lo stesso gradiente.
//
// Il modulo vive in due strati: le funzioni pure (`radiusBucket`,
// `atlasKey`) che i test esercitano senza Canvas2D, e quelle che disegnano,
// che in happy-dom degradano a no-op sicure — `getContext("2d")` lì è `null`,
// e un canvas senza contesto non deve mai far cadere il grafo.
//
// Il glow fa parte dello sprite per scelta: un nodo è un disco core + alone
// sfumato; disegnarne due di pezzi per nodo (disco e alone vivi) raddoppia le
// draw call. Cotti una volta, sono una sola draw call — e l'«alone pulsante»
// dei nodi aperti si ottiene ridisegnando lo stesso sprite con alpha modulato.

export interface Tints {
  node: string;
  active: string;
  hover: string;
  text: string;
  background: string;
  /// I colori dei gruppi (cartella o tag), dai token di sintassi del tema: la
  /// stessa tavolozza distinguibile che il tema cura per il codice.
  groups: string[];
  /// Chiave di confronto: se due letture danno la stessa `source`, i colori
  /// sono gli stessi e l'atlas non va rigenerato.
  source: string;
}

export interface RadiusBucket {
  min: number;
  max: number;
}

/// I livelli di risoluzione degli sprite: raggio del core in pixel **del
/// dispositivo**. Ogni livello copre i raggi fino al suo `max`; sopra
/// l'ultimo il nodo si disegna vettoriale.
export const RADIUS_BUCKETS: RadiusBucket[] = [
  { min: 0, max: 6 },
  { min: 6, max: 12 },
  { min: 12, max: 24 },
  { min: 24, max: 48 },
];

/// Quanto il glow si spinge oltre il core, in frazione del raggio del bucket.
const GLOW = 1.8;

/// Il lato dello sprite di un livello, in pixel dell'atlas: core + alone più
/// un pixel di margine per parte, pari così il centro cade su un pixel intero.
function spriteSide(coreR: number): number {
  return 2 * Math.ceil(coreR * GLOW) + 2;
}

/// I ruoli di colore, nell'ordine delle righe dell'atlas.
const ATLAS_TINT_KEYS: ReadonlyArray<"node" | "active" | "hover"> = ["node", "active", "hover"];

export interface Atlas {
  canvas: HTMLCanvasElement | null;
  bucket: RadiusBucket[];
  source: string;
  /// Il lato di una cella: lo sprite del livello più grande. Gli sprite dei
  /// livelli minori stanno al centro della loro cella.
  cell: number;
  cells: number;
  rows: number;
  /// I colori dei ruoli, per i nodi che si disegnano vettoriali.
  colors?: Record<TintRole, string>;
}

/// La riga dell'atlas per un ruolo di colore. I nomi sono quelli di `Tints`
/// (la tavolozza della shell), non i ruoli di disegno, per non duplicare la
/// mappa colore→ruolo in due punti.
export type TintRole = "node" | "active" | "hover";

/// Indice del bucket che copre `r`: il primo con `r <= max`. Pura e testata:
/// è la scelta che decide quale sprite finisce sullo schermo.
export function radiusBucket(bucket: RadiusBucket[], r: number): number {
  for (let i = 0; i < bucket.length; i++) {
    if (r <= bucket[i].max) return i;
  }
  return bucket.length - 1;
}

/// Chiave di rigenerazione: colori + geometria in una stringa. Se uguale a
/// quella dell'atlas corrente, il pittore non rifà il lavoro.
export function atlasKey(t: Tints, bucket: RadiusBucket[]): string {
  let k = t.source;
  for (const b of bucket) k += "|" + b.min + "-" + b.max;
  return k;
}

/// I token da cui si prendono i colori dei gruppi, nell'ordine in cui si
/// assegnano (il gruppo più numeroso prende il primo).
export const GROUP_TOKENS = [
  "--syn-keyword", "--syn-string", "--syn-function", "--syn-type",
  "--syn-literal", "--syn-operator", "--syn-heading", "--syn-name",
];

/// Legge i token dal computed style dell'host, seguendo il pattern di
/// `panels/graph.ts` (tinta(...) || ink): i token sono il contratto col tema,
/// non tre esadecimali scritti qui. I fallback esistono per i test e per un
/// host senza stili — mai un lancio.
export function readTints(host: HTMLElement): Tints {
  const style = getComputedStyle(host);
  const ink = style.color || "#e6e6ea";
  const bg = style.getPropertyValue("--bg").trim() || "#000000";
  const val = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || ink || fallback;
  const node = val("--graph-node", ink);
  const active = val("--graph-node-active", ink);
  const hover = val("--graph-node-hover", ink);
  const text = val("--text", ink);
  const groups = GROUP_TOKENS.map((name) => style.getPropertyValue(name).trim()).filter((value) => value !== "");
  return {
    node,
    active,
    hover,
    text,
    background: bg,
    groups,
    source: [node, active, hover, text, bg, ...groups].join("|"),
  };
}

/// `#rgb` / `#rrggbb` → [r,g,b] oppure null (un token che non è un esadecimale
/// — es. un `rgb(...)` — non deve rompere l'atlas: il disegno degrada a disco
/// pieno). Usato per le sfumature del gradiente, che vogliono canali separati.
export function hexRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  if (s[0] !== "#") return null;
  const short = s.length === 4;
  const hex = short ? s.slice(1).split("").map((h) => h + h).join("") : s.slice(1);
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/// Un colore CSS qualunque → [r,g,b]. L'esadecimale si legge a mano; il resto
/// (`rgb()`, `oklch()`, un nome) lo risolve il browser dipingendolo su un
/// pixel. Senza canvas (happy-dom) un colore non esadecimale resta `null`.
let probe: CanvasRenderingContext2D | null | undefined;
export function colorRgb(c: string): [number, number, number] | null {
  const hex = hexRgb(c);
  if (hex) return hex;
  if (probe === undefined) {
    probe = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
  }
  if (!probe || !c.trim()) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = c;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return d[3] > 0 ? [d[0], d[1], d[2]] : null;
}

function rgbt(c: string, alpha: number): string {
  const rgb = colorRgb(c);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : c;
}

/// La sfera di un nodo: core pieno fino a metà raggio, poi sfumatura verso il
/// bordo trasparente, e l'alone che parte semitrasparente dal bordo del core e
/// muore al raggio del glow. È la stessa per lo sprite cotto e per il nodo
/// vettoriale. Un gradiente che parte già trasparente lascerebbe intravedere
/// lo sfondo dentro il nodo.
function paintSphere(ctx: CanvasRenderingContext2D, x: number, y: number, coreR: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, coreR);
  g.addColorStop(0, rgbt(color, 1));
  g.addColorStop(0.55, rgbt(color, 1));
  g.addColorStop(1, rgbt(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - coreR, y - coreR, coreR * 2, coreR * 2);
  const halo = ctx.createRadialGradient(x, y, coreR, x, y, coreR * GLOW);
  halo.addColorStop(0, rgbt(color, 0.32));
  halo.addColorStop(1, rgbt(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - coreR * GLOW, y - coreR * GLOW, coreR * GLOW * 2, coreR * GLOW * 2);
}

/// Cuoce l'atlas: `rows` (colori) × `bucket.length` (colonne) sprite, in
/// celle quadrate grandi quanto lo sprite del livello più grande; gli sprite
/// minori stanno al centro della loro, e `drawNode` ne ritaglia solo il lato.
/// In happy-dom `getContext` è null: si ritorna un atlas senza canvas, che
/// `drawNode` ignora.
export function generateAtlas(t: Tints, bucket: RadiusBucket[]): Atlas {
  const maxR = bucket.length ? bucket[bucket.length - 1].max : 6;
  const cell = spriteSide(maxR);
  const cells = bucket.length;
  const rows = ATLAS_TINT_KEYS.length;
  const colors = { node: t.node, active: t.active, hover: t.hover };
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas: null, bucket, source: atlasKey(t, bucket), cell, cells, rows, colors };
  }
  canvas.width = cells * cell;
  canvas.height = rows * cell;
  for (let row = 0; row < rows; row++) {
    const color = t[ATLAS_TINT_KEYS[row]];
    for (let col = 0; col < cells; col++) {
      paintSphere(ctx, col * cell + cell / 2, row * cell + cell / 2, bucket[col].max, color);
    }
  }
  return { canvas, bucket, source: atlasKey(t, bucket), cell, cells, rows, colors };
}

/// Disegna un nodo di raggio `radius` (px CSS sullo schermo) centrato su
/// (x,y). `dpr` sceglie il livello: il raggio in pixel del dispositivo. Lo
/// sprite si prende dal suo ritaglio esatto — non dalla cella intera, che per
/// i livelli minori è quasi tutta vuota e rimpiccioliva il nodo. `alone`
/// (0..1) aggiunge un secondo passaggio a scala 1.35 con alpha modulato: è
/// l'effetto «nodo acceso» e costa una draw call in più solo sui pochi nodi
/// aperti. L'alpha globale del chiamante (la filigrana del focus) si
/// rispetta e si ripristina.
export function drawNode(ctx: CanvasRenderingContext2D | null, atlas: Atlas, x: number, y: number, radius: number, role: TintRole, alone?: number, dpr = 1): void {
  const c = atlas.canvas;
  if (!ctx || !c) return;
  const row = ATLAS_TINT_KEYS.indexOf(role);
  if (row < 0) return;
  const deviceR = radius * dpr;
  const col = radiusBucket(atlas.bucket, deviceR);
  if (col < 0) return;
  const base = ctx.globalAlpha;
  const coreR = atlas.bucket[col].max;
  if (deviceR > coreR && atlas.colors) {
    // Più grande dell'ultimo livello: vettoriale, per non ingrandire uno
    // sprite. Succede solo a zoom alto, cioè con pochi nodi sullo schermo.
    paintSphere(ctx, x, y, radius, atlas.colors[role]);
    if (alone !== undefined) {
      ctx.globalAlpha = base * Math.max(0, Math.min(1, alone));
      paintSphere(ctx, x, y, radius * 1.35, atlas.colors[role]);
      ctx.globalAlpha = base;
    }
    return;
  }
  const side = spriteSide(coreR);
  const offset = (atlas.cell - side) / 2;
  const sx = col * atlas.cell + offset;
  const sy = row * atlas.cell + offset;
  const size = (side * radius) / coreR;
  ctx.drawImage(c, sx, sy, side, side, x - size / 2, y - size / 2, size, size);
  if (alone !== undefined) {
    const haloSize = size * 1.35;
    ctx.globalAlpha = base * Math.max(0, Math.min(1, alone));
    ctx.drawImage(c, sx, sy, side, side, x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
    ctx.globalAlpha = base;
  }
}
