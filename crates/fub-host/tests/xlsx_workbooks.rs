//! **Le cartelle di Excel alle porte dei documenti della shell.**
//!
//! Leggere un `.xlsx` dà la sua proiezione con la revisione dei byte; scriverlo
//! si rifiuta con la sua specie e il file resta byte per byte. Qui si prova
//! attraverso l'host vero, con il codec vero e un file vero sul disco: che il
//! kernel indicizzi la cartella con il provider a byte, che una cartella
//! cifrata o un file che non è una cartella lo dicano, e che il Markdown
//! accanto non cambi.

#![cfg(feature = "xlsx")]

use std::io::{Cursor, Write};

use camino::Utf8PathBuf;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_format_xlsx::projection::{NoticeKind, Projection};
use fub_host::resources::ResourceWrite;
use fub_host::Host;

struct Vault {
    _config: tempfile::TempDir,
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn with(files: &[(&str, &[u8])]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        for (name, bytes) in files {
            std::fs::write(root.join(name), bytes).unwrap();
        }
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

    fn on_disk(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.root.join(name)).unwrap()
    }
}

const NS: &str = r#"xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Una cartella di un foglio con questi dati, scritta a mano.
fn xlsx(sheet_data: &str) -> Vec<u8> {
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
            format!(r#"<?xml version="1.0" encoding="UTF-8"?><worksheet {NS}><sheetData>{sheet_data}</sheetData></worksheet>"#),
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

fn conti() -> Vec<u8> {
    xlsx(
        r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Affitto</t></is></c><c r="B1"><v>800</v></c></row><row r="2"><c r="A2" cm="1"><f t="array" ref="A2:A3">_xlfn.SEQUENCE(2)</f><v>1</v></c></row><row r="3"><c r="A3"><v>2</v></c></row>"#,
    )
}

#[test]
fn si_legge_come_proiezione_con_la_revisione_dei_byte() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let (text, revision, format) = vault
        .host
        .read_document_with_format(None, &DocId::new("Conti.xlsx"))
        .unwrap();
    assert_eq!(format.unwrap().descriptor.id, "xlsx");
    assert_eq!(revision, Revision::of_bytes(&vault.on_disk("Conti.xlsx")));
    let projection = Projection::from_json(&text).unwrap();
    let sheet = &projection.sheets[0];
    assert_eq!(sheet.name, "Conti");
    let shown: Vec<_> = sheet
        .cells
        .iter()
        .map(|cell| {
            (
                cell.row,
                cell.col,
                cell.value.as_ref().unwrap().text.as_str(),
            )
        })
        .collect();
    assert_eq!(
        shown,
        [(0, 0, "Affitto"), (0, 1, "800"), (1, 0, "1"), (2, 0, "2")]
    );
    // La cella versata ha il valore del file: niente si ricalcola, e niente
    // manca.
    assert!(!projection
        .notices
        .iter()
        .any(|notice| notice.kind == NoticeKind::Uncomputed));
    // Il kernel indicizza lo stesso file con il provider a byte.
    let model = format!(
        "{:?}",
        vault
            .host
            .read_model(None, &DocId::new("Conti.xlsx"))
            .unwrap()
            .body
    );
    assert!(model.contains("Affitto"), "{model}");
}

#[test]
fn una_cartella_non_si_scrive_e_il_file_resta() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let id = DocId::new("Conti.xlsx");
    let before = vault.on_disk("Conti.xlsx");
    let (text, revision, _) = vault.host.read_document_with_format(None, &id).unwrap();
    for (source, base) in [
        (text.as_str(), WriteBase::DescendsFrom(revision.clone())),
        ("# non è una cartella", WriteBase::DescendsFrom(revision)),
        ("", WriteBase::Dictated),
    ] {
        let result = vault.host.write_document(None, &id, source, base);
        let Err(PluginError::PermissionDenied(message)) = &result else {
            panic!("{result:?}");
        };
        assert_eq!(
            message.as_message().map(|m| m.key.as_str()),
            Some("host.xlsx.readonly")
        );
    }
    assert_eq!(
        vault.on_disk("Conti.xlsx"),
        before,
        "il file resta byte per byte"
    );
    // Nemmeno una cartella che non c'è nasce da una proiezione.
    let created =
        vault
            .host
            .write_document(None, &DocId::new("Nuova.xlsx"), "{}", WriteBase::Dictated);
    assert!(
        matches!(created, Err(PluginError::PermissionDenied(_))),
        "{created:?}"
    );
    assert!(!vault.root.join("Nuova.xlsx").exists());
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Nota.md")).unwrap(),
        "# Nota\n"
    );
}

#[test]
fn i_byte_della_shell_non_coprono_una_cartella_ma_ne_creano_una() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let id = DocId::new("Conti.xlsx");
    let before = vault.on_disk("Conti.xlsx");
    let revision = Revision::of_bytes(&before);
    let written = vault
        .host
        .resource_write(None, &id, b"{\"version\":1}", Some(revision));
    let Err(PluginError::PermissionDenied(message)) = &written else {
        panic!("{written:?}");
    };
    assert_eq!(
        message.as_message().map(|m| m.key.as_str()),
        Some("host.xlsx.readonly")
    );
    assert_eq!(vault.on_disk("Conti.xlsx"), before);
    // Una cartella nuova, scaricata o incollata, si deposita come ogni file.
    let created = vault
        .host
        .resource_write(None, &DocId::new("Copia.xlsx"), &before, None)
        .unwrap();
    assert_eq!(created.revision, Revision::of_bytes(&before));
    assert_eq!(vault.on_disk("Copia.xlsx"), before);
}

#[test]
fn una_cartella_cifrata_o_un_file_che_non_lo_è_si_dicono() {
    // Un CSV con il nome di una cartella, e un compound file cifrato.
    let mut encrypted = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    encrypted.extend("EncryptedPackage".encode_utf16().flat_map(u16::to_le_bytes));
    let vault = Vault::with(&[("Finto.xlsx", b"a,b\n1,2\n"), ("Chiuso.xlsx", &encrypted)]);
    let read = |name: &str| {
        vault
            .host
            .read_document_with_format(None, &DocId::new(name))
    };
    let Err(PluginError::BadArgs(message)) = read("Finto.xlsx") else {
        panic!("{:?}", read("Finto.xlsx"));
    };
    assert_eq!(
        message.as_message().map(|m| m.key.as_str()),
        Some("host.xlsx.not_xlsx")
    );
    let Err(PluginError::PermissionDenied(message)) = read("Chiuso.xlsx") else {
        panic!("{:?}", read("Chiuso.xlsx"));
    };
    assert_eq!(
        message.as_message().map(|m| m.key.as_str()),
        Some("host.xlsx.encrypted")
    );
}
