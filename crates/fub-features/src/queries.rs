//! Query salvate: persistere, elencare, eseguire.
//!
//! Il motore (`QueryExpr` / `query_index`) c'è già. Questa feature è il
//! **cassetto**: `queries.json` nello spazio dati del plugin, un pannello che le
//! elenca, tre comandi che le scrivono e le lanciano.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode,
    ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexQuery, ReadApi, ViewInstance, ViewInterests, ViewProvider,
    ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};
use serde::{Deserialize, Serialize};

/// Id del componente (spazio dati/registrazione).
pub const QUERIES_ID: &str = "fub.queries";
/// Id della `ViewSpec`.
pub const QUERIES_VIEW: &str = "queries";
/// Id della view collezioni: le stesse query, da sfogliare.
pub const COLLECTIONS_VIEW: &str = "collections";
/// Salva (o sovrascrive) una query.
pub const QUERIES_SAVE: &str = "queries.save";
/// Esegue una query salvata.
pub const QUERIES_RUN: &str = "queries.run";
/// Cancella una query salvata.
pub const QUERIES_DELETE: &str = "queries.delete";

const STORE: &str = "queries.json";
const LAST: &str = "last";
const SCHEMA: u32 = 1;

const RUN: &str = "run";
const DELETE: &str = "delete";
const SAVE: &str = "save";
const OPEN: &str = "open";
const ID: &str = "id";
const NAME: &str = "name";
const EXPR: &str = "expr";
const TEXT: &str = "text";
const NEW_NAME: &str = "new_name";
const NEW_TEXT: &str = "new_text";

const VIEW_TITLE: &str = "view_title";
const COLLECTIONS_TITLE: &str = "collections_title";
const COLLECTIONS_EMPTY: &str = "collections_empty";
const EMPTY: &str = "empty";
const RESULTS: &str = "results";
const NO_MATCH: &str = "no_match";
const SAVE_NAME: &str = "save_name";
const SAVE_TEXT: &str = "save_text";
const SAVE_SUBMIT: &str = "save_submit";
const RUN_LABEL: &str = "run_label";
const DELETE_LABEL: &str = "delete_label";
const E_EMPTY_NAME: &str = "e_empty_name";
const E_NO_EXPR: &str = "e_no_expr";
const E_BAD_EXPR: &str = "e_bad_expr";
const E_MISSING: &str = "e_missing";
const E_STORE: &str = "e_store";
const P_SAVE: &str = "p_save";
const P_DELETE: &str = "p_delete";
const P_RUN: &str = "p_run";
const FAILED: &str = "failed";

/// Le stringhe del pannello e dei comandi.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Query")
            .with(COLLECTIONS_TITLE, "Collezioni")
            .with(COLLECTIONS_EMPTY, "Nessuna collezione. Salva una query.")
            .with(EMPTY, "Nessuna query salvata.")
            .with(RESULTS, "Risultati di «{name}»")
            .with(NO_MATCH, "Nessuna nota combacia.")
            .with(SAVE_NAME, "Nome")
            .with(SAVE_TEXT, "Testo")
            .with(SAVE_SUBMIT, "Salva")
            .with(RUN_LABEL, "Esegui")
            .with(DELETE_LABEL, "Elimina")
            .with(E_EMPTY_NAME, "Il nome è vuoto.")
            .with(E_NO_EXPR, "Manca l'espressione (o il testo da cui farla).")
            .with(E_BAD_EXPR, "Espressione illeggibile: {reason}")
            .with(E_MISSING, "Nessuna query «{id}».")
            .with(E_STORE, "Non ho potuto leggere le query salvate: {reason}")
            .with(P_SAVE, "Salvata «{name}»")
            .with(P_DELETE, "Tolta «{name}»")
            .with(P_RUN, "{n} note per «{name}»")
            .with(FAILED, "Query: {reason}")
            .with("queries.save.title", "Salva query")
            .with(
                "queries.save.desc",
                "Memorizza un'espressione da rilanciare.",
            )
            .with("queries.save.id.title", "Id")
            .with("queries.save.id.desc", "Se c'è, sovrascrive quella query.")
            .with("queries.save.name.title", "Nome")
            .with("queries.save.name.desc", "Come compare nell'elenco.")
            .with("queries.save.expr.title", "Espressione")
            .with("queries.save.expr.desc", "JSON di QueryExpr, o oggetto.")
            .with("queries.save.text.title", "Testo")
            .with(
                "queries.save.text.desc",
                "Scorciatoia: una ricerca per termini, se manca expr.",
            )
            .with("queries.run.title", "Esegui query")
            .with("queries.run.desc", "Lancia una query salvata.")
            .with("queries.run.id.title", "Id")
            .with("queries.run.id.desc", "Quale query eseguire.")
            .with("queries.delete.title", "Elimina query")
            .with("queries.delete.desc", "Toglie una query salvata.")
            .with("queries.delete.id.title", "Id")
            .with("queries.delete.id.desc", "Quale query togliere."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Queries")
            .with(COLLECTIONS_TITLE, "Collections")
            .with(COLLECTIONS_EMPTY, "No collections. Save a query.")
            .with(EMPTY, "No saved queries.")
            .with(RESULTS, "Results of «{name}»")
            .with(NO_MATCH, "No matching notes.")
            .with(SAVE_NAME, "Name")
            .with(SAVE_TEXT, "Text")
            .with(SAVE_SUBMIT, "Save")
            .with(RUN_LABEL, "Run")
            .with(DELETE_LABEL, "Delete")
            .with(E_EMPTY_NAME, "The name is empty.")
            .with(E_NO_EXPR, "Missing expression (or text to build one from).")
            .with(E_BAD_EXPR, "Unreadable expression: {reason}")
            .with(E_MISSING, "No query «{id}».")
            .with(E_STORE, "Could not read saved queries: {reason}")
            .with(P_SAVE, "Saved «{name}»")
            .with(P_DELETE, "Removed «{name}»")
            .with(P_RUN, "{n} notes for «{name}»")
            .with(FAILED, "Query: {reason}")
            .with("queries.save.title", "Save query")
            .with("queries.save.desc", "Stores an expression to run again.")
            .with("queries.save.id.title", "Id")
            .with("queries.save.id.desc", "If set, overwrites that query.")
            .with("queries.save.name.title", "Name")
            .with("queries.save.name.desc", "How it appears in the list.")
            .with("queries.save.expr.title", "Expression")
            .with("queries.save.expr.desc", "QueryExpr JSON, or object.")
            .with("queries.save.text.title", "Text")
            .with(
                "queries.save.text.desc",
                "Shortcut: a terms search, if expr is absent.",
            )
            .with("queries.run.title", "Run query")
            .with("queries.run.desc", "Runs a saved query.")
            .with("queries.run.id.title", "Id")
            .with("queries.run.id.desc", "Which query to run.")
            .with("queries.delete.title", "Delete query")
            .with("queries.delete.desc", "Removes a saved query.")
            .with("queries.delete.id.title", "Id")
            .with("queries.delete.id.desc", "Which query to remove."),
    ]
}

/// Il pannello delle query salvate.
pub struct QueriesView;

impl ViewProvider for QueriesView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                QUERIES_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("search")
            .ordered(5),
            ViewSpec::new(
                COLLECTIONS_VIEW,
                Text::key(COLLECTIONS_TITLE),
                ViewSurface::LeftSidebar,
            )
            .with_icon("collection")
            .ordered(5),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        albero(instance.view.as_str(), host, None)
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        let view = instance.view.as_str();
        match action.action.0.as_str() {
            SAVE => {
                let name = action.text_field(NEW_NAME).unwrap_or_default();
                let text = action.text_field(NEW_TEXT).unwrap_or_default();
                comando_poi_albero(
                    host,
                    view,
                    QUERIES_SAVE,
                    serde_json::json!({ NAME: name, TEXT: text }),
                )
            }
            RUN => {
                let Some(id) = action.payload.get(ID).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(LAST, Some(serde_json::Value::String(id.to_string())))?;
                comando_poi_albero(host, view, QUERIES_RUN, serde_json::json!({ ID: id }))
            }
            DELETE => {
                let Some(id) = action.payload.get(ID).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                if host
                    .view_state(LAST)?
                    .and_then(|v| v.as_str().map(str::to_string))
                    .as_deref()
                    == Some(id)
                {
                    host.set_view_state(LAST, None)?;
                }
                comando_poi_albero(host, view, QUERIES_DELETE, serde_json::json!({ ID: id }))
            }
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

fn comando_poi_albero(
    host: &mut dyn HostApi,
    view: &str,
    id: &str,
    args: serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
    match host.run_command(id, args) {
        Ok(_) => Ok(ViewUpdate::Replace {
            root: albero(view, host, None)?,
        }),
        Err(e) => Ok(ViewUpdate::Replace {
            root: albero(
                view,
                host,
                Some(Text::message(
                    FAILED,
                    vec![Arg::text("reason", e.to_string())],
                )),
            )?,
        }),
    }
}

fn albero(view: &str, host: &dyn ReadApi, avviso: Option<Text>) -> Result<UiNode, PluginError> {
    if view == COLLECTIONS_VIEW {
        collections_tree(host, avviso)
    } else {
        tree(host, avviso)
    }
}

fn tree(host: &dyn ReadApi, avviso: Option<Text>) -> Result<UiNode, PluginError> {
    let store = leggi(host)?;
    let mut figli = Vec::new();
    if let Some(avviso) = avviso {
        figli.push(UiNode::failed(avviso, None));
    }
    if store.queries.is_empty() {
        figli.push(UiNode::empty_state(Text::key(EMPTY)));
    } else {
        figli.push(UiNode::list(
            store
                .queries
                .iter()
                .map(|q| {
                    let payload = serde_json::json!({ ID: q.id });
                    UiNode::keyed(
                        &q.id,
                        UiKind::Stack {
                            dir: fub_abi::ui::Axis::Row,
                            gap: 1,
                            children: vec![
                                UiNode::list_item(Text::from(q.name.clone()), None, None),
                                UiNode::button(
                                    Text::key(RUN_LABEL),
                                    Intent::Primary,
                                    ActionRef::with(RUN, payload.clone()),
                                ),
                                UiNode::button(
                                    Text::key(DELETE_LABEL),
                                    Intent::Danger,
                                    ActionRef::with(DELETE, payload),
                                ),
                            ],
                        },
                    )
                })
                .collect(),
        ));
    }
    if let Some(id) = host
        .view_state(LAST)?
        .and_then(|v| v.as_str().map(str::to_string))
    {
        if let Some(q) = store.queries.iter().find(|q| q.id == id) {
            figli.push(risultati(host, q)?);
        }
    }
    figli.push(form_salva());
    Ok(UiNode::column(1, figli))
}

fn collections_tree(host: &dyn ReadApi, avviso: Option<Text>) -> Result<UiNode, PluginError> {
    let store = leggi(host)?;
    let mut figli = Vec::new();
    if let Some(avviso) = avviso {
        figli.push(UiNode::failed(avviso, None));
    }
    if store.queries.is_empty() {
        figli.push(UiNode::empty_state(Text::key(COLLECTIONS_EMPTY)));
    } else {
        figli.push(UiNode::list(
            store
                .queries
                .iter()
                .map(|q| {
                    UiNode::list_item(
                        Text::from(q.name.clone()),
                        None,
                        Some(ActionRef::with(RUN, serde_json::json!({ ID: q.id }))),
                    )
                    .with_key(&q.id)
                })
                .collect(),
        ));
    }
    if let Some(id) = host
        .view_state(LAST)?
        .and_then(|v| v.as_str().map(str::to_string))
    {
        if let Some(q) = store.queries.iter().find(|q| q.id == id) {
            figli.push(risultati(host, q)?);
        }
    }
    Ok(UiNode::column(1, figli))
}

fn risultati(host: &dyn ReadApi, q: &SavedQuery) -> Result<UiNode, PluginError> {
    let paged = host
        .query_index(IndexQuery::Documents {
            matching: q.expr.clone(),
            sort: None,
            select: Default::default(),
            page: None,
            excerpts: Default::default(),
        })?
        .documents()?;
    let mut figli = vec![UiNode::new(UiKind::Text {
        content: Text::message(RESULTS, vec![Arg::text(NAME, q.name.clone())]),
    })];
    if paged.items.is_empty() {
        figli.push(UiNode::empty_state(Text::key(NO_MATCH)));
    } else {
        figli.push(UiNode::list(
            paged
                .items
                .into_iter()
                .map(|m| {
                    let id = m.doc.as_str().to_string();
                    UiNode::list_item(
                        Text::from(id.clone()),
                        m.snippet.map(Text::from),
                        Some(ActionRef::with(OPEN, serde_json::json!({ "doc": id }))),
                    )
                    .with_key(m.doc.0)
                })
                .collect(),
        ));
    }
    Ok(UiNode::column(1, figli))
}

fn form_salva() -> UiNode {
    UiNode::new(UiKind::Form {
        children: vec![
            UiNode::new(UiKind::TextInput {
                field: NEW_NAME.to_string(),
                label: Some(Text::key(SAVE_NAME)),
                value: String::new(),
                placeholder: None,
                action: None,
            })
            .with_key(NEW_NAME),
            UiNode::new(UiKind::TextInput {
                field: NEW_TEXT.to_string(),
                label: Some(Text::key(SAVE_TEXT)),
                value: String::new(),
                placeholder: None,
                action: None,
            })
            .with_key(NEW_TEXT),
        ],
        submit_label: Text::key(SAVE_SUBMIT),
        submit: ActionRef::new(SAVE),
    })
}

/// I comandi `queries.save` / `queries.run` / `queries.delete`.
pub struct QueriesCommands;

impl CommandProvider for QueriesCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            comando(QUERIES_SAVE)
                .with_param(parametro(QUERIES_SAVE, ID, ParamKind::Text))
                .with_param(parametro(QUERIES_SAVE, NAME, ParamKind::Text).required())
                .with_param(parametro(QUERIES_SAVE, EXPR, ParamKind::Text))
                .with_param(parametro(QUERIES_SAVE, TEXT, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            comando(QUERIES_RUN)
                .with_param(parametro(QUERIES_RUN, ID, ParamKind::Text).required())
                .with_scope(CommandScope::read_only()),
            comando(QUERIES_DELETE)
                .with_param(parametro(QUERIES_DELETE, ID, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            QUERIES_SAVE => save(Args::new(&args), &args, mode, host),
            QUERIES_RUN => run(Args::new(&args), mode, host),
            QUERIES_DELETE => delete(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn comando(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parametro(comando: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{comando}.{name}.title")), kind)
        .describing(Text::key(format!("{comando}.{name}.desc")))
}

fn save(
    args: Args<'_>,
    raw: &serde_json::Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let name = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_EMPTY_NAME)))?
        .to_string();
    let expr = expr_da(args, raw)?;
    let mut store = leggi(host)?;
    let id = args
        .text(ID)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id_libero(&store, &name));
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_SAVE,
            vec![Arg::text(NAME, &name)],
        )));
    }
    if let Some(esistente) = store.queries.iter_mut().find(|q| q.id == id) {
        esistente.name = name.clone();
        esistente.expr = expr;
    } else {
        store.queries.push(SavedQuery {
            id,
            name: name.clone(),
            expr,
        });
    }
    scrivi(host, &store)?;
    Ok(CommandOutcome::notify(Text::message(
        P_SAVE,
        vec![Arg::text(NAME, name)],
    )))
}

fn run(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let id = id_da(args)?;
    let store = leggi(host)?;
    let q =
        store.queries.iter().find(|q| q.id == id).ok_or_else(|| {
            PluginError::BadArgs(Text::message(E_MISSING, vec![Arg::text(ID, &id)]))
        })?;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_RUN,
            vec![Arg::text(NAME, &q.name), Arg::int("n", 0)],
        )));
    }
    let paged = host
        .query_index(IndexQuery::Documents {
            matching: q.expr.clone(),
            sort: None,
            select: Default::default(),
            page: None,
            excerpts: Default::default(),
        })?
        .documents()?;
    let n = paged.total as i64;
    let notify = Text::message(P_RUN, vec![Arg::text(NAME, &q.name), Arg::int("n", n)]);
    if paged.items.len() == 1 {
        return Ok(
            CommandOutcome::notify(notify).with_effect(CommandEffect::Navigate {
                doc: paged.items[0].doc.clone(),
            }),
        );
    }
    Ok(CommandOutcome::notify(notify))
}

fn delete(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let id = id_da(args)?;
    let mut store = leggi(host)?;
    let Some(pos) = store.queries.iter().position(|q| q.id == id) else {
        return Err(PluginError::BadArgs(Text::message(
            E_MISSING,
            vec![Arg::text(ID, &id)],
        )));
    };
    let name = store.queries[pos].name.clone();
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_DELETE,
            vec![Arg::text(NAME, name)],
        )));
    }
    store.queries.remove(pos);
    scrivi(host, &store)?;
    Ok(CommandOutcome::notify(Text::message(
        P_DELETE,
        vec![Arg::text(NAME, name)],
    )))
}

fn id_da(args: Args<'_>) -> Result<String, PluginError> {
    args.text(ID)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| PluginError::BadArgs(Text::message(E_MISSING, vec![Arg::text(ID, "")])))
}

fn expr_da(args: Args<'_>, raw: &serde_json::Value) -> Result<QueryExpr, PluginError> {
    if let Some(v) = raw.get(EXPR) {
        if !v.is_null() && !(v.is_string() && v.as_str().is_some_and(str::is_empty)) {
            return parse_expr(v);
        }
    }
    if let Some(text) = args.text(TEXT).map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(QueryExpr::of(QueryPredicate::Text(TextQuery::terms(text))));
    }
    Err(PluginError::BadArgs(Text::key(E_NO_EXPR)))
}

fn parse_expr(v: &serde_json::Value) -> Result<QueryExpr, PluginError> {
    if let Some(s) = v.as_str() {
        return serde_json::from_str(s).map_err(|e| {
            PluginError::BadArgs(Text::message(
                E_BAD_EXPR,
                vec![Arg::text("reason", e.to_string())],
            ))
        });
    }
    serde_json::from_value(v.clone()).map_err(|e| {
        PluginError::BadArgs(Text::message(
            E_BAD_EXPR,
            vec![Arg::text("reason", e.to_string())],
        ))
    })
}

fn id_libero(store: &Store, name: &str) -> String {
    let mut base: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while base.contains("--") {
        base = base.replace("--", "-");
    }
    let base = base.trim_matches('-');
    let base = if base.is_empty() { "q" } else { base };
    if store.queries.iter().all(|q| q.id != base) {
        return base.to_string();
    }
    for n in 2.. {
        let candidato = format!("{base}-{n}");
        if store.queries.iter().all(|q| q.id != candidato) {
            return candidato;
        }
    }
    base.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Store {
    schema_version: u32,
    queries: Vec<SavedQuery>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SavedQuery {
    id: String,
    name: String,
    expr: QueryExpr,
}

fn leggi(host: &dyn ReadApi) -> Result<Store, PluginError> {
    match host.data_read(STORE)? {
        None => Ok(Store {
            schema_version: SCHEMA,
            queries: Vec::new(),
        }),
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            PluginError::Internal(Text::message(
                E_STORE,
                vec![Arg::text("reason", e.to_string())],
            ))
        }),
    }
}

fn scrivi(host: &mut dyn HostApi, store: &Store) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|e| PluginError::Internal(format!("queries.json: {e}").into()))?;
    host.data_write(STORE, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_slug_dalla_frase() {
        let store = Store {
            schema_version: 1,
            queries: Vec::new(),
        };
        assert_eq!(id_libero(&store, "Inbox rust"), "inbox-rust");
    }

    #[test]
    fn id_slug_evita_i_duplicati() {
        let store = Store {
            schema_version: 1,
            queries: vec![SavedQuery {
                id: "inbox".into(),
                name: "Inbox".into(),
                expr: QueryExpr::all(),
            }],
        };
        assert_eq!(id_libero(&store, "Inbox"), "inbox-2");
    }

    #[test]
    fn parse_expr_da_oggetto() {
        let v = serde_json::json!({"any": []});
        assert_eq!(parse_expr(&v).unwrap(), QueryExpr::all());
    }
}
