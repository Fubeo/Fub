//! Un bundle nativo si aggancia prima della scrittura **accanto** al
//! versioning, non al posto suo.
//!
//! Il gancio era uno solo e il versioning lo prendeva all'apertura del vault:
//! un plugin di backup montato dopo riceveva `RegistrationPhase` e il suo mount
//! falliva. Ora ogni owner tiene il proprio gancio, la stessa scrittura passa da
//! tutti, e smontare il bundle toglie soltanto il suo.
#![cfg(feature = "versioning")]

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::{Bundle, Registrar};
use fub_host::{Host, NoWatcher};

const ID: &str = "demo.backup";

type Seen = Arc<Mutex<Vec<String>>>;

struct Backup {
    seen: Seen,
}

impl Bundle for Backup {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(ID, "Demo backup")
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Idle)
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let seen = Arc::clone(&self.seen);
        match registrar.set_before_write_hook(Arc::new(move |_host, id| {
            seen.lock().unwrap().push(id.to_string());
            Ok(())
        })) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!("backup hook not registered: {error}")],
        }
    }
}

struct Idle;

impl Plugin for Idle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(ID, "Demo backup")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

#[test]
fn a_native_bundle_hooks_the_write_next_to_versioning() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("the vault opens");
    host.wait_indexed(None).expect("the opener finished");
    assert!(
        host.versions(None).is_ok(),
        "versioning is on and holds its hook"
    );

    let seen = Seen::default();
    host.mount_bundle(
        None,
        Arc::new(Backup {
            seen: Arc::clone(&seen),
        }),
    )
    .expect("a second owner registers its own hook");

    let nota = DocId::new("Nota.md");
    host.write_document(None, &nota, "# Due\n", WriteBase::Dictated)
        .expect("both hooks accept");
    assert_eq!(*seen.lock().unwrap(), vec!["Nota.md".to_string()]);
    assert!(
        !host
            .list_versions(None, &nota)
            .expect("versions")
            .is_empty(),
        "versioning still photographs the note"
    );

    let errors = host.unmount_bundle(None, ID).expect("unmounted");
    assert!(errors.is_empty(), "clean unmount: {errors:?}");
    host.write_document(None, &nota, "# Tre\n", WriteBase::Dictated)
        .expect("the remaining hooks accept");
    assert_eq!(
        seen.lock().unwrap().len(),
        1,
        "the unmounted bundle took its hook away"
    );
    assert!(host.versions(None).is_ok(), "versioning kept its own");
    assert!(host.close().is_empty(), "host closes cleanly");
}
