//! Risorse bounded del vault: allegati e media letti a finestre, mai riversati.
//!
//! # Indagine sulle porte esistenti (P07)
//!
//! - `VaultRead::read_document` restituisce `String`: testo UTF-8 decodificato
//!   (`Vault::read` + `text_policy::decode`). Non e' una porta binaria: su un
//!   PNG fallisce con `InvalidData`, su un PDF corromperebbe.
//! - `VaultRead::read_document_bytes` restituisce `Vec<u8>` grezzi ed e' la sola
//!   vera porta binaria verso i plugin, ma e' **non bounded**: l'intero file in
//!   memoria e, sull'IPC, un array JSON di numeri. Per un video da 500 MiB e'
//!   la forma che la decisione 0102 ha gia' scartato per gli import.
//! - `TransferRead::read_source(handle, offset, len)` e' posizionale e bounded
//!   (short read ammessi, vuoto = EOF), ma serve solo le sorgenti di import
//!   aperte con `Workspace::open_source` per la durata di una chiamata: un file
//!   del vault non ci passa.
//! - `Host::read_document_with_format` / comando IPC `read_document`
//!   fotografano sorgente + revisione + formato, sempre come testo.
//!
//! # Cosa sta qui
//!
//! Handle opachi e monotoni ([`ResourceHandle`], mai riusati), descrittori
//! piccoli ([`ResourceDescriptor`] con `revision: Option<String>` — `None` in
//! apertura: l'open e' metadata puri, mai hash calcolato aprendo), letture a
//! chunk clampati ([`RESOURCE_CHUNK_BYTES`]) con semantica short-read identica
//! a `TransferRead` (vuoto = EOF, handle ignoto = `BadArgs`, fuori recinto =
//! `PermissionDenied`), tabella unica ([`ResourceTable`]) che possiede un
//! [`ResourceLease`] stabile per handle (il tipo canonico del kernel), drenata
//! per vault con contatore globale monotono non resettabile, e i trait puri
//! [`ResourceHost`] / [`ResourceWrite`] che Main implementa su `Host`
//! (tabella in Custody: Custody chiusa = `Internal`, mai mascherata).
//!
//! I byte non attraversano mai il JSON: `fub-app` li serve come
//! `tauri::ipc::Response` binaria (ArrayBuffer) o via protocollo `fub-asset:`
//! con `Range` (vedi `crates/fub-app/src/resources.rs`). Il client non assembla
//! mai oltre [`RESOURCE_MAX_INLINE_BYTES`].
//!
//! Range e deposito li serve il kernel staged: `prepare_resource_open` e
//! `Workspace::prepare_resource_read` fanno metadata/range I/O senza
//! `Custody<Workspace>` ne' lock della tabella; la Session guard blocca il
//! closeVault e `resourceClose` revoca le letture in volo con lookup finale
//! sull'handle monotono. `Host::write_document_bytes` + `ResourceWrite`
//! tornano la ricevuta senza aprire handle.

use std::collections::BTreeMap;

use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_abi::rules::media::mime_of;
use fub_abi::PluginError;

/// Quanto chiede per volta chi legge una risorsa: la stessa grana di
/// `READ_CHUNK` di `fub_abi::transfer` (256 KiB la' dentro e' il suggerimento
/// per `read_all`; qui e' un tetto imposto, perche' ogni chunk attraversa
/// l'IPC).
pub const RESOURCE_CHUNK_BYTES: u32 = 64 * 1024;

/// Quanti byte il client puo' tenere assemblati in memoria per una risorsa
/// inline (anteprima immagine, pagina PDF via `data`). Oltre, solo streaming
/// via `fub-asset:` con `Range`: un errore `limit` esplicito, mai un OOM.
pub const RESOURCE_MAX_INLINE_BYTES: u64 = 64 * 1024 * 1024;

/// Quanti handle possono restare aperti insieme. Gli handle sono voci piccole
/// (vault + id + metadati), ma un client che apre e non chiude non deve poter
/// crescere per sempre: oltre si risponde `Io` nominando il tetto, come
/// `MAX_BODY` di `fub-host/src/net.rs` si fa sentire quando morde.
pub const RESOURCE_MAX_OPEN: usize = 256;

/// La chiave con cui si legge una risorsa del vault senza averla in mano.
///
/// Opaca e monotona come [`SourceHandle`](fub_abi::transfer::SourceHandle):
/// la timbra l'host, non si costruisce, e un numero riciclato farebbe leggere
/// a chi si e' tenuto un handle vecchio la risorsa di qualcun altro invece
/// del `BadArgs` che merita. In JSON viaggia come stringa (regola
/// `fub_abi::ipc`: oltre 2^53 un `number` perde bit in silenzio).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ResourceHandle(pub u64);

impl serde::Serialize for ResourceHandle {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        fub_abi::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> serde::Deserialize<'de> for ResourceHandle {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        fub_abi::ipc::u64_string::deserialize(d).map(ResourceHandle)
    }
}

/// La specie di una risorsa, dal MIME dedotto dal nome
/// (`fub_abi::rules::media::mime_of`, che resta l'autorita': qui non si
/// ridichiara nessuna tabella).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Image,
    Audio,
    Video,
    Pdf,
    Other,
}

/// La specie di un file del vault, senza aprirlo.
pub fn resource_kind_of(id: &DocId) -> ResourceKind {
    match mime_of(id) {
        Some(mime) if mime.starts_with("image/") => ResourceKind::Image,
        Some(mime) if mime.starts_with("audio/") => ResourceKind::Audio,
        Some(mime) if mime.starts_with("video/") => ResourceKind::Video,
        Some("application/pdf") => ResourceKind::Pdf,
        _ => ResourceKind::Other,
    }
}

/// Il MIME da servire, o il fallback onesto quando non si sa.
pub fn resource_mime_or_octet(id: &DocId) -> &str {
    mime_of(id).unwrap_or("application/octet-stream")
}

/// La ricevuta di un deposito binario riuscito: l'id fenced realmente scritto
/// e la revisione dei byte depositati (`Revision::of_bytes` calcolata sui byte
/// appena scritti, non riletta dal disco). Niente handle, niente len/mime/kind,
/// nessuna seconda lettura dopo il commit: aprire la risorsa e' un passo
/// separato, e fallire l'open non fa fallire retroattivamente il deposito
/// (quota handle piena o close non rendono fallita una scrittura gia' riuscita).
/// `id`/`revision` serializzano come i rispettivi tipi canonici (`DocId`
/// stringa, `Revision` stringa opaca).
/// Rispecchiata in `apps/client/src/editors/media/transport.ts`
/// (`ResourceWriteReceipt`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ResourceWriteReceipt {
    pub id: DocId,
    pub revision: Revision,
}

/// Tutto cio' che serve a disegnare una risorsa senza aprirla: poche centinaia
/// di byte di JSON, non il file. Rispecchiato in
/// `apps/client/src/editors/media/resource-port.ts` (`ResourceDescriptor`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ResourceDescriptor {
    pub handle: ResourceHandle,
    pub id: DocId,
    pub len: u64,
    pub mime: String,
    pub kind: ResourceKind,
    /// `None` in apertura: l'open e' metadata puri, mai hash calcolato aprendo
    /// (un video da 500 MiB non si hasha per un descrittore di poche centinaia
    /// di byte). `Some` solo quando Main la fornisce da fonte gia' nota.
    pub revision: Option<String>,
}

/// Impone il tetto a una richiesta di lettura. `0` resta `0` (una lettura
/// vuota e' lecita e torna vuota); oltre il tetto si serve il tetto, come
/// `TransferRead` puo' dare meno byte di `len` senza che sia un errore.
pub fn clamp_chunk(requested: u32) -> u32 {
    requested.min(RESOURCE_CHUNK_BYTES)
}

/// Il lease stabile che la tabella possiede per un handle: il tipo canonico
/// vive UNA volta nel kernel (`fub_kernel::transfer::ResourceLease`,
/// StorageOwner ne possiede invarianti e metadati). La tabella possiede quel
/// tipo opaco, l'App non lo serializza mai (solo `ResourceDescriptor`
/// attraversa l'IPC).
pub use fub_kernel::transfer::ResourceLease;

struct OpenResource {
    vault: String,
    id: DocId,
    len: u64,
    revision: Option<String>,
    mime: String,
    /// Il lease posseduto in `Arc`: `lease(handle)` clona l'`Arc` senza
    /// copiare root/path per ogni chunk, e `Workspace::prepare_resource_read`
    /// (Main) puo' invocare la lettura fuori dal lock della tabella e fuori
    /// da `Custody<Workspace>` con il lease gia' in mano.
    lease: std::sync::Arc<ResourceLease>,
}

/// Handle vivi dell'istanza; il contatore non viene riusato dopo la chiusura.
#[derive(Default)]
pub struct ResourceTable {
    next: u64,
    open: BTreeMap<u64, OpenResource>,
}

impl ResourceTable {
    /// Registra un lease staged (metadata puri dal kernel, senza caricarne i
    /// byte) e ne restituisce il descrittore. `len` e' `lease.stat.size`,
    /// `revision` passa solo se il lease la porta: l'open e' metadata, mai
    /// hash calcolato aprendo.
    pub fn open(
        &mut self,
        vault: String,
        id: DocId,
        lease: ResourceLease,
        mime: String,
    ) -> Result<ResourceDescriptor, PluginError> {
        if self.open.len() >= RESOURCE_MAX_OPEN {
            return Err(PluginError::Io(
                format!(
                    "too many open resources ({}): close some before opening `{}`",
                    RESOURCE_MAX_OPEN,
                    id.as_str()
                )
                .into(),
            ));
        }
        let raw = self
            .next
            .checked_add(1)
            .ok_or_else(|| PluginError::Internal("resource handle space exhausted".into()))?;
        self.next = raw;
        let kind = resource_kind_of(&id);
        let revision = lease.revision.clone().map(|revision| revision.0);
        let len = lease.stat.size;
        self.open.insert(
            raw,
            OpenResource {
                vault,
                id: id.clone(),
                len,
                revision: revision.clone(),
                mime: mime.clone(),
                lease: std::sync::Arc::new(lease),
            },
        );
        Ok(ResourceDescriptor {
            handle: ResourceHandle(raw),
            id,
            len,
            mime,
            kind,
            revision,
        })
    }

    /// Il lease stabile dietro un handle, in `Arc` clonato: nessuna copia di
    /// root/path per chunk, e il chiamante (Main/Host: lookup prima, ricontrollo
    /// dopo l'I/O su handle monotono con close che revoca) puo' tenere il lease
    /// fuori dal lock della tabella. Assente = `BadArgs` al chiamante; la
    /// Custody che non si apre e' `Internal` a carico di chi chiama, mai
    /// mascherata qui dentro.
    pub fn lease(
        &self,
        handle: ResourceHandle,
    ) -> Result<std::sync::Arc<ResourceLease>, PluginError> {
        self.open
            .get(&handle.0)
            .map(|entry| std::sync::Arc::clone(&entry.lease))
            .ok_or_else(|| {
                PluginError::BadArgs(format!("resource handle `{}` is not open", handle.0).into())
            })
    }

    /// Il descrittore corrente di un handle aperto, o `None`.
    pub fn descriptor(&self, handle: ResourceHandle) -> Option<ResourceDescriptor> {
        self.open.get(&handle.0).map(|entry| ResourceDescriptor {
            handle,
            id: entry.id.clone(),
            len: entry.len,
            mime: entry.mime.clone(),
            kind: resource_kind_of(&entry.id),
            revision: entry.revision.clone(),
        })
    }

    /// Dove sta il file dietro un handle: radice canonica del vault e id.
    pub fn resolve(&self, handle: ResourceHandle) -> Option<(&str, &DocId)> {
        self.open
            .get(&handle.0)
            .map(|entry| (entry.vault.as_str(), &entry.id))
    }

    /// Chiude. Chiudere cio' che non c'e' riesce: chi chiude due volte non sta
    /// sbagliando niente che valga un errore (stessa regola di
    /// `OpenSources::close` e `close_source`). Torna se la voce esisteva.
    pub fn close(&mut self, handle: ResourceHandle) -> bool {
        self.open.remove(&handle.0).is_some()
    }

    /// Chiude tutto di un vault (Main la chiama alla chiusura del vault, la
    /// tabella resta unica su `Host`). Torna quanti handle erano aperti per
    /// quel vault: dopo, ogni lettura vecchia e' `BadArgs`. Il contatore non
    /// si azzera mai: nessun handle si riusa.
    pub fn drain_vault(&mut self, vault: &str) -> usize {
        let before = self.open.len();
        self.open.retain(|_, entry| entry.vault != vault);
        before - self.open.len()
    }

    /// Chiude tutto (Main la chiama allo shutdown). Torna quanti handle erano
    /// aperti. Il contatore non si azzera mai: nessun handle si riusa.
    pub fn drain(&mut self) -> usize {
        let count = self.open.len();
        self.open.clear();
        count
    }

    pub fn is_empty(&self) -> bool {
        self.open.is_empty()
    }
}

/// La porta che Main implementa su `Host` in `session.rs`.
///
/// - `resource_open`: staging metadata via `prepare_resource_open`, registra
///   l'handle nella tabella unica su `Host` e torna il descrittore con
///   `revision: None` (open metadata, mai hash).
/// - `resource_read` serve al piu' `RESOURCE_CHUNK_BYTES` a partire da
///   `offset`, con la semantica di `TransferRead::read_source`: puo' dare meno
///   byte di `len` senza che sia un errore, vuoto significa EOF, handle
///   sconosciuto o chiuso significa `BadArgs`. Il corpo staged e'
///   `Workspace::prepare_resource_read` (Arc lease, fuori lock tabella e fuori
///   `Custody<Workspace>`); la Session guard blocca il closeVault e il lookup
///   finale sull'handle monotono revoca le letture in volo.
/// - `resource_descriptor` rilegge il descrittore corrente (MIME e lunghezza
///   per il protocollo, senza toccare i byte): `Ok(None)` = handle assente
///   (`BadArgs` al chiamante), `Err(Internal)` = la Custody non si apre.
/// - `resource_close` e' idempotente (`Ok` anche su handle gia' assente);
///   `Err(Internal)` solo se la Custody non si apre.
pub trait ResourceHost: Send + Sync {
    fn resource_open(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<ResourceDescriptor, PluginError>;
    fn resource_read(
        &self,
        handle: ResourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError>;
    fn resource_descriptor(
        &self,
        handle: ResourceHandle,
    ) -> Result<Option<ResourceDescriptor>, PluginError>;
    fn resource_close(&self, handle: ResourceHandle) -> Result<(), PluginError>;
}

/// Scrittura binaria atomica nel vault: paste/drop/download, chunk finali del
/// recorder, download remoti espliciti. Mai `note.create` Markdown per dei
/// byte: quella e' una trasformazione di testo, non un deposito.
///
/// Il trait e' puro e sta qui (non in `fub-app`): lo implementa Main su `Host`
/// (via `Host::write_document_bytes`, detached) come fa per `ResourceHost`.
/// `expected` e' il CAS obbligatorio nella forma, mai un default `Dictated`
/// nascosto:
/// - `None` = **create-only atomico**: crea solo se il path e' libero, mai
///   sovrascrive. Paste, download espliciti e chunk del recorder usano questa
///   forma con nomi gia' risolti via `free_name`;
/// - `Some(revision)` = **CAS sulla revisione**: scrive solo se la revisione
///   corrente e' ancora quella, senza chiedere la preimmagine completa dei
///   byte. Chi scrive ha letto il descrittore (`revision: Option<String>`) e
///   ricontrolla prima di coprire.
///
/// Torna la ricevuta, non un descrittore con handle: registrare un handle dopo
/// il commit potrebbe fallire per quota o close e far apparire fallita una
/// scrittura gia' riuscita. Chi vuole leggere apre la risorsa separatamente.
pub trait ResourceWrite: Send + Sync {
    fn resource_write(
        &self,
        vault: Option<&str>,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<ResourceWriteReceipt, PluginError>;
}

// ---------------------------------------------------------------------------
// Nomi di deposito e link relativi (regola mirrorata in
// `apps/client/src/editors/media/attachment-target.ts`)
// ---------------------------------------------------------------------------

/// Un nome di file scritto dall'utente o arrivato da fuori, ridotto a un
/// singolo segmento sicuro: niente separatori, niente nomi che risalgono,
/// niente stringhe vuote. Il server (kernel `free_name`) resta l'autorita'
/// sulle collisioni; qui non si atterra niente sul disco.
pub fn sanitize_file_name(name: &str) -> Result<String, PluginError> {
    let flat = name.replace('\\', "/");
    let base = flat.rsplit('/').next().unwrap_or("").trim();
    if base.is_empty() || base == "." || base == ".." || base.chars().any(char::is_control) {
        return Err(PluginError::BadArgs(
            format!("`{name}` is not a usable file name").into(),
        ));
    }
    if base.len() > 255 {
        return Err(PluginError::BadArgs(
            format!("`{name}` exceeds the 255-byte file name limit").into(),
        ));
    }
    Ok(base.to_string())
}

/// Il candidato `n`-esimo di una collisione, con la stessa forma di
/// `Workspace::free_name`: `foto.png`, `foto 1.png`, `foto 2.png`, ...
pub fn attachment_candidate(stem: &str, ext: &str, n: u32) -> String {
    let suffix = if n == 0 {
        String::new()
    } else {
        format!(" {n}")
    };
    let dot = if ext.is_empty() { "" } else { "." };
    let available = 255usize.saturating_sub(suffix.len() + dot.len() + ext.len());
    if stem.len() <= available {
        return format!("{stem}{suffix}{dot}{ext}");
    }
    let cut = stem
        .char_indices()
        .take_while(|(at, ch)| *at + ch.len_utf8() <= available)
        .last()
        .map_or(0, |(at, ch)| at + ch.len_utf8());
    format!("{}{}{}{}", &stem[..cut], suffix, dot, ext)
}

/// Divide `foto.png` in `("foto", "png")`. Senza estensione: `("LICENSE", "")`.
pub fn split_file_name(name: &str) -> (&str, &str) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() && !ext.contains('/') => {
            (stem, ext)
        }
        _ => (name, ""),
    }
}

/// Il link relativo da scrivere in `from` verso `to`, con i segmenti
/// percent-encoded. `from` e' il documento che ospita il link, `to`
/// l'allegato: due id nella stessa cartella danno `foto.png`, da una
/// sottocartella `../allegati/foto.png`. Stesso file: il solo basename.
pub fn relative_url(from: &DocId, to: &DocId) -> String {
    let from_dir: Vec<&str> = match from.as_str().rsplit_once('/') {
        Some((dir, _)) => dir.split('/').collect(),
        None => Vec::new(),
    };
    let to_parts: Vec<&str> = to.as_str().split('/').collect();
    let mut common = 0;
    while common < from_dir.len()
        && common < to_parts.len().saturating_sub(1)
        && from_dir[common] == to_parts[common]
    {
        common += 1;
    }
    let mut out = String::new();
    for _ in common..from_dir.len() {
        out.push_str("../");
    }
    let rest = &to_parts[common..];
    for (i, part) in rest.iter().enumerate() {
        if i > 0 {
            out.push('/');
        }
        out.push_str(&percent_encode_segment(part));
    }
    out
}

fn percent_encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.as_bytes() {
        if matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~') {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(path: &str) -> DocId {
        DocId::new(path)
    }

    fn lease(size: u64, revision: Option<Revision>) -> ResourceLease {
        ResourceLease {
            root: camino::Utf8PathBuf::from("/vault"),
            path: "a.png".to_string(),
            identity: Some(fub_kernel::FileIdentity { volume: 1, file: 2 }),
            stat: fub_kernel::Stat {
                kind: fub_kernel::storage::EntryKind::File,
                size,
                mtime: 1000,
            },
            change: Some(7),
            revision,
        }
    }

    #[test]
    fn kinds_come_from_the_shared_mime_rule() {
        assert_eq!(resource_kind_of(&doc("img/foto.png")), ResourceKind::Image);
        assert_eq!(
            resource_kind_of(&doc("img/FOTO.JPG")),
            ResourceKind::Image,
            "il confronto non distingue il caso, come mime_for_ext"
        );
        assert_eq!(resource_kind_of(&doc("memo.m4a")), ResourceKind::Audio);
        assert_eq!(resource_kind_of(&doc("clip.webm")), ResourceKind::Video);
        assert_eq!(resource_kind_of(&doc("doc/manuale.pdf")), ResourceKind::Pdf);
        assert_eq!(resource_kind_of(&doc("dati.zip")), ResourceKind::Other);
        assert_eq!(
            resource_kind_of(&doc("nota.md")),
            ResourceKind::Other,
            "un documento non e' una risorsa"
        );
    }

    #[test]
    fn handles_are_monotonic_and_never_reused() {
        let mut table = ResourceTable::default();
        let first = table
            .open(
                "/vault".to_string(),
                doc("a.png"),
                lease(10, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert_eq!(first.revision, None, "l'open e' metadata: mai hash aprendo");
        assert_eq!(first.len, 10, "la lunghezza viene dal lease, non dai byte");
        let known = table
            .open(
                "/vault".to_string(),
                doc("b.png"),
                lease(10, Some(Revision::of_bytes(b"0123456789"))),
                "image/png".to_string(),
            )
            .unwrap();
        assert_eq!(
            known.revision,
            Some(Revision::of_bytes(b"0123456789").0),
            "la revision passa solo se il lease la porta gia'"
        );
        assert!(
            table.lease(first.handle).is_ok(),
            "la tabella possiede il lease"
        );
        table.close(first.handle);
        let second = table
            .open(
                "/vault".to_string(),
                doc("a.png"),
                lease(10, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert_ne!(
            first.handle, second.handle,
            "un handle chiuso non si riassegna: chi se l'era tenuto legge BadArgs, non altri byte"
        );
        assert!(table.resolve(first.handle).is_none());
        assert!(
            table.lease(first.handle).is_err(),
            "handle chiuso = BadArgs, non altri byte"
        );
    }

    #[test]
    fn handles_never_reused_across_vault_drains() {
        let mut table = ResourceTable::default();
        let first = table
            .open(
                "/vault".to_string(),
                doc("a.png"),
                lease(1, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert_eq!(table.drain_vault("/vault"), 1);
        let second = table
            .open(
                "/vault".to_string(),
                doc("a.png"),
                lease(1, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert_ne!(
            first.handle, second.handle,
            "il contatore non si azzera al drain: la tabella e' unica, monotona, non resettabile"
        );
    }

    #[test]
    fn closing_twice_succeeds_and_draining_invalidates() {
        let mut table = ResourceTable::default();
        let desc = table
            .open(
                "/vault".to_string(),
                doc("a.png"),
                lease(3, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert!(table.close(desc.handle));
        assert!(!table.close(desc.handle));
        let again = table
            .open(
                "/vault".to_string(),
                doc("b.png"),
                lease(3, None),
                "image/png".to_string(),
            )
            .unwrap();
        assert_eq!(table.drain(), 1);
        assert!(table.is_empty());
        assert!(table.resolve(again.handle).is_none());
    }

    #[test]
    fn too_many_open_handles_are_a_visible_limit() {
        let mut table = ResourceTable::default();
        for n in 0..RESOURCE_MAX_OPEN {
            table
                .open(
                    "/vault".to_string(),
                    doc(&format!("f{n}.png")),
                    lease(1, None),
                    "image/png".to_string(),
                )
                .unwrap();
        }
        let err = table
            .open(
                "/vault".to_string(),
                doc("overflow.png"),
                lease(1, None),
                "image/png".to_string(),
            )
            .expect_err("il tetto deve mordersi in modo visibile");
        assert!(
            matches!(err, PluginError::Io(_)),
            "faccia sbagliata: {err:?}"
        );
    }

    #[test]
    fn chunk_requests_are_clamped_not_rejected() {
        assert_eq!(clamp_chunk(0), 0);
        assert_eq!(clamp_chunk(1024), 1024);
        assert_eq!(clamp_chunk(u32::MAX), RESOURCE_CHUNK_BYTES);
    }

    #[test]
    fn file_names_cannot_escape_or_vanish() {
        assert_eq!(sanitize_file_name("foto.png").unwrap(), "foto.png");
        assert_eq!(
            sanitize_file_name("C:\\foto\\a.png").unwrap(),
            "a.png",
            "i separatori Windows cadono, resta l'ultimo segmento"
        );
        assert_eq!(sanitize_file_name("  a.png  ").unwrap(), "a.png");
        for bad in ["", "   ", ".", "..", "a\u{0000}.png"] {
            assert!(
                sanitize_file_name(bad).is_err(),
                "{bad:?} deve essere rifiutato"
            );
        }
        // `a/b/../c.png` ha segmenti leciti ma risale: resta `c.png`, e il
        // recinto vero (`fenced`) lo applica comunque il kernel al DocId.
        assert_eq!(sanitize_file_name("a/b/../c.png").unwrap(), "c.png");
        assert_eq!(sanitize_file_name("../x.png").unwrap(), "x.png");
    }

    #[test]
    fn collision_candidates_match_the_kernel_shape() {
        assert_eq!(attachment_candidate("foto", "png", 0), "foto.png");
        assert_eq!(attachment_candidate("foto", "png", 1), "foto 1.png");
        assert_eq!(attachment_candidate("foto", "png", 12), "foto 12.png");
        assert_eq!(attachment_candidate("LICENSE", "", 0), "LICENSE");
        assert_eq!(attachment_candidate("LICENSE", "", 1), "LICENSE 1");
        let long = "x".repeat(251);
        let collided = attachment_candidate(&long, "png", 1);
        assert_eq!(collided.len(), 255);
        assert!(collided.ends_with(" 1.png"));
        assert_eq!(split_file_name("foto.png"), ("foto", "png"));
        assert_eq!(split_file_name("LICENSE"), ("LICENSE", ""));
    }

    #[test]
    fn relative_links_stay_relative() {
        assert_eq!(
            relative_url(&doc("nota.md"), &doc("allegati/foto.png")),
            "allegati/foto.png"
        );
        assert_eq!(
            relative_url(&doc("note/a.md"), &doc("allegati/foto.png")),
            "../allegati/foto.png"
        );
        assert_eq!(
            relative_url(&doc("note/a.md"), &doc("note/foto.png")),
            "foto.png"
        );
        assert_eq!(relative_url(&doc("a/b/c.md"), &doc("a/d.png")), "../d.png");
        assert_eq!(
            relative_url(&doc("a.md"), &doc("a.md")),
            "a.md",
            "lo stesso file nomina il basename, non una stringa vuota"
        );
        assert_eq!(
            relative_url(&doc("n.md"), &doc("allegati/una foto.png")),
            "allegati/una%20foto.png"
        );
    }

    #[test]
    fn handles_cross_the_json_boundary_as_strings() {
        let handle = ResourceHandle(9_007_199_254_740_993);
        let json = serde_json::to_value(handle).unwrap();
        assert_eq!(json, serde_json::json!("9007199254740993"));
        let back: ResourceHandle = serde_json::from_value(json).unwrap();
        assert_eq!(back, handle);
    }

    #[test]
    fn write_receipt_carries_id_and_revision_as_canonical_strings() {
        let receipt = ResourceWriteReceipt {
            id: doc("allegati/foto.png"),
            revision: Revision::of_bytes(b"\x00\xffBOM\r\n"),
        };
        let json = serde_json::to_value(&receipt).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "allegati/foto.png",
                "revision": Revision::of_bytes(b"\x00\xffBOM\r\n").0,
            }),
            "id/revision viaggiano come i tipi canonici, byte-identici compresi"
        );
        let back: ResourceWriteReceipt = serde_json::from_value(json).unwrap();
        assert_eq!(back, receipt);
    }
}
