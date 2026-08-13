//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::rules::{path_policy, text_policy};
use fub_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::ignore::{IgnorePolicy, Specie};
use crate::settings::SharedSettings;
use crate::storage::{EntryKind, FsStorage, Stat, VaultStorage};
use crate::time::{now_unix, stamp_from_unix};
use fub_abi::schema::SchemaVersion;

/// La **radice unica** di ciò che Fub scrive dentro un vault
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
pub(crate) fn radice_assoluta(root: &Utf8Path) -> Utf8PathBuf {
    if root.is_absolute() {
        return root.to_owned();
    }
    std::env::current_dir()
        .ok()
        .and_then(|cwd| Utf8PathBuf::from_path_buf(cwd).ok())
        .map(|cwd| cwd.join(root))
        .unwrap_or_else(|| root.to_owned())
}

pub use fub_abi::rules::cestino::TRASH_DIR;
/// Nome della cartella cestino dentro il vault.
///
/// È la stessa che usa Obsidian per "Move to Obsidian trash": un vault
/// condiviso fra le due app ha **un solo** cestino (vedi
/// `docs/PIANO.md`, "Decisioni (con il perché)", e
/// `docs/architecture/data-model.md`, "Il cestino").
use fub_abi::rules::cestino::{self, file_name_of, strip_stamp};

/// Cartella (dentro [`data_root`]) dei sidecar del cestino: per ogni voce
/// cestinata **da Fub**, un `<nome-cestinato>.json` con il path d'origine.
///
/// Esiste perché il cestino è piatto (D1, interop con Obsidian) e il nome del
/// file da solo non sa dire da quale cartella veniva: senza sidecar,
/// ripristinare `progetti/Nota.md` la farebbe tornare come `Nota.md` in
/// radice — storia del versioning orfana, link per path irrisolti. Obsidian
/// non scrive sidecar: una voce senza è il degrado garbato al comportamento
/// di prima (si ripristina in radice col nome de-timbrato).
const TRASH_META_DIR: &str = "trash";

/// La versione di schema del sidecar del cestino (§15.3).
///
/// Ce l'ha anche un formato di due campi, e anche uno il cui degrado è già
/// previsto: senza un numero in testa, la versione dopo dovrebbe **indovinare**
/// che un file senza campo viene da prima — e qui indovinare male vuol dire
/// riportare la nota di qualcuno nella cartella sbagliata.
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

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
    pub temporanei_rimasti_indietro: Vec<Utf8PathBuf>,
}

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
}

impl Vault {
    /// Un vault sul filesystem, che è il caso di ogni chiamante di produzione.
    ///
    /// Fallisce **all'ingresso** — prima di qualunque scansione, evento o
    /// interfaccia — se la radice non esiste, non è una cartella o non si ha
    /// permesso di scriverci (0160).
    pub fn open(root: impl AsRef<Utf8Path>) -> Result<Self> {
        Vault::on(root, Arc::new(FsStorage))
    }

    /// Un vault su un supporto qualunque (§15.1).
    ///
    /// **La radice si fissa qui**, e da qui in poi non è più quella che il
    /// chiamante ha scritto: è la sua forma assoluta ([`radice_assoluta`]).
    /// Questa è la sola riga che la costruisce, quindi non esiste un `Vault` la
    /// cui radice si sposti sotto ai piedi.
    ///
    /// È anche la sola riga che **verifica la radice**, e la verifica adesso:
    /// chiede al supporto se può starci un vault ([`VaultStorage::radice_valida`])
    /// e risponde con [`KernelError::RadiceInvalida`] se non può. Un errore più
    /// tardi — alla prima operazione che tocca il disco — sarebbe un vault già
    /// mostrato come aperto, con eventi già emessi (0160).
    pub fn on(root: impl AsRef<Utf8Path>, storage: Arc<dyn VaultStorage>) -> Result<Self> {
        let root = radice_assoluta(root.as_ref());
        storage
            .radice_valida(&root)
            .map_err(|source| KernelError::RadiceInvalida {
                path: root.clone(),
                source,
            })?;
        Ok(Vault {
            root,
            storage,
            settings: None,
        })
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
        crate::ignore::resolve(self.settings.as_ref())
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
        let Ok(rel) = abs.strip_prefix(&self.root) else {
            return false;
        };
        let policy = self.ignore_policy();
        let mut componenti = rel.components().peekable();
        while let Some(c) = componenti.next() {
            let nome = c.as_str();
            if componenti.peek().is_some() {
                // Chi sta in mezzo a un path contiene ciò che segue, quindi è
                // una cartella: non c'è niente da chiedere a nessuno.
                if policy.esclude(nome, Specie::Cartella) {
                    return true;
                }
            } else {
                // L'ultimo è il solo componente che può essere un file, e la
                // sua specie conta soltanto se quel nome è dichiarato fra le
                // cartelle escluse: è l'unico ramo in cui le due risposte
                // differiscono, ed è lì — e solo lì — che si chiede al
                // supporto di cosa si tratti.
                let escluso = policy.esclude(nome, Specie::File)
                    || (policy.esclude(nome, Specie::Cartella) && self.e_una_cartella(abs));
                if escluso {
                    return true;
                }
            }
        }
        false
    }

    /// L'ultimo componente di un path è una cartella?
    ///
    /// Lo sa il supporto, e glielo si chiede **solo quando la risposta cambia
    /// qualcosa**: cioè solo quando quel nome è dichiarato fra le cartelle
    /// escluse, che è il solo ramo in cui le due specie non rispondono uguale.
    /// Sul path di un evento qualunque del rilevatore questa domanda non si fa,
    /// e la porta d'ingresso del watcher non paga una `stat` per file.
    ///
    /// Un path che non c'è più conta come cartella, ed è la scelta
    /// conservativa detta: se quel nome è dichiarato escluso, ciò che è sparito
    /// era quasi certamente la cartella dichiarata, e trattarlo come un file
    /// vorrebbe dire far rientrare dalla porta del rilevatore proprio ciò che
    /// la scansione tiene fuori — che è il difetto per cui [`is_ignored`]
    /// esiste.
    ///
    /// [`is_ignored`]: Vault::is_ignored
    fn e_una_cartella(&self, abs: &Utf8Path) -> bool {
        self.storage
            .stat(abs)
            .map(|stat| stat.kind == EntryKind::Dir)
            .unwrap_or(true)
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
            temporanei_rimasti_indietro: Vec::new(),
        };
        // La politica si risolve **una volta per scansione** e non per voce di
        // directory: leggerla è prendere un lock e costruire un elenco, e una
        // camminata su diecimila file lo farebbe diecimila volte per una
        // risposta che non cambia in mezzo. Che valga per tutta la camminata è
        // anche più giusto che comodo: una scansione mezza con una politica e
        // mezza con un'altra non è un elenco di niente.
        let policy = self.ignore_policy();
        self.walk(&self.root, &policy, &mut out)?;
        out.files.sort_by(|a, b| a.id.cmp(&b.id));
        out.folders.sort();
        out.temporanei_rimasti_indietro.sort();
        Ok(out)
    }

    fn walk(&self, dir: &Utf8Path, policy: &IgnorePolicy, out: &mut Scan) -> Result<()> {
        let entries = self.storage.list(dir).map_err(|e| KernelError::Io {
            path: dir.to_owned(),
            source: e,
        })?;
        for entry in entries {
            let name = entry.path.file_name().unwrap_or_default();
            // La specie qui è già in mano: la porta la voce di directory, e
            // l'elenco delle cartelle escluse parla di cartelle (difetto 0176).
            let specie = match entry.stat.kind {
                EntryKind::Dir => Specie::Cartella,
                _ => Specie::File,
            };
            if policy.esclude(name, specie) {
                // Un temporaneo di scrittura è escluso, ed è la §15.6: quel
                // file esiste per una frazione di secondo e chi guarda il vault
                // in quella frazione non lo deve vedere. Ma un crash fra la
                // creazione e la rename ne lascia uno per terra **per sempre**,
                // e da lì in poi la stessa riga che lo nascondeva lo rende
                // invisibile anche a chi potrebbe toglierlo: la camminata è il
                // solo posto da cui si vede (difetto 0155).
                if specie == Specie::File
                    && crate::storage::e_temporaneo_di_scrittura(name)
                    && self.storage.e_rimasto_indietro(&entry.stat)
                {
                    out.temporanei_rimasti_indietro.push(entry.path.clone());
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
        let path = self.path_for(id)?;
        self.storage
            .read(&path)
            .map_err(|e| KernelError::Io { path, source: e })
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
            .map_err(|e| KernelError::Io { path, source: e })
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
            .map_err(|e| KernelError::Io {
                path: from_path,
                source: e,
            })
    }

    /// Sposta un documento soltanto se nessuno ha occupato la destinazione.
    pub fn rename_no_replace(&self, from: &DocId, to: &DocId) -> Result<()> {
        let from_path = self.path_for(from)?;
        let to_path = self.path_for(to)?;
        match self.storage.rename_no_replace(&from_path, &to_path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(KernelError::AlreadyExists(to.to_string()))
            }
            Err(e) => Err(KernelError::Io {
                path: from_path,
                source: e,
            }),
        }
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
    pub fn trash(&self, id: &DocId) -> Result<(DocId, Option<KernelError>)> {
        let from = self.path_for(id)?;
        // La cartella del cestino non si crea qui: `VaultStorage::rename` crea
        // le cartelle di destinazione che mancano, e farlo una seconda volta
        // vorrebbe dire avere due idee di quando una cartella esiste.
        let stamp = stamp_from_unix(now_unix());
        // Il nome nel cestino non se lo costruisce chi cestina: è una regola
        // del contratto, e chi cestina è più di uno (0219).
        let target = DocId::new(cestino::trashed_id(id.as_str(), &stamp, &mut |c| {
            self.exists(&DocId::new(c))
        }));

        self.storage
            .rename(&from, &self.path_for(&target)?)
            .map_err(|e| KernelError::Io {
                path: from,
                source: e,
            })?;
        // Il sidecar col path d'origine è best-effort: se non si scrive, la
        // voce degrada al comportamento senza sidecar (ripristino in radice),
        // ma la cancellazione È riuscita e va detta con un Ok. Il sidecar
        // mancante non è però silenzioso: chi ripristina tornerebbe nel posto
        // sbagliato, ed è un guasto che l'utente ha il diritto di sapere
        // (decisione 0052). Lo si restituisce invece di scriverlo su stderr, e
        // `delete_document` — che ha il workspace fra le mani — lo porta nel
        // canale e nel log (decisione 0062).
        let sidecar_fault = self.write_trash_sidecar(&target, id).err();
        Ok((target, sidecar_fault))
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
            deleted_at: Some(crate::time::now_unix_millis()),
        })
        .expect("un path è sempre serializzabile");
        self.storage
            .write(&path, json.as_bytes())
            .map(|_| ())
            .map_err(|e| KernelError::Io { path, source: e })
    }

    /// Ciò che questo vault sa di una voce cestinata, se è stata Fub a
    /// cestinarla. Un sidecar assente o illeggibile non è un errore: è una
    /// voce cestinata da qualcun altro (Obsidian), o di un'altra epoca.
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
    fn trash_sidecar(&self, trashed: &DocId, stat: &Stat) -> Option<TrashSidecar> {
        let raw = self.storage.read(&self.trash_sidecar_path(trashed)).ok()?;
        let sidecar: TrashSidecar = serde_json::from_slice(&raw).ok()?;
        if sidecar.v != SCHEMA_VERSION {
            return None;
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
            return None;
        }
        Some(sidecar)
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
        if !self.storage.exists(&dir) {
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
        for entry in self.storage.list(dir).map_err(|e| io(dir, e))? {
            let path = entry.path;
            if entry.stat.is_dir() {
                self.walk_trash(&path, out)?;
                continue;
            }
            let id = self.doc_id_for_path(&path)?;
            let name = file_name_of(id.as_str());
            let sidecar = self.trash_sidecar(&id, &entry.stat);
            out.push(TrashEntry {
                // Il sidecar sa da quale cartella veniva; senza (voce di
                // Obsidian, o di un'altra epoca) si degrada al nome
                // de-timbrato nella radice.
                original: sidecar
                    .as_ref()
                    .map(|s| DocId::new(s.original.clone()))
                    .unwrap_or_else(|| DocId::new(strip_stamp(name))),
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
                    .unwrap_or(entry.stat.mtime)
                    / 1000,
                size: entry.stat.size,
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
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
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
    fn voci_censite_del_cestino(&self, dir: &Utf8Path, out: &mut Vec<(Utf8PathBuf, Utf8PathBuf)>) {
        let Ok(voci) = self.storage.list(dir) else {
            return;
        };
        for voce in voci {
            if voce.stat.is_dir() {
                self.voci_censite_del_cestino(&voce.path, out);
                continue;
            }
            let Ok(id) = self.doc_id_for_path(&voce.path) else {
                continue;
            };
            if self.trash_sidecar(&id, &voce.stat).is_some() {
                let sidecar = self.trash_sidecar_path(&id);
                out.push((voce.path, sidecar));
            }
        }
    }

    /// Svuota il cestino e restituisce quante voci ha cancellato.
    ///
    /// Si distruggono solo le voci che avevano già un sidecar valido al
    /// censimento iniziale, e si rimuovono solo quei sidecar. Una `trash`
    /// concorrente resta quindi reversibile con il suo path d'origine intatto.
    ///
    /// Resta una finestra multi-processo non coperta: senza un lock di vault, un
    /// altro processo puo sostituire una voce gia censita fra la verifica del
    /// sidecar e la `remove`. Questo metodo non introduce un lock
    /// inter-processo che il kernel non possiede.
    pub fn empty_trash(&self) -> Result<usize> {
        let dir = self.root.join(TRASH_DIR);
        let mut censite = Vec::new();
        if self.storage.exists(&dir) {
            self.voci_censite_del_cestino(&dir, &mut censite);
        }
        let mut quante = 0;
        for (path, sidecar) in &censite {
            // Si distrugge solo questa voce, e solo se c'è ancora: chi l'ha già
            // tolta (un'altra finestra, un sync) non si conta — il risultato
            // che si voleva c'è già. Un guasto vero del supporto risale, perché
            // un cestino svuotato a metà non è un cestino svuotato (0193).
            match crate::error::se_c_e(self.storage.remove(path)) {
                Ok(Some(())) => {}
                Ok(None) => continue,
                Err(e) => {
                    return Err(KernelError::Io {
                        path: path.clone(),
                        source: e,
                    });
                }
            }
            quante += 1;
            // Il sidecar segue esclusivamente la voce presente nel censimento.
            crate::error::se_c_e(self.storage.remove(sidecar)).map_err(|e| KernelError::Io {
                path: sidecar.clone(),
                source: e,
            })?;
        }
        // Se nel frattempo è arrivato un sidecar, la cartella non è vuota e
        // resta intatta; non si esegue più uno sweep globale del deposito.
        let _ = self.storage.remove_empty_dir(&self.trash_meta_dir());
        tracing::info!(target: "fub.kernel", "cestino svuotato: {quante} voci distrutte");
        Ok(quante)
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
mod tests {
    use super::*;

    #[test]
    fn what_is_ignored_is_ignored_at_any_depth() {
        // La politica d'esclusione non guarda il disco: il vault si apre in
        // memoria, dove una radice che sta per nascere è legittima (0160).
        let v = Vault::on("/vault", Arc::new(crate::storage::MemStorage::new()))
            .expect("un vault in memoria si apre");
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

    /// **Un vault che è anche un repo** (difetto 0118): `target/` è ciò che
    /// scrive Cargo, e da quando il vault dice *cosa contiene* invece di
    /// filtrare per estensione (§14.1) ogni file lì dentro prendeva un
    /// [`DocId`] ed entrava in anagrafe — decine di migliaia di voci, un indice
    /// che le porta, e una ricerca che pesca artefatti.
    ///
    /// Il banco sta qui e non solo sulla costante perché è un difetto che si
    /// vede **dal vault**, non dalla lista: la lista si legge e sembra a posto.
    #[test]
    fn un_vault_che_e_anche_un_repo_non_indicizza_cio_che_scrive_cargo() {
        let v = Vault::on("/vault", Arc::new(crate::storage::MemStorage::new()))
            .expect("un vault in memoria si apre");
        for rel in ["target/debug/appunti.md", "Idea.md"] {
            let path = Utf8Path::new("/vault").join(rel);
            v.storage().write(&path, b"x").expect("scrittura");
        }
        let visti: Vec<String> = v
            .scan()
            .expect("scansione")
            .files
            .into_iter()
            .map(|f| f.id.0)
            .collect();
        assert_eq!(visti, vec!["Idea.md"], "«target/» entrava in anagrafe");
        assert!(v.is_ignored("/vault/target/debug/appunti.md".into()));
    }

    /// Un vault con le impostazioni di un vero montaggio, con la politica di
    /// esclusione già dichiarata.
    fn vault_che_dichiara(valori: &[(&str, fub_abi::settings::SettingValue)]) -> Vault {
        let storage: Arc<dyn VaultStorage> = Arc::new(crate::storage::MemStorage::new());
        let mut store = crate::settings::SettingsStore::open(
            "/vault".into(),
            Arc::clone(&storage),
            crate::settings::MachineSettings::in_memory(),
        );
        store
            .declare("fub", &crate::ignore::ignore_settings())
            .expect("le due chiavi dell'esclusione");
        for (key, value) in valori {
            store.set(key, value.clone()).expect("chiave dichiarata");
        }
        Vault::on("/vault", storage)
            .expect("un vault in memoria si apre")
            .watching(Arc::new(std::sync::RwLock::new(store)))
    }

    /// **La casella dei nascosti** (§3.2 del catalogo): mostrarli è una
    /// preferenza, e vale davvero — ma non è un grimaldello sulla struttura.
    /// Con l'interruttore acceso la bozza è un documento, e la cartella di Fub,
    /// il cestino e il temporaneo di una scrittura restano fuori.
    #[test]
    fn mostrare_i_nascosti_non_apre_la_struttura() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
        assert!(!v.is_ignored("/vault/note/.bozza.md".into()));
        assert!(v.is_ignored("/vault/.fub/data/anagrafe.json".into()));
        assert!(v.is_ignored("/vault/.trash/Idea.2026-07-24T15-30-00.md".into()));
        assert!(v.is_ignored("/vault/note/.Idea.md.tmp1234-5".into()));
        // Il compagno di lock è l'unico dei quattro che non se ne va mai — non
        // si può togliere senza rompere il lock (difetto 0151) — quindi è
        // l'unico per cui «non si vede» deve essere una regola e non un
        // istante. Sta nella radice apposta: oggi ogni file protetto sta dentro
        // `.fub/`, e un banco che lo mettesse lì proverebbe `.fub`.
        assert!(
            v.is_ignored("/vault/.Idea.md.lock".into()),
            "il compagno di lock di un file della radice era un documento, \
             e non se ne va mai"
        );
        // E l'elenco delle cartelle escluse è l'altra metà, che questa non tocca.
        assert!(v.is_ignored("/vault/node_modules/pacchetto/readme.md".into()));
    }

    /// La metà che impedisce alla riparazione di diventare «tutto ciò che
    /// finisce per `.lock`»: un `Cargo.lock` o un `flake.lock` non sono note di
    /// nessuno, ma sono file che uno può tenersi nel vault, e non cominciano
    /// per punto.
    #[test]
    fn un_file_di_lock_che_non_e_nostro_resta_nel_vault() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
        for lock in ["/vault/Cargo.lock", "/vault/note/flake.lock"] {
            assert!(
                !v.is_ignored(lock.into()),
                "{lock} è sparito dal vault: la regola del compagno di lock \
                 si è allargata a chiunque finisca per «.lock»"
            );
        }
    }

    /// **La casella della costante** (§15.6): l'elenco è dato, e dichiararne uno
    /// diverso cambia cosa il vault contiene senza ricompilare niente.
    #[test]
    fn le_cartelle_escluse_le_dichiara_il_vault() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(
            crate::ignore::EXCLUDED_FOLDERS,
            SettingValue::List(vec!["build".into()]),
        )]);
        assert!(v.is_ignored("/vault/build/out.md".into()));
        assert!(!v.is_ignored("/vault/node_modules/pacchetto/readme.md".into()));
        // La struttura non è nell'elenco e non ci entra: toglierla dalla lista
        // non la rivela.
        assert!(v.is_ignored("/vault/.fub/settings.json".into()));
    }

    /// **La prima metà della 0176, dalle due porte.** `build/` è la forma che
    /// scrive per prima chi arriva da un `.gitignore`, e confrontata per
    /// uguaglianza con il nome che il disco restituisce non combaciava con
    /// niente: quella riga non escludeva un bel niente, e a dirlo non c'era
    /// nessuno — un'esclusione che non scatta non dà errore, dà un vault che
    /// indicizza `build/`.
    #[test]
    fn una_cartella_dichiarata_con_lo_slash_resta_fuori_dal_vault() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(
            crate::ignore::EXCLUDED_FOLDERS,
            SettingValue::List(vec!["build/".into()]),
        )]);
        for rel in ["build/out.md", "note/Idea.md"] {
            let path = Utf8Path::new("/vault").join(rel);
            v.storage().write(&path, b"x").expect("scrittura");
        }
        let visti: Vec<String> = v
            .scan()
            .expect("scansione")
            .files
            .into_iter()
            .map(|f| f.id.0)
            .collect();
        assert_eq!(visti, vec!["note/Idea.md"], "«build/» non escludeva niente");
        assert!(v.is_ignored("/vault/build/out.md".into()));
    }

    /// **La seconda metà della 0176, dalle due porte.** L'elenco si chiama
    /// «cartelle escluse»: un file che si chiama come una di loro è un file di
    /// questo vault, e toglierlo è toglierlo davvero — niente [`DocId`],
    /// niente voce d'anagrafe, nessun evento che lo dica.
    ///
    /// Le due porte si provano insieme apposta: la scansione la specie ce
    /// l'ha in mano dalla voce di directory, il watcher ha in mano un path e
    /// basta, e se le due rispondessero diverso il file rientrerebbe al primo
    /// salvataggio o sparirebbe al primo evento.
    #[test]
    fn un_file_che_si_chiama_come_una_cartella_esclusa_resta_nel_vault() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(
            crate::ignore::EXCLUDED_FOLDERS,
            SettingValue::List(vec!["archivio".into()]),
        )]);
        for rel in ["archivio", "note/archivio/vecchia.md", "note/Idea.md"] {
            let path = Utf8Path::new("/vault").join(rel);
            v.storage().write(&path, b"x").expect("scrittura");
        }
        let visti: Vec<String> = v
            .scan()
            .expect("scansione")
            .files
            .into_iter()
            .map(|f| f.id.0)
            .collect();
        assert_eq!(
            visti,
            vec!["archivio", "note/Idea.md"],
            "il file «archivio» spariva dal vault insieme alla cartella"
        );
        assert!(!v.is_ignored("/vault/archivio".into()));
        // E la cartella che si chiama come lui resta fuori, dai due versi: il
        // path del file dentro, e il path della cartella stessa.
        assert!(v.is_ignored("/vault/note/archivio/vecchia.md".into()));
        assert!(v.is_ignored("/vault/note/archivio".into()));
    }

    /// **Le due porte d'ingresso guardano lo stesso vault.** Il watcher chiede
    /// `is_ignored`, la scansione cammina: se le due politiche non fossero la
    /// stessa, un file che la scansione non elenca rientrerebbe al primo
    /// salvataggio — che è il difetto per cui `is_ignored` esiste.
    #[test]
    fn il_watcher_e_la_scansione_hanno_la_stessa_politica() {
        use fub_abi::settings::SettingValue;
        let v = vault_che_dichiara(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
        for (rel, contenuto) in [
            ("note/Idea.md", "una nota"),
            ("note/.bozza.md", "una bozza"),
            (".fub/data/anagrafe.json", "{}"),
            (".trash/Vecchia.md", "cestinata"),
            ("node_modules/pacchetto/readme.md", "roba di npm"),
        ] {
            let path = Utf8Path::new("/vault").join(rel);
            v.storage()
                .write(&path, contenuto.as_bytes())
                .expect("scrittura");
        }
        let visti: Vec<String> = v
            .scan()
            .expect("scansione")
            .files
            .into_iter()
            .map(|f| f.id.0)
            .collect();
        assert_eq!(visti, vec!["note/.bozza.md", "note/Idea.md"]);
        for rel in [
            "note/Idea.md",
            "note/.bozza.md",
            ".fub/data/anagrafe.json",
            ".trash/Vecchia.md",
            "node_modules/pacchetto/readme.md",
        ] {
            let path = Utf8Path::new("/vault").join(rel);
            assert_eq!(
                v.is_ignored(&path),
                !visti.contains(&rel.to_string()),
                "{rel}: le due porte non dicono la stessa cosa"
            );
        }
    }

    /// **La casella dei collegamenti** (§15.6, consegnata dalla 0058): non si
    /// seguono, e il caso che lo rende una decisione invece che una preferenza è
    /// questo — una cartella che contiene un collegamento a se stessa. Se la
    /// camminata li seguisse senza saper riconoscere un nodo già visitato,
    /// questo banco non fallirebbe: non tornerebbe affatto.
    #[cfg(unix)]
    #[test]
    fn un_anello_di_collegamenti_non_ferma_la_scansione() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::create_dir(root.join("note")).expect("cartella");
        std::fs::write(root.join("note/Idea.md"), "una nota").expect("nota");
        std::os::unix::fs::symlink(root.join("note"), root.join("note/anello")).expect("anello");
        let scan = Vault::open(&root)
            .expect("la radice appena creata si apre")
            .scan()
            .expect("scansione");
        assert_eq!(scan.files.len(), 1, "{:?}", scan.files[0].id);
        assert_eq!(scan.folders, vec!["note".to_string()]);
    }
}
