use super::*;
use fub_abi::traits::{IndexQuery, IndexResult};

fn folders(host: &Host) -> Vec<String> {
    let IndexResult::Folders(page) = host
        .query_index(
            None,
            IndexQuery::Folders {
                under: None,
                page: None,
            },
        )
        .unwrap()
    else {
        panic!("cartelle attese")
    };
    page.items.into_iter().map(|folder| folder.path).collect()
}

#[test]
fn dry_run_plans_apply_creates_and_a_taken_name_conflicts() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    std::fs::write(root.join("nota.md"), b"testo").unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    assert!(host
        .commands(None)
        .unwrap()
        .iter()
        .any(|spec| spec.id == FOLDER_CREATE));

    let args = serde_json::json!({ "path": "Progetti/2026" });
    let plan = host
        .invoke_user_command(None, FOLDER_CREATE, args.clone(), InvokeMode::DryRun)
        .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    assert!(
        !root.join("Progetti").exists(),
        "la prova a vuoto non scrive"
    );

    let made = host
        .invoke_user_command(None, FOLDER_CREATE, args.clone(), InvokeMode::Apply)
        .unwrap();
    let CommandEffect::Custom { ns, payload } = made.effect else {
        panic!("esito non tipizzato")
    };
    assert_eq!(ns, "fub.folder.created");
    assert_eq!(payload["path"], "Progetti/2026");
    assert!(root.join("Progetti/2026").is_dir());
    assert_eq!(folders(&host), vec!["Progetti", "Progetti/2026"]);

    for taken in [args, serde_json::json!({ "path": "nota.md" })] {
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let err = host
                .invoke_user_command(None, FOLDER_CREATE, taken.clone(), mode)
                .unwrap_err();
            assert!(matches!(err, PluginError::AlreadyExists(_)), "{err:?}");
        }
    }
    assert_eq!(std::fs::read(root.join("nota.md")).unwrap(), b"testo");
}

#[test]
fn a_fenced_name_is_rejected_before_touching_the_disk() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().join("vault")).unwrap();
    std::fs::create_dir(&root).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    for bad in ["../fuori", ".fub/x", ""] {
        let err = host
            .invoke_user_command(
                None,
                FOLDER_CREATE,
                serde_json::json!({ "path": bad }),
                InvokeMode::Apply,
            )
            .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)), "{bad:?}: {err:?}");
    }
    assert!(!vault.path().join("fuori").exists());
    assert!(folders(&host).is_empty());
}
