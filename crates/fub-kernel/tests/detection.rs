//! **Il rilevamento delle modifiche esterne si può chiedere** (§9.7, decisione
//! 0030).
//!
//! Il watcher è l'unico meccanismo con cui Fub viene a sapere che qualcun
//! altro ha toccato il vault: non c'è una riconciliazione periodica, `reindex`
//! gira solo all'apertura, e niente confronta mai la cache col disco. Finché
//! nessuno chiedeva se fosse vivo, un vault **con** rilevamento e uno **senza**
//! erano indistinguibili da fuori — e la sincronizzazione per-path scartava il
//! proprio esito con un `let _ =`, quindi un file che non si legge lasciava la
//! cache, il grafo e l'indice fermi a *prima*, per sempre, senza che niente lo
//! dicesse.
//!
//! Qui si prova che quei due fatti adesso **si chiedono**, e dallo stesso posto

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Severity};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultStatus};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};

/// Un formato `.txt` che si limita a tenere il testo: qui il parse non è la
/// cosa in prova, la lettura sì.
struct PlainText;

impl FormatProvider for PlainText {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("text", "Plain text (test)", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Directory temporanea usa-e-getta (niente dipendenze di test nel kernel).
struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let base = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir not UTF-8")
            .join(format!("fub-detection-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("create temp dir");
        TempDir(base)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn workspace(dir: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(PlainText))
        .expect("no extension conflict");
    let mut ws = Workspace::new(dir, registry).expect("the vault opens");
    ws.reindex().expect("scan");
    ws
}

/// Lo stato del vault **passando dal canale dati**, che è l'unica strada che
/// avrà anche una feature.
fn status(ws: &Workspace) -> VaultStatus {
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s,
        other => panic!("the data channel answered off-topic: {other:?}"),
    }
}

/// Un vault senza rilevatore **lo dice**, e lo dice a chiunque sappia fare una
/// query — non a chi ha in mano l'host.
#[test]
fn a_vault_without_a_detector_says_so() {
    let dir = TempDir::new("without");
    let ws = workspace(&dir.0);

    let s = status(&ws);
    assert!(
        !s.watching,
        "nobody raised the flag: here nobody sees writes from others"
    );
    assert_eq!(s.sync_failures, 0);
    assert_eq!(s.last_sync_error, None);
}

/// La bandiera è **una sola**, ed è del kernel: chi guarda la alza e la
/// risposta del canale dati cambia da sé.
///
/// È il punto della voce: prima la risposta era *per costruzione* — chi non
/// aveva avviato un debouncer diceva `false`, chi ne aveva avviato uno diceva
/// `true` per sempre, anche da morto — e nessuno gliela chiedeva.
#[test]
fn the_flag_is_single_and_belongs_to_the_watcher() {
    let dir = TempDir::new("flag");
    let ws = workspace(&dir.0);

    // Chi monta prende la bandiera e la alza avviandosi. Qui il rilevatore non
    // c'è — il kernel non sa cosa sia, ed è esattamente il motivo per cui il
    // fatto gli arriva così.
    let flag = ws.watch_flag();
    flag.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(status(&ws).watching, "the answer follows the flag");

    // E quando chi guarda smette — un debouncer che riporta errori, o che viene
    // distrutto — la abbassa, senza che nessuno debba avvisare il kernel.
    flag.store(false, std::sync::atomic::Ordering::Relaxed);
    assert!(
        !status(&ws).watching,
        "a copy of the value, instead of the flag, would have stayed `true`"
    );
}

/// **Un esito scartato resta scritto.** I due chiamanti veri sono nel callback
/// del watcher e scrivono `let _ = ws.sync_path(…)`: qui si fa la stessa cosa,
/// e il vault se lo ricorda lo stesso.
#[test]
fn a_discarded_result_remains_written_in_the_vault() {
    let dir = TempDir::new("result");
    let mut ws = workspace(&dir.0);

    // Un file che c'è e non si legge: byte non UTF-8 dentro un'estensione
    // gestita. È il caso vero — un file scritto da un'altra app con un encoding
    // suo — e non un errore inventato.
    let path = dir.0.join("Note.txt");
    std::fs::write(&path, [0x66, 0x75, 0xff, 0xfe, 0x62]).expect("write bytes");

    // Esattamente come lo chiama il watcher: l'esito non lo guarda nessuno.
    let _ = ws.sync_path(&path);

    let s = status(&ws);
    assert_eq!(
        s.sync_failures, 1,
        "the failure was counted even though the caller did not read it"
    );
    let message = s.last_sync_error.expect("there is a last error");
    assert!(
        message.contains("Note.txt"),
        "the error says which file: {message}"
    );

    // Un secondo tentativo che va a buon fine non cancella il conto: «è già
    // successo» resta vero, e ciò che è rimasto indietro non torna indietro da
    std::fs::write(&path, "now readable").expect("rewrite");
    ws.sync_path(&path).expect("now passes");
    let after = status(&ws);
    assert_eq!(after.sync_failures, 1, "the count does not reset by itself");
    assert!(
        ws.read_source(&DocId::new("Note.txt")).is_ok(),
        "and the document got in: the count is a memory, not a blocking state"
    );
}

/// Un rename riferito dal filesystem che fallisce conta **una volta sola**,
/// anche quando degrada internamente a `sync_path`.
#[test]
fn a_failing_rename_counts_only_once() {
    let dir = TempDir::new("rename");
    let mut ws = workspace(&dir.0);

    let from = dir.0.join("Old.txt");
    let to = dir.0.join("New.txt");
    // `da` non è mai stato indicizzato, quindi `sync_renamed_path` degrada al
    // percorso per-path su `a` — che non si legge.
    std::fs::write(&to, [0xff, 0xfe]).expect("write bytes");

    let _ = ws.sync_renamed_path(&from, &to);

    assert_eq!(
        status(&ws).sync_failures,
        1,
        "the gate records, the internal body does not: a failure is a failure"
    );
}

/// **Un fallimento di sincronizzazione esce anche dalla porta**, e non solo nel
/// registro (difetto 0200).
///
/// La riga di todo diceva «non produce nessun segnale», e rimisurata è per metà
/// falsa: il segnale c'è ed è il conto del banco qui sopra, messo lì dalla 0030
/// proprio perché un chiamante distratto non potesse nasconderlo. Ma un fatto
/// interrogabile è una risposta a chi chiede, e chi chiede deve prima
/// sospettare: `VaultStatus` sta in un pannello che si apre quando ci si è già
/// accorti che qualcosa non torna. Il documento intanto resta indietro rispetto
/// al disco **per sempre** — non c'è riconciliazione periodica, `reindex` gira
/// solo all'apertura — quindi chi apre quella nota legge il testo di ieri e chi
/// la cerca la trova com'era ieri, senza che niente lo dica mentre succede.
///
/// Le tre uscite dicono tre cose diverse: il registro conta, il log resta dopo
/// che l'app si è chiusa, l'evento arriva **adesso**. Questo banco tiene la
/// terza, che è quella che mancava.
/// terza, che è quella che mancava.
#[test]
fn a_sync_failure_reaches_the_listener_too() {
    let dir = TempDir::new("gate");
    let mut ws = workspace(&dir.0);

    let path = dir.0.join("Note.txt");
    std::fs::write(&path, [0x66, 0x75, 0xff, 0xfe, 0x62]).expect("write bytes");

    let rx = ws.bus().subscribe();
    // Come lo chiama il watcher: l'esito non lo guarda nessuno.
    let _ = ws.sync_path(&path);

    let events: Vec<Event> = rx.try_iter().map(|n| n.event).collect();
    let trouble = events.iter().find_map(|and| match and {
        Event::Trouble {
            severity,
            subject,
            error,
            ..
        } => Some((*severity, subject.clone(), error.to_string())),
        _ => None,
    });
    let (severity, subject, reason) = trouble.unwrap_or_else(|| {
        panic!(
            "the document lagged behind the disk and nobody learned while it \
             happened: whoever opens that note reads yesterday's text, and \
             nothing passed on the channel ({events:?})"
        )
    });
    assert_eq!(
        severity,
        Severity::Warning,
        "the vault is the truth and re-opening recovers: it is a warning, not \
         a fatal failure"
    );
    assert_eq!(
        subject,
        Some(DocId::new("Note.txt")),
        "the subject of a failure is what the user has in hand, i.e. the note"
    );
    assert!(
        reason.contains("Note.txt"),
        "and the reason says which file: {reason}"
    );
}
