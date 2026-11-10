//! I comandi locali sul singolo documento e sul vault: `vault`, `read`,
//! `write` (con append/prepend), `create` ed `edit`.

use crate::cli::{CreateArgs, EditArgs, GlobalArgs, ReadArgs, VaultAction, WriteArgs};
use crate::commands::{
    doc_id, parse_json_object, read_file_text, read_stdin_text, render_error_text, Connection,
    Failure,
};
use crate::output::envelope_ok;
use crate::output::OutputFormat;

use super::{confirm_write, dry_run, outcome_json, vault_required};

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
            if let Some(root) = connection.host.app_root() {
                print(&envelope_ok(
                    serde_json::json!({ "root": root.as_str(), "via": "app" }),
                ));
                return Ok(());
            }
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

pub(super) fn items_len(items: &[serde_json::Value]) -> usize {
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
    write_with(
        connection,
        global,
        args,
        |prompt| confirm_write(global, prompt),
        print,
    )
}

/// [`write`] con la conferma passata da fuori: fra la lettura della base e la
/// scrittura c'è l'attesa di una persona, e il banco ci deve poter mettere
/// dentro un'altra applicazione.
pub(super) fn write_with(
    connection: &mut Connection,
    global: &GlobalArgs,
    args: WriteArgs,
    confirm: impl FnOnce(&str) -> Result<(), Failure>,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    vault_required(connection)?;
    let id = doc_id(&args.doc)?;
    let source = resolve_source(args.stdin, args.text, args.file)?;
    // La scrittura diretta usa la guardia CAS: base letta, o force detta.
    // `None` è una nota che non c'era: la si **crea**, in modo esclusivo.
    let base = if let Some(base) = args.base.as_deref() {
        Some(fub_abi::WriteBase::DescendsFrom(fub_abi::Revision::new(
            base,
        )))
    } else if args.force {
        Some(fub_abi::WriteBase::Dictated)
    } else {
        // Senza base si legge la revisione corrente: un secondo writer nel
        // frattempo = Conflict, mai lost update silenziosa. Vale anche per chi
        // la nota la crea mentre si aspetta la conferma: scriverla `Dictated`
        // copriva ciò che l'altra applicazione ci aveva appena messo.
        match connection
            .host
            .read_document(connection.vault_selector(), &id)
        {
            Ok((_, revision)) => Some(fub_abi::WriteBase::DescendsFrom(revision)),
            Err(fub_abi::PluginError::NotFound(_)) => None,
            Err(e) => return Err(Failure::from_plugin(&e)),
        }
    };
    if dry_run(global) {
        print(&envelope_ok(
            serde_json::json!({ "doc": id.as_str(), "would_write_bytes": source.len(), "dry_run": true }),
        ));
        return Ok(());
    }
    confirm(&format!("scrivere `{}`", args.doc))?;
    let revision = match base {
        Some(base) => {
            connection
                .host
                .write_document(connection.vault_selector(), &id, &source, base)
        }
        None => connection.host.write_document_bytes(
            connection.vault_selector(),
            &id,
            source.as_bytes(),
            None,
        ),
    }
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
