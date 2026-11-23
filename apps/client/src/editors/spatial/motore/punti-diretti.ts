// I punti di ancoraggio che la Selezione diretta del motore mostra sul foglio
// (piano K6, T12; `docs/product/drawing-pen.md`, «I punti scelti»). Il motore
// li disegna solo durante un gesto (`DrawingPreview.overlays`): a gesto finito
// l'editor li disegna da sé, dal `d` (o dai punti) dei tracciati scelti, così
// si vede dove prendere. Senza DOM e senza motore.
//
// - **Un punto** è dove il tracciato passa: l'inizio di un sottotracciato e la
//   fine di ogni segmento. Un sottotracciato chiuso che torna sul suo primo
//   punto non lo mostra due volte.
// - **Un punto scelto** (`DrawingToolState.anchors`) è pieno, e mostra le sue
//   maniglie: quella della cubica che arriva e quella della cubica che parte,
//   o il punto di controllo di una quadratica. Si riconosce dalla posizione in
//   coordinate di scena, perché il motore e il file contano i punti a modo
//   loro.
// - **Solo tracciati veri**: `path`, `polyline`, `polygon` e `line`. Un tratto
//   dell'Inchiostro di Fub non ha punti da spostare (gli strumenti dei
//   tracciati lo rifiutano), e chi lo chiama lo lascia fuori.

import type { DrawingAnchor } from "../../../host/contract";
import { parsePath } from "../scene/geometry";
import { apply, type Matrix, type Point } from "../scene/matrix";
import type { OverlayHandle } from "../painter/overlay";
import { length, points as parsePoints } from "../scene/values";

/// Al più tanti punti per disegno: oltre, il foglio ne mostra solo i primi
/// (un tracciato importato può averne decine di migliaia).
export const MAX_PUNTI_MOSTRATI = 5000;

/// Un tracciato scelto: il suo id, il tag, gli attributi propri e la matrice
/// dalle sue coordinate a quelle della scena.
export interface TracciatoScelto {
  readonly id: string | null;
  readonly tag: string;
  readonly attributi: ReadonlyMap<string, string>;
  readonly matrice: Matrix;
}

interface Punto {
  readonly at: Point;
  /// Le maniglie del punto, nelle coordinate dell'oggetto.
  readonly maniglie: Point[];
}

/// I punti di un `d`, per sottotracciato, con le loro maniglie.
function puntiDelD(d: string): Punto[][] {
  const segmenti = parsePath(d);
  if (segmenti === null) return [];
  const out: Punto[][] = [];
  let sotto: Punto[] = [];
  const chiudi = (): void => {
    if (sotto.length > 0) out.push(sotto);
    sotto = [];
  };
  for (const s of segmenti) {
    if (s.kind === "move") {
      chiudi();
      sotto.push({ at: s.to, maniglie: [] });
      continue;
    }
    if (s.kind === "close") {
      // Un sottotracciato chiuso che torna sul primo punto: l'ultimo è lui.
      const primo = sotto[0];
      const ultimo = sotto[sotto.length - 1];
      if (sotto.length > 1 && primo !== undefined && ultimo !== undefined && uguali(primo.at, ultimo.at)) {
        primo.maniglie.push(...ultimo.maniglie);
        sotto.pop();
      }
      chiudi();
      continue;
    }
    const prima = sotto[sotto.length - 1];
    const qui: Punto = { at: s.to, maniglie: [] };
    if (s.kind === "cubic") {
      prima?.maniglie.push(s.c1);
      qui.maniglie.push(s.c2);
    } else if (s.kind === "quad") {
      prima?.maniglie.push(s.control);
      qui.maniglie.push(s.control);
    }
    sotto.push(qui);
  }
  chiudi();
  return out;
}

const uguali = (a: Point, b: Point): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/// I punti di un tracciato scelto, nelle coordinate dell'oggetto.
function puntiDi(tracciato: TracciatoScelto): Punto[] {
  const a = tracciato.attributi;
  switch (tracciato.tag) {
    case "path":
      return puntiDelD(a.get("d") ?? "").flat();
    case "polyline":
    case "polygon":
      return (parsePoints(a.get("points") ?? "") ?? []).map((at) => ({ at, maniglie: [] }));
    case "line": {
      const n = (nome: string): number => length(a.get(nome) ?? "0") ?? 0;
      return [
        { at: [n("x1"), n("y1")], maniglie: [] },
        { at: [n("x2"), n("y2")], maniglie: [] },
      ];
    }
    default:
      return [];
  }
}

/// I segni dei punti dei tracciati scelti: un quadratino per punto, pieno se
/// è fra `scelti`, e per i punti scelti le maniglie col loro gambo.
/// `tolleranza` è quanto lontano, in unità della scena, un punto scelto si
/// riconosce ancora (mezzo pixel dello schermo).
export function segniDeiPunti(tracciati: readonly TracciatoScelto[], scelti: readonly DrawingAnchor[], tolleranza: number): OverlayHandle[] {
  const quadratini: OverlayHandle[] = [];
  const maniglie: OverlayHandle[] = [];
  let contati = 0;
  for (const tracciato of tracciati) {
    const suoi = scelti.filter((s) => s.element === tracciato.id);
    for (const punto of puntiDi(tracciato)) {
      if (contati >= MAX_PUNTI_MOSTRATI) break;
      contati += 1;
      const at = apply(tracciato.matrice, punto.at);
      const pieno = suoi.some((s) => Math.hypot(s.at[0] - at[0], s.at[1] - at[1]) <= tolleranza);
      quadratini.push({ kind: "anchor", x: at[0], y: at[1], filled: pieno });
      if (!pieno) continue;
      for (const m of punto.maniglie) {
        const dove = apply(tracciato.matrice, m);
        if (uguali(dove, at)) continue;
        maniglie.push({ kind: "guide", from: at, to: dove, dashed: false });
        maniglie.push({ kind: "control", x: dove[0], y: dove[1] });
      }
    }
  }
  // Le maniglie sotto i quadratini, come in Illustrator.
  return [...maniglie, ...quadratini];
}
