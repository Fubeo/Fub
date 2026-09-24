//! **Le stesse cose, dette due volte, per gli ingressi.**
//!
//! Conversioni pure fra i tipi Rust di `fub-abi` e i tipi WIT che i proxy
//! inbound attraversano: rotte dichiarate al montaggio, domande e risposte del
//! canale dati, voci dell'anagrafe, perdite dell'alimentazione, avvisi con la
//! loro origine. La direzione nei nomi è quella di [`crate::translate`]:
//! `from_*` porta dal WIT al Rust (ciò che il componente dice), `to_*` porta
//! dal Rust al WIT (ciò che l'host gli passa).
//!
//! # Le regole di questo confine
//!
//! * Ogni `match` è esaustivo di proposito: una variante nuova da una parte non
//!   compila finché qualcuno non ha detto in che cosa diventa. Nessun ramo di
//!   scarto, nessun `Exact` di ripiego.
//! * Le bandiere non si droppano mai: `negated`, `descendants`, `descending`,
//!   `partial-last-term`, `exists` e le altre viaggiano tutte, in entrambi i
//!   versi.
//! * `replacement` e `target` restano opachi: si copiano, non si
//!   reinterpretano. La validità di uno span (confini, UTF-8, sovrapposizioni)
//!   la decide chi applica, non chi traduce.
//! * Una rotta `custom` senza namespace e una domanda che il WIT non sa dire
//!   (incluse le future `Regex`, `ScopedText`, `case` e `path` quando
//!   atterreranno) sono [`PluginError::Unserved`] che nomina la feature, mai un
//!   `BadArgs` silenzioso né un ripiego su `Exact`.
//! * Lo span stringe in un verso solo (`u64` → `usize`): oltre la portata della
//!   macchina è `BadArgs`, come in [`crate::translate`], senza un secondo
//!   giudizio su ordine e confini.

use fub_abi::PluginError;

use crate::contract::exports::fub::abi::index as w_index;
use crate::contract::exports::fub::abi::syntax as w_export_syntax;
use crate::contract::fub::abi::{
    events as w_events, jobs as w_jobs, model as w_model, organization as w_org,
    settings as w_settings,
};
use crate::translate as tr;

fn non_servito(feature: impl Into<String>) -> PluginError {
    PluginError::Unserved(feature.into().into())
}

// ---------------------------------------------------------------------------
// Lo span: stretto in un verso, largo nell'altro
// ---------------------------------------------------------------------------

/// Lo span dal WIT al Rust: stringe, e per questo può fallire.
///
/// È la stessa stretta di `translate::from_span`: oltre la portata di `usize`
/// è `BadArgs` perché quel numero lo ha scritto il componente. Che `start` sia
/// prima di `end`, che cada dentro il documento e che non tagli un carattere a
/// metà non lo decide questa funzione.
pub(crate) fn from_span(s: w_model::Span) -> Result<fub_abi::model::Span, PluginError> {
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

// ---------------------------------------------------------------------------
// Identità opache: doc-id, revision, batch, job
// ---------------------------------------------------------------------------

fn from_doc(id: String) -> fub_abi::model::DocId {
    fub_abi::model::DocId(id)
}

fn to_doc(id: &fub_abi::model::DocId) -> String {
    id.0.clone()
}

fn from_revision(r: String) -> fub_abi::edit::Revision {
    fub_abi::edit::Revision(r)
}

fn to_revision(r: &fub_abi::edit::Revision) -> String {
    r.0.clone()
}

fn to_batch(id: &fub_abi::event::BatchId) -> u64 {
    id.0
}

fn from_job(id: u64) -> fub_abi::traits::JobId {
    fub_abi::traits::JobId(id)
}

fn to_job(id: &fub_abi::traits::JobId) -> u64 {
    id.0
}

// ---------------------------------------------------------------------------
// Rotte dichiarate al montaggio (WIT → Rust)
// ---------------------------------------------------------------------------

/// La rotta dichiarata dal componente, dal WIT al Rust.
///
/// Una `custom` senza namespace non è una rotta malformata: è una feature che
/// nessuno ha nominato, e la risposta è `Unserved` che la nomina.
pub(crate) fn from_query_route(
    r: w_index::QueryRoute,
) -> Result<fub_abi::traits::QueryRoute, PluginError> {
    match r {
        w_index::QueryRoute::Query(k) => {
            Ok(fub_abi::traits::QueryRoute::Query(from_query_kind(k)?))
        }
        w_index::QueryRoute::Predicate(k) => Ok(fub_abi::traits::QueryRoute::Predicate(
            from_predicate_kind(k)?,
        )),
    }
}

/// La famiglia di una domanda, dal WIT al Rust.
pub(crate) fn from_query_kind(
    k: w_index::QueryKind,
) -> Result<fub_abi::traits::QueryKind, PluginError> {
    use fub_abi::traits::QueryKind as R;
    Ok(match k {
        w_index::QueryKind::Documents => R::Documents,
        w_index::QueryKind::Backlinks => R::Backlinks,
        w_index::QueryKind::Outline => R::Outline,
        w_index::QueryKind::Tags => R::Tags,
        w_index::QueryKind::Neighbors => R::Neighbors,
        w_index::QueryKind::PropertyValues => R::PropertyValues,
        w_index::QueryKind::VaultHealth => R::VaultHealth,
        w_index::QueryKind::Custom(ns) => {
            if ns.is_empty() {
                return Err(non_servito(
                    "rotta custom senza namespace: nessuno la serve",
                ));
            }
            R::Custom(ns)
        }
        w_index::QueryKind::VaultStatus => R::VaultStatus,
        w_index::QueryKind::Jobs => R::Jobs,
        w_index::QueryKind::Settings => R::Settings,
        w_index::QueryKind::Organization => R::Organization,
        w_index::QueryKind::Resolve => R::Resolve,
        w_index::QueryKind::Entries => R::Entries,
        w_index::QueryKind::Folders => R::Folders,
        w_index::QueryKind::Drafts => R::Drafts,
        w_index::QueryKind::RenderPreview => R::RenderPreview,
        w_index::QueryKind::RenderEmbed => R::RenderEmbed,
        w_index::QueryKind::SyntaxForms => R::SyntaxForms,
        w_index::QueryKind::RenderPrint => R::RenderPrint,
    })
}

/// La specie di una foglia, dal WIT al Rust.
pub(crate) fn from_predicate_kind(
    k: w_index::PredicateKind,
) -> Result<fub_abi::traits::PredicateKind, PluginError> {
    use fub_abi::traits::PredicateKind as R;
    Ok(match k {
        w_index::PredicateKind::Text => R::Text,
        w_index::PredicateKind::Property => R::Property,
        w_index::PredicateKind::Tag => R::Tag,
        w_index::PredicateKind::Folder => R::Folder,
        w_index::PredicateKind::Linked => R::Linked,
        w_index::PredicateKind::Custom(ns) => {
            if ns.is_empty() {
                return Err(non_servito(
                    "predicato custom senza namespace: nessuno lo valuta",
                ));
            }
            R::Custom(ns)
        }
        w_index::PredicateKind::Regex => R::Regex,
        w_index::PredicateKind::Task => R::Task,
        w_index::PredicateKind::Path => R::Path,
        w_index::PredicateKind::File => R::File,
    })
}

// ---------------------------------------------------------------------------
// La domanda (Rust → WIT)
// ---------------------------------------------------------------------------

/// La domanda dell'host, dal Rust al WIT.
///
/// Fallisce solo con `Unserved` che nomina la feature: una `custom` senza
/// namespace e, un giorno, le foglie che il WIT non sa ancora dire (`Regex`,
/// `ScopedText`, `case`, `path`). Mai `BadArgs` silenzioso, mai un ripiego su
/// `Exact`: chi non sa onorare una tolleranza restringe, non allarga, e chi
/// non sa dire una domanda lo dice.
pub(crate) fn to_index_query(
    q: &fub_abi::traits::IndexQuery,
) -> Result<w_index::IndexQuery, PluginError> {
    use fub_abi::traits::IndexQuery as R;
    Ok(match q {
        R::Documents {
            matching,
            sort,
            select,
            page,
            excerpts,
        } => w_index::IndexQuery::Documents(w_index::IndexQueryDocuments {
            matching: to_expr(matching)?,
            sort: sort.as_ref().map(to_sort),
            select: to_select(select),
            page: page.as_ref().map(to_page),
            excerpts: to_excerpts(excerpts),
        }),
        R::Backlinks { target, page } => {
            w_index::IndexQuery::Backlinks(w_index::IndexQueryBacklinks {
                target: to_doc(target),
                page: page.as_ref().map(to_page),
            })
        }
        R::Outline { doc } => w_index::IndexQuery::Outline(to_doc(doc)),
        R::Tags { matching, page } => w_index::IndexQuery::Tags(w_index::IndexQueryTags {
            matching: to_expr(matching)?,
            page: page.as_ref().map(to_page),
        }),
        R::Neighbors {
            seeds,
            direction,
            depth,
            page,
        } => w_index::IndexQuery::Neighbors(w_index::IndexQueryNeighbors {
            seeds: to_expr(seeds)?,
            direction: to_direction(direction),
            depth: *depth,
            page: page.as_ref().map(to_page),
        }),
        R::PropertyValues {
            key,
            matching,
            page,
        } => w_index::IndexQuery::PropertyValues(w_index::IndexQueryPropertyValues {
            key: key.clone(),
            matching: to_expr(matching)?,
            page: page.as_ref().map(to_page),
        }),
        R::VaultHealth { check, page } => {
            w_index::IndexQuery::VaultHealth(w_index::IndexQueryVaultHealth {
                check: to_health_check(check),
                page: page.as_ref().map(to_page),
            })
        }
        R::Custom { ns, query } => {
            if ns.is_empty() {
                return Err(non_servito(
                    "query custom senza namespace: nessuno la serve",
                ));
            }
            w_index::IndexQuery::Custom(w_index::IndexQueryCustom {
                ns: ns.clone(),
                query: tr::to_json(query),
            })
        }
        R::VaultStatus => w_index::IndexQuery::VaultStatus,
        R::Jobs => w_index::IndexQuery::Jobs,
        R::Settings { plugin } => w_index::IndexQuery::Settings(plugin.clone()),
        R::Organization => w_index::IndexQuery::Organization,
        R::Resolve { target, from } => w_index::IndexQuery::Resolve(w_index::IndexQueryResolve {
            target: crate::model::to_target(target),
            from: from.as_ref().map(to_doc),
        }),
        R::Entries {
            of_kind,
            within,
            page,
        } => w_index::IndexQuery::Entries(w_index::IndexQueryEntries {
            of_kind: of_kind.as_ref().map(to_entry_kind),
            within: within.as_ref().map(to_folder_scope),
            page: page.as_ref().map(to_page),
        }),
        R::Folders { under, page } => w_index::IndexQuery::Folders(w_index::IndexQueryFolders {
            under: under.as_ref().map(to_folder_scope),
            page: page.as_ref().map(to_page),
        }),
        R::Drafts { page } => w_index::IndexQuery::Drafts(w_index::IndexQueryDrafts {
            page: page.as_ref().map(to_page),
        }),
        R::RenderPreview { doc } => w_index::IndexQuery::RenderPreview(to_doc(doc)),
        R::RenderEmbed {
            page,
            heading,
            block,
        } => w_index::IndexQuery::RenderEmbed(w_index::IndexQueryRenderEmbed {
            page: page.clone(),
            heading: heading.clone(),
            block: block.clone(),
        }),
        R::SyntaxForms { doc } => w_index::IndexQuery::SyntaxForms(to_doc(doc)),
        R::RenderPrint { doc } => w_index::IndexQuery::RenderPrint(to_doc(doc)),
    })
}

fn to_expr(e: &fub_abi::query::QueryExpr) -> Result<w_index::QueryExpr, PluginError> {
    Ok(w_index::QueryExpr {
        any: e.any.iter().map(to_clause).collect::<Result<_, _>>()?,
    })
}

fn to_clause(c: &fub_abi::query::QueryClause) -> Result<w_index::QueryClause, PluginError> {
    Ok(w_index::QueryClause {
        all: c.all.iter().map(to_literal).collect::<Result<_, _>>()?,
    })
}

fn to_literal(l: &fub_abi::query::QueryLiteral) -> Result<w_index::QueryLiteral, PluginError> {
    Ok(w_index::QueryLiteral {
        negated: l.negated,
        predicate: to_predicate(&l.predicate)?,
    })
}

fn to_predicate(
    p: &fub_abi::query::QueryPredicate,
) -> Result<w_index::QueryPredicate, PluginError> {
    use fub_abi::query::QueryPredicate as R;
    Ok(match p {
        R::Text(t) => w_index::QueryPredicate::Text(to_text_query(t)?),
        R::Property { filter } => w_index::QueryPredicate::Property(to_property_filter(filter)?),
        R::Tag { name, descendants } => w_index::QueryPredicate::Tag(w_index::TagPredicate {
            name: name.clone(),
            descendants: *descendants,
        }),
        R::Folder { path, descendants } => {
            w_index::QueryPredicate::Folder(w_index::FolderPredicate {
                path: path.clone(),
                descendants: *descendants,
            })
        }
        R::Linked { doc, direction } => w_index::QueryPredicate::Linked(w_index::LinkedPredicate {
            doc: to_doc(doc),
            direction: to_direction(direction),
        }),
        R::Docs { docs } => w_index::QueryPredicate::Docs(w_index::DocsPredicate {
            docs: docs.iter().map(to_doc).collect(),
        }),
        R::Custom { ns, predicate } => {
            if ns.is_empty() {
                return Err(non_servito(
                    "predicato custom senza namespace: nessuno lo valuta",
                ));
            }
            w_index::QueryPredicate::Custom(w_index::CustomPredicate {
                ns: ns.clone(),
                predicate: tr::to_json(predicate),
            })
        }
        R::Regex { pattern, fields } => w_index::QueryPredicate::Regex(w_index::RegexPredicate {
            pattern: pattern.clone(),
            fields: fields.iter().map(to_text_field).collect::<Result<_, _>>()?,
        }),
        R::Task { status } => w_index::QueryPredicate::Task(w_index::TaskPredicate {
            status: match status {
                fub_abi::query::TaskStatus::Open => w_index::TaskStatus::Open,
                fub_abi::query::TaskStatus::Done => w_index::TaskStatus::Done,
            },
        }),
        R::Path { glob } => {
            w_index::QueryPredicate::Path(w_index::PathPredicate { glob: glob.clone() })
        }
        R::File { extension } => w_index::QueryPredicate::File(w_index::FilePredicate {
            extension: extension.clone(),
        }),
    })
}

fn to_text_query(t: &fub_abi::query::TextQuery) -> Result<w_index::TextQuery, PluginError> {
    Ok(w_index::TextQuery {
        text: t.text.clone(),
        mode: to_text_mode(&t.mode)?,
        fields: t
            .fields
            .iter()
            .map(to_text_field)
            .collect::<Result<_, _>>()?,
        tolerance: to_tolerance(&t.tolerance)?,
        partial_last_term: t.partial_last_term,
        case_sensitive: t.case_sensitive,
    })
}

/// Il modo in cui si intende la stringa: esaustivo oggi, `Unserved` domani.
///
/// Una futura modalità che il WIT non sa dire (una `Regex`, un `ScopedText`)
/// non cade su `Terms`: torna `Unserved` che la nomina. Il `match` senza scarto
/// è ciò che fa rompere la compilazione invece di degradare.
fn to_text_mode(m: &fub_abi::query::TextMode) -> Result<w_index::TextMode, PluginError> {
    use fub_abi::query::TextMode as R;
    Ok(match m {
        R::Terms => w_index::TextMode::Terms,
        R::Phrase => w_index::TextMode::Phrase,
    })
}

/// Dove cercare: esaustivo, senza ripieghi.
///
/// Un futuro campo che il WIT non sa dire (`case`, `path`) non si omette e non
/// si mappa su un altro: è `Unserved`.
fn to_text_field(f: &fub_abi::query::TextField) -> Result<w_index::TextField, PluginError> {
    use fub_abi::query::TextField as R;
    Ok(match f {
        R::Name => w_index::TextField::Name,
        R::Body => w_index::TextField::Body,
        R::Tags => w_index::TextField::Tags,
        R::Heading => w_index::TextField::Heading,
    })
}

/// Quanto si vuole essere indovinati: mai droppato, mai mappato su `Exact`.
///
/// Chi non sa onorare `Typos` restringe come per `Exact`, ma la domanda resta
/// quella scritta: la tolleranza viaggia intatta e la decisione resta del
/// provider.
fn to_tolerance(t: &fub_abi::query::TextTolerance) -> Result<w_index::TextTolerance, PluginError> {
    use fub_abi::query::TextTolerance as R;
    Ok(match t {
        R::Exact => w_index::TextTolerance::Exact,
        R::Typos => w_index::TextTolerance::Typos,
    })
}

fn to_property_filter(
    f: &fub_abi::traits::PropertyFilter,
) -> Result<w_index::PropertyFilter, PluginError> {
    Ok(w_index::PropertyFilter {
        key: f.key.clone(),
        test: to_property_test(&f.test)?,
    })
}

fn to_property_test(
    t: &fub_abi::traits::PropertyTest,
) -> Result<w_index::PropertyTest, PluginError> {
    use fub_abi::traits::PropertyTest as R;
    Ok(match t {
        R::Exists => w_index::PropertyTest::Exists,
        R::Missing => w_index::PropertyTest::Missing,
        R::Equals(v) => w_index::PropertyTest::Equals(to_property_value(v)?),
        R::NotEquals(v) => w_index::PropertyTest::NotEquals(to_property_value(v)?),
        R::Contains(s) => w_index::PropertyTest::Contains(to_property_scalar(s)?),
        R::GreaterThan(v) => w_index::PropertyTest::GreaterThan(to_property_value(v)?),
        R::LessThan(v) => w_index::PropertyTest::LessThan(to_property_value(v)?),
    })
}

fn to_property_value(
    v: &fub_abi::model::PropertyValue,
) -> Result<w_model::PropertyValue, PluginError> {
    use fub_abi::model::PropertyValue as R;
    Ok(match v {
        R::Empty => w_model::PropertyValue::Empty,
        R::Text(s) => w_model::PropertyValue::Text(s.clone()),
        R::Number(n) => w_model::PropertyValue::Number(*n),
        R::Bool(b) => w_model::PropertyValue::Bool(*b),
        R::Date(d) => w_model::PropertyValue::Date(to_property_date(d)),
        R::Link(t) => w_model::PropertyValue::Link(crate::model::to_target(t)),
        R::List(items) => w_model::PropertyValue::List(
            items
                .iter()
                .map(to_property_scalar)
                .collect::<Result<_, _>>()?,
        ),
        R::Unknown(j) => w_model::PropertyValue::Unknown(tr::to_json(j)),
    })
}

fn to_property_scalar(
    v: &fub_abi::model::PropertyScalar,
) -> Result<w_model::PropertyScalar, PluginError> {
    use fub_abi::model::PropertyScalar as R;
    Ok(match v {
        R::Empty => w_model::PropertyScalar::Empty,
        R::Text(s) => w_model::PropertyScalar::Text(s.clone()),
        R::Number(n) => w_model::PropertyScalar::Number(*n),
        R::Bool(b) => w_model::PropertyScalar::Bool(*b),
        R::Date(d) => w_model::PropertyScalar::Date(to_property_date(d)),
        R::Link(t) => w_model::PropertyScalar::Link(crate::model::to_target(t)),
        R::Unknown(j) => w_model::PropertyScalar::Unknown(tr::to_json(j)),
    })
}

fn to_property_date(d: &fub_abi::model::PropertyDate) -> w_model::PropertyDate {
    w_model::PropertyDate {
        year: d.year,
        month: d.month,
        day: d.day,
        time: d.time.as_ref().map(to_property_time),
    }
}

fn to_property_time(t: &fub_abi::model::PropertyTime) -> w_model::PropertyTime {
    w_model::PropertyTime {
        hour: t.hour,
        minute: t.minute,
        second: t.second,
        offset_minutes: t.offset_minutes,
    }
}

fn to_sort(s: &fub_abi::traits::PropertySort) -> w_index::PropertySort {
    w_index::PropertySort {
        key: s.key.clone(),
        descending: s.descending,
    }
}

fn to_select(s: &fub_abi::traits::PropertySelect) -> w_index::PropertySelect {
    use fub_abi::traits::PropertySelect as R;
    match s {
        R::None => w_index::PropertySelect::None,
        R::All => w_index::PropertySelect::All,
        R::Keys { keys } => {
            w_index::PropertySelect::Keys(w_index::PropertySelectKeys { keys: keys.clone() })
        }
    }
}

fn to_excerpts(e: &fub_abi::traits::Excerpts) -> w_index::Excerpts {
    use fub_abi::traits::Excerpts as R;
    match e {
        R::Attach => w_index::Excerpts::Attach,
        R::Omit => w_index::Excerpts::Omit,
    }
}

fn to_page(p: &fub_abi::traits::Page) -> w_index::Page {
    w_index::Page {
        offset: p.offset,
        limit: p.limit,
    }
}

fn to_direction(d: &fub_abi::traits::LinkDirection) -> w_index::LinkDirection {
    use fub_abi::traits::LinkDirection as R;
    match d {
        R::Outbound => w_index::LinkDirection::Outbound,
        R::Inbound => w_index::LinkDirection::Inbound,
        R::Both => w_index::LinkDirection::Both,
    }
}

fn to_health_check(c: &fub_abi::traits::HealthCheck) -> w_index::HealthCheck {
    use fub_abi::traits::HealthCheck as R;
    match c {
        R::BrokenLinks => w_index::HealthCheck::BrokenLinks,
        R::OrphanDocuments => w_index::HealthCheck::OrphanDocuments,
        R::CollidingPaths => w_index::HealthCheck::CollidingPaths,
        R::UnrecognizedDates => w_index::HealthCheck::UnrecognizedDates,
    }
}

fn to_folder_scope(s: &fub_abi::traits::FolderScope) -> w_index::FolderScope {
    w_index::FolderScope {
        path: s.path.clone(),
        descendants: s.descendants,
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

// ---------------------------------------------------------------------------
// La risposta (WIT → Rust)
// ---------------------------------------------------------------------------

/// La risposta del componente, dal WIT al Rust.
///
/// Ciò che il componente manda e non sta in piedi (JSON spazzatura, span oltre
/// la portata, albero UI malformato) è `BadArgs`: lo ha scritto lui. Una
/// risposta fuori tema resta `Internal` di chi la legge, come altrove.
pub(crate) fn from_index_result(
    r: w_index::IndexResult,
) -> Result<fub_abi::traits::IndexResult, PluginError> {
    use fub_abi::traits::IndexResult as R;
    Ok(match r {
        w_index::IndexResult::Documents(p) => R::Documents(from_documents_page(p)?),
        w_index::IndexResult::Backlinks(p) => R::Backlinks(from_backlinks_page(p)),
        w_index::IndexResult::Outline(items) => R::Outline(
            items
                .into_iter()
                .map(from_heading)
                .collect::<Result<_, _>>()?,
        ),
        w_index::IndexResult::Tags(p) => R::Tags(from_tags_page(p)),
        w_index::IndexResult::Neighbors(p) => R::Neighbors(from_neighbors_page(p)),
        w_index::IndexResult::PropertyValues(p) => R::PropertyValues(from_property_values_page(p)?),
        w_index::IndexResult::VaultHealth(p) => R::VaultHealth(from_health_page(p)?),
        w_index::IndexResult::Custom(j) => R::Custom(tr::from_json(&j)?),
        w_index::IndexResult::VaultStatus(s) => R::VaultStatus(from_vault_status(s)),
        w_index::IndexResult::Jobs(items) => {
            R::Jobs(items.into_iter().map(from_job_status).collect())
        }
        w_index::IndexResult::Settings(items) => R::Settings(
            items
                .into_iter()
                .map(from_setting_entry)
                .collect::<Result<_, _>>()?,
        ),
        w_index::IndexResult::Organization(o) => R::Organization(from_organization(o)),
        w_index::IndexResult::Resolved(inner) => R::Resolved(inner.map(from_resolved).transpose()?),
        w_index::IndexResult::Entries(p) => R::Entries(from_entries_page(p)),
        w_index::IndexResult::Folders(p) => R::Folders(from_folders_page(p)),
        w_index::IndexResult::Drafts(p) => R::Drafts(from_drafts_page(p)),
        w_index::IndexResult::RenderPreview(doc) => R::RenderPreview(from_rendered(doc)?),
        w_index::IndexResult::RenderEmbed(content) => R::RenderEmbed(from_embed(content)?),
        w_index::IndexResult::SyntaxForms(items) => {
            R::SyntaxForms(items.into_iter().map(from_syntax_form).collect())
        }
        w_index::IndexResult::RenderPrint(doc) => R::RenderPrint(from_rendered(doc)?),
    })
}

fn from_documents_page(
    p: w_index::DocumentsPage,
) -> Result<fub_abi::traits::Paged<fub_abi::traits::DocumentMatch>, PluginError> {
    Ok(fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(from_document_match)
            .collect::<Result<_, _>>()?,
        offset: p.offset,
        total: p.total,
    })
}

fn from_backlinks_page(
    p: w_index::BacklinksPage,
) -> fub_abi::traits::Paged<fub_abi::traits::BacklinkRef> {
    fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|b| fub_abi::traits::BacklinkRef {
                source: from_doc(b.source),
                context: b.context,
            })
            .collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_tags_page(p: w_index::TagsPage) -> fub_abi::traits::Paged<fub_abi::traits::TagCount> {
    fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|t| fub_abi::traits::TagCount {
                name: t.name,
                count: t.count,
            })
            .collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_neighbors_page(
    p: w_index::NeighborsPage,
) -> fub_abi::traits::Paged<fub_abi::traits::NeighborRef> {
    fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|n| fub_abi::traits::NeighborRef {
                doc: from_doc(n.doc),
                via: from_doc(n.via),
                depth: n.depth,
            })
            .collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_property_values_page(
    p: w_index::PropertyValuesPage,
) -> Result<fub_abi::traits::Paged<fub_abi::traits::PropertyCount>, PluginError> {
    Ok(fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|c| {
                Ok(fub_abi::traits::PropertyCount {
                    value: from_property_value(c.value)?,
                    count: c.count,
                })
            })
            .collect::<Result<_, PluginError>>()?,
        offset: p.offset,
        total: p.total,
    })
}

fn from_health_page(
    p: w_index::VaultHealthPage,
) -> Result<fub_abi::traits::Paged<fub_abi::traits::HealthIssue>, PluginError> {
    Ok(fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|h| {
                Ok(fub_abi::traits::HealthIssue {
                    doc: from_doc(h.doc),
                    check: from_health_check(h.check),
                    detail: h.detail,
                    span: h.span.map(from_span).transpose()?,
                })
            })
            .collect::<Result<_, PluginError>>()?,
        offset: p.offset,
        total: p.total,
    })
}

fn from_health_check(c: w_index::HealthCheck) -> fub_abi::traits::HealthCheck {
    use fub_abi::traits::HealthCheck as R;
    match c {
        w_index::HealthCheck::BrokenLinks => R::BrokenLinks,
        w_index::HealthCheck::OrphanDocuments => R::OrphanDocuments,
        w_index::HealthCheck::CollidingPaths => R::CollidingPaths,
        w_index::HealthCheck::UnrecognizedDates => R::UnrecognizedDates,
    }
}

fn from_entries_page(
    p: w_index::EntriesPage,
) -> fub_abi::traits::Paged<fub_abi::traits::VaultEntry> {
    fub_abi::traits::Paged {
        items: p.items.into_iter().map(from_vault_entry_wit).collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_folders_page(
    p: w_index::FoldersPage,
) -> fub_abi::traits::Paged<fub_abi::traits::VaultFolder> {
    fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|f| fub_abi::traits::VaultFolder {
                path: f.path,
                folders: f.folders,
                entries: f.entries,
            })
            .collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_drafts_page(p: w_index::DraftsPage) -> fub_abi::traits::Paged<fub_abi::traits::DraftInfo> {
    fub_abi::traits::Paged {
        items: p
            .items
            .into_iter()
            .map(|d| fub_abi::traits::DraftInfo {
                doc: from_doc(d.doc),
                at: d.at,
                base: d.base.map(from_revision),
                exists: d.exists,
                current: d.current.map(from_revision),
                text: d.text,
            })
            .collect(),
        offset: p.offset,
        total: p.total,
    }
}

fn from_document_match(
    m: w_index::DocumentMatch,
) -> Result<fub_abi::traits::DocumentMatch, PluginError> {
    Ok(fub_abi::traits::DocumentMatch {
        doc: from_doc(m.doc),
        score: m.score,
        snippet: m.snippet,
        highlights: m
            .highlights
            .into_iter()
            .map(from_span)
            .collect::<Result<_, _>>()?,
        properties: m
            .properties
            .into_iter()
            .map(|e| {
                Ok(fub_abi::traits::PropertyEntry {
                    key: e.key,
                    value: from_property_value(e.value)?,
                })
            })
            .collect::<Result<_, PluginError>>()?,
        occurrences: m
            .occurrences
            .into_iter()
            .map(from_doc_position)
            .collect::<Result<_, _>>()?,
    })
}

fn from_doc_position(p: w_index::DocPosition) -> Result<fub_abi::traits::DocPosition, PluginError> {
    Ok(fub_abi::traits::DocPosition {
        span: from_span(p.span)?,
        anchor: p.anchor,
        revision: from_revision(p.revision),
    })
}

fn from_resolved(r: w_index::ResolvedRef) -> Result<fub_abi::traits::ResolvedRef, PluginError> {
    Ok(fub_abi::traits::ResolvedRef {
        doc: from_doc(r.doc),
        at: r.at.map(from_doc_position).transpose()?,
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
        w_model::PropertyValue::Date(d) => R::Date(from_property_date(d)?),
        w_model::PropertyValue::Link(t) => R::Link(from_link_target(t)),
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
        w_model::PropertyScalar::Date(d) => R::Date(from_property_date(d)?),
        w_model::PropertyScalar::Link(t) => R::Link(from_link_target(t)),
        w_model::PropertyScalar::Unknown(j) => R::Unknown(tr::from_json(&j)?),
    })
}

fn from_property_date(
    d: w_model::PropertyDate,
) -> Result<fub_abi::model::PropertyDate, PluginError> {
    Ok(fub_abi::model::PropertyDate {
        year: d.year,
        month: d.month,
        day: d.day,
        time: d.time.map(from_property_time),
    })
}

fn from_property_time(t: w_model::PropertyTime) -> fub_abi::model::PropertyTime {
    fub_abi::model::PropertyTime {
        hour: t.hour,
        minute: t.minute,
        second: t.second,
        offset_minutes: t.offset_minutes,
    }
}

/// Il bersaglio osservato, dal WIT al Rust: stessa tavola di
/// `model::to_target`, letta nel verso opposto. Opaco: si copia, non si
/// reinterpreta.
fn from_link_target(t: w_model::LinkTarget) -> fub_abi::model::LinkTarget {
    match t {
        w_model::LinkTarget::Wiki(inner) => fub_abi::model::LinkTarget::Wiki {
            page: inner.page,
            heading: inner.heading,
            block: inner.block,
        },
        w_model::LinkTarget::Url(url) => fub_abi::model::LinkTarget::Url(url),
        w_model::LinkTarget::Path(path) => fub_abi::model::LinkTarget::Path(path),
    }
}

fn from_heading(h: w_model::Heading) -> Result<fub_abi::model::Heading, PluginError> {
    Ok(fub_abi::model::Heading {
        level: h.level,
        text: h.text,
        slug: h.slug,
        span: from_span(h.span)?,
        explicit_anchor: h.explicit_anchor,
    })
}

fn from_vault_status(s: w_index::VaultStatus) -> fub_abi::traits::VaultStatus {
    fub_abi::traits::VaultStatus {
        watching: s.watching,
        sync_failures: s.sync_failures,
        last_sync_error: s.last_sync_error,
        indexing: from_indexing(s.indexing),
    }
}

fn from_indexing(s: w_index::IndexingState) -> fub_abi::traits::IndexingState {
    use fub_abi::traits::IndexingState as R;
    match s {
        w_index::IndexingState::Running => R::Running,
        w_index::IndexingState::Ready => R::Ready,
        w_index::IndexingState::Stopped => R::Stopped,
    }
}

fn from_job_status(s: w_jobs::JobStatus) -> fub_abi::traits::JobStatus {
    fub_abi::traits::JobStatus {
        id: from_job(s.id),
        job: s.job,
        plugin: s.plugin,
        since: s.since,
        progress: s.progress.map(from_job_progress),
    }
}

fn from_job_progress(p: w_jobs::JobProgress) -> fub_abi::traits::JobProgress {
    fub_abi::traits::JobProgress {
        done: p.done,
        total: p.total,
        label: p.label,
    }
}

fn from_setting_entry(
    s: w_settings::SettingEntry,
) -> Result<fub_abi::settings::SettingEntry, PluginError> {
    Ok(fub_abi::settings::SettingEntry {
        spec: from_setting_spec(s.spec)?,
        value: from_setting_value(s.value)?,
        source: from_setting_source(s.source),
    })
}

fn from_setting_spec(
    s: w_settings::SettingSpec,
) -> Result<fub_abi::settings::SettingSpec, PluginError> {
    Ok(fub_abi::settings::SettingSpec {
        key: s.key,
        label: tr::from_text(s.label),
        description: tr::from_text(s.description),
        group: tr::from_text(s.group),
        scope: from_setting_scope(s.scope),
        kind: from_setting_kind(s.kind)?,
        program_writable: s.program_writable,
    })
}

fn from_setting_scope(s: w_settings::SettingScope) -> fub_abi::settings::SettingScope {
    match s {
        w_settings::SettingScope::Vault => fub_abi::settings::SettingScope::Vault,
        w_settings::SettingScope::Machine => fub_abi::settings::SettingScope::Machine,
    }
}

fn from_setting_kind(
    k: w_settings::SettingKind,
) -> Result<fub_abi::settings::SettingKind, PluginError> {
    use fub_abi::settings::SettingKind as R;
    Ok(match k {
        w_settings::SettingKind::Toggle(t) => R::Toggle { default: t.default },
        w_settings::SettingKind::Number(n) => R::Number {
            default: n.default,
            min: n.min,
            max: n.max,
        },
        w_settings::SettingKind::Text(t) => R::Text { default: t.default },
        w_settings::SettingKind::Choice(c) => R::Choice {
            default: c.default,
            options: c
                .options
                .into_iter()
                .map(|o| fub_abi::ui::UiOption {
                    value: o.value,
                    label: tr::from_text(o.label),
                })
                .collect(),
        },
        w_settings::SettingKind::List(l) => R::List { default: l.default },
    })
}

fn from_setting_value(
    v: w_settings::SettingValue,
) -> Result<fub_abi::settings::SettingValue, PluginError> {
    use fub_abi::settings::SettingValue as R;
    Ok(match v {
        w_settings::SettingValue::Toggle(b) => R::Toggle(b),
        w_settings::SettingValue::Number(n) => R::Number(n),
        w_settings::SettingValue::Text(s) => R::Text(s),
        w_settings::SettingValue::List(items) => R::List(items),
    })
}

fn from_setting_source(s: w_settings::SettingSource) -> fub_abi::settings::SettingSource {
    use fub_abi::settings::SettingSource as R;
    match s {
        w_settings::SettingSource::Default => R::Default,
        w_settings::SettingSource::Machine => R::Machine,
        w_settings::SettingSource::Vault => R::Vault,
    }
}

fn from_organization(o: w_org::Organization) -> fub_abi::organization::Organization {
    fub_abi::organization::Organization {
        icons: o.icons.into_iter().collect(),
        pinned: o.pinned,
        order: o.order.into_iter().collect(),
        spaces: o.spaces,
    }
}

fn from_syntax_form(s: w_index::SyntaxForm) -> fub_abi::custom::SyntaxForm {
    fub_abi::custom::SyntaxForm {
        name: s.name,
        trigger: s.trigger.map(from_syntax_trigger),
    }
}

fn from_syntax_trigger(t: w_export_syntax::SyntaxTrigger) -> fub_abi::custom::SyntaxTrigger {
    match t {
        w_export_syntax::SyntaxTrigger::Fence(f) => {
            fub_abi::custom::SyntaxTrigger::Fence { info: f.info }
        }
        w_export_syntax::SyntaxTrigger::Inline(i) => fub_abi::custom::SyntaxTrigger::Inline {
            open: i.open,
            close: i.close,
        },
    }
}

fn from_rendered(
    r: w_index::RenderedDocument,
) -> Result<fub_abi::render::RenderedDocument, PluginError> {
    Ok(fub_abi::render::RenderedDocument {
        html: r.html,
        parts: r
            .parts
            .into_iter()
            .map(from_rendered_part)
            .collect::<Result<_, _>>()?,
    })
}

fn from_rendered_part(
    p: w_index::RenderedPart,
) -> Result<fub_abi::render::RenderedPart, PluginError> {
    Ok(fub_abi::render::RenderedPart {
        slot: p.slot,
        kind: p.kind,
        node: crate::ui::from_tree(p.node)?,
    })
}

fn from_embed(c: w_index::EmbedContent) -> Result<fub_abi::render::EmbedContent, PluginError> {
    Ok(fub_abi::render::EmbedContent {
        doc_id: c.doc_id,
        content: fub_abi::render::RenderedDocument {
            html: c.html,
            parts: c
                .parts
                .into_iter()
                .map(from_rendered_part)
                .collect::<Result<_, _>>()?,
        },
    })
}

// ---------------------------------------------------------------------------
// L'anagrafe e le perdite
// ---------------------------------------------------------------------------

/// La voce dell'anagrafe, dal Rust al WIT: totale, senza giudizio.
pub(crate) fn to_vault_entry(e: &fub_abi::traits::VaultEntry) -> w_index::VaultEntry {
    w_index::VaultEntry {
        id: to_doc(&e.id),
        kind: to_entry_kind(&e.kind),
        size: e.size,
        mtime: e.mtime,
        fingerprint: e.fingerprint.as_ref().map(to_revision),
    }
}

fn from_vault_entry_wit(e: w_index::VaultEntry) -> fub_abi::traits::VaultEntry {
    fub_abi::traits::VaultEntry {
        id: from_doc(e.id),
        kind: from_entry_kind(e.kind),
        size: e.size,
        mtime: e.mtime,
        fingerprint: e.fingerprint.map(from_revision),
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

/// La perdita dell'alimentazione, dal WIT al Rust: nomina, non giudica.
pub(crate) fn from_index_loss(l: w_index::IndexLoss) -> fub_abi::traits::IndexLoss {
    fub_abi::traits::IndexLoss {
        id: from_doc(l.id),
        why: tr::from_error(l.why),
    }
}

// ---------------------------------------------------------------------------
// Gli eventi: maschera in ingresso, avviso in uscita
// ---------------------------------------------------------------------------

/// La maschera dichiarata dal componente, dal WIT al Rust.
///
/// Vuoto vuol dire *non filtro*, in tutti e quattro gli assi: una maschera
/// scritta prima delle grane nuove riceve ciò che riceveva.
pub(crate) fn from_event_mask(m: w_events::EventMask) -> fub_abi::event::EventMask {
    fub_abi::event::EventMask {
        kinds: m.kinds.into_iter().map(from_event_kind).collect(),
        topics: m.topics,
        subjects: m.subjects.into_iter().map(from_subject).collect(),
        changes: m.changes.into_iter().map(from_doc_change).collect(),
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
    use fub_abi::event::DocChange as R;
    match c {
        w_events::DocChange::Body => R::Body,
        w_events::DocChange::Frontmatter => R::Frontmatter,
        w_events::DocChange::Tags => R::Tags,
        w_events::DocChange::Links => R::Links,
        w_events::DocChange::Outline => R::Outline,
        w_events::DocChange::Anchors => R::Anchors,
    }
}

/// L'avviso con la sua origine, dal Rust al WIT: totale.
///
/// Il payload `custom` viaggia come JSON opaco via `to_json` (totale per
/// costruzione); l'errore di un `job-done` o di un `trouble` via `to_error`
/// (totale). L'origine porta chi ha chiesto e il lotto, mai reinterpretati.
pub(crate) fn to_notice(n: &fub_abi::event::Notice) -> w_events::Notice {
    w_events::Notice {
        event: to_event(&n.event),
        origin: to_origin(&n.origin),
    }
}

fn to_origin(o: &fub_abi::event::Origin) -> w_events::Origin {
    w_events::Origin {
        actor: to_actor(&o.actor),
        batch: o.batch.as_ref().map(to_batch),
    }
}

fn to_actor(a: &fub_abi::event::Actor) -> w_events::Actor {
    use fub_abi::event::Actor as R;
    match a {
        R::User => w_events::Actor::User,
        R::Watcher => w_events::Actor::Watcher,
        R::Kernel => w_events::Actor::Kernel,
        R::Plugin { id } => w_events::Actor::Plugin(w_events::ActorPlugin { id: id.clone() }),
    }
}

fn to_event(e: &fub_abi::event::Event) -> w_events::Event {
    use fub_abi::event::Event as R;
    match e {
        R::VaultOpened { root } => {
            w_events::Event::VaultOpened(w_events::EventVaultOpened { root: root.clone() })
        }
        R::DocumentChanged { id, changes } => {
            w_events::Event::DocumentChanged(w_events::EventDocumentChanged {
                id: to_doc(id),
                changes: changes.as_ref().map(to_changes),
            })
        }
        R::DocumentRemoved { id } => {
            w_events::Event::DocumentRemoved(w_events::EventDocumentRemoved { id: to_doc(id) })
        }
        R::DocumentRenamed { from, to } => {
            w_events::Event::DocumentRenamed(w_events::EventDocumentRenamed {
                from: to_doc(from),
                to: to_doc(to),
            })
        }
        R::IndexUpdated => w_events::Event::IndexUpdated,
        R::JobDone { id, job, result } => w_events::Event::JobDone(w_events::EventJobDone {
            id: to_job(id),
            job: job.clone(),
            result: match result {
                Ok(v) => Ok(tr::to_json(v)),
                Err(e) => Err(tr::to_error(e)),
            },
        }),
        R::Overflow { dropped } => {
            w_events::Event::Overflow(w_events::EventOverflow { dropped: *dropped })
        }
        R::Custom { topic, payload } => w_events::Event::Custom(w_events::EventCustom {
            topic: topic.clone(),
            payload: tr::to_json(payload),
        }),
        R::BatchEnded { batch, changed } => {
            w_events::Event::BatchEnded(w_events::EventBatchEnded {
                batch: to_batch(batch),
                changed: changed.iter().map(to_doc).collect(),
            })
        }
        R::ViewInvalidated { view, instance } => {
            w_events::Event::ViewInvalidated(w_events::EventViewInvalidated {
                view: view.clone(),
                instance: instance.clone(),
            })
        }
        R::VaultClosed { root } => {
            w_events::Event::VaultClosed(w_events::EventVaultClosed { root: root.clone() })
        }
        R::JobStarted { id, job } => w_events::Event::JobStarted(w_events::EventJobStarted {
            id: to_job(id),
            job: job.clone(),
        }),
        R::JobProgress { id, progress } => {
            w_events::Event::JobProgress(w_events::EventJobProgress {
                id: to_job(id),
                progress: to_progress(progress),
            })
        }
        R::SettingChanged { key, scope } => {
            w_events::Event::SettingChanged(w_events::EventSettingChanged {
                key: key.clone(),
                scope: to_setting_scope(scope),
            })
        }
        R::EntryChanged { id, kind } => {
            w_events::Event::EntryChanged(w_events::EventEntryChanged {
                id: to_doc(id),
                kind: to_entry_kind(kind),
            })
        }
        R::EntryRemoved { id, kind } => {
            w_events::Event::EntryRemoved(w_events::EventEntryRemoved {
                id: to_doc(id),
                kind: to_entry_kind(kind),
            })
        }
        R::EntryRenamed { from, to, kind } => {
            w_events::Event::EntryRenamed(w_events::EventEntryRenamed {
                from: to_doc(from),
                to: to_doc(to),
                kind: to_entry_kind(kind),
            })
        }
        R::Trouble {
            severity,
            subject,
            error,
            gate,
        } => w_events::Event::Trouble(w_events::EventTrouble {
            severity: to_severity(severity),
            subject: subject.as_ref().map(to_doc),
            error: tr::to_error(error),
            gate: gate.as_ref().map(to_gate),
        }),
        R::TimerFired { owner, timer } => w_events::Event::TimerFired(w_events::EventTimerFired {
            owner: owner.clone(),
            timer: timer.clone(),
        }),
    }
}

fn to_changes(c: &fub_abi::event::DocChanges) -> w_events::DocChanges {
    w_events::DocChanges {
        aspects: c.aspects.iter().map(to_doc_change).collect(),
        properties: c.properties.clone(),
        tags_added: c.tags_added.clone(),
        tags_removed: c.tags_removed.clone(),
    }
}

fn to_doc_change(c: &fub_abi::event::DocChange) -> w_events::DocChange {
    use fub_abi::event::DocChange as R;
    match c {
        R::Body => w_events::DocChange::Body,
        R::Frontmatter => w_events::DocChange::Frontmatter,
        R::Tags => w_events::DocChange::Tags,
        R::Links => w_events::DocChange::Links,
        R::Outline => w_events::DocChange::Outline,
        R::Anchors => w_events::DocChange::Anchors,
    }
}

fn to_progress(p: &fub_abi::traits::JobProgress) -> w_jobs::JobProgress {
    w_jobs::JobProgress {
        done: p.done,
        total: p.total,
        label: p.label.clone(),
    }
}

fn to_setting_scope(s: &fub_abi::settings::SettingScope) -> w_settings::SettingScope {
    use fub_abi::settings::SettingScope as R;
    match s {
        R::Vault => w_settings::SettingScope::Vault,
        R::Machine => w_settings::SettingScope::Machine,
    }
}

fn to_severity(s: &fub_abi::event::Severity) -> w_events::Severity {
    use fub_abi::event::Severity as R;
    match s {
        R::Warning => w_events::Severity::Warning,
        R::Failure => w_events::Severity::Failure,
    }
}

fn to_gate(g: &fub_abi::gate::Gate) -> w_events::Gate {
    use fub_abi::gate::Gate as R;
    match g {
        R::Command => w_events::Gate::Command,
        R::ViewRender => w_events::Gate::ViewRender,
        R::ViewAction => w_events::Gate::ViewAction,
        R::Service => w_events::Gate::Service,
        R::Event => w_events::Gate::Event,
        R::IndexFeed => w_events::Gate::IndexFeed,
        R::IndexForget => w_events::Gate::IndexForget,
        R::IndexUpToDate => w_events::Gate::IndexUpToDate,
        R::IndexReconcile => w_events::Gate::IndexReconcile,
        R::FormatParse => w_events::Gate::FormatParse,
        R::SyntaxRule => w_events::Gate::SyntaxRule,
        R::CustomRender => w_events::Gate::CustomRender,
        R::Job => w_events::Gate::Job,
        R::IndexQuery => w_events::Gate::IndexQuery,
    }
}
