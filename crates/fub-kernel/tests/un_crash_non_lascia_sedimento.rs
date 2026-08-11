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
use fub_testkit::TestoDiProva;

const RADICE: &str = "/vault";
/// Il temporaneo che il crash ha lasciato: la forma esatta che compone
/// `tmp_path`, punto davanti, `.tmp`, il pid e il numero di sequenza.
const RESIDUO: &str = "/vault/.Nota.md.tmp4242-0";

fn supporto() -> Arc<dyn VaultStorage> {
    let storage: Arc<dyn VaultStorage> = Arc::new(MemStorage::new());
    storage
        .write(Utf8Path::new("/vault/Idea.md"), b"una nota vera")
        .expect("scrittura");
    storage
}

/// Fa passare il tempo del supporto in memoria, dove il tempo è un contatore di
/// operazioni: la soglia è di sedici, e venti la superano di sicuro.
fn passa_un_giorno(storage: &Arc<dyn VaultStorage>) {
    for i in 0..20 {
        let path = format!("/vault/.fub/passa-{i}");
        storage
            .write(Utf8Path::new(&path), b"x")
            .expect("scrittura");
    }
}

fn workspace(storage: &Arc<dyn VaultStorage>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("md").boxed())
        .expect("nessun conflitto di estensioni");
    Workspace::on(
        RADICE,
        registry,
        Arc::clone(storage),
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce")
}

/// La camminata è il solo posto da cui quel file si vede, e lo riferisce.
#[test]
fn la_camminata_vede_il_temporaneo_che_nessuno_vede_piu() {
    let storage = supporto();
    storage
        .write(Utf8Path::new(RESIDUO), b"mezza scrittura")
        .expect("scrittura");
    passa_un_giorno(&storage);

    let vault = Vault::on(RADICE, Arc::clone(&storage)).expect("il vault si apre");
    let scan = vault.scan().expect("la scansione riesce");

    assert!(
        scan.files.iter().all(|f| f.id.0 != ".Nota.md.tmp4242-0"),
        "un temporaneo di scrittura non è un documento"
    );
    assert_eq!(
        scan.temporanei_rimasti_indietro
            .iter()
            .map(|p| p.as_str())
            .collect::<Vec<_>>(),
        vec![RESIDUO],
        "il temporaneo lasciato da un crash non lo vedeva nessuno"
    );
}

/// La metà che si vede: dopo un'apertura quel file non c'è più.
#[test]
fn un_apertura_toglie_cio_che_il_crash_ha_lasciato() {
    let storage = supporto();
    storage
        .write(Utf8Path::new(RESIDUO), b"mezza scrittura")
        .expect("scrittura");
    passa_un_giorno(&storage);

    let mut ws = workspace(&storage);
    ws.reindex().expect("la scansione della radice");

    assert!(
        !storage.exists(Utf8Path::new(RESIDUO)),
        "il temporaneo di una scrittura interrotta è ancora lì dopo un'apertura, \
         e ce ne sarà un altro al prossimo crash"
    );
    assert!(
        storage.exists(Utf8Path::new("/vault/Idea.md")),
        "la nota vera è sopravvissuta"
    );
}

/// L'altra metà, quella che impedisce alla riparazione di diventare «togli i
/// temporanei»: una scrittura **in corso** ha un temporaneo che è suo, e chi
/// pulisce non gli toglie la sorgente della rename da sotto i piedi.
#[test]
fn una_scrittura_viva_non_si_interrompe() {
    let storage = supporto();
    passa_un_giorno(&storage);
    let mut ws = workspace(&storage);

    // Adesso, cioè mentre l'apertura sta per cominciare: questo temporaneo ha
    // un `File` aperto da qualche parte e la sua rename deve ancora arrivare.
    let vivo = Utf8Path::new("/vault/.Appena.md.tmp4242-1");
    storage
        .write(vivo, b"i byte stanno atterrando")
        .expect("scrittura");

    ws.reindex().expect("la scansione della radice");

    assert!(
        storage.exists(vivo),
        "una scrittura viva è stata interrotta da chi puliva: la sua rename \
         non troverà più la sorgente"
    );
}
