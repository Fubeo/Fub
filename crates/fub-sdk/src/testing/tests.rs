//! Test del doppio: semina, lettura, scrittura, query e struttura.

use super::*;
use fub_abi::format::{FormatCapabilities, FormatDescriptor};
use fub_abi::locale::{HourCycle, Weekday};
use fub_abi::traits::EntryKind;

/// Il locale del doppio parte **indeterminato**, come quello del contratto:
/// un banco che partisse italiano nasconderebbe proprio i posti in cui una
/// feature dà per scontata una lingua. Chi ne prova una che formatta o che
/// ordina lo dichiara, e allora lo vede.
#[test]
fn the_double_starts_with_nobody_having_spoken() {
    let host = MemoryHost::new();
    assert_eq!(host.user_locale(), Locale::default());
    assert!(!host.user_locale().has_language());

    let host = host.with_locale(Locale {
        language: "it-IT".into(),
        timezone: "Europe/Rome".into(),
        utc_offset_minutes: 120,
        first_day_of_week: Weekday::Monday,
        hour_cycle: HourCycle::H23,
    });
    assert_eq!(host.user_locale().language_base(), "it");
    assert_eq!(host.user_locale().utc_offset_minutes, 120);
}

/// L'entropia del doppio è **deterministica e mai ripetuta**: la prima
/// proprietà rende asseribile un test, la seconda è la sola promessa della
/// capacità vera.
#[test]
fn the_doubles_entropy_never_repeats() {
    let host = MemoryHost::new();
    let first = host.random_bytes(16).unwrap();
    let second = host.random_bytes(16).unwrap();
    assert_eq!(first.len(), 16);
    assert_ne!(first, second);
}

/// Il doppio risponde per **estensione**, che è la stessa chiave del
/// registro vero: una feature che si prova qui e poi gira sul kernel deve
/// trovare la stessa regola, o il doppio starebbe provando un'altra cosa.
#[test]
fn the_double_answers_the_format_by_extension_and_none_for_what_nobody_claims() {
    let host = MemoryHost::new().with_format(
        "md",
        DocumentFormat {
            descriptor: FormatDescriptor::text("markdown", "Markdown", &["md"]),
            capabilities: FormatCapabilities::default(),
        },
    );

    let markdown = host
        .format_of(&DocId::new("Progetti/Nota.md"))
        .expect("`.md` è seminato");
    assert_eq!(markdown.descriptor.id, "markdown");
    assert!(
        host.format_of(&DocId::new("allegato.pdf")).is_none(),
        "nessuno rivendica `.pdf`: `none` è una risposta, non un errore"
    );
    assert!(
        host.format_of(&DocId::new("LICENSE")).is_none(),
        "un nome senza estensione non ha niente da chiedere al registro"
    );
}

/// Un modello non seminato è un errore, non un modello vuoto: chi prova una
/// feature sul modello deve dire **quale** modello sta provando, o proverebbe
/// il caso «documento vuoto» credendo di provare il proprio.
#[test]
fn the_double_refuses_to_invent_a_model_nobody_seeded() {
    let host = MemoryHost::new().with_document("nota.md", "# c'è");
    let outcome = host.read_model(&DocId::new("nota.md"));
    assert!(
        matches!(outcome, Err(PluginError::Internal(msg)) if msg.to_string().contains("nota.md"))
    );
}

/// I byte grezzi attraversano il doppio senza conversioni: 0..255, BOM e
/// CRLF tornano identici, e la revisione è dei byte prodotti.
#[test]
fn raw_bytes_come_back_untouched() {
    let mut host = MemoryHost::new();
    let all: Vec<u8> = (0u8..=255).collect();
    // `.bin` non è rivendicato da nessun formato seminato: la porta raw lo
    // deposita comunque, come il kernel che accetta file opachi.
    let id = DocId::new("allegato.bin");
    let revision = host.write_document_bytes(&id, &all, None).unwrap();
    assert_eq!(revision, Revision::of_bytes(&all));
    assert_eq!(host.read_document_bytes(&id).unwrap(), all);
    assert_eq!(host.document_revision(&id).unwrap(), revision);
    assert!(
        matches!(host.read_document(&id), Err(PluginError::Io(_))),
        "0..255 non è UTF-8: come il vault vero, si dice di no"
    );

    let bom_crlf = b"\xef\xbb\xbfprima\r\nseconda\r\n".to_vec();
    let text_id = DocId::new("nota.md");
    let text_rev = host
        .write_document_bytes(&text_id, &bom_crlf, None)
        .unwrap();
    assert_eq!(text_rev, Revision::of_bytes(&bom_crlf));
    assert_eq!(host.read_document_bytes(&text_id).unwrap(), bom_crlf);
}

/// `None` è create-only: la seconda creazione rifiuta e lascia i byte vecchi.
#[test]
fn creating_twice_keeps_the_first_bytes() {
    let mut host = MemoryHost::new();
    let id = DocId::new("allegato.bin");
    host.write_document_bytes(&id, &[1, 2, 3], None).unwrap();
    let err = host
        .write_document_bytes(&id, &[9, 9, 9], None)
        .unwrap_err();
    assert!(matches!(err, PluginError::AlreadyExists(_)), "{err:?}");
    assert_eq!(host.read_document_bytes(&id).unwrap(), vec![1, 2, 3]);
}

/// Una CAS fallita non scrive niente: i byte restano quelli di prima.
#[test]
fn a_stale_cas_leaves_the_bytes_where_they_were() {
    let mut host = MemoryHost::new();
    let id = DocId::new("allegato.bin");
    let first = host.write_document_bytes(&id, &[1, 2, 3], None).unwrap();
    let stale = Revision::of_bytes(&[0]);
    let err = host
        .write_document_bytes(&id, &[9, 9, 9], Some(stale))
        .unwrap_err();
    assert!(matches!(err, PluginError::Conflict(_)), "{err:?}");
    assert_eq!(host.read_document_bytes(&id).unwrap(), vec![1, 2, 3]);
    let second = host
        .write_document_bytes(&id, &[9, 9, 9], Some(first))
        .unwrap();
    assert_eq!(second, Revision::of_bytes(&[9, 9, 9]));
    assert_eq!(host.read_document_bytes(&id).unwrap(), vec![9, 9, 9]);
}

/// Il cestino tiene byte, non testo: un allegato cestinato torna identico.
#[test]
fn trash_keeps_raw_bytes() {
    let mut host = MemoryHost::new();
    let all: Vec<u8> = (0u8..=255).collect();
    let id = DocId::new("allegato.bin");
    host.write_document_bytes(&id, &all, None).unwrap();
    let trashed = host.trash_document(&id).unwrap();
    assert!(host.read_document_bytes(&id).is_err());
    let back = host.restore_document(&trashed, None).unwrap();
    assert_eq!(back, id);
    assert_eq!(host.read_document_bytes(&id).unwrap(), all);
}

fn neighbors(
    host: &MemoryHost,
    seeds: Vec<&str>,
    direction: LinkDirection,
    depth: u8,
) -> Vec<String> {
    let seeds = if seeds.is_empty() {
        fub_abi::query::QueryExpr::default()
    } else {
        fub_abi::query::QueryExpr::of(QueryPredicate::Docs {
            docs: seeds.into_iter().map(DocId::new).collect(),
        })
    };
    let IndexResult::Neighbors(found) = host
        .query_index(IndexQuery::Neighbors {
            seeds,
            direction,
            depth,
            page: None,
        })
        .unwrap()
    else {
        panic!("una risposta fuori tema");
    };
    found
        .items
        .iter()
        .map(|n| format!("{}<{}@{}", n.doc, n.via, n.depth))
        .collect()
}

/// I vicini partono **dai semi** e camminano come il grafo del kernel: in
/// ampiezza, ognuno una volta sola alla distanza minima. Prima il doppio
/// ignorava i semi e rispondeva con tutti gli archi del vault.
#[test]
fn the_neighbors_start_from_the_seeds_and_walk_like_the_graph() {
    let host = MemoryHost::new()
        .with_document("a.md", "")
        .with_document("b.md", "")
        .with_document("c.md", "")
        .with_document("d.md", "")
        .with_edge("a.md", "b.md")
        .with_edge("a.md", "b.md")
        .with_edge("b.md", "c.md")
        .with_edge("c.md", "a.md")
        .with_edge("d.md", "a.md");
    assert_eq!(
        neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 1),
        ["b.md<a.md@1"]
    );
    assert_eq!(
        neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 3),
        ["b.md<a.md@1", "c.md<b.md@2"],
        "chi parte non torna vicino di sé stesso"
    );
    assert_eq!(
        neighbors(&host, vec!["a.md"], LinkDirection::Inbound, 1),
        ["c.md<a.md@1", "d.md<a.md@1"]
    );
    assert_eq!(
        neighbors(&host, vec!["a.md"], LinkDirection::Both, 1),
        ["b.md<a.md@1", "c.md<a.md@1", "d.md<a.md@1"]
    );
    assert_eq!(
        neighbors(&host, vec![], LinkDirection::Outbound, 1),
        ["b.md<a.md@1", "c.md<b.md@1", "a.md<c.md@1", "a.md<d.md@1"],
        "senza semi, ogni documento in ordine di id"
    );
    assert!(neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 0).is_empty());
}

fn documents(
    host: &MemoryHost,
    matching: fub_abi::query::QueryExpr,
) -> Result<Vec<String>, PluginError> {
    match host.query_index(IndexQuery::Documents {
        matching,
        sort: None,
        select: Default::default(),
        page: None,
        excerpts: Default::default(),
    })? {
        IndexResult::Documents(found) => {
            Ok(found.items.iter().map(|m| m.doc.to_string()).collect())
        }
        _ => panic!("una risposta fuori tema"),
    }
}

/// Il filtro si **valuta** con le regole condivise, oppure si rifiuta:
/// prima il doppio lo ignorava e rispondeva con tutti i documenti, allegati
/// compresi, e una prova che si fidava del filtro passava per il motivo
/// sbagliato.
#[test]
fn the_double_evaluates_the_filter_or_says_it_cannot() {
    let mut model = DocumentModel::empty(DocId::new("Progetti/Idea.md"));
    model
        .frontmatter
        .0
        .insert("stato".into(), serde_json::json!("aperto"));
    let host = MemoryHost::new()
        .with_document("Nota.md", "")
        .with_document("Progetti/Idea.md", "")
        .with_binary_document("Progetti/foto.png", b"png")
        .with_model("Progetti/Idea.md", model);
    let folder = || {
        fub_abi::query::QueryExpr::of(QueryPredicate::Folder {
            path: "Progetti".into(),
            descendants: true,
        })
    };
    assert_eq!(
        documents(&host, fub_abi::query::QueryExpr::default()).unwrap(),
        ["Nota.md", "Progetti/Idea.md"],
        "un allegato non è un documento"
    );
    assert_eq!(documents(&host, folder()).unwrap(), ["Progetti/Idea.md"]);
    let text = fub_abi::query::QueryExpr::of(QueryPredicate::Text(
        fub_abi::query::TextQuery::terms("idea"),
    ));
    assert!(matches!(
        documents(&host, text),
        Err(PluginError::Unserved(_))
    ));
    let property = || {
        fub_abi::query::QueryExpr::of(QueryPredicate::Property {
            filter: fub_abi::traits::PropertyFilter {
                key: "stato".into(),
                test: fub_abi::traits::PropertyTest::Exists,
            },
        })
    };
    assert!(
        matches!(documents(&host, property()), Err(PluginError::Unserved(msg)) if msg.to_string().contains("Nota.md")),
        "senza il modello di Nota.md il doppio non sa se ha la proprietà"
    );
    let host = host.with_model("Nota.md", DocumentModel::empty(DocId::new("Nota.md")));
    assert_eq!(documents(&host, property()).unwrap(), ["Progetti/Idea.md"]);

    assert_eq!(
        host.list_documents(None).unwrap().items,
        [DocId::new("Nota.md"), DocId::new("Progetti/Idea.md")]
    );
    let IndexResult::Entries(entries) = host
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: Some(fub_abi::traits::FolderScope::direct("Progetti")),
            page: None,
        })
        .unwrap()
    else {
        panic!("una risposta fuori tema");
    };
    let kinds: Vec<(String, EntryKind)> = entries
        .items
        .into_iter()
        .map(|entry| (entry.id.to_string(), entry.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            ("Progetti/Idea.md".to_string(), EntryKind::Document),
            ("Progetti/foto.png".to_string(), EntryKind::Asset),
        ]
    );
}
