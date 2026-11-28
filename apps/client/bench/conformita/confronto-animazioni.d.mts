// **La forma del confronto delle animazioni, dal lato dei tipi.**
//
// Come `confronto.d.mts`: `confronto-animazioni.mjs` gira in Node, il suo
// presidio (`confronto-animazioni.test.ts`) è un `.ts`.

/// Un selettore di un elemento: CSS, o CSS più il testo che l'elemento
/// contiene (una riga di CodeMirror, che si rifà a ogni modifica).
export type Selettore = string | { css: string; testo: string };

export interface Elemento {
  id: string;
  prototipo: Selettore;
  app: Selettore;
  proprieta: readonly string[];
  corsa?: boolean;
}

export interface Voce {
  id: string;
  stati?: readonly string[];
  contesto?: string;
  prototipo: { prepara?: unknown; gesto: unknown; attende?: string };
  app: { scena: string; prepara?: unknown; gesto: unknown; attende?: string };
  elementi: readonly Elemento[];
}

/// Una corsa letta da `document.getAnimations()`.
export interface Corsa {
  tipo?: string;
  nome?: string;
  proprieta: readonly string[];
  ritardo: number;
  durata: number;
  iterazioni: number | "infinite";
  curva: string;
}

export interface Lettura {
  rect?: readonly [number, number, number, number];
  valori: Record<string, string>;
}

export interface Campione {
  t: number;
  letture: Record<string, Lettura | null | undefined>;
}

export interface Differenza {
  proprieta: string;
  atteso: string;
  trovato: string;
  motivo: string;
}

export interface DaCoprireAnimazione {
  id: string;
  proprieta: readonly string[];
  stati?: readonly string[];
  perche: string;
}

export const PROGRESSO: number;
export const TEMPO: number;
export const CURVA: number;
export const ASPETTI: readonly string[];

export function proprietaAmmessa(p: string): boolean;
export function canaleDi(proprieta: string): string;
export function canali(lettura: Lettura | null | undefined, proprieta: readonly string[]): Record<string, number[]>;
export function tolleranzaCanale(canale: string): number;
export function progresso(v: readonly number[], v0: readonly number[], v1: readonly number[]): number;
export function campioneA(campioni: readonly Campione[], t: number): Campione | null;
export function curva(testo: string): { bezier: number[] } | { molla: true } | { testo: string };
export function confrontaCurve(a: string, b: string): string | null;
export function corsePerCanale(lista: readonly Corsa[] | null | undefined, proprieta: readonly string[]): Record<string, Corsa>;
export function confrontaCampioni(args: {
  elemento: Elemento;
  finestra: readonly number[];
  proto: readonly Campione[];
  app: readonly Campione[];
  fotogramma: number;
}): {
  differenze: Differenza[];
  righe: Array<{ canale: string; punto: number; t: number; prototipo: [number, number]; app: number | null }>;
};
export function confrontaPartenza(args: { elemento: Elemento; proto: readonly Campione[]; app: readonly Campione[] }): Differenza[];
export function confrontaCorse(args: {
  elemento: Elemento;
  proto: readonly Corsa[];
  app: readonly Corsa[];
  campioniRossi?: Set<string> | null;
}): { differenze: Differenza[]; note: string[] };
export function confrontaRidotto(args: { elemento: Elemento; proto: readonly Corsa[]; app: readonly Corsa[] }): Differenza[];
export function proprietaARiposo(elemento: Elemento): string[];
export function pezziAnimazioni(voci: readonly Voce[]): Array<{ id: string }>;
export function validaVoci(voci: readonly Voce[], stati: Record<string, unknown>): string[];
export function statoMoto(stato: string, moto: string): string;
export function copertureAnimazioni(
  daCoprire: readonly DaCoprireAnimazione[],
  voci: readonly Voce[],
): {
  errori: string[];
  voci: Array<{ pezzo: string; proprieta: string; stati?: readonly string[]; motivo: string; riferimento: string; daCoprire: true }>;
};
export function scriviSelettore(s: Selettore): string;
