//! **Chiusa l'ultima chiave di apertura, la cache dei documenti è a zero.**
//!
//! Aprire un `.docx` sotto una chiave lascia nel motore dei documenti la prova
//! a vuoto dei suoi byte. Quando la shell chiude la chiave, l'host dimentica
//! la sua prova; quando non resta aperta nessuna chiave, in nessun vault,
//! svuota la cache. Finché un'altra chiave è aperta, la sua prova resta.
//!
//! È un eseguibile a parte: le cache sono del processo, e gli altri test
//! dell'host le riempirebbero e le svuoterebbero mentre questo le guarda.

#![cfg(feature = "rich")]

use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_format_rich::motore::MotoreDocumenti;
use fub_format_rich::projection::{Block, Inline, Layout, Look, Projection, Role};
use fub_format_rich::Codec;
use fub_host::{Host, OpenKey};
use fub_motori::Voce;

/// Un `.docx` con questo paragrafo, scritto dal codec stesso: due testi
/// diversi danno due revisioni diverse.
fn docx(text: &str) -> Vec<u8> {
    let blank = fub_format_rich::blank(Codec::Docx).unwrap();
    let mut projection = Projection::from_json(
        &fub_format_rich::open(Codec::Docx, &blank)
            .unwrap()
            .projection,
    )
    .unwrap();
    projection.blocks = vec![Block::Para(fub_format_rich::projection::Para {
        role: Role::Body,
        locked: false,
        align: None,
        k: None,
        sect: None,
        page: None,
        header: None,
        footer: None,
        p: Layout::default(),
        s: None,
        f: Box::default(),
        ins: None,
        del: None,
        c: vec![Inline::Text {
            x: text.to_string(),
            k: None,
            m: Vec::new(),
            href: None,
            f: Look::default(),
            ins: None,
            del: None,
        }],
    })];
    match fub_format_rich::save(Codec::Docx, &blank, &projection.to_json().unwrap()).unwrap() {
        fub_format_rich::Saved::Bytes(bytes) => bytes,
        fub_format_rich::Saved::Unchanged => blank,
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn open(host: &Host, files: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        for (name, text) in files {
            std::fs::write(root.join(name), docx(text)).unwrap();
        }
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        host.open(&root).expect("opens the vault");
        host.wait_indexed(Some(root.as_str())).expect("indexed");
        Vault { _dir: dir, root }
    }

    fn name(&self) -> Option<&str> {
        Some(self.root.as_str())
    }

    /// Apre il documento sotto la chiave `key`.
    fn open_as(&self, host: &Host, name: &str, key: &str) -> Revision {
        host.open_document_with_format(self.name(), &DocId::new(name), &open_key(key))
            .expect("opens the document")
            .1
    }
}

fn open_key(raw: &str) -> OpenKey {
    OpenKey::parse(raw).expect("a well-formed key")
}

#[test]
fn chiusa_l_ultima_chiave_le_cache_dei_documenti_sono_a_zero() {
    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    let motore = MotoreDocumenti::processo();
    let primo = Vault::open(
        &host,
        &[
            ("Lettera.docx", "Cara Anna."),
            ("Verbale.docx", "Presenti."),
        ],
    );
    let secondo = Vault::open(&host, &[("Bozza.docx", "Una bozza.")]);

    // Scrivere i file di prova ha già ricordato la prova del documento
    // vuoto: si parte da una cache vuota.
    motore.svuota();
    primo.open_as(&host, "Lettera.docx", "lettera");
    primo.open_as(&host, "Verbale.docx", "verbale");
    secondo.open_as(&host, "Bozza.docx", "bozza");
    assert_eq!(
        motore.prove_ricordate(),
        3,
        "una prova per documento aperto"
    );

    // Una chiave mai aperta, una nota aperta sotto una chiave, un vault che
    // non è aperto: niente.
    primo.open_as(&host, "Nota.md", "nota");
    assert_eq!(
        host.open_keys(primo.name()),
        2,
        "una nota non apre la chiave"
    );
    host.document_closed(primo.name(), &open_key("altra"))
        .expect("not an error");
    host.document_closed(primo.name(), &open_key("nota"))
        .expect("not an error");
    host.document_closed(Some("/non/aperto"), &open_key("lettera"))
        .expect("not an error");
    assert_eq!(motore.prove_ricordate(), 3);

    // Chiuso un documento, la sua prova si dimentica e le altre restano.
    let prima = motore.byte();
    host.document_closed(primo.name(), &open_key("lettera"))
        .expect("closes");
    assert_eq!(motore.prove_ricordate(), 2);
    assert!(motore.byte() > 0 && motore.byte() < prima);
    // Chiuderlo di nuovo non toglie altro.
    host.document_closed(primo.name(), &open_key("lettera"))
        .expect("closes");
    assert_eq!(motore.prove_ricordate(), 2);

    // Una chiave resta aperta nell'altro vault: la cache non si svuota.
    host.document_closed(primo.name(), &open_key("verbale"))
        .expect("closes");
    assert_eq!(motore.prove_ricordate(), 1);
    assert!(motore.byte() > 0, "la prova del documento aperto resta");

    // Chiuso l'ultimo, la cache dei documenti è a zero.
    host.document_closed(secondo.name(), &open_key("bozza"))
        .expect("closes");
    assert_eq!(motore.prove_ricordate(), 0);
    assert_eq!(motore.byte(), 0);

    // Due documenti con gli stessi byte: chiuderne uno non toglie la prova
    // dell'altro.
    std::fs::copy(
        primo.root.join("Verbale.docx"),
        primo.root.join("Copia.docx"),
    )
    .unwrap();
    let verbale = primo.open_as(&host, "Verbale.docx", "verbale");
    let copia = primo.open_as(&host, "Copia.docx", "copia");
    assert_eq!(verbale, copia);
    assert_eq!(motore.prove_ricordate(), 1);
    host.document_closed(primo.name(), &open_key("copia"))
        .expect("closes");
    assert_eq!(
        motore.prove_ricordate(),
        1,
        "il verbale aperto ha gli stessi byte"
    );
    host.document_closed(primo.name(), &open_key("verbale"))
        .expect("closes");
    assert_eq!(motore.byte(), 0);

    assert!(host.close().is_empty());
}
