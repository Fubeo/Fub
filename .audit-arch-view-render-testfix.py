from pathlib import Path

path = Path('.audit-arch-view-render.py')
text = path.read_text()
old = '''    let writer_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_write().is_some())
            .join()
            .expect("writer probe finishes")
    };
    release_tx.send(()).expect("release view provider");
    let outcome = call.join().expect("render thread does not panic");

    assert!(
        writer_progressed,
        "Host::render_view held Custody<Workspace> across ViewProvider::render_view"
    );
'''
new = '''    let (writer_tx, writer_rx) = std::sync::mpsc::sync_channel(1);
    let writer = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.write().is_ok();
            let _ = writer_tx.send(acquired);
        })
    };
    let writer_progressed = writer_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release view provider");
    writer.join().expect("writer probe finishes");
    let outcome = call.join().expect("render thread does not panic");

    assert!(
        writer_progressed,
        "Host::render_view held Custody<Workspace> across ViewProvider::render_view"
    );
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'view render writer probe: expected one match, found {count}')
path.write_text(text.replace(old, new, 1))
