use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::watcher::{VaultWatcher, WatcherFactory};

struct DropProbe {
    drops: Arc<AtomicUsize>,
    panic_on_drop: bool,
}

impl VaultWatcher for DropProbe {
    fn is_watching(&self) -> bool {
        false
    }
}

impl Drop for DropProbe {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
        assert!(!self.panic_on_drop, "planned watcher close failure");
    }
}

struct DropProbeFactory {
    drops: Arc<AtomicUsize>,
    starts: AtomicUsize,
    panic_on_second: bool,
}

impl WatcherFactory for DropProbeFactory {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custody<Workspace>,
        _watching: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        let start = self.starts.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(DropProbe {
            drops: Arc::clone(&self.drops),
            panic_on_drop: self.panic_on_second && start == 1,
        }))
    }
}

fn vault_root() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf())
        .expect("utf8")
        .canonicalize_utf8()
        .expect("the vault root exists");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("writes a note");
    (dir, root)
}

#[test]
fn info_failure_rolls_back_before_publishing_the_session() {
    let (_dir, root) = vault_root();
    let drops = Arc::new(AtomicUsize::new(0));
    let host = Host::new()
        .with_watcher(Box::new(DropProbeFactory {
            drops: Arc::clone(&drops),
            starts: AtomicUsize::new(0),
            panic_on_second: false,
        }))
        .with_job_threads(1);

    let writer = host.writer_lease(&root).expect("the vault is free");
    let outcome = host.mounts_with_info(
        &root,
        |_| Err(PluginError::Internal("planned VaultInfo failure".into())),
        writer,
    );

    assert!(outcome.is_err(), "the injected info failure is returned");
    assert!(
        host.vaults().is_empty(),
        "a session whose info failed was published"
    );
    assert_eq!(
        drops.load(Ordering::SeqCst),
        1,
        "rollback stopped the candidate watcher"
    );

    host.open(&root)
        .expect("the cleaned resources allow the vault to reopen");
    assert!(host.close().is_empty(), "the reopened vault closes cleanly");
}

#[test]
fn loser_close_errors_are_logged_without_masking_the_winner() {
    let (_dir, root) = vault_root();
    let drops = Arc::new(AtomicUsize::new(0));
    let host = Host::new()
        .with_watcher(Box::new(DropProbeFactory {
            drops,
            starts: AtomicUsize::new(0),
            panic_on_second: true,
        }))
        .with_job_threads(1);
    host.open(&root).expect("the winning session opens");
    host.wait_indexed(None)
        .expect("the winner finishes indexing");

    let (outcome, log) = fub_kernel::log::captured_default(|| {
        let writer = host
            .writer_lease(&root)
            .expect("the winner shares its lease");
        host.mounts_with_info(&root, info_of, writer)
    });

    outcome.expect("loser cleanup does not mask the winning open result");
    assert!(
        log.iter().any(|line| {
            line.contains("fub.host losing session close failed:")
                && line.contains("planned watcher close failure")
        }),
        "the loser close error was not reported: {log:?}"
    );
    assert!(
        host.close().is_empty(),
        "the winning session closes cleanly"
    );
}
