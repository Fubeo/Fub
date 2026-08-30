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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::event::EventKind;
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{
    Excerpts, IndexQuery, IndexResult, Page, PropertySelect, VaultStatus, ViewInstance,
};
use fub_abi::Notice;
use fub_features::BACKLINKS_VIEW;
use fub_host::{Delivery, EventSink, Host, NoWatcher, VaultWatcher, WatcherFactory};

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
    let info = host.open(&v.root).expect("the vault opens");

    // La radice torna **canonica**, e non è un dettaglio del test: è la chiave
    // delle sessioni (`session.rs::canonical`), cioè ciò per cui `/vault` e un
    // link simbolico che ci punta non aprono due sessioni sullo stesso vault.
    // Confrontarla col path grezzo bocciava il prodotto per una proprietà che
    // ha: su macOS un tempdir è `/var/folders/…`, che è un symlink a
    // `/private/var/…` — quindi il test passava su Linux e falliva solo lì.
    let expected = v.root.canonicalize_utf8().expect("il tempdir esiste");
    assert_eq!(info.root, expected.to_string());
    // L'elenco delle note **non è più** in `VaultInfo` (§14.4): si chiede al
    // canale dati, che sa dire quale cartella e quante righe.
    // E si chiede **a indicizzazione finita**: `open` torna appena si sa cosa
    // c'è, non cosa dicono i documenti (§15.7,
    // [0070](../../../docs/decisions/0183-composizione-host-kernel.md)).
    // Quale sia l'anagrafe appena aperto il vault lo presidia
    // `l_apertura_a_fasi.rs`; qui la domanda è un'altra, e chiederla presto
    // farebbe fallire questo test per il disco invece che per il montaggio.
    host.wait_indexed(None).expect("indexing finishes");
    let open = host.workspace(None).expect("a vault is open");
    let mut docs = open.read().unwrap().documents();
    docs.sort();
    assert_eq!(docs, vec![DocId::new("Cucina.md"), DocId::new("Rust.md")]);
    assert_eq!(
        info.extensions,
        vec!["fubsheet", "markdown", "md"],
        "format providers declare their extensions, not the UI"
    );

    // Le feature ufficiali si sono **dichiarate**: è la proprietà che una
    // suite per-feature non può vedere, perché ognuna ne dichiara una sola.
    // `fub.core` non registra niente e c'è lo stesso: è il bundle che dà un
    // proprietario alle impostazioni dell'app (§11.1), e «dichiarato con zero
    // registrazioni» è uno stato vero.
    //
    // **Questi diciotto nomi restano scritti a mano di proposito**, e non è una
    // svista rispetto alla decisione 0056: quella distingue un elenco su cui un
    // test *itera* — che smette di coprire in silenzio — da uno con cui un test
    // *asserisce un'uguaglianza*, che diventa rosso. Questo è il secondo. E la
    // sua indipendenza è il punto: `le_view_ufficiali.rs` confronta ciò che è
    // montato con `ogni_feature_ufficiale()`, quindi non direbbe niente se
    // l'inventario stesso fosse sbagliato. Qui i nomi sono battuti a mano, una
    // volta, e a quella domanda rispondono. Derivarli dall'inventario
    // renderebbe questo test una tautologia dell'altro.
    let mut plugins: Vec<&str> = info.plugins.iter().map(|p| p.id.as_str()).collect();
    plugins.sort();
    assert_eq!(
        plugins,
        vec![
            "fub.backlinks",
            "fub.backup",
            "fub.blocks",
            "fub.commands",
            "fub.core",
            "fub.dashboard",
            "fub.graph",
            "fub.markdown",
            "fub.outline",
            "fub.properties",
            "fub.queries",
            "fub.search",
            "fub.serie",
            "fub.stats",
            "fub.tags",
            "fub.template",
            "fub.trash",
            "fub.versioning",
        ]
    );

    // E hanno registrato davvero: nessuna si è persa in un conflitto di nomi,
    // che è l'errore che il montaggio riporta su stderr e tira dritto.
    let registrations: usize = info.plugins.iter().map(|p| p.registrations.len()).sum();
    assert!(
        registrations >= 12,
        "registrations too few ({registrations}): someone did not get in"
    );
}

#[test]
fn the_data_channel_and_the_view_channel_answer_on_the_same_vault() {
    let v = Vault::new();
    v.put("Rust.md", "# Rust\n\nUn linguaggio di sistema.\n");
    v.put("Cucina.md", "# Cucina\n\nVedi [[Rust]].\n");

    let host = headless();
    host.open(&v.root).expect("the vault opens");
    // L'apertura è a fasi (§15.7): l'indice si popola dopo che `open` è
    // tornata, quindi chi vuole interrogarlo intero aspetta. Nell'app questa
    // riga non esiste — là si disegna subito e si aggiorna — ma un test che
    // chiede «cosa risponde l'indice» deve chiederlo quando l'indice ha una
    // risposta, o presidierebbe la velocità del disco.
    host.wait_indexed(None).expect("waits for indexing");
    let ws = host.workspace(None).expect("a vault is open");

    // Il canale dati: l'indice di ricerca è stato registrato PRIMA della
    // scansione, quindi ha già visto il vault.
    let hits = {
        let ws = ws.read().unwrap();
        match ws.query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("linguaggio"))),
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(20)),
            excerpts: Excerpts::Attach,
        }) {
            Ok(IndexResult::Documents(hits)) => hits.items,
            other => panic!("expected documents, found {other:?}"),
        }
    };
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc.to_string(), "Rust.md");

    // Il giro delle view, sullo stesso workspace: il pannello backlink vede il
    // wikilink di Cucina.md perché il grafo è stato costruito dal `reindex` del
    // montaggio.
    let ws = ws.read().unwrap();
    ws.set_active_context(None);
    ws.set_active_document(Some(DocId::new("Rust.md")));
    let tree = ws
        .render_view(&ViewInstance::only(BACKLINKS_VIEW))
        .expect("il pannello backlink risponde");
    let drawn = serde_json::to_string(&tree).expect("serializza");
    assert!(
        drawn.contains("Cucina"),
        "the backlink is not in the tree: {drawn}"
    );

    // E il registro dei comandi, che è la terza porta montata.
    assert!(
        !ws.commands().is_empty(),
        "no commands: `CoreCommands` did not get in"
    );
}

#[test]
fn versioning_is_mounted_and_its_two_halves_are_composed() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n\nprima\n");

    let host = headless();
    host.open(&v.root).expect("the vault opens");
    let id = DocId::new("Nota.md");

    // La prima fotografia non sta più dentro `Host::open` (0154): è
    // copy-on-first-write, e l'apertura non fotografa niente. La storia
    // nasce dalla prima scrittura, non dall'apertura.
    host.wait_indexed(None).expect("waits for indexing");
    let before = host.list_versions(None, &id).expect("versioning acceso");
    assert_eq!(before.len(), 0, "the open no longer photographs");

    {
        let ws = host.workspace(None).unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&id, "# Nota\n\ndopo\n", WriteBase::Dictated)
            .expect("writes");
    }

    let after = host.list_versions(None, &id).expect("versioning acceso");
    assert_eq!(after.len(), 2, "the first write photographs the original");

    // Rileggere e ripristinare passano dall'`HostApi` intestato al versioning,
    // non da `std::fs`: è la composizione delle due metà che prima stava
    // nell'app. `list()` è in ordine inverso: la prima voce è il testo nuovo,
    // la seconda l'originale fotografato prima della sovrascrittura.
    let ts = after[1].ts;
    assert_eq!(
        host.read_version(None, &id, ts).unwrap(),
        "# Nota\n\nprima\n"
    );
    host.restore_version(None, &id, ts).expect("ripristina");
    let ws = host.workspace(None).unwrap();
    let ws = ws.read().unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "# Nota\n\nprima\n");
}

/// **La prima fotografia è copy-on-first-write** (0154): l'apertura non
/// fotografa più, e la storia di una nota nasce dalla sua prima scrittura.
///
/// Il testimone è il primo `JobProgress`: quando la barra si annuncia, dopo
/// `open` e `wait_indexed`, le versioni sono ancora **zero** — la passata
/// all'apertura non c'è più. Poi la prima scrittura fotografa l'originale, e
/// la storia ha due voci: quella di prima e quella di adesso.
///
/// Rosso se la passata all'apertura tornasse: al primo `JobProgress` le
/// versioni sarebbero già una.
#[test]
fn the_first_write_photographs_the_original() {
    let v = Vault::new();
    for n in 0..50 {
        v.put(&format!("Nota{n:02}.md"), &format!("# Nota {n}\n"));
    }

    let seen = Arc::new(Mutex::new(Vec::new()));
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Collected(seen.clone())));
    host.open(&v.root).expect("the vault opens");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro.
    let expired = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < expired {
        let arrived = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobProgress);
        if arrived {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .any(|n| n.event.kind() == EventKind::JobProgress),
        "the first slice never announced itself"
    );

    for n in 0..50 {
        let id = DocId::new(format!("Nota{n:02}.md"));
        let versions = host.list_versions(None, &id).expect("versioning acceso");
        assert_eq!(
            versions.len(),
            0,
            "{id}: at the first slice the open photograph is gone"
        );
    }

    // La prima scrittura fotografa l'originale: la storia nasce qui, e ha
    // due voci — quella di prima e quella di adesso.
    {
        let ws = host.workspace(None).unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(
            &DocId::new("Nota00.md"),
            "# Nota 0\n\ncambiata\n",
            WriteBase::Dictated,
        )
        .expect("writes");
    }
    let versions = host
        .list_versions(None, &DocId::new("Nota00.md"))
        .expect("versioning enabled");
    assert_eq!(
        versions.len(),
        2,
        "la prima scrittura fotografa l'originale"
    );
    assert_eq!(
        host.read_version(None, &DocId::new("Nota00.md"), versions[1].ts)
            .unwrap(),
        "# Nota 0\n",
        "the original is in history"
    );
}

/// Un sink che accumula: il posto dell'`AppHandle` di Tauri, senza Tauri.
#[derive(Default)]
struct Collected(Arc<Mutex<Vec<Notice>>>);

impl EventSink for Collected {
    fn emit(&self, notice: &Notice) -> Delivery {
        self.0.lock().unwrap().push(notice.clone());
        Delivery::Done
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
    host.open(&v.root).expect("the vault opens");
    host.wait_indexed(None).expect("waits for indexing");

    // Il ponte ha un **freno** per costruzione (§10.2, decisione 0034): fra
    // l'evento emesso e l'evento consegnato al sink c'è un raggruppamento, e
    // `wait_indexed` sa solo che il kernel ha finito. Aspettare la consegna è
    // parte di ciò che si sta provando — che quegli eventi *arrivano* — e non
    // un'attesa arbitraria: se non arrivano, il test fallisce sul tempo massimo
    // invece che sul primo giro.
    let expired = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < expired {
        let arrived = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobDone);
        if arrived {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    // **Nessun evento per documento**, che è ciò che questo presidio ha sempre
    // difeso: la scansione popola il vault, non lo cambia, e una shell che
    // ricevesse un `DocumentChanged` per nota leggerebbe l'apertura come un
    // temporale di modifiche.
    let seen = seen.lock().unwrap().clone();
    assert!(
        !seen
            .iter()
            .any(|n| n.event.kind() == EventKind::VaultOpened),
        "the bridge does not expose the scan's VaultOpened: {seen:?}"
    );
    let edits: Vec<_> = seen
        .iter()
        .filter(|n| {
            matches!(
                n.event.kind(),
                EventKind::DocumentChanged | EventKind::DocumentRemoved
            )
        })
        .collect();
    assert!(
        edits.is_empty(),
        "the bridge collected the scan events: the shell would read them as \
         a storm of changes"
    );

    // **Ciò che invece deve passare**, e prima non poteva: il racconto
    // dell'indicizzazione (§15.7). Il ponte si accende *prima* della seconda
    // fase apposta — accenderlo dopo vorrebbe dire perdere le prime fette
    // proprio del lavoro che si vuole mostrare — e il progresso di
    // un'apertura è un `JobProgress` come quello di ogni altro lavoro lungo,
    // così il centro attività la disegna senza sapere che è un'apertura.
    assert!(
        seen.iter().any(|n| n.event.kind() == EventKind::JobStarted),
        "indexing announces itself like any long job"
    );
    assert!(
        seen.iter().any(|n| n.event.kind() == EventKind::JobDone),
        "and an outcome comes back: whoever watches knows when it is done"
    );

    {
        let ws = host.workspace(None).unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&DocId::new("Nota.md"), "# Nota\n\nx\n", WriteBase::Dictated)
            .expect("writes");
    }

    // Il ponte è un thread: si aspetta il primo evento, non si dorme e basta.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while seen.is_empty() && std::time::Instant::now() < deadline {
        std::thread::yield_now();
    }
    assert!(!seen.is_empty(), "no event reached the sink after a write");
}

/// Due vault stanno aperti insieme, e il "corrente" è solo chi risponde a chi
/// non ne nomina uno (§9.6).
#[test]
fn two_vault_are_open_together_and_the_current_and_a_convenience() {
    let a = Vault::new();
    a.put("A.md", "# A\n");
    let b = Vault::new();
    b.put("B.md", "# B\n");

    let host = headless();
    host.open(&a.root).expect("primo vault");
    let second = host.open(&b.root).expect("second vault");
    assert_eq!(
        second.root,
        b.root.canonicalize_utf8().expect("esiste").to_string()
    );

    assert_eq!(host.vaults().len(), 2, "the first was not closed");
    // `documents()` sono i documenti **indicizzati**, e l'indicizzazione è la
    // seconda fase (§15.7): la si aspetta per tutti e due i vault, perché ciò
    // che questo presidio prova è *quale* vault risponde, non quanto in fretta.
    host.wait_indexed(None).expect("il current ha indicizzato");
    host.wait_indexed(Some(a.root.as_str()))
        .expect("and also the first");
    let current = host.workspace(None).expect("there is a current");
    assert_eq!(
        current.read().unwrap().documents(),
        vec![DocId::new("B.md")],
        "the last opened is the current"
    );
    // E il primo si raggiunge nominandolo, senza toccare il corrente.
    let first = host
        .workspace(Some(a.root.as_str()))
        .expect("the first is still open");
    assert_eq!(first.read().unwrap().documents(), vec![DocId::new("A.md")]);

    // Chiuderne uno lascia l'altro, e il corrente si sposta su chi resta.
    host.close_vault(&b.root).expect("chiude il secondo");
    assert_eq!(host.vaults().len(), 1);
    assert_eq!(
        host.workspace(None)
            .expect("the current moved to who remains")
            .read()
            .unwrap()
            .documents(),
        vec![DocId::new("A.md")]
    );

    host.close();
    assert!(
        host.workspace(None).is_err(),
        "after `close` no vault is open"
    );
    assert!(!host.is_watching(None));
    assert!(host.vaults().is_empty());
}

/// Riaprire un vault già aperto **non lo riapre**: lo rende corrente.
///
/// Prima la sessione veniva buttata e rifatta, con la scansione da ripagare e il
/// lock dell'indice da riprendere — e se la seconda apertura falliva non si
/// tornava alla prima.
#[test]
fn reopen_the_same_vault_not_the_remounts() {
    let v = Vault::new();
    v.put("A.md", "# A\n");

    let host = headless();
    host.open(&v.root).expect("prima apertura");
    let ws = host.workspace(None).unwrap();

    // Una scrittura che il disco non ha: se la seconda apertura rimontasse e
    // riscansionasse, sparirebbe.
    ws.write()
        .unwrap()
        .set_active_document(Some(DocId::new("A.md")));

    host.open(&v.root).expect("seconda apertura");
    let still = host.workspace(None).unwrap();
    assert!(
        fub_host::Custody::ptr_eq(&ws, &still),
        "it is the same session, not a new one"
    );
    assert_eq!(host.vaults().len(), 1, "and no second one was added");

    // Lo stesso vault **nominato in un altro modo** resta lo stesso vault: la
    // chiave è la forma canonica del path, non la stringa che è arrivata.
    //
    // Il giro da `..` è scelto apposta: un `/vault/./` non proverebbe niente,
    // perché `Utf8PathBuf` si ordina per componenti e `.` non è una componente —
    // sarebbe già la stessa chiave senza canonicalizzare. Qui invece le
    // componenti sono diverse davvero, ed è il caso di ogni path che arriva da
    // un dialogo, da un argomento di CLI o da un link simbolico.
    let wrong = v
        .root
        .join("..")
        .join(v.root.file_name().expect("basename"));
    let by_name = host
        .workspace(Some(wrong.as_str()))
        .expect("the vault is found even when named wrong");
    assert!(
        fub_host::Custody::ptr_eq(&ws, &by_name),
        "`{wrong}` is the same vault, not a second one"
    );

    // E aprirlo così non lo apre una seconda volta — che senza la chiave
    // canonica non sarebbe nemmeno un secondo vault: sarebbe un secondo indice
    // in attesa, per sempre, del lock che tiene il primo.
    host.open(&wrong).expect("apre lo stesso vault");
    assert_eq!(host.vaults().len(), 1, "and only one remains");
}

/// La chiusura di un vault è **l'ultimo giro sincrono**: chi è registrato riceve
/// `VaultClosed` mentre può ancora scrivere, e gli indici ricevono `flush` e
/// `close` (§9.5).
#[test]
fn close_a_vault_and_latest_round_in_which_and_again_open() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n\nqualcosa da cercare\n");

    let events = Arc::new(Mutex::new(Vec::new()));
    let host = headless().with_sink(Arc::new(Recorder(events.clone())));
    host.open(&v.root).expect("the vault opens");

    // Una scrittura **senza watcher**, cioè senza nessuno che chiami
    // `flush_indexes`: è il caso di ogni host che un watcher non ce l'ha — CLI,
    // e2e, PWA, mobile — e prima di questa voce l'indice non diventava durevole
    // mai.
    host.workspace(None)
        .unwrap()
        .write()
        .unwrap()
        .write_document(&DocId::new("Nuova.md"), "# Nuova\n", WriteBase::Dictated)
        .expect("write");
    assert!(
        !manifest_of_the_index(&v.root).contains("Nuova.md"),
        "without flush the index manifest does not yet know of the note: this is \
         the starting point, and if it changed this test would prove something else"
    );

    let errors = host.close_vault(&v.root).expect("closes");
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");

    let seen = events.lock().unwrap().clone();
    assert!(
        seen.iter().any(|and| and == "vault_closed"),
        "the twin of `vault_opened` passed through the bridge: {seen:?}"
    );
    assert!(
        manifest_of_the_index(&v.root).contains("Nuova.md"),
        "closing makes durable what the index had accepted: this is the point \
         of consistency that is not the watcher"
    );

    // E la cartella dell'indice non è più di nessuno: un altro host la riapre.
    let other = headless();
    other
        .open(&v.root)
        .expect("the closed vault index holds nothing anymore");
    other.close();
}

/// Il manifest delle impronte dell'indice di ricerca, com'è sul disco (vuoto se
/// non c'è ancora).
fn manifest_of_the_index(root: &Utf8Path) -> String {
    // Lo spazio dati **autorevole** del provider di ricerca: è lì che una
    // `data_write` finisce (§31.8 — la cache derivata sta sotto `.fub/data/`).
    let path = root
        .join(".fub")
        .join("plugins")
        .join("fub.search")
        .join("manifest.json");
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Il ponte eventi ridotto a ciò che serve a un test: il nome degli eventi
struct Recorder(Arc<Mutex<Vec<String>>>);

impl EventSink for Recorder {
    fn emit(&self, notice: &Notice) -> Delivery {
        let name = serde_json::to_value(&notice.event)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
            .unwrap_or_default();
        self.0.lock().unwrap().push(name);
        Delivery::Done
    }
}

/// passati.
/// Un rilevatore che si limita ad alzare la bandiera del kernel: è tutto ciò
/// che un watcher vero fa in più di `NoWatcher`, e qui serve senza il
struct FakeWatcher;

struct WatcherGuard(Arc<AtomicBool>);

impl VaultWatcher for WatcherGuard {
    fn is_watching(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

impl Drop for WatcherGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

impl WatcherFactory for FakeWatcher {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: fub_host::Custody<fub_kernel::Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        Ok(Box::new(WatcherGuard(watching)))
    }
}

/// filesystem in mezzo.
/// `Host::is_watching` e `IndexQuery::VaultStatus` rispondono **dallo stesso
/// bit** (§9.7).
///
/// Due copie del fatto sarebbero due verità, e la seconda mentirebbe in
/// silenzio: chi monta alzerebbe la sua all'avvio e nessuno la abbasserebbe
/// quando il rilevatore muore. Il presidio è che l'host non scrive mai il
#[test]
fn the_detection_is_asks_from_the_channel_data_and_from_host_and_and_the_same_bit() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n");

    let without = headless();
    without.open(&v.root).expect("the vault opens");
    assert!(!without.is_watching(None));
    assert!(
        !state(&without).watching,
        "without a watcher the data channel says the same thing as the host"
    );
    without.close();

    let with = Host::new().with_watcher(Box::new(FakeWatcher));
    with.open(&v.root).expect("the vault opens");
    assert!(with.is_watching(None));
    assert!(
        state(&with).watching,
        "chi guarda ha alzato la bandiera del kernel, non una sua"
    );

    // proprio valore — legge la bandiera del kernel.
    // E chi smette lo dice: chiudere il vault lascia andare il rilevatore, e la
    let ws = with.workspace(None).unwrap();
    with.close_vault(&v.root).expect("closes");
    assert!(
        !matches!(
            ws.read().unwrap().query_index(IndexQuery::VaultStatus),
            Ok(IndexResult::VaultStatus(s)) if s.watching
        ),
        "a destroyed watcher kept answering `true`: that was §9.7"
    );
}

fn state(host: &Host) -> VaultStatus {
    let ws = host.workspace(None).expect("a vault is open");
    let ws = ws.read().unwrap();
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s,
        other => panic!("the data channel responded off-topic: {other:?}"),
    }
}

#[test]
fn a_path_that_is_not_a_directory_is_refused_before_anything_is_mounted() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n");
    let host = headless();
    assert!(host.open(&v.root.join("Nota.md")).is_err());
    assert!(host.workspace(None).is_err());
}

// risposta cambia senza che nessuno la aggiorni a mano.
/// **Chi apre distingue un vault intero da uno aperto in parte** (§15.7,
/// decisione 0068).
///
/// Il markdown vero non rifiuta quasi niente, quindi la leva portatile è la
/// lettura: dei byte che non sono UTF-8 sono ciò che resta di una nota dopo un
/// crash a metà scrittura. Prima di questa voce il vault non si apriva affatto,
#[test]
fn a_vault_with_a_notes_unreadable_is_opens_and_says_what_not_has_read() {
    let v = Vault::new();
    v.put("Rust.md", "# Rust\n");
    v.put("Cucina.md", "# Cucina\n");
    std::fs::write(v.root.join("Rotta.md"), [0xffu8, 0xfe, 0x00, 0x9f]).unwrap();

    let host = headless();
    let info = host.open(&v.root).expect("the vault opens anyway");

    // e le altre due note erano irraggiungibili per colpa della terza.
    // **Su `info` non c'è niente da asserire**, ed è la conseguenza vera
    // dell'apertura a fasi (§15.7): `open` torna appena il vault è
    // *utilizzabile*, e scoprire uno scarto vuol dire aver già provato a
    // leggere — cioè la fase dopo. Quella lista dice «cosa non si è letto
    // **finora**», quindi qui è vuota o piena a seconda di quanto ha fatto in
    // tempo a camminare l'indicizzazione: asserire il vuoto sarebbe presidiare
    let _ = &info;

    // una corsa, e su tre note la si perderebbe quasi sempre.
    // L'esito **si consulta**, che è ciò che la voce chiedeva: finita
    host.wait_indexed(None).expect("waits for indexing");
    let info = host
        .open(&v.root)
        .expect("reopens, that is re-reads the state");
    let unread: Vec<&str> = info.unread.iter().map(|u| u.doc_id.as_str()).collect();
    assert_eq!(
        unread,
        ["Rotta.md"],
        "the outcome of the open is consultable when the open has finished"
    );

    // l'indicizzazione, chi chiede il vault trova cosa non si è potuto leggere.
    // Ed è un fatto **della sessione**: riaprire lo stesso vault non lo rimonta
    // (§9.6), quindi la seconda risposta non può essere un silenzio che
    let still = host.open(&v.root).expect("reopens");
    assert_eq!(
        still.unread.len(),
        1,
        "reopening an already open vault does not cancel what that open did not read"
    );
}
