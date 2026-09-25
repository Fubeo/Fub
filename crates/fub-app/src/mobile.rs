//! Adattatori mobile P14/F37: entry, lifecycle, storage, permessi, capture e
//! widget/azioni OS sopra lo stesso `Host`, senza duplicare l'app.
//!
//! **Riuso, non seconda app.** Chi monta (registro, feature, sessione, watcher,
//! ponte eventi) resta in [`fub_host`]; le firme `#[tauri::command]`, il ponte
//! webview e `run()` restano in `lib.rs` (NativeIntegration). Questo modulo
//! fornisce gli helper puri e gli adattatori che `lib.rs` consuma: entry point
//! mobile, sospensione/ripresa, storage privato-vs-condiviso, permessi
//! espliciti, capture v1 da share sheet/deep link, report onesto su
//! Wasmtime/JIT e prerequisiti di packaging. Nessuna dipendenza mobile nel
//! kernel, nessun secondo writer, nessuna scrittura silenziosa.
//!
//! **Parser unico.** `fub://` si riusa da [`fub_host::automation`]
//! (`parse_fub_uri`, `validate_callback`, `CallbackPolicy`, `FubUri`,
//! `CaptureMode`, costanti): qui non si duplica la grammatica. Il payload
//! capture v1 è modellato qui come [`MobileCapturePayload`] con gli stessi
//! limiti validati in `automation` (titolo <= 512 caratteri, markdown <= 1MiB,
//! URL http/https <= 2048, path relativi senza `..`, proprietà <= 64KiB),
//! così la validazione resta identica su ogni trasporto. Origine mobile
//! propria: [`MOBILE_ORIGIN`] (`mobile-share`), distinta da
//! `clipper-extension` come concordato con ClipperOwner.
//!
//! **Lifecycle reale.** Il dirty vive nel frontend (`DocumentSession`,
//! singleton per vault, ShellOwner): su `pagehide`/`visibilitychange` il
//! frontend fa `flushPendingSave`/`flushBeforeClose` e al resume `recoverDrafts`
//! (`shells/mobile/lifecycle.ts`). Qui il backend non chiude i vault in pausa
//! (sarebbe un costo per ogni `onPause`): tiene le sessioni aperte, registra la
//! transizione con [`MobileLifecycle`] e si affida alla durabilità per
//! scrittura del kernel + bozze su disco. Solo `RunEvent::Exit` chiude
//! (`Host::close`, già in `lib.rs`).

use camino::Utf8PathBuf;
use fub_abi::command::CommandEffect;
use fub_abi::edit::WriteBase;
use fub_abi::{DocId, InvokeMode, PluginError};
use fub_host::automation::{
    self, CallbackPolicy, CaptureMode, FubUri, MARKDOWN_MAX_BYTES, SOURCE_URL_MAX_BYTES,
    TITLE_MAX_CHARS,
};
use fub_host::doc_id;
use std::io::Write;
use std::sync::Mutex;

/// Provenienza delle capture da share sheet mobile. Distinta da
/// `clipper-extension`: il canale resta una proposta privata dell'adattatore
/// via host, nessun nuovo WIT.
pub const MOBILE_ORIGIN: &str = "mobile-share";

/// Versione payload capture accettata (stessa di `automation::CAPTURE_V1`).
pub const MOBILE_CAPTURE_V1: u8 = 1;

/// Tetto proprietà serializzate, come `automation::validate_capture_v1`.
pub const MOBILE_PROPS_MAX_BYTES: usize = 65536;

/// Tetto chiavi proprietà, come `automation`.
pub const MOBILE_PROP_KEY_MAX_BYTES: usize = 128;

/// Tetto path vault/cartella/nota, come `automation`.
pub const MOBILE_PATH_MAX_BYTES: usize = 1024;

// --- lifecycle ---------------------------------------------------------------

/// Fase OS vista dal backend: pura, testabile senza Tauri.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobileLifecycle {
    Foreground,
    Hidden,
    Suspended,
}

/// Cosa deve fare il backend a una transizione. Nota: il flush del dirty è del
/// frontend (ha i buffer); qui non si chiude niente in pausa.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobileLifecycleAction {
    /// Resta aperto, registra solo. Sessioni e indici vivi.
    KeepOpen,
    /// Torno visibile: niente da riaprire, il frontend ricongiunge le bozze.
    Rejoin,
}

impl MobileLifecycle {
    /// Transizione pura. `Suspended` non chiude: chiudere a ogni `onPause`
    /// costerebbe un reopen per ogni spegnimento schermo.
    pub fn step(self, next: MobileLifecycle) -> MobileLifecycleAction {
        match (self, next) {
            (MobileLifecycle::Suspended, MobileLifecycle::Foreground) => {
                MobileLifecycleAction::Rejoin
            }
            (_, MobileLifecycle::Suspended) => MobileLifecycleAction::KeepOpen,
            _ => MobileLifecycleAction::KeepOpen,
        }
    }
}

/// Azione per un `WindowEvent` mobile. Solo su `cfg(mobile)`: su desktop le
/// varianti `Suspended`/`Resumed` non esistono.
#[cfg(mobile)]
pub fn window_event_action(event: &tauri::WindowEvent) -> Option<MobileLifecycleAction> {
    match event {
        tauri::WindowEvent::Suspended => Some(MobileLifecycleAction::KeepOpen),
        tauri::WindowEvent::Resumed => Some(MobileLifecycleAction::Rejoin),
        _ => None,
    }
}

// --- storage: privato vs tree-grant ----------------------------------------------
//
// NESSUN vault condiviso da path/parent: un file picker (Android
// ACTION_OPEN_DOCUMENT, iOS security-scoped su file) NON conferisce alcun
// grant sulla cartella madre. Solo due canali reali:
// - Android: ACTION_OPEN_DOCUMENT_TREE (FubTreeAccess.kt) con
//   FLAG_GRANT_{READ,WRITE,PERSISTABLE,PREFIX}_URI_PERMISSION + persist subito;
// - iOS: UIDocumentPicker `.folder` (FubTreeAccess.swift) + bookmark
//   security-scoped persistito nel registry Rust.
// Il grant vive in [`MobileTreeGrant`] dentro mobile-storage.json app-level:
// `persisted=false` = NeedGrant, mai mount.
// Revoca OS = NeedGrant esplicito (mai fallback silenzioso al privato:
// `decide_shared_mount` ritorna NeedGrant, il privato resta solo scelta
// esplicita dell'utente). Se `backend_cas=false`, mount ReadOnly con reason
// (`readonly-reason` verso SystemStorage/BinaryGuard), altrimenti CopyImport
// solo per gesto esplicito. Scrittura sempre via unico `Host`.

/// Piattaforma del grant: determina validazione URI/bookmark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MobileGrantPlatform {
    Android,
    Ios,
}

/// Grant di cartella persistito. `uri`: content:// tree (Android) o file://
/// (iOS); `persisted`: takePersistableUriPermission avvenuto (Android) o
/// bookmark scritto (iOS). `read_write=false` = grant sola lettura.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MobileTreeGrant {
    pub platform: MobileGrantPlatform,
    pub uri: String,
    pub display_name: Option<String>,
    pub persisted: bool,
    pub read_write: bool,
    /// Solo iOS: bookmark base64 (`FubTreeAccess.bookmark`). Solo Android:
    /// `None` (vale il persisted URI di ContentResolver).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bookmark_b64: Option<String>,
}

/// Modo di mount deciso in modo puro. Mai fallback silenzioso: NeedGrant e
/// CopyImport sono stati visibili che la UI mostra e l'utente scioglie.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MobileMountMode {
    ReadWrite,
    ReadOnly,
    CopyImport,
    NeedGrant,
}

/// Valida il grant senza I/O: schema per piattaforma, persisted obbligatorio,
/// niente `..`, niente path da file picker spacciati per tree.
pub fn validate_tree_grant(grant: &MobileTreeGrant) -> Result<(), PluginError> {
    let bad = |m: &str| PluginError::BadArgs(m.into());
    if grant.uri.trim().is_empty() {
        return Err(bad("tree grant: uri vuota"));
    }
    if grant.uri.contains('\0') || grant.uri.chars().any(|c| c.is_control()) {
        return Err(bad("tree grant: uri con controllo"));
    }
    match grant.platform {
        MobileGrantPlatform::Android => {
            let lower = grant.uri.to_ascii_lowercase();
            if !lower.starts_with("content://")
                || !lower.contains("/tree/")
                || lower.contains("/document/")
            {
                return Err(bad(
                    "tree grant Android: solo URI content:// con /tree/ da OPEN_DOCUMENT_TREE",
                ));
            }
        }
        MobileGrantPlatform::Ios => {
            let lower = grant.uri.to_ascii_lowercase();
            if !lower.starts_with("file://") {
                return Err(bad("tree grant iOS: solo file:// da picker .folder"));
            }
            if grant
                .bookmark_b64
                .as_deref()
                .is_none_or(|b| b.trim().is_empty())
            {
                return Err(bad("tree grant iOS: bookmark security-scoped mancante"));
            }
        }
    }
    if !grant.persisted {
        return Err(bad("tree grant non persistito: ripeti il picker"));
    }
    if let Some(name) = grant.display_name.as_deref() {
        if name.contains('\0') || name.chars().any(|c| c.is_control()) {
            return Err(bad("tree grant: display_name con controllo"));
        }
    }
    if grant.uri.split('/').any(|segment| segment == "..") {
        return Err(bad("tree grant: path traversal"));
    }
    Ok(())
}

/// Decide il mount senza I/O. `backend_cas`: il backend garantisce CAS atomico
/// (BinaryGuard/SystemStorage) o no. `copy_accepted`: gesto esplicito di copia.
/// Grant invalido/non persistito => NeedGrant. Senza CAS e senza copia
/// accettata => ReadOnly con reason a cura del chiamante. Mai ReadWrite
/// assunto, mai fallback silenzioso al privato.
pub fn decide_shared_mount(
    grant: Option<&MobileTreeGrant>,
    backend_cas: bool,
    copy_accepted: bool,
) -> MobileMountMode {
    let Some(grant) = grant else {
        return MobileMountMode::NeedGrant;
    };
    if validate_tree_grant(grant).is_err() {
        return MobileMountMode::NeedGrant;
    }
    if grant.read_write && backend_cas {
        return MobileMountMode::ReadWrite;
    }
    if copy_accepted {
        return MobileMountMode::CopyImport;
    }
    MobileMountMode::ReadOnly
}

/// Reason readonly quando `decide_shared_mount` dice ReadOnly: il chiamante
/// (SystemStorage/BinaryGuard via Main) la propaga come readonly-reason.
pub fn shared_readonly_reason(backend_cas: bool) -> Option<&'static str> {
    if backend_cas {
        None
    } else {
        Some("vault condiviso senza CAS atomico: sola lettura, copia per gesto esplicito")
    }
}

/// Dove sta un vault su mobile. Esplicito, mai implicito.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MobileStorageKind {
    /// Sandbox dell'app (`app_data_dir`): sopravvive alla revoca dei permessi,
    /// muore con la disinstallazione, sempre offline.
    Private,
    /// Tree grant persistito (SAF/bookmark): sopravvive alla
    /// disinstallazione solo se il grant resta, muore con la revoca (NeedGrant
    /// esplicito), offline solo se i file ci sono.
    Shared,
}

/// Permesso OS per lo spazio condiviso. `Unknown` finché il bridge nativo non
/// risponde: mai assumere concesso.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MobilePermissionState {
    Unknown,
    Granted,
    Denied,
    Revoked,
}

/// Fotografia storage per la UI. `shared_*` vale SOLO con tree grant valido:
/// un path da `document_dir()` o da file picker non è uno shared e non si
/// mostra come tale.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MobileStorageInfo {
    pub private_dir: Option<String>,
    pub shared_grant: Option<MobileTreeGrant>,
    pub shared_permission: MobilePermissionState,
    /// La sandbox c'è sempre quando il resolver risponde; il condiviso solo con
    /// grant valido+mount deciso. Offline vale solo ciò che è sul disco adesso.
    pub offline_reliable_private: bool,
    pub offline_reliable_shared: bool,
    pub shared_mount: MobileMountMode,
}

fn path_to_string(path: Result<std::path::PathBuf, tauri::Error>) -> Option<String> {
    path.ok().map(|p| p.to_string_lossy().into_owned())
}

/// Legge la sola sandbox dal resolver Tauri. Il tree condiviso NON si deduce
/// da `document_dir()`: arriva solo dal registry app-level dopo verifica OS.
/// Grant assente = NeedGrant.
pub fn mobile_storage_info(app: &tauri::AppHandle) -> MobileStorageInfo {
    use tauri::Manager;
    let paths = app.path();
    let private_dir = path_to_string(paths.app_data_dir());
    MobileStorageInfo {
        offline_reliable_private: private_dir.is_some(),
        offline_reliable_shared: false,
        private_dir,
        shared_grant: None,
        shared_permission: MobilePermissionState::Unknown,
        shared_mount: MobileMountMode::NeedGrant,
    }
}

/// Attacca un grant già letto dal registry alla fotografia, senza supporre
/// permessi OS attivi. Grant invalido = NeedGrant, mai mount assunto.
pub fn with_shared_grant(mut info: MobileStorageInfo, grant: MobileTreeGrant) -> MobileStorageInfo {
    if validate_tree_grant(&grant).is_ok() {
        // Un flag persisted inviato dal webview non dimostra che l'OS non abbia
        // revocato il permesso: serve il probe nativo a ogni mount/resume.
        info.shared_permission = MobilePermissionState::Unknown;
        info.shared_grant = Some(grant);
    } else {
        info.shared_mount = MobileMountMode::NeedGrant;
    }
    info
}

/// App-level metadata exists before any vault session. A vault-scoped
/// view-state key cannot remember the grant needed to mount that vault.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MobileStoragePreference {
    pub version: u8,
    pub revision: String,
    pub choice: Option<MobileStorageKind>,
    pub grant: Option<MobileTreeGrant>,
}

impl Default for MobileStoragePreference {
    fn default() -> Self {
        Self {
            version: 1,
            revision: String::new(),
            choice: None,
            grant: None,
        }
    }
}

static STORAGE_PREFERENCE_WRITE: Mutex<()> = Mutex::new(());
const STORAGE_PREFERENCE_LIMIT: u64 = 128 * 1024;

fn storage_preference_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, PluginError> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|p| p.join("mobile-storage.json"))
        .map_err(|e| PluginError::Io(e.to_string().into()))
}

fn read_storage_preference(path: &std::path::Path) -> Result<MobileStoragePreference, PluginError> {
    let bytes = match std::fs::metadata(path) {
        Ok(meta) if meta.len() <= STORAGE_PREFERENCE_LIMIT => {
            std::fs::read(path).map_err(|e| PluginError::Io(e.to_string().into()))?
        }
        Ok(_) => {
            return Err(PluginError::BadArgs(
                "mobile storage: registry troppo grande".into(),
            ))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MobileStoragePreference::default())
        }
        Err(e) => return Err(PluginError::Io(e.to_string().into())),
    };
    let record: MobileStoragePreference = serde_json::from_slice(&bytes).map_err(|e| {
        PluginError::BadArgs(format!("mobile storage: registry non leggibile: {e}").into())
    })?;
    if record.version != 1 {
        return Err(PluginError::BadArgs(
            "mobile storage: schema futuro non supportato".into(),
        ));
    }
    if let Some(grant) = &record.grant {
        validate_tree_grant(grant)?;
    }
    Ok(record)
}

pub fn load_mobile_storage_preference(
    app: &tauri::AppHandle,
) -> Result<MobileStoragePreference, PluginError> {
    read_storage_preference(&storage_preference_path(app)?)
}

pub fn persist_mobile_storage_preference(
    app: &tauri::AppHandle,
    mut incoming: MobileStoragePreference,
) -> Result<MobileStoragePreference, PluginError> {
    if incoming.version != 1 {
        return Err(PluginError::BadArgs(
            "mobile storage: schema futuro non supportato".into(),
        ));
    }
    if let Some(grant) = &incoming.grant {
        validate_tree_grant(grant)?;
    }
    let _guard = STORAGE_PREFERENCE_WRITE
        .lock()
        .map_err(|e| PluginError::Internal(e.to_string().into()))?;
    let path = storage_preference_path(app)?;
    let current = read_storage_preference(&path)?;
    if incoming.revision != current.revision {
        return Err(PluginError::Conflict(
            "mobile storage: preferenza modificata altrove".into(),
        ));
    }
    incoming.revision = uuid::Uuid::new_v4().to_string();
    let encoded =
        serde_json::to_vec(&incoming).map_err(|e| PluginError::Internal(e.to_string().into()))?;
    if encoded.len() as u64 > STORAGE_PREFERENCE_LIMIT {
        return Err(PluginError::BadArgs(
            "mobile storage: registry troppo grande".into(),
        ));
    }
    std::fs::create_dir_all(path.parent().expect("mobile storage path has parent"))
        .map_err(|e| PluginError::Io(e.to_string().into()))?;
    let temporary = path.with_extension(format!("{}.tmp", incoming.revision));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| PluginError::Io(e.to_string().into()))?;
        file.write_all(&encoded)
            .and_then(|_| file.sync_all())
            .map_err(|e| PluginError::Io(e.to_string().into()))?;
        std::fs::rename(&temporary, &path).map_err(|e| PluginError::Io(e.to_string().into()))?;
        Ok(incoming)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

// --- capture v1 lato mobile ---------------------------------------------------

/// Destinazione capture: stessi quattro modi della CLI e dell'estensione.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MobileCaptureTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub mode: CaptureMode,
}

/// Payload capture v1 dal share sheet mobile. Stessi limiti di
/// `automation::validate_capture_v1` (titolo <= 512 caratteri senza a-capo,
/// markdown <= 1MiB non vuoto, URL solo http/https <= 2048 senza credenziali,
/// proprietà <= 64KiB con chiavi <= 128 byte, path nel recinto).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MobileCapturePayload {
    pub v: u8,
    pub title: String,
    pub markdown: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<serde_json::Map<String, serde_json::Value>>,
    pub target: MobileCaptureTarget,
}

fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

fn contains_nul(s: &str) -> bool {
    s.contains('\0')
}

fn validate_target_path(
    field: &str,
    value: &str,
    is_new: bool,
) -> Result<(), fub_host::automation::AutomationError> {
    use fub_abi::rules::path_policy::{check, from_outside, Naming};
    let bad = fub_host::automation::AutomationError::bad_args;
    if value.trim().is_empty() {
        return Err(bad(format!("`{field}` vuoto")));
    }
    if value.len() > MOBILE_PATH_MAX_BYTES {
        return Err(bad(format!("`{field}` oltre 1024 byte")));
    }
    if contains_nul(value) {
        return Err(bad(format!("`{field}` con NUL")));
    }
    let clean = from_outside(value);
    if clean.is_empty() {
        return Err(bad(format!("`{field}` vuoto")));
    }
    let naming = if is_new {
        Naming::New
    } else {
        Naming::Existing
    };
    check(&clean, naming)
        .map_err(|why| bad(format!("`{field}` non nomina dentro il vault: {why}")))?;
    Ok(())
}

fn validate_source_url(url: &str) -> Result<(), fub_host::automation::AutomationError> {
    let bad = fub_host::automation::AutomationError::bad_args;
    if url.trim().is_empty() {
        return Err(bad("`source_url` vuota"));
    }
    if url.len() > SOURCE_URL_MAX_BYTES {
        return Err(bad("`source_url` oltre 2048 byte"));
    }
    if has_control(url) || contains_nul(url) || url.contains(' ') {
        return Err(bad("`source_url` con spazi/controllo"));
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(bad("`source_url` solo http/https"));
    }
    let after = url.split_once("://").map(|(_, after)| after).unwrap_or("");
    let host = after.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() {
        return Err(bad("`source_url` senza host"));
    }
    if host.contains('@') {
        return Err(bad("`source_url` senza credenziali"));
    }
    Ok(())
}

/// Valida un payload mobile con le stesse regole del canale NM/URI. Pura:
/// nessuna I/O, nessun vault, nessuna scrittura.
pub fn validate_mobile_capture(
    payload: &MobileCapturePayload,
) -> Result<(), fub_host::automation::AutomationError> {
    use fub_host::automation::AutomationError;
    if payload.v != MOBILE_CAPTURE_V1 {
        return Err(AutomationError::bad_args(format!(
            "`v` deve essere {}, non {}",
            MOBILE_CAPTURE_V1, payload.v
        )));
    }
    if payload.title.trim().is_empty() {
        return Err(AutomationError::bad_args("`title` vuoto"));
    }
    if payload.title.chars().count() > TITLE_MAX_CHARS {
        return Err(AutomationError::bad_args("`title` oltre 512 caratteri"));
    }
    if payload.title.contains('\n') || payload.title.contains('\r') || has_control(&payload.title) {
        return Err(AutomationError::bad_args("`title` con a-capo o controllo"));
    }
    if payload.markdown.trim().is_empty() {
        return Err(AutomationError::bad_args("`markdown` vuoto"));
    }
    if payload.markdown.len() > MARKDOWN_MAX_BYTES {
        return Err(AutomationError::bad_args("`markdown` oltre 1MiB"));
    }
    if let Some(url) = &payload.source_url {
        validate_source_url(url)?;
    }
    if let Some(props) = &payload.properties {
        for key in props.keys() {
            if key.trim().is_empty() {
                return Err(AutomationError::bad_args("`properties` con chiave vuota"));
            }
            if key.len() > MOBILE_PROP_KEY_MAX_BYTES {
                return Err(AutomationError::bad_args(
                    "`properties` con chiave oltre 128 byte",
                ));
            }
            if has_control(key) {
                return Err(AutomationError::bad_args(
                    "`properties` con chiave di controllo",
                ));
            }
        }
        let encoded = serde_json::to_string(props).map_err(|e| {
            AutomationError::bad_args(format!("`properties` non serializzabili: {e}"))
        })?;
        if encoded.len() > MOBILE_PROPS_MAX_BYTES {
            return Err(AutomationError::bad_args("`properties` oltre 64KiB"));
        }
    }
    let is_new = matches!(
        payload.target.mode,
        CaptureMode::Create | CaptureMode::Daily
    );
    if let Some(folder) = &payload.target.folder {
        validate_target_path("folder", folder, true)?;
    }
    if let Some(note) = &payload.target.note {
        validate_target_path("note", note, is_new)?;
    }
    match payload.target.mode {
        CaptureMode::Append | CaptureMode::Prepend => {
            if payload
                .target
                .note
                .as_deref()
                .is_none_or(|n| n.trim().is_empty())
            {
                return Err(AutomationError::bad_args(
                    "`target.note` richiesta per append/prepend",
                ));
            }
        }
        CaptureMode::Create | CaptureMode::Daily => {}
    }
    Ok(())
}

fn titled_body(title: &str, markdown: &str, source_url: Option<&str>) -> String {
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

fn with_extension(name: &str) -> String {
    let last = name.rsplit('/').next().unwrap_or(name);
    if last.contains('.') {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

fn created_doc(outcome: &fub_abi::CommandOutcome) -> Option<DocId> {
    match &outcome.effect {
        CommandEffect::Navigate { doc } => Some(doc.clone()),
        _ => None,
    }
}

fn append_body(
    host: &fub_host::Host,
    selector: Option<&str>,
    id: &DocId,
    addition: &str,
) -> Result<(), PluginError> {
    let (source, revision) = host.read_document(selector, id)?;
    let mut body = source;
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(addition);
    host.write_document(selector, id, &body, WriteBase::DescendsFrom(revision))?;
    Ok(())
}

fn apply_properties(
    host: &fub_host::Host,
    selector: Option<&str>,
    id: &DocId,
    payload: &MobileCapturePayload,
) -> Result<(), PluginError> {
    let Some(props) = payload.properties.as_ref() else {
        return Ok(());
    };
    for (key, value) in props {
        let rendered = match value {
            serde_json::Value::String(s) => s.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        host.invoke_user_command(
            selector,
            "note.property.set",
            serde_json::json!({ "doc": id.as_str(), "key": key, "value": rendered }),
            InvokeMode::Apply,
        )?;
    }
    Ok(())
}

/// Applica una capture validata attraverso l'unico `Host`: nessun secondo
/// writer, nessun percorso diretto sul filesystem. `vault` esplicito vince sul
/// `target.vault` solo se quest'ultimo è assente; la destinazione resta
/// approvata dal frontend prima della chiamata (mai scrittura silenziosa).
/// `template` è un pre-passo opzionale solo per `create`: crea da template e
/// poi accoda il corpo (mai sovrascrittura del template).
pub fn apply_mobile_capture(
    host: &fub_host::Host,
    vault: Option<&str>,
    payload: &MobileCapturePayload,
    template: Option<&str>,
) -> Result<DocId, PluginError> {
    validate_mobile_capture(payload).map_err(|e| e.to_plugin_error())?;
    if let Some(tpl) = template.map(str::trim).filter(|s| !s.is_empty()) {
        if payload.target.mode != CaptureMode::Create {
            return Err(PluginError::BadArgs("template solo con mode create".into()));
        }
        validate_target_path("template", tpl, false).map_err(|e| e.to_plugin_error())?;
    }
    let selector = payload.target.vault.as_deref().or(vault);
    match payload.target.mode {
        CaptureMode::Create => {
            let body = titled_body(
                &payload.title,
                &payload.markdown,
                payload.source_url.as_deref(),
            );
            if let Some(tpl) = template.map(str::trim).filter(|s| !s.is_empty()) {
                let name = match payload.target.note.as_deref() {
                    Some(note) if !note.trim().is_empty() => note.trim().to_string(),
                    _ => {
                        let slug: String = payload.title.trim().chars().take(80).collect();
                        if slug.trim().is_empty() {
                            "Untitled.md".to_string()
                        } else {
                            with_extension(slug.trim())
                        }
                    }
                };
                let full = match payload.target.folder.as_deref() {
                    Some(folder) if !folder.trim().is_empty() => {
                        format!("{}/{name}", folder.trim().trim_matches('/'))
                    }
                    _ => name,
                };
                let outcome = host.invoke_user_command(
                    selector,
                    "note.from_template",
                    serde_json::json!({ "template": tpl, "name": full }),
                    InvokeMode::Apply,
                )?;
                let created = created_doc(&outcome).ok_or_else(|| {
                    PluginError::Internal("note.from_template senza navigazione".into())
                })?;
                append_body(host, selector, &created, &format!("\n\n{body}"))?;
                apply_properties(host, selector, &created, payload)?;
                return Ok(created);
            }
            let name = match payload.target.note.as_deref() {
                Some(note) if !note.trim().is_empty() => note.trim().to_string(),
                _ => {
                    let slug: String = payload.title.trim().chars().take(80).collect();
                    if slug.trim().is_empty() {
                        "Untitled.md".to_string()
                    } else {
                        with_extension(slug.trim())
                    }
                }
            };
            let full = match payload.target.folder.as_deref() {
                Some(folder) if !folder.trim().is_empty() => {
                    format!("{}/{name}", folder.trim().trim_matches('/'))
                }
                _ => name,
            };
            let id = doc_id(&full)?;
            let outcome = host.invoke_user_command(
                selector,
                "note.create",
                serde_json::json!({ "name": id.as_str() }),
                InvokeMode::Apply,
            )?;
            let created = created_doc(&outcome).unwrap_or(id);
            let (_, revision) = host.read_document(selector, &created)?;
            host.write_document(selector, &created, &body, WriteBase::DescendsFrom(revision))?;
            apply_properties(host, selector, &created, payload)?;
            Ok(created)
        }
        CaptureMode::Daily => {
            let outcome = host.invoke_user_command(
                selector,
                "note.daily",
                serde_json::json!({}),
                InvokeMode::Apply,
            )?;
            let daily = created_doc(&outcome)
                .ok_or_else(|| PluginError::Internal("note.daily senza navigazione".into()))?;
            append_body(
                host,
                selector,
                &daily,
                &titled_body(
                    &payload.title,
                    &payload.markdown,
                    payload.source_url.as_deref(),
                ),
            )?;
            apply_properties(host, selector, &daily, payload)?;
            Ok(daily)
        }
        CaptureMode::Append => {
            let note = payload.target.note.as_deref().unwrap_or("");
            let id = doc_id(note)?;
            append_body(
                host,
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
            apply_properties(host, selector, &id, payload)?;
            Ok(id)
        }
        CaptureMode::Prepend => {
            let note = payload.target.note.as_deref().unwrap_or("");
            let id = doc_id(note)?;
            let (source, revision) = host.read_document(selector, &id)?;
            let body = format!(
                "{}{}",
                titled_body(
                    &payload.title,
                    &payload.markdown,
                    payload.source_url.as_deref()
                ),
                source
            );
            host.write_document(selector, &id, &body, WriteBase::DescendsFrom(revision))?;
            apply_properties(host, selector, &id, payload)?;
            Ok(id)
        }
    }
}
// --- share ingest: instradamento file/testo in arrivo ---------------------------
//
// Punto d'ingresso canonico (StorageOwner): i byte arrivano dai bridge nativi
// (`mobile/ShareBridge.kt` copia `content://` in cache, `ShareViewController`
// copia i security-scoped nell'inbox del gruppo) e qui si decide SOLO la rotta
// — documento vs allegato vs rifiuto — con la stessa `kind_of` di MediaOwner.
// La scrittura resta di `Host` sull'unica authority: testo via
// `apply_mobile_capture`, allegati via `open_artifact/write_artifact` a chunk
// 64KiB (short-read) + `create_document` (AlreadyExists se occupato), binari
// grossi via `write_document_bytes` quando BinaryGuard la espone (wiring Main).
// Niente path arbitrari fuori vault, niente secondo writer, mai tutto in RAM.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShareRoute {
    CaptureNote { title: String },
    Attachment { file_name: String, folder: String },
    Rejected { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedShare {
    pub route: ShareRoute,
    pub mime: String,
}

/// Testo condiviso -> capture create. Pura: valida i limiti qui, la scrittura
/// resta di `apply_mobile_capture` dopo approvazione UI.
pub fn plan_shared_text(text: &str, mime: &str) -> PlannedCaptureText {
    let title: String = text
        .trim()
        .lines()
        .next()
        .unwrap_or("Condiviso")
        .chars()
        .take(80)
        .collect();
    PlannedCaptureText {
        payload: MobileCapturePayload {
            v: MOBILE_CAPTURE_V1,
            title: if title.trim().is_empty() {
                "Condiviso".to_string()
            } else {
                title
            },
            markdown: text.to_string(),
            source_url: None,
            properties: None,
            target: MobileCaptureTarget {
                vault: None,
                folder: None,
                note: None,
                mode: CaptureMode::Create,
            },
        },
        mime: mime.to_string(),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlannedCaptureText {
    pub payload: MobileCapturePayload,
    pub mime: String,
}

/// File condiviso -> allegato o rifiuto. Pura: oltre 64MiB = rifiuto esplicito
/// (mai troncamento); la copia a chunk vive nei bridge nativi.
pub fn plan_share_file(name: &str, len: u64, mime: &str, folder: &str) -> PlannedShare {
    // Il testo condiviso resta una capture (titolo dalla prima riga); i file una rotta allegato/rifiuto.
    let _text_route = ShareRoute::CaptureNote {
        title: String::new(),
    };
    let _chunks = media_limits::chunk_count(media_limits::IPC_CHUNK_MAX_BYTES);
    let _fetch = media_limits::FETCH_MAX_BYTES;
    if !media_limits::fits_inline(len) {
        return PlannedShare {
            route: ShareRoute::Rejected {
                reason: "oltre 64MiB".to_string(),
            },
            mime: mime.to_string(),
        };
    }
    let clean = name.trim();
    if clean.is_empty() || clean.contains('\0') {
        return PlannedShare {
            route: ShareRoute::Rejected {
                reason: "nome non valido".to_string(),
            },
            mime: mime.to_string(),
        };
    }
    PlannedShare {
        route: ShareRoute::Attachment {
            file_name: clean.to_string(),
            folder: folder.to_string(),
        },
        mime: mime.to_string(),
    }
}

/// Classificazione pura di un URL in ingresso (deep link OS, tree grant,
/// share HTTP, o ignoto). `fub://mobile-tree` è mio e precede il parser
/// AutomationOwner (confermato: le sue 6 action restano chiuse); gli altri
/// `fub://` usano l'unico parser; http/https sono candidati `source_url`,
/// mai navigazioni implicite; callback deny-default, mai seguite in silenzio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenedUrlKind {
    Fub(FubUri),
    MobileSwitcher,
    MobileSearch,
    TreeGrant {
        uri: String,
        display: Option<String>,
        mode: Option<String>,
    },
    HttpShare(String),
    Rejected(String),
}

impl OpenedUrlKind {
    pub fn classify(raw: &str) -> Self {
        if let Some(query) = raw.strip_prefix("fub://mobile-tree?") {
            let query = format!("?{query}");
            return match parse_tree_grant_query(&query) {
                Ok((uri, display, mode)) => OpenedUrlKind::TreeGrant { uri, display, mode },
                Err(e) => OpenedUrlKind::Rejected(e),
            };
        }
        if raw == "fub://mobile-tree" || raw.starts_with("fub://mobile-tree/") {
            return OpenedUrlKind::Rejected("mobile-tree richiede ?uri=".to_string());
        }

        if raw == "fub://mobile-search" {
            return OpenedUrlKind::MobileSearch;
        }
        if raw == "fub://mobile-switcher" {
            return OpenedUrlKind::MobileSwitcher;
        }
        if raw.starts_with("fub://") {
            return match automation::parse_fub_uri(raw) {
                Ok(uri) => OpenedUrlKind::Fub(uri),
                Err(e) => OpenedUrlKind::Rejected(e.message().to_string()),
            };
        }
        let lower = raw.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            return match validate_source_url(raw) {
                Ok(()) => OpenedUrlKind::HttpShare(raw.to_string()),
                Err(e) => OpenedUrlKind::Rejected(e.message().to_string()),
            };
        }
        OpenedUrlKind::Rejected("schema non fub:// né http(s)".to_string())
    }
}

/// Evento validato per il webview. Il payload non conferisce alcun permesso,
/// non monta vault e non esegue le azioni: la UI richiede un gesto esplicito.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct MobileOpenedUrl {
    pub kind: &'static str,
    pub raw: String,
}

pub fn classify_opened_url(raw: &str) -> Result<MobileOpenedUrl, PluginError> {
    let kind = match OpenedUrlKind::classify(raw) {
        OpenedUrlKind::Fub(_) => "fub",
        OpenedUrlKind::MobileSwitcher => "mobile_switcher",
        OpenedUrlKind::MobileSearch => "mobile_search",
        OpenedUrlKind::TreeGrant { .. } => "tree_grant",
        OpenedUrlKind::HttpShare(_) => "http_share",
        OpenedUrlKind::Rejected(reason) => return Err(PluginError::BadArgs(reason.into())),
    };
    Ok(MobileOpenedUrl {
        kind,
        raw: raw.to_string(),
    })
}

/// Query `?uri=&display=&mode=` del tree grant. `uri` obbligatorio e non vuoto;
/// chiavi ignote rifiutate (stessa regola del parser AutomationOwner); `+`
/// resta `+` (mai spazio). Pura, senza I/O.
fn parse_tree_grant_query(query: &str) -> Result<(String, Option<String>, Option<String>), String> {
    let query = query.strip_prefix('?').unwrap_or(query);
    if query.trim().is_empty() {
        return Err("mobile-tree senza query: serve ?uri=".to_string());
    }
    let mut uri: Option<String> = None;
    let mut display: Option<String> = None;
    let mut mode: Option<String> = None;
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let key =
            fub_abi::rules::composition::composed(&fub_abi::rules::path::percent_decode(raw_key));
        let value =
            fub_abi::rules::composition::composed(&fub_abi::rules::path::percent_decode(raw_value));
        match key.as_str() {
            "uri" => {
                if uri.is_some() {
                    return Err("mobile-tree: `uri` duplicato".to_string());
                }
                if value.trim().is_empty() {
                    return Err("mobile-tree: `uri` vuota".to_string());
                }
                uri = Some(value);
            }
            "display" => {
                if display.is_some() {
                    return Err("mobile-tree: `display` duplicato".to_string());
                }
                display = Some(value).filter(|v| !v.trim().is_empty());
            }
            "mode" => {
                if mode.is_some() {
                    return Err("mobile-tree: `mode` duplicato".to_string());
                }
                mode = Some(value).filter(|v| !v.trim().is_empty());
            }
            other => return Err(format!("mobile-tree: chiave ignota `{other}`")),
        }
    }
    match uri {
        Some(uri) => Ok((uri, display, mode)),
        None => Err("mobile-tree senza `uri`".to_string()),
    }
}

/// Valida una callback di `fub://capture` con policy deny-default. Non apre
/// niente: chi chiama decide con approvazione utente.
pub fn validate_mobile_callback(raw: &str, policy: &CallbackPolicy) -> Result<String, PluginError> {
    automation::validate_callback(raw, policy).map_err(|e| e.to_plugin_error())
}

/// Policy di default per il mobile: nega tutto. `allow_http` resta spento:
/// solo schemi nominati esplicitamente passano, mai `javascript:`/`data:`.
pub fn mobile_callback_policy() -> CallbackPolicy {
    CallbackPolicy::deny_all()
}

// --- media: limiti e instradamento --------------------------------------------

/// Limiti allegati da share sheet, gli stessi di MediaOwner: inline max 64MiB
/// totali, letture IPC a chunk max 64KiB con ciclo short-read, fetch rete max
/// 16MiB (`Host::MAX_BODY` in `fub-host/src/net.rs`). Streaming su disco, mai
/// tutto in RAM; download remoti solo espliciti, mai all'apertura.
pub mod media_limits {
    /// Inline totale massimo per un allegato da share.
    pub const INLINE_MAX_BYTES: u64 = 64 * 1024 * 1024;
    /// Chunk massimo per lettura IPC.
    pub const IPC_CHUNK_MAX_BYTES: u64 = 64 * 1024;
    /// Fetch rete massimo (tetto host esistente).
    pub const FETCH_MAX_BYTES: u64 = 16 * 1024 * 1024;

    /// Il byte count dichiarato sta nei tetti? Puro, senza I/O.
    pub fn fits_inline(len: u64) -> bool {
        len <= INLINE_MAX_BYTES
    }

    /// Quanti chunk da `IPC_CHUNK_MAX_BYTES` servono per `len`.
    pub fn chunk_count(len: u64) -> u64 {
        len.div_ceil(IPC_CHUNK_MAX_BYTES)
    }
}

/// Specie di un file in arrivo dallo share, con la stessa regola di
/// `fub_abi::rules::media::kind_of`: vince l'estensione rivendicata da un
/// provider, altrimenti asset se MIME noto, unknown se ignoto. Qui si
/// risponde solo per instradare (documento vs allegato); la verità su est+MIME
/// resta in `media.rs` di MediaOwner.
pub fn classify_shared_name(name: &str, doc_extensions: &[String]) -> &'static str {
    let id = DocId::new(name);
    match fub_abi::rules::media::kind_of(&id, doc_extensions) {
        fub_abi::traits::EntryKind::Document => "document",
        fub_abi::traits::EntryKind::Asset => "asset",
        fub_abi::traits::EntryKind::Unknown => "unknown",
    }
}

// --- Wasmtime / Pulley: canale reale -------------------------------------------------
//
// L'interprete Pulley vive in `fub-wasm-host/src/limits.rs` (PluginOwner):
// `EngineBackend::{Native, Pulley}`, selezione via `FUB_WASM_BACKEND=pulley`
// -> `config.target("pulley64")` prima di `Engine::new`, epoch armata in ogni
// caso, `active()` espone il backend effettivo. Stesso `.wasm`, nessuna JIT:
// gira dove la JIT è vietata (iOS store, W^X) al prezzo della velocità.
// Smoke dichiarato da PluginOwner (su Linux, stesso .wasm):
// `FUB_WASM_BACKEND=pulley` + ping/format parse+query ok + ciclo-wasm trappato
// entro ~5s come su Cranelift. iOS resta mia: firma/entitlement/store
// (vietata JIT scrivibile), nessuna build iOS eseguita qui.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MobileWasmReport {
    pub requested_backend: String,
    pub active_backend: Option<String>,
    pub pulley_selected: bool,
    pub epoch_armed: bool,
    pub ios_store_jit_allowed: bool,
    pub android_verified_here: bool,
    pub native_features_affected: bool,
    pub smoke: &'static str,
}

impl MobileWasmReport {
    pub fn current() -> Self {
        let requested = fub_wasm_host::wasm_backend_name().to_string();
        let active = fub_wasm_host::wasm_backend_active_name().map(str::to_string);
        MobileWasmReport {
            requested_backend: requested.clone(),
            active_backend: active.clone(),
            pulley_selected: active.as_deref() == Some("pulley"),
            epoch_armed: active.is_some(),
            ios_store_jit_allowed: false,
            android_verified_here: false,
            native_features_affected: false,
            smoke: "FUB_WASM_BACKEND=pulley + ping/format + ciclo-wasm trap ~5s (PluginOwner, Linux; prova runtime Main)",
        }
    }
}

// --- packaging: prerequisiti rilevati, mai inventati -------------------------------

/// Prerequisiti di packaging rilevati su questa macchina. Nomi soltanto per i
/// segreti (mai valori): il signing resta esterno e fail-closed.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MobileBuildPrereqs {
    pub host_os: &'static str,
    pub android_targets_installed: Vec<String>,
    pub ios_targets_installed: Vec<String>,
    pub java_present: bool,
    pub android_sdk_present: bool,
    pub adb_present: bool,
    pub emulator_present: bool,
    pub xcodebuild_present: bool,
    pub swift_present: bool,
    pub cargo_tauri_present: bool,
    /// Nomi dei segreti attesi in CI (valori mai letti né stampati).
    pub android_secret_names: Vec<String>,
    pub ios_secret_names: Vec<String>,
    pub missing_for_android: Vec<String>,
    pub missing_for_ios: Vec<String>,
}

fn path_has(bin: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    for dir in std::env::split_paths(&paths) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return true;
        }
    }
    false
}

/// Rileva solo ciò che è rilevabile localmente (env + PATH + `rustup target
/// list --installed` NON eseguito qui: i target si dichiarano da manifest
/// workspace e verifica Main). Non installa niente, non scarica SDK.
pub fn probe_mobile_prereqs() -> MobileBuildPrereqs {
    let android_sdk_present = std::env::var_os("ANDROID_HOME")
        .or_else(|| std::env::var_os("ANDROID_SDK_ROOT"))
        .is_some();
    let mut missing_for_android = Vec::new();
    if !android_sdk_present {
        missing_for_android.push("ANDROID_HOME/ANDROID_SDK_ROOT".to_string());
    }
    if !path_has("adb") {
        missing_for_android.push("adb".to_string());
    }
    // java/keytool presenti su questa macchina (verifica Main): riportati in
    // `java_present`, mai come mancanti.
    let mut missing_for_ios = Vec::new();
    if !path_has("xcodebuild") {
        missing_for_ios.push("xcodebuild (runner macOS)".to_string());
    }
    if !path_has("swift") {
        missing_for_ios.push("swift".to_string());
    }
    MobileBuildPrereqs {
        host_os: std::env::consts::OS,
        android_targets_installed: Vec::new(),
        ios_targets_installed: Vec::new(),
        java_present: path_has("java"),
        android_sdk_present,
        adb_present: path_has("adb"),
        emulator_present: path_has("emulator"),
        xcodebuild_present: path_has("xcodebuild"),
        swift_present: path_has("swift"),
        cargo_tauri_present: path_has("cargo-tauri"),
        android_secret_names: vec![
            "ANDROID_KEYSTORE_PATH".to_string(),
            "ANDROID_KEYSTORE_PASSWORD".to_string(),
            "ANDROID_KEY_ALIAS".to_string(),
            "ANDROID_KEY_PASSWORD".to_string(),
        ],
        ios_secret_names: vec![
            "APPLE_DEVELOPMENT_TEAM".to_string(),
            "APPLE_API_KEY".to_string(),
            "APPLE_API_ISSUER".to_string(),
            "IOS_PROVISIONING_PROFILE".to_string(),
            "IOS_CERTIFICATE_P12".to_string(),
        ],
        missing_for_android,
        missing_for_ios,
    }
}

/// Valida senza scrivere. Il frontend conferma la destinazione prima di
/// `mobile_submit_capture`.
pub fn mobile_validate_capture(payload: MobileCapturePayload) -> Result<(), PluginError> {
    let _origin: &str = MOBILE_ORIGIN;
    validate_mobile_capture(&payload).map_err(|e| e.to_plugin_error())
}

/// Applica via unico `Host`, ritorna il DocId creato/toccato. Destinazione già
/// approvata in UI; template solo con create.
pub fn mobile_submit_capture(
    host: tauri::State<fub_host::Host>,
    payload: MobileCapturePayload,
    vault: Option<String>,
    template: Option<String>,
) -> Result<String, PluginError> {
    // La pianificazione share resta la via documentata testo->capture e file->allegato.
    let _plan_text = plan_shared_text as fn(&str, &str) -> PlannedCaptureText;
    let _plan_file = plan_share_file as fn(&str, u64, &str, &str) -> PlannedShare;
    let _classify = classify_shared_name as fn(&str, &[String]) -> &'static str;
    let _callback =
        validate_mobile_callback as fn(&str, &CallbackPolicy) -> Result<String, PluginError>;
    let _policy = mobile_callback_policy as fn() -> CallbackPolicy;
    let created = apply_mobile_capture(&host, vault.as_deref(), &payload, template.as_deref())?;
    Ok(created.as_str().to_string())
}

/// Radici private/condivise dal resolver. Niente valori inventati.
pub fn mobile_storage_roots(app: tauri::AppHandle) -> MobileStorageInfo {
    // Diagnostica build e base vault privata restano raggiungibili dal confine registrato.
    let _prereqs = probe_mobile_prereqs as fn() -> MobileBuildPrereqs;
    let _base = default_private_vault_base as fn(&tauri::AppHandle) -> Option<Utf8PathBuf>;
    mobile_storage_info(&app)
}

/// Registry dell'app disponibile anche prima di Host::open: schema futuro
/// rifiutato, nessun fallback al vault privato.
pub fn mobile_storage_preference(
    app: tauri::AppHandle,
) -> Result<MobileStoragePreference, PluginError> {
    load_mobile_storage_preference(&app)
}

pub fn mobile_set_storage_preference(
    app: tauri::AppHandle,
    preference: MobileStoragePreference,
) -> Result<MobileStoragePreference, PluginError> {
    persist_mobile_storage_preference(&app, preference)
}

/// Report JIT/WASM onesto per UI e release.
pub fn mobile_wasm_report() -> MobileWasmReport {
    MobileWasmReport::current()
}

/// Stessa classificazione usata da RunEvent::Opened, anche per un URL arrivato
/// prima che il webview abbia registrato il listener.
pub fn mobile_classify_opened_url(raw: String) -> Result<MobileOpenedUrl, PluginError> {
    classify_opened_url(&raw)
}

/// Valida il formato del grant senza montare o confermare il permesso OS.
/// `mobile_set_storage_preference` lo salva nella sandbox dell'app prima che
/// il primo vault sia aperto; ogni mount deve ri-verificare il grant nativo.
pub fn mobile_register_tree_grant(grant: MobileTreeGrant) -> Result<MobileTreeGrant, PluginError> {
    validate_tree_grant(&grant)?;
    // Il grant registrato alimenta la fotografia storage senza supporre permessi OS.
    let _attach = with_shared_grant as fn(MobileStorageInfo, MobileTreeGrant) -> MobileStorageInfo;
    Ok(grant)
}

/// Il webview non può attestare il grant OS né il CAS del provider: finché
/// SystemStorage non fornisce un verificatore nativo al comando, la proposta
/// resta NeedGrant. `decide_shared_mount` rimane la regola pura da usare SOLO
/// dopo verifica OS nel confine di montaggio; mai fidarsi dei booleani IPC.
pub fn mobile_shared_mount_mode(
    grant: Option<MobileTreeGrant>,
    backend_cas: bool,
    copy_accepted: bool,
) -> MobileMountMode {
    // La regola pura resta l'unica decisione documentata; finche' SystemStorage
    // non fornisce un verificatore nativo, il confine di montaggio non si fida
    // dei booleani IPC e la proposta resta NeedGrant.
    let _rule = decide_shared_mount as fn(Option<&MobileTreeGrant>, bool, bool) -> MobileMountMode;
    let _reason = shared_readonly_reason as fn(bool) -> Option<&'static str>;
    let _untrusted_proposal = (grant, backend_cas, copy_accepted);
    MobileMountMode::NeedGrant
}
#[cfg(mobile)]
#[tauri::mobile_entry_point]
fn mobile_entry() {
    crate::run();
}
/// Radice vault mobile consigliata: sandbox privata sotto `app_data_dir`, mai
/// una cartella condivisa di default. `None` se il resolver non risponde.
pub fn default_private_vault_base(app: &tauri::AppHandle) -> Option<Utf8PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|p| Utf8PathBuf::from_path_buf(p).ok())
        .map(|base| base.join("vaults"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(mode: CaptureMode, note: Option<&str>) -> MobileCapturePayload {
        MobileCapturePayload {
            v: 1,
            title: "Condiviso da app".to_string(),
            markdown: "# testo\n\ncorpo".to_string(),
            source_url: Some("https://example.com/pagina".to_string()),
            properties: None,
            target: MobileCaptureTarget {
                vault: None,
                folder: Some("Inbox".to_string()),
                note: note.map(str::to_string),
                mode,
            },
        }
    }

    #[test]
    fn storage_registry_rejects_future_schema_without_touching_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mobile-storage.json");
        std::fs::write(
            &path,
            br#"{"version":2,"revision":"next","choice":"shared","grant":null}"#,
        )
        .unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(read_storage_preference(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::write(
            &path,
            br#"{"version":1,"revision":"old","choice":"shared","grant":null}"#,
        )
        .unwrap();
        assert_eq!(
            read_storage_preference(&path).unwrap().choice,
            Some(MobileStorageKind::Shared)
        );
    }

    #[test]
    fn mobile_lifecycle_suspend_keeps_open_resume_rejoins() {
        assert_eq!(
            MobileLifecycle::Foreground.step(MobileLifecycle::Suspended),
            MobileLifecycleAction::KeepOpen
        );
        assert_eq!(
            MobileLifecycle::Suspended.step(MobileLifecycle::Foreground),
            MobileLifecycleAction::Rejoin
        );
    }

    #[test]
    fn mobile_capture_limits_mirror_automation() {
        assert!(validate_mobile_capture(&payload(CaptureMode::Create, None)).is_ok());
        assert!(validate_mobile_capture(&payload(CaptureMode::Append, None)).is_err());
        assert!(validate_mobile_capture(&payload(CaptureMode::Append, Some("Nota.md"))).is_ok());
        let mut bad = payload(CaptureMode::Create, None);
        bad.title = "   ".to_string();
        assert!(validate_mobile_capture(&bad).is_err());
        let mut big = payload(CaptureMode::Create, None);
        big.markdown = "x".repeat(MARKDOWN_MAX_BYTES + 1);
        assert!(validate_mobile_capture(&big).is_err());
        let mut traversal = payload(CaptureMode::Create, Some("../fuori.md"));
        traversal.target.folder = None;
        assert!(validate_mobile_capture(&traversal).is_err());
    }

    #[test]
    fn opened_url_classification_never_executes() {
        match OpenedUrlKind::classify("fub://search?vault=uno&q=ciao") {
            OpenedUrlKind::Fub(FubUri::Search { .. }) => {}
            other => panic!("search attesa, arrivata {other:?}"),
        }
        match OpenedUrlKind::classify("https://example.com/a") {
            OpenedUrlKind::HttpShare(_) => {}
            other => panic!("share attesa, arrivata {other:?}"),
        }
        assert!(matches!(
            OpenedUrlKind::classify("javascript:alert(1)"),
            OpenedUrlKind::Rejected(_)
        ));
        assert!(matches!(
            OpenedUrlKind::classify("fub://capture?exec=1"),
            OpenedUrlKind::Rejected(_)
        ));
    }

    #[test]
    fn media_limits_are_media_owner_values() {
        assert!(media_limits::fits_inline(64 * 1024 * 1024));
        assert!(!media_limits::fits_inline(64 * 1024 * 1024 + 1));
        assert_eq!(media_limits::chunk_count(64 * 1024), 1);
        assert_eq!(media_limits::chunk_count(64 * 1024 + 1), 2);
    }

    #[test]
    fn wasm_report_distinguishes_configured_and_active() {
        let report = MobileWasmReport::current();
        assert!(!report.ios_store_jit_allowed);
        assert!(!report.android_verified_here);
        assert!(!report.native_features_affected);
        assert_eq!(report.epoch_armed, report.active_backend.is_some());
        assert_eq!(
            report.pulley_selected,
            report.active_backend.as_deref() == Some("pulley")
        );
    }

    #[test]
    fn share_plan_routes_text_and_file() {
        let text = plan_shared_text("ciao", "text/plain");
        assert_eq!(text.mime, "text/plain");
        assert!(validate_mobile_capture(&text.payload).is_ok());
        let file = plan_share_file("Foto.png", 1024, "image/png", "attachments");
        assert!(matches!(file.route, ShareRoute::Attachment { .. }));
        let big = plan_share_file("film.mkv", 64 * 1024 * 1024 + 1, "video/mp4", "attachments");
        assert!(matches!(big.route, ShareRoute::Rejected { .. }));
    }

    #[test]
    fn tree_grant_rejects_file_picker_bypass() {
        let tree = MobileTreeGrant {
            platform: MobileGrantPlatform::Android,
            uri: "content://com.android.externalstorage.documents/tree/primary%3AFub".to_string(),
            display_name: Some("Fub".to_string()),
            persisted: true,
            read_write: true,
            bookmark_b64: None,
        };
        assert!(validate_tree_grant(&tree).is_ok());
        assert_eq!(
            decide_shared_mount(Some(&tree), true, false),
            MobileMountMode::ReadWrite
        );
        // File picker spacciato per tree: rifiuto, NeedGrant, mai mount.
        let file = MobileTreeGrant {
            platform: MobileGrantPlatform::Android,
            uri: "content://com.android.providers.downloads.documents/document/123".to_string(),
            display_name: None,
            persisted: true,
            read_write: true,
            bookmark_b64: None,
        };
        assert!(validate_tree_grant(&file).is_err());
        assert_eq!(
            decide_shared_mount(Some(&file), true, false),
            MobileMountMode::NeedGrant
        );
        let fake_tree = MobileTreeGrant {
            uri: "content://com.example.documents/document/42".to_string(),
            ..tree.clone()
        };
        assert!(validate_tree_grant(&fake_tree).is_err());
        // Senza CAS: ReadOnly con reason, mai scrittura assunta; con gesto
        // esplicito: CopyImport, mai fallback silenzioso al privato.
        assert_eq!(
            decide_shared_mount(Some(&tree), false, false),
            MobileMountMode::ReadOnly
        );
        assert!(shared_readonly_reason(false).is_some());
        assert!(shared_readonly_reason(true).is_none());
        assert_eq!(
            decide_shared_mount(Some(&tree), false, true),
            MobileMountMode::CopyImport
        );
        assert_eq!(
            decide_shared_mount(None, true, false),
            MobileMountMode::NeedGrant
        );
        // iOS senza bookmark: rifiuto.
        let ios = MobileTreeGrant {
            platform: MobileGrantPlatform::Ios,
            uri: "file:///private/var/mobile/Containers/Data/Fub".to_string(),
            display_name: None,
            persisted: true,
            read_write: true,
            bookmark_b64: None,
        };
        assert!(validate_tree_grant(&ios).is_err());
    }

    #[test]
    fn unused_mobile_helpers_keep_documented_contract() {
        assert_eq!(MOBILE_ORIGIN, "mobile-share");
        let base = MobileStorageInfo {
            private_dir: Some("/data".to_string()),
            shared_grant: None,
            shared_permission: MobilePermissionState::Unknown,
            offline_reliable_private: true,
            offline_reliable_shared: false,
            shared_mount: MobileMountMode::NeedGrant,
        };
        let grant = MobileTreeGrant {
            platform: MobileGrantPlatform::Android,
            uri: "content://com.android.externalstorage.documents/tree/primary%3AFub".to_string(),
            display_name: Some("Fub".to_string()),
            persisted: true,
            read_write: true,
            bookmark_b64: None,
        };
        let attached = with_shared_grant(base, grant);
        assert!(attached.shared_grant.is_some());
        assert_eq!(attached.shared_permission, MobilePermissionState::Unknown);
        assert!(
            validate_mobile_callback("fub://search?q=ciao", &mobile_callback_policy()).is_err()
        );
        assert_eq!(classify_shared_name("nota.md", &[]), "unknown");
        // Cosa manca dipende dalla macchina (il runner macOS ha SDK Android,
        // adb e Xcode): si pretende che l'elenco dica lo stesso delle sonde.
        let prereqs = probe_mobile_prereqs();
        assert_eq!(
            prereqs.missing_for_android.is_empty(),
            prereqs.android_sdk_present && prereqs.adb_present
        );
        assert_eq!(
            prereqs.missing_for_ios.is_empty(),
            prereqs.xcodebuild_present && prereqs.swift_present
        );
    }

    #[test]
    fn mobile_tree_url_classifies_before_automation_parser() {
        match OpenedUrlKind::classify(
            "fub://mobile-tree?uri=content%3A%2F%2Ftree%2Fprimario&display=Fub",
        ) {
            OpenedUrlKind::TreeGrant { uri, display, .. } => {
                assert!(uri.starts_with("content://"));
                assert_eq!(display.as_deref(), Some("Fub"));
            }
            other => panic!("tree grant atteso, arrivato {other:?}"),
        }
        assert!(matches!(
            OpenedUrlKind::classify("fub://mobile-tree?display=SoloNome"),
            OpenedUrlKind::Rejected(_)
        ));
        assert!(matches!(
            OpenedUrlKind::classify("fub://mobile-tree?uri=x&exec=1"),
            OpenedUrlKind::Rejected(_)
        ));
        assert_eq!(
            classify_opened_url("fub://mobile-switcher").unwrap().kind,
            "mobile_switcher"
        );
        assert!(classify_opened_url("fub://mobile-switcher?exec=1").is_err());
        assert!(classify_opened_url("fub://mobile-treeevil?uri=x").is_err());
    }
}
