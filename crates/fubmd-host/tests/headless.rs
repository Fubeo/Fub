//! Il montaggio, provato **senza un webview**.
//!
//! È il test che il §8.2 non permetteva di scrivere: finché la tabella di
//! montaggio viveva dentro `#[tauri::command] open_vault`, l'unico modo di
//! esercitarla era avviare l'app. Le suite delle feature aprivano ognuna un
//! workspace **proprio**, con il pezzo che serviva a loro — quindi provavano la
//! ricerca, l'outline o il versioning, mai *l'insieme montato*: che tutte e otto
//! si dichiarino, che nessuna si contenda un nome con un'altra, che il giro
//! delle view e quello dei comandi rispondano sullo stesso vault.
//!
//! Gira con [`NoWatcher`]: un e2e che aprisse un debouncer vero starebbe
//! provando anche il debouncer, e un test che fallisce per il filesystem non
//! dice più niente su ciò che doveva provare.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fubmd_abi::traits::{IndexQuery, IndexResult, Page, PropertySelect, ViewInstance};
use fubmd_abi::Notice;
use fubmd_features::BACKLINKS_VIEW;
use fubmd_host::{EventSink, Host, NoWatcher};

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

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }
}

/// Un host come lo monterebbe una CLI o un e2e: nessun ponte eventi, nessun
/// rilevatore.
fn headless() -> Host {
    Host::new().with_watcher(Box::new(NoWatcher))
}

#[test]
fn the_whole_mounting_table_comes_up_without_a_webview() {
    let v = Vault::new();
    v.put(
        "Rust.md",
        "# Rust\n\nUn linguaggio di sistema. #linguaggi\n",
    );
    v.put("Cucina.md", "# Cucina\n\nVedi [[Rust]] per il resto.\n");

    let host = headless();
    let info = host.open(&v.root).expect("il vault si apre");

    assert_eq!(info.root, v.root.to_string());
    let mut docs = info.documents.clone();
    docs.sort();
    assert_eq!(docs, vec!["Cucina.md", "Rust.md"]);
    assert_eq!(
        info.extensions,
        vec!["markdown", "md"],
        "le estensioni le dichiara il provider markdown, non la UI"
    );

    // Le otto feature ufficiali si sono **dichiarate**: è la proprietà che una
    // suite per-feature non può vedere, perché ognuna ne dichiara una sola.
    let mut plugins: Vec<&str> = info.plugins.iter().map(|p| p.id.as_str()).collect();
    plugins.sort();
    assert_eq!(
        plugins,
        vec![
            "fubmd.backlinks",
            "fubmd.blocks",
            "fubmd.commands",
            "fubmd.outline",
            "fubmd.search",
            "fubmd.stats",
            "fubmd.tags",
            "fubmd.versioning",
        ]
    );

    // E hanno registrato davvero: nessuna si è persa in un conflitto di nomi,
    // che è l'errore che il montaggio riporta su stderr e tira dritto.
    let registrations: usize = info.plugins.iter().map(|p| p.registrations.len()).sum();
    assert!(
        registrations >= 12,
        "registrazioni troppo poche ({registrations}): qualcuno non è entrato"
    );
}

#[test]
fn the_data_channel_and_the_view_channel_answer_on_the_same_vault() {
    let v = Vault::new();
    v.put("Rust.md", "# Rust\n\nUn linguaggio di sistema.\n");
    v.put("Cucina.md", "# Cucina\n\nVedi [[Rust]].\n");

    let host = headless();
    host.open(&v.root).expect("il vault si apre");
    let ws = host.workspace().expect("un vault è aperto");

    // Il canale dati: l'indice di ricerca è stato registrato PRIMA di
    // `reindex`, quindi ha già visto il vault.
    let hits = {
        let ws = ws.read().unwrap();
        match ws.query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("linguaggio"))),
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(20)),
        }) {
            Ok(IndexResult::Documents(hits)) => hits.items,
            other => panic!("attesi documenti, trovato {other:?}"),
        }
    };
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc.to_string(), "Rust.md");

    // Il giro delle view, sullo stesso workspace: il pannello backlink vede il
    // wikilink di Cucina.md perché il grafo è stato costruito dal `reindex` del
    // montaggio.
    let mut ws = ws.write().unwrap();
    ws.set_active_context(None);
    ws.set_active_document(Some(DocId::new("Rust.md")));
    let tree = ws
        .render_view(&ViewInstance::only(BACKLINKS_VIEW))
        .expect("il pannello backlink risponde");
    let drawn = serde_json::to_string(&tree).expect("serializza");
    assert!(
        drawn.contains("Cucina"),
        "il backlink non è nell'albero: {drawn}"
    );

    // E il registro dei comandi, che è la terza porta montata.
    assert!(
        !ws.commands().is_empty(),
        "nessun comando: `CoreCommands` non è entrato"
    );
}

#[test]
fn versioning_is_mounted_and_its_two_halves_are_composed() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n\nprima\n");

    let host = headless();
    host.open(&v.root).expect("il vault si apre");
    let id = DocId::new("Nota.md");

    // La prima fotografia scatta su `VaultOpened`, che `reindex` emette dentro
    // `Host::open`: la storia esiste prima ancora che qualcuno scriva.
    let before = host.list_versions(&id).expect("versioning acceso");
    assert_eq!(before.len(), 1, "la fotografia dell'apertura");

    {
        let ws = host.workspace().unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&id, "# Nota\n\ndopo\n").expect("scrive");
    }

    let after = host.list_versions(&id).expect("versioning acceso");
    assert_eq!(after.len(), 2, "la scrittura ha generato uno snapshot");

    // Rileggere e ripristinare passano dall'`HostApi` intestato al versioning,
    // non da `std::fs`: è la composizione delle due metà che prima stava
    // nell'app.
    let ts = before[0].ts;
    assert_eq!(host.read_version(&id, ts).unwrap(), "# Nota\n\nprima\n");
    host.restore_version(&id, ts).expect("ripristina");
    let ws = host.workspace().unwrap();
    let ws = ws.read().unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "# Nota\n\nprima\n");
}

/// Un sink che accumula: il posto dell'`AppHandle` di Tauri, senza Tauri.
#[derive(Default)]
struct Collected(Arc<Mutex<Vec<Notice>>>);

impl EventSink for Collected {
    fn emit(&self, notice: &Notice) {
        self.0.lock().unwrap().push(notice.clone());
    }
}

#[test]
fn the_event_bridge_starts_after_the_scan_and_before_anything_else() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n");

    let seen = Arc::new(Mutex::new(Vec::new()));
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Collected(seen.clone())));
    host.open(&v.root).expect("il vault si apre");

    assert!(
        seen.lock().unwrap().is_empty(),
        "il ponte ha raccolto gli eventi della scansione: la shell li leggerebbe \
         come un temporale di modifiche"
    );

    {
        let ws = host.workspace().unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&DocId::new("Nota.md"), "# Nota\n\nx\n")
            .expect("scrive");
    }

    // Il ponte è un thread: si aspetta il primo evento, non si dorme e basta.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while seen.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
        std::thread::yield_now();
    }
    assert!(
        !seen.lock().unwrap().is_empty(),
        "nessun evento è arrivato al sink dopo una scrittura"
    );
}

#[test]
fn opening_a_second_vault_closes_the_first() {
    let a = Vault::new();
    a.put("A.md", "# A\n");
    let b = Vault::new();
    b.put("B.md", "# B\n");

    let host = headless();
    host.open(&a.root).expect("primo vault");
    let second = host.open(&b.root).expect("secondo vault");
    assert_eq!(second.documents, vec!["B.md"]);

    host.close();
    assert!(
        host.workspace().is_err(),
        "dopo `close` non c'è nessun vault aperto"
    );
    assert!(!host.is_watching());
}

#[test]
fn a_path_that_is_not_a_directory_is_refused_before_anything_is_mounted() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n");
    let host = headless();
    assert!(host.open(&v.root.join("Nota.md")).is_err());
    assert!(host.workspace().is_err());
}
