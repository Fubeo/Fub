//! Il tragitto di un documento che **non è testo**, dalla scansione all'indice.
//!
//! La [§21.8](../../../docs/project/roadmap.md) chiedeva «il
//! testo che sta dentro gli allegati», e nominava due blocchi che nel frattempo
//! erano caduti: `Vault::list_documents` (via con la
//! [0046](../../../docs/decisions/0188-identita-path-e-rename.md)) e
//! `parse(source: &str)` (via con la
//! [0017](../../../docs/decisions/0182-provider-e-porte-generiche.md),
//! che ha messo `DocumentSource::Bytes` nel contratto). Ciò che restava non era
//! né l'anagrafe né il parser: era il **tragitto**, e a essere scollegata era
//! l'indicizzazione — che leggeva testo comunque, senza guardare cosa il
//! provider avesse dichiarato.
//!
//! Questi test sono il cliente che percorre quel tragitto. Il provider di prova
//! non è un estrattore di PDF: è la sua **forma** — byte in, testo fuori — e
//! nessun crate di parsing entra nel workspace per averla

use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_kernel::Workspace;
use fub_testkit::{Bench, SampleExtractor};

/// Byte che **non sono UTF-8 valido** e che portano comunque del testo:
/// `«allegato»` in latin-1, dove le due virgolette basse stanno a 0xAB e 0xBB.
/// È la coppia di proprietà che serve al banco — il canale del testo li
/// rifiuta, il canale dei byte li porta a destinazione.
const ATTACHMENT: &[u8] = b"\xaballegato\xbb";

fn bench_with_extractor() -> fub_testkit::Mounted {
    Bench::new()
        .with_extension("md")
        .with_format(SampleExtractor::by_extension("pdf").boxed())
        .mounts()
}

/// **Il documento a byte entra nell'indice.**
///
/// Prima di questa voce finiva fra gli scarti dell'apertura, e non per una
/// decisione: `index_batch` chiamava `Vault::read`, che decodifica, e la
/// decodifica falliva. Un provider che aveva dichiarato di volere dei byte non
/// vedeva mai il proprio documento.
#[test]
fn a_byte_document_is_not_rejected() {
    let mut bench = bench_with_extractor();
    bench.write_byte("manuale.pdf", ATTACHMENT);
    bench.write("nota.md", "a normal note");

    let opening = bench.reindex().expect("scan succeeds");

    assert!(
        opening.whole(),
        "no rejects: the rejects are {:?}",
        opening.discarded
    );
}

/// **Il testo estratto è cercabile**, che è tutta la ragione per cui la §21.8
/// stava nella seduta della ricerca e non in quella del disco.
#[test]
fn the_extracted_text_arrives_in_the_index() {
    let mut bench = bench_with_extractor();
    bench.write_byte("manuale.pdf", ATTACHMENT);
    bench.reindex().expect("scan succeeds");

    let model = bench
        .read_model(&DocId::new("manuale.pdf"))
        .expect("the document parses");

    assert!(
        model.text.contains("allegato"),
        "the text extracted from bytes did not reach the model: {:?}",
        model.text
    );
}

/// **Lo stesso file non si riestrae se non è cambiato.**
///
/// L'impronta di un documento a byte si prende **sui byte** e non su una
/// decodifica, e resta la stessa famiglia di impronte di prima: un documento di
/// testo non cambia impronta il giorno che qualcuno lo rivendica a byte, e un
/// allegato che non cambia non rifà il giro (la regola di `up_to_date`, dalla
/// [0046](../../../docs/decisions/0188-identita-path-e-rename.md)).
#[test]
fn an_attachment_footprint_is_stable() {
    let mut bench = bench_with_extractor();
    bench.write_byte("manuale.pdf", ATTACHMENT);
    bench.reindex().expect("scan succeeds");

    let before = footprint(&bench, "manuale.pdf");
    assert!(
        before.is_some(),
        "the entry store did not take the footprint"
    );

    bench.reindex().expect("second scan succeeds");
    assert_eq!(
        before,
        footprint(&bench, "manuale.pdf"),
        "the footprint of an untouched file changed between two openings"
    );
}

/// **Il confine dei plugin sa dire i byte.**
///
/// È la sola parte di questa voce che è costata contratto, ed è quella senza cui
/// un estrattore di terzi resterebbe impossibile: `read_document` risponde ciò
/// che risponderebbe il vault — no, questo non è testo — e
/// `read_document_bytes` porta i byte com'erano.
#[test]
fn a_plugin_can_ask_for_bytes() {
    let mut bench = bench_with_extractor();
    bench.write_byte("manuale.pdf", ATTACHMENT);
    bench.reindex().expect("scan succeeds");
    bench
        .register_core_feature("test.extractor", "test.extractor")
        .expect("declared");

    let id = DocId::new("manuale.pdf");
    bench.with_read_host("test.extractor", |host| {
        assert_eq!(
            host.read_document_bytes(&id).expect("bytes read"),
            ATTACHMENT,
            "the bytes did not arrive intact at the boundary"
        );
        assert!(
            host.read_document(&id).is_err(),
            "the text channel accepted bytes that are not UTF-8"
        );
    });
}

fn footprint(ws: &Workspace, id: &str) -> Option<String> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("the kernel serves the entry store")
    else {
        panic!("expected entry store");
    };
    page.items
        .into_iter()
        .find(|and| and.id.as_str() == id)
        .and_then(|and| and.fingerprint)
        .map(|r| r.as_str().to_string())
}
