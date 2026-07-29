//! La migrazione alla radice unica: `.fubmd-data/` → `.fubmd/data/`
//! ([decisione 0048](../../../docs/decisions/0048-una-radice-sola.md)).
//!
//! È la prima migrazione di **layout** del repo — le altre tre seguono la
//! rinomina di un documento — e ciò che va presidiato non è che il rename
//! avvenga (è una riga), ma le due cose che il rename non deve fare: perdere
//! ciò che nessuno saprebbe rifare, e indovinare quando i nomi sono due.
//!
//! Sotto il vecchio nome non c'era solo l'indice: c'erano gli snapshot del
//! versioning e lo stato per-documento (0044). Un test che verificasse solo
//! «la cartella nuova esiste» passerebbe anche se il contenuto fosse stato
//! buttato e rifatto, che è esattamente il modo sbagliato di migrare.

use camino::Utf8PathBuf;
use fubmd_kernel::{data_root, FormatRegistry, Workspace};

fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, root)
}

/// Un vault com'era prima della 0048: sidecar autorevole in `.fubmd/`, derivati
/// in `.fubmd-data/`, e sotto i derivati qualcosa che nessuno saprebbe rifare.
fn vault_di_prima(root: &Utf8PathBuf) {
    let vecchio = root.join(".fubmd-data");
    std::fs::create_dir_all(vecchio.join("plugins/fubmd.versioning/abc")).unwrap();
    std::fs::write(vecchio.join("plugins/fubmd.versioning/abc/1.md"), "com'era").unwrap();
    std::fs::write(vecchio.join("entries.json"), r#"{"version":1}"#).unwrap();
    std::fs::create_dir_all(root.join(".fubmd")).unwrap();
    std::fs::write(root.join(".fubmd/workspace.json"), r#"{"version":1}"#).unwrap();
}

#[test]
fn un_vault_di_prima_si_sposta_con_dentro_cio_che_non_si_rigenera() {
    let (_dir, root) = tempdir();
    vault_di_prima(&root);

    let mut ws = Workspace::new(&root, FormatRegistry::new());

    assert_eq!(
        ws.layout_warning(),
        None,
        "una migrazione che riesce non ha niente da dire"
    );
    assert_eq!(
        std::fs::read_to_string(data_root(&root).join("plugins/fubmd.versioning/abc/1.md"))
            .unwrap(),
        "com'era",
        "lo snapshot è lo stesso file spostato, non un file rifatto: da cosa \
         lo si rigenererebbe?"
    );
    assert!(
        data_root(&root).join("entries.json").is_file(),
        "e con lui tutto il resto dell'albero"
    );
    assert!(
        !root.join(".fubmd-data").exists(),
        "il vecchio nome sparisce: due alberi sono la condizione che alla \
         riapertura fa rifiutare la migrazione"
    );
    assert!(
        root.join(".fubmd/workspace.json").is_file(),
        "e il sidecar autorevole, che stava già nella radice buona, non è \
         stato toccato"
    );
}

#[test]
fn due_alberi_insieme_si_rifiutano_invece_di_fondersi() {
    let (_dir, root) = tempdir();
    vault_di_prima(&root);
    // Qualcuno ha già migrato questo vault — una copia più nuova di FubMD, o un
    // ripristino a metà — e poi ci ha scritto sopra.
    std::fs::create_dir_all(data_root(&root)).unwrap();
    std::fs::write(data_root(&root).join("entries.json"), r#"{"version":2}"#).unwrap();

    let mut ws = Workspace::new(&root, FormatRegistry::new());

    let avviso = ws.layout_warning().expect("due alberi si dicono");
    assert!(
        avviso.contains(".fubmd-data") && avviso.contains(".fubmd/data"),
        "l'avviso nomina tutti e due, o non si sa quale guardare: {avviso}"
    );
    assert_eq!(
        std::fs::read_to_string(data_root(&root).join("entries.json")).unwrap(),
        r#"{"version":2}"#,
        "il nuovo non si sovrascrive col vecchio"
    );
    assert_eq!(
        std::fs::read_to_string(root.join(".fubmd-data/entries.json")).unwrap(),
        r#"{"version":1}"#,
        "e il vecchio non si cancella: sceglie chi guarda i due, non questa \
         funzione"
    );
}

#[test]
fn un_vault_nuovo_non_dice_niente_e_non_crea_niente() {
    let (_dir, root) = tempdir();

    let mut ws = Workspace::new(&root, FormatRegistry::new());

    assert_eq!(ws.layout_warning(), None);
    assert!(
        !root.join(".fubmd").exists(),
        "aprire un vault non è scriverci: la radice nasce alla prima scrittura, \
         come prima della 0048"
    );
}

#[test]
fn un_fubmd_data_che_non_e_una_cartella_non_e_roba_nostra() {
    let (_dir, root) = tempdir();
    // Un file con quel nome: non l'ha scritto FubMD, e rinominarlo in
    // `.fubmd/data` lo trasformerebbe in un ostacolo permanente — ogni scrittura
    // successiva sotto quella radice troverebbe un file dove vuole una cartella.
    std::fs::write(root.join(".fubmd-data"), "non sono una cartella").unwrap();

    let mut ws = Workspace::new(&root, FormatRegistry::new());

    assert_eq!(ws.layout_warning(), None);
    assert!(root.join(".fubmd-data").is_file(), "resta dov'è");
}
