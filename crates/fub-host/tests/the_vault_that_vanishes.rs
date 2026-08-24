//! **Un vault che sparisce da sotto i piedi** — la chiavetta staccata, la
//! cartella di rete che cade, il `rm -rf` di chi fa pulizia — e cosa resta
//! possibile farci.
//!
//! Il caso non è un path scritto male: quello lo prende `open`, che rifiuta chi
//! non è una cartella. È un vault **aperto correttamente** la cui radice non
//! c'è più. Da quel momento ogni funzione che ricanonicalizza il path prima di
//! usarlo fa una domanda al disco che non ha risposta, e risponde «non riesco a
//! risolvere» a chi voleva soltanto *chiudere* — cioè smettere di avere a che
//! fare con quel disco.
//!
//! La chiave però si sa già: è quella con cui l'apertura ha registrato la
//! sessione e la voce, ed è la stessa che `vaults()` e `known_vaults()`
//! restituiscono. Questi banchi provano che chi la usa non ha bisogno di
//! richiederla.

use camino::{Utf8Path, Utf8PathBuf};
use fub_host::{Host, NoWatcher};

/// Il livello macchina e il registro dei vault in una cartella di prova: senza
/// questa riga un test scriverebbe nella configurazione di chi lo esegue.
fn installed(config: &Utf8Path) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

fn folder() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

/// Un vault aperto, e poi **cancellato dal disco**: è il caso della chiavetta
/// staccata, simulato nel solo modo onesto — togliendo davvero la cartella.
///
/// Rende la radice *canonica*, che è la chiave con cui l'apertura ha
/// registrato la sessione, ed è ciò che la shell ha in mano: `vaults()` e
/// `known_vaults()` non ne restituiscono altre.
fn open_and_vanished(host: &Host) -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = folder();
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("writes");
    let root = root.canonicalize_utf8().expect("still exists");
    host.open(&root).expect("opens");
    // **Si aspetta il job prima di togliere la cartella** (§25.3). Da quando
    // l'indicizzazione è uscita dalla fase 1, `open` ritorna mentre qualcuno
    // sta ancora scrivendo dentro `.fub/`, e `remove_dir_all` che cammina
    // l'albero trova una cartella che si è ripopolata sotto:
    // `DirectoryNotEmpty`, sette corse su dieci. Non è il soggetto di questi
    // banchi — il soggetto è cosa resta possibile su una radice **già**
    // sparita — quindi la sparizione si fa quando il vault è fermo, non a
    host.wait_indexed(None).expect("waits for indexing");
    // metà apertura.
    // Il `TempDir` resta vivo — cancellarlo due volte non è un errore, e
    // tenerlo in mano rende esplicito che è la prova a togliere la cartella,
    std::fs::remove_dir_all(&root).expect("the directory is gone");
    assert!(!root.exists(), "the root has really vanished");
    (dir, root)
}

/// **Un vault sparito si chiude lo stesso.**
///
/// Prima `close_vault` canonicalizzava la radice come prima riga, e su una
/// cartella che non c'è più `canonicalize` non risponde: la chiusura falliva
/// con «non riesco a risolvere», la sessione restava nella mappa con i suoi
/// plugin accesi e il lock dell'indice in mano, e non c'era più modo di
/// toglierla se non spegnendo l'app.
///
/// Ciò che va storto *chiudendo* — l'indice che non si scrive su un disco che
/// non c'è — non è un fallimento della chiusura: esce dalla lista che
/// `close_vault` rende già, ed è il canale giusto perché lo si legge senza
/// perdere la chiusura.
#[test]
fn a_vault_vanished_from_the_disk_is_closes_the_same() {
    let (_config_dir, config) = folder();
    let host = installed(&config);
    let (_dir, root) = open_and_vanished(&host);

    let issues = host
        .close_vault(&root)
        .expect("closing is not a disk query");
    assert!(
        host.vaults().is_empty(),
        "the session left the map: staying would be an unreachable vault that \
         is never closed ({issues:?})"
    );
}

/// **Un vault sparito risponde ancora alle domande che non toccano il disco.**
///
/// `with_session(Some(root))` è il punto unico in cui «quale vault» si risolve:
/// finché ricanonicalizzava, un vault staccato non era più nominabile per nome
/// e ogni comando che lo nominava falliva prima ancora di provare — anche
/// quelli a cui la cartella non serviva.
#[test]
fn a_vault_vanished_and_again_nameable_for_name() {
    let (_config_dir, config) = folder();
    let host = installed(&config);
    let (_dir, root) = open_and_vanished(&host);

    let view = host
        .root(Some(root.as_str()))
        .expect("the session is found by the key under which it is registered");
    assert_eq!(view, root, "and it is the same root");
}

/// **Un vault sparito si può ancora preferire e rinominare.**
///
/// Sono le due operazioni che si fanno **apposta** su un vault che non c'è:
/// appuntarsi la chiavetta per ritrovarla al prossimo innesto, o darle un nome
/// che si riconosca in elenco. Il registro le teneva dietro a un
/// `canonicalize`, cioè dietro alla cartella che per definizione manca.
#[test]
fn a_vault_vanished_can_be_favorited_and_renamed_again() {
    let (_config_dir, config) = folder();
    let host = installed(&config);
    let (_dir, root) = open_and_vanished(&host);
    host.close_vault(&root).expect("chiuso");

    host.set_vault_favorite(&root, true)
        .expect("favoriting is not a disk query");
    host.set_vault_look(&root, Some("usb".into()), "The USB stick".into())
        .expect("renaming is not a disk query");

    let entries = host.known_vaults();
    let entry = entries
        .iter()
        .find(|and| and.root == root.as_str())
        .expect("the entry is still one, under the usual key");
    assert!(entry.favorite, "favorited");
    assert_eq!(entry.name, "The USB stick");
    assert_eq!(
        entries.len(),
        1,
        "and no duplicate entry: the key used is the one already in the list, \
         not a new form"
    );
}

/// **Il verso opposto, che è ciò che tiene in piedi la canonicalizzazione**: un
/// nome che il registro *non* conosce continua a passare dal disco.
///
/// Senza questa riga la riparazione sarebbe stata «non canonicalizzare più», e
/// avrebbe rotto ciò per cui la canonicalizzazione esiste: `/vault`, `/vault/`
/// e un link simbolico sono lo stesso vault, e vanno a finire sulla stessa
/// chiave. Qui si nomina la sessione da un link simbolico che punta alla
/// radice — un nome mai registrato — e la si trova lo stesso.
///
/// **Era verde anche prima**, ed è il punto: non presidia un difetto, presidia
/// che ripararne uno non abbia tolto la metà che funzionava. I tre banchi qui
/// sopra erano rossi.
#[test]
#[cfg(any(unix, windows))]
fn a_name_never_registered_passes_again_from_the_disk() {
    let (_config_dir, config) = folder();
    let host = installed(&config);
    let (_dir, root) = folder();
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("writes");
    let root = root.canonicalize_utf8().expect("exists");
    host.open(&root).expect("opens");

    let (_alias_dir, alias_dir) = folder();
    let alias = alias_dir.join("shortcut");
    directory_symlink(&root, &alias).expect("link");

    let view = host
        .root(Some(alias.as_str()))
        .expect("an alias still resolves");
    assert_eq!(
        view, root,
        "and it ends up under the canonical key, not a second session"
    );
    host.close_vault(&alias).expect("and closes by alias");
    assert!(host.vaults().is_empty());
}

#[cfg(unix)]
fn directory_symlink(target: &Utf8Path, link: &Utf8Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target.as_std_path(), link.as_std_path())
}

#[cfg(windows)]
fn directory_symlink(target: &Utf8Path, link: &Utf8Path) -> std::io::Result<()> {
    // GitHub-hosted Windows runners run tests as administrators with UAC
    // disabled, so this exercises the same directory-link semantics as Unix.
    // Do not turn a privilege error into a skipped test: that would hide the
    // regression this test is meant to catch.
    std::os::windows::fs::symlink_dir(target.as_std_path(), link.as_std_path())
}
