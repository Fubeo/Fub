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
use fub_testkit::TestoDiProva;

type Log = Arc<Mutex<Vec<String>>>;

/// Un handler che scrive ciò che riceve, con la maschera che gli si dà.
struct Spia {
    mask: EventMask,
    log: Log,
}

impl EventHandler for Spia {
    fn subscribed(&self) -> EventMask {
        self.mask.clone()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let riga = match &notice.event {
            Event::DocumentChanged { id, .. } => format!("cambiato:{id}"),
            Event::DocumentRemoved { id } => format!("rimosso:{id}"),
            Event::DocumentRenamed { from, to } => format!("rinominato:{from}->{to}"),
            Event::Custom { topic, .. } => format!("custom:{topic}"),
            Event::BatchEnded { changed, .. } => format!("lotto:{}", changed.len()),
            Event::Overflow { dropped } => format!("overflow:{dropped}"),
            Event::VaultClosed { .. } => "chiuso".to_string(),
            altro => format!("{:?}", altro.kind()),
        };
        self.log.lock().unwrap().push(riga);
        Ok(())
    }
}

const SPIA: &str = "test.spia";
/// Due mittenti veri, con due namespace veri: un plugin non può emettere sotto
/// il nome di un altro (§7.4, decisione 0021), quindi i topic di questo test
/// sono quelli che il contratto lascia davvero passare.
const ACME: &str = "com.acme.tasks";
const ALTRO: &str = "com.altro.note";

fn vault(mask: EventMask) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("txt").boxed())
        .expect("formato");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature(SPIA, SPIA).expect("dichiarato");
    for plugin in [ACME, ALTRO] {
        ws.register_plugin(
            PluginManifest::new(plugin, plugin).granting(PluginPermissions::core()),
            Trust::Community,
        )
        .expect("dichiarato");
    }
    let log: Log = Arc::default();
    ws.register_event_handler(
        SPIA,
        Box::new(Spia {
            mask,
            log: log.clone(),
        }),
    )
    .expect("registrato");
    (dir, ws, log)
}

/// Gli stessi tre custom, sempre: è la storia che le due maschere raccontano
/// diversamente.
fn tre_custom(ws: &mut Workspace) {
    for (plugin, topic) in [
        (ACME, "com.acme.tasks:done"),
        // Il `.` dentro il nome: `com.acme.tasks:board` è un prefisso di
        // questo, e `com.acme.tasks:boards` non lo sarebbe.
        (ACME, "com.acme.tasks:board.moved"),
        (ALTRO, "com.altro.note:done"),
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
    let (_dir, mut ws, stretto) =
        vault(EventMask::of([EventKind::Custom]).on_topics(["com.acme.tasks"]));
    tre_custom(&mut ws);
    assert_eq!(
        *stretto.lock().unwrap(),
        vec![
            "custom:com.acme.tasks:done".to_string(),
            // Il prefisso si spezza sui separatori del contratto, e `.` è uno
            // dei due: `board.moved` sta sotto `com.acme.tasks`.
            "custom:com.acme.tasks:board.moved".to_string(),
        ],
        "l'altro plugin non è affar suo: è il caso della voce — con i moduli \
         che si parlano fra loro, ogni handler si svegliava per ogni custom di \
         ognuno"
    );

    // La stessa storia senza prefisso: la prova che il silenzio di sopra è un
    // filtro e non un handler mai chiamato.
    let (_dir, mut ws, largo) = vault(EventMask::of([EventKind::Custom]));
    tre_custom(&mut ws);
    assert_eq!(largo.lock().unwrap().len(), 3);
}

#[test]
fn a_subject_narrows_the_hottest_event_to_one_folder() {
    let stretta = EventMask::of([EventKind::DocumentChanged]).about([Subject::folder("Progetti")]);
    let (_dir, mut ws, log) = vault(stretta);
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
            "cambiato:Progetti/Alpha.txt".to_string(),
            "cambiato:Progetti/2026/Beta.txt".to_string(),
        ],
        "una cartella contiene ciò che le sta sotto a qualunque profondità, e \
         nient'altro"
    );

    let (_dir, mut ws, largo) = vault(EventMask::of([EventKind::DocumentChanged]));
    ws.write_document(
        &DocId::new("Diario/2026-07-28.txt"),
        "d",
        WriteBase::Dictated,
    )
    .unwrap();
    assert_eq!(
        largo.lock().unwrap().len(),
        1,
        "senza soggetto quella scrittura arriva: il silenzio di sopra è il filtro"
    );
}

#[test]
fn a_note_leaving_the_folder_is_news_for_the_folder() {
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
    .expect("rinomina");

    let righe = log.lock().unwrap().clone();
    assert!(
        righe.contains(&"rinominato:Progetti/Alpha.txt->Archivio/Alpha.txt".to_string()),
        "chi guarda una cartella deve sapere che una nota se n'è andata: \
         guardare il solo path d'arrivo sarebbe una lettura plausibile e \
         sbagliata, e lascerebbe lo stato di quella nota appeso per sempre. \
         Ricevuti: {righe:?}"
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
    .expect("rinomina dentro");
    let dentro = log.lock().unwrap().len();

    ws.write_document(&DocId::new("Diario/oggi.txt"), "d", WriteBase::Dictated)
        .unwrap();
    ws.rename_document(
        &DocId::new("Diario/oggi.txt"),
        &DocId::new("Diario/ieri.txt"),
    )
    .expect("rinomina fuori");
    assert_eq!(
        log.lock().unwrap().len(),
        dentro,
        "il secondo lotto non ha toccato la cartella: chi la guarda non ridisegna"
    );
    assert!(dentro > 0, "il primo lotto invece l'ha toccata");
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
    let righe = log.lock().unwrap().clone();
    assert_eq!(righe, vec!["overflow:3".to_string()], "{righe:?}");

    ws.close();
    assert!(
        log.lock().unwrap().contains(&"chiuso".to_string()),
        "l'ultimo giro arriva anche a chi si era abbonato a un documento solo"
    );
}
