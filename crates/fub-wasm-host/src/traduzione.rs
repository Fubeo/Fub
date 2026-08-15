//! **Le stesse cose, dette due volte.**
//!
//! Ogni tipo del contratto esiste qui in due copie: quella che `bindgen!` ha
//! generato dal WIT (`crate::contratto::…`) e quella scritta a mano in
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
//! `da_*` porta dal WIT al Rust (ciò che il componente dice), `in_*` porta dal
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
use crate::contratto::exports::fub::abi::{command as w_command, plugin as w_plugin};
// I tipi che l'interfaccia esportata `use`a da altre — `model.{span}`,
// `edit.{edit-request}`, `text.{text}` — restano invece gli stessi delle
// importate: la duplicazione qui sopra riguarda i tipi che un'interfaccia
// **definisce**, non quelli che prende in prestito.
use crate::contratto::fub::abi::{
    edit as w_edit, errors as w_errors, format as w_format, host_vault_read as w_vault,
    index as w_index, intl as w_intl, model as w_model, options as w_options, session as w_session,
    settings as w_settings, text as w_text, ui as w_ui,
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
pub(crate) fn da_json(s: &str) -> Result<serde_json::Value, PluginError> {
    serde_json::from_str(s)
        .map_err(|e| PluginError::BadArgs(format!("json non valido: {e}").into()))
}

/// Il verso opposto. Non può fallire: `serde_json::Value` è per costruzione
/// serializzabile.
pub(crate) fn in_json(v: &serde_json::Value) -> String {
    v.to_string()
}

// ---------------------------------------------------------------------------
// Testo ed errori
// ---------------------------------------------------------------------------

pub(crate) fn da_testo(t: w_text::Text) -> fub_abi::text::Text {
    match t {
        w_text::Text::Literal(s) => fub_abi::text::Text::Literal(s),
        w_text::Text::Message(m) => fub_abi::text::Text::Message(fub_abi::text::Message {
            key: m.key,
            args: m.args.into_iter().map(da_arg).collect(),
        }),
    }
}

pub(crate) fn in_testo(t: &fub_abi::text::Text) -> w_text::Text {
    match t {
        fub_abi::text::Text::Literal(s) => w_text::Text::Literal(s.clone()),
        fub_abi::text::Text::Message(m) => w_text::Text::Message(w_text::Message {
            key: m.key.clone(),
            args: m.args.iter().map(in_arg).collect(),
        }),
    }
}

fn da_arg(a: w_text::Arg) -> fub_abi::text::Arg {
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

fn in_arg(a: &fub_abi::text::Arg) -> w_text::Arg {
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
pub(crate) fn da_errore(e: w_errors::PluginError) -> PluginError {
    use w_errors::PluginError as W;
    match e {
        W::UnknownCommand(t) => PluginError::UnknownCommand(da_testo(t)),
        W::UnknownView(t) => PluginError::UnknownView(da_testo(t)),
        W::UnknownJob(t) => PluginError::UnknownJob(da_testo(t)),
        W::BadArgs(t) => PluginError::BadArgs(da_testo(t)),
        W::PermissionDenied(t) => PluginError::PermissionDenied(da_testo(t)),
        W::Internal(t) => PluginError::Internal(da_testo(t)),
        W::Conflict(t) => PluginError::Conflict(da_testo(t)),
        W::Unserved(t) => PluginError::Unserved(da_testo(t)),
        W::Cancelled(t) => PluginError::Cancelled(da_testo(t)),
        W::NotFound(t) => PluginError::NotFound(da_testo(t)),
        W::AlreadyExists(t) => PluginError::AlreadyExists(da_testo(t)),
        W::Io(t) => PluginError::Io(da_testo(t)),
    }
}

/// L'errore che l'host restituisce a una capacità. **È il verso che porta il
/// rifiuto del `Guard`**: un `permission-denied` deciso nel kernel arriva al
/// componente da qui, e arriva come valore — non come trap (vedi il doc di
/// `crate::contratto`).
pub(crate) fn in_errore(e: &PluginError) -> w_errors::PluginError {
    use w_errors::PluginError as W;
    match e {
        PluginError::UnknownCommand(t) => W::UnknownCommand(in_testo(t)),
        PluginError::UnknownView(t) => W::UnknownView(in_testo(t)),
        PluginError::UnknownJob(t) => W::UnknownJob(in_testo(t)),
        PluginError::BadArgs(t) => W::BadArgs(in_testo(t)),
        PluginError::PermissionDenied(t) => W::PermissionDenied(in_testo(t)),
        PluginError::Internal(t) => W::Internal(in_testo(t)),
        PluginError::Conflict(t) => W::Conflict(in_testo(t)),
        PluginError::Unserved(t) => W::Unserved(in_testo(t)),
        PluginError::Cancelled(t) => W::Cancelled(in_testo(t)),
        PluginError::NotFound(t) => W::NotFound(in_testo(t)),
        PluginError::AlreadyExists(t) => W::AlreadyExists(in_testo(t)),
        PluginError::Io(t) => W::Io(in_testo(t)),
    }
}

// ---------------------------------------------------------------------------
// La mappa che nel WIT è una lista
// ---------------------------------------------------------------------------

/// `option-map` è `list<option-entry>` perché WIT non ha mappe. La chiave
/// duplicata **vince l'ultima**, come farebbe un `insert`: rifiutare vorrebbe
/// dire far cadere un manifest per una ripetizione che non cambia il senso.
pub(crate) fn da_mappa(
    m: w_options::OptionMap,
) -> Result<fub_abi::options::OptionMap, PluginError> {
    let mut out = fub_abi::options::OptionMap::new();
    for voce in m {
        out.set(voce.key, da_json(&voce.value)?);
    }
    Ok(out)
}

pub(crate) fn in_mappa(m: &fub_abi::options::OptionMap) -> w_options::OptionMap {
    m.iter()
        .map(|(k, v)| w_options::OptionEntry {
            key: k.to_string(),
            value: in_json(v),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------

fn da_ui_option(o: w_ui::UiOption) -> fub_abi::ui::UiOption {
    fub_abi::ui::UiOption {
        value: o.value,
        label: da_testo(o.label),
    }
}

fn da_setting_kind(k: w_settings::SettingKind) -> fub_abi::settings::SettingKind {
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
            options: c.options.into_iter().map(da_ui_option).collect(),
        },
        w_settings::SettingKind::List(l) => R::List { default: l.default },
    }
}

fn da_setting_spec(s: w_settings::SettingSpec) -> fub_abi::settings::SettingSpec {
    fub_abi::settings::SettingSpec {
        key: s.key,
        label: da_testo(s.label),
        description: da_testo(s.description),
        group: da_testo(s.group),
        scope: match s.scope {
            w_settings::SettingScope::Vault => fub_abi::settings::SettingScope::Vault,
            w_settings::SettingScope::Machine => fub_abi::settings::SettingScope::Machine,
        },
        kind: da_setting_kind(s.kind),
        program_writable: s.program_writable,
    }
}

// ---------------------------------------------------------------------------
// Locale e sveglie: il giorno della settimana è uno solo
// ---------------------------------------------------------------------------

pub(crate) fn in_weekday(g: fub_abi::locale::Weekday) -> w_intl::Weekday {
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

pub(crate) fn da_weekday(g: w_intl::Weekday) -> fub_abi::locale::Weekday {
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

pub(crate) fn in_locale(l: &fub_abi::locale::Locale) -> w_intl::Locale {
    w_intl::Locale {
        language: l.language.clone(),
        timezone: l.timezone.clone(),
        utc_offset_minutes: l.utc_offset_minutes,
        first_day_of_week: in_weekday(l.first_day_of_week),
        hour_cycle: match l.hour_cycle {
            fub_abi::locale::HourCycle::H23 => w_intl::HourCycle::H23,
            fub_abi::locale::HourCycle::H12 => w_intl::HourCycle::H12,
        },
    }
}

fn da_wall_clock(w: w_plugin::WallClock) -> fub_abi::traits::WallClock {
    fub_abi::traits::WallClock {
        hour: w.hour,
        minute: w.minute,
        days: w.days.into_iter().map(da_weekday).collect(),
        zone: w.zone,
        catch_up_seconds: w.catch_up_seconds,
    }
}

fn da_timer(t: w_plugin::TimerSpec) -> fub_abi::traits::TimerSpec {
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
                fub_abi::traits::TimerSchedule::AtWallClock(da_wall_clock(w))
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
pub(crate) fn da_manifest(
    m: w_plugin::PluginManifest,
) -> Result<fub_abi::traits::PluginManifest, PluginError> {
    Ok(fub_abi::traits::PluginManifest {
        id: m.id,
        name: m.name,
        version: m.version,
        abi_version: m.abi_version,
        permissions: fub_abi::traits::PluginPermissions {
            granted: da_mappa(m.permissions.granted)?,
        },
        provides: m.provides,
        requires: m.requires,
        settings: m.settings.into_iter().map(da_setting_spec).collect(),
        strings: m
            .strings
            .into_iter()
            .map(|c| fub_abi::text::StringCatalog {
                locale: c.locale,
                entries: c.entries.into_iter().collect(),
            })
            .collect(),
        default_locale: m.default_locale,
        timers: m.timers.into_iter().map(da_timer).collect(),
    })
}

// ---------------------------------------------------------------------------
// Il vault: ciò che `host-vault-read` risponde
// ---------------------------------------------------------------------------

pub(crate) fn da_page(p: Option<w_index::Page>) -> Option<fub_abi::traits::Page> {
    p.map(|p| fub_abi::traits::Page {
        offset: p.offset,
        limit: p.limit,
    })
}

pub(crate) fn in_doc_ids_page(
    p: fub_abi::traits::Paged<fub_abi::model::DocId>,
) -> w_index::DocIdsPage {
    w_index::DocIdsPage {
        items: p.items.into_iter().map(|d| d.0).collect(),
        offset: p.offset,
        total: p.total,
    }
}

pub(crate) fn in_formato(f: &fub_abi::format::DocumentFormat) -> w_format::DocumentFormat {
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
            syntax: in_mappa(&f.capabilities.syntax),
        },
    }
}

pub(crate) fn in_cestino(e: fub_abi::traits::TrashEntry) -> w_vault::TrashEntry {
    w_vault::TrashEntry {
        id: e.id.0,
        original: e.original.0,
        deleted_at: e.deleted_at,
        size: e.size,
    }
}

// ---------------------------------------------------------------------------
// Il fuoco: ciò che `host-env.active-context` risponde
// ---------------------------------------------------------------------------

/// Lo `span` del contratto è a 64 bit, quello di `fub-abi` è `usize`: al
/// confine la larghezza è dichiarata, in casa è quella della macchina. La
/// conversione è larga in questo verso — un `usize` ci sta sempre in un `u64`
/// sulle macchine che questo progetto compila — e stretta nell'altro, che è
/// [`da_span`].
pub(crate) fn in_span(s: fub_abi::model::Span) -> w_model::Span {
    w_model::Span {
        start: s.start as u64,
        end: s.end as u64,
    }
}

/// Il verso che [`in_span`] aveva lasciato aperto: **il giorno è arrivato con i
/// comandi**, perché un `command-effect.reveal` e un `text-edit` sono i primi
/// span che il componente scrive e l'host legge.
///
/// Qui la conversione stringe, e per questo può fallire. Un `as usize` non
/// fallisce mai e sarebbe il modo peggiore di cavarsela: su una macchina a 32
/// bit farebbe di `2^32` uno zero, cioè uno span **perfettamente plausibile**
/// in un punto che nessuno aveva chiesto — un edit che comincia dall'inizio del
/// documento invece di essere rifiutato. Che sia `BadArgs` e non `Internal` è la
/// regola di [`da_json`]: quel numero l'ha scritto il componente.
///
/// Che `start` sia prima di `end` non lo controlla questa funzione. Lo controlla
/// [`EditRequest::apply_to`](fub_abi::edit::EditRequest::apply_to), che ha
/// davanti anche il sorgente e sa dire pure «fuori dal documento» e «a metà di
/// un carattere»: un secondo punto in cui si decide cos'è uno span buono
/// sarebbe un secondo punto da tenere allineato al primo.
fn da_span(s: w_model::Span) -> Result<fub_abi::model::Span, PluginError> {
    fn stretto(v: u64, quale: &str) -> Result<usize, PluginError> {
        usize::try_from(v).map_err(|_| {
            PluginError::BadArgs(
                format!("lo span ha un{quale} che questa macchina non indirizza: {v}").into(),
            )
        })
    }
    Ok(fub_abi::model::Span {
        start: stretto(s.start, " inizio")?,
        end: stretto(s.end, "a fine")?,
    })
}

pub(crate) fn in_view_context(c: &fub_abi::session::ViewContext) -> w_session::ViewContext {
    w_session::ViewContext {
        pane: c.pane.0.clone(),
        doc: c.doc.as_ref().map(|d| d.0.clone()),
        selections: c.selections.as_ref().map(in_selection_set),
        mode: match c.mode {
            fub_abi::session::PaneMode::Source => w_session::PaneMode::Source,
            fub_abi::session::PaneMode::LivePreview => w_session::PaneMode::LivePreview,
            fub_abi::session::PaneMode::Reading => w_session::PaneMode::Reading,
        },
    }
}

fn in_selection_set(s: &fub_abi::session::SelectionSet) -> w_session::SelectionSet {
    match s {
        fub_abi::session::SelectionSet::Anchored(a) => {
            w_session::SelectionSet::Anchored(w_session::AnchoredSelections {
                primary: in_ancorata(&a.primary),
                secondary: a.secondary.iter().map(in_ancorata).collect(),
            })
        }
        fub_abi::session::SelectionSet::Floating(f) => {
            w_session::SelectionSet::Floating(w_session::FloatingSelections {
                primary: in_libera(&f.primary),
                secondary: f.secondary.iter().map(in_libera).collect(),
            })
        }
    }
}

fn in_ancorata(s: &fub_abi::session::AnchoredSelection) -> w_session::AnchoredSelection {
    w_session::AnchoredSelection {
        span: in_span(s.span),
        text: s.text.clone(),
    }
}

fn in_libera(s: &fub_abi::session::FloatingSelection) -> w_session::FloatingSelection {
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
// Il verso è quasi tutto `da_*`: dei comandi l'host **legge** ciò che il
// componente dichiara e risponde. L'unica cosa che passa di là è il modo
// dell'invocazione, che è `in_invoke_mode`.

fn da_doc(id: String) -> fub_abi::model::DocId {
    fub_abi::model::DocId(id)
}

fn da_choice(c: w_command::Choice) -> fub_abi::command::Choice {
    fub_abi::command::Choice {
        value: c.value,
        title: da_testo(c.title),
    }
}

fn da_param_kind(k: w_command::ParamKind) -> fub_abi::command::ParamKind {
    use fub_abi::command::ParamKind as R;
    match k {
        w_command::ParamKind::Text => R::Text,
        w_command::ParamKind::Number => R::Number,
        w_command::ParamKind::Bool => R::Bool,
        w_command::ParamKind::Document => R::Document,
        w_command::ParamKind::Documents => R::Documents,
        w_command::ParamKind::Choice(c) => R::Choice(c.into_iter().map(da_choice).collect()),
        w_command::ParamKind::Numbers => R::Numbers,
    }
}

fn da_param_spec(p: w_command::ParamSpec) -> fub_abi::command::ParamSpec {
    fub_abi::command::ParamSpec {
        name: p.name,
        title: da_testo(p.title),
        description: da_testo(p.description),
        kind: da_param_kind(p.kind),
        required: p.required,
    }
}

fn da_command_scope(s: w_command::CommandScope) -> fub_abi::command::CommandScope {
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
/// scorciatoia la legge `fub_abi::rules::tasti`, e gli argomenti li convalida il
/// kernel prima di chiamare `invoke`. Un componente non è più sospetto di una
/// feature nativa: passa dalla stessa porta, e la porta è già chiusa a chiave.
pub(crate) fn da_command_spec(s: w_command::CommandSpec) -> fub_abi::command::CommandSpec {
    fub_abi::command::CommandSpec {
        id: s.id,
        title: da_testo(s.title),
        description: da_testo(s.description),
        keybinding: s.keybinding,
        params: s.params.into_iter().map(da_param_spec).collect(),
        scope: da_command_scope(s.scope),
    }
}

/// Come si sta invocando. È l'unica cosa dei comandi che va **verso** il
/// componente, e nel contratto non ha un default: un `apply` implicito è
/// l'errore che quell'enum esiste per rendere impossibile, e tradurlo con un
/// `unwrap_or` lo reintrodurrebbe qui.
pub(crate) fn in_invoke_mode(m: fub_abi::command::InvokeMode) -> w_command::InvokeMode {
    match m {
        fub_abi::command::InvokeMode::Apply => w_command::InvokeMode::Apply,
        fub_abi::command::InvokeMode::DryRun => w_command::InvokeMode::DryRun,
    }
}

fn da_text_edit(e: w_edit::TextEdit) -> Result<fub_abi::edit::TextEdit, PluginError> {
    Ok(fub_abi::edit::TextEdit {
        span: da_span(e.span)?,
        text: e.text,
    })
}

fn da_edit_request(r: w_edit::EditRequest) -> Result<fub_abi::edit::EditRequest, PluginError> {
    Ok(fub_abi::edit::EditRequest {
        base: fub_abi::edit::Revision(r.base),
        edits: r
            .edits
            .into_iter()
            .map(da_text_edit)
            .collect::<Result<_, _>>()?,
    })
}

fn da_planned_edit(
    p: w_command::PlannedEdit,
) -> Result<fub_abi::command::PlannedEdit, PluginError> {
    Ok(fub_abi::command::PlannedEdit {
        doc: da_doc(p.doc),
        edit: da_edit_request(p.edit)?,
    })
}

fn da_command_plan(
    p: w_command::CommandPlan,
) -> Result<fub_abi::command::CommandPlan, PluginError> {
    Ok(fub_abi::command::CommandPlan {
        summary: da_testo(p.summary),
        docs: p.docs.into_iter().map(da_doc).collect(),
        edits: p
            .edits
            .into_iter()
            .map(da_planned_edit)
            .collect::<Result<_, _>>()?,
    })
}

fn da_command_effect(
    e: w_command::CommandEffect,
) -> Result<fub_abi::command::CommandEffect, PluginError> {
    use fub_abi::command::CommandEffect as R;
    Ok(match e {
        w_command::CommandEffect::Done => R::Done,
        w_command::CommandEffect::Navigate(d) => R::Navigate { doc: da_doc(d) },
        w_command::CommandEffect::Reveal(r) => R::Reveal {
            doc: da_doc(r.doc),
            span: da_span(r.span)?,
        },
        w_command::CommandEffect::RunSearch(q) => R::RunSearch { query: q },
        w_command::CommandEffect::Plan(p) => R::Plan(da_command_plan(p)?),
        w_command::CommandEffect::Custom(c) => R::Custom {
            ns: c.ns,
            payload: da_json(&c.payload)?,
        },
        w_command::CommandEffect::OpenView(v) => R::OpenView {
            view: v.view,
            params: da_json(&v.params)?,
        },
    })
}

fn da_undo_step(s: w_command::UndoStep) -> Result<fub_abi::command::UndoStep, PluginError> {
    Ok(match s {
        w_command::UndoStep::Edit(e) => fub_abi::command::UndoStep::Edit(da_planned_edit(e)?),
        w_command::UndoStep::Command(c) => fub_abi::command::UndoStep::Command {
            command: c.command,
            args: da_json(&c.args)?,
        },
    })
}

fn da_undo(u: w_command::Undo) -> Result<fub_abi::command::Undo, PluginError> {
    Ok(fub_abi::command::Undo {
        label: da_testo(u.label),
        // Nell'ordine in cui vanno eseguiti, che è quello in cui il componente
        // li ha scritti: chi esegue non riordina, e nemmeno chi traduce.
        steps: u
            .steps
            .into_iter()
            .map(da_undo_step)
            .collect::<Result<_, _>>()?,
    })
}

fn da_failure(f: w_command::Failure) -> fub_abi::command::Failure {
    fub_abi::command::Failure {
        subject: f.subject.map(da_doc),
        error: da_errore(f.error),
    }
}

fn da_partial(p: w_command::Partial) -> fub_abi::command::Partial {
    fub_abi::command::Partial {
        attempted: p.attempted,
        done: p.done,
        failures: p.failures.into_iter().map(da_failure).collect(),
    }
}

/// L'esito di un comando, per intero.
pub(crate) fn da_command_outcome(
    o: w_command::CommandOutcome,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    Ok(fub_abi::command::CommandOutcome {
        notify: o.notify.map(da_testo),
        effect: da_command_effect(o.effect)?,
        undo: o.undo.map(da_undo).transpose()?,
        partial: o.partial.map(da_partial),
    })
}
