// Lo sprite atlas dei nodi: la sfera col gradiente radiale e il suo alone
// vengono cotti una volta su un canvas offscreen, per ogni (colore × bucket di
// raggio), e a runtime il disegno è un `drawImage` — il 90% del costo di
// `shadowBlur` a ogni frame sparisce (era il collo di bottiglia del codice di
// prima con 2000 nodi).
//
// Il modulo vive in due strati: le funzioni pure (`bucketDiRaggio`,
// `chiaveAtlas`) che i test esercitano senza Canvas2D, e quelle che disegnano,
// che in happy-dom degradano a no-op sicure — `getContext("2d")` lì è `null`,
// e un canvas senza contesto non deve mai far cadere il grafo.
//
// Il glow fa parte dello sprite per scelta: un nodo è un disco core + alone
// sfumato; disegnarne due di pezzi per nodo (disco e alone vivi) raddoppia le
// draw call. Cotti una volta, sono una sola draw call — e l'«alone pulsante»
// dei nodi aperti si ottiene ridisegnando lo stesso sprite con alpha modulato.

export interface Tinte {
  nodo: string;
  attivo: string;
  hover: string;
  testo: string;
  sfondo: string;
  /// Chiave di confronto: se due letture danno la stessa `fonte`, i colori
  /// sono gli stessi e l'atlas non va rigenerato.
  fonte: string;
}

export interface BucketRaggio {
  min: number;
  max: number;
}

/// I raggi dei nodi vanno da 4 a 13 (4 + min(9, √grado·1.7)): tre bucket
/// bastano a non disegnare ogni nodo con uno sprite su misura.
export const BUCKET_RAGGI: BucketRaggio[] = [
  { min: 0, max: 6 },
  { min: 6, max: 9 },
  { min: 9, max: 14 },
];

/// Quanto il glow si spinge oltre il core, in frazione del raggio del bucket.
const GLOW = 1.8;

/// I ruoli di colore, nell'ordine delle righe dell'atlas.
const TINTE_ATLAS: ReadonlyArray<keyof Tinte> = ["nodo", "attivo", "hover"];

export interface Atlas {
  canvas: HTMLCanvasElement | null;
  bucket: BucketRaggio[];
  fonte: string;
  /// Raggio del core del bucket più largo (serve alla cache delle dimensioni).
  cella: number;
  celle: number;
  righe: number;
}

/// La riga dell'atlas per un ruolo di colore. I nomi sono quelli di `Tinte`
/// (la tavolozza della shell), non i ruoli di disegno, per non duplicare la
/// mappa colore→ruolo in due punti.
export type RuoloTinta = "nodo" | "attivo" | "hover";

/// Indice del bucket che copre `r`: il primo con `r <= max`. Pura e testata:
/// è la scelta che decide quale sprite finisce sullo schermo.
export function bucketDiRaggio(bucket: BucketRaggio[], r: number): number {
  for (let i = 0; i < bucket.length; i++) {
    if (r <= bucket[i].max) return i;
  }
  return bucket.length - 1;
}

/// Chiave di rigenerazione: colori + geometria in una stringa. Se uguale a
/// quella dell'atlas corrente, il pittore non rifà il lavoro.
export function chiaveAtlas(t: Tinte, bucket: BucketRaggio[]): string {
  let k = t.fonte;
  for (const b of bucket) k += "|" + b.min + "-" + b.max;
  return k;
}

/// Legge i token dal computed style dell'host, seguendo il pattern di
/// `panels/graph.ts` (tinta(...) || ink): i token sono il contratto col tema,
/// non tre esadecimali scritti qui. I fallback esistono per i test e per un
/// host senza stili — mai un lancio.
export function leggiTinte(host: HTMLElement): Tinte {
  const stile = getComputedStyle(host);
  const ink = stile.color || "#e6e6ea";
  const bg = stile.getPropertyValue("--bg").trim() || "#000000";
  const val = (nome: string, ripiego: string): string => stile.getPropertyValue(nome).trim() || ink || ripiego;
  const nodo = val("--graph-node", ink);
  const attivo = val("--graph-node-active", ink);
  const hover = val("--graph-node-hover", ink);
  const testo = val("--text", ink);
  return {
    nodo,
    attivo,
    hover,
    testo,
    sfondo: bg,
    fonte: [nodo, attivo, hover, testo, bg].join("|"),
  };
}

/// `#rgb` / `#rrggbb` → [r,g,b] oppure null (un token che non è un esadecimale
/// — es. un `rgb(...)` — non deve rompere l'atlas: il disegno degrada a disco
/// pieno). Usato per le sfumature del gradiente, che vogliono canali separati.
export function esadecimaleRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  if (s[0] !== "#") return null;
  const corto = s.length === 4;
  const hex = corto ? s.slice(1).split("").map((h) => h + h).join("") : s.slice(1);
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function rgbt(c: string, a: number): string {
  const rgb = esadecimaleRgb(c);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : c;
}

/// Cuoce l'atlas: `righe` (colori) × `bucket.length` (colonne) sprite. Ogni
/// sprite è un gradiente radiale core→trasparente più l'alone già sfumato, su
/// un canvas delle dimensioni esatte della cella più larga (le celle più
/// piccole restano vuote ma allineate — `drawImage` con source rect le
/// ritaglia). In happy-dom `getContext` è null: si ritorna un atlas senza
/// canvas, che `disegnaNodo` ignora.
export function generaAtlas(t: Tinte, bucket: BucketRaggio[]): Atlas {
  const maxR = bucket.length ? bucket[bucket.length - 1].max : 6;
  const cella = Math.ceil(2 * maxR * GLOW);
  const celle = bucket.length;
  const righe = TINTE_ATLAS.length;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas: null, bucket, fonte: chiaveAtlas(t, bucket), cella, celle, righe };
  }
  canvas.width = celle * cella;
  canvas.height = righe * cella;
  for (let riga = 0; riga < righe; riga++) {
    const colore = t[TINTE_ATLAS[riga]];
    for (let col = 0; col < celle; col++) {
      const coreR = bucket[col].max;
      const centroX = col * cella + cella / 2;
      const centroY = riga * cella + cella / 2;
      // Sfera: core pieno fino a metà raggio, poi sfumatura verso il bordo
      // trasparente. Un gradiente che parte già trasparente lascerebbe
      // intravedere lo sfondo dentro il nodo.
      const g = ctx.createRadialGradient(centroX, centroY, 0, centroX, centroY, coreR);
      g.addColorStop(0, rgbt(colore, 1));
      g.addColorStop(0.55, rgbt(colore, 1));
      g.addColorStop(1, rgbt(colore, 0));
      ctx.fillStyle = g;
      ctx.fillRect(centroX - coreR, centroY - coreR, coreR * 2, coreR * 2);
      // Alone esterno: un secondo gradiente che parte semitrasparente dal
      // bordo del core e muore al raggio del glow. Cotto qui, a runtime è
      // gratis.
      const halo = ctx.createRadialGradient(centroX, centroY, coreR, centroX, centroY, coreR * GLOW);
      halo.addColorStop(0, rgbt(colore, 0.32));
      halo.addColorStop(1, rgbt(colore, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(centroX - coreR * GLOW, centroY - coreR * GLOW, coreR * GLOW * 2, coreR * GLOW * 2);
    }
  }
  return { canvas, bucket, fonte: chiaveAtlas(t, bucket), cella, celle, righe };
}

/// Un `drawImage` scalato: prende lo sprite del (bucket, ruolo) e lo disegna
/// centrato su (x,y) con il raggio core esatto. `alone` (0..1) aggiunge un
/// secondo passaggio a scala 1.35 con alpha modulato: è l'effetto «nodo
/// acceso» e costa una draw call in più solo sui pochi nodi aperti.
export function disegnaNodo(ctx: CanvasRenderingContext2D | null, a: Atlas, x: number, y: number, raggio: number, ruolo: RuoloTinta, alone?: number): void {
  const c = a.canvas;
  if (!ctx || !c) return;
  const riga = TINTE_ATLAS.indexOf(ruolo);
  if (riga < 0) return;
  const col = bucketDiRaggio(a.bucket, raggio);
  const sx = col * a.cella;
  const sy = riga * a.cella;
  const taglia = 2 * raggio * GLOW;
  ctx.drawImage(c, sx, sy, a.cella, a.cella, x - taglia / 2, y - taglia / 2, taglia, taglia);
  if (alone !== undefined) {
    const tagliaAlone = taglia * 1.35;
    ctx.globalAlpha = Math.max(0, Math.min(1, alone));
    ctx.drawImage(c, sx, sy, a.cella, a.cella, x - tagliaAlone / 2, y - tagliaAlone / 2, tagliaAlone, tagliaAlone);
    ctx.globalAlpha = 1;
  }
}
