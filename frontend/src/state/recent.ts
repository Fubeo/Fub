// **Le cose recenti**: le note che si sono aperte e le ricerche che si sono
// fatte (§21.5, §21.7).
//
// # Un posto solo, ed è questo
//
// Fino a ieri qui c'erano solo le note aperte, in una lista che viveva quanto
// la finestra, e il commento in testa prendeva un impegno: *«il giorno in cui
// la §21.7 deciderà dove si scrive una cronologia, questo modulo è il posto che
// diventa il suo lettore — non un secondo posto da riconciliare»*. Quel giorno
// è questo, e l'impegno è mantenuto alla lettera: la cronologia non ha un
// modulo suo accanto a questo. Sono due elenchi dentro lo stesso, con lo stesso
// tetto, la stessa regola di risalita, lo stesso interruttore e lo stesso
// gesto che li cancella.
//
// Sono due elenchi e non uno perché rispondono a due domande diverse — *dov'ero*
// e *cosa cercavo* — e mescolarli darebbe una lista che non si sa leggere. Ma
// hanno lo **stesso peso di privacy**, ed è per questo che l'interruttore è uno:
// due interruttori per una sola preoccupazione sono un menu che nessuno capisce,
// e chi dice «non tenere traccia» non intende metà traccia.
//
// # Dove si scrive, e perché lì
//
// Nello **stato di vista della shell** ([0037](../../../docs/decisions/0037-lo-stato-di-vista.md)),
// sotto la chiave [`CHIAVE_STATO`], accanto a `layout`. È la stessa cassetta in
// cui la finestra ricorda com'era, e per un dato di privacy ha tre proprietà che
// nessun altro posto ha insieme: sta nella cartella di configurazione della
// **macchina**, quindi non entra in un sync né in un repo git; è recintata per
// proprietario, e il proprietario lo timbra la porta di Rust e non il webview
// (`fub-app/src/lib.rs`), quindi nessun altro componente la può leggere;
// `forget_vault` la dimentica già insieme al resto, che è metà «cancellazione
// dati locali» del §23.2 senza scrivere una riga.
//
// Ciò che stona, e va detto invece di essere lasciato passare: il doc di
// `ViewStateRead` descrive quello spazio come *scroll, sezioni collassate,
// filtro corrente, linguetta attiva* — «dove eri rimasto». Una cronologia è un'altra
// specie di dato: ha un peso di privacy, vuole un interruttore e vuole un gesto
// per cancellarla. Il verbale
// [0086](../../../docs/decisions/0086-una-cronologia-e-la-sua-porta.md) allarga
// quella descrizione apposta invece di far finta che ci rientri, e il prezzo che
// paga è scritto lì: il recinto per proprietario **vieta** che un comando del
// registro cancelli questa roba, e quindi il gesto è un comando di shell.
//
// # Perché sta in `state/` e non nel pannello
//
// Perché è la regola del §1.2 (e la ragione per cui `rules/risultati.ts`
// esiste): ciò che si prova senza un DOM non abita dentro un pannello. Qui le
// cose da provare sono due — *riaprire una nota la porta in cima e non la
// duplica*, e *a interruttore spento non si scrive niente* — e in un pannello si
// proverebbero solo aprendo l'app.
import { existingDocuments, settings } from "../host/query";
import { onEvent } from "./kernel";
import { readState, on, writeState } from "./store";

/// Quante se ne ricordano, **per elenco**.
///
/// Dieci: è un elenco che si guarda tutto in un colpo d'occhio senza scorrere,
/// e la memoria corta serve a tornare su ciò che si stava facendo — non a
/// consultare uno storico, che è un'altra cosa. Lo stesso numero per le due
/// liste, e non è pigrizia: il tetto qui non misura quanto dato si può tenere
/// (il disco non è il vincolo), misura **quanto se ne può leggere in un
/// colpo d'occhio**, e quella è una proprietà dell'occhio, non dell'elenco.
const HOW_MANY = 10;

/// La chiave dello stato di vista in cui le due liste stanno. Il vault non entra
/// nella chiave: lo mette lo store da sé (0037).
const STATE_KEY = "history";

/// La chiave dell'impostazione che accende e spegne la memoria. La stessa
/// stringa sta in `fub-host/src/settings.rs`, che è dove la chiave **esiste**:
/// una shell in TypeScript non ha modo di importare una costante Rust.
///
/// Divergere costerebbe caro e in silenzio — e qui più che per il tema: un
/// interruttore di privacy che non comanda niente è peggio di un interruttore
/// che non c'è, perché è una promessa. Le tiene insieme lo stesso presidio del
/// tema, che gira dal lato Rust (`fub-host/tests/interruttori.rs`): legge
/// **questo file** e verifica che la chiave che ci trova sia una di quelle che
/// il core dichiara davvero.
export const HISTORY_KEY = "history.enabled";

let opens: string[] = [];
let searches: string[] = [];

/// L'interruttore, come l'ha letto l'ultima volta.
///
/// Parte **acceso**, che è il default dello schema: partire spento e poi
/// accendersi vorrebbe dire che le prime aperture dopo l'avvio si perdono nel
/// buco fra il montaggio e la prima risposta del canale dati.
let enabled = true;

/// La lista con `voce` in cima, senza doppioni e lunga al più `max`.
///
/// Pura, perché è la sola decisione che questo modulo prende, e vale **per tutte
/// e due** le liste: una cosa già vista **si sposta** in cima invece di comparire
/// due volte, che è la differenza fra una memoria corta e un registro di
/// accessi. Per una ricerca ripetuta è la stessa risposta e per la stessa
/// ragione: chi cerca due volte «riunione» non vuole «riunione» due volte nella
/// lista, vuole ritrovarla in cima — e *quante volte* si è cercato qualcosa è
/// precisamente il dato in più che una memoria corta non ha motivo di tenere.
export function withOnTop(list: string[], entry: string, max = HOW_MANY): string[] {
  return [entry, ...list.filter((d) => d !== entry)].slice(0, max);
}

/// Le note aperte di recente, dalla più recente.
///
/// Possono contenere note che **non ci sono più** — rinominate o cestinate
/// mentre l'app era aperta, o fra due avvii —, e non si ripuliscono qui: chi le
/// mostra le passa da `documentiEsistenti`, che è una domanda sola e risponde su
/// tutte insieme. Ascoltare `document_removed` e `document_renamed` sarebbe un
/// secondo posto che deve restare d'accordo col vault, cioè la cosa che la 0082
/// rifiuta per gli elenchi tenuti dagli eventi. Adesso che la lista sopravvive
/// alla chiusura l'argomento è più forte di prima, non più debole: gli eventi
/// che non si sono visti sono quelli successi ad app **spenta**, e quelli non
/// arrivano a nessun ascoltatore.
export function recentNotes(): string[] {
  return opens;
}

/// Le ricerche fatte di recente, dalla più recente.
///
/// Testo così come è stato scritto, ripulito dei soli spazi ai bordi: una query
/// normalizzata non è la query che qualcuno ha scritto, e riproporgliela
/// riscritta è il modo di far dubitare che sia sua.
export function recentSearches(): string[] {
  return searches;
}

/// Le recenti che esistono **ancora**, nell'ordine in cui si ricordano.
///
/// Una nota rinominata o cestinata mentre l'app era aperta è ancora nella
/// memoria corta, e proporla vorrebbe dire aprire un errore invece di una nota.
/// La domanda è **una sola per tutte** (`documentiEsistenti`, cioè la foglia
/// `docs` del canale dati) e non un ascolto degli eventi di rinomina: uno stato
/// tenuto d'accordo col vault dagli eventi è ciò che la 0082 rifiuta, e qui non
/// serve nemmeno — le recenti si guardano quando si apre una modale, cioè nel
/// momento in cui una domanda in più non la sente nessuno.
///
/// La usano tutte e due le superfici che propongono dei nomi: il quick switcher
/// a query vuota e l'autocompletamento dei wikilink su `[[` appena aperto.
export async function existingRecentNotes(): Promise<string[]> {
  if (opens.length === 0) return [];
  const existing = await existingDocuments(opens);
  return opens.filter((d) => existing.has(d));
}

/// Ricorda una ricerca. Chiamata da chi **cerca davvero**, non da chi digita.
///
/// La distinzione è tutta la differenza fra una cronologia e un registro di
/// battute: la casella di ricerca interroga a ogni tasto, e ricordare lì
/// dentro riempirebbe la lista con «r», «ri», «riu», «riun». Chi chiama lo fa
/// quando una ricerca è stata **conclusa** — un risultato aperto, l'invio
/// premuto — che è il momento in cui quel testo ha voluto dire qualcosa.
export function rememberSearch(text: string): void {
  const q = text.trim();
  if (q === "") return;
  searches = withOnTop(searches, q);
  persist();
}

/// Solo per i banchi, e per chi chiude un vault: la memoria è di **questo**
/// vault, e portarsela in quello dopo mostrerebbe i path di un altro albero e
/// le ricerche fatte in un altro archivio.
///
/// Svuota ciò che c'è in RAM e **non** tocca il disco: chiudere un vault non è
/// dimenticarlo, e riaprirlo domani deve ritrovare le sue cose. Chi vuole
/// cancellare chiama [`dimenticaTutto`].
export function forgetRecent(): void {
  opens = [];
  searches = [];
}

/// **Cancella la memoria**, in RAM e su disco.
///
/// È il gesto che il §23.2 chiede («cancellazione dati locali»), ed è esposto
/// come comando della shell — non del registro dei comandi, e la ragione è il
/// recinto: lo stato di vista è per proprietario, l'id di chi scrive non è un
/// parametro, quindi un comando in `fub-features` non potrebbe toccare ciò che
/// sta sotto `fub.shell` nemmeno volendo. Il prezzo, dichiarato nella 0086, è
/// che non è invocabile da CLI né da un'automazione: lo si trova nella palette e
/// nelle impostazioni, e basta.
export function forgetAll(): void {
  forgetRecent();
  // `null` e non due liste vuote: «non ricordo niente» si scrive dimenticando la
  // chiave, non scrivendoci dentro l'elenco vuoto — così un file di stato aperto
  // con un editor di testo dopo un «cancella» non contiene una riga che parli di
  // ricerche. Per un dato di privacy la differenza fra «assente» e «vuoto» è
  // quella che si vede guardando il file.
  writeState(STATE_KEY, null);
}

/// Mette via le due liste, se si può.
///
/// La riga che conta è la prima, ed è ciò che l'interruttore **è**: a memoria
/// spenta questa funzione non chiama nessuno. Non filtra, non svuota, non
/// scrive un elenco vuoto — non scrive. È anche la riga che il presidio prova,
/// e la prova guardando le chiamate al canale e non leggendo il codice.
function persist(): void {
  if (!enabled) return;
  writeState(
    STATE_KEY,
    opens.length === 0 && searches.length === 0 ? null : { note: opens, searches },
  );
}

/// Da JSON alle due liste, scartando ciò che non regge la forma.
///
/// Severa come `parseLayout`, e per la stessa ragione: il file lo si apre con un
/// editor di testo. Qui in più c'è che una voce non-stringa finita in mezzo
/// arriverebbe fino a `documentiEsistenti`, cioè al confine, come se fosse un
/// path.
function readLists(v: unknown): { note: string[]; searches: string[] } {
  const emptyLists = { note: [], searches: [] };
  if (!v || typeof v !== "object") return emptyLists;
  const o = v as Record<string, unknown>;
  const list = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((e): e is string => typeof e === "string").slice(0, HOW_MANY) : [];
  return { note: list(o.note), searches: list(o.searches) };
}

/// Rilegge l'interruttore, e **agisce sul cambio di stato**.
///
/// Spegnerlo non è solo smettere di scrivere: è cancellare ciò che c'era. Un
/// interruttore di privacy che lascia sul disco la traccia di prima è una casella
/// che non ha fatto quello che diceva, e chi la spegne la spegne **perché** c'è
/// qualcosa che non vuole lasciare lì.
async function rereadToggle(): Promise<void> {
  const first = enabled;
  try {
    // Senza filtro per componente: l'id del bundle di core (`fub.core`) è una
    // costante di Rust, e ricopiarla qui creerebbe la seconda metà di una coppia
    // che nessun presidio tiene insieme. La chiave basta a trovarla.
    const entry = (await settings()).find((e) => e.spec.key === HISTORY_KEY);
    if (!entry) return;
    enabled = entry.value !== false;
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta com'era.
    // L'unico verso pericoloso sarebbe il contrario — dare per acceso un
    // interruttore che qualcuno ha spento — e non succede, perché il valore che
    // vale è l'ultimo **letto**, non un default riapplicato a ogni errore.
    return;
  }
  if (first && !enabled) forgetAll();
}

/// Rilegge le due liste dal disco: l'interruttore prima, perché a memoria spenta
/// non c'è niente da rileggere e c'è semmai qualcosa da cancellare.
export async function loadHistory(): Promise<void> {
  await rereadToggle();
  const saved = await readState<unknown>(STATE_KEY);
  if (!enabled) {
    // Spenta all'avvio, e sul disco c'era ancora qualcosa: si cancella qui.
    // Il caso vero è chi spegne, chiude l'app e la riapre — o chi riapre con
    // questa versione un vault in cui l'interruttore era già spento — e in
    // entrambi trovare la traccia di prima ancora lì è la cosa che
    // l'interruttore prometteva di non fare. Se non c'era niente non si scrive:
    // spenta vuol dire che questo modulo non tocca il disco.
    if (saved !== null) forgetAll();
    return;
  }
  const lists = readLists(saved);
  opens = lists.note;
  searches = lists.searches;
}

/// Comincia a ricordare.
///
/// Si iscrive ad `active-doc`, che è il segnale del documento del riquadro col
/// fuoco: «aperto di recente» vuol dire *guardato*, e il fuoco è chi lo sa —
/// non `openDocument`, che non viene chiamato quando si torna su una linguetta già
/// aperta o si cambia riquadro.
export function rememberOpens(): void {
  on("active-doc", (doc) => {
    if (doc === null) return;
    opens = withOnTop(opens, doc);
    persist();
  });
  // Un vault che si apre: si scordano le cose dell'altro e si rileggono le sue.
  // Le due metà nello stesso punto, perché fra l'una e l'altra la memoria è di
  // nessuno e chi la guardasse lì in mezzo vedrebbe l'archivio sbagliato.
  on("vault", () => {
    forgetRecent();
    void loadHistory();
  });
  // L'interruttore che cambia: da questo pannello, da un'altra finestra, da un
  // `settings.json` riscritto sotto. L'evento non porta il valore (§11.1), e
  // quindi si rilegge.
  onEvent("setting_changed", () => void rereadToggle());
}
