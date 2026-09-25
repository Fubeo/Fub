// Il pittore: l'unico posto che tocca il Canvas2D del grafo. Due canvas
// sovrapposti — sfondo (griglia di puntini) e principale (archi, nodi,
// etichette) — perché la griglia si ridisegna solo su cambio camera/resize/
// tema mentre il principale gira a ogni frame: mischiare i due ritmi in un
// canvas solo avrebbe obbligato a rifare la griglia a ogni frame.
//
// Ogni funzione che riceve un `ctx` lo tratta come nullable: in happy-dom
// `getContext("2d")` è null, e i test del motore devono poter costruire il
// pittore senza che nulla lanci. La logica disegnabile sta nelle funzioni
// pure di `camera.ts`/`atlas.ts`; qui c'è solo l'assemblaggio per frame.
//
// Il tema (bug 2-3): i colori si rileggono a ogni cambio di `data-theme` su
// `documentElement`, via MutationObserver. Prima erano letti una volta al
// mount e un cambio tema a caldo lasciava il grafo nella vecchia luce — qui
// l'osservatore rigenera tinte e atlas e ridisegna subito, senza aspettare
// un rAF che, a grafo quieto, non arriva mai.

import type { GraphicsConfig, Structure, Tier } from "../sim/types";
import { fnv1a } from "../sim/types";
import type { Camera } from "./camera";
import type { Atlas, Tints, TintRole } from "./atlas";
import { generateAtlas, readTints, drawNode, RADIUS_BUCKETS } from "./atlas";

export interface DrawState {
  s: Structure;
  camera: Camera;
  openDocuments: ReadonlySet<string>;
  visible?: ReadonlySet<string>;
  hovered: number;
  dragged: number;
  /// Il nodo selezionato da tastiera (frecce): è «focus» quanto l'hover per
  /// quartiere, anello ed etichette, ma persiste senza puntatore.
  focused: number;
  alpha: number;
  tier: Tier;
  elapsedMs: number;
  /// Quanto è durato il fotogramma (ms): la scia sbiadisce per tempo, non per
  /// fotogramma. Assente, vale un fotogramma a 60 Hz.
  frameMs?: number;
  reducedMotion: boolean;
  /// Il gruppo di ogni nodo (indice nella tavolozza), −1 senza colore.
  groups?: Int16Array | null;
  /// Il quartiere acceso e quanto è acceso (0..1). Il grafico lo anima: il
  /// resto del grafo scende in filigrana in un attimo invece di lampeggiare a
  /// ogni nodo che il puntatore attraversa, e al passaggio da un nodo al
  /// vicino il livello resta pieno. Assenti, valgono il focus corrente e 1.
  highlightNode?: number;
  highlight?: number;
}

/// L'etichetta di un nodo: il nome della nota, senza cartella né estensione.
/// Il percorso intero sta nell'elenco accessibile e nello stato.
export function nodeLabel(id: string): string {
  const base = id.slice(id.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface Painter {
  redraw(state: DrawState): void;
  redrawBackground(): void;
  updateTints(): void;
  resize(w: number, h: number, dpr: number): void;
  destroy(): void;
}

/// Quanto i nodi/archi possono stare fuori dal viewport prima di essere
/// scartati: copre raggio + glow + la gobba delle curve quadratiche.
const CULL_MARGIN = 50;
/// Sopra questa alpha la simulazione gira e il trail ha senso (sotto, un
/// riempimento traslucido lascerebbe un alone fantasma di un grafo fermo).
export const TRAIL_THRESHOLD = 0.02;
/// Quanto del fotogramma precedente si cancella in un frame a 60 Hz. A un
/// altro ritmo la scia perde la stessa parte per secondo: più corta per
/// fotogramma a 144 Hz, più lunga a 30.
const TRAIL_FADE = 0.25;
const TRAIL_FRAME_MS = 1000 / 60;

/// La parte da cancellare in un fotogramma lungo `frameMs`.
export function trailFade(frameMs: number | undefined): number {
  const frames = frameMs === undefined ? 1 : Math.min(Math.max(frameMs, 0), 100) / TRAIL_FRAME_MS;
  return 1 - Math.pow(1 - TRAIL_FADE, frames);
}
/// Alpha del «resto del grafo» quando c'è un focus: il quartiere a 1 salto
/// resta pieno, tutto il resto scende qui (§5.4 di ../../../../docs/product/search-links-and-graph.md).
const BACKGROUND_ALPHA = 0.12;
/// Il pulse dei nodi aperti vive solo mentre la simulazione è calda: a grafo
/// fermo un alone che oscilla senza motivo è rumore visivo.
const PULSE_THRESHOLD = 0.02;
/// Il raggio minimo di un nodo sullo schermo, in px CSS. I nodi scalano con lo
/// zoom come archi ed etichette; senza un minimo, un vault grande inquadrato
/// intero diventerebbe invisibile.
export const MIN_NODE_PX = 1.5;
/// Le etichette: corpo del testo, distanza dal nodo e lato della griglia di
/// occupazione che evita di sovrapporle.
const LABEL_PX = 11;
const LABEL_GAP = 5;
const LABEL_CELL = 8;

/// Il raggio di un nodo sullo schermo: quello di mondo per la scala, mai
/// sotto il minimo. Lo usano disegno, anelli, frecce ed etichette, così
/// nessuno dei quattro si stacca dagli altri a uno zoom diverso da 1.
export function screenRadius(radius: number, scale: number): number {
  const r = radius * scale;
  return r > MIN_NODE_PX ? r : MIN_NODE_PX;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function pulseOpacity(id: string, elapsedMs: number, alpha: number, enabled: boolean): number | undefined {
  if (!enabled || alpha <= PULSE_THRESHOLD) return undefined;
  const phase = ((fnv1a(id) % 1000) / 1000) * Math.PI * 2;
  return 0.5 + 0.5 * Math.sin((elapsedMs / 1000) * Math.PI * 2 * 1.2 + phase);
}

/// Gradini di spaziatura della griglia: la spaziatura **mondo** salta su una
/// scala discreta così i puntini non «strisciano» durante lo zoom — saltano
/// di gradino, che è molto meno fastidioso.
const GRID_LADDER = [16, 24, 40, 64, 96, 160, 256, 400, 640, 1000];

export function createPainter(host: HTMLElement, config: GraphicsConfig): Painter {
  const background = document.createElement("canvas");
  background.className = "graph-bg";
  const main = document.createElement("canvas");
  main.className = "graph-main";
  for (const c of [background, main]) {
    // Stile inline: i due canvas vivono sovrapposti dentro l'host, e questo
    // non deve dipendere da `theme/serie/skin.css` (che è di un altro lotto). Il main è
    // sopra e riceve i pointer event; lo sfondo è trasparente agli eventi.
    c.style.position = "absolute";
    c.style.inset = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.display = "block";
  }
  background.style.pointerEvents = "none";
  // Se l'host è statico, i figli absolute si ancorerebbero a un antenato
  // posizionato a caso: l'host diventa il riferimento, e solo se serve.
  if ((getComputedStyle(host).position || "static") === "static") {
    host.style.position = "relative";
  }
  host.append(background, main);

  const ctx = main.getContext("2d");
  const backgroundCtx = background.getContext("2d");

  let W = 1;
  let H = 1;
  let dpr = 1;
  let tints: Tints = readTints(host);
  let atlas: Atlas = generateAtlas(tints, RADIUS_BUCKETS);
  const fontStack = () => getComputedStyle(host).getPropertyValue("--font-ui").trim() || "system-ui, sans-serif";
  const focusColor = () => getComputedStyle(host).getPropertyValue("--focus-ring").trim();
  let currentFont = fontStack();
  let currentFocus = focusColor();
  /// L'ultimo stato disegnato: serve al cambio tema, che deve ricolorare il
  /// grafo **subito** anche se il rAF è spento (un grafo quieto non ha
  /// frame in volo da cui aspettare).
  let previousState: DrawState | null = null;
  /// La camera con cui è stata disegnata la griglia, e quella del frame
  /// precedente: la griglia si rifà quando la vista si muove, e la scia si
  /// spegne mentre si muove (strascicherebbe il grafo intero).
  let gridCamera: Camera | null = null;
  let lastCamera: Camera | null = null;
  /// Cache delle larghezze delle etichette: misurare il testo ogni frame con
  /// `measureText` costa più del disegno stesso. Chiave = id + peso (il bold
  /// degli accenti misura diverso).
  const widths = new Map<string, number>();
  /// Marca del quartiere a 1 salto, riusata tra i frame (zero allocazioni).
  let mark = new Uint8Array(0);
  /// L'ordine in cui le etichette si contendono lo spazio: grado decrescente,
  /// calcolato una volta per struttura (il grado non cambia).
  let labelOrder = new Uint32Array(0);
  let labelOrderOf: Structure | null = null;
  /// La griglia di occupazione delle etichette, in celle di `LABEL_CELL` px:
  /// un'etichetta che cadrebbe su una già scritta si salta.
  let taken = new Uint8Array(0);
  let takenColumns = 0;
  let takenRows = 0;

  function resize(w: number, h: number, r: number): void {
    W = Math.max(1, w);
    H = Math.max(1, h);
    dpr = r || 1;
    background.width = Math.round(W * dpr);
    background.height = Math.round(H * dpr);
    main.width = Math.round(W * dpr);
    main.height = Math.round(H * dpr);
    // Il trasform del codice attuale: le unità di disegno sono px CSS e il
    // dpr lo paga il canvas. Tutte le conversioni mondo→schermo stanno
    // dentro la camera, non nel canvas.
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (backgroundCtx) backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    takenColumns = Math.ceil(W / LABEL_CELL);
    takenRows = Math.ceil(H / LABEL_CELL);
    taken = new Uint8Array(takenColumns * takenRows);
    // Ridimensionare un canvas lo svuota: la griglia va rifatta.
    gridCamera = null;
    lastCamera = null;
  }

  function updateTints(): void {
    const t = readTints(host);
    const font = fontStack();
    const focus = focusColor();
    // La `source` è una chiave: se i colori non sono cambiati, rigenerare
    // l'atlas sarebbe lavoro buttato (l'osservatore scatta a ogni scrittura
    // di data-theme, anche quando il valore non cambia davvero).
    const colorsChanged = t.source !== tints.source;
    const fontChanged = font !== currentFont;
    if (!colorsChanged && !fontChanged && focus === currentFocus) return;
    tints = t;
    currentFont = font;
    currentFocus = focus;
    if (colorsChanged) atlas = generateAtlas(tints, RADIUS_BUCKETS);
    // Il font delle etichette può dipendere dal tema: la cache delle
    // larghezze misurate col font vecchio non vale più.
    if (colorsChanged || fontChanged) widths.clear();
    if (previousState) {
      redrawBackground();
      redraw(previousState);
    }
  }

  /// La griglia di puntini: spaziatura mondo adattiva (i puntini restano a
  /// 24–48 px di schermo, qualsiasi sia lo zoom), colore del nodo a alpha
  /// fissa. Niente vignette: un gradiente radiale per tema sarebbe un altro
  /// colore da tenere allineato ai token per un guadagno estetico minimo.
  function drawGrid(c: Camera): void {
    if (!backgroundCtx) return;
    gridCamera = c;
    backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    backgroundCtx.clearRect(0, 0, W, H);
    if (!config.grid) return;
    const target = 24 / c.scale;
    let spacing = GRID_LADDER[0];
    for (const s of GRID_LADDER) {
      if (s >= target) {
        spacing = s;
        break;
      }
      spacing = s;
    }
    const step = spacing * c.scale;
    // La griglia è ancorata al mondo: il primo puntino è il multiplo della
    // spaziatura più vicino al bordo, così pan e zoom la trascinano col grafo.
    const x0 = c.tx - Math.floor(c.tx / step) * step;
    const y0 = c.ty - Math.floor(c.ty / step) * step;
    // Allineati al pixel del dispositivo: un puntino a cavallo di due pixel
    // cambia luminosità a ogni spostamento sub-pixel, e la griglia sfarfalla.
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    backgroundCtx.fillStyle = tints.node;
    backgroundCtx.globalAlpha = 0.35;
    backgroundCtx.beginPath();
    for (let y = y0; y < H; y += step) {
      for (let x = x0; x < W; x += step) {
        backgroundCtx.rect(snap(x) - 0.75, snap(y) - 0.75, 1.5, 1.5);
      }
    }
    backgroundCtx.fill();
    backgroundCtx.globalAlpha = 1;
  }

  function redrawBackground(): void {
    drawGrid(previousState?.camera ?? { scale: 1, tx: 0, ty: 0 });
  }

  /// Bbox di un arco (estremi + punto di controllo) in schermo: la curva
  /// quadratica può sporgere di molto oltre i suoi estremi quando è corta e
  /// curva, e il culling deve saperlo.
  function edgeInView(s: Structure, c: Camera, e: number, curv: number): boolean {
    const x1 = s.x[s.from[e]];
    const y1 = s.y[s.from[e]];
    const x2 = s.x[s.to[e]];
    const y2 = s.y[s.to[e]];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const off = s.curvature[e] * L * curv;
    const cx = (x1 + x2) / 2 + (-dy / L) * off;
    const cy = (y1 + y2) / 2 + (dx / L) * off;
    const minX = Math.min(x1, x2, cx) * c.scale + c.tx - CULL_MARGIN;
    const maxX = Math.max(x1, x2, cx) * c.scale + c.tx + CULL_MARGIN;
    const minY = Math.min(y1, y2, cy) * c.scale + c.ty - CULL_MARGIN;
    const maxY = Math.max(y1, y2, cy) * c.scale + c.ty + CULL_MARGIN;
    return maxX >= 0 && minX <= W && maxY >= 0 && minY <= H;
  }

  function addEdge(ctx: CanvasRenderingContext2D, s: Structure, c: Camera, e: number, curv: number): void {
    const x1 = s.x[s.from[e]];
    const y1 = s.y[s.from[e]];
    const x2 = s.x[s.to[e]];
    const y2 = s.y[s.to[e]];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    // Point di controllo = medio + perpendicolare · curva · L · curvatura:
    // due archi a↔b hanno `curvature` di segno opposto (hash dell'identità) e si
    // separano in due curve speculari invece di giacersi sopra.
    const off = s.curvature[e] * L * curv;
    const cx = (x1 + x2) / 2 + (-dy / L) * off;
    const cy = (y1 + y2) / 2 + (dx / L) * off;
    ctx.moveTo(x1 * c.scale + c.tx, y1 * c.scale + c.ty);
    ctx.quadraticCurveTo(cx * c.scale + c.tx, cy * c.scale + c.ty, x2 * c.scale + c.tx, y2 * c.scale + c.ty);
    // Freccia nella tangente finale della Bézier, arretrata rispetto al disco
    // di destinazione. Stessa path e stesso stroke dell'arco: un solo batch per
    // livello di focus, non un draw call per arco (anche su 10k archi).
    if (L * c.scale < 24) return;
    const tx = x2 - cx;
    const ty = y2 - cy;
    const tangent = Math.hypot(tx, ty);
    if (tangent < 0.001) return;
    const ux = tx / tangent;
    const uy = ty / tangent;
    const back = screenRadius(s.radius[s.to[e]], c.scale) + 4;
    const tipX = x2 * c.scale + c.tx - ux * back;
    const tipY = y2 * c.scale + c.ty - uy * back;
    const baseX = tipX - ux * 9;
    const baseY = tipY - uy * 9;
    ctx.moveTo(baseX - uy * 5, baseY + ux * 5);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + uy * 5, baseY - ux * 5);
  }

  /// L'ordine delle etichette per una struttura: grado decrescente, a parità
  /// l'indice. Si rifà solo se la struttura è un'altra.
  function orderLabels(s: Structure): Uint32Array {
    if (labelOrderOf === s && labelOrder.length === s.n) return labelOrder;
    const order = Array.from({ length: s.n }, (_, i) => i);
    order.sort((a, b) => s.degree[b] - s.degree[a] || a - b);
    labelOrder = Uint32Array.from(order);
    labelOrderOf = s;
    return labelOrder;
  }

  /// Prova a scrivere un'etichetta: se il suo rettangolo cade su celle già
  /// prese la salta e ritorna `false`, altrimenti le prende e la scrive con un
  /// bordo del colore dello sfondo, che la stacca dagli archi che attraversa.
  function placeLabel(ctx: CanvasRenderingContext2D, text: string, width: number, x: number, y: number, force: boolean): boolean {
    const half = LABEL_PX / 2 + 1;
    const c0 = Math.max(0, Math.floor(x / LABEL_CELL));
    const c1 = Math.min(takenColumns - 1, Math.floor((x + width) / LABEL_CELL));
    const r0 = Math.max(0, Math.floor((y - half) / LABEL_CELL));
    const r1 = Math.min(takenRows - 1, Math.floor((y + half) / LABEL_CELL));
    if (!force) {
      for (let r = r0; r <= r1; r++) {
        for (let col = c0; col <= c1; col++) if (taken[r * takenColumns + col]) return false;
      }
    }
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) taken[r * takenColumns + col] = 1;
    }
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return true;
  }

  function labelWidth(ctx: CanvasRenderingContext2D, key: string, text: string): number {
    let width = widths.get(key);
    if (width === undefined) {
      width = ctx.measureText(text).width;
      widths.set(key, width);
    }
    return width;
  }

  function redraw(state: DrawState): void {
    previousState = state;
    if (!ctx) return;
    const { s, camera: c, openDocuments, visible, hovered, dragged, focused, alpha, tier, elapsedMs, reducedMotion } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cameraMoved = !lastCamera || lastCamera.scale !== c.scale || lastCamera.tx !== c.tx || lastCamera.ty !== c.ty;
    lastCamera = c;
    // La griglia segue la vista: si rifà solo quando la camera è cambiata
    // rispetto a quella con cui è stata disegnata.
    if (!gridCamera || gridCamera.scale !== c.scale || gridCamera.tx !== c.tx || gridCamera.ty !== c.ty) drawGrid(c);

    // Trail: finché la simulazione è calda il fotogramma precedente non si
    // pulisce ma sbiadisce verso il **trasparente** (`destination-out`), e i
    // nodi lasciano scie brevi. Riempire di colore di sfondo copriva la
    // griglia, tingeva il riquadro di un colore diverso dal suo e lasciava
    // aloni fissi per l'arrotondamento a 8 bit. Con la vista in movimento la
    // scia si spegne: strascicherebbe il grafo intero.
    if (config.trail && alpha > TRAIL_THRESHOLD && !reducedMotion && !cameraMoved) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = trailFade(state.frameMs);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    const curv = config.edgeCurvature;
    // Il «focus» del disegno (anello, etichetta in grassetto): il nodo
    // trascinato vince, poi l'hover del puntatore, poi la selezione da
    // tastiera. Il quartiere acceso è quello che il grafico anima.
    const focus = dragged >= 0 ? dragged : hovered >= 0 ? hovered : focused;
    const center = state.highlightNode ?? focus;
    const lit = center >= 0 && center < s.n ? (state.highlight ?? 1) : 0;
    const dimAlpha = 1 - lit * (1 - BACKGROUND_ALPHA);

    // Il quartiere a 1 salto: la marca si riusa tra i frame e si azzera in
    // place — nel frame caldo non si alloca. Senza quartiere acceso ogni nodo
    // è «marcato»: un solo passaggio, niente filigrana.
    if (mark.length < s.n) mark = new Uint8Array(s.n);
    if (lit > 0) {
      mark.fill(0, 0, s.n);
      mark[center] = 1;
      for (let e = 0; e < s.m; e++) {
        if (s.from[e] === center) mark[s.to[e]] = 1;
        else if (s.to[e] === center) mark[s.from[e]] = 1;
      }
    } else {
      mark.fill(1, 0, s.n);
    }
    const shown = (i: number): boolean => !visible || visible.has(s.id[i]);

    // Archi — un beginPath/stroke per livello: il resto del grafo, poi il
    // quartiere (più spesso e più chiaro man mano che si accende).
    const edgeAlpha = clamp(c.scale * 0.35, 0.18, 0.5);
    ctx.strokeStyle = tints.node;
    if (lit > 0) {
      ctx.beginPath();
      for (let e = 0; e < s.m; e++) {
        if (!shown(s.from[e]) || !shown(s.to[e])) continue;
        if (s.from[e] === center || s.to[e] === center) continue;
        if (!edgeInView(s, c, e, curv)) continue;
        addEdge(ctx, s, c, e, curv);
      }
      ctx.globalAlpha = edgeAlpha * dimAlpha;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let e = 0; e < s.m; e++) {
      if (!shown(s.from[e]) || !shown(s.to[e])) continue;
      if (lit > 0 && s.from[e] !== center && s.to[e] !== center) continue;
      if (!edgeInView(s, c, e, curv)) continue;
      addEdge(ctx, s, c, e, curv);
    }
    ctx.globalAlpha = edgeAlpha + (0.85 - edgeAlpha) * lit;
    ctx.lineWidth = 1 + 0.5 * lit;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const inView = (sx: number, sy: number, rS: number): boolean =>
      sx >= -rS - CULL_MARGIN && sx <= W + rS + CULL_MARGIN && sy >= -rS - CULL_MARGIN && sy <= H + rS + CULL_MARGIN;

    // Nodi — due passate per non cambiare globalAlpha a ogni nodo: prima i
    // spenti in filigrana, poi i pieni (e i loro anelli).
    if (lit > 0) {
      ctx.globalAlpha = dimAlpha;
      for (let i = 0; i < s.n; i++) {
        if (mark[i] || !shown(i)) continue;
        const sx = s.x[i] * c.scale + c.tx;
        const sy = s.y[i] * c.scale + c.ty;
        const rS = screenRadius(s.radius[i], c.scale);
        if (!inView(sx, sy, rS)) continue;
        drawNode(ctx, atlas, sx, sy, rS, openDocuments.has(s.id[i]) ? "active" : "node", undefined, dpr);
      }
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < s.n; i++) {
      if (!mark[i] || !shown(i)) continue;
      const sx = s.x[i] * c.scale + c.tx;
      const sy = s.y[i] * c.scale + c.ty;
      const rS = screenRadius(s.radius[i], c.scale);
      if (!inView(sx, sy, rS)) continue;
      const isOpen = openDocuments.has(s.id[i]);
      const role: TintRole = dragged === i ? "active" : hovered === i ? "hover" : isOpen ? "active" : "node";
      // L'alone pulsante dei nodi aperti: fase dall'hash dell'id, così i
      // vicini non pulsano in sincrono (sembra vivo, non un semaforo).
      const alone = pulseOpacity(s.id[i], elapsedMs, alpha, !reducedMotion && isOpen && config.pulse);
      drawNode(ctx, atlas, sx, sy, rS, role, alone, dpr);
      if (i === focus) {
        ctx.beginPath();
        ctx.arc(sx, sy, rS + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = dragged === i ? tints.active : tints.hover;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (s.fixed[i] === 1) {
        // Un pin è un impegno dell'utente: un anello sottile lo rende
        // riconoscibile a colpo d'occhio senza gridare.
        ctx.beginPath();
        ctx.arc(sx, sy, rS + 2, 0, Math.PI * 2);
        ctx.strokeStyle = tints.active;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // I gruppi: un anello del colore del gruppo attorno al nodo, un tratto
    // per colore e per livello (non un draw call per nodo).
    const groups = state.groups;
    if (groups && tints.groups.length > 0) {
      ctx.lineWidth = 2;
      for (let pass = lit > 0 ? 0 : 1; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? dimAlpha : 1;
        for (let g = 0; g < tints.groups.length; g++) {
          ctx.beginPath();
          let any = false;
          for (let i = 0; i < s.n; i++) {
            if (groups[i] !== g || (mark[i] ? 1 : 0) !== pass || !shown(i)) continue;
            const sx = s.x[i] * c.scale + c.tx;
            const sy = s.y[i] * c.scale + c.ty;
            const rS = screenRadius(s.radius[i], c.scale);
            if (!inView(sx, sy, rS)) continue;
            ctx.moveTo(sx + rS + 1.5, sy);
            ctx.arc(sx, sy, rS + 1.5, 0, Math.PI * 2);
            any = true;
          }
          if (!any) continue;
          ctx.strokeStyle = tints.groups[g]!;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Etichette. Prima quelle che contano — il focus e le note aperte, sempre
    // leggibili a qualunque zoom; poi il quartiere acceso, man mano che si
    // accende; poi le altre per grado decrescente, visibili per tier e grado
    // e in dissolvenza con lo zoom (a scala bassa il testo si accavalla e non
    // si legge). Ognuna prende il suo spazio: una che cadrebbe sopra una già
    // scritta si salta, invece di formare una macchia illeggibile.
    const threshold = 3 * (1 - config.labelDensity) + 1;
    const fade = clamp((c.scale - 0.5) / 0.5, 0, 1);
    taken.fill(0);
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = tints.background;
    ctx.fillStyle = tints.text;
    const fontBase = `${LABEL_PX}px ${currentFont}`;
    const fontBold = `600 ${LABEL_PX}px ${currentFont}`;
    const labelAt = (i: number, bold: boolean, force: boolean, clearance = 0): void => {
      const sx = s.x[i] * c.scale + c.tx;
      const sy = s.y[i] * c.scale + c.ty;
      if (sx < -CULL_MARGIN || sx > W + CULL_MARGIN || sy < -CULL_MARGIN || sy > H + CULL_MARGIN) return;
      const text = nodeLabel(s.id[i]);
      const width = labelWidth(ctx, (bold ? "b" : "n") + s.id[i], text);
      placeLabel(ctx, text, width, sx + screenRadius(s.radius[i], c.scale) + LABEL_GAP + clearance, sy, force);
    };
    ctx.font = fontBold;
    // Il focus ha l'anello (raggio + 2.5, tratto 2): l'etichetta gli sta fuori.
    if (focus >= 0 && focus < s.n && shown(focus)) labelAt(focus, true, true, 3);
    if (openDocuments.size > 0) {
      for (let i = 0; i < s.n; i++) {
        if (i !== focus && openDocuments.has(s.id[i]) && shown(i)) labelAt(i, true, false);
      }
    }
    ctx.font = fontBase;
    if (lit > 0) {
      ctx.globalAlpha = Math.max(fade, lit);
      for (let i = 0; i < s.n; i++) {
        if (!mark[i] || i === focus || !shown(i) || openDocuments.has(s.id[i])) continue;
        labelAt(i, false, false);
      }
    }
    if (fade > 0.01) {
      const order = orderLabels(s);
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        if (tier !== 1 && s.degree[i] < threshold) continue;
        if (i === focus || !shown(i) || openDocuments.has(s.id[i])) continue;
        if (lit > 0 && mark[i]) continue;
        ctx.globalAlpha = fade * (lit > 0 ? 1 - lit * 0.65 : 1);
        labelAt(i, false, false);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Il cambio tema a caldo (bug 2-3): l'osservatore su `data-theme` rifà
  // tinte, atlas e disegno senza che nessuno debba ricordarsi di chiamare
  // `updateTints`. Più pittori (due riquadri) osservano lo stesso
  // documentElement senza conflitti: ognuno ricolora il proprio canvas.
  let resizeObserver: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    resizeObserver = new MutationObserver(() => updateTints());
    resizeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function destroy(): void {
    resizeObserver?.disconnect();
    background.remove();
    main.remove();
  }

  return { redraw, redrawBackground, updateTints, resize, destroy };
}
