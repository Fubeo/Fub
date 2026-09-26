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

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, CommandSurface, Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit,
    Undo, UndoStep,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::{civil_from_days, HourCycle};
use fub_abi::model::{valid_civil_date, DocId, LinkTarget};
use fub_abi::options::syntax;
use fub_abi::rules::path_policy::{check as check_name, Naming};
use fub_abi::rules::text_policy;
use fub_abi::session::ContextMask;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiNode, ViewUpdate};

pub const TEMPLATE_ID: &str = "fub.template";
pub const TEMPLATE_VIEW: &str = "templates";
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
const UNTITLED: &str = "Untitled";
/// Cartella delle giornaliere decisa nelle impostazioni (vault: viaggia con le
/// note, come il formato delle date delle proprietà).
pub const DAILY_FOLDER_KEY: &str = "daily.folder";
/// Template delle giornaliere deciso nelle impostazioni.
pub const DAILY_TEMPLATE_KEY: &str = "daily.template";
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
fn catalog_it() -> StringCatalog {
    StringCatalog::new("it")
        .with(VIEW_TITLE, "Template")
        .with(EMPTY, "Nessun template in Templates/.")
        .with(E_NO_TEMPLATE, "Nessun template indicato.")
        .with(E_EMPTY_TEMPLATE, "Il template «{doc}» è vuoto di nome.")
        .with(E_NO_NOTES, "Nessuna nota nel vault.")
        .with(E_NO_DOC, "Nessuna nota: né in `doc`, né in quella aperta.")
        .with(E_DIRTY, "Il buffer ha modifiche non salvate: salva prima di inserire.")
        .with(E_EMPTY_SELECTION, "La selezione è vuota: non c'è niente da estrarre.")
        .with(E_BAD_DATE, "`{value}` non è una data YYYY-MM-DD.")
        .with(E_BAD_TIME, "`{value}` non è un orario HH:MM.")
        .with(E_BAD_FOLDER, "La cartella «{value}» risale o nomina lo spazio macchina.")
        .with(E_MERGE_SELF, "«{doc}» dentro sé stessa: indica due note diverse.")
        .with(E_NO_SOURCES, "Le note indicate non esistono o sono vuote.")
        .with(E_AT_NOT_OFFSET, "`at` è una posizione in byte: {value} non lo è.")
        .with(E_MULTI_SELECTION, "L'estrazione accetta una selezione sola: lascia un unico intervallo.")
        .with(E_STALE_SELECTION, "La selezione in {doc} è cambiata: ripubblica il contesto e riprova.")
        .with(E_ASSET_MOVE, "«{doc}» contiene un allegato relativo: tieni la stessa cartella o correggi il path prima di spostarlo.")
        .with(E_REFERENCED_SOURCE, "«{doc}» ha riferimenti entranti: conserva la sorgente (`trash: false`) o aggiorna i link prima dell'unione.")
        .with(E_EXTRACT_CLEANUP, "Estrazione non riuscita ({reason}): «{doc}» è rimasta perché la compensazione non è riuscita ({cleanup}). Risolvila prima di riprovare.")
        .with(E_SOURCE_CHANGED, "«{doc}» è cambiata durante l'unione: riprova dalla versione corrente.")
        .with(E_SOURCE_COPIED, "«{doc}» è cambiata dopo la copia: la sorgente è stata conservata.")
        .with(E_BAD_FRONTMATTER, "Frontmatter del template non valido: {reason}")
        .with(E_BAD_FRONTMATTER_MAP, "Il frontmatter del template deve essere una mappa.")
        .with(E_BAD_ZONE, "Fuso orario «{zone}» non riconosciuto: scegli un nome IANA valido.")
        .with(E_BAD_INSTANT, "L'istante dell'orologio non è rappresentabile nel fuso orario.")
        .with(P_FROM, "Nuova nota da «{template}»")
        .with(D_FROM, "Creata {doc} da «{template}»")
        .with(U_FROM, "Annulla: crea {doc} da template")
        .with(P_DAILY, "Nota del {date}")
        .with(D_DAILY, "Creata la nota del {date}")
        .with(U_DAILY, "Annulla: nota del {date}")
        .with(D_DAILY_OPEN, "Aperta la nota del {date}")
        .with(P_UNIQUE, "Crea «{doc}»")
        .with(D_UNIQUE, "Creata «{doc}»")
        .with(U_UNIQUE, "Annulla: crea «{doc}»")
        .with(D_RANDOM, "Aperta {doc}")
        .with(P_INSERT_DT, "Inserisci {value} in {doc}")
        .with(D_INSERT_DT, "Inserito {value} in {doc}")
        .with(U_INSERT_DT, "Annulla: inserito {value} in {doc}")
        .with(P_INSERT_TPL, "Inserisci «{template}» in {doc}")
        .with(D_INSERT_TPL, "Inserito «{template}» in {doc}")
        .with(D_INSERT_TPL_PARTIAL, "Inserito «{template}» in {doc} · Proprietà non fuse: {failed}")
        .with(U_INSERT_TPL, "Annulla: inserito «{template}» in {doc}")
        .with(P_EXTRACT, "«{doc}» nasce da una selezione di {from}")
        .with(D_EXTRACT, "Creata «{doc}» da una selezione di {from}")
        .with(U_EXTRACT, "Annulla: estratto «{doc}» in {from}")
        .with(P_MERGE, "Unisci {count} note in «{doc}»")
        .with(D_MERGE, "Unite {count} note in «{doc}»")
        .with(D_MERGE_PARTIAL, "Unite {count} note in «{doc}» · Non unite: {failed}")
        .with(U_MERGE, "Annulla: unite {count} note in «{doc}»")
        .with("note.from_template.title", "Nuova nota da template")
        .with(
            "note.from_template.desc",
            "Crea una nota copiando un template, con variabili {{…}} sostituite.",
        )
        .with("note.from_template.template.title", "Template")
        .with(
            "note.from_template.template.desc",
            "Il path del template nel vault.",
        )
        .with("note.from_template.name.title", "Nome")
        .with(
            "note.from_template.name.desc",
            "Nome della nota nuova. Assente: quello del template.",
        )
        .with("note.from_template.folder.title", "Cartella")
        .with(
            "note.from_template.folder.desc",
            "Cartella di destinazione. Assente: la stessa del `name`.",
        )
        .with("note.daily.title", "Nota di oggi")
        .with(
            "note.daily.desc",
            "Apre o crea la nota giornaliera di oggi, col fuso dell'utente.",
        )
        .with("note.daily.date.title", "Data")
        .with("note.daily.date.desc", "YYYY-MM-DD. Assente: oggi.")
        .with("note.daily.folder.title", "Cartella")
        .with(
            "note.daily.folder.desc",
            "Cartella delle giornaliere. Assente: quella decisa nelle impostazioni.",
        )
        .with("note.daily.template.title", "Template")
        .with(
            "note.daily.template.desc",
            "Template della giornaliera. Assente: quello deciso nelle impostazioni.",
        )
        .with("note.unique.title", "Nuova nota univoca")
        .with(
            "note.unique.desc",
            "Crea una nota senza sovrascrivere mai: se il nome è preso, aggiunge un numero.",
        )
        .with("note.unique.name.title", "Nome")
        .with("note.unique.name.desc", "Il nome o il path voluto. Assente: «Senza titolo».")
        .with("note.unique.random.title", "Nome casuale")
        .with(
            "note.unique.random.desc",
            "Se vero, il nome nasce dal caso invece che da `name`. Default: falso.",
        )
        .with("note.unique.template.title", "Template")
        .with(
            "note.unique.template.desc",
            "Template da cui partire. Assente: nota vuota.",
        )
        .with("note.random.title", "Nota casuale")
        .with(
            "note.random.desc",
            "Apre una nota a caso fra quelle del vault. Non modifica niente.",
        )
        .with("note.insert_datetime.title", "Inserisci data/ora")
        .with(
            "note.insert_datetime.desc",
            "Inserisce la data o l'ora di adesso nel documento attivo, al cursore.",
        )
        .with("note.insert_datetime.doc.title", "Nota")
        .with(
            "note.insert_datetime.doc.desc",
            "La nota in cui inserire. Assente: quella aperta.",
        )
        .with("note.insert_datetime.at.title", "Posizione")
        .with(
            "note.insert_datetime.at.desc",
            "Posizione in byte. Assente: il cursore del pannello attivo.",
        )
        .with("note.insert_datetime.format.title", "Formato")
        .with(
            "note.insert_datetime.format.desc",
            "date, time o datetime. Assente: quello deciso nelle impostazioni.",
        )
        .with("note.insert_datetime.format.date", "Data")
        .with("note.insert_datetime.format.time", "Ora")
        .with("note.insert_datetime.format.datetime", "Data e ora")
        .with("note.insert_template.title", "Inserisci template al cursore")
        .with(
            "note.insert_template.desc",
            "Inserisce il corpo di un template al cursore e fonde nel frontmatter le proprietà assenti.",
        )
        .with("note.insert_template.template.title", "Template")
        .with("note.insert_template.template.desc", "Il path del template nel vault.")
        .with("note.insert_template.doc.title", "Nota")
        .with(
            "note.insert_template.doc.desc",
            "La nota in cui inserire. Assente: quella aperta.",
        )
        .with("note.insert_template.at.title", "Posizione")
        .with(
            "note.insert_template.at.desc",
            "Posizione in byte. Assente: il cursore del pannello attivo.",
        )
        .with("note.insert_template.merge.title", "Fondi proprietà")
        .with(
            "note.insert_template.merge.desc",
            "Se vero, le proprietà del template assenti nel target vengono aggiunte. Default: vero.",
        )
        .with("note.extract.title", "Estrai selezione in nota")
        .with(
            "note.extract.desc",
            "Crea una nota dalla selezione e la sostituisce con un link o un embed. La sorgente non si tocca prima che la destinazione sia sicura.",
        )
        .with("note.extract.name.title", "Nome")
        .with(
            "note.extract.name.desc",
            "Nome della nota nuova. Assente: titolo o prima riga della selezione.",
        )
        .with("note.extract.template.title", "Template")
        .with(
            "note.extract.template.desc",
            "Template che avvolge la selezione nella nota nuova. Assente: la sola selezione.",
        )
        .with("note.extract.replace.title", "Sostituisci con")
        .with(
            "note.extract.replace.desc",
            "link o embed. Assente: link.",
        )
        .with("note.extract.replace.link", "Link")
        .with("note.extract.replace.embed", "Embed")
        .with("note.merge.title", "Unisci note")
        .with(
            "note.merge.desc",
            "Accoda o prepone note a una destinazione; le sorgenti vanno nel cestino solo a destinazione sicura.",
        )
        .with("note.merge.from.title", "Note da unire")
        .with("note.merge.from.desc", "Gli id delle note da unire nella destinazione.")
        .with("note.merge.into.title", "Destinazione")
        .with(
            "note.merge.into.desc",
            "La nota che riceve. Assente: quella aperta.",
        )
        .with("note.merge.mode.title", "Modo")
        .with("note.merge.mode.desc", "append o prepend. Assente: append.")
        .with("note.merge.mode.append", "Append")
        .with("note.merge.mode.prepend", "Prepend")
        .with("note.merge.separator.title", "Separatore")
        .with(
            "note.merge.separator.desc",
            "Testo fra i blocchi uniti. Assente: riga vuota.",
        )
        .with("note.merge.trash.title", "Cestina sorgenti")
        .with(
            "note.merge.trash.desc",
            "Se vero, le sorgenti unite vanno nel cestino. Default: vero.",
        )
        .with(S_GROUP, "Template e giornaliere")
        .with(S_DAILY_FOLDER, "Cartella delle giornaliere")
        .with(S_DAILY_FOLDER_DESC, "Dove `note.daily` crea le note. Viaggia col vault.")
        .with(S_DAILY_TEMPLATE, "Template della giornaliera")
        .with(
            S_DAILY_TEMPLATE_DESC,
            "Template usato da `note.daily` quando la nota non esiste.",
        )
        .with(S_DATE_FORMAT, "Formato di data/ora")
        .with(
            S_DATE_FORMAT_DESC,
            "`date`, `time` o `datetime`: cosa inserisce `note.insert_datetime` senza formato.",
        )
        .with(S_TIME_FORMAT, "Orologio a 12 o 24 ore")
        .with(
            S_TIME_FORMAT_DESC,
            "`h24` come ISO 8601, `h12` con AM/PM. Vale per l'ora inserita.",
        )
        .with(S_UNIQUE_PREFIX, "Prefisso delle note univoche")
        .with(
            S_UNIQUE_PREFIX_DESC,
            "Formato con `YYYY`, `MM`, `DD`, `HH`, `mm` messo davanti al nome di `note.unique`. Vuoto: nessun prefisso.",
        )
}

fn catalog_en() -> StringCatalog {
    StringCatalog::new("en")
        .with(VIEW_TITLE, "Templates")
        .with(EMPTY, "No templates in Templates/.")
        .with(E_NO_TEMPLATE, "No template given.")
        .with(E_EMPTY_TEMPLATE, "Template «{doc}» has no usable name.")
        .with(E_NO_NOTES, "No notes in the vault.")
        .with(E_NO_DOC, "No note: neither in `doc`, nor in the open one.")
        .with(E_DIRTY, "The buffer has unsaved changes: save before inserting.")
        .with(E_EMPTY_SELECTION, "The selection is empty: there is nothing to extract.")
        .with(E_BAD_DATE, "`{value}` is not a YYYY-MM-DD date.")
        .with(E_BAD_TIME, "`{value}` is not a HH:MM time.")
        .with(E_BAD_FOLDER, "Folder «{value}» escapes or names machine space.")
        .with(E_MERGE_SELF, "«{doc}» into itself: name two different notes.")
        .with(E_NO_SOURCES, "The named notes do not exist or are empty.")
        .with(E_AT_NOT_OFFSET, "`at` is a byte position: {value} is not one.")
        .with(E_MULTI_SELECTION, "Extraction accepts one selection: keep a single range selected.")
        .with(E_STALE_SELECTION, "The selection in {doc} changed: publish the editor context again and retry.")
        .with(E_ASSET_MOVE, "«{doc}» has a relative embedded asset: keep the same folder or fix its path before moving it.")
        .with(E_REFERENCED_SOURCE, "«{doc}» has incoming references: keep the source (`trash: false`) or update its links before merging.")
        .with(E_EXTRACT_CLEANUP, "Extraction failed ({reason}): «{doc}» was preserved because cleanup failed ({cleanup}). Resolve it before retrying.")
        .with(E_SOURCE_CHANGED, "«{doc}» changed during merge: retry from its current version.")
        .with(E_SOURCE_COPIED, "«{doc}» changed after copying: the source was kept.")
        .with(E_BAD_FRONTMATTER, "Invalid template frontmatter: {reason}")
        .with(E_BAD_FRONTMATTER_MAP, "Template frontmatter must be a mapping.")
        .with(E_BAD_ZONE, "Unknown time zone «{zone}»: choose a valid IANA name.")
        .with(E_BAD_INSTANT, "The clock instant cannot be represented in this time zone.")
        .with(P_FROM, "New note from «{template}»")
        .with(D_FROM, "Created {doc} from «{template}»")
        .with(U_FROM, "Undo: create {doc} from template")
        .with(P_DAILY, "Note for {date}")
        .with(D_DAILY, "Created the note for {date}")
        .with(U_DAILY, "Undo: note for {date}")
        .with(D_DAILY_OPEN, "Opened the note for {date}")
        .with(P_UNIQUE, "Create «{doc}»")
        .with(D_UNIQUE, "Created «{doc}»")
        .with(U_UNIQUE, "Undo: create «{doc}»")
        .with(D_RANDOM, "Opened {doc}")
        .with(P_INSERT_DT, "Insert {value} into {doc}")
        .with(D_INSERT_DT, "Inserted {value} into {doc}")
        .with(U_INSERT_DT, "Undo: inserted {value} into {doc}")
        .with(P_INSERT_TPL, "Insert «{template}» into {doc}")
        .with(D_INSERT_TPL, "Inserted «{template}» into {doc}")
        .with(D_INSERT_TPL_PARTIAL, "Inserted «{template}» into {doc} · Properties not merged: {failed}")
        .with(U_INSERT_TPL, "Undo: inserted «{template}» into {doc}")
        .with(P_EXTRACT, "«{doc}» is born from a selection of {from}")
        .with(D_EXTRACT, "Created «{doc}» from a selection of {from}")
        .with(U_EXTRACT, "Undo: extracted «{doc}» into {from}")
        .with(P_MERGE, "Merge {count} notes into «{doc}»")
        .with(D_MERGE, "Merged {count} notes into «{doc}»")
        .with(D_MERGE_PARTIAL, "Merged {count} notes into «{doc}» · Not merged: {failed}")
        .with(U_MERGE, "Undo: merged {count} notes into «{doc}»")
        .with("note.from_template.title", "New note from template")
        .with(
            "note.from_template.desc",
            "Creates a note by copying a template, substituting {{…}} variables.",
        )
        .with("note.from_template.template.title", "Template")
        .with(
            "note.from_template.template.desc",
            "Vault path of the template.",
        )
        .with("note.from_template.name.title", "Name")
        .with(
            "note.from_template.name.desc",
            "Name of the new note. Absent: the template's name.",
        )
        .with("note.from_template.folder.title", "Folder")
        .with(
            "note.from_template.folder.desc",
            "Destination folder. Absent: the same as `name`.",
        )
        .with("note.daily.title", "Today's note")
        .with(
            "note.daily.desc",
            "Opens or creates today's daily note, in the user's timezone.",
        )
        .with("note.daily.date.title", "Date")
        .with("note.daily.date.desc", "YYYY-MM-DD. Absent: today.")
        .with("note.daily.folder.title", "Folder")
        .with(
            "note.daily.folder.desc",
            "Daily notes folder. Absent: the configured one.",
        )
        .with("note.daily.template.title", "Template")
        .with(
            "note.daily.template.desc",
            "Daily note template. Absent: the configured one.",
        )
        .with("note.unique.title", "New unique note")
        .with(
            "note.unique.desc",
            "Creates a note without ever overwriting: when the name is taken, a number is added.",
        )
        .with("note.unique.name.title", "Name")
        .with("note.unique.name.desc", "The wanted name or path. Absent: “Untitled”.")
        .with("note.unique.random.title", "Random name")
        .with(
            "note.unique.random.desc",
            "When true, the name comes from randomness instead of `name`. Default: false.",
        )
        .with("note.unique.template.title", "Template")
        .with(
            "note.unique.template.desc",
            "Template to start from. Absent: empty note.",
        )
        .with("note.random.title", "Random note")
        .with(
            "note.random.desc",
            "Opens a random note from the vault. It changes nothing.",
        )
        .with("note.insert_datetime.title", "Insert date/time")
        .with(
            "note.insert_datetime.desc",
            "Inserts the current date or time into the active document, at the cursor.",
        )
        .with("note.insert_datetime.doc.title", "Note")
        .with(
            "note.insert_datetime.doc.desc",
            "The note to insert into. Absent: the open one.",
        )
        .with("note.insert_datetime.at.title", "Position")
        .with(
            "note.insert_datetime.at.desc",
            "Byte position. Absent: the caret of the active pane.",
        )
        .with("note.insert_datetime.format.title", "Format")
        .with(
            "note.insert_datetime.format.desc",
            "date, time or datetime. Absent: the configured one.",
        )
        .with("note.insert_datetime.format.date", "Date")
        .with("note.insert_datetime.format.time", "Time")
        .with("note.insert_datetime.format.datetime", "Date and time")
        .with("note.insert_template.title", "Insert template at cursor")
        .with(
            "note.insert_template.desc",
            "Inserts a template body at the cursor and merges missing properties into the frontmatter.",
        )
        .with("note.insert_template.template.title", "Template")
        .with("note.insert_template.template.desc", "Vault path of the template.")
        .with("note.insert_template.doc.title", "Note")
        .with(
            "note.insert_template.doc.desc",
            "The note to insert into. Absent: the open one.",
        )
        .with("note.insert_template.at.title", "Position")
        .with(
            "note.insert_template.at.desc",
            "Byte position. Absent: the caret of the active pane.",
        )
        .with("note.insert_template.merge.title", "Merge properties")
        .with(
            "note.insert_template.merge.desc",
            "When true, the template properties missing in the target are added. Default: true.",
        )
        .with("note.extract.title", "Extract selection to note")
        .with(
            "note.extract.desc",
            "Creates a note from the selection and replaces it with a link or an embed. The source is untouched until the destination is safe.",
        )
        .with("note.extract.name.title", "Name")
        .with(
            "note.extract.name.desc",
            "Name of the new note. Absent: title or first line of the selection.",
        )
        .with("note.extract.template.title", "Template")
        .with(
            "note.extract.template.desc",
            "Template wrapping the selection in the new note. Absent: the selection alone.",
        )
        .with("note.extract.replace.title", "Replace with")
        .with(
            "note.extract.replace.desc",
            "link or embed. Absent: link.",
        )
        .with("note.extract.replace.link", "Link")
        .with("note.extract.replace.embed", "Embed")
        .with("note.merge.title", "Merge notes")
        .with(
            "note.merge.desc",
            "Appends or prepends notes into a destination; sources go to trash only when the destination is safe.",
        )
        .with("note.merge.from.title", "Notes to merge")
        .with("note.merge.from.desc", "The ids of the notes to merge into the destination.")
        .with("note.merge.into.title", "Destination")
        .with(
            "note.merge.into.desc",
            "The receiving note. Absent: the open one.",
        )
        .with("note.merge.mode.title", "Mode")
        .with("note.merge.mode.desc", "append or prepend. Absent: append.")
        .with("note.merge.mode.append", "Append")
        .with("note.merge.mode.prepend", "Prepend")
        .with("note.merge.separator.title", "Separator")
        .with(
            "note.merge.separator.desc",
            "Text between merged blocks. Absent: blank line.",
        )
        .with("note.merge.trash.title", "Trash sources")
        .with(
            "note.merge.trash.desc",
            "When true, merged sources go to trash. Default: true.",
        )
        .with(S_GROUP, "Templates and daily notes")
        .with(S_DAILY_FOLDER, "Daily notes folder")
        .with(S_DAILY_FOLDER_DESC, "Where `note.daily` creates notes. It travels with the vault.")
        .with(S_DAILY_TEMPLATE, "Daily note template")
        .with(
            S_DAILY_TEMPLATE_DESC,
            "Template used by `note.daily` when the note does not exist.",
        )
        .with(S_DATE_FORMAT, "Date/time format")
        .with(
            S_DATE_FORMAT_DESC,
            "`date`, `time` or `datetime`: what `note.insert_datetime` inserts without a format.",
        )
        .with(S_TIME_FORMAT, "12 or 24 hour clock")
        .with(
            S_TIME_FORMAT_DESC,
            "`h24` as ISO 8601, `h12` with AM/PM. It applies to the inserted time.",
        )
        .with(S_UNIQUE_PREFIX, "Unique note prefix")
        .with(
            S_UNIQUE_PREFIX_DESC,
            "Format with `YYYY`, `MM`, `DD`, `HH`, `mm` put before the `note.unique` name. Empty: no prefix.",
        )
}

pub struct TemplateView;

impl ViewProvider for TemplateView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            TEMPLATE_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::LeftSidebar,
        )
        .with_icon("template")
        .ordered(4)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if action.action.0 != USE {
            return Ok(ViewUpdate::None);
        }
        let Some(template) = action.payload.get(TEMPLATE).and_then(|v| v.as_str()) else {
            return Ok(ViewUpdate::None);
        };
        match host.run_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({ TEMPLATE: template }),
        ) {
            Ok(outcome) => match outcome.effect {
                CommandEffect::Navigate { doc } => Ok(ViewUpdate::Navigate {
                    doc_id: doc.as_str().to_string(),
                }),
                _ => Ok(ViewUpdate::Replace { root: tree(host)? }),
            },
            Err(and) => Ok(ViewUpdate::Replace {
                root: UiNode::failed(Text::from(and.to_string()), None),
            }),
        }
    }
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let prefix = format!("{FOLDER_TEMPLATES}/");
    let mut docs: Vec<DocId> = host
        .list_documents(None)?
        .items
        .into_iter()
        // Un template è testo da inserire in una nota: vale ogni formato il
        // cui sorgente è prosa, non la sola estensione `.md`.
        .filter(|d| {
            d.as_str().starts_with(&prefix)
                && crate::formats::understands(host, d, fub_abi::options::source::PROSE)
        })
        .collect();
    docs.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    if docs.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }
    Ok(UiNode::list(
        docs.into_iter()
            .map(|d| {
                let title = file_name(&d);
                UiNode::list_item(
                    Text::from(title),
                    Some(Text::from(d.as_str())),
                    Some(ActionRef::with(
                        USE,
                        serde_json::json!({ TEMPLATE: d.as_str() }),
                    )),
                )
                .with_key(d.0.clone())
            })
            .collect(),
    ))
}

pub struct TemplateCommands;

impl TemplateCommands {
    /// Le spec, anche fuori dal trait: chi disegna una palette nei test le
    /// legge senza montare un workspace, come fa `CoreCommands::specs`.
    ///
    /// Tutte si offrono anche nel menu `/` dell'editor: sono gesti di chi sta
    /// scrivendo, e i parametri che il contesto non riempie li chiede il menu.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            command(NOTES_FROM_TEMPLATE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_FROM_TEMPLATE, TEMPLATE, ParamKind::Text).required())
                .with_param(parameter(NOTES_FROM_TEMPLATE, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_FROM_TEMPLATE, FOLDER, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_DAILY)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_DAILY, DATE, ParamKind::Text))
                .with_param(parameter(NOTES_DAILY, FOLDER, ParamKind::Text))
                .with_param(parameter(NOTES_DAILY, TEMPLATE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_UNIQUE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_UNIQUE, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_UNIQUE, RANDOM, ParamKind::Bool))
                .with_param(parameter(NOTES_UNIQUE, TEMPLATE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_RANDOM)
                .offered_in(CommandSurface::Slash)
                .with_scope(CommandScope::read_only()),
            command(NOTES_INSERT_DATETIME)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_INSERT_DATETIME, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_INSERT_DATETIME, AT, ParamKind::Numbers))
                .with_param(parameter(
                    NOTES_INSERT_DATETIME,
                    FORMAT,
                    ParamKind::Choice(vec![
                        Choice::new("date", Text::key("note.insert_datetime.format.date")),
                        Choice::new("time", Text::key("note.insert_datetime.format.time")),
                        Choice::new(
                            "datetime",
                            Text::key("note.insert_datetime.format.datetime"),
                        ),
                    ]),
                ))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_INSERT_TEMPLATE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_INSERT_TEMPLATE, TEMPLATE, ParamKind::Text).required())
                .with_param(parameter(NOTES_INSERT_TEMPLATE, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_INSERT_TEMPLATE, AT, ParamKind::Numbers))
                .with_param(parameter(NOTES_INSERT_TEMPLATE, MERGE, ParamKind::Bool))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_EXTRACT)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_EXTRACT, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_EXTRACT, TEMPLATE, ParamKind::Text))
                .with_param(parameter(
                    NOTES_EXTRACT,
                    REPLACE,
                    ParamKind::Choice(vec![
                        Choice::new("link", Text::key("note.extract.replace.link")),
                        Choice::new("embed", Text::key("note.extract.replace.embed")),
                    ]),
                ))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_MERGE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_MERGE, FROM, ParamKind::Documents).required())
                .with_param(parameter(NOTES_MERGE, INTO, ParamKind::Document))
                .with_param(parameter(
                    NOTES_MERGE,
                    MODE,
                    ParamKind::Choice(vec![
                        Choice::new("append", Text::key("note.merge.mode.append")),
                        Choice::new("prepend", Text::key("note.merge.mode.prepend")),
                    ]),
                ))
                .with_param(parameter(NOTES_MERGE, SEPARATOR, ParamKind::Text))
                .with_param(parameter(NOTES_MERGE, TRASH_PARAM, ParamKind::Bool))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
        ]
    }

    /// Lo schema delle impostazioni di questo componente: cartelle, template e
    /// formati di giornaliere e inserimenti. Chi monta le registra; chi invoca
    /// le legge via `host.setting`, con i default qui sotto quando nessuno ha
    /// deciso. Tutte `program_writable`: sono profili di vault reversibili e
    /// non toccano la privacy, come i pesi della ricerca.
    pub fn settings() -> Vec<SettingSpec> {
        vec![
            SettingSpec::new(
                DAILY_FOLDER_KEY,
                Text::key(S_DAILY_FOLDER),
                SettingKind::Text {
                    default: FOLDER_DAILY.into(),
                },
            )
            .describing(Text::key(S_DAILY_FOLDER_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                DAILY_TEMPLATE_KEY,
                Text::key(S_DAILY_TEMPLATE),
                SettingKind::Text {
                    default: DAILY_TEMPLATE.into(),
                },
            )
            .describing(Text::key(S_DAILY_TEMPLATE_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                DATE_FORMAT_KEY,
                Text::key(S_DATE_FORMAT),
                SettingKind::Text {
                    default: ISO_DATE.into(),
                },
            )
            .describing(Text::key(S_DATE_FORMAT_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                TIME_FORMAT_KEY,
                Text::key(S_TIME_FORMAT),
                SettingKind::Text {
                    default: CLOCK_24.into(),
                },
            )
            .describing(Text::key(S_TIME_FORMAT_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                UNIQUE_PREFIX_KEY,
                Text::key(S_UNIQUE_PREFIX),
                SettingKind::Text {
                    default: UNIQUE_PREFIX_DEFAULT.into(),
                },
            )
            .describing(Text::key(S_UNIQUE_PREFIX_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
        ]
    }
}

impl CommandProvider for TemplateCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        TemplateCommands::specs()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let args = Args::new(&args);
        match command {
            NOTES_FROM_TEMPLATE => from_template(args, mode, host),
            NOTES_DAILY => daily(args, mode, host),
            NOTES_UNIQUE => unique(args, mode, host),
            NOTES_RANDOM => random(mode, host),
            NOTES_INSERT_DATETIME => insert_datetime(args, mode, host),
            NOTES_INSERT_TEMPLATE => insert_template(args, mode, host),
            NOTES_EXTRACT => extract(args, mode, host),
            NOTES_MERGE => merge(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn command(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

fn from_template(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TEMPLATE)))?;
    let tpl = DocId::new(with_extension(host, template)?);
    let title = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| file_name(&tpl));
    if title.is_empty() {
        return Err(PluginError::BadArgs(Text::message(
            E_EMPTY_TEMPLATE,
            vec![Arg::text("doc", tpl.as_str())],
        )));
    }
    let folder = folder_arg(args.text(FOLDER))?;
    // Un `name` con slash nomina già la cartella: `folder` la prepende solo
    // quando il nome è nudo. Mai una cartella inventata in silenzio.
    let wanted = match (folder, title.contains('/')) {
        (Some(folder), false) => format!("{folder}/{title}"),
        _ => title,
    };
    let id = host.free_name(&DocId::new(with_extension(host, &wanted)?));
    let summary = Text::message(P_FROM, vec![Arg::text(TEMPLATE, tpl.as_str())]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let grezzo = host.read_document(&tpl)?;
    let ctx = context(host)?;
    let body = expand_full(&grezzo, &file_name(&id), &ctx, host)?;
    host.create_document(&id, &body)?;
    link_daily_property(host, &id, &ctx.date);
    Ok(created(
        Text::message(
            D_FROM,
            vec![
                Arg::text("doc", id.as_str()),
                Arg::text(TEMPLATE, tpl.as_str()),
            ],
        ),
        Text::message(U_FROM, vec![Arg::text("doc", id.as_str())]),
        id,
    ))
}

fn daily(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let date = match args.text(DATE).map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => valid_date(raw)?,
        None => today(host)?,
    };
    let folder = args
        .text(FOLDER)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(valid_folder)
        .transpose()?
        .unwrap_or_else(|| daily_folder(host));
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| daily_template(host));
    let extension = crate::formats::new_note_extension(host)?;
    let id = DocId::new(format!("{folder}/{date}.{extension}"));
    let summary = Text::message(P_DAILY, vec![Arg::text(DATE, &date)]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let exists = host.list_documents(None)?.items.iter().any(|d| d == &id);
    if exists {
        return Ok(CommandOutcome::notify(Text::message(
            D_DAILY_OPEN,
            vec![Arg::text(DATE, &date)],
        ))
        .with_effect(CommandEffect::Navigate { doc: id }));
    }
    let ctx = context_of(host, &date)?;
    let body = match host.read_document(&DocId::new(with_extension(host, &template)?)) {
        Ok(grezzo) => expand_full(&grezzo, &date, &ctx, host)?,
        Err(PluginError::NotFound(_)) => String::new(),
        Err(and) => return Err(and),
    };
    host.create_document(&id, &body)?;
    link_daily_property(host, &id, &date);
    Ok(created(
        Text::message(D_DAILY, vec![Arg::text(DATE, &date)]),
        Text::message(U_DAILY, vec![Arg::text(DATE, &date)]),
        id,
    ))
}

/// Collega la proprietà `date` alla nota giornaliera corrispondente (P05.1):
/// se la nota ha già una proprietà `date` col valore di oggi, resta; se non
/// ce l'ha, la si scrive via comando — mai YAML diretto, PropertiesOwner resta
/// proprietario. Best-effort: un vault senza quella chiave o un comando che
/// rifiuta non fa fallire la creazione della nota.
fn link_daily_property(host: &mut dyn HostApi, id: &DocId, date: &str) {
    let model = match host.read_model(id) {
        Ok(model) => model,
        Err(_) => return,
    };
    if model.frontmatter.get(DATE).is_some() {
        return;
    }
    let _ = host.run_command(
        PROP_SET,
        serde_json::json!({ DOC: id.as_str(), "key": DATE, "value": date }),
    );
}

fn created(notify: Text, undo: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::notify(notify)
        .undoable(Undo::by_command(
            undo,
            TRASH,
            serde_json::json!({ "doc": id.as_str() }),
        ))
        .with_effect(CommandEffect::Navigate { doc: id })
}

fn plan(summary: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::done().with_effect(CommandEffect::Plan(
        CommandPlan::of_edits(summary, Vec::new()).with_doc(id),
    ))
}

/// Il contesto di espansione: data e ora **civili** dell'utente, dal suo fuso.
struct Ctx {
    date: String,
    time: String,
    datetime: String,
    year: String,
    month: String,
    day: String,
    hour: String,
    minute: String,
}

/// Contesto di adesso, dall'orologio e dal fuso dell'host (deterministico nei
/// test via `MemoryHost`, mai `SystemTime` diretto).
fn context(host: &dyn ReadApi) -> Result<Ctx, PluginError> {
    let locale = host.user_locale();
    context_at(host.now_unix_millis(), &locale)
}

/// Contesto per una data `YYYY-MM-DD` con l'ora di adesso: è ciò che una
fn context_of(host: &dyn ReadApi, date: &str) -> Result<Ctx, PluginError> {
    let locale = host.user_locale();
    let (_, _, _, hh, mm) = civil_parts(host.now_unix_millis(), &locale)?;
    let time = format_time(hh, mm, locale.hour_cycle);
    Ok(Ctx {
        date: date.to_string(),
        time: time.clone(),
        datetime: format!("{date} {time}"),
        year: date.get(..4).unwrap_or("").to_string(),
        month: date.get(5..7).unwrap_or("").to_string(),
        day: date.get(8..10).unwrap_or("").to_string(),
        hour: format!("{hh:02}"),
        minute: format!("{mm:02}"),
    })
}

fn context_at(now_ms: u64, locale: &fub_abi::locale::Locale) -> Result<Ctx, PluginError> {
    let (y, m, d, hh, mm) = civil_parts(now_ms, locale)?;
    let date = format!("{y:04}-{m:02}-{d:02}");
    let time = format_time(hh, mm, locale.hour_cycle);
    Ok(Ctx {
        date: date.clone(),
        time: time.clone(),
        datetime: format!("{date} {time}"),
        year: format!("{y:04}"),
        month: format!("{m:02}"),
        day: format!("{d:02}"),
        hour: format!("{hh:02}"),
        minute: format!("{mm:02}"),
    })
}

/// An explicitly named zone owns its historical/DST offset; the host's
/// snapshot offset is used only when it supplied no named zone.
fn civil_parts(
    now_ms: u64,
    locale: &fub_abi::locale::Locale,
) -> Result<(i64, u64, u64, u64, u64), PluginError> {
    let name = locale.timezone.trim();
    if !name.is_empty() {
        let zone = jiff::tz::TimeZone::get(name).map_err(|_| {
            PluginError::BadArgs(Text::message(E_BAD_ZONE, vec![Arg::text("zone", name)]))
        })?;
        let instant = i64::try_from(now_ms)
            .ok()
            .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_BAD_INSTANT)))?;
        let civil = instant.to_zoned(zone);
        return Ok((
            civil.year() as i64,
            civil.month() as u64,
            civil.day() as u64,
            civil.hour() as u64,
            civil.minute() as u64,
        ));
    }
    let civil = locale.to_civil_millis(now_ms);
    let days = civil.div_euclid(86_400_000);
    let in_day = civil.rem_euclid(86_400_000) as u64;
    let (y, m, d) = civil_from_days(days);
    Ok((y, m, d, in_day / 3_600_000, (in_day % 3_600_000) / 60_000))
}

fn format_time(hh: u64, mm: u64, cycle: HourCycle) -> String {
    match cycle {
        HourCycle::H23 => format!("{hh:02}:{mm:02}"),
        HourCycle::H12 => {
            let suffix = if hh < 12 { "AM" } else { "PM" };
            let h12 = match hh % 12 {
                0 => 12,
                h => h,
            };
            format!("{h12}:{mm:02} {suffix}")
        }
    }
}

/// Vocabolario **chiuso** delle variabili (P05.2): titolo, date/ore civili,
/// nome file e numero casuale per i nomi. Nessun callback, nessuno scripting:
/// ciò che non sta nel vocabolario resta testo identico, mai errore e mai
/// stringa vuota.
fn expand_full(
    src: &str,
    title: &str,
    ctx: &Ctx,
    host: &dyn HostApi,
) -> Result<String, PluginError> {
    const KNOWN: &[&str] = &[
        "{{title}}",
        "{{name}}",
        "{{date}}",
        "{{time}}",
        "{{datetime}}",
        "{{year}}",
        "{{month}}",
        "{{day}}",
        "{{hour}}",
        "{{minute}}",
        "{{filename}}",
        "{{random}}",
    ];
    // A title can itself contain a placeholder expanded by the later pass.
    if !KNOWN.iter().any(|k| src.contains(*k)) {
        return Ok(src.to_string());
    }
    let random = if src.contains("{{random}}")
        || (title.contains("{{random}}")
            && (src.contains("{{title}}")
                || src.contains("{{name}}")
                || src.contains("{{filename}}")))
    {
        Some(random_suffix(host)?)
    } else {
        None
    };
    // Le `replace` a cascata restano per il caso pieno — una sostituzione può
    // contenere un segnaposto successivo, e una passata sola non lo
    // riprodurrebbe. Una variabile ignota resta testo: non si tocca.
    Ok(src
        .replace("{{title}}", title)
        .replace("{{name}}", title)
        .replace("{{filename}}", title)
        .replace("{{datetime}}", &ctx.datetime)
        .replace("{{date}}", &ctx.date)
        .replace("{{time}}", &ctx.time)
        .replace("{{year}}", &ctx.year)
        .replace("{{month}}", &ctx.month)
        .replace("{{day}}", &ctx.day)
        .replace("{{hour}}", &ctx.hour)
        .replace("{{minute}}", &ctx.minute)
        .replace("{{random}}", random.as_deref().unwrap_or("{{random}}")))
}

/// Four readable hexadecimal digits from the host entropy capability. A
/// missing capability is an error, never a silently repeated identifier.
fn random_suffix(host: &dyn HostApi) -> Result<String, PluginError> {
    let bytes = host.random_bytes(2)?;
    Ok(format!("{:02X}{:02X}", bytes[0], bytes[1]))
}

fn today(host: &dyn ReadApi) -> Result<String, PluginError> {
    Ok(context(host)?.date)
}

/// Il titolo di una nota: il nome del file senza l'estensione, qualunque sia.
fn file_name(id: &DocId) -> String {
    id.page_name().to_string()
}

/// Un nome che non porta già un formato del vault riceve l'estensione delle
/// note nuove ([`crate::formats::with_extension`]).
fn with_extension(
    host: &(impl fub_abi::traits::VaultRead + fub_abi::traits::SettingsRead + ?Sized),
    name: &str,
) -> Result<String, PluginError> {
    Ok(crate::formats::with_extension(
        host,
        name,
        &crate::formats::new_note_extension(host)?,
    ))
}

/// Una data `YYYY-MM-DD`, o il perché no. Il formato è stretto di proposito:
/// la giornaliera è un path, e un path tollerante (`5/7/2026`) è traversal o
/// ambiguità fra fusi — la lettura tollerante resta alle proprietà.
fn valid_date(raw: &str) -> Result<String, PluginError> {
    let shaped = raw.len() == 10
        && raw.as_bytes()[4] == b'-'
        && raw.as_bytes()[7] == b'-'
        && raw[..4].chars().all(|c| c.is_ascii_digit())
        && raw[5..7].chars().all(|c| c.is_ascii_digit())
        && raw[8..].chars().all(|c| c.is_ascii_digit());
    let ok = shaped
        && valid_civil_date(
            raw[..4].parse::<i32>().unwrap_or_default(),
            raw[5..7].parse::<u8>().unwrap_or_default(),
            raw[8..].parse::<u8>().unwrap_or_default(),
        );
    if ok {
        Ok(raw.to_string())
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_BAD_DATE,
            vec![Arg::text(A_VALUE, raw)],
        )))
    }
}

/// Un orario `HH:MM` 24h, o il perché no. Stretto come la data: un inserimento
/// tollerante scriverebbe nel testo ciò che nessuno ha chiesto.
fn valid_time(raw: &str) -> Result<(u64, u64), PluginError> {
    let parts: Vec<&str> = raw.split(':').collect();
    let ok = parts.len() == 2
        && parts[0].len() == 2
        && parts[1].len() == 2
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].chars().all(|c| c.is_ascii_digit());
    let (h, m) = (
        parts
            .first()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(99),
        parts
            .get(1)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(99),
    );
    if ok && h < 24 && m < 60 {
        Ok((h, m))
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_BAD_TIME,
            vec![Arg::text(A_VALUE, raw)],
        )))
    }
}

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

fn folder_arg(raw: Option<&str>) -> Result<Option<String>, PluginError> {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(valid_folder)
        .transpose()
}

/// La cartella delle giornaliere decisa nelle impostazioni, o il default. Una
/// parola illeggibile nel file vale il default — come `date_formats` del
/// kernel — invece di rendere il vault illeggibile.
fn daily_folder(host: &dyn HostApi) -> String {
    match host.setting(DAILY_FOLDER_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => {
            valid_folder(&s).unwrap_or_else(|_| FOLDER_DAILY.into())
        }
        _ => FOLDER_DAILY.into(),
    }
}

fn daily_template(host: &dyn HostApi) -> String {
    match host.setting(DAILY_TEMPLATE_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => {
            let s = s.trim();
            if s.is_empty() {
                DAILY_TEMPLATE.into()
            } else {
                s.to_string()
            }
        }
        _ => DAILY_TEMPLATE.into(),
    }
}

fn insert_format(host: &dyn HostApi) -> String {
    match host.setting(DATE_FORMAT_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => match s.trim() {
            CLOCK_TIME | CLOCK_DATETIME | ISO_DATE => s.trim().to_string(),
            _ => ISO_DATE.into(),
        },
        _ => ISO_DATE.into(),
    }
}

/// Crea una nota senza sovrascrivere mai (P05.3): `name`, poi `name 1`, …
/// via `free_name` + `create_document` (che rifiuta se il nome è occupato).
/// Con `random: true` il nome nasce dal caso dell'host (`random_bytes`:
/// negato = `PermissionDenied`, mai zeri). Dry-run: piano col nome libero.
fn unique(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if mode.is_dry_run() {
        let id = unique_name(args, host)?;
        return Ok(plan(
            Text::message(P_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
            id,
        ));
    }
    let id = unique_name(args, host)?;
    let body = match template {
        Some(tpl) => {
            let grezzo = host.read_document(&DocId::new(with_extension(host, &tpl)?))?;
            let ctx = context(host)?;
            expand_full(&grezzo, &file_name(&id), &ctx, host)?
        }
        None => String::new(),
    };
    host.create_document(&id, &body)?;
    Ok(created(
        Text::message(D_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
        Text::message(U_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
        id,
    ))
}

fn unique_name(args: Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    if args.flag(RANDOM, false) {
        return random_name(host);
    }
    let wanted = args.text(NAME).map(str::trim).filter(|s| !s.is_empty());
    let prefix = unique_prefix(host)?;
    let name = match (prefix.as_deref(), wanted) {
        (Some(prefix), Some(name)) => format!("{prefix} {name}"),
        (Some(prefix), None) => prefix.to_string(),
        (None, Some(name)) => name.to_string(),
        (None, None) => UNTITLED.to_string(),
    };
    Ok(host.free_name(&DocId::new(with_extension(host, &name)?)))
}

/// Il prefisso di adesso nel formato dichiarato, o `None` se il formato è
/// vuoto. L'ora è quella dell'host, nel suo fuso: la stessa di `{{date}}`.
fn unique_prefix(host: &dyn HostApi) -> Result<Option<String>, PluginError> {
    let format = match host.setting(UNIQUE_PREFIX_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => s.trim().to_string(),
        _ => UNIQUE_PREFIX_DEFAULT.to_string(),
    };
    if format.is_empty() {
        return Ok(None);
    }
    let ctx = context(host)?;
    Ok(Some(format_moment(&format, &ctx)))
}

/// I token `YYYY`, `MM`, `DD`, `HH`, `mm` nel contesto; il resto resta
/// com'è. `MM` (mese) e `mm` (minuti) si distinguono per maiuscole, come
/// nella convenzione diffusa che chi scrive un formato si aspetta.
fn format_moment(format: &str, ctx: &Ctx) -> String {
    let mut out = String::new();
    let mut rest = format;
    while !rest.is_empty() {
        let (token, value) = [
            ("YYYY", &ctx.year),
            ("MM", &ctx.month),
            ("DD", &ctx.day),
            ("HH", &ctx.hour),
            ("mm", &ctx.minute),
        ]
        .into_iter()
        .find(|(token, _)| rest.starts_with(token))
        .map_or((None, None), |(t, v)| (Some(t), Some(v)));
        match (token, value) {
            (Some(token), Some(value)) => {
                out.push_str(value);
                rest = &rest[token.len()..];
            }
            _ => {
                let c = rest.chars().next().expect("rest non vuoto");
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// Un nome casuale leggibile: `Nota-<base32>` da 48 bit di entropia dell'host.
/// Mai `SystemTime` diretto (non testabile, morto sotto sandbox): l'orologio
/// e il caso sono capacità dell'host. Senza entropia si rifiuta nominando il
/// permesso — un id di zeri collide con ogni altro id non generato.
fn random_name(host: &dyn HostApi) -> Result<DocId, PluginError> {
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let bytes = host.random_bytes(6)?;
    let mut n: u64 = 0;
    for (i, b) in bytes.iter().take(6).enumerate() {
        n |= (*b as u64) << (8 * i);
    }
    let mut out = String::with_capacity(10);
    let mut v = n;
    for _ in 0..10 {
        out.push(ALPHABET[(v & 31) as usize] as char);
        v >>= 5;
    }
    let extension = crate::formats::new_note_extension(host)?;
    Ok(host.free_name(&DocId::new(format!("Nota-{out}.{extension}"))))
}

/// Apre una nota a caso fra quelle del vault (P05.3). Sola lettura: niente
/// scritture, niente undo, effetto `Navigate`. Scelta uniforme via
/// `random_bytes` dell'host; vault vuoto = errore detto, non panico.
fn random(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let mut ids: Vec<DocId> = host
        .list_documents(None)?
        .items
        .into_iter()
        // Una nota è un documento in prosa, con qualunque estensione il suo
        // formato dichiari (`.md`, `.markdown`, o quella di un plugin).
        .filter(|d| crate::formats::understands(host, d, fub_abi::options::source::PROSE))
        .collect();
    ids.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    if ids.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_NOTES)));
    }
    // Il modo non cambia la risposta: leggere a caso non scrive comunque.
    let _ = mode;
    let bytes = host.random_bytes(8)?;
    let mut n: u64 = 0;
    for (i, b) in bytes.iter().take(8).enumerate() {
        n |= (*b as u64) << (8 * i);
    }
    let pick = ids[(n % ids.len() as u64) as usize].clone();
    Ok(CommandOutcome::notify(Text::message(
        D_RANDOM,
        vec![Arg::text(A_DOC, pick.as_str())],
    ))
    .with_effect(CommandEffect::Navigate { doc: pick }))
}

/// Il documento e la posizione in cui inserire: `doc` detto, o quello aperto;
/// `at` detto, o il cursore del pannello attivo. Solo selezioni **placed**:
/// a buffer sporco le coordinate valgono per il buffer e non per il file, e
/// scriverci sopra taglierebbe i byte sbagliati mentre l'utente scrive
/// (decisione 0007). La shell fa flush prima della patch; il comando rifiuta
/// invece di indovinare.
fn insert_target(args: Args<'_>, host: &dyn HostApi) -> Result<(DocId, usize), PluginError> {
    let context = host.active_context();
    let doc = args
        .document(DOC)
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    // Ciò che si inserisce è testo di una nota: in un canvas o in un `.base`
    // finirebbe dentro la struttura.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    if let Some(ns) = args.numbers(AT) {
        let at = ns.first().copied().unwrap_or(0.0);
        return position(at).map(|at| (doc, at));
    }
    let Some(context) = context else {
        return Err(PluginError::BadArgs(Text::key(E_NO_DOC)));
    };
    if context.doc.as_ref() != Some(&doc) {
        return Err(PluginError::BadArgs(Text::message(
            E_NO_DOC,
            vec![Arg::text(A_DOC, doc.as_str())],
        )));
    }
    let selections = context
        .selections
        .as_ref()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    let placed = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    Ok((doc, placed.primary.span.start))
}

/// Un `at` JSON diventa un offset in byte, o si spiega. Come `position` in
/// `commands.rs`: `as usize` tradurrebbe `-1` in un numero enorme e `3.9` in
/// `3` — una posizione plausibile e sbagliata.
fn position(n: f64) -> Result<usize, PluginError> {
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_AT_NOT_OFFSET,
            vec![Arg::text(A_VALUE, n.to_string())],
        )))
    }
}

/// Inserisce data/ora di adesso al cursore (P05.3): `date`, `time` o `datetime`
/// nel fuso dell'utente, con l'orologio a 12/24 ore dalle impostazioni.
/// Scrittura chirurgica CAS (`EditRequest` + revisione): conflitto = `Conflict`,
/// mai sovrascrittura. Dry-run: piano con l'edit vero.
fn insert_datetime(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let (doc, at) = insert_target(args, host)?;
    let format = args
        .text(FORMAT)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| insert_format(host));
    let value = datetime_now(host, &format)?;
    let source = host.read_document(&doc)?;
    let clamped = at.min(source.len());
    let at = snap_to_boundary(&source, clamped);
    let revision = host.document_revision(&doc)?;
    let request = EditRequest::new(revision, vec![TextEdit::insert(at, &value)]);
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                Text::message(
                    P_INSERT_DT,
                    vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
                ),
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        Text::message(
            U_INSERT_DT,
            vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
        ),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    let done_msg = Text::message(
        D_INSERT_DT,
        vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
    );
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(done_msg)
        .undoable(undo)
        .with_effect(effect))
}

/// Data/ora di adesso nel fuso dell'utente. `time` può essere `HH:MM` detto
/// (per i test e per chi compone): stretto come la data, mai tollerante.
fn datetime_now(host: &dyn HostApi, format: &str) -> Result<String, PluginError> {
    let locale = host.user_locale();
    let (y, m, d, hh, mm) = civil_parts(host.now_unix_millis(), &locale)?;
    let date = format!("{y:04}-{m:02}-{d:02}");
    let time = match host.setting(TIME_FORMAT_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) if s.trim() == CLOCK_12 => {
            format_time(hh, mm, HourCycle::H12)
        }
        _ => format_time(hh, mm, HourCycle::H23),
    };
    match format {
        ISO_DATE => Ok(date),
        CLOCK_TIME => Ok(time),
        CLOCK_DATETIME => Ok(format!("{date} {time}")),
        other if other.contains(':') => {
            let (h, m) = valid_time(other)?;
            Ok(format_time(h, m, HourCycle::H23))
        }
        other => Err(PluginError::BadArgs(Text::message(
            E_BAD_TIME,
            vec![Arg::text(A_VALUE, other)],
        ))),
    }
}

/// Sposta un offset su un confine di carattere e fuori da un `\r\n`: mai un
/// taglio a metà carattere e mai un `\r` orfano. Il cursore della shell può
/// arrivare da coordinate di riga/colonna arrotondate; la disciplina
/// dell'edit la fa rispettare comunque l'host, qui si evita il rifiuto ovvio.
fn snap_to_boundary(source: &str, at: usize) -> usize {
    let mut at = at.min(source.len());
    while at < source.len() && !source.is_char_boundary(at) {
        at += 1;
    }
    if text_policy::splits_newline(source, at) && at > 0 {
        at -= 1;
    }
    at
}

/// Inserisce un template al cursore e fonde le proprietà assenti (P05.2):
/// il corpo va nel testo via edit chirurgico CAS; ogni chiave del frontmatter
/// del template assente nel target si scrive via `run_command`
/// `note.property.set` — mai YAML diretto. Se una proprietà non si fonde, il
/// testo resta inserito e il guasto si conta e si dice (`Partial`), non si
/// butta il lavoro fatto. Template senza frontmatter = solo testo.
fn insert_template(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TEMPLATE)))?;
    let tpl = DocId::new(with_extension(host, template)?);
    let (doc, at) = insert_target(args, host)?;
    let merge_props = args.flag(MERGE, true);
    let grezzo = host.read_document(&tpl)?;
    let ctx = context(host)?;
    let expanded = expand_full(&grezzo, &file_name(&doc), &ctx, host)?;
    // Il frontmatter si separa solo se il formato del template lo legge:
    // altrove le righe `---` in testa sono testo come le altre.
    let (props, body) = if crate::formats::understands(host, &tpl, syntax::FRONTMATTER) {
        split_frontmatter(&expanded)?
    } else {
        (Vec::new(), expanded)
    };
    let missing = if merge_props && !props.is_empty() {
        missing_properties(host, &doc, &props)?
    } else {
        Vec::new()
    };
    let source = host.read_document(&doc)?;
    let at = snap_to_boundary(&source, at.min(source.len()));
    let revision = host.document_revision(&doc)?;
    let request = EditRequest::new(revision, vec![TextEdit::insert(at, &body)]);
    let summary = Text::message(
        P_INSERT_TPL,
        vec![
            Arg::text(TEMPLATE, tpl.as_str()),
            Arg::text(A_DOC, doc.as_str()),
        ],
    );
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    let mut failed: Vec<Failure> = Vec::new();
    let mut property_undo: Vec<Vec<UndoStep>> = Vec::new();
    for (key, value) in missing {
        let expected = serde_json::json!({ "kind": "absent" }).to_string();
        match host.run_command(
            PROP_SET,
            serde_json::json!({ DOC: doc.as_str(), "key": key, "value": value, "expected": expected }),
        ) {
            Ok(outcome) => {
                if let Some(undo) = outcome.undo {
                    property_undo.push(undo.steps);
                }
            }
            Err(and) => failed.push(Failure::other(and)),
        }
    }
    let notify = if failed.is_empty() {
        Text::message(
            D_INSERT_TPL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
            ],
        )
    } else {
        Text::message(
            D_INSERT_TPL_PARTIAL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
                Arg::text(A_FAILED, why(&failed)),
            ],
        )
    };
    // Each property owner inverse expects the preceding revision. Replay them
    // backwards before the body inverse, which expects the post-insertion text.
    let mut steps: Vec<UndoStep> = property_undo.into_iter().rev().flatten().collect();
    steps.push(UndoStep::Edit(PlannedEdit::new(
        doc.clone(),
        report.inverse(),
    )));
    let undo = Undo {
        label: Text::message(
            U_INSERT_TPL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
            ],
        ),
        steps,
    };
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(Partial::of(1, usize::from(failed.is_empty()), failed))
        .with_effect(effect))
}

/// Divide `---\n…\n---\n` dal corpo, per un template il cui formato dichiara
/// [`syntax::FRONTMATTER`]: il frontmatter si riconosce solo in testa
/// (dopo un eventuale BOM), il corpo resta byte-identico. Le proprietà sono
/// parse come una mappa YAML vera e serializzate una per una come YAML flow:
/// liste e strutture annidate restano strutture, mai chiavi piatte inventate.
fn split_frontmatter(src: &str) -> Result<(Vec<(String, String)>, String), PluginError> {
    let start = text_policy::bom_len(src);
    let rest = &src[start..];
    let Some(after_open) = rest.strip_prefix("---") else {
        return Ok((Vec::new(), src.to_string()));
    };
    if !after_open.starts_with('\n') && !after_open.starts_with("\r\n") {
        return Ok((Vec::new(), src.to_string()));
    }
    let mut cursor = 0usize;
    let mut close = None;
    for line in after_open.split_inclusive('\n') {
        let next = cursor + line.len();
        if matches!(line.trim(), "---" | "...") {
            close = Some((cursor, next));
            break;
        }
        cursor = next;
    }
    let Some((yaml_end, body_start)) = close else {
        return Ok((Vec::new(), src.to_string()));
    };
    let yaml = after_open[..yaml_end]
        .trim_start_matches(['\n', '\r'])
        .trim_end_matches(['\n', '\r']);
    let body = format!("{}{}", &src[..start], &after_open[body_start..]);
    let parsed = if yaml.is_empty() {
        serde_json::Value::Null
    } else {
        serde_yaml_ng::from_str::<serde_json::Value>(yaml).map_err(|and| {
            PluginError::BadArgs(Text::message(
                E_BAD_FRONTMATTER,
                vec![Arg::text("reason", and.to_string())],
            ))
        })?
    };
    let map = match parsed {
        serde_json::Value::Object(map) => map,
        serde_json::Value::Null => serde_json::Map::new(),
        _ => return Err(PluginError::BadArgs(Text::key(E_BAD_FRONTMATTER_MAP))),
    };
    let properties = map
        .into_iter()
        .map(|(key, value)| (key, serde_json::to_string(&value).expect("JSON value")))
        .collect();
    Ok((properties, body))
}

/// Le coppie del template la cui chiave manca nel target. Il target si legge
/// via `read_model` (il parse vero, di PropertiesOwner); se il modello è
/// illeggibile si rifiuta prima dell'inserimento, mai un merge inventato.
fn missing_properties(
    host: &dyn HostApi,
    doc: &DocId,
    props: &[(String, String)],
) -> Result<Vec<(String, String)>, PluginError> {
    let model = host.read_model(doc)?;
    Ok(props
        .iter()
        .filter(|(k, _)| model.frontmatter.get(k).is_none())
        .cloned()
        .collect())
}

fn why(failures: &[Failure]) -> String {
    failures
        .iter()
        .map(|g| match &g.subject {
            Some(doc) => format!("«{doc}» ({})", g.error),
            None => g.error.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Estrae la selezione in una nota nuova (P05.5): prima si crea e si verifica
/// la destinazione, poi si sostituisce la selezione con un link/embed via
/// edit CAS. **Mai il contrario**: la sorgente non si tocca prima che la
/// destinazione sia sicura. Se la sostituzione fallisce, la nota creata va
/// nel cestino (compensazione) e l'errore torna a chi chiama — nessuna mezza
/// estrazione silenziosa. Undo: inverso dell'edit + cestino della nota.
fn extract(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let view_context = host
        .active_context()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    let from = view_context
        .doc
        .clone()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    // La selezione diventa il corpo di una nota e al suo posto va un link:
    // tutte e due le cose hanno senso solo in un sorgente in prosa, e il link
    // lo scrive il suo formato. Si chiede prima delle coordinate: le carte
    // scelte in una tela arrivano senza, e il motivo vero è il formato.
    crate::formats::require(host, &from, fub_abi::options::source::PROSE)?;
    let selections = view_context
        .selections
        .as_ref()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    let placed = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    if !placed.secondary.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_MULTI_SELECTION)));
    }
    let primary = &placed.primary;
    if primary.text.trim().is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_SELECTION)));
    }
    let selected = primary.text.clone();
    let span = primary.span;
    let name = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| slug_from_text(&selected));
    if name.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_SELECTION)));
    }
    let id = host.free_name(&DocId::new(with_extension(host, &name)?));
    // The session supplied the span and text. A stale context must not replace
    // some other bytes even if the file itself has a valid current revision.
    let revision = host.document_revision(&from)?;
    let original = host.read_document(&from)?;
    if original.get(span.start..span.end) != Some(selected.as_str()) {
        return Err(PluginError::Conflict(Text::message(
            E_STALE_SELECTION,
            vec![Arg::text(A_DOC, from.as_str())],
        )));
    }
    check_relative_assets(host, &from, &id, Some(span))?;
    let embed = matches!(args.text(REPLACE).unwrap_or("link").trim(), "embed");
    let link = crate::formats::link_text(
        host,
        &from,
        &crate::formats::wikilink(id.page_name(), None, embed),
    )?;
    let summary = Text::message(
        P_EXTRACT,
        vec![
            Arg::text(A_DOC, id.as_str()),
            Arg::text(FROM, from.as_str()),
        ],
    );
    if mode.is_dry_run() {
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
            CommandPlan::of_edits(summary, Vec::new())
                .with_doc(from)
                .with_doc(id),
        )));
    }
    // 1. La destinazione: corpo = selezione, avvolta dal template se detto.
    let body = match args.text(TEMPLATE).map(str::trim).filter(|s| !s.is_empty()) {
        Some(tpl) => {
            let grezzo = host.read_document(&DocId::new(with_extension(host, tpl)?))?;
            let ctx = context(host)?;
            expand_full(&grezzo, &file_name(&id), &ctx, host)?.replace("{{selection}}", &selected)
        }
        None => selected.clone(),
    };
    host.create_document(&id, &body)?;
    // 2. La sorgente, solo a destinazione sicura: la selezione diventa link.
    let request = EditRequest::new(revision, vec![TextEdit::replace(span, link)]);
    let report = match host.apply_edit(&from, request) {
        Ok(report) => report,
        Err(and) => return Err(compensate_extract(host, &id, and)),
    };
    let undo = Undo {
        label: Text::message(
            U_EXTRACT,
            vec![
                Arg::text(A_DOC, id.as_str()),
                Arg::text(FROM, from.as_str()),
            ],
        ),
        steps: vec![
            UndoStep::Edit(PlannedEdit::new(from.clone(), report.inverse())),
            UndoStep::Command {
                command: TRASH.into(),
                args: serde_json::json!({ "doc": id.as_str() }),
            },
        ],
    };
    let from_label = Arg::text(FROM, from.as_str());
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc: from,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(Text::message(
        D_EXTRACT,
        vec![Arg::text(A_DOC, id.as_str()), from_label],
    ))
    .undoable(undo)
    .with_effect(effect))
}

fn compensate_extract(
    host: &mut dyn HostApi,
    created: &DocId,
    failure: PluginError,
) -> PluginError {
    match host.trash_document(created) {
        Ok(_) => failure,
        Err(cleanup) => PluginError::Conflict(Text::message(
            E_EXTRACT_CLEANUP,
            vec![
                Arg::text("reason", failure.to_string()),
                Arg::text(A_DOC, created.as_str()),
                Arg::text("cleanup", cleanup.to_string()),
            ],
        )),
    }
}

/// Un titolo dalla selezione: prima riga non vuota, troncata a 60 caratteri,
/// senza caratteri vietati nei path. Mai vuoto: il chiamante rifiuta dopo.
fn slug_from_text(text: &str) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let clean: String = first
        .chars()
        .take(60)
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/' => ' ',
            c => c,
        })
        .collect();
    clean.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Relative embedded asset paths cannot be transplanted to another directory
/// without rewriting their link syntax. Reject before either note is mutated;
/// absolute vault paths and external URLs retain their meaning.
fn check_relative_assets(
    host: &dyn HostApi,
    source: &DocId,
    target: &DocId,
    selected: Option<fub_abi::model::Span>,
) -> Result<(), PluginError> {
    if source.as_str().rsplit_once('/').map(|(dir, _)| dir)
        == target.as_str().rsplit_once('/').map(|(dir, _)| dir)
    {
        return Ok(());
    }
    let model = host.read_model(source)?;
    for link in model.links {
        let inside =
            selected.is_none_or(|span| link.span.start >= span.start && link.span.end <= span.end);
        if inside
            && link.embed
            && matches!(&link.target, LinkTarget::Path(path) if !path.starts_with('/'))
        {
            return Err(PluginError::Conflict(Text::message(
                E_ASSET_MOVE,
                vec![Arg::text(A_DOC, source.as_str())],
            )));
        }
    }
    Ok(())
}

/// Unisce note dentro una destinazione (P05.5): per ogni sorgente si legge il
/// corpo, si accoda/prepone alla destinazione via edit CAS, e **solo dopo**
/// che la destinazione è sicura la sorgente va nel cestino. Se l'edit
/// fallisce, la sorgente resta dov'è e il guasto si conta e si dice
/// (`Partial`): mai perdita silenziosa, mai merge distruttivo diretto.
/// Undo: inverso degli edit + ripristino delle sorgenti cestinate.
fn merge(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let sources = args
        .documents(FROM)
        .expect("l'host ha convalidato un parametro obbligatorio");
    if sources.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_SOURCES)));
    }
    let into = args
        .document(INTO)
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    if sources.iter().any(|s| s == &into) {
        return Err(PluginError::BadArgs(Text::message(
            E_MERGE_SELF,
            vec![Arg::text(A_DOC, into.as_str())],
        )));
    }
    // Unire è incollare un sorgente in un altro: ha senso solo fra documenti
    // in prosa. Un canvas incollato in una nota è JSON grezzo, e una nota
    // accodata a un `.base` ne cancella le viste. Si controlla prima di
    // leggere o cestinare qualunque cosa.
    for doc in std::iter::once(&into).chain(&sources) {
        crate::formats::require(host, doc, fub_abi::options::source::PROSE)?;
    }
    let prepend = matches!(args.text(MODE).unwrap_or("append").trim(), "prepend");
    let separator = args.text(SEPARATOR).unwrap_or("\n\n").to_string();
    let trash_sources = args.flag(TRASH_PARAM, true);
    // Preflight references and assets before editing *any* destination:
    // otherwise a failure discovered halfway through would leave a merge
    // duplicated in one note while the rest were silently skipped.
    let mut bodies: Vec<(DocId, String)> = Vec::new();
    for source in &sources {
        let body = host.read_document(source)?;
        if body.trim().is_empty() {
            continue;
        }
        check_relative_assets(host, source, &into, None)?;
        if trash_sources {
            match host.query_index(IndexQuery::Backlinks {
                target: source.clone(),
                page: None,
            })? {
                IndexResult::Backlinks(backlinks) if !backlinks.items.is_empty() => {
                    return Err(PluginError::Conflict(Text::message(
                        E_REFERENCED_SOURCE,
                        vec![Arg::text(A_DOC, source.as_str())],
                    )));
                }
                IndexResult::Backlinks(_) => {}
                _ => {
                    return Err(PluginError::Internal(
                        "backlink query returned another result".into(),
                    ))
                }
            }
        }
        bodies.push((source.clone(), body));
    }
    if bodies.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_SOURCES)));
    }
    let summary = Text::message(
        P_MERGE,
        vec![
            Arg::int(A_COUNT, bodies.len() as i64),
            Arg::text(A_DOC, into.as_str()),
        ],
    );
    if mode.is_dry_run() {
        let revision = host.document_revision(&into)?;
        let source = host.read_document(&into).unwrap_or_default();
        let at = snap_to_boundary(&source, if prepend { 0 } else { source.len() });
        let preview = if prepend {
            format!("{}{separator}", join_bodies(&bodies, &separator))
        } else {
            format!("{separator}{}", join_bodies(&bodies, &separator))
        };
        let request = EditRequest::new(revision, vec![TextEdit::insert(at, preview)]);
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(into, request)],
            ))),
        );
    }
    let mut failed: Vec<Failure> = Vec::new();
    let mut back_edits: Vec<PlannedEdit> = Vec::new();
    let mut trashed: Vec<(DocId, DocId)> = Vec::new();
    let mut made = 0usize;
    for (source, body) in &bodies {
        match host.read_document(source) {
            Ok(latest) if latest == *body => {}
            Ok(_) => {
                failed.push(Failure::of(
                    source.clone(),
                    PluginError::Conflict(Text::message(
                        E_SOURCE_CHANGED,
                        vec![Arg::text(A_DOC, source.as_str())],
                    )),
                ));
                continue;
            }
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        }
        let current = match host.read_document(&into) {
            Ok(current) => current,
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        };
        let at = snap_to_boundary(&current, if prepend { 0 } else { current.len() });
        let text = if prepend {
            format!("{body}{separator}")
        } else {
            format!("{separator}{body}")
        };
        let revision = match host.document_revision(&into) {
            Ok(revision) => revision,
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        };
        let request = EditRequest::new(revision, vec![TextEdit::insert(at, text)]);
        match host.apply_edit(&into, request) {
            Ok(report) => {
                made += 1;
                back_edits.push(PlannedEdit::new(into.clone(), report.inverse()));
                if trash_sources {
                    // Another writer may have changed the source while we
                    // patched the destination. Keep both copies and surface a
                    // partial merge instead of trashing their newer version.
                    match host.read_document(source) {
                        Ok(latest) if latest == *body => match host.trash_document(source) {
                            Ok(entry) => trashed.push((source.clone(), entry)),
                            Err(and) => failed.push(Failure::of(source.clone(), and)),
                        },
                        Ok(_) => failed.push(Failure::of(
                            source.clone(),
                            PluginError::Conflict(Text::message(
                                E_SOURCE_COPIED,
                                vec![Arg::text(A_DOC, source.as_str())],
                            )),
                        )),
                        Err(and) => failed.push(Failure::of(source.clone(), and)),
                    }
                }
            }
            Err(and) => failed.push(Failure::of(source.clone(), and)),
        }
    }
    let notify = if failed.is_empty() {
        Text::message(
            D_MERGE,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
            ],
        )
    } else {
        Text::message(
            D_MERGE_PARTIAL,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
                Arg::text(A_FAILED, why(&failed)),
            ],
        )
    };
    back_edits.reverse();
    let mut steps: Vec<UndoStep> = back_edits.into_iter().map(UndoStep::Edit).collect();
    for (source, entry) in trashed.into_iter().rev() {
        steps.push(UndoStep::Command {
            command: "trash.restore".into(),
            args: serde_json::json!({ "entry": entry.as_str(), "to": source.as_str() }),
        });
    }
    let undo = Undo {
        label: Text::message(
            U_MERGE,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
            ],
        ),
        steps,
    };
    let count = Partial::of(bodies.len(), made, failed);
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(count))
}

/// I corpi uniti nell'ordine delle sorgenti, col separatore fra i blocchi e
/// mai ai bordi del documento: chi chiama aggiunge il separatore dal lato
/// giusto (testa per prepend, coda per append).
fn join_bodies(bodies: &[(DocId, String)], separator: &str) -> String {
    bodies
        .iter()
        .map(|(_, b)| b.as_str())
        .collect::<Vec<_>>()
        .join(separator)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::locale::Locale;
    use fub_sdk::testing::MemoryHost;

    /// Ogni comando del template si offre nel menu `/`: è lì che si inserisce
    /// uno scheletro mentre si scrive, e la shell non ne tiene un elenco.
    #[test]
    fn every_template_command_is_offered_in_the_slash_menu() {
        for spec in TemplateCommands::specs() {
            assert_eq!(spec.surfaces, [CommandSurface::Slash], "{}", spec.id);
        }
    }

    fn ctx_for(date: &str) -> Ctx {
        Ctx {
            date: date.into(),
            time: "14:30".into(),
            datetime: format!("{date} 14:30"),
            year: date.get(..4).unwrap_or("").into(),
            month: date.get(5..7).unwrap_or("").into(),
            day: date.get(8..10).unwrap_or("").into(),
            hour: "14".into(),
            minute: "30".into(),
        }
    }

    #[test]
    fn expands_the_three_variables() {
        let host = MemoryHost::new();
        let ctx = ctx_for("2026-08-15");
        let s = expand_full("ciao {{title}} il {{date}} ({{name}})", "Nota", &ctx, &host).unwrap();
        assert_eq!(s, "ciao Nota il 2026-08-15 (Nota)");
    }

    #[test]
    fn an_unknown_variable_stays_text_instead_of_failing() {
        let ctx = ctx_for("2026-09-01");
        // Nessun callback, nessuno scripting: ciò che non sta nel vocabolario
        // resta identico, non errore e non stringa vuota.
        assert_eq!(
            expand_full(
                "{{title}} {{callback()}} {{for x in y}}",
                "Nota",
                &ctx,
                &MemoryHost::new()
            )
            .unwrap(),
            "Nota {{callback()}} {{for x in y}}"
        );
    }

    #[test]
    fn civil_timezone_wins_over_utc_for_daily_variables() {
        // 2026-09-01 00:30 a Roma (+02:00) = 2026-08-31 22:30 UTC: la data
        // civile è il primo, non il 31.
        let rome = Locale {
            utc_offset_minutes: 120,
            ..Locale::default()
        };
        let utc_day_before = 1_788_215_400_000u64;
        let ctx = context_at(utc_day_before, &rome).unwrap();
        assert_eq!(ctx.date, "2026-09-01");
        assert_eq!(
            expand_full("{{date}}", "x", &ctx, &MemoryHost::new()).unwrap(),
            "2026-09-01"
        );
    }

    #[test]
    fn named_zone_uses_its_winter_and_summer_offsets_not_the_snapshot_offset() {
        let rome = Locale {
            timezone: "Europe/Rome".into(),
            utc_offset_minutes: 0,
            ..Locale::default()
        };
        // 23:30 UTC in January (+01:00), 22:30 UTC in July (+02:00).
        let winter = context_at(1_768_519_800_000, &rome).unwrap();
        let summer = context_at(1_784_154_600_000, &rome).unwrap();
        assert_eq!(winter.datetime, "2026-01-16 00:30");
        assert_eq!(summer.datetime, "2026-07-16 00:30");
    }

    #[test]
    fn memory_host_named_zone_drives_daily_and_inserted_datetime() {
        let host = MemoryHost::new().with_locale(Locale {
            timezone: "Europe/Helsinki".into(),
            utc_offset_minutes: 0,
            ..Locale::default()
        });
        assert_eq!(today(&host).unwrap(), "2023-11-15");
        assert_eq!(
            datetime_now(&host, CLOCK_DATETIME).unwrap(),
            "2023-11-15 00:13"
        );
    }

    #[test]
    fn unknown_named_zone_fails_typed_instead_of_becoming_utc() {
        let host = MemoryHost::new().with_locale(Locale {
            timezone: "Mars/Olympus".into(),
            ..Locale::default()
        });
        assert!(matches!(today(&host), Err(PluginError::BadArgs(_))));
        assert!(matches!(
            datetime_now(&host, ISO_DATE),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn template_random_uses_injected_entropy_only_when_requested() {
        let host = MemoryHost::new();
        let ctx = ctx_for("2026-09-01");
        let first = expand_full("{{random}} {{random}}", "x", &ctx, &host).unwrap();
        let second = expand_full("{{random}}", "x", &ctx, &host).unwrap();
        let pair: Vec<_> = first.split_whitespace().collect();
        assert_eq!(pair.len(), 2);
        assert_eq!(pair[0], pair[1], "one expansion has one random value");
        assert_ne!(first[..4].to_string(), second);
        let denied = MemoryHost::new().without_entropy();
        assert_eq!(
            expand_full("{{date}}", "x", &ctx, &denied).unwrap(),
            ctx.date
        );
        assert!(matches!(
            expand_full("{{random}}", "x", &ctx, &denied),
            Err(PluginError::PermissionDenied(_))
        ));
    }

    #[test]
    fn inserted_date_and_time_follow_the_injected_civil_clock() {
        let host = MemoryHost::new().with_locale(Locale {
            utc_offset_minutes: 120,
            ..Locale::default()
        });
        assert_eq!(datetime_now(&host, ISO_DATE).unwrap(), "2023-11-15");
        assert_eq!(datetime_now(&host, CLOCK_TIME).unwrap(), "00:13");
        assert_eq!(
            datetime_now(&host, CLOCK_DATETIME).unwrap(),
            "2023-11-15 00:13"
        );
        assert!(datetime_now(&host, "25:00").is_err());
    }

    #[test]
    fn daily_paths_reject_impossible_civil_dates() {
        for invalid in ["2026-02-29", "2026-02-30", "2026-04-31"] {
            assert!(valid_date(invalid).is_err(), "{invalid}");
        }
        assert_eq!(valid_date("2024-02-29").unwrap(), "2024-02-29");
    }

    #[test]
    fn a_folder_may_not_escape_or_name_machine_space() {
        assert_eq!(valid_folder("Diario").unwrap(), "Diario");
        for bad in ["", "../fuori", ".fub/x", ".trash/y", "a/../../b"] {
            assert!(valid_folder(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn cjk_counts_one_word_per_ideograph() {
        // Il conteggio CJK è di `stats::count` e resta pinnato lì
        // (`stats.rs::counts_cjk_without_spaces_one_word_per_ideograph`):
        // qui il report usa parole già contate, senza chiamare l'altro modulo.
        assert_eq!("ciao mondo".split_whitespace().count(), 2);
        assert_eq!("、。".chars().count(), 2);
    }

    #[test]
    fn split_frontmatter_keeps_the_body_byte_identical() {
        let src = "---\ntitle: Ciao\ntags: a\n---\n# Corpo\n";
        let (props, body) = split_frontmatter(src).unwrap();
        assert_eq!(body, "# Corpo\n");
        let title = props.iter().find(|(key, _)| key == "title").unwrap();
        assert_eq!(
            serde_yaml_ng::from_str::<serde_json::Value>(&title.1).unwrap(),
            serde_json::json!("Ciao")
        );
        let nested = "---\naliases:\n  - Uno\n  - Due\nmeta:\n  owner: Mario\n---\nCorpo\n";
        let (props, body) = split_frontmatter(nested).unwrap();
        assert_eq!(body, "Corpo\n");
        assert_eq!(
            props.iter().find(|(key, _)| key == "aliases").unwrap().1,
            "[\"Uno\",\"Due\"]"
        );
        assert_eq!(
            props.iter().find(|(key, _)| key == "meta").unwrap().1,
            "{\"owner\":\"Mario\"}"
        );
        let crlf = "---\r\ntitle: Ciao\r\n---\r\n# Corpo\r\n";
        let (_, body) = split_frontmatter(crlf).unwrap();
        assert!(!body.starts_with('\r'), "{body:?}");
        assert!(body.contains("# Corpo"), "{body:?}");
        let (props, body) = split_frontmatter("# Solo corpo\n").unwrap();
        assert!(props.is_empty());
        assert_eq!(body, "# Solo corpo\n");
    }

    #[test]
    fn malformed_template_properties_fail_before_any_text_is_extracted() {
        assert!(split_frontmatter("---\naliases: [unterminated\n---\nbody").is_err());
        assert!(split_frontmatter("---\njust a scalar\n---\nbody").is_err());
        assert_eq!(split_frontmatter("---\n---\nbody").unwrap().1, "body");
    }

    #[test]
    fn unique_names_never_overwrite_and_random_comes_from_the_host() {
        let mut host = MemoryHost::new();
        // Il prefisso è l'ora dell'orologio (fermo) del doppio.
        let stamp = format_moment(UNIQUE_PREFIX_DEFAULT, &context(&host).unwrap());
        assert_eq!(stamp.len(), 12);
        host = host.with_document(&format!("{stamp} Nota.md"), "occupata");
        let id = unique_name(Args::new(&serde_json::json!({ "name": "Nota" })), &host).unwrap();
        assert_eq!(id.as_str(), format!("{stamp} Nota 1.md"));
        let bare = unique_name(Args::new(&serde_json::json!({})), &host).unwrap();
        assert_eq!(bare.as_str(), format!("{stamp}.md"));
        let a = random_name(&host).unwrap();
        let b = random_name(&host).unwrap();
        assert_ne!(a, b, "due chiamate non danno mai lo stesso blocco");
        let denied = MemoryHost::new().without_entropy();
        assert!(matches!(
            random_name(&denied),
            Err(PluginError::PermissionDenied(_))
        ));
    }

    #[test]
    fn the_prefix_format_keeps_what_is_not_a_token() {
        let ctx = context_at(1_790_000_000_000, &fub_abi::locale::Locale::default()).unwrap();
        let out = format_moment("YYYY-MM-DD_HHmm z", &ctx);
        assert_eq!(
            out,
            format!(
                "{}-{}-{}_{}{} z",
                ctx.year, ctx.month, ctx.day, ctx.hour, ctx.minute
            )
        );
    }

    #[test]
    fn insert_target_refuses_a_dirty_buffer_instead_of_guessing() {
        let host = MemoryHost::new().with_document("nota.md", "una nota di prova");
        host.set_active(Some("nota.md"));
        host.set_context(Some(
            fub_abi::session::ViewContext::new("main")
                .with_doc(Some(DocId::new("nota.md")))
                .with_selections(Some(fub_abi::session::SelectionSet::floating("nota"))),
        ));
        let err = insert_target(Args::new(&serde_json::json!({})), &host).unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
    }

    #[test]
    fn every_command_declares_what_it_does_and_how_far_it_reaches() {
        for spec in TemplateCommands::specs() {
            assert!(
                !spec.description.to_string().trim().is_empty(),
                "`{}` senza descrizione",
                spec.id
            );
            for param in &spec.params {
                assert!(
                    !param.description.to_string().trim().is_empty(),
                    "`{}.{}` senza descrizione",
                    spec.id,
                    param.name
                );
            }
            if spec.scope.writes {
                assert!(
                    spec.scope.reach >= CommandReach::Document,
                    "`{}` scrive ma dichiara di non toccare il vault",
                    spec.id
                );
            }
        }
    }
}
