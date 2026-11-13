//! Le interrogazioni locali: `query` (con i task e i bersagli dei link),
//! `search`, `commands`, `properties` e `tasks`.

use crate::cli::{CommandArgs, GlobalArgs, PropertiesArgs, QueryArgs, SearchArgs, TasksArgs};
use crate::commands::{
    doc_id, paginate, parse_json_object, render_text_value, Connection, Failure,
};
use crate::output::envelope_ok;
use crate::output::OutputFormat;

use super::{
    build_matching, confirm_write, dry_run, match_json, outcome_json, search_expr, vault_required,
};

fn collect_tasks(blocks: &[fub_abi::Block], rows: &mut Vec<serde_json::Value>) {
    for block in blocks {
        match block {
            fub_abi::Block::List { items, .. } => {
                for item in items {
                    if let Some(marker) = item.task {
                        rows.push(serde_json::json!({
                            "checked": marker.checked(),
                            "symbol": marker.symbol.map(|c| c.to_string()),
                            "start": marker.span.start,
                            "end": marker.span.end,
                        }));
                    }
                    collect_tasks(&item.blocks, rows);
                }
            }
            fub_abi::Block::Quote { blocks, .. } => collect_tasks(blocks, rows),
            _ => {}
        }
    }
}

/// Il bersaglio di un link scritto a mano: un URL, un `[[wikilink]]` o un
/// path. Lo leggono `query --resolve` e lo strumento `fub_query` dell'MCP.
pub(crate) fn link_target(raw: &str) -> fub_abi::LinkTarget {
    if raw.contains("://") || raw.starts_with("//") {
        fub_abi::LinkTarget::Url(raw.to_string())
    } else if raw.starts_with("[[") && raw.ends_with("]]") {
        let inner = raw.trim_start_matches('[').trim_end_matches(']').trim();
        fub_abi::model::parse_wikilink_inner(inner).target
    } else {
        fub_abi::LinkTarget::Path(raw.to_string())
    }
}

pub fn query(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: QueryArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    // Varianti dirette: backlinks/neighbors/resolve, poi Documents generica.
    if let Some(target) = args.backlinks.as_deref() {
        let id = doc_id(target)?;
        let page = global
            .limit
            .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
        match connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::Backlinks {
                    target: id.clone(),
                    page,
                },
            )
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::Backlinks(paged) => {
                let items: Vec<serde_json::Value> = paged.items.into_iter().map(|b| serde_json::json!({ "source": b.source.as_str(), "context": b.context })).collect();
                print(&envelope_ok(
                    serde_json::json!({ "target": id.as_str(), "items": items, "offset": paged.offset, "total": paged.total }),
                ));
                return Ok(());
            }
            other => {
                return Err(Failure::local(format!(
                    "backlinks ha risposto {}",
                    other.kind_name()
                )))
            }
        }
    }
    if let Some(seed) = args.neighbors.as_deref() {
        let id = doc_id(seed)?;
        let page = global
            .limit
            .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
        let seeds = fub_abi::QueryExpr::of(fub_abi::QueryPredicate::Docs {
            docs: vec![id.clone()],
        });
        match connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::Neighbors {
                    seeds,
                    direction: fub_abi::LinkDirection::Both,
                    depth: 1,
                    page,
                },
            )
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::Neighbors(paged) => {
                let items: Vec<serde_json::Value> = paged
                    .items
                    .into_iter()
                    .map(|n| serde_json::json!({ "doc": n.doc.as_str(), "via": n.via.as_str() }))
                    .collect();
                print(&envelope_ok(
                    serde_json::json!({ "seed": id.as_str(), "items": items, "offset": paged.offset, "total": paged.total }),
                ));
                return Ok(());
            }
            other => {
                return Err(Failure::local(format!(
                    "neighbors ha risposto {}",
                    other.kind_name()
                )))
            }
        }
    }
    if let Some(raw) = args.resolve.as_deref() {
        let target = link_target(raw);
        match connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::Resolve { target, from: None },
            )
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::Resolved(resolved) => {
                print(&envelope_ok(
                    serde_json::json!({ "resolved": resolved.map(|r| r.doc.as_str().to_string()) }),
                ));
                return Ok(());
            }
            other => {
                return Err(Failure::local(format!(
                    "resolve ha risposto {}",
                    other.kind_name()
                )))
            }
        }
    }
    let matching = build_matching(&args)?;
    let page = global
        .limit
        .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
    let select = fub_abi::PropertySelect::None;
    let query = fub_abi::IndexQuery::Documents {
        matching,
        sort: None,
        select,
        page,
        excerpts: fub_abi::Excerpts::Attach,
    };
    match connection
        .host
        .query_index(connection.vault_selector(), query)
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Documents(paged) => {
            let items: Vec<serde_json::Value> = paged.items.iter().map(match_json).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }),
            ));
            Ok(())
        }
        other => Err(Failure::local(format!(
            "documents ha risposto {}",
            other.kind_name()
        ))),
    }
}

pub fn search(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: SearchArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let matching = search_expr(
        &args.query,
        &args.field,
        args.phrase,
        args.tag.as_deref(),
        args.folder.as_deref(),
    )?;
    let select = if args.select.is_empty() {
        fub_abi::PropertySelect::None
    } else {
        fub_abi::PropertySelect::Keys {
            keys: args.select.clone(),
        }
    };
    let page = global
        .limit
        .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
    let query = fub_abi::IndexQuery::Documents {
        matching,
        sort: None,
        select,
        page,
        excerpts: fub_abi::Excerpts::Attach,
    };
    match connection
        .host
        .query_index(connection.vault_selector(), query)
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Documents(paged) => {
            let items: Vec<serde_json::Value> = paged.items.iter().map(match_json).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }),
            ));
            Ok(())
        }
        other => Err(Failure::local(format!(
            "search ha risposto {}",
            other.kind_name()
        ))),
    }
}

pub fn registry_command(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: CommandArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    if args.list || args.name.is_none() {
        let specs = connection
            .host
            .commands(connection.vault_selector())
            .map_err(|error| Failure::from_plugin(&error))?;
        let offset = global.offset.unwrap_or(0);
        let (page, total) = paginate(specs, offset, global.limit);
        let items: Vec<_> = page.iter().map(|spec| serde_json::json!({
            "id": spec.id, "title": render_text_value(&spec.title), "writes": spec.scope.writes,
        })).collect();
        print(&envelope_ok(
            serde_json::json!({ "items": items, "offset": offset, "total": total }),
        ));
        return Ok(());
    }
    let name = args.name.clone().unwrap_or_default();
    let parsed = parse_json_object(args.args_json.as_deref().unwrap_or("{}"))?;
    let mode = if dry_run(global) || args.show_plan {
        fub_abi::InvokeMode::DryRun
    } else {
        fub_abi::InvokeMode::Apply
    };
    if mode == fub_abi::InvokeMode::Apply {
        // I comandi che scrivono chiedono conferma; i piani si mostrano e basta.
        let specs = connection
            .host
            .commands(connection.vault_selector())
            .map_err(|error| Failure::from_plugin(&error))?;
        let writes = specs
            .iter()
            .find(|s| s.id == name)
            .is_some_and(|s| s.scope.writes);
        if writes {
            confirm_write(global, &format!("invocare `{name}`"))?;
        }
    }
    let outcome = connection
        .host
        .invoke_user_command(connection.vault_selector(), &name, parsed, mode)
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(outcome_json(&outcome)));
    Ok(())
}

pub fn properties(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: PropertiesArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    // Lettura: Documents con select sulle chiavi chieste (o All con --list).
    if !args.set.is_empty() || !args.remove.is_empty() {
        if args.doc.is_none() {
            return Err(Failure::bad_args(
                "properties --set/--remove vuole un documento",
            ));
        }
        let doc = args.doc.clone().unwrap_or_default();
        let mut outcomes = Vec::new();
        for pair in &args.set {
            let (key, value) = pair
                .split_once('=')
                .ok_or_else(|| Failure::bad_args("--set vuole chiave=valore"))?;
            if key.trim().is_empty() {
                return Err(Failure::bad_args("--set con chiave vuota"));
            }
            let mode = if dry_run(global) {
                fub_abi::InvokeMode::DryRun
            } else {
                fub_abi::InvokeMode::Apply
            };
            if mode == fub_abi::InvokeMode::Apply {
                confirm_write(global, &format!("impostare `{key}` su `{doc}`"))?;
            }
            let outcome = connection
                .host
                .invoke_user_command(
                    connection.vault_selector(),
                    "note.property.set",
                    serde_json::json!({ "doc": doc, "key": key.trim(), "value": value }),
                    mode,
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            outcomes.push(outcome_json(&outcome));
        }
        for key in &args.remove {
            if key.trim().is_empty() {
                return Err(Failure::bad_args("--remove con chiave vuota"));
            }
            let mode = if dry_run(global) {
                fub_abi::InvokeMode::DryRun
            } else {
                fub_abi::InvokeMode::Apply
            };
            if mode == fub_abi::InvokeMode::Apply {
                confirm_write(global, &format!("togliere `{key}` da `{doc}`"))?;
            }
            let outcome = connection
                .host
                .invoke_user_command(
                    connection.vault_selector(),
                    "note.property.remove",
                    serde_json::json!({ "doc": doc, "key": key.trim() }),
                    mode,
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            outcomes.push(outcome_json(&outcome));
        }
        print(&envelope_ok(
            serde_json::json!({ "doc": doc, "outcomes": outcomes, "dry_run": dry_run(global) }),
        ));
        return Ok(());
    }
    // Lettura proprietà: modello + frontmatter via Documents select.
    let select = match args.key.as_deref() {
        Some(key) => fub_abi::PropertySelect::Keys {
            keys: vec![key.to_string()],
        },
        None => fub_abi::PropertySelect::All,
    };
    let matching = match args.doc.as_deref() {
        Some(doc) => {
            let id = doc_id(doc)?;
            fub_abi::QueryExpr::of(fub_abi::QueryPredicate::Docs { docs: vec![id] })
        }
        None => fub_abi::QueryExpr::all(),
    };
    let page = global
        .limit
        .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
    let query = fub_abi::IndexQuery::Documents {
        matching,
        sort: None,
        select,
        page,
        excerpts: fub_abi::Excerpts::Omit,
    };
    match connection
        .host
        .query_index(connection.vault_selector(), query)
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Documents(paged) => {
            let items: Vec<serde_json::Value> = paged
                .items
                .iter()
                .map(|m| serde_json::json!({ "doc": m.doc.as_str(), "properties": m.properties }))
                .collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }),
            ));
            Ok(())
        }
        other => Err(Failure::local(format!(
            "properties ha risposto {}",
            other.kind_name()
        ))),
    }
}

pub fn tasks(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: TasksArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    if args.list || args.toggle_at.is_empty() {
        // Elenco task dal modello: testo + stato, senza sintassi inventata.
        let model = connection
            .host
            .read_model(connection.vault_selector(), &id)
            .map_err(|error| Failure::from_plugin(&error))?;
        let mut rows: Vec<serde_json::Value> = Vec::new();
        collect_tasks(&model.body, &mut rows);
        let offset = global.offset.unwrap_or(0);
        let (page, total) = paginate(rows, offset, global.limit);
        print(&envelope_ok(
            serde_json::json!({ "items": page, "offset": offset, "total": total }),
        ));
        return Ok(());
    }
    let mut offsets = args.toggle_at.clone();
    offsets.sort_unstable();
    offsets.dedup();
    let mode = if dry_run(global) {
        fub_abi::InvokeMode::DryRun
    } else {
        fub_abi::InvokeMode::Apply
    };
    if mode == fub_abi::InvokeMode::Apply {
        confirm_write(global, &format!("spuntare task in `{}`", args.doc))?;
    }
    let outcome = connection
        .host
        .invoke_user_command(
            connection.vault_selector(),
            "note.task.toggle",
            serde_json::json!({ "doc": id.as_str(), "at": offsets }),
            mode,
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(outcome_json(&outcome)));
    Ok(())
}
