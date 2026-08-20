//! **La grana di un abbonamento** (§10.1,
//! [decisione 0033](../../../docs/decisions/0033-la-grana-di-un-abbonamento.md))
//! vista dal punto in cui conta: la consegna.
//!
//! La maschera era una lista di specie, e con quella sola grana chi si abbonava
//! ai custom li riceveva tutti — ogni topic di ogni plugin — e chi si abbonava a
//! `document-changed` si svegliava per ogni documento del vault. Le prove qui
//! sotto sono le quattro conseguenze della forma nuova, e ognuna è scritta in
//! coppia: la maschera **stretta** che non riceve, e la stessa storia con la
//! maschera **larga** che riceve. Una prova che mostra solo il silenzio non
//! distingue un filtro che funziona da un handler che non è mai stato chiamato.
//!
//! 1. Un prefisso di topic sveglia chi lo ha dichiarato, e nessun altro.
//! 2. Un soggetto restringe l'evento più caldo del contratto a una cartella —
//!    e un **rename che esce** dalla cartella arriva comunque, perché è l'unico
//!    modo che chi la guarda ha di smettere di tenerne lo stato.
//! 3. Un lotto arriva a chi guarda una cartella **se l'ha toccata**.
//! 4. Ciò che non nomina nessun documento (`overflow`, `vault-closed`) arriva a
//!    chiunque, soggetto o no: sono gli eventi che non si possono perdere.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::{Event, EventKind, EventMask, Notice, Subject};
use fub_abi::model::DocId;
use fub_abi::traits::{EventHandler, HostApi, PluginManifest, PluginPermissions};
use fub_kernel::{FormatRegistry, Trust, Workspace};
use fub_testkit::SampleText;

type Log = Arc<Mutex<Vec<String>>>;

/// Un handler che scrive ciò che riceve, con la maschera che gli si dà.
struct Spy {
    mask: EventMask,
    log: Log,
}

impl EventHandler for Spy {
    fn subscribed(&self) -> EventMask {
        self.mask.clone()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let line = match &notice.event {
            Event::DocumentChanged { id, .. } => format!("changed:{id}"),
            Event::DocumentRemoved { id } => format!("removed:{id}"),
            Event::DocumentRenamed { from, to } => format!("renamed:{from}->{to}"),
            Event::Custom { topic, .. } => format!("custom:{topic}"),
            Event::BatchEnded { changed, .. } => format!("batch:{}", changed.len()),
            Event::Overflow { dropped } => format!("overflow:{dropped}"),
            Event::VaultClosed { .. } => "closed".to_string(),
            other => format!("{:?}", other.kind()),
        };
        self.log.lock().unwrap().push(line);
        Ok(())
    }
}

const SPY: &str = "test.spia";
/// Due mittenti veri, con due namespace veri: un plugin non può emettere sotto
/// il nome di un altro (§7.4, decisione 0021), quindi i topic di questo test
/// sono quelli che il contratto lascia davvero passare.
const ACME: &str = "com.acme.tasks";
const OTHER: &str = "com.altro.note";

fn vault(mask: EventMask) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("txt").boxed())
        .expect("format");
    let mut ws = Workspace::new(&root, registry).expect("vault opens successfully");
    ws.register_core_feature(SPY, SPY).expect("declared");
    for plugin in [ACME, OTHER] {
        ws.register_plugin(
            PluginManifest::new(plugin, plugin).granting(PluginPermissions::core()),
            Trust::Community,
        )
        .expect("declared");
    }
    let log: Log = Arc::default();
    ws.register_event_handler(
        SPY,
        Box::new(Spy {
            mask,
            log: log.clone(),
        }),
    )
    .expect("registered");
    (dir, ws, log)
}

/// Gli stessi tre custom, sempre: è la storia che le due maschere raccontano
/// diversamente.
fn three_custom(ws: &mut Workspace) {
    for (plugin, topic) in [
        (ACME, "com.acme.tasks:done"),
        // Il `.` dentro il nome: `com.acme.tasks:board` è un prefisso di
        // questo, e `com.acme.tasks:boards` non lo sarebbe.
        (ACME, "com.acme.tasks:board.moved"),
        (OTHER, "com.altro.note:done"),
    ] {
        let topic = topic.to_string();
        ws.with_host(plugin, |host| {
            host.emit(Event::Custom {
                topic,
                payload: serde_json::Value::Null,
            })
        });
    }
}

#[test]
fn a_topic_prefix_wakes_up_who_declared_it_and_nobody_else() {
    let (_dir, mut ws, narrow) =
        vault(EventMask::of([EventKind::Custom]).on_topics(["com.acme.tasks"]));
    three_custom(&mut ws);
    assert_eq!(
        *narrow.lock().unwrap(),
        vec![
            "custom:com.acme.tasks:done".to_string(),
            // Il prefisso si spezza sui separatori del contratto, e `.` è uno
            // dei due: `board.moved` sta sotto `com.acme.tasks`.
            "custom:com.acme.tasks:board.moved".to_string(),
        ],
        "the other plugin is not its business: that is the entry's case — with \
         modules talking to each other, every handler woke for every custom of \
         every one"
    );

    // La stessa storia senza prefisso: la prova che il silenzio di sopra è un
    // filtro e non un handler mai chiamato.
    let (_dir, mut ws, wide) = vault(EventMask::of([EventKind::Custom]));
    three_custom(&mut ws);
    assert_eq!(wide.lock().unwrap().len(), 3);
}

#[test]
fn a_subject_narrows_the_hottest_event_to_one_folder() {
    let narrow = EventMask::of([EventKind::DocumentChanged]).about([Subject::folder("Progetti")]);
    let (_dir, mut ws, log) = vault(narrow);
    ws.write_document(&DocId::new("Progetti/Alpha.txt"), "a", WriteBase::Dictated)
        .unwrap();
    ws.write_document(
        &DocId::new("Diario/2026-07-28.txt"),
        "d",
        WriteBase::Dictated,
    )
    .unwrap();
    ws.write_document(
        &DocId::new("Progetti/2026/Beta.txt"),
        "b",
        WriteBase::Dictated,
    )
    .unwrap();
    assert_eq!(
        *log.lock().unwrap(),
        vec![
            "changed:Progetti/Alpha.txt".to_string(),
            "changed:Progetti/2026/Beta.txt".to_string(),
        ],
        "a folder contains everything under it at any depth, and nothing else"
    );

    let (_dir, mut ws, wide) = vault(EventMask::of([EventKind::DocumentChanged]));
    ws.write_document(
        &DocId::new("Diario/2026-07-28.txt"),
        "d",
        WriteBase::Dictated,
    )
    .unwrap();
    assert_eq!(
        wide.lock().unwrap().len(),
        1,
        "without a subject that write arrives: the silence above is the filter"
    );
}

#[test]
fn a_notes_leaving_the_folder_is_news_for_the_folder() {
    let (_dir, mut ws, log) = vault(
        EventMask::of([EventKind::DocumentChanged, EventKind::DocumentRenamed])
            .about([Subject::folder("Progetti")]),
    );
    ws.write_document(&DocId::new("Progetti/Alpha.txt"), "a", WriteBase::Dictated)
        .unwrap();
    ws.rename_document(
        &DocId::new("Progetti/Alpha.txt"),
        &DocId::new("Archivio/Alpha.txt"),
    )
    .expect("rename");

    let lines = log.lock().unwrap().clone();
    assert!(
        lines.contains(&"renamed:Progetti/Alpha.txt->Archivio/Alpha.txt".to_string()),
        "whoever watches a folder must know a note left: watching only the \
         arrival path would be a plausible and wrong read, and would leave \
         that note's state hanging forever. Received: {lines:?}"
    );
}

#[test]
fn a_batch_arrives_to_whoever_it_touched() {
    let (_dir, mut ws, log) =
        vault(EventMask::of([EventKind::BatchEnded]).about([Subject::folder("Progetti")]));
    // Una rinomina con backlink è un lotto vero, ma qui basta il caso più
    // piccolo: due lotti, uno che tocca la cartella e uno che non la tocca.
    ws.write_document(&DocId::new("Progetti/Alpha.txt"), "a", WriteBase::Dictated)
        .unwrap();
    ws.rename_document(
        &DocId::new("Progetti/Alpha.txt"),
        &DocId::new("Progetti/Beta.txt"),
    )
    .expect("rename inside");
    let inside = log.lock().unwrap().len();

    ws.write_document(&DocId::new("Diario/oggi.txt"), "d", WriteBase::Dictated)
        .unwrap();
    ws.rename_document(
        &DocId::new("Diario/oggi.txt"),
        &DocId::new("Diario/ieri.txt"),
    )
    .expect("rename outside");
    assert_eq!(
        log.lock().unwrap().len(),
        inside,
        "the second batch did not touch the folder: the watcher does not redraw"
    );
    assert!(inside > 0, "the first batch did touch it");
}

#[test]
fn what_nobody_can_rediscover_reaches_everyone() {
    let (_dir, mut ws, log) =
        vault(EventMask::all().about([Subject::document("Progetti/Alpha.txt")]));
    // Nessuno di questi due nomina un documento, e nessuno dei due si ritrova
    // guardando il vault: un `overflow` è l'invito a riconciliare, un
    // `vault-closed` è l'ultimo giro per rendere durevole ciò che si ha in
    // memoria. Filtrarli via per un soggetto vorrebbe dire perderli in silenzio
    // proprio a chi si è abbonato a poco.
    ws.with_host(ACME, |host| host.emit(Event::Overflow { dropped: 3 }));
    let lines = log.lock().unwrap().clone();
    assert_eq!(lines, vec!["overflow:3".to_string()], "{lines:?}");

    ws.close();
    assert!(
        log.lock().unwrap().contains(&"closed".to_string()),
        "the last round even reaches whoever subscribed to a single document"
    );
}
