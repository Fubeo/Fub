//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::{Revision, RevisionHasher};
use fub_abi::rules::path_policy::Naming;
use fub_abi::rules::{path_policy, text_policy};
use fub_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::ignore::{parse_gitignore, GitignoreRules, IgnorePolicy, Kind, GITIGNORE_FILE};
use crate::organization::ParkedOrganization;
use crate::settings::SharedSettings;
use crate::storage::{EntryKind, FileIdentity, Stat, VaultStorage};
use crate::time::{stamp_from_unix, Clock, SystemClock};
use crate::transfer::FileWitness;
use fub_abi::schema::SchemaVersion;

fn is_absent_path_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
    ) || matches!(error.raw_os_error(), Some(2 | 3 | 123))
}

/// L'impronta dei byte a `path`, letti a pezzi (vedi [`Vault::fingerprint`]).
pub(crate) fn fingerprint_of(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
) -> std::io::Result<Revision> {
    sized_fingerprint_of(storage, path).map(|(revision, _)| revision)
}

/// L'impronta e quanti byte l'hanno data.
pub(crate) fn sized_fingerprint_of(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
) -> std::io::Result<(Revision, u64)> {
    let mut hasher = RevisionHasher::new();
    let mut size = 0u64;
    storage.read_pieces(path, &mut |piece| {
        size += piece.len() as u64;
        hasher.update(piece);
    })?;
    Ok((hasher.finish(), size))
}

fn read_gitignore(storage: &dyn VaultStorage, root: &Utf8Path) -> Result<GitignoreRules> {
    let path = root.join(GITIGNORE_FILE);
    let bytes = match storage.read(&path) {
        Ok(bytes) => bytes,
        Err(source)
            if source.kind() == std::io::ErrorKind::NotFound
                || matches!(source.raw_os_error(), Some(2 | 3)) =>
        {
            return Ok(GitignoreRules::default());
        }
        Err(source) => return Err(KernelError::Io { path, source }),
    };
    match text_policy::decode(&bytes) {
        Ok(text) => Ok(parse_gitignore(text)),
        Err(at) => Err(KernelError::Io {
            path,
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

/// La **radice unica** di ciò che Fub scrive dentro un vault
/// ([decisione 0048](../../../docs/decisions/0188-identita-path-e-rename.md)).
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
pub const FUB_DIR: &str = ".fub";

/// Il nome della cartella dei derivati dentro [`FUB_DIR`].
///
/// Privato di proposito: chi la vuole passa da [`data_root`], così il nome sta
/// scritto **una volta sola** e non c'è un secondo modo di comporlo.
const DATA_SUBDIR: &str = "data";

/// La radice dei dati **derivati** del vault: `<root>/.fub/data/`. Ci vivono
/// l'indice di ricerca, l'anagrafe, i sidecar del cestino e lo spazio dati dei
/// plugin.
///
/// «Derivato» dice la disciplina, non la sorte: ciò che sta qui il kernel lo
/// butta e lo rifà quando non lo capisce, invece di rifiutarsi di sovrascriverlo.
/// Che oggi sotto questa radice ci sia anche roba che nessuno saprebbe rifare —
/// gli snapshot del versioning, il path d'origine di una voce cestinata — è il
/// difetto che il §15.4 esiste per togliere, non la definizione.
pub fn data_root(root: &Utf8Path) -> Utf8PathBuf {
    root.join(FUB_DIR).join(DATA_SUBDIR)
}

/// La radice di un vault resa **assoluta**: quella data, se già lo è, e
/// altrimenti quella data appesa alla cartella di lavoro di adesso.
///
/// Una radice relativa non è una cartella: è una cartella **più** la cartella
/// di lavoro del processo, e la cartella di lavoro nessuno l'ha promessa ferma.
/// Chi tiene una radice relativa e ci appende `.fub` o `.trash` a ogni domanda
/// — [`Vault`] lo fa a ogni `read`, `walk`, `trash` — non tiene una cartella:
/// tiene una *ricetta* per trovarne una, e dopo un `set_current_dir` la ricetta
/// dà una cartella diversa. Sarebbero due vault sotto lo stesso nome, con
/// l'indice del secondo scritto accanto ai file del primo.
///
/// **Assoluta e non canonica**, e non è la stessa operazione: canonicalizzare
/// risolve anche i link simbolici, cioè cambia la risposta a «dove sono i miei
/// file» per chi il vault ce l'ha dietro un link, e per giunta è una domanda al
/// disco — su una cartella che non c'è non ha risposta, e questa firma non può
/// fallire. Qui non serve riconoscere due nomi della stessa cartella: serve che
/// la radice non si sposti. Chi ha bisogno di una *chiave*, perché due nomi
/// devono cadere sulla stessa sessione, canonicalizza un piano più su
/// (`fub_host::Host`), dove è ancora in tempo a dire di no.
///
/// Se la cartella di lavoro non è leggibile — o non è UTF-8 — non c'è niente di
/// meglio del path dato: si tiene quello, che è ciò che si faceva sempre.
pub fn root_absolute(root: &Utf8Path) -> Utf8PathBuf {
    if root.is_absolute() {
        return root.to_owned();
    }
    std::env::current_dir()
        .ok()
        .and_then(|cwd| Utf8PathBuf::from_path_buf(cwd).ok())
        .map(|cwd| cwd.join(root))
        .unwrap_or_else(|| root.to_owned())
}

/// Nome della cartella cestino dentro il vault.
///
/// È la stessa che usa Obsidian per "Move to Obsidian trash": un vault
/// condiviso fra le due app ha **un solo** cestino (vedi
/// `../../../docs/project/status.md`, "Decisioni (con il perché)", e
/// `../../../docs/architecture/document-model.md`, "Il cestino").
pub use fub_abi::rules::trash::TRASH_DIR;
use fub_abi::rules::trash::{self, file_name_of, strip_stamp};

/// Cartella (dentro [`data_root`]) dei sidecar del cestino: per ogni voce
/// cestinata **da Fub**, un `<nome-cestinato>.json` con il path d'origine.
///
/// Esiste perché il cestino è piatto (D1, interop con Obsidian) e il nome del
/// file da solo non sa dire da quale cartella veniva: senza sidecar,
/// ripristinare `progetti/Nota.md` la farebbe tornare come `Nota.md` in
/// radice — storia del versioning orfana, link per path irrisolti. Obsidian
/// non scrive sidecar: una voce senza è il degrado garbato al comportamento
/// di prima (si ripristina in radice col nome de-timbrato).
const TRASH_METADATA_DIR: &str = "trash";

/// La versione di schema del sidecar del cestino (§15.3).
///
/// Ce l'ha anche un formato di due campi, e anche uno il cui degrado è già
/// previsto: senza un numero in testa, la versione dopo dovrebbe **indovinare**
/// che un file senza campo viene da prima — e qui indovinare male vuol dire
/// riportare la nota di qualcuno nella cartella sbagliata.
pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Quanti nomi del cestino una cestinatura prova dopo averli trovati occupati
/// soltanto al momento della mossa. Il limite non serve ai casi veri — ogni
/// rifiuto è un file che c'è — ma a un supporto che rispondesse «occupato» a
/// ogni nome: là la cestinatura si ferma con l'errore invece di girare.
const TRASH_NAME_ATTEMPTS: usize = 64;

/// Il contenuto di un sidecar del cestino.
#[derive(Serialize, Deserialize)]
struct TrashSidecar {
    /// La versione di schema di **questo** file, indipendente dalle altre.
    v: SchemaVersion,
    /// Il path (relativo al vault) da cui la voce è stata cestinata.
    original: String,
    /// **Di quale file** questo sidecar parla.
    ///
    /// La chiave di un sidecar è il nome della voce cestinata, e quel nome non
    /// è unico nel tempo: il cestino è condiviso con Obsidian (D1), che può
    /// togliere una voce senza sapere niente di `.fub/data/` e cestinarne poi
    /// un'altra che si chiama uguale. Senza questo campo il sidecar rimasto
    /// indietro viene creduto per la nuova, e la manda in una cartella che non
    /// ha mai visto — o peggio, se là c'è già una nota, il ripristino sotto un
    /// altro nome le porta via lo stato per-documento.
    ///
    /// È un `Option` e lo schema **non** è cambiato di numero: un sidecar
    /// scritto prima di questo campo non è illeggibile, è solo non verificabile,
    /// e vale quel che valeva. Bumpare la versione renderebbe carta straccia il
    /// cestino di chi aggiorna — ogni nota lì dentro tornerebbe in radice invece
    /// che nella sua cartella — per un caso che non si dà quasi mai. I sidecar
    /// senza timbro si esauriscono da soli, alla prima `empty_trash`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file: Option<TrashStamp>,
    /// **Quando** la voce è stata cestinata, in millisecondi UNIX.
    ///
    /// Sta qui perché il filesystem non lo sa. Cestinare è un `rename`, e un
    /// `rename` non tocca l'mtime del file — lo dice
    /// [`TrashStamp::mtime`] due campi più su, ed è la ragione per cui quel
    /// timbro funziona come identità. Finché la data mostrata nel cestino era
    /// `stat.mtime`, non era l'istante della cancellazione: era l'ultima volta
    /// che la nota era stata **scritta**. Una nota modificata l'ultima volta nel
    /// 2020 e cestinata oggi si presentava come cancellata nel 2020, e
    /// [`Vault::list_trash`] — che ordina «dal più recente» su quel campo —
    /// metteva in cima la nota scritta più di recente invece di quella buttata
    /// per ultima.
    ///
    /// È un `Option` e lo schema **non** cambia di numero, per la stessa
    /// ragione di [`TrashSidecar::file`]: un sidecar scritto prima di questo
    /// campo non è illeggibile, e la voce che non ce l'ha degrada esattamente a
    /// ciò che si vedeva prima. Non ce l'hanno neanche le voci cestinate da
    /// Obsidian, che sidecar non ne scrive, e per quelle l'mtime resta l'unica
    /// cosa che si sa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deleted_at: Option<u64>,
    /// **Chi ha scritto questo sidecar mette al sicuro lo stato della nota**, e
    /// questo è ciò che ha messo al sicuro dell'organizzazione (FUB-003).
    ///
    /// Il path di una nota cestinata è libero, e chi lo riprende non è lei. Per
    /// questo cestinando lo stato per-documento si sposta sotto l'identità che
    /// la voce ha nel cestino (lo spazio dei plugin, `doc~trash/`) e
    /// l'organizzazione — icona, pin, posto nell'ordine — sta qui, nel sidecar,
    /// che vive e muore con la voce.
    ///
    /// La **presenza** del campo è l'informazione: dice al ripristino che lo
    /// stato di questa voce non sta più sotto il suo path, e che quello che
    /// ci sta è di qualcun altro. Un sidecar senza è di una copia di Fub che non
    /// parcheggiava: lo stato è ancora sotto il path, e il ripristino lo tratta
    /// come prima. Per questo è un `Option` e lo schema **non** cambia di
    /// numero: lo snapshot accetta soltanto la versione esatta, e bumpare
    /// renderebbe illeggibili i sidecar di chi aggiorna.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parked: Option<ParkedOrganization>,
}

/// Il timbro di un file: ciò che il supporto sa dirne **senza aprirlo**, e che
/// basta a non confonderlo con un omonimo.
///
/// Dimensione e data insieme: la data da sola non basta (`0` vuol dire «il
/// supporto non lo sa», §14.2) e la dimensione da sola nemmeno. Sono le stesse
/// due cose che [`Vault::list_trash`] ha già in mano camminando, quindi
/// verificare costa zero letture in più.
#[derive(Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
struct TrashStamp {
    size: u64,
    /// Millisecondi UNIX, come [`crate::storage::Stat::mtime`]. Un `rename` non
    /// la tocca, quindi è la stessa da prima che la nota finisse nel cestino.
    mtime: u64,
}

/// Da dove viene una voce del cestino secondo il solo nome: quello de-timbrato,
/// nella radice. È il degrado di ogni voce senza sidecar.
fn origin_by_name(trashed: &DocId) -> DocId {
    DocId::new(strip_stamp(file_name_of(trashed.as_str())))
}

/// Da quali documenti possono venire le voci del cestino, per chi ne ricava
/// una cancellazione ([`Vault::trash_originals`]).
#[derive(Debug, Default)]
pub struct TrashOrigins {
    /// I documenti di cui il sidecar dice la cartella.
    placed: std::collections::HashSet<DocId>,
    /// I nomi delle voci di cui nessuno sa dire la cartella: quello che hanno
    /// e quello de-timbrato, perché anche il timbro si legge dalla forma.
    unplaced: std::collections::HashSet<String>,
    /// **Tutte** le voci del cestino, per id: ciò che lo spazio parcheggiato di
    /// una nota ([`fub_abi::rules::doc_data::parked_space`]) chiede per sapere se
    /// la sua voce c'è ancora.
    entries: std::collections::HashSet<DocId>,
}

impl TrashOrigins {
    /// Può darsi che questo documento sia nel cestino?
    ///
    /// Sì se un sidecar lo nomina, e sì se una voce senza sidecar si chiama
    /// come lui, **in qualunque cartella**: il cestino è piatto, e una voce di
    /// Obsidian o una che ha perso il sidecar può venire da ognuna. Tenere i
    /// dati di un omonimo è uno spazio che resta finché la voce sta nel
    /// cestino; indovinare la cartella era togliere quelli di una nota ancora
    /// recuperabile.
    pub fn may_hold(&self, doc: &DocId) -> bool {
        self.placed.contains(doc) || self.unplaced.contains(file_name_of(doc.as_str()))
    }

    /// Questa voce è ancora nel cestino?
    pub fn holds_entry(&self, trash: &DocId) -> bool {
        self.entries.contains(trash)
    }

    fn unplaced(&mut self, trashed: &DocId) {
        let name = file_name_of(trashed.as_str());
        self.unplaced.insert(strip_stamp(name));
        self.unplaced.insert(name.to_owned());
    }
}

/// Un file trovato dalla scansione: il path, e le due cose che il filesystem
/// dice **senza aprirlo** (§14.2).
///
/// Non è una [`VaultEntry`](fub_abi::traits::VaultEntry) e le manca la
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
    /// I temporanei di scrittura che nessuno sta più scrivendo, in path
    /// assoluto e in ordine (difetto 0155).
    ///
    /// Sono qui e non tolti qui perché **una lettura resta una lettura**: la
    /// camminata è il solo posto in cui questi file si vedono senza un secondo
    /// giro sul disco — li nasconde la politica di esclusione, quindi non
    /// compaiono in nessun elenco, in nessun evento e in nessuna anagrafe — ma
    /// chi decide di togliere qualcosa dal vault di qualcuno è chi ha chiesto
    /// la scansione, non chi cammina.
    pub temporary_remaining_back: Vec<Utf8PathBuf>,
    /// I compagni di lock (`.nota.md.lock`) che la camminata ha attraversato,
    /// in path assoluto e in ordine.
    ///
    /// Sono **candidati**, non residui: un lock si toglie da sé al rilascio, e
    /// uno che c'è ancora può essere tenuto adesso da un salvataggio in corso.
    /// Se è rimasto indietro lo decide il supporto, che il lock lo sa provare
    /// ([`VaultStorage::remove_abandoned_lock`]); per la stessa ragione dei
    /// temporanei li toglie chi ha chiesto la scansione.
    pub locks_remaining_back: Vec<Utf8PathBuf>,
}
/// Valutazione owned del filtro di un path del watcher.
///
/// La cattura risolve la politica corrente e clona il solo handle dello
/// storage; [`PreparedIgnoreCheck::invoke`] può così fare l'eventuale `stat`
/// discriminante dopo che il chiamante ha rilasciato il workspace.
pub struct PreparedIgnoreCheck {
    abs: Utf8PathBuf,
    rel: Option<Utf8PathBuf>,
    policy: IgnorePolicy,
    storage: Arc<dyn VaultStorage>,
}

impl PreparedIgnoreCheck {
    /// Risponde con la stessa regola di [`Vault::is_ignored`], facendo qui
    /// l'unico eventuale accesso allo storage.
    pub fn invoke(self) -> bool {
        let Some(rel) = self.rel else {
            return false;
        };
        if self.policy.excludes_path(&rel, Kind::File) {
            return true;
        }
        self.policy.excludes_path(&rel, Kind::Folder)
            && self
                .storage
                .stat(&self.abs)
                .map(|stat| stat.kind == EntryKind::Dir)
                .unwrap_or(true)
    }
}
/// Cestino preparato senza eseguire I/O.
///
/// Possiede radice, storage e id: `invoke` può scegliere atomically il nome
/// libero e spostare il file dopo che il chiamante ha rilasciato il workspace.
#[must_use = "la cestinatura preparata deve essere invocata"]
pub struct PreparedVaultTrash {
    vault: Vault,
    original: DocId,
}

/// File già spostato, ancora riconvalidabile o reversibile.
///
/// Il token conserva l'impronta dei byte mossi e l'identità filesystem quando
/// disponibile. Un commit rifiutato può restituirlo al chiamante, che esegue
/// [`rollback`](Self::rollback) senza alcun prestito del workspace.
#[must_use = "una cestinatura completata deve essere committata o annullata"]
pub struct CompletedVaultTrash {
    vault: Vault,
    original: DocId,
    trashed: DocId,
    revision: Revision,
    identity: Option<FileIdentity>,
    sidecar_fault: Option<KernelError>,
}
/// Esito detached della scelta OS. Il ramo interno conserva il token storico
/// (e quindi sidecar e rollback); quello OS non scrive nel cestino del vault.
pub enum CompletedOsTrashMove {
    Os(CompletedOsTrash),
    Internal {
        completed: CompletedVaultTrash,
        reason: crate::os_trash::FallbackReason,
        size: u64,
    },
}

pub struct CompletedOsTrash {
    vault: Vault,
    original: DocId,
    destination: Utf8PathBuf,
    revision: Revision,
    size: u64,
}

impl CompletedOsTrash {
    pub fn original(&self) -> &DocId {
        &self.original
    }

    pub fn revision(&self) -> &Revision {
        &self.revision
    }

    pub fn is_current(&self) -> bool {
        !self.vault.exists(&self.original)
            && fingerprint_of(&crate::storage::FsStorage, &self.destination)
                .is_ok_and(|revision| revision == self.revision)
    }

    /// Il vault da cui la nota è uscita: lo stato per-documento si mette al
    /// sicuro dopo la mossa, fuori da ogni custodia, con ciò che il token
    /// possiede.
    pub(crate) fn vault(&self) -> &Vault {
        &self.vault
    }

    pub fn receipt(&self) -> crate::os_trash::OsTrashReceipt {
        crate::os_trash::OsTrashReceipt {
            id: self.original.clone(),
            via: crate::os_trash::TrashVia::Os,
            dest: self.destination.clone(),
            size: self.size,
        }
    }

    pub fn rollback(self) -> Result<()> {
        if !self.is_current() {
            return Err(KernelError::Stale(self.original.to_string()));
        }
        // Dal cestino del sistema al vault passando dallo storage del vault:
        // la destinazione ha gli stessi presidi di ogni altra scrittura.
        self.vault
            .storage
            .move_in_no_replace(&self.destination, &self.vault.path_for(&self.original)?)
            .map_err(|source| KernelError::Io {
                path: self.destination,
                source,
            })
    }
}

impl CompletedOsTrashMove {
    pub fn rollback(self) -> Result<()> {
        match self {
            Self::Os(moved) => moved.rollback(),
            Self::Internal { completed, .. } => completed.rollback(),
        }
    }
}

impl PreparedVaultTrash {
    /// Sposta il file e scrive il sidecar usando soltanto stato owned.
    pub fn invoke(self) -> Result<CompletedVaultTrash> {
        let revision = self.vault.fingerprint(&self.original)?;
        let identity = self.vault.file_identity(&self.original);
        let (trashed, sidecar_fault) = self.vault.trash_now(&self.original)?;
        Ok(CompletedVaultTrash {
            vault: self.vault,
            original: self.original,
            trashed,
            revision,
            identity,
            sidecar_fault,
        })
    }

    /// Tentativo OS esplicito; se il backend lascia intatta la sorgente
    /// degrada al percorso interno *identico* alla cancellazione normale.
    pub fn invoke_os(
        self,
        backend: &dyn crate::os_trash::OsTrashBackend,
    ) -> Result<CompletedOsTrashMove> {
        use crate::os_trash::FallbackReason;

        let original = self.vault.path_for(&self.original)?;
        let (revision, size) = self.vault.read_with(&self.original, |storage, path| {
            sized_fingerprint_of(storage, path)
        })?;
        match backend.move_file_to_os_trash(&original) {
            Ok(destination) => {
                if !destination.is_absolute()
                    || destination.starts_with(self.vault.root())
                    || self.vault.exists(&self.original)
                    || fingerprint_of(&crate::storage::FsStorage, &destination)
                        .map_or(true, |moved| moved != revision)
                {
                    return Err(KernelError::Stale(format!(
                        "{} (destinazione OS: {destination})",
                        self.original
                    )));
                }
                Ok(CompletedOsTrashMove::Os(CompletedOsTrash {
                    vault: self.vault,
                    original: self.original,
                    destination,
                    revision,
                    size,
                }))
            }
            Err(error) => {
                // Anche un backend rotto che ha spostato prima di rispondere
                // Err non può far scattare una seconda mossa come fallback.
                if self
                    .vault
                    .fingerprint(&self.original)
                    .map_or(true, |current| current != revision)
                {
                    return Err(KernelError::Stale(self.original.to_string()));
                }
                let reason = if error.kind() == std::io::ErrorKind::Unsupported {
                    FallbackReason::Unsupported
                } else {
                    FallbackReason::Unavailable
                };
                Ok(CompletedOsTrashMove::Internal {
                    completed: self.invoke()?,
                    reason,
                    size,
                })
            }
        }
    }
}

impl CompletedVaultTrash {
    pub fn original(&self) -> &DocId {
        &self.original
    }

    pub fn trashed(&self) -> &DocId {
        &self.trashed
    }

    pub fn revision(&self) -> &Revision {
        &self.revision
    }

    pub fn sidecar_fault(&self) -> Option<&KernelError> {
        self.sidecar_fault.as_ref()
    }

    /// La sorgente è assente e la destinazione nomina ancora i byte mossi.
    pub fn is_current(&self) -> bool {
        if self.vault.exists(&self.original) {
            return false;
        }
        if let Some(identity) = self.identity {
            if self.vault.file_identity(&self.trashed) != Some(identity) {
                return false;
            }
        }
        self.vault
            .fingerprint(&self.trashed)
            .is_ok_and(|revision| revision == self.revision)
    }

    /// Rimette al suo posto il solo file che questo token ha spostato.
    pub fn rollback(self) -> Result<()> {
        if !self.is_current() {
            return Err(KernelError::Stale(self.trashed.to_string()));
        }
        self.vault.restore_trashed(&self.trashed, &self.original)
    }

    pub(crate) fn into_parts(self) -> (DocId, Option<KernelError>) {
        (self.trashed, self.sidecar_fault)
    }

    /// Il vault da cui la voce è uscita: lo stato per-documento si mette al
    /// sicuro dopo la mossa, fuori da ogni custodia, con ciò che il token
    /// possiede.
    pub(crate) fn vault(&self) -> &Vault {
        &self.vault
    }
}
/// Ripristino preparato senza I/O. La voce, la destinazione e la revisione
/// letta dal parser sono owned, quindi la mossa può avvenire senza custodire il
/// workspace.
#[must_use = "il ripristino preparato deve essere invocato"]
pub struct PreparedVaultRestore {
    vault: Vault,
    entry: TrashEntry,
    target: DocId,
    revision: Revision,
}

/// File già uscito dal cestino, con tutto ciò che serve per committarlo,
/// annullarlo una volta sola oppure finalizzarlo.
#[must_use = "un ripristino completato deve essere finalizzato o annullato"]
pub struct CompletedVaultRestore {
    vault: Vault,
    entry: TrashEntry,
    target: DocId,
    revision: Revision,
    stat: Stat,
    identity: Option<FileIdentity>,
    sidecar: Option<Vec<u8>>,
    /// Cosa la voce aveva messo al sicuro dell'organizzazione, **se** chi l'ha
    /// cestinata metteva al sicuro lo stato (`None`: una voce di prima, o di
    /// un'altra applicazione, o con un sidecar che non si comprende).
    parked: Option<ParkedOrganization>,
}

impl PreparedVaultRestore {
    /// Riconvalida la fotografia esatta del cestino e i byte letti dal parser,
    /// poi esegue l'unica mossa autorevole senza rimuovere il sidecar.
    pub fn invoke(self) -> Result<CompletedVaultRestore> {
        let PreparedVaultRestore {
            vault,
            entry,
            target,
            revision,
        } = self;
        let current = vault
            .list_trash()?
            .into_iter()
            .find(|candidate| candidate.id == entry.id)
            .ok_or_else(|| KernelError::NotFound(entry.id.to_string()))?;
        if current != entry {
            return Err(KernelError::Stale(entry.id.to_string()));
        }

        let source = vault.path_for(&entry.id)?;
        let stat_before = vault
            .storage
            .stat(&source)
            .map_err(|source_error| KernelError::Io {
                path: source.clone(),
                source: source_error,
            })?;
        if !stat_before.is_file() {
            return Err(KernelError::Stale(entry.id.to_string()));
        }
        let identity_before = vault
            .storage
            .file_identity(&source)
            .map_err(|source_error| KernelError::Io {
                path: source.clone(),
                source: source_error,
            })?;
        let fingerprint =
            fingerprint_of(vault.storage.as_ref(), &source).map_err(|source_error| {
                KernelError::Io {
                    path: source.clone(),
                    source: source_error,
                }
            })?;
        let stat_after = vault
            .storage
            .stat(&source)
            .map_err(|source_error| KernelError::Io {
                path: source.clone(),
                source: source_error,
            })?;
        let identity_after = vault
            .storage
            .file_identity(&source)
            .map_err(|source_error| KernelError::Io {
                path: source.clone(),
                source: source_error,
            })?;
        if stat_before != stat_after || identity_before != identity_after || fingerprint != revision
        {
            return Err(KernelError::Stale(entry.id.to_string()));
        }
        let sidecar = vault.read_raw_trash_sidecar(&entry.id)?;
        // Con le stesse verifiche di `list_trash`: un sidecar di un altro file o
        // di una versione che non si conosce vale come un sidecar che non c'è.
        let parked = vault
            .read_trash_sidecar(&entry.id, &stat_after)?
            .and_then(|sidecar| sidecar.parked);
        vault.rename_no_replace(&entry.id, &target)?;
        Ok(CompletedVaultRestore {
            vault,
            entry,
            target,
            revision,
            stat: stat_after,
            identity: identity_after,
            sidecar,
            parked,
        })
    }
}

impl CompletedVaultRestore {
    pub fn entry(&self) -> &TrashEntry {
        &self.entry
    }

    pub fn target(&self) -> &DocId {
        &self.target
    }

    pub fn revision(&self) -> &Revision {
        &self.revision
    }

    pub fn stat(&self) -> Stat {
        self.stat
    }

    pub fn identity(&self) -> Option<FileIdentity> {
        self.identity
    }

    /// L'organizzazione che la nota si era portata via cestinata, se la voce era
    /// di chi metteva al sicuro lo stato: `None` vuol dire una voce di prima,
    /// il cui stato sta ancora sotto il path d'origine.
    pub fn parked_organization(&self) -> Option<&ParkedOrganization> {
        self.parked.as_ref()
    }

    /// Rimette nel cestino soltanto il file ancora identico a quello mosso e
    /// soltanto se anche il sidecar è rimasto byte per byte invariato.
    pub fn rollback(self) -> Result<()> {
        let source = self.vault.path_for(&self.target)?;
        let current_stat =
            self.vault
                .storage
                .stat(&source)
                .map_err(|source_error| KernelError::Io {
                    path: source.clone(),
                    source: source_error,
                })?;
        let current_identity =
            self.vault
                .storage
                .file_identity(&source)
                .map_err(|source_error| KernelError::Io {
                    path: source.clone(),
                    source: source_error,
                })?;
        let current_revision =
            fingerprint_of(self.vault.storage.as_ref(), &source).map_err(|source_error| {
                KernelError::Io {
                    path: source.clone(),
                    source: source_error,
                }
            })?;
        if self.vault.exists(&self.entry.id)
            || current_stat != self.stat
            || current_identity != self.identity
            || current_revision != self.revision
            || self.vault.read_raw_trash_sidecar(&self.entry.id)? != self.sidecar
        {
            return Err(KernelError::Stale(self.target.to_string()));
        }
        self.vault.rename_no_replace(&self.target, &self.entry.id)
    }

    /// Il file è ormai committato: il sidecar derivato può essere rimosso senza
    /// cambiare l'esito autorevole del ripristino.
    pub fn finalize(self) {
        let _ = self
            .vault
            .storage
            .remove(&self.vault.trash_sidecar_path(&self.entry.id));
    }
}

/// Sweep distruttivo del cestino preparato senza eseguire I/O.
///
/// Possiede la fotografia del vault — radice e handle dello storage inclusi —
/// così il censimento e le rimozioni possono avvenire dopo che il chiamante ha
/// rilasciato la custodia del [`Workspace`](crate::Workspace).
pub struct PreparedTrashSweep {
    vault: Vault,
}

impl PreparedTrashSweep {
    /// Esegue l'algoritmo completo di [`Vault::empty_trash`] sul vault catturato.
    pub fn invoke(self) -> Result<usize> {
        self.vault.empty_trash()
    }
}

#[derive(Clone)]
pub struct Vault {
    root: Utf8PathBuf,
    /// Il supporto (§15.1). È un `Arc` e non un campo per valore perché lo
    /// spazio dati dei plugin ci passa sopra dal lato del `Workspace`: il vault
    /// e i blob dei plugin stanno **nella stessa cartella**, e due supporti
    /// diversi per la stessa cartella sarebbero due idee di cosa c'è dentro —
    /// il giorno in cui uno dei due cifra, un dato su due resta in chiaro.
    storage: Arc<dyn VaultStorage>,
    /// Le impostazioni di **questo** vault, da cui si legge la politica di
    /// esclusione (§15.6). `None` è un vault che non ne ha — un banco, un
    /// kernel montato senza il bundle del core — e vale il default della
    /// politica, cioè il comportamento di prima che fosse dichiarabile.
    settings: Option<SharedSettings>,
    gitignore: GitignoreRules,
    /// L'orologio con cui il cestino timbra nomi e sidecar.
    clock: Arc<dyn Clock>,
}

impl Vault {
    /// Un vault sul filesystem, che è il caso di ogni chiamante di produzione.
    ///
    /// Fallisce **all'ingresso** — prima di qualunque scansione, evento o
    /// interfaccia — se la radice non esiste, non è una cartella o non si ha
    /// permesso di scriverci (0160).
    pub fn open(root: impl AsRef<Utf8Path>) -> Result<Self> {
        let root = root_absolute(root.as_ref());
        let storage = crate::storage::RootedFsStorage::open(&root).map_err(|source| {
            KernelError::InvalidRoot {
                path: root.clone(),
                source,
            }
        })?;
        Vault::on(root, Arc::new(storage))
    }

    /// Un vault su un supporto qualunque (§15.1).
    ///
    /// **La radice si fissa qui**, e da qui in poi non è più quella che il
    /// chiamante ha scritto: è la sua forma assoluta ([`root_absolute`]).
    /// Questa è la sola riga che la costruisce, quindi non esiste un `Vault` la
    /// cui radice si sposti sotto ai piedi.
    ///
    /// È anche la sola riga che **verifica la radice**, e la verifica adesso:
    /// chiede al supporto se può starci un vault ([`VaultStorage::root_validates`])
    /// e risponde con [`KernelError::InvalidRoot`] se non può. Un errore più
    /// tardi — alla prima operazione che tocca il disco — sarebbe un vault già
    /// mostrato come aperto, con eventi già emessi (0160).
    pub fn on(root: impl AsRef<Utf8Path>, storage: Arc<dyn VaultStorage>) -> Result<Self> {
        let root = root_absolute(root.as_ref());
        storage
            .mount_fence(&root)
            .map_err(|source| KernelError::InvalidRoot {
                path: root.clone(),
                source,
            })?;
        let gitignore = read_gitignore(storage.as_ref(), &root)?;
        Ok(Vault {
            root,
            storage,
            clock: Arc::new(SystemClock),
            settings: None,
            gitignore,
        })
    }

    /// L'orologio del vault, al posto di quello di sistema.
    pub(crate) fn set_clock(&mut self, clock: Arc<dyn Clock>) {
        self.clock = clock;
    }

    /// L'istante di adesso secondo l'orologio di questo vault, quello che un
    /// banco può iniettare: chi confronta un istante con le date dei file del
    /// vault (la regola *racily clean*) lo prende da qui, non dal sistema.
    pub(crate) fn now_unix_millis(&self) -> u64 {
        self.clock.now_unix_millis()
    }

    /// Aggancia le impostazioni da cui leggere la politica di esclusione.
    ///
    /// Builder e non parametro di [`on`](Vault::on) per la ragione di
    /// [`Workspace::with_view_states`](crate::Workspace::with_view_states): il
    /// default è quello che serve a un banco, e chi monta un vault vero lo
    /// sostituisce in una riga. Le impostazioni sono **condivise** e non
    /// copiate — è la stessa `Arc` del workspace — perché la politica si legge
    /// a ogni domanda e non al montaggio.
    pub(crate) fn watching(mut self, settings: SharedSettings) -> Self {
        self.settings = Some(settings);
        self
    }

    /// La politica di esclusione che vale **adesso** per questo vault (§15.6).
    pub(crate) fn ignore_policy(&self) -> IgnorePolicy {
        crate::ignore::resolve(self.settings.as_ref()).with_gitignore(self.gitignore.clone())
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Il supporto su cui vive, per chi scrive **dentro lo stesso vault** senza
    /// passare per un [`DocId`] — lo spazio dati dei plugin, i sidecar.
    pub fn storage(&self) -> &Arc<dyn VaultStorage> {
        &self.storage
    }

    /// [`DocId`] (path relativo al vault, separatori `/`) per un path assoluto.
    pub fn doc_id_for_path(&self, abs: &Utf8Path) -> Result<DocId> {
        let rel = abs
            .strip_prefix(&self.root)
            .map_err(|_| KernelError::OutsideVault(abs.to_owned()))?;
        Ok(DocId::new(rel.as_str().replace('\\', "/")))
    }

    /// Path assoluto per un [`DocId`], **se quel `DocId` nomina un posto dentro
    /// il vault**.
    ///
    /// È l'unico punto in cui questo vault compone un path assoluto, ed è per
    /// questo che il recinto sta qui e non nei chiamanti: chiedere a ognuno di
    /// validare prima di comporre è una disciplina che il tredicesimo sito
    /// dimentica, e il tredicesimo sito è quello che scrive fuori. Il giudizio è
    /// del contratto ([`path_policy::fenced`]) e non di questa funzione.
    ///
    /// Il recinto è quello **esterno** e non
    /// [`check`](path_policy::check): un `DocId` che nomina lo spazio macchina
    /// non è un documento, ma il vault ci lavora di mestiere — il cestino è
    /// `.trash/`, i sidecar stanno sotto `.fub/`. Chi riceve un id **da fuori**
    /// gli fa l'altra domanda al varco ([`valid_doc_id`], [`fenced_doc_id`]), e
    /// le due si sommano invece di sostituirsi.
    ///
    /// [`valid_doc_id`]: crate::workspace::valid_doc_id
    /// [`fenced_doc_id`]: fub_abi::rules::path_policy::fenced_doc_id
    pub fn path_for(&self, id: &DocId) -> Result<Utf8PathBuf> {
        path_policy::fenced(id.as_str()).map_err(|why| KernelError::BadName {
            name: id.to_string(),
            why: why.to_string(),
        })?;
        Ok(self.root.join(id.as_str()))
    }

    /// Cattura una valutazione owned del filtro senza interrogare lo storage.
    ///
    /// Risolvere la politica sotto il proprietario conserva l'istante della
    /// decisione; l'eventuale distinzione file/cartella resta invece a
    /// [`PreparedIgnoreCheck::invoke`], fuori dalla guardia del workspace.
    pub fn prepare_is_ignored(&self, abs: &Utf8Path) -> PreparedIgnoreCheck {
        PreparedIgnoreCheck {
            abs: abs.to_owned(),
            rel: abs.strip_prefix(&self.root).ok().map(Utf8Path::to_owned),
            policy: self.ignore_policy(),
            storage: Arc::clone(&self.storage),
        }
    }

    /// Il path assoluto cade in una parte del vault che non va guardata?
    ///
    /// Vale per **ogni** componente, non solo per l'ultimo: un file dentro
    /// `.trash/` è invisibile quanto la cartella che lo contiene. Un path fuori
    /// dal vault non è ignorato — semplicemente non è roba nostra, e a dirlo è
    /// [`Vault::doc_id_for_path`].
    ///
    /// È la **stessa politica** che usa la scansione, ed è il punto: finché la
    /// regola viveva solo dentro la scansione, ogni file spostato nel cestino
    /// tornava dentro dalla porta di servizio del watcher.
    pub fn is_ignored(&self, abs: &Utf8Path) -> bool {
        self.prepare_is_ignored(abs).invoke()
    }

    /// **Tutto** ciò che il vault contiene, in ordine: i file con dimensione e
    /// data, e le cartelle (§14.3).
    ///
    /// Era `list_documents(&extensions)`, e la differenza è il §14.1: la
    /// scansione filtrava per estensione, quindi ciò che nessun provider
    /// rivendicava — un PNG, uno ZIP, un `.canvas` — non esisteva affatto per
    /// Fub. Adesso il vault dice **cosa c'è**, e a dividerlo in specie è chi
    /// conosce i provider registrati
    /// ([`rules::media::kind_of`](fub_abi::rules::media::kind_of)): il vault
    /// non sa cosa sia un documento, e non deve saperlo per sapere cosa contiene.
    ///
    /// Dimensione e data si prendono **qui e non dopo**, ed è ciò che rende
    /// l'anagrafe gratis: la camminata ha già in mano ogni voce di directory, e
    /// una `stat` per file chiesta più tardi sarebbe un secondo giro sul disco.
    pub fn scan(&self) -> Result<Scan> {
        let mut out = Scan {
            files: Vec::new(),
            folders: Vec::new(),
            temporary_remaining_back: Vec::new(),
            locks_remaining_back: Vec::new(),
        };
        // La politica si risolve **una volta per scansione** e non per voce di
        // directory: leggerla è prendere un lock e costruire un elenco, e una
        // camminata su diecimila file lo farebbe diecimila volte per una
        // risposta che non cambia in mezzo. Che valga per tutta la camminata è
        // anche più giusto che comodo: una scansione mezza con una politica e
        // mezza con un'altra non è un elenco di niente.
        let policy = crate::ignore::resolve(self.settings.as_ref())
            .with_gitignore(read_gitignore(self.storage.as_ref(), &self.root)?);
        self.walk(&self.root, &policy, &mut out)?;
        out.files.sort_by(|a, b| a.id.cmp(&b.id));
        out.folders.sort();
        out.temporary_remaining_back.sort();
        out.locks_remaining_back.sort();
        Ok(out)
    }

    /// La camminata di [`scan`](Self::scan) dentro **una** cartella del vault.
    ///
    /// Serve a chi ha visto cambiare una cartella intera, e non i file che
    /// contiene: una cartella spostata dentro, rinominata o portata via arriva
    /// dal rilevatore come un path solo. Stessa politica di esclusione e
    /// stesse specie della scansione intera. La radice, un path fuori dal
    /// vault, un file, un collegamento o una cartella che non c'è più non
    /// camminano niente: rispondono una scansione vuota. Anche un supporto che
    /// non sa distinguere un collegamento da una cartella non cammina: la
    /// scansione intera non segue i collegamenti, e questa non li deve seguire
    /// per ipotesi.
    pub fn scan_within(&self, dir: &Utf8Path) -> Result<Scan> {
        let mut out = Scan {
            files: Vec::new(),
            folders: Vec::new(),
            temporary_remaining_back: Vec::new(),
            locks_remaining_back: Vec::new(),
        };
        let Ok(rel) = dir.strip_prefix(&self.root) else {
            return Ok(out);
        };
        if rel.as_str().is_empty() {
            return Ok(out);
        }
        match self.storage.stat_no_follow(dir) {
            Ok(stat) if stat.kind == EntryKind::Dir => {}
            Ok(_) => return Ok(out),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound
                        | std::io::ErrorKind::NotADirectory
                        | std::io::ErrorKind::Unsupported
                ) =>
            {
                return Ok(out)
            }
            Err(source) => {
                return Err(KernelError::Io {
                    path: dir.to_owned(),
                    source,
                })
            }
        }
        let policy = crate::ignore::resolve(self.settings.as_ref())
            .with_gitignore(read_gitignore(self.storage.as_ref(), &self.root)?);
        if policy.excludes_path(rel, Kind::Folder) {
            return Ok(out);
        }
        self.walk(dir, &policy, &mut out)?;
        out.files.sort_by(|a, b| a.id.cmp(&b.id));
        out.folders.sort();
        out.temporary_remaining_back.sort();
        out.locks_remaining_back.sort();
        Ok(out)
    }

    /// I compagni di lock (`.settings.json.lock`) che stanno nella cartella di
    /// servizio [`FUB_DIR`], in path assoluto e in ordine.
    ///
    /// La scansione non entra in `.fub/`, e deve restare così: lì non c'è
    /// contenuto dell'utente. Ma il supporto del vault ci prende i suoi lock
    /// come accanto a una nota — le impostazioni, l'anagrafe, le bozze, i
    /// sidecar del cestino, lo stato per documento dei plugin — e un'uscita
    /// forzata in mezzo a una di quelle scritture ne lascia uno a terra, come
    /// le versioni di Fub che il lock non lo toglievano. Questa camminata cerca
    /// **solo** quei nomi: non produce voci, non legge la politica di
    /// esclusione e non segue i collegamenti. Sono candidati, come
    /// [`Scan::locks_remaining_back`]: se uno è rimasto indietro lo decide
    /// [`VaultStorage::remove_abandoned_lock`].
    ///
    /// Lo spazio di un plugin (`.fub/plugins/<id>/`) si cammina soltanto negli
    /// spazi per documento ([`DOC_SPACE`](fub_abi::rules::doc_data::DOC_SPACE) e
    /// [`PARKED_SPACE`](fub_abi::rules::doc_data::PARKED_SPACE)), che scrive e
    /// sposta il kernel. Il resto può essere la cartella vera che
    /// `Workspace::plugin_data_dir` consegna a un motore nativo, con un
    /// protocollo di lock suo: l'indice di ricerca (tantivy) vi tiene
    /// `.tantivy-writer.lock` e `.tantivy-meta.lock`, che hanno la stessa forma,
    /// sono stabili per costruzione e non si provano nemmeno — prenderne uno
    /// per un istante farebbe fallire l'apertura del suo writer.
    pub fn service_locks(&self) -> Result<Vec<Utf8PathBuf>> {
        let mut out = Vec::new();
        self.walk_service_locks(&self.root.join(FUB_DIR), &mut out)?;
        out.sort();
        Ok(out)
    }

    fn walk_service_locks(&self, dir: &Utf8Path, out: &mut Vec<Utf8PathBuf>) -> Result<()> {
        let entries = match self.storage.list(dir) {
            Ok(entries) => entries,
            // Un vault appena creato non ha ancora `.fub/`, e uno spazio di
            // plugin non ha per forza gli spazi per documento.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(source) => {
                return Err(KernelError::Io {
                    path: dir.to_owned(),
                    source,
                })
            }
        };
        let plugin_spaces = self
            .root
            .join(FUB_DIR)
            .join(crate::documents::PLUGIN_DATA_DIR);
        for entry in entries {
            match entry.stat.kind {
                EntryKind::Dir if dir == plugin_spaces => {
                    for space in [
                        fub_abi::rules::doc_data::DOC_SPACE,
                        fub_abi::rules::doc_data::PARKED_SPACE,
                    ] {
                        let space = entry.path.join(space);
                        // `list` segue un collegamento: lo spazio si cammina
                        // solo se è una cartella vera.
                        if self
                            .storage
                            .stat_no_follow(&space)
                            .is_ok_and(|stat| stat.kind == EntryKind::Dir)
                        {
                            self.walk_service_locks(&space, out)?;
                        }
                    }
                }
                EntryKind::Dir => self.walk_service_locks(&entry.path, out)?,
                EntryKind::File
                    if entry
                        .path
                        .file_name()
                        .is_some_and(crate::storage::is_write_lock) =>
                {
                    out.push(entry.path);
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn walk(&self, dir: &Utf8Path, policy: &IgnorePolicy, out: &mut Scan) -> Result<()> {
        let entries = self.storage.list(dir).map_err(|and| KernelError::Io {
            path: dir.to_owned(),
            source: and,
        })?;
        for entry in entries {
            let name = entry.path.file_name().unwrap_or_default();
            // La specie qui è già in mano: la porta la voce di directory, e
            // l'elenco delle cartelle escluse parla di cartelle (difetto 0176).
            let kind = match entry.stat.kind {
                EntryKind::Dir => Kind::Folder,
                _ => Kind::File,
            };
            let rel = entry
                .path
                .strip_prefix(&self.root)
                .expect("a walked entry stays below the vault root");
            if policy.excludes_path(rel, kind) {
                // Un temporaneo di scrittura è escluso, ed è la §15.6: quel
                // file esiste per una frazione di secondo e chi guarda il vault
                // in quella frazione non lo deve vedere. Ma un crash fra la
                // creazione e la rename ne lascia uno per terra **per sempre**,
                // e da lì in poi la stessa riga che lo nascondeva lo rende
                // invisibile anche a chi potrebbe toglierlo: la camminata è il
                // solo posto da cui si vede (difetto 0155).
                if kind == Kind::File
                    && crate::storage::is_write_temporary(name)
                    && self.storage.is_left_behind(&entry.stat)
                {
                    out.temporary_remaining_back.push(entry.path.clone());
                }
                // Lo stesso per un compagno di lock che un'uscita forzata ha
                // lasciato a terra: la politica lo nasconde, e la camminata è
                // il solo posto da cui si vede.
                if kind == Kind::File && crate::storage::is_write_lock(name) {
                    out.locks_remaining_back.push(entry.path.clone());
                }
                continue;
            }
            match entry.stat.kind {
                EntryKind::Dir => {
                    out.folders.push(self.doc_id_for_path(&entry.path)?.0);
                    self.walk(&entry.path, policy, out)?;
                }
                EntryKind::File => out.files.push(ScannedFile {
                    id: self.doc_id_for_path(&entry.path)?,
                    size: entry.stat.size,
                    mtime: entry.stat.mtime,
                }),
                // Un collegamento non partecipa, e dalla §15.6 è una
                // **politica** invece che un effetto: il modulo `ignore` scrive
                // perché non è un interruttore, e il presidio che lo tiene è
                // `un_anello_di_collegamenti_non_ferma_la_scansione` — seguirli
                // senza saper riconoscere un nodo già visto è una camminata che
                // non torna.
                EntryKind::Other => {}
            }
        }
        Ok(())
    }

    /// Dimensione e data di **un** file, per chi ne sincronizza uno solo (il
    /// rilevatore). `None` = non c'è più, o non si riesce a leggerne i
    /// metadati — che per chi chiama sono la stessa cosa: non c'è niente da
    /// mettere in anagrafe. Un id fuori dal recinto risponde `None` per la
    /// stessa ragione: non c'è nessun file di cui parlare.
    pub fn stat(&self, id: &DocId) -> Option<(u64, u64)> {
        let stat = self.storage.stat(&self.path_for(id).ok()?).ok()?;
        stat.is_file().then_some((stat.size, stat.mtime))
    }

    /// Identità filesystem della voce, se il backend la conosce. Un errore o un
    /// backend senza identità diventano `None`: il chiamante deve rinunciare a
    /// inferire una rinomina, mai inventarne una.
    pub fn file_identity(&self, id: &DocId) -> Option<FileIdentity> {
        let path = self.path_for(id).ok()?;
        self.storage.file_identity(&path).ok().flatten()
    }

    /// Timbro di cambiamento e identità della voce in una domanda sola
    /// ([`VaultStorage::witness`]). Un errore, o un id fuori dal recinto, è
    /// un testimone di cui non si conosce niente: chi lo confronta con uno
    /// noto vede un file cambiato.
    pub fn witness(&self, id: &DocId) -> crate::storage::FileWitness {
        self.path_for(id)
            .ok()
            .and_then(|path| self.storage.witness(&path).ok())
            .unwrap_or_default()
    }

    /// Timbro opaco di cambiamento del file, se il backend lo conosce.
    ///
    /// Non identifica il file e non partecipa al rejoin: serve soltanto a
    /// invalidare una voce dell'anagrafe quando size e mtime sono rimasti
    /// uguali ma il filesystem sa che il file è stato comunque toccato.
    pub fn change_stamp(&self, id: &DocId) -> Option<u64> {
        let path = self.path_for(id).ok()?;
        self.storage.change_stamp(&path).ok().flatten()
    }

    /// Il testo di un documento: i byte del file, decodificati e **niente
    /// altro**.
    ///
    /// Nessun BOM tolto, nessun terminatore di riga convertito: è la sorgente
    /// nel senso in cui la intende uno [`Span`](fub_abi::model::Span), e
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
                path: self.path_for(id)?,
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
    /// [`SourceKind::Bytes`](fub_abi::format::SourceKind::Bytes).
    ///
    /// «Leggi il file» e «decodificalo come UTF-8» erano la stessa operazione, e
    /// per un `.canvas`, un CSV con un encoding suo o un PDF la seconda metà è
    /// sbagliata — o fallisce, o corrompe. Restano due funzioni e non una che
    /// decodifica opzionalmente, perché chi legge testo non deve poter
    /// dimenticare di decodificare.
    pub fn read_bytes(&self, id: &DocId) -> Result<Vec<u8>> {
        self.read_with(id, |storage, path| storage.read(path))
    }

    /// L'impronta dei byte di `id`, presa leggendo il file a pezzi: la stessa
    /// [`Revision::of_bytes`] di ciò che [`read_bytes`](Vault::read_bytes)
    /// renderebbe, senza tenerlo intero in memoria.
    ///
    /// È la lettura di chi vuole soltanto sapere **se** un file è cambiato. Un
    /// allegato di qualche GB, letto intero per prenderne l'impronta, era
    /// un'allocazione di qualche GB all'apertura del vault — una per thread
    /// dell'indicizzazione — e a ogni cestinata o rinomina.
    pub fn fingerprint(&self, id: &DocId) -> Result<Revision> {
        self.read_with(id, |storage, path| fingerprint_of(storage, path))
    }

    fn read_with<T>(
        &self,
        id: &DocId,
        read: impl FnOnce(&dyn VaultStorage, &Utf8Path) -> std::io::Result<T>,
    ) -> Result<T> {
        let path = self.path_for(id)?;
        // Windows può restituire `InvalidInput` per un nome illegale che
        // semplicemente non esiste (`?`, `*`, newline). Prima di tentare la
        // lettura, chiediamo al supporto se il file c'è davvero: un importato
        // esistente resta leggibile, mentre un path assente prende la faccia
        // contrattuale `NotFound` senza trasformare l'assenza in I/O.
        if path_policy::check(id.as_str(), Naming::New).is_err() {
            if let Err(and) = self.storage.stat(&path) {
                if is_absent_path_error(&and) {
                    return Err(KernelError::NotFound(id.to_string()));
                }
            }
        }
        read(self.storage.as_ref(), &path).map_err(|and| {
            if path_policy::check(id.as_str(), Naming::New).is_err() && is_absent_path_error(&and) {
                KernelError::NotFound(id.to_string())
            } else {
                KernelError::Io { path, source: and }
            }
        })
    }

    /// Scrive il sorgente, e rende **dimensione e data di ciò che ha scritto**.
    ///
    /// Le due cose tornano da qui e non da una [`stat`](Vault::stat) fatta dopo,
    /// per la ragione scritta su [`VaultStorage::write`]: chiedere di nuovo al
    /// disco vuol dire chiedere di un file che nel frattempo può essere un
    /// altro, o nessuno (difetto 0179).
    pub fn write(&self, id: &DocId, source: &str) -> Result<(u64, u64)> {
        let path = self.path_for(id)?;
        self.storage
            .write(&path, source.as_bytes())
            .map(|stat| (stat.size, stat.mtime))
            .map_err(|and| KernelError::Io { path, source: and })
    }

    /// Come [`write`](Vault::write), ma posa i byte soltanto se il contenuto
    /// letto dal chiamante è ancora quello corrente. `Ok(None)` è un conflitto,
    /// non un errore del supporto.
    pub fn write_if_unchanged(
        &self,
        id: &DocId,
        expected: &str,
        source: &str,
    ) -> Result<Option<(u64, u64)>> {
        let path = self.path_for(id)?;
        match self
            .storage
            .write_if_unchanged(&path, Some(expected.as_bytes()), source.as_bytes())
            .map_err(|and| KernelError::Io {
                path: path.clone(),
                source: and,
            })? {
            crate::storage::ConditionalWrite::Written(stat) => Ok(Some((stat.size, stat.mtime))),
            crate::storage::ConditionalWrite::Changed => Ok(None),
        }
    }

    /// Come [`write_if_unchanged`](Vault::write_if_unchanged) con «assente»
    /// come contenuto atteso: posa i byte soltanto se al path non c'è ancora
    /// niente. `Ok(None)` vuol dire che nel frattempo qualcuno l'ha creato, e
    /// quel file resta intatto.
    pub fn write_if_absent(&self, id: &DocId, source: &str) -> Result<Option<(u64, u64)>> {
        let path = self.path_for(id)?;
        match self
            .storage
            .write_if_unchanged(&path, None, source.as_bytes())
            .map_err(|and| KernelError::Io {
                path: path.clone(),
                source: and,
            })? {
            crate::storage::ConditionalWrite::Written(stat) => Ok(Some((stat.size, stat.mtime))),
            crate::storage::ConditionalWrite::Changed => Ok(None),
        }
    }

    /// Un id fuori dal recinto **non esiste**, e non è una tolleranza: non
    /// nomina un posto di questo vault, quindi non c'è niente che possa
    /// esistere.
    pub fn exists(&self, id: &DocId) -> bool {
        self.path_for(id)
            .is_ok_and(|path| self.storage.exists(&path))
    }

    /// Questi due id nominano **lo stesso file**?
    ///
    /// La domanda che una guardia «la destinazione è occupata?» deve fare prima
    /// di credere a [`exists`](Vault::exists): dove il supporto non distingue il
    /// caso, `nota.md` e `Nota.md` sono un file solo, e la destinazione occupata
    /// **è la sorgente**. La risposta è del supporto e non di questo modulo —
    /// vedi [`VaultStorage::same_file`] — perché è il supporto l'unico a saperlo.
    ///
    /// Un id fuori dal recinto non nomina nessun posto di questo vault, quindi
    /// non è lo stesso file di niente: è la stessa risposta di
    /// [`exists`](Vault::exists), letta dall'altro lato.
    pub fn same_file(&self, a: &DocId, b: &DocId) -> bool {
        match (self.path_for(a), self.path_for(b)) {
            (Ok(a), Ok(b)) => self.storage.same_file(&a, &b),
            _ => false,
        }
    }

    /// Sposta un documento (creando le cartelle di destinazione se mancano).
    pub fn rename(&self, from: &DocId, to: &DocId) -> Result<()> {
        let from_path = self.path_for(from)?;
        let to_path = self.path_for(to)?;
        self.storage
            .rename(&from_path, &to_path)
            .map_err(|and| KernelError::Io {
                path: from_path,
                source: and,
            })
    }

    /// Crea una cartella vuota, con le cartelle mancanti sopra di lei.
    ///
    /// Una voce già presente in quel punto è
    /// [`KernelError::AlreadyExists`], non un successo: il chiamante sceglieva
    /// un nome e deve sapere che era occupato.
    pub fn create_folder(&self, folder: &str) -> Result<()> {
        let path = self.path_for(&DocId::new(folder))?;
        match self.storage.create_dir(&path) {
            Ok(()) => Ok(()),
            Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(KernelError::AlreadyExists(folder.to_string()))
            }
            Err(and) => Err(KernelError::Io { path, source: and }),
        }
    }

    /// Sposta un documento soltanto se nessuno ha occupato la destinazione.
    pub fn rename_no_replace(&self, from: &DocId, to: &DocId) -> Result<()> {
        let from_path = self.path_for(from)?;
        let to_path = self.path_for(to)?;
        match self.storage.rename_no_replace(&from_path, &to_path) {
            Ok(()) => Ok(()),
            Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(KernelError::AlreadyExists(to.to_string()))
            }
            Err(and) => Err(KernelError::Io {
                path: from_path,
                source: and,
            }),
        }
    }

    // --- cestino ----------------------------------------------------------

    /// Prepara una cestinatura owned senza interrogare lo storage.
    pub fn prepare_trash(&self, id: &DocId) -> Result<PreparedVaultTrash> {
        self.path_for(id)?;
        Ok(PreparedVaultTrash {
            vault: self.clone(),
            original: id.clone(),
        })
    }

    /// Cattura una mossa di ripristino senza interrogare il supporto.
    pub fn prepare_restore(
        &self,
        entry: TrashEntry,
        target: DocId,
        revision: Revision,
    ) -> Result<PreparedVaultRestore> {
        let source = self.path_for(&entry.id)?;
        if !source.starts_with(self.root.join(TRASH_DIR)) {
            return Err(KernelError::OutsideVault(source));
        }
        self.path_for(&target)?;
        Ok(PreparedVaultRestore {
            vault: self.clone(),
            entry,
            target,
            revision,
        })
    }

    /// Sposta un documento nel cestino conservando la porta sincrona storica.
    pub fn trash(&self, id: &DocId) -> Result<(DocId, Option<KernelError>)> {
        Ok(self.prepare_trash(id)?.invoke()?.into_parts())
    }

    fn trash_now(&self, id: &DocId) -> Result<(DocId, Option<KernelError>)> {
        let from = self.path_for(id)?;
        // La cartella del cestino non si crea qui: `VaultStorage::rename` crea
        // le cartelle di destinazione che mancano, e farlo una seconda volta
        // vorrebbe dire avere due idee di quando una cartella esiste.
        let stamp = stamp_from_unix(self.clock.now_unix_millis() / 1_000);
        // Il nome nel cestino non se lo costruisce chi cestina: è una regola
        // del contratto, e chi cestina è più di uno (0219).
        //
        // Il nome si **prova** con una mossa no-replace, non si deduce: un
        // `exists` seguito da `rename` lasciava fra le due una finestra in cui
        // chi posava un file — o una voce già cestinata che la `stat` non
        // sapeva vedere — veniva sostituito, cioè perso per sempre. `exists`
        // resta soltanto il modo di non provare i nomi che si sanno occupati.
        let mut refused: Vec<String> = Vec::new();
        let target = loop {
            let candidate = DocId::new(trash::trashed_id(id.as_str(), &stamp, &mut |c| {
                refused.iter().any(|taken| taken == c) || self.exists(&DocId::new(c))
            }));
            match self
                .storage
                .rename_no_replace(&from, &self.path_for(&candidate)?)
            {
                Ok(()) => break candidate,
                Err(and)
                    if and.kind() == std::io::ErrorKind::AlreadyExists
                        && refused.len() < TRASH_NAME_ATTEMPTS =>
                {
                    refused.push(candidate.to_string());
                }
                Err(and) => {
                    return Err(KernelError::Io {
                        path: from,
                        source: and,
                    })
                }
            }
        };
        let Err(fault) = self.write_trash_sidecar(&target, id) else {
            return Ok((target, None));
        };
        // **Il sidecar fa parte della cancellazione quando il nome non basta.**
        // Senza sidecar la voce vale quel che dice il suo nome: una nota della
        // radice torna al suo posto, una di `Diario/` no — la cartella era
        // scritta soltanto lì, e la voce che resta finirebbe ripristinata nella
        // radice, con i dati per-documento intestati a un path che nessuno
        // ricorda più. Lì la nota torna dov'era e la cancellazione fallisce.
        //
        // Se nemmeno il ritorno riesce la nota è nel cestino, e lo si dice
        // come una cancellazione riuscita col guasto accanto: la raccolta
        // tiene i dati di ogni omonimo di una voce senza sidecar
        // ([`Vault::trash_originals`]), e il ripristino resta possibile.
        if origin_by_name(&target) != *id
            && self
                .storage
                .rename_no_replace(&self.path_for(&target)?, &from)
                .is_ok()
        {
            return Err(fault);
        }
        // Il guasto non è silenzioso: lo si restituisce invece di scriverlo
        // su stderr, e `delete_document` — che ha il workspace fra le mani —
        // lo porta nel canale e nel log.
        Ok((target, Some(fault)))
    }

    /// La cartella dei sidecar del cestino.
    fn trash_metadata_dir(&self) -> Utf8PathBuf {
        data_root(&self.root).join(TRASH_METADATA_DIR)
    }

    /// Il path del sidecar di una voce cestinata. La chiave è il **nome** del
    /// file nel cestino: unico per costruzione (le collisioni sono già state
    /// timbrate) e ricostruibile senza stato.
    fn trash_sidecar_path(&self, trashed: &DocId) -> Utf8PathBuf {
        let name = file_name_of(trashed.as_str());
        self.trash_metadata_dir().join(format!("{name}.json"))
    }

    fn write_trash_sidecar(&self, trashed: &DocId, original: &DocId) -> Result<()> {
        let path = self.trash_sidecar_path(trashed);
        let json = serde_json::to_string(&TrashSidecar {
            v: SCHEMA_VERSION,
            original: original.to_string(),
            // Il timbro del file **appena** spostato: è l'unica cosa che lega
            // questo sidecar a quella voce e non al prossimo omonimo. Se il
            // supporto non sa dirlo, il sidecar resta senza — vale quel che
            // valeva prima che il timbro esistesse, che è più di niente.
            file: self
                .storage
                .stat(&self.path_for(trashed)?)
                .ok()
                .map(|s| TrashStamp {
                    size: s.size,
                    mtime: s.mtime,
                }),
            // L'orologio si legge **qui**, dove la cancellazione avviene, e non
            // si deduce dal disco più tardi: il `rename` che ha appena spostato
            // il file non ha lasciato nessuna traccia dell'istante in cui è
            // successo (vedi [`TrashSidecar::deleted_at`]).
            deleted_at: Some(self.clock.now_unix_millis()),
            // Chi cestina mette al sicuro lo stato della nota: l'organizzazione
            // la aggiunge subito dopo ([`Vault::park_organization`]), ma il
            // marcatore c'è da subito, anche se il passo dopo non riesce.
            parked: Some(ParkedOrganization::default()),
        })
        .expect("a path is always serializable");
        self.storage
            .write(&path, json.as_bytes())
            .map(|_| ())
            .map_err(|and| KernelError::Io { path, source: and })
    }

    /// Aggiunge al sidecar di una voce l'organizzazione che la nota si è portata
    /// via ([`ParkedOrganization`]).
    ///
    /// Un sidecar che non c'è o che non si capisce **non si inventa**: chi
    /// parcheggia lascia allora l'organizzazione dov'è, e la nota la ritrova
    /// sotto il suo path come prima.
    pub fn park_organization(
        &self,
        trashed: &DocId,
        organization: ParkedOrganization,
    ) -> Result<()> {
        let path = self.trash_sidecar_path(trashed);
        let io = |source| KernelError::Io {
            path: path.clone(),
            source,
        };
        let raw = self.storage.read(&path).map_err(io)?;
        let mut sidecar: TrashSidecar = serde_json::from_slice(&raw).map_err(|and| {
            io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                and.to_string(),
            ))
        })?;
        if sidecar.v != SCHEMA_VERSION {
            return Err(io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("sidecar del cestino in versione {}", sidecar.v),
            )));
        }
        sidecar.parked = Some(organization);
        let json = serde_json::to_string(&sidecar).expect("a sidecar is always serializable");
        self.storage
            .write(&path, json.as_bytes())
            .map(|_| ())
            .map_err(io)
    }

    fn read_raw_trash_sidecar(&self, trashed: &DocId) -> Result<Option<Vec<u8>>> {
        let path = self.trash_sidecar_path(trashed);
        crate::error::optional(self.storage.read(&path))
            .map_err(|source| KernelError::Io { path, source })
    }

    /// Ciò che questo vault sa di una voce cestinata, se è stata Fub a
    /// cestinarla. Un sidecar assente o che non si comprende non è un errore:
    /// è una voce cestinata da qualcun altro (Obsidian), o di un'altra epoca.
    /// **Un sidecar che il supporto non sa leggere invece lo è**, e risale:
    /// degradarlo al nome nella radice era indovinare, e il ripristino ci
    /// rimetteva la nota fuori dalla sua cartella, lasciando i suoi dati
    /// per-documento a un path che non c'era più. Vale anche per chi cancella:
    /// scambierebbe un censimento incompleto per un cestino vuoto.
    ///
    /// Torna il sidecar **intero** e non un campo solo perché le domande che
    /// gli si fanno sono due — da dove veniva la voce, e quando è stata
    /// cestinata — e la lettura, la versione e il timbro sono gli stessi per
    /// tutte e due: chi chiede la seconda eredita le tre verifiche invece di
    /// ripeterle, e non c'è modo di crederne una e non l'altra.
    ///
    /// **Una versione che non si conosce vale come un sidecar che non c'è**, e
    /// qui il rifiuto in avanti è muto invece che rumoroso come nelle
    /// impostazioni o nel registro dei vault (§15.3). La differenza non è la
    /// pigrizia: è che lì tacere farebbe **perdere** ciò che l'utente aveva
    /// scritto, mentre qui il degrado è già la risposta prevista del formato —
    /// la nota torna comunque, in radice col nome de-timbrato, che è
    /// esattamente ciò che succede per ogni voce cestinata da Obsidian. Dirlo
    /// costerebbe un campo su `TrashEntry`, cioè sul contratto, per un caso che
    /// si dà solo aprendo il vault con una copia di Fub più vecchia di quella
    /// che l'ha cestinata; se un giorno il sidecar porterà qualcosa che il
    /// degrado non sa rifare, quel campo sarà da scrivere.
    fn read_trash_sidecar(&self, trashed: &DocId, stat: &Stat) -> Result<Option<TrashSidecar>> {
        let path = self.trash_sidecar_path(trashed);
        let raw = match crate::error::optional(self.storage.read(&path)).map_err(|source| {
            KernelError::Io {
                path: path.clone(),
                source,
            }
        })? {
            Some(raw) => raw,
            None => return Ok(None),
        };
        let sidecar = match serde_json::from_slice::<TrashSidecar>(&raw) {
            Ok(sidecar) => sidecar,
            Err(_) => return Ok(None),
        };
        if sidecar.v != SCHEMA_VERSION {
            return Ok(None);
        }
        // **Un sidecar che parla di un altro file vale come un sidecar che non
        // c'è**: stessa regola della versione che non si conosce, e stesso
        // degrado. Chi non porta il timbro non lo può smentire e resta creduto
        // (vedi [`TrashSidecar::file`]).
        let stamp = TrashStamp {
            size: stat.size,
            mtime: stat.mtime,
        };
        if sidecar.file.is_some_and(|f| f != stamp) {
            return Ok(None);
        }
        Ok(Some(sidecar))
    }

    /// C'è una cartella del cestino? Soltanto un «non c'è» del supporto vale
    /// «no»: una `stat` che fallisce non dice che il cestino è vuoto, e chi
    /// lo prendesse per vuoto — l'elenco, e la raccolta che ci conta per
    /// sapere quali note sono ancora recuperabili — perderebbe le note
    /// cestinate e i loro dati.
    fn has_trash(&self, dir: &Utf8Path) -> Result<bool> {
        crate::error::optional(self.storage.stat(dir))
            .map(|stat| stat.is_some())
            .map_err(|source| KernelError::Io {
                path: dir.to_owned(),
                source,
            })
    }

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Elenca **tutti** i file utente, anche quelli che nessun provider saprebbe
    /// riaprire e anche quelli dentro sottocartelle (Obsidian cestina cartelle
    /// intere): nascondere righe da una lista che l'utente sta per svuotare
    /// sarebbe il modo peggiore di essere discreti. Un ripristino impossibile
    /// lo dice quando glielo si chiede.
    /// I compagni di lock dello storage non sono voci utente e restano sul
    /// filesystem per conservare l'identità del protocollo.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        let dir = self.root.join(TRASH_DIR);
        if !self.has_trash(&dir)? {
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

    /// I file del cestino, con i loro metadati: la camminata che l'elenco e
    /// la raccolta condividono.
    fn trash_files(&self, dir: &Utf8Path, out: &mut Vec<(DocId, Stat)>) -> Result<()> {
        let entries = self.storage.list(dir).map_err(|and| KernelError::Io {
            path: dir.to_owned(),
            source: and,
        })?;
        for entry in entries {
            if entry.stat.is_dir() {
                self.trash_files(&entry.path, out)?;
                continue;
            }
            if entry
                .path
                .file_name()
                .is_some_and(crate::storage::is_write_lock)
            {
                continue;
            }
            out.push((self.doc_id_for_path(&entry.path)?, entry.stat));
        }
        Ok(())
    }

    fn walk_trash(&self, dir: &Utf8Path, out: &mut Vec<TrashEntry>) -> Result<()> {
        let mut files = Vec::new();
        self.trash_files(dir, &mut files)?;
        for (id, stat) in files {
            let sidecar = self.read_trash_sidecar(&id, &stat)?;
            out.push(TrashEntry {
                // Il sidecar sa da quale cartella veniva; senza (voce di
                // Obsidian, o di un'altra epoca) si degrada al nome
                // de-timbrato nella radice.
                original: sidecar
                    .as_ref()
                    .map(|s| DocId::new(s.original.clone()))
                    .unwrap_or_else(|| origin_by_name(&id)),
                // La data la dichiara **chi ha cestinato**, e sta nel sidecar:
                // il `rename` con cui una nota entra nel cestino non tocca il
                // suo mtime, quindi il disco di quell'istante non sa niente.
                // Senza sidecar — una voce di Obsidian, o di prima che il campo
                // esistesse — resta l'mtime, che è l'ultima scrittura della
                // nota: non è la cancellazione, ma è tutto ciò che si sa, e una
                // riga senza data sarebbe peggio di una riga con una data
                // vecchia. Se nemmeno l'mtime il supporto lo sa dire, meglio
                // "epoca zero" che rifiutare di mostrare la riga: la data è un
                // dettaglio, la nota no. Il contratto porta i secondi e le due
                // sorgenti i millisecondi (§14.2): la divisione sta qui, dove le
                // unità si incontrano.
                deleted_at: sidecar
                    .as_ref()
                    .and_then(|s| s.deleted_at)
                    .unwrap_or(stat.mtime)
                    / 1000,
                size: stat.size,
                id,
            });
        }
        Ok(())
    }

    /// Da quali documenti vengono le voci del cestino, per chi ne ricava una
    /// cancellazione: la raccolta degli spazi per-documento.
    ///
    /// [`list_trash`](Self::list_trash) degrada un sidecar che non sa leggere
    /// al nome de-timbrato nella radice, e per mostrare una riga va bene. Qui
    /// no: una nota di `Diario/` con il sidecar illeggibile risultava
    /// `Idea.md`, e la raccolta toglieva i dati di `Diario/Idea.md` mentre la
    /// nota era ancora recuperabile. Un guasto del supporto e un sidecar
    /// presente ma non compreso — rotto, o scritto da una versione più nuova —
    /// risalgono. Degrada al nome soltanto un sidecar che non c'è (una voce di
    /// Obsidian) o che parla di un altro file, cioè di una voce che non c'è più.
    ///
    /// E «degrada» non vuol dire «indovina la radice»: la voce senza sidecar
    /// non sa da quale cartella veniva, e la risposta è il suo **nome**, che
    /// vale per ogni cartella ([`TrashOrigins::may_hold`]).
    pub fn trash_originals(&self) -> Result<TrashOrigins> {
        let dir = self.root.join(TRASH_DIR);
        let mut out = TrashOrigins::default();
        if !self.has_trash(&dir)? {
            return Ok(out);
        }
        let mut files = Vec::new();
        self.trash_files(&dir, &mut files)?;
        for (id, stat) in files {
            out.entries.insert(id.clone());
            let path = self.trash_sidecar_path(&id);
            let unreadable = |why: String| KernelError::Io {
                path: path.clone(),
                source: std::io::Error::new(std::io::ErrorKind::InvalidData, why),
            };
            let raw = crate::error::optional(self.storage.read(&path)).map_err(|source| {
                KernelError::Io {
                    path: path.clone(),
                    source,
                }
            })?;
            let Some(raw) = raw else {
                out.unplaced(&id);
                continue;
            };
            let sidecar = serde_json::from_slice::<TrashSidecar>(&raw)
                .map_err(|and| unreadable(and.to_string()))?;
            if sidecar.v != SCHEMA_VERSION {
                return Err(unreadable(format!(
                    "sidecar del cestino in versione {}, questa copia legge la {}",
                    sidecar.v, SCHEMA_VERSION
                )));
            }
            let stamp = TrashStamp {
                size: stat.size,
                mtime: stat.mtime,
            };
            if sidecar.file.is_some_and(|f| f != stamp) {
                out.unplaced(&id);
            } else {
                out.placed.insert(DocId::new(sidecar.original));
            }
        }
        Ok(out)
    }

    /// Cancella davvero un file, ma **solo** dentro il cestino.
    ///
    /// È l'unica cancellazione che il vault sa fare, ed è deliberato: dall'app
    /// una nota si sposta nel cestino ([`Vault::trash`]), non si distrugge.
    /// Qui il file è già stato cestinato una volta, e svuotare il cestino è
    /// l'atto con cui l'utente conferma.
    pub fn remove_trashed(&self, id: &DocId) -> Result<()> {
        self.leave_trash(id, TrashExit::Destroy)
    }

    /// Ritira una voce dal cestino e la rimette nel vault a `to`: è l'**inverso
    /// esatto** di [`trash`](Vault::trash), e come quello è una mossa sola.
    ///
    /// Una mossa sola non è un dettaglio di implementazione, è la proprietà: un
    /// ripristino che scrivesse la copia nuova e poi cancellasse quella vecchia
    /// avrebbe un istante in cui la nota sta in due posti, e un guasto in quel
    /// punto ce la lascia — l'utente ne modifica una e ritrova l'altra. Un
    /// `rename` o è avvenuto o no.
    pub fn restore_trashed(&self, id: &DocId, to: &DocId) -> Result<()> {
        self.leave_trash(id, TrashExit::To(to))
    }

    /// Le due uscite dal cestino, con **ciò che il cestino tiene** scritto una
    /// volta sola.
    ///
    /// Per una voce cestinata il cestino tiene due cose — il file e il suo
    /// sidecar — e le uscite sono due: distruggerla o restituirla. Scritte
    /// separatamente sarebbero due elenchi da tenere allineati, cioè due modi di
    /// dimenticare metà voce; il giorno che il cestino terrà una terza cosa (una
    /// miniatura, una derivata) la si aggiunge qui e **tutte** le uscite se la
    /// portano dietro senza che nessuno se ne ricordi.
    ///
    /// Il recinto vale per entrambe: da qui non si tocca niente che non stia
    /// dentro `.trash/`.
    fn leave_trash(&self, id: &DocId, exit: TrashExit<'_>) -> Result<()> {
        // Il recinto esterno l'ha già messo `path_for`, per la sorgente come
        // per la destinazione: qui sotto `path` non contiene più `..`, quindi
        // il confronto di prefisso che segue vuol dire quel che sembra dire.
        let path = self.path_for(id)?;
        if !path.starts_with(self.root.join(TRASH_DIR)) {
            return Err(KernelError::OutsideVault(path));
        }
        match exit {
            TrashExit::Destroy => self
                .storage
                .remove(&path)
                .map_err(|source| KernelError::Io {
                    path: path.clone(),
                    source,
                })?,
            TrashExit::To(to) => {
                let target = self.path_for(to)?;
                match self.storage.rename_no_replace(&path, &target) {
                    Ok(()) => {}
                    Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {
                        return Err(KernelError::AlreadyExists(to.to_string()));
                    }
                    Err(source) => return Err(KernelError::Io { path, source }),
                }
            }
        }
        // Il sidecar segue la voce, e il suo esito non risale: il file **è**
        // uscito dal cestino, e dirlo fallito perché un dato derivato è rimasto
        // indietro sarebbe raccontare al chiamante il contrario di quel che è
        // successo. Quel che resta indietro se ne va con `empty_trash`.
        let _ = self.storage.remove(&self.trash_sidecar_path(id));
        Ok(())
    }

    /// Le voci del cestino che erano già complete al censimento.
    ///
    /// `trash` sposta prima il file e scrive il sidecar dopo: un file senza un
    /// sidecar valido può quindi essere una cestinatura ancora in corso in
    /// un'altra finestra. Quella voce resta dov'è; il sidecar è il marcatore che
    /// rende distruttibile la sola fotografia già completata.
    ///
    /// I compagni di lock non sono voci: finiscono in `locks`, perché chi
    /// svuota provi a togliere quelli che nessuno tiene più.
    fn trash_entries_with_sidecars(
        &self,
        dir: &Utf8Path,
        out: &mut Vec<CensusEntry>,
        locks: &mut Vec<Utf8PathBuf>,
    ) -> Result<()> {
        let entries = self.storage.list(dir).map_err(|source| KernelError::Io {
            path: dir.to_owned(),
            source,
        })?;
        for entry in entries {
            if entry.stat.is_dir() {
                self.trash_entries_with_sidecars(&entry.path, out, locks)?;
                continue;
            }
            if entry
                .path
                .file_name()
                .is_some_and(crate::storage::is_write_lock)
            {
                locks.push(entry.path);
                continue;
            }
            let id = self.doc_id_for_path(&entry.path)?;
            if self.read_trash_sidecar(&id, &entry.stat)?.is_some() {
                let sidecar = self.trash_sidecar_path(&id);
                // Lo stesso `stat` che lo sweep richiederà prima di
                // distruggere: due domande uguali, confrontabili.
                let io = |source| KernelError::Io {
                    path: entry.path.clone(),
                    source,
                };
                let Some(stat) =
                    crate::error::optional(self.storage.stat(&entry.path)).map_err(io)?
                else {
                    continue;
                };
                let seen = self.trash_file_seen(&entry.path, stat).map_err(io)?;
                out.push(CensusEntry {
                    path: entry.path,
                    sidecar,
                    seen,
                });
            }
        }
        Ok(())
    }

    /// Cattura tutto ciò che serve allo sweep senza interrogare lo storage.
    pub fn prepare_empty_trash(&self) -> PreparedTrashSweep {
        PreparedTrashSweep {
            vault: self.clone(),
        }
    }

    /// Svuota il cestino e restituisce quante voci ha cancellato.
    ///
    /// Si distruggono solo le voci che avevano già un sidecar valido al
    /// censimento iniziale, e si rimuovono solo quei sidecar. Una `trash`
    /// concorrente resta quindi reversibile con il suo path d'origine intatto.
    ///
    /// Una voce censita si distrugge solo se è ancora **lo stesso file**:
    /// stessa identità, stessa dimensione e data, stesso timbro di
    /// cambiamento. Un altro processo Fub sullo stesso vault che nel frattempo
    /// l'ha sostituita (una nuova cestinatura con lo stesso nome, un
    /// ripristino seguito da un'altra cancellazione) lascia la sua voce
    /// intatta, insieme al sidecar. Fra quel controllo e la `remove` resta una
    /// finestra di una chiamata di sistema, che solo un lock inter-processo
    /// sul vault chiuderebbe, e il kernel non lo possiede.
    pub fn empty_trash(&self) -> Result<usize> {
        let dir = self.root.join(TRASH_DIR);
        let mut cataloged = Vec::new();
        let mut locks = Vec::new();
        if self.has_trash(&dir)? {
            self.trash_entries_with_sidecars(&dir, &mut cataloged, &mut locks)?;
        }
        // Un compagno di lock nel cestino non è una voce e non si conta; se
        // nessuno lo tiene più — l'ha lasciato una versione di Fub che non lo
        // toglieva, o un'uscita forzata — se ne va con il resto. Un guasto non
        // risale: non è una voce che l'utente ha chiesto di distruggere.
        for lock in &locks {
            if let Err(error) = self.storage.remove_abandoned_lock(lock) {
                tracing::warn!(target: "fub.kernel", %lock, %error,
                    "lock del cestino non tolto");
            }
        }
        let mut count = 0;
        for CensusEntry {
            path,
            sidecar,
            seen,
        } in &cataloged
        {
            // Una voce cambiata dopo il censimento non è più quella che
            // l'utente ha deciso di distruggere: resta, col suo sidecar. Un
            // guasto del supporto mentre lo si chiede invece risale, come per
            // la `remove` qui sotto (0193): non è una voce cambiata.
            let io = |source| KernelError::Io {
                path: path.clone(),
                source,
            };
            let Some(stat) = crate::error::optional(self.storage.stat(path)).map_err(io)? else {
                continue;
            };
            if !seen.same_file(&self.trash_file_seen(path, stat).map_err(io)?) {
                tracing::warn!(target: "fub.kernel", %path,
                    "trash entry changed after the census: kept");
                continue;
            }
            // Si distrugge solo questa voce, e solo se c'è ancora: chi l'ha già
            // tolta (un'altra finestra, un sync) non si conta — il risultato
            // che si voleva c'è già. Un guasto vero del supporto risale, perché
            // un cestino svuotato a metà non è un cestino svuotato (0193).
            match crate::error::optional(self.storage.remove(path)) {
                Ok(Some(())) => {}
                Ok(None) => continue,
                Err(and) => {
                    return Err(KernelError::Io {
                        path: path.clone(),
                        source: and,
                    });
                }
            }
            count += 1;
            // Il sidecar segue esclusivamente la voce presente nel censimento.
            crate::error::optional(self.storage.remove(sidecar)).map_err(|and| {
                KernelError::Io {
                    path: sidecar.clone(),
                    source: and,
                }
            })?;
        }
        // Se nel frattempo è arrivato un sidecar, la cartella non è vuota e
        // resta intatta; non si esegue più uno sweep globale del deposito.
        let _ = self.storage.remove_empty_dir(&self.trash_metadata_dir());
        tracing::info!(target: "fub.kernel", "trash emptied: {count} entries destroyed");
        Ok(count)
    }
}

/// Una voce del cestino censita da [`Vault::empty_trash`]: il file, il suo
/// sidecar e com'era il file quando lo si è contato.
struct CensusEntry {
    path: Utf8PathBuf,
    sidecar: Utf8PathBuf,
    seen: TrashFileSeen,
}

/// Ciò che distingue un file da quello che lo ha sostituito allo stesso nome:
/// dimensione e data, identità e timbro di cambiamento dove il supporto li sa
/// dare, confrontati con la regola unica ([`FileWitness::agrees`]).
///
/// La grana del timbro ([`crate::transfer::change_stamp_settled`]) qui non si
/// chiede, di proposito: censimento e distruzione stanno nella stessa
/// chiamata, e una riscrittura dello stesso peso e della stessa data nella
/// grana del timbro fra i due è della stessa natura di quella fra il
/// controllo e la `remove`, che nessun metadato chiude. Chiederla terrebbe
/// nel cestino ogni voce cestinata negli ultimi due secondi senza chiudere
/// niente.
#[derive(Debug, Clone, Copy)]
struct TrashFileSeen {
    stat: Stat,
    witness: FileWitness,
}

impl TrashFileSeen {
    /// È ancora il file censito?
    fn same_file(&self, now: &TrashFileSeen) -> bool {
        self.stat == now.stat && self.witness.agrees(&now.witness)
    }
}

impl Vault {
    /// Come è ora il file `path`. Un errore del supporto risale: «non lo so»
    /// è già `None` nella risposta del backend, non un errore da tacere.
    fn trash_file_seen(&self, path: &Utf8Path, stat: Stat) -> std::io::Result<TrashFileSeen> {
        Ok(TrashFileSeen {
            stat,
            witness: FileWitness::of_path(self.storage.as_ref(), path)?,
        })
    }
}

/// Come una voce lascia il cestino: distrutta, o restituita al vault.
enum TrashExit<'a> {
    Destroy,
    To(&'a DocId),
}

/// Una voce del cestino. Vive nel **contratto** dalla decisione 0013, da quando
/// `VaultRead::list_trash` la restituisce: qui resta il nome con cui il vault la
/// costruisce.
pub use fub_abi::traits::TrashEntry;

#[cfg(test)]
mod tests;
