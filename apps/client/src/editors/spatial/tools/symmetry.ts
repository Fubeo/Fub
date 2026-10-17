// La penna in simmetria (livello Standard, parte «Simmetria»): ogni tratto
// della penna e dell'evidenziatore scrive anche le sue copie, riflesse su un
// asse o girate attorno a un centro, come la simmetria del disegno di
// Procreate e dei pennelli di Affinity. Le copie sono inchiostro vero,
// tratti come gli altri che si modificano da soli: la simmetria è dello
// strumento, non del disegno, e il file non ne sa niente.
//
// - **Asse verticale** e **asse orizzontale:** il tratto e la sua immagine
//   allo specchio sull'asse per il centro.
// - **Radiale:** da 2 a 12 spicchi uguali attorno al centro, ognuno con una
//   copia del tratto girata; specchiata, come un caleidoscopio, ogni spicchio
//   ha anche l'immagine riflessa, e i tratti sono il doppio degli spicchi. Il
//   primo asse dello specchio è verticale, così due spicchi specchiati sono i
//   quattro quadranti.
//
// Qui ci sono le trasformazioni, nella scena (i campioni si portano con
// `mappedSamples` di `ink/geometry`); l'editor le prende quando il tratto comincia e le applica al tratto nelle
// coordinate del suo livello.

import { compose, type Matrix, type Point } from "../scene/matrix";
import { repeatMatrices } from "../scene/repeat";

/// I tipi di simmetria della penna, nell'ordine del menu.
export const SYMMETRY_KINDS = ["none", "vertical", "horizontal", "radial"] as const;
export type SymmetryKind = (typeof SYMMETRY_KINDS)[number];

/// Gli spicchi di una simmetria radiale.
export const MIN_SLICES = 2;
export const MAX_SLICES = 12;

/// La simmetria della penna. `center` sta nella scena; `null` finché la
/// simmetria non si è mai accesa, e l'editor non l'ha messo al centro della
/// pagina o della tavola.
export interface PenSymmetry {
  readonly kind: SymmetryKind;
  /// Gli spicchi della radiale, da [`MIN_SLICES`] a [`MAX_SLICES`].
  readonly slices: number;
  /// La radiale specchiata.
  readonly mirror: boolean;
  readonly center: Point | null;
}

/// La simmetria di un disegno appena aperto: spenta, e quando si accende
/// radiale a otto spicchi specchiati, come la guida di Procreate.
export const DEFAULT_SYMMETRY: PenSymmetry = { kind: "none", slices: 8, mirror: true, center: null };

export function isSymmetryKind(value: string): value is SymmetryKind {
  return (SYMMETRY_KINDS as readonly string[]).includes(value);
}

/// `slices` portato fra [`MIN_SLICES`] e [`MAX_SLICES`], intero.
export function clampSlices(slices: number): number {
  return Math.min(MAX_SLICES, Math.max(MIN_SLICES, Math.round(slices)));
}

/// Le trasformazioni delle copie di un tratto, nella scena, senza quella
/// del tratto stesso: nessuna con la simmetria spenta o senza centro. Una
/// radiale specchiata alterna le immagini e le rotazioni: la riflessione
/// sull'asse verticale, il primo spicchio, la sua immagine, e così via.
export function symmetryMatrices(symmetry: PenSymmetry): Matrix[] {
  const center = symmetry.center;
  if (center === null) return [];
  const [cx, cy] = center;
  switch (symmetry.kind) {
    case "none":
      return [];
    case "vertical":
      return repeatMatrices({ kind: "mirror", axis: [center, [cx, cy + 1]] });
    case "horizontal":
      return repeatMatrices({ kind: "mirror", axis: [center, [cx + 1, cy]] });
    case "radial": {
      const turns = repeatMatrices({ kind: "radial", count: clampSlices(symmetry.slices), center });
      if (!symmetry.mirror) return turns;
      const flip = repeatMatrices({ kind: "mirror", axis: [center, [cx, cy + 1]] })[0]!;
      return [flip, ...turns.flatMap((turn) => [turn, cleaned(compose(turn, flip))])];
    }
  }
}

/// Quanti tratti scrive un tratto, lui compreso.
export function strokeCount(symmetry: PenSymmetry): number {
  return symmetryMatrices(symmetry).length + 1;
}

/// Le direzioni delle guide, in gradi nella scena, dal centro verso il
/// bordo della vista: 0 è a destra, 90 in basso, come gli angoli di SVG. Un
/// asse sono due direzioni opposte; una radiale ha un raggio per ogni bordo
/// di spicchio, e specchiata uno per ogni asse dello specchio. Il primo
/// raggio va in alto.
export function symmetryRays(symmetry: PenSymmetry): number[] {
  switch (symmetry.kind) {
    case "none":
      return [];
    case "vertical":
      return [270, 90];
    case "horizontal":
      return [0, 180];
    case "radial": {
      const slices = clampSlices(symmetry.slices);
      const rays = symmetry.mirror ? 2 * slices : slices;
      return Array.from({ length: rays }, (_, k) => (270 + (360 * k) / rays) % 360);
    }
  }
}

/// `m` senza gli scarti di virgola mobile vicino agli interi e senza `-0`:
/// una riflessione composta con un quarto di giro è esatta.
function cleaned(m: Matrix): Matrix {
  return m.map((value) => {
    const near = Math.round(value);
    return (Math.abs(value - near) < 1e-12 ? near : value) + 0;
  }) as unknown as Matrix;
}
