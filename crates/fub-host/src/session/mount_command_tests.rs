use super::*;

#[test]
fn registry_add_list_remove_preserves_external_file_and_survives_reopen() {
    let vault = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let target = Utf8PathBuf::from_path_buf(external.path().to_path_buf()).unwrap();
    let file = target.join("do-not-delete.txt");
    std::fs::write(&file, b"mine").unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let specs = host.commands(None).unwrap();
    for id in [MOUNT_ADD, MOUNT_LIST, MOUNT_REMOVE] {
        assert!(specs.iter().any(|spec| spec.id == id), "{id} non elencato");
    }
    assert!(host.mount_routes(None).unwrap().is_empty());
    let args = serde_json::json!({ "name": "archivio", "target": target, "namespace": "external" });
    let plan = host
        .invoke_user_command(None, MOUNT_ADD, args.clone(), InvokeMode::DryRun)
        .unwrap();
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("la prova a vuoto deve dare un piano")
    };
    assert!(
        plan.summary.to_string().contains("archivio"),
        "il piano dice cosa collega: {:?}",
        plan.summary
    );
    assert!(host.mount_routes(None).unwrap().is_empty());
    let added = host
        .invoke_user_command(None, MOUNT_ADD, args, InvokeMode::Apply)
        .unwrap();
    assert!(matches!(added.effect, CommandEffect::Custom { .. }));
    // La palette mostra solo il `notify`: senza, un comando riuscito è
    // muto (I66).
    assert!(
        added
            .notify
            .as_ref()
            .is_some_and(|t| t.to_string().contains("archivio")),
        "{:?}",
        added.notify
    );
    assert_eq!(host.mount_routes(None).unwrap()[0].namespace, "external");
    let listed = host
        .invoke_user_command(None, MOUNT_LIST, serde_json::Value::Null, InvokeMode::Apply)
        .unwrap();
    let CommandEffect::Custom { ns, payload } = listed.effect else {
        panic!("lista non tipizzata")
    };
    assert_eq!(ns, "fub.mount.routes");
    assert_eq!(payload["routes"][0]["name"], "archivio");
    let said = listed
        .notify
        .expect("the listing is said to the user")
        .to_string();
    assert!(said.contains("archivio"), "{said}");
    host.close_vault(&root).unwrap();
    host.open(&root).unwrap();
    // Si salva il nome reale: su macOS il tempdir passa da `/var`.
    assert_eq!(
        host.mount_routes(None).unwrap()[0].target,
        canonical(&target).unwrap()
    );
    host.invoke_user_command(
        None,
        MOUNT_REMOVE,
        serde_json::json!({ "name": "archivio" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert!(host.mount_routes(None).unwrap().is_empty());
    assert_eq!(std::fs::read(file).unwrap(), b"mine");
}

#[test]
fn mounting_external_path_does_not_take_workspace_lock() {
    let vault = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let target = Utf8PathBuf::from_path_buf(external.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let workspace = host
        .with_session(None, |session| session.workspace.clone())
        .unwrap();
    let guard = workspace.write().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            let result = host.invoke_user_command(
                None,
                MOUNT_ADD,
                serde_json::json!({ "name": "remote", "target": target, "namespace": "remote" }),
                InvokeMode::Apply,
            );
            tx.send(result).unwrap();
        });
        let completed = rx.recv_timeout(std::time::Duration::from_secs(3));
        drop(guard);
        worker.join().unwrap();
        let result = completed.expect("mount attende il lock workspace");
        assert!(result.is_ok(), "{result:?}");
    });
}

#[test]
fn unavailable_mount_degrades_to_diagnostic_and_remains_removable() {
    let vault = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let target = Utf8PathBuf::from_path_buf(external.path().join("usb")).unwrap();
    std::fs::create_dir(&target).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    host.invoke_user_command(
        None,
        MOUNT_ADD,
        serde_json::json!({ "name": "usb", "target": target, "namespace": "usb" }),
        InvokeMode::Apply,
    )
    .unwrap();
    host.close_vault(&root).unwrap();
    std::fs::remove_dir(&target).unwrap();

    host.open(&root)
        .expect("un mount scollegato non blocca il vault");
    assert!(host.mount_routes(None).unwrap().is_empty());
    assert!(host
        .startup_diagnostics(None)
        .unwrap()
        .iter()
        .any(|diagnostic| diagnostic.to_string().contains("mount usb disattivato")));
    let plan = host
        .invoke_user_command(
            None,
            MOUNT_REMOVE,
            serde_json::json!({ "name": "usb" }),
            InvokeMode::DryRun,
        )
        .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    host.invoke_user_command(
        None,
        MOUNT_REMOVE,
        serde_json::json!({ "name": "usb" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert!(host
        .startup_diagnostics(None)
        .unwrap()
        .iter()
        .any(|diagnostic| { diagnostic.to_string().contains("mount usb disattivato") }));
    let list = host
        .invoke_user_command(None, MOUNT_LIST, serde_json::Value::Null, InvokeMode::Apply)
        .unwrap();
    let CommandEffect::Custom { payload, .. } = list.effect else {
        panic!("lista non tipizzata")
    };
    assert_eq!(payload["diagnostics"], serde_json::json!([]));
}
