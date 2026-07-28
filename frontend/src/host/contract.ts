// I tipi del confine, rispecchiati a mano dal Rust — e nient'altro.
//
// Stanno in `host/` perché sono la forma di ciò che attraversa l'IPC, ma sono
// deliberatamente **separati da `ipc.ts`**: qui non si importa `@tauri-apps`, e
// un modulo che vuole solo *nominare* un `SearchHit` non si tira dentro la
// cucitura Tauri. È la metà di tipi della regola del §1.3 — la cucitura è una
// sola, ma il contratto lo legge tutta la shell.
//
// Che non divergano dal Rust non è affidato all'attenzione: la fixture generata
// da serde (`crates/fubmd-features/tests/ts_mirror.rs` e la gemella dell'app)
// e `mirror.test.ts` rendono rossi entrambi i lati se un lato cambia.

export interface VaultInfo {
  root: string;
  // `documents` NON C'È PIÙ (§14.4): l'apertura portava l'elenco intero delle
  // note dentro un record, dove una finestra non si può nemmeno chiedere. Chi
  // ne vuole una parte la chiede al canale dati.
  // Le estensioni che i provider registrati gestiscono (minuscole, senza
  // punto). Quale sia l'estensione di un documento lo sanno i FormatDescriptor
  // del backend: la UI non deve cablare ".md".
  extensions: string[];
  // Chi è attivo (§7.6): i plugin dichiarati, con manifest, fiducia, permessi
  // e ciò che hanno registrato.
  //
  // Era `versioning: boolean` — un campo PER FEATURE dentro un record IPC. Con
  // i moduli del capitolo 21 sarebbero diventati venti booleani, e ognuno una
  // modifica al record, a questo mirror e alla fixture. La shell adesso non
  // chiede «il versioning è acceso?»: chiede chi c'è (`hasPlugin`).
  plugins: PluginInfo[];
}

// I vault aperti e quale è il corrente (rispecchia `OpenVaults` dell'app, §9.6).
//
// Il backend ne tiene una mappa: il "corrente" serve a chi non nomina un vault
// — cioè a tutta la shell di oggi — e ogni comando accetta un `vault` opzionale
// per parlare con un altro.
export interface OpenVaults {
  roots: string[];
  current: string | null;
}

// Quanto l'host si fida di chi ha prodotto qualcosa (rispecchia
// fubmd_kernel::Trust). Dal più fidato al meno; `revoked` non gira affatto.
export type Trust = "core" | "verified" | "community" | "development" | "revoked";

// Che specie di cosa un plugin ha registrato
// (rispecchia fubmd_kernel::RegistrationKind).
export type RegistrationKind =
  | "view"
  | "command"
  | "index"
  | "event_handler"
  | "import"
  | "export"
  | "syntax"
  | "renderer";

// Una cosa che un plugin ha registrato (rispecchia fubmd_kernel::Registration).
export interface Registration {
  kind: RegistrationKind;
  // L'id registrato. Per handler e importer — che non nominano niente di
  // proprio — è l'id del plugin stesso.
  id: string;
}

// Una riga dell'inventario di ciò che è attivo (rispecchia
// fubmd_kernel::PluginInfo).
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  // La versione del contratto contro cui è scritto.
  abi_version: string;
  trust: Trust;
  // I permessi concessi, con i loro parametri: la mappa del manifest, non un
  // elenco di booleani.
  permissions: Record<string, unknown>;
  registrations: Registration[];
}

// C'è, ed è vivo? È la domanda che ha sostituito i booleani per feature.
//
// «Vivo» esclude `revoked`, che non è un grado di fiducia più basso ma
// l'assenza del permesso di essere eseguiti: un plugin revocato è dichiarato e
// non fa niente, e chi disegna deve trattarlo come assente.
export function hasPlugin(info: VaultInfo, id: string): boolean {
  return info.plugins.some((p) => p.id === id && p.trust !== "revoked");
}

// Una versione salvata (rispecchia fubmd_features::versioning::VersionRef).
export interface VersionRef {
  // Istante dello snapshot in millisecondi UNIX: è anche la sua identità.
  // Resta un number: i millisecondi non arrivano a 2^53 e qui ci si fa
  // aritmetica (`new Date(ts)`).
  ts: number;
  // Impronta u64 PIENA: attraversa l'IPC come stringa, perché `JSON.parse`
  // perde i bit oltre 2^53 in silenzio. È la regola di confine per gli u64
  // identità/impronta (vedi `fubmd_abi::ipc`); si confronta con ===, mai
  // con l'aritmetica.
  hash: string;
  size: number;
}

export interface BacklinkRef {
  source: string;
  context: string | null;
}

// --- l'errore (rispecchia fubmd_abi::error::PluginError, §12.2) -------------

// Il `kind` di un fallimento: le dodici specie che il contratto sa distinguere.
//
// Fino alla decisione 0041 questo tipo NON esisteva da questa parte, e non
// perché nessuno l'avesse scritto: il confine Tauri stringava ogni errore, e
// quel che arrivava qui era una frase italiana. Distinguere «esiste già» da
// «disco pieno» voleva dire cercarci dentro una sottostringa — e `trash.ts` non
// ci provava nemmeno, intercettando qualunque fallimento con un `catch` nudo e
// chiedendo sempre la stessa cosa.
export type PluginErrorKind =
  | "unknown_command"
  | "unknown_view"
  | "unknown_job"
  | "bad_args"
  | "permission_denied"
  | "internal"
  | "conflict"
  | "unserved"
  | "cancelled"
  | "not_found"
  | "already_exists"
  | "io";

// Tag ADIACENTE (`kind`/`message`), come `UiValue`: il payload è già risolto —
// il kernel lo traduce prima di lasciarlo uscire (§12.1) — quindi qui è una
// stringa e non un `Text`.
export interface PluginError {
  kind: PluginErrorKind;
  message: string;
}

// --- UI dichiarativa (rispecchia fubmd_abi::ui) -----------------------------

// L'azione attaccata a un nodo: l'id e il payload che il PROVIDER si porta
// dietro. Il payload torna a lui intatto: la shell non lo legge e non lo
// riscrive (§2.7).
export interface ActionRef {
  action: string;
  payload: unknown;
}

export type Intent = "neutral" | "primary" | "danger";
export type Align = "start" | "center" | "end";

// Il valore di un campo di input. Tag ADIACENTE (`type`/`value`), come
// ParamKind: una variante che porta una sequenza non sta col tag interno.
export type UiValue =
  | { type: "text"; value: string }
  | { type: "number"; value: number }
  | { type: "bool"; value: boolean }
  | { type: "choices"; value: string[] };

// Lo stato di un campo, come la shell lo consegna al provider.
export interface FieldValue {
  field: string;
  value: UiValue;
}

export interface UiOption {
  value: string;
  label: string;
}

export interface KeyValueEntry {
  label: string;
  value: string;
}

export interface TableColumn {
  title: string;
  align: Align;
}

// La specie di un nodo. La CHIAVE viaggia accanto (vedi `UiNode`), non dentro:
// è identità del nodo, non un dato della sua specie.
export type UiKind =
  | { node: "stack"; dir: "row" | "column"; gap: number; children: UiNode[] }
  | { node: "text"; content: string }
  | { node: "heading"; level: number; content: string }
  | { node: "list"; items: UiNode[] }
  | {
      node: "list_item";
      title: string;
      subtitle: string | null;
      action: ActionRef | null;
      selected: boolean;
    }
  | { node: "button"; label: string; intent: Intent; action: ActionRef }
  | { node: "html"; html: string }
  | { node: "web_view"; url: string; height: number }
  | { node: "section"; title: string; collapsed: boolean; children: UiNode[] }
  | { node: "table"; columns: TableColumn[]; rows: UiNode[] }
  | { node: "row"; cells: UiNode[]; action: ActionRef | null }
  | { node: "tree"; roots: UiNode[] }
  | {
      node: "tree_item";
      label: string;
      expanded: boolean;
      action: ActionRef | null;
      selected: boolean;
      children: UiNode[];
    }
  | { node: "tabs"; active: number; tabs: UiNode[] }
  | { node: "tab"; label: string; action: ActionRef | null; children: UiNode[] }
  | { node: "badge"; label: string; intent: Intent }
  | { node: "icon"; name: string }
  | { node: "progress"; value: number | null; label: string | null }
  | { node: "separator" }
  | { node: "empty_state"; title: string; detail: string | null; action: ActionRef | null }
  | { node: "key_value"; entries: KeyValueEntry[] }
  | {
      node: "text_input";
      field: string;
      label: string | null;
      value: string;
      placeholder: string | null;
      action: ActionRef | null;
    }
  | {
      node: "text_area";
      field: string;
      label: string | null;
      value: string;
      rows: number;
      action: ActionRef | null;
    }
  | {
      node: "number";
      field: string;
      label: string | null;
      value: number | null;
      min: number | null;
      max: number | null;
      step: number | null;
      action: ActionRef | null;
    }
  | { node: "checkbox"; field: string; label: string; value: boolean; action: ActionRef | null }
  | {
      node: "select";
      field: string;
      label: string | null;
      value: string[];
      options: UiOption[];
      multiple: boolean;
      action: ActionRef | null;
    }
  | {
      node: "radio";
      field: string;
      label: string | null;
      value: string | null;
      options: UiOption[];
      action: ActionRef | null;
    }
  | {
      node: "slider";
      field: string;
      label: string | null;
      value: number;
      min: number;
      max: number;
      step: number;
      action: ActionRef | null;
    }
  | {
      node: "date_picker";
      field: string;
      label: string | null;
      value: string | null;
      action: ActionRef | null;
    }
  | { node: "form"; children: UiNode[]; submit_label: string; submit: ActionRef }
  | { node: "custom"; ns: string; payload: unknown; fallback: UiNode[] }
  | { node: "pending"; label: string | null }
  | { node: "failed"; message: string; retry: ActionRef | null };

// Un nodo: la sua chiave e la sua specie. `key` è l'identità del nodo fra due
// ridisegni — è ciò su cui il riconciliatore lavora (§2.8) —, è assente quando
// il provider non la dichiara, e la sua unicità vale FRA I FRATELLI.
export type UiNode = UiKind & { key?: string };

// L'azione che la shell manda al provider: le due metà con i due proprietari
// (§2.7). `payload` è quello che il provider aveva attaccato al nodo e gli torna
// intatto; `fields` è ciò che l'utente ha compilato, e lo costruisce la shell.
// La costruisce lei, quindi vale la ragione del contesto di sessione: un campo
// dimenticato di qua è un rifiuto di serde a runtime, non un errore di
// compilazione.
export interface UiAction {
  action: string;
  payload: unknown;
  fields: FieldValue[];
}

// Aggiornamento restituito da un ViewProvider dopo un'azione
// (rispecchia fubmd_abi::ui::ViewUpdate). Il frontend lo interpreta: `replace`
// ridisegna la view, `navigate` apre un documento, `none` non fa nulla.
export type ViewUpdate =
  | { kind: "replace"; root: UiNode }
  | { kind: "none" }
  | { kind: "navigate"; doc_id: string }
  | { kind: "reveal"; doc_id: string; span: Span }
  | { kind: "run_search"; query: string }
  // Varco di estensione: un intento che questa shell non prevede. La shell
  // che non riconosce `ns` NON FA NULLA (degrado garbato, da contratto).
  | { kind: "custom"; ns: string; payload: unknown }
  // Rimpiazza il solo nodo con questa chiave. Una chiave che non c'è più non è
  // un errore: è una view cambiata sotto, che si ridisegnerà intera.
  | { kind: "patch"; key: string; node: UiNode };

// Evento del kernel (rispecchia fubmd_abi::event::Event).
export type KernelEvent =
  | { type: "vault_opened"; root: string }
  | { type: "document_changed"; id: string }
  | { type: "document_removed"; id: string }
  | { type: "document_renamed"; from: string; to: string }
  // NB: dentro un lotto questo NON arriva — arriva `batch_ended`. Chi reagisce
  // a `index_updated` deve reagire anche a quello, o dopo una rinomina con
  // backlink non si ridisegna più (fubmd_abi::event, decisione 0011).
  | { type: "index_updated" }
  // Esito di un job in background (HostApi::spawn_job). `id` è un u64
  // identità: attraversa l'IPC come stringa (vedi VersionRef.hash).
  | { type: "job_done"; id: string; job: string; result: unknown }
  // Coda eventi troncata: lo stato derivato dagli eventi va riconciliato.
  | { type: "overflow"; dropped: number }
  | { type: "custom"; topic: string; payload: unknown }
  // Un lotto si è chiuso (decisione 0011): N scritture che sono UNA cosa sola, e
  // `changed` sono le note toccate. È ciò che permette alla shell di ridisegnare
  // una volta invece di una per nota — una rinomina con 200 backlink faceva 200
  // giri di `list_documents` più il ridisegno di ogni view iscritta.
  // `batch` è un u64 identità: attraversa l'IPC come stringa.
  | { type: "batch_ended"; batch: string; changed: string[] }
  // Una view è invecchiata per un motivo che il vault non conosce: un job
  // finito, una risposta dalla rete, un calcolo completato (§2.5). `instance`
  // assente = tutte le istanze di quella view.
  | { type: "view_invalidated"; view: string; instance: string | null }
  // Il vault STA PER chiudersi: l'ultimo giro in cui è ancora quello di prima
  // (decisione 0029). Il gemello di `vault_opened`, e per la shell è il momento
  // in cui smettere di disegnarlo — non il momento di chiedergli qualcosa.
  | { type: "vault_closed"; root: string }
  // Un lavoro lungo è stato ACCETTATO (§10.3): il gemello d'apertura di
  // `job_done`, ed è il momento in cui il centro attività fa comparire la riga.
  // «Accettato» e non «partito»: quando parta davvero lo sa solo chi possiede i
  // thread, e la differenza non cambia niente per chi guarda né per chi ferma.
  | { type: "job_started"; id: string; job: string }
  // A che punto è un lavoro lungo (§10.3). Il canale più fitto del contratto: il
  // ponte ne tiene l'ultimo per job dentro una raffica, e ciò che si perde si
  // riscopre con la query `jobs`.
  | { type: "job_progress"; id: string; progress: JobProgress }
  // Un'impostazione è cambiata (§11.1). NON porta il valore nuovo: chi reagisce
  // lo rilegge, e una copia dentro l'evento invecchierebbe — due scritture
  // ravvicinate consegnate in ordine inverso lascerebbero chi ascolta convinto
  // di un valore che non è più quello.
  | { type: "setting_changed"; key: string; scope: SettingScope }
  // Un file che NON è un documento è cambiato, sparito o è stato rinominato
  // (§14.1). Sono tre eventi in più e non tre casi in più di
  // `document_changed`, e la ragione è retroattiva: chi ascolta
  // `document_changed` è codice scritto quando un documento era l'unica cosa
  // che il vault contenesse, e consegnargli un PNG lo farebbe leggere un
  // modello che non esiste. `kind` non è mai `document` — per quello ci sono
  // già i tre eventi di prima.
  | { type: "entry_changed"; id: string; kind: EntryKind }
  | { type: "entry_removed"; id: string; kind: EntryKind }
  | { type: "entry_renamed"; from: string; to: string; kind: EntryKind };

// DOVE: il soggetto di un abbonamento (rispecchia fubmd_abi::event::Subject,
// §10.1). Una cartella è un PREFISSO di path finché il §14.3 non ne fa un
// cittadino del kernel; la stringa vuota è la radice.
export type Subject =
  | { kind: "document"; id: string }
  | { kind: "folder"; path: string };

// A COSA si è abbonati (rispecchia fubmd_abi::event::EventMask, §10.1): le
// specie, i prefissi di topic dei custom, il soggetto. I tre sono in AND, e
// ognuno vuoto vuol dire *non filtro*.
//
// Applicarla non è affare di questo file: la regola è **una sola** e sta in
// `rules/mirrored.ts` (`maskWants`), gemella di
// `fubmd_abi::rules::events::mask_wants` e legata a lei dalla fixture generata.
export interface EventMask {
  kinds: KernelEvent["type"][];
  topics: string[];
  subjects: Subject[];
}

// Chi ha CHIESTO l'operazione da cui un evento nasce (rispecchia
// fubmd_abi::event::Actor). Non chi l'ha eseguita: un comando invocato da
// un'automazione porta l'origine dell'automazione.
export type Actor =
  | { kind: "user" }
  | { kind: "watcher" }
  | { kind: "kernel" }
  | { kind: "plugin"; id: string };

// Da dove viene un evento (fubmd_abi::event::Origin). `batch` è `null` fuori da
// un lotto.
export interface Origin {
  actor: Actor;
  batch: string | null;
}

// Ciò che il ponte Tauri consegna davvero: l'evento E la sua origine
// (fubmd_abi::event::Notice, decisione 0012).
export interface KernelNotice {
  event: KernelEvent;
  origin: Origin;
}

// La dichiarazione di una view offerta da un provider (rispecchia
// fubmd_abi::traits::ViewSpec). `placement` dice DOVE montarla; `refresh` e
// `follows` dicono QUANDO ridisegnarla: gli eventi del kernel al cui arrivo
// serve un nuovo `render_view`, e le parti del contesto di sessione al cui
// cambio la view invecchia. Chi non dichiara `follows` non si ridisegna per il
// contesto — è ciò che tiene fuori il pannello tag da ogni movimento del
// cursore.
// Dove una view si ancora. Dieci superfici, e non è un modello di layout: dice
// a cosa ci si attacca, non come lo spazio è diviso (§2.2).
export type ViewSurface =
  | "left_sidebar"
  | "right_sidebar"
  | "bottom"
  | "main"
  | "modal"
  | "status_bar"
  | "ribbon"
  | "menu"
  | "context_menu"
  | "settings_tab";

export interface ViewSpec {
  id: string;
  title: string;
  surface: ViewSurface;
  refresh: EventMask;
  follows: ContextKind[];
  // Gli argomenti con cui si apre un'istanza: gli stessi ParamSpec dei comandi.
  // Vuoto = una sola istanza, quella che la shell monta da sé.
  params: ParamSpec[];
  icon: string | null;
  order: number;
  open_by_default: boolean;
  preferred_size: number | null;
  closable: boolean;
}

// Un esemplare vivo di una view: quale view, quale esemplare, con quali
// parametri (§2.3). Lo costruisce la shell, che è chi apre.
export interface ViewInstance {
  view: string;
  instance: string;
  params: unknown;
}

// --- comandi (rispecchia fubmd_abi::command) --------------------------------
//
// Il registro: la shell non cabla nessun comando — legge le spec, chiede i
// parametri che dichiarano e decide dal raggio dichiarato se mostrare prima il
// piano. È lo stesso elenco che leggerebbero una CLI o un chiamante
// programmatico: qui la palette è solo il primo dei suoi clienti.

// Una scelta di un parametro `choice`: il valore che viaggia, l'etichetta che
// si legge.
export interface Choice {
  value: string;
  title: string;
}

// La specie di un argomento. Tag ADIACENTE (`kind`/`value`), come
// PropertyValue: una variante che porta una sequenza non è serializzabile col
// tag interno.
export type ParamKind =
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "bool" }
  | { kind: "document" }
  | { kind: "documents" }
  | { kind: "choice"; value: Choice[] };

export interface ParamSpec {
  name: string;
  title: string;
  description: string;
  kind: ParamKind;
  required: boolean;
}

// Fin dove arriva un comando, in ordine di raggio crescente.
export type CommandReach = "session" | "document" | "documents" | "vault" | "settings";

// Il raggio dichiarato. `writes` lo fa rispettare il kernel (chi si dichiara di
// sola lettura riceve un host che rifiuta le scritture); gli altri due sono
// dichiarazioni su cui CHI INVOCA decide se chiedere conferma.
export interface CommandScope {
  writes: boolean;
  reach: CommandReach;
  reversible: boolean;
}

export interface CommandSpec {
  id: string;
  title: string;
  // Cosa fa, in prosa: inutile alla palette (c'è il titolo), indispensabile a
  // un chiamante che non ha letto il codice.
  description: string;
  keybinding: string | null;
  params: ParamSpec[];
  scope: CommandScope;
}

// Come si invoca: eseguire, o chiedere cosa succederebbe.
export type InvokeMode = "apply" | "dry_run";

// La modifica chirurgica (rispecchia fubmd_abi::edit): `base` è la revisione
// OPACA del sorgente su cui gli span sono stati calcolati — si confronta, non
// si interpreta.
export interface TextEdit {
  span: Span;
  text: string;
}

export interface EditRequest {
  base: string;
  edits: TextEdit[];
}

export interface PlannedEdit {
  doc: string;
  edit: EditRequest;
}

// Cosa succederebbe: `docs` è la verità completa (ci sta anche ciò che un
// EditRequest non esprime), `edits` il dettaglio mostrabile come diff.
export interface CommandPlan {
  summary: string;
  docs: string[];
  edits: PlannedEdit[];
}

// Ciò che la shell deve fare dopo un comando. `plan` arriva col contenuto del
// piano appiattito accanto al tag, come ogni variant-record del confine.
export type CommandEffect =
  | { kind: "done" }
  | { kind: "navigate"; doc: string }
  | { kind: "reveal"; doc: string; span: Span }
  | { kind: "run_search"; query: string }
  | ({ kind: "plan" } & CommandPlan)
  // Varco di estensione: la shell che non riconosce `ns` NON FA NULLA.
  | { kind: "custom"; ns: string; payload: unknown }
  // Apri un'istanza di una view, con questi parametri (§2.3).
  | { kind: "open_view"; view: string; params: unknown };

export interface CommandOutcome {
  // Testo semplice, mai markup: si inserisce come testo (regola di confine).
  notify: string | null;
  effect: CommandEffect;
  // Come si torna indietro, se si può (§13.3). Assente = non annullabile, ed è
  // il default onesto.
  //
  // Questa shell **non lo esegue** e non deve: la pila la tiene il kernel, e
  // ciò che si vede da qui è che l'operazione appena fatta era annullabile —
  // quel tanto che basta per accendere una voce di menu. Chi annulla invoca
  // `vault.undo`, che è un comando come gli altri.
  undo: Undo | null;
}

// Come si torna indietro da un'operazione (rispecchia fubmd_abi::command::Undo).
//
// LE DUE PILE NON SI FONDONO, e da questo lato del confine è la cosa da
// ricordare: `Mod-z` nell'editor annulla il **testo del buffer** e non passa di
// qui; `vault.undo` annulla l'**operazione** e non tocca il buffer. A decidere
// quale risponde è il fuoco, non la cronologia — dare a entrambe lo stesso
// accordo vorrebbe dire che Ctrl-Z fa due cose a seconda di chi vince la corsa.
export interface Undo {
  // Cosa si disferebbe, già risolto nella lingua di chi guarda: è la frase da
  // mettere accanto ad «Annulla», non quella dell'esito.
  label: string;
  steps: UndoStep[];
}

export type UndoStep =
  | { kind: "edit"; value: PlannedEdit }
  | { kind: "command"; command: string; args: unknown };

// --- contesto di sessione (rispecchia fubmd_abi::session) -------------------
//
// L'unico tipo che viaggia nel verso opposto agli altri: lo COSTRUISCE la
// shell e lo consuma il kernel (`setActiveContext`). Ogni campo è obbligatorio
// anche quando è nullo: serde rifiuta un campo assente, e il mirror
// (`mirror.test.ts`) verifica che le chiavi siano esattamente queste.

// Le tre modalità esclusive di un pannello (FEATURES 4.1).
export type PaneMode = "source" | "live_preview" | "reading";

// Le parti del contesto che una view può dichiarare di seguire.
export type ContextKind = "document" | "selection" | "mode";

// Ciò che è selezionato nel pannello — o dove sta il cursore (`text` vuoto).
//
// `span` è in byte UTF-8 e c'è SOLO quando quelle coordinate valgono anche per
// il sorgente che il kernel ha in mano, cioè quando il buffer non ha modifiche
// non salvate. `text` invece è sempre quello vero dell'editor: chi vuole il
// testo lo ha sempre, chi vuole la posizione la ha quando è vera.
export interface Selection {
  span: Span | null;
  text: string;
}

// Il contesto del pannello con il focus.
export interface ViewContext {
  pane: string;
  doc: string | null;
  selection: Selection | null;
  mode: PaneMode;
}

// --- il locale (rispecchia fubmd_abi::locale) ------------------------------
//
// Il secondo tipo che viaggia dalla shell al kernel, e per la stessa ragione
// del contesto: lo sa la shell e non il kernel. Qui `Intl` porta un ICU intero
// — lingua, nome IANA del fuso, offset, primo giorno della settimana — mentre
// il lato Rust, per rispondere alla stessa domanda, avrebbe bisogno di un
// database dei fusi orari.

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type HourCycle = "h23" | "h12";

// `utc_offset_minutes` è l'offset di ADESSO, e vale per adesso: chi fa
// aritmetica su date passate usa `timezone`, che porta con sé le regole
// dell'ora legale. Minuti e non ore perché esistono i fusi a mezz'ora
// (`Asia/Kolkata`) e a tre quarti d'ora (`Asia/Kathmandu`).
export interface Locale {
  language: string;
  timezone: string;
  utc_offset_minutes: number;
  first_day_of_week: Weekday;
  hour_cycle: HourCycle;
}

/// L'unico pannello di questa shell, e il `MAIN_PANE` del kernel.
///
/// Sta qui e non nel pannello del documento perché è un **valore del confine**,
/// non un dettaglio di chi lo pubblica: il kernel confronta il `pane` di un
/// contesto con quello di prima, e uno diverso è da contratto un cambio di
/// pannello — cioè un ridisegno di tutto ciò che segue il contesto. Due
/// costanti scritte a mano ai due lati potevano divergere in silenzio; ora la
/// fixture del mirror porta il valore vero della costante Rust e
/// `mirror.test.ts` lega questa a quella.
///
/// Il giorno che i pannelli saranno due (il modello di layout: FEATURES 3.3,
/// §9.6) questa costante diventa un `PaneId` per pannello, ed è la riga da cui
/// partire.
export const MAIN_PANE = "main";

// Un documento **reso**: l'HTML, e le parti dichiarative che la shell monta da
// sé (rispecchia `fubmd_kernel::RenderedDocument`).
//
// Non è una stringa sola perché un blocco custom può uscire come albero `UiNode`
// invece che come markup (§3.2): l'HTML porta un buco `data-ui-slot="N"` e la
// parte con quel numero ci va dentro, montata con lo stesso `mountTree` delle
// view. È così che il blocco di un plugin arriva a schermo senza una riga in
// questo bundle.
export interface RenderedDocument {
  html: string;
  parts: RenderedPart[];
}

export interface RenderedPart {
  slot: number;
  /// Il `custom_kind` che l'ha prodotta: serve al CSS e a chi legge un log.
  kind: string;
  node: UiNode;
}

// `EmbedContent` porta un `RenderedDocument` appiattito (`#[serde(flatten)]`):
// un embed passa dai renderer come l'anteprima.
export interface EmbedContent extends RenderedDocument {
  doc_id: string;
}

// Intervallo in byte (rispecchia fubmd_abi::model::Span).
export interface Span {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Il canale dati (§5.3, §5.4): la query è un albero, non una stringa
// ---------------------------------------------------------------------------
//
// La shell non ha più `search`, `list_tags` e `graph_data`: ha `query_index`,
// come un plugin. Questi tipi rispecchiano `fubmd_abi::query` e la parte index
// di `fubmd_abi::traits`, e il presidio è la fixture generata da Rust
// (`mirror.test.ts`): una variante aggiunta là non può restare non gestita qui.
//
// La stringa che l'utente digita non è più una sintassi: è il campo `text` di
// una foglia. Quello che prima era «Query incompleta» — l'errore del parser di
// una dipendenza mostrato all'utente — non esiste più, perché fra la casella e
// i risultati non c'è più nessun parser di terzi.

// In che verso si cammina il grafo dei link.
export type LinkDirection = "outbound" | "inbound" | "both";

// Il bersaglio NON RISOLTO di un link (rispecchia fubmd_abi::model::LinkTarget).
// Tag ADIACENTE (`kind` + `value`): due varianti su tre portano uno scalare, e
// col tag interno non attraverserebbero il JSON.
//
// Le tre specie sono tre regole di risoluzione diverse, e chi chiede dice quale
// vuole: non c'è un'euristica che le indovini dalla stringa, perché `a/b.md` è
// un wikilink per path *e* un link markdown relativo, e le due non risolvono
// allo stesso posto.
export type LinkTarget =
  | { kind: "wiki"; value: { page: string; heading?: string | null; block?: string | null } }
  | { kind: "url"; value: string }
  | { kind: "path"; value: string };

// Come si intende la stringa di una `TextQuery`.
export type TextMode = "terms" | "phrase";

// Dove cercare il testo. Vuoto = i campi che il provider indicizza.
export type TextField = "name" | "body" | "tags";

export interface TextQuery {
  text: string;
  mode: TextMode;
  fields: TextField[];
}

// Una prova su una proprietà del frontmatter. `test` resta opaco per la shell
// finché non ci sarà un query builder (9.2): la costruisce chi la conosce.
export interface PropertyFilter {
  key: string;
  test: unknown;
}

// Le foglie del linguaggio (rispecchia fubmd_abi::query::QueryPredicate).
export type QueryPredicate =
  | ({ kind: "text" } & TextQuery)
  | { kind: "property"; filter: PropertyFilter }
  | { kind: "tag"; name: string; descendants: boolean }
  | { kind: "folder"; path: string; descendants: boolean }
  | { kind: "linked"; doc: string; direction: LinkDirection }
  | { kind: "docs"; docs: string[] }
  | { kind: "custom"; ns: string; predicate: unknown };

export interface QueryLiteral {
  negated: boolean;
  predicate: QueryPredicate;
}

// I letterali sono in AND; vuota = ogni documento.
export interface QueryClause {
  all: QueryLiteral[];
}

// Le clausole sono in OR; vuoto = ogni documento.
export interface QueryExpr {
  any: QueryClause[];
}

// Ogni documento del vault: la query da cui parte chi non ha filtri.
export const OGNI_DOCUMENTO: QueryExpr = { any: [] };

// Il testo che l'utente ha digitato, ovunque il provider guardi.
export function testoCercato(text: string): QueryExpr {
  return {
    any: [{ all: [{ negated: false, predicate: { kind: "text", text, mode: "terms", fields: [] } }] }],
  };
}

// Questi documenti, per nome: la foglia che chiede «quali di questi esistono?».
// Chi la valuta la restringe a ciò che l'indice conosce, quindi la risposta è
// l'intersezione — ed è il modo di verificare un pugno di path in UNA domanda
// invece di chiedere l'elenco del vault per cercarli dentro.
export function questiDocumenti(docs: string[]): QueryExpr {
  return { any: [{ all: [{ negated: false, predicate: { kind: "docs", docs } }] }] };
}

// Quali proprietà del frontmatter portarsi dietro in una risposta.
export type PropertySelect = { kind: "none" } | { kind: "all" } | { kind: "keys"; keys: string[] };

export interface Page {
  offset: number;
  limit: number;
}

// Una risposta a finestra: `total` è il conteggio PRIMA della finestra.
export interface Paged<T> {
  items: T[];
  offset: number;
  total: number;
}

// Un documento che ha combaciato (rispecchia fubmd_abi::traits::DocumentMatch).
// `snippet` è testo semplice, MAI markup: si inserisce come testo. Le porzioni
// da evidenziare sono `highlights`, intervalli in byte dentro `snippet`.
// I campi opzionali sono **omessi** quando non ci sono: una selezione senza
// pertinenza non ha né rilevanza né estratto.
export interface DocumentMatch {
  doc: string;
  score?: number;
  snippet?: string;
  highlights?: Span[];
  properties?: { key: string; value: unknown }[];
}

// Un vicino nel grafo: `via` è l'anello precedente, ed è ciò che rende la
// risposta un albero invece che un sacchetto di nodi. A `depth: 1` l'arco è
// (via → doc) per gli uscenti: sono esattamente gli archi del grafo.
export interface NeighborRef {
  doc: string;
  via: string;
  depth: number;
}

// Un problema trovato da un controllo di salute del vault.
export interface HealthIssue {
  doc: string;
  check: string;
  detail: string | null;
  span: Span | null;
}

export interface PropertyCount {
  value: unknown;
  count: number;
}

// Un heading dell'outline di un documento.
export interface Heading {
  level: number;
  text: string;
  slug: string;
  span: Span;
}

// Una interrogazione (rispecchia fubmd_abi::traits::IndexQuery).
export type IndexQuery =
  | {
      kind: "documents";
      matching: QueryExpr;
      sort?: { key: string; descending: boolean } | null;
      select?: PropertySelect;
      page?: Page | null;
    }
  | { kind: "backlinks"; target: string; page?: Page | null }
  | { kind: "outline"; doc: string }
  | { kind: "tags"; matching: QueryExpr; page?: Page | null }
  | {
      kind: "neighbors";
      seeds: QueryExpr;
      direction: LinkDirection;
      depth: number;
      page?: Page | null;
    }
  | { kind: "property_values"; key: string; matching: QueryExpr; page?: Page | null }
  | { kind: "vault_health"; check: string; page?: Page | null }
  | { kind: "custom"; ns: string; query: unknown }
  // Questo vault sa quando cambia da fuori? (§9.7) L'unica variante che non
  // chiede niente sul contenuto del vault: chiede del vault stesso. Passa dal
  // canale dati e non da un comando suo perché i suoi due clienti sono già qui
  // — questa shell, e una feature che ha `HostQuery` e nient'altro.
  | { kind: "vault_status" }
  // Cosa sta girando adesso? (§10.3) La seconda variante che chiede del vault e
  // non del suo contenuto, ed è la RICONCILIAZIONE del centro attività:
  // `job_started` e `job_progress` sono recuperabili, quindi i freni del canale
  // possono buttarli, e senza questa domanda quel troncamento sarebbe una
  // perdita definitiva.
  | { kind: "jobs" }
  // Com'è configurato questo vault? (§11.1) La terza che chiede del vault e non
  // del suo contenuto. Torna le impostazioni RISOLTE — schema, valore che vale
  // adesso, livello da cui viene — perché un elenco è dati, e i dati hanno un
  // canale solo. `plugin` assente = tutte.
  | { kind: "settings"; plugin?: string | null }
  // Com'è organizzato questo vault? (§11.3) La quarta che chiede del vault e
  // non del suo contenuto: icone, appuntate, ordinamenti, spazi. Prima era un
  // comando IPC che restituiva il blob intero, cioè una cosa che questa shell
  // sapeva chiedere e un provider no.
  | { kind: "organization" }
  // Cosa nomina questo riferimento, adesso? (§13.1) `from` è il documento
  // dentro cui il riferimento è scritto: serve ai `path`, che sono relativi
  // alla cartella di chi li ospita. Prima era `resolve_link`, un comando IPC
  // scritto apposta — cioè un fatto sul vault che questa shell conosceva e un
  // provider no.
  | { kind: "resolve"; target: LinkTarget; from?: string | null }
  // Cosa c'è nel vault? (§14.1, §14.2) L'anagrafe, non l'indice: è la sola
  // domanda del canale che risponde anche su ciò che non è un documento — un
  // PNG, uno ZIP, un file che nessuno sa cosa sia. `of_kind` assente = tutte le
  // specie. È il canale con cui questa shell costruisce l'albero: prima
  // chiedeva `list_documents`, che restituiva l'intero vault in un `string[]`
  // senza finestra e senza allegati.
  // `within` è la metà che mancava (§14.4): una lista PER CARTELLA, così che
  // aprire un vault da diecimila note non trasferisca diecimila righe per
  // disegnarne venti. Assente = tutto il vault, com'era prima.
  | {
      kind: "entries";
      of_kind?: EntryKind | null;
      within?: FolderScope | null;
      page?: Page | null;
    }
  // Quali cartelle ci sono? (§14.3) Una domanda sua e non una specie in più di
  // `EntryKind`: una cartella non ha dimensione, data né impronta. `under`
  // assente = ogni cartella del vault, a ogni profondità.
  | { kind: "folders"; under?: FolderScope | null; page?: Page | null };

// La risposta (rispecchia fubmd_abi::traits::IndexResult). Tag ADIACENTE
// (`kind` + `value`): un payload che è una lista o uno scalare non attraversa
// il JSON col tag interno.
export type IndexResult =
  | { kind: "documents"; value: Paged<DocumentMatch> }
  | { kind: "backlinks"; value: Paged<BacklinkRef> }
  | { kind: "outline"; value: Heading[] }
  | { kind: "tags"; value: Paged<TagCount> }
  | { kind: "neighbors"; value: Paged<NeighborRef> }
  | { kind: "property_values"; value: Paged<PropertyCount> }
  | { kind: "vault_health"; value: Paged<HealthIssue> }
  | { kind: "custom"; value: unknown }
  | { kind: "vault_status"; value: VaultStatus }
  | { kind: "jobs"; value: JobStatus[] }
  | { kind: "settings"; value: SettingEntry[] }
  | { kind: "organization"; value: Organization }
  // Il documento che un riferimento nomina, o nessuno. `null` non è un errore
  // ed è metà del valore di questa risposta: link rotto, URL esterno e nota
  // rinominata via da sotto danno tutti e tre `null`, e chi ha chiesto sa che
  // deve proporre qualcos'altro.
  | { kind: "resolved"; value: string | null }
  | { kind: "entries"; value: Paged<VaultEntry> }
  | { kind: "folders"; value: Paged<VaultFolder> };

// CHE SPECIE DI FILE È (§14.1). Non è una proprietà del file: è una proprietà
// del file dato chi è registrato adesso — un `.canvas` è `unknown` finché
// nessuno rivendica quell'estensione, e diventa `document` senza che un byte
// cambi. Per questo non si persiste da nessuna parte.
export type EntryKind = "document" | "asset" | "unknown";

// Una voce del vault: un file, con ciò che si sa di lui SENZA aprirlo.
export interface VaultEntry {
  // La chiave è il path, come per ogni altra cosa del vault (decisione 0043).
  id: string;
  kind: EntryKind;
  size: number;
  // Ultima modifica in MILLISECONDI unix. Millisecondi perché serve a
  // riconoscere una modifica, non a mostrare una data; non nanosecondi perché
  // oltre 2^53 un intero non sopravvive al `double` del JSON.
  mtime: number;
  // L'identità del CONTENUTO, quando qualcuno l'ha già avuto in mano. `null` è
  // il caso normale per un allegato: leggerne i byte all'apertura è il costo
  // che l'anagrafe esiste per togliere.
  fingerprint: string | null;
}

// Una CARTELLA del vault (§14.3). Esiste perché il disco ce l'ha, non perché il
// path di un file la nomini: una cartella vuota c'è, e una che resta vuota
// perché la sua ultima nota è finita nel cestino resta lì. Prima le cartelle
// vivevano solo qui — le costruiva `buildTree` dai path delle note — e il
// kernel non ne sapeva niente.
export interface VaultFolder {
  // Senza slash finale, mai vuoto: la radice non è una voce.
  path: string;
  // Sottocartelle dirette: è ciò che dice se disegnare la freccetta che apre,
  // senza dover prima chiedere cosa c'è dentro.
  folders: number;
  // File diretti, DI OGNI SPECIE: la domanda è «questa cartella è vuota?», e
  // una con dentro solo un PNG non lo è.
  entries: number;
}

// DOVE guardare, per le domande che si fanno per cartella (§14.3, §14.4). È la
// stessa coppia del predicato `folder`, di proposito: la regola che decide cosa
// ci sta dentro è una sola.
export interface FolderScope {
  // Senza slash finale. "" è la radice del vault.
  path: string;
  // `false` = i soli figli diretti, che è la domanda che disegna un livello di
  // albero.
  descendants: boolean;
}

// --- le impostazioni (§11.1) ------------------------------------------------
//
// Rispecchiano `fubmd_abi::settings`. Il pezzo che si vede da qui e da nessun
// altro lato: **il form lo genera questa shell**, dallo schema. Un provider
// dichiara cosa si può configurare e legge i valori dall'`HostApi`; disegnare i
// campi è della shell, e per questo questi tipi vivono nel contratto e non in un
// albero `UiNode` — un albero sarebbe la UI di **un** provider, uno schema è ciò
// da cui ogni pannello (questo, quello di un plugin, una CLI) sa costruirla.

// DOVE un'impostazione ha il diritto di stare. Le chiavi `machine` scritte in un
// `.fubmd/settings.json` si IGNORANO: un vault arriva da fuori, e non decide
// della macchina di chi lo apre.
export type SettingScope = "vault" | "machine";

// Da dove viene il valore che si sta leggendo. `default` = nessuno ha deciso, ed
// è ciò che permette al pannello di dire «questa la stai sovrascrivendo» e al
// pulsante «azzera» di comparire solo dove serve.
export type SettingSource = "default" | "machine" | "vault";

// Di che specie è un'impostazione, col suo default dentro.
export type SettingKind =
  | { kind: "toggle"; default: boolean }
  | { kind: "number"; default: number; min: number | null; max: number | null }
  | { kind: "text"; default: string }
  | { kind: "choice"; default: string; options: UiOption[] }
  | { kind: "list"; default: string[] };

// Il valore, NUDO sul confine JSON: `true`, `12`, `"scuro"`, `["a"]`. La specie
// la dichiara lo schema, quindi un'etichetta non aggiungerebbe niente e
// renderebbe illeggibile un file che si apre con un editor di testo.
export type SettingValue = boolean | number | string | string[];

export interface SettingSpec {
  key: string;
  label: string;
  description: string;
  // Sotto quale intestazione raggrupparla. Vuoto = le sciolte in fondo.
  group: string;
  scope: SettingScope;
  kind: SettingKind;
  // Un PROGRAMMA la può scrivere? Non riguarda questa shell — di qui passa
  // l'utente, che le può cambiare tutte — riguarda `settings.set`, i plugin e le
  // macro: il residuo della decisione 0010, chiuso per chiave.
  program_writable: boolean;
}

// Una riga di configurazione risolta: è ciò che il pannello disegna.
export interface SettingEntry {
  spec: SettingSpec;
  value: SettingValue;
  source: SettingSource;
}

// Un componente che questo host sa montare, e se è acceso (rispecchia
// `fubmd_host::BundleInfo`, §11.1).
//
// Non è `PluginInfo`: quello elenca chi è DICHIARATO NEL KERNEL, e un componente
// spento non lo è affatto. La differenza è il punto — «spento» e «non c'è» sono
// due stati diversi, e senza questo elenco il secondo si mangerebbe il primo.
export interface BundleInfo {
  id: string;
  name: string;
  mounted: boolean;
}

// Un vault che questa macchina conosce (rispecchia `fubmd_host::VaultEntry`,
// §11.1): la memoria fra un avvio e l'altro, che è un'altra cosa da `OpenVaults`
// — quello dice cosa è aperto ADESSO e muore col processo.
//
// Si chiama `KnownVault` e non `VaultEntry` come il tipo Rust perché in Rust i
// due `VaultEntry` — questo e quello dell'anagrafe
// (`fubmd_abi::traits::VaultEntry`, sopra) — stanno in crate diversi, e in
// TypeScript no: due `interface` omonime **si fondono in silenzio**, e il
// risultato sarebbe un tipo con dieci campi che nessuna delle due parti
// riconosce. Il nome che cede è questo, perché l'altro è nel contratto
// congelato (`vault-entry` nel WIT) e questo è un record della shell. Il nome
// nuovo è anche quello del comando che lo porta (`known_vaults`).
export interface KnownVault {
  root: string;
  // Vuoto = il nome della cartella, che chi disegna ricava da sé: memorizzarlo
  // vorrebbe dire mostrare il nome vecchio dopo una rinomina della cartella.
  name: string;
  icon: string | null;
  favorite: boolean;
  last_opened: number;
}

// Che rapporto ha questo vault con il disco (rispecchia
// fubmd_abi::traits::VaultStatus, §9.7). Tre domande diverse e non una: FubMD
// SAPREBBE che il vault è cambiato; è GIÀ successo qualcosa che non ha saputo
// leggere; e cosa.
export interface VaultStatus {
  // `false` = nessuno vede le scritture altrui. Non è di nicchia: network share
  // e cloud drive, vault sincronizzati con strumenti esterni, il limite di
  // inotify sui vault grandi, e i tre host dove non esisterà affatto.
  watching: boolean;
  // Quante sincronizzazioni per-path sono fallite da quando il vault è aperto.
  sync_failures: number;
  // L'ultimo di quei fallimenti, già composto.
  last_sync_error: string | null;
}

// A CHE PUNTO è un lavoro lungo (rispecchia fubmd_abi::traits::JobProgress,
// §10.3). Un record solo per tutti e due i modi di saperlo: l'evento
// `job_progress`, che lo dice quando cambia, e `JobStatus`, che lo dice a chi
// arriva dopo e chiede.
export interface JobProgress {
  done: number;
  // Assente = indeterminato: si disegna un'attesa senza barra, non una barra
  // che mente.
  total: number | null;
  label: string | null;
}

// Un lavoro lungo VIVO (rispecchia fubmd_abi::traits::JobStatus, §10.3): da
// `job_started` a `job_done`, quindi anche quelli che aspettano un thread
// libero — uno in coda si annulla come uno in volo, e chi guarda deve poterlo
// vedere per poterlo fermare.
//
// `id` è un u64 identità: attraversa l'IPC come stringa (vedi VersionRef.hash).
// `since` è in millisecondi dall'epoca UNIX.
export interface JobStatus {
  id: string;
  job: string;
  plugin: string;
  since: number;
  progress: JobProgress | null;
}

// Un tag del vault con quante note lo portano (rispecchia
// fubmd_abi::traits::TagCount). `name` è senza `#`, gerarchia intatta (`a/b`).
export interface TagCount {
  name: string;
  count: number;
}

// Una voce del cestino (rispecchia fubmd_kernel::vault::TrashEntry).
export interface TrashEntry {
  // Dove il file si trova ora, dentro `.trash/`.
  id: string;
  // Dove tornerebbe un ripristino.
  original: string;
  // Istante della cancellazione, in secondi UNIX.
  deleted_at: number;
  size: number;
}

// L'organizzazione del vault (rispecchia fubmd_abi::organization::Organization):
// icone, note appuntate, ordinamenti per-cartella, spazi. Vive nel sidecar
// `.fubmd/workspace.json` dentro il vault, e dal §11.3 lo possiede il KERNEL —
// prima erano due funzioni dell'host con `std::fs` nudo, e questo tipo si
// chiamava `WorkspaceMeta` perché era dell'app. Le chiavi sono path relativi al
// vault: DocId per le note, path senza slash finale per le cartelle ("" è la
// radice).
export interface Organization {
  icons: Record<string, string>;
  pinned: string[];
  order: Record<string, string[]>;
  // Cartelle registrate come "spazi" (striscia di icone), nel loro ordine.
  // Lo spazio SELEZIONATO non è organizzazione del vault: è stato di vista
  // per-macchina (§11.2), e sta nel file della macchina — non qui e non più in
  // `localStorage`.
  spaces: string[];
}

/// Gli id dei comandi strutturali che la shell invoca (decisione 0013).
///
/// Sono **stringhe del registro**, non funzioni dell'IPC: dalla decisione 0013 la shell
/// chiede «crea una nota» esattamente come la chiederebbe una CLI, una macro o
/// un plugin — `invokeCommand(id, args)` — e il fatto che l'implementazione sia
/// una feature ufficiale non le dà più nessuna scorciatoia. Sono raccolti qui e
/// non sparsi nei chiamanti perché un id è un dato del contratto: se cambia,
/// cambia in un posto.
export const COMANDI = {
  crea: "note.create",
  rinomina: "note.rename",
  cestina: "note.trash",
  ripristina: "trash.restore",
  svuota: "trash.empty",
} as const;
