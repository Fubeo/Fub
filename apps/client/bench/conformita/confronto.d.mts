// **La forma del comparatore della conformità, dal lato dei tipi.**
//
// Come `../scene.d.mts`: `confronto.mjs` gira in Node, il suo presidio
// (`confronto.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata.

export type Colore = [number, number, number, number];

export const TOLLERANZA: Readonly<{ lunghezza: number; canale: number; alfa: number; numero: number }>;
export const GRUPPI: Readonly<Record<string, readonly string[]>>;
export const BASE: readonly string[];

export interface Pezzo {
  id: string;
  vista?: string;
  prototipo: string;
  app: string;
  proprieta: readonly string[];
  stati?: readonly string[];
  /// Il lavoro (una PR, un ramo) che porta il pezzo nell'app: finché c'è, la
  /// verifica non lo legge (`verifica.mjs`, `--attese`).
  attende?: string;
}

export interface Eccezione {
  pezzo: string;
  proprieta: string;
  motivo: string;
  riferimento: string;
  stati?: readonly string[];
  daCoprire?: boolean;
}

export interface Differenza {
  pezzo: string;
  stato: string;
  selettorePrototipo: string;
  selettoreApp: string;
  proprieta: string;
  atteso: string;
  trovato: string;
  motivo: string;
}

export interface Mancante {
  pezzo: string;
  stato: string;
  selettorePrototipo: string;
  selettoreApp: string;
  lato: "app" | "prototipo";
}

export interface DaCoprire {
  id: string;
  perche: string;
  proprieta?: readonly string[];
  prototipo?: string;
  app?: string | null;
}

export type Atteso = string | ReadonlyArray<{ valore: string; come: string | null }>;

export function espandi(proprieta: readonly string[]): string[];
export function gruppoDi(lunga: string): string | null;
export function dividi(testo: string, sep: string): string[];
export function lunghezza(token: string): number | null;
export function colore(testo: string): Colore | null;
export function scriviColore(c: Colore): string;
export function coloriUguali(a: Colore, b: Colore): boolean;
export function ombre(
  valore: string,
): Array<{ inset: boolean; x: number; y: number; blur: number; spread: number; colore: Colore }>;
export function immagini(valore: string): Array<{ funzione: string; argomenti: string[] }>;
export function famiglia(valore: string): string;
export function confronta(proprieta: string, atteso: string | null | undefined, trovato: string | null | undefined): string | null;
export function validaEccezioni(eccezioni: readonly Partial<Eccezione>[], pezzi: readonly Pezzo[]): string[];
export function copre(eccezione: Eccezione, differenza: Differenza): boolean;
export function applicaEccezioni(
  differenze: readonly Differenza[],
  eccezioni: readonly Eccezione[],
): { rosse: Differenza[]; giustificate: Array<Differenza & { eccezione: Eccezione }>; inutili: Eccezione[] };
export function coperture(
  daCoprire: readonly DaCoprire[],
  pezzi: readonly Pezzo[],
): { errori: string[]; voci: Eccezione[] };
export function scriviDifferenza(d: Differenza): string;
export function scriviMancante(m: Mancante): string;
export function confrontaPezzo(
  pezzo: Pezzo,
  stato: string,
  attesi: Record<string, Atteso> | null | undefined,
  trovati: Record<string, string> | null | undefined,
): { mancanti: Mancante[]; differenze: Differenza[] };
export function sentinella(i: number): Colore;
export function sentinelle(traduzione: Record<string, readonly string[]>): Record<string, Colore>;
export function mescola(a: Colore, p: number, b: Colore): Colore;
export function decodifica(c: Colore, sent: Record<string, Colore>): string[];
export function espressioniFub(
  crudo: string,
  conSentinelle: string,
  traduzione: Record<string, readonly string[]>,
  massimo?: number,
): string[] | null;
