//! La cronologia della cartella (IMP-035, IMP-036): annulla e ripeti del
//! documento percorrono la stessa pila per celle e comandi, anche dopo che il
//! salvataggio ha messo il giornale nei byte, e il salvataggio seguente
//! scrive l'annulla sul disco.
//!
//! [`Documento`] fa ciò che fanno l'host e la griglia: il giornale è il testo
//! della sessione del documento, salvare apre un'altra istanza sui byte con il
//! giornale e scrive i byte che dà, e la griglia poi si riapre sui byte nuovi
//! con il giornale vuoto.

mod common;

use common::one_sheet;
use fub_abi::{
    GridApplyRequest, GridBytesProvider, GridCellKey, GridCellPatch, GridCommand,
    GridCommandRequest, GridJournal, GridWindowRequest, PluginError, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use gridcraft_core::{CellRef, Value};

/// A1:B3 con numeri e testi da ordinare, e una formula che li legge.
const BODY: &str = r#"<dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1"><v>3</v></c><c r="B1" t="inlineStr"><is><t>tre</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>uno</t></is></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3" t="inlineStr"><is><t>due</t></is></c></row><row r="5"><c r="C5"><f>SUM(A1:A3)</f><v>6</v></c></row></sheetData>"#;

/// Una regola che il codec di GridCraft non porta: una riscrittura la
/// perderebbe, e i comandi della barra sono spenti.
const LOSSY: &str = r#"<dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row></sheetData><cellWatches><cellWatch r="A1"/></cellWatches>"#;

fn key(a1: &str) -> GridCellKey {
    let cell = CellRef::parse(a1).unwrap();
    GridCellKey {
        sheet: "s1".into(),
        row: format!("r{}", cell.row),
        column: format!("c{}", cell.col),
    }
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

/// Il documento: i byte sul disco, il giornale della sessione e l'istanza
/// della griglia, sullo stesso provider.
struct Documento {
    provider: XlsxGridProvider,
    disk: Vec<u8>,
    journal: String,
    instance: String,
    revision: Revision,
}

impl Documento {
    fn new(bytes: Vec<u8>) -> Documento {
        let mut provider = XlsxGridProvider::new();
        let session = provider
            .open(
                XLSX_GRID_SURFACE,
                &bytes,
                Revision::of_bytes(&bytes),
                &GridJournal::new(),
            )
            .unwrap();
        Documento {
            provider,
            disk: bytes,
            journal: String::new(),
            instance: session.instance,
            revision: session.revision,
        }
    }

    fn take(&mut self, commit: fub_abi::GridCommit) {
        let edit = commit.edit;
        let (from, to) = (edit.from as usize, edit.to as usize);
        assert_eq!(&self.journal[from..to], edit.deleted);
        self.journal = format!(
            "{}{}{}",
            &self.journal[..from],
            edit.inserted,
            &self.journal[to..]
        );
        self.revision = commit.revision;
    }

    fn write(&mut self, a1: &str, after: &str) {
        let commit = self
            .provider
            .apply(
                &self.instance,
                GridApplyRequest {
                    revision: self.revision.clone(),
                    patches: vec![GridCellPatch {
                        cell: key(a1),
                        before: None,
                        after: after.into(),
                    }],
                },
            )
            .unwrap();
        self.take(commit);
    }

    fn try_give(&mut self, command: GridCommand) -> Result<(), PluginError> {
        let outcome = self.provider.command(
            &self.instance,
            GridCommandRequest {
                revision: self.revision.clone(),
                command,
            },
        )?;
        self.take(outcome.commit);
        Ok(())
    }

    fn give(&mut self, id: &str, params: &str, at: &str) {
        self.try_give(command(id, params, at)).unwrap();
    }

    fn undo(&mut self) {
        self.try_give(command("edit.undo", "{}", "A1")).unwrap();
    }

    fn redo(&mut self) {
        self.try_give(command("edit.redo", "{}", "A1")).unwrap();
    }

    fn enabled(&mut self, id: &str) -> bool {
        let selection = fub_abi::GridSelection {
            sheet: "s1".into(),
            selection: "A1".into(),
            active: "A1".into(),
        };
        self.provider
            .commands(&self.instance, selection)
            .unwrap()
            .into_iter()
            .any(|state| state.id == id && state.enabled)
    }

    /// Salva come l'host, poi riapre la griglia sui byte nuovi come il
    /// riquadro.
    fn save(&mut self) {
        let journal = GridJournal::parse(&self.journal).unwrap();
        let base = Revision::of_bytes(&self.disk);
        let writer = self
            .provider
            .open(XLSX_GRID_SURFACE, &self.disk, base.clone(), &journal)
            .unwrap();
        assert_eq!(writer.revision, self.revision);
        let bytes = self
            .provider
            .bytes_to_write(&writer.instance, writer.revision)
            .unwrap();
        self.provider.close(&writer.instance).unwrap();
        self.disk = bytes;
        self.reopen(&GridJournal::new());
    }

    /// Chiude la griglia e la riapre sui byte del disco con `journal`.
    fn reopen(&mut self, journal: &GridJournal) {
        self.provider.close(&self.instance).unwrap();
        let session = self
            .provider
            .open(
                XLSX_GRID_SURFACE,
                &self.disk,
                Revision::of_bytes(&self.disk),
                journal,
            )
            .unwrap();
        self.journal = journal.to_text();
        self.instance = session.instance;
        self.revision = session.revision;
    }

    fn shown(&mut self, a1: &str) -> String {
        let window = self
            .provider
            .window(
                &self.instance,
                GridWindowRequest {
                    revision: self.revision.clone(),
                    sheet: "s1".into(),
                    row_start: 0,
                    row_count: 10,
                    column_start: 0,
                    column_count: 6,
                    known_media: Vec::new(),
                },
            )
            .unwrap();
        let key = key(a1);
        window
            .cells
            .into_iter()
            .find(|cell| cell.key == key)
            .map(|cell| cell.input)
            .unwrap_or_default()
    }

    fn disk_value(&self, a1: &str) -> Value {
        let read = fub_format_xlsx::read(&self.disk).unwrap();
        read.workbook.sheets[0].value(CellRef::parse(a1).unwrap())
    }

    fn disk_column(&self) -> Vec<Value> {
        ["A1", "A2", "A3"]
            .iter()
            .map(|a1| self.disk_value(a1))
            .collect()
    }

    fn disk_bold(&self, a1: &str) -> bool {
        let read = fub_format_xlsx::read(&self.disk).unwrap();
        let sheet = &read.workbook.sheets[0];
        let style = sheet.style_id(CellRef::parse(a1).unwrap());
        read.workbook.styles.get(style).font.bold
    }

    fn disk_format(&self, a1: &str) -> String {
        let read = fub_format_xlsx::read(&self.disk).unwrap();
        let sheet = &read.workbook.sheets[0];
        let style = sheet.style_id(CellRef::parse(a1).unwrap());
        read.workbook.styles.get(style).num_fmt.as_str().to_owned()
    }
}

fn numbers(values: &[f64]) -> Vec<Value> {
    values.iter().map(|&n| Value::Number(n)).collect()
}

#[test]
fn elimina_righe_si_annulla_dopo_il_salvataggio_anche_sul_disco() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("home.deleteRows", "{}", "A2");
    doc.save();
    assert_eq!(
        doc.disk_column(),
        [Value::Number(3.0), Value::Number(2.0), Value::Empty]
    );
    assert!(doc.journal.is_empty());

    assert!(doc.enabled("edit.undo"));
    doc.undo();
    assert_eq!(doc.shown("A2"), "1");
    assert_eq!(doc.shown("B2"), "uno");
    doc.save();
    assert_eq!(doc.disk_column(), numbers(&[3.0, 1.0, 2.0]));
    assert_eq!(doc.disk_value("B2"), Value::Text("uno".into()));

    // E si ripete, anche quella oltre il salvataggio.
    assert!(doc.enabled("edit.redo"));
    doc.redo();
    doc.save();
    assert_eq!(
        doc.disk_column(),
        [Value::Number(3.0), Value::Number(2.0), Value::Empty]
    );
}

#[test]
fn ordinare_si_annulla_dopo_il_salvataggio() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("data.sortAscending", "{}", "A1:B3");
    doc.save();
    assert_eq!(doc.disk_column(), numbers(&[1.0, 2.0, 3.0]));
    doc.undo();
    assert_eq!(doc.shown("A1"), "3");
    doc.save();
    assert_eq!(doc.disk_column(), numbers(&[3.0, 1.0, 2.0]));
    assert_eq!(doc.disk_value("B1"), Value::Text("tre".into()));
}

#[test]
fn grassetto_e_formato_si_annullano_dopo_il_salvataggio() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("home.bold", r#"{"on":true}"#, "A1");
    doc.save();
    doc.give("home.numberFormat", r#"{"code":"0.00%"}"#, "A2");
    doc.save();
    assert!(doc.disk_bold("A1"));
    assert_eq!(doc.disk_format("A2"), "0.00%");

    doc.undo();
    doc.save();
    assert!(doc.disk_bold("A1"));
    assert_eq!(doc.disk_format("A2"), "General");
    doc.undo();
    doc.save();
    assert!(!doc.disk_bold("A1"));
    assert!(!doc.enabled("edit.undo"));
}

#[test]
fn celle_e_comandi_si_annullano_nell_ordine_fra_un_salvataggio_e_l_altro() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.write("D1", "uno");
    doc.give("home.bold", r#"{"on":true}"#, "D1");
    doc.save();
    doc.write("D2", "7");
    doc.write("D1", "due");
    doc.save();
    doc.give("home.deleteRows", "{}", "A3");
    doc.save();
    assert_eq!(doc.disk_value("A3"), Value::Empty);

    // All'indietro, un passo alla volta, salvando dopo ognuno.
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("A3"), Value::Number(2.0));
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("D1"), Value::Text("uno".into()));
    assert!(doc.disk_bold("D1"));
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("D2"), Value::Empty);
    doc.undo();
    doc.save();
    assert!(!doc.disk_bold("D1"));
    assert_eq!(doc.disk_value("D1"), Value::Text("uno".into()));
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("D1"), Value::Empty);
    assert!(!doc.enabled("edit.undo"));

    // E in avanti fino in fondo, senza salvare fra un passo e l'altro.
    for _ in 0..5 {
        doc.redo();
    }
    assert!(!doc.enabled("edit.redo"));
    doc.save();
    assert_eq!(doc.disk_value("D1"), Value::Text("due".into()));
    assert!(doc.disk_bold("D1"));
    assert_eq!(doc.disk_value("D2"), Value::Number(7.0));
    assert_eq!(doc.disk_value("A3"), Value::Empty);
}

#[test]
fn una_formula_salvata_si_annulla_e_si_ripete_riscrivendo_la_cella() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.write("D2", "=A1*2");
    doc.save();
    assert_eq!(doc.shown("D2"), "=A1*2");
    doc.undo();
    assert_eq!(doc.shown("D2"), "");
    // Il passo è di celle: il giornale le riscrive, niente `fub.restore`.
    assert!(!doc.journal.contains("fub.restore"));
    doc.redo();
    assert_eq!(doc.shown("D2"), "=A1*2");
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("D2"), Value::Empty);
}

#[test]
fn un_passo_nuovo_dopo_un_annulla_toglie_il_futuro() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("home.bold", r#"{"on":true}"#, "A1");
    doc.save();
    doc.undo();
    doc.write("D4", "nuovo");
    assert!(!doc.enabled("edit.redo"));
    doc.save();
    assert!(!doc.disk_bold("A1"));
    assert_eq!(doc.disk_value("D4"), Value::Text("nuovo".into()));
}

#[test]
fn l_annulla_di_celle_resta_un_innesto_che_non_tocca_il_resto_del_file() {
    let bytes = one_sheet(LOSSY);
    let mut doc = Documento::new(bytes);
    doc.write("A2", "5");
    doc.save();
    assert_eq!(doc.disk_value("A2"), Value::Number(5.0));
    assert!(doc.enabled("edit.undo"));
    doc.undo();
    doc.save();
    assert_eq!(doc.disk_value("A2"), Value::Number(2.0));
    // La regola che la riscrittura perderebbe è ancora nel file.
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(doc.disk.clone())).unwrap();
    let mut xml = String::new();
    std::io::Read::read_to_string(
        &mut archive.by_name("xl/worksheets/sheet1.xml").unwrap(),
        &mut xml,
    )
    .unwrap();
    assert!(xml.contains("cellWatch"), "{xml}");
}

#[test]
fn prima_del_salvataggio_annullare_toglie_il_comando_dal_giornale() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("home.bold", r#"{"on":true}"#, "A1");
    doc.give("home.bold", r#"{"on":true}"#, "A2");
    doc.undo();
    let journal = GridJournal::parse(&doc.journal).unwrap();
    let ids: Vec<&str> = journal.commands().iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["home.bold"]);
    doc.undo();
    assert!(doc.journal.is_empty());
    doc.redo();
    doc.redo();
    assert_eq!(
        GridJournal::parse(&doc.journal).unwrap().commands().len(),
        2
    );
}

#[test]
fn oltre_il_salvataggio_l_annulla_di_un_comando_e_fub_restore_in_testa() {
    let mut doc = Documento::new(one_sheet(BODY));
    doc.give("home.bold", r#"{"on":true}"#, "A1");
    doc.save();
    doc.undo();
    let journal = GridJournal::parse(&doc.journal).unwrap();
    assert_eq!(journal.commands().len(), 1);
    assert_eq!(journal.commands()[0].id, "fub.restore");

    // Il comando non si dà dalla barra.
    let given = doc.try_give(journal.commands()[0].clone());
    assert!(matches!(given, Err(PluginError::BadArgs(_))), "{given:?}");

    // Dopo un altro comando resta in testa, e il giornale si rifà.
    doc.give("home.bold", r#"{"on":true}"#, "A3");
    let journal = GridJournal::parse(&doc.journal).unwrap();
    doc.reopen(&journal);
    assert!(doc.journal.contains("fub.restore"));
    doc.save();
    assert!(!doc.disk_bold("A1"));
    assert!(doc.disk_bold("A3"));
}

#[test]
fn un_fub_restore_che_non_e_in_memoria_o_non_e_in_testa_si_rifiuta() {
    let bytes = one_sheet(BODY);
    let open = |journal: &GridJournal| {
        let mut provider = XlsxGridProvider::new();
        provider.open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            journal,
        )
    };
    // Lo stato di un altro processo: un altro provider non lo ha.
    let restore = command(
        "fub.restore",
        r#"{"state":"0123456789abcdef0123456789abcdef"}"#,
        "A1",
    );
    let mut journal = GridJournal::new();
    journal.push_command(restore.clone()).unwrap();
    let lost = open(&journal).err().unwrap();
    assert!(
        matches!(&lost, PluginError::Conflict(message) if message.to_string().contains("fub.restore")),
        "{lost:?}"
    );

    let mut journal = GridJournal::new();
    journal
        .push_command(command("home.bold", r#"{"on":true}"#, "A1"))
        .unwrap();
    journal.push_command(restore).unwrap();
    assert!(matches!(open(&journal), Err(PluginError::Conflict(_))));

    let mut journal = GridJournal::new();
    journal
        .push_command(command("fub.restore", r#"{"state":"nome"}"#, "A1"))
        .unwrap();
    assert!(matches!(open(&journal), Err(PluginError::Conflict(_))));
}

#[test]
fn i_giornali_di_prima_si_leggono_come_prima() {
    let bytes = one_sheet(BODY);
    // Un giornale di celle (versione 1) e uno di comandi (versione 2) scritti
    // da un Fub di prima.
    let cells = r#"{"version":1,"cells":[{"sheet":"s1","row":"r0","column":"c0","before":"3","after":"9"}]}"#;
    let commands = r#"{"version":2,"commands":[{"id":"home.bold","params":"{\"on\":true}","sheet":"s1","selection":"A1","active":"A1"}]}"#;
    for text in [cells, commands] {
        let journal = GridJournal::parse(text).unwrap();
        let mut provider = XlsxGridProvider::new();
        let session = provider
            .open(
                XLSX_GRID_SURFACE,
                &bytes,
                Revision::of_bytes(&bytes),
                &journal,
            )
            .unwrap();
        assert!(session.conflicts.is_empty());
        // Niente da annullare: la cronologia comincia dall'apertura.
        let undo = session
            .commands
            .iter()
            .find(|c| c.id == "edit.undo")
            .unwrap();
        assert!(!undo.enabled);
        let written = provider
            .bytes_to_write(&session.instance, session.revision)
            .unwrap();
        assert_ne!(written, bytes);
    }
}

#[test]
fn la_cronologia_tiene_cento_passi_e_poi_perde_il_piu_vecchio() {
    let mut doc = Documento::new(one_sheet(BODY));
    for step in 0..105 {
        doc.write("D1", &step.to_string());
    }
    let mut undone = 0;
    while doc.enabled("edit.undo") {
        doc.undo();
        undone += 1;
    }
    assert_eq!(undone, 100);
    // Il passo più vecchio non si annulla, ma il dato resta: D1 tiene il
    // valore di cento passi fa.
    assert_eq!(doc.shown("D1"), "4");
    doc.save();
    assert_eq!(doc.disk_value("D1"), Value::Number(4.0));
}
