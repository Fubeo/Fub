//! I comandi dell'host (cestino, montaggi, cartelle, fotografie): specifiche e invocazione.

use super::*;

pub(super) const OS_TRASH_COMMAND: &str = "trash.os";

pub(super) const MOUNT_ADD: &str = "mount.add";

pub(super) const MOUNT_REMOVE: &str = "mount.remove";

pub(super) const MOUNT_LIST: &str = "mount.list";

pub(super) const FOLDER_CREATE: &str = "folder.create";

pub(super) const SNAPSHOT_CREATE: &str = "vault.snapshot.create";

pub(super) const SNAPSHOT_APPLY: &str = "vault.snapshot.apply";

/// I comandi che l'host esegue in proprio: il kernel li riserva al mount
/// (`Workspace::reserve_host_commands`), così un plugin che li invoca sente che
/// non sono suoi da chiamare e nessun provider ne registra un omonimo.
pub(crate) const HOST_COMMANDS: [&str; 15] = [
    OS_TRASH_COMMAND,
    MOUNT_ADD,
    MOUNT_REMOVE,
    MOUNT_LIST,
    FOLDER_CREATE,
    SNAPSHOT_CREATE,
    SNAPSHOT_APPLY,
    crate::capture::CAPTURE_APPLY,
    crate::web_clip::WEB_CLIP,
    crate::export_folder::EXPORT_FOLDER,
    crate::obsidian_import::OBSIDIAN_IMPORT,
    crate::connector_tokens::CONNECTOR_TOKEN,
    crate::connector_tokens::CONNECTOR_TOKENS,
    crate::uri_inbox::URI_PENDING,
    crate::uri_inbox::URI_APPLY,
];

/// Lo stesso catalogo host-owned serve l'elenco e la scelta del dispatcher.
pub(super) fn mount_specs() -> [CommandSpec; 3] {
    [
        CommandSpec::new(MOUNT_ADD, Text::key("host.mount.add.title"))
            .describing(Text::key("host.mount.add.desc"))
            .with_param(
                ParamSpec::new("name", Text::key("host.param.name"), ParamKind::Text).required(),
            )
            .with_param(
                ParamSpec::new(
                    "target",
                    Text::key("host.param.absolute_folder"),
                    ParamKind::Text,
                )
                .required(),
            )
            .with_param(
                ParamSpec::new(
                    "namespace",
                    Text::key("host.param.namespace"),
                    ParamKind::Text,
                )
                .required(),
            )
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(MOUNT_REMOVE, Text::key("host.mount.remove.title"))
            .describing(Text::key("host.mount.remove.desc"))
            .with_param(
                ParamSpec::new("name", Text::key("host.param.name"), ParamKind::Text).required(),
            )
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(MOUNT_LIST, Text::key("host.mount.list.title"))
            .describing(Text::key("host.mount.list.desc")),
    ]
}

pub(super) fn mount_io_error(error: std::io::Error) -> PluginError {
    let message = error.to_string().into();
    match error.kind() {
        std::io::ErrorKind::AlreadyExists => PluginError::AlreadyExists(message),
        std::io::ErrorKind::NotFound => PluginError::NotFound(message),
        std::io::ErrorKind::PermissionDenied => PluginError::PermissionDenied(message),
        _ => PluginError::Io(message),
    }
}

/// Una cartella vuota è struttura del vault, non un documento: nessun provider
/// la possiede, quindi il comando sta con gli altri host-owned e passa dal
/// `Guard` come la cestinatura.
pub(super) fn folder_create_spec() -> CommandSpec {
    CommandSpec::new(FOLDER_CREATE, Text::key("host.folder.title"))
        .describing(Text::key("host.folder.desc"))
        .with_param(
            ParamSpec::new("path", Text::key("host.param.folder"), ParamKind::Text).required(),
        )
        .with_scope(CommandScope::writing(CommandReach::Vault))
}

/// Lo snapshot completo offline (on-disk-layout, «Snapshot globale offline»).
/// Sono dell'host perché chiudono e riaprono la sessione: nessun provider
/// può farlo, e nessuno dei due passa con il vault aperto.
pub(super) fn snapshot_specs() -> [CommandSpec; 2] {
    [
        CommandSpec::new(SNAPSHOT_CREATE, Text::key("host.snapshot.create.title"))
            .describing(Text::key("host.snapshot.create.desc"))
            .with_param(
                ParamSpec::new(
                    "target",
                    Text::key("host.param.snapshot_target"),
                    ParamKind::Text,
                )
                .required(),
            )
            .with_scope(CommandScope::writing(CommandReach::Vault)),
        CommandSpec::new(SNAPSHOT_APPLY, Text::key("host.snapshot.apply.title"))
            .describing(Text::key("host.snapshot.apply.desc"))
            .with_param(
                ParamSpec::new(
                    "source",
                    Text::key("host.param.snapshot_source"),
                    ParamKind::Text,
                )
                .required(),
            )
            .with_param(
                ParamSpec::new(
                    "backup",
                    Text::key("host.param.snapshot_backup"),
                    ParamKind::Text,
                )
                .required(),
            )
            .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
    ]
}

/// Una cartella esterna **nuova** per uno snapshot: path assoluto, genitore
/// esistente, nome libero e fuori dal vault (anche attraverso symlink del
/// genitore, che si risolve prima del confronto).
pub(crate) fn new_outside_folder(root: &Utf8Path, raw: &str) -> Result<Utf8PathBuf, PluginError> {
    let path = Utf8Path::new(raw.trim());
    if !path.is_absolute() {
        return Err(PluginError::BadArgs(path_text(
            "host.path.not_absolute",
            path,
        )));
    }
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(PluginError::BadArgs(path_text("host.path.invalid", path)));
    };
    if !parent.is_dir() {
        return Err(PluginError::NotFound(path_text(
            "host.path.missing_parent",
            parent,
        )));
    }
    let destination = canonical(parent)?.join(name);
    if std::fs::symlink_metadata(destination.as_std_path()).is_ok() {
        return Err(PluginError::AlreadyExists(path_text(
            "host.path.exists",
            &destination,
        )));
    }
    if destination.starts_with(root) {
        return Err(PluginError::BadArgs(path_text(
            "host.path.inside_vault",
            &destination,
        )));
    }
    Ok(destination)
}

/// Una frase del catalogo del core che nomina un path.
pub(super) fn path_text(key: &str, path: &Utf8Path) -> Text {
    Text::message(key, vec![Arg::text("path", path.as_str())])
}

/// Uno snapshot da leggere: path assoluto di una cartella fuori dal vault.
pub(super) fn snapshot_source(root: &Utf8Path, raw: &str) -> Result<Utf8PathBuf, PluginError> {
    let path = Utf8Path::new(raw.trim());
    if !path.is_absolute() || !path.is_dir() {
        return Err(PluginError::NotFound(path_text(
            "host.snapshot.unreadable",
            path,
        )));
    }
    let source = canonical(path)?;
    if source.starts_with(root) {
        return Err(PluginError::BadArgs(path_text(
            "host.path.inside_vault",
            &source,
        )));
    }
    Ok(source)
}

pub(super) fn snapshot_error(error: fub_kernel::snapshot::SnapshotError) -> PluginError {
    use fub_kernel::snapshot::SnapshotError as E;
    let message = error.to_string().into();
    match error {
        E::BaseRevisionStale { .. } | E::AlreadyExists(_) | E::RecoveryNeeded { .. } => {
            PluginError::Conflict(message)
        }
        E::FutureSchema { .. } => PluginError::Unserved(message),
        E::Io { .. } => PluginError::Io(message),
        _ => PluginError::BadArgs(message),
    }
}

pub(super) fn snapshot_host_error(error: SnapshotHostError) -> PluginError {
    match error {
        SnapshotHostError::Snapshot(error) => snapshot_error(error),
        SnapshotHostError::Lifecycle(error) | SnapshotHostError::Reopen(error) => error,
    }
}

/// La tabella delle rotte in una frase: nome e cartella di ognuna, e le
/// cartelle configurate che non si raggiungono. Nessuna rotta è una frase sua.
pub(super) fn mount_listing(
    routes: &[fub_kernel::MountRoute],
    diagnostics: &[fub_kernel::MountDiagnostic],
) -> Text {
    let routes = routes
        .iter()
        .map(|route| format!("{} ({})", route.name, route.target))
        .collect::<Vec<_>>()
        .join(", ");
    let faulty = diagnostics
        .iter()
        .map(|problem| format!("{} ({})", problem.name, problem.message))
        .collect::<Vec<_>>()
        .join(", ");
    match (routes.is_empty(), faulty.is_empty()) {
        (true, true) => Text::key("host.mount.listed.none"),
        (false, true) => Text::message("host.mount.listed", vec![Arg::text("routes", routes)]),
        (true, false) => Text::message(
            "host.mount.listed.only_faulty",
            vec![Arg::text("faulty", faulty)],
        ),
        (false, false) => Text::message(
            "host.mount.listed.faulty",
            vec![Arg::text("routes", routes), Arg::text("faulty", faulty)],
        ),
    }
}

/// Unica dichiarazione della porta host-owned: elencazione e dispatch usano
/// questa stessa spec, mentre l'IPC Tauri resta `invoke_command`.
pub(super) fn os_trash_spec() -> CommandSpec {
    CommandSpec::new(OS_TRASH_COMMAND, Text::key("host.trash_os.title"))
        .describing(Text::key("host.trash_os.desc"))
        .with_param(
            ParamSpec::new("doc", Text::key("host.param.doc"), ParamKind::Document).required(),
        )
        .with_scope(CommandScope::writing(CommandReach::Document))
}

/// L'esito di `trash.os`. Il ripiego sul cestino interno si **dice**, nel
/// `notify`, perché chi ha scelto il cestino di sistema cercherebbe la nota
/// lì: la palette e la shell mostrano la stessa frase, senza leggere l'effetto.
pub(super) fn os_trash_outcome(receipt: OsTrashReceipt) -> CommandOutcome {
    let notify = matches!(receipt.via, TrashVia::InternalFallback { .. }).then(|| {
        Text::message(
            "host.trash_os.fallback",
            vec![Arg::text("doc", receipt.id.as_str())],
        )
    });
    let via = match receipt.via {
        TrashVia::Os => serde_json::json!({ "kind": "os" }),
        TrashVia::InternalFallback { reason } => serde_json::json!({
            "kind": "internal_fallback",
            "reason": match reason {
                FallbackReason::Unsupported => "unsupported",
                FallbackReason::Unavailable => "unavailable",
            }
        }),
    };
    let outcome = match notify {
        Some(message) => CommandOutcome::notify(message),
        None => CommandOutcome::done(),
    };
    outcome.with_effect(CommandEffect::Custom {
        ns: "fub.trash.os".into(),
        payload: serde_json::json!({
            "doc": receipt.id,
            "destination": receipt.dest,
            "bytes": receipt.size,
            "via": via,
        }),
    })
}

/// `folder.create`: preflight del kernel e del `Guard` anche a vuoto, poi la
/// creazione sotto il turno di scrittura con gli eventi drenati dopo.
pub(super) fn invoke_folder_create(
    workspace: &Custody<Workspace>,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    folder_create_spec().validate_args(&args)?;
    let name = args["path"].as_str().expect("spec validata");
    let authorize = |ws: &Workspace, folder: &str| {
        authorize_path(
            &ws.granted_policy(crate::settings::CORE_ID),
            Capability::VaultStructure,
            folder,
            || format!("creating folder `{folder}`"),
        )
    };
    if mode.is_dry_run() {
        let ws = workspace.read()?;
        let folder = ws.check_new_folder(name).map_err(PluginError::from)?;
        authorize(&ws, folder.as_str())?;
        let plan = CommandPlan::of_edits(
            Text::message(
                "host.folder.plan",
                vec![Arg::text("folder", folder.as_str())],
            ),
            Vec::new(),
        );
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    let made = with_event_drain(workspace, |ws| {
        let folder = ws.check_new_folder(name).map_err(PluginError::from)?;
        authorize(ws, folder.as_str())?;
        ws.create_folder(folder.as_str()).map_err(PluginError::from)
    })??;
    Ok(CommandOutcome::notify(Text::message(
        "host.folder.done",
        vec![Arg::text("folder", made.as_str())],
    ))
    .with_effect(CommandEffect::Custom {
        ns: "fub.folder.created".into(),
        payload: serde_json::json!({ "path": made }),
    }))
}
