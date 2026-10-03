//! Le annotazioni di un PDF esportate in PDF: il PDF annotato e il PDF
//! redatto.
//!
//! Le annotazioni sono un documento del formato `fubann` che nomina il suo
//! PDF. Tutti e due gli export lo trovano come l'editor ([`pdf_of`]), ne
//! leggono le pagine come l'editor le mostra ([`sheets`]) e mettono su ogni
//! pagina annotata lo stesso disegno, con le note come note del PDF.
//!
//! - **Il PDF annotato** ([`AnnotatedPdfExport`]) è l'originale con le
//!   annotazioni in un aggiornamento in coda ([`write`]): tutto ciò che il PDF
//!   ha resta com'è, e una copertura nasconde il contenuto solo alla vista.
//! - **Il PDF redatto** ([`RedactedPdfExport`]) è un documento nuovo con le
//!   sole pagine ([`redact`]): una pagina con una copertura diventa
//!   un'immagine ([`raster`]), e ciò che la copertura nasconde non c'è più.
//!
//! # Lo stesso legame dell'editor
//!
//! Le annotazioni dicono di quale versione del PDF sono: l'impronta dei byte
//! e il numero di pagine nella radice. L'editor le confronta con il PDF che
//! apre, e qui si fa lo stesso confronto. Un PDF cambiato si annota lo
//! stesso, con un avviso nel log, perché le annotazioni restano dove sono
//! anche nell'editor; non si redige, perché una copertura che non sta più sul
//! testo da nascondere lo lascerebbe leggibile. Prima l'editor deve
//! confermare la versione.
//!
//! # Le pagine come le mostra l'editor
//!
//! Il disegno delle annotazioni passa dalle stesse opzioni di `usvg` dei
//! disegni ([`super::options`]): niente oltre al documento, e i caratteri di
//! Fub. Del PDF, l'export redatto disegna ciò che l'editor mostra, cioè ciò
//! che mostra pdf.js: i livelli con la loro configurazione e l'aspetto
//! scritto delle annotazioni del PDF.

use std::collections::BTreeSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::path::strip_ext;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::ReadApi;
use fub_abi::transfer::{
    artifact_key, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget,
    TransferNote,
};
use fub_format_svg::ANNOTATIONS_FORMAT_ID;
use fub_scene::Annotations;
use lopdf::{Document, LoadOptions, ObjectId};
use resvg::usvg::Tree;
use sha2::{Digest, Sha256};

use super::{
    check_target, external_note, glyphs_note, heading, lock, missing_glyphs, options, Refused,
    CHUNK,
};

mod copy;
mod geometry;
mod layers;
mod overlay;
mod page;
mod raster;
mod redact;
mod sheets;
mod write;

use geometry::Geometry;
use layers::Layers;
use overlay::unit_to_annotations;
use redact::{page_list, ranges, Redacted};
use sheets::{read_marks, Annotates, Reading, Sheets};
use write::{Annotated, NoteMark};

/// La destinazione del PDF annotato: l'originale con le annotazioni sopra.
pub const DRAW_ANNOTATED_PDF: &str = "draw.annotated-pdf";
/// La destinazione del PDF redatto: le pagine con le coperture diventano
/// immagini.
pub const DRAW_REDACTED_PDF: &str = "draw.redacted-pdf";

/// L'opzione del PDF redatto: i punti per pollice delle pagine redatte.
const DPI: &str = "dpi";
/// Di serie 200: il testo di una pagina redatta si legge bene anche
/// stampato, e un A4 resta sotto il mezzo megabyte.
const DPI_DEFAULT: f64 = 200.0;
const DPI_MIN: f64 = 72.0;
const DPI_MAX: f64 = 600.0;

/// L'opzione dei due export: la parola fra parentesi nel nome del file,
/// `Bando (annotato).pdf`. Chi chiede l'export la dà nella lingua di chi
/// legge; di serie è in inglese.
const SUFFIX: &str = "suffix";
const SUFFIX_MAX: usize = 40;
/// I caratteri che un nome di file non può avere su nessuno dei sistemi di
/// Fub.
const UNSAFE: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Quanto può decomprimersi un flusso di oggetti o di riferimenti mentre il
/// PDF si legge: oltre, è una bomba e non un PDF.
const STREAM_MAX: usize = 64 * 1024 * 1024;

const E_NONE_SELECTED: &str = "e_annotated_none_selected";
const E_DPI: &str = "e_annotated_dpi";
const E_SUFFIX: &str = "e_annotated_suffix";
const E_NO_PDF: &str = "e_annotated_no_pdf";
const E_PDF_MISSING: &str = "e_annotated_pdf_missing";
const E_PDF_LOCKED: &str = "e_annotated_pdf_locked";
const E_PDF_DAMAGED: &str = "e_annotated_pdf_damaged";
const E_TOO_LARGE: &str = "e_annotated_too_large";
const E_UNREADABLE: &str = "e_annotated_unreadable";
const E_CHANGED: &str = "e_annotated_changed";
const E_FAILED: &str = "e_annotated_failed";

/// Gli errori dei due export, in italiano.
pub(super) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(E_NONE_SELECTED, "Nella selezione non ci sono annotazioni di un PDF.")
        .with(
            E_DPI,
            "La risoluzione delle pagine redatte dev'essere fra 72 e 600 punti per pollice, non «{dpi}».",
        )
        .with(
            E_SUFFIX,
            "La parola fra parentesi nel nome del file dev'essere un testo di al massimo 40 caratteri, senza / \\ : * ? \" < > | né caratteri di controllo, non «{suffix}».",
        )
        .with(E_NO_PDF, "Le annotazioni «{doc}» non dicono quale PDF del vault annotano.")
        .with(E_PDF_MISSING, "Il PDF «{pdf}», annotato da «{doc}», non è nel vault.")
        .with(
            E_PDF_LOCKED,
            "Il PDF «{pdf}» è protetto da una password, e Fub non sa aprirlo.",
        )
        .with(E_PDF_DAMAGED, "Il PDF «{pdf}» non si legge ({reason}).")
        .with(
            E_TOO_LARGE,
            "Le annotazioni «{doc}» superano 20 MiB, e l'export non le legge.",
        )
        .with(E_UNREADABLE, "Le annotazioni «{doc}» non si leggono ({reason}).")
        .with(
            E_CHANGED,
            "Le annotazioni «{doc}» sono di un'altra versione di «{pdf}», e una copertura potrebbe non stare più su ciò che nasconde. Apri le annotazioni e conferma questa versione prima di esportare il PDF redatto.",
        )
        .with(
            E_FAILED,
            "Non ho esportato nessun PDF: «{doc}» non è riuscito ({reason}).",
        )
}

/// Gli errori dei due export, in inglese.
pub(super) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(E_NONE_SELECTED, "The selection contains no PDF annotations.")
        .with(
            E_DPI,
            "The resolution of redacted pages must be between 72 and 600 dots per inch, not «{dpi}».",
        )
        .with(
            E_SUFFIX,
            "The word in parentheses in the file name must be a text of at most 40 characters, without / \\ : * ? \" < > | or control characters, not «{suffix}».",
        )
        .with(E_NO_PDF, "The annotations «{doc}» do not say which PDF of the vault they annotate.")
        .with(E_PDF_MISSING, "The PDF «{pdf}», annotated by «{doc}», is not in the vault.")
        .with(
            E_PDF_LOCKED,
            "The PDF «{pdf}» is protected by a password, and Fub cannot open it.",
        )
        .with(E_PDF_DAMAGED, "The PDF «{pdf}» cannot be read ({reason}).")
        .with(
            E_TOO_LARGE,
            "The annotations «{doc}» are larger than 20 MiB, and the export cannot read them.",
        )
        .with(E_UNREADABLE, "The annotations «{doc}» cannot be read ({reason}).")
        .with(
            E_CHANGED,
            "The annotations «{doc}» belong to another version of «{pdf}», and a cover may no longer sit on what it hides. Open the annotations and confirm this version before exporting the redacted PDF.",
        )
        .with(E_FAILED, "No PDF was exported: «{doc}» failed ({reason}).")
}

/// L'export del PDF annotato: per ogni documento di annotazioni, il suo PDF
/// con le annotazioni sopra.
///
/// Il file comincia con i byte del PDF, identici, e le annotazioni sono un
/// aggiornamento in coda, in un livello che porta il nome delle annotazioni:
/// il disegno di ogni pagina e una nota del PDF per ogni nota. Le coperture
/// nascondono il contenuto solo alla vista: il testo sotto resta nel file, e
/// il log lo ricorda.
///
/// Opzione `suffix` (testo, di serie `annotated`): la parola fra parentesi
/// nel nome del file, `Bando (annotated).pdf`.
#[derive(Default)]
pub struct AnnotatedPdfExport;

/// L'export del PDF redatto: per ogni documento di annotazioni, un PDF nuovo
/// con le pagine del suo PDF, dove ciò che le coperture nascondono non c'è
/// più.
///
/// Una pagina con almeno una copertura diventa un'immagine, con le
/// annotazioni dentro; le altre si copiano con le annotazioni sopra. Del
/// documento restano solo le pagine, i livelli e la lingua: niente
/// segnalibri, allegati, script, moduli, struttura né metadati. Annotazioni
/// di un'altra versione del PDF non si redigono.
///
/// Opzioni: `dpi` (numero, di serie 200, da 72 a 600), la risoluzione delle
/// pagine redatte, e `suffix` (testo, di serie `redacted`), la parola fra
/// parentesi nel nome del file.
#[derive(Default)]
pub struct RedactedPdfExport;

impl ExportProvider for AnnotatedPdfExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_ANNOTATED_PDF.to_string(),
            name: "Annotated PDF (the original with the annotations on top)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_ANNOTATED_PDF)?;
        let suffix = suffix(&request.options, "annotated")?;
        export_annotations(request, host, out, Mode::Annotated, &suffix)
    }
}

impl ExportProvider for RedactedPdfExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_REDACTED_PDF.to_string(),
            name: "Redacted PDF (covered content removed from the pages)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_REDACTED_PDF)?;
        let dpi = dpi(&request.options)?;
        let suffix = suffix(&request.options, "redacted")?;
        export_annotations(request, host, out, Mode::Redacted { dpi }, &suffix)
    }
}

/// I punti per pollice dalle opzioni: assente è il valore di serie, qualunque
/// altra cosa che non sia un numero fra 72 e 600 è un errore, prima di
/// leggere un solo documento.
fn dpi(options: &serde_json::Value) -> Result<f64, PluginError> {
    let Some(value) = options.get(DPI).filter(|value| !value.is_null()) else {
        return Ok(DPI_DEFAULT);
    };
    match value.as_f64() {
        Some(dpi) if (DPI_MIN..=DPI_MAX).contains(&dpi) => Ok(dpi),
        _ => Err(PluginError::BadArgs(Text::message(
            E_DPI,
            vec![Arg::text(DPI, value.to_string())],
        ))),
    }
}

/// La parola fra parentesi nel nome del file, senza gli spazi ai bordi.
fn suffix(options: &serde_json::Value, default: &str) -> Result<String, PluginError> {
    let Some(value) = options.get(SUFFIX).filter(|value| !value.is_null()) else {
        return Ok(default.to_string());
    };
    match value.as_str().map(str::trim) {
        Some(word)
            if !word.is_empty()
                && word.chars().count() <= SUFFIX_MAX
                && !word.chars().any(|c| c.is_control() || UNSAFE.contains(&c)) =>
        {
            Ok(word.to_string())
        }
        _ => Err(PluginError::BadArgs(Text::message(
            E_SUFFIX,
            vec![Arg::text(
                SUFFIX,
                value
                    .as_str()
                    .map_or_else(|| value.to_string(), str::to_string),
            )],
        ))),
    }
}

/// Quale dei due PDF.
#[derive(Clone, Copy)]
enum Mode {
    Annotated,
    Redacted { dpi: f64 },
}

/// Perché un documento non è uscito: il motivo per il log, in inglese come
/// le altre note, e l'errore nella lingua di chi legge, per quando nessun
/// documento esce.
struct Failure {
    reason: String,
    error: Text,
}

impl Failure {
    fn new(reason: impl Into<String>, key: &str, args: Vec<Arg>) -> Failure {
        Failure {
            reason: reason.into(),
            error: Text::message(key, args),
        }
    }

    /// Un guasto senza un errore suo: il motivo va nell'errore generico.
    fn other(doc: &DocId, reason: impl Into<String>) -> Failure {
        let reason = reason.into();
        Failure {
            error: Text::message(
                E_FAILED,
                vec![
                    Arg::text("doc", doc.to_string()),
                    Arg::text("reason", reason.clone()),
                ],
            ),
            reason,
        }
    }
}

/// Il percorso comune ai due PDF: la selezione ridotta alle annotazioni, un
/// nome per ciascuna, la lettura e la scrittura, il log.
fn export_annotations(
    request: &ExportRequest,
    host: &dyn ReadApi,
    out: &mut dyn ArtifactSink,
    mode: Mode,
    suffix: &str,
) -> Result<ExportReport, PluginError> {
    let selected = request.selection.resolve(host)?;
    let (docs, others): (Vec<DocId>, Vec<DocId>) = selected
        .into_iter()
        .partition(|doc| is_annotations(host, doc));
    if docs.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NONE_SELECTED)));
    }
    let mut report = ExportReport::default();
    if !others.is_empty() {
        report.log.push(TransferNote::info(match others.len() {
            1 => "1 selected document is not a PDF's annotations and was skipped".to_string(),
            n => format!("{n} selected documents are not a PDF's annotations and were skipped"),
        }));
    }
    let mut first_failure: Option<Failure> = None;
    let mut exported = 0usize;
    for (doc, path) in docs.iter().zip(artifact_names(&docs, suffix)) {
        let mut notes = Vec::new();
        // Un PDF ostile non deve fermare gli altri documenti: un panico di
        // chi lo legge è il guasto di quel documento.
        let built = catch_unwind(AssertUnwindSafe(|| build(host, doc, mode, &mut notes)))
            .unwrap_or_else(|_| {
                Err(Failure::other(
                    doc,
                    "the PDF could not be processed because of an internal error",
                ))
            });
        match built {
            Ok(bytes) => {
                let handle = out.open_artifact(&path, "application/pdf")?;
                for piece in bytes.chunks(CHUNK) {
                    out.write_artifact(handle, piece)?;
                }
                report.artifacts.push(out.close_artifact(handle)?);
                report
                    .log
                    .extend(notes.into_iter().map(|note: Note| note.into_transfer(doc)));
                exported += 1;
            }
            Err(failure) => {
                report
                    .log
                    .push(TransferNote::warning(failure.reason.clone()).about(doc.to_string()));
                first_failure.get_or_insert(failure);
            }
        }
    }
    match first_failure {
        // Niente da consegnare: l'esito è un errore, ed è quello del primo
        // documento che non è riuscito.
        Some(failure) if exported == 0 => Err(PluginError::BadArgs(failure.error)),
        _ => Ok(report),
    }
}

/// Un documento è di annotazioni quando il suo formato è quello delle
/// annotazioni: lo dice il formato che il vault gli assegna, non l'estensione.
fn is_annotations(host: &dyn ReadApi, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == ANNOTATIONS_FORMAT_ID)
}

/// Il nome del PDF di ciascun documento di annotazioni: il path del
/// documento senza `.fubann` e senza `.pdf`, con la parola fra parentesi,
/// così `Gare/Bando.pdf.fubann` dà `Gare/Bando (annotated).pdf`. Ciò che
/// collide prende il numero della convenzione D3, con la chiave
/// [`artifact_key`] del sink, come per i disegni; i nomi si danno prima di
/// leggere.
fn artifact_names(docs: &[DocId], suffix: &str) -> Vec<String> {
    let mut taken = BTreeSet::new();
    docs.iter()
        .map(|doc| {
            let base = stem(doc);
            (0u32..)
                .map(|n| match n {
                    0 => format!("{base} ({suffix}).pdf"),
                    n => format!("{base} ({suffix}) {n}.pdf"),
                })
                .find(|name| taken.insert(artifact_key(name)))
                .expect("la sequenza dei candidati è infinita")
        })
        .collect()
}

/// Il path delle annotazioni senza l'estensione del formato e, se c'è, senza
/// quella del PDF: `Bando.pdf.fubann` → `Bando`. Un nome che resterebbe
/// vuoto tiene la sua.
fn stem(doc: &DocId) -> String {
    let base = strip_ext(doc.as_str());
    let cut = base.len().saturating_sub(".pdf".len());
    let name_starts = base.rfind('/').map_or(0, |slash| slash + 1);
    match base.get(cut..) {
        Some(tail) if tail.eq_ignore_ascii_case(".pdf") && cut > name_starts => {
            base[..cut].to_string()
        }
        _ => base,
    }
}

/// Il PDF che le annotazioni `doc` nominano, come l'editor lo trova: con
/// `fub:annotates` il percorso scritto, senza frammento, con il
/// percent-encoding sciolto, relativo alla cartella delle annotazioni o dalla
/// radice del vault se comincia con `/`; senza, `X.pdf.fubann` annota
/// `X.pdf` nella stessa cartella. `None` se non ne nominano uno, anche quando
/// il percorso sale oltre la radice.
fn pdf_of(doc: &DocId, annotates: &Annotates) -> Option<DocId> {
    let id = without_fragment(doc.as_str());
    let url = match annotates {
        Annotates::Other => return None,
        Annotates::Absent => {
            const NAMED: &str = ".pdf.fubann";
            let cut = id.len().checked_sub(NAMED.len())?;
            let tail = id.get(cut..)?;
            return tail
                .eq_ignore_ascii_case(NAMED)
                .then(|| DocId::new(&id[..id.len() - ".fubann".len()]));
        }
        Annotates::Vault(url) => url,
    };
    let path = decode_component(without_fragment(url))?;
    let mut parts: Vec<&str> = if path.starts_with('/') {
        Vec::new()
    } else {
        let mut folders: Vec<&str> = id.split('/').collect();
        folders.pop();
        folders
    };
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            segment => parts.push(segment),
        }
    }
    (!parts.is_empty()).then(|| DocId::new(parts.join("/")))
}

/// Il testo fino al primo `#` o `?`.
fn without_fragment(text: &str) -> &str {
    text.find(['#', '?']).map_or(text, |cut| &text[..cut])
}

/// Il percent-encoding sciolto come lo scioglie `decodeURIComponent`: ogni
/// `%` con due cifre esadecimali, e il risultato in UTF-8 valido; altrimenti
/// `None`.
fn decode_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = text.get(at + 1..at + 3)?;
            if !pair.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(pair, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Una nota per il log di un documento esportato.
struct Note {
    warning: bool,
    message: String,
}

impl Note {
    fn info(message: impl Into<String>) -> Note {
        Note {
            warning: false,
            message: message.into(),
        }
    }

    fn warning(message: impl Into<String>) -> Note {
        Note {
            warning: true,
            message: message.into(),
        }
    }

    fn into_transfer(self, doc: &DocId) -> TransferNote {
        let note = if self.warning {
            TransferNote::warning(self.message)
        } else {
            TransferNote::info(self.message)
        };
        note.about(doc.to_string())
    }
}

/// Il PDF delle annotazioni.
struct Source {
    pdf: DocId,
    bytes: Vec<u8>,
    document: Document,
    /// Vero se le annotazioni sono di un'altra versione del PDF.
    changed: bool,
}

/// Il PDF di un documento di annotazioni, scritto in memoria; `notes` riceve
/// il log, che vale soltanto se il PDF esce.
fn build(
    host: &dyn ReadApi,
    doc: &DocId,
    mode: Mode,
    notes: &mut Vec<Note>,
) -> Result<Vec<u8>, Failure> {
    let (text, annotations) = read_annotations(host, doc)?;
    let sheets = Sheets::read(&text, &annotations).map_err(|reason| unreadable(doc, reason))?;
    let source = read_pdf(host, doc, &annotations, &sheets)?;
    let mut pages = Pages::new(doc, &sheets);
    let bytes = match mode {
        Mode::Annotated => annotated(
            doc,
            source,
            &sheets,
            &mut pages,
            notes,
            &layer_name(host, doc),
        )?,
        Mode::Redacted { dpi } => redacted(doc, &source, &sheets, &mut pages, notes, dpi)?,
    };
    pages.notes(&sheets, notes);
    Ok(bytes)
}

fn unreadable(doc: &DocId, reason: impl Into<String>) -> Failure {
    let reason = reason.into();
    Failure::new(
        format!("the annotations cannot be read: {reason}"),
        E_UNREADABLE,
        vec![
            Arg::text("doc", doc.to_string()),
            Arg::text("reason", reason),
        ],
    )
}

/// Il testo delle annotazioni e ciò che il lettore del formato ne legge.
fn read_annotations(host: &dyn ReadApi, doc: &DocId) -> Result<(String, Annotations), Failure> {
    let bytes = host
        .read_document_bytes(doc)
        .map_err(|error| unreadable(doc, error.to_string()))?;
    let text =
        String::from_utf8(bytes).map_err(|_| unreadable(doc, "the file is not UTF-8 text"))?;
    let annotations =
        fub_scene::read_annotations(&text).map_err(|error| unreadable(doc, error.to_string()))?;
    if annotations.scene.truncated {
        return Err(Failure::new(
            "the annotations are larger than 20 MiB and cannot be exported",
            E_TOO_LARGE,
            vec![Arg::text("doc", doc.to_string())],
        ));
    }
    Ok((text, annotations))
}

/// Il PDF delle annotazioni, letto, e il confronto con la versione che le
/// annotazioni dicono.
fn read_pdf(
    host: &dyn ReadApi,
    doc: &DocId,
    annotations: &Annotations,
    sheets: &Sheets<'_>,
) -> Result<Source, Failure> {
    let Some(pdf) = pdf_of(doc, &sheets.annotates) else {
        return Err(Failure::new(
            "the annotations do not name a PDF of the vault",
            E_NO_PDF,
            vec![Arg::text("doc", doc.to_string())],
        ));
    };
    let pdf_args = || {
        vec![
            Arg::text("pdf", pdf.to_string()),
            Arg::text("doc", doc.to_string()),
        ]
    };
    let bytes = match host.read_document_bytes(&pdf) {
        Ok(bytes) => bytes,
        Err(PluginError::NotFound(_)) => {
            return Err(Failure::new(
                format!("the annotated PDF {pdf} is not in the vault"),
                E_PDF_MISSING,
                pdf_args(),
            ))
        }
        Err(error) => return Err(damaged(&pdf, doc, error.to_string())),
    };
    let options = LoadOptions::with_max_decompressed_size(STREAM_MAX);
    let document = Document::load_mem_with_options(&bytes, options)
        .map_err(|error| damaged(&pdf, doc, error.to_string()))?;
    // Un PDF che si apre senza password è già decifrato, e `/Encrypt` non c'è
    // più: se c'è ancora, la password serve.
    if document.trailer.has(b"Encrypt") {
        return Err(Failure::new(
            format!("the PDF {pdf} is protected by a password"),
            E_PDF_LOCKED,
            pdf_args(),
        ));
    }
    let count = document.get_pages().len();
    if count == 0 {
        return Err(damaged(&pdf, doc, "it has no pages".to_string()));
    }
    let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
    let changed = match &annotations.digest {
        Some(written) => *written != digest,
        None => annotations
            .page_count
            .is_some_and(|written| written as usize != count),
    };
    Ok(Source {
        pdf,
        bytes,
        document,
        changed,
    })
}

fn damaged(pdf: &DocId, doc: &DocId, reason: String) -> Failure {
    Failure::new(
        format!("the PDF {pdf} cannot be read: {reason}"),
        E_PDF_DAMAGED,
        vec![
            Arg::text("pdf", pdf.to_string()),
            Arg::text("doc", doc.to_string()),
            Arg::text("reason", reason),
        ],
    )
}

/// Il nome del livello delle annotazioni nel PDF annotato: il titolo delle
/// annotazioni, se ne hanno uno, altrimenti il nome del file.
fn layer_name(host: &dyn ReadApi, doc: &DocId) -> String {
    host.read_model(doc)
        .ok()
        .and_then(|model| heading(&model.body))
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| {
            let id = doc.as_str();
            id.rsplit('/').next().unwrap_or(id).to_string()
        })
}

/// Una pagina annotata pronta per il PDF.
struct Sheet {
    /// Il disegno, se la pagina ne ha uno.
    tree: Option<Tree>,
    reading: Reading,
    /// Le note che si vedono.
    notes: Vec<NoteMark>,
}

/// Ciò che si sa delle pagine annotate di un documento, per il log.
struct Pages {
    doc: DocId,
    /// Le pagine annotate oltre l'ultima del PDF.
    beyond: Vec<u32>,
    /// Il numero di pagine del PDF.
    count: usize,
    /// Le pagine con coperture.
    covered: Vec<u32>,
    /// Le pagine annotate su una pagina di un'altra misura.
    resized: Vec<u32>,
    /// I riferimenti esterni delle immagini, di tutte le pagine.
    external: BTreeSet<String>,
    /// Le pagine con immagini incorporate che non sono raster.
    embedded: Vec<u32>,
    /// I caratteri che i caratteri di Fub non hanno.
    missing: BTreeSet<char>,
    /// Le note che non si vedono.
    hidden: usize,
    /// Le pagine annotate, con o senza disegno.
    annotated: usize,
}

impl Pages {
    fn new(doc: &DocId, sheets: &Sheets<'_>) -> Pages {
        Pages {
            doc: doc.clone(),
            beyond: Vec::new(),
            count: 0,
            covered: Vec::new(),
            resized: Vec::new(),
            external: BTreeSet::new(),
            embedded: Vec::new(),
            missing: BTreeSet::new(),
            hidden: 0,
            annotated: sheets.numbers().len(),
        }
    }

    /// La pagina `number` delle annotazioni, misurata `size`.
    fn sheet(
        &mut self,
        sheets: &Sheets<'_>,
        number: u32,
        size: (f64, f64),
    ) -> Result<Sheet, Failure> {
        let refused = Arc::new(Mutex::new(Refused::default()));
        let broken = |error: resvg::usvg::Error| {
            unreadable(
                &self.doc,
                format!("page {number} could not be drawn: {error}"),
            )
        };
        let tree = Tree::from_str(&sheets.svg(number, size), &options(&refused)).map_err(broken)?;
        // La copia marcata si legge e non si disegna: ciò che il suo
        // risolutore rifiuta l'ha già contato quello del disegno.
        let scratch = Arc::new(Mutex::new(Refused::default()));
        let marked =
            Tree::from_str(&sheets.marked(number, size), &options(&scratch)).map_err(broken)?;
        let reading = read_marks(sheets, number, &marked);

        let refused = std::mem::take(&mut *lock(&refused));
        self.external.extend(refused.external);
        if refused.embedded > 0 {
            self.embedded.push(number);
        }
        self.missing.extend(missing_glyphs(&tree));
        if reading.covers > 0 {
            self.covered.push(number);
        }
        // La misura scritta ha due decimali.
        if sheets
            .written_size(number)
            .is_some_and(|[w, h]| (w - size.0).abs() > 0.01 || (h - size.1).abs() > 0.01)
        {
            self.resized.push(number);
        }
        let mut notes = Vec::new();
        for (note, rect) in sheets.notes(number).iter().zip(&reading.notes) {
            match rect {
                Some(rect) => notes.push(NoteMark {
                    rect: *rect,
                    body: note.body.clone(),
                    name: note.id.clone(),
                    icon: !note.drawn,
                }),
                None => self.hidden += 1,
            }
        }
        Ok(Sheet {
            tree: tree.root().has_children().then_some(tree),
            reading,
            notes,
        })
    }

    /// Le note comuni ai due PDF.
    fn notes(&self, sheets: &Sheets<'_>, notes: &mut Vec<Note>) {
        if !self.beyond.is_empty() {
            notes.push(Note::warning(format!(
                "the annotations of {} {} were not exported: the PDF has {} {}",
                pages_word(self.beyond.len()),
                ranges(&self.beyond),
                self.count,
                if self.count == 1 { "page" } else { "pages" },
            )));
        }
        if !self.resized.is_empty() {
            notes.push(Note::warning(format!(
                "the annotations of {} {} were made on a page of another size: they may not line up with it",
                pages_word(self.resized.len()),
                ranges(&self.resized),
            )));
        }
        if sheets.outside > 0 {
            notes.push(Note::warning(match sheets.outside {
                1 => "1 element outside the pages was not exported".to_string(),
                n => format!("{n} elements outside the pages were not exported"),
            }));
        }
        if self.hidden > 0 {
            notes.push(Note::info(match self.hidden {
                1 => "1 note is not visible on its page and was not exported".to_string(),
                n => format!("{n} notes are not visible on their pages and were not exported"),
            }));
        }
        if self.annotated == 0 {
            notes.push(Note::info("no page has annotations"));
        }
        if let Some(message) = external_note(&self.external, "the annotations") {
            notes.push(Note::warning(message));
        }
        if !self.embedded.is_empty() {
            notes.push(Note::warning(format!(
                "embedded images that are not PNG, JPEG, GIF or WebP were not exported ({} {})",
                pages_word(self.embedded.len()),
                ranges(&self.embedded),
            )));
        }
        if let Some(message) = glyphs_note(&self.missing) {
            notes.push(Note::warning(message));
        }
    }
}

fn pages_word(count: usize) -> &'static str {
    if count == 1 {
        "page"
    } else {
        "pages"
    }
}

/// Il PDF annotato.
fn annotated(
    doc: &DocId,
    source: Source,
    sheets: &Sheets<'_>,
    pages: &mut Pages,
    notes: &mut Vec<Note>,
    layer: &str,
) -> Result<Vec<u8>, Failure> {
    let Source {
        pdf,
        bytes,
        document,
        changed,
        ..
    } = source;
    if changed {
        notes.push(Note::warning(format!(
            "these annotations were made on another version of {pdf}: they may not line up with its pages"
        )));
    }
    let list = page_list(&document);
    pages.count = list.len();
    let mut annotated =
        Annotated::new(document, layer).map_err(|reason| damaged(&pdf, doc, reason))?;
    for number in sheets.numbers() {
        let Some(page) = page_at(&list, number) else {
            pages.beyond.push(number);
            continue;
        };
        let geometry = Geometry::of(&annotated.doc, page);
        let size = geometry.size();
        let sheet = pages.sheet(sheets, number, size)?;
        if let Some(tree) = &sheet.tree {
            let xobject = overlay::convert(tree, &mut annotated.doc)
                .map_err(|reason| Failure::other(doc, reason))?;
            annotated.draw(
                page,
                xobject,
                unit_to_annotations(size).then(geometry.page_space()),
            );
        }
        annotated.notes(page, &geometry, &sheet.notes);
    }
    let incremental = annotated.incremental();
    let out = annotated
        .finish(bytes)
        .map_err(|reason| Failure::other(doc, reason))?;
    if !incremental {
        notes.push(Note::info(
            "the PDF's cross-reference table is damaged, so the file was rewritten whole instead of updated",
        ));
    }
    if !pages.covered.is_empty() {
        notes.push(Note::warning(format!(
            "{} {} {} covers: in the annotated PDF the content under them is still there, and only the redacted PDF removes it",
            capitalized(pages_word(pages.covered.len())),
            ranges(&pages.covered),
            if pages.covered.len() == 1 { "has" } else { "have" },
        )));
    }
    Ok(out)
}

/// Il PDF redatto.
fn redacted(
    doc: &DocId,
    source: &Source,
    sheets: &Sheets<'_>,
    pages: &mut Pages,
    notes: &mut Vec<Note>,
    dpi: f64,
) -> Result<Vec<u8>, Failure> {
    let pdf = &source.pdf;
    if source.changed {
        return Err(Failure::new(
            format!(
                "these annotations were made on another version of {pdf}: confirm this version in the editor before redacting"
            ),
            E_CHANGED,
            vec![
                Arg::text("doc", doc.to_string()),
                Arg::text("pdf", pdf.to_string()),
            ],
        ));
    }
    let document = &source.document;
    let layers = Layers::of(document);
    let list = page_list(document);
    pages.count = list.len();
    let annotated: BTreeSet<u32> = sheets.numbers().into_iter().collect();
    pages.beyond = annotated
        .iter()
        .copied()
        .filter(|number| page_at(&list, *number).is_none())
        .collect();

    let mut redacted = Redacted::new(document, &layers, &list);
    let mut rasterized = Vec::new();
    let mut lowered = Vec::new();
    let mut incomplete = Vec::new();
    let mut uncovered = Vec::new();
    let failed = |reason: String| Failure::other(doc, reason);
    for (index, page) in list.iter().copied().enumerate() {
        let number = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let geometry = Geometry::of(document, page);
        if !annotated.contains(&number) {
            redacted
                .copy(index, page, &geometry, None, &[])
                .map_err(failed)?;
            continue;
        }
        let sheet = pages.sheet(sheets, number, geometry.size())?;
        if sheet.reading.covers > 0 {
            let rendered =
                raster::render(document, page, &geometry, &layers, sheet.tree.as_ref(), dpi)
                    .map_err(|reason| {
                        failed(format!("page {number} could not be redacted: {reason}"))
                    })?;
            redacted.tally.flattened += rendered.flattened;
            redacted.tally.unshown += rendered.unshown;
            rasterized.push(number);
            if rendered.dpi < dpi - 0.5 {
                lowered.push(number);
            }
            if rendered.incomplete {
                incomplete.push(number);
            }
            redacted.image(index, &geometry, rendered.image, &sheet.notes);
        } else {
            if sheet.reading.opaque > 0 {
                uncovered.push(number);
            }
            redacted
                .copy(index, page, &geometry, sheet.tree.as_ref(), &sheet.notes)
                .map_err(failed)?;
        }
    }
    let tally = std::mem::take(&mut redacted.tally);
    let out = redacted.finish().map_err(failed)?;

    if rasterized.is_empty() {
        notes.push(Note::warning(
            "no page has a cover, so no content was removed: the pages were copied with their annotations",
        ));
    } else {
        notes.push(Note::info(format!(
            "{} {} became {} at {} dpi: the content under the covers is gone, and the text there can no longer be selected or searched",
            capitalized(pages_word(rasterized.len())),
            ranges(&rasterized),
            if rasterized.len() == 1 { "an image" } else { "images" },
            dpi.round(),
        )));
    }
    if !lowered.is_empty() {
        notes.push(Note::warning(format!(
            "{} {} {} too large for {} dpi and became {} at a lower resolution",
            capitalized(pages_word(lowered.len())),
            ranges(&lowered),
            if lowered.len() == 1 { "is" } else { "are" },
            dpi.round(),
            if lowered.len() == 1 {
                "an image"
            } else {
                "images"
            },
        )));
    }
    if !incomplete.is_empty() {
        notes.push(Note::warning(format!(
            "on {} {} some text or images of the PDF could not be drawn",
            pages_word(incomplete.len()),
            ranges(&incomplete),
        )));
    }
    if !uncovered.is_empty() {
        notes.push(Note::warning(format!(
            "{} {} {} opaque marks that are not covers: they hide what is under them only on screen, and that content is still in the PDF",
            capitalized(pages_word(uncovered.len())),
            ranges(&uncovered),
            if uncovered.len() == 1 { "has" } else { "have" },
        )));
    }
    if tally.flattened > 0 {
        notes.push(Note::info(match tally.flattened {
            1 => "1 annotation of the PDF (a comment, a stamp or a form field) was drawn into its page".to_string(),
            n => format!("{n} annotations of the PDF (comments, stamps, form fields) were drawn into their pages"),
        }));
    }
    if tally.unshown > 0 {
        notes.push(Note::warning(match tally.unshown {
            1 => "1 annotation of the PDF has no appearance of its own and is missing".to_string(),
            n => format!(
                "{n} annotations of the PDF have no appearance of their own and are missing"
            ),
        }));
    }
    if tally.links > 0 {
        notes.push(Note::info(match tally.links {
            1 => "1 link that runs a script, opens a file or leads nowhere was removed".to_string(),
            n => format!("{n} links that run scripts, open files or lead nowhere were removed"),
        }));
    }
    notes.push(Note::info(
        "only the pages were kept: bookmarks, attachments, scripts, form data, the accessibility structure and the metadata of the PDF were left out",
    ));
    Ok(out)
}

/// La pagina numero `number`, da 1.
fn page_at(list: &[ObjectId], number: u32) -> Option<ObjectId> {
    let index = usize::try_from(number).ok()?.checked_sub(1)?;
    list.get(index).copied()
}

fn capitalized(word: &str) -> String {
    let mut chars = word.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(url: &str) -> Annotates {
        Annotates::Vault(url.to_string())
    }

    #[test]
    fn the_pdf_is_found_as_the_editor_finds_it() {
        let doc = DocId::new("Gare/2026/Bando.pdf.fubann");
        let found = |annotates: &Annotates| pdf_of(&doc, annotates).map(|id| id.to_string());
        assert_eq!(
            found(&Annotates::Absent).as_deref(),
            Some("Gare/2026/Bando.pdf")
        );
        assert_eq!(found(&Annotates::Other), None);
        assert_eq!(
            found(&vault("Bando%20di%20gara.pdf")).as_deref(),
            Some("Gare/2026/Bando di gara.pdf")
        );
        assert_eq!(
            found(&vault("../Altro.pdf#page=2")).as_deref(),
            Some("Gare/Altro.pdf")
        );
        assert_eq!(
            found(&vault("./a/./b.pdf?x=1")).as_deref(),
            Some("Gare/2026/a/b.pdf")
        );
        assert_eq!(found(&vault("/Radice.pdf")).as_deref(), Some("Radice.pdf"));
        assert_eq!(found(&vault("//Radice.pdf")).as_deref(), Some("Radice.pdf"));
        assert_eq!(found(&vault("../../../Fuori.pdf")), None);
        assert_eq!(found(&vault("/../Fuori.pdf")), None);
        assert_eq!(found(&vault("Rotto%2.pdf")), None);
        assert_eq!(found(&vault("Rotto%C3.pdf")), None);
        assert_eq!(
            found(&vault("%C3%A8.pdf")).as_deref(),
            Some("Gare/2026/è.pdf")
        );
        assert_eq!(found(&vault("..")).as_deref(), Some("Gare"));
        assert_eq!(found(&vault("#solo")), Some("Gare/2026".to_string()));

        let other = DocId::new("Note.fubann");
        assert_eq!(pdf_of(&other, &Annotates::Absent), None);
        let upper = DocId::new("BANDO.PDF.FUBANN");
        assert_eq!(
            pdf_of(&upper, &Annotates::Absent)
                .map(|id| id.to_string())
                .as_deref(),
            Some("BANDO.PDF")
        );
    }

    #[test]
    fn names_drop_the_extensions_and_count_collisions() {
        let docs = [
            DocId::new("Gare/Bando.pdf.fubann"),
            DocId::new("Gare/bando.PDF.fubann"),
            DocId::new("Note di Mario.fubann"),
            DocId::new("Archivio/.pdf.fubann"),
        ];
        assert_eq!(
            artifact_names(&docs, "annotato"),
            [
                "Gare/Bando (annotato).pdf",
                "Gare/bando (annotato) 1.pdf",
                "Note di Mario (annotato).pdf",
                "Archivio/.pdf (annotato).pdf",
            ]
        );
    }

    #[test]
    fn options_are_checked_before_reading() {
        let options = |json: &str| serde_json::from_str::<serde_json::Value>(json).unwrap();
        assert_eq!(dpi(&options("{}")).unwrap(), DPI_DEFAULT);
        assert_eq!(dpi(&options(r#"{"dpi": null}"#)).unwrap(), DPI_DEFAULT);
        assert_eq!(dpi(&options(r#"{"dpi": 300}"#)).unwrap(), 300.0);
        for bad in [r#"{"dpi": 71}"#, r#"{"dpi": 601}"#, r#"{"dpi": "300"}"#] {
            assert!(dpi(&options(bad)).is_err(), "{bad}");
        }
        assert_eq!(suffix(&options("{}"), "redacted").unwrap(), "redacted");
        assert_eq!(
            suffix(&options(r#"{"suffix": " redatto "}"#), "redacted").unwrap(),
            "redatto"
        );
        for bad in [
            r#"{"suffix": ""}"#,
            r#"{"suffix": "a/b"}"#,
            r#"{"suffix": "a\nb"}"#,
            r#"{"suffix": 3}"#,
            r#"{"suffix": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
        ] {
            assert!(suffix(&options(bad), "redacted").is_err(), "{bad}");
        }
    }
}
