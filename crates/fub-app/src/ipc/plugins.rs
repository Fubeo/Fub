//! Comandi IPC dei plugin installati, del catalogo firmato e della modalità limitata.

use super::*;

pub(crate) enum InstalledAvailability {
    Ready(Arc<InstalledPluginManager>),
    NotConfigured,
    Failed(PluginError),
}

pub(crate) struct InstalledPlugins {
    pub(crate) availability: InstalledAvailability,
}

impl InstalledPlugins {
    pub(crate) fn new(availability: InstalledAvailability) -> Self {
        Self { availability }
    }

    pub(crate) fn manager(&self) -> Result<Arc<InstalledPluginManager>, PluginError> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => Ok(manager.clone()),
            InstalledAvailability::NotConfigured => Err(PluginError::Unserved(
                "installed plugin storage is unavailable without a machine configuration path"
                    .into(),
            )),
            InstalledAvailability::Failed(error) => Err(error.clone()),
        }
    }

    pub(crate) fn manager_for_legacy(&self) -> Option<Arc<InstalledPluginManager>> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => Some(manager.clone()),
            InstalledAvailability::NotConfigured | InstalledAvailability::Failed(_) => None,
        }
    }

    pub(crate) fn begin_shutdown(&self) -> Result<Option<InstalledShutdown>, PluginError> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => manager.begin_shutdown().map(Some),
            InstalledAvailability::NotConfigured | InstalledAvailability::Failed(_) => Ok(None),
        }
    }
}

pub(crate) async fn run_installed<T, F>(app: AppHandle, action: F) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&InstalledOperation, &Host) -> Result<T, PluginError> + Send + 'static,
{
    let installed = app.state::<InstalledPlugins>();
    let manager = installed.manager()?;
    let operation = manager.begin_operation()?;

    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        action(&operation, &host)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(
            format!("installed plugin operation did not complete: {error}").into(),
        )
    })?
}

/// Catalog trust is selected only by the machine's configuration directory.
/// No IPC argument names a key, feed, trust path, or remote endpoint.
pub(crate) struct CatalogConfig(pub(crate) Option<Utf8PathBuf>);

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MachineCatalogTrust {
    pub(crate) keys: BTreeMap<String, String>,
    pub(crate) min_generation: String,
}

/// L'errore dell'host come lo legge la shell: nella sua lingua. Dentro l'host
/// un errore può restare una chiave del catalogo del core, e sul filo JSON una
/// chiave non risolta è un oggetto, non una frase
/// ([`Host::localized_error`]).
pub(crate) fn for_the_shell<T>(
    host: &Host,
    vault: Option<&str>,
    result: Result<T, PluginError>,
) -> Result<T, PluginError> {
    result.map_err(|error| host.localized_error(vault, error))
}

pub(crate) fn bounded_config(path: &Utf8Path, limit: u64) -> Result<Vec<u8>, PluginError> {
    let file = std::fs::File::open(path).map_err(|error| {
        PluginError::Io(format!("catalog machine configuration unreadable: {error}").into())
    })?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            PluginError::Io(format!("catalog machine configuration unreadable: {error}").into())
        })?;
    if bytes.len() as u64 > limit {
        return Err(PluginError::BadArgs(
            "catalog configuration exceeds its size limit".into(),
        ));
    }
    Ok(bytes)
}

pub(crate) fn machine_catalog(
    config: Option<&Utf8Path>,
) -> Result<(CatalogTrust, SignedFeed), PluginError> {
    let dir =
        config.ok_or_else(|| PluginError::Unserved("catalog trust is not configured".into()))?;
    let trust_path = dir.join("catalog-trust.json");
    let bytes = match bounded_config(&trust_path, 64 * 1024) {
        Err(PluginError::Io(_)) if !trust_path.exists() => {
            return Err(PluginError::Unserved(
                "catalog trust is not configured".into(),
            ));
        }
        other => other?,
    };
    let configured: MachineCatalogTrust = serde_json::from_slice(&bytes).map_err(|error| {
        PluginError::BadArgs(format!("invalid machine catalog trust: {error}").into())
    })?;
    if configured.keys.is_empty() {
        return Err(PluginError::Unserved(
            "catalog trust has no configured keys".into(),
        ));
    }
    let min_generation = parse_installation(&configured.min_generation)?;
    let mut trust = CatalogTrust {
        min_generation,
        ..CatalogTrust::default()
    };
    for (id, key) in configured.keys {
        trust = trust.with_key(id, &key).map_err(catalog_error)?;
    }
    // Acquisition is local and explicit: the operator provisions this file,
    // and a catalog_* command reads it. Never fetch a feed on startup.
    let feed_path = dir.join("catalog-feed.json");
    let feed: SignedFeed = serde_json::from_slice(&bounded_config(&feed_path, 4 * 1024 * 1024)?)
        .map_err(|error| {
            PluginError::BadArgs(format!("invalid signed catalog feed: {error}").into())
        })?;
    Ok((trust, feed))
}

pub(crate) fn catalog_error(error: CatalogError) -> PluginError {
    match error {
        CatalogError::Manager(error) => error,
        CatalogError::Signature(message) => PluginError::PermissionDenied(message.into()),
        CatalogError::Stale(message) | CatalogError::Integrity(message) => {
            PluginError::Conflict(message.into())
        }
        CatalogError::Unavailable(message) => PluginError::Unserved(message.into()),
        CatalogError::Invalid(message) | CatalogError::Unreadable(message) => {
            PluginError::BadArgs(message.into())
        }
        CatalogError::Io(error) => PluginError::Io(error.to_string().into()),
        CatalogError::Store(error) => PluginError::Io(error.to_string().into()),
        CatalogError::Theme(error) => PluginError::Io(error.to_string().into()),
    }
}

pub(crate) async fn run_catalog<T, F>(app: AppHandle, action: F) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(
            &InstalledPluginManager,
            &Host,
            &CatalogTrust,
            &SignedFeed,
            u64,
        ) -> Result<T, CatalogError>
        + Send
        + 'static,
{
    let manager = app.state::<InstalledPlugins>().manager()?;
    let dir = app.state::<CatalogConfig>().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (trust, feed) = machine_catalog(dir.as_deref())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| {
                PluginError::Internal(format!("invalid system clock: {error}").into())
            })?
            .as_millis()
            .try_into()
            .map_err(|_| {
                PluginError::Internal("system clock exceeds catalog timestamp range".into())
            })?;
        action(&manager, &app.state::<Host>(), &trust, &feed, now).map_err(catalog_error)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(format!("catalog operation did not complete: {error}").into())
    })?
}

pub(crate) fn parse_installation(installation: &str) -> Result<u64, PluginError> {
    if installation.is_empty() || !installation.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PluginError::BadArgs(
            format!("invalid installation id: `{installation}`").into(),
        ));
    }
    installation.parse::<u64>().map_err(|_| {
        PluginError::BadArgs(format!("invalid installation id: `{installation}`").into())
    })
}

#[tauri::command]
pub(crate) async fn list_installed_plugins(
    app: AppHandle,
    vault: Option<String>,
) -> Result<Vec<InstalledPluginInfo>, PluginError> {
    run_installed(app, move |manager, host| {
        manager.list(host, vault.as_deref())
    })
    .await
}

#[tauri::command]
pub(crate) async fn install_plugin(
    app: AppHandle,
    path: String,
) -> Result<InstalledPluginInfo, PluginError> {
    run_installed(app, move |manager, _host| {
        manager.install(&Utf8PathBuf::from(path))
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_installed_plugin_enabled(
    app: AppHandle,
    installation: String,
    enabled: bool,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| {
        manager.set_enabled(host, installation, enabled)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_installed_plugin_consent(
    app: AppHandle,
    installation: String,
    consent: Consent,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| {
        manager.set_consent(host, installation, consent)
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_installed_plugin(
    app: AppHandle,
    installation: String,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| manager.remove(host, installation)).await
}

#[derive(serde::Serialize)]
pub(crate) struct CatalogChange {
    pub(crate) plugin: InstalledPluginInfo,
    pub(crate) diagnostics: Vec<PluginError>,
}

#[tauri::command]
pub(crate) async fn catalog_search(
    app: AppHandle,
    needle: String,
) -> Result<Vec<CatalogEntry>, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager.catalog_search(trust, feed, now, &needle)
    })
    .await
}

/// L'artefatto scelto per il catalogo si legge come la sorgente di
/// un'installazione diretta: file regolare, nessun symlink, tetto di byte.
pub(crate) fn catalog_artifact(source: &str) -> Result<Vec<u8>, CatalogError> {
    Ok(fub_wasm_host::installed::read_source_file(Utf8Path::new(
        source,
    ))?)
}

#[tauri::command]
pub(crate) async fn catalog_install(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<InstalledPluginInfo, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        manager.catalog_install(trust, feed, now, &id, &version, &bytes)
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_update(
    app: AppHandle,
    installation: String,
    version: String,
    source: String,
) -> Result<CatalogChange, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        let (plugin, diagnostics) =
            manager.catalog_update(host, trust, feed, now, installation, &version, &bytes)?;
        Ok(CatalogChange {
            plugin,
            diagnostics,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_rollback(
    app: AppHandle,
    installation: String,
    prior_version: String,
    source: String,
) -> Result<CatalogChange, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        let (plugin, diagnostics) = manager.catalog_rollback(
            host,
            trust,
            feed,
            now,
            installation,
            &prior_version,
            &bytes,
        )?;
        Ok(CatalogChange {
            plugin,
            diagnostics,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_revoke(
    app: AppHandle,
    installation: String,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        manager.catalog_revoke(host, trust, feed, now, installation)
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_install_theme(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_install_theme(trust, feed, now, &id, &version, Utf8Path::new(&source))
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_update_theme(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_update_theme(trust, feed, now, &id, &version, Utf8Path::new(&source))
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_rollback_theme(
    app: AppHandle,
    id: String,
    prior_version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_rollback_theme(
                trust,
                feed,
                now,
                &id,
                &prior_version,
                Utf8Path::new(&source),
            )
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn catalog_revoke_theme(app: AppHandle, id: String) -> Result<(), PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager.catalog_revoke_theme(trust, feed, now, &id)
    })
    .await
}

#[tauri::command]
pub(crate) fn plugin_budget_snapshot(
    installed: State<InstalledPlugins>,
) -> Result<fub_wasm_host::budgets::BudgetSnapshot, PluginError> {
    installed.manager()?.process_budgets()
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct LimitedMode {
    pub(crate) enabled: bool,
    pub(crate) reason: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LimitedStartupChoice {
    pub(crate) enabled: bool,
    pub(crate) reason: Option<String>,
}

pub(crate) fn limited_startup(config: Option<&Utf8Path>) -> LimitedMode {
    let Some(dir) = config else {
        return LimitedMode {
            enabled: false,
            reason: None,
        };
    };
    let path = dir.join("installed-limited.json");
    // Soltanto un file che non c'è vale «avvio pieno». `exists` rispondeva
    // «non c'è» anche a una `stat` fallita, e la scelta illeggibile — che sotto
    // vale avvio limitato — riapriva i plugin installati.
    match path.as_std_path().try_exists() {
        Ok(false) => {
            return LimitedMode {
                enabled: false,
                reason: None,
            }
        }
        Ok(true) => {}
        Err(error) => {
            return LimitedMode {
                enabled: true,
                reason: Some(format!("invalid limited startup configuration: {error}")),
            }
        }
    }
    match bounded_config(&path, 4096).and_then(|bytes| {
        serde_json::from_slice::<LimitedStartupChoice>(&bytes).map_err(|error| {
            PluginError::BadArgs(format!("invalid limited startup configuration: {error}").into())
        })
    }) {
        Ok(choice) if choice.enabled => LimitedMode {
            enabled: true,
            reason: Some(
                choice
                    .reason
                    .filter(|reason| !reason.trim().is_empty())
                    .unwrap_or_else(|| "limited startup selected in machine configuration".into()),
            ),
        },
        Ok(_) => LimitedMode {
            enabled: false,
            reason: None,
        },
        Err(error) => LimitedMode {
            enabled: true,
            reason: Some(format!("invalid limited startup configuration: {error}")),
        },
    }
}

#[tauri::command]
pub(crate) fn plugin_limited_mode(mode: State<LimitedMode>) -> LimitedMode {
    mode.inner().clone()
}

/// Conserva il comando storico per i bundle ufficiali e nativi. Il manager
/// prende autorità soltanto quando il runtime selezionato appartiene al claim
/// installato; un record collidente o non noto continua sul percorso nativo.
#[tauri::command]
pub(crate) async fn set_plugin_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
    vault: Option<String>,
) -> Result<Vec<PluginError>, PluginError> {
    let installed = app.state::<InstalledPlugins>();
    let operation = installed
        .manager_for_legacy()
        .map(|manager| manager.begin_operation())
        .transpose()?;

    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        if let Some(operation) = operation {
            if let Some(errors) =
                operation.set_enabled_by_id(&host, vault.as_deref(), &id, enabled)?
            {
                return Ok(errors);
            }
        }
        host.set_plugin_enabled(vault.as_deref(), &id, enabled)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(format!("plugin toggle did not complete: {error}").into())
    })?
}
