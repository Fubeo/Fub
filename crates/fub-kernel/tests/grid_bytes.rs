//! Il registro grid con un provider a byte: la superficie dichiara il suo
//! protocollo, le risposte si controllano prima di uscire, e il ritiro spegne
//! il provider.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::Revision;
use fub_abi::grid::{GridApplyRequest, GridCommit, GridSheet, GridSurfaceSpec, GridWindowRequest};
use fub_abi::{
    grid_bytes_revision, GridBytesProvider, GridBytesSession, GridBytesWindow, GridJournal,
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
}

impl Bytes {
    fn new(calls: &Arc<Mutex<Calls>>) -> Self {
        Self {
            calls: Arc::clone(calls),
            revision: None,
            written: b"PK".to_vec(),
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
