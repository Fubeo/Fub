//! Test unitari del grafo dei link: risoluzione, aggiornamento incrementale,
//! camminata dei vicini e link per percorso.

use super::*;
use fub_abi::model::{Link, LinkTarget, Span};
use fub_abi::traits::LinkDirection;

fn doc_with_links(id: &str, links: &[&str]) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.links = links
        .iter()
        .map(|p| Link {
            target: LinkTarget::wiki(*p),
            embed: false,
            span: Span::EMPTY,
            context: Some(format!("→ {p}")),
        })
        .collect();
    m
}

fn doc_with_aliases(id: &str, aliases: &[&str]) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(aliases));
    m
}

/// Salvare un hub con le stesse chiavi non tocca chi lo cita: nessuna
/// chiave cambia indice. Cambiare un alias tocca solo quell'alias.
#[test]
fn only_keys_that_change_index_are_touched() {
    let keys = |aliases: &[&str]| DocKeys {
        name: "hub".into(),
        path: "hub".into(),
        aliases: aliases.iter().map(|a| a.to_string()).collect(),
    };
    assert!(changed_keys(&keys(&["a", "b"]), &keys(&["b", "a"])).is_empty());
    assert_eq!(
        changed_keys(&keys(&["a", "b"]), &keys(&["b", "c"])),
        HashSet::from(["a".to_string(), "c".to_string()])
    );
    let moved = DocKeys {
        name: "altro".into(),
        path: "dir/altro".into(),
        aliases: Vec::new(),
    };
    assert_eq!(
        changed_keys(&keys(&[]), &moved),
        HashSet::from(["hub", "altro", "dir/altro"].map(String::from))
    );
}

fn sources(graph: &LinkGraph, target: &str) -> Vec<String> {
    graph
        .backlinks(&DocId::new(target))
        .into_iter()
        .map(|r| r.source.to_string())
        .collect()
}

#[test]
fn resolves_by_name_and_records_backlinks() {
    let a = doc_with_links("a.md", &["Nota B"]);
    let b = DocumentModel::empty(DocId::new("sub/Nota B.md"));
    let graph = LinkGraph::build([&a, &b]);

    assert_eq!(
        graph.resolve_wiki("Nota B"),
        Some(DocId::new("sub/Nota B.md"))
    );
    let bl = graph.backlinks(&DocId::new("sub/Nota B.md"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("a.md"));
    assert_eq!(bl[0].context.as_deref(), Some("→ Nota B"));
}

#[test]
fn shortest_path_wins_among_homonyms() {
    let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
    let shallow = DocumentModel::empty(DocId::new("Nota.md"));
    let graph = LinkGraph::build([&deep, &shallow]);
    assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("Nota.md")));
}

#[test]
fn resolves_by_path_and_alias() {
    let mut aliased = DocumentModel::empty(DocId::new("people/Mario Rossi.md"));
    aliased
        .frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(["Mario"]));
    let other = DocumentModel::empty(DocId::new("people/Altro.md"));
    let graph = LinkGraph::build([&aliased, &other]);

    assert_eq!(
        graph.resolve_wiki("people/Mario Rossi"),
        Some(DocId::new("people/Mario Rossi.md"))
    );
    assert_eq!(
        graph.resolve_wiki("Mario"),
        Some(DocId::new("people/Mario Rossi.md"))
    );
}

#[test]
fn unresolved_link_yields_no_backlink() {
    let a = doc_with_links("a.md", &["Inesistente"]);
    let graph = LinkGraph::build([&a]);
    assert_eq!(graph.resolve_wiki("Inesistente"), None);
    assert!(graph.backlinks(&DocId::new("Inesistente.md")).is_empty());
}

#[test]
fn nfd_file_names_meet_nfc_links() {
    // Il nome file come lo scrive macOS (NFD: `e` + combining acute), il
    // link come lo digita l'utente (NFC: `é` precomposto). Senza NFC nel
    // punto di normalizzazione sarebbero due chiavi — e due nodi.
    let target = DocumentModel::empty(DocId::new("Cafe\u{0301}.md"));
    let a = doc_with_links("a.md", &["Café"]);
    let graph = LinkGraph::build([&a, &target]);

    assert_eq!(
        graph.resolve_wiki("Café"),
        Some(DocId::new("Cafe\u{0301}.md"))
    );
    assert_eq!(sources(&graph, "Cafe\u{0301}.md"), ["a.md"]);
}

#[test]
fn self_link_is_not_a_backlink() {
    let a = doc_with_links("a.md", &["a"]);
    let graph = LinkGraph::build([&a]);
    assert!(graph.backlinks(&DocId::new("a.md")).is_empty());
}

// --- incrementale: i casi che il full-rebuild nasconde ------------------

#[test]
fn upsert_creating_target_resolves_dangling_links() {
    let a = doc_with_links("a.md", &["Nota"]);
    let mut graph = LinkGraph::build([&a]);
    assert!(sources(&graph, "Nota.md").is_empty());

    graph.upsert(&DocumentModel::empty(DocId::new("Nota.md")));

    assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("Nota.md")));
    assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
    assert_eq!(graph.outgoing(&DocId::new("a.md")), [DocId::new("Nota.md")]);
}

#[test]
fn upsert_of_closer_homonym_steals_the_backlink() {
    let a = doc_with_links("a.md", &["Nota"]);
    let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
    let mut graph = LinkGraph::build([&a, &deep]);
    assert_eq!(sources(&graph, "x/y/Nota.md"), ["a.md"]);

    graph.upsert(&DocumentModel::empty(DocId::new("Nota.md")));

    assert!(sources(&graph, "x/y/Nota.md").is_empty());
    assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
}

#[test]
fn remove_of_winner_falls_back_to_runner_up() {
    let a = doc_with_links("a.md", &["Nota"]);
    let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
    let shallow = DocumentModel::empty(DocId::new("Nota.md"));
    let mut graph = LinkGraph::build([&a, &deep, &shallow]);
    assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);

    graph.remove(&DocId::new("Nota.md"));

    assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("x/y/Nota.md")));
    assert_eq!(sources(&graph, "x/y/Nota.md"), ["a.md"]);
}

#[test]
fn removing_the_target_drops_its_backlinks() {
    let a = doc_with_links("a.md", &["Nota"]);
    let target = DocumentModel::empty(DocId::new("Nota.md"));
    let mut graph = LinkGraph::build([&a, &target]);

    graph.remove(&DocId::new("Nota.md"));

    assert_eq!(graph.resolve_wiki("Nota"), None);
    assert!(sources(&graph, "Nota.md").is_empty());
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
}

#[test]
fn upsert_replaces_the_links_of_a_document() {
    let a = doc_with_links("a.md", &["Uno"]);
    let one = DocumentModel::empty(DocId::new("Uno.md"));
    let two = DocumentModel::empty(DocId::new("Due.md"));
    let mut graph = LinkGraph::build([&a, &one, &two]);
    assert_eq!(sources(&graph, "Uno.md"), ["a.md"]);

    graph.upsert(&doc_with_links("a.md", &["Due"]));

    assert!(sources(&graph, "Uno.md").is_empty());
    assert_eq!(sources(&graph, "Due.md"), ["a.md"]);
}

#[test]
fn losing_an_alias_moves_the_backlink() {
    let a = doc_with_links("a.md", &["Mario"]);
    let rossi = doc_with_aliases("people/Rossi.md", &["Mario"]);
    let mut graph = LinkGraph::build([&a, &rossi]);
    assert_eq!(sources(&graph, "people/Rossi.md"), ["a.md"]);

    // stesso documento, senza più l'alias
    graph.upsert(&DocumentModel::empty(DocId::new("people/Rossi.md")));

    assert_eq!(graph.resolve_wiki("Mario"), None);
    assert!(sources(&graph, "people/Rossi.md").is_empty());
}

#[test]
fn alias_collision_is_deterministic_and_survives_removal() {
    let a = doc_with_links("a.md", &["Mario"]);
    let deep = doc_with_aliases("x/y/Uno.md", &["Mario"]);
    let shallow = doc_with_aliases("Due.md", &["Mario"]);
    let mut graph = LinkGraph::build([&a, &deep, &shallow]);
    // fra due alias uguali vince il path più corto, non l'ordine di scan
    assert_eq!(graph.resolve_wiki("Mario"), Some(DocId::new("Due.md")));

    graph.remove(&DocId::new("Due.md"));
    assert_eq!(graph.resolve_wiki("Mario"), Some(DocId::new("x/y/Uno.md")));
    assert_eq!(sources(&graph, "x/y/Uno.md"), ["a.md"]);
}

#[test]
fn path_key_collision_across_extensions() {
    // `sub/nota.md` e `sub/nota.txt` condividono il path senza estensione.
    let a = doc_with_links("a.md", &["sub/nota"]);
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let mut graph = LinkGraph::build([&a, &md, &txt]);
    assert_eq!(
        graph.resolve_wiki("sub/nota"),
        Some(DocId::new("sub/nota.md"))
    );

    graph.remove(&DocId::new("sub/nota.md"));
    assert_eq!(
        graph.resolve_wiki("sub/nota"),
        Some(DocId::new("sub/nota.txt"))
    );
    assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
}

#[test]
fn a_wikilink_with_an_explicit_extension_wins_over_its_twin() {
    // Bug 4-1: `[[sub/nota.txt]]` veniva ridotto a `[[sub/nota]]` prima di
    // guardare i candidati, e l'estensione esplicita era resa inerte —
    // poteva cadere sul gemello `sub/nota.md`. È la stessa domanda di
    // `an_explicit_extension_is_taken_seriously`, ma per un **wikilink**:
    // il lato markdown la risolveva già, il lato wiki no.
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let wiki = doc_with_links("a.md", &["sub/nota.txt"]);
    let graph = LinkGraph::build([&md, &txt, &wiki]);

    assert_eq!(
        graph.resolve_wiki("sub/nota.txt"),
        Some(DocId::new("sub/nota.txt"))
    );
    assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
    assert!(sources(&graph, "sub/nota.md").is_empty());
}

#[test]
fn a_name_with_its_extension_names_the_file() {
    // I55: senza `/` la chiave cercava solo fra i nomi pagina, che non
    // hanno estensione, e `[[board.canvas]]` — la forma in cui Obsidian
    // scrive i link ai canvas — non si risolveva mai.
    let board = DocumentModel::empty(DocId::new("board.canvas"));
    let note = DocumentModel::empty(DocId::new("b.md"));
    let deep = DocumentModel::empty(DocId::new("sub/x.canvas"));
    let twin = DocumentModel::empty(DocId::new("sub/x.md"));
    let wiki = doc_with_links("a.md", &["board.canvas", "x.canvas"]);
    let graph = LinkGraph::build([&board, &note, &deep, &twin, &wiki]);

    assert_eq!(
        graph.resolve_wiki("board.canvas"),
        Some(DocId::new("board.canvas"))
    );
    assert_eq!(
        graph.resolve_wiki("Board.CANVAS"),
        Some(DocId::new("board.canvas"))
    );
    assert_eq!(graph.resolve_wiki("b.md"), Some(DocId::new("b.md")));
    assert_eq!(
        graph.resolve_wiki("x.canvas"),
        Some(DocId::new("sub/x.canvas"))
    );
    assert_eq!(graph.resolve_wiki("x.md"), Some(DocId::new("sub/x.md")));
    // L'estensione esplicita si prende sul serio: nessun `board.md`.
    assert_eq!(graph.resolve_wiki("board.md"), None);
    assert_eq!(
        graph.resolve_wiki("board"),
        Some(DocId::new("board.canvas"))
    );
    assert_eq!(sources(&graph, "board.canvas"), ["a.md"]);
    assert_eq!(sources(&graph, "sub/x.canvas"), ["a.md"]);
    assert!(sources(&graph, "sub/x.md").is_empty());
}

#[test]
fn a_name_with_its_extension_follows_the_file_as_it_comes_and_goes() {
    let wiki = doc_with_links("a.md", &["board.canvas"]);
    let mut graph = LinkGraph::build([&wiki]);
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());

    graph.upsert(&DocumentModel::empty(DocId::new("board.canvas")));
    assert_eq!(sources(&graph, "board.canvas"), ["a.md"]);

    graph.remove(&DocId::new("board.canvas"));
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
}

#[test]
fn homonyms_of_different_formats_name_the_prose_page_first() {
    // I55: accanto a `Progetto.{base,canvas,md}` il nome nudo cadeva
    // sull'ordine alfabetico, cioè su `Progetto.base`.
    let docs = [
        DocumentModel::empty(DocId::new("Progetto.base")),
        DocumentModel::empty(DocId::new("Progetto.canvas")),
        DocumentModel::empty(DocId::new("Progetto.md")),
        DocumentModel::empty(DocId::new("sub/Piano.canvas")),
        DocumentModel::empty(DocId::new("sub/Piano.md")),
        DocumentModel::empty(DocId::new("Radice.canvas")),
        DocumentModel::empty(DocId::new("sub/Radice.md")),
    ];
    let prose = ProseFormats::new(["MD"]);
    let graph = LinkGraph::build_with(docs.iter(), prose.clone());

    assert_eq!(
        graph.resolve_wiki("Progetto"),
        Some(DocId::new("Progetto.md"))
    );
    assert_eq!(
        graph.resolve_wiki("Progetto.canvas"),
        Some(DocId::new("Progetto.canvas"))
    );
    assert_eq!(
        graph.resolve_wiki("Progetto.base"),
        Some(DocId::new("Progetto.base"))
    );
    assert_eq!(
        graph.resolve_wiki("sub/Piano"),
        Some(DocId::new("sub/Piano.md"))
    );
    assert_eq!(
        graph.resolve_wiki("Piano"),
        Some(DocId::new("sub/Piano.md"))
    );
    // Lo spareggio vale solo fra formati dello stesso path: il più vicino
    // alla radice resta il primo.
    assert_eq!(
        graph.resolve_wiki("Radice"),
        Some(DocId::new("Radice.canvas"))
    );

    // Lo stesso ordine per upsert successivi, in qualunque ordine arrivino.
    let mut incremental = LinkGraph::with_prose(prose);
    for doc in docs.iter().rev() {
        incremental.upsert(doc);
    }
    assert_eq!(
        incremental.resolve_wiki("Progetto"),
        Some(DocId::new("Progetto.md"))
    );
    incremental.remove(&DocId::new("Progetto.md"));
    assert_eq!(
        incremental.resolve_wiki("Progetto"),
        Some(DocId::new("Progetto.base"))
    );

    // Senza formati di prosa dichiarati resta l'ordine dei path.
    let bare = LinkGraph::build(docs.iter());
    assert_eq!(
        bare.resolve_wiki("Progetto"),
        Some(DocId::new("Progetto.base"))
    );
}

#[test]
fn a_bare_wikilink_keeps_the_extensionless_resolution() {
    // L'altra faccia del fix: `[[sub/nota]]` senza estensione continua a
    // risolvere sulla chiave dei wikilink (primo candidato per priorità),
    // non viene «agganciato» dall'exact-match nuovo — lì non c'è un path
    // esatto da rispettare, e il comportamento dei test esistenti resta.
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let wiki = doc_with_links("b.md", &["sub/nota"]);
    let graph = LinkGraph::build([&md, &txt, &wiki]);

    assert_eq!(
        graph.resolve_wiki("sub/nota"),
        Some(DocId::new("sub/nota.md"))
    );
    assert_eq!(sources(&graph, "sub/nota.md"), ["b.md"]);
}

#[test]
fn removing_the_extension_winner_falls_back_to_the_twin() {
    // Togliere il file che l'estensione esplicita aveva eletto riapre la
    // risoluzione: il wikilink ricade sulla chiave senza estensione e il
    // gemello eredita il backlink, come nel caso nudo di
    // `path_key_collision_across_extensions`.
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let wiki = doc_with_links("a.md", &["sub/nota.txt"]);
    let mut graph = LinkGraph::build([&md, &txt, &wiki]);
    assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);

    graph.remove(&DocId::new("sub/nota.txt"));

    assert!(sources(&graph, "sub/nota.txt").is_empty());
    assert_eq!(sources(&graph, "sub/nota.md"), ["a.md"]);
}

#[test]
fn a_dotted_name_resolves_via_the_extensionless_fallback() {
    // Bug 4-2: `note/v1.2.md` è indicizzato come `note/v1.2` (il punto di
    // `v1.2` sta nel nome, non è un'estensione). Un link senza estensione
    // `[t](note/v1.2)` ha `strip_ext(key) == "note/v1"` — il blocco esatto
    // guarda la chiave sbagliata e non trova nulla; è il ripiego di
    // `resolve_path_key`, con `key` intero, a trovare la voce giusta. È il
    // cammino che il report 4-2 credeva morto: vive esattamente qui, e per
    // questo il ripiego resta.
    let target = DocumentModel::empty(DocId::new("note/v1.2.md"));
    let link = doc_with_paths("a.md", &["note/v1.2"]);
    let graph = LinkGraph::build([&target, &link]);
    assert_eq!(sources(&graph, "note/v1.2.md"), ["a.md"]);
}

#[test]
fn a_name_with_the_extension_of_an_attachment_names_the_attachment() {
    // `atti/Bando.pdf.fubann` annota `atti/Bando.pdf`, e il suo nome
    // pagina è `Bando.pdf`. Un link al PDF, wikilink o path, non è un
    // link alle annotazioni: il grafo risponde di no, e il PDF, che non è
    // un documento, lo trova chi risolve gli allegati. Lo stesso per una
    // nota che porta il nome del PDF più `.md`.
    let annotations = doc_with_paths("atti/Bando.pdf.fubann", &["Bando.pdf"]);
    let about = DocumentModel::empty(DocId::new("Foto.png.md"));
    let wiki = doc_with_links("a.md", &["Bando.pdf", "Foto.png", "Bando.pdf.fubann"]);
    let path = doc_with_paths("b.md", &["atti/Bando.pdf", "atti/Bando.pdf.fubann"]);
    let graph = LinkGraph::build([&annotations, &about, &wiki, &path]);

    assert_eq!(graph.resolve_wiki("Bando.pdf"), None);
    assert_eq!(graph.resolve_wiki("Foto.png"), None);
    assert_eq!(
        graph.resolve_path(&DocId::new("b.md"), "atti/Bando.pdf"),
        None
    );
    // Le annotazioni non puntano a sé stesse.
    assert!(graph
        .outgoing(&DocId::new("atti/Bando.pdf.fubann"))
        .is_empty());
    // Col nome intero si raggiungono, come ogni documento.
    assert_eq!(
        graph.resolve_wiki("Bando.pdf.fubann"),
        Some(DocId::new("atti/Bando.pdf.fubann"))
    );
    assert_eq!(sources(&graph, "atti/Bando.pdf.fubann"), ["a.md", "b.md"]);
    assert!(sources(&graph, "Foto.png.md").is_empty());
    // Un'estensione che non è un tipo resta parte del nome, e un
    // documento con l'estensione di un tipo si raggiunge dal suo nome di
    // file.
    let dotted = DocumentModel::empty(DocId::new("v1.2.md"));
    let drawing = DocumentModel::empty(DocId::new("disegni/acqua.svg"));
    let graph = LinkGraph::build([&dotted, &drawing]);
    assert_eq!(graph.resolve_wiki("v1.2"), Some(DocId::new("v1.2.md")));
    assert_eq!(
        graph.resolve_wiki("acqua.svg"),
        Some(DocId::new("disegni/acqua.svg"))
    );
}

#[test]
fn annotations_that_come_and_go_never_take_the_link_to_their_pdf() {
    let wiki = doc_with_links("a.md", &["Bando.pdf"]);
    let mut graph = LinkGraph::build([&wiki]);
    graph.upsert(&doc_with_paths("Bando.pdf.fubann", &["Bando.pdf"]));
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
    assert!(sources(&graph, "Bando.pdf.fubann").is_empty());
    graph.remove(&DocId::new("Bando.pdf.fubann"));
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
}

#[test]
fn two_files_that_differ_by_case_are_not_the_same_edge() {
    // Il caso che in tutto il repo non era esercitato da nessuno: due file
    // che il filesystem distingue e la chiave di risoluzione no.
    let large = doc_with_links("verso-grande.md", &["Nota"]);
    let small = doc_with_links("verso-piccola.md", &["nota"]);
    let a = DocumentModel::empty(DocId::new("Nota.md"));
    let b = DocumentModel::empty(DocId::new("nota.md"));
    let graph = LinkGraph::build([&large, &small, &a, &b]);

    // Ognuno dei due arriva dove l'utente l'ha scritto. Prima ci arrivavano
    // tutti e due su `Nota.md`, perché `N` precede `n` in ASCII.
    assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("Nota.md")));
    assert_eq!(graph.resolve_wiki("nota"), Some(DocId::new("nota.md")));
    assert_eq!(sources(&graph, "Nota.md"), ["verso-grande.md"]);
    assert_eq!(sources(&graph, "nota.md"), ["verso-piccola.md"]);
}

#[test]
fn without_a_twin_exact_the_case_remains_indifferent() {
    // L'altra metà, ed è la regola che NON cambia: un solo candidato lo si
    // raggiunge scrivendolo come si vuole (0004, e un vault sincronizzato
    // fra macOS e Linux è lo stesso vault).
    let a = doc_with_links("a.md", &["NOTA"]);
    let notes = DocumentModel::empty(DocId::new("sub/Nota.md"));
    let graph = LinkGraph::build([&a, &notes]);
    assert_eq!(graph.resolve_wiki("nOtA"), Some(DocId::new("sub/Nota.md")));
    assert_eq!(sources(&graph, "sub/Nota.md"), ["a.md"]);
}

/// **Le due metà della stessa domanda**, e stanno nello stesso banco perché
/// una sembra il difetto dell'altra.
///
/// `backlinks()` e `outgoing()` elencano **link**: due citazioni della
/// stessa nota sono due riferimenti, con due contesti, ed è ciò che un
/// pannello backlink mostra. Questa metà è la più vecchia del banco e va
/// letta come una difesa — presa da sola somiglia a un doppione, e il
/// rimedio ovvio (deduplicare qui) cancellerebbe il contesto della seconda
/// menzione senza che nessun altro presidio se ne accorgesse.
///
/// `linked()` elenca **documenti**, una volta ciascuno: è l'altra domanda, e
/// prima che avesse una firma i tre chiamanti interni se la ricavavano da
/// soli in tre modi diversi. Questa metà è **verde per costruzione** — il
/// ritorno è un `BTreeSet`, non potrebbe fallire — ed è scritta lo stesso,
/// perché ciò che il banco ha da dire è che le due domande sono diverse e
/// hanno due risposte diverse.
#[test]
fn duplicate_links_keep_multiplicity() {
    let a = doc_with_links("a.md", &["Nota", "Nota"]);
    let notes = DocumentModel::empty(DocId::new("Nota.md"));
    let mut graph = LinkGraph::build([&a, &notes]);
    assert_eq!(sources(&graph, "Nota.md"), ["a.md", "a.md"]);
    assert_eq!(graph.outgoing(&DocId::new("a.md")).len(), 2);

    // idempotenza: ri-upsert dello stesso documento non duplica nulla
    graph.upsert(&a);
    assert_eq!(sources(&graph, "Nota.md"), ["a.md", "a.md"]);
    assert_eq!(graph.outgoing(&DocId::new("a.md")).len(), 2);

    let target = DocId::new("Nota.md");
    assert_eq!(
        graph.linked(&target, LinkDirection::Inbound),
        BTreeSet::from([DocId::new("a.md")]),
        "two references, but the note linking here is one"
    );
    assert_eq!(
        graph.linked(&DocId::new("a.md"), LinkDirection::Outbound),
        BTreeSet::from([target.clone()])
    );
    assert_eq!(
        graph.linked(&target, LinkDirection::Both),
        BTreeSet::from([DocId::new("a.md")]),
        "and in both directions together you do not count twice the one in both"
    );
}

// --- la camminata: `IndexQuery::Neighbors` (decisione 0005) ----------------------

/// `a → b → c`, e `d → a`.
fn chain() -> Vec<DocumentModel> {
    vec![
        doc_with_links("a.md", &["b"]),
        doc_with_links("b.md", &["c"]),
        DocumentModel::empty(DocId::new("c.md")),
        doc_with_links("d.md", &["a"]),
    ]
}

fn walk(graph: &LinkGraph, from: &str, dir: LinkDirection, depth: u8) -> Vec<(String, u8)> {
    graph
        .neighbors(&DocId::new(from), dir, depth)
        .into_iter()
        .map(|n| (n.doc.to_string(), n.depth))
        .collect()
}

#[test]
fn one_step_out_is_plain_adjacency() {
    let docs = chain();
    let graph = LinkGraph::build(docs.iter());
    assert_eq!(
        walk(&graph, "a.md", LinkDirection::Outbound, 1),
        [("b.md".to_string(), 1)]
    );
    assert_eq!(
        walk(&graph, "a.md", LinkDirection::Inbound, 1),
        [("d.md".to_string(), 1)],
        "the inbound direction is backlinks"
    );
}

#[test]
fn depth_is_a_breadth_first_walk_and_via_rebuilds_the_edges() {
    let docs = chain();
    let graph = LinkGraph::build(docs.iter());
    let found = graph.neighbors(&DocId::new("a.md"), LinkDirection::Outbound, 2);
    let edges: Vec<(String, String, u8)> = found
        .iter()
        .map(|n| (n.via.to_string(), n.doc.to_string(), n.depth))
        .collect();
    assert_eq!(
        edges,
        [
            ("a.md".to_string(), "b.md".to_string(), 1),
            ("b.md".to_string(), "c.md".to_string(), 2),
        ],
        "`via` is the previous hop: without it this would be a bag of nodes"
    );
}

#[test]
fn both_directions_meet_in_the_middle() {
    let docs = chain();
    let graph = LinkGraph::build(docs.iter());
    let names: Vec<String> = walk(&graph, "a.md", LinkDirection::Both, 1)
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(names, ["b.md", "d.md"], "outbound and inbound, in order");
}

#[test]
fn a_cycle_terminates_and_nobody_is_a_neighbour_of_itself() {
    let a = doc_with_links("a.md", &["b"]);
    let b = doc_with_links("b.md", &["a"]);
    let graph = LinkGraph::build([&a, &b]);
    let found = walk(&graph, "a.md", LinkDirection::Both, 10);
    assert_eq!(
        found,
        [("b.md".to_string(), 1)],
        "the cycle returns to a.md, which is not a neighbor of itself"
    );
}

#[test]
fn a_neighbour_reached_twice_keeps_the_shortest_distance() {
    // a → b, a → c, b → c: `c` è a un passo, non a due.
    let a = doc_with_links("a.md", &["b", "c"]);
    let b = doc_with_links("b.md", &["c"]);
    let c = DocumentModel::empty(DocId::new("c.md"));
    let graph = LinkGraph::build([&a, &b, &c]);
    assert_eq!(
        walk(&graph, "a.md", LinkDirection::Outbound, 3),
        [("b.md".to_string(), 1), ("c.md".to_string(), 1)]
    );
}

#[test]
fn depth_zero_is_an_empty_answer() {
    let docs = chain();
    let graph = LinkGraph::build(docs.iter());
    assert!(walk(&graph, "a.md", LinkDirection::Both, 0).is_empty());
}

// --- link markdown: la seconda specie di arco (decisione 0004) ------------------

fn doc_with_paths(id: &str, dests: &[&str]) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.links = dests
        .iter()
        .map(|d| Link {
            target: LinkTarget::Path((*d).to_string()),
            embed: false,
            span: Span::EMPTY,
            context: Some(format!("→ {d}")),
        })
        .collect();
    m
}

#[test]
fn a_markdown_link_picks_the_right_twin() {
    // Stessa domanda dal lato dei path, dove il danno è peggiore: qui il
    // riferimento è quello che la riscrittura al rename scrive su disco.
    let a = doc_with_paths("sub/a.md", &["Nota.md"]);
    let b = doc_with_paths("sub/b.md", &["nota.md"]);
    let large = DocumentModel::empty(DocId::new("sub/Nota.md"));
    let small = DocumentModel::empty(DocId::new("sub/nota.md"));
    let graph = LinkGraph::build([&a, &b, &large, &small]);

    assert_eq!(sources(&graph, "sub/Nota.md"), ["sub/a.md"]);
    assert_eq!(sources(&graph, "sub/nota.md"), ["sub/b.md"]);
}

#[test]
fn a_path_link_is_relative_to_its_source() {
    // Stessa stringa, due sorgenti, due documenti: è tutta la differenza
    // fra un link markdown e un wikilink.
    let root = doc_with_paths("a.md", &["Nota.md"]);
    let sub = doc_with_paths("sub/a.md", &["Nota.md"]);
    let n_root = DocumentModel::empty(DocId::new("Nota.md"));
    let n_sub = DocumentModel::empty(DocId::new("sub/Nota.md"));
    let graph = LinkGraph::build([&root, &sub, &n_root, &n_sub]);

    assert_eq!(sources(&graph, "Nota.md"), ["a.md"]);
    assert_eq!(sources(&graph, "sub/Nota.md"), ["sub/a.md"]);
}

#[test]
fn a_path_link_walks_up_and_starts_from_the_root() {
    let a = doc_with_paths("x/y/a.md", &["../../Nota.md", "/Altra.md"]);
    let notes = DocumentModel::empty(DocId::new("Nota.md"));
    let other = DocumentModel::empty(DocId::new("Altra.md"));
    let graph = LinkGraph::build([&a, &notes, &other]);

    assert_eq!(sources(&graph, "Nota.md"), ["x/y/a.md"]);
    assert_eq!(sources(&graph, "Altra.md"), ["x/y/a.md"]);
}

#[test]
fn a_path_link_never_falls_back_to_name_or_alias() {
    let a = doc_with_paths("a.md", &["Nota.md", "Mario"]);
    let deep = doc_with_aliases("x/y/Nota.md", &["Mario"]);
    let graph = LinkGraph::build([&a, &deep]);

    // `[[Nota]]` lo troverebbe per nome, `[[Mario]]` per alias: un path no.
    assert_eq!(graph.resolve_wiki("Nota"), Some(DocId::new("x/y/Nota.md")));
    assert!(sources(&graph, "x/y/Nota.md").is_empty());
}

#[test]
fn an_explicit_extension_is_taken_seriously() {
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let exact = doc_with_paths("a.md", &["sub/nota.txt"]);
    let without = doc_with_paths("b.md", &["sub/nota"]);
    let wrong = doc_with_paths("c.md", &["sub/nota.png"]);
    let graph = LinkGraph::build([&md, &txt, &exact, &without, &wrong]);

    // L'esatto vince sull'ordine di priorità; il senza-estensione ricade
    // sulla chiave dei wikilink; l'estensione inesistente non ricade su
    // nulla — `c.md` non è backlink di nessuno dei due.
    assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
    assert_eq!(sources(&graph, "sub/nota.md"), ["b.md"]);
    // L'estensione inesistente non ricade su nulla — `c.md` non è backlink
    // di nessuno dei due. È la regola che tiene il ripiego di
    // `resolve_path_key` con la chiave intera: indicizzarlo con
    // `strip_ext(key)` farebbe ricadere `[t](sub/nota.png)` su `sub/nota.md`.
    assert!(sources(&graph, "sub/nota.png").is_empty());
    assert!(graph.outgoing(&DocId::new("c.md")).is_empty());
}

#[test]
fn percent_encoding_and_fragments_do_not_change_the_edge() {
    let a = doc_with_paths("a.md", &["sub/nota%20uno.md#sezione"]);
    let target = DocumentModel::empty(DocId::new("sub/nota uno.md"));
    let graph = LinkGraph::build([&a, &target]);
    assert_eq!(sources(&graph, "sub/nota uno.md"), ["a.md"]);
}

#[test]
fn what_is_not_a_vault_resource_is_not_an_edge() {
    let mut a = doc_with_paths("a.md", &["../fuori.md", "#solo-ancora", ""]);
    a.links.push(Link {
        target: LinkTarget::Url("https://esempio.test/Nota.md".into()),
        embed: false,
        span: Span::EMPTY,
        context: None,
    });
    let graph = LinkGraph::build([&a]);
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
}

#[test]
fn upsert_resolves_and_steals_path_links_too() {
    // La stessa proprietà dei wikilink, sull'altra specie: creare il
    // bersaglio risolve il link pendente, toglierlo lo restituisce.
    let a = doc_with_paths("a.md", &["sub/Nota.md"]);
    let mut graph = LinkGraph::build([&a]);
    assert!(sources(&graph, "sub/Nota.md").is_empty());

    graph.upsert(&DocumentModel::empty(DocId::new("sub/Nota.md")));
    assert_eq!(sources(&graph, "sub/Nota.md"), ["a.md"]);

    graph.remove(&DocId::new("sub/Nota.md"));
    assert!(sources(&graph, "sub/Nota.md").is_empty());
    assert!(graph.outgoing(&DocId::new("a.md")).is_empty());
}

#[test]
fn remove_of_the_winner_falls_back_for_an_extensionless_path_link() {
    let a = doc_with_paths("a.md", &["sub/nota"]);
    let md = DocumentModel::empty(DocId::new("sub/nota.md"));
    let txt = DocumentModel::empty(DocId::new("sub/nota.txt"));
    let mut graph = LinkGraph::build([&a, &md, &txt]);
    assert_eq!(sources(&graph, "sub/nota.md"), ["a.md"]);

    graph.remove(&DocId::new("sub/nota.md"));
    assert_eq!(sources(&graph, "sub/nota.txt"), ["a.md"]);
}

#[test]
fn remove_of_unknown_document_is_a_noop() {
    let a = doc_with_links("a.md", &["Nota"]);
    let mut graph = LinkGraph::build([&a]);
    graph.remove(&DocId::new("mai-esistito.md"));
    assert_eq!(graph.documents(), [DocId::new("a.md")]);
}

/// `outgoing_with_context` dice la stessa cosa di `outgoing`, riga per
/// riga: stesso ordine del sorgente, stessi duplicati, e il contesto di
/// ogni link.
#[test]
fn outgoing_with_context_preserves_source_order_and_duplicates() {
    let mut m = DocumentModel::empty(DocId::new("a.md"));
    m.links = vec![
        Link {
            target: LinkTarget::wiki("Nota"),
            embed: false,
            span: Span::EMPTY,
            context: Some("primo".to_string()),
        },
        Link {
            target: LinkTarget::wiki("Altra"),
            embed: false,
            span: Span::EMPTY,
            context: None,
        },
        Link {
            target: LinkTarget::wiki("Nota"),
            embed: false,
            span: Span::EMPTY,
            context: Some("terzo".to_string()),
        },
        Link {
            target: LinkTarget::wiki("Inesistente"),
            embed: false,
            span: Span::EMPTY,
            context: Some("mai risolta".to_string()),
        },
    ];
    let targets = [
        DocumentModel::empty(DocId::new("Nota.md")),
        DocumentModel::empty(DocId::new("Altra.md")),
    ];
    let graph = LinkGraph::build([&m, &targets[0], &targets[1]]);
    let source = DocId::new("a.md");

    let with_context = graph.outgoing_with_context(&source);
    // I non risolti si saltano, l'ordine e i duplicati restano.
    assert_eq!(
        with_context,
        vec![
            (DocId::new("Nota.md"), Some("primo".to_string())),
            (DocId::new("Altra.md"), None),
            (DocId::new("Nota.md"), Some("terzo".to_string())),
        ]
    );
    let plain: Vec<DocId> = with_context.into_iter().map(|(t, _)| t).collect();
    assert_eq!(plain, graph.outgoing(&source));
}

#[allow(clippy::type_complexity)]
fn full_snapshot(
    graph: &LinkGraph,
    docs: &[DocId],
) -> Vec<(DocId, Vec<DocId>, Vec<(DocId, Option<String>)>)> {
    let mut snap: Vec<(DocId, Vec<DocId>, Vec<(DocId, Option<String>)>)> = docs
        .iter()
        .map(|id| {
            (
                id.clone(),
                graph.outgoing(id),
                graph.outgoing_with_context(id),
            )
        })
        .collect();
    snap.sort();
    snap
}

fn doc_with_aliases_and_links(id: &str, aliases: &[&str], links: &[&str]) -> DocumentModel {
    let mut m = doc_with_links(id, links);
    m.frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(aliases));
    m
}

/// `upsert` dopo alias, omonimi e rename produce lo stesso osservabile di
/// `build`: `outgoing` e `outgoing_with_context` compresi. È la metà che il
/// test di proprietà in `tests/graph_incremental.rs` copre in casuale —
/// qui il caso è deterministico: alias che rubano la risoluzione, omonimi
/// a profondità diverse, rename come `remove`+`upsert`.
#[test]
fn upsert_matches_build_after_aliases_homonyms_and_rename() {
    let a = doc_with_links("a.md", &["Mario", "Nota"]);
    let rossi = doc_with_aliases_and_links("people/Rossi.md", &["Mario"], &["Nota"]);
    let deep = DocumentModel::empty(DocId::new("x/y/Nota.md"));
    let shallow = DocumentModel::empty(DocId::new("Nota.md"));

    // Stato iniziale: l'alias pesca Rossi, il nome la nota in radice.
    let mut graph = LinkGraph::build([&a, &rossi, &deep, &shallow]);
    assert_eq!(
        graph.resolve_wiki("Mario"),
        Some(DocId::new("people/Rossi.md"))
    );

    // Rossi perde l'alias: `Mario` non risolve più, e l'osservabile è
    // quello di un rebuild senza alias.
    let rossi_plain = DocumentModel::empty(DocId::new("people/Rossi.md"));
    graph.upsert(&rossi_plain);
    let oracle = LinkGraph::build([&a, &rossi_plain, &deep, &shallow]);
    let ids: Vec<DocId> = ["a.md", "people/Rossi.md", "x/y/Nota.md", "Nota.md"]
        .into_iter()
        .map(DocId::new)
        .collect();
    assert_eq!(full_snapshot(&graph, &ids), full_snapshot(&oracle, &ids));

    // Rename di Rossi in `team/Rossi.md` come remove+upsert: la risoluzione
    // per path cambia, quella per nome degli omonimi resta, e l'oracolo è
    // d'accordo su outgoing e contesti.
    graph.remove(&DocId::new("people/Rossi.md"));
    let rossi_moved = doc_with_aliases_and_links("team/Rossi.md", &["Mario"], &["Nota"]);
    graph.upsert(&rossi_moved);
    let oracle = LinkGraph::build([&a, &rossi_moved, &deep, &shallow]);
    let ids: Vec<DocId> = ["a.md", "team/Rossi.md", "x/y/Nota.md", "Nota.md"]
        .into_iter()
        .map(DocId::new)
        .collect();
    assert_eq!(full_snapshot(&graph, &ids), full_snapshot(&oracle, &ids));
    assert_eq!(
        graph.resolve_wiki("Mario"),
        Some(DocId::new("team/Rossi.md"))
    );
}
