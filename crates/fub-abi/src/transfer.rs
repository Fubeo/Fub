//! Import ed export — come i dati **entrano** nel vault e come ne **escono**.
//!
//! Il capitolo 17 di FEATURES.md è ~120 voci (Notion, Evernote, Obsidian, CSV,
//! EPUB, BibTeX, EML, PDF, Pandoc, Typst, sito statico…). O ognuna è un
//! provider che si registra e sparisce dal kernel, o ognuna è codice dell'app —
//! e allora il capitolo 17 *è* l'app. Qui ci sono le due firme che decidono
//! quale delle due cose sarà, più i tipi che le attraversano.
//!
//! # Il confine è di byte, non di path
//!
//! Un [`ImportProvider`] riceve la sorgente senza mai vederne il percorso; un
//! [`ExportProvider`] produce **artefatti** ([`ExportArtifact`]), non file
//! scritti. In mezzo, nessuno dei due nomina mai un posto del filesystem fuori
//! dal vault.
//!
//! Non è un dettaglio di comodo: è ciò che rende import ed export esprimibili
//! *senza aggiungere una capacità filesystem* all'[`HostApi`]. Chi apre il
//! dialogo di sistema e chi posa i byte sul disco è l'host — che è già l'unico
//! a sapere dove sia il vault (vedi `data_*` e il suo recinto). Un plugin WASM
//! di M5 eredita la stessa firma senza che la sandbox debba concedere niente:
//! la regola «Filesystem: nessun accesso diretto» resta vera anche per il
//! capitolo che, in ogni altra applicazione, è quello che il filesystem lo
//! tocca di più.
//!
//! # I byte non stanno per forza nel record
//!
//! Fino alla decisione 0102 stavano: `ImportSource` portava un `Vec<u8>` con
//! dentro *tutta* la sorgente, ed `ExportReport` un `Vec<ExportArtifact>` con
//! dentro tutto l'esito. Il prezzo era dichiarato in una riga del verbale della
//! decisione 0006 — «sorgente e artefatti stanno in memoria» — e quella riga
//! non diceva **cosa** si importa: il capitolo 17.1 è la migrazione da
//! Obsidian, Notion, Evernote, cioè un **vault intero**, che è la cosa più
//! grande che l'utente possiede.
//!
//! La forma di adesso lascia i byte dove sono e ne dà una **chiave**:
//! [`SourceContent::Streamed`] porta una [`SourceHandle`] che solo l'host sa
//! risolvere ([`TransferRead::read_source`](crate::traits::TransferRead)), e
//! l'esito di un export si versa mentre lo si produce, attraverso un
//! [`ArtifactSink`]. È la stessa forma con cui la 0006 tiene fuori il
//! filesystem — chi apre e chi legge resta l'host — applicata al *contenuto*
//! invece che al *percorso*: un handle non si costruisce, si riceve, e nomina
//! esattamente la sorgente che l'utente ha scelto e nient'altro.
//!
//! Le due strade scartate sono nel verbale, e la ragione è una sola: **una
//! lettura di sorgente deve essere posizionale**. Uno `stream<u8>` di WASI e un
//! metodo a chunk con un cursore tenuto dall'host sono tutti e due
//! *sequenziali*, e un contenitore zip — cioè `.docx`, `.epub`, `.odt` e mezzo
//! mondo dei backup — ha la propria directory **in fondo**. Chi può solo andare
//! avanti non sfoglia un archivio: lo scarica tutto e siamo al punto di prima.
//!
//! Restare in memoria non è vietato ed è il caso comune:
//! [`SourceContent::Bytes`] è ancora lì, e chi apre la sorgente sceglie. Ciò
//! che cambia è che adesso la scelta si può **dichiarare** invece di essere
//! l'unica.
//!
//! # Il piano è il rapporto di una prova a vuoto
//!
//! 17.3 chiede *preview*, *validation*, *pre-migration report*: cioè sapere
//! cosa succederebbe senza che succeda. La risposta qui **non** è un
//! `MigrationPlan` gemello di [`ImportReport`] — due tipi che dicono la stessa
//! cosa in due momenti diversi divergono al primo campo aggiunto a uno solo.
//! È [`ImportMode`]: lo stesso import, chiesto in `Preview`, restituisce lo
//! stesso [`ImportReport`] senza aver scritto niente. Il piano *è* il rapporto,
//! e il rapporto porta la modalità con cui è stato prodotto — così chi lo legge
//! non deve ricordarsi la domanda.
//!
//! # Errori e rapporto: chi dice cosa
//!
//! `Err(PluginError)` significa **non ho potuto cominciare**: sorgente
//! illeggibile, target sconosciuto, argomenti che non stanno in piedi. Tutto
//! ciò che riguarda *un singolo pezzo* di un trasferimento riuscito a metà —
//! un documento saltato per conflitto, un allegato mancante, una riga di CSV
//! malformata — sta nel rapporto ([`ImportOutcome`], [`TransferNote`]), perché
//! un import di 4000 note che ne perde 3 è **riuscito con tre problemi**, non
//! fallito.
//!
//! # Cosa resta deliberatamente fuori
//!
//! - **Rollback e resume** (17.3): il rapporto nomina ogni documento toccato,
//!   che è l'input di cui un rollback ha bisogno — ma il rollback stesso è
//!   l'inverso di un lotto (decisione 0011) sopra un journal (§15.2), e nessuno dei due
//!   esiste. Inventare qui un `batch_id` che nessuno consuma sarebbe un varco
//!   che sembra aperto.
//! - **Il modello parsato**: un [`ExportProvider`] legge la *sorgente* dei
//!   documenti (`VaultRead::read_document`). Finché nessuna capacità restituisce
//!   un [`DocumentModel`](crate::model::DocumentModel) (§4.2), un export verso
//!   PDF/HTML/Typst deve riparsare per conto proprio; l'export markdown, che è
//!   il primo cliente, la sorgente la vuole com'è.

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::model::DocId;
use crate::traits::{HostApi, IndexQuery, IndexResult, ReadApi, TransferRead};

/// Quanto chiede per volta chi legge una sorgente intera.
///
/// Non è un tetto del contratto e non va pubblicato come tale: è la grana con
/// cui [`ImportSource::read_all`] chiede, e l'host può sempre dare meno. Un
/// numero pubblicato sarebbe una promessa congelata — la forma che la
/// decisione 0094 ha già scartato per `random-bytes`.
const READ_CHUNK: u32 = 256 * 1024;

/// Quanto si prealloca leggendo tutto: `len` è ciò che l'host ha visto *prima*
/// della chiamata, quindi si usa come suggerimento e non come verità.
const READ_ALL_RESERVE: u64 = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Comune ai due versi
// ---------------------------------------------------------------------------

/// Gravità di una riga di giornale.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteLevel {
    #[default]
    Info,
    Warning,
    Error,
}

/// Una riga del giornale di un trasferimento: i *migration logs* e il
/// *migration audit* di 17.3.
///
/// `entry` è ciò che rende un giornale di quattromila righe utilizzabile: dice
/// **a cosa** si riferisce la riga nei termini della sorgente (il nome dentro
/// lo zip, la riga del CSV, il documento esportato). Senza, un avviso è vero e
/// inservibile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferNote {
    pub level: NoteLevel,
    pub message: String,
    pub entry: Option<String>,
}

impl TransferNote {
    pub fn info(message: impl Into<String>) -> Self {
        TransferNote {
            level: NoteLevel::Info,
            message: message.into(),
            entry: None,
        }
    }

    pub fn warning(message: impl Into<String>) -> Self {
        TransferNote {
            level: NoteLevel::Warning,
            message: message.into(),
            entry: None,
        }
    }

    /// A quale entrata della sorgente si riferisce questa riga.
    pub fn about(mut self, entry: impl Into<String>) -> Self {
        self.entry = Some(entry.into());
        self
    }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// La chiave con cui un provider legge una sorgente che **non** ha in mano.
///
/// È opaca di proposito, e non è un indice in un elenco pubblico: la si riceve
/// dentro una [`ImportSource`] e la si spende con
/// [`TransferRead::read_source`](crate::traits::TransferRead::read_source).
/// Vale per la durata della chiamata di import che l'ha portata — dopo, l'host
/// ha chiuso ciò che stava dietro, e spenderla è `BadArgs` e non una lettura di
/// qualcun altro.
///
/// Che sia l'host a timbrarla è tutto il punto: un provider non può nominare
/// una sorgente che non gli è stata data, quindi non serve un recinto di path
/// da controllare — **l'handle è il recinto**. È la ragione per cui leggere una
/// sorgente non chiede un permesso del manifest: l'utente ha già scelto *quel*
/// file nel dialogo di sistema, e chiederglielo una seconda volta sarebbe
/// chiedergli della stessa cosa due volte.
///
/// Nel WIT resta un `u64` nativo; in JSON viaggia come stringa per la ragione
/// di [`JobId`](crate::traits::JobId), cioè che oltre i 2^53 un `u64` non
/// sopravvive a un `JSON.parse`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SourceHandle(pub u64);

impl Serialize for SourceHandle {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for SourceHandle {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        crate::ipc::u64_string::deserialize(d).map(SourceHandle)
    }
}

/// Una sorgente che l'host tiene aperta, di cui il provider ha una chiave e un
/// assaggio.
///
/// `prologue` è ciò che rende questa forma possibile invece che teorica: il
/// dispatch di un import è [`ImportProvider::can_handle`], che **non riceve un
/// host** e quindi non può leggere niente. Senza un assaggio nel record, una
/// sorgente a handle si potrebbe riconoscere solo dal nome — e la 0006 spiega
/// perché non basta: `.docx`, `.epub`, `.odt` e i backup di mezzo mondo sono lo
/// stesso zip. Con l'assaggio il dispatch costa qualche kibibyte qualunque sia
/// la sorgente, invece dei suoi byte una volta per candidato interpellato.
///
/// `len` è la dimensione totale, e serve prima di leggere: è la differenza fra
/// «questo archivio lo sfoglio» e «questo archivio lo tengo in memoria».
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamedSource {
    pub handle: SourceHandle,
    /// Quanti byte ha la sorgente, in tutto.
    pub len: u64,
    /// I primi byte, letti una volta sola dall'host: l'input del dispatch.
    pub prologue: Vec<u8>,
}

/// Dove stanno i byte di una sorgente.
///
/// Non è «in memoria oppure no» come dettaglio di implementazione: è una cosa
/// che un provider **deve** poter leggere, perché cambia cosa gli conviene
/// fare. Chi riceve [`SourceContent::Bytes`] ha già tutto; chi riceve
/// [`SourceContent::Streamed`] sa che leggere tutto è una scelta, e ha il
/// numero (`len`) per non farla alla cieca.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// Tag adiacente come [`SelectionSet`](crate::session::SelectionSet): entrambi i
// casi portano un payload.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SourceContent {
    /// Tutti i byte, nel record. Resta il caso comune — una nota incollata, un
    /// CSV, un `.md` — e chi apre la sorgente sceglie questa quando la sorgente
    /// è piccola abbastanza da non essere una decisione.
    Bytes(Vec<u8>),
    /// I byte restano dall'host, e si leggono per pezzi.
    Streamed(StreamedSource),
}

impl Default for SourceContent {
    /// Una sorgente vuota in memoria: è la sola che non ha bisogno di un host
    /// per esistere, quindi la sola che possa essere un default.
    fn default() -> Self {
        SourceContent::Bytes(Vec::new())
    }
}

/// Una sorgente da importare: chi la apre è l'host.
///
/// I tre campi sono i tre modi con cui si riconosce un formato, in ordine di
/// affidabilità crescente: il nome (`vault.zip`), il media type dichiarato da
/// chi ha aperto la sorgente (spesso ignoto: un file scelto da un dialogo non
/// ne ha uno) e i byte. I byte — o il loro assaggio, vedi [`StreamedSource`] —
/// stanno qui e non solo in [`import`](ImportProvider::import) perché `.docx`,
/// `.epub`, `.odt` e i backup di mezzo mondo sono **lo stesso contenitore
/// zip**: un dispatch che guardasse il solo nome sceglierebbe il provider
/// sbagliato e si fermerebbe lì.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportSource {
    /// Il nome della sorgente come l'utente la conosce. **Non** è un `DocId`:
    /// la sorgente sta fuori dal vault.
    pub name: String,
    /// Media type dichiarato da chi ha aperto la sorgente, se lo sa.
    pub media_type: Option<String>,
    pub content: SourceContent,
}

impl ImportSource {
    /// Sorgente testuale col nome dato (il caso più comune, e quello dei test).
    /// Il media type è `text/plain`: quale formato *sia* lo dice il nome, e
    /// indovinarlo qui vorrebbe dire che il contratto conosce un formato.
    pub fn text_source(name: impl Into<String>, text: impl AsRef<str>) -> Self {
        ImportSource {
            name: name.into(),
            media_type: Some("text/plain".to_string()),
            content: SourceContent::Bytes(text.as_ref().as_bytes().to_vec()),
        }
    }

    /// Sorgente in memoria dai byte dati.
    pub fn from_bytes(name: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        ImportSource {
            name: name.into(),
            media_type: None,
            content: SourceContent::Bytes(bytes.into()),
        }
    }

    /// I byte da guardare **per decidere se la sorgente è roba tua**.
    ///
    /// È l'unico accesso ai byte disponibile in
    /// [`can_handle`](ImportProvider::can_handle), e per una sorgente a handle
    /// è un assaggio: un `can_handle` che pretendesse di vedere l'ultimo byte
    /// di un archivio da 4 GiB starebbe chiedendo all'host di leggerlo tutto
    /// per ognuno dei candidati.
    pub fn prologue(&self) -> &[u8] {
        match &self.content {
            SourceContent::Bytes(bytes) => bytes,
            SourceContent::Streamed(s) => &s.prologue,
        }
    }

    /// Quanti byte ha la sorgente, in tutto.
    pub fn len(&self) -> u64 {
        match &self.content {
            SourceContent::Bytes(bytes) => bytes.len() as u64,
            SourceContent::Streamed(s) => s.len,
        }
    }

    /// La sorgente non ha byte.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Tutti i byte, **se sono già qui**. `None` quando la sorgente sta
    /// dall'host: leggerla è una decisione, e la si prende chiamando
    /// [`read_all`](ImportSource::read_all) con un host in mano.
    pub fn bytes(&self) -> Option<&[u8]> {
        match &self.content {
            SourceContent::Bytes(bytes) => Some(bytes),
            SourceContent::Streamed(_) => None,
        }
    }

    /// Tutti i byte, leggendoli se serve.
    ///
    /// È la via d'uscita per chi non sa lavorare a pezzi — un parser che vuole
    /// il documento intero, e sono la maggioranza. Costa la memoria che la
    /// forma a handle esiste per non spendere, e va bene: **poterlo dichiarare
    /// è meglio che non poter fare altro**. Chi la chiama su un archivio da
    /// 4 GiB lo sta facendo apposta, e `len()` glielo aveva detto prima.
    pub fn read_all(&self, host: &dyn TransferRead) -> Result<Vec<u8>, PluginError> {
        let s = match &self.content {
            SourceContent::Bytes(bytes) => return Ok(bytes.clone()),
            SourceContent::Streamed(s) => s,
        };
        let mut out = Vec::with_capacity(s.len.min(READ_ALL_RESERVE) as usize);
        // Una lettura può restituire meno byte di quanti se ne chiedono senza
        // che sia un errore (vedi `read_source`), quindi il ciclo si ferma sul
        // vuoto e non sul conto: fermarsi sul conto vorrebbe dire fidarsi di
        // `len`, che è ciò che l'host ha visto **prima** della chiamata.
        loop {
            let chunk = host.read_source(s.handle, out.len() as u64, READ_CHUNK)?;
            if chunk.is_empty() {
                break;
            }
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    /// L'estensione del nome, minuscola e senza punto.
    ///
    /// Vive qui e non in ogni importer per la stessa ragione per cui ci vive
    /// [`LinkTarget::classify`](crate::model::LinkTarget::classify): due
    /// provider non devono poter rispondere due cose diverse sulla stessa
    /// stringa.
    pub fn extension(&self) -> Option<String> {
        let base = Self::basename(&self.name);
        match base.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => Some(ext.to_lowercase()),
            _ => None,
        }
    }

    /// Il nome ridotto a **un componente solo**, senza estensione: è con questo
    /// che un importer nomina il documento che sta creando.
    ///
    /// Toglie qualunque parte di path (`../../.ssh/config.md` → `config`)
    /// perché il nome di una sorgente arriva da fuori — l'utente, un'entrata di
    /// zip, un campo di un JSON — e un importer che lo usasse com'è scriverebbe
    /// **fuori dal vault**. Il recinto vero resta del kernel (`write_document`
    /// rifiuta le risalite); questo è il modo di non finirci contro per
    /// distrazione. `None` quando non resta niente di nominabile.
    pub fn stem(&self) -> Option<&str> {
        let base = Self::basename(&self.name);
        let stem = match base.rsplit_once('.') {
            Some((stem, _)) if !stem.is_empty() => stem,
            _ => base,
        };
        let stem = stem.trim();
        (!stem.is_empty() && stem != "." && stem != "..").then_some(stem)
    }

    /// I byte come testo, leggendoli se serve. `BadArgs` se non sono UTF-8: un
    /// importer testuale non ha modo di continuare, ed è esattamente il caso in
    /// cui l'errore è la risposta giusta e non una riga di giornale.
    ///
    /// Restituisce una `String` e non un `&str` perché per una sorgente a
    /// handle il testo **nasce qui**: non c'è niente nel record di cui prendere
    /// un prestito. Costa una copia nel caso in memoria, ed è il prezzo per
    /// avere una firma sola invece di due che si sceglierebbero guardando dove
    /// stanno i byte — cioè esattamente la cosa che questo tipo esiste per non
    /// far guardare a chi non gliene importa.
    pub fn text(&self, host: &dyn TransferRead) -> Result<String, PluginError> {
        let bytes = self.read_all(host)?;
        String::from_utf8(bytes).map_err(|e| {
            PluginError::BadArgs(format!("`{}` non è testo UTF-8: {e}", self.name).into())
        })
    }

    /// L'ultimo componente del nome, con entrambi i separatori.
    fn basename(name: &str) -> &str {
        name.rsplit(['/', '\\']).next().unwrap_or(name)
    }
}

/// Importare per davvero, o solo dire cosa succederebbe.
///
/// È la *preview* di 17.3 senza un secondo tipo: in `Preview` un provider fa
/// tutto il lavoro tranne le scritture, e restituisce lo stesso
/// [`ImportReport`]. Vedi il § "Il piano è il rapporto di una prova a vuoto".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Nessuna scrittura: il rapporto dice cosa entrerebbe.
    #[default]
    Preview,
    Apply,
}

/// Cosa fare quando il documento di destinazione esiste già: il *duplicate
/// handling* di 17.3.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    /// Non toccare ciò che c'è. È il default perché è l'unica scelta che non
    /// può distruggere lavoro dell'utente.
    #[default]
    Skip,
    /// Sovrascrivi il documento esistente.
    Replace,
    /// Entra accanto, con un nome libero della stessa famiglia — la
    /// convenzione la decide l'host ([`VaultRead::free_name`]), non l'importer.
    Rename,
}

/// La domanda che accompagna una sorgente: dove atterra, in che modalità, cosa
/// fare dei conflitti.
///
/// È separata da [`ImportSource`] perché la sorgente è **dato** e questa è
/// **intento**: lo stesso file lo si guarda in preview e poi lo si applica, e
/// nel mezzo i byte non cambiano.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ImportRequest {
    pub mode: ImportMode,
    /// La cartella del vault in cui atterrano i documenti; vuota = radice.
    pub folder: String,
    pub on_conflict: ConflictPolicy,
    /// Opzioni del singolo importer (quale foglio del CSV, se scaricare gli
    /// allegati, quale profilo di migrazione). È l'escape hatch JSON del
    /// contratto, come `IndexQuery::Custom` e `UiAction::payload`: qui non
    /// porta namespace perché il provider è già stato scelto, e le opzioni sono
    /// per definizione sue.
    #[serde(default)]
    pub options: serde_json::Value,
}

impl ImportRequest {
    /// Una prova a vuoto nella radice del vault.
    pub fn preview() -> Self {
        ImportRequest::default()
    }

    /// Un import vero nella radice del vault.
    pub fn apply() -> Self {
        ImportRequest {
            mode: ImportMode::Apply,
            ..ImportRequest::default()
        }
    }

    pub fn into_folder(mut self, folder: impl Into<String>) -> Self {
        self.folder = folder.into();
        self
    }

    pub fn on_conflict(mut self, policy: ConflictPolicy) -> Self {
        self.on_conflict = policy;
        self
    }

    /// Il `DocId` di destinazione per un nome di documento, dentro la cartella
    /// chiesta. Il nome è già un componente solo (vedi [`ImportSource::stem`]).
    pub fn destination(&self, name: &str) -> DocId {
        let folder = self.folder.trim_matches('/');
        if folder.is_empty() {
            DocId::new(name)
        } else {
            DocId::new(format!("{folder}/{name}"))
        }
    }
}

/// Che fine ha fatto (o farebbe, in preview) un documento.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ImportOutcome {
    Created,
    /// Esisteva e la politica dei conflitti dice di sostituirlo.
    Replaced,
    /// Esisteva e non è stato toccato.
    Skipped,
    /// Non è entrato: il perché, leggibile. Un import può riuscire con dei
    /// falliti dentro — vedi il § "Errori e rapporto".
    Failed(String),
}

/// Un documento e la sua sorte, dentro un [`ImportReport`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportedDocument {
    /// Dove è (o sarebbe) finito nel vault.
    pub doc: DocId,
    pub outcome: ImportOutcome,
    /// Da quale entrata della sorgente viene: il nome dentro lo zip, la riga
    /// del CSV. Senza, un rapporto non si riconduce all'originale.
    pub entry: Option<String>,
}

/// L'esito di un import: cosa è entrato, cosa c'è da sapere, in che modalità.
///
/// Non porta un conteggio: `documents.len()` lo è già, e due verità sullo
/// stesso numero divergono. Non porta un identificatore di lotto: il rollback è
/// della decisione 0011, e un campo che nessuno consuma è peggio di un campo assente.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    /// Con quale modalità è stato prodotto: un rapporto di preview e uno di
    /// applicazione si distinguono guardando il rapporto.
    pub mode: ImportMode,
    pub documents: Vec<ImportedDocument>,
    pub log: Vec<TransferNote>,
}

impl ImportReport {
    pub fn new(mode: ImportMode) -> Self {
        ImportReport {
            mode,
            documents: Vec::new(),
            log: Vec::new(),
        }
    }

    /// I documenti che sono davvero cambiati nel vault (o cambierebbero): è
    /// l'insieme su cui un giorno lavorerà il rollback della decisione 0011.
    pub fn changed(&self) -> Vec<&DocId> {
        self.documents
            .iter()
            .filter(|d| matches!(d.outcome, ImportOutcome::Created | ImportOutcome::Replaced))
            .map(|d| &d.doc)
            .collect()
    }
}

/// Un provider che sa far **entrare** dati nel vault.
///
/// # Perché `&mut self`
///
/// Un import è l'unica operazione del contratto che può durare più di una
/// chiamata: 17.3 chiede *resume* e *retry*, e un provider che riprende ha
/// bisogno di ricordare dove era. Con `&self` quella famiglia sarebbe chiusa
/// dalla firma, che è esattamente il difetto che il piano imputa a
/// `ViewProvider` (§2.4). Costa oggi un `mem::take` nel kernel; dopo il freeze
/// costerebbe una major.
pub trait ImportProvider: Send + Sync {
    /// Questa sorgente è roba mia?
    ///
    /// È il dispatch: il kernel interpella i provider registrati **in ordine** e
    /// il primo che dice di sì la prende. Un `false` non è un errore — è
    /// l'unico modo che un provider ha di lasciar passare il turno.
    fn can_handle(&self, source: &ImportSource) -> bool;

    /// Fa entrare la sorgente nel vault (o dice cosa entrerebbe, se
    /// `request.mode` è [`ImportMode::Preview`]).
    ///
    /// Le scritture passano da [`VaultWrite::write_document`]: un importer non
    /// tocca il filesystem e non conosce la radice del vault.
    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Una destinazione offerta da un [`ExportProvider`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportTarget {
    /// Id stabile col prefisso di chi lo offre (`markdown.files`): è ciò che
    /// una richiesta nomina, e la regola sugli spazi di nomi è del §7.4.
    pub id: String,
    /// Nome leggibile, per un menù.
    pub name: String,
    /// L'estensione dell'artefatto quando l'esito è **un file solo** (`pdf`,
    /// `zip`, `md`); `None` quando è un albero di file (una cartella markdown,
    /// un sito statico).
    ///
    /// Un campo solo per due domande, ed è voluto: chi apre il dialogo di
    /// sistema deve sapere *prima* di eseguire se chiedere un file o una
    /// cartella, e con due campi indipendenti si potrebbero dichiarare
    /// combinazioni che non esistono.
    pub extension: Option<String>,
}

/// Cosa esportare.
///
/// I tre casi sono le tre domande di 17.2 — «note selezionate», «cartella»,
/// «vault completo» (che è [`ExportSelection::Folder`] della radice) e «query
/// results». L'ultimo non è un lusso: senza, esportare il risultato di una
/// ricerca vuol dire che *l'app* materializza la lista e la passa, cioè che un
/// plugin non potrebbe fare la stessa cosa.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ExportSelection {
    /// Documenti nominati uno per uno.
    Documents(Vec<DocId>),
    /// Una cartella e tutte le sue discendenti; `""` è la radice, cioè il vault
    /// intero. Stessa regola di appartenenza di
    /// [`QueryPredicate::Folder`](crate::query::QueryPredicate::Folder).
    Folder(String),
    /// L'esito di un'interrogazione dell'indice (decisione 0005).
    Query(IndexQuery),
}

impl Default for ExportSelection {
    /// Il vault intero: è la selezione che non ha bisogno di argomenti.
    fn default() -> Self {
        ExportSelection::Folder(String::new())
    }
}

impl ExportSelection {
    /// Risolve la selezione in documenti, con le sole capacità del contratto.
    ///
    /// Sta **qui** e non dentro ogni exporter per la stessa ragione per cui ci
    /// sta `heading_slug` (decisione 0003): la risposta a «cosa c'è in questa cartella»
    /// deve essere una sola. I documenti tornano in ordine e senza ripetizioni.
    ///
    /// Una query che non nomina documenti (l'outline di *un* documento, i tag
    /// del vault, una `Custom` di terzi) è `BadArgs`: non è una selezione
    /// vuota, è una domanda che non seleziona.
    pub fn resolve(&self, host: &dyn ReadApi) -> Result<Vec<DocId>, PluginError> {
        let mut docs = match self {
            ExportSelection::Documents(ids) => ids.clone(),
            ExportSelection::Folder(folder) => host
                .list_documents(None)?
                .items
                .into_iter()
                .filter(|doc| in_folder(doc, folder))
                .collect(),
            ExportSelection::Query(query) => match host.query_index(query.clone())? {
                IndexResult::Backlinks(p) => p.items.into_iter().map(|b| b.source).collect(),
                IndexResult::Documents(p) => p.items.into_iter().map(|d| d.doc).collect(),
                IndexResult::Neighbors(p) => p.items.into_iter().map(|n| n.doc).collect(),
                IndexResult::VaultHealth(p) => p.items.into_iter().map(|i| i.doc).collect(),
                other => {
                    return Err(PluginError::BadArgs(
                        format!("questa interrogazione non nomina documenti: {other:?}").into(),
                    ))
                }
            },
        };
        docs.sort();
        docs.dedup();
        Ok(docs)
    }
}

/// Il documento sta in questa cartella o in una sua discendente? Cartella vuota
/// = tutto il vault.
fn in_folder(doc: &DocId, folder: &str) -> bool {
    let folder = folder.trim_matches('/');
    folder.is_empty()
        || doc
            .as_str()
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// La domanda a un [`ExportProvider`]: cosa, verso dove, con quali opzioni.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ExportRequest {
    pub selection: ExportSelection,
    /// L'id di una delle destinazioni di [`ExportProvider::targets`].
    pub target: String,
    /// Opzioni della destinazione: tema, con o senza metadati, con o senza
    /// allegati (17.2 chiede letteralmente tutte e tre). Stesso escape hatch di
    /// [`ImportRequest::options`].
    #[serde(default)]
    pub options: serde_json::Value,
}

impl ExportRequest {
    pub fn new(target: impl Into<String>, selection: ExportSelection) -> Self {
        ExportRequest {
            selection,
            target: target.into(),
            options: serde_json::Value::Null,
        }
    }

    pub fn with_options(mut self, options: serde_json::Value) -> Self {
        self.options = options;
        self
    }

    /// Un'opzione booleana della destinazione, col valore di default se
    /// assente: le opzioni sono JSON libero, e leggerlo a mano in ogni provider
    /// è il modo di farlo in tre modi diversi.
    pub fn flag(&self, key: &str, default: bool) -> bool {
        self.options
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(default)
    }
}

/// La chiave di un artefatto **aperto**: la si riceve da
/// [`ArtifactSink::open_artifact`] e la si spende versando byte.
///
/// Stessa opacità e stessa ragione di [`SourceHandle`], nel verso opposto: un
/// provider non può nominare un artefatto che non ha aperto, quindi non c'è un
/// path da controllare — c'è un handle che l'host ha timbrato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ArtifactHandle(pub u64);

impl Serialize for ArtifactHandle {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for ArtifactHandle {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        crate::ipc::u64_string::deserialize(d).map(ArtifactHandle)
    }
}

/// Dove stanno i byte di un artefatto prodotto.
///
/// Il gemello di [`SourceContent`], e non per simmetria estetica: un export di
/// tutto il vault in PDF produceva un `Vec<ExportArtifact>` con dentro l'intero
/// vault reso, che è il verso peggiore dello stesso difetto — all'import la
/// cosa grande la sceglie l'utente, all'export la produci tu.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ArtifactContent {
    /// I byte, nel rapporto. Il caso comune e quello dei test: tre note
    /// esportate stanno in memoria e discuterne sarebbe cerimonia.
    Bytes(Vec<u8>),
    /// Già versato attraverso un [`ArtifactSink`]: quanti byte sono passati.
    ///
    /// Questo caso è una **ricevuta**, non una promessa, ed è per questo che
    /// non lo si costruisce a mano: lo restituisce
    /// [`ArtifactSink::close_artifact`], che il conto lo ha visto passare. Un
    /// campo che chi scrive il provider potesse riempire da sé sarebbe un conto
    /// che può mentire.
    Delivered(u64),
}

impl Default for ArtifactContent {
    fn default() -> Self {
        ArtifactContent::Bytes(Vec::new())
    }
}

/// Un pezzo dell'esito di un export.
///
/// Byte, non un file: chi li posa sul disco (o dentro uno zip, o su una rete) è
/// l'host. Vedi il § "Il confine è di byte, non di path".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportArtifact {
    /// Path relativo **dentro l'esito**: per un esito a un file solo è il suo
    /// nome, per un albero è il posto che occupa nell'albero.
    pub path: String,
    pub media_type: String,
    pub content: ArtifactContent,
}

impl ExportArtifact {
    /// Un artefatto che sta in memoria.
    pub fn bytes(
        path: impl Into<String>,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Self {
        ExportArtifact {
            path: path.into(),
            media_type: media_type.into(),
            content: ArtifactContent::Bytes(bytes.into()),
        }
    }

    /// I byte, **se sono qui**. `None` quando l'artefatto è già stato versato:
    /// non è un rapporto incompleto, è che i byte sono dove l'utente li voleva.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match &self.content {
            ArtifactContent::Bytes(bytes) => Some(bytes),
            ArtifactContent::Delivered(_) => None,
        }
    }

    /// Quanti byte ha l'artefatto, comunque sia stato prodotto.
    pub fn len(&self) -> u64 {
        match &self.content {
            ArtifactContent::Bytes(bytes) => bytes.len() as u64,
            ArtifactContent::Delivered(len) => *len,
        }
    }

    /// L'artefatto non ha byte.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Dove un [`ExportProvider`] versa un artefatto **mentre lo produce**.
///
/// # Perché non sta sull'host
///
/// Tutte le altre capacità di questo contratto stanno su [`HostApi`] o su
/// [`ReadApi`], e questa no. Non è un'eccezione per comodità, sono due ragioni
/// che puntano nello stesso verso:
///
/// - un export gira sotto prestito **condiviso** del workspace (`&self`, vedi
///   [`ExportProvider`]), e mettere una scrittura dentro [`ReadApi`] la
///   regalerebbe a chi disegna una view e a chi interroga l'indice, cioè a
///   tutti quelli per cui `ReadApi` esiste per **non** averla;
/// - non c'è niente da concedere. Un sink non è una capacità che si presta per
///   sempre: esiste per la durata di **un** export che l'utente ha chiesto, e
///   verso una destinazione che l'utente ha appena scelto in un dialogo. Il
///   rifiuto è non chiamare `export`, che è già come funziona.
///
/// Al confine WASM diventa un'interfaccia importata dal world come le altre, e
/// lì la differenza si vede meno: è il prezzo di un confine in cui ogni
/// capacità arriva dallo stesso posto. Sta scritto nel verbale.
pub trait ArtifactSink: Send {
    /// Apre un artefatto e restituisce dove versarlo.
    ///
    /// `path` è relativo **dentro l'esito**, come
    /// [`ExportArtifact::path`], e l'host lo tratta come tale: una risalita è
    /// `PermissionDenied` qui e non un file scritto altrove, per la stessa
    /// ragione per cui `write_document` rifiuta le risalite di un nome nato da
    /// una sorgente.
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError>;

    /// Versa dei byte. Si può chiamare quante volte si vuole prima di chiudere,
    /// ed è tutto il punto: un PDF da un gigabyte esce a pezzi.
    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError>;

    /// Chiude l'artefatto e restituisce la sua **ricevuta**, da mettere nel
    /// rapporto.
    ///
    /// Che la ricevuta esca da qui e non la scriva il provider è ciò che rende
    /// il conto di [`ArtifactContent::Delivered`] non falsificabile per
    /// distrazione: chi lo emette è chi ha contato i byte mentre passavano.
    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError>;
}

/// L'esito di un export.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportReport {
    pub artifacts: Vec<ExportArtifact>,
    /// Ciò che è andato storto senza far fallire l'export: un documento sparito
    /// fra la selezione e la lettura, un allegato che non c'è.
    pub log: Vec<TransferNote>,
}

/// Un provider che sa far **uscire** dati dal vault.
///
/// # Perché `&self` (e un host in sola lettura)
///
/// Un export è una **lettura**: nessuna delle ~45 voci di 17.2 scrive nel
/// vault. Dichiararlo nella firma non è pignoleria — è ciò che permette al
/// kernel di servirlo sotto prestito **condiviso** del workspace, come
/// `render_view` e `IndexProvider::query`, cioè senza mettere in coda dietro un
/// export lungo tutte le letture dell'app. È la stessa ragione per cui
/// `HostQuery::query_index` prende `&self`.
pub trait ExportProvider: Send + Sync {
    /// Le destinazioni offerte. Elenco statico: quali *documenti* si esportino
    /// lo dice la richiesta, non il provider.
    fn targets(&self) -> Vec<ExportTarget>;

    /// Produce gli artefatti. `BadArgs` se la destinazione non è fra quelle di
    /// [`targets`](ExportProvider::targets).
    ///
    /// `out` è dove versare ciò che non conviene tenere in mano: chi produce
    /// tre note lo ignora e riempie [`ExportReport::artifacts`] con
    /// [`ArtifactContent::Bytes`], chi rende un vault intero apre un artefatto e
    /// ci versa dentro mentre lo produce. Le due strade finiscono nello stesso
    /// rapporto, e chi lo legge non deve sapere quale è stata presa.
    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_name_never_becomes_a_path() {
        let escape = ImportSource::text_source("../../.ssh/config.md", "x");
        assert_eq!(
            escape.stem(),
            Some("config"),
            "il nome di una sorgente viene da fuori: un importer che lo usasse \
             com'è scriverebbe fuori dal vault"
        );
        assert_eq!(escape.extension().as_deref(), Some("md"));

        let windows = ImportSource::text_source(r"C:\Users\x\Nota.MD", "x");
        assert_eq!(windows.stem(), Some("Nota"));
        assert_eq!(
            windows.extension().as_deref(),
            Some("md"),
            "l'estensione è minuscola: il dispatch non deve dipendere dal caso"
        );

        assert_eq!(ImportSource::text_source("..", "x").stem(), None);
        assert_eq!(ImportSource::text_source("/", "x").stem(), None);
        assert_eq!(ImportSource::text_source("   ", "x").stem(), None);
        assert_eq!(
            ImportSource::text_source(".gitignore", "x").stem(),
            Some(".gitignore"),
            "un dotfile non ha estensione: il punto è parte del nome"
        );
        assert_eq!(
            ImportSource::text_source(".gitignore", "x").extension(),
            None
        );
    }

    #[test]
    fn a_destination_lives_under_the_folder_that_was_asked_for() {
        let root = ImportRequest::apply();
        assert_eq!(root.destination("Nota.md"), DocId::new("Nota.md"));

        let nested = ImportRequest::apply().into_folder("/Importati/2026/");
        assert_eq!(
            nested.destination("Nota.md"),
            DocId::new("Importati/2026/Nota.md"),
            "gli slash di cortesia non diventano componenti vuote"
        );
    }

    #[test]
    fn a_folder_selection_takes_the_descendants_and_not_the_namesakes() {
        assert!(in_folder(&DocId::new("a.md"), ""), "vuota = tutto il vault");
        assert!(in_folder(&DocId::new("x/y/a.md"), "x"));
        assert!(in_folder(&DocId::new("x/y/a.md"), "x/y"));
        assert!(!in_folder(&DocId::new("x.md"), "x"));
        assert!(
            !in_folder(&DocId::new("xy/a.md"), "x"),
            "`xy` non è dentro `x`: il confronto è per componente, non per prefisso"
        );
        assert!(in_folder(&DocId::new("x/a.md"), "/x/"));
    }

    /// Un host che serve **una** sorgente e conta quanti byte per volta gli
    /// vengono chiesti, per poter dire se qualcuno ha letto tutto.
    struct FintoHost {
        bytes: Vec<u8>,
        /// Il tetto di una singola lettura: qui piccolo di proposito, perché è
        /// la condizione in cui un ciclo scritto male si ferma a metà.
        tetto: usize,
    }

    impl TransferRead for FintoHost {
        fn read_source(
            &self,
            _handle: SourceHandle,
            offset: u64,
            len: u32,
        ) -> Result<Vec<u8>, PluginError> {
            let da = (offset.min(self.bytes.len() as u64)) as usize;
            let quanti = (len as usize).min(self.tetto);
            let a = da.saturating_add(quanti).min(self.bytes.len());
            Ok(self.bytes[da..a].to_vec())
        }
    }

    fn a_pezzi(bytes: &[u8], prologo: usize) -> ImportSource {
        ImportSource {
            name: "grande.zip".to_string(),
            media_type: None,
            content: SourceContent::Streamed(StreamedSource {
                handle: SourceHandle(1),
                len: bytes.len() as u64,
                prologue: bytes[..bytes.len().min(prologo)].to_vec(),
            }),
        }
    }

    #[test]
    fn a_non_utf8_source_is_an_error_and_not_a_log_line() {
        let bin = ImportSource::from_bytes("immagine.png", vec![0xff, 0xfe, 0x00]);
        let host = FintoHost {
            bytes: Vec::new(),
            tetto: 8,
        };
        assert!(matches!(bin.text(&host), Err(PluginError::BadArgs(_))));
    }

    #[test]
    fn leggere_tutto_non_si_ferma_al_primo_pezzo_corto() {
        let bytes: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let source = a_pezzi(&bytes, 16);
        let host = FintoHost {
            bytes: bytes.clone(),
            // Sette byte per volta: se il ciclo si fidasse di una lettura sola,
            // o si fermasse sul conto di `len` invece che sul vuoto, qui
            // sparirebbero 993 byte in silenzio.
            tetto: 7,
        };
        assert_eq!(
            source.read_all(&host).unwrap(),
            bytes,
            "una lettura può dare meno di quanto le si chiede, e leggere tutto \
             vuol dire chiedere finché non risponde vuoto"
        );
    }

    #[test]
    fn il_dispatch_guarda_l_assaggio_e_non_ha_bisogno_di_un_host() {
        let bytes = b"PK\x03\x04resto lunghissimo che nessuno deve leggere".to_vec();
        let source = a_pezzi(&bytes, 4);
        // `can_handle` non riceve un host: se il prologo non fosse nel record,
        // qui non ci sarebbe niente da guardare e un dispatch potrebbe solo
        // fidarsi del nome — che è ciò che la 0006 dichiara insufficiente.
        assert_eq!(source.prologue(), b"PK\x03\x04");
        assert_eq!(
            source.len(),
            bytes.len() as u64,
            "la lunghezza è quella vera"
        );
        assert!(
            source.bytes().is_none(),
            "i byte non sono nel record: chiederli senza un host deve dire di no \
             invece di restituire l'assaggio come se fosse tutto"
        );
    }

    #[test]
    fn una_sorgente_in_memoria_risponde_alle_stesse_domande() {
        let source = ImportSource::text_source("nota.md", "# Ciao\n");
        let host = FintoHost {
            bytes: Vec::new(),
            tetto: 1,
        };
        assert_eq!(source.prologue(), b"# Ciao\n");
        assert_eq!(source.len(), 7);
        assert_eq!(source.bytes(), Some(&b"# Ciao\n"[..]));
        assert_eq!(
            source.text(&host).unwrap(),
            "# Ciao\n",
            "chi ha i byte in mano non deve passare dall'host per leggerli: \
             l'host qui non ha niente da dare, e la lettura riesce lo stesso"
        );
    }

    #[test]
    fn una_ricevuta_e_i_byte_dicono_la_stessa_lunghezza() {
        let in_memoria = ExportArtifact::bytes("a.md", "text/markdown", b"12345".to_vec());
        let versato = ExportArtifact {
            path: "a.md".into(),
            media_type: "text/markdown".into(),
            content: ArtifactContent::Delivered(5),
        };
        assert_eq!(in_memoria.len(), versato.len());
        assert!(!in_memoria.is_empty() && !versato.is_empty());
    }

    #[test]
    fn a_report_names_what_a_rollback_would_need() {
        let mut report = ImportReport::new(ImportMode::Apply);
        report.documents = vec![
            ImportedDocument {
                doc: DocId::new("a.md"),
                outcome: ImportOutcome::Created,
                entry: None,
            },
            ImportedDocument {
                doc: DocId::new("b.md"),
                outcome: ImportOutcome::Skipped,
                entry: None,
            },
            ImportedDocument {
                doc: DocId::new("c.md"),
                outcome: ImportOutcome::Failed("illeggibile".into()),
                entry: None,
            },
            ImportedDocument {
                doc: DocId::new("d.md"),
                outcome: ImportOutcome::Replaced,
                entry: None,
            },
        ];
        assert_eq!(
            report.changed(),
            vec![&DocId::new("a.md"), &DocId::new("d.md")],
            "saltato e fallito non hanno toccato il vault: annullarli sarebbe \
             cancellare roba di qualcun altro"
        );
    }
}
