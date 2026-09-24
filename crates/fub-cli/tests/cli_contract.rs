use std::process::{Command, Output, Stdio};

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

#[cfg(unix)]
#[test]
fn second_process_cannot_take_writer_and_sigint_exits_repl() {
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let mut holder = Command::new(env!("CARGO_BIN_EXE_fub-cli"))
        .args(["--quiet", "--vault", vault.to_str().unwrap(), "repl"])
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
