// Il posto libero più vicino a un punto, per una scheda che nasce senza un
// punto scelto da chi usa: «Aggiungi testo» della barra o del menu, «Scrivi una
// scheda» della lavagna vuota (IMP-042). La scheda non deve coprirne un'altra:
// si cerca a giri sempre più larghi intorno al posto voluto, e vince il posto
// libero più vicino del primo giro che ne ha uno.
//
// Solo funzioni pure, senza DOM.

/** Un riquadro della lavagna, in unità della lavagna. */
export interface SpotBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Una scheda che può fare da ostacolo: i gruppi no, una scheda ci nasce dentro. */
export interface SpotObstacle extends SpotBox {
  readonly type: string;
}

/// Il passo fra un posto provato e il successivo, in unità della lavagna:
/// cinque volte la griglia di 8, così il posto resta sulla griglia.
export const FREE_SPOT_STEP = 40;

/// Quanti giri si provano intorno al posto voluto: 20 giri da 40 sono 800
/// unità per lato, più di una vista intera a zoom 1.
export const FREE_SPOT_RINGS = 20;

/// Lo spazio che resta fra la scheda nuova e quelle che ha intorno.
export const FREE_SPOT_GAP = 16;

/**
 * Il posto per un riquadro `box` (la misura e il posto voluto, di solito al
 * centro della vista) che non tocca nessuna scheda di `nodes` (i gruppi
 * esclusi), con `FREE_SPOT_GAP` di spazio intorno: il posto voluto se è
 * libero, se no il più vicino al centro del primo giro che ne ha uno. Se in
 * `FREE_SPOT_RINGS` giri non c'è posto, il posto voluto: sopra un'altra scheda
 * è meglio che lontano dalla vista.
 */
export function nearFreeSpot(nodes: readonly SpotObstacle[], box: SpotBox): SpotBox {
  const reach = FREE_SPOT_STEP * FREE_SPOT_RINGS + FREE_SPOT_GAP;
  // Solo le schede che un posto provato può toccare: su una lavagna grande le
  // altre non contano, e il conto resta piccolo.
  const near = nodes.filter((node) => node.type !== "group"
    && node.x < box.x + box.width + reach && box.x - reach < node.x + node.width
    && node.y < box.y + box.height + reach && box.y - reach < node.y + node.height);
  const free = (x: number, y: number): boolean => near.every((node) =>
    node.x >= x + box.width + FREE_SPOT_GAP || x >= node.x + node.width + FREE_SPOT_GAP
    || node.y >= y + box.height + FREE_SPOT_GAP || y >= node.y + node.height + FREE_SPOT_GAP);
  if (free(box.x, box.y)) return box;
  for (let ring = 1; ring <= FREE_SPOT_RINGS; ring++) {
    let best: { x: number; y: number; distance: number } | null = null;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        // Solo il bordo del giro: l'interno l'hanno già provato i giri prima.
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = box.x + i * FREE_SPOT_STEP;
        const y = box.y + j * FREE_SPOT_STEP;
        // A parità di distanza vince il primo trovato: a sinistra, poi in alto.
        const distance = i * i + j * j;
        if ((best === null || distance < best.distance) && free(x, y)) best = { x, y, distance };
      }
    }
    if (best) return { x: best.x, y: best.y, width: box.width, height: box.height };
  }
  return box;
}
