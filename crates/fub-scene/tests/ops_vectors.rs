//! I vettori delle operazioni sulla scena, scritti a mano per il motore della
//! superficie (`apps/client/src/__fixtures__/scene-ops/`): qui si legge ogni
//! testo che contengono, quello di partenza, quello atteso e quello che dà
//! l'inversa. Ognuno si legge senza perdere un byte, senza errori S003 o S004
//! e senza ragioni di sola lettura: così il motore TypeScript e il lettore
//! Rust restano d'accordo sul formato che le operazioni scrivono.

mod common;

use std::path::PathBuf;

use common::load;
use fub_scene::{Code, Scene};
use serde_json::Value;

fn vectors() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/scene-ops")
}

/// I vettori, in ordine di nome: `(file, json)`.
fn read_vectors() -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(vectors())
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, json)
        })
        .collect()
}

/// Le diagnostiche d'errore di `scene`.
fn errors(scene: &Scene) -> Vec<Code> {
    scene
        .diagnostics
        .iter()
        .map(|d| d.code)
        .filter(|code| matches!(code, Code::S003 | Code::S004))
        .collect()
}

#[test]
fn ci_sono_i_35_vettori() {
    let names: Vec<String> = read_vectors().into_iter().map(|(name, _)| name).collect();
    assert_eq!(names.len(), 35, "{names:?}");
    for (i, name) in names.iter().enumerate() {
        assert!(name.starts_with(&format!("{:02}-", i + 1)), "{name}");
    }
}

#[test]
fn ogni_testo_dei_vettori_si_legge_senza_errori() {
    let mut checked = 0;
    for (name, vector) in read_vectors() {
        let expect = &vector["expect"];
        let mut texts = vec![("input", &vector["input"])];
        if !expect["text"].is_null() {
            texts.push(("expect.text", &expect["text"]));
        }
        if !expect["inverseText"].is_null() {
            texts.push(("expect.inverseText", &expect["inverseText"]));
        }
        for (field, value) in texts {
            let text = value
                .as_str()
                .unwrap_or_else(|| panic!("{name}: {field} non è una stringa"));
            let scene = load(text);
            assert_eq!(errors(&scene), Vec::<Code>::new(), "{name}: {field}");
            assert!(
                scene.read_only.is_empty(),
                "{name}: {field} in sola lettura: {:?}",
                scene.read_only
            );
            checked += 1;
        }
    }
    // 35 testi di partenza, 29 attesi (sei vettori sono rifiuti) e due
    // inverse che non tornano al testo di partenza.
    assert_eq!(checked, 35 + 29 + 2);
}
