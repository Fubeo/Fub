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
                "draw.workspace",
                "draw.toolbar",
                "draw.templates",
                "draw.suggestions"
            ]
        );
        assert_eq!(
            keys,
            [
                DRAW_WORKSPACE_KEY,
                DRAW_TOOLBAR_KEY,
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
        // Un componente non cambia lo spazio di lavoro o la colonna e non
        // spegne i suggerimenti da sé: soltanto la cartella è di tutti.
        let writable: Vec<_> = specs.iter().map(|spec| spec.program_writable).collect();
        assert_eq!(writable, [false, false, true, false]);

        let defaults: Vec<_> = specs.iter().map(|spec| spec.kind.default_value()).collect();
        assert_eq!(
            defaults,
            [
                SettingValue::Text("full".into()),
                SettingValue::List(vec![]),
                SettingValue::Text("Templates".into()),
                SettingValue::Toggle(true),
            ]
        );
        let SettingKind::Choice { options, .. } = &specs[0].kind else {
            panic!("lo spazio di lavoro è una scelta")
        };
        let workspaces: Vec<_> = options.iter().map(|option| option.value.as_str()).collect();
        assert_eq!(workspaces, DRAW_WORKSPACES);
        assert_eq!(workspaces, ["full", "simple"]);
        let named: Vec<_> = options
            .iter()
            .map(|option| said(&option.label, "it"))
            .collect();
        assert_eq!(named, ["Completo", "Semplice"]);

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
        assert_eq!(said(&specs[0].label, "it"), "Spazio di lavoro");
        assert_eq!(said(&specs[1].label, "it"), "Strumenti della colonna");
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
        let kind = &specs
            .iter()
            .find(|spec| spec.key == DRAW_SUGGESTIONS_KEY)
            .unwrap()
            .kind;
        assert!(kind.rejects(&SettingValue::Toggle(false)).is_none());
        assert!(kind.rejects(&SettingValue::Toggle(true)).is_none());
        assert!(kind.rejects(&SettingValue::Text("no".into())).is_some());
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
