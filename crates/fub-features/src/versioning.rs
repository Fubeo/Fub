//! Versioning del vault: snapshot per-file, tombstone, ripristino.
//!
//! È **dogfooding del contratto**, e stavolta fino in fondo: il campionatore è
//! un [`EventHandler`](fub_abi::traits::EventHandler) e lo store scrive
//! esclusivamente attraverso l'[`HostApi`](fub_abi::traits::HostApi) — niente
//! `std::fs`, niente orologio di sistema, nessuna idea di dove sia il vault.
//! Sono gli stessi strumenti che avrà un plugin di terzi a M5.
//!
//! # Cosa ha trovato il dogfooding
//!
//! Nella sua prima versione lo store si scriveva una `versions/` propria sotto
//! la radice dei derivati con
//! `std::fs` e leggeva l'ora da `fub_kernel::time`: funzionava benissimo *da
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
//! (`.fub/data/plugins/fub.versioning/`):
//!
//! ```text
//! versions.json                    indice: doc_id → versioni + tombstone
//! <dir>/meta.json                  { doc_id, deleted_at }
//! <dir>/<ts>.md                    il contenuto di una versione
//! ```
//!
//! Quello spazio sta sotto la radice dei **derivati**, e gli snapshot non lo
//! sono: buttarli non costa una ricostruzione, costa la memoria di com'erano i
//! file. È il difetto che la
//! [0048](../../../docs/decisions/0048-una-radice-sola.md) nomina e non chiude —
//! la seconda radice per plugin è additiva e arriva dopo M3 —, e questo store è
//! il primo che ci si sposterà.
//!
//! `versions.json` è **derivato**: se manca, non si legge o non torna, si
//! ricostruisce leggendo lo store (ogni cartella dice di chi è, ogni file dice
//! quando). Mai il contrario — stessa filosofia del manifest dell'indice di
//! ricerca. Per questo il `doc_id` vive anche dentro la cartella: senza, un
//! indice perso renderebbe le versioni irraggiungibili, visto che il nome della
//! cartella è un'impronta e le impronte non si invertono.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::WriteBase;
use fub_abi::event::{Event, EventKind, EventMask, Notice, Severity};
use fub_abi::model::DocId;
use fub_abi::schema::SchemaVersion;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, EntryKind, EventHandler, HostApi, IndexQuery, IndexResult, ReadApi,
    ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

/// Identità del versioning come plugin: è lo spazio dello storage persistente
/// che l'host gli concede. Lo assegna chi registra l'handler — non la feature.
pub const VERSIONING_ID: &str = "fub.versioning";

/// Versione del formato dello store. Da incrementare se cambia la struttura
/// su disco: un indice di un'altra epoca si butta e si ricostruisce.
/// Le chiavi delle stringhe che il versioning scrive a un umano. Sono **tutte**
/// messaggi d'errore, ed è la conseguenza diretta della
/// [decisione 0041](../../../docs/decisions/0041-un-errore-e-testo-che-qualcuno-legge.md):
/// un componente senza pannelli non ha prosa da mostrare finché non va storto
/// qualcosa, e allora ne ha soltanto quella. I punti in cui qualcosa va storto
/// durante il lavoro del versioning non stanno più su `stderr`: ognuno lascia
/// una riga di `tracing`, e quelli che raccontano una perdita di una versione
/// aprono anche il canale degli eventi (`Event::Trouble`, decisione 0062) —
/// perché una versione persa è una cosa che chi scrive ha il diritto di sapere,
/// e non una diagnosi per chi sviluppa.
const NO_VERSIONS: &str = "no_versions";
const NO_SUCH_VERSION: &str = "no_such_version";
const CONTENT_GONE: &str = "content_gone";
const UNREADABLE: &str = "unreadable";
const META_UNWRITABLE: &str = "meta_unwritable";
const INDEX_UNWRITABLE: &str = "index_unwritable";
/// Una versione attesa non è stata salvata: il versioning non ha potuto
/// fotografare il documento. È un guasto `Failure` (0052): una versione è la
/// rete di sicurezza di chi scrive, e perderla vuol dire perdere la possibilità
/// di tornare a quel punto.
const VERSION_UNSAVED: &str = "version_unsaved";
/// Il tombstone di un documento non è stato scritto: la sua storia resta viva
/// quando dovrebbe essere chiusa. `Failure` (0052).
const TOMBSTONE_UNWRITABLE: &str = "tombstone_unwritable";
/// Le stringhe del **pannello cronologia** e del comando che ripristina. Sono
/// l'eccezione al capoverso qui sopra — da quando questa feature ha una view,
/// non è più vero che la sua unica prosa siano gli errori.
const VIEW_TITLE: &str = "view_title";
const NO_ACTIVE_DOC: &str = "no_active_doc";
const EMPTY: &str = "empty";
const COUNT: &str = "count";
const CURRENT: &str = "current";
const SIZE: &str = "size";
const RESTORE_LABEL: &str = "restore";
const CLOSE_PREVIEW: &str = "close_preview";
const RESTORE_TITLE: &str = "version.restore.title";
const RESTORE_DESC: &str = "version.restore.desc";
const RESTORE_DOC_TITLE: &str = "version.restore.doc.title";
const RESTORE_DOC_DESC: &str = "version.restore.doc.desc";
const RESTORE_TS_TITLE: &str = "version.restore.ts.title";
const RESTORE_TS_DESC: &str = "version.restore.ts.desc";
const PLAN_RESTORE: &str = "plan.restore";
const DONE_RESTORE: &str = "done.restore";
const UNDO_RESTORE: &str = "undo.restore";
const E_NO_NOTE_GIVEN: &str = "err.no_note_given";
const E_NO_TS_GIVEN: &str = "err.no_ts_given";

/// I nomi degli argomenti.
const DOC: &str = "doc";
const WHEN: &str = "when";
const PATH: &str = "path";
const REASON: &str = "reason";

/// Le stringhe del versioning. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
///
/// Le etichette del suo **interruttore** non stanno qui: le dichiara chi
/// dichiara lo schema (`fub_host::settings::versioning_settings`), e il suo
/// catalogo arriva al montaggio accanto a questo, come secondo catalogo della
/// stessa lingua.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(NO_VERSIONS, "Nessuna versione di {doc}.")
            .with(NO_SUCH_VERSION, "La versione del {when} di {doc} non c'è.")
            .with(CONTENT_GONE, "Il contenuto di {path} è sparito.")
            .with(UNREADABLE, "{path} non si legge: {reason}")
            .with(
                META_UNWRITABLE,
                "Non riesco a scrivere i metadati delle versioni: {reason}",
            )
            .with(
                INDEX_UNWRITABLE,
                "Non riesco a scrivere l'indice delle versioni: {reason}",
            )
            .with(VERSION_UNSAVED, "Versione di {doc} non salvata: {reason}")
            .with(
                TOMBSTONE_UNWRITABLE,
                "Tombstone di {doc} non scritto: {reason}",
            )
            .with(VIEW_TITLE, "Cronologia")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessuna versione.")
            .with(COUNT, "Versioni: {count}")
            .with(CURRENT, "adesso")
            .with(SIZE, "{size} byte")
            .with(RESTORE_LABEL, "Ripristina")
            .with(CLOSE_PREVIEW, "Chiudi l'anteprima")
            .with(RESTORE_TITLE, "Ripristina una versione")
            .with(
                RESTORE_DESC,
                "Riscrive la nota com'era in quell'istante. Il ripristino è a \
                 sua volta una versione: si torna indietro anche da lui.",
            )
            .with(RESTORE_DOC_TITLE, "Nota")
            .with(RESTORE_DOC_DESC, "La nota da riportare indietro.")
            .with(RESTORE_TS_TITLE, "Istante")
            .with(
                RESTORE_TS_DESC,
                "L'istante della versione, in millisecondi UNIX.",
            )
            .with(PLAN_RESTORE, "Riporta {doc} alla versione del {when}")
            .with(DONE_RESTORE, "{doc} riportata alla versione del {when}")
            .with(UNDO_RESTORE, "Rimetti {doc} com'era prima del ripristino")
            .with(E_NO_NOTE_GIVEN, "Nessuna nota da ripristinare.")
            .with(E_NO_TS_GIVEN, "Nessun istante da ripristinare."),
        StringCatalog::new("en")
            .with(NO_VERSIONS, "No version of {doc}.")
            .with(NO_SUCH_VERSION, "There is no version of {doc} from {when}.")
            .with(CONTENT_GONE, "The content of {path} is gone.")
            .with(UNREADABLE, "{path} cannot be read: {reason}")
            .with(
                META_UNWRITABLE,
                "Cannot write the versions metadata: {reason}",
            )
            .with(
                INDEX_UNWRITABLE,
                "Cannot write the versions index: {reason}",
            )
            .with(VERSION_UNSAVED, "Version of {doc} not saved: {reason}")
            .with(
                TOMBSTONE_UNWRITABLE,
                "Tombstone of {doc} not written: {reason}",
            )
            .with(VIEW_TITLE, "History")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(EMPTY, "No versions.")
            .with(COUNT, "Versions: {count}")
            .with(CURRENT, "now")
            .with(SIZE, "{size} bytes")
            .with(RESTORE_LABEL, "Restore")
            .with(CLOSE_PREVIEW, "Close the preview")
            .with(RESTORE_TITLE, "Restore a version")
            .with(
                RESTORE_DESC,
                "Rewrites the note as it was at that instant. The restore is \
                 itself a version: you can come back from it too.",
            )
            .with(RESTORE_DOC_TITLE, "Note")
            .with(RESTORE_DOC_DESC, "The note to take back in time.")
            .with(RESTORE_TS_TITLE, "Instant")
            .with(
                RESTORE_TS_DESC,
                "The version instant, in UNIX milliseconds.",
            )
            .with(PLAN_RESTORE, "Take {doc} back to the version from {when}")
            .with(DONE_RESTORE, "{doc} taken back to the version from {when}")
            .with(UNDO_RESTORE, "Put {doc} back as it was before the restore")
            .with(E_NO_NOTE_GIVEN, "No note to restore.")
            .with(E_NO_TS_GIVEN, "No instant to restore."),
    ]
}

const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

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
    /// silenzio — la regola è in `fub_abi::ipc`. In lettura il numero nudo
    /// resta accettato: gli indici persistiti prima della regola non si
    /// buttano.
    #[serde(with = "fub_abi::ipc::u64_string")]
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

/// L'indice **come si legge**: possiede i suoi documenti, perché chi lo legge
/// se li tiene.
#[derive(Deserialize)]
struct Index {
    schema_version: SchemaVersion,
    docs: BTreeMap<String, DocVersions>,
}

/// L'indice **come si scrive**: presta i documenti a chi li ha già.
///
/// Sono due tipi e non uno perché le due direzioni non hanno lo stesso
/// bisogno. Serializzando dall'[`Index`] posseduto, ogni scrittura cominciava
/// con un `docs.clone()` — una `BTreeMap` intera copiata, tutte le `String` e
/// tutti i `Vec`, per poi buttarla subito dopo. Il formato su disco è lo stesso
/// campo per campo: `#[serde(rename)]` non serve, perché i nomi dei campi
/// coincidono già.
#[derive(Serialize)]
struct IndexDaScrivere<'a> {
    schema_version: SchemaVersion,
    docs: &'a BTreeMap<String, DocVersions>,
}

/// Ciò che una cartella dello store dice di sé. Basta a ricostruire l'indice.
#[derive(Serialize, Deserialize)]
struct Meta {
    doc_id: String,
    deleted_at: Option<u64>,
}

/// Che cosa una cartella dello store **rivendica**, e i due modi diversi in cui
/// può non dirlo.
///
/// I due modi sono un tipo e non un `Option` perché non vogliono dire la stessa
/// cosa e nessun chiamante li tratta allo stesso modo: una cartella senza
/// `meta.json` non è di nessuno, una col `meta.json` illeggibile è di qualcuno
/// che non sappiamo nominare. Schiacciarli su `None` — un `.ok()` — faceva dire
/// a [`Inner::dir_per`] «libera» di una cartella piena, e a quel punto la prima
/// [`scrivi_meta`] ci scriveva sopra il nome di un altro documento.
enum Rivendicazione {
    /// Nessun `meta.json`: la cartella non è di nessuno.
    Nessuna,
    /// Un `meta.json` c'è e non si legge. **Non** è una cartella libera.
    Illeggibile,
    /// La cartella dice di chi è.
    Di(Meta),
}

struct Inner {
    docs: BTreeMap<String, DocVersions>,
    /// C'è un lotto aperto ([`VersionStore::in_lotto`])?
    ///
    /// Dentro un lotto [`Inner::applica`] scrive il `meta.json` — che è
    /// l'autorità — e **non** l'indice, che è il derivato e si compone in fondo
    /// una volta sola. Il flag sta qui e non nel chiamante perché la regola
    /// deve valere per **ogni** strada che passa da `applica`: chi domani
    /// aggiungesse un `VersionStore::qualcosa` chiamato dentro una passata la
    /// eredita senza saperlo, e un lotto che valesse solo per `snapshot`
    /// riscriverebbe di nuovo l'indice a ogni tombstone della riconciliazione.
    lotto: bool,
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
    /// **Il prestito attraversa il disco nelle scritture, e non nelle letture**,
    /// e la riga fra le due non è dove sta l'I/O: è cosa succede se qualcuno
    /// entra in mezzo.
    ///
    /// [`Inner::applica`] costruisce il piano da ciò che `docs` dice *adesso* e
    /// lo installa solo se il disco l'ha accettato: mollare il prestito in
    /// mezzo darebbe a due salvataggi la stessa base, e il secondo cancellerebbe
    /// il primo senza che nessuno dei due se ne accorga. Là il prestito che
    /// attraversa il `data_write` **è** l'atomicità, non un difetto, e togliere
    /// l'I/O da sotto sposterebbe una riga di questo `todo.md` da una famiglia a
    /// un'altra.
    ///
    /// In lettura no: quello che serve è il path, e [`Inner::percorso`] lo
    /// consegna con la guardia già finita. Vedi [`VersionStore::read`].
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
                    tracing::info!(
                        target: "fub.versioning",
                        "indice assente o illeggibile, ricostruito dallo store \
                         ({} document{})",
                        ricostruito.len(),
                        if ricostruito.len() == 1 { "o" } else { "i" }
                    );
                }
                ricostruito
            }
        };
        Ok(VersionStore {
            inner: Arc::new(Mutex::new(Inner { docs, lotto: false })),
        })
    }

    /// Una passata su **molti** documenti, con l'indice scritto una volta sola.
    ///
    /// # Perché esiste
    ///
    /// `versions.json` è un file solo che nomina tutti i documenti, quindi
    /// scriverlo costa O(N) byte *sempre*, anche per una versione sola. Fuori da
    /// una passata quel costo è il prezzo onesto di un indice; dentro una
    /// passata su N note diventa N indici di taglia crescente — **O(N²) byte**,
    /// e su 2 000 note misurate erano 267 MB scritti per un indice finale da
    /// 267 KB. Non è una costante da limare: è la classe sbagliata.
    ///
    /// # Perché non è un baratto fra velocità e durabilità
    ///
    /// L'indice si **toglie** prima di cominciare, invece di lasciarlo lì
    /// vecchio. È la differenza fra le due forme, ed è tutta la differenza:
    ///
    /// - un indice **vecchio** dopo un crash è un derivato che si crede la
    ///   verità, e le fotografie della passata interrotta — blob e `meta.json`
    ///   già sul disco — resterebbero senza nessuno che le nomina, per sempre;
    /// - un indice **assente** è esattamente la condizione che
    ///   [`VersionStore::open`] sa gestire da sempre: ricostruisce dallo store,
    ///   dove ogni cartella dice di chi è e ogni file dice quando. Non si perde
    ///   niente.
    ///
    /// Il verso della durabilità quindi non peggiora, **migliora**: con l'indice
    /// scritto a ogni fotografia, un processo ucciso fra il blob e l'indice
    /// lasciava quel blob orfano e invisibile. Qui no.
    ///
    /// Il prezzo vero, e sta scritto per non riscoprirlo: dopo un'interruzione
    /// la riapertura paga una ricostruzione, che legge tutti gli snapshot. Si
    /// paga una volta, dopo un crash, e la direzione dell'errore è il tempo —
    /// mai una versione persa.
    ///
    /// # Cosa non cambia
    ///
    /// Quali fotografie esistono, in che ordine, e il contenuto dell'indice che
    /// ne esce: identico byte per byte a quello che sarebbe uscito riscrivendolo
    /// ogni volta, perché è la stessa funzione sullo stesso `docs` finale.
    ///
    /// # La zona d'ombra, dichiarata
    ///
    /// Per la durata del lotto `versions.json` non c'è, e chi legge le versioni
    /// **dal disco** — [`HistoryView`], che rilegge a ogni disegno — vede una
    /// cronologia vuota invece di una parziale. All'apertura non lo vede
    /// nessuno, perché la passata gira nel runner, prima della prima fetta;
    /// nella
    /// riconciliazione dopo un `Overflow` è un lampo, e il pannello si ridisegna
    /// alla prima scrittura che segue. È il prezzo dichiarato di non lasciare in
    /// giro un indice che si crede la verità.
    fn in_lotto<T>(
        &self,
        host: &mut dyn HostApi,
        passata: impl FnOnce(&mut dyn HostApi) -> T,
    ) -> Result<T, PluginError> {
        // Se togliere l'indice non riesce, la passata **non comincia**: andare
        // avanti vorrebbe dire lasciare sul disco esattamente l'indice vecchio
        // che questa forma esiste per non lasciare. E un `data_remove` che
        // fallisce su uno spazio dati è lo stesso guasto per cui fallirebbe
        // ogni `data_write` che segue.
        host.data_remove(INDEX_FILE)?;
        self.inner.lock().expect("mutex").lotto = true;
        let chiuso_comunque = Lotto { inner: &self.inner };
        let esito = passata(&mut *host);
        drop(chiuso_comunque);
        // Il prestito attraversa il `data_write` come lo attraversa in
        // [`Inner::applica`], e per la stessa ragione: l'indice che va sul disco
        // dev'essere quello che `docs` dice *adesso*. Mollandolo in mezzo, un
        // salvataggio che entrasse qui scriverebbe il suo indice e poi questo ci
        // scriverebbe sopra il proprio, più vecchio di una versione.
        let inner = self.inner.lock().expect("mutex");
        scrivi_index(&inner.docs, host)?;
        Ok(esito)
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
        let dir_doc = inner.dir_per(id, host)?;

        if let Some(doc) = inner.docs.get(id.as_str()) {
            if doc.versions.last().is_some_and(|v| v.hash == hash) {
                // Niente di nuovo da salvare — ma ci hanno chiesto di
                // fotografare una nota VIVA: se portava un tombstone
                // (cestinata e ripristinata con lo stesso identico contenuto)
                // il tombstone se ne va comunque, o "il vault al tempo T" la
                // crederebbe cancellata per sempre.
                if doc.deleted_at.is_some() {
                    let mut piano = inner.docs.clone();
                    if let Some(doc) = piano.get_mut(id.as_str()) {
                        doc.deleted_at = None;
                    }
                    inner.applica(piano, id, host)?;
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
        let mut piano = inner.docs.clone();
        let doc = piano.entry(id.to_string()).or_default();
        doc.dir = dir_doc;
        doc.versions.push(version);
        // Una nota che torna in vita non è più morta: il tombstone se ne va, o
        // "il vault al tempo T" la crederebbe cancellata per sempre.
        doc.deleted_at = None;

        // La potatura decide **prima** e cancella **dopo**: `pota` tocca solo
        // l'elenco del piano e dice quali contenuti avanzano, l'indice va sul
        // disco, e solo un indice già scritto autorizza a togliere i blob. Se
        // `applica` fallisce si esce di qui con tutti i contenuti al loro posto
        // e un indice vecchio che li nomina tutti: si perde la potatura, non
        // una versione. Stessa forma di `rename`, stessa ragione di `trasloca`
        // — vedi il commento là.
        let potati = pota(&mut piano, id, host);
        inner.applica(piano, id, host)?;
        if !potati.is_empty() {
            tracing::info!(
                target: "fub.versioning",
                "{} version{} di {id} potate dalle fasce di ritenzione",
                potati.len(),
                if potati.len() == 1 { "e" } else { "i" }
            );
        }
        spazza(&potati, host);
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
        let mut piano = inner.docs.clone();
        piano.remove(from.as_str());
        piano.insert(to.to_string(), trasloco.doc);
        inner.applica(piano, to, host)?;
        // Ultimo ciò che resta indietro: è spazio sprecato, non una bugia, e
        // non vale la pena di far fallire un rename già andato a buon fine.
        spazza(&trasloco.da_ripulire, host);
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
        let Some(doc) = inner.docs.get(id.as_str()) else {
            return Ok(());
        };
        if doc.deleted_at.is_some() {
            return Ok(());
        }
        let mut piano = inner.docs.clone();
        if let Some(doc) = piano.get_mut(id.as_str()) {
            doc.deleted_at = Some(now);
        }
        inner.applica(piano, id, host)
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
    ///
    /// **Prende un [`ReadApi`] e non un `HostApi`**, ed è la riga per cui questa
    /// firma è più stretta del necessario apposta: leggere una versione è una
    /// lettura, e chi la serve deve poterlo fare dal prestito **condiviso** del
    /// workspace (`Workspace::with_read_host`, decisione 0024). **Non è un
    /// presidio**, e va detto perché la cosa ovvia è sbagliata: un
    /// `&mut dyn HostApi` si converte da sé in un `&dyn ReadApi`, che ne è la
    /// supertrait, quindi questa firma non chiude nessuna porta. È la
    /// dichiarazione di cosa questa funzione fa, e serve a chi la chiama per
    /// sapere quale dei due prestiti le basta.
    ///
    /// **E il lucchetto dello store non attraversa il disco.** Il prestito serve
    /// a sapere *dove* sta il blob — cioè a leggere l'anagrafe in memoria — e
    /// quello finisce con [`Inner::percorso`], che è l'unica a vederlo. Da qui
    /// in giù non c'è nessuna guardia da tenere: la lettura del blob è di chi ha
    /// il path.
    pub fn read(&self, id: &DocId, ts: u64, host: &dyn ReadApi) -> Result<String, PluginError> {
        let path = self.inner.lock().expect("mutex").percorso(id, ts)?;
        let bytes = host.data_read(&path)?.ok_or_else(|| {
            PluginError::Internal(Text::message(
                CONTENT_GONE,
                vec![Arg::text(PATH, path.clone())],
            ))
        })?;
        String::from_utf8(bytes).map_err(|e| {
            PluginError::Internal(Text::message(
                UNREADABLE,
                vec![Arg::text(PATH, path), Arg::text(REASON, e.to_string())],
            ))
        })
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
    /// Dove sta il blob di **questa** versione, secondo l'anagrafe in memoria.
    ///
    /// Esiste per una ragione sola, ed è la stessa per cui [`Inner::applica`] è
    /// il posto unico in cui `docs` cambia: qui il prestito dello store finisce
    /// **prima** dell'I/O, e finisce per costruzione — chi legge il blob riceve
    /// un `String` e non ha modo di tenere una guardia che non ha mai visto. La
    /// forma opposta — un `lock()` in testa a [`VersionStore::read`] e un
    /// `data_read` sotto — è quella che due lettori di cronologia si passavano
    /// uno alla volta, ognuno aspettando l'I/O dell'altro.
    ///
    /// Il verso opposto vale nelle **scritture**, e non è una svista: là il
    /// prestito attraversa il disco apposta, perché il piano si costruisce da ciò
    /// che c'è adesso e si installa solo se il disco l'ha accettato. Toglierlo di
    /// lì non toglierebbe un'attesa: aprirebbe una finestra in cui due
    /// salvataggi pianificano dalla stessa base e il secondo cancella il primo.
    fn percorso(&self, id: &DocId, ts: u64) -> Result<String, PluginError> {
        let doc = self.docs.get(id.as_str()).ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                NO_VERSIONS,
                vec![Arg::text(DOC, id.as_str())],
            ))
        })?;
        if !doc.versions.iter().any(|v| v.ts == ts) {
            return Err(PluginError::BadArgs(Text::message(
                NO_SUCH_VERSION,
                // Un istante, non una data già scritta: il fuso e il calendario
                // di chi legge li conosce chi risolve, non chi solleva
                // l'errore. È la ragione per cui `ArgValue::Timestamp` esiste.
                vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
            )));
        }
        Ok(blob(&doc.dir, &snapshot_name(ts, id.as_str())))
    }

    /// La cartella del documento nello spazio dati del plugin.
    ///
    /// Il nome nasce dall'impronta del `doc_id`; se quella cartella è già di
    /// un altro documento — una collisione di impronte, improbabile ma non
    /// impossibile — si prende la successiva libera. Meglio un nome brutto che
    /// due storie mescolate.
    ///
    /// Non crea niente — né sul disco né in memoria: le directory intermedie
    /// nascono alla prima scrittura, uno store senza contenuti non deve
    /// lasciare cartelle vuote in giro, e il nome trovato entra nell'anagrafe
    /// solo passando per [`Inner::applica`]. Prenotarlo qui vorrebbe dire
    /// lasciare in memoria, dopo un salvataggio fallito, un documento che il
    /// disco non ha mai visto.
    fn dir_per(&self, id: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
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
            let libera = match rivendicazione_di(&nome, host)? {
                Rivendicazione::Nessuna => true,
                Rivendicazione::Di(meta) => meta.doc_id == id.as_str(),
                // Un `meta.json` che non si legge **non** è una cartella
                // libera: è una cartella di cui non sappiamo il proprietario.
                // Darla via vorrebbe dire scriverci sopra il nome di questo
                // documento, e attribuirgli gli snapshot dell'altro alla prima
                // ricostruzione — cioè proprio le due storie mescolate che
                // questa funzione esiste per non fare. Il caso si raggiunge
                // senza bisogno di una collisione di impronte: dopo un rename
                // la chiave migra e la cartella resta col nome dell'impronta
                // vecchia, quindi il primo documento che rinasce con quel path
                // se la ritrova davanti. La direzione innocua è il nome brutto;
                // e la cartella non resta perduta per sempre, perché il
                // prossimo salvataggio del suo vero proprietario riscrive il
                // `meta.json` e la rende di nuovo leggibile.
                Rivendicazione::Illeggibile => false,
            };
            if libera {
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
    /// protezione della più recente in [`pota`].
    fn free_ts(&self, id: &DocId, host: &dyn HostApi) -> u64 {
        let ts = host.now_unix_millis();
        let minimo = self
            .docs
            .get(id.as_str())
            .and_then(|d| d.versions.iter().map(|v| v.ts).max())
            .map_or(0, |ultimo| ultimo + 1);
        ts.max(minimo)
    }

    /// Rende vero sul disco lo stato che i documenti **avranno**, e solo se il
    /// disco l'ha accettato lo installa in memoria.
    ///
    /// È il posto **unico** in cui `Inner::docs` cambia, ed è la ragione per
    /// cui [`Inner::dir_per`] e [`pota`] lavorano su un piano invece che sullo
    /// stato vivo: la mutazione qui è il *prodotto* della scrittura riuscita,
    /// non il suo presupposto. Nella forma opposta — muta, poi persisti col
    /// `?` — un disco che dice di no lascia la memoria avanti di un passo, e
    /// non c'è nessun ramo d'errore da ricordarsi di scrivere: chi aggiunge un
    /// campo a [`DocVersions`] eredita l'ordine giusto senza saperlo.
    ///
    /// Il `meta.json` va **prima** dell'indice perché l'autorità è il **disco**
    /// e l'indice ne è il derivato (vedi il preambolo del modulo, e
    /// [`VersionStore::open`], che dai meta ricostruisce). Vale per il
    /// `meta.json` quello che vale già per il blob di una versione, scritto
    /// anche lui prima di arrivare qui: se poi l'indice non passa, ciò che è
    /// finito sul disco è la verità, e resta lì ad aspettare la ricostruzione
    /// che la ritroverà.
    ///
    /// Quindi non è vero, e non deve esserlo, che «se il meta passa e l'indice
    /// no il disco resta com'era»: il disco è **avanti**, verso il vero, e
    /// l'indice e la memoria restano indietro insieme — indietro concordi, che
    /// è la proprietà che serve. L'ordine inverso invece lascerebbe l'indice
    /// avanti e il disco indietro, cioè un derivato che afferma una versione o
    /// un tombstone di cui la verità non sa niente.
    ///
    /// Ciò che questa forma **non** basta a garantire è che le rivendicazioni
    /// sul disco restino una per documento: quella la tiene [`trasloca`],
    /// togliendo la rivendicazione vecchia prima che qui se ne scriva una nuova.
    fn applica(
        &mut self,
        piano: BTreeMap<String, DocVersions>,
        meta_di: &DocId,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        if let Some(doc) = piano.get(meta_di.as_str()) {
            scrivi_meta(meta_di, doc, host)?;
        }
        // Dentro un lotto l'indice non si scrive: lo scrive
        // [`VersionStore::in_lotto`] una volta sola, in fondo. Il piano si
        // installa lo stesso, e non è un'eccezione alla regola di sopra — è la
        // stessa regola letta sull'autorità giusta. Ciò che il disco ha
        // accettato qui è il `meta.json`, e il `meta.json` è la verità;
        // l'indice ne è il derivato, e un derivato che manca non è una bugia,
        // è la condizione da cui [`VersionStore::open`] ricostruisce.
        if !self.lotto {
            scrivi_index(&piano, host)?;
        }
        self.docs = piano;
        Ok(())
    }
}

/// Il lotto aperto: finché vive, l'indice non si riscrive a ogni fotografia.
///
/// È un `Drop` e non due righe in fila perché il flag deve tornare giù anche se
/// la passata srotola: un lotto rimasto aperto sarebbe uno store che non scrive
/// più l'indice, mai più, e il difetto successivo sarebbe molto peggio di
/// quello riparato. Il `Drop` **non scrive** — chiudere il conto sul disco può
/// fallire, e un errore che scappasse da un `Drop` non avrebbe dove andare
/// (peggio: un panico da un `Drop` è un `abort`).
struct Lotto<'a> {
    inner: &'a Mutex<Inner>,
}

impl Drop for Lotto<'_> {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.lotto = false;
        }
    }
}

fn scrivi_meta(id: &DocId, doc: &DocVersions, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let meta = Meta {
        doc_id: id.to_string(),
        deleted_at: doc.deleted_at,
    };
    let raw = serde_json::to_vec(&meta).map_err(|e| {
        PluginError::Internal(Text::message(
            META_UNWRITABLE,
            vec![Arg::text(REASON, e.to_string())],
        ))
    })?;
    host.data_write(&blob(&doc.dir, META_FILE), &raw)
}

fn scrivi_index(
    docs: &BTreeMap<String, DocVersions>,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    let index = IndexDaScrivere {
        schema_version: SCHEMA_VERSION,
        docs,
    };
    let raw = serde_json::to_vec(&index).map_err(|e| {
        PluginError::Internal(Text::message(
            INDEX_UNWRITABLE,
            vec![Arg::text(REASON, e.to_string())],
        ))
    })?;
    host.data_write(INDEX_FILE, &raw)
}

/// Applica le fasce di ritenzione (D6) all'elenco **del piano** e
/// **restituisce i contenuti che avanzano**, senza cancellarne nessuno.
///
/// Non cancella perché non può saperlo: finché l'indice potato non è sul disco,
/// i blob che qui risultano di troppo sono ancora nominati dall'indice che c'è,
/// e toglierli lo renderebbe bugiardo. Li spazza chi chiama, dopo
/// [`Inner::applica`], con [`spazza`]. La direzione innocua dell'errore è il
/// blob orfano — costa spazio; quella rovinosa è l'indice che nomina un
/// contenuto sparito, che rompe ogni [`VersionStore::read`].
///
/// Pota il **piano** e non lo stato vivo per la stessa ragione: assottigliare
/// l'elenco in memoria e poi non riuscire a scrivere l'indice toglierebbe da
/// sotto gli occhi versioni che sul disco ci sono ancora.
#[must_use = "sono i contenuti da spazzare dopo aver scritto l'indice"]
fn pota(docs: &mut BTreeMap<String, DocVersions>, id: &DocId, host: &dyn HostApi) -> Vec<String> {
    let ora = host.now_unix_millis();
    let Some(doc) = docs.get(id.as_str()) else {
        return Vec::new();
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
        return Vec::new();
    }

    let dir = doc.dir.clone();
    let avanzati: Vec<String> = doc
        .versions
        .iter()
        .filter(|v| !tenute.iter().any(|t| t.ts == v.ts))
        .map(|v| blob(&dir, &snapshot_name(v.ts, id.as_str())))
        .collect();
    if let Some(doc) = docs.get_mut(id.as_str()) {
        doc.versions = tenute;
    }
    avanzati
}

/// Toglie dallo store contenuti che l'indice **già scritto** non nomina più.
///
/// È il posto unico in cui il versioning cancella un blob, e non rende un
/// errore di proposito: qui si arriva solo a indice persistito, e a quel punto
/// un contenuto che non se ne va è spazio sprecato — non una bugia. Chiamarla
/// prima di [`Inner::applica`] è l'inversione che rompe tutto, ed è la
/// ragione per cui [`pota`] restituisce path invece di cancellarli.
fn spazza(paths: &[String], host: &mut dyn HostApi) {
    for path in paths {
        if let Err(e) = host.data_remove(path) {
            tracing::warn!(target: "fub.versioning", "{path} è rimasto indietro e non se ne va: {e}");
        }
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
                tracing::warn!(
                    target: "fub.versioning",
                    "{origine} non c'è più, la versione {} esce dalla storia di {to}",
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

    // La cartella abbandonata smette di dire di chi è **qui**, prima che
    // `applica` scriva la rivendicazione nuova — e non dopo, con gli altri
    // avanzi.
    //
    // La regola «prima l'indice, poi si cancella» vale per i **contenuti**, che
    // l'indice nomina: toglierne uno che l'indice nomina ancora è il modo di
    // rompere ogni `read`. Un `meta.json` l'indice non lo nomina, e rimandarlo
    // apriva la sola finestra in cui **due** cartelle rivendicano lo stesso
    // `doc_id`: se `scrivi_index` falliva lì in mezzo, il disco restava con la
    // cartella unita e quella vecchia che dicevano tutte e due `to`, e
    // `rebuild_from_store` — che le tiene in un `BTreeMap` per `doc_id` — ne
    // buttava una in silenzio, senza nessuna regola su quale.
    //
    // Qui invece si arriva a copie **tutte** fatte, ed è la precondizione che
    // rende questa cancellazione innocua: ciò che stava di là sta già di qua.
    // La finestra peggiore che resta è la cartella unita che dice ancora `from`,
    // cioè la storia intera sotto la chiave di prima — un nome vecchio, non una
    // storia persa. E se è la cancellazione stessa a non riuscire, il `?` ferma
    // il rename prima che la seconda rivendicazione esista.
    if let Some(esistente) = esistente {
        if esistente.dir != dir {
            host.data_remove(&blob(&esistente.dir, META_FILE))?;
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
/// Prende un `&dyn ReadApi` e non un `&dyn HostApi`: leggere l'indice è una
/// lettura, e da quando il pannello cronologia lo rilegge dal percorso di
/// render — dove di scritture non ce ne sono — il tipo lo dice.
fn load_index(host: &dyn ReadApi) -> Option<BTreeMap<String, DocVersions>> {
    let raw = host.data_read(INDEX_FILE).ok()??;
    let index: Index = serde_json::from_slice(&raw).ok()?;
    (index.schema_version == SCHEMA_VERSION).then_some(index.docs)
}

fn rivendicazione_di(dir: &str, host: &dyn HostApi) -> Result<Rivendicazione, PluginError> {
    let Some(raw) = host.data_read(&blob(dir, META_FILE))? else {
        return Ok(Rivendicazione::Nessuna);
    };
    Ok(match serde_json::from_slice(&raw) {
        Ok(meta) => Rivendicazione::Di(meta),
        Err(_) => Rivendicazione::Illeggibile,
    })
}

/// Ricostruisce l'indice leggendo lo store: ogni cartella dice di chi è
/// (`meta.json`), ogni file dice quando (il nome) e cosa (il contenuto).
///
/// È la direzione lecita del dubbio. Costa una lettura di tutti gli snapshot,
/// ma succede solo quando l'indice è perso — e un indice perso, senza questo,
/// renderebbe le versioni irraggiungibili per sempre.
///
/// Quella lettura non si può togliere: [`VersionRef::hash`] è l'impronta FNV-1a
/// **del contenuto** e `size` è la sua lunghezza, e l'unico posto in cui erano
/// già scritti è `versions.json`, cioè proprio l'indice che qui manca. Caricare
/// gli snapshot non è il prezzo per calcolare l'impronta: è il calcolo. Il conto
/// — 400 letture per 200 documenti, un `meta.json` e uno snapshot ciascuno,
/// niente riletto — sta in `fub-features/tests/chi_risponde_apre_i_byte.rs`.
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
        let meta = match rivendicazione_di(dir, host)? {
            Rivendicazione::Di(meta) => meta,
            Rivendicazione::Nessuna => {
                tracing::warn!(target: "fub.versioning", "{dir} non dice di chi è, la salto");
                continue;
            }
            // Diverso dal caso sopra, e vale la pena dirlo: qui una storia c'è
            // e resta sul disco, fuori dall'indice finché quel `meta.json` non
            // torna leggibile. Nessun altro se la prende — [`Inner::dir_per`]
            // non dà via una cartella che non sa leggere — e il primo
            // salvataggio del suo proprietario la riscrive.
            Rivendicazione::Illeggibile => {
                tracing::warn!(
                    target: "fub.versioning",
                    "il meta.json di {dir} non si legge: la sua storia resta sul \
                     disco ma fuori dall'indice"
                );
                continue;
            }
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
        let da_guardare = self.esistenti(host)?;
        // Una passata è un **lotto**: le fotografie vanno sul disco una per una
        // — blob e `meta.json`, che sono l'autorità — e l'indice, che è il
        // derivato, si scrive una volta sola in fondo. Fuori di qui l'indice
        // resta scritto a ogni salvataggio: è il costo onesto di un indice, e
        // diventa un difetto solo quando lo si paga N volte di fila.
        let esito = self.store.in_lotto(host, |host| {
            for id in da_guardare {
                if matches!(chi, Passata::SoloNuovi) && self.store.has_versions(&id) {
                    continue;
                }
                // Una nota illeggibile o non salvabile non deve impedire
                // l'apertura del vault: il vault è la verità, le versioni no.
                match host.read_document(&id) {
                    Ok(source) => {
                        if let Err(e) = self.store.snapshot(&id, &source, host) {
                            tracing::warn!(target: "fub.versioning", "versione di {id} non salvata: {e}");
                            // Una versione attesa non salvata è una perdita
                            // autorevole (0052: `Failure`): l'errore è già un
                            // `PluginError` catalogato, e lo si porta nel canale tale
                            // e quale invece di ricomporlo (0062).
                            host.emit(Event::Trouble {
                                severity: Severity::Failure,
                                subject: Some(id.clone()),
                                error: e,
                            });
                        }
                    }
                    Err(e) => {
                        tracing::warn!(target: "fub.versioning", "{id} non si legge: {e}");
                        host.emit(Event::Trouble {
                            severity: Severity::Failure,
                            subject: Some(id.clone()),
                            error: e,
                        });
                    }
                }
            }
        });
        // L'indice finale non si è scritto. Non è una versione persa — sul
        // disco le fotografie ci sono tutte e la prossima apertura le
        // ricostruisce — ma non è nemmeno una notizia da tenersi: è lo stesso
        // guasto che prima si presentava una volta per nota, e qui si presenta
        // una volta sola. **Senza soggetto**, perché non è di un documento: è
        // dello store.
        if let Err(e) = esito {
            tracing::warn!(
                target: "fub.versioning",
                "l'indice non si è scritto dopo la passata: resta da \
                 ricostruire alla prossima apertura ({e})"
            );
            host.emit(Event::Trouble {
                severity: Severity::Failure,
                subject: None,
                error: e,
            });
        }
        Ok(())
    }

    /// **Quali documenti esistono**, che non è «quali sono indicizzati».
    ///
    /// La domanda è all'anagrafe ([`IndexQuery::Entries`], §14.1) e non a
    /// [`HostApi::list_documents`], e la differenza è diventata visibile con
    /// l'apertura a fasi (§15.7): `list_documents` risponde dai documenti
    /// **parsati**, e quando la passata parte non ne è stato parsato ancora
    /// nessuno — il vault a quel punto sa *cosa c'è*, non
    /// *cosa dicono*. Chiedendo la lista sbagliata, la prima fotografia
    /// sarebbe stata di zero note, e la prima modifica a una nota mai
    /// versionata avrebbe cancellato per sempre lo stato in cui l'utente
    /// l'aveva trovata: cioè esattamente il danno contro cui questa passata
    /// esiste.
    ///
    /// Che le due liste potessero divergere lo aveva già scritto la
    /// [0068](../../../docs/decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md)
    /// — uno scarto è un documento che esiste e non è indicizzato — ma là la
    /// divergenza era rara e piccola; qui è la normalità per tutta la durata
    /// dell'indicizzazione. E per questa passata l'anagrafe è la sorgente
    /// giusta anche nel merito: si fotografa ciò che sta **sul disco**, e
    /// `read_document` legge dal disco, non dall'indice.
    fn esistenti(&self, host: &mut dyn HostApi) -> Result<Vec<DocId>, PluginError> {
        let risposta = host.query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: None,
            page: None,
        })?;
        match risposta {
            IndexResult::Entries(paged) => {
                Ok(paged.items.into_iter().map(|entry| entry.id).collect())
            }
            altro => Err(PluginError::Internal(
                format!("l'anagrafe ha risposto con {altro:?}").into(),
            )),
        }
    }

    /// La prima fotografia del vault, all'apertura.
    ///
    /// Gli snapshot nascono dagli eventi e l'apertura non ne emette per
    /// documento: senza questo passaggio, la prima modifica a una nota mai
    /// versionata cancellerebbe per sempre lo stato in cui l'utente l'ha
    /// trovata — l'handler gira *dopo* la scrittura e vede solo il testo nuovo.
    ///
    /// La chiama il runner, una volta per apertura, prima della prima fetta
    /// (§25.3): il *quando* e il *cosa* sono policy della feature — viveva in
    /// `fub-app::open_vault`, poi sull'evento `VaultOpened`, oggi qui, con la
    /// stessa firma di un `Plugin::activate` — e il *chi* è il wiring.
    pub fn first_snapshot_of_the_vault<'h>(
        &self,
        host: &'h mut (dyn HostApi + 'h),
    ) -> Result<(), PluginError> {
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
        // **Vivo = esiste, non = è indicizzato**, e qui la differenza fa il
        // danno peggiore di tutto il file: un documento che esiste e che
        // l'indice non ha — uno scarto della 0068, o una nota che
        // l'indicizzazione non ha ancora raggiunto (§15.7) — riceverebbe un
        // **tombstone**, cioè il versioning dichiarerebbe morta una nota viva.
        // Chiedendolo all'anagrafe la domanda è quella che si intendeva fare.
        let vivi: std::collections::BTreeSet<String> =
            self.esistenti(host)?.into_iter().map(|id| id.0).collect();
        let mut sepolti = 0usize;
        for id in self.store.documents() {
            if vivi.contains(id.as_str()) || self.store.is_deleted(&id) {
                continue;
            }
            match self.store.tombstone(&id, host) {
                Ok(()) => sepolti += 1,
                Err(e) => {
                    tracing::warn!(target: "fub.versioning", "tombstone di {id} non scritto: {e}");
                    host.emit(Event::Trouble {
                        severity: Severity::Failure,
                        subject: Some(id.clone()),
                        error: e,
                    });
                }
            }
        }
        if sepolti > 0 {
            tracing::info!(
                target: "fub.versioning",
                "riconciliazione dopo un overflow, {sepolti} document{} \
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
            Event::DocumentChanged { id, .. } => {
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

// ---------------------------------------------------------------------------
// Il pannello cronologia (§1.2), e il comando che ripristina
// ---------------------------------------------------------------------------
//
// # Chi scrive le versioni è chi le disegna
//
// Il §1.2 chiedeva di migrare la cronologia al protocollo dichiarativo, e la
// domanda che la migrazione ha dovuto rispondere è *da dove le legge*. Il
// pannello nativo le chiedeva a tre comandi Tauri, che le chiedevano allo store
// che vive nell'host. Un `ViewProvider` non ha né l'uno né gli altri — e non gli
// servono: questa view è dello **stesso plugin** che le versioni le scrive,
// quindi le rilegge dal proprio spazio dati con `data_read`, che è una capacità
// del contratto e non una scorciatoia. È la stessa strada che avrebbe un plugin
// di terzi che si tenesse uno store suo.
//
// Ne segue che il pannello non condivide l'esemplare in memoria dello store con
// l'handler che lo riempie: rilegge `versions.json` a ogni disegno. Non è un
// costo trascurato, è la scelta giusta due volte — l'indice è un file piccolo
// che sta nella cache del sistema, e un pannello che rilegge dice sempre la
// verità anche quando a scrivere è stata un'altra finestra.
//
// # Versioning spento significa pannello assente, e adesso per costruzione
//
// La shell nativa lo faceva con un `hidden` guidato da `VaultInfo.versioning`:
// il pannello c'era comunque, e a tenerlo vuoto era una riga di TypeScript.
// Adesso la view la registra la feature, e una feature spenta non si monta —
// quindi non c'è nessuna `ViewSpec` da montare, e nessuno la disegna. È la
// spegnibilità totale (D7) ottenuta togliendo codice invece di aggiungendone.

/// Id della `ViewSpec` della cronologia.
pub const HISTORY_VIEW: &str = "history";
/// L'id, nel registro, del comando che riporta una nota a una sua versione.
pub const VERSION_RESTORE: &str = "version.restore";

/// Mostra il contenuto di una versione; l'istante sta nel payload.
const A_PREVIEW: &str = "preview";
/// Chiude l'anteprima aperta.
const A_CLOSE_PREVIEW: &str = "close_preview";
/// Ripristina la versione il cui istante sta nel payload.
const A_RESTORE: &str = "restore";
/// La chiave del payload, e quella sotto cui l'anteprima aperta resta scritta
/// nello stato di vista dell'esemplare (§11.2).
const TS: &str = "ts";
const PREVIEW_STATE: &str = "preview";

/// Le versioni di un documento secondo l'indice **su disco**, dalla più recente
/// alla più vecchia.
fn versions_of(host: &dyn ReadApi, id: &DocId) -> Vec<VersionRef> {
    load_index(host)
        .and_then(|docs| docs.get(id.as_str()).cloned())
        .map(|d| d.versions.iter().rev().copied().collect())
        .unwrap_or_default()
}

/// Il contenuto di una versione, letto dallo spazio dati del plugin.
///
/// È il gemello in sola lettura di [`VersionStore::read`], e non lo sostituisce:
/// quello risponde dall'indice in memoria — che è ciò che serve a chi sta
/// scrivendo uno snapshot — questo dal file, che è ciò che serve a chi disegna.
fn version_source(host: &dyn ReadApi, id: &DocId, ts: u64) -> Result<String, PluginError> {
    let docs = load_index(host).unwrap_or_default();
    let doc = docs.get(id.as_str()).ok_or_else(|| {
        PluginError::NotFound(Text::message(
            NO_VERSIONS,
            vec![Arg::text(DOC, id.as_str())],
        ))
    })?;
    if !doc.versions.iter().any(|v| v.ts == ts) {
        return Err(PluginError::NotFound(Text::message(
            NO_SUCH_VERSION,
            vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
        )));
    }
    let path = blob(&doc.dir, &snapshot_name(ts, id.as_str()));
    let bytes = host.data_read(&path)?.ok_or_else(|| {
        PluginError::Internal(Text::message(
            CONTENT_GONE,
            vec![Arg::text(PATH, path.clone())],
        ))
    })?;
    String::from_utf8(bytes).map_err(|e| {
        PluginError::Internal(Text::message(
            UNREADABLE,
            vec![Arg::text(PATH, path), Arg::text(REASON, e.to_string())],
        ))
    })
}

/// Il pannello cronologia: le versioni della nota aperta, e come tornarci.
pub struct HistoryView;

impl ViewProvider for HistoryView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Una versione nasce da una scrittura, e da niente altro: la
            // maschera è più stretta di quella dei pannelli che leggono
            // l'indice.
            refresh: EventMask::of([EventKind::DocumentChanged, EventKind::BatchEnded]),
            // …e la storia è di **quella** nota. Non di dove sta il cursore.
            follows: ContextMask::document(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            HISTORY_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("history")
        .ordered(3)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // L'anteprima si **ricorda**, non si disegna e basta: il pannello si
            // ridisegna a ogni scrittura, e un'anteprima che vivesse nel solo
            // albero sparirebbe al primo salvataggio di chi la sta leggendo.
            A_PREVIEW => {
                let (Some(_), Some(ts)) = (
                    stessa_nota(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, Some(serde_json::Value::from(ts)))?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            A_CLOSE_PREVIEW => {
                host.set_view_state(PREVIEW_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Ripristinare **non** è una scrittura di questo pannello: è il
            // comando `version.restore`, invocato per id come lo invocherebbe la
            // palette o un plugin. Una view che riscrivesse il documento da sé
            // avrebbe un'operazione fuori dal registro — quindi fuori
            // dall'annullamento, fuori dalla simulazione e fuori dalla palette.
            A_RESTORE => {
                let (Some(doc), Some(ts)) = (
                    stessa_nota(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, None)?;
                host.run_command(
                    VERSION_RESTORE,
                    serde_json::json!({ DOC: doc.as_str(), TS: ts }),
                )?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// La nota su cui questa riga è stata **disegnata**, e solo se è ancora
/// l'attiva.
///
/// È il difetto 0047 nel suo secondo sito, e qui è peggio che nell'outline:
/// là un salto scaduto portava il cursore nel punto sbagliato, qui una riga
/// scaduta **scrive**. Le due metà di un ripristino venivano da due istanti
/// diversi — il `ts` dalla storia della nota *disegnata*, la nota da quella
/// *attiva adesso* — e fra i due ci sta la finestra in cui il pannello vecchio è
/// ancora sotto il dito di chi clicca, perché il ridisegno che segue un cambio
/// di nota arriva dopo. Ne usciva un `version.restore` con la nota B e un
/// istante della storia di A: se B quell'istante non ce l'ha è un errore in
/// faccia a chi non ha sbagliato niente, e se ce l'ha — due scritture nello
/// stesso millisecondo sono un lotto, non una coincidenza — è B riportata
/// indietro senza che nessuno l'abbia chiesto.
///
/// Si **butta**, e non si ripristina la nota ricordata: `interests()` di questo
/// pannello dichiara `follows: document`, cioè promette di seguire l'attiva, e
/// scrivere d'autorità su quella di prima sarebbe insieme una contraddizione
/// della propria registrazione e la più invasiva delle due risposte sbagliate.
/// Un click scaduto non fa niente, e quello dopo — sul pannello giusto, che nel
/// frattempo è arrivato — lo fa.
fn stessa_nota(action: &UiAction, host: &dyn ReadApi) -> Option<DocId> {
    let disegnata = action.payload.get(DOC).and_then(|v| v.as_str())?;
    let attiva = host.active_context().and_then(|c| c.doc)?;
    (attiva.as_str() == disegnata).then_some(attiva)
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        return Ok(UiNode::empty_state(Text::key(NO_ACTIVE_DOC)));
    };
    let versions = versions_of(host, &doc);
    if versions.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }

    let mut figli = vec![UiNode::text(Text::message(
        COUNT,
        vec![Arg::int("count", versions.len() as i64)],
    ))];
    figli.push(UiNode::list(
        versions
            .iter()
            .enumerate()
            .map(|(i, v)| riga(v, i == 0, doc.as_str()))
            .collect(),
    ));

    // L'anteprima, se qualcuno l'ha aperta. Il contenuto è testo di un file, e
    // testo resta: un `Text` che la shell inserisce come testo, non `Html`.
    if let Some(ts) = host
        .view_state(PREVIEW_STATE)?
        .and_then(|v| v.as_u64())
        .filter(|ts| versions.iter().any(|v| v.ts == *ts))
    {
        figli.push(UiNode::keyed(
            format!("preview:{ts}"),
            UiKind::Section {
                title: Text::message(WHEN, vec![Arg::timestamp(WHEN, ts)]),
                collapsed: false,
                children: vec![
                    UiNode::text(version_source(host, &doc, ts)?),
                    UiNode::button(
                        Text::key(CLOSE_PREVIEW),
                        Intent::Neutral,
                        ActionRef::new(A_CLOSE_PREVIEW),
                    ),
                ],
            },
        ));
    }
    Ok(UiNode::column(1, figli))
}

/// Una versione: quando, quanto grande, e i due gesti che la riguardano.
///
/// La più recente porta scritto *«adesso»* invece della dimensione, ed è ciò che
/// il pannello nativo già faceva: ripristinare la versione più recente è
/// riscrivere il file con quello che c'è già dentro.
/// La nota viaggia nel payload accanto all'istante, e non perché serva a chi
/// agisce — `version.restore` la vuole, ma la si potrebbe rileggere —: serve a
/// dire **su quale nota questa riga è stata disegnata**, che è l'unico modo di
/// accorgersi che nel frattempo è cambiata. Vedi [`stessa_nota`].
fn riga(v: &VersionRef, corrente: bool, doc: &str) -> UiNode {
    let quando = Text::message(WHEN, vec![Arg::timestamp(WHEN, v.ts)]);
    let quanto = if corrente {
        Text::key(CURRENT)
    } else {
        Text::message(SIZE, vec![Arg::int("size", v.size as i64)])
    };
    UiNode::keyed(
        v.ts.to_string(),
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Row,
            gap: 1,
            children: vec![
                UiNode::list_item(
                    quando,
                    Some(quanto),
                    Some(ActionRef::with(
                        A_PREVIEW,
                        serde_json::json!({ DOC: doc, TS: v.ts }),
                    )),
                ),
                UiNode::button(
                    Text::key(RESTORE_LABEL),
                    Intent::Primary,
                    ActionRef::with(A_RESTORE, serde_json::json!({ DOC: doc, TS: v.ts })),
                ),
            ],
        },
    )
}

/// Il comando del registro che riporta una nota a una sua versione.
///
/// Era `restore_version`, un comando Tauri: la §16.6 lo aveva già classificato —
/// *fa accadere qualcosa e risponde con un messaggio*, quindi è un comando del
/// registro — e il pannello cronologia era il suo unico chiamante. Migrandolo
/// col pannello, la palette lo eredita gratis.
pub struct VersioningCommands;

impl CommandProvider for VersioningCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(VERSION_RESTORE, Text::key(RESTORE_TITLE))
            .describing(Text::key(RESTORE_DESC))
            .with_param(
                ParamSpec::new(DOC, Text::key(RESTORE_DOC_TITLE), ParamKind::Document)
                    .describing(Text::key(RESTORE_DOC_DESC)),
            )
            .with_param(
                ParamSpec::new(TS, Text::key(RESTORE_TS_TITLE), ParamKind::Number)
                    .describing(Text::key(RESTORE_TS_DESC))
                    .required(),
            )
            // Reversibile, e non per ottimismo: il ripristino è a sua volta una
            // scrittura, quindi una versione (D8), quindi c'è una versione a cui
            // tornare. L'`Undo` qui sotto la nomina.
            .with_scope(CommandScope::writing(CommandReach::Document))]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != VERSION_RESTORE {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let args = Args::new(&args);
        let doc = args
            .document(DOC)
            .or_else(|| host.active_context().and_then(|c| c.doc))
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_NOTE_GIVEN)))?;
        let ts = args
            .number(TS)
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TS_GIVEN)))? as u64;

        let quando_dove = |key: &str, when: u64| {
            Text::message(
                key,
                vec![Arg::text(DOC, doc.as_str()), Arg::timestamp(WHEN, when)],
            )
        };

        if mode.is_dry_run() {
            let piano = CommandPlan::of_edits(quando_dove(PLAN_RESTORE, ts), Vec::new())
                .with_doc(doc.clone());
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(piano)));
        }

        // L'inverso di un ripristino è un altro ripristino: quello alla versione
        // che il ripristino stesso sta per creare fotografando ciò che c'è
        // adesso. La si nomina **prima** di scrivere, perché dopo la lista è
        // cambiata — ed è l'istante dell'ultima versione salvata, non l'ora
        // corrente: fra le due c'è il dedup (D6), che può non aver fotografato
        // niente se il file era già uguale.
        let prima = versions_of(host, &doc).first().map(|v| v.ts);
        let source = version_source(host, &doc, ts)?;
        // **Detta**, e qui la parola è precisa: un ripristino non discende dal
        // testo che c'è adesso — lo sostituisce apposta, ed è il gesto con cui
        // l'utente dice che quello di adesso non gli va bene. Guardarlo con la
        // revisione corrente vorrebbe dire rifiutare il ripristino ogni volta
        // che c'è qualcosa da ripristinare, cioè sempre. Ciò che si copre non
        // è perduto: il dedup (D6) ne fotografa una versione prima.
        host.write_document(&doc, &source, WriteBase::Dictated)?;

        let esito = CommandOutcome::notify(quando_dove(DONE_RESTORE, ts));
        Ok(match prima {
            Some(prima) => esito.undoable(fub_abi::command::Undo::by_command(
                quando_dove(UNDO_RESTORE, prima),
                VERSION_RESTORE,
                serde_json::json!({ DOC: doc.as_str(), TS: prima }),
            )),
            // Nessuna versione prima di questa: non c'è niente a cui tornare, e
            // dichiarare un annullamento che fallirebbe è peggio che non
            // dichiararne nessuno.
            None => esito,
        })
    }
}

#[cfg(test)]
mod tests {
    use fub_sdk::testing::MemoryHost;

    use super::*;
    use fub_abi::traits::{DataRead, DataWrite, HostEnv, VaultWrite};

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
        // recente in `pota`.
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
        // E i contenuti potati non restano a occupare spazio nello store: la
        // cartella del documento contiene il suo `meta.json` e **solo** gli
        // snapshot che l'indice nomina, nessuno di più.
        for v in &tenute {
            assert!(
                store.read(&id("a.md"), v.ts, &host).is_ok(),
                "una versione tenuta deve essere leggibile"
            );
        }
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
        let mut rimasti = host.data_list(&dir).unwrap();
        rimasti.sort();
        let mut attesi: Vec<String> = tenute
            .iter()
            .map(|v| blob(&dir, &snapshot_name(v.ts, "a.md")))
            .chain(std::iter::once(blob(&dir, META_FILE)))
            .collect();
        attesi.sort();
        assert_eq!(rimasti, attesi, "un blob potato è rimasto nello store");
    }

    /// La potatura giudicata sul ramo che conta: decide di buttare qualcosa e
    /// la scrittura dell'indice non riesce.
    ///
    /// Ciò che non deve succedere è che sul disco resti un indice che nomina
    /// versioni già cancellate — `read` fallirebbe su ognuna, e il versioning
    /// sembrerebbe intero mentre non lo è. La direzione innocua dell'errore è
    /// l'opposta: il blob che avanza costa spazio e basta.
    #[test]
    fn a_prune_that_cannot_write_the_index_leaves_every_named_version_readable() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        // Due salvataggi nella stessa ora e poi due giorni di silenzio: al
        // prossimo salvataggio i primi due finiscono nella fascia oraria, dove
        // ne sopravvive uno solo — cioè la potatura ha qualcosa da buttare.
        for (n, salto) in [0, 60_000].into_iter().enumerate() {
            host.avanza(salto);
            store
                .snapshot(&id("a.md"), &format!("versione {n}"), &mut host)
                .unwrap();
        }
        let prima = store.list(&id("a.md")).len();
        assert_eq!(prima, 2);

        // Il disco si rifiuta proprio sull'indice, e proprio sul salvataggio
        // che pota.
        host.nega_scrittura(INDEX_FILE);
        host.avanza(2 * MS_GIORNO);
        let esito = store.snapshot(&id("a.md"), "l'ultima", &mut host);
        assert!(esito.is_err(), "una scrittura negata non è un successo");
        assert!(
            store.list(&id("a.md")).len() < prima + 1,
            "il banco non prova niente se la potatura non ha buttato nulla"
        );

        // Si riapre dall'indice che è rimasto sul disco: qualunque versione
        // dica di avere, deve poterla leggere.
        let store = VersionStore::open(&mut host).unwrap();
        let versioni = store.list(&id("a.md"));
        assert!(!versioni.is_empty(), "l'indice sul disco non è vuoto");
        for v in &versioni {
            assert!(
                store.read(&id("a.md"), v.ts, &host).is_ok(),
                "l'indice nomina la versione {} e il contenuto non c'è più",
                v.ts
            );
        }
    }

    /// Porta una nota cestinata fino all'orlo della resurrezione, poi nega al
    /// disco **una** delle due scritture dell'anagrafe e chiede il salvataggio
    /// che la riporterebbe in vita col contenuto identico (il ramo del dedup,
    /// dove non c'è nessun blob da scrivere e l'unica cosa che cambia è il
    /// tombstone). Rende ciò che memoria e disco dicono, in quest'ordine.
    fn resurrezione_negata(nega: impl Fn(&MemoryHost, &str)) -> (bool, bool) {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "identico", &mut host).unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();

        nega(&host, &dir);
        host.avanza(1_000);
        assert!(
            store.snapshot(&id("a.md"), "identico", &mut host).is_err(),
            "una scrittura negata non è un successo"
        );

        let in_memoria = store.is_deleted(&id("a.md"));
        let sul_disco = VersionStore::open(&mut host)
            .unwrap()
            .is_deleted(&id("a.md"));
        (in_memoria, sul_disco)
    }

    /// La forma «muta lo stato, poi persisti col `?`» — quella che [`Inner::applica`]
    /// toglie di mezzo — giudicata sul campo che l'utente vede: il tombstone.
    ///
    /// Ciò che non deve succedere è che la nota torni viva **solo in memoria**:
    /// l'app la mostrerebbe ripristinata, il disco continuerebbe a dirla
    /// cestinata, e al riavvio sarebbe di nuovo nel cestino senza che nessuno
    /// abbia detto perché. Vale per tutte e due le scritture dell'anagrafe —
    /// il `meta.json` della cartella e l'indice — perché a fallire può essere
    /// l'una o l'altra.
    #[test]
    fn a_resurrection_the_disk_refuses_leaves_the_note_dead_in_memory_too() {
        for (chi, nega) in [
            (
                "meta.json",
                &(|host: &MemoryHost, dir: &str| host.nega_scrittura(&blob(dir, META_FILE)))
                    as &dyn Fn(&MemoryHost, &str),
            ),
            ("l'indice", &|host: &MemoryHost, _: &str| {
                host.nega_scrittura(INDEX_FILE)
            }),
        ] {
            let (in_memoria, sul_disco) = resurrezione_negata(nega);
            assert!(
                in_memoria,
                "{chi} ha detto di no e la memoria è andata avanti da sola: \
                 mostra viva una nota che al riavvio è di nuovo cestinata"
            );
            assert_eq!(
                in_memoria, sul_disco,
                "{chi} ha detto di no e memoria e disco raccontano due storie diverse"
            );
        }
    }

    /// L'altro verso: un presidio che guarda solo il ramo d'errore è cieco a
    /// una riparazione che impedisce anche alla resurrezione riuscita di
    /// arrivare sul disco.
    #[test]
    fn a_resurrection_the_disk_accepts_is_alive_in_memory_and_on_disk() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "identico", &mut host).unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();

        host.avanza(1_000);
        store.snapshot(&id("a.md"), "identico", &mut host).unwrap();

        assert!(!store.is_deleted(&id("a.md")), "la nota è tornata viva");
        // Riaperto, e non da zero: uno store che sul disco non ha trovato
        // niente direbbe «non cancellata» anche di una nota che non conosce,
        // e il banco passerebbe a vuoto.
        let riaperto = VersionStore::open(&mut host).unwrap();
        assert_eq!(
            riaperto.list(&id("a.md")).len(),
            1,
            "il disco non sa niente di questa nota: la domanda sul tombstone non vuol dire nulla"
        );
        assert!(
            !riaperto.is_deleted(&id("a.md")),
            "viva in memoria e cestinata sul disco: al riavvio risorge il cestino"
        );
    }

    /// La stessa forma sull'altro verso del tombstone: chi lo posa lo eredita
    /// gratis, senza nessun ramo d'errore da ricordarsi di scrivere.
    #[test]
    fn a_tombstone_the_disk_refuses_leaves_the_note_alive_in_memory_too() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "contenuto", &mut host).unwrap();

        host.nega_scrittura(INDEX_FILE);
        host.avanza(1_000);
        assert!(store.tombstone(&id("a.md"), &mut host).is_err());

        assert!(
            !store.is_deleted(&id("a.md")),
            "la memoria l'ha già sepolta e il disco no: il cestino si svuota al riavvio"
        );
        assert!(!VersionStore::open(&mut host)
            .unwrap()
            .is_deleted(&id("a.md")));
    }

    /// E un salvataggio che non arriva sul disco non lascia in memoria un
    /// documento che il disco non ha mai visto: la cartella si sceglie
    /// leggendo, si registra scrivendo.
    #[test]
    fn a_snapshot_the_disk_refuses_does_not_invent_a_document() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        host.nega_scrittura(INDEX_FILE);

        assert!(store.snapshot(&id("a.md"), "contenuto", &mut host).is_err());
        assert!(
            store.documents().is_empty(),
            "l'anagrafe nomina un documento che sul disco non esiste"
        );
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

    /// Una cartella il cui `meta.json` non si legge **non** è una cartella
    /// libera.
    ///
    /// Il caso non ha bisogno di una collisione di impronte: dopo un rename la
    /// chiave migra e la cartella resta col nome dell'impronta vecchia, quindi
    /// basta che una nota rinasca con quel path per trovarsela davanti. Se
    /// l'anagrafe della cartella è illeggibile e la si dà via, la prima
    /// `scrivi_meta` ci scrive sopra un altro `doc_id`, e alla prima
    /// ricostruzione gli snapshot di `b.md` diventano versioni di `a.md`.
    #[test]
    fn a_folder_whose_meta_cannot_be_read_is_not_given_to_another_document() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), "la storia di a\n", &mut host)
            .unwrap();
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
        store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();
        assert_eq!(
            store.inner.lock().unwrap().docs["b.md"].dir,
            dir,
            "il banco non prova niente se la cartella si è mossa col rename"
        );
        let ts_di_b = store.list(&id("b.md"))[0].ts;

        // L'anagrafe della cartella si corrompe: un troncamento, un disco
        // pieno a metà scrittura.
        host.data_write(&blob(&dir, META_FILE), b"non sono json")
            .unwrap();

        // E una nota nuova nasce col path che quella cartella porta impresso
        // nel nome.
        host.avanza(1_000);
        store
            .snapshot(&id("a.md"), "una nota tutta nuova\n", &mut host)
            .unwrap();

        assert_ne!(
            store.inner.lock().unwrap().docs["a.md"].dir,
            dir,
            "la cartella di b.md è stata data ad a.md, e il suo meta.json \
             sovrascritto: la storia di b.md è diventata storia di a.md"
        );
        assert_eq!(
            store.read(&id("b.md"), ts_di_b, &host).unwrap(),
            "la storia di a\n",
            "la storia di b.md è ancora dov'era"
        );
    }

    /// Il rename che unisce due storie, con l'indice che dice di no proprio in
    /// mezzo: sul disco deve restare **una** rivendicazione per documento.
    ///
    /// La rivendicazione vecchia se ne andava dopo l'indice, con gli avanzi, e
    /// quella era la finestra: due cartelle che dicono `Nota.md`, e
    /// `rebuild_from_store` — un `BTreeMap` per `doc_id` — ne teneva quella che
    /// capitava per ultima. Qui capitava la cartella *senza* l'unione, quindi
    /// si perdevano due versioni su due.
    #[test]
    fn a_rename_the_index_refuses_leaves_one_claim_per_document() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("vecchia.md"), "storia che arriva\n", &mut host)
            .unwrap();
        host.avanza(1_000);
        store
            .snapshot(&id("Nota.md"), "storia che c'era\n", &mut host)
            .unwrap();

        host.avanza(1_000);
        host.nega_scrittura(INDEX_FILE);
        assert!(
            store
                .rename(&id("vecchia.md"), &id("Nota.md"), &mut host)
                .is_err(),
            "una scrittura negata non è un successo"
        );

        let rivendicano: Vec<String> = host
            .data_list("")
            .unwrap()
            .into_iter()
            .filter(|p| p.ends_with(META_FILE))
            .filter(|p| {
                let raw = host.data_read(p).unwrap().unwrap();
                serde_json::from_slice::<Meta>(&raw).is_ok_and(|m| m.doc_id == "Nota.md")
            })
            .collect();
        assert_eq!(
            rivendicano.len(),
            1,
            "due cartelle dicono di essere Nota.md: {rivendicano:?}"
        );

        // E l'indice si perde davvero: è la sola strada per cui una
        // rivendicazione doppia si vede, ed è quella per cui esiste.
        host.data_remove(INDEX_FILE).unwrap();
        let store = VersionStore::open(&mut host).unwrap();
        let versioni = store.list(&id("Nota.md"));
        assert_eq!(
            versioni.len(),
            2,
            "la ricostruzione ha perso una storia: {versioni:?}"
        );
        for v in &versioni {
            assert!(
                store.read(&id("Nota.md"), v.ts, &host).is_ok(),
                "l'indice ricostruito nomina la versione {} e il contenuto non c'è",
                v.ts
            );
        }
    }

    /// Il verso che l'audit aveva letto al contrario, e che va tenuto fermo.
    ///
    /// Fra `scrivi_meta` riuscita e `scrivi_index` fallita il `meta.json` resta
    /// **avanti** all'indice, e sembra una bugia sul disco. Non lo è: il disco
    /// è l'autorità e l'indice il derivato, e il meta è avanti *verso il vero* —
    /// la nota che risorge è viva davvero, quella che prende il tombstone è
    /// morta davvero. La ricostruzione che «risuscita la nota» non sta
    /// sbagliando: sta recuperando. Chi «riparasse» questo verso — riscrivendo
    /// il meta all'indietro dopo un indice fallito, o invertendo l'ordine —
    /// metterebbe il derivato davanti alla verità.
    ///
    /// Questo banco **non è mai stato rosso**, ed è il punto: tiene ferma la
    /// metà che l'audit aveva dichiarato guasta e che guasta non era.
    #[test]
    fn a_meta_the_index_did_not_follow_is_ahead_of_the_index_never_behind() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&id("a.md"), "identico", &mut host).unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();

        host.nega_scrittura(INDEX_FILE);
        host.avanza(1_000);
        assert!(
            store.snapshot(&id("a.md"), "identico", &mut host).is_err(),
            "una scrittura negata non è un successo"
        );
        // Indice e memoria restano indietro **insieme**: è la proprietà che
        // `applica` garantisce, e che gli altri banchi già misurano.
        assert!(store.is_deleted(&id("a.md")));

        // Ma il disco no. Persa l'anagrafe derivata, resta quella vera.
        host.data_remove(INDEX_FILE).unwrap();
        assert!(
            !VersionStore::open(&mut host)
                .unwrap()
                .is_deleted(&id("a.md")),
            "il meta è tornato indietro insieme all'indice: la verità sul disco \
             adesso segue il suo derivato"
        );
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
                lotto: false,
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
        host.write_document(&id("a.md"), "seconda", WriteBase::Dictated)
            .unwrap();
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

        let handler = VersioningHandler::new(store.clone());
        handler.first_snapshot_of_the_vault(&mut host).unwrap();

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
