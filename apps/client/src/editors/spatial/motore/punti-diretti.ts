// I punti di ancoraggio che la Selezione diretta del motore mostra sul foglio
// (piano K6, T12; `docs/product/drawing-pen.md`, «I punti scelti»). Il motore
// li disegna solo durante un gesto (`DrawingPreview.overlays`): a gesto finito
// l'editor li disegna da sé, dal `d` (o dai punti) dei tracciati scelti, così
// si vede dove prendere. Senza DOM e senza motore.
//
// - **Un punto** è dove il tracciato passa: l'inizio di un sottotracciato e la
//   fine di ogni segmento. Un sottotracciato chiuso che torna sul suo primo
//   punto non lo mostra due volte.
// - **Come VectorCraft** (`selection_marks.rs`, `object_marks`): ogni
//   tracciato scelto ha il suo contorno di un pixel. Un tracciato scelto
//   intero ha tutti i punti pieni, e con uno strumento che cambia i punti
//   (`diretto`: la Selezione diretta, la Penna…) ne mostra tutte le maniglie;
//   uno scelto solo in parte ha pieni i punti scelti, con le loro maniglie.
// - **Un punto scelto** (`DrawingToolState.anchors`) mostra le maniglie della
//   cubica che arriva e di quella che parte, o il punto di controllo di una
//   quadratica. Si riconosce dalla posizione in coordinate di scena, perché il
//   motore e il file contano i punti a modo loro.
// - **Solo tracciati veri**: `path`, `polyline`, `polygon` e `line`. Un tratto
//   dell'Inchiostro di Fub non ha punti da spostare (gli strumenti dei
//   tracciati lo rifiutano), e chi lo chiama lo lascia fuori.

import type { DrawingAnchor } from "../../../host/contract";
import { flatten, parsePath, type Segment } from "../scene/geometry";
import { apply, type Matrix, type Point } from "../scene/matrix";
import type { OutlinePart, OverlayHandle } from "../painter/overlay";
import { length, points as parsePoints } from "../scene/values";

/// Al più tanti punti per disegno: oltre, il foglio ne mostra solo i primi
/// (un tracciato importato può averne decine di migliaia).
export const MAX_PUNTI_MOSTRATI = 5000;

/// Gli strumenti del motore che cambiano i punti: con loro un tracciato scelto
/// intero mostra tutte le maniglie, e i quadratini sono un po' più grandi in
/// VectorCraft (`vectorcraft_tools::catalog::edits_anchors`).
export const STRUMENTI_CHE_CAMBIANO_I_PUNTI: ReadonlySet<string> = new Set(["directSelection", "pen", "addAnchor", "deleteAnchor", "anchorPoint", "curvature", "smartPen"]);

/// Gli strumenti del motore con cui il foglio mostra la cornice della
/// selezione con le sue maniglie, come in VectorCraft (`selection_overlay`):
/// la Selezione e gli strumenti delle forme vive, che la prendono quando non
/// disegnano. Con gli altri la cornice non c'è, e un clic sulle sue maniglie
/// andrebbe allo strumento, non alla cornice.
export const STRUMENTI_CON_LA_CORNICE: ReadonlySet<string> = new Set(["selection", "rectangle", "roundedRectangle", "ellipse", "polygon", "star"]);

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

/// Il contorno di un tracciato, coi pezzi portati nella scena: una mappa
/// affine porta una curva nella curva dei punti portati; un arco diventa
/// corde.
export function contornoDi(tracciato: TracciatoScelto): OverlayHandle | null {
  const a = tracciato.attributi;
  const m = tracciato.matrice;
  const parts: OutlinePart[] = [];
  const spezzata = (punti: readonly Point[], chiusa: boolean): void => {
    punti.forEach((p, i) => parts.push({ kind: i === 0 ? "move" : "line", to: apply(m, p) }));
    if (chiusa && punti.length > 0) parts.push({ kind: "close" });
  };
  switch (tracciato.tag) {
    case "path": {
      const segmenti = parsePath(a.get("d") ?? "");
      if (segmenti === null) return null;
      let qui: Point = [0, 0];
      for (const s of segmenti) {
        if (s.kind === "close") parts.push({ kind: "close" });
        else if (s.kind === "move") parts.push({ kind: "move", to: apply(m, s.to) });
        else if (s.kind === "line") parts.push({ kind: "line", to: apply(m, s.to) });
        else if (s.kind === "quad") parts.push({ kind: "quad", control: apply(m, s.control), to: apply(m, s.to) });
        else if (s.kind === "cubic") parts.push({ kind: "cubic", c1: apply(m, s.c1), c2: apply(m, s.c2), to: apply(m, s.to) });
        else {
          // L'arco in corde, già nella scena; il primo punto è `qui`.
          const corde = flatten([{ kind: "move", to: qui } as Segment, s], m)[0] ?? [];
          for (const p of corde.slice(1)) parts.push({ kind: "line", to: p });
          parts.push({ kind: "line", to: apply(m, s.to) });
        }
        if (s.kind !== "close") qui = s.to;
      }
      break;
    }
    case "polyline":
    case "polygon":
      spezzata(parsePoints(a.get("points") ?? "") ?? [], tracciato.tag === "polygon");
      break;
    case "line":
      spezzata(puntiDi(tracciato).map((p) => p.at), false);
      break;
    default:
      return null;
  }
  return parts.length === 0 ? null : { kind: "outline", parts };
}

/// Come chi chiama [`segniDeiPunti`] vuole i segni.
export interface ComeISegni {
  /// Lo strumento cambia i punti (la Selezione diretta, la Penna…): un
  /// tracciato scelto intero mostra tutte le maniglie.
  readonly diretto: boolean;
  /// Il contorno di ogni tracciato (Nascondi bordi lo toglie).
  readonly contorni: boolean;
}

/// I segni dei tracciati scelti, come in VectorCraft: il contorno, un
/// quadratino per punto, pieno se il tracciato è scelto intero o se il punto
/// è fra `scelti`, e le maniglie dei punti scelti col loro gambo.
/// `tolleranza` è quanto lontano, in unità della scena, un punto scelto si
/// riconosce ancora (mezzo pixel dello schermo).
export function segniDeiPunti(
  tracciati: readonly TracciatoScelto[],
  scelti: readonly DrawingAnchor[],
  tolleranza: number,
  come: ComeISegni = { diretto: true, contorni: false },
): OverlayHandle[] {
  const contorni: OverlayHandle[] = [];
  const quadratini: OverlayHandle[] = [];
  const maniglie: OverlayHandle[] = [];
  let contati = 0;
  for (const tracciato of tracciati) {
    if (come.contorni) {
      const contorno = contornoDi(tracciato);
      if (contorno !== null) contorni.push(contorno);
    }
    const suoi = scelti.filter((s) => s.element === tracciato.id);
    // Scelto intero: nessun suo punto è scelto da solo.
    const intero = suoi.length === 0;
    for (const punto of puntiDi(tracciato)) {
      if (contati >= MAX_PUNTI_MOSTRATI) break;
      contati += 1;
      const at = apply(tracciato.matrice, punto.at);
      const pieno = intero || suoi.some((s) => Math.hypot(s.at[0] - at[0], s.at[1] - at[1]) <= tolleranza);
      quadratini.push({ kind: "anchor", x: at[0], y: at[1], filled: pieno });
      if (!pieno || (intero && !come.diretto)) continue;
      for (const m of punto.maniglie) {
        const dove = apply(tracciato.matrice, m);
        if (uguali(dove, at)) continue;
        maniglie.push({ kind: "guide", from: at, to: dove, dashed: false });
        maniglie.push({ kind: "control", x: dove[0], y: dove[1] });
      }
    }
  }
  // Il contorno sotto tutto, e le maniglie sotto i quadratini.
  return [...contorni, ...maniglie, ...quadratini];
}
