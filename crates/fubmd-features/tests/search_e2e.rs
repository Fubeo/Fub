//! Ricerca full-text end-to-end: vault vero su disco, provider markdown vero,
//! kernel vero, tantivy vero. Nessuna spia e nessun doppio.
//!
//! I test qui misurano le proprietà promesse a M2 — l'incrementale coincide
//! con l'indice costruito da zero, la riapertura non reindicizza, il rename non
//! lascia fantasmi — perché sono esattamente quelle che un indice sbagliato
//! romperebbe *in silenzio*: la ricerca continuerebbe a rispondere, solo con la
//! risposta sbagliata.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{IndexQuery, IndexResult, Page, SearchHit};
use fubmd_features::{SearchIndex, SEARCH_ID};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    /// Scrive un file **fuori** dal workspace: simula ciò che accade quando
    /// l'app è chiusa (o quando è un altro programma a toccare il vault).
    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn erase(&self, rel: &str) {
        std::fs::remove_file(self.root.join(rel)).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).expect("lettura")
    }

    /// Apre il vault come farebbe l'app: registry markdown + indice nel proprio
    /// spazio dati, registrato (e quindi attivato) prima del `reindex`.
    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        let dir = ws.plugin_data_dir(SEARCH_ID).expect("spazio dati");
        let index = SearchIndex::open(&dir).expect("indice");
        ws.register_index_provider(SEARCH_ID, Box::new(index))
            .expect("attivazione dell'indice");
        ws.reindex().expect("reindex");
        ws
    }
}

fn search(ws: &Workspace, query: &str) -> Vec<SearchHit> {
    match ws.query_index(IndexQuery::FullText {
        query: query.to_string(),
        scope: Default::default(),
        page: Some(Page::first(20)),
    }) {
        Ok(IndexResult::Search(hits)) => hits.items,
        other => panic!("atteso Search per «{query}», trovato {other:?}"),
    }
}

/// I soli `DocId` trovati, ordinati: il confronto che ci interessa è
/// sull'insieme dei documenti, non sui punteggi.
fn found(ws: &Workspace, query: &str) -> Vec<String> {
    let mut ids: Vec<String> = search(ws, query)
        .into_iter()
        .map(|h| h.doc.to_string())
        .collect();
    ids.sort();
    ids
}

#[test]
fn finds_notes_by_content_title_and_tag() {
    let v = Vault::new();
    v.put(
        "Rust.md",
        "---\ntags: [linguaggi]\n---\n\n# Rust\n\nUn linguaggio di sistema.\n",
    );
    v.put("Cucina.md", "# Cucina\n\nLa ricetta del risotto. #cibo\n");
    let ws = v.open();

    assert_eq!(found(&ws, "linguaggio"), vec!["Rust.md"]);
    assert_eq!(found(&ws, "rust"), vec!["Rust.md"], "match sul titolo");
    assert_eq!(found(&ws, "cibo"), vec!["Cucina.md"], "match sul tag");
    assert!(found(&ws, "astrofisica").is_empty());
}

#[test]
fn highlights_land_on_the_right_bytes_in_accented_text() {
    let v = Vault::new();
    // L'italiano è pieno di accenti: se gli offset fossero trattati come
    // indici di carattere invece che di byte, qui l'evidenziazione slitterebbe.
    v.put(
        "Città.md",
        "Perché la città è così affollata? La metropoli cresce.\n",
    );
    let ws = v.open();

    let hits = search(&ws, "metropoli");
    assert_eq!(hits.len(), 1);
    let hit = &hits[0];
    let span = hit.highlights.first().expect("un highlight");
    assert_eq!(&hit.snippet[span.start..span.end], "metropoli");
    assert!(!hit.snippet.contains('<'), "lo snippet è testo, non markup");
}

#[test]
fn editing_a_note_updates_what_is_findable() {
    let v = Vault::new();
    v.put("nota.md", "Il contenuto originale parla di vulcani.\n");
    let mut ws = v.open();
    assert_eq!(found(&ws, "vulcani"), vec!["nota.md"]);

    ws.write_document(&DocId::new("nota.md"), "Ora parla di ghiacciai.\n")
        .unwrap();

    assert!(
        found(&ws, "vulcani").is_empty(),
        "il vecchio testo sparisce"
    );
    assert_eq!(found(&ws, "ghiacciai"), vec!["nota.md"]);
}

#[test]
fn a_renamed_note_leaves_no_ghost_behind() {
    let v = Vault::new();
    v.put("Bozza.md", "Appunti sulla fotosintesi.\n");
    let mut ws = v.open();
    assert_eq!(found(&ws, "Bozza"), vec!["Bozza.md"]);

    ws.rename_document(&DocId::new("Bozza.md"), &DocId::new("Definitivo.md"))
        .unwrap();

    assert!(
        found(&ws, "Bozza").is_empty(),
        "il vecchio nome non deve restare cercabile"
    );
    assert_eq!(found(&ws, "Definitivo"), vec!["Definitivo.md"]);
    // Il contenuto ha seguito il rename, non è stato perso per strada.
    assert_eq!(found(&ws, "fotosintesi"), vec!["Definitivo.md"]);
}

#[test]
fn deleting_a_note_removes_it_from_search() {
    let v = Vault::new();
    v.put("effimera.md", "Contenuto passeggero.\n");
    let mut ws = v.open();
    assert_eq!(found(&ws, "passeggero"), vec!["effimera.md"]);

    ws.remove_document(&DocId::new("effimera.md"));
    assert!(found(&ws, "passeggero").is_empty());
}

#[test]
fn trashing_a_note_makes_it_vanish_from_search_and_backlinks_and_coming_back_undoes_it() {
    let v = Vault::new();
    v.put("Fotosintesi.md", "La clorofilla cattura la luce.\n");
    v.put("Biologia.md", "Vedi [[Fotosintesi]] per il dettaglio.\n");
    let mut ws = v.open();
    assert_eq!(found(&ws, "clorofilla"), vec!["Fotosintesi.md"]);
    assert_eq!(ws.backlinks(&DocId::new("Fotosintesi.md")).len(), 1);

    let cestinata = ws.delete_document(&DocId::new("Fotosintesi.md")).unwrap();

    assert!(found(&ws, "clorofilla").is_empty(), "non più cercabile");
    // Il link da Biologia non è stato toccato — cancellare una nota non
    // riscrive i documenti di terzi — ma ora non risolve più: è esattamente il
    // "link non risolto" di Obsidian, da cui si ricrea la nota.
    assert_eq!(
        v.read("Biologia.md"),
        "Vedi [[Fotosintesi]] per il dettaglio.\n"
    );
    assert!(ws.resolve_link("Fotosintesi").is_none());
    assert!(ws.backlinks(&DocId::new("Fotosintesi.md")).is_empty());

    ws.restore_from_trash(&cestinata, None).unwrap();

    assert_eq!(found(&ws, "clorofilla"), vec!["Fotosintesi.md"]);
    assert_eq!(
        ws.resolve_link("Fotosintesi"),
        Some(DocId::new("Fotosintesi.md"))
    );
    assert_eq!(
        ws.backlinks(&DocId::new("Fotosintesi.md")).len(),
        1,
        "il backlink si è ricucito da solo: il grafo lo ricalcola, non lo ricorda"
    );
}

#[test]
fn what_sits_in_the_trash_is_never_searchable() {
    let v = Vault::new();
    v.put("viva.md", "Nota corrente.\n");
    // Una nota cestinata in una sessione precedente (o da Obsidian) è già lì
    // quando il vault si apre: la scansione non deve raccoglierla.
    v.put(".trash/Cestinata.md", "Contenuto dimenticato.\n");
    let ws = v.open();

    assert!(found(&ws, "dimenticato").is_empty());
    assert_eq!(ws.documents(), vec![DocId::new("viva.md")]);
}

#[test]
fn reopening_a_vault_does_not_reindex_it() {
    let v = Vault::new();
    v.put("a.md", "Il primo documento.\n");
    v.put("b.md", "Il secondo documento.\n");
    drop(v.open());

    // Alla riapertura ogni documento ripassa dall'indice, ma nessuno di essi è
    // cambiato: l'indice non deve scrivere nulla. Lo si osserva dal fatto che
    // il flush non produce un nuovo commit — l'opstamp resta quello di prima.
    let opstamp_before = opstamp(&v.root);
    let ws = v.open();
    assert_eq!(
        opstamp(&v.root),
        opstamp_before,
        "un vault immutato non deve produrre scritture alla riapertura"
    );
    assert_eq!(found(&ws, "documento"), vec!["a.md", "b.md"]);
}

#[test]
fn reopening_catches_up_with_what_happened_while_it_was_closed() {
    let v = Vault::new();
    v.put("resta.md", "Questo documento resta.\n");
    v.put("sparisce.md", "Questo documento sparisce.\n");
    drop(v.open());

    // Ad "app chiusa": una nota cancellata, una modificata, una nuova. È
    // l'unico modo in cui un indice alimentato dal kernel può divergere dal
    // vault, ed è ciò che `reconcile` + le impronte devono rimettere a posto.
    v.erase("sparisce.md");
    v.put(
        "resta.md",
        "Questo documento è stato riscritto: parla di api.\n",
    );
    v.put("nuova.md", "Documento comparso dal nulla.\n");

    let ws = v.open();
    assert!(found(&ws, "sparisce").is_empty(), "cancellata a freddo");
    assert_eq!(found(&ws, "api"), vec!["resta.md"], "modificata a freddo");
    assert_eq!(found(&ws, "nulla"), vec!["nuova.md"], "creata a freddo");
}

#[test]
fn incremental_index_matches_one_built_from_scratch() {
    // L'oracolo: un indice che ha visto solo lo stato finale deve rispondere
    // esattamente come quello che ci è arrivato per modifiche successive.
    let incremental = Vault::new();
    incremental.put("uno.md", "alfa beta gamma\n");
    incremental.put("due.md", "delta epsilon\n");
    incremental.put("tre.md", "zeta eta\n");
    let mut ws = incremental.open();

    ws.write_document(&DocId::new("uno.md"), "alfa riscritto con theta\n")
        .unwrap();
    ws.remove_document(&DocId::new("due.md"));
    ws.write_document(&DocId::new("quattro.md"), "iota kappa\n")
        .unwrap();
    ws.rename_document(&DocId::new("tre.md"), &DocId::new("archivio/tre.md"))
        .unwrap();
    ws.write_document(&DocId::new("uno.md"), "alfa di nuovo, ora con lambda\n")
        .unwrap();

    // Stesso stato finale, ma raggiunto in un colpo solo.
    let scratch = Vault::new();
    for id in ws.documents() {
        scratch.put(id.as_str(), &ws.read_source(&id).unwrap());
    }
    let oracle = scratch.open();

    assert_eq!(ws.documents(), oracle.documents());
    for query in [
        "alfa",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
        "iota",
        "kappa",
        "lambda",
        "riscritto",
        "uno",
        "due",
        "tre",
        "quattro",
    ] {
        assert_eq!(
            found(&ws, query),
            found(&oracle, query),
            "l'incrementale diverge dall'oracolo su «{query}»"
        );
    }
}

/// L'opstamp dell'ultimo commit di tantivy, letto dal manifest dell'indice:
/// è il contatore che cambia se e solo se qualcosa è stato scritto.
///
/// Il manifest vive nello spazio dati del plugin e ci arriva attraverso
/// `HostApi::data_write`: leggerlo da qui col filesystem è lecito perché questo
/// è un test che guarda *il risultato*, non un percorso di produzione.
fn opstamp(vault_root: &Utf8PathBuf) -> u64 {
    let path = vault_root
        .join(".fubmd-data")
        .join("plugins")
        .join(SEARCH_ID)
        .join("manifest.json");
    let raw = std::fs::read_to_string(path).expect("manifest");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("json");
    v["opstamp"].as_u64().expect("opstamp")
}

/// Micro-bench del criterio di accettazione M2: query < 50 ms su un vault di
/// almeno 1000 note, indice caldo. Esclusa dal giro normale perché costruire il
/// vault costa secondi; si esegue a mano, in release:
///
/// `cargo test -p fubmd-features --release --test search_e2e -- --ignored --nocapture`
#[test]
#[ignore = "micro-bench: si esegue a mano, in release"]
fn query_latency_on_a_large_vault() {
    use std::time::Instant;

    const DOCS: usize = 2_000;
    // Vocabolario piccolo e ripetuto: è il caso peggiore per la ricerca,
    // perché ogni termine compare in tanti documenti.
    const WORDS: [&str; 12] = [
        "kernel",
        "vault",
        "grafo",
        "indice",
        "nota",
        "collegamento",
        "ricerca",
        "documento",
        "provider",
        "formato",
        "plugin",
        "contratto",
    ];

    let v = Vault::new();
    for i in 0..DOCS {
        let body: String = (0..120)
            .map(|j| WORDS[(i * 7 + j * 3) % WORDS.len()])
            .collect::<Vec<_>>()
            .join(" ");
        v.put(
            &format!("dir{}/nota-{i}.md", i % 40),
            &format!("# Nota {i}\n\n{body}\n"),
        );
    }

    let build = Instant::now();
    let ws = v.open();
    let build = build.elapsed();
    assert_eq!(ws.documents().len(), DOCS);

    // Prima query a freddo esclusa dalla misura: scalda i mmap dei segmenti.
    let _ = search(&ws, "kernel");

    let queries = ["kernel", "grafo indice", "provider formato plugin", "nota"];
    let mut worst = std::time::Duration::ZERO;
    for q in queries {
        let start = Instant::now();
        let hits = search(&ws, q);
        let dt = start.elapsed();
        worst = worst.max(dt);
        println!("  «{q}» → {} risultati in {dt:?}", hits.len());
    }
    println!("indicizzazione di {DOCS} note: {build:?}; query peggiore: {worst:?}");

    assert!(
        worst < std::time::Duration::from_millis(50),
        "criterio M2: query < 50 ms a indice caldo, misurato {worst:?}"
    );

    // La riapertura non deve reindicizzare: è l'altro criterio, sullo stesso
    // vault grande dove conta davvero. Il primo workspace va chiuso prima:
    // tiene il lock del writer, come farebbe l'app finché è viva.
    drop(ws);
    let opstamp_before = opstamp(&v.root);
    let reopen = Instant::now();
    let ws2 = v.open();
    let reopen = reopen.elapsed();
    assert_eq!(
        opstamp(&v.root),
        opstamp_before,
        "riapertura senza scritture"
    );
    assert_eq!(ws2.documents().len(), DOCS);
    println!("riapertura di {DOCS} note (indice caldo su disco): {reopen:?}");
}
