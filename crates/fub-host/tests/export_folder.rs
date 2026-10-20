//! `vault.export`: il vault, o una sua cartella, in una cartella nuova del
//! disco. L'host è quello vero, con i formati ufficiali: le destinazioni sono
//! quelle che i provider registrano.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode, ParamKind};
use fub_abi::PluginError;
use fub_format_markdown::{TARGET_FILES, TARGET_SINGLE};
use fub_host::Host;
use serde_json::json;

const EXPORT: &str = "vault.export";

fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).unwrap();
    std::fs::create_dir(&root).unwrap();
    for (name, bytes) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

fn outside(dir: &tempfile::TempDir, name: &str) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(dir.path().join(name)).unwrap()
}

fn export(
    host: &Host,
    format: &str,
    folder: &str,
    target: &Utf8Path,
    mode: InvokeMode,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.invoke_user_command(
        None,
        EXPORT,
        json!({ "format": format, "folder": folder, "target": target.as_str() }),
        mode,
    )
}

fn payload(outcome: &fub_abi::command::CommandOutcome) -> serde_json::Value {
    match &outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == "fub.vault.exported" => payload.clone(),
        other => panic!("l'esito dice cosa è stato scritto: {other:?}"),
    }
}

#[test]
fn the_whole_vault_lands_in_a_new_folder_with_its_attachments() {
    let (dir, _root, host) = vault(&[
        ("Nota.md", b"# Nota\n\n![](img/foto.png)\n"),
        ("Diario/Oggi.md", b"# Oggi\n"),
        ("img/foto.png", b"\x89PNG\r\n\x1a\nfinta"),
    ]);
    let target = outside(&dir, "Export");
    let outcome = export(&host, TARGET_FILES, "", &target, InvokeMode::Apply).unwrap();
    assert_eq!(
        std::fs::read_to_string(target.join("Nota.md")).unwrap(),
        "# Nota\n\n![](img/foto.png)\n"
    );
    assert!(target.join("Diario/Oggi.md").is_file());
    assert_eq!(
        std::fs::read(target.join("img/foto.png")).unwrap(),
        b"\x89PNG\r\n\x1a\nfinta",
        "l'allegato viaggia con la nota"
    );
    let payload = payload(&outcome);
    assert_eq!(payload["artifacts"], 3, "{payload}");
    let said = format!("{:?}", outcome.notify);
    assert!(said.contains("Export"), "una frase e non la chiave: {said}");
    assert!(!said.contains("host.export"), "{said}");
}

#[test]
fn a_folder_exports_only_what_it_holds() {
    let (dir, _root, host) = vault(&[("Nota.md", b"# Nota\n"), ("Diario/Oggi.md", b"# Oggi\n")]);
    let target = outside(&dir, "Diario esportato");
    export(&host, TARGET_FILES, "Diario/", &target, InvokeMode::Apply).unwrap();
    assert!(target.join("Diario/Oggi.md").is_file());
    assert!(!target.join("Nota.md").exists(), "fuori dalla cartella");
}

#[test]
fn a_single_file_target_is_a_file_inside_the_chosen_folder() {
    let (dir, _root, host) = vault(&[("A.md", b"# A\n"), ("B.md", b"# B\n")]);
    let target = outside(&dir, "Unico");
    let outcome = export(&host, TARGET_SINGLE, "", &target, InvokeMode::Apply).unwrap();
    assert_eq!(payload(&outcome)["artifacts"], 1);
    let written: Vec<_> = std::fs::read_dir(&target).unwrap().collect();
    assert_eq!(written.len(), 1, "un file solo");
}

#[test]
fn an_existing_or_inner_destination_is_refused_and_nothing_is_written() {
    let (dir, root, host) = vault(&[("Nota.md", b"# Nota\n")]);
    let taken = outside(&dir, "Occupata");
    std::fs::create_dir(&taken).unwrap();
    std::fs::write(taken.join("mio.txt"), "mio").unwrap();
    assert!(matches!(
        export(&host, TARGET_FILES, "", &taken, InvokeMode::Apply),
        Err(PluginError::AlreadyExists(_))
    ));
    assert_eq!(
        std::fs::read_to_string(taken.join("mio.txt")).unwrap(),
        "mio"
    );
    assert!(matches!(
        export(
            &host,
            TARGET_FILES,
            "",
            &root.join("dentro"),
            InvokeMode::Apply
        ),
        Err(PluginError::BadArgs(_))
    ));
    assert!(!root.join("dentro").exists());
    assert!(matches!(
        export(
            &host,
            TARGET_FILES,
            "",
            Utf8Path::new("relativo"),
            InvokeMode::Apply
        ),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn a_missing_folder_is_an_error_and_leaves_no_half_export() {
    let (dir, _root, host) = vault(&[("Nota.md", b"# Nota\n")]);
    let target = outside(&dir, "Vuoto");
    let refused = export(&host, TARGET_FILES, "Nessuna", &target, InvokeMode::Apply);
    assert!(
        matches!(refused, Err(PluginError::NotFound(_))),
        "{refused:?}"
    );
    assert!(
        !target.exists(),
        "la cartella creata per l'export si toglie"
    );
}

#[test]
fn a_dry_run_writes_nothing_and_an_unknown_format_is_refused() {
    let (dir, _root, host) = vault(&[("Nota.md", b"# Nota\n")]);
    let target = outside(&dir, "Prova");
    export(&host, TARGET_FILES, "", &target, InvokeMode::DryRun).unwrap();
    assert!(!target.exists());
    assert!(matches!(
        export(&host, "nessuno.formato", "", &target, InvokeMode::Apply),
        Err(PluginError::BadArgs(_))
    ));
    assert!(!target.exists());
}

#[test]
fn the_command_lists_the_registered_formats_as_choices() {
    let (_dir, _root, host) = vault(&[]);
    let specs = host.commands(None).unwrap();
    let spec = specs
        .iter()
        .find(|spec| spec.id == EXPORT)
        .expect("elencato");
    let format = spec
        .params
        .iter()
        .find(|param| param.name == "format")
        .unwrap();
    let ParamKind::Choice(choices) = &format.kind else {
        panic!("il formato è una scelta: {:?}", format.kind);
    };
    assert!(choices.iter().any(|choice| choice.value == TARGET_FILES));
    assert!(choices.iter().any(|choice| choice.value == TARGET_SINGLE));
}
