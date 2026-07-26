//! Test end-to-end della pipeline M1 sul vault di esempio:
//! scansione vault → provider markdown nativo → grafo dei link, senza GUI.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, KernelError, Workspace};

fn sample_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sample-vault")
}

fn open(root: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut ws = Workspace::new(root, registry);
    ws.reindex().expect("reindex del vault di esempio");
    ws
}

fn open_sample() -> Workspace {
    open(&sample_root())
}

/// Una copia usa-e-getta del vault di esempio.
///
/// **Ogni test che tocca il disco passa di qui** — crei un file o ne modifichi
/// uno che c'è già. Il fixture lo leggono tutti gli altri, in parallelo: una
/// nota dimenticata dentro lo farebbe mentire, e una modifica *temporanea* lo fa
/// mentire lo stesso, per la durata della finestra in cui è in piedi.
fn open_scratch() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    copy_dir(&sample_root(), &root);
    let ws = open(&root);
    (dir, ws)
}

fn copy_dir(from: &Utf8PathBuf, to: &Utf8PathBuf) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let src = Utf8PathBuf::from_path_buf(entry.path()).unwrap();
        let dst = to.join(entry.file_name().to_string_lossy().as_ref());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&src, &dst);
        } else {
            std::fs::copy(&src, &dst).unwrap();
        }
    }
}

#[test]
fn scans_all_documents() {
    let ws = open_sample();
    let docs = ws.documents();
    assert_eq!(docs.len(), 4, "documenti: {docs:?}");
    assert!(docs.contains(&DocId::new("index.md")));
    assert!(docs.contains(&DocId::new("Progetti/Alpha.md")));
}

#[test]
fn resolves_wikilinks_by_name_alias_and_path() {
    let ws = open_sample();
    assert_eq!(ws.resolve_link("Nota B"), Some(DocId::new("Nota B.md")));
    assert_eq!(
        ws.resolve_link("Alfa"),
        Some(DocId::new("Progetti/Alpha.md"))
    );
    assert_eq!(
        ws.resolve_link("Progetti/Alpha"),
        Some(DocId::new("Progetti/Alpha.md"))
    );
    assert_eq!(ws.resolve_link("Inesistente"), None);
}

#[test]
fn computes_backlinks_with_context() {
    let ws = open_sample();
    let bl = ws.backlinks(&DocId::new("Nota B.md"));
    let sources: Vec<_> = bl.iter().map(|r| r.source.as_str()).collect();
    // index (2 link), Progetti/Alpha, Daily (via embed) puntano a Nota B.
    assert!(sources.contains(&"index.md"), "backlink: {sources:?}");
    assert!(
        sources.contains(&"Progetti/Alpha.md"),
        "backlink: {sources:?}"
    );
    assert!(
        sources.contains(&"Daily/2026-07-24.md"),
        "backlink: {sources:?}"
    );
    assert!(bl.iter().any(|r| r.context.is_some()));
}

#[test]
fn renders_preview_with_wikilink_data_attrs() {
    let ws = open_sample();
    let html = ws.render_preview(&DocId::new("index.md")).unwrap();
    assert!(
        html.contains("data-wikilink-page=\"Nota B\""),
        "html: {html}"
    );
    assert!(html.contains("class=\"tag\""));
}

#[test]
fn edit_updates_graph_and_backlinks() {
    // Sulla **copia**, non sul fixture: questo test scrive, e i test di questo
    // binario girano in parallelo. Scriveva sul fixture condiviso ripristinando
    // il contenuto alla fine — che non è una difesa, perché nella finestra fra
    // la scrittura e il ripristino chi legge lo stesso file legge un vault
    // diverso da quello che si aspetta. Il sintomo era
    // `computes_backlinks_with_context` rosso circa una volta su cinque, senza
    // che nulla nel suo codice fosse cambiato: il difetto peggiore, quello che
    // si prende per rumore e si rilancia finché passa.
    let (_scratch, mut ws) = open_scratch();
    let daily = DocId::new("Daily/2026-07-24.md");
    // Prima: Daily non punta a index.
    assert!(!ws
        .backlinks(&DocId::new("index.md"))
        .iter()
        .any(|r| r.source == daily));
    // Scrive un nuovo contenuto che aggiunge un link a index.
    ws.write_document(&daily, "# Diario\n\nAdesso punto a [[index]].\n")
        .unwrap();
    assert!(ws
        .backlinks(&DocId::new("index.md"))
        .iter()
        .any(|r| r.source == daily));
}

#[test]
fn a_new_note_takes_the_first_free_untitled_name() {
    let (_scratch, mut ws) = open_scratch();

    assert_eq!(ws.create_note(None).unwrap(), DocId::new("Senza titolo.md"));
    assert_eq!(
        ws.create_note(None).unwrap(),
        DocId::new("Senza titolo 1.md")
    );
    assert_eq!(
        ws.create_note(None).unwrap(),
        DocId::new("Senza titolo 2.md")
    );

    // Nasce vuota, e nasce già dentro il vault: nessun secondo passaggio.
    assert_eq!(ws.read_source(&DocId::new("Senza titolo.md")).unwrap(), "");
    assert!(ws.documents().contains(&DocId::new("Senza titolo 1.md")));
}

#[test]
fn creating_the_note_a_dangling_link_points_to_makes_the_backlink_appear() {
    let (_scratch, mut ws) = open_scratch();
    // `index.md` contiene `[[Inesistente]]`, un link che non risolve.
    assert!(ws.resolve_link("Inesistente").is_none());

    let creata = ws.create_note(Some("Inesistente")).unwrap();

    assert_eq!(
        creata,
        DocId::new("Inesistente.md"),
        "l'estensione la mette il kernel"
    );
    assert_eq!(ws.resolve_link("Inesistente"), Some(creata.clone()));
    // Il backlink compare da solo: il link in `index.md` non è stato toccato,
    // è il grafo a risolverlo di nuovo ora che la destinazione esiste.
    let sorgenti: Vec<String> = ws
        .backlinks(&creata)
        .iter()
        .map(|r| r.source.to_string())
        .collect();
    assert!(
        sorgenti.contains(&"index.md".to_string()),
        "backlink: {sorgenti:?}"
    );
}

#[test]
fn a_note_created_in_a_folder_stays_there() {
    let (_scratch, mut ws) = open_scratch();
    let creata = ws.create_note(Some("Progetti/Beta")).unwrap();
    assert_eq!(creata, DocId::new("Progetti/Beta.md"));
    assert_eq!(ws.resolve_link("Beta"), Some(creata));
}

/// I link markdown ordinari (decisione 0004) sul parser vero: gli `Span` sono quelli di
/// comrak, non quelli di un provider giocattolo, e la riscrittura al rename
/// ritaglia dentro di essi.
#[test]
fn markdown_links_are_edges_and_survive_a_rename() {
    let (_scratch, mut ws) = open_scratch();
    let sorgente = DocId::new("Progetti/fonte.md");
    ws.write_document(
        &sorgente,
        concat!(
            "# Fonte\n\n",
            // Le due grafie di uno spazio in una destinazione markdown: le
            // parentesi angolari e il percent-encoding. Devono essere lo stesso
            // arco, e vanno riscritte entrambe.
            "Un [link relativo](<../Nota B.md>) e uno [dentro la cartella](Alpha.md).\n",
            "Un [link con ancora](../Nota%20B.md#sezione) e un [url](https://esempio.test/Nota%20B.md).\n",
        ),
    )
    .unwrap();

    // Archi e backlink: come i wikilink, senza distinzioni.
    let sorgenti: Vec<String> = ws
        .backlinks(&DocId::new("Nota B.md"))
        .iter()
        .map(|r| r.source.to_string())
        .collect();
    assert_eq!(
        sorgenti
            .iter()
            .filter(|s| *s == "Progetti/fonte.md")
            .count(),
        2,
        "i due link a Nota B (nudo e con ancora) sono due archi: {sorgenti:?}"
    );
    assert!(ws
        .backlinks(&DocId::new("Progetti/Alpha.md"))
        .iter()
        .any(|r| r.source == sorgente));

    // Rename del bersaglio: i riferimenti si riscrivono relativi alla sorgente,
    // l'ancora resta, gli spazi si codificano, l'url non si tocca.
    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Archivio/Nota C.md"))
        .unwrap();
    let testo = ws.read_source(&sorgente).unwrap();
    assert!(
        testo.contains("[link relativo](<../Archivio/Nota%20C.md>)"),
        "riscrittura mancata: {testo}"
    );
    assert!(
        testo.contains("[link con ancora](../Archivio/Nota%20C.md#sezione)"),
        "ancora persa: {testo}"
    );
    assert!(
        testo.contains("[url](https://esempio.test/Nota%20B.md)"),
        "un url non è un arco e non si riscrive: {testo}"
    );
    assert!(
        testo.contains("[dentro la cartella](Alpha.md)"),
        "il link a un documento che non si è mosso resta com'era: {testo}"
    );

    // E se a spostarsi è la sorgente, i suoi link relativi si ri-basano.
    ws.rename_document(&sorgente, &DocId::new("fonte.md"))
        .unwrap();
    let testo = ws.read_source(&DocId::new("fonte.md")).unwrap();
    assert!(
        testo.contains("[link relativo](<Archivio/Nota%20C.md>)"),
        "ri-basatura mancata: {testo}"
    );
    assert!(
        testo.contains("[dentro la cartella](Progetti/Alpha.md)"),
        "ri-basatura mancata: {testo}"
    );
    assert!(ws
        .backlinks(&DocId::new("Progetti/Alpha.md"))
        .iter()
        .any(|r| r.source == DocId::new("fonte.md")));
}

/// Il riferimento **incorporato** alla markdown (`![alt](path)`) è un arco come
/// gli altri — e prima della decisione 0003 non esisteva affatto: comrak lo dava come
/// `Image`, il provider ne teneva l'inline e **non** lo metteva in `links`,
/// quindi niente backlink e nessuna riscrittura al rename. È il buco che
/// lasciava 13.1 fuori portata anche dopo che la decisione 0004 aveva reso i path archi.
#[test]
fn an_embedded_reference_is_an_edge_too() {
    let (_scratch, mut ws) = open_scratch();
    let sorgente = DocId::new("Progetti/fonte.md");
    ws.write_document(
        &sorgente,
        concat!(
            "# Fonte\n\n",
            "Incorporo ![una nota](<../Nota B.md>) e un ![allegato](../allegati/foto.png).\n",
            "E una ![remota](https://esempio.test/x.png), che non è del vault.\n",
        ),
    )
    .unwrap();

    assert!(ws
        .backlinks(&DocId::new("Nota B.md"))
        .iter()
        .any(|r| r.source == sorgente));

    // E si riscrive al rename come ogni altro riferimento, dentro lo `Span` che
    // comrak ha dato all'immagine.
    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Archivio/Nota C.md"))
        .unwrap();
    let testo = ws.read_source(&sorgente).unwrap();
    assert!(
        testo.contains("![una nota](<../Archivio/Nota%20C.md>)"),
        "riscrittura mancata: {testo}"
    );
    assert!(
        testo.contains("![allegato](../allegati/foto.png)"),
        "un riferimento a un file che non si è mosso resta com'era: {testo}"
    );
    assert!(
        testo.contains("![remota](https://esempio.test/x.png)"),
        "un url non è un arco: {testo}"
    );
}

/// Quando etichetta e riferimento sono la stessa stringa, la sostituzione deve
/// prendere quello giusto — e le due sintassi lo mettono da parti opposte.
#[test]
fn the_label_is_not_mistaken_for_the_reference() {
    let (_scratch, mut ws) = open_scratch();
    let sorgente = DocId::new("fonte.md");
    ws.write_document(
        &sorgente,
        "Un [[Nota B|Nota B]] e un [Progetti/Alpha.md](Progetti/Alpha.md).\n",
    )
    .unwrap();

    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Nota C.md"))
        .unwrap();
    ws.rename_document(
        &DocId::new("Progetti/Alpha.md"),
        &DocId::new("Progetti/Beta.md"),
    )
    .unwrap();

    let testo = ws.read_source(&sorgente).unwrap();
    assert_eq!(
        testo,
        // Nel wikilink cambia la pagina (la prima), non l'etichetta; nel link
        // markdown cambia la destinazione (la seconda), non l'etichetta.
        "Un [[Nota C|Nota B]] e un [Progetti/Alpha.md](Progetti/Beta.md).\n"
    );
}

#[test]
fn creating_a_note_over_an_existing_one_is_refused() {
    let (_scratch, mut ws) = open_scratch();
    // Nessun nome aggiustato in silenzio: se il path esistesse, il link da cui
    // arriva la richiesta non sarebbe stato non risolto.
    let err = ws.create_note(Some("Nota B")).unwrap_err();
    assert!(
        matches!(err, KernelError::AlreadyExists(_)),
        "trovato {err}"
    );
    let err = ws.create_note(Some("   ")).unwrap_err();
    assert!(matches!(err, KernelError::BadName(_)), "trovato {err}");
}
