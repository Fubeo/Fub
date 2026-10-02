//! Backup locale del vault, nello spazio dati del plugin.
//!
//! Non è un backup fuori dal vault: `HostApi` non scrive oltre il recinto, e
//! `permission::EXTERNAL_FS` oggi non ha un consumatore. I byte stanno in
//! `.fub/plugins/fub.backup/<data>/…` (o `<data>.1/…`, vedi sotto), che il vault
//! non indicizza. Ripristino = `create_document` delle note che nel vault non ci
//! sono più.
//!
//! Il manifest `snapshots.json` è il punto di commit. Un backup copia le note
//! nella cartella del giorno che il manifest **non** nomina, poi riscrive il
//! manifest perché la nomini, e solo dopo cancella la cartella vecchia: un
//! guasto a metà copia lascia lo snapshot precedente intero, e la copia
//! interrotta si ripulisce al backup dopo. Un manifest di uno schema più recente
//! non si usa né si riscrive, e i campi che questa versione non conosce tornano
//! su disco come erano.
//!
//! Gli snapshot ruotano: dopo ogni backup riuscito restano i più recenti
//! [`BACKUP_KEEP_KEY`] (10 di serie, `0` li tiene tutti). Senza, crescevano
//! dentro il vault per sempre, e ognuno è una copia di tutte le note.

use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::civil_from_days;
use fub_abi::model::DocId;
use fub_abi::session::ContextMask;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiNode, ViewUpdate};
use serde::{Deserialize, Serialize};

/// Id del componente (spazio dati/registrazione).
pub const BACKUP_ID: &str = "fub.backup";
/// Id della `ViewSpec`.
pub const BACKUP_VIEW: &str = "backup";
/// Crea uno snapshot delle note.
pub const VAULT_BACKUP: &str = "vault.backup";
/// Ripristina le note mancanti da uno snapshot.
pub const VAULT_BACKUP_RESTORE: &str = "vault.backup.restore";

/// Quanti snapshot restano dopo un backup; `0` li tiene tutti.
pub const BACKUP_KEEP_KEY: &str = "backup.keep";
const KEEP_DEFAULT: f64 = 10.0;

const MANIFEST: &str = "snapshots.json";
/// Lo schema del manifest. La 2 dà a ogni snapshot la cartella dei suoi file
/// (`dir`); uno snapshot della 1 sta nella cartella col suo id.
const SCHEMA: u32 = 2;
const RUN: &str = "run";
const RESTORE: &str = "restore";
const ID: &str = "id";

const VIEW_TITLE: &str = "view_title";
const EMPTY: &str = "empty";
const RUN_LABEL: &str = "run_label";
const RESTORE_LABEL: &str = "restore_label";
const SNAPSHOT: &str = "snapshot";
const E_MISSING: &str = "e_missing";
const P_BACKUP: &str = "p_backup";
const P_RESTORE: &str = "p_restore";
const FAILED: &str = "failed";
const E_SCHEMA: &str = "e_schema";
const E_DIR: &str = "e_dir";
const S_GROUP: &str = "s_group";
const S_KEEP: &str = "s_keep";
const S_KEEP_DESC: &str = "s_keep_desc";

/// Lo schema delle impostazioni del backup: quanti snapshot tenere.
///
/// **Non** `program_writable`: abbassarla cancella snapshot al backup dopo, e
/// un componente che potesse farlo da sé potrebbe togliere di mezzo le copie
/// che l'utente conta di avere.
pub fn settings() -> Vec<SettingSpec> {
    vec![SettingSpec::new(
        BACKUP_KEEP_KEY,
        Text::key(S_KEEP),
        SettingKind::Number {
            default: KEEP_DEFAULT,
            min: Some(0.0),
            max: None,
        },
    )
    .describing(Text::key(S_KEEP_DESC))
    .grouped(Text::key(S_GROUP))]
}

/// Le stringhe del pannello e dei comandi.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Backup")
            .with(EMPTY, "Nessuno snapshot.")
            .with(RUN_LABEL, "Backup ora")
            .with(RESTORE_LABEL, "Ripristina")
            .with(SNAPSHOT, "{id} ({n} note)")
            .with(E_MISSING, "Nessuno snapshot «{id}».")
            .with(P_BACKUP, "Salvate {n} note in «{id}»")
            .with(P_RESTORE, "Ripristinate {n} note da «{id}»")
            .with(FAILED, "Backup: {reason}")
            .with(
                E_SCHEMA,
                "Gli snapshot sono di una versione più recente di Fub (schema \
                 {found}, questa arriva al {supported}): aggiorna Fub per usarli.",
            )
            .with(
                E_DIR,
                "Lo snapshot «{id}» nomina una cartella non sua: «{dir}».",
            )
            .with(S_GROUP, "Backup")
            .with(S_KEEP, "Snapshot da tenere")
            .with(
                S_KEEP_DESC,
                "Dopo ogni backup riuscito si cancellano gli snapshot più vecchi \
                 oltre questo numero. 0 li tiene tutti.",
            )
            .with("vault.backup.title", "Backup del vault")
            .with(
                "vault.backup.desc",
                "Copia le note nello spazio dati del plugin, per data.",
            )
            .with("vault.backup.restore.title", "Ripristina backup")
            .with(
                "vault.backup.restore.desc",
                "Ricrea le note dello snapshot che nel vault non ci sono più.",
            )
            .with("vault.backup.restore.id.title", "Id")
            .with(
                "vault.backup.restore.id.desc",
                "La data dello snapshot, YYYY-MM-DD.",
            ),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Backup")
            .with(EMPTY, "No snapshots.")
            .with(RUN_LABEL, "Back up now")
            .with(RESTORE_LABEL, "Restore")
            .with(SNAPSHOT, "{id} ({n} notes)")
            .with(E_MISSING, "No snapshot «{id}».")
            .with(P_BACKUP, "Saved {n} notes in «{id}»")
            .with(P_RESTORE, "Restored {n} notes from «{id}»")
            .with(FAILED, "Backup: {reason}")
            .with(
                E_SCHEMA,
                "The snapshots come from a newer Fub (schema {found}, this one \
                 reads up to {supported}): update Fub to use them.",
            )
            .with(
                E_DIR,
                "Snapshot «{id}» names a folder that is not its own: «{dir}».",
            )
            .with(S_GROUP, "Backup")
            .with(S_KEEP, "Snapshots to keep")
            .with(
                S_KEEP_DESC,
                "After each successful backup, the oldest snapshots beyond this \
                 number are deleted. 0 keeps them all.",
            )
            .with("vault.backup.title", "Back up vault")
            .with(
                "vault.backup.desc",
                "Copies notes into the plugin data space, keyed by date.",
            )
            .with("vault.backup.restore.title", "Restore backup")
            .with(
                "vault.backup.restore.desc",
                "Recreates snapshot notes that are no longer in the vault.",
            )
            .with("vault.backup.restore.id.title", "Id")
            .with(
                "vault.backup.restore.id.desc",
                "The snapshot date, YYYY-MM-DD.",
            ),
    ]
}

/// Il pannello degli snapshot.
pub struct BackupView;

impl ViewProvider for BackupView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            BACKUP_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("backup")
        .ordered(7)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            RUN => command_then_tree(host, VAULT_BACKUP, serde_json::json!({})),
            RESTORE => {
                let Some(id) = action.payload.get(ID).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                command_then_tree(host, VAULT_BACKUP_RESTORE, serde_json::json!({ ID: id }))
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn command_then_tree(
    host: &mut dyn HostApi,
    id: &str,
    args: serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
    match host.run_command(id, args) {
        Ok(_) => Ok(ViewUpdate::Replace {
            root: tree(host, None)?,
        }),
        Err(and) => Ok(ViewUpdate::Replace {
            root: tree(
                host,
                Some(Text::message(
                    FAILED,
                    vec![Arg::text("reason", and.to_string())],
                )),
            )?,
        }),
    }
}

fn tree(host: &dyn ReadApi, warning: Option<Text>) -> Result<UiNode, PluginError> {
    let store = load(host)?;
    let mut children = Vec::new();
    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }
    children.push(UiNode::button(
        Text::key(RUN_LABEL),
        Intent::Primary,
        ActionRef::new(RUN),
    ));
    if store.snapshots.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY)));
    } else {
        children.push(UiNode::list(
            store
                .snapshots
                .iter()
                .rev()
                .map(|s| {
                    let payload = serde_json::json!({ ID: s.id });
                    UiNode::keyed(
                        &s.id,
                        fub_abi::ui::UiKind::Stack {
                            dir: fub_abi::ui::Axis::Row,
                            gap: 1,
                            children: vec![
                                UiNode::list_item(
                                    Text::message(
                                        SNAPSHOT,
                                        vec![
                                            Arg::text(ID, s.id.clone()),
                                            Arg::int("n", s.n as i64),
                                        ],
                                    ),
                                    None,
                                    None,
                                ),
                                UiNode::button(
                                    Text::key(RESTORE_LABEL),
                                    Intent::Primary,
                                    ActionRef::with(RESTORE, payload),
                                ),
                            ],
                        },
                    )
                })
                .collect(),
        ));
    }
    Ok(UiNode::column(1, children))
}

/// I comandi `vault.backup` / `vault.backup.restore`.
pub struct BackupCommands;

impl CommandProvider for BackupCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            command(VAULT_BACKUP).with_scope(CommandScope::writing(CommandReach::Vault)),
            command(VAULT_BACKUP_RESTORE)
                .with_param(parameter(VAULT_BACKUP_RESTORE, ID, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            VAULT_BACKUP => backup(mode, host),
            VAULT_BACKUP_RESTORE => restore(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn command(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

fn backup(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let id = today(host);
    // Prima di tutto, anche in prova: un manifest che non si può riscrivere
    // ferma il backup prima che scriva qualcosa.
    let mut store = load(host)?;
    let docs = host.list_documents(None)?.items;
    let n = docs.len() as i64;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_BACKUP,
            vec![Arg::int("n", n), Arg::text(ID, &id)],
        )));
    }
    let current = store
        .snapshots
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.dir().to_owned());
    // La copia va nella cartella che il manifest non nomina: quella dello
    // snapshot di oggi resta intera finché il manifest non passa alla nuova.
    let dir = if current.as_deref() == Some(id.as_str()) {
        staging_dir(&id)
    } else {
        id.clone()
    };
    // Ciò che c'è già lì è una copia interrotta, o la cartella che l'ultimo
    // backup non ha finito di cancellare: nessuno snapshot la nomina.
    remove_dir(host, &dir)?;
    for doc in &docs {
        let src = host.read_document(doc)?;
        host.data_write(&format!("{dir}/{}", doc.as_str()), src.as_bytes())?;
    }
    if let Some(existing) = store.snapshots.iter_mut().find(|s| s.id == id) {
        existing.n = docs.len() as u32;
        existing.dir = Some(dir);
    } else {
        store.snapshots.push(Snapshot {
            id: id.clone(),
            n: docs.len() as u32,
            dir: Some(dir),
            rest: serde_json::Map::new(),
        });
    }
    let mut stale = rotate(&mut store, &id, keep(host));
    stale.extend(current);
    persist(host, &store)?;
    // Le cartelle che il manifest non nomina più si cancellano dopo: un errore
    // lascia file orfani, mai un manifest che nomina uno snapshot sparito.
    for old in &stale {
        remove_dir(host, old)?;
    }
    Ok(CommandOutcome::notify(Text::message(
        P_BACKUP,
        vec![Arg::int("n", n), Arg::text(ID, id)],
    )))
}

/// L'altra cartella dello snapshot di un giorno, per il backup che lo rifà.
fn staging_dir(id: &str) -> String {
    format!("{id}.1")
}

fn remove_dir(host: &mut dyn HostApi, dir: &str) -> Result<(), PluginError> {
    for path in host.data_list(dir)? {
        host.data_remove(&path)?;
    }
    Ok(())
}

fn restore(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let id = args
        .text(ID)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::message(E_MISSING, vec![Arg::text(ID, "")])))?
        .to_string();
    let store = load(host)?;
    let Some(snapshot) = store.snapshots.iter().find(|s| s.id == id) else {
        return Err(PluginError::BadArgs(Text::message(
            E_MISSING,
            vec![Arg::text(ID, &id)],
        )));
    };
    let dir = snapshot.dir();
    let files = host.data_list(dir)?;
    let existing: std::collections::BTreeSet<String> = host
        .list_documents(None)?
        .items
        .into_iter()
        .map(|d| d.0)
        .collect();
    let prefix = format!("{dir}/");
    let mut from_create: Vec<(DocId, String)> = Vec::new();
    for path in &files {
        let Some(rel) = path.strip_prefix(&prefix) else {
            continue;
        };
        if existing.contains(rel) {
            continue;
        }
        // Una copia che non si legge ferma il ripristino prima che crei
        // qualcosa: saltata, il ripristino riportava meno note dicendo di
        // esserci riuscito.
        let Some(bytes) = host.data_read(path)? else {
            continue;
        };
        if let Ok(src) = String::from_utf8(bytes) {
            from_create.push((DocId::new(rel), src));
        }
    }
    let n = from_create.len() as i64;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_RESTORE,
            vec![Arg::int("n", n), Arg::text(ID, &id)],
        )));
    }
    for (doc, src) in from_create {
        host.create_document(&doc, &src)?;
    }
    Ok(CommandOutcome::notify(Text::message(
        P_RESTORE,
        vec![Arg::int("n", n), Arg::text(ID, id)],
    )))
}

/// Quanti snapshot tenere, dall'impostazione; `0` = tutti.
fn keep(host: &dyn ReadApi) -> usize {
    host.setting(BACKUP_KEEP_KEY)
        .ok()
        .and_then(|value| value.as_number())
        .unwrap_or(KEEP_DEFAULT)
        .max(0.0) as usize
}

/// Toglie dal manifest gli snapshot oltre i `keep` più recenti per data, e
/// torna le loro cartelle. `fresh` è appena stato scritto e resta sempre, anche
/// se un orologio tornato indietro gli ha dato una data più vecchia degli altri.
fn rotate(store: &mut Store, fresh: &str, keep: usize) -> Vec<String> {
    if keep == 0 {
        return Vec::new();
    }
    let mut others: Vec<String> = store
        .snapshots
        .iter()
        .filter(|s| s.id != fresh)
        .map(|s| s.id.clone())
        .collect();
    // Gli id sono date `YYYY-MM-DD`: l'ordine del testo è quello del tempo.
    others.sort_unstable_by(|a, b| b.cmp(a));
    let dropped: Vec<String> = others.into_iter().skip(keep - 1).collect();
    let dirs = store
        .snapshots
        .iter()
        .filter(|s| dropped.contains(&s.id))
        .map(|s| s.dir().to_owned())
        .collect();
    store.snapshots.retain(|s| !dropped.contains(&s.id));
    dirs
}

fn today(host: &dyn ReadApi) -> String {
    let locale = host.user_locale();
    let civil = locale.to_civil_millis(host.now_unix_millis());
    let days = civil.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Il manifest. `rest` sono i campi che questa versione non conosce: tornano su
/// disco come erano, perché una versione che li ha scritti senza cambiare
/// schema ci conta.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Store {
    schema_version: u32,
    snapshots: Vec<Snapshot>,
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Snapshot {
    id: String,
    n: u32,
    /// La cartella dei file: l'id o [`staging_dir`]. Assente nello schema 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dir: Option<String>,
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

impl Snapshot {
    fn dir(&self) -> &str {
        self.dir.as_deref().unwrap_or(&self.id)
    }
}

/// Legge il manifest, o ne dà uno vuoto se non c'è.
///
/// Uno schema più recente si rifiuta per ogni uso, non soltanto per scrivere:
/// i suoi snapshot possono stare dove questa versione non guarda, e ripristinare
/// da lì ricreerebbe note sbagliate. Una cartella che non è dello snapshot si
/// rifiuta perché la rotazione la cancellerebbe.
fn load(host: &dyn ReadApi) -> Result<Store, PluginError> {
    let Some(bytes) = host.data_read(MANIFEST)? else {
        return Ok(Store {
            schema_version: SCHEMA,
            snapshots: Vec::new(),
            rest: serde_json::Map::new(),
        });
    };
    let store: Store = serde_json::from_slice(&bytes)
        .map_err(|and| PluginError::Internal(format!("{MANIFEST}: {and}").into()))?;
    if store.schema_version > SCHEMA {
        return Err(PluginError::Internal(Text::message(
            E_SCHEMA,
            vec![
                Arg::int("found", i64::from(store.schema_version)),
                Arg::int("supported", i64::from(SCHEMA)),
            ],
        )));
    }
    if let Some(stray) = store
        .snapshots
        .iter()
        .find(|s| s.dir() != s.id && s.dir() != staging_dir(&s.id))
    {
        return Err(PluginError::Internal(Text::message(
            E_DIR,
            vec![Arg::text(ID, &stray.id), Arg::text("dir", stray.dir())],
        )));
    }
    Ok(store)
}

/// Scrive il manifest nello schema di questa versione: uno della 1 vi rientra
/// senza perdere niente.
fn persist(host: &mut dyn HostApi, store: &Store) -> Result<(), PluginError> {
    let store = Store {
        schema_version: SCHEMA,
        ..store.clone()
    };
    let bytes = serde_json::to_vec_pretty(&store)
        .map_err(|and| PluginError::Internal(format!("{MANIFEST}: {and}").into()))?;
    host.data_write(MANIFEST, &bytes)
}
