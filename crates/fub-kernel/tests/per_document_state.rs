//! **Lo stato per-documento di chi non è il kernel** (§13.2): chi lo migra al
//! rename, e chi lo raccoglie quando la nota non c'è più.
//!
//! Il banco guarda la cosa da dove si vede il difetto che la voce descrive: lo
//! spazio dati di un plugin **spento**. Un plugin acceso potrebbe migrarsi la
//! chiave da sé ascoltando `DocumentRenamed`, ed è ciò che il versioning e il
//! sidecar dell'organizzazione facevano; uno spento no, e nemmeno uno acceso
//! sente la rinomina fatta ad app chiusa. Se la migrazione funziona per chi non
//! è montato, funziona per tutti — e il contrario non è vero.
//!
//! La convenzione dei path è del contratto (`fub_abi::rules::doc_data`); qui
//! si prova la parte che richiede il disco e l'anagrafe del vault.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::FormatProvider;
use fub_kernel::{data_root, FormatRegistry, Workspace};

/// Un provider che non legge niente: qui i documenti servono a esistere, non a
/// dire qualcosa.
struct NudoProvider;

impl FormatProvider for NudoProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("nudo", "Testo nudo (test)", &["md"])
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

const OFF: &str = "plugin.spento";

fn vault() -> (tempfile::TempDir, Utf8PathBuf, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(NudoProvider))
        .expect("nessun conflitto");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex del vault vuoto");
    (dir, root, ws)
}

/// Scrive un blob nello spazio dati di un plugin **senza passare dal kernel**:
/// è il plugin spento, che non ha un host e non ne avrà uno.
fn write_data_item(root: &Utf8PathBuf, plugin: &str, rel: &str, content: &[u8]) {
    let path = data_root(root).join("plugins").join(plugin).join(rel);
    std::fs::create_dir_all(path.parent().expect("ha un genitore")).expect("cartelle");
    std::fs::write(path, content).expect("scrittura");
}

fn read_data_item(root: &Utf8PathBuf, plugin: &str, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(data_root(root).join("plugins").join(plugin).join(rel)).ok()
}

fn notes(ws: &mut Workspace, id: &str, text: &str) -> DocId {
    let doc = DocId::new(id);
    ws.write_document(&doc, text, WriteBase::Dictated)
        .expect("scrittura");
    doc
}

#[test]
fn a_rename_carries_behind_the_state_for_document_also_of_who_and_off() {
    let (_g, root, mut ws) = vault();
    let old = notes(&mut ws, "Progetti/Ferrite.md", "corpo");

    let before = doc_data::path(&old, "annotazioni.json");
    write_data_item(&root, OFF, &before, br#"{"notes":"x"}"#);
    // E qualcosa che il plugin tiene per sé, fuori da `doc/`: non deve muoversi.
    write_data_item(&root, OFF, "indice.json", b"suo");

    ws.rename_document(&old, &DocId::new("Archivio/Ferrite.md"))
        .expect("rinomina");

    let after = doc_data::path(&DocId::new("Archivio/Ferrite.md"), "annotazioni.json");
    assert_eq!(
        read_data_item(&root, OFF, &after).as_deref(),
        Some(&br#"{"notes":"x"}"#[..]),
        "lo stato per-documento non ha seguito la rinomina"
    );
    assert!(
        read_data_item(&root, OFF, &before).is_none(),
        "la chiave vecchia è rimasta viva accanto alla nuova"
    );
    assert_eq!(
        read_data_item(&root, OFF, "indice.json").as_deref(),
        Some(&b"suo"[..]),
        "ciò che sta fuori da `doc/` è del plugin, e il kernel non lo tocca"
    );
    assert!(
        ws.doc_data_warnings().is_empty(),
        "una migrazione riuscita non ha niente da dire"
    );
}

/// **Un allegato rinominato da fuori porta dietro il suo stato** (difetto
/// 0184).
///
/// La rinomina di un allegato fatta **da dentro** lo porta con sé da sempre, e
/// la stessa rinomina fatta dal Finder no: il rilevatore riconosceva l'identità
/// solo di chi ha un modello, e per tutto il resto diceva «sparita e
/// ricomparsa» — due voci d'anagrafe scollegate, con annotazioni, pin e
/// miniatura fermi sotto la chiave vecchia, dove non li cerca più nessuno e
/// dove la prima raccolta li spazza.
///
/// Il banco guarda dallo stesso posto degli altri di questo file — un plugin
/// **spento** —, che qui pesa il doppio: un plugin acceso può ascoltare
/// `EntryChanged`, ma non c'è nessun evento che dica «quell'immagine e questa
/// sono la stessa», quindi ricostruirlo da fuori non è nemmeno possibile.
#[test]
fn a_attachment_renamed_from_outside_carries_behind_the_state_for_document() {
    let (_g, root, mut ws) = vault();
    // Un allegato è un file che nessun provider rivendica: qui i `.md` li
    // parsa `NudoProvider`, i `.png` nessuno.
    std::fs::write(root.join("foto.png"), b"\x89PNG").expect("scrittura");
    ws.reindex().expect("reindex");

    let old = DocId::new("foto.png");
    let before = doc_data::path(&old, "miniatura.bin");
    write_data_item(&root, OFF, &before, b"anteprima");

    // La rinomina la fa qualcun altro: i byte sono già al nome nuovo quando il
    // rilevatore ce lo dice.
    std::fs::create_dir_all(root.join("img")).expect("cartelle");
    std::fs::rename(root.join("foto.png"), root.join("img/foto.png")).expect("rinomina");
    assert!(ws
        .sync_renamed_path(&root.join("foto.png"), &root.join("img/foto.png"))
        .expect("sync"));

    let after = doc_data::path(&DocId::new("img/foto.png"), "miniatura.bin");
    assert_eq!(
        read_data_item(&root, OFF, &after).as_deref(),
        Some(&b"anteprima"[..]),
        "lo stato dell'allegato non ha seguito la rinomina: resta sotto la \
         chiave vecchia, che nessuno cerca più e che la prima raccolta spazza"
    );
    assert!(
        read_data_item(&root, OFF, &before).is_none(),
        "la chiave vecchia è rimasta viva accanto alla nuova"
    );
}

/// L'altra metà, che impedisce alla riparazione di diventare «ogni coppia di
/// path si migra»: se a destinazione c'è già un allegato **vivo**, la mossa non
/// è una rinomina — `mv foto.png logo.png` sovrascrive un file che era di
/// qualcun altro — e il suo stato non si tocca. Il prezzo è dichiarato dov'è
/// dichiarato per i documenti: la storia di chi è partito si spezza.
#[test]
fn a_attachment_that_lands_on_a_live_not_of_it_takes_the_state() {
    let (_g, root, mut ws) = vault();
    std::fs::write(root.join("foto.png"), b"\x89PNG").expect("scrittura");
    std::fs::write(root.join("logo.png"), b"\x89PNGlogo").expect("scrittura");
    ws.reindex().expect("reindex");

    let source_data = doc_data::path(&DocId::new("foto.png"), "miniatura.bin");
    let arrival = doc_data::path(&DocId::new("logo.png"), "miniatura.bin");
    write_data_item(&root, OFF, &source_data, b"quella-di-foto");
    write_data_item(&root, OFF, &arrival, b"quella-di-logo");

    std::fs::rename(root.join("foto.png"), root.join("logo.png")).expect("rinomina");
    let _ = ws.sync_renamed_path(&root.join("foto.png"), &root.join("logo.png"));

    assert_eq!(
        read_data_item(&root, OFF, &arrival).as_deref(),
        Some(&b"quella-di-logo"[..]),
        "lo stato di un allegato vivo è stato coperto da quello di chi gli è \
         atterrato addosso"
    );
}

#[test]
fn also_the_restore_on_a_other_path_and_a_rename() {
    // Il cestino restituisce una nota al vault; se il path d'origine è di nuovo
    // occupato, l'app ne sceglie un altro — e allora la chiave è cambiata. È il
    // caso che il §13.2 nominava come «rename a tutti gli effetti, anche se il
    // documento non era indicizzato».
    let (_g, root, mut ws) = vault();
    let original = notes(&mut ws, "Nota.md", "prima");
    let rel = doc_data::path(&original, "stato.bin");
    write_data_item(&root, OFF, &rel, b"conservami");

    let trashed = ws.delete_document(&original).expect("cestina");
    // Qualcun altro riprende il path.
    notes(&mut ws, "Nota.md", "un'altra");

    let returned = ws
        .restore_from_trash(&trashed, Some(DocId::new("Nota 1.md")))
        .expect("ripristino");
    assert_eq!(returned, DocId::new("Nota 1.md"));

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "stato.bin")).as_deref(),
        Some(&b"conservami"[..]),
        "il ripristino su un altro path non ha portato dietro i dati"
    );
}

/// **Sulla destinazione si guarda cosa c'è, prima di togliere** (difetto 0167).
///
/// La migrazione sgombera la destinazione perché una cartella già lì è lo
/// spazio di una nota che non c'è più: il kernel rifiuta una rinomina verso un
/// documento che esiste, quindi quel residuo la raccolta l'avrebbe tolto al
/// prossimo giro comunque. Il ragionamento parla di **cartelle**, e di ciò che
/// cartella non è non dice niente — ma il codice toglieva lo stesso, senza
/// guardare e ingoiando l'esito.
///
/// Qui sulla destinazione c'è un file, che è il caso di un plugin che scrive
/// nel proprio spazio dati un nome che per caso è il componente codificato di
/// una nota: di quel file non si sa niente, e ciò di cui non si sa niente non
/// si tocca. È la stessa domanda che la raccolta pone già a ogni voce che
/// visita — «è una cartella, e il nome è il nostro `encode`?» — posta dal
/// fratello che stava senza.
///
/// E il banco guarda anche **dove sono rimasti i dati**: sgomberare prima di
/// spostare di lato è ciò che li tiene fuori da `.in-corso`, che è il posto
/// che la prossima raccolta spazza senza appello.
#[test]
fn a_destination_that_not_and_a_folder_not_is_removes() {
    let (_g, root, mut ws) = vault();
    let old = notes(&mut ws, "Vecchia.md", "corpo");
    let new = DocId::new("Nuova.md");

    let data_item = doc_data::path(&old, "annotazioni.json");
    write_data_item(&root, OFF, &data_item, b"le mie annotazioni");

    // Un file dove la migrazione vorrebbe atterrare: non è lo spazio di
    // nessuna nota, ed è di qualcuno.
    let obstacle = doc_data::space(&new);
    let obstacle = obstacle.trim_end_matches('/');
    let obstacle_path = data_root(&root).join("plugins").join(OFF).join(obstacle);
    write_data_item(&root, OFF, obstacle, b"non e' mio");

    ws.rename_document(&old, &new).expect("rinomina");

    let warnings = ws.doc_data_warnings();
    let obstacle_path = obstacle_path.as_str().replace('\\', "/");
    assert!(
        warnings
            .iter()
            .any(|warning| warning.replace('\\', "/").contains(&obstacle_path)),
        "una migrazione che non è potuta avvenire dice **cosa** l'ha fermata, \
         e dove andarlo a guardare: {warnings:?}"
    );
    assert_eq!(
        read_data_item(&root, OFF, &data_item).as_deref(),
        Some(&b"le mie annotazioni"[..]),
        "i dati sono finiti in `.in-corso`, che è il posto che la prossima \
         raccolta spazza: la migrazione fallita ne ha fatta una perdita in più"
    );
    // Questa riga non è una misura, ed è giusto dirlo: su un filesystem vero
    // `remove_dir_all` su un file fallisce da sé, quindi il file sopravvive
    // anche alla forma di prima. Sta qui per il supporto che non lo facesse —
    // un doppio in memoria, un supporto di rete — dove togliere senza guardare
    // vuol dire togliere davvero.
    assert_eq!(
        read_data_item(&root, OFF, obstacle).as_deref(),
        Some(&b"non e' mio"[..]),
        "sulla destinazione c'era un file, di cui non si sa niente, e la \
         migrazione l'ha tolto"
    );
}

#[test]
fn the_collection_removes_only_that_that_no_one_notes_names_more() {
    let (_g, root, mut ws) = vault();
    let live = notes(&mut ws, "Viva.md", "ci sono");
    let trashed_doc = notes(&mut ws, "Cestinata.md", "vado nel cestino");
    let dead = DocId::new("Sparita.md");

    let data_item_live = doc_data::path(&live, "x");
    let data_item_trashed = doc_data::path(&trashed_doc, "x");
    let data_item_dead = doc_data::path(&dead, "x");
    for rel in [&data_item_live, &data_item_trashed, &data_item_dead] {
        write_data_item(&root, OFF, rel, b"dato");
    }
    write_data_item(&root, OFF, "suo.json", b"mio");

    ws.delete_document(&trashed_doc).expect("cestina");
    // La raccolta gira all'apertura, ed è così che si riapre.
    ws.reindex().expect("riapertura");

    assert!(
        read_data_item(&root, OFF, &data_item_live).is_some(),
        "la raccolta ha tolto i dati di una nota che esiste"
    );
    assert!(
        read_data_item(&root, OFF, &data_item_trashed).is_some(),
        "una nota cestinata è recuperabile: ripristinarla senza i suoi dati \
         sarebbe una perdita silenziosa fatta da chi doveva impedirla"
    );
    assert!(
        read_data_item(&root, OFF, &data_item_dead).is_none(),
        "i dati di una nota che non esiste più sono rimasti a occupare spazio \
         sotto una chiave che nessuno visita"
    );
    assert_eq!(
        read_data_item(&root, OFF, "suo.json").as_deref(),
        Some(&b"mio"[..]),
        "fuori da `doc/` la raccolta non entra"
    );
}

#[test]
fn empty_the_trash_and_reopen_collects() {
    // Il seguito del test di sopra: finché la nota è recuperabile i dati
    // restano, e appena non lo è più se ne vanno. La cancellazione definitiva
    // **non** è quella che innesca la raccolta — è un giro sul disco a
    // vedersene accorto, ed è per questo che funziona anche se il cestino lo
    // svuota qualcun altro ad app chiusa.
    let (_g, root, mut ws) = vault();
    let doc = notes(&mut ws, "Effimera.md", "ciao");
    let rel = doc_data::path(&doc, "x");
    write_data_item(&root, OFF, &rel, b"dato");

    ws.delete_document(&doc).expect("cestina");
    ws.reindex().expect("riapertura col cestino pieno");
    assert!(read_data_item(&root, OFF, &rel).is_some());

    ws.empty_trash().expect("svuota");
    ws.reindex().expect("riapertura col cestino vuoto");
    assert!(
        read_data_item(&root, OFF, &rel).is_none(),
        "cancellata per sempre la nota, i suoi dati sono rimasti"
    );
}
