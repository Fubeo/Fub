//! **L'apertura di un vault non è tutto-o-niente** (§15.7,
//! [decisione 0068](../../../docs/decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md)).
//!
//! La proprietà sotto esame è una sola, e ha un confine che vale quanto lei:
//!
//! - un documento che non si **legge** o non si **parsa** non fa fallire
//!   l'apertura: finisce fra gli scarti dell'`Opening`, la sua voce resta in
//!   anagrafe — il file c'è — e nessun indice lo riceve;
//! - la **scansione** invece resta fatale, ed è deliberato: un vault che non sa
//!   dire quali documenti esistono non può aprirsi «in parte», perché
//!   `reconcile` dichiara agli indici l'insieme **completo** e un insieme
//!   incompleto li farebbe potare.
//!
//! I due assi si guardano insieme perché il difetto che questa voce toglie non
//! è «manca la tolleranza»: è che la tolleranza c'era già dieci righe sotto —
//! il flush degli indici — e si fermava un passo prima di dove serviva.

use std::sync::{Arc, Mutex};

use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Event, EventKind, Severity};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute, VaultEntry,
};
use fub_abi::FormatProvider;
#[cfg(unix)]
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::{Bench, Mounted};

/// Un provider `.md` che rifiuta i sorgenti contenenti `BOOM`.
///
/// Il markdown vero non fallisce quasi mai il parse, ma il contratto lo
/// permette — `FormatProvider::parse` restituisce un `Result` — e prima di
/// questa voce quel `Result` era il modo di non far aprire un vault.
struct FallibleProvider;

impl FormatProvider for FallibleProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("fallibile", "Formato fallibile (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
        if source.contains("BOOM") {
            return Err(FormatError::Parse("sorgente rifiutato".into()));
        }
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
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

/// Un indice che annota **cosa gli è arrivato**: è il solo modo di distinguere
/// «il documento è in anagrafe» da «il documento è stato indicizzato», che è
/// esattamente la distinzione che uno scarto crea.
#[derive(Clone, Default)]
struct SpyIndex {
    seen: Arc<Mutex<Vec<String>>>,
    /// L'insieme che `reconcile` ha dichiarato completo, dell'ultimo giro.
    existing: Arc<Mutex<Vec<String>>>,
}

impl IndexProvider for SpyIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut seen = self.seen.lock().unwrap();
        for doc in docs {
            seen.push(doc.id.to_string());
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        *self.existing.lock().unwrap() = ids.iter().map(|d| d.to_string()).collect();
        Vec::new()
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::BadArgs("la spia non risponde".into()))
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

/// Un vault montato ma **non ancora aperto**, con la spia degli eventi accesa e
/// un indice che annota. `senza_scansione` è indispensabile: l'apertura da
/// guardare è la prima, e il banco altrimenti l'ha già fatta.
fn bench_from_open() -> (Mounted, SpyIndex) {
    let probe = SpyIndex::default();
    let mut bench = Bench::new()
        .with_format(Box::new(FallibleProvider))
        .with_plugin("test.spia")
        .with_spy()
        .without_scan()
        .mounts();
    bench
        .register_index_provider("test.spia".to_string(), Box::new(probe.clone()))
        .expect("l'indice si registra");
    (bench, probe)
}

/// Byte che non sono UTF-8: è ciò che resta di una nota dopo un crash a metà
/// scrittura, o un file binario a cui qualcuno ha dato l'estensione sbagliata.
const NON_UTF8: &[u8] = &[0xff, 0xfe, 0x00, 0x9f];

// --- ciò che si tollera ----------------------------------------------------

#[test]
fn a_notes_unreadable_not_prevents_to_the_vault_of_open() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(bench.root().join("rotta.md"), NON_UTF8).expect("semina");
    std::fs::write(bench.root().join("altra.md"), "anche io").expect("semina");

    let opening = bench.reindex().expect("il vault si apre lo stesso");

    let discarded: Vec<String> = opening.discarded.iter().map(|s| s.id.to_string()).collect();
    assert_eq!(
        discarded,
        ["rotta.md"],
        "l'apertura segnala cosa non ha letto, e solo quello"
    );
    assert!(!opening.whole(), "questa apertura non è intera");

    let seen = probe.seen.lock().unwrap().clone();
    assert!(
        seen.contains(&"buona.md".to_string()) && seen.contains(&"altra.md".to_string()),
        "le altre note sono arrivate agli indici: {seen:?}"
    );
    assert!(
        !seen.contains(&"rotta.md".to_string()),
        "ciò che non si è letto non si può indicizzare: {seen:?}"
    );
}

#[test]
fn a_notes_that_the_parser_rejects_and_a_discard_as_a_that_not_is_reads() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(bench.root().join("rifiutata.md"), "BOOM").expect("semina");

    let opening = bench.reindex().expect("il vault si apre lo stesso");

    assert_eq!(
        opening
            .discarded
            .iter()
            .map(|s| s.id.to_string())
            .collect::<Vec<_>>(),
        ["rifiutata.md"],
        "lettura e parse sono lo stesso caso: il contenuto non si è potuto vedere"
    );
    let seen = probe.seen.lock().unwrap().clone();
    assert_eq!(seen, ["buona.md"], "il resto del vault è arrivato");
}

#[test]
fn the_document_discarded_remains_in_registry_why_the_file_c_and() {
    let (mut bench, _) = bench_from_open();
    std::fs::write(bench.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(bench.root().join("rotta.md"), NON_UTF8).expect("semina");

    bench.reindex().expect("apre");

    // Questa è la riga che separa uno scarto da una cancellazione. La scansione
    // ha visto il file, quindi il file **esiste**: sta nell'albero, ha
    // dimensione e data. Toglierlo dall'anagrafe perché non se ne è letto il
    // contenuto vorrebbe dire far sparire dalla vista dell'utente proprio la
    // nota che ha un problema — cioè nascondere il guasto invece di segnalarlo.
    let IndexResult::Entries(page) = bench
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("l'anagrafe risponde")
    else {
        panic!("la risposta all'anagrafe è un'anagrafe");
    };
    let registry: Vec<String> = page.items.iter().map(|and| and.id.to_string()).collect();
    assert!(
        registry.contains(&"rotta.md".to_string()),
        "la nota illeggibile esiste lo stesso: {registry:?}"
    );

    // E la controprova, che è ciò che rende questo presidio diverso dal primo:
    // **anagrafe e documenti indicizzati adesso divergono**, e uno scarto è
    // esattamente il caso in cui divergono. Prima di questa voce non potevano:
    // o un documento si parsava, o il vault non si apriva.
    let indexed: Vec<String> = bench.documents().iter().map(|d| d.to_string()).collect();
    assert_eq!(
        indexed,
        ["buona.md"],
        "di ciò che non si è letto non c'è niente da indicizzare"
    );
}

#[test]
fn every_discard_exits_as_fault_after_that_the_vault_is_and_said_open() {
    let (mut bench, _) = bench_from_open();
    std::fs::write(bench.root().join("rotta.md"), NON_UTF8).expect("semina");

    // Ci si iscrive al **bus** e non alla spia del banco: un `EventHandler` con
    // `EventMask::all()` non riceve i guasti — quella maschera non nomina
    // `EventKind::Trouble` — mentre il ponte verso la shell, che è chi li
    // mostra, prende i `Notice` dal bus come si fa qui.
    let rx = bench.bus().subscribe();
    bench.reindex().expect("apre");

    let seen: Vec<Event> = std::iter::from_fn(|| rx.try_recv().ok())
        .map(|n| n.event)
        .collect();

    let failure = seen
        .iter()
        .position(|and| {
            matches!(
                and,
                Event::Trouble {
                    severity: Severity::Failure,
                    subject: Some(id),
                    ..
                } if id.as_str() == "rotta.md"
            )
        })
        .expect("lo scarto esce come guasto, col documento per soggetto");

    // **`Failure` e non `Warning`**: la regola della 0052 taglia su
    // derivato-contro-autorevole, e qui non si è perso un indice — che si
    // rifà — ma la vista sul contenuto di una nota dell'utente. È anche la
    // ragione per cui uno scarto non è un `IndexLoss`, che esce `Warning`.
    let open = seen
        .iter()
        .position(|and| and.kind() == EventKind::VaultOpened)
        .expect("il vault si dice aperto");

    // **L'ordine si è rovesciato con l'apertura a fasi (§15.7), e va letto come
    // un acquisto e non come una perdita.** Finché l'apertura era una chiamata
    // sola, i guasti potevano precedere `VaultOpened` — e la 0068 aveva chiesto
    // che lo facessero, perché chi disegnava il vault appena aperto avesse già
    // in mano ciò che non si era letto. Adesso `VaultOpened` esce quando il
    // vault è **utilizzabile**, cioè prima che qualsiasi documento sia stato
    // aperto: quel lotto non può più esistere, perché scoprire uno scarto vuol
    // dire aver già letto, e leggere è la fase dopo. Ciò che resta promesso è
    // che ogni scarto esca comunque, sulla stessa superficie, mentre
    // l'indicizzazione procede.
    assert!(
        open < failure,
        "il vault si dichiara aperto quando è usabile, e ciò che non si legge arriva mentre indicizza"
    );

    // E la parte che non si è rovesciata: un guasto resta **dentro**
    // l'apertura, cioè arriva prima che l'indicizzazione si dica finita. Chi
    // aspetta `IndexUpdated` per disegnare una ricerca ha già in mano ciò che di
    // quel vault non entrerà mai nei risultati.
    let indexed = seen
        .iter()
        .position(|and| and.kind() == EventKind::IndexUpdated)
        .expect("l'indicizzazione si dice finita");
    assert!(
        failure < indexed,
        "uno scarto è un fatto dell'apertura, non una notizia che arriva dopo"
    );
}

// --- il confine: cosa resta fatale -----------------------------------------

#[cfg(unix)]
#[test]
fn a_vault_that_not_is_scans_not_is_opens_a_metadata() {
    use std::os::unix::fs::PermissionsExt;

    // La scansione è l'unico passo il cui fallimento riguarda il vault intero
    // e non un suo documento, ed è per questo che `reindex` restituisce ancora
    // un `Result`: senza l'elenco dei file, `reconcile` direbbe agli indici che
    // l'insieme completo è vuoto, e ognuno cancellerebbe tutto ciò che sa.
    // Meglio non aprire — un danno raro e rumoroso — che aprire potando.
    //
    // Una radice che non esiste non arriva più fin qui: l'apertura la rifiuta
    // all'ingresso (0160), ed è un banco a parte. Qui la camminata deve
    // fallire su una radice che l'ingresso ha accettato, e l'obstacle è una
    // cartella dentro il vault che non si lascia elencare.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let obstacle = dir.path().join("non-leggibile");
    std::fs::create_dir(&obstacle).expect("cartella");
    std::fs::write(obstacle.join("nota.md"), "x").expect("semina");
    std::fs::set_permissions(&obstacle, std::fs::Permissions::from_mode(0o000))
        .expect("permesso tolto");
    // Da root l'obstacle non ostacola: lo dice la lettura, non un elenco di
    // utenti, e se non ostacola il banco non può dimostrare niente.
    if std::fs::read_dir(&obstacle).is_ok() {
        std::fs::set_permissions(&obstacle, std::fs::Permissions::from_mode(0o700))
            .expect("permesso restituito");
        eprintln!("si salta: questo utente elenca anche una cartella 000");
        return;
    }
    let mut ws = Workspace::new(&root, FormatRegistry::new()).expect("la radice vera si apre");

    let outcome = ws.reindex();

    assert!(
        outcome.is_err(),
        "un vault la cui camminata non si legge non si apre con un'apertura vuota"
    );
    std::fs::set_permissions(&obstacle, std::fs::Permissions::from_mode(0o700))
        .expect("permesso restituito per la pulizia");
}

#[test]
fn that_that_not_is_and_read_remains_between_the_documents_that_exist() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(bench.root().join("rotta.md"), NON_UTF8).expect("semina");

    bench.reindex().expect("apre");

    // `reconcile` dichiara agli indici l'insieme **completo**, e ognuno cancella
    // ciò che non c'è dentro. Uno scarto non è un documento sparito: costruire
    // quell'insieme dai soli documenti indicizzati farebbe uscire dalla ricerca,
    // in silenzio e alla prima apertura andata storta, proprio la nota che
    // qualcuno vorrà ritrovare.
    let existing = probe.existing.lock().unwrap().clone();
    assert_eq!(
        existing,
        ["buona.md", "rotta.md"],
        "il documento illeggibile esiste, quindi nessun indice deve buttarlo"
    );
}

// --- la forma dell'apertura: due tempi (§15.7, decisione 0070) --------------

/// **Dopo la prima fase il vault sa cosa c'è, e non cosa dicono.**
///
/// È la linea del taglio, e questo presidio la fissa da tutte e due le parti:
/// se l'anagrafe non fosse intera qui, il vault non sarebbe *utilizzabile* al
/// ritorno di `open` — e se gli indici fossero già pieni, non ci sarebbe una
/// seconda fase da fare.
#[test]
fn the_first_phase_from_the_registry_and_not_the_index() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("una.md"), "prima").expect("semina");
    std::fs::write(bench.root().join("due.md"), "seconda").expect("semina");

    let work = bench.scan_vault().expect("la scansione riesce");

    assert_eq!(work.total(), 2, "il totale lo sa la scansione");
    assert_eq!(work.done(), 0, "e non ha ancora guardato niente");
    assert!(
        probe.seen.lock().unwrap().is_empty(),
        "nessun indice è stato alimentato: leggere è la fase dopo"
    );

    // L'anagrafe invece c'è **tutta**, ed è ciò che rende il vault usabile
    // adesso: l'albero dei file si disegna, una nota si apre.
    let entries = match bench.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: None,
    }) {
        Ok(IndexResult::Entries(paged)) => paged,
        other => panic!("attesa l'anagrafe, trovato {other:?}"),
    };
    let mut names: Vec<String> = entries.items.iter().map(|and| and.id.to_string()).collect();
    names.sort();
    assert_eq!(names, ["due.md", "una.md"]);
}

/// **Un'indicizzazione portata in fondo a fette dà lo stesso vault di `reindex`.**
///
/// È la promessa che rende `reindex` una composizione e non una seconda strada:
/// se le due divergessero, ogni presidio scritto contro `reindex` starebbe
/// provando qualcosa che in produzione non succede più.
#[test]
fn the_slices_arrive_where_arrives_the_round_whole() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("una.md"), "prima").expect("semina");
    std::fs::write(bench.root().join("due.md"), "seconda").expect("semina");

    let mut work = bench.scan_vault().expect("scansiona");
    while !work.finished() {
        // Le due fasi della 0119, che sono la sola forma che chi ha i thread
        // può scrivere: il piano sotto prestito condiviso, l'applicazione sotto
        // quello esclusivo.
        let plan = bench.plan_batch(&mut work);
        bench.index_batch_prepared(plan);
    }
    let opening = bench.finish_index(work);

    assert!(opening.whole(), "niente scarti e niente interruzioni");
    let mut seen = probe.seen.lock().unwrap().clone();
    seen.sort();
    assert_eq!(seen, ["due.md", "una.md"], "gli indici hanno tutto");
    let mut existing = probe.existing.lock().unwrap().clone();
    existing.sort();
    assert_eq!(
        existing,
        ["due.md", "una.md"],
        "e `reconcile` ha dichiarato l'insieme completo"
    );
}

/// **A caldo la seconda fase non ha niente da fare**: l'anagrafe porta già i
/// metadati, e `scan_vault` li rimette in cache prima di `VaultOpened`.
///
/// È il taglio del passo 4: se restasse da fare un giro a fette, ogni
/// riapertura immutata pagherebbe 59 lotti a vuoto. Un indice plugin che non
/// dichiara `up_to_date` **non** prende questa strada — lo tiene
/// `a_index_that_not_says_nothing_receives_all`.
#[test]
fn a_warm_the_second_phase_not_has_nothing_from_do() {
    let mut bench = Bench::new()
        .with_format(Box::new(FallibleProvider))
        .without_scan()
        .mounts();
    std::fs::write(bench.root().join("una.md"), "prima").expect("semina");
    std::fs::write(bench.root().join("due.md"), "seconda").expect("semina");
    // La semina dev'essere **strettamente nel passato** quando il primo giro
    // la osserva: una data nello stesso millisecondo dell'osservazione è
    // *racily clean* (difetto 0187) e la voce non si scrive in anagrafe —
    // senza questa pausa il banco litiga con l'orologio e perde quando è
    // veloce, cioè quando gira da solo. La stessa pausa, con lo stesso nome,
    // sta in `anagrafe.rs` e `ricongiungimento.rs`.
    beyond_the_millisecondo();
    bench.reindex().expect("primo giro");

    let work = bench.scan_vault().expect("riapre");
    assert_eq!(work.total(), 0, "niente da leggere: l'anagrafe basta");
    assert!(work.finished(), "e quindi la seconda fase è già finita");
    let mut ids: Vec<String> = bench
        .documents()
        .into_iter()
        .map(|d| d.to_string())
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        ["due.md", "una.md"],
        "i metadati sono in cache già dopo la scansione, prima di finish_index"
    );

    let opening = bench.finish_index(work);
    assert!(opening.whole(), "un vault immutato si chiude intero");
}

/// La pausa che porta la semina oltre il millisecondo corrente, perché la
/// regola *racily clean* (difetto 0187) si fidi della data che ha visto. Il
/// gemello sta in `anagrafe.rs` e `ricongiungimento.rs`.
fn beyond_the_millisecondo() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

/// **Chi smette a metà non riconcilia**, ed è la riga che separa «ho smesso di
/// indicizzare» da «cancella».
///
/// `reconcile` dice a ogni indice *quali documenti esistono*, e ognuno cancella
/// ciò che non è nell'elenco. Chiamarlo su un'indicizzazione fermata direbbe
/// agli indici di dimenticare tutto ciò che l'interruzione non ha fatto in
/// tempo a nominare — su un vault grande, quasi tutto.
#[test]
fn a_indexing_interrupted_not_declares_complete_nothing() {
    let (mut bench, probe) = bench_from_open();
    std::fs::write(bench.root().join("una.md"), "prima").expect("semina");
    std::fs::write(bench.root().join("due.md"), "seconda").expect("semina");

    // Si scansiona e **non si fa nessuna fetta**: è l'annullamento premuto
    // sull'istante, che è il caso peggiore e quindi quello da fissare.
    let work = bench.scan_vault().expect("scansiona");
    let opening = bench.finish_index(work);

    assert!(opening.interrupted, "l'apertura sa di non essere finita");
    assert!(!opening.whole(), "e quindi non è intera");
    assert!(
        probe.existing.lock().unwrap().is_empty(),
        "`reconcile` non è stato chiamato: un insieme incompleto non si dichiara completo"
    );
}
