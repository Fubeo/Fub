// Senza la cargo feature `draw` questo banco non ha soggetto.
#![cfg(feature = "draw")]
//! I modelli di «Nuovo disegno» (`crates/fub-features/templates/`): i file che
//! il binario porta dentro, letti da chi li leggerà davvero, `fub_scene`.
//!
//! Quattro domande.
//!
//! - **I file ci sono, e soltanto quelli.** Ogni scelta di `template`, tranne
//!   `blank`, ha i suoi due file, `<id>.it.svg` e `<id>.en.svg`; la cartella
//!   non ne ha altri. Un modello nuovo nella scelta senza i suoi file non
//!   compila (è `include_str!`), ma un file in più, o un nome sbagliato in una
//!   lingua, si vede solo qui.
//! - **Ogni file è una scena modificabile e pulita.** Una scena FubDraw senza
//!   ragioni di sola lettura, senza diagnostica.
//! - **Il titolo è il nome del modello nella sua lingua**, quello che la
//!   scelta dice nel catalogo: è il testo che `retitle` sostituisce con il
//!   nome del disegno, e quello che chi apre il file a mano vede.
//! - **La forma che il modello promette**: i livelli, le tavole (la diapositiva
//!   una, lo storyboard sei) e la carta dei fogli A4.

use std::collections::BTreeSet;
use std::path::Path;

use fub_abi::command::ParamKind;
use fub_abi::locale::Locale;
use fub_abi::text::Strings;
use fub_features::DrawCommands;

const LANGUAGES: [&str; 2] = ["it", "en"];

/// La cartella dei modelli.
fn folder() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("templates")
}

/// Gli id della scelta `template`, nell'ordine in cui la spec li propone.
fn ids() -> Vec<String> {
    let spec = DrawCommands::spec();
    let param = spec
        .params
        .iter()
        .find(|param| param.name == "template")
        .expect("`drawing.create` ha `template`");
    let ParamKind::Choice(choices) = &param.kind else {
        panic!("`template` è una scelta")
    };
    choices.iter().map(|choice| choice.value.clone()).collect()
}

/// Il nome del modello `id` nella lingua `language`, come lo dice il catalogo.
fn name(id: &str, language: &str) -> String {
    let spec = DrawCommands::spec();
    let ParamKind::Choice(choices) = &spec
        .params
        .iter()
        .find(|param| param.name == "template")
        .unwrap()
        .kind
    else {
        panic!("`template` è una scelta")
    };
    let choice = choices.iter().find(|choice| choice.value == id).unwrap();
    let catalogs = fub_features::draw::catalog();
    let locale = Locale {
        language: language.to_string(),
        ..Locale::default()
    };
    Strings::new(&catalogs, "it", &locale).render(&choice.title)
}

fn read(id: &str, language: &str) -> String {
    let path = folder().join(format!("{id}.{language}.svg"));
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Il valore di un attributo del tag di apertura della radice.
fn root_attribute(source: &str, attribute: &str) -> Option<f64> {
    let tag = &source[source.find("<svg")?..];
    let tag = &tag[..tag.find('>')?];
    let rest = &tag[tag.find(&format!(" {attribute}=\""))? + attribute.len() + 3..];
    rest[..rest.find('"')?].parse().ok()
}

#[test]
fn every_template_has_its_two_files_and_there_are_no_others() {
    let ids = ids();
    assert_eq!(ids.first().map(String::as_str), Some("blank"));
    let expected: BTreeSet<String> = ids
        .iter()
        .filter(|id| id.as_str() != "blank")
        .flat_map(|id| LANGUAGES.map(|language| format!("{id}.{language}.svg")))
        .collect();
    assert_eq!(expected.len(), 14, "sette modelli, due lingue");
    let found: BTreeSet<String> = std::fs::read_dir(folder())
        .expect("la cartella dei modelli c'è")
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    let missing: Vec<_> = expected.difference(&found).collect();
    let extra: Vec<_> = found.difference(&expected).collect();
    assert!(missing.is_empty(), "file che mancano: {missing:?}");
    assert!(extra.is_empty(), "file in più: {extra:?}");
}

#[test]
fn every_file_is_an_editable_scene_with_nothing_to_report() {
    for id in ids().iter().filter(|id| id.as_str() != "blank") {
        for language in LANGUAGES {
            let source = read(id, language);
            let scene =
                fub_scene::read(&source).unwrap_or_else(|error| panic!("{id}.{language}: {error}"));
            assert!(
                scene.editable(),
                "{id}.{language}: {:?} {:?}",
                scene.status,
                scene.read_only
            );
            assert!(
                scene.diagnostics.is_empty(),
                "{id}.{language}: {:?}",
                scene.diagnostics
            );
            assert!(!scene.summary.foreign, "{id}.{language}");
            assert!(!scene.truncated, "{id}.{language}");
        }
    }
}

#[test]
fn the_title_is_the_name_of_the_template_in_the_language_of_the_file() {
    for id in ids().iter().filter(|id| id.as_str() != "blank") {
        for language in LANGUAGES {
            let scene = fub_scene::read(&read(id, language)).unwrap();
            let title = scene.index.title.map(|title| title.text);
            assert_eq!(
                title.as_deref(),
                Some(name(id, language).as_str()),
                "{id}.{language}"
            );
        }
    }
}

#[test]
fn the_names_of_the_two_languages_differ_only_where_the_words_do() {
    // Una lingua dimenticata ripete il nome dell'altra: due nomi uguali
    // sono ammessi soltanto per «Storyboard», che si scrive allo stesso modo.
    for id in ids() {
        let (it, en) = (name(&id, "it"), name(&id, "en"));
        if id == "storyboard" {
            assert_eq!(it, en);
        } else {
            assert_ne!(it, en, "{id}");
        }
    }
}

#[test]
fn every_file_has_layers_and_the_boards_it_promises() {
    for id in ids().iter().filter(|id| id.as_str() != "blank") {
        for language in LANGUAGES {
            let scene = fub_scene::read(&read(id, language)).unwrap();
            let layers = &scene.summary.layers;
            let location = format!("{id}.{language}");
            assert!(!layers.is_empty(), "{location}: nessun livello");
            let distinct: BTreeSet<_> = layers.iter().collect();
            assert_eq!(distinct.len(), layers.len(), "{location}: {layers:?}");
            assert!(layers.iter().all(|name| !name.trim().is_empty()));
            let boards = scene.summary.boards.len();
            let expected_boards = match id.as_str() {
                "slide" => 1,
                "storyboard" => 6,
                _ => 0,
            };
            assert_eq!(
                boards, expected_boards,
                "{location}: {:?}",
                scene.summary.boards
            );
            let expected_layers = match id.as_str() {
                // Lo sfondo bloccato col foglio a quadretti, e sopra la lavagna.
                "lesson" => Some(2),
                "a4-portrait" | "a4-landscape" => Some(1),
                _ => None,
            };
            if let Some(count) = expected_layers {
                assert_eq!(layers.len(), count, "{location}: {layers:?}");
            }
        }
    }
}

#[test]
fn the_layers_and_the_boards_are_named_in_the_language_of_the_file() {
    let names = |id: &str, language: &str| {
        let scene = fub_scene::read(&read(id, language)).unwrap();
        (scene.summary.layers, scene.summary.boards)
    };
    // La lavagna: lo sfondo, che si apre bloccato, e sopra la lavagna.
    assert_eq!(names("lesson", "it").0, ["Sfondo", "Lavagna"]);
    assert_eq!(names("lesson", "en").0, ["Background", "Board"]);
    let locked = read("lesson", "it");
    assert!(locked.contains("fub:layer=\"Sfondo\" fub:locked=\"true\""));
    // La diapositiva e lo storyboard: le tavole numerate come le scrive lo
    // strumento Tavola.
    assert_eq!(names("slide", "it").1, ["Diapositiva 1"]);
    assert_eq!(names("slide", "en").1, ["Slide 1"]);
    let scenes: Vec<_> = (1..=6).map(|n| format!("Scena {n}")).collect();
    assert_eq!(names("storyboard", "it").1, scenes);
    let scenes: Vec<_> = (1..=6).map(|n| format!("Scene {n}")).collect();
    assert_eq!(names("storyboard", "en").1, scenes);
    // La diapositiva e lo storyboard hanno il solo livello di un disegno nuovo.
    for (language, layer) in [("it", "Livello 1"), ("en", "Layer 1")] {
        for id in ["slide", "storyboard"] {
            assert_eq!(names(id, language).0, [layer], "{id}.{language}");
        }
    }
}

#[test]
fn the_a4_sheets_are_a_portrait_and_a_landscape_page() {
    for language in LANGUAGES {
        for (id, portrait) in [("a4-portrait", true), ("a4-landscape", false)] {
            let source = read(id, language);
            let width = root_attribute(&source, "width").expect("larghezza");
            let height = root_attribute(&source, "height").expect("altezza");
            assert_eq!(
                width < height,
                portrait,
                "{id}.{language}: {width}×{height}"
            );
            // La stessa carta, girata: i lati di un A4 stanno come 1 a √2.
            let (short, long) = (width.min(height), width.max(height));
            assert!(
                (long / short - std::f64::consts::SQRT_2).abs() < 0.01,
                "{id}.{language}: {width}×{height}"
            );
        }
    }
}

#[test]
fn the_lesson_board_and_the_slide_are_sixteen_by_nine() {
    for language in LANGUAGES {
        let source = read("lesson", language);
        assert_eq!(
            root_attribute(&source, "width"),
            Some(1920.0),
            "lesson.{language}"
        );
        assert_eq!(
            root_attribute(&source, "height"),
            Some(1080.0),
            "lesson.{language}"
        );
    }
}
