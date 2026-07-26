//! `write_document` è atomico rispetto al parse: il parse è puro e viene
//! PRIMA della scrittura, così un sorgente che il provider rifiuta non lascia
//! il disco avanti rispetto a modelli/grafo/indici — né un file nuovo, né una
//! sovrascrittura, con il chiamante che riceve `Err` pur avendo scritto.

use camino::Utf8PathBuf;
use fubmd_abi::error::FormatError;
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Un provider che rifiuta i sorgenti contenenti `BOOM`: il markdown vero non
/// fallisce mai il parse, ma il contratto lo permette — e l'atomicità di
/// `write_document` deve valere per qualunque provider, non per il più docile.
struct FallibleProvider;

impl FormatProvider for FallibleProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("fallibile", "Formato fallibile (test)", &["fal"])
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

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(FallibleProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex vault vuoto");
    (dir, ws)
}

#[test]
fn a_failed_parse_writes_nothing_to_disk() {
    let (dir, mut ws) = vault();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

    let err = ws.write_document(&DocId::new("nuova.fal"), "BOOM");
    assert!(
        err.is_err(),
        "il parse rifiutato deve arrivare al chiamante"
    );

    assert!(
        !root.join("nuova.fal").exists(),
        "un `Err` con il file già scritto è la non-atomicità che il fix chiude"
    );
    assert!(!ws.documents().contains(&DocId::new("nuova.fal")));
}

#[test]
fn a_failed_overwrite_leaves_the_old_content_everywhere() {
    let (_dir, mut ws) = vault();
    ws.write_document(&DocId::new("nota.fal"), "prima versione")
        .unwrap();

    assert!(ws
        .write_document(&DocId::new("nota.fal"), "seconda BOOM")
        .is_err());

    // Disco e stato del workspace raccontano la stessa storia: quella
    // vecchia. Il render riparsa dal disco (split metadata/body), quindi
    // passa dallo stesso provider che ha rifiutato la scrittura.
    assert_eq!(
        ws.read_source(&DocId::new("nota.fal")).unwrap(),
        "prima versione"
    );
    assert_eq!(
        ws.render_preview(&DocId::new("nota.fal")).unwrap().html,
        "prima versione"
    );
}
