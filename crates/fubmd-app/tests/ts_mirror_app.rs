//! Il gemello di `crates/fubmd-features/tests/ts_mirror.rs` per i tipi che il
//! webview riceve dall'**app** e non dal contratto: `VaultInfo`,
//! `EmbedContent`, `WorkspaceMeta`. Erano il caso peggiore del confine — mirror
//! TS di struct dell'app che nessun test legava.
//!
//! Stesso meccanismo: la fixture è generata da serde (la stessa
//! serializzazione che attraversa l'IPC), committata, e verificata dal lato TS
//! in `frontend/src/host/mirror.test.ts`. Rigenerazione: `UPDATE_MIRROR=1 cargo
//! test -p fubmd-app --test ts_mirror_app`.

use fubmd_app_lib::{EmbedContent, GraphData, GraphEdge, VaultInfo, WorkspaceMeta};
use serde_json::{json, Value};

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).expect("serializza")
}

fn expected() -> Value {
    // La costruzione con TUTTI i campi è la guardia di esaustività: un campo
    // aggiunto a una struct non compila finché non è anche qui.
    json!({
        "VaultInfo": [to_value(VaultInfo {
            root: "/vault".into(),
            documents: vec!["a.md".into()],
            extensions: vec!["md".into()],
            versioning: true,
        })],
        "EmbedContent": [to_value(EmbedContent {
            doc_id: "a.md".into(),
            html: "<p>x</p>".into(),
        })],
        "GraphData": [to_value(GraphData {
            nodes: vec!["a.md".into(), "b.md".into()],
            edges: vec![GraphEdge { from: "a.md".into(), to: "b.md".into() }],
        })],
        "WorkspaceMeta": [to_value(WorkspaceMeta {
            icons: [("p".to_string(), "📁".to_string())].into_iter().collect(),
            pinned: vec!["a.md".into()],
            order: [("".to_string(), vec!["a.md".to_string()])].into_iter().collect(),
            spaces: vec!["p".into()],
        })],
    })
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/__fixtures__/mirror-samples-app.json"
    ))
}

#[test]
fn the_app_side_ts_mirror_fixture_is_in_sync_with_the_rust_types() {
    let expected = expected();
    let path = fixture_path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("crea la cartella delle fixture");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture dei mirror dell'app mancante ({}): {e}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fubmd-app --test ts_mirror_app`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture dei mirror dell'app è stantia: un tipo è cambiato senza \
         rigenerarla (`UPDATE_MIRROR=1 cargo test -p fubmd-app --test \
         ts_mirror_app`), poi riallinea `frontend/src/host/contract.ts` finché \
         `mirror.test.ts` non torna verde."
    );
}
