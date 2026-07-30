// FILE GENERATO — non modificare a mano.
//
// Le union di stringhe del contratto, emesse dagli `enum` senza payload di
// `fub-abi` (crates/fub-abi/tests/ts_enums.rs, decisione 0053). I casi e il
// loro ORDINE vengono dalla dichiarazione Rust; la forma delle stringhe è
// quella di serde (`rename_all = "snake_case"`), cioè quella che attraversa
// davvero l'IPC — non quella del WIT, che è un altro confine.
//
// La prosa di ognuna sta accanto alla sua ri-esportazione in `contract.ts`: qui
// non ci sono commenti perché qui non c'è niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums

export type Align = "start" | "center" | "end";

export type Axis = "row" | "column";

export type ColumnAlign = "none" | "left" | "center" | "right";

export type CommandReach = "session" | "document" | "documents" | "vault" | "settings";

export type ConflictPolicy = "skip" | "replace" | "rename";

export type ContextKind = "document" | "selection" | "mode";

export type EntryKind = "document" | "asset" | "unknown";

export type EventKind =
  | "vault_opened"
  | "document_changed"
  | "document_removed"
  | "document_renamed"
  | "index_updated"
  | "job_done"
  | "overflow"
  | "custom"
  | "batch_ended"
  | "view_invalidated"
  | "vault_closed"
  | "job_started"
  | "job_progress"
  | "setting_changed"
  | "entry_changed"
  | "entry_removed"
  | "entry_renamed"
  | "trouble"
;

export type HealthCheck = "broken_links" | "orphan_documents";

export type HourCycle = "h23" | "h12";

export type ImportMode = "preview" | "apply";

export type Intent = "neutral" | "primary" | "danger";

export type InvokeMode = "apply" | "dry_run";

export type LinkDirection = "outbound" | "inbound" | "both";

export type NoteLevel = "info" | "warning" | "error";

export type PaneMode = "source" | "live_preview" | "reading";

export type RenderTarget = "screen" | "print" | "pdf" | "static_site";

export type SettingScope = "vault" | "machine";

export type SettingSource = "default" | "machine" | "vault";

export type Severity = "warning" | "failure";

export type SourceKind = "text" | "bytes";

export type TextField = "name" | "body" | "tags" | "heading";

export type TextMode = "terms" | "phrase";

export type TextTolerance = "exact" | "typos";

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
  | "settings_tab"
;

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"
;
