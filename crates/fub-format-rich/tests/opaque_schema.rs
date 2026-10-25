//! **Lo schema dei dati opachi.** I dati opachi della proiezione (`k`, `sect`)
//! sono JSON dei tipi del modello di WordCraft e dei tipi di Fub che li
//! avvolgono, e viaggiano dentro bozze autorevoli: la loro forma è un formato
//! persistente, con il numero `OPAQUE_SCHEMA`.
//!
//! - `il_golden_ha_lo_schema_corrente`: `tests/opaque_schema.golden.json`
//!   tiene la **superficie serde** di quei tipi, letta dai sorgenti: ogni
//!   campo, ogni variante, ogni attributo `serde`, le `impl` a mano e le
//!   funzioni che gli attributi nominano. Un campo nuovo, anche uno che
//!   nessun documento del corpus porta, cambia il golden; e con lo stesso
//!   schema il golden non si riscrive, nemmeno con `UPDATE_MIRROR`: si
//!   incrementa `OPAQUE_SCHEMA`, si dice in `blob::readable` come si legge lo
//!   schema di prima e si scrive la bozza del nuovo.
//! - `ogni_schema_si_legge_e_ha_la_sua_bozza`: la bozza di ogni schema, in
//!   `tests/fixtures/opaque/schema-<N>/`, si legge, si salva sui suoi byte e
//!   si rilegge com'era voluta. Lo 0 è una proiezione di versione 1, di prima
//!   della 2; l'1 è di prima di WordCraft 0.9, il 2 di prima della 0.10.
//! - `ogni_dato_opaco_del_corpus_si_rilegge`: ogni dato opaco di ogni
//!   proiezione del corpus che si modifica passa il controllo di
//!   contenimento, perché un salvataggio li decodifica tutti.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use fub_abi::FormatProvider;
use fub_format_rich::projection::{Inline, Projection, OPAQUE_SCHEMA};
use fub_format_rich::{open, save, Codec, RichProvider, Saved};
use quote::ToTokens;
use serde_json::{json, Value};

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

/// La superficie serde dei tipi che i dati opachi codificano, letta dai
/// sorgenti: i crate del modello di WordCraft (`doc` e `geom`) per intero, e
/// di Fub i `*Keep` della proiezione e le chiavi dell'OpenDocument. Di ogni
/// tipo che deriva `Serialize` o `Deserialize`: gli attributi `serde`, ogni
/// campo e ogni variante, con i tipi e gli attributi `serde` e `default`;
/// poi le `impl` a mano di `Serialize`, `Deserialize` e `Default`, gli alias
/// di tipo e le funzioni che gli attributi nominano (`default = "…"`,
/// `skip_serializing_if = "…"`, `with = "…"`). I commenti non contano.
fn surface() -> BTreeMap<String, Vec<String>> {
    let vendor = here().join("../../vendor/wordcraft/crates");
    // Il nome del file, il sorgente, e quali tipi ne contano.
    type Source = (String, syn::File, fn(&str) -> bool);
    let mut sources: Vec<Source> = Vec::new();
    for krate in ["doc", "geom"] {
        let root = vendor.join(krate).join("src");
        for path in rs_files(&root) {
            let rel = path
                .strip_prefix(&root)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            sources.push((format!("wordcraft-{krate}/{rel}"), parse(&path), |_| true));
        }
    }
    sources.push((
        "fub-format-rich/projection.rs".into(),
        parse(&here().join("src/projection.rs")),
        |name| name.ends_with("Keep"),
    ));
    sources.push((
        "fub-format-rich/odt/keys.rs".into(),
        parse(&here().join("src/odt/keys.rs")),
        |_| true,
    ));
    let mut out = BTreeMap::new();
    let mut named = BTreeSet::new();
    let mut fns = Vec::new();
    for (file, ast, wanted) in &sources {
        collect(&ast.items, file, *wanted, &mut out, &mut named, &mut fns);
    }
    for (key, name, tokens) in fns {
        if named.contains(&name) {
            out.insert(key, vec![tokens]);
        }
    }
    out
}

fn rs_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(rs_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn parse(path: &Path) -> syn::File {
    syn::parse_file(&std::fs::read_to_string(path).unwrap())
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Gli attributi che decidono la forma serializzata: `serde` e `default`
/// (la variante predefinita di un enum).
fn keep_attrs(attrs: &mut Vec<syn::Attribute>) {
    attrs.retain(|attr| attr.path().is_ident("serde") || attr.path().is_ident("default"));
}

fn tokens(value: &impl ToTokens) -> String {
    value.to_token_stream().to_string()
}

/// Le funzioni che gli attributi `serde` nominano: `funzione` o
/// `Tipo::metodo`.
fn named_fns(attrs: &[syn::Attribute], named: &mut BTreeSet<String>) {
    for attr in attrs.iter().filter(|attr| attr.path().is_ident("serde")) {
        let _ = attr.parse_nested_meta(|meta| {
            let names_fn = [
                "default",
                "skip_serializing_if",
                "with",
                "serialize_with",
                "deserialize_with",
            ]
            .iter()
            .any(|key| meta.path.is_ident(key));
            if let (true, Ok(value)) = (names_fn, meta.value()) {
                if let Ok(lit) = value.parse::<syn::LitStr>() {
                    // `is_false`, o `Tipo::is_empty`: gli ultimi due segmenti.
                    let path = lit.value();
                    let segments: Vec<&str> = path.rsplit("::").take(2).collect();
                    named.insert(segments.into_iter().rev().collect::<Vec<_>>().join("::"));
                }
            }
            Ok(())
        });
    }
}

fn derives_serde(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("derive") && {
            let list = tokens(&attr.meta);
            list.contains("Serialize") || list.contains("Deserialize")
        }
    })
}

/// La prima riga di un tipo: gli attributi che restano, la specie, il nome.
fn head(
    attrs: &[syn::Attribute],
    kind: &str,
    ident: &syn::Ident,
    generics: &syn::Generics,
) -> String {
    let mut parts: Vec<String> = attrs.iter().map(tokens).collect();
    parts.push(format!("{kind} {ident}{}", tokens(generics)));
    parts.join(" ")
}

fn fields(fields: &mut syn::Fields, named: &mut BTreeSet<String>) {
    for field in fields.iter_mut() {
        named_fns(&field.attrs, named);
        keep_attrs(&mut field.attrs);
        field.vis = syn::Visibility::Inherited;
    }
}

fn collect(
    items: &[syn::Item],
    file: &str,
    wanted: fn(&str) -> bool,
    out: &mut BTreeMap<String, Vec<String>>,
    named: &mut BTreeSet<String>,
    fns: &mut Vec<(String, String, String)>,
) {
    let strip = |attrs: &mut Vec<syn::Attribute>| {
        attrs.retain(|attr| !attr.path().is_ident("doc"));
    };
    for item in items {
        match item.clone() {
            syn::Item::Struct(mut item)
                if derives_serde(&item.attrs) && wanted(&item.ident.to_string()) =>
            {
                named_fns(&item.attrs, named);
                keep_attrs(&mut item.attrs);
                fields(&mut item.fields, named);
                let mut lines = vec![head(&item.attrs, "struct", &item.ident, &item.generics)];
                lines.extend(item.fields.iter().map(tokens));
                out.insert(format!("{file}::{}", item.ident), lines);
            }
            syn::Item::Enum(mut item)
                if derives_serde(&item.attrs) && wanted(&item.ident.to_string()) =>
            {
                named_fns(&item.attrs, named);
                keep_attrs(&mut item.attrs);
                let mut lines = vec![head(&item.attrs, "enum", &item.ident, &item.generics)];
                for variant in &mut item.variants {
                    named_fns(&variant.attrs, named);
                    keep_attrs(&mut variant.attrs);
                    fields(&mut variant.fields, named);
                    lines.push(tokens(variant));
                }
                out.insert(format!("{file}::{}", item.ident), lines);
            }
            syn::Item::Impl(mut item) => {
                let trait_name = item
                    .trait_
                    .as_ref()
                    .and_then(|(_, path, _)| path.segments.last())
                    .map(|segment| segment.ident.to_string());
                let self_ty = match &*item.self_ty {
                    syn::Type::Path(path) => path.path.segments.last().map(|s| s.ident.to_string()),
                    _ => None,
                }
                .unwrap_or_else(|| tokens(&item.self_ty));
                let surface_trait = matches!(
                    trait_name.as_deref(),
                    Some("Serialize" | "Deserialize" | "Default")
                );
                if surface_trait && wanted(&self_ty) {
                    strip(&mut item.attrs);
                    for inner in &mut item.items {
                        if let syn::ImplItem::Fn(f) = inner {
                            strip(&mut f.attrs);
                        }
                    }
                    out.insert(
                        format!("{file}::impl {} for {self_ty}", trait_name.unwrap()),
                        vec![tokens(&item)],
                    );
                    continue;
                }
                for inner in &mut item.items {
                    if let syn::ImplItem::Fn(f) = inner {
                        strip(&mut f.attrs);
                        let name = format!("{self_ty}::{}", f.sig.ident);
                        fns.push((
                            format!("{file}::{self_ty}::{}", f.sig.ident),
                            name,
                            tokens(f),
                        ));
                    }
                }
            }
            syn::Item::Type(mut item) => {
                strip(&mut item.attrs);
                out.insert(format!("{file}::type {}", item.ident), vec![tokens(&item)]);
            }
            syn::Item::Fn(mut item) => {
                strip(&mut item.attrs);
                let name = item.sig.ident.to_string();
                fns.push((format!("{file}::fn {name}"), name, tokens(&item)));
            }
            syn::Item::Mod(item) => {
                if let Some((_, inner)) = &item.content {
                    // I test di un modulo non serializzano niente.
                    if item.ident != "tests" {
                        let file = format!("{file}::{}", item.ident);
                        collect(inner, &file, wanted, out, named, fns);
                    }
                }
            }
            _ => {}
        }
    }
}

fn golden() -> Value {
    json!({ "opaque_schema": OPAQUE_SCHEMA, "surface": surface() })
}

/// Il golden si riscrive soltanto con uno schema nuovo (o se manca): con lo
/// stesso schema, una forma diversa è un dato che uno schema vecchio non
/// leggerebbe più com'era scritto, e `UPDATE_MIRROR` non lo nasconde.
#[test]
fn il_golden_ha_lo_schema_corrente() {
    let path = here().join("tests/opaque_schema.golden.json");
    let now = serde_json::to_string_pretty(&golden()).unwrap() + "\n";
    let update = std::env::var_os("UPDATE_MIRROR").is_some();
    let committed = std::fs::read_to_string(&path).ok();
    let schema = committed
        .as_deref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|v| v["opaque_schema"].as_u64());
    match schema {
        Some(s) if s == u64::from(OPAQUE_SCHEMA) => assert!(
            committed.as_deref() == Some(now.as_str()),
            "la superficie serde dei dati opachi è cambiata con lo stesso schema \
             ({OPAQUE_SCHEMA}), anche con UPDATE_MIRROR: incrementa OPAQUE_SCHEMA in \
             src/blob.rs, di' in `readable` come si legge lo schema di prima, scrivi la \
             bozza dello schema nuovo con `cargo test -p fub-format-rich --test \
             opaque_schema -- --ignored genera_la_bozza`, poi rigenera con `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test \
             opaque_schema`.\nCambiato: {:?}",
            changed(committed.as_deref().unwrap_or("{}"), &now)
        ),
        Some(s) if s > u64::from(OPAQUE_SCHEMA) => {
            panic!("il golden dichiara lo schema {s}, più nuovo di OPAQUE_SCHEMA = {OPAQUE_SCHEMA}")
        }
        _ if update => std::fs::write(&path, &now).unwrap(),
        _ => panic!(
            "il golden è dello schema {schema:?}, non di {OPAQUE_SCHEMA}: rigeneralo con \
             `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test opaque_schema`"
        ),
    }
}

/// I tipi la cui superficie è diversa fra due golden.
fn changed(before: &str, after: &str) -> Vec<String> {
    let surface = |text: &str| -> BTreeMap<String, Value> {
        serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.get("surface").cloned())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    };
    let (before, after) = (surface(before), surface(after));
    let keys: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter(|key| before.get(*key) != after.get(*key))
        .cloned()
        .collect()
}

/// Ogni schema, il corrente compreso, si legge (`blob::readable`) e ha la sua
/// bozza, che si salva.
#[test]
fn ogni_schema_si_legge_e_ha_la_sua_bozza() {
    for schema in 0..=OPAQUE_SCHEMA {
        a_draft_of_schema_saves(schema);
    }
}

/// Il primo tratto di testo di un paragrafo non chiuso, per una modifica
/// minima.
fn touch(projection: &mut Projection) -> bool {
    use fub_format_rich::projection::Block;
    for block in &mut projection.blocks {
        if let Block::Para(para) = block {
            if para.locked {
                continue;
            }
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

/// La bozza di `tests/fixtures/opaque/schema-<schema>/` si apre e si salva,
/// e si rilegge com'era voluta.
fn a_draft_of_schema_saves(schema: u32) {
    let dir = here().join(format!("tests/fixtures/opaque/schema-{schema}"));
    let base = std::fs::read(dir.join("base.docx")).unwrap_or_else(|_| {
        panic!(
            "lo schema {schema} non ha la sua bozza in {}",
            dir.display()
        )
    });
    let draft = std::fs::read_to_string(dir.join("projection.json")).unwrap();
    let wanted = Projection::from_json(&draft)
        .unwrap_or_else(|error| panic!("lo schema {schema} non si legge: {error:?}"));
    assert_eq!(wanted.schema(), schema);
    let Saved::Bytes(out) = save(Codec::Docx, &base, &draft).unwrap() else {
        panic!("la bozza cambia il documento");
    };
    let reopened = Projection::from_json(&open(Codec::Docx, &out).unwrap().projection).unwrap();
    assert_eq!(
        (reopened.version, reopened.schema()),
        (fub_format_rich::projection::VERSION, OPAQUE_SCHEMA)
    );
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

/// Scrive la bozza dello schema corrente, se manca: il documento d'esempio e
/// una sua proiezione con una modifica, come la scriverebbe una bozza. Si
/// scrive con i tipi dello schema, quindi una volta per schema: quando lo
/// schema sale, quella di prima resta e prova che si legge ancora.
#[test]
#[ignore]
fn genera_la_bozza_dello_schema_corrente() {
    let dir = here().join(format!("tests/fixtures/opaque/schema-{OPAQUE_SCHEMA}"));
    if dir.join("projection.json").exists() {
        return;
    }
    std::fs::create_dir_all(&dir).unwrap();
    let base = common::bytes(&common::sample());
    let opened = open(Codec::Docx, &base).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    assert!(touch(&mut projection));
    std::fs::write(dir.join("base.docx"), &base).unwrap();
    std::fs::write(
        dir.join("projection.json"),
        projection.to_json().unwrap() + "\n",
    )
    .unwrap();
}
