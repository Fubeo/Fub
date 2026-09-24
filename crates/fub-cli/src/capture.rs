//! Capture: ingresso non autenticato (file/URI) + applicazione capture v1.
//!
//! Validazione identica al canale NM (stessi limiti, stesso validatore).
//! Scrittura solo con consenso esplicito (--yes o conferma interattiva);
//! --no-input rifiuta. Mai scrittura silenziosa, mai token in pagina.

use super::cli::{CaptureArgs, GlobalArgs};
use super::commands::{doc_id, Connection, Failure};
use super::output::OutputFormat;

pub(crate) fn confirm_capture(global: &GlobalArgs, summary: &str) -> Result<(), Failure> {
    if global.no_input {
        return Err(Failure::new(4, "denied", format!("{summary}: rifiutato (--no-input). URI/file sono import non autenticati: serve approvazione esplicita.")));
    }
    if global.yes {
        return Ok(());
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        return Err(Failure::new(
            4,
            "denied",
            format!("{summary}: serve --yes su stdin non interattivo"),
        ));
    }
    eprint!("{summary} [y/N] ");
    use std::io::BufRead;
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| Failure::new(1, "local", format!("stdin: {e}")))?;
    if line.trim().eq_ignore_ascii_case("y") || line.trim().eq_ignore_ascii_case("yes") {
        Ok(())
    } else {
        Err(Failure::new(4, "denied", "capture rifiutata"))
    }
}

fn parse_prop(raw: &str) -> Result<(String, serde_json::Value), Failure> {
    let (key, value) = raw
        .split_once('=')
        .ok_or_else(|| Failure::bad_args("--prop vuole chiave=valore"))?;
    if key.trim().is_empty() {
        return Err(Failure::bad_args("--prop con chiave vuota"));
    }
    // YAML libero: si prova JSON, altrimenti testo.
    let parsed: serde_json::Value = serde_json::from_str(value)
        .unwrap_or_else(|_| serde_json::Value::String(value.to_string()));
    Ok((key.trim().to_string(), parsed))
}

pub fn build_payload(
    args: &CaptureArgs,
) -> Result<(fub_host::automation::CapturePayloadV1, Option<String>), Failure> {
    use fub_host::automation::{validate_capture_v1, CaptureMode, CapturePayloadV1, CaptureTarget};
    // Tre forme: --file .fubcapture.json | --json payload | flag inline.
    if let Some(path) = args.file.as_deref() {
        let raw = super::commands::read_file_text(path)?;
        return file_payload(&raw);
    }
    if let Some(raw) = args.payload_json.as_deref() {
        return file_payload(raw);
    }
    let title = args
        .title
        .clone()
        .ok_or_else(|| Failure::bad_args("capture vuole --title (o --file/--json)"))?;
    let markdown = if let Some(text) = args.text.clone() {
        text
    } else if let Some(path) = args.text_file.as_deref() {
        super::commands::read_file_text(path)?
    } else if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        super::commands::read_stdin_text()?
    } else {
        return Err(Failure::bad_args(
            "capture vuole --text/--text-file/stdin (o --file/--json)",
        ));
    };
    let mode = match args.mode.as_deref().map(|s| s.trim().to_ascii_lowercase()) {
        None => CaptureMode::Create,
        Some(m) => CaptureMode::parse(&m).map_err(|error| Failure::from_automation(&error))?,
    };
    let mut properties = serde_json::Map::new();
    for raw in &args.prop {
        let (key, value) = parse_prop(raw)?;
        properties.insert(key, value);
    }
    let payload = CapturePayloadV1 {
        v: 1,
        title,
        markdown,
        source_url: args.source_url.clone(),
        properties: if properties.is_empty() {
            None
        } else {
            Some(properties)
        },
        target: CaptureTarget {
            vault: args.vault.clone(),
            folder: args.folder.clone(),
            note: args.note.clone(),
            mode,
        },
    };
    validate_capture_v1(&payload).map_err(|error| Failure::from_automation(&error))?;
    Ok((payload, None))
}

fn file_payload(
    raw: &str,
) -> Result<(fub_host::automation::CapturePayloadV1, Option<String>), Failure> {
    use fub_host::automation::{validate_capture_v1, CapturePayloadV1};
    // Due forme: payload diretto o {envelope,payload} (.fubcapture.json).
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| Failure::bad_args(format!(".fubcapture.json non valido: {e}")))?;
    if value.get("payload").is_some() {
        let envelope: fub_host::automation::CaptureEnvelope = serde_json::from_value(
            value
                .get("envelope")
                .cloned()
                .ok_or_else(|| Failure::bad_args("capture envelope mancante"))?,
        )
        .map_err(|_| Failure::bad_args("capture envelope non valida"))?;
        fub_host::automation::validate_envelope(&envelope)
            .map_err(|error| Failure::from_automation(&error))?;
        let payload: CapturePayloadV1 =
            serde_json::from_value(value.get("payload").cloned().unwrap_or_default())
                .map_err(|e| Failure::bad_args(format!("payload non valido: {e}")))?;
        validate_capture_v1(&payload).map_err(|error| Failure::from_automation(&error))?;
        return Ok((payload, Some(envelope.nonce)));
    }
    let payload: CapturePayloadV1 = serde_json::from_value(value)
        .map_err(|e| Failure::bad_args(format!("payload non valido: {e}")))?;
    validate_capture_v1(&payload).map_err(|error| Failure::from_automation(&error))?;
    Ok((payload, None))
}

fn titled_body(title: &str, markdown: &str, source_url: Option<&str>) -> String {
    // Corpo con titolo H1 + fonte: la destinazione resta testo cercabile.
    let mut body = format!("# {title}\n\n{markdown}");
    if let Some(url) = source_url {
        if !url.trim().is_empty() {
            body.push_str(&format!("\n\nFonte: {url}"));
        }
    }
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body
}

pub fn capture(
    connection: &mut Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    args: CaptureArgs,
) -> Result<(), Failure> {
    let (payload, nonce) = build_payload(&args)?;
    let mut result = apply_payload(connection, global, payload)?;
    if let Some(nonce) = nonce {
        result["nonce"] = serde_json::json!(nonce);
    }
    super::print_value(global, format, &super::output::envelope_ok(result));
    Ok(())
}

fn apply_payload(
    connection: &mut Connection,
    global: &GlobalArgs,
    payload: fub_host::automation::CapturePayloadV1,
) -> Result<serde_json::Value, Failure> {
    use fub_host::automation::CaptureMode;
    // Vault: payload > --vault globale > FUB_VAULT > corrente.
    let vault = payload
        .target
        .vault
        .clone()
        .or_else(|| connection.vault_selector().map(str::to_string));
    let selector = vault.as_deref();
    // Consenso: import non autenticato = approvazione esplicita sempre.
    let summary = format!(
        "capture `{}` -> {} ({})",
        payload.title,
        payload
            .target
            .note
            .as_deref()
            .or(payload.target.folder.as_deref())
            .unwrap_or("(nuova nota)"),
        payload.target.mode.as_str(),
    );
    confirm_capture(global, &summary)?;
    if global.dry_run {
        return Ok(serde_json::json!({ "dry_run": true, "summary": summary }));
    }
    if let Some(root) = payload.target.vault.as_deref() {
        connection.open_vault(root)?;
    }
    match payload.target.mode {
        CaptureMode::Create => {
            let name = match payload.target.note.as_deref() {
                Some(note) if !note.trim().is_empty() => note.trim().to_string(),
                _ => {
                    // Titolo -> nome file: portabilità via doc_id, collisione
                    // via free_name del comando note.create.
                    let slug: String = payload.title.trim().chars().take(80).collect();
                    if slug.trim().is_empty() {
                        "Untitled.md".to_string()
                    } else {
                        format!("{}.md", slug.trim())
                    }
                }
            };
            // Cartella opzionale: compone senza traversal (già validato).
            let full = match payload.target.folder.as_deref() {
                Some(folder) if !folder.trim().is_empty() => {
                    format!("{}/{name}", folder.trim().trim_matches('/'))
                }
                _ => name,
            };
            let id = doc_id(&full)?;
            // Già occupato = Conflict, mai sovrascrittura: il comando
            // note.create fallisce da sé su path preso.
            let body = titled_body(
                &payload.title,
                &payload.markdown,
                payload.source_url.as_deref(),
            );
            let outcome = connection
                .host
                .invoke_user_command(
                    selector,
                    "note.create",
                    serde_json::json!({ "name": id.as_str() }),
                    fub_abi::InvokeMode::Apply,
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            let created = created_doc(&outcome).unwrap_or(id);
            let (_, revision) = connection
                .host
                .read_document(selector, &created)
                .map_err(|error| Failure::from_plugin(&error))?;
            connection
                .host
                .write_document(
                    selector,
                    &created,
                    &body,
                    fub_abi::WriteBase::DescendsFrom(revision),
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            apply_properties(connection, selector, &created, &payload)?;
            Ok(serde_json::json!({ "mode": "create", "doc": created.as_str() }))
        }
        CaptureMode::Daily => {
            // Giornaliera: riuso di note.daily, poi append del corpo.
            let outcome = connection
                .host
                .invoke_user_command(
                    selector,
                    "note.daily",
                    serde_json::json!({}),
                    fub_abi::InvokeMode::Apply,
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            let daily = created_doc(&outcome)
                .ok_or_else(|| Failure::local("note.daily non ha restituito una destinazione"))?;
            append_body(
                connection,
                selector,
                &daily,
                &titled_body(
                    &payload.title,
                    &payload.markdown,
                    payload.source_url.as_deref(),
                ),
            )?;
            apply_properties(connection, selector, &daily, &payload)?;
            Ok(serde_json::json!({ "mode": "daily", "doc": daily.as_str() }))
        }
        CaptureMode::Append => {
            let note = payload
                .target
                .note
                .as_deref()
                .ok_or_else(|| Failure::bad_args("append vuole --note"))?;
            let id = doc_id(note)?;
            append_body(
                connection,
                selector,
                &id,
                &format!(
                    "\n\n{}",
                    titled_body(
                        &payload.title,
                        &payload.markdown,
                        payload.source_url.as_deref()
                    )
                ),
            )?;
            apply_properties(connection, selector, &id, &payload)?;
            Ok(serde_json::json!({ "mode": "append", "doc": id.as_str() }))
        }
        CaptureMode::Prepend => {
            let note = payload
                .target
                .note
                .as_deref()
                .ok_or_else(|| Failure::bad_args("prepend vuole --note"))?;
            let id = doc_id(note)?;
            let (source, revision) = connection
                .host
                .read_document(selector, &id)
                .map_err(|error| Failure::from_plugin(&error))?;
            let body = format!(
                "{}{}",
                titled_body(
                    &payload.title,
                    &payload.markdown,
                    payload.source_url.as_deref()
                ),
                source
            );
            connection
                .host
                .write_document(
                    selector,
                    &id,
                    &body,
                    fub_abi::WriteBase::DescendsFrom(revision),
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            apply_properties(connection, selector, &id, &payload)?;
            Ok(serde_json::json!({ "mode": "prepend", "doc": id.as_str() }))
        }
    }
}

fn created_doc(outcome: &fub_abi::CommandOutcome) -> Option<fub_abi::DocId> {
    match &outcome.effect {
        fub_abi::CommandEffect::Navigate { doc } => Some(doc.clone()),
        _ => None,
    }
}

fn append_body(
    connection: &Connection,
    selector: Option<&str>,
    id: &fub_abi::DocId,
    addition: &str,
) -> Result<(), Failure> {
    let (source, revision) = connection
        .host
        .read_document(selector, id)
        .map_err(|error| Failure::from_plugin(&error))?;
    let mut body = source;
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(addition);
    connection
        .host
        .write_document(
            selector,
            id,
            &body,
            fub_abi::WriteBase::DescendsFrom(revision),
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    Ok(())
}

fn apply_properties(
    connection: &Connection,
    selector: Option<&str>,
    id: &fub_abi::DocId,
    payload: &fub_host::automation::CapturePayloadV1,
) -> Result<(), Failure> {
    let Some(props) = payload.properties.as_ref() else {
        return Ok(());
    };
    for (key, value) in props {
        let rendered = match value {
            serde_json::Value::String(s) => s.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        connection
            .host
            .invoke_user_command(
                selector,
                "note.property.set",
                serde_json::json!({ "doc": id.as_str(), "key": key, "value": rendered }),
                fub_abi::InvokeMode::Apply,
            )
            .map_err(|error| Failure::from_plugin(&error))?;
    }
    Ok(())
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCallbacks {
    v: u8,
    schemes: Vec<String>,
    loopback_http: bool,
}

fn callback_policy(global: &GlobalArgs) -> Result<fub_host::automation::CallbackPolicy, Failure> {
    let path = super::local::config_path(global, "callback-policy.json")?;
    let raw = match std::fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(fub_host::automation::CallbackPolicy::deny_all())
        }
        Err(e) => return Err(Failure::local(format!("callback policy: {e}"))),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|e| Failure::local(format!("callback policy: {e}")))?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.permissions().mode() & 0o077 != 0
        {
            return Err(Failure::new(
                4,
                "denied",
                "callback policy richiede file regolare 0600",
            ));
        }
    }
    let stored: StoredCallbacks = serde_json::from_slice(&raw)
        .map_err(|_| Failure::new(4, "denied", "callback policy non valida"))?;
    if stored.v != 1
        || stored.schemes.len() > 32
        || stored.schemes.iter().any(|s| validate_scheme(s).is_err())
    {
        return Err(Failure::new(
            4,
            "denied",
            "callback policy con versione/schema non supportati",
        ));
    }
    Ok(fub_host::automation::CallbackPolicy {
        allowed_schemes: stored.schemes,
        allow_http: stored.loopback_http,
    })
}

fn validate_scheme(raw: &str) -> Result<String, Failure> {
    let scheme = raw.to_ascii_lowercase();
    if scheme.len() > 64
        || !scheme
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic())
        || !scheme
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
        || matches!(
            scheme.as_str(),
            "javascript" | "data" | "vbscript" | "file" | "fub" | "about" | "blob"
        )
    {
        return Err(Failure::bad_args("schema callback non sicuro"));
    }
    Ok(scheme)
}

pub fn callback_command(
    global: &GlobalArgs,
    format: &OutputFormat,
    action: super::cli::CallbackAction,
) -> Result<(), Failure> {
    let mut policy = callback_policy(global)?;
    match &action {
        super::cli::CallbackAction::List => {}
        super::cli::CallbackAction::Allow(raw) => {
            let scheme = validate_scheme(raw)?;
            confirm_capture(global, &format!("autorizzare callback con schema {scheme}"))?;
            if scheme == "http" {
                policy.allow_http = true;
            } else if !policy.allowed_schemes.contains(&scheme) {
                policy.allowed_schemes.push(scheme);
            }
        }
        super::cli::CallbackAction::Revoke(raw) => {
            let scheme = validate_scheme(raw)?;
            if scheme == "http" {
                policy.allow_http = false;
            }
            policy.allowed_schemes.retain(|s| s != &scheme);
        }
    }
    if !matches!(action, super::cli::CallbackAction::List) && !global.dry_run {
        let path = super::local::config_path(global, "callback-policy.json")?;
        let bytes = serde_json::to_vec(&StoredCallbacks {
            v: 1,
            schemes: policy.allowed_schemes.clone(),
            loopback_http: policy.allow_http,
        })
        .map_err(|e| Failure::local(format!("callback policy: {e}")))?;
        super::local::save_owner_file(&path, &bytes)?;
    }
    super::print_value(
        global,
        format,
        &super::output::envelope_ok(serde_json::json!({
            "schemes": policy.allowed_schemes, "loopback_http": policy.allow_http,
            "dry_run": global.dry_run,
        })),
    );
    Ok(())
}

fn callback_audit(global: &GlobalArgs, scheme: &str, event: &str) -> Result<(), Failure> {
    use std::io::Write;
    let path = super::local::config_path(global, "callback-audit.jsonl")?;
    let parent = path
        .parent()
        .ok_or_else(|| Failure::local("callback audit senza directory"))?;
    std::fs::create_dir_all(parent).map_err(|e| Failure::local(format!("callback audit: {e}")))?;
    if std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(Failure::new(
            4,
            "denied",
            "callback audit non può essere symlink",
        ));
    }
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(&path)
    };
    #[cfg(not(unix))]
    let file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path);
    let mut file = file.map_err(|e| Failure::local(format!("callback audit: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if file
            .metadata()
            .map_err(|e| Failure::local(format!("callback audit: {e}")))?
            .permissions()
            .mode()
            & 0o077
            != 0
        {
            return Err(Failure::new(
                4,
                "denied",
                "callback audit richiede file 0600",
            ));
        }
    }
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    writeln!(
        file,
        "{}",
        serde_json::json!({ "at": at, "scheme": scheme, "event": event })
    )
    .and_then(|_| file.sync_all())
    .map_err(|e| Failure::local(format!("callback audit: {e}")))
}

fn open_callback(
    global: &GlobalArgs,
    callback: &str,
    policy: &fub_host::automation::CallbackPolicy,
) -> Result<(), Failure> {
    fub_host::automation::validate_callback(callback, policy)
        .map_err(|e| Failure::from_automation(&e))?;
    let scheme = callback.split_once(':').map(|(s, _)| s).unwrap_or("");
    confirm_capture(
        global,
        &format!("aprire callback {scheme}: con l'applicazione OS"),
    )?;
    callback_audit(global, scheme, "attempt")?;
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open")
        .arg(callback)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg(callback)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let status: std::io::Result<std::process::ExitStatus> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opener OS non supportato",
    ));
    let opened = status.is_ok_and(|s| s.success());
    callback_audit(global, scheme, if opened { "opened" } else { "failed" })?;
    if opened {
        Ok(())
    } else {
        Err(Failure::new(
            3,
            "unavailable",
            "callback opener OS non disponibile",
        ))
    }
}

pub fn uri(
    connection: &mut Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    raw: String,
    execute: bool,
) -> Result<(), Failure> {
    use fub_host::automation::{parse_fub_uri, validate_callback, FubUri};
    let parsed = parse_fub_uri(&raw).map_err(|error| Failure::from_automation(&error))?;
    let policy = callback_policy(global)?;
    if let FubUri::Capture {
        success_callback,
        error_callback,
        ..
    } = &parsed
    {
        for callback in [success_callback, error_callback].into_iter().flatten() {
            validate_callback(callback, &policy)
                .map_err(|error| Failure::from_automation(&error))?;
        }
    }
    if !execute {
        super::print_value(
            global,
            format,
            &super::output::envelope_ok(serde_json::json!({
                "action": parsed.action(), "description": describe_uri(&parsed),
            })),
        );
        return Ok(());
    }
    let selected_vault = match &parsed {
        FubUri::Open { vault, .. }
        | FubUri::New { vault, .. }
        | FubUri::Daily { vault, .. }
        | FubUri::Unique { vault, .. }
        | FubUri::Search { vault, .. }
        | FubUri::Capture { vault, .. } => vault.clone(),
    };
    if let Some(root) = selected_vault.as_deref() {
        connection.open_vault(root)?;
    }
    let result = match parsed {
        FubUri::Open {
            note,
            heading,
            block,
            split,
            window,
            ..
        } => {
            if split.is_some() || window.is_some() {
                return Err(Failure::bad_args(
                    "split/window sono azioni GUI, non eseguibili dalla CLI",
                ));
            }
            if let Some(note) = note {
                let id = doc_id(&note)?;
                let (source, revision) = connection
                    .host
                    .read_document(connection.vault_selector(), &id)
                    .map_err(|error| Failure::from_plugin(&error))?;
                serde_json::json!({ "action": "open", "doc": id.as_str(), "revision": revision.as_str(),
                    "source": source, "heading": heading, "block": block })
            } else {
                serde_json::json!({ "action": "open", "vault": connection.vault_selector() })
            }
        }
        FubUri::New {
            folder,
            name,
            title,
            template,
            ..
        } => {
            vault_required(connection)?;
            let full = match (folder.as_deref(), name.as_deref()) {
                (Some(folder), Some(name)) => format!("{}/{name}", folder.trim_matches('/')),
                (Some(folder), None) => format!("{}/Untitled.md", folder.trim_matches('/')),
                (None, Some(name)) => name.to_string(),
                (None, None) => "Untitled.md".to_string(),
            };
            let id = doc_id(&full)?;
            if !global.dry_run {
                confirm_capture(global, &format!("uri new -> {full}"))?;
            }
            let mode = if global.dry_run {
                fub_abi::InvokeMode::DryRun
            } else {
                fub_abi::InvokeMode::Apply
            };
            let (command, args) = match template.as_deref() {
                Some(template) => (
                    "note.from_template",
                    serde_json::json!({ "template": template, "name": id.as_str() }),
                ),
                None => ("note.create", serde_json::json!({ "name": id.as_str() })),
            };
            let outcome = connection
                .host
                .invoke_user_command(connection.vault_selector(), command, args, mode)
                .map_err(|error| Failure::from_plugin(&error))?;
            let created = created_doc(&outcome).unwrap_or(id);
            if let Some(title) = title.as_deref().filter(|_| !global.dry_run) {
                let (source, revision) = connection
                    .host
                    .read_document(connection.vault_selector(), &created)
                    .map_err(|error| Failure::from_plugin(&error))?;
                let body = format!("# {title}\n\n{source}");
                connection
                    .host
                    .write_document(
                        connection.vault_selector(),
                        &created,
                        &body,
                        fub_abi::WriteBase::DescendsFrom(revision),
                    )
                    .map_err(|error| Failure::from_plugin(&error))?;
            }
            serde_json::json!({ "action": "new", "doc": created.as_str(), "dry_run": global.dry_run })
        }
        FubUri::Daily { date, .. } => {
            vault_required(connection)?;
            if !global.dry_run {
                confirm_capture(global, "uri daily")?;
            }
            let mode = if global.dry_run {
                fub_abi::InvokeMode::DryRun
            } else {
                fub_abi::InvokeMode::Apply
            };
            let args = date
                .as_deref()
                .map(|d| serde_json::json!({ "date": d }))
                .unwrap_or_else(|| serde_json::json!({}));
            let outcome = connection
                .host
                .invoke_user_command(connection.vault_selector(), "note.daily", args, mode)
                .map_err(|error| Failure::from_plugin(&error))?;
            serde_json::json!({ "action": "daily", "doc": created_doc(&outcome).map(|d| d.as_str().to_string()),
                "dry_run": global.dry_run })
        }
        FubUri::Unique { folder, prefix, .. } => {
            vault_required(connection)?;
            let stem = prefix.as_deref().unwrap_or("Nota").trim();
            let full = folder
                .as_deref()
                .map(|f| format!("{}/{stem}.md", f.trim_matches('/')))
                .unwrap_or_else(|| format!("{stem}.md"));
            let id = doc_id(&full)?;
            if !global.dry_run {
                confirm_capture(global, &format!("uri unique -> {}", id.as_str()))?;
            }
            let mode = if global.dry_run {
                fub_abi::InvokeMode::DryRun
            } else {
                fub_abi::InvokeMode::Apply
            };
            let outcome = connection
                .host
                .invoke_user_command(
                    connection.vault_selector(),
                    "note.unique",
                    serde_json::json!({ "name": id.as_str() }),
                    mode,
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            let created = created_doc(&outcome);
            if !global.dry_run && created.is_none() {
                return Err(Failure::local("note.unique senza destinazione"));
            }
            serde_json::json!({ "action": "unique", "doc": created.map(|d| d.as_str().to_string()),
                "dry_run": global.dry_run })
        }
        FubUri::Search { q, tag, folder, .. } => {
            vault_required(connection)?;
            super::local::search(
                connection,
                global,
                format,
                super::cli::SearchArgs {
                    global: global.clone(),
                    query: q.unwrap_or_default(),
                    field: Vec::new(),
                    phrase: false,
                    tag,
                    folder,
                    select: Vec::new(),
                },
                |v| super::print_value(global, format, v),
            )?;
            return Ok(());
        }
        FubUri::Capture {
            vault,
            folder,
            note,
            mode,
            title,
            markdown,
            source_url,
            success_callback,
            error_callback,
        } => {
            let payload = fub_host::automation::CapturePayloadV1 {
                v: 1,
                title: title.ok_or_else(|| Failure::bad_args("uri capture richiede title"))?,
                markdown: markdown
                    .ok_or_else(|| Failure::bad_args("uri capture richiede markdown"))?,
                source_url,
                properties: None,
                target: fub_host::automation::CaptureTarget {
                    vault,
                    folder,
                    note,
                    mode: mode.unwrap_or(fub_host::automation::CaptureMode::Create),
                },
            };
            fub_host::automation::validate_capture_v1(&payload)
                .map_err(|error| Failure::from_automation(&error))?;
            let result = apply_payload(connection, global, payload);
            match result {
                Ok(result) => {
                    if !global.dry_run && !super::interrupted() {
                        if let Some(callback) = success_callback.as_deref() {
                            open_callback(global, callback, &policy)?;
                        }
                    }
                    serde_json::json!({ "action": "capture", "result": result,
                        "callback_opened": success_callback.is_some() && !global.dry_run })
                }
                Err(failure) => {
                    if !global.dry_run && !super::interrupted() {
                        if let Some(callback) = error_callback.as_deref() {
                            let _ = open_callback(global, callback, &policy);
                        }
                    }
                    return Err(failure);
                }
            }
        }
    };
    if super::interrupted() {
        return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
    }
    super::print_value(global, format, &super::output::envelope_ok(result));
    Ok(())
}

fn vault_required(connection: &Connection) -> Result<(), Failure> {
    if connection.vault_selector().is_some() || connection.host.has_current_vault() {
        return Ok(());
    }
    Err(Failure::new(
        2,
        "bad_args",
        "nessun vault: --vault PATH o FUB_VAULT",
    ))
}

fn describe_uri(uri: &fub_host::automation::FubUri) -> String {
    use fub_host::automation::FubUri;
    match uri {
        FubUri::Open {
            vault,
            note,
            heading,
            block,
            split,
            window,
        } => {
            format!("open vault={vault:?} note={note:?} heading={heading:?} block={block:?} split={split:?} window={window:?} (lettura)")
        }
        FubUri::New {
            vault,
            folder,
            name,
            title,
            template,
        } => {
            format!("new vault={vault:?} folder={folder:?} name={name:?} title={title:?} template={template:?} (creazione con conferma)")
        }
        FubUri::Daily { vault, date } => {
            format!("daily vault={vault:?} date={date:?} (apre/crea con conferma)")
        }
        FubUri::Unique {
            vault,
            folder,
            prefix,
        } => {
            format!("unique vault={vault:?} folder={folder:?} prefix={prefix:?} (nome libero)")
        }
        FubUri::Search {
            vault,
            q,
            tag,
            folder,
        } => {
            format!("search vault={vault:?} q={q:?} tag={tag:?} folder={folder:?} (lettura)")
        }
        FubUri::Capture {
            vault,
            folder,
            note,
            mode,
            title,
            source_url,
            ..
        } => {
            format!("capture vault={vault:?} folder={folder:?} note={note:?} mode={mode:?} title={title:?} source_url={source_url:?} (proposta: serve `capture` con approvazione)")
        }
    }
}
