//! Lo smistamento HTTP: `handle`, l'ammissione, il lavoro sul vault, la
//! query e le cartelle dei vault.

use super::*;

// ---------------------------------------------------------------------------
// HTTP dispatch. The shared route table owns method/path matching; this
// entry point maps its sync variants to their implemented handlers.
// ---------------------------------------------------------------------------

/// Entry point for the parent router: full path (`/v1/sync/push`, ...),
/// `auth` is the raw `Authorization` header value (or None). Ammissione e
/// lavoro sul vault di seguito, con lo stato in mano: il binario usa invece
/// [`admit`] e [`VaultWork::run`] con lock distinti.
pub fn handle(
    state: &mut ServiceState,
    method: &str,
    path: &str,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    match admit(state, method, path, auth, body) {
        Admission::Done(response) => response,
        Admission::Vault(work) => work.run(),
    }
}

/// L'esito della parte di una richiesta sync che chiede lo stato globale.
pub enum Admission {
    /// La richiesta è già risposta (errore, o rotta che non tocca i file di
    /// un vault).
    Done(HttpResponse),
    /// Autorizzata: resta il lavoro sui file del vault.
    Vault(Box<VaultWork>),
}

/// Il lavoro di una richiesta già autorizzata sui file di un vault (code,
/// ripiegamento, salvataggi). Non tocca lo stato globale: gira sotto il solo
/// lock del vault, così un vault lento non ferma gli altri (STR-05).
pub struct VaultWork {
    pub(super) vault_id: String,
    pub(super) scope: VaultScope,
    pub(super) job: VaultJob,
}

/// Ciò che il lavoro sul vault legge dello stato, copiato all'ammissione.
pub(super) struct VaultScope {
    pub(super) account: String,
    pub(super) dir: PathBuf,
    pub(super) sync_dir: PathBuf,
    pub(super) quotas: schema::ServiceQuotas,
}

pub(super) enum VaultJob {
    Push(PushRequest),
    Pull(PullRequest),
    Ack(AckRequest),
    Status {
        replica_id: String,
    },
    Versions {
        doc_id: String,
    },
    Trash {
        doc_id: String,
    },
    Restore {
        doc_id: String,
        version: Option<u64>,
    },
}

impl VaultWork {
    /// Il vault di cui serve il lock.
    pub fn vault_id(&self) -> &str {
        &self.vault_id
    }

    pub fn run(self) -> HttpResponse {
        let scope = &self.scope;
        match self.job {
            VaultJob::Push(req) => run_push(scope, req),
            VaultJob::Pull(req) => run_pull(scope, req),
            VaultJob::Ack(req) => run_ack(scope, req),
            VaultJob::Status { replica_id } => run_status(scope, replica_id),
            VaultJob::Versions { doc_id } => run_versions(scope, doc_id),
            VaultJob::Trash { doc_id } => run_trash(scope, doc_id),
            VaultJob::Restore { doc_id, version } => run_restore(scope, doc_id, version),
        }
    }
}

/// La parte di una richiesta sync che chiede lo stato globale: sessione,
/// ACL, rivendicazione del vault. Le rotte di inviti, revoche e chiavi si
/// risolvono qui per intero.
pub fn admit(
    state: &mut ServiceState,
    method: &str,
    path: &str,
    auth: Option<&str>,
    body: &[u8],
) -> Admission {
    let (_, query) = split_query(path);
    let admitted = match crate::routing::route(method, path) {
        crate::routing::Route::SyncPush => admit_push(state, auth, body),
        crate::routing::Route::SyncPull => admit_pull(state, auth, body),
        crate::routing::Route::SyncAck => admit_ack(state, auth, body),
        crate::routing::Route::SyncStatus => admit_status(state, auth, &query),
        crate::routing::Route::SyncVersions => admit_versions(state, auth, &query),
        crate::routing::Route::SyncTrash => admit_trash(state, auth, body),
        crate::routing::Route::SyncRestore => admit_restore(state, auth, body),
        crate::routing::Route::SyncInvite => Err(handle_invite(state, auth, body)),
        crate::routing::Route::SyncInviteAccept => Err(handle_invite_accept(state, auth, body)),
        crate::routing::Route::SyncRevoke => Err(handle_revoke(state, auth, body)),
        crate::routing::Route::SyncVaultKeyStore => Err(handle_vault_key_store(state, auth, body)),
        crate::routing::Route::SyncVaultKeyGet => Err(handle_vault_key_get(state, auth, &query)),
        _ => Err(HttpResponse::err(404, "unknown sync route")),
    };
    match admitted {
        Ok(work) => Admission::Vault(Box::new(work)),
        Err(response) => Admission::Done(response),
    }
}

/// Il vault che una richiesta sync tocca, letto senza lock prima di prendere
/// quello del vault: lo stesso valore che l'ammissione ricaverà, o `None` se
/// la rotta non ne nomina uno (accettare un invito). Un corpo illeggibile
/// torna `None`: l'ammissione lo rifiuta comunque.
pub fn vault_of_request(method: &str, path: &str, body: &[u8]) -> Option<String> {
    use crate::routing::Route;
    let (_, query) = split_query(path);
    let from_query = || query_get(&query, "vault_id").map(str::to_string);
    let json = || serde_json::from_slice::<serde_json::Value>(body).ok();
    let field = |value: &serde_json::Value, key: &str| {
        value.get(key).and_then(|v| v.as_str()).map(str::to_string)
    };
    match crate::routing::route(method, path) {
        Route::SyncStatus | Route::SyncVersions | Route::SyncVaultKeyGet => from_query(),
        Route::SyncPush => {
            let body = json()?;
            let first = body
                .get("ops")?
                .as_array()?
                .iter()
                .filter_map(|op| op.get("vault_id")?.as_str())
                .find(|id| !id.trim().is_empty())
                .map(str::to_string);
            Some(first.unwrap_or_else(|| "default".to_string()))
        }
        Route::SyncAck => {
            let body = json()?;
            Some(field(&body, "vault_id").unwrap_or_else(default_vault_scope))
        }
        Route::SyncPull | Route::SyncTrash | Route::SyncRestore | Route::SyncVaultKeyStore => {
            field(&json()?, "vault_id")
        }
        Route::SyncInvite | Route::SyncRevoke => {
            let body = json()?;
            match field(&body, "resource") {
                Some(resource) => resource.strip_prefix("vault:").map(str::to_string),
                None => Some(field(&body, "vault_id").unwrap_or_else(|| "default".to_string())),
            }
        }
        _ => None,
    }
}

pub(super) fn scope_of(
    state: &ServiceState,
    account: String,
    vault_id: &str,
) -> Result<VaultScope, HttpResponse> {
    Ok(VaultScope {
        dir: vault_dir_of(state, vault_id)?,
        sync_dir: sync_dir_of(state),
        quotas: state.config.quotas.clone(),
        account,
    })
}

fn split_query(path: &str) -> (&str, Vec<(String, String)>) {
    match path.find('?') {
        None => (path, Vec::new()),
        Some(i) => {
            let mut out = Vec::new();
            for pair in path[i + 1..].split('&') {
                if pair.is_empty() {
                    continue;
                }
                match pair.find('=') {
                    Some(j) => out.push((pair[..j].to_string(), pair[j + 1..].to_string())),
                    None => out.push((pair.to_string(), String::new())),
                }
            }
            (&path[..i], out)
        }
    }
}

pub(super) fn query_get<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

pub(super) fn valid_replica_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Query values are URL-encoded by clients. A malformed escape is an error,
/// never a literal document id that accidentally addresses another record.
pub(super) fn decode_query_value(raw: &str) -> Option<String> {
    fn hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                decoded.push((hex(*bytes.get(i + 1)?)? << 4) | hex(*bytes.get(i + 2)?)?);
                i += 3;
            }
            b'+' => {
                decoded.push(b' ');
                i += 1;
            }
            b => {
                decoded.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

pub(super) fn sync_dir_of(state: &ServiceState) -> std::path::PathBuf {
    let dir = sync_dir(&state.data_dir);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Cartella di un vault sotto `sync/`: stato ripiegato, code delle repliche e
/// quarantene. Catene, tombstone, cestino, vettore del server e quota di un
/// vault non incontrano mai quelli di un altro, anche con lo stesso `doc_id`.
/// Il nome è lo SHA-256 dell'id, così un id ostile non esce dalla cartella.
pub fn vault_dir(sync_dir: &Path, vault_id: &str) -> PathBuf {
    let digest = ring::digest::digest(&ring::digest::SHA256, vault_id.as_bytes());
    let name: String = digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    sync_dir.join("vaults").join(name)
}

/// Cartella del vault, dopo aver adottato lo stato di una versione
/// precedente. Non la crea: leggere un vault senza dati non lascia cartelle.
pub(super) fn vault_dir_of(state: &ServiceState, vault_id: &str) -> Result<PathBuf, HttpResponse> {
    let dir = sync_dir(&state.data_dir);
    adopt_legacy(&dir).map_err(|e| HttpResponse::err(500, &e))?;
    Ok(vault_dir(&dir, vault_id))
}
