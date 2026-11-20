//! La pagina del tipo (E5): sotto la nota di un tipo, resa e mai scritta, le
//! note di quel tipo, con le sue proprietà in evidenza.
//!
//! Le note sono quelle che [`note_types::notes_of_type`] dà al tipo (le stesse
//! di [`note_types::typed_notes`], senza ordinare quelle degli altri tipi): la stessa
//! risoluzione dei conteggi del cassetto e della testata (`tipo` come link,
//! percorso o nome, senza distinguere maiuscole), quindi la pagina, il
//! cassetto e la testata dicono la stessa cosa. La vista non scrive niente e
//! il tipo resta com'è: la shell la monta come widget dopo l'ultima riga
//! (`markdown/type-page.ts`), quindi non è nel file, né nel modello che il tipo
//! copia nelle note nuove, né nell'export. Si ridisegna all'apertura e a ogni
//! evento dell'indice, mai per battuta.
//!
//! La shell passa la nota aperta (`doc`): qui si controlla che sia davvero un
//! tipo, con la cartella dei tipi di adesso. Se non lo è (o i tipi sono
//! spenti) la vista non mostra niente.

use super::*;
use crate::note_types::{self, TypeRef};

/// La vista: un esemplare per tipo aperto, dentro la nota.
pub const NOTE_TYPE_PAGE_VIEW: &str = "note_type_page";
/// Il gesto su una riga: apre la nota.
const TYPE_PAGE_OPEN: &str = "note_type.page.open";

const TYPE_PAGE_TITLE: &str = "note_type.page.title";
const TYPE_PAGE_DOC: &str = "note_type.page.doc";
const TYPE_PAGE_NOTES: &str = "note_type.page.notes";
const TYPE_PAGE_NONE: &str = "note_type.page.none";
const TYPE_PAGE_MORE: &str = "note_type.page.more";
const A_TYPE: &str = "type";

/// Quante righe mostra la pagina: le altre si contano («E altre 950 note»).
pub(super) const TYPE_PAGE_ROWS: usize = 50;
/// La chiave del gruppo: la shell lo tiene chiuso attraverso i ridisegni.
const KEY_NOTES: &str = "type-notes";

/// La dichiarazione: nell'area principale come la pagina del giorno, coi
/// parametri obbligatori, quindi non compare fra le viste che si aprono da
/// sole.
pub(super) fn type_page_spec() -> ViewSpec {
    ViewSpec::new(
        NOTE_TYPE_PAGE_VIEW,
        Text::key(TYPE_PAGE_TITLE),
        ViewSurface::Main,
    )
    .with_icon("template")
    .with_params(vec![ParamSpec::new(
        DOC,
        Text::key(TYPE_PAGE_DOC),
        ParamKind::Text,
    )
    .required()])
}

/// Il tipo che la nota `doc` è, con la cartella dei tipi di adesso.
fn type_of_page(instance: &ViewInstance, types: &[TypeRef]) -> Option<usize> {
    let doc = instance.params.get(DOC)?.as_str()?;
    types.iter().position(|t| t.doc.as_str() == doc)
}

/// La pagina del tipo, o niente se la nota non è un tipo.
pub(super) fn type_page(
    instance: &ViewInstance,
    host: &dyn ReadApi,
) -> Result<UiNode, PluginError> {
    let types = note_types::type_refs(host)?;
    let Some(at) = type_of_page(instance, &types) else {
        return Ok(UiNode::column(0, Vec::new()));
    };
    let reference = &types[at];
    // Le proprietà in evidenza del tipo sono la riga di ogni nota; un tipo
    // che non si legge elenca le sue note lo stesso, col nome solo.
    let featured = match note_types::load_type(host, reference.clone()) {
        Ok(Ok(found)) => found.featured,
        Ok(Err(_)) | Err(_) => Vec::new(),
    };
    let extra: Vec<&str> = featured.iter().map(String::as_str).collect();
    let folder = note_types::types_folder(host);
    let (total, notes) =
        note_types::notes_of_type(host, &types, folder.as_deref(), at, &extra, TYPE_PAGE_ROWS)?;
    let children = if total == 0 {
        vec![UiNode::empty_state(Text::message(
            TYPE_PAGE_NONE,
            vec![Arg::text(A_TYPE, reference.name.clone())],
        ))]
    } else {
        let items = notes
            .iter()
            .take(TYPE_PAGE_ROWS)
            .map(|row| {
                UiNode::list_item(
                    Text::from(row.doc.page_name().to_string()),
                    summary(row, &featured).map(Text::from),
                    Some(ActionRef::with(
                        TYPE_PAGE_OPEN,
                        serde_json::json!({ DOC: row.doc.as_str() }),
                    )),
                )
                .with_key(row.doc.as_str())
            })
            .collect();
        let mut out = vec![UiNode::list(items)];
        if total > TYPE_PAGE_ROWS {
            out.push(UiNode::text(Text::message(
                TYPE_PAGE_MORE,
                vec![count(total - TYPE_PAGE_ROWS)],
            )));
        }
        out
    };
    Ok(UiNode::column(
        0,
        vec![UiNode::keyed(
            KEY_NOTES,
            UiKind::Section {
                title: Text::message(
                    TYPE_PAGE_NOTES,
                    vec![Arg::text(A_TYPE, reference.name.clone()), count(total)],
                ),
                collapsed: false,
                children,
            },
        )],
    ))
}

/// I valori delle proprietà in evidenza di una nota, nell'ordine del tipo,
/// quelli vuoti saltati: «Frank Herbert · true».
fn summary(row: &fub_abi::traits::DocumentMatch, featured: &[String]) -> Option<String> {
    let shown: Vec<String> = featured
        .iter()
        .filter_map(|key| row.properties.iter().find(|p| &p.key == key))
        .filter_map(|p| match &p.value {
            PropertyValue::Empty | PropertyValue::Bool(false) => None,
            // Una casella spuntata dice il suo nome: «letto», non «true».
            PropertyValue::Bool(true) => Some(p.key.clone()),
            value => Some(super::property_display(value)),
        })
        .filter(|text| !text.trim().is_empty())
        .collect();
    (!shown.is_empty()).then(|| shown.join(" · "))
}

fn count(n: usize) -> Arg {
    Arg::int(A_COUNT, i64::try_from(n).unwrap_or(i64::MAX))
}

/// Un gesto della pagina: una riga apre la sua nota.
pub(super) fn type_page_action(action: &UiAction) -> ViewUpdate {
    if action.action.0 != TYPE_PAGE_OPEN {
        return ViewUpdate::None;
    }
    match action.payload.get(DOC).and_then(|v| v.as_str()) {
        Some(doc) => ViewUpdate::Navigate {
            doc_id: doc.to_string(),
        },
        None => ViewUpdate::None,
    }
}

pub(super) fn type_page_strings_it(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(TYPE_PAGE_TITLE, "Le note del tipo")
        .with(TYPE_PAGE_DOC, "Tipo")
        .with(TYPE_PAGE_NOTES, "Note di tipo {type} · {count}")
        .with(
            TYPE_PAGE_NONE,
            "Ancora nessuna nota di tipo {type}: «Nuova nota» le crea da qui.",
        )
        .with(TYPE_PAGE_MORE, "E altre {count} note.")
}

pub(super) fn type_page_strings_en(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(TYPE_PAGE_TITLE, "Notes of the type")
        .with(TYPE_PAGE_DOC, "Type")
        .with(TYPE_PAGE_NOTES, "{type} notes · {count}")
        .with(
            TYPE_PAGE_NONE,
            "No {type} notes yet: «New note» creates them from here.",
        )
        .with(TYPE_PAGE_MORE, "And {count} more notes.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note_types::{vault, with_types_folder, LIBRO};
    use fub_abi::traits::{HostQuery, VaultRead, ViewProvider};
    use fub_sdk::testing::MemoryHost;

    fn page(host: &MemoryHost, doc: &str) -> serde_json::Value {
        let node = PropertiesView
            .render_view(
                &ViewInstance::new(
                    NOTE_TYPE_PAGE_VIEW,
                    "main",
                    serde_json::json!({ "doc": doc }),
                ),
                host,
            )
            .unwrap();
        serde_json::to_value(node).unwrap()
    }

    /// Le note elencate, nell'ordine in cui le disegna la pagina.
    fn opened(tree: &serde_json::Value) -> Vec<String> {
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }

    fn walk(node: &serde_json::Value, out: &mut Vec<String>) {
        match node {
            serde_json::Value::Object(map) => {
                if map
                    .get("action")
                    .and_then(|a| a.get("action"))
                    .and_then(|a| a.as_str())
                    == Some(TYPE_PAGE_OPEN)
                {
                    if let Some(doc) = map["action"]
                        .pointer("/payload/doc")
                        .and_then(|v| v.as_str())
                    {
                        out.push(doc.to_string());
                    }
                }
                for value in map.values() {
                    walk(value, out);
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|item| walk(item, out)),
            _ => {}
        }
    }

    fn drawn(tree: &serde_json::Value) -> String {
        tree.to_string()
    }

    #[test]
    fn the_page_lists_the_notes_of_the_type_in_every_form_of_tipo() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Quadro.md", "---\nicon: image\n---\n"),
            (
                "Biblioteca/Dune.md",
                "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Frank Herbert\n---\n",
            ),
            ("Emma.md", "---\ntipo: libro\nautore:\n---\n"),
            ("Letture/Ulisse.md", "---\ntipo: \"[[Libro]]\"\n---\n"),
            ("Gioconda.md", "---\ntipo: \"[[Tipi/Quadro]]\"\n---\n"),
            ("Senza.md", "testo\n"),
        ]);
        let tree = page(&host, "Tipi/Libro.md");
        assert_eq!(
            opened(&tree),
            ["Biblioteca/Dune.md", "Emma.md", "Letture/Ulisse.md"]
        );
        let text = drawn(&tree);
        assert!(text.contains(TYPE_PAGE_NOTES), "{text}");
        // La riga dice le proprietà in evidenza del tipo.
        assert!(text.contains("Frank Herbert"), "{text}");
        // Il cassetto conta le stesse note.
        assert_eq!(note_types::counts(&host).unwrap()[0].notes, 3);
    }

    #[test]
    fn a_note_that_is_not_a_type_has_no_page() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
        ]);
        assert!(!drawn(&page(&host, "Dune.md")).contains(TYPE_PAGE_NOTES));
        assert!(!drawn(&page(&host, "Tipi/Nessuno.md")).contains(TYPE_PAGE_NOTES));
    }

    #[test]
    fn the_page_follows_the_types_folder_of_now() {
        let docs = [
            ("Tipi/Libro.md", LIBRO),
            ("Modelli/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
        ];
        let moved = with_types_folder(vault(&docs), "Modelli");
        assert!(!drawn(&page(&moved, "Tipi/Libro.md")).contains(TYPE_PAGE_NOTES));
        assert_eq!(opened(&page(&moved, "Modelli/Libro.md")), ["Dune.md"]);
        // I tipi spenti (la cartella vuota): nessuna pagina.
        let off = with_types_folder(vault(&docs), "");
        assert!(!drawn(&page(&off, "Tipi/Libro.md")).contains(TYPE_PAGE_NOTES));
    }

    #[test]
    fn a_type_without_notes_says_so_and_an_unreadable_one_still_lists() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Rotto.md", "---\nicon: [a\n---\n"),
            ("Pezzo.md", "---\ntipo: Rotto\n---\n"),
        ]);
        let empty = drawn(&page(&host, "Tipi/Libro.md"));
        assert!(empty.contains(TYPE_PAGE_NONE), "{empty}");
        assert_eq!(opened(&page(&host, "Tipi/Rotto.md")), ["Pezzo.md"]);
    }

    #[test]
    fn the_page_writes_nothing_and_a_row_opens_its_note() {
        let mut host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
        ]);
        let docs = ["Tipi/Libro.md", "Dune.md"];
        let before: Vec<String> = docs
            .iter()
            .map(|doc| host.read_document(&DocId::new(*doc)).unwrap())
            .collect();
        let _ = page(&host, "Tipi/Libro.md");
        let instance = ViewInstance::new(
            NOTE_TYPE_PAGE_VIEW,
            "main",
            serde_json::json!({ "doc": "Tipi/Libro.md" }),
        );
        let update = PropertiesView
            .on_action(
                &instance,
                UiAction {
                    action: fub_abi::ui::ActionId(TYPE_PAGE_OPEN.into()),
                    payload: serde_json::json!({ "doc": "Dune.md" }),
                    fields: Vec::new(),
                },
                &mut host,
            )
            .unwrap();
        assert!(matches!(update, ViewUpdate::Navigate { ref doc_id } if doc_id == "Dune.md"));
        let after: Vec<String> = docs
            .iter()
            .map(|doc| host.read_document(&DocId::new(*doc)).unwrap())
            .collect();
        assert_eq!(before, after);
    }

    #[test]
    fn past_the_limit_the_page_counts_the_rest() {
        let mut docs: Vec<(String, String)> = vec![("Tipi/Libro.md".into(), LIBRO.into())];
        for i in 0..TYPE_PAGE_ROWS + 3 {
            docs.push((
                format!("Libri/L{i:03}.md"),
                "---\ntipo: Libro\n---\n".into(),
            ));
        }
        let refs: Vec<(&str, &str)> = docs.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let tree = page(&vault(&refs), "Tipi/Libro.md");
        assert_eq!(opened(&tree).len(), TYPE_PAGE_ROWS);
        assert!(drawn(&tree).contains(TYPE_PAGE_MORE));
    }

    /// La strada di prima, per la misura: tutte le note con `tipo`, ognuna
    /// risolta da capo (le chiavi dei tipi rifatte per ogni nota), ogni tipo
    /// ordinato.
    fn before_the_index(
        host: &MemoryHost,
        types: &[TypeRef],
        folder: Option<&str>,
        extra: &[&str],
    ) -> Vec<Vec<fub_abi::traits::DocumentMatch>> {
        let mut keys = vec!["tipo"];
        keys.extend_from_slice(extra);
        let typed = host
            .query_index(IndexQuery::Documents {
                matching: fub_abi::query::QueryExpr::of(fub_abi::query::QueryPredicate::Property {
                    filter: fub_abi::traits::PropertyFilter {
                        key: "tipo".into(),
                        test: fub_abi::traits::PropertyTest::Exists,
                    },
                }),
                sort: None,
                select: fub_abi::traits::PropertySelect::keys(&keys),
                page: None,
                excerpts: fub_abi::traits::Excerpts::Omit,
            })
            .unwrap()
            .documents()
            .unwrap();
        let mut out = vec![Vec::new(); types.len()];
        for row in typed.items {
            let Some(wanted) = row
                .properties
                .iter()
                .find(|p| p.key == "tipo")
                .and_then(|p| note_types::wanted_of_value(&p.value))
            else {
                continue;
            };
            if let note_types::Resolution::Found(found) =
                note_types::resolve(types, folder, &wanted)
            {
                if let Some(at) = types.iter().position(|t| t.doc == found.doc) {
                    out[at].push(row);
                }
            }
        }
        for rows in &mut out {
            rows.sort_by(|a, b| a.doc.cmp(&b.doc));
        }
        out
    }

    /// La misura della pagina su un vault grande: 10.000 note divise fra 40
    /// tipi, scritti nelle tre forme di `tipo`. Non è una prova (il tempo
    /// dipende dalla macchina): la si lancia a mano con `cargo test -p
    /// fub-features --release --lib -- --ignored misura_pagina --nocapture`.
    #[test]
    #[ignore = "misura, non prova: si lancia a mano"]
    fn misura_pagina_del_tipo_su_un_vault_grande() {
        use std::time::{Duration, Instant};
        let mut docs: Vec<(String, String)> = Vec::new();
        for t in 0..40 {
            docs.push((format!("Tipi/Tipo{t:02}.md"), LIBRO.into()));
        }
        for i in 0..10_000 {
            let t = i % 40;
            let tipo = match i % 3 {
                0 => format!("\"[[Tipi/Tipo{t:02}]]\""),
                1 => format!("tipo{t:02}"),
                _ => format!("\"[[Tipo{t:02}]]\""),
            };
            docs.push((
                format!("Note/N{:05}.md", 10_000 - i),
                format!("---\ntipo: {tipo}\nautore: Autore {i}\nletto: true\n---\nTesto.\n"),
            ));
        }
        let refs: Vec<(&str, &str)> = docs.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let host = vault(&refs);
        let types = note_types::type_refs(&host).unwrap();
        let folder = note_types::types_folder(&host);
        let at = types.iter().position(|t| t.name == "Tipo07").unwrap();
        let extra = ["autore"];
        // A turno, perché il carico della macchina pesi uguale sulle tre: la
        // sola domanda all'indice delle note con `tipo` (il pavimento: la
        // risoluzione dei nomi non è un filtro dell'indice), la strada di
        // prima (tutte le note di tutti i tipi, ordinate, poi un tipo) e
        // quella di adesso.
        let (mut floor, mut before, mut after) = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
        for _ in 0..20 {
            let clock = Instant::now();
            host.query_index(IndexQuery::Documents {
                matching: fub_abi::query::QueryExpr::of(fub_abi::query::QueryPredicate::Property {
                    filter: fub_abi::traits::PropertyFilter {
                        key: "tipo".into(),
                        test: fub_abi::traits::PropertyTest::Exists,
                    },
                }),
                sort: None,
                select: fub_abi::traits::PropertySelect::keys(&["tipo"]),
                page: None,
                excerpts: fub_abi::traits::Excerpts::Omit,
            })
            .unwrap();
            floor += clock.elapsed();
            let clock = Instant::now();
            let all = before_the_index(&host, &types, folder.as_deref(), &extra);
            before += clock.elapsed();
            let clock = Instant::now();
            let (total, rows) = note_types::notes_of_type(
                &host,
                &types,
                folder.as_deref(),
                at,
                &extra,
                TYPE_PAGE_ROWS,
            )
            .unwrap();
            after += clock.elapsed();
            assert_eq!(total, all[at].len());
            assert_eq!(rows.len(), TYPE_PAGE_ROWS);
        }
        println!(
            "20 volte le note di un tipo su 10.000: prima {before:?}, adesso {after:?} \
             (la sola domanda all'indice: {floor:?})"
        );
    }
}
