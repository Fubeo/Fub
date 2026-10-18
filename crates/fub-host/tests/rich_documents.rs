//! **I documenti di Word alle porte dei documenti della shell.**
//!
//! Leggere un `.docx` dà la sua proiezione con la revisione dei byte; scrivere
//! quella proiezione lo riporta ai byte con il CAS della stessa revisione. Qui
//! si prova attraverso l'host vero, con il codec vero e un file vero sul disco:
//! che il CAS protegga, che un salvataggio senza cambiamenti non scriva, che un
//! contenuto rotto non tocchi il file, e che il Markdown accanto non cambi.

#![cfg(feature = "rich")]

use camino::Utf8PathBuf;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_format_rich::projection::{Block, Inline, Projection, Role};
use fub_format_rich::Codec;
use fub_host::Host;

struct Vault {
    _config: tempfile::TempDir,
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn with_docx(paragraphs: &[&str]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Lettera.docx"), docx(paragraphs)).unwrap();
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        let config = tempfile::tempdir().expect("config");
        let host = Host::without_watcher()
            .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
        host.open(&root).expect("opens the vault");
        host.wait_indexed(None).expect("indexed");
        Vault {
            _config: config,
            _dir: dir,
            root,
            host,
        }
    }

    fn on_disk(&self) -> Vec<u8> {
        std::fs::read(self.root.join("Lettera.docx")).unwrap()
    }
}

fn lettera() -> DocId {
    DocId::new("Lettera.docx")
}

/// Un `.docx` con questi paragrafi, scritto dal codec stesso.
fn docx(paragraphs: &[&str]) -> Vec<u8> {
    let blank = fub_format_rich::blank(Codec::Docx).unwrap();
    let mut projection = Projection::from_json(
        &fub_format_rich::open(Codec::Docx, &blank)
            .unwrap()
            .projection,
    )
    .unwrap();
    projection.blocks = paragraphs.iter().map(|text| paragraph(text)).collect();
    match fub_format_rich::save(Codec::Docx, &blank, &projection.to_json().unwrap()).unwrap() {
        fub_format_rich::Saved::Bytes(bytes) => bytes,
        fub_format_rich::Saved::Unchanged => blank,
    }
}

fn paragraph(text: &str) -> Block {
    Block::Para(fub_format_rich::projection::Para {
        role: Role::Body,
        align: None,
        k: None,
        sect: None,
        c: vec![Inline::Text {
            x: text.to_string(),
            k: None,
            m: Vec::new(),
            href: None,
        }],
    })
}

fn texts(projection: &Projection) -> Vec<String> {
    projection
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Para(para) => Some(
                para.c
                    .iter()
                    .filter_map(|inline| match inline {
                        Inline::Text { x, .. } => Some(x.as_str()),
                        Inline::Atom { .. } => None,
                    })
                    .collect::<String>(),
            ),
            Block::Table(_) => None,
        })
        .collect()
}

#[test]
fn si_legge_come_proiezione_con_la_revisione_dei_byte() {
    let vault = Vault::with_docx(&["Cara Ada,", "ti scrivo."]);
    let (text, revision, format) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    assert_eq!(format.unwrap().descriptor.id, "docx");
    assert_eq!(revision, Revision::of_bytes(&vault.on_disk()));
    let projection = Projection::from_json(&text).unwrap();
    assert_eq!(projection.readonly, None);
    assert_eq!(texts(&projection), ["Cara Ada,", "ti scrivo."]);
    // Il kernel indicizza lo stesso file con il provider a byte.
    let model = format!(
        "{:?}",
        vault.host.read_model(None, &lettera()).unwrap().body
    );
    assert!(model.contains("ti scrivo."), "{model}");
}

#[test]
fn scrivere_la_proiezione_salva_i_byte_e_la_rilettura_la_ritrova() {
    let vault = Vault::with_docx(&["Cara Ada,", "ti scrivo."]);
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let mut projection = Projection::from_json(&text).unwrap();
    projection.blocks.push(paragraph("A presto."));
    let saved = vault
        .host
        .write_document(
            None,
            &lettera(),
            &projection.to_json().unwrap(),
            WriteBase::DescendsFrom(revision.clone()),
        )
        .unwrap();
    assert_ne!(saved, revision);
    assert_eq!(saved, Revision::of_bytes(&vault.on_disk()));
    let (again, now, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    assert_eq!(now, saved);
    assert_eq!(
        texts(&Projection::from_json(&again).unwrap()),
        ["Cara Ada,", "ti scrivo.", "A presto."]
    );
    let model = format!(
        "{:?}",
        vault.host.read_model(None, &lettera()).unwrap().body
    );
    assert!(model.contains("A presto."), "{model}");
}

#[test]
fn una_proiezione_invariata_non_scrive() {
    let vault = Vault::with_docx(&["Invariata."]);
    let before = vault.on_disk();
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let saved = vault
        .host
        .write_document(
            None,
            &lettera(),
            &text,
            WriteBase::DescendsFrom(revision.clone()),
        )
        .unwrap();
    assert_eq!(saved, revision);
    assert_eq!(vault.on_disk(), before, "il file resta byte per byte");
}

#[test]
fn un_file_cambiato_sotto_è_un_conflitto_e_non_si_tocca() {
    let vault = Vault::with_docx(&["Prima."]);
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let other = docx(&["Scritto da un altro."]);
    std::fs::write(vault.root.join("Lettera.docx"), &other).unwrap();
    let mut projection = Projection::from_json(&text).unwrap();
    projection.blocks.push(paragraph("Dopo."));
    let result = vault.host.write_document(
        None,
        &lettera(),
        &projection.to_json().unwrap(),
        WriteBase::DescendsFrom(revision),
    );
    assert!(
        matches!(result, Err(PluginError::Conflict(_))),
        "{result:?}"
    );
    assert_eq!(vault.on_disk(), other);
}

#[test]
fn un_contenuto_rotto_è_rifiutato_con_la_sua_specie_e_il_file_resta() {
    let vault = Vault::with_docx(&["Intatto."]);
    let before = vault.on_disk();
    let (_, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    for broken in [
        "# non è una proiezione",
        r#"{"format":"fub-rich","version":9,"blocks":[]}"#,
    ] {
        let result = vault.host.write_document(
            None,
            &lettera(),
            broken,
            WriteBase::DescendsFrom(revision.clone()),
        );
        assert!(
            matches!(result, Err(PluginError::BadArgs(_))),
            "{broken}: {result:?}"
        );
    }
    assert_eq!(vault.on_disk(), before);
}

#[test]
fn un_documento_nuovo_nasce_dalla_sua_proiezione() {
    let vault = Vault::with_docx(&["Esiste."]);
    let nuova = DocId::new("Nuova.docx");
    let mut projection = Projection::from_json(
        &vault
            .host
            .read_document_with_format(None, &lettera())
            .unwrap()
            .0,
    )
    .unwrap();
    projection.blocks = vec![paragraph("Appena nata.")];
    let revision = vault
        .host
        .write_document(
            None,
            &nuova,
            &projection.to_json().unwrap(),
            WriteBase::Dictated,
        )
        .unwrap();
    let bytes = std::fs::read(vault.root.join("Nuova.docx")).unwrap();
    assert_eq!(revision, Revision::of_bytes(&bytes));
    let opened = Projection::from_json(
        &fub_format_rich::open(Codec::Docx, &bytes)
            .unwrap()
            .projection,
    )
    .unwrap();
    assert_eq!(texts(&opened), ["Appena nata."]);
}

#[test]
fn il_markdown_accanto_resta_com_era() {
    let vault = Vault::with_docx(&["Word."]);
    let note = DocId::new("Nota.md");
    let (text, revision, format) = vault.host.read_document_with_format(None, &note).unwrap();
    assert_eq!(text, "# Nota\n");
    assert_eq!(format.unwrap().descriptor.id, "markdown");
    vault
        .host
        .write_document(
            None,
            &note,
            "# Nota\naltro\n",
            WriteBase::DescendsFrom(revision),
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Nota.md")).unwrap(),
        "# Nota\naltro\n"
    );
}

#[test]
fn una_proiezione_in_sola_lettura_non_si_salva_e_lo_dice() {
    let vault = Vault::with_docx(&["Da leggere."]);
    let before = vault.on_disk();
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let mut projection = Projection::from_json(&text).unwrap();
    projection.readonly = Some(fub_format_rich::ReadOnly::Projection);
    projection.blocks.push(paragraph("Aggiunto."));
    let result = vault.host.write_document(
        None,
        &lettera(),
        &projection.to_json().unwrap(),
        WriteBase::DescendsFrom(revision),
    );
    let Err(PluginError::PermissionDenied(message)) = result else {
        panic!("{result:?}")
    };
    let fub_abi::Text::Message(message) = message else {
        panic!("{message:?}")
    };
    assert_eq!(message.key, "host.rich.readonly.projection");
    assert_eq!(vault.on_disk(), before);
}
