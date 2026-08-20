//! **Qual è il vault corrente, e in che ordine stanno i recenti** (§9.6,
//! §11.1) — che sono la stessa domanda letta due volte.
//!
//! Il corrente è *l'ultimo che l'utente ha usato*, e l'elenco dei recenti è
//! *tutti quanti in quell'ordine*. Finché le due frasi vivevano in posti
//! diversi ognuna rispondeva a modo suo: chiudendo il corrente ne prendeva il
//! posto il primo in ordine di path — l'ordine della `BTreeMap`, che non è una
//! politica ma un dettaglio di come è fatta — e riaprire un vault già aperto
//! non toccava affatto i recenti, perché quel ramo usciva prima della riga che
//! li aggiorna.
//!
//! Qui si prova la **sequenza**, non la serializzazione: apri, riapri, scegli,
//! chiudi, e chiedi chi è corrente. Un registro finto riletto da un file
//! proverebbe che il JSON va e viene, cioè l'unica metà che non era rotta.
//! not broken.

use camino::{Utf8Path, Utf8PathBuf};
use fub_host::{Host, NoWatcher};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }

    /// La radice come la scrive il registro: canonica, che è la chiave con cui
    /// l'apertura ha registrato la voce.
    fn canonical(&self) -> Utf8PathBuf {
        self.root.canonicalize_utf8().expect("esiste")
    }
}

/// Il livello macchina e il registro dei vault in una cartella di prova: senza
/// questa riga un test scriverebbe nella configurazione di chi lo esegue.
fn installed(config: &Utf8Path) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

fn config() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

/// Quando questo vault risulta usato l'ultima volta, secondo il registro.
fn when(host: &Host, root: &Utf8Path) -> u64 {
    host.known_vaults()
        .into_iter()
        .find(|and| and.root == root.as_str())
        .unwrap_or_else(|| panic!("{root} is not among the known vaults"))
        .last_opened
}

/// Chiudere il corrente non è scegliere a caso fra chi resta: corrente diventa
/// **il più recente dei superstiti**, che è la stessa risposta che dà `open`.
///
/// Il presidio ha bisogno di **tre** vault e di un ordine d'uso diverso da
/// quello dei path: con due soli, chi resta è uno solo e qualunque criterio
/// sembra giusto — ed è esattamente per questo che il difetto è sopravvissuto
/// al banco che apre due vault e ne chiude uno.
/// al banco che apre due vault e ne chiude uno.
#[test]
fn closing_the_current_of_it_takes_the_place_the_more_recent_not_the_first_of_the_path() {
    let (_dir, config) = config();
    let host = installed(&config);
    let vaults = [Vault::new(), Vault::new(), Vault::new()];

    // I tempdir hanno un nome casuale: l'ordine dei path si **misura**, non si
    // assume, o il presidio proverebbe una cosa diversa a ogni esecuzione.
    let mut path: Vec<Utf8PathBuf> = vaults.iter().map(Vault::canonical).collect();
    path.sort();

    for root in &path {
        host.open(root).expect("opens");
    }
    // L'ordine d'uso è *contrario* a quello dei path per il primo, che è
    // l'unico che conta: chi ha il path più piccolo è quello che si è usato più
    // tempo fa, quindi non deve toccare a lui.
    host.set_current(&path[0]).expect("aperto");
    host.set_current(&path[2]).expect("aperto");
    host.set_current(&path[1]).expect("aperto");
    assert_eq!(host.current().as_ref(), Some(&path[1]), "l'ultimo scelto");

    host.close_vault(&path[1]).expect("closes");
    assert_eq!(
        host.current().as_ref(),
        Some(&path[2]),
        "closing the current goes to the most recent survivor, not the first in path"
    );

    // E la seconda chiusura non riparte da capo: la memoria dell'uso è di tutti
    // i vault aperti, non solo del corrente.
    host.close_vault(&path[2]).expect("closes");
    assert_eq!(host.current().as_ref(), Some(&path[0]), "only this one remains");
    host.close_vault(&path[0]).expect("closes");
    assert_eq!(host.current(), None, "and without vaults there is no current");
}

/// Riaprire un vault **già aperto** non lo rimonta — ed è giusto — ma è un uso,
/// e i recenti lo devono sapere.
///
/// Si asserisce sul timbro e non sulla posizione in elenco perché a parità di
/// timbro l'elenco ripiega sul path, e due aperture possono cadere nello stesso
/// millisecondo: che dal timbro discenda la posizione lo prova già
/// `un_vault_riaperto_risale_in_cima_senza_duplicarsi` in `vaults.rs`. Qui la
/// distanza è garantita da ciò che sta in mezzo, che è il montaggio intero di
/// un altro vault.
#[test]
fn reopen_a_vault_already_open_the_puts_back_between_the_more_recent() {
    let (_dir, config) = config();
    let host = installed(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("opens");
    let before = when(&host, &a.canonical());
    host.open(&b.root).expect("opens");

    host.open(&a.root)
        .expect("already open, and returns current");
    let after = when(&host, &a.canonical());

    assert!(
        after > before,
        "reopening an already-open vault is an opening: {before} → {after}"
    );
    assert!(
        after >= when(&host, &b.canonical()),
        "and it moves it in front of whoever was opened before it"
    );
    assert_eq!(host.current().as_ref(), Some(&a.canonical()));
}

/// Il terzo chiamante: scegliere un vault già aperto è un uso come aprirlo.
///
/// È la riga che dice che «diventa corrente» è **un'operazione sola**. Senza di
/// lei l'ordine dei recenti direbbe una cosa e il corrente un'altra, che è
/// precisamente il modo in cui i due difetti sopra sono nati.
#[test]
fn choosing_an_open_vault_counts_as_use() {
    let (_dir, config) = config();
    let host = installed(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("opens");
    let before = when(&host, &a.canonical());
    host.open(&b.root).expect("opens");

    host.set_current(&a.root).expect("is open");
    let after = when(&host, &a.canonical());

    assert!(after > before, "choosing it is using it: {before} → {after}");
    assert!(
        after >= when(&host, &b.canonical()),
        "and the recents say so in the same order as the current"
    );
}

// --- l'ultimo vault all'avvio (§11.1) ----------------------------------------
//
// La shell, senza `FUB_VAULT`, chiede l'ultimo vault aperto: il registro lo
// sa, e l'host lo sceglie scorrendo i candidati dal più recente e saltando chi
// non è più sul disco. È la memoria fra un avvio e l'altro, ed è un'altra cosa
// dai tre test sopra: quelli provano chi è corrente *adesso*, questi chi lo
// sarà *al prossimo avvio*.

/// All'avvio si riapre l'ultimo, non il primo: apri A poi B, e `last_vault`
/// restituisce B.
#[test]
fn the_startup_reopens_the_last_vault_not_the_first() {
    let (_dir, config) = config();
    let host = installed(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("opens");
    // Una pausa per garantire che i timestamp non coincidano: `now_unix_millis`
    // basta di solito, ma due aperture nello stesso millisecondo sono ancora
    // possibili, e il tie-break sui path non deve mascherare la regola.
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b.root).expect("opens");

    let last = host.last_vault().expect("there is a last");
    assert_eq!(last, b.canonical().to_string(), "the last is B, not A");
}

/// Un preferito più vecchio non ruba lo slot dell'avvio: il registro è memoria
/// di recency, e un appunto non è un uso. Apri A, preferiscilo, apri B — e
/// l'avvio dice B.
#[test]
fn a_favorite_more_old_not_wins_on_the_last_open() {
    let (_dir, config) = config();
    let host = installed(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("opens");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.set_vault_favorite(&a.root, true).expect("favorited");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b.root).expect("opens");

    let last = host.last_vault().expect("there is a last");
    assert_eq!(
        last,
        b.canonical().to_string(),
        "B is more recent than A even though A is favorited"
    );
}

/// Se l'ultimo vault non è più sul disco, l'avvio cade sul successivo che c'è
/// ancora: un path sparito non fa fallire l'avvio, si passa al prossimo.
#[test]
fn the_startup_falls_on_the_next_if_the_last_and_vanished() {
    let (_dir, config) = config();
    let host = installed(&config);
    let a = Vault::new();
    // B ha un nome noto: il suo tempdir va rimosso a mano, e la `root` che
    // l'apertura registra è canonica, quindi si rimuove quella.
    let b_dir = tempfile::tempdir().expect("tempdir");
    let b_root = Utf8PathBuf::from_path_buf(b_dir.path().to_path_buf()).expect("utf8");
    std::fs::write(b_root.join("Nota.md"), "# Nota\n").unwrap();
    let b_canonica = b_root.canonicalize_utf8().expect("esiste");

    host.open(&a.root).expect("opens");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b_root).expect("opens");
    // L'host ha registrato B; adesso lo si chiude, così il suo watcher non
    // reclama quando la cartella sparisce.
    host.close_vault(&b_canonica).expect("closes");

    // Cancella B dal disco e chiedi l'avvio: deve cadere su A.
    std::fs::remove_dir_all(&b_canonica).unwrap();
    let last = host.last_vault().expect("A still exists");
    assert_eq!(
        last,
        a.canonical().to_string(),
        "B gone, startup falls back to A"
    );

    // Lascia A aperto finché il test ha finito: close lo spegne senza reclami.
    // Lascia A aperto finché il test ha finito: close lo spegne senza reclami.
    drop(host);
    drop(a);
    drop(b_dir);
}

/// Un registro vuoto non ha un ultimo, e l'avvio lo dice con `None` — non è un
/// errore, è una installazione nuova.
#[test]
fn record_empty_no_last_vault() {
    let (_dir, config) = config();
    let host = installed(&config);
    assert!(
        host.last_vault().is_none(),
        "no known vault, no last"
    );
}
