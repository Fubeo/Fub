// I livelli di dettaglio della lavagna (N6 T54, A-22): da lontano la lavagna
// si legge ancora.
//
// - da `LIVE_ZOOM_MIN` (0,35) in su la scheda è come sempre (`live`): le
//   schede vive le sceglie `liveCardIds` di `cards.ts`, qui non si tocca;
// - fra `BLOCK_ZOOM_MAX` (0,15) e 0,35 (`far`) una scheda vista da vicino in
//   questa seduta mostra l'ultima immagine ferma che ha avuto (`still`), le
//   altre il titolo grande;
// - sotto 0,15 (`block`) ogni scheda è un blocco del suo colore col titolo.
//
// La tela mette il risultato in `data-card-detail` sul nodo, a fine gesto e
// solo dove cambia (`applyCardDetails`); il resto lo fa il CSS. Il titolo
// grande (`.canvas-node-far`) c'è sempre nel nodo, nascosto, e la sua misura
// sullo schermo non cambia con lo zoom: la pelle divide per
// `--canvas-detail-zoom`, che la tela scrive anche lei a fine gesto, così
// durante il gesto niente si rimpagina.
//
// Qui niente DOM vivo oltre agli attributi: funzioni pure che la tela e i
// test usano senza montare niente. La pagina di riferimento è
// `docs/reference/canvas-cards.md`.

import { LIVE_ZOOM_MIN } from "./cards";
import type { CanvasNode } from "./model";

/// Il livello di dettaglio di uno zoom.
export type DetailLevel = "live" | "far" | "block";

/// Il valore di `data-card-detail` su una scheda; `null` toglie l'attributo.
export type CardDetail = "still" | "far" | "block";

/// Sotto questo zoom la scheda è vista da lontano: lo stesso di
/// `LIVE_ZOOM_MIN`, la soglia delle schede vive, perché una scheda viva non
/// sia mai anche lontana.
export const FAR_ZOOM_MAX = LIVE_ZOOM_MIN;
/// Sotto questo zoom ogni scheda è un blocco del suo colore.
export const BLOCK_ZOOM_MAX = 0.15;

/// Il livello dello zoom `zoom`: le soglie sono incluse nel livello di sopra
/// (0,35 è `live`, 0,15 è `far`). Uno zoom che non è un numero finito
/// positivo resta `live`: la scheda si mostra com'è.
export function detailLevel(zoom: number): DetailLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) return "live";
  if (zoom >= FAR_ZOOM_MAX) return "live";
  if (zoom >= BLOCK_ZOOM_MAX) return "far";
  return "block";
}

/// L'attributo di una scheda al livello `level`. `seen`: la scheda ha avuto
/// un'immagine ferma in questa seduta (è stata viva). `keepLive`: la scheda
/// resta come da vicino a ogni livello (quella attiva, quella che scrive).
export function cardDetail(level: DetailLevel, seen: boolean, keepLive = false): CardDetail | null {
  if (keepLive || level === "live") return null;
  if (level === "block") return "block";
  return seen ? "still" : "far";
}

/// Il titolo grande di una scheda: il nome del file senza cartella (con la
/// sezione, se ne mostra una), l'indirizzo senza `https://`, la prima riga
/// scritta di un testo senza i segni di titolo, il nome di un gruppo. Una
/// scheda senza niente da dire ha il titolo vuoto: il CSS taglia quelli
/// lunghi.
export function farTitle(node: CanvasNode): string {
  switch (node.type) {
    case "file": {
      const file = typeof node.file === "string" ? node.file : "";
      const name = file.split("/").pop() ?? "";
      const subpath = typeof node.subpath === "string" ? node.subpath.replace(/^#+/, "") : "";
      if (name === "") return node.id;
      return subpath === "" ? name : `${name} › ${subpath.replace(/#/g, " › ")}`;
    }
    case "link": {
      const url = typeof node.url === "string" ? node.url : "";
      return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/$/, "") || node.id;
    }
    case "text":
      return firstLine(typeof node.text === "string" ? node.text : "");
    case "group":
      return typeof node.label === "string" ? node.label.trim() : "";
  }
}

/// La prima riga non vuota, senza `#` di titolo, `>` di citazione e segni di
/// elenco davanti.
function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?)/, "").trim();
    if (line !== "") return line;
  }
  return "";
}

/// Una scheda come la legge `applyCardDetails`: il suo nodo nel DOM e
/// l'attributo che ha adesso (tenuto dalla tela, per non leggere il DOM).
export interface DetailTarget {
  readonly article: HTMLElement;
  detail: CardDetail | null;
}

/// Mette a ogni scheda l'attributo `detailOf(id)`, scrivendo il DOM solo
/// dove cambia. Ritorna quante schede sono cambiate.
export function applyCardDetails(
  targets: Iterable<readonly [string, DetailTarget]>,
  detailOf: (id: string) => CardDetail | null,
): number {
  let changed = 0;
  for (const [id, target] of targets) {
    const next = detailOf(id);
    if (target.detail === next) continue;
    target.detail = next;
    if (next === null) delete target.article.dataset.cardDetail;
    else target.article.dataset.cardDetail = next;
    changed++;
  }
  return changed;
}
