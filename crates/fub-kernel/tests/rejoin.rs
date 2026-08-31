//! **La rinomina che non ha visto nessuno** (§23.1), dal livello `Workspace`.
//!
//! Il path è la chiave e lo è per sempre (decisione 0043). Chi rinomina una nota
//! mentre Fub è aperto la fa seguire da tutto ciò che le sta attaccato — il
//! rilevatore accoppia i due path e si finisce in `migrate_identity`. Chi la
//! rinomina mentre Fub è **chiuso** non ha nessuno che accoppi, e alla
//! riapertura la bozza non salvata, lo spazio per-documento e le versioni
//! restano attaccati a un nome che non esiste più.
//!
//! Le proprietà sotto esame sono quattro, e nessuna si vede da dentro un modulo
//! perché tutte e quattro vogliono **due aperture** con un disco che cambia in
//! mezzo:
//!
//! 1. **Identità filesystem + contenuto.** Un documento sparito e uno comparso
//!    si ricongiungono soltanto quando l'identità del file è la stessa e anche
//!    SHA-256 coincide: né inode/file-index né contenuto bastano da soli.
//! 2. **Una copia non è una rinomina.** Copy+delete produce un file nuovo anche
//!    con gli stessi byte e non eredita bozza o side-data.
//! 3. **Identità prima dell'ambiguità di contenuto.** Più file con testo uguale
//!    possono essere rinominati insieme: device/inode o volume/file-index rende
//!    l'accoppiamento univoco senza indovinare dal digest.
//! 4. **Una raccolta si fa su un'anagrafe completa, o non si fa.** È la regola
//!    che `finish_index` applicava già al suo vicino di tre righe sopra.

use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Subscription, Workspace};

/// Il plugin di prova che tiene qualcosa attaccato a una nota. Non serve che sia
/// montato: la migrazione e la raccolta camminano il **disco**, apposta per
/// coprire chi è spento (decisione 0044).
const PLUGIN: &str = "test.appiccicoso";

/// Provider `.txt` minimo: qui il parse non è sotto esame.
struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("plain", "Testo semplice (test)", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
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

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn rename(&self, from: &str, to: &str) {
        let dest = self.root.join(to);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::rename(self.root.join(from), dest).unwrap();
    }

    /// Un workspace montato e non ancora aperto.
    ///
    /// La pausa è la **regola *racily clean*** vista da qui: l'anagrafe non
    /// crede a ciò che ha una data non anteriore alla propria scrittura, e in un
    /// test i file nascono nello stesso millisecondo in cui il vault si apre.
    /// Senza, la tabella di ieri si rileggerebbe vuota — cioè non ci sarebbe
    /// nessuna impronta con cui accoppiare, e questi banchi passerebbero o no a
    /// seconda di dove cade il tick del millisecondo.
    fn mounted(&self) -> Workspace {
        beyond_the_millisecondo();
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(TxtProvider))
            .expect("nessun conflitto");
        Workspace::new(&self.root, registry).expect("l'apertura del vault riesce")
    }

    /// Apre il vault da zero, come farebbe un riavvio dell'app.
    fn open(&self) -> Workspace {
        let mut ws = self.mounted();
        ws.reindex().expect("reindex");
        ws
    }

    /// La cartella dello spazio per-documento di `doc`, per il plugin di prova.
    fn space(&self, doc: &str) -> Utf8PathBuf {
        self.root
            .join(".fub/data/plugins")
            .join(PLUGIN)
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc))
    }

    /// Ci mette dentro un byte, che è ciò che un plugin farebbe scrivendo
    /// un'annotazione: la cartella vuota non dimostrerebbe che il **contenuto**
    /// ha seguito la nota.
    fn attach_data(&self, doc: &str) {
        let dir = self.space(doc);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("annotazione"), format!("i dati di {doc}")).unwrap();
    }

    fn data_of(&self, doc: &str) -> Option<String> {
        std::fs::read_to_string(self.space(doc).join("annotazione")).ok()
    }
}

/// Vedi [`Fixture::montato`].
fn beyond_the_millisecondo() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

fn events(rx: &Subscription) -> Vec<Notice> {
    let mut seen = Vec::new();
    while let Ok(n) = rx.try_recv() {
        seen.push(n);
    }
    seen
}

fn draft_of(ws: &Workspace, doc: &str) -> Option<String> {
    ws.drafts()
        .expect("bozze")
        .drafts
        .into_iter()
        .find(|b| b.doc.as_str() == doc)
        .map(|b| b.text)
}

// --- 1. si riconosce dal contenuto -----------------------------------------

#[test]
fn a_rename_made_ad_app_closed_is_recognizes_from_fingerprint() {
    let f = Fixture::new();
    f.write("nota.txt", "un contenuto che sta in una nota sola");
    let mut ws = f.open();
    // Il buffer sporco: è l'unica copia di questo testo, e il caso peggiore
    // della voce.
    ws.save_draft(&DocId::new("nota.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    ws.set_icon("nota.txt", Some("📌".into())).expect("icona");
    f.attach_data("nota.txt");
    drop(ws);

    // Il client di sync, o il Finder, mentre Fub è chiuso.
    f.rename("nota.txt", "Progetti/nota rinominata.txt");

    let ws = f.open();
    assert_eq!(
        draft_of(&ws, "Progetti/nota rinominata.txt").as_deref(),
        Some("e questo non l'ho salvato"),
        "la bozza ha seguito la nota"
    );
    assert!(
        draft_of(&ws, "nota.txt").is_none(),
        "e non è rimasta anche sotto il nome vecchio"
    );
    assert_eq!(
        f.data_of("Progetti/nota rinominata.txt").as_deref(),
        Some("i dati di nota.txt"),
        "e lo spazio per-documento di un plugin nemmeno montato"
    );
    assert!(
        f.data_of("nota.txt").is_none(),
        "che si è spostato invece di essere copiato"
    );
    assert_eq!(
        ws.organization()
            .icons
            .get("Progetti/nota rinominata.txt")
            .map(String::as_str),
        Some("📌"),
        "e l'organizzazione del kernel, che passa dalla stessa funzione"
    );
}

#[test]
fn a_rename_that_finds_a_draft_to_the_destination_not_buries_the_source() {
    // La destinazione del ricongiungimento ha già una bozza sua: `b.txt` è una
    // nota mai salvata, e la sua bozza è l'unica copia di quel testo — quindi
    // quella di `a.txt` non può diventare la bozza di `b.txt` senza cancellare
    // il testo di qualcun altro. Ma non deve nemmeno restare sotto `a.txt`,
    // un nome che non esiste più e che nessun recupero ritrova: prende un
    // **nome di recupero** libero, che decodifica in un documento che
    // l'anagrafe non conosce — la bozza si elenca come orfana, una sola, e la
    // destinazione resta intatta.
    let f = Fixture::new();
    f.write("a.txt", "il contenuto che si sposta");
    let mut ws = f.open();
    ws.save_draft(
        &DocId::new("a.txt"),
        "il testo non salvato di a",
        Some(Revision::of("l'impronta di quando il buffer è partito")),
    )
    .expect("bozza");
    ws.save_draft(&DocId::new("b.txt"), "il testo non salvato di b", None)
        .expect("bozza");
    drop(ws);

    // Il client di sync, o il Finder, mentre Fub è chiuso.
    f.rename("a.txt", "b.txt");

    let ws = f.open();
    assert!(
        draft_of(&ws, "a.txt").is_none(),
        "sotto l'id morto non resta niente"
    );
    assert_eq!(
        draft_of(&ws, "b.txt").as_deref(),
        Some("il testo non salvato di b"),
        "la bozza che era già lì non si è sovrascritta"
    );
    assert_eq!(
        draft_of(&ws, "a~recovery.txt").as_deref(),
        Some("il testo non salvato di a"),
        "e quella che non è potuta atterrare è comparsa nel recupero — con \
         l'estensione del documento conservata — col testo e la base intatti"
    );
    let drafts = ws.drafts().expect("bozze");
    assert_eq!(
        drafts.drafts.len(),
        2,
        "una bozza per identità: il testo si sposta una volta sola, e non si \
         duplica"
    );
    // L'orfana: il nome di recupero decodifica in un documento che l'anagrafe
    // non conosce — è la condizione che il pannello di recupero chiama
    // «orfana» (esiste: falso), cioè la forma che offre.
    match ws.query_index(IndexQuery::Drafts { page: None }) {
        Ok(IndexResult::Drafts(page)) => {
            let orphan = page
                .items
                .iter()
                .find(|d| d.doc == DocId::new("a~recovery.txt"))
                .expect("la bozza di recupero è nell'elenco");
            assert!(
                !orphan.exists,
                "il documento `a~recovery.txt` non esiste: la bozza si offre \
                 come orfana"
            );
            assert_eq!(
                orphan.base,
                Some(Revision::of("l'impronta di quando il buffer è partito")),
                "e la base — ciò che permette di dire «il file è cambiato \
                 sotto» — ha seguito il testo"
            );
        }
        other => panic!("la query delle bozze ha risposto {other:?}"),
    }
}

#[test]
fn the_rejoin_says_with_the_rename_event() {
    // Chi tiene stato per-documento **fuori** dallo spazio dichiarato — il
    // versioning, che ha uno store suo perché deve sopravvivere alla
    // cancellazione — non ha altro modo di saperlo.
    let f = Fixture::new();
    f.write("a.txt", "il contenuto di a");
    drop(f.open());
    f.rename("a.txt", "b.txt");

    let mut ws = f.mounted();
    let rx = ws.bus().subscribe();
    ws.reindex().expect("reindex");
    let seen = events(&rx);
    assert!(
        seen.iter().any(|n| matches!(
            &n.event,
            Event::DocumentRenamed { from, to }
                if from.as_str() == "a.txt" && to.as_str() == "b.txt"
        )),
        "l'apertura ha annunciato la rinomina: {seen:?}"
    );
}

#[test]
fn a_notes_deleted_remains_a_deletion() {
    // Il verso opposto, e serve a mostrare che il ricongiungimento non ha
    // spento la raccolta: sparita senza che comparisse niente di uguale, i suoi
    // dati se ne vanno come prima.
    let f = Fixture::new();
    f.write("a.txt", "il contenuto di a");
    f.write("b.txt", "il contenuto di b");
    drop(f.open());
    f.attach_data("a.txt");
    std::fs::remove_file(f.root.join("a.txt")).unwrap();

    let _ws = f.open();
    assert!(
        f.data_of("a.txt").is_none(),
        "i dati di una nota che non c'è più si raccolgono"
    );
}

// --- 2. uno a uno, o niente ------------------------------------------------

#[test]
fn two_file_identical_without_nothing_of_vanished_are_a_copy() {
    let f = Fixture::new();
    f.write("a.txt", "identici");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("a.txt"), "il mio testo", None)
        .expect("bozza");
    drop(ws);

    // Nessuno è sparito: `a.txt` c'è ancora, e `copia.txt` è una copia.
    f.write("copia.txt", "identici");

    let ws = f.open();
    assert_eq!(
        draft_of(&ws, "a.txt").as_deref(),
        Some("il mio testo"),
        "la bozza è rimasta dov'era"
    );
    assert!(
        draft_of(&ws, "copia.txt").is_none(),
        "e non è stata consegnata alla copia"
    );
}

#[test]
fn a_file_empty_not_and_a_proof_of_identity() {
    // Due file vuoti hanno per forza la stessa impronta: la regola «uno a uno»
    // sarebbe soddisfatta e la conclusione falsa.
    let f = Fixture::new();
    f.write("vuota.txt", "");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("vuota.txt"), "quello che stavo scrivendo", None)
        .expect("bozza");
    drop(ws);

    std::fs::remove_file(f.root.join("vuota.txt")).unwrap();
    f.write("un'altra vuota.txt", "");

    let ws = f.open();
    assert!(
        draft_of(&ws, "un'altra vuota.txt").is_none(),
        "zero byte non accoppiano niente"
    );
    assert_eq!(
        draft_of(&ws, "vuota.txt").as_deref(),
        Some("quello che stavo scrivendo"),
        "e la bozza resta orfana, che è il caso che `vault.repair` sa mostrare — \
         non cancellata"
    );
}

// --- 3. nel dubbio non si accoppia e non si raccoglie -----------------------

#[test]
fn equal_contents_do_not_make_two_real_renames_ambiguous() {
    let f = Fixture::new();
    f.write("a.txt", "due note con lo stesso identico testo");
    f.write("b.txt", "due note con lo stesso identico testo");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("a.txt"), "la bozza di a", None)
        .expect("bozza");
    f.attach_data("a.txt");
    f.attach_data("b.txt");
    drop(ws);

    // Il digest è uguale, ma i due file hanno identità filesystem diverse e
    // ciascun rename conserva la propria: non serve indovinare dal contenuto.
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let ws = f.open();
    assert_eq!(
        draft_of(&ws, "c.txt").as_deref(),
        Some("la bozza di a"),
        "la bozza segue l'identità di a, non una scelta fra due digest uguali"
    );
    assert!(
        draft_of(&ws, "a.txt").is_none(),
        "il vecchio nome non resta vivo"
    );
    assert_eq!(f.data_of("c.txt").as_deref(), Some("i dati di a.txt"));
    assert_eq!(f.data_of("d.txt").as_deref(), Some("i dati di b.txt"));
    assert!(f.data_of("a.txt").is_none() && f.data_of("b.txt").is_none());
}

#[test]
fn repair_keeps_side_data_after_two_equal_content_files_are_renamed() {
    let f = Fixture::new();
    f.write("a.txt", "stesso testo");
    f.write("b.txt", "stesso testo");
    drop(f.open());
    f.attach_data("a.txt");
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let mut ws = f.mounted();
    ws.register_plugin(
        fub_abi::traits::PluginManifest::core(
            fub_kernel::maintenance::MAINTENANCE_ID,
            "Manutenzione",
        )
        .speaking("it", fub_kernel::maintenance::catalog()),
        fub_kernel::Trust::Core,
    )
    .expect("dichiarato");
    ws.register_command_provider(
        fub_kernel::maintenance::MAINTENANCE_ID,
        Box::new(fub_kernel::maintenance::Maintenance),
    )
    .expect("registrato");
    ws.reindex().expect("reindex");
    assert_eq!(
        f.data_of("c.txt").as_deref(),
        Some("i dati di a.txt"),
        "il rejoin forte ha già spostato i dati sulla vera destinazione"
    );
    ws.invoke_command(
        "vault.repair",
        serde_json::Value::Null,
        fub_abi::command::InvokeMode::Apply,
        fub_abi::Actor::User,
    )
    .expect("riparazione");
    assert_eq!(
        f.data_of("c.txt").as_deref(),
        Some("i dati di a.txt"),
        "la manutenzione non raccoglie dati ormai associati a una nota viva"
    );
}

#[test]
fn deindexing_interrupted_not_collects_nothing() {
    // Ci si arriva premendo «annulla» sulla prima indicizzazione di un vault
    // grande, o chiudendo l'app mentre gira: le note ci sono tutte, e l'anagrafe
    // non le ha ancora guardate. Chi raccogliesse lì cancellerebbe dal disco lo
    // spazio per-documento di note che esistono — e quello non lo rifà nessuno.
    let f = Fixture::new();
    f.write("a.txt", "una nota che esiste eccome");
    f.attach_data("a.txt");

    let mut ws = f.mounted();
    let work = ws.scan_vault().expect("scansione");
    // Nessuna fetta: si chiude subito, come farebbe la bandiera dell'annullamento.
    let opening = ws.finish_index(work);
    assert!(opening.interrupted, "l'apertura non è arrivata in fondo");
    assert_eq!(
        f.data_of("a.txt").as_deref(),
        Some("i dati di a.txt"),
        "da un'anagrafe parziale «sparito» e «non ancora guardato» sono la \
         stessa cosa, e una delle due mosse è irreversibile"
    );
}

#[test]
fn copy_then_delete_with_the_same_bytes_is_not_a_rename() {
    let f = Fixture::new();
    f.write("a.txt", "gli stessi byte");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza");
    ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    drop(ws);

    let bytes = std::fs::read(f.root.join("a.txt")).unwrap();
    std::fs::write(f.root.join("b.txt"), bytes).unwrap();
    std::fs::remove_file(f.root.join("a.txt")).unwrap();

    let ws = f.open();
    assert!(
        draft_of(&ws, "b.txt").is_none(),
        "una copia con gli stessi byte ha un'identità filesystem diversa: non eredita la bozza"
    );
    assert!(
        !ws.organization().icons.contains_key("b.txt"),
        "e non eredita lo stato per-documento della sorgente"
    );
}
