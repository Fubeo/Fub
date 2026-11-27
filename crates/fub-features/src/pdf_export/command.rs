//! **L'esportazione come comando** e i comandi dei profili (E28, T79).
//!
//! «Esporta questa nota col profilo X» si chiede senza aprire lo spazio, anche
//! da fuori (un agente via MCP): il comando [`PDF_EXPORT_NOTE`]. La strada è
//! sempre quella dello spazio (ADR 0247): la vista impagina e misura, il core
//! scrive. Il core da solo non impagina, perché non ha un motore che vada a
//! capo come la vista; per questo il comando funziona **solo con l'app
//! aperta** sul vault:
//!
//! 1. la shell, finché è aperta, rinnova la sua presenza col comando
//!    [`PDF_EXPORT_LISTEN`] (una promessa che scade dopo [`TTL_PRESENZA_MS`]:
//!    una shell che si chiude, o una finestra che passa a un altro vault,
//!    smette di rinnovarla);
//! 2. [`PDF_EXPORT_NOTE`] sceglie il profilo, controlla la destinazione e
//!    manda alla shell la richiesta, come evento [`TOPIC_RICHIESTA`];
//! 3. la shell salva la nota se ha modifiche, la impagina fuori dallo schermo
//!    (`apps/client/src/export/headless.ts`) e chiama
//!    [`pdf.write_pages`](super::lavoro::PDF_WRITE_PAGES), che accoda il
//!    lavoro del core: il PDF arriva intero o non arriva.
//!
//! Senza una shell presente (il server MCP da solo, la CLI) il comando
//! risponde [`PluginError::Unserved`] con un testo che chiede di aprire l'app:
//! nessuno può impaginare la nota. La presenza vive nel fornitore dei comandi,
//! cioè nel processo che tiene il vault: un processo nuovo non la eredita.
//!
//! # Quale profilo
//!
//! Il profilo nominato (`profile`, per id o per nome); senza, quello
//! **predefinito per il tipo** della nota, poi quello **predefinito del
//! vault**, poi «Di serie». Un profilo nominato che non c'è è
//! [`PluginError::NotFound`]; un predefinito che punta a un profilo sparito
//! lascia il posto al livello dopo, e l'esito dice quale profilo ha deciso. Un
//! profilo di una versione più nuova vale per ciò che questa versione conosce.
//!
//! I predefiniti sono due file piccoli dello spazio dati
//! ([`super::SPAZIO_DATI`]): `predefinito.json` per il vault, e
//! `doc/<tipo>/profilo-pdf.json` nello spazio della nota del tipo, che il
//! kernel sposta con la rinomina e col cestino del tipo. La forma è in
//! `docs/reference/pdf-export-format.md`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::event::Event;
use fub_abi::model::DocId;
use fub_abi::rules::doc_data;
use fub_abi::rules::path::resolution_key;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{CommandProvider, DataRead, DataWrite, HostApi, ReadApi, VaultRead};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::lavoro::destinazione;
use super::profile::{
    self, ErroreProfilo, IdProfilo, Profilo, MAX_NOME, NOME_DI_SERIE, VERSIONE_PROFILO,
};
use crate::note_types::{self, TypeState};

/// Esporta in PDF una nota col suo profilo: l'app la impagina, il core la
/// scrive.
pub const PDF_EXPORT_NOTE: &str = "pdf.export_note";

/// La shell dice che c'è e che sa impaginare: lo rinnova finché è aperta.
pub const PDF_EXPORT_LISTEN: &str = "pdf.export_listen";

/// I profili del vault, i predefiniti e quello che vale per una nota.
pub const PDF_PROFILES: &str = "pdf.profiles";

/// Salva un profilo: sopra uno che c'è, o come profilo nuovo.
pub const PDF_PROFILE_SAVE: &str = "pdf.profile_save";

/// Copia un profilo con un nome nuovo.
pub const PDF_PROFILE_COPY: &str = "pdf.profile_copy";

/// Cambia il nome di un profilo.
pub const PDF_PROFILE_RENAME: &str = "pdf.profile_rename";

/// Fa di un profilo il predefinito del vault o di un tipo di nota.
pub const PDF_PROFILE_DEFAULT: &str = "pdf.profile_default";

/// L'evento con cui la richiesta arriva alla shell: dentro l'id dei disegni,
/// che portano il PDF delle note (`docs/reference/pdf-export-format.md`).
pub const TOPIC_RICHIESTA: &str = "fub.draw:pdf.export";

/// L'effetto di [`PDF_EXPORT_NOTE`]: `{ request, note, target, profile }`.
pub const NS_RICHIESTA: &str = "fub.pdf.export_requested";
/// L'effetto di [`PDF_EXPORT_LISTEN`]: `{ ttl_ms, renew_ms }`.
pub const NS_PRESENZA: &str = "fub.pdf.listening";
/// L'effetto di [`PDF_PROFILES`]: l'elenco e i predefiniti.
pub const NS_PROFILI: &str = "fub.pdf.profiles";
/// L'effetto dei comandi che scrivono un profilo: `{ id }`.
pub const NS_PROFILO: &str = "fub.pdf.profile";

/// Quanto vale la presenza della shell dopo l'ultimo rinnovo, in
/// millisecondi. È larga perché una finestra ridotta a icona rallenta i suoi
/// timer; una shell sparita la lascia scadere.
pub const TTL_PRESENZA_MS: u64 = 120_000;

/// Ogni quanto la shell rinnova la presenza, in millisecondi.
pub const RINNOVO_PRESENZA_MS: u64 = 30_000;

/// Il file del predefinito del vault, nello spazio dati.
pub const FILE_PREDEFINITO: &str = "predefinito.json";

/// Il nome del file del predefinito di un tipo, nello spazio dati della nota
/// del tipo.
pub const NOME_PREDEFINITO_TIPO: &str = "profilo-pdf.json";

/// La versione del formato dei file dei predefiniti.
pub const VERSIONE_PREDEFINITO: u32 = 1;

/// Il file di un predefinito più grande di così non è un predefinito.
const MAX_PREDEFINITO_BYTE: usize = 16 * 1024;

const P_NOTE: &str = "note";
const P_PROFILE: &str = "profile";
const P_TARGET: &str = "target";
const P_REPLACE: &str = "replace";
const P_ID: &str = "id";
const P_NAME: &str = "name";
const P_SCOPE: &str = "scope";

const SCOPE_VAULT: &str = "vault";
const SCOPE_TYPE: &str = "type";

const PDF: &str = ".pdf";

const T_EXPORT: &str = "pdf.export_note.title";
const T_EXPORT_DESC: &str = "pdf.export_note.desc";
const T_NOTE: &str = "pdf.export_note.note.title";
const T_NOTE_DESC: &str = "pdf.export_note.note.desc";
const T_PROFILE: &str = "pdf.export_note.profile.title";
const T_PROFILE_DESC: &str = "pdf.export_note.profile.desc";
const T_TARGET: &str = "pdf.export_note.target.title";
const T_TARGET_DESC: &str = "pdf.export_note.target.desc";
const T_REPLACE: &str = "pdf.export_note.replace.title";
const T_REPLACE_DESC: &str = "pdf.export_note.replace.desc";
const T_LISTEN: &str = "pdf.export_listen.title";
const T_LISTEN_DESC: &str = "pdf.export_listen.desc";
const T_PROFILES: &str = "pdf.profiles.title";
const T_PROFILES_DESC: &str = "pdf.profiles.desc";
const T_SAVE: &str = "pdf.profile_save.title";
const T_SAVE_DESC: &str = "pdf.profile_save.desc";
const T_ID: &str = "pdf.profile.id.title";
const T_ID_DESC: &str = "pdf.profile.id.desc";
const T_SAVE_ID_DESC: &str = "pdf.profile_save.id.desc";
const T_JSON: &str = "pdf.profile_save.profile.title";
const T_JSON_DESC: &str = "pdf.profile_save.profile.desc";
const T_COPY: &str = "pdf.profile_copy.title";
const T_COPY_DESC: &str = "pdf.profile_copy.desc";
const T_RENAME: &str = "pdf.profile_rename.title";
const T_RENAME_DESC: &str = "pdf.profile_rename.desc";
const T_NAME: &str = "pdf.profile.name.title";
const T_NAME_DESC: &str = "pdf.profile.name.desc";
const T_DEFAULT: &str = "pdf.profile_default.title";
const T_DEFAULT_DESC: &str = "pdf.profile_default.desc";
const T_DEFAULT_ID_DESC: &str = "pdf.profile_default.id.desc";
const T_SCOPE: &str = "pdf.profile_default.scope.title";
const T_SCOPE_DESC: &str = "pdf.profile_default.scope.desc";
const T_SCOPE_VAULT: &str = "pdf.profile_default.scope.vault";
const T_SCOPE_TYPE: &str = "pdf.profile_default.scope.type";
const T_DEFAULT_NOTE_DESC: &str = "pdf.profile_default.note.desc";

const PLAN_EXPORT: &str = "plan_pdf_export_note";
const PLAN_PROFILE: &str = "plan_pdf_profile";
const D_REQUESTED: &str = "done_pdf_export_requested";
const D_SAVED: &str = "done_pdf_profile_saved";
const D_DEFAULT: &str = "done_pdf_profile_default";
const D_DEFAULT_OFF: &str = "done_pdf_profile_default_off";
const E_NEEDS_APP: &str = "e_pdf_export_needs_app";
const E_NOTE: &str = "e_pdf_export_note";
const E_PROFILE_MISSING: &str = "e_pdf_profile_missing";
const E_PROFILE_ID: &str = "e_pdf_profile_id";
const E_PROFILE_UNREADABLE: &str = "e_pdf_profile_unreadable";
const E_PROFILE_TOO_BIG: &str = "e_pdf_profile_too_big";
const E_PROFILE_FUTURE: &str = "e_pdf_profile_future";
const E_PROFILE_NAME_EMPTY: &str = "e_pdf_profile_name_empty";
const E_PROFILE_NAME_LONG: &str = "e_pdf_profile_name_long";
const E_PROFILE_NAME_TAKEN: &str = "e_pdf_profile_name_taken";
const E_PROFILE_JSON: &str = "e_pdf_profile_json";
const E_DEFAULT_TYPE: &str = "e_pdf_default_no_type";
const E_DEFAULT_FUTURE: &str = "e_pdf_default_future";

/// Le stringhe in italiano, aggiunte al catalogo del bundle dei disegni.
pub(crate) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_EXPORT, "Esporta la nota in PDF")
        .with(
            T_EXPORT_DESC,
            "Esporta una nota in PDF con un profilo, senza aprire lo spazio: l'app aperta \
             impagina la nota fuori dallo schermo e Fub scrive il PDF nel vault.",
        )
        .with(T_NOTE, "Nota")
        .with(T_NOTE_DESC, "La nota Markdown da esportare.")
        .with(T_PROFILE, "Profilo")
        .with(
            T_PROFILE_DESC,
            "Il profilo d'esportazione, per id o per nome. Senza, quello predefinito per \
             il tipo della nota, poi quello del vault, poi «Di serie».",
        )
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Dove scrivere il PDF nel vault. Senza, accanto alla nota, col suo nome.",
        )
        .with(T_REPLACE, "Sostituisci")
        .with(T_REPLACE_DESC, "Se il PDF c'è già, lo sostituisce.")
        .with(T_LISTEN, "Impagina le esportazioni chieste da fuori")
        .with(
            T_LISTEN_DESC,
            "L'app dice che è aperta e che sa impaginare le note: la chiama l'app da sé, \
             finché è aperta.",
        )
        .with(T_PROFILES, "Profili d'esportazione")
        .with(
            T_PROFILES_DESC,
            "I profili d'esportazione in PDF del vault, i predefiniti e il profilo che \
             vale per una nota.",
        )
        .with(T_SAVE, "Salva il profilo d'esportazione")
        .with(
            T_SAVE_DESC,
            "Salva le regolazioni dell'esportazione in un profilo del vault: sopra un \
             profilo che c'è, o come profilo nuovo.",
        )
        .with(T_ID, "Profilo")
        .with(T_ID_DESC, "L'id del profilo: il nome del suo file.")
        .with(
            T_SAVE_ID_DESC,
            "L'id del profilo da sostituire. Senza, il profilo è nuovo.",
        )
        .with(T_JSON, "Regolazioni")
        .with(
            T_JSON_DESC,
            "Il profilo, in JSON, nella forma del suo file.",
        )
        .with(T_COPY, "Copia il profilo d'esportazione")
        .with(
            T_COPY_DESC,
            "Fa un profilo nuovo uguale a un altro, con un nome nuovo.",
        )
        .with(T_RENAME, "Rinomina il profilo d'esportazione")
        .with(
            T_RENAME_DESC,
            "Cambia il nome che si vede di un profilo; il suo file resta.",
        )
        .with(T_NAME, "Nome")
        .with(T_NAME_DESC, "Il nome che si vede nel menu dei profili.")
        .with(T_DEFAULT, "Profilo d'esportazione predefinito")
        .with(
            T_DEFAULT_DESC,
            "Fa di un profilo il predefinito del vault, o del tipo di una nota.",
        )
        .with(
            T_DEFAULT_ID_DESC,
            "L'id del profilo. Vuoto: torna «Di serie».",
        )
        .with(T_SCOPE, "Per")
        .with(T_SCOPE_DESC, "Il vault intero, o il tipo della nota.")
        .with(T_SCOPE_VAULT, "Il vault")
        .with(T_SCOPE_TYPE, "Il tipo della nota")
        .with(
            T_DEFAULT_NOTE_DESC,
            "La nota del cui tipo il profilo diventa il predefinito.",
        )
        .with(
            PLAN_EXPORT,
            "Esporta «{doc}» in «{target}» col profilo «{profile}»",
        )
        .with(PLAN_PROFILE, "Salva il profilo «{name}»")
        .with(
            D_REQUESTED,
            "L'app impagina «{doc}»: il PDF arriverà in «{target}».",
        )
        .with(D_SAVED, "Profilo «{name}» salvato.")
        .with(D_DEFAULT, "«{name}» è il profilo predefinito.")
        .with(D_DEFAULT_OFF, "Il profilo predefinito torna «Di serie».")
        .with(
            E_NEEDS_APP,
            "Per esportare in PDF serve l'app di Fub aperta su questo vault: è lei che \
             impagina la nota. Apri il vault nell'app e riprova.",
        )
        .with(
            E_NOTE,
            "«{doc}» non è una nota Markdown: si esportano in PDF solo le note.",
        )
        .with(
            E_PROFILE_MISSING,
            "Il profilo d'esportazione «{profile}» non c'è. Scegline uno fra quelli del vault.",
        )
        .with(
            E_PROFILE_ID,
            "«{profile}» non può essere il nome del file di un profilo.",
        )
        .with(
            E_PROFILE_UNREADABLE,
            "Il profilo d'esportazione «{profile}» non si legge: il suo file è rotto. \
             Correggilo o scegline un altro.",
        )
        .with(
            E_PROFILE_TOO_BIG,
            "Il profilo d'esportazione «{profile}» è troppo grande per essere un profilo.",
        )
        .with(
            E_PROFILE_FUTURE,
            "Il profilo «{profile}» viene da una versione più nuova di Fub: qui si usa ma non \
             si cambia. Salva le regolazioni come profilo nuovo.",
        )
        .with(E_PROFILE_NAME_EMPTY, "Un profilo ha bisogno di un nome.")
        .with(
            E_PROFILE_NAME_LONG,
            "Il nome di un profilo ha al più {max} caratteri.",
        )
        .with(
            E_PROFILE_NAME_TAKEN,
            "Un altro profilo si chiama già «{name}»: scegli un altro nome.",
        )
        .with(
            E_PROFILE_JSON,
            "Le regolazioni da salvare non sono un profilo: riapri lo spazio e riprova.",
        )
        .with(
            E_DEFAULT_TYPE,
            "«{doc}» non ha un tipo che Fub trovi: il predefinito per tipo vuole una nota \
             con un tipo.",
        )
        .with(
            E_DEFAULT_FUTURE,
            "Il predefinito viene da una versione più nuova di Fub e non si riscrive.",
        )
}

/// Le stesse stringhe in inglese.
pub(crate) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_EXPORT, "Export the note as PDF")
        .with(
            T_EXPORT_DESC,
            "Exports a note as PDF with a profile, without opening the space: the open app \
             lays the note out off screen and Fub writes the PDF into the vault.",
        )
        .with(T_NOTE, "Note")
        .with(T_NOTE_DESC, "The Markdown note to export.")
        .with(T_PROFILE, "Profile")
        .with(
            T_PROFILE_DESC,
            "The export profile, by id or by name. Without it, the default for the note's \
             type, then the vault's, then the built-in «Di serie».",
        )
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Where to write the PDF in the vault. Without it, next to the note, with its name.",
        )
        .with(T_REPLACE, "Replace")
        .with(T_REPLACE_DESC, "If the PDF already exists, replace it.")
        .with(T_LISTEN, "Lay out exports requested from outside")
        .with(
            T_LISTEN_DESC,
            "The app says it is open and can lay notes out: the app calls it by itself \
             while it is open.",
        )
        .with(T_PROFILES, "Export profiles")
        .with(
            T_PROFILES_DESC,
            "The vault's PDF export profiles, the defaults and the profile that applies \
             to a note.",
        )
        .with(T_SAVE, "Save the export profile")
        .with(
            T_SAVE_DESC,
            "Saves the export settings in a vault profile: over an existing profile, or \
             as a new one.",
        )
        .with(T_ID, "Profile")
        .with(T_ID_DESC, "The profile id: the name of its file.")
        .with(
            T_SAVE_ID_DESC,
            "The id of the profile to replace. Without it, the profile is new.",
        )
        .with(T_JSON, "Settings")
        .with(
            T_JSON_DESC,
            "The profile, as JSON, in the shape of its file.",
        )
        .with(T_COPY, "Copy the export profile")
        .with(
            T_COPY_DESC,
            "Makes a new profile equal to another one, with a new name.",
        )
        .with(T_RENAME, "Rename the export profile")
        .with(
            T_RENAME_DESC,
            "Changes the visible name of a profile; its file stays.",
        )
        .with(T_NAME, "Name")
        .with(T_NAME_DESC, "The name shown in the profile menu.")
        .with(T_DEFAULT, "Default export profile")
        .with(
            T_DEFAULT_DESC,
            "Makes a profile the default of the vault, or of a note's type.",
        )
        .with(
            T_DEFAULT_ID_DESC,
            "The profile id. Empty: back to the built-in «Di serie».",
        )
        .with(T_SCOPE, "For")
        .with(T_SCOPE_DESC, "The whole vault, or the note's type.")
        .with(T_SCOPE_VAULT, "The vault")
        .with(T_SCOPE_TYPE, "The note's type")
        .with(
            T_DEFAULT_NOTE_DESC,
            "The note whose type gets the profile as its default.",
        )
        .with(
            PLAN_EXPORT,
            "Export «{doc}» to «{target}» with the profile «{profile}»",
        )
        .with(PLAN_PROFILE, "Save the profile «{name}»")
        .with(
            D_REQUESTED,
            "The app is laying out «{doc}»: the PDF will arrive in «{target}».",
        )
        .with(D_SAVED, "Profile «{name}» saved.")
        .with(D_DEFAULT, "«{name}» is the default profile.")
        .with(
            D_DEFAULT_OFF,
            "The default profile is back to the built-in «Di serie».",
        )
        .with(
            E_NEEDS_APP,
            "Exporting to PDF needs the Fub app open on this vault: the app lays the note \
             out. Open the vault in the app and try again.",
        )
        .with(
            E_NOTE,
            "«{doc}» is not a Markdown note: only notes are exported to PDF.",
        )
        .with(
            E_PROFILE_MISSING,
            "The export profile «{profile}» does not exist. Choose one of the vault's profiles.",
        )
        .with(
            E_PROFILE_ID,
            "«{profile}» cannot be the file name of a profile.",
        )
        .with(
            E_PROFILE_UNREADABLE,
            "The export profile «{profile}» cannot be read: its file is broken. Fix it or \
             choose another one.",
        )
        .with(
            E_PROFILE_TOO_BIG,
            "The export profile «{profile}» is too large to be a profile.",
        )
        .with(
            E_PROFILE_FUTURE,
            "The profile «{profile}» comes from a newer version of Fub: it is used here but \
             not changed. Save the settings as a new profile.",
        )
        .with(E_PROFILE_NAME_EMPTY, "A profile needs a name.")
        .with(
            E_PROFILE_NAME_LONG,
            "A profile name has at most {max} characters.",
        )
        .with(
            E_PROFILE_NAME_TAKEN,
            "Another profile is already called «{name}»: choose another name.",
        )
        .with(
            E_PROFILE_JSON,
            "The settings to save are not a profile: reopen the space and try again.",
        )
        .with(
            E_DEFAULT_TYPE,
            "«{doc}» has no type Fub can find: the default per type needs a note with a type.",
        )
        .with(
            E_DEFAULT_FUTURE,
            "The default comes from a newer version of Fub and is not rewritten.",
        )
}

/// Le stringhe dei comandi aggiunte ai cataloghi di un bundle, lingua per
/// lingua: l'inventario le monta nel bundle dei disegni.
pub fn con_le_stringhe(catalogs: Vec<StringCatalog>) -> Vec<StringCatalog> {
    catalogs
        .into_iter()
        .map(|catalog| match catalog.locale.as_str() {
            "it" => in_italian(catalog),
            "en" => in_english(catalog),
            _ => catalog,
        })
        .collect()
}

/// Un fornitore di comandi con in più l'esportazione come comando e i comandi
/// dei profili. Come [`ConIlPdf`](super::lavoro::ConIlPdf), lo compone
/// l'inventario; tiene la presenza della shell, che vale quanto il processo.
pub struct ConIlComando<P> {
    interno: P,
    /// Fino a quando (millisecondi dell'host) la shell ha detto che c'è.
    presenza: Mutex<Option<u64>>,
    /// Il numero dell'ultima richiesta, per il suo id.
    richieste: AtomicU64,
}

impl<P> ConIlComando<P> {
    pub fn new(interno: P) -> Self {
        Self {
            interno,
            presenza: Mutex::new(None),
            richieste: AtomicU64::new(0),
        }
    }

    /// Se una shell ha detto di esserci e la promessa non è scaduta.
    fn shell_presente(&self, adesso: u64) -> bool {
        let presenza = self.presenza.lock().unwrap_or_else(|e| e.into_inner());
        presenza.is_some_and(|fino| adesso < fino)
    }

    fn rinnova(&self, adesso: u64) {
        let mut presenza = self.presenza.lock().unwrap_or_else(|e| e.into_inner());
        *presenza = Some(adesso.saturating_add(TTL_PRESENZA_MS));
    }
}

impl<P: CommandProvider> CommandProvider for ConIlComando<P> {
    fn commands(&self) -> Vec<CommandSpec> {
        let mut specs = self.interno.commands();
        specs.extend(specs_dei_comandi());
        specs
    }

    fn invoke(
        &self,
        command: &str,
        args: Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            PDF_EXPORT_NOTE => self.esporta(args, mode, host),
            PDF_EXPORT_LISTEN => {
                // Una prova non promette niente: la presenza la dà solo
                // l'app che la chiede davvero.
                if !mode.is_dry_run() {
                    self.rinnova(host.now_unix_millis());
                }
                Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
                    ns: NS_PRESENZA.into(),
                    payload: json!({ "ttl_ms": TTL_PRESENZA_MS, "renew_ms": RINNOVO_PRESENZA_MS }),
                }))
            }
            PDF_PROFILES => profili(args, host),
            PDF_PROFILE_SAVE => salva_profilo(args, mode, host),
            PDF_PROFILE_COPY => copia_profilo(args, mode, host),
            PDF_PROFILE_RENAME => rinomina_profilo(args, mode, host),
            PDF_PROFILE_DEFAULT => imposta_predefinito(args, mode, host),
            _ => self.interno.invoke(command, args, mode, host),
        }
    }
}

impl<P> ConIlComando<P> {
    fn esporta(
        &self,
        args: Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let letti = Args::new(&args);
        let nota = nota_scritta(&letti, &*host)?
            .ok_or_else(|| PluginError::BadArgs(Text::key(T_NOTE_DESC)))?;
        // La nota c'è (un `NotFound` dell'host dice già quale manca) ed è una
        // nota Markdown, la sola che la vista sa impaginare.
        host.document_revision(&nota)?;
        if !markdown(&nota) {
            return Err(PluginError::BadArgs(con_doc(E_NOTE, &nota)));
        }
        let scelto = profilo_per(host, &nota, letti.text(P_PROFILE).unwrap_or_default())?;
        let target = match letti
            .text(P_TARGET)
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(scritto) => destinazione(scritto)?,
            None => destinazione(&pdf_accanto(&nota))?,
        };
        let replace = letti.flag(P_REPLACE, false);
        if !replace {
            match host.document_revision(&target) {
                Ok(_) => {
                    return Err(PluginError::AlreadyExists(Text::message(
                        "e_pdf_target_taken",
                        vec![Arg::text("doc", target.as_str())],
                    )))
                }
                Err(PluginError::NotFound(_)) => {}
                Err(altro) => return Err(altro),
            }
        }
        // Prima di ogni effetto, anche in prova: senza una shell che impagina
        // la richiesta non andrebbe da nessuna parte.
        if !self.shell_presente(host.now_unix_millis()) {
            return Err(PluginError::Unserved(Text::key(E_NEEDS_APP)));
        }
        let nome = scelto.profilo.nome.clone();
        if mode.is_dry_run() {
            let plan = CommandPlan::of_edits(
                Text::message(
                    PLAN_EXPORT,
                    vec![
                        Arg::text("doc", nota.as_str()),
                        Arg::text("target", target.as_str()),
                        Arg::text("profile", nome.as_str()),
                    ],
                ),
                Vec::new(),
            )
            .with_doc(target);
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        let numero = self.richieste.fetch_add(1, Ordering::Relaxed) + 1;
        let richiesta = format!("{}-{numero}", host.now_unix_millis());
        let profilo_json = serde_json::to_value(&scelto.profilo)
            .map_err(|_| PluginError::Internal(Text::key(E_PROFILE_JSON)))?;
        host.emit(Event::Custom {
            topic: TOPIC_RICHIESTA.into(),
            payload: json!({
                "request": richiesta,
                "note": nota.as_str(),
                "target": target.as_str(),
                "replace": replace,
                "profile_id": scelto.id.as_ref().map(IdProfilo::as_str).unwrap_or(""),
                "profile": profilo_json,
            }),
        });
        Ok(CommandOutcome::notify(Text::message(
            D_REQUESTED,
            vec![
                Arg::text("doc", nota.as_str()),
                Arg::text("target", target.as_str()),
            ],
        ))
        .with_effect(CommandEffect::Custom {
            ns: NS_RICHIESTA.into(),
            payload: json!({
                "request": richiesta,
                "note": nota.as_str(),
                "target": target.as_str(),
                "profile": {
                    "id": scelto.id.as_ref().map(IdProfilo::as_str).unwrap_or(""),
                    "name": nome,
                    "from": scelto.origine.come_testo(),
                    "future": scelto.profilo.futuro(),
                },
            }),
        }))
    }
}

/// Le spec dei comandi di questo modulo, una sola volta per l'elenco e i test.
pub(crate) fn specs_dei_comandi() -> Vec<CommandSpec> {
    let testo = |nome: &str, titolo: &str, desc: &str| {
        ParamSpec::new(nome, Text::key(titolo), ParamKind::Text).describing(Text::key(desc))
    };
    vec![
        CommandSpec::new(PDF_EXPORT_NOTE, Text::key(T_EXPORT))
            .describing(Text::key(T_EXPORT_DESC))
            .with_param(
                ParamSpec::new(P_NOTE, Text::key(T_NOTE), ParamKind::Document)
                    .describing(Text::key(T_NOTE_DESC))
                    .required(),
            )
            .with_param(testo(P_PROFILE, T_PROFILE, T_PROFILE_DESC))
            .with_param(testo(P_TARGET, T_TARGET, T_TARGET_DESC))
            .with_param(
                ParamSpec::new(P_REPLACE, Text::key(T_REPLACE), ParamKind::Bool)
                    .describing(Text::key(T_REPLACE_DESC)),
            )
            .with_scope(CommandScope::writing(CommandReach::Document)),
        CommandSpec::new(PDF_EXPORT_LISTEN, Text::key(T_LISTEN))
            .describing(Text::key(T_LISTEN_DESC)),
        CommandSpec::new(PDF_PROFILES, Text::key(T_PROFILES))
            .describing(Text::key(T_PROFILES_DESC))
            .with_param(
                ParamSpec::new(P_NOTE, Text::key(T_NOTE), ParamKind::Document)
                    .describing(Text::key(T_NOTE_DESC)),
            ),
        CommandSpec::new(PDF_PROFILE_SAVE, Text::key(T_SAVE))
            .describing(Text::key(T_SAVE_DESC))
            .with_param(testo(P_ID, T_ID, T_SAVE_ID_DESC))
            .with_param(testo(P_PROFILE, T_JSON, T_JSON_DESC).required())
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(PDF_PROFILE_COPY, Text::key(T_COPY))
            .describing(Text::key(T_COPY_DESC))
            .with_param(testo(P_ID, T_ID, T_ID_DESC).required())
            .with_param(testo(P_NAME, T_NAME, T_NAME_DESC).required())
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(PDF_PROFILE_RENAME, Text::key(T_RENAME))
            .describing(Text::key(T_RENAME_DESC))
            .with_param(testo(P_ID, T_ID, T_ID_DESC).required())
            .with_param(testo(P_NAME, T_NAME, T_NAME_DESC).required())
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(PDF_PROFILE_DEFAULT, Text::key(T_DEFAULT))
            .describing(Text::key(T_DEFAULT_DESC))
            .with_param(testo(P_ID, T_ID, T_DEFAULT_ID_DESC))
            .with_param(
                ParamSpec::new(
                    P_SCOPE,
                    Text::key(T_SCOPE),
                    ParamKind::Choice(vec![
                        fub_abi::command::Choice::new(SCOPE_VAULT, Text::key(T_SCOPE_VAULT)),
                        fub_abi::command::Choice::new(SCOPE_TYPE, Text::key(T_SCOPE_TYPE)),
                    ]),
                )
                .describing(Text::key(T_SCOPE_DESC)),
            )
            .with_param(
                ParamSpec::new(P_NOTE, Text::key(T_NOTE), ParamKind::Document)
                    .describing(Text::key(T_DEFAULT_NOTE_DESC)),
            )
            .with_scope(CommandScope::writing(CommandReach::Settings)),
    ]
}

// --- quale profilo ------------------------------------------------------------

/// Da dove viene il profilo che vale.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origine {
    /// Nominato da chi esporta.
    Scelto,
    /// Il predefinito del tipo della nota.
    Tipo,
    /// Il predefinito del vault.
    Vault,
    /// Nessun predefinito: «Di serie».
    DiSerie,
}

impl Origine {
    pub fn come_testo(self) -> &'static str {
        match self {
            Self::Scelto => "chosen",
            Self::Tipo => "type",
            Self::Vault => "vault",
            Self::DiSerie => "default",
        }
    }
}

/// Il profilo che vale per un'esportazione: l'id (`None` per «Di serie»),
/// il profilo letto e da dove viene.
#[derive(Clone, Debug, PartialEq)]
pub struct ProfiloScelto {
    pub id: Option<IdProfilo>,
    pub profilo: Profilo,
    pub origine: Origine,
}

impl ProfiloScelto {
    fn di_serie() -> Self {
        Self {
            id: None,
            profilo: Profilo::di_serie(),
            origine: Origine::DiSerie,
        }
    }
}

/// Il profilo per esportare `nota`: quello nominato, o i predefiniti.
///
/// `richiesto` è l'id o il nome di un profilo; vuoto (o «Di serie») lascia
/// decidere ai predefiniti.
pub fn profilo_per(
    host: &dyn ReadApi,
    nota: &DocId,
    richiesto: &str,
) -> Result<ProfiloScelto, PluginError> {
    let richiesto = richiesto.trim();
    if !richiesto.is_empty() {
        if resolution_key(richiesto) == resolution_key(NOME_DI_SERIE) {
            let mut scelto = ProfiloScelto::di_serie();
            scelto.origine = Origine::Scelto;
            return Ok(scelto);
        }
        let id = trova_profilo(host, richiesto)?;
        let profilo = profile::leggi(host, &id).map_err(errore_profilo)?;
        return Ok(ProfiloScelto {
            id: Some(id),
            profilo,
            origine: Origine::Scelto,
        });
    }
    if let Some(tipo) = tipo_della_nota(host, nota) {
        if let Some(scelto) = dal_predefinito(host, &percorso_tipo(&tipo), Origine::Tipo) {
            return Ok(scelto);
        }
    }
    if let Some(scelto) = dal_predefinito(host, FILE_PREDEFINITO, Origine::Vault) {
        return Ok(scelto);
    }
    Ok(ProfiloScelto::di_serie())
}

/// L'id di un profilo dato per id o, se nessun file ha quell'id, per nome.
fn trova_profilo(host: &dyn DataRead, richiesto: &str) -> Result<IdProfilo, PluginError> {
    let voci = profile::elenca(host).map_err(errore_profilo)?;
    if let Some(voce) = voci.iter().find(|voce| voce.id.as_str() == richiesto) {
        return Ok(voce.id.clone());
    }
    let chiave = resolution_key(richiesto);
    voci.into_iter()
        .find(|voce| {
            voce.esito
                .as_ref()
                .is_ok_and(|p| resolution_key(&p.nome) == chiave)
        })
        .map(|voce| voce.id)
        .ok_or_else(|| {
            PluginError::NotFound(Text::message(
                E_PROFILE_MISSING,
                vec![Arg::text("profile", richiesto)],
            ))
        })
}

/// Il profilo a cui punta un predefinito, se il file c'è, si legge e il
/// profilo pure: un predefinito rotto o un profilo sparito lasciano decidere
/// al livello dopo.
fn dal_predefinito(host: &dyn DataRead, percorso: &str, origine: Origine) -> Option<ProfiloScelto> {
    let id = leggi_predefinito(host, percorso).ok()??.profilo;
    let profilo = profile::leggi(host, &id).ok()?;
    Some(ProfiloScelto {
        id: Some(id),
        profilo,
        origine,
    })
}

/// La nota del tipo di `nota`, se la nota ne ha uno che Fub trova.
fn tipo_della_nota(host: &dyn ReadApi, nota: &DocId) -> Option<DocId> {
    let model = host.read_model(nota).ok()?;
    match note_types::state_of(host, &model).ok()? {
        TypeState::Typed(tipo) => Some(tipo.reference.doc),
        _ => None,
    }
}

/// Il PDF accanto alla nota, col suo nome: `Cartella/Nota.md` →
/// `Cartella/Nota.pdf`.
fn pdf_accanto(nota: &DocId) -> String {
    let percorso = nota.as_str();
    let nome = percorso.rsplit('/').next().unwrap_or(percorso);
    let stelo = nome.rsplit_once('.').map_or(nome, |(stelo, _)| stelo);
    let cartella = &percorso[..percorso.len() - nome.len()];
    format!("{cartella}{stelo}{PDF}")
}

// --- i predefiniti ------------------------------------------------------------

/// Il file di un predefinito: a quale profilo punta.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Predefinito {
    pub versione: u32,
    pub profilo: IdProfilo,
    /// Ciò che una versione più nuova avrà aggiunto: si conserva.
    #[serde(flatten)]
    pub altro: Map<String, Value>,
}

/// Il path del predefinito del tipo che ha per nota `tipo`.
pub fn percorso_tipo(tipo: &DocId) -> String {
    doc_data::path(tipo, NOME_PREDEFINITO_TIPO)
}

/// Il predefinito scritto in `percorso`, se c'è. Un file illeggibile è un
/// errore di chi lo legge; chi esporta lo salta.
pub fn leggi_predefinito(
    host: &dyn DataRead,
    percorso: &str,
) -> Result<Option<Predefinito>, PluginError> {
    let Some(byte) = host.data_read(percorso)? else {
        return Ok(None);
    };
    if byte.len() > MAX_PREDEFINITO_BYTE {
        return Err(PluginError::BadArgs(Text::key(E_PROFILE_JSON)));
    }
    serde_json::from_slice::<Predefinito>(&byte)
        .map(Some)
        .map_err(|_| PluginError::BadArgs(Text::key(E_PROFILE_JSON)))
}

/// Scrive (o toglie, con `None`) il predefinito in `percorso`. Non riscrive un
/// predefinito di una versione più nuova; una scrittura che non riesce lascia
/// quello di prima.
pub fn scrivi_predefinito(
    host: &mut dyn DataWrite,
    percorso: &str,
    profilo: Option<&IdProfilo>,
) -> Result<(), PluginError> {
    if let Ok(Some(attuale)) = leggi_predefinito(host, percorso) {
        if attuale.versione > VERSIONE_PREDEFINITO {
            return Err(PluginError::BadArgs(Text::key(E_DEFAULT_FUTURE)));
        }
    }
    let Some(id) = profilo else {
        return host.data_remove(percorso);
    };
    let file = Predefinito {
        versione: VERSIONE_PREDEFINITO,
        profilo: id.clone(),
        altro: Map::new(),
    };
    let mut byte = serde_json::to_vec_pretty(&file)
        .map_err(|_| PluginError::Internal(Text::key(E_PROFILE_JSON)))?;
    byte.push(b'\n');
    host.data_write(percorso, &byte)
}

// --- i comandi dei profili ------------------------------------------------------

fn dati(ns: &str, payload: Value) -> CommandOutcome {
    CommandOutcome::done().with_effect(CommandEffect::Custom {
        ns: ns.into(),
        payload,
    })
}

/// `pdf.profiles`: l'elenco, i predefiniti e, per una nota, il suo tipo e il
/// profilo che vale. Legge soltanto: in prova risponde uguale.
fn profili(args: Value, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let voci = profile::elenca(&*host).map_err(errore_profilo)?;
    let elenco: Vec<Value> = voci
        .iter()
        .map(|voce| match &voce.esito {
            Ok(profilo) => json!({
                "id": voce.id.as_str(),
                "name": profilo.nome,
                "same_name": voce.stesso_nome,
                "future": profilo.futuro(),
                "profile": profilo,
                "error": null,
            }),
            Err(errore) => json!({
                "id": voce.id.as_str(),
                "name": voce.id.as_str(),
                "same_name": false,
                "future": false,
                "profile": null,
                "error": errore,
            }),
        })
        .collect();
    let del_vault = leggi_predefinito(&*host, FILE_PREDEFINITO)
        .ok()
        .flatten()
        .map(|p| p.profilo.0);
    let mut payload = json!({
        "profiles": elenco,
        "default_name": NOME_DI_SERIE,
        "vault_default": del_vault,
        "note_type": null,
        "type_default": null,
        "effective": null,
    });
    if let Some(nota) = nota_scritta(&letti, &*host)? {
        if let Some(tipo) = tipo_della_nota(&*host, &nota) {
            let del_tipo = leggi_predefinito(&*host, &percorso_tipo(&tipo))
                .ok()
                .flatten()
                .map(|p| p.profilo.0);
            payload["note_type"] = json!({ "doc": tipo.as_str(), "name": tipo.page_name() });
            payload["type_default"] = json!(del_tipo);
        }
        let scelto = profilo_per(&*host, &nota, "")?;
        payload["effective"] = json!({
            "id": scelto.id.as_ref().map(IdProfilo::as_str).unwrap_or(""),
            "from": scelto.origine.come_testo(),
        });
    }
    Ok(dati(NS_PROFILI, payload))
}

fn id_da(args: &Args<'_>) -> Result<IdProfilo, PluginError> {
    let id = IdProfilo(args.text(P_ID).unwrap_or_default().trim().to_owned());
    if !id.valido() {
        return Err(PluginError::BadArgs(Text::message(
            E_PROFILE_ID,
            vec![Arg::text("profile", id.as_str())],
        )));
    }
    Ok(id)
}

fn piano_profilo(nome: &str) -> CommandOutcome {
    let plan = CommandPlan::of_edits(
        Text::message(PLAN_PROFILE, vec![Arg::text("name", nome)]),
        Vec::new(),
    );
    CommandOutcome::done().with_effect(CommandEffect::Plan(plan))
}

fn salvato(id: &IdProfilo, nome: &str) -> CommandOutcome {
    CommandOutcome::notify(Text::message(D_SAVED, vec![Arg::text("name", nome)])).with_effect(
        CommandEffect::Custom {
            ns: NS_PROFILO.into(),
            payload: json!({ "id": id.as_str(), "name": nome }),
        },
    )
}

/// `pdf.profile_save`: il profilo dal suo JSON, sopra `id` o nuovo.
fn salva_profilo(
    args: Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let mut valore: Value = serde_json::from_str(letti.text(P_PROFILE).unwrap_or_default())
        .map_err(|_| PluginError::BadArgs(Text::key(E_PROFILE_JSON)))?;
    // La vista tiene il profilo senza la versione del file: è quella di oggi.
    if let Some(oggetto) = valore.as_object_mut() {
        oggetto.entry("versione").or_insert(json!(VERSIONE_PROFILO));
    }
    let profilo: Profilo = serde_json::from_value(valore)
        .map_err(|_| PluginError::BadArgs(Text::key(E_PROFILE_JSON)))?;
    let nome = profilo.nome.trim().to_owned();
    let esistente = letti.text(P_ID).map(str::trim).filter(|id| !id.is_empty());
    if mode.is_dry_run() {
        return Ok(piano_profilo(&nome));
    }
    let id = match esistente {
        Some(_) => {
            let id = id_da(&letti)?;
            profile::salva(host, &id, &profilo).map_err(errore_profilo)?;
            id
        }
        None => profile::crea(host, &profilo).map_err(errore_profilo)?,
    };
    Ok(salvato(&id, &nome))
}

/// `pdf.profile_copy`: una copia con un nome nuovo, anche di un profilo futuro.
fn copia_profilo(
    args: Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let id = id_da(&letti)?;
    let nome = letti.text(P_NAME).unwrap_or_default().trim().to_owned();
    if mode.is_dry_run() {
        return Ok(piano_profilo(&nome));
    }
    let nuovo = profile::copia(host, &id, &nome).map_err(errore_profilo)?;
    Ok(salvato(&nuovo, &nome))
}

/// `pdf.profile_rename`: il nome cambia, il file resta.
fn rinomina_profilo(
    args: Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let id = id_da(&letti)?;
    let nome = letti.text(P_NAME).unwrap_or_default().trim().to_owned();
    if mode.is_dry_run() {
        return Ok(piano_profilo(&nome));
    }
    profile::rinomina(host, &id, &nome).map_err(errore_profilo)?;
    Ok(salvato(&id, &nome))
}

/// `pdf.profile_default`: il predefinito del vault o del tipo di una nota;
/// un id vuoto lo toglie (torna «Di serie»).
fn imposta_predefinito(
    args: Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let scritto = letti.text(P_ID).unwrap_or_default().trim();
    let id = if scritto.is_empty() {
        None
    } else {
        let id = id_da(&letti)?;
        // Il predefinito punta solo a un profilo che c'è e si legge.
        profile::leggi(&*host, &id).map_err(errore_profilo)?;
        Some(id)
    };
    let percorso = if letti.text(P_SCOPE) == Some(SCOPE_TYPE) {
        let nota = nota_scritta(&letti, &*host)?
            .ok_or_else(|| PluginError::BadArgs(Text::key(T_DEFAULT_NOTE_DESC)))?;
        let tipo = tipo_della_nota(&*host, &nota)
            .ok_or_else(|| PluginError::BadArgs(con_doc(E_DEFAULT_TYPE, &nota)))?;
        percorso_tipo(&tipo)
    } else {
        FILE_PREDEFINITO.to_owned()
    };
    let nome = match &id {
        Some(id) => profile::leggi(&*host, id)
            .map(|p| p.nome)
            .unwrap_or_else(|_| id.0.clone()),
        None => NOME_DI_SERIE.to_owned(),
    };
    if mode.is_dry_run() {
        return Ok(piano_profilo(&nome));
    }
    scrivi_predefinito(host, &percorso, id.as_ref())?;
    let testo = match &id {
        Some(_) => Text::message(D_DEFAULT, vec![Arg::text("name", nome.as_str())]),
        None => Text::key(D_DEFAULT_OFF),
    };
    Ok(CommandOutcome::notify(testo).with_effect(CommandEffect::Custom {
        ns: NS_PROFILO.into(),
        payload: json!({ "id": id.as_ref().map(IdProfilo::as_str).unwrap_or(""), "name": nome }),
    }))
}

fn con_doc(chiave: &str, doc: &DocId) -> Text {
    Text::message(chiave, vec![Arg::text("doc", doc.as_str())])
}

/// Una nota Markdown, la sola che la vista sa impaginare.
fn markdown(doc: &DocId) -> bool {
    doc.as_str().to_ascii_lowercase().ends_with(".md")
}

/// La nota del campo «Nota», scelta dall'elenco o scritta per nome, fra le
/// sole note Markdown: un PDF o un foglio che si chiamano uguale non rendono il
/// nome ambiguo (`docs/reference/document-by-name.md`).
pub(super) fn nota_scritta(
    args: &Args<'_>,
    host: &(impl VaultRead + ?Sized),
) -> Result<Option<DocId>, PluginError> {
    crate::formats::document_named_by(args, P_NOTE, host, markdown)
}

/// L'errore di un profilo come lo vede chi ha chiesto: tipato, con un testo
/// che dice che cosa fare.
fn errore_profilo(errore: ErroreProfilo) -> PluginError {
    let con_id = |chiave: &str, id: &IdProfilo| {
        Text::message(chiave, vec![Arg::text("profile", id.as_str())])
    };
    match errore {
        ErroreProfilo::NonTrovato { id } => PluginError::NotFound(con_id(E_PROFILE_MISSING, &id)),
        ErroreProfilo::IdNonValido { id } => PluginError::BadArgs(con_id(E_PROFILE_ID, &id)),
        ErroreProfilo::Illeggibile { id, .. } => {
            PluginError::BadArgs(con_id(E_PROFILE_UNREADABLE, &id))
        }
        ErroreProfilo::TroppoGrande { id, .. } => {
            PluginError::BadArgs(con_id(E_PROFILE_TOO_BIG, &id))
        }
        ErroreProfilo::Futuro { id, .. } => PluginError::Conflict(con_id(E_PROFILE_FUTURE, &id)),
        ErroreProfilo::NomeVuoto => PluginError::BadArgs(Text::key(E_PROFILE_NAME_EMPTY)),
        ErroreProfilo::NomeTroppoLungo => PluginError::BadArgs(Text::message(
            E_PROFILE_NAME_LONG,
            vec![Arg::int("max", MAX_NOME as i64)],
        )),
        ErroreProfilo::NomeGiaUsato { nome, .. } => PluginError::AlreadyExists(Text::message(
            E_PROFILE_NAME_TAKEN,
            vec![Arg::text("name", nome)],
        )),
        ErroreProfilo::Archivio { causa } => causa,
    }
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;
