from pathlib import Path

path = Path('.audit-arch-before-write.py')
text = path.read_text()
old = '''    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);\n    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);\n    {\n'''
new = '''    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);\n    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);\n    let release_rx = Mutex::new(release_rx);\n    {\n'''
if text.count(old) != 1:
    raise SystemExit(f'before-write receiver setup: expected one match, found {text.count(old)}')
text = text.replace(old, new, 1)
old = '''                release_rx\n                    .recv_timeout(Duration::from_secs(10))\n'''
new = '''                release_rx\n                    .lock()\n                    .unwrap_or_else(|poisoned| poisoned.into_inner())\n                    .recv_timeout(Duration::from_secs(10))\n'''
if text.count(old) != 1:
    raise SystemExit(f'before-write receiver use: expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
