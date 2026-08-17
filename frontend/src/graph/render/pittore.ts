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

import type { ConfGrafica, Struttura, Tier } from "../sim/tipi";
import { fnv1a } from "../sim/tipi";
import type { Camera } from "./camera";
import type { Atlas, Tinte, RuoloTinta } from "./atlas";
import { generaAtlas, leggiTinte, disegnaNodo, BUCKET_RAGGI } from "./atlas";

export interface StatoDisegno {
  s: Struttura;
  camera: Camera;
  aperti: ReadonlySet<string>;
  hovered: number;
  trascinato: number;
  /// Il nodo selezionato da tastiera (frecce): è «focus» quanto l'hover per
  /// quartiere, anello ed etichette, ma persiste senza puntatore.
  focalizzato: number;
  alpha: number;
  tier: Tier;
  tempoMs: number;
}

export interface Pittore {
  ridisegna(stato: StatoDisegno): void;
  ridisegnaSfondo(): void;
  aggiornaTinte(): void;
  ridimensiona(w: number, h: number, dpr: number): void;
  distruggi(): void;
}

/// Quanto i nodi/archi possono stare fuori dal viewport prima di essere
/// scartati: copre raggio + glow + la gobba delle curve quadratiche.
const MARGINE_CULL = 50;
/// Sopra questa alpha la simulazione gira e il trail ha senso (sotto, un
/// riempimento traslucido lascerebbe un alone fantasma di un grafo fermo).
export const SOGLIA_TRAIL = 0.02;
const ALPHA_TRAIL = 0.25;
/// Alpha del «resto del grafo» quando c'è un focus: il quartiere a 1 salto
/// resta pieno, tutto il resto scende qui (§5.4 di graph.md).
const ALPHA_FONDO = 0.12;
/// Il pulse dei nodi aperti vive solo mentre la simulazione è calda: a grafo
/// fermo un alone che oscilla senza motivo è rumore visivo.
const SOGLIA_PULSE = 0.02;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/// Gradini di spaziatura della griglia: la spaziatura **mondo** salta su una
/// scala discreta così i puntini non «strisciano» durante lo zoom — saltano
/// di gradino, che è molto meno fastidioso.
const LADDER_GRIGLIA = [16, 24, 40, 64, 96, 160, 256, 400, 640, 1000];

export function creaPittore(host: HTMLElement, conf: ConfGrafica): Pittore {
  const sfondo = document.createElement("canvas");
  sfondo.className = "graph-bg";
  const principale = document.createElement("canvas");
  principale.className = "graph-main";
  for (const c of [sfondo, principale]) {
    // Stile inline: i due canvas vivono sovrapposti dentro l'host, e questo
    // non deve dipendere da `theme/serie/pelle.css` (che è di un altro lotto). Il main è
    // sopra e riceve i pointer event; lo sfondo è trasparente agli eventi.
    c.style.position = "absolute";
    c.style.inset = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.display = "block";
  }
  sfondo.style.pointerEvents = "none";
  // Se l'host è statico, i figli absolute si ancorerebbero a un antenato
  // posizionato a caso: l'host diventa il riferimento, e solo se serve.
  if ((getComputedStyle(host).position || "static") === "static") {
    host.style.position = "relative";
  }
  host.append(sfondo, principale);

  const ctx = principale.getContext("2d");
  const ctxSfondo = sfondo.getContext("2d");

  let W = 1;
  let H = 1;
  let dpr = 1;
  let tinte: Tinte = leggiTinte(host);
  let atlas: Atlas = generaAtlas(tinte, BUCKET_RAGGI);
  const fontStack = () => getComputedStyle(host).getPropertyValue("--font-ui").trim() || "system-ui, sans-serif";
  const coloreFocus = () => getComputedStyle(host).getPropertyValue("--focus-ring").trim();
  let fontCorrente = fontStack();
  let focusCorrente = coloreFocus();
  /// L'ultimo stato disegnato: serve al cambio tema, che deve ricolorare il
  /// grafo **subito** anche se il rAF è spento (un grafo quieto non ha
  /// frame in volo da cui aspettare).
  let ultimoStato: StatoDisegno | null = null;
  /// Cache delle larghezze delle etichette: misurare il testo ogni frame con
  /// `measureText` costa più del disegno stesso. Chiave = id + peso (il bold
  /// degli accenti misura diverso).
  const larghezze = new Map<string, number>();
  /// Marca del quartiere a 1 salto, riusata tra i frame (zero allocazioni).
  let marca = new Uint8Array(0);

  function ridimensiona(w: number, h: number, r: number): void {
    W = Math.max(1, w);
    H = Math.max(1, h);
    dpr = r || 1;
    sfondo.width = W * dpr;
    sfondo.height = H * dpr;
    principale.width = W * dpr;
    principale.height = H * dpr;
    // Il trasform del codice attuale: le unità di disegno sono px CSS e il
    // dpr lo paga il canvas. Tutte le conversioni mondo→schermo stanno
    // dentro la camera, non nel canvas.
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ctxSfondo) ctxSfondo.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function aggiornaTinte(): void {
    const t = leggiTinte(host);
    const font = fontStack();
    const focus = coloreFocus();
    // La `fonte` è una chiave: se i colori non sono cambiati, rigenerare
    // l'atlas sarebbe lavoro buttato (l'osservatore scatta a ogni scrittura
    // di data-theme, anche quando il valore non cambia davvero).
    const coloriCambiati = t.fonte !== tinte.fonte;
    const fontCambiata = font !== fontCorrente;
    if (!coloriCambiati && !fontCambiata && focus === focusCorrente) return;
    tinte = t;
    fontCorrente = font;
    focusCorrente = focus;
    if (coloriCambiati) {
      atlas = generaAtlas(tinte, BUCKET_RAGGI);
      // Il font delle etichette può dipendere dal tema: la cache delle
      // larghezze misurate col font vecchio non vale più.
      larghezze.clear();
    }
    if (ultimoStato) {
      ridisegnaSfondo();
      ridisegna(ultimoStato);
    }
  }

  /// La griglia di puntini: spaziatura mondo adattiva (i puntini restano a
  /// 24–48 px di schermo, qualsiasi sia lo zoom), colore del nodo a alpha
  /// fissa. Niente vignette: un gradiente radiale per tema sarebbe un altro
  /// colore da tenere allineato ai token per un guadagno estetico minimo.
  function ridisegnaSfondo(): void {
    if (!ctxSfondo) return;
    ctxSfondo.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxSfondo.clearRect(0, 0, W, H);
    if (!conf.griglia) return;
    const c = ultimoStato?.camera ?? { scala: 1, tx: 0, ty: 0 };
    const target = 24 / c.scala;
    let spaziatura = LADDER_GRIGLIA[0];
    for (const s of LADDER_GRIGLIA) {
      if (s >= target) {
        spaziatura = s;
        break;
      }
      spaziatura = s;
    }
    const passo = spaziatura * c.scala;
    const x0 = Math.floor(-c.tx / passo) * passo;
    const y0 = Math.floor(-c.ty / passo) * passo;
    ctxSfondo.fillStyle = tinte.nodo;
    ctxSfondo.globalAlpha = 0.35;
    ctxSfondo.beginPath();
    for (let y = y0; y < H; y += passo) {
      for (let x = x0; x < W; x += passo) {
        ctxSfondo.rect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }
    ctxSfondo.fill();
    ctxSfondo.globalAlpha = 1;
  }

  /// Bbox di un arco (estremi + punto di controllo) in schermo: la curva
  /// quadratica può sporgere di molto oltre i suoi estremi quando è corta e
  /// curva, e il culling deve saperlo.
  function arcoInVista(s: Struttura, c: Camera, e: number, curv: number): boolean {
    const x1 = s.x[s.da[e]];
    const y1 = s.y[s.da[e]];
    const x2 = s.x[s.a[e]];
    const y2 = s.y[s.a[e]];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const off = s.curva[e] * L * curv;
    const cx = (x1 + x2) / 2 + (-dy / L) * off;
    const cy = (y1 + y2) / 2 + (dx / L) * off;
    const minX = Math.min(x1, x2, cx) * c.scala + c.tx - MARGINE_CULL;
    const maxX = Math.max(x1, x2, cx) * c.scala + c.tx + MARGINE_CULL;
    const minY = Math.min(y1, y2, cy) * c.scala + c.ty - MARGINE_CULL;
    const maxY = Math.max(y1, y2, cy) * c.scala + c.ty + MARGINE_CULL;
    return maxX >= 0 && minX <= W && maxY >= 0 && minY <= H;
  }

  function aggiungiArco(ctx: CanvasRenderingContext2D, s: Struttura, c: Camera, e: number, curv: number): void {
    const x1 = s.x[s.da[e]];
    const y1 = s.y[s.da[e]];
    const x2 = s.x[s.a[e]];
    const y2 = s.y[s.a[e]];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    // Punto di controllo = medio + perpendicolare · curva · L · curvatura:
    // due archi a↔b hanno `curva` di segno opposto (hash dell'identità) e si
    // separano in due curve speculari invece di giacersi sopra.
    const off = s.curva[e] * L * curv;
    const cx = (x1 + x2) / 2 + (-dy / L) * off;
    const cy = (y1 + y2) / 2 + (dx / L) * off;
    ctx.moveTo(x1 * c.scala + c.tx, y1 * c.scala + c.ty);
    ctx.quadraticCurveTo(cx * c.scala + c.tx, cy * c.scala + c.ty, x2 * c.scala + c.tx, y2 * c.scala + c.ty);
  }

  function ridisegna(stato: StatoDisegno): void {
    ultimoStato = stato;
    if (!ctx) return;
    const { s, camera: c, aperti, hovered, trascinato, focalizzato, alpha, tier, tempoMs } = stato;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Trail: finché la simulazione è calda il canvas si sporca di
    // riempimenti traslucidi invece di pulirsi, e i nodi lasciano scie che
    // svaniscono da sole quando il grafo si quieta. Lo sfondo arriva dai
    // token, mai hardcodato: il tema chiaro esiste.
    if (conf.trail && alpha > SOGLIA_TRAIL) {
      ctx.globalAlpha = ALPHA_TRAIL;
      ctx.fillStyle = tinte.sfondo;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    const curv = conf.curvaturaArchi;
    // Il «focus» che accende il quartiere: il nodo trascinato vince, poi
    // l'hover del puntatore, poi la selezione da tastiera.
    const focus = trascinato >= 0 ? trascinato : hovered >= 0 ? hovered : focalizzato;

    // Il quartiere a 1 salto del focus: la marca si riusa tra i frame e si
    // azzera in place — nel frame caldo non si alloca.
    if (marca.length < s.n) marca = new Uint8Array(s.n);
    else marca.fill(0);
    if (focus >= 0) {
      marca[focus] = 1;
      for (let e = 0; e < s.m; e++) {
        if (s.da[e] === focus) marca[s.a[e]] = 1;
        else if (s.a[e] === focus) marca[s.da[e]] = 1;
      }
    }

    // Archi — un beginPath/stroke per stato: batch di fondo (alpha 0.12) e
    // batch pieno. Senza focus c'è un solo batch, alfa da scala.
    const alphaArco = clamp(c.scala * 0.35, 0.18, 0.5);
    if (focus >= 0) {
      ctx.beginPath();
      for (let e = 0; e < s.m; e++) {
        if (marca[s.da[e]] || marca[s.a[e]]) continue;
        if (!arcoInVista(s, c, e, curv)) continue;
        aggiungiArco(ctx, s, c, e, curv);
      }
      ctx.globalAlpha = ALPHA_FONDO;
      ctx.strokeStyle = tinte.nodo;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let e = 0; e < s.m; e++) {
      if (focus >= 0 && !(marca[s.da[e]] || marca[s.a[e]])) continue;
      if (!arcoInVista(s, c, e, curv)) continue;
      aggiungiArco(ctx, s, c, e, curv);
    }
    // Gli archi del quartiere sono i pochi che meritano un filo più spesso:
    // sono l'oggetto dell'attenzione dell'utente.
    ctx.globalAlpha = alphaArco;
    ctx.strokeStyle = tinte.nodo;
    ctx.lineWidth = focus >= 0 ? 1.5 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Nodi — due passate per non cambiare globalAlpha a ogni nodo: prima i
    // spenti in filigrana, poi i pieni (e i loro anelli).
    if (focus >= 0) {
      ctx.globalAlpha = ALPHA_FONDO;
      for (let i = 0; i < s.n; i++) {
        if (i === focus || marca[i]) continue;
        const sx = s.x[i] * c.scala + c.tx;
        const sy = s.y[i] * c.scala + c.ty;
        const rS = s.raggio[i] * c.scala;
        if (sx < -rS - MARGINE_CULL || sx > W + rS + MARGINE_CULL || sy < -rS - MARGINE_CULL || sy > H + rS + MARGINE_CULL) continue;
        disegnaNodo(ctx, atlas, sx, sy, s.raggio[i], aperti.has(s.id[i]) ? "attivo" : "nodo");
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < s.n; i++) {
      if (focus >= 0 && i !== focus && !marca[i]) continue;
      const sx = s.x[i] * c.scala + c.tx;
      const sy = s.y[i] * c.scala + c.ty;
      const rS = s.raggio[i] * c.scala;
      if (sx < -rS - MARGINE_CULL || sx > W + rS + MARGINE_CULL || sy < -rS - MARGINE_CULL || sy > H + rS + MARGINE_CULL) continue;
      const acceso = aperti.has(s.id[i]);
      const ruolo: RuoloTinta = trascinato === i ? "attivo" : hovered === i ? "hover" : acceso ? "attivo" : "nodo";
      let alone: number | undefined;
      // L'alone pulsante dei nodi aperti: fase dall'hash dell'id, così i
      // vicini non pulsano in sincrono (sembra vivo, non un semaforo).
      if (acceso && conf.pulse && alpha > SOGLIA_PULSE) {
        const fase = ((fnv1a(s.id[i]) % 1000) / 1000) * Math.PI * 2;
        alone = 0.5 + 0.5 * Math.sin((tempoMs / 1000) * Math.PI * 2 * 1.2 + fase);
      }
      disegnaNodo(ctx, atlas, sx, sy, s.raggio[i], ruolo, alone);
      if (i === focus) {
        ctx.beginPath();
        ctx.arc(sx, sy, rS + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = trascinato === i ? tinte.attivo : tinte.hover;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (s.fisso[i] === 1) {
        // Un pin è un impegno dell'utente: un anello sottile lo rende
        // riconoscibile a colpo d'occhio senza gridare.
        ctx.beginPath();
        ctx.arc(sx, sy, rS + 2, 0, Math.PI * 2);
        ctx.strokeStyle = tinte.attivo;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Etichette: visibili per tier, grado o accento; alpha in fade con lo
    // zoom (a scala bassa il testo si accavalla e non si legge, quindi non
    // si disegna proprio).
    const soglia = 3 * (1 - conf.densitaEtichette) + 1;
    const fade = clamp((c.scala - 0.5) / 0.5, 0, 1);
    if (fade > 0.01) {
      const fontBase = `11px ${fontCorrente}`;
      const fontBold = `600 11px ${fontCorrente}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = tinte.testo;
      for (let i = 0; i < s.n; i++) {
        const accent = i === focus || aperti.has(s.id[i]);
        if (accent) continue;
        if (tier !== 1 && s.grado[i] < soglia) continue;
        const sx = s.x[i] * c.scala + c.tx;
        const sy = s.y[i] * c.scala + c.ty;
        const rS = s.raggio[i] * c.scala;
        if (sx < -MARGINE_CULL || sx > W + MARGINE_CULL || sy < -MARGINE_CULL || sy > H + MARGINE_CULL) continue;
        ctx.font = fontBase;
        const chiave = "n" + s.id[i];
        let larg = larghezze.get(chiave);
        if (larg === undefined) {
          larg = ctx.measureText(s.id[i]).width;
          larghezze.set(chiave, larg);
        }
        ctx.globalAlpha = fade * (focus >= 0 && i !== focus && !marca[i] ? 0.35 : 1);
        ctx.fillText(s.id[i], sx + rS + 5, sy);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < s.n; i++) {
        const accent = i === focus || aperti.has(s.id[i]);
        if (!accent) continue;
        const sx = s.x[i] * c.scala + c.tx;
        const sy = s.y[i] * c.scala + c.ty;
        const rS = s.raggio[i] * c.scala;
        if (sx < -MARGINE_CULL || sx > W + MARGINE_CULL || sy < -MARGINE_CULL || sy > H + MARGINE_CULL) continue;
        ctx.font = fontBold;
        const chiave = "b" + s.id[i];
        let larg = larghezze.get(chiave);
        if (larg === undefined) {
          larg = ctx.measureText(s.id[i]).width;
          larghezze.set(chiave, larg);
        }
        ctx.fillText(s.id[i], sx + rS + 5, sy);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Il cambio tema a caldo (bug 2-3): l'osservatore su `data-theme` rifà
  // tinte, atlas e disegno senza che nessuno debba ricordarsi di chiamare
  // `aggiornaTinte`. Più pittori (due riquadri) osservano lo stesso
  // documentElement senza conflitti: ognuno ricolora il proprio canvas.
  let osservatore: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    osservatore = new MutationObserver(() => aggiornaTinte());
    osservatore.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function distruggi(): void {
    osservatore?.disconnect();
    sfondo.remove();
    principale.remove();
  }

  return { ridisegna, ridisegnaSfondo, aggiornaTinte, ridimensiona, distruggi };
}
