// I tipi del confine per impostazioni, pagina «Componenti», vault e tag
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type { ComponentKind, IndexingState, SettingScope, SettingSource } from "./enums.generated";
import type { UiOption } from "./contract-ui";
import type { PluginError, Trust } from "./contract";

// --- le impostazioni (§11.1) ------------------------------------------------
//
// Rispecchiano `fub_abi::settings`. Il pezzo che si vede da qui e da nessun
// altro lato: **il form lo genera questa shell**, dallo schema. Un provider
// dichiara cosa si può configurare e legge i valori dall'`HostApi`; disegnare i
// campi è della shell, e per questo questi tipi vivono nel contratto e non in un
// albero `UiNode` — un albero sarebbe la UI di **un** provider, uno schema è ciò
// da cui ogni pannello (questo, quello di un plugin, una CLI) sa costruirla.

// DOVE un'impostazione ha il diritto di stare. Le chiavi `machine` scritte in un
// `.fub/settings.json` si IGNORANO: un vault arriva da fuori, e non decide
// della macchina di chi lo apre.
export type { SettingScope } from "./enums.generated";

// Da dove viene il valore che si sta leggendo. `default` = nessuno ha deciso, ed
// è ciò che permette al pannello di dire «questa la stai sovrascrivendo» e al
// pulsante «azzera» di comparire solo dove serve.
export type { SettingSource } from "./enums.generated";

export type { IndexingState } from "./enums.generated";

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
// `fub_host::BundleInfo`, §11.1).
//
// Non è `PluginInfo`: quello elenca chi è DICHIARATO NEL KERNEL, e un componente
// spento non lo è affatto. La differenza è il punto — «spento» e «non c'è» sono
// due stati diversi, e senza questo elenco il secondo si mangerebbe il primo.
export interface BundleInfo {
  id: string;
  name: string;
  mounted: boolean;
  // La famiglia decide quale gesto la riga offre: un componente si accende, un
  // tema si applica. Non è deducibile da `mounted`, perché anche uno spento
  // deve restare classificabile.
  kind: "component" | "theme";
  // Quanto l'host si fida di chi lo ha prodotto. Non è una decorazione accanto
  // ai permessi: «può leggere le mie note» non vuol dire la stessa cosa detto
  // di una feature di questo repo e di un componente arrivato da fuori.
  trust: Trust;
  // I permessi che il suo manifest dichiara, coi loro parametri (§23.17). La
  // chiave è `ns:nome`, il valore è il PARAMETRO: `true` per un permesso nudo,
  // un elenco di host per `fub:network`. È la stessa regola di ogni altra
  // `OptionMap` — presente = acceso, il valore porta il dettaglio.
  //
  // Ci sono anche per un componente SPENTO, ed è il punto: «cosa chiederebbe se
  // lo accendessi» è una domanda che ci si pone prima di accenderlo.
  permissions: Record<string, unknown>;
}

// Un'installazione scelta su questa macchina. Estende il manifest che l'host
// usa per le righe native, ma tiene separate le tre decisioni che non sono lo
// stesso stato: preferenza persistita, consenso all'esecuzione e montaggio
// effettivo nel vault corrente.
/** Verified feed provenance; generation is a decimal u64 string, not a JS number. */
export interface CatalogProvenance {
  key_id: string;
  generation: string;
  publisher: string;
  url: string;
  license: string;
  compatible: string;
}

/** Entry from a natively verified signed feed. Size is a decimal u64 string. */
export interface CatalogEntry {
  id: string;
  kind: "plugin" | "theme";
  name: string;
  version: string;
  abi: string;
  url: string;
  digest: string;
  size: string;
  permissions: string[];
  license: string;
  compatible: string;
  provenance: string;
  revoked: boolean;
}

export interface InstalledPluginInfo extends BundleInfo {
  // Identità u64 dell'installazione, serializzata come stringa per non perdere
  // bit nel passaggio JSON. È questa, non `id`, che autorizza le mutazioni.
  installation: string;
  version: string;
  enabled: boolean;
  // `true` solo quando il registro runtime conosce la voce posseduta da questa
  // installazione nel vault selezionato. Consente alla UI di togliere il suo
  // duplicato da `listBundles` senza filtrare un bundle ufficiale omonimo.
  runtime_known: boolean;
  consent: "undecided" | "denied" | "granted";
  catalog?: CatalogProvenance;
  revoked: boolean;
  revocation?: CatalogProvenance;
}

// --- la pagina «Componenti» (A7) -------------------------------------------
//
// Rispecchiano `fub_app_lib::{ComponentsMap, ComponentRow, ComponentProfile,
// ComponentsApplied}` e i tipi di `fub_host::componenti` che ci stanno dentro.
// I nomi Rust sono italiani (`Azione`, `Rifiuto`, `Esito`…); qui portano il
// prefisso `Component` perché nel contratto TS stanno accanto a tutto il resto.

export type { ComponentKind } from "./enums.generated";

// Che cosa fare di ciò che dopo uno spegnimento non serve più a nessuno.
// `chiedi` = nessuna risposta: restano accesi, in attesa.
export type ComponentOrphans = "chiedi" | "togli" | "tieni";

// Una scelta di chi usa l'app. I campi con un default in Rust possono mancare.
export type ComponentAction =
  | { azione: "accendi"; id: string }
  | { azione: "spegni"; id: string; anche_questi?: boolean; orfani?: ComponentOrphans }
  | { azione: "rispondi"; orfani: ComponentOrphans; ids?: string[] }
  | { azione: "profilo"; nome: string };

// Perché un componente è acceso, o che non lo è: la forma di default di serde
// (`fub_componenti::Perche`), una stringa o `{ RichiestoDa: [...] }`.
export type ComponentWhy =
  | "Nucleo"
  | "Scelto"
  | { RichiestoDa: string[] }
  | "InAttesa"
  | "Spento"
  | "Sconosciuto";

// Lo stato che il vault ricorda: i componenti scelti e quelli in attesa.
export interface ComponentState {
  scelti: string[];
  in_attesa: string[];
}

// Un id che una chiave `components.*` nomina e che non conta.
export interface ComponentMissing {
  chiave: string;
  id: string;
}

// Una riga della pagina: `nome` e `descrizione` sono già nella lingua del vault
// (l'id e la stringa vuota se il catalogo non li ha: mai una chiave), `gruppo`
// è l'id di un `ComponentGroup` (`altro` se la riga non ne dice uno), `ui` le
// cartelle del client che carica (`editors/media`), `richiede` i requisiti
// diretti già risolti in id, `usa` gli «usa se c'è» che in questa build sono
// righe.
export interface ComponentRow {
  id: string;
  nome: string;
  gruppo: string;
  bundle: boolean;
  acceso: boolean;
  perche: ComponentWhy;
  richiesto_da: string[];
  descrizione: string;
  tipo: ComponentKind;
  ui: string[];
  richiede: string[];
  usa: string[];
}

// Un gruppo della pagina, con il nome nella lingua del vault.
export interface ComponentGroup {
  id: string;
  nome: string;
}

// Un profilo: `etichetta` è il nome da mostrare, nella lingua del vault;
// `piu_avanti` se aspetta componenti che non ci sono ancora (`arriva_con`), e
// allora non si applica.
export interface ComponentProfile {
  nome: string;
  etichetta: string;
  componenti: string[];
  arriva_con: string[];
  piu_avanti: boolean;
}

// Ciò che `components_map` risponde. `profilo` null = personalizzato.
// `gruppi` sono quelli che hanno righe, nell'ordine in cui si disegnano.
export interface ComponentsMap {
  gruppi: ComponentGroup[];
  righe: ComponentRow[];
  stato: ComponentState;
  profilo: string | null;
  profili: ComponentProfile[];
  mancanti: ComponentMissing[];
}

// Che cosa una scelta cambia oltre al componente nominato. `accesi_anche` è
// «Attivati anche …: … non funziona senza»; `mancanti` è `[chi, id]`.
export interface ComponentEffect {
  accesi_anche: string[];
  spenti_anche: string[];
  orfani: string[];
  mancanti: [string, string][];
}

// Una riga che cambia: un bundle (`plugins.disabled`) o una riga senza bundle
// (`components.off`).
export interface ComponentWrite {
  id: string;
  acceso: boolean;
  bundle: boolean;
}

// L'esito di una scelta: prima di farla (`applicato: false`, la prova senza
// `apply`) o dopo. Una scrittura su `fub.lavagna` vuol dire che il vault si è
// rimontato: la shell lo sa anche dall'evento `vault_opened` che segue il
// `vault_closed` (vedi `KernelEvent`).
export interface ComponentOutcome {
  azione: ComponentAction;
  effetto: ComponentEffect;
  scritture: ComponentWrite[];
  chiavi: string[];
  stato: ComponentState;
  applicato: boolean;
  avvisi: PluginError[];
}

// Perché una scelta non si applica: una risposta, non un errore.
export type ComponentRefusal =
  | { rifiuto: "sconosciuto"; id: string }
  | { rifiuto: "nucleo"; id: string }
  | { rifiuto: "richiesto"; id: string; da: string[] }
  | { rifiuto: "profilo_sconosciuto"; nome: string }
  | { rifiuto: "profilo_piu_avanti"; nome: string; arriva_con: string[] };

// Ciò che `components_apply` risponde: l'esito o il rifiuto tipato.
export type ComponentsApplied =
  | ({ risposta: "esito" } & ComponentOutcome)
  | ({ risposta: "rifiuto" } & ComponentRefusal);

// Un vault che questa macchina conosce (rispecchia `fub_host::VaultEntry`,
// §11.1): la memoria fra un avvio e l'altro, che è un'altra cosa da `OpenVaults`
// — quello dice cosa è aperto ADESSO e muore col processo.
//
// Si chiama `KnownVault` e non `VaultEntry` come il tipo Rust perché in Rust i
// due `VaultEntry` — questo e quello dell'anagrafe
// (`fub_abi::traits::VaultEntry`, sopra) — stanno in crate diversi, e in
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
  // Le scorciatoie di questo vault che l'utente ha già guardato (§23.13), chiave
  // d'impostazione → accordo. È l'unico campo che non descrive il vault: dice
  // cosa **questa macchina** ha visto di lui, e per questo vive nel registro
  // della macchina e non nel vault.
  //
  // La shell non lo disegna — chi apre un vault vuole sapere come si chiama, non
  // cosa gli ha risposto. Sta qui perché il mirror è il contratto intero e un
  // campo taciuto è un campo che il giorno che serve nessuno sa esserci.
  keys_seen: Record<string, string>;
}

// Che rapporto ha questo vault con il disco (rispecchia
// fub_abi::traits::VaultStatus, §9.7). Tre domande diverse e non una: Fub
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
  // A che punto è l'indicizzazione dell'apertura (§15.7). Un vault si apre in
  // due tempi: appena scansionato è utilizzabile e la ricerca si popola dopo,
  // quindi chi disegna un risultato deve poter dire «sto ancora indicizzando»
  // invece di «niente trovato», che nei primi secondi di un vault grande
  // sarebbe una risposta falsa.
  indexing: IndexingState;
}

// A CHE PUNTO è un lavoro lungo (rispecchia fub_abi::traits::JobProgress,
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

// Un lavoro lungo VIVO (rispecchia fub_abi::traits::JobStatus, §10.3): da
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

// L'esito di un export, dentro il `result.Ok` del job che lo ha eseguito
// (rispecchia fub_abi::transfer::ExportReport). Un artefatto porta i byte, o la
// ricevuta di quanti ne sono già stati versati dove l'utente li voleva: quella
// è un u64 conteggio e attraversa l'IPC come stringa.
export type ExportContent =
  | { kind: "bytes"; value: readonly number[] }
  | { kind: "delivered"; value: string };

export interface ExportArtifact {
  path: string;
  media_type: string;
  content: ExportContent;
}

export interface TransferNote {
  level: "info" | "warning" | "error";
  message: string;
  entry: string | null;
}

export interface ExportReport {
  artifacts: ExportArtifact[];
  log: TransferNote[];
}

// Un tag del vault con quante note lo portano (rispecchia
// fub_abi::traits::TagCount). `name` è senza `#`, gerarchia intatta (`a/b`).
export interface TagCount {
  name: string;
  count: number;
}

// Una voce del cestino (rispecchia fub_kernel::vault::TrashEntry).
export interface TrashEntry {
  // Dove il file si trova ora, dentro `.trash/`.
  id: string;
  // Dove tornerebbe un ripristino.
  original: string;
  // Istante della cancellazione, in secondi UNIX.
  deleted_at: number;
  size: number;
}

// L'organizzazione del vault (rispecchia fub_abi::organization::Organization):
// icone, note appuntate, ordinamenti per-cartella, spazi. Vive nel sidecar
// `.fub/workspace.json` dentro il vault, e dal §11.3 lo possiede il KERNEL —
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
export const COMMANDS = {
  create: "note.create",
  duplicate: "note.duplicate",
  rename: "note.rename",
  trash: "note.trash",
  restore: "trash.restore",
  clear: "trash.empty",
  createFolder: "folder.create",
  renameFolder: "folder.rename",
  trashFolder: "folder.trash",
  folderPage: "note.folder_page",
  subpage: "note.subpage",
  moveBlock: "note.block.move",
  syncBlock: "note.block.sync",
  tableSheet: "note.table.sheet",
  fromNote: "canvas.from_note",
  osTrash: "trash.os",
  undo: "vault.undo",
  replace: "vault.replace",
} as const;

/**
 * Che cosa succede nella finestra del visore web (`fub://viewer`), detto alla
 * finestra principale. Rispecchia `fub_app::resources::ViewerEvent`.
 */
export type ViewerEvent =
  | { kind: "navigated"; url: string }
  | { kind: "blocked"; url: string }
  | { kind: "closed" };

/** I gesti della barra del visore (`viewer_control`). */
export type ViewerAction = "back" | "forward" | "reload" | "close" | "focus";
