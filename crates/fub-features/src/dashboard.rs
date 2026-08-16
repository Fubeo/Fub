//! Dashboard del vault: conteggi e salute, non le statistiche della nota aperta.
//!
//! [`stats`](crate::stats) guarda **un** documento (barra di stato). Questa view
//! guarda il vault: quante note, quanti tag, quanti file, quanti link rotti.
//! Legge solo il canale dati (`IndexQuery::{Entries,Tags,VaultHealth}`).
//!
//! Sta in sidebar e non su `Main`: una view principale la shell la apre solo
//! con un comando di shell (`shell.graph`) o con `OpenView`, e quest'ultimo
//! oggi la shell non lo esegue. Una dashboard che non si vede non è una
//! dashboard.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::query::QueryExpr;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    EntryKind, HealthCheck, HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiNode, ViewUpdate};

/// Id del componente (spazio dati/registrazione).
pub const DASHBOARD_ID: &str = "fub.dashboard";
/// Id della `ViewSpec`.
pub const DASHBOARD_VIEW: &str = "dashboard";

const OPEN: &str = "open";
const VIEW_TITLE: &str = "view_title";
const NOTES: &str = "notes";
const TAGS: &str = "tags";
const FILES: &str = "files";
const BROKEN: &str = "broken";
const NO_BROKEN: &str = "no_broken";

/// Le stringhe del pannello.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Dashboard")
            .with(NOTES, "{n} note")
            .with(TAGS, "{n} tag")
            .with(FILES, "{n} file")
            .with(BROKEN, "{n} link rotti")
            .with(NO_BROKEN, "Nessun link rotto."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Dashboard")
            .with(NOTES, "{n} notes")
            .with(TAGS, "{n} tags")
            .with(FILES, "{n} files")
            .with(BROKEN, "{n} broken links")
            .with(NO_BROKEN, "No broken links."),
    ]
}

/// Il pannello dashboard del vault.
pub struct DashboardView;

impl ViewProvider for DashboardView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            DASHBOARD_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("dashboard")
        .ordered(6)]
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
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            OPEN => {
                let Some(doc) = action.payload.get("doc").and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                Ok(ViewUpdate::Navigate {
                    doc_id: doc.to_string(),
                })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let notes = conta(
        host,
        IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: None,
            page: None,
        },
        |r| match r {
            IndexResult::Entries(p) => Ok(p.total),
            other => fuori_tema("entries", other),
        },
    )?;
    let files = conta(
        host,
        IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        },
        |r| match r {
            IndexResult::Entries(p) => Ok(p.total),
            other => fuori_tema("entries", other),
        },
    )?;
    let tags = conta(
        host,
        IndexQuery::Tags {
            matching: QueryExpr::all(),
            page: None,
        },
        |r| match r {
            IndexResult::Tags(p) => Ok(p.total),
            other => fuori_tema("tags", other),
        },
    )?;
    let rotti = match host.query_index(IndexQuery::VaultHealth {
        check: HealthCheck::BrokenLinks,
        page: None,
    })? {
        IndexResult::VaultHealth(p) => p,
        other => return fuori_tema("vault-health", other),
    };

    let mut figli = vec![
        riga(NOTES, notes),
        riga(TAGS, tags),
        riga(FILES, files),
        riga(BROKEN, rotti.total),
    ];
    if rotti.items.is_empty() {
        figli.push(UiNode::empty_state(Text::key(NO_BROKEN)));
    } else {
        figli.push(UiNode::list(
            rotti
                .items
                .into_iter()
                .map(|issue| {
                    let id = issue.doc.as_str().to_string();
                    UiNode::list_item(
                        Text::from(id.clone()),
                        issue.detail.map(Text::from),
                        Some(ActionRef::with(OPEN, serde_json::json!({ "doc": id }))),
                    )
                    .with_key(issue.doc.0)
                })
                .collect(),
        ));
    }
    Ok(UiNode::column(1, figli))
}

fn riga(chiave: &str, n: u32) -> UiNode {
    UiNode::text(Text::message(chiave, vec![Arg::int("n", n as i64)]))
}

fn conta(
    host: &dyn ReadApi,
    q: IndexQuery,
    leggi: fn(IndexResult) -> Result<u32, PluginError>,
) -> Result<u32, PluginError> {
    leggi(host.query_index(q)?)
}

fn fuori_tema<T>(atteso: &str, other: IndexResult) -> Result<T, PluginError> {
    Err(PluginError::Internal(
        format!("dashboard: atteso {atteso}, arrivato {}", other.kind_name()).into(),
    ))
}
