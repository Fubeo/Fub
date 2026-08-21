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
  hovered: number;
  dragged: number;
  /// Il nodo selezionato da tastiera (frecce): è «focus» quanto l'hover per
  /// quartiere, anello ed etichette, ma persiste senza puntatore.
  focused: number;
  alpha: number;
  tier: Tier;
  elapsedMs: number;
  reducedMotion: boolean;
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
const ALPHA_TRAIL = 0.25;
/// Alpha del «resto del grafo» quando c'è un focus: il quartiere a 1 salto
/// resta pieno, tutto il resto scende qui (§5.4 di graph.md).
const BACKGROUND_ALPHA = 0.12;
/// Il pulse dei nodi aperti vive solo mentre la simulazione è calda: a grafo
/// fermo un alone che oscilla senza motivo è rumore visivo.
const PULSE_THRESHOLD = 0.02;

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
  /// Cache delle larghezze delle etichette: misurare il testo ogni frame con
  /// `measureText` costa più del disegno stesso. Chiave = id + peso (il bold
  /// degli accenti misura diverso).
  const widths = new Map<string, number>();
  /// Marca del quartiere a 1 salto, riusata tra i frame (zero allocazioni).
  let mark = new Uint8Array(0);

  function resize(w: number, h: number, r: number): void {
    W = Math.max(1, w);
    H = Math.max(1, h);
    dpr = r || 1;
    background.width = W * dpr;
    background.height = H * dpr;
    main.width = W * dpr;
    main.height = H * dpr;
    // Il trasform del codice attuale: le unità di disegno sono px CSS e il
    // dpr lo paga il canvas. Tutte le conversioni mondo→schermo stanno
    // dentro la camera, non nel canvas.
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (backgroundCtx) backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    if (colorsChanged) {
      atlas = generateAtlas(tints, RADIUS_BUCKETS);
      // Il font delle etichette può dipendere dal tema: la cache delle
      // larghezze misurate col font vecchio non vale più.
      widths.clear();
    }
    if (previousState) {
      redrawBackground();
      redraw(previousState);
    }
  }

  /// La griglia di puntini: spaziatura mondo adattiva (i puntini restano a
  /// 24–48 px di schermo, qualsiasi sia lo zoom), colore del nodo a alpha
  /// fissa. Niente vignette: un gradiente radiale per tema sarebbe un altro
  /// colore da tenere allineato ai token per un guadagno estetico minimo.
  function redrawBackground(): void {
    if (!backgroundCtx) return;
    backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    backgroundCtx.clearRect(0, 0, W, H);
    if (!config.grid) return;
    const c = previousState?.camera ?? { scale: 1, tx: 0, ty: 0 };
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
    const x0 = Math.floor(-c.tx / step) * step;
    const y0 = Math.floor(-c.ty / step) * step;
    backgroundCtx.fillStyle = tints.node;
    backgroundCtx.globalAlpha = 0.35;
    backgroundCtx.beginPath();
    for (let y = y0; y < H; y += step) {
      for (let x = x0; x < W; x += step) {
        backgroundCtx.rect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }
    backgroundCtx.fill();
    backgroundCtx.globalAlpha = 1;
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
  }

  function redraw(state: DrawState): void {
    previousState = state;
    if (!ctx) return;
    const { s, camera: c, openDocuments, hovered, dragged, focused, alpha, tier, elapsedMs, reducedMotion } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Trail: finché la simulazione è calda il canvas si sporca di
    // riempimenti traslucidi invece di pulirsi, e i nodi lasciano scie che
    // svaniscono da sole quando il grafo si quieta. Lo sfondo arriva dai
    // token, mai hardcodato: il tema chiaro esiste.
    if (config.trail && alpha > TRAIL_THRESHOLD) {
      ctx.globalAlpha = ALPHA_TRAIL;
      ctx.fillStyle = tints.background;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    const curv = config.edgeCurvature;
    // Il «focus» che accende il quartiere: il nodo trascinato vince, poi
    // l'hover del puntatore, poi la selezione da tastiera.
    const focus = dragged >= 0 ? dragged : hovered >= 0 ? hovered : focused;

    // Il quartiere a 1 salto del focus: la marca si riusa tra i frame e si
    // azzera in place — nel frame caldo non si alloca.
    if (mark.length < s.n) mark = new Uint8Array(s.n);
    else mark.fill(0);
    if (focus >= 0) {
      mark[focus] = 1;
      for (let e = 0; e < s.m; e++) {
        if (s.from[e] === focus) mark[s.to[e]] = 1;
        else if (s.to[e] === focus) mark[s.from[e]] = 1;
      }
    }

    // Archi — un beginPath/stroke per stato: batch di fondo (alpha 0.12) e
    // batch pieno. Senza focus c'è un solo batch, alfa da scala.
    const edgeAlpha = clamp(c.scale * 0.35, 0.18, 0.5);
    if (focus >= 0) {
      ctx.beginPath();
      for (let e = 0; e < s.m; e++) {
        if (mark[s.from[e]] || mark[s.to[e]]) continue;
        if (!edgeInView(s, c, e, curv)) continue;
        addEdge(ctx, s, c, e, curv);
      }
      ctx.globalAlpha = BACKGROUND_ALPHA;
      ctx.strokeStyle = tints.node;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let e = 0; e < s.m; e++) {
      if (focus >= 0 && !(mark[s.from[e]] || mark[s.to[e]])) continue;
      if (!edgeInView(s, c, e, curv)) continue;
      addEdge(ctx, s, c, e, curv);
    }
    // Gli archi del quartiere sono i pochi che meritano un filo più spesso:
    // sono l'oggetto dell'attenzione dell'utente.
    ctx.globalAlpha = edgeAlpha;
    ctx.strokeStyle = tints.node;
    ctx.lineWidth = focus >= 0 ? 1.5 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Nodi — due passate per non cambiare globalAlpha a ogni nodo: prima i
    // spenti in filigrana, poi i pieni (e i loro anelli).
    if (focus >= 0) {
      ctx.globalAlpha = BACKGROUND_ALPHA;
      for (let i = 0; i < s.n; i++) {
        if (i === focus || mark[i]) continue;
        const sx = s.x[i] * c.scale + c.tx;
        const sy = s.y[i] * c.scale + c.ty;
        const rS = s.radius[i] * c.scale;
        if (sx < -rS - CULL_MARGIN || sx > W + rS + CULL_MARGIN || sy < -rS - CULL_MARGIN || sy > H + rS + CULL_MARGIN) continue;
        drawNode(ctx, atlas, sx, sy, s.radius[i], openDocuments.has(s.id[i]) ? "active" : "node");
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < s.n; i++) {
      if (focus >= 0 && i !== focus && !mark[i]) continue;
      const sx = s.x[i] * c.scale + c.tx;
      const sy = s.y[i] * c.scale + c.ty;
      const rS = s.radius[i] * c.scale;
      if (sx < -rS - CULL_MARGIN || sx > W + rS + CULL_MARGIN || sy < -rS - CULL_MARGIN || sy > H + rS + CULL_MARGIN) continue;
      const isOpen = openDocuments.has(s.id[i]);
      const role: TintRole = dragged === i ? "active" : hovered === i ? "hover" : isOpen ? "active" : "node";
      // L'alone pulsante dei nodi aperti: fase dall'hash dell'id, così i
      // vicini non pulsano in sincrono (sembra vivo, non un semaforo).
      const alone = pulseOpacity(s.id[i], elapsedMs, alpha, !reducedMotion && isOpen && config.pulse);
      drawNode(ctx, atlas, sx, sy, s.radius[i], role, alone);
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

    // Etichette: visibili per tier, grado o accento; alpha in fade con lo
    // zoom (a scala bassa il testo si accavalla e non si legge, quindi non
    // si disegna proprio).
    const threshold = 3 * (1 - config.labelDensity) + 1;
    const fade = clamp((c.scale - 0.5) / 0.5, 0, 1);
    if (fade > 0.01) {
      const fontBase = `11px ${currentFont}`;
      const fontBold = `600 11px ${currentFont}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = tints.text;
      for (let i = 0; i < s.n; i++) {
        const accent = i === focus || openDocuments.has(s.id[i]);
        if (accent) continue;
        if (tier !== 1 && s.degree[i] < threshold) continue;
        const sx = s.x[i] * c.scale + c.tx;
        const sy = s.y[i] * c.scale + c.ty;
        const rS = s.radius[i] * c.scale;
        if (sx < -CULL_MARGIN || sx > W + CULL_MARGIN || sy < -CULL_MARGIN || sy > H + CULL_MARGIN) continue;
        ctx.font = fontBase;
        const key = "n" + s.id[i];
        let width = widths.get(key);
        if (width === undefined) {
          width = ctx.measureText(s.id[i]).width;
          widths.set(key, width);
        }
        ctx.globalAlpha = fade * (focus >= 0 && i !== focus && !mark[i] ? 0.35 : 1);
        ctx.fillText(s.id[i], sx + rS + 5, sy);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < s.n; i++) {
        const accent = i === focus || openDocuments.has(s.id[i]);
        if (!accent) continue;
        const sx = s.x[i] * c.scale + c.tx;
        const sy = s.y[i] * c.scale + c.ty;
        const rS = s.radius[i] * c.scale;
        if (sx < -CULL_MARGIN || sx > W + CULL_MARGIN || sy < -CULL_MARGIN || sy > H + CULL_MARGIN) continue;
        ctx.font = fontBold;
        const key = "b" + s.id[i];
        let width = widths.get(key);
        if (width === undefined) {
          width = ctx.measureText(s.id[i]).width;
          widths.set(key, width);
        }
        ctx.fillText(s.id[i], sx + rS + 5, sy);
      }
      ctx.globalAlpha = 1;
    }
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
