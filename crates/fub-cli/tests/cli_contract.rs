use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_fub-cli"))
        .args(args)
        .output()
        .expect("run fub-cli")
}

#[test]
fn callback_policy_is_owner_only_and_malformed_uris_fail_closed() {
    let tmp = tempfile::tempdir().unwrap();
    let config = tmp.path().join("config");
    let config = config.to_str().unwrap();
    let list = cli(&[
        "callback",
        "list",
        "--format",
        "json",
        "--config-dir",
        config,
    ]);
    assert!(
        list.status.success(),
        "{}",
        String::from_utf8_lossy(&list.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&list.stdout).unwrap()["ok"],
        true
    );
    let allowed = cli(&[
        "--config-dir",
        config,
        "--format",
        "json",
        "--yes",
        "callback",
        "allow",
        "https",
    ]);
    assert!(
        allowed.status.success(),
        "{}",
        String::from_utf8_lossy(&allowed.stderr)
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(tmp.path().join("config/callback-policy.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let denied = cli(&[
        "--config-dir",
        config,
        "--format",
        "json",
        "uri",
        "fub://capture?mode=create&title=A&success_callback=javascript%3Aalert(1)",
    ]);
    assert_eq!(denied.status.code(), Some(4));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&denied.stderr).unwrap()["ok"],
        false
    );
    let traversal = cli(&[
        "--config-dir",
        config,
        "--format",
        "json",
        "uri",
        "fub://open?note=..%2Fsecret.md",
    ]);
    assert_eq!(traversal.status.code(), Some(2));
}

#[test]
fn capture_commits_and_reports_one_structured_result() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    let result = cli(&[
        "--vault",
        vault.to_str().unwrap(),
        "--config-dir",
        config.to_str().unwrap(),
        "--format",
        "json",
        "--yes",
        "capture",
        "--title",
        "Notebook",
        "--text",
        "test body",
        "--note",
        "Notebook.md",
    ]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let response: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["doc"], "Notebook.md");
    assert!(std::fs::read_to_string(vault.join("Notebook.md"))
        .unwrap()
        .contains("test body"));
    let pairs = cli(&[
        "pair",
        "pairs",
        "--format",
        "json",
        "--config-dir",
        config.to_str().unwrap(),
    ]);
    assert!(
        pairs.status.success(),
        "{}",
        String::from_utf8_lossy(&pairs.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&pairs.stdout).unwrap()["ok"],
        true
    );
}

#[test]
fn create_and_uri_new_write_into_the_note_the_command_made() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    let run = |args: &[&str]| {
        let mut all = vec![
            "--vault",
            vault.to_str().unwrap(),
            "--config-dir",
            config.to_str().unwrap(),
            "--format",
            "json",
            "--yes",
        ];
        all.extend_from_slice(args);
        let output = cli(&all);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()
    };

    // Il nome senza estensione lo completa `note.create`, e il testo va nella
    // nota che ha creato, non nel nome chiesto.
    let created = run(&["create", "foo", "--text", "hello"]);
    assert_eq!(created["data"]["doc"], "foo.md");
    assert_eq!(
        std::fs::read_to_string(vault.join("foo.md")).unwrap(),
        "hello"
    );
    assert!(!vault.join("foo").exists());

    // `fub://new` prende il nome dal titolo e mette il titolo in testa.
    let titled = run(&["uri", "fub://new?title=Idee%3A%20marzo", "--execute"]);
    assert_eq!(titled["data"]["doc"], "Idee marzo.md");
    assert_eq!(
        std::fs::read_to_string(vault.join("Idee marzo.md")).unwrap(),
        "# Idee: marzo\n"
    );
}

#[cfg(unix)]
/// Un comando secco apre il vault, domanda ed esce: le domande sul grafo e il
/// piano di un `--dry-run` rispondono a indice pronto, non a indice vuoto con
/// `ok: true`. Le note sono abbastanza perché l'indicizzazione dell'apertura
/// duri più del tragitto fino alla domanda: su tre note la corsa si perdeva
/// di rado, e il banco non la vedrebbe.
#[test]
fn a_one_shot_command_answers_from_a_ready_index() {
    const LINKING: usize = 1500;
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(
        vault.join("b.md"),
        "---\nstato: aperto\n---\n# B\n\n#etichetta\n",
    )
    .unwrap();
    for n in 0..LINKING {
        std::fs::write(
            vault.join(format!("n{n}.md")),
            format!("nota {n}: vedi [[b]]\n"),
        )
        .unwrap();
    }
    let run = |args: &[&str]| -> serde_json::Value {
        let mut all = vec![
            "--vault",
            vault.to_str().unwrap(),
            "--config-dir",
            config.to_str().unwrap(),
            "--format",
            "json",
        ];
        all.extend_from_slice(args);
        let output = cli(&all);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    };

    let backlinks = run(&["query", "--backlinks", "b.md", "--limit", "1"]);
    assert_eq!(backlinks["data"]["total"], LINKING, "{backlinks}");
    let resolved = run(&["query", "--resolve", "[[b]]"]);
    assert_eq!(resolved["data"]["resolved"], "b.md", "{resolved}");
    let tagged = run(&["query", "--tag", "etichetta"]);
    assert_eq!(tagged["data"]["total"], 1, "{tagged}");

    let plan = run(&[
        "--dry-run",
        "command",
        "note.rename",
        "--args",
        r#"{"doc":"b.md","to":"c.md"}"#,
    ]);
    let docs = plan["data"]["effect"]["docs"]
        .as_array()
        .expect("a plan names its documents");
    assert_eq!(
        docs.len(),
        LINKING + 2,
        "the plan names the note, its new name and every note the rename would rewrite"
    );
    assert!(docs.iter().any(|doc| doc == "n0.md"), "{docs:?}");
    assert!(vault.join("b.md").is_file(), "a dry run does not rename");
}

#[test]
fn second_process_cannot_take_writer_and_sigint_exits_repl() {
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    // Una configurazione propria anche qui: senza, i due processi aprono il
    // vault con quella vera di chi lancia i test, e ci lasciano il registro.
    let config = tmp.path().join("config");
    let config = config.to_str().unwrap();
    let mut holder = Command::new(env!("CARGO_BIN_EXE_fub-cli"))
        .args([
            "--quiet",
            "--vault",
            vault.to_str().unwrap(),
            "--config-dir",
            config,
            "repl",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = holder.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut prompt = [0u8; 5];
        let result = stdout.read_exact(&mut prompt).map(|_| prompt);
        let _ = sender.send(result);
    });
    let prompt = receiver.recv_timeout(Duration::from_secs(10));
    if prompt.is_err() {
        let _ = holder.kill();
        let _ = holder.wait();
        panic!("REPL prompt timeout");
    }
    assert_eq!(prompt.unwrap().unwrap(), *b"fub> ");
    let contender = cli(&[
        "--vault",
        vault.to_str().unwrap(),
        "--config-dir",
        config,
        "--format",
        "json",
        "read",
        "missing.md",
    ]);
    assert_eq!(contender.status.code(), Some(5));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&contender.stderr).unwrap()["kind"],
        "busy"
    );
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    assert_eq!(unsafe { kill(holder.id() as i32, 2) }, 0);
    holder.stdin.as_mut().unwrap().write_all(b"\n").unwrap();
    assert_eq!(holder.wait().unwrap().code(), Some(130));
    reader.join().unwrap();
}

/// Un servizio sul loopback che risponde `503` a tutto e ricorda la riga di
/// ogni richiesta: basta a dire che la CLI ci è arrivata.
fn unavailable_service() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            let _ = reader.read_line(&mut request);
            loop {
                let mut header = String::new();
                if reader.read_line(&mut header).unwrap_or(0) <= 2 {
                    break;
                }
            }
            log.lock().unwrap().push(request.trim().to_string());
            let _ = stream.write_all(
                b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
            );
        }
    });
    (base, seen)
}

/// `sync status` e `sync once` arrivano al servizio per il vault aperto: il
/// percorso del vault non fa più da identificativo remoto (I60), che falliva
/// sempre la validazione dell'abbinamento prima di qualunque richiesta.
#[test]
fn sync_status_and_once_reach_the_service_for_the_open_vault() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("Nota.md"), "# Nota\n").unwrap();
    let (base, seen) = unavailable_service();
    for action in ["status", "once"] {
        let result = Command::new(env!("CARGO_BIN_EXE_fub-cli"))
            .args([
                "--vault",
                vault.to_str().unwrap(),
                "--config-dir",
                config.to_str().unwrap(),
                "--format",
                "json",
                "sync",
                action,
            ])
            .env("FUB_SERVICES_URL", &base)
            .env("FUB_SERVICES_TOKEN", "token-di-prova")
            .env_remove("FUB_SERVICES_TOKEN_FILE")
            .env_remove("FUB_SYNC_MODE")
            .env_remove("FUB_SYNC_EXTERNAL_OVERLAP")
            .output()
            .expect("run fub-cli");
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(
            !result.status.success(),
            "{action}: the service answers 503"
        );
        assert!(!stderr.contains("pairing"), "{action}: {stderr}");
        let requests = std::mem::take(&mut *seen.lock().unwrap());
        assert!(
            requests
                .iter()
                .any(|line| line.starts_with("GET /v1/hello")),
            "{action} never reached the service: {requests:?} / {stderr}"
        );
    }
}
