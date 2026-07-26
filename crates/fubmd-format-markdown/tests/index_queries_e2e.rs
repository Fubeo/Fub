//! Il canale dati della decisione 0005 su un vault vero: grafo, proprietà, faccette,
//! salute, finestre.
//!
//! Sta qui e non fra i test del kernel perché serve markdown *vero* — è dal
//! frontmatter e dai link di note scritte a mano che queste query prendono le
//! risposte, e un provider finto proverebbe solo che il kernel sa interrogare
//! sé stesso. Il giro è quello che farà una view (anche in WASM): una
//! `IndexQuery`, una `IndexResult`, nessuna scorciatoia sul `Workspace`.

use camino::Utf8PathBuf;
use fubmd_abi::model::{DocId, PropertyValue};
use fubmd_abi::traits::{
    HealthCheck, IndexQuery, IndexResult, LinkDirection, Page, PropertyFilter, PropertySort,
    PropertyTest,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Un vault a quattro note:
///
/// - `Progetti/Alpha.md` → `Beta` e un wikilink che non risolve;
/// - `Progetti/Beta.md` → `Alpha`;
/// - `Archivio/Gamma.md` → `Beta`;
/// - `Diario.md` → nessuno, e nessuno la nomina (orfana), con un'immagine.
fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write(
        "Progetti/Alpha.md",
        "---\ntipo: progetto\nstato: attivo\npriorita: 2\n---\n\
         # Alpha\n\nVedi [[Beta]] e [[Nota che non c'è]]. #lavoro\n",
    );
    write(
        "Progetti/Beta.md",
        "---\ntipo: progetto\nstato: chiuso\npriorita: 10\n---\n\
         Rimanda ad [[Alpha]]. #lavoro\n",
    );
    write(
        "Archivio/Gamma.md",
        "---\ntipo: nota\nstato: attivo\n---\nCita [[Beta]]. #archivio\n",
    );
    write(
        "Diario.md",
        "---\ntipo: nota\n---\nNessuno mi nomina. ![foto](img/foto.png)\n",
    );

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

fn query(ws: &Workspace, q: IndexQuery) -> IndexResult {
    ws.query_index(q).expect("il kernel serve questa query")
}

// --- grafo -----------------------------------------------------------------

#[test]
fn the_graph_answers_through_the_contract() {
    let (_g, ws) = vault();

    let IndexResult::Neighbors(out) = query(
        &ws,
        IndexQuery::Neighbors {
            doc: DocId::new("Progetti/Beta.md"),
            direction: LinkDirection::Inbound,
            depth: 1,
            page: None,
        },
    ) else {
        panic!("attesi vicini");
    };
    let sources: Vec<String> = out.items.iter().map(|n| n.doc.to_string()).collect();
    assert_eq!(
        sources,
        ["Archivio/Gamma.md", "Progetti/Alpha.md"],
        "entranti = chi la nomina"
    );
    assert_eq!(out.total, 2);

    // Due passi in avanti da Gamma: Beta (1) e Alpha (2), col `via` che
    // ricostruisce gli archi — è ciò che disegna un grafo locale.
    let IndexResult::Neighbors(walk) = query(
        &ws,
        IndexQuery::Neighbors {
            doc: DocId::new("Archivio/Gamma.md"),
            direction: LinkDirection::Outbound,
            depth: 2,
            page: None,
        },
    ) else {
        panic!("attesi vicini");
    };
    let edges: Vec<(String, String, u8)> = walk
        .items
        .iter()
        .map(|n| (n.via.to_string(), n.doc.to_string(), n.depth))
        .collect();
    assert_eq!(
        edges,
        [
            (
                "Archivio/Gamma.md".to_string(),
                "Progetti/Beta.md".to_string(),
                1
            ),
            (
                "Progetti/Beta.md".to_string(),
                "Progetti/Alpha.md".to_string(),
                2
            ),
        ]
    );
}

// --- proprietà -------------------------------------------------------------

fn filter(key: &str, test: PropertyTest) -> PropertyFilter {
    PropertyFilter {
        key: key.to_string(),
        test,
    }
}

fn rows(ws: &Workspace, q: IndexQuery) -> (Vec<String>, u32) {
    let IndexResult::Properties(page) = query(ws, q) else {
        panic!("attese proprietà");
    };
    (
        page.items.iter().map(|r| r.doc.to_string()).collect(),
        page.total,
    )
}

#[test]
fn properties_filter_sort_and_select_like_a_collection_would() {
    let (_g, ws) = vault();

    let (ids, total) = rows(
        &ws,
        IndexQuery::Properties {
            filter: vec![filter(
                "tipo",
                PropertyTest::Equals(PropertyValue::Text("progetto".into())),
            )],
            sort: Some(PropertySort {
                key: "priorita".to_string(),
                descending: true,
            }),
            select: vec!["stato".to_string()],
            page: None,
        },
    );
    assert_eq!(
        ids,
        ["Progetti/Beta.md", "Progetti/Alpha.md"],
        "priorità decrescente: 10 prima di 2"
    );
    assert_eq!(total, 2);

    // `select` è la lista delle colonne: la riga porta quella, non tutto il
    // frontmatter.
    let IndexResult::Properties(page) = query(
        &ws,
        IndexQuery::Properties {
            filter: vec![filter(
                "tipo",
                PropertyTest::Equals(PropertyValue::Text("progetto".into())),
            )],
            sort: None,
            select: vec!["stato".to_string()],
            page: None,
        },
    ) else {
        panic!("attese proprietà");
    };
    let keys: Vec<&str> = page.items[0]
        .properties
        .iter()
        .map(|p| p.key.as_str())
        .collect();
    assert_eq!(keys, ["stato"]);
}

#[test]
fn a_page_of_properties_is_a_window_over_a_stable_order() {
    let (_g, ws) = vault();
    let all = IndexQuery::Properties {
        filter: Vec::new(),
        sort: None,
        select: Vec::new(),
        page: None,
    };
    let (everything, total) = rows(&ws, all);
    assert_eq!(total, 4);

    let mut walked = Vec::new();
    for offset in [0, 2] {
        let (ids, page_total) = rows(
            &ws,
            IndexQuery::Properties {
                filter: Vec::new(),
                sort: None,
                select: Vec::new(),
                page: Some(Page::new(offset, 2)),
            },
        );
        assert_eq!(page_total, 4, "il totale è del vault, non della pagina");
        walked.extend(ids);
    }
    assert_eq!(
        walked, everything,
        "due pagine da due ricompongono l'elenco, senza salti né ripetizioni"
    );
}

#[test]
fn property_values_are_the_facets_of_a_field() {
    let (_g, ws) = vault();
    let IndexResult::PropertyValues(page) = query(
        &ws,
        IndexQuery::PropertyValues {
            key: "tipo".to_string(),
            filter: Vec::new(),
            page: None,
        },
    ) else {
        panic!("attese faccette");
    };
    let facets: Vec<(String, u32)> = page
        .items
        .iter()
        .map(|f| match &f.value {
            PropertyValue::Text(t) => (t.clone(), f.count),
            other => panic!("valore inatteso: {other:?}"),
        })
        .collect();
    assert_eq!(
        facets,
        [("nota".to_string(), 2), ("progetto".to_string(), 2)]
    );

    // Le faccette si contano sul sottoinsieme filtrato: fra le note `attivo`
    // c'è un progetto e una nota.
    let IndexResult::PropertyValues(page) = query(
        &ws,
        IndexQuery::PropertyValues {
            key: "tipo".to_string(),
            filter: vec![filter(
                "stato",
                PropertyTest::Equals(PropertyValue::Text("attivo".into())),
            )],
            page: None,
        },
    ) else {
        panic!("attese faccette");
    };
    assert_eq!(page.items.len(), 2);
    assert!(page.items.iter().all(|f| f.count == 1));
}

// --- salute del vault ------------------------------------------------------

#[test]
fn the_health_of_the_vault_is_a_query_like_the_others() {
    let (_g, ws) = vault();

    let IndexResult::VaultHealth(broken) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::BrokenLinks,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    let reported: Vec<(String, Option<String>)> = broken
        .items
        .iter()
        .map(|i| (i.doc.to_string(), i.detail.clone()))
        .collect();
    assert_eq!(
        reported,
        [(
            "Progetti/Alpha.md".to_string(),
            Some("Nota che non c'è".to_string())
        )],
        "solo il wikilink che non risolve; l'immagine di Diario.md non è un link rotto (§14.1)"
    );
    let issue = &broken.items[0];
    let span = issue.span.expect("un link rotto ha un punto nel sorgente");
    let source = ws
        .read_source(&DocId::new("Progetti/Alpha.md"))
        .expect("lettura");
    assert_eq!(
        &source[span.start..span.end],
        "[[Nota che non c'è]]",
        "lo span punta al link, non al documento"
    );

    let IndexResult::VaultHealth(orphans) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::OrphanDocuments,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    let ids: Vec<String> = orphans.items.iter().map(|i| i.doc.to_string()).collect();
    assert_eq!(
        ids,
        ["Archivio/Gamma.md", "Diario.md"],
        "orfana = nessuno la nomina; Gamma linka ma non è linkata"
    );
}

// --- le vecchie query, con la finestra ------------------------------------

#[test]
fn backlinks_and_tags_keep_their_answer_and_gain_a_window() {
    let (_g, ws) = vault();

    let IndexResult::Backlinks(page) = query(
        &ws,
        IndexQuery::Backlinks {
            target: DocId::new("Progetti/Beta.md"),
            page: Some(Page::first(1)),
        },
    ) else {
        panic!("attesi backlink");
    };
    assert_eq!(page.items.len(), 1, "una pagina da uno");
    assert_eq!(page.total, 2, "ma i backlink sono due");

    let IndexResult::Tags(tags) = query(&ws, IndexQuery::Tags { page: None }) else {
        panic!("attesi tag");
    };
    let names: Vec<(&str, u32)> = tags
        .items
        .iter()
        .map(|t| (t.name.as_str(), t.count))
        .collect();
    assert_eq!(names, [("archivio", 1), ("lavoro", 2)]);
}
