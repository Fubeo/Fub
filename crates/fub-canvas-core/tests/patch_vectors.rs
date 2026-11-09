//! I vettori delle toppe sul testo, scritti a mano
//! (`apps/client/src/__fixtures__/canvas-patches/`): la stessa cartella che
//! `apps/client/src/editors/canvas/wasm/vectors.test.ts` fa girare contro lo
//! stesso nucleo compilato in WebAssembly. Ogni vettore dà il testo grezzo di prima, le toppe
//! e l'esito: per un commit riuscito il testo di dopo e quello dell'annulla
//! (le toppe inverse applicate al testo di dopo; se manca, è quello di prima),
//! per un rifiuto la ragione (`CommitError::reason`). Così la build nativa e
//! quella a 32 bit danno gli stessi byte e le stesse ragioni
//! (`docs/reference/canvas-format.md` § «Parità»). Per ogni vettore `Core::preview` dà il testo, o la ragione,
//! di `commit`, e lascia la lavagna com'era.

use std::path::PathBuf;

use fub_canvas_core::commit::Core;
use fub_canvas_core::patch::CanvasPatch;
use serde_json::Value;

/// Quanti vettori almeno: meno vuol dire che la cartella si è persa qualcosa.
const MIN_VECTORS: usize = 30;

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-patches")
}

/// Il numero davanti al nome del file (`07-…` → 7), per mettere `100-…` dopo
/// `99-…`.
fn number(path: &std::path::Path) -> u32 {
    let name = path.file_name().unwrap().to_string_lossy();
    name.split('-')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(u32::MAX)
}

/// I vettori, in ordine di numero e poi di nome: `(file, json)`. Un file che
/// non si legge fa fallire il test.
fn read_vectors() -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder())
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort_by(|a, b| number(a).cmp(&number(b)).then_with(|| a.cmp(b)));
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

/// Fa girare un vettore: `Err` dice dove il nucleo non dà ciò che il vettore
/// si aspetta.
fn run(vector: &Value) -> Result<(), String> {
    let before = text(vector, "/before").ok_or("manca before")?;
    let patches: Vec<CanvasPatch> = serde_json::from_value(vector["patches"].clone())
        .map_err(|error| format!("le toppe non si leggono: {error}"))?;
    let mut core = Core::open(before).map_err(|error| format!("before non si apre: {error}"))?;
    // `preview` dà il testo (o la ragione) di `commit` e lascia la lavagna
    // com'era: si chiede prima del commit, e la lavagna deve restare quella.
    let preview = core.preview(&patches);
    if core.source() != before {
        return Err("preview ha cambiato la lavagna".into());
    }
    let outcome = core.commit(&patches);
    match (&preview, &outcome) {
        (Ok(text), Ok(committed)) if *text != committed.source => {
            return Err(format!(
                "preview dà un altro testo\n  preview: {text:?}\n  commit:  {:?}",
                committed.source
            ));
        }
        (Err(seen), Err(error))
            if seen.reason() != error.reason() || seen.to_string() != error.to_string() =>
        {
            return Err(format!(
                "preview rifiuta con «{seen}», commit con «{error}»"
            ));
        }
        (Ok(_), Err(error)) => return Err(format!("preview passa, commit rifiuta: {error}")),
        (Err(error), Ok(_)) => return Err(format!("preview rifiuta, commit passa: {error}")),
        _ => {}
    }
    match text(vector, "/expect/outcome") {
        Some("applied") => {
            let committed = outcome.map_err(|error| format!("rifiutato: {error}"))?;
            let expected = text(vector, "/expect/text").ok_or("manca expect.text")?;
            if committed.source != expected {
                return Err(format!(
                    "testo di dopo\n  dato:   {:?}\n  atteso: {expected:?}",
                    committed.source
                ));
            }
            if core.source() != expected {
                return Err("la lavagna non tiene il testo di dopo".into());
            }
            if committed.edit.apply(before).as_deref() != Some(expected) {
                return Err(format!(
                    "il tratto {:?} non dà il testo di dopo",
                    committed.edit
                ));
            }
            let undone = core
                .commit(&committed.inverse)
                .map_err(|error| format!("l'annulla è rifiutato: {error}"))?;
            let undo = text(vector, "/expect/undo").unwrap_or(before);
            if undone.source != undo {
                return Err(format!(
                    "testo dell'annulla\n  dato:   {:?}\n  atteso: {undo:?}",
                    undone.source
                ));
            }
            Ok(())
        }
        Some("rejected") => {
            let reason = text(vector, "/expect/reason").ok_or("manca expect.reason")?;
            match outcome {
                Ok(committed) => Err(format!("applicato: {:?}", committed.source)),
                Err(error) if error.reason() != reason => Err(format!(
                    "ragione {} ({error}), attesa {reason}",
                    error.reason()
                )),
                Err(_) if core.source() != before => {
                    Err("il rifiuto ha cambiato la lavagna".into())
                }
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
fn every_vector_gives_the_expected_bytes_and_reasons() {
    let failures: Vec<String> = read_vectors()
        .iter()
        .filter_map(|(file, vector)| run(vector).err().map(|error| format!("{file}: {error}")))
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn every_reason_has_a_vector_that_both_sides_reject() {
    let vectors = read_vectors();
    for reason in ["stale", "invalid", "rejected"] {
        assert!(
            vectors
                .iter()
                .any(|(_, vector)| text(vector, "/expect/reason") == Some(reason)),
            "nessun vettore rifiutato come {reason}"
        );
    }
}

/// Un testo atteso cambiato di un byte, o una ragione cambiata, fa fallire il
/// vettore: il confronto è byte per byte, non per valore.
#[test]
fn a_vector_changed_by_one_byte_fails() {
    let mut mutated = 0;
    for (file, vector) in read_vectors() {
        for pointer in ["/expect/text", "/expect/undo", "/expect/reason"] {
            let Some(original) = text(&vector, pointer) else {
                continue;
            };
            let mut changed = vector.clone();
            let value = if pointer == "/expect/reason" {
                format!("{original}x")
            } else {
                format!("{original} ")
            };
            *changed.pointer_mut(pointer).unwrap() = Value::String(value);
            assert!(
                run(&changed).is_err(),
                "{file}: {pointer} cambiato di un byte passa ancora"
            );
            mutated += 1;
        }
    }
    assert!(mutated >= MIN_VECTORS);
}
