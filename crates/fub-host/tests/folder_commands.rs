//! Spostare e cestinare una cartella **dall'host vero**: la strada della shell,
//! dove il comando gira fuori dalla guardia del workspace e ogni `mkdir` e
//! `rmdir` passa dal suo turno di scrittura.

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_host::{Host, NoWatcher};

fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    for (rel, body) in files {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
    std::fs::create_dir_all(root.join("Progetti/Vuota")).unwrap();
    (dir, root)
}

fn run(host: &Host, command: &str, args: serde_json::Value) {
    host.invoke_user_command(None, command, args, InvokeMode::Apply)
        .unwrap_or_else(|error| panic!("`{command}`: {error}"));
}

#[test]
fn a_folder_moves_and_comes_back_through_the_host() {
    let (_dir, root) = vault(&[
        ("Progetti/Piano.md", "# Piano\n"),
        ("Progetti/Sotto/Dettagli.md", "[[Piano]]\n"),
        ("Indice.md", "[[Progetti/Piano]]\n"),
    ]);
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();

    run(
        &host,
        "folder.rename",
        serde_json::json!({ "folder": "Progetti", "to": "Archivio/Progetti" }),
    );
    assert!(root.join("Archivio/Progetti/Sotto/Dettagli.md").exists());
    assert!(root.join("Archivio/Progetti/Vuota").is_dir());
    assert!(!root.join("Progetti").exists());
    let index = std::fs::read_to_string(root.join("Indice.md")).unwrap();
    assert!(!index.contains("[[Progetti/"), "{index}");

    run(&host, "vault.undo", serde_json::Value::Null);
    assert!(root.join("Progetti/Sotto/Dettagli.md").exists());
    assert!(!root.join("Archivio/Progetti").exists());
}

#[test]
fn a_folder_goes_to_the_trash_through_the_host() {
    let (_dir, root) = vault(&[("Progetti/Piano.md", "# Piano\n")]);
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();

    run(
        &host,
        "folder.trash",
        serde_json::json!({ "folder": "Progetti" }),
    );
    assert!(!root.join("Progetti").exists());
    run(&host, "vault.undo", serde_json::Value::Null);
    assert_eq!(
        std::fs::read_to_string(root.join("Progetti/Piano.md")).unwrap(),
        "# Piano\n"
    );
}
