//! L'anagrafe del vault (§14.1, §14.2), dal livello `Workspace`.
//!
//! Le proprietà sotto esame sono tre, e nessuna si vede da dentro un modulo:
//!
//! 1. **`reindex` non rilegge ciò che nessuno aspetta.** Il kernel chiede agli
//!    indici cosa hanno già ([`IndexProvider::up_to_date`]) *prima* di leggere e
//!    parsare: qui il provider di formato conta le proprie `parse`, che è il
//!    solo modo di dimostrare che la lettura è saltata e non solo l'indicizzazione.
//! 2. **Un file che non è un documento esiste.** Entra in anagrafe, si chiede a
//!    pagine da `IndexQuery::Entries`, e quando cambia lo annuncia con eventi
//!    che dicono *cosa è* — mai `DocumentChanged`.
//! 3. **La specie non è persistita.** Si ricalcola a ogni giro dai provider
//!    registrati, e un'estensione rivendicata dopo cambia la risposta senza che
//!    un byte del file sia cambiato.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EntryKind, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, Page, QueryRoute,
    VaultEntry,
};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, Fusione, MemStorage, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Subscription, Workspace};

/// Provider `.txt` che **conta quante volte gli è stato chiesto di parsare**.
///
/// Il contatore è la misura del §14.2: «un indice persistente riconosce e salta
/// gli immutati» era vero per l'indice e falso per il kernel, che pagava
/// comunque lettura e parse di tutto prima ancora di chiedere.
struct CountingProvider {
    parses: Arc<AtomicUsize>,
}

impl FormatProvider for CountingProvider {
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
        self.parses.fetch_add(1, Ordering::Relaxed);
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

/// Provider `.canvas` che non fa niente: esiste solo per **rivendicare
/// un'estensione**, che è ciò che decide la specie di un file.
struct CanvasProvider;

impl FormatProvider for CanvasProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("canvas", "Tela (test)", &["canvas"])
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

/// Un indice che si ricorda **le impronte dei sorgenti** e risponde di
/// conseguenza: la forma minima di ciò che fa la ricerca vera.
///
/// Non persiste niente: nel giro di un test la memoria basta, e ciò che deve
/// dimostrare è la *forma* della domanda, non la durevolezza della risposta —
/// quella la prova la ricerca, che il manifest ce l'ha davvero.
#[derive(Default)]
struct RememberingIndex {
    sources: std::collections::HashMap<DocId, String>,
    /// I documenti su cui il kernel ha chiesto conto, nell'ordine in cui li ha
    /// nominati: serve a mostrare che la domanda arriva **prima** del parse.
    asked: Arc<std::sync::Mutex<Vec<String>>>,
}

impl IndexProvider for RememberingIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        let mut asked = self.asked.lock().unwrap();
        let mut current = Vec::new();
        for entry in entries {
            asked.push(entry.id.to_string());
            let Some(revision) = entry.fingerprint.as_ref() else {
                continue;
            };
            if self.sources.get(&entry.id) == Some(&revision.0) {
                current.push(entry.id.clone());
            }
        }
        current
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        // L'impronta del sorgente qui è quella del testo, perché per questo
        // provider di prova sorgente e testo coincidono: la ricerca vera fa la
        // stessa cosa con un giro in più, perché fra i due c'è un parser.
        for doc in docs {
            self.sources.insert(
                doc.id.clone(),
                fub_abi::edit::Revision::of(&doc.text).0.clone(),
            );
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        for id in ids {
            self.sources.remove(id);
        }
        Vec::new()
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("niente".into()))
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    parses: Arc<AtomicUsize>,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture {
            _dir: dir,
            root,
            parses: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn registry(&self, canvas: bool) -> FormatRegistry {
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(CountingProvider {
                parses: self.parses.clone(),
            }))
            .expect("nessun conflitto");
        if canvas {
            registry
                .register(Box::new(CanvasProvider))
                .expect("nessun conflitto");
        }
        registry
    }

    /// Un workspace montato ma non ancora aperto, con gli indici di prova già
    /// dichiarati: un `IndexProvider` si registra sotto l'identità di un
    /// plugin, e senza la dichiarazione non avrebbe uno spazio dati suo.
    fn montato(&self, canvas: bool) -> Workspace {
        let mut ws =
            Workspace::new(&self.root, self.registry(canvas)).expect("l'apertura del vault riesce");
        for plugin in ["test.memoria", "test.muto"] {
            ws.register_core_feature(plugin, plugin)
                .expect("dichiarato");
        }
        ws
    }

    /// Apre il vault da zero, come farebbe un riavvio dell'app.
    fn open(&self, canvas: bool) -> Workspace {
        let mut ws = self.montato(canvas);
        ws.reindex().expect("reindex");
        ws
    }

    fn parses(&self) -> usize {
        self.parses.load(Ordering::Relaxed)
    }
}

/// La regola *racily clean* dice di non credere a una data che non è anteriore
/// al momento in cui la si è letta. In un test tutto succede nello stesso
/// millisecondo: senza questa pausa la scansione guarderebbe file appena
/// scritti, nessuna delle loro voci finirebbe in anagrafe, e il salto della
/// rilettura non si vedrebbe mai.
fn oltre_il_millisecondo() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

fn entries(ws: &Workspace, of_kind: Option<EntryKind>, page: Option<Page>) -> Vec<VaultEntry> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind,
            within: None,
            page,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    page.items
}

// --- il salto della rilettura ----------------------------------------------

#[test]
fn riaprire_un_vault_immutato_non_rilegge_niente() {
    let f = Fixture::new();
    for i in 0..5 {
        f.write(&format!("nota{i}.txt"), &format!("contenuto {i}"));
    }
    oltre_il_millisecondo();

    let mut prima = f.open(false);
    let index = RememberingIndex::default();
    let chieste = index.asked.clone();
    prima
        .register_index_provider("test.memoria", Box::new(index))
        .expect("registrazione");
    // La registrazione arriva a vault già aperto: il secondo `reindex` è quello
    // che alimenta l'indice, ed è anche il primo che gli chiede qualcosa.
    prima.reindex().expect("reindex");
    drop(prima);
    let dopo_il_primo_giro = f.parses();
    assert!(dopo_il_primo_giro >= 5, "il primo giro legge tutto");
    let nominati: std::collections::BTreeSet<_> = chieste.lock().unwrap().iter().cloned().collect();
    assert_eq!(
        nominati.len(),
        5,
        "la domanda nomina ogni documento, non solo quelli che l'indice conosce"
    );

    // Secondo avvio: stesso vault, stesso indice, ma l'indice adesso si ricorda
    // — e il kernel glielo chiede prima di aprire un file.
    let mut ws = f.montato(false);
    let mut index = RememberingIndex::default();
    for i in 0..5 {
        index.sources.insert(
            DocId::new(format!("nota{i}.txt")),
            fub_abi::edit::Revision::of(&format!("contenuto {i}")).0,
        );
    }
    ws.register_index_provider("test.memoria", Box::new(index))
        .expect("registrazione");
    let prima_del_secondo_giro = f.parses();
    ws.reindex().expect("reindex");
    assert_eq!(
        f.parses(),
        prima_del_secondo_giro,
        "nessun parse: l'anagrafe aveva i metadati e l'indice ha detto di avere tutto"
    );
    // E il vault è comunque quello di prima: saltare la lettura non vuol dire
    // dimenticare.
    assert_eq!(ws.documents().len(), 5);
    let outline = ws
        .query_index(IndexQuery::Outline {
            doc: DocId::new("nota0.txt"),
        })
        .expect("l'outline arriva dalla cache ricostruita");
    assert!(matches!(outline, IndexResult::Outline(_)));
}

#[test]
fn si_rilegge_solo_cio_che_e_cambiato() {
    let f = Fixture::new();
    for i in 0..5 {
        f.write(&format!("nota{i}.txt"), &format!("contenuto {i}"));
    }
    oltre_il_millisecondo();

    let mut prima = f.open(false);
    let index = RememberingIndex::default();
    prima
        .register_index_provider("test.memoria", Box::new(index))
        .expect("registrazione");
    prima.reindex().expect("reindex");
    drop(prima);

    // Una nota cambia ad app chiusa. L'indice si ricorda di *tutte*, comprese
    // le impronte vecchie: è il caso vero, ed è il kernel a doverlo scoprire
    // dal disco.
    oltre_il_millisecondo();
    f.write("nota2.txt", "contenuto cambiato");

    let mut ws = f.montato(false);
    let mut index = RememberingIndex::default();
    for i in 0..5 {
        index.sources.insert(
            DocId::new(format!("nota{i}.txt")),
            fub_abi::edit::Revision::of(&format!("contenuto {i}")).0,
        );
    }
    ws.register_index_provider("test.memoria", Box::new(index))
        .expect("registrazione");
    let prima_del_giro = f.parses();
    ws.reindex().expect("reindex");
    assert_eq!(
        f.parses() - prima_del_giro,
        1,
        "una sola: quella con la data e la dimensione diverse"
    );
}

#[test]
fn un_indice_che_non_dice_niente_riceve_tutto() {
    // Il default della firma è la lista vuota, e vuol dire «mandami tutto»: chi
    // non implementa `up_to_date` deve continuare a funzionare come prima, o la
    // voce sarebbe una rottura travestita da aggiunta.
    #[derive(Default)]
    struct MutoIndex;
    impl IndexProvider for MutoIndex {
        fn routes(&self) -> Vec<QueryRoute> {
            Vec::new()
        }
        fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn on_documents_indexed(&mut self, _docs: &[DocumentModel]) -> Vec<IndexLoss> {
            Vec::new()
        }
        fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
            Vec::new()
        }
        fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
            Vec::new()
        }
        fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
            Err(PluginError::Unserved("niente".into()))
        }
    }

    let f = Fixture::new();
    for i in 0..3 {
        f.write(&format!("nota{i}.txt"), &format!("contenuto {i}"));
    }
    oltre_il_millisecondo();
    drop(f.open(false));

    let mut ws = f.montato(false);
    ws.register_index_provider("test.muto", Box::new(MutoIndex))
        .expect("registrazione");
    let prima = f.parses();
    ws.reindex().expect("reindex");
    assert_eq!(
        f.parses() - prima,
        3,
        "nessuna dichiarazione = nessun salto, che è il verso sicuro dello sbaglio"
    );
}

// --- l'anagrafe come risposta ----------------------------------------------

#[test]
fn il_vault_non_e_solo_documenti() {
    let f = Fixture::new();
    f.write("nota.txt", "una nota");
    // I byte non contano: la specie viene dal nome, e nessuno li apre.
    f.write("img/foto.png", "PNG!");
    f.write("archivio.dat", "dati");
    let ws = f.open(false);

    let tutte = entries(&ws, None, None);
    let visto: Vec<(String, EntryKind)> =
        tutte.iter().map(|e| (e.id.to_string(), e.kind)).collect();
    assert_eq!(
        visto,
        [
            ("archivio.dat".to_string(), EntryKind::Unknown),
            ("img/foto.png".to_string(), EntryKind::Asset),
            ("nota.txt".to_string(), EntryKind::Document),
        ],
        "in ordine di path, e il file che nessuno sa cosa sia c'è lo stesso"
    );

    // `list_documents` non cambia: l'anagrafe è una domanda in più, non una
    // risposta diversa alla domanda di prima.
    assert_eq!(ws.documents(), [DocId::new("nota.txt")]);

    // La dimensione e la data ci sono per tutti; l'impronta solo per chi è stato
    // letto — cioè per i documenti, che qualcuno ha dovuto parsare comunque.
    let png = tutte
        .iter()
        .find(|e| e.id.as_str() == "img/foto.png")
        .unwrap();
    assert_eq!(png.size, 4);
    assert!(png.mtime > 0, "la data c'è, e in millisecondi");
    assert!(
        png.fingerprint.is_none(),
        "nessuno legge i byte di un allegato per riempire una tabella"
    );
    let nota = tutte.iter().find(|e| e.id.as_str() == "nota.txt").unwrap();
    assert!(
        nota.fingerprint.is_some(),
        "l'impronta si calcola dove i byte sono già in mano"
    );
}

#[test]
fn l_anagrafe_si_filtra_per_specie_e_si_chiede_a_pagine() {
    let f = Fixture::new();
    for i in 0..7 {
        f.write(&format!("a{i}.png"), "x");
    }
    f.write("nota.txt", "una nota");
    let ws = f.open(false);

    let allegati = entries(&ws, Some(EntryKind::Asset), None);
    assert_eq!(allegati.len(), 7);
    assert!(allegati.iter().all(|e| e.kind == EntryKind::Asset));

    let IndexResult::Entries(pagina) = ws
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Asset),
            within: None,
            page: Some(Page::new(2, 3)),
        })
        .expect("query")
    else {
        panic!("attesa l'anagrafe");
    };
    let ids: Vec<String> = pagina.items.iter().map(|e| e.id.to_string()).collect();
    assert_eq!(
        ids,
        ["a2.png", "a3.png", "a4.png"],
        "la finestra taglia dopo il filtro"
    );
    assert_eq!(pagina.offset, 2);
    assert_eq!(
        pagina.total, 7,
        "il totale è quello del filtro, non quello della pagina: è ciò che permette di scrivere «3-5 di 7»"
    );

    // Oltre la fine: pagina vuota, non un errore.
    let IndexResult::Entries(fuori) = ws
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Asset),
            within: None,
            page: Some(Page::new(99, 3)),
        })
        .expect("query")
    else {
        panic!("attesa l'anagrafe");
    };
    assert!(fuori.items.is_empty());
    assert_eq!(fuori.total, 7);
}

#[test]
fn la_specie_dipende_da_chi_e_registrato_adesso() {
    let f = Fixture::new();
    f.write("tela.canvas", "{}");
    oltre_il_millisecondo();

    let senza = f.open(false);
    assert_eq!(
        entries(&senza, None, None)[0].kind,
        EntryKind::Unknown,
        "nessuno rivendica `.canvas`: il vault lo vede e non sa cosa sia"
    );
    drop(senza);

    // Stesso file, stessi byte, stessa anagrafe su disco — e un provider in più.
    let con = f.open(true);
    assert_eq!(
        entries(&con, None, None)[0].kind,
        EntryKind::Document,
        "la specie si ricalcola: persistirla direbbe la cosa sbagliata per sempre"
    );
    assert_eq!(con.documents(), [DocId::new("tela.canvas")]);
}

// --- gli eventi di ciò che non è un documento ------------------------------

/// Gli avvisi arrivati sul bus da quando ci si è iscritti.
fn eventi(rx: &Subscription) -> Vec<Notice> {
    let mut visti = Vec::new();
    while let Ok(n) = rx.try_recv() {
        visti.push(n);
    }
    visti
}

#[test]
fn un_allegato_che_compare_e_cambia_lo_annuncia_dicendo_cosa_e() {
    let f = Fixture::new();
    f.write("nota.txt", "una nota");
    let mut ws = f.open(false);
    let rx = ws.bus().subscribe();

    // Un PNG copiato nel vault a Fub aperto. Prima di questa voce il ramo
    // «nessun provider per questa estensione» era un `Ok(false)` muto: il file
    // spariva dalla vista del kernel fino alla riapertura.
    f.write("img/foto.png", "\u{89}PNG");
    let abs = f.root.join("img/foto.png");
    assert!(ws.sync_path(&abs).expect("sync"), "qualcosa è cambiato");
    let visti = eventi(&rx);
    assert!(
        visti.iter().any(|n| matches!(
            &n.event,
            Event::EntryChanged { id, kind }
                if id.as_str() == "img/foto.png" && *kind == EntryKind::Asset
        )),
        "un allegato che compare è un `EntryChanged`, non un `DocumentChanged`: gli \
         handler dei documenti sono codice scritto quando un documento era l'unica \
         cosa che il vault contenesse"
    );
    assert!(
        !visti
            .iter()
            .any(|n| matches!(&n.event, Event::DocumentChanged { .. })),
        "e nessuna bugia retroattiva"
    );
    assert_eq!(entries(&ws, Some(EntryKind::Asset), None).len(), 1);

    // Lo stesso fatto riferito due volte non è due fatti.
    assert!(!ws.sync_path(&abs).expect("sync"), "niente è cambiato");
    assert!(eventi(&rx).is_empty());

    // Cancellato.
    std::fs::remove_file(&abs).unwrap();
    assert!(ws.sync_path(&abs).expect("sync"));
    assert!(
        eventi(&rx).iter().any(|n| matches!(
            &n.event,
            Event::EntryRemoved { id, kind }
                if id.as_str() == "img/foto.png" && *kind == EntryKind::Asset
        )),
        "e sparendo dice di che specie era"
    );
    assert!(entries(&ws, Some(EntryKind::Asset), None).is_empty());
}

#[test]
fn un_allegato_spostato_da_fuori_non_resta_in_anagrafe_col_nome_vecchio() {
    // Il buco che questa voce chiude: `sync_renamed_path` sapeva migrare
    // l'identità di un *documento*, e per tutto il resto guardava solo il path
    // d'arrivo. La voce vecchia restava in anagrafe fino alla riapertura del
    // vault, cioè il kernel dichiarava l'esistenza di un file che non c'era.
    let f = Fixture::new();
    f.write("foto.png", "\u{89}PNG");
    let mut ws = f.open(false);
    let rx = ws.bus().subscribe();

    let da = f.root.join("foto.png");
    let a = f.root.join("img/foto.png");
    std::fs::create_dir_all(a.parent().unwrap()).unwrap();
    std::fs::rename(&da, &a).unwrap();
    assert!(ws.sync_renamed_path(&da, &a).expect("sync"));

    let visti = eventi(&rx);
    assert!(
        visti.iter().any(|n| matches!(
            &n.event,
            Event::EntryRemoved { id, .. } if id.as_str() == "foto.png"
        )),
        "il vecchio path esce"
    );
    assert!(
        visti.iter().any(|n| matches!(
            &n.event,
            Event::EntryChanged { id, .. } if id.as_str() == "img/foto.png"
        )),
        "e il nuovo entra"
    );
    let ids: Vec<String> = entries(&ws, None, None)
        .iter()
        .map(|e| e.id.to_string())
        .collect();
    assert_eq!(ids, ["img/foto.png"], "una voce sola, quella vera");
}

// --- la data che può ancora cambiare ---------------------------------------

/// Un supporto che dà a **una** nota la data di un istante non ancora passato.
///
/// È il modo di rendere osservabile ciò che nella realtà dura un millisecondo:
/// il file che qualcuno sta riscrivendo proprio mentre la scansione lo guarda.
/// Cinque millisecondi avanti bastano perché la domanda «questa data è nel
/// passato?» abbia una risposta ferma nel momento in cui la si pone, e non
/// bastano a far passare per assurda una data che il filesystem potrebbe dare
/// davvero: due macchine con l'orologio non perfettamente allineato su un vault
/// condiviso fanno esattamente questo.
#[derive(Default)]
struct LaDataDiAdesso(MemStorage);

impl LaDataDiAdesso {
    const INSTABILE: &'static str = "appena-scritta.txt";

    fn adesso() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("dopo il 1970")
            .as_millis() as u64
    }
}

impl VaultStorage for LaDataDiAdesso {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        let mut stat = self.0.write(path, bytes)?;
        if path.as_str().ends_with(Self::INSTABILE) {
            stat.mtime = Self::adesso() + 5;
        }
        Ok(stat)
    }
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> std::io::Result<()> {
        self.0.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        let mut voci = self.0.list(dir)?;
        for voce in &mut voci {
            if voce.path.as_str().ends_with(Self::INSTABILE) {
                voce.stat.mtime = Self::adesso() + 5;
            }
        }
        Ok(voci)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        let mut stat = self.0.stat(path)?;
        if path.as_str().ends_with(Self::INSTABILE) {
            stat.mtime = Self::adesso() + 5;
        }
        Ok(stat)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(dir)
    }
}

/// **Una data che può ancora cambiare non finisce in anagrafe** (difetto 0187).
///
/// `mtime + size` riconosce l'immutato, e sbaglia in un verso solo che costa
/// caro: un file riscritto *dentro lo stesso millisecondo* in cui la scansione
/// l'ha guardato porta la stessa data e un contenuto diverso. La regola che git
/// chiama *racily clean* è la risposta, e la domanda va posta dove si osserva —
/// non dove si scrive la tabella, che viene dopo, a volte una sessione intera
/// dopo.
///
/// Qui la distanza fra i due momenti è esplicita e si vede: la nota instabile è
/// osservata alla scansione, e l'anagrafe si scrive alla **chiusura**, dieci
/// millisecondi più tardi. Con la soglia sulla scrittura quella data risultava
/// comodamente nel passato, la voce veniva creduta, e l'indice restava fermo sul
/// contenuto vecchio fino al primo evento che tornasse a toccare quel file.
#[test]
fn una_data_che_puo_ancora_cambiare_non_finisce_in_anagrafe() {
    let fixture = Fixture::new();
    let storage = Arc::new(LaDataDiAdesso::default());

    let apri = |storage: Arc<dyn VaultStorage>, canvas: bool| {
        let mut ws = Workspace::on(
            "/vault",
            fixture.registry(canvas),
            storage,
            MachineSettings::in_memory(),
        )
        .expect("l'apertura del vault riesce");
        ws.reindex().expect("reindex");
        ws
    };

    storage
        .write(Utf8Path::new("/vault/ferma.txt"), b"non cambio")
        .expect("scrive");
    storage
        .write(
            Utf8Path::new("/vault/appena-scritta.txt"),
            b"qualcuno mi sta ancora scrivendo",
        )
        .expect("scrive");
    // La nota ferma dev'essere ferma **davvero**: la sua data dev'essere nel
    // passato nel momento in cui la scansione la guarda, o non varrebbe come
    // metà di confronto.
    oltre_il_millisecondo();

    let mut ws = apri(storage.clone(), false);
    let alla_scansione = fixture.parses();
    assert_eq!(alla_scansione, 2, "la prima apertura legge tutte e due");

    // Fra l'osservazione e la scrittura dell'anagrafe passa del tempo: è
    // esattamente ciò che rendeva la vecchia soglia una risposta a un'altra
    // domanda.
    std::thread::sleep(std::time::Duration::from_millis(10));
    ws.close();
    drop(ws);

    let _ = apri(storage.clone() as Arc<dyn VaultStorage>, false);
    assert_eq!(
        fixture.parses() - alla_scansione,
        1,
        "la riapertura ha creduto a una data che quando l'abbiamo letta poteva \
         ancora cambiare: quel file resta indicizzato col contenuto di prima \
         finché non arriva un evento che lo tocchi, e se non arriva, per sempre"
    );
}
