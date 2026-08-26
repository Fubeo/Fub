// Lo sprite atlas dei nodi: la sfera col gradiente radiale e il suo alone
// vengono cotti una volta su un canvas offscreen, per ogni (colore × bucket di
// raggio), e a runtime il disegno è un `drawImage` — il 90% del costo di
// `shadowBlur` a ogni frame sparisce (era il collo di bottiglia del codice di
// prima con 2000 nodi).
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
  /// Chiave di confronto: se due letture danno la stessa `source`, i colori
  /// sono gli stessi e l'atlas non va rigenerato.
  source: string;
}

export interface RadiusBucket {
  min: number;
  max: number;
}

/// I raggi dei nodi vanno da 4 a 13 (4 + min(9, √grado·1.7)): tre bucket
/// bastano a non disegnare ogni nodo con uno sprite su misura.
export const RADIUS_BUCKETS: RadiusBucket[] = [
  { min: 0, max: 6 },
  { min: 6, max: 9 },
  { min: 9, max: 14 },
];

/// Quanto il glow si spinge oltre il core, in frazione del raggio del bucket.
const GLOW = 1.8;

/// I ruoli di colore, nell'ordine delle righe dell'atlas.
const ATLAS_TINT_KEYS: ReadonlyArray<keyof Tints> = ["node", "active", "hover"];

export interface Atlas {
  canvas: HTMLCanvasElement | null;
  bucket: RadiusBucket[];
  source: string;
  /// Raggio del core del bucket più largo (serve alla cache delle dimensioni).
  cell: number;
  cells: number;
  rows: number;
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
  return {
    node,
    active,
    hover,
    text,
    background: bg,
    source: [node, active, hover, text, bg].join("|"),
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

function rgbt(c: string, alpha: number): string {
  const rgb = hexRgb(c);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : c;
}

/// Cuoce l'atlas: `rows` (colori) × `bucket.length` (colonne) sprite. Ogni
/// sprite è un gradiente radiale core→trasparente più l'alone già sfumato, su
/// un canvas delle dimensioni esatte della cella più larga (le celle più
/// piccole restano vuote ma allineate — `drawImage` con source rect le
/// ritaglia). In happy-dom `getContext` è null: si ritorna un atlas senza
/// canvas, che `drawNode` ignora.
export function generateAtlas(t: Tints, bucket: RadiusBucket[]): Atlas {
  const maxR = bucket.length ? bucket[bucket.length - 1].max : 6;
  const cell = Math.ceil(2 * maxR * GLOW);
  const cells = bucket.length;
  const rows = ATLAS_TINT_KEYS.length;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas: null, bucket, source: atlasKey(t, bucket), cell, cells, rows };
  }
  canvas.width = cells * cell;
  canvas.height = rows * cell;
  for (let row = 0; row < rows; row++) {
    const color = t[ATLAS_TINT_KEYS[row]];
    for (let col = 0; col < cells; col++) {
      const coreR = bucket[col].max;
      const centerX = col * cell + cell / 2;
      const centerY = row * cell + cell / 2;
      // Sfera: core pieno fino a metà raggio, poi sfumatura verso il bordo
      // trasparente. Un gradiente che parte già trasparente lascerebbe
      // intravedere lo sfondo dentro il nodo.
      const g = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreR);
      g.addColorStop(0, rgbt(color, 1));
      g.addColorStop(0.55, rgbt(color, 1));
      g.addColorStop(1, rgbt(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(centerX - coreR, centerY - coreR, coreR * 2, coreR * 2);
      // Alone esterno: un secondo gradiente che parte semitrasparente dal
      // bordo del core e muore al raggio del glow. Cotto qui, a runtime è
      // gratis.
      const halo = ctx.createRadialGradient(centerX, centerY, coreR, centerX, centerY, coreR * GLOW);
      halo.addColorStop(0, rgbt(color, 0.32));
      halo.addColorStop(1, rgbt(color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(centerX - coreR * GLOW, centerY - coreR * GLOW, coreR * GLOW * 2, coreR * GLOW * 2);
    }
  }
  return { canvas, bucket, source: atlasKey(t, bucket), cell, cells, rows };
}

/// Un `drawImage` scalato: prende lo sprite del (bucket, ruolo) e lo disegna
/// centrato su (x,y) con il raggio core esatto. `alone` (0..1) aggiunge un
/// secondo passaggio a scala 1.35 con alpha modulato: è l'effetto «nodo
/// acceso» e costa una draw call in più solo sui pochi nodi aperti.
export function drawNode(ctx: CanvasRenderingContext2D | null, atlas: Atlas, x: number, y: number, radius: number, role: TintRole, alone?: number): void {
  const c = atlas.canvas;
  if (!ctx || !c) return;
  const row = ATLAS_TINT_KEYS.indexOf(role);
  if (row < 0) return;
  const col = radiusBucket(atlas.bucket, radius);
  const sx = col * atlas.cell;
  const sy = row * atlas.cell;
  const size = 2 * radius * GLOW;
  ctx.drawImage(c, sx, sy, atlas.cell, atlas.cell, x - size / 2, y - size / 2, size, size);
  if (alone !== undefined) {
    const haloSize = size * 1.35;
    ctx.globalAlpha = Math.max(0, Math.min(1, alone));
    ctx.drawImage(c, sx, sy, atlas.cell, atlas.cell, x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
    ctx.globalAlpha = 1;
  }
}
