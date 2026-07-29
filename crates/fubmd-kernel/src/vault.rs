//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::rules::text_policy;
use fubmd_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::time::{now_unix, stamp_from_unix};

/// La **radice unica** di ciò che FubMD scrive dentro un vault
/// ([decisione 0048](../../../docs/decisions/0048-una-radice-sola.md)).
///
/// Ciò che sta direttamente qui dentro è **autorevole** — perso, non si
/// ricostruisce da niente: il sidecar dell'organizzazione, le impostazioni del
/// vault. Ciò che sta sotto [`data_root`] è **derivato**. La classe di un dato
/// si legge dal path, ed è l'unico posto in cui oggi è scritta: finché non è
/// dicibile nel contratto (§15.4), è la profondità a dirla.
///
/// Sta dentro al vault perché ciò che riguarda un vault appartiene a quel
/// vault — copiarlo o spostarlo se lo porta dietro — ed è ignorata dalla
/// scansione: non sono documenti.
pub const FUBMD_DIR: &str = ".fubmd";

/// Il nome della cartella dei derivati dentro [`FUBMD_DIR`].
///
/// Privato di proposito: chi la vuole passa da [`data_root`], così il nome sta
/// scritto **una volta sola** e non c'è un secondo modo di comporlo.
const DATA_SUBDIR: &str = "data";

/// Il nome che la cartella dei derivati aveva **prima** della 0048, quando le
/// radici erano due. Serve solo a [`migrate_layout`]: da nessun'altra parte si
/// legge o si scrive sotto questo nome.
const LEGACY_DATA_DIR: &str = ".fubmd-data";

/// Directory ignorate durante la scansione del vault.
const IGNORED_DIRS: &[&str] = &[".obsidian", ".git", FUBMD_DIR, ".trash", "node_modules"];

/// La radice dei dati **derivati** del vault: `<root>/.fubmd/data/`. Ci vivono
/// l'indice di ricerca, l'anagrafe, i sidecar del cestino e lo spazio dati dei
/// plugin.
///
/// «Derivato» dice la disciplina, non la sorte: ciò che sta qui il kernel lo
/// butta e lo rifà quando non lo capisce, invece di rifiutarsi di sovrascriverlo.
/// Che oggi sotto questa radice ci sia anche roba che nessuno saprebbe rifare —
/// gli snapshot del versioning, il path d'origine di una voce cestinata — è il
/// difetto che il §15.4 esiste per togliere, non la definizione.
pub fn data_root(root: &Utf8Path) -> Utf8PathBuf {
    root.join(FUBMD_DIR).join(DATA_SUBDIR)
}

/// Porta un vault scritto prima della 0048 nella radice unica: `.fubmd-data/`
/// diventa `.fubmd/data/`. Torna l'avviso se c'è qualcosa da dire.
///
/// È la **prima migrazione di layout** del repo, e non assomiglia alle altre
/// tre (`organization::migrate`, `docdata::migrate`, `migrate_identity`), che
/// seguono la rinomina di un *documento*. Qui si sposta un albero, quindi la
/// disciplina è la sua:
///
/// - **è un rename, non una ricostruzione.** Sotto `.fubmd-data/` non c'è solo
///   l'indice: ci sono gli snapshot del versioning e lo stato per-documento
///   (0044), che non si rigenerano da niente. «Se non c'è, si ricostruisce»
///   qui vuol dire cancellare la memoria di com'erano i file;
/// - **è un rename e basta.** Un albero intero cambia posto con una chiamata
///   sola dentro lo stesso filesystem: non c'è una copia a metà da finire, e
///   un'interruzione lascia o il vecchio nome o il nuovo, mai due mezzi;
/// - **due nomi insieme si rifiutano**, ed è il [rifiuto in
///   avanti](../../../docs/versionamento.md) applicato a un layout invece che a
///   un numero di schema. Se esistono sia `.fubmd-data/` sia `.fubmd/data/`,
///   questa copia sta guardando un vault che qualcun altro ha già mosso: non
///   fonde, non cancella, lo dice e lavora sul nuovo. Fondere due alberi
///   significherebbe decidere quale delle due versioni di uno snapshot è
///   quella buona, e non c'è nessun dato che lo sappia;
/// - **non impedisce di aprire.** Se il rename fallisce — permessi, un handle
///   aperto altrove — il vault si apre lo stesso, derivati vuoti e avviso in
///   chiaro. Il vault è la verità; questo albero no.
pub fn migrate_layout(root: &Utf8Path) -> Option<String> {
    let legacy = root.join(LEGACY_DATA_DIR);
    if !legacy.is_dir() {
        return None;
    }
    let new = data_root(root);
    if new.exists() {
        return Some(format!(
            "{LEGACY_DATA_DIR}/ e {FUBMD_DIR}/{DATA_SUBDIR}/ esistono entrambe in {root}: \
             il vecchio albero resta dov'è e non si legge. Fonderli non si può senza \
             indovinare, e la scelta è di chi guarda i due."
        ));
    }
    if let Err(e) = std::fs::create_dir_all(root.join(FUBMD_DIR)) {
        return Some(format!("{FUBMD_DIR}/ non si crea in {root}: {e}"));
    }
    match std::fs::rename(&legacy, &new) {
        Ok(()) => None,
        Err(e) => Some(format!(
            "{legacy} non si è potuta spostare in {new}: {e}. I dati di prima — \
             indice, anagrafe, snapshot del versioning — restano dove sono e \
             questa sessione riparte da zero."
        )),
    }
}

/// Nome della cartella cestino dentro il vault.
///
/// È la stessa che usa Obsidian per "Move to Obsidian trash": un vault
/// condiviso fra le due app ha **un solo** cestino (vedi
/// `docs/PIANO.md`, "Decisioni (con il perché)", e
/// `docs/architecture/data-model.md`, "Il cestino").
pub const TRASH_DIR: &str = ".trash";

/// Cartella (dentro [`data_root`]) dei sidecar del cestino: per ogni voce
/// cestinata **da FubMD**, un `<nome-cestinato>.json` con il path d'origine.
///
/// Esiste perché il cestino è piatto (D1, interop con Obsidian) e il nome del
/// file da solo non sa dire da quale cartella veniva: senza sidecar,
/// ripristinare `progetti/Nota.md` la farebbe tornare come `Nota.md` in
/// radice — storia del versioning orfana, link per path irrisolti. Obsidian
/// non scrive sidecar: una voce senza è il degrado garbato al comportamento
/// di prima (si ripristina in radice col nome de-timbrato).
const TRASH_META_DIR: &str = "trash";

/// Il contenuto di un sidecar del cestino.
#[derive(Serialize, Deserialize)]
struct TrashSidecar {
    /// Il path (relativo al vault) da cui la voce è stata cestinata.
    original: String,
}

/// Un componente di path che il vault non deve mai guardare.
///
/// Unico punto di verità della regola: la usano sia la scansione
/// ([`Vault::scan`]) sia il percorso del watcher
/// ([`Vault::is_ignored`]). Finché viveva solo dentro la scansione, ogni file
/// spostato nel cestino tornava dentro dalla porta di servizio del watcher.
fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

/// Un file trovato dalla scansione: il path, e le due cose che il filesystem
/// dice **senza aprirlo** (§14.2).
///
/// Non è una [`VaultEntry`](fubmd_abi::traits::VaultEntry) e le manca la
/// specie, di proposito: quale sia dipende dai provider registrati, e il vault
/// non li conosce. È la stessa linea che divide `Vault` da `DocumentStore` —
/// qui ci sono i file, di là c'è cosa significano.
pub struct ScannedFile {
    pub id: DocId,
    pub size: u64,
    /// Millisecondi UNIX; `0` se il filesystem non sa dire la data (esiste:
    /// alcuni filesystem di rete). Zero non è «1970», è «non lo so», e la
    /// conseguenza è quella giusta — una data che non si conosce non combacia
    /// mai con quella di prima, quindi quel file si rilegge invece di essere
    /// dato per immutato.
    pub mtime: u64,
}

/// Cosa la camminata ha trovato: i file, **e le cartelle** (§14.3).
///
/// Le cartelle sono un elenco a parte e non si deducono dai path dei file, ed è
/// tutta la differenza fra una cartella e un prefisso: una cartella vuota non
/// compare in nessun path e c'è lo stesso. Costa zero — la camminata le
/// attraversa comunque per trovare i file.
pub struct Scan {
    pub files: Vec<ScannedFile>,
    /// Path relativi senza slash finale, in ordine. La radice non c'è: non ha
    /// un nome, non si rinomina e non si cancella.
    pub folders: Vec<String>,
}

/// L'mtime in millisecondi UNIX. Vedi
/// [`VaultEntry::mtime`](fubmd_abi::traits::VaultEntry::mtime) per il perché
/// dei millisecondi e non dei secondi né dei nanosecondi.
fn mtime_millis(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

pub struct Vault {
    root: Utf8PathBuf,
}

impl Vault {
    pub fn open(root: impl AsRef<Utf8Path>) -> Self {
        Vault {
            root: root.as_ref().to_owned(),
        }
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// [`DocId`] (path relativo al vault, separatori `/`) per un path assoluto.
    pub fn doc_id_for_path(&self, abs: &Utf8Path) -> Result<DocId> {
        let rel = abs
            .strip_prefix(&self.root)
            .map_err(|_| KernelError::OutsideVault(abs.to_owned()))?;
        Ok(DocId::new(rel.as_str().replace('\\', "/")))
    }

    /// Path assoluto per un [`DocId`].
    pub fn path_for(&self, id: &DocId) -> Utf8PathBuf {
        self.root.join(id.as_str())
    }

    /// Il path assoluto cade in una parte del vault che non va guardata?
    ///
    /// Vale per **ogni** componente, non solo per l'ultimo: un file dentro
    /// `.trash/` è invisibile quanto la cartella che lo contiene. Un path fuori
    /// dal vault non è ignorato — semplicemente non è roba nostra, e a dirlo è
    /// [`Vault::doc_id_for_path`].
    pub fn is_ignored(&self, abs: &Utf8Path) -> bool {
        let Ok(rel) = abs.strip_prefix(&self.root) else {
            return false;
        };
        rel.components().any(|c| is_ignored_name(c.as_str()))
    }

    /// **Tutto** ciò che il vault contiene, in ordine: i file con dimensione e
    /// data, e le cartelle (§14.3).
    ///
    /// Era `list_documents(&extensions)`, e la differenza è il §14.1: la
    /// scansione filtrava per estensione, quindi ciò che nessun provider
    /// rivendicava — un PNG, uno ZIP, un `.canvas` — non esisteva affatto per
    /// FubMD. Adesso il vault dice **cosa c'è**, e a dividerlo in specie è chi
    /// conosce i provider registrati
    /// ([`rules::media::kind_of`](fubmd_abi::rules::media::kind_of)): il vault
    /// non sa cosa sia un documento, e non deve saperlo per sapere cosa contiene.
    ///
    /// Dimensione e data si prendono **qui e non dopo**, ed è ciò che rende
    /// l'anagrafe gratis: la camminata ha già in mano ogni voce di directory, e
    /// una `stat` per file chiesta più tardi sarebbe un secondo giro sul disco.
    pub fn scan(&self) -> Result<Scan> {
        let mut out = Scan {
            files: Vec::new(),
            folders: Vec::new(),
        };
        self.walk(&self.root, &mut out)?;
        out.files.sort_by(|a, b| a.id.cmp(&b.id));
        out.folders.sort();
        Ok(out)
    }

    fn walk(&self, dir: &Utf8Path, out: &mut Scan) -> Result<()> {
        let entries = std::fs::read_dir(dir).map_err(|e| KernelError::Io {
            path: dir.to_owned(),
            source: e,
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| KernelError::Io {
                path: dir.to_owned(),
                source: e,
            })?;
            let path = entry.path();
            let path = Utf8PathBuf::from_path_buf(path).map_err(KernelError::NonUtf8Path)?;
            let name = path.file_name().unwrap_or_default();
            if is_ignored_name(name) {
                continue;
            }
            let file_type = entry.file_type().map_err(|e| KernelError::Io {
                path: path.clone(),
                source: e,
            })?;
            if file_type.is_dir() {
                out.folders.push(self.doc_id_for_path(&path)?.0);
                self.walk(&path, out)?;
            } else if file_type.is_file() {
                let meta = entry.metadata().map_err(|e| KernelError::Io {
                    path: path.clone(),
                    source: e,
                })?;
                out.files.push(ScannedFile {
                    id: self.doc_id_for_path(&path)?,
                    size: meta.len(),
                    mtime: mtime_millis(&meta),
                });
            }
        }
        Ok(())
    }

    /// Dimensione e data di **un** file, per chi ne sincronizza uno solo (il
    /// rilevatore). `None` = non c'è più, o non si riesce a leggerne i
    /// metadati — che per chi chiama sono la stessa cosa: non c'è niente da
    /// mettere in anagrafe.
    pub fn stat(&self, id: &DocId) -> Option<(u64, u64)> {
        let meta = std::fs::metadata(self.path_for(id)).ok()?;
        meta.is_file().then(|| (meta.len(), mtime_millis(&meta)))
    }

    /// Il testo di un documento: i byte del file, decodificati e **niente
    /// altro**.
    ///
    /// Nessun BOM tolto, nessun terminatore di riga convertito: è la sorgente
    /// nel senso in cui la intende uno [`Span`](fubmd_abi::model::Span), e
    /// riscriverla identica deve ridare il file identico (§2.4 del catalogo, e il
    /// presidio è `kernel/tests/fedelta_del_testo.rs`).
    ///
    /// Non è `read_to_string` per una ragione sola: quando i byte non sono UTF-8,
    /// `read_to_string` dice «stream did not contain valid UTF-8» e chi legge
    /// quell'errore non sa dove guardare. [`text_policy::decode`] dice **a quale
    /// byte** il file smette di essere testo, che è l'unica informazione con cui
    /// una persona lo ripara. Non si indovina un encoding: vedi il modulo.
    pub fn read(&self, id: &DocId) -> Result<String> {
        let bytes = self.read_bytes(id)?;
        match text_policy::decode(&bytes) {
            Ok(text) => Ok(text.to_string()),
            Err(at) => Err(KernelError::Io {
                path: self.path_for(id),
                source: std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "il file non è UTF-8: il primo byte non valido è a {at} \
                         (0x{:02X}), su {} byte in tutto",
                        bytes.get(at).copied().unwrap_or(0),
                        bytes.len()
                    ),
                ),
            }),
        }
    }

    /// I byte grezzi, per i provider che hanno dichiarato
    /// [`SourceKind::Bytes`](fubmd_abi::format::SourceKind::Bytes).
    ///
    /// «Leggi il file» e «decodificalo come UTF-8» erano la stessa operazione, e
    /// per un `.canvas`, un CSV con un encoding suo o un PDF la seconda metà è
    /// sbagliata — o fallisce, o corrompe. Restano due funzioni e non una che
    /// decodifica opzionalmente, perché chi legge testo non deve poter
    /// dimenticare di decodificare.
    pub fn read_bytes(&self, id: &DocId) -> Result<Vec<u8>> {
        let path = self.path_for(id);
        std::fs::read(&path).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn write(&self, id: &DocId, source: &str) -> Result<()> {
        let path = self.path_for(id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| KernelError::Io {
                path: parent.to_owned(),
                source: e,
            })?;
        }
        std::fs::write(&path, source).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn exists(&self, id: &DocId) -> bool {
        self.path_for(id).exists()
    }

    /// Sposta un documento (creando le cartelle di destinazione se mancano).
    pub fn rename(&self, from: &DocId, to: &DocId) -> Result<()> {
        let from_path = self.path_for(from);
        let to_path = self.path_for(to);
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| KernelError::Io {
                path: parent.to_owned(),
                source: e,
            })?;
        }
        std::fs::rename(&from_path, &to_path).map_err(|e| KernelError::Io {
            path: from_path,
            source: e,
        })
    }

    // --- cestino ----------------------------------------------------------

    /// Sposta un documento nel cestino del vault e restituisce il [`DocId`] che
    /// vi ha assunto.
    ///
    /// Il cestino è **piatto**, come quello di Obsidian: la cartella di
    /// provenienza non sopravvive alla cancellazione (un ripristino riporta la
    /// nota nella radice). È il prezzo di avere *un solo* cestino in un vault
    /// condiviso fra le due app — vedi D1 — e il motivo per cui il nome
    /// originale va ricavato dal nome del file, non dal suo path.
    ///
    /// Sulle collisioni non si sovrascrive e non si fallisce: il nome prende un
    /// suffisso con l'istante della cancellazione (D2), e — se anche quello è
    /// occupato, cioè due cancellazioni nello stesso secondo — un contatore.
    pub fn trash(&self, id: &DocId) -> Result<DocId> {
        let from = self.path_for(id);
        let dir = self.root.join(TRASH_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| KernelError::Io {
            path: dir.clone(),
            source: e,
        })?;

        let name = file_name_of(id.as_str());
        let stamp = stamp_from_unix(now_unix());
        let target = (0u32..)
            .map(|n| match n {
                0 => name.to_string(),
                1 => stamped_name(name, &stamp),
                _ => stamped_name(name, &format!("{stamp}-{n}")),
            })
            .map(|candidate| DocId::new(format!("{TRASH_DIR}/{candidate}")))
            .find(|candidate| !self.exists(candidate))
            .expect("la sequenza dei candidati è infinita");

        std::fs::rename(&from, self.path_for(&target)).map_err(|e| KernelError::Io {
            path: from,
            source: e,
        })?;
        // Il sidecar col path d'origine è best-effort: se non si scrive, la
        // voce degrada al comportamento senza sidecar (ripristino in radice),
        // ma la cancellazione È riuscita e va detto con un Ok.
        if let Err(e) = self.write_trash_sidecar(&target, id) {
            eprintln!("cestino: sidecar di {target} non scritto: {e}");
        }
        Ok(target)
    }

    /// La cartella dei sidecar del cestino.
    fn trash_meta_dir(&self) -> Utf8PathBuf {
        data_root(&self.root).join(TRASH_META_DIR)
    }

    /// Il path del sidecar di una voce cestinata. La chiave è il **nome** del
    /// file nel cestino: unico per costruzione (le collisioni sono già state
    /// timbrate) e ricostruibile senza stato.
    fn trash_sidecar_path(&self, trashed: &DocId) -> Utf8PathBuf {
        let name = file_name_of(trashed.as_str());
        self.trash_meta_dir().join(format!("{name}.json"))
    }

    fn write_trash_sidecar(&self, trashed: &DocId, original: &DocId) -> Result<()> {
        let dir = self.trash_meta_dir();
        std::fs::create_dir_all(&dir).map_err(|e| KernelError::Io {
            path: dir,
            source: e,
        })?;
        let path = self.trash_sidecar_path(trashed);
        let json = serde_json::to_string(&TrashSidecar {
            original: original.to_string(),
        })
        .expect("un path è sempre serializzabile");
        std::fs::write(&path, json).map_err(|e| KernelError::Io { path, source: e })
    }

    /// Il path d'origine registrato dal sidecar, se è stata FubMD a cestinare
    /// questa voce. Un sidecar assente o illeggibile non è un errore: è una
    /// voce cestinata da qualcun altro (Obsidian), o di un'altra epoca.
    fn trash_sidecar_original(&self, trashed: &DocId) -> Option<DocId> {
        let raw = std::fs::read_to_string(self.trash_sidecar_path(trashed)).ok()?;
        let sidecar: TrashSidecar = serde_json::from_str(&raw).ok()?;
        Some(DocId::new(sidecar.original))
    }

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Elenca **tutti** i file, anche quelli che nessun provider saprebbe
    /// riaprire e anche quelli dentro sottocartelle (Obsidian cestina cartelle
    /// intere): nascondere righe da una lista che l'utente sta per svuotare
    /// sarebbe il modo peggiore di essere discreti. Un ripristino impossibile
    /// lo dice quando glielo si chiede.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        let dir = self.root.join(TRASH_DIR);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        self.walk_trash(&dir, &mut out)?;
        // A parità di istante decide il nome, così l'ordine è totale e i test
        // non dipendono dall'ordine di lettura della directory.
        out.sort_by(|a, b| {
            b.deleted_at
                .cmp(&a.deleted_at)
                .then_with(|| a.id.as_str().cmp(b.id.as_str()))
        });
        Ok(out)
    }

    fn walk_trash(&self, dir: &Utf8Path, out: &mut Vec<TrashEntry>) -> Result<()> {
        let io = |path: &Utf8Path, e: std::io::Error| KernelError::Io {
            path: path.to_owned(),
            source: e,
        };
        for entry in std::fs::read_dir(dir).map_err(|e| io(dir, e))? {
            let entry = entry.map_err(|e| io(dir, e))?;
            let path =
                Utf8PathBuf::from_path_buf(entry.path()).map_err(KernelError::NonUtf8Path)?;
            let meta = entry.metadata().map_err(|e| io(&path, e))?;
            if meta.is_dir() {
                self.walk_trash(&path, out)?;
                continue;
            }
            let id = self.doc_id_for_path(&path)?;
            let name = file_name_of(id.as_str());
            out.push(TrashEntry {
                // Il sidecar sa da quale cartella veniva; senza (voce di
                // Obsidian, o di un'altra epoca) si degrada al nome
                // de-timbrato nella radice.
                original: self
                    .trash_sidecar_original(&id)
                    .unwrap_or_else(|| DocId::new(strip_stamp(name))),
                // L'mtime è l'istante dello spostamento nel cestino. Se il
                // filesystem non lo sa dire, meglio "epoca zero" che rifiutare
                // di mostrare la riga: la data è un dettaglio, la nota no.
                deleted_at: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                size: meta.len(),
                id,
            });
        }
        Ok(())
    }

    /// Cancella davvero un file, ma **solo** dentro il cestino.
    ///
    /// È l'unica cancellazione che il vault sa fare, ed è deliberato: dall'app
    /// una nota si sposta nel cestino ([`Vault::trash`]), non si distrugge.
    /// Qui il file è già stato cestinato una volta, e svuotare il cestino è
    /// l'atto con cui l'utente conferma.
    pub fn remove_trashed(&self, id: &DocId) -> Result<()> {
        let path = self.path_for(id);
        if !path.starts_with(self.root.join(TRASH_DIR)) {
            return Err(KernelError::OutsideVault(path));
        }
        std::fs::remove_file(&path).map_err(|e| KernelError::Io { path, source: e })?;
        // Il sidecar segue la voce; se resta orfano nessuno lo leggerà più
        // (la chiave è il nome della voce), quindi l'esito non cambia.
        let _ = std::fs::remove_file(self.trash_sidecar_path(id));
        Ok(())
    }

    /// Svuota il cestino e restituisce quante voci ha cancellato. Le
    /// sottocartelle rimaste vuote se ne vanno con il loro contenuto.
    pub fn empty_trash(&self) -> Result<usize> {
        let entries = self.list_trash()?;
        for entry in &entries {
            self.remove_trashed(&entry.id)?;
        }
        let dir = self.root.join(TRASH_DIR);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| KernelError::Io {
                path: dir.clone(),
                source: e,
            })?;
        }
        // Cestino vuoto = nessun sidecar da ricordare (inclusi eventuali
        // orfani lasciati da chi ha svuotato il cestino da un'altra app).
        let _ = std::fs::remove_dir_all(self.trash_meta_dir());
        Ok(entries.len())
    }
}

/// Una voce del cestino. Vive nel **contratto** dalla decisione 0013, da quando
/// `VaultRead::list_trash` la restituisce: qui resta il nome con cui il vault la
/// costruisce.
pub use fubmd_abi::traits::TrashEntry;

fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `Nota.md` + `2026-07-24T15-30-00` → `Nota.2026-07-24T15-30-00.md`.
///
/// Il suffisso va **prima** dell'estensione, non dopo: un file che finisce per
/// `.md` resta un file markdown, aperto da Obsidian come dagli altri.
fn stamped_name(name: &str, stamp: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}.{stamp}.{ext}"),
        _ => format!("{name}.{stamp}"),
    }
}

/// L'inverso di [`stamped_name`]: il nome originale di un file cestinato.
///
/// Riconosce il suffisso dalla **forma**, non da un registro: il cestino è
/// condiviso con Obsidian, che non tiene nota di nulla, e la ricostruzione deve
/// funzionare anche su file che FubMD non ha mai visto. Il prezzo è che una
/// nota davvero intitolata `Riunione.2026-07-24T15-30-00` si ripristina come
/// `Riunione` — l'utente la rinomina, e nessun dato è andato perso.
fn strip_stamp(name: &str) -> String {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return name.to_string();
    };
    // Un file senza estensione porta il timbro in coda: lì l'estensione è il
    // timbro stesso.
    if !stem.is_empty() && is_stamp(ext) {
        return stem.to_string();
    }
    match stem.rsplit_once('.') {
        Some((base, tail)) if !base.is_empty() && is_stamp(tail) => format!("{base}.{ext}"),
        _ => name.to_string(),
    }
}

/// La forma `YYYY-MM-DDTHH-MM-SS`, eventualmente seguita da `-<contatore>`
/// (due cancellazioni della stessa nota nello stesso secondo).
fn is_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 19 {
        return false;
    }
    let forma = b[..19].iter().enumerate().all(|(i, c)| match i {
        4 | 7 | 13 | 16 => *c == b'-',
        10 => *c == b'T',
        _ => c.is_ascii_digit(),
    });
    let contatore = match &b[19..] {
        [] => true,
        [b'-', cifre @ ..] => !cifre.is_empty() && cifre.iter().all(|c| c.is_ascii_digit()),
        _ => false,
    };
    forma && contatore
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trashed_name_keeps_its_extension() {
        // Il timbro sta in mezzo: il file resta un `.md`, e Obsidian lo apre.
        assert_eq!(
            stamped_name("Nota.md", "2026-07-24T15-30-00"),
            "Nota.2026-07-24T15-30-00.md"
        );
        assert_eq!(
            stamped_name("senza-estensione", "2026-07-24T15-30-00"),
            "senza-estensione.2026-07-24T15-30-00"
        );
        // Un file che è solo estensione (`.gitignore`) non ha stem da timbrare.
        assert_eq!(
            stamped_name(".env", "2026-07-24T15-30-00"),
            ".env.2026-07-24T15-30-00"
        );
    }

    #[test]
    fn the_original_name_survives_the_round_trip() {
        for nome in ["Nota.md", "Con.punti.nel.nome.md", "senza-estensione"] {
            let timbrato = stamped_name(nome, "2026-07-24T15-30-00");
            assert_eq!(strip_stamp(&timbrato), nome, "andata e ritorno di {nome}");
        }
        // Anche col contatore delle collisioni nello stesso secondo.
        assert_eq!(strip_stamp("Nota.2026-07-24T15-30-00-3.md"), "Nota.md");
    }

    #[test]
    fn a_name_that_only_looks_stamped_is_left_alone() {
        // Un file mai timbrato torna identico.
        assert_eq!(strip_stamp("Nota.md"), "Nota.md");
        // Forma sbagliata: non è un timbro, è parte del nome.
        assert_eq!(
            strip_stamp("Riunione.2026-07-24 15:30:00.md"),
            "Riunione.2026-07-24 15:30:00.md"
        );
        assert_eq!(strip_stamp("Bilancio.2026.md"), "Bilancio.2026.md");
        // Il contatore vuole cifre, non un suffisso qualsiasi.
        assert_eq!(
            strip_stamp("Nota.2026-07-24T15-30-00-bozza.md"),
            "Nota.2026-07-24T15-30-00-bozza.md"
        );
    }

    #[test]
    fn what_is_ignored_is_ignored_at_any_depth() {
        let v = Vault::open("/vault");
        assert!(!v.is_ignored("/vault/note/Idea.md".into()));
        assert!(v.is_ignored("/vault/.trash/Idea.md".into()));
        assert!(v.is_ignored("/vault/.obsidian/plugins/x/main.js".into()));
        assert!(v.is_ignored("/vault/node_modules/pacchetto/readme.md".into()));
        // Un file nascosto è nascosto anche in fondo a un path pulito.
        assert!(v.is_ignored("/vault/note/.bozza.md".into()));
        // Fuori dal vault non è "ignorato": è di qualcun altro, e a dirlo è
        // `doc_id_for_path`.
        assert!(!v.is_ignored("/altrove/.trash/Idea.md".into()));
    }
}
