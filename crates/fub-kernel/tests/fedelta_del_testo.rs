//! Il corpus dei file ostili: aprire e risalvare non cambia un byte (§15.5).
//!
//! È il presidio della §2.4 del catalogo — *«un file che Fub non ha modificato
//! resta identico byte per byte»* — sul pezzo che riguarda la **forma del testo**:
//! BOM, terminatori di riga, newline finale, spazi in coda. La promessa è
//! esattamente il genere di cosa che si perde in silenzio: nessun test diventa
//! rosso il giorno in cui qualcuno mette un `.trim()` o un `.replace("\r\n",
//! "\n")` sulla via della lettura, e chi se ne accorge è chi tiene il vault sotto
//! git e vede un diff di duecento righe per una parola cambiata.
//!
//! Il giro è quello vero: `Vault::read` → `Vault::write`, cioè le due funzioni per
//! cui passa ogni salvataggio dell'editor. Il confronto è **sui byte del file**,
//! non sulla stringa: è l'unico modo di accorgersi di un BOM aggiunto o di un
//! terminatore convertito.
//!
//! Perché il corpus sta scritto qui come byte e non come file su disco: un file
//! con un BOM o con CRLF committato in un repo è alla mercé di `.gitattributes`,
//! degli editor e dei checkout su Windows. Un array di byte in un sorgente Rust
//! arriva a destinazione com'è stato scritto.

use camino::Utf8PathBuf;
use fub_abi::rules::text_policy::{self, Newline};
use fub_abi::DocId;
use fub_kernel::Vault;

fn tempvault() -> (tempfile::TempDir, Vault) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let vault = Vault::open(&root);
    (dir, vault)
}

/// Il corpus: nome del caso, e i byte esatti del file.
///
/// Ogni voce è una forma che un vault vero contiene e che un normalizzatore
/// distratto cambierebbe. `\u{feff}` è scritto come i tre byte che è.
fn corpus() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("lf", b"# Titolo\n\nUn paragrafo.\n".to_vec()),
        ("crlf", b"# Titolo\r\n\r\nUn paragrafo.\r\n".to_vec()),
        ("cr solo", b"# Titolo\rUn paragrafo.\r".to_vec()),
        ("misti", b"# Titolo\r\n\nuna\r\n\naltra\n".to_vec()),
        (
            "bom + lf",
            b"\xef\xbb\xbf# Titolo\n\nUn paragrafo.\n".to_vec(),
        ),
        (
            "bom + crlf",
            b"\xef\xbb\xbf# Titolo\r\n\r\nUn paragrafo.\r\n".to_vec(),
        ),
        (
            "bom + frontmatter + crlf",
            b"\xef\xbb\xbf---\r\ntitolo: X\r\n---\r\n\r\n# Corpo\r\n".to_vec(),
        ),
        // Senza newline finale: aggiungerla è la modifica che ogni editor fa di
        // sua iniziativa, e il catalogo dice «né aggiunta né tolta».
        (
            "senza newline finale",
            b"Una riga sola senza a capo".to_vec(),
        ),
        // Due newline finali: toglierne una è la stessa modifica al contrario.
        ("due newline finali", b"Riga.\n\n".to_vec()),
        // Spazi in coda: in markdown due spazi a fine riga sono un `<br>`, quindi
        // «trailing whitespace non rimosso d'ufficio» non è pignoleria — è
        // sintassi.
        (
            "spazi in coda",
            b"Riga con due spazi  \naltra riga\n".to_vec(),
        ),
        (
            "tab e spazi misti",
            b"- uno\n\t- annidato con tab\n  - con spazi\n".to_vec(),
        ),
        // Un file vuoto, e uno che è solo un BOM: i due casi limite che un
        // `if source.is_empty()` tratterebbe uguale sbagliando.
        ("vuoto", Vec::new()),
        ("solo bom", b"\xef\xbb\xbf".to_vec()),
        // NFD nel *contenuto*: la normalizzazione dei nomi non deve estendersi al
        // testo, o il file si riscrive tutto.
        (
            "contenuto in NFD",
            "Cafe\u{0301} e citta\u{0300}\n".as_bytes().to_vec(),
        ),
        // Un carattere fuori dal BMP: quattro byte, due code unit UTF-16.
        ("fuori dal BMP", "Ciao 🌍 mondo\n".as_bytes().to_vec()),
    ]
}

#[test]
fn aprire_e_risalvare_non_cambia_un_byte() {
    let (_dir, vault) = tempvault();
    for (nome, bytes) in corpus() {
        let id = DocId::new("nota.md");
        std::fs::write(vault.path_for(&id), &bytes).expect("scrive il file di partenza");

        let letto = vault.read(&id).unwrap_or_else(|e| panic!("{nome}: {e}"));
        vault
            .write(&id, &letto)
            .unwrap_or_else(|e| panic!("{nome}: {e}"));

        let dopo = std::fs::read(vault.path_for(&id)).expect("rilegge");
        assert_eq!(
            dopo,
            bytes,
            "{nome}: apri-e-salva ha cambiato i byte del file\n  prima: {:?}\n  dopo:  {:?}",
            String::from_utf8_lossy(&bytes),
            String::from_utf8_lossy(&dopo)
        );
    }
}

#[test]
fn la_lettura_non_toglie_il_bom_ne_converte_i_terminatori() {
    // L'altra metà: non basta che il round-trip torni; la **stringa** che chi
    // legge ha in mano deve essere i byte del file, o gli `Span` calcolati sopra
    // di lei cadono altrove (vedi il doc di `Span`).
    let (_dir, vault) = tempvault();
    let id = DocId::new("nota.md");

    std::fs::write(
        vault.path_for(&id),
        b"\xef\xbb\xbf# Titolo\r\n\r\nCorpo.\r\n",
    )
    .unwrap();
    let letto = vault.read(&id).unwrap();

    assert_eq!(text_policy::bom_len(&letto), 3, "il BOM è stato tolto");
    assert_eq!(
        Newline::of(&letto),
        Newline::Crlf,
        "i terminatori sono stati convertiti"
    );
    assert!(letto.starts_with('\u{feff}'));
    // E gli offset sono quelli del file: il primo byte di contenuto è il quarto.
    assert_eq!(&letto[3..11], "# Titolo");
}

#[test]
fn un_file_che_non_e_utf8_dice_a_quale_byte_lo_smette() {
    let (_dir, vault) = tempvault();
    let id = DocId::new("latin1.md");
    // `Città` in Latin-1: la `à` è un `0xE0` solo, che in UTF-8 apre una
    // sequenza a tre byte e non la chiude.
    std::fs::write(vault.path_for(&id), b"Citt\xe0 vecchia\n").unwrap();

    let err = vault.read(&id).expect_err("non è UTF-8");
    let testo = err.to_string();
    assert!(
        testo.contains("non è UTF-8") && testo.contains(" a 4"),
        "l'errore deve dire a quale byte: {testo}"
    );
    assert!(testo.contains("latin1.md"), "e su quale file: {testo}");
    // Non si indovina l'encoding e non si scrive niente: il file è ancora quello.
    assert_eq!(
        std::fs::read(vault.path_for(&id)).unwrap(),
        b"Citt\xe0 vecchia\n"
    );
}

#[test]
fn i_byte_grezzi_restano_leggibili_anche_quando_il_testo_no() {
    // `read_bytes` è la via dei provider `SourceKind::Bytes`, e non deve
    // ereditare il rifiuto di `read`: un `.canvas` con un encoding suo o un PDF
    // non sono testo e non devono diventare un errore.
    let (_dir, vault) = tempvault();
    let id = DocId::new("roba.bin");
    let bytes = b"\x00\x01\xff\xfe non testo".to_vec();
    std::fs::write(vault.path_for(&id), &bytes).unwrap();

    assert!(vault.read(&id).is_err());
    assert_eq!(vault.read_bytes(&id).unwrap(), bytes);
}
