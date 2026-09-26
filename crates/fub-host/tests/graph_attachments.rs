//! **Il filtro «mostra allegati» del grafo disegna gli allegati** (I63).
//!
//! Il grafo dei link tiene solo documenti: un `![[foto.png]]` non ci entra, e
//! il filtro della vista aveva quindi solo archi a cui non arrivava mai niente.
//! Qui il vault è vero, con il registro dei formati e l'anagrafe veri: gli
//! allegati li porta `Neighbors`, chi li nomina lo dice `Backlinks`, e la vista
//! li mostra o li nasconde secondo il filtro.
#![cfg(feature = "graph")]

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::query::QueryExpr;
use fub_abi::traits::{IndexQuery, IndexResult, LinkDirection, ViewInstance};
use fub_abi::UiKind;
use fub_features::graph::{GRAPH_ID, GRAPH_VIEW};
use fub_host::Host;

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::create_dir(root.join("media")).unwrap();
    std::fs::write(root.join("media/foto.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    std::fs::write(root.join("doc.pdf"), b"%PDF-1.4\n").unwrap();
    std::fs::write(root.join("schema.jpg"), b"\xff\xd8\xff").unwrap();
    std::fs::write(
        root.join("Altra.md"),
        "# Altra\n\n![[schema.jpg]] ![[foto.png]]\n",
    )
    .unwrap();
    std::fs::write(
        root.join("Nota.md"),
        "Vedi ![[foto.png]] e [[Altra]].\n\nIl [manuale](doc.pdf).\n",
    )
    .unwrap();
    let root = root.canonicalize_utf8().expect("canonical");
    (dir, root)
}

fn graph(host: &Host, root: &Utf8PathBuf) -> (Vec<String>, Vec<(String, String)>) {
    let tree = host
        .render_view(Some(root.as_str()), &ViewInstance::only(GRAPH_VIEW))
        .expect("the graph renders");
    let UiKind::Custom { payload, .. } = tree.kind else {
        panic!("the graph is a custom node: {tree:?}");
    };
    let nodes = payload["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap().to_string())
        .collect();
    let edges = payload["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["from"].as_str().unwrap().to_string(),
                e["to"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    (nodes, edges)
}

fn edge(from: &str, to: &str) -> (String, String) {
    (from.to_string(), to.to_string())
}

#[test]
fn the_attachments_filter_draws_the_embedded_files() {
    let (_dir, root) = vault();
    let host = Host::without_watcher();
    host.open(&root).expect("the vault opens");
    host.wait_indexed(Some(root.as_str())).expect("indexed");
    let vault = Some(root.as_str());

    // Il contratto: gli allegati sono foglie uscenti della nota che li nomina,
    // un passo oltre; uno già raggiunto più vicino non si ripete.
    let neighbors = match host
        .query_index(
            vault,
            IndexQuery::Neighbors {
                seeds: QueryExpr::docs(vec![DocId::new("Nota.md")]),
                direction: LinkDirection::Outbound,
                depth: 2,
                page: None,
            },
        )
        .expect("neighbors")
    {
        IndexResult::Neighbors(page) => page
            .items
            .into_iter()
            .map(|n| (n.via.to_string(), n.doc.to_string(), n.depth))
            .collect::<Vec<_>>(),
        other => panic!("expected neighbors, got {other:?}"),
    };
    assert_eq!(
        neighbors,
        [
            ("Nota.md".into(), "Altra.md".into(), 1),
            ("Nota.md".into(), "doc.pdf".into(), 1),
            ("Nota.md".into(), "media/foto.png".into(), 1),
            ("Altra.md".into(), "schema.jpg".into(), 2),
        ]
    );
    let backlinks = match host
        .query_index(
            vault,
            IndexQuery::Backlinks {
                target: DocId::new("media/foto.png"),
                page: None,
            },
        )
        .expect("backlinks")
    {
        IndexResult::Backlinks(page) => page.items,
        other => panic!("expected backlinks, got {other:?}"),
    };
    let sources: Vec<_> = backlinks.iter().map(|b| b.source.as_str()).collect();
    assert_eq!(
        sources,
        ["Altra.md", "Nota.md"],
        "two notes embed the picture"
    );

    // La vista, di default: il grafo è di note.
    let (nodes, edges) = graph(&host, &root);
    assert_eq!(nodes, ["Altra.md", "Nota.md"]);
    assert_eq!(edges, [edge("Nota.md", "Altra.md")]);

    // Col filtro acceso gli allegati entrano, nodi e archi.
    host.set_view_state(
        vault,
        GRAPH_ID,
        GRAPH_VIEW,
        "filter",
        Some(serde_json::json!({ "show_attachments": true })),
    )
    .expect("filter saved");
    let (nodes, edges) = graph(&host, &root);
    assert_eq!(
        nodes,
        [
            "Altra.md",
            "Nota.md",
            "doc.pdf",
            "media/foto.png",
            "schema.jpg"
        ]
    );
    assert_eq!(
        edges,
        [
            edge("Altra.md", "media/foto.png"),
            edge("Altra.md", "schema.jpg"),
            edge("Nota.md", "Altra.md"),
            edge("Nota.md", "doc.pdf"),
            edge("Nota.md", "media/foto.png"),
        ]
    );
}
