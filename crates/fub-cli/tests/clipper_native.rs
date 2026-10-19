use fub_host::automation::{
    read_nm_frame, write_nm_frame, CaptureEnvelope, CaptureMode, CapturePayloadV1, CaptureTarget,
    NmRequest, NmResponse, PairEntry,
};
use std::io::Read;
use std::process::{Command, Stdio};

fn capture() -> NmRequest {
    NmRequest {
        kind: "fub-capture-v1".into(),
        v: 1,
        envelope: CaptureEnvelope {
            nonce: "native-cli-gate".into(),
            origin: "clipper-extension".into(),
            extension_id: Some("clipper@fub.local".into()),
            timestamp_ms: Some(1),
        },
        payload: CapturePayloadV1 {
            v: 1,
            title: "Private".into(),
            markdown: "bytes".into(),
            source_url: None,
            properties: None,
            target: CaptureTarget {
                mode: CaptureMode::Create,
                vault: Some("vault-A".into()),
                folder: Some("Clips".into()),
                note: None,
            },
        },
    }
}

fn host_frames(config: &std::path::Path, frames: &[Vec<u8>]) -> Vec<NmResponse> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_fub-clipper-host"))
        .env("FUB_CONFIG_DIR", config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn actual native host");
    let mut input = child.stdin.take().unwrap();
    for frame in frames {
        write_nm_frame(&mut input, frame).unwrap();
    }
    drop(input);
    let mut output = child.stdout.take().unwrap();
    let replies: Vec<NmResponse> = frames
        .iter()
        .map(|_| {
            let bytes = read_nm_frame(&mut output).expect("one framed reply per request");
            serde_json::from_slice(&bytes).expect("structured native reply")
        })
        .collect();
    let mut remainder = Vec::new();
    output.read_to_end(&mut remainder).unwrap();
    assert!(remainder.is_empty(), "stdout is frames only");
    assert!(child.wait().unwrap().success());
    replies
}

#[test]
fn native_host_denies_unpaired_and_wrong_scope_before_any_vault_write() {
    let tmp = tempfile::tempdir().unwrap();
    let request = serde_json::to_vec(&capture()).unwrap();
    let denied = host_frames(tmp.path(), &[request.clone(), request.clone()]);
    assert!(denied
        .iter()
        .all(|r| !r.ok && r.needs_pairing == Some(true)));
    let pair = PairEntry {
        extension_id: "clipper@fub.local".into(),
        vault: Some("different-vault".into()),
        folder: Some("Clips".into()),
    };
    std::fs::write(
        tmp.path().join("clipper-pairing.json"),
        serde_json::json!({ "pairs": [pair] }).to_string(),
    )
    .unwrap();
    let denied = host_frames(tmp.path(), &[request]);
    assert!(!denied[0].ok);
    assert_eq!(denied[0].needs_pairing, Some(true));
}

#[test]
fn paired_native_capture_writes_through_the_host_command() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let vault_name = vault.to_str().unwrap().to_string();
    let pairing = tmp.path().join("clipper-pairing.json");
    std::fs::write(
        &pairing,
        serde_json::json!({ "pairs": [{ "extension_id": "clipper@fub.local",
            "vault": vault_name, "folder": "Clips" }] })
        .to_string(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pairing, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let mut request = capture();
    request.payload.target.vault = Some(vault_name);
    request.payload.source_url = Some("https://example.com/p".into());
    request.payload.properties = Some(
        serde_json::json!({ "fonte": "web" })
            .as_object()
            .unwrap()
            .clone(),
    );
    let frame = serde_json::to_vec(&request).unwrap();
    let replies = host_frames(tmp.path(), &[frame.clone(), frame]);
    assert!(replies[0].ok, "{:?}", replies[0]);
    let text = std::fs::read_to_string(vault.join("Clips/Private.md")).unwrap();
    assert!(
        text.starts_with("---\n"),
        "le proprietà nascono con la nota: {text:?}"
    );
    assert!(text.contains("fonte: web"), "{text:?}");
    assert!(text.contains("\n# Private\n\nbytes\n\n"), "{text:?}");
    assert!(
        text.trim_end().ends_with("https://example.com/p"),
        "{text:?}"
    );

    // La stessa cattura una seconda volta è un conflitto, non un duplicato.
    assert!(!replies[1].ok);
    assert_eq!(replies[1].kind.as_deref(), Some("conflict"));
    assert_eq!(
        std::fs::read_to_string(vault.join("Clips/Private.md")).unwrap(),
        text
    );
}

#[test]
fn native_host_rejects_wrong_kind_and_invalid_utf8_without_echoing_untrusted_data() {
    let tmp = tempfile::tempdir().unwrap();
    let mut wrong = capture();
    wrong.kind = "note.delete".into();
    let frames = [serde_json::to_vec(&wrong).unwrap(), vec![0xff, 0xfe]];
    let replies = host_frames(tmp.path(), &frames);
    assert!(replies
        .iter()
        .all(|r| !r.ok && r.kind.as_deref() == Some("bad_args")));
    assert!(replies
        .iter()
        .all(|r| !r.message.as_deref().unwrap_or("").contains("Private")));
}

#[test]
fn paired_native_attachment_verifies_digest_before_writing_bytes() {
    use base64::Engine as _;
    use fub_host::automation::{
        AttachmentMeta, NmAttachmentBegin, NmAttachmentChunk, NmAttachmentCommit,
        NM_ATTACHMENT_BEGIN_KIND, NM_ATTACHMENT_CHUNK_KIND, NM_ATTACHMENT_COMMIT_KIND,
    };

    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let vault_name = vault.to_str().unwrap().to_string();
    let pairing = tmp.path().join("clipper-pairing.json");
    std::fs::write(
        &pairing,
        serde_json::json!({ "pairs": [{ "extension_id": "clipper@fub.local",
            "vault": vault_name, "folder": "Clips" }] })
        .to_string(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pairing, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    let mut child = Command::new(env!("CARGO_BIN_EXE_fub-clipper-host"))
        .env("FUB_CONFIG_DIR", tmp.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = child.stdout.take().unwrap();
    let target = CaptureTarget {
        mode: CaptureMode::Create,
        vault: Some(vault.to_str().unwrap().into()),
        folder: Some("Clips".into()),
        note: None,
    };
    let envelope = capture().envelope;
    let valid_digest = ring::digest::digest(&ring::digest::SHA256, b"right");
    let begin = NmAttachmentBegin {
        kind: NM_ATTACHMENT_BEGIN_KIND.into(),
        v: 1,
        envelope: envelope.clone(),
        target,
        attachment: AttachmentMeta {
            name: "image.png".into(),
            sha256: valid_digest
                .as_ref()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            bytes: 5,
        },
    };
    write_nm_frame(&mut input, &serde_json::to_vec(&begin).unwrap()).unwrap();
    let begun: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(begun["ok"], true, "must open actual paired vault: {begun}");
    let transfer_id = begun["transfer_id"].as_str().unwrap().to_string();

    let chunk = NmAttachmentChunk {
        kind: NM_ATTACHMENT_CHUNK_KIND.into(),
        v: 1,
        envelope: envelope.clone(),
        transfer_id: transfer_id.clone(),
        index: 0,
        data: base64::engine::general_purpose::STANDARD.encode(b"wrong"),
    };
    write_nm_frame(&mut input, &serde_json::to_vec(&chunk).unwrap()).unwrap();
    let accepted: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(accepted["ok"], true);
    let commit = NmAttachmentCommit {
        kind: NM_ATTACHMENT_COMMIT_KIND.into(),
        v: 1,
        envelope,
        transfer_id,
    };
    write_nm_frame(&mut input, &serde_json::to_vec(&commit).unwrap()).unwrap();
    let rejected: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["kind"], "bad_args");
    assert!(
        !vault.join("Clips/image.png").exists(),
        "digest mismatch must not write an attachment"
    );
    let mut retry = begin;
    retry.envelope.nonce = "native-cli-success".into();
    write_nm_frame(&mut input, &serde_json::to_vec(&retry).unwrap()).unwrap();
    let begun: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(
        begun["ok"], true,
        "retry on the same authenticated native port: {begun}"
    );
    let transfer_id = begun["transfer_id"].as_str().unwrap().to_string();
    let chunk = NmAttachmentChunk {
        kind: NM_ATTACHMENT_CHUNK_KIND.into(),
        v: 1,
        envelope: retry.envelope.clone(),
        transfer_id: transfer_id.clone(),
        index: 0,
        data: base64::engine::general_purpose::STANDARD.encode(b"right"),
    };
    write_nm_frame(&mut input, &serde_json::to_vec(&chunk).unwrap()).unwrap();
    let accepted: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(accepted["ok"], true);
    let commit = NmAttachmentCommit {
        kind: NM_ATTACHMENT_COMMIT_KIND.into(),
        v: 1,
        envelope: retry.envelope,
        transfer_id,
    };
    write_nm_frame(&mut input, &serde_json::to_vec(&commit).unwrap()).unwrap();
    let written: serde_json::Value =
        serde_json::from_slice(&read_nm_frame(&mut output).unwrap()).unwrap();
    assert_eq!(
        written["ok"], true,
        "verified bytes must be written: {written}"
    );
    drop(input);
    assert!(child.wait().unwrap().success());
    assert_eq!(
        std::fs::read(vault.join("Clips/image.png")).unwrap(),
        b"right"
    );
}

#[cfg(unix)]
#[test]
fn native_install_writes_the_manifest_only_where_the_browser_is_and_only_with_yes() {
    let home = tempfile::tempdir().unwrap();
    let config = home.path().join("config");
    std::fs::create_dir_all(home.path().join(".mozilla")).unwrap();
    std::fs::create_dir_all(home.path().join(".config/chromium")).unwrap();
    let run = |args: &[&str]| {
        let out = Command::new(env!("CARGO_BIN_EXE_fub-cli"))
            .env("HOME", home.path())
            .env_remove("FUB_CONFIG_DIR")
            .args(["--format", "json", "--config-dir", config.to_str().unwrap()])
            .args(args)
            .output()
            .unwrap();
        // Gli errori vanno su stderr, sempre in JSON.
        let bytes = if out.stdout.is_empty() {
            &out.stderr
        } else {
            &out.stdout
        };
        let value: serde_json::Value = serde_json::from_slice(bytes).unwrap_or_else(|_| {
            panic!(
                "json: {} {}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        });
        (out.status.code(), value)
    };
    let firefox = home
        .path()
        .join(".mozilla/native-messaging-hosts/local.fub.clipper.json");

    // Senza --yes dice soltanto dove.
    let (code, plan) = run(&["native-install", "--extension-id", "clipper@fub.local"]);
    assert_eq!(code, Some(0), "{plan}");
    assert_eq!(plan["data"]["applied"], false);
    assert_eq!(plan["data"]["targets"][0]["status"], "would_write");
    assert_eq!(plan["data"]["targets"].as_array().unwrap().len(), 1);
    assert!(!firefox.exists());

    // Con --yes lo scrive, per il solo Firefox: l'id non è di Chromium.
    let (code, done) = run(&[
        "native-install",
        "--extension-id",
        "clipper@fub.local",
        "--yes",
    ]);
    assert_eq!(code, Some(0), "{done}");
    assert_eq!(done["data"]["targets"][0]["status"], "written");
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&firefox).unwrap()).unwrap();
    assert_eq!(written["allowed_extensions"][0], "clipper@fub.local");
    assert!(std::path::Path::new(written["path"].as_str().unwrap()).is_file());
    assert!(!home
        .path()
        .join(".config/chromium/NativeMessagingHosts")
        .exists());

    // Un id Firefox per Chrome è un errore d'uso, non un manifest inutile.
    let (code, _) = run(&[
        "native-install",
        "--extension-id",
        "clipper@fub.local",
        "--browser",
        "chrome",
        "--yes",
    ]);
    assert_eq!(code, Some(2));

    // Un file d'altri resta com'è; il nostro si toglie.
    let chromium = home
        .path()
        .join(".config/chromium/NativeMessagingHosts/local.fub.clipper.json");
    std::fs::create_dir_all(chromium.parent().unwrap()).unwrap();
    std::fs::write(&chromium, br#"{"name":"altro"}"#).unwrap();
    let id = "abcdefghijklmnopabcdefghijklmnop";
    let (_, foreign) = run(&["native-install", "--extension-id", id, "--yes"]);
    assert_eq!(foreign["data"]["targets"][0]["status"], "skipped_foreign");
    assert_eq!(std::fs::read(&chromium).unwrap(), br#"{"name":"altro"}"#);
    let (code, removed) = run(&[
        "native-install",
        "--extension-id",
        "clipper@fub.local",
        "--uninstall",
        "--yes",
    ]);
    assert_eq!(code, Some(0), "{removed}");
    assert_eq!(removed["data"]["targets"][0]["status"], "removed");
    assert!(!firefox.exists());
}

#[test]
fn with_the_app_holding_the_vault_the_native_capture_is_written_by_the_app() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    std::fs::create_dir(&vault).unwrap();
    let vault_name = vault.to_str().unwrap().to_string();
    let pairing = tmp.path().join("clipper-pairing.json");
    std::fs::write(
        &pairing,
        serde_json::json!({ "pairs": [{ "extension_id": "clipper@fub.local",
            "vault": vault_name, "folder": "Clips" }] })
        .to_string(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pairing, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    // L'app: tiene il vault e ascolta sul canale di controllo.
    let config = camino::Utf8Path::from_path(tmp.path()).unwrap();
    let app = std::sync::Arc::new(fub_host::Host::without_watcher().with_config_dir(config));
    app.open(camino::Utf8Path::from_path(&vault).unwrap())
        .unwrap();
    let served = std::sync::Arc::clone(&app);
    let server = fub_host::control::ControlServer::start(config, move |call| {
        fub_host::control::answer(&served, call)
    })
    .unwrap();

    let mut request = capture();
    request.payload.target.vault = Some(vault_name);
    let replies = host_frames(tmp.path(), &[serde_json::to_vec(&request).unwrap()]);
    assert!(replies[0].ok, "{:?}", replies[0]);
    let doc = fub_host::doc_id("Clips/Private.md").unwrap();
    let (source, _) = app.read_document(None, &doc).unwrap();
    assert!(source.contains("# Private\n\nbytes\n"), "{source:?}");
    drop(server);
}
