//! Comandi sync e publish sopra l'autorità dell'Host e i client remoti.
//! Il job `sync.pass` usa le porte del vault e la root trusted dell'istanza;
//! publish proietta esclusivamente documenti Markdown autorizzati.

use super::cli::{GlobalArgs, PublishAction, PublishArgs, SyncAction, SyncArgs};
use super::commands::{Connection, Failure};
use super::output::{envelope_ok, OutputFormat};

/// Lo stato di sync del vault scelto: la stessa cartella che il bundle riceve
/// al montaggio ([`fub_host::remote::vault_state_dir`]).
fn sync_state_dir(connection: &Connection) -> Result<std::path::PathBuf, Failure> {
    let config = connection.host.configuration_root().ok_or_else(|| {
        let error = fub_host::remote::RemoteError::MissingConfiguration;
        Failure::new(error.exit_code(), "bad_args", error.to_string())
    })?;
    let root = connection
        .host
        .root(connection.vault_selector())
        .map_err(|error| Failure::from_plugin(&error))?;
    Ok(fub_host::remote::vault_state_dir(config, &root).into_std_path_buf())
}

/// Il token come lo leggono i bundle: l'ambiente, poi quello salvato da
/// `login` nella configurazione della macchina.
fn token_source(connection: &Connection) -> fub_host::remote::TokenSource {
    fub_host::remote::TokenSource::machine(connection.host.configuration_root())
}

fn setting_url(connection: &Connection, key: &str) -> Result<String, Failure> {
    match connection
        .host
        .query_index(
            connection.vault_selector(),
            fub_abi::IndexQuery::Settings { plugin: None },
        )
        .map_err(|error| Failure::from_plugin(&error))?
    {
        fub_abi::IndexResult::Settings(entries) => Ok(entries
            .iter()
            .find(|e| e.spec.key == key)
            .and_then(|e| e.value.as_text())
            .map(|url| url.trim().to_string())
            .unwrap_or_default()),
        other => Err(Failure::local(format!(
            "settings ha risposto {}",
            other.kind_name()
        ))),
    }
}

fn build_client(connection: &Connection) -> Result<fub_host::remote::sync::SyncClient, Failure> {
    let state_dir = sync_state_dir(connection)?;
    let setting = setting_url(connection, "sync.server_url")?;
    // Nessun `vault_scope`: l'abbinamento del vault sta nel suo stato, e
    // il percorso del vault non è un identificativo remoto (I60).
    fub_host::remote::sync::SyncClient::from_env(
        state_dir,
        None,
        &setting,
        &token_source(connection),
    )
    .map_err(map_sync_err)
}

pub fn map_sync_err(error: fub_host::remote::sync::SyncClientError) -> Failure {
    use fub_host::remote::sync::SyncClientError;
    let code = error.exit_code();
    let kind = match &error {
        SyncClientError::MissingConfiguration => "bad_args",
        SyncClientError::Transport(_) => "unavailable",
        SyncClientError::Protocol(_) => "protocol",
        SyncClientError::MissingCredentials => "auth",
        SyncClientError::Rejected { status, .. } => match status {
            401 | 403 | 429 => "denied",
            404 => "not_found",
            409 => "conflict",
            _ => "unavailable",
        },
        SyncClientError::Paused => "paused",
        SyncClientError::Busy(_) => "busy",
        SyncClientError::RecoveryNeeded { .. } => "recovery",
        SyncClientError::QueueFull { .. } => "queue_full",
        SyncClientError::Held { .. } => "conflict",
    };
    Failure::new(code, kind, super::output::redact(&error.to_string()))
}
pub fn map_publish_err(error: fub_host::publish::site::PublishClientError) -> Failure {
    use fub_host::publish::site::PublishClientError;
    let code = error.exit_code();
    let kind = match &error {
        PublishClientError::Transport { .. } => "unavailable",
        PublishClientError::Protocol { .. } => "protocol",
        PublishClientError::MissingCredentials => "auth",
        PublishClientError::MissingConfiguration => "bad_args",
        PublishClientError::BadEndpoint(_) => "bad_args",
        PublishClientError::Rejected { status, .. } => match status {
            401 | 403 | 429 => "denied",
            404 => "not_found",
            409 => "conflict",
            _ => "unavailable",
        },
    };
    Failure::new(code, kind, super::output::redact(&error.to_string()))
}

pub fn sync_cmd(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: SyncArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    match &args.action {
        SyncAction::Status => {
            let client = build_client(connection)?;
            let status = client.status().map_err(map_sync_err)?;
            print(&envelope_ok(serde_json::json!({
                "replica_id": status.replica_id,
                "server_vv": status.server_vv.iter().map(|(id, version)| (id, version.to_string())).collect::<std::collections::BTreeMap<_, _>>(),
                "docs": status.docs,
                "pending": status.pending,
                "conflicts": status.conflicts,
                "tombstones": status.tombstones,
                "trash": status.trash,
            })));
            Ok(())
        }
        SyncAction::Once | SyncAction::Watch { .. } => {
            let interval = match &args.action {
                SyncAction::Watch { interval_secs } => {
                    Some(std::time::Duration::from_secs((*interval_secs).max(1)))
                }
                _ => None,
            };
            let mut tick = 0u64;
            let mut failures = 0u32;
            loop {
                if super::interrupted() {
                    return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
                }
                if global.dry_run {
                    let client = build_client(connection)?;
                    let status = client.status().map_err(map_sync_err)?;
                    print(&envelope_ok(serde_json::json!({
                        "dry_run": true,
                        "server": { "docs": status.docs, "pending": status.pending, "conflicts": status.conflicts },
                    })));
                    return Ok(());
                }
                let pass = connection
                    .host
                    .invoke_job(
                        connection.vault_selector(),
                        "fub.sync",
                        "sync.pass",
                        serde_json::json!({ "op": "pass" }),
                    )
                    .map_err(|error| Failure::from_plugin(&error));
                let report = match pass {
                    Ok(report) => report,
                    Err(failure) if interval.is_some() && matches!(failure.code, 3 | 5) => {
                        failures = failures.saturating_add(1);
                        let base = interval.unwrap_or_default().as_secs().max(1);
                        let delay = base.saturating_mul(1u64 << failures.min(5)).min(300);
                        print(&super::output::envelope_err(
                            failure.kind,
                            &failure.message,
                            failure.code,
                        ));
                        super::pause_or_interrupt(std::time::Duration::from_secs(delay))?;
                        continue;
                    }
                    Err(failure) => return Err(failure),
                };
                if super::interrupted() {
                    return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
                }
                // sync.pass persists cursor/outbox/snapshot and acks before it
                // returns. A held operation or unacked queue is not "synced".
                let pending = report
                    .get("pending")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| {
                        Failure::new(4, "protocol", "sync.pass senza pending durevole")
                    })?;
                let held = report
                    .get("held")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| Failure::new(4, "protocol", "sync.pass senza held durevole"))?;
                if pending != 0 || held != 0 {
                    let failure = Failure::new(
                        5,
                        "conflict",
                        format!("sync incompleto: {pending} in coda, {held} trattenuti"),
                    );
                    if interval.is_none() {
                        return Err(failure);
                    }
                    failures = failures.saturating_add(1);
                    print(&super::output::envelope_err(
                        failure.kind,
                        &failure.message,
                        failure.code,
                    ));
                    super::pause_or_interrupt(std::time::Duration::from_secs(
                        interval
                            .unwrap_or_default()
                            .as_secs()
                            .saturating_mul(1u64 << failures.min(5))
                            .min(300),
                    ))?;
                    continue;
                }
                failures = 0;
                tick += 1;
                if interval.is_some() {
                    let mut report = report;
                    report["tick"] = serde_json::json!(tick.to_string());
                    print(&envelope_ok(report));
                    super::pause_or_interrupt(interval.unwrap_or_default())?;
                } else {
                    print(&envelope_ok(report));
                    return Ok(());
                }
            }
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PublishCursor {
    v: u8,
    fingerprint: String,
    live_version: String,
}

fn publish_cursor_path(global: &GlobalArgs, site: &str) -> Result<std::path::PathBuf, Failure> {
    if !fub_host::publish::site::valid_site_id(site) {
        return Err(Failure::bad_args("site non valido"));
    }
    super::local::config_path(global, &format!("publish-watch-{site}.json"))
}

fn read_publish_cursor(global: &GlobalArgs, site: &str) -> Result<Option<PublishCursor>, Failure> {
    let path = publish_cursor_path(global, site)?;
    #[cfg(unix)]
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        use std::os::unix::fs::PermissionsExt;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(Failure::new(5, "recovery", "publish cursor non sicuro"));
        }
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(Failure::local(format!("publish cursor: {error}"))),
    };
    let cursor: PublishCursor = serde_json::from_slice(&bytes)
        .map_err(|_| Failure::new(5, "recovery", "publish cursor non valido"))?;
    if cursor.v != 1
        || cursor.fingerprint.len() != 64
        || cursor.live_version.parse::<u64>().is_err()
    {
        return Err(Failure::new(
            5,
            "recovery",
            "publish cursor versione non supportata",
        ));
    }
    Ok(Some(cursor))
}

fn publish_fingerprint(connection: &Connection) -> Result<String, Failure> {
    let mut digest = ring::digest::Context::new(&ring::digest::SHA256);
    let mut offset = 0u32;
    loop {
        let result = connection
            .host
            .query_index(
                connection.vault_selector(),
                fub_abi::IndexQuery::Entries {
                    of_kind: None,
                    within: None,
                    page: Some(fub_abi::Page::new(offset, 128)),
                },
            )
            .map_err(|error| Failure::from_plugin(&error))?;
        let fub_abi::IndexResult::Entries(page) = result else {
            return Err(Failure::new(4, "protocol", "publish entries senza pagina"));
        };
        if page.items.is_empty() && offset < page.total {
            return Err(Failure::new(4, "protocol", "publish entries incompleti"));
        }
        let count = page.items.len() as u32;
        for entry in page.items {
            if entry.id.as_str().starts_with(".fub/") {
                continue;
            }
            let path = entry.id.as_str().as_bytes();
            digest.update(&(path.len() as u64).to_le_bytes());
            digest.update(path);
            digest.update(&entry.size.to_le_bytes());
            digest.update(&entry.mtime.to_le_bytes());
            if let Some(revision) = entry.fingerprint {
                digest.update(revision.as_str().as_bytes());
            }
            if entry.id.as_str().ends_with(".md") {
                let (source, _) = connection
                    .host
                    .read_document(connection.vault_selector(), &entry.id)
                    .map_err(|error| Failure::from_plugin(&error))?;
                digest.update(&(source.len() as u64).to_le_bytes());
                digest.update(source.as_bytes());
            }
        }
        offset = offset
            .checked_add(count)
            .ok_or_else(|| Failure::local("publish entries overflow"))?;
        if offset >= page.total {
            break;
        }
    }
    Ok(digest
        .finish()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn publish_commit(
    connection: &Connection,
    client: &fub_host::publish::site::PublishClient,
    site: &str,
) -> Result<(serde_json::Value, String), Failure> {
    connection
        .host
        .invoke_job(
            connection.vault_selector(),
            "fub.publish",
            "publish.pass",
            serde_json::json!({ "site_id": site, "op": "dry-run" }),
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    let result = connection
        .host
        .invoke_job(
            connection.vault_selector(),
            "fub.publish",
            "publish.pass",
            serde_json::json!({ "site_id": site, "op": "commit" }),
        )
        .map_err(|error| Failure::from_plugin(&error))?;
    let prefix = format!("published {site} v");
    let version = result
        .get("message")
        .and_then(|m| m.as_str())
        .and_then(|m| m.strip_prefix(&prefix))
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|_| result.get("ok").and_then(|v| v.as_bool()) == Some(true))
        .ok_or_else(|| Failure::new(4, "protocol", "publish job senza versione impegnata"))?;
    let status = client.status(site).map_err(map_publish_err)?;
    if status.live_version != Some(version) {
        return Err(Failure::new(
            5,
            "conflict",
            "publish versione remota diversa dal commit",
        ));
    }
    Ok((result, version.to_string()))
}
pub fn publish_cmd(
    connection: &Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: PublishArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    use fub_host::publish::site;
    if matches!(
        &args.action,
        PublishAction::Commit {
            version: Some(_),
            ..
        }
    ) {
        return Err(Failure::bad_args(
            "publish --version esplicita non è supportata dal job atomico; ometti --version",
        ));
    }
    // publish.server_url via the existing Settings query channel (machine
    // scope included, no vault required): empty/missing = MissingConfiguration.
    let setting_url = setting_url(connection, "publish.server_url")?;
    let client =
        site::PublishClient::from_env_with_setting(&setting_url, &token_source(connection))
            .map_err(map_publish_err)?;
    match args.action {
        PublishAction::Status { site } => {
            let status = client.status(&site).map_err(map_publish_err)?;
            print(&envelope_ok(serde_json::json!({
                "site_id": status.site_id,
                "live_version": status.live_version.map(|version| version.to_string()),
                "versions": status.versions.iter().map(u64::to_string).collect::<Vec<_>>(),
                "page_count": status.page_count,
                "asset_count": status.asset_count,
                "password_protected": status.password_protected,
            })));
            Ok(())
        }
        PublishAction::DryRun { site } => {
            let preview = connection
                .host
                .invoke_job(
                    connection.vault_selector(),
                    "fub.publish",
                    "publish.pass",
                    serde_json::json!({ "site_id": site, "op": "dry-run" }),
                )
                .map_err(|error| Failure::from_plugin(&error))?;
            print(&envelope_ok(
                serde_json::json!({ "site_id": site, "preview": preview }),
            ));
            Ok(())
        }
        PublishAction::Commit { site, .. } => {
            if global.dry_run {
                let preview = connection
                    .host
                    .invoke_job(
                        connection.vault_selector(),
                        "fub.publish",
                        "publish.pass",
                        serde_json::json!({ "site_id": site, "op": "dry-run" }),
                    )
                    .map_err(|error| Failure::from_plugin(&error))?;
                print(&envelope_ok(serde_json::json!({
                    "dry_run": true, "site_id": site, "preview": preview,
                })));
                return Ok(());
            }
            let (committed, version) = publish_commit(connection, &client, &site)?;
            if super::interrupted() {
                return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
            }
            print(&envelope_ok(
                serde_json::json!({ "site_id": site, "version": version, "result": committed }),
            ));
            Ok(())
        }
        PublishAction::Watch {
            site,
            interval_secs,
        } => {
            let interval = std::time::Duration::from_secs(interval_secs.max(1));
            let mut cursor = read_publish_cursor(global, &site)?;
            let mut failures = 0u32;
            let mut tick = 0u64;
            if let Some(saved) = cursor.as_ref() {
                let status = client.status(&site).map_err(map_publish_err)?;
                if status.live_version.map(|v| v.to_string()).as_deref()
                    != Some(saved.live_version.as_str())
                {
                    return Err(Failure::new(
                        5,
                        "conflict",
                        "publish cursor non coincide con il sito remoto; risolvere manualmente",
                    ));
                }
            }
            loop {
                if super::interrupted() {
                    return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
                }
                let attempt = (|| -> Result<Option<(serde_json::Value, String)>, Failure> {
                    let fingerprint = publish_fingerprint(connection)?;
                    if cursor
                        .as_ref()
                        .is_some_and(|saved| saved.fingerprint == fingerprint)
                    {
                        return Ok(None);
                    }
                    if global.dry_run {
                        let preview = connection
                            .host
                            .invoke_job(
                                connection.vault_selector(),
                                "fub.publish",
                                "publish.pass",
                                serde_json::json!({ "site_id": site, "op": "dry-run" }),
                            )
                            .map_err(|error| Failure::from_plugin(&error))?;
                        return Ok(Some((
                            serde_json::json!({ "dry_run": true, "preview": preview }),
                            fingerprint,
                        )));
                    }
                    let (result, version) = publish_commit(connection, &client, &site)?;
                    let next = PublishCursor {
                        v: 1,
                        fingerprint,
                        live_version: version.clone(),
                    };
                    let bytes = serde_json::to_vec(&next)
                        .map_err(|e| Failure::local(format!("publish cursor: {e}")))?;
                    super::local::save_owner_file(&publish_cursor_path(global, &site)?, &bytes)?;
                    cursor = Some(next);
                    Ok(Some((
                        serde_json::json!({ "version": version, "result": result }),
                        version,
                    )))
                })();
                match attempt {
                    Ok(Some((report, _))) => {
                        if super::interrupted() {
                            return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
                        }
                        failures = 0;
                        tick += 1;
                        print(&envelope_ok(
                            serde_json::json!({ "site_id": site, "tick": tick.to_string(), "report": report }),
                        ));
                        if global.dry_run {
                            return Ok(());
                        }
                    }
                    Ok(None) => {
                        failures = 0;
                    }
                    Err(failure) if matches!(failure.code, 3 | 5) => {
                        failures = failures.saturating_add(1);
                        print(&super::output::envelope_err(
                            failure.kind,
                            &failure.message,
                            failure.code,
                        ));
                        super::pause_or_interrupt(std::time::Duration::from_secs(
                            interval_secs
                                .max(1)
                                .saturating_mul(1u64 << failures.min(5))
                                .min(300),
                        ))?;
                        continue;
                    }
                    Err(failure) => return Err(failure),
                }
                super::pause_or_interrupt(interval)?;
            }
        }
        PublishAction::Unpublish { site } => {
            if global.dry_run {
                print(&envelope_ok(
                    serde_json::json!({ "site_id": site, "dry_run": true, "would_unpublish": true }),
                ));
                return Ok(());
            }
            let done = client.unpublish(&site).map_err(map_publish_err)?;
            print(&envelope_ok(serde_json::json!({
                "site_id": site,
                "unpublished": done,
            })));
            Ok(())
        }
        PublishAction::Rollback { site, to_version } => {
            let to_version = to_version
                .ok_or_else(|| Failure::bad_args("publish rollback vuole --to-version N"))?;
            if global.dry_run {
                print(&envelope_ok(serde_json::json!({
                    "site_id": site, "dry_run": true, "would_rollback_to": to_version.to_string(),
                })));
                return Ok(());
            }
            let version = client
                .rollback(&site, to_version)
                .map_err(map_publish_err)?;
            print(&envelope_ok(serde_json::json!({
                "site_id": site,
                "version": version.to_string(),
            })));
            Ok(())
        }
    }
}
