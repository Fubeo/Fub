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
  documents: string[];
  // Le estensioni che i provider registrati gestiscono (minuscole, senza
  // punto). Quale sia l'estensione di un documento lo sanno i FormatDescriptor
  // del backend: la UI non deve cablare ".md".
  extensions: string[];
  // Il versioning è acceso? Spento significa assente: niente cronologia in UI
  // e nessuna scrittura nel vault (D7).
  versioning: boolean;
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

// Albero di UI dichiarativa (rispecchia fubmd_abi::ui::UiNode).
export type UiNode =
  | { node: "stack"; dir: "row" | "column"; gap: number; children: UiNode[] }
  | { node: "text"; content: string }
  | { node: "heading"; level: number; content: string }
  | { node: "list"; items: UiNode[] }
  | { node: "list_item"; title: string; subtitle: string | null; action: string | null }
  | { node: "button"; label: string; intent: "neutral" | "primary" | "danger"; action: string }
  | { node: "html"; html: string }
  | { node: "web_view"; url: string; height: number };

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
  | { kind: "custom"; ns: string; payload: unknown };

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
  | { type: "batch_ended"; batch: string; changed: string[] };

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
export interface ViewSpec {
  id: string;
  title: string;
  placement: "left_sidebar" | "right_sidebar" | "bottom";
  refresh: KernelEvent["type"][];
  follows: ContextKind[];
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
  | { kind: "custom"; ns: string; payload: unknown };

export interface CommandOutcome {
  // Testo semplice, mai markup: si inserisce come testo (regola di confine).
  notify: string | null;
  effect: CommandEffect;
}

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

// Il grafo del vault (rispecchia fubmd_app::GraphData): nodi = documenti,
// archi = wikilink risolti, deduplicati. È DATO per il renderer canvas
// (`panels/graph.ts`): la superficie privilegiata fuori da UiNode dichiarata
// in M2.
export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphData {
  nodes: string[];
  edges: GraphEdge[];
}

export interface EmbedContent {
  doc_id: string;
  html: string;
}

// Intervallo in byte (rispecchia fubmd_abi::model::Span).
export interface Span {
  start: number;
  end: number;
}

// Un risultato di ricerca (rispecchia fubmd_abi::traits::SearchHit).
// `snippet` è testo semplice, MAI markup: si inserisce come testo. Le porzioni
// da evidenziare sono `highlights`, intervalli in byte dentro `snippet`.
export interface SearchHit {
  doc: string;
  score: number;
  snippet: string;
  highlights: Span[];
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

// Metadati di organizzazione del vault (rispecchia fubmd_app::WorkspaceMeta):
// icone, note appuntate, ordinamenti per-cartella e spazio attivo. Vivono nel
// sidecar `.fubmd/workspace.json` dentro il vault, che il kernel ignora. Le
// chiavi sono path relativi al vault: DocId per le note, path senza slash
// finale per le cartelle ("" è la radice).
export interface WorkspaceMeta {
  icons: Record<string, string>;
  pinned: string[];
  order: Record<string, string[]>;
  // Cartelle registrate come "spazi" (striscia di icone), nel loro ordine.
  // Lo spazio SELEZIONATO è stato di vista per-macchina: localStorage.
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
