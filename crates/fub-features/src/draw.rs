//! I disegni nel vault (bundle `fub.draw`): il comando che ne fa nascere uno,
//! l'export in PNG, JPEG, SVG e PDF, e le impostazioni dell'editor.
//!
//! Il comando «Nuovo disegno» è nel modulo [`create`]: un disegno nasce vuoto
//! dal provider del formato, da un modello distribuito con Fub o da un disegno
//! del vault, con un nome libero, e si apre. Il comando «Annota
//! il PDF» è nel modulo [`annotate`]: apre le annotazioni di un PDF, il file
//! `.pdf.fubann` accanto, e le fa nascere dal provider `fubann` se non ci sono.
//!
//! L'export sono quattro [`ExportProvider`], uno per formato, che leggono il
//! disegno nello stesso modo. Le opzioni della richiesta ([`choice`]) dicono
//! che cosa esce: il disegno intero, alcune tavole o gli oggetti scelti, con
//! la carta o senza, e per il PDF su che pagina di stampa. Il disegno intero
//! con la carta sono i byte del documento; il resto è la derivazione di
//! `fub_scene::export`, la stessa che il client fa per l'anteprima. Il testo
//! passa da `usvg`, che ne fa un albero, e da lì `resvg` rasterizza il PNG e
//! il JPEG e `svg2pdf` scrive il PDF vettoriale, sulla carta, con
//! l'abbondanza e i segni chiesti ([`fub_scene::export::print`]); l'SVG è il
//! testo stesso, ripulito per il web. Un disegno è
//! un documento del formato `svg`; gli altri documenti della selezione si
//! saltano, e il log dice quanti.
//!
//! Le annotazioni di un PDF hanno due export loro, nel modulo [`annotated`]:
//! il PDF annotato, cioè l'originale con le annotazioni sopra, e il PDF
//! redatto, dove ciò che le coperture nascondono non c'è più. Il disegno di
//! ogni pagina passa dalle stesse opzioni di `usvg` e dai caratteri di Fub,
//! senza le immagini e i caratteri del vault, che l'editor delle annotazioni
//! non mostra.
//!
//! # Niente oltre al documento, alle sue immagini e ai suoi caratteri
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
//! - I caratteri sono quelli di Fub, incorporati nel binario ([`FACES`] e i
//!   file variabili da cui si fissano gli altri pesi), e quelli del vault, che
//!   dà l'host come le immagini ([`typefaces`]): niente caratteri di sistema,
//!   quindi lo stesso disegno, con lo stesso vault, esce uguale su ogni
//!   macchina. Il database si costruisce soltanto da quei byte. `fontdb`
//!   saprebbe leggere anche dal disco, perché `svg2pdf` lo prende con le
//!   feature di serie e le feature di Cargo si sommano, ma nessuno glielo
//!   chiede: `resvg` è compilato senza `system-fonts`, e il database non passa
//!   mai da `load_system_fonts`.
//!
//! È la regola con cui la webview mostra un SVG dentro un `<img>`, dove la rete
//! e i file del computer non si caricano, con le immagini e i caratteri del
//! vault in più: del disegno fanno parte quanto quelle incorporate. E i
//! caratteri, qui, sono quelli veri.
//!
//! # Lo stesso disegno, gli stessi byte
//!
//! Due export dello stesso disegno producono gli stessi byte. Il PNG e il JPEG
//! non portano date. Il PDF le date non le ha nemmeno, ma `svg2pdf` scrive i
//! caratteri e le risorse nell'ordine di due `HashMap`, quindi con due
//! caratteri in un disegno la numerazione degli oggetti cambia da un export
//! all'altro. Il modulo [`pdf`] rilegge il pezzo prodotto da `svg2pdf`, ordina
//! le chiavi dei dizionari e rinumera gli oggetti nell'ordine in cui si
//! raggiungono dalla radice: lo stesso albero dà sempre lo stesso file.
//!
//! # Le impostazioni
//!
//! [`settings`] dichiara quattro chiavi, nel gruppo «Disegni»: il livello
//! d'interfaccia dell'editor e le parti del Personalizzato, la cartella dei
//! modelli del vault e i suggerimenti brevi. Le prime due le legge l'editor,
//! che le segue dal vivo; la terza la legge la galleria di «Nuovo disegno»; la
//! quarta la scrive la casella «Non mostrare più suggerimenti».

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, BufWriter, Write};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use fub_abi::error::PluginError;
use fub_abi::model::{Block, DocId, Inline, LinkTarget};
use fub_abi::rules::media::mime_of;
use fub_abi::rules::path::strip_ext;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{FolderScope, IndexQuery, IndexResult, ReadApi};
use fub_abi::transfer::{
    ArtifactHandle, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget,
    TransferNote, PLUGIN_EXPORT_LIMIT,
};
use fub_abi::ui::UiOption;
use fub_format_svg::FORMAT_ID;
use fub_scene::export::print::{self, Setup};
use fub_scene::export::{
    clean, embed_images, measure, Board, DeriveError, Scope, Size, Source, AREA_MAX, SIDE_MAX,
};
use fub_scene::ReadError;
use image::codecs::jpeg::{JpegEncoder, PixelDensity};
use image::{GenericImageView, Rgb};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, fontdb, ImageHrefResolver, ImageKind, Node, Tree};

mod annotate;
mod annotated;
mod choice;
mod create;
mod fonts;
mod index;
mod templates;
mod typefaces;

pub use annotate::PDF_ANNOTATE;
pub use annotated::{AnnotatedPdfExport, RedactedPdfExport, DRAW_ANNOTATED_PDF, DRAW_REDACTED_PDF};
pub use create::{DrawCommands, DRAWING_CREATE};
pub use index::DrawIndex;

use choice::{
    board_label, print_setup, raster_size, Choice, Names, Part, EXPORTED_SUFFIX, E_BOARD, E_OBJECT,
    E_ONE_DRAWING,
};
use typefaces::{Typefaces, VaultFonts};

/// Id del componente.
pub const DRAW_ID: &str = "fub.draw";
/// La destinazione PNG: un'immagine per disegno, per tavola o per selezione.
pub const DRAW_PNG: &str = "draw.png";
/// La destinazione JPEG: la stessa immagine del PNG, posata sul bianco.
pub const DRAW_JPEG: &str = "draw.jpeg";
/// La destinazione SVG: il testo del disegno ripulito per il web.
pub const DRAW_SVG: &str = "draw.svg";
/// La destinazione PDF: un file vettoriale per disegno, una pagina per tavola.
pub const DRAW_PDF: &str = "draw.pdf";

/// L'impostazione del livello d'interfaccia dell'editor: quali strumenti offre.
pub const DRAW_LEVEL_KEY: &str = "draw.level";
/// I valori del livello, dal più semplice: il primo è quello di serie. Sono i
/// nomi che l'editor conosce (`Level` in `tools/registry.ts`), e il test del
/// client `editors/spatial/draw-settings-mirror.test.ts` li confronta.
pub const DRAW_LEVELS: [&str; 4] = ["essential", "standard", "expert", "custom"];
/// L'impostazione delle parti del livello Personalizzato: un elenco di nomi.
pub const DRAW_CUSTOM_KEY: &str = "draw.custom";
/// Le parti del Personalizzato quando nessuno le ha scelte: quelle
/// dell'Essenziale, nell'ordine della barra. La fonte è `CUSTOM_DEFAULT` in
/// `apps/client/src/editors/spatial/tools/registry.ts`, e lo stesso test del
/// client, che legge questo file, confronta le due.
pub const DRAW_CUSTOM_DEFAULT: [&str; 6] = ["pen", "eraser", "rect", "ellipse", "line", "arrow"];
/// L'impostazione della cartella dei modelli del vault.
pub const DRAW_TEMPLATES_KEY: &str = "draw.templates";
/// La cartella dei modelli quando nessuno ha scelto: `Templates`, nella radice.
pub const DRAW_TEMPLATES_DEFAULT: &str = "Templates";
/// L'impostazione dei suggerimenti brevi dell'editor.
pub const DRAW_SUGGESTIONS_KEY: &str = "draw.suggestions";

/// La densità di riferimento dei pixel CSS: 96 per pollice.
const CSS_DPI: f32 = 96.0;
/// Pixel CSS per millimetro: 96 per pollice, 25,4 millimetri per pollice.
const PX_PER_MM: f64 = print::PT_PER_MM / print::PT_PER_PX;
/// La qualità del JPEG, da 1 a 100: a 90 i bordi dei tratti restano puliti, e
/// il file resta molto più piccolo del PNG di una fotografia.
const JPEG_QUALITY: u8 = 90;
/// I byte per scrittura verso il sink.
const CHUNK: usize = 64 * 1024;
/// Quanti riferimenti esterni il log elenca per disegno; gli altri li conta.
const LISTED: usize = 3;

const E_TARGET: &str = "e_target";
const E_NO_DRAWINGS: &str = "e_no_drawings";
const E_NONE_EXPORTED: &str = "e_none_exported";
const E_WRITE: &str = "e_write";
const S_GROUP: &str = "s_group";
const S_LEVEL: &str = "s_level";
const S_LEVEL_DESC: &str = "s_level_desc";
const S_ESSENTIAL: &str = "s_essential";
const S_STANDARD: &str = "s_standard";
const S_EXPERT: &str = "s_expert";
const S_CUSTOM_LEVEL: &str = "s_custom_level";
const S_CUSTOM: &str = "s_custom";
const S_CUSTOM_DESC: &str = "s_custom_desc";
const S_TEMPLATES: &str = "s_templates";
const S_TEMPLATES_DESC: &str = "s_templates_desc";
const S_SUGGESTIONS: &str = "s_suggestions";
const S_SUGGESTIONS_DESC: &str = "s_suggestions_desc";

/// Lo schema delle impostazioni dei disegni.
///
/// - **Il livello** e **le parti del Personalizzato** sono del **vault**,
///   perché le sceglie chi prepara il vault: chi insegna e lo lascia
///   all'Essenziale per una classe lo lascia su ogni macchina che apre quel
///   vault. **Non** `program_writable`: un componente che alzasse il livello da
///   sé metterebbe davanti a chi disegna strumenti che nessuno ha scelto di
///   dargli. Cambiare livello non tocca i disegni: filtra soltanto ciò che
///   l'editor offre. La griglia qui non c'è: è uno stato della vista, e lo
///   ricorda la macchina, senza riscrivere il file del vault a ogni `#`.
///   `draw.custom` è un elenco, e il pannello delle Impostazioni lo mostra con
///   il campo dell'editor, che conosce le parti.
/// - **La cartella dei modelli** è del vault: i modelli sono disegni del
///   vault, e viaggiano con lui. `program_writable`, come le cartelle delle
///   giornaliere: è un profilo di vault reversibile, e non tocca la privacy.
/// - **I suggerimenti** sono della **macchina**: spegnerli è una preferenza di
///   chi usa l'editor, non del vault. La scrive la casella «Non mostrare più
///   suggerimenti», quindi dall'interfaccia; non `program_writable`.
pub fn settings() -> Vec<SettingSpec> {
    let [essential, standard, expert, custom] = DRAW_LEVELS;
    vec![
        SettingSpec::new(
            DRAW_LEVEL_KEY,
            Text::key(S_LEVEL),
            SettingKind::Choice {
                default: essential.into(),
                options: vec![
                    UiOption::new(essential, Text::key(S_ESSENTIAL)),
                    UiOption::new(standard, Text::key(S_STANDARD)),
                    UiOption::new(expert, Text::key(S_EXPERT)),
                    UiOption::new(custom, Text::key(S_CUSTOM_LEVEL)),
                ],
            },
        )
        .describing(Text::key(S_LEVEL_DESC))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::new(
            DRAW_CUSTOM_KEY,
            Text::key(S_CUSTOM),
            SettingKind::List {
                default: DRAW_CUSTOM_DEFAULT
                    .iter()
                    .map(|part| (*part).into())
                    .collect(),
            },
        )
        .describing(Text::key(S_CUSTOM_DESC))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::new(
            DRAW_TEMPLATES_KEY,
            Text::key(S_TEMPLATES),
            SettingKind::Text {
                default: DRAW_TEMPLATES_DEFAULT.into(),
            },
        )
        .describing(Text::key(S_TEMPLATES_DESC))
        .grouped(Text::key(S_GROUP))
        .program_writable(),
        SettingSpec::new(
            DRAW_SUGGESTIONS_KEY,
            Text::key(S_SUGGESTIONS),
            SettingKind::Toggle { default: true },
        )
        .describing(Text::key(S_SUGGESTIONS_DESC))
        .grouped(Text::key(S_GROUP))
        .for_machine(),
    ]
}

/// Le stringhe del componente: quelle del comando, delle impostazioni, e
/// dell'export i soli errori, perché le note del log sono testo semplice come
/// quelle degli altri export.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        choice::in_italian(annotated::in_italian(annotate::in_italian(
            create::in_italian(StringCatalog::new("it")),
        )))
        .with(E_TARGET, "«{target}» non è una destinazione dei disegni.")
        .with(E_NO_DRAWINGS, "Nella selezione non c'è nessun disegno.")
        .with(
            E_NONE_EXPORTED,
            "Non ho esportato nessun disegno: «{doc}» non è riuscito ({reason}).",
        )
        .with(E_WRITE, "Non ho scritto «{path}»: {reason}")
        .with(S_GROUP, "Disegni")
        .with(S_LEVEL, "Livello d'interfaccia")
        .with(
            S_LEVEL_DESC,
            "Quali strumenti offre l'editor dei disegni. L'Essenziale ha gli \
             strumenti di base, uno per tasto; lo Standard ne aggiunge altri; \
             l'Esperto mostra anche il file sotto il disegno; il Personalizzato \
             ha le parti scelte in «Parti del Personalizzato». Cambiare livello \
             non modifica i disegni, e vale subito anche per quelli aperti.",
        )
        .with(S_ESSENTIAL, "Essenziale")
        .with(S_STANDARD, "Standard")
        .with(S_EXPERT, "Esperto")
        .with(S_CUSTOM_LEVEL, "Personalizzato")
        .with(S_CUSTOM, "Parti del Personalizzato")
        .with(
            S_CUSTOM_DESC,
            "Le parti dell'editor che il livello Personalizzato offre, una per \
             una. Valgono soltanto con quel livello, e si possono preparare \
             anche con un altro scelto.",
        )
        .with(S_TEMPLATES, "Cartella dei modelli")
        .with(
            S_TEMPLATES_DESC,
            "La cartella del vault con i disegni che «Nuovo disegno» offre come \
             modelli, sotto «Dal vault». Se non c'è, il vault non ha modelli \
             suoi: quelli di Fub restano.",
        )
        .with(S_SUGGESTIONS, "Suggerimenti brevi")
        .with(
            S_SUGGESTIONS_DESC,
            "Mostra nell'editor dei disegni brevi suggerimenti su ciò che si può \
             fare in quel momento. Si spengono anche dalla casella «Non mostrare \
             più suggerimenti» che accompagna ognuno, e valgono per questa \
             macchina.",
        ),
        choice::in_english(annotated::in_english(annotate::in_english(
            create::in_english(StringCatalog::new("en")),
        )))
        .with(E_TARGET, "«{target}» is not a drawing export destination.")
        .with(E_NO_DRAWINGS, "The selection contains no drawings.")
        .with(
            E_NONE_EXPORTED,
            "No drawing was exported: «{doc}» failed ({reason}).",
        )
        .with(E_WRITE, "Could not write «{path}»: {reason}")
        .with(S_GROUP, "Drawings")
        .with(S_LEVEL, "Interface level")
        .with(
            S_LEVEL_DESC,
            "Which tools the drawing editor offers. Essential has the basic \
             tools, one key each; Standard adds more; Expert also shows the file \
             under the drawing; Custom has the parts chosen in «Custom level \
             parts». Changing the level does not modify drawings, and takes \
             effect at once, open ones included.",
        )
        .with(S_ESSENTIAL, "Essential")
        .with(S_STANDARD, "Standard")
        .with(S_EXPERT, "Expert")
        .with(S_CUSTOM_LEVEL, "Custom")
        .with(S_CUSTOM, "Custom level parts")
        .with(
            S_CUSTOM_DESC,
            "The editor parts the Custom level offers, one by one. They only \
             apply with that level, and can be prepared while another is chosen.",
        )
        .with(S_TEMPLATES, "Templates folder")
        .with(
            S_TEMPLATES_DESC,
            "The vault folder with the drawings that «New drawing» offers as \
             templates, under «From the vault». If it does not exist, the \
             vault has no templates of its own: Fub's stay.",
        )
        .with(S_SUGGESTIONS, "Short tips")
        .with(
            S_SUGGESTIONS_DESC,
            "Shows short tips in the drawing editor about what can be done at \
             that moment. They also turn off from the «Don’t show tips again» box \
             that comes with each one, and apply to this machine.",
        ),
    ]
}

/// I provider del bundle: uno per formato dei disegni, e i due PDF delle
/// annotazioni.
pub fn exports() -> Vec<Box<dyn ExportProvider>> {
    vec![
        Box::new(PngExport),
        Box::new(JpegExport),
        Box::new(SvgExport),
        Box::new(PdfExport),
        Box::new(AnnotatedPdfExport),
        Box::new(RedactedPdfExport),
    ]
}

/// L'export in PNG: un'immagine per disegno, per tavola o per la selezione,
/// con lo sfondo trasparente come quello del disegno.
///
/// Le opzioni comuni a ogni formato sono in [`choice`]. La misura la dice
/// `scale` (numero, di serie 2, oltre 0 e al massimo 8), i pixel
/// dell'immagine per unità del disegno, o `width` (intero da 1 a 16 384), la
/// larghezza esatta in pixel. L'immagine dichiara la densità corrispondente
/// (`pHYs`), quindi incollata in un documento ha la misura del disegno e non
/// quella dei suoi pixel. Un'immagine che supererebbe 16 384 pixel di lato o
/// 32 milioni di pixel esce alla scala più grande che ci sta, e il log lo
/// dice.
#[derive(Default)]
pub struct PngExport;

/// L'export in JPEG: l'immagine del PNG posata sul bianco, con la stessa
/// misura e le stesse opzioni. Qualità 90, il colore senza sottocampionare, e
/// dei metadati solo la densità.
#[derive(Default)]
pub struct JpegExport;

/// L'export in SVG: per disegno, per tavola o per la selezione, il testo
/// derivato e ripulito per il web (`fub_scene::export::clean`). Le immagini
/// del vault restano riferimenti per percorso, e il log lo dice.
#[derive(Default)]
pub struct SvgExport;

/// L'export in PDF: un file vettoriale per disegno, una pagina della misura del
/// disegno (96 pixel CSS per pollice), con il testo selezionabile nei caratteri
/// di Fub incorporati. Le tavole sono un file solo, una pagina per tavola
/// nell'ordine del documento, ciascuna con un segnalibro col suo nome.
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
        let choice = Choice::read(&request.options)?;
        let size = raster_size(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Png,
            &choice,
            &mut |drawing, file, out, report| {
                write_raster(drawing, file, size, Format::Png, out, report)
            },
        )
    }
}

impl ExportProvider for JpegExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_JPEG.to_string(),
            name: "JPEG (one image per drawing, on white)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_JPEG)?;
        let choice = Choice::read(&request.options)?;
        let size = raster_size(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Jpeg,
            &choice,
            &mut |drawing, file, out, report| {
                write_raster(drawing, file, size, Format::Jpeg, out, report)
            },
        )
    }
}

impl ExportProvider for SvgExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_SVG.to_string(),
            name: "SVG (one clean file per drawing, for the web)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_SVG)?;
        let choice = Choice::read(&request.options)?;
        export_drawings(request, host, out, Format::Svg, &choice, &mut write_svg)
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
        let choice = Choice {
            print: print_setup(&request.options)?,
            ..Choice::read(&request.options)?
        };
        export_drawings(
            request,
            host,
            out,
            Format::Pdf,
            &choice,
            &mut |drawing, file, out, report| write_pdf(drawing, file, &choice.print, out, report),
        )
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

/// Il formato di una destinazione dei disegni.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Svg,
    Pdf,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
            Format::Svg => "svg",
            Format::Pdf => "pdf",
        }
    }

    /// Le tavole stanno in un file solo, una pagina ciascuna.
    fn has_pages(self) -> bool {
        self == Format::Pdf
    }
}

/// Com'è andato un file. `Err` del chiamante resta per ciò che ferma l'export
/// intero, cioè un sink che non accetta più byte.
enum Outcome {
    Done,
    Failed(String),
}

/// Perché i file di un disegno non si scrivono: una richiesta che non vale
/// per quel disegno ferma l'export prima di ogni file, un disegno che non si
/// legge ferma soltanto sé.
enum Problem {
    Stop(PluginError),
    Failed(String),
}

/// Una pagina di un file: il testo da cui esce, l'ambito con cui è stato
/// derivato, per una tavola il suo nome e, se il testo ha l'abbondanza di un
/// PDF intorno, la misura in pixel CSS della pagina senza.
struct Page<'b> {
    text: Cow<'b, [u8]>,
    scope: Scope,
    board: Option<String>,
    frame: Option<[f64; 2]>,
}

/// Un file da scrivere: il percorso, e le pagine, che sono una tranne nel PDF
/// delle tavole.
struct File<'b> {
    path: String,
    pages: Vec<Page<'b>>,
}

impl File<'_> {
    /// Ciò che precede la nota di un file che non è il disegno intero: il
    /// nome della tavola, quando il disegno ha più file.
    fn about(&self) -> String {
        match &self.pages[..] {
            [Page {
                board: Some(name), ..
            }] => format!("{name}: "),
            _ => String::new(),
        }
    }
}

/// Scrive un file nel formato del provider.
type Writer<'a> = dyn FnMut(
        &mut Drawing<'_>,
        &File<'_>,
        &mut dyn ArtifactSink,
        &mut ExportReport,
    ) -> Result<Outcome, PluginError>
    + 'a;

/// Il percorso comune ai formati: la selezione ridotta ai disegni, un nome
/// per ciascuno, i file di ciascuno, la scrittura, il log.
fn export_drawings(
    request: &ExportRequest,
    host: &dyn ReadApi,
    out: &mut dyn ArtifactSink,
    format: Format,
    choice: &Choice,
    write: &mut Writer<'_>,
) -> Result<ExportReport, PluginError> {
    // Il disegno è già un `.svg`: l'SVG del disegno intero, con il suo nome,
    // salvato accanto lo sovrascriverebbe. Ha la parola fra parentesi, come
    // il PDF annotato.
    let label = match (format, &choice.part) {
        (Format::Svg, Part::Drawing) => Some(annotated::suffix(&request.options, EXPORTED_SUFFIX)?),
        _ => None,
    };
    let selected = request.selection.resolve(host)?;
    let (drawings, others): (Vec<DocId>, Vec<DocId>) =
        selected.into_iter().partition(|doc| is_drawing(host, doc));
    if drawings.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_DRAWINGS)));
    }
    if choice.part != Part::Drawing && drawings.len() > 1 {
        return Err(PluginError::BadArgs(Text::message(
            E_ONE_DRAWING,
            vec![Arg::int("count", drawings.len() as i64)],
        )));
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
    // Ciò che l'export tiene ancora, per le immagini che l'SVG pulito porta
    // dentro: passa da un disegno all'altro.
    let mut room = PLUGIN_EXPORT_LIMIT;
    // I caratteri del vault, letti una volta per tutti i disegni.
    let vault_fonts = VaultFonts::default();
    for (doc, path) in drawings.iter().zip(artifact_names(
        &drawings,
        format.extension(),
        label.as_deref(),
    )) {
        let mut failed = |reason: String, report: &mut ExportReport| {
            report
                .log
                .push(TransferNote::warning(reason.clone()).about(doc.to_string()));
            first_failure.get_or_insert((doc.clone(), reason));
        };
        let bytes = match host.read_document_bytes(doc) {
            Ok(bytes) => bytes,
            Err(error) => {
                failed(error.to_string(), &mut report);
                continue;
            }
        };
        let files = match files(doc, &bytes, choice, format, path) {
            Ok(files) => files,
            Err(Problem::Stop(error)) => return Err(error),
            Err(Problem::Failed(reason)) => {
                failed(reason, &mut report);
                continue;
            }
        };
        let mut drawing = Drawing::new(host, &vault_fonts, doc, room);
        let mut done = 0usize;
        for file in &files {
            match write(&mut drawing, file, out, &mut report)? {
                Outcome::Done => done += 1,
                Outcome::Failed(reason) => failed(format!("{}{reason}", file.about()), &mut report),
            }
        }
        room = drawing.room;
        if done > 0 {
            drawing.notes(&mut report);
        }
        exported += done;
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
/// l'estensione del formato, così l'esito ripete le cartelle del vault, e con
/// `label` fra parentesi se c'è (`acqua (exported).svg`). Ciò che
/// collide (`Mare.svg` e `mare.svg`, che in una cartella che non distingue le
/// maiuscole sono un file solo) prende il numero della convenzione D3 dopo il
/// nome del disegno (`<nome> 1`, `<nome> 1 (exported)`), con la stessa chiave con cui il sink rifiuterebbe il
/// secondo ([`Names`]). I nomi si danno prima di leggere, quindi non
/// dipendono da quali disegni si lasciano leggere.
fn artifact_names(docs: &[DocId], extension: &str, label: Option<&str>) -> Vec<String> {
    let mut names = Names::default();
    docs.iter()
        .map(|doc| {
            let base = strip_ext(doc.as_str());
            names.take(|n| {
                let name = match n {
                    0 => base.clone(),
                    n => format!("{base} {n}"),
                };
                match label {
                    None => format!("{name}.{extension}"),
                    Some(label) => format!("{name} ({label}).{extension}"),
                }
            })
        })
        .collect()
}

/// Il testo di una pagina e, se ha l'abbondanza intorno, la misura della
/// pagina senza ([`Page::frame`]).
type Derived<'b> = (Cow<'b, [u8]>, Option<[f64; 2]>);

/// I file di un disegno per `choice`, con il nome `path` del disegno intero.
///
/// Il disegno intero con la carta e senza abbondanza sono i byte del
/// documento, così come sono: i file di prima. Il resto passa dalla
/// derivazione, che vuole un SVG in UTF-8; le tavole e gli oggetti chiesti
/// devono esserci tutti prima che si scriva un file.
///
/// L'abbondanza di un PDF è in millimetri sulla carta: la derivazione la
/// vuole in pixel della pagina, quindi divisa per la scala con cui la pagina
/// va sulla carta ([`print::layout`]).
fn files<'b>(
    doc: &DocId,
    bytes: &'b [u8],
    choice: &Choice,
    format: Format,
    path: String,
) -> Result<Vec<File<'b>>, Problem> {
    let whole = |(text, frame): Derived<'b>| {
        vec![File {
            path: path.clone(),
            pages: vec![Page {
                text,
                scope: Scope::Drawing,
                board: None,
                frame,
            }],
        }]
    };
    if choice.is_whole() {
        return Ok(whole((Cow::Borrowed(bytes), None)));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Problem::Failed(not_utf8()))?;
    let source = Source::read(text).map_err(|error| Problem::Failed(unreadable(&error)))?;
    let derive = |scope: &Scope| -> Result<Derived<'b>, Problem> {
        let problem = |error| derive_problem(doc, error);
        let setup = &choice.print;
        let frame = match setup.bleed > 0.0 {
            true => source.frame(scope).map_err(problem)?,
            false => None,
        };
        let bleed = frame.map_or(0.0, |[width, height]| {
            let scale = print::layout(width, height, setup).scale;
            setup.bleed * PX_PER_MM / scale
        });
        let text = source
            .derive_bled(scope, choice.background, bleed)
            .map_err(problem)?;
        Ok((Cow::Owned(text.into_bytes()), frame))
    };
    let base = strip_ext(doc.as_str());
    let extension = format.extension();
    match &choice.part {
        Part::Drawing => Ok(whole(derive(&Scope::Drawing)?)),
        Part::Selection { scope, suffix } => {
            let (text, frame) = derive(scope)?;
            Ok(vec![File {
                path: format!("{base} ({suffix}).{extension}"),
                pages: vec![Page {
                    text,
                    scope: scope.clone(),
                    board: None,
                    frame,
                }],
            }])
        }
        Part::Boards(ids) => {
            let boards = source.boards();
            if let Some(missing) = ids.iter().find(|id| !boards.iter().any(|b| &b.id == *id)) {
                return Err(derive_problem(
                    doc,
                    DeriveError::UnknownBoard(missing.clone()),
                ));
            }
            // L'ordine del documento, non quello della richiesta; il numero
            // di una tavola senza nome è la sua posizione fra tutte.
            let chosen: Vec<(usize, &Board)> = boards
                .iter()
                .enumerate()
                .filter(|(_, board)| ids.contains(&board.id))
                .map(|(at, board)| (at + 1, board))
                .collect();
            let mut pages = Vec::with_capacity(chosen.len());
            for (_, board) in &chosen {
                let scope = Scope::Board(board.id.clone());
                let (text, frame) = derive(&scope)?;
                pages.push(Page {
                    text,
                    scope,
                    board: Some(board.name.clone()),
                    frame,
                });
            }
            let mut names = Names::default();
            if format.has_pages() {
                let path = match &chosen[..] {
                    [(number, board)] => {
                        names.labelled(&base, &board_label(&board.name, *number), extension)
                    }
                    _ => format!("{base}.{extension}"),
                };
                return Ok(vec![File { path, pages }]);
            }
            Ok(chosen
                .iter()
                .zip(pages)
                .map(|((number, board), page)| File {
                    path: names.labelled(&base, &board_label(&board.name, *number), extension),
                    pages: vec![page],
                })
                .collect())
        }
    }
}

/// Ciò che una derivazione rifiutata vuol dire per l'export.
fn derive_problem(doc: &DocId, error: DeriveError) -> Problem {
    let stop =
        |key: &str, args: Vec<Arg>| Problem::Stop(PluginError::BadArgs(Text::message(key, args)));
    match error {
        DeriveError::UnknownBoard(board) => stop(
            E_BOARD,
            vec![Arg::text("doc", doc.to_string()), Arg::text("board", board)],
        ),
        DeriveError::UnknownObject(id) => stop(
            E_OBJECT,
            vec![Arg::text("doc", doc.to_string()), Arg::text("id", id)],
        ),
        // Le opzioni le hanno già controllate: qui non arrivano.
        DeriveError::EmptySelection | DeriveError::BadBox => {
            Problem::Failed("the selection has no objects or no area".to_string())
        }
        DeriveError::Read(error) => Problem::Failed(unreadable(&error)),
    }
}

fn not_utf8() -> String {
    "not a readable SVG drawing: the text is not UTF-8".to_string()
}

/// Il motivo, per il log, di un testo che la scena non legge.
fn unreadable(error: &ReadError) -> String {
    match error {
        ReadError::Malformed { offset, kind } => {
            format!("not a readable SVG drawing: malformed XML at byte {offset} ({kind:?})")
        }
        ReadError::NotSvg { offset } => format!(
            "not a readable SVG drawing: the root at byte {offset} is not an SVG svg element"
        ),
    }
}

/// Un disegno che si esporta: il titolo, le immagini del vault che le sue
/// pagine nominano, lette una volta per tutte, e ciò che la lettura ha
/// lasciato fuori.
struct Drawing<'h> {
    doc: DocId,
    title: String,
    images: VaultImages<'h>,
    /// I caratteri che le sue pagine nominano, di Fub e del vault.
    typefaces: Typefaces<'h>,
    refused: Refused,
    /// I caratteri che nessuno dei suoi caratteri ha.
    missing: BTreeSet<char>,
    /// Vero se il PDF ha chiesto l'abbondanza e il disegno intero non dice
    /// la sua misura, quindi non ne ha.
    unbled: bool,
    /// I byte che l'export tiene ancora, entro [`PLUGIN_EXPORT_LIMIT`]: l'SVG
    /// pulito ci misura le immagini che porta dentro, così un file che non
    /// ci starebbe tiene il percorso di quelle di troppo invece di fallire.
    /// La stessa regola vale con ogni host, e i file restano gli stessi.
    room: usize,
}

impl<'h> Drawing<'h> {
    fn new(host: &'h dyn ReadApi, vault_fonts: &'h VaultFonts, doc: &DocId, room: usize) -> Self {
        Drawing {
            doc: doc.clone(),
            title: title(host, doc),
            images: VaultImages::new(host, doc),
            typefaces: Typefaces::new(Some((host, vault_fonts))),
            refused: Refused::default(),
            missing: BTreeSet::new(),
            unbled: false,
            room,
        }
    }

    /// L'albero di una pagina. `Err` è il motivo, per il log: un disegno che
    /// non si legge non ferma gli altri.
    fn tree(&mut self, text: &[u8]) -> Result<Tree, String> {
        let refused = Arc::new(Mutex::new(Refused::default()));
        let tree = Tree::from_data(
            text,
            &options(&refused, Some(&self.images), &self.typefaces),
        )
        .map_err(|error| format!("not a readable SVG drawing: {error}"))?;
        self.refused.merge(std::mem::take(&mut *lock(&refused)));
        self.missing.extend(missing_glyphs(&tree));
        Ok(tree)
    }

    /// L'URI `data:` dell'immagine del vault che `href` nomina, letta come
    /// per gli altri formati: nell'SVG pulito un percorso del vault, fuori dal
    /// vault, non porterebbe a niente. `None` per ciò che non è un percorso,
    /// che resta com'è, e per un'immagine che resta fuori, che il log dice;
    /// anche per una che non sta più in `room`, i byte che il file ha ancora.
    fn embed(&mut self, href: &str, room: &mut usize) -> Option<String> {
        let path = vault_path(href)?;
        let found = self.images.image(&path).and_then(|kind| {
            data_uri(&kind)
                .filter(|uri| uri.len() <= *room)
                .ok_or(LeftOut::OverExport)
        });
        match found {
            Ok(uri) => {
                *room -= uri.len();
                Some(uri)
            }
            Err(why) => {
                let shown: String = href.chars().take(HREF_SHOWN).collect();
                self.refused.vault.entry(why).or_default().insert(shown);
                None
            }
        }
    }

    /// Le note di un disegno esportato: ciò che è rimasto fuori, i caratteri
    /// che non ci sono e quelli che mancano, e l'abbondanza che non c'è.
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
            .chain([
                embedded,
                glyphs_note(&self.missing),
                self.unbled.then(|| UNBLED_NOTE.to_string()),
            ])
            .chain(self.typefaces.notes().into_iter().map(Some));
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
        LeftOut::OverExport => {
            let limit = PLUGIN_EXPORT_LIMIT / (1024 * 1024);
            (
                format!("vault image would take the export past {limit} MiB and keeps its path"),
                format!("vault images would take the export past {limit} MiB and keep their path"),
            )
        }
    };
    listed(images, &one, &many)
}

/// La nota di un PDF senza l'abbondanza chiesta: senza `viewBox` e senza
/// `width` e `height`, il disegno non dice dove finisce.
const UNBLED_NOTE: &str =
    "the drawing has neither a viewBox nor a width and height, so its PDF has no bleed";

/// La nota dei caratteri che nessuno dei caratteri del disegno ha.
fn glyphs_note(missing: &BTreeSet<char>) -> Option<String> {
    if missing.is_empty() {
        return None;
    }
    let chars: String = missing.iter().collect();
    Some(format!(
        "characters outside the drawing's fonts are drawn as a placeholder box: {chars}"
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

impl Refused {
    /// Aggiunge ciò che ha lasciato fuori un'altra pagina dello stesso
    /// disegno. Le pagine sono lo stesso contenuto guardato in punti diversi:
    /// i riferimenti si contano una volta, e le immagini incorporate rotte
    /// quante ne ha la pagina che ne ha di più.
    fn merge(&mut self, other: Refused) {
        self.external.extend(other.external);
        self.embedded = self.embedded.max(other.embedded);
        for (why, images) in other.vault {
            self.vault.entry(why).or_default().extend(images);
        }
    }
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
/// `typefaces` sceglie i caratteri del testo ([`typefaces`]).
fn options<'a>(
    refused: &Arc<Mutex<Refused>>,
    vault: Option<&'a VaultImages<'a>>,
    typefaces: &'a Typefaces<'a>,
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
        fontdb: Arc::clone(fub_fonts()),
        font_resolver: typefaces.resolver(),
        ..usvg::Options::default()
    }
}

/// L'URI `data:` di un'immagine raster, col tipo che dicono i suoi byte.
fn data_uri(kind: &ImageKind) -> Option<String> {
    let (media_type, bytes) = match kind {
        ImageKind::PNG(bytes) => ("image/png", bytes),
        ImageKind::JPEG(bytes) => ("image/jpeg", bytes),
        ImageKind::GIF(bytes) => ("image/gif", bytes),
        ImageKind::WEBP(bytes) => ("image/webp", bytes),
        ImageKind::SVG(_) => return None,
    };
    Some(format!(
        "data:{media_type};base64,{}",
        BASE64.encode(bytes.as_slice())
    ))
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
    /// Nell'SVG pulito, i suoi byte avrebbero portato l'export oltre
    /// [`PLUGIN_EXPORT_LIMIT`]: resta il percorso.
    OverExport,
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

/// I caratteri di Fub al 400 e al 700, il peso del testo e quello del
/// grassetto, in tondo e in corsivo.
///
/// Sono gli stessi tre che l'app distribuisce (Inter, Literata e JetBrains
/// Mono, i file variabili latin di `@fontsource-variable` 5.3.0, il tondo
/// `*-latin-wght-normal.woff2` e il corsivo `*-latin-wght-italic.woff2`)
/// fissati in istanze statiche: `usvg` 0.45 non sa scegliere un punto
/// dell'asse `wght` di un carattere variabile, e con il file variabile ogni
/// peso uscirebbe come il peso di serie del file. Gli altri pesi li fissa
/// l'export stesso dai file variabili, quando servono ([`typefaces`]). Le
/// istanze sono
/// riproducibili: fontTools 4.66.1, `font =
/// instancer.instantiateVariableFont(font, {"wght": 400 | 700},
/// updateFontNames=True)` sul file caricato con `recalcTimestamp=False`, che
/// restituisce un carattere nuovo e non cambia quello che riceve, salvato come
/// TrueType. La licenza è la SIL Open Font License 1.1 di tutti e tre i
/// caratteri, in `fonts/OFL.txt` accanto ai file.
const FACES: [&[u8]; 12] = [
    include_bytes!("../fonts/inter-400.ttf"),
    include_bytes!("../fonts/inter-700.ttf"),
    include_bytes!("../fonts/inter-italic-400.ttf"),
    include_bytes!("../fonts/inter-italic-700.ttf"),
    include_bytes!("../fonts/literata-400.ttf"),
    include_bytes!("../fonts/literata-700.ttf"),
    include_bytes!("../fonts/literata-italic-400.ttf"),
    include_bytes!("../fonts/literata-italic-700.ttf"),
    include_bytes!("../fonts/jetbrains-mono-400.ttf"),
    include_bytes!("../fonts/jetbrains-mono-700.ttf"),
    include_bytes!("../fonts/jetbrains-mono-italic-400.ttf"),
    include_bytes!("../fonts/jetbrains-mono-italic-700.ttf"),
];

/// Il database dei caratteri di serie, costruito una volta per processo e
/// soltanto dai byte qui sopra: nessuna chiamata a `load_system_fonts`,
/// nessun file. Ogni albero ne ha una copia, a cui aggiunge i caratteri che
/// fissa ([`typefaces`]).
fn fub_fonts() -> &'static Arc<fontdb::Database> {
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
// PNG e JPEG
// ---------------------------------------------------------------------------

/// Scrive l'immagine di un file in PNG o in JPEG, alla misura `size`.
fn write_raster(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    size: Size,
    format: Format,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let page = &file.pages[0];
    let tree = match drawing.tree(&page.text) {
        Ok(tree) => tree,
        Err(reason) => return Ok(Outcome::Failed(reason)),
    };
    let side = tree.size();
    let measured = measure(side.width(), side.height(), size);
    let (width, height, scale) = (measured.width, measured.height, measured.scale);
    let Some(mut pixmap) = Pixmap::new(width.max(1), height.max(1)) else {
        return Ok(Outcome::Failed(format!(
            "the drawing is too large to rasterize ({width} × {height} pixels)"
        )));
    };
    if measured.reduced {
        let instead = match size {
            Size::Scale(asked) => format!("at scale {scale:.2} instead of {asked}"),
            Size::Pixels(asked) => format!("{width} pixels wide instead of {asked}"),
        };
        let what = match size {
            Size::Scale(_) => "scale",
            Size::Pixels(_) => "width",
        };
        report.log.push(
            TransferNote::warning(format!(
                "{}exported {instead}: at the requested {what} the image would exceed {SIDE_MAX} pixels per side or {} million pixels",
                file.about(),
                AREA_MAX / 1_048_576,
            ))
            .about(drawing.doc.to_string()),
        );
    }
    resvg::render(
        &tree,
        Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    drop(tree);

    match format {
        Format::Jpeg => deliver(out, &file.path, "image/jpeg", report, |sink| {
            encode_jpeg(&pixmap, scale, sink)
        })?,
        _ => deliver(out, &file.path, "image/png", report, |sink| {
            encode_png(&pixmap, scale, &drawing.title, sink)
        })?,
    }
    Ok(Outcome::Done)
}

/// Apre l'artefatto `path`, ci scrive quello che `encode` scrive, e lo
/// consegna. L'errore del sink resta il suo; quello dell'encoder è un
/// [`E_WRITE`].
fn deliver<E: std::fmt::Display>(
    out: &mut dyn ArtifactSink,
    path: &str,
    media_type: &str,
    report: &mut ExportReport,
    encode: impl FnOnce(&mut SinkWriter<'_>) -> Result<(), E>,
) -> Result<(), PluginError> {
    let handle = out.open_artifact(path, media_type)?;
    let mut sink = SinkWriter {
        out,
        handle,
        failure: None,
    };
    let encoded = encode(&mut sink);
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
    Ok(())
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

/// Scrive il JPEG dritto nel sink. L'encoder di `image` legge i pixel a
/// blocchi di 8 × 8 da [`OnWhite`], quindi l'immagine sul bianco non si
/// copia; scrive il colore senza sottocampionarlo (4:4:4), e dei segmenti
/// facoltativi soltanto il JFIF con la densità.
fn encode_jpeg(pixmap: &Pixmap, scale: f32, sink: &mut SinkWriter<'_>) -> Result<(), String> {
    let mut buffered = BufWriter::with_capacity(CHUNK, sink);
    let mut encoder = JpegEncoder::new_with_quality(&mut buffered, JPEG_QUALITY);
    // I punti per pollice: `scale` pixel per pixel CSS. Il JFIF li scrive
    // interi; una densità che non ci sta resta non detta, che è meglio di una
    // sbagliata.
    let dpi = (CSS_DPI * scale).round();
    if (1.0..=f32::from(u16::MAX)).contains(&dpi) {
        encoder.set_pixel_density(PixelDensity::dpi(dpi as u16));
    }
    encoder
        .encode_image(&OnWhite(pixmap))
        .map_err(|error| error.to_string())?;
    buffered.flush().map_err(|error| error.to_string())
}

/// La pixmap posata sul bianco, come `image` legge un'immagine: ciò che è
/// trasparente diventa bianco, ciò che è velato si schiarisce.
struct OnWhite<'p>(&'p Pixmap);

impl GenericImageView for OnWhite<'_> {
    type Pixel = Rgb<u8>;

    fn dimensions(&self) -> (u32, u32) {
        (self.0.width(), self.0.height())
    }

    fn get_pixel(&self, x: u32, y: u32) -> Rgb<u8> {
        // Premoltiplicato, il colore sopra il bianco è `c + (255 - a)`: un
        // canale non supera mai la sua alfa, quindi la somma sta in un byte.
        let pixel = self
            .0
            .pixel(x, y)
            .expect("l'encoder legge dentro l'immagine");
        let white = 255 - pixel.alpha();
        Rgb([
            pixel.red().saturating_add(white),
            pixel.green().saturating_add(white),
            pixel.blue().saturating_add(white),
        ])
    }
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
// SVG
// ---------------------------------------------------------------------------

fn write_svg(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let page = &file.pages[0];
    let Ok(text) = std::str::from_utf8(&page.text) else {
        return Ok(Outcome::Failed(not_utf8()));
    };
    let cleaned = match clean(text, &page.scope) {
        Ok(cleaned) => cleaned,
        Err(error) => return Ok(Outcome::Failed(unreadable(&error))),
    };
    // Il testo c'è comunque; le immagini, finché il file ci sta.
    let mut room = drawing.room.saturating_sub(cleaned.len());
    let cleaned = match embed_images(&cleaned, |href| drawing.embed(href, &mut room)) {
        Ok(embedded) => embedded,
        Err(error) => return Ok(Outcome::Failed(unreadable(&error))),
    };
    let handle = out.open_artifact(&file.path, "image/svg+xml")?;
    for piece in cleaned.as_bytes().chunks(CHUNK) {
        out.write_artifact(handle, piece)?;
    }
    report.artifacts.push(out.close_artifact(handle)?);
    drawing.room = drawing.room.saturating_sub(cleaned.len());
    Ok(Outcome::Done)
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/// Il PDF di `file`, una pagina per pagina, sulla pagina di stampa `setup`.
///
/// La rifilatura di una pagina è il rettangolo da tagliare, a scala 1 la
/// misura del suo albero; con l'abbondanza l'albero è più grande, e la
/// rifilatura è la misura della pagina senza ([`Page::frame`]). Il disegno va
/// sulla carta con la scala della pagina di stampa, e gli effetti che
/// `svg2pdf` dipinge restano a 300 punti per pollice sulla carta.
fn write_pdf(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    setup: &Setup,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let failed = |error: String| {
        Ok(Outcome::Failed(format!(
            "the drawing could not be converted to PDF: {error}"
        )))
    };
    // Una pagina alla volta: l'albero di una tavola se ne va appena il suo
    // pezzo di PDF è scritto.
    let mut pages = Vec::with_capacity(file.pages.len());
    for page in &file.pages {
        let tree = match drawing.tree(&page.text) {
            Ok(tree) => tree,
            Err(reason) => return Ok(Outcome::Failed(reason)),
        };
        let size = tree.size();
        let drawn = [f64::from(size.width()), f64::from(size.height())];
        let (trim, bleed) = match page.frame {
            Some(frame) => (frame, setup.bleed),
            None => {
                drawing.unbled |= setup.bleed > 0.0;
                (drawn, 0.0)
            }
        };
        let setup = Setup { bleed, ..*setup };
        let sheet = print::layout(trim[0], trim[1], &setup);
        let units_per_inch = CSS_DPI / sheet.scale as f32;
        let mut options = pdf::options(&tree, units_per_inch);
        // Il testo di un carattere che non si lascia incorporare va a
        // tracciati, con quello di tutta la pagina.
        let outlined = typefaces::restricted(&tree);
        if !outlined.is_empty() {
            options.embed_text = false;
            drawing.typefaces.outlined(outlined);
        }
        let (chunk, root) = match svg2pdf::to_chunk(&tree, options) {
            Ok(converted) => converted,
            Err(error) => return failed(error.to_string()),
        };
        let placed = (!setup.is_plain()).then(|| pdf::Print::new(sheet, drawn, trim, setup.marks));
        match pdf::Page::read(
            chunk.as_bytes(),
            root.get(),
            size.width(),
            size.height(),
            placed,
            page.board.clone(),
        ) {
            Ok(read) => pages.push(read),
            Err(error) => return failed(error),
        }
    }
    let document = match pdf::document(pages, &drawing.title) {
        Ok(document) => document,
        Err(error) => return failed(error),
    };
    let handle = out.open_artifact(&file.path, "application/pdf")?;
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
    //! pagina della misura del disegno, i metadati. Le tavole sono un pezzo
    //! per pagina, nello stesso file, con un segnalibro ciascuna; ciò che i
    //! pezzi hanno uguale si scrive una volta.
    //!
    //! Una pagina di stampa ([`Print`]) è la carta, con il disegno al suo
    //! posto, i riquadri della rifilatura e dell'abbondanza (`/TrimBox`,
    //! `/BleedBox`) e i segni nel colore di registro, che inchiostra ogni
    //! lastra (`/Separation /All`); il catalogo chiede allora di stampare
    //! senza adattare la pagina e di scegliere il cassetto dalla sua misura.

    use std::collections::{BTreeMap, VecDeque};

    use fub_scene::export::print::{self, MarkShapes, Marks, Sheet, MARK_WEIGHT_PT};
    use resvg::usvg::{Group, Node, Transform, Tree};

    /// Il lato più lungo di una pagina in unità PDF: oltre, i lettori la
    /// tagliano, e la pagina dichiara un'unità più grande (`UserUnit`).
    const PAGE_MAX: f64 = 14_400.0;
    /// Punti per pixel CSS: 72 per pollice contro 96.
    const PT_PER_PX: f64 = 0.75;
    /// Quanto possono annidarsi dizionari e array: `pdf-writer` ne scrive
    /// pochi livelli, e un pezzo che ne avesse di più non è suo.
    const DEPTH_MAX: usize = 64;
    /// La risoluzione, in punti per pollice sulla pagina, degli effetti che
    /// il PDF non sa disegnare, come le ombre e le sfocature: `svg2pdf` li
    /// dipinge in un'immagine, e 300 è quella della stampa.
    const EFFECTS_DPI: f32 = 300.0;
    /// I pixel più grandi di un effetto dipinto: 4096 × 4096, 64 MB in
    /// memoria. Se a [`EFFECTS_DPI`] un effetto ne avesse di più, la pagina
    /// li dipinge tutti a una risoluzione più bassa, e l'export si fa.
    const EFFECT_PIXELS_MAX: f32 = 16_777_216.0;

    /// Le opzioni di `svg2pdf` per `tree`, che ha `units_per_inch` unità per
    /// pollice: 96 un disegno, 72 le annotazioni di un PDF. `svg2pdf` dipinge
    /// ogni gruppo con un filtro in un'immagine grande quanto la regione del
    /// filtro, nelle coordinate di chi lo contiene, per `raster_scale`; una
    /// scala sola vale per tutta la pagina, e si sceglie perché ogni effetto
    /// abbia almeno [`EFFECTS_DPI`], anche dentro un gruppo ingrandito, finché
    /// il più grande sta in [`EFFECT_PIXELS_MAX`].
    pub(super) fn options(tree: &Tree, units_per_inch: f32) -> svg2pdf::ConversionOptions {
        let base = EFFECTS_DPI / units_per_inch;
        let mut effects = Effects::default();
        effects.visit(tree.root(), Transform::default());
        let wanted = if effects.magnified > 0.0 {
            base * effects.magnified
        } else {
            base
        };
        let largest = effects.area * wanted * wanted;
        svg2pdf::ConversionOptions {
            raster_scale: if largest > EFFECT_PIXELS_MAX {
                (EFFECT_PIXELS_MAX / effects.area).sqrt()
            } else {
                wanted
            },
            ..svg2pdf::ConversionOptions::default()
        }
    }

    /// Ciò che conta dei filtri di un albero per la scala delle immagini.
    #[derive(Default)]
    struct Effects {
        /// Quanto chi contiene un filtro lo ingrandisce sulla pagina, al
        /// più: 0 senza filtri.
        magnified: f32,
        /// L'area più grande di una regione di filtro, nelle coordinate in
        /// cui `svg2pdf` la dipinge.
        area: f32,
    }

    impl Effects {
        /// Visita `group`, che sta in coordinate che `outer` porta sulla
        /// pagina. Un filtro dentro un filtro si dipinge col primo, e conta
        /// soltanto per eccesso.
        fn visit(&mut self, group: &Group, outer: Transform) {
            if !group.filters().is_empty() {
                if let Some(region) = group.layer_bounding_box().transform(group.transform()) {
                    self.area = self.area.max(region.width() * region.height());
                }
                self.magnified = self.magnified.max(stretch(outer));
            }
            let inner = outer.pre_concat(group.transform());
            for node in group.children() {
                if let Node::Group(child) = node {
                    self.visit(child, inner);
                }
            }
        }
    }

    /// Quanto `transform` allunga al più un segmento: la più lunga delle
    /// immagini dei due assi, che per una rotazione e una scala è esatta.
    fn stretch(transform: Transform) -> f32 {
        let x = transform.sx.hypot(transform.ky);
        let y = transform.kx.hypot(transform.sy);
        x.max(y)
    }

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

    /// Una pagina di stampa, in punti con l'origine in alto a sinistra: la
    /// carta con la rifilatura e l'abbondanza, il rettangolo del disegno, che
    /// la rifilatura taglia, e i segni.
    pub(super) struct Print {
        sheet: Sheet,
        drawing: [f64; 4],
        marks: MarkShapes,
    }

    impl Print {
        /// La pagina `sheet` per un disegno di `drawn` pixel CSS, la misura
        /// dell'albero, la cui rifilatura ne misura `trim`: ciò che avanza è
        /// l'abbondanza, metà per lato.
        pub(super) fn new(sheet: Sheet, drawn: [f64; 2], trim: [f64; 2], marks: Marks) -> Print {
            let points = PT_PER_PX * sheet.scale;
            let outset = [(drawn[0] - trim[0]) / 2.0, (drawn[1] - trim[1]) / 2.0];
            Print {
                drawing: [
                    sheet.trim[0] - outset[0] * points,
                    sheet.trim[1] - outset[1] * points,
                    drawn[0] * points,
                    drawn[1] * points,
                ],
                marks: print::mark_shapes(&sheet, marks),
                sheet,
            }
        }
    }

    /// Una pagina da scrivere: gli oggetti del pezzo di `svg2pdf`, il suo
    /// XObject, la misura del disegno in pixel CSS, la pagina di stampa se
    /// non è quella di sempre e, per una tavola, il segnalibro.
    pub(super) struct Page {
        objects: Vec<Object>,
        root: u32,
        width: f32,
        height: f32,
        print: Option<Print>,
        bookmark: Option<String>,
    }

    impl Page {
        /// Rilegge il pezzo `chunk`, con la radice `root`.
        pub(super) fn read(
            chunk: &[u8],
            root: i32,
            width: f32,
            height: f32,
            print: Option<Print>,
            bookmark: Option<String>,
        ) -> Result<Page, String> {
            let root = u32::try_from(root).map_err(|_| "invalid root object".to_string())?;
            Ok(Page {
                objects: parse(chunk)?,
                root,
                width,
                height,
                print,
                bookmark,
            })
        }
    }

    /// Il file: il catalogo, l'albero delle pagine, ogni pagina col suo
    /// contenuto, i metadati, i segnalibri se le pagine ne hanno, e il
    /// disegno di ogni pagina.
    ///
    /// I numeri degli oggetti sono fissi: 1 il catalogo, 2 le pagine, poi
    /// pagina e contenuto di ciascuna, i metadati, la radice dei segnalibri e
    /// un segnalibro per pagina, e dopo il disegno. Con una pagina senza
    /// segnalibro, cioè il disegno intero o la selezione, è il file di una
    /// pagina di sempre: catalogo, pagine, pagina, contenuto, metadati, e il
    /// disegno dal 6.
    pub(super) fn document(mut pages: Vec<Page>, title: &str) -> Result<Vec<u8>, String> {
        if pages.is_empty() {
            return Err("a document without pages".to_string());
        }
        let count = pages.len() as u32;
        let page_id = |at: u32| 3 + 2 * at;
        let info = 3 + 2 * count;
        let marked: Vec<(u32, String)> = pages
            .iter_mut()
            .enumerate()
            .filter_map(|(at, page)| Some((at as u32, page.bookmark.take()?)))
            .collect();
        let outlines = (!marked.is_empty()).then_some(info + 1);
        let first = match outlines {
            Some(outlines) => outlines + 1 + marked.len() as u32,
            None => info + 1,
        };

        let sizes: Vec<(f32, f32, Option<Print>)> = pages
            .iter_mut()
            .map(|page| (page.width, page.height, page.print.take()))
            .collect();
        let (drawing, roots) = drawings(pages, first)?;

        let mut preferences = vec![(name("DisplayDocTitle"), raw("true"))];
        if sizes.iter().any(|(_, _, print)| print.is_some()) {
            // La carta è già quella giusta: la stampa non la adatta, e il
            // cassetto si sceglie dalla sua misura.
            preferences.push((name("PickTrayByPDFSize"), raw("true")));
            preferences.push((name("PrintScaling"), raw("/None")));
        }
        let mut catalog = vec![
            (name("Type"), raw("/Catalog")),
            (name("Pages"), Value::Ref(2)),
            (name("ViewerPreferences"), Value::Dict(preferences)),
        ];
        if let Some(outlines) = outlines {
            catalog.push((name("Outlines"), Value::Ref(outlines)));
            catalog.push((name("PageMode"), raw("/UseOutlines")));
        }
        let mut objects = vec![
            Object {
                id: 1,
                value: Value::Dict(catalog),
                stream: None,
            },
            Object {
                id: 2,
                value: Value::Dict(vec![
                    (name("Type"), raw("/Pages")),
                    (
                        name("Kids"),
                        Value::Array((0..count).map(|at| Value::Ref(page_id(at))).collect()),
                    ),
                    (name("Count"), raw(&count.to_string())),
                ]),
                stream: None,
            },
        ];
        for (at, ((width, height, print), root)) in (0..count).zip(sizes.into_iter().zip(roots)) {
            let (page, content) = match print {
                None => page(width, height, page_id(at) + 1, root),
                Some(print) => print_page(&print, page_id(at) + 1, root),
            };
            objects.push(Object {
                id: page_id(at),
                value: page,
                stream: None,
            });
            objects.push(Object {
                id: page_id(at) + 1,
                value: Value::Dict(Vec::new()),
                stream: Some(content),
            });
        }
        objects.push(Object {
            id: info,
            value: Value::Dict(vec![
                (name("Title"), Value::Raw(text_string(title))),
                (name("Producer"), raw("(Fub)")),
            ]),
            stream: None,
        });
        if let Some(outlines) = outlines {
            let item = |at: usize| outlines + 1 + at as u32;
            objects.push(Object {
                id: outlines,
                value: Value::Dict(vec![
                    (name("Type"), raw("/Outlines")),
                    (name("First"), Value::Ref(item(0))),
                    (name("Last"), Value::Ref(item(marked.len() - 1))),
                    (name("Count"), raw(&marked.len().to_string())),
                ]),
                stream: None,
            });
            for (at, (page, bookmark)) in marked.iter().enumerate() {
                let mut entries = vec![
                    (name("Title"), Value::Raw(text_string(bookmark))),
                    (name("Parent"), Value::Ref(outlines)),
                ];
                if at > 0 {
                    entries.push((name("Prev"), Value::Ref(item(at - 1))));
                }
                if at + 1 < marked.len() {
                    entries.push((name("Next"), Value::Ref(item(at + 1))));
                }
                entries.push((
                    name("Dest"),
                    Value::Array(vec![Value::Ref(page_id(*page)), raw("/Fit")]),
                ));
                objects.push(Object {
                    id: item(at),
                    value: Value::Dict(entries),
                    stream: None,
                });
            }
        }
        objects.extend(drawing);
        Ok(file(&objects, &format!("/Info {info} 0 R /Root 1 0 R")))
    }

    /// Una pagina della misura del disegno, `width` × `height` pixel CSS, che
    /// mostra l'XObject `drawing`, e il suo contenuto, l'oggetto `content`.
    fn page(width: f32, height: f32, content: u32, drawing: u32) -> (Value, Vec<u8>) {
        // In `f64`: le cifre che si scrivono sono quattro dopo la virgola, e su
        // un lato di 14 400 punti un `f32` ne ha già perse.
        let (width, height) = (f64::from(width) * PT_PER_PX, f64::from(height) * PT_PER_PX);
        let unit = user_unit(width.max(height));
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
                        Value::Dict(vec![(name("D"), Value::Ref(drawing))]),
                    ),
                    (
                        name("ProcSet"),
                        Value::Array(vec![raw("/PDF"), raw("/ImageC"), raw("/ImageB")]),
                    ),
                ]),
            ),
            (name("Contents"), Value::Ref(content)),
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
        (Value::Dict(page), content)
    }

    /// L'unità di una pagina il cui lato più lungo misura `side` punti: 1, o
    /// quella che la porta dentro [`PAGE_MAX`]. Si arrotonda per eccesso alla
    /// cifra che si scrive: così la pagina resta dentro il lato massimo anche
    /// dopo l'arrotondamento.
    fn user_unit(side: f64) -> f64 {
        ((side / PAGE_MAX * 10_000.0).ceil() / 10_000.0).max(1.0)
    }

    /// Il tratto dei quattro archi di Bézier con cui si disegna un cerchio:
    /// 4 (√2 − 1) / 3 del raggio.
    const KAPPA: f64 = 0.552_284_749_830_793_6;

    /// Una pagina di stampa, che mostra l'XObject `drawing` al suo posto, e
    /// il suo contenuto, l'oggetto `content`: il disegno, e poi i segni.
    fn print_page(print: &Print, content: u32, drawing: u32) -> (Value, Vec<u8>) {
        let sheet = &print.sheet;
        let unit = user_unit(sheet.width.max(sheet.height));
        // Dai punti con l'origine in alto a sinistra alle unità della pagina,
        // con l'origine in basso a sinistra.
        let x = |x: f64| x / unit;
        let y = |y: f64| (sheet.height - y) / unit;
        let n = |value: f64| text(number(value));
        let rect = |left: f64, top: f64, right: f64, bottom: f64| {
            Value::Array(vec![
                number(x(left)),
                number(y(bottom)),
                number(x(right)),
                number(y(top)),
            ])
        };
        let [left, top, width, height] = sheet.trim;
        let (right, bottom) = (left + width, top + height);
        let bleed = sheet.bleed;

        let mut resources = vec![
            (
                name("XObject"),
                Value::Dict(vec![(name("D"), Value::Ref(drawing))]),
            ),
            (
                name("ProcSet"),
                Value::Array(vec![raw("/PDF"), raw("/ImageC"), raw("/ImageB")]),
            ),
        ];
        let marked = !print.marks.lines.is_empty();
        if marked {
            // Il colore di registro: inchiostra ogni lastra, e chi non separa
            // lo mostra col nero di tutti e quattro gli inchiostri.
            resources.push((
                name("ColorSpace"),
                Value::Dict(vec![(
                    name("R"),
                    Value::Array(vec![
                        raw("/Separation"),
                        raw("/All"),
                        raw("/DeviceCMYK"),
                        Value::Dict(vec![
                            (name("C0"), Value::Array(vec![raw("0"); 4])),
                            (name("C1"), Value::Array(vec![raw("1"); 4])),
                            (name("Domain"), Value::Array(vec![raw("0"), raw("1")])),
                            (name("FunctionType"), raw("2")),
                            (name("N"), raw("1")),
                        ]),
                    ]),
                )]),
            ));
        }
        let mut page = vec![
            (name("Type"), raw("/Page")),
            (name("Parent"), Value::Ref(2)),
            (
                name("MediaBox"),
                Value::Array(vec![
                    raw("0"),
                    raw("0"),
                    number(sheet.width / unit),
                    number(sheet.height / unit),
                ]),
            ),
            (
                name("BleedBox"),
                rect(
                    (left - bleed).max(0.0),
                    (top - bleed).max(0.0),
                    (right + bleed).min(sheet.width),
                    (bottom + bleed).min(sheet.height),
                ),
            ),
            (name("TrimBox"), rect(left, top, right, bottom)),
            (name("Resources"), Value::Dict(resources)),
            (name("Contents"), Value::Ref(content)),
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

        let [dx, dy, dw, dh] = print.drawing;
        let mut content = format!(
            "q {} 0 0 {} {} {} cm /D Do Q",
            n(dw / unit),
            n(dh / unit),
            n(x(dx)),
            n(y(dy + dh))
        );
        if marked {
            content.push_str(&format!("\nq /R CS 1 SCN {} w", n(MARK_WEIGHT_PT / unit)));
            for &[x1, y1, x2, y2] in &print.marks.lines {
                content.push_str(&format!(
                    "\n{} {} m {} {} l S",
                    n(x(x1)),
                    n(y(y1)),
                    n(x(x2)),
                    n(y(y2))
                ));
            }
            for &[cx, cy, r] in &print.marks.circles {
                let (cx, cy, r) = (x(cx), y(cy), r / unit);
                let k = KAPPA * r;
                content.push_str(&format!(
                    "\n{} {} m {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c S",
                    n(cx + r), n(cy),
                    n(cx + r), n(cy + k), n(cx + k), n(cy + r), n(cx), n(cy + r),
                    n(cx - k), n(cy + r), n(cx - r), n(cy + k), n(cx - r), n(cy),
                    n(cx - r), n(cy - k), n(cx - k), n(cy - r), n(cx), n(cy - r),
                    n(cx + k), n(cy - r), n(cx + r), n(cy - k), n(cx + r), n(cy),
                ));
            }
            content.push_str("\nQ");
        }
        (Value::Dict(page), content.into_bytes())
    }

    /// Gli oggetti dei disegni delle pagine in forma canonica, numerati da
    /// `first`, e il numero dell'XObject di ogni pagina.
    ///
    /// Un disegno solo è il pezzo di `svg2pdf` rinumerato. Con più pagine, ciò
    /// che due pagine hanno uguale si scrive una volta ([`merge_equal`]): le
    /// tavole sono lo stesso disegno guardato in punti diversi, e ogni pezzo
    /// porta le stesse immagini e spesso gli stessi caratteri.
    fn drawings(pages: Vec<Page>, first: u32) -> Result<(Vec<Object>, Vec<u32>), String> {
        if let [_] = &pages[..] {
            let page = pages.into_iter().next().expect("una pagina");
            return Ok((canonical(page.objects, page.root, first)?, vec![first]));
        }
        // Prima ogni pezzo per sé, con numeri che non si toccano.
        let mut all = Vec::new();
        let mut roots = Vec::with_capacity(pages.len());
        let mut next = first;
        for page in pages {
            let objects = canonical(page.objects, page.root, next)?;
            roots.push(next);
            next = next
                .checked_add(objects.len() as u32)
                .ok_or_else(|| "too many objects".to_string())?;
            all.extend(objects);
        }
        let all = merge_equal(all, &mut roots);
        canonical_from(all, &roots, first)
    }

    /// Unisce gli oggetti uguali: lo stesso valore, una volta che i
    /// riferimenti puntano agli oggetti già uniti, e lo stesso flusso. Si
    /// ripete finché c'è qualcosa da unire, perché due oggetti diventano
    /// uguali quando lo diventano quelli a cui puntano. `roots` passano agli
    /// oggetti che restano.
    fn merge_equal(objects: Vec<Object>, roots: &mut [u32]) -> Vec<Object> {
        use sha2::{Digest, Sha256};
        use std::collections::hash_map::{Entry, HashMap};

        let digests: BTreeMap<u32, [u8; 32]> = objects
            .iter()
            .filter_map(|object| Some((object.id, Sha256::digest(object.stream.as_ref()?).into())))
            .collect();
        let mut alias: BTreeMap<u32, u32> = BTreeMap::new();
        let resolve = |alias: &BTreeMap<u32, u32>, mut id: u32| {
            while let Some(&to) = alias.get(&id) {
                id = to;
            }
            id
        };
        let mut objects = objects;
        loop {
            let mut seen: HashMap<(Vec<u8>, Option<[u8; 32]>), u32> = HashMap::new();
            let mut kept = Vec::with_capacity(objects.len());
            let before = alias.len();
            for mut object in objects {
                redirect(&mut object.value, &|id| resolve(&alias, id));
                let mut key = Vec::new();
                write_value(&object.value, &mut key);
                let digest = digests.get(&object.id).copied();
                match seen.entry((key, digest)) {
                    Entry::Occupied(twin) => {
                        alias.insert(object.id, *twin.get());
                    }
                    Entry::Vacant(free) => {
                        free.insert(object.id);
                        kept.push(object);
                    }
                }
            }
            objects = kept;
            if alias.len() == before {
                break;
            }
        }
        for root in roots.iter_mut() {
            *root = resolve(&alias, *root);
        }
        objects
    }

    fn redirect(value: &mut Value, to: &dyn Fn(u32) -> u32) {
        match value {
            Value::Ref(id) => *id = to(*id),
            Value::Dict(entries) => entries
                .iter_mut()
                .for_each(|(_, value)| redirect(value, to)),
            Value::Array(items) => items.iter_mut().for_each(|value| redirect(value, to)),
            Value::Raw(_) => {}
        }
    }

    fn name(key: &str) -> Vec<u8> {
        format!("/{key}").into_bytes()
    }

    fn raw(token: &str) -> Value {
        Value::Raw(token.as_bytes().to_vec())
    }

    /// Un numero come lo scrive un PDF: senza esponente, con al massimo
    /// quattro decimali, senza zeri in coda e senza il segno davanti a uno
    /// zero.
    fn number(value: f64) -> Value {
        let mut text = format!("{value:.4}");
        while text.contains('.') && (text.ends_with('0') || text.ends_with('.')) {
            text.pop();
        }
        if text == "-0" {
            text.remove(0);
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
        canonical_from(objects, &[root], first).map(|(objects, _)| objects)
    }

    /// Come [`canonical`], dalle radici `roots` nel loro ordine; dà anche i
    /// numeri nuovi delle radici.
    fn canonical_from(
        objects: Vec<Object>,
        roots: &[u32],
        first: u32,
    ) -> Result<(Vec<Object>, Vec<u32>), String> {
        let mut by_id = BTreeMap::new();
        for mut object in objects {
            sort_keys(&mut object.value);
            if by_id.insert(object.id, object).is_some() {
                return Err("an object number is used twice".to_string());
            }
        }
        let mut map = BTreeMap::new();
        let mut queue = VecDeque::new();
        for &root in roots {
            if !map.contains_key(&root) {
                map.insert(root, first + map.len() as u32);
                queue.push_back(root);
            }
        }
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
        let objects = order
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .map(|mut object| {
                object.id = map[&object.id];
                renumber(&mut object.value, &map);
                object
            })
            .collect();
        Ok((objects, roots.iter().map(|root| map[root]).collect()))
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

    /// Un testo come lo legge chi guarda, nella lingua data.
    fn said(text: &Text, language: &str) -> String {
        let catalogs = catalog();
        let locale = fub_abi::locale::Locale {
            language: language.to_string(),
            ..fub_abi::locale::Locale::default()
        };
        fub_abi::text::Strings::new(&catalogs, "it", &locale).render(text)
    }

    #[test]
    fn the_settings_are_four_in_one_group_with_their_defaults() {
        use fub_abi::settings::{SettingScope, SettingValue};
        let specs = settings();
        let keys: Vec<_> = specs.iter().map(|spec| spec.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "draw.level",
                "draw.custom",
                "draw.templates",
                "draw.suggestions"
            ]
        );
        assert_eq!(
            keys,
            [
                DRAW_LEVEL_KEY,
                DRAW_CUSTOM_KEY,
                DRAW_TEMPLATES_KEY,
                DRAW_SUGGESTIONS_KEY
            ]
        );
        // Il vault, tranne i suggerimenti, che sono di chi usa la macchina.
        let scopes: Vec<_> = specs.iter().map(|spec| spec.scope).collect();
        assert_eq!(
            scopes,
            [
                SettingScope::Vault,
                SettingScope::Vault,
                SettingScope::Vault,
                SettingScope::Machine
            ]
        );
        // Un componente non alza il livello, non sceglie le parti e non spegne
        // i suggerimenti da sé: soltanto la cartella dei modelli è di tutti.
        let writable: Vec<_> = specs.iter().map(|spec| spec.program_writable).collect();
        assert_eq!(writable, [false, false, true, false]);

        let defaults: Vec<_> = specs.iter().map(|spec| spec.kind.default_value()).collect();
        assert_eq!(
            defaults,
            [
                SettingValue::Text("essential".into()),
                SettingValue::List(
                    ["pen", "eraser", "rect", "ellipse", "line", "arrow"]
                        .map(String::from)
                        .to_vec()
                ),
                SettingValue::Text("Templates".into()),
                SettingValue::Toggle(true),
            ]
        );
        let SettingKind::Choice { options, .. } = &specs[0].kind else {
            panic!("il livello è una scelta")
        };
        let levels: Vec<_> = options.iter().map(|option| option.value.as_str()).collect();
        assert_eq!(levels, DRAW_LEVELS);
        assert_eq!(levels, ["essential", "standard", "expert", "custom"]);
        let labels = |language| -> Vec<String> {
            options
                .iter()
                .map(|option| said(&option.label, language))
                .collect()
        };
        assert_eq!(
            labels("it"),
            ["Essenziale", "Standard", "Esperto", "Personalizzato"]
        );
        assert_eq!(labels("en"), ["Essential", "Standard", "Expert", "Custom"]);

        // Tutte nel gruppo «Disegni», con etichetta e descrizione scritte in
        // entrambe le lingue (una chiave senza voce si leggerebbe nuda).
        for spec in &specs {
            for (language, group) in [("it", "Disegni"), ("en", "Drawings")] {
                assert_eq!(said(&spec.group, language), group, "{}", spec.key);
                for text in [&spec.label, &spec.description] {
                    let line = said(text, language);
                    assert!(
                        !line.is_empty() && !line.starts_with("s_"),
                        "{} in {language}: «{line}»",
                        spec.key
                    );
                }
            }
        }
        assert_eq!(said(&specs[0].label, "it"), "Livello d'interfaccia");
        assert_eq!(said(&specs[1].label, "it"), "Parti del Personalizzato");
        assert_eq!(said(&specs[2].label, "it"), "Cartella dei modelli");
        // L'interruttore dei suggerimenti parla come l'editor: stessa parola
        // nell'etichetta e nella descrizione, e il nome della casella è
        // quello che l'editor mostra (apostrofo tipografico nell'inglese).
        assert_eq!(said(&specs[3].label, "it"), "Suggerimenti brevi");
        assert_eq!(said(&specs[3].label, "en"), "Short tips");
        let it = said(&specs[3].description, "it");
        let en = said(&specs[3].description, "en");
        assert!(it.contains("suggerimenti"), "{it}");
        assert!(it.contains("«Non mostrare più suggerimenti»"), "{it}");
        assert!(en.contains("tips"), "{en}");
        assert!(en.contains("«Don’t show tips again»"), "{en}");
        assert!(!en.to_lowercase().contains("hint"), "{en}");
    }

    #[test]
    fn the_suggestions_toggle_takes_a_toggle_and_nothing_else() {
        use fub_abi::settings::SettingValue;
        let specs = settings();
        let kind = &specs[3].kind;
        assert!(kind.rejects(&SettingValue::Toggle(false)).is_none());
        assert!(kind.rejects(&SettingValue::Toggle(true)).is_none());
        assert!(kind.rejects(&SettingValue::Text("no".into())).is_some());
        // Il livello ammette i quattro nomi e nessun altro.
        let level = &specs[0].kind;
        for name in DRAW_LEVELS {
            assert!(level.rejects(&SettingValue::Text(name.into())).is_none());
        }
        assert!(level
            .rejects(&SettingValue::Text("master".into()))
            .is_some());
    }

    #[test]
    fn the_font_database_holds_fubs_faces_and_nothing_else() {
        let db = fub_fonts();
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

        // Ogni famiglia ha i suoi due pesi, in tondo e in corsivo.
        let families = [SANS, SERIF, MONO];
        let styles = [fontdb::Style::Normal, fontdb::Style::Italic];
        for (family, style) in families
            .into_iter()
            .flat_map(|family| styles.map(|style| (family, style)))
        {
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
        let scale = |width: f32, height: f32| measure(width, height, Size::Scale(2.0)).scale;
        assert_eq!(scale(400.0, 250.0), 2.0);
        // 8192 × 4096 è proprio l'area massima: ci sta a scala 2, il doppio no.
        assert_eq!(scale(4096.0, 2048.0), 2.0);
        assert_eq!(scale(8192.0, 4096.0), 1.0);
        let (side_max, area_max) = (SIDE_MAX as f32, AREA_MAX as f32);
        for (width, height) in [(40_000.0, 10.0), (10.0, 40_000.0), (10_000.0, 10_000.0)] {
            let scale = scale(width, height);
            let (w, h) = ((width * scale).ceil(), (height * scale).ceil());
            assert!(
                w <= side_max && h <= side_max && w * h <= area_max,
                "{w}×{h}"
            );
            // Ridotta, ma non più del necessario.
            let side = w.max(h);
            assert!(
                side >= side_max * 0.99 || w * h >= area_max * 0.99,
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
        let page = pdf::Page::read(chunk, 1, 401.0, 250.0, None, None).unwrap();
        let file = pdf::document(vec![page], "Città (1)").unwrap();
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

    /// Le misure delle immagini che `svg2pdf` dipinge per gli effetti di
    /// `svg`, che ha `units_per_inch` unità per pollice: `/Width` e
    /// `/Height` di ogni immagine, e della sua trasparenza.
    fn painted(svg: &str, units_per_inch: f32) -> Vec<(u32, u32)> {
        let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
        let (chunk, _) = svg2pdf::to_chunk(&tree, pdf::options(&tree, units_per_inch)).unwrap();
        let text = String::from_utf8_lossy(chunk.as_bytes());
        let read = |key: &str| -> Vec<u32> {
            text.match_indices(key)
                .map(|(at, _)| {
                    let digits = text[at + key.len()..]
                        .split(|c: char| !c.is_ascii_digit())
                        .next()
                        .unwrap();
                    digits.parse().unwrap()
                })
                .collect()
        };
        read("/Width ").into_iter().zip(read("/Height ")).collect()
    }

    /// Un disegno con un'ombra la cui regione è di 96 × 48 unità, dentro
    /// `wrap` (`{}` è il posto dell'oggetto).
    fn shadowed(size: f32, wrap: &str) -> String {
        let object =
            r##"<rect x="20" y="20" width="60" height="20" fill="#336699" filter="url(#f)"/>"##;
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}"><filter id="f" filterUnits="userSpaceOnUse" x="10" y="10" width="96" height="48" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2"/></filter>{}</svg>"##,
            wrap.replace("{}", object)
        )
    }

    #[test]
    fn effects_are_painted_at_300_dpi_on_the_page() {
        // 96 pixel CSS sono un pollice: 300 pixel dipinti.
        let plain = painted(&shadowed(400.0, "{}"), CSS_DPI);
        assert!(!plain.is_empty());
        assert!(plain.iter().all(|&size| size == (300, 150)), "{plain:?}");

        // Un gruppo che ingrandisce due volte: la regione, nelle coordinate
        // del gruppo, si dipinge col doppio dei pixel.
        let doubled = painted(
            &shadowed(400.0, r#"<g transform="scale(2)">{}</g>"#),
            CSS_DPI,
        );
        assert!(
            doubled.iter().all(|&size| size == (600, 300)),
            "{doubled:?}"
        );

        // Una rotazione non ingrandisce.
        let turned = painted(
            &shadowed(400.0, r#"<g transform="rotate(90 200 200)">{}</g>"#),
            CSS_DPI,
        );
        assert!(turned.iter().all(|&size| size == (300, 150)), "{turned:?}");

        // Le annotazioni di un PDF sono in punti: 72 per pollice.
        let svg =
            shadowed(400.0, "{}").replace(r#"width="96" height="48""#, r#"width="72" height="36""#);
        let points = painted(&svg, 72.0);
        assert!(points.iter().all(|&size| size == (300, 150)), "{points:?}");
    }

    #[test]
    fn blending_stays_vector_in_the_pdf() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g style="isolation: isolate"><rect width="60" height="60" fill="#56b4e9"/><circle cx="60" cy="60" r="30" fill="#e69f00" style="mix-blend-mode: multiply"/></g></svg>"##;
        let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
        let (chunk, _) = svg2pdf::to_chunk(&tree, pdf::options(&tree, CSS_DPI)).unwrap();
        let text = String::from_utf8_lossy(chunk.as_bytes());
        assert!(text.contains("/BM /Multiply"), "{text}");
        // Nessuna immagine: la fusione non si dipinge.
        assert!(!text.contains("/Subtype /Image"), "{text}");
    }

    #[test]
    fn a_huge_effect_lowers_the_resolution_and_the_export_still_happens() {
        let options = |svg: &str| {
            let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
            pdf::options(&tree, CSS_DPI).raster_scale
        };
        // Senza effetti la scala non conta, e resta quella dei 300 dpi.
        let none = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>"#;
        assert_eq!(options(none), 300.0 / 96.0);
        // Una regione di 20 000 × 20 000 unità avrebbe 3,9 miliardi di
        // pixel: si dipinge con 4096 × 4096.
        let huge = shadowed(20_000.0, "{}").replace(
            r#"width="96" height="48""#,
            r#"width="20000" height="20000""#,
        );
        let scale = options(&huge);
        assert!((20_000.0 * scale - 4096.0).abs() < 0.01, "{scale}");
    }
}
