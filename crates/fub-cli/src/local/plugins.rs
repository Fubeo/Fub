//! I plugin dal terminale: `plugin` e `native-install` (il manifest di
//! native messaging per i browser).

use crate::cli::{GlobalArgs, PluginArgs};
use crate::commands::{paginate, render_error_text, Connection, Failure};
use crate::output::envelope_ok;
use crate::output::OutputFormat;

use super::{config_path, confirm_write, dry_run, vault_required};

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

/// `native-install`: senza `--yes` dice dove scriverebbe e che cosa; con
/// `--yes` scrive il manifest per l'utente in ogni browser trovato (o in
/// quelli nominati da `--browser`), su Windows anche la chiave di registro.
/// `--uninstall` toglie ciò che ha scritto, mai un file d'altri.
pub fn native_install(
    global: &GlobalArgs,
    _format: &OutputFormat,
    extension_id: String,
    browsers: Vec<String>,
    uninstall: bool,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    use crate::native::{self, Browser, Dirs, Os};
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
    let family = native::id_family(&extension_id);
    let named: Vec<Browser> = browsers
        .iter()
        .map(|name| {
            Browser::parse(name).ok_or_else(|| {
                Failure::bad_args(format!(
                    "--browser `{name}` (chrome|chromium|edge|brave|vivaldi|firefox)"
                ))
            })
        })
        .collect::<Result<_, _>>()?;
    if let Some(wrong) = named.iter().find(|b| b.family() != family) {
        return Err(Failure::bad_args(format!(
            "l'id `{extension_id}` non è di un'estensione per {}: {}",
            wrong.name(),
            match family {
                native::Family::Chromium =>
                    "Firefox vuole l'id del manifest (es. clipper@fub.local)",
                native::Family::Firefox =>
                    "i browser Chromium vogliono le 32 lettere di chrome://extensions",
            }
        )));
    }
    let os = Os::current();
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .ok_or_else(|| Failure::local("nessuna cartella utente (HOME)"))?;
    let config = config_path(global, "clipper-pairing.json")?
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| Failure::local("nessuna config dir"))?;
    let dirs = Dirs {
        home,
        app_data: std::env::var_os("APPDATA").map(Into::into),
        local_app_data: std::env::var_os("LOCALAPPDATA").map(Into::into),
        config,
    };
    let explicit = !named.is_empty();
    let chosen: Vec<native::Target> = if explicit {
        named
    } else {
        Browser::ALL.to_vec()
    }
    .into_iter()
    .filter(|b| b.family() == family)
    .filter_map(|b| native::target(b, os, &dirs))
    // Senza nomi, soltanto i browser che ci sono: niente cartelle
    // inventate per programmi mai installati.
    .filter(|t| explicit || t.root.is_dir())
    .collect();
    let apply = global.yes && !global.dry_run;
    if apply && chosen.is_empty() {
        return Err(Failure::new(
            1,
            "not_found",
            "nessun browser trovato per questo id: nominalo con --browser",
        ));
    }
    if apply && !uninstall && !clipper_host.is_file() {
        return Err(Failure::new(
            1,
            "not_found",
            format!(
                "manca l'host nativo accanto alla CLI: {}",
                clipper_host.to_string_lossy()
            ),
        ));
    }
    let body = serde_json::to_vec_pretty(&native::manifest(family, &clipper_host, &extension_id))
        .map_err(|e| Failure::local(e.to_string()))?;
    let mut targets = Vec::new();
    let mut failed = false;
    for target in &chosen {
        let status = if !apply {
            if uninstall {
                "would_remove"
            } else {
                "would_write"
            }
            .to_string()
        } else {
            match native_apply(target, &body, uninstall) {
                Ok(status) => status.to_string(),
                Err(why) => {
                    failed = true;
                    format!("error: {why}")
                }
            }
        };
        targets.push(serde_json::json!({
            "browser": target.browser.name(),
            "manifest": target.manifest.to_string_lossy(),
            "registry": target.registry,
            "status": status,
        }));
    }
    let mut data = serde_json::json!({
        "extension_id": extension_id,
        "host": fub_host::automation::NM_HOST_NAME,
        "binary": clipper_host.to_string_lossy(),
        "applied": apply,
        "targets": targets,
        "chromium": native::manifest(native::Family::Chromium, &clipper_host, &extension_id),
        "firefox": native::manifest(native::Family::Firefox, &clipper_host, &extension_id),
    });
    if !apply {
        data["next"] = serde_json::json!(format!(
            "fub-cli --yes native-install --extension-id {extension_id}{}, poi fub-cli pair pair --extension-id {extension_id}",
            if uninstall { " --uninstall" } else { "" }
        ));
    }
    if failed {
        return Err(Failure::local(format!(
            "installazione incompleta: {}",
            serde_json::to_string(&data["targets"]).unwrap_or_default()
        )));
    }
    print(&envelope_ok(data));
    Ok(())
}

fn native_apply(
    target: &crate::native::Target,
    body: &[u8],
    uninstall: bool,
) -> Result<&'static str, String> {
    use crate::native;
    if !native::ours_or_absent(&target.manifest)? {
        return Ok("skipped_foreign");
    }
    if uninstall {
        let existed = target.manifest.exists();
        if existed {
            std::fs::remove_file(&target.manifest).map_err(|e| e.to_string())?;
        }
        if let Some(key) = &target.registry {
            // Una chiave che non c'è non è un errore: è già tolta.
            let _ = std::process::Command::new("reg")
                .args(["delete", key, "/f"])
                .output();
        }
        return Ok(if existed { "removed" } else { "absent" });
    }
    native::write_atomic(&target.manifest, body)?;
    if let Some(key) = &target.registry {
        let out = std::process::Command::new("reg")
            .args(["add", key, "/ve", "/t", "REG_SZ", "/d"])
            .arg(&target.manifest)
            .arg("/f")
            .output()
            .map_err(|e| format!("reg: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "reg add {key}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok("written")
}
