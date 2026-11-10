//! I comandi locali di scrittura e lettura delle note: `templates`, `daily`,
//! `outline`, `wordcount`, `bookmarks`, `random` e `views`.

use crate::cli::{DailyAction, DailyArgs, DocArgs, GlobalArgs, TemplatesArgs, ViewsArgs};
use crate::commands::{
    doc_id, paginate, parse_json_object, render_text_value, Connection, Failure,
};
use crate::output::envelope_ok;
use crate::output::OutputFormat;

use super::{confirm_write, dry_run, outcome_json, vault_required};

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

/// `daily`: la giornaliera di un giorno. Il nome lo decide `note.daily` in
/// prova, con le sue regole di cartella, formato e data: la CLI non ne scrive
/// una seconda copia.
pub fn daily(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: DailyArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let invoke_args = match args.date.as_deref() {
        Some(date) => serde_json::json!({ "date": date }),
        None => serde_json::json!({}),
    };
    let note_daily = |mode| {
        connection
            .host
            .invoke_user_command(
                connection.vault_selector(),
                "note.daily",
                invoke_args.clone(),
                mode,
            )
            .map_err(|error| Failure::from_plugin(&error))
    };
    let planned = match note_daily(fub_abi::InvokeMode::DryRun)?.effect {
        fub_abi::CommandEffect::Plan(plan) => plan.docs.into_iter().next(),
        _ => None,
    }
    .ok_or_else(|| Failure::local("note.daily non ha nominato la giornaliera"))?;
    let exists = match connection
        .host
        .read_document(connection.vault_selector(), &planned)
    {
        Ok(_) => true,
        Err(fub_abi::PluginError::NotFound(_)) => false,
        Err(error) => return Err(Failure::from_plugin(&error)),
    };
    let (text, prepend) = match args.action {
        DailyAction::Path => {
            print(&envelope_ok(
                serde_json::json!({ "doc": planned.as_str(), "exists": exists }),
            ));
            return Ok(());
        }
        DailyAction::Read => {
            let (source, revision) = connection
                .host
                .read_document(connection.vault_selector(), &planned)
                .map_err(|error| Failure::from_plugin(&error))?;
            print(&envelope_ok(serde_json::json!({
                "doc": planned.as_str(), "revision": revision.as_str(), "source": source,
            })));
            return Ok(());
        }
        DailyAction::Append(text) => (text, false),
        DailyAction::Prepend(text) => (text, true),
    };
    if dry_run(global) {
        print(&envelope_ok(serde_json::json!({
            "doc": planned.as_str(), "would_create": !exists,
            "would_write_bytes": text.len(), "dry_run": true,
        })));
        return Ok(());
    }
    confirm_write(
        global,
        &format!("scrivere nella giornaliera `{}`", planned.as_str()),
    )?;
    // Se manca la crea `note.daily`, con il suo template: la riga va nella
    // nota che il comando ha creato, non nel nome previsto.
    let doc = if exists {
        planned
    } else {
        match note_daily(fub_abi::InvokeMode::Apply)?.effect {
            fub_abi::CommandEffect::Navigate { doc } => doc,
            _ => return Err(Failure::local("note.daily non ha nominato la giornaliera")),
        }
    };
    match write_line(connection, &doc, &text, prepend) {
        Ok(revision) => {
            print(&envelope_ok(serde_json::json!({
                "doc": doc.as_str(), "revision": revision.as_str(), "created": !exists,
            })));
            Ok(())
        }
        Err(error) => {
            if !exists {
                // Una giornaliera nata qui e rimasta senza la riga torna nel
                // cestino: un nuovo tentativo ritrova il vault di prima.
                let _ = connection.host.invoke_user_command(
                    connection.vault_selector(),
                    "note.trash",
                    serde_json::json!({ "doc": doc.as_str() }),
                    fub_abi::InvokeMode::Apply,
                );
            }
            Err(Failure::from_plugin(&error))
        }
    }
}

/// Una riga in fondo al documento, o in testa al corpo (dopo il frontmatter,
/// dove lo dice il modello), con i terminatori di riga del documento. Una
/// scrittura sola, che discende dalla lettura: un'altra scrittura nel
/// frattempo è un conflitto, mai una riga persa.
fn write_line(
    connection: &Connection,
    doc: &fub_abi::DocId,
    text: &str,
    prepend: bool,
) -> Result<fub_abi::Revision, fub_abi::PluginError> {
    let vault = connection.vault_selector();
    let (source, revision) = connection.host.read_document(vault, doc)?;
    let eol = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let line = text.trim_end_matches(['\r', '\n']).replace("\r\n", "\n");
    let line = match eol {
        "\n" => line,
        eol => line.replace('\n', eol),
    };
    let updated = if prepend {
        let model = connection.host.read_model(vault, doc)?;
        let (_, again) = connection.host.read_document(vault, doc)?;
        if again != revision {
            return Err(fub_abi::PluginError::Conflict(
                format!("`{doc}` è cambiato mentre lo si leggeva").into(),
            ));
        }
        let at = model
            .body_start(&source)
            .map_err(|span| {
                fub_abi::PluginError::Internal(
                    format!(
                        "`{doc}`: il blocco in {}..{} è fuori dal sorgente",
                        span.start, span.end
                    )
                    .into(),
                )
            })?
            .unwrap_or(fub_abi::rules::text_policy::bom_len(&source));
        let (before, after) = source.split_at(at);
        format!("{before}{line}{eol}{after}")
    } else {
        let mut updated = source.clone();
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push_str(eol);
        }
        updated.push_str(&line);
        updated.push_str(eol);
        updated
    };
    connection.host.write_document(
        vault,
        doc,
        &updated,
        fub_abi::WriteBase::DescendsFrom(revision),
    )
}

/// `outline`: gli heading del documento come li ha letti il suo formato.
pub fn outline(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: DocArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    let model = connection
        .host
        .read_model(connection.vault_selector(), &id)
        .map_err(|error| Failure::from_plugin(&error))?;
    let rows: Vec<serde_json::Value> = model
        .outline
        .iter()
        .map(|heading| {
            serde_json::json!({
                "level": heading.level, "text": heading.text, "slug": heading.slug,
                "start": heading.span.start, "end": heading.span.end,
            })
        })
        .collect();
    let offset = global.offset.unwrap_or(0);
    let (page, total) = paginate(rows, offset, global.limit);
    print(&envelope_ok(
        serde_json::json!({ "items": page, "offset": offset, "total": total }),
    ));
    Ok(())
}

/// `wordcount`: i conteggi della view `stats.document`, cioè la regola del
/// pannello statistiche (quale testo contare, e come) letta dal suo owner.
pub fn wordcount(
    connection: &Connection,
    _global: &GlobalArgs,
    _format: &OutputFormat,
    args: DocArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    let instance = fub_abi::traits::ViewInstance {
        view: "stats.document".to_string(),
        instance: "cli.wordcount".to_string(),
        params: serde_json::json!({ "doc": id.as_str() }),
    };
    let tree = connection
        .host
        .render_view(connection.vault_selector(), &instance)
        .map_err(|error| Failure::from_plugin(&error))?;
    if tree.key.as_deref() == Some("no_doc") {
        return Err(Failure::from_plugin(&fub_abi::PluginError::NotFound(
            fub_abi::Text::Literal(id.as_str().to_string()),
        )));
    }
    let count = |key: &str| {
        count_of(&tree, key)
            .ok_or_else(|| Failure::local(format!("stats.document non ha detto `{key}`")))
    };
    print(&envelope_ok(serde_json::json!({
        "doc": id.as_str(), "words": count("words")?, "chars": count("chars")?,
        "minutes": count("minutes")?,
    })));
    Ok(())
}

/// Il numero della cella con questa chiave: la view scrive i conteggi in
/// cifre, con la chiave del conteggio, perché una frase tradotta non si rilegge.
fn count_of(node: &fub_abi::ui::UiNode, key: &str) -> Option<u64> {
    use fub_abi::ui::UiKind;
    if node.key.as_deref() == Some(key) {
        if let UiKind::Text {
            content: fub_abi::Text::Literal(n),
        } = &node.kind
        {
            return n.parse().ok();
        }
    }
    match &node.kind {
        UiKind::Table { rows: children, .. }
        | UiKind::Row {
            cells: children, ..
        }
        | UiKind::Stack { children, .. }
        | UiKind::Section { children, .. } => {
            children.iter().find_map(|child| count_of(child, key))
        }
        _ => None,
    }
}

/// `bookmarks`: le note appuntate, dall'organizzazione del vault.
pub fn bookmarks(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    match connection
        .host
        .query_index(
            connection.vault_selector(),
            fub_abi::IndexQuery::Organization,
        )
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Organization(organization) => {
            let offset = global.offset.unwrap_or(0);
            let (page, total) = paginate(organization.pinned, offset, global.limit);
            print(&envelope_ok(
                serde_json::json!({ "items": page, "offset": offset, "total": total }),
            ));
            Ok(())
        }
        other => Err(Failure::local(format!(
            "bookmarks ha risposto {}",
            other.kind_name()
        ))),
    }
}

/// `random`: la nota che sceglie `note.random`, che non scrive.
pub fn random(
    connection: &Connection,
    _global: &GlobalArgs,
    _format: &OutputFormat,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let outcome = connection
        .host
        .invoke_user_command(
            connection.vault_selector(),
            "note.random",
            serde_json::json!({}),
            fub_abi::InvokeMode::DryRun,
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    match outcome.effect {
        fub_abi::CommandEffect::Navigate { doc } => {
            print(&envelope_ok(serde_json::json!({ "doc": doc.as_str() })));
            Ok(())
        }
        _ => Err(Failure::local("note.random non ha nominato una nota")),
    }
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
