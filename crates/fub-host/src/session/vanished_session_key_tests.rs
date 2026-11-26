use super::*;
use crate::watcher::NoWatcher;

#[test]
fn a_known_session_key_does_not_go_back_to_disk() {
    let live_dir = tempfile::tempdir().expect("tempdir");
    let live = Utf8PathBuf::from_path_buf(live_dir.path().to_path_buf()).expect("utf8");
    std::fs::write(live.join("Nota.md"), "# Nota\n").expect("writes");
    let live = live.canonicalize_utf8().expect("the live root exists");

    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&live).expect("opens");
    host.wait_indexed(None).expect("waits for indexing");

    let vanished = {
        let dir = tempfile::tempdir().expect("tempdir");
        Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8")
    };
    assert!(!vanished.exists(), "the namespace entry is really absent");

    {
        let mut sessions = host.sessions.write().expect("sessions");
        let Some(SessionSlot::Open(mut session)) = sessions.slots.remove(&live) else {
            panic!("the live session is open")
        };
        session.root = vanished.clone();
        sessions
            .slots
            .insert(vanished.clone(), SessionSlot::Open(session));
    }

    assert_eq!(
        host.root(Some(vanished.as_str()))
            .expect("a known session key does not ask the disk"),
        vanished
    );
    let issues = host
        .close_vault(&vanished)
        .expect("closing a known session key does not ask the disk");
    assert!(issues.is_empty(), "the real workspace closes: {issues:?}");
    assert!(host.vaults().is_empty(), "the session leaves the map");
}
