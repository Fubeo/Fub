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
fn installato(config: &Utf8Path) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

fn cartella() -> (tempfile::TempDir, Utf8PathBuf) {
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
fn aperto_e_sparito(host: &Host) -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = cartella();
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("scrive");
    let root = root.canonicalize_utf8().expect("esiste ancora");
    host.open(&root).expect("si apre");
    // Il `TempDir` resta vivo — cancellarlo due volte non è un errore, e
    // tenerlo in mano rende esplicito che è la prova a togliere la cartella,
    // non il drop.
    std::fs::remove_dir_all(&root).expect("la cartella se ne va");
    assert!(!root.exists(), "la radice è sparita davvero");
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
fn un_vault_sparito_dal_disco_si_chiude_lo_stesso() {
    let (_config_dir, config) = cartella();
    let host = installato(&config);
    let (_dir, root) = aperto_e_sparito(&host);

    let guai = host
        .close_vault(&root)
        .expect("chiudere non è una domanda al disco");
    assert!(
        host.vaults().is_empty(),
        "la sessione è uscita dalla mappa: restarci sarebbe un vault \
         irraggiungibile e mai chiuso ({guai:?})"
    );
}

/// **Un vault sparito risponde ancora alle domande che non toccano il disco.**
///
/// `with_session(Some(root))` è il punto unico in cui «quale vault» si risolve:
/// finché ricanonicalizzava, un vault staccato non era più nominabile per nome
/// e ogni comando che lo nominava falliva prima ancora di provare — anche
/// quelli a cui la cartella non serviva.
#[test]
fn un_vault_sparito_e_ancora_nominabile_per_nome() {
    let (_config_dir, config) = cartella();
    let host = installato(&config);
    let (_dir, root) = aperto_e_sparito(&host);

    let vista = host
        .root(Some(root.as_str()))
        .expect("la sessione si trova per la chiave con cui è registrata");
    assert_eq!(vista, root, "ed è la stessa radice");
}

/// **Un vault sparito si può ancora preferire e rinominare.**
///
/// Sono le due operazioni che si fanno **apposta** su un vault che non c'è:
/// appuntarsi la chiavetta per ritrovarla al prossimo innesto, o darle un nome
/// che si riconosca in elenco. Il registro le teneva dietro a un
/// `canonicalize`, cioè dietro alla cartella che per definizione manca.
#[test]
fn un_vault_sparito_si_preferisce_e_si_rinomina_ancora() {
    let (_config_dir, config) = cartella();
    let host = installato(&config);
    let (_dir, root) = aperto_e_sparito(&host);
    host.close_vault(&root).expect("chiuso");

    host.set_vault_favorite(&root, true)
        .expect("preferire non è una domanda al disco");
    host.set_vault_look(&root, Some("usb".into()), "La chiavetta".into())
        .expect("rinominare non è una domanda al disco");

    let voci = host.known_vaults();
    let voce = voci
        .iter()
        .find(|e| e.root == root.as_str())
        .expect("la voce è ancora una sola, sotto la chiave di sempre");
    assert!(voce.favorite, "preferito");
    assert_eq!(voce.name, "La chiavetta");
    assert_eq!(
        voci.len(),
        1,
        "e nessuna voce doppia: la chiave usata è quella già in elenco, non una \
         forma nuova"
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
fn un_nome_mai_registrato_passa_ancora_dal_disco() {
    let (_config_dir, config) = cartella();
    let host = installato(&config);
    let (_dir, root) = cartella();
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("scrive");
    let root = root.canonicalize_utf8().expect("esiste");
    host.open(&root).expect("si apre");

    let (_alias_dir, alias_dir) = cartella();
    let alias = alias_dir.join("scorciatoia");
    std::os::unix::fs::symlink(root.as_std_path(), alias.as_std_path()).expect("link");

    let vista = host
        .root(Some(alias.as_str()))
        .expect("un alias si risolve ancora");
    assert_eq!(
        vista, root,
        "e finisce sulla chiave canonica, non su una seconda sessione"
    );
    host.close_vault(&alias).expect("e si chiude per alias");
    assert!(host.vaults().is_empty());
}
