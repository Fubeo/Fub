//! Tutti i comandi locali sopra Host: vault/read/write/create/append/prepend,
//! files/query/search/commands/properties/tasks/templates/views/plugin/theme/
//! diagnostics/capture/uri/pairing. I remoti stanno in `remote.rs` (client reali).

use super::cli::*;
use super::commands::{paginate, render_error_text, Connection, Failure};
use super::output::envelope_ok;
use super::output::OutputFormat;

mod documents;
mod notes;
mod pairing;
mod plugins;
mod query;

pub use documents::{create, edit, read, vault, write};
pub use notes::{bookmarks, daily, outline, random, templates, views, wordcount};
pub use pairing::{config_path, pairing, save_owner_file};
pub use plugins::{native_install, plugin};
pub(crate) use query::link_target;
pub use query::{properties, query, registry_command, search, tasks};

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

pub(crate) fn confirm_write(global: &GlobalArgs, prompt: &str) -> Result<(), Failure> {
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

pub(crate) fn outcome_json(outcome: &fub_abi::CommandOutcome) -> serde_json::Value {
    serde_json::to_value(outcome).unwrap_or(serde_json::Value::Null)
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
pub(crate) fn match_json(item: &fub_abi::DocumentMatch) -> serde_json::Value {
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

/// La `QueryExpr` di una ricerca: la riga con la sintassi della barra, o un
/// testo solo con `fields`/`phrase`, più tag e cartella in AND. La usano
/// `search` e lo strumento `fub_search` dell'MCP.
pub(crate) fn search_expr(
    query: &str,
    field_names: &[String],
    phrase: bool,
    tag: Option<&str>,
    folder: Option<&str>,
) -> Result<fub_abi::QueryExpr, Failure> {
    use fub_abi::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextQuery};
    let fields = field_names
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
        text: query.to_string(),
        mode: if phrase {
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
    let mut clauses = if field_names.is_empty() && !phrase {
        fub_abi::rules::search_syntax::parse(query, false)
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
    if let Some(tag) = tag {
        literals.push(QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Tag {
                name: tag.trim().trim_start_matches('#').to_string(),
                descendants: true,
            },
        });
    }
    if let Some(folder) = folder {
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
    Ok(QueryExpr { any: clauses })
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
            "dead-ends" | "deadends" => fub_abi::HealthCheck::DeadEnds,
            "unused-attachments" | "unused" => fub_abi::HealthCheck::UnusedAttachments,
            other => {
                return Err(Failure::bad_args(format!(
                    "--health `{other}` \
                     (broken-links|orphans|colliding|dates|dead-ends|unused-attachments)"
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

#[cfg(test)]
mod tests;
