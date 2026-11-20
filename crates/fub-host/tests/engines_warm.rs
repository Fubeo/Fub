//! **Scaldare costruisce il motore senza aprire file.**
//!
//! La shell chiede di scaldare il motore di un'estensione quando il puntatore
//! si ferma su un file: l'host lo costruisce in sottofondo se un vault aperto
//! ha un provider attivo per lei, e altrimenti non fa niente. Un motore già
//! acceso non si ricostruisce, e non perde quello che ricorda.
//!
//! È un eseguibile a parte: i motori sono del processo, e gli altri test
//! dell'host li accenderebbero mentre questo guarda se sono spenti.

#![cfg(all(feature = "rich", feature = "xlsx"))]

use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_format_rich::motore::MotoreDocumenti;
use fub_format_rich::Codec;
use fub_host::Host;
use fub_motori::{Motori, Voce};

/// Aspetta che il motore costruito in sottofondo sia acceso.
fn acceso_entro(voce: &dyn Voce) -> bool {
    let fine = Instant::now() + Duration::from_secs(30);
    while Instant::now() < fine {
        if voce.acceso() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    voce.acceso()
}

#[test]
fn scaldare_costruisce_il_motore_senza_aprire_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());

    // Senza un vault aperto nessun provider è attivo: niente si scalda.
    assert!(!host.warm_engine("docx"));
    assert!(!MotoreDocumenti::processo().acceso());

    host.open(&root).expect("opens the vault");
    host.wait_indexed(None).expect("indexed");
    let documenti = MotoreDocumenti::processo();
    assert!(
        !documenti.acceso(),
        "aprire il vault non costruisce il motore"
    );

    // Un'estensione senza motore, sconosciuta o malformata: falso, senza
    // errore e senza costruire niente.
    assert!(!host.warm_engine("md"));
    assert!(!host.warm_engine("sconosciuta"));
    assert!(!host.warm_engine("../docx"));
    assert!(!documenti.acceso());

    // Il vault ha il provider dei documenti: il motore si costruisce, e il
    // vault non ha nessun documento di Word da aprire.
    assert!(host.warm_engine(".DOCX"));
    assert!(
        acceso_entro(documenti.as_ref()),
        "il motore dei documenti si accende"
    );
    assert_eq!(documenti.prove_ricordate(), 0, "nessun file si è aperto");

    // Acceso, il motore non si ricostruisce: quello che ricorda resta.
    std::fs::write(
        root.join("Lettera.docx"),
        fub_format_rich::blank(Codec::Docx).unwrap(),
    )
    .unwrap();
    host.open_document_with_format(
        None,
        &DocId::new("Lettera.docx"),
        &fub_host::OpenKey::parse("lettera").unwrap(),
    )
    .expect("opens the document");
    let ricordate = documenti.prove_ricordate();
    assert!(ricordate > 0, "aprire ricorda la prova a vuoto");
    assert!(host.warm_engine("docx"));
    assert!(
        host.warm_engine("odt"),
        "un'altra estensione dello stesso motore"
    );
    assert!(documenti.acceso());
    assert_eq!(documenti.prove_ricordate(), ricordate);

    // Spento il bundle delle cartelle, la loro griglia non c'è: il motore dei
    // fogli non si costruisce. Riacceso, sì.
    let fogli = Motori::processo()
        .voce("fogli")
        .expect("i fogli sono iscritti");
    assert!(!fogli.acceso());
    let errors = host
        .set_plugin_enabled(None, "fub.xlsx", false)
        .expect("the bundle unmounts");
    assert!(errors.is_empty(), "{errors:?}");
    assert!(!host.warm_engine("xlsx"));
    std::thread::sleep(Duration::from_millis(50));
    assert!(!fogli.acceso(), "il componente spento non si scalda");
    let errors = host
        .set_plugin_enabled(None, "fub.xlsx", true)
        .expect("the bundle mounts");
    assert!(errors.is_empty(), "{errors:?}");
    assert!(host.warm_engine("xlsx"));
    assert!(
        acceso_entro(fogli.as_ref()),
        "il motore dei fogli si accende"
    );

    // Chiuso il vault, nessun provider è più attivo.
    assert!(host.close().is_empty());
    assert!(!host.warm_engine("docx"));
}

/// Il motore del disegno spento nella pagina Componenti non si scalda: né
/// spento a mano (`components.off`) né con i disegni spenti
/// (`plugins.disabled`). Basta un vault aperto che lo ha acceso.
#[cfg(feature = "engine-drawing")]
#[test]
fn spento_nel_vault_il_motore_del_disegno_non_si_scalda() {
    use fub_disegno::motore::{Disegni, SPAZIO};
    use fub_motori::{Caratteri, Generiche, Servizi};

    let vault = |settings: Option<serde_json::Value>| {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        if let Some(values) = settings {
            std::fs::create_dir_all(root.join(".fub")).unwrap();
            std::fs::write(
                root.join(".fub").join("settings.json"),
                serde_json::json!({"version": 1, "values": values}).to_string(),
            )
            .unwrap();
        }
        (dir, root)
    };
    // Il motore del processo, iscritto e con i caratteri, ma non costruito.
    let _ = Servizi::processo().fornisci_caratteri(Caratteri::nuovi(
        [],
        Generiche {
            serif: "Serif".into(),
            sans: "Sans".into(),
            mono: "Mono".into(),
        },
    ));
    let disegni = Disegni::processo();
    assert!(Motori::processo().voce(SPAZIO).is_ok(), "iscritto");
    assert!(!disegni.acceso());

    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    let (_spento, spento) = vault(Some(
        serde_json::json!({"components.off": ["fub.motore-vettoriale"]}),
    ));
    let (_senza_disegni, senza_disegni) =
        vault(Some(serde_json::json!({"plugins.disabled": ["fub.draw"]})));
    host.open(&spento).expect("opens the vault");
    host.open(&senza_disegni).expect("opens the vault");
    assert!(!host.warm_engine("svg"), "spento in ogni vault aperto");
    std::thread::sleep(Duration::from_millis(50));
    assert!(!disegni.acceso(), "spento, il motore non si costruisce");

    // Un vault che lo ha acceso basta.
    let (_acceso, acceso) = vault(None);
    host.open(&acceso).expect("opens the vault");
    assert!(host.warm_engine("svg"));
    assert!(
        acceso_entro(disegni.as_ref()),
        "il motore del disegno si accende"
    );
    assert!(host.close().is_empty());
}
