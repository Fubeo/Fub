//! Il registro grid con un provider a byte: la superficie dichiara il suo
//! protocollo, le risposte si controllano prima di uscire, e il ritiro spegne
//! il provider.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::grid::{
    GridApplyRequest, GridCommit, GridInvalidation, GridSheet, GridSourceEdit, GridSurfaceSpec,
    GridWindowRequest,
};
use fub_abi::{
    grid_bytes_revision, GridBytesProvider, GridBytesSession, GridBytesWindow, GridCommand,
    GridCommandOutcome, GridCommandRequest, GridCommandState, GridJournal, GridSelection,
    PluginError,
};
use fub_kernel::workspace::PreparedRegistration;
use fub_kernel::{FormatRegistry, Workspace};

fn workspace() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut ws = Workspace::new(&root, FormatRegistry::new()).expect("vault opens");
    ws.register_core_feature("prova", "prova")
        .expect("declared");
    (dir, ws)
}

fn register(ws: &mut Workspace, mut prepared: PreparedRegistration) {
    let permit = ws.registration_permit("prova").expect("declared");
    ws.commit_registration(&permit, &mut prepared)
        .expect("registered");
}

#[derive(Default)]
struct Calls {
    opened: u32,
    shutdown: u32,
}

/// Un provider della versione 2 che risponde con la revisione che gli si
/// chiede di dare, giusta o no.
struct Bytes {
    calls: Arc<Mutex<Calls>>,
    revision: Option<Revision>,
    written: Vec<u8>,
    outcome: Option<GridCommandOutcome>,
    catalog: Vec<GridCommandState>,
}

impl Bytes {
    fn new(calls: &Arc<Mutex<Calls>>) -> Self {
        Self {
            calls: Arc::clone(calls),
            revision: None,
            written: b"PK".to_vec(),
            outcome: None,
            catalog: Vec::new(),
        }
    }
}

impl GridBytesProvider for Bytes {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::bytes("prova.bytes", "xlsx")]
    }

    fn open(
        &mut self,
        _surface: &str,
        _source: &[u8],
        revision: Revision,
        journal: &GridJournal,
    ) -> Result<GridBytesSession, PluginError> {
        self.calls.lock().unwrap().opened += 1;
        Ok(GridBytesSession {
            instance: "uno".into(),
            revision: self
                .revision
                .clone()
                .unwrap_or_else(|| grid_bytes_revision(&revision, &journal.to_text())),
            sheets: vec![GridSheet {
                id: "s1".into(),
                name: "Foglio".into(),
                row_count: 1,
                column_count: 1,
            }],
            active: "s1".into(),
            hidden: Vec::new(),
            notices: Vec::new(),
            conflicts: Vec::new(),
            commands: Vec::new(),
        })
    }

    fn window(
        &mut self,
        _instance: &str,
        _request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError> {
        Err(PluginError::NotFound("finestra non implementata".into()))
    }

    fn apply(
        &mut self,
        _instance: &str,
        _request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        Err(PluginError::NotFound("modifica non implementata".into()))
    }

    fn commands(
        &mut self,
        _instance: &str,
        _selection: GridSelection,
    ) -> Result<Vec<GridCommandState>, PluginError> {
        Ok(self.catalog.clone())
    }

    fn command(
        &mut self,
        _instance: &str,
        _request: GridCommandRequest,
    ) -> Result<GridCommandOutcome, PluginError> {
        self.outcome
            .clone()
            .ok_or_else(|| PluginError::BadArgs("comando non servito".into()))
    }

    fn bytes_to_write(
        &mut self,
        _instance: &str,
        _expected: Revision,
    ) -> Result<Vec<u8>, PluginError> {
        Ok(self.written.clone())
    }

    fn close(&mut self, _instance: &str) -> Result<(), PluginError> {
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.calls.lock().unwrap().shutdown += 1;
        Ok(())
    }
}

#[test]
fn la_superficie_a_byte_si_chiama_soltanto_con_il_suo_protocollo() {
    let (_dir, mut ws) = workspace();
    let calls = Arc::new(Mutex::new(Calls::default()));
    register(
        &mut ws,
        PreparedRegistration::grid_bytes(Box::new(Bytes::new(&calls))).expect("valid"),
    );
    assert!(ws
        .grid_surfaces()
        .iter()
        .any(|spec| spec.id == "prova.bytes" && spec.protocol_version == 2));

    let call = ws.prepare_grid_bytes_call("prova.bytes").expect("served");
    let revision = Revision::of_bytes(b"PK");
    let mut journal = GridJournal::new();
    journal
        .record(
            fub_abi::grid::GridCellKey {
                sheet: "s1".into(),
                row: "r0".into(),
                column: "c0".into(),
            },
            "".into(),
            "1".into(),
        )
        .unwrap();
    let session = call
        .open("prova.bytes", b"PK", revision.clone(), &journal)
        .expect("opens");
    assert_eq!(
        session.revision,
        grid_bytes_revision(&revision, &journal.to_text())
    );
    assert_eq!(
        call.bytes_to_write(&session.instance, session.revision.clone())
            .unwrap(),
        b"PK"
    );

    assert!(ws.deactivate_plugin("prova").expect("retired").is_empty());
    assert_eq!(calls.lock().unwrap().shutdown, 1);
    assert!(matches!(
        ws.prepare_grid_bytes_call("prova.bytes"),
        Err(PluginError::Unserved(_))
    ));
}

#[test]
fn una_registrazione_dichiara_soltanto_la_versione_2() {
    struct Mixed(Bytes);
    impl GridBytesProvider for Mixed {
        fn surfaces(&self) -> Vec<GridSurfaceSpec> {
            let mut vecchia = GridSurfaceSpec::bytes("vecchia.grid", "xlsx");
            vecchia.protocol_version = 1;
            vec![vecchia]
        }
        fn open(
            &mut self,
            surface: &str,
            source: &[u8],
            revision: Revision,
            journal: &GridJournal,
        ) -> Result<GridBytesSession, PluginError> {
            self.0.open(surface, source, revision, journal)
        }
        fn window(
            &mut self,
            instance: &str,
            request: GridWindowRequest,
        ) -> Result<GridBytesWindow, PluginError> {
            self.0.window(instance, request)
        }
        fn apply(
            &mut self,
            instance: &str,
            request: GridApplyRequest,
        ) -> Result<GridCommit, PluginError> {
            self.0.apply(instance, request)
        }
        fn bytes_to_write(
            &mut self,
            instance: &str,
            expected: Revision,
        ) -> Result<Vec<u8>, PluginError> {
            self.0.bytes_to_write(instance, expected)
        }
        fn close(&mut self, instance: &str) -> Result<(), PluginError> {
            self.0.close(instance)
        }
        fn shutdown(&mut self) -> Result<(), PluginError> {
            self.0.shutdown()
        }
    }
    let calls = Arc::new(Mutex::new(Calls::default()));
    assert!(matches!(
        PreparedRegistration::grid_bytes(Box::new(Mixed(Bytes::new(&calls)))),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn le_risposte_malformate_non_arrivano_a_chi_chiama() {
    let (_dir, mut ws) = workspace();
    let calls = Arc::new(Mutex::new(Calls::default()));
    let mut provider = Bytes::new(&calls);
    provider.revision = Some(Revision("un'altra".into()));
    provider.written = Vec::new();
    register(
        &mut ws,
        PreparedRegistration::grid_bytes(Box::new(provider)).expect("valid"),
    );
    let call = ws.prepare_grid_bytes_call("prova.bytes").expect("served");
    let revision = Revision::of_bytes(b"PK");
    assert!(matches!(
        call.open("prova.bytes", b"PK", revision, &GridJournal::new()),
        Err(PluginError::Internal(_))
    ));
    // Niente byte vuoti al disco.
    assert!(matches!(
        call.bytes_to_write("uno", Revision("r".into())),
        Err(PluginError::Internal(_))
    ));
    // Una sorgente oltre il limite non arriva al provider.
    let opened = calls.lock().unwrap().opened;
    let large = vec![0; fub_abi::MAX_GRID_BYTES_SOURCE + 1];
    assert!(matches!(
        call.open(
            "prova.bytes",
            &large,
            Revision::of_bytes(&large),
            &GridJournal::new()
        ),
        Err(PluginError::BadArgs(_))
    ));
    assert_eq!(calls.lock().unwrap().opened, opened);
}

fn selection() -> GridSelection {
    GridSelection {
        sheet: "s1".into(),
        selection: "A1".into(),
        active: "A1".into(),
    }
}

fn outcome(revision: &str, inserted: &str) -> GridCommandOutcome {
    GridCommandOutcome {
        commit: GridCommit {
            revision: Revision(revision.into()),
            edit: GridSourceEdit {
                from: 0,
                to: 0,
                deleted: String::new(),
                inserted: inserted.into(),
            },
            invalidation: GridInvalidation::All,
        },
        sheets: vec![GridSheet {
            id: "s1".into(),
            name: "Foglio".into(),
            row_count: 1,
            column_count: 1,
        }],
        hidden: Vec::new(),
        selection: selection(),
        result: None,
        dialog: None,
        commands: Vec::new(),
    }
}

fn request(id: &str) -> GridCommandRequest {
    GridCommandRequest {
        revision: Revision("r1".into()),
        command: GridCommand {
            id: id.into(),
            params: "{}".into(),
            sheet: "s1".into(),
            selection: "A1".into(),
            active: "A1".into(),
        },
    }
}

#[test]
fn un_comando_porta_avanti_la_revisione_soltanto_se_cambia_il_giornale() {
    let calls = Arc::new(Mutex::new(Calls::default()));
    let call = |outcome: Option<GridCommandOutcome>, catalog: Vec<GridCommandState>| {
        let (dir, mut ws) = workspace();
        let mut provider = Bytes::new(&calls);
        provider.outcome = outcome;
        provider.catalog = catalog;
        register(
            &mut ws,
            PreparedRegistration::grid_bytes(Box::new(provider)).expect("valid"),
        );
        (
            dir,
            ws.prepare_grid_bytes_call("prova.bytes").expect("served"),
        )
    };
    // Un comando che non cambia la cartella resta alla revisione; uno che la
    // cambia va avanti.
    let (_a, same) = call(Some(outcome("r1", "")), Vec::new());
    assert!(same.command("uno", request("edit.copy")).is_ok());
    let (_b, moved) = call(Some(outcome("r2", "x")), Vec::new());
    assert!(moved.command("uno", request("home.bold")).is_ok());
    // Una revisione che non segue il diff è una risposta malformata.
    let (_c, stuck) = call(Some(outcome("r1", "x")), Vec::new());
    assert!(matches!(
        stuck.command("uno", request("home.bold")),
        Err(PluginError::Internal(_))
    ));
    let (_d, jumped) = call(Some(outcome("r2", "")), Vec::new());
    assert!(matches!(
        jumped.command("uno", request("edit.copy")),
        Err(PluginError::Internal(_))
    ));
    // Una richiesta malformata non arriva al provider; un comando non servito
    // resta il rifiuto del provider.
    let mut bad = request("home.bold");
    bad.command.params = "[]".into();
    assert!(matches!(
        same.command("uno", bad),
        Err(PluginError::BadArgs(_))
    ));
    let (_e, unserved) = call(None, Vec::new());
    assert!(matches!(
        unserved.command("uno", request("home.bold")),
        Err(PluginError::BadArgs(_))
    ));
    // Un catalogo con un id due volte, o un perché su un comando acceso, non
    // esce.
    let state = |id: &str, enabled: bool, reason: Option<&str>| GridCommandState {
        id: id.into(),
        enabled,
        reason: reason.map(str::to_owned),
    };
    let (_f, twice) = call(None, vec![state("a", true, None), state("a", true, None)]);
    assert!(matches!(
        twice.commands("uno", selection()),
        Err(PluginError::Internal(_))
    ));
    let (_g, reasoned) = call(None, vec![state("a", true, Some("perché"))]);
    assert!(matches!(
        reasoned.commands("uno", selection()),
        Err(PluginError::Internal(_))
    ));
    let (_h, fine) = call(None, vec![state("a", false, Some("perché"))]);
    assert_eq!(fine.commands("uno", selection()).unwrap().len(), 1);
}
