//! Automazione locale P13: URI `fub://`, callback validate e ingresso capture v1.
//!
//! Sorgente unica delle tre cose che clipper, mobile e CLI devono leggere
//! allo stesso modo: il parser puro degli URI, la policy delle callback e il
//! validatore del payload di capture. Non tocca il disco, non apre socket,
//! non scrive in nessun vault: valida e basta. Chi scrive (la CLI, l'host
//! nativo, l'app) riusa queste firme invece di ricopiarle.
//!
//! I limiti congelati con ClipperOwner:
//! title non vuoto <=512 caratteri, markdown non vuoto <=1MiB byte,
//! source_url http/https <=2048, folder/note relativi senza `..`/assoluti/drive,
//! envelope {nonce univoco, origin `clipper-extension`}, framing NM max 2MiB.

use fs2::FileExt;
use serde::{Deserialize, Serialize};

/// Il suffisso del **lock di scrittura** di un vault: il file è fratello della
/// radice, `<cartella madre>/.<nome>.writer.lock`, come il lock degli snapshot.
///
/// Sta fuori dal vault apposta. Uno snapshot applicato sostituisce la radice
/// intera con una rename, e l'azzeramento della demo la cancella: un lock
/// dentro `.fub/` cambiava inode in tutti e due i casi, e un secondo processo
/// otteneva un lock «nuovo» mentre il primo credeva di tenere ancora il vecchio.
/// Il file non si rimuove mai: l'inode deve restare lo stesso fra i processi.
pub const WRITER_LOCK_SUFFIX: &str = ".writer.lock";

/// La chiave di catalogo dell'errore «un altro processo sta già scrivendo in
/// questo vault». Viaggia in un [`PluginError::Conflict`](fub_abi::PluginError):
/// chi deve distinguerlo da un altro conflitto usa [`is_writer_busy`].
pub const E_WRITER_BUSY: &str = "host.vault.writer_busy";

/// Il possesso esclusivo, fra processi, del diritto di scrivere in un vault.
///
/// Lo prende [`Host`](crate::Host) quando apre un vault e lo tiene la sessione
/// finché non è chiusa: le shell (app, CLI, host nativo) non lo prendono da
/// sé. L'handle aperto è il lease; chiuderlo lo rilascia, anche se il processo
/// muore.
pub struct VaultWriterLock {
    _file: std::fs::File,
}

/// Il path del lock di scrittura di `root`, che deve essere già canonica.
pub fn writer_lock_path(root: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
    let invalid = || {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault root has no parent for its writer lock",
        )
    };
    let parent = root.parent().ok_or_else(invalid)?;
    let name = root.file_name().ok_or_else(invalid)?;
    let mut file = std::ffi::OsString::from(".");
    file.push(name);
    file.push(WRITER_LOCK_SUFFIX);
    Ok(parent.join(file))
}

/// Prende il lock di scrittura di `root` (canonica) senza aspettare:
/// `WouldBlock` se un altro lo tiene.
pub(crate) fn lock_vault_writer(root: &std::path::Path) -> std::io::Result<VaultWriterLock> {
    let path = writer_lock_path(root)?;
    if std::fs::symlink_metadata(&path)
        .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "vault writer lock is not a regular file",
        ));
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    // `fs2` maps to `flock`/`LockFileEx` and keeps the process-crash
    // semantics on every desktop target. The open handle owns the lease.
    file.try_lock_exclusive()?;
    Ok(VaultWriterLock { _file: file })
}

/// L'errore è «un altro processo scrive già in questo vault»?
pub fn is_writer_busy(error: &fub_abi::PluginError) -> bool {
    matches!(
        error,
        fub_abi::PluginError::Conflict(fub_abi::text::Text::Message(message))
            if message.key == E_WRITER_BUSY
    )
}

// ---------------------------------------------------------------------------
// Errori tipizzati
// ---------------------------------------------------------------------------

/// Specie congelate sul filo clipper/CLI: le stesse cinque che la CLI mappa
/// su exit code e che l'NM rimanda come `{ok:false,kind,message}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationKind {
    BadArgs,
    Unavailable,
    Denied,
    NotFound,
    Conflict,
}

impl AutomationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationKind::BadArgs => "bad_args",
            AutomationKind::Unavailable => "unavailable",
            AutomationKind::Denied => "denied",
            AutomationKind::NotFound => "not_found",
            AutomationKind::Conflict => "conflict",
        }
    }
}

/// Errore di validazione/autorizzazione: specie + frase. La frase non contiene
/// mai segreti: chi chiama redact prima di loggare.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutomationError {
    kind: AutomationKind,
    message: String,
}

impl AutomationError {
    pub fn new(kind: AutomationKind, message: impl Into<String>) -> Self {
        AutomationError {
            kind,
            message: message.into(),
        }
    }
    pub fn bad_args(message: impl Into<String>) -> Self {
        Self::new(AutomationKind::BadArgs, message)
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(AutomationKind::Unavailable, message)
    }
    pub fn denied(message: impl Into<String>) -> Self {
        Self::new(AutomationKind::Denied, message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(AutomationKind::NotFound, message)
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(AutomationKind::Conflict, message)
    }
    pub fn kind(&self) -> AutomationKind {
        self.kind
    }
    pub fn kind_str(&self) -> &'static str {
        self.kind.as_str()
    }
    pub fn message(&self) -> &str {
        &self.message
    }
    /// Traduzione sul confine host: le cinque specie restano distinguibili.
    pub fn to_plugin_error(&self) -> fub_abi::PluginError {
        let text: fub_abi::text::Text = self.message.clone().into();
        match self.kind {
            AutomationKind::BadArgs => fub_abi::PluginError::BadArgs(text),
            AutomationKind::Unavailable => fub_abi::PluginError::Unserved(text),
            AutomationKind::Denied => fub_abi::PluginError::PermissionDenied(text),
            AutomationKind::NotFound => fub_abi::PluginError::NotFound(text),
            AutomationKind::Conflict => fub_abi::PluginError::Conflict(text),
        }
    }
}

impl std::fmt::Display for AutomationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)
    }
}

fn contains_nul(s: &str) -> bool {
    s.as_bytes().contains(&0)
}
// ---------------------------------------------------------------------------
// Limiti congelati
// ---------------------------------------------------------------------------

/// Versione payload capture.
pub const CAPTURE_V1: u8 = 1;
/// Titolo: caratteri Unicode, non byte: `é` conta uno.
pub const TITLE_MAX_CHARS: usize = 512;
/// Markdown: byte, non caratteri: è ciò che attraversa il filo.
pub const MARKDOWN_MAX_BYTES: usize = 1024 * 1024;
/// URL sorgente: byte.
pub const SOURCE_URL_MAX_BYTES: usize = 2048;
/// Frame NM: JSON serializzato, non markdown.
pub const NM_MAX_BYTES: usize = 2 * 1024 * 1024;
/// URI totale: un markdown da 1MiB via query resta sotto il tetto NM.
pub const URI_MAX_BYTES: usize = 2 * 1024 * 1024;
/// Nonce/envelope.
pub const NONCE_MAX_CHARS: usize = 256;
/// Origine attesa dall'estensione.
pub const CLIPPER_ORIGIN: &str = "clipper-extension";
/// Nome host NM registrato nei manifest browser.
pub const NM_HOST_NAME: &str = "local.fub.clipper";
/// Specie richiesta NM.
pub const NM_REQUEST_KIND: &str = "fub-capture-v1";

// ---------------------------------------------------------------------------
// Capture v1
// ---------------------------------------------------------------------------

/// Dove scrivere: gli stessi quattro modi della CLI (`create`/`append`/
/// `prepend`/`daily`). Serde lowercase per il filo JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Create,
    Append,
    Prepend,
    Daily,
}

impl CaptureMode {
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureMode::Create => "create",
            CaptureMode::Append => "append",
            CaptureMode::Prepend => "prepend",
            CaptureMode::Daily => "daily",
        }
    }
    pub fn parse(raw: &str) -> Result<Self, AutomationError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "create" => Ok(CaptureMode::Create),
            "append" => Ok(CaptureMode::Append),
            "prepend" => Ok(CaptureMode::Prepend),
            "daily" => Ok(CaptureMode::Daily),
            other => Err(AutomationError::bad_args(format!(
                "`mode` deve essere create|append|prepend|daily, non `{other}`"
            ))),
        }
    }
}

/// Destinazione: tutto opzionale tranne `mode`; ciò che manca lo sceglie
/// l'utente in approvazione (URI/file) o il pairing (NM).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub mode: CaptureMode,
}

/// Payload versionato condiviso da file, URI, CLI e native messaging.
/// La versione è obbligatoria; il validatore rifiuta le versioni sconosciute.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapturePayloadV1 {
    pub v: u8,
    pub title: String,
    pub markdown: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<serde_json::Map<String, serde_json::Value>>,
    pub target: CaptureTarget,
}

/// Busta: idempotenza (`nonce` riusato sui retry) + provenienza.
///
/// `extension_id` è l'estensione che ha emesso la richiesta (self-asserted sul
/// filo, ma il canale NM lo raggiunge solo l'estensione che il browser ha
/// autorizzato nel manifest: è il browser a tenere fuori le altre). Il pairing
/// (`fub-cli pair`) confronta questo valore: senza, nessuna scrittura NM.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureEnvelope {
    pub nonce: String,
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<u64>,
}
/// Richiesta NM: la sola forma che il canale autenticato accetta.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NmRequest {
    pub kind: String,
    pub v: u8,
    pub envelope: CaptureEnvelope,
    pub payload: CapturePayloadV1,
}

/// Risposta NM. `needs_pairing` distingue "mai accoppiato" da "negato".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NmResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs_pairing: Option<bool>,
}

impl NmResponse {
    pub fn ok(nonce: &str) -> Self {
        NmResponse {
            ok: true,
            nonce: Some(nonce.to_string()),
            kind: None,
            message: None,
            needs_pairing: None,
        }
    }
    pub fn err(kind: AutomationKind, message: impl Into<String>) -> Self {
        NmResponse {
            ok: false,
            nonce: None,
            kind: Some(kind.as_str().to_string()),
            message: Some(message.into()),
            needs_pairing: None,
        }
    }
    pub fn needs_pairing(nonce: Option<&str>, message: impl Into<String>) -> Self {
        NmResponse {
            ok: false,
            nonce: nonce.map(str::to_string),
            kind: Some(AutomationKind::Denied.as_str().to_string()),
            message: Some(message.into()),
            needs_pairing: Some(true),
        }
    }
}

fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

fn validate_vault_field(vault: &str) -> Result<(), AutomationError> {
    if vault.trim().is_empty() {
        return Err(AutomationError::bad_args("`vault` vuoto"));
    }
    if vault.len() > 1024 {
        return Err(AutomationError::bad_args("`vault` oltre 1024 byte"));
    }
    if contains_nul(vault) || has_control(vault) {
        return Err(AutomationError::bad_args(
            "`vault` con caratteri di controllo",
        ));
    }
    for seg in vault.replace('\\', "/").split('/') {
        if seg == ".." {
            return Err(AutomationError::bad_args("`vault` non risale (`..`)"));
        }
    }
    Ok(())
}

/// Un path di destinazione (`folder`, `note`, `template`) dentro il recinto:
/// per i nomi nuovi la portabilità stretta, per gli esistenti il solo
/// recinto. La usa anche [`crate::capture`] per il template.
pub(crate) fn validate_target_path(
    field: &str,
    value: &str,
    is_new: bool,
) -> Result<(), AutomationError> {
    if value.trim().is_empty() {
        return Err(AutomationError::bad_args(format!("`{field}` vuoto")));
    }
    if value.len() > 1024 {
        return Err(AutomationError::bad_args(format!(
            "`{field}` oltre 1024 byte"
        )));
    }
    if contains_nul(value) {
        return Err(AutomationError::bad_args(format!("`{field}` con NUL")));
    }
    // Recinto esterno+tolleranza identici al contratto: `\` -> `/`, via
    // `from_outside`, poi `check`. Per i nomi nuovi (create/daily) la
    // portabilità stretta, per gli esistenti il solo recinto+macchina.
    let clean = fub_abi::rules::path_policy::from_outside(value);
    if clean.is_empty() {
        return Err(AutomationError::bad_args(format!("`{field}` vuoto")));
    }
    // Rifiuto esplicito di assoluti/drive/`..`: `from_outside` spoglia le
    // barre iniziali per cortesia, ma `C:` e `..` restano visibili a `check`.
    if value.trim_start().starts_with('/') || value.trim_start().starts_with('\\') {
        // Le barre di cortesia si accettano solo se il resto è valido: non
        // è un errore qui, `check` giudica il resto.
    }
    let naming = if is_new {
        fub_abi::rules::path_policy::Naming::New
    } else {
        fub_abi::rules::path_policy::Naming::Existing
    };
    fub_abi::rules::path_policy::check(&clean, naming).map_err(|why| {
        AutomationError::bad_args(format!("`{field}` non nomina dentro il vault: {why}"))
    })?;
    Ok(())
}

/// Valida la busta: nonce non vuoto, origin attesa, timestamp sensato.
pub fn validate_envelope(envelope: &CaptureEnvelope) -> Result<(), AutomationError> {
    if envelope.nonce.trim().is_empty() {
        return Err(AutomationError::bad_args("`nonce` vuoto"));
    }
    if envelope.nonce.chars().count() > NONCE_MAX_CHARS {
        return Err(AutomationError::bad_args("`nonce` oltre 256 caratteri"));
    }
    if has_control(&envelope.nonce) || contains_nul(&envelope.nonce) {
        return Err(AutomationError::bad_args(
            "`nonce` con caratteri di controllo",
        ));
    }
    if envelope.origin != CLIPPER_ORIGIN {
        return Err(AutomationError::bad_args(format!(
            "`origin` deve essere `{CLIPPER_ORIGIN}`"
        )));
    }
    match envelope.extension_id.as_deref() {
        None => {}
        Some(id) if id.trim().is_empty() => {
            return Err(AutomationError::bad_args("`extension_id` vuoto"));
        }
        Some(id) => {
            if id.len() > 256 || has_control(id) || contains_nul(id) {
                return Err(AutomationError::bad_args("`extension_id` non valido"));
            }
            if id.contains(['/', '\\', ' ', '"', '\'']) {
                return Err(AutomationError::bad_args("`extension_id` non valido"));
            }
        }
    }
    if let Some(ts) = envelope.timestamp_ms {
        if ts == 0 {
            return Err(AutomationError::bad_args("`timestamp_ms` zero"));
        }
    }
    Ok(())
}

/// Valida il payload v1 con gli stessi limiti su ogni trasporto.
pub fn validate_capture_v1(payload: &CapturePayloadV1) -> Result<(), AutomationError> {
    if payload.v != CAPTURE_V1 {
        return Err(AutomationError::bad_args(format!(
            "`v` deve essere {}, non {}",
            CAPTURE_V1, payload.v
        )));
    }
    validate_title(&payload.title)?;
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
            if key.len() > 128 {
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
        if encoded.len() > 65536 {
            return Err(AutomationError::bad_args("`properties` oltre 64KiB"));
        }
    }
    let is_new = matches!(
        payload.target.mode,
        CaptureMode::Create | CaptureMode::Daily
    );
    if let Some(vault) = &payload.target.vault {
        validate_vault_field(vault)?;
    }
    if let Some(folder) = &payload.target.folder {
        validate_target_path("folder", folder, true)?;
    }
    if let Some(note) = &payload.target.note {
        validate_target_path("note", note, is_new)?;
    }
    // `daily` senza nota va alla giornaliera; `append`/`prepend` pretendono la nota.
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

/// Il titolo di una cattura o di una nota nuova: non vuoto, al più
/// [`TITLE_MAX_CHARS`] caratteri, su una riga sola e senza caratteri di
/// controllo, perché diventa la riga `# {title}` del documento.
pub(crate) fn validate_title(title: &str) -> Result<(), AutomationError> {
    if title.trim().is_empty() {
        return Err(AutomationError::bad_args("`title` vuoto"));
    }
    if title.chars().count() > TITLE_MAX_CHARS {
        return Err(AutomationError::bad_args("`title` oltre 512 caratteri"));
    }
    if has_control(title) {
        return Err(AutomationError::bad_args("`title` con a-capo o controllo"));
    }
    Ok(())
}

/// La `source_url` di una cattura: http o https, con un host e senza
/// credenziali. È anche la regola con cui la shell mobile riconosce un link
/// condiviso.
pub fn validate_source_url(url: &str) -> Result<(), AutomationError> {
    if url.trim().is_empty() {
        return Err(AutomationError::bad_args("`source_url` vuota"));
    }
    if url.len() > SOURCE_URL_MAX_BYTES {
        return Err(AutomationError::bad_args("`source_url` oltre 2048 byte"));
    }
    if has_control(url) || contains_nul(url) || url.contains(' ') {
        return Err(AutomationError::bad_args(
            "`source_url` con spazi/controllo",
        ));
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AutomationError::bad_args("`source_url` solo http/https"));
    }
    let after = url.split_once("://").map(|(_, after)| after).unwrap_or("");
    let host = after.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() {
        return Err(AutomationError::bad_args("`source_url` senza host"));
    }
    if host.contains('@') {
        return Err(AutomationError::bad_args("`source_url` senza credenziali"));
    }
    Ok(())
}

/// Valida la richiesta NM intera (specie + busta + payload).
pub fn validate_nm_request(request: &NmRequest) -> Result<(), AutomationError> {
    if request.kind != NM_REQUEST_KIND {
        return Err(AutomationError::bad_args(format!(
            "`kind` deve essere `{NM_REQUEST_KIND}`"
        )));
    }
    if request.v != CAPTURE_V1 {
        return Err(AutomationError::bad_args("`v` deve essere 1"));
    }
    validate_envelope(&request.envelope)?;
    validate_capture_v1(&request.payload)?;
    Ok(())
}

// Attachment bytes travel only over the paired native channel. A capture-v1
// URI/file remains metadata-only; in particular no URL is fetched by the host.
pub const NM_ATTACHMENT_BEGIN_KIND: &str = "fub-attachment-begin-v1";
pub const NM_ATTACHMENT_CHUNK_KIND: &str = "fub-attachment-chunk-v1";
pub const NM_ATTACHMENT_COMMIT_KIND: &str = "fub-attachment-commit-v1";
pub const ATTACHMENT_MAX_BYTES: u64 = 25 * 1024 * 1024;
pub const ATTACHMENT_CHUNK_MAX_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachmentMeta {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NmAttachmentBegin {
    pub kind: String,
    pub v: u8,
    pub envelope: CaptureEnvelope,
    pub target: CaptureTarget,
    pub attachment: AttachmentMeta,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NmAttachmentChunk {
    pub kind: String,
    pub v: u8,
    pub envelope: CaptureEnvelope,
    pub transfer_id: String,
    pub index: u32,
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NmAttachmentCommit {
    pub kind: String,
    pub v: u8,
    pub envelope: CaptureEnvelope,
    pub transfer_id: String,
}

fn attachment_header(
    kind: &str,
    expected: &str,
    v: u8,
    envelope: &CaptureEnvelope,
) -> Result<(), AutomationError> {
    if kind != expected || v != CAPTURE_V1 {
        return Err(AutomationError::bad_args(
            "NM: specie/versione attachment non valida",
        ));
    }
    validate_envelope(envelope)?;
    if envelope.extension_id.is_none() {
        return Err(AutomationError::denied("NM: attachment richiede pairing"));
    }
    Ok(())
}

fn validate_transfer_id(id: &str) -> Result<(), AutomationError> {
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AutomationError::bad_args("NM: transfer_id non valido"));
    }
    Ok(())
}

pub fn validate_nm_attachment_begin(request: &NmAttachmentBegin) -> Result<(), AutomationError> {
    attachment_header(
        &request.kind,
        NM_ATTACHMENT_BEGIN_KIND,
        request.v,
        &request.envelope,
    )?;
    let target = &request.target;
    if target.mode != CaptureMode::Create || target.note.is_some() {
        return Err(AutomationError::bad_args(
            "NM: attachment richiede target create senza note",
        ));
    }
    if let Some(vault) = target.vault.as_deref() {
        validate_vault_field(vault)?;
    }
    if let Some(folder) = target.folder.as_deref() {
        validate_target_path("folder", folder, true)?;
    }
    let meta = &request.attachment;
    if meta.name.is_empty()
        || meta.name.len() > 255
        || meta.name == "."
        || meta.name == ".."
        || meta.name.contains(['/', '\\', ':'])
        || has_control(&meta.name)
    {
        return Err(AutomationError::bad_args("NM: nome attachment non valido"));
    }
    validate_target_path("attachment.name", &meta.name, true)?;
    if meta.bytes == 0 || meta.bytes > ATTACHMENT_MAX_BYTES {
        return Err(AutomationError::bad_args(
            "NM: attachment oltre 25MiB o vuoto",
        ));
    }
    if meta.sha256.len() != 64
        || !meta
            .sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AutomationError::bad_args(
            "NM: SHA-256 attachment non valido",
        ));
    }
    Ok(())
}

pub fn validate_nm_attachment_chunk(request: &NmAttachmentChunk) -> Result<(), AutomationError> {
    attachment_header(
        &request.kind,
        NM_ATTACHMENT_CHUNK_KIND,
        request.v,
        &request.envelope,
    )?;
    validate_transfer_id(&request.transfer_id)?;
    // A strict padded base64 wire encoding. The decoded size is bounded
    // before allocation; the host decoder still rejects malformed padding.
    let data = request.data.as_bytes();
    if data.is_empty()
        || data.len() % 4 != 0
        || data.len() > ATTACHMENT_CHUNK_MAX_BYTES.div_ceil(3) * 4
        || !data
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/' || *b == b'=')
    {
        return Err(AutomationError::bad_args(
            "NM: chunk base64 non valido o troppo grande",
        ));
    }
    if request.index >= 64 {
        return Err(AutomationError::bad_args("NM: indice chunk fuori limite"));
    }
    Ok(())
}

pub fn validate_nm_attachment_commit(request: &NmAttachmentCommit) -> Result<(), AutomationError> {
    attachment_header(
        &request.kind,
        NM_ATTACHMENT_COMMIT_KIND,
        request.v,
        &request.envelope,
    )?;
    validate_transfer_id(&request.transfer_id)
}

/// The attachment inherits the same scope as its destination. The host must
/// repeat this gate on begin, chunk and commit, binding transfer to extension
/// id and target; no self-asserted transfer id conveys authority.
pub fn nm_attachment_write_gate(
    pairs: &[PairEntry],
    envelope: &CaptureEnvelope,
    target: &CaptureTarget,
) -> Result<(), (AutomationError, bool)> {
    let Some(id) = envelope.extension_id.as_deref() else {
        return Err((
            AutomationError::denied("NM: attachment richiede pairing"),
            true,
        ));
    };
    let folder = target.folder.as_deref().unwrap_or("");
    if pair_allows(pairs, id, target.vault.as_deref(), folder) {
        Ok(())
    } else {
        Err((
            AutomationError::denied("NM: attachment fuori dall'ambito del pairing"),
            true,
        ))
    }
}

// ---------------------------------------------------------------------------
// URI fub://
// ---------------------------------------------------------------------------

/// Le sei azioni: stesse firme che MobileOwner riusa senza duplicare il parser.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FubUri {
    Open {
        vault: Option<String>,
        note: Option<String>,
        heading: Option<String>,
        block: Option<String>,
        split: Option<String>,
        window: Option<String>,
    },
    New {
        vault: Option<String>,
        folder: Option<String>,
        name: Option<String>,
        title: Option<String>,
        template: Option<String>,
    },
    Daily {
        vault: Option<String>,
        date: Option<String>,
    },
    Unique {
        vault: Option<String>,
        folder: Option<String>,
        prefix: Option<String>,
    },
    Search {
        vault: Option<String>,
        q: Option<String>,
        tag: Option<String>,
        folder: Option<String>,
    },
    Capture {
        vault: Option<String>,
        folder: Option<String>,
        note: Option<String>,
        mode: Option<CaptureMode>,
        title: Option<String>,
        markdown: Option<String>,
        source_url: Option<String>,
        success_callback: Option<String>,
        error_callback: Option<String>,
    },
}

impl FubUri {
    pub fn action(&self) -> &'static str {
        match self {
            FubUri::Open { .. } => "open",
            FubUri::New { .. } => "new",
            FubUri::Daily { .. } => "daily",
            FubUri::Unique { .. } => "unique",
            FubUri::Search { .. } => "search",
            FubUri::Capture { .. } => "capture",
        }
    }
}

/// Policy callback: deny di default. `allowed_schemes` nomina ciò che si può
/// aprire senza chiedere; `allow_http` apre `http://localhost|127.0.0.1` per
/// sviluppo esplicito. `javascript:`/`data:`/`vbscript:` mai, nemmeno in lista.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CallbackPolicy {
    pub allowed_schemes: Vec<String>,
    pub allow_http: bool,
}

impl CallbackPolicy {
    pub fn deny_all() -> Self {
        CallbackPolicy {
            allowed_schemes: Vec::new(),
            allow_http: false,
        }
    }
}

fn decode_param(value: &str) -> String {
    // Canonicalizzazione encoding: percent-decode + NFC, la stessa per ogni
    // trasporto. `+` resta `+`: nei query fub:// non è spazio.
    let decoded = fub_abi::rules::path::percent_decode(value);
    fub_abi::rules::composition::composed(&decoded)
}

fn parse_query_pairs(query: &str) -> Result<Vec<(String, String)>, AutomationError> {
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    if query.is_empty() {
        return Ok(out);
    }
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let key = decode_param(raw_key).trim().to_string();
        if key.is_empty() {
            return Err(AutomationError::bad_args("parametro senza nome"));
        }
        if !seen.insert(key.clone()) {
            return Err(AutomationError::bad_args(format!(
                "parametro `{key}` duplicato"
            )));
        }
        if key.len() > 128 {
            return Err(AutomationError::bad_args("nome parametro oltre 128 byte"));
        }
        let value = decode_param(raw_value);
        if value.len() > MARKDOWN_MAX_BYTES {
            return Err(AutomationError::bad_args(format!(
                "parametro `{key}` oltre 1MiB"
            )));
        }
        out.push((key, value));
    }
    Ok(out)
}

fn lookup(pairs: &[(String, String)], key: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .filter(|v| !v.is_empty())
}

fn ensure_no_traversal(field: &str, value: &str, is_new: bool) -> Result<(), AutomationError> {
    validate_target_path(field, value, is_new)
}

fn validate_heading(value: &str) -> Result<(), AutomationError> {
    if value.trim().is_empty() {
        return Err(AutomationError::bad_args("`heading` vuoto"));
    }
    if value.len() > 1024 {
        return Err(AutomationError::bad_args("`heading` oltre 1024 byte"));
    }
    if contains_nul(value) || has_control(value) {
        return Err(AutomationError::bad_args("`heading` con controllo"));
    }
    Ok(())
}

fn validate_block(value: &str) -> Result<(), AutomationError> {
    if value.trim().is_empty() {
        return Err(AutomationError::bad_args("`block` vuoto"));
    }
    if value.len() > 256 {
        return Err(AutomationError::bad_args("`block` oltre 256 byte"));
    }
    if value.contains(['#', '?', '&', '/']) || contains_nul(value) || has_control(value) {
        return Err(AutomationError::bad_args(
            "`block` con caratteri non ammessi",
        ));
    }
    Ok(())
}

fn validate_date(value: &str) -> Result<(), AutomationError> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(AutomationError::bad_args("`date` deve essere YYYY-MM-DD"));
    }
    let year: u32 = parts[0]
        .parse()
        .map_err(|_| AutomationError::bad_args("`date` anno non numerico"))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| AutomationError::bad_args("`date` mese non numerico"))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| AutomationError::bad_args("`date` giorno non numerico"))?;
    if !(1970..=2100).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(AutomationError::bad_args("`date` fuori intervallo"));
    }
    // Giorni per mese con bisestile: il confine che nessuno prova.
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if day > max_day {
        return Err(AutomationError::bad_args("`date` giorno inesistente"));
    }
    Ok(())
}

/// Parser puro: nessuna I/O, nessun vault aperto, nessuna callback seguita.
/// Rifiuta traversal, azioni ignote e operazioni privilegiate implicite.
pub fn parse_fub_uri(raw: &str) -> Result<FubUri, AutomationError> {
    if raw.len() > URI_MAX_BYTES {
        return Err(AutomationError::bad_args("URI oltre 2MiB"));
    }
    if contains_nul(raw) || has_control(raw) {
        return Err(AutomationError::bad_args("URI con controllo"));
    }
    let rest = raw
        .strip_prefix("fub://")
        .ok_or_else(|| AutomationError::bad_args("lo schema deve essere `fub://`"))?;
    let (action_part, query_part) = match rest.split_once('?') {
        Some((a, q)) => (a, Some(q)),
        None => (rest, None),
    };
    // L'azione è l'authority: `fub://open`, mai `fub:///open` né path.
    if action_part.is_empty() {
        return Err(AutomationError::bad_args("azione assente"));
    }
    if action_part.contains('/') || action_part.contains('#') {
        return Err(AutomationError::bad_args(
            "l'azione è l'authority, senza path",
        ));
    }
    let action = action_part.trim().to_ascii_lowercase();
    let pairs = parse_query_pairs(query_part.unwrap_or(""))?;
    // Chiavi ignote: rifiutate, non ignorate. Una chiave che nessuno legge è
    // il modo in cui un `exec=1` passa per cortesia.
    let known: &[&str] = match action.as_str() {
        "open" => &["vault", "note", "heading", "block", "split", "window"],
        "new" => &["vault", "folder", "name", "title", "template"],
        "daily" => &["vault", "date"],
        "unique" => &["vault", "folder", "prefix"],
        "search" => &["vault", "q", "tag", "folder"],
        "capture" => &[
            "vault",
            "folder",
            "note",
            "mode",
            "title",
            "markdown",
            "source_url",
            "success_callback",
            "error_callback",
        ],
        _ => {
            return Err(AutomationError::bad_args(format!(
                "azione sconosciuta `{action}` (open|new|daily|unique|search|capture)"
            )))
        }
    };
    for (key, _) in &pairs {
        if !known.contains(&key.as_str()) {
            return Err(AutomationError::bad_args(format!(
                "parametro `{key}` non dichiarato per `{action}`"
            )));
        }
    }
    // Vault comune: stesso recinto ovunque.
    if let Some(vault) = lookup(&pairs, "vault") {
        validate_vault_field(&vault)?;
    }
    match action.as_str() {
        "open" => {
            let note = lookup(&pairs, "note");
            let heading = lookup(&pairs, "heading");
            let block = lookup(&pairs, "block");
            let split = lookup(&pairs, "split");
            let window = lookup(&pairs, "window");
            if let Some(n) = &note {
                ensure_no_traversal("note", n, false)?;
            }
            if let Some(h) = &heading {
                validate_heading(h)?;
            }
            if let Some(b) = &block {
                validate_block(b)?;
            }
            if let Some(s) = &split {
                if s.len() > 64 || s.trim().is_empty() || has_control(s) {
                    return Err(AutomationError::bad_args("`split` non valido"));
                }
            }
            if let Some(w) = &window {
                if w.len() > 64 || w.trim().is_empty() || has_control(w) {
                    return Err(AutomationError::bad_args("`window` non valido"));
                }
            }
            Ok(FubUri::Open {
                vault: lookup(&pairs, "vault"),
                note,
                heading,
                block,
                split,
                window,
            })
        }
        "new" => {
            let folder = lookup(&pairs, "folder");
            let name = lookup(&pairs, "name");
            let title = lookup(&pairs, "title");
            let template = lookup(&pairs, "template");
            if let Some(f) = &folder {
                ensure_no_traversal("folder", f, true)?;
            }
            if let Some(n) = &name {
                ensure_no_traversal("name", n, true)?;
            }
            if let Some(t) = &title {
                validate_title(t)?;
            }
            if let Some(t) = &template {
                ensure_no_traversal("template", t, false)?;
            }
            Ok(FubUri::New {
                vault: lookup(&pairs, "vault"),
                folder,
                name,
                title,
                template,
            })
        }
        "daily" => {
            let date = lookup(&pairs, "date");
            if let Some(d) = &date {
                validate_date(d)?;
            }
            Ok(FubUri::Daily {
                vault: lookup(&pairs, "vault"),
                date,
            })
        }
        "unique" => {
            let folder = lookup(&pairs, "folder");
            let prefix = lookup(&pairs, "prefix");
            if let Some(f) = &folder {
                ensure_no_traversal("folder", f, true)?;
            }
            if let Some(p) = &prefix {
                if p.trim().is_empty() || p.len() > 128 || has_control(p) || p.contains('/') {
                    return Err(AutomationError::bad_args("`prefix` non valido"));
                }
            }
            Ok(FubUri::Unique {
                vault: lookup(&pairs, "vault"),
                folder,
                prefix,
            })
        }
        "search" => {
            let q = lookup(&pairs, "q");
            let tag = lookup(&pairs, "tag");
            let folder = lookup(&pairs, "folder");
            if q.is_none() && tag.is_none() && folder.is_none() {
                return Err(AutomationError::bad_args(
                    "`search` vuole almeno q|tag|folder",
                ));
            }
            if let Some(query) = &q {
                if query.len() > 1024 || has_control(query) {
                    return Err(AutomationError::bad_args("`q` non valida"));
                }
            }
            if let Some(t) = &tag {
                if t.trim().is_empty()
                    || t.len() > 256
                    || t.contains(['#', ' ', '\t', '\n'])
                    || has_control(t)
                {
                    return Err(AutomationError::bad_args("`tag` non valido"));
                }
            }
            if let Some(f) = &folder {
                ensure_no_traversal("folder", f, false)?;
            }
            Ok(FubUri::Search {
                vault: lookup(&pairs, "vault"),
                q,
                tag,
                folder,
            })
        }
        "capture" => {
            let mode = match lookup(&pairs, "mode") {
                Some(m) => Some(CaptureMode::parse(&m)?),
                None => None,
            };
            let title = lookup(&pairs, "title");
            let markdown = lookup(&pairs, "markdown");
            let source_url = lookup(&pairs, "source_url");
            // Stessi limiti del payload, anche inline: il trasporto non allarga.
            if let Some(t) = &title {
                validate_title(t)?;
            }
            if let Some(m) = &markdown {
                if m.trim().is_empty() || m.len() > MARKDOWN_MAX_BYTES {
                    return Err(AutomationError::bad_args("`markdown` non valido"));
                }
            }
            if let Some(u) = &source_url {
                validate_source_url(u)?;
            }
            if let Some(f) = lookup(&pairs, "folder") {
                ensure_no_traversal("folder", &f, true)?;
            }
            if let Some(n) = lookup(&pairs, "note") {
                let is_new = !matches!(mode, Some(CaptureMode::Append | CaptureMode::Prepend));
                ensure_no_traversal("note", &n, is_new)?;
            }
            Ok(FubUri::Capture {
                vault: lookup(&pairs, "vault"),
                folder: lookup(&pairs, "folder"),
                note: lookup(&pairs, "note"),
                mode,
                title,
                markdown,
                source_url,
                success_callback: lookup(&pairs, "success_callback"),
                error_callback: lookup(&pairs, "error_callback"),
            })
        }
        _ => unreachable!("azione già rifiutata"),
    }
}

/// Valida una callback senza seguirla: schema autorizzato, niente credenziali,
/// niente segreti in query, niente `javascript:`/`data:` mai.
pub fn validate_callback(raw: &str, policy: &CallbackPolicy) -> Result<String, AutomationError> {
    if raw.trim().is_empty() {
        return Err(AutomationError::bad_args("callback vuota"));
    }
    if raw.len() > SOURCE_URL_MAX_BYTES {
        return Err(AutomationError::bad_args("callback oltre 2048 byte"));
    }
    if has_control(raw) || contains_nul(raw) || raw.contains(' ') {
        return Err(AutomationError::bad_args("callback con spazi/controllo"));
    }
    let (scheme, rest) = raw
        .split_once(':')
        .ok_or_else(|| AutomationError::bad_args("callback senza schema"))?;
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
    {
        return Err(AutomationError::bad_args("callback con schema non valido"));
    }
    if !scheme
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return Err(AutomationError::bad_args("callback con schema non valido"));
    }
    let scheme_lower = scheme.to_ascii_lowercase();
    if matches!(scheme_lower.as_str(), "javascript" | "data" | "vbscript") {
        return Err(AutomationError::denied(
            "callback mai verso javascript:/data:/vbscript:",
        ));
    }
    if matches!(scheme_lower.as_str(), "http" | "https") {
        let after = rest
            .strip_prefix("//")
            .ok_or_else(|| AutomationError::bad_args("callback web senza //"))?;
        let authority = after.split(['/', '?', '#']).next().unwrap_or("");
        if authority.is_empty()
            || authority.contains('@')
            || authority.contains('\\')
            || authority.contains('%')
        {
            return Err(AutomationError::bad_args(
                "callback web con host non valido",
            ));
        }
        let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
        if !port.is_empty()
            && (!port.bytes().all(|b| b.is_ascii_digit())
                || port.parse::<u16>().ok().filter(|p| *p > 0).is_none())
        {
            return Err(AutomationError::bad_args(
                "callback web con porta non valida",
            ));
        }
        if scheme_lower == "http"
            && !(policy.allow_http
                && matches!(
                    host.to_ascii_lowercase().as_str(),
                    "localhost" | "127.0.0.1"
                ))
        {
            return Err(AutomationError::denied(
                "callback http solo verso localhost con policy esplicita",
            ));
        }
        if scheme_lower == "https"
            && !policy
                .allowed_schemes
                .iter()
                .any(|s| s.eq_ignore_ascii_case("https"))
        {
            return Err(AutomationError::denied(
                "callback https non in policy (deny di default)",
            ));
        }
    } else if !policy
        .allowed_schemes
        .iter()
        .any(|s| s.eq_ignore_ascii_case(&scheme_lower))
    {
        return Err(AutomationError::denied(format!(
            "callback con schema `{scheme_lower}` non autorizzato"
        )));
    }
    // Credenziali e segreti: mai nella callback, mai nel log.
    let authority = rest
        .strip_prefix("//")
        .map(|a| a.split(['/', '?', '#']).next().unwrap_or(""));
    if authority.is_some_and(|a| a.contains('@')) {
        return Err(AutomationError::bad_args("callback senza userinfo"));
    }
    let query = raw
        .split_once('?')
        .map(|(_, q)| q.split('#').next().unwrap_or(""))
        .unwrap_or("");
    for parameter in query.split('&') {
        let key = parameter.split('=').next().unwrap_or("");
        let decoded = decode_param(&decode_param(key)).to_ascii_lowercase();
        if [
            "token",
            "secret",
            "password",
            "bearer",
            "access_token",
            "api_key",
        ]
        .contains(&decoded.as_str())
        {
            return Err(AutomationError::bad_args("callback senza segreti in query"));
        }
    }
    Ok(raw.to_string())
}

// ---------------------------------------------------------------------------
// Pairing NM: chi può scrivere senza chiedere ogni volta
// ---------------------------------------------------------------------------

/// Voce di pairing: extension-id + ambito opzionale. `vault`/`folder`
/// assenti = jolly su quell'asse; presenti = vincolo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairEntry {
    pub extension_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

fn folders_within(ancestor: &str, own: &str) -> bool {
    fub_abi::rules::folders::within(ancestor, own, true)
}

/// La coppia copre questa richiesta? `request_folder` è la cartella
/// destinazione (o il genitore della nota, o `""` per la radice).
pub fn pair_allows(
    pairs: &[PairEntry],
    extension_id: &str,
    request_vault: Option<&str>,
    request_folder: &str,
) -> bool {
    let request_folder = request_folder.trim().trim_matches('/').to_string();
    pairs.iter().any(|pair| {
        if pair.extension_id != extension_id {
            return false;
        }
        if let Some(paired_vault) = pair.vault.as_deref() {
            match request_vault {
                Some(requested) if requested == paired_vault => {}
                // Vault assente nella richiesta: il chiamante userà quello
                // accoppiato; il vincolo resta soddisfatto.
                None => {}
                _ => return false,
            }
        }
        match pair.folder.as_deref() {
            None => true,
            Some(paired) => {
                let paired = paired.trim().trim_matches('/');
                if paired.is_empty() {
                    return true;
                }
                if request_folder.is_empty() {
                    // Radice richiesta contro ambito stretto: negato, a meno
                    // che l'ambito non sia la radice stessa.
                    return false;
                }
                request_folder == paired || folders_within(paired, &request_folder)
            }
        }
    })
}

/// Cartella richiesta da un payload: `folder`, o il genitore di `note`, o radice.
pub fn request_folder_of(payload: &CapturePayloadV1) -> String {
    if let Some(folder) = payload.target.folder.as_deref() {
        return folder.trim().trim_matches('/').to_string();
    }
    if let Some(note) = payload.target.note.as_deref() {
        return fub_abi::rules::folders::parent(note.trim().trim_matches('/')).to_string();
    }
    String::new()
}

/// Gate NM: l'estensione deve dichiararsi e combaciare col pairing.
///
/// Il browser garantisce che solo l'estensione autorizzata raggiunga stdin;
/// qui si garantisce che solo un'estensione *accoppiata* scriva: `extension_id`
/// assente = denied con `needs_pairing` (non bad_args: il filo è giusto, manca
/// il consenso). L'ambito segue `pair_allows`.
pub fn nm_write_gate(
    pairs: &[PairEntry],
    envelope: &CaptureEnvelope,
    payload: &CapturePayloadV1,
) -> Result<(), (AutomationError, bool)> {
    let Some(extension_id) = envelope
        .extension_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    else {
        return Err((
            AutomationError::denied("NM: extension_id assente: accoppia con `fub-cli pair`"),
            true,
        ));
    };
    let folder = request_folder_of(payload);
    if pair_allows(
        pairs,
        extension_id,
        payload.target.vault.as_deref(),
        &folder,
    ) {
        return Ok(());
    }
    Err((
        AutomationError::denied(format!(
            "NM: `{extension_id}` non accoppiata per questa destinazione: `fub-cli pair --extension-id {extension_id}`"
        )),
        true,
    ))
}

// ---------------------------------------------------------------------------
// Framing stdio NM: 4 byte LE + JSON, max 2MiB
// ---------------------------------------------------------------------------

/// Legge un frame length-prefixed (LE u32) con tetto anti-allocazione.
pub fn read_nm_frame<R: std::io::Read>(reader: &mut R) -> Result<Vec<u8>, AutomationError> {
    let mut len_bytes = [0u8; 4];
    if let Err(e) = std::io::Read::read_exact(reader, &mut len_bytes) {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Err(AutomationError::unavailable("NM: stdin chiusa"));
        }
        return Err(AutomationError::unavailable(format!("NM: lettura: {e}")));
    }
    let len = u32::from_le_bytes(len_bytes) as usize;
    if len == 0 || len > NM_MAX_BYTES {
        return Err(AutomationError::bad_args(format!(
            "NM: frame {len} oltre 2MiB o vuoto"
        )));
    }
    let mut buf = vec![0u8; len];
    std::io::Read::read_exact(reader, &mut buf)
        .map_err(|e| AutomationError::unavailable(format!("NM: corpo: {e}")))?;
    Ok(buf)
}

/// Scrive un frame length-prefixed (LE u32).
pub fn write_nm_frame<W: std::io::Write>(
    writer: &mut W,
    payload: &[u8],
) -> Result<(), AutomationError> {
    if payload.is_empty() || payload.len() > NM_MAX_BYTES {
        return Err(AutomationError::bad_args("NM: risposta oltre 2MiB o vuota"));
    }
    let len = (payload.len() as u32).to_le_bytes();
    writer
        .write_all(&len)
        .map_err(|e| AutomationError::unavailable(format!("NM: scrittura: {e}")))?;
    writer
        .write_all(payload)
        .map_err(|e| AutomationError::unavailable(format!("NM: scrittura: {e}")))?;
    writer
        .flush()
        .map_err(|e| AutomationError::unavailable(format!("NM: flush: {e}")))?;
    Ok(())
}

/// Decodifica UTF-8 senza panico: byte non validi = bad_args, non sostituzione.
pub fn nm_frame_to_str(frame: &[u8]) -> Result<&str, AutomationError> {
    std::str::from_utf8(frame).map_err(|_| AutomationError::bad_args("NM: frame non UTF-8"))
}
