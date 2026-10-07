//! I vettori dell'export (`apps/client/src/__fixtures__/scene-export/`):
//! `derive.json` e `measure.json` sono condivisi con il client, che deriva e
//! misura allo stesso modo per l'anteprima della finestra «Esporta», e qui
//! devono dare gli stessi byte e gli stessi numeri; `clean.json` è dell'SVG
//! pulito, che fa soltanto l'host.
//!
//! `clean.json` ha per ogni caso `name`, `description`, il testo derivato
//! `input`, l'ambito `scope` con la forma di `derive.json` (il disegno intero
//! tiene i `view` delle tavole, gli altri no) e l'esito `expect`: `{text}`, il
//! testo pulito byte per byte, o `{error}`, `malformed` o `not-svg`.

use std::path::PathBuf;

use fub_scene::export::{self, Background, DeriveError, Scope, Size};
use fub_scene::ReadError;
use serde_json::Value;

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-export")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{file}: {e}"));
    let json: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file}: {e}"));
    json.as_array()
        .unwrap_or_else(|| panic!("{file}: non è una lista"))
        .clone()
}

fn text<'v>(vector: &'v Value, key: &str) -> &'v str {
    vector[key]
        .as_str()
        .unwrap_or_else(|| panic!("{}: manca {key}", vector["name"]))
}

fn scope(vector: &Value) -> Scope {
    let scope = &vector["scope"];
    match scope["kind"].as_str() {
        Some("drawing") => Scope::Drawing,
        Some("board") => Scope::Board(text(scope, "id").to_owned()),
        Some("selection") => {
            let ids = scope["ids"]
                .as_array()
                .expect("gli id della selezione")
                .iter()
                .map(|id| id.as_str().expect("un id").to_owned())
                .collect();
            let numbers: Vec<f64> = scope["box"]
                .as_array()
                .expect("il riquadro")
                .iter()
                .map(|n| n.as_f64().expect("un numero"))
                .collect();
            let rect = numbers.try_into().expect("quattro numeri");
            Scope::Selection { ids, rect }
        }
        other => panic!("{}: ambito sconosciuto {other:?}", vector["name"]),
    }
}

fn background(vector: &Value) -> Background {
    match vector["background"].as_str() {
        Some("paper") => Background::Paper,
        Some("none") => Background::None,
        other => panic!("{}: sfondo sconosciuto {other:?}", vector["name"]),
    }
}

/// L'esito nella forma dei vettori.
fn derive_outcome(input: &str, scope: &Scope, background: Background) -> Value {
    match export::derive(input, scope, background) {
        Ok(text) => serde_json::json!({ "text": text }),
        Err(error) => match &error {
            DeriveError::UnknownBoard(id) | DeriveError::UnknownObject(id) => {
                serde_json::json!({ "error": error.kind(), "id": id })
            }
            _ => serde_json::json!({ "error": error.kind() }),
        },
    }
}

fn read_kind(error: ReadError) -> &'static str {
    match error {
        ReadError::Malformed { .. } => "malformed",
        ReadError::NotSvg { .. } => "not-svg",
    }
}

#[test]
fn derivation_gives_the_bytes_of_the_vectors() {
    let vectors = vectors("derive.json");
    assert!(vectors.len() >= 34);
    for vector in &vectors {
        let name = &vector["name"];
        let (scope, background) = (scope(vector), background(vector));
        let got = derive_outcome(text(vector, "input"), &scope, background);
        assert_eq!(got, vector["expect"], "{name}");
        let Some(derived) = got["text"].as_str() else {
            continue;
        };
        // Il testo derivato si rilegge, e derivarlo di nuovo non lo cambia.
        fub_scene::read(derived).unwrap_or_else(|e| panic!("{name}: {e}"));
        let again = export::derive(derived, &scope, background).unwrap();
        assert_eq!(again, derived, "{name}: derivare due volte");
    }
}

#[test]
fn measure_gives_the_pixels_of_the_vectors() {
    let vectors = vectors("measure.json");
    assert!(vectors.len() >= 12);
    for vector in &vectors {
        let name = &vector["name"];
        let side = |key: &str| {
            vector[key]
                .as_f64()
                .unwrap_or_else(|| panic!("{name}: {key}"))
        };
        let size = &vector["size"];
        let size = match (size["scale"].as_f64(), size["pixels"].as_u64()) {
            (Some(scale), None) => Size::Scale(scale as f32),
            (None, Some(pixels)) => Size::Pixels(u32::try_from(pixels).unwrap()),
            _ => panic!("{name}: misura chiesta {size}"),
        };
        let got = export::measure(side("width") as f32, side("height") as f32, size);
        let expect = &vector["expect"];
        // La scala è un numero a 32 bit: `serde_json` senza `float_roundtrip`
        // può leggere il double di un ultimo bit diverso, il float no.
        assert_eq!(
            got.scale,
            expect["scale"].as_f64().unwrap() as f32,
            "{name}: scala"
        );
        assert_eq!(
            u64::from(got.width),
            expect["width"].as_u64().unwrap(),
            "{name}: larghezza"
        );
        assert_eq!(
            u64::from(got.height),
            expect["height"].as_u64().unwrap(),
            "{name}: altezza"
        );
        assert_eq!(
            got.reduced,
            expect["reduced"].as_bool().unwrap(),
            "{name}: ridotta"
        );
    }
}

#[test]
fn clean_svg_gives_the_bytes_of_the_vectors() {
    let vectors = vectors("clean.json");
    let mut names = std::collections::BTreeSet::new();
    for vector in &vectors {
        let name = text(vector, "name");
        assert!(names.insert(name.to_owned()), "{name}: nome ripetuto");
        let scope = scope(vector);
        let got = match export::clean(text(vector, "input"), &scope) {
            Ok(text) => serde_json::json!({ "text": text }),
            Err(error) => serde_json::json!({ "error": read_kind(error) }),
        };
        assert_eq!(got, vector["expect"], "{name}");
        let Some(cleaned) = got["text"].as_str() else {
            continue;
        };
        // Il testo pulito si rilegge, e ripulirlo non lo cambia.
        fub_scene::read(cleaned).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            export::clean(cleaned, &scope).unwrap(),
            cleaned,
            "{name}: ripulire due volte"
        );
    }
}

#[test]
fn the_corpus_cleans_once() {
    let corpus = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&corpus)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "svg"))
        .collect();
    files.sort();
    assert!(!files.is_empty());
    for path in files {
        let source = std::fs::read_to_string(&path).unwrap();
        let name = path.display();
        let once =
            export::clean(&source, &Scope::Drawing).unwrap_or_else(|e| panic!("{name}: {e}"));
        fub_scene::read(&once).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(!once.contains("<!--") && !once.contains("<?xml"), "{name}");
        assert_eq!(
            export::clean(&once, &Scope::Drawing).unwrap(),
            once,
            "{name}: ripulire due volte"
        );
    }
}
