// L'orientamento EXIF di una foto: il numero da 1 a 8 che la macchina scrive
// accanto ai pixel per dire come la si teneva. Qui diventa un quarto di giro
// e uno specchio, che la vista con lo zoom applica nella sua trasformazione:
// il codice scrive l'orientamento, mai la pelle.
//
// Fuori da 1–8 (0, 9, un numero rotto) vale come 1: la foto si mostra com'è.

import type { Rotation } from "./zoom-view";

export interface Orientation {
  /// Il giro in senso orario che rimette la foto dritta.
  readonly rotation: Rotation;
  /// Specchiata in orizzontale prima di girarla.
  readonly mirrored: boolean;
}

const UPRIGHT: Orientation = { rotation: 0, mirrored: false };

const BY_EXIF: Record<number, Orientation> = {
  1: UPRIGHT,
  2: { rotation: 0, mirrored: true },
  3: { rotation: 180, mirrored: false },
  4: { rotation: 180, mirrored: true },
  5: { rotation: 270, mirrored: true },
  6: { rotation: 90, mirrored: false },
  7: { rotation: 90, mirrored: true },
  8: { rotation: 270, mirrored: false },
};

export function orientationOf(exif: number | null | undefined): Orientation {
  return (exif !== null && exif !== undefined && BY_EXIF[exif]) || UPRIGHT;
}

/// La trasformazione CSS che raddrizza: vuota per una foto già dritta. Lo
/// specchio si scrive per ultimo, così si applica per primo.
export function orientationTransform(exif: number | null | undefined): string {
  const { rotation, mirrored } = orientationOf(exif);
  return [rotation ? `rotate(${rotation}deg)` : "", mirrored ? "scaleX(-1)" : ""].filter(Boolean).join(" ");
}
