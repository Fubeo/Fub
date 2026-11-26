// I tipi del confine, rispecchiati a mano dal Rust — e nient'altro.
//
// Stanno in `host/` perché sono la forma di ciò che attraversa l'IPC, ma sono
// deliberatamente **separati da `ipc.ts`**: qui non si importa `@tauri-apps`, e
// un modulo che vuole solo *nominare* un `SearchHit` non si tira dentro la
// cucitura Tauri. È la metà di tipi della regola del §1.3 — la cucitura è una
// sola, ma il contratto lo legge tutta la shell.
//
// Che non divergano dal Rust non è affidato all'attenzione: la fixture generata
// da serde (`crates/fub-features/tests/ts_mirror.rs` e la gemella dell'app)
// e `mirror.test.ts` rendono rossi entrambi i lati se un lato cambia.
//
// E una parte non è più rispecchiata affatto: le union di stringhe degli `enum`
// SENZA PAYLOAD del contratto stanno in `enums.generated.ts`, emesse dai tipi
// Rust (decisione 0053). Qui restano la loro PROSA e la loro ri-esportazione —
// cioè le due cose che non si derivano da niente: perché quel tipo esiste, e
// che la shell lo usi. I casi no: quelli sono un derivato, e chi ne aggiunge
// uno in Rust rende rosso il file generato senza doversene ricordare.
//
// I tipi stanno in un file per tema (`contract-ui.ts`, `contract-commands.ts`,
// `contract-live.ts`, `contract-grid.ts`, `contract-drawing.ts`,
// `contract-query.ts`, `contract-settings.ts`); questo modulo li ri-esporta
// tutti, e la shell continua a importare da qui.

import type { ThemeEngine, ThemeFontStyle, ThemeLight, ThemeMotion } from "./enums.generated";
import type { SettingKind } from "./contract-settings";

export type {
  ActionRef,
  Actor,
  Align,
  Axis,
  DocChanges,
  EventMask,
  FieldValue,
  Gate,
  Intent,
  KernelEvent,
  KernelNotice,
  KeyValueEntry,
  Origin,
  Severity,
  Subject,
  TableColumn,
  UiAction,
  UiDrag,
  UiKind,
  UiNode,
  UiOption,
  UiValue,
  ViewInstance,
  ViewSpec,
  ViewSurface,
  ViewUpdate,
} from "./contract-ui";
export { MAIN_PANE } from "./contract-commands";
export type {
  AnchoredSelection,
  AnchoredSelections,
  Choice,
  CommandEffect,
  CommandOutcome,
  CommandPlan,
  CommandReach,
  CommandScope,
  CommandSpec,
  CommandSurface,
  ContextKind,
  DocumentSource,
  DocumentText,
  DocumentWindowEvent,
  DocumentWindowRequest,
  EditRequest,
  Failure,
  FloatingSelection,
  FloatingSelections,
  HourCycle,
  InvokeMode,
  Locale,
  PaneMode,
  ParamKind,
  ParamSpec,
  Partial,
  PlannedEdit,
  ResourceDescriptor,
  ResourceKind,
  ResourceWriteOptions,
  ResourceWriteReceipt,
  SelectionSet,
  TextEdit,
  Undo,
  UndoStep,
  ViewContext,
  Weekday,
} from "./contract-commands";
export type {
  LiveAddress,
  LiveCaps,
  LiveClock,
  LiveCounter,
  LiveDevice,
  LiveEndReason,
  LiveEvent,
  LiveLeaveReason,
  LiveNackReason,
  LiveOp,
  LivePairing,
  LivePendingCommit,
  LiveReleaseReason,
  LiveSessionInfo,
  LiveShellMessage,
  LiveStart,
  LiveStarted,
  LiveStats,
  LiveStatus,
  LiveStopReport,
  LiveView,
  LiveWriterStatus,
} from "./contract-live";
export {
  GRID_BYTES_PROTOCOL_VERSION,
  GRID_FAMILY,
  GRID_MEDIA_TYPES,
  GRID_STACKED_ROTATION,
  GRID_THEME_COLORS,
  MAX_GRID_KNOWN_MEDIA,
  MAX_GRID_MEDIA_BYTES,
  MAX_GRID_MEDIA_KEY_BYTES,
  MAX_GRID_OBJECT_SVG_BYTES,
  MAX_GRID_SHAPE_TEXT_BYTES,
  MAX_GRID_WINDOW_OBJECTS,
} from "./contract-grid";
export type {
  GridApplyRequest,
  GridBook,
  GridBorder,
  GridBorderStyle,
  GridBorders,
  GridBytesCell,
  GridBytesSession,
  GridBytesWindow,
  GridCalculation,
  GridCellKey,
  GridCellPatch,
  GridCellStyle,
  GridColumn,
  GridCommand,
  GridCommandOutcome,
  GridCommandRequest,
  GridCommandState,
  GridComment,
  GridCommentReply,
  GridCommit,
  GridDataBar,
  GridDialog,
  GridHorizontalAlign,
  GridIcon,
  GridInvalidation,
  GridLink,
  GridMedia,
  GridMerge,
  GridNotice,
  GridObject,
  GridObjectKind,
  GridObjectMissing,
  GridRow,
  GridScript,
  GridSelection,
  GridShape,
  GridShapeAlign,
  GridShapeAnchor,
  GridShapeKind,
  GridSheet,
  GridSheetView,
  GridSourceEdit,
  GridSurfaceSpec,
  GridTable,
  GridUnderline,
  GridValue,
  GridVerticalAlign,
  GridViewMode,
  GridWindowRequest,
} from "./contract-grid";
export {
  DRAWING_COMMAND_FAMILY_PREPARE,
  DRAWING_COMMAND_FILL_COLOR,
  DRAWING_COMMAND_STROKE_COLOR,
  DRAWING_COMMAND_TOOL_OPTION,
  DRAWING_COMMAND_TOOL_STATE,
  DRAWING_COMMAND_WIDTH,
  DRAWING_FAMILIES,
  MAX_DRAWING_COLOR_BYTES,
  MAX_DRAWING_INPUTS,
  MAX_DRAWING_LOSSES,
  MAX_DRAWING_OPS,
  MAX_DRAWING_OPS_BYTES,
  MAX_DRAWING_TEXT_BYTES,
  MAX_DRAWING_TOOL_ID_BYTES,
  MAX_GESTURE_EVENTS,
} from "./contract-drawing";
export type {
  DrawingAnchor,
  DrawingChange,
  DrawingCommandInfo,
  DrawingCommandRequest,
  DrawingDisabledReason,
  DrawingEdit,
  DrawingFrame,
  DrawingGesture,
  DrawingInput,
  DrawingKeyMods,
  DrawingLoss,
  DrawingLossKind,
  DrawingOpen,
  DrawingOutcome,
  DrawingOverlay,
  DrawingOverlayRole,
  DrawingPhase,
  DrawingPoint,
  DrawingPointer,
  DrawingPointerKind,
  DrawingPreview,
  DrawingRefusal,
  DrawingSnap,
  DrawingStyle,
  DrawingSync,
  DrawingSynced,
  DrawingTool,
  DrawingToolState,
  EmbedContent,
  RenderedDocument,
  RenderedPart,
  Span,
  WriteBase,
} from "./contract-drawing";
export {
  EVERY_DOCUMENT,
  nameQuery,
  textInDocument,
  textQuery,
  theseDocuments,
} from "./contract-query";
export type {
  DocPosition,
  DocumentMatch,
  DraftInfo,
  DueBound,
  EntryKind,
  Excerpts,
  FolderScope,
  Heading,
  HealthIssue,
  IndexQuery,
  IndexResult,
  LinkDirection,
  LinkTarget,
  NeighborRef,
  Page,
  Paged,
  PropertyCount,
  PropertyFilter,
  PropertySelect,
  QueryClause,
  QueryExpr,
  QueryLiteral,
  QueryPredicate,
  ResolvedRef,
  SyntaxForm,
  SyntaxTrigger,
  TaskStatus,
  TextField,
  TextMode,
  TextQuery,
  TextScope,
  TextTolerance,
  VaultEntry,
  VaultFolder,
} from "./contract-query";
export { COMMANDS } from "./contract-settings";
export type {
  BundleInfo,
  CatalogEntry,
  CatalogProvenance,
  ComponentAction,
  ComponentEffect,
  ComponentGroup,
  ComponentKind,
  ComponentMissing,
  ComponentOrphans,
  ComponentOutcome,
  ComponentProfile,
  ComponentRefusal,
  ComponentRow,
  ComponentState,
  ComponentWhy,
  ComponentWrite,
  ComponentsApplied,
  ComponentsMap,
  ExportArtifact,
  ExportContent,
  ExportReport,
  IndexingState,
  InstalledPluginInfo,
  JobProgress,
  JobStatus,
  KnownVault,
  Organization,
  SettingEntry,
  SettingKind,
  SettingScope,
  SettingSource,
  SettingSpec,
  SettingValue,
  TagCount,
  TransferNote,
  TrashEntry,
  VaultStatus,
  ViewerAction,
  ViewerEvent,
} from "./contract-settings";

// Manifest congelato della pelle: non passa dal WIT, ma resta parte del confine.
export const THEME_ENGINE = "theme-1" as const;

export type { ThemeEngine, ThemeFontStyle, ThemeLight, ThemeMotion } from "./enums.generated";

/**
 * Un carattere che un tema porta (da `theme-2`). Il CSS del tema non scrive
 * `@font-face`: la regola la scrive il loader, coi valori di qui e l'URL
 * `data:` del file, e la pelle usa la famiglia per nome.
 */
export interface ThemeFont {
  /** Lettere e cifre ASCII, `-` e spazi singoli; al massimo 64; non di serie. */
  family: string;
  /** `fonts/<nome>.woff2`, cioè l'asset `theme://<id>/fonts/<nome>.woff2`. */
  file: string;
  /** Da 100 a 900. */
  weight: number;
  style: ThemeFontStyle;
}

/**
 * Un'impostazione che un tema dichiara per sé (da `theme-2`). L'host la
 * dichiara al registro delle impostazioni con la chiave `<id>:<name>`, a
 * livello macchina: si legge e si scrive come ogni altra impostazione.
 */
export interface ThemeSetting {
  /** Il nome dentro il tema: `a-z`, `0-9`, `-`. */
  name: string;
  /** Prosa, non una chiave: un tema non ha un catalogo di stringhe. */
  label: string;
  description: string;
  /** Un tema ne usa tre: `toggle`, `number`, `choice`. */
  kind: SettingKind;
}

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  engine: ThemeEngine;
  lights: ThemeLight[];
  asset_namespace: string;
  motion: ThemeMotion[];
  /** Assente quando il tema non ne dichiara. */
  settings?: ThemeSetting[];
  /**
   * Il tema da cui questo parte, da `theme-2`: oggi solo la serie
   * (`fub.serie`). Assente quando il tema porta tutto da sé.
   */
  extends?: string;
  /** I caratteri del tema, da `theme-2`. Assente quando non ne porta. */
  fonts?: ThemeFont[];
  /**
   * Il set di icone del tema, da `theme-2`: il nome di un asset JSON accanto
   * al manifest (`icons.json`), `{ "<nome>": ["<d>", …] }`. Assente quando non
   * ne porta.
   */
  icons?: string;
}

/** Un tema installato che il backend può consegnare alla shell. */
export interface ThemeInfo {
  manifest: ThemeManifest;
  /** Bundled series is core; an installed theme is community code. */
  trust: Trust;
}

/** Una luce di un tema installato, già letta dal backend. */
export interface ThemePayload {
  manifest: ThemeManifest;
  light: ThemeLight;
  /**
   * `null` solo per un tema con `extends` che non porta il foglio di questa
   * luce: vale quello di serie, della stessa luce e dello stesso contrasto.
   */
  sheet: string | null;
  skin: string | null;
  assets: Record<string, readonly number[]>;
}

/**
 * Perché la cartella scelta non è un tema che Fub installa
 * (`fub_host::theme::ThemeFolderRefusal`), coi campi per dirlo. La shell lo
 * dice con le sue parole; `malformed.detail` è il motivo dell'host così com'è.
 */
export type ThemeFolderRefusal =
  | { reason: "not_a_theme" }
  | { reason: "engine"; declared: string }
  | { reason: "permissions" }
  | { reason: "invalid_id"; id: string }
  | { reason: "series" }
  | { reason: "traversal"; path: string }
  | { reason: "catalog_state"; file: string }
  | { reason: "malformed"; detail: string };

/**
 * Il fascio di una luce della cartella, come lo chiede il cancello della shell
 * (`fub_host::theme::ThemeFolderLight`): i byte solo degli asset che il
 * cancello legge (i caratteri, il set di icone), gli altri asset per nome.
 */
export interface ThemeFolderLight {
  light: ThemeLight;
  sheet: string | null;
  named: string[];
}

/**
 * La cartella di un tema scelta nella finestra nativa e letta senza
 * installarla (`check_theme_folder`, `fub_host::theme::ThemeFolderCheck`).
 * La webview non dà il path: lo sceglie la persona, e l'host tiene la
 * cartella controllata.
 *
 * - `cancelled`: la finestra di scelta è stata chiusa;
 * - `ready`: passa le porte dell'host; il manifest, il fascio di ogni luce
 *   dichiarata e l'impronta che l'installazione chiede di nuovo. `folder` è
 *   il path scelto, da mostrare;
 * - `refused`: la cartella non è un tema installabile, e perché.
 */
export type ThemeFolderCheck =
  | { outcome: "cancelled" }
  | {
      outcome: "ready";
      folder: string;
      manifest: ThemeManifest;
      skin: string | null;
      assets: Record<string, readonly number[]>;
      lights: ThemeFolderLight[];
      digest: string;
    }
  | { outcome: "refused"; folder: string; refusal: ThemeFolderRefusal };

/**
 * Perché il disco non ha lasciato scrivere un tema (`fub_host::theme::DiskCause`):
 * pieno (o la quota finita), negato (i permessi, un disco in sola lettura), un
 * altro guasto.
 */
export type DiskCause = "full" | "denied" | "other";

/**
 * Perché un'installazione da cartella non tocca ciò che c'è già nella cartella
 * dei temi di Fub (`fub_host::theme::ThemeBlock`): il tema installato con lo
 * stesso id ha il file della versione del catalogo che non si legge
 * (`pointer`: potrebbe dire «ritirato»), al suo posto o al posto della
 * cartella dei temi c'è un collegamento (`link`), o non è una cartella che Fub
 * sa usare (`layout`).
 */
export type ThemeBlock = "pointer" | "link" | "layout";

/**
 * Da quale parte un'installazione da cartella non è riuscita a leggere
 * (`fub_host::theme::ThemeSide`): la cartella scelta o la cartella dei temi
 * di Fub.
 */
export type ThemeSide = "folder" | "themes";

/**
 * Com'è andata un'installazione da cartella (`install_theme_from_folder`,
 * `fub_host::theme::ThemeFolderInstall`). Ogni fermata è un esito; un
 * `PluginError` resta solo per la modalità sviluppatore spenta
 * (`permission_denied`) e la configurazione che manca (`unserved`).
 *
 * - `installed`: il tema è installato; `replaced` se ha preso il posto di uno
 *   con lo stesso id;
 * - `collision`: un tema con lo stesso id c'è già e niente è stato toccato; la
 *   cartella nuova è già controllata. `installed_version` è `null` quando
 *   quello installato non si legge più;
 * - `revoked`: il tema installato con lo stesso id è revocato dal catalogo, e
 *   una cartella non lo sostituisce; niente è stato toccato;
 * - `blocked`: ciò che c'è nella cartella dei temi di Fub non si tocca (`why`),
 *   e `path` è dove, da mostrare; `installed` se è il tema già installato con
 *   lo stesso id (che resta com'era), no se è la cartella dei temi; niente è
 *   stato toccato;
 * - `unreadable`: una lettura non è riuscita (`side`: la cartella scelta, con
 *   i byte del controllo, o la cartella dei temi); niente è scritto, e non è
 *   un guasto di scrittura. `error` è il guasto così com'è, mai da mostrare;
 * - `replace_failed`: il nuovo si è fermato e il vecchio non è riuscito a
 *   tornare al suo nome. `kept` è il nome della cartella, dentro la cartella
 *   dei temi, dove il vecchio è rimasto: la shell lo dice con le sue parole.
 *   `error` è il guasto del disco così com'è, per «Copia la diagnosi» e il
 *   log, mai da mostrare; la cartella sorgente resta dov'è;
 * - `refused`: le porte dell'installazione hanno rifiutato i byte controllati,
 *   come un rifiuto del controllo; niente è scritto;
 * - `changed`: la cartella non ha più i byte del controllo; niente è scritto;
 * - `unchecked`: non c'è un controllo con questa impronta (uno più recente ha
 *   preso il suo posto, o è già stato usato o scartato); niente è scritto;
 * - `failed`: il disco non ha lasciato scrivere e niente è cambiato (con
 *   `replace`, quello installato è com'era). `cause` è il perché da dire;
 *   `error` è il guasto così com'è, mai da mostrare.
 */
export type ThemeFolderInstall =
  | { outcome: "installed"; id: string; name: string; version: string; replaced: boolean }
  | {
      outcome: "collision";
      id: string;
      name: string;
      version: string;
      installed_version: string | null;
    }
  | { outcome: "revoked"; id: string; name: string; version: string }
  | { outcome: "blocked"; why: ThemeBlock; path: string; installed: boolean }
  | { outcome: "unreadable"; side: ThemeSide; error: PluginError }
  | { outcome: "replace_failed"; id: string; name: string; version: string; kept: string; error: PluginError }
  | { outcome: "refused"; refusal: ThemeFolderRefusal }
  | { outcome: "changed" }
  | { outcome: "unchecked" }
  | { outcome: "failed"; cause: DiskCause; error: PluginError };

/**
 * Che cosa è adesso la cartella del tema collegato
 * (`fub_host::theme::ThemeLinkState`):
 * - `ready`: passa le porte, e compare fra i temi in sviluppo;
 * - `missing`: la cartella non c'è più;
 * - `refused`: non è un tema che Fub legge, coi rifiuti dell'installazione;
 * - `collision`: un tema installato ha lo stesso id;
 * - `unreadable`: il disco non la legge. `error` non si mostra.
 */
export type ThemeLinkState =
  | { state: "ready" }
  | { state: "missing" }
  | { state: "refused"; refusal: ThemeFolderRefusal }
  | { state: "collision" }
  | { state: "unreadable"; error: PluginError };

/**
 * Il tema collegato com'è adesso (`fub_host::theme::ThemeLink`): la cartella
 * (da mostrare), l'id e il nome dell'ultimo manifest letto, lo stato e, nel
 * campanello `fub://theme-changed`, i file salvati relativi alla cartella.
 * `watched` dice se un osservatore vivo guarda la cartella: `false` vuol dire
 * che i salvataggi non arrivano.
 */
export type ThemeLink = {
  folder: string;
  id: string | null;
  name: string | null;
  changed: string[];
  watched: boolean;
} & ThemeLinkState;

/** Com'è andato «Collega una cartella…» (`fub_host::theme::ThemeFolderLink`). */
export type ThemeFolderLink =
  | { outcome: "cancelled" }
  | { outcome: "linked"; link: ThemeLink }
  | { outcome: "refused"; link: ThemeLink };

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
  // COSA NON SI È LETTO (§15.7). Vuoto è il caso normale e vuol dire che il
  // vault si è aperto intero.
  //
  // Ogni voce esce ANCHE come evento `trouble` con quel documento per soggetto,
  // ed è da lì che il centro notifiche la mostra oggi. Sta pure qui perché la
  // coda eventi ha un budget e sotto carico può troncare (§20.5) — e aprire un
  // vault È il carico: «si è aperto intero» è una proprietà dell'operazione, e
  // chi la chiama la legge dall'esito invece di ricostruirla da una sequenza di
  // incidenti che potrebbe non aver ricevuto tutta.
  //
  // Chi lo disegna è `main.ts`, all'apertura (§20.4): il centro notifiche è la
  // superficie che questa riga aspettava.
  unread: UnreadDoc[];
}

// Un documento che l'apertura non ha potuto guardare (§15.7): la scansione lo
// ha trovato — sta nell'albero, ha dimensione e data — ma il contenuto non si è
// letto, o nessun parser lo ha accettato. Quindi non è arrivato a nessun
// indice: non lo trova la ricerca e non ha archi nel grafo.
export interface UnreadDoc {
  doc_id: string;
  // Cosa ha risposto il disco, o il parser.
  why: PluginError;
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
// fub_kernel::Trust). Dal più fidato al meno; `revoked` non gira affatto.
export type Trust = "core" | "verified" | "community" | "development" | "revoked";

// Che specie di cosa un plugin ha registrato
// (rispecchia fub_kernel::RegistrationKind).
export type RegistrationKind =
  | "view"
  | "command"
  | "index"
  | "event_handler"
  | "import"
  | "export"
  | "syntax"
  | "renderer";

// Una cosa che un plugin ha registrato (rispecchia fub_kernel::Registration).
export interface Registration {
  kind: RegistrationKind;
  // L'id registrato. Per handler e importer — che non nominano niente di
  // proprio — è l'id del plugin stesso.
  id: string;
}

// Una riga dell'inventario di ciò che è attivo (rispecchia
// fub_kernel::PluginInfo).
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

// Una versione salvata (rispecchia fub_features::versioning::VersionRef).
export interface VersionRef {
  // Istante dello snapshot in millisecondi UNIX: è anche la sua identità.
  // Resta un number: i millisecondi non arrivano a 2^53 e qui ci si fa
  // aritmetica (`new Date(ts)`).
  ts: number;
  // Impronta u64 PIENA: attraversa l'IPC come stringa, perché `JSON.parse`
  // perde i bit oltre 2^53 in silenzio. È la regola di confine per gli u64
  // identità/impronta (vedi `fub_abi::ipc`); si confronta con ===, mai
  // con l'aritmetica.
  hash: string;
  size: number;
  // Perché la versione è stata conservata a mano (`version.keep`): c'è solo
  // sui testi messi in salvo, mai sulle fotografie del disco.
  note?: string;
}

export interface BacklinkRef {
  source: string;
  context: string | null;
}

// --- l'errore (rispecchia fub_abi::error::PluginError, §12.2) -------------

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
