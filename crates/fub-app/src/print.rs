//! «Stampa…»: un PDF esportato passa al sistema.
//!
//! Il PDF va nel programma che il sistema usa per i PDF, e da lì si stampa con
//! la finestra di stampa del sistema: la stampante, le copie, il fronte e
//! retro, il vassoio. La webview non ha un modo solo per stampare un PDF su
//! ogni piattaforma (WebKitGTK non lo mostra nemmeno), e rifarlo a immagini
//! perderebbe il vettoriale; il lettore del sistema lo stampa com'è.
//!
//! Il file sta in una cartella tutta sua sotto la cartella temporanea, che
//! solo chi usa l'app legge, col nome dell'artefatto: è quello che il lettore
//! mostra nel titolo. Resta lì finché il lettore lo usa; le cartelle di più di
//! un giorno se ne vanno alla stampa dopo.
//!
//! Com'è andata è un esito ([`PrintOutcome`]), non un errore: la shell lo
//! dice nella lingua di chi guarda, e a chi non ha un lettore di PDF propone
//! di salvare il file.
//!
//! Il programma si chiama con il percorso come argomento, mai attraverso una
//! shell: `xdg-open` su Linux e sugli altri Unix, `open` su macOS,
//! `explorer.exe` su Windows. E si chiama per percorso assoluto, preso fra le
//! cartelle del sistema ([`system_program`]), mai cercato nel `PATH`: un
//! programma con lo stesso nome messo prima nel `PATH` riceverebbe un percorso
//! del vault.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

/// Il prefisso delle cartelle dei PDF da stampare.
const PREFIX: &str = "fub-print-";
/// Dopo quanto una cartella di stampa è vecchia.
const STALE: Duration = Duration::from_secs(24 * 60 * 60);
/// Quanto si aspetta che il programma che apre il file dica com'è andata: chi
/// apre e ritorna subito (`xdg-open`, `open`) dice di no con l'uscita; chi
/// resta aperto è il lettore stesso, e allora il file è aperto.
const OPEN_WAIT: Duration = Duration::from_secs(5);

/// Com'è andata la stampa.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum PrintOutcome {
    /// Il PDF è aperto nel programma del sistema: si stampa da lì.
    Opened,
    /// Nessun programma del sistema apre i PDF.
    NoViewer,
    /// Il PDF non si scrive nella cartella temporanea, e perché.
    Unwritable { reason: String },
}

/// Mette `bytes`, un PDF, in una cartella nuova sotto la cartella temporanea
/// e lo apre nel programma del sistema per i PDF.
pub(crate) fn open_for_print(name: &str, bytes: &[u8]) -> PrintOutcome {
    let base = std::env::temp_dir();
    sweep(&base, SystemTime::now());
    match prepare(&base, name, bytes) {
        Ok(path) => open_with_system(&path),
        Err(error) => PrintOutcome::Unwritable {
            reason: error.to_string(),
        },
    }
}

/// Il nome più lungo di un file, in byte, sui sistemi più stretti.
const NAME_MAX: usize = 255;

/// Il nome del file da stampare: quello dell'artefatto, con lettere, cifre,
/// spazi, `-`, `_` e `.`, il resto `_`, e l'estensione `.pdf`, perché il
/// sistema scelga il lettore dei PDF; un nome troppo lungo si accorcia prima
/// dell'estensione.
fn file_name(name: &str) -> String {
    let mut clean: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = clean.trim_matches(|c: char| c == '.' || c == ' ');
    if trimmed.is_empty() {
        clean = "drawing".to_string();
    } else if trimmed.len() != clean.len() {
        clean = trimmed.to_string();
    }
    let extension = if clean.to_ascii_lowercase().ends_with(".pdf") {
        clean.split_off(clean.len() - 4)
    } else {
        ".pdf".to_string()
    };
    while clean.len() + extension.len() > NAME_MAX {
        clean.pop();
    }
    clean + &extension
}

/// Scrive `bytes` in una cartella nuova `fub-print-…` sotto `base`, leggibile
/// soltanto da chi usa l'app. Se il file non si scrive, la cartella se ne va.
fn prepare(base: &Path, name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let mut builder = tempfile::Builder::new();
    builder.prefix(PREFIX);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o700));
    }
    let dir = builder.tempdir_in(base)?;
    let name = file_name(name);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(dir.path().join(&name))?.write_all(bytes)?;
    Ok(dir.keep().join(name))
}

/// Toglie da `base` le cartelle di stampa più vecchie di un giorno a `now`.
/// Soltanto cartelle vere col prefisso: un collegamento non si segue.
fn sweep(base: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().starts_with(PREFIX) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let old = meta
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE);
        if meta.is_dir() && old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Le cartelle in cui si cerca un programma del sistema: quelle che scrive
/// l'amministratore, nell'ordine in cui le installano le distribuzioni (la
/// penultima è quella di NixOS, l'ultima di Guix). Il `PATH` no: lo decide
/// l'ambiente di chi avvia l'app.
#[cfg(all(unix, not(target_os = "macos")))]
const SYSTEM_DIRS: &[&str] = &[
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/run/current-system/sw/bin",
    "/run/current-system/profile/bin",
];
/// Su macOS `open` e i suoi pari stanno in `/usr/bin`, che il sistema protegge.
#[cfg(target_os = "macos")]
const SYSTEM_DIRS: &[&str] = &["/usr/bin"];

/// Il percorso assoluto del programma del sistema `name`, o niente se nessuna
/// delle cartelle del sistema lo ha. Mai dal `PATH`.
#[cfg(unix)]
pub(crate) fn system_program(name: &str) -> Option<PathBuf> {
    find_program(SYSTEM_DIRS.iter().map(Path::new), name)
}

/// Il percorso assoluto di `name` nella cartella di Windows: `explorer.exe`
/// sta lì. La cartella la dà il sistema ([`windows_dir`]), non l'ambiente:
/// `SystemRoot` lo sceglie chi avvia l'app, come il `PATH`.
#[cfg(windows)]
pub(crate) fn system_program(name: &str) -> Option<PathBuf> {
    let path = windows_dir()?.join(name);
    path.is_file().then_some(path)
}

/// La cartella di Windows del sistema (`C:\Windows` di solito), da
/// `GetSystemWindowsDirectoryW`: è quella condivisa da tutti gli utenti, anche
/// sotto Terminal Server, e non legge variabili d'ambiente. Niente se la
/// chiamata non riesce o non dà un percorso assoluto: meglio «nessun
/// programma» che indovinare una cartella.
#[cfg(windows)]
fn windows_dir() -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;

    /// Il percorso più lungo che Windows conosce, in unità UTF-16.
    const MAX_LEN: usize = 32_768;
    let mut buffer = vec![0u16; 260];
    let len = loop {
        let capacity = u32::try_from(buffer.len()).ok()?;
        // SAFETY: `buffer` è nostro, scrivibile e lungo `capacity` unità
        // UTF-16; la funzione non scrive oltre `capacity` e non trattiene il
        // puntatore dopo il ritorno.
        let written = unsafe { GetSystemWindowsDirectoryW(buffer.as_mut_ptr(), capacity) };
        let written = usize::try_from(written).ok()?;
        match written {
            // Errore della chiamata.
            0 => return None,
            // Ci stava: `written` unità, senza il terminatore.
            n if n < buffer.len() => break n,
            // Non ci stava: `written` è la misura che serve, terminatore
            // compreso. Si riprova una volta più grande, fino al tetto.
            n if n <= MAX_LEN && n > buffer.len() => buffer.resize(n, 0),
            _ => return None,
        }
    };
    let dir = PathBuf::from(OsString::from_wide(&buffer[..len]));
    dir.is_absolute().then_some(dir)
}

/// Il primo `dir/name` che è un programma di cui fidarsi.
#[cfg(unix)]
fn find_program<'a>(dirs: impl IntoIterator<Item = &'a Path>, name: &str) -> Option<PathBuf> {
    dirs.into_iter()
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .find(|path| trusted_program(path))
}

/// Un file regolare (anche in fondo a un collegamento, come in NixOS),
/// eseguibile, che né il gruppo né gli altri possono riscrivere.
#[cfg(unix)]
fn trusted_program(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|meta| {
        let mode = meta.permissions().mode();
        meta.is_file() && mode & 0o111 != 0 && mode & 0o022 == 0
    })
}

/// Il programma che apre `path` col programma che il sistema sceglie, o
/// niente se il sistema non ce l'ha nelle sue cartelle.
pub(crate) fn opener(path: &Path) -> Option<Command> {
    #[cfg(target_os = "macos")]
    let program = system_program("open")?;
    #[cfg(target_os = "windows")]
    let program = system_program("explorer.exe")?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = system_program("xdg-open")?;
    let mut command = Command::new(program);
    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Some(command)
}

/// Apre `path` nel programma del sistema.
fn open_with_system(path: &Path) -> PrintOutcome {
    if opener(path).is_some_and(launched) {
        PrintOutcome::Opened
    } else {
        PrintOutcome::NoViewer
    }
}

/// Fa partire `command`, che passa qualcosa al sistema, e dice se il sistema
/// l'ha preso. Un programma che non parte, o un'uscita che non riesce entro
/// [`OPEN_WAIT`], vuol dire di no; dopo, chi è ancora aperto lo si lascia
/// andare, e così chi non dice com'è andata. `explorer.exe` esce con 1 anche
/// quando apre, quindi lì conta soltanto che parta.
pub(crate) fn launched(mut command: Command) -> bool {
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    if cfg!(target_os = "windows") {
        std::thread::spawn(move || child.wait());
        return true;
    }
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < OPEN_WAIT => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) | Err(_) => {
                std::thread::spawn(move || child.wait());
                return true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_keeps_the_name_of_the_artifact_and_ends_in_pdf() {
        assert_eq!(file_name("Ciclo dell'acqua.pdf"), "Ciclo dell_acqua.pdf");
        assert_eq!(file_name("Città, tavola 1.PDF"), "Città_ tavola 1.PDF");
        assert_eq!(file_name("piano"), "piano.pdf");
        assert_eq!(file_name("..pdf"), "pdf.pdf");
        assert_eq!(file_name("..."), "drawing.pdf");
        assert_eq!(file_name("a&b|c\"d.pdf"), "a_b_c_d.pdf");
    }

    #[test]
    fn the_pdf_goes_in_a_folder_of_its_own_that_only_its_owner_reads() {
        let base = tempfile::tempdir().unwrap();
        let first = prepare(base.path(), "Piano.pdf", b"%PDF-1.7 uno").unwrap();
        let second = prepare(base.path(), "Piano.pdf", b"%PDF-1.7 due").unwrap();
        assert_ne!(first.parent(), second.parent());
        assert_eq!(fs::read(&first).unwrap(), b"%PDF-1.7 uno");
        assert_eq!(first.file_name().unwrap(), "Piano.pdf");
        let folder = first.parent().unwrap();
        assert!(folder
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(PREFIX));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(folder).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn folders_older_than_a_day_go_away_and_nothing_else_does() {
        let base = tempfile::tempdir().unwrap();
        let printed = prepare(base.path(), "Vecchio.pdf", b"%PDF-1.7").unwrap();
        let folder = printed.parent().unwrap().to_path_buf();
        let other = base.path().join("altro");
        fs::create_dir(&other).unwrap();
        let loose = base.path().join("fub-print-file");
        fs::write(&loose, b"x").unwrap();
        sweep(base.path(), SystemTime::now());
        assert!(folder.exists(), "una cartella di adesso resta");
        sweep(
            base.path(),
            SystemTime::now() + STALE + Duration::from_secs(60),
        );
        assert!(!folder.exists(), "una cartella di ieri se ne va");
        assert!(other.exists(), "una cartella senza il prefisso resta");
        assert!(loose.exists(), "un file col prefisso resta");
    }

    #[test]
    fn a_long_name_gets_shorter_before_the_extension() {
        let long = format!("{}.pdf", "è".repeat(200));
        let name = file_name(&long);
        assert!(name.len() <= NAME_MAX, "{}", name.len());
        assert!(name.ends_with("è.pdf"));
        let base = tempfile::tempdir().unwrap();
        let path = prepare(base.path(), &long, b"%PDF-1.7").unwrap();
        assert_eq!(path.file_name().unwrap().to_string_lossy(), name);
    }

    #[test]
    fn a_folder_that_is_not_there_is_an_error() {
        let base = tempfile::tempdir().unwrap();
        assert!(prepare(&base.path().join("manca"), "Piano.pdf", b"%PDF-1.7").is_err());
    }

    #[test]
    fn the_outcome_reaches_the_shell_by_its_status() {
        let outcome = |value: PrintOutcome| serde_json::to_value(value).unwrap();
        assert_eq!(
            outcome(PrintOutcome::Opened),
            serde_json::json!({"status": "opened"})
        );
        assert_eq!(
            outcome(PrintOutcome::NoViewer),
            serde_json::json!({"status": "no_viewer"})
        );
        assert_eq!(
            outcome(PrintOutcome::Unwritable {
                reason: "disk full".into()
            }),
            serde_json::json!({"status": "unwritable", "reason": "disk full"})
        );
    }

    /// Il programma del sistema si prende per percorso assoluto da una delle
    /// sue cartelle, mai dal `PATH`: un `xdg-open` messo davanti nel `PATH`
    /// non riceve il percorso del file (B2 dell'audit).
    #[cfg(unix)]
    #[test]
    fn the_system_program_comes_from_the_system_folders_and_never_from_path() {
        use std::os::unix::fs::PermissionsExt;
        let write = |path: &Path, mode: u32| {
            fs::write(path, b"#!/bin/sh\n").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        };
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let dirs = [first.path(), second.path()];

        assert_eq!(find_program(dirs, "apri"), None);
        // Non eseguibile, o riscrivibile dal gruppo o dagli altri: non conta.
        write(&first.path().join("apri"), 0o644);
        assert_eq!(find_program(dirs, "apri"), None);
        write(&first.path().join("apri"), 0o775);
        assert_eq!(find_program(dirs, "apri"), None);
        write(&first.path().join("apri"), 0o757);
        assert_eq!(find_program(dirs, "apri"), None);
        // Una cartella col nome è una cartella, non un programma.
        fs::create_dir(second.path().join("apri")).unwrap();
        assert_eq!(find_program(dirs, "apri"), None);
        write(&first.path().join("apri"), 0o755);
        assert_eq!(find_program(dirs, "apri"), Some(first.path().join("apri")));
        // Una cartella relativa non si guarda: dipenderebbe dalla cartella
        // corrente.
        assert_eq!(find_program([Path::new(".")], "apri"), None);

        // Un programma che sta fuori dalle cartelle del sistema non si trova.
        let name = "fub-programma-fuori-dal-sistema";
        let elsewhere = tempfile::tempdir().unwrap();
        write(&elsewhere.path().join(name), 0o755);
        assert_eq!(system_program(name), None);

        // Quello che `opener` chiama è un percorso assoluto di una cartella del
        // sistema, dove il sistema ce l'ha.
        if let Some(command) = opener(Path::new("/tmp/nota.pdf")) {
            let program = Path::new(command.get_program());
            assert!(program.is_absolute(), "{program:?}");
            assert!(SYSTEM_DIRS
                .iter()
                .any(|dir| program.parent() == Some(Path::new(dir))));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_program_every_linux_has_is_found_by_absolute_path() {
        let sh = system_program("sh").expect("every Linux has sh in a system folder");
        assert!(sh.is_absolute());
        assert!(sh.starts_with("/usr/bin") || sh.starts_with("/bin") || sh.starts_with("/run"));
    }

    /// La cartella viene dal sistema e `explorer.exe` è lì: la prova che la
    /// chiamata a `GetSystemWindowsDirectoryW` legge bene la risposta. Non
    /// tocca `SystemRoot`: cambiarlo qui cambierebbe anche i figli delle
    /// altre prove che girano insieme.
    #[cfg(windows)]
    #[test]
    fn explorer_is_found_in_the_windows_folder_the_system_reports() {
        let dir = windows_dir().expect("Windows reports its folder");
        assert!(dir.is_absolute(), "{dir:?}");
        assert!(dir.is_dir(), "{dir:?}");
        let explorer =
            system_program("explorer.exe").expect("explorer.exe is in the Windows folder");
        assert_eq!(explorer, dir.join("explorer.exe"));
        let command = opener(Path::new(r"C:\nota.pdf")).expect("explorer.exe opens files");
        assert_eq!(Path::new(command.get_program()), explorer);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_with_the_prefix_is_not_followed() {
        let base = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let kept = target.path().join("da tenere.txt");
        fs::write(&kept, b"x").unwrap();
        std::os::unix::fs::symlink(target.path(), base.path().join("fub-print-link")).unwrap();
        sweep(
            base.path(),
            SystemTime::now() + STALE + Duration::from_secs(60),
        );
        assert!(kept.exists());
    }
}
