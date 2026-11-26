// I tipi del confine per le viste dichiarative, i loro aggiornamenti e gli eventi del kernel
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type {
  Align,
  Axis,
  ContextKind,
  DocChange,
  EntryKind,
  Gate,
  Intent,
  SettingScope,
  Severity,
  ViewSurface,
} from "./enums.generated";
import type { Span } from "./contract-drawing";
import type { JobProgress } from "./contract-settings";
import type { PluginError } from "./contract";
import type { ParamSpec } from "./contract-commands";

// --- UI dichiarativa (rispecchia fub_abi::ui) -----------------------------

// L'azione attaccata a un nodo: l'id e il payload che il PROVIDER si porta
// dietro. Il payload torna a lui intatto: la shell non lo legge e non lo
// riscrive (§2.7).
export interface ActionRef {
  action: string;
  payload: unknown;
}

export type { Intent, Align, Axis } from "./enums.generated";

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
  | { node: "stack"; dir: Axis; gap: number; children: UiNode[] }
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
export type UiNode = UiKind & { key?: string; drag?: UiDrag };

// Che cosa si trascina da un nodo (decisione 0157: il nodo nomina la cosa, la
// shell decide come si offre e dove si lascia). Assente: il nodo non si trascina.
export type UiDrag = { kind: "document"; doc: string };

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
// (rispecchia fub_abi::ui::ViewUpdate). Il frontend lo interpreta: `replace`
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

// Evento del kernel (rispecchia fub_abi::event::Event).
export type KernelEvent =
  // Esce anche dopo un **rimontaggio** (spegnere o riaccendere la lavagna dalla
  // pagina «Componenti», dalla CLI o da MCP): dopo il `vault_closed` dello
  // stesso `root`, il vault è di nuovo aperto, con i formati di adesso, e la
  // shell rilegge ciò che ne dipende (`components_map` compresa).
  | { type: "vault_opened"; root: string }
  // `changes` dice COSA è cambiato (§22.2, decisione 0069). Assente/null =
  // NON LO SO — l'evento non viene dalla coda di una scrittura del kernel — e
  // passa qualunque filtro; presente e con `aspects` vuoto è un fatto, ed è
  // *niente è cambiato*.
  | { type: "document_changed"; id: string; changes?: DocChanges | null }
  | { type: "document_removed"; id: string }
  | { type: "document_renamed"; from: string; to: string }
  // NB: dentro un lotto questo NON arriva — arriva `batch_ended`. Chi reagisce
  // a `index_updated` deve reagire anche a quello, o dopo una rinomina con
  // backlink non si ridisegna più (fub_abi::event, decisione 0011).
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
  | { type: "entry_renamed"; from: string; to: string; kind: EntryKind }
  // QUALCOSA È ANDATO STORTO (§20.2, decisione 0052). La variante che la 0013
  // aveva previsto — «ciò che si limita a informare è un evento» — e rimandato
  // per mancanza di clienti; il cliente da questa parte è il centro notifiche,
  // che aveva già la porta (`notify`) e venti chiamanti al posto di una
  // sorgente.
  //
  // `subject` è il documento di cui si parla, `null` per ciò che riguarda il
  // vault intero (un flush fallito, il watcher che smette). CHI ha causato il
  // guasto non sta qui: lo dice `origin.actor`. DA QUALE PORTA è entrato lo
  // dice `gate` (§17.3, decisione 0161): la porta del panico da cui il kernel
  // stava chiamando codice di un provider, `null` per i guasti che da una
  // porta non passano. In fondo al record come ogni campo nuovo.
  | {
      type: "trouble";
      severity: Severity;
      subject: string | null;
      error: PluginError;
      gate: Gate | null;
    }
  // UNA SVEGLIA DICHIARATA NEL MANIFEST È SCADUTA (§22.1, decisione 0069).
  // `owner` è il componente che l'ha dichiarata, `timer` il nome che le ha
  // dato: chi si sveglia riconosce i propri come chi ha lanciato un job
  // riconosce il proprio `job_done`.
  | { type: "timer_fired"; owner: string; timer: string };

// COSA è cambiato in un documento (rispecchia fub_abi::event::DocChanges,
// §22.2). Gli ASPETTI sono l'insieme chiuso su cui una maschera filtra; i NOMI
// — quali chiavi di frontmatter, quali tag — si leggono e non si filtrano,
// perché il diff che li produce è già in mano a chi emette l'evento: chi si
// sveglia non rilegge il documento per scoprire se lo riguardava.
export interface DocChanges {
  aspects: DocChange[];
  properties: string[];
  tags_added: string[];
  tags_removed: string[];
}

// Quanto pesa ciò che è andato storto (rispecchia fub_abi::event::Severity).
// Due gradini, come i due toni del centro notifiche, e il criterio del taglio è
// la CLASSE DEL DATO perso (decisione 0048): un derivato si ricostruisce
// riaprendo il vault ed è un avviso; ciò che era autorevole non torna ed è un
// guasto.
export type { Severity } from "./enums.generated";

// DA QUALE PORTA è entrato un guasto (rispecchia fub_abi::gate::Gate, §17.3):
// l'elenco chiuso dei punti in cui il kernel entra nel codice di un provider.
// Lo nomina `trouble.gate` — sapere da che parte guardare quando un componente
// di terzi esplode è metà della diagnosi, e prima della 0161 non attraversava
// il confine.
export type { Gate } from "./enums.generated";

// DOVE: il soggetto di un abbonamento (rispecchia fub_abi::event::Subject,
// §10.1). Una cartella è un PREFISSO di path finché il §14.3 non ne fa un
// cittadino del kernel; la stringa vuota è la radice.
export type Subject =
  | { kind: "document"; id: string }
  | { kind: "folder"; path: string };

// A COSA si è abbonati (rispecchia fub_abi::event::EventMask, §10.1): le
// specie, i prefissi di topic dei custom, il soggetto, e COSA è cambiato
// (§22.2). I quattro sono in AND, e ognuno vuoto vuol dire *non filtro*.
//
// Applicarla non è affare di questo file: la regola è **una sola** e sta in
// `rules/mirrored.ts` (`maskWants`), gemella di
// `fub_abi::rules::events::mask_wants` e legata a lei dalla fixture generata.
export interface EventMask {
  kinds: KernelEvent["type"][];
  topics: string[];
  subjects: Subject[];
  changes: DocChange[];
}

// Chi ha CHIESTO l'operazione da cui un evento nasce (rispecchia
// fub_abi::event::Actor). Non chi l'ha eseguita: un comando invocato da
// un'automazione porta l'origine dell'automazione.
export type Actor =
  | { kind: "user" }
  | { kind: "watcher" }
  | { kind: "kernel" }
  | { kind: "plugin"; id: string };

// Da dove viene un evento (fub_abi::event::Origin). `batch` è `null` fuori da
// un lotto.
export interface Origin {
  actor: Actor;
  batch: string | null;
}

// Ciò che il ponte Tauri consegna davvero: l'evento E la sua origine
// (fub_abi::event::Notice, decisione 0012), più il vault di cui è il fatto
// (fub_host::ShellNotice, #216). `vault` è la radice canonica, la stessa di
// `VaultInfo.root`; manca per un fatto della macchina (una chiave di
// configurazione, un avviso tirato con `session_notice`).
export interface KernelNotice {
  event: KernelEvent;
  origin: Origin;
  vault?: string;
}

// La dichiarazione di una view offerta da un provider (rispecchia
// fub_abi::traits::ViewSpec). `placement` dice DOVE montarla; `refresh` e
// `follows` dicono QUANDO ridisegnarla: gli eventi del kernel al cui arrivo
// serve un nuovo `render_view`, e le parti del contesto di sessione al cui
// cambio la view invecchia. Chi non dichiara `follows` non si ridisegna per il
// contesto — è ciò che tiene fuori il pannello tag da ogni movimento del
// cursore.
// Dove una view si ancora. Dieci superfici, e non è un modello di layout: dice
// a cosa ci si attacca, non come lo spazio è diviso (§2.2).
export type { ViewSurface } from "./enums.generated";

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
