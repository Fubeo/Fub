//! I disegni nel vault (bundle `fub.draw`): il comando che ne fa nascere uno,
//! l'export in PNG, JPEG, SVG, PDF, Excalidraw e draw.io, e le impostazioni
//! dell'editor.
//!
//! Il comando «Nuovo disegno» è nel modulo [`create`]: un disegno nasce vuoto
//! dal provider del formato, da un modello distribuito con Fub o da un disegno
//! del vault, con un nome libero, e si apre. Il comando «Annota
//! il PDF» è nel modulo [`annotate`]: apre le annotazioni di un PDF, il file
//! `.pdf.fubann` accanto, e le fa nascere dal provider `fubann` se non ci sono.
//!
//! L'export sono sei [`ExportProvider`], uno per formato, che leggono il
//! disegno nello stesso modo. Le opzioni della richiesta ([`choice`]) dicono
//! che cosa esce: il disegno intero, alcune tavole o gli oggetti scelti, con
//! la carta o senza, e per il PDF su che pagina di stampa. Il disegno intero
//! con la carta sono i byte del documento; il resto è la derivazione di
//! `fub_scene::export`, la stessa che il client fa per l'anteprima. Il testo
//! passa da `usvg`, che ne fa un albero, e da lì `resvg` rasterizza il PNG e
//! il JPEG e `svg2pdf` scrive il PDF vettoriale, sulla carta, con
//! l'abbondanza e i segni chiesti ([`fub_scene::export::print`]); l'SVG è il
//! testo stesso, ripulito per il web. Excalidraw e draw.io leggono la scena
//! e l'albero insieme, e ne fanno le forme dei due programmi ([`interop`]).
//! Un disegno è
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
//! [`settings`] dichiara sei chiavi, nel gruppo «Disegni»: lo spazio di
//! lavoro e gli strumenti della colonna, il livello e le parti del
//! Personalizzato delle versioni precedenti, la cartella dei modelli del
//! vault e i suggerimenti brevi. Le prime quattro le legge l'editor, che le
//! segue dal vivo, e le due vecchie servono soltanto a dedurre le nuove; la
//! cartella la legge «Nuovo disegno»; i suggerimenti li scrive la casella
//! «Non mostrare più suggerimenti». La cartella delle librerie di simboli
//! (`draw.symbols`) se n'è andata col pannello «Simboli» (decisione 0231):
//! il valore che un vault ne porta resta nel file senza che nessuno lo legga.

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
mod interop;
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
/// La destinazione Excalidraw: un file `.excalidraw` per disegno, con le
/// forme che Excalidraw modifica e il resto come immagine.
pub const DRAW_EXCALIDRAW: &str = "draw.excalidraw";
/// La destinazione draw.io: un file `.drawio` per disegno, una pagina per
/// tavola.
pub const DRAW_DRAWIO: &str = "draw.drawio";

/// L'impostazione dello spazio di lavoro dell'editor: Completo, con tutto, o
/// Semplice, per disegnare a mano o col dito.
pub const DRAW_WORKSPACE_KEY: &str = "draw.workspace";
/// I valori dello spazio di lavoro: il primo è quello di serie. Sono i nomi
/// che l'editor conosce (`Workspace` in `tools/registry.ts`), e il test del
/// client `editors/spatial/draw-settings-mirror.test.ts` li confronta.
pub const DRAW_WORKSPACES: [&str; 2] = ["full", "simple"];
/// L'impostazione degli strumenti della colonna, in ordine: vuota, la colonna
/// di serie. Uno strumento che non c'è resta raggiungibile dai tasti e dalla
/// ricerca dei comandi.
pub const DRAW_TOOLBAR_KEY: &str = "draw.toolbar";
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
const S_WORKSPACE: &str = "s_workspace";
const S_WORKSPACE_DESC: &str = "s_workspace_desc";
const S_FULL: &str = "s_full";
const S_SIMPLE: &str = "s_simple";
const S_TOOLBAR: &str = "s_toolbar";
const S_TOOLBAR_DESC: &str = "s_toolbar_desc";
const S_TEMPLATES: &str = "s_templates";
const S_TEMPLATES_DESC: &str = "s_templates_desc";
const S_SUGGESTIONS: &str = "s_suggestions";
const S_SUGGESTIONS_DESC: &str = "s_suggestions_desc";

/// Lo schema delle impostazioni dei disegni.
///
/// - **Lo spazio di lavoro** e **la colonna degli strumenti** sono del
///   **vault**: chi prepara il vault per
///   una classe lo lascia in Semplice. Non `program_writable`. Li scrive anche
///   l'editor, dal menu «Disegno» e da «Personalizza la barra…». Nessuno dei
///   due nasconde una funzione: Semplice offre meno strumenti nella colonna e
///   nella barra, e «Completo» è a un clic. Il livello d'interfaccia e le
///   parti del Personalizzato (`draw.level`, `draw.custom`) non ci sono più
///   (ADR 0231): un vault che li ha li tiene nel suo file, e nessuno li legge.
///   La griglia qui non c'è: è uno stato della vista, e lo ricorda la
///   macchina, senza riscrivere il file del vault a ogni `#`.
/// - **La cartella dei modelli** è del vault: i modelli sono disegni del
///   vault, e viaggiano con lui. `program_writable`, come le cartelle delle
///   giornaliere: è un profilo di vault reversibile, e non tocca la privacy.
///   **La cartella delle librerie di simboli** allo stesso modo: le librerie
///   sono disegni del vault.
/// - **I suggerimenti** sono della **macchina**: spegnerli è una preferenza di
///   chi usa l'editor, non del vault. La scrive la casella «Non mostrare più
///   suggerimenti», quindi dall'interfaccia; non `program_writable`.
pub fn settings() -> Vec<SettingSpec> {
    let [full, simple] = DRAW_WORKSPACES;
    vec![
        SettingSpec::new(
            DRAW_WORKSPACE_KEY,
            Text::key(S_WORKSPACE),
            SettingKind::Choice {
                default: full.into(),
                options: vec![
                    UiOption::new(full, Text::key(S_FULL)),
                    UiOption::new(simple, Text::key(S_SIMPLE)),
                ],
            },
        )
        .describing(Text::key(S_WORKSPACE_DESC))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::new(
            DRAW_TOOLBAR_KEY,
            Text::key(S_TOOLBAR),
            SettingKind::List { default: vec![] },
        )
        .describing(Text::key(S_TOOLBAR_DESC))
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
        .with(S_WORKSPACE, "Spazio di lavoro")
        .with(
            S_WORKSPACE_DESC,
            "Completo offre tutti gli strumenti, l'ispettore e i menu; \
             Semplice ha pulsanti grandi per disegnare a mano o col dito: \
             penna, evidenziatore, gomma, forme di base e immagini. \
             Tutto resta raggiungibile dai tasti e dalla ricerca dei comandi, \
             e «Completo» è a un clic. Vale subito anche per i disegni aperti.",
        )
        .with(S_FULL, "Completo")
        .with(S_SIMPLE, "Semplice")
        .with(S_TOOLBAR, "Strumenti della colonna")
        .with(
            S_TOOLBAR_DESC,
            "Gli strumenti che la colonna dell'editor mostra, in ordine; \
             vuota, quelli di serie. Si sceglie anche da «Personalizza la \
             barra…» nel menu «Disegno».",
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
        .with(S_WORKSPACE, "Workspace")
        .with(
            S_WORKSPACE_DESC,
            "Full offers every tool, the inspector and the menus; Simple has \
             large buttons for drawing by hand or with a finger: pen, \
             highlighter, eraser, basic shapes and images. Everything \
             stays reachable from keys and the command search, and «Full» is \
             one click away. Takes effect at once, open drawings included.",
        )
        .with(S_FULL, "Full")
        .with(S_SIMPLE, "Simple")
        .with(S_TOOLBAR, "Tool column")
        .with(
            S_TOOLBAR_DESC,
            "The tools the editor's column shows, in order; empty, the default \
             ones. Also chosen from «Customize the toolbar…» in the «Drawing» \
             menu.",
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
        Box::new(ExcalidrawExport),
        Box::new(DrawioExport),
        Box::new(AnnotatedPdfExport),
        Box::new(RedactedPdfExport),
    ]
}

mod embed;
mod export;
mod pdf;
#[cfg(test)]
mod tests;
mod write;

use embed::{
    data_uri, external_note, fub_fonts, glyphs_note, heading, listed, lock, missing_glyphs,
    options, raster, title, vault_note, vault_path, ImagesRead, LeftOut, Refused, VaultImages,
    FACES, HREF_SHOWN, MONO, RASTER_TYPES, SANS, SERIF, UNBLED_NOTE, VAULT_IMAGES_MAX,
    VAULT_IMAGES_MIB,
};
use export::{
    artifact_names, check_target, derive_problem, export_drawings, files, is_drawing, not_utf8,
    unreadable, Derived, Drawing, File, Format, Outcome, Page, Problem, Writer,
};
pub use export::{DrawioExport, ExcalidrawExport, JpegExport, PdfExport, PngExport, SvgExport};
use write::{
    deliver, encode_jpeg, encode_png, write_pdf, write_raster, write_svg, OnWhite, SinkWriter,
};
