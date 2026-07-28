//! Versioning del vault: snapshot per-file, tombstone, ripristino.
//!
//! È **dogfooding del contratto**, e stavolta fino in fondo: il campionatore è
//! un [`EventHandler`](fubmd_abi::traits::EventHandler) e lo store scrive
//! esclusivamente attraverso l'[`HostApi`](fubmd_abi::traits::HostApi) — niente
//! `std::fs`, niente orologio di sistema, nessuna idea di dove sia il vault.
//! Sono gli stessi strumenti che avrà un plugin di terzi a M5.
//!
//! # Cosa ha trovato il dogfooding
//!
//! Nella sua prima versione lo store scriveva `.fubmd-data/versions/` con
//! `std::fs` e leggeva l'ora da `fubmd_kernel::time`: funzionava benissimo *da
//! nativo*, e un plugin WASM con l'`HostApi` di allora non avrebbe potuto
//! scriverlo (lo `storage_get/set` è volatile e a chiave→valore, non uno store
//! di snapshot). Il buco era **nel contratto**, non nella feature; è stato
//! chiuso lì, prima del freeze di M4: `data_read/write/remove/list` per lo
//! storage persistente per-plugin, `now_unix_millis` per il tempo,
//! `list_documents` per potersi guardare intorno all'apertura del vault.
//!
//! # Perché gli eventi qui vanno bene (e all'indice no)
//!
//! Un [`Event::Overflow`] può far perdere uno *snapshot intermedio*. Per un
//! campionatore è accettabile: la versione successiva arriverà al prossimo
//! salvataggio, e nel frattempo la verità — il file sul disco — non è cambiata.
//! Un indice no: un indice che perde un aggiornamento non tace, risponde
//! sbagliato. È la ragione per cui gli indici il kernel li alimenta da sé e il
//! versioning invece passa di qui.
//!
//! Ma «perdere uno snapshot» vale solo per [`Event::DocumentChanged`]. Perdere un
//! evento **strutturale** costa altro, e la distinzione è sostanziale:
//!
//! - un [`Event::DocumentRenamed`] perso spezzerebbe la storia in due chiavi
//!   *per sempre*: [`VersionStore::rename`] non verrebbe mai chiamato, la vecchia
//!   storia resterebbe orfana su un path che non esiste più e sul nuovo path
//!   nascerebbe una seconda storia senza passato;
//! - un [`Event::DocumentRemoved`] perso lascerebbe la vista "vault al tempo T"
//!   **a mentire**: nessun tombstone, quindi una nota cancellata risulterebbe
//!   ancora viva.
//!
//! Per questo l'handler è abbonato anche a [`EventKind::Overflow`] e riconcilia:
//! `list_documents` dice chi c'è davvero, e ciò che lo store crede vivo e il
//! vault non ha più prende un tombstone. La frattura da rename perso degrada a
//! "nuova storia + tombstone della vecchia" — la cronologia si spezza, ma niente
//! mente sul presente, e il contenuto vecchio resta leggibile. Vedi
//! `docs/PIANO.md`, riga "Versioning".
//!
//! # Lo store, e chi comanda fra store e indice
//!
//! Path relativi allo spazio dati che l'host assegna al plugin
//! (`.fubmd-data/plugins/fubmd.versioning/`):
//!
//! ```text
//! versions.json                    indice: doc_id → versioni + tombstone
//! <dir>/meta.json                  { doc_id, deleted_at }
//! <dir>/<ts>.md                    il contenuto di una versione
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

use fubmd_abi::event::{Event, EventKind, EventMask, Notice};
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{EventHandler, HostApi};
use fubmd_abi::PluginError;
use serde::{Deserialize, Serialize};

/// Identità del versioning come plugin: è lo spazio dello storage persistente
/// che l'host gli concede. Lo assegna chi registra l'handler — non la feature.
pub const VERSIONING_ID: &str = "fubmd.versioning";

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
    /// Resta un numero sul confine JSON: i millisecondi non arrivano a 2⁵³ e
    /// il frontend ci fa aritmetica (`new Date(ts)`).
    pub ts: u64,
    /// Impronta del contenuto, per il dedup (D6). È un u64 **pieno** (FNV su
    /// tutti i 64 bit) che si confronta per uguaglianza: sul confine JSON
    /// viaggia come stringa, o `JSON.parse` ne perderebbe i bit oltre 2⁵³ in
    /// silenzio — la regola è in `fubmd_abi::ipc`. In lettura il numero nudo
    /// resta accettato: gli indici persistiti prima della regola non si
    /// buttano.
    #[serde(with = "fubmd_abi::ipc::u64_string")]
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
    docs: BTreeMap<String, DocVersions>,
}

/// Lo store delle versioni.
///
/// Clonabile e condiviso: una copia vive dentro il [`VersioningHandler`]
/// registrato nel workspace, l'altra resta all'app, che deve poter elencare e
/// rileggere le versioni senza passare dagli eventi. Ciò che l'app **non** ha
/// più è un canale privilegiato: anche lei passa da un `HostApi`
/// (`Workspace::with_host`), lo stesso che riceve l'handler.
#[derive(Clone)]
pub struct VersionStore {
    inner: Arc<Mutex<Inner>>,
}

impl VersionStore {
    /// Apre (o crea) lo store nello spazio dati del plugin.
    pub fn open(host: &mut dyn HostApi) -> Result<Self, PluginError> {
        let docs = match load_index(host) {
            Some(docs) => docs,
            None => {
                let ricostruito = rebuild_from_store(host)?;
                if !ricostruito.is_empty() {
                    eprintln!(
                        "versioning: indice assente o illeggibile, ricostruito dallo store \
                         ({} document{})",
                        ricostruito.len(),
                        if ricostruito.len() == 1 { "o" } else { "i" }
                    );
                }
                ricostruito
            }
        };
        Ok(VersionStore {
            inner: Arc::new(Mutex::new(Inner { docs })),
        })
    }

    /// Salva una versione, se il contenuto è diverso dall'ultima salvata.
    ///
    /// Restituisce `None` quando il dedup (D6) ha deciso che non c'era niente
    /// di nuovo: è il caso normale del salvataggio che riscrive lo stesso testo.
    pub fn snapshot(
        &self,
        id: &DocId,
        source: &str,
        host: &mut dyn HostApi,
    ) -> Result<Option<VersionRef>, PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let hash = fingerprint(source);
        let dir_doc = inner.ensure_dir(id, host)?;

        {
            let doc = inner.docs.entry(id.to_string()).or_default();
            if doc.versions.last().is_some_and(|v| v.hash == hash) {
                // Niente di nuovo da salvare — ma ci hanno chiesto di
                // fotografare una nota VIVA: se portava un tombstone
                // (cestinata e ripristinata con lo stesso identico contenuto)
                // il tombstone se ne va comunque, o "il vault al tempo T" la
                // crederebbe cancellata per sempre.
                let risorta = doc.deleted_at.take().is_some();
                if risorta {
                    inner.write_meta(id, host)?;
                    inner.write_index(host)?;
                }
                return Ok(None);
            }
        }

        let ts = inner.free_ts(id, host);
        host.data_write(
            &blob(&dir_doc, &snapshot_name(ts, id.as_str())),
            source.as_bytes(),
        )?;

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

        inner.prune(id, host);
        inner.write_meta(id, host)?;
        inner.write_index(host)?;
        Ok(Some(version))
    }

    /// Migra le versioni sul nuovo path: l'identità di un documento **è** il
    /// suo path, e un rename la sposta senza spezzare la storia.
    ///
    /// Migra anche i **contenuti**, non solo l'indice. [`VersionStore::read`]
    /// interroga due sorgenti diverse — all'indice chiede se una versione
    /// esiste, al disco cosa contiene — e l'unico modo perché non si
    /// contraddicano è che la storia unita finisca tutta sotto una cartella
    /// sola, coi nomi che `read` andrà davvero a cercare.
    pub fn rename(
        &self,
        from: &DocId,
        to: &DocId,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let Some(doc) = inner.docs.get(from.as_str()).cloned() else {
            return Ok(());
        };
        // Se il nuovo nome aveva già una storia (una nota cestinata, il cui
        // path viene rioccupato, e che si ripristina sotto un altro nome), le
        // due si uniscono in ordine di tempo: buttarne una sarebbe perdere
        // versioni senza dirlo.
        let esistente = inner.docs.get(to.as_str()).cloned();
        let trasloco = trasloca(&doc, from, esistente.as_ref(), to, host)?;
        // Da qui l'indice si muove, e si muove su contenuti già al loro posto.
        inner.docs.remove(from.as_str());
        inner.docs.insert(to.to_string(), trasloco.doc);
        inner.write_meta(to, host)?;
        inner.write_index(host)?;
        // Ultimo ciò che resta indietro: è spazio sprecato, non una bugia, e
        // non vale la pena di far fallire un rename già andato a buon fine.
        for path in trasloco.da_ripulire {
            if let Err(e) = host.data_remove(&path) {
                eprintln!("versioning: {path} è rimasto indietro e non se ne va: {e}");
            }
        }
        Ok(())
    }

    /// Segna che il documento, a questo istante, non c'è più.
    ///
    /// **Non sposta un tombstone già posato**: l'istante della morte è un fatto,
    /// e la riconciliazione dopo un `Overflow` ripassa sulle stesse chiavi. Una
    /// nota che risorge perde il tombstone in [`VersionStore::snapshot`], che è
    /// il solo posto dove può tornare viva.
    pub fn tombstone(&self, id: &DocId, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let now = host.now_unix_millis();
        let Some(doc) = inner.docs.get_mut(id.as_str()) else {
            return Ok(());
        };
        if doc.deleted_at.is_some() {
            return Ok(());
        }
        doc.deleted_at = Some(now);
        inner.write_meta(id, host)?;
        inner.write_index(host)
    }

    /// Questo documento risulta cancellato?
    pub fn is_deleted(&self, id: &DocId) -> bool {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .is_some_and(|d| d.deleted_at.is_some())
    }

    /// Le versioni di un documento, dalla più recente alla più vecchia.
    ///
    /// Non serve l'host: l'elenco è in memoria, e l'unica cosa che sta su disco
    /// è il contenuto ([`VersionStore::read`]).
    pub fn list(&self, id: &DocId) -> Vec<VersionRef> {
        let inner = self.inner.lock().expect("mutex");
        inner
            .docs
            .get(id.as_str())
            .map(|d| d.versions.iter().rev().copied().collect())
            .unwrap_or_default()
    }

    /// Il contenuto di una versione.
    pub fn read(&self, id: &DocId, ts: u64, host: &dyn HostApi) -> Result<String, PluginError> {
        let inner = self.inner.lock().expect("mutex");
        let doc = inner
            .docs
            .get(id.as_str())
            .ok_or_else(|| PluginError::BadArgs(format!("nessuna versione di {id}").into()))?;
        if !doc.versions.iter().any(|v| v.ts == ts) {
            return Err(PluginError::BadArgs(
                format!("versione {ts} di {id}: non c'è").into(),
            ));
        }
        let path = blob(&doc.dir, &snapshot_name(ts, id.as_str()));
        let bytes = host.data_read(&path)?.ok_or_else(|| {
            PluginError::Internal(format!("{path}: il contenuto è sparito").into())
        })?;
        String::from_utf8(bytes).map_err(|e| PluginError::Internal(format!("{path}: {e}").into()))
    }

    /// Questo documento ha già una storia?
    ///
    /// Serve alla **prima fotografia** del vault (vedi
    /// [`VersioningHandler`]): chi ha già una storia non paga nulla, nemmeno
    /// una lettura.
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
    /// La cartella del documento nello spazio dati del plugin.
    ///
    /// Il nome nasce dall'impronta del `doc_id`; se quella cartella è già di
    /// un altro documento — una collisione di impronte, improbabile ma non
    /// impossibile — si prende la successiva libera. Meglio un nome brutto che
    /// due storie mescolate.
    ///
    /// Non crea niente: le directory intermedie nascono alla prima scrittura,
    /// e uno store senza contenuti non deve lasciare cartelle vuote in giro.
    fn ensure_dir(&mut self, id: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
        if let Some(doc) = self.docs.get(id.as_str()) {
            if !doc.dir.is_empty() {
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
            let libera = match read_meta(&nome, host)? {
                None => true,
                Some(meta) => meta.doc_id == id.as_str(),
            };
            if libera {
                self.docs.entry(id.to_string()).or_default().dir = nome.clone();
                return Ok(nome);
            }
        }
        unreachable!("la sequenza dei nomi è infinita")
    }

    /// Un istante non ancora usato da questo documento, e **mai prima**
    /// dell'ultimo: due salvataggi nello stesso millisecondo sono improbabili,
    /// ma sovrascriversi a vicenda no — e se l'orologio torna indietro fra due
    /// salvataggi (NTP, fuso, VM), `versions` deve restare ordinato per tempo:
    /// è dato persistito, e su di esso ragionano "attuale" in `list` e la
    /// protezione della più recente in `prune`.
    fn free_ts(&self, id: &DocId, host: &dyn HostApi) -> u64 {
        let ts = host.now_unix_millis();
        let minimo = self
            .docs
            .get(id.as_str())
            .and_then(|d| d.versions.iter().map(|v| v.ts).max())
            .map_or(0, |ultimo| ultimo + 1);
        ts.max(minimo)
    }

    /// Applica le fasce di ritenzione (D6) e **dice quante versioni ha buttato**:
    /// una potatura silenziosa sarebbe indistinguibile da un bug.
    fn prune(&mut self, id: &DocId, host: &mut dyn HostApi) {
        let ora = host.now_unix_millis();
        let Some(doc) = self.docs.get(id.as_str()) else {
            return;
        };
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
        let dir = doc.dir.clone();
        for v in &da_buttare {
            let path = blob(&dir, &snapshot_name(v.ts, id.as_str()));
            if let Err(e) = host.data_remove(&path) {
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

    fn write_meta(&self, id: &DocId, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let Some(doc) = self.docs.get(id.as_str()) else {
            return Ok(());
        };
        let meta = Meta {
            doc_id: id.to_string(),
            deleted_at: doc.deleted_at,
        };
        let raw = serde_json::to_vec(&meta)
            .map_err(|e| PluginError::Internal(format!("meta versioni: {e}").into()))?;
        host.data_write(&blob(&doc.dir, META_FILE), &raw)
    }

    fn write_index(&self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let index = Index {
            schema_version: SCHEMA_VERSION,
            docs: self.docs.clone(),
        };
        let raw = serde_json::to_vec(&index)
            .map_err(|e| PluginError::Internal(format!("indice versioni: {e}").into()))?;
        host.data_write(INDEX_FILE, &raw)
    }
}

/// L'esito di un trasloco: la storia unita, e i blob rimasti indietro.
struct Trasloco {
    doc: DocVersions,
    da_ripulire: Vec<String>,
}

/// Unisce due storie sullo stesso path, in ordine di tempo, e porta i contenuti
/// dove il nuovo path li farà cercare.
///
/// Un blob non sta dove il suo `ts` dice, ma dove lo mettono **la cartella del
/// documento e l'estensione del suo path** (vedi [`blob`] e [`snapshot_name`]):
/// tenere l'indice di due storie e la cartella di una sola era il modo di
/// scrivere nell'indice versioni il cui contenuto non è mai stato lì.
///
/// Prima si **copia**, poi chi chiama scrive l'indice, e solo alla fine si
/// cancella ciò che è rimasto indietro. Se una copia fallisce, l'indice non si è
/// ancora mosso e gli originali sono tutti al loro posto; l'ordine inverso
/// lascerebbe, al primo errore, un indice che nomina contenuti spariti — cioè
/// il modo in cui il versioning fallisce senza sembrare rotto.
fn trasloca(
    doc: &DocVersions,
    from: &DocId,
    esistente: Option<&DocVersions>,
    to: &DocId,
    host: &mut dyn HostApi,
) -> Result<Trasloco, PluginError> {
    // Dove sta ogni contenuto adesso: la storia che arriva è ancora sotto la
    // sua cartella e col nome che le dava il path vecchio, quella che c'era già
    // sta sotto una cartella tutta sua.
    let mut candidate: Vec<(String, VersionRef)> = doc
        .versions
        .iter()
        .map(|v| (blob(&doc.dir, &snapshot_name(v.ts, from.as_str())), *v))
        .collect();
    if let Some(esistente) = esistente {
        candidate.extend(
            esistente
                .versions
                .iter()
                .map(|v| (blob(&esistente.dir, &snapshot_name(v.ts, to.as_str())), *v)),
        );
    }
    // Ordinamento stabile: a parità di istante la storia che arriva viene
    // prima, ed è quella che si tiene il suo `ts`.
    candidate.sort_by_key(|(_, v)| v.ts);

    // La cartella che sopravvive è quella della storia che arriva. Una sola
    // cartella per documento non è un vezzo: `rebuild_from_store` si fida di
    // `meta.json`, e due cartelle che dichiarano lo stesso `doc_id` si
    // sovrascriverebbero a vicenda, con una delle due storie persa in silenzio.
    let dir = match (doc.dir.is_empty(), esistente) {
        (true, Some(esistente)) => esistente.dir.clone(),
        _ => doc.dir.clone(),
    };
    let mut versions: Vec<VersionRef> = Vec::with_capacity(candidate.len());
    let mut destinazioni: Vec<String> = Vec::with_capacity(candidate.len());
    let mut da_ripulire: Vec<String> = Vec::new();

    for (origine, mut v) in candidate {
        match versions.last() {
            // Stesso istante e stesso contenuto: è la stessa fotografia
            // arrivata da due storie, non due versioni.
            Some(u) if u.ts == v.ts && u.hash == v.hash => {
                da_ripulire.push(origine);
                continue;
            }
            // Stesso istante ma contenuti diversi: sono due fotografie davvero
            // distinte, e `ts` è l'identità di una versione. Slitta di un
            // millisecondo — sparire in silenzio è ciò che non deve fare.
            Some(u) if v.ts <= u.ts => v.ts = u.ts + 1,
            _ => {}
        }
        let destinazione = blob(&dir, &snapshot_name(v.ts, to.as_str()));
        if destinazione != origine {
            let Some(bytes) = host.data_read(&origine)? else {
                // L'indice nominava un contenuto che non c'è più: non lo si
                // porta dietro, o continuerebbe a mentire sotto la chiave nuova.
                eprintln!(
                    "versioning: {origine} non c'è più, la versione {} esce dalla storia di {to}",
                    v.ts
                );
                continue;
            };
            host.data_write(&destinazione, &bytes)?;
            da_ripulire.push(origine);
        }
        destinazioni.push(destinazione);
        versions.push(v);
    }

    // La cartella abbandonata non deve restare a dire di chi è: un `meta.json`
    // sopravvissuto lì farebbe rinascere una seconda storia sullo stesso
    // `doc_id` la prima volta che l'indice va ricostruito.
    if let Some(esistente) = esistente {
        if esistente.dir != dir {
            da_ripulire.push(blob(&esistente.dir, META_FILE));
        }
    }
    // Un contenuto che serve ancora non si cancella, per quanto il suo vecchio
    // nome sia finito nella lista.
    da_ripulire.retain(|p| !destinazioni.contains(p));

    Ok(Trasloco {
        doc: DocVersions {
            dir,
            // Il documento è vivo: è appena arrivato qui con un rename.
            deleted_at: None,
            versions,
        },
        da_ripulire,
    })
}

/// Il nome di un blob dello store: i path dell'`HostApi` sono relativi allo
/// spazio del plugin e usano sempre `/`.
fn blob(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn snapshot_name(ts: u64, doc_id: &str) -> String {
    match doc_id.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() && !ext.contains('/') => format!("{ts}.{ext}"),
        _ => ts.to_string(),
    }
}

/// L'indice nello store, se c'è ed è della nostra epoca.
fn load_index(host: &dyn HostApi) -> Option<BTreeMap<String, DocVersions>> {
    let raw = host.data_read(INDEX_FILE).ok()??;
    let index: Index = serde_json::from_slice(&raw).ok()?;
    (index.schema_version == SCHEMA_VERSION).then_some(index.docs)
}

fn read_meta(dir: &str, host: &dyn HostApi) -> Result<Option<Meta>, PluginError> {
    let Some(raw) = host.data_read(&blob(dir, META_FILE))? else {
        return Ok(None);
    };
    Ok(serde_json::from_slice(&raw).ok())
}

/// Ricostruisce l'indice leggendo lo store: ogni cartella dice di chi è
/// (`meta.json`), ogni file dice quando (il nome) e cosa (il contenuto).
///
/// È la direzione lecita del dubbio. Costa una lettura di tutti gli snapshot,
/// ma succede solo quando l'indice è perso — e un indice perso, senza questo,
/// renderebbe le versioni irraggiungibili per sempre.
fn rebuild_from_store(host: &dyn HostApi) -> Result<BTreeMap<String, DocVersions>, PluginError> {
    // I blob sono ordinati, quindi quelli di una stessa cartella sono contigui.
    let mut per_dir: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let blobs = host.data_list("")?;
    for path in &blobs {
        // Solo il primo livello: la struttura dello store è `<dir>/<file>`, e
        // ciò che sta alla radice (l'indice) non è uno snapshot.
        if let Some((dir, name)) = path.split_once('/') {
            if !name.contains('/') {
                per_dir.entry(dir).or_default().push(name);
            }
        }
    }

    let mut docs = BTreeMap::new();
    for (dir, names) in per_dir {
        let Some(meta) = read_meta(dir, host)? else {
            eprintln!("versioning: {dir} non dice di chi è, la salto");
            continue;
        };
        let mut versions = Vec::new();
        for name in names {
            let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
            let Ok(ts) = stem.parse::<u64>() else {
                continue; // meta.json e tutto ciò che non è uno snapshot
            };
            let Some(bytes) = host.data_read(&blob(dir, name))? else {
                continue;
            };
            let Ok(source) = String::from_utf8(bytes) else {
                continue;
            };
            versions.push(VersionRef {
                ts,
                hash: fingerprint(&source),
                size: source.len() as u64,
            });
        }
        versions.sort_by_key(|v| v.ts);
        docs.insert(
            meta.doc_id,
            DocVersions {
                dir: dir.to_string(),
                deleted_at: meta.deleted_at,
                versions,
            },
        );
    }
    Ok(docs)
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

    /// Una passata sull'intero vault, e chi fotografare.
    fn sweep(&self, host: &mut dyn HostApi, chi: Passata) -> Result<(), PluginError> {
        for id in host.list_documents(None)?.items {
            if matches!(chi, Passata::SoloNuovi) && self.store.has_versions(&id) {
                continue;
            }
            // Una nota illeggibile o non salvabile non deve impedire
            // l'apertura del vault: il vault è la verità, le versioni no.
            match host.read_document(&id) {
                Ok(source) => {
                    if let Err(e) = self.store.snapshot(&id, &source, host) {
                        eprintln!("versioning: versione di {id} non salvata: {e}");
                    }
                }
                Err(e) => eprintln!("versioning: {id} non si legge: {e}"),
            }
        }
        Ok(())
    }

    /// La prima fotografia del vault, all'apertura.
    ///
    /// Gli snapshot nascono dagli eventi e l'apertura non ne emette per
    /// documento: senza questo passaggio, la prima modifica a una nota mai
    /// versionata cancellerebbe per sempre lo stato in cui l'utente l'ha
    /// trovata — l'handler gira *dopo* la scrittura e vede solo il testo nuovo.
    ///
    /// È **policy della feature**, non del wiring di chi monta: viveva in
    /// `fubmd-app::open_vault`, cioè in un posto dove un plugin non potrebbe
    /// metterla. Qui è esattamente ciò che farebbe `Plugin::activate`.
    fn first_snapshot_of_the_vault(&self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.sweep(host, Passata::SoloNuovi)
    }

    /// Riconciliazione dopo un [`Event::Overflow`]: la coda è stata troncata e
    /// non si sa *cosa* si è perso, quindi si riparte dalla verità.
    ///
    /// Due passaggi, in quest'ordine:
    ///
    /// 1. **Tombstone** per ciò che lo store crede vivo e `list_documents` non
    ///    nomina più. Chiude il `DocumentRemoved` perso, che è il caso in cui il
    ///    versioning *mentirebbe* invece di limitarsi a saperne meno.
    /// 2. **Snapshot di tutto** ciò che esiste. Il dedup per contenuto (D6) rende
    ///    gratis gli immutati; per i cambiati nasce la versione che l'evento
    ///    perso non ha prodotto, e per un rename perso nasce la nuova storia sul
    ///    nuovo path (con la vecchia che resta leggibile sotto il suo tombstone).
    ///
    /// Non si prova a *indovinare* i rename: un contenuto identico su due path
    /// può essere un rename o una copia, e una storia unita per sbaglio sarebbe
    /// peggio di una spezzata per onestà.
    fn reconcile_after_overflow(&self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let vivi: std::collections::BTreeSet<String> = host
            .list_documents(None)?
            .items
            .into_iter()
            .map(|id| id.0)
            .collect();
        let mut sepolti = 0usize;
        for id in self.store.documents() {
            if vivi.contains(id.as_str()) || self.store.is_deleted(&id) {
                continue;
            }
            match self.store.tombstone(&id, host) {
                Ok(()) => sepolti += 1,
                Err(e) => eprintln!("versioning: tombstone di {id} non scritto: {e}"),
            }
        }
        if sepolti > 0 {
            eprintln!(
                "versioning: riconciliazione dopo un overflow, {sepolti} document{} \
                 risultat{} cancellat{}",
                if sepolti == 1 { "o" } else { "i" },
                if sepolti == 1 { "o" } else { "i" },
                if sepolti == 1 { "o" } else { "i" }
            );
        }
        self.sweep(host, Passata::Tutti)
    }
}

/// Chi fotografare in una passata sull'intero vault.
enum Passata {
    /// Solo chi non ha ancora una storia (apertura del vault): chi ce l'ha non
    /// paga nemmeno una lettura.
    SoloNuovi,
    /// Tutti (riconciliazione dopo un `Overflow`): il dedup per contenuto rende
    /// gratis gli immutati, e per gli altri nasce la versione persa.
    Tutti,
}

impl EventHandler for VersioningHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::of([
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRenamed,
            EventKind::DocumentRemoved,
            // Senza questo, un troncamento della coda passerebbe inosservato e
            // il tombstone di una nota cancellata non arriverebbe mai.
            EventKind::Overflow,
        ])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        match &notice.event {
            Event::VaultOpened { .. } => self.first_snapshot_of_the_vault(host)?,
            Event::DocumentChanged { id } => {
                let source = host.read_document(id)?;
                self.store.snapshot(id, &source, host)?;
            }
            Event::DocumentRenamed { from, to } => self.store.rename(from, to, host)?,
            Event::DocumentRemoved { id } => self.store.tombstone(id, host)?,
            Event::Overflow { .. } => self.reconcile_after_overflow(host)?,
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::testing::MemoryHost;

    use super::*;
    use fubmd_abi::traits::{DataWrite, HostEnv, VaultWrite};

    fn id(s: &str) -> DocId {
        DocId::new(s)
    }

    #[test]
    fn every_new_content_becomes_a_version() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        store.snapshot(&id("a.md"), "prima", &mut host).unwrap();
        host.avanza(1_000);
        store.snapshot(&id("a.md"), "seconda", &mut host).unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 2);
        // Dalla più recente: è l'ordine in cui si cerca ciò che si vuole
        // ripescare.
        assert_eq!(
            store.read(&id("a.md"), versioni[0].ts, &host).unwrap(),
            "seconda"
        );
        assert_eq!(
            store.read(&id("a.md"), versioni[1].ts, &host).unwrap(),
            "prima"
        );
    }

    #[test]
    fn a_clock_going_backwards_does_not_disorder_the_history() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        store.snapshot(&id("a.md"), "prima", &mut host).unwrap();
        // L'orologio torna indietro fra due salvataggi (NTP, fuso, VM).
        host.arretra(60_000);
        store.snapshot(&id("a.md"), "seconda", &mut host).unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 2);
        // `versions` è dato persistito e deve restare ordinato per tempo:
        // su di esso ragionano "attuale" in `list` e la protezione della più
        // recente in `prune`.
        assert!(
            versioni[0].ts > versioni[1].ts,
            "la versione nuova deve avere ts maggiore anche a orologio arretrato: {versioni:?}"
        );
        assert_eq!(
            store.read(&id("a.md"), versioni[0].ts, &host).unwrap(),
            "seconda",
            "l'«attuale» è l'ultima salvata, non l'ultima per orologio"
        );
    }

    #[test]
    fn saving_the_same_text_again_is_not_a_new_version() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        assert!(store
            .snapshot(&id("a.md"), "identica", &mut host)
            .unwrap()
            .is_some());
        assert!(
            store
                .snapshot(&id("a.md"), "identica", &mut host)
                .unwrap()
                .is_none(),
            "il dedup per contenuto è ciò che rende sostenibile uno snapshot a ogni evento"
        );
        assert_eq!(store.list(&id("a.md")).len(), 1);
    }

    #[test]
    fn a_rename_moves_the_history_with_the_note() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("vecchia.md"), "corpo", &mut host)
            .unwrap();

        store
            .rename(&id("vecchia.md"), &id("nuova.md"), &mut host)
            .unwrap();

        assert!(store.list(&id("vecchia.md")).is_empty());
        let versioni = store.list(&id("nuova.md"));
        assert_eq!(versioni.len(), 1);
        assert_eq!(
            store.read(&id("nuova.md"), versioni[0].ts, &host).unwrap(),
            "corpo"
        );
    }

    /// Due storie che si uniscono possono portare due fotografie dello stesso
    /// millisecondo: succede tutte le volte che l'orologio non fa in tempo a
    /// muoversi fra un'operazione e l'altra.
    #[test]
    fn two_photographs_of_the_same_instant_do_not_swallow_each_other() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        // Orologio fermo: due storie diverse, lo stesso identico istante.
        store
            .snapshot(&id("a.md"), "la storia che arriva", &mut host)
            .unwrap();
        store
            .snapshot(&id("b.md"), "la storia che c'era", &mut host)
            .unwrap();

        store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

        let versioni = store.list(&id("b.md"));
        assert_eq!(
            versioni.len(),
            2,
            "contenuti diversi sono versioni diverse anche a parità di istante: {versioni:?}"
        );
        let contenuti: Vec<String> = versioni
            .iter()
            .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
            .collect();
        assert!(contenuti.contains(&"la storia che arriva".to_string()));
        assert!(contenuti.contains(&"la storia che c'era".to_string()));
    }

    /// Il nome di un blob porta l'estensione del documento: se il contenuto non
    /// segue il path, l'indice resta a nominare un `<ts>.md` che `read` andrà a
    /// cercare come `<ts>.txt`.
    #[test]
    fn a_rename_that_changes_the_extension_still_finds_the_old_contents() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("appunti.md"), "il corpo", &mut host)
            .unwrap();

        store
            .rename(&id("appunti.md"), &id("appunti.txt"), &mut host)
            .unwrap();

        let versioni = store.list(&id("appunti.txt"));
        assert_eq!(versioni.len(), 1);
        assert_eq!(
            store
                .read(&id("appunti.txt"), versioni[0].ts, &host)
                .unwrap(),
            "il corpo"
        );
    }

    /// La storia che migra su un path che ne aveva già una: è il ripristino
    /// sotto un nome nuovo, e il caso in cui le due metà dello store possono
    /// contraddirsi.
    #[test]
    fn a_history_arriving_where_another_lived_brings_its_contents_along() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        // La prima vita di Nota.md, il cestino, e il path che viene rioccupato.
        store
            .snapshot(&id("Nota.md"), "prima vita\n", &mut host)
            .unwrap();
        host.avanza(1);
        store.tombstone(&id("Nota.md"), &mut host).unwrap();
        host.avanza(1);
        store
            .snapshot(&id("Nota.md"), "usurpatrice\n", &mut host)
            .unwrap();

        // Il ripristino è una scrittura normale (D8): sul nuovo path nasce
        // *prima* una storia sua — con una cartella sua — e solo dopo arriva il
        // `DocumentRenamed` che ci porta quella vecchia.
        host.avanza(1);
        store
            .snapshot(&id("Nota 1.md"), "prima vita\n", &mut host)
            .unwrap();
        store
            .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
            .unwrap();

        // L'indice nomina tre versioni: devono essere tre contenuti leggibili.
        // Un indice che nomina un contenuto inesistente è il modo in cui il
        // versioning fallisce in modo indistinguibile dal funzionare.
        let versioni = store.list(&id("Nota 1.md"));
        assert_eq!(versioni.len(), 3, "versioni: {versioni:?}");
        let contenuti: Vec<String> = versioni
            .iter()
            .map(|v| {
                store
                    .read(&id("Nota 1.md"), v.ts, &host)
                    .unwrap_or_else(|e| panic!("versione {}: {e}", v.ts))
            })
            .collect();
        assert!(contenuti.contains(&"prima vita\n".to_string()));
        assert!(contenuti.contains(&"usurpatrice\n".to_string()));
    }

    /// Dopo un'unione la cartella abbandonata non deve restare a dire di chi
    /// era: `rebuild_from_store` si fida di `meta.json`, e due cartelle che
    /// dichiarano lo stesso `doc_id` diventano una storia sola.
    #[test]
    fn the_abandoned_folder_does_not_come_back_as_a_second_history() {
        let mut host = MemoryHost::new();
        let atteso;
        {
            let store = VersionStore::open(&mut host).unwrap();
            store
                .snapshot(&id("Nota.md"), "prima vita\n", &mut host)
                .unwrap();
            host.avanza(1);
            store
                .snapshot(&id("Nota 1.md"), "ripristinata\n", &mut host)
                .unwrap();
            store
                .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
                .unwrap();
            atteso = store.list(&id("Nota 1.md"));
            assert_eq!(atteso.len(), 2);
        }

        // L'indice si perde: si ricostruisce dallo store, che è la verità.
        host.data_write(INDEX_FILE, b"non sono json").unwrap();
        let store = VersionStore::open(&mut host).unwrap();

        assert_eq!(
            store.list(&id("Nota 1.md")).len(),
            atteso.len(),
            "la storia unita deve sopravvivere intera alla ricostruzione"
        );
        for v in &atteso {
            assert!(
                store.read(&id("Nota 1.md"), v.ts, &host).is_ok(),
                "versione {} irraggiungibile dopo la ricostruzione",
                v.ts
            );
        }
    }

    #[test]
    fn a_deletion_leaves_a_tombstone_and_the_content_stays_readable() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "contenuto", &mut host).unwrap();

        store.tombstone(&id("a.md"), &mut host).unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 1, "cancellare non cancella la storia");
        assert_eq!(
            store.read(&id("a.md"), versioni[0].ts, &host).unwrap(),
            "contenuto"
        );
        // E la nota che torna in vita non è più morta.
        host.avanza(1_000);
        store.snapshot(&id("a.md"), "risorta", &mut host).unwrap();
        let inner = store.inner.lock().unwrap();
        assert_eq!(inner.docs["a.md"].deleted_at, None);
    }

    #[test]
    fn retention_thins_out_the_past_but_never_the_present() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        // Una vita di salvataggi, con l'orologio che avanza fra l'uno e
        // l'altro: due nella stessa ora, poi un mese di distanza, poi un anno.
        for (n, salto) in [
            0,
            60_000,          // stessa ora
            27 * MS_GIORNO,  // un mese dopo
            MS_ORA,          // stesso giorno
            335 * MS_GIORNO, // un anno dopo la prima
            3 * MS_GIORNO,   // e infine "adesso"
        ]
        .into_iter()
        .enumerate()
        {
            host.avanza(salto);
            store
                .snapshot(&id("a.md"), &format!("versione {n}"), &mut host)
                .unwrap();
        }

        let ora = host.now_unix_millis();
        let tenute = store.list(&id("a.md"));
        let eta: Vec<u64> = tenute.iter().map(|v| ora.saturating_sub(v.ts)).collect();
        assert!(
            eta[0] < MS_ORA,
            "la più recente resta sempre, anche se il resto è stato potato: {eta:?}"
        );
        assert!(
            eta.iter().all(|e| *e < FASCIA_GIORNALIERA),
            "oltre l'ultima fascia non si conserva: {eta:?}"
        );
        assert!(
            tenute.len() < 6,
            "le fasce devono aver assottigliato qualcosa: {eta:?}"
        );
        // E i contenuti potati non restano a occupare spazio nello store.
        for v in &tenute {
            assert!(
                store.read(&id("a.md"), v.ts, &host).is_ok(),
                "una versione tenuta deve essere leggibile"
            );
        }
    }

    #[test]
    fn the_index_is_rebuilt_from_the_store_never_the_other_way_round() {
        let mut host = MemoryHost::new();
        let ts;
        {
            let store = VersionStore::open(&mut host).unwrap();
            store
                .snapshot(&id("nota/Idea.md"), "il contenuto", &mut host)
                .unwrap();
            store.tombstone(&id("nota/Idea.md"), &mut host).unwrap();
            ts = store.list(&id("nota/Idea.md"))[0].ts;
        }
        // L'indice si corrompe: è stato derivato, non è la verità.
        host.data_write(INDEX_FILE, b"non sono json").unwrap();

        let store = VersionStore::open(&mut host).unwrap();
        let versioni = store.list(&id("nota/Idea.md"));
        assert_eq!(versioni.len(), 1, "le versioni si ritrovano dallo store");
        assert_eq!(versioni[0].ts, ts);
        assert_eq!(
            store.read(&id("nota/Idea.md"), ts, &host).unwrap(),
            "il contenuto"
        );
        // Anche il tombstone sopravvive: vive nella cartella, non nell'indice.
        let inner = store.inner.lock().unwrap();
        assert!(inner.docs["nota/Idea.md"].deleted_at.is_some());
    }

    #[test]
    fn asking_for_a_version_that_never_existed_says_so() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "contenuto", &mut host).unwrap();

        assert!(matches!(
            store.read(&id("a.md"), 1, &host),
            Err(PluginError::BadArgs(_))
        ));
        assert!(matches!(
            store.read(&id("mai-vista.md"), 1, &host),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn the_handler_is_subscribed_to_overflow() {
        // Se non lo fosse, tutto ciò che segue non verrebbe mai chiamato: la
        // riconciliazione esisterebbe e non servirebbe a niente.
        let handler = VersioningHandler::new(VersionStore {
            inner: Arc::new(Mutex::new(Inner {
                docs: BTreeMap::new(),
            })),
        });
        assert!(handler.subscribed().contains(EventKind::Overflow));
    }

    #[test]
    fn an_overflow_turns_a_lost_removal_into_a_tombstone() {
        let mut host = MemoryHost::new().con_documento("a.md", "contenuto");
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "contenuto", &mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // La nota sparisce e il `DocumentRemoved` va perso nel troncamento.
        host.dimentica_documento("a.md");
        assert!(
            !store.is_deleted(&id("a.md")),
            "senza riconciliazione lo store crede ancora che sia viva"
        );

        host.avanza(5_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 7 }), &mut host)
            .unwrap();

        // Senza tombstone la vista "vault al tempo T" mentirebbe: direbbe che
        // quella nota c'era, e non c'era.
        assert!(store.is_deleted(&id("a.md")));
        assert_eq!(
            store.list(&id("a.md")).len(),
            1,
            "cancellare non cancella la storia"
        );
    }

    #[test]
    fn an_overflow_never_moves_the_moment_of_death() {
        let mut host = MemoryHost::new().con_documento("a.md", "contenuto");
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "contenuto", &mut host).unwrap();
        host.dimentica_documento("a.md");
        store.tombstone(&id("a.md"), &mut host).unwrap();
        let morta_alle = store.inner.lock().unwrap().docs["a.md"].deleted_at;

        host.avanza(10 * MS_GIORNO);
        let mut handler = VersioningHandler::new(store.clone());
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 1 }), &mut host)
            .unwrap();

        // L'istante della morte è un fatto: una riconciliazione che ripassa
        // sulle stesse chiavi non deve riscriverlo, o "vault al tempo T"
        // risponderebbe diversamente a ogni overflow.
        assert_eq!(
            store.inner.lock().unwrap().docs["a.md"].deleted_at,
            morta_alle
        );
    }

    #[test]
    fn an_overflow_turns_a_lost_rename_into_a_new_history_plus_a_tombstone() {
        let mut host = MemoryHost::new().con_documento("vecchia.md", "il corpo");
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("vecchia.md"), "il corpo", &mut host)
            .unwrap();
        let vecchio_ts = store.list(&id("vecchia.md"))[0].ts;
        let mut handler = VersioningHandler::new(store.clone());

        // Il rename avviene e il `DocumentRenamed` va perso: `rename` non viene
        // mai chiamato, quindi la storia NON migra.
        host.rinomina_di_nascosto("vecchia.md", "nuova.md");
        host.avanza(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 3 }), &mut host)
            .unwrap();

        // La cronologia si spezza — è il costo dell'evento perso, e non si prova
        // a indovinare i rename dal contenuto — ma niente mente sul presente:
        // il nuovo path ha una storia, il vecchio ha un tombstone, e il
        // contenuto di prima resta leggibile.
        assert!(store.is_deleted(&id("vecchia.md")));
        assert_eq!(
            store.read(&id("vecchia.md"), vecchio_ts, &host).unwrap(),
            "il corpo"
        );
        let nuove = store.list(&id("nuova.md"));
        assert_eq!(nuove.len(), 1, "sul nuovo path nasce una storia");
        assert_eq!(
            store.read(&id("nuova.md"), nuove[0].ts, &host).unwrap(),
            "il corpo"
        );
    }

    #[test]
    fn an_overflow_recovers_the_snapshot_that_the_lost_event_would_have_taken() {
        let mut host = MemoryHost::new().con_documento("a.md", "prima");
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "prima", &mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // Il contenuto cambia e il `DocumentChanged` va perso.
        host.write_document(&id("a.md"), "seconda").unwrap();
        host.avanza(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
            .unwrap();

        let versioni = store.list(&id("a.md"));
        assert_eq!(versioni.len(), 2, "versioni: {versioni:?}");
        assert_eq!(
            store.read(&id("a.md"), versioni[0].ts, &host).unwrap(),
            "seconda"
        );
        // E ripassare senza che nulla sia cambiato non gonfia la storia: il
        // dedup per contenuto è ciò che rende sostenibile una riconciliazione
        // che rilegge tutto.
        host.avanza(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
            .unwrap();
        assert_eq!(store.list(&id("a.md")).len(), 2);
    }

    #[test]
    fn opening_the_vault_photographs_what_has_no_history_yet() {
        let mut host = MemoryHost::new()
            .con_documento("a.md", "com'era")
            .con_documento("b.md", "anche questa");
        let store = VersionStore::open(&mut host).unwrap();
        // `b.md` una storia ce l'ha già: non deve guadagnare una versione
        // gemella solo perché il vault è stato riaperto.
        store
            .snapshot(&id("b.md"), "anche questa", &mut host)
            .unwrap();

        let mut handler = VersioningHandler::new(store.clone());
        handler
            .handle(
                &Notice::of(Event::VaultOpened {
                    root: "/vault".into(),
                }),
                &mut host,
            )
            .unwrap();

        assert_eq!(store.list(&id("a.md")).len(), 1, "mai vista → fotografata");
        assert_eq!(
            store.list(&id("b.md")).len(),
            1,
            "già vista → lasciata stare"
        );
        let ts = store.list(&id("a.md"))[0].ts;
        assert_eq!(store.read(&id("a.md"), ts, &host).unwrap(), "com'era");
    }
}
