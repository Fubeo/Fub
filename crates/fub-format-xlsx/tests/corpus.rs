//! Il corpus della conservazione: per ogni cartella, che cosa Fub ne fa.
//!
//! Le classi sono quelle che la superficie promette (ADR 0219):
//!
//! - **modificabile**: i comandi che cambiano la cartella si servono, e il
//!   salvataggio la riscrive con il codec senza perdere niente di ciò che
//!   l'inventario conta;
//! - **preservabile**: la riscrittura perderebbe qualcosa, quindi i comandi
//!   che la chiedono si rifiutano; l'input delle celle entra con un innesto,
//!   che lascia ogni altra parte del pacchetto nei suoi byte;
//! - **rifiutata**: la cartella non si apre (cifrata, illeggibile), e niente
//!   si scrive.
//!
//! La quarta classe, la **perdita dichiarata**, non è di una cartella ma di un
//! segno: le `NORMALIZATIONS` dell'inventario (la catena di calcolo, la
//! dimensione, il percorso del salvataggio…) sono ciò che una riscrittura può
//! non portare, ciascuno con la sua ragione. Qui se ne prova una, la catena di
//! calcolo.
//!
//! Per ogni cartella che si modifica il corpus prova anche che il salvataggio
//! è deterministico (due sessioni con lo stesso giornale scrivono gli stessi
//! byte) e un punto fisso (rifare lo stesso comando sui byte scritti li
//! lascia identici), e che un innesto non tocca le parti che non deve.
//!
//! Con `FUB_XLSX_CORPUS=<cartella>` il test `corpus_esterno` classifica ogni
//! `.xlsx`/`.xlsm` della cartella e stampa la tabella: è la prova da rifare
//! dopo un aggiornamento di `vendor/gridcraft` (vedi `UPSTREAM.md`). Con
//! `FUB_CORPUS_DUMP=<cartella>` le voci che un secondo salvataggio cambia si
//! scrivono lì, nelle due versioni, per guardarle.

mod common;

use std::collections::BTreeMap;
use std::io::{Cursor, Read};

use common::{encrypted, one_sheet, sheet, Package};
use fub_abi::{
    GridBytesProvider, GridCommand, GridCommandRequest, GridJournal, GridSelection, PluginError,
    Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};

const PLAIN: &str = r#"<dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*10</f><v>10</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>due</t></is></c></row></sheetData>"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Class {
    Modificabile,
    Preservabile,
    /// Si apre, ma né i comandi né l'input la cambiano.
    SolaLettura,
    Rifiutata,
}

/// Che cosa Fub fa della cartella, con il perché quando non la modifica.
struct Verdict {
    class: Class,
    why: String,
}

fn command(id: &str, params: &str, sheet: &str, at: &str) -> GridCommand {
    GridCommand {
        id: id.into(),
        params: params.into(),
        sheet: sheet.into(),
        selection: at.into(),
        active: at.into(),
    }
}

fn open(
    bytes: &[u8],
    journal: &GridJournal,
) -> Result<(XlsxGridProvider, fub_abi::GridBytesSession), PluginError> {
    let mut provider = XlsxGridProvider::new();
    let session = provider.open(XLSX_GRID_SURFACE, bytes, Revision::of_bytes(bytes), journal)?;
    Ok((provider, session))
}

/// La cella su cui il corpus prova i comandi: una lontana dai dati, perché
/// non cada in una cella bloccata o in una tabella.
const PROBE: &str = "XFA1048000";

/// Classifica la cartella attraverso la superficie, come la shell: il
/// catalogo dice che cosa si offre, l'esecuzione che cosa si fa davvero. Un
/// comando offerto e poi rifiutato (un foglio protetto: GridCraft lo controlla
/// soltanto all'esecuzione) conta come rifiutato, con il perché dell'errore.
fn classify(bytes: &[u8]) -> Verdict {
    let (mut provider, session) = match open(bytes, &GridJournal::new()) {
        Ok(opened) => opened,
        Err(error) => {
            return Verdict {
                class: Class::Rifiutata,
                why: format!("{error:?}"),
            }
        }
    };
    let sheet = session.active.clone();
    let catalog = provider
        .commands(
            &session.instance,
            GridSelection {
                sheet: sheet.clone(),
                selection: PROBE.into(),
                active: PROBE.into(),
            },
        )
        .unwrap();
    let mut run = |command: GridCommand| -> Result<(), String> {
        let offered = catalog.iter().find(|state| state.id == command.id);
        match offered {
            Some(state) if state.enabled => {}
            Some(state) => return Err(state.reason.clone().unwrap_or_default()),
            None => return Err(format!("{} is not served", command.id)),
        }
        provider
            .command(
                &session.instance,
                GridCommandRequest {
                    revision: session.revision.clone(),
                    command,
                },
            )
            .map(|_| ())
            .map_err(|error| format!("offered, then refused: {error:?}"))
    };
    let why = match run(command("home.bold", r#"{"on":true}"#, &sheet, PROBE)) {
        Ok(()) => {
            return Verdict {
                class: Class::Modificabile,
                why: String::new(),
            }
        }
        Err(why) => why,
    };
    match run(set_value(&sheet, PROBE)) {
        Ok(()) => Verdict {
            class: Class::Preservabile,
            why,
        },
        Err(input) => Verdict {
            class: Class::SolaLettura,
            why: format!("{why}; input: {input}"),
        },
    }
}

fn set_value(sheet: &str, at: &str) -> GridCommand {
    command(
        "range.setValues",
        &format!(r#"{{"range":"{at}","values":[[7]]}}"#),
        sheet,
        at,
    )
}

fn first_sheet(bytes: &[u8]) -> String {
    open(bytes, &GridJournal::new()).unwrap().1.active
}

/// I byte che una sessione nuova su `bytes` scrive con `commands` nel giornale.
fn saved(bytes: &[u8], commands: &[GridCommand]) -> Result<Vec<u8>, PluginError> {
    let mut journal = GridJournal::new();
    for command in commands {
        journal.push_command(command.clone()).unwrap();
    }
    let (mut provider, session) = open(bytes, &journal)?;
    provider.bytes_to_write(&session.instance, session.revision.clone())
}

/// Le voci dello zip, con i loro byte.
fn entries(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..archive.len())
        .map(|index| {
            let mut entry = archive.by_index(index).unwrap();
            let mut content = Vec::new();
            entry.read_to_end(&mut content).unwrap();
            (entry.name().unwrap().into_owned(), content)
        })
        .collect()
}

/// Le prove di una cartella modificabile: un comando si salva, il salvataggio
/// è deterministico, e aprire e salvare di nuovo non cambia niente: due
/// comandi in due sessioni, una sui byte dell'altra, scrivono gli stessi byte
/// dei due comandi in una sessione sola.
fn check_rewrite(name: &str, bytes: &[u8]) -> Result<(), String> {
    let sheet = first_sheet(bytes);
    let first = command("home.bold", r#"{"on":true}"#, &sheet, PROBE);
    let second = command("home.italic", r#"{"on":true}"#, &sheet, PROBE);
    let save = |bytes: &[u8], commands: &[GridCommand]| {
        saved(bytes, commands).map_err(|error| format!("{name}: save: {error:?}"))
    };
    let once = save(bytes, std::slice::from_ref(&first))?;
    if save(bytes, std::slice::from_ref(&first))? != once {
        return Err(format!("{name}: two sessions wrote different bytes"));
    }
    match classify(&once).class {
        Class::Modificabile => {}
        other => return Err(format!("{name}: the rewrite reopens as {other:?}")),
    }
    let chained = save(&once, std::slice::from_ref(&second))?;
    let together = save(bytes, &[first, second])?;
    let (chained, together) = (entries(&chained), entries(&together));
    if chained != together {
        let changed: Vec<_> = together
            .keys()
            .chain(chained.keys())
            .filter(|key| together.get(*key) != chained.get(*key))
            .collect();
        if let Some(dir) = std::env::var_os("FUB_CORPUS_DUMP") {
            let dir = std::path::Path::new(&dir).join(name);
            for key in &changed {
                let file = key.replace('/', "_");
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::write(dir.join(format!("{file}.insieme")), &together[*key]);
                let _ = std::fs::write(dir.join(format!("{file}.in-due")), &chained[*key]);
            }
        }
        return Err(format!(
            "{name}: saving again changes the workbook: {changed:?}"
        ));
    }
    Ok(())
}

/// Le prove di una cartella preservabile: l'input si salva con un innesto, e
/// le voci che non sono il foglio scritto restano i loro byte.
fn check_graft(name: &str, bytes: &[u8]) -> Result<(), String> {
    let sheet = first_sheet(bytes);
    let input = [set_value(&sheet, PROBE)];
    let written = saved(bytes, &input).map_err(|error| format!("{name}: graft: {error:?}"))?;
    if saved(bytes, &input).map_err(|error| format!("{name}: graft: {error:?}"))? != written {
        return Err(format!("{name}: two grafts wrote different bytes"));
    }
    let (before, after) = (entries(bytes), entries(&written));
    if before.keys().ne(after.keys()) {
        return Err(format!("{name}: the graft changed the list of parts"));
    }
    let changed: Vec<_> = before
        .iter()
        .filter(|(key, content)| after.get(*key) != Some(content))
        .map(|(key, _)| key.as_str())
        .collect();
    if changed.len() != 1 || !changed[0].starts_with("xl/worksheets/") {
        return Err(format!("{name}: the graft touched {changed:?}"));
    }
    // Un giornale che chiede una riscrittura non si salva.
    let bold = [command("home.bold", r#"{"on":true}"#, &sheet, PROBE)];
    match saved(bytes, &bold) {
        Err(PluginError::PermissionDenied(_)) => Ok(()),
        other => Err(format!(
            "{name}: a rewrite of a preservable workbook gave {:?}",
            other.map(|bytes| bytes.len())
        )),
    }
}

fn check(name: &str, bytes: &[u8]) -> Result<Verdict, String> {
    let verdict = classify(bytes);
    match verdict.class {
        Class::Modificabile => check_rewrite(name, bytes)?,
        Class::Preservabile => check_graft(name, bytes)?,
        Class::SolaLettura | Class::Rifiutata => {}
    }
    Ok(verdict)
}

const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn xml(body: &str) -> Vec<u8> {
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>{body}"#).into_bytes()
}

/// Le cartelle scritte a mano, ciascuna con la classe che deve avere.
fn synthetic() -> Vec<(&'static str, Vec<u8>, Class)> {
    let macros = Package {
        sheets: vec![sheet("Foglio1", PLAIN)],
        workbook_rels: vec![(
            "rVba",
            "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
            "vbaProject.bin",
        )],
        parts: vec![(
            "xl/vbaProject.bin",
            "application/vnd.ms-office.vbaProject",
            b"\xd0\xcf\x11\xe0VBA-di-prova".repeat(8),
        )],
        main_type: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        ..Package::default()
    }
    .bytes();
    let external = Package {
        sheets: vec![sheet(
            "Foglio1",
            r#"<sheetData><row r="1"><c r="A1"><f>[1]Altro!A1</f><v>7</v></c></row></sheetData>"#,
        )],
        workbook_tail: r#"<externalReferences><externalReference r:id="rExt"/></externalReferences>"#,
        workbook_rels: vec![("rExt", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink", "externalLinks/externalLink1.xml")],
        parts: vec![
            (
                "xl/externalLinks/externalLink1.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml",
                xml(&format!(r#"<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{R}"><externalBook r:id="rId1"><sheetNames><sheetName val="Altro"/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>7</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>"#)),
            ),
            (
                "xl/externalLinks/_rels/externalLink1.xml.rels",
                "application/vnd.openxmlformats-package.relationships+xml",
                xml(&format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/externalLinkPath" Target="altro.xlsx" TargetMode="External"/></Relationships>"#)),
            ),
        ],
        ..Package::default()
    }
    .bytes();
    let names = Package {
        sheets: vec![sheet("Foglio1", PLAIN)],
        workbook_tail: r#"<definedNames><definedName name="Totale">Foglio1!$A$1:$A$2</definedName><definedName name="Locale" localSheetId="0">Foglio1!$B$1</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Foglio1!$A$1:$B$2</definedName></definedNames>"#,
        ..Package::default()
    }
    .bytes();
    let calc_chain = Package {
        sheets: vec![sheet("Foglio1", PLAIN)],
        workbook_rels: vec![("rCalc", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain", "calcChain.xml")],
        parts: vec![(
            "xl/calcChain.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml",
            xml(r#"<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B1" i="1"/></calcChain>"#),
        )],
        ..Package::default()
    }
    .bytes();
    // Le viste e le estensioni di una cartella di LibreOffice, che il
    // modello di GridCraft non ha (patch `0008`).
    let libreoffice = Package {
        sheets: vec![sheet(
            "Foglio1",
            r#"<sheetViews><sheetView showOutlineSymbols="0" showRuler="0" zoomScale="120" zoomScaleNormal="120" zoomScalePageLayoutView="85" workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>"#,
        )],
        workbook_tail: r#"<extLst><ext xmlns:loext="http://schemas.libreoffice.org/" uri="{7626C862-2A13-11E5-B345-FEFF819CDC9F}"><loext:extCalcPr stringRefSyntax="CalcA1ExcelA1"/></ext></extLst>"#,
        ..Package::default()
    }
    .bytes();
    vec![
        ("semplice", one_sheet(PLAIN), Class::Modificabile),
        ("viste-di-libreoffice", libreoffice, Class::Modificabile),
        ("macro", macros, Class::Modificabile),
        ("collegamento-esterno", external, Class::Modificabile),
        ("nomi-definiti", names, Class::Modificabile),
        ("catena-di-calcolo", calc_chain, Class::Modificabile),
        (
            "convalida-e-formattazione",
            one_sheet(
                r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><conditionalFormatting sqref="A1:A9"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="whole" allowBlank="1" sqref="A1:A9"><formula1>0</formula1><formula2>9</formula2></dataValidation></dataValidations>"#,
            ),
            Class::Modificabile,
        ),
        (
            "foglio-protetto",
            one_sheet(
                r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/>"#,
            ),
            Class::SolaLettura,
        ),
        (
            "osservazioni-di-cella",
            one_sheet(
                r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><cellWatches><cellWatch r="A1"/></cellWatches>"#,
            ),
            Class::Preservabile,
        ),
        ("cifrata", encrypted(), Class::Rifiutata),
        (
            "non-uno-zip",
            b"PK\x03\x04 non uno zip".to_vec(),
            Class::Rifiutata,
        ),
    ]
}

#[test]
fn ogni_cartella_del_corpus_ha_la_sua_classe() {
    let mut failures = Vec::new();
    for (name, bytes, expected) in synthetic() {
        match check(name, &bytes) {
            Ok(verdict) if verdict.class == expected => {}
            Ok(verdict) => failures.push(format!(
                "{name}: {:?} instead of {expected:?} ({})",
                verdict.class, verdict.why
            )),
            Err(error) => failures.push(error),
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// La perdita dichiarata: la riscrittura non porta la catena di calcolo, che
/// Excel ricostruisce; tutto il resto resta.
#[test]
fn la_catena_di_calcolo_e_una_perdita_dichiarata() {
    let (_, bytes, _) = synthetic()
        .into_iter()
        .find(|(name, ..)| *name == "catena-di-calcolo")
        .unwrap();
    let sheet = first_sheet(&bytes);
    let written = saved(
        &bytes,
        &[command("home.bold", r#"{"on":true}"#, &sheet, PROBE)],
    )
    .unwrap();
    let parts = entries(&written);
    assert!(
        !parts.contains_key("xl/calcChain.xml"),
        "{:?}",
        parts.keys()
    );
    let read = fub_format_xlsx::read(&written).unwrap();
    let cell = gridcraft_core::CellRef::parse("B1").unwrap();
    assert_eq!(
        read.workbook.sheets[0].value(cell),
        gridcraft_core::Value::Number(10.0)
    );
}

/// Il corpus esterno: `FUB_XLSX_CORPUS=<cartella>`. Stampa la classe di ogni
/// file e fallisce soltanto se una prova della sua classe fallisce.
#[test]
fn corpus_esterno() {
    let Some(dir) = std::env::var_os("FUB_XLSX_CORPUS") else {
        return;
    };
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|ext| {
                ext.eq_ignore_ascii_case("xlsx") || ext.eq_ignore_ascii_case("xlsm")
            })
        })
        .collect();
    files.sort();
    let mut counts: BTreeMap<Class, usize> = BTreeMap::new();
    let mut failures = Vec::new();
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let bytes = std::fs::read(&path).unwrap();
        match check(&name, &bytes) {
            Ok(verdict) => {
                *counts.entry(verdict.class).or_default() += 1;
                let mut why = verdict.why;
                why.truncate(140);
                println!("{:<14} {name}  {why}", format!("{:?}", verdict.class));
            }
            Err(error) => {
                println!("{:<14} {name}  {error}", "ERRORE");
                failures.push(error);
            }
        }
    }
    println!("{counts:?}");
    assert!(failures.is_empty(), "{failures:#?}");
}
