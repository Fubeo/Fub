//! Un export di Notion («Markdown & CSV») importato come ZIP: la forma è
//! quella degli export che i tester hanno costruito sugli export veri
//! (pagine annidate con l'id, un database `.csv` con la sua cartella di
//! pagine, date in inglese, numeri, una selezione, un callout, link fra le
//! pagine). Dopo l'import: nessun doppione, nomi senza id, link che portano a
//! un file che c'è, proprietà con il loro tipo.

use std::collections::BTreeSet;

use fub_abi::format::{DocumentSource, FormatProvider, ParseContext};
use fub_abi::model::{DateFormats, DocId, PropertyValue};
use fub_abi::traits::{HostQuery, IndexQuery, IndexResult, VaultRead};
use fub_abi::transfer::{ImportOutcome, ImportProvider, ImportRequest, ImportSource};
use fub_format_markdown::MarkdownProvider;
use fub_importers::ArchiveImport;
use fub_sdk::testing::MemoryHost;

const ROOT: &str = "Export-3e9d1f0a-7b2c-4d6e-8f10-a5b6c7d8e9f0";
const WELCOME: &str = "000000019c2e4a7f1b3d6e05a8c1f20d";
const SPECS: &str = "000000029c2e4a7f1b3d6e05a8c1f20d";
const CHECKOUT: &str = "000000039c2e4a7f1b3d6e05a8c1f20d";
const NOTES_A: &str = "000000049c2e4a7f1b3d6e05a8c1f20d";
const NOTES_B: &str = "000000059c2e4a7f1b3d6e05a8c1f20d";
const INVOICES: &str = "37ea6b3adaeaf63547c64825258a4400";
const INVOICE_31: &str = "93a3ea1d8a3f87fb579a09ebc9999825";
const INVOICE_32: &str = "5151d9ac79dcfbd6041e4db417d7b202";
const SCHEMA: &str = "0000000b9c2e4a7f1b3d6e05a8c1f20d";

fn export() -> Vec<(String, Vec<u8>)> {
    let text = |path: String, body: String| (format!("{ROOT}/{path}"), body.into_bytes());
    vec![
        text(
            format!("Benvenuto nel team {WELCOME}.md"),
            format!(
                "# Benvenuto nel team\n\n<aside>\n💡 Qui stanno le specifiche e le fatture.\n</aside>\n\n\
                 - Ogni fattura ha una riga nel database [Fatture](Fatture%20{INVOICES}.csv).\n\
                 - Le specifiche stanno in [Specifiche](Specifiche%20{SPECS}/Checkout%20v0%20{CHECKOUT}.md).\n\
                 - La prima fattura: [2026/031](Fatture%20{INVOICES}/Fattura%202026-031%20{INVOICE_31}.md).\n\n\
                 ![Schema del flusso](Schema%20del%20flusso%20{SCHEMA}.png)\n"
            ),
        ),
        text(
            format!("Specifiche {SPECS}.md"),
            format!(
                "# Specifiche\n\n- [Checkout v0](Specifiche%20{SPECS}/Checkout%20v0%20{CHECKOUT}.md)\n\
                 - [Note](Specifiche%20{SPECS}/Note%20{NOTES_A}.md)\n\
                 - [Note](Specifiche%20{SPECS}/Note%20{NOTES_B}.md)\n"
            ),
        ),
        text(
            format!("Specifiche {SPECS}/Checkout v0 {CHECKOUT}.md"),
            format!("# Checkout v0\n\nTorna a [Benvenuto](../Benvenuto%20nel%20team%20{WELCOME}.md).\n"),
        ),
        text(
            format!("Specifiche {SPECS}/Note {NOTES_A}.md"),
            "# Note\n\nLe prime.\n".into(),
        ),
        text(
            format!("Specifiche {SPECS}/Note {NOTES_B}.md"),
            "# Note\n\nLe seconde.\n".into(),
        ),
        text(
            format!("Fatture {INVOICES}.csv"),
            "Numero,Cliente,Importo,Stato pagamento,Emessa il,Scadenza,Pagata,Acconto\n\
             Fattura 2026/031,Panificio Del Ponte,2000,Pagata,\"September 2, 2026\",\"October 2, 2026\",Yes,450\n\
             Fattura 2026/032,Cantina Rocca Alta,1500.5,Da pagare,\"October 5, 2026\",\"November 4, 2026\",No,da definire\n\
             Fattura 2026/033,Ristorante Il Fico,1800,Da pagare,\"October 8, 2026\",\"December 8, 2026\",No,\n"
                .into(),
        ),
        text(
            format!("Fatture {INVOICES}/Fattura 2026-031 {INVOICE_31}.md"),
            "# Fattura 2026/031\n\nCliente: Panificio Del Ponte\nImporto: 2000\nStato pagamento: Pagata\n\
             Emessa il: September 2, 2026\nScadenza: October 2, 2026\n\n\
             Imponibile, IVA esclusa. Pagamento a 30 giorni.\n"
                .into(),
        ),
        text(
            format!("Fatture {INVOICES}/Fattura 2026-032 {INVOICE_32}.md"),
            "# Fattura 2026/032\n\nCliente: Cantina Rocca Alta\nStato pagamento: Da pagare\n\n\
             Sollecitata il 10 novembre.\n"
                .into(),
        ),
        (
            format!("{ROOT}/Schema del flusso {SCHEMA}.png"),
            b"\x89PNG\r\n\x1a\nfinto".to_vec(),
        ),
    ]
}

/// Uno ZIP con le voci memorizzate (senza compressione), nomi in UTF-8.
fn stored_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = !0u32;
        for &byte in data {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 0 {
                    crc >> 1
                } else {
                    (crc >> 1) ^ 0xedb8_8320
                };
            }
        }
        !crc
    }
    let mut zip = Vec::new();
    let mut directory = Vec::new();
    for (name, data) in entries {
        let offset = zip.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let header = |out: &mut Vec<u8>, central: bool| {
            out.extend_from_slice(
                &if central { 0x0201_4b50u32 } else { 0x0403_4b50 }.to_le_bytes(),
            );
            if central {
                out.extend_from_slice(&20u16.to_le_bytes());
            }
            out.extend_from_slice(&20u16.to_le_bytes());
            out.extend_from_slice(&0x0800u16.to_le_bytes()); // nomi UTF-8
            out.extend_from_slice(&[0; 6]); // metodo, ora, data
            for value in [crc, size, size] {
                out.extend_from_slice(&value.to_le_bytes());
            }
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            if central {
                out.extend_from_slice(&[0; 6]); // commento, disco, attributi interni
                out.extend_from_slice(&0u32.to_le_bytes());
                out.extend_from_slice(&offset.to_le_bytes());
            }
            out.extend_from_slice(name.as_bytes());
        };
        header(&mut zip, false);
        zip.extend_from_slice(data);
        header(&mut directory, true);
    }
    let start = zip.len() as u32;
    zip.extend_from_slice(&directory);
    zip.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    zip.extend_from_slice(&[0; 4]);
    let count = entries.len() as u16;
    zip.extend_from_slice(&count.to_le_bytes());
    zip.extend_from_slice(&count.to_le_bytes());
    zip.extend_from_slice(&(directory.len() as u32).to_le_bytes());
    zip.extend_from_slice(&start.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip
}

fn every_file(host: &MemoryHost) -> BTreeSet<String> {
    match host
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .unwrap()
    {
        IndexResult::Entries(page) => page
            .items
            .into_iter()
            .map(|entry| entry.id.as_str().to_string())
            .collect(),
        other => panic!("off-topic answer: {}", other.kind_name()),
    }
}

fn properties(text: &str, id: &str) -> serde_json::Map<String, serde_json::Value> {
    let model = MarkdownProvider
        .parse(
            &DocumentSource::Text(text.to_string()),
            &ParseContext::obsidian(id),
        )
        .unwrap();
    model.frontmatter.0
}

fn typed(props: &serde_json::Map<String, serde_json::Value>, key: &str) -> PropertyValue {
    PropertyValue::normalize(
        props
            .get(key)
            .unwrap_or_else(|| panic!("no `{key}` in {props:?}")),
        &DateFormats::ISO,
    )
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap()
}

/// Le destinazioni relative dei link Markdown di una nota.
fn relative_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("](") {
        rest = &rest[at + 2..];
        let end = rest.find(')').unwrap();
        let dest = &rest[..end];
        if !dest.contains("://") {
            out.push(dest.split('#').next().unwrap().to_string());
        }
        rest = &rest[end..];
    }
    out
}

fn resolve(from: &str, dest: &str) -> String {
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    let decoded = percent_decode(dest);
    for component in decoded.split('/') {
        match component {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            other => parts.push(other),
        }
    }
    parts.join("/")
}

#[test]
fn a_notion_export_becomes_a_clean_linked_vault() {
    let source = ImportSource::from_bytes("Esportazione Notion.zip", stored_zip(&export()));
    let request = ImportRequest::apply().into_folder("Da Notion");
    let mut host = MemoryHost::new();
    let preview = ArchiveImport
        .import(
            &source,
            &ImportRequest::preview().into_folder("Da Notion"),
            &mut host,
        )
        .unwrap();
    assert!(every_file(&host).is_empty(), "a preview writes nothing");
    let report = ArchiveImport.import(&source, &request, &mut host).unwrap();
    assert_eq!(preview.documents, report.documents);
    assert!(
        report
            .documents
            .iter()
            .all(|d| d.outcome == ImportOutcome::Created),
        "{:#?}",
        report.documents
    );

    // Nomi puliti: niente id, niente cartella `Export-…`, titoli uguali
    // distinti, la barra del titolo tolta dal solo nome del file.
    let files = every_file(&host);
    let expected: BTreeSet<String> = [
        "Benvenuto nel team.md",
        "Specifiche.md",
        "Specifiche/Checkout v0.md",
        "Specifiche/Note.md",
        "Specifiche/Note 2.md",
        "Fatture.csv",
        "Fatture/Fattura 2026-031.md",
        "Fatture/Fattura 2026-032.md",
        "Fatture/Fattura 2026-033.md",
        "Schema del flusso.png",
    ]
    .into_iter()
    .map(|name| format!("Da Notion/{name}"))
    .collect();
    assert_eq!(files, expected);

    // Nessun doppione: una nota per riga del database, e il CSV resta file.
    let rows: Vec<&String> = files
        .iter()
        .filter(|f| f.starts_with("Da Notion/Fatture/"))
        .collect();
    assert_eq!(rows.len(), 3, "{rows:?}");

    // Ogni link relativo porta a un file che c'è.
    for file in files.iter().filter(|f| f.ends_with(".md")) {
        let text = host.read_document(&DocId::new(file.as_str())).unwrap();
        assert!(
            !text.contains("9c2e4a7f1b3d6e05a8c1f20d") && !text.contains(INVOICES),
            "an id is left in {file}:\n{text}"
        );
        for link in relative_links(&text) {
            let target = resolve(file, &link);
            assert!(
                files.contains(&target),
                "{file}: `{link}` → `{target}` is missing"
            );
        }
    }

    // Il callout di Notion è il richiamo di Fub.
    let welcome = host
        .read_document(&DocId::new("Da Notion/Benvenuto nel team.md"))
        .unwrap();
    assert!(
        welcome.contains("> [!note]\n> 💡 Qui stanno le specifiche e le fatture.\n"),
        "{welcome}"
    );
    assert!(!welcome.contains("<aside>"), "{welcome}");
    assert!(welcome.contains("[Fatture](Fatture.csv)"), "{welcome}");

    // La pagina della riga tiene il suo testo e prende le colonne del CSV
    // con il loro tipo; le righe che le ripetevano lasciano il corpo.
    let first = host
        .read_document(&DocId::new("Da Notion/Fatture/Fattura 2026-031.md"))
        .unwrap();
    assert!(first.contains("Imponibile, IVA esclusa."), "{first}");
    let body = first.rsplit("---\n").next().unwrap();
    assert!(!body.contains("Cliente: "), "{first}");
    let props = properties(&first, "Fatture/Fattura 2026-031.md");
    assert_eq!(typed(&props, "Importo"), PropertyValue::Number(2000.0));
    assert_eq!(typed(&props, "Pagata"), PropertyValue::Bool(true));
    assert_eq!(
        typed(&props, "Cliente"),
        PropertyValue::Text("Panificio Del Ponte".into())
    );
    assert_eq!(
        typed(&props, "Stato pagamento"),
        PropertyValue::Text("Pagata".into())
    );
    match typed(&props, "Scadenza") {
        PropertyValue::Date(date) => {
            assert_eq!((date.year, date.month, date.day), (2026, 10, 2))
        }
        other => panic!("Scadenza is {other:?}"),
    }
    // Una colonna con un valore che non si legge resta testo, intera.
    assert_eq!(typed(&props, "Acconto"), PropertyValue::Text("450".into()));
    assert!(
        !props.contains_key("Numero"),
        "the title is the name: {props:?}"
    );

    let second = host
        .read_document(&DocId::new("Da Notion/Fatture/Fattura 2026-032.md"))
        .unwrap();
    assert!(second.contains("Sollecitata il 10 novembre."), "{second}");
    let props = properties(&second, "Fatture/Fattura 2026-032.md");
    assert_eq!(typed(&props, "Importo"), PropertyValue::Number(1500.5));
    assert_eq!(
        typed(&props, "Acconto"),
        PropertyValue::Text("da definire".into())
    );

    // La riga senza pagina nasce dal CSV, col titolo intero nell'H1.
    let third = host
        .read_document(&DocId::new("Da Notion/Fatture/Fattura 2026-033.md"))
        .unwrap();
    assert!(third.contains("# Fattura 2026/033\n"), "{third}");
    let props = properties(&third, "Fatture/Fattura 2026-033.md");
    match typed(&props, "Scadenza") {
        PropertyValue::Date(date) => {
            assert_eq!((date.year, date.month, date.day), (2026, 12, 8))
        }
        other => panic!("Scadenza is {other:?}"),
    }
    assert!(
        !props.contains_key("Acconto"),
        "an empty cell is no property"
    );

    // Il CSV entra identico, e il rapporto dice che cosa è successo.
    let csv = host
        .read_document(&DocId::new("Da Notion/Fatture.csv"))
        .unwrap();
    assert!(csv.starts_with("Numero,Cliente,Importo"));
    let log: Vec<&str> = report.log.iter().map(|n| n.message.as_str()).collect();
    assert!(
        log.iter()
            .any(|m| m.contains("3 rows, 2 joined with their page, 1 from the CSV alone")),
        "{log:#?}"
    );
    assert!(
        log.iter()
            .any(|m| m.contains("dates: `Emessa il`, `Scadenza`")),
        "{log:#?}"
    );
}

#[test]
fn a_plain_archive_keeps_its_names_and_its_markdown() {
    // Un nome con 32 cifre ma senza pagine né database di Notion non c'è:
    // l'archivio comune resta com'era, `<aside>` compreso.
    let entries = vec![(
        "cartella/nota.md".to_string(),
        b"<aside>\nresta\n</aside>\n[x](altra%20nota.md)\n".to_vec(),
    )];
    let source = ImportSource::from_bytes("a.zip", stored_zip(&entries));
    let mut host = MemoryHost::new();
    ArchiveImport
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap();
    let text = host.read_document(&DocId::new("cartella/nota.md")).unwrap();
    assert_eq!(text, "<aside>\nresta\n</aside>\n[x](altra%20nota.md)\n");
}
