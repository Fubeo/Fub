//! Adattatori di tipi verso i guest compilati contro `fub:abi@0.1.2`.
//!
//! Stato reale: il ponte non è cablato nel caricatore. `Component::load`
//! cerca solo gli export `fub:abi/<famiglia>@0.2.0` via `GuestIndices::new`
//! e `instantiate` li rilegge dal vivo, quindi un guest che esporta solo
//! `fub:abi/plugin@0.1.2` cade con `NotAPlugin`. Le funzioni qui sotto
//! restano adattatori puri fra tipi legacy e tipi correnti, non un percorso
//! di mount: nessuna di esse è chiamata da `component.rs`, `installed.rs`
//! o `managed.rs`.
//!
//! La compatibilità semver resta quella di
//! `fub_abi::traits::abi_compatible` (minor del guest `<=` minor
//! dell'host a parità di major): `0.1.2` passa su host `0.2.0`, `0.3.0` e
//! `99.0.0` restano rifiutati a livello di manifest.

use fub_abi::PluginError;
use wasmtime::component::HasSelf;

use crate::borrow::State;
use crate::translate as tr;

/// I binding **lato host** del mondo legacy, generati dal WIT congelato in
/// `wit-legacy/abi-0.1.2.wit` (copia byte-esatta di
/// `/tmp/fub-feature-smoke-syul4em1/abi-head-0.1.2.wit`, package
/// `fub:abi@0.1.2`, 203602 byte).
///
/// Il generato non si documenta: la documentazione del contratto sta nel WIT.
#[allow(missing_docs)]
pub mod contract_01 {
    wasmtime::component::bindgen!({
        path: "wit-legacy/abi-0.1.2.wit",
        world: "plugin-world",
    });
}

use contract_01::exports::fub::abi::{format as legacy_x_format, plugin as legacy_x_plugin};
use contract_01::fub::abi::{
    errors as legacy_errors, events as legacy_events, format as legacy_format,
    host_data_read as legacy_data_read, host_data_write as legacy_data_write,
    host_env as legacy_env, host_events as legacy_host_events, host_vault_read as legacy_vault,
    index as legacy_index, intl as legacy_intl, jobs as legacy_jobs, model as legacy_model,
    options as legacy_options, session as legacy_session, settings as legacy_settings,
    text as legacy_text,
};

/// Le sole famiglie che l'host serve, viste dai guest `0.1.2`.
///
/// Cinque voci e non una di più: `host-env`, `host-vault-read`,
/// `host-data-read`, `host-data-write`, `host-events`. Ogni altra famiglia che
/// un guest legacy importasse resta non linkata e wasmtime nomina la funzione
/// che manca, come per il vivo. La coppia è `(nome-legacy, nome-vivo)`.
pub(crate) const LEGACY_HOST_ALIASES: &[(&str, &str)] = &[
    ("fub:abi/host-env@0.1.2", "fub:abi/host-env@0.2.0"),
    (
        "fub:abi/host-vault-read@0.1.2",
        "fub:abi/host-vault-read@0.2.0",
    ),
    (
        "fub:abi/host-data-read@0.1.2",
        "fub:abi/host-data-read@0.2.0",
    ),
    (
        "fub:abi/host-data-write@0.1.2",
        "fub:abi/host-data-write@0.2.0",
    ),
    (
        "fub:abi/host-events@0.1.2",
        "fub:abi/host-events@0.2.0",
    ),
];

/// Candidati di probing per un'interfaccia esportata, in ordine deterministico.
///
/// `[canonico-0.2.0, legacy-0.1.2, non-versionato]`: il vivo vincerebbe quando
/// c'è, il legacy passerebbe quando è l'unico. Stato reale: nessun chiamante
/// nel caricatore; resta il disegno del probing da applicare quando il ponte
/// verrà cablato.
pub(crate) fn legacy_export_candidates(interface: &str) -> Vec<String> {
    vec![
        format!("{interface}@0.2.0"),
        format!("{interface}@0.1.2"),
        interface.to_string(),
    ]
}

/// Un export nomina questa interfaccia in una versione che l'host serve?
///
/// `true` per il nome non-versionato e per `interfaccia@X.Y.Z` quando
/// `abi_compatible(X.Y.Z)` passa su host `0.2.0` (`0.1.2` sì, `0.3.0` e
/// `99.0.0` no). La parte versione deve essere semver completa e canonica a
/// tre numeri, come in `component.rs`: niente `0.1`, niente `0.1.x`, niente
/// suffissi.
pub(crate) fn is_compat_export(name: &str, interface: &str) -> bool {
    if name == interface {
        return true;
    }
    let Some(version) = name
        .strip_prefix(interface)
        .and_then(|rest| rest.strip_prefix('@'))
    else {
        return false;
    };
    let complete = version.split('.').count() == 3
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    complete && fub_abi::traits::abi_compatible(version)
}

/// Registra le cinque famiglie servite anche sotto i nomi `@0.1.2`.
///
/// Riusa le stesse `impl State` del vivo. Stato reale: nessun chiamante in
/// `Component::load`; finché resta così, un guest che importa solo
/// `fub:abi/host-env@0.1.2` non si istanzia.
pub(crate) fn add_legacy_aliases(linker: &mut wasmtime::component::Linker<crate::borrow::State>) -> wasmtime::Result<()> {
    legacy_env::add_to_linker::<State, HasSelf<State>>(linker, |state| state)?;
    legacy_vault::add_to_linker::<State, HasSelf<State>>(linker, |state| state)?;
    legacy_data_read::add_to_linker::<State, HasSelf<State>>(linker, |state| state)?;
    legacy_data_write::add_to_linker::<State, HasSelf<State>>(linker, |state| state)?;
    legacy_host_events::add_to_linker::<State, HasSelf<State>>(linker, |state| state)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Errori e testo: la base di ogni altra conversione
// ---------------------------------------------------------------------------

fn legacy_text_from_abi(text: &fub_abi::text::Text) -> legacy_text::Text {
    match text {
        fub_abi::text::Text::Literal(value) => legacy_text::Text::Literal(value.clone()),
        fub_abi::text::Text::Message(message) => legacy_text::Text::Message(legacy_text::Message {
            key: message.key.clone(),
            args: message.args.iter().map(legacy_arg_from_abi).collect(),
        }),
    }
}

fn legacy_arg_from_abi(arg: &fub_abi::text::Arg) -> legacy_text::Arg {
    legacy_text::Arg {
        name: arg.name.clone(),
        value: match &arg.value {
            fub_abi::text::ArgValue::Text(value) => legacy_text::ArgValue::Text(value.clone()),
            fub_abi::text::ArgValue::Int(value) => legacy_text::ArgValue::Int(*value),
            fub_abi::text::ArgValue::Float(value) => legacy_text::ArgValue::Float(*value),
            fub_abi::text::ArgValue::Timestamp(value) => {
                legacy_text::ArgValue::Timestamp(*value)
            }
        },
    }
}

fn legacy_error_from_abi(error: &PluginError) -> legacy_errors::PluginError {
    use legacy_errors::PluginError as Legacy;
    match error {
        PluginError::UnknownCommand(text) => Legacy::UnknownCommand(legacy_text_from_abi(text)),
        PluginError::UnknownView(text) => Legacy::UnknownView(legacy_text_from_abi(text)),
        PluginError::UnknownJob(text) => Legacy::UnknownJob(legacy_text_from_abi(text)),
        PluginError::BadArgs(text) => Legacy::BadArgs(legacy_text_from_abi(text)),
        PluginError::PermissionDenied(text) => {
            Legacy::PermissionDenied(legacy_text_from_abi(text))
        }
        PluginError::Internal(text) => Legacy::Internal(legacy_text_from_abi(text)),
        PluginError::Conflict(text) => Legacy::Conflict(legacy_text_from_abi(text)),
        PluginError::Unserved(text) => Legacy::Unserved(legacy_text_from_abi(text)),
        PluginError::Cancelled(text) => Legacy::Cancelled(legacy_text_from_abi(text)),
        PluginError::NotFound(text) => Legacy::NotFound(legacy_text_from_abi(text)),
        PluginError::AlreadyExists(text) => Legacy::AlreadyExists(legacy_text_from_abi(text)),
        PluginError::Io(text) => Legacy::Io(legacy_text_from_abi(text)),
    }
}

fn abi_text_from_legacy(text: legacy_text::Text) -> fub_abi::text::Text {
    match text {
        legacy_text::Text::Literal(value) => fub_abi::text::Text::Literal(value),
        legacy_text::Text::Message(message) => fub_abi::text::Text::Message(fub_abi::text::Message {
            key: message.key,
            args: message.args.into_iter().map(abi_arg_from_legacy).collect(),
        }),
    }
}

fn abi_arg_from_legacy(arg: legacy_text::Arg) -> fub_abi::text::Arg {
    fub_abi::text::Arg {
        name: arg.name,
        value: match arg.value {
            legacy_text::ArgValue::Text(value) => fub_abi::text::ArgValue::Text(value),
            legacy_text::ArgValue::Int(value) => fub_abi::text::ArgValue::Int(value),
            legacy_text::ArgValue::Float(value) => fub_abi::text::ArgValue::Float(value),
            legacy_text::ArgValue::Timestamp(value) => {
                fub_abi::text::ArgValue::Timestamp(value)
            }
        },
    }
}

fn abi_error_from_legacy(error: legacy_errors::PluginError) -> PluginError {
    match error {
        legacy_errors::PluginError::UnknownCommand(text) => {
            PluginError::UnknownCommand(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::UnknownView(text) => {
            PluginError::UnknownView(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::UnknownJob(text) => {
            PluginError::UnknownJob(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::BadArgs(text) => {
            PluginError::BadArgs(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::PermissionDenied(text) => {
            PluginError::PermissionDenied(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::Internal(text) => {
            PluginError::Internal(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::Conflict(text) => {
            PluginError::Conflict(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::Unserved(text) => {
            PluginError::Unserved(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::Cancelled(text) => {
            PluginError::Cancelled(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::NotFound(text) => {
            PluginError::NotFound(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::AlreadyExists(text) => {
            PluginError::AlreadyExists(abi_text_from_legacy(text))
        }
        legacy_errors::PluginError::Io(text) => PluginError::Io(abi_text_from_legacy(text)),
    }
}

// ---------------------------------------------------------------------------
// Locale, sessione, span: host -> guest (il vivo calcola, il legacy copia)
// ---------------------------------------------------------------------------

fn legacy_weekday_from_abi(day: fub_abi::locale::Weekday) -> legacy_intl::Weekday {
    match day {
        fub_abi::locale::Weekday::Monday => legacy_intl::Weekday::Monday,
        fub_abi::locale::Weekday::Tuesday => legacy_intl::Weekday::Tuesday,
        fub_abi::locale::Weekday::Wednesday => legacy_intl::Weekday::Wednesday,
        fub_abi::locale::Weekday::Thursday => legacy_intl::Weekday::Thursday,
        fub_abi::locale::Weekday::Friday => legacy_intl::Weekday::Friday,
        fub_abi::locale::Weekday::Saturday => legacy_intl::Weekday::Saturday,
        fub_abi::locale::Weekday::Sunday => legacy_intl::Weekday::Sunday,
    }
}

fn legacy_locale_from_abi(locale: &fub_abi::locale::Locale) -> legacy_intl::Locale {
    legacy_intl::Locale {
        language: locale.language.clone(),
        timezone: locale.timezone.clone(),
        utc_offset_minutes: locale.utc_offset_minutes,
        first_day_of_week: legacy_weekday_from_abi(locale.first_day_of_week),
        hour_cycle: match locale.hour_cycle {
            fub_abi::locale::HourCycle::H23 => legacy_intl::HourCycle::H23,
            fub_abi::locale::HourCycle::H12 => legacy_intl::HourCycle::H12,
        },
    }
}

fn legacy_span_from_abi(span: fub_abi::model::Span) -> legacy_model::Span {
    legacy_model::Span {
        start: span.start as u64,
        end: span.end as u64,
    }
}

fn legacy_view_context_from_abi(
    context: &fub_abi::session::ViewContext,
) -> legacy_session::ViewContext {
    legacy_session::ViewContext {
        pane: context.pane.0.clone(),
        doc: context.doc.as_ref().map(|id| id.0.clone()),
        selections: context.selections.as_ref().map(legacy_selections_from_abi),
        mode: match context.mode {
            fub_abi::session::PaneMode::Source => legacy_session::PaneMode::Source,
            fub_abi::session::PaneMode::LivePreview => legacy_session::PaneMode::LivePreview,
            fub_abi::session::PaneMode::Reading => legacy_session::PaneMode::Reading,
        },
    }
}

fn legacy_selections_from_abi(
    selections: &fub_abi::session::SelectionSet,
) -> legacy_session::SelectionSet {
    match selections {
        fub_abi::session::SelectionSet::Anchored(anchored) => {
            legacy_session::SelectionSet::Anchored(legacy_session::AnchoredSelections {
                primary: legacy_anchored_from_abi(&anchored.primary),
                secondary: anchored
                    .secondary
                    .iter()
                    .map(legacy_anchored_from_abi)
                    .collect(),
            })
        }
        fub_abi::session::SelectionSet::Floating(floating) => {
            legacy_session::SelectionSet::Floating(legacy_session::FloatingSelections {
                primary: legacy_floating_from_abi(&floating.primary),
                secondary: floating
                    .secondary
                    .iter()
                    .map(legacy_floating_from_abi)
                    .collect(),
            })
        }
    }
}

fn legacy_anchored_from_abi(
    selection: &fub_abi::session::AnchoredSelection,
) -> legacy_session::AnchoredSelection {
    legacy_session::AnchoredSelection {
        span: legacy_span_from_abi(selection.span),
        text: selection.text.clone(),
    }
}

fn legacy_floating_from_abi(
    selection: &fub_abi::session::FloatingSelection,
) -> legacy_session::FloatingSelection {
    legacy_session::FloatingSelection {
        text: selection.text.clone(),
    }
}

// ---------------------------------------------------------------------------
// Le cinque famiglie sotto i nomi @0.1.2: stesse capacità, stessi rifiuti
// ---------------------------------------------------------------------------

impl legacy_env::Host for State {
    fn now_unix_millis(&mut self) -> u64 {
        self.reader().map(|host| host.now_unix_millis()).unwrap_or(0)
    }

    fn user_locale(&mut self) -> legacy_intl::Locale {
        let locale = self.reader().map(|host| host.user_locale()).unwrap_or_default();
        legacy_locale_from_abi(&locale)
    }

    fn random_bytes(&mut self, n: u32) -> Result<Vec<u8>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.random_bytes(n)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn active_context(&mut self) -> Option<legacy_session::ViewContext> {
        self.reader()
            .ok()
            .and_then(|host| host.active_context())
            .as_ref()
            .map(legacy_view_context_from_abi)
    }
}

fn legacy_page_to_abi(page: Option<legacy_index::Page>) -> Option<fub_abi::traits::Page> {
    page.map(|page| fub_abi::traits::Page {
        offset: page.offset,
        limit: page.limit,
    })
}

fn legacy_doc_ids_page_from_abi(
    page: fub_abi::traits::Paged<fub_abi::model::DocId>,
) -> legacy_index::DocIdsPage {
    legacy_index::DocIdsPage {
        items: page.items.into_iter().map(|id| id.0).collect(),
        offset: page.offset,
        total: page.total,
    }
}

fn legacy_format_from_abi(
    format: &fub_abi::format::DocumentFormat,
) -> legacy_format::DocumentFormat {
    legacy_format::DocumentFormat {
        descriptor: legacy_format::FormatDescriptor {
            id: format.descriptor.id.clone(),
            name: format.descriptor.name.clone(),
            extensions: format.descriptor.extensions.clone(),
            source: match format.descriptor.source {
                fub_abi::format::SourceKind::Text => legacy_format::SourceKind::Text,
                fub_abi::format::SourceKind::Bytes => legacy_format::SourceKind::Bytes,
            },
        },
        capabilities: legacy_format::FormatCapabilities {
            syntax: format
                .capabilities
                .syntax
                .iter()
                .map(|(key, value)| legacy_options::OptionEntry {
                    key: key.to_string(),
                    value: value.to_string(),
                })
                .collect(),
        },
    }
}

fn legacy_trash_from_abi(entry: fub_abi::traits::TrashEntry) -> legacy_vault::TrashEntry {
    legacy_vault::TrashEntry {
        id: entry.id.0,
        original: entry.original.0,
        deleted_at: entry.deleted_at,
        size: entry.size,
    }
}

impl legacy_vault::Host for State {
    fn read_document(
        &mut self,
        id: String,
    ) -> Result<String, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.read_document(&fub_abi::model::DocId::new(id))
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn read_document_bytes(
        &mut self,
        id: String,
    ) -> Result<Vec<u8>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.read_document_bytes(&fub_abi::model::DocId::new(id))
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn document_revision(
        &mut self,
        id: String,
    ) -> Result<String, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.document_revision(&fub_abi::model::DocId::new(id))
            .map(|revision| revision.0)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn list_documents(
        &mut self,
        page: Option<legacy_index::Page>,
    ) -> Result<legacy_index::DocIdsPage, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.list_documents(legacy_page_to_abi(page))
            .map(legacy_doc_ids_page_from_abi)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn free_name(&mut self, id: String) -> String {
        match self.reader() {
            Ok(host) => host.free_name(&fub_abi::model::DocId::new(id)).0,
            Err(_) => id,
        }
    }

    fn read_model(
        &mut self,
        id: String,
    ) -> Result<legacy_model::DocumentModel, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        let model = host
            .read_model(&fub_abi::model::DocId::new(id))
            .map_err(|error| legacy_error_from_abi(&error))?;
        let current = crate::model::to_document(model)
            .map_err(|error| legacy_error_from_abi(&error))?;
        Ok(current_document_to_legacy(current))
    }

    fn format_of(&mut self, id: String) -> Option<legacy_format::DocumentFormat> {
        self.reader()
            .ok()
            .and_then(|host| host.format_of(&fub_abi::model::DocId::new(id)))
            .as_ref()
            .map(legacy_format_from_abi)
    }

    fn list_trash(
        &mut self,
    ) -> Result<Vec<legacy_vault::TrashEntry>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.list_trash()
            .map(|entries| entries.into_iter().map(legacy_trash_from_abi).collect())
            .map_err(|error| legacy_error_from_abi(&error))
    }
}

impl legacy_data_read::Host for State {
    fn data_read(
        &mut self,
        path: String,
    ) -> Result<Option<Vec<u8>>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.data_read(&path)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn data_list(
        &mut self,
        prefix: String,
    ) -> Result<Vec<String>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.data_list(&prefix)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn cache_read(
        &mut self,
        path: String,
    ) -> Result<Option<Vec<u8>>, legacy_errors::PluginError> {
        let host = match self.reader() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.cache_read(&path)
            .map_err(|error| legacy_error_from_abi(&error))
    }
}

impl legacy_data_write::Host for State {
    fn data_write(
        &mut self,
        path: String,
        bytes: Vec<u8>,
    ) -> Result<(), legacy_errors::PluginError> {
        let host = match self.writer() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.data_write(&path, &bytes)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn data_remove(&mut self, path: String) -> Result<(), legacy_errors::PluginError> {
        let host = match self.writer() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.data_remove(&path)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn cache_write(
        &mut self,
        path: String,
        bytes: Vec<u8>,
    ) -> Result<(), legacy_errors::PluginError> {
        let host = match self.writer() {
            Ok(host) => host,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        host.cache_write(&path, &bytes)
            .map_err(|error| legacy_error_from_abi(&error))
    }
}

// ---------------------------------------------------------------------------
// host-events legacy: stesso verso opposto, stesse tre porte
// ---------------------------------------------------------------------------

fn abi_doc_change_from_legacy(change: legacy_events::DocChange) -> fub_abi::event::DocChange {
    match change {
        legacy_events::DocChange::Body => fub_abi::event::DocChange::Body,
        legacy_events::DocChange::Frontmatter => fub_abi::event::DocChange::Frontmatter,
        legacy_events::DocChange::Tags => fub_abi::event::DocChange::Tags,
        legacy_events::DocChange::Links => fub_abi::event::DocChange::Links,
        legacy_events::DocChange::Outline => fub_abi::event::DocChange::Outline,
        legacy_events::DocChange::Anchors => fub_abi::event::DocChange::Anchors,
    }
}

fn abi_changes_from_legacy(changes: legacy_events::DocChanges) -> fub_abi::event::DocChanges {
    fub_abi::event::DocChanges {
        aspects: changes.aspects.into_iter().map(abi_doc_change_from_legacy).collect(),
        properties: changes.properties,
        tags_added: changes.tags_added,
        tags_removed: changes.tags_removed,
    }
}

fn abi_entry_kind_from_legacy(kind: legacy_model::EntryKind) -> fub_abi::traits::EntryKind {
    match kind {
        legacy_model::EntryKind::Document => fub_abi::traits::EntryKind::Document,
        legacy_model::EntryKind::Asset => fub_abi::traits::EntryKind::Asset,
        legacy_model::EntryKind::Unknown => fub_abi::traits::EntryKind::Unknown,
    }
}

fn abi_scope_from_legacy(scope: legacy_settings::SettingScope) -> fub_abi::settings::SettingScope {
    match scope {
        legacy_settings::SettingScope::Vault => fub_abi::settings::SettingScope::Vault,
        legacy_settings::SettingScope::Machine => fub_abi::settings::SettingScope::Machine,
    }
}

fn abi_severity_from_legacy(severity: legacy_events::Severity) -> fub_abi::event::Severity {
    match severity {
        legacy_events::Severity::Warning => fub_abi::event::Severity::Warning,
        legacy_events::Severity::Failure => fub_abi::event::Severity::Failure,
    }
}

fn abi_gate_from_legacy(gate: legacy_events::Gate) -> fub_abi::gate::Gate {
    match gate {
        legacy_events::Gate::Command => fub_abi::gate::Gate::Command,
        legacy_events::Gate::ViewRender => fub_abi::gate::Gate::ViewRender,
        legacy_events::Gate::ViewAction => fub_abi::gate::Gate::ViewAction,
        legacy_events::Gate::Service => fub_abi::gate::Gate::Service,
        legacy_events::Gate::Event => fub_abi::gate::Gate::Event,
        legacy_events::Gate::IndexFeed => fub_abi::gate::Gate::IndexFeed,
        legacy_events::Gate::IndexForget => fub_abi::gate::Gate::IndexForget,
        legacy_events::Gate::IndexUpToDate => fub_abi::gate::Gate::IndexUpToDate,
        legacy_events::Gate::IndexReconcile => fub_abi::gate::Gate::IndexReconcile,
        legacy_events::Gate::FormatParse => fub_abi::gate::Gate::FormatParse,
        legacy_events::Gate::SyntaxRule => fub_abi::gate::Gate::SyntaxRule,
        legacy_events::Gate::CustomRender => fub_abi::gate::Gate::CustomRender,
        legacy_events::Gate::Job => fub_abi::gate::Gate::Job,
        legacy_events::Gate::IndexQuery => fub_abi::gate::Gate::IndexQuery,
    }
}

fn abi_event_from_legacy(event: legacy_events::Event) -> Result<fub_abi::event::Event, PluginError> {
    use fub_abi::event::Event as Abi;
    Ok(match event {
        legacy_events::Event::VaultOpened(event) => Abi::VaultOpened { root: event.root },
        legacy_events::Event::DocumentChanged(event) => Abi::DocumentChanged {
            id: fub_abi::model::DocId::new(event.id),
            changes: event.changes.map(abi_changes_from_legacy),
        },
        legacy_events::Event::DocumentRemoved(event) => Abi::DocumentRemoved {
            id: fub_abi::model::DocId::new(event.id),
        },
        legacy_events::Event::DocumentRenamed(event) => Abi::DocumentRenamed {
            from: fub_abi::model::DocId::new(event.from),
            to: fub_abi::model::DocId::new(event.to),
        },
        legacy_events::Event::IndexUpdated => Abi::IndexUpdated,
        legacy_events::Event::JobDone(event) => Abi::JobDone {
            id: fub_abi::traits::JobId(event.id),
            job: event.job,
            result: match event.result {
                Ok(payload) => Ok(tr::from_json(&payload)?),
                Err(error) => Err(abi_error_from_legacy(error)),
            },
        },
        legacy_events::Event::Overflow(event) => Abi::Overflow {
            dropped: event.dropped,
        },
        legacy_events::Event::Custom(event) => Abi::Custom {
            topic: event.topic,
            payload: tr::from_json(&event.payload)?,
        },
        legacy_events::Event::BatchEnded(event) => Abi::BatchEnded {
            batch: fub_abi::event::BatchId(event.batch),
            changed: event.changed.into_iter().map(fub_abi::model::DocId::new).collect(),
        },
        legacy_events::Event::ViewInvalidated(event) => Abi::ViewInvalidated {
            view: event.view,
            instance: event.instance,
        },
        legacy_events::Event::VaultClosed(event) => Abi::VaultClosed { root: event.root },
        legacy_events::Event::JobStarted(event) => Abi::JobStarted {
            id: fub_abi::traits::JobId(event.id),
            job: event.job,
        },
        legacy_events::Event::JobProgress(event) => Abi::JobProgress {
            id: fub_abi::traits::JobId(event.id),
            progress: abi_progress_from_legacy(event.progress),
        },
        legacy_events::Event::SettingChanged(event) => Abi::SettingChanged {
            key: event.key,
            scope: abi_scope_from_legacy(event.scope),
        },
        legacy_events::Event::EntryChanged(event) => Abi::EntryChanged {
            id: fub_abi::model::DocId::new(event.id),
            kind: abi_entry_kind_from_legacy(event.kind),
        },
        legacy_events::Event::EntryRemoved(event) => Abi::EntryRemoved {
            id: fub_abi::model::DocId::new(event.id),
            kind: abi_entry_kind_from_legacy(event.kind),
        },
        legacy_events::Event::EntryRenamed(event) => Abi::EntryRenamed {
            from: fub_abi::model::DocId::new(event.from),
            to: fub_abi::model::DocId::new(event.to),
            kind: abi_entry_kind_from_legacy(event.kind),
        },
        legacy_events::Event::Trouble(event) => Abi::Trouble {
            severity: abi_severity_from_legacy(event.severity),
            subject: event.subject.map(fub_abi::model::DocId::new),
            error: abi_error_from_legacy(event.error),
            gate: event.gate.map(abi_gate_from_legacy),
        },
        legacy_events::Event::TimerFired(event) => Abi::TimerFired {
            owner: event.owner,
            timer: event.timer,
        },
    })
}

fn abi_progress_from_legacy(progress: legacy_jobs::JobProgress) -> fub_abi::traits::JobProgress {
    fub_abi::traits::JobProgress {
        done: progress.done,
        total: progress.total,
        label: progress.label,
    }
}

impl legacy_host_events::Host for State {
    fn emit(&mut self, event: legacy_events::Event) {
        let Ok(writer) = self.writer() else {
            return;
        };
        match abi_event_from_legacy(event) {
            Ok(event) => writer.emit(event),
            Err(why) => writer.emit(fub_abi::event::Event::Trouble {
                severity: fub_abi::event::Severity::Failure,
                subject: None,
                error: PluginError::BadArgs(
                    format!("evento non emesso da un componente WASM legacy: {why}").into(),
                ),
                gate: None,
            }),
        }
    }

    fn spawn_job(
        &mut self,
        spec: legacy_jobs::JobSpec,
    ) -> Result<u64, legacy_errors::PluginError> {
        let payload = match tr::from_json(&spec.payload) {
            Ok(payload) => payload,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        let writer = match self.writer() {
            Ok(writer) => writer,
            Err(error) => return Err(legacy_error_from_abi(&error)),
        };
        writer
            .spawn_job(fub_abi::traits::JobSpec {
                job: spec.job,
                payload,
            })
            .map(|id| id.0)
            .map_err(|error| legacy_error_from_abi(&error))
    }

    fn report_progress(&mut self, progress: legacy_jobs::JobProgress) {
        let Ok(writer) = self.writer() else {
            return;
        };
        writer.report_progress(abi_progress_from_legacy(progress));
    }
}

// ---------------------------------------------------------------------------
// Adattatori legacy -> corrente per il provider di formato
// ---------------------------------------------------------------------------
//
// I tipi sono strutturalmente identici fra `0.1.2` e `0.2.0` (verificato con
// `diff`: l'unica differenza del WIT è il bump di package più `format-links`).
// Ogni adattatore copia campo per campo e riusa le traduzioni vive per la
// validazione vera (modello, mappe, JSON): nessun secondo punto che giudichi.

/// Descrittore legacy verso `fub-abi`.
pub(crate) fn from_legacy_descriptor(
    descriptor: legacy_x_format::FormatDescriptor,
) -> fub_abi::format::FormatDescriptor {
    fub_abi::format::FormatDescriptor {
        id: descriptor.id,
        name: descriptor.name,
        extensions: descriptor.extensions,
        source: match descriptor.source {
            legacy_x_format::SourceKind::Text => fub_abi::format::SourceKind::Text,
            legacy_x_format::SourceKind::Bytes => fub_abi::format::SourceKind::Bytes,
        },
    }
}

/// Capacità legacy verso `fub-abi` (la mappa resta una lista di voci JSON).
pub(crate) fn from_legacy_capabilities(
    capabilities: legacy_x_format::FormatCapabilities,
) -> Result<fub_abi::format::FormatCapabilities, PluginError> {
    let mut syntax = fub_abi::options::OptionMap::new();
    for entry in capabilities.syntax {
        syntax.set(entry.key, tr::from_json(&entry.value)?);
    }
    Ok(fub_abi::format::FormatCapabilities { syntax })
}

/// Errore di formato legacy verso `fub-abi`.
pub(crate) fn from_legacy_format_error(
    error: legacy_x_format::FormatError,
) -> fub_abi::FormatError {
    match error {
        legacy_x_format::FormatError::Parse(message) => fub_abi::FormatError::Parse(message),
        legacy_x_format::FormatError::Render(message) => fub_abi::FormatError::Render(message),
        legacy_x_format::FormatError::Serialize(message) => {
            fub_abi::FormatError::Serialize(message)
        }
        legacy_x_format::FormatError::Unsupported(error) => fub_abi::FormatError::Unsupported {
            format: error.format,
            got: match error.got {
                legacy_x_format::SourceKind::Text => fub_abi::format::SourceKind::Text,
                legacy_x_format::SourceKind::Bytes => fub_abi::format::SourceKind::Bytes,
            },
        },
    }
}

/// Sorgente `fub-abi` verso il guest legacy (verso host -> guest).
pub(crate) fn to_legacy_source(
    source: &fub_abi::format::DocumentSource,
) -> legacy_x_format::DocumentSource {
    match source {
        fub_abi::format::DocumentSource::Text(text) => {
            legacy_x_format::DocumentSource::Text(text.clone())
        }
        fub_abi::format::DocumentSource::Bytes(bytes) => {
            legacy_x_format::DocumentSource::Bytes(bytes.clone())
        }
    }
}

/// Contesto di parse `fub-abi` verso il guest legacy.
pub(crate) fn to_legacy_parse_context(
    ctx: &fub_abi::format::ParseContext,
) -> legacy_x_format::ParseContext {
    legacy_x_format::ParseContext {
        doc_id: ctx.doc_id.clone(),
        options: ctx
            .options
            .iter()
            .map(|(key, value)| legacy_options::OptionEntry {
                key: key.to_string(),
                value: value.to_string(),
            })
            .collect(),
    }
}

/// Opzioni di render `fub-abi` verso il guest legacy.
pub(crate) fn to_legacy_render_options(
    opts: &fub_abi::format::RenderOptions,
) -> legacy_x_format::RenderOptions {
    legacy_x_format::RenderOptions {
        target: match opts.target {
            fub_abi::format::RenderTarget::Screen => legacy_x_format::RenderTarget::Screen,
            fub_abi::format::RenderTarget::Print => legacy_x_format::RenderTarget::Print,
            fub_abi::format::RenderTarget::Pdf => legacy_x_format::RenderTarget::Pdf,
            fub_abi::format::RenderTarget::StaticSite => legacy_x_format::RenderTarget::StaticSite,
        },
        options: opts
            .options
            .iter()
            .map(|(key, value)| legacy_options::OptionEntry {
                key: key.to_string(),
                value: value.to_string(),
            })
            .collect(),
    }
}

/// Modello `fub-abi` verso il guest legacy, passando dal WIT vivo.
///
/// Il vivo fa la validazione vera (profondità, arena); qui resta la copia
/// campo-per-campo verso i tipi legacy strutturalmente identici.
pub(crate) fn to_legacy_document(
    model: &fub_abi::model::DocumentModel,
) -> Result<legacy_model::DocumentModel, PluginError> {
    let current = crate::model::to_document(model.clone())?;
    Ok(current_document_to_legacy(current))
}

/// Modello parsato dal guest legacy verso `fub-abi`.
///
/// Converte il modello legacy in modello vivo e riusa
/// `crate::model::from_document` per la validazione vera (indici, span,
/// frontmatter, preflight anti-amplificazione): nessun secondo punto che
/// giudichi gli span.
pub(crate) fn from_legacy_document(
    model: legacy_model::DocumentModel,
    ctx: &fub_abi::format::ParseContext,
    source: &fub_abi::format::DocumentSource,
) -> Result<fub_abi::model::DocumentModel, fub_abi::FormatError> {
    let current = legacy_document_to_current(model);
    crate::model::from_document(current, ctx, source)
}

/// Manifest legacy verso `fub-abi` (prima lettura, prima di fidarsi).
pub(crate) fn from_legacy_manifest(
    manifest: legacy_x_plugin::PluginManifest,
) -> Result<fub_abi::traits::PluginManifest, PluginError> {
    Ok(fub_abi::traits::PluginManifest {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        abi_version: manifest.abi_version,
        permissions: fub_abi::traits::PluginPermissions {
            granted: {
                let mut map = fub_abi::options::OptionMap::new();
                for entry in manifest.permissions.granted {
                    map.set(entry.key, tr::from_json(&entry.value)?);
                }
                map
            },
        },
        provides: manifest.provides,
        requires: manifest.requires,
        settings: manifest
            .settings
            .into_iter()
            .map(abi_setting_from_legacy)
            .collect(),
        strings: manifest
            .strings
            .into_iter()
            .map(|catalog| fub_abi::text::StringCatalog {
                locale: catalog.locale,
                entries: catalog.entries.into_iter().collect(),
            })
            .collect(),
        default_locale: manifest.default_locale,
        timers: manifest
            .timers
            .into_iter()
            .map(abi_timer_from_legacy)
            .collect(),
    })
}

fn abi_setting_from_legacy(
    spec: legacy_settings::SettingSpec,
) -> fub_abi::settings::SettingSpec {
    fub_abi::settings::SettingSpec {
        key: spec.key,
        label: abi_text_from_legacy(spec.label),
        description: abi_text_from_legacy(spec.description),
        group: abi_text_from_legacy(spec.group),
        scope: abi_scope_from_legacy(spec.scope),
        kind: abi_setting_kind_from_legacy(spec.kind),
        program_writable: spec.program_writable,
    }
}

fn abi_setting_kind_from_legacy(
    kind: legacy_settings::SettingKind,
) -> fub_abi::settings::SettingKind {
    match kind {
        legacy_settings::SettingKind::Toggle(value) => fub_abi::settings::SettingKind::Toggle {
            default: value.default,
        },
        legacy_settings::SettingKind::Number(value) => fub_abi::settings::SettingKind::Number {
            default: value.default,
            min: value.min,
            max: value.max,
        },
        legacy_settings::SettingKind::Text(value) => fub_abi::settings::SettingKind::Text {
            default: value.default,
        },
        legacy_settings::SettingKind::Choice(value) => fub_abi::settings::SettingKind::Choice {
            default: value.default,
            options: value
                .options
                .into_iter()
                .map(|option| fub_abi::ui::UiOption {
                    value: option.value,
                    label: abi_text_from_legacy(option.label),
                })
                .collect(),
        },
        legacy_settings::SettingKind::List(value) => fub_abi::settings::SettingKind::List {
            default: value.default,
        },
    }
}

fn abi_timer_from_legacy(spec: legacy_x_plugin::TimerSpec) -> fub_abi::traits::TimerSpec {
    fub_abi::traits::TimerSpec {
        id: spec.id,
        schedule: match spec.schedule {
            legacy_x_plugin::TimerSchedule::Every(seconds) => {
                fub_abi::traits::TimerSchedule::Every { seconds }
            }
            legacy_x_plugin::TimerSchedule::After(seconds) => {
                fub_abi::traits::TimerSchedule::After { seconds }
            }
            legacy_x_plugin::TimerSchedule::AtWallClock(clock) => {
                fub_abi::traits::TimerSchedule::AtWallClock(fub_abi::traits::WallClock {
                    hour: clock.hour,
                    minute: clock.minute,
                    days: clock.days.into_iter().map(abi_weekday_from_legacy).collect(),
                    zone: clock.zone,
                    catch_up_seconds: clock.catch_up_seconds,
                })
            }
        },
    }
}

fn abi_weekday_from_legacy(day: legacy_intl::Weekday) -> fub_abi::locale::Weekday {
    match day {
        legacy_intl::Weekday::Monday => fub_abi::locale::Weekday::Monday,
        legacy_intl::Weekday::Tuesday => fub_abi::locale::Weekday::Tuesday,
        legacy_intl::Weekday::Wednesday => fub_abi::locale::Weekday::Wednesday,
        legacy_intl::Weekday::Thursday => fub_abi::locale::Weekday::Thursday,
        legacy_intl::Weekday::Friday => fub_abi::locale::Weekday::Friday,
        legacy_intl::Weekday::Saturday => fub_abi::locale::Weekday::Saturday,
        legacy_intl::Weekday::Sunday => fub_abi::locale::Weekday::Sunday,
    }
}

// ---------------------------------------------------------------------------
// Modello documento fra WIT vivo e WIT legacy: copie campo-per-campo
// ---------------------------------------------------------------------------
//
// Le due interfacce `model` sono identiche all'ultimo commento; ogni funzione
// qui sotto copia senza giudicare. La validazione resta in
// `crate::model::{to_document, from_document}`.

fn current_span_to_legacy(span: crate::contract::fub::abi::model::Span) -> legacy_model::Span {
    legacy_model::Span {
        start: span.start,
        end: span.end,
    }
}

fn legacy_span_to_current(span: legacy_model::Span) -> crate::contract::fub::abi::model::Span {
    crate::contract::fub::abi::model::Span {
        start: span.start,
        end: span.end,
    }
}

fn current_target_to_legacy(
    target: crate::contract::fub::abi::model::LinkTarget,
) -> legacy_model::LinkTarget {
    match target {
        crate::contract::fub::abi::model::LinkTarget::Wiki(inner) => {
            legacy_model::LinkTarget::Wiki(legacy_model::LinkTargetWiki {
                page: inner.page,
                heading: inner.heading,
                block: inner.block,
            })
        }
        crate::contract::fub::abi::model::LinkTarget::Url(url) => {
            legacy_model::LinkTarget::Url(url)
        }
        crate::contract::fub::abi::model::LinkTarget::Path(path) => {
            legacy_model::LinkTarget::Path(path)
        }
    }
}

fn legacy_target_to_current(
    target: legacy_model::LinkTarget,
) -> crate::contract::fub::abi::model::LinkTarget {
    match target {
        legacy_model::LinkTarget::Wiki(inner) => {
            crate::contract::fub::abi::model::LinkTarget::Wiki(
                crate::contract::fub::abi::model::LinkTargetWiki {
                    page: inner.page,
                    heading: inner.heading,
                    block: inner.block,
                },
            )
        }
        legacy_model::LinkTarget::Url(url) => {
            crate::contract::fub::abi::model::LinkTarget::Url(url)
        }
        legacy_model::LinkTarget::Path(path) => {
            crate::contract::fub::abi::model::LinkTarget::Path(path)
        }
    }
}

fn current_heading_to_legacy(
    heading: crate::contract::fub::abi::model::Heading,
) -> legacy_model::Heading {
    legacy_model::Heading {
        level: heading.level,
        text: heading.text,
        slug: heading.slug,
        span: current_span_to_legacy(heading.span),
        explicit_anchor: heading.explicit_anchor,
    }
}

fn legacy_heading_to_current(
    heading: legacy_model::Heading,
) -> crate::contract::fub::abi::model::Heading {
    crate::contract::fub::abi::model::Heading {
        level: heading.level,
        text: heading.text,
        slug: heading.slug,
        span: legacy_span_to_current(heading.span),
        explicit_anchor: heading.explicit_anchor,
    }
}

fn current_link_to_legacy(
    link: crate::contract::fub::abi::model::Link,
) -> legacy_model::Link {
    legacy_model::Link {
        target: current_target_to_legacy(link.target),
        embed: link.embed,
        span: current_span_to_legacy(link.span),
        context: link.context,
    }
}

fn legacy_link_to_current(
    link: legacy_model::Link,
) -> crate::contract::fub::abi::model::Link {
    crate::contract::fub::abi::model::Link {
        target: legacy_target_to_current(link.target),
        embed: link.embed,
        span: legacy_span_to_current(link.span),
        context: link.context,
    }
}

fn current_tag_to_legacy(tag: crate::contract::fub::abi::model::Tag) -> legacy_model::Tag {
    legacy_model::Tag {
        name: tag.name,
        span: current_span_to_legacy(tag.span),
    }
}

fn legacy_tag_to_current(tag: legacy_model::Tag) -> crate::contract::fub::abi::model::Tag {
    crate::contract::fub::abi::model::Tag {
        name: tag.name,
        span: legacy_span_to_current(tag.span),
    }
}

fn current_anchor_to_legacy(
    anchor: crate::contract::fub::abi::model::Anchor,
) -> legacy_model::Anchor {
    legacy_model::Anchor {
        id: anchor.id,
        span: current_span_to_legacy(anchor.span),
        marker: current_span_to_legacy(anchor.marker),
    }
}

fn legacy_anchor_to_current(
    anchor: legacy_model::Anchor,
) -> crate::contract::fub::abi::model::Anchor {
    crate::contract::fub::abi::model::Anchor {
        id: anchor.id,
        span: legacy_span_to_current(anchor.span),
        marker: legacy_span_to_current(anchor.marker),
    }
}

fn current_inline_to_legacy(
    inline: crate::contract::fub::abi::model::Inline,
) -> legacy_model::Inline {
    match inline {
        crate::contract::fub::abi::model::Inline::Text(text) => legacy_model::Inline::Text(text),
        crate::contract::fub::abi::model::Inline::Emph(children) => {
            legacy_model::Inline::Emph(children)
        }
        crate::contract::fub::abi::model::Inline::Strong(children) => {
            legacy_model::Inline::Strong(children)
        }
        crate::contract::fub::abi::model::Inline::Code(code) => legacy_model::Inline::Code(code),
        crate::contract::fub::abi::model::Inline::Link(link) => {
            legacy_model::Inline::Link(legacy_model::InlineLink {
                target: current_target_to_legacy(link.target),
                label: link.label,
                embed: link.embed,
                span: current_span_to_legacy(link.span),
            })
        }
        crate::contract::fub::abi::model::Inline::TagRef(reference) => {
            legacy_model::Inline::TagRef(legacy_model::InlineTagRef {
                name: reference.name,
                span: current_span_to_legacy(reference.span),
            })
        }
        crate::contract::fub::abi::model::Inline::Custom(custom) => {
            legacy_model::Inline::Custom(legacy_model::InlineCustom {
                custom_kind: custom.custom_kind,
                attrs: custom.attrs,
                span: current_span_to_legacy(custom.span),
            })
        }
        crate::contract::fub::abi::model::Inline::Superscript(children) => {
            legacy_model::Inline::Superscript(children)
        }
        crate::contract::fub::abi::model::Inline::Strikethrough(children) => {
            legacy_model::Inline::Strikethrough(children)
        }
        crate::contract::fub::abi::model::Inline::HardBreak => legacy_model::Inline::HardBreak,
        crate::contract::fub::abi::model::Inline::SoftBreak => legacy_model::Inline::SoftBreak,
    }
}

fn legacy_inline_to_current(
    inline: legacy_model::Inline,
) -> crate::contract::fub::abi::model::Inline {
    match inline {
        legacy_model::Inline::Text(text) => {
            crate::contract::fub::abi::model::Inline::Text(text)
        }
        legacy_model::Inline::Emph(children) => {
            crate::contract::fub::abi::model::Inline::Emph(children)
        }
        legacy_model::Inline::Strong(children) => {
            crate::contract::fub::abi::model::Inline::Strong(children)
        }
        legacy_model::Inline::Code(code) => {
            crate::contract::fub::abi::model::Inline::Code(code)
        }
        legacy_model::Inline::Link(link) => {
            crate::contract::fub::abi::model::Inline::Link(
                crate::contract::fub::abi::model::InlineLink {
                    target: legacy_target_to_current(link.target),
                    label: link.label,
                    embed: link.embed,
                    span: legacy_span_to_current(link.span),
                },
            )
        }
        legacy_model::Inline::TagRef(reference) => {
            crate::contract::fub::abi::model::Inline::TagRef(
                crate::contract::fub::abi::model::InlineTagRef {
                    name: reference.name,
                    span: legacy_span_to_current(reference.span),
                },
            )
        }
        legacy_model::Inline::Custom(custom) => {
            crate::contract::fub::abi::model::Inline::Custom(
                crate::contract::fub::abi::model::InlineCustom {
                    custom_kind: custom.custom_kind,
                    attrs: custom.attrs,
                    span: legacy_span_to_current(custom.span),
                },
            )
        }
        legacy_model::Inline::Superscript(children) => {
            crate::contract::fub::abi::model::Inline::Superscript(children)
        }
        legacy_model::Inline::Strikethrough(children) => {
            crate::contract::fub::abi::model::Inline::Strikethrough(children)
        }
        legacy_model::Inline::HardBreak => {
            crate::contract::fub::abi::model::Inline::HardBreak
        }
        legacy_model::Inline::SoftBreak => {
            crate::contract::fub::abi::model::Inline::SoftBreak
        }
    }
}

fn current_block_to_legacy(
    block: crate::contract::fub::abi::model::Block,
) -> legacy_model::Block {
    match block {
        crate::contract::fub::abi::model::Block::Heading(heading) => {
            legacy_model::Block::Heading(legacy_model::BlockHeading {
                level: heading.level,
                inlines: heading.inlines,
                anchor: heading.anchor,
                span: current_span_to_legacy(heading.span),
                explicit_anchor: heading.explicit_anchor,
            })
        }
        crate::contract::fub::abi::model::Block::Paragraph(paragraph) => {
            legacy_model::Block::Paragraph(legacy_model::BlockParagraph {
                inlines: paragraph.inlines,
                anchor: paragraph.anchor,
                span: current_span_to_legacy(paragraph.span),
            })
        }
        crate::contract::fub::abi::model::Block::List(list) => {
            legacy_model::Block::List(legacy_model::BlockList {
                ordered: list.ordered,
                items: list
                    .items
                    .into_iter()
                    .map(|item| legacy_model::ListItem {
                        blocks: item.blocks,
                        task: item.task.map(|marker| legacy_model::TaskMarker {
                            symbol: marker.symbol,
                            span: current_span_to_legacy(marker.span),
                        }),
                        span: current_span_to_legacy(item.span),
                    })
                    .collect(),
                anchor: list.anchor,
                span: current_span_to_legacy(list.span),
                start: list.start,
            })
        }
        crate::contract::fub::abi::model::Block::CodeBlock(code) => {
            legacy_model::Block::CodeBlock(legacy_model::BlockCodeBlock {
                lang: code.lang,
                code: code.code,
                anchor: code.anchor,
                span: current_span_to_legacy(code.span),
            })
        }
        crate::contract::fub::abi::model::Block::Quote(quote) => {
            legacy_model::Block::Quote(legacy_model::BlockQuote {
                blocks: quote.blocks,
                anchor: quote.anchor,
                span: current_span_to_legacy(quote.span),
            })
        }
        crate::contract::fub::abi::model::Block::ThematicBreak(break_) => {
            legacy_model::Block::ThematicBreak(legacy_model::BlockThematicBreak {
                anchor: break_.anchor,
                span: current_span_to_legacy(break_.span),
            })
        }
        crate::contract::fub::abi::model::Block::Custom(custom) => {
            legacy_model::Block::Custom(legacy_model::BlockCustom {
                custom_kind: custom.custom_kind,
                attrs: custom.attrs,
                blocks: custom.blocks,
                anchor: custom.anchor,
                span: current_span_to_legacy(custom.span),
            })
        }
        crate::contract::fub::abi::model::Block::Table(table) => {
            legacy_model::Block::Table(legacy_model::BlockTable {
                head: table.head.map(|row| legacy_row_to_legacy(row)),
                rows: table.rows.into_iter().map(legacy_row_to_legacy).collect(),
                align: table
                    .align
                    .into_iter()
                    .map(|align| match align {
                        crate::contract::fub::abi::model::ColumnAlign::None => {
                            legacy_model::ColumnAlign::None
                        }
                        crate::contract::fub::abi::model::ColumnAlign::Left => {
                            legacy_model::ColumnAlign::Left
                        }
                        crate::contract::fub::abi::model::ColumnAlign::Center => {
                            legacy_model::ColumnAlign::Center
                        }
                        crate::contract::fub::abi::model::ColumnAlign::Right => {
                            legacy_model::ColumnAlign::Right
                        }
                    })
                    .collect(),
                anchor: table.anchor,
                span: current_span_to_legacy(table.span),
            })
        }
        crate::contract::fub::abi::model::Block::ReferenceDefinition(definition) => {
            legacy_model::Block::ReferenceDefinition(legacy_model::BlockReferenceDefinition {
                label: definition.label,
                url: definition.url,
                title: definition.title,
                anchor: definition.anchor,
                span: current_span_to_legacy(definition.span),
            })
        }
    }
}

fn legacy_row_to_legacy(
    row: crate::contract::fub::abi::model::TableRow,
) -> legacy_model::TableRow {
    legacy_model::TableRow {
        cells: row
            .cells
            .into_iter()
            .map(|cell| legacy_model::TableCell {
                inlines: cell.inlines,
                span: current_span_to_legacy(cell.span),
            })
            .collect(),
    }
}

fn legacy_block_to_current(
    block: legacy_model::Block,
) -> crate::contract::fub::abi::model::Block {
    match block {
        legacy_model::Block::Heading(heading) => {
            crate::contract::fub::abi::model::Block::Heading(
                crate::contract::fub::abi::model::BlockHeading {
                    level: heading.level,
                    inlines: heading.inlines,
                    anchor: heading.anchor,
                    span: legacy_span_to_current(heading.span),
                    explicit_anchor: heading.explicit_anchor,
                },
            )
        }
        legacy_model::Block::Paragraph(paragraph) => {
            crate::contract::fub::abi::model::Block::Paragraph(
                crate::contract::fub::abi::model::BlockParagraph {
                    inlines: paragraph.inlines,
                    anchor: paragraph.anchor,
                    span: legacy_span_to_current(paragraph.span),
                },
            )
        }
        legacy_model::Block::List(list) => {
            crate::contract::fub::abi::model::Block::List(
                crate::contract::fub::abi::model::BlockList {
                    ordered: list.ordered,
                    items: list
                        .items
                        .into_iter()
                        .map(|item| crate::contract::fub::abi::model::ListItem {
                            blocks: item.blocks,
                            task: item.task.map(|marker| {
                                crate::contract::fub::abi::model::TaskMarker {
                                    symbol: marker.symbol,
                                    span: legacy_span_to_current(marker.span),
                                }
                            }),
                            span: legacy_span_to_current(item.span),
                        })
                        .collect(),
                    anchor: list.anchor,
                    span: legacy_span_to_current(list.span),
                    start: list.start,
                },
            )
        }
        legacy_model::Block::CodeBlock(code) => {
            crate::contract::fub::abi::model::Block::CodeBlock(
                crate::contract::fub::abi::model::BlockCodeBlock {
                    lang: code.lang,
                    code: code.code,
                    anchor: code.anchor,
                    span: legacy_span_to_current(code.span),
                },
            )
        }
        legacy_model::Block::Quote(quote) => {
            crate::contract::fub::abi::model::Block::Quote(
                crate::contract::fub::abi::model::BlockQuote {
                    blocks: quote.blocks,
                    anchor: quote.anchor,
                    span: legacy_span_to_current(quote.span),
                },
            )
        }
        legacy_model::Block::ThematicBreak(break_) => {
            crate::contract::fub::abi::model::Block::ThematicBreak(
                crate::contract::fub::abi::model::BlockThematicBreak {
                    anchor: break_.anchor,
                    span: legacy_span_to_current(break_.span),
                },
            )
        }
        legacy_model::Block::Custom(custom) => {
            crate::contract::fub::abi::model::Block::Custom(
                crate::contract::fub::abi::model::BlockCustom {
                    custom_kind: custom.custom_kind,
                    attrs: custom.attrs,
                    blocks: custom.blocks,
                    anchor: custom.anchor,
                    span: legacy_span_to_current(custom.span),
                },
            )
        }
        legacy_model::Block::Table(table) => {
            crate::contract::fub::abi::model::Block::Table(
                crate::contract::fub::abi::model::BlockTable {
                    head: table.head.map(current_row_from_legacy),
                    rows: table.rows.into_iter().map(current_row_from_legacy).collect(),
                    align: table
                        .align
                        .into_iter()
                        .map(|align| match align {
                            legacy_model::ColumnAlign::None => {
                                crate::contract::fub::abi::model::ColumnAlign::None
                            }
                            legacy_model::ColumnAlign::Left => {
                                crate::contract::fub::abi::model::ColumnAlign::Left
                            }
                            legacy_model::ColumnAlign::Center => {
                                crate::contract::fub::abi::model::ColumnAlign::Center
                            }
                            legacy_model::ColumnAlign::Right => {
                                crate::contract::fub::abi::model::ColumnAlign::Right
                            }
                        })
                        .collect(),
                    anchor: table.anchor,
                    span: legacy_span_to_current(table.span),
                },
            )
        }
        legacy_model::Block::ReferenceDefinition(definition) => {
            crate::contract::fub::abi::model::Block::ReferenceDefinition(
                crate::contract::fub::abi::model::BlockReferenceDefinition {
                    label: definition.label,
                    url: definition.url,
                    title: definition.title,
                    anchor: definition.anchor,
                    span: legacy_span_to_current(definition.span),
                },
            )
        }
    }
}

fn current_row_from_legacy(
    row: legacy_model::TableRow,
) -> crate::contract::fub::abi::model::TableRow {
    crate::contract::fub::abi::model::TableRow {
        cells: row
            .cells
            .into_iter()
            .map(|cell| crate::contract::fub::abi::model::TableCell {
                inlines: cell.inlines,
                span: legacy_span_to_current(cell.span),
            })
            .collect(),
    }
}

fn current_document_to_legacy(
    model: crate::contract::fub::abi::model::DocumentModel,
) -> legacy_model::DocumentModel {
    legacy_model::DocumentModel {
        id: model.id,
        frontmatter: model.frontmatter,
        body: legacy_model::DocumentTree {
            blocks: model.body.blocks.into_iter().map(current_block_to_legacy).collect(),
            inlines: model.body.inlines.into_iter().map(current_inline_to_legacy).collect(),
            roots: model.body.roots,
        },
        outline: model.outline.into_iter().map(current_heading_to_legacy).collect(),
        links: model.links.into_iter().map(current_link_to_legacy).collect(),
        tags: model.tags.into_iter().map(current_tag_to_legacy).collect(),
        anchors: model.anchors.into_iter().map(current_anchor_to_legacy).collect(),
        text: model.text,
        frontmatter_present: model.frontmatter_present,
    }
}

fn legacy_document_to_current(
    model: legacy_model::DocumentModel,
) -> crate::contract::fub::abi::model::DocumentModel {
    crate::contract::fub::abi::model::DocumentModel {
        id: model.id,
        frontmatter: model.frontmatter,
        body: crate::contract::fub::abi::model::DocumentTree {
            blocks: model.body.blocks.into_iter().map(legacy_block_to_current).collect(),
            inlines: model.body.inlines.into_iter().map(legacy_inline_to_current).collect(),
            roots: model.body.roots,
        },
        outline: model.outline.into_iter().map(legacy_heading_to_current).collect(),
        links: model.links.into_iter().map(legacy_link_to_current).collect(),
        tags: model.tags.into_iter().map(legacy_tag_to_current).collect(),
        anchors: model.anchors.into_iter().map(legacy_anchor_to_current).collect(),
        text: model.text,
        frontmatter_present: model.frontmatter_present,
    }
}
