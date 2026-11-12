//! Test unitari dei comandi locali.

use super::documents::write_with;
use super::*;

fn global_on(vault: &std::path::Path, config: &std::path::Path) -> GlobalArgs {
    GlobalArgs {
        vault: Some(vault.to_str().unwrap().to_string()),
        config_dir: Some(config.to_str().unwrap().to_string()),
        no_watcher: true,
        yes: true,
        ..GlobalArgs::default()
    }
}

fn text_args(global: &GlobalArgs, doc: &str, text: &str) -> WriteArgs {
    WriteArgs {
        global: global.clone(),
        doc: doc.into(),
        base: None,
        force: false,
        stdin: false,
        text: Some(text.into()),
        file: None,
    }
}

#[test]
fn a_new_note_is_written_and_its_revision_told() {
    let vault = tempfile::tempdir().unwrap();
    let config = tempfile::tempdir().unwrap();
    let global = global_on(vault.path(), config.path());
    let mut connection = Connection::open(&global).unwrap();
    let printed = std::cell::RefCell::new(None);

    write_with(
        &mut connection,
        &global,
        text_args(&global, "Nuova.md", "dalla riga di comando\n"),
        |_| Ok(()),
        |value| *printed.borrow_mut() = Some(value.clone()),
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(vault.path().join("Nuova.md")).unwrap(),
        "dalla riga di comando\n"
    );
    let printed = printed.into_inner().expect("the outcome is printed");
    assert!(printed.to_string().contains("revision"), "{printed}");
}

/// Una nota che non c'era quando la base si è letta, e che un'altra
/// applicazione crea mentre si aspetta il «y», non si sovrascrive: la
/// scrittura di una nota nuova è una creazione, e una creazione non copre
/// ciò che qualcun altro ha appena scritto.
#[test]
fn a_note_created_during_the_prompt_is_not_overwritten() {
    let vault = tempfile::tempdir().unwrap();
    let config = tempfile::tempdir().unwrap();
    let global = global_on(vault.path(), config.path());
    let mut connection = Connection::open(&global).unwrap();
    let other = vault.path().join("Nuova.md");

    let result = write_with(
        &mut connection,
        &global,
        text_args(&global, "Nuova.md", "dalla riga di comando\n"),
        |_| {
            std::fs::write(&other, "dell'altra applicazione\n").unwrap();
            Ok(())
        },
        |_| {},
    );

    assert!(result.is_err(), "the other application's note was covered");
    assert_eq!(
        std::fs::read_to_string(&other).unwrap(),
        "dell'altra applicazione\n"
    );
}

/// Un file degli abbinamenti che non si lascia leggere non è un file
/// assente: `pair` lo riscriveva con il solo abbinamento nuovo, e tutte le
/// estensioni già abbinate perdevano il permesso di scrivere.
#[cfg(unix)]
#[test]
fn an_unreadable_pairing_file_is_not_replaced() {
    use std::os::unix::fs::PermissionsExt;

    let vault = tempfile::tempdir().unwrap();
    let config = tempfile::tempdir().unwrap();
    let global = global_on(vault.path(), config.path());
    let add = |id: &str| PairAction::Add {
        extension_id: id.to_string(),
        vault: None,
        folder: None,
    };
    pairing(&global, &OutputFormat::Json, add("prima"), |_| {}).unwrap();
    let path = config.path().join("clipper-pairing.json");
    let before = std::fs::read(&path).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    // Da root il file si legge lo stesso, e il banco non prova niente.
    if std::fs::read(&path).is_ok() {
        eprintln!("si salta: questo utente legge anche un file 000");
        return;
    }

    let listed = pairing(&global, &OutputFormat::Json, PairAction::List, |_| {});
    let added = pairing(&global, &OutputFormat::Json, add("seconda"), |_| {});

    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(listed.is_err(), "an unreadable file is not an empty list");
    assert!(added.is_err(), "an unreadable file was replaced");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
