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
    fn canonica(&self) -> Utf8PathBuf {
        self.root.canonicalize_utf8().expect("esiste")
    }
}

/// Il livello macchina e il registro dei vault in una cartella di prova: senza
/// questa riga un test scriverebbe nella configurazione di chi lo esegue.
fn installato(config: &Utf8Path) -> Host {
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
fn quando(host: &Host, root: &Utf8Path) -> u64 {
    host.known_vaults()
        .into_iter()
        .find(|e| e.root == root.as_str())
        .unwrap_or_else(|| panic!("{root} non è fra i conosciuti"))
        .last_opened
}

/// Chiudere il corrente non è scegliere a caso fra chi resta: corrente diventa
/// **il più recente dei superstiti**, che è la stessa risposta che dà `open`.
///
/// Il presidio ha bisogno di **tre** vault e di un ordine d'uso diverso da
/// quello dei path: con due soli, chi resta è uno solo e qualunque criterio
/// sembra giusto — ed è esattamente per questo che il difetto è sopravvissuto
/// al banco che apre due vault e ne chiude uno.
#[test]
fn chiudendo_il_corrente_ne_prende_il_posto_il_piu_recente_non_il_primo_dei_path() {
    let (_dir, config) = config();
    let host = installato(&config);
    let vaults = [Vault::new(), Vault::new(), Vault::new()];

    // I tempdir hanno un nome casuale: l'ordine dei path si **misura**, non si
    // assume, o il presidio proverebbe una cosa diversa a ogni esecuzione.
    let mut path: Vec<Utf8PathBuf> = vaults.iter().map(Vault::canonica).collect();
    path.sort();

    for root in &path {
        host.open(root).expect("si apre");
    }
    // L'ordine d'uso è *contrario* a quello dei path per il primo, che è
    // l'unico che conta: chi ha il path più piccolo è quello che si è usato più
    // tempo fa, quindi non deve toccare a lui.
    host.set_current(&path[0]).expect("aperto");
    host.set_current(&path[2]).expect("aperto");
    host.set_current(&path[1]).expect("aperto");
    assert_eq!(host.current().as_ref(), Some(&path[1]), "l'ultimo scelto");

    host.close_vault(&path[1]).expect("si chiude");
    assert_eq!(
        host.current().as_ref(),
        Some(&path[2]),
        "chiuso il corrente tocca al più recente di chi resta, non al primo dei path"
    );

    // E la seconda chiusura non riparte da capo: la memoria dell'uso è di tutti
    // i vault aperti, non solo del corrente.
    host.close_vault(&path[2]).expect("si chiude");
    assert_eq!(host.current().as_ref(), Some(&path[0]), "resta lui solo");
    host.close_vault(&path[0]).expect("si chiude");
    assert_eq!(host.current(), None, "e senza vault non c'è corrente");
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
fn riaprire_un_vault_gia_aperto_lo_rimette_fra_i_piu_recenti() {
    let (_dir, config) = config();
    let host = installato(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("si apre");
    let prima = quando(&host, &a.canonica());
    host.open(&b.root).expect("si apre");

    host.open(&a.root)
        .expect("era già aperto, e torna corrente");
    let dopo = quando(&host, &a.canonica());

    assert!(
        dopo > prima,
        "riaprire un vault già aperto è un'apertura: {prima} → {dopo}"
    );
    assert!(
        dopo >= quando(&host, &b.canonica()),
        "e lo rimette davanti a chi era stato aperto prima di lui"
    );
    assert_eq!(host.current().as_ref(), Some(&a.canonica()));
}

/// Il terzo chiamante: scegliere un vault già aperto è un uso come aprirlo.
///
/// È la riga che dice che «diventa corrente» è **un'operazione sola**. Senza di
/// lei l'ordine dei recenti direbbe una cosa e il corrente un'altra, che è
/// precisamente il modo in cui i due difetti sopra sono nati.
#[test]
fn scegliere_un_vault_gia_aperto_e_un_uso_come_aprirlo() {
    let (_dir, config) = config();
    let host = installato(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("si apre");
    let prima = quando(&host, &a.canonica());
    host.open(&b.root).expect("si apre");

    host.set_current(&a.root).expect("è aperto");
    let dopo = quando(&host, &a.canonica());

    assert!(dopo > prima, "sceglierlo è usarlo: {prima} → {dopo}");
    assert!(
        dopo >= quando(&host, &b.canonica()),
        "e i recenti lo dicono con lo stesso ordine del corrente"
    );
}

// --- l'ultimo vault all'avvio (§11.1) ----------------------------------------
//
// La shell, senza `FUB_VAULT`, chiede l'ultimo vault aperto: il registro lo
// sa, e l'host lo sceglie scorrendo i candidati dal più recente e saltando chi
// non è più sul disco. È la memoria fra un avvio e l'altro, ed è un'altra cosa
// dai tre test sopra: quelli provano chi è corrente *adesso*, questi chi lo
// sarà *al prossimo avvio*.

/// All'avvio si riapre l'ultimo, non il primo: apri A poi B, e `ultimo_vault`
/// restituisce B.
#[test]
fn l_avvio_riapre_l_ultimo_vault_non_il_primo() {
    let (_dir, config) = config();
    let host = installato(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("si apre");
    // Una pausa per garantire che i timestamp non coincidano: `now_unix_millis`
    // basta di solito, ma due aperture nello stesso millisecondo sono ancora
    // possibili, e il tie-break sui path non deve mascherare la regola.
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b.root).expect("si apre");

    let ultimo = host.ultimo_vault().expect("c'è un ultimo");
    assert_eq!(ultimo, b.canonica().to_string(), "l'ultimo è B, non A");
}

/// Un preferito più vecchio non ruba lo slot dell'avvio: il registro è memoria
/// di recency, e un appunto non è un uso. Apri A, preferiscilo, apri B — e
/// l'avvio dice B.
#[test]
fn un_preferito_piu_vecchio_non_vince_sull_ultimo_aperto() {
    let (_dir, config) = config();
    let host = installato(&config);
    let a = Vault::new();
    let b = Vault::new();

    host.open(&a.root).expect("si apre");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.set_vault_favorite(&a.root, true).expect("preferito");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b.root).expect("si apre");

    let ultimo = host.ultimo_vault().expect("c'è un ultimo");
    assert_eq!(ultimo, b.canonica().to_string(), "B è più recente di A anche se A è preferito");
}

/// Se l'ultimo vault non è più sul disco, l'avvio cade sul successivo che c'è
/// ancora: un path sparito non fa fallire l'avvio, si passa al prossimo.
#[test]
fn l_avvio_cade_sul_successivo_se_l_ultimo_e_sparito() {
    let (_dir, config) = config();
    let host = installato(&config);
    let a = Vault::new();
    // B ha un nome noto: il suo tempdir va rimosso a mano, e la `root` che
    // l'apertura registra è canonica, quindi si rimuove quella.
    let b_dir = tempfile::tempdir().expect("tempdir");
    let b_root = Utf8PathBuf::from_path_buf(b_dir.path().to_path_buf()).expect("utf8");
    std::fs::write(b_root.join("Nota.md"), "# Nota\n").unwrap();
    let b_canonica = b_root.canonicalize_utf8().expect("esiste");

    host.open(&a.root).expect("si apre");
    std::thread::sleep(std::time::Duration::from_millis(2));
    host.open(&b_root).expect("si apre");
    // L'host ha registrato B; adesso lo si chiude, così il suo watcher non
    // reclama quando la cartella sparisce.
    host.close_vault(&b_canonica).expect("si chiude");

    // Cancella B dal disco e chiedi l'avvio: deve cadere su A.
    std::fs::remove_dir_all(&b_canonica).unwrap();
    let ultimo = host.ultimo_vault().expect("A esiste ancora");
    assert_eq!(ultimo, a.canonica().to_string(), "sparito B, l'avvio cade su A");

    // Lascia A aperto finché il test ha finito: close lo spegne senza reclami.
    drop(host);
    drop(a);
    drop(b_dir);
}

/// Un registro vuoto non ha un ultimo, e l'avvio lo dice con `None` — non è un
/// errore, è una installazione nuova.
#[test]
fn registro_vuoto_nessun_ultimo_vault() {
    let (_dir, config) = config();
    let host = installato(&config);
    assert!(host.ultimo_vault().is_none(), "nessun vault conosciuto, nessun ultimo");
}
