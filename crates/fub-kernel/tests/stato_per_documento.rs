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

const SPENTO: &str = "plugin.spento";

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
fn scrivi_dato(root: &Utf8PathBuf, plugin: &str, rel: &str, contenuto: &[u8]) {
    let path = data_root(root).join("plugins").join(plugin).join(rel);
    std::fs::create_dir_all(path.parent().expect("ha un genitore")).expect("cartelle");
    std::fs::write(path, contenuto).expect("scrittura");
}

fn leggi_dato(root: &Utf8PathBuf, plugin: &str, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(data_root(root).join("plugins").join(plugin).join(rel)).ok()
}

fn nota(ws: &mut Workspace, id: &str, testo: &str) -> DocId {
    let doc = DocId::new(id);
    ws.write_document(&doc, testo, WriteBase::Dictated)
        .expect("scrittura");
    doc
}

#[test]
fn una_rinomina_porta_dietro_lo_stato_per_documento_anche_di_chi_e_spento() {
    let (_g, root, mut ws) = vault();
    let vecchia = nota(&mut ws, "Progetti/Ferrite.md", "corpo");

    let prima = doc_data::path(&vecchia, "annotazioni.json");
    scrivi_dato(&root, SPENTO, &prima, br#"{"nota":"x"}"#);
    // E qualcosa che il plugin tiene per sé, fuori da `doc/`: non deve muoversi.
    scrivi_dato(&root, SPENTO, "indice.json", b"suo");

    ws.rename_document(&vecchia, &DocId::new("Archivio/Ferrite.md"))
        .expect("rinomina");

    let dopo = doc_data::path(&DocId::new("Archivio/Ferrite.md"), "annotazioni.json");
    assert_eq!(
        leggi_dato(&root, SPENTO, &dopo).as_deref(),
        Some(&br#"{"nota":"x"}"#[..]),
        "lo stato per-documento non ha seguito la rinomina"
    );
    assert!(
        leggi_dato(&root, SPENTO, &prima).is_none(),
        "la chiave vecchia è rimasta viva accanto alla nuova"
    );
    assert_eq!(
        leggi_dato(&root, SPENTO, "indice.json").as_deref(),
        Some(&b"suo"[..]),
        "ciò che sta fuori da `doc/` è del plugin, e il kernel non lo tocca"
    );
    assert!(
        ws.doc_data_warnings().is_empty(),
        "una migrazione riuscita non ha niente da dire"
    );
}

#[test]
fn anche_il_ripristino_su_un_altro_path_e_una_rinomina() {
    // Il cestino restituisce una nota al vault; se il path d'origine è di nuovo
    // occupato, l'app ne sceglie un altro — e allora la chiave è cambiata. È il
    // caso che il §13.2 nominava come «rename a tutti gli effetti, anche se il
    // documento non era indicizzato».
    let (_g, root, mut ws) = vault();
    let originale = nota(&mut ws, "Nota.md", "prima");
    let rel = doc_data::path(&originale, "stato.bin");
    scrivi_dato(&root, SPENTO, &rel, b"conservami");

    let cestinata = ws.delete_document(&originale).expect("cestina");
    // Qualcun altro riprende il path.
    nota(&mut ws, "Nota.md", "un'altra");

    let tornata = ws
        .restore_from_trash(&cestinata, Some(DocId::new("Nota 1.md")))
        .expect("ripristino");
    assert_eq!(tornata, DocId::new("Nota 1.md"));

    assert_eq!(
        leggi_dato(&root, SPENTO, &doc_data::path(&tornata, "stato.bin")).as_deref(),
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
fn una_destinazione_che_non_e_una_cartella_non_si_toglie() {
    let (_g, root, mut ws) = vault();
    let vecchia = nota(&mut ws, "Vecchia.md", "corpo");
    let nuova = DocId::new("Nuova.md");

    let dato = doc_data::path(&vecchia, "annotazioni.json");
    scrivi_dato(&root, SPENTO, &dato, b"le mie annotazioni");

    // Un file dove la migrazione vorrebbe atterrare: non è lo spazio di
    // nessuna nota, ed è di qualcuno.
    let ostacolo = doc_data::space(&nuova);
    let ostacolo = ostacolo.trim_end_matches('/');
    scrivi_dato(&root, SPENTO, ostacolo, b"non e' mio");

    ws.rename_document(&vecchia, &nuova).expect("rinomina");

    let avvisi = ws.doc_data_warnings();
    assert!(
        avvisi.iter().any(|a| a.contains(ostacolo)),
        "una migrazione che non è potuta avvenire dice **cosa** l'ha fermata, \
         e dove andarlo a guardare: {avvisi:?}"
    );
    assert_eq!(
        leggi_dato(&root, SPENTO, &dato).as_deref(),
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
        leggi_dato(&root, SPENTO, ostacolo).as_deref(),
        Some(&b"non e' mio"[..]),
        "sulla destinazione c'era un file, di cui non si sa niente, e la \
         migrazione l'ha tolto"
    );
}

#[test]
fn la_raccolta_toglie_solo_cio_che_nessuna_nota_nomina_piu() {
    let (_g, root, mut ws) = vault();
    let viva = nota(&mut ws, "Viva.md", "ci sono");
    let cestinanda = nota(&mut ws, "Cestinata.md", "vado nel cestino");
    let morta = DocId::new("Sparita.md");

    let dato_vivo = doc_data::path(&viva, "x");
    let dato_cestinato = doc_data::path(&cestinanda, "x");
    let dato_morto = doc_data::path(&morta, "x");
    for rel in [&dato_vivo, &dato_cestinato, &dato_morto] {
        scrivi_dato(&root, SPENTO, rel, b"dato");
    }
    scrivi_dato(&root, SPENTO, "suo.json", b"mio");

    ws.delete_document(&cestinanda).expect("cestina");
    // La raccolta gira all'apertura, ed è così che si riapre.
    ws.reindex().expect("riapertura");

    assert!(
        leggi_dato(&root, SPENTO, &dato_vivo).is_some(),
        "la raccolta ha tolto i dati di una nota che esiste"
    );
    assert!(
        leggi_dato(&root, SPENTO, &dato_cestinato).is_some(),
        "una nota cestinata è recuperabile: ripristinarla senza i suoi dati \
         sarebbe una perdita silenziosa fatta da chi doveva impedirla"
    );
    assert!(
        leggi_dato(&root, SPENTO, &dato_morto).is_none(),
        "i dati di una nota che non esiste più sono rimasti a occupare spazio \
         sotto una chiave che nessuno visita"
    );
    assert_eq!(
        leggi_dato(&root, SPENTO, "suo.json").as_deref(),
        Some(&b"mio"[..]),
        "fuori da `doc/` la raccolta non entra"
    );
}

#[test]
fn svuotare_il_cestino_e_riaprire_raccoglie() {
    // Il seguito del test di sopra: finché la nota è recuperabile i dati
    // restano, e appena non lo è più se ne vanno. La cancellazione definitiva
    // **non** è quella che innesca la raccolta — è un giro sul disco a
    // vedersene accorto, ed è per questo che funziona anche se il cestino lo
    // svuota qualcun altro ad app chiusa.
    let (_g, root, mut ws) = vault();
    let doc = nota(&mut ws, "Effimera.md", "ciao");
    let rel = doc_data::path(&doc, "x");
    scrivi_dato(&root, SPENTO, &rel, b"dato");

    ws.delete_document(&doc).expect("cestina");
    ws.reindex().expect("riapertura col cestino pieno");
    assert!(leggi_dato(&root, SPENTO, &rel).is_some());

    ws.empty_trash().expect("svuota");
    ws.reindex().expect("riapertura col cestino vuoto");
    assert!(
        leggi_dato(&root, SPENTO, &rel).is_none(),
        "cancellata per sempre la nota, i suoi dati sono rimasti"
    );
}
