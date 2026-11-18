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

// Il motivo di un errore, da mettere in una riga che dice che cosa non è
// riuscito.
//
// # La regola, una sola
//
// Una riga d'errore davanti a una persona dice **che cosa** non è riuscito e
// **perché**: «Non ho potuto creare la nota «Idee»: esiste già qualcosa con lo
// stesso nome». Le due metà vengono da due posti diversi, e non si scambiano:
//
// - **il soggetto lo dà chi chiama**, con una chiave sua del catalogo che ha il
//   segnaposto `{reason}` («… non è riuscito: {reason}», «Non ho potuto …:
//   {reason}»). Solo chi chiama sa che cosa stava facendo; un avviso con il solo
//   motivo («non esiste più») lascia chi legge senza sapere *che cosa*;
// - **il motivo lo dà questa funzione**, e il parametro dice da dove si prende.
//
// `"messaggio"` (il default) è il motivo detto da chi ha prodotto l'errore: un
// comando, una view, un servizio di un componente escono dal kernel già
// tradotti col catalogo di chi li ha scritti (§12.1), e un `Error` della
// webview è uno dei nostri, scritto con `t()`. Qui non si traduce niente.
// Con un'eccezione per specie, non per chiamante: `not_found`,
// `already_exists` e `conflict` portano l'id del documento (è così che il
// kernel e i comandi li costruiscono, quasi senza eccezioni), `io` la prosa
// del sistema operativo. Lì il messaggio non è mai un motivo, e anche col
// default si dice la specie.
//
// `"specie"` è la frase della specie dell'errore (`error.kind.*`), nella lingua
// di chi guarda. È per gli errori delle **primitive dell'host su un
// documento** (aprire, creare, rinominare, spostare, leggere i modelli o i
// tipi, ridisegnare un pannello, cercare): lì il messaggio non è una frase per
// chi legge. Per `not_found`, `already_exists` e `conflict` è l'id del
// documento, per `internal` la prosa del codec in inglese («parse failed: rich
// codec…»), per `io` quella del sistema operativo. Il messaggio resta nel
// registro dell'host, dove lo cerca chi sviluppa.
//
// Un errore del contratto il cui messaggio **non** è una stringa è una chiave
// che nessuno ha risolto (un `Text::Message` uscito dal confine senza passare
// dal catalogo): è un difetto di chi l'ha lasciato uscire, ma chi guarda non
// deve pagarlo con «[object Object]» né con una chiave. Riceve la frase della
// specie anche col parametro `"messaggio"`; ogni altro oggetto, la frase di un
// problema imprevisto. Un `Error` dà il suo messaggio e non `"Error: …"`: il
// prefisso è inglese in ogni lingua e non dice niente a chi legge.
//
// Ciò che va **solo nel registro** (un `console.warn`, un `logWarn`) non passa
// di qui: lì serve il messaggio intero, in qualunque lingua sia.
export type ErrorReason = "messaggio" | "specie";

// Le specie il cui messaggio è un dato (un id, la prosa del sistema) e non un
// motivo da leggere.
const DATUM_KINDS: ReadonlySet<PluginErrorKind> = new Set<PluginErrorKind>(["not_found", "already_exists", "conflict", "io"]);

export function errorText(e: unknown, reason: ErrorReason = "messaggio"): string {
  if (reason === "specie") {
    const kind = typeof e === "object" && e !== null ? (e as { kind?: unknown }).kind : undefined;
    return kindPhrase(typeof kind === "string" ? kind : "internal");
  }
  const plugin = asPluginError(e);
  if (plugin) return DATUM_KINDS.has(plugin.kind) ? kindPhrase(plugin.kind) : plugin.message;
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
