// I caratteri del vault dell'anteprima: Liberation Serif in quattro facce,
// come se stessero in «Caratteri/» del vault, e le risposte dell'indice
// `fub.draw` che l'host vero darebbe leggendo i file. Vivono solo nella copia
// servita, come il resto di `anteprima/`.

import regular from "./caratteri/LiberationSerif-Regular.ttf?inline";
import bold from "./caratteri/LiberationSerif-Bold.ttf?inline";
import italic from "./caratteri/LiberationSerif-Italic.ttf?inline";
import boldItalic from "./caratteri/LiberationSerif-BoldItalic.ttf?inline";

interface Faccia {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly weight: number;
  readonly style: "normal" | "italic";
}

function bytesOf(dataUrl: string): Uint8Array {
  const raw = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const FACCE: readonly Faccia[] = [
  { id: "Caratteri/LiberationSerif-Regular.ttf", bytes: bytesOf(regular), weight: 400, style: "normal" },
  { id: "Caratteri/LiberationSerif-Bold.ttf", bytes: bytesOf(bold), weight: 700, style: "normal" },
  { id: "Caratteri/LiberationSerif-Italic.ttf", bytes: bytesOf(italic), weight: 400, style: "italic" },
  { id: "Caratteri/LiberationSerif-BoldItalic.ttf", bytes: bytesOf(boldItalic), weight: 700, style: "italic" },
];

/// I file, per `Options.resources` dell'host finto.
export const CARATTERI: Record<string, { bytes: Uint8Array; mime: string }> = Object.fromEntries(
  FACCE.map((faccia) => [faccia.id, { bytes: faccia.bytes, mime: "font/ttf" }]),
);

/// La risposta di `fub.draw` a una domanda sui caratteri: le facce di un file
/// statico, riconosciuto dai suoi byte. Un file statico non chiede istanze.
export function rispostaCaratteri(query: unknown): unknown {
  const { kind, data } = query as { kind?: string; data?: string };
  if (kind !== "font_faces" || typeof data !== "string") throw new Error(`fub.draw: domanda non servita (${String(kind)})`);
  const raw = atob(data);
  const faccia = FACCE.find((each) => each.bytes.length === raw.length && each.bytes.every((byte, k) => byte === raw.charCodeAt(k)));
  if (faccia === undefined) return { faces: [] };
  return {
    faces: [{
      index: 0,
      family: "Liberation Serif",
      names: ["Liberation Serif"],
      generic: "serif",
      weight: [faccia.weight, faccia.weight],
      stretch: [100, 100],
      styles: [{ style: faccia.style, fixed: [] }],
      axes: [],
    }],
  };
}
