// Le impostazioni di «Ricalca immagine», senza il ricalco: la barra
// dell'editor le mostra, e il ricalco (`trace.ts`) si carica soltanto nel
// suo worker.

/// Le impostazioni pronte: il bianco e nero di un logo o di una scansione,
/// pochi colori piatti, lo schizzo a matita su carta, la foto.
export type TracePreset = "bw" | "colors" | "sketch" | "photo";

export const TRACE_PRESETS: readonly TracePreset[] = ["bw", "colors", "sketch", "photo"];

export interface TraceSettings {
  readonly preset: TracePreset;
  /// Da 0 a 255: più alta, più inchiostro. Per il bianco e nero una
  /// luminosità, per lo schizzo una parte della carta lì attorno.
  readonly threshold: number;
  /// I colori, al più, da [`MIN_COLORS`] a [`MAX_COLORS`].
  readonly colors: number;
  /// Da 0 a 100: più alto, curve più vicine ai pixel e meno rumore tolto.
  readonly detail: number;
  /// Senza le forme bianche, per i colori: un logo senza il suo fondo.
  readonly ignoreWhite: boolean;
}

export const MIN_COLORS = 2;
export const MAX_COLORS = 32;

/// Le forme di un ricalco, al più.
export const MAX_SHAPES = 5_000;
