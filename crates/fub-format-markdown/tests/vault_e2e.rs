//! Test end-to-end della pipeline M1 sul vault di esempio:
//! scansione vault → provider markdown nativo → grafo dei link, senza GUI.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::BacklinkRef;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, KernelError, Workspace};

fn sample_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/sample-vault")
}

fn open(root: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(root, registry).expect("l'apertura del vault riesce");
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
    every_backlink_carries_the_context(&bl, "Nota B");
}

/// **Ogni** backlink porta il contesto, e il contesto è la riga in cui il
/// riferimento sta davvero.
///
/// Qui c'era `any(|r| r.context.is_some())`, che è il modo in cui un elenco si
/// presidia col suo elemento più fortunato: bastava che *uno* dei quattro
/// backlink avesse il contesto perché il banco che porta `with_context` nel
/// nome passasse, e i quattro sono quattro proprio perché `index.md` ne
/// contribuisce due. Un `any` non è una pretesa più debole di poco: è una
/// pretesa su un altro insieme.
///
/// Le due metà che quell'asserzione non guardava, e che questa guarda:
///
/// - **quale** manca, perché un `any` che va rosso non ha niente da dire e un
///   `all` senza messaggio nemmeno;
/// - **che il contesto sia quello giusto**, ed è la metà che compra qualcosa.
///   Che il contesto *esista* lo presidia già, e su ogni variante di `Block`
///   invece che su quattro backlink, `every_corpus_link_carries_the_context_
///   of_its_block` in `the_corpus.rs`. Quello che né quel conto né `is_some()`
///   vedono è un campo **pieno e sbagliato**: un `context` che porti un pezzo
///   qualunque del documento sorgente — la prima riga, il titolo — passa da
///   tutti e due, e il pannello dei backlink lo mostra sotto il nome della nota
///   facendo credere di aver citato la riga del riferimento. Il contesto è il
///   testo del blocco che contiene il link, quindi il nome del bersaglio ci sta
///   dentro per costruzione, e chiederlo è l'unico modo di distinguere la riga
///   giusta da una riga.
///
/// Sta in una funzione e non nel banco perché i backlink li chiedono altri sei
/// test di questo file: il secondo che vorrà guardare il contesto non ha da
/// riscrivere né la pretesa né il messaggio.
fn every_backlink_carries_the_context(refs: &[BacklinkRef], target: &str) {
    assert!(!refs.is_empty(), "nessun backlink da controllare");
    for r in refs {
        let ctx = r.context.as_deref().unwrap_or_else(|| {
            panic!(
                "il backlink da {} non porta nessun contesto: il pannello dei \
                 backlink mostrerà il nome della nota e basta",
                r.source.as_str()
            )
        });
        assert!(
            ctx.contains(target),
            "il contesto del backlink da {} non nomina `{target}`: {ctx:?} — \
             il campo porta un pezzo del documento che non è la riga del \
             riferimento",
            r.source.as_str()
        );
    }
}

#[test]
fn renders_preview_with_wikilink_data_attrs() {
    let ws = open_sample();
    let html = ws.render_preview(&DocId::new("index.md")).unwrap().html;
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
    ws.write_document(
        &daily,
        "# Diario\n\nAdesso punto a [[index]].\n",
        WriteBase::Dictated,
    )
    .unwrap();
    assert!(ws
        .backlinks(&DocId::new("index.md"))
        .iter()
        .any(|r| r.source == daily));
}

/// **`![[Nota#^blocco]]` trascluda quel blocco**, non la nota intera.
///
/// Il segnaposto portava pagina e heading e il kernel sapeva ritagliare solo una
/// sezione, quindi l'ancora si perdeva due volte lungo la stessa strada — e il
/// modo di fallimento era il peggiore: **niente andava storto**. Si vedeva la
/// nota intera, che è una risposta plausibile, e nessuno diceva che ne era stata
/// chiesta una riga.
///
/// Il ritaglio non è un secondo parser di ancore: `DocumentModel::anchors` porta
/// già lo span del blocco, e il contratto lo dice accanto al campo — *«è ciò che
/// un embed di blocco ritaglia»*. Mancava chi lo chiedesse.
///
/// **Questa metà non poteva essere rossa**, e va detto: `render_embed` il blocco
/// non lo prendeva proprio, quindi il banco non compilava invece di fallire. La
/// metà che era rossa sta di là ed è il sito che il difetto nominava,
/// `il_segnaposto_di_un_embed_porta_anche_l_ancora_di_blocco` in
/// `fub-format-markdown/src/lib.rs`: il segnaposto non scriveva l'ancora. Questo
/// banco presidia il resto della strada, che quell'ancora prima non aveva.
#[test]
fn an_embed_carves_out_that_block() {
    let (_scratch, mut ws) = open_scratch();
    let notes = DocId::new("Nota B.md");
    ws.write_document(
        &notes,
        "# Nota B\n\nprimo paragrafo\n\nil secondo, indirizzabile ^bersaglio\n\nterzo\n",
        WriteBase::Dictated,
    )
    .unwrap();

    let (_id, all) = ws
        .render_embed("Nota B", None, None)
        .expect("la nota intera");
    assert!(
        all.html.contains("primo") && all.html.contains("terzo"),
        "senza coordinate si trascluda tutto: {}",
        all.html
    );

    let (_id, block) = ws
        .render_embed("Nota B", None, Some("bersaglio"))
        .expect("il blocco indirizzato");
    assert!(
        block.html.contains("il secondo"),
        "l'embed non porta il blocco chiesto: {}",
        block.html
    );
    assert!(
        !block.html.contains("primo") && !block.html.contains("terzo"),
        "l'embed di un blocco porta anche il resto della nota: {}",
        block.html
    );

    // Case-insensitive come tutta la risoluzione delle ancore
    // (`canonical_anchor`): un embed che trovasse un blocco diverso da quello
    // che il link apre sarebbe la stessa scritta che mostra due cose.
    assert!(ws
        .render_embed("Nota B", None, Some("Bersaglio"))
        .is_ok_and(|(_, r)| r.html.contains("il secondo")));

    // E un'ancora che non c'è **si dice**: rispondere con la nota intera sarebbe
    // la risposta plausibile che nasconde l'errore, ed è com'era.
    assert!(
        ws.render_embed("Nota B", None, Some("inesistente"))
            .is_err(),
        "un'ancora che non esiste deve risalire, non degradare alla nota intera"
    );
}

#[test]
fn a_new_notes_takes_the_first_free_untitled_name() {
    let (_scratch, mut ws) = open_scratch();

    assert_eq!(
        ws.create_notes(None).unwrap(),
        DocId::new("Senza titolo.md")
    );
    assert_eq!(
        ws.create_notes(None).unwrap(),
        DocId::new("Senza titolo 1.md")
    );
    assert_eq!(
        ws.create_notes(None).unwrap(),
        DocId::new("Senza titolo 2.md")
    );

    // Nasce vuota, e nasce già dentro il vault: nessun secondo passaggio.
    assert_eq!(ws.read_source(&DocId::new("Senza titolo.md")).unwrap(), "");
    assert!(ws.documents().contains(&DocId::new("Senza titolo 1.md")));
}

#[test]
fn creating_the_notes_a_dangling_link_points_to_makes_the_backlink_appear() {
    let (_scratch, mut ws) = open_scratch();
    // `index.md` contiene `[[Inesistente]]`, un link che non risolve.
    assert!(ws.resolve_link("Inesistente").is_none());

    let created = ws.create_notes(Some("Inesistente")).unwrap();

    assert_eq!(
        created,
        DocId::new("Inesistente.md"),
        "l'estensione la mette il kernel"
    );
    assert_eq!(ws.resolve_link("Inesistente"), Some(created.clone()));
    // Il backlink compare da solo: il link in `index.md` non è stato toccato,
    // è il grafo a risolverlo di nuovo ora che la destinazione esiste.
    let sources: Vec<String> = ws
        .backlinks(&created)
        .iter()
        .map(|r| r.source.to_string())
        .collect();
    assert!(
        sources.contains(&"index.md".to_string()),
        "backlink: {sources:?}"
    );
}

#[test]
fn a_notes_created_in_a_folder_stays_there() {
    let (_scratch, mut ws) = open_scratch();
    let created = ws.create_notes(Some("Progetti/Beta")).unwrap();
    assert_eq!(created, DocId::new("Progetti/Beta.md"));
    assert_eq!(ws.resolve_link("Beta"), Some(created));
}

/// I link markdown ordinari (decisione 0004) sul parser vero: gli `Span` sono quelli di
/// comrak, non quelli di un provider giocattolo, e la riscrittura al rename
/// ritaglia dentro di essi.
#[test]
fn markdown_links_are_edges_and_survive_a_rename() {
    let (_scratch, mut ws) = open_scratch();
    let source = DocId::new("Progetti/fonte.md");
    ws.write_document(
        &source,
        concat!(
            "# Fonte\n\n",
            // Le due grafie di uno spazio in una destinazione markdown: le
            // parentesi angolari e il percent-encoding. Devono essere lo stesso
            // arco, e vanno riscritte entrambe.
            "Un [link relativo](<../Nota B.md>) e uno [dentro la cartella](Alpha.md).\n",
            "Un [link con ancora](../Nota%20B.md#sezione) e un [url](https://esempio.test/Nota%20B.md).\n",
        ),
        WriteBase::Dictated,
    )
    .unwrap();

    // Archi e backlink: come i wikilink, senza distinzioni.
    let sources: Vec<String> = ws
        .backlinks(&DocId::new("Nota B.md"))
        .iter()
        .map(|r| r.source.to_string())
        .collect();
    assert_eq!(
        sources.iter().filter(|s| *s == "Progetti/fonte.md").count(),
        2,
        "i due link a Nota B (nudo e con ancora) sono due archi: {sources:?}"
    );
    assert!(ws
        .backlinks(&DocId::new("Progetti/Alpha.md"))
        .iter()
        .any(|r| r.source == source));

    // Rename del bersaglio: i riferimenti si riscrivono relativi alla sorgente,
    // l'ancora resta, gli spazi si codificano, l'url non si tocca.
    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Archivio/Nota C.md"))
        .unwrap();
    let text = ws.read_source(&source).unwrap();
    assert!(
        text.contains("[link relativo](<../Archivio/Nota%20C.md>)"),
        "riscrittura mancata: {text}"
    );
    assert!(
        text.contains("[link con ancora](../Archivio/Nota%20C.md#sezione)"),
        "ancora persa: {text}"
    );
    assert!(
        text.contains("[url](https://esempio.test/Nota%20B.md)"),
        "un url non è un arco e non si riscrive: {text}"
    );
    assert!(
        text.contains("[dentro la cartella](Alpha.md)"),
        "il link a un documento che non si è mosso resta com'era: {text}"
    );

    // E se a spostarsi è la sorgente, i suoi link relativi si ri-basano.
    ws.rename_document(&source, &DocId::new("fonte.md"))
        .unwrap();
    let text = ws.read_source(&DocId::new("fonte.md")).unwrap();
    assert!(
        text.contains("[link relativo](<Archivio/Nota%20C.md>)"),
        "ri-basatura mancata: {text}"
    );
    assert!(
        text.contains("[dentro la cartella](Progetti/Alpha.md)"),
        "ri-basatura mancata: {text}"
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
    let source = DocId::new("Progetti/fonte.md");
    ws.write_document(
        &source,
        concat!(
            "# Fonte\n\n",
            "Incorporo ![una nota](<../Nota B.md>) e un ![allegato](../allegati/foto.png).\n",
            "E una ![remota](https://esempio.test/x.png), che non è del vault.\n",
        ),
        WriteBase::Dictated,
    )
    .unwrap();

    assert!(ws
        .backlinks(&DocId::new("Nota B.md"))
        .iter()
        .any(|r| r.source == source));

    // E si riscrive al rename come ogni altro riferimento, dentro lo `Span` che
    // comrak ha dato all'immagine.
    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Archivio/Nota C.md"))
        .unwrap();
    let text = ws.read_source(&source).unwrap();
    assert!(
        text.contains("![una nota](<../Archivio/Nota%20C.md>)"),
        "riscrittura mancata: {text}"
    );
    assert!(
        text.contains("![allegato](../allegati/foto.png)"),
        "un riferimento a un file che non si è mosso resta com'era: {text}"
    );
    assert!(
        text.contains("![remota](https://esempio.test/x.png)"),
        "un url non è un arco: {text}"
    );
}

/// Quando etichetta e riferimento sono la stessa stringa, la sostituzione deve
/// prendere quello giusto — e le due sintassi lo mettono da parti opposte.
#[test]
fn the_label_is_not_mistaken_for_the_reference() {
    let (_scratch, mut ws) = open_scratch();
    let source = DocId::new("fonte.md");
    ws.write_document(
        &source,
        "Un [[Nota B|Nota B]] e un [Progetti/Alpha.md](Progetti/Alpha.md).\n",
        WriteBase::Dictated,
    )
    .unwrap();

    ws.rename_document(&DocId::new("Nota B.md"), &DocId::new("Nota C.md"))
        .unwrap();
    ws.rename_document(
        &DocId::new("Progetti/Alpha.md"),
        &DocId::new("Progetti/Beta.md"),
    )
    .unwrap();

    let text = ws.read_source(&source).unwrap();
    assert_eq!(
        text,
        // Nel wikilink cambia la pagina (la prima), non l'etichetta; nel link
        // markdown cambia la destinazione (la seconda), non l'etichetta.
        "Un [[Nota C|Nota B]] e un [Progetti/Alpha.md](Progetti/Beta.md).\n"
    );
}

#[test]
fn creating_a_notes_over_an_existing_one_is_refused() {
    let (_scratch, mut ws) = open_scratch();
    // Nessun nome aggiustato in silenzio: se il path esistesse, il link da cui
    // arriva la richiesta non sarebbe stato non risolto.
    let err = ws.create_notes(Some("Nota B")).unwrap_err();
    assert!(
        matches!(err, KernelError::AlreadyExists(_)),
        "trovato {err}"
    );
    let err = ws.create_notes(Some("   ")).unwrap_err();
    assert!(matches!(err, KernelError::BadName { .. }), "trovato {err}");

    // E i nomi che il §15.5 non fa nascere: il messaggio porta la ragione,
    // perché «nome non valido» non dice quale carattere è il problema.
    for (name, expected) in [
        ("CON", "device DOS"),
        ("nota?", "si riserva"),
        (".nascosta", "comincia con un punto"),
    ] {
        let err = ws.create_notes(Some(name)).unwrap_err();
        let text = err.to_string();
        assert!(
            matches!(err, KernelError::BadName { .. }) && text.contains(expected),
            "`{name}`: atteso un BadName che dica {expected:?}, trovato {text}"
        );
    }
}
