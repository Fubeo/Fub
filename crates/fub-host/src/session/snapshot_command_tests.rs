use super::*;

fn fixture() -> (tempfile::TempDir, Utf8PathBuf, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let base = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let root = base.join("vault");
    let outside = base.join("fuori");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(root.join("nota.md"), "uno\n").unwrap();
    std::fs::create_dir_all(root.join("allegati")).unwrap();
    std::fs::write(root.join("allegati/foto.png"), [0u8, 159, 146, 150]).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let root = canonical(&root).unwrap();
    let outside = canonical(&outside).unwrap();
    (dir, root, outside, host)
}

#[test]
fn a_snapshot_goes_out_and_comes_back_leaving_the_replaced_state_in_a_backup() {
    let (_dir, root, outside, host) = fixture();
    let target = outside.join("snap");
    let args = serde_json::json!({ "target": target });

    let plan = host
        .invoke_user_command(None, SNAPSHOT_CREATE, args.clone(), InvokeMode::DryRun)
        .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    assert!(!target.exists(), "la prova a vuoto non scrive");

    host.invoke_user_command(None, SNAPSHOT_CREATE, args, InvokeMode::Apply)
        .unwrap();
    assert!(target.join("manifest.json").is_file());
    // Il vault è di nuovo aperto e corrente: i comandi rispondono.
    assert!(host.commands(None).is_ok());

    std::fs::write(root.join("nota.md"), "due\n").unwrap();
    std::fs::write(root.join("nuova.md"), "dopo\n").unwrap();

    let backup = outside.join("prima-del-ripristino");
    let args = serde_json::json!({ "source": target, "backup": backup });
    let plan = host
        .invoke_user_command(None, SNAPSHOT_APPLY, args.clone(), InvokeMode::DryRun)
        .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "due\n"
    );

    let restored = host
        .invoke_user_command(None, SNAPSHOT_APPLY, args, InvokeMode::Apply)
        .unwrap();
    let CommandEffect::Custom { ns, .. } = restored.effect else {
        panic!("il ripristino dice alla shell di ricaricare")
    };
    assert_eq!(ns, fub_abi::ui::VAULT_RESTORED_NS);
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "uno\n"
    );
    assert!(!root.join("nuova.md").exists());
    assert_eq!(
        std::fs::read(root.join("allegati/foto.png")).unwrap(),
        [0u8, 159, 146, 150]
    );
    // Ciò che il ripristino ha sostituito non è perso: è nel backup.
    let saved = fub_kernel::snapshot::SnapshotBundle::read_from(&backup).unwrap();
    assert_eq!(saved.bytes("nota.md"), Some("due\n".as_bytes()));
    assert_eq!(saved.bytes("nuova.md"), Some("dopo\n".as_bytes()));
    assert!(host.commands(None).is_ok(), "il vault è riaperto");
}

#[test]
fn destinations_inside_the_vault_or_taken_are_refused_before_closing() {
    let (_dir, root, outside, host) = fixture();
    std::fs::create_dir(outside.join("occupata")).unwrap();
    for (target, expected) in [
        (root.join("dentro"), "bad"),
        (outside.join("occupata"), "exists"),
        (Utf8PathBuf::from("relativo/snap"), "bad"),
        (outside.join("manca/snap"), "missing"),
    ] {
        let err = host
            .invoke_user_command(
                None,
                SNAPSHOT_CREATE,
                serde_json::json!({ "target": target }),
                InvokeMode::Apply,
            )
            .unwrap_err();
        let ok = match expected {
            "bad" => matches!(err, PluginError::BadArgs(_)),
            "exists" => matches!(err, PluginError::AlreadyExists(_)),
            _ => matches!(err, PluginError::NotFound(_)),
        };
        assert!(ok, "{target}: {err:?}");
    }
    assert!(!root.join("dentro").exists());
    assert!(host.commands(None).is_ok(), "il vault non è stato chiuso");
}

#[test]
fn a_damaged_snapshot_is_refused_and_the_vault_keeps_its_content() {
    let (_dir, root, outside, host) = fixture();
    let target = outside.join("snap");
    host.invoke_user_command(
        None,
        SNAPSHOT_CREATE,
        serde_json::json!({ "target": target }),
        InvokeMode::Apply,
    )
    .unwrap();
    std::fs::write(target.join("payload/nota.md"), "manomesso\n").unwrap();
    std::fs::write(root.join("nota.md"), "attuale\n").unwrap();

    let err = host
        .invoke_user_command(
            None,
            SNAPSHOT_APPLY,
            serde_json::json!({ "source": target, "backup": outside.join("b") }),
            InvokeMode::Apply,
        )
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "attuale\n"
    );
    assert!(
        !outside.join("b").exists(),
        "nessun backup senza ripristino"
    );
    assert!(host.commands(None).is_ok());
}
