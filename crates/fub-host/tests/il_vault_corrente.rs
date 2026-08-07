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
