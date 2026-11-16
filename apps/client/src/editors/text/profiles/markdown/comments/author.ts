// Chi firma i commenti (D11 A): il nome di Impostazioni › Profilo
// (`profile.name`, della macchina) e la firma scelta per il vault
// (`comments.author`: il nome, le iniziali o niente).
//
// L'autorità è il file delle impostazioni: si legge quando si apre una
// discussione, mai a ogni battuta. Qui resta l'ultimo valore letto, perché
// la discussione disegni subito le iniziali di chi risponde.
import { api } from "../../../../../host/ipc";
import { settings } from "../../../../../host/query";
import { authorMode, cleanName, type AuthorMode } from "./model";

export const PROFILE_NAME_KEY = "profile.name";
export const COMMENTS_AUTHOR_KEY = "comments.author";

/// Il nome della persona e come il vault firma.
export interface Signer {
  readonly name: string;
  readonly mode: AuthorMode;
}

let known: Signer = { name: "", mode: "nome" };

/// L'ultimo valore letto.
export function lastSigner(): Signer {
  return known;
}

/// Legge nome e firma. Una lettura che non riesce lascia l'ultimo valore.
export async function readSigner(): Promise<Signer> {
  try {
    const entries = await settings();
    const value = (key: string) => entries.find((entry) => entry.spec.key === key)?.value;
    const name = value(PROFILE_NAME_KEY);
    known = { name: typeof name === "string" ? cleanName(name) : "", mode: authorMode(value(COMMENTS_AUTHOR_KEY)) };
  } catch {
    // Senza impostazioni leggibili vale l'ultimo valore: il commento si
    // scrive lo stesso, e il nome si chiede se manca.
  }
  return known;
}

/// Scrive il nome scelto al primo commento. Il valore ricordato cambia
/// subito: il commento lo porta anche se la scrittura non riesce, e l'errore
/// torna a chi l'ha chiesta.
export async function saveName(name: string): Promise<void> {
  const clean = cleanName(name);
  known = { ...known, name: clean };
  await api.setSetting(PROFILE_NAME_KEY, clean);
}

/// Per i test: dimentica l'ultimo valore letto.
export function forgetSigner(): void {
  known = { name: "", mode: "nome" };
}
