//! Versioning del vault: snapshot per-file, tombstone, ripristino.
//!
//! È **dogfooding del contratto**, e stavolta fino in fondo: il campionatore è
//! un [`EventHandler`](fub_abi::traits::EventHandler) e lo store scrive
//! esclusivamente attraverso l'[`HostApi`](fub_abi::traits::HostApi) — niente
//! `std::fs`, niente orologio di sistema, nessuna idea di dove sia il vault.
//! Sono gli stessi strumenti che avrà un plugin di terzi a M5.
//!
//! # Cosa ha trovato il dogfooding
//!
//! Nella sua prima versione lo store si scriveva una `versions/` propria sotto
//! la radice dei derivati con
//! `std::fs` e leggeva l'ora da `fub_kernel::time`: funzionava benissimo *da
//! nativo*, e un plugin WASM con l'`HostApi` di allora non avrebbe potuto
//! scriverlo (lo `storage_get/set` è volatile e a chiave→valore, non uno store
//! di snapshot). Il buco era **nel contratto**, non nella feature; è stato
//! chiuso lì, prima del freeze di M4: `data_read/write/remove/list` per lo
//! storage persistente per-plugin, `now_unix_millis` per il tempo,
//! `list_documents` per potersi guardare intorno all'apertura del vault.
//!
//! # Perché gli eventi qui vanno bene (e all'indice no)
//!
//! Un [`Event::Overflow`] può far perdere uno *snapshot intermedio*. Per un
//! campionatore è accettabile: la versione successiva arriverà al prossimo
//! salvataggio, e nel frattempo la verità — il file sul disco — non è cambiata.
//! Un indice no: un indice che perde un aggiornamento non tace, risponde
//! sbagliato. È la ragione per cui gli indici il kernel li alimenta da sé e il
//! versioning invece passa di qui.
//!
//! La perdita tollerabile riguarda gli eventi di contenuto
//! ([`Event::DocumentChanged`] e [`Event::EntryChanged`]). Perdere un
//! evento **strutturale** costa altro, e la distinzione è sostanziale:
//!
//! - un [`Event::DocumentRenamed`] perso spezzerebbe la storia in due chiavi
//!   *per sempre*: [`VersionStore::rename`] non verrebbe mai chiamato, la vecchia
//!   storia resterebbe orfana su un path che non esiste più e sul nuovo path
//!   nascerebbe una seconda storia senza passato;
//! - un [`Event::DocumentRemoved`] perso lascerebbe la vista "vault al tempo T"
//!   **a mentire**: nessun tombstone, quindi una nota cancellata risulterebbe
//!   ancora viva.
//!
//! # Una nota cestinata non ha più il suo path
//!
//! La storia è per path, e il path di una nota cestinata torna libero: chi lo
//! riprende è un'altra nota, e se la storia restasse sotto quel path
//! comincerebbe da quella della prima (il primo salvataggio *«fa tornare in vita»*
//! la chiave, e ci aggiunge le sue versioni). Quando arriva il
//! [`Event::DocumentRemoved`] di una nota che il cestino ha preso, la storia
//! passa quindi sotto l'identità che la voce ha lì dentro, la stessa con cui il
//! kernel annuncerà il ritorno ([`Event::DocumentRenamed`] dalla voce al path
//! d'arrivo): resta leggibile lì, e al ripristino segue la nota dovunque vada.
//! Se la voce non si trova — una cancellazione che il cestino non ha visto, un
//! cestino illeggibile — vale il comportamento di sempre: un tombstone sul path.
//!
//! Per questo l'handler è abbonato anche a [`EventKind::Overflow`] e riconcilia:
//! `IndexQuery::Entries` elenca i file correnti, e ciò che lo store crede vivo e il
//! vault non ha più prende un tombstone. La frattura da rename perso degrada a
//! "nuova storia + tombstone della vecchia" — la cronologia si spezza, ma niente
//! mente sul presente, e il contenuto vecchio resta leggibile. Vedi
//! `../../../docs/project/status.md`, riga "Versioning".
//!
//! # Lo store, e chi comanda fra store e indice
//!
//! Path relativi allo spazio dati che l'host assegna al plugin
//! (`.fub/plugins/fub.versioning/`):
//!
//! ```text
//! versions.json                    indice: doc_id → versioni + tombstone
//! <dir>/meta.json                  { doc_id, deleted_at, versions: [{ts, hash, size}] }
//! <dir>/<ts>.<ext>                 i byte originali di una versione
//! ```
//!
//! Gli snapshot e `meta.json` sono autorevoli; soltanto l'indice si può
//! ricostruire. La posizione sotto `.fub/plugins` non rende questi file cache
//! eliminabili.
//!
//! `versions.json` è **derivato**: se manca, non si legge o non torna, si
//! ricostruisce leggendo lo store (ogni cartella dice di chi è, ogni file dice
//! quando). Mai il contrario — stessa filosofia del manifest dell'indice di
//! ricerca. Per questo il `doc_id` vive anche dentro la cartella: senza, un
//! indice perso renderebbe le versioni irraggiungibili, visto che il nome della
//! cartella è un'impronta e le impronte non si invertono.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::Fnv1a;
use fub_abi::event::{Event, EventKind, EventMask, Notice, Severity};
use fub_abi::model::DocId;
use fub_abi::rules::media;
use fub_abi::schema::SchemaVersion;
use fub_abi::session::ContextMask;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, EntryKind, EventHandler, FolderScope, HostApi, HostQuery, IndexQuery,
    IndexResult, ReadApi, VaultEntry, VaultRead, ViewInstance, ViewInterests, ViewProvider,
    ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

/// Identità del versioning come plugin: è lo spazio dello storage persistente
/// che l'host gli concede. Lo assegna chi registra l'handler — non la feature.
pub const VERSIONING_ID: &str = "fub.versioning";

/// Versione del formato dello store. Da incrementare se cambia la struttura
/// su disco: un indice di un'altra epoca si butta e si ricostruisce.
/// Le chiavi delle stringhe che il versioning scrive a un umano. Sono **tutte**
/// messaggi d'errore, ed è la conseguenza diretta della
/// [decisione 0041](../../../docs/decisions/0192-impostazioni-locale-e-temi.md):
/// un componente senza pannelli non ha prosa da mostrare finché non va storto
/// qualcosa, e allora ne ha soltanto quella. I punti in cui qualcosa va storto
/// durante il lavoro del versioning non stanno più su `stderr`: ognuno lascia
/// una riga di `tracing`, e quelli che raccontano una perdita di una versione
/// aprono anche il canale degli eventi (`Event::Trouble`, decisione 0062) —
/// perché una versione persa è una cosa che chi scrive ha il diritto di sapere,
/// e non una diagnosi per chi sviluppa.
const NO_VERSIONS: &str = "no_versions";
const NO_SUCH_VERSION: &str = "no_such_version";
const CONTENT_GONE: &str = "content_gone";
const CONTENT_MISMATCH: &str = "content_mismatch";
const UNREADABLE: &str = "unreadable";
const METADATA_UNWRITABLE: &str = "meta_unwritable";
const INDEX_UNWRITABLE: &str = "index_unwritable";
/// Una versione attesa non è stata salvata: il versioning non ha potuto
/// fotografare il documento. È un guasto `Failure` (0052): una versione è la
/// rete di sicurezza di chi scrive, e perderla vuol dire perdere la possibilità
/// di tornare a quel punto.
const VERSION_UNSAVED: &str = "version_unsaved";
/// Quanto può essere vecchia una voce del cestino perché la si riconosca come
/// quella di una cancellazione che l'handler sta ricevendo: gli eventi si
/// consegnano subito dopo l'operazione, e una voce più vecchia di così è di
/// un'altra nota.
const TRASH_RECENT_SECS: u64 = 600;

/// Il tombstone di un documento non è stato scritto: la sua storia resta viva
/// quando dovrebbe essere chiusa. `Failure` (0052).
const TOMBSTONE_UNWRITABLE: &str = "tombstone_unwritable";
/// Le stringhe del **pannello cronologia** e del comando che ripristina. Sono
/// l'eccezione al capoverso qui sopra — da quando questa feature ha una view,
/// non è più vero che la sua unica prosa siano gli errori.
const VIEW_TITLE: &str = "view_title";
const NO_ACTIVE_DOC: &str = "no_active_doc";
const EMPTY: &str = "empty";
const COUNT: &str = "count";
const CURRENT: &str = "current";
const SIZE: &str = "size";
const FIRST_VERSION: &str = "first_version";
const GREW: &str = "grew";
const SHRANK: &str = "shrank";
const SAME_SIZE: &str = "same_size";
const RESTORE_LABEL: &str = "restore";
const RESTORE_QUESTION: &str = "restore.question";
const RESTORE_CONFIRM_LABEL: &str = "restore.confirm";
const RESTORE_CANCEL_LABEL: &str = "restore.cancel";
const CLOSE_PREVIEW: &str = "close_preview";
const BINARY_PREVIEW: &str = "binary_preview";
const COMPARE_LABEL: &str = "compare";
const COPY_LABEL: &str = "copy";
const SHOW_TEXT: &str = "show_text";
const DIFF_SUMMARY: &str = "diff.summary";
const DIFF_SAME: &str = "diff.same";
const DIFF_ENDINGS: &str = "diff.endings";
const DIFF_TOO_LARGE: &str = "diff.too_large";
const DIFF_SKIPPED: &str = "diff.skipped";
const DIFF_TRUNCATED: &str = "diff.truncated";
const DIFF_BINARY: &str = "diff.binary";
const DIFF_CURRENT_TOO_LARGE: &str = "diff.current_too_large";
const RESTORE_TOO_LARGE: &str = "restore.too_large";
/// Il titolo di una riga e dell'anteprima: **l'istante**, declinato. È una
/// chiave e non un `Arg::timestamp` nudo perché un `Text::Message` senza
/// template nel catalogo ricade sulla chiave nuda — e prima di questa chiave
/// la riga diceva letteralmente «when» al posto della data.
const WHEN_TITLE: &str = "when.title";
const RESTORE_TITLE: &str = "version.restore.title";
const RESTORE_DESC: &str = "version.restore.desc";
const RESTORE_DOC_TITLE: &str = "version.restore.doc.title";
const RESTORE_DOC_DESC: &str = "version.restore.doc.desc";
const RESTORE_TS_TITLE: &str = "version.restore.ts.title";
const RESTORE_TS_DESC: &str = "version.restore.ts.desc";
const PLAN_RESTORE: &str = "plan.restore";
const DONE_RESTORE: &str = "done.restore";
const UNDO_RESTORE: &str = "undo.restore";
const AND_NO_NOTES_GIVEN: &str = "err.no_note_given";
const E_NO_TS_GIVEN: &str = "err.no_ts_given";
const CLEAR_TITLE: &str = "version.clear.title";
const CLEAR_DESC: &str = "version.clear.desc";
const PLAN_CLEAR: &str = "plan.clear";
const DONE_CLEAR: &str = "done.clear";
const S_GROUP: &str = "s.group";
const S_INTERVAL: &str = "s.interval";
const S_INTERVAL_DESC: &str = "s.interval.desc";
const S_RETENTION: &str = "s.retention";
const S_RETENTION_DESC: &str = "s.retention.desc";

/// I nomi degli argomenti.
const DOC: &str = "doc";
const WHEN: &str = "when";
const PATH: &str = "path";
const REASON: &str = "reason";
const LIMIT: &str = "limit";
const VERSIONS: &str = "versions";
const NOTES: &str = "notes";

mod catalog;
mod commands;
mod diff;
mod handler;
mod persist;
mod store;
#[cfg(test)]
mod tests;
mod view;

pub use catalog::catalog;
pub use commands::VersioningCommands;
use diff::{comparison, row};
#[cfg(test)]
use diff::{line_diff, Change, DIFF_MAX_LINES};
pub use handler::VersioningHandler;
#[cfg(test)]
use persist::fresh_dir;
use persist::{
    blob, cap_in_mib, entries, load_index, over_the_cap, prune, read_index, rebuild_from_store,
    relocate, snapshot_name, sweep, unread_over_the_cap, write_index, Batch,
};
#[cfg(test)]
use store::BAND_DAILY;
#[cfg(test)]
use store::MS_MINUTE;
pub use store::{
    settings, VersionRef, VersionStore, MAX_VERSION_BYTES, VERSIONING_INTERVAL_KEY,
    VERSIONING_RETENTION_KEY,
};
use store::{
    Claim, DocVersions, Entry, Index, IndexToWrite, Inner, Meta, Plan, PlanDocs, Retention,
    BAND_ALL, BAND_HOURLY, INDEX_FILE, METADATA_FILE, MS_DAY, MS_HOUR, SCHEMA_VERSION,
};
#[cfg(test)]
use view::tree;
use view::{read_snapshot, version_source_doc, A_PREVIEW, TS};
pub use view::{HistoryView, HISTORY_VIEW, VERSION_CLEAR, VERSION_RESTORE};
