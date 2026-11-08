//! «Apri con»: le app Craft che aprono un documento del vault.
//!
//! [`external_editors`] risponde quali app della tabella ([`editors::EDITORS`])
//! aprono un file e quali sono installate; [`open_with`] gli passa il file, in
//! quest'ordine:
//!
//! 1. il componente `fub.craft` acceso, un'app che Fub conosce, che apre
//!    l'estensione del file e che è installata;
//! 2. il file dentro il vault ([`crate::vault_path::inside`]), col suo percorso
//!    canonico e assoluto;
//! 3. un'app avviata da Fub, ancora aperta e con un [`Channel`]: il file
//!    passa dal canale ([`OpenHow::InRunning`]); se il canale non risponde si
//!    va avanti;
//! 4. un'app che su questo sistema tiene una finestra sola: la si avvia col
//!    file, e lei lo passa alla finestra aperta ([`OpenHow::Forwarded`]);
//! 5. altrimenti un processo nuovo ([`OpenHow::NewProcess`]).
//!
//! Le app avviate stanno in un registro del processo, una voce per app con il
//! pid dell'ultimo avvio; la voce cade quando quel processo esce
//! ([`launch::on_exit`]). «Già aperta» vuol dire «avviata da Fub e non
//! uscita»: un'app aperta da un'altra parte Fub non la vede. Il canale nasce
//! solo per un'app con un token e una porta nota ([`editors::Control::usable`]):
//! nessuna delle sette lo è ancora (D-2), quindi ogni voce ha `channel: None`
//! e il punto 3 si prova con un'app di prova.
//!
//! Il programma riceve il file come un argomento solo, assoluto: un nome che
//! comincia con `-` non diventa un'opzione, uno con gli spazi resta intero. Gli
//! errori portano una chiave `host.open_with.*` del catalogo del core e il nome
//! dell'app, mai il percorso del programma.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;

use super::channel::Channel;
use super::editors::{self, Editor, Env, Launch, Os};
use super::launch::{self, LaunchError};
use super::CRAFT_ID;
use crate::open_with::{ExternalEditor, OpenHow, OpenedWith};
use crate::session::Host;

/// L'app che riceve la pagina, `--page N` prima del file.
const PAGE_EDITOR: &str = "pdfcraft";

/// Dove si cerca `flatpak` per avviare un'app installata come Flatpak.
const FLATPAK_PROGRAMS: &[&str] = &["/usr/bin/flatpak", "/bin/flatpak"];

/// Il programma che su macOS apre un pacchetto `.app`.
const MAC_OPEN: &str = "/usr/bin/open";

/// Un'app avviata da Fub: il pid dell'ultimo avvio e il canale, se l'app ne ha
/// uno. Il canale è in un `Arc` perché si usa fuori dal lucchetto del
/// registro: una risposta lenta non ferma gli altri «Apri con».
#[derive(Debug)]
pub struct Started {
    pub pid: u32,
    pub channel: Option<Arc<Channel>>,
}

/// Le app avviate da Fub, per id.
#[derive(Debug, Default)]
pub(crate) struct Registry {
    apps: Mutex<HashMap<String, Started>>,
}

impl Registry {
    fn apps(&self) -> MutexGuard<'_, HashMap<String, Started>> {
        self.apps
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Segna che Fub ha avviato `id` col processo `pid`; la voce cade quando
    /// quel processo esce. Un avvio nuovo della stessa app prende il posto del
    /// vecchio, e l'uscita del vecchio non lo tocca.
    pub(crate) fn started(&'static self, id: &str, pid: u32, channel: Option<Arc<Channel>>) {
        self.apps().insert(id.to_string(), Started { pid, channel });
        let id = id.to_string();
        // Fuori dal lucchetto: se il processo è già uscito `on_exit` chiama
        // subito, da qui.
        launch::on_exit(pid, Box::new(move || self.exited(&id, pid)));
    }

    fn exited(&self, id: &str, pid: u32) {
        let mut apps = self.apps();
        if apps.get(id).is_some_and(|started| started.pid == pid) {
            apps.remove(id);
        }
    }

    /// Se Fub ha avviato `id` e il processo non è ancora uscito.
    pub(crate) fn running(&self, id: &str) -> bool {
        self.apps()
            .get(id)
            .is_some_and(|started| launch::running(started.pid))
    }

    /// Il canale dell'app `id`, se Fub l'ha avviata, è ancora aperta e ne ha
    /// uno.
    fn channel(&self, id: &str) -> Option<Arc<Channel>> {
        self.apps()
            .get(id)
            .filter(|started| launch::running(started.pid))
            .and_then(|started| started.channel.clone())
    }
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

/// Se il componente `fub.craft` è acceso nel vault. Un vault che non è aperto
/// è l'errore di [`Host::bundles`].
fn craft_on(host: &Host, vault: Option<&str>) -> Result<bool, PluginError> {
    Ok(host
        .bundles(vault)?
        .iter()
        .any(|bundle| bundle.id == CRAFT_ID && bundle.mounted))
}

/// L'estensione di un percorso del vault, così com'è scritta; vuota se non ce
/// n'è una. Il confronto con la tabella lo fa [`editors::opens`].
fn extension_of(path: &str) -> &str {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
}

/// Dove sono installate le app, con le righe di `craft.editor-paths`.
fn found(host: &Host) -> Vec<editors::Found> {
    let overrides = match host.machine.effective(crate::settings::CRAFT_EDITOR_PATHS) {
        Ok((SettingValue::List(lines), _)) => lines,
        _ => Vec::new(),
    };
    editors::find(&Env::from_process(), &overrides)
}

pub(crate) fn external_editors(
    host: &Host,
    vault: Option<&str>,
    doc: Option<&str>,
) -> Result<Vec<ExternalEditor>, PluginError> {
    if !craft_on(host, vault)? {
        return Ok(Vec::new());
    }
    let extension = doc.map(extension_of);
    let found = found(host);
    let registry = registry();
    Ok(editors::EDITORS
        .iter()
        .filter(|editor| extension.is_none_or(|extension| editors::opens(editor, extension)))
        .map(|editor| ExternalEditor {
            id: editor.id.to_string(),
            name: editor.name.to_string(),
            opens: editor.opens.iter().map(|known| known.to_string()).collect(),
            installed: found
                .iter()
                .any(|found| found.id == editor.id && found.installed()),
            running: registry.running(editor.id),
        })
        .collect())
}

pub(crate) fn open_with(
    host: &Host,
    vault: Option<&str>,
    path: &str,
    editor: &str,
    page: Option<u32>,
) -> Result<OpenedWith, PluginError> {
    if !craft_on(host, vault)? {
        return Err(PluginError::Unserved(Text::key("host.open_with.off")));
    }
    let Some(editor) = editors::editor(editor) else {
        return Err(PluginError::BadArgs(Text::message(
            "host.open_with.unknown_editor",
            vec![Arg::text("editor", editor)],
        )));
    };
    if path.is_empty() {
        return Err(missing(path));
    }
    if !editors::opens(editor, extension_of(path)) {
        return Err(PluginError::BadArgs(Text::message(
            "host.open_with.wrong_kind",
            vec![Arg::text("app", editor.name), Arg::text("path", path)],
        )));
    }
    let Some(launch) = found(host)
        .into_iter()
        .find(|found| found.id == editor.id)
        .and_then(|found| found.gui)
    else {
        return Err(PluginError::NotFound(Text::message(
            "host.open_with.not_installed",
            vec![Arg::text("app", editor.name)],
        )));
    };
    let root = host.root(vault)?;
    let file =
        crate::vault_path::inside(root.as_std_path(), path).map_err(|error| match error {
            PluginError::NotFound(_) => missing(path),
            other => other,
        })?;
    let how = open_file(
        registry(),
        editor,
        &launch,
        path,
        &file,
        page,
        Os::current(),
    )?;
    Ok(OpenedWith {
        editor: editor.id.to_string(),
        how,
    })
}

/// Un percorso del vault che non porta a un file: non c'è, è vuoto, è una
/// cartella.
fn missing(path: &str) -> PluginError {
    PluginError::NotFound(Text::message(
        "host.open_with.missing",
        vec![Arg::text("path", path)],
    ))
}

/// I punti 3, 4 e 5: il canale dell'app aperta, o un avvio col file. `path` è
/// il percorso del vault, `file` quello sul disco; un percorso vuoto o che non
/// porta a un file (una cartella chiamata `x.vectorcraft`) non arriva né al
/// canale né all'app.
fn open_file(
    registry: &'static Registry,
    editor: &Editor,
    launch: &Launch,
    path: &str,
    file: &Path,
    page: Option<u32>,
    os: Os,
) -> Result<OpenHow, PluginError> {
    if path.is_empty() || !file.is_file() {
        return Err(missing(path));
    }
    if let Some(channel) = registry.channel(editor.id) {
        // Un canale che non risponde non è un errore per chi ha chiesto: il
        // file si passa all'app col suo programma, come se non ci fosse.
        if channel.open(file).is_ok() {
            return Ok(OpenHow::InRunning);
        }
    }
    let failed = |_: LaunchError| {
        PluginError::Io(Text::message(
            "host.open_with.launch_failed",
            vec![Arg::text("app", editor.name)],
        ))
    };
    let (program, args) = command_line(editor, launch, file, page)
        .ok_or(LaunchError::NotFound)
        .map_err(failed)?;
    let pid = launch::spawn_detached(&program, &args).map_err(failed)?;
    // Nessuna app della tabella ha ancora un canale che Fub possa usare (una
    // porta nota e un token): l'avvio non ne apre uno.
    registry.started(editor.id, pid, None);
    Ok(if editor.single_instance.contains(&os) {
        OpenHow::Forwarded
    } else {
        OpenHow::NewProcess
    })
}

/// Il programma e gli argomenti che aprono `file` con `editor`. `None` se il
/// programma che serve non c'è (`flatpak` per un Flatpak).
fn command_line(
    editor: &Editor,
    launch: &Launch,
    file: &Path,
    page: Option<u32>,
) -> Option<(PathBuf, Vec<OsString>)> {
    let page: Vec<OsString> = match page {
        Some(page) if editor.id == PAGE_EDITOR => {
            vec!["--page".into(), page.to_string().into()]
        }
        _ => Vec::new(),
    };
    let file = file.as_os_str().to_os_string();
    match launch {
        Launch::Program(program) => {
            let mut args = page;
            args.push(file);
            Some((program.clone(), args))
        }
        Launch::Flatpak(id) => {
            let flatpak = FLATPAK_PROGRAMS
                .iter()
                .map(PathBuf::from)
                .find(|program| program.is_file())?;
            let mut args: Vec<OsString> = vec!["run".into(), id.into()];
            args.extend(page);
            args.push(file);
            Some((flatpak, args))
        }
        Launch::MacApp(app) => {
            // `open` legge le sue opzioni prima del file; ciò che va all'app
            // segue `--args`.
            let mut args: Vec<OsString> = vec!["-a".into(), app.into(), file];
            if !page.is_empty() {
                args.push("--args".into());
                args.extend(page);
            }
            Some((PathBuf::from(MAC_OPEN), args))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pdfcraft() -> &'static Editor {
        editors::editor("pdfcraft").unwrap()
    }

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn the_command_line_puts_the_page_before_the_file_only_for_pdfcraft() {
        let file = Path::new("/v/-carta con spazi.pdf");
        let program = Launch::Program(PathBuf::from("/opt/pdfcraft"));
        let (path, list) = command_line(pdfcraft(), &program, file, Some(3)).unwrap();
        assert_eq!(path, PathBuf::from("/opt/pdfcraft"));
        assert_eq!(list, args(&["--page", "3", "/v/-carta con spazi.pdf"]));
        let vector = editors::editor("vectorcraft").unwrap();
        let (_, list) = command_line(vector, &program, file, Some(3)).unwrap();
        assert_eq!(
            list,
            args(&["/v/-carta con spazi.pdf"]),
            "the page is ignored"
        );
        let (_, list) = command_line(pdfcraft(), &program, file, None).unwrap();
        assert_eq!(list, args(&["/v/-carta con spazi.pdf"]));
    }

    #[test]
    fn a_mac_app_goes_through_open_with_its_arguments_after_args() {
        let app = Launch::MacApp(PathBuf::from("/Applications/PdfCraft.app"));
        let file = Path::new("/v/carta.pdf");
        let (path, list) = command_line(pdfcraft(), &app, file, Some(2)).unwrap();
        assert_eq!(path, PathBuf::from(MAC_OPEN));
        assert_eq!(
            list,
            args(&[
                "-a",
                "/Applications/PdfCraft.app",
                "/v/carta.pdf",
                "--args",
                "--page",
                "2"
            ])
        );
    }

    #[test]
    fn a_flatpak_runs_through_flatpak_when_there_is_one() {
        let app = Launch::Flatpak("ai.storyteller.pdfcraft".into());
        let file = Path::new("/v/carta.pdf");
        let found = FLATPAK_PROGRAMS
            .iter()
            .map(PathBuf::from)
            .find(|program| program.is_file());
        match (command_line(pdfcraft(), &app, file, Some(1)), found) {
            (Some((path, list)), Some(flatpak)) => {
                assert_eq!(path, flatpak);
                assert_eq!(
                    list,
                    args(&[
                        "run",
                        "ai.storyteller.pdfcraft",
                        "--page",
                        "1",
                        "/v/carta.pdf"
                    ])
                );
            }
            (None, None) => {}
            (line, flatpak) => panic!("{line:?} with flatpak at {flatpak:?}"),
        }
    }

    #[test]
    fn the_extension_is_taken_as_written() {
        assert_eq!(extension_of("Foto/IMG_0001.CR3"), "CR3");
        assert_eq!(extension_of("Foto/senza"), "");
        assert_eq!(extension_of("Foto/.nascosto"), "");
    }

    #[cfg(unix)]
    mod channel {
        use super::super::*;
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;
        use std::os::unix::fs::PermissionsExt;
        use std::thread;
        use std::time::{Duration, Instant};

        use crate::craft::channel::Framing;
        use crate::craft::editors::{Auth, Control, Protocol};

        /// Un'app di prova con un token: il canale le si può dare.
        const PROVA: Editor = Editor {
            id: "prova",
            name: "Prova",
            opens: &["prova"],
            gui: "prova",
            cli: None,
            single_instance: &[],
            control: Control {
                method: Some("app.open"),
                protocol: Protocol::Line,
                auth: Auth::Token { env: None },
                port_known: true,
            },
        };

        fn leaked() -> &'static Registry {
            Box::leak(Box::new(Registry::default()))
        }

        fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
            let start = Instant::now();
            while !done() {
                assert!(start.elapsed() < Duration::from_secs(10), "{what}");
                thread::sleep(Duration::from_millis(10));
            }
        }

        /// Uno script che segna di essere partito e aspetta `<file>.stop`
        /// (al più 20 s, perché non resti vivo comunque).
        fn waiting_app(dir: &Path) -> PathBuf {
            let path = dir.join("prova.sh");
            std::fs::write(
                &path,
                "#!/bin/sh\nfor a; do last=$a; done\necho $$ > \"$last.pid\"\n\
                 n=0\nwhile [ ! -e \"$last.stop\" ] && [ $n -lt 400 ]; do sleep 0.05; n=$((n+1)); done\n",
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            path
        }

        #[test]
        fn a_running_app_with_a_channel_gets_the_file_there_and_a_dead_one_falls_back() {
            let dir = tempfile::tempdir().unwrap();
            let program = waiting_app(dir.path());
            let file = dir.path().join("carta.prova");
            std::fs::write(&file, "x").unwrap();
            let registry = leaked();
            let launch = Launch::Program(program.clone());

            // Il primo avvio: un processo nuovo, senza canale.
            let how = open_file(
                registry,
                &PROVA,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::Linux,
            )
            .unwrap();
            assert_eq!(how, OpenHow::NewProcess);
            assert!(registry.running("prova"));
            let pid = registry.apps().get("prova").unwrap().pid;

            // L'app aperta riceve un canale che risponde: il file passa di lì,
            // e nessun processo nuovo parte.
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut writer = stream;
                let mut lines = Vec::new();
                for _ in 0..2 {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    lines.push(line);
                    writer.write_all(b"{\"result\":true}\n").unwrap();
                }
                lines
            });
            let channel = Channel::for_control(&PROVA.control, port).unwrap().unwrap();
            let token = channel.token().to_string();
            registry.apps().get_mut("prova").unwrap().channel = Some(Arc::new(channel));
            let how = open_file(
                registry,
                &PROVA,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::Linux,
            )
            .unwrap();
            assert_eq!(how, OpenHow::InRunning);
            let lines = server.join().unwrap();
            assert!(lines[0].contains(&token), "the token goes first");
            assert!(lines[1].contains("app.open"), "{}", lines[1]);
            assert!(lines[1].contains("carta.prova"), "{}", lines[1]);
            assert_eq!(registry.apps().get("prova").unwrap().pid, pid);

            // Un canale che non risponde più: si avvia l'app col file.
            let closed = TcpListener::bind("127.0.0.1:0").unwrap();
            let dead = closed.local_addr().unwrap().port();
            drop(closed);
            registry.apps().get_mut("prova").unwrap().channel =
                Some(Arc::new(Channel::new(dead, Framing::Line).unwrap()));
            let how = open_file(
                registry,
                &PROVA,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::Linux,
            )
            .unwrap();
            assert_eq!(how, OpenHow::NewProcess);
            let second = registry.apps().get("prova").unwrap().pid;
            assert_ne!(second, pid);

            // Lo stop fa uscire tutti e due; l'uscita del primo non toglie la
            // voce del secondo, quella del secondo sì.
            std::fs::write(dir.path().join("carta.prova.stop"), "").unwrap();
            wait_until("the two apps exit", || {
                !launch::running(pid) && !launch::running(second)
            });
            wait_until("the entry goes", || registry.apps().get("prova").is_none());
        }

        #[test]
        fn an_app_that_fails_to_start_says_its_name_and_not_its_program() {
            let dir = tempfile::tempdir().unwrap();
            let file = dir.path().join("carta.prova");
            std::fs::write(&file, "x").unwrap();
            let registry = leaked();
            let launch = Launch::Program(PathBuf::from("/manca/del/tutto/prova"));
            let error = open_file(
                registry,
                &PROVA,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::Linux,
            )
            .unwrap_err();
            let PluginError::Io(text) = &error else {
                panic!("{error:?}");
            };
            let message = text.as_message().unwrap();
            assert_eq!(message.key, "host.open_with.launch_failed");
            let shown = format!("{error:?}");
            assert!(!shown.contains("/manca/del/tutto"), "{shown}");
            assert!(shown.contains("Prova"), "{shown}");
            assert!(!registry.running("prova"));
        }

        #[test]
        fn a_single_instance_app_is_forwarded_on_its_systems() {
            let dir = tempfile::tempdir().unwrap();
            let program = waiting_app(dir.path());
            let file = dir.path().join("una.prova");
            std::fs::write(&file, "x").unwrap();
            std::fs::write(dir.path().join("una.prova.stop"), "").unwrap();
            let single = Editor {
                single_instance: &[Os::Linux, Os::Windows],
                ..PROVA
            };
            let registry = leaked();
            let launch = Launch::Program(program);
            let how = open_file(
                registry,
                &single,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::Linux,
            )
            .unwrap();
            assert_eq!(how, OpenHow::Forwarded);
            let first = registry.apps().get("prova").unwrap().pid;
            let how = open_file(
                registry,
                &single,
                &launch,
                "carta.prova",
                &file,
                None,
                Os::MacOs,
            )
            .unwrap();
            assert_eq!(how, OpenHow::NewProcess);
            let second = registry.apps().get("prova").unwrap().pid;
            wait_until("the apps exit", || {
                !launch::running(first) && !launch::running(second)
            });
        }
    }
}
