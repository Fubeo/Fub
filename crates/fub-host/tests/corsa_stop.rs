//! **Chi chiude torna** (§9.3, decisione 0032): il presidio della corsa fra
//! [`JobRunner::stop`] e il ciclo di un thread del pool.
//!
//! `stop` alza `stopping` e **poi** suona il campanello, mentre un thread legge
//! `stopping` in cima al ciclo e prende il biglietto subito dopo. Nell'istante
//! fra i due — controllo passato, `store` non ancora visto — il thread prende
//! un biglietto già oltre la suonata, trova la coda vuota e si mette ad
//! aspettare una campana che non suonerà mai più: chi chiude lo aspetta per
//! sempre, e con lui si pianta la chiusura del vault e lo spegnimento dell'app.
//!
//! La finestra è di qualche istruzione, quindi un test che apre e chiude una
//! volta non la vede mai — è il genere di difetto che si presenta a un utente e
//! non a chi lo ha scritto. Quello che segue non aspetta la fortuna: ripete il
//! giro finché la finestra si apre. Senza il ricontrollo della bandiera dopo il
//! biglietto si pianta entro il primo migliaio di giri; con, ventimila giri
//! costano un secondo.
//!
//! Non misura un tempo, quindi non prova la macchina su cui gira: il timeout è
//! un tetto largo per distinguere «piantato» da «lento», e in mezzo non c'è
//! niente che questa proprietà possa produrre.

use std::time::Duration;

use camino::Utf8PathBuf;
use fub_host::{BundleRegistry, Custodia, JobRunner};
use fub_kernel::Workspace;

/// Quanti giri, e con quanti thread per giro.
///
/// Il numero dei thread conta quanto quello dei giri: più sono, più bocche
/// possono trovarsi nella finestra mentre `stop` la attraversa.
const GIRI: u32 = 20_000;
const THREAD: usize = 4;

#[test]
fn chi_chiude_un_pool_torna_sempre() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");

    // Il giro sta su un thread suo perché un pool piantato pianta chi lo
    // aspetta: senza, il test non fallirebbe — resterebbe appeso, che è la
    // stessa cosa detta in un modo che nessuno legge.
    let (fatto, esito) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..GIRI {
            let workspace = Custodia::new(
                "il vault di prova",
                Workspace::new(&root, Default::default()).expect("l'apertura del vault riesce"),
            );
            let registry = Custodia::new("i componenti di prova", BundleRegistry::new());
            JobRunner::start(workspace, registry, THREAD, None)
                .expect("il pool parte")
                .stop();
        }
        let _ = fatto.send(());
    });

    assert!(
        esito.recv_timeout(Duration::from_secs(60)).is_ok(),
        "`JobRunner::stop` non è tornato: un thread del pool sta aspettando una \
         campana che non suonerà più"
    );
}
