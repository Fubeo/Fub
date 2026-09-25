// La memoria del layout fra un montaggio e l'altro. Il grafo si rimonta spesso
// — si torna alla sua linguetta, si cambia colore o filtro dalla barra, si
// aggiorna dopo una modifica al vault — e ogni volta ripartiva dalla semina:
// la stessa animazione di tre secondi, la vista reinquadrata, i pin persi.
// Qui si fotografano posizioni, pin, temperatura e inquadratura allo
// smontaggio, e al montaggio dopo si rimettono se il grafo è ancora «lo
// stesso». La memoria è della shell e vive in RAM: il layout visuale non è un
// dato del vault (§ Graph View di `../../../../docs/product/search-links-and-graph.md`).
//
// Pure: niente DOM, niente camera viva. Il grafico decide quando fotografare
// e cosa fare della vista ritrovata.

import { fnv1a } from "./types";
import type { Structure } from "./types";

export interface SavedLayout {
  /// Posizione di mondo per id.
  positions: Map<string, [number, number]>;
  /// Gli id bloccati con un pin esplicito (non il trascinato).
  pinned: Set<string>;
  /// La temperatura della simulazione: un grafo lasciato a metà
  /// assestamento riprende da lì invece di congelarsi.
  alpha: number;
  /// L'inquadratura: scala e punto di mondo al centro della vista, così
  /// resta giusta anche se il riquadro ha cambiato misura.
  camera: { scale: number; centerX: number; centerY: number } | null;
  /// La vista stava ancora seguendo il grafo che si distende (l'utente non
  /// l'aveva presa): se sì, continua a seguirlo.
  following: boolean;
}

/// Quanto i due grafi devono coincidere perché il layout si riprenda: la
/// quota di nodi nuovi già noti **e** la quota dei noti ancora presenti.
/// Passare dal grafo intero a quello locale di una nota (o viceversa) non
/// supera la soglia, e riparte dalla semina: le posizioni di un grafo di
/// duemila nodi, sparse, non servono a uno di sei.
export const RESTORE_OVERLAP = 0.6;

export function snapshotLayout(
  s: Structure,
  alpha: number,
  camera: SavedLayout["camera"],
  following: boolean,
): SavedLayout {
  const positions = new Map<string, [number, number]>();
  const pinned = new Set<string>();
  for (let i = 0; i < s.n; i++) {
    positions.set(s.id[i], [s.x[i], s.y[i]]);
    if (s.fixed[i] === 1) pinned.add(s.id[i]);
  }
  return { positions, pinned, alpha, camera, following };
}

/// Rimette nella struttura appena seminata le posizioni ricordate. Ritorna
/// quanti nodi erano nuovi, o `null` se i due grafi coincidono troppo poco e
/// il layout va rifatto da capo (la struttura resta com'era).
///
/// I nodi nuovi nascono vicino ai loro vicini già piazzati, con uno scarto
/// deterministico perché due fratelli non partano uno sopra l'altro; quelli
/// senza vicini noti su un anello appena fuori dal grafo, dove la repulsione
/// li porterebbe comunque.
export function restoreLayout(s: Structure, saved: SavedLayout, spacing: number): number | null {
  let known = 0;
  for (let i = 0; i < s.n; i++) if (saved.positions.has(s.id[i])) known++;
  if (known === 0 || known < RESTORE_OVERLAP * s.n || known < RESTORE_OVERLAP * saved.positions.size) return null;

  const placed = new Uint8Array(s.n);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < s.n; i++) {
    const p = saved.positions.get(s.id[i]);
    if (!p) continue;
    s.x[i] = p[0];
    s.y[i] = p[1];
    s.fixed[i] = saved.pinned.has(s.id[i]) ? 1 : 0;
    placed[i] = 1;
    cx += p[0];
    cy += p[1];
  }
  cx /= known;
  cy /= known;
  let reach = 0;
  for (let i = 0; i < s.n; i++) {
    if (placed[i]) reach = Math.max(reach, Math.hypot(s.x[i] - cx, s.y[i] - cy));
  }

  const sumX = new Float64Array(s.n);
  const sumY = new Float64Array(s.n);
  const count = new Uint32Array(s.n);
  for (let e = 0; e < s.m; e++) {
    const a = s.from[e];
    const b = s.to[e];
    if (placed[a] && !placed[b]) {
      sumX[b] += s.x[a];
      sumY[b] += s.y[a];
      count[b]++;
    } else if (placed[b] && !placed[a]) {
      sumX[a] += s.x[b];
      sumY[a] += s.y[b];
      count[a]++;
    }
  }
  let added = 0;
  for (let i = 0; i < s.n; i++) {
    if (placed[i]) continue;
    added++;
    const angle = ((fnv1a(s.id[i]) % 3600) / 3600) * Math.PI * 2;
    if (count[i] > 0) {
      const r = spacing * 0.5;
      s.x[i] = sumX[i] / count[i] + r * Math.cos(angle);
      s.y[i] = sumY[i] / count[i] + r * Math.sin(angle);
    } else {
      const r = reach + spacing;
      s.x[i] = cx + r * Math.cos(angle);
      s.y[i] = cy + r * Math.sin(angle);
    }
  }
  return added;
}
