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
//
// Un `Error` della webview dà il suo messaggio e non `"Error: …"`: il prefisso
// è inglese in ogni lingua e non dice niente a chi legge.
//
// Un errore del contratto il cui messaggio **non** è una stringa è una chiave
// che nessuno ha risolto (un `Text::Message` uscito dal confine senza passare
// dal catalogo): è un difetto di chi l'ha lasciato uscire, ma chi guarda non
// deve pagarlo con «[object Object]» né con una chiave. Riceve la frase della
// specie dell'errore, nella sua lingua; ogni altro oggetto, la frase di un
// problema imprevisto.
export function errorText(e: unknown): string {
  const plugin = asPluginError(e);
  if (plugin) return plugin.message;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const kind = (e as { kind?: unknown }).kind;
    return kindPhrase(typeof kind === "string" ? kind : "internal");
  }
  return String(e);
}

export type ErrorKindKey =
  | "error.kind.io"
  | "error.kind.not_found"
  | "error.kind.permission_denied"
  | "error.kind.conflict"
  | "error.kind.cancelled"
  | "error.kind.already_exists"
  | "error.kind.bad_args"
  | "error.kind.unavailable"
  | "error.kind.internal";

// La specie del contratto → la chiave della sua frase. Le specie che dicono
// «questo non c'è» (un comando, una view, un job sconosciuti, un servizio non
// servito) si leggono tutte come una funzione che non è disponibile.
const KIND_KEYS: Readonly<Record<PluginErrorKind, ErrorKindKey>> = {
  io: "error.kind.io",
  not_found: "error.kind.not_found",
  permission_denied: "error.kind.permission_denied",
  conflict: "error.kind.conflict",
  cancelled: "error.kind.cancelled",
  already_exists: "error.kind.already_exists",
  bad_args: "error.kind.bad_args",
  unserved: "error.kind.unavailable",
  unknown_command: "error.kind.unavailable",
  unknown_view: "error.kind.unavailable",
  unknown_job: "error.kind.unavailable",
  internal: "error.kind.internal",
};

// Chi traduce le frasi delle specie: lo registra `i18n/strings.ts` quando si
// carica. Questo file non importa le stringhe di proposito: lo leggono in
// molti, e le stringhe si portano dietro le impostazioni e il kernel. Prima
// della registrazione (un test che non carica le stringhe) resta la chiave,
// che è comunque meglio di «[object Object]».
let translate: (key: ErrorKindKey) => string = (key) => key;

export function setErrorKindTranslator(fn: (key: ErrorKindKey) => string): void {
  translate = fn;
}

function kindPhrase(kind: string): string {
  return translate(KIND_KEYS[kind as PluginErrorKind] ?? "error.kind.internal");
}
