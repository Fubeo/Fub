// Il cursore dentro la formula disegnata (T60, E27). Non c'è un secondo motore:
// la formula che si modifica la disegna KaTeX, come quella che si legge. Per il
// riquadro di modifica, e solo per lui, in ogni punto buono si mette un segno
// invisibile, `\htmlData{fubp=<offset>}{}`: KaTeX lo scrive come un `span`
// vuoto con `data-fubp`, che serve a disegnare il cursore e a capire dove cade
// un clic. Nel file non entra niente.
//
// La fiducia di KaTeX resta ristretta: soltanto `\htmlData`, e soltanto coi
// nomi `data-fub…` di questi segni. Un `\htmlData` scritto nella formula da chi
// la scrive resta senza fiducia, come nella resa di lettura.
import type { KatexOptions } from "katex";
import { readOptions } from "../math";
import { holesOf, mapFormula, placeAt } from "./points";

/// L'attributo dei segni: `data-fubp`, l'offset del punto nel TeX.
export const POINT_ATTRIBUTE = "data-fubp";
/// Uno spazio vuoto (`{}`): il quadretto che si riempie.
export const HOLE_ATTRIBUTE = "data-fubhole";
/// Il comando che si sta scrivendo, in una pastiglia finché non è finito.
export const PENDING_ATTRIBUTE = "data-fubcmd";

/// Le regole di KaTeX del riquadro di modifica: quelle della lettura, con la
/// fiducia ai soli segni del cursore.
export function editOptions(display: boolean): KatexOptions {
  return {
    ...readOptions(display),
    strict: (code: string) => (code === "htmlExtension" ? "ignore" : "error"),
    trust: (context) => context.command === "\\htmlData"
      && Object.keys(context.attributes).every((name) => name.startsWith("data-fub")),
  };
}

/// Il TeX col segno in ogni punto buono. `pending`, se c'è, è il comando che
/// si sta scrivendo (dalla `\` al cursore): si disegna come testo, perché a
/// metà non si legge.
export function instrument(tex: string, pending: { from: number; to: number } | null = null): string {
  const map = mapFormula(tex);
  const holes = new Set(holesOf(map));
  type Mark = { at: number; remove: number; insert: string };
  const marks: Mark[] = [];
  const points = map.points.map((point) => point.at);
  // A metà di un comando il cursore sta in fondo alla pastiglia, anche dove
  // la lettura dei punti (che vede il comando incollato a ciò che segue) non
  // ne mette uno.
  if (pending && !points.includes(pending.to)) points.push(pending.to);
  for (const at of points) {
    if (pending && at > pending.from && at < pending.to) continue;
    const point = { at };
    const hole = holes.has(point.at);
    // Un quadretto in matematica; nel testo `\square` non si può, e il
    // quadretto lo disegna la pelle sul segno vuoto.
    const body = hole && placeAt(map, point.at).role !== "text" ? "\\square" : "";
    marks.push({ at: point.at, remove: 0, insert: `\\htmlData{fubp=${point.at}${hole ? ",fubhole=1" : ""}}{${body}}` });
  }
  if (pending) {
    const name = tex.slice(pending.from + 1, pending.to);
    marks.push({ at: pending.from, remove: pending.to - pending.from, insert: `\\htmlData{fubcmd=1}{\\text{\\textbackslash ${name}}}` });
  }
  // Dalla fine, così gli offset dei segni prima restano buoni; in uno stesso
  // punto il segno del cursore va prima del comando in sospeso.
  marks.sort((a, b) => b.at - a.at || b.remove - a.remove);
  let out = tex;
  for (const mark of marks) out = out.slice(0, mark.at) + mark.insert + out.slice(mark.at + mark.remove);
  return out;
}

/// Un segno disegnato: il suo offset e il suo rettangolo nella finestra.
export interface Marker {
  readonly at: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

/// I segni disegnati dentro `root`.
export function markersIn(root: ParentNode): Marker[] {
  const out: Marker[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(`[${POINT_ATTRIBUTE}]`)) {
    const at = Number(element.getAttribute(POINT_ATTRIBUTE));
    if (!Number.isSafeInteger(at)) continue;
    const box = element.getBoundingClientRect();
    out.push({ at, left: box.left, top: box.top, bottom: box.bottom });
  }
  return out;
}

/// Il segno di un punto, se è disegnato.
export function markerElement(root: ParentNode, at: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${POINT_ATTRIBUTE}="${at}"]`);
}

/// Il punto più vicino a un clic. Fra sopra e sotto (numeratore e
/// denominatore, base ed esponente) decide l'altezza: un segno alla stessa
/// altezza del clic vince su uno più vicino in orizzontale ma più su o più giù.
export function nearestPoint(markers: readonly Marker[], x: number, y: number): number | null {
  let best: number | null = null;
  let distance = Infinity;
  for (const marker of markers) {
    const inside = y >= marker.top - 2 && y <= marker.bottom + 2;
    const centre = (marker.top + marker.bottom) / 2;
    const d = Math.abs(x - marker.left) + (inside ? 0 : Math.abs(y - centre) * 3 + 14);
    if (d < distance) {
      distance = d;
      best = marker.at;
    }
  }
  return best;
}

/// Su (`-1`) e giù (`1`): il punto più vicino sopra o sotto quello di adesso,
/// dal numeratore al denominatore e ritorno.
export function verticalPoint(markers: readonly Marker[], current: number, dir: -1 | 1): number | null {
  const from = markers.find((marker) => marker.at === current);
  if (!from) return null;
  const y0 = (from.top + from.bottom) / 2;
  let best: number | null = null;
  let distance = Infinity;
  for (const marker of markers) {
    const dy = (marker.top + marker.bottom) / 2 - y0;
    if (dir < 0 ? dy > -4 : dy < 4) continue;
    const d = Math.abs(marker.left - from.left) + Math.abs(dy) * 0.4;
    if (d < distance) {
      distance = d;
      best = marker.at;
    }
  }
  return best;
}
