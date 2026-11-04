//! «Apri con» su un vault vero (N7, T10): `Host::external_editors` e
//! `Host::open_with`.
//!
//! Le app sono script `/bin/sh` in una cartella del test, indicati da
//! `craft.editor-paths`: scrivono i loro argomenti accanto al file che
//! ricevono (`<file>.args`) e il loro pid (`<file>.pid`), e alla fine il test
//! controlla che nessuno sia rimasto vivo. Nessun test avvia un'app vera.

#![cfg(all(unix, feature = "craft"))]

use std::io::{Cursor, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::SettingValue;
use fub_abi::PluginError;
use fub_host::open_with::OpenHow;
use fub_host::Host;

/// Gli script delle app, scritti una volta per processo prima di qualunque
/// avvio. Stanno nella cartella temporanea dei test di cargo, così restano
/// fuori da `/tmp`.
struct Apps {
    _dir: tempfile::TempDir,
    /// Segna argomenti e pid ed esce.
    quick: PathBuf,
    /// Segna argomenti e pid e aspetta `<file>.stop` (al più 20 s).
    waiting: PathBuf,
    /// Segna argomenti e pid ed esce con 3.
    failing: PathBuf,
}

const RECORD: &str = "for a; do last=$a; done\n\
                      printf '%s\\n' \"$@\" > \"$last.args.tmp\"\n\
                      mv \"$last.args.tmp\" \"$last.args\"\n\
                      echo $$ > \"$last.pid\"\n";

fn apps() -> &'static Apps {
    static APPS: OnceLock<Apps> = OnceLock::new();
    APPS.get_or_init(|| {
        let dir = tempfile::Builder::new()
            .prefix("craft-open-with-")
            .tempdir_in(env!("CARGO_TARGET_TMPDIR"))
            .unwrap();
        let script = |name: &str, tail: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{RECORD}{tail}")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        let quick = script("quick.sh", "exit 0\n");
        let waiting = script(
            "waiting.sh",
            "n=0\nwhile [ ! -e \"$last.stop\" ] && [ $n -lt 400 ]; do sleep 0.05; n=$((n+1)); done\n",
        );
        let failing = script("failing.sh", "exit 3\n");
        Apps {
            _dir: dir,
            quick,
            waiting,
            failing,
        }
    })
}

/// Le righe di `craft.editor-paths`: PhotoCraft, PdfCraft e LightCraft
/// escono subito, VectorCraft aspetta, FigCraft fallisce. GridCraft e
/// WordCraft non ci sono, se non sulla macchina.
fn editor_paths() -> Vec<String> {
    let apps = apps();
    vec![
        format!("photocraft={}", apps.quick.display()),
        format!("pdfcraft={}", apps.quick.display()),
        format!("lightcraft={}", apps.quick.display()),
        format!("vectorcraft={}", apps.waiting.display()),
        format!("figcraft={}", apps.failing.display()),
    ]
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn pcraft() -> Vec<u8> {
    zip_of(&[(
        "manifest.json",
        br#"{"format_version":"2","title":"Ritocco"}"#,
    )])
}

fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("Foto/ritocco.pcraft", pcraft()),
        ("Foto/-ritocco con spazio.pcraft", pcraft()),
        (
            "Disegni/logo.vectorcraft",
            br#"{"format_version":4,"title":"Logo","layers":[]}"#.to_vec(),
        ),
        (
            "Disegni/schermate.figcraft",
            zip_of(&[("document.json", br#"{"version":3,"name":"S","pages":[]}"#)]),
        ),
        ("Carte/manuale.pdf", b"%PDF-1.4\n%%EOF\n".to_vec()),
        ("Nota.md", b"# Nota\n".to_vec()),
        ("strano.xyz", b"x".to_vec()),
    ]
}

fn vault(disabled: &[&str]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (path, bytes) in files() {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    if !disabled.is_empty() {
        std::fs::create_dir_all(root.join(".fub")).unwrap();
        std::fs::write(
            root.join(".fub/settings.json"),
            serde_json::json!({"version": 1, "values": {"plugins.disabled": disabled}}).to_string(),
        )
        .unwrap();
    }
    (dir, root)
}

fn opened(root: &Utf8Path) -> Host {
    let host = Host::without_watcher();
    host.open(root).unwrap();
    host.set_setting_for_user(
        Some(root.as_str()),
        fub_host::settings::CRAFT_EDITOR_PATHS,
        SettingValue::List(editor_paths()),
    )
    .unwrap();
    host
}

/// Il percorso che l'app deve ricevere: quello canonico, assoluto.
fn on_disk(root: &Utf8Path, relative: &str) -> PathBuf {
    root.as_std_path().canonicalize().unwrap().join(relative)
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn sidecar(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// Gli argomenti che lo script ha ricevuto per `file`, aspettati al più 10 s;
/// il file degli argomenti si toglie, perché un secondo avvio lo riscriva.
fn received(file: &Path) -> Vec<String> {
    let args = sidecar(file, ".args");
    wait_for("the app writes its arguments", || args.exists());
    let text = std::fs::read_to_string(&args).unwrap();
    std::fs::remove_file(&args).unwrap();
    text.lines().map(str::to_string).collect()
}

/// Il pid che lo script ha scritto per `file`.
fn pid_of(file: &Path) -> i32 {
    let path = sidecar(file, ".pid");
    let mut pid = None;
    wait_for("the app writes its pid", || {
        pid = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| text.trim().parse().ok());
        pid.is_some()
    });
    pid.unwrap()
}

/// Lo script di `pid` non è più vivo (`kill -0`), o è uno zombie che il thread
/// di Fub sta per raccogliere.
fn gone(pid: i32) -> bool {
    let Some(pid) = rustix::process::Pid::from_raw(pid) else {
        return true;
    };
    if rustix::process::test_kill_process(pid).is_err() {
        return true;
    }
    std::fs::read_to_string(format!("/proc/{}/stat", pid.as_raw_nonzero()))
        .map(|stat| {
            stat.rsplit(')')
                .next()
                .is_some_and(|rest| rest.trim_start().starts_with('Z'))
        })
        .unwrap_or(true)
}

fn assert_gone(pid: i32) {
    wait_for("the app script exits", || gone(pid));
}

fn key_of(error: &PluginError) -> String {
    let text = match error {
        PluginError::BadArgs(text)
        | PluginError::NotFound(text)
        | PluginError::PermissionDenied(text)
        | PluginError::Unserved(text)
        | PluginError::Io(text) => text,
        other => panic!("{other:?}"),
    };
    text.as_message()
        .map(|message| message.key.clone())
        .unwrap_or_else(|| panic!("a literal error: {error:?}"))
}

fn ids(editors: &[fub_host::open_with::ExternalEditor]) -> Vec<&str> {
    editors.iter().map(|editor| editor.id.as_str()).collect()
}

#[test]
fn the_editors_of_a_file_are_those_that_open_its_extension() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());

    let pcraft = host
        .external_editors(vault, Some("Foto/ritocco.pcraft"))
        .unwrap();
    assert_eq!(ids(&pcraft), ["photocraft"]);
    assert!(pcraft[0].installed, "{pcraft:?}");
    assert_eq!(pcraft[0].name, "PhotoCraft");
    assert!(pcraft[0].opens.iter().any(|ext| ext == "pcraft"));

    let pdf = host
        .external_editors(vault, Some("Carte/manuale.pdf"))
        .unwrap();
    assert_eq!(ids(&pdf), ["vectorcraft", "pdfcraft"]);

    assert!(host
        .external_editors(vault, Some("strano.xyz"))
        .unwrap()
        .is_empty());

    let all = host.external_editors(vault, None).unwrap();
    assert_eq!(
        ids(&all),
        [
            "vectorcraft",
            "photocraft",
            "lightcraft",
            "pdfcraft",
            "figcraft",
            "gridcraft",
            "wordcraft"
        ]
    );
    for id in [
        "vectorcraft",
        "photocraft",
        "lightcraft",
        "pdfcraft",
        "figcraft",
    ] {
        let editor = all.iter().find(|editor| editor.id == id).unwrap();
        assert!(editor.installed, "{id}");
    }
}

#[test]
fn photocraft_gets_the_absolute_path_and_forwards_it() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    for relative in ["Foto/ritocco.pcraft", "Foto/-ritocco con spazio.pcraft"] {
        let file = on_disk(&root, relative);
        // Due «Apri con» dello stesso file di fila: ognuno arriva all'app.
        for _ in 0..2 {
            let opened = host.open_with(vault, relative, "photocraft", None).unwrap();
            assert_eq!(opened.editor, "photocraft");
            if cfg!(target_os = "linux") {
                assert_eq!(opened.how, OpenHow::Forwarded);
            }
            assert_eq!(received(&file), [file.to_str().unwrap()], "{relative}");
            assert_gone(pid_of(&file));
        }
    }
}

#[test]
fn vectorcraft_is_a_new_process_and_running_until_it_exits() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    let relative = "Disegni/logo.vectorcraft";
    let file = on_disk(&root, relative);
    let opened = host
        .open_with(vault, relative, "vectorcraft", None)
        .unwrap();
    assert_eq!(opened.how, OpenHow::NewProcess);
    assert_eq!(received(&file), [file.to_str().unwrap()]);
    let pid = pid_of(&file);
    let running = |host: &Host| host.external_editors(vault, Some(relative)).unwrap()[0].running;
    assert!(running(&host), "started by Fub and still open");
    std::fs::write(sidecar(&file, ".stop"), "").unwrap();
    assert_gone(pid);
    wait_for("running goes back to false", || !running(&host));
}

#[test]
fn an_app_that_exits_with_an_error_is_not_running() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    let relative = "Disegni/schermate.figcraft";
    let file = on_disk(&root, relative);
    let opened = host.open_with(vault, relative, "figcraft", None).unwrap();
    assert_eq!(opened.how, OpenHow::NewProcess);
    assert_eq!(received(&file), [file.to_str().unwrap()]);
    assert_gone(pid_of(&file));
    wait_for("running goes back to false", || {
        !host.external_editors(vault, Some(relative)).unwrap()[0].running
    });
}

#[test]
fn pdfcraft_gets_the_page_before_the_file() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    let relative = "Carte/manuale.pdf";
    let file = on_disk(&root, relative);
    let opened = host
        .open_with(vault, relative, "pdfcraft", Some(3))
        .unwrap();
    assert_eq!(opened.editor, "pdfcraft");
    if cfg!(target_os = "linux") {
        assert_eq!(opened.how, OpenHow::Forwarded);
    }
    assert_eq!(received(&file), ["--page", "3", file.to_str().unwrap()]);
    assert_gone(pid_of(&file));
}

#[test]
fn every_refusal_says_its_key() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    let cases = [
        (
            "Foto/../../fuori.pcraft",
            "photocraft",
            "host.reveal.outside",
        ),
        (
            "Foto/ritocco.pcraft",
            "inkscape",
            "host.open_with.unknown_editor",
        ),
        ("Nota.md", "photocraft", "host.open_with.wrong_kind"),
        (
            "Foto/sparito.pcraft",
            "photocraft",
            "host.open_with.missing",
        ),
    ];
    for (path, editor, key) in cases {
        let error = host.open_with(vault, path, editor, None).unwrap_err();
        assert_eq!(key_of(&error), key, "{path} with {editor}: {error:?}");
    }
    // Un'app che non c'è: le righe di `craft.editor-paths` non la nominano,
    // e un percorso sparito non conta.
    host.set_setting_for_user(
        vault,
        fub_host::settings::CRAFT_EDITOR_PATHS,
        SettingValue::List(vec!["photocraft=/manca/del/tutto/photocraft".into()]),
    )
    .unwrap();
    let missing = host
        .external_editors(vault, Some("Foto/ritocco.pcraft"))
        .unwrap();
    if !missing[0].installed {
        let error = host
            .open_with(vault, "Foto/ritocco.pcraft", "photocraft", None)
            .unwrap_err();
        assert_eq!(key_of(&error), "host.open_with.not_installed");
        assert!(!format!("{error:?}").contains("/manca"), "{error:?}");
    }
}

#[test]
fn an_empty_path_or_a_folder_is_missing_and_starts_nothing() {
    let (_dir, root) = vault(&[]);
    let folder = "Disegni/cartella.vectorcraft";
    std::fs::create_dir_all(root.join(folder)).unwrap();
    let host = opened(&root);
    let vault = Some(root.as_str());
    for path in ["", folder, "Disegni/cartella.vectorcraft/"] {
        let error = host
            .open_with(vault, path, "vectorcraft", None)
            .unwrap_err();
        assert_eq!(
            key_of(&error),
            "host.open_with.missing",
            "{path:?}: {error:?}"
        );
    }
    assert!(!on_disk(&root, "Disegni/cartella.vectorcraft.args").exists());
    assert!(!host.external_editors(vault, Some(folder)).unwrap()[0].running);
}

#[test]
fn with_fub_craft_off_there_are_no_editors_and_nothing_opens() {
    let (_dir, root) = vault(&["fub.craft"]);
    let host = opened(&root);
    let vault = Some(root.as_str());
    assert!(host.external_editors(vault, None).unwrap().is_empty());
    assert!(host
        .external_editors(vault, Some("Foto/ritocco.pcraft"))
        .unwrap()
        .is_empty());
    let error = host
        .open_with(vault, "Foto/ritocco.pcraft", "photocraft", None)
        .unwrap_err();
    assert_eq!(key_of(&error), "host.open_with.off");
    assert!(!on_disk(&root, "Foto/ritocco.pcraft.args").exists());
}

#[test]
fn a_vault_that_is_not_open_is_an_error() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let other = tempfile::tempdir().unwrap();
    let other = other.path().to_str().unwrap();
    assert!(host.external_editors(Some(other), None).is_err());
    assert!(host
        .open_with(Some(other), "Foto/ritocco.pcraft", "photocraft", None)
        .is_err());
    assert!(!on_disk(&root, "Foto/ritocco.pcraft.args").exists());
}
