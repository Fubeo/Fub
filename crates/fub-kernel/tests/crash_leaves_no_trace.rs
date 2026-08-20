//! **Un crash non lascia sedimento** (difetto 0155).
//!
//! Una scrittura atomica passa per un temporaneo — `.Nota.md.tmp1234-5` accanto
//! a `Nota.md` — e tutte le vie d'errore lo tolgono. Non lo toglie il crash: un
//! arresto improvviso fra la creazione e la rename lascia quel file lì, e da
//! quel momento nessuno lo vede più, perché la politica di esclusione lo
//! nasconde apposta (§15.6) — non compare in nessun elenco, non prende un
//! `DocId`, non genera un evento. Ogni crash ne aggiunge un altro, e il
//! sedimento cresce senza che niente lo dica.
//!
//! Il posto da cui si vedono è **la camminata**, che li attraversa comunque; il
//! posto da cui si tolgono è chi la camminata l'ha chiesta. Le due metà si
//! presidiano insieme perché una riparazione che li vedesse senza toglierli
//! sarebbe il difetto con un rapporto in più.
//!
//! La metà che impedisce alla riparazione di diventare «togli i temporanei» sta
//! qui accanto: una scrittura **viva** ha un temporaneo vivo, e chi pulisce non
//! la deve interrompere. È la ragione per cui il criterio è l'età, e il
//! supporto è in memoria proprio per poterla far passare senza aspettare.

use std::sync::Arc;

use camino::Utf8Path;
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage, Vault, VaultStorage, Workspace};
use fub_testkit::SampleText;

const ROOT: &str = "/vault";
/// Il temporaneo che il crash ha lasciato: la forma esatta che compone
/// `tmp_path`, punto davanti, `.tmp`, il pid e il numero di sequenza.
const RESIDUUM: &str = "/vault/.Nota.md.tmp4242-0";

fn storage() -> Arc<dyn VaultStorage> {
    let storage: Arc<dyn VaultStorage> = Arc::new(MemStorage::new());
    storage
        .write(Utf8Path::new("/vault/Idea.md"), b"a real note")
        .expect("write");
    storage
}

/// Fa passare il tempo del supporto in memoria, dove il tempo è un contatore di
/// operazioni: la soglia è di sedici, e venti la superano di sicuro.
fn a_day_passes(storage: &Arc<dyn VaultStorage>) {
    for the in 0..20 {
        let path = format!("/vault/.fub/passa-{the}");
        storage
            .write(Utf8Path::new(&path), b"x")
            .expect("write");
    }
}

fn workspace(storage: &Arc<dyn VaultStorage>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("md").boxed())
        .expect("no extension conflict");
    Workspace::on(
        ROOT,
        registry,
        Arc::clone(storage),
        MachineSettings::in_memory(),
    )
    .expect("vault opens successfully")
}

/// La camminata è il solo posto da cui quel file si vede, e lo riferisce.
#[test]
fn the_walk_sees_the_temporary_that_nobody_else_sees() {
    let storage = storage();
    storage
        .write(Utf8Path::new(RESIDUUM), b"half write")
        .expect("write");
    a_day_passes(&storage);

    let vault = Vault::on(ROOT, Arc::clone(&storage)).expect("vault opens");
    let scan = vault.scan().expect("scan succeeds");

    assert!(
        scan.files.iter().all(|f| f.id.0 != ".Nota.md.tmp4242-0"),
        "a write temporary is not a document"
    );
    assert_eq!(
        scan.temporary_remaining_back
            .iter()
            .map(|p| p.as_str())
            .collect::<Vec<_>>(),
        vec![RESIDUUM],
        "the temporary left by a crash was invisible to everyone"
    );
}

/// La metà che si vede: dopo un'apertura quel file non c'è più.
#[test]
fn an_opening_removes_what_the_crash_left() {
    let storage = storage();
    storage
        .write(Utf8Path::new(RESIDUUM), b"half write")
        .expect("write");
    a_day_passes(&storage);

    let mut ws = workspace(&storage);
    ws.reindex().expect("root scan");

    assert!(
        !storage.exists(Utf8Path::new(RESIDUUM)),
        "the temporary of an interrupted write is still there after an opening, \
         and there will be another at the next crash"
    );
    assert!(
        storage.exists(Utf8Path::new("/vault/Idea.md")),
        "the real note survived"
    );
}

/// L'altra metà, quella che impedisce alla riparazione di diventare «togli i
/// temporanei»: una scrittura **in corso** ha un temporaneo che è suo, e chi
/// pulisce non gli toglie la sorgente della rename da sotto i piedi.
#[test]
fn a_live_write_is_not_interrupted() {
    let storage = storage();
    a_day_passes(&storage);
    let mut ws = workspace(&storage);

    // Adesso, cioè mentre l'apertura sta per cominciare: questo temporaneo ha
    // un `File` aperto da qualche parte e la sua rename deve ancora arrivare.
    let live = Utf8Path::new("/vault/.Appena.md.tmp4242-1");
    storage
        .write(live, b"the bytes are landing")
        .expect("write");

    ws.reindex().expect("root scan");

    assert!(
        storage.exists(live),
        "a live write was interrupted by the cleaner: its rename will no longer \
         find the source"
    );
}
