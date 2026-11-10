//! L'export dei disegni (`fub.draw`): che cosa esce, e che cosa non si tocca.
//!
//! Cinque domande, e un gruppo di prove per ciascuna.
//!
//! - **Che cosa esce.** Il PNG e il PDF di una scena si confrontano con le
//!   baseline in `tests/baselines/draw/`. Si rigenerano soltanto con
//!   `FUB_UPDATE_BASELINES=1`, mai da sole: una baseline che si riscrive quando
//!   il test fallisce non prova niente. Il PNG si confronta pixel per pixel con
//!   una tolleranza di 2 livelli su 255 per canale: `tiny-skia` calcola alcuni
//!   reciproci con istruzioni approssimate (`rcpps` su x86, `vrecpe` su ARM)
//!   che non danno lo stesso bit su processori diversi, e la suite di `resvg`
//!   stessa ammette 1 livello. Il PDF si confronta per struttura: gli stessi
//!   oggetti con gli stessi valori, i numeri a meno di un millesimo, i flussi
//!   decompressi; la tabella dei riferimenti incrociati e le lunghezze non
//!   contano, perché dipendono dal numero di cifre di un numero.
//! - **Le immagini del vault.** Entrano risolte dal disegno e lette una volta,
//!   finché ci stanno nel tetto; quelle che restano fuori, il log le nomina.
//! - **Che cosa non si tocca.** Un disegno ostile nomina la rete (un server in
//!   ascolto su `127.0.0.1`), file locali per `file:` e per path assoluto, un
//!   file oltre la radice del vault, un SVG del vault, un `@import`, un `<use>`
//!   esterno, un `feImage`, un SVG incorporato e un carattere di sistema.
//!   Nessuna di quelle risorse si apre, e l'export è uguale a quello del suo
//!   gemello pulito. Dove il sistema ha le FIFO, i file locali lo sono:
//!   aprirne una in lettura si blocca, quindi un export che finisce non ne ha
//!   aperta nessuna.
//! - **Lo stesso disegno, gli stessi byte.** Due export dello stesso disegno
//!   sono identici, anche con più caratteri nello stesso PDF.
//! - **Le opzioni.** Le tavole escono un file ciascuna, o una pagina ciascuna
//!   con il suo segnalibro nel PDF; la selezione esce nel suo riquadro; senza
//!   la carta il PNG è trasparente e il JPEG bianco; un'opzione sbagliata ferma
//!   l'export prima di aprire un file. L'SVG pulito si disegna come il
//!   derivato, a meno dei numeri arrotondati, e ripulirlo non lo cambia.

#![cfg(feature = "draw")]

use std::fs;
use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
use fub_abi::model::{Block, DocId, DocumentModel, Inline, Span};
use fub_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink, NoteLevel,
};
use fub_abi::PluginError;
use fub_features::{
    JpegExport, PdfExport, PngExport, SvgExport, DRAW_JPEG, DRAW_PDF, DRAW_PNG, DRAW_SVG,
};
use fub_sdk::testing::MemoryHost;

#[path = "draw_export/formats.rs"]
mod formats;
#[path = "draw_export/hostile.rs"]
mod hostile;
#[path = "draw_export/options.rs"]
mod options;
#[path = "draw_export/output.rs"]
mod output;
#[path = "draw_export/print_page.rs"]
mod print_page;
#[path = "draw_export/readers.rs"]
mod readers;
#[path = "draw_export/selection.rs"]
mod selection;
#[path = "draw_export/vault_images.rs"]
mod vault_images;

use formats::png_of_text;
use hostile::{base64, red_png};
use options::{artifacts, decode_jpeg, jpeg_segments, quaderno, refusal, Watched};
use readers::{
    baseline, content_of, decode, is_word, object, operators, red_pixels, reference, same_pdf,
    same_png, saved_before, states_at, tokens, Image, Token,
};
use vault_images::with_images;

// ---------------------------------------------------------------------------
// Il banco
// ---------------------------------------------------------------------------

/// Il formato dei disegni come lo dichiara `fub-format-svg`: qui conta solo
/// l'id, che è ciò che l'export guarda.
fn drawing_format() -> DocumentFormat {
    DocumentFormat {
        descriptor: FormatDescriptor::text("svg", "Drawing", &["svg"]),
        capabilities: FormatCapabilities::default(),
    }
}

fn host() -> MemoryHost {
    MemoryHost::new().with_format("svg", drawing_format())
}

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/draw")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn export(
    provider: &dyn ExportProvider,
    host: &MemoryHost,
    target: &str,
    docs: &[&str],
    options: serde_json::Value,
) -> Result<ExportReport, PluginError> {
    let request = ExportRequest::new(
        target,
        ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
    )
    .with_options(options);
    provider.export(&request, host, &mut MemorySink::default())
}

/// L'unico artefatto di un export di un disegno solo.
fn only_artifact(report: &ExportReport) -> (String, Vec<u8>) {
    assert_eq!(report.artifacts.len(), 1, "{:?}", report.log);
    let artifact = &report.artifacts[0];
    let bytes = artifact.as_bytes().expect("in memoria").to_vec();
    (artifact.path.clone(), bytes)
}

fn png_of(host: &MemoryHost, doc: &str) -> Vec<u8> {
    let report = export(&PngExport, host, DRAW_PNG, &[doc], serde_json::Value::Null).unwrap();
    only_artifact(&report).1
}

fn pdf_of(host: &MemoryHost, doc: &str) -> Vec<u8> {
    let report = export(&PdfExport, host, DRAW_PDF, &[doc], serde_json::Value::Null).unwrap();
    only_artifact(&report).1
}

fn jpeg_of(host: &MemoryHost, doc: &str, options: serde_json::Value) -> Vec<u8> {
    let report = export(&JpegExport, host, DRAW_JPEG, &[doc], options).unwrap();
    only_artifact(&report).1
}

fn svg_of(host: &MemoryHost, doc: &str, options: serde_json::Value) -> String {
    let report = export(&SvgExport, host, DRAW_SVG, &[doc], options).unwrap();
    String::from_utf8(only_artifact(&report).1).expect("UTF-8")
}

fn messages(report: &ExportReport) -> Vec<String> {
    report.log.iter().map(|note| note.message.clone()).collect()
}
