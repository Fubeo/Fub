//! **Le cartelle di Excel alle porte dei documenti della shell.**
//!
//! Leggere un `.xlsx` dà il giornale vuoto con la revisione dei byte; la
//! griglia si apre sui byte, e scrivere il giornale lo innesta, mentre ciò che
//! non si innesta si rifiuta con la sua specie e il file resta. Qui si prova
//! attraverso l'host vero, con il codec vero e un file vero sul disco: che il
//! kernel indicizzi la cartella con il provider a byte, che una cartella
//! cifrata o un file che non è una cartella lo dicano, e che il Markdown
//! accanto non cambi.

#![cfg(feature = "xlsx")]

use std::io::{Cursor, Write};

use camino::Utf8PathBuf;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::grid::{GridApplyRequest, GridCellKey, GridCellPatch, GridWindowRequest};
use fub_abi::model::DocId;
use fub_abi::{GridBytesCell, GridCommand, GridJournal, GridValue, PluginError};
use fub_format_xlsx::grid::XLSX_GRID_SURFACE;
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
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
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

fn key(row: u32, column: u32) -> GridCellKey {
    GridCellKey {
        sheet: "s1".into(),
        row: format!("r{row}"),
        column: format!("c{column}"),
    }
}

/// Le celle del file com'è sul disco, lette dalla griglia con un giornale
/// vuoto.
fn on_disk_cells(vault: &Vault, id: &DocId) -> Vec<GridBytesCell> {
    let (_, revision) = vault.host.read_document(None, id).unwrap();
    let session = vault
        .host
        .grid_bytes_open(None, XLSX_GRID_SURFACE, id, "", revision)
        .unwrap();
    let window = vault
        .host
        .grid_bytes_window(
            None,
            XLSX_GRID_SURFACE,
            &session.instance,
            GridWindowRequest {
                revision: session.revision.clone(),
                sheet: "s1".into(),
                row_start: 0,
                row_count: 3,
                column_start: 0,
                column_count: 2,
                known_media: Vec::new(),
            },
        )
        .unwrap();
    vault
        .host
        .grid_bytes_close(None, XLSX_GRID_SURFACE, &session.instance)
        .unwrap();
    window.cells
}

fn cell(cells: &[GridBytesCell], row: u32, column: u32) -> &GridBytesCell {
    let key = key(row, column);
    cells.iter().find(|cell| cell.key == key).unwrap()
}

fn message_key(error: &PluginError) -> Option<&str> {
    match error {
        PluginError::PermissionDenied(message) | PluginError::BadArgs(message) => {
            message.as_message().map(|m| m.key.as_str())
        }
        _ => None,
    }
}

#[test]
fn si_legge_come_giornale_vuoto_con_la_revisione_dei_byte() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let (text, revision, format) = vault
        .host
        .read_document_with_format(None, &DocId::new("Conti.xlsx"))
        .unwrap();
    assert_eq!(format.unwrap().descriptor.id, "xlsx");
    assert_eq!(text, "", "il testo di una cartella è il suo giornale");
    assert_eq!(revision, Revision::of_bytes(&vault.on_disk("Conti.xlsx")));
    let surface = vault
        .host
        .grid_surfaces(None)
        .unwrap()
        .into_iter()
        .find(|spec| spec.id == XLSX_GRID_SURFACE)
        .expect("la superficie delle cartelle è registrata");
    assert_eq!(
        (surface.format.as_str(), surface.protocol_version),
        ("xlsx", 2)
    );
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
fn la_griglia_si_apre_sui_byte_e_salvare_innesta_il_giornale() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let id = DocId::new("Conti.xlsx");
    let before = vault.on_disk("Conti.xlsx");
    let (journal, revision) = vault.host.read_document(None, &id).unwrap();
    let session = vault
        .host
        .grid_bytes_open(None, XLSX_GRID_SURFACE, &id, &journal, revision.clone())
        .unwrap();
    let cells = on_disk_cells(&vault, &id);
    let b1 = cell(&cells, 0, 1);
    assert_eq!(
        (b1.input.as_str(), &b1.value),
        ("800", &GridValue::Number(800.0))
    );
    assert_eq!(cell(&cells, 2, 0).lock.as_deref(), Some("spill"));

    let commit = vault
        .host
        .grid_bytes_apply(
            None,
            XLSX_GRID_SURFACE,
            &session.instance,
            GridApplyRequest {
                revision: session.revision.clone(),
                patches: vec![GridCellPatch {
                    cell: key(0, 1),
                    before: Some("800".into()),
                    after: "900".into(),
                }],
            },
        )
        .unwrap();
    vault
        .host
        .grid_bytes_close(None, XLSX_GRID_SURFACE, &session.instance)
        .unwrap();
    let journal = commit.edit.inserted;
    // Il disco non è cambiato: il giornale vive nel testo del documento.
    assert_eq!(vault.on_disk("Conti.xlsx"), before);

    let saved = vault
        .host
        .write_document(None, &id, &journal, WriteBase::DescendsFrom(revision))
        .unwrap();
    let after = vault.on_disk("Conti.xlsx");
    assert_eq!(saved, Revision::of_bytes(&after));
    let cells = on_disk_cells(&vault, &id);
    assert_eq!(cell(&cells, 0, 1).value, GridValue::Number(900.0));
    assert_eq!(cell(&cells, 0, 0).value, GridValue::Text("Affitto".into()));
    assert_eq!(cell(&cells, 2, 0).value, GridValue::Number(2.0));
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Nota.md")).unwrap(),
        "# Nota\n"
    );

    // Lo stesso giornale sui byte salvati è già applicato, e un giornale
    // vuoto non scrive.
    for text in [journal.as_str(), ""] {
        assert_eq!(
            vault
                .host
                .write_document(None, &id, text, WriteBase::DescendsFrom(saved.clone()))
                .unwrap(),
            saved
        );
        assert_eq!(vault.on_disk("Conti.xlsx"), after);
    }
    // Su una base vecchia la griglia non si apre e il giornale non si salva.
    let old = Revision::of_bytes(&before);
    assert!(matches!(
        vault
            .host
            .grid_bytes_open(None, XLSX_GRID_SURFACE, &id, "", old.clone()),
        Err(PluginError::Conflict(_))
    ));
    assert!(matches!(
        vault
            .host
            .write_document(None, &id, &journal, WriteBase::DescendsFrom(old)),
        Err(PluginError::Conflict(_))
    ));
    assert_eq!(vault.on_disk("Conti.xlsx"), after);
}

#[test]
fn un_giornale_di_comandi_riscrive_la_cartella() {
    let file = xlsx(r#"<row r="1"><c r="A1"><v>7</v></c><c r="B1"><f>A1*2</f><v>14</v></c></row>"#);
    let vault = Vault::with(&[("Conti.xlsx", &file)]);
    let id = DocId::new("Conti.xlsx");
    let revision = Revision::of_bytes(&vault.on_disk("Conti.xlsx"));
    let command = |id: &str, params: &str| GridCommand {
        id: id.into(),
        params: params.into(),
        sheet: "s1".into(),
        selection: "A1".into(),
        active: "A1".into(),
    };
    let mut journal = GridJournal::new();
    journal
        .push_command(command("home.insertRows", "{}"))
        .unwrap();
    journal
        .push_command(command(
            "range.setValues",
            r#"{"range":"A1","values":[["'testa"]]}"#,
        ))
        .unwrap();
    vault
        .host
        .write_document(
            None,
            &id,
            &journal.to_text(),
            WriteBase::DescendsFrom(revision),
        )
        .unwrap();
    // Il file riscritto si rilegge con la riga inserita e la formula
    // spostata.
    let cells = on_disk_cells(&vault, &id);
    assert_eq!(cell(&cells, 0, 0).input, "testa");
    assert_eq!(cell(&cells, 1, 0).value, GridValue::Number(7.0));
    assert_eq!(cell(&cells, 1, 1).input, "=A2*2");
    assert_eq!(cell(&cells, 1, 1).value, GridValue::Number(14.0));
}

#[test]
fn ciò_che_non_si_innesta_si_rifiuta_e_il_file_resta() {
    let vault = Vault::with(&[("Conti.xlsx", &conti())]);
    let id = DocId::new("Conti.xlsx");
    let before = vault.on_disk("Conti.xlsx");
    let revision = Revision::of_bytes(&before);
    let journal = |key: GridCellKey, before: &str, after: &str| {
        let mut journal = GridJournal::new();
        journal.record(key, before.into(), after.into()).unwrap();
        journal.to_text()
    };
    // Una cella versata da una formula dinamica è bloccata.
    let locked = vault.host.write_document(
        None,
        &id,
        &journal(key(2, 0), "2", "5"),
        WriteBase::DescendsFrom(revision.clone()),
    );
    assert!(
        matches!(locked, Err(PluginError::PermissionDenied(_))),
        "{locked:?}"
    );
    // Un testo che non è un giornale.
    let malformed = vault.host.write_document(
        None,
        &id,
        "# non è un giornale",
        WriteBase::DescendsFrom(revision.clone()),
    );
    assert_eq!(
        malformed.as_ref().err().and_then(message_key),
        Some("host.xlsx.journal"),
        "{malformed:?}"
    );
    assert_eq!(
        vault.on_disk("Conti.xlsx"),
        before,
        "il file resta byte per byte"
    );

    // Una cartella che non c'è non nasce da un giornale.
    let created = vault.host.write_document(
        None,
        &DocId::new("Nuova.xlsx"),
        &journal(key(0, 0), "", "1"),
        WriteBase::Dictated,
    );
    assert_eq!(
        created.as_ref().err().and_then(message_key),
        Some("host.xlsx.missing"),
        "{created:?}"
    );
    assert!(!vault.root.join("Nuova.xlsx").exists());

    // La superficie delle cartelle non apre una nota.
    let nota = DocId::new("Nota.md");
    let (_, nota_revision) = vault.host.read_document(None, &nota).unwrap();
    assert!(matches!(
        vault
            .host
            .grid_bytes_open(None, XLSX_GRID_SURFACE, &nota, "", nota_revision),
        Err(PluginError::BadArgs(_))
    ));
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
