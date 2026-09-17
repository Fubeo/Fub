//! **Le stesse cose, dette due volte.**
//!
//! Ogni tipo del contratto esiste qui in due copie: quella che `bindgen!` ha
//! generato dal WIT (`crate::contract::…`) e quella scritta a mano in
//! `fub-abi` (`fub_abi::…`). Non sono la stessa `struct` — la prima nasce dal
//! WIT a ogni compilazione, la seconda è quella che il kernel maneggia — e
//! questo modulo è l'unico posto in cui si passa dall'una all'altra.
//!
//! # Perché non si generano dal WIT anche quelle di `fub-abi`
//!
//! Perché `fub-abi` è il contratto *anche* per chi non ha un WASM in mano: le
//! feature ufficiali di questo repo sono native, implementano gli stessi trait
//! e non attraversano nessun confine. Generare i loro tipi da un WIT vorrebbe
//! dire far dipendere il backend nativo dal modello dei componenti, che è
//! l'invariante del §16.1 girata dalla parte sbagliata.
//!
//! Il prezzo è questo file: due copie che devono restare allineate. Chi le
//! tiene allineate non è la buona volontà — è il compilatore, perché ogni
//! conversione qui dentro è una `match` **esaustiva**: il giorno che una delle
//! due parti cresce di un caso, questo modulo smette di compilare e nomina la
//! riga.
//!
//! # La direzione nei nomi
//!
//! `from_*` porta dal WIT al Rust (ciò che il componente dice), `to_*` porta dal
//! Rust al WIT (ciò che l'host gli passa). Un tipo che attraversa in un verso
//! solo ha una funzione sola, e non è una dimenticanza: è ciò che il contratto
//! dice di lui.

use fub_abi::PluginError;

// Le interfacce **esportate** hanno un albero di tipi tutto loro: `bindgen!`
// rigenera sotto `exports::` anche ciò che il mondo importa con lo stesso nome,
// e `fub::abi::command::CommandSpec` non è `exports::fub::abi::command::
// CommandSpec` nemmeno se il WIT è la stessa riga. Non è una stranezza da
// aggirare: dice che i tipi di un'interfaccia che l'host *chiama* e di una che
// l'host *implementa* viaggiano in versi opposti, e confonderli sarebbe
// esattamente lo scambio che questo modulo esiste per non fare.
use crate::contract::exports::fub::abi::{
    command as w_command, format as x_format, grid as w_grid, plugin as w_plugin, view as w_view,
};
// I tipi che l'interfaccia esportata `use`a da altre — `model.{span}`,
// `edit.{edit-request}`, `text.{text}` — restano invece gli stessi delle
// importate: la duplicazione qui sopra riguarda i tipi che un'interfaccia
// **definisce**, non quelli che prende in prestito.
use crate::contract::fub::abi::{
    edit as w_edit, errors as w_errors, events as w_events, format as w_format,
    host_vault_read as w_vault, index as w_index, intl as w_intl, model as w_model,
    options as w_options, session as w_session, settings as w_settings, text as w_text, ui as w_ui,
};

// ---------------------------------------------------------------------------
// JSON: una stringa che deve restare JSON
// ---------------------------------------------------------------------------

/// Il `json` del contratto è una **stringa** (`type json = string`), e questa è
/// la funzione che la riporta a essere un valore.
///
/// Una stringa che non è JSON valido è `BadArgs` e non `Internal`: chi l'ha
/// scritta è il componente, e un componente che manda spazzatura ha sbagliato
/// lui — dirgli «errore interno dell'host» lo manderebbe a cercare il guasto
/// dalla parte sbagliata.
pub(crate) fn from_json(s: &str) -> Result<serde_json::Value, PluginError> {
    serde_json::from_str(s)
        .map_err(|and| PluginError::BadArgs(format!("json non valido: {and}").into()))
}

/// Il verso opposto. Non può fallire: `serde_json::Value` è per costruzione
/// serializzabile.
pub(crate) fn to_json(v: &serde_json::Value) -> String {
    v.to_string()
}

// ---------------------------------------------------------------------------
// Testo ed errori
// ---------------------------------------------------------------------------

pub(crate) fn from_text(t: w_text::Text) -> fub_abi::text::Text {
    match t {
        w_text::Text::Literal(s) => fub_abi::text::Text::Literal(s),
        w_text::Text::Message(m) => fub_abi::text::Text::Message(fub_abi::text::Message {
            key: m.key,
            args: m.args.into_iter().map(from_arg).collect(),
        }),
    }
}

pub(crate) fn to_text(t: &fub_abi::text::Text) -> w_text::Text {
    match t {
        fub_abi::text::Text::Literal(s) => w_text::Text::Literal(s.clone()),
        fub_abi::text::Text::Message(m) => w_text::Text::Message(w_text::Message {
            key: m.key.clone(),
            args: m.args.iter().map(to_arg).collect(),
        }),
    }
}

fn from_arg(a: w_text::Arg) -> fub_abi::text::Arg {
    fub_abi::text::Arg {
        name: a.name,
        value: match a.value {
            w_text::ArgValue::Text(s) => fub_abi::text::ArgValue::Text(s),
            w_text::ArgValue::Int(n) => fub_abi::text::ArgValue::Int(n),
            w_text::ArgValue::Float(x) => fub_abi::text::ArgValue::Float(x),
            w_text::ArgValue::Timestamp(ms) => fub_abi::text::ArgValue::Timestamp(ms),
        },
    }
}

fn to_arg(a: &fub_abi::text::Arg) -> w_text::Arg {
    w_text::Arg {
        name: a.name.clone(),
        value: match &a.value {
            fub_abi::text::ArgValue::Text(s) => w_text::ArgValue::Text(s.clone()),
            fub_abi::text::ArgValue::Int(n) => w_text::ArgValue::Int(*n),
            fub_abi::text::ArgValue::Float(x) => w_text::ArgValue::Float(*x),
            fub_abi::text::ArgValue::Timestamp(ms) => w_text::ArgValue::Timestamp(*ms),
        },
    }
}

/// L'errore che torna dal componente.
pub(crate) fn from_error(and: w_errors::PluginError) -> PluginError {
    use w_errors::PluginError as W;
    match and {
        W::UnknownCommand(t) => PluginError::UnknownCommand(from_text(t)),
        W::UnknownView(t) => PluginError::UnknownView(from_text(t)),
        W::UnknownJob(t) => PluginError::UnknownJob(from_text(t)),
        W::BadArgs(t) => PluginError::BadArgs(from_text(t)),
        W::PermissionDenied(t) => PluginError::PermissionDenied(from_text(t)),
        W::Internal(t) => PluginError::Internal(from_text(t)),
        W::Conflict(t) => PluginError::Conflict(from_text(t)),
        W::Unserved(t) => PluginError::Unserved(from_text(t)),
        W::Cancelled(t) => PluginError::Cancelled(from_text(t)),
        W::NotFound(t) => PluginError::NotFound(from_text(t)),
        W::AlreadyExists(t) => PluginError::AlreadyExists(from_text(t)),
        W::Io(t) => PluginError::Io(from_text(t)),
    }
}

/// L'errore che l'host restituisce a una capacità. **È il verso che porta il
/// rifiuto del `Guard`**: un `permission-denied` deciso nel kernel arriva al
/// componente da qui, e arriva come valore — non come trap (vedi il doc di
/// `crate::contract`).
pub(crate) fn to_error(and: &PluginError) -> w_errors::PluginError {
    use w_errors::PluginError as W;
    match and {
        PluginError::UnknownCommand(t) => W::UnknownCommand(to_text(t)),
        PluginError::UnknownView(t) => W::UnknownView(to_text(t)),
        PluginError::UnknownJob(t) => W::UnknownJob(to_text(t)),
        PluginError::BadArgs(t) => W::BadArgs(to_text(t)),
        PluginError::PermissionDenied(t) => W::PermissionDenied(to_text(t)),
        PluginError::Internal(t) => W::Internal(to_text(t)),
        PluginError::Conflict(t) => W::Conflict(to_text(t)),
        PluginError::Unserved(t) => W::Unserved(to_text(t)),
        PluginError::Cancelled(t) => W::Cancelled(to_text(t)),
        PluginError::NotFound(t) => W::NotFound(to_text(t)),
        PluginError::AlreadyExists(t) => W::AlreadyExists(to_text(t)),
        PluginError::Io(t) => W::Io(to_text(t)),
    }
}

// ---------------------------------------------------------------------------
// La mappa che nel WIT è una lista
// ---------------------------------------------------------------------------

/// `option-map` è `list<option-entry>` perché WIT non ha mappe. La chiave
/// duplicata **vince l'ultima**, come farebbe un `insert`: rifiutare vorrebbe
/// dire far cadere un manifest per una ripetizione che non cambia il senso.
pub(crate) fn from_map(
    m: w_options::OptionMap,
) -> Result<fub_abi::options::OptionMap, PluginError> {
    let mut out = fub_abi::options::OptionMap::new();
    for entry in m {
        out.set(entry.key, from_json(&entry.value)?);
    }
    Ok(out)
}

pub(crate) fn to_map(m: &fub_abi::options::OptionMap) -> w_options::OptionMap {
    m.iter()
        .map(|(k, v)| w_options::OptionEntry {
            key: k.to_string(),
            value: to_json(v),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------

fn from_ui_option(or: w_ui::UiOption) -> fub_abi::ui::UiOption {
    fub_abi::ui::UiOption {
        value: or.value,
        label: from_text(or.label),
    }
}

fn from_setting_kind(k: w_settings::SettingKind) -> fub_abi::settings::SettingKind {
    use fub_abi::settings::SettingKind as R;
    match k {
        w_settings::SettingKind::Toggle(t) => R::Toggle { default: t.default },
        w_settings::SettingKind::Number(n) => R::Number {
            default: n.default,
            min: n.min,
            max: n.max,
        },
        w_settings::SettingKind::Text(t) => R::Text { default: t.default },
        w_settings::SettingKind::Choice(c) => R::Choice {
            default: c.default,
            options: c.options.into_iter().map(from_ui_option).collect(),
        },
        w_settings::SettingKind::List(the) => R::List {
            default: the.default,
        },
    }
}

fn from_setting_spec(s: w_settings::SettingSpec) -> fub_abi::settings::SettingSpec {
    fub_abi::settings::SettingSpec {
        key: s.key,
        label: from_text(s.label),
        description: from_text(s.description),
        group: from_text(s.group),
        scope: match s.scope {
            w_settings::SettingScope::Vault => fub_abi::settings::SettingScope::Vault,
            w_settings::SettingScope::Machine => fub_abi::settings::SettingScope::Machine,
        },
        kind: from_setting_kind(s.kind),
        program_writable: s.program_writable,
    }
}

// ---------------------------------------------------------------------------
// Locale e sveglie: il giorno della settimana è uno solo
// ---------------------------------------------------------------------------

pub(crate) fn to_weekday(g: fub_abi::locale::Weekday) -> w_intl::Weekday {
    use fub_abi::locale::Weekday as R;
    match g {
        R::Monday => w_intl::Weekday::Monday,
        R::Tuesday => w_intl::Weekday::Tuesday,
        R::Wednesday => w_intl::Weekday::Wednesday,
        R::Thursday => w_intl::Weekday::Thursday,
        R::Friday => w_intl::Weekday::Friday,
        R::Saturday => w_intl::Weekday::Saturday,
        R::Sunday => w_intl::Weekday::Sunday,
    }
}

pub(crate) fn from_weekday(g: w_intl::Weekday) -> fub_abi::locale::Weekday {
    use fub_abi::locale::Weekday as R;
    match g {
        w_intl::Weekday::Monday => R::Monday,
        w_intl::Weekday::Tuesday => R::Tuesday,
        w_intl::Weekday::Wednesday => R::Wednesday,
        w_intl::Weekday::Thursday => R::Thursday,
        w_intl::Weekday::Friday => R::Friday,
        w_intl::Weekday::Saturday => R::Saturday,
        w_intl::Weekday::Sunday => R::Sunday,
    }
}

pub(crate) fn to_locale(the: &fub_abi::locale::Locale) -> w_intl::Locale {
    w_intl::Locale {
        language: the.language.clone(),
        timezone: the.timezone.clone(),
        utc_offset_minutes: the.utc_offset_minutes,
        first_day_of_week: to_weekday(the.first_day_of_week),
        hour_cycle: match the.hour_cycle {
            fub_abi::locale::HourCycle::H23 => w_intl::HourCycle::H23,
            fub_abi::locale::HourCycle::H12 => w_intl::HourCycle::H12,
        },
    }
}

fn from_wall_clock(w: w_plugin::WallClock) -> fub_abi::traits::WallClock {
    fub_abi::traits::WallClock {
        hour: w.hour,
        minute: w.minute,
        days: w.days.into_iter().map(from_weekday).collect(),
        zone: w.zone,
        catch_up_seconds: w.catch_up_seconds,
    }
}

fn from_timer(t: w_plugin::TimerSpec) -> fub_abi::traits::TimerSpec {
    fub_abi::traits::TimerSpec {
        id: t.id,
        schedule: match t.schedule {
            w_plugin::TimerSchedule::Every(s) => {
                fub_abi::traits::TimerSchedule::Every { seconds: s }
            }
            w_plugin::TimerSchedule::After(s) => {
                fub_abi::traits::TimerSchedule::After { seconds: s }
            }
            w_plugin::TimerSchedule::AtWallClock(w) => {
                fub_abi::traits::TimerSchedule::AtWallClock(from_wall_clock(w))
            }
        },
    }
}

// ---------------------------------------------------------------------------
// Il manifest: la carta d'identità del componente
// ---------------------------------------------------------------------------

/// Il manifest che il componente dichiara.
///
/// È la **prima** cosa che si legge di lui e l'unica che si legge prima di
/// fidarsene: l'id con cui rivendica il proprio namespace (§7.4), i permessi
/// che il `Guard` gli farà rispettare (§7.3), la versione del contratto che
/// `abi_compatible` confronta. Che sia il componente a dirlo — e non un file
/// accanto — è ciò che rende un `.wasm` autoportante.
pub(crate) fn from_manifest(
    m: w_plugin::PluginManifest,
) -> Result<fub_abi::traits::PluginManifest, PluginError> {
    Ok(fub_abi::traits::PluginManifest {
        id: m.id,
        name: m.name,
        version: m.version,
        abi_version: m.abi_version,
        permissions: fub_abi::traits::PluginPermissions {
            granted: from_map(m.permissions.granted)?,
        },
        provides: m.provides,
        requires: m.requires,
        settings: m.settings.into_iter().map(from_setting_spec).collect(),
        strings: m
            .strings
            .into_iter()
            .map(|c| fub_abi::text::StringCatalog {
                locale: c.locale,
                entries: c.entries.into_iter().collect(),
            })
            .collect(),
        default_locale: m.default_locale,
        timers: m.timers.into_iter().map(from_timer).collect(),
    })
}

// ---------------------------------------------------------------------------
// Il vault: ciò che `host-vault-read` risponde
// ---------------------------------------------------------------------------

pub(crate) fn from_page(p: Option<w_index::Page>) -> Option<fub_abi::traits::Page> {
    p.map(|p| fub_abi::traits::Page {
        offset: p.offset,
        limit: p.limit,
    })
}

pub(crate) fn to_doc_ids_page(
    p: fub_abi::traits::Paged<fub_abi::model::DocId>,
) -> w_index::DocIdsPage {
    w_index::DocIdsPage {
        items: p.items.into_iter().map(|d| d.0).collect(),
        offset: p.offset,
        total: p.total,
    }
}

pub(crate) fn to_format(f: &fub_abi::format::DocumentFormat) -> w_format::DocumentFormat {
    w_format::DocumentFormat {
        descriptor: w_format::FormatDescriptor {
            id: f.descriptor.id.clone(),
            name: f.descriptor.name.clone(),
            extensions: f.descriptor.extensions.clone(),
            source: match f.descriptor.source {
                fub_abi::format::SourceKind::Text => w_format::SourceKind::Text,
                fub_abi::format::SourceKind::Bytes => w_format::SourceKind::Bytes,
            },
        },
        capabilities: w_format::FormatCapabilities {
            syntax: to_map(&f.capabilities.syntax),
        },
    }
}

pub(crate) fn to_document_source(
    source: &fub_abi::format::DocumentSource,
) -> x_format::DocumentSource {
    match source {
        fub_abi::format::DocumentSource::Text(text) => x_format::DocumentSource::Text(text.clone()),
        fub_abi::format::DocumentSource::Bytes(bytes) => {
            x_format::DocumentSource::Bytes(bytes.clone())
        }
    }
}

pub(crate) fn to_parse_context(ctx: &fub_abi::format::ParseContext) -> x_format::ParseContext {
    x_format::ParseContext {
        doc_id: ctx.doc_id.clone(),
        options: to_map(&ctx.options),
    }
}

pub(crate) fn to_render_options(opts: &fub_abi::format::RenderOptions) -> x_format::RenderOptions {
    x_format::RenderOptions {
        target: match opts.target {
            fub_abi::format::RenderTarget::Screen => x_format::RenderTarget::Screen,
            fub_abi::format::RenderTarget::Print => x_format::RenderTarget::Print,
            fub_abi::format::RenderTarget::Pdf => x_format::RenderTarget::Pdf,
            fub_abi::format::RenderTarget::StaticSite => x_format::RenderTarget::StaticSite,
        },
        options: to_map(&opts.options),
    }
}

pub(crate) fn from_format_error(error: x_format::FormatError) -> fub_abi::FormatError {
    match error {
        x_format::FormatError::Parse(message) => fub_abi::FormatError::Parse(message),
        x_format::FormatError::Render(message) => fub_abi::FormatError::Render(message),
        x_format::FormatError::Serialize(message) => fub_abi::FormatError::Serialize(message),
        x_format::FormatError::Unsupported(error) => fub_abi::FormatError::Unsupported {
            format: error.format,
            got: match error.got {
                x_format::SourceKind::Text => fub_abi::format::SourceKind::Text,
                x_format::SourceKind::Bytes => fub_abi::format::SourceKind::Bytes,
            },
        },
    }
}
pub(crate) fn from_format_descriptor(
    descriptor: x_format::FormatDescriptor,
) -> fub_abi::format::FormatDescriptor {
    fub_abi::format::FormatDescriptor {
        id: descriptor.id,
        name: descriptor.name,
        extensions: descriptor.extensions,
        source: match descriptor.source {
            x_format::SourceKind::Text => fub_abi::format::SourceKind::Text,
            x_format::SourceKind::Bytes => fub_abi::format::SourceKind::Bytes,
        },
    }
}
pub(crate) fn from_format_capabilities(
    capabilities: x_format::FormatCapabilities,
) -> Result<fub_abi::format::FormatCapabilities, PluginError> {
    Ok(fub_abi::format::FormatCapabilities {
        syntax: from_map(capabilities.syntax)?,
    })
}

pub(crate) fn to_trash(and: fub_abi::traits::TrashEntry) -> w_vault::TrashEntry {
    w_vault::TrashEntry {
        id: and.id.0,
        original: and.original.0,
        deleted_at: and.deleted_at,
        size: and.size,
    }
}

// ---------------------------------------------------------------------------
// Il fuoco: ciò che `host-env.active-context` risponde
// ---------------------------------------------------------------------------

/// Lo `span` del contratto è a 64 bit, quello di `fub-abi` è `usize`: al
/// confine la larghezza è dichiarata, in casa è quella della macchina. La
/// conversione è larga in questo verso — un `usize` ci sta sempre in un `u64`
/// sulle macchine che questo progetto compila — e stretta nell'altro, che è
pub(crate) fn to_span(s: fub_abi::model::Span) -> w_model::Span {
    w_model::Span {
        start: s.start as u64,
        end: s.end as u64,
    }
}

/// Il verso che [`to_span`] aveva lasciato aperto: **il giorno è arrivato con i
/// comandi**, perché un `command-effect.reveal` e un `text-edit` sono i primi
/// span che il componente scrive e l'host legge.
///
/// Qui la conversione stringe, e per questo può fallire. Un `as usize` non
/// fallisce mai e sarebbe il modo peggiore di cavarsela: su una macchina a 32
/// bit farebbe di `2^32` uno zero, cioè uno span **perfettamente plausibile**
/// in un punto che nessuno aveva chiesto — un edit che comincia dall'inizio del
/// documento invece di essere rifiutato. Che sia `BadArgs` e non `Internal` è la
/// regola di [`from_json`]: quel numero l'ha scritto il componente.
///
/// Che `start` sia prima di `end` non lo controlla questa funzione. Lo controlla
/// [`EditRequest::apply_to`](fub_abi::edit::EditRequest::apply_to), che ha
/// davanti anche il sorgente e sa dire pure «fuori dal documento» e «a metà di
/// un carattere»: un secondo punto in cui si decide cos'è uno span buono
/// sarebbe un secondo punto da tenere allineato al primo.
fn from_span(s: w_model::Span) -> Result<fub_abi::model::Span, PluginError> {
    fn narrow(v: u64, which: &str) -> Result<usize, PluginError> {
        usize::try_from(v).map_err(|_| {
            PluginError::BadArgs(
                format!("lo span ha un{which} che questa macchina non indirizza: {v}").into(),
            )
        })
    }
    Ok(fub_abi::model::Span {
        start: narrow(s.start, " inizio")?,
        end: narrow(s.end, "a fine")?,
    })
}

pub(crate) fn to_view_context(c: &fub_abi::session::ViewContext) -> w_session::ViewContext {
    w_session::ViewContext {
        pane: c.pane.0.clone(),
        doc: c.doc.as_ref().map(|d| d.0.clone()),
        selections: c.selections.as_ref().map(to_selection_set),
        mode: match c.mode {
            fub_abi::session::PaneMode::Source => w_session::PaneMode::Source,
            fub_abi::session::PaneMode::LivePreview => w_session::PaneMode::LivePreview,
            fub_abi::session::PaneMode::Reading => w_session::PaneMode::Reading,
        },
    }
}

fn to_selection_set(s: &fub_abi::session::SelectionSet) -> w_session::SelectionSet {
    match s {
        fub_abi::session::SelectionSet::Anchored(a) => {
            w_session::SelectionSet::Anchored(w_session::AnchoredSelections {
                primary: to_anchored(&a.primary),
                secondary: a.secondary.iter().map(to_anchored).collect(),
            })
        }
        fub_abi::session::SelectionSet::Floating(f) => {
            w_session::SelectionSet::Floating(w_session::FloatingSelections {
                primary: to_floating(&f.primary),
                secondary: f.secondary.iter().map(to_floating).collect(),
            })
        }
    }
}

fn to_anchored(s: &fub_abi::session::AnchoredSelection) -> w_session::AnchoredSelection {
    w_session::AnchoredSelection {
        span: to_span(s.span),
        text: s.text.clone(),
    }
}

fn to_floating(s: &fub_abi::session::FloatingSelection) -> w_session::FloatingSelection {
    w_session::FloatingSelection {
        text: s.text.clone(),
    }
}

// ---------------------------------------------------------------------------
// I comandi: il secondo trait che attraversa, e il primo albero grande
// ---------------------------------------------------------------------------
//
// `Plugin` scambiava quattro cose piccole — un manifest, un job, una stringa
// JSON. `CommandProvider` scambia il primo albero del contratto che ha una
// profondità vera: un esito porta un effetto, l'effetto può portare un piano,
// il piano porta gli edit di N documenti, e accanto ci sono un annullamento
// fatto di passi e un parziale fatto di guasti. Tradurlo per intero è il
// prezzo dichiarato del «un trait, due backend»: la traduzione a metà — quella
// che ammette l'esito e lascia cadere il piano — sarebbe un provider WASM che
// nel dry-run risponde «non farei niente», cioè la bugia peggiore che questo
// confine possa dire.
//
// Il verso è quasi tutto `from_*`: dei comandi l'host **legge** ciò che il
// componente dichiara e risponde. L'unica cosa che passa di là è il modo

fn from_doc(id: String) -> fub_abi::model::DocId {
    fub_abi::model::DocId(id)
}

fn from_choice(c: w_command::Choice) -> fub_abi::command::Choice {
    fub_abi::command::Choice {
        value: c.value,
        title: from_text(c.title),
    }
}

fn from_param_kind(k: w_command::ParamKind) -> fub_abi::command::ParamKind {
    use fub_abi::command::ParamKind as R;
    match k {
        w_command::ParamKind::Text => R::Text,
        w_command::ParamKind::Number => R::Number,
        w_command::ParamKind::Bool => R::Bool,
        w_command::ParamKind::Document => R::Document,
        w_command::ParamKind::Documents => R::Documents,
        w_command::ParamKind::Choice(c) => R::Choice(c.into_iter().map(from_choice).collect()),
        w_command::ParamKind::Numbers => R::Numbers,
    }
}

fn from_param_spec(p: w_command::ParamSpec) -> fub_abi::command::ParamSpec {
    fub_abi::command::ParamSpec {
        name: p.name,
        title: from_text(p.title),
        description: from_text(p.description),
        kind: from_param_kind(p.kind),
        required: p.required,
    }
}

fn from_command_scope(s: w_command::CommandScope) -> fub_abi::command::CommandScope {
    use fub_abi::command::CommandReach as R;
    fub_abi::command::CommandScope {
        writes: s.writes,
        reach: match s.reach {
            w_command::CommandReach::Session => R::Session,
            w_command::CommandReach::Document => R::Document,
            w_command::CommandReach::Documents => R::Documents,
            w_command::CommandReach::Vault => R::Vault,
            w_command::CommandReach::Settings => R::Settings,
        },
        reversible: s.reversible,
    }
}

/// Ciò che un componente **dichiara** di saper fare.
///
/// Non c'è convalida qui, e non è una dimenticanza: l'id fuori dal proprio
/// namespace lo rifiuta `Workspace::register_command_provider`, la forma di una
/// scorciatoia la legge `fub_abi::rules::keys`, e gli argomenti li convalida il
/// kernel prima di chiamare `invoke`. Un componente non è più sospetto di una
/// feature nativa: passa dalla stessa porta, e la porta è già chiusa a chiave.
/// feature nativa: passa dalla stessa porta, e la porta è già chiusa a chiave.
pub(crate) fn from_command_spec(s: w_command::CommandSpec) -> fub_abi::command::CommandSpec {
    fub_abi::command::CommandSpec {
        id: s.id,
        title: from_text(s.title),
        description: from_text(s.description),
        keybinding: s.keybinding,
        params: s.params.into_iter().map(from_param_spec).collect(),
        scope: from_command_scope(s.scope),
    }
}

/// Come si sta invocando. È l'unica cosa dei comandi che va **verso** il
/// componente, e nel contratto non ha un default: un `apply` implicito è
/// l'errore che quell'enum esiste per rendere impossibile, e tradurlo con un
/// `unwrap_or` lo reintrodurrebbe qui.
pub(crate) fn to_invoke_mode(m: fub_abi::command::InvokeMode) -> w_command::InvokeMode {
    match m {
        fub_abi::command::InvokeMode::Apply => w_command::InvokeMode::Apply,
        fub_abi::command::InvokeMode::DryRun => w_command::InvokeMode::DryRun,
    }
}

fn from_text_edit(and: w_edit::TextEdit) -> Result<fub_abi::edit::TextEdit, PluginError> {
    Ok(fub_abi::edit::TextEdit {
        span: from_span(and.span)?,
        text: and.text,
    })
}

fn from_edit_request(r: w_edit::EditRequest) -> Result<fub_abi::edit::EditRequest, PluginError> {
    Ok(fub_abi::edit::EditRequest {
        base: fub_abi::edit::Revision(r.base),
        edits: r
            .edits
            .into_iter()
            .map(from_text_edit)
            .collect::<Result<_, _>>()?,
    })
}

fn from_planned_edit(
    p: w_command::PlannedEdit,
) -> Result<fub_abi::command::PlannedEdit, PluginError> {
    Ok(fub_abi::command::PlannedEdit {
        doc: from_doc(p.doc),
        edit: from_edit_request(p.edit)?,
    })
}

fn from_command_plan(
    p: w_command::CommandPlan,
) -> Result<fub_abi::command::CommandPlan, PluginError> {
    Ok(fub_abi::command::CommandPlan {
        summary: from_text(p.summary),
        docs: p.docs.into_iter().map(from_doc).collect(),
        edits: p
            .edits
            .into_iter()
            .map(from_planned_edit)
            .collect::<Result<_, _>>()?,
    })
}

fn from_command_effect(
    and: w_command::CommandEffect,
) -> Result<fub_abi::command::CommandEffect, PluginError> {
    use fub_abi::command::CommandEffect as R;
    Ok(match and {
        w_command::CommandEffect::Done => R::Done,
        w_command::CommandEffect::Navigate(d) => R::Navigate { doc: from_doc(d) },
        w_command::CommandEffect::Reveal(r) => R::Reveal {
            doc: from_doc(r.doc),
            span: from_span(r.span)?,
        },
        w_command::CommandEffect::RunSearch(q) => R::RunSearch { query: q },
        w_command::CommandEffect::Plan(p) => R::Plan(from_command_plan(p)?),
        w_command::CommandEffect::Custom(c) => R::Custom {
            ns: c.ns,
            payload: from_json(&c.payload)?,
        },
        w_command::CommandEffect::OpenView(v) => R::OpenView {
            view: v.view,
            params: from_json(&v.params)?,
        },
    })
}

fn from_undo_step(s: w_command::UndoStep) -> Result<fub_abi::command::UndoStep, PluginError> {
    Ok(match s {
        w_command::UndoStep::Edit(and) => fub_abi::command::UndoStep::Edit(from_planned_edit(and)?),
        w_command::UndoStep::Command(c) => fub_abi::command::UndoStep::Command {
            command: c.command,
            args: from_json(&c.args)?,
        },
    })
}

fn from_undo(u: w_command::Undo) -> Result<fub_abi::command::Undo, PluginError> {
    Ok(fub_abi::command::Undo {
        label: from_text(u.label),
        // Nell'ordine in cui vanno eseguiti, che è quello in cui il componente
        // li ha scritti: chi esegue non riordina, e nemmeno chi traduce.
        // li ha scritti: chi esegue non riordina, e nemmeno chi traduce.
        steps: u
            .steps
            .into_iter()
            .map(from_undo_step)
            .collect::<Result<_, _>>()?,
    })
}

fn from_failure(f: w_command::Failure) -> fub_abi::command::Failure {
    fub_abi::command::Failure {
        subject: f.subject.map(from_doc),
        error: from_error(f.error),
    }
}

fn from_partial(p: w_command::Partial) -> fub_abi::command::Partial {
    fub_abi::command::Partial {
        attempted: p.attempted,
        done: p.done,
        failures: p.failures.into_iter().map(from_failure).collect(),
    }
}

/// L'esito di un comando, per intero.
pub(crate) fn from_command_outcome(
    or: w_command::CommandOutcome,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    Ok(fub_abi::command::CommandOutcome {
        notify: or.notify.map(from_text),
        effect: from_command_effect(or.effect)?,
        undo: or.undo.map(from_undo).transpose()?,
        partial: or.partial.map(from_partial),
    })
}

// ---------------------------------------------------------------------------
// Le view dichiarative
// ---------------------------------------------------------------------------

fn from_view_surface(s: w_view::ViewSurface) -> fub_abi::traits::ViewSurface {
    use fub_abi::traits::ViewSurface as R;
    match s {
        w_view::ViewSurface::LeftSidebar => R::LeftSidebar,
        w_view::ViewSurface::RightSidebar => R::RightSidebar,
        w_view::ViewSurface::Bottom => R::Bottom,
        w_view::ViewSurface::Main => R::Main,
        w_view::ViewSurface::Modal => R::Modal,
        w_view::ViewSurface::StatusBar => R::StatusBar,
        w_view::ViewSurface::Ribbon => R::Ribbon,
        w_view::ViewSurface::Menu => R::Menu,
        w_view::ViewSurface::ContextMenu => R::ContextMenu,
        w_view::ViewSurface::SettingsTab => R::SettingsTab,
    }
}

fn from_event_kind(k: w_events::EventKind) -> fub_abi::event::EventKind {
    use fub_abi::event::EventKind as R;
    match k {
        w_events::EventKind::VaultOpened => R::VaultOpened,
        w_events::EventKind::DocumentChanged => R::DocumentChanged,
        w_events::EventKind::DocumentRemoved => R::DocumentRemoved,
        w_events::EventKind::DocumentRenamed => R::DocumentRenamed,
        w_events::EventKind::IndexUpdated => R::IndexUpdated,
        w_events::EventKind::JobDone => R::JobDone,
        w_events::EventKind::Overflow => R::Overflow,
        w_events::EventKind::Custom => R::Custom,
        w_events::EventKind::BatchEnded => R::BatchEnded,
        w_events::EventKind::ViewInvalidated => R::ViewInvalidated,
        w_events::EventKind::VaultClosed => R::VaultClosed,
        w_events::EventKind::JobStarted => R::JobStarted,
        w_events::EventKind::JobProgress => R::JobProgress,
        w_events::EventKind::SettingChanged => R::SettingChanged,
        w_events::EventKind::EntryChanged => R::EntryChanged,
        w_events::EventKind::EntryRemoved => R::EntryRemoved,
        w_events::EventKind::EntryRenamed => R::EntryRenamed,
        w_events::EventKind::Trouble => R::Trouble,
        w_events::EventKind::TimerFired => R::TimerFired,
    }
}

fn from_subject(s: w_events::Subject) -> fub_abi::event::Subject {
    match s {
        w_events::Subject::Document(d) => fub_abi::event::Subject::document(d.id),
        w_events::Subject::Folder(f) => fub_abi::event::Subject::folder(f.path),
    }
}

fn from_doc_change(c: w_events::DocChange) -> fub_abi::event::DocChange {
    match c {
        w_events::DocChange::Body => fub_abi::event::DocChange::Body,
        w_events::DocChange::Frontmatter => fub_abi::event::DocChange::Frontmatter,
        w_events::DocChange::Tags => fub_abi::event::DocChange::Tags,
        w_events::DocChange::Links => fub_abi::event::DocChange::Links,
        w_events::DocChange::Outline => fub_abi::event::DocChange::Outline,
        w_events::DocChange::Anchors => fub_abi::event::DocChange::Anchors,
    }
}

fn from_event_mask(m: w_events::EventMask) -> fub_abi::event::EventMask {
    fub_abi::event::EventMask {
        kinds: m.kinds.into_iter().map(from_event_kind).collect(),
        topics: m.topics,
        subjects: m.subjects.into_iter().map(from_subject).collect(),
        changes: m.changes.into_iter().map(from_doc_change).collect(),
    }
}

fn from_context_mask(m: Vec<w_session::ContextKind>) -> fub_abi::session::ContextMask {
    fub_abi::session::ContextMask(
        m.into_iter()
            .map(|k| match k {
                w_session::ContextKind::Document => fub_abi::session::ContextKind::Document,
                w_session::ContextKind::Selection => fub_abi::session::ContextKind::Selection,
                w_session::ContextKind::Mode => fub_abi::session::ContextKind::Mode,
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Grid provider
// ---------------------------------------------------------------------------

pub(crate) fn from_grid_surface(
    surface: w_grid::GridSurfaceSpec,
) -> Result<fub_abi::grid::GridSurfaceSpec, PluginError> {
    let surface = fub_abi::grid::GridSurfaceSpec {
        id: surface.id,
        format: surface.format,
        family: surface.family,
        protocol_version: surface.protocol_version,
    };
    surface.validate()?;
    if surface.family != fub_abi::grid::GRID_FAMILY
        || surface.protocol_version != fub_abi::grid::GRID_PROTOCOL_VERSION
    {
        return Err(PluginError::BadArgs(
            "unsupported grid family or protocol version".into(),
        ));
    }
    Ok(surface)
}

fn from_grid_revision(revision: String) -> fub_abi::Revision {
    fub_abi::Revision(revision)
}

pub(crate) fn to_grid_revision(revision: &fub_abi::Revision) -> String {
    revision.0.clone()
}

fn from_grid_sheet(sheet: w_grid::GridSheet) -> fub_abi::grid::GridSheet {
    fub_abi::grid::GridSheet {
        id: sheet.id,
        name: sheet.name,
        row_count: sheet.row_count,
        column_count: sheet.column_count,
    }
}

pub(crate) fn from_grid_session(
    session: w_grid::GridSession,
) -> Result<fub_abi::grid::GridSession, PluginError> {
    let session = fub_abi::grid::GridSession {
        instance: session.instance,
        revision: from_grid_revision(session.revision),
        sheets: session.sheets.into_iter().map(from_grid_sheet).collect(),
    };
    session.validate()?;
    Ok(session)
}

fn from_grid_key(key: w_grid::GridCellKey) -> fub_abi::grid::GridCellKey {
    fub_abi::grid::GridCellKey {
        sheet: key.sheet,
        row: key.row,
        column: key.column,
    }
}

fn to_grid_key(key: &fub_abi::grid::GridCellKey) -> w_grid::GridCellKey {
    w_grid::GridCellKey {
        sheet: key.sheet.clone(),
        row: key.row.clone(),
        column: key.column.clone(),
    }
}

fn from_grid_horizontal(
    horizontal: w_grid::GridHorizontalAlign,
) -> fub_abi::grid::GridHorizontalAlign {
    match horizontal {
        w_grid::GridHorizontalAlign::Start => fub_abi::grid::GridHorizontalAlign::Start,
        w_grid::GridHorizontalAlign::Center => fub_abi::grid::GridHorizontalAlign::Center,
        w_grid::GridHorizontalAlign::End => fub_abi::grid::GridHorizontalAlign::End,
    }
}

fn from_grid_style(style: w_grid::GridCellStyle) -> fub_abi::grid::GridCellStyle {
    fub_abi::grid::GridCellStyle {
        bold: style.bold,
        italic: style.italic,
        text_color: style.text_color,
        fill_color: style.fill_color,
        horizontal: style.horizontal.map(from_grid_horizontal),
        number_format: style.number_format,
    }
}

fn from_grid_formula_error(error: w_grid::GridFormulaError) -> fub_abi::grid::GridFormulaError {
    match error {
        w_grid::GridFormulaError::Parse => fub_abi::grid::GridFormulaError::Parse,
        w_grid::GridFormulaError::Ref => fub_abi::grid::GridFormulaError::Ref,
        w_grid::GridFormulaError::Name => fub_abi::grid::GridFormulaError::Name,
        w_grid::GridFormulaError::Value => fub_abi::grid::GridFormulaError::Value,
        w_grid::GridFormulaError::DivZero => fub_abi::grid::GridFormulaError::DivZero,
        w_grid::GridFormulaError::Num => fub_abi::grid::GridFormulaError::Num,
        w_grid::GridFormulaError::Cycle => fub_abi::grid::GridFormulaError::Cycle,
    }
}

fn from_grid_value(value: w_grid::GridCellValue) -> fub_abi::grid::GridCellValue {
    match value {
        w_grid::GridCellValue::Blank => fub_abi::grid::GridCellValue::Blank,
        w_grid::GridCellValue::Number(value) => fub_abi::grid::GridCellValue::Number(value),
        w_grid::GridCellValue::Text(value) => fub_abi::grid::GridCellValue::Text(value),
        w_grid::GridCellValue::Boolean(value) => fub_abi::grid::GridCellValue::Boolean(value),
        w_grid::GridCellValue::Error(error) => {
            fub_abi::grid::GridCellValue::Error(from_grid_formula_error(error))
        }
    }
}

fn from_grid_row(row: w_grid::GridRow) -> fub_abi::grid::GridRow {
    fub_abi::grid::GridRow {
        id: row.id,
        index: row.index,
        height: row.height,
        hidden: row.hidden,
    }
}

fn from_grid_column(column: w_grid::GridColumn) -> fub_abi::grid::GridColumn {
    fub_abi::grid::GridColumn {
        id: column.id,
        index: column.index,
        width: column.width,
        hidden: column.hidden,
    }
}

fn from_grid_cell(cell: w_grid::GridCell) -> fub_abi::grid::GridCell {
    fub_abi::grid::GridCell {
        key: from_grid_key(cell.key),
        input: cell.input,
        style: from_grid_style(cell.style),
        value: from_grid_value(cell.value),
    }
}

pub(crate) fn from_grid_window(
    window: w_grid::GridWindow,
) -> Result<fub_abi::grid::GridWindow, PluginError> {
    let window = fub_abi::grid::GridWindow {
        revision: from_grid_revision(window.revision),
        sheet: window.sheet,
        row_start: window.row_start,
        column_start: window.column_start,
        total_rows: window.total_rows,
        total_columns: window.total_columns,
        rows: window.rows.into_iter().map(from_grid_row).collect(),
        columns: window.columns.into_iter().map(from_grid_column).collect(),
        cells: window.cells.into_iter().map(from_grid_cell).collect(),
    };
    window.validate()?;
    Ok(window)
}

pub(crate) fn to_grid_window_request(
    request: &fub_abi::grid::GridWindowRequest,
) -> w_grid::GridWindowRequest {
    w_grid::GridWindowRequest {
        revision: to_grid_revision(&request.revision),
        sheet: request.sheet.clone(),
        row_start: request.row_start,
        row_count: request.row_count,
        column_start: request.column_start,
        column_count: request.column_count,
    }
}

fn to_grid_patch(patch: &fub_abi::grid::GridCellPatch) -> w_grid::GridCellPatch {
    w_grid::GridCellPatch {
        cell: to_grid_key(&patch.cell),
        before: patch.before.clone(),
        after: patch.after.clone(),
    }
}

pub(crate) fn to_grid_apply_request(
    request: &fub_abi::grid::GridApplyRequest,
) -> w_grid::GridApplyRequest {
    w_grid::GridApplyRequest {
        revision: to_grid_revision(&request.revision),
        patches: request.patches.iter().map(to_grid_patch).collect(),
    }
}

fn from_grid_invalidation(
    invalidation: w_grid::GridInvalidation,
) -> fub_abi::grid::GridInvalidation {
    match invalidation {
        w_grid::GridInvalidation::Cells(cells) => {
            fub_abi::grid::GridInvalidation::Cells(cells.into_iter().map(from_grid_key).collect())
        }
        w_grid::GridInvalidation::All => fub_abi::grid::GridInvalidation::All,
    }
}

pub(crate) fn from_grid_commit(
    commit: w_grid::GridCommit,
) -> Result<fub_abi::grid::GridCommit, PluginError> {
    let commit = fub_abi::grid::GridCommit {
        revision: from_grid_revision(commit.revision),
        edit: fub_abi::grid::GridSourceEdit {
            from: commit.edit.from,
            to: commit.edit.to,
            deleted: commit.edit.deleted,
            inserted: commit.edit.inserted,
        },
        invalidation: from_grid_invalidation(commit.invalidation),
    };
    commit.validate()?;
    Ok(commit)
}

pub(crate) fn from_view_spec(
    s: w_view::ViewSpec,
) -> Result<fub_abi::traits::ViewSpec, PluginError> {
    Ok(fub_abi::traits::ViewSpec {
        id: s.id,
        title: from_text(s.title),
        surface: from_view_surface(s.surface),
        refresh: from_event_mask(s.refresh),
        follows: from_context_mask(s.follows),
        params: s.params.into_iter().map(from_param_spec).collect(),
        icon: s.icon,
        order: s.order,
        open_by_default: s.open_by_default,
        preferred_size: s.preferred_size,
        closable: s.closable,
    })
}

pub(crate) fn from_view_interests(
    i: w_view::ViewInterests,
) -> Result<fub_abi::traits::ViewInterests, PluginError> {
    Ok(fub_abi::traits::ViewInterests {
        refresh: from_event_mask(i.refresh),
        follows: from_context_mask(i.follows),
    })
}

pub(crate) fn to_view_instance(
    i: &fub_abi::traits::ViewInstance,
) -> Result<w_view::ViewInstance, PluginError> {
    Ok(w_view::ViewInstance {
        view: i.view.clone(),
        instance: i.instance.clone(),
        params: to_json(&i.params),
    })
}
