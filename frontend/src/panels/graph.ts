// La vista grafo del vault: renderer force-directed su Canvas.
//
// È l'unica view FUORI dal protocollo dichiarativo (`UiNode` non esprime un
// canvas, né deve): dal backend arriva solo DATO — nodi e archi, comando
// `graph_data` — e tutto il disegno vive qui. Superficie privilegiata
// dichiarata nel piano M2.
//
// La simulazione è il classico Fruchterman–Reingold ammorbidito: repulsione
// fra tutti i nodi, molla sugli archi, gravità verso il centro, attrito. Gira
// dentro requestAnimationFrame finché "raffredda", poi si ferma da sola: per
// un vault personale (centinaia di note) l'O(n²) della repulsione è ben sotto
// il frame budget, e la semplicità vale più di un quadtree.

import { OGNI_DOCUMENTO } from "../host/contract";
import { archiDelVault, documentiCheCombaciano } from "../host/query";
import { pageName } from "../rules/organizer";
import { state } from "../state/store";
import { $ } from "../ui/dom";
import { refreshOn, registerPanel } from "../ui/panel-host";

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

/// Ciò che il grafo chiede alla shell: il click su un nodo apre quella nota.
/// Iniettato invece che importato, come per l'anteprima e il pannello del
/// documento — `panels/document` importa a sua volta ciò che sta di qua.
interface GraphHost {
  openNote: (id: string) => void;
}

let host: GraphHost | null = null;

const OVERLAY_ID = "graph-overlay";

export function mountGraph(h: GraphHost): void {
  host = h;
  $("#show-graph").addEventListener("click", () => void openGraph());

  // Il grafo è un pannello come gli altri per ciò che riguarda **chi lo
  // conosce** — sta nell'inventario, dichiara dove sta e quando invecchia —
  // e resta un'eccezione decisa per ciò che riguarda **cosa disegna**:
  // `UiNode` non esprime un canvas, né deve (piano M2, §2.2).
  //
  // `refresh` vuoto non è una dimenticanza: il grafo si rilegge all'apertura,
  // e ridisegnarlo a ogni salvataggio significherebbe far ripartire la
  // simulazione sotto il mouse di chi lo sta guardando. L'unico caso in cui
  // riparte è `overflow`, dove la coda è stata troncata e il dato in mano
  // potrebbe essere di un vault che non esiste più.
  registerPanel({
    id: "shell:graph",
    title: "Grafo",
    placement: "overlay",
    refresh: refreshOn(),
    visible: () => document.getElementById(OVERLAY_ID) !== null,
    render: openGraph,
  });
}

/// Apre l'overlay del grafo (o lo rifà da capo, se è già aperto). La nota
/// aperta è evidenziata.
export async function openGraph(): Promise<void> {
  if (!host) return;
  const { openNote } = host;
  const current = state.currentDoc;

  document.getElementById(OVERLAY_ID)?.remove();

  // Due domande al canale dati, con le stesse capacità che avrà una vista a
  // grafo di terzi: i nodi sono i documenti che combaciano con «tutti», gli
  // archi i vicini a un passo di ognuno. Prima era un comando dell'app che
  // prendeva gli archi una nota alla volta — cioè una superficie privilegiata,
  // che è la definizione del §5.4.
  const [documenti, archi] = await Promise.all([
    documentiCheCombaciano(OGNI_DOCUMENTO),
    archiDelVault(),
  ]);
  const data = {
    nodes: documenti.items.map((d) => d.doc),
    // Deduplicati: la molteplicità di un link non disegna nulla.
    edges: [...new Set(archi.map((n) => `${n.via}\u0000${n.doc}`))].map((k) => {
      const [from, to] = k.split("\u0000");
      return { from, to };
    }),
  };

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;

  const bar = document.createElement("div");
  bar.className = "graph-bar";
  const title = document.createElement("span");
  title.className = "panel-title";
  title.textContent = `Grafo — ${data.nodes.length} not${data.nodes.length === 1 ? "a" : "e"}, ${
    data.edges.length
  } collegament${data.edges.length === 1 ? "o" : "i"}`;
  const close = document.createElement("button");
  close.className = "link-button";
  close.textContent = "Chiudi";
  bar.append(title, close);

  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  overlay.append(bar, canvas);
  document.body.appendChild(overlay);

  let disposed = false;
  const dispose = () => {
    disposed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dispose();
  };
  close.addEventListener("click", dispose);
  document.addEventListener("keydown", onKey);

  // --- stato della simulazione ---------------------------------------------

  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  // Colore d'inchiostro letto una volta sola: dentro `draw` costringeva il
  // webview a un ricalcolo di stile a ogni frame, che da solo mangiava più
  // del disegno. L'overlay si ricrea a ogni apertura, quindi un cambio di
  // tema viene comunque raccolto.
  const ink = getComputedStyle(overlay).color;
  const TAU = 2 * Math.PI;

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
    ctx.fillStyle = "#888";
    ctx.beginPath();
    for (const n of nodes) {
      if (n === hovered || n.id === current) continue;
      ctx.moveTo(n.x + n.r, n.y);
      ctx.arc(n.x, n.y, n.r, 0, TAU);
    }
    ctx.fill();

    // Accesi: al più due (la nota aperta e quella sotto il mouse).
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      const attivo = n.id === current;
      if (!attivo && n !== hovered) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fillStyle = attivo ? "#7aa2f7" : "#9ece6a";
      ctx.fill();
    }

    // Etichette: sempre per i nodi grossi o accesi, così il grafo resta
    // leggibile senza diventare una nuvola di testo.
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.7;
    ctx.font = "11px sans-serif";
    for (const n of nodes) {
      if (n === hovered || n.id === current) continue;
      if (!etichettaOvunque && n.degree < 3) continue;
      ctx.fillText(n.label, n.x + n.r + 3, n.y + 4);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 12px sans-serif";
    for (const n of nodes) {
      if (n !== hovered && n.id !== current) continue;
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
  canvas.addEventListener("click", (e) => {
    const n = nodeAt(e);
    if (!n) return;
    dispose();
    openNote(n.id);
  });
}
