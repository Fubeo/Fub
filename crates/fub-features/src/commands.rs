//! I comandi ufficiali come `CommandProvider`: il dogfooding del registro
//! (decisione 0009) e della sua descrizione a una macchina (decisione 0010).
//!
//! Tre comandi, scelti perché insieme esercitano tutto ciò che la firma promette
//! e niente che non esista ancora:
//!
//! - `search.open` — nessuna scrittura, un parametro obbligatorio, un effetto
//!   che la shell deve eseguire. È l'azione «apri la ricerca» che finora era
//!   cablata nel frontend: adesso la dichiara il kernel e la palette la trova da
//!   sola.
//! - `selection.wikilink` — il comando che vive nel **contesto di sessione**
//!   (decisione 0007) e scrive con la **modifica chirurgica** (decisione 0008): trasforma il testo
//!   selezionato in un wikilink. È la prova che le tre firme si compongono, e
//!   che la regola dello span della decisione 0007 ha un cliente che ne dipende davvero —
//!   senza span non c'è nessun punto in cui scrivere, e il comando lo dice
//!   invece di indovinare.
//! - `vault.replace` — la sostituzione su N note: parametri di quattro specie,
//!   un piano che si guarda prima di applicarlo, e un raggio dichiarato che dice
//!   a chi invoca di chiedere conferma. È il caso di 7.2 (bulk fix con dry-run) e
//!   la forma che 22.4 chiede per ogni operazione in blocco.
//!
//! Dalla decisione 0013 ci sono anche i **comandi strutturali** — creare, rinominare,
//! cestinare, il giro del cestino — che fino al giro scorso restavano cablati
//! nella shell perché l'`HostApi` non aveva le capacità per farli. Adesso le
//! ha, e questi comandi le usano **dal di fuori**, esattamente come le userebbe
//! un plugin: è il dogfooding che il registro non aveva ancora potuto fare, ed
//! è ciò che ha permesso di togliere sei comandi Tauri dalla shell (§16.6: una
//! feature nuova non deve poter aggiungere un comando Tauri — regola che
//! finché quei sei erano lì valeva solo per le feature che non toccano il
//! vault).
//!
//! E c'è `vault.archive`, che non fa niente di suo: invoca `note.rename` una
//! volta per nota. È il cliente di `run_command`, e serve a provare le tre cose
//! che quella capacità decide — il modo che viaggia con l'host (simulare la
//! macro simula i passi, e il piano che ne esce è l'unione dei loro), l'attore
//! che non si riazzera, e il lotto che non si moltiplica.
//!
//! # Cosa NON c'è qui, e perché
//!
//! Non c'è un comando che **legge** il cestino: `VaultRead::list_trash` è una
//! capacità, ma un elenco non è l'esito di un comando (`CommandOutcome` porta
//! un messaggio e un effetto, non dati). Chi deve mostrare il cestino lo legge
//! dal canale di lettura — la shell dal suo IPC, una view da `list_trash`.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo, UndoStep,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{Block, DocId, DocumentModel, Span, TaskMarker};
use fub_abi::settings::{SettingEntry, SettingKind, SettingSource, SettingValue};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{BacklinkRef, CommandProvider, HostApi, IndexQuery, IndexResult};

/// Id del provider: lo spazio dati e la registrazione, come per le view.
pub const COMMANDS_ID: &str = "fub.commands";

/// Cerca nel vault.
pub const SEARCH_OPEN: &str = "search.open";
/// Trasforma la selezione in un wikilink.
pub const SELECTION_WIKILINK: &str = "selection.wikilink";
/// Sostituisci in tutte le note.
pub const VAULT_REPLACE: &str = "vault.replace";
/// Crea una nota.
pub const NOTE_CREATE: &str = "note.create";
/// Rinomina/sposta una nota (e i wikilink che la nominano).
pub const NOTE_RENAME: &str = "note.rename";
/// Sposta una nota nel cestino.
pub const NOTE_TRASH: &str = "note.trash";
/// Ripristina una voce del cestino.
pub const TRASH_RESTORE: &str = "trash.restore";
/// Svuota il cestino.
pub const TRASH_EMPTY: &str = "trash.empty";
/// Sposta N note in una cartella, un `note.rename` alla volta.
pub const VAULT_ARCHIVE: &str = "vault.archive";
/// Spunta (o de-spunta) un task.
pub const NOTE_TASK_TOGGLE: &str = "note.task.toggle";
/// Cambia un'impostazione (§11.1).
pub const SETTINGS_SET: &str = "settings.set";
/// Riporta un'impostazione a ciò che valeva prima che qualcuno decidesse.
pub const SETTINGS_RESET: &str = "settings.reset";
/// Tira fuori la configurazione decisa, in JSON.
pub const SETTINGS_EXPORT: &str = "settings.export";
/// Rimette dentro una configurazione esportata.
pub const SETTINGS_IMPORT: &str = "settings.import";
/// Annulla l'ultima operazione annullabile (§13.3).
pub const VAULT_UNDO: &str = "vault.undo";

/// Il `ns` con cui l'esito di `settings.export` arriva alla shell.
pub const SETTINGS_NS: &str = "settings.export";

/// Il nome di una nota senza nome, e l'estensione che le si dà.
///
/// Vivono qui e non nel contratto perché *qual è il formato predefinito* è una
/// domanda del registro dei formati, che è del kernel e non è (ancora) una
/// capacità: finché non lo è, questo comando dichiara la propria convenzione
/// invece di indovinare quella di qualcun altro. Chi vuole un'altra estensione
/// la scrive nel nome.
const SENZA_TITOLO: &str = "Senza titolo";
const ESTENSIONE_PREDEFINITA: &str = "md";

/// Un comando del core, col titolo e la descrizione presi dal catalogo.
///
/// Le chiavi si **derivano dall'id** — `vault.replace` diventa
/// `vault.replace.title` e `vault.replace.desc` —, e non è pigrizia: era
/// l'alternativa a ottantadue costanti, una per ogni pezzo di prosa di
/// quindici comandi e ventisei parametri, e ottantadue costanti usate una
/// volta sola sono un secondo elenco da tenere allineato al primo. L'id di un
/// comando è già identità stabile per contratto — «cambiarla rompe scorciatoie,
/// macro e automazioni che la nominano» —, quindi derivarne le chiavi non
/// aggiunge nessuna fragilità che non ci fosse.
///
/// Ciò che una chiave derivata perde è il compilatore: una chiave sbagliata non
/// è più un errore di compilazione, è una stringa che scende alla chiave nuda.
/// Al suo posto c'è un presidio che vale di più, perché copre anche le chiavi
/// costanti — `ogni_chiave_dichiarata_ha_una_voce`, in fondo a questo file:
/// cammina sulle spec vere e pretende che ogni chiave che producono abbia una
/// voce in **tutte** le lingue del catalogo.
fn comando(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

/// Un parametro, con le chiavi derivate da comando e nome.
fn parametro(comando: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{comando}.{name}.title")), kind)
        .describing(Text::key(format!("{comando}.{name}.desc")))
}

/// Un messaggio con un argomento solo: la forma di due terzi delle righe che
/// un comando scrive.
fn uno(key: &str, name: &str, value: &str) -> Text {
    Text::message(key, vec![Arg::text(name, value)])
}

/// Un messaggio su due documenti: da chi a chi.
fn due(key: &str, doc: &str, to: &str) -> Text {
    Text::message(key, vec![Arg::text(A_DOC, doc), Arg::text(A_TO, to)])
}

/// Un messaggio con un conteggio solo.
fn conto(key: &str, n: usize) -> Text {
    Text::message(key, vec![Arg::int(A_COUNT, n as i64)])
}

/// Un messaggio con due conteggi.
fn conto2(key: &str, a: &str, na: usize, b: &str, nb: usize) -> Text {
    Text::message(key, vec![Arg::int(a, na as i64), Arg::int(b, nb as i64)])
}

/// Il messaggio dell'archiviazione: quante note, in che cartella, e — se ce ne
/// sono — quelle rimaste indietro.
fn archivio(key: &str, n: usize, folder: &str, falliti: Option<String>) -> Text {
    let mut args = vec![Arg::int(A_COUNT, n as i64), Arg::text(A_FOLDER, folder)];
    if let Some(f) = falliti {
        args.push(Arg::text(A_FAILED, f));
    }
    Text::message(key, args)
}

/// Le chiavi delle righe che i comandi scrivono **mentre girano**: gli errori,
/// i riassunti di un piano, e ciò che si dice quando è andata.
///
/// Queste sono costanti e le chiavi delle spec no, e la differenza non è di
/// gusto: una chiave di spec la produce `comando()` a partire dall'id, e chi la
/// legge ha l'id davanti; queste invece stanno sparse in millecinquecento righe
/// di comandi, e scritte a mano si sarebbero scritte diverse due volte.
///
/// I prefissi dicono **quando** si leggono, ed è l'unica cosa che serve sapere
/// per tradurle: `E_` mentre qualcosa non si può fare, `Y_` in simulazione
/// (*se* lo facessi), `P_` nel riassunto di un piano, `D_` a cose fatte.
const E_NO_ACTIVE_PANE: &str = "err.no_active_pane";
const E_NO_OPEN_NOTE: &str = "err.no_open_note";
const E_NOTHING_SELECTED: &str = "err.nothing_selected";
const E_EMPTY_SELECTION: &str = "err.empty_selection";
const E_DIRTY_SELECTION: &str = "err.dirty_selection";
const E_SELECTION_OUTSIDE: &str = "err.selection_outside";
const E_SELECTION_HAS_LINK: &str = "err.selection_has_link";
const E_EMPTY_FIND: &str = "err.empty_find";
const E_EMPTY_TO: &str = "err.empty_to";
const E_NO_NOTE_GIVEN: &str = "err.no_note_given";
const E_NOT_IN_TRASH: &str = "err.not_in_trash";
const E_TASK_NO_NOTE: &str = "err.task_no_note";
const E_TASK_NO_POSITION: &str = "err.task_no_position";
const E_TASK_WRONG_PANE: &str = "err.task_wrong_pane";
const E_TASK_NO_CARET: &str = "err.task_no_caret";
const E_TASK_DIRTY_BUFFER: &str = "err.task_dirty_buffer";
const E_TASK_NOT_FOUND: &str = "err.task_not_found";
const E_NOT_A_TOGGLE: &str = "err.not_a_toggle";
const E_NOT_A_NUMBER: &str = "err.not_a_number";
const E_UNDECLARED_KEY: &str = "err.undeclared_key";
const E_NOT_PROGRAM_WRITABLE: &str = "err.not_program_writable";
const E_NOT_JSON: &str = "err.not_json";
const E_NOT_AN_OBJECT: &str = "err.not_an_object";

const P_WIKILINK: &str = "plan.wikilink";
const P_WIKILINK_MANY: &str = "plan.wikilink.many";
const P_REPLACE: &str = "plan.replace";
const P_CREATE: &str = "plan.create";
const P_RENAME: &str = "plan.rename";
const P_TRASH: &str = "plan.trash";
const P_RESTORE: &str = "plan.restore";
const P_EMPTY_TRASH: &str = "plan.empty_trash";
const P_ARCHIVE: &str = "plan.archive";
const P_TASK_DONE: &str = "plan.task_done";
const P_TASK_TODO: &str = "plan.task_todo";
const P_SETTINGS_SET: &str = "plan.settings_set";
const P_SETTINGS_RESET: &str = "plan.settings_reset";
const P_SETTINGS_IMPORT: &str = "plan.settings_import";

const Y_SETTINGS_SET: &str = "dry.settings_set";
const Y_SETTINGS_RESET: &str = "dry.settings_reset";

const D_WIKILINK: &str = "done.wikilink";
const D_WIKILINK_MANY: &str = "done.wikilink.many";
const D_REPLACE: &str = "done.replace";
const D_REPLACE_PARTIAL: &str = "done.replace_partial";
const D_CREATE: &str = "done.create";
const D_RENAME: &str = "done.rename";
const D_TRASH: &str = "done.trash";
const D_RESTORE: &str = "done.restore";
const D_EMPTY_TRASH: &str = "done.empty_trash";
const D_ARCHIVE: &str = "done.archive";
const D_ARCHIVE_PARTIAL: &str = "done.archive_partial";
const D_SETTINGS_SET: &str = "done.settings_set";
const D_SETTINGS_RESET: &str = "done.settings_reset";
const D_SETTINGS_EXPORT: &str = "done.settings_export";
const D_SETTINGS_IMPORT: &str = "done.settings_import";
const D_SETTINGS_IMPORT_PARTIAL: &str = "done.settings_import_partial";
const D_UNDONE: &str = "done.undone";
/// Annullato per intero, ma **l'operazione era già a metà** (§23.14): non è un
/// guasto di adesso, è la notizia che il giorno in cui è stata fatta non tutto
/// era riuscito — e quindi non tutto torna indietro.
const D_UNDONE_OF_PARTIAL: &str = "done.undone_of_partial";
/// L'annullamento **stesso** si è fermato a un passo, e i passi dopo non sono
/// stati provati.
const D_UNDONE_PARTIAL: &str = "done.undone_partial";
const D_NOTHING_TO_UNDO: &str = "done.nothing_to_undo";
const P_UNDO: &str = "plan.undo";

/// Le etichette dell'annullamento: cosa si disferebbe, non cosa è successo.
const U_WIKILINK: &str = "undo.wikilink";
const U_WIKILINK_MANY: &str = "undo.wikilink.many";
const U_REPLACE: &str = "undo.replace";
const U_CREATE: &str = "undo.create";
const U_RENAME: &str = "undo.rename";
const U_TRASH: &str = "undo.trash";
const U_RESTORE: &str = "undo.restore";
const U_ARCHIVE: &str = "undo.archive";
const U_TASK: &str = "undo.task";

/// I nomi degli argomenti.
const A_DOC: &str = "doc";
const A_TO: &str = "to";
const A_TEXT: &str = "text";
const A_ENTRY: &str = "entry";
const A_KEY: &str = "key";
const A_VALUE: &str = "value";
const A_FROM: &str = "from";
const A_REASON: &str = "reason";
const A_REASONS: &str = "reasons";
const A_COUNT: &str = "count";
const A_SKIPPED: &str = "skipped";
const A_OCCURRENCES: &str = "occurrences";
const A_NOTES: &str = "notes";
const A_FAILED: &str = "failed";
const A_FOLDER: &str = "folder";
const A_AT: &str = "at";
const A_WHAT: &str = "what";
/// I due conti di un esito parziale (§23.14): quante cose c'erano davanti e
/// quante sono cambiate. Stanno insieme perché una da sola non si legge —
/// «undici» non dice niente finché non c'è «su dodici».
const A_ATTEMPTED: &str = "attempted";
const A_DONE: &str = "done";

/// Le stringhe dei comandi: quindici titoli, quindici descrizioni,
/// ventisei etichette di parametro e le righe che un comando scrive quando ha
/// finito.
///
/// È il catalogo più grande del repo, ed è anche quello che si vede di più: la
/// palette è **la** superficie in cui un utente legge prosa scritta da un
/// componente, e finché queste righe erano `&str` dentro le spec, la palette
/// era italiana per chiunque — compreso chi aveva scelto `en` nelle
/// impostazioni e vedeva già il resto in inglese.
pub fn catalog() -> Vec<StringCatalog> {
    vec![catalogo_it(), catalogo_en()]
}

fn catalogo_it() -> StringCatalog {
    StringCatalog::new("it")
        .with("search.open.title", "Cerca nel vault")
        .with(
            "search.open.desc",
            "Esegue una ricerca full-text sul vault e mostra i risultati. \
             Non modifica niente.",
        )
        .with("search.open.query.title", "Cerca")
        .with(
            "search.open.query.desc",
            "La query, nella stessa sintassi della barra di ricerca \
             (`tags:nome` filtra per tag).",
        )
        .with(
            "selection.wikilink.title",
            "Trasforma la selezione in wikilink",
        )
        .with(
            "selection.wikilink.desc",
            "Avvolge il testo selezionato nel pannello attivo fra doppie \
             quadre, creando un riferimento a una nota con quel nome. \
             Richiede una selezione e un buffer salvato.",
        )
        .with("vault.replace.title", "Sostituisci in tutte le note")
        .with(
            "vault.replace.desc",
            "Sostituisce ogni occorrenza di un testo con un altro, in tutte \
             le note del vault o solo in quelle indicate. Simulandolo si \
             ottiene l'elenco delle note impattate e le modifiche esatte, \
             senza scrivere niente.",
        )
        .with("vault.replace.find.title", "Cerca")
        .with(
            "vault.replace.find.desc",
            "Il testo da sostituire. Non può essere vuoto.",
        )
        .with("vault.replace.replace.title", "Sostituisci con")
        .with(
            "vault.replace.replace.desc",
            "Il testo nuovo. Vuoto cancella le occorrenze.",
        )
        .with("vault.replace.whole_word.title", "Solo parole intere")
        .with(
            "vault.replace.whole_word.desc",
            "Se vero, sostituisce solo le occorrenze che non sono parte di una \
             parola più lunga. Default: falso.",
        )
        .with("vault.replace.docs.title", "Solo in queste note")
        .with(
            "vault.replace.docs.desc",
            "Gli id delle note su cui operare. Assente = tutto il vault; \
             elenco vuoto = nessuna nota.",
        )
        .with("note.create.title", "Nuova nota")
        .with(
            "note.create.desc",
            "Crea una nota vuota e la apre. Senza nome nasce «Senza titolo», e \
             se quel nome è preso «Senza titolo 1», «2», … Un nome senza \
             estensione diventa una nota markdown.",
        )
        .with("note.create.name.title", "Nome")
        .with(
            "note.create.name.desc",
            "Il nome o il path della nota, estensione compresa se diversa da \
             `.md`. Assente = «Senza titolo».",
        )
        .with("note.rename.title", "Rinomina nota")
        .with(
            "note.rename.desc",
            "Rinomina o sposta una nota e riscrive i wikilink entranti che la \
             nominavano, così i riferimenti non si rompono. I link per alias \
             non vengono toccati.",
        )
        .with("note.rename.doc.title", "Nota")
        .with("note.rename.doc.desc", "La nota da rinominare.")
        .with("note.rename.to.title", "Nuovo path")
        .with(
            "note.rename.to.desc",
            "Il path nuovo, estensione compresa. Cambiare la cartella sposta \
             la nota.",
        )
        .with("note.trash.title", "Sposta nel cestino")
        .with(
            "note.trash.desc",
            "Sposta una nota nel cestino del vault. La nota esce dagli indici \
             ma non è distrutta: si recupera con «Ripristina dal cestino».",
        )
        .with("note.trash.doc.title", "Nota")
        .with(
            "note.trash.doc.desc",
            "La nota da cestinare. Assente = quella aperta.",
        )
        .with("trash.restore.title", "Ripristina dal cestino")
        .with(
            "trash.restore.desc",
            "Riporta nel vault una voce del cestino. Se il path d'origine è di \
             nuovo occupato serve un nome nuovo: senza, il ripristino è \
             rifiutato invece di sovrascrivere.",
        )
        .with("trash.restore.entry.title", "Voce del cestino")
        .with(
            "trash.restore.entry.desc",
            "L'id della voce nel cestino (`.trash/…`).",
        )
        .with("trash.restore.to.title", "Ripristina come")
        .with(
            "trash.restore.to.desc",
            "Path alternativo. Assente = il path d'origine.",
        )
        .with("trash.empty.title", "Svuota il cestino")
        .with(
            "trash.empty.desc",
            "Cancella definitivamente tutte le voci del cestino. Da qui non si \
             torna indietro.",
        )
        .with("vault.archive.title", "Archivia le note")
        .with(
            "vault.archive.desc",
            "Sposta le note indicate in una cartella, una rinomina alla volta: \
             i wikilink che le nominano vengono riscritti come per una rinomina \
             singola. Simulandolo si ottiene l'elenco di dove finirebbe ciascuna.",
        )
        .with("vault.archive.docs.title", "Note da archiviare")
        .with("vault.archive.docs.desc", "Gli id delle note da spostare.")
        .with("vault.archive.folder.title", "Cartella")
        .with(
            "vault.archive.folder.desc",
            "Dove spostarle. Assente = «Archivio».",
        )
        .with("note.task.toggle.title", "Spunta il task")
        .with(
            "note.task.toggle.desc",
            "Spunta o de-spunta la voce di task che si trova in una posizione \
             del documento: `[ ]` diventa `[x]` e ogni altro stato torna `[ ]`. \
             Senza argomenti agisce sul task sotto il cursore del pannello \
             attivo. Scrive un carattere solo.",
        )
        .with("note.task.toggle.doc.title", "Nota")
        .with(
            "note.task.toggle.doc.desc",
            "La nota su cui agire. Assente = quella del pannello attivo.",
        )
        .with("note.task.toggle.at.title", "Posizione")
        .with(
            "note.task.toggle.at.desc",
            "Posizione in byte dentro il documento: si spunta il task che la \
             contiene, il più interno se sono annidati. Assente = il cursore \
             del pannello attivo.",
        )
        .with("settings.set.title", "Cambia un'impostazione")
        .with(
            "settings.set.desc",
            "Scrive il valore di una chiave dichiarata, nel livello che la \
             chiave dichiara (il vault o la macchina). Solo le chiavi che si \
             sono dichiarate scrivibili da un programma: le altre le cambia chi \
             le sta guardando, dal pannello.",
        )
        .with("settings.set.key.title", "Chiave")
        .with(
            "settings.set.key.desc",
            "La chiave, es. `versioning.enabled`.",
        )
        .with("settings.set.value.title", "Valore")
        .with(
            "settings.set.value.desc",
            "Il valore, letto secondo la specie dichiarata dalla chiave: \
             `true`/`false` per un interruttore, un numero, il testo, o valori \
             separati da virgola per un elenco.",
        )
        .with("settings.reset.title", "Azzera un'impostazione")
        .with(
            "settings.reset.desc",
            "Dimentica ciò che era stato deciso per una chiave: torna a valere \
             il livello sotto, che è il default solo se non c'era niente in mezzo.",
        )
        .with("settings.reset.key.title", "Chiave")
        .with("settings.reset.key.desc", "La chiave da azzerare.")
        .with("settings.export.title", "Esporta le impostazioni")
        .with(
            "settings.export.desc",
            "Restituisce in JSON le impostazioni **decise** — non i default, che \
             non sono una scelta di nessuno. Non scrive un file: dove salvarlo \
             lo sa chi ha il dialogo di sistema, e un comando del registro non \
             ha (e non deve avere) accesso al filesystem fuori dal vault.",
        )
        .with("settings.import.title", "Importa le impostazioni")
        .with(
            "settings.import.desc",
            "Applica una configurazione esportata. Ciò che non si può applicare \
             — una chiave che nessuno dichiara, un valore fuori specie, una \
             chiave non scrivibile da un programma — viene **contato e detto**, \
             non applicato a metà in silenzio.",
        )
        .with("settings.import.json.title", "Configurazione")
        .with(
            "settings.import.json.desc",
            "L'oggetto JSON `{{\"chiave\": valore}}`.",
        )
        .with(E_NO_ACTIVE_PANE, "Nessun pannello attivo.")
        .with(E_NO_OPEN_NOTE, "Nessuna nota aperta nel pannello attivo.")
        .with(E_NOTHING_SELECTED, "Niente di selezionato.")
        .with(
            E_EMPTY_SELECTION,
            "La selezione è vuota: non c'è testo da trasformare.",
        )
        .with(
            E_DIRTY_SELECTION,
            "Il buffer ha modifiche non salvate: salva prima di trasformare la selezione.",
        )
        .with(
            E_SELECTION_OUTSIDE,
            "La selezione non sta dentro il documento.",
        )
        .with(
            E_SELECTION_HAS_LINK,
            "La selezione contiene già un riferimento.",
        )
        .with(
            E_EMPTY_FIND,
            "`find` non può essere vuoto: sostituirebbe il nulla ovunque.",
        )
        .with(E_EMPTY_TO, "`to` non può essere vuoto.")
        .with(
            E_NO_NOTE_GIVEN,
            "Nessuna nota indicata e nessuna nota aperta nel pannello attivo.",
        )
        .with(E_NOT_IN_TRASH, "`{entry}` non è nel cestino.")
        .with(
            E_TASK_NO_NOTE,
            "Nessuna nota: né in `doc`, né nel pannello attivo.",
        )
        .with(
            E_TASK_NO_POSITION,
            "Nessuna posizione in `at`, e nessun pannello attivo da cui prenderla.",
        )
        .with(
            E_TASK_WRONG_PANE,
            "`at` non c'è e il cursore non è in {doc}: dire su quale nota agire \
             senza dire dove non basta.",
        )
        .with(E_TASK_NO_CARET, "Nessun cursore nel pannello attivo.")
        .with(
            E_TASK_DIRTY_BUFFER,
            "Il buffer ha modifiche non salvate: salva prima di spuntare, o dì la \
             posizione in `at`.",
        )
        .with(
            E_TASK_NOT_FOUND,
            "Nessuna voce di task alla posizione {at} di {doc}.",
        )
        .with(
            E_NOT_A_TOGGLE,
            "`{value}` non è un interruttore (`true` o `false`).",
        )
        .with(E_NOT_A_NUMBER, "`{value}` non è un numero.")
        .with(
            E_UNDECLARED_KEY,
            "Nessuno ha dichiarato l'impostazione `{key}`.",
        )
        .with(
            E_NOT_PROGRAM_WRITABLE,
            "`{key}` non è scrivibile da un programma: la cambia l'utente.",
        )
        .with(E_NOT_JSON, "Non è un JSON valido: {reason}")
        .with(
            E_NOT_AN_OBJECT,
            "Atteso un oggetto `{{\"chiave\": valore}}`.",
        )
        .with(P_WIKILINK, "«{text}» diventa un riferimento in {doc}")
        .with(
            P_WIKILINK_MANY,
            "{count} selezioni diventano riferimenti in {doc}",
        )
        .with(P_REPLACE, "Sostituzioni: {occurrences} · Note: {notes}")
        .with(P_CREATE, "Crea «{doc}»")
        .with(P_RENAME, "«{doc}» diventa «{to}»")
        .with(P_TRASH, "«{doc}» va nel cestino")
        .with(P_RESTORE, "«{entry}» torna come «{doc}»")
        .with(P_EMPTY_TRASH, "Voci da cancellare per sempre: {count}")
        .with(P_ARCHIVE, "Note da archiviare in «{folder}»: {count}")
        .with(P_TASK_DONE, "Task spuntata in {doc}")
        .with(P_TASK_TODO, "Task da fare in {doc}")
        .with(P_SETTINGS_SET, "Cambia `{key}`")
        .with(P_SETTINGS_RESET, "Azzera `{key}`")
        .with(P_SETTINGS_IMPORT, "Impostazioni da applicare: {count}")
        .with(Y_SETTINGS_SET, "`{key}` passerebbe da {from} a {value}")
        .with(
            Y_SETTINGS_RESET,
            "`{key}` smetterebbe di valere {value} per decisione di qualcuno",
        )
        .with(D_WIKILINK, "Creato il riferimento a «{text}»")
        .with(D_WIKILINK_MANY, "Creati {count} riferimenti")
        .with(
            D_REPLACE,
            "Sostituzioni: {occurrences} · Note aggiornate: {notes}",
        )
        .with(
            D_REPLACE_PARTIAL,
            "Sostituzioni: {occurrences} · Note aggiornate: {notes} · Non \
             modificate: {failed}",
        )
        .with(D_CREATE, "Creata «{doc}»")
        .with(D_RENAME, "«{doc}» rinominata in «{to}»")
        .with(D_TRASH, "«{doc}» spostata nel cestino")
        .with(D_RESTORE, "Ripristinata «{doc}»")
        .with(
            D_EMPTY_TRASH,
            "Cestino svuotato · Voci cancellate per sempre: {count}",
        )
        .with(D_ARCHIVE, "Note archiviate in «{folder}»: {count}")
        .with(
            D_ARCHIVE_PARTIAL,
            "Note archiviate in «{folder}»: {count} · Non spostate: {failed}",
        )
        .with(D_SETTINGS_SET, "`{key}` adesso vale {value}")
        .with(D_SETTINGS_RESET, "`{key}` è tornata al valore di prima")
        .with(D_SETTINGS_EXPORT, "Impostazioni da salvare: {count}")
        .with(D_SETTINGS_IMPORT, "Impostazioni applicate: {count}")
        .with(
            D_SETTINGS_IMPORT_PARTIAL,
            "Impostazioni applicate: {count} · Saltate: {skipped} ({reasons})",
        )
        // --- l'annullamento (§13.3) ---------------------------------------
        //
        // Le etichette `undo.*` dicono **cosa si disferebbe**, non cosa è
        // successo: sono la frase che si legge in un menu, mesi dopo, e per
        // questo cominciano dal verbo di ciò che tornerebbe indietro.
        .with("vault.undo.title", "Annulla l'ultima operazione")
        .with(
            "vault.undo.desc",
            "Disfa l'ultima operazione annullabile fatta in questo vault: una \
             rinomina, una nota cestinata, una sostituzione. Non è l'annulla \
             dell'editor, che riguarda il testo che stai scrivendo e risponde a \
             Ctrl-Z.",
        )
        .with(P_UNDO, "Disferebbe l'ultima operazione annullabile")
        .with(D_UNDONE, "Annullato: {what}")
        .with(
            D_UNDONE_OF_PARTIAL,
            "Annullato: {what} — ma quell'operazione era già riuscita a metà \
             ({done} su {attempted}), quindi torna indietro solo quella parte.",
        )
        .with(
            D_UNDONE_PARTIAL,
            "Annullato a metà: {what} · Passi tornati indietro: {done} su \
             {attempted} · Fermato da: {failed}",
        )
        .with(D_NOTHING_TO_UNDO, "Niente da annullare")
        .with(U_WIKILINK, "il riferimento a «{text}»")
        .with(U_WIKILINK_MANY, "i {count} riferimenti")
        .with(
            U_REPLACE,
            "le sostituzioni · Occorrenze: {occurrences} · Note: {notes}",
        )
        .with(U_CREATE, "la creazione di «{doc}»")
        .with(U_RENAME, "la rinomina di «{doc}» in «{to}»")
        .with(U_TRASH, "«{doc}» nel cestino")
        .with(U_RESTORE, "il ripristino di «{doc}»")
        .with(U_ARCHIVE, "l'archiviazione in «{folder}» · Note: {count}")
        .with(U_TASK, "la task spuntata in {doc}")
}

fn catalogo_en() -> StringCatalog {
    StringCatalog::new("en")
        .with("search.open.title", "Search the vault")
        .with(
            "search.open.desc",
            "Runs a full-text search over the vault and shows the results. \
             Changes nothing.",
        )
        .with("search.open.query.title", "Search")
        .with(
            "search.open.query.desc",
            "The query, in the same syntax as the search bar (`tags:name` \
             filters by tag).",
        )
        .with(
            "selection.wikilink.title",
            "Turn the selection into a wikilink",
        )
        .with(
            "selection.wikilink.desc",
            "Wraps the text selected in the active pane in double brackets, \
             creating a reference to a note with that name. Needs a selection \
             and a saved buffer.",
        )
        .with("vault.replace.title", "Replace across all notes")
        .with(
            "vault.replace.desc",
            "Replaces every occurrence of a text with another one, in all the \
             notes of the vault or only in the ones given. Simulating it gives \
             the list of affected notes and the exact changes, writing nothing.",
        )
        .with("vault.replace.find.title", "Find")
        .with(
            "vault.replace.find.desc",
            "The text to replace. Cannot be empty.",
        )
        .with("vault.replace.replace.title", "Replace with")
        .with(
            "vault.replace.replace.desc",
            "The new text. Empty deletes the occurrences.",
        )
        .with("vault.replace.whole_word.title", "Whole words only")
        .with(
            "vault.replace.whole_word.desc",
            "If true, replaces only the occurrences that are not part of a \
             longer word. Default: false.",
        )
        .with("vault.replace.docs.title", "Only in these notes")
        .with(
            "vault.replace.docs.desc",
            "The ids of the notes to work on. Absent = the whole vault; empty \
             list = no note.",
        )
        .with("note.create.title", "New note")
        .with(
            "note.create.desc",
            "Creates an empty note and opens it. With no name it is born \
             «Untitled», and if that name is taken «Untitled 1», «2», … A name \
             without extension becomes a markdown note.",
        )
        .with("note.create.name.title", "Name")
        .with(
            "note.create.name.desc",
            "The name or the path of the note, extension included if it is not \
             `.md`. Absent = «Untitled».",
        )
        .with("note.rename.title", "Rename note")
        .with(
            "note.rename.desc",
            "Renames or moves a note and rewrites the incoming wikilinks that \
             named it, so the references do not break. Links by alias are left \
             alone.",
        )
        .with("note.rename.doc.title", "Note")
        .with("note.rename.doc.desc", "The note to rename.")
        .with("note.rename.to.title", "New path")
        .with(
            "note.rename.to.desc",
            "The new path, extension included. Changing the folder moves the note.",
        )
        .with("note.trash.title", "Move to trash")
        .with(
            "note.trash.desc",
            "Moves a note to the vault trash. The note leaves the indexes but \
             is not destroyed: you get it back with «Restore from trash».",
        )
        .with("note.trash.doc.title", "Note")
        .with(
            "note.trash.doc.desc",
            "The note to trash. Absent = the open one.",
        )
        .with("trash.restore.title", "Restore from trash")
        .with(
            "trash.restore.desc",
            "Brings a trash entry back into the vault. If the original path is \
             taken again a new name is needed: without one, the restore is \
             refused instead of overwriting.",
        )
        .with("trash.restore.entry.title", "Trash entry")
        .with(
            "trash.restore.entry.desc",
            "The id of the entry in the trash (`.trash/…`).",
        )
        .with("trash.restore.to.title", "Restore as")
        .with(
            "trash.restore.to.desc",
            "Alternative path. Absent = the original path.",
        )
        .with("trash.empty.title", "Empty the trash")
        .with(
            "trash.empty.desc",
            "Deletes every trash entry for good. There is no way back from here.",
        )
        .with("vault.archive.title", "Archive the notes")
        .with(
            "vault.archive.desc",
            "Moves the given notes into a folder, one rename at a time: the \
             wikilinks that name them are rewritten as for a single rename. \
             Simulating it gives the list of where each one would end up.",
        )
        .with("vault.archive.docs.title", "Notes to archive")
        .with("vault.archive.docs.desc", "The ids of the notes to move.")
        .with("vault.archive.folder.title", "Folder")
        .with(
            "vault.archive.folder.desc",
            "Where to move them. Absent = «Archive».",
        )
        .with("note.task.toggle.title", "Toggle the task")
        .with(
            "note.task.toggle.desc",
            "Ticks or unticks the task item found at a position in the \
             document: `[ ]` becomes `[x]` and every other state goes back to \
             `[ ]`. With no arguments it works on the task under the cursor of \
             the active pane. It writes a single character.",
        )
        .with("note.task.toggle.doc.title", "Note")
        .with(
            "note.task.toggle.doc.desc",
            "The note to work on. Absent = the one of the active pane.",
        )
        .with("note.task.toggle.at.title", "Position")
        .with(
            "note.task.toggle.at.desc",
            "Position in bytes inside the document: the task containing it is \
             ticked, the innermost one if they are nested. Absent = the cursor \
             of the active pane.",
        )
        .with("settings.set.title", "Change a setting")
        .with(
            "settings.set.desc",
            "Writes the value of a declared key, at the level the key declares \
             (the vault or the machine). Only the keys that declared themselves \
             writable by a program: the others are changed by whoever is \
             looking at them, from the panel.",
        )
        .with("settings.set.key.title", "Key")
        .with(
            "settings.set.key.desc",
            "The key, e.g. `versioning.enabled`.",
        )
        .with("settings.set.value.title", "Value")
        .with(
            "settings.set.value.desc",
            "The value, read according to the kind the key declares: \
             `true`/`false` for a toggle, a number, the text, or comma-separated \
             values for a list.",
        )
        .with("settings.reset.title", "Reset a setting")
        .with(
            "settings.reset.desc",
            "Forgets what had been decided for a key: the level below applies \
             again, which is the default only if there was nothing in between.",
        )
        .with("settings.reset.key.title", "Key")
        .with("settings.reset.key.desc", "The key to reset.")
        .with("settings.export.title", "Export the settings")
        .with(
            "settings.export.desc",
            "Returns the **decided** settings as JSON — not the defaults, which \
             are nobody's choice. It does not write a file: where to save it is \
             known by whoever has the system dialog, and a command of the \
             registry does not have (and must not have) access to the \
             filesystem outside the vault.",
        )
        .with("settings.import.title", "Import the settings")
        .with(
            "settings.import.desc",
            "Applies an exported configuration. What cannot be applied — a key \
             nobody declares, a value of the wrong kind, a key not writable by \
             a program — is **counted and told**, not half-applied in silence.",
        )
        .with("settings.import.json.title", "Configuration")
        .with(
            "settings.import.json.desc",
            "The JSON object `{{\"key\": value}}`.",
        )
        .with(E_NO_ACTIVE_PANE, "No active pane.")
        .with(E_NO_OPEN_NOTE, "No note open in the active pane.")
        .with(E_NOTHING_SELECTED, "Nothing selected.")
        .with(
            E_EMPTY_SELECTION,
            "The selection is empty: there is no text to transform.",
        )
        .with(
            E_DIRTY_SELECTION,
            "The buffer has unsaved changes: save before transforming the selection.",
        )
        .with(
            E_SELECTION_OUTSIDE,
            "The selection is not inside the document.",
        )
        .with(
            E_SELECTION_HAS_LINK,
            "The selection already contains a reference.",
        )
        .with(
            E_EMPTY_FIND,
            "`find` cannot be empty: it would replace nothing everywhere.",
        )
        .with(E_EMPTY_TO, "`to` cannot be empty.")
        .with(
            E_NO_NOTE_GIVEN,
            "No note given and no note open in the active pane.",
        )
        .with(E_NOT_IN_TRASH, "`{entry}` is not in the trash.")
        .with(
            E_TASK_NO_NOTE,
            "No note: neither in `doc`, nor in the active pane.",
        )
        .with(
            E_TASK_NO_POSITION,
            "No position in `at`, and no active pane to take it from.",
        )
        .with(
            E_TASK_WRONG_PANE,
            "`at` is missing and the cursor is not in {doc}: saying which note to \
             act on without saying where is not enough.",
        )
        .with(E_TASK_NO_CARET, "No cursor in the active pane.")
        .with(
            E_TASK_DIRTY_BUFFER,
            "The buffer has unsaved changes: save before ticking, or say the \
             position in `at`.",
        )
        .with(E_TASK_NOT_FOUND, "No task item at position {at} of {doc}.")
        .with(
            E_NOT_A_TOGGLE,
            "`{value}` is not a toggle (`true` or `false`).",
        )
        .with(E_NOT_A_NUMBER, "`{value}` is not a number.")
        .with(E_UNDECLARED_KEY, "Nobody has declared the setting `{key}`.")
        .with(
            E_NOT_PROGRAM_WRITABLE,
            "`{key}` is not writable by a program: the user changes it.",
        )
        .with(E_NOT_JSON, "Not valid JSON: {reason}")
        .with(E_NOT_AN_OBJECT, "Expected an object `{{\"key\": value}}`.")
        .with(P_WIKILINK, "«{text}» becomes a reference in {doc}")
        .with(
            P_WIKILINK_MANY,
            "{count} selections become references in {doc}",
        )
        .with(P_REPLACE, "Replacements: {occurrences} · Notes: {notes}")
        .with(P_CREATE, "Create «{doc}»")
        .with(P_RENAME, "«{doc}» becomes «{to}»")
        .with(P_TRASH, "«{doc}» goes to the trash")
        .with(P_RESTORE, "«{entry}» comes back as «{doc}»")
        .with(P_EMPTY_TRASH, "Entries to delete for good: {count}")
        .with(P_ARCHIVE, "Notes to archive in «{folder}»: {count}")
        .with(P_TASK_DONE, "Task ticked in {doc}")
        .with(P_TASK_TODO, "Task to do in {doc}")
        .with(P_SETTINGS_SET, "Change `{key}`")
        .with(P_SETTINGS_RESET, "Reset `{key}`")
        .with(P_SETTINGS_IMPORT, "Settings to apply: {count}")
        .with(Y_SETTINGS_SET, "`{key}` would go from {from} to {value}")
        .with(
            Y_SETTINGS_RESET,
            "`{key}` would stop being {value} by someone's decision",
        )
        .with(D_WIKILINK, "Created the reference to «{text}»")
        .with(D_WIKILINK_MANY, "Created {count} references")
        .with(
            D_REPLACE,
            "Replacements: {occurrences} · Notes updated: {notes}",
        )
        .with(
            D_REPLACE_PARTIAL,
            "Replacements: {occurrences} · Notes updated: {notes} · Not changed: {failed}",
        )
        .with(D_CREATE, "Created «{doc}»")
        .with(D_RENAME, "«{doc}» renamed to «{to}»")
        .with(D_TRASH, "«{doc}» moved to the trash")
        .with(D_RESTORE, "Restored «{doc}»")
        .with(
            D_EMPTY_TRASH,
            "Trash emptied · Entries deleted for good: {count}",
        )
        .with(D_ARCHIVE, "Notes archived in «{folder}»: {count}")
        .with(
            D_ARCHIVE_PARTIAL,
            "Notes archived in «{folder}»: {count} · Not moved: {failed}",
        )
        .with(D_SETTINGS_SET, "`{key}` is now {value}")
        .with(D_SETTINGS_RESET, "`{key}` is back to what it was before")
        .with(D_SETTINGS_EXPORT, "Settings to save: {count}")
        .with(D_SETTINGS_IMPORT, "Settings applied: {count}")
        .with(
            D_SETTINGS_IMPORT_PARTIAL,
            "Settings applied: {count} · Skipped: {skipped} ({reasons})",
        )
        .with("vault.undo.title", "Undo the last operation")
        .with(
            "vault.undo.desc",
            "Undoes the last undoable operation in this vault: a rename, a note \
             sent to the trash, a replacement. This is not the editor's undo, \
             which is about the text you are typing and answers to Ctrl-Z.",
        )
        .with(P_UNDO, "Would undo the last undoable operation")
        .with(D_UNDONE, "Undone: {what}")
        .with(
            D_UNDONE_OF_PARTIAL,
            "Undone: {what} — but that operation had only half succeeded \
             ({done} of {attempted}), so only that part comes back.",
        )
        .with(
            D_UNDONE_PARTIAL,
            "Half undone: {what} · Steps rolled back: {done} of {attempted} · \
             Stopped by: {failed}",
        )
        .with(D_NOTHING_TO_UNDO, "Nothing to undo")
        .with(U_WIKILINK, "the reference to “{text}”")
        .with(U_WIKILINK_MANY, "the {count} references")
        .with(
            U_REPLACE,
            "the replacements · Occurrences: {occurrences} · Notes: {notes}",
        )
        .with(U_CREATE, "creating “{doc}”")
        .with(U_RENAME, "renaming “{doc}” to “{to}”")
        .with(U_TRASH, "sending “{doc}” to the trash")
        .with(U_RESTORE, "restoring “{doc}”")
        .with(U_ARCHIVE, "archiving into “{folder}” · Notes: {count}")
        .with(U_TASK, "the task ticked in {doc}")
}

/// I comandi ufficiali. Senza stato: tutto ciò che gli serve lo chiede
/// all'host, come farebbe un plugin.
#[derive(Default)]
pub struct CoreCommands;

impl CoreCommands {
    /// Le spec, anche fuori dal trait: chi disegna una palette nei test le
    /// legge senza montare un workspace.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            // Senza accordo, e non per distrazione: `Mod-Shift-f` è della shell,
            // che con quel tasto porta il pannello della ricerca sotto gli occhi
            // — la cosa che fa Obsidian e che le dita hanno già imparato. Questo
            // comando vuole una `query` **obbligatoria**: premere un tasto per
            // farsi aprire un modulo da compilare è il gesto sbagliato, mentre
            // dalla palette — che i parametri li sa chiedere — è esattamente il
            // gesto giusto. Il perché sta nella 0081.
            comando(SEARCH_OPEN)
                .with_param(parametro(SEARCH_OPEN, "query", ParamKind::Text).required()),
            comando(SELECTION_WIKILINK).with_scope(CommandScope::writing(CommandReach::Document)),
            comando(VAULT_REPLACE)
                .with_param(parametro(VAULT_REPLACE, "find", ParamKind::Text).required())
                .with_param(parametro(VAULT_REPLACE, "replace", ParamKind::Text).required())
                .with_param(parametro(VAULT_REPLACE, "whole_word", ParamKind::Bool))
                .with_param(parametro(VAULT_REPLACE, "docs", ParamKind::Documents))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // --- strutturali (decisione 0013) ---------------------------------------
            comando(NOTE_CREATE)
                .with_param(parametro(NOTE_CREATE, "name", ParamKind::Text))
                // Una nota sola, e il cestino la rende reversibile.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            comando(NOTE_RENAME)
                .with_param(parametro(NOTE_RENAME, "doc", ParamKind::Document).required())
                .with_param(parametro(NOTE_RENAME, "to", ParamKind::Text).required())
                // `Documents` e non `Document`: una rinomina riscrive anche
                // ogni nota che linkava la vecchia. Dichiarare `Document`
                // sarebbe la bugia che il piano del dry-run smaschera.
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            comando(NOTE_TRASH)
                .with_param(parametro(NOTE_TRASH, "doc", ParamKind::Document))
                // Reversibile, e non per ottimismo: la reversibilità è
                // `trash.restore`, che sta in questo stesso registro.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            comando(TRASH_RESTORE)
                .with_param(parametro(TRASH_RESTORE, "entry", ParamKind::Text).required())
                .with_param(parametro(TRASH_RESTORE, "to", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            comando(TRASH_EMPTY)
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
            comando(VAULT_ARCHIVE)
                .with_param(parametro(VAULT_ARCHIVE, "docs", ParamKind::Documents).required())
                .with_param(parametro(VAULT_ARCHIVE, "folder", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // Nessuna scorciatoia, e in particolare **non** `Mod-Enter`:
            // quella la tiene l'editor, che spunta le todo delle righe
            // selezionate nel **buffer** (`editor-commands.ts`). Sono due
            // gesti su due oggetti diversi — il buffer e il file — e dare a
            // entrambi la stessa combinazione vorrebbe dire che l'accordo
            // fa due cose a seconda di chi vince la corsa. Chi la invoca
            // oggi è chi ha una posizione da dare: la palette, un altro
            // comando, un plugin.
            comando(NOTE_TASK_TOGGLE)
                .with_param(parametro(NOTE_TASK_TOGGLE, "doc", ParamKind::Document))
                .with_param(parametro(NOTE_TASK_TOGGLE, "at", ParamKind::Number))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            // --- le impostazioni (§11.1) --------------------------------
            //
            // Sono comandi e non codice dell'app per la ragione della
            // decisione 0009 letta al contrario: import, export e reset sono
            // esattamente le tre azioni che ogni app finisce per cablare in un
            // pulsante, e cablarle vorrebbe dire che una CLI (27.1), una macro
            // (16.2) e un centro di comando (22.4) non le hanno.
            //
            // Il **raggio** è `CommandReach::Settings`, che era vocabolario
            // senza clienti dalla decisione 0010: questi sono i suoi primi
            // quattro, e chi invoca sa da lì che sta per toccare la
            // configurazione e non delle note.
            comando(SETTINGS_SET)
                .with_param(parametro(SETTINGS_SET, "key", ParamKind::Text).required())
                .with_param(parametro(SETTINGS_SET, "value", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            comando(SETTINGS_RESET)
                .with_param(parametro(SETTINGS_RESET, "key", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            comando(SETTINGS_EXPORT).with_scope(CommandScope {
                writes: false,
                reach: CommandReach::Settings,
                reversible: true,
            }),
            comando(SETTINGS_IMPORT)
                .with_param(parametro(SETTINGS_IMPORT, "json", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            // --- l'annullamento (§13.3) ---------------------------------
            //
            // La scorciatoia **non** è `Mod-z`: quella è dell'editor, che
            // annulla il testo del buffer. Sono due pile con due soggetti
            // diversi (`Undo`), e a decidere quale risponde è il fuoco — dare a
            // entrambe lo stesso accordo vorrebbe dire che Ctrl-Z fa due cose a
            // seconda di chi vince la corsa, che è la stessa ragione per cui
            // `note.task.toggle` non prende `Mod-Enter`.
            //
            // Il raggio è `Vault` e non `Documents`: cosa toccherà lo sa la
            // voce in cima alla pila, non la spec — e dichiarare il raggio
            // stretto sarebbe la bugia che il piano smaschera. Reversibile no:
            // il redo è un'altra pila, e oggi non c'è.
            comando(VAULT_UNDO)
                .with_keybinding("Mod-Alt-z")
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
        ]
    }
}

impl CommandProvider for CoreCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        CoreCommands::specs()
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
            SEARCH_OPEN => {
                let query = args
                    .text("query")
                    .expect("l'host ha convalidato un parametro obbligatorio");
                Ok(
                    CommandOutcome::done().with_effect(CommandEffect::RunSearch {
                        query: query.to_string(),
                    }),
                )
            }
            SELECTION_WIKILINK => selection_wikilink(mode, host),
            VAULT_REPLACE => vault_replace(args, mode, host),
            NOTE_CREATE => note_create(args, mode, host),
            NOTE_RENAME => note_rename(args, mode, host),
            NOTE_TRASH => note_trash(args, mode, host),
            TRASH_RESTORE => trash_restore(args, mode, host),
            TRASH_EMPTY => trash_empty(mode, host),
            VAULT_ARCHIVE => vault_archive(args, mode, host),
            NOTE_TASK_TOGGLE => note_task_toggle(args, mode, host),
            VAULT_UNDO => vault_undo(mode, host),
            SETTINGS_SET => settings_set(args, mode, host),
            SETTINGS_RESET => settings_reset(args, mode, host),
            SETTINGS_EXPORT => settings_export(host),
            SETTINGS_IMPORT => settings_import(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

// ---------------------------------------------------------------------------
// selection.wikilink
// ---------------------------------------------------------------------------

/// Il testo selezionato diventa `[[testo]]` — **in ogni punto selezionato**.
///
/// Con più cursori le selezioni sono N e l'azione è una sola (decisione 0093):
/// applicarla alla sola primaria vorrebbe dire lasciare all'utente due dei tre
/// punti che ha appena scelto, che è il gesto per cui il multi-cursore esiste.
/// Gli edit sono **tutti o nessuno**, perché è la garanzia che
/// [`EditRequest`] porta già.
///
/// I cursori senza testo dentro non hanno niente da avvolgere e restano fuori:
/// non in silenzio, però — il messaggio dice **quante** selezioni sono state
/// trasformate, e la prova a vuoto (`mode.is_dry_run()`) elenca gli edit veri.
/// Se nessuna delle N ha del testo, il comando non fa niente e lo dice.
///
/// Lo stato in cui il comando non può agire — nessuna nota, nessuna selezione,
/// oppure un insieme fluttuante (buffer sporco: le coordinate non valgono per
/// il file) — è un [`PluginError::BadArgs`] con dentro la ragione. È il caso
/// che il §12.2 chiuderà bene (un errore *di precondizione* non è un errore di
/// argomenti): finché il confine ha questo vocabolario, un errore che si spiega
/// vale più di un successo che non ha fatto niente — chi invoca può non essere
/// una persona che guarda lo schermo.
fn selection_wikilink(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let stato = |key: &str| PluginError::BadArgs(Text::key(key));
    let context = host
        .active_context()
        .ok_or_else(|| stato(E_NO_ACTIVE_PANE))?;
    let doc = context.doc.ok_or_else(|| stato(E_NO_OPEN_NOTE))?;
    let selections = context
        .selections
        .ok_or_else(|| stato(E_NOTHING_SELECTED))?;
    // La regola dello span della decisione 0007, nel posto in cui la 0093 l'ha
    // messa: senza ancoraggio le coordinate valgono per il buffer e non per il
    // file, e non ne vale **nessuna** — il buffer è uno. Scrivere lì
    // significa tagliare i byte sbagliati proprio mentre l'utente scrive.
    let ancorate = selections
        .placed()
        .ok_or_else(|| stato(E_DIRTY_SELECTION))?;

    let source = host.read_document(&doc)?;
    // Il testo che verrà sostituito è quello del **file**, non quello del
    // buffer: sono lo stesso testo (uno span esiste solo a buffer pulito), e
    // prenderlo da qui lo rende vero per costruzione invece che per fiducia.
    let mut avvolgere = Vec::new();
    for selezione in ancorate.all() {
        if selezione.is_empty() {
            continue;
        }
        let selected = source
            .get(selezione.span.start..selezione.span.end)
            .ok_or_else(|| stato(E_SELECTION_OUTSIDE))?;
        if selected.contains("[[") || selected.contains(']') {
            return Err(stato(E_SELECTION_HAS_LINK));
        }
        avvolgere.push((selezione.span, selected));
    }
    // Nessuna delle N ha del testo: sono tutti cursori, e un cursore non si
    // avvolge. È lo stesso rifiuto di prima, contato su tutte invece che su una.
    let (_, primo_testo) = *avvolgere.first().ok_or_else(|| stato(E_EMPTY_SELECTION))?;
    let quante = avvolgere.len();

    let request = EditRequest::new(
        host.document_revision(&doc)?,
        avvolgere
            .iter()
            .map(|(span, selected)| TextEdit::replace(*span, format!("[[{selected}]]")))
            .collect(),
    );
    // Una selezione sola si racconta col testo che ha dentro; N si raccontano
    // col numero, perché elencarli non aiuterebbe nessuno a capire cosa sta per
    // succedere.
    let racconto = |uno: &str, molte: &str| {
        if quante == 1 {
            Text::message(uno, vec![Arg::text(A_TEXT, primo_testo)])
        } else {
            Text::message(molte, vec![Arg::int(A_COUNT, quante as i64)])
        }
    };
    if mode.is_dry_run() {
        let cosa = if quante == 1 {
            Text::message(
                P_WIKILINK,
                vec![
                    Arg::text(A_TEXT, primo_testo),
                    Arg::text(A_DOC, doc.as_str()),
                ],
            )
        } else {
            Text::message(
                P_WIKILINK_MANY,
                vec![
                    Arg::int(A_COUNT, quante as i64),
                    Arg::text(A_DOC, doc.as_str()),
                ],
            )
        };
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                cosa,
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }

    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        racconto(U_WIKILINK, U_WIKILINK_MANY),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    // Dov'è finito il testo nuovo: è il rapporto a saperlo, nelle coordinate
    // del documento riscritto (decisione 0008). Senza, la shell dovrebbe ricalcolare uno
    // spostamento che l'host ha già calcolato.
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(
        CommandOutcome::notify(racconto(D_WIKILINK, D_WIKILINK_MANY))
            .undoable(undo)
            .with_effect(effect),
    )
}

// ---------------------------------------------------------------------------
// vault.replace
// ---------------------------------------------------------------------------

fn vault_replace(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let find = args.text("find").unwrap_or_default();
    let replace = args.text("replace").unwrap_or_default();
    let whole_word = args.flag("whole_word", false);
    if find.is_empty() {
        // Lo schema dice "testo obbligatorio", non "testo non vuoto": la
        // stringa vuota è un argomento valido per la specie e senza senso per
        // questo comando. Il vocabolario dei parametri resta piccolo apposta —
        // ciò che una specie non esprime lo dice il comando, e lo dice qui.
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_FIND)));
    }

    // Senza `docs` si scandisce il vault intero, una lettura per nota. Sembra il
    // posto dove chiedere all'indice quali note contengono l'ago, e non lo è:
    // l'indice tiene la **proiezione a testo piano** del documento (niente
    // frontmatter, niente marcatori, i wikilink ridotti all'etichetta — vedi
    // `fub-kernel/src/occurrences.rs`), mentre `occurrences` cerca byte in un
    // file. Un prefiltro non renderebbe questo comando più rapido: lo
    // renderebbe incompleto, in silenzio. Il conto e la prova stanno in
    // `tests/chi_risponde_apre_i_byte.rs`.
    let targets = match args.documents("docs") {
        Some(docs) => docs,
        None => host.list_documents(None)?.items,
    };

    let mut planned = Vec::new();
    let mut occorrenze = 0usize;
    for doc in targets {
        let source = host.read_document(&doc)?;
        let spans = occurrences(&source, find, whole_word);
        if spans.is_empty() {
            continue;
        }
        occorrenze += spans.len();
        let edits = spans
            .into_iter()
            .map(|span| TextEdit::replace(span, replace))
            .collect();
        // La base è la revisione di **adesso**: se il documento cambia fra il
        // piano e l'approvazione, applicarlo fallisce con `Conflict` invece di
        // sovrascrivere il lavoro di qualcun altro. È la ragione per cui un
        // piano non è un'ipotesi vaga ma una promessa verificabile.
        planned.push(PlannedEdit::new(
            doc.clone(),
            EditRequest::new(host.document_revision(&doc)?, edits),
        ));
    }

    let summary = conto2(P_REPLACE, A_OCCURRENCES, occorrenze, A_NOTES, planned.len());

    if mode.is_dry_run() {
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(summary, planned))));
    }

    // Si applica tutto, anche se una nota fallisce: fermarsi a metà lascerebbe
    // il vault fra due stati senza dire quali note sono in quale. Ciò che non è
    // riuscito si nomina — un conflitto qui è la cosa che il piano esisteva per
    // rendere visibile, non un dettaglio da inghiottire.
    let mut fatte = 0usize;
    let mut falliti: Vec<Failure> = Vec::new();
    // L'inverso si raccoglie **mentre si scrive**, non ricalcolandolo dopo: il
    // rapporto di ogni modifica porta le coordinate nuove e il testo tolto, e
    // `EditReport::inverse` ne fa una richiesta come le altre (decisione 0008).
    // Ricalcolarlo dopo vorrebbe dire rileggere N documenti e cercarci dentro
    // il testo sostituito — cioè indovinare quali occorrenze erano le nostre.
    let mut indietro: Vec<PlannedEdit> = Vec::new();
    let davanti = planned.len();
    for PlannedEdit { doc, edit } in planned {
        match host.apply_edit(&doc, edit) {
            Ok(report) => {
                fatte += 1;
                indietro.push(PlannedEdit::new(doc, report.inverse()));
            }
            Err(e) => falliti.push(Failure::of(doc, e)),
        }
    }
    let notify = if falliti.is_empty() {
        conto2(D_REPLACE, A_OCCURRENCES, occorrenze, A_NOTES, fatte)
    } else {
        Text::message(
            D_REPLACE_PARTIAL,
            vec![
                Arg::int(A_OCCURRENCES, occorrenze as i64),
                Arg::int(A_NOTES, fatte as i64),
                Arg::text(A_FAILED, perche(&falliti)),
            ],
        )
    };
    // Lo stesso conto, come **dato**: la frase qui sopra la legge un umano, e
    // fino alla §23.14 era l'unica forma in cui questa notizia esisteva —
    // un'automazione che invocava `vault.replace` non aveva modo di sapere che
    // undici note su dodici erano cambiate, se non leggendo italiano.
    let conto = Partial::of(davanti, fatte, falliti);
    // Anche una sostituzione **parziale** è annullabile, e per ciò che è
    // riuscito: è il verso giusto, perché è proprio quando qualcosa è andato
    // storto che si vuole tornare indietro. Le note fallite non hanno un
    // inverso da fare — non è successo niente, su di loro.
    let undo = Undo::of_edits(
        conto2(U_REPLACE, A_OCCURRENCES, occorrenze, A_NOTES, fatte),
        indietro,
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(conto))
}

// ---------------------------------------------------------------------------
// I comandi strutturali (decisione 0013)
// ---------------------------------------------------------------------------
//
// Sono sottili apposta: tutto ciò che fanno lo fanno chiedendolo all'host. La
// validazione dei path, il recinto del vault, la riscrittura dei backlink e il
// lotto stanno dietro le capacità, dove stavano già — la novità è che adesso ci
// si arriva **dal di fuori**, con la stessa firma che avrà un plugin.

/// Il path di una nota a partire da come l'utente l'ha nominata: se l'ultimo
/// segmento non porta un punto, l'estensione predefinita.
///
/// «Progetti/Idee» è un path senza estensione, «note.2026» è un nome con un
/// punto in mezzo — e distinguerli guardando solo l'ultimo segmento è la stessa
/// regola che usa il vault per il cestino.
fn con_estensione(name: &str) -> String {
    let ultimo = name.rsplit('/').next().unwrap_or(name);
    if ultimo.contains('.') {
        name.to_string()
    } else {
        format!("{name}.{ESTENSIONE_PREDEFINITA}")
    }
}

fn piano(summary: Text, docs: Vec<DocId>) -> CommandOutcome {
    let plan = docs
        .into_iter()
        .fold(CommandPlan::of_edits(summary, Vec::new()), |p, d| {
            p.with_doc(d)
        });
    CommandOutcome::done().with_effect(CommandEffect::Plan(plan))
}

fn note_create(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let richiesto = args.text("name").map(str::trim).filter(|n| !n.is_empty());
    let id = match richiesto {
        Some(name) => DocId::new(con_estensione(name)),
        // Il nome libero lo chiede all'host: la convenzione D3 è una sola, e
        // sta nel vault che è l'unico a sapere cosa è occupato.
        None => host.free_name(&DocId::new(format!(
            "{SENZA_TITOLO}.{ESTENSIONE_PREDEFINITA}"
        ))),
    };

    if mode.is_dry_run() {
        return Ok(piano(uno(P_CREATE, A_DOC, id.as_str()), vec![id]));
    }

    // `create_document` e non `write_document`: se il path è occupato questo
    // comando deve fallire, non sovrascrivere una nota dell'utente.
    host.create_document(&id, "")?;
    let notify = uno(D_CREATE, A_DOC, id.as_str());
    // L'inverso di «crea» è «cestina», ed è un comando che sta in questo stesso
    // registro: l'annullamento non ha bisogno di un verbo suo (§13.3). Che sia
    // il **cestino** e non una cancellazione definitiva non è prudenza — è che
    // l'inverso di un gesto reversibile deve restare reversibile, o annullare
    // sarebbe più distruttivo di ciò che annulla.
    let undo = Undo::by_command(
        uno(U_CREATE, A_DOC, id.as_str()),
        NOTE_TRASH,
        serde_json::json!({ "doc": id.as_str() }),
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc: id }))
}

fn note_rename(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_EMPTY_TO)))?;
    let to = DocId::new(con_estensione(to));

    if mode.is_dry_run() {
        // L'insieme impattato di una rinomina non è «la nota»: sono anche tutte
        // quelle che la nominano, perché è lì che il kernel riscriverà i
        // wikilink. Il piano è ciò che l'utente approva, e approvare «rinomina
        // una nota» quando le note toccate sono quaranta è un consenso
        // strappato — quindi i backlink si chiedono all'indice.
        let mut docs = vec![doc.clone(), to.clone()];
        if let IndexResult::Backlinks(sorgenti) = host.query_index(IndexQuery::Backlinks {
            target: doc.clone(),
            page: None,
        })? {
            for BacklinkRef { source, .. } in sorgenti.items {
                if !docs.contains(&source) {
                    docs.push(source);
                }
            }
        }
        return Ok(piano(due(P_RENAME, doc.as_str(), to.as_str()), docs));
    }

    host.rename_document(&doc, &to)?;
    // L'inverso di una rinomina è **la rinomina all'incontrario**, e con essa
    // torna indietro gratis anche tutto ciò che la rinomina si era portata
    // dietro: i wikilink riscritti nelle sorgenti, l'organizzazione, lo stato
    // per-documento. È l'argomento per cui `UndoStep::Command` esiste — un
    // linguaggio di operazioni inverse avrebbe dovuto rifare quel lavoro, e
    // rifarlo *uguale*.
    //
    // L'etichetta e gli argomenti vanno in **verso opposto**, ed è la sola riga
    // di questa funzione in cui vale la pena guardarci due volte: gli argomenti
    // sono l'operazione da fare (`to` → `doc`, la rinomina all'incontrario),
    // l'etichetta è l'operazione da **disfare** (`doc` → `to`, quella appena
    // fatta). Scriverle nello stesso verso è il refuso naturale qui, e produce
    // un «Annullato: la rinomina di «Nuova.md» in «Vecchia.md»» che nomina il
    // rimedio invece del male — come tutte le altre `undo.*`, questa nomina ciò
    // che è successo.
    let undo = Undo::by_command(
        due(U_RENAME, doc.as_str(), to.as_str()),
        NOTE_RENAME,
        serde_json::json!({ "doc": to.as_str(), "to": doc.as_str() }),
    );
    // Nessun `Navigate`: chi guardava quella nota la segue attraverso
    // `document-renamed`, e chi ne guardava un'altra non deve essere spostato.
    Ok(CommandOutcome::notify(due(D_RENAME, doc.as_str(), to.as_str())).undoable(undo))
}

fn note_trash(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_NOTE_GIVEN)))?;

    if mode.is_dry_run() {
        return Ok(piano(uno(P_TRASH, A_DOC, doc.as_str()), vec![doc]));
    }

    let cestinata = host.trash_document(&doc)?;
    // L'inverso è il ripristino, **con il path d'origine dichiarato**: senza
    // `to`, un ripristino torna al nome originale, e se nel frattempo qualcuno
    // ha occupato quel path fallisce. Dirlo esplicitamente non cambia il caso
    // normale e rende leggibile ciò che l'annullamento promette.
    let undo = Undo::by_command(
        uno(U_TRASH, A_DOC, doc.as_str()),
        TRASH_RESTORE,
        serde_json::json!({ "entry": cestinata.as_str(), "to": doc.as_str() }),
    );
    Ok(CommandOutcome::notify(uno(D_TRASH, A_DOC, doc.as_str())).undoable(undo))
}

fn trash_restore(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let entry = args
        .document("entry")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| DocId::new(con_estensione(t)));

    if mode.is_dry_run() {
        // Dove tornerebbe lo sa il cestino, non chi invoca: si legge, così il
        // piano nomina il documento vero anche quando `to` non c'è.
        let voce = host
            .list_trash()?
            .into_iter()
            .find(|e| e.id == entry)
            .ok_or_else(|| PluginError::BadArgs(uno(E_NOT_IN_TRASH, A_ENTRY, entry.as_str())))?;
        let target = to.unwrap_or(voce.original);
        let summary = Text::message(
            P_RESTORE,
            vec![
                Arg::text(A_ENTRY, entry.as_str()),
                Arg::text(A_DOC, target.as_str()),
            ],
        );
        return Ok(piano(summary, vec![target]));
    }

    let target = host.restore_document(&entry, to)?;
    let notify = uno(D_RESTORE, A_DOC, target.as_str());
    // E l'inverso del ripristino è di nuovo il cestino: le due voci si
    // rimandano l'una all'altra, che è ciò che rende annullabile anche
    // l'annullamento — se non fosse per la bandiera che dice che un
    // annullamento non entra in pila, sarebbe un ciclo.
    let undo = Undo::by_command(
        uno(U_RESTORE, A_DOC, target.as_str()),
        NOTE_TRASH,
        serde_json::json!({ "doc": target.as_str() }),
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc: target }))
}

/// Annulla l'ultima operazione annullabile (§13.3).
///
/// Il comando è **sottile come gli strutturali**, e per la stessa ragione: tutto
/// ciò che fa lo chiede all'host. Che esista comunque, invece di lasciare la
/// capacità nuda, è ciò che gli dà un posto nella palette, una scorciatoia e una
/// descrizione per un umano — le tre cose che la decisione 0009 dà gratis a
/// qualunque comando e a nessuna capacità.
///
/// In simulazione non prova ad annullare e non guarda nemmeno la pila: un piano
/// onesto direbbe *quali* documenti tornerebbero indietro, e per saperlo
/// bisognerebbe togliere la voce dalla pila — cioè fare metà dell'operazione per
/// raccontarla. Dice quindi la sola cosa vera che può dire senza toccare niente.
fn vault_undo(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    if mode.is_dry_run() {
        return Ok(piano(Text::key(P_UNDO), Vec::new()));
    }
    let Some(fatto) = host.undo_last()? else {
        // Niente da annullare non è un errore: è la risposta normale a un vault
        // appena aperto, e chi la riceve ha una frase da mostrare.
        return Ok(CommandOutcome::notify(Text::key(D_NOTHING_TO_UNDO)));
    };
    let cosa = Arg::text(A_WHAT, fatto.label.as_literal().unwrap_or_default());

    // I due conti dicono cose diverse e **si scelgono in quest'ordine** (§23.14):
    // se l'annullamento si è fermato, quella è la notizia di adesso e va detta
    // per prima; se invece è andato per intero, resta da dire che l'operazione
    // che ha disfatto era già a metà per conto suo. Dirle tutte e due in una
    // riga sola vorrebbe dire quattro numeri in una notifica, che è il modo di
    // non farne leggere nessuno.
    //
    // Il `partial` dell'esito porta **sempre** quello dell'annullamento, anche
    // quando la frase parla dell'operazione: è ciò che è successo adesso, ed è
    // l'unico dei due su cui chi automatizza può fare qualcosa.
    let messaggio = match (&fatto.replay, &fatto.operation) {
        (Some(replay), _) => Text::message(
            D_UNDONE_PARTIAL,
            vec![
                cosa,
                Arg::int(A_DONE, replay.done as i64),
                Arg::int(A_ATTEMPTED, replay.attempted as i64),
                Arg::text(A_FAILED, perche(&replay.failures)),
            ],
        ),
        (None, Some(operazione)) => Text::message(
            D_UNDONE_OF_PARTIAL,
            vec![
                cosa,
                Arg::int(A_DONE, operazione.done as i64),
                Arg::int(A_ATTEMPTED, operazione.attempted as i64),
            ],
        ),
        (None, None) => Text::message(D_UNDONE, vec![cosa]),
    };
    Ok(CommandOutcome::notify(messaggio).partially(fatto.replay))
}

/// Una chiave di impostazione che non è passata, col perché **e la sua specie**.
///
/// Il soggetto non è un documento — è una chiave — quindi va dentro la frase e
/// non nel [`Failure::subject`], che esiste perché chi disegna ci attacchi un
/// link e un link vuole un `DocId`. Ciò che si guadagna rispetto al
/// `format!("`{key}` ({e})")` di prima è la **variante**: un
/// [`PermissionDenied`](PluginError::PermissionDenied) resta un permesso negato
/// invece di appiattirsi in una stringa, e chi mostra l'esito può dire
/// «l'amministratore l'ha bloccata» invece di «qualcosa è andato storto».
fn chiave_saltata(key: &str, mut e: PluginError) -> Failure {
    let dentro = e.message().to_string();
    *e.message_mut() = format!("`{key}` ({dentro})").into();
    Failure::other(e)
}

/// I perché dei guasti, in una riga: `«nota.md» (il documento è cambiato…)`.
///
/// Restano in italiano come le ragioni dell'import delle impostazioni, e per la
/// stessa ragione scritta lì: metà di queste frasi vengono dal kernel, che
/// scrive italiano cablato, e tradurre l'altra metà lascerebbe un messaggio
/// mezzo in una lingua e mezzo nell'altra. Ciò che *è* traducibile viaggia
/// intanto come dato, in [`CommandOutcome::partial`], dove chi disegna lo trova
/// intero.
fn perche(guasti: &[Failure]) -> String {
    guasti
        .iter()
        .map(|g| match &g.subject {
            Some(doc) => format!("«{doc}» ({})", g.error),
            None => g.error.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn trash_empty(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    if mode.is_dry_run() {
        let voci = host.list_trash()?;
        return Ok(piano(
            conto(P_EMPTY_TRASH, voci.len()),
            voci.into_iter().map(|e| e.id).collect(),
        ));
    }

    let quante = host.empty_trash()?;
    Ok(CommandOutcome::notify(conto(
        D_EMPTY_TRASH,
        quante as usize,
    )))
}

// ---------------------------------------------------------------------------
// vault.archive — il cliente di `run_command`
// ---------------------------------------------------------------------------

/// La cartella in cui archiviare, quando non è stata detta.
const ARCHIVIO: &str = "Archivio";

/// Sposta N note in una cartella **invocando `note.rename`**, non rinominando.
///
/// È la forma che la decisione 0013 voleva provare: una macro non rifà ciò che un comando
/// già sa fare, lo chiama. Tre conseguenze che si vedono solo qui:
///
/// - la riscrittura dei wikilink arriva **gratis**, perché la fa il comando
///   invocato: questa funzione non nomina nemmeno un link;
/// - simulare la macro simula i passi, perché il modo viaggia con l'host e non
///   con la chiamata — e il piano che ne esce è l'unione dei loro;
/// - l'attore e il lotto restano quelli di chi ha chiesto: N rinomine, che sono
///   N riscritture di M sorgenti, sono **un** `batch-ended` e una riga sola
///   nella storia di chi guarda gli eventi.
fn vault_archive(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let docs = args
        .documents("docs")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let folder = args
        .text("folder")
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .unwrap_or(ARCHIVIO)
        .trim_end_matches('/')
        .to_string();

    let mut plans: Vec<CommandPlan> = Vec::new();
    let mut fatte = 0usize;
    let mut falliti: Vec<Failure> = Vec::new();
    // I passi dell'annullamento della macro sono quelli dei comandi invocati.
    // È la terza cosa che si compone gratis passando da `run_command` — dopo il
    // piano e il lotto — e la sola che questa funzione deve **girare**: si
    // torna indietro dall'ultima rinomina, non dalla prima.
    let mut indietro: Vec<UndoStep> = Vec::new();

    for doc in &docs {
        let nome = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        let to = format!("{folder}/{nome}");
        if to == doc.as_str() {
            continue; // già archiviata: non è un errore, è niente da fare
        }
        let args = serde_json::json!({ "doc": doc.as_str(), "to": to });
        match host.run_command(NOTE_RENAME, args) {
            // In simulazione il comando invocato risponde col proprio piano —
            // non perché questa funzione glielo abbia chiesto, ma perché
            // l'host in cui gira è già quello di una simulazione.
            Ok(CommandOutcome {
                effect: CommandEffect::Plan(plan),
                ..
            }) => plans.push(plan),
            Ok(esito) => {
                fatte += 1;
                if let Some(undo) = esito.undo {
                    indietro.extend(undo.steps);
                }
            }
            Err(e) => falliti.push(Failure::of(doc.clone(), e)),
        }
    }
    indietro.reverse();

    if mode.is_dry_run() {
        // L'unione dei piani dei passi. `docs` prima di `edits` perché è
        // l'ordine in cui le cose succederebbero, e `complete()` dell'host
        // ricontrolla comunque che nessun edit nomini una nota assente.
        let mut docs_toccati: Vec<DocId> = Vec::new();
        let mut edits: Vec<PlannedEdit> = Vec::new();
        for plan in plans {
            for d in plan.docs {
                if !docs_toccati.contains(&d) {
                    docs_toccati.push(d);
                }
            }
            edits.extend(plan.edits);
        }
        let summary = archivio(P_ARCHIVE, docs.len(), &folder, None);
        let mut plan = CommandPlan::of_edits(summary, edits);
        for d in docs_toccati {
            plan = plan.with_doc(d);
        }
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }

    let notify = if falliti.is_empty() {
        archivio(D_ARCHIVE, fatte, &folder, None)
    } else {
        archivio(D_ARCHIVE_PARTIAL, fatte, &folder, Some(perche(&falliti)))
    };
    // `docs.len()` e non `fatte + falliti.len()`: le note già nella cartella
    // sono state guardate e non c'era niente da fare, il che è esattamente il
    // resto che `Partial` lascia senza un campo. Contarle fuori direbbe «undici
    // su undici» di un gesto che l'utente ha fatto su dodici note.
    let conto = Partial::of(docs.len(), fatte, falliti);
    Ok(CommandOutcome::notify(notify)
        .undoable(Undo {
            label: archivio(U_ARCHIVE, fatte, &folder, None),
            steps: indietro,
        })
        .partially(conto))
}

// ---------------------------------------------------------------------------
// note.task.toggle
// ---------------------------------------------------------------------------

/// Spunta il task che sta sotto una posizione: il **primo cliente one-shot** del
/// modello parsato (§4.2, [decisione 0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md)).
///
/// È il gesto quotidiano del capitolo 10, ed è anche la prova che la capacità
/// nuova serve a qualcosa che prima non si poteva scrivere. Le due strade di
/// prima erano entrambe storte: **riparsare** il markdown con un parser proprio
/// — una seconda grammatica dentro un comando, che è il §4.4 visto dal lato del
/// consumo — oppure registrare un `IndexProvider`-**specchio** che tiene una
/// copia dell'intero vault al solo scopo di aver visto passare *questa* nota.
/// Questa funzione non fa né l'una né l'altra: chiede il modello di una nota
/// sola, e non conosce un solo carattere della sintassi dei task.
///
/// Ciò che scrive è **un carattere**, ed è lo `span` del marcatore a dirle
/// quale: il modello porta la posizione del simbolo e non della voce
/// ([`TaskMarker`]), quindi spuntare non riscrive la riga, non tocca il testo
/// del task e non ha modo di sbagliare l'indentazione.
///
/// # La coppia che conosce
///
/// `[ ]` diventa `[x]`; **ogni altro simbolo torna `[ ]`**. Non è la lettura
/// binaria di [`TaskMarker::checked`], ed è deliberato: gli stati personalizzati
/// (`[/]` in corso, `[-]` cancellato, `[>]` rimandato) sono una famiglia che il
/// prodotto non ha ancora definito, e un toggle che li promuovesse a `[x]`
/// deciderebbe al posto suo che «in corso» è più vicino a «fatto» che a «da
/// fare». Toglierli è l'unica mossa reversibile: il simbolo che c'era lo sa
/// ancora l'undo, mentre una semantica inventata non la disfa nessuno.
fn note_task_toggle(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let stato = |text: Text| PluginError::BadArgs(text);
    let context = host.active_context();

    let doc = args
        .document("doc")
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| stato(Text::key(E_TASK_NO_NOTE)))?;

    // La posizione: quella detta, o quella del cursore. Le due non si mescolano
    // — un `doc` detto e un `at` no vorrebbe dire spuntare in una nota il task
    // che sta sotto il cursore di **un'altra**, che è un modo silenzioso di
    // scrivere nel posto sbagliato.
    let at = match args.number("at") {
        Some(n) => posizione(n)?,
        None => {
            let context = context
                .as_ref()
                .ok_or_else(|| stato(Text::key(E_TASK_NO_POSITION)))?;
            if context.doc.as_ref() != Some(&doc) {
                return Err(stato(uno(E_TASK_WRONG_PANE, A_DOC, doc.as_str())));
            }
            let selections = context
                .selections
                .as_ref()
                .ok_or_else(|| stato(Text::key(E_TASK_NO_CARET)))?;
            // La regola dello span della decisione 0007, per la stessa ragione di
            // `selection.wikilink`: a buffer sporco le coordinate valgono per il
            // buffer, e il modello che si sta per chiedere è quello del **file**.
            //
            // Con più cursori qui si legge la **primaria**, e non è la
            // sottrazione che è per `selection.wikilink` (decisione 0093): la
            // posizione di questo comando è un *argomento* — `at`, uno scalare
            // in una `CommandSpec` pubblicata — e il comando è «spunta il task
            // sotto il cursore», al singolare per costruzione. Spuntarne N
            // vorrebbe dire un `at` che è una lista, cioè una seconda decisione
            // di firma, e non la si prende di straforo dentro questa.
            selections
                .placed()
                .ok_or_else(|| stato(Text::key(E_TASK_DIRTY_BUFFER)))?
                .primary
                .span
                .start
        }
    };

    let model = host.read_model(&doc)?;
    let marker = task_at(&model, at).ok_or_else(|| {
        stato(Text::message(
            E_TASK_NOT_FOUND,
            vec![Arg::int(A_AT, at as i64), Arg::text(A_DOC, doc.as_str())],
        ))
    })?;

    let (simbolo, fatto) = match marker.symbol {
        None => ("x", true),
        Some(_) => (" ", false),
    };
    let request = EditRequest::new(
        host.document_revision(&doc)?,
        vec![TextEdit::replace(marker.span, simbolo)],
    );
    let summary = uno(
        if fatto { P_TASK_DONE } else { P_TASK_TODO },
        A_DOC,
        doc.as_str(),
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
    let undo = Undo::of_edits(
        uno(U_TASK, A_DOC, doc.as_str()),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(summary)
        .undoable(undo)
        .with_effect(effect))
}

/// Un `at` che arriva come numero JSON diventa un offset in byte, o si spiega.
///
/// La specie [`ParamKind::Number`] è un `f64`, e ciò che non è un indice di byte
/// — un negativo, una frazione, un infinito — va rifiutato **qui**: `as usize`
/// lo tradurrebbe in una posizione plausibile e sbagliata (`-1` diventa un
/// numero enorme, `3.9` diventa `3`), e chi legge l'errore dopo avrebbe in mano
/// un task spuntato al posto di un rifiuto.
fn posizione(n: f64) -> Result<usize, PluginError> {
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(PluginError::BadArgs(
            format!("`at` è una posizione in byte: {n} non lo è").into(),
        ))
    }
}

/// Il marcatore del task che contiene `at`, **il più interno** se sono
/// annidati.
///
/// Il criterio è la voce più stretta fra quelle che contengono la posizione: le
/// voci annidate stanno dentro la loro, quindi il minimo è sempre la foglia — e
/// un cursore su una sottovoce spunta quella e non il task che la contiene, che
/// è ciò che si aspetta chi guarda lo schermo.
fn task_at(model: &DocumentModel, at: usize) -> Option<TaskMarker> {
    fn cerca(blocks: &[Block], at: usize, best: &mut Option<(usize, TaskMarker)>) {
        for block in blocks {
            match block {
                Block::List { items, .. } => {
                    for item in items {
                        // Fine inclusa: il cursore a fine riga è dentro la voce
                        // che si sta guardando, non fuori da tutto.
                        if at < item.span.start || at > item.span.end {
                            continue;
                        }
                        if let Some(task) = item.task {
                            let ampiezza = item.span.end - item.span.start;
                            if best.is_none_or(|(a, _)| ampiezza < a) {
                                *best = Some((ampiezza, task));
                            }
                        }
                        cerca(&item.blocks, at, best);
                    }
                }
                // Un task dentro una citazione o dentro un callout è un task, e
                // il modello lo tiene dove sta. Le altre varianti non portano
                // blocchi annidati.
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                    cerca(blocks, at, best)
                }
                _ => {}
            }
        }
    }

    let mut best = None;
    cerca(&model.body, at, &mut best);
    best.map(|(_, task)| task)
}

/// Le occorrenze di `needle` in `source`, in byte e non sovrapposte.
///
/// `whole_word` non è una raffinatezza: una sostituzione in blocco senza di essa
/// riscrive `nota` dentro `annotazione`, e chi se ne accorge lo fa dopo aver
/// toccato quaranta file.
pub fn occurrences(source: &str, needle: &str, whole_word: bool) -> Vec<Span> {
    let mut spans = Vec::new();
    if needle.is_empty() {
        return spans;
    }
    let mut from = 0usize;
    while let Some(rel) = source[from..].find(needle) {
        let start = from + rel;
        let end = start + needle.len();
        if !whole_word || is_whole_word(source, start, end) {
            spans.push(Span::new(start, end));
        }
        // Si riparte dalla fine del match: le occorrenze sono un insieme di
        // edit, e due edit non possono contendersi lo stesso punto (decisione 0008).
        from = end;
    }
    spans
}

/// Il match `[start, end)` è una parola intera? Confine = ciò che sta prima e
/// dopo non è alfanumerico né `_`.
fn is_whole_word(source: &str, start: usize, end: usize) -> bool {
    let prima = source[..start].chars().next_back();
    let dopo = source[end..].chars().next();
    let parte_di_parola = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    !parte_di_parola(prima) && !parte_di_parola(dopo)
}

// ---------------------------------------------------------------------------
// settings.* (§11.1)
// ---------------------------------------------------------------------------

/// Le impostazioni **dichiarate**, chieste al canale dati come le chiederebbe
/// la shell.
///
/// Passa da `query_index` e non da una capacità nuova perché è la regola della
/// decisione 0013: un elenco è *dati*, e i dati hanno un canale solo. Ne segue
/// una proprietà che serve qui e non altrove — un comando che elenca le
/// impostazioni vede **le stesse righe** che vede il pannello, comprese quelle
/// dei plugin di terzi, senza conoscerne nessuna.
fn declared(host: &dyn HostApi) -> Result<Vec<SettingEntry>, PluginError> {
    match host.query_index(IndexQuery::Settings { plugin: None })? {
        IndexResult::Settings(entries) => Ok(entries),
        other => Err(PluginError::Internal(
            format!(
                "risposta fuori tema: attese delle impostazioni, arrivato {}",
                other.kind_name()
            )
            .into(),
        )),
    }
}

/// Legge un valore **dalla stringa**, secondo la specie che la chiave dichiara.
///
/// Un comando si compila da una riga di comando, da un JSON di automazione o da
/// un modello (22.4): il suo `value` è testo, e a dargli un tipo è lo schema —
/// che è l'unico posto in cui quel tipo è scritto. È la stessa mossa dei
/// `ParamSpec`, un livello più in là: qui la specie non la dichiara il comando,
/// la dichiara la chiave che si sta toccando.
fn parse_value(kind: &SettingKind, raw: &str) -> Result<SettingValue, PluginError> {
    let male = |key: &str| PluginError::BadArgs(uno(key, A_VALUE, raw));
    match kind {
        SettingKind::Toggle { .. } => match raw.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "on" | "sì" | "si" => Ok(SettingValue::Toggle(true)),
            "false" | "0" | "off" | "no" => Ok(SettingValue::Toggle(false)),
            _ => Err(male(E_NOT_A_TOGGLE)),
        },
        SettingKind::Number { .. } => raw
            .trim()
            .parse::<f64>()
            .map(SettingValue::Number)
            .map_err(|_| male(E_NOT_A_NUMBER)),
        SettingKind::Text { .. } | SettingKind::Choice { .. } => {
            Ok(SettingValue::Text(raw.to_string()))
        }
        // La virgola e non il JSON: chi scrive `a, b` in un campo di testo sta
        // scrivendo due voci, e chiedergli le virgolette vorrebbe dire fargli
        // scrivere JSON dentro una stringa di un JSON.
        SettingKind::List { .. } => Ok(SettingValue::List(
            raw.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        )),
    }
}

/// La riga di una chiave, o l'errore che dice che non esiste.
fn entry_of(host: &dyn HostApi, key: &str) -> Result<SettingEntry, PluginError> {
    declared(host)?
        .into_iter()
        .find(|e| e.spec.key == key)
        .ok_or_else(|| PluginError::BadArgs(uno(E_UNDECLARED_KEY, A_KEY, key)))
}

/// Il cancello della chiave, applicato **prima di sapere in che modo si sta
/// girando**.
///
/// Un comando è un programma, quindi passa dai due cancelli come chiunque
/// altro; ciò che questa funzione aggiunge è che il rifiuto arrivi **anche in
/// simulazione**. Il gate vero resta quello dell'host
/// ([`HostApi::set_setting`]), che è dove il non-scrivere è garantito e non
/// promesso: qui si guadagna solo che il piano dica ciò che succederebbe
/// davvero, che è tutto ciò per cui un piano esiste (decisione 0010).
fn nega_se_non_scrivibile(entry: &SettingEntry) -> Result<(), PluginError> {
    if entry.spec.program_writable {
        return Ok(());
    }
    Err(PluginError::PermissionDenied(uno(
        E_NOT_PROGRAM_WRITABLE,
        A_KEY,
        &entry.spec.key,
    )))
}

fn settings_set(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = args.text("key").expect("parametro obbligatorio");
    let raw = args.text("value").expect("parametro obbligatorio");
    let entry = entry_of(host, key)?;
    nega_se_non_scrivibile(&entry)?;
    let value = parse_value(&entry.spec.kind, raw)?;
    // Il piano deve attraversare lo stesso cancello dell'applicazione: il kernel
    // lo ripeterà in `set_setting`, ma il dry-run non arriva fin lì.
    if let Some(why) = entry.spec.kind.rejects(&value) {
        return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
    }

    // La simulazione dice cosa cambierebbe **e da cosa**: un piano senza
    // documenti sarebbe vuoto (un'impostazione non è una nota), quindi ciò che
    // si mostra è il messaggio. È il limite dichiarato di `CommandPlan` su
    // questo raggio, non una dimenticanza.
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            Y_SETTINGS_SET,
            vec![
                Arg::text(A_KEY, key),
                Arg::text(A_FROM, mostra(&entry.value)),
                Arg::text(A_VALUE, mostra(&value)),
            ],
        ))
        .with_effect(CommandEffect::Plan(CommandPlan {
            summary: uno(P_SETTINGS_SET, A_KEY, key),
            ..CommandPlan::default()
        })));
    }
    host.set_setting(key, value.clone())?;
    Ok(CommandOutcome::notify(Text::message(
        D_SETTINGS_SET,
        vec![Arg::text(A_KEY, key), Arg::text(A_VALUE, mostra(&value))],
    )))
}

fn settings_reset(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = args.text("key").expect("parametro obbligatorio");
    let entry = entry_of(host, key)?;
    nega_se_non_scrivibile(&entry)?;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            Y_SETTINGS_RESET,
            vec![
                Arg::text(A_KEY, key),
                Arg::text(A_VALUE, mostra(&entry.value)),
            ],
        ))
        .with_effect(CommandEffect::Plan(CommandPlan {
            summary: uno(P_SETTINGS_RESET, A_KEY, key),
            ..CommandPlan::default()
        })));
    }
    host.reset_setting(key)?;
    Ok(CommandOutcome::notify(uno(D_SETTINGS_RESET, A_KEY, key)))
}

/// Esporta ciò che **qualcuno ha deciso**, e non i default.
///
/// I default non sono una configurazione: sono ciò che vale quando non c'è una
/// configurazione, e portarli dentro un export vorrebbe dire che reimportarlo
/// **decide** tutto ciò che nessuno aveva deciso — cioè congela per sempre i
/// default di oggi, compresi quelli che cambieranno.
fn settings_export(host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let mut decise = serde_json::Map::new();
    for entry in declared(host)? {
        if entry.source != SettingSource::Default {
            decise.insert(
                entry.spec.key.clone(),
                serde_json::to_value(&entry.value)
                    .map_err(|e| PluginError::Internal(e.to_string().into()))?,
            );
        }
    }
    let quante = decise.len();
    Ok(
        CommandOutcome::notify(conto(D_SETTINGS_EXPORT, quante)).with_effect(
            CommandEffect::Custom {
                ns: SETTINGS_NS.to_string(),
                payload: serde_json::Value::Object(decise),
            },
        ),
    )
}

/// Rimette dentro una configurazione esportata, **una chiave alla volta**.
///
/// Non è tutto-o-niente, ed è una scelta: un file che nomina una chiave di un
/// plugin che non c'è più non deve impedire di applicare le altre venti. Ciò
/// che non entra viene **contato e detto** — che è la differenza fra un import
/// parziale e un import parziale in silenzio.
fn settings_import(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let raw = args.text("json").expect("parametro obbligatorio");
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| PluginError::BadArgs(uno(E_NOT_JSON, A_REASON, &e.to_string())))?;
    let object = parsed
        .as_object()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NOT_AN_OBJECT)))?;

    let dichiarate: std::collections::BTreeMap<String, SettingEntry> = declared(host)?
        .into_iter()
        .map(|e| (e.spec.key.clone(), e))
        .collect();

    let davanti = object.len();
    let (mut applicate, mut saltate): (usize, Vec<Failure>) = (0, Vec::new());
    for (key, raw_value) in object {
        let Some(entry) = dichiarate.get(key) else {
            saltate.push(chiave_saltata(
                key,
                PluginError::BadArgs("nessuno la dichiara".into()),
            ));
            continue;
        };
        let value: SettingValue = match serde_json::from_value(raw_value.clone()) {
            Ok(value) => value,
            Err(_) => {
                saltate.push(chiave_saltata(
                    key,
                    PluginError::BadArgs("valore illeggibile".into()),
                ));
                continue;
            }
        };
        if let Some(why) = entry.spec.kind.rejects(&value) {
            saltate.push(chiave_saltata(key, PluginError::BadArgs(why.into())));
            continue;
        }
        // Il cancello della chiave si applica **anche in simulazione**, o il
        // piano direbbe una cosa e l'applicazione ne farebbe un'altra: senza
        // questa riga un dry-run su un file che nomina `privacy.telemetry`
        // risponde «2 applicate», e l'apply subito dopo «1 applicata, 1
        // saltata». Un piano che non è ciò che succederebbe non è un piano
        // (decisione 0010).
        if let Err(e) = nega_se_non_scrivibile(entry) {
            saltate.push(chiave_saltata(key, e));
            continue;
        }
        if mode.is_dry_run() {
            applicate += 1;
            continue;
        }
        match host.set_setting(key, value) {
            Ok(()) => applicate += 1,
            // Il rifiuto più importante è questo, e va **detto**: un file di
            // impostazioni che passa di mano non sposta le chiavi che un
            // programma non può scrivere.
            Err(e) => saltate.push(chiave_saltata(key, e)),
        }
    }

    let messaggio = if saltate.is_empty() {
        conto(D_SETTINGS_IMPORT, applicate)
    } else {
        Text::message(
            D_SETTINGS_IMPORT_PARTIAL,
            vec![
                Arg::int(A_COUNT, applicate as i64),
                Arg::int(A_SKIPPED, saltate.len() as i64),
                // Le ragioni per cui una chiave è saltata attraversano come
                // **dato**, non come prosa da tradurre, e restano in italiano.
                // Non è pigrizia: metà di quelle ragioni non sono di questo
                // file — vengono da `SettingKind::rejects`, che sta nel
                // **contratto** e scrive italiano cablato. Finché quel buco non
                // ha un proprietario (nessun catalogo appartiene all'ABI),
                // tradurre le due righe di qui lascerebbe una frase mezza in
                // una lingua e mezza nell'altra, che è peggio di una
                // dichiaratamente in una sola.
                Arg::text(A_REASONS, perche(&saltate)),
            ],
        )
    };
    let outcome =
        CommandOutcome::notify(messaggio).partially(Partial::of(davanti, applicate, saltate));
    Ok(if mode.is_dry_run() {
        outcome.with_effect(CommandEffect::Plan(CommandPlan {
            summary: conto(P_SETTINGS_IMPORT, applicate),
            ..CommandPlan::default()
        }))
    } else {
        outcome
    })
}

/// Un valore dentro un messaggio, **come dato**.
///
/// Diceva «acceso» e «spento» e «niente», cioè tre parole italiane che
/// finivano dentro una frase composta altrove — e una parola dentro una frase è
/// la cosa che il motore dei template della 0040 non sa comporre: un argomento
/// è `ArgValue`, e `ArgValue::Text` è dato per definizione («se andasse
/// tradotto sarebbe una chiave, non un argomento»).
///
/// Quindi un interruttore si mostra come `true`/`false`, che è la stessa cosa
/// che chi lo cambia scrive in `settings.set` e nel file: non è una resa più
/// povera, è la stessa in tutte le lingue. L'elenco vuoto è un trattino lungo,
/// che non è parola di nessuno.
fn mostra(value: &SettingValue) -> String {
    match value {
        SettingValue::Toggle(v) => format!("`{v}`"),
        SettingValue::Number(n) => n.to_string(),
        SettingValue::Text(t) => format!("`{t}`"),
        SettingValue::List(l) if l.is_empty() => "—".into(),
        SettingValue::List(l) => l.join(", "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{DocId, ListItem};
    use fub_abi::session::{SelectionSet, ViewContext};
    use fub_abi::settings::SettingSpec;
    use fub_abi::text::Strings;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    fn invoke(
        host: &mut MemoryHost,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        // Come farebbe il kernel: prima la convalida contro la spec, poi la
        // chiamata. Un test che saltasse la convalida proverebbe un percorso
        // che non esiste.
        let spec = CoreCommands::specs()
            .into_iter()
            .find(|s| s.id == command)
            .expect("comando dichiarato");
        spec.validate_args(&args)?;
        CoreCommands.invoke(command, args, mode, host)
    }

    /// Un `Text` **come lo legge chi guarda**: risolto col catalogo di questo
    /// componente, invece che stampato col suo `Display`.
    ///
    /// `Display` c'è ancora e serve — è la forma per il log della 0041 — ma per
    /// un `Text::Message` stampa la chiave e gli argomenti, non la frase. Le
    /// asserzioni che leggevano prosa devono passare di qui, e ci guadagnano:
    /// adesso provano anche che quella chiave nel catalogo ci sia.
    fn reso(text: &Text) -> String {
        let catalogo = catalog();
        let locale = fub_abi::locale::Locale::default();
        Strings::new(&catalogo, "it", &locale).render(text)
    }

    fn piano(outcome: &CommandOutcome) -> &CommandPlan {
        match &outcome.effect {
            CommandEffect::Plan(plan) => plan,
            other => panic!("un dry-run risponde con un piano, non con {other:?}"),
        }
    }

    #[test]
    fn every_command_declares_what_it_does_and_how_far_it_reaches() {
        for spec in CoreCommands::specs() {
            assert!(
                !spec.description.to_string().trim().is_empty(),
                "`{}` senza descrizione: è l'unico ingrediente su cui un \
                 chiamante non umano sceglie",
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

    #[test]
    fn opening_the_search_is_an_intent_for_the_shell_not_a_write() {
        let mut host = MemoryHost::new();
        let outcome = invoke(
            &mut host,
            SEARCH_OPEN,
            json!({ "query": "tags:rust" }),
            InvokeMode::Apply,
        )
        .expect("cerca");
        assert_eq!(
            outcome.effect,
            CommandEffect::RunSearch {
                query: "tags:rust".into()
            }
        );
    }

    #[test]
    fn the_wikilink_command_needs_a_selection_that_is_true_for_the_file() {
        let mut host = MemoryHost::new().con_documento("nota.md", "una nota di prova");
        host.set_active(Some("nota.md"));
        // Buffer sporco: c'è il testo, non lo span (decisione 0007).
        host.set_context(Some(
            ViewContext::new("main")
                .with_doc(Some(DocId::new("nota.md")))
                .with_selections(Some(SelectionSet::floating("nota"))),
        ));
        let err = invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("uno stato che non permette l'operazione si spiega")
        };
        assert!(reso(&msg).contains("non salvate"), "{}", reso(&msg));
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "una nota di prova",
            "e non ha scritto niente"
        );
    }

    #[test]
    fn the_wikilink_command_wraps_exactly_the_selected_bytes() {
        let mut host = MemoryHost::new().con_documento("nota.md", "parlo di Kant e di altro");
        host.set_active(Some("nota.md"));
        host.set_selection(9, "Kant");

        let piano_prima =
            invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::DryRun).expect("simula");
        assert_eq!(
            piano(&piano_prima).docs,
            vec![DocId::new("nota.md")],
            "il piano nomina la nota che toccherebbe"
        );
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "parlo di Kant e di altro",
            "una simulazione non scrive"
        );

        let outcome =
            invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).expect("applica");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "parlo di [[Kant]] e di altro"
        );
        let CommandEffect::Reveal { span, .. } = outcome.effect else {
            panic!("dopo aver scritto, la shell deve sapere dove guardare")
        };
        assert_eq!(
            span,
            Span::new(9, 17),
            "le coordinate sono quelle del testo NUOVO: `[[Kant]]`"
        );
    }

    #[test]
    fn a_dry_run_of_a_bulk_replace_says_what_it_would_do_and_writes_nothing() {
        let mut host = MemoryHost::new()
            .con_documento("a.md", "il gatto e il gatto")
            .con_documento("b.md", "nessun felino")
            .con_documento("c.md", "un gatto solo");

        let outcome = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane" }),
            InvokeMode::DryRun,
        )
        .expect("simula");
        let plan = piano(&outcome);
        assert_eq!(
            plan.docs,
            vec![DocId::new("a.md"), DocId::new("c.md")],
            "le note senza occorrenze non entrano nel piano"
        );
        assert_eq!(plan.edit_count(), 3);
        assert_eq!(
            reso(&plan.summary),
            "Sostituzioni: 3 · Note: 2",
            "il riassunto conta le sostituzioni e le note, e lo dice nella \
             lingua di chi legge"
        );
        assert_eq!(
            host.read_document(&DocId::new("a.md")).unwrap(),
            "il gatto e il gatto"
        );
    }

    #[test]
    fn a_bulk_replace_applies_to_the_documents_it_was_given() {
        let mut host = MemoryHost::new()
            .con_documento("a.md", "il gatto")
            .con_documento("b.md", "il gatto");
        invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane", "docs": ["b.md"] }),
            InvokeMode::Apply,
        )
        .expect("applica");
        assert_eq!(host.read_document(&DocId::new("a.md")).unwrap(), "il gatto");
        assert_eq!(host.read_document(&DocId::new("b.md")).unwrap(), "il cane");
    }

    #[test]
    fn whole_words_only_is_the_difference_between_a_fix_and_a_mess() {
        assert_eq!(
            occurrences("nota, annotazione, nota", "nota", false).len(),
            3,
            "senza il vincolo, `nota` si trova dentro `annotazione`"
        );
        let intere = occurrences("nota, annotazione, nota", "nota", true);
        assert_eq!(intere, vec![Span::new(0, 4), Span::new(19, 23)]);
        // Accentate: il confine è un carattere, non un byte.
        assert!(occurrences("però", "per", true).is_empty());
    }

    #[test]
    fn an_empty_needle_is_refused_even_though_the_schema_accepts_it() {
        let mut host = MemoryHost::new().con_documento("a.md", "x");
        let err = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "", "replace": "y" }),
            InvokeMode::DryRun,
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
    }

    // -----------------------------------------------------------------------
    // note.task.toggle — il cliente one-shot del modello (decisione 0018)
    // -----------------------------------------------------------------------

    /// Il sorgente e il modello che gli corrisponde, con gli span contati a
    /// mano: due task, la seconda annidata nella prima.
    ///
    /// ```text
    /// - [ ] fare la spesa\n  - [x] pane\n
    /// 0  3               19  22 25     32
    /// ```
    ///
    /// L'host in memoria non parsa (e non deve: proverebbe la feature contro un
    /// provider invece che contro il contratto), quindi il modello lo si semina
    /// — ed è l'occasione per dire negli span esattamente cosa il comando si
    /// aspetta di ricevere.
    const TASK_SOURCE: &str = "- [ ] fare la spesa\n  - [x] pane\n";

    fn con_task(symbol_esterno: Option<char>) -> MemoryHost {
        let interna = ListItem {
            blocks: Vec::new(),
            task: Some(TaskMarker {
                symbol: Some('x'),
                span: Span::new(25, 26),
            }),
            span: Span::new(22, 32),
        };
        let esterna = ListItem {
            blocks: vec![Block::List {
                ordered: false,
                start: None,
                items: vec![interna],
                anchor: None,
                span: Span::new(22, 32),
            }],
            task: Some(TaskMarker {
                symbol: symbol_esterno,
                span: Span::new(3, 4),
            }),
            span: Span::new(0, 32),
        };
        let mut model = DocumentModel::empty(DocId::new("nota.md"));
        model.body = vec![Block::List {
            ordered: false,
            start: None,
            items: vec![esterna],
            anchor: None,
            span: Span::new(0, 32),
        }];
        let host = MemoryHost::new()
            .con_documento("nota.md", TASK_SOURCE)
            .con_modello("nota.md", model);
        host.set_active(Some("nota.md"));
        host
    }

    #[test]
    fn checking_a_task_writes_one_character_where_the_model_says() {
        let mut host = con_task(None);
        host.set_caret(Some(10)); // dentro il testo della voce esterna

        let outcome = invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply)
            .expect("spunta il task sotto il cursore");

        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [x] fare la spesa\n  - [x] pane\n",
            "un carattere solo: il testo del task, l'indentazione e la voce \
             annidata non si toccano"
        );
        let CommandEffect::Reveal { span, .. } = outcome.effect else {
            panic!("dopo aver scritto, la shell deve sapere dove guardare")
        };
        assert_eq!(span, Span::new(3, 4));
    }

    #[test]
    fn the_innermost_task_wins_when_they_are_nested() {
        let mut host = con_task(None);
        // Una posizione che sta dentro **entrambe** le voci: la annidata è la
        // più stretta, ed è quella che l'utente sta guardando.
        invoke(
            &mut host,
            NOTE_TASK_TOGGLE,
            json!({ "doc": "nota.md", "at": 29 }),
            InvokeMode::Apply,
        )
        .expect("spunta");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [ ] fare la spesa\n  - [ ] pane\n"
        );
    }

    #[test]
    fn a_custom_state_goes_back_to_undone_and_is_not_promoted_to_done() {
        let mut host = con_task(Some('/'));
        host.set_caret(Some(0));
        invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply).expect("de-spunta");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [ ] fare la spesa\n  - [x] pane\n",
            "«in corso» non lo si promuove a «fatto»: quale sia il suo prossimo \
             stato è una domanda che il prodotto non ha ancora deciso"
        );
    }

    #[test]
    fn a_dirty_buffer_stops_it_because_the_model_is_the_one_of_the_file() {
        let mut host = con_task(None);
        host.set_caret(None); // buffer sporco: nessuno span è vero (decisione 0007)

        let err = invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply).unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("uno stato che non permette l'operazione si spiega")
        };
        assert!(reso(&msg).contains("non salvate"), "{}", reso(&msg));
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE,
            "e non ha scritto niente"
        );
    }

    #[test]
    fn a_position_that_is_not_a_byte_offset_is_refused_before_the_write() {
        let mut host = con_task(None);
        for at in [json!(-1), json!(3.5), json!(9999)] {
            let err = invoke(
                &mut host,
                NOTE_TASK_TOGGLE,
                json!({ "doc": "nota.md", "at": at }),
                InvokeMode::Apply,
            )
            .unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "`at` = {at}: una posizione che non nomina un task si dice, non \
                 si arrotonda a quello vicino"
            );
        }
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE
        );
    }

    #[test]
    fn naming_a_note_without_saying_where_does_not_take_the_caret_of_another() {
        let mut host = con_task(None);
        host.set_caret(Some(10));
        let err = invoke(
            &mut host,
            NOTE_TASK_TOGGLE,
            json!({ "doc": "altra.md" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE,
            "il cursore di una nota non è una posizione in un'altra"
        );
    }

    #[test]
    fn simulating_the_toggle_says_which_note_it_would_touch_and_writes_nothing() {
        let mut host = con_task(None);
        host.set_caret(Some(10));
        let outcome =
            invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::DryRun).expect("simula");
        assert_eq!(piano(&outcome).docs, vec![DocId::new("nota.md")]);
        assert_eq!(piano(&outcome).edit_count(), 1);
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE
        );
    }

    /// La specie di una chiave la dichiara lo **schema**, e il comando la legge
    /// da lì: è ciò che permette a `value` di essere testo — la sola forma che
    /// un chiamante non interattivo (una CLI, un'automazione, un modello) sa
    /// compilare.
    #[test]
    fn a_setting_value_is_read_according_to_the_kind_the_key_declares() {
        let numero = SettingKind::Number {
            default: 14.0,
            min: Some(8.0),
            max: Some(72.0),
        };
        assert_eq!(
            parse_value(&numero, " 18 ").unwrap(),
            SettingValue::Number(18.0)
        );
        assert!(parse_value(&numero, "grande").is_err());

        let interruttore = SettingKind::Toggle { default: true };
        assert_eq!(
            parse_value(&interruttore, "off").unwrap(),
            SettingValue::Toggle(false)
        );
        assert!(
            parse_value(&interruttore, "forse").is_err(),
            "un interruttore ha due stati, e «forse» non è uno di quelli"
        );

        // Un elenco si scrive con le virgole: chiedere il JSON vorrebbe dire
        // far scrivere virgolette dentro una stringa di un JSON.
        let elenco = SettingKind::List {
            default: Vec::new(),
        };
        assert_eq!(
            parse_value(&elenco, "a, b ,, c").unwrap(),
            SettingValue::List(vec!["a".into(), "b".into(), "c".into()])
        );
    }

    /// Il comando visto **dal contratto**: il doppio in memoria applica il
    /// cancello della chiave come lo applica il kernel, quindi ciò che qui
    /// passa è ciò che passa nell'app.
    #[test]
    fn the_command_refuses_a_key_that_is_not_program_writable_and_says_which() {
        let mut host = MemoryHost::new()
            .con_valore(
                SettingSpec::toggle("versioning.enabled", "Versioning", true).program_writable(),
                SettingValue::Toggle(true),
            )
            .con_impostazione(SettingSpec::toggle(
                "privacy.telemetry",
                "Telemetria",
                false,
            ));

        let esito = invoke(
            &mut host,
            SETTINGS_SET,
            json!({ "key": "versioning.enabled", "value": "false" }),
            InvokeMode::Apply,
        );
        assert!(esito.is_ok(), "{esito:?}");

        let errore = invoke(
            &mut host,
            SETTINGS_SET,
            json!({ "key": "privacy.telemetry", "value": "true" }),
            InvokeMode::Apply,
        )
        .expect_err("non si è dichiarata scrivibile da un programma");
        assert!(
            matches!(errore, PluginError::PermissionDenied(_)),
            "{errore:?}"
        );

        // E una chiave che nessuno dichiara è un'altra cosa ancora: un errore
        // di chi la chiede, non un permesso che manca.
        let errore = invoke(
            &mut host,
            SETTINGS_SET,
            json!({ "key": "boh", "value": "1" }),
            InvokeMode::Apply,
        )
        .expect_err("nessuno la dichiara");
        assert!(matches!(errore, PluginError::BadArgs(_)), "{errore:?}");
    }

    #[test]
    fn an_empty_document_list_is_not_the_whole_vault() {
        let mut host = MemoryHost::new().con_documento("a.md", "il gatto");
        let outcome = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane", "docs": [] }),
            InvokeMode::DryRun,
        )
        .expect("simula");
        assert!(
            piano(&outcome).is_empty(),
            "elenco vuoto = nessuna nota, non «tutte»: è ciò che la spec dichiara"
        );
    }
}
