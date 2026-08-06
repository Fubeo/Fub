// Le regole che esistono **in due lingue**, e che una fixture generata tiene
// uguali.
//
// Ogni funzione di questo file ha una gemella in Rust dentro
// `crates/fub-abi/src/rules/` (o nel modello, per quelle che ci stavano da
// prima), e il legame non è un commento: `crates/fub-abi/tests/rules_mirror.rs`
// genera `__fixtures__/rules-samples.json` con la risposta di Rust caso per
// caso, e `rules-mirror.test.ts` pretende che qui esca la stessa. Cambiare la
// regola da un lato solo è rosso.
//
// Perché esistono due volte: sono tutte cose che la UI deve sapere **prima** di
// un giro IPC — che nome scrivere sotto un'icona mentre l'albero si disegna, se
// barrare una riga mentre si digita, se due nomi sono lo stesso nome per trovare
// la folder note di una cartella. Il traguardo dichiarato dal §6.2 è che questo
// file sparisca, compilando `fub-abi` a wasm32; fino ad allora la duplicazione
// resta, ma sotto lo stesso presidio dei tipi.
//
// **Non aggiungere qui una regola senza la sua gemella Rust e i suoi casi nella
// fixture**: sarebbe di nuovo una copia che nessuno confronta.
import type { DocChanges, EventMask, KernelEvent, Subject } from "../host/contract";

/// L'ultimo segmento di un path: `Progetti/Alpha.md` → `Alpha.md`.
///
/// Non ha una gemella Rust (di là è `rsplit('/')` scritto sul posto) ed è qui
/// perché [`pageName`] la usa.
export function childName(path: string): string {
  return path.split("/").pop() ?? path;
}

/// Il "nome pagina" di un `DocId`: basename senza l'ultima estensione.
///
/// Gemella di `DocId::page_name`. Si toglie ciò che segue l'ultimo punto, a
/// meno che il punto sia il primo carattere del basename — un dotfile non ha
/// estensione, il punto è parte del nome.
///
/// Non consulta le estensioni *gestite* (`VaultInfo.extensions`): un `DocId`
/// arriva dal vault, quindi un'estensione gestita ce l'ha già, e filtrarci sopra
/// era proprio ciò che faceva dissentire risoluzione e display — per
/// `note.backup` il kernel risolveva `note` e la UI mostrava `note.backup`.
export function pageName(id: string): string {
  const base = childName(id);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/// La chiave con cui due nomi si scoprono lo stesso nome: trim, NFC, minuscolo.
///
/// Gemella di `fub_abi::rules::path::resolution_key`, ed è **l'unico** modo in
/// cui questa parte del codice ha il diritto di confrontare due nomi di
/// documento. Il `toLowerCase()` da solo non basta: un vault sincronizzato con
/// macOS ha i nomi file in NFD (`e` + accento combinante) mentre il link
/// digitato è NFC, e senza `normalize` la folder note di `Città/` non si trova e
/// il nome ambiguo non si riconosce — su un vault Linux tutto sembra a posto,
/// che è il modo peggiore di sbagliare.
export function resolutionKey(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

// --- la politica dei nomi (§15.5) -------------------------------------------

/// Quale domanda si sta ponendo su un nome. Gemella di
/// `fub_abi::rules::path_policy::Naming`.
///
/// `existing` = un nome che c'è già (aprirlo, elencarlo, rinominarlo *via*):
/// passa tutto ciò che un filesystem può contenere. `new` = un nome che nasce:
/// vale la regola più stretta di tutti i filesystem su cui il vault potrebbe
/// finire, non quella di chi lo sta scrivendo adesso.
export type Naming = "existing" | "new";

/// L'etichetta di ciò che non va in un nome. Gemella di `NameFault::tag()`.
///
/// È un'etichetta e non un messaggio di proposito: la frase che l'utente legge
/// sta nel catalogo (`i18n/`), come ogni altra frase della shell.
export type NameFault =
  | "empty"
  | "traversal"
  | "control"
  | "reserved"
  | "device"
  | "trailing-dot"
  | "hidden"
  | "too-long";

/// I caratteri che un filesystem si riserva, uniti fra i tre sistemi.
const RESERVED_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*", "\\", "/"]);

/// I device DOS, che su Windows non sono nomi di file a nessuna estensione.
const DOS_DEVICES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/// Il massimo per **segmento**, in byte. Gemella di `MAX_SEGMENT_BYTES`.
const MAX_SEGMENT_BYTES = 255;

/// Quanti byte occupa questa stringa in UTF-8.
///
/// **Non** `s.length`, che conta code unit UTF-16: 64 emoji sono 128 code unit e
/// 256 byte, quindi contando `length` si lascerebbe creare un nome che il
/// filesystem rifiuta. È lo stesso inganno che `offsets.ts` esiste per
/// disinnescare, applicato ai nomi.
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/// Il nome è un device DOS? Si guarda il pezzo fino al primo punto, senza
/// distinzione di caso. Non è uno `startsWith`: `CONtratto` e `COM10` cominciano
/// come un device e non lo sono.
function isDosDevice(segment: string): boolean {
  const stem = segment.split(".")[0] ?? segment;
  return DOS_DEVICES.has(stem.toUpperCase());
}

/// Perché questo path non si può usare, o `null` se si può.
///
/// Gemella di `fub_abi::rules::path_policy::check`. **L'ordine dei controlli è
/// contratto**, non un dettaglio: un nome sbagliato in più modi risponde col
/// primo dell'elenco, e la fixture confronta *quella* risposta — due ordini
/// diversi darebbero due guasti diversi sullo stesso nome.
export function nameFault(path: string, naming: Naming): NameFault | null {
  if (path.trim() === "") return "empty";
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return "traversal";
    if (naming === "existing") continue;
    for (const ch of segment) {
      // `\p{Cc}` è la categoria Unicode dei controlli, la stessa che Rust legge
      // con `char::is_control`.
      if (/\p{Cc}/u.test(ch)) return "control";
    }
    for (const ch of segment) {
      if (RESERVED_CHARS.has(ch)) return "reserved";
    }
    if (isDosDevice(segment)) return "device";
    if (segment.endsWith(".") || segment.endsWith(" ")) return "trailing-dot";
    if (segment.startsWith(".")) return "hidden";
    if (utf8Bytes(segment) > MAX_SEGMENT_BYTES) return "too-long";
  }
  return null;
}

/// La forma con cui un nome **nuovo** si scrive sul disco: ogni segmento senza
/// spazi ai bordi, tutto in NFC.
///
/// Gemella di `path_policy::normalized`. La NFC non è cosmetica: `resolutionKey`
/// fa collassare NFC e NFD sulla stessa chiave, quindi per Fub sono lo stesso
/// nome, e per il filesystem di Linux sono due file — crearne uno in NFD accanto
/// a uno in NFC vorrebbe dire un vault con due documenti che il grafo conta come
/// uno.
export function normalizedName(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim().normalize("NFC"))
    .join("/");
}

/// Dove comincia e finisce un `#tag`.
export interface TagTrovato {
  /// Il nome senza il `#`.
  name: string;
  /// In **code unit**, `#` compreso: è la valuta di CodeMirror, e la gemella
  /// Rust risponde in byte perché è la valuta del modello. La conversione la fa
  /// la fixture, componendo `byte_to_utf16` — che è già rispecchiata qui sopra.
  from: number;
  to: number;
}

/// «Alfanumerico» nel senso di `char::is_alphanumeric()` di Rust: Alphabetic
/// più le tre categorie di numero. **Non** include i segni combinanti, ed è la
/// riga da cui dipende che `#Café` scritto decomposto sia lo stesso tag di qua
/// e di là — cioè uno solo per il vault (0107, `568874c`).
export const ALFANUMERICO = /[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}]/u;
/// I caratteri che stanno **dentro** il nome di un tag. Esportata perché il
/// completamento deve conoscere la stessa classe mentre il tag è a metà: due
/// classi vorrebbero dire un popup che si apre su un token che, finito di
/// scrivere, non è un tag.
export const CARATTERE_DI_TAG = /[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}_/-]/u;

/// I `#tag` di un frammento di **testo semplice** (chi chiama deve già aver
/// escluso codice inline, blocchi di codice e frontmatter).
///
/// Gemella di `fub_abi::rules::tag::scan_tags`, ed è la regola che la §4.4 ha
/// trovato scritta **tre** volte nella shell e diversa in tutte e tre — nessuna
/// delle quali era questa. Le differenze non erano di stile: la live preview
/// pretendeva spazio o parentesi prima del `#` (quindi `vedi.#tag` non era un
/// tag mentre lo era per il modello), accettava i segni combinanti dentro il
/// nome (quindi `#Café` decomposto ne dava uno più lungo), e scartava come
/// «tutte cifre» anche le cifre non ASCII.
///
/// Non è una regex: la condizione sul carattere **precedente** guarda un punto
/// di codice e non una code unit, e una regex con lookbehind su `.` avrebbe
/// riguardato mezza coppia surrogata.
export function scanTags(text: string): TagTrovato[] {
  const out: TagTrovato[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "#") {
      i += 1;
      continue;
    }
    // Il `#` non deve seguire un carattere alfanumerico. `codePointAt` sul
    // carattere prima: se è un low surrogate, si torna indietro di due.
    if (i > 0) {
      const primaBassa = text.charCodeAt(i - 1);
      const inizioPrec = primaBassa >= 0xdc00 && primaBassa <= 0xdfff && i >= 2 ? i - 2 : i - 1;
      if (ALFANUMERICO.test(text.slice(inizioPrec, i))) {
        i += 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < text.length) {
      const cp = text.codePointAt(j)!;
      const c = String.fromCodePoint(cp);
      if (!CARATTERE_DI_TAG.test(c)) break;
      j += c.length;
    }
    const name = text.slice(i + 1, j);
    if (name !== "" && !/^[0-9]+$/.test(name)) {
      out.push({ name, from: i, to: j });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/// Una casella è spuntata?
///
/// Gemella di `TaskMarker::checked()`: `x`/`X` è fatta, ogni altro simbolo — gli
/// stati personalizzati `[/]`, `[-]`, `[>]` — è uno stato **non** completato.
/// `null` è la casella vuota.
export function taskChecked(symbol: string | null): boolean {
  return symbol === "x" || symbol === "X";
}

/// Questo topic sta sotto questo prefisso?
///
/// Gemella di `fub_abi::rules::events::topic_matches` (§10.1). I separatori
/// sono i due della regola dei nomi (§7.4): `:` fra namespace e nome, `.` dentro
/// l'uno e dentro l'altro. Non è `startsWith` per una ragione sola: `com.acme`
/// è un prefisso di caratteri di `com.acmecorp:x`, e un filtro che lo accettasse
/// non toglierebbe il difetto — un abbonato che si sveglia per roba altrui —
/// cambierebbe solo di chi è la roba.
export function topicMatches(prefix: string, topic: string): boolean {
  if (prefix === "") return true;
  if (!topic.startsWith(prefix)) return false;
  const next = topic[prefix.length];
  return next === undefined || next === ":" || next === ".";
}

/// Questo documento sta dentro questa cartella, a qualunque profondità?
///
/// Gemella di `fub_abi::rules::events::folder_contains`. La cartella è un
/// prefisso di path perché nel kernel una cartella non esiste ancora (§14.3);
/// la stringa vuota è la radice, e un `/` in coda non cambia niente.
export function folderContains(folder: string, id: string): boolean {
  const f = folder.replace(/\/+$/, "");
  if (f === "") return true;
  return id.length > f.length && id.startsWith(f) && id[f.length] === "/";
}

/// I documenti che un evento **nomina**, per decidere se riguarda un soggetto.
///
/// Gemella di `Event::names`. Un rename ne nomina due — chi guarda una cartella
/// deve sapere che una nota se n'è andata — e un lotto li nomina tutti. Vuoto =
/// l'evento non parla di documenti, e chi filtra per soggetto lo lascia passare.
export function eventNames(event: KernelEvent): string[] {
  switch (event.type) {
    case "document_changed":
    case "document_removed":
      return [event.id];
    case "document_renamed":
      return [event.from, event.to];
    case "batch_ended":
      return event.changed;
    default:
      return [];
  }
}

/// Questo evento va consegnato a chi ha dichiarato questa maschera?
///
/// Gemella di `fub_abi::rules::events::mask_wants` (§10.1), ed è la regola che
/// la shell applica per decidere quando ridisegnare un pannello. Che sia la
/// stessa del kernel non è un commento: è la fixture generata di
/// `crates/fub-abi/tests/rules_mirror.rs`.
///
/// I quattro filtri sono in and, e ognuno vuoto vuol dire *non filtro*. Il
/// soggetto vale per i soli eventi che un documento lo nominano: `overflow`,
/// `vault_closed` e `job_done` passano comunque, perché nessuno dei tre si
/// riscopre riguardando il vault. Il quarto — *cosa* è cambiato (§22.2) — vale
/// per i soli eventi che un cambiamento lo raccontano: `changes` assente è
/// *non lo so* e passa, `changes` presente e vuoto è *niente è cambiato* e non
/// passa.
export function maskWants(mask: EventMask, event: KernelEvent): boolean {
  if (!mask.kinds.includes(event.type)) return false;
  if (event.type === "custom" && mask.topics.length > 0) {
    if (!mask.topics.some((p) => topicMatches(p, event.topic))) return false;
  }
  if (mask.subjects.length > 0) {
    const named = eventNames(event);
    if (named.length > 0 && !named.some((doc) => mask.subjects.some((s) => subjectHolds(s, doc)))) {
      return false;
    }
  }
  if (mask.changes && mask.changes.length > 0) {
    const changes = eventChanges(event);
    if (changes && !changes.aspects.some((a) => mask.changes.includes(a))) {
      return false;
    }
  }
  return true;
}

/// Cosa è cambiato, per gli eventi che lo raccontano. Gemella di
/// `Event::changes` (§22.2).
export function eventChanges(event: KernelEvent): DocChanges | undefined {
  return event.type === "document_changed" ? (event.changes ?? undefined) : undefined;
}

/// Questo documento sta nel soggetto? Gemella di `Subject::holds`.
export function subjectHolds(subject: Subject, doc: string): boolean {
  return subject.kind === "document"
    ? subject.id === doc
    : folderContains(subject.path, doc);
}
