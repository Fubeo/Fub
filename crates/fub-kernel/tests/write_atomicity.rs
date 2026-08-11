//! `write_document` è atomico rispetto al parse: il parse è puro e viene
//! PRIMA della scrittura, così un sorgente che il provider rifiuta non lascia
//! il disco avanti rispetto a modelli/grafo/indici — né un file nuovo, né una
//! sovrascrittura, con il chiamante che riceve `Err` pur avendo scritto.

use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;
use fub_testkit::{Banco, Montato};

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

fn vault() -> Montato {
    Banco::nuovo()
        .con_formato(Box::new(FallibleProvider))
        .monta()
}

#[test]
fn a_failed_parse_writes_nothing_to_disk() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();

    let err = ws.write_document(&DocId::new("nuova.fal"), "BOOM", WriteBase::Dictated);
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
    let mut ws = vault();
    ws.write_document(
        &DocId::new("nota.fal"),
        "prima versione",
        WriteBase::Dictated,
    )
    .unwrap();

    assert!(ws
        .write_document(&DocId::new("nota.fal"), "seconda BOOM", WriteBase::Dictated)
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

/// **E una rinomina che fallisce non è successa.** Il parse stava *dopo* la
/// `rename`, quindi un sorgente che il provider rifiuta lasciava il disco col
/// nome nuovo e la memoria col vecchio: il chiamante riceveva `Err`, un secondo
/// tentativo rispondeva `NotFound` sul nome vecchio, e la nota spariva dalla
/// vista fino alla riapertura del vault.
///
/// Il sorgente si guasta **alle spalle del kernel** — è quel che fa un altro
/// programma mentre Fub guarda altrove — perché per il resto il kernel non
/// tiene in vault un testo che il suo provider rifiuta: lo prova il primo caso
/// di questo file.
#[test]
fn a_failed_rename_leaves_the_note_where_it_was() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();
    let from = DocId::new("nota.fal");
    let to = DocId::new("rinominata.fal");
    ws.write_document(&from, "prima versione", WriteBase::Dictated)
        .unwrap();

    ws.scrivi("nota.fal", "BOOM");

    assert!(
        ws.rename_document(&from, &to).is_err(),
        "il parse rifiutato deve arrivare al chiamante"
    );

    assert!(
        root.join("nota.fal").exists(),
        "un `Err` col file già spostato è la non-atomicità che questo fix chiude"
    );
    assert!(!root.join("rinominata.fal").exists());
    // E la memoria non è rimasta indietro rispetto a niente: il documento è
    // ancora quello di prima, e un secondo tentativo trova ancora il nome
    // vecchio invece di un `NotFound`.
    assert!(ws.documents().contains(&from));
    assert!(!ws.documents().contains(&to));
}
