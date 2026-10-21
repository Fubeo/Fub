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
use fub_format_rich::projection::{Block, Inline, Layout, Look, Projection, Role};
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
fn una_bozza_di_uno_schema_futuro_non_si_salva_e_resta() {
    let vault = Vault::with_docx(&["Intatto."]);
    let before = vault.on_disk();
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    // Una bozza scritta da un Fub più nuovo: dati opachi di uno schema che
    // questo non legge.
    let mut draft: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        draft["opaque_schema"],
        fub_format_rich::projection::OPAQUE_SCHEMA
    );
    draft["opaque_schema"] = 99.into();
    let draft = draft.to_string();
    vault
        .host
        .save_draft(None, &lettera(), &draft, Some(revision.clone()))
        .unwrap();

    let result =
        vault
            .host
            .write_document(None, &lettera(), &draft, WriteBase::DescendsFrom(revision));
    let Err(PluginError::BadArgs(fub_abi::Text::Message(message))) = result else {
        panic!("{result:?}")
    };
    assert_eq!(message.key, "host.rich.opaque_schema");
    assert_eq!(vault.on_disk(), before);
    // La bozza resta dov'è, con i suoi dati.
    let drafts = fub_kernel::drafts::drafts_dir(&vault.root);
    let kept = std::fs::read_dir(&drafts)
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap_or_default())
        .any(|content| content.contains("opaque_schema") && content.contains("99"));
    assert!(kept, "la bozza in {drafts} c'è ancora");
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

/// Un `.odt` con due paragrafi, scritto dall'esportatore di WordCraft da un
/// RTF: l'host non conosce il modello di WordCraft, e il test nemmeno.
fn odt() -> Vec<u8> {
    let rtf = br"{\rtf1\ansi\pard Verbale\par\pard Presenti tutti.\par}";
    let document = wordcraft_formats::rtf::import(rtf).unwrap();
    wordcraft_formats::odt::export(&document).unwrap()
}

fn denied(result: Result<Revision, PluginError>) -> String {
    let Err(PluginError::PermissionDenied(fub_abi::Text::Message(message))) = result else {
        panic!("{result:?}")
    };
    message.key
}

#[test]
fn un_odt_si_legge_si_cerca_e_si_scrive() {
    let vault = Vault::with_docx(&["Word."]);
    let verbale = DocId::new("Verbale.odt");
    let bytes = odt();
    std::fs::write(vault.root.join("Verbale.odt"), &bytes).unwrap();
    vault.host.wait_indexed(None).expect("indexed");
    let (text, revision, format) = vault
        .host
        .read_document_with_format(None, &verbale)
        .unwrap();
    assert_eq!(format.unwrap().descriptor.id, "odt");
    assert_eq!(revision, Revision::of_bytes(&bytes));
    let mut projection = Projection::from_json(&text).unwrap();
    assert_eq!(projection.readonly, None);
    assert_eq!(texts(&projection), ["Verbale", "Presenti tutti."]);
    let model = format!("{:?}", vault.host.read_model(None, &verbale).unwrap().body);
    assert!(model.contains("Presenti tutti."), "{model}");

    projection.blocks.push(paragraph("Aggiunto."));
    let written = vault
        .host
        .write_document(
            None,
            &verbale,
            &projection.to_json().unwrap(),
            WriteBase::DescendsFrom(revision),
        )
        .unwrap();
    let on_disk = std::fs::read(vault.root.join("Verbale.odt")).unwrap();
    assert_eq!(written, Revision::of_bytes(&on_disk));
    let (text, _, _) = vault
        .host
        .read_document_with_format(None, &verbale)
        .unwrap();
    assert_eq!(
        texts(&Projection::from_json(&text).unwrap()),
        ["Verbale", "Presenti tutti.", "Aggiunto."]
    );
}

#[test]
fn un_odt_che_il_codec_non_rappresenta_non_si_scrive() {
    let vault = Vault::with_docx(&["Word."]);
    // Una voce d'elenco vuota: il codec di Fub non la rappresenta e il file si
    // apre con l'importatore di WordCraft.
    let verbale = DocId::new("Verbale.odt");
    let content = String::from_utf8(part(&odt(), "content.xml"))
        .unwrap()
        .replacen(
            "<office:text>",
            "<office:text><text:list><text:list-item/></text:list>",
            1,
        );
    let bytes = with_part(&odt(), "content.xml", content.as_bytes());
    std::fs::write(vault.root.join("Verbale.odt"), &bytes).unwrap();
    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &verbale)
        .unwrap();
    let mut projection = Projection::from_json(&text).unwrap();
    assert_eq!(projection.readonly, Some(fub_format_rich::ReadOnly::Import));

    // Senza il campo `readonly` è il file stesso a rifiutare la scrittura.
    projection.readonly = None;
    projection.blocks.push(paragraph("Aggiunto."));
    let result = vault.host.write_document(
        None,
        &verbale,
        &projection.to_json().unwrap(),
        WriteBase::DescendsFrom(revision),
    );
    assert_eq!(denied(result), "host.rich.readonly.import");
    assert_eq!(
        std::fs::read(vault.root.join("Verbale.odt")).unwrap(),
        bytes
    );
}

fn part(bytes: &[u8], name: &str) -> Vec<u8> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut out = Vec::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
    out
}

/// Il pacchetto `bytes` con questa parte al posto della sua.
fn with_part(bytes: &[u8], name: &str, data: &[u8]) -> Vec<u8> {
    use std::io::{Read, Write};
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let entry = file.name().unwrap().to_string();
        let mut old = Vec::new();
        file.read_to_end(&mut old).unwrap();
        let options =
            zip::write::SimpleFileOptions::default().compression_method(file.compression());
        writer.start_file(entry.as_str(), options).unwrap();
        writer
            .write_all(if entry == name { data } else { &old })
            .unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn un_odt_nuovo_nasce_dalla_sua_proiezione() {
    let vault = Vault::with_docx(&["Word."]);
    let mut projection = Projection::from_json(
        &vault
            .host
            .read_document_with_format(None, &lettera())
            .unwrap()
            .0,
    )
    .unwrap();
    projection.blocks = vec![paragraph("Appena nato.")];
    // La pagina di un `.docx` non si scrive in un `.odt`: il codec la rifiuta.
    projection.page = None;
    vault
        .host
        .write_document(
            None,
            &DocId::new("Nuovo.odt"),
            &projection.to_json().unwrap(),
            WriteBase::Dictated,
        )
        .unwrap();
    let bytes = std::fs::read(vault.root.join("Nuovo.odt")).unwrap();
    let opened = fub_format_rich::open(Codec::Odt, &bytes).unwrap();
    assert_eq!(opened.readonly, None);
    assert_eq!(
        texts(&Projection::from_json(&opened.projection).unwrap()),
        ["Appena nato."]
    );
}

#[test]
fn un_rtf_e_un_doc_si_leggono_in_sola_lettura() {
    let vault = Vault::with_docx(&["Word."]);
    let rtf = br"{\rtf1\ansi\pard Appunto\par}";
    std::fs::write(vault.root.join("Appunto.rtf"), rtf).unwrap();
    // Un `.doc` che è un RTF rinominato, come capita: lo legge chi ne
    // riconosce la firma.
    std::fs::write(vault.root.join("Vecchio.doc"), rtf).unwrap();
    vault.host.wait_indexed(None).expect("indexed");
    for (name, id) in [("Appunto.rtf", "rtf"), ("Vecchio.doc", "doc")] {
        let (text, _, format) = vault
            .host
            .read_document_with_format(None, &DocId::new(name))
            .unwrap();
        assert_eq!(format.unwrap().descriptor.id, id);
        let projection = Projection::from_json(&text).unwrap();
        assert_eq!(projection.readonly, Some(fub_format_rich::ReadOnly::Import));
        assert_eq!(texts(&projection), ["Appunto"]);
    }
}

/// L'esito del prossimo job di trasferimento finito.
fn transfer_done(events: &fub_kernel::bus::Subscription) -> Result<serde_json::Value, PluginError> {
    loop {
        let notice = events
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("the job ends");
        if let fub_abi::Event::JobDone { job, result, .. } = notice.event {
            if job == "import.transfer" {
                return result;
            }
        }
    }
}

#[test]
fn esportare_una_copia_accoda_l_export_e_il_documento_resta() {
    let vault = Vault::with_docx(&["Primo paragrafo.", "Secondo."]);
    let before = vault.on_disk();
    let events = vault.host.subscribe(None).unwrap();
    let outcome = vault
        .host
        .invoke_user_command(
            None,
            "rich.export-copy",
            serde_json::json!({"doc": "Lettera.docx", "format": "txt"}),
            fub_abi::InvokeMode::Apply,
        )
        .expect("the command queues the export");
    assert!(
        format!("{:?}", outcome.notify).contains("export.run queued"),
        "{outcome:?}"
    );
    let report: fub_abi::transfer::ExportReport =
        serde_json::from_value(transfer_done(&events).expect("the export runs")).unwrap();
    assert_eq!(report.artifacts.len(), 1);
    assert_eq!(report.artifacts[0].path, "Lettera.txt");
    assert_eq!(report.artifacts[0].media_type, "text/plain");
    let text = String::from_utf8(report.artifacts[0].as_bytes().unwrap().to_vec()).unwrap();
    assert_eq!(text, "Primo paragrafo.\r\nSecondo.");
    // Il rapporto dice ciò che il confronto non misura; nessuna perdita qui.
    assert!(report
        .log
        .iter()
        .all(|note| note.level == fub_abi::transfer::NoteLevel::Info));
    assert_eq!(vault.on_disk(), before);
}

#[test]
fn una_nota_non_si_esporta_come_copia_di_videoscrittura() {
    let vault = Vault::with_docx(&["Word."]);
    let refused = vault.host.invoke_user_command(
        None,
        "rich.export-copy",
        serde_json::json!({"doc": "Nota.md", "format": "html"}),
        fub_abi::InvokeMode::Apply,
    );
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
}

#[test]
fn spento_il_bundle_il_comando_e_le_destinazioni_spariscono() {
    let vault = Vault::with_docx(&["Word."]);
    let targets = |vault: &Vault| -> Vec<String> {
        vault
            .host
            .commands(None)
            .unwrap()
            .into_iter()
            .map(|spec| spec.id)
            .filter(|id| id == "rich.export-copy")
            .collect()
    };
    assert_eq!(targets(&vault), ["rich.export-copy"]);
    let errors = vault
        .host
        .set_plugin_enabled(None, "fub.rich", false)
        .expect("the bundle unmounts");
    assert!(errors.is_empty(), "{errors:?}");
    assert!(targets(&vault).is_empty());
    let request = fub_abi::transfer::ExportRequest::new(
        "rich.copy.html",
        fub_abi::transfer::ExportSelection::Documents(vec![lettera()]),
    );
    let refused = vault.host.invoke_user_command(
        None,
        "export.run",
        serde_json::json!({"request_json": serde_json::to_string(&request).unwrap()}),
        fub_abi::InvokeMode::DryRun,
    );
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
    // Il documento si apre come prima: il codec non è del bundle.
    let (text, _, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    assert_eq!(texts(&Projection::from_json(&text).unwrap()), ["Word."]);
}

/// Il pacchetto `bytes` con queste voci in più.
fn with_entries(bytes: &[u8], extra: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::{Read, Write};
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let entry = file.name().unwrap().to_string();
        let mut old = Vec::new();
        file.read_to_end(&mut old).unwrap();
        writer
            .start_file(entry.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&old).unwrap();
    }
    for (name, data) in extra {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Un contenuto importato da un'altra parte (`w:altChunk`) che il codec
/// salterebbe: il controllo dei byte di Fub apre il documento in sola lettura
/// con il motivo `codec`, e la scrittura è rifiutata anche a chi toglie il
/// motivo dalla proiezione.
#[test]
fn un_docx_che_il_codec_perderebbe_si_legge_e_non_si_scrive() {
    let vault = Vault::with_docx(&["Primo.", "Secondo."]);
    let bytes = vault.on_disk();
    let document = String::from_utf8(part(&bytes, "word/document.xml"))
        .unwrap()
        .replacen("</w:p>", r#"</w:p><w:altChunk r:id="rIdChunk"/>"#, 1);
    // Il prefisso `r:` è dichiarato: il documento è ben formato, e la sola
    // lettura viene dal contenuto che il codec salterebbe.
    assert!(document.contains("altChunk") && document.contains("xmlns:r="));
    let rels = String::from_utf8(part(&bytes, "word/_rels/document.xml.rels"))
        .unwrap()
        .replacen(
            "</Relationships>",
            r#"<Relationship Id="rIdChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>"#,
            1,
        );
    let bytes = with_part(&bytes, "word/document.xml", document.as_bytes());
    let bytes = with_part(&bytes, "word/_rels/document.xml.rels", rels.as_bytes());
    let bytes = with_entries(
        &bytes,
        &[(
            "word/chunk.html",
            b"<html><body><p>Importato</p></body></html>",
        )],
    );
    std::fs::write(vault.root.join("Lettera.docx"), &bytes).unwrap();
    vault.host.wait_indexed(None).expect("indexed");

    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let mut projection = Projection::from_json(&text).unwrap();
    assert_eq!(projection.readonly, Some(fub_format_rich::ReadOnly::Codec));

    projection.readonly = None;
    projection.blocks.push(paragraph("Aggiunto."));
    let result = vault.host.write_document(
        None,
        &lettera(),
        &projection.to_json().unwrap(),
        WriteBase::DescendsFrom(revision),
    );
    assert_eq!(denied(result), "host.rich.readonly.codec");
    assert_eq!(vault.on_disk(), bytes);
}

/// Un paragrafo che il codec perderebbe (storytold/wordcraft#3457) resta
/// chiuso: cambiarlo si rifiuta con il suo numero e il file resta; cambiare un
/// altro paragrafo si salva, e il chiuso resta i suoi byte.
#[test]
fn un_paragrafo_chiuso_non_si_scrive_e_gli_altri_sì() {
    let vault = Vault::with_docx(&["Primo", "Secondo"]);
    let document = String::from_utf8(part(&vault.on_disk(), "word/document.xml")).unwrap();
    let closed = r#"<w:p><w:r><w:rPr><w:lang w:val="it-IT" w:eastAsia="ja-JP"/></w:rPr><w:t>Chiuso</w:t></w:r></w:p>"#;
    let at = document.find("<w:body>").unwrap() + "<w:body>".len();
    let document = format!("{}{closed}{}", &document[..at], &document[at..]);
    let bytes = with_part(&vault.on_disk(), "word/document.xml", document.as_bytes());
    std::fs::write(vault.root.join("Lettera.docx"), &bytes).unwrap();
    vault.host.wait_indexed(None).expect("indexed");

    let (text, revision, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let projection = Projection::from_json(&text).unwrap();
    assert_eq!(projection.readonly, None);
    assert!(projection.body_only);
    assert!(matches!(&projection.blocks[0], Block::Para(para) if para.locked));

    let mut changed = projection.clone();
    changed.blocks[0] = paragraph("Chiuso e cambiato");
    let result = vault.host.write_document(
        None,
        &lettera(),
        &changed.to_json().unwrap(),
        WriteBase::DescendsFrom(revision.clone()),
    );
    let Err(PluginError::PermissionDenied(fub_abi::Text::Message(message))) = result else {
        panic!("{result:?}")
    };
    assert_eq!(message.key, "host.rich.locked.block");
    assert!(message
        .args
        .contains(&fub_abi::text::Arg::text("block", "1")));
    assert_eq!(vault.on_disk(), bytes);

    let mut other = projection.clone();
    other.blocks[2] = paragraph("Secondo e cambiato");
    vault
        .host
        .write_document(
            None,
            &lettera(),
            &other.to_json().unwrap(),
            WriteBase::DescendsFrom(revision),
        )
        .expect("si salva per innesto");
    let saved = String::from_utf8(part(&vault.on_disk(), "word/document.xml")).unwrap();
    assert!(saved.contains(closed), "{saved}");
    let (text, _, _) = vault
        .host
        .read_document_with_format(None, &lettera())
        .unwrap();
    let reread = Projection::from_json(&text).unwrap();
    assert_eq!(texts(&reread), ["Chiuso", "Primo", "Secondo e cambiato"]);
}
