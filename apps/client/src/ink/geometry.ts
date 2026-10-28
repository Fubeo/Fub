// La geometria dei campioni: ciò che si fa a un tratto prima che diventi
// contorno, senza sapere dove vive.
//
// Sono le trasformazioni che ogni prodotto dell'inchiostro deve poter fare
// con gli stessi risultati: portare un campione dalle coordinate della scena a
// quelle di un livello (`toLocal`), portare un tratto in una copia in simmetria
// (`mappedSamples`), tirarlo dritto (`straight`). Funzioni pure sui campioni
// di `sample.ts`: nessuna camera, nessuna scena, nessun formato di file. La
// matrice è la `[a, b, c, d, e, f]` di SVG, e qui si dichiara per non importare
// quella di un prodotto.

import { INK_MAX_SAMPLES, type InkSample } from "./sample";

/// Una trasformazione affine del piano come la scrive SVG: `[a, b, c, d, e, f]`,
/// con `x' = a·x + c·y + e` e `y' = b·x + d·y + f`.
export type Affine = readonly [number, number, number, number, number, number];

/// La distanza fra i campioni di un tratto tirato dritto, in unità del tratto.
const STRAIGHT_STEP = 1.5;

/// Il campione `sample` con la posizione portata da `inverse`: pressione,
/// tempo e inclinazione restano. Serve a portare un campione della scena nel
/// livello in cui si scrive, la cui matrice si inverte una volta sola.
export function toLocal(sample: InkSample, inverse: Affine): InkSample {
  const [a, b, c, d, e, f] = inverse;
  return { ...sample, x: a * sample.x + c * sample.y + e, y: b * sample.x + d * sample.y + f };
}

/// I campioni `samples` portati da `m`, una trasformazione delle loro
/// coordinate: i punti si muovono, e l'azimut della penna gira con loro, e si
/// specchia se `m` specchia. Pressione, tempo e altitudine restano.
export function mappedSamples(samples: readonly InkSample[], m: Affine): InkSample[] {
  return samples.map((sample): InkSample => {
    const { x, y } = toLocal(sample, m);
    if (sample.a === undefined) return { ...sample, x, y };
    const radians = (sample.z * Math.PI) / 180;
    const dx = m[0] * Math.cos(radians) + m[2] * Math.sin(radians);
    const dy = m[1] * Math.cos(radians) + m[3] * Math.sin(radians);
    const z = dx === 0 && dy === 0 ? sample.z : ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return { ...sample, x, y, z };
  });
}

/// Un tratto dritto dal primo all'ultimo campione: un campione ogni unità e
/// mezza, con la pressione e il tempo distribuiti in mezzo. Un tratto di un
/// campione solo (o senza campioni) resta com'è, e i campioni non superano mai
/// il limite del formato. Con `snap` la direzione va a passi di `snap` gradi.
export function straight(samples: readonly InkSample[], snap = 0): InkSample[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined || first === last) return [...samples];
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  let [dx, dy] = [last.x - first.x, last.y - first.y];
  if (snap > 0 && length > 0) {
    // La direzione va al multiplo di `snap` gradi più vicino; la lunghezza
    // resta quella del tratto.
    const step = (snap * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    [dx, dy] = [Math.cos(angle) * length, Math.sin(angle) * length];
  }
  const steps = Math.min(INK_MAX_SAMPLES - 1, Math.max(1, Math.ceil(length / STRAIGHT_STEP)));
  const out: InkSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    out.push({ ...first, x: first.x + dx * k, y: first.y + dy * k, t: first.t + (last.t - first.t) * k });
  }
  return out;
}

/// Il passo, in gradi, del tratto raddrizzato con Maiusc.
export const STRAIGHT_SNAP = 15;
