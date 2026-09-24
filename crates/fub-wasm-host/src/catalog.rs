//! Catalogo firmato di plugin e temi (P11.4): provenienza, compatibilità,
//! licenza, ricerca, installazione, aggiornamenti manuali e rollback.
//!
//! Schema privato v1 dello store macchina, non un'estensione ABI: nessun tipo
//! di qui attraversa il confine WASM né il WIT. Il feed è un documento JSON
//! firmato che si può ospitare ovunque (file locale nello smoke, URL
//! esplicito in produzione); la fiducia sta nelle chiavi attendibili
//! configurate, mai nell'endpoint da cui il feed arriva.
//!
//! # Formato del feed (v1)
//!
//! Il feed è un [`SignedFeed`]: `payload` è il [`CatalogPayload`] serializzato
//! in forma canonica (JSON senza spazi, chiavi ordinate — `BTreeMap`), e
//! `signature` è Ed25519 su quei byte esatti, in base64 standard. `key_id` dice
//! quale chiave attendibile ha firmato. Ogni [`CatalogEntry`] porta id,
//! versione, ABI dichiarata, URL del `.wasm`, digest SHA-256 canonico
//! (`Revision`), dimensione, permessi richiesti, licenza, compatibilità e
//! revoca:
//!
//! - `signature` si verifica **prima** di leggere qualunque altra cosa;
//! - il digest si verifica sui byte scaricati **prima** di installare o
//!   aggiornare, e il manifest reale letto dal componente deve coincidere con
//!   `entry` (id, versione, ABI, permessi);
//! - le richieste di permessi allargate fra versioni azzerano il consenso: un
//!   aggiornamento non eredita mai un `Granted` dato ad altre richieste;
//! - `revoked: true` o `expires_at` superato disabilitano senza cancellare i
//!   dati utente (`.fub/plugins/<id>` non è mai nominato né eliminato qui);
//! - `generation` anti-rollback: un feed con generazione inferiore a quella già
//!   vista viene rifiutato, così un mirror malevolo non può rispolverare voci
//!   ritirate.
//!
//! # Cosa non fa
//!
//! Non scarica (il chiamante consegna i byte, già letti dalla sua capability),
//! non decide i permessi (il `Guard` del kernel resta l'unico punto di
//! enforcement), non monta (il manager esistente resta l'unica strada al
//! mount). La rimozione dal catalogo ritira la voce dal feed futuro; la revoca
//! disabilita l'installazione esistente senza toccarne i dati.

use std::collections::{BTreeMap, BTreeSet};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use fub_abi::edit::Revision;
use fub_host::registry::Bundle;
use fub_kernel::Trust;

use crate::installed::{
    CatalogProvenance, InstallError, InstalledPlugin, InstalledPluginStore, InventorySnapshot,
};

/// Versione dello schema del catalogo: l'unica supportata da questo reader.
pub const CATALOG_SCHEMA: u32 = 1;

/// Chiavi attendibili e URL espliciti: la radice di fiducia del catalogo.
///
/// Le chiavi sono Ed25519 a 32 byte in base64 standard, indicizzate per
/// `key_id`. Gli URL sono quelli configurati dall'operatore o dalla shell —
/// mai inventati da questo modulo — e il feed può anche essere un file locale
/// (è il caso dello smoke e del deployment air-gapped).
#[derive(Clone, Debug, Default)]
pub struct CatalogTrust {
    /// `key_id` → chiave pubblica Ed25519 grezza (32 byte).
    pub keys: BTreeMap<String, Vec<u8>>,
    /// URL dei feed consentiti, o path locali espliciti. Vuoto = nessun feed
    /// remoto accettato, solo payload già in mano al chiamante.
    pub feed_urls: Vec<String>,
    /// Ultima generazione vista: anti-rollback contro mirror stantii.
    pub min_generation: u64,
}

impl CatalogTrust {
    /// Registra una chiave attendibile da base64 standard.
    pub fn with_key(
        mut self,
        key_id: impl Into<String>,
        public_key_base64: &str,
    ) -> Result<Self, CatalogError> {
        let key = decode_b64(public_key_base64)?;
        if key.len() != 32 {
            return Err(CatalogError::Invalid(
                "chiave Ed25519 deve essere di 32 byte".into(),
            ));
        }
        self.keys.insert(key_id.into(), key);
        Ok(self)
    }
}

/// Voce firmata del catalogo, con identità, release e provenienza del plugin o tema.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct CatalogEntry {
    /// Id della voce (`namespaced` come nel manifest del plugin o del tema).
    pub id: String,
    /// Specie della voce: plugin WASM o tema `theme-1`.
    pub kind: CatalogKind,
    /// Nome leggibile per la ricerca.
    pub name: String,
    /// Versione della release.
    pub version: String,
    /// Contratto dichiarato: `fub:abi@X.Y.Z` per un plugin, `theme-1` per un tema.
    pub abi: String,
    /// URL (o path esplicito) dell'artefatto: `.wasm` per un plugin, albero del
    /// tema (cartella con `manifest.json`) per un tema.
    pub url: String,
    /// Digest SHA-256 canonico (`Revision` con prefisso `sha256:`). Per un
    /// tema copre l'intero albero (manifest, CSS e asset) con framing e ordine
    /// definiti da `fub_host::theme::theme_tree_digest`, non solo il manifest.
    pub digest: Revision,
    /// Dimensione attesa in byte: rifiutata se diversa. Per un tema è la
    /// dimensione del `manifest.json`.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub size: u64,
    /// Permessi richiesti (`ns:nome`), per il confronto all'aggiornamento.
    /// Un tema non ne dichiara: `ThemeBundle::load` rifiuta un manifest con
    /// permessi, e una voce tema con permessi è `Unreadable`.
    pub permissions: BTreeSet<String>,
    /// Licenza (SPDX o testo breve): informativa, non enforcement.
    pub license: String,
    /// Versioni dell'app compatibili, in forma leggibile (`>=0.1,<0.3`).
    pub compatible: String,
    /// Provenienza: chi ha pubblicato la voce.
    pub provenance: String,
    /// `true` = ritirata: disabilita senza cancellare i dati utente.
    pub revoked: bool,
}

/// Specie di una voce di catalogo: plugin o tema.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogKind {
    /// Componente WASM installato via [`InstalledPluginStore`].
    #[default]
    Plugin,
    /// Tema `theme-1` installato via `install_theme` esistente.
    Theme,
}

/// Il payload firmato del feed: generazione più voci in ordine di id.
#[derive(Clone, Debug, Default)]
pub struct CatalogPayload {
    /// Generazione monotona del feed: mai indietro (anti-rollback).
    pub generation: u64,
    /// Scadenza in millisecondi UNIX: oltre, il feed non si usa.
    pub expires_at: u64,
    /// Le voci, in ordine di id.
    pub entries: Vec<CatalogEntry>,
}

/// Envelope Ed25519: i byte del payload non vengono riserializzati prima della verifica.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedFeed {
    /// Payload in forma canonica (JSON compatto, chiavi ordinate).
    pub payload: Vec<u8>,
    /// Firma Ed25519 del payload, base64 standard.
    pub signature: String,
    /// Chiave che ha firmato, fra quelle attendibili.
    pub key_id: String,
}

/// Errore tipizzato del catalogo: niente stringhe opache.
#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    /// Feed illeggibile o schema non supportato.
    #[error("catalogo non leggibile: {0}")]
    Unreadable(String),
    /// Firma mancante, chiave sconosciuta o verifica fallita.
    #[error("firma del catalogo non valida: {0}")]
    Signature(String),
    /// Generazione o scadenza non accettabili.
    #[error("feed non corrente: {0}")]
    Stale(String),
    /// Chiave o voce malformata prima di qualunque verifica.
    #[error("catalogo non valido: {0}")]
    Invalid(String),
    /// Voce non trovata o ritirata.
    #[error("voce non disponibile: {0}")]
    Unavailable(String),
    /// Byte scaricati non conformi alla voce (digest, dimensione, manifest).
    #[error("artefatto non autentico: {0}")]
    Integrity(String),
    /// Errore dello store sottostante.
    #[error(transparent)]
    Store(#[from] InstallError),
    /// Errore I/O grezzo (lettura feed o artefatto dalla capability).
    #[error("accesso al catalogo fallito: {0}")]
    Io(#[from] std::io::Error),
    /// Manager lifecycle o riconciliazione, senza perdere l'errore tipizzato.
    #[error(transparent)]
    Manager(#[from] fub_abi::PluginError),
    /// Errore tipizzato dell'installer dei temi; non disfa una pubblicazione già avvenuta.
    #[error(transparent)]
    Theme(#[from] fub_host::theme::ThemeError),
}

fn decode_b64(s: &str) -> Result<Vec<u8>, CatalogError> {
    B64.decode(s)
        .map_err(|_| CatalogError::Signature("base64 non valido".into()))
}

/// Verifica la firma e decodifica il payload, senza fidarsi dell'endpoint.
///
/// Ordine fisso: chiave nota → firma valida sui byte esatti → JSON leggibile
/// → schema supportato → generazione e scadenza correnti. La forma canonica
/// che si verifica è quella che ha firmato chi pubblica: JSON compatto con
/// chiavi ordinate, prodotto da [`canonical_payload`].
pub fn verify_feed(
    trust: &CatalogTrust,
    feed: &SignedFeed,
    now_ms: u64,
) -> Result<CatalogPayload, CatalogError> {
    let key = trust
        .keys
        .get(&feed.key_id)
        .ok_or_else(|| CatalogError::Signature(format!("chiave sconosciuta `{}`", feed.key_id)))?;
    let signature = decode_b64(&feed.signature)?;
    if signature.len() != 64 {
        return Err(CatalogError::Signature(
            "firma Ed25519 deve essere di 64 byte".into(),
        ));
    }
    verify_ed25519(key, &feed.payload, &signature).map_err(CatalogError::Signature)?;
    let payload = decode_payload(&feed.payload)?;
    if payload.generation < trust.min_generation {
        return Err(CatalogError::Stale(format!(
            "generazione {} precedente alla minima {}",
            payload.generation, trust.min_generation
        )));
    }
    if now_ms > payload.expires_at {
        return Err(CatalogError::Stale("feed scaduto".into()));
    }
    Ok(payload)
}

/// Forma canonica del payload: JSON compatto a chiavi ordinate.
///
/// È ciò che si firma e ciò che si verifica: la stessa serializzazione da
/// entrambe le parti, senza canonicalizzazioni concorrenti.
pub fn canonical_payload(payload: &CatalogPayload) -> Vec<u8> {
    let mut out = String::from("{\"entries\":[");
    for (n, entry) in payload.entries.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        out.push_str(&canonical_entry(entry));
    }
    out.push_str(&format!(
        "],\"expires_at\":{},\"generation\":\"{}\",\"schema\":{}}}",
        payload.expires_at, payload.generation, CATALOG_SCHEMA
    ));
    out.into_bytes()
}

fn canonical_entry(entry: &CatalogEntry) -> String {
    let mut permissions: Vec<&str> = entry.permissions.iter().map(String::as_str).collect();
    permissions.sort_unstable();
    let permissions = permissions
        .iter()
        .map(|p| format!("\"{}\"", escape(p)))
        .collect::<Vec<_>>()
        .join(",");
    let kind = match entry.kind {
        CatalogKind::Plugin => "plugin",
        CatalogKind::Theme => "theme",
    };
    format!(
        "{{\"abi\":\"{}\",\"compatible\":\"{}\",\"digest\":\"{}\",\"id\":\"{}\",\"kind\":\"{}\",\"license\":\"{}\",\"name\":\"{}\",\"permissions\":[{}],\"provenance\":\"{}\",\"revoked\":{},\"size\":{},\"url\":\"{}\",\"version\":\"{}\"}}",
        escape(&entry.abi),
        escape(&entry.compatible),
        escape(&entry.digest.0),
        escape(&entry.id),
        kind,
        escape(&entry.license),
        escape(&entry.name),
        permissions,
        escape(&entry.provenance),
        entry.revoked,
        entry.size,
        escape(&entry.url),
        escape(&entry.version),
    )
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn decode_payload(bytes: &[u8]) -> Result<CatalogPayload, CatalogError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| CatalogError::Unreadable(error.to_string()))?;
    let schema = value
        .get("schema")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| CatalogError::Unreadable("schema assente".into()))?;
    if schema != u64::from(CATALOG_SCHEMA) {
        return Err(CatalogError::Unreadable(format!(
            "schema {schema} non supportato"
        )));
    }
    let object = value
        .as_object()
        .ok_or_else(|| CatalogError::Unreadable("payload non oggetto".into()))?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "schema" | "generation" | "expires_at" | "entries"
        )
    }) {
        return Err(CatalogError::Unreadable("campi futuri nel payload".into()));
    }
    let generation = value
        .get("generation")
        .and_then(serde_json::Value::as_str)
        .and_then(|generation| generation.parse::<u64>().ok())
        .ok_or_else(|| CatalogError::Unreadable("generation assente o non decimale".into()))?;
    let expires_at = value
        .get("expires_at")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| CatalogError::Unreadable("expires_at assente".into()))?;
    let entries = value
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| CatalogError::Unreadable("entries assenti".into()))?;
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        out.push(decode_entry(entry)?);
    }
    let mut unique = BTreeSet::new();
    for entry in &out {
        let kind = match entry.kind {
            CatalogKind::Plugin => 0,
            CatalogKind::Theme => 1,
        };
        if !unique.insert((kind, entry.id.as_str(), entry.version.as_str())) {
            return Err(CatalogError::Unreadable(format!(
                "voce duplicata `{}` versione `{}`",
                entry.id, entry.version
            )));
        }
    }
    out.sort_by(|a: &CatalogEntry, b: &CatalogEntry| a.id.cmp(&b.id));
    Ok(CatalogPayload {
        generation,
        expires_at,
        entries: out,
    })
}

fn decode_entry(value: &serde_json::Value) -> Result<CatalogEntry, CatalogError> {
    let get = |key: &str| {
        value
            .get(key)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| CatalogError::Unreadable(format!("voce senza `{key}`")))
    };
    let object = value
        .as_object()
        .ok_or_else(|| CatalogError::Unreadable("voce non oggetto".into()))?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "id" | "kind"
                | "name"
                | "version"
                | "abi"
                | "url"
                | "digest"
                | "size"
                | "permissions"
                | "license"
                | "compatible"
                | "provenance"
                | "revoked"
        )
    }) {
        return Err(CatalogError::Unreadable("campi futuri nella voce".into()));
    }
    let digest = Revision(get("digest")?.to_string());
    if !digest
        .0
        .strip_prefix("sha256:")
        .map(|hex| {
            hex.len() == 64
                && hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .unwrap_or(false)
    {
        return Err(CatalogError::Unreadable("digest non canonico".into()));
    }
    let permissions = value
        .get("permissions")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| CatalogError::Unreadable("permissions assenti".into()))?;
    let mut granted = BTreeSet::new();
    for permission in permissions {
        granted.insert(
            permission
                .as_str()
                .ok_or_else(|| CatalogError::Unreadable("permesso non stringa".into()))?
                .to_string(),
        );
    }
    let kind = match value.get("kind").and_then(serde_json::Value::as_str) {
        // Assente = plugin: i feed v1 scritti prima della discriminante temi
        // restano leggibili senza reinterpretarli.
        None | Some("plugin") => CatalogKind::Plugin,
        Some("theme") => CatalogKind::Theme,
        Some(other) => {
            return Err(CatalogError::Unreadable(format!(
                "specie di voce sconosciuta `{other}`"
            )));
        }
    };
    if kind == CatalogKind::Theme && !granted.is_empty() {
        return Err(CatalogError::Unreadable(
            "una voce tema non dichiara permessi".into(),
        ));
    }
    Ok(CatalogEntry {
        id: get("id")?.to_string(),
        kind,
        name: get("name")?.to_string(),
        version: get("version")?.to_string(),
        abi: get("abi")?.to_string(),
        url: get("url")?.to_string(),
        digest,
        size: value
            .get("size")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| CatalogError::Unreadable("size assente".into()))?,
        permissions: granted,
        license: get("license")?.to_string(),
        compatible: get("compatible")?.to_string(),
        provenance: get("provenance")?.to_string(),
        revoked: value
            .get("revoked")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| CatalogError::Unreadable("revoked assente".into()))?,
    })
}

/// Ricerca per sottostringa su id e nome, in ordine di id. Paginata dal
/// chiamante: il catalogo non inventa finestre proprie.
pub fn search<'a>(payload: &'a CatalogPayload, needle: &str) -> Vec<&'a CatalogEntry> {
    let needle = needle.to_lowercase();
    payload
        .entries
        .iter()
        .filter(|entry| {
            needle.is_empty()
                || entry.id.to_lowercase().contains(&needle)
                || entry.name.to_lowercase().contains(&needle)
        })
        .collect()
}

/// Verifica Ed25519 `signature` su `message` con `public_key` (32 byte).
///
/// Il confronto è quello di `ring` (tempo costante sulla firma); la chiave
/// arriva dalle chiavi attendibili configurate, mai dal feed.
fn verify_ed25519(public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<(), String> {
    use ring::signature::{UnparsedPublicKey, ED25519};
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(message, signature)
        .map_err(|_| "verifica Ed25519 fallita".to_string())
}

fn verify_candidate(entry: &CatalogEntry, bytes: &[u8]) -> Result<(), CatalogError> {
    let bundle = crate::WasmBundle::from_bytes(bytes, Trust::Community)
        .map_err(|error| CatalogError::Integrity(format!("componente non valido: {error}")))?;
    let manifest = bundle.manifest();
    let permissions: BTreeSet<String> = manifest
        .permissions
        .granted
        .active()
        .map(|(key, _)| key.to_owned())
        .collect();
    if manifest.id != entry.id
        || manifest.version != entry.version
        || manifest.abi_version != entry.abi
        || permissions != entry.permissions
    {
        return Err(CatalogError::Integrity(
            "manifest reale (id, versione, ABI o permessi) diverso dalla voce di catalogo".into(),
        ));
    }
    Ok(())
}

/// Installa una voce di catalogo dai byte già in mano al chiamante.
///
/// Verifica in ordine: revoca → dimensione → digest → manifest reale letto dal
/// componente (id, versione, ABI, permessi) → installazione. Non scarica né
/// monta: usa gli stessi byte fino al CAS, senza staging file modificabile.
pub(crate) fn install_entry(
    store: &InstalledPluginStore,
    base: &InventorySnapshot,
    entry: &CatalogEntry,
    bytes: &[u8],
    provenance: CatalogProvenance,
) -> Result<InstalledPlugin, CatalogError> {
    if entry.kind != CatalogKind::Plugin {
        return Err(CatalogError::Unreadable(
            "questa voce è un tema: installarla passa da `install_theme_entry`".into(),
        ));
    }
    if entry.revoked {
        return Err(CatalogError::Unavailable(format!(
            "voce `{}` revocata",
            entry.id
        )));
    }
    if bytes.len() as u64 != entry.size {
        return Err(CatalogError::Integrity(format!(
            "dimensione attesa {}, ricevuta {}",
            entry.size,
            bytes.len()
        )));
    }
    if Revision::of_bytes(bytes) != entry.digest {
        return Err(CatalogError::Integrity(
            "digest dei byte diverso dalla voce".into(),
        ));
    }
    verify_candidate(entry, bytes)?;
    Ok(store.install_bytes(base, bytes, Some(provenance))?)
}

/// Aggiorna da catalogo: stesse verifiche di [`install_entry`], poi confronto
/// dei permessi — se le richieste si allargano, il consenso torna a
/// `Undecided` (è già ciò che [`InstalledPluginStore::update`] fa per ogni
/// digest diverso); se si restringono soltanto, vale lo stesso, senza
/// eccezioni. Il rollback è l'update con i byte precedenti salvati, come per
/// il percorso manuale.
pub(crate) fn update_entry(
    store: &InstalledPluginStore,
    base: &InventorySnapshot,
    current: &InstalledPlugin,
    entry: &CatalogEntry,
    bytes: &[u8],
    provenance: CatalogProvenance,
) -> Result<InstalledPlugin, CatalogError> {
    if entry.kind != CatalogKind::Plugin {
        return Err(CatalogError::Unreadable(
            "questa voce è un tema: aggiornarla passa dal percorso temi".into(),
        ));
    }
    if entry.revoked {
        return Err(CatalogError::Unavailable(format!(
            "voce `{}` revocata",
            entry.id
        )));
    }
    if bytes.len() as u64 != entry.size {
        return Err(CatalogError::Integrity(format!(
            "dimensione attesa {}, ricevuta {}",
            entry.size,
            bytes.len()
        )));
    }
    if Revision::of_bytes(bytes) != entry.digest {
        return Err(CatalogError::Integrity(
            "digest dei byte diverso dalla voce".into(),
        ));
    }
    verify_candidate(entry, bytes)?;
    Ok(store.update_bytes(base, current.installation, bytes, Some(provenance))?)
}

/// Revoca: disabilita senza cancellare i dati utente.
///
/// Ritira la voce disabilitandola (mai rimuovendola: i dati
/// `.fub/plugins/<id>` restano intatti) e invalida la validità startup del
/// manager chiamante. Il consenso resta com'era: una revoca non è un'approvazione.
pub(crate) fn revoke(
    store: &InstalledPluginStore,
    base: &InventorySnapshot,
    installation: u64,
    provenance: CatalogProvenance,
) -> Result<(), CatalogError> {
    store.revoke(base, installation, provenance)?;
    Ok(())
}

/// Installa un tema dal feed firmato. Il digest copre l'albero intero e il
/// controllo è ripetuto sulla staging privata prima del puntatore atomico.
pub(crate) fn install_theme_entry(
    config_dir: &camino::Utf8Path,
    entry: &CatalogEntry,
    source_dir: &camino::Utf8Path,
    provenance: serde_json::Value,
) -> Result<camino::Utf8PathBuf, CatalogError> {
    verify_theme_entry(entry, source_dir)?;
    Ok(fub_host::theme::install_theme_checked(
        config_dir,
        source_dir,
        &entry.id,
        &entry.version,
        &entry.digest.0,
        provenance,
    )?)
}

/// Sostituisce il tema mantenendo visibile la generazione precedente finché
/// la nuova è interamente verificata. Il rollback richiede un albero precedente
/// esplicito e una voce firmata della sua versione nel feed corrente.
pub(crate) fn update_theme_entry(
    config_dir: &camino::Utf8Path,
    entry: &CatalogEntry,
    source_dir: &camino::Utf8Path,
    provenance: serde_json::Value,
) -> Result<camino::Utf8PathBuf, CatalogError> {
    verify_theme_entry(entry, source_dir)?;
    Ok(fub_host::theme::update_theme(
        config_dir,
        source_dir,
        &entry.id,
        &entry.version,
        &entry.digest.0,
        provenance,
    )?)
}

fn verify_theme_entry(
    entry: &CatalogEntry,
    source_dir: &camino::Utf8Path,
) -> Result<(), CatalogError> {
    if entry.kind != CatalogKind::Theme {
        return Err(CatalogError::Unreadable("la voce non è un tema".into()));
    }
    if entry.revoked {
        return Err(CatalogError::Unavailable(format!(
            "voce `{}` revocata",
            entry.id
        )));
    }
    if entry.abi != fub_abi::theme::THEME_ENGINE || !entry.permissions.is_empty() {
        return Err(CatalogError::Unreadable(
            "motore di tema o permessi non validi".into(),
        ));
    }
    let actual = fub_host::theme::theme_tree_digest(source_dir)?;
    let manifest = std::fs::symlink_metadata(source_dir.join("manifest.json").as_std_path())?;
    if !manifest.file_type().is_file() {
        return Err(CatalogError::Integrity(
            "manifest non è un file regolare".into(),
        ));
    }
    if manifest.len() != entry.size {
        return Err(CatalogError::Integrity(
            "dimensione del manifest diversa dalla voce".into(),
        ));
    }
    if actual != entry.digest.0 {
        return Err(CatalogError::Integrity(
            "digest dell'albero tema diverso dalla voce".into(),
        ));
    }
    Ok(())
}
