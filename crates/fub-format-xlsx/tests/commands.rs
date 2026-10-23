//! La modalità a comandi della superficie (ADR 0219): il catalogo serve un
//! sottoinsieme della facciata di GridCraft, i comandi entrano nel giornale e
//! si rifanno all'apertura, annulla e ripeti sono del documento, l'input delle
//! celle diventa un comando, e il salvataggio sceglie fra innesto e
//! riscrittura misurata.

mod common;

use common::{one_sheet, sheet, Package};
use fub_abi::{
    GridApplyRequest, GridBytesCell, GridBytesProvider, GridBytesSession, GridCellKey,
    GridCellPatch, GridCommand, GridCommandOutcome, GridCommandRequest, GridCommandState,
    GridInvalidation, GridJournal, GridSelection, GridWindowRequest, PluginError, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use gridcraft_core::{CellRef, Value};

const BODY: &str = r#"<dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*10</f><v>10</v></c></row><row r="2"><c r="A2"><v>2</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>tre</t></is></c></row></sheetData>"#;

/// Una regola che il codec di GridCraft non porta: una riscrittura la
/// perderebbe.
const LOSSY: &str = r#"<dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*10</f><v>10</v></c></row><row r="2"><c r="A2"><v>2</v></c></row></sheetData><cellWatches><cellWatch r="A1"/></cellWatches>"#;

fn key(sheet: &str, a1: &str) -> GridCellKey {
    let cell = CellRef::parse(a1).unwrap();
    GridCellKey {
        sheet: sheet.into(),
        row: format!("r{}", cell.row),
        column: format!("c{}", cell.col),
    }
}

fn open(bytes: &[u8], journal: &GridJournal) -> (XlsxGridProvider, GridBytesSession) {
    let mut provider = XlsxGridProvider::new();
    let session = provider
        .open(XLSX_GRID_SURFACE, bytes, Revision::of_bytes(bytes), journal)
        .unwrap();
    (provider, session)
}

fn command(id: &str, params: &str, at: &str) -> GridCommand {
    GridCommand {
        id: id.into(),
        params: params.into(),
        sheet: "s1".into(),
        selection: at.into(),
        active: at.split(':').next().unwrap().into(),
    }
}

fn give(
    provider: &mut XlsxGridProvider,
    instance: &str,
    revision: &Revision,
    command: GridCommand,
) -> Result<GridCommandOutcome, PluginError> {
    provider.command(
        instance,
        GridCommandRequest {
            revision: revision.clone(),
            command,
        },
    )
}

fn cells(
    provider: &mut XlsxGridProvider,
    instance: &str,
    revision: &Revision,
    sheet: &str,
) -> Vec<GridBytesCell> {
    provider
        .window(
            instance,
            GridWindowRequest {
                revision: revision.clone(),
                sheet: sheet.into(),
                row_start: 0,
                row_count: 10,
                column_start: 0,
                column_count: 6,
            },
        )
        .unwrap()
        .cells
}

fn input(cells: &[GridBytesCell], sheet: &str, a1: &str) -> String {
    let key = key(sheet, a1);
    cells
        .iter()
        .find(|cell| cell.key == key)
        .map(|cell| cell.input.clone())
        .unwrap_or_default()
}

fn display(cells: &[GridBytesCell], sheet: &str, a1: &str) -> String {
    let key = key(sheet, a1);
    cells
        .iter()
        .find(|cell| cell.key == key)
        .map(|cell| cell.display.clone())
        .unwrap_or_default()
}

fn apply(
    provider: &mut XlsxGridProvider,
    instance: &str,
    revision: &Revision,
    patches: &[(&str, &str)],
) -> Result<fub_abi::GridCommit, PluginError> {
    provider.apply(
        instance,
        GridApplyRequest {
            revision: revision.clone(),
            patches: patches
                .iter()
                .map(|(a1, after)| GridCellPatch {
                    cell: key("s1", a1),
                    before: None,
                    after: (*after).into(),
                })
                .collect(),
        },
    )
}

fn state<'a>(catalog: &'a [GridCommandState], id: &str) -> Option<&'a GridCommandState> {
    catalog.iter().find(|command| command.id == id)
}

fn journal_of(text: &str) -> GridJournal {
    GridJournal::parse(text).unwrap()
}

/// Il testo del giornale dopo il diff di un commit.
fn after(before: &str, edit: &fub_abi::GridSourceEdit) -> String {
    let (from, to) = (edit.from as usize, edit.to as usize);
    assert_eq!(&before[from..to], edit.deleted);
    format!("{}{}{}", &before[..from], edit.inserted, &before[to..])
}

fn value(bytes: &[u8], sheet: usize, a1: &str) -> Value {
    let read = fub_format_xlsx::read(bytes).unwrap();
    read.workbook.sheets[sheet].value(CellRef::parse(a1).unwrap())
}

fn part(bytes: &[u8], name: &str) -> String {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut text = String::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}

#[test]
fn il_catalogo_serve_un_sottoinsieme_della_facciata() {
    let (_, session) = open(&one_sheet(BODY), &GridJournal::new());
    let catalog = &session.commands;
    assert!(state(catalog, "home.bold").is_some_and(|bold| bold.enabled));
    assert!(state(catalog, "home.insertRows").is_some_and(|insert| insert.enabled));
    assert!(state(catalog, "file.properties").is_some());
    // File, finestre, script, appunti e cronologia della facciata non ci
    // sono.
    for id in [
        "file.open",
        "file.save",
        "automate.runScript",
        "edit.copy",
        "edit.paste",
        "edit.formatPainter",
        "view.newWindow",
        "link.open",
    ] {
        assert!(state(catalog, id).is_none(), "{id}");
    }
    assert!(catalog
        .iter()
        .all(|command| !command.id.starts_with("history.") && !command.id.starts_with("app.")));
    // Annulla e ripeti sono del documento: senza comandi non c'è niente.
    let undo = state(catalog, "edit.undo").unwrap();
    assert!(!undo.enabled && undo.reason.is_some());
    assert!(!state(catalog, "edit.redo").unwrap().enabled);
}

#[test]
fn un_comando_entra_nel_giornale_e_cambia_la_cartella() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let outcome = give(
        &mut provider,
        &session.instance,
        &session.revision,
        command("home.insertRows", "{}", "A1"),
    )
    .unwrap();
    assert_ne!(outcome.commit.revision, session.revision);
    assert_eq!(outcome.commit.invalidation, GridInvalidation::All);
    let journal = journal_of(&outcome.commit.edit.inserted);
    assert_eq!(journal.commands().len(), 1);
    assert_eq!(journal.commands()[0].id, "home.insertRows");
    let shown = cells(
        &mut provider,
        &session.instance,
        &outcome.commit.revision,
        "s1",
    );
    assert_eq!(input(&shown, "s1", "A1"), "");
    assert_eq!(input(&shown, "s1", "A2"), "1");
    assert_eq!(input(&shown, "s1", "B2"), "=A2*10");
    assert!(state(&outcome.commands, "edit.undo").unwrap().enabled);
    assert_eq!(outcome.selection.sheet, "s1");

    // Un comando che non cambia la cartella non entra nel giornale.
    let moved = give(
        &mut provider,
        &session.instance,
        &outcome.commit.revision,
        command("selection.set", r#"{"range":"C3"}"#, "A1"),
    )
    .unwrap();
    assert_eq!(moved.commit.revision, outcome.commit.revision);
    assert!(moved.commit.edit.inserted.is_empty() && moved.commit.edit.deleted.is_empty());
    assert_eq!(moved.selection.active, "C3");
}

#[test]
fn un_giornale_di_comandi_si_rifa_all_apertura() {
    let bytes = one_sheet(BODY);
    let mut journal = GridJournal::new();
    journal
        .push_command(command("home.insertRows", "{}", "A1"))
        .unwrap();
    journal
        .push_command(command("home.bold", r#"{"on":true}"#, "A2"))
        .unwrap();
    let (mut provider, session) = open(&bytes, &journal);
    let shown = cells(&mut provider, &session.instance, &session.revision, "s1");
    assert_eq!(input(&shown, "s1", "A2"), "1");
    assert_eq!(input(&shown, "s1", "A3"), "2");
    // Rifare un comando che non si applica più è un conflitto, non un
    // giornale vuoto.
    let mut journal = GridJournal::new();
    journal
        .push_command(GridCommand {
            sheet: "s9".into(),
            ..command("home.bold", r#"{"on":true}"#, "A1")
        })
        .unwrap();
    let mut provider = XlsxGridProvider::new();
    assert!(matches!(
        provider.open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &journal
        ),
        Err(PluginError::Conflict(_))
    ));
}

#[test]
fn annulla_e_ripeti_sono_del_documento() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let inserted = give(
        &mut provider,
        &session.instance,
        &session.revision,
        command("home.insertRows", "{}", "A1"),
    )
    .unwrap();
    let undone = give(
        &mut provider,
        &session.instance,
        &inserted.commit.revision,
        command("edit.undo", "{}", "A1"),
    )
    .unwrap();
    // Il giornale torna vuoto, e la revisione è quella dei byte soli.
    assert_eq!(undone.commit.revision, session.revision);
    let shown = cells(
        &mut provider,
        &session.instance,
        &undone.commit.revision,
        "s1",
    );
    assert_eq!(input(&shown, "s1", "A1"), "1");
    assert!(!state(&undone.commands, "edit.undo").unwrap().enabled);
    assert!(state(&undone.commands, "edit.redo").unwrap().enabled);

    let redone = give(
        &mut provider,
        &session.instance,
        &undone.commit.revision,
        command("edit.redo", "{}", "A1"),
    )
    .unwrap();
    assert_eq!(redone.commit.revision, inserted.commit.revision);
    let shown = cells(
        &mut provider,
        &session.instance,
        &redone.commit.revision,
        "s1",
    );
    assert_eq!(input(&shown, "s1", "A2"), "1");
    // Un comando nuovo svuota la pila di ripeti.
    let bold = give(
        &mut provider,
        &session.instance,
        &redone.commit.revision,
        command("home.bold", r#"{"on":true}"#, "A2"),
    )
    .unwrap();
    assert!(!state(&bold.commands, "edit.redo").unwrap().enabled);
    assert!(give(
        &mut provider,
        &session.instance,
        &bold.commit.revision,
        command("edit.redo", "{}", "A1"),
    )
    .is_err());
}

#[test]
fn l_input_delle_celle_diventa_un_comando() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    // Prima del primo comando il giornale resta di celle.
    let typed = apply(
        &mut provider,
        &session.instance,
        &session.revision,
        &[("A2", "0.25")],
    )
    .unwrap();
    assert!(journal_of(&typed.edit.inserted).commands().is_empty());
    let bold = give(
        &mut provider,
        &session.instance,
        &typed.revision,
        command("home.bold", r#"{"on":true}"#, "A1"),
    )
    .unwrap();
    let text = after(&typed.edit.inserted, &bold.commit.edit);
    let journal = journal_of(&text);
    let ids: Vec<&str> = journal.commands().iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["range.setValues", "home.bold"]);
    assert_eq!(
        journal.commands()[0].params,
        r#"{"range":"A2","values":[[0.25]]}"#
    );

    // Dopo, ogni input è un comando, con la regola di Fub: un testo che
    // sembra un numero resta testo, e una formula si scrive.
    let typed = apply(
        &mut provider,
        &session.instance,
        &bold.commit.revision,
        &[("A3", "12"), ("C1", "'12"), ("C2", "=A1+A2")],
    )
    .unwrap();
    assert_eq!(typed.invalidation, GridInvalidation::All);
    let shown = cells(&mut provider, &session.instance, &typed.revision, "s1");
    assert_eq!(input(&shown, "s1", "A3"), "12");
    assert_eq!(input(&shown, "s1", "C1"), "'12");
    assert_eq!(input(&shown, "s1", "C2"), "=A1+A2");
    assert_eq!(display(&shown, "s1", "C2"), "1.25");
    // La dipendente si ricalcola con la facciata.
    let changed = apply(
        &mut provider,
        &session.instance,
        &typed.revision,
        &[("A1", "3")],
    )
    .unwrap();
    let shown = cells(&mut provider, &session.instance, &changed.revision, "s1");
    assert_eq!(display(&shown, "s1", "B1"), "30");

    // Un gruppo che non riesce lascia la sessione com'era.
    assert!(apply(
        &mut provider,
        &session.instance,
        &changed.revision,
        &[("A1", "4"), ("C3", "=SUM(")],
    )
    .is_err());
    let shown = cells(&mut provider, &session.instance, &changed.revision, "s1");
    assert_eq!(input(&shown, "s1", "A1"), "3");
}

#[test]
fn i_comandi_che_fub_non_serve_si_rifiutano() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    for refused in [
        command("edit.copy", "{}", "A1"),
        command("file.open", "{}", "A1"),
        command("automate.runScript", "{}", "A1"),
        command("edit.undo", "{}", "A1"),
        command("non.esiste", "{}", "A1"),
        command("home.insertPicture", r#"{"path":"/etc/passwd"}"#, "A1"),
        command("home.bold", "[1]", "A1"),
    ] {
        let id = refused.id.clone();
        assert!(
            matches!(
                give(&mut provider, &session.instance, &session.revision, refused),
                Err(PluginError::BadArgs(_))
            ),
            "{id}"
        );
    }
    // La sessione è rimasta quella dei byte.
    let shown = cells(&mut provider, &session.instance, &session.revision, "s1");
    assert_eq!(input(&shown, "s1", "A1"), "1");
}

#[test]
fn salvare_innesta_l_input_e_riscrive_il_resto() {
    let bytes = one_sheet(BODY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let bold = give(
        &mut provider,
        &session.instance,
        &session.revision,
        command("home.bold", r#"{"on":true}"#, "A1"),
    )
    .unwrap();
    let undone = give(
        &mut provider,
        &session.instance,
        &bold.commit.revision,
        command("edit.undo", "{}", "A1"),
    )
    .unwrap();
    // In modalità a comandi con il giornale vuoto si scrivono i byte del
    // file.
    assert_eq!(
        provider
            .bytes_to_write(&session.instance, undone.commit.revision.clone())
            .unwrap(),
        bytes
    );
    // Soltanto input: è un innesto, che non tocca gli stili.
    let typed = apply(
        &mut provider,
        &session.instance,
        &undone.commit.revision,
        &[("A2", "5")],
    )
    .unwrap();
    let grafted = provider
        .bytes_to_write(&session.instance, typed.revision.clone())
        .unwrap();
    assert_eq!(value(&grafted, 0, "A2"), Value::Number(5.0));
    assert_eq!(
        part(&grafted, "xl/styles.xml"),
        part(&bytes, "xl/styles.xml")
    );

    // Un comando che cambia altro: la cartella si riscrive con il codec.
    let inserted = give(
        &mut provider,
        &session.instance,
        &typed.revision,
        command("home.insertRows", "{}", "A1"),
    )
    .unwrap();
    let rewritten = provider
        .bytes_to_write(&session.instance, inserted.commit.revision.clone())
        .unwrap();
    assert_eq!(value(&rewritten, 0, "A1"), Value::Empty);
    assert_eq!(value(&rewritten, 0, "A2"), Value::Number(1.0));
    assert_eq!(value(&rewritten, 0, "A3"), Value::Number(5.0));
    assert_eq!(value(&rewritten, 0, "B2"), Value::Number(10.0));

    // L'host salva aprendo un'istanza nuova con lo stesso giornale.
    let text = [&bold.commit, &undone.commit]
        .into_iter()
        .map(|commit| &commit.edit)
        .chain([&typed.edit, &inserted.commit.edit])
        .fold(String::new(), |text, edit| after(&text, edit));
    let journal = journal_of(&text);
    let (mut again, reopened) = open(&bytes, &journal);
    assert_eq!(reopened.revision, inserted.commit.revision);
    assert_eq!(
        again
            .bytes_to_write(&reopened.instance, reopened.revision.clone())
            .unwrap(),
        rewritten
    );
}

#[test]
fn una_cartella_che_la_riscrittura_perderebbe_prende_soltanto_l_input() {
    let bytes = one_sheet(LOSSY);
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let catalog = provider
        .commands(
            &session.instance,
            GridSelection {
                sheet: "s1".into(),
                selection: "A1".into(),
                active: "A1".into(),
            },
        )
        .unwrap();
    let bold = state(&catalog, "home.bold").unwrap();
    assert!(!bold.enabled);
    assert!(bold.reason.as_deref().unwrap().contains("cellWatches"));
    assert!(state(&catalog, "range.setValues").unwrap().enabled);
    assert!(state(&catalog, "selection.set").unwrap().enabled);
    assert!(matches!(
        give(
            &mut provider,
            &session.instance,
            &session.revision,
            command("home.bold", r#"{"on":true}"#, "A1"),
        ),
        Err(PluginError::PermissionDenied(_))
    ));

    // L'input entra, e il salvataggio è un innesto che tiene la regola.
    let input = give(
        &mut provider,
        &session.instance,
        &session.revision,
        command("range.setValues", r#"{"range":"A2","values":[[7]]}"#, "A2"),
    )
    .unwrap();
    // Un testo su due righe chiede lo stile che va a capo, che l'innesto
    // non scrive.
    assert!(matches!(
        apply(
            &mut provider,
            &session.instance,
            &input.commit.revision,
            &[("C1", "due\nrighe")],
        ),
        Err(PluginError::PermissionDenied(_))
    ));
    // Una formula non si innesta.
    assert!(matches!(
        apply(
            &mut provider,
            &session.instance,
            &input.commit.revision,
            &[("C1", "=A1")],
        ),
        Err(PluginError::BadArgs(_))
    ));
    let saved = provider
        .bytes_to_write(&session.instance, input.commit.revision.clone())
        .unwrap();
    assert_eq!(value(&saved, 0, "A2"), Value::Number(7.0));
    assert!(part(&saved, "xl/worksheets/sheet1.xml").contains("cellWatch"));

    // Un giornale che chiede una riscrittura non si salva: il file resta.
    let mut journal = GridJournal::new();
    journal
        .push_command(command("home.bold", r#"{"on":true}"#, "A1"))
        .unwrap();
    let (mut again, reopened) = open(&bytes, &journal);
    assert!(matches!(
        again.bytes_to_write(&reopened.instance, reopened.revision.clone()),
        Err(PluginError::PermissionDenied(_))
    ));
}

#[test]
fn i_fogli_nuovi_hanno_id_che_il_giornale_ritrova() {
    let bytes = Package {
        sheets: vec![sheet("Uno", BODY), sheet("Due", BODY)],
        ..Package::default()
    }
    .bytes();
    let (mut provider, session) = open(&bytes, &GridJournal::new());
    let ids: Vec<&str> = session.sheets.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["s1", "s2"]);
    let deleted = give(
        &mut provider,
        &session.instance,
        &session.revision,
        GridCommand {
            sheet: "s2".into(),
            ..command("home.deleteSheet", "{}", "A1")
        },
    )
    .unwrap();
    let ids: Vec<&str> = deleted.sheets.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["s1"]);
    // Il foglio nuovo non riprende l'id di quello cancellato.
    let inserted = give(
        &mut provider,
        &session.instance,
        &deleted.commit.revision,
        command("home.insertSheet", r#"{"name":"Tre"}"#, "A1"),
    )
    .unwrap();
    let new: Vec<&str> = inserted
        .sheets
        .iter()
        .map(|s| s.id.as_str())
        .filter(|id| *id != "s1")
        .collect();
    assert_eq!(new, ["s3"]);
    let named = give(
        &mut provider,
        &session.instance,
        &inserted.commit.revision,
        GridCommand {
            sheet: "s3".into(),
            ..command("range.setValues", r#"{"range":"B2","values":[[42]]}"#, "B2")
        },
    )
    .unwrap();

    // Rifatto dall'inizio, il giornale ritrova lo stesso foglio.
    let text = [&deleted, &inserted, &named]
        .into_iter()
        .fold(String::new(), |text, outcome| {
            after(&text, &outcome.commit.edit)
        });
    let journal = journal_of(&text);
    assert_eq!(journal.commands().len(), 3);
    let (mut again, reopened) = open(&bytes, &journal);
    assert_eq!(reopened.revision, named.commit.revision);
    let shown = cells(&mut again, &reopened.instance, &reopened.revision, "s3");
    assert_eq!(input(&shown, "s3", "B2"), "42");
    let saved = again
        .bytes_to_write(&reopened.instance, reopened.revision.clone())
        .unwrap();
    let workbook = part(&saved, "xl/workbook.xml");
    assert!(workbook.contains(r#"name="Tre" sheetId="3""#), "{workbook}");
}

/// Con `FUB_SOFFICE`, il percorso di `soffice`: una cartella scritta da
/// LibreOffice prende una riga in più e un grassetto, si riscrive, e
/// LibreOffice la rilegge con le righe spostate e la formula che segue. Senza
/// `FUB_SOFFICE` non fa niente: la CI principale non ha LibreOffice.
#[test]
fn libreoffice_rilegge_la_cartella_riscritta() {
    let Some(program) = std::env::var_os("FUB_SOFFICE") else {
        return;
    };
    let dir = std::env::temp_dir().join(format!("fub-xlsx-comandi-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("prima.fods"),
        include_str!("fixtures/libreoffice.fods"),
    )
    .unwrap();
    common::soffice(&program, &dir, "xlsx", &[dir.join("prima.fods")]);
    let original = std::fs::read(dir.join("prima.xlsx")).unwrap();
    let (mut provider, session) = open(&original, &GridJournal::new());
    let sheet = session.sheets[0].id.clone();
    let at = |id: &str, params: &str, a1: &str| GridCommand {
        sheet: sheet.clone(),
        ..command(id, params, a1)
    };
    let inserted = give(
        &mut provider,
        &session.instance,
        &session.revision,
        at("home.insertRows", "{}", "A1"),
    )
    .unwrap();
    let bold = give(
        &mut provider,
        &session.instance,
        &inserted.commit.revision,
        at("home.bold", r#"{"on":true}"#, "A2"),
    )
    .unwrap();
    let typed = give(
        &mut provider,
        &session.instance,
        &bold.commit.revision,
        at(
            "range.setValues",
            r#"{"range":"A1","values":[["'testa"]]}"#,
            "A1",
        ),
    )
    .unwrap();
    let saved = provider
        .bytes_to_write(&session.instance, typed.commit.revision.clone())
        .unwrap();
    std::fs::write(dir.join("dopo.xlsx"), &saved).unwrap();
    common::soffice(
        &program,
        &dir,
        "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1",
        &[dir.join("dopo.xlsx")],
    );
    let csv = |name: &str| {
        std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|error| panic!("LibreOffice non ha scritto {name}: {error}"))
    };
    let (data, other) = (csv("dopo-Dati.csv"), csv("dopo-Altro.csv"));
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(data, "testa,,\n1,uno,unita\n2,due,\n3,30,\n");
    assert_eq!(other, "101,fermo\n");
}
