//! **I due host rispondono con la stessa faccia agli stessi fatti** (0219).
//!
//! Il contratto ha due implementazioni: il kernel, che è quella vera, e
//! [`MemoryHost`], che è quella contro cui si sviluppa. Chi scrive un plugin
//! sceglie il ramo sulla **specie** dell'errore, non sulla prosa — è la ragione
//! per cui il contratto ha `already-exists` e `not-found` accanto a `bad-args`
//! invece di una sola porta di rifiuto: `bad-args` è «hai sbagliato a
//! chiedere», e chi la sente correggerà l'argomento; `already-exists` è «c'è
//! già», e chi la sente sceglierà un altro nome.
//!
//! Se i due host danno facce diverse allo stesso fatto, quel ramo è scritto
//! contro il doppio e sbagliato sul kernel — e la differenza non la vede
//! nessuno, perché i due non si confrontano mai. Questo file è il posto in cui
//! si confrontano.
//!
//! Sta in `fub-features` perché è **l'unico crate che vede tutti e due**: il
//! kernel non conosce l'SDK e l'SDK non conosce il kernel, per invariante
//! (`crates/fub-abi/tests/dependency_invariant.rs`).
//!
//! Il banco non prova *cosa succede* — quello è lavoro dei banchi di ciascuno
//! dei due: prova **quale faccia** esce, e la chiede ai due host con la stessa
//! funzione, perché una prova scritta una volta sola non può descrivere due
//! comportamenti diversi senza accorgersene.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::traits::{DataWrite, HostApi};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{
    DirEntry, FormatRegistry, FsStorage, MachineSettings, Stat, VaultStorage, Workspace,
};
use fub_sdk::testing::MemoryHost;
use std::sync::Arc;

/// La specie di un errore, senza la prosa: è ciò su cui chi chiama sceglie, ed
/// è quindi la sola cosa che i due host si devono.
fn specie(e: &PluginError) -> String {
    match e {
        PluginError::UnknownCommand(_) => "unknown-command",
        PluginError::UnknownView(_) => "unknown-view",
        PluginError::UnknownJob(_) => "unknown-job",
        PluginError::BadArgs(_) => "bad-args",
        PluginError::PermissionDenied(_) => "permission-denied",
        PluginError::Internal(_) => "internal",
        PluginError::Conflict(_) => "conflict",
        PluginError::Unserved(_) => "unserved",
        PluginError::Cancelled(_) => "cancelled",
        PluginError::NotFound(_) => "not-found",
        PluginError::AlreadyExists(_) => "already-exists",
        PluginError::Io(_) => "io",
    }
    .to_string()
}

/// Un supporto che dice di no a certe scritture, e per il resto è il disco.
///
/// Serve al terzo banco: il doppio ha la sua manopola (`nega_scrittura`), il
/// kernel no — l'unico modo di fargli sentire un supporto che rifiuta è
/// dargliene uno (§15.1).
struct SupportoCheNegaLeScritture {
    inner: FsStorage,
    nega: String,
}

impl SupportoCheNegaLeScritture {
    fn no(&self, path: &Utf8Path) -> Option<std::io::Error> {
        path.as_str().contains(&self.nega).then(|| {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "il supporto dice di no",
            )
        })
    }
}

impl VaultStorage for SupportoCheNegaLeScritture {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        match self.no(path) {
            Some(e) => Err(e),
            None => self.inner.write(path, bytes),
        }
    }
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Gira la stessa prova sui due host e pretende la stessa risposta.
///
/// La prova rende un elenco di coppie `(il fatto, la faccia)` invece di
/// asserire per conto proprio: così il rosso dice **quale** fatto ha ricevuto
/// risposte diverse e cosa hanno risposto i due, che è l'unica informazione
/// utile qui.
fn sui_due_host(
    storage: Option<Arc<dyn VaultStorage>>,
    prova: impl Fn(&mut dyn HostApi) -> Vec<(String, String)>,
) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = match storage {
        None => Workspace::new(&root, registry).expect("l'apertura del vault riesce"),
        Some(s) => Workspace::on(&root, registry, s, MachineSettings::in_memory())
            .expect("l'apertura del vault riesce"),
    };
    // Un plugin dichiarato, perché `with_host` è la sola via che attraversa
    // davvero il confine, e il kernel non presta capacità a una stringa (§7.3).
    ws.register_core_feature("prova.plugin", "prova.plugin")
        .expect("dichiarato");
    ws.reindex().expect("reindex");

    let mut dal_kernel = Vec::new();
    ws.with_host("prova.plugin", |host| dal_kernel = prova(host));

    let mut doppio = MemoryHost::new();
    let dal_doppio = prova(&mut doppio);

    assert_eq!(
        dal_kernel, dal_doppio,
        "i due host devono dare la stessa faccia agli stessi fatti — a sinistra \
         il kernel, a destra il doppio"
    );
}

/// Il documento che non c'è, e il path che è già occupato.
///
/// Sono i sei rami su cui il doppio rispondeva `bad-args` — «hai sbagliato a
/// chiedere» — mentre il kernel diceva «non c'è» o «c'è già»: le due risposte
/// da cui dipende cosa fa chi chiama.
#[test]
fn assente_e_occupato_hanno_la_stessa_faccia_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let c_e = DocId::new("Idea.md");
        let non_c_e = DocId::new("mai-scritta.md");
        host.create_document(&c_e, "il testo").expect("si scrive");
        host.create_document(&DocId::new("Seconda.md"), "due")
            .expect("si scrive");
        let cestinata = host.trash_document(&c_e).expect("si cestina");
        host.create_document(&c_e, "di nuovo").expect("si riscrive");

        vec![
            (
                "leggere ciò che non c'è".into(),
                specie(&host.read_document(&non_c_e).unwrap_err()),
            ),
            (
                "creare su un path occupato".into(),
                specie(&host.create_document(&c_e, "secondo").unwrap_err()),
            ),
            (
                "rinominare ciò che non c'è".into(),
                specie(
                    &host
                        .rename_document(&non_c_e, &DocId::new("Altra.md"))
                        .unwrap_err(),
                ),
            ),
            (
                "rinominare su un path occupato".into(),
                specie(
                    &host
                        .rename_document(&DocId::new("Seconda.md"), &c_e)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare una voce che nel cestino non c'è".into(),
                specie(
                    &host
                        .restore_document(&DocId::new(".trash/mai-cestinata.md"), None)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare su un path che nel frattempo è tornato".into(),
                specie(&host.restore_document(&cestinata, None).unwrap_err()),
            ),
        ]
    });
}

/// Il giro del cestino, dove conta la **forma** dell'id.
///
/// `trash_document` rende un id, e quell'id è l'unica cosa che chi chiama ha in
/// mano per ripristinare: se i due lo costruiscono con forme diverse, il codice
/// che lo maneggia — che lo mostri, che ne ricavi il nome di prima, che lo
/// riporti indietro — è scritto contro una forma sola. Qui non si confrontano
/// gli id (il timbro dipende dall'orologio, e il doppio non ne ha uno) ma la
/// forma: la cartella, la piattezza, l'estensione in coda, e che il giro di
/// andata e ritorno riporti lo stesso id dai due lati.
#[test]
fn l_id_del_cestino_ha_la_stessa_forma_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let id = DocId::new("Progetti/Idea.md");
        host.create_document(&id, "il testo").expect("si scrive");
        let cestinato = host.trash_document(&id).expect("si cestina");
        let s = cestinato.to_string();

        vec![
            (
                "sta nel cestino".into(),
                s.starts_with(".trash/").to_string(),
            ),
            (
                "il cestino è piatto".into(),
                (s.matches('/').count() == 1).to_string(),
            ),
            (
                "l'estensione resta in coda".into(),
                s.ends_with(".md").to_string(),
            ),
            (
                "e il ripristino rende lo stesso id".into(),
                host.restore_document(&cestinato, None)
                    .expect("si ripristina")
                    .to_string(),
            ),
        ]
    });
}

/// Il supporto che dice di no non è un difetto di chi ha scritto il codice.
///
/// Sul canale dati il doppio insegnava `io` — che è la faccia giusta, e il
/// contratto la scrive accanto alla variante — mentre il kernel rispondeva
/// `internal`, cioè «segnala un bug» a chi invece ha ragione di riprovare.
/// Il doppio ha una manopola per rifiutare; il kernel sente un rifiuto solo se
/// glielo dà il supporto, quindi qui i due arrivano allo stesso fatto per due
/// strade, e la prova è che ne escano con la stessa faccia.
#[test]
fn un_supporto_che_dice_di_no_e_un_io_di_qua_e_di_la() {
    // Il kernel non ha una manopola: l'unico modo di fargli sentire un
    // rifiuto è dargli un supporto che rifiuta (§15.1).
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let storage = Arc::new(SupportoCheNegaLeScritture {
        inner: FsStorage,
        nega: "/data/".to_string(),
    });
    let mut ws = Workspace::on(
        &root,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.register_core_feature("prova.plugin", "prova.plugin")
        .expect("dichiarato");
    let mut dal_kernel = String::new();
    ws.with_host("prova.plugin", |host| {
        dal_kernel = specie(&host.data_write("blob", b"i byte").unwrap_err());
    });

    // Il doppio ha la manopola, che è la stessa frase detta in memoria.
    let mut doppio = MemoryHost::new();
    doppio.nega_scrittura("blob");
    let dal_doppio = specie(&doppio.data_write("blob", b"i byte").unwrap_err());

    assert_eq!(
        (dal_kernel.as_str(), dal_doppio.as_str()),
        ("io", "io"),
        "il supporto che dice di no è «il mondo», non «un difetto di chi ha \
         scritto il codice»: chi lo sente ha ragione di riprovare, e con \
         `internal` non lo saprebbe"
    );
}
