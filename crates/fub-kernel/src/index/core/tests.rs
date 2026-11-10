//! Test dell'indice del core.

use super::*;
use fub_abi::Span;

#[test]
fn declared_types_change_property_filter_facets_columns_and_sort_without_reindexing() {
    use fub_abi::model::PropertyValue;
    use fub_abi::query::{QueryClause, QueryExpr, QueryLiteral};
    use fub_abi::traits::{Excerpts, PropertyFilter, PropertyTest};

    let storage = Arc::new(crate::storage::MemStorage::new());
    let settings = Arc::new(std::sync::RwLock::new(
        crate::settings::SettingsStore::open(
            camino::Utf8Path::new("/vault"),
            storage.clone(),
            crate::settings::MachineSettings::in_memory(),
        ),
    ));
    settings
        .write()
        .unwrap()
        .declare("fub.core", &crate::properties::properties_settings())
        .unwrap();
    let mut index = CoreIndex::new(
        Arc::new(crate::registry::FormatRegistry::new()),
        settings.clone(),
        crate::organization::OrganizationStore::in_memory(),
        Arc::new(crate::drafts::Drafts::open(
            camino::Utf8Path::new("/vault"),
            storage.clone(),
        )),
    );
    for (path, value) in [("a.md", "10"), ("b.md", "2")] {
        let id = DocId::new(path);
        let frontmatter = Frontmatter(
            serde_json::json!({"priority": value})
                .as_object()
                .unwrap()
                .clone(),
        );
        index.metas.insert(
            id.clone(),
            DocMeta {
                id,
                frontmatter,
                outline: Vec::new(),
                links: Vec::new(),
                anchors: Vec::new(),
            },
        );
    }

    let matching = QueryExpr {
        any: vec![QueryClause {
            all: vec![QueryLiteral {
                negated: false,
                predicate: QueryPredicate::Property {
                    filter: PropertyFilter {
                        key: "priority".into(),
                        test: PropertyTest::GreaterThan(PropertyValue::Number(3.0)),
                    },
                },
            }],
        }],
    };
    let filter = || {
        let IndexResult::Documents(rows) = index
            .query(IndexQuery::Documents {
                matching: matching.clone(),
                sort: None,
                select: PropertySelect::keys(&["priority"]),
                page: None,
                excerpts: Excerpts::Omit,
            })
            .unwrap()
        else {
            panic!("documents response");
        };
        rows.items
    };
    assert!(filter().is_empty(), "undeclared numeric strings stay text");
    assert_eq!(index.property_types(), PropertyTypes::default());

    let declaration = r#"{"version":1,"types":{"priority":"number"}}"#;
    settings
        .write()
        .unwrap()
        .set(
            crate::properties::TYPES,
            SettingValue::Text(declaration.into()),
        )
        .unwrap();
    let rows = filter();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].doc, DocId::new("a.md"));
    assert_eq!(rows[0].properties[0].value, PropertyValue::Number(10.0));

    let IndexResult::PropertyValues(facets) = index
        .query(IndexQuery::PropertyValues {
            key: "priority".into(),
            matching: QueryExpr::default(),
            page: None,
        })
        .unwrap()
    else {
        panic!("property values response");
    };
    assert_eq!(facets.items.len(), 2);
    for value in [2.0, 10.0] {
        assert!(facets
            .items
            .iter()
            .any(|item| item.value == PropertyValue::Number(value) && item.count == 1));
    }

    let IndexResult::Documents(sorted) = index
        .query(IndexQuery::Documents {
            matching: QueryExpr::default(),
            sort: Some(PropertySort {
                key: "priority".into(),
                descending: false,
            }),
            select: PropertySelect::keys(&["priority"]),
            page: None,
            excerpts: Excerpts::Omit,
        })
        .unwrap()
    else {
        panic!("documents response");
    };
    assert_eq!(
        sorted
            .items
            .iter()
            .map(|row| row.doc.as_str())
            .collect::<Vec<_>>(),
        vec!["b.md", "a.md"]
    );
    assert_eq!(
        sorted.items[0].properties[0].value,
        PropertyValue::Number(2.0)
    );

    let mut reopened = crate::settings::SettingsStore::open(
        camino::Utf8Path::new("/vault"),
        storage,
        crate::settings::MachineSettings::in_memory(),
    );
    reopened
        .declare("fub.core", &crate::properties::properties_settings())
        .unwrap();
    assert_eq!(
        reopened.effective(crate::properties::TYPES).unwrap().0,
        SettingValue::Text(declaration.into())
    );
}

fn asset(path: &str) -> VaultEntry {
    VaultEntry {
        id: DocId::new(path),
        kind: EntryKind::Asset,
        size: 1,
        mtime: 1,
        fingerprint: None,
    }
}

#[test]
fn a_bare_attachment_link_prefers_the_declared_folder() {
    let entries = BTreeMap::from([
        (
            DocId::new("attachments/photo.png"),
            asset("attachments/photo.png"),
        ),
        (DocId::new("other/photo.png"), asset("other/photo.png")),
    ]);
    let names = EntryNames::of(&entries);
    let source = DocId::new("note.md");

    let target = LinkTarget::Wiki {
        page: "photo.png".into(),
        heading: None,
        block: None,
    };
    assert_eq!(
        resolve_entry_in_folder(&entries, &names, &source, &target, Some("attachments"),),
        Some(DocId::new("attachments/photo.png"))
    );
}

#[test]
fn changing_the_declared_folder_changes_existing_link_resolution() {
    let entries = BTreeMap::from([
        (
            DocId::new("attachments/photo.png"),
            asset("attachments/photo.png"),
        ),
        (DocId::new("media/photo.png"), asset("media/photo.png")),
    ]);
    let names = EntryNames::of(&entries);
    let source = DocId::new("note.md");
    let target = LinkTarget::wiki("photo.png");
    assert_eq!(
        resolve_entry_in_folder(&entries, &names, &source, &target, Some("attachments")),
        Some(DocId::new("attachments/photo.png"))
    );
    assert_eq!(
        resolve_entry_in_folder(&entries, &names, &source, &target, Some("media")),
        Some(DocId::new("media/photo.png"))
    );
}

#[test]
fn a_dot_folder_looks_next_to_the_note_that_names_the_attachment() {
    let entries = BTreeMap::from([
        (DocId::new("a/photo.png"), asset("a/photo.png")),
        (DocId::new("b/img/photo.png"), asset("b/img/photo.png")),
    ]);
    let names = EntryNames::of(&entries);
    let target = LinkTarget::wiki("photo.png");
    assert_eq!(
        resolve_entry_in_folder(
            &entries,
            &names,
            &DocId::new("a/note.md"),
            &target,
            Some("./")
        ),
        Some(DocId::new("a/photo.png"))
    );
    assert_eq!(
        resolve_entry_in_folder(
            &entries,
            &names,
            &DocId::new("b/note.md"),
            &target,
            Some("./img")
        ),
        Some(DocId::new("b/img/photo.png"))
    );
}

#[test]
fn a_path_link_with_a_fragment_names_the_same_point_as_a_wikilink() {
    // Un `[t](Note/Doppia.md#...)` nomina lo stesso punto di `[[Doppia#...]]`:
    // il frammento si divide con `split_fragment` e `^` separa il blocco
    // come in `parse_wikilink_inner`. Senza frammento o con un punto che
    // non c'è più la risposta resta il documento con `at: None`.
    let registry = std::sync::Arc::new(crate::registry::FormatRegistry::new());
    let storage = std::sync::Arc::new(crate::storage::MemStorage::new());
    let machine = crate::settings::MachineSettings::in_memory();
    let settings = std::sync::Arc::new(std::sync::RwLock::new(
        crate::settings::SettingsStore::open(
            camino::Utf8Path::new("/vault"),
            storage.clone(),
            machine,
        ),
    ));
    let organization = crate::organization::OrganizationStore::in_memory();
    let drafts = std::sync::Arc::new(crate::drafts::Drafts::open(
        camino::Utf8Path::new("/vault"),
        storage,
    ));
    let mut index = CoreIndex::new(registry, settings, organization, drafts);
    let id = DocId::new("Note/Doppia.md");
    index.metas.insert(
        id.clone(),
        DocMeta {
            id: id.clone(),
            frontmatter: Frontmatter::default(),
            outline: vec![Heading {
                level: 1,
                text: "Il gatto".to_string(),
                slug: "il-gatto".to_string(),
                span: Span::new(0, 10),
                explicit_anchor: None,
            }],
            links: Vec::new(),
            anchors: vec![Anchor {
                id: "risveglio".to_string(),
                span: Span::new(11, 20),
                marker: Span::new(15, 20),
            }],
        },
    );
    index.set_entry(VaultEntry {
        id: id.clone(),
        kind: EntryKind::Document,
        size: 20,
        mtime: 1,
        fingerprint: Some(Revision::new("rev1")),
    });
    index.rebuild_graph();
    let wiki_section = index
        .resolve(
            &LinkTarget::Wiki {
                page: "Doppia".into(),
                heading: Some("Il gatto".into()),
                block: None,
            },
            None,
        )
        .expect("la nota c'è");
    let path_section = index
        .resolve(&LinkTarget::Path("Note/Doppia.md#Il%20gatto".into()), None)
        .expect("la nota c'è");
    assert_eq!(path_section.doc, wiki_section.doc);
    assert_eq!(path_section.at, wiki_section.at);
    assert_eq!(
        path_section.at.as_ref().and_then(|p| p.anchor.as_deref()),
        Some("il-gatto")
    );
    let wiki_block = index
        .resolve(
            &LinkTarget::Wiki {
                page: "Doppia".into(),
                heading: None,
                block: Some("risveglio".into()),
            },
            None,
        )
        .expect("la nota c'è");
    let path_block = index
        .resolve(&LinkTarget::Path("Note/Doppia.md#^risveglio".into()), None)
        .expect("la nota c'è");
    assert_eq!(path_block.at, wiki_block.at);
    assert_eq!(
        path_block.at.as_ref().and_then(|p| p.anchor.as_deref()),
        Some("risveglio")
    );
    let vanished = index
        .resolve(
            &LinkTarget::Path("Note/Doppia.md#mai-esistito".into()),
            None,
        )
        .expect("la nota c'è lo stesso");
    assert_eq!(vanished.doc, id);
    assert_eq!(vanished.at, None);
}

/// Le voci di una cartella si chiedono al suo tratto della mappa, non al
/// vault: chi lo chiede a ogni evento (il versioning, per la dimensione di
/// un file) pagava il vault intero ogni volta. I vicini di nome che non
/// stanno nella cartella restano fuori, e la radice resta tutto.
#[test]
fn the_entries_of_a_folder_cost_the_folder_not_the_vault() {
    let storage = Arc::new(crate::storage::MemStorage::new());
    let settings = Arc::new(std::sync::RwLock::new(
        crate::settings::SettingsStore::open(
            camino::Utf8Path::new("/vault"),
            storage.clone(),
            crate::settings::MachineSettings::in_memory(),
        ),
    ));
    let mut index = CoreIndex::new(
        Arc::new(crate::registry::FormatRegistry::new()),
        settings,
        crate::organization::OrganizationStore::in_memory(),
        Arc::new(crate::drafts::Drafts::open(
            camino::Utf8Path::new("/vault"),
            storage,
        )),
    );
    let entry = |path: &str| VaultEntry {
        id: DocId::new(path),
        kind: EntryKind::Asset,
        size: 1,
        mtime: 0,
        fingerprint: None,
    };
    const N: usize = 100_000;
    for i in 0..N {
        index.set_entry_from_scan(entry(&format!("archivio/{i}.png")));
    }
    for path in [
        "a b/x.png",
        "a-b/x.png",
        "a.png",
        "a/x.png",
        "a/y/z.png",
        "ab/x.png",
    ] {
        index.set_entry_from_scan(entry(path));
    }
    let ids = |index: &CoreIndex, scope: Option<FolderScope>| -> Vec<String> {
        let Ok(IndexResult::Entries(page)) = index.query(IndexQuery::Entries {
            of_kind: None,
            within: scope,
            page: None,
        }) else {
            panic!("il kernel serve l'anagrafe");
        };
        page.items.into_iter().map(|entry| entry.id.0).collect()
    };

    for _ in 0..N / 5 {
        assert_eq!(ids(&index, Some(FolderScope::direct("/a/"))), ["a/x.png"]);
    }
    assert_eq!(
        ids(
            &index,
            Some(FolderScope {
                path: "a".into(),
                descendants: true,
            })
        ),
        ["a/x.png", "a/y/z.png"]
    );
    assert_eq!(ids(&index, Some(FolderScope::direct(""))), ["a.png"]);
    assert_eq!(ids(&index, None).len(), N + 6);
}
