// Il grafo scaldato prima della prima apertura.
//
// La prima apertura del grafo in una sessione bloccava la pagina ~140 ms
// (WebView vera, CPU scarica): il codice del motore era nuovo per il
// compilatore JS, l'atlas dei nodi si cuoceva lì, e soprattutto la WebView
// compilava al primo uso le procedure di disegno del canvas (gradienti
// radiali, `drawImage` dall'atlas, curve, testo con contorno): un fotogramma
// da 50 ms di script e uno da ~90 di pittura. La seconda apertura costava un
// fotogramma normale.
//
// Qui, a riposo (`ui/warmup.ts`), la stessa strada gira una volta su un grafo
// minuscolo e invisibile: prima l'atlas con i colori del tema (`atlasFor`, che
// il pittore vero poi riprende), poi, al passo dopo, un grafico vero montato
// su un host fuori vista per qualche fotogramma. Il grafico non tocca i dati
// dell'utente né salva niente: niente layout ricordato, nessuna azione; l'host
// è `inert`, `aria-hidden`, trasparente e senza puntatore.
import { createChart } from "./chart";
import { loadConfig } from "./config";
import { RADIUS_BUCKETS, atlasFor, readTints } from "./render/atlas";
import type { GraphData } from "./sim/types";

/// Il grafo d'esercizio: abbastanza nodi e archi per passare da nodi, archi,
/// etichette e alberi della simulazione, abbastanza pochi da costare poco.
export function warmupData(): GraphData {
  const nodes = Array.from({ length: 16 }, (_, i) => `n${i}`);
  const edges = nodes.slice(1).map((to, i) => ({ from: nodes[Math.floor(i / 3)]!, to }));
  return { nodes, edges };
}

/// Quanti fotogrammi il grafico d'esercizio resta montato: il primo monta e
/// disegna, i successivi pagano la pittura e il passo di simulazione a regime.
export const WARMUP_FRAMES = 3;

/// L'host fuori vista: dentro la pagina perché il canvas si dipinga davvero
/// (un canvas staccato non compila niente), ma invisibile (`.graph-warmup`) e
/// irraggiungibile.
export function warmupHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "graph-warmup";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  // Dove sta e che non si vede lo dice `.graph-warmup` in
  // `theme/scrittoio/structure.css`, una garanzia che nessun tema revoca: in
  // linea, un `opacity` è una proprietà del moto lasciata sull'elemento.
  return host;
}

export interface WarmGraphOptions {
  /// Per i test: il fotogramma (predefinito `requestAnimationFrame`).
  readonly frame?: (run: () => void) => void;
}

/// Scalda la prima apertura del grafo: due passi, ciascuno dopo `next()`.
/// L'host esce dalla pagina e il grafico si smonta anche se un passo rifiuta.
export async function warmGraph(next: () => Promise<void>, options: WarmGraphOptions = {}): Promise<void> {
  let pendingFrame: number | null = null;
  const frame =
    options.frame ??
    ((run: () => void) => {
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        run();
      });
    });
  await next();
  const host = warmupHost();
  document.body.append(host);
  try {
    atlasFor(readTints(host), RADIUS_BUCKETS);
    await next();
    const chart = createChart({ data: warmupData(), config: loadConfig() });
    try {
      // Il grafico scrive il suo `position` sull'elemento dove si monta: si
      // monta in un figlio, e l'host resta com'è (fisso, senza stile in linea).
      const stage = document.createElement("div");
      stage.className = "graph-warmup-stage";
      host.append(stage);
      chart.mount(stage);
      for (let i = 0; i < WARMUP_FRAMES; i++) await new Promise<void>((resolve) => frame(resolve));
    } finally {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      chart.unmount();
    }
  } finally {
    host.remove();
  }
}
