//! I vettori della lettura, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-read/`): la stessa cartella che
//! `apps/client/src/editors/canvas/wasm/vectors.test.ts` fa girare contro il
//! nucleo compilato in WebAssembly. Ogni vettore dà un sorgente grezzo e
//! l'esito di `Core::open`: per una lavagna che si apre le schede, gli archi
//! e i campi sconosciuti della radice (`extra`, se ci sono) come li dà il
//! modello; per un rifiuto la ragione (`limit` per un limite di dimensione,
//! `source` per tutto il resto), la stessa che il `.wasm` mette nel codice
//! dell'errore. Le regole sono R1–R8 di `docs/reference/canvas-format.md`.

use std::path::PathBuf;

use fub_canvas_core::commit::Core;
use fub_canvas_core::source::canvas_value;
use fub_canvas_core::CanvasError;
use serde_json::{Map, Value};

/// Quanti vettori almeno: meno vuol dire che la cartella si è persa qualcosa.
const MIN_VECTORS: usize = 60;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/canvas-read")
}

/// I vettori, in ordine di nome: `(file, json)`. Un file che non si legge fa
/// fallire il test.
fn read_vectors() -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder())
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            assert!(
                name.ends_with(".json"),
                "{name}: nella cartella solo vettori .json"
            );
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, json)
        })
        .collect()
}

fn text<'a>(vector: &'a Value, pointer: &str) -> Option<&'a str> {
    vector.pointer(pointer).map(|value| {
        value
            .as_str()
            .unwrap_or_else(|| panic!("{pointer} non è una stringa"))
    })
}

/// La ragione di un rifiuto, come il `.wasm` la mette nel codice dell'errore.
fn reason(error: &CanvasError) -> &'static str {
    match error {
        CanvasError::Limit { .. } => "limit",
        CanvasError::Json(_) | CanvasError::Invalid(_) => "source",
    }
}

/// Lo stesso valore JSON: le chiavi di un oggetto in qualunque ordine, le
/// liste nel loro, i numeri per valore (`-0` è `0`, `1e2` è `100`).
fn same(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a
                    .iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| same(value, other)))
        }
        _ => left == right,
    }
}

/// Fa girare un vettore: `Err` dice dove il nucleo non dà ciò che il vettore
/// si aspetta.
fn run(vector: &Value) -> Result<(), String> {
    let source = text(vector, "/source").ok_or("manca source")?;
    let opened = Core::open(source);
    match text(vector, "/expect/outcome") {
        Some("opened") => {
            let core = opened.map_err(|error| format!("non si apre: {error}"))?;
            let seen = canvas_value(core.canvas()).map_err(|error| format!("{error:?}"))?;
            let mut expected = Map::new();
            for key in ["nodes", "edges"] {
                let value = vector
                    .pointer(&format!("/expect/{key}"))
                    .ok_or(format!("manca expect.{key}"))?;
                expected.insert(key.to_owned(), value.clone());
            }
            if let Some(extra) = vector.pointer("/expect/extra") {
                let extra = extra.as_object().ok_or("expect.extra non è un oggetto")?;
                expected.extend(extra.clone());
            }
            let expected = Value::Object(expected);
            if same(&seen, &expected) {
                Ok(())
            } else {
                Err(format!("modello\n  dato:   {seen}\n  atteso: {expected}"))
            }
        }
        Some("rejected") => {
            let expected = text(vector, "/expect/reason").ok_or("manca expect.reason")?;
            match opened {
                Ok(_) => Err("si apre".into()),
                Err(error) if reason(&error) != expected => Err(format!(
                    "ragione {} ({error}), attesa {expected}",
                    reason(&error)
                )),
                Err(_) => Ok(()),
            }
        }
        other => Err(format!("esito {other:?} sconosciuto")),
    }
}

#[test]
fn the_folder_holds_the_numbered_vectors() {
    let vectors = read_vectors();
    assert!(
        vectors.len() >= MIN_VECTORS,
        "{} vettori, almeno {MIN_VECTORS}",
        vectors.len()
    );
    for (index, (file, vector)) in vectors.iter().enumerate() {
        let name = text(vector, "/name").unwrap_or_else(|| panic!("{file}: manca name"));
        assert_eq!(*file, format!("{:02}-{name}.json", index + 1));
        assert!(
            text(vector, "/description").is_some_and(|d| !d.is_empty()),
            "{file}: manca description"
        );
    }
}

#[test]
fn every_vector_opens_or_is_rejected_as_expected() {
    let failures: Vec<String> = read_vectors()
        .iter()
        .filter_map(|(file, vector)| run(vector).err().map(|error| format!("{file}: {error}")))
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Un vettore cambiato fa fallire il confronto: un valore di una scheda
/// cambiato, una scheda in più, o una ragione cambiata di un byte.
#[test]
fn a_vector_changed_by_one_byte_fails() {
    let mut mutated = 0;
    for (file, vector) in read_vectors() {
        let mut changed = vector.clone();
        match text(&vector, "/expect/outcome") {
            Some("rejected") => {
                let reason = text(&vector, "/expect/reason").unwrap();
                *changed.pointer_mut("/expect/reason").unwrap() =
                    Value::String(format!("{reason}x"));
            }
            _ => {
                let nodes = changed
                    .pointer_mut("/expect/nodes")
                    .and_then(Value::as_array_mut)
                    .unwrap_or_else(|| panic!("{file}: manca expect.nodes"));
                match nodes.first_mut().and_then(Value::as_object_mut) {
                    Some(node) => {
                        let x = node["x"].as_i64().unwrap();
                        node.insert("x".into(), Value::from(x + 1));
                    }
                    None => nodes.push(serde_json::json!({"id": "x"})),
                }
            }
        }
        assert!(run(&changed).is_err(), "{file}: il vettore cambiato passa ancora");
        mutated += 1;
    }
    assert!(mutated >= MIN_VECTORS);
}
