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
//! La perdita tollerabile riguarda gli eventi di contenuto
//! ([`Event::DocumentChanged`] e [`Event::EntryChanged`]). Perdere un
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
//! `IndexQuery::Entries` elenca i file correnti, e ciò che lo store crede vivo e il
//! vault non ha più prende un tombstone. La frattura da rename perso degrada a
//! "nuova storia + tombstone della vecchia" — la cronologia si spezza, ma niente
//! mente sul presente, e il contenuto vecchio resta leggibile. Vedi
//! `../../../docs/project/status.md`, riga "Versioning".
//!
//! # Lo store, e chi comanda fra store e indice
//!
//! Path relativi allo spazio dati che l'host assegna al plugin
//! (`.fub/plugins/fub.versioning/`):
//!
//! ```text
//! versions.json                    indice: doc_id → versioni + tombstone
//! <dir>/meta.json                  { doc_id, deleted_at }
//! <dir>/<ts>.<ext>                 i byte originali di una versione
//! ```
//!
//! Gli snapshot e `meta.json` sono autorevoli; soltanto l'indice si può
//! ricostruire. La posizione sotto `.fub/plugins` non rende questi file cache
//! eliminabili.
//!
//! `versions.json` è **derivato**: se manca, non si legge o non torna, si
//! ricostruisce leggendo lo store (ogni cartella dice di chi è, ogni file dice
//! quando). Mai il contrario — stessa filosofia del manifest dell'indice di
//! ricerca. Per questo il `doc_id` vive anche dentro la cartella: senza, un
//! indice perso renderebbe le versioni irraggiungibili, visto che il nome della
//! cartella è un'impronta e le impronte non si invertono.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::Fnv1a;
use fub_abi::event::{Event, EventKind, EventMask, Notice, Severity};
use fub_abi::model::DocId;
use fub_abi::schema::SchemaVersion;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, EventHandler, HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance,
    ViewInterests, ViewProvider, ViewSpec, ViewSurface,
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
/// [decisione 0041](../../../docs/decisions/0192-impostazioni-locale-e-temi.md):
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
const CONTENT_MISMATCH: &str = "content_mismatch";
const UNREADABLE: &str = "unreadable";
const METADATA_UNWRITABLE: &str = "meta_unwritable";
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
const FIRST_VERSION: &str = "first_version";
const GREW: &str = "grew";
const SHRANK: &str = "shrank";
const SAME_SIZE: &str = "same_size";
const RESTORE_LABEL: &str = "restore";
const RESTORE_QUESTION: &str = "restore.question";
const RESTORE_CONFIRM_LABEL: &str = "restore.confirm";
const RESTORE_CANCEL_LABEL: &str = "restore.cancel";
const CLOSE_PREVIEW: &str = "close_preview";
const BINARY_PREVIEW: &str = "binary_preview";
const COMPARE_LABEL: &str = "compare";
const COPY_LABEL: &str = "copy";
const SHOW_TEXT: &str = "show_text";
const DIFF_SUMMARY: &str = "diff.summary";
const DIFF_SAME: &str = "diff.same";
const DIFF_ENDINGS: &str = "diff.endings";
const DIFF_TOO_LARGE: &str = "diff.too_large";
const DIFF_SKIPPED: &str = "diff.skipped";
const DIFF_TRUNCATED: &str = "diff.truncated";
const DIFF_BINARY: &str = "diff.binary";
/// Il titolo di una riga e dell'anteprima: **l'istante**, declinato. È una
/// chiave e non un `Arg::timestamp` nudo perché un `Text::Message` senza
/// template nel catalogo ricade sulla chiave nuda — e prima di questa chiave
/// la riga diceva letteralmente «when» al posto della data.
const WHEN_TITLE: &str = "when.title";
const RESTORE_TITLE: &str = "version.restore.title";
const RESTORE_DESC: &str = "version.restore.desc";
const RESTORE_DOC_TITLE: &str = "version.restore.doc.title";
const RESTORE_DOC_DESC: &str = "version.restore.doc.desc";
const RESTORE_TS_TITLE: &str = "version.restore.ts.title";
const RESTORE_TS_DESC: &str = "version.restore.ts.desc";
const PLAN_RESTORE: &str = "plan.restore";
const DONE_RESTORE: &str = "done.restore";
const UNDO_RESTORE: &str = "undo.restore";
const AND_NO_NOTES_GIVEN: &str = "err.no_note_given";
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
            .with(
                CONTENT_MISMATCH,
                "Lo snapshot {path} non corrisponde all'indice delle versioni.",
            )
            .with(UNREADABLE, "{path} non si legge: {reason}")
            .with(
                METADATA_UNWRITABLE,
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
            .with(CURRENT, "Versione attuale")
            .with(SIZE, "{size} byte")
            .with(FIRST_VERSION, "Prima versione · {size} byte")
            .with(GREW, "+{size} byte")
            .with(SHRANK, "−{size} byte")
            .with(SAME_SIZE, "Stessa dimensione")
            .with(WHEN, "{when}")
            .with(RESTORE_LABEL, "Ripristina")
            .with(
                RESTORE_QUESTION,
                "Riportare la nota a questa versione? Il testo di adesso resta nella cronologia.",
            )
            .with(RESTORE_CONFIRM_LABEL, "Sì, ripristina")
            .with(RESTORE_CANCEL_LABEL, "Annulla")
            .with(CLOSE_PREVIEW, "Chiudi l'anteprima")
            .with(
                BINARY_PREVIEW,
                "Versione binaria: {size} byte. Puoi ripristinarla senza convertirla in testo.",
            )
            .with(COMPARE_LABEL, "Confronta con l'attuale")
            .with(COPY_LABEL, "Copia il testo")
            .with(SHOW_TEXT, "Mostra il testo")
            .with(
                DIFF_SUMMARY,
                "Rispetto a questa versione, la nota attuale ha {added} righe in più e {removed} in meno.",
            )
            .with(DIFF_SAME, "Nessuna differenza: la nota attuale è identica.")
            .with(
                DIFF_ENDINGS,
                "Stesso testo riga per riga: cambiano solo i terminatori di riga.",
            )
            .with(
                DIFF_TOO_LARGE,
                "Troppe righe diverse per un confronto riga per riga ({lines}).",
            )
            .with(DIFF_SKIPPED, "… {count} righe uguali")
            .with(DIFF_TRUNCATED, "… altre {count} righe non mostrate")
            .with(
                DIFF_BINARY,
                "Una delle due versioni non è testo: il confronto riga per riga non si applica.",
            )
            .with(WHEN_TITLE, "Versione del {when}")
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
            .with(AND_NO_NOTES_GIVEN, "Nessuna nota da ripristinare.")
            .with(E_NO_TS_GIVEN, "Nessun istante da ripristinare."),
        StringCatalog::new("en")
            .with(NO_VERSIONS, "No version of {doc}.")
            .with(NO_SUCH_VERSION, "There is no version of {doc} from {when}.")
            .with(CONTENT_GONE, "The content of {path} is gone.")
            .with(
                CONTENT_MISMATCH,
                "Snapshot {path} does not match the versions index.",
            )
            .with(UNREADABLE, "{path} cannot be read: {reason}")
            .with(
                METADATA_UNWRITABLE,
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
            .with(CURRENT, "Current version")
            .with(SIZE, "{size} bytes")
            .with(FIRST_VERSION, "First version · {size} bytes")
            .with(GREW, "+{size} bytes")
            .with(SHRANK, "−{size} bytes")
            .with(SAME_SIZE, "Same size")
            .with(WHEN, "{when}")
            .with(RESTORE_LABEL, "Restore")
            .with(
                RESTORE_QUESTION,
                "Take the note back to this version? The current text stays in the history.",
            )
            .with(RESTORE_CONFIRM_LABEL, "Yes, restore")
            .with(RESTORE_CANCEL_LABEL, "Cancel")
            .with(CLOSE_PREVIEW, "Close the preview")
            .with(
                BINARY_PREVIEW,
                "Binary version: {size} bytes. You can restore it without converting it to text.",
            )
            .with(COMPARE_LABEL, "Compare with current")
            .with(COPY_LABEL, "Copy the text")
            .with(SHOW_TEXT, "Show the text")
            .with(
                DIFF_SUMMARY,
                "Compared with this version, the current note has {added} more lines and {removed} fewer.",
            )
            .with(DIFF_SAME, "No difference: the current note is identical.")
            .with(
                DIFF_ENDINGS,
                "Same text line by line: only the line terminators change.",
            )
            .with(
                DIFF_TOO_LARGE,
                "Too many differing lines for a line-by-line comparison ({lines}).",
            )
            .with(DIFF_SKIPPED, "… {count} identical lines")
            .with(DIFF_TRUNCATED, "… {count} more lines not shown")
            .with(
                DIFF_BINARY,
                "One of the two versions is not text: a line-by-line comparison does not apply.",
            )
            .with(WHEN_TITLE, "Version from {when}")
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
            .with(AND_NO_NOTES_GIVEN, "No note to restore.")
            .with(E_NO_TS_GIVEN, "No instant to restore."),
    ]
}

const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

const INDEX_FILE: &str = "versions.json";
const METADATA_FILE: &str = "meta.json";

const MS_HOUR: u64 = 3_600_000;
const MS_DAY: u64 = 24 * MS_HOUR;

/// Fasce di ritenzione (D6): sotto le 24 ore si tiene **tutto**, fino a una
/// settimana una versione all'ora, fino a tre mesi una al giorno. Oltre, la
/// storia recente — quella che si ripesca davvero — è già al sicuro.
const BAND_ALL: u64 = MS_DAY;
const BAND_HOURLY: u64 = 7 * MS_DAY;
const BAND_DAILY: u64 = 90 * MS_DAY;

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
///
/// `docs` è generico e non un `&BTreeMap` perché i due chiamanti hanno in mano
/// due cose diverse: [`VersionStore::in_lotto`] ha l'anagrafe viva, e
/// [`Inner::apply`] ha l'anagrafe viva **più un piano** che non è ancora
/// stato installato ([`PlanDocs`]).
#[derive(Serialize)]
struct IndexToWrite<D: Serialize> {
    schema_version: SchemaVersion,
    docs: D,
}

/// Che cosa una scrittura cambia nell'anagrafe: **le chiavi che tocca**.
///
/// È l'unità del piano, e ha due varianti perché una scrittura può far sparire
/// una chiave — [`VersionStore::rename`] la fa — e «assente dal piano» vuol già
/// dire «non toccata». Un `Option` le confonderebbe.
enum Entry {
    /// Come sarà quel documento se il disco accetta.
    Present(DocVersions),
    /// Quel documento non ci sarà più.
    Removed,
}

/// Il piano: le sole chiavi toccate, con ciò che diranno.
///
/// **Non** è una copia dell'anagrafe. Lo era: ogni scrittura cominciava con un
/// `docs.clone()`, cioè copiava la mappa che nomina *tutti* i documenti del
/// vault per cambiarne una voce sola, e questo rendeva ogni fotografia
/// proporzionale al vault intero — quadratico nella passata di apertura (3,5 s
/// su 5 000 note, 79 s su 20 000) e lineare in ogni salvataggio a vault aperto
/// (8,5 ms contro 0,09 ms su 16 000 note, sotto il prestito esclusivo). Quel
/// che serviva davvero della copia non era la mappa: era **non installare
/// niente finché il disco non ha accettato**, e per quello basta un elenco di
/// una chiave (due nel rename). Vedi [`Inner::apply`], dove la disciplina è
/// scritta per intero.
type Plan = BTreeMap<String, Entry>;

/// Il piano di una chiave sola: la forma di tutte le scritture tranne il
/// rename.
fn plan_of(id: &DocId, doc: DocVersions) -> Plan {
    Plan::from([(id.to_string(), Entry::Present(doc))])
}

/// L'anagrafe **come sarà** se il disco accetta il piano, senza costruirla.
///
/// Serve a scrivere `versions.json`, che nomina tutti i documenti e quindi
/// costa O(N) byte per definizione: il punto non è scrivere di meno, è non
/// **copiare** N voci per scriverne N. Le due mappe sono ordinate sulla stessa
/// chiave, quindi si fondono scorrendole in parallelo, e ciò che il piano
/// dichiara [`Voce::Tolta`] semplicemente non esce.
struct PlanDocs<'a> {
    live: &'a BTreeMap<String, DocVersions>,
    plan: &'a Plan,
}

impl Serialize for PlanDocs<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        // La lunghezza non si dichiara perché non si conosce senza contare, e
        // contare vorrebbe dire scorrere due volte: JSON non ne ha bisogno.
        let mut map = serializer.serialize_map(None)?;
        let mut live = self.live.iter().peekable();
        let mut touched = self.plan.iter().peekable();
        loop {
            let order = match (live.peek(), touched.peek()) {
                (None, None) => break,
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some((live, _)), Some((touched, _))) => live.as_str().cmp(touched.as_str()),
            };
            if order == std::cmp::Ordering::Less {
                let (key, doc) = live.next().expect("c'è, l'ho appena guardato");
                map.serialize_entry(key, doc)?;
                continue;
            }
            // Il piano ha l'ultima parola sulla chiave che nomina: se è anche
            // viva, la voce viva si salta.
            if order == std::cmp::Ordering::Equal {
                live.next();
            }
            let (key, entry) = touched.next().expect("c'è, l'ho appena guardato");
            if let Entry::Present(doc) = entry {
                map.serialize_entry(key, doc)?;
            }
        }
        map.end()
    }
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
/// a [`Inner::dir_for`] «libera» di una cartella piena, e a quel punto la prima
/// [`write_metadata`] ci scriveva sopra il nome di un altro documento.
enum Claim {
    /// Nessun `meta.json`: la cartella non è di nessuno.
    None,
    /// Un `meta.json` c'è e non si legge. **Non** è una cartella libera.
    Unreadable,
    /// La cartella dice di chi è.
    Owned(Meta),
}

struct Inner {
    docs: BTreeMap<String, DocVersions>,
    /// C'è un lotto aperto ([`VersionStore::in_lotto`])?
    ///
    /// Dentro un lotto [`Inner::apply`] scrive il `meta.json` — che è
    /// l'autorità — e **non** l'indice, che è il derivato e si compone in fondo
    /// una volta sola. Il flag sta qui e non nel chiamante perché la regola
    /// deve valere per **ogni** strada che passa da `apply`: chi domani
    /// aggiungesse un `VersioningHandler::sweep` chiamato dentro una passata la
    /// eredita senza saperlo, e un lotto che valesse solo per `snapshot`
    /// riscriverebbe di nuovo l'indice a ogni tombstone della riconciliazione.
    batch: bool,
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
    /// [`Inner::apply`] costruisce il piano da ciò che `docs` dice *adesso* e
    /// lo installa solo se il disco l'ha accettato: mollare il prestito in
    /// mezzo darebbe a due salvataggi la stessa base, e il secondo cancellerebbe
    /// il primo senza che nessuno dei due se ne accorga. Là il prestito che
    /// attraversa il `data_write` **è** l'atomicità, non un difetto, e togliere
    /// l'I/O da sotto spezzerebbe questa proprietà e confonderebbe il confine
    /// fra lettura e scrittura.
    ///
    /// In lettura no: quello che serve è il path, e [`Inner::path`] lo
    /// consegna con la guardia già finita. Vedi [`VersionStore::read`].
    inner: Arc<Mutex<Inner>>,
}

impl VersionStore {
    /// Apre (o crea) lo store nello spazio dati del plugin.
    pub fn open(host: &mut dyn HostApi) -> Result<Self, PluginError> {
        let docs = match load_index(host) {
            Some(docs) => docs,
            None => {
                let rebuilt = rebuild_from_store(host)?;
                if !rebuilt.is_empty() {
                    // Ripubblica il derivato quando possibile. Se il cache non
                    // si può scrivere, i lettori ricostruiscono dagli snapshot.
                    if let Err(error) = write_index(&rebuilt, host) {
                        host.emit(Event::Trouble {
                            severity: Severity::Warning,
                            subject: None,
                            error,
                            gate: None,
                        });
                    }
                    tracing::info!(
                        target: "fub.versioning",
                        "indice assente o illeggibile, ricostruito dallo store \
                         ({} document{})",
                        rebuilt.len(),
                        if rebuilt.len() == 1 { "o" } else { "i" }
                    );
                }
                rebuilt
            }
        };
        Ok(VersionStore {
            inner: Arc::new(Mutex::new(Inner { docs, batch: false })),
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
    /// Durante il lotto l'indice è assente. I lettori ricostruiscono la vista
    /// dagli snapshot già persistiti: vedono il progresso durevole, senza
    /// interpretare l'indice mancante come una cronologia vuota.
    fn in_batch<T>(
        &self,
        host: &mut dyn HostApi,
        pass: impl FnOnce(&mut dyn HostApi) -> T,
    ) -> Result<T, PluginError> {
        // Se togliere l'indice non riesce, la passata **non comincia**: andare
        // avanti vorrebbe dire lasciare sul disco esattamente l'indice vecchio
        // che questa forma esiste per non lasciare. E un `data_remove` che
        // fallisce su uno spazio dati è lo stesso guasto per cui fallirebbe
        // ogni `data_write` che segue.
        host.data_remove(INDEX_FILE)?;
        self.inner.lock().expect("mutex").batch = true;
        let batch_guard = Batch { inner: &self.inner };
        let result = pass(&mut *host);
        drop(batch_guard);
        // Il prestito attraversa il `data_write` come lo attraversa in
        // [`Inner::apply`], e per la stessa ragione: l'indice che va sul disco
        // dev'essere quello che `docs` dice *adesso*. Mollandolo in mezzo, un
        // salvataggio che entrasse qui scriverebbe il suo indice e poi questo ci
        // scriverebbe sopra il proprio, più vecchio di una versione.
        let inner = self.inner.lock().expect("mutex");
        write_index(&inner.docs, host)?;
        Ok(result)
    }

    /// Salva una versione, se il contenuto è diverso dall'ultima salvata.
    ///
    /// Restituisce `None` quando il dedup (D6) ha deciso che non c'era niente
    /// di nuovo: è il caso normale del salvataggio che riscrive gli stessi byte.
    pub fn snapshot(
        &self,
        id: &DocId,
        source: &[u8],
        host: &mut dyn HostApi,
    ) -> Result<Option<VersionRef>, PluginError> {
        let mut inner = self.inner.lock().expect("mutex");
        let hash = Fnv1a::hash(source);
        let dir_doc = inner.dir_for(id, host)?;

        if let Some(doc) = inner.docs.get(id.as_str()) {
            if doc.versions.last().is_some_and(|v| v.hash == hash) {
                // Niente di nuovo da salvare — ma ci hanno chiesto di
                // fotografare una nota VIVA: se portava un tombstone
                // (cestinata e ripristinata con lo stesso identico contenuto)
                // il tombstone se ne va comunque, o "il vault al tempo T" la
                // crederebbe cancellata per sempre.
                if doc.deleted_at.is_some() {
                    let mut restored = doc.clone();
                    restored.deleted_at = None;
                    inner.apply(plan_of(id, restored), id, host)?;
                }
                return Ok(None);
            }
        }

        let ts = inner.free_ts(id, host);
        host.data_write(&blob(&dir_doc, &snapshot_name(ts, id.as_str())), source)?;

        let version = VersionRef {
            ts,
            hash,
            size: source.len() as u64,
        };
        let mut doc = inner.docs.get(id.as_str()).cloned().unwrap_or_default();
        doc.dir = dir_doc;
        doc.versions.push(version);
        // Una nota che torna in vita non è più morta: il tombstone se ne va, o
        // "il vault al tempo T" la crederebbe cancellata per sempre.
        doc.deleted_at = None;

        // La potatura decide **prima** e cancella **dopo**: `prune` tocca solo
        // l'elenco del piano e dice quali contenuti avanzano, l'indice va sul
        // disco, e solo un indice già scritto autorizza a togliere i blob. Se
        // `apply` fallisce si esce di qui con tutti i contenuti al loro posto
        // e un indice vecchio che li nomina tutti: si perde la potatura, non
        // una versione. Stessa forma di `rename`, stessa ragione di `relocate`
        // — vedi il commento là.
        let pruned = prune(&mut doc, id, host);
        inner.apply(plan_of(id, doc), id, host)?;
        if !pruned.is_empty() {
            tracing::info!(
                target: "fub.versioning",
                "{} version{} di {id} potate dalle fasce di ritenzione",
                pruned.len(),
                if pruned.len() == 1 { "e" } else { "i" }
            );
        }
        sweep(&pruned, host);
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
        let existing = inner.docs.get(to.as_str()).cloned();
        let relocation = relocate(&doc, from, existing.as_ref(), to, host)?;
        // Da qui l'indice si muove, e si muove su contenuti già al loro posto.
        // Le due sole chiavi che cambiano. L'ordine dei due `insert` conta se
        // `from` e `to` coincidono — un rename di solo caso su un filesystem
        // che non lo distingue: là la chiave resta, con la storia unita.
        let mut plan = Plan::new();
        plan.insert(from.to_string(), Entry::Removed);
        plan.insert(to.to_string(), Entry::Present(relocation.doc));
        inner.apply(plan, to, host)?;
        // Ultimo ciò che resta indietro: è spazio sprecato, non una bugia, e
        // non vale la pena di far fallire un rename già andato a buon fine.
        sweep(&relocation.to_remove, host);
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
        let mut deleted = doc.clone();
        deleted.deleted_at = Some(now);
        inner.apply(plan_of(id, deleted), id, host)
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
    /// e quello finisce con [`Inner::path`], che è l'unica a vederlo. Da qui
    /// in giù non c'è nessuna guardia da tenere: la lettura del blob è di chi ha
    /// il path.
    pub fn read(&self, id: &DocId, ts: u64, host: &dyn ReadApi) -> Result<String, PluginError> {
        let (path, version) = self.inner.lock().expect("mutex").path(id, ts)?;
        let bytes = read_snapshot(&path, version, host)?;
        String::from_utf8(bytes).map_err(|and| {
            PluginError::Internal(Text::message(
                UNREADABLE,
                vec![Arg::text(PATH, path), Arg::text(REASON, and.to_string())],
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
    /// Esiste per una ragione sola, ed è la stessa per cui [`Inner::apply`] è
    /// il posto unico in cui `docs` cambia: qui il prestito dello store finisce
    /// **prima** dell'I/O, e finisce per costruzione — chi legge il blob riceve
    /// il path e i metadati di verifica, non una guardia sullo store. La
    /// forma opposta — un `lock()` in testa a [`VersionStore::read`] e un
    /// `data_read` sotto — è quella che due lettori di cronologia si passavano
    /// uno alla volta, ognuno aspettando l'I/O dell'altro.
    ///
    /// Il verso opposto vale nelle **scritture**, e non è una svista: là il
    /// prestito attraversa il disco apposta, perché il piano si costruisce da ciò
    /// che c'è adesso e si installa solo se il disco l'ha accettato. Toglierlo di
    /// lì non toglierebbe un'attesa: aprirebbe una finestra in cui due
    /// salvataggi pianificano dalla stessa base e il secondo cancella il primo.
    fn path(&self, id: &DocId, ts: u64) -> Result<(String, VersionRef), PluginError> {
        let doc = self.docs.get(id.as_str()).ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                NO_VERSIONS,
                vec![Arg::text(DOC, id.as_str())],
            ))
        })?;
        let version = doc.versions.iter().find(|v| v.ts == ts).ok_or_else(|| {
            PluginError::BadArgs(Text::message(
                NO_SUCH_VERSION,
                vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
            ))
        })?;
        Ok((blob(&doc.dir, &snapshot_name(ts, id.as_str())), *version))
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
    /// solo passando per [`Inner::apply`]. Prenotarlo qui vorrebbe dire
    /// lasciare in memoria, dopo un salvataggio fallito, un documento che il
    /// disco non ha mai visto.
    fn dir_for(&self, id: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
        if let Some(doc) = self.docs.get(id.as_str()) {
            if !doc.dir.is_empty() {
                return Ok(doc.dir.clone());
            }
        }
        let base = format!("{:016x}", fingerprint(id.as_str()));
        for n in 0u32.. {
            let name = if n == 0 {
                base.clone()
            } else {
                format!("{base}-{n}")
            };
            let is_free = match claim_of(&name, host)? {
                Claim::None => true,
                Claim::Owned(metadata) => metadata.doc_id == id.as_str(),
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
                Claim::Unreadable => false,
            };
            if is_free {
                return Ok(name);
            }
        }
        unreachable!("la sequenza dei nomi è infinita")
    }

    /// Un istante non ancora usato da questo documento, e **mai prima**
    /// dell'ultimo: due salvataggi nello stesso millisecondo sono improbabili,
    /// ma sovrascriversi a vicenda no — e se l'orologio torna indietro fra due
    /// salvataggi (NTP, fuso, VM), `versions` deve restare ordinato per tempo:
    /// è dato persistito, e su di esso ragionano "attuale" in `list` e la
    /// protezione della più recente in [`prune`].
    fn free_ts(&self, id: &DocId, host: &dyn HostApi) -> u64 {
        let ts = host.now_unix_millis();
        let minimum = self
            .docs
            .get(id.as_str())
            .and_then(|d| d.versions.iter().map(|v| v.ts).max())
            .map_or(0, |last| last + 1);
        ts.max(minimum)
    }

    /// Rende vero sul disco lo stato che i documenti **avranno**, e solo se il
    /// disco l'ha accettato lo installa in memoria.
    ///
    /// È il posto **unico** in cui `Inner::docs` cambia, ed è la ragione per
    /// cui [`Inner::dir_for`] e [`prune`] lavorano su un piano invece che sullo
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
    /// sul disco restino una per documento: quella la tiene [`relocate`],
    /// togliendo la rivendicazione vecchia prima che qui se ne scriva una nuova.
    fn apply(
        &mut self,
        plan: Plan,
        metadata_doc: &DocId,
        host: &mut dyn HostApi,
    ) -> Result<(), PluginError> {
        if let Some(Entry::Present(doc)) = plan.get(metadata_doc.as_str()) {
            write_metadata(metadata_doc, doc, host)?;
        }
        // Dentro un lotto l'indice non si scrive: lo scrive
        // [`VersionStore::in_lotto`] una volta sola, in fondo. Il piano si
        // installa lo stesso, e non è un'eccezione alla regola di sopra — è la
        // stessa regola letta sull'autorità giusta. Ciò che il disco ha
        // accettato qui è il `meta.json`, e il `meta.json` è la verità;
        // l'indice ne è il derivato, e un derivato che manca non è una bugia,
        // è la condizione da cui [`VersionStore::open`] ricostruisce.
        if !self.batch {
            write_index(
                PlanDocs {
                    live: &self.docs,
                    plan: &plan,
                },
                host,
            )?;
        }
        // E solo adesso il piano entra: una chiave per volta, non una mappa al
        // posto di un'altra. Ciò che il piano non nomina non è cambiato.
        for (key, entry) in plan {
            match entry {
                Entry::Present(doc) => {
                    self.docs.insert(key, doc);
                }
                Entry::Removed => {
                    self.docs.remove(&key);
                }
            }
        }
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
struct Batch<'a> {
    inner: &'a Mutex<Inner>,
}

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.batch = false;
        }
    }
}

fn write_metadata(
    id: &DocId,
    doc: &DocVersions,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    let metadata = Meta {
        doc_id: id.to_string(),
        deleted_at: doc.deleted_at,
    };
    let raw = serde_json::to_vec(&metadata).map_err(|and| {
        PluginError::Internal(Text::message(
            METADATA_UNWRITABLE,
            vec![Arg::text(REASON, and.to_string())],
        ))
    })?;
    host.data_write(&blob(&doc.dir, METADATA_FILE), &raw)
}

fn write_index(docs: impl Serialize, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let index = IndexToWrite {
        schema_version: SCHEMA_VERSION,
        docs,
    };
    let raw = serde_json::to_vec(&index).map_err(|and| {
        PluginError::Internal(Text::message(
            INDEX_UNWRITABLE,
            vec![Arg::text(REASON, and.to_string())],
        ))
    })?;
    host.data_write(INDEX_FILE, &raw)
}

/// Applica le fasce di ritenzione (D6) all'elenco **del plan** e
/// **restituisce i contenuti che avanzano**, senza cancellarne nessuno.
///
/// Non cancella perché non può saperlo: finché l'indice potato non è sul disco,
/// i blob che qui risultano di troppo sono ancora nominati dall'indice che c'è,
/// e toglierli lo renderebbe bugiardo. Li spazza chi chiama, dopo
/// [`Inner::apply`], con [`sweep`]. La direzione innocua dell'errore è il
/// blob orfano — costa spazio; quella rovinosa è l'indice che nomina un
/// contenuto sparito, che rompe ogni [`VersionStore::read`].
///
/// Pota il **piano** e non lo stato vivo per la stessa ragione: assottigliare
/// l'elenco in memoria e poi non riuscire a scrivere l'indice toglierebbe da
/// sotto gli occhi versioni che sul disco ci sono ancora.
#[must_use = "sono i contenuti da spazzare dopo aver scritto l'indice"]
fn prune(doc: &mut DocVersions, id: &DocId, host: &dyn HostApi) -> Vec<String> {
    let now = host.now_unix_millis();
    let mut kept: Vec<VersionRef> = Vec::with_capacity(doc.versions.len());
    let mut fasce_seen: Vec<(u8, u64)> = Vec::new();
    // Dalla più recente: dentro ogni fascia vince la più recente.
    for (the, v) in doc.versions.iter().rev().enumerate() {
        let eta = now.saturating_sub(v.ts);
        // La più recente non si pota mai: è la versione che rappresenta lo
        // stato attuale della nota, anche se la nota è ferma da un anno.
        let key = if the == 0 || eta < BAND_ALL {
            None
        } else if eta < BAND_HOURLY {
            Some((1, v.ts / MS_HOUR))
        } else if eta < BAND_DAILY {
            Some((2, v.ts / MS_DAY))
        } else {
            continue; // oltre l'ultima fascia: non si conserva
        };
        if let Some(key) = key {
            if fasce_seen.contains(&key) {
                continue;
            }
            fasce_seen.push(key);
        }
        kept.push(*v);
    }
    kept.reverse();
    if kept.len() == doc.versions.len() {
        return Vec::new();
    }

    let kept_timestamps: HashSet<u64> = kept.iter().map(|t| t.ts).collect();
    let advanced: Vec<String> = doc
        .versions
        .iter()
        .filter(|v| !kept_timestamps.contains(&v.ts))
        .map(|v| blob(&doc.dir, &snapshot_name(v.ts, id.as_str())))
        .collect();
    doc.versions = kept;
    advanced
}

/// Toglie dallo store contenuti che l'indice **già scritto** non nomina più.
///
/// È il posto unico in cui il versioning cancella un blob, e non rende un
/// errore di proposito: qui si arriva solo a indice persistito, e a quel punto
/// un contenuto che non se ne va è spazio sprecato — non una bugia. Chiamarla
/// prima di [`Inner::apply`] è l'inversione che rompe tutto, ed è la
/// ragione per cui [`prune`] restituisce path invece di cancellarli.
fn sweep(paths: &[String], host: &mut dyn HostApi) {
    for path in paths {
        if let Err(and) = host.data_remove(path) {
            tracing::warn!(target: "fub.versioning", "{path} è rimasto indietro e non se ne va: {and}");
        }
    }
}

/// L'esito di un trasloco: la storia unita, e i blob rimasti indietro.
struct Relocation {
    doc: DocVersions,
    to_remove: Vec<String>,
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
fn relocate(
    doc: &DocVersions,
    from: &DocId,
    existing: Option<&DocVersions>,
    to: &DocId,
    host: &mut dyn HostApi,
) -> Result<Relocation, PluginError> {
    // Dove sta ogni contenuto adesso: la storia che arriva è ancora sotto la
    // sua cartella e col nome che le dava il path vecchio, quella che c'era già
    // sta sotto una cartella tutta sua.
    let mut candidate: Vec<(String, VersionRef)> = doc
        .versions
        .iter()
        .map(|v| (blob(&doc.dir, &snapshot_name(v.ts, from.as_str())), *v))
        .collect();
    if let Some(existing) = existing {
        candidate.extend(
            existing
                .versions
                .iter()
                .map(|v| (blob(&existing.dir, &snapshot_name(v.ts, to.as_str())), *v)),
        );
    }
    // Ordinamento stabile: a parità di istante la storia che arriva viene
    // prima, ed è quella che si tiene il suo `ts`.
    candidate.sort_by_key(|(_, v)| v.ts);

    // La cartella che sopravvive è quella della storia che arriva. Una sola
    // cartella per documento non è un vezzo: `rebuild_from_store` si fida di
    // `meta.json`, e due cartelle che dichiarano lo stesso `doc_id` si
    // sovrascriverebbero a vicenda, con una delle due storie persa in silenzio.
    let dir = match (doc.dir.is_empty(), existing) {
        (true, Some(existing)) => existing.dir.clone(),
        _ => doc.dir.clone(),
    };
    let mut versions: Vec<VersionRef> = Vec::with_capacity(candidate.len());
    let mut destinations: Vec<String> = Vec::with_capacity(candidate.len());
    let mut to_remove: Vec<String> = Vec::new();
    let mut copies: Vec<(usize, Vec<u8>)> = Vec::new();

    for (origin, mut v) in candidate {
        match versions.last() {
            // Stesso istante e stesso contenuto: è la stessa fotografia
            // arrivata da due storie, non due versioni.
            Some(u) if u.ts == v.ts && u.hash == v.hash => {
                to_remove.push(origin);
                continue;
            }
            // Stesso istante ma contenuti diversi: sono due fotografie davvero
            // distinte, e `ts` è l'identità di una versione. Slitta di un
            // millisecondo — sparire in silenzio è ciò che non deve fare.
            Some(u) if v.ts <= u.ts => v.ts = u.ts + 1,
            _ => {}
        }
        let destination = blob(&dir, &snapshot_name(v.ts, to.as_str()));
        let copy = if destination != origin {
            let Some(bytes) = host.data_read(&origin)? else {
                // L'indice nominava un contenuto che non c'è più: non lo si
                // porta dietro, o continuerebbe a mentire sotto la chiave nuova.
                tracing::warn!(
                    target: "fub.versioning",
                    "{origin} non c'è più, la versione {} esce dalla storia di {to}",
                    v.ts
                );
                continue;
            };
            to_remove.push(origin);
            Some(bytes)
        } else {
            None
        };
        destinations.push(destination);
        versions.push(v);
        if let Some(bytes) = copy {
            copies.push((destinations.len() - 1, bytes));
        }
    }

    // Nessuna destinazione può più essere l'origine che un giro successivo deve
    // ancora leggere: soltanto adesso, a letture finite, i blob si riscrivono.
    for (index, bytes) in copies {
        host.data_write(&destinations[index], &bytes)?;
    }

    // La cartella abbandonata smette di dire di chi è **qui**, prima che
    // `apply` scriva la rivendicazione nuova — e non dopo, con gli altri
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
    if let Some(existing) = existing {
        if existing.dir != dir {
            host.data_remove(&blob(&existing.dir, METADATA_FILE))?;
        }
    }
    // Un contenuto che serve ancora non si cancella, per quanto il suo vecchio
    // nome sia finito nella lista.
    to_remove.retain(|p| !destinations.contains(p));

    Ok(Relocation {
        doc: DocVersions {
            dir,
            // Il documento è vivo: è appena arrivato qui con un rename.
            deleted_at: None,
            versions,
        },
        to_remove,
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

fn read_index(host: &dyn ReadApi) -> Result<BTreeMap<String, DocVersions>, PluginError> {
    match load_index(host) {
        Some(docs) => Ok(docs),
        None => rebuild_from_store(host),
    }
}

fn claim_of(dir: &str, host: &dyn ReadApi) -> Result<Claim, PluginError> {
    let Some(raw) = host.data_read(&blob(dir, METADATA_FILE))? else {
        return Ok(Claim::None);
    };
    Ok(match serde_json::from_slice(&raw) {
        Ok(metadata) => Claim::Owned(metadata),
        Err(_) => Claim::Unreadable,
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
fn rebuild_from_store(host: &dyn ReadApi) -> Result<BTreeMap<String, DocVersions>, PluginError> {
    // I blob sono ordinati, quindi quelli di una stessa cartella sono contigui.
    let mut for_dir: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let blobs = host.data_list("")?;
    for path in &blobs {
        // Solo il primo livello: la struttura dello store è `<dir>/<file>`, e
        // ciò che sta alla radice (l'indice) non è uno snapshot.
        if let Some((dir, name)) = path.split_once('/') {
            if !name.contains('/') {
                for_dir.entry(dir).or_default().push(name);
            }
        }
    }

    let mut docs = BTreeMap::new();
    for (dir, names) in for_dir {
        let metadata = match claim_of(dir, host)? {
            Claim::Owned(metadata) => metadata,
            Claim::None => {
                tracing::warn!(target: "fub.versioning", "{dir} non dice di chi è, la salto");
                continue;
            }
            // Diverso dal caso sopra, e vale la pena dirlo: qui una storia c'è
            // e resta sul disco, fuori dall'indice finché quel `meta.json` non
            // torna leggibile. Nessun altro se la prende — [`Inner::dir_per`]
            // non dà via una cartella che non sa leggere — e il primo
            // salvataggio del suo proprietario la riscrive.
            Claim::Unreadable => {
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
            versions.push(VersionRef {
                ts,
                hash: Fnv1a::hash(&bytes),
                size: bytes.len() as u64,
            });
        }
        versions.sort_by_key(|v| v.ts);
        docs.insert(
            metadata.doc_id,
            DocVersions {
                dir: dir.to_string(),
                deleted_at: metadata.deleted_at,
                versions,
            },
        );
    }
    Ok(docs)
}

/// La stessa impronta stabile fra versioni di Rust e piattaforme che usa
/// l'indice di ricerca — questi valori sopravvivono su disco. Il commento lo
/// dichiarava già da prima che fosse vero: adesso è la [`Fnv1a`] del contratto,
/// non una terza copia delle stesse due costanti.
fn fingerprint(source: &str) -> u64 {
    Fnv1a::hash(source.as_bytes())
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
    fn sweep(&self, host: &mut dyn HostApi, who: Pass) -> Result<(), PluginError> {
        let documents = self.existing(host)?;
        // Una passata è un **lotto**: le fotografie vanno sul disco una per una
        // — blob e `meta.json`, che sono l'autorità — e l'indice, che è il
        // derivato, si scrive una volta sola in fondo. Fuori di qui l'indice
        // resta scritto a ogni salvataggio: è il costo onesto di un indice, e
        // diventa un difetto solo quando lo si paga N volte di fila.
        let result = self.store.in_batch(host, |host| {
            for id in documents {
                if matches!(who, Pass::OnlyNew) && self.store.has_versions(&id) {
                    continue;
                }
                // Una nota illeggibile o non salvabile non deve impedire
                // l'apertura del vault: il vault è la verità, le versioni no.
                match host.read_document_bytes(&id) {
                    Ok(source) => {
                        if let Err(and) = self.store.snapshot(&id, &source, host) {
                            tracing::warn!(target: "fub.versioning", "versione di {id} non salvata: {and}");
                            // Una versione attesa non salvata è una perdita
                            // autorevole (0052: `Failure`): l'errore è già un
                            // `PluginError` catalogato, e lo si porta nel canale tale
                            // e quale invece di ricomporlo (0062).
                            host.emit(Event::Trouble {
                                severity: Severity::Failure,
                                subject: Some(id.clone()),
                                error: and,
                                gate: None,
                            });
                        }
                    }
                    Err(and) => {
                        tracing::warn!(target: "fub.versioning", "{id} non si legge: {and}");
                        host.emit(Event::Trouble {
                            severity: Severity::Failure,
                            subject: Some(id.clone()),
                            error: and,
                            gate: None,
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
        if let Err(and) = result {
            tracing::warn!(
                target: "fub.versioning",
                "l'indice non si è scritto dopo la passata: resta da \
                 ricostruire alla prossima apertura ({and})"
            );
            host.emit(Event::Trouble {
                severity: Severity::Failure,
                subject: None,
                error: and,
                gate: None,
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
    /// [0068](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
    /// — uno scarto è un documento che esiste e non è indicizzato — ma là la
    /// divergenza era rara e piccola; qui è la normalità per tutta la durata
    /// dell'indicizzazione. E per questa passata l'anagrafe è la sorgente
    /// giusta anche nel merito: si fotografa ciò che sta **sul disco**, e
    /// `read_document_bytes` legge dal disco, non dall'indice.
    fn existing(&self, host: &mut dyn HostApi) -> Result<Vec<DocId>, PluginError> {
        let answer = host.query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })?;
        match answer {
            IndexResult::Entries(paged) => {
                Ok(paged.items.into_iter().map(|entry| entry.id).collect())
            }
            other => Err(PluginError::Internal(
                format!("l'anagrafe ha risposto con {other:?}").into(),
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
    /// **Non la chiama più il runner all'apertura** (0154): la fotografia è
    /// diventata copy-on-first-write, e questo metodo resta come unità
    /// riusabile — i test la chiamano a mano per avere lo stato che il gancio
    /// produce da solo. La riconciliazione dopo un `Overflow` passa da
    /// `sweep(Tutti)`, non da qui: `Tutti` fotografa anche chi non ha storia,
    /// col dedup. Il *quando* e il *cosa* sono policy della feature — viveva
    /// in `fub-app::open_vault`, poi sull'evento `VaultOpened`, poi qui, con
    /// la stessa firma di un `Plugin::activate` — e il *chi* è il wiring.
    pub fn first_snapshot_of_the_vault<'h>(
        &self,
        host: &'h mut (dyn HostApi + 'h),
    ) -> Result<(), PluginError> {
        self.sweep(host, Pass::OnlyNew)
    }

    /// Conserva i byte correnti prima di ogni sovrascrittura.
    ///
    /// Avere già una storia non prova che il file sia immutato: un writer
    /// esterno può averlo cambiato senza un evento ancora consegnato. Il dedup
    /// evita uno snapshot aggiuntivo quando i byte coincidono con l'ultima
    /// versione. Una creazione non ha preimmagine; ogni altro errore ferma la
    /// scrittura prima che perda il contenuto precedente.
    pub fn photograph_before_write(
        &self,
        host: &mut dyn HostApi,
        id: &DocId,
    ) -> Result<(), PluginError> {
        match host.read_document_bytes(id) {
            Ok(source) => {
                self.store.snapshot(id, &source, host)?;
                Ok(())
            }
            // La nota non c'è: la scrittura è una creazione, e non c'è un
            // originale da salvare. `NotFound` è l'unico errore di lettura che
            // non è un guasto — ogni altro risale, e ferma la scrittura.
            Err(PluginError::NotFound(_)) => Ok(()),
            Err(and) => Err(and),
        }
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
        let live: std::collections::BTreeSet<String> =
            self.existing(host)?.into_iter().map(|id| id.0).collect();
        let mut sepolti = 0usize;
        for id in self.store.documents() {
            if live.contains(id.as_str()) || self.store.is_deleted(&id) {
                continue;
            }
            match self.store.tombstone(&id, host) {
                Ok(()) => sepolti += 1,
                Err(and) => {
                    tracing::warn!(target: "fub.versioning", "tombstone di {id} non scritto: {and}");
                    host.emit(Event::Trouble {
                        severity: Severity::Failure,
                        subject: Some(id.clone()),
                        error: and,
                        gate: None,
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
        self.sweep(host, Pass::All)
    }
}

/// Chi fotografare in una passata sull'intero vault.
enum Pass {
    /// Solo chi non ha ancora una storia: chi ce l'ha non paga nemmeno una
    /// lettura. Resta per chi riusa la passata a mano (i test). La
    /// riconciliazione dopo un `Overflow` passa da [`Passata::Tutti`].
    OnlyNew,
    /// Tutti (riconciliazione dopo un `Overflow`): il dedup per contenuto rende
    /// gratis gli immutati, e per gli altri nasce la versione persa.
    All,
}

impl EventHandler for VersioningHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::of([
            EventKind::DocumentChanged,
            EventKind::DocumentRenamed,
            EventKind::DocumentRemoved,
            EventKind::EntryChanged,
            EventKind::EntryRenamed,
            EventKind::EntryRemoved,
            // Senza questo, un troncamento della coda passerebbe inosservato e
            // il tombstone di una nota cancellata non arriverebbe mai.
            EventKind::Overflow,
        ])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        match &notice.event {
            Event::DocumentChanged { id, .. } | Event::EntryChanged { id, .. } => {
                let source = host.read_document_bytes(id)?;
                self.store.snapshot(id, &source, host)?;
            }
            Event::DocumentRenamed { from, to } | Event::EntryRenamed { from, to, .. } => {
                self.store.rename(from, to, host)?;
            }
            Event::DocumentRemoved { id } | Event::EntryRemoved { id, .. } => {
                self.store.tombstone(id, host)?;
            }
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
/// Chiede di ripristinare la versione il cui istante sta nel payload: il
/// pannello domanda prima di riscrivere la nota.
const A_RESTORE: &str = "restore";
/// Il sì alla domanda: ripristina davvero.
const A_RESTORE_CONFIRM: &str = "restore_confirm";
/// Il no: la domanda sparisce e non succede niente.
const A_RESTORE_CANCEL: &str = "restore_cancel";
/// Confronta con la nota attuale la versione il cui istante sta nel payload.
const A_COMPARE: &str = "compare";
/// Il testo intero della versione scelta, invece del confronto che è la vista
/// di partenza.
const A_SHOW_TEXT: &str = "show_text";
/// Mette negli appunti il testo della versione il cui istante sta nel payload.
const A_COPY: &str = "copy";
/// La chiave del payload, e quella sotto cui l'anteprima aperta resta scritta
/// nello stato di vista dell'esemplare (§11.2).
const TS: &str = "ts";
const PREVIEW_STATE: &str = "preview";
/// Se l'anteprima aperta mostra il confronto invece del testo.
const COMPARE_STATE: &str = "compare";
/// L'istante di cui si sta chiedendo il ripristino, finché non si risponde.
const CONFIRM_STATE: &str = "restore_confirm";

/// Le versioni di un documento secondo la voce già caricata dell'indice.
fn versions_of_docs(doc: Option<&DocVersions>) -> Vec<VersionRef> {
    doc.map(|d| d.versions.iter().rev().copied().collect())
        .unwrap_or_default()
}

/// Il contenuto di una versione, data la voce già caricata dell'indice.
fn version_source_doc(
    doc: &DocVersions,
    id: &DocId,
    ts: u64,
    host: &dyn ReadApi,
) -> Result<Vec<u8>, PluginError> {
    let version = doc.versions.iter().find(|v| v.ts == ts).ok_or_else(|| {
        PluginError::NotFound(Text::message(
            NO_SUCH_VERSION,
            vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
        ))
    })?;
    let path = blob(&doc.dir, &snapshot_name(ts, id.as_str()));
    read_snapshot(&path, *version, host)
}

fn read_snapshot(
    path: &str,
    version: VersionRef,
    host: &dyn ReadApi,
) -> Result<Vec<u8>, PluginError> {
    let bytes = host.data_read(path)?.ok_or_else(|| {
        PluginError::Internal(Text::message(CONTENT_GONE, vec![Arg::text(PATH, path)]))
    })?;
    if bytes.len() as u64 != version.size || Fnv1a::hash(&bytes) != version.hash {
        return Err(PluginError::Internal(Text::message(
            CONTENT_MISMATCH,
            vec![Arg::text(PATH, path)],
        )));
    }
    Ok(bytes)
}

/// Il pannello cronologia: le versioni della nota aperta, e come tornarci.
pub struct HistoryView;

impl ViewProvider for HistoryView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Una versione nasce da una scrittura, e da niente altro: la
            // maschera è più stretta di quella dei pannelli che leggono
            // l'indice.
            refresh: EventMask::of([
                EventKind::DocumentChanged,
                EventKind::EntryChanged,
                EventKind::BatchEnded,
            ]),
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
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, Some(serde_json::Value::from(ts)))?;
                host.set_view_state(COMPARE_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Il confronto è la stessa anteprima vista in un altro modo: resta
            // nello stato di vista per la stessa ragione, e si chiude con lei.
            A_COMPARE | A_SHOW_TEXT => {
                let (Some(_), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, Some(serde_json::Value::from(ts)))?;
                host.set_view_state(
                    COMPARE_STATE,
                    Some(serde_json::Value::Bool(action.action.0 == A_COMPARE)),
                )?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Copiare non scrive niente nel vault: il testo va alla shell, che
            // possiede gli appunti. Il kernel lascia passare questo intento
            // solo dai provider del core.
            A_COPY => {
                let (Some(doc), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                let docs = read_index(host)?;
                let entry = docs.get(doc.as_str()).ok_or_else(|| {
                    PluginError::NotFound(Text::message(
                        NO_VERSIONS,
                        vec![Arg::text(DOC, doc.as_str())],
                    ))
                })?;
                let text = String::from_utf8(version_source_doc(entry, &doc, ts, host)?)
                    .map_err(|_| PluginError::BadArgs(Text::key(DIFF_BINARY)))?;
                Ok(ViewUpdate::Custom {
                    ns: fub_abi::ui::CLIPBOARD_TEXT_NS.to_string(),
                    payload: serde_json::json!({ "text": text }),
                })
            }
            A_CLOSE_PREVIEW => {
                host.set_view_state(PREVIEW_STATE, None)?;
                host.set_view_state(COMPARE_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Ripristinare **non** è una scrittura di questo pannello: è il
            // comando `version.restore`, invocato per id come lo invocherebbe la
            // palette o un plugin. Una view che riscrivesse il documento da sé
            // avrebbe un'operazione fuori dal registro — quindi fuori
            // dall'annullamento, fuori dalla simulazione e fuori dalla palette.
            // Ripristinare riscrive la nota, e da questo pannello l'annullamento
            // del comando non arriva a chi ha cliccato: prima si chiede.
            A_RESTORE => {
                let (Some(_), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(CONFIRM_STATE, Some(serde_json::Value::from(ts)))?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            A_RESTORE_CANCEL => {
                host.set_view_state(CONFIRM_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            A_RESTORE_CONFIRM => {
                host.set_view_state(CONFIRM_STATE, None)?;
                let (Some(doc), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, None)?;
                host.set_view_state(COMPARE_STATE, None)?;
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
fn same_notes(action: &UiAction, host: &dyn ReadApi) -> Option<DocId> {
    let drawn = action.payload.get(DOC).and_then(|v| v.as_str())?;
    let activate = host.active_context().and_then(|c| c.doc)?;
    (activate.as_str() == drawn).then_some(activate)
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        return Ok(UiNode::empty_state(Text::key(NO_ACTIVE_DOC)));
    };
    // L'indice si carica una volta sola: la lista e l'anteprima lo leggono
    // entrambe, e rileggerlo per ciascuna era un doppio parse.
    let docs = read_index(host)?;
    let entry = docs.get(doc.as_str());
    let versions = versions_of_docs(entry);
    if versions.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }
    // `versions` non vuota implica una voce: l'anteprima la riusa.
    let entry = entry.expect("versioni non vuote implicano una voce dell'indice");

    let previewed = host
        .view_state(PREVIEW_STATE)?
        .and_then(|v| v.as_u64())
        .filter(|ts| versions.iter().any(|v| v.ts == *ts));
    let mut children = vec![UiNode::text(Text::message(
        COUNT,
        vec![Arg::int("count", versions.len() as i64)],
    ))];
    children.push(UiNode::list(
        versions
            .iter()
            .enumerate()
            .map(|(the, v)| {
                row(
                    v,
                    the == 0,
                    versions.get(the + 1),
                    previewed == Some(v.ts),
                    doc.as_str(),
                )
            })
            .collect(),
    ));

    // L'anteprima testuale resta testo, mai HTML. Un contenuto non UTF-8
    // mostra la dimensione e resta ripristinabile come byte.
    if let Some(ts) = previewed {
        let bytes = version_source_doc(entry, &doc, ts, host)?;
        let current = versions.first().is_some_and(|v| v.ts == ts);
        // Di una versione passata si vuole sapere prima di tutto *cosa è
        // cambiato*: il confronto è la vista di partenza, e il testo intero è
        // a un clic. La versione attuale, identica alla nota, si mostra come
        // testo.
        let comparing = host
            .view_state(COMPARE_STATE)?
            .and_then(|v| v.as_bool())
            .unwrap_or(!current);
        let payload = serde_json::json!({ DOC: doc.as_str(), TS: ts });
        let text = std::str::from_utf8(&bytes).is_ok();
        let body = if comparing {
            comparison(&bytes, &host.read_document_bytes(&doc)?)
        } else {
            match String::from_utf8(bytes) {
                Ok(text) => UiNode::text(text),
                Err(error) => UiNode::text(Text::message(
                    BINARY_PREVIEW,
                    vec![Arg::int("size", error.as_bytes().len() as i64)],
                )),
            }
        };
        // I gesti stanno sopra il testo, dove li si trova senza scorrerlo. Il
        // ripristino è l'unico primario, e c'è solo per le versioni passate:
        // ripristinare l'attuale riscriverebbe il file con ciò che contiene.
        let mut actions = Vec::new();
        let asking = !current
            && host
                .view_state(CONFIRM_STATE)?
                .and_then(|v| v.as_u64())
                .is_some_and(|asked| asked == ts);
        if asking {
            // La domanda al posto del bottone, dove l'occhio già stava.
            actions.push(UiNode::text(Text::key(RESTORE_QUESTION)));
            actions.push(UiNode::button(
                Text::key(RESTORE_CONFIRM_LABEL),
                Intent::Danger,
                ActionRef::with(A_RESTORE_CONFIRM, payload.clone()),
            ));
            actions.push(UiNode::button(
                Text::key(RESTORE_CANCEL_LABEL),
                Intent::Neutral,
                ActionRef::new(A_RESTORE_CANCEL),
            ));
        } else if !current {
            actions.push(UiNode::button(
                Text::key(RESTORE_LABEL),
                Intent::Primary,
                ActionRef::with(A_RESTORE, payload.clone()),
            ));
        }
        actions.push(if comparing {
            UiNode::button(
                Text::key(SHOW_TEXT),
                Intent::Neutral,
                ActionRef::with(A_SHOW_TEXT, payload.clone()),
            )
        } else {
            UiNode::button(
                Text::key(COMPARE_LABEL),
                Intent::Neutral,
                ActionRef::with(A_COMPARE, payload.clone()),
            )
        });
        if text {
            actions.push(UiNode::button(
                Text::key(COPY_LABEL),
                Intent::Neutral,
                ActionRef::with(A_COPY, payload),
            ));
        }
        actions.push(UiNode::button(
            Text::key(CLOSE_PREVIEW),
            Intent::Neutral,
            ActionRef::new(A_CLOSE_PREVIEW),
        ));
        children.push(UiNode::keyed(
            format!("preview:{ts}"),
            UiKind::Section {
                title: Text::message(WHEN_TITLE, vec![Arg::timestamp(WHEN, ts)]),
                collapsed: false,
                children: vec![UiNode::row(4, actions), body],
            },
        ));
    }
    Ok(UiNode::column(1, children))
}

/// Oltre questo prodotto di righe diverse il confronto riga per riga non si
/// calcola: la tabella costerebbe più di quanto un pannello laterale possa
/// mostrare, e il pannello si ridisegna a ogni scrittura.
const DIFF_CELLS: usize = 4_000_000;
/// Righe uguali mostrate attorno a ogni cambiamento.
const DIFF_CONTEXT: usize = 2;
/// Righe disegnate al massimo: il resto si conta, non si tace.
const DIFF_MAX_LINES: usize = 400;

/// Una riga del confronto fra una versione (`Removed`) e la nota attuale
/// (`Added`).
#[derive(Debug, PartialEq, Eq)]
enum Change<'a> {
    Same(&'a str),
    Removed(&'a str),
    Added(&'a str),
}

/// Il confronto riga per riga, o `None` quando la parte diversa è troppo grande
/// per [`DIFF_CELLS`].
///
/// Prefisso e suffisso comuni si tolgono prima: una modifica in una nota lunga
/// tocca di solito poche righe, e la tabella si costruisce solo su quelle.
/// Il resto è la sottosequenza comune più lunga, che tiene le righe uguali
/// nel loro ordine.
fn line_diff<'a>(old: &'a str, new: &'a str) -> Option<Vec<Change<'a>>> {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let prefix = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (ma, mb) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    if ma.len().saturating_mul(mb.len()) > DIFF_CELLS {
        return None;
    }
    // `lcs[i][j]`: la sottosequenza comune più lunga fra `ma[i..]` e `mb[j..]`.
    let width = mb.len() + 1;
    let mut lcs = vec![0u32; (ma.len() + 1) * width];
    for i in (0..ma.len()).rev() {
        for j in (0..mb.len()).rev() {
            lcs[i * width + j] = if ma[i] == mb[j] {
                lcs[(i + 1) * width + j + 1] + 1
            } else {
                lcs[(i + 1) * width + j].max(lcs[i * width + j + 1])
            };
        }
    }
    let mut out: Vec<Change<'a>> = a[..prefix].iter().map(|l| Change::Same(l)).collect();
    let (mut i, mut j) = (0, 0);
    while i < ma.len() || j < mb.len() {
        if i < ma.len() && j < mb.len() && ma[i] == mb[j] {
            out.push(Change::Same(ma[i]));
            i += 1;
            j += 1;
        } else if i < ma.len()
            && (j == mb.len() || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
        {
            out.push(Change::Removed(ma[i]));
            i += 1;
        } else {
            out.push(Change::Added(mb[j]));
            j += 1;
        }
    }
    out.extend(a[a.len() - suffix..].iter().map(|l| Change::Same(l)));
    Some(out)
}

/// Il confronto fra i byte di una versione e quelli attuali, come albero.
///
/// Resta testo e badge, mai HTML: le righe arrivano da un file dell'utente.
/// Le righe uguali lontane da un cambiamento si riassumono in un conto, e oltre
/// [`DIFF_MAX_LINES`] righe disegnate il resto si dice con un numero.
fn comparison(version: &[u8], current: &[u8]) -> UiNode {
    if version == current {
        return UiNode::text(Text::key(DIFF_SAME));
    }
    let (Ok(old), Ok(new)) = (std::str::from_utf8(version), std::str::from_utf8(current)) else {
        return UiNode::text(Text::key(DIFF_BINARY));
    };
    let Some(changes) = line_diff(old, new) else {
        let lines = old.lines().count().max(new.lines().count());
        return UiNode::text(Text::message(
            DIFF_TOO_LARGE,
            vec![Arg::int("lines", lines as i64)],
        ));
    };
    let added = changes
        .iter()
        .filter(|c| matches!(c, Change::Added(_)))
        .count();
    let removed = changes
        .iter()
        .filter(|c| matches!(c, Change::Removed(_)))
        .count();
    if added == 0 && removed == 0 {
        return UiNode::text(Text::key(DIFF_ENDINGS));
    }
    // Una riga uguale si mostra se sta entro il contesto di un cambiamento.
    let near: Vec<bool> = (0..changes.len())
        .map(|at| {
            let from = at.saturating_sub(DIFF_CONTEXT);
            let to = (at + DIFF_CONTEXT + 1).min(changes.len());
            changes[from..to]
                .iter()
                .any(|c| !matches!(c, Change::Same(_)))
        })
        .collect();
    let mut lines = Vec::new();
    let mut shown = 0usize;
    let mut skipped = 0usize;
    let mut hidden = 0usize;
    for (at, change) in changes.iter().enumerate() {
        if shown == DIFF_MAX_LINES {
            hidden += usize::from(near[at]);
            continue;
        }
        if !near[at] {
            skipped += 1;
            continue;
        }
        if skipped > 0 {
            lines.push(UiNode::text(Text::message(
                DIFF_SKIPPED,
                vec![Arg::int("count", skipped as i64)],
            )));
            skipped = 0;
        }
        shown += 1;
        lines.push(match change {
            Change::Same(line) => UiNode::text(format!("  {line}")),
            Change::Removed(line) => UiNode::row(
                1,
                vec![
                    UiNode::badge("−", Intent::Danger),
                    UiNode::text(line.to_string()),
                ],
            ),
            Change::Added(line) => UiNode::row(
                1,
                vec![
                    UiNode::badge("+", Intent::Primary),
                    UiNode::text(line.to_string()),
                ],
            ),
        });
    }
    if skipped > 0 && hidden == 0 {
        lines.push(UiNode::text(Text::message(
            DIFF_SKIPPED,
            vec![Arg::int("count", skipped as i64)],
        )));
    }
    if hidden > 0 {
        lines.push(UiNode::text(Text::message(
            DIFF_TRUNCATED,
            vec![Arg::int("count", hidden as i64)],
        )));
    }
    let mut children = vec![UiNode::text(Text::message(
        DIFF_SUMMARY,
        vec![
            Arg::int("added", added as i64),
            Arg::int("removed", removed as i64),
        ],
    ))];
    children.extend(lines);
    UiNode::column(0, children)
}

/// Una versione: quando e quanto è cambiata rispetto alla precedente.
///
/// La riga è leggera — l'ora e una variazione — e si sceglie col click: i gesti
/// (ripristina, confronta, copia) stanno nell'anteprima della versione scelta.
/// Con un bottone «Ripristina» per riga il pannello era una colonna di azioni
/// distruttive uguali, e il gesto più pericoloso era il più facile da fare.
/// La più recente è la versione attuale.
///
/// La nota viaggia nel payload accanto all'istante, e non perché serva a chi
/// agisce — `version.restore` la vuole, ma la si potrebbe rileggere —: serve a
/// dire **su quale nota questa riga è stata disegnata**, che è l'unico modo di
/// accorgersi che nel frattempo è cambiata. Vedi [`same_notes`].
fn row(
    v: &VersionRef,
    current: bool,
    older: Option<&VersionRef>,
    selected: bool,
    doc: &str,
) -> UiNode {
    let when = Text::message(WHEN, vec![Arg::timestamp(WHEN, v.ts)]);
    let change = if current {
        Text::key(CURRENT)
    } else {
        match older {
            None => Text::message(FIRST_VERSION, vec![Arg::int("size", v.size as i64)]),
            Some(older) if v.size > older.size => {
                Text::message(GREW, vec![Arg::int("size", (v.size - older.size) as i64)])
            }
            Some(older) if v.size < older.size => {
                Text::message(SHRANK, vec![Arg::int("size", (older.size - v.size) as i64)])
            }
            Some(_) => Text::key(SAME_SIZE),
        }
    };
    let mut item = UiNode::list_item(
        when,
        Some(change),
        Some(ActionRef::with(
            A_PREVIEW,
            serde_json::json!({ DOC: doc, TS: v.ts }),
        )),
    );
    if let UiKind::ListItem { selected: at, .. } = &mut item.kind {
        *at = selected;
    }
    item.with_key(v.ts.to_string())
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
            .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;
        let ts = args
            .number(TS)
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TS_GIVEN)))? as u64;

        let when_for = |key: &str, when: u64| {
            Text::message(
                key,
                vec![Arg::text(DOC, doc.as_str()), Arg::timestamp(WHEN, when)],
            )
        };

        if mode.is_dry_run() {
            let plan =
                CommandPlan::of_edits(when_for(PLAN_RESTORE, ts), Vec::new()).with_doc(doc.clone());
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }

        // L'inverso deve nominare la preimmagine catturata dal gancio, anche
        // quando un writer esterno ha preceduto il comando senza un evento.
        // `document_revision` è la base del CAS reale di `write_document_bytes`:
        // catturarla prima di leggere lo snapshot fa fallire il ripristino se
        // il documento cambia durante quella lettura, senza sovrascrivere la
        // modifica concorrente.
        {
            let docs = read_index(host)?;
            let entry = docs.get(doc.as_str()).ok_or_else(|| {
                PluginError::NotFound(Text::message(
                    NO_VERSIONS,
                    vec![Arg::text(DOC, doc.as_str())],
                ))
            })?;
            let base = host.document_revision(&doc)?;
            let source = version_source_doc(entry, &doc, ts, host)?;
            host.write_document_bytes(&doc, &source, Some(base))?;
        }
        // Gli eventi restano accodati fino all'uscita del comando: lo snapshot
        // del risultato non è ancora stato creato, l'ultimo è la preimmagine.
        // Un errore di lettura qui non può trasformare una scrittura riuscita
        // in un fallimento: segnala il problema e non promette l'annullamento.
        let before = match read_index(host) {
            Ok(history) => history
                .get(doc.as_str())
                .and_then(|entry| entry.versions.last())
                .map(|version| version.ts),
            Err(error) => {
                host.emit(Event::Trouble {
                    severity: Severity::Warning,
                    subject: Some(doc.clone()),
                    error,
                    gate: None,
                });
                None
            }
        };

        let result = CommandOutcome::notify(when_for(DONE_RESTORE, ts));
        Ok(match before {
            Some(before) => result.undoable(fub_abi::command::Undo::by_command(
                when_for(UNDO_RESTORE, before),
                VERSION_RESTORE,
                serde_json::json!({ DOC: doc.as_str(), TS: before }),
            )),
            // Nessuna preimmagine leggibile: il ripristino è comunque riuscito.
            None => result,
        })
    }
}

#[cfg(test)]
mod tests {
    use fub_sdk::testing::MemoryHost;

    use super::*;
    use fub_abi::edit::WriteBase;
    use fub_abi::traits::{DataRead, DataWrite, EntryKind, HostEnv, VaultWrite};

    fn id(s: &str) -> DocId {
        DocId::new(s)
    }

    #[test]
    fn every_new_content_becomes_a_version() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        store
            .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
            .unwrap();
        host.advance(1_000);
        store
            .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
            .unwrap();

        let versions = store.list(&id("a.md"));
        assert_eq!(versions.len(), 2);
        // Dalla più recente: è l'ordine in cui si cerca ciò che si vuole
        // ripescare.
        assert_eq!(
            store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
            "seconda"
        );
        assert_eq!(
            store.read(&id("a.md"), versions[1].ts, &host).unwrap(),
            "prima"
        );
    }

    #[test]
    fn the_line_diff_keeps_order_and_common_lines() {
        use Change::{Added, Removed, Same};
        assert_eq!(
            line_diff("a\nb\nc\n", "a\nx\nc\nd\n").unwrap(),
            vec![Same("a"), Removed("b"), Added("x"), Same("c"), Added("d")]
        );
        assert_eq!(line_diff("", "uno").unwrap(), vec![Added("uno")]);
        assert_eq!(line_diff("uno", "").unwrap(), vec![Removed("uno")]);
        // Una parte diversa troppo grande non si calcola: il pannello lo dice.
        let big_a = (0..3_000).map(|n| format!("a{n}\n")).collect::<String>();
        let big_b = (0..3_000).map(|n| format!("b{n}\n")).collect::<String>();
        assert!(line_diff(&big_a, &big_b).is_none());
    }

    #[test]
    fn the_comparison_summarises_far_lines_and_says_what_it_leaves_out() {
        fn texts(node: &UiNode, out: &mut Vec<String>) {
            match &node.kind {
                UiKind::Text { content } => out.push(content.to_string()),
                UiKind::Badge { label, .. } => out.push(label.to_string()),
                _ => {}
            }
            for child in node.children() {
                texts(child, out);
            }
        }
        let said = |node: UiNode| {
            let mut out = Vec::new();
            texts(&node, &mut out);
            out
        };
        let old = (0..20).map(|n| format!("r{n}\n")).collect::<String>();
        let new = old.replace("r10\n", "dieci\n");
        let lines = said(comparison(old.as_bytes(), new.as_bytes()));
        assert!(lines.contains(&"dieci".to_string()), "{lines:?}");
        assert!(lines.contains(&"r10".to_string()), "{lines:?}");
        assert!(lines.contains(&"  r8".to_string()), "context: {lines:?}");
        assert!(
            !lines.contains(&"  r0".to_string()),
            "far lines are summarised: {lines:?}"
        );
        assert_eq!(
            said(comparison(b"uguale", b"uguale")),
            vec![Text::key(DIFF_SAME).to_string()]
        );
        assert_eq!(
            said(comparison(b"a\r\nb", b"a\nb")),
            vec![Text::key(DIFF_ENDINGS).to_string()]
        );
        assert_eq!(
            said(comparison(&[0xff, 0xfe], b"testo")),
            vec![Text::key(DIFF_BINARY).to_string()]
        );
        let many = (0..1_000).map(|n| format!("n{n}\n")).collect::<String>();
        let lines = said(comparison(b"", many.as_bytes()));
        assert!(lines.len() < 2 * DIFF_MAX_LINES + 3, "{}", lines.len());
        assert!(
            lines.last().unwrap().contains("600"),
            "the rest is counted: {:?}",
            lines.last()
        );
    }

    #[test]
    fn every_key_that_the_panel_writes_is_in_the_catalogs_of_the_languages() {
        // Il difetto: le righe dello storico dicevano «when» — la chiave nuda
        // — perché `Text::message` riceveva il nome dell'argomento come chiave
        // e il risolutore, senza template, ricade sulla chiave stessa. Il
        // sintomo a schermo: file di righe tutte uguali, senza date. Il
        // presidio è generico e non «la chiave when esiste»: ogni chiave che
        // l'albero del pannello scrive deve stare in **ogni** catalogo, così
        // la prossima chiave dimenticata rossa qui e non a schermo.
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
            .unwrap();
        host.advance(1_000);
        store
            .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
            .unwrap();
        host.set_active(Some("a.md"));

        let mut tree = tree(&host).unwrap();
        let mut keys = Vec::new();
        use fub_abi::text::{Localize, Text};
        tree.visit_texts(&mut |t| {
            if let Text::Message(m) = t {
                keys.push(m.key.clone());
            }
        });
        assert!(!keys.is_empty(), "l'albero deve portare messaggi");
        for catalog in catalog() {
            for key in &keys {
                assert!(
                    catalog.entries.contains_key(key),
                    "il catalogo {} non ha la chiave {key}",
                    catalog.locale
                );
            }
        }
    }

    #[test]
    fn a_clock_going_backwards_does_not_disorder_the_history() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        store
            .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
            .unwrap();
        // L'orologio torna indietro fra due salvataggi (NTP, fuso, VM).
        host.backtrack(60_000);
        store
            .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
            .unwrap();

        let versions = store.list(&id("a.md"));
        assert_eq!(versions.len(), 2);
        // `versions` è dato persistito e deve restare ordinato per tempo:
        // su di esso ragionano "attuale" in `list` e la protezione della più
        // recente in `prune`.
        assert!(
            versions[0].ts > versions[1].ts,
            "la versione nuova deve avere ts maggiore anche a orologio arretrato: {versions:?}"
        );
        assert_eq!(
            store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
            "seconda",
            "l'«attuale» è l'ultima salvata, non l'ultima per orologio"
        );
    }

    #[test]
    fn saving_the_same_text_again_is_not_a_new_version() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        assert!(store
            .snapshot(&id("a.md"), b"identica", &mut host)
            .unwrap()
            .is_some());
        assert!(
            store
                .snapshot(&id("a.md"), b"identica", &mut host)
                .unwrap()
                .is_none(),
            "il dedup per contenuto è ciò che rende sostenibile uno snapshot a ogni evento"
        );
        assert_eq!(store.list(&id("a.md")).len(), 1);
    }

    #[test]
    fn a_rename_moves_the_history_with_the_notes() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("vecchia.md"), ("corpo").as_bytes(), &mut host)
            .unwrap();

        store
            .rename(&id("vecchia.md"), &id("nuova.md"), &mut host)
            .unwrap();

        assert!(store.list(&id("vecchia.md")).is_empty());
        let versions = store.list(&id("nuova.md"));
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store.read(&id("nuova.md"), versions[0].ts, &host).unwrap(),
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
            .snapshot(&id("a.md"), ("la storia che arriva").as_bytes(), &mut host)
            .unwrap();
        store
            .snapshot(&id("b.md"), ("la storia che c'era").as_bytes(), &mut host)
            .unwrap();

        store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

        let versions = store.list(&id("b.md"));
        assert_eq!(
            versions.len(),
            2,
            "contenuti diversi sono versioni diverse anche a parità di istante: {versions:?}"
        );
        let contents: Vec<String> = versions
            .iter()
            .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
            .collect();
        assert!(contents.contains(&"la storia che arriva".to_string()));
        assert!(contents.contains(&"la storia che c'era".to_string()));
    }

    #[test]
    fn a_relocation_reads_all_the_blob_first_of_rewrite_them() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();

        store
            .snapshot(&id("a.md"), ("a zero").as_bytes(), &mut host)
            .unwrap();
        store
            .snapshot(&id("b.md"), ("b zero").as_bytes(), &mut host)
            .unwrap();
        host.advance(1);
        store
            .snapshot(&id("a.md"), ("a uno").as_bytes(), &mut host)
            .unwrap();

        store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

        let versions = store.list(&id("b.md"));
        assert_eq!(versions.len(), 3, "versioni: {versions:?}");
        let contents: Vec<String> = versions
            .iter()
            .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
            .collect();
        for expected in ["a zero", "b zero", "a uno"] {
            assert!(
                contents.iter().any(|text| text == expected),
                "il blob {expected:?} è stato sovrascritto prima di essere letto: {contents:?}"
            );
        }
    }

    /// Il nome di un blob porta l'estensione del documento: se il contenuto non
    /// segue il path, l'indice resta a nominare un `<ts>.md` che `read` andrà a
    /// cercare come `<ts>.txt`.
    #[test]
    fn a_rename_that_changes_the_extension_still_finds_the_old_contents() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("appunti.md"), ("il corpo").as_bytes(), &mut host)
            .unwrap();

        store
            .rename(&id("appunti.md"), &id("appunti.txt"), &mut host)
            .unwrap();

        let versions = store.list(&id("appunti.txt"));
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store
                .read(&id("appunti.txt"), versions[0].ts, &host)
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
            .snapshot(&id("Nota.md"), ("prima vita\n").as_bytes(), &mut host)
            .unwrap();
        host.advance(1);
        store.tombstone(&id("Nota.md"), &mut host).unwrap();
        host.advance(1);
        store
            .snapshot(&id("Nota.md"), ("usurpatrice\n").as_bytes(), &mut host)
            .unwrap();

        // Il ripristino è una scrittura normale (D8): sul nuovo path nasce
        // *prima* una storia sua — con una cartella sua — e solo dopo arriva il
        // `DocumentRenamed` che ci porta quella vecchia.
        host.advance(1);
        store
            .snapshot(&id("Nota 1.md"), ("prima vita\n").as_bytes(), &mut host)
            .unwrap();
        store
            .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
            .unwrap();

        // L'indice nomina tre versioni: devono essere tre contenuti leggibili.
        // Un indice che nomina un contenuto inesistente è il modo in cui il
        // versioning fallisce in modo indistinguibile dal funzionare.
        let versions = store.list(&id("Nota 1.md"));
        assert_eq!(versions.len(), 3, "versioni: {versions:?}");
        let contents: Vec<String> = versions
            .iter()
            .map(|v| {
                store
                    .read(&id("Nota 1.md"), v.ts, &host)
                    .unwrap_or_else(|and| panic!("versione {}: {and}", v.ts))
            })
            .collect();
        assert!(contents.contains(&"prima vita\n".to_string()));
        assert!(contents.contains(&"usurpatrice\n".to_string()));
    }

    /// Dopo un'unione la cartella abbandonata non deve restare a dire di chi
    /// era: `rebuild_from_store` si fida di `meta.json`, e due cartelle che
    /// dichiarano lo stesso `doc_id` diventano una storia sola.
    #[test]
    fn the_abandoned_folder_does_not_as_back_as_a_second_history() {
        let mut host = MemoryHost::new();
        let expected;
        {
            let store = VersionStore::open(&mut host).unwrap();
            store
                .snapshot(&id("Nota.md"), ("prima vita\n").as_bytes(), &mut host)
                .unwrap();
            host.advance(1);
            store
                .snapshot(&id("Nota 1.md"), ("ripristinata\n").as_bytes(), &mut host)
                .unwrap();
            store
                .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
                .unwrap();
            expected = store.list(&id("Nota 1.md"));
            assert_eq!(expected.len(), 2);
        }

        // L'indice si perde: si ricostruisce dallo store, che è la verità.
        host.data_write(INDEX_FILE, b"non sono json").unwrap();
        let store = VersionStore::open(&mut host).unwrap();

        assert_eq!(
            store.list(&id("Nota 1.md")).len(),
            expected.len(),
            "la storia unita deve sopravvivere intera alla ricostruzione"
        );
        for v in &expected {
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
        store
            .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
            .unwrap();

        store.tombstone(&id("a.md"), &mut host).unwrap();

        let versions = store.list(&id("a.md"));
        assert_eq!(versions.len(), 1, "cancellare non cancella la storia");
        assert_eq!(
            store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
            "contenuto"
        );
        // E la nota che torna in vita non è più morta.
        host.advance(1_000);
        store
            .snapshot(&id("a.md"), ("risorta").as_bytes(), &mut host)
            .unwrap();
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
            60_000,       // stessa ora
            27 * MS_DAY,  // un mese dopo
            MS_HOUR,      // stesso giorno
            335 * MS_DAY, // un anno dopo la prima
            3 * MS_DAY,   // e infine "adesso"
        ]
        .into_iter()
        .enumerate()
        {
            host.advance(salto);
            store
                .snapshot(&id("a.md"), format!("versione {n}").as_bytes(), &mut host)
                .unwrap();
        }

        let now = host.now_unix_millis();
        let kept = store.list(&id("a.md"));
        let eta: Vec<u64> = kept.iter().map(|v| now.saturating_sub(v.ts)).collect();
        assert!(
            eta[0] < MS_HOUR,
            "la più recente resta sempre, anche se il resto è stato potato: {eta:?}"
        );
        assert!(
            eta.iter().all(|and| *and < BAND_DAILY),
            "oltre l'ultima fascia non si conserva: {eta:?}"
        );
        assert!(
            kept.len() < 6,
            "le fasce devono aver assottigliato qualcosa: {eta:?}"
        );
        // E i contenuti potati non restano a occupare spazio nello store: la
        // cartella del documento contiene il suo `meta.json` e **solo** gli
        // snapshot che l'indice nomina, nessuno di più.
        for v in &kept {
            assert!(
                store.read(&id("a.md"), v.ts, &host).is_ok(),
                "una versione tenuta deve essere leggibile"
            );
        }
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
        let mut remaining = host.data_list(&dir).unwrap();
        remaining.sort();
        let mut expected: Vec<String> = kept
            .iter()
            .map(|v| blob(&dir, &snapshot_name(v.ts, "a.md")))
            .chain(std::iter::once(blob(&dir, METADATA_FILE)))
            .collect();
        expected.sort();
        assert_eq!(remaining, expected, "un blob potato è rimasto nello store");
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
            host.advance(salto);
            store
                .snapshot(&id("a.md"), format!("versione {n}").as_bytes(), &mut host)
                .unwrap();
        }
        let before = store.list(&id("a.md")).len();
        assert_eq!(before, 2);

        // Il disco si rifiuta proprio sull'indice, e proprio sul salvataggio
        // che pota.
        host.denies_write(INDEX_FILE);
        host.advance(2 * MS_DAY);
        let result = store.snapshot(&id("a.md"), ("l'ultima").as_bytes(), &mut host);
        assert!(result.is_err(), "una scrittura negata non è un successo");
        assert!(
            store.list(&id("a.md")).len() < before + 1,
            "il banco non prova niente se la potatura non ha buttato nulla"
        );

        // Si riapre dall'indice che è rimasto sul disco: qualunque versione
        // dica di avere, deve poterla leggere.
        let store = VersionStore::open(&mut host).unwrap();
        let versions = store.list(&id("a.md"));
        assert!(!versions.is_empty(), "l'indice sul disco non è vuoto");
        for v in &versions {
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
    fn resurrection_denied(rejects: impl Fn(&MemoryHost, &str)) -> (bool, bool) {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
            .unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();

        rejects(&host, &dir);
        host.advance(1_000);
        assert!(
            store.snapshot(&id("a.md"), b"identico", &mut host).is_err(),
            "una scrittura negata non è un successo"
        );

        let in_memory = store.is_deleted(&id("a.md"));
        let on_the_disk = VersionStore::open(&mut host)
            .unwrap()
            .is_deleted(&id("a.md"));
        (in_memory, on_the_disk)
    }

    /// La forma «muta lo stato, poi persisti col `?`» — quella che [`Inner::apply`]
    /// toglie di mezzo — giudicata sul campo che l'utente vede: il tombstone.
    ///
    /// Ciò che non deve succedere è che la nota torni viva **solo in memoria**:
    /// l'app la mostrerebbe ripristinata, il disco continuerebbe a dirla
    /// cestinata, e al riavvio sarebbe di nuovo nel cestino senza che nessuno
    /// abbia detto perché. Vale per tutte e due le scritture dell'anagrafe —
    /// il `meta.json` della cartella e l'indice — perché a fallire può essere
    /// l'una o l'altra.
    #[test]
    fn a_resurrection_the_disk_refuses_leaves_the_notes_dead_in_memory_too() {
        for (who, rejects) in [
            (
                "meta.json",
                &(|host: &MemoryHost, dir: &str| host.denies_write(&blob(dir, METADATA_FILE)))
                    as &dyn Fn(&MemoryHost, &str),
            ),
            ("l'indice", &|host: &MemoryHost, _: &str| {
                host.denies_write(INDEX_FILE)
            }),
        ] {
            let (in_memory, on_the_disk) = resurrection_denied(rejects);
            assert!(
                in_memory,
                "{who} ha detto di no e la memoria è andata avanti da sola: \
                 mostra viva una nota che al riavvio è di nuovo cestinata"
            );
            assert_eq!(
                in_memory, on_the_disk,
                "{who} ha detto di no e memoria e disco raccontano due storie diverse"
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
        store
            .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
            .unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();

        host.advance(1_000);
        store
            .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
            .unwrap();

        assert!(!store.is_deleted(&id("a.md")), "la nota è tornata viva");
        // Riaperto, e non da zero: uno store che sul disco non ha trovato
        // niente direbbe «non cancellata» anche di una nota che non conosce,
        // e il banco passerebbe a vuoto.
        let reopened = VersionStore::open(&mut host).unwrap();
        assert_eq!(
            reopened.list(&id("a.md")).len(),
            1,
            "il disco non sa niente di questa nota: la domanda sul tombstone non vuol dire nulla"
        );
        assert!(
            !reopened.is_deleted(&id("a.md")),
            "viva in memoria e cestinata sul disco: al riavvio risorge il cestino"
        );
    }

    /// La stessa forma sull'altro verso del tombstone: chi lo posa lo eredita
    /// gratis, senza nessun ramo d'errore da ricordarsi di scrivere.
    #[test]
    fn a_tombstone_the_disk_refuses_leaves_the_notes_alive_in_memory_too() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
            .unwrap();

        host.denies_write(INDEX_FILE);
        host.advance(1_000);
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
        host.denies_write(INDEX_FILE);

        assert!(store
            .snapshot(&id("a.md"), b"contenuto", &mut host)
            .is_err());
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
                .snapshot(&id("nota/Idea.md"), ("il contenuto").as_bytes(), &mut host)
                .unwrap();
            store.tombstone(&id("nota/Idea.md"), &mut host).unwrap();
            ts = store.list(&id("nota/Idea.md"))[0].ts;
        }
        // L'indice si corrompe: è stato derivato, non è la verità.
        host.data_write(INDEX_FILE, b"non sono json").unwrap();

        let store = VersionStore::open(&mut host).unwrap();
        let versions = store.list(&id("nota/Idea.md"));
        assert_eq!(versions.len(), 1, "le versioni si ritrovano dallo store");
        assert_eq!(versions[0].ts, ts);
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
    /// `write_metadata` ci scrive sopra un altro `doc_id`, e alla prima
    /// ricostruzione gli snapshot di `b.md` diventano versioni di `a.md`.
    #[test]
    fn a_folder_whose_metadata_cannot_be_read_is_not_given_to_another_document() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("la storia di a\n").as_bytes(), &mut host)
            .unwrap();
        let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
        store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();
        assert_eq!(
            store.inner.lock().unwrap().docs["b.md"].dir,
            dir,
            "il banco non prova niente se la cartella si è mossa col rename"
        );
        let ts_of_b = store.list(&id("b.md"))[0].ts;

        // L'anagrafe della cartella si corrompe: un troncamento, un disco
        // pieno a metà scrittura.
        host.data_write(&blob(&dir, METADATA_FILE), b"non sono json")
            .unwrap();

        // E una nota nuova nasce col path che quella cartella porta impresso
        // nel nome.
        host.advance(1_000);
        store
            .snapshot(
                &id("a.md"),
                ("una nota tutta nuova\n").as_bytes(),
                &mut host,
            )
            .unwrap();

        assert_ne!(
            store.inner.lock().unwrap().docs["a.md"].dir,
            dir,
            "la cartella di b.md è stata data ad a.md, e il suo meta.json \
             sovrascritto: la storia di b.md è diventata storia di a.md"
        );
        assert_eq!(
            store.read(&id("b.md"), ts_of_b, &host).unwrap(),
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
    fn a_rename_the_index_refuses_leaves_one_claim_for_document() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(
                &id("vecchia.md"),
                ("storia che arriva\n").as_bytes(),
                &mut host,
            )
            .unwrap();
        host.advance(1_000);
        store
            .snapshot(&id("Nota.md"), ("storia che c'era\n").as_bytes(), &mut host)
            .unwrap();

        host.advance(1_000);
        host.denies_write(INDEX_FILE);
        assert!(
            store
                .rename(&id("vecchia.md"), &id("Nota.md"), &mut host)
                .is_err(),
            "una scrittura negata non è un successo"
        );

        let claimants: Vec<String> = host
            .data_list("")
            .unwrap()
            .into_iter()
            .filter(|p| p.ends_with(METADATA_FILE))
            .filter(|p| {
                let raw = host.data_read(p).unwrap().unwrap();
                serde_json::from_slice::<Meta>(&raw).is_ok_and(|m| m.doc_id == "Nota.md")
            })
            .collect();
        assert_eq!(
            claimants.len(),
            1,
            "due cartelle dicono di essere Nota.md: {claimants:?}"
        );

        // E l'indice si perde davvero: è la sola strada per cui una
        // rivendicazione doppia si vede, ed è quella per cui esiste.
        host.data_remove(INDEX_FILE).unwrap();
        let store = VersionStore::open(&mut host).unwrap();
        let versions = store.list(&id("Nota.md"));
        assert_eq!(
            versions.len(),
            2,
            "la ricostruzione ha perso una storia: {versions:?}"
        );
        for v in &versions {
            assert!(
                store.read(&id("Nota.md"), v.ts, &host).is_ok(),
                "l'indice ricostruito nomina la versione {} e il contenuto non c'è",
                v.ts
            );
        }
    }

    /// Il verso che l'audit aveva letto al contrario, e che va tenuto fermo.
    ///
    /// Fra `write_metadata` riuscita e `write_index` fallita il `meta.json` resta
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
    fn a_metadata_the_index_did_not_follow_is_ahead_of_the_index_never_behind() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
            .unwrap();
        store.tombstone(&id("a.md"), &mut host).unwrap();

        host.denies_write(INDEX_FILE);
        host.advance(1_000);
        assert!(
            store.snapshot(&id("a.md"), b"identico", &mut host).is_err(),
            "una scrittura negata non è un successo"
        );
        // Indice e memoria restano indietro **insieme**: è la proprietà che
        // `apply` garantisce, e che gli altri banchi già misurano.
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
        store
            .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
            .unwrap();

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
                batch: false,
            })),
        });
        assert!(handler.subscribed().contains(EventKind::Overflow));
    }

    #[test]
    fn an_overflow_turns_a_lost_removal_into_a_tombstone() {
        let mut host = MemoryHost::new().with_document("a.md", "contenuto");
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
            .unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // La nota sparisce e il `DocumentRemoved` va perso nel troncamento.
        host.forgets_document("a.md");
        assert!(
            !store.is_deleted(&id("a.md")),
            "senza riconciliazione lo store crede ancora che sia viva"
        );

        host.advance(5_000);
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
        let mut host = MemoryHost::new().with_document("a.md", "contenuto");
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
            .unwrap();
        host.forgets_document("a.md");
        store.tombstone(&id("a.md"), &mut host).unwrap();
        let dead_to_the = store.inner.lock().unwrap().docs["a.md"].deleted_at;

        host.advance(10 * MS_DAY);
        let mut handler = VersioningHandler::new(store.clone());
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 1 }), &mut host)
            .unwrap();

        // L'istante della morte è un fatto: una riconciliazione che ripassa
        // sulle stesse chiavi non deve riscriverlo, o "vault al tempo T"
        // risponderebbe diversamente a ogni overflow.
        assert_eq!(
            store.inner.lock().unwrap().docs["a.md"].deleted_at,
            dead_to_the
        );
    }

    #[test]
    fn an_overflow_turns_a_lost_rename_into_a_new_history_plus_a_tombstone() {
        let mut host = MemoryHost::new().with_document("vecchia.md", "il corpo");
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("vecchia.md"), ("il corpo").as_bytes(), &mut host)
            .unwrap();
        let previous_ts = store.list(&id("vecchia.md"))[0].ts;
        let mut handler = VersioningHandler::new(store.clone());

        // Il rename avviene e il `DocumentRenamed` va perso: `rename` non viene
        // mai chiamato, quindi la storia NON migra.
        host.rename_of_hidden("vecchia.md", "nuova.md");
        host.advance(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 3 }), &mut host)
            .unwrap();

        // La cronologia si spezza — è il costo dell'evento perso, e non si prova
        // a indovinare i rename dal contenuto — ma niente mente sul presente:
        // il nuovo path ha una storia, il vecchio ha un tombstone, e il
        // contenuto di prima resta leggibile.
        assert!(store.is_deleted(&id("vecchia.md")));
        assert_eq!(
            store.read(&id("vecchia.md"), previous_ts, &host).unwrap(),
            "il corpo"
        );
        let new = store.list(&id("nuova.md"));
        assert_eq!(new.len(), 1, "sul nuovo path nasce una storia");
        assert_eq!(
            store.read(&id("nuova.md"), new[0].ts, &host).unwrap(),
            "il corpo"
        );
    }

    #[test]
    fn an_overflow_recovers_the_snapshot_that_the_lost_event_would_have_taken() {
        let mut host = MemoryHost::new().with_document("a.md", "prima");
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
            .unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // Il contenuto cambia e il `DocumentChanged` va perso.
        host.write_document(&id("a.md"), "seconda", WriteBase::Dictated)
            .unwrap();
        host.advance(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
            .unwrap();

        let versions = store.list(&id("a.md"));
        assert_eq!(versions.len(), 2, "versioni: {versions:?}");
        assert_eq!(
            store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
            "seconda"
        );
        // E ripassare senza che nulla sia cambiato non gonfia la storia: il
        // dedup per contenuto è ciò che rende sostenibile una riconciliazione
        // che rilegge tutto.
        host.advance(1_000);
        handler
            .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
            .unwrap();
        assert_eq!(store.list(&id("a.md")).len(), 2);
    }

    #[test]
    fn opening_the_vault_photographs_what_has_no_history_yet() {
        let mut host = MemoryHost::new()
            .with_document("a.md", "com'era")
            .with_document("b.md", "anche questa");
        let store = VersionStore::open(&mut host).unwrap();
        // `b.md` una storia ce l'ha già: non deve guadagnare una versione
        // gemella solo perché il vault è stato riaperto.
        store
            .snapshot(&id("b.md"), ("anche questa").as_bytes(), &mut host)
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

    #[test]
    fn the_first_write_photographs_the_original() {
        let mut host = MemoryHost::new().with_document("a.md", "com'era");
        let store = VersionStore::open(&mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // Il gancio gira prima della prima scrittura: l'originale entra in
        // storia, e la scrittura che segue aggiunge la sua versione.
        handler
            .photograph_before_write(&mut host, &id("a.md"))
            .unwrap();
        host.write_document(&id("a.md"), "adesso", WriteBase::Dictated)
            .unwrap();
        host.advance(1_000);
        // L'evento della scrittura lo consegna il kernel; qui lo si chiama a
        // mano, come fanno gli altri test di questo modulo.
        handler
            .handle(
                &Notice::of(Event::DocumentChanged {
                    id: id("a.md"),
                    changes: None,
                }),
                &mut host,
            )
            .unwrap();

        let versions = store.list(&id("a.md"));
        assert_eq!(versions.len(), 2, "versioni: {versions:?}");
        assert_eq!(
            store.read(&id("a.md"), versions[1].ts, &host).unwrap(),
            "com'era",
            "l'originale è in storia"
        );
        assert_eq!(
            store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
            "adesso"
        );

        // Il contenuto già fotografato viene deduplicato, non duplicato.
        handler
            .photograph_before_write(&mut host, &id("a.md"))
            .unwrap();
        host.write_document(&id("a.md"), "poi", WriteBase::Dictated)
            .unwrap();
        host.advance(1_000);
        handler
            .handle(
                &Notice::of(Event::DocumentChanged {
                    id: id("a.md"),
                    changes: None,
                }),
                &mut host,
            )
            .unwrap();
        assert_eq!(store.list(&id("a.md")).len(), 3);
    }

    #[test]
    fn a_creation_is_not_photographed() {
        let mut host = MemoryHost::new();
        let store = VersionStore::open(&mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());

        // La nota non esiste: la scrittura è una creazione, non c'è un
        // originale da salvare, e il gancio risponde `Ok` senza fotografare.
        handler
            .photograph_before_write(&mut host, &id("c.md"))
            .unwrap();
        host.write_document(&id("c.md"), "nuova", WriteBase::Dictated)
            .unwrap();
        host.advance(1_000);
        handler
            .handle(
                &Notice::of(Event::DocumentChanged {
                    id: id("c.md"),
                    changes: None,
                }),
                &mut host,
            )
            .unwrap();

        let versions = store.list(&id("c.md"));
        assert_eq!(versions.len(), 1, "versioni: {versions:?}");
        assert_eq!(
            store.read(&id("c.md"), versions[0].ts, &host).unwrap(),
            "nuova",
            "la prima versione è il testo nuovo"
        );
    }

    #[test]
    fn binary_history_survives_rebuild_and_restores_exact_bytes() {
        let doc = id("image.png");
        let original = b"\x89PNG\r\n\x1a\n\0\xff";
        let edited = b"\x89PNG\r\n\x1a\n\xff\0";
        let mut host = MemoryHost::new();
        let base = host.write_document_bytes(&doc, original, None).unwrap();
        let store = VersionStore::open(&mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());
        handler.photograph_before_write(&mut host, &doc).unwrap();
        host.write_document_bytes(&doc, edited, Some(base)).unwrap();
        host.advance(1_000);
        handler
            .handle(
                &Notice::of(Event::EntryChanged {
                    id: doc.clone(),
                    kind: EntryKind::Asset,
                }),
                &mut host,
            )
            .unwrap();
        let versions = store.list(&doc);
        assert_eq!(versions.len(), 2);
        let docs = read_index(&host).unwrap();
        let entry = &docs[doc.as_str()];
        assert_eq!(
            version_source_doc(entry, &doc, versions[0].ts, &host).unwrap(),
            edited
        );
        assert_eq!(
            version_source_doc(entry, &doc, versions[1].ts, &host).unwrap(),
            original
        );

        host.data_remove(INDEX_FILE).unwrap();
        host.denies_write(INDEX_FILE);
        let rebuilt = VersionStore::open(&mut host).unwrap();
        assert_eq!(rebuilt.list(&doc), versions);
        VersioningCommands
            .invoke(
                VERSION_RESTORE,
                serde_json::json!({ DOC: doc.as_str(), TS: versions[1].ts }),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap();
        assert_eq!(
            fub_abi::traits::VaultRead::read_document_bytes(&host, &doc).unwrap(),
            original
        );
    }

    #[test]
    fn a_corrupt_snapshot_cannot_be_read_or_restored() {
        let doc = id("a.md");
        let mut host = MemoryHost::new().with_document(doc.as_str(), "current!");
        let store = VersionStore::open(&mut host).unwrap();
        let version = store
            .snapshot(&doc, b"original", &mut host)
            .unwrap()
            .unwrap();
        let docs = load_index(&host).unwrap();
        let path = blob(
            &docs[doc.as_str()].dir,
            &snapshot_name(version.ts, doc.as_str()),
        );
        host.data_write(&path, b"tampered").unwrap();

        assert!(matches!(
            store.read(&doc, version.ts, &host),
            Err(PluginError::Internal(_))
        ));
        assert!(matches!(
            VersioningCommands.invoke(
                VERSION_RESTORE,
                serde_json::json!({ DOC: doc.as_str(), TS: version.ts }),
                InvokeMode::Apply,
                &mut host,
            ),
            Err(PluginError::Internal(_))
        ));
        assert_eq!(
            fub_abi::traits::VaultRead::read_document(&host, &doc).unwrap(),
            "current!"
        );
    }

    #[test]
    fn a_write_preserves_an_unobserved_external_preimage() {
        let doc = id("data.bin");
        let original = b"\0\xfforiginal";
        let external = b"\xfe\0external";
        let next = b"\x80\0saved";
        let mut host = MemoryHost::new();
        let base = host.write_document_bytes(&doc, original, None).unwrap();
        let store = VersionStore::open(&mut host).unwrap();
        store.snapshot(&doc, original, &mut host).unwrap();
        let mut handler = VersioningHandler::new(store.clone());
        let base = host
            .write_document_bytes(&doc, external, Some(base))
            .unwrap();
        handler.photograph_before_write(&mut host, &doc).unwrap();
        host.write_document_bytes(&doc, next, Some(base)).unwrap();
        handler
            .handle(
                &Notice::of(Event::EntryChanged {
                    id: doc.clone(),
                    kind: EntryKind::Unknown,
                }),
                &mut host,
            )
            .unwrap();
        let versions = store.list(&doc);
        assert_eq!(versions.len(), 3);
        let docs = read_index(&host).unwrap();
        assert_eq!(
            version_source_doc(&docs[doc.as_str()], &doc, versions[1].ts, &host).unwrap(),
            external
        );
    }
}
