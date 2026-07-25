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

import { api } from "./api";
import { pageName } from "./organizer";

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /// Grado (entrante+uscente): dimensiona il nodo.
  degree: number;
}

interface SimEdge {
  from: SimNode;
  to: SimNode;
}

/// Apre l'overlay del grafo. `current` evidenzia la nota aperta;
/// `onOpenNote` è il click su un nodo (apri la nota e chiudi l'overlay).
export async function openGraph(
  current: string | null,
  onOpenNote: (id: string) => void,
): Promise<void> {
  document.getElementById("graph-overlay")?.remove();

  const data = await api.graphData();

  const overlay = document.createElement("div");
  overlay.id = "graph-overlay";

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

  // Distanza "comoda" fra nodi: l'area si spartisce fra i nodi presenti.
  const k = Math.sqrt((W * H) / Math.max(1, nodes.length)) * 0.7;
  let alpha = 1;
  let hovered: SimNode | null = null;

  function tick() {
    // Repulsione fra tutte le coppie.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Coincidenti: separali lungo una direzione qualsiasi ma stabile.
          dx = 0.5 + (i % 3) * 0.1;
          dy = 0.5 - (j % 3) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = ((k * k) / d2) * alpha;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
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
    alpha *= 0.985;
  }

  function radius(n: SimNode): number {
    return 4 + Math.min(8, Math.sqrt(n.degree) * 1.6);
  }

  function draw() {
    const styles = getComputedStyle(overlay);
    const ink = styles.color;
    ctx.clearRect(0, 0, W, H);

    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    for (const { from, to } of edges) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const attivo = n.id === current;
      const acceso = n === hovered || attivo;
      ctx.globalAlpha = acceso ? 1 : 0.8;
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius(n), 0, 2 * Math.PI);
      ctx.fillStyle = attivo ? "#7aa2f7" : acceso ? "#9ece6a" : "#888";
      ctx.fill();

      // Etichette: sempre per i nodi grossi o accesi, così il grafo resta
      // leggibile senza diventare una nuvola di testo.
      if (acceso || n.degree >= 3 || nodes.length <= 30) {
        ctx.globalAlpha = acceso ? 1 : 0.7;
        ctx.fillStyle = ink;
        ctx.font = acceso ? "bold 12px sans-serif" : "11px sans-serif";
        ctx.fillText(pageName(n.id), n.x + radius(n) + 3, n.y + 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (disposed) return;
    if (alpha > 0.02) {
      // Più tick per frame: la simulazione converge in fretta senza che il
      // disegno debba inseguire ogni singolo passo.
      tick();
      tick();
      tick();
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
      if (d < radius(n) + 6 && d < bestD) {
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
    onOpenNote(n.id);
  });
}
