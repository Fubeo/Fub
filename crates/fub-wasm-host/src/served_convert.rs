//! **Le stesse cose, dette al contrario, per le famiglie che il guest chiama.**
//!
//! [`crate::inbound_convert`] traduce ciò che l'host chiede a un componente
//! (una domanda all'indice di un provider) e ciò che il componente risponde.
//! Qui il verso è l'opposto: è il componente a chiedere — `host-query`,
//! `host-commands`, `host-settings-*`, `host-vault-write`, `host-network` — e
//! l'host a rispondere. I nomi seguono la regola di [`crate::translate`]:
//! `from_*` dal WIT al Rust, `to_*` dal Rust al WIT.
//!
//! I tipi WIT sono quelli della copia **importata** (`crate::contract::fub::abi`):
//! `index` e `command` sono anche interfacce esportate, e `bindgen!` ne genera
//! due copie distinte. Le conversioni di `inbound_convert` lavorano sull'altra,
//! e per questo non si riusano.
//!
//! Le regole sono quelle di `inbound_convert`: `match` esaustivi, nessuna
//! bandiera persa, e ciò che il WIT non sa dire è `Unserved` che lo nomina —
//! mai un pezzo lasciato cadere in silenzio.

use fub_abi::PluginError;

use crate::contract::fub::abi::{
    command as w_command, edit as w_edit, index as w_index, jobs as w_jobs, model as w_model,
    net as w_net, organization as w_org, settings as w_settings, syntax as w_syntax, ui as w_ui,
};
use crate::translate as tr;

fn from_doc(id: String) -> fub_abi::model::DocId {
    fub_abi::model::DocId(id)
}

fn to_doc(id: &fub_abi::model::DocId) -> String {
    id.0.clone()
}

fn to_revision(r: &fub_abi::edit::Revision) -> String {
    r.0.clone()
}

// ---------------------------------------------------------------------------
// host-vault-write
// ---------------------------------------------------------------------------

pub(crate) fn from_write_base(b: w_edit::WriteBase) -> fub_abi::edit::WriteBase {
    match b {
        w_edit::WriteBase::DescendsFrom(r) => {
            fub_abi::edit::WriteBase::DescendsFrom(fub_abi::edit::Revision(r))
        }
        w_edit::WriteBase::Dictated => fub_abi::edit::WriteBase::Dictated,
    }
}

pub(crate) fn to_edit_report(r: &fub_abi::edit::EditReport) -> w_edit::EditReport {
    w_edit::EditReport {
        revision: to_revision(&r.revision),
        applied: r
            .applied
            .iter()
            .map(|a| w_edit::AppliedEdit {
                span: tr::to_span(a.span),
                replaced: a.replaced.clone(),
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// host-settings-*
// ---------------------------------------------------------------------------

pub(crate) fn from_setting_value(v: w_settings::SettingValue) -> fub_abi::settings::SettingValue {
    use fub_abi::settings::SettingValue as R;
    match v {
        w_settings::SettingValue::Toggle(b) => R::Toggle(b),
        w_settings::SettingValue::Number(n) => R::Number(n),
        w_settings::SettingValue::Text(s) => R::Text(s),
        w_settings::SettingValue::List(items) => R::List(items),
    }
}

pub(crate) fn to_setting_value(v: &fub_abi::settings::SettingValue) -> w_settings::SettingValue {
    use fub_abi::settings::SettingValue as R;
    match v {
        R::Toggle(b) => w_settings::SettingValue::Toggle(*b),
        R::Number(n) => w_settings::SettingValue::Number(*n),
        R::Text(s) => w_settings::SettingValue::Text(s.clone()),
        R::List(items) => w_settings::SettingValue::List(items.clone()),
    }
}

fn to_setting_entry(e: &fub_abi::settings::SettingEntry) -> w_settings::SettingEntry {
    w_settings::SettingEntry {
        spec: to_setting_spec(&e.spec),
        value: to_setting_value(&e.value),
        source: match e.source {
            fub_abi::settings::SettingSource::Default => w_settings::SettingSource::Default,
            fub_abi::settings::SettingSource::Machine => w_settings::SettingSource::Machine,
            fub_abi::settings::SettingSource::Vault => w_settings::SettingSource::Vault,
        },
    }
}

fn to_setting_spec(s: &fub_abi::settings::SettingSpec) -> w_settings::SettingSpec {
    use fub_abi::settings::SettingKind as R;
    w_settings::SettingSpec {
        key: s.key.clone(),
        label: tr::to_text(&s.label),
        description: tr::to_text(&s.description),
        group: tr::to_text(&s.group),
        scope: match s.scope {
            fub_abi::settings::SettingScope::Vault => w_settings::SettingScope::Vault,
            fub_abi::settings::SettingScope::Machine => w_settings::SettingScope::Machine,
        },
        kind: match &s.kind {
            R::Toggle { default } => {
                w_settings::SettingKind::Toggle(w_settings::SettingToggle { default: *default })
            }
            R::Number { default, min, max } => {
                w_settings::SettingKind::Number(w_settings::SettingNumber {
                    default: *default,
                    min: *min,
                    max: *max,
                })
            }
            R::Text { default } => w_settings::SettingKind::Text(w_settings::SettingText {
                default: default.clone(),
            }),
            R::Choice { default, options } => {
                w_settings::SettingKind::Choice(w_settings::SettingChoice {
                    default: default.clone(),
                    options: options
                        .iter()
                        .map(|o| w_ui::UiOption {
                            value: o.value.clone(),
                            label: tr::to_text(&o.label),
                        })
                        .collect(),
                })
            }
            R::List { default } => w_settings::SettingKind::List(w_settings::SettingList {
                default: default.clone(),
            }),
        },
        program_writable: s.program_writable,
    }
}

// ---------------------------------------------------------------------------
// host-network
// ---------------------------------------------------------------------------

fn from_http_header(h: w_net::HttpHeader) -> fub_abi::net::HttpHeader {
    fub_abi::net::HttpHeader {
        name: h.name,
        value: h.value,
    }
}

pub(crate) fn from_http_request(r: w_net::HttpRequest) -> fub_abi::net::HttpRequest {
    use fub_abi::net::HttpMethod as R;
    fub_abi::net::HttpRequest {
        url: r.url,
        method: match r.method {
            w_net::HttpMethod::Get => R::Get,
            w_net::HttpMethod::Head => R::Head,
            w_net::HttpMethod::Post => R::Post,
            w_net::HttpMethod::Put => R::Put,
            w_net::HttpMethod::Patch => R::Patch,
            w_net::HttpMethod::Delete => R::Delete,
        },
        headers: r.headers.into_iter().map(from_http_header).collect(),
        body: r.body,
    }
}

pub(crate) fn to_http_response(r: fub_abi::net::HttpResponse) -> w_net::HttpResponse {
    w_net::HttpResponse {
        status: r.status,
        headers: r
            .headers
            .into_iter()
            .map(|h| w_net::HttpHeader {
                name: h.name,
                value: h.value,
            })
            .collect(),
        body: r.body,
    }
}

// ---------------------------------------------------------------------------
// host-commands
// ---------------------------------------------------------------------------

fn to_planned_edit(p: &fub_abi::command::PlannedEdit) -> w_command::PlannedEdit {
    w_command::PlannedEdit {
        doc: to_doc(&p.doc),
        edit: tr::to_edit_request(&p.edit),
    }
}

fn to_command_effect(e: &fub_abi::command::CommandEffect) -> w_command::CommandEffect {
    use fub_abi::command::CommandEffect as R;
    match e {
        R::Done => w_command::CommandEffect::Done,
        R::Navigate { doc } => w_command::CommandEffect::Navigate(to_doc(doc)),
        R::Reveal { doc, span } => {
            w_command::CommandEffect::Reveal(w_command::CommandEffectReveal {
                doc: to_doc(doc),
                span: tr::to_span(*span),
            })
        }
        R::RunSearch { query } => w_command::CommandEffect::RunSearch(query.clone()),
        R::Plan(p) => w_command::CommandEffect::Plan(w_command::CommandPlan {
            summary: tr::to_text(&p.summary),
            docs: p.docs.iter().map(to_doc).collect(),
            edits: p.edits.iter().map(to_planned_edit).collect(),
        }),
        R::Custom { ns, payload } => {
            w_command::CommandEffect::Custom(w_command::CommandEffectCustom {
                ns: ns.clone(),
                payload: tr::to_json(payload),
            })
        }
        R::OpenView { view, params } => {
            w_command::CommandEffect::OpenView(w_command::CommandEffectOpenView {
                view: view.clone(),
                params: tr::to_json(params),
            })
        }
    }
}

fn to_undo(u: &fub_abi::command::Undo) -> w_command::Undo {
    w_command::Undo {
        label: tr::to_text(&u.label),
        steps: u
            .steps
            .iter()
            .map(|s| match s {
                fub_abi::command::UndoStep::Edit(e) => {
                    w_command::UndoStep::Edit(to_planned_edit(e))
                }
                fub_abi::command::UndoStep::Command { command, args } => {
                    w_command::UndoStep::Command(w_command::UndoStepCommand {
                        command: command.clone(),
                        args: tr::to_json(args),
                    })
                }
            })
            .collect(),
    }
}

fn to_partial(p: &fub_abi::command::Partial) -> w_command::Partial {
    w_command::Partial {
        attempted: p.attempted,
        done: p.done,
        failures: p
            .failures
            .iter()
            .map(|f| w_command::Failure {
                subject: f.subject.as_ref().map(to_doc),
                error: tr::to_error(&f.error),
            })
            .collect(),
    }
}

pub(crate) fn to_command_outcome(
    o: &fub_abi::command::CommandOutcome,
) -> w_command::CommandOutcome {
    w_command::CommandOutcome {
        notify: o.notify.as_ref().map(tr::to_text),
        effect: to_command_effect(&o.effect),
        undo: o.undo.as_ref().map(to_undo),
        partial: o.partial.as_ref().map(to_partial),
    }
}

pub(crate) fn to_undone(u: &fub_abi::command::Undone) -> w_command::Undone {
    w_command::Undone {
        label: tr::to_text(&u.label),
        operation: u.operation.as_ref().map(to_partial),
        replay: u.replay.as_ref().map(to_partial),
    }
}

// ---------------------------------------------------------------------------
// host-query: la domanda (WIT → Rust)
// ---------------------------------------------------------------------------

fn from_page(p: w_index::Page) -> fub_abi::traits::Page {
    fub_abi::traits::Page {
        offset: p.offset,
        limit: p.limit,
    }
}

fn from_direction(d: w_index::LinkDirection) -> fub_abi::traits::LinkDirection {
    use fub_abi::traits::LinkDirection as R;
    match d {
        w_index::LinkDirection::Outbound => R::Outbound,
        w_index::LinkDirection::Inbound => R::Inbound,
        w_index::LinkDirection::Both => R::Both,
    }
}

fn from_health_check(c: w_index::HealthCheck) -> fub_abi::traits::HealthCheck {
    use fub_abi::traits::HealthCheck as R;
    match c {
        w_index::HealthCheck::BrokenLinks => R::BrokenLinks,
        w_index::HealthCheck::OrphanDocuments => R::OrphanDocuments,
        w_index::HealthCheck::CollidingPaths => R::CollidingPaths,
        w_index::HealthCheck::UnrecognizedDates => R::UnrecognizedDates,
        w_index::HealthCheck::DeadEnds => R::DeadEnds,
        w_index::HealthCheck::UnusedAttachments => R::UnusedAttachments,
    }
}

fn to_health_check(c: &fub_abi::traits::HealthCheck) -> w_index::HealthCheck {
    use fub_abi::traits::HealthCheck as R;
    match c {
        R::BrokenLinks => w_index::HealthCheck::BrokenLinks,
        R::OrphanDocuments => w_index::HealthCheck::OrphanDocuments,
        R::CollidingPaths => w_index::HealthCheck::CollidingPaths,
        R::UnrecognizedDates => w_index::HealthCheck::UnrecognizedDates,
        R::DeadEnds => w_index::HealthCheck::DeadEnds,
        R::UnusedAttachments => w_index::HealthCheck::UnusedAttachments,
    }
}

fn from_folder_scope(s: w_index::FolderScope) -> fub_abi::traits::FolderScope {
    fub_abi::traits::FolderScope {
        path: s.path,
        descendants: s.descendants,
    }
}

fn from_entry_kind(k: w_model::EntryKind) -> fub_abi::traits::EntryKind {
    use fub_abi::traits::EntryKind as R;
    match k {
        w_model::EntryKind::Document => R::Document,
        w_model::EntryKind::Asset => R::Asset,
        w_model::EntryKind::Unknown => R::Unknown,
    }
}

fn to_entry_kind(k: &fub_abi::traits::EntryKind) -> w_model::EntryKind {
    use fub_abi::traits::EntryKind as R;
    match k {
        R::Document => w_model::EntryKind::Document,
        R::Asset => w_model::EntryKind::Asset,
        R::Unknown => w_model::EntryKind::Unknown,
    }
}

/// La domanda del componente, dal WIT al Rust. Fallisce con `BadArgs` soltanto
/// dove il componente ha scritto qualcosa che non si legge: un JSON rotto.
pub(crate) fn from_index_query(
    q: w_index::IndexQuery,
) -> Result<fub_abi::traits::IndexQuery, PluginError> {
    use fub_abi::traits::IndexQuery as R;
    Ok(match q {
        w_index::IndexQuery::Documents(d) => R::Documents {
            matching: from_expr(d.matching)?,
            sort: d.sort.map(|s| fub_abi::traits::PropertySort {
                key: s.key,
                descending: s.descending,
            }),
            select: match d.select {
                w_index::PropertySelect::None => fub_abi::traits::PropertySelect::None,
                w_index::PropertySelect::All => fub_abi::traits::PropertySelect::All,
                w_index::PropertySelect::Keys(k) => {
                    fub_abi::traits::PropertySelect::Keys { keys: k.keys }
                }
            },
            page: d.page.map(from_page),
            excerpts: match d.excerpts {
                w_index::Excerpts::Attach => fub_abi::traits::Excerpts::Attach,
                w_index::Excerpts::Omit => fub_abi::traits::Excerpts::Omit,
            },
        },
        w_index::IndexQuery::Backlinks(b) => R::Backlinks {
            target: from_doc(b.target),
            page: b.page.map(from_page),
        },
        w_index::IndexQuery::Outline(doc) => R::Outline { doc: from_doc(doc) },
        w_index::IndexQuery::Tags(t) => R::Tags {
            matching: from_expr(t.matching)?,
            page: t.page.map(from_page),
        },
        w_index::IndexQuery::Neighbors(n) => R::Neighbors {
            seeds: from_expr(n.seeds)?,
            direction: from_direction(n.direction),
            depth: n.depth,
            page: n.page.map(from_page),
        },
        w_index::IndexQuery::PropertyValues(p) => R::PropertyValues {
            key: p.key,
            matching: from_expr(p.matching)?,
            page: p.page.map(from_page),
        },
        w_index::IndexQuery::VaultHealth(h) => R::VaultHealth {
            check: from_health_check(h.check),
            page: h.page.map(from_page),
        },
        w_index::IndexQuery::Custom(c) => R::Custom {
            ns: c.ns,
            query: tr::from_json(&c.query)?,
        },
        w_index::IndexQuery::VaultStatus => R::VaultStatus,
        w_index::IndexQuery::Jobs => R::Jobs,
        w_index::IndexQuery::Settings(plugin) => R::Settings { plugin },
        w_index::IndexQuery::Organization => R::Organization,
        w_index::IndexQuery::Resolve(r) => R::Resolve {
            target: crate::model::from_target(r.target),
            from: r.from.map(from_doc),
        },
        w_index::IndexQuery::Entries(e) => R::Entries {
            of_kind: e.of_kind.map(from_entry_kind),
            within: e.within.map(from_folder_scope),
            page: e.page.map(from_page),
        },
        w_index::IndexQuery::Folders(f) => R::Folders {
            under: f.under.map(from_folder_scope),
            page: f.page.map(from_page),
        },
        w_index::IndexQuery::Drafts(d) => R::Drafts {
            page: d.page.map(from_page),
        },
        w_index::IndexQuery::RenderPreview(doc) => R::RenderPreview { doc: from_doc(doc) },
        w_index::IndexQuery::RenderEmbed(e) => R::RenderEmbed {
            page: e.page,
            heading: e.heading,
            block: e.block,
        },
        w_index::IndexQuery::SyntaxForms(doc) => R::SyntaxForms { doc: from_doc(doc) },
        w_index::IndexQuery::RenderPrint(doc) => R::RenderPrint { doc: from_doc(doc) },
    })
}

fn from_expr(e: w_index::QueryExpr) -> Result<fub_abi::query::QueryExpr, PluginError> {
    Ok(fub_abi::query::QueryExpr {
        any: e
            .any
            .into_iter()
            .map(|c| {
                Ok(fub_abi::query::QueryClause {
                    all: c
                        .all
                        .into_iter()
                        .map(|l| {
                            Ok(fub_abi::query::QueryLiteral {
                                negated: l.negated,
                                predicate: from_predicate(l.predicate)?,
                            })
                        })
                        .collect::<Result<_, PluginError>>()?,
                })
            })
            .collect::<Result<_, PluginError>>()?,
    })
}

fn from_predicate(
    p: w_index::QueryPredicate,
) -> Result<fub_abi::query::QueryPredicate, PluginError> {
    use fub_abi::query::QueryPredicate as R;
    Ok(match p {
        w_index::QueryPredicate::Text(t) => R::Text(from_text_query(t)),
        w_index::QueryPredicate::Property(f) => R::Property {
            filter: fub_abi::traits::PropertyFilter {
                key: f.key,
                test: from_property_test(f.test)?,
            },
        },
        w_index::QueryPredicate::Tag(t) => R::Tag {
            name: t.name,
            descendants: t.descendants,
        },
        w_index::QueryPredicate::Folder(f) => R::Folder {
            path: f.path,
            descendants: f.descendants,
        },
        w_index::QueryPredicate::Linked(l) => R::Linked {
            doc: from_doc(l.doc),
            direction: from_direction(l.direction),
        },
        w_index::QueryPredicate::Docs(d) => R::Docs {
            docs: d.docs.into_iter().map(from_doc).collect(),
        },
        w_index::QueryPredicate::Custom(c) => R::Custom {
            ns: c.ns,
            predicate: tr::from_json(&c.predicate)?,
        },
        w_index::QueryPredicate::Regex(r) => R::Regex {
            pattern: r.pattern,
            fields: r.fields.into_iter().map(from_text_field).collect(),
        },
        w_index::QueryPredicate::Task(t) => R::Task {
            status: match t.status {
                w_index::TaskStatus::Open => fub_abi::query::TaskStatus::Open,
                w_index::TaskStatus::Done => fub_abi::query::TaskStatus::Done,
            },
        },
        w_index::QueryPredicate::Path(p) => R::Path { glob: p.glob },
        w_index::QueryPredicate::File(f) => R::File {
            extension: f.extension,
        },
        w_index::QueryPredicate::Scoped(s) => R::Scoped {
            scope: match s.scope {
                w_index::TextScope::Line => fub_abi::query::TextScope::Line,
                w_index::TextScope::Block => fub_abi::query::TextScope::Block,
                w_index::TextScope::Section => fub_abi::query::TextScope::Section,
            },
            text: from_text_query(s.text),
        },
        w_index::QueryPredicate::TaskDue(d) => R::TaskDue {
            min: d.min.map(from_due_bound),
            max: d.max.map(from_due_bound),
        },
    })
}

fn from_due_bound(b: w_index::DueBound) -> fub_abi::query::DueBound {
    fub_abi::query::DueBound {
        date: b.date,
        inclusive: b.inclusive,
    }
}

fn from_text_query(t: w_index::TextQuery) -> fub_abi::query::TextQuery {
    fub_abi::query::TextQuery {
        text: t.text,
        mode: match t.mode {
            w_index::TextMode::Terms => fub_abi::query::TextMode::Terms,
            w_index::TextMode::Phrase => fub_abi::query::TextMode::Phrase,
        },
        fields: t.fields.into_iter().map(from_text_field).collect(),
        tolerance: match t.tolerance {
            w_index::TextTolerance::Exact => fub_abi::query::TextTolerance::Exact,
            w_index::TextTolerance::Typos => fub_abi::query::TextTolerance::Typos,
        },
        partial_last_term: t.partial_last_term,
        case_sensitive: t.case_sensitive,
    }
}

fn from_text_field(f: w_index::TextField) -> fub_abi::query::TextField {
    use fub_abi::query::TextField as R;
    match f {
        w_index::TextField::Name => R::Name,
        w_index::TextField::Body => R::Body,
        w_index::TextField::Tags => R::Tags,
        w_index::TextField::Heading => R::Heading,
    }
}

fn from_property_test(
    t: w_index::PropertyTest,
) -> Result<fub_abi::traits::PropertyTest, PluginError> {
    use fub_abi::traits::PropertyTest as R;
    Ok(match t {
        w_index::PropertyTest::Exists => R::Exists,
        w_index::PropertyTest::Missing => R::Missing,
        w_index::PropertyTest::Equals(v) => R::Equals(from_property_value(v)?),
        w_index::PropertyTest::NotEquals(v) => R::NotEquals(from_property_value(v)?),
        w_index::PropertyTest::Contains(s) => R::Contains(from_property_scalar(s)?),
        w_index::PropertyTest::GreaterThan(v) => R::GreaterThan(from_property_value(v)?),
        w_index::PropertyTest::LessThan(v) => R::LessThan(from_property_value(v)?),
    })
}

fn from_property_value(
    v: w_model::PropertyValue,
) -> Result<fub_abi::model::PropertyValue, PluginError> {
    use fub_abi::model::PropertyValue as R;
    Ok(match v {
        w_model::PropertyValue::Empty => R::Empty,
        w_model::PropertyValue::Text(s) => R::Text(s),
        w_model::PropertyValue::Number(n) => R::Number(n),
        w_model::PropertyValue::Bool(b) => R::Bool(b),
        w_model::PropertyValue::Date(d) => R::Date(from_property_date(d)),
        w_model::PropertyValue::Link(t) => R::Link(crate::model::from_target(t)),
        w_model::PropertyValue::List(items) => R::List(
            items
                .into_iter()
                .map(from_property_scalar)
                .collect::<Result<_, _>>()?,
        ),
        w_model::PropertyValue::Unknown(j) => R::Unknown(tr::from_json(&j)?),
    })
}

fn from_property_scalar(
    v: w_model::PropertyScalar,
) -> Result<fub_abi::model::PropertyScalar, PluginError> {
    use fub_abi::model::PropertyScalar as R;
    Ok(match v {
        w_model::PropertyScalar::Empty => R::Empty,
        w_model::PropertyScalar::Text(s) => R::Text(s),
        w_model::PropertyScalar::Number(n) => R::Number(n),
        w_model::PropertyScalar::Bool(b) => R::Bool(b),
        w_model::PropertyScalar::Date(d) => R::Date(from_property_date(d)),
        w_model::PropertyScalar::Link(t) => R::Link(crate::model::from_target(t)),
        w_model::PropertyScalar::Unknown(j) => R::Unknown(tr::from_json(&j)?),
    })
}

fn from_property_date(d: w_model::PropertyDate) -> fub_abi::model::PropertyDate {
    fub_abi::model::PropertyDate {
        year: d.year,
        month: d.month,
        day: d.day,
        time: d.time.map(|t| fub_abi::model::PropertyTime {
            hour: t.hour,
            minute: t.minute,
            second: t.second,
            offset_minutes: t.offset_minutes,
        }),
    }
}

// ---------------------------------------------------------------------------
// host-query: la risposta (Rust → WIT)
// ---------------------------------------------------------------------------

fn to_property_value(v: &fub_abi::model::PropertyValue) -> w_model::PropertyValue {
    use fub_abi::model::PropertyValue as R;
    match v {
        R::Empty => w_model::PropertyValue::Empty,
        R::Text(s) => w_model::PropertyValue::Text(s.clone()),
        R::Number(n) => w_model::PropertyValue::Number(*n),
        R::Bool(b) => w_model::PropertyValue::Bool(*b),
        R::Date(d) => w_model::PropertyValue::Date(to_property_date(d)),
        R::Link(t) => w_model::PropertyValue::Link(crate::model::to_target(t)),
        R::List(items) => {
            w_model::PropertyValue::List(items.iter().map(to_property_scalar).collect())
        }
        R::Unknown(j) => w_model::PropertyValue::Unknown(tr::to_json(j)),
    }
}

fn to_property_scalar(v: &fub_abi::model::PropertyScalar) -> w_model::PropertyScalar {
    use fub_abi::model::PropertyScalar as R;
    match v {
        R::Empty => w_model::PropertyScalar::Empty,
        R::Text(s) => w_model::PropertyScalar::Text(s.clone()),
        R::Number(n) => w_model::PropertyScalar::Number(*n),
        R::Bool(b) => w_model::PropertyScalar::Bool(*b),
        R::Date(d) => w_model::PropertyScalar::Date(to_property_date(d)),
        R::Link(t) => w_model::PropertyScalar::Link(crate::model::to_target(t)),
        R::Unknown(j) => w_model::PropertyScalar::Unknown(tr::to_json(j)),
    }
}

fn to_property_date(d: &fub_abi::model::PropertyDate) -> w_model::PropertyDate {
    w_model::PropertyDate {
        year: d.year,
        month: d.month,
        day: d.day,
        time: d.time.as_ref().map(|t| w_model::PropertyTime {
            hour: t.hour,
            minute: t.minute,
            second: t.second,
            offset_minutes: t.offset_minutes,
        }),
    }
}

fn to_doc_position(p: &fub_abi::traits::DocPosition) -> w_index::DocPosition {
    w_index::DocPosition {
        span: tr::to_span(p.span),
        anchor: p.anchor.clone(),
        revision: to_revision(&p.revision),
    }
}

fn to_document_match(m: &fub_abi::traits::DocumentMatch) -> w_index::DocumentMatch {
    w_index::DocumentMatch {
        doc: to_doc(&m.doc),
        score: m.score,
        snippet: m.snippet.clone(),
        highlights: m.highlights.iter().map(|s| tr::to_span(*s)).collect(),
        properties: m
            .properties
            .iter()
            .map(|e| w_index::PropertyEntry {
                key: e.key.clone(),
                value: to_property_value(&e.value),
            })
            .collect(),
        occurrences: m.occurrences.iter().map(to_doc_position).collect(),
    }
}

/// Le parti di resa sono alberi UI, e l'albero UI attraversa oggi in un verso
/// solo — dal componente all'host. Una resa che ne ha non si consegna
/// dimezzata: è `Unserved`, e lo dice. L'HTML da solo passa.
fn to_rendered_html(
    html: &str,
    parts: &[fub_abi::render::RenderedPart],
) -> Result<(String, Vec<w_index::RenderedPart>), PluginError> {
    if !parts.is_empty() {
        return Err(PluginError::Unserved(fub_abi::text::Text::key(
            "host.wasm.render_parts",
        )));
    }
    Ok((html.to_string(), Vec::new()))
}

fn to_rendered(
    r: &fub_abi::render::RenderedDocument,
) -> Result<w_index::RenderedDocument, PluginError> {
    let (html, parts) = to_rendered_html(&r.html, &r.parts)?;
    Ok(w_index::RenderedDocument { html, parts })
}

fn to_syntax_trigger(t: &fub_abi::custom::SyntaxTrigger) -> w_syntax::SyntaxTrigger {
    match t {
        fub_abi::custom::SyntaxTrigger::Fence { info } => {
            w_syntax::SyntaxTrigger::Fence(w_syntax::SyntaxTriggerFence { info: info.clone() })
        }
        fub_abi::custom::SyntaxTrigger::Inline { open, close } => {
            w_syntax::SyntaxTrigger::Inline(w_syntax::SyntaxTriggerInline {
                open: open.clone(),
                close: close.clone(),
            })
        }
    }
}

fn to_job_status(s: &fub_abi::traits::JobStatus) -> w_jobs::JobStatus {
    w_jobs::JobStatus {
        id: s.id.0,
        job: s.job.clone(),
        plugin: s.plugin.clone(),
        since: s.since,
        progress: s.progress.as_ref().map(|p| w_jobs::JobProgress {
            done: p.done,
            total: p.total,
            label: p.label.clone(),
        }),
    }
}

fn to_organization(o: &fub_abi::organization::Organization) -> w_org::Organization {
    w_org::Organization {
        icons: o
            .icons
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        pinned: o.pinned.clone(),
        order: o
            .order
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        spaces: o.spaces.clone(),
    }
}

/// La risposta dell'host, dal Rust al WIT.
pub(crate) fn to_index_result(
    r: &fub_abi::traits::IndexResult,
) -> Result<w_index::IndexResult, PluginError> {
    use fub_abi::traits::IndexResult as R;
    Ok(match r {
        R::Documents(p) => w_index::IndexResult::Documents(w_index::DocumentsPage {
            items: p.items.iter().map(to_document_match).collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Backlinks(p) => w_index::IndexResult::Backlinks(w_index::BacklinksPage {
            items: p
                .items
                .iter()
                .map(|b| w_index::BacklinkRef {
                    source: to_doc(&b.source),
                    context: b.context.clone(),
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Outline(items) => w_index::IndexResult::Outline(
            items
                .iter()
                .map(|h| w_model::Heading {
                    level: h.level,
                    text: h.text.clone(),
                    slug: h.slug.clone(),
                    span: tr::to_span(h.span),
                    explicit_anchor: h.explicit_anchor.clone(),
                })
                .collect(),
        ),
        R::Tags(p) => w_index::IndexResult::Tags(w_index::TagsPage {
            items: p
                .items
                .iter()
                .map(|t| w_index::TagCount {
                    name: t.name.clone(),
                    count: t.count,
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Neighbors(p) => w_index::IndexResult::Neighbors(w_index::NeighborsPage {
            items: p
                .items
                .iter()
                .map(|n| w_index::NeighborRef {
                    doc: to_doc(&n.doc),
                    via: to_doc(&n.via),
                    depth: n.depth,
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::PropertyValues(p) => w_index::IndexResult::PropertyValues(w_index::PropertyValuesPage {
            items: p
                .items
                .iter()
                .map(|c| w_index::PropertyCount {
                    value: to_property_value(&c.value),
                    count: c.count,
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::VaultHealth(p) => w_index::IndexResult::VaultHealth(w_index::VaultHealthPage {
            items: p
                .items
                .iter()
                .map(|h| w_index::HealthIssue {
                    doc: to_doc(&h.doc),
                    check: to_health_check(&h.check),
                    detail: h.detail.clone(),
                    span: h.span.map(tr::to_span),
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Custom(j) => w_index::IndexResult::Custom(tr::to_json(j)),
        R::VaultStatus(s) => w_index::IndexResult::VaultStatus(w_index::VaultStatus {
            watching: s.watching,
            sync_failures: s.sync_failures,
            last_sync_error: s.last_sync_error.clone(),
            indexing: match s.indexing {
                fub_abi::traits::IndexingState::Running => w_index::IndexingState::Running,
                fub_abi::traits::IndexingState::Ready => w_index::IndexingState::Ready,
                fub_abi::traits::IndexingState::Stopped => w_index::IndexingState::Stopped,
            },
        }),
        R::Jobs(items) => w_index::IndexResult::Jobs(items.iter().map(to_job_status).collect()),
        R::Settings(items) => {
            w_index::IndexResult::Settings(items.iter().map(to_setting_entry).collect())
        }
        R::Organization(o) => w_index::IndexResult::Organization(to_organization(o)),
        R::Resolved(inner) => {
            w_index::IndexResult::Resolved(inner.as_ref().map(|r| w_index::ResolvedRef {
                doc: to_doc(&r.doc),
                at: r.at.as_ref().map(to_doc_position),
            }))
        }
        R::Entries(p) => w_index::IndexResult::Entries(w_index::EntriesPage {
            items: p
                .items
                .iter()
                .map(|e| w_index::VaultEntry {
                    id: to_doc(&e.id),
                    kind: to_entry_kind(&e.kind),
                    size: e.size,
                    mtime: e.mtime,
                    fingerprint: e.fingerprint.as_ref().map(to_revision),
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Folders(p) => w_index::IndexResult::Folders(w_index::FoldersPage {
            items: p
                .items
                .iter()
                .map(|f| w_index::VaultFolder {
                    path: f.path.clone(),
                    folders: f.folders,
                    entries: f.entries,
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::Drafts(p) => w_index::IndexResult::Drafts(w_index::DraftsPage {
            items: p
                .items
                .iter()
                .map(|d| w_index::DraftInfo {
                    doc: to_doc(&d.doc),
                    at: d.at,
                    base: d.base.as_ref().map(to_revision),
                    exists: d.exists,
                    current: d.current.as_ref().map(to_revision),
                    text: d.text.clone(),
                })
                .collect(),
            offset: p.offset,
            total: p.total,
        }),
        R::RenderPreview(doc) => w_index::IndexResult::RenderPreview(to_rendered(doc)?),
        R::RenderEmbed(c) => {
            let (html, parts) = to_rendered_html(&c.content.html, &c.content.parts)?;
            w_index::IndexResult::RenderEmbed(w_index::EmbedContent {
                doc_id: c.doc_id.clone(),
                html,
                parts,
            })
        }
        R::SyntaxForms(items) => w_index::IndexResult::SyntaxForms(
            items
                .iter()
                .map(|s| w_index::SyntaxForm {
                    name: s.name.clone(),
                    trigger: s.trigger.as_ref().map(to_syntax_trigger),
                })
                .collect(),
        ),
        R::RenderPrint(doc) => w_index::IndexResult::RenderPrint(to_rendered(doc)?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered(parts: Vec<fub_abi::render::RenderedPart>) -> fub_abi::traits::IndexResult {
        fub_abi::traits::IndexResult::RenderPreview(fub_abi::render::RenderedDocument {
            html: "<p>ciao</p>".to_string(),
            parts,
        })
    }

    #[test]
    fn a_render_with_ui_parts_is_refused_instead_of_halved() {
        let refused = to_index_result(&rendered(vec![fub_abi::render::RenderedPart {
            slot: 0,
            kind: "demo".to_string(),
            node: fub_abi::ui::UiNode::stack(fub_abi::ui::Axis::Column, 0, vec![]),
        }]));
        assert!(
            matches!(refused, Err(PluginError::Unserved(_))),
            "{refused:?}"
        );

        match to_index_result(&rendered(vec![])) {
            Ok(w_index::IndexResult::RenderPreview(doc)) => {
                assert_eq!(doc.html, "<p>ciao</p>");
                assert!(doc.parts.is_empty());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_query_keeps_its_flags_across_the_boundary() {
        let query = w_index::IndexQuery::Tags(w_index::IndexQueryTags {
            matching: w_index::QueryExpr {
                any: vec![w_index::QueryClause {
                    all: vec![w_index::QueryLiteral {
                        negated: true,
                        predicate: w_index::QueryPredicate::Tag(w_index::TagPredicate {
                            name: "lavoro".to_string(),
                            descendants: true,
                        }),
                    }],
                }],
            },
            page: Some(w_index::Page {
                offset: 2,
                limit: 5,
            }),
        });
        let fub_abi::traits::IndexQuery::Tags { matching, page } =
            from_index_query(query).expect("si traduce")
        else {
            panic!("non è una domanda sui tag");
        };
        let literal = &matching.any[0].all[0];
        assert!(literal.negated);
        assert_eq!(
            literal.predicate,
            fub_abi::query::QueryPredicate::Tag {
                name: "lavoro".to_string(),
                descendants: true,
            }
        );
        assert_eq!(page.map(|p| (p.offset, p.limit)), Some((2, 5)));
    }
}
