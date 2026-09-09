//! Lo store macchina attraversa filesystem e componenti compilati dai sorgenti.
mod common;

use std::sync::{Arc, Barrier};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_host::registry::Bundle;
use fub_kernel::Trust;
use fub_wasm_host::installed::{Consent, InstallError, InstalledPluginStore};

fn root(dir: &tempfile::TempDir) -> &Utf8Path {
    Utf8Path::from_path(dir.path()).unwrap()
}
fn inventory(config: &Utf8Path) -> Utf8PathBuf {
    config.join("wasm-plugins/inventory.json")
}
fn blobs(config: &Utf8Path) -> Vec<Utf8PathBuf> {
    let path = config.join("wasm-plugins/components");
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_dir(path)
        .unwrap()
        .map(|e| Utf8PathBuf::from_path_buf(e.unwrap().path()).unwrap())
        .filter(|p| p.extension() == Some("wasm"))
        .collect()
}

#[test]
fn install_restart_decisions_and_remove_keep_four_states_separate() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let source = common::ping("");
    let original = std::fs::read(&source).unwrap();
    let installed = store.install(&store.snapshot().unwrap(), &source).unwrap();
    assert!(!installed.enabled);
    assert_eq!(installed.consent, Consent::Undecided);
    assert!(!installed.requested_at_startup());
    assert_eq!(installed.digest, Revision::of_bytes(&original));
    assert_eq!(store.load(&installed).unwrap().trust(), Trust::Community);
    assert_eq!(std::fs::read(&blobs(config)[0]).unwrap(), original);

    store
        .set_enabled(&store.snapshot().unwrap(), installed.installation, true)
        .unwrap();
    let restarted = InstalledPluginStore::open(config).unwrap();
    let state = restarted.snapshot().unwrap();
    assert!(state.plugins()[0].enabled);
    assert!(!state.plugins()[0].requested_at_startup());
    restarted
        .set_consent(&state, installed.installation, Consent::Denied)
        .unwrap();
    assert!(!restarted.snapshot().unwrap().plugins()[0].requested_at_startup());
    restarted
        .set_consent(
            &restarted.snapshot().unwrap(),
            installed.installation,
            Consent::Granted,
        )
        .unwrap();
    let restarted = InstalledPluginStore::open(config).unwrap();
    assert!(restarted.snapshot().unwrap().plugins()[0].requested_at_startup());
    restarted
        .set_enabled(
            &restarted.snapshot().unwrap(),
            installed.installation,
            false,
        )
        .unwrap();
    let restarted = InstalledPluginStore::open(config).unwrap();
    assert!(!restarted.snapshot().unwrap().plugins()[0].requested_at_startup());
    assert_eq!(
        restarted.snapshot().unwrap().plugins()[0].consent,
        Consent::Granted
    );

    let vault = tempfile::tempdir().unwrap();
    let data = root(&vault).join(".fub/plugins/demo.ping/authoritative.bin");
    std::fs::create_dir_all(data.parent().unwrap()).unwrap();
    std::fs::write(&data, b"authoritative plugin data").unwrap();
    let removed = restarted
        .remove(&restarted.snapshot().unwrap(), installed.installation)
        .unwrap();
    assert!(removed.cleanup_error.is_none());
    assert!(blobs(config).is_empty());
    assert!(InstalledPluginStore::open(config)
        .unwrap()
        .snapshot()
        .unwrap()
        .plugins()
        .is_empty());
    assert_eq!(std::fs::read(data).unwrap(), b"authoritative plugin data");
    assert_eq!(std::fs::read(&source).unwrap(), original);
    let reinstalled = restarted
        .install(&restarted.snapshot().unwrap(), &source)
        .unwrap();
    assert!(reinstalled.installation > installed.installation);
    assert_eq!(reinstalled.consent, Consent::Undecided);
    assert!(!reinstalled.enabled);
}

#[test]
fn invalid_components_and_version_collisions_preserve_the_valid_installation() {
    let dir = tempfile::tempdir().unwrap();
    let store = InstalledPluginStore::open(root(&dir)).unwrap();
    let installed = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let before = std::fs::read(inventory(root(&dir))).unwrap();
    let bad = root(&dir).join("corrupt.wasm");
    std::fs::write(&bad, b"incomplete").unwrap();
    assert!(matches!(
        store.install(&store.snapshot().unwrap(), &bad),
        Err(InstallError::Component(_))
    ));
    assert!(matches!(
        store.install(
            &store.snapshot().unwrap(),
            &common::ping("abi-incompatibile")
        ),
        Err(InstallError::Abi(_))
    ));
    assert!(matches!(
        store.install(
            &store.snapshot().unwrap(),
            &common::ping("manifest-non-valido")
        ),
        Err(InstallError::Invalid(_))
    ));
    for feature in ["", "versione-successiva"] {
        match store.install(&store.snapshot().unwrap(), &common::ping(feature)) {
            Err(InstallError::AlreadyInstalled {
                id,
                installed,
                candidate,
            }) => {
                assert_eq!(id, "demo.ping");
                assert_eq!(installed, "0.1.0");
                assert_eq!(
                    candidate,
                    if feature.is_empty() { "0.1.0" } else { "0.2.0" }
                );
            }
            other => panic!("collisione non esplicita: {other:?}"),
        }
    }
    assert_eq!(std::fs::read(inventory(root(&dir))).unwrap(), before);
    assert_eq!(blobs(root(&dir)).len(), 1);
    assert_eq!(
        store.load(&installed).unwrap().manifest(),
        installed.manifest
    );
}

#[test]
fn concurrent_installers_have_one_winner_without_overwriting_or_retrying() {
    let dir = tempfile::tempdir().unwrap();
    let source = common::ping("");
    let stores = [
        InstalledPluginStore::open(root(&dir)).unwrap(),
        InstalledPluginStore::open(root(&dir)).unwrap(),
    ];
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = stores
        .into_iter()
        .map(|store| {
            let base = store.snapshot().unwrap();
            let barrier = barrier.clone();
            let source = source.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.install(&base, &source)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(
        results.iter().filter(|r| r.is_ok()).count(),
        1,
        "{results:?}"
    );
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(InstallError::Conflict)))
            .count(),
        1,
        "{results:?}"
    );
    let store = InstalledPluginStore::open(root(&dir)).unwrap();
    assert_eq!(store.snapshot().unwrap().plugins().len(), 1);
    assert!(store.load(&store.snapshot().unwrap().plugins()[0]).is_ok());
}

#[test]
fn stale_and_foreign_choices_cannot_overwrite_newer_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let store = InstalledPluginStore::open(root(&dir)).unwrap();
    let record = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let other = InstalledPluginStore::open(root(&dir)).unwrap();
    let old = other.snapshot().unwrap();
    store
        .set_enabled(&store.snapshot().unwrap(), record.installation, true)
        .unwrap();
    let before = std::fs::read(inventory(root(&dir))).unwrap();
    assert!(matches!(
        other.set_consent(&old, record.installation, Consent::Granted),
        Err(InstallError::Conflict)
    ));
    assert!(matches!(
        store.remove(&old, record.installation),
        Err(InstallError::Conflict)
    ));
    assert_eq!(std::fs::read(inventory(root(&dir))).unwrap(), before);
    assert_eq!(
        store.snapshot().unwrap().plugins()[0].consent,
        Consent::Undecided
    );
    assert!(store.snapshot().unwrap().plugins()[0].enabled);
}

#[test]
fn failed_publication_leaves_only_an_invisible_blob_and_restart_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let source = common::ping("");
    let blocked_lock = config.join("wasm-plugins/.inventory.json.lock");
    // Guasto reale tra scrittura durevole del blob e pubblicazione inventario.
    std::fs::create_dir_all(&blocked_lock).unwrap();
    let failure = store.install(&store.snapshot().unwrap(), &source);
    assert!(
        matches!(
            &failure,
            Err(InstallError::Operation {
                operation: "publish-inventory",
                ..
            })
        ),
        "errore inatteso: {failure:?}"
    );
    assert_eq!(blobs(config).len(), 1);
    std::fs::write(config.join("wasm-plugins/download.wasm.part"), b"partial").unwrap();
    let restarted = InstalledPluginStore::open(config).unwrap();
    assert!(restarted.snapshot().unwrap().plugins().is_empty());
    assert!(!inventory(config).exists());
    std::fs::remove_dir(&blocked_lock).unwrap();
    restarted
        .install(&restarted.snapshot().unwrap(), &source)
        .unwrap();
    assert_eq!(restarted.snapshot().unwrap().plugins().len(), 1);
    assert_eq!(blobs(config).len(), 1);
}

#[test]
fn write_failure_and_unreadable_inventory_preserve_previous_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let installed = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let base = store.snapshot().unwrap();
    let before = std::fs::read(inventory(config)).unwrap();
    let lock = config.join("wasm-plugins/.inventory.json.lock");
    std::fs::remove_file(&lock).unwrap();
    std::fs::create_dir(&lock).unwrap();
    let enable_failure = store.set_enabled(&base, installed.installation, true);
    assert!(
        matches!(
            &enable_failure,
            Err(InstallError::Operation {
                operation: "publish-inventory",
                ..
            })
        ),
        "errore inatteso: {enable_failure:?}"
    );
    let remove_failure = store.remove(&base, installed.installation);
    assert!(
        matches!(
            &remove_failure,
            Err(InstallError::Operation {
                operation: "publish-inventory",
                ..
            })
        ),
        "errore inatteso: {remove_failure:?}"
    );
    assert_eq!(std::fs::read(inventory(config)).unwrap(), before);
    assert_eq!(blobs(config).len(), 1);
    std::fs::remove_dir(lock).unwrap();
    std::fs::rename(inventory(config), config.join("saved-inventory.json")).unwrap();
    std::fs::create_dir(inventory(config)).unwrap();
    assert!(matches!(store.snapshot(), Err(InstallError::Io(_))));
    assert!(matches!(
        store.set_enabled(&base, installed.installation, true),
        Err(InstallError::Operation {
            operation: "publish-inventory",
            ..
        })
    ));
    assert_eq!(
        std::fs::read(config.join("saved-inventory.json")).unwrap(),
        before
    );
}

#[test]
fn corrupt_or_future_inventory_is_never_reinterpreted_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&std::fs::read(inventory(config)).unwrap()).unwrap();
    let mut duplicate = original.clone();
    duplicate["plugins"]
        .as_array_mut()
        .unwrap()
        .push(original["plugins"][0].clone());
    let mut traversal = original.clone();
    traversal["plugins"][0]["digest"] = "sha256:../../escape".into();
    for bytes in [
        b"{broken".to_vec(),
        br#"{"schema_version":2}"#.to_vec(),
        serde_json::to_vec(&duplicate).unwrap(),
        serde_json::to_vec(&traversal).unwrap(),
    ] {
        std::fs::write(inventory(config), &bytes).unwrap();
        assert!(InstalledPluginStore::open(config)
            .unwrap()
            .snapshot()
            .is_err());
        assert_eq!(std::fs::read(inventory(config)).unwrap(), bytes);
    }
    assert_eq!(blobs(config).len(), 1);
}

#[test]
fn one_corrupt_component_does_not_hide_an_independent_valid_component() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let first = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let second_source = common::component("eventi-wasm", "eventi_wasm", "");
    let second = store
        .install(&store.snapshot().unwrap(), &second_source)
        .unwrap();
    let first_path = blobs(config)
        .into_iter()
        .find(|p| {
            p.file_name()
                .unwrap()
                .starts_with(&format!("{}-", first.installation))
        })
        .unwrap();
    std::fs::write(first_path, b"corrupt").unwrap();
    let restarted = InstalledPluginStore::open(config).unwrap();
    assert_eq!(restarted.snapshot().unwrap().plugins().len(), 2);
    assert!(matches!(
        restarted.load(&first),
        Err(InstallError::Integrity(_))
    ));
    assert_eq!(restarted.load(&second).unwrap().manifest(), second.manifest);
}

#[cfg(unix)]
#[test]
fn source_symlink_does_not_grant_access_to_another_directory() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let link = config.join("linked.wasm");
    std::os::unix::fs::symlink(common::ping(""), &link).unwrap();
    assert!(matches!(
        store.install(&store.snapshot().unwrap(), &link),
        Err(InstallError::Invalid(_))
    ));
    assert!(store.snapshot().unwrap().plugins().is_empty());
    assert!(blobs(config).is_empty());
}

#[test]
fn cleanup_failure_is_reported_after_removal_without_undoing_the_commit() {
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let store = InstalledPluginStore::open(config).unwrap();
    let record = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    let component = blobs(config).remove(0);
    std::fs::remove_file(&component).unwrap();
    std::fs::create_dir(&component).unwrap();
    let removed = store
        .remove(&store.snapshot().unwrap(), record.installation)
        .unwrap();
    assert!(removed.cleanup_error.is_some());
    assert!(InstalledPluginStore::open(config)
        .unwrap()
        .snapshot()
        .unwrap()
        .plugins()
        .is_empty());
    assert!(component.is_dir());
    let fresh = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    assert!(fresh.installation > record.installation);
    assert!(store.load(&fresh).is_ok());
}

#[cfg(unix)]
#[test]
fn replacing_the_config_name_does_not_redirect_an_open_store() {
    let dir = tempfile::tempdir().unwrap();
    let initial = root(&dir).join("config");
    let retained = root(&dir).join("retained");
    let elsewhere = root(&dir).join("elsewhere");
    std::fs::create_dir(&initial).unwrap();
    std::fs::create_dir(&elsewhere).unwrap();
    let store = InstalledPluginStore::open(&initial).unwrap();
    std::fs::rename(&initial, &retained).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &initial).unwrap();
    let record = store
        .install(&store.snapshot().unwrap(), &common::ping(""))
        .unwrap();
    assert!(inventory(&retained).is_file());
    assert!(!inventory(&elsewhere).exists());
    assert_eq!(
        store.snapshot().unwrap().plugins(),
        std::slice::from_ref(&record)
    );
    assert!(store.load(&record).is_ok());
}

// Darwin rejects non-UTF-8 path components before the store can observe them.
// Exercise this boundary on a platform whose filesystem API accepts raw bytes.
#[cfg(target_os = "linux")]
#[test]
fn an_unrelated_non_utf8_sibling_cannot_prevent_installing_the_chosen_file() {
    use std::os::unix::ffi::OsStrExt;
    let dir = tempfile::tempdir().unwrap();
    let config = root(&dir);
    let source_dir = tempfile::tempdir().unwrap();
    let chosen = root(&source_dir).join("chosen.wasm");
    std::fs::copy(common::ping(""), &chosen).unwrap();
    std::fs::write(
        source_dir
            .path()
            .join(std::ffi::OsStr::from_bytes(b"unrelated-\xff")),
        b"other",
    )
    .unwrap();
    let store = InstalledPluginStore::open(config).unwrap();
    store.install(&store.snapshot().unwrap(), &chosen).unwrap();
    assert_eq!(store.snapshot().unwrap().plugins().len(), 1);
}
