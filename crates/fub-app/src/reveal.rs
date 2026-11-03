//! «Mostra nel file manager» e «Apri con l'app di sistema»: una voce del vault
//! passa al sistema.
//!
//! La voce arriva come percorso relativo alla radice del vault, e resta dentro
//! il vault: niente `..`, niente percorsi assoluti, e un collegamento che porta
//! fuori si riconosce dopo averlo seguito (`fub_host::vault_path`, la stessa
//! regola di «Apri con» un'app Craft). Il programma si chiama con il
//! percorso come argomento, mai attraverso una shell (`print.rs`).
//!
//! Mostrare apre il file manager sulla cartella della voce, con la voce
//! selezionata dove il sistema lo sa fare: `open -R` su macOS,
//! `explorer.exe /select,` su Windows, `ShowItems` di `FileManager1` sugli
//! altri, e altrimenti la cartella con `xdg-open`.
//!
//! Aprire passa la voce al programma che il sistema sceglie, ma non un
//! programma: un file eseguibile, o con l'estensione di un lanciatore
//! (`.desktop`, `.exe`, `.app`, …), si mostra e non si apre, perché aprirlo
//! vorrebbe dire eseguirlo.

use std::path::Path;
use std::process::{Command, Stdio};

use fub_abi::PluginError;
use fub_host::vault_path::inside;

use crate::print::{launched, opener};

/// Com'è andata.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum RevealOutcome {
    /// Il sistema ha preso la voce.
    Opened,
    /// Nessun programma del sistema l'ha presa.
    NoOpener,
    /// La voce è un programma: aprirla vorrebbe dire eseguirla.
    Executable,
}

/// Le estensioni dei file che, aperti, si eseguono.
const LAUNCHERS: &[&str] = &[
    "app", "appimage", "bat", "cmd", "com", "command", "cpl", "desktop", "exe", "jar", "lnk",
    "msi", "ps1", "scr", "sh", "url", "vbs", "workflow",
];

/// Passa al sistema la voce `relative` del vault in `root`: la mostra nel file
/// manager, o con `open` la apre.
pub(crate) fn hand_over(
    root: &Path,
    relative: &str,
    open: bool,
) -> Result<RevealOutcome, PluginError> {
    let path = inside(root, relative)?;
    if open {
        if runs(&path) {
            return Ok(RevealOutcome::Executable);
        }
        return Ok(outcome(launched(opener(&path))));
    }
    Ok(outcome(reveal(&path)))
}

fn outcome(taken: bool) -> RevealOutcome {
    if taken {
        RevealOutcome::Opened
    } else {
        RevealOutcome::NoOpener
    }
}

/// Vero se aprire `path` vorrebbe dire eseguirlo.
fn runs(path: &Path) -> bool {
    let launcher = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            LAUNCHERS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        });
    launcher || executable(path)
}

#[cfg(unix)]
fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable(_path: &Path) -> bool {
    false
}

fn quiet(mut command: Command) -> Command {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> bool {
    let mut command = Command::new("open");
    command.arg("-R").arg(path);
    launched(quiet(command))
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> bool {
    use std::os::windows::process::CommandExt;
    // `explorer.exe` legge `/select,` e il percorso come un argomento solo,
    // con le virgolette sue: la quotatura di `arg` lo spezzerebbe.
    let mut command = Command::new("explorer.exe");
    command.raw_arg(format!("/select,\"{}\"", path.display()));
    launched(quiet(command))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal(path: &Path) -> bool {
    let mut command = Command::new("dbus-send");
    command
        .args([
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{}", file_uri(path)))
        .arg("string:");
    if launched(quiet(command)) {
        return true;
    }
    // Senza un file manager che sappia selezionare, la cartella della voce.
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    launched(opener(folder))
}

/// `file://` e il percorso, con in `%XX` ogni byte che non sia lettera, cifra,
/// `/`, `-`, `_`, `.` o `~`: anche la virgola, che `dbus-send` leggerebbe come
/// il confine fra due voci dell'array.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn file_uri(path: &Path) -> String {
    use std::os::unix::ffi::OsStrExt;
    let mut uri = String::from("file://");
    for &byte in path.as_os_str().as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            uri.push(byte as char);
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    uri
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_is_shown_and_not_opened() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["avvia.desktop", "SETUP.EXE", "script.sh"] {
            let path = dir.path().join(name);
            std::fs::write(&path, "x").unwrap();
            assert!(runs(&path), "{name}");
            assert_eq!(
                hand_over(dir.path(), name, true).unwrap(),
                RevealOutcome::Executable
            );
        }
        let note = dir.path().join("nota.md");
        std::fs::write(&note, "x").unwrap();
        assert!(!runs(&note));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&note, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(runs(&note), "an executable file runs whatever its name");
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn the_uri_keeps_one_item_of_the_array() {
        assert_eq!(
            file_uri(Path::new("/v/una nota, due.md")),
            "file:///v/una%20nota%2C%20due.md"
        );
    }
}
