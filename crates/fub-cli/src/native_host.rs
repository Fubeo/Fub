//! `fub-clipper-host`: solo protocollo native, niente CLI interattiva.
//!
//! Loop sequenziale su stdin framed (4 byte LE + JSON, max 2MiB):
//! valida specie+busta+payload, verifica il pairing, scrive con la stessa
//! autorità della CLI (il comando dell'host `capture.apply`), risponde framed.
//! Nessuna porta TCP, nessun secondo writer oltre quello host.

use base64::Engine;
use fub_host::automation::{
    nm_frame_to_str, read_nm_frame, validate_nm_request, write_nm_frame, AutomationKind, NmRequest,
    NmResponse,
};
use fub_host::automation::{
    CaptureEnvelope, CaptureTarget, NmAttachmentBegin, NmAttachmentChunk, NmAttachmentCommit,
};

struct Transfer {
    id: String,
    envelope: CaptureEnvelope,
    target: CaptureTarget,
    vault: String,
    name: String,
    sha256: String,
    expected_bytes: u64,
    next_index: u32,
    bytes: Vec<u8>,
}

struct NativeState {
    host: fub_host::Host,
    transfer: Option<Transfer>,
}

fn main() {
    let code = run();
    std::process::exit(code);
}

fn run() -> i32 {
    // Config dir: FUB_CONFIG_DIR o profilo; il pairing vive lì.
    let mut host = fub_host::Host::without_watcher();
    if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            host = host.with_config_dir(camino::Utf8Path::new(&dir));
        } else if let Some(dir) = fub_host::config_dir() {
            host = host.with_config_dir(dir.as_path());
        }
    } else if let Some(dir) = fub_host::config_dir() {
        host = host.with_config_dir(dir.as_path());
    }
    let mut state = NativeState {
        host,
        transfer: None,
    };
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    loop {
        let frame = match read_nm_frame(&mut input) {
            Ok(frame) => frame,
            Err(e) if e.kind() == AutomationKind::Unavailable => break,
            Err(e) => {
                // Frame illeggibile: risposta best-effort, poi si continua.
                let response = NmResponse::err(AutomationKind::BadArgs, e.message());
                let _ = write_nm_frame(
                    &mut output,
                    serde_json::to_string(&response)
                        .unwrap_or_default()
                        .as_bytes(),
                );
                continue;
            }
        };
        let response = handle_frame(&mut state, &frame);
        let bytes = serde_json::to_string(&response).unwrap_or_default();
        if write_nm_frame(&mut output, bytes.as_bytes()).is_err() {
            break;
        }
    }
    0
}

fn handle_frame(state: &mut NativeState, frame: &[u8]) -> serde_json::Value {
    let response = (|| -> Result<serde_json::Value, NmResponse> {
        let text = nm_frame_to_str(frame).map_err(|e| NmResponse::err(e.kind(), e.message()))?;
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|_| NmResponse::err(AutomationKind::BadArgs, "NM: JSON non valido"))?;
        match value.get("kind").and_then(|kind| kind.as_str()) {
            Some(fub_host::automation::NM_ATTACHMENT_BEGIN_KIND) => {
                let request: NmAttachmentBegin = serde_json::from_value(value).map_err(|_| {
                    NmResponse::err(AutomationKind::BadArgs, "NM: begin non valido")
                })?;
                attachment_begin(state, request)
            }
            Some(fub_host::automation::NM_ATTACHMENT_CHUNK_KIND) => {
                let request: NmAttachmentChunk = serde_json::from_value(value).map_err(|_| {
                    NmResponse::err(AutomationKind::BadArgs, "NM: chunk non valido")
                })?;
                attachment_chunk(state, request)
            }
            Some(fub_host::automation::NM_ATTACHMENT_COMMIT_KIND) => {
                let request: NmAttachmentCommit = serde_json::from_value(value).map_err(|_| {
                    NmResponse::err(AutomationKind::BadArgs, "NM: commit non valido")
                })?;
                attachment_commit(state, request)
            }
            Some(fub_host::automation::NM_REQUEST_KIND) => {
                let request: NmRequest = serde_json::from_value(value).map_err(|_| {
                    NmResponse::err(AutomationKind::BadArgs, "NM: capture non valido")
                })?;
                validate_nm_request(&request)
                    .map_err(|e| NmResponse::err(e.kind(), e.message()))?;
                let vault = effective_vault(&state.host, request.payload.target.vault.as_deref())
                    .ok_or_else(|| {
                    NmResponse::err(AutomationKind::NotFound, "NM: nessun vault")
                })?;
                let mut authorized = request.clone();
                authorized.payload.target.vault = Some(vault.clone());
                let pairs = load_pairs_best_effort();
                nm_gate(&pairs, &authorized).map_err(|(message, needs_pairing)| {
                    if needs_pairing {
                        NmResponse::needs_pairing(Some(&request.envelope.nonce), message)
                    } else {
                        NmResponse::err(AutomationKind::Denied, message)
                    }
                })?;
                state.open_vault(&vault)?;
                apply_capture(&state.host, &authorized)
                    .map_err(|(kind, message)| NmResponse::err(kind, message))?;
                Ok(
                    serde_json::to_value(NmResponse::ok(&request.envelope.nonce))
                        .unwrap_or_default(),
                )
            }
            _ => Err(NmResponse::err(
                AutomationKind::BadArgs,
                "NM: kind sconosciuto",
            )),
        }
    })();
    response.unwrap_or_else(|error| serde_json::to_value(error).unwrap_or_default())
}

fn effective_vault(host: &fub_host::Host, target: Option<&str>) -> Option<String> {
    target
        .map(str::to_string)
        .or_else(|| {
            std::env::var("FUB_VAULT")
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| host.last_vault())
}

impl NativeState {
    fn open_vault(&mut self, root: &str) -> Result<(), NmResponse> {
        std::path::Path::new(root)
            .canonicalize()
            .map_err(|_| NmResponse::err(AutomationKind::NotFound, "NM: vault assente"))?;
        // Il lock di scrittura lo prende l'host aprendo, e lo tiene la sessione.
        self.host
            .open(camino::Utf8Path::new(root))
            .map_err(|error| {
                if fub_host::automation::is_writer_busy(&error) {
                    NmResponse::err(
                        AutomationKind::Conflict,
                        "NM: vault occupato da altro writer",
                    )
                } else {
                    NmResponse::err(map_kind(&error), error.to_string())
                }
            })?;
        Ok(())
    }
}

fn attachment_gate(
    pairs: &[fub_host::automation::PairEntry],
    envelope: &CaptureEnvelope,
    target: &CaptureTarget,
) -> Result<(), NmResponse> {
    fub_host::automation::nm_attachment_write_gate(pairs, envelope, target).map_err(
        |(error, needs_pairing)| {
            if needs_pairing {
                NmResponse::needs_pairing(Some(&envelope.nonce), error.message())
            } else {
                NmResponse::err(error.kind(), error.message())
            }
        },
    )
}

fn attachment_begin(
    state: &mut NativeState,
    request: NmAttachmentBegin,
) -> Result<serde_json::Value, NmResponse> {
    fub_host::automation::validate_nm_attachment_begin(&request)
        .map_err(|error| NmResponse::err(error.kind(), error.message()))?;
    let vault = effective_vault(&state.host, request.target.vault.as_deref())
        .ok_or_else(|| NmResponse::err(AutomationKind::NotFound, "NM: nessun vault"))?;
    let mut target = request.target;
    target.vault = Some(vault.clone());
    attachment_gate(&load_pairs_best_effort(), &request.envelope, &target)?;
    if state.transfer.is_some() {
        return Err(NmResponse::err(
            AutomationKind::Conflict,
            "NM: trasferimento già in corso",
        ));
    }
    state.open_vault(&vault)?;
    use ring::rand::SecureRandom;
    let mut random = [0u8; 24];
    ring::rand::SystemRandom::new()
        .fill(&mut random)
        .map_err(|_| NmResponse::err(AutomationKind::Unavailable, "NM: random non disponibile"))?;
    let id = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random);
    state.transfer = Some(Transfer {
        id: id.clone(),
        envelope: request.envelope.clone(),
        target,
        vault,
        name: request.attachment.name,
        sha256: request.attachment.sha256,
        expected_bytes: request.attachment.bytes,
        next_index: 0,
        bytes: Vec::new(),
    });
    Ok(serde_json::json!({ "ok": true, "nonce": request.envelope.nonce, "transfer_id": id }))
}

fn attachment_chunk(
    state: &mut NativeState,
    request: NmAttachmentChunk,
) -> Result<serde_json::Value, NmResponse> {
    fub_host::automation::validate_nm_attachment_chunk(&request)
        .map_err(|error| NmResponse::err(error.kind(), error.message()))?;
    let transfer = state
        .transfer
        .as_ref()
        .ok_or_else(|| NmResponse::err(AutomationKind::NotFound, "NM: trasferimento assente"))?;
    if request.transfer_id != transfer.id || request.envelope != transfer.envelope {
        return Err(NmResponse::err(
            AutomationKind::Denied,
            "NM: busta trasferimento non corrisponde",
        ));
    }
    attachment_gate(
        &load_pairs_best_effort(),
        &request.envelope,
        &transfer.target,
    )?;
    if request.index != transfer.next_index {
        return Err(NmResponse::err(
            AutomationKind::Conflict,
            "NM: chunk fuori sequenza",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&request.data)
        .map_err(|_| NmResponse::err(AutomationKind::BadArgs, "NM: base64 non valido"))?;
    if bytes.len() > fub_host::automation::ATTACHMENT_CHUNK_MAX_BYTES
        || (transfer.bytes.len() as u64).saturating_add(bytes.len() as u64)
            > transfer.expected_bytes
    {
        return Err(NmResponse::err(
            AutomationKind::BadArgs,
            "NM: chunk oltre dimensione dichiarata",
        ));
    }
    let transfer = state.transfer.as_mut().expect("validated transfer above");
    transfer.bytes.extend_from_slice(&bytes);
    transfer.next_index += 1;
    Ok(serde_json::json!({ "ok": true, "nonce": request.envelope.nonce }))
}

fn attachment_commit(
    state: &mut NativeState,
    request: NmAttachmentCommit,
) -> Result<serde_json::Value, NmResponse> {
    fub_host::automation::validate_nm_attachment_commit(&request)
        .map_err(|error| NmResponse::err(error.kind(), error.message()))?;
    let transfer = state
        .transfer
        .as_ref()
        .ok_or_else(|| NmResponse::err(AutomationKind::NotFound, "NM: trasferimento assente"))?;
    if request.transfer_id != transfer.id || request.envelope != transfer.envelope {
        return Err(NmResponse::err(
            AutomationKind::Denied,
            "NM: busta trasferimento non corrisponde",
        ));
    }
    attachment_gate(
        &load_pairs_best_effort(),
        &request.envelope,
        &transfer.target,
    )?;
    let transfer = state.transfer.take().expect("validated transfer above");
    if transfer.bytes.len() as u64 != transfer.expected_bytes {
        return Err(NmResponse::err(
            AutomationKind::BadArgs,
            "NM: dimensione attachment diversa",
        ));
    }
    let digest = ring::digest::digest(&ring::digest::SHA256, &transfer.bytes);
    let hex = digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if hex != transfer.sha256 {
        return Err(NmResponse::err(
            AutomationKind::BadArgs,
            "NM: SHA-256 attachment diverso",
        ));
    }
    let path = match transfer.target.folder.as_deref() {
        Some(folder) if !folder.is_empty() => format!("{folder}/{}", transfer.name),
        _ => transfer.name,
    };
    let doc = fub_host::doc_id(&path)
        .map_err(|error| NmResponse::err(map_kind(&error), error.to_string()))?;
    state
        .host
        .write_document_bytes(Some(&transfer.vault), &doc, &transfer.bytes, None)
        .map_err(|error| NmResponse::err(map_kind(&error), error.to_string()))?;
    Ok(serde_json::json!({ "ok": true, "nonce": request.envelope.nonce, "doc": doc.as_str() }))
}

fn load_pairs_best_effort() -> Vec<fub_host::automation::PairEntry> {
    let path = pairing_file();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            return Vec::new();
        };
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.permissions().mode() & 0o077 != 0
        {
            return Vec::new();
        }
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "{\"pairs\":[]}".to_string());
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("pairs").cloned())
        .and_then(|p| serde_json::from_value(p).ok())
        .unwrap_or_default()
}

fn pairing_file() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return std::path::PathBuf::from(dir).join("clipper-pairing.json");
        }
    }
    if let Some(dir) = fub_host::config_dir() {
        return std::path::PathBuf::from(dir.as_str()).join("clipper-pairing.json");
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return std::path::PathBuf::from(home)
                .join(".config")
                .join("fub")
                .join("clipper-pairing.json");
        }
    }
    std::env::temp_dir().join("fub-clipper-pairing.json")
}

fn nm_gate(
    pairs: &[fub_host::automation::PairEntry],
    request: &NmRequest,
) -> Result<(), (String, bool)> {
    use fub_host::automation::nm_write_gate;
    match nm_write_gate(pairs, &request.envelope, &request.payload) {
        Ok(()) => Ok(()),
        Err((error, needs_pairing)) => Err((error.message().to_string(), needs_pairing)),
    }
}

/// Scrive la cattura autorizzata nel vault che `open_vault` ha già aperto, con
/// il comando dell'host `capture.apply`: lo stesso della CLI e del mobile.
fn apply_capture(
    host: &fub_host::Host,
    request: &NmRequest,
) -> Result<(), (AutomationKind, String)> {
    let payload = &request.payload;
    fub_host::capture::apply(host, payload.target.vault.as_deref(), payload, None)
        .map(|_| ())
        .map_err(|e| (map_kind(&e), e.to_string()))
}

fn map_kind(error: &fub_abi::PluginError) -> AutomationKind {
    match error {
        fub_abi::PluginError::BadArgs(_)
        | fub_abi::PluginError::UnknownCommand(_)
        | fub_abi::PluginError::UnknownView(_)
        | fub_abi::PluginError::UnknownJob(_) => AutomationKind::BadArgs,
        fub_abi::PluginError::Unserved(_) | fub_abi::PluginError::Cancelled(_) => {
            AutomationKind::Unavailable
        }
        fub_abi::PluginError::PermissionDenied(_) => AutomationKind::Denied,
        fub_abi::PluginError::NotFound(_) => AutomationKind::NotFound,
        fub_abi::PluginError::Conflict(_) | fub_abi::PluginError::AlreadyExists(_) => {
            AutomationKind::Conflict
        }
        fub_abi::PluginError::Io(_) | fub_abi::PluginError::Internal(_) => {
            AutomationKind::Unavailable
        }
    }
}
