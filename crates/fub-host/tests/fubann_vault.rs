//! Le annotazioni di un PDF in un vault, sul montaggio di produzione con la
//! feature `draw` (ADR 0203).
//!
//! Il provider `fubann` rivendica ogni `.fubann`: `Bando.pdf.fubann`, accanto
//! a `Bando.pdf`, diventa un documento che la ricerca trova per il corpo delle
//! note, che porta il backlink e l'arco del grafo verso il PDF e che una
//! rinomina del PDF riscrive byte per byte. Il PDF resta un allegato, e le
//! note che lo nominano continuano a raggiungere lui e non le sue
//! annotazioni. Il formato è nel [formato delle
//! annotazioni](../../../docs/reference/annotation-format.md).

#![cfg(feature = "draw")]

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::{DocId, LinkTarget};
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{
    EntryKind, Excerpts, IndexQuery, IndexResult, LinkDirection, Page, PropertySelect,
};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

/// Le annotazioni di `atti/Bando di gara.pdf`: una nota a pagina 1, un
/// collegamento al verbale e una nota senza testo a pagina 3, un testo fuori
/// dalle pagine.
const BANDO: &str = include_str!("../../fub-format-svg/tests/fixtures/annotations.fubann");
const PDF: &[u8] = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";

const ANNOTATIONS: &str = "atti/Bando di gara.pdf.fubann";
const ANNOTATED: &str = "atti/Bando di gara.pdf";

fn write(root: &Utf8Path, rel: &str, body: impl AsRef<[u8]>) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

/// Il vault della prova: il PDF, le sue annotazioni, il verbale che
/// richiamano e una nota che nomina il PDF e le annotazioni in tutti i modi.
fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    write(&root, ANNOTATED, PDF);
    write(&root, ANNOTATIONS, BANDO);
    write(
        &root,
        "Verbali/Verbale 12.md",
        "# Verbale 12\n\nLa commissione si riunisce.\n",
    );
    write(
        &root,
        "Riunione.md",
        concat!(
            "# Riunione\n\n",
            "![[Bando di gara.pdf]]\n\n",
            "Vedi [[Bando di gara.pdf]] e [il bando](atti/Bando%20di%20gara.pdf).\n\n",
            "Le correzioni: [[Bando di gara.pdf.fubann]].\n",
        ),
    );
    (dir, root)
}

fn mount(root: &Utf8Path) -> fub_host::mount::Mounted {
    let mut mounted = fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il vault si monta");
    let opening = mounted.workspace.reindex().expect("il vault si indicizza");
    assert!(opening.discarded.is_empty(), "{:?}", opening.discarded);
    mounted
}

fn id(path: &str) -> DocId {
    DocId::new(path)
}

fn kind_of(ws: &fub_kernel::Workspace, path: &str) -> EntryKind {
    let Ok(IndexResult::Entries(entries)) = ws.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: Some(Page::first(100)),
    }) else {
        panic!("l'anagrafe risponde")
    };
    entries
        .items
        .iter()
        .find(|entry| entry.id.as_str() == path)
        .unwrap_or_else(|| panic!("{path} non è nell'anagrafe"))
        .kind
}

/// I documenti che la ricerca a testo pieno trova per `terms`.
fn search(ws: &fub_kernel::Workspace, terms: &str) -> Vec<String> {
    match ws.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(terms))),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page::first(50)),
        excerpts: Excerpts::Attach,
    }) {
        Ok(IndexResult::Documents(hits)) => {
            let mut docs: Vec<_> = hits
                .items
                .into_iter()
                .map(|hit| hit.doc.to_string())
                .collect();
            docs.sort();
            docs
        }
        other => panic!("{other:?}"),
    }
}

/// Chi punta a `target`, col contesto: la domanda del pannello dei backlink,
/// che vale anche per un allegato.
fn backlinks(ws: &fub_kernel::Workspace, target: &str) -> Vec<(String, Option<String>)> {
    let Ok(IndexResult::Backlinks(found)) = ws.query_index(IndexQuery::Backlinks {
        target: id(target),
        page: None,
    }) else {
        panic!("i backlink rispondono")
    };
    found
        .items
        .into_iter()
        .map(|link| (link.source.to_string(), link.context))
        .collect()
}

fn neighbors(ws: &fub_kernel::Workspace, seed: &str, direction: LinkDirection) -> Vec<String> {
    match ws.query_index(IndexQuery::Neighbors {
        seeds: QueryExpr::of(QueryPredicate::Docs {
            docs: vec![id(seed)],
        }),
        direction,
        depth: 1,
        page: Some(Page::first(50)),
    }) {
        Ok(IndexResult::Neighbors(found)) => {
            let mut docs: Vec<_> = found.items.into_iter().map(|n| n.doc.to_string()).collect();
            docs.sort();
            docs
        }
        other => panic!("{other:?}"),
    }
}

/// Dove porta un wikilink, come lo chiede la shell.
fn resolve(ws: &fub_kernel::Workspace, page: &str) -> Option<String> {
    let Ok(IndexResult::Resolved(found)) = ws.query_index(IndexQuery::Resolve {
        target: LinkTarget::wiki(page),
        from: None,
    }) else {
        panic!("la risoluzione risponde")
    };
    found.map(|target| target.doc.to_string())
}

#[test]
fn the_annotations_are_a_document_and_the_pdf_stays_an_asset() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ws = &mounted.workspace;
    assert_eq!(kind_of(ws, ANNOTATIONS), EntryKind::Document);
    assert_eq!(
        ws.format_of(&id(ANNOTATIONS)).unwrap().descriptor.id,
        fub_format_svg::ANNOTATIONS_FORMAT_ID
    );
    assert_eq!(kind_of(ws, ANNOTATED), EntryKind::Asset);
    assert_eq!(ws.format_of(&id(ANNOTATED)), None);
    assert_eq!(ws.read_source(&id(ANNOTATIONS)).unwrap(), BANDO);
}

#[test]
fn search_finds_the_title_the_texts_and_the_bodies_of_the_notes() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ws = &mounted.workspace;
    for terms in [
        "Revisione",
        "ufficio gare",
        "Importo",
        "rivedere",
        "base d'asta",
        "firma del RUP",
        "Fuori dalle pagine",
    ] {
        assert_eq!(search(ws, terms), [ANNOTATIONS], "{terms}");
    }
    // Il Markdown si cerca come sempre.
    assert_eq!(search(ws, "commissione"), ["Verbali/Verbale 12.md"]);

    let Ok(IndexResult::Outline(outline)) = ws.query_index(IndexQuery::Outline {
        doc: id(ANNOTATIONS),
    }) else {
        panic!("l'outline risponde")
    };
    let titles: Vec<_> = outline.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(titles, ["Revisione del bando"]);
}

#[test]
fn the_pdf_has_a_backlink_from_its_annotations() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ws = &mounted.workspace;

    // Il PDF: dalla nota tre volte (embed, wikilink, link a percorso) e una
    // dalle annotazioni, col loro testo per contesto.
    let to_pdf = backlinks(ws, ANNOTATED);
    let sources: Vec<_> = to_pdf.iter().map(|(s, _)| s.as_str()).collect();
    assert_eq!(
        sources,
        ["Riunione.md", "Riunione.md", "Riunione.md", ANNOTATIONS],
        "{to_pdf:?}"
    );
    let context = to_pdf[3].1.as_deref().unwrap();
    assert!(context.starts_with("Le correzioni chieste"), "{context}");
    assert!(context.contains("firma del RUP"), "{context}");

    // Le annotazioni: solo il wikilink col loro nome intero.
    let to_annotations: Vec<_> = backlinks(ws, ANNOTATIONS)
        .into_iter()
        .map(|(s, _)| s)
        .collect();
    assert_eq!(to_annotations, ["Riunione.md"]);

    // Il grafo: il PDF è una foglia delle annotazioni, accanto al verbale.
    assert_eq!(
        neighbors(ws, ANNOTATIONS, LinkDirection::Outbound),
        ["Verbali/Verbale 12.md", ANNOTATED]
    );
    assert_eq!(
        neighbors(ws, ANNOTATIONS, LinkDirection::Inbound),
        ["Riunione.md"]
    );
    assert_eq!(
        neighbors(ws, "Verbali/Verbale 12.md", LinkDirection::Inbound),
        [ANNOTATIONS]
    );
}

/// Il nome delle annotazioni senza la loro estensione è il nome del PDF: un
/// collegamento al PDF nomina il PDF, e non le annotazioni.
#[test]
fn a_link_to_the_pdf_reaches_the_pdf_and_not_its_annotations() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ws = &mounted.workspace;
    assert_eq!(resolve(ws, "Bando di gara.pdf").as_deref(), Some(ANNOTATED));
    assert_eq!(
        resolve(ws, "atti/Bando di gara.pdf").as_deref(),
        Some(ANNOTATED)
    );
    assert_eq!(
        resolve(ws, "Bando di gara.pdf.fubann").as_deref(),
        Some(ANNOTATIONS)
    );
    let mut outgoing: Vec<_> = ws
        .outgoing(&id("Riunione.md"))
        .iter()
        .map(|d| d.to_string())
        .collect();
    outgoing.dedup();
    assert_eq!(outgoing, [ANNOTATIONS]);
    // Le annotazioni non puntano a sé stesse.
    assert!(ws
        .outgoing(&id(ANNOTATIONS))
        .iter()
        .all(|d| d.as_str() != ANNOTATIONS));
}

#[test]
fn an_embed_lists_the_annotations_and_a_section_is_a_page() {
    let (_dir, root) = vault();
    let mounted = mount(&root);
    let ws = &mounted.workspace;

    let (doc, whole) = ws
        .render_embed("Bando di gara.pdf.fubann", None, None)
        .unwrap();
    assert_eq!(doc, id(ANNOTATIONS));
    let html = &whole.html;
    assert!(
        html.starts_with(r#"<section class="fub-annotations""#),
        "{html}"
    );
    assert!(html.contains("Importo"), "{html}");
    assert!(
        html.contains(r#"data-path="Bando%20di%20gara.pdf#page=3""#),
        "{html}"
    );
    assert!(!html.contains("<img") && !html.contains("src=\""), "{html}");
    // L'anteprima del pannello è lo stesso elenco.
    assert_eq!(ws.render_preview(&id(ANNOTATIONS)).unwrap().html, *html);

    // Una pagina come sezione: solo le sue annotazioni.
    let (_, page) = ws
        .render_embed("Bando di gara.pdf.fubann", Some("page=3"), None)
        .unwrap();
    assert!(page.html.contains("firma del RUP"), "{}", page.html);
    assert!(!page.html.contains("Importo"), "{}", page.html);
    // Il titolo è l'insieme; una pagina senza annotazioni non è una sezione.
    let (_, titled) = ws
        .render_embed(
            "Bando di gara.pdf.fubann",
            Some("Revisione del bando"),
            None,
        )
        .unwrap();
    assert_eq!(titled.html, *html);
    assert!(ws
        .render_embed("Bando di gara.pdf.fubann", Some("page=2"), None)
        .is_err());
}

#[test]
fn renaming_the_pdf_rewrites_the_annotations_byte_for_byte() {
    let (_dir, root) = vault();
    let mut mounted = mount(&root);
    let ws = &mut mounted.workspace;

    ws.rename_document(&id(ANNOTATED), &id("atti/Bando 2027.pdf"))
        .unwrap();
    let after = ws.read_source(&id(ANNOTATIONS)).unwrap();
    assert_eq!(
        after,
        BANDO.replace(
            r#"fub:annotates="Bando%20di%20gara.pdf""#,
            r#"fub:annotates="Bando%202027.pdf""#
        )
    );
    assert_eq!(
        std::fs::read(root.join(ANNOTATIONS)).unwrap(),
        after.as_bytes()
    );
    let sources: Vec<_> = backlinks(ws, "atti/Bando 2027.pdf")
        .into_iter()
        .map(|(s, _)| s)
        .collect();
    assert!(sources.contains(&ANNOTATIONS.to_owned()), "{sources:?}");

    // Il verbale cambia nome: cambia solo il suo `href`.
    ws.rename_document(&id("Verbali/Verbale 12.md"), &id("Verbali/Verbale 13.md"))
        .unwrap();
    assert_eq!(
        ws.read_source(&id(ANNOTATIONS)).unwrap(),
        after.replace("Verbale%2012.md", "Verbale%2013.md")
    );
}

/// Il Markdown non si accorge delle annotazioni: lo stesso vault senza il
/// `.fubann` dà alla nota lo stesso modello e al PDF gli stessi backlink
/// dalla nota.
#[test]
fn markdown_does_not_notice_the_annotations() {
    let (_dir, root) = vault();
    let with = mount(&root);
    let (_bare, bare_root) = vault();
    std::fs::remove_file(bare_root.join(ANNOTATIONS)).unwrap();
    let without = mount(&bare_root);

    let note = id("Riunione.md");
    assert_eq!(
        with.workspace.read_model(&note).ok(),
        without.workspace.read_model(&note).ok()
    );
    let from_notes = |ws: &fub_kernel::Workspace| -> Vec<_> {
        backlinks(ws, ANNOTATED)
            .into_iter()
            .filter(|(s, _)| s.ends_with(".md"))
            .collect()
    };
    assert_eq!(from_notes(&with.workspace), from_notes(&without.workspace));
    assert_eq!(from_notes(&without.workspace).len(), 3);
    assert_eq!(
        search(&with.workspace, "commissione"),
        search(&without.workspace, "commissione")
    );
}
