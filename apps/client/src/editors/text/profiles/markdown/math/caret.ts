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
import { emptyCells } from "./edit";
import { holesOf, mapFormula, placeAt, type Span } from "./points";

/// L'attributo dei segni: `data-fubp`, l'offset del punto nel TeX.
export const POINT_ATTRIBUTE = "data-fubp";
/// Uno spazio vuoto (`{}`): il quadretto che si riempie.
export const HOLE_ATTRIBUTE = "data-fubhole";
/// Il comando che si sta scrivendo, in una pastiglia finché non è finito.
export const PENDING_ATTRIBUTE = "data-fubcmd";
/// Il pezzo scelto (T66), colorato come una selezione.
export const CHOSEN_ATTRIBUTE = "data-fubsel";

/// Le regole di KaTeX del riquadro di modifica: quelle della lettura, con la
/// fiducia ai soli segni del cursore. `tex` è la formula, per le macro che
/// dichiara da sé (`readOptions`).
export function editOptions(display: boolean, tex?: string): KatexOptions {
  return {
    ...readOptions(display, tex),
    strict: (code: string) => (code === "htmlExtension" ? "ignore" : "error"),
    trust: (context) => context.command === "\\htmlData"
      && Object.keys(context.attributes).every((name) => name.startsWith("data-fub")),
  };
}

/// Il TeX col segno in ogni punto buono. `pending`, se c'è, è il comando che
/// si sta scrivendo (dalla `\` al cursore): si disegna come testo, perché a
/// metà non si legge. `chosen`, se c'è, è il pezzo scelto (T66): sta in un
/// segno suo, `data-fubsel`, che la pelle colora. Le celle vuote di una
/// matrice sono spazi vuoti, col loro quadretto.
export function instrument(tex: string, pending: { from: number; to: number } | null = null, chosen: Span | null = null): string {
  const map = mapFormula(tex);
  const holes = new Set([...holesOf(map), ...emptyCells(map)]);
  // A pari posto, chi va applicato prima finisce più a destra: il segno del
  // punto all'inizio del pezzo scelto ne resta fuori, come quello alla fine.
  type Mark = { at: number; remove: number; insert: string; order: number };
  const marks: Mark[] = [];
  if (chosen && chosen.from < chosen.to) {
    marks.push({ at: chosen.from, remove: 0, insert: "\\htmlData{fubsel=1}{", order: 2 });
    marks.push({ at: chosen.to, remove: 0, insert: "}", order: 0 });
  }
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
    marks.push({ at: point.at, remove: 0, insert: `\\htmlData{fubp=${point.at}${hole ? ",fubhole=1" : ""}}{${body}}`, order: 1 });
  }
  if (pending) {
    const name = tex.slice(pending.from + 1, pending.to);
    marks.push({ at: pending.from, remove: pending.to - pending.from, insert: `\\htmlData{fubcmd=1}{\\text{\\textbackslash ${name}}}`, order: 2 });
  }
  // Dalla fine, così gli offset dei segni prima restano buoni; in uno stesso
  // punto il segno del cursore va prima del comando in sospeso.
  marks.sort((a, b) => b.at - a.at || b.order - a.order);
  let out = tex;
  for (const mark of marks) out = out.slice(0, mark.at) + mark.insert + out.slice(mark.at + mark.remove);
  return out;
}

/// Il TeX dell'anteprima del campo del LaTeX (T63): soltanto gli spazi vuoti
/// (`{}`) hanno il loro segno, un quadretto che si clicca; il resto del
/// disegno non porta il cursore. `holes` sono i punti dentro ogni `{}`
/// (`sourceHoles` di `edit.ts`).
export function instrumentHoles(tex: string, holes: readonly number[]): string {
  let out = tex;
  for (let i = holes.length - 1; i >= 0; i--) {
    const at = holes[i]!;
    // Nel testo `\square` non si può: il quadretto lo disegna la pelle.
    const body = /\\(?:text|textrm|textbf|textit|mathrm|operatorname)\{[^{}]*$/.test(tex.slice(0, at)) ? "" : "\\square";
    out = `${out.slice(0, at)}\\htmlData{fubp=${at},fubhole=1}{${body}}${out.slice(at)}`;
  }
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
