//! **Lo schema dei dati opachi.** I dati opachi della proiezione (`k`, `sect`)
//! sono JSON dei tipi del modello di WordCraft e dei tipi di Fub che li
//! avvolgono, e viaggiano dentro bozze autorevoli: la loro forma è un formato
//! persistente, con il numero `OPAQUE_SCHEMA`.
//!
//! - `il_golden_ha_lo_schema_corrente`: `tests/opaque_schema.golden.json`
//!   tiene la **forma** (chiavi e tipi dei valori, non i valori) dei dati
//!   opachi delle proiezioni del corpus e dei valori predefiniti dei tipi
//!   principali. Se la forma cambia con lo stesso schema, il test fallisce:
//!   si incrementa `OPAQUE_SCHEMA`, si aggiunge la fixture dello schema
//!   precedente in `tests/fixtures/opaque/schema-<N-1>/` con la sua migrazione
//!   o il suo rifiuto, e si rigenera con
//!   `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test opaque_schema`.
//! - `ogni_dato_opaco_del_corpus_si_rilegge`: ogni dato opaco di ogni
//!   proiezione del corpus che si modifica passa il controllo di
//!   contenimento, perché un salvataggio li decodifica tutti.
//! - `una_bozza_dello_schema_0_si_salva`: una proiezione di versione 1, come
//!   le bozze di prima della versione 2, si salva sui suoi byte.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use base64::Engine;
use fub_abi::FormatProvider;
use fub_format_rich::projection::{Inline, Projection, OPAQUE_SCHEMA};
use fub_format_rich::{open, save, Codec, RichProvider, Saved};
use serde_json::{json, Value};
use wordcraft_doc::{CharProps, Comment, ParaProps, SectionProps};

fn here() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn codec_of(path: &Path) -> Codec {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap();
    Codec::ALL
        .into_iter()
        .find(|codec| {
            RichProvider::new(*codec)
                .descriptor()
                .extensions
                .iter()
                .any(|e| e == ext)
        })
        .unwrap()
}

/// I file del corpus che si aprono, in ordine.
fn corpus() -> Vec<(String, Codec, Vec<u8>)> {
    let root = here().join("tests/corpus");
    let mut out = Vec::new();
    for dir in ["doc", "docx", "odt", "rtf"] {
        let mut files: Vec<_> = std::fs::read_dir(root.join(dir))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        files.sort();
        for path in files {
            let bytes = std::fs::read(&path).unwrap();
            let codec = codec_of(&path);
            if open(codec, &bytes).is_ok() {
                let name = format!("{dir}/{}", path.file_name().unwrap().to_str().unwrap());
                out.push((name, codec, bytes));
            }
        }
    }
    out
}

/// La forma di un valore: le chiavi degli oggetti, i tipi degli scalari, e
/// degli array le forme distinte degli elementi.
fn shape(value: &Value) -> Value {
    match value {
        Value::Null => json!("null"),
        Value::Bool(_) => json!("bool"),
        Value::Number(_) => json!("number"),
        Value::String(_) => json!("string"),
        Value::Array(items) => {
            let distinct: BTreeSet<String> =
                items.iter().map(|item| shape(item).to_string()).collect();
            Value::Array(
                distinct
                    .iter()
                    .map(|s| serde_json::from_str(s).unwrap())
                    .collect(),
            )
        }
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), shape(value)))
                .collect(),
        ),
    }
}

/// I dati opachi di una proiezione, per il posto in cui stanno: il tipo del
/// nodo (`t`) o la chiave che lo contiene, e la chiave del dato.
fn opaque(value: &Value, place: &str, out: &mut BTreeMap<String, BTreeSet<String>>) {
    match value {
        Value::Object(fields) => {
            let place = fields
                .get("t")
                .and_then(Value::as_str)
                .unwrap_or(place)
                .to_string();
            for (key, value) in fields {
                match (key.as_str(), value) {
                    ("k" | "sect", Value::String(blob)) => {
                        let json = base64::engine::general_purpose::STANDARD_NO_PAD
                            .decode(blob)
                            .unwrap();
                        let data: Value = serde_json::from_slice(&json).unwrap();
                        out.entry(format!("{place}.{key}"))
                            .or_default()
                            .insert(shape(&data).to_string());
                    }
                    _ => opaque(value, key, out),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| opaque(item, place, out)),
        _ => {}
    }
}

fn golden() -> Value {
    let mut by_codec: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> = BTreeMap::new();
    for (_, codec, bytes) in corpus() {
        let opened = open(codec, &bytes).unwrap();
        let projection: Value = serde_json::from_str(&opened.projection).unwrap();
        let name = format!("{codec:?}").to_lowercase();
        opaque(&projection, "root", by_codec.entry(name).or_default());
    }
    let defaults = json!({
        "CharProps": shape(&serde_json::to_value(CharProps::default()).unwrap()),
        "ParaProps": shape(&serde_json::to_value(ParaProps::default()).unwrap()),
        "SectionProps": shape(&serde_json::to_value(SectionProps::default()).unwrap()),
        "Comment": shape(&serde_json::to_value(Comment::default()).unwrap()),
    });
    let corpus: BTreeMap<String, BTreeMap<String, Vec<Value>>> = by_codec
        .into_iter()
        .map(|(codec, places)| {
            let places = places
                .into_iter()
                .map(|(place, shapes)| {
                    let shapes = shapes
                        .iter()
                        .map(|s| serde_json::from_str(s).unwrap())
                        .collect();
                    (place, shapes)
                })
                .collect();
            (codec, places)
        })
        .collect();
    json!({ "opaque_schema": OPAQUE_SCHEMA, "defaults": defaults, "corpus": corpus })
}

#[test]
fn il_golden_ha_lo_schema_corrente() {
    let path = here().join("tests/opaque_schema.golden.json");
    let now = serde_json::to_string_pretty(&golden()).unwrap() + "\n";
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &now).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    let schema = serde_json::from_str::<Value>(&committed)
        .ok()
        .and_then(|v| v["opaque_schema"].as_u64());
    assert!(
        schema.is_some_and(|s| s <= u64::from(OPAQUE_SCHEMA)),
        "il golden dichiara lo schema {schema:?}, più nuovo di OPAQUE_SCHEMA = {OPAQUE_SCHEMA}"
    );
    if schema == Some(u64::from(OPAQUE_SCHEMA)) {
        assert!(
            committed == now,
            "la forma dei dati opachi è cambiata con lo stesso schema ({OPAQUE_SCHEMA}): \
             incrementa OPAQUE_SCHEMA in src/blob.rs, aggiungi la fixture dello schema \
             precedente in tests/fixtures/opaque/ e rigenera con \
             `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test opaque_schema`"
        );
    } else {
        let previous = here().join(format!(
            "tests/fixtures/opaque/schema-{}",
            OPAQUE_SCHEMA - 1
        ));
        assert!(
            previous.is_dir(),
            "lo schema è salito a {OPAQUE_SCHEMA}: servono le fixture in {}",
            previous.display()
        );
        panic!("il golden è dello schema {schema:?}: rigeneralo con UPDATE_MIRROR=1");
    }
}

/// Il primo tratto di testo della proiezione, per una modifica minima.
fn touch(projection: &mut Projection) -> bool {
    use fub_format_rich::projection::Block;
    for block in &mut projection.blocks {
        if let Block::Para(para) = block {
            for inline in &mut para.c {
                if let Inline::Text { x, .. } = inline {
                    x.push_str(" (toccato)");
                    return true;
                }
            }
        }
    }
    false
}

#[test]
fn ogni_dato_opaco_del_corpus_si_rilegge() {
    let mut saved = 0;
    for (name, codec, bytes) in corpus() {
        let opened = open(codec, &bytes).unwrap();
        let mut projection = Projection::from_json(&opened.projection).unwrap();
        if projection.readonly.is_some() || !touch(&mut projection) {
            continue;
        }
        match save(codec, &bytes, &projection.to_json().unwrap()) {
            Ok(Saved::Bytes(_)) => saved += 1,
            other => panic!("{name}: {other:?}"),
        }
    }
    assert!(saved >= 3, "il corpus ha almeno tre file modificabili");
}

#[test]
fn una_bozza_dello_schema_0_si_salva() {
    let dir = here().join("tests/fixtures/opaque/schema-0");
    let base = std::fs::read(dir.join("base.docx")).unwrap();
    let draft = std::fs::read_to_string(dir.join("projection.json")).unwrap();
    let wanted = Projection::from_json(&draft).unwrap();
    assert_eq!((wanted.version, wanted.schema()), (1, 0));
    let Saved::Bytes(out) = save(Codec::Docx, &base, &draft).unwrap() else {
        panic!("la bozza cambia il documento");
    };
    let reopened = Projection::from_json(&open(Codec::Docx, &out).unwrap().projection).unwrap();
    assert_eq!((reopened.version, reopened.schema()), (2, OPAQUE_SCHEMA));
    // La bozza si rilegge com'era voluta, a parte la versione.
    let mut migrated = wanted.clone();
    migrated.version = reopened.version;
    migrated.opaque_schema = reopened.opaque_schema;
    assert_eq!(texts(&reopened), texts(&migrated));
}

fn texts(projection: &Projection) -> Vec<String> {
    use fub_format_rich::projection::Block;
    projection
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Para(para) => Some(
                para.c
                    .iter()
                    .filter_map(|inline| match inline {
                        Inline::Text { x, .. } => Some(x.as_str()),
                        _ => None,
                    })
                    .collect(),
            ),
            _ => None,
        })
        .collect()
}

/// Scrive la fixture dello schema 0, una volta: il documento d'esempio e una
/// sua proiezione di versione 1 con una modifica, come una bozza di prima.
#[test]
#[ignore]
fn genera_la_fixture_dello_schema_0() {
    let dir = here().join("tests/fixtures/opaque/schema-0");
    std::fs::create_dir_all(&dir).unwrap();
    let base = common::bytes(&common::sample());
    let opened = open(Codec::Docx, &base).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    assert!(touch(&mut projection));
    let mut value: Value = serde_json::from_str(&projection.to_json().unwrap()).unwrap();
    value["version"] = 1.into();
    value.as_object_mut().unwrap().remove("opaque_schema");
    std::fs::write(dir.join("base.docx"), &base).unwrap();
    std::fs::write(dir.join("projection.json"), value.to_string() + "\n").unwrap();
}
