//! Versioning del vault: snapshot per-file, tombstone, ripristino.
//!
//! È **dogfooding del contratto**: il campionatore è un
//! [`EventHandler`](fubmd_abi::traits::EventHandler) che legge via
//! [`HostApi`](fubmd_abi::traits::HostApi), cioè con gli stessi strumenti che
//! avrà un plugin di terzi a M5. Il kernel non sa che esiste — e infatti il
//! ripristino di una versione non è un'operazione del kernel: è una scrittura
//! normale (D8), che l'app compone.
//!
//! # Perché gli eventi qui vanno bene (e all'indice no)
//!
//! Un [`Event::Overflow`] può far perdere uno snapshot intermedio. Per un
//! *campionatore* è accettabile: la versione successiva arriverà al prossimo
//! salvataggio, e nel frattempo la verità — il file sul disco — non è cambiata.
//! Un indice no: un indice che perde un aggiornamento non tace, risponde
//! sbagliato. È la ragione per cui gli indici il kernel li alimenta da sé e il
//! versioning invece passa di qui.
//!
//! # Lo store, e chi comanda fra store e indice
//!
//! ```text
//! .fubmd-data/versions/
//!   versions.json                    indice: doc_id → versioni + tombstone
//!   <dir>/meta.json                  { doc_id, deleted_at }
//!   <dir>/<ts>.md                    il contenuto di una versione
//! ```
//!
//! `versions.json` è **derivato**: se manca, non si legge o non torna, si
//! ricostruisce leggendo lo store (ogni cartella dice di chi è, ogni file dice
//! quando). Mai il contrario — stessa filosofia del manifest dell'indice di
//! ricerca. Per questo il `doc_id` vive anche dentro la cartella: senza, un
//! indice perso renderebbe le versioni irraggiungibili, visto che il nome della
//! cartella è un'impronta e le impronte non si invertono.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::event::{Event, EventKind, EventMask};
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{EventHandler, HostApi};
use fubmd_abi::PluginError;
use fubmd_kernel::time::now_unix_millis;
use serde::{Deserialize, Serialize};

/// Versione del formato dello store. Da incrementare se cambia la struttura
/// su disco: un indice di un'altra epoca si butta e si ricostruisce.
const SCHEMA_VERSION: u32 = 1;

const INDEX_FILE: &str = "versions.json";
const META_FILE: &str = "meta.json";

const MS_ORA: u64 = 3_600_000;
const MS_GIORNO: u64 = 24 * MS_ORA;

/// Fasce di ritenzione (D6): sotto le 24 ore si tiene **tutto**, fino a una
/// settimana una versione all'ora, fino a tre mesi una al giorno. Oltre, la
/// storia recente — quella che si ripesca davvero — è già al sicuro.
const FASCIA_TUTTO: u64 = MS_GIORNO;
const FASCIA_ORARIA: u64 = 7 * MS_GIORNO;
const FASCIA_GIORNALIERA: u64 = 90 * MS_GIORNO;

/// Una versione salvata.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionRef {
    /// Istante dello snapshot (millisecondi UNIX): è anche la sua identità.
    pub ts: u64,
    /// Impronta del contenuto, per il dedup (D6).
    pub hash: u64,
    pub size: u64,
}

/// Le versioni di un documento, più il suo eventuale tombstone.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct DocVersions {
    /// Cartella dello store (nasce come impronta del `doc_id`, ma dopo un
    /// rename non lo è più: la chiave migra, la cartella resta dov'è).
    dir: String,
    /// Quando il documento è stato cancellato, se lo è stato. È il tombstone:
    /// serve a sapere che a un certo istante quel file *non* c'era più.
    deleted_at: Option<u64>,
    /// Dalla più vecchia alla più recente.
    versions: Vec<VersionRef>,
}

#[derive(Serialize, Deserialize)]
struct Index {
    schema_version: u32,
    docs: BTreeMap<String, DocVersions>,
}

/// Ciò che una cartella dello store dice di sé. Basta a ricostruire l'indice.
#[derive(Serialize, Deserialize)]
struct Meta {
    doc_id: String,
    deleted_at: Option<u64>,
}

struct Inner {
    dir: Utf8PathBuf,
    docs: BTreeMap<String, DocVersions>,
}

/// Lo store delle versioni.
///
/// Clonabile e condiviso: una copia vive dentro il
/// [`VersioningHandler`] registrato nel workspace, l'altra resta all'app, che
/// deve poter elencare e rileggere le versioni senza passare dagli eventi.
#[derive(Clone)]
pub struct VersionStore {
    inner: Arc<Mutex<Inner>>,
}

impl VersionStore {
    /// Apre (o crea) lo store nella cartella dati del vault.
    pub fn open(vault_root: &Utf8Path) -> Result<Self, PluginError> {
        Self::open_dir(&vault_root.join(".fubmd-data").join("versions"))
    }

    pub fn open_dir(dir: &Utf8Path) -> Result<Self, PluginError> {
        std::fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
        let docs = load_index(dir).unwrap_or_else(|| {
            let ricostruito = rebuild_from_store(dir);
            if !ricostruito.is_empty() {
                eprintln!(
                    "versioning: indice assente o illeggibile, ricostruito dallo store \
                     ({} document{})",
                    ricostruito.len(),
                    if ricostruito.len() == 1 { "o" } else { "i" }
                );
            }
            ricostruito
        });
        Ok(VersionStore {
            inner: Arc::new(Mutex::new(Inner {
                dir: dir.to_owned(),
                docs,
            })),
        })
    }

    /// Salva una versione, se il contenuto è diverso dall'ultima salvata.
    ///
    /// Restituisce `None` quando il dedup (D6) ha deciso che non c'era niente
    /// di nuovo: è il caso normale del salvataggio che riscrive lo stesso testo.
    pub fn snapshot(&self, id: &DocId, source: &str) -> Result<Option<VersionRef>, PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let hash = fingerprint(source);
        let dir_doc = inner.ensure_dir(id)?;

        {
            let doc = inner.docs.entry(id.to_string()).or_default();
            if doc.versions.last().is_some_and(|v| v.hash == hash) {
                return Ok(None);
            }
        }

        let ts = inner.free_ts(id);
        let path = inner
            .dir
            .join(&dir_doc)
            .join(snapshot_name(ts, id.as_str()));
        std::fs::write(&path, source).map_err(|e| io_err(&path, e))?;

        let version = VersionRef {
            ts,
            hash,
            size: source.len() as u64,
        };
        let doc = inner.docs.entry(id.to_string()).or_default();
        doc.versions.push(version);
        // Una nota che torna in vita non è più morta: il tombstone se ne va, o
        // "il vault al tempo T" la crederebbe cancellata per sempre.
        doc.deleted_at = None;

        inner.prune(id);
        inner.write_meta(id)?;
        inner.write_index()?;
        Ok(Some(version))
    }

    /// Migra le versioni sul nuovo path: l'identità di un documento **è** il
    /// suo path, e un rename la sposta senza spezzare la storia.
    pub fn rename(&self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let Some(doc) = inner.docs.remove(from.as_str()) else {
            return Ok(());
        };
        // Se il nuovo nome aveva già una storia (una nota cancellata e poi
        // rimpiazzata), le due si uniscono in ordine di tempo: buttarne una
        // sarebbe perdere versioni senza dirlo.
        let unito = match inner.docs.remove(to.as_str()) {
            None => doc,
            Some(esistente) => merge(doc, esistente),
        };
        inner.docs.insert(to.to_string(), unito);
        inner.write_meta(to)?;
        inner.write_index()
    }

    /// Segna che il documento, a questo istante, non c'è più.
    pub fn tombstone(&self, id: &DocId) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let Some(doc) = inner.docs.get_mut(id.as_str()) else {
            return Ok(());
        };
        doc.deleted_at = Some(now_unix_millis());
        inner.write_meta(id)?;
        inner.write_index()
    }

    /// Le versioni di un documento, dalla più recente alla più vecchia.
    pub fn list(&self, id: &DocId) -> Vec<VersionRef> {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .map(|d| d.versions.iter().rev().copied().collect())
            .unwrap_or_default()
    }

    /// Il contenuto di una versione.
    pub fn read(&self, id: &DocId, ts: u64) -> Result<String, PluginError> {
        let inner = self.inner.lock().expect("mutex");
        let doc = inner
            .docs
            .get(id.as_str())
            .ok_or_else(|| PluginError::BadArgs(format!("nessuna versione di {id}")))?;
        if !doc.versions.iter().any(|v| v.ts == ts) {
            return Err(PluginError::BadArgs(format!("versione {ts} di {id}: non c'è")));
        }
        let path = inner
            .dir
            .join(&doc.dir)
            .join(snapshot_name(ts, id.as_str()));
        std::fs::read_to_string(&path).map_err(|e| io_err(&path, e))
    }

    /// Questo documento ha già una storia?
    ///
    /// Serve a chi apre il vault per decidere se scattargli la **prima
    /// fotografia**: gli snapshot nascono dagli eventi, e l'apertura di un
    /// vault non ne emette per documento. Senza una prima versione, la prima
    /// modifica a una nota mai versionata cancellerebbe per sempre lo stato in
    /// cui l'utente l'ha trovata — l'handler, che gira *dopo* la scrittura,
    /// vede solo il testo nuovo.
    pub fn has_versions(&self, id: &DocId) -> bool {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .is_some_and(|d| !d.versions.is_empty())
    }

    /// I documenti di cui lo store conserva qualcosa. Utile alle diagnostiche e
    /// (in una seconda passata) alla vista "vault al tempo T".
    pub fn documents(&self) -> Vec<DocId> {
        let inner = self.inner.lock().expect("mutex");
        inner.docs.keys().map(DocId::new).collect()
    }
}

impl Inner {
    /// La cartella del documento, creandola se serve.
    ///
    /// Il nome nasce dall'impronta del `doc_id`; se quella cartella è già di
    /// un altro documento — una collisione di impronte, improbabile ma non
    /// impossibile — si prende la successiva libera. Meglio un nome brutto che
    /// due storie mescolate.
    fn ensure_dir(&mut self, id: &DocId) -> Result<String, PluginError> {
        if let Some(doc) = self.docs.get(id.as_str()) {
            if !doc.dir.is_empty() {
                let path = self.dir.join(&doc.dir);
                std::fs::create_dir_all(&path).map_err(|e| io_err(&path, e))?;
                return Ok(doc.dir.clone());
            }
        }
        let base = format!("{:016x}", fingerprint(id.as_str()));
        for n in 0u32.. {
            let nome = if n == 0 {
                base.clone()
            } else {
                format!("{base}-{n}")
            };
            let path = self.dir.join(&nome);
            let libera = match read_meta(&path) {
                None => true,
                Some(meta) => meta.doc_id == id.as_str(),
            };
            if libera {
                std::fs::create_dir_all(&path).map_err(|e| io_err(&path, e))?;
                self.docs.entry(id.to_string()).or_default().dir = nome.clone();
                return Ok(nome);
            }
        }
        unreachable!("la sequenza dei nomi è infinita")
    }

    /// Un istante non ancora usato da questo documento: due salvataggi nello
    /// stesso millisecondo sono improbabili, ma sovrascriversi a vicenda no.
    fn free_ts(&self, id: &DocId) -> u64 {
        let usati = self.docs.get(id.as_str());
        let mut ts = now_unix_millis();
        while usati.is_some_and(|d| d.versions.iter().any(|v| v.ts == ts)) {
            ts += 1;
        }
        ts
    }

    /// Applica le fasce di ritenzione (D6) e **dice quante versioni ha buttato**:
    /// una potatura silenziosa sarebbe indistinguibile da un bug.
    fn prune(&mut self, id: &DocId) {
        let Some(doc) = self.docs.get(id.as_str()) else {
            return;
        };
        let ora = now_unix_millis();
        let mut tenute: Vec<VersionRef> = Vec::with_capacity(doc.versions.len());
        let mut fasce_viste: Vec<(u8, u64)> = Vec::new();
        // Dalla più recente: dentro ogni fascia vince la più recente.
        for (i, v) in doc.versions.iter().rev().enumerate() {
            let eta = ora.saturating_sub(v.ts);
            // La più recente non si pota mai: è la versione che rappresenta lo
            // stato attuale della nota, anche se la nota è ferma da un anno.
            let chiave = if i == 0 || eta < FASCIA_TUTTO {
                None
            } else if eta < FASCIA_ORARIA {
                Some((1, v.ts / MS_ORA))
            } else if eta < FASCIA_GIORNALIERA {
                Some((2, v.ts / MS_GIORNO))
            } else {
                continue; // oltre l'ultima fascia: non si conserva
            };
            if let Some(chiave) = chiave {
                if fasce_viste.contains(&chiave) {
                    continue;
                }
                fasce_viste.push(chiave);
            }
            tenute.push(*v);
        }
        tenute.reverse();
        if tenute.len() == doc.versions.len() {
            return;
        }

        let da_buttare: Vec<VersionRef> = doc
            .versions
            .iter()
            .filter(|v| !tenute.iter().any(|t| t.ts == v.ts))
            .copied()
            .collect();
        let dir = self.dir.join(&doc.dir);
        for v in &da_buttare {
            let path = dir.join(snapshot_name(v.ts, id.as_str()));
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("versioning: non riesco a potare {path}: {e}");
            }
        }
        eprintln!(
            "versioning: {} version{} di {id} potate dalle fasce di ritenzione",
            da_buttare.len(),
            if da_buttare.len() == 1 { "e" } else { "i" }
        );
        if let Some(doc) = self.docs.get_mut(id.as_str()) {
            doc.versions = tenute;
        }
    }

    fn write_meta(&self, id: &DocId) -> Result<(), PluginError> {
        let Some(doc) = self.docs.get(id.as_str()) else {
            return Ok(());
        };
        let meta = Meta {
            doc_id: id.to_string(),
            deleted_at: doc.deleted_at,
        };
        let path = self.dir.join(&doc.dir).join(META_FILE);
        let raw = serde_json::to_string(&meta)
            .map_err(|e| PluginError::Internal(format!("meta versioni: {e}")))?;
        std::fs::write(&path, raw).map_err(|e| io_err(&path, e))
    }

    fn write_index(&self) -> Result<(), PluginError> {
        let index = Index {
            schema_version: SCHEMA_VERSION,
            docs: self.docs.clone(),
        };
        let raw = serde_json::to_string(&index)
            .map_err(|e| PluginError::Internal(format!("indice versioni: {e}")))?;
        let path = self.dir.join(INDEX_FILE);
        std::fs::write(&path, raw).map_err(|e| io_err(&path, e))
    }
}

/// Unisce due storie sullo stesso path, in ordine di tempo.
fn merge(a: DocVersions, b: DocVersions) -> DocVersions {
    let mut versions = a.versions;
    versions.extend(b.versions);
    versions.sort_by_key(|v| v.ts);
    versions.dedup_by_key(|v| v.ts);
    DocVersions {
        dir: a.dir,
        // Il documento è vivo: è appena arrivato qui con un rename.
        deleted_at: None,
        versions,
    }
}

fn snapshot_name(ts: u64, doc_id: &str) -> String {
    match doc_id.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() && !ext.contains('/') => format!("{ts}.{ext}"),
        _ => ts.to_string(),
    }
}

/// L'indice su disco, se c'è ed è della nostra epoca.
fn load_index(dir: &Utf8Path) -> Option<BTreeMap<String, DocVersions>> {
    let raw = std::fs::read_to_string(dir.join(INDEX_FILE)).ok()?;
    let index: Index = serde_json::from_str(&raw).ok()?;
    (index.schema_version == SCHEMA_VERSION).then_some(index.docs)
}

fn read_meta(dir: &Utf8Path) -> Option<Meta> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(META_FILE)).ok()?).ok()
}

/// Ricostruisce l'indice leggendo lo store: ogni cartella dice di chi è
/// (`meta.json`), ogni file dice quando (il nome) e cosa (il contenuto).
///
/// È la direzione lecita del dubbio. Costa una lettura di tutti gli snapshot,
/// ma succede solo quando l'indice è perso — e un indice perso, senza questo,
/// renderebbe le versioni irraggiungibili per sempre.
fn rebuild_from_store(dir: &Utf8Path) -> BTreeMap<String, DocVersions> {
    let mut docs = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return docs;
    };
    for entry in entries.flatten() {
        let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        let Some(meta) = read_meta(&path) else {
            eprintln!("versioning: {path} non dice di chi è, la salto");
            continue;
        };
        let mut versions = Vec::new();
        for file in std::fs::read_dir(&path).into_iter().flatten().flatten() {
            let Ok(file) = Utf8PathBuf::from_path_buf(file.path()) else {
                continue;
            };
            let Some(stem) = file.file_stem() else { continue };
            let Ok(ts) = stem.parse::<u64>() else {
                continue; // meta.json e tutto ciò che non è uno snapshot
            };
            let Ok(source) = std::fs::read_to_string(&file) else {
                continue;
            };
            versions.push(VersionRef {
                ts,
                hash: fingerprint(&source),
                size: source.len() as u64,
            });
        }
        versions.sort_by_key(|v| v.ts);
        let nome_dir = path.file_name().unwrap_or_default().to_string();
        docs.insert(
            meta.doc_id,
            DocVersions {
                dir: nome_dir,
                deleted_at: meta.deleted_at,
                versions,
            },
        );
    }
    docs
}

/// FNV-1a: la stessa impronta stabile fra versioni di Rust e piattaforme che
/// usa l'indice di ricerca — questi valori sopravvivono su disco.
fn fingerprint(source: &str) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = OFFSET;
    for b in source.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(PRIME);
    }
    h
}

fn io_err(path: &Utf8Path, e: std::io::Error) -> PluginError {
    PluginError::Internal(format!("{path}: {e}"))
}

/// Il campionatore: un [`EventHandler`] come quelli che scriveranno i plugin.
///
/// Non scrive nel vault e non emette eventi — legge e basta — quindi non può
/// innescare il ping-pong che il budget del dispatch è lì a troncare.
pub struct VersioningHandler {
    store: VersionStore,
}

impl VersioningHandler {
    pub fn new(store: VersionStore) -> Self {
        VersioningHandler { store }
    }
}

impl EventHandler for VersioningHandler {
    fn subscribed(&self) -> EventMask {
        EventMask(vec![
            EventKind::DocumentChanged,
            EventKind::DocumentRenamed,
            EventKind::DocumentRemoved,
        ])
    }

    fn handle(&mut self, event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError> {
        match event {
            Event::DocumentChanged { id } => {
                let source = host.read_document(id)?;
                self.store.snapshot(id, &source)?;
            }
            Event::DocumentRenamed { from, to } => self.store.rename(from, to)?,
            Event::DocumentRemoved { id } => self.store.tombstone(id)?,
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("versions")).expect("utf8");
        (dir, path)
    }

    fn id(s: &str) -> DocId {
        DocId::new(s)
    }

    #[test]
    fn every_new_content_becomes_a_version() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();

        store.snapshot(&id("a.md"), "prima").unwrap();
        store.snapshot(&id("a.md"), "seconda").unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 2);
        // Dalla più recente: è l'ordine in cui si cerca ciò che si vuole
        // ripescare.
        assert_eq!(store.read(&id("a.md"), versioni[0].ts).unwrap(), "seconda");
        assert_eq!(store.read(&id("a.md"), versioni[1].ts).unwrap(), "prima");
    }

    #[test]
    fn saving_the_same_text_again_is_not_a_new_version() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();

        assert!(store.snapshot(&id("a.md"), "identica").unwrap().is_some());
        assert!(
            store.snapshot(&id("a.md"), "identica").unwrap().is_none(),
            "il dedup per contenuto è ciò che rende sostenibile uno snapshot a ogni evento"
        );
        assert_eq!(store.list(&id("a.md")).len(), 1);
    }

    #[test]
    fn a_rename_moves_the_history_with_the_note() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();
        store.snapshot(&id("vecchia.md"), "corpo").unwrap();

        store.rename(&id("vecchia.md"), &id("nuova.md")).unwrap();

        assert!(store.list(&id("vecchia.md")).is_empty());
        let versioni = store.list(&id("nuova.md"));
        assert_eq!(versioni.len(), 1);
        assert_eq!(store.read(&id("nuova.md"), versioni[0].ts).unwrap(), "corpo");
    }

    #[test]
    fn a_deletion_leaves_a_tombstone_and_the_content_stays_readable() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();
        store.snapshot(&id("a.md"), "contenuto").unwrap();

        store.tombstone(&id("a.md")).unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 1, "cancellare non cancella la storia");
        assert_eq!(store.read(&id("a.md"), versioni[0].ts).unwrap(), "contenuto");
        // E la nota che torna in vita non è più morta.
        store.snapshot(&id("a.md"), "risorta").unwrap();
        let inner = store.inner.lock().unwrap();
        assert_eq!(inner.docs["a.md"].deleted_at, None);
    }

    #[test]
    fn retention_thins_out_the_past_but_never_the_present() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();
        let ora = now_unix_millis();

        // Versioni piantate a mano in epoche diverse: due nella stessa ora di
        // tre giorni fa, due nello stesso giorno di un mese fa, una di un anno
        // fa, più una di adesso.
        {
            let mut inner = store.inner.lock().unwrap();
            let doc = inner.docs.entry("a.md".to_string()).or_default();
            doc.dir = "prova".to_string();
            for (n, eta) in [
                3 * MS_GIORNO,
                3 * MS_GIORNO + 60_000,
                30 * MS_GIORNO,
                30 * MS_GIORNO + MS_ORA,
                365 * MS_GIORNO,
            ]
            .into_iter()
            .enumerate()
            {
                doc.versions.push(VersionRef {
                    ts: ora - eta,
                    hash: n as u64,
                    size: 1,
                });
            }
            doc.versions.sort_by_key(|v| v.ts);
        }
        store.snapshot(&id("a.md"), "adesso").unwrap();

        let tenute = store.list(&id("a.md"));
        let eta: Vec<u64> = tenute.iter().map(|v| ora.saturating_sub(v.ts)).collect();
        assert_eq!(tenute.len(), 3, "tenute: {eta:?}");
        assert!(eta[0] < MS_ORA, "la più recente resta sempre");
        assert!(
            eta.iter().filter(|e| **e < FASCIA_ORARIA).count() == 2,
            "una sola versione per l'ora di tre giorni fa: {eta:?}"
        );
        assert!(
            eta.iter().all(|e| *e < FASCIA_GIORNALIERA),
            "oltre l'ultima fascia non si conserva: {eta:?}"
        );
    }

    #[test]
    fn the_index_is_rebuilt_from_the_store_never_the_other_way_round() {
        let (_g, path) = tmp();
        let ts;
        {
            let store = VersionStore::open_dir(&path).unwrap();
            store.snapshot(&id("nota/Idea.md"), "il contenuto").unwrap();
            store.tombstone(&id("nota/Idea.md")).unwrap();
            ts = store.list(&id("nota/Idea.md"))[0].ts;
        }
        // L'indice si corrompe: è stato derivato, non è la verità.
        std::fs::write(path.join(INDEX_FILE), b"non sono json").unwrap();

        let store = VersionStore::open_dir(&path).unwrap();
        let versioni = store.list(&id("nota/Idea.md"));
        assert_eq!(versioni.len(), 1, "le versioni si ritrovano dallo store");
        assert_eq!(versioni[0].ts, ts);
        assert_eq!(store.read(&id("nota/Idea.md"), ts).unwrap(), "il contenuto");
        // Anche il tombstone sopravvive: vive nella cartella, non nell'indice.
        let inner = store.inner.lock().unwrap();
        assert!(inner.docs["nota/Idea.md"].deleted_at.is_some());
    }

    #[test]
    fn asking_for_a_version_that_never_existed_says_so() {
        let (_g, path) = tmp();
        let store = VersionStore::open_dir(&path).unwrap();
        store.snapshot(&id("a.md"), "contenuto").unwrap();

        assert!(matches!(
            store.read(&id("a.md"), 1),
            Err(PluginError::BadArgs(_))
        ));
        assert!(matches!(
            store.read(&id("mai-vista.md"), 1),
            Err(PluginError::BadArgs(_))
        ));
    }
}
