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
use fub_host::{Consegna, EventSink, Host, NoWatcher, VaultWatcher, WatcherFactory};
use fub_kernel::data_root;

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

    // La radice torna **canonica**, e non è un dettaglio del test: è la chiave
    // delle sessioni (`session.rs::canonical`), cioè ciò per cui `/vault` e un
    // link simbolico che ci punta non aprono due sessioni sullo stesso vault.
    // Confrontarla col path grezzo bocciava il prodotto per una proprietà che
    // ha: su macOS un tempdir è `/var/folders/…`, che è un symlink a
    // `/private/var/…` — quindi il test passava su Linux e falliva solo lì.
    let atteso = v.root.canonicalize_utf8().expect("il tempdir esiste");
    assert_eq!(info.root, atteso.to_string());
    // L'elenco delle note **non è più** in `VaultInfo` (§14.4): si chiede al
    // canale dati, che sa dire quale cartella e quante righe.
    // E si chiede **a indicizzazione finita**: `open` torna appena si sa cosa
    // c'è, non cosa dicono i documenti (§15.7,
    // [0070](../../../docs/decisions/0070-un-vault-si-apre-in-due-tempi.md)).
    // Quale sia l'anagrafe appena aperto il vault lo presidia
    // `l_apertura_a_fasi.rs`; qui la domanda è un'altra, e chiederla presto
    // farebbe fallire questo test per il disco invece che per il montaggio.
    host.wait_indexed(None).expect("l'indicizzazione finisce");
    let aperto = host.workspace(None).expect("un vault è aperto");
    let mut docs = aperto.read().unwrap().documents();
    docs.sort();
    assert_eq!(docs, vec![DocId::new("Cucina.md"), DocId::new("Rust.md")]);
    assert_eq!(
        info.extensions,
        vec!["markdown", "md"],
        "le estensioni le dichiara il provider markdown, non la UI"
    );

    // Le feature ufficiali si sono **dichiarate**: è la proprietà che una
    // suite per-feature non può vedere, perché ognuna ne dichiara una sola.
    // `fub.core` non registra niente e c'è lo stesso: è il bundle che dà un
    // proprietario alle impostazioni dell'app (§11.1), e «dichiarato con zero
    // registrazioni» è uno stato vero.
    //
    // **Questi undici nomi restano scritti a mano di proposito**, e non è una
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
            "fub.blocks",
            "fub.commands",
            "fub.core",
            "fub.graph",
            "fub.outline",
            "fub.search",
            "fub.stats",
            "fub.tags",
            "fub.trash",
            "fub.versioning",
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
    // L'apertura è a fasi (§15.7): l'indice si popola dopo che `open` è
    // tornata, quindi chi vuole interrogarlo intero aspetta. Nell'app questa
    // riga non esiste — là si disegna subito e si aggiorna — ma un test che
    // chiede «cosa risponde l'indice» deve chiederlo quando l'indice ha una
    // risposta, o presidierebbe la velocità del disco.
    host.wait_indexed(None).expect("aspetta l'indicizzazione");
    let ws = host.workspace(None).expect("un vault è aperto");

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

    // La prima fotografia non sta più dentro `Host::open` (0154): è
    // copy-on-first-write, e l'apertura non fotografa niente. La storia
    // nasce dalla prima scrittura, non dall'apertura.
    host.wait_indexed(None).expect("aspetta l'indicizzazione");
    let before = host.list_versions(None, &id).expect("versioning acceso");
    assert_eq!(before.len(), 0, "l'apertura non fotografa più");

    {
        let ws = host.workspace(None).unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&id, "# Nota\n\ndopo\n", WriteBase::Dictated)
            .expect("scrive");
    }

    let after = host.list_versions(None, &id).expect("versioning acceso");
    assert_eq!(after.len(), 2, "la prima scrittura fotografa l'originale");

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
fn la_prima_scrittura_fotografa_l_originale() {
    let v = Vault::new();
    for n in 0..50 {
        v.put(&format!("Nota{n:02}.md"), &format!("# Nota {n}\n"));
    }

    let seen = Arc::new(Mutex::new(Vec::new()));
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_sink(Arc::new(Collected(seen.clone())));
    host.open(&v.root).expect("il vault si apre");

    // Il ponte ha un freno (§10.2): la consegna si aspetta, e se non arriva il
    // test fallisce sul tempo massimo invece che sul primo giro.
    let scaduto = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < scaduto {
        let arrivato = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobProgress);
        if arrivato {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .any(|n| n.event.kind() == EventKind::JobProgress),
        "la prima fetta non si è mai annunciata"
    );

    for n in 0..50 {
        let id = DocId::new(format!("Nota{n:02}.md"));
        let versioni = host.list_versions(None, &id).expect("versioning acceso");
        assert_eq!(
            versioni.len(),
            0,
            "{id}: alla prima fetta la fotografia dell'apertura non c'è più"
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
        .expect("scrive");
    }
    let versioni = host
        .list_versions(None, &DocId::new("Nota00.md"))
        .expect("versioning acceso");
    assert_eq!(versioni.len(), 2, "la prima scrittura fotografa l'originale");
    assert_eq!(
        host.read_version(None, &DocId::new("Nota00.md"), versioni[1].ts)
            .unwrap(),
        "# Nota 0\n",
        "l'originale è in storia"
    );
}

/// Un sink che accumula: il posto dell'`AppHandle` di Tauri, senza Tauri.
#[derive(Default)]
struct Collected(Arc<Mutex<Vec<Notice>>>);

impl EventSink for Collected {
    fn emit(&self, notice: &Notice) -> Consegna {
        self.0.lock().unwrap().push(notice.clone());
        Consegna::Fatta
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
    host.wait_indexed(None).expect("aspetta l'indicizzazione");

    // Il ponte ha un **freno** per costruzione (§10.2, decisione 0034): fra
    // l'evento emesso e l'evento consegnato al sink c'è un raggruppamento, e
    // `wait_indexed` sa solo che il kernel ha finito. Aspettare la consegna è
    // parte di ciò che si sta provando — che quegli eventi *arrivano* — e non
    // un'attesa arbitraria: se non arrivano, il test fallisce sul tempo massimo
    // invece che sul primo giro.
    let scaduto = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < scaduto {
        let arrivato = seen
            .lock()
            .unwrap()
            .iter()
            .any(|n: &Notice| n.event.kind() == EventKind::JobDone);
        if arrivato {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    // **Nessun evento per documento**, che è ciò che questo presidio ha sempre
    // difeso: la scansione popola il vault, non lo cambia, e una shell che
    // ricevesse un `DocumentChanged` per nota leggerebbe l'apertura come un
    // temporale di modifiche.
    let visti = seen.lock().unwrap().clone();
    let modifiche: Vec<_> = visti
        .iter()
        .filter(|n| {
            matches!(
                n.event.kind(),
                EventKind::DocumentChanged | EventKind::DocumentRemoved
            )
        })
        .collect();
    assert!(
        modifiche.is_empty(),
        "il ponte ha raccolto gli eventi della scansione: la shell li leggerebbe \
         come un temporale di modifiche"
    );

    // **Ciò che invece deve passare**, e prima non poteva: il racconto
    // dell'indicizzazione (§15.7). Il ponte si accende *prima* della seconda
    // fase apposta — accenderlo dopo vorrebbe dire perdere le prime fette
    // proprio del lavoro che si vuole mostrare — e il progresso di
    // un'apertura è un `JobProgress` come quello di ogni altro lavoro lungo,
    // così il centro attività la disegna senza sapere che è un'apertura.
    assert!(
        visti
            .iter()
            .any(|n| n.event.kind() == EventKind::JobStarted),
        "l'indicizzazione si annuncia come un lavoro lungo qualunque"
    );
    assert!(
        visti.iter().any(|n| n.event.kind() == EventKind::JobDone),
        "e ne torna un esito: chi la guarda sa quando ha finito"
    );

    {
        let ws = host.workspace(None).unwrap();
        let mut ws = ws.write().unwrap();
        ws.write_document(&DocId::new("Nota.md"), "# Nota\n\nx\n", WriteBase::Dictated)
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

/// Due vault stanno aperti insieme, e il "corrente" è solo chi risponde a chi
/// non ne nomina uno (§9.6).
#[test]
fn due_vault_stanno_aperti_insieme_e_il_corrente_e_una_comodita() {
    let a = Vault::new();
    a.put("A.md", "# A\n");
    let b = Vault::new();
    b.put("B.md", "# B\n");

    let host = headless();
    host.open(&a.root).expect("primo vault");
    let second = host.open(&b.root).expect("secondo vault");
    assert_eq!(
        second.root,
        b.root.canonicalize_utf8().expect("esiste").to_string()
    );

    assert_eq!(host.vaults().len(), 2, "il primo non è stato chiuso");
    // `documents()` sono i documenti **indicizzati**, e l'indicizzazione è la
    // seconda fase (§15.7): la si aspetta per tutti e due i vault, perché ciò
    // che questo presidio prova è *quale* vault risponde, non quanto in fretta.
    host.wait_indexed(None).expect("il corrente ha indicizzato");
    host.wait_indexed(Some(a.root.as_str()))
        .expect("e anche il primo");
    let corrente = host.workspace(None).expect("c'è un corrente");
    assert_eq!(
        corrente.read().unwrap().documents(),
        vec![DocId::new("B.md")],
        "l'ultimo aperto è il corrente"
    );
    // E il primo si raggiunge nominandolo, senza toccare il corrente.
    let primo = host
        .workspace(Some(a.root.as_str()))
        .expect("il primo è ancora aperto");
    assert_eq!(primo.read().unwrap().documents(), vec![DocId::new("A.md")]);

    // Chiuderne uno lascia l'altro, e il corrente si sposta su chi resta.
    host.close_vault(&b.root).expect("chiude il secondo");
    assert_eq!(host.vaults().len(), 1);
    assert_eq!(
        host.workspace(None)
            .expect("il corrente è passato a chi resta")
            .read()
            .unwrap()
            .documents(),
        vec![DocId::new("A.md")]
    );

    host.close();
    assert!(
        host.workspace(None).is_err(),
        "dopo `close` non c'è nessun vault aperto"
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
fn riaprire_lo_stesso_vault_non_lo_rimonta() {
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
    let ancora = host.workspace(None).unwrap();
    assert!(
        fub_host::Custodia::ptr_eq(&ws, &ancora),
        "è la stessa sessione, non una nuova"
    );
    assert_eq!(host.vaults().len(), 1, "e non se ne è aggiunta una seconda");

    // Lo stesso vault **nominato in un altro modo** resta lo stesso vault: la
    // chiave è la forma canonica del path, non la stringa che è arrivata.
    //
    // Il giro da `..` è scelto apposta: un `/vault/./` non proverebbe niente,
    // perché `Utf8PathBuf` si ordina per componenti e `.` non è una componente —
    // sarebbe già la stessa chiave senza canonicalizzare. Qui invece le
    // componenti sono diverse davvero, ed è il caso di ogni path che arriva da
    // un dialogo, da un argomento di CLI o da un link simbolico.
    let storto = v
        .root
        .join("..")
        .join(v.root.file_name().expect("basename"));
    let per_nome = host
        .workspace(Some(storto.as_str()))
        .expect("il vault si trova anche nominandolo storto");
    assert!(
        fub_host::Custodia::ptr_eq(&ws, &per_nome),
        "`{storto}` è lo stesso vault, non un secondo"
    );

    // E aprirlo così non lo apre una seconda volta — che senza la chiave
    // canonica non sarebbe nemmeno un secondo vault: sarebbe un secondo indice
    // in attesa, per sempre, del lock che tiene il primo.
    host.open(&storto).expect("apre lo stesso vault");
    assert_eq!(host.vaults().len(), 1, "e resta uno solo");
}

/// La chiusura di un vault è **l'ultimo giro sincrono**: chi è registrato riceve
/// `VaultClosed` mentre può ancora scrivere, e gli indici ricevono `flush` e
/// `close` (§9.5).
#[test]
fn chiudere_un_vault_e_lultimo_giro_in_cui_e_ancora_aperto() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n\nqualcosa da cercare\n");

    let eventi = Arc::new(Mutex::new(Vec::new()));
    let host = headless().with_sink(Arc::new(Registratore(eventi.clone())));
    host.open(&v.root).expect("il vault si apre");

    // Una scrittura **senza watcher**, cioè senza nessuno che chiami
    // `flush_indexes`: è il caso di ogni host che un watcher non ce l'ha — CLI,
    // e2e, PWA, mobile — e prima di questa voce l'indice non diventava durevole
    // mai.
    host.workspace(None)
        .unwrap()
        .write()
        .unwrap()
        .write_document(&DocId::new("Nuova.md"), "# Nuova\n", WriteBase::Dictated)
        .expect("scrittura");
    assert!(
        !manifest_dell_indice(&v.root).contains("Nuova.md"),
        "senza flush il manifest dell'indice non sa ancora della nota: è il \
         punto di partenza, e se cambiasse questo test proverebbe un'altra cosa"
    );

    let errori = host.close_vault(&v.root).expect("si chiude");
    assert!(errori.is_empty(), "niente è andato storto: {errori:?}");

    let visti = eventi.lock().unwrap().clone();
    assert!(
        visti.iter().any(|e| e == "vault_closed"),
        "il gemello di `vault_opened` è passato dal ponte: {visti:?}"
    );
    assert!(
        manifest_dell_indice(&v.root).contains("Nuova.md"),
        "chiudere rende durevole ciò che l'indice aveva accettato: è il punto \
         di consistenza che non è il watcher"
    );

    // E la cartella dell'indice non è più di nessuno: un altro host la riapre.
    let altro = headless();
    altro
        .open(&v.root)
        .expect("l'indice del vault chiuso non tiene più niente");
    altro.close();
}

/// Il manifest delle impronte dell'indice di ricerca, com'è sul disco (vuoto se
/// non c'è ancora).
fn manifest_dell_indice(root: &Utf8Path) -> String {
    let path = data_root(root)
        .join("plugins")
        .join("fub.search")
        .join("manifest.json");
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Il ponte eventi ridotto a ciò che serve a un test: il nome degli eventi
/// passati.
struct Registratore(Arc<Mutex<Vec<String>>>);

impl EventSink for Registratore {
    fn emit(&self, notice: &Notice) -> Consegna {
        let nome = serde_json::to_value(&notice.event)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
            .unwrap_or_default();
        self.0.lock().unwrap().push(nome);
        Consegna::Fatta
    }
}

/// Un rilevatore che si limita ad alzare la bandiera del kernel: è tutto ciò
/// che un watcher vero fa in più di `NoWatcher`, e qui serve senza il
/// filesystem in mezzo.
struct FintoWatcher;

struct Guarda(Arc<AtomicBool>);

impl VaultWatcher for Guarda {
    fn is_watching(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

impl Drop for Guarda {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

impl WatcherFactory for FintoWatcher {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: fub_host::Custodia<fub_kernel::Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        watching.store(true, Ordering::Relaxed);
        Ok(Box::new(Guarda(watching)))
    }
}

/// `Host::is_watching` e `IndexQuery::VaultStatus` rispondono **dallo stesso
/// bit** (§9.7).
///
/// Due copie del fatto sarebbero due verità, e la seconda mentirebbe in
/// silenzio: chi monta alzerebbe la sua all'avvio e nessuno la abbasserebbe
/// quando il rilevatore muore. Il presidio è che l'host non scrive mai il
/// proprio valore — legge la bandiera del kernel.
#[test]
fn il_rilevamento_si_chiede_dal_canale_dati_e_dallhost_ed_e_lo_stesso_bit() {
    let v = Vault::new();
    v.put("Nota.md", "# Nota\n");

    let senza = headless();
    senza.open(&v.root).expect("il vault si apre");
    assert!(!senza.is_watching(None));
    assert!(
        !stato(&senza).watching,
        "senza rilevatore il canale dati dice la stessa cosa dell'host"
    );
    senza.close();

    let con = Host::new().with_watcher(Box::new(FintoWatcher));
    con.open(&v.root).expect("il vault si apre");
    assert!(con.is_watching(None));
    assert!(
        stato(&con).watching,
        "chi guarda ha alzato la bandiera del kernel, non una sua"
    );

    // E chi smette lo dice: chiudere il vault lascia andare il rilevatore, e la
    // risposta cambia senza che nessuno la aggiorni a mano.
    let ws = con.workspace(None).unwrap();
    con.close_vault(&v.root).expect("si chiude");
    assert!(
        !matches!(
            ws.read().unwrap().query_index(IndexQuery::VaultStatus),
            Ok(IndexResult::VaultStatus(s)) if s.watching
        ),
        "un rilevatore distrutto continuava a rispondere `true`: era la §9.7"
    );
}

fn stato(host: &Host) -> VaultStatus {
    let ws = host.workspace(None).expect("un vault è aperto");
    let ws = ws.read().unwrap();
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s,
        other => panic!("il canale dati ha risposto fuori tema: {other:?}"),
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

/// **Chi apre distingue un vault intero da uno aperto in parte** (§15.7,
/// decisione 0068).
///
/// Il markdown vero non rifiuta quasi niente, quindi la leva portatile è la
/// lettura: dei byte che non sono UTF-8 sono ciò che resta di una nota dopo un
/// crash a metà scrittura. Prima di questa voce il vault non si apriva affatto,
/// e le altre due note erano irraggiungibili per colpa della terza.
#[test]
fn un_vault_con_una_nota_illeggibile_si_apre_e_dice_cosa_non_ha_letto() {
    let v = Vault::new();
    v.put("Rust.md", "# Rust\n");
    v.put("Cucina.md", "# Cucina\n");
    std::fs::write(v.root.join("Rotta.md"), [0xffu8, 0xfe, 0x00, 0x9f]).unwrap();

    let host = headless();
    let info = host.open(&v.root).expect("il vault si apre lo stesso");

    // **Su `info` non c'è niente da asserire**, ed è la conseguenza vera
    // dell'apertura a fasi (§15.7): `open` torna appena il vault è
    // *utilizzabile*, e scoprire uno scarto vuol dire aver già provato a
    // leggere — cioè la fase dopo. Quella lista dice «cosa non si è letto
    // **finora**», quindi qui è vuota o piena a seconda di quanto ha fatto in
    // tempo a camminare l'indicizzazione: asserire il vuoto sarebbe presidiare
    // una corsa, e su tre note la si perderebbe quasi sempre.
    let _ = &info;

    // L'esito **si consulta**, che è ciò che la voce chiedeva: finita
    // l'indicizzazione, chi chiede il vault trova cosa non si è potuto leggere.
    host.wait_indexed(None).expect("aspetta l'indicizzazione");
    let info = host.open(&v.root).expect("riapre, cioè rilegge lo stato");
    let non_lette: Vec<&str> = info.unread.iter().map(|u| u.doc_id.as_str()).collect();
    assert_eq!(
        non_lette,
        ["Rotta.md"],
        "l'esito dell'apertura è consultabile quando l'apertura ha finito"
    );

    // Ed è un fatto **della sessione**: riaprire lo stesso vault non lo rimonta
    // (§9.6), quindi la seconda risposta non può essere un silenzio che
    // sembrerebbe dire «adesso è tutto a posto».
    let ancora = host.open(&v.root).expect("riapre");
    assert_eq!(
        ancora.unread.len(),
        1,
        "riaprire un vault già aperto non cancella ciò che quella apertura non ha letto"
    );
}
