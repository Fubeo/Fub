//! Template nota, note giornaliere, nota univoca/casuale, data/ora e compositore.
//!
//! I template vivono nella cartella `Templates/` del vault (convenzione, non
//! recinto). `note.from_template` legge la sorgente, sostituisce le variabili
//! `{{…}}` e crea una nota nuova. `note.daily` apre o crea
//! `Daily/YYYY-MM-DD`, usando `Templates/Daily` se c'è. Un nome senza
//! estensione riceve quella delle note nuove (`files.new-note-extension`): il
//! diario non presume un formato.
//!
//! Le variabili sono un vocabolario **chiuso** — mai scripting arbitrario e mai
//! callback nel contratto: titolo, date/ore dal fuso dell'utente, nome file e
//! un numero casuale per nomi univoci. Ciò che non sta nel vocabolario resta
//! testo: un template che cita una variabile ignota la ritrova identica nella
//! nota, non un errore e non una stringa vuota.

use std::collections::BTreeMap;

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, CommandSurface, Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit,
    Undo, UndoStep,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::{civil_from_days, days_from_civil, days_in_month, HourCycle};
use fub_abi::model::{valid_civil_date, DocId, LinkTarget};
use fub_abi::options::syntax;
use fub_abi::rules::path_policy::{check as check_name, Naming};
use fub_abi::rules::text_policy;
use fub_abi::rules::yaml as yaml_rule;
use fub_abi::session::ContextMask;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Strings, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Align, Intent, TableColumn, UiAction, UiKind, UiNode, ViewUpdate};

pub const TEMPLATE_ID: &str = "fub.template";
pub const TEMPLATE_VIEW: &str = "templates";
/// Il calendario delle giornaliere: un mese, le settimane numerate, un giorno
/// per bottone.
pub const CALENDAR_VIEW: &str = "calendar";
pub const NOTES_FROM_TEMPLATE: &str = "note.from_template";
pub const NOTES_DAILY: &str = "note.daily";
/// Crea una nota con un nome univoco (`name`, poi `name 1`, `name 2`, …)
/// oppure ne sceglie uno casuale (`random`), senza mai sovrascrivere.
pub const NOTES_UNIQUE: &str = "note.unique";
/// Crea e apre una nota casuale fra quelle del vault.
pub const NOTES_RANDOM: &str = "note.random";
/// Inserisce data/ora di adesso nel documento attivo, al cursore.
pub const NOTES_INSERT_DATETIME: &str = "note.insert_datetime";
/// Inserisce il corpo di un template nel documento attivo, al cursore,
/// fondendo le proprietà mancanti nel frontmatter.
pub const NOTES_INSERT_TEMPLATE: &str = "note.insert_template";
/// Estrae la selezione in una nota nuova e la sostituisce con un link/embed.
/// Non cancella la sorgente prima che la destinazione sia sicura (§P05.5).
pub const NOTES_EXTRACT: &str = "note.extract";
/// Unisce una nota dentro un'altra (append/prepend) e porta la sorgente nel
/// cestino solo a destinazione sicura; mai merge distruttivo diretto.
pub const NOTES_MERGE: &str = "note.merge";

const FOLDER_TEMPLATES: &str = "Templates";
const FOLDER_DAILY: &str = "Daily";
/// Senza estensione: la sceglie `files.new-note-extension`, come per le note.
const DAILY_TEMPLATE: &str = "Templates/Daily";
/// Cartella delle giornaliere decisa nelle impostazioni (vault: viaggia con le
/// note, come il formato delle date delle proprietà).
pub const DAILY_FOLDER_KEY: &str = "daily.folder";
/// Template delle giornaliere deciso nelle impostazioni.
pub const DAILY_TEMPLATE_KEY: &str = "daily.template";
/// Il nome della giornaliera dentro la sua cartella: token `YYYY`, `YY`,
/// `MMMM`, `MMM`, `MM`, `M`, `DD`, `D`, `dddd`, `ddd`, testo fra `[…]`
/// letterale; una `/` fa una sottocartella.
pub const DAILY_FORMAT_KEY: &str = "daily.format";
/// Il nome di sempre: ordinabile, e quello che `note.daily` accetta come data.
pub const DAILY_FORMAT_DEFAULT: &str = "YYYY-MM-DD";
/// Formato di `note.insert_datetime`: `date`, `time` o `datetime`.
pub const DATE_FORMAT_KEY: &str = "insert.date-format";
/// Orologio a 12 o 24 ore per l'inserimento dell'ora.
pub const TIME_FORMAT_KEY: &str = "insert.hour-cycle";
/// Il prefisso temporale di `note.unique`: token `YYYY`, `MM`, `DD`, `HH`,
/// `mm`; il resto resta com'è scritto. Vuoto = nessun prefisso.
pub const UNIQUE_PREFIX_KEY: &str = "unique.prefix-format";
/// Anno, mese, giorno, ora e minuto attaccati: ordinabile e senza caratteri
/// che un filesystem rifiuti.
pub const UNIQUE_PREFIX_DEFAULT: &str = "YYYYMMDDHHmm";
/// I valori che `DATE_FORMAT_KEY` accetta: una sola parola, come `DateOrder`.
pub const ISO_DATE: &str = "date";
pub const CLOCK_TIME: &str = "time";
pub const CLOCK_DATETIME: &str = "datetime";
pub const CLOCK_12: &str = "h12";
pub const CLOCK_24: &str = "h24";
const S_GROUP: &str = "template.group";
const S_DAILY_FOLDER: &str = "template.daily_folder";
const S_DAILY_FOLDER_DESC: &str = "template.daily_folder.desc";
const S_DAILY_TEMPLATE: &str = "template.daily_template";
const S_DAILY_TEMPLATE_DESC: &str = "template.daily_template.desc";
const S_DAILY_FORMAT: &str = "template.daily_format";
const S_DAILY_FORMAT_DESC: &str = "template.daily_format.desc";
const E_BAD_DAILY_FORMAT: &str = "e_bad_daily_format";
const S_DATE_FORMAT: &str = "template.date_format";
const S_DATE_FORMAT_DESC: &str = "template.date_format.desc";
const S_TIME_FORMAT: &str = "template.time_format";
const S_TIME_FORMAT_DESC: &str = "template.time_format.desc";
const S_UNIQUE_PREFIX: &str = "template.unique_prefix";
const S_UNIQUE_PREFIX_DESC: &str = "template.unique_prefix.desc";
/// L'inverso di «crea» è «cestina», come in `commands.rs::notes_create`: un
/// inverso reversibile per un gesto reversibile. Id letterale e non import da
/// `crate::commands` — i moduli di feature non si nominano fra loro.
const TRASH: &str = "note.trash";
/// Il merge delle proprietà passa da qui (PropertiesOwner resta proprietario
/// dello YAML): una chiave assente nel target si scrive con un `run_command`,
/// mai con uno splice fatto a mano. Id letterale per la stessa ragione di sopra.
const PROP_SET: &str = "note.property.set";

const USE: &str = "use";
const TEMPLATE: &str = "template";
const NAME: &str = "name";
const DATE: &str = "date";
const FOLDER: &str = "folder";
const RANDOM: &str = "random";
const FORMAT: &str = "format";
const DOC: &str = "doc";
const AT: &str = "at";
const MERGE: &str = "merge";
const REPLACE: &str = "replace";
const FROM: &str = "from";
const INTO: &str = "into";
const MODE: &str = "mode";
const TRASH_PARAM: &str = "trash";
const SEPARATOR: &str = "separator";

const VIEW_TITLE: &str = "view_title";
const EMPTY: &str = "empty";
const CALENDAR_TITLE: &str = "calendar.title";
const CALENDAR_PREV: &str = "calendar.prev";
const CALENDAR_NEXT: &str = "calendar.next";
const CALENDAR_TODAY: &str = "calendar.today";
const CALENDAR_WEEK: &str = "calendar.week";
/// Il gesto su un giorno: apre la sua giornaliera, o la crea.
const CALENDAR_OPEN: &str = "calendar.open";
/// La chiave dello stato di vista: il mese mostrato, come `anno*12 + mese-1`.
const SHOWN: &str = "shown";
const E_NO_TEMPLATE: &str = "e_no_template";
const E_EMPTY_TEMPLATE: &str = "e_empty_template";
const E_NO_NOTES: &str = "e_no_notes";
const E_NO_DOC: &str = "e_no_doc";
const E_DIRTY: &str = "e_dirty_selection";
const E_EMPTY_SELECTION: &str = "e_empty_selection";
const E_BAD_DATE: &str = "e_bad_date";
const E_BAD_TIME: &str = "e_bad_time";
const E_BAD_FOLDER: &str = "e_bad_folder";
const E_MERGE_SELF: &str = "e_merge_self";
const E_NO_SOURCES: &str = "e_no_sources";
const E_AT_NOT_OFFSET: &str = "e_at_not_offset";
const E_MULTI_SELECTION: &str = "e_multi_selection";
const E_STALE_SELECTION: &str = "e_stale_selection";
const E_ASSET_MOVE: &str = "e_asset_move";
const E_REFERENCED_SOURCE: &str = "e_referenced_source";
const E_EXTRACT_CLEANUP: &str = "e_extract_cleanup";
const E_SOURCE_CHANGED: &str = "e_source_changed";
const E_SOURCE_COPIED: &str = "e_source_copied";
const E_BAD_FRONTMATTER: &str = "e_bad_frontmatter";
const E_BAD_FRONTMATTER_MAP: &str = "e_bad_frontmatter_map";
const E_BAD_ZONE: &str = "e_bad_zone";
const E_BAD_INSTANT: &str = "e_bad_instant";
const P_FROM: &str = "p_from";
const D_FROM: &str = "d_from";
const U_FROM: &str = "u_from";
const P_DAILY: &str = "p_daily";
const D_DAILY: &str = "d_daily";
const U_DAILY: &str = "u_daily";
const D_DAILY_OPEN: &str = "d_daily_open";
const P_UNIQUE: &str = "p_unique";
const D_UNIQUE: &str = "d_unique";
const U_UNIQUE: &str = "u_unique";
const D_RANDOM: &str = "d_random";
const P_INSERT_DT: &str = "p_insert_dt";
const D_INSERT_DT: &str = "d_insert_dt";
const U_INSERT_DT: &str = "u_insert_dt";
const P_INSERT_TPL: &str = "p_insert_tpl";
const D_INSERT_TPL: &str = "d_insert_tpl";
const D_INSERT_TPL_PARTIAL: &str = "d_insert_tpl_partial";
const U_INSERT_TPL: &str = "u_insert_tpl";
const P_EXTRACT: &str = "p_extract";
const D_EXTRACT: &str = "d_extract";
const U_EXTRACT: &str = "u_extract";
const P_MERGE: &str = "p_merge";
const D_MERGE: &str = "d_merge";
const D_MERGE_PARTIAL: &str = "d_merge_partial";
const U_MERGE: &str = "u_merge";
const A_DOC: &str = "doc";
const A_COUNT: &str = "count";
const A_FAILED: &str = "failed";
const A_VALUE: &str = "value";

pub fn catalog() -> Vec<StringCatalog> {
    crate::formats::speaking(vec![catalog_it(), catalog_en()])
}

mod create;
mod extract;
mod insert;
mod merge;
mod names;
mod provider;
mod strings;
mod view;

use create::{
    civil_parts, context, created, daily, expand_full, file_name, format_time, from_template, plan,
    today, valid_time, with_extension, Ctx,
};
#[cfg(test)]
use create::{context_at, valid_date};
use extract::{check_relative_assets, extract};
#[cfg(test)]
use insert::{datetime_now, frontmatter_bounds, insert_target, split_frontmatter};
use insert::{insert_datetime, insert_template, snap_to_boundary, why};
use merge::merge;
use names::{
    daily_folder, daily_format, daily_name, daily_template, folder_arg, insert_format, random,
    unique, MONTHS_EN, MONTHS_IT, N_UNTITLED, WEEKDAYS_EN, WEEKDAYS_IT,
};
#[cfg(test)]
use names::{format_moment, random_name, unique_name};
pub use provider::TemplateCommands;
use strings::{catalog_en, catalog_it};
pub use view::TemplateView;
#[cfg(test)]
use view::{calendar, calendar_action};

/// Una cartella di destinazione: mai risalite, mai spazio macchina, mai vuota.
/// Il recinto è `check` con `Naming::New` — la stessa regola di ogni nome che
/// nasce — più il rifiuto dello spazio macchina, che è nostro e non di un
/// filesystem.
fn valid_folder(raw: &str) -> Result<String, PluginError> {
    let folder = raw.trim().trim_matches('/').to_string();
    let probe = format!("{folder}/_");
    if folder.is_empty() || check_name(&probe, Naming::New).is_err() {
        return Err(PluginError::BadArgs(Text::message(
            E_BAD_FOLDER,
            vec![Arg::text(A_VALUE, raw)],
        )));
    }
    Ok(folder)
}

#[cfg(test)]
mod tests;
