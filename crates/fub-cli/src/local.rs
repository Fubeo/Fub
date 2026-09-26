//! Tutti i comandi locali sopra Host: vault/read/write/create/append/prepend,
//! files/query/search/commands/properties/tasks/templates/views/plugin/theme/
//! diagnostics/capture/uri/pairing. I remoti stanno in `remote.rs` (client reali).

use super::cli::*;
use super::commands::{
    doc_id, paginate, parse_json_object, read_file_text, read_stdin_text, render_error_text,
    render_text_value, Connection, Failure,
};
use super::output::envelope_ok;
use super::output::OutputFormat;
use base64::Engine;

fn vault_required(connection: &Connection) -> Result<(), Failure> {
    // Quasi tutto vuole un vault; i comandi che non lo vogliono (theme list,
    // pairing, vault known) non chiamano questa.
    if connection.vault_selector().is_some() || connection.host.has_current_vault() {
        return Ok(());
    }
    Err(Failure::new(
        2,
        "bad_args",
        "nessun vault: --vault PATH o FUB_VAULT",
    ))
}

fn dry_run(global: &GlobalArgs) -> bool {
    global.dry_run
}

fn confirm_write(global: &GlobalArgs, prompt: &str) -> Result<(), Failure> {
    if global.no_input {
        return Err(Failure::new(
            4,
            "denied",
            format!("{prompt}: rifiutato (--no-input)"),
        ));
    }
    if global.yes {
        return Ok(());
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        return Err(Failure::new(
            4,
            "denied",
            format!("{prompt}: serve --yes su stdin non interattivo"),
        ));
    }
    eprint!("{prompt} [y/N] ");
    use std::io::BufRead;
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| Failure::new(1, "local", format!("stdin: {e}")))?;
    if line.trim().eq_ignore_ascii_case("y") || line.trim().eq_ignore_ascii_case("yes") {
        Ok(())
    } else {
        Err(Failure::new(4, "denied", "rifiutato dall'utente"))
    }
}

fn outcome_json(outcome: &fub_abi::CommandOutcome) -> serde_json::Value {
    serde_json::to_value(outcome).unwrap_or(serde_json::Value::Null)
}

pub fn vault(
    connection: &mut Connection,
    _global: &GlobalArgs,
    _format: &OutputFormat,
    action: VaultAction,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    match action {
        VaultAction::Open { path } => {
            let path = path
                .or_else(|| {
                    std::env::var("FUB_VAULT")
                        .ok()
                        .filter(|s| !s.trim().is_empty())
                })
                .or_else(|| connection.host.last_vault())
                .ok_or_else(|| {
                    Failure::new(2, "bad_args", "vault open vuole un path (o FUB_VAULT)")
                })?;
            connection.open_vault(&path)?;
            let info = connection
                .host
                .open(camino::Utf8Path::new(&path))
                .map_err(|error| Failure::from_plugin(&error))?;
            print(&envelope_ok(
                serde_json::json!({ "root": info.root, "extensions": info.extensions, "unread": info.unread.len() }),
            ));
            Ok(())
        }
        VaultAction::List => {
            let roots = connection.host.vaults();
            let items: Vec<serde_json::Value> = roots
                .into_iter()
                .map(|r| serde_json::json!({ "root": r.to_string() }))
                .collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "total": items_len(&items) }),
            ));
            Ok(())
        }
        VaultAction::Current => match connection.host.current() {
            Some(root) => {
                print(&envelope_ok(
                    serde_json::json!({ "root": root.to_string() }),
                ));
                Ok(())
            }
            None => Err(Failure::new(1, "not_found", "nessun vault corrente")),
        },
        VaultAction::Use { path } => {
            connection.open_vault(&path)?;
            print(&envelope_ok(serde_json::json!({ "current": path })));
            Ok(())
        }
        VaultAction::Close { path } => {
            let errors = connection
                .host
                .close_vault(camino::Utf8Path::new(&path))
                .map_err(|error| Failure::from_plugin(&error))?;
            let items: Vec<String> = errors.into_iter().map(|e| render_error_text(&e)).collect();
            print(&envelope_ok(
                serde_json::json!({ "closed": path, "errors": items }),
            ));
            Ok(())
        }
        VaultAction::Known => {
            let entries = connection.host.known_vaults();
            let items: Vec<serde_json::Value> = entries.into_iter().map(|e| serde_json::json!({ "root": e.root, "name": e.name, "favorite": e.favorite, "last_opened": e.last_opened })).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "total": items_len(&items) }),
            ));
            Ok(())
        }
    }
}

fn items_len(items: &[serde_json::Value]) -> usize {
    items.len()
}

pub fn read(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: ReadArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    let (source, revision) = connection
        .host
        .read_document(connection.vault_selector(), &id)
        .map_err(|error| Failure::from_plugin(&error))?;
    if args.model {
        let model = connection
            .host
            .read_model(connection.vault_selector(), &id)
            .map_err(|error| Failure::from_plugin(&error))?;
        let value = serde_json::to_value(&model).unwrap_or(serde_json::Value::Null);
        print(&envelope_ok(
            serde_json::json!({ "doc": id.as_str(), "revision": revision.as_str(), "source": source, "model": value }),
        ));
        return Ok(());
    }
    if args.revision || global.verbose {
        print(&envelope_ok(
            serde_json::json!({ "doc": id.as_str(), "revision": revision.as_str(), "source": source }),
        ));
    } else {
        print(&envelope_ok(
            serde_json::json!({ "doc": id.as_str(), "source": source }),
        ));
    }
    Ok(())
}

fn resolve_source(
    args_stdin: bool,
    text: Option<String>,
    file: Option<String>,
) -> Result<String, Failure> {
    let mut count = 0;
    if args_stdin {
        count += 1;
    }
    if text.is_some() {
        count += 1;
    }
    if file.is_some() {
        count += 1;
    }
    if count > 1 {
        return Err(Failure::bad_args("--stdin/--text/--file: uno solo"));
    }
    if let Some(text) = text {
        return Ok(text);
    }
    if let Some(path) = file {
        return read_file_text(&path);
    }
    if args_stdin || !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        return read_stdin_text();
    }
    Err(Failure::bad_args("sorgente assente: --text/--file/--stdin"))
}

pub fn write(
    connection: &mut Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: WriteArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    let source = resolve_source(args.stdin, args.text, args.file)?;
    // La scrittura diretta usa la guardia CAS: base letta, o force detta.
    let base = if let Some(base) = args.base.as_deref() {
        fub_abi::WriteBase::DescendsFrom(fub_abi::Revision::new(base))
    } else if args.force {
        fub_abi::WriteBase::Dictated
    } else {
        // Senza base si legge la revisione corrente: un secondo writer nel
        // frattempo = Conflict, mai lost update silenziosa.
        match connection
            .host
            .read_document(connection.vault_selector(), &id)
        {
            Ok((_, revision)) => fub_abi::WriteBase::DescendsFrom(revision),
            Err(fub_abi::PluginError::NotFound(_)) => fub_abi::WriteBase::Dictated,
            Err(e) => return Err(Failure::from_plugin(&e)),
        }
    };
    if dry_run(global) {
        print(&envelope_ok(
            serde_json::json!({ "doc": id.as_str(), "would_write_bytes": source.len(), "dry_run": true }),
        ));
        return Ok(());
    }
    confirm_write(global, &format!("scrivere `{}`", args.doc))?;
    let revision = connection
        .host
        .write_document(connection.vault_selector(), &id, &source, base)
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(
        serde_json::json!({ "doc": id.as_str(), "revision": revision.as_str() }),
    ));
    Ok(())
}

pub fn create(
    connection: &mut Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: CreateArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let source = if args.text.is_some()
        || args.file.is_some()
        || args.stdin
        || !std::io::IsTerminal::is_terminal(&std::io::stdin())
    {
        resolve_source(args.stdin, args.text, args.file)?
    } else {
        String::new()
    };
    // Template: riuso del comando di registro, mai copia della logica.
    if let Some(template) = args.template.as_deref() {
        let title = args
            .title
            .clone()
            .or_else(|| args.name.clone())
            .unwrap_or_default();
        let invoke_args = if title.is_empty() {
            serde_json::json!({ "template": template })
        } else {
            serde_json::json!({ "template": template, "name": title })
        };
        let mode = if dry_run(global) {
            fub_abi::InvokeMode::DryRun
        } else {
            fub_abi::InvokeMode::Apply
        };
        if mode == fub_abi::InvokeMode::Apply {
            confirm_write(global, "creare da template")?;
        }
        let outcome = connection
            .host
            .invoke_user_command(
                connection.vault_selector(),
                "note.from_template",
                invoke_args,
                mode,
            )
            .map_err(|error| Failure::from_plugin(&error))?;
        print(&envelope_ok(
            serde_json::json!({ "outcome": outcome_json(&outcome), "dry_run": dry_run(global) }),
        ));
        return Ok(());
    }
    // Creazione = comando di registro (note.create): nome, estensione e
    // AlreadyExists se occupato sono suoi, e senza un nome lo sceglie lui.
    let create_args = match args.name.as_deref().map(doc_id).transpose()? {
        Some(name) => serde_json::json!({ "name": name.as_str() }),
        None => serde_json::json!({}),
    };
    let create = |mode| {
        connection
            .host
            .invoke_user_command(
                connection.vault_selector(),
                "note.create",
                create_args.clone(),
                mode,
            )
            .map_err(|error| Failure::from_plugin(&error))
    };
    let planned = match create(fub_abi::InvokeMode::DryRun)?.effect {
        fub_abi::CommandEffect::Plan(plan) => plan.docs.into_iter().next(),
        _ => None,
    }
    .ok_or_else(|| Failure::local("note.create non ha nominato la nota"))?;
    if dry_run(global) {
        print(&envelope_ok(
            serde_json::json!({ "doc": planned.as_str(), "dry_run": true }),
        ));
        return Ok(());
    }
    confirm_write(global, &format!("creare `{}`", planned.as_str()))?;
    let outcome = create(fub_abi::InvokeMode::Apply)?;
    let id = match &outcome.effect {
        fub_abi::CommandEffect::Navigate { doc } => doc.clone(),
        _ => return Err(Failure::local("note.create non ha nominato la nota")),
    };
    // Corpo iniziale: scrittura CAS sulla revisione appena creata, nel
    // documento che il comando ha creato e non nel nome chiesto.
    if !source.is_empty() {
        let written = connection
            .host
            .read_document(connection.vault_selector(), &id)
            .and_then(|(_, revision)| {
                connection.host.write_document(
                    connection.vault_selector(),
                    &id,
                    &source,
                    fub_abi::WriteBase::DescendsFrom(revision),
                )
            });
        if let Err(error) = written {
            // Una nota vuota al posto del testo non è ciò che si è chiesto:
            // torna nel cestino, e l'errore da dire resta questo.
            let _ = connection.host.invoke_user_command(
                connection.vault_selector(),
                "note.trash",
                serde_json::json!({ "doc": id.as_str() }),
                fub_abi::InvokeMode::Apply,
            );
            return Err(Failure::from_plugin(&error));
        }
    }
    print(&envelope_ok(
        serde_json::json!({ "doc": id.as_str(), "outcome": outcome_json(&outcome) }),
    ));
    Ok(())
}

pub fn edit(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: EditArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let parsed = parse_json_object(&args.args_json)?;
    let mode = if dry_run(global) {
        fub_abi::InvokeMode::DryRun
    } else {
        fub_abi::InvokeMode::Apply
    };
    if mode == fub_abi::InvokeMode::Apply {
        confirm_write(global, &format!("invocare `{}`", args.command))?;
    }
    let outcome = connection
        .host
        .invoke_user_command(connection.vault_selector(), &args.command, parsed, mode)
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(outcome_json(&outcome)));
    Ok(())
}

pub fn files(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: FilesArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    if let Some(kind) = args.kind.as_deref() {
        match kind.trim().to_ascii_lowercase().as_str() {
            "doc" | "document" | "asset" | "unknown" => {}
            _ => return Err(Failure::bad_args("--kind vuole doc|asset|unknown")),
        }
    }
    let of_kind = match args.kind.as_deref().map(|s| s.trim().to_ascii_lowercase()) {
        Some(k) if k == "doc" || k == "document" => Some(fub_abi::EntryKind::Document),
        Some(k) if k == "asset" => Some(fub_abi::EntryKind::Asset),
        Some(k) if k == "unknown" => Some(fub_abi::EntryKind::Unknown),
        _ => None,
    };
    let within = args.folder.as_deref().map(|folder| fub_abi::FolderScope {
        path: folder.trim().trim_matches('/').to_string(),
        descendants: args.recursive,
    });
    // Paginazione a finestre: si chiede per pagine finché basta.
    let offset = global.offset.unwrap_or(0);
    let limit = global.limit;
    let page = limit.map(|n| fub_abi::Page::new(offset, n));
    let query = fub_abi::IndexQuery::Entries {
        of_kind,
        within,
        page,
    };
    match connection
        .host
        .query_index(connection.vault_selector(), query)
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Entries(paged) => {
            let items: Vec<serde_json::Value> = paged.items.into_iter().map(|e| serde_json::json!({ "id": e.id.as_str(), "kind": e.kind, "size": e.size, "mtime": e.mtime })).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }),
            ));
            Ok(())
        }
        other => Err(Failure::local(format!(
            "entries ha risposto {}",
            other.kind_name()
        ))),
    }
}

fn build_matching(args: &QueryArgs) -> Result<fub_abi::QueryExpr, Failure> {
    use fub_abi::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate};
    if let Some(raw) = args.query_json.as_deref() {
        let value: serde_json::Value = serde_json::from_str(raw)
            .map_err(|e| Failure::bad_args(format!("query JSON non valida: {e}")))?;
        if value.get("any").is_some() || value.get("kind").is_some() {
            // Forma IndexQuery intera o QueryExpr: si accetta l'espressione.
            if value.get("any").is_some() {
                let expr: QueryExpr = serde_json::from_value(value)
                    .map_err(|e| Failure::bad_args(format!("QueryExpr non valida: {e}")))?;
                return Ok(expr);
            }
        }
        return Err(Failure::bad_args(
            "query JSON: passare una QueryExpr {any:[…]} o usare i flag",
        ));
    }
    let mut literals: Vec<QueryLiteral> = Vec::new();
    // `--text` è la riga della barra di ricerca: stessa sintassi, e le
    // alternative che produce ricevono ciascuna gli altri filtri.
    let mut clauses: Vec<QueryClause> = Vec::new();
    if let Some(text) = args.text.as_deref() {
        if text.trim().is_empty() {
            return Err(Failure::bad_args("--text vuota"));
        }
        clauses = fub_abi::rules::search_syntax::parse(text, false)
            .map_err(|fault| {
                Failure::bad_args(format!(
                    "sintassi di ricerca: {} al byte {}",
                    fault.kind.label(),
                    fault.at
                ))
            })?
            .any;
    }
    if let Some(tag) = args.tag.as_deref() {
        if tag.trim().is_empty() {
            return Err(Failure::bad_args("--tag vuoto"));
        }
        literals.push(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Tag {
                name: tag.trim().trim_start_matches('#').to_string(),
                descendants: true,
            },
        });
    }
    if let Some(folder) = args.folder.as_deref() {
        literals.push(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Folder {
                path: folder.trim().trim_matches('/').to_string(),
                descendants: true,
            },
        });
    }
    for prop in &args.property {
        literals.push(QueryLiteral {
            negated: false,
            predicate: parse_property_flag(prop)?,
        });
    }
    if clauses.is_empty() {
        if literals.is_empty() {
            return Ok(QueryExpr::all());
        }
        clauses.push(QueryClause { all: Vec::new() });
    }
    for clause in &mut clauses {
        clause.all.extend(literals.iter().cloned());
    }
    Ok(QueryExpr { any: clauses })
}
fn match_json(item: &fub_abi::DocumentMatch) -> serde_json::Value {
    serde_json::json!({
        "doc": item.doc.as_str(),
        "score": item.score,
        "snippet": item.snippet,
        "highlights": item.highlights,
        "properties": item.properties,
        "occurrences": item.occurrences,
    })
}

fn parse_scalar(raw: &str) -> fub_abi::PropertyValue {
    let value = raw.trim();
    match value {
        "true" => fub_abi::PropertyValue::Bool(true),
        "false" => fub_abi::PropertyValue::Bool(false),
        _ => value
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite())
            .map(fub_abi::PropertyValue::Number)
            .unwrap_or_else(|| fub_abi::PropertyValue::Text(value.to_string())),
    }
}

fn parse_property_flag(raw: &str) -> Result<fub_abi::QueryPredicate, Failure> {
    // chiave=valore | chiave~=sottostringa | chiave!=valore | chiave?=exists-ish | chiave!=exists
    if let Some((key, value)) = raw.split_once("~=") {
        if key.trim().is_empty() {
            return Err(Failure::bad_args("--property con chiave vuota"));
        }
        return Ok(fub_abi::QueryPredicate::Property {
            filter: fub_abi::PropertyFilter {
                key: key.trim().to_string(),
                test: fub_abi::PropertyTest::Contains(fub_abi::PropertyScalar::Text(
                    value.to_string(),
                )),
            },
        });
    }
    if let Some((key, value)) = raw.split_once("!=") {
        if key.trim().is_empty() {
            return Err(Failure::bad_args("--property con chiave vuota"));
        }
        if value.trim().eq_ignore_ascii_case("exists") || value.trim().is_empty() {
            return Ok(fub_abi::QueryPredicate::Property {
                filter: fub_abi::PropertyFilter {
                    key: key.trim().to_string(),
                    test: fub_abi::PropertyTest::Missing,
                },
            });
        }
        return Ok(fub_abi::QueryPredicate::Property {
            filter: fub_abi::PropertyFilter {
                key: key.trim().to_string(),
                test: fub_abi::PropertyTest::NotEquals(parse_scalar(value)),
            },
        });
    }
    if let Some((key, value)) = raw.split_once('=') {
        if key.trim().is_empty() {
            return Err(Failure::bad_args("--property con chiave vuota"));
        }
        if value.trim().eq_ignore_ascii_case("exists") {
            return Ok(fub_abi::QueryPredicate::Property {
                filter: fub_abi::PropertyFilter {
                    key: key.trim().to_string(),
                    test: fub_abi::PropertyTest::Exists,
                },
            });
        }
        return Ok(fub_abi::QueryPredicate::Property {
            filter: fub_abi::PropertyFilter {
                key: key.trim().to_string(),
                test: fub_abi::PropertyTest::Equals(parse_scalar(value)),
            },
        });
    }
    Err(Failure::bad_args(
        "--property vuole chiave=valore, chiave~=sottostringa o chiave!=valore",
    ))
}

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
        let target = if raw.contains("://") || raw.starts_with("//") {
            fub_abi::LinkTarget::Url(raw.to_string())
        } else if raw.starts_with("[[") && raw.ends_with("]]") {
            let inner = raw.trim_start_matches('[').trim_end_matches(']').trim();
            fub_abi::model::parse_wikilink_inner(inner).target
        } else {
            fub_abi::LinkTarget::Path(raw.to_string())
        };
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
    use fub_abi::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextQuery};
    let fields = args
        .field
        .iter()
        .map(|f| match f.trim().to_ascii_lowercase().as_str() {
            "name" | "title" => Ok(fub_abi::TextField::Name),
            "body" | "text" => Ok(fub_abi::TextField::Body),
            "tags" | "tag" => Ok(fub_abi::TextField::Tags),
            "heading" | "headings" => Ok(fub_abi::TextField::Heading),
            other => Err(Failure::bad_args(format!(
                "campo `{other}` (name|body|tags|heading)"
            ))),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let text = TextQuery {
        text: args.query.clone(),
        mode: if args.phrase {
            fub_abi::TextMode::Phrase
        } else {
            fub_abi::TextMode::Terms
        },
        fields,
        tolerance: fub_abi::TextTolerance::Exact,
        partial_last_term: false,
        case_sensitive: false,
    };
    // Senza campi o frase espliciti la riga è la sintassi della barra della
    // shell (`fub_abi::rules::search_syntax`): stessi operatori, stessa
    // `QueryExpr`. Con `--field`/`--phrase` resta un testo solo, come chiesto.
    let mut clauses = if args.field.is_empty() && !args.phrase {
        fub_abi::rules::search_syntax::parse(&args.query, false)
            .map_err(|fault| {
                Failure::bad_args(format!(
                    "sintassi di ricerca: {} al byte {}",
                    fault.kind.label(),
                    fault.at
                ))
            })?
            .any
    } else {
        vec![QueryClause {
            all: vec![QueryLiteral {
                negated: false,
                predicate: QueryPredicate::Text(text),
            }],
        }]
    };
    if clauses.is_empty() {
        clauses.push(QueryClause { all: Vec::new() });
    }
    let mut literals = Vec::new();
    if let Some(tag) = args.tag.as_deref() {
        literals.push(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Tag {
                name: tag.trim().trim_start_matches('#').to_string(),
                descendants: true,
            },
        });
    }
    if let Some(folder) = args.folder.as_deref() {
        literals.push(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Folder {
                path: folder.trim().trim_matches('/').to_string(),
                descendants: true,
            },
        });
    }
    for clause in &mut clauses {
        clause.all.extend(literals.iter().cloned());
    }
    let matching = QueryExpr { any: clauses };
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

pub fn templates(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: TemplatesArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    if args.list || (args.from.is_none() && !args.daily) {
        // Elenco template: Entries sotto Templates/.
        let query = fub_abi::IndexQuery::Entries {
            of_kind: Some(fub_abi::EntryKind::Document),
            within: Some(fub_abi::FolderScope {
                path: "Templates".to_string(),
                descendants: true,
            }),
            page: global
                .limit
                .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n)),
        };
        match connection
            .host
            .query_index(connection.vault_selector(), query)
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::Entries(paged) => {
                let items: Vec<_> = paged.items.iter().map(|entry| entry.id.as_str()).collect();
                print(&envelope_ok(
                    serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }),
                ));
                return Ok(());
            }
            other => {
                return Err(Failure::local(format!(
                    "templates ha risposto {}",
                    other.kind_name()
                )))
            }
        }
    }
    let mode = if dry_run(global) {
        fub_abi::InvokeMode::DryRun
    } else {
        fub_abi::InvokeMode::Apply
    };
    if mode == fub_abi::InvokeMode::Apply {
        confirm_write(global, "creare da template")?;
    }
    if args.daily {
        let invoke_args = match args.date.as_deref() {
            Some(date) => serde_json::json!({ "date": date }),
            None => serde_json::json!({}),
        };
        let outcome = connection
            .host
            .invoke_user_command(connection.vault_selector(), "note.daily", invoke_args, mode)
            .map_err(|error| Failure::from_plugin(&error))?;
        print(&envelope_ok(outcome_json(&outcome)));
        return Ok(());
    }
    let template = args
        .from
        .clone()
        .ok_or_else(|| Failure::bad_args("templates vuole --from o --daily"))?;
    let invoke_args = match args.name.as_deref() {
        Some(name) => serde_json::json!({ "template": template, "name": name }),
        None => serde_json::json!({ "template": template }),
    };
    let outcome = connection
        .host
        .invoke_user_command(
            connection.vault_selector(),
            "note.from_template",
            invoke_args,
            mode,
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(outcome_json(&outcome)));
    Ok(())
}

pub fn views(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: ViewsArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    if args.list || args.render.is_none() {
        let specs = connection
            .host
            .views(connection.vault_selector())
            .map_err(|error| Failure::from_plugin(&error))?;
        let offset = global.offset.unwrap_or(0);
        let (page, total) = paginate(specs, offset, global.limit);
        let items: Vec<_> = page
            .iter()
            .map(|spec| {
                serde_json::json!({
                    "id": spec.id, "title": render_text_value(&spec.title),
                })
            })
            .collect();
        print(&envelope_ok(
            serde_json::json!({ "items": items, "offset": offset, "total": total }),
        ));
        return Ok(());
    }
    let view = args.render.clone().unwrap_or_default();
    let params = parse_json_object(args.params_json.as_deref().unwrap_or("null"))?;
    let params = if params.is_null() {
        serde_json::Value::Null
    } else {
        params
    };
    let instance = fub_abi::ViewInstance::new(
        view.clone(),
        args.instance.clone().unwrap_or_else(|| view.clone()),
        params,
    );
    if let Some(action) = args.action.as_deref() {
        let payload = parse_json_object(args.payload_json.as_deref().unwrap_or("null"))?;
        let payload = if payload.is_null() {
            serde_json::Value::Null
        } else {
            payload
        };
        let ui_action = fub_abi::UiAction {
            action: fub_abi::ActionId(action.to_string()),
            payload,
            fields: Vec::new(),
        };
        if dry_run(global) {
            return Err(Failure::bad_args(
                "view action non supporta --dry-run: nessuna azione eseguita",
            ));
        }
        confirm_write(global, &format!("azione `{action}` su view `{view}`"))?;
        let update = connection
            .host
            .view_action(connection.vault_selector(), &instance, ui_action)
            .map_err(|error| Failure::from_plugin(&error))?;
        print(&envelope_ok(
            serde_json::to_value(&update).unwrap_or(serde_json::Value::Null),
        ));
        return Ok(());
    }
    let node = connection
        .host
        .render_view(connection.vault_selector(), &instance)
        .map_err(|error| Failure::from_plugin(&error))?;
    // L'albero resta un solo valore, anche per formati strutturati.
    print(&envelope_ok(
        serde_json::to_value(&node).unwrap_or(serde_json::Value::Null),
    ));
    Ok(())
}

pub fn plugin(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: PluginArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    if let Some(id) = args.enable.as_deref() {
        if !dry_run(global) {
            confirm_write(global, &format!("accendere `{id}`"))?;
        } else {
            print(&envelope_ok(
                serde_json::json!({ "id": id, "enabled": true, "dry_run": true }),
            ));
            return Ok(());
        }
        let errors = connection
            .host
            .set_plugin_enabled(connection.vault_selector(), id, true)
            .map_err(|error| Failure::from_plugin(&error))?;
        let items: Vec<String> = errors.into_iter().map(|e| render_error_text(&e)).collect();
        print(&envelope_ok(
            serde_json::json!({ "id": id, "enabled": true, "errors": items }),
        ));
        return Ok(());
    }
    if let Some(id) = args.disable.as_deref() {
        if !dry_run(global) {
            confirm_write(global, &format!("spegnere `{id}`"))?;
        } else {
            print(&envelope_ok(
                serde_json::json!({ "id": id, "enabled": false, "dry_run": true }),
            ));
            return Ok(());
        }
        let errors = connection
            .host
            .set_plugin_enabled(connection.vault_selector(), id, false)
            .map_err(|error| Failure::from_plugin(&error))?;
        let items: Vec<String> = errors.into_iter().map(|e| render_error_text(&e)).collect();
        print(&envelope_ok(
            serde_json::json!({ "id": id, "enabled": false, "errors": items }),
        ));
        return Ok(());
    }
    // list (default): bundles = chi è montato e chi è acceso.
    let bundles = connection
        .host
        .bundles(connection.vault_selector())
        .map_err(|error| Failure::from_plugin(&error))?;
    let offset = global.offset.unwrap_or(0);
    let (page, total) = paginate(bundles, offset, global.limit);
    let items: Vec<serde_json::Value> = page.into_iter().map(|b| serde_json::json!({ "id": b.id, "name": b.name, "mounted": b.mounted, "kind": b.kind })).collect();
    print(&envelope_ok(
        serde_json::json!({ "items": items, "offset": offset, "total": total }),
    ));
    Ok(())
}

pub fn theme(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: ThemeArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    if args.list || args.show.is_none() {
        let themes = connection
            .host
            .themes()
            .map_err(|error| Failure::from_plugin(&error))?;
        let offset = global.offset.unwrap_or(0);
        let (page, total) = paginate(themes, offset, global.limit);
        let items: Vec<serde_json::Value> = page.into_iter().map(|t| serde_json::json!({ "id": t.manifest.id, "name": t.manifest.name, "lights": t.manifest.lights })).collect();
        print(&envelope_ok(
            serde_json::json!({ "items": items, "offset": offset, "total": total }),
        ));
        return Ok(());
    }
    let id = args.show.clone().unwrap_or_default();
    let light = match args.light.as_deref().map(|s| s.trim().to_ascii_lowercase()) {
        Some(s) if s == "dark" => fub_abi::ThemeLight::Dark,
        Some(s) if s == "light" => fub_abi::ThemeLight::Light,
        Some(other) => {
            return Err(Failure::bad_args(format!(
                "--light vuole dark|light, non `{other}`"
            )))
        }
        None => fub_abi::ThemeLight::Dark,
    };
    let payload = connection
        .host
        .read_theme(&id, light)
        .map_err(|error| Failure::from_plugin(&error))?;
    print(&envelope_ok(
        serde_json::json!({ "id": payload.manifest.id, "light": light, "sheet": payload.sheet, "skin": payload.skin, "assets": payload.assets }),
    ));
    Ok(())
}

pub fn diagnostics(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: DiagnosticsArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    let mut report = serde_json::Map::new();
    if args.status {
        let status = match connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::VaultStatus,
            )
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::VaultStatus(status) => {
                serde_json::json!({ "watching": status.watching, "indexing": status.indexing })
            }
            other => serde_json::json!({ "unexpected": other.kind_name() }),
        };
        report.insert("status".to_string(), status);
    }
    if args.startup {
        if vault_required(connection).is_ok() {
            let items = connection
                .host
                .startup_diagnostics(connection.vault_selector())
                .map_err(|error| Failure::from_plugin(&error))?;
            report.insert(
                "startup".to_string(),
                serde_json::json!(items
                    .into_iter()
                    .map(|e| render_error_text(&e))
                    .collect::<Vec<_>>()),
            );
        } else {
            report.insert("startup".to_string(), serde_json::json!("nessun vault"));
        }
    }
    if args.session {
        let notice = connection.host.session_notice();
        report.insert(
            "session".to_string(),
            match notice {
                Some(n) => serde_json::to_value(&n).unwrap_or(serde_json::Value::Null),
                None => serde_json::Value::Null,
            },
        );
    }
    if args.jobs {
        if vault_required(connection).is_ok() {
            match connection
                .host
                .query_index(connection.vault_selector(), fub_abi::IndexQuery::Jobs)
                .map_err(|error| Failure::from_plugin(&error))?
            {
                fub_abi::IndexResult::Jobs(jobs) => {
                    report.insert("jobs".to_string(), serde_json::json!(jobs.into_iter().map(|j| serde_json::json!({ "id": j.id.0.to_string(), "job": j.job, "plugin": j.plugin })).collect::<Vec<_>>()));
                }
                other => {
                    report.insert(
                        "jobs".to_string(),
                        serde_json::json!({ "unexpected": other.kind_name() }),
                    );
                }
            }
        } else {
            report.insert("jobs".to_string(), serde_json::json!("nessun vault"));
        }
    }
    if let Some(check) = args.health.as_deref() {
        vault_required(connection)?;
        let check = match check.trim().to_ascii_lowercase().as_str() {
            "broken-links" | "broken" => fub_abi::HealthCheck::BrokenLinks,
            "orphans" | "orphan" => fub_abi::HealthCheck::OrphanDocuments,
            "colliding" | "collisions" => fub_abi::HealthCheck::CollidingPaths,
            "dates" => fub_abi::HealthCheck::UnrecognizedDates,
            other => {
                return Err(Failure::bad_args(format!(
                    "--health `{other}` (broken-links|orphans|colliding|dates)"
                )))
            }
        };
        let page = global
            .limit
            .map(|n| fub_abi::Page::new(global.offset.unwrap_or(0), n));
        match connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::VaultHealth { check, page },
            )
            .map_err(|error| Failure::from_plugin(&error))?
        {
            fub_abi::IndexResult::VaultHealth(paged) => {
                let items: Vec<serde_json::Value> = paged.items.into_iter().map(|issue| serde_json::json!({ "doc": issue.doc.as_str(), "detail": issue.detail })).collect();
                report.insert("health".to_string(), serde_json::json!({ "items": items, "offset": paged.offset, "total": paged.total }));
            }
            other => {
                report.insert(
                    "health".to_string(),
                    serde_json::json!({ "unexpected": other.kind_name() }),
                );
            }
        }
    }
    print(&envelope_ok(serde_json::Value::Object(report)));
    Ok(())
}

pub fn native_install(
    _global: &GlobalArgs,
    _format: &OutputFormat,
    extension_id: String,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    use fub_host::automation::validate_envelope;
    use fub_host::automation::{CaptureEnvelope, CLIPPER_ORIGIN};
    // Valida l'id con le stesse regole del filo NM.
    validate_envelope(&CaptureEnvelope {
        nonce: "install-probe".to_string(),
        origin: CLIPPER_ORIGIN.to_string(),
        extension_id: Some(extension_id.clone()),
        timestamp_ms: None,
    })
    .map_err(|error| Failure::from_automation(&error))?;
    let exe = std::env::current_exe().map_err(|e| Failure::local(format!("eseguibile: {e}")))?;
    let clipper_host = exe.with_file_name("fub-clipper-host");
    #[cfg(windows)]
    let clipper_host = clipper_host.with_extension("exe");
    let manifest = serde_json::json!({
        "name": fub_host::automation::NM_HOST_NAME,
        "description": "Fub clipper native host (stdio, solo capture v1)",
        "path": clipper_host.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")],
    });
    let firefox = serde_json::json!({
        "name": fub_host::automation::NM_HOST_NAME,
        "description": "Fub clipper native host (stdio, solo capture v1)",
        "path": clipper_host.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [extension_id.clone()],
    });
    // Stampa i manifest: chi installa li scrive nei posti del browser
    // (o usa --yes per scriverli da qui, vedi sotto).
    print(&envelope_ok(serde_json::json!({
        "extension_id": extension_id,
        "host": fub_host::automation::NM_HOST_NAME,
        "binary": clipper_host.to_string_lossy(),
        "chromium": manifest,
        "firefox": firefox,
    })));
    Ok(())
}

pub fn config_path(global: &GlobalArgs, name: &str) -> Result<std::path::PathBuf, Failure> {
    if let Some(dir) = global
        .config_dir
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        return Ok(std::path::PathBuf::from(dir).join(name));
    }
    if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Ok(std::path::PathBuf::from(dir).join(name));
        }
    }
    if let Some(dir) = fub_host::config_dir() {
        return Ok(std::path::PathBuf::from(dir.as_str()).join(name));
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Ok(std::path::PathBuf::from(home)
                .join(".config")
                .join("fub")
                .join(name));
        }
    }
    Err(Failure::local("nessuna config dir"))
}

pub fn load_pairs(global: &GlobalArgs) -> Result<Vec<fub_host::automation::PairEntry>, Failure> {
    let path = config_path(global, "clipper-pairing.json")?;
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "{\"pairs\":[]}".to_string());
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| Failure::local(format!("pairing illeggibile: {e}")))?;
    let pairs = value
        .get("pairs")
        .cloned()
        .unwrap_or(serde_json::Value::Array(Vec::new()));
    serde_json::from_value(pairs).map_err(|e| Failure::local(format!("pairing non valido: {e}")))
}

pub fn save_owner_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), Failure> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| Failure::bad_args("file senza directory"))?;
    std::fs::create_dir_all(parent).map_err(|e| Failure::local(format!("config dir: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(Failure::new(4, "denied", "secret file è symlink"));
        }
        let meta =
            std::fs::metadata(parent).map_err(|e| Failure::local(format!("config dir: {e}")))?;
        if meta.permissions().mode() & 0o077 != 0 {
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| Failure::local(format!("config dir permessi: {e}")))?;
        }
    }
    use ring::rand::SecureRandom;
    let mut suffix = [0u8; 12];
    ring::rand::SystemRandom::new()
        .fill(&mut suffix)
        .map_err(|_| Failure::local("random non disponibile"))?;
    let suffix = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(suffix);
    let tmp = path.with_extension(format!("tmp-{suffix}"));
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
    };
    #[cfg(not(unix))]
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp);
    let mut file = file.map_err(|e| Failure::local(format!("secret file: {e}")))?;
    let written = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        // Su Windows una cartella non si apre come file: la rename resta
        // quella ordinaria (decisione 0202).
        #[cfg(not(windows))]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written.map_err(|e| Failure::local(format!("secret file: {e}")))
}

fn save_pairs(
    global: &GlobalArgs,
    pairs: &[fub_host::automation::PairEntry],
) -> Result<(), Failure> {
    let path = config_path(global, "clipper-pairing.json")?;
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({ "pairs": pairs }))
        .map_err(|e| Failure::local(format!("pairing: {e}")))?;
    save_owner_file(&path, &bytes)
}

pub fn pairing(
    global: &GlobalArgs,
    _format: &OutputFormat,
    action: PairAction,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    match action {
        PairAction::Add {
            extension_id,
            vault,
            folder,
        } => {
            use fub_host::automation::{
                CaptureEnvelope, CaptureMode, CapturePayloadV1, CaptureTarget, CLIPPER_ORIGIN,
            };
            fub_host::automation::validate_envelope(&CaptureEnvelope {
                nonce: "pair-check".to_string(),
                origin: CLIPPER_ORIGIN.to_string(),
                extension_id: Some(extension_id.clone()),
                timestamp_ms: None,
            })
            .map_err(|e| Failure::from_automation(&e))?;
            if folder
                .as_deref()
                .is_some_and(|f| f.starts_with('/') || f.starts_with('\\'))
            {
                return Err(Failure::bad_args("cartella pairing relativa"));
            }
            fub_host::automation::validate_capture_v1(&CapturePayloadV1 {
                v: 1,
                title: "pair-check".to_string(),
                markdown: "pair-check".to_string(),
                source_url: None,
                properties: None,
                target: CaptureTarget {
                    vault: vault.clone(),
                    folder: folder.clone(),
                    note: None,
                    mode: CaptureMode::Create,
                },
            })
            .map_err(|e| Failure::from_automation(&e))?;
            let mut pairs = load_pairs(global)?;
            pairs.retain(|p| {
                !(p.extension_id == extension_id && p.vault == vault && p.folder == folder)
            });
            pairs.push(fub_host::automation::PairEntry {
                extension_id: extension_id.clone(),
                vault: vault.clone(),
                folder: folder.clone(),
            });
            save_pairs(global, &pairs)?;
            print(&envelope_ok(
                serde_json::json!({ "paired": extension_id, "vault": vault, "folder": folder }),
            ));
            Ok(())
        }
        PairAction::List => {
            let pairs = load_pairs(global)?;
            let items: Vec<serde_json::Value> =
                pairs.into_iter().map(|p| serde_json::json!(p)).collect();
            print(&envelope_ok(
                serde_json::json!({ "items": items, "total": items_len(&items) }),
            ));
            Ok(())
        }
        PairAction::Remove { extension_id } => {
            let mut pairs = load_pairs(global)?;
            let before = pairs.len();
            pairs.retain(|p| p.extension_id != extension_id);
            save_pairs(global, &pairs)?;
            print(&envelope_ok(
                serde_json::json!({ "unpaired": extension_id, "removed": before - pairs.len() }),
            ));
            Ok(())
        }
    }
}
