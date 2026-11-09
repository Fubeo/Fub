//! **Le letture semplici non aprono un documento.**
//!
//! Un documento di videoscrittura conta come aperto soltanto sotto la chiave
//! di apertura di una sessione della shell ([`OpenKey`]): leggerlo senza
//! chiave (l'anteprima, la CLI, il server MCP, la cattura, i lavori) dà la
//! stessa proiezione e la stessa revisione, e non lascia nessuna prova a vuoto
//! nel motore dei documenti; scriverlo senza chiave dimentica subito le prove
//! che il salvataggio ha lasciato. Chiusa l'ultima chiave, la cache è a zero.
//!
//! È un eseguibile a parte: le cache sono del processo, e gli altri test
//! dell'host le riempirebbero e le svuoterebbero mentre questo le guarda. Per
//! la stessa ragione le prove di questo file si fanno una alla volta.

use std::sync::{Mutex, MutexGuard, PoisonError};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_host::{Host, OpenKey};

static UNA_ALLA_VOLTA: Mutex<()> = Mutex::new(());

fn una_alla_volta() -> MutexGuard<'static, ()> {
    UNA_ALLA_VOLTA
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn open_key(raw: &str) -> OpenKey {
    OpenKey::parse(raw).expect("a well-formed key")
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn open(host: &Host, files: &[(&str, Vec<u8>)]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        for (name, bytes) in files {
            std::fs::write(root.join(name), bytes).unwrap();
        }
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        host.open(&root).expect("opens the vault");
        host.wait_indexed(Some(root.as_str())).expect("indexed");
        Vault { _dir: dir, root }
    }

    fn name(&self) -> Option<&str> {
        Some(self.root.as_str())
    }
}

fn host() -> (tempfile::TempDir, Host) {
    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    (config, host)
}

/// Senza il codec dei documenti la chiave si valida e si ignora: una nota si
/// apre sotto la chiave, e nessuna chiave resta aperta.
#[cfg(not(feature = "rich"))]
#[test]
fn senza_i_documenti_la_chiave_si_ignora() {
    let _una = una_alla_volta();
    let (_config, host) = host();
    let vault = Vault::open(&host, &[]);
    let key = open_key("sessione");
    let nota = DocId::new("Nota.md");
    let (text, revision, _) = host
        .open_document_with_format(vault.name(), &nota, &key)
        .expect("opens");
    assert_eq!(text, "# Nota\n");
    host.write_open_document(
        vault.name(),
        &nota,
        "# Nota\nAltro.\n",
        WriteBase::DescendsFrom(revision),
        &key,
    )
    .expect("writes");
    assert_eq!(host.open_keys(vault.name()), 0);
    host.document_closed(vault.name(), &key)
        .expect("not an error");
    assert!(host.close().is_empty());
}

#[cfg(feature = "rich")]
mod rich {
    use super::*;
    use fub_abi::PluginError;
    use fub_format_rich::motore::MotoreDocumenti;
    use fub_format_rich::projection::{Block, Inline, Layout, Look, Projection, Role};
    use fub_format_rich::Codec;
    use fub_motori::Voce;

    /// Un `.docx` con questo paragrafo, scritto dal codec stesso: due testi
    /// diversi danno due revisioni diverse.
    fn docx(text: &str) -> Vec<u8> {
        let blank = fub_format_rich::blank(Codec::Docx).unwrap();
        let mut projection = Projection::from_json(
            &fub_format_rich::open_unremembered(Codec::Docx, &blank)
                .unwrap()
                .projection,
        )
        .unwrap();
        set_text(&mut projection, text);
        match fub_format_rich::save(Codec::Docx, &blank, &projection.to_json().unwrap()).unwrap() {
            fub_format_rich::Saved::Bytes(bytes) => bytes,
            fub_format_rich::Saved::Unchanged => blank,
        }
    }

    fn set_text(projection: &mut Projection, text: &str) {
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
    }

    /// La proiezione `projection` con questo paragrafo al posto del corpo.
    fn edited(projection: &str, text: &str) -> String {
        let mut projection = Projection::from_json(projection).unwrap();
        set_text(&mut projection, text);
        projection.to_json().unwrap()
    }

    /// Il motore dei documenti del processo, a cache vuota: scrivere i file
    /// di prova ha già ricordato la prova del documento vuoto.
    fn motore() -> std::sync::Arc<MotoreDocumenti> {
        let motore = MotoreDocumenti::processo();
        motore.svuota();
        motore
    }

    /// Cento letture semplici di cento `.docx` diversi, l'anteprima ripetuta
    /// su cento file, non lasciano nessuna prova e nessuna chiave aperta.
    /// Aprire e chiudere poi una chiave sola svuota la cache: con le letture
    /// che aprivano, le altre cento prove sarebbero restate.
    #[test]
    fn cento_letture_semplici_non_lasciano_prove_e_una_chiave_svuota_la_cache() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        let files: Vec<(String, Vec<u8>)> = (0..100)
            .map(|n| {
                (
                    format!("Doc {n}.docx"),
                    docx(&format!("Documento numero {n}.")),
                )
            })
            .collect();
        let named: Vec<(&str, Vec<u8>)> = files
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.clone()))
            .collect();
        let vault = Vault::open(&host, &named);
        let motore = motore();
        let prima = motore.prove_ricordate();

        for (name, _) in &files {
            let (_, revision, format) = host
                .read_document_with_format(vault.name(), &DocId::new(name.as_str()))
                .expect("reads");
            assert!(revision.0.starts_with("sha256:"));
            assert_eq!(
                format.map(|known| known.descriptor.id),
                Some("docx".to_string())
            );
        }
        assert_eq!(motore.prove_ricordate(), prima, "nessuna prova ricordata");
        assert_eq!(host.open_keys(vault.name()), 0, "nessuna chiave aperta");

        // Una lettura semplice in più, del documento aperto più avanti, la
        // stessa cosa con `read_document`.
        host.read_document(vault.name(), &DocId::new("Doc 7.docx"))
            .expect("reads");
        assert_eq!(motore.prove_ricordate(), prima);

        let key = open_key("6f1c2b9e-1d2a-4c3b-9a8e-0f1e2d3c4b5a");
        host.open_document_with_format(vault.name(), &DocId::new("Doc 7.docx"), &key)
            .expect("opens");
        assert_eq!(motore.prove_ricordate(), prima + 1);
        assert_eq!(host.open_keys(vault.name()), 1);
        host.document_closed(vault.name(), &key).expect("closes");
        assert_eq!(host.open_keys(vault.name()), 0);
        assert_eq!(motore.prove_ricordate(), 0);
        assert_eq!(motore.byte(), 0, "la cache dei documenti è vuota");

        assert!(host.close().is_empty());
    }

    /// La lettura semplice e l'apertura danno la stessa proiezione, la stessa
    /// revisione e lo stesso formato; aprire e chiudere lascia zero prove.
    #[test]
    fn lettura_semplice_e_apertura_danno_la_stessa_proiezione() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        let vault = Vault::open(&host, &[("Lettera.docx", docx("Cara Anna."))]);
        let motore = motore();
        let lettera = DocId::new("Lettera.docx");

        let semplice = host
            .read_document_with_format(vault.name(), &lettera)
            .expect("reads");
        let key = open_key("lettera");
        let aperta = host
            .open_document_with_format(vault.name(), &lettera, &key)
            .expect("opens");
        assert_eq!(semplice.0, aperta.0, "la stessa proiezione");
        assert_eq!(semplice.1, aperta.1, "la stessa revisione");
        assert_eq!(
            semplice.2.map(|known| known.descriptor.id),
            aperta.2.map(|known| known.descriptor.id)
        );
        assert_eq!(motore.prove_ricordate(), 1);

        host.document_closed(vault.name(), &key).expect("closes");
        assert_eq!(motore.prove_ricordate(), 0);
        // Chiuderla di nuovo, o chiuderne una mai aperta, non è un errore.
        host.document_closed(vault.name(), &key).expect("closes");
        host.document_closed(vault.name(), &open_key("sconosciuta"))
            .expect("closes");
        host.document_closed(Some("/non/aperto"), &key)
            .expect("closes");
        assert!(host.close().is_empty());
    }

    /// Due chiavi sullo stesso documento: chiuderne una lascia la prova
    /// all'altra. Una chiave che segue una sessione rinominata tiene le prove
    /// dei due nomi, e chiuderla le dimentica tutte.
    #[test]
    fn due_chiavi_sullo_stesso_documento_e_una_sessione_rinominata() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        let vault = Vault::open(
            &host,
            &[
                ("Lettera.docx", docx("Cara Anna.")),
                ("Verbale.docx", docx("Presenti.")),
            ],
        );
        let motore = motore();
        let lettera = DocId::new("Lettera.docx");
        let (uno, due) = (open_key("uno"), open_key("due"));
        host.open_document_with_format(vault.name(), &lettera, &uno)
            .expect("opens");
        host.open_document_with_format(vault.name(), &lettera, &due)
            .expect("opens");
        assert_eq!(host.open_keys(vault.name()), 2);
        assert_eq!(motore.prove_ricordate(), 1, "gli stessi byte, una prova");
        host.document_closed(vault.name(), &uno).expect("closes");
        assert_eq!(motore.prove_ricordate(), 1, "l'altra chiave la tiene");
        host.document_closed(vault.name(), &due).expect("closes");
        assert_eq!(motore.prove_ricordate(), 0);

        // La sessione si rinomina: la chiave è la stessa, il nome no.
        let sessione = open_key("sessione");
        host.open_document_with_format(vault.name(), &lettera, &sessione)
            .expect("opens");
        host.open_document_with_format(vault.name(), &DocId::new("Verbale.docx"), &sessione)
            .expect("opens");
        assert_eq!(host.open_keys(vault.name()), 1);
        assert_eq!(motore.prove_ricordate(), 2);
        host.document_closed(vault.name(), &sessione)
            .expect("closes");
        assert_eq!(motore.prove_ricordate(), 0);
        assert_eq!(motore.byte(), 0);
        assert!(host.close().is_empty());
    }

    /// Scrivere sotto una chiave la apre e segna i byte sovrascritti e quelli
    /// nuovi; chiusa, nessuna prova resta. Scrivere senza chiave non lascia
    /// prove, né su un file che c'era né su uno nuovo. Una scrittura che
    /// fallisce non apre la chiave e non lascia prove.
    #[test]
    fn scrivere_con_e_senza_chiave_non_lascia_prove() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        let vault = Vault::open(
            &host,
            &[
                ("Lettera.docx", docx("Cara Anna.")),
                ("Verbale.docx", docx("Presenti.")),
            ],
        );
        let motore = motore();
        let lettera = DocId::new("Lettera.docx");

        // Una sessione nuova scrive prima di leggere sotto la sua chiave.
        let (projection, revision, _) = host
            .read_document_with_format(vault.name(), &lettera)
            .expect("reads");
        assert_eq!(motore.prove_ricordate(), 0);
        let key = open_key("lettera");
        let nuova = host
            .write_open_document(
                vault.name(),
                &lettera,
                &edited(&projection, "Cara Anna, ciao."),
                WriteBase::DescendsFrom(revision.clone()),
                &key,
            )
            .expect("writes");
        assert_ne!(nuova, revision);
        assert_eq!(
            host.open_keys(vault.name()),
            1,
            "la scrittura apre la chiave"
        );
        assert!(
            motore.prove_ricordate() >= 1,
            "la prova dei byte sovrascritti resta"
        );
        // Il salvataggio dopo parte dai byte nuovi, e la chiave li tiene.
        let (projection, again, _) = host
            .open_document_with_format(vault.name(), &lettera, &key)
            .expect("opens");
        assert_eq!(again, nuova);
        host.write_open_document(
            vault.name(),
            &lettera,
            &edited(&projection, "Cara Anna, ciao ancora."),
            WriteBase::DescendsFrom(nuova.clone()),
            &key,
        )
        .expect("writes");
        // Una scrittura sotto la chiave che fallisce (la base è vecchia) non
        // lascia prove senza la chiave.
        let conflict = host.write_open_document(
            vault.name(),
            &lettera,
            &projection,
            WriteBase::DescendsFrom(revision.clone()),
            &open_key("altra"),
        );
        assert!(
            matches!(conflict, Err(PluginError::Conflict(_))),
            "{conflict:?}"
        );
        assert_eq!(host.open_keys(vault.name()), 1, "la chiave non si apre");
        host.document_closed(vault.name(), &key).expect("closes");
        assert_eq!(motore.prove_ricordate(), 0, "chiusa la chiave, zero prove");
        assert_eq!(motore.byte(), 0);

        // Senza chiave: un file che c'era e uno nuovo.
        let verbale = DocId::new("Verbale.docx");
        let (projection, revision, _) = host
            .read_document_with_format(vault.name(), &verbale)
            .expect("reads");
        host.write_document(
            vault.name(),
            &verbale,
            &edited(&projection, "Presenti tutti."),
            WriteBase::DescendsFrom(revision),
        )
        .expect("writes");
        assert_eq!(motore.prove_ricordate(), 0, "senza chiave, zero prove");
        host.write_document(
            vault.name(),
            &DocId::new("Nuovo.docx"),
            &projection,
            WriteBase::Dictated,
        )
        .expect("creates");
        assert_eq!(
            motore.prove_ricordate(),
            0,
            "neanche quella del documento vuoto"
        );
        assert_eq!(host.open_keys(vault.name()), 0);
        assert!(host.close().is_empty());
    }

    /// Una lettura sotto la chiave che fallisce (il file non c'è, i byte sono
    /// rotti) non apre la chiave; una nota o una cartella di Excel aperte
    /// sotto la chiave si leggono e non segnano niente; una chiave in uno di
    /// due vault aperti tiene la cache finché non si chiude.
    #[test]
    fn letture_che_non_aprono_e_due_vault() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        // Senza la feature `xlsx` non si aggiunge la cartella di Excel.
        #[cfg_attr(not(feature = "xlsx"), allow(unused_mut))]
        let mut files = vec![
            ("Lettera.docx", docx("Cara Anna.")),
            ("Rotto.docx", b"PK\x03\x04 non un docx".to_vec()),
        ];
        #[cfg(feature = "xlsx")]
        files.push(("Conti.xlsx", xlsx()));
        let primo = Vault::open(&host, &files);
        let secondo = Vault::open(&host, &[("Bozza.docx", docx("Una bozza."))]);
        let motore = motore();
        let key = open_key("sessione");

        assert!(host
            .open_document_with_format(primo.name(), &DocId::new("Manca.docx"), &key)
            .is_err());
        assert!(host
            .open_document_with_format(primo.name(), &DocId::new("Rotto.docx"), &key)
            .is_err());
        host.open_document_with_format(primo.name(), &DocId::new("Nota.md"), &key)
            .expect("a note opens");
        #[cfg(feature = "xlsx")]
        host.open_document_with_format(primo.name(), &DocId::new("Conti.xlsx"), &key)
            .expect("a workbook opens");
        assert_eq!(host.open_keys(primo.name()), 0, "niente segnato");
        assert_eq!(motore.prove_ricordate(), 0);

        host.open_document_with_format(secondo.name(), &DocId::new("Bozza.docx"), &key)
            .expect("opens");
        host.open_document_with_format(
            primo.name(),
            &DocId::new("Lettera.docx"),
            &open_key("lettera"),
        )
        .expect("opens");
        assert_eq!(host.open_keys(primo.name()), 1);
        assert_eq!(host.open_keys(secondo.name()), 1);
        // La chiave è di un vault: nell'altro è sconosciuta.
        host.document_closed(primo.name(), &key).expect("closes");
        assert_eq!(motore.prove_ricordate(), 2);
        host.document_closed(primo.name(), &open_key("lettera"))
            .expect("closes");
        assert_eq!(motore.prove_ricordate(), 1, "la bozza resta aperta");
        assert!(motore.byte() > 0);
        host.document_closed(secondo.name(), &key).expect("closes");
        assert_eq!(motore.byte(), 0);

        // Il vault si chiude con le chiavi aperte: si chiudono tutte.
        host.open_document_with_format(secondo.name(), &DocId::new("Bozza.docx"), &key)
            .expect("opens");
        assert!(host.close_vault(&secondo.root).unwrap().is_empty());
        assert_eq!(host.open_keys(secondo.name()), 0);
        assert!(host.close().is_empty());
        assert_eq!(motore.byte(), 0);
    }

    /// Oltre le 1024 chiavi di un vault si chiude quella usata meno di
    /// recente, con le sue prove.
    #[test]
    fn la_chiave_numero_1025_chiude_la_prima() {
        let _una = una_alla_volta();
        let (_config, host) = host();
        let vault = Vault::open(
            &host,
            &[
                ("Prima.docx", docx("La prima.")),
                ("Altre.docx", docx("Le altre.")),
            ],
        );
        let motore = motore();
        let prima = open_key("k0");
        host.open_document_with_format(vault.name(), &DocId::new("Prima.docx"), &prima)
            .expect("opens");
        // Le altre chiavi si aprono scrivendo la proiezione com'è: il
        // salvataggio che non cambia niente segna i byte sotto la chiave
        // senza rifare la prova.
        let altre = DocId::new("Altre.docx");
        let (projection, revision, _) = host
            .open_document_with_format(vault.name(), &altre, &open_key("k1"))
            .expect("opens");
        assert_eq!(motore.prove_ricordate(), 2);
        for n in 2..=1024 {
            let written = host
                .write_open_document(
                    vault.name(),
                    &altre,
                    &projection,
                    WriteBase::DescendsFrom(revision.clone()),
                    &open_key(&format!("k{n}")),
                )
                .expect("writes");
            assert_eq!(written, revision);
        }
        assert_eq!(host.open_keys(vault.name()), 1024);
        assert_eq!(motore.prove_ricordate(), 1, "la prima chiave si è chiusa");
        host.document_closed(vault.name(), &prima)
            .expect("already closed");
        assert_eq!(host.open_keys(vault.name()), 1024);
        assert!(host.close().is_empty());
        assert_eq!(motore.byte(), 0);
    }

    /// Una chiave malformata è `BadArgs` prima di toccare il disco, per la
    /// lettura, la scrittura e la chiusura: il tipo non si costruisce.
    #[test]
    fn una_chiave_malformata_e_bad_args() {
        let long = "x".repeat(65);
        for bad in ["", long.as_str(), "a/b", "a.b", "a b", "chiave-è"] {
            assert!(
                matches!(OpenKey::parse(bad), Err(PluginError::BadArgs(_))),
                "{bad:?}"
            );
        }
        assert!(OpenKey::parse(&"x".repeat(64)).is_ok());
    }

    #[cfg(feature = "xlsx")]
    fn xlsx() -> Vec<u8> {
        use std::io::{Cursor, Write};
        const NS: &str = r#"xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
        const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        let files = [
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#.to_string(),
            ),
            (
                "_rels/.rels",
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>"#),
            ),
            (
                "xl/workbook.xml",
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><workbook {NS}><sheets><sheet name="Conti" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
            ),
            (
                "xl/worksheets/sheet1.xml",
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><worksheet {NS}><sheetData><row r="1"><c r="A1"><v>800</v></c></row></sheetData></worksheet>"#),
            ),
        ];
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, text) in files {
            writer
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(text.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}
