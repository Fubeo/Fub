// La vista grafo del vault: renderer force-directed su Canvas.
//
// # Cosa è questo file, dalla §3.3
//
// **La metà shell di un componente che sta di là dal confine.** Il grafo è un
// `ViewProvider` (`crates/fub-features/src/graph.rs`): è lui a chiedere al
// canale dati quali documenti ci sono e quali archi li legano, e a mandarli qui
// dentro un `UiKind::Custom { ns: "fub:graph", payload }`. Questo file non parla
// con il kernel: riceve un payload e disegna.
//
// La divisione è quella che il §3.3 chiedeva, e la riga passa dove deve. `UiNode`
// non esprime un canvas, **né deve** — un protocollo dichiarativo che esprimesse
// un force-directed sarebbe un motore grafico travestito da enum — quindi il
// disegno resta di qua. Ciò che è passato di là sono i **dati**, che era la
// parte davvero privilegiata: finché a decidere nodi e archi era questo file, la
// vista a grafo era una cosa che solo la shell poteva fare.
//
// Di conseguenza questo modulo non è più un pannello e non ha più un overlay.
// Non si registra in `ui/panel-host.ts` — chi si registra è il pannello che
// `ui/views.ts` crea per il riquadro che ospita la view — e non sa **dove** sta
// disegnando: riceve un elemento, e quell'elemento è un riquadro dell'area
// principale, cioè una superficie con tab, che si divide e che si ricorda com'era.
//
// # La simulazione, che è la stessa di prima
//
// Il classico Fruchterman–Reingold ammorbidito: repulsione fra tutti i nodi,
// molla sugli archi, gravità verso il centro, attrito. Gira dentro
// requestAnimationFrame finché "raffredda", poi si ferma da sola: per un vault
// personale (centinaia di note) l'O(n²) della repulsione è ben sotto il frame
// budget, e la semplicità vale più di un quadtree.

import { pageName } from "../rules/organizer";
import { apriVistaIn, documenti, layout, pane, panes } from "../state/layout";
import { registerCustomRenderer, type OnAction } from "../ui/custom";
import { registerShellCommand } from "../ui/commands";
import { $ } from "../ui/dom";
import { t } from "../i18n/strings";

/// Il namespace con cui il grafo arriva dal provider. È `fub_features::graph::GRAPH_NS`,
/// e la costanza dei due nomi è il contratto fra le due metà del componente.
export const NS_GRAFO = "fub:graph";
/// L'id della `ViewSpec` che il provider dichiara (`fub_features::graph::GRAPH_VIEW`).
///
/// Che questo file lo conosca **non** è la conoscenza privata che il §1.2 ha
/// tolto ai pannelli: quella era la shell che sapeva quali pannelli esistono.
/// Questo è un componente che conosce il proprio altro capo — la stessa cosa che
/// fa già con lo `ns` — e i due nomi viaggiano insieme perché nominano lo stesso
/// componente.
export const VISTA_GRAFO = "graph";

/// L'azione con cui si chiede al provider di aprire una nota, e la chiave del
/// suo payload. Gemelle di `OPEN` e `DOC` in `graph.rs`.
const APRI = "open";
const DOC = "doc";

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /// Grado (entrante+uscente): dimensiona il nodo.
  degree: number;
  /// Etichetta e raggio: dipendono solo da `id` e `degree`, che non cambiano
  /// mai dopo il setup. Calcolarli qui una volta li toglie dal frame.
  label: string;
  r: number;
}

interface SimEdge {
  from: SimNode;
  to: SimNode;
}

/// Ciò che arriva nel `payload` del nodo custom. La forma la decide `graph.rs`,
/// e questo tipo è la sua lettura di qua: se le due divergono, il grafo si
/// disegna vuoto invece di lanciare — un payload storto viene da un provider, e
/// un provider può essere di terzi.
interface DatiGrafo {
  nodes: string[];
  edges: { from: string; to: string }[];
}

/// Attacca la metà shell del grafo: il renderer del suo `ns` e il comando che lo
/// apre.
export function mountGraph(): void {
  $("#show-graph").addEventListener("click", () => apriGrafo());

  // Il grafo come **comando** (§18.2): era un bottone nella barra, e chi non lo
  // trovava con il mouse non lo trovava. L'id e la scorciatoia sono quelli di
  // prima — chi li ha imparati li tiene — ed è cambiato cosa fa: apriva un
  // overlay sopra tutto, adesso apre una tab nel riquadro col fuoco. Che sia un
  // comando è la parte che la 0077 ha reso non negoziabile.
  registerShellCommand({
    id: "shell.graph",
    title: "commands.graph",
    description: "commands.graph.desc",
    run: () => apriGrafo(),
  });

  registerCustomRenderer(NS_GRAFO, disegnaGrafo);
}

/// Apre il grafo nel riquadro col fuoco.
///
/// **Nel riquadro col fuoco e non in uno nuovo**, che è la stessa regola con cui
/// si apre una nota dall'esploratore: chi lo vuole di lato divide prima, ed è un
/// gesto che ha già un comando suo (`shell.pane.split.right`). L'alternativa —
/// dividere da sé — deciderebbe al posto dell'utente come vuole la finestra, e
/// lo farebbe ogni volta.
///
/// Se la tab c'è già ci si sposta sopra: lo garantisce `apriVistaIn`, e per il
/// grafo conta più che per una nota — due tab sullo stesso grafo sarebbero due
/// simulazioni che girano insieme.
function apriGrafo(): void {
  apriVistaIn(layout.focus, VISTA_GRAFO);
}

/// I documenti aperti in un riquadro qualunque: sono i nodi che il grafo accende.
///
/// Erano **uno** — la nota attiva — e con N riquadri non lo sono più. Prenderne
/// uno solo vorrebbe dire scegliere fra due note che l'utente sta guardando
/// entrambe; e la nota «attiva» sarebbe per giunta `null` proprio mentre si
/// guarda il grafo, visto che il fuoco ce l'ha lui.
function apertiOra(): Set<string> {
  return new Set(
    panes().flatMap((id) => {
      const p = pane(id);
      return p ? documenti(p) : [];
    }),
  );
}

/// Legge il payload del provider, con la tolleranza che si deve a un dato che
/// viene da fuori.
function leggiDati(payload: unknown): DatiGrafo {
  const o = (payload ?? {}) as Partial<DatiGrafo>;
  const nodes = Array.isArray(o.nodes) ? o.nodes.filter((n) => typeof n === "string") : [];
  const edges = Array.isArray(o.edges)
    ? o.edges.filter(
        (e): e is { from: string; to: string } =>
          !!e && typeof e.from === "string" && typeof e.to === "string",
      )
    : [];
  return { nodes, edges };
}

/// Il renderer di `fub:graph`: disegna il grafo dentro `host` e restituisce come
/// spegnerlo.
function disegnaGrafo(host: HTMLElement, payload: unknown, onAction: OnAction): () => void {
  const data = leggiDati(payload);
  const aperti = apertiOra();

  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  // Quanto si sta guardando. Era il titolo della barra dell'overlay; l'overlay
  // non c'è più, e il conto sì — è l'unica cosa che dica se un grafo vuoto è un
  // vault vuoto o un guasto.
  const conto = document.createElement("div");
  conto.className = "graph-count";
  conto.textContent = t("graph.count", { note: data.nodes.length, archi: data.edges.length });
  host.replaceChildren(canvas, conto);

  let disposed = false;

  // I colori letti una volta sola: dentro `draw` costringevano il webview a un
  // ricalcolo di stile a ogni frame, che da solo mangiava più del disegno.
  //
  // Vengono dai token (§12.4) e non da tre esadecimali scritti qui. I tre di
  // prima — `#888`, `#7aa2f7`, `#9ece6a` — erano di una **terza** tavolozza, che
  // non era né quella della shell né quella del documento: il grafo era l'unica
  // superficie di Fub colorata da nessun tema, e un tema chiaro l'avrebbe
  // lasciata indietro senza che niente diventasse rosso.
  const stile = getComputedStyle(host);
  const ink = stile.color;
  const tinta = (nome: string) => stile.getPropertyValue(nome).trim() || ink;
  const nodo = tinta("--graph-node");
  const nodoAttivo = tinta("--graph-node-active");
  const nodoSotto = tinta("--graph-node-hover");
  const TAU = 2 * Math.PI;

  // La taglia non è più letta una volta: un riquadro si divide e si ridimensiona
  // sotto il grafo, e un canvas che non se ne accorge disegna in un rettangolo
  // che non c'è più. Nell'overlay questo non poteva succedere — era grande
  // quanto la finestra e si rifaceva a ogni apertura.
  let W = 1;
  let H = 1;
  const ctx = canvas.getContext("2d")!;

  function ridimensiona(): void {
    const rect = canvas.getBoundingClientRect();
    // Un riquadro nascosto (la tab non è davanti) misura zero: disegnarci
    // dentro non serve, e dividere per zero serve ancora meno.
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ridimensiona();

  const byId = new Map<string, SimNode>();
  // Semina deterministica su un cerchio: niente Math.random, così due
  // aperture consecutive dello stesso vault partono uguali.
  const nodes: SimNode[] = data.nodes.map((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, data.nodes.length);
    const r = Math.min(W, H) / 3;
    const node: SimNode = {
      id,
      x: W / 2 + r * Math.cos(angle),
      y: H / 2 + r * Math.sin(angle),
      vx: 0,
      vy: 0,
      degree: 0,
      label: pageName(id),
      r: 0,
    };
    byId.set(id, node);
    return node;
  });
  const edges: SimEdge[] = [];
  for (const e of data.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to || from === to) continue;
    from.degree++;
    to.degree++;
    edges.push({ from, to });
  }
  for (const n of nodes) n.r = 4 + Math.min(8, Math.sqrt(n.degree) * 1.6);

  // Distanza "comoda" fra nodi: l'area si spartisce fra i nodi presenti.
  const k = Math.sqrt((W * H) / Math.max(1, nodes.length)) * 0.7;
  const k2 = k * k;
  let alpha = 1;
  let hovered: SimNode | null = null;

  // Budget di frame. La repulsione è O(n²) e gira `ticks` volte per frame:
  // a numero fisso di tick un vault grosso sfora i 16 ms e il framerate
  // crolla. Qui i tick si adattano alla taglia del grafo, e il
  // raffreddamento si riscala su di essi — meno passi per frame non
  // significa aspettare di più: la simulazione dura uguale in secondi, solo
  // spalmata su più frame, ciascuno dentro il budget.
  const pairs = (nodes.length * Math.max(0, nodes.length - 1)) / 2;
  const ticks = Math.max(1, Math.min(3, Math.floor(150_000 / Math.max(1, pairs))));
  const cool = Math.pow(0.985, 3 / ticks);

  function tick() {
    // Repulsione fra tutte le coppie.
    const len = nodes.length;
    const rep = k2 * alpha;
    for (let i = 0; i < len; i++) {
      const a = nodes[i];
      // Velocità di `a` accumulata in locali: il campo si rilegge n volte
      // per giro, e nel loop interno solo `b` viene toccato.
      let ax = a.vx;
      let ay = a.vy;
      const px = a.x;
      const py = a.y;
      for (let j = i + 1; j < len; j++) {
        const b = nodes[j];
        let dx = px - b.x;
        let dy = py - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Coincidenti: separali lungo una direzione qualsiasi ma stabile.
          dx = 0.5 + (i % 3) * 0.1;
          dy = 0.5 - (j % 3) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        // (k²/d²)·α applicato al versore dx/d: una sola sqrt e una sola
        // divisione per coppia invece di quattro.
        const f = rep / (d2 * Math.sqrt(d2));
        const fx = dx * f;
        const fy = dy * f;
        ax += fx;
        ay += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      a.vx = ax;
      a.vy = ay;
    }
    // Molla sugli archi.
    for (const { from, to } of edges) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = ((d - k) / d) * 0.1 * alpha;
      from.vx += dx * f;
      from.vy += dy * f;
      to.vx -= dx * f;
      to.vy -= dy * f;
    }
    // Gravità verso il centro + attrito + integrazione.
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.005 * alpha;
      n.vy += (H / 2 - n.y) * 0.005 * alpha;
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
      // Dentro i bordi, con un margine per l'etichetta.
      n.x = Math.max(20, Math.min(W - 20, n.x));
      n.y = Math.max(20, Math.min(H - 20, n.y));
    }
    alpha *= cool;
  }

  // Etichetta su tutti i nodi solo se il grafo è piccolo: sopra, resta
  // leggibile solo mostrando i nodi grossi e quelli accesi.
  const etichettaOvunque = nodes.length <= 30;

  // Il disegno è tutto in batch: gli archi in un path solo, i nodi spenti in
  // un path solo, le etichette a font impostato una volta. Su canvas — e in
  // un webview senza accelerazione ancora di più — a costare non è il numero
  // di segmenti ma il numero di chiamate di stroke/fill e di cambi di stato.
  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { from, to } of edges) {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();

    // Nodi spenti: un fill solo. Il `moveTo` prima di ogni arco evita che i
    // cerchi si colleghino fra loro dentro il path.
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = nodo;
    ctx.beginPath();
    for (const n of nodes) {
      if (n === hovered || aperti.has(n.id)) continue;
      ctx.moveTo(n.x + n.r, n.y);
      ctx.arc(n.x, n.y, n.r, 0, TAU);
    }
    ctx.fill();

    // Accesi: le note aperte in qualche riquadro, più quella sotto il mouse.
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      const attivo = aperti.has(n.id);
      if (!attivo && n !== hovered) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fillStyle = attivo ? nodoAttivo : nodoSotto;
      ctx.fill();
    }

    // Etichette: sempre per i nodi grossi o accesi, così il grafo resta
    // leggibile senza diventare una nuvola di testo.
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.7;
    ctx.font = "11px sans-serif";
    for (const n of nodes) {
      if (n === hovered || aperti.has(n.id)) continue;
      if (!etichettaOvunque && n.degree < 3) continue;
      ctx.fillText(n.label, n.x + n.r + 3, n.y + 4);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 12px sans-serif";
    for (const n of nodes) {
      if (n !== hovered && !aperti.has(n.id)) continue;
      ctx.fillText(n.label, n.x + n.r + 3, n.y + 4);
    }
  }

  function frame() {
    if (disposed) return;
    if (alpha > 0.02) {
      // Più tick per frame quando il grafo è piccolo: la simulazione
      // converge in fretta senza che il disegno insegua ogni passo.
      for (let t = 0; t < ticks; t++) tick();
      requestAnimationFrame(frame);
    }
    draw();
  }
  requestAnimationFrame(frame);

  // Il riquadro è cambiato di taglia (una divisione, la finestra, la sidebar
  // che si apre): si ridisegna nel rettangolo nuovo senza far ripartire la
  // simulazione — i nodi sono già dove vanno, cambia solo dove si guarda.
  const osservatore = new ResizeObserver(() => {
    if (disposed) return;
    ridimensiona();
    draw();
  });
  osservatore.observe(canvas);

  function nodeAt(e: MouseEvent): SimNode | null {
    const box = canvas.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < n.r + 6 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  canvas.addEventListener("mousemove", (e) => {
    const over = nodeAt(e);
    if (over !== hovered) {
      hovered = over;
      canvas.style.cursor = over ? "pointer" : "default";
      draw();
    }
  });
  // Il click torna al **provider**, che risponde `ViewUpdate::Navigate`. Prima
  // era una chiamata diretta a chi apre i documenti, iniettata per non
  // importarsi a vicenda con `panels/document`; adesso è la stessa porta di ogni
  // altra azione di view, e quell'iniezione è sparita con lei.
  canvas.addEventListener("click", (e) => {
    const n = nodeAt(e);
    if (!n) return;
    onAction({ action: APRI, payload: { [DOC]: n.id } }, []);
  });

  return () => {
    disposed = true;
    osservatore.disconnect();
  };
}
