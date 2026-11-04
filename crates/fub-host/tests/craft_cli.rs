//! Le anteprime con la CLI di un'app Craft, dopo un gesto (N7, T11 e T29):
//! `Host::craft_render` e il job `craft.render` col suo biglietto.
//!
//! La CLI (`vectorcraft-cli`, `lightcraft-cli`, `pdfcraft-cli` o
//! `wordcraft-cli`) è uno script `/bin/sh` (`fub-craft-test-*`, in una
//! cartella del test) indicato da `craft.editor-paths`: conta le sue chiamate,
//! scrive il suo pid, i suoi argomenti e il percorso del file che riceve, e fa
//! quello che il caso vuole (un PNG, un JPEG, niente, un link, troppi byte,
//! aspetta). Alla fine di
//! ogni caso nessun pid scritto è vivo (`kill -0`) e la cartella privata non
//! c'è più. Nessun test avvia un'app vera.
//!
//! I casi girano uno alla volta: un processo che scrive uno script mentre un
//! altro thread ne avvia uno può dare `ETXTBSY`, e le tabelle del job sono di
//! processo.

#![cfg(all(unix, feature = "craft"))]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::settings::SettingValue;
use fub_abi::traits::{HostApi, JobSpec, Plugin, PluginManifest, PluginPermissions};
use fub_abi::{Event, PluginError};
use fub_format_craft::{
    CraftPreview, Missing, PreviewOrigin, PreviewSize, RenderConsent, PREVIEW_COMMAND, RENDER_JOB,
};
use fub_host::craft::CRAFT_ID;
use fub_host::registry::{Bundle, Registrar};
use fub_host::settings::{CRAFT_CLI_PREVIEWS, CRAFT_EDITOR_PATHS, CRAFT_PREVIEW_MAX_MIB};
use fub_host::Host;
use fub_kernel::bus::Subscription;

const DRAWING: &str = "Disegni/logo.vectorcraft";

fn serial() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Un PNG minimo: firma, `IHDR` e `IEND`.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    out.extend_from_slice(&13u32.to_be_bytes());
    out.extend_from_slice(b"IHDR");
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(b"IEND");
    out.extend_from_slice(&[0, 0, 0, 0]);
    out
}

/// Un JPEG minimo: SOI, SOF0 con le misure, SOS, EOI.
fn jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8, 0xFF, 0xC0, 0, 11, 8];
    out.extend_from_slice(&height.to_be_bytes());
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&[1, 1, 0x11, 0]);
    out.extend_from_slice(&[0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0]);
    out.extend_from_slice(&[0x55; 16]);
    out.extend_from_slice(&[0xFF, 0xD9]);
    out
}

/// Lo script di un caso, nella sua cartella: `calls` ha una riga per
/// chiamata, `pids` i pid, `input` il file ricevuto.
struct Script {
    dir: tempfile::TempDir,
    path: PathBuf,
}

impl Script {
    /// `body` gira dopo le righe comuni; `$out` è il file da scrivere.
    fn new(body: &str) -> Script {
        let dir = tempfile::Builder::new()
            .prefix("fub-craft-test-")
            .tempdir_in(env!("CARGO_TARGET_TMPDIR"))
            .unwrap();
        std::fs::write(dir.path().join("good.png"), png(32, 16)).unwrap();
        std::fs::write(dir.path().join("good.jpg"), jpeg(300, 200)).unwrap();
        let path = dir.path().join("fub-craft-test-cli.sh");
        // L'uscita è l'argomento che finisce in `/out.png`, dovunque sia.
        let text = format!(
            "#!/bin/sh\n\
             d=$(dirname \"$0\")\n\
             echo $$ >> \"$d/pids\"\n\
             echo x >> \"$d/calls\"\n\
             printf '%s\\n' \"$2\" > \"$d/input\"\n\
             printf '%s\\n' \"$@\" > \"$d/args\"\n\
             out=\n\
             for a in \"$@\"; do case \"$a\" in */out.png) out=\"$a\";; esac; done\n\
             {body}\n"
        );
        std::fs::write(&path, text).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        Script { dir, path }
    }

    fn good() -> Script {
        Script::new("cat \"$d/good.png\" > \"$out\"")
    }

    fn jpeg() -> Script {
        Script::new("cat \"$d/good.jpg\" > \"$out\"")
    }

    /// Gli argomenti dell'ultima chiamata.
    fn args(&self) -> Vec<String> {
        std::fs::read_to_string(self.file("args"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn file(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn calls(&self) -> usize {
        std::fs::read_to_string(self.file("calls"))
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }

    fn pids(&self) -> Vec<i32> {
        std::fs::read_to_string(self.file("pids"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }

    /// La cartella privata in cui la CLI ha ricevuto la copia.
    fn private_dir(&self) -> PathBuf {
        let input = std::fs::read_to_string(self.file("input")).unwrap();
        Path::new(input.trim()).parent().unwrap().to_path_buf()
    }

    /// Nessun pid scritto è vivo, e la cartella privata non c'è più.
    fn all_gone(&self) {
        for pid in self.pids() {
            wait_for("the script exits", || gone(pid));
        }
        if self.file("input").exists() {
            let private = self.private_dir();
            assert!(
                private
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("fub-craft-render-")),
                "{private:?}"
            );
            wait_for("the private folder goes away", || !private.exists());
        }
    }
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

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Un disegno senza anteprima, diverso per ogni caso: l'insieme «già
/// provato» è del processo e va per revisione.
fn drawing(case: &str, padding: usize) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "format_version": 4,
        "title": case,
        "layers": [],
        "padding": "x".repeat(padding),
    }))
    .unwrap()
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn new(script: &Script, case: &str, consent: &str) -> Vault {
        Vault::with(script, &[(DRAWING, drawing(case, 0))], consent)
    }

    fn with(script: &Script, files: &[(&str, Vec<u8>)], consent: &str) -> Vault {
        Vault::with_cli(script, "vectorcraft-cli", files, consent)
    }

    /// Un vault in cui `script` è la CLI `cli` (`lightcraft-cli`…).
    fn with_cli(script: &Script, cli: &str, files: &[(&str, Vec<u8>)], consent: &str) -> Vault {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        for (path, bytes) in files {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        let host = Host::without_watcher();
        host.open(&root).unwrap();
        host.wait_indexed(Some(root.as_str())).unwrap();
        host.set_setting_for_user(
            Some(root.as_str()),
            CRAFT_EDITOR_PATHS,
            SettingValue::List(vec![format!("{cli}={}", script.path.display())]),
        )
        .unwrap();
        let vault = Vault {
            _dir: dir,
            root,
            host,
        };
        vault.consent(consent);
        vault
    }

    fn vault(&self) -> Option<&str> {
        Some(self.root.as_str())
    }

    fn consent(&self, value: &str) {
        self.host
            .set_setting_for_user(
                self.vault(),
                CRAFT_CLI_PREVIEWS,
                SettingValue::Text(value.into()),
            )
            .unwrap();
    }

    fn preview_with(&self, args: serde_json::Value) -> CraftPreview {
        let outcome = self
            .host
            .invoke_user_command(self.vault(), PREVIEW_COMMAND, args, InvokeMode::Apply)
            .unwrap();
        match outcome.effect {
            CommandEffect::Custom { payload, .. } => serde_json::from_value(payload).unwrap(),
            other => panic!("{other:?}"),
        }
    }

    fn preview(&self, doc: &str) -> CraftPreview {
        self.preview_with(serde_json::json!({ "doc": doc, "size": "small" }))
    }

    fn render(&self, doc: &str) -> Result<CraftPreview, PluginError> {
        self.render_at(doc, PreviewSize::Small)
    }

    fn render_at(&self, doc: &str, size: PreviewSize) -> Result<CraftPreview, PluginError> {
        self.host.craft_render(self.vault(), doc, size)
    }

    fn bytes(&self, doc: &str) -> Vec<u8> {
        std::fs::read(self.root.join(doc)).unwrap()
    }

    fn events(&self) -> Subscription {
        self.host.subscribe(self.vault()).unwrap()
    }
}

/// L'esito del prossimo `craft.render` finito.
fn render_done(events: &Subscription) -> Result<CraftPreview, PluginError> {
    loop {
        let notice = events
            .recv_timeout(Duration::from_secs(30))
            .expect("the render job ends");
        if let Event::JobDone { job, result, .. } = notice.event {
            if job == RENDER_JOB {
                return result.map(|value| serde_json::from_value(value).unwrap());
            }
        }
    }
}

/// Se un altro `craft.render` è partito entro `within`.
fn another_render(events: &Subscription, within: Duration) -> bool {
    let until = Instant::now() + within;
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        match events.recv_timeout(left) {
            Ok(notice) => match notice.event {
                Event::JobStarted { job, .. } | Event::JobDone { job, .. } if job == RENDER_JOB => {
                    return true
                }
                _ => {}
            },
            Err(_) => return false,
        }
    }
    false
}

fn key_of(error: &PluginError) -> String {
    let text = match error {
        PluginError::BadArgs(text)
        | PluginError::NotFound(text)
        | PluginError::PermissionDenied(text)
        | PluginError::Unserved(text)
        | PluginError::Cancelled(text)
        | PluginError::Io(text) => text,
        other => panic!("{other:?}"),
    };
    text.as_message()
        .map(|message| message.key.clone())
        .unwrap_or_else(|| panic!("a literal error: {error:?}"))
}

#[test]
fn without_consent_the_offer_is_there_and_nothing_starts() {
    let _serial = serial();
    let script = Script::good();
    for consent in ["ask", "off"] {
        let vault = Vault::new(&script, &format!("consenso {consent}"), consent);
        let preview = vault.preview(DRAWING);
        assert!(preview.image.is_none());
        assert_eq!(preview.missing, Some(Missing::Absent));
        let offer = preview.render.expect("the CLI is offered");
        assert_eq!(offer.app, "VectorCraft");
        let expected = if consent == "ask" {
            RenderConsent::Ask
        } else {
            RenderConsent::Off
        };
        assert_eq!(offer.consent, expected);
        let error = vault.render(DRAWING).unwrap_err();
        assert!(
            matches!(error, PluginError::PermissionDenied(_)),
            "{error:?}"
        );
        assert_eq!(key_of(&error), "host.craft_render.no_consent");
    }
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 0);
}

#[test]
fn with_consent_one_gesture_makes_one_preview_and_the_cache_answers_after() {
    let _serial = serial();
    let script = Script::new("sleep 0.5\ncat \"$d/good.png\" > \"$out\"");
    let vault = Vault::new(&script, "consenso on", "on");
    let before = vault.bytes(DRAWING);
    let events = vault.events();

    let first = vault.render(DRAWING).unwrap();
    assert!(first.queued, "{first:?}");
    assert!(first.image.is_none());
    // Una seconda richiesta mentre la prima lavora: nessuna CLI in più.
    let second = vault.render(DRAWING).unwrap();
    assert!(second.queued, "{second:?}");

    let done = render_done(&events).unwrap();
    assert_eq!(done.origin, PreviewOrigin::Cli);
    assert_eq!(done.missing, None);
    assert!(done.render.is_none());
    assert!(!done.queued);
    let image = done.image.expect("the CLI image");
    assert_eq!((image.width, image.height), (32, 16));
    assert!(!another_render(&events, Duration::from_millis(800)));
    assert_eq!(script.calls(), 1);

    let cached = vault.preview(DRAWING);
    assert_eq!(cached.origin, PreviewOrigin::Cli);
    assert!(cached.image.is_some());
    assert!(cached.render.is_none());
    // Con l'anteprima in cache il gesto risponde da lì, senza un'altra CLI.
    let again = vault.render(DRAWING).unwrap();
    assert!(!again.queued);
    assert_eq!(again.origin, PreviewOrigin::Cli);
    assert_eq!(script.calls(), 1);

    assert_eq!(
        vault.bytes(DRAWING),
        before,
        "the CLI never touches the vault"
    );
    let private = script.private_dir();
    assert!(
        !private.starts_with(vault.root.as_std_path()),
        "{private:?}"
    );
    assert_eq!(
        std::fs::read_to_string(script.file("input"))
            .unwrap()
            .trim(),
        private.join("in.vectorcraft").to_str().unwrap()
    );
    script.all_gone();
}

/// Un bundle che prova ad arrivare alla CLI senza il gesto.
struct Probe {
    seen: Arc<Mutex<Vec<Result<(), PluginError>>>>,
    doc: String,
}

const PROBE_ID: &str = "demo.craft-render";

fn probe_manifest() -> PluginManifest {
    PluginManifest::new(PROBE_ID, "Demo anteprime").granting(PluginPermissions::of(&[
        fub_abi::options::permission::RUN_COMMAND,
        fub_abi::options::permission::WRITE_SETTINGS,
    ]))
}

impl Bundle for Probe {
    fn manifest(&self) -> PluginManifest {
        probe_manifest()
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(ProbePlugin {
            seen: Arc::clone(&self.seen),
            doc: self.doc.clone(),
        })
    }

    fn register(&self, _registrar: &mut Registrar<'_>) -> Vec<String> {
        Vec::new()
    }
}

struct ProbePlugin {
    seen: Arc<Mutex<Vec<Result<(), PluginError>>>>,
    doc: String,
}

impl Plugin for ProbePlugin {
    fn manifest(&self) -> PluginManifest {
        probe_manifest()
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let mut seen = self.seen.lock().unwrap();
        seen.push(
            host.run_command(
                PREVIEW_COMMAND,
                serde_json::json!({ "doc": self.doc, "size": "small", "render": true }),
            )
            .map(|_| ()),
        );
        seen.push(
            host.spawn_job(JobSpec {
                job: RENDER_JOB.into(),
                payload: serde_json::json!({ "doc": self.doc, "size": "small" }),
            })
            .map(|_| ()),
        );
        seen.push(host.set_setting(CRAFT_CLI_PREVIEWS, SettingValue::Text("on".into())));
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

#[test]
fn no_way_without_the_gesture_starts_the_cli() {
    let _serial = serial();
    let script = Script::good();
    let vault = Vault::new(&script, "senza gesto", "on");
    no_way_without_the_gesture(&vault, &script, DRAWING, "VectorCraft");
}

/// Con il consenso acceso e la CLI trovata, nessuna via senza il gesto avvia
/// la CLI di `doc`: `craft.preview` con `render`, il job chiamato per nome
/// (come `Call::InvokeJob` o `fub_invoke`) con un biglietto assente o
/// inventato, un componente di terzi con i permessi di comandi e impostazioni.
fn no_way_without_the_gesture(vault: &Vault, script: &Script, doc: &str, app: &str) {
    let before = vault.bytes(doc);

    // `craft.preview` resta in sola lettura, anche se gli si chiede di più.
    let preview = vault.preview_with(serde_json::json!({
        "doc": doc, "size": "small", "render": true,
    }));
    assert!(!preview.queued, "{doc}");
    assert_eq!(
        preview.render.as_ref().map(|offer| offer.app.as_str()),
        Some(app),
        "{doc}"
    );

    // Il job chiamato per nome, come `Call::InvokeJob` o `fub_invoke`.
    for payload in [
        serde_json::json!({ "doc": doc, "size": "small" }),
        serde_json::json!({ "doc": doc, "size": "small", "ticket": "" }),
        serde_json::json!({ "doc": doc, "size": "small", "ticket": "inventato" }),
        serde_json::json!({ "doc": doc, "size": "small", "ticket": "0".repeat(64) }),
        serde_json::json!({ "doc": doc, "size": "large", "ticket": "0".repeat(64) }),
        serde_json::json!({ "doc": doc, "size": "grande", "ticket": "x" }),
    ] {
        let error = vault
            .host
            .invoke_job(vault.vault(), CRAFT_ID, RENDER_JOB, payload)
            .unwrap_err();
        assert!(matches!(error, PluginError::Unserved(_)), "{error:?}");
        assert_eq!(key_of(&error), "render.no_ticket");
    }

    // Un componente di terzi, con i permessi di comandi e impostazioni.
    let seen = Arc::new(Mutex::new(Vec::new()));
    vault
        .host
        .mount_bundle(
            vault.vault(),
            Arc::new(Probe {
                seen: Arc::clone(&seen),
                doc: doc.to_owned(),
            }),
        )
        .unwrap();
    for permission in [
        fub_abi::options::permission::RUN_COMMAND,
        fub_abi::options::permission::WRITE_SETTINGS,
    ] {
        vault
            .host
            .set_setting_for_user(
                vault.vault(),
                &fub_abi::settings::permission_key(PROBE_ID, permission),
                SettingValue::Toggle(true),
            )
            .unwrap();
    }
    vault
        .host
        .set_plugin_enabled(vault.vault(), PROBE_ID, false)
        .unwrap();
    seen.lock().unwrap().clear();
    vault
        .host
        .set_plugin_enabled(vault.vault(), PROBE_ID, true)
        .unwrap();
    let results = std::mem::take(&mut *seen.lock().unwrap());
    assert_eq!(results.len(), 3, "{results:?}");
    assert!(results[0].is_ok(), "the preview is read-only: {results:?}");
    assert!(results[1].is_err(), "not its job: {results:?}");
    match &results[2] {
        Err(PluginError::PermissionDenied(_)) => {}
        other => panic!("{other:?}"),
    }
    vault.host.unmount_bundle(vault.vault(), PROBE_ID).unwrap();

    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(script.calls(), 0, "{doc}");
    assert_eq!(vault.bytes(doc), before, "{doc}");
}

#[test]
fn a_bad_answer_is_failed_and_the_same_revision_does_not_start_again() {
    let _serial = serial();
    let cases = [
        ("niente", "exit 0"),
        ("non un png", "echo ciao > \"$out\""),
        ("link", "ln -s \"$d/good.png\" \"$out\""),
        (
            "troppo",
            "cat \"$d/good.png\" > \"$out\"\nhead -c 17825792 /dev/zero >> \"$out\"",
        ),
        ("cartella", "mkdir \"$out\""),
        ("errore", "cat \"$d/good.png\" > \"$out\"\nexit 3"),
    ];
    for (case, body) in cases {
        let script = Script::new(body);
        let vault = Vault::new(&script, case, "on");
        let before = vault.bytes(DRAWING);
        let events = vault.events();
        assert!(vault.render(DRAWING).unwrap().queued, "{case}");
        let done = render_done(&events).unwrap();
        assert_eq!(done.origin, PreviewOrigin::None, "{case}");
        assert_eq!(done.missing, Some(Missing::Failed), "{case}");
        assert!(done.image.is_none() && done.render.is_none(), "{case}");
        script.all_gone();

        let after = vault.preview(DRAWING);
        assert_eq!(after.missing, Some(Missing::Failed), "{case}");
        assert!(after.render.is_none(), "{case}");
        let again = vault.render(DRAWING).unwrap();
        assert!(!again.queued, "{case}");
        assert_eq!(again.missing, Some(Missing::Failed), "{case}");
        assert_eq!(script.calls(), 1, "{case}");
        assert_eq!(vault.bytes(DRAWING), before, "{case}");
    }
}

#[test]
fn a_sleeping_cli_stops_when_the_job_is_cancelled() {
    let _serial = serial();
    let script = Script::new("sleep 25 &\necho $! >> \"$d/pids\"\nwait");
    let vault = Vault::new(&script, "annullato", "on");
    let events = vault.events();
    assert!(vault.render(DRAWING).unwrap().queued);
    let id = loop {
        let notice = events.recv_timeout(Duration::from_secs(10)).unwrap();
        if let Event::JobStarted { id, job } = notice.event {
            if job == RENDER_JOB {
                break id;
            }
        }
    };
    wait_for("the script starts", || script.pids().len() == 2);
    let start = Instant::now();
    vault.host.cancel_job(vault.vault(), id).unwrap();
    let error = render_done(&events).unwrap_err();
    assert!(matches!(error, PluginError::Cancelled(_)), "{error:?}");
    assert!(start.elapsed() < Duration::from_secs(10));
    script.all_gone();
    // Un annullamento non dice niente del file: il gesto si può rifare.
    assert!(vault.preview(DRAWING).render.is_some());
}

#[test]
fn a_sleeping_cli_stops_after_twenty_seconds() {
    let _serial = serial();
    let script = Script::new("sleep 25 &\necho $! >> \"$d/pids\"\nwait");
    let vault = Vault::new(&script, "tempo scaduto", "on");
    let events = vault.events();
    let start = Instant::now();
    assert!(vault.render(DRAWING).unwrap().queued);
    let done = render_done(&events).unwrap();
    let took = start.elapsed();
    assert!(took >= Duration::from_secs(19), "{took:?}");
    assert!(took < Duration::from_secs(24), "{took:?}");
    assert_eq!(done.missing, Some(Missing::Failed));
    script.all_gone();
}

#[test]
fn over_the_limit_no_copy_and_nothing_starts() {
    let _serial = serial();
    let script = Script::good();
    let vault = Vault::with(&script, &[(DRAWING, drawing("pesante", 1_100_000))], "on");
    vault
        .host
        .set_setting_for_user(
            vault.vault(),
            CRAFT_PREVIEW_MAX_MIB,
            SettingValue::Number(1.0),
        )
        .unwrap();
    let preview = vault.preview(DRAWING);
    assert_eq!(preview.missing, Some(Missing::OverLimit), "{preview:?}");
    assert!(preview.render.is_none());
    let error = vault.render(DRAWING).unwrap_err();
    assert_eq!(key_of(&error), "host.craft_render.over_limit");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 0);
}

#[test]
fn without_a_cli_or_with_a_preview_already_nothing_starts() {
    let _serial = serial();
    let script = Script::good();
    let vault = Vault::with(
        &script,
        &[
            (DRAWING, drawing("senza programma", 0)),
            ("Foto/ritocco.pcraft", pcraft_with_thumb()),
            (
                "Foto/IMG_0001.xmp",
                b"<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"/>".to_vec(),
            ),
        ],
        "on",
    );
    // Uno XMP non ha una CLI.
    let error = vault.render("Foto/IMG_0001.xmp").unwrap_err();
    assert_eq!(key_of(&error), "host.craft_render.no_cli");

    // Un `.pcraft` con la sua miniatura risponde con quella.
    let thumb = vault.render("Foto/ritocco.pcraft").unwrap();
    assert!(!thumb.queued);
    assert_eq!(thumb.origin, PreviewOrigin::File);
    assert!(thumb.image.is_some());

    // `vectorcraft-cli` indicato dove non c'è niente: nessun programma.
    vault
        .host
        .set_setting_for_user(
            vault.vault(),
            CRAFT_EDITOR_PATHS,
            SettingValue::List(vec!["vectorcraft-cli=/non/esiste/fub-craft-test".into()]),
        )
        .unwrap();
    let preview = vault.preview(DRAWING);
    assert_eq!(preview.missing, Some(Missing::Absent));
    assert!(preview.render.is_none(), "{preview:?}");
    let error = vault.render(DRAWING).unwrap_err();
    assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
    assert_eq!(key_of(&error), "host.craft_render.no_cli");

    // Un vault che non è aperto.
    assert!(vault
        .host
        .craft_render(Some("/non/aperto"), DRAWING, PreviewSize::Small)
        .is_err());
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 0);
}

/// Un `.pcraft` con `thumb.png`.
fn pcraft_with_thumb() -> Vec<u8> {
    use std::io::Write as _;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    writer.start_file("manifest.json", options).unwrap();
    writer
        .write_all(br#"{"format_version":"2","title":"Ritocco"}"#)
        .unwrap();
    writer.start_file("thumb.png", options).unwrap();
    writer.write_all(&png(40, 30)).unwrap();
    writer.finish().unwrap().into_inner()
}

#[test]
fn with_fub_craft_off_the_gesture_is_off() {
    let _serial = serial();
    let script = Script::good();
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(root.join("Disegni")).unwrap();
    std::fs::write(root.join(DRAWING), drawing("spento", 0)).unwrap();
    std::fs::create_dir_all(root.join(".fub")).unwrap();
    std::fs::write(
        root.join(".fub/settings.json"),
        serde_json::json!({"version": 1, "values": {"plugins.disabled": [CRAFT_ID]}}).to_string(),
    )
    .unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    let vault: Option<&str> = Some(Utf8Path::new(root.as_str()).as_str());
    host.set_setting_for_user(vault, CRAFT_CLI_PREVIEWS, SettingValue::Text("on".into()))
        .unwrap();
    let error = host
        .craft_render(vault, DRAWING, PreviewSize::Small)
        .unwrap_err();
    assert_eq!(key_of(&error), "host.craft_render.off");
    assert_eq!(script.calls(), 0);
}

// ---------------------------------------------------------------------------
// LightCraft, PdfCraft e WordCraft (T29).
// ---------------------------------------------------------------------------

/// Un RAW (un TIFF `II`) senza nessun JPEG dentro: un IFD vuoto. `case` lo
/// rende diverso per ogni caso, perché il «già provato» va per revisione.
fn raw_without_jpeg(case: &str) -> Vec<u8> {
    let mut out = b"II\x2a\0\x08\0\0\0\0\0\0\0\0\0".to_vec();
    out.extend_from_slice(case.as_bytes());
    out
}

/// Un RAW con il JPEG della fotocamera nell'IFD0.
fn raw_with_jpeg() -> Vec<u8> {
    let inside = jpeg(1620, 1080);
    let entry = |tag: u16, value: u32| {
        let mut out = tag.to_le_bytes().to_vec();
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&value.to_le_bytes());
        out
    };
    let mut out = b"II\x2a\0\x08\0\0\0".to_vec();
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend(entry(0x0201, 64));
    out.extend(entry(0x0202, u32::try_from(inside.len()).unwrap()));
    out.extend_from_slice(&0u32.to_le_bytes());
    out.resize(64, 0);
    out.extend_from_slice(&inside);
    out
}

fn pdf(case: &str) -> Vec<u8> {
    format!("%PDF-1.7\n% {case}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n").into_bytes()
}

/// Un `.docx` con o senza la miniatura che le relazioni indicano.
fn docx(case: &str, thumbnail: bool) -> Vec<u8> {
    use std::io::Write as _;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    writer.start_file("[Content_Types].xml", options).unwrap();
    writer
        .write_all(br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#)
        .unwrap();
    writer.start_file("_rels/.rels", options).unwrap();
    let thumb = if thumbnail {
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.png"/>"#
    } else {
        ""
    };
    writer
        .write_all(
            format!(
                r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>{thumb}</Relationships>"#
            )
            .as_bytes(),
        )
        .unwrap();
    writer.start_file("word/document.xml", options).unwrap();
    writer.write_all(case.as_bytes()).unwrap();
    if thumbnail {
        writer
            .start_file("docProps/thumbnail.png", options)
            .unwrap();
        writer.write_all(&png(60, 80)).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Gli argomenti attesi, con la cartella privata del caso.
fn expected(script: &Script, args: &[&str]) -> Vec<String> {
    let private = script.private_dir();
    args.iter()
        .map(|arg| match *arg {
            "{out}" => private.join("out.png").display().to_string(),
            other if other.starts_with("in.") => private.join(other).display().to_string(),
            other => other.to_owned(),
        })
        .collect()
}

/// Il gesto su `doc` alla misura `size`, fino all'esito del job.
fn render_through(vault: &Vault, doc: &str, size: PreviewSize) -> CraftPreview {
    let events = vault.events();
    let queued = vault.render_at(doc, size).unwrap();
    assert!(queued.queued, "{doc}: {queued:?}");
    render_done(&events).unwrap()
}

#[test]
fn lightcraft_develops_a_raw_without_a_jpeg_and_never_a_jpg() {
    let _serial = serial();
    let script = Script::good();
    let vault = Vault::with_cli(
        &script,
        "lightcraft-cli",
        &[
            ("Foto/IMG_0001.cr3", raw_without_jpeg("grande")),
            ("Foto/IMG_0002.CR3", raw_without_jpeg("piccola")),
            ("Foto/IMG_0003.nef", raw_with_jpeg()),
            ("Foto/IMG_0004.jpg", jpeg(640, 480)),
        ],
        "on",
    );
    let before = vault.bytes("Foto/IMG_0001.cr3");
    let offer = vault.preview("Foto/IMG_0001.cr3").render.expect("offered");
    assert_eq!(offer.app, "LightCraft");
    assert_eq!(offer.consent, RenderConsent::On);

    let done = render_through(&vault, "Foto/IMG_0001.cr3", PreviewSize::Large);
    assert_eq!(done.origin, PreviewOrigin::Cli, "{done:?}");
    assert_eq!(done.missing, None);
    let image = done.image.expect("the CLI image");
    assert_eq!((image.width, image.height), (32, 16));
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.cr3", "-o", "{out}", "--size", "2048"]
        )
    );
    script.all_gone();
    assert_eq!(script.calls(), 1);
    assert_eq!(vault.bytes("Foto/IMG_0001.cr3"), before);

    // L'estensione così come è scritta, e la misura piccola.
    render_through(&vault, "Foto/IMG_0002.CR3", PreviewSize::Small);
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.CR3", "-o", "{out}", "--size", "512"]
        )
    );
    script.all_gone();
    assert_eq!(script.calls(), 2);

    // Un RAW col suo JPEG risponde con quello, senza CLI.
    let inside = vault.render("Foto/IMG_0003.nef").unwrap();
    assert!(!inside.queued);
    assert_eq!(inside.origin, PreviewOrigin::File);
    assert!(inside.image.is_some());
    // Un `.jpg` la WebView lo mostra: non è un soggetto dell'anteprima.
    assert!(vault.render("Foto/IMG_0004.jpg").is_err());
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 2);
}

#[test]
fn without_lightcraft_there_is_no_offer_and_no_question() {
    let _serial = serial();
    let script = Script::good();
    // Lo script è la CLI di un'altra app: LightCraft non c'è.
    let vault = Vault::with_cli(
        &script,
        "vectorcraft-cli",
        &[("Foto/IMG_0001.CR3", raw_without_jpeg("senza LightCraft"))],
        "on",
    );
    let preview = vault.preview("Foto/IMG_0001.CR3");
    assert_eq!(preview.missing, Some(Missing::Absent));
    assert!(preview.render.is_none(), "{preview:?}");
    let error = vault.render("Foto/IMG_0001.CR3").unwrap_err();
    assert_eq!(key_of(&error), "host.craft_render.no_cli");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 0);
}

#[test]
fn pdfcraft_draws_the_first_page_and_a_jpeg_is_good() {
    let _serial = serial();
    let script = Script::jpeg();
    // Un nome che comincia con `-` non arriva mai alla CLI.
    let doc = "Libri/-manuale.pdf";
    let vault = Vault::with_cli(
        &script,
        "pdfcraft-cli",
        &[(doc, pdf("cinquecento pagine"))],
        "on",
    );
    assert_eq!(
        vault.preview(doc).render.map(|offer| offer.app),
        Some("PdfCraft".to_owned())
    );
    let done = render_through(&vault, doc, PreviewSize::Small);
    assert_eq!(done.origin, PreviewOrigin::Cli, "{done:?}");
    let image = done.image.expect("the CLI image");
    assert_eq!(image.media_type, "image/jpeg");
    assert_eq!(
        (image.width, image.height, image.orientation),
        (300, 200, 1)
    );
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.pdf", "--page", "1", "--dpi", "36", "--out", "{out}"]
        )
    );
    script.all_gone();
    // La cache risponde dopo, senza un'altra CLI.
    let cached = vault.preview(doc);
    assert_eq!(cached.origin, PreviewOrigin::Cli);
    assert_eq!(
        cached.image.map(|image| image.media_type),
        Some("image/jpeg".into())
    );
    assert_eq!(script.calls(), 1);
}

#[test]
fn an_encrypted_pdf_fails_once_and_the_same_revision_does_not_start_again() {
    let _serial = serial();
    let script = Script::new("echo 'il PDF è cifrato' >&2\nexit 1");
    let doc = "Libri/cifrato.pdf";
    let vault = Vault::with_cli(&script, "pdfcraft-cli", &[(doc, pdf("cifrato"))], "on");
    let done = render_through(&vault, doc, PreviewSize::Large);
    assert_eq!(done.missing, Some(Missing::Failed), "{done:?}");
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.pdf", "--page", "1", "--dpi", "144", "--out", "{out}"]
        )
    );
    script.all_gone();
    let after = vault.preview_with(serde_json::json!({ "doc": doc, "size": "large" }));
    assert_eq!(after.missing, Some(Missing::Failed));
    assert!(after.render.is_none());
    let again = vault.render_at(doc, PreviewSize::Large).unwrap();
    assert!(!again.queued);
    assert_eq!(again.missing, Some(Missing::Failed));
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 1);
}

#[test]
fn wordcraft_only_for_a_document_without_a_thumbnail() {
    let _serial = serial();
    let script = Script::good();
    let vault = Vault::with_cli(
        &script,
        "wordcraft-cli",
        &[
            ("Lettere/con.docx", docx("con miniatura", true)),
            ("Lettere/senza.docx", docx("senza miniatura", false)),
            (
                "Lettere/vecchia.doc",
                b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1 un .doc vecchio".to_vec(),
            ),
        ],
        "on",
    );
    // Con la miniatura: quella, e lo script resta a 0.
    let thumb = vault.render("Lettere/con.docx").unwrap();
    assert!(!thumb.queued);
    assert_eq!(thumb.origin, PreviewOrigin::File);
    assert_eq!(
        thumb.image.map(|image| (image.width, image.height)),
        Some((60, 80))
    );
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(script.calls(), 0);

    // Senza: WordCraft.
    assert_eq!(
        vault
            .preview("Lettere/senza.docx")
            .render
            .map(|offer| offer.app),
        Some("WordCraft".to_owned())
    );
    let done = render_through(&vault, "Lettere/senza.docx", PreviewSize::Small);
    assert_eq!(done.origin, PreviewOrigin::Cli, "{done:?}");
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.docx", "{out}", "--page", "1", "--scale", "0.5"]
        )
    );
    script.all_gone();

    // Un `.doc` vecchio: Fub non ne legge niente, la fa WordCraft.
    let done = render_through(&vault, "Lettere/vecchia.doc", PreviewSize::Large);
    assert_eq!(done.origin, PreviewOrigin::Cli, "{done:?}");
    assert_eq!(
        script.args(),
        expected(
            &script,
            &["render", "in.doc", "{out}", "--page", "1", "--scale", "1"]
        )
    );
    script.all_gone();
    assert_eq!(script.calls(), 2);
}

#[test]
fn no_way_without_the_gesture_starts_the_three_new_clis() {
    let _serial = serial();
    let cases = [
        (
            "lightcraft-cli",
            "Foto/IMG_0001.CR3",
            raw_without_jpeg("senza gesto"),
            "LightCraft",
        ),
        (
            "pdfcraft-cli",
            "Libri/manuale.pdf",
            pdf("senza gesto"),
            "PdfCraft",
        ),
        (
            "wordcraft-cli",
            "Lettere/lettera.docx",
            docx("senza gesto", false),
            "WordCraft",
        ),
    ];
    for (cli, doc, bytes, app) in cases {
        let script = Script::good();
        let vault = Vault::with_cli(&script, cli, &[(doc, bytes)], "on");
        no_way_without_the_gesture(&vault, &script, doc, app);
    }
}
