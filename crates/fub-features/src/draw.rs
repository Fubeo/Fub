//! I disegni nel vault (bundle `fub.draw`): il comando che ne fa nascere uno
//! e l'export in PNG e in PDF.
//!
//! Il comando «Nuovo disegno» è nel modulo [`create`]: un disegno nasce vuoto
//! dal provider del formato, con un nome libero, e si apre. Il comando «Annota
//! il PDF» è nel modulo [`annotate`]: apre le annotazioni di un PDF, il file
//! `.pdf.fubann` accanto, e le fa nascere dal provider `fubann` se non ci sono.
//!
//! L'export sono due [`ExportProvider`], uno per formato, che leggono il disegno nello stesso
//! modo: i byte del documento passano da `usvg`, che ne fa un albero, e da lì
//! `resvg` rasterizza il PNG e `svg2pdf` scrive il PDF vettoriale. Un disegno
//! è un documento del formato `svg`; gli altri documenti della selezione si
//! saltano, e il log dice quanti.
//!
//! Le annotazioni di un PDF hanno due export loro, nel modulo [`annotated`]:
//! il PDF annotato, cioè l'originale con le annotazioni sopra, e il PDF
//! redatto, dove ciò che le coperture nascondono non c'è più. Il disegno di
//! ogni pagina passa dalle stesse opzioni di `usvg` e dagli stessi caratteri
//! dei disegni, senza le immagini del vault, che l'editor delle annotazioni
//! non mostra.
//!
//! # Niente oltre al documento e alle sue immagini
//!
//! Un SVG può nominare altre risorse: un'immagine per path (`foto/mare.png`),
//! per URL o per `file:`, un `<use>` che punta a un altro file, un `@import` in
//! un `<style>`. L'export ne segue una specie sola, le immagini del vault, e
//! non per una regola che qualcuno deve ricordarsi di applicare: le opzioni di
//! `usvg` costruite da [`options`] non hanno un modo di seguire le altre.
//!
//! - Un'immagine **dentro** il documento si carica come `data:` URI di un
//!   formato raster (PNG, JPEG, GIF o WebP), riconosciuto dai byte e non dal
//!   tipo dichiarato. Un SVG incorporato come `data:` resta fuori: il
//!   risolutore accetta solo raster.
//! - Un'immagine **del vault** si carica dal vault ([`VaultImages`]): un
//!   `href` senza schema è un percorso, come per il client, che si risolve dal
//!   disegno come un collegamento, e i byte li dà l'host. Valgono le regole del
//!   `data:`, e un disegno porta al più 64 MiB di immagini del vault. Il
//!   confine è il vault: l'host non legge fuori, e un percorso che esce dalla
//!   radice non porta a niente.
//! - Ogni altro riferimento a un'immagine passa dal risolutore delle stringhe,
//!   che non apre niente e lo annota. Il log dell'export lo riporta, come ogni
//!   immagine del vault rimasta fuori.
//! - `resources_dir` è `None`. `usvg` non risolve `<use>` verso altri file e
//!   non segue `@import` né `@font-face`, e `roxmltree` non espande le entità
//!   esterne di una DTD.
//! - I caratteri sono soltanto quelli di Fub, incorporati nel binario
//!   ([`fonts`]): niente caratteri di sistema, quindi lo stesso disegno esce
//!   uguale su ogni macchina. Il database si costruisce soltanto da quei byte.
//!   `fontdb` saprebbe leggere anche dal disco, perché `svg2pdf` lo prende con
//!   le feature di serie e le feature di Cargo si sommano, ma nessuno glielo
//!   chiede: `resvg` è compilato senza `system-fonts`, e il database non passa
//!   mai da `load_system_fonts`.
//!
//! È la regola con cui la webview mostra un SVG dentro un `<img>`, dove la rete
//! e i file del computer non si caricano, con le immagini del vault in più: del
//! disegno fanno parte quanto quelle incorporate. E i caratteri, qui, sono
//! quelli veri.
//!
//! # Lo stesso disegno, gli stessi byte
//!
//! Due export dello stesso disegno producono gli stessi byte. Il PNG non porta
//! date. Il PDF le date non le ha nemmeno, ma `svg2pdf` scrive i caratteri e le
//! risorse nell'ordine di due `HashMap`, quindi con due caratteri in un disegno
//! la numerazione degli oggetti cambia da un export all'altro. Il modulo
//! [`pdf`] rilegge il pezzo prodotto da `svg2pdf`, ordina le chiavi dei
//! dizionari e rinumera gli oggetti nell'ordine in cui si raggiungono dalla
//! radice: lo stesso albero dà sempre lo stesso file.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, BufWriter, Write};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use fub_abi::error::PluginError;
use fub_abi::model::{Block, DocId, Inline, LinkTarget};
use fub_abi::rules::media::mime_of;
use fub_abi::rules::path::strip_ext;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{FolderScope, IndexQuery, IndexResult, ReadApi};
use fub_abi::transfer::{
    artifact_key, ArtifactHandle, ArtifactSink, ExportProvider, ExportReport, ExportRequest,
    ExportTarget, TransferNote,
};
use fub_format_svg::FORMAT_ID;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, fontdb, ImageHrefResolver, ImageKind, Node, Tree};

mod annotate;
mod annotated;
mod create;

pub use annotate::PDF_ANNOTATE;
pub use annotated::{AnnotatedPdfExport, RedactedPdfExport, DRAW_ANNOTATED_PDF, DRAW_REDACTED_PDF};
pub use create::{DrawCommands, DRAWING_CREATE};

/// Id del componente.
pub const DRAW_ID: &str = "fub.draw";
/// La destinazione PNG: un'immagine per disegno.
pub const DRAW_PNG: &str = "draw.png";
/// La destinazione PDF: un file vettoriale per disegno.
pub const DRAW_PDF: &str = "draw.pdf";

/// L'opzione del PNG: quanti pixel per pixel CSS del disegno.
const SCALE: &str = "scale";
/// Di serie 2, cioè la densità di uno schermo ad alta risoluzione: a 1 un
/// disegno incollato in un documento si vede sgranato.
const SCALE_DEFAULT: f32 = 2.0;
const SCALE_MAX: f32 = 8.0;
/// Il lato più lungo che un PNG può avere, in pixel.
const SIDE_MAX: f32 = 16_384.0;
/// Quanti pixel può avere un PNG: 32 milioni, cioè 128 MiB di pixmap.
const AREA_MAX: f32 = 33_554_432.0;
/// La densità di riferimento dei pixel CSS: 96 per pollice.
const CSS_DPI: f32 = 96.0;
/// I byte per scrittura verso il sink.
const CHUNK: usize = 64 * 1024;
/// Quanti riferimenti esterni il log elenca per disegno; gli altri li conta.
const LISTED: usize = 3;

const E_TARGET: &str = "e_target";
const E_NO_DRAWINGS: &str = "e_no_drawings";
const E_SCALE: &str = "e_scale";
const E_NONE_EXPORTED: &str = "e_none_exported";
const E_WRITE: &str = "e_write";

/// Le stringhe del componente: quelle del comando, e dell'export i soli
/// errori, perché le note del log sono testo semplice come quelle degli altri
/// export.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        annotated::in_italian(annotate::in_italian(create::in_italian(StringCatalog::new("it"))))
            .with(E_TARGET, "«{target}» non è una destinazione dei disegni.")
            .with(E_NO_DRAWINGS, "Nella selezione non c'è nessun disegno.")
            .with(
                E_SCALE,
                "La scala dell'immagine dev'essere un numero maggiore di 0 e al massimo 8, non «{scale}».",
            )
            .with(
                E_NONE_EXPORTED,
                "Non ho esportato nessun disegno: «{doc}» non è riuscito ({reason}).",
            )
            .with(E_WRITE, "Non ho scritto «{path}»: {reason}"),
        annotated::in_english(annotate::in_english(create::in_english(StringCatalog::new("en"))))
            .with(E_TARGET, "«{target}» is not a drawing export destination.")
            .with(E_NO_DRAWINGS, "The selection contains no drawings.")
            .with(
                E_SCALE,
                "The image scale must be a number above 0 and at most 8, not «{scale}».",
            )
            .with(
                E_NONE_EXPORTED,
                "No drawing was exported: «{doc}» failed ({reason}).",
            )
            .with(E_WRITE, "Could not write «{path}»: {reason}"),
    ]
}

/// I provider del bundle: uno per formato dei disegni, e i due PDF delle
/// annotazioni.
pub fn exports() -> Vec<Box<dyn ExportProvider>> {
    vec![
        Box::new(PngExport),
        Box::new(PdfExport),
        Box::new(AnnotatedPdfExport),
        Box::new(RedactedPdfExport),
    ]
}

/// L'export in PNG: un'immagine per disegno, con lo sfondo trasparente come
/// quello del disegno.
///
/// Opzione `scale` (numero, di serie 2, oltre 0 e al massimo 8): i pixel
/// dell'immagine per pixel CSS del disegno. L'immagine dichiara la densità
/// corrispondente (`pHYs`), quindi incollata in un documento ha la misura del
/// disegno e non quella dei suoi pixel. Un'immagine che supererebbe 16 384
/// pixel di lato o 32 milioni di pixel esce alla scala più grande che ci sta, e
/// il log lo dice.
#[derive(Default)]
pub struct PngExport;

/// L'export in PDF: un file vettoriale per disegno, una pagina della misura del
/// disegno (96 pixel CSS per pollice), con il testo selezionabile nei caratteri
/// di Fub incorporati.
#[derive(Default)]
pub struct PdfExport;

impl ExportProvider for PngExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_PNG.to_string(),
            name: "PNG (one image per drawing)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_PNG)?;
        let scale = png_scale(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            "png",
            &mut |drawing, path, out, report| write_png(drawing, scale, path, out, report),
        )
    }
}

impl ExportProvider for PdfExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_PDF.to_string(),
            name: "PDF (one vector file per drawing)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_PDF)?;
        export_drawings(request, host, out, "pdf", &mut write_pdf)
    }
}

fn check_target(request: &ExportRequest, target: &str) -> Result<(), PluginError> {
    if request.target == target {
        return Ok(());
    }
    Err(PluginError::BadArgs(Text::message(
        E_TARGET,
        vec![Arg::text("target", request.target.clone())],
    )))
}

/// La scala del PNG dalle opzioni della richiesta: assente è quella di serie,
/// qualunque altra cosa che non sia un numero in `(0, 8]` è un errore, prima di
/// leggere un solo disegno.
fn png_scale(options: &serde_json::Value) -> Result<f32, PluginError> {
    let Some(value) = options.get(SCALE).filter(|value| !value.is_null()) else {
        return Ok(SCALE_DEFAULT);
    };
    match value.as_f64() {
        Some(scale) if scale > 0.0 && scale <= f64::from(SCALE_MAX) => Ok(scale as f32),
        _ => Err(PluginError::BadArgs(Text::message(
            E_SCALE,
            vec![Arg::text(SCALE, value.to_string())],
        ))),
    }
}

/// Com'è andato un disegno. `Err` del chiamante resta per ciò che ferma
/// l'export intero, cioè un sink che non accetta più byte.
enum Outcome {
    Done,
    Failed(String),
}

/// Scrive un disegno nel formato del provider.
type Writer<'a> = dyn FnMut(&Drawing, &str, &mut dyn ArtifactSink, &mut ExportReport) -> Result<Outcome, PluginError>
    + 'a;

/// Il percorso comune ai due formati: la selezione ridotta ai disegni, un nome
/// per ciascuno, la lettura e la scrittura, il log.
fn export_drawings(
    request: &ExportRequest,
    host: &dyn ReadApi,
    out: &mut dyn ArtifactSink,
    extension: &str,
    write: &mut Writer<'_>,
) -> Result<ExportReport, PluginError> {
    let selected = request.selection.resolve(host)?;
    let (drawings, others): (Vec<DocId>, Vec<DocId>) =
        selected.into_iter().partition(|doc| is_drawing(host, doc));
    if drawings.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_DRAWINGS)));
    }
    let mut report = ExportReport::default();
    if !others.is_empty() {
        report.log.push(TransferNote::info(match others.len() {
            1 => "1 selected document is not a drawing and was skipped".to_string(),
            n => format!("{n} selected documents are not drawings and were skipped"),
        }));
    }
    let mut first_failure: Option<(DocId, String)> = None;
    let mut exported = 0usize;
    for (doc, path) in drawings.iter().zip(artifact_names(&drawings, extension)) {
        let outcome = match Drawing::load(host, doc) {
            Ok(drawing) => {
                let outcome = write(&drawing, &path, out, &mut report)?;
                if matches!(outcome, Outcome::Done) {
                    drawing.notes(&mut report);
                }
                outcome
            }
            Err(reason) => Outcome::Failed(reason),
        };
        match outcome {
            Outcome::Done => exported += 1,
            Outcome::Failed(reason) => {
                report
                    .log
                    .push(TransferNote::warning(reason.clone()).about(doc.to_string()));
                first_failure.get_or_insert((doc.clone(), reason));
            }
        }
    }
    match first_failure {
        // Niente da consegnare: l'esito è un errore, e il primo motivo è
        // quello che chi ha chiesto l'export vede.
        Some((doc, reason)) if exported == 0 => Err(PluginError::BadArgs(Text::message(
            E_NONE_EXPORTED,
            vec![
                Arg::text("doc", doc.to_string()),
                Arg::text("reason", reason),
            ],
        ))),
        _ => Ok(report),
    }
}

/// Un documento è un disegno quando il suo formato è quello dei disegni. Lo
/// dice il formato che il vault gli assegna, non l'estensione: un `.svg` resta
/// un allegato finché il formato `svg` non è montato, e allora non è un
/// disegno nemmeno qui.
fn is_drawing(host: &dyn ReadApi, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == FORMAT_ID)
}

/// Il nome dell'artefatto di ciascun disegno: il path del documento con
/// l'estensione del formato, così l'esito ripete le cartelle del vault. Ciò che
/// collide (`Mare.svg` e `mare.svg`, che in una cartella che non distingue le
/// maiuscole sono un file solo) prende il numero della convenzione D3
/// (`<nome> 1`), con la stessa chiave [`artifact_key`] con cui il sink
/// rifiuterebbe il secondo. I nomi si danno prima di leggere, quindi non
/// dipendono da quali disegni si lasciano leggere.
fn artifact_names(docs: &[DocId], extension: &str) -> Vec<String> {
    let mut taken = BTreeSet::new();
    docs.iter()
        .map(|doc| {
            let base = strip_ext(doc.as_str());
            (0u32..)
                .map(|n| match n {
                    0 => format!("{base}.{extension}"),
                    n => format!("{base} {n}.{extension}"),
                })
                .find(|name| taken.insert(artifact_key(name)))
                .expect("la sequenza dei candidati è infinita")
        })
        .collect()
}

/// Un disegno letto: l'albero di `usvg`, il titolo, e ciò che la lettura ha
/// lasciato fuori.
struct Drawing {
    doc: DocId,
    title: String,
    tree: Tree,
    refused: Refused,
}

impl Drawing {
    /// Legge un disegno dal vault. `Err` è il motivo, per il log: un disegno che
    /// non si legge non ferma gli altri.
    fn load(host: &dyn ReadApi, doc: &DocId) -> Result<Drawing, String> {
        let bytes = host
            .read_document_bytes(doc)
            .map_err(|error| error.to_string())?;
        let refused = Arc::new(Mutex::new(Refused::default()));
        let images = VaultImages::new(host, doc);
        let tree = Tree::from_data(&bytes, &options(&refused, Some(&images)))
            .map_err(|error| format!("not a readable SVG drawing: {error}"))?;
        let refused = std::mem::take(&mut *lock(&refused));
        Ok(Drawing {
            doc: doc.clone(),
            title: title(host, doc),
            tree,
            refused,
        })
    }

    /// Le note di un disegno esportato: ciò che è rimasto fuori e i caratteri
    /// che i caratteri di Fub non hanno.
    fn notes(&self, report: &mut ExportReport) {
        let refused = &self.refused;
        let embedded = (refused.embedded > 0).then(|| {
            let count = refused.embedded;
            format!(
                "{count} embedded {} and {} not exported",
                if count == 1 {
                    "image is not a readable PNG, JPEG, GIF or WebP image"
                } else {
                    "images are not readable PNG, JPEG, GIF or WebP images"
                },
                if count == 1 { "was" } else { "were" },
            )
        });
        let notes = std::iter::once(external_note(&refused.external, "the vault"))
            .chain(
                refused
                    .vault
                    .iter()
                    .map(|(why, images)| vault_note(*why, images)),
            )
            .chain([embedded, glyphs_note(&missing_glyphs(&self.tree))]);
        for message in notes.flatten() {
            report
                .log
                .push(TransferNote::warning(message).about(self.doc.to_string()));
        }
    }
}

/// Una nota su ciò che sta in `set`: quanti sono, detti con `one` o con
/// `many`, e i primi per nome.
fn listed(set: &BTreeSet<String>, one: &str, many: &str) -> Option<String> {
    if set.is_empty() {
        return None;
    }
    let count = set.len();
    let listed: Vec<&str> = set.iter().take(LISTED).map(String::as_str).collect();
    let rest = count.saturating_sub(LISTED);
    Some(format!(
        "{count} {}: {}{}",
        if count == 1 { one } else { many },
        listed.join(", "),
        if rest > 0 {
            format!(" and {rest} more")
        } else {
            String::new()
        },
    ))
}

/// La nota dei riferimenti esterni rimasti fuori, i primi per nome; `within`
/// è ciò da cui puntano fuori (`the vault`, `the annotations`).
fn external_note(external: &BTreeSet<String>, within: &str) -> Option<String> {
    listed(
        external,
        &format!("image reference points outside {within} and was not exported"),
        &format!("image references point outside {within} and were not exported"),
    )
}

/// La nota delle immagini del vault rimaste fuori per `why`, le prime per
/// nome.
fn vault_note(why: LeftOut, images: &BTreeSet<String>) -> Option<String> {
    let (one, many) = match why {
        LeftOut::Missing => (
            "image is not in the vault and was not exported".to_string(),
            "images are not in the vault and were not exported".to_string(),
        ),
        LeftOut::NotRaster => (
            "vault image is not a readable PNG, JPEG, GIF or WebP image and was not exported"
                .to_string(),
            "vault images are not readable PNG, JPEG, GIF or WebP images and were not exported"
                .to_string(),
        ),
        LeftOut::Unreadable => (
            "vault image could not be read and was not exported".to_string(),
            "vault images could not be read and were not exported".to_string(),
        ),
        LeftOut::OverBudget => (
            format!(
                "vault image did not fit in the {VAULT_IMAGES_MIB} MiB of images of a drawing and was not exported"
            ),
            format!(
                "vault images did not fit in the {VAULT_IMAGES_MIB} MiB of images of a drawing and were not exported"
            ),
        ),
    };
    listed(images, &one, &many)
}

/// La nota dei caratteri che i caratteri di Fub non hanno.
fn glyphs_note(missing: &BTreeSet<char>) -> Option<String> {
    if missing.is_empty() {
        return None;
    }
    let chars: String = missing.iter().collect();
    Some(format!(
        "characters outside Fub's fonts are drawn as a placeholder box: {chars}"
    ))
}

/// Il titolo del disegno, per i metadati del file: il titolo che il formato
/// legge dal documento (il primo heading di livello 1 del modello), altrimenti
/// il nome del file.
fn title(host: &dyn ReadApi, doc: &DocId) -> String {
    host.read_model(doc)
        .ok()
        .and_then(|model| heading(&model.body))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| doc.page_name().to_string())
}

fn heading(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::Heading {
            level: 1, inlines, ..
        } => Some(
            inlines
                .iter()
                .filter_map(|inline| match inline {
                    Inline::Text(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect(),
        ),
        Block::Custom { blocks, .. } => heading(blocks),
        _ => None,
    })
}

/// Ciò che il risolutore delle immagini ha lasciato fuori.
#[derive(Default)]
struct Refused {
    /// I riferimenti esterni, senza ripetizioni e in ordine: fuori dal vault
    /// per un disegno, fuori dal documento per le annotazioni.
    external: BTreeSet<String>,
    /// Le immagini incorporate che non sono raster leggibili.
    embedded: usize,
    /// Le immagini del vault rimaste fuori, per motivo.
    vault: BTreeMap<LeftOut, BTreeSet<String>>,
}

/// Quanto di un riferimento esterno finisce nel log.
const HREF_SHOWN: usize = 120;

fn lock(refused: &Mutex<Refused>) -> MutexGuard<'_, Refused> {
    // Un risolutore non va in panico mentre tiene il lucchetto: se succedesse,
    // il conto resterebbe comunque leggibile.
    refused
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Le opzioni di `usvg` per un documento. Sono il confine di questo modulo:
/// vedi la documentazione in testa al file. `vault` sono le immagini del vault
/// che il documento può nominare; senza, ogni riferimento resta fuori.
fn options<'a>(
    refused: &Arc<Mutex<Refused>>,
    vault: Option<&'a VaultImages<'a>>,
) -> usvg::Options<'a> {
    let embedded = Arc::clone(refused);
    let external = Arc::clone(refused);
    usvg::Options {
        resources_dir: None,
        font_family: SERIF.to_string(),
        image_href_resolver: ImageHrefResolver {
            resolve_data: Box::new(move |_, data, _| {
                let kind = raster(data);
                if kind.is_none() {
                    lock(&embedded).embedded += 1;
                }
                kind
            }),
            resolve_string: Box::new(move |href, _| {
                let shown: String = href.chars().take(HREF_SHOWN).collect();
                let (Some(vault), Some(path)) = (vault, vault_path(href)) else {
                    lock(&external).external.insert(shown);
                    return None;
                };
                match vault.image(&path) {
                    Ok(kind) => Some(kind),
                    Err(why) => {
                        lock(&external).vault.entry(why).or_default().insert(shown);
                        None
                    }
                }
            }),
        },
        fontdb: Arc::clone(fonts()),
        ..usvg::Options::default()
    }
}

/// Un'immagine, se è di un formato raster che `usvg` sa misurare. Il formato
/// lo dicono i primi byte, non il tipo che il `data:` o il nome del file
/// dichiarano; la misura la prende `imagesize`, come in `usvg`, che
/// un'immagine senza misura la scarta senza dirlo.
fn raster(data: Arc<Vec<u8>>) -> Option<ImageKind> {
    let bytes = data.as_slice();
    let kind: fn(Arc<Vec<u8>>) -> ImageKind = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ImageKind::PNG
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ImageKind::JPEG
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        ImageKind::GIF
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        ImageKind::WEBP
    } else {
        return None;
    };
    imagesize::blob_size(bytes)
        .is_ok_and(|size| size.width > 0 && size.height > 0)
        .then(|| kind(data))
}

/// Quanti MiB di immagini del vault porta al più un disegno: i byte restano in
/// memoria finché il disegno non è uscito.
const VAULT_IMAGES_MIB: usize = 64;
const VAULT_IMAGES_MAX: usize = VAULT_IMAGES_MIB * 1024 * 1024;

/// I tipi dei file che l'export legge come immagini del vault: i raster che
/// `resvg` e `svg2pdf` sanno disegnare.
const RASTER_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Il percorso del vault che un `href` d'immagine nomina, letto come lo legge
/// il client (`href` in `apps/client/src/editors/spatial/scene/values.ts`),
/// cioè come un URL: senza spazi e controlli ai due capi e senza tabulazioni e
/// a capo dentro. `None` per ciò che non è un percorso:
/// il valore vuoto, un frammento, `//host`, un URL col suo schema, `file:`
/// compreso.
fn vault_path(href: &str) -> Option<String> {
    let url: String = href
        .trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let slash = |c: Option<char>| matches!(c, Some('/' | '\\'));
    let mut start = url.chars();
    if url.is_empty() || url.starts_with('#') || (slash(start.next()) && slash(start.next())) {
        return None;
    }
    let scheme = url.split_once(':').is_some_and(|(name, _)| {
        let mut chars = name.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    });
    (!scheme).then_some(url)
}

/// Perché un'immagine del vault è rimasta fuori, nell'ordine delle note del
/// log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum LeftOut {
    /// Il percorso non porta a un file del vault.
    Missing,
    /// Il file non è un raster leggibile: un altro tipo, un SVG, byte rotti.
    NotRaster,
    /// L'host non ha risposto, o non ha dato i byte.
    Unreadable,
    /// Il file non ci stava più nel tetto del disegno.
    OverBudget,
}

/// Le immagini del vault di un disegno. Un percorso ([`vault_path`]) si risolve
/// dal disegno con la domanda dei collegamenti ([`IndexQuery::Resolve`]); il file deve avere il tipo di
/// un raster, e i suoi byte, letti dall'host, devono esserlo davvero
/// ([`raster`]).
///
/// Le immagini si leggono nell'ordine in cui `usvg` le incontra, finché ci
/// stanno nel tetto: una che non ci sta resta fuori, e le altre si leggono
/// ancora. La misura si chiede prima all'anagrafe, così un file che non ci sta
/// non si legge nemmeno. Un file si legge una volta per disegno, anche se il
/// disegno lo nomina più volte o per due percorsi.
struct VaultImages<'h> {
    host: &'h dyn ReadApi,
    /// Il disegno: i percorsi sono relativi alla sua cartella.
    from: DocId,
    read: Mutex<ImagesRead>,
}

/// Ciò che le immagini del vault di un disegno hanno già dato.
#[derive(Default)]
struct ImagesRead {
    /// L'esito di ogni percorso già chiesto.
    paths: BTreeMap<String, Result<ImageKind, LeftOut>>,
    /// L'esito di ogni file già letto.
    files: BTreeMap<DocId, Result<ImageKind, LeftOut>>,
    /// I byte letti finora.
    bytes: usize,
}

impl<'h> VaultImages<'h> {
    fn new(host: &'h dyn ReadApi, from: &DocId) -> Self {
        VaultImages {
            host,
            from: from.clone(),
            read: Mutex::new(ImagesRead::default()),
        }
    }

    /// L'immagine del vault a `path`, o perché resta fuori.
    fn image(&self, path: &str) -> Result<ImageKind, LeftOut> {
        // Come per `Refused`: nessuno va in panico tenendo il lucchetto, e ciò
        // che è già stato letto resterebbe valido.
        let mut read = self
            .read
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(found) = read.paths.get(path) {
            return found.clone();
        }
        let found = self.find(path, &mut read);
        read.paths.insert(path.to_string(), found.clone());
        found
    }

    fn find(&self, path: &str, read: &mut ImagesRead) -> Result<ImageKind, LeftOut> {
        let file = match self.host.query_index(IndexQuery::Resolve {
            target: LinkTarget::Path(path.to_string()),
            from: Some(self.from.clone()),
        }) {
            Ok(IndexResult::Resolved(Some(found))) => found.doc,
            Ok(IndexResult::Resolved(None)) => return Err(LeftOut::Missing),
            _ => return Err(LeftOut::Unreadable),
        };
        if let Some(found) = read.files.get(&file) {
            return found.clone();
        }
        let found = self.read_file(&file, read);
        read.files.insert(file, found.clone());
        found
    }

    /// I byte di `file`, se è un raster che ci sta nel tetto.
    fn read_file(&self, file: &DocId, read: &mut ImagesRead) -> Result<ImageKind, LeftOut> {
        // Una nota, un disegno, un video: niente da leggere.
        if !mime_of(file).is_some_and(|mime| RASTER_TYPES.contains(&mime)) {
            return Err(LeftOut::NotRaster);
        }
        let room = VAULT_IMAGES_MAX - read.bytes;
        if self.size_of(file).is_some_and(|size| size > room as u64) {
            return Err(LeftOut::OverBudget);
        }
        let bytes = self
            .host
            .read_document_bytes(file)
            .map_err(|_| LeftOut::Unreadable)?;
        // L'anagrafe può non conoscere il file, o averne una misura vecchia.
        if bytes.len() > room {
            return Err(LeftOut::OverBudget);
        }
        let size = bytes.len();
        let kind = raster(Arc::new(bytes)).ok_or(LeftOut::NotRaster)?;
        read.bytes += size;
        Ok(kind)
    }

    /// La misura di `file` secondo l'anagrafe del vault, senza leggerlo.
    fn size_of(&self, file: &DocId) -> Option<u64> {
        let folder = file
            .as_str()
            .rsplit_once('/')
            .map_or("", |(folder, _)| folder);
        match self.host.query_index(IndexQuery::Entries {
            of_kind: None,
            within: Some(FolderScope::direct(folder)),
            page: None,
        }) {
            Ok(IndexResult::Entries(entries)) => entries
                .items
                .into_iter()
                .find(|entry| entry.id == *file)
                .map(|entry| entry.size),
            _ => None,
        }
    }
}

/// La famiglia con grazie, ed è anche quella di un testo senza `font-family`,
/// come il carattere di serie di un browser.
const SERIF: &str = "Literata";
const SANS: &str = "Inter";
const MONO: &str = "JetBrains Mono";

/// I caratteri di Fub, nei due pesi che un disegno usa: 400 e 700.
///
/// Sono gli stessi tre che l'app distribuisce (Inter, Literata e JetBrains
/// Mono, i file variabili latin di `@fontsource-variable` 5.3.0) fissati in
/// istanze statiche: `usvg` 0.45 non sa scegliere un punto dell'asse `wght`
/// di un carattere variabile, e con il file variabile ogni peso uscirebbe
/// come il peso di serie del file. Le istanze sono riproducibili: fontTools
/// 4.66.1, `instancer.instantiateVariableFont(font, {"wght": 400 | 700},
/// updateFontNames=True)` sul file caricato con `recalcTimestamp=False`, salvato
/// come TrueType. La licenza è la SIL Open Font License 1.1 di tutti e tre i
/// caratteri, in `fonts/OFL.txt` accanto ai file.
const FACES: [&[u8]; 8] = [
    include_bytes!("../fonts/inter-400.ttf"),
    include_bytes!("../fonts/inter-700.ttf"),
    include_bytes!("../fonts/literata-400.ttf"),
    include_bytes!("../fonts/literata-700.ttf"),
    include_bytes!("../fonts/literata-italic-400.ttf"),
    include_bytes!("../fonts/literata-italic-700.ttf"),
    include_bytes!("../fonts/jetbrains-mono-400.ttf"),
    include_bytes!("../fonts/jetbrains-mono-700.ttf"),
];

/// Il database dei caratteri, costruito una volta per processo e soltanto dai
/// byte qui sopra: nessuna chiamata a `load_system_fonts`, nessun file.
fn fonts() -> &'static Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut db = fontdb::Database::new();
        for face in FACES {
            db.load_font_source(fontdb::Source::Binary(Arc::new(face)));
        }
        db.set_serif_family(SERIF);
        db.set_sans_serif_family(SANS);
        db.set_monospace_family(MONO);
        // Le due famiglie generiche che Fub non ha: una scelta dichiarata è
        // meglio del primo carattere che il ripiego trova.
        db.set_cursive_family(SERIF);
        db.set_fantasy_family(SANS);
        Arc::new(db)
    })
}

/// I caratteri del disegno che nessuno dei caratteri di Fub sa disegnare:
/// `usvg` li lascia sul glifo 0, il riquadro vuoto.
fn missing_glyphs(tree: &Tree) -> BTreeSet<char> {
    fn visit(group: &usvg::Group, missing: &mut BTreeSet<char>) {
        for node in group.children() {
            match node {
                Node::Group(group) => visit(group, missing),
                Node::Text(text) => {
                    for span in text.layouted() {
                        for glyph in span.positioned_glyphs.iter().filter(|g| g.id.0 == 0) {
                            missing.extend(glyph.text.chars().filter(|c| !c.is_whitespace()));
                        }
                    }
                }
                Node::Path(_) | Node::Image(_) => {}
            }
            node.subroots(|root| visit(root, missing));
        }
    }
    let mut missing = BTreeSet::new();
    visit(tree.root(), &mut missing);
    missing
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/// La scala a cui il disegno ci sta nei limiti dei pixel: quella chiesta, o la
/// più grande sotto di lei che non li supera.
fn fitting_scale(width: f32, height: f32, asked: f32) -> f32 {
    let fits = |scale: f32| {
        let (w, h) = ((width * scale).ceil(), (height * scale).ceil());
        w <= SIDE_MAX && h <= SIDE_MAX && w * h <= AREA_MAX
    };
    if fits(asked) {
        return asked;
    }
    let mut scale = (SIDE_MAX / width)
        .min(SIDE_MAX / height)
        .min((AREA_MAX / (width * height)).sqrt())
        .min(asked);
    // L'arrotondamento per eccesso dei lati può sforare di un pixel.
    while !fits(scale) && scale > 0.0 {
        scale *= 0.999;
    }
    scale
}

fn write_png(
    drawing: &Drawing,
    asked: f32,
    path: &str,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let size = drawing.tree.size();
    let scale = fitting_scale(size.width(), size.height(), asked);
    let (width, height) = (
        (size.width() * scale).ceil() as u32,
        (size.height() * scale).ceil() as u32,
    );
    let Some(mut pixmap) = Pixmap::new(width.max(1), height.max(1)) else {
        return Ok(Outcome::Failed(format!(
            "the drawing is too large to rasterize ({width} × {height} pixels)"
        )));
    };
    if scale < asked {
        report.log.push(
            TransferNote::warning(format!(
                "exported at scale {scale:.2} instead of {asked}: at the requested scale the image would exceed {} pixels per side or {} million pixels",
                SIDE_MAX as u32,
                AREA_MAX as u32 / 1_048_576,
            ))
            .about(drawing.doc.to_string()),
        );
    }
    resvg::render(
        &drawing.tree,
        Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    let handle = out.open_artifact(path, "image/png")?;
    let mut sink = SinkWriter {
        out,
        handle,
        failure: None,
    };
    let encoded = encode_png(&pixmap, scale, &drawing.title, &mut sink);
    let SinkWriter { out, failure, .. } = sink;
    if let Some(failure) = failure {
        return Err(failure);
    }
    encoded.map_err(|error| {
        PluginError::Internal(Text::message(
            E_WRITE,
            vec![
                Arg::text("path", path.to_string()),
                Arg::text("reason", error.to_string()),
            ],
        ))
    })?;
    report.artifacts.push(out.close_artifact(handle)?);
    Ok(Outcome::Done)
}

/// Scrive il PNG a righe, dritto nel sink: la pixmap è già in memoria, una
/// seconda copia compressa non serve.
fn encode_png(
    pixmap: &Pixmap,
    scale: f32,
    title: &str,
    sink: &mut SinkWriter<'_>,
) -> Result<(), png::EncodingError> {
    let buffered = BufWriter::with_capacity(CHUNK, sink);
    let mut encoder = png::Encoder::new(buffered, pixmap.width(), pixmap.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
    // La densità: `scale` pixel per pixel CSS, che è 1/96 di pollice.
    let per_meter = (CSS_DPI * scale / 0.0254).round() as u32;
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: per_meter,
        yppu: per_meter,
        unit: png::Unit::Meter,
    }));
    encoder.add_itxt_chunk("Title".to_string(), title.to_string())?;
    encoder.add_itxt_chunk("Software".to_string(), "Fub".to_string())?;
    let mut writer = encoder.write_header()?;
    {
        let mut stream = writer.stream_writer()?;
        let mut row = Vec::with_capacity(pixmap.width() as usize * 4);
        for line in pixmap.pixels().chunks(pixmap.width() as usize) {
            row.clear();
            for pixel in line {
                // La pixmap è premoltiplicata, il PNG no.
                let color = pixel.demultiply();
                row.extend_from_slice(&[color.red(), color.green(), color.blue(), color.alpha()]);
            }
            stream.write_all(&row)?;
        }
        stream.finish()?;
    }
    // `finish` scrive la chiusura e lascia andare il buffer, che si svuota nel
    // sink: un errore lì resta in `SinkWriter::failure`, che chi chiama legge.
    writer.finish()
}

/// Un [`ArtifactSink`] visto come `io::Write`, per l'encoder. L'errore del
/// sink resta qui, tipizzato, invece di diventare un `io::Error` qualunque.
struct SinkWriter<'a> {
    out: &'a mut dyn ArtifactSink,
    handle: ArtifactHandle,
    failure: Option<PluginError>,
}

impl Write for SinkWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self.out.write_artifact(self.handle, bytes) {
            Ok(()) => Ok(bytes.len()),
            Err(error) => {
                let message = error.to_string();
                self.failure.get_or_insert(error);
                Err(io::Error::other(message))
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

fn write_pdf(
    drawing: &Drawing,
    path: &str,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let (chunk, root) =
        match svg2pdf::to_chunk(&drawing.tree, svg2pdf::ConversionOptions::default()) {
            Ok(converted) => converted,
            Err(error) => {
                return Ok(Outcome::Failed(format!(
                    "the drawing could not be converted to PDF: {error}"
                )))
            }
        };
    let size = drawing.tree.size();
    let document = match pdf::document(
        chunk.as_bytes(),
        root.get(),
        size.width(),
        size.height(),
        &drawing.title,
    ) {
        Ok(document) => document,
        Err(error) => {
            return Ok(Outcome::Failed(format!(
                "the drawing could not be converted to PDF: {error}"
            )))
        }
    };
    let handle = out.open_artifact(path, "application/pdf")?;
    for piece in document.chunks(CHUNK) {
        out.write_artifact(handle, piece)?;
    }
    report.artifacts.push(out.close_artifact(handle)?);
    Ok(Outcome::Done)
}

mod pdf {
    //! Il file PDF intorno al pezzo che scrive `svg2pdf`, e il pezzo rimesso
    //! in un ordine che non dipende dal caso.
    //!
    //! `svg2pdf::to_chunk` restituisce gli oggetti del disegno, con la radice
    //! in un XObject di un punto per un punto. Qui il pezzo si rilegge (lo ha
    //! scritto `pdf-writer`, quindi la grammatica è quella e nient'altro), si
    //! ordinano le chiavi di ogni dizionario, si rinumerano gli oggetti in
    //! ampiezza dalla radice, e si scrive il file intorno: catalogo, una
    //! pagina della misura del disegno, i metadati.

    use std::collections::{BTreeMap, VecDeque};

    /// Il lato più lungo di una pagina in unità PDF: oltre, i lettori la
    /// tagliano, e la pagina dichiara un'unità più grande (`UserUnit`).
    const PAGE_MAX: f64 = 14_400.0;
    /// Punti per pixel CSS: 72 per pollice contro 96.
    const PT_PER_PX: f64 = 0.75;
    /// Quanto possono annidarsi dizionari e array: `pdf-writer` ne scrive
    /// pochi livelli, e un pezzo che ne avesse di più non è suo.
    const DEPTH_MAX: usize = 64;

    /// Un valore PDF. I numeri, i nomi e le stringhe restano i byte scritti,
    /// perché si riscrivono tali e quali.
    #[derive(Clone, Debug, PartialEq)]
    pub(super) enum Value {
        Raw(Vec<u8>),
        Ref(u32),
        Array(Vec<Value>),
        Dict(Vec<(Vec<u8>, Value)>),
    }

    /// Un oggetto indiretto: il valore e, se è un flusso, i suoi byte.
    #[derive(Clone, Debug, PartialEq)]
    pub(super) struct Object {
        pub(super) id: u32,
        pub(super) value: Value,
        pub(super) stream: Option<Vec<u8>>,
    }

    /// Il file del disegno: `chunk` sono i byte di `svg2pdf`, `root` il suo
    /// XObject, `width` e `height` la misura del disegno in pixel CSS.
    pub(super) fn document(
        chunk: &[u8],
        root: i32,
        width: f32,
        height: f32,
        title: &str,
    ) -> Result<Vec<u8>, String> {
        let root = u32::try_from(root).map_err(|_| "invalid root object".to_string())?;
        let objects = parse(chunk)?;
        // I primi cinque numeri sono di questo file; il disegno viene dopo.
        let drawing = canonical(objects, root, 6)?;

        // In `f64`: le cifre che si scrivono sono quattro dopo la virgola, e su
        // un lato di 14 400 punti un `f32` ne ha già perse.
        let (width, height) = (f64::from(width) * PT_PER_PX, f64::from(height) * PT_PER_PX);
        // L'unità si arrotonda per eccesso alla cifra che si scrive: così la
        // pagina resta dentro il lato massimo anche dopo l'arrotondamento.
        let unit = ((width.max(height) / PAGE_MAX * 10_000.0).ceil() / 10_000.0).max(1.0);
        let (width, height) = (width / unit, height / unit);

        let mut page = vec![
            (name("Type"), raw("/Page")),
            (name("Parent"), Value::Ref(2)),
            (
                name("MediaBox"),
                Value::Array(vec![raw("0"), raw("0"), number(width), number(height)]),
            ),
            (
                name("Resources"),
                Value::Dict(vec![
                    (
                        name("XObject"),
                        Value::Dict(vec![(name("D"), Value::Ref(6))]),
                    ),
                    (
                        name("ProcSet"),
                        Value::Array(vec![raw("/PDF"), raw("/ImageC"), raw("/ImageB")]),
                    ),
                ]),
            ),
            (name("Contents"), Value::Ref(4)),
            (
                name("Group"),
                Value::Dict(vec![
                    (name("Type"), raw("/Group")),
                    (name("S"), raw("/Transparency")),
                    (name("I"), raw("true")),
                    (name("K"), raw("false")),
                    (name("CS"), raw("/DeviceRGB")),
                ]),
            ),
        ];
        if unit > 1.0 {
            page.push((name("UserUnit"), number(unit)));
        }
        let content = format!(
            "q {} 0 0 {} 0 0 cm /D Do Q",
            text(number(width)),
            text(number(height))
        )
        .into_bytes();
        let mut objects = vec![
            Object {
                id: 1,
                value: Value::Dict(vec![
                    (name("Type"), raw("/Catalog")),
                    (name("Pages"), Value::Ref(2)),
                    (
                        name("ViewerPreferences"),
                        Value::Dict(vec![(name("DisplayDocTitle"), raw("true"))]),
                    ),
                ]),
                stream: None,
            },
            Object {
                id: 2,
                value: Value::Dict(vec![
                    (name("Type"), raw("/Pages")),
                    (name("Kids"), Value::Array(vec![Value::Ref(3)])),
                    (name("Count"), raw("1")),
                ]),
                stream: None,
            },
            Object {
                id: 3,
                value: Value::Dict(page),
                stream: None,
            },
            Object {
                id: 4,
                value: Value::Dict(Vec::new()),
                stream: Some(content),
            },
            Object {
                id: 5,
                value: Value::Dict(vec![
                    (name("Title"), Value::Raw(text_string(title))),
                    (name("Producer"), raw("(Fub)")),
                ]),
                stream: None,
            },
        ];
        objects.extend(drawing);
        Ok(file(&objects, "/Info 5 0 R /Root 1 0 R"))
    }

    fn name(key: &str) -> Vec<u8> {
        format!("/{key}").into_bytes()
    }

    fn raw(token: &str) -> Value {
        Value::Raw(token.as_bytes().to_vec())
    }

    /// Un numero come lo scrive un PDF: senza esponente, con al massimo
    /// quattro decimali e senza zeri in coda.
    fn number(value: f64) -> Value {
        let mut text = format!("{value:.4}");
        while text.contains('.') && (text.ends_with('0') || text.ends_with('.')) {
            text.pop();
        }
        Value::Raw(text.into_bytes())
    }

    fn text(value: Value) -> String {
        let mut out = Vec::new();
        write_value(&value, &mut out);
        String::from_utf8_lossy(&out).into_owned()
    }

    /// Una stringa di testo PDF: ASCII stampabile così com'è, altrimenti
    /// UTF-16BE con il BOM, in esadecimale.
    pub(super) fn text_string(title: &str) -> Vec<u8> {
        if title.bytes().all(|b| (0x20..0x7F).contains(&b)) {
            let mut out = vec![b'('];
            for b in title.bytes() {
                if matches!(b, b'(' | b')' | b'\\') {
                    out.push(b'\\');
                }
                out.push(b);
            }
            out.push(b')');
            return out;
        }
        let mut out = b"<FEFF".to_vec();
        for unit in title.encode_utf16() {
            out.extend(format!("{unit:04X}").into_bytes());
        }
        out.push(b'>');
        out
    }

    // --- lettura ------------------------------------------------------------

    fn is_white(b: u8) -> bool {
        matches!(b, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
    }

    fn is_delimiter(b: u8) -> bool {
        matches!(
            b,
            b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
        )
    }

    struct Reader<'a> {
        src: &'a [u8],
        at: usize,
    }

    impl Reader<'_> {
        fn fail<T>(&self, what: &str) -> Result<T, String> {
            Err(format!("unexpected PDF data at byte {}: {what}", self.at))
        }

        fn peek(&self) -> Option<u8> {
            self.src.get(self.at).copied()
        }

        fn rest(&self) -> &[u8] {
            &self.src[self.at.min(self.src.len())..]
        }

        fn skip_white(&mut self) {
            while let Some(b) = self.peek() {
                if is_white(b) {
                    self.at += 1;
                } else if b == b'%' {
                    while self.peek().is_some_and(|b| b != b'\n' && b != b'\r') {
                        self.at += 1;
                    }
                } else {
                    break;
                }
            }
        }

        /// Una parola: tutto fino al primo spazio o delimitatore.
        fn word(&mut self) -> &[u8] {
            let start = self.at;
            while self
                .peek()
                .is_some_and(|b| !is_white(b) && !is_delimiter(b))
            {
                self.at += 1;
            }
            &self.src[start..self.at]
        }

        fn keyword(&mut self, expected: &[u8]) -> Result<(), String> {
            self.skip_white();
            if self.word() == expected {
                Ok(())
            } else {
                self.fail(&format!("expected `{}`", String::from_utf8_lossy(expected)))
            }
        }

        fn unsigned(&mut self) -> Result<u32, String> {
            self.skip_white();
            let word = self.word();
            match std::str::from_utf8(word).ok().and_then(|w| w.parse().ok()) {
                Some(n) => Ok(n),
                None => self.fail("expected an object number"),
            }
        }

        fn value(&mut self, depth: usize) -> Result<Value, String> {
            if depth > DEPTH_MAX {
                return self.fail("nested too deeply");
            }
            self.skip_white();
            let start = self.at;
            match self.peek() {
                None => self.fail("end of data"),
                Some(b'<') if self.rest().starts_with(b"<<") => {
                    self.at += 2;
                    let mut entries = Vec::new();
                    loop {
                        self.skip_white();
                        if self.rest().starts_with(b">>") {
                            self.at += 2;
                            return Ok(Value::Dict(entries));
                        }
                        let Value::Raw(key) = self.value(depth + 1)? else {
                            return self.fail("a dictionary key must be a name");
                        };
                        if !key.starts_with(b"/") {
                            return self.fail("a dictionary key must be a name");
                        }
                        let value = self.value(depth + 1)?;
                        entries.push((key, value));
                    }
                }
                Some(b'<') => {
                    while self.peek().is_some_and(|b| b != b'>') {
                        self.at += 1;
                    }
                    if self.peek().is_none() {
                        return self.fail("unterminated hex string");
                    }
                    self.at += 1;
                    Ok(Value::Raw(self.src[start..self.at].to_vec()))
                }
                Some(b'[') => {
                    self.at += 1;
                    let mut items = Vec::new();
                    loop {
                        self.skip_white();
                        if self.peek() == Some(b']') {
                            self.at += 1;
                            return Ok(Value::Array(items));
                        }
                        items.push(self.value(depth + 1)?);
                    }
                }
                Some(b'(') => {
                    let mut open = 0usize;
                    loop {
                        match self.peek() {
                            None => return self.fail("unterminated string"),
                            Some(b'\\') => self.at += 1,
                            Some(b'(') => open += 1,
                            Some(b')') => {
                                open -= 1;
                                if open == 0 {
                                    self.at += 1;
                                    break;
                                }
                            }
                            Some(_) => {}
                        }
                        self.at += 1;
                    }
                    Ok(Value::Raw(self.src[start..self.at].to_vec()))
                }
                Some(b'/') => {
                    self.at += 1;
                    self.word();
                    Ok(Value::Raw(self.src[start..self.at].to_vec()))
                }
                Some(_) => {
                    let word = self.word().to_vec();
                    if word.is_empty() {
                        return self.fail("unexpected delimiter");
                    }
                    // `N 0 R` è un riferimento: tre parole, da leggere insieme.
                    if word.iter().all(u8::is_ascii_digit) {
                        let back = self.at;
                        self.skip_white();
                        let generation = self.word().to_vec();
                        self.skip_white();
                        if generation == b"0" && self.word() == b"R" {
                            let id = std::str::from_utf8(&word).ok().and_then(|w| w.parse().ok());
                            return match id {
                                Some(id) => Ok(Value::Ref(id)),
                                None => self.fail("object number out of range"),
                            };
                        }
                        self.at = back;
                    }
                    Ok(Value::Raw(word))
                }
            }
        }

        fn object(&mut self) -> Result<Object, String> {
            let id = self.unsigned()?;
            self.keyword(b"0")?;
            self.keyword(b"obj")?;
            let value = self.value(0)?;
            self.skip_white();
            let mut stream = None;
            if self.rest().starts_with(b"stream") {
                self.at += b"stream".len();
                if self.rest().starts_with(b"\r\n") {
                    self.at += 2;
                } else if self.peek() == Some(b'\n') {
                    self.at += 1;
                } else {
                    return self.fail("a stream starts on its own line");
                }
                let length = match &value {
                    Value::Dict(entries) => entries.iter().find_map(|(key, value)| match value {
                        Value::Raw(n) if key == b"/Length" => std::str::from_utf8(n)
                            .ok()
                            .and_then(|n| n.parse::<usize>().ok()),
                        _ => None,
                    }),
                    _ => None,
                };
                let Some(length) = length else {
                    return self.fail("a stream without a direct length");
                };
                let end = self
                    .at
                    .checked_add(length)
                    .filter(|end| *end <= self.src.len());
                let Some(end) = end else {
                    return self.fail("a stream longer than the data");
                };
                stream = Some(self.src[self.at..end].to_vec());
                self.at = end;
                self.keyword(b"endstream")?;
            }
            self.keyword(b"endobj")?;
            Ok(Object { id, value, stream })
        }
    }

    /// Gli oggetti di un pezzo scritto da `pdf-writer`, nell'ordine del pezzo.
    pub(super) fn parse(chunk: &[u8]) -> Result<Vec<Object>, String> {
        let mut reader = Reader { src: chunk, at: 0 };
        let mut objects = Vec::new();
        loop {
            reader.skip_white();
            if reader.peek().is_none() {
                return Ok(objects);
            }
            objects.push(reader.object()?);
        }
    }

    // --- l'ordine -----------------------------------------------------------

    /// Ordina le chiavi di ogni dizionario. In PDF l'ordine delle chiavi non
    /// significa niente, quindi è l'unica forma che non cambia fra due export.
    fn sort_keys(value: &mut Value) {
        match value {
            Value::Dict(entries) => {
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                for (_, value) in entries {
                    sort_keys(value);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(sort_keys),
            Value::Raw(_) | Value::Ref(_) => {}
        }
    }

    fn refs(value: &Value, found: &mut Vec<u32>) {
        match value {
            Value::Ref(id) => found.push(*id),
            Value::Dict(entries) => entries.iter().for_each(|(_, value)| refs(value, found)),
            Value::Array(items) => items.iter().for_each(|value| refs(value, found)),
            Value::Raw(_) => {}
        }
    }

    fn renumber(value: &mut Value, map: &BTreeMap<u32, u32>) {
        match value {
            Value::Ref(id) => *id = map[id],
            Value::Dict(entries) => entries
                .iter_mut()
                .for_each(|(_, value)| renumber(value, map)),
            Value::Array(items) => items.iter_mut().for_each(|value| renumber(value, map)),
            Value::Raw(_) => {}
        }
    }

    /// Gli oggetti in forma canonica: chiavi ordinate, numeri dati in ampiezza
    /// dalla radice a partire da `first`, nell'ordine dei numeri. Un oggetto
    /// che dalla radice non si raggiunge non serve alla pagina e resta fuori;
    /// un riferimento a un oggetto che il pezzo non contiene è un errore.
    pub(super) fn canonical(
        objects: Vec<Object>,
        root: u32,
        first: u32,
    ) -> Result<Vec<Object>, String> {
        let mut by_id = BTreeMap::new();
        for mut object in objects {
            sort_keys(&mut object.value);
            if by_id.insert(object.id, object).is_some() {
                return Err("an object number is used twice".to_string());
            }
        }
        let mut map = BTreeMap::new();
        let mut queue = VecDeque::from([root]);
        map.insert(root, first);
        let mut order = Vec::new();
        while let Some(id) = queue.pop_front() {
            let Some(object) = by_id.get(&id) else {
                return Err(format!("object {id} is referenced but missing"));
            };
            order.push(id);
            let mut found = Vec::new();
            refs(&object.value, &mut found);
            for next in found {
                if !map.contains_key(&next) {
                    let number = first + map.len() as u32;
                    map.insert(next, number);
                    queue.push_back(next);
                }
            }
        }
        Ok(order
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .map(|mut object| {
                object.id = map[&object.id];
                renumber(&mut object.value, &map);
                object
            })
            .collect())
    }

    // --- scrittura ----------------------------------------------------------

    fn write_value(value: &Value, out: &mut Vec<u8>) {
        match value {
            Value::Raw(token) => out.extend_from_slice(token),
            Value::Ref(id) => out.extend(format!("{id} 0 R").into_bytes()),
            Value::Array(items) => {
                out.push(b'[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(b' ');
                    }
                    write_value(item, out);
                }
                out.push(b']');
            }
            Value::Dict(entries) => {
                out.extend_from_slice(b"<<");
                for (i, (key, value)) in entries.iter().enumerate() {
                    if i > 0 {
                        out.push(b' ');
                    }
                    out.extend_from_slice(key);
                    out.push(b' ');
                    write_value(value, out);
                }
                out.extend_from_slice(b">>");
            }
        }
    }

    /// Il file: intestazione, oggetti in ordine di numero, tabella dei
    /// riferimenti incrociati e trailer, senza date e senza `/ID`. `trailer`
    /// sono le voci del trailer oltre a `/Size`, già scritte.
    pub(super) fn file(objects: &[Object], trailer: &str) -> Vec<u8> {
        let mut out = b"%PDF-1.7\n%\x80\x80\x80\x80\n".to_vec();
        let mut offsets = BTreeMap::new();
        for object in objects {
            offsets.insert(object.id, out.len());
            out.extend(format!("{} 0 obj\n", object.id).into_bytes());
            let mut value = object.value.clone();
            if let (Value::Dict(entries), Some(stream)) = (&mut value, &object.stream) {
                entries.retain(|(key, _)| key != b"/Length");
                entries.push((b"/Length".to_vec(), raw(&stream.len().to_string())));
                entries.sort_by(|a, b| a.0.cmp(&b.0));
            }
            write_value(&value, &mut out);
            if let Some(stream) = &object.stream {
                out.extend_from_slice(b"\nstream\n");
                out.extend_from_slice(stream);
                out.extend_from_slice(b"\nendstream");
            }
            out.extend_from_slice(b"\nendobj\n");
        }
        let size = offsets.keys().next_back().map_or(1, |last| last + 1);
        let xref = out.len();
        out.extend(format!("xref\n0 {size}\n0000000000 65535 f\r\n").into_bytes());
        for id in 1..size {
            match offsets.get(&id) {
                Some(offset) => out.extend(format!("{offset:010} 00000 n\r\n").into_bytes()),
                None => out.extend_from_slice(b"0000000000 65535 f\r\n"),
            }
        }
        out.extend(
            format!("trailer\n<<{trailer} /Size {size}>>\nstartxref\n{xref}\n%%EOF\n").into_bytes(),
        );
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_font_database_holds_fubs_faces_and_nothing_else() {
        let db = fonts();
        assert_eq!(db.len(), FACES.len());
        let mut families = BTreeSet::new();
        for face in db.faces() {
            // Dai byte compilati nel binario, non da un file: è ciò che rende
            // l'export uguale su ogni macchina.
            assert!(matches!(face.source, fontdb::Source::Binary(_)));
            families.insert(face.families[0].0.as_str());
        }
        assert_eq!(families, BTreeSet::from([SANS, MONO, SERIF]));

        for (generic, family) in [
            (fontdb::Family::Serif, SERIF),
            (fontdb::Family::SansSerif, SANS),
            (fontdb::Family::Monospace, MONO),
            (fontdb::Family::Cursive, SERIF),
            (fontdb::Family::Fantasy, SANS),
        ] {
            assert_eq!(db.family_name(&generic), family);
        }

        // Ogni famiglia ha i suoi due pesi, e Literata anche il corsivo.
        let styles = [
            (SANS, fontdb::Style::Normal),
            (SERIF, fontdb::Style::Normal),
            (SERIF, fontdb::Style::Italic),
            (MONO, fontdb::Style::Normal),
        ];
        for (family, style) in styles {
            for weight in [400, 700] {
                let id = db
                    .query(&fontdb::Query {
                        families: &[fontdb::Family::Name(family)],
                        weight: fontdb::Weight(weight),
                        style,
                        ..fontdb::Query::default()
                    })
                    .unwrap_or_else(|| panic!("{family} {weight}"));
                let face = db.face(id).unwrap();
                assert_eq!(face.weight, fontdb::Weight(weight), "{family}");
                assert_eq!(face.style, style, "{family}");
            }
        }
    }

    #[test]
    fn only_raster_images_are_kept_and_the_bytes_decide() {
        let kind = |bytes: &[u8]| raster(Arc::new(bytes.to_vec()));
        // Il minimo che dice formato e misura, 2 × 1 pixel: l'intestazione del
        // file, e per il JPEG il suo primo `SOF`.
        assert!(matches!(
            kind(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x02\0\0\0\x01"),
            Some(ImageKind::PNG(_))
        ));
        assert!(matches!(
            kind(&[
                0xFF, 0xD8, 0xFF, 0xC0, 0, 0x11, 8, 0, 1, 0, 2, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11,
                1
            ]),
            Some(ImageKind::JPEG(_))
        ));
        assert!(matches!(
            kind(b"GIF89a\x02\0\x01\0\0\0\0"),
            Some(ImageKind::GIF(_))
        ));
        assert!(matches!(
            kind(b"GIF87a\x02\0\x01\0\0\0\0"),
            Some(ImageKind::GIF(_))
        ));
        assert!(matches!(
            kind(b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f\x01\0\0\0"),
            Some(ImageKind::WEBP(_))
        ));
        // Un SVG, anche quando si dichiara `image/png`, resta fuori: dentro
        // potrebbe nominare altre risorse.
        assert!(kind(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>").is_none());
        assert!(kind(b"\x1f\x8b\x08\x00").is_none());
        assert!(kind(b"RIFF\0\0\0\0AVI LIST").is_none());
        assert!(kind(b"RIFF").is_none());
        assert!(kind(b"").is_none());
        // Il formato giusto senza una misura che si legga, o con un lato
        // nullo: `usvg` la scarterebbe senza dirlo, e qui resta fuori prima.
        assert!(kind(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR").is_none());
        assert!(kind(&[0xFF, 0xD8, 0xFF, 0xE0]).is_none());
        assert!(kind(b"GIF89a\0\0\x01\0\0\0\0").is_none());
        assert!(kind(b"RIFF\0\0\0\0WEBPVP8L").is_none());
    }

    #[test]
    fn a_vault_path_is_read_like_the_client_reads_it() {
        for (href, path) in [
            ("foto/mare.png", Some("foto/mare.png")),
            ("/Allegati/foto.png", Some("/Allegati/foto.png")),
            ("../foto.png", Some("../foto.png")),
            ("  foto.png\n", Some("foto.png")),
            ("fo\tto\r\n.png", Some("foto.png")),
            ("foto mare.png", Some("foto mare.png")),
            ("foto%20mare.png", Some("foto%20mare.png")),
            // Un `:` dopo una barra non fa uno schema.
            ("cartella/ore 10:30.png", Some("cartella/ore 10:30.png")),
            ("1nota:foto.png", Some("1nota:foto.png")),
            ("", None),
            ("  ", None),
            ("#foto", None),
            ("//example.org/foto.png", None),
            ("\\\\server\\foto.png", None),
            ("/\\server/foto.png", None),
            ("https://example.org/foto.png", None),
            ("HTTP://example.org/foto.png", None),
            ("file:///etc/foto.png", None),
            ("data:image/png;base64,AAAA", None),
            ("C:\\foto.png", None),
            ("nota:foto.png", None),
        ] {
            assert_eq!(vault_path(href).as_deref(), path, "{href:?}");
        }
    }

    #[test]
    fn a_png_scale_stays_within_the_pixel_limits() {
        assert_eq!(fitting_scale(400.0, 250.0, 2.0), 2.0);
        // 8192 × 4096 è proprio l'area massima: ci sta a scala 2, il doppio no.
        assert_eq!(fitting_scale(4096.0, 2048.0, 2.0), 2.0);
        assert_eq!(fitting_scale(8192.0, 4096.0, 2.0), 1.0);
        for (width, height) in [(40_000.0, 10.0), (10.0, 40_000.0), (10_000.0, 10_000.0)] {
            let scale = fitting_scale(width, height, 2.0);
            let (w, h) = ((width * scale).ceil(), (height * scale).ceil());
            assert!(
                w <= SIDE_MAX && h <= SIDE_MAX && w * h <= AREA_MAX,
                "{w}×{h}"
            );
            // Ridotta, ma non più del necessario.
            let side = w.max(h);
            assert!(
                side >= SIDE_MAX * 0.99 || w * h >= AREA_MAX * 0.99,
                "{w}×{h}"
            );
        }
    }

    // --- il PDF -------------------------------------------------------------

    /// Lo stesso grafo di oggetti, scritto due volte con numeri, ordine degli
    /// oggetti e ordine delle chiavi diversi: è ciò che fa `svg2pdf` da
    /// un'istanza all'altra. Il flusso contiene la parola `endstream`, che si
    /// salta perché la lunghezza è quella dichiarata.
    const CHUNK_A: &[u8] = b"1 0 obj\n<</Type /XObject /Subtype /Form /Resources <</Font <</f0 3 0 R>>>> /Length 13>>\nstream\nq endstream Q\nendstream\nendobj\n\
3 0 obj\n<</BaseFont /AAAAAA+Inter-Regular /Descendants [2 0 R] /Widths [0 0 500]>>\nendobj\n\
2 0 obj\n<</Z 1.5 /A (st\\)r\\\\ing) /M <00FF> /Back 1 0 R>>\nendobj\n\
9 0 obj\n<</Unreachable true>>\nendobj\n";
    const CHUNK_B: &[u8] = b"% un commento\n4 0 obj\n<</M <00FF> /Back 7 0 R /A (st\\)r\\\\ing) /Z 1.5>>\nendobj\n\
7 0 obj\r\n<</Subtype /Form /Length 13 /Resources <</Font <</f0 5 0 R>>>> /Type /XObject>>\nstream\r\nq endstream Q\nendstream\nendobj\n\
5 0 obj\n<</Widths [0 0 500] /Descendants [4 0 R] /BaseFont /AAAAAA+Inter-Regular>>\nendobj\n";

    #[test]
    fn two_numberings_of_the_same_graph_give_the_same_file() {
        let a = pdf::canonical(pdf::parse(CHUNK_A).unwrap(), 1, 6).unwrap();
        let b = pdf::canonical(pdf::parse(CHUNK_B).unwrap(), 7, 6).unwrap();
        assert_eq!(a, b);

        let file = pdf::file(&a, "/Info 5 0 R /Root 1 0 R");
        let xref = file.windows(5).position(|w| w == b"xref\n").unwrap();
        let (body, tail) = file.split_at(xref);
        // In ampiezza dalla radice, con le chiavi in ordine; l'oggetto 9 non
        // si raggiunge e non c'è.
        let expected: &[u8] = b"%PDF-1.7\n%\x80\x80\x80\x80\n\
6 0 obj\n<</Length 13 /Resources <</Font <</f0 7 0 R>>>> /Subtype /Form /Type /XObject>>\nstream\nq endstream Q\nendstream\nendobj\n\
7 0 obj\n<</BaseFont /AAAAAA+Inter-Regular /Descendants [8 0 R] /Widths [0 0 500]>>\nendobj\n\
8 0 obj\n<</A (st\\)r\\\\ing) /Back 6 0 R /M <00FF> /Z 1.5>>\nendobj\n";
        assert_eq!(
            String::from_utf8_lossy(body),
            String::from_utf8_lossy(expected)
        );

        // La tabella punta all'inizio di ogni oggetto, con righe di 20 byte.
        let tail = std::str::from_utf8(tail).unwrap();
        let mut lines = tail.split('\n').skip(2);
        for id in 0..9usize {
            let line = lines.next().unwrap();
            assert_eq!(line.len(), 19, "{line:?}");
            assert!(line.ends_with('\r'));
            let offset: usize = line[..10].parse().unwrap();
            if id >= 6 {
                assert!(file[offset..].starts_with(format!("{id} 0 obj\n").as_bytes()));
            } else {
                assert_eq!(line, "0000000000 65535 f\r");
            }
        }
        assert!(tail.ends_with(&format!("startxref\n{xref}\n%%EOF\n")));

        // E il file si rilegge negli stessi oggetti.
        assert_eq!(pdf::parse(body).unwrap(), a);
    }

    #[test]
    fn a_chunk_that_is_not_pdf_writers_is_refused() {
        let canonical = |chunk: &[u8]| pdf::parse(chunk).and_then(|o| pdf::canonical(o, 1, 6));
        for (chunk, why) in [
            (
                &b"1 0 obj\n<<>>\nendobj\n1 0 obj\n<<>>\nendobj\n"[..],
                "used twice",
            ),
            (b"1 0 obj\n<</A 2 0 R>>\nendobj\n", "missing"),
            (b"2 0 obj\n<<>>\nendobj\n", "missing"),
            (
                b"1 0 obj\n<</Length 2 0 R>>\nstream\nab\nendstream\nendobj\n",
                "direct length",
            ),
            (
                b"1 0 obj\n<</Length 99>>\nstream\nab\nendstream\nendobj\n",
                "longer than",
            ),
            (
                b"1 0 obj\n<</Length 2>>\nstream ab\nendstream\nendobj\n",
                "own line",
            ),
            (b"1 0 obj\n<</A (open>>\nendobj\n", "unterminated"),
            (b"1 0 obj\n<<1 2>>\nendobj\n", "must be a name"),
            (b"1 0 obj\n<<>>\n", "endobj"),
        ] {
            let error = canonical(chunk).unwrap_err();
            assert!(error.contains(why), "{error}");
        }
        let deep = [&b"1 0 obj\n"[..], &[b'['; 80], &[b']'; 80], b"\nendobj\n"].concat();
        assert!(canonical(&deep).unwrap_err().contains("nested too deeply"));
    }

    #[test]
    fn the_page_has_the_size_of_the_drawing_and_its_title() {
        let chunk = b"1 0 obj\n<</Type /XObject /Subtype /Form /BBox [0 0 401 250] /Length 0>>\nstream\n\nendstream\nendobj\n";
        let file = pdf::document(chunk, 1, 401.0, 250.0, "Città (1)").unwrap();
        let text = String::from_utf8_lossy(&file);
        // 401 × 250 pixel CSS sono 300,75 × 187,5 punti: senza zeri in coda.
        assert!(text.contains("/MediaBox [0 0 300.75 187.5]"), "{text}");
        assert!(text.contains("stream\nq 300.75 0 0 187.5 0 0 cm /D Do Q\nendstream"));
        assert!(!text.contains("/UserUnit"));
        assert!(
            text.contains("/Resources <</XObject <</D 6 0 R>> /ProcSet [/PDF /ImageC /ImageB]>>")
        );
        assert!(text
            .contains("6 0 obj\n<</BBox [0 0 401 250] /Length 0 /Subtype /Form /Type /XObject>>"));
        assert!(text.contains("/Info 5 0 R /Root 1 0 R /Size 7"));

        assert_eq!(pdf::text_string("scena"), b"(scena)");
        assert_eq!(pdf::text_string("a(b)\\"), b"(a\\(b\\)\\\\)");
        assert_eq!(pdf::text_string("Città"), b"<FEFF004300690074007400E0>");
        assert_eq!(pdf::text_string("a\nb"), b"<FEFF0061000A0062>");
        assert_eq!(pdf::text_string("水"), b"<FEFF6C34>");
        assert!(
            text.contains("/Title <FEFF004300690074007400E00020002800310029>"),
            "{text}"
        );
    }
}
