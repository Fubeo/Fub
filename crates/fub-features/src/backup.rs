//! Backup locale del vault, nello spazio dati del plugin.
//!
//! Non è un backup fuori dal vault: `HostApi` non scrive oltre il recinto, e
//! `permission::EXTERNAL_FS` oggi non ha un consumatore. I byte stanno in
//! `.fub/plugins/fub.backup/<data>/…` (o `<data>.1/…`, vedi sotto), che il vault
//! non indicizza. Ripristino = i byte copiati dei documenti che nel vault non ci
//! sono più, scritti soltanto dove il nome è ancora libero.
//!
//! Si copiano **byte**, mai testo: un `.docx`, un PDF o una nota con un encoding
//! suo entrano nello snapshot come stanno sul disco. Un file che non si legge
//! non ferma il backup degli altri: si salta, e l'esito lo nomina con il
//! perché ([`Partial`]); uno snapshot a cui manca qualcosa non fa ruotare via
//! i più vecchi. E non toglie l'unica copia a nessuno: quella che lo snapshot
//! dello stesso giorno aveva di un file saltato passa nel nuovo, e se non si
//! rilegge lo snapshot del giorno resta com'era ([`carry_over`]).
//!
//! Il manifest `snapshots.json` è il punto di commit. Un backup copia le note
//! nella cartella del giorno che il manifest **non** nomina, poi riscrive il
//! manifest perché la nomini, e solo dopo cancella la cartella vecchia: un
//! guasto a metà copia lascia lo snapshot precedente intero, e la copia
//! interrotta si ripulisce al backup dopo. Un manifest di uno schema più recente
//! non si usa né si riscrive, e i campi che questa versione non conosce tornano
//! su disco come erano.
//!
//! Accanto alla cartella di ogni snapshot sta il suo **inventario**
//! (`<cartella>.files.json`): per ogni nota il path, la dimensione e l'impronta
//! dei byte copiati. Il ripristino lo confronta con ciò che trova *prima* di
//! creare qualsiasi nota: una copia mancante, troncata o alterata ferma tutto
//! con un errore che la nomina, invece di riportare meno note — o note a metà —
//! dichiarando di avercela fatta. Gli snapshot scritti prima dell'inventario si
//! controllano sul numero di copie che il manifest ricorda.
//!
//! L'inventario deve anche **tornare con il resto**: tante voci quante ne dice
//! il manifest (`n`) e nessuna copia nella cartella che lui non nomini. Una
//! versione che non lo conosce (un downgrade) rifà lo snapshot senza
//! aggiornarlo, e il manifest che riscrive si porta dietro `inventory: true`
//! come campo sconosciuto: l'inventario che resta è di prima, descrive una
//! cartella che non c'è più, e un ripristino che gli credesse salterebbe le
//! note nuove senza dirlo.
//!
//! Gli snapshot ruotano: dopo ogni backup riuscito restano i più recenti
//! [`BACKUP_KEEP_KEY`] (10 di serie, `0` li tiene tutti). Senza, crescevano
//! dentro il vault per sempre, e ognuno è una copia di tutte le note.

use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, Failure, InvokeMode, ParamKind,
    ParamSpec, Partial,
};
use fub_abi::edit::Fnv1a;
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
const E_DAMAGED: &str = "e_damaged";
const E_INVENTORY: &str = "e_inventory";
const E_PARTIAL: &str = "e_partial";
const P_BACKUP_PARTIAL: &str = "p_backup_partial";
const SKIPPED: &str = "skipped";
const SKIPPED_MORE: &str = "skipped_more";
const E_SKIP_GONE: &str = "e_skip_gone";
const E_SKIP_DENIED: &str = "e_skip_denied";
const E_SKIP_IO: &str = "e_skip_io";
const E_SKIP_OTHER: &str = "e_skip_other";
const E_NOT_WRITTEN: &str = "e_not_written";
const E_KEPT: &str = "e_kept";
const PATH: &str = "path";
/// Quanti file saltati il pannello nomina, prima di «e altri N».
const SHOWN_SKIPPED: usize = 5;
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
            .with(
                E_DAMAGED,
                "Lo snapshot «{id}» è incompleto o alterato, non ripristino niente: \
                 {n} copie non tornano ({files}).",
            )
            .with(
                E_INVENTORY,
                "Lo snapshot «{id}» ha perso l'elenco delle sue copie: non posso \
                 verificarlo, non ripristino niente.",
            )
            .with(
                E_PARTIAL,
                "Ripristino interrotto da «{id}»: create {done} note su {total}, \
                 le altre no. {reason}",
            )
            .with(
                P_BACKUP_PARTIAL,
                "Salvati {n} file su {total} in «{id}»: alcuni non si sono potuti copiare.",
            )
            .with(
                SKIPPED,
                "Backup fatto, ma {n} file non si sono potuti leggere. Di quelli \
                 che erano già nello snapshot di oggi resta la copia di prima; gli \
                 snapshot dei giorni prima non si toccano.",
            )
            .with(SKIPPED_MORE, "… e altri {n}.")
            .with(
                E_SKIP_GONE,
                "«{path}»: il file è sparito durante il backup.",
            )
            .with(
                E_SKIP_DENIED,
                "«{path}»: Fub non ha il permesso di leggerlo.",
            )
            .with(
                E_SKIP_IO,
                "«{path}»: il disco non l'ha restituito. Controlla che il file non \
                 sia bloccato da un altro programma, poi riprova.",
            )
            .with(
                E_SKIP_OTHER,
                "«{path}»: non si è potuto leggere per un errore inatteso.",
            )
            .with(
                E_NOT_WRITTEN,
                "Non ho potuto scrivere la copia di «{path}»: il backup si è fermato \
                 e lo snapshot di prima è intatto. Controlla lo spazio sul disco e \
                 riprova.",
            )
            .with(
                E_KEPT,
                "Backup non fatto: «{path}» non si è potuto leggere, e nemmeno la sua \
                 copia nello snapshot «{id}». Lo snapshot «{id}» resta com'era: \
                 controlla che il file non sia bloccato, poi riprova.",
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
            .with(
                E_DAMAGED,
                "Snapshot «{id}» is incomplete or altered, nothing restored: {n} \
                 copies do not match ({files}).",
            )
            .with(
                E_INVENTORY,
                "Snapshot «{id}» lost the list of its copies: it cannot be \
                 verified, nothing restored.",
            )
            .with(
                E_PARTIAL,
                "Restore from «{id}» stopped: {done} of {total} notes created, the \
                 rest were not. {reason}",
            )
            .with(
                P_BACKUP_PARTIAL,
                "Saved {n} of {total} files in «{id}»: some could not be copied.",
            )
            .with(
                SKIPPED,
                "Backup done, but {n} files could not be read. Those already in \
                 today's snapshot keep the copy made before; the snapshots of earlier \
                 days are left untouched.",
            )
            .with(SKIPPED_MORE, "…and {n} more.")
            .with(
                E_SKIP_GONE,
                "«{path}»: the file disappeared during the backup.",
            )
            .with(E_SKIP_DENIED, "«{path}»: Fub is not allowed to read it.")
            .with(
                E_SKIP_IO,
                "«{path}»: the disk did not return it. Check that no other program \
                 is locking the file, then try again.",
            )
            .with(
                E_SKIP_OTHER,
                "«{path}»: it could not be read because of an unexpected error.",
            )
            .with(
                E_NOT_WRITTEN,
                "Could not write the copy of «{path}»: the backup stopped and the \
                 previous snapshot is intact. Check the free disk space and try again.",
            )
            .with(
                E_KEPT,
                "Backup not done: «{path}» could not be read, and neither could its \
                 copy in snapshot «{id}». Snapshot «{id}» stays as it was: check that \
                 the file is not locked, then try again.",
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
    let notice = match host.run_command(id, args) {
        Ok(outcome) => outcome.partial.as_ref().map(skipped_notice),
        // La frase dell'errore, non la sua forma da log (`I/O error: …`): i
        // comandi di questo componente la scrivono dal catalogo.
        Err(and) => Some(UiNode::failed(
            Text::message(FAILED, vec![Arg::text("reason", and.message().to_string())]),
            None,
        )),
    };
    Ok(ViewUpdate::Replace {
        root: tree(host, notice)?,
    })
}

/// I file che un backup non ha potuto copiare, uno per riga col perché: i primi
/// [`SHOWN_SKIPPED`], poi quanti altri.
fn skipped_notice(partial: &Partial) -> UiNode {
    let mut children = vec![UiNode::failed(
        Text::message(SKIPPED, vec![Arg::int("n", partial.failed() as i64)]),
        None,
    )];
    children.extend(
        partial
            .failures
            .iter()
            .take(SHOWN_SKIPPED)
            .map(|failure| UiNode::text(failure.error.message().clone())),
    );
    let more = partial.failures.len().saturating_sub(SHOWN_SKIPPED);
    if more > 0 {
        children.push(UiNode::text(Text::message(
            SKIPPED_MORE,
            vec![Arg::int("n", more as i64)],
        )));
    }
    UiNode::column(1, children).with_key(SKIPPED)
}

fn tree(host: &dyn ReadApi, notice: Option<UiNode>) -> Result<UiNode, PluginError> {
    let store = load(host)?;
    let mut children = Vec::new();
    children.extend(notice);
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
    remove_snapshot_files(host, &dir)?;
    let mut copies = Vec::with_capacity(docs.len());
    let mut skipped = Vec::new();
    for doc in &docs {
        // I **byte**, non il testo: un backup copia ciò che sta sul disco, e un
        // `.docx`, un PDF o una nota con un encoding suo non sono UTF-8. Letti
        // come testo fermavano il backup di tutto il vault.
        let bytes = match host.read_document_bytes(doc) {
            Ok(bytes) => bytes,
            // Un file che non si legge non ferma gli altri: si salta, e alla
            // fine si dice quale e perché. Lo snapshot resta coerente, perché
            // l'inventario elenca soltanto ciò che è stato copiato.
            Err(and) => {
                skipped.push(Failure::of(doc.clone(), unreadable(doc, &and)));
                continue;
            }
        };
        host.data_write(&format!("{dir}/{}", doc.as_str()), &bytes)
            .map_err(|and| not_written(doc, and))?;
        copies.push(Saved {
            path: doc.as_str().to_owned(),
            size: bytes.len() as u64,
            hash: Fnv1a::hash(&bytes),
        });
    }
    let copied = copies.len();
    // Un file saltato che lo snapshot di oggi aveva già copiato non perde la
    // sua copia: passa nello snapshot nuovo, che sostituisce quello di oggi.
    // Se non si rilegge, lo snapshot di oggi resta com'era e il backup si
    // ferma: uno snapshot nuovo senza l'unica copia sarebbe una perdita.
    if !skipped.is_empty() {
        if let Some(earlier) = store.snapshots.iter().find(|s| s.id == id) {
            if let Err(and) = carry_over(host, earlier, &dir, &skipped, &mut copies) {
                // La copia nuova non la nomina nessuno: via, o resterebbe
                // fino al backup dopo. Un guasto qui non cambia l'errore.
                let _ = remove_snapshot_files(host, &dir);
                return Err(and);
            }
        }
    }
    let kept = copies.len();
    // L'inventario va prima del manifest, come le copie: il manifest che lo
    // nomina non deve mai arrivare prima di ciò che nomina.
    let inventory = serde_json::to_vec(&Inventory { files: copies }).map_err(|and| {
        PluginError::Internal(Text::message(
            FAILED,
            vec![Arg::text("reason", and.to_string())],
        ))
    })?;
    host.data_write(&inventory_path(&dir), &inventory)?;
    if let Some(existing) = store.snapshots.iter_mut().find(|s| s.id == id) {
        existing.n = kept as u32;
        existing.dir = Some(dir);
        existing.inventory = true;
    } else {
        store.snapshots.push(Snapshot {
            id: id.clone(),
            n: kept as u32,
            dir: Some(dir),
            inventory: true,
            rest: serde_json::Map::new(),
        });
    }
    // Uno snapshot a cui manca qualcosa non manda via i più vecchi: potrebbero
    // essere i soli ad avere la copia dei file saltati. Quello di oggi che il
    // nuovo sostituisce sì: le copie dei file saltati sono passate nel nuovo.
    let mut stale = if skipped.is_empty() {
        rotate(&mut store, &id, keep(host))
    } else {
        Vec::new()
    };
    stale.extend(current);
    persist(host, &store)?;
    // Le cartelle che il manifest non nomina più si cancellano dopo: un errore
    // lascia file orfani, mai un manifest che nomina uno snapshot sparito.
    for old in &stale {
        remove_snapshot_files(host, old)?;
    }
    let partial = Partial::of(docs.len(), copied, skipped);
    Ok(CommandOutcome::notify(Text::message(
        if partial.is_some() {
            P_BACKUP_PARTIAL
        } else {
            P_BACKUP
        },
        vec![
            Arg::int("n", copied as i64),
            Arg::int("total", n),
            Arg::text(ID, id),
        ],
    ))
    .partially(partial))
}

/// Perché `doc` non è entrato nello snapshot, detto a chi lo legge. La
/// variante resta quella del guasto (chi decide se riprovare guarda lei); la
/// frase è del catalogo e nomina il file, non il messaggio del sistema, che
/// va nel log.
fn unreadable(doc: &DocId, and: &PluginError) -> PluginError {
    tracing::warn!(doc = %doc, error = %and, "backup: file non letto, saltato");
    let path = || vec![Arg::text(PATH, doc.as_str())];
    match and {
        PluginError::NotFound(_) => PluginError::NotFound(Text::message(E_SKIP_GONE, path())),
        PluginError::PermissionDenied(_) => {
            PluginError::PermissionDenied(Text::message(E_SKIP_DENIED, path()))
        }
        PluginError::Io(_) => PluginError::Io(Text::message(E_SKIP_IO, path())),
        _ => PluginError::Internal(Text::message(E_SKIP_OTHER, path())),
    }
}

/// La copia di `doc` non si è scritta: il backup si ferma, lo snapshot di
/// prima resta com'era, e l'errore lo dice con una frase. La variante resta
/// quella del guasto; il messaggio del sistema va nel log.
fn not_written(doc: &DocId, mut and: PluginError) -> PluginError {
    tracing::warn!(doc = %doc, error = %and, "backup: copia non scritta");
    *and.message_mut() = Text::message(E_NOT_WRITTEN, vec![Arg::text(PATH, doc.as_str())]);
    and
}

/// Copia in `dir`, lo snapshot nuovo, ciò che `earlier` (lo snapshot dello
/// stesso giorno che il nuovo sostituisce) aveva dei file `skipped`, e lo
/// aggiunge a `copies`. Ogni copia si verifica sull'inventario di `earlier`,
/// se ce l'ha; un file che `earlier` non aveva non c'è da portare. Una copia
/// che non si rilegge, o che non torna, ferma tutto con [`E_KEPT`].
fn carry_over(
    host: &mut dyn HostApi,
    earlier: &Snapshot,
    dir: &str,
    skipped: &[Failure],
    copies: &mut Vec<Saved>,
) -> Result<(), PluginError> {
    let from = earlier.dir().to_owned();
    let inventory = if earlier.inventory {
        read_inventory(host, &from)?
    } else {
        None
    };
    for doc in skipped
        .iter()
        .filter_map(|failure| failure.subject.as_ref())
    {
        let path = doc.as_str();
        let kept = || {
            PluginError::Io(Text::message(
                E_KEPT,
                vec![Arg::text(PATH, path), Arg::text(ID, &earlier.id)],
            ))
        };
        // Che cosa lo snapshot di prima dice di avere di questo file.
        let expected = match (&inventory, earlier.inventory) {
            (Some(inventory), _) => match inventory.files.iter().find(|c| c.path == path) {
                Some(copy) => Some((copy.size, copy.hash)),
                None => continue,
            },
            // L'inventario c'era e non si legge: la copia non si verifica.
            (None, true) => return Err(kept()),
            // Uno snapshot di prima dell'inventario: si guarda la cartella.
            (None, false) => None,
        };
        let bytes = match (host.data_read(&format!("{from}/{path}")), expected) {
            (Ok(Some(bytes)), Some((size, hash)))
                if bytes.len() as u64 == size && Fnv1a::hash(&bytes) == hash =>
            {
                bytes
            }
            (Ok(Some(bytes)), None) => bytes,
            (Ok(None), None) => continue,
            _ => return Err(kept()),
        };
        host.data_write(&format!("{dir}/{path}"), &bytes)
            .map_err(|and| not_written(doc, and))?;
        copies.push(Saved {
            path: path.to_owned(),
            size: bytes.len() as u64,
            hash: Fnv1a::hash(&bytes),
        });
    }
    Ok(())
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

/// Le copie di uno snapshot e il suo inventario: vanno e restano insieme.
fn remove_snapshot_files(host: &mut dyn HostApi, dir: &str) -> Result<(), PluginError> {
    remove_dir(host, dir)?;
    host.data_remove(&inventory_path(dir))
}

/// Dove sta l'inventario dello snapshot nella cartella `dir`: accanto alla
/// cartella e non dentro, o un file dello stesso nome nel vault lo scambierebbe
/// con una nota.
fn inventory_path(dir: &str) -> String {
    format!("{dir}.files.json")
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
    let prefix = format!("{dir}/");
    let existing: std::collections::BTreeSet<String> = host
        .list_documents(None)?
        .items
        .into_iter()
        .map(|d| d.0)
        .collect();
    // Che cosa lo snapshot dice di contenere, e che cosa se ne può rileggere
    // adesso. Tutto si decide **prima** di creare una nota: un ripristino
    // fermato non lascia niente a metà.
    let mut from_create: Vec<(DocId, Vec<u8>)> = Vec::new();
    let mut damaged: Vec<String> = Vec::new();
    if snapshot.inventory {
        let inventory = read_inventory(host, dir)?.ok_or_else(|| {
            PluginError::Internal(Text::message(E_INVENTORY, vec![Arg::text(ID, &id)]))
        })?;
        // L'inventario deve descrivere questa cartella: lo dicono il numero di
        // voci che il manifest ricorda e le copie che ci stanno davvero. Ne
        // basta una che non torni per non credergli: i byte sarebbero giusti,
        // ma l'elenco delle note no.
        if inventory.files.len() != snapshot.n as usize {
            damaged.push(format!("{} su {}", inventory.files.len(), snapshot.n));
        }
        let known: std::collections::BTreeSet<&str> = inventory
            .files
            .iter()
            .map(|copy| copy.path.as_str())
            .collect();
        for path in host.data_list(dir)? {
            if let Some(rel) = path.strip_prefix(&prefix) {
                if !known.contains(rel) {
                    damaged.push(rel.to_owned());
                }
            }
        }
        for copy in inventory.files {
            if existing.contains(&copy.path) {
                continue;
            }
            let bytes = host.data_read(&format!("{prefix}{}", copy.path))?;
            match bytes {
                Some(bytes)
                    if bytes.len() as u64 == copy.size && Fnv1a::hash(&bytes) == copy.hash =>
                {
                    from_create.push((DocId::new(&copy.path), bytes))
                }
                _ => damaged.push(copy.path),
            }
        }
    } else {
        // Uno snapshot di prima dell'inventario: non si sa di che impronta
        // fossero i byte, ma il manifest ricorda quante note aveva.
        let listed: Vec<String> = host
            .data_list(dir)?
            .into_iter()
            .filter_map(|path| path.strip_prefix(&prefix).map(str::to_owned))
            .collect();
        if listed.len() != snapshot.n as usize {
            return Err(damaged_error(
                &id,
                &[format!("{} su {}", listed.len(), snapshot.n)],
            ));
        }
        for rel in listed {
            if existing.contains(&rel) {
                continue;
            }
            // Una copia che non si legge ferma il ripristino prima che crei
            // qualcosa: saltata, il ripristino riportava meno note dicendo di
            // esserci riuscito.
            match host.data_read(&format!("{prefix}{rel}"))? {
                Some(bytes) => from_create.push((DocId::new(&rel), bytes)),
                None => damaged.push(rel),
            }
        }
    }
    if !damaged.is_empty() {
        return Err(damaged_error(&id, &damaged));
    }
    let n = from_create.len() as i64;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            P_RESTORE,
            vec![Arg::int("n", n), Arg::text(ID, &id)],
        )));
    }
    // I byte tornano come sono stati copiati, senza passare dal testo: un
    // allegato o un `.docx` si ripristinano come le note. `None` crea soltanto:
    // un file comparso nel frattempo con quel nome non si sovrascrive.
    for (done, (doc, bytes)) in from_create.iter().enumerate() {
        if let Err(mut and) = host.write_document_bytes(doc, bytes, None) {
            if done > 0 {
                // Ciò che è già stato creato resta: lo si dice, o il resto del
                // vault sembrerebbe intatto. La variante dell'errore non
                // cambia, cambia la prosa.
                *and.message_mut() = Text::message(
                    E_PARTIAL,
                    vec![
                        Arg::text(ID, &id),
                        Arg::int("done", done as i64),
                        Arg::int("total", n),
                        Arg::text("reason", and.message().to_string()),
                    ],
                );
            }
            return Err(and);
        }
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

/// L'errore di uno snapshot che non torna, con i primi path che non tornano:
/// l'elenco intero in un messaggio non lo legge nessuno.
fn damaged_error(id: &str, files: &[String]) -> PluginError {
    const SHOWN: usize = 5;
    let mut shown = files
        .iter()
        .take(SHOWN)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if files.len() > SHOWN {
        shown.push_str(", …");
    }
    PluginError::Internal(Text::message(
        E_DAMAGED,
        vec![
            Arg::text(ID, id),
            Arg::int("n", files.len() as i64),
            Arg::text("files", shown),
        ],
    ))
}

/// L'inventario di `dir`. Assente → `None`; illeggibile come JSON è un errore
/// dello stesso genere dell'assenza, e lo decide chi chiama.
fn read_inventory(host: &dyn ReadApi, dir: &str) -> Result<Option<Inventory>, PluginError> {
    let Some(bytes) = host.data_read(&inventory_path(dir))? else {
        return Ok(None);
    };
    Ok(serde_json::from_slice(&bytes).ok())
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
    /// Se accanto alla cartella c'è l'inventario delle sue copie
    /// ([`inventory_path`]). Assente negli snapshot di prima: lì il ripristino
    /// si ferma al numero di note `n`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    inventory: bool,
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

/// Le copie di uno snapshot come il backup le ha scritte.
#[derive(Debug, Serialize, Deserialize)]
struct Inventory {
    files: Vec<Saved>,
}

/// Una nota copiata: dove, quanto è lunga e che impronta aveva.
#[derive(Debug, Serialize, Deserialize)]
struct Saved {
    path: String,
    size: u64,
    #[serde(with = "fub_abi::ipc::u64_string")]
    hash: u64,
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
