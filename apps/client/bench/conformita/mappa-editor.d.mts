// **La forma della mappa dell'editor, dal lato dei tipi**: la legge il
// presidio `confronto.test.ts`, che ne controlla anche il contenuto.
import type { DaCoprire, Pezzo } from "./confronto.mjs";
import type { DaCoprireAnimazione, Voce } from "./confronto-animazioni.mjs";

/// Un gesto: riceve la pagina di Playwright, che da questo lato del confine
/// non ha un tipo.
export type Gesto = (page: unknown) => Promise<unknown>;

export const PROTOTIPO: { nome: string; ramo: string; file: string };
export const TRADUZIONE: Record<string, string[]>;
export const TRADUZIONE_DOCUMENTO: Record<string, string[]>;
export const TRADUZIONI: Record<string, Record<string, string[]>>;
export const STATI: Record<
  string,
  {
    luce: "light" | "dark";
    prototipo: { luce: string; larghezza: string; monta?: Gesto };
    app?: { monta: Gesto };
    finestra: { width: number; height: number };
  }
>;
export const VISTE: Record<
  string,
  {
    stati: string[];
    prototipo: { prepara: Gesto };
    app: { scena: string; prepara?: Gesto };
  }
>;
export const PEZZI: Array<
  Pezzo & { vista: string; gesto?: { tipo: "hover" | "focus" | "click"; prototipo: string | string[]; app: string | string[] } }
>;
export const DA_COPRIRE: DaCoprire[];
/// Il banco delle animazioni (`animazioni.mjs`): le voci e le differenze vere
/// ancora da correggere.
export const ANIMAZIONI: Voce[];
export const DA_COPRIRE_ANIMAZIONI: DaCoprireAnimazione[];
