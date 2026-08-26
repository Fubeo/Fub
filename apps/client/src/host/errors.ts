// Leggere un errore che arriva dal backend (§12.2).
//
// Sta accanto a `contract.ts` e non dentro: quello è **solo tipi** e non si
// compila via, questo è le tre righe di runtime che servono a interrogarli. Non
// importa `@tauri-apps` di proposito — chi vuole formattare un errore non deve
// tirarsi dietro la cucitura (§1.3), e sono in molti a volerlo.
//
// # Perché serve una funzione per stampare un errore
//
// Perché prima non serviva. Fino alla decisione 0041 il confine Tauri
// consegnava una **stringa**, e ogni sito che notificava un guasto scriveva
// `${e}` — che su una stringa è la stringa. Adesso consegna un oggetto
// `{kind, message}`, e `${e}` sarebbe `[object Object]`: la stessa riga che
// prima diceva tutto direbbe niente. `errorText` è quel `${e}`, aggiornato.
import type { PluginError, PluginErrorKind } from "./contract";

// L'errore del contratto, se è quello che è arrivato.
//
// Il controllo è **strutturale** e non un `instanceof`: ciò che attraversa
// l'IPC è JSON, e dall'altra parte non c'è nessuna classe da riconoscere. Un
// errore della webview (una `TypeError`, una promessa rifiutata da noi) passa
// di qui e ne esce `null`, che è la risposta giusta: non tutto ciò che va
// storto viene dal backend.
export function asPluginError(e: unknown): PluginError | null {
  if (typeof e !== "object" || e === null) return null;
  const candidate = e as { kind?: unknown; message?: unknown };
  if (typeof candidate.kind !== "string" || typeof candidate.message !== "string") {
    return null;
  }
  return candidate as PluginError;
}

// Questo errore è di questa specie? È la domanda che sostituisce la ricerca di
// una sottostringa nella prosa — e l'unica su cui si può ramificare.
export function isErrorKind(e: unknown, kind: PluginErrorKind): boolean {
  return asPluginError(e)?.kind === kind;
}

// La frase da mostrare a una persona.
//
// Il messaggio è **già risolto** quando arriva: lo traduce il kernel col
// catalogo di chi l'ha prodotto, prima di lasciarlo uscire (§12.1). Qui non si
// traduce niente, si sceglie soltanto cosa stampare.
export function errorText(e: unknown): string {
  return asPluginError(e)?.message ?? String(e);
}
