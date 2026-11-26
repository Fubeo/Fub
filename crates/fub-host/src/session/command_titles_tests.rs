use super::*;

/// Un titolo che esce come chiave di catalogo (`cmd.x.title`) è un
/// catalogo che nessuno ha presentato al kernel: palette e CLI lo
/// mostrerebbero così com'è.
#[test]
fn every_listed_command_has_a_translated_title() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let raw: Vec<String> = host
        .commands(None)
        .unwrap()
        .into_iter()
        .filter(|spec| {
            let title = spec.title.to_string();
            title.ends_with(".title") || (!title.contains(' ') && title.matches('.').count() >= 2)
        })
        .map(|spec| format!("{} → {}", spec.id, spec.title))
        .collect();
    assert!(raw.is_empty(), "titoli non tradotti: {raw:?}");
}

/// Piani, esiti ed errori dei comandi dell'host escono come frasi del
/// catalogo del core, mai come chiavi — anche quando il workspace è tenuto
/// da un altro writer e la lingua ripiega su quella predefinita.
#[test]
fn host_owned_outcomes_speak_sentences_not_keys() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let text_of = |outcome: CommandOutcome| match outcome.effect {
        CommandEffect::Plan(plan) => plan.summary.to_string(),
        _ => outcome.notify.map(|t| t.to_string()).unwrap_or_default(),
    };
    let plan = host
        .invoke_user_command(
            None,
            FOLDER_CREATE,
            serde_json::json!({ "path": "Nuova" }),
            InvokeMode::DryRun,
        )
        .unwrap();
    let said = text_of(plan);
    assert!(!said.contains("host.") && said.contains("Nuova"), "{said}");
    let err = host
        .invoke_user_command(
            None,
            SNAPSHOT_CREATE,
            serde_json::json!({ "target": "relativo" }),
            InvokeMode::DryRun,
        )
        .unwrap_err()
        .to_string();
    assert!(!err.contains("host.") && err.contains("relativo"), "{err}");

    // Con il workspace tenuto da un altro writer: la lingua predefinita.
    let external = tempfile::tempdir().unwrap();
    let target = Utf8PathBuf::from_path_buf(external.path().to_path_buf()).unwrap();
    let workspace = host
        .with_session(None, |session| session.workspace.clone())
        .unwrap();
    let _held = workspace.write().unwrap();
    let plan = host
        .invoke_user_command(
            None,
            MOUNT_ADD,
            serde_json::json!({ "name": "fuori", "target": target, "namespace": "fuori" }),
            InvokeMode::DryRun,
        )
        .unwrap();
    let said = text_of(plan);
    assert!(!said.contains("host.") && said.contains("fuori"), "{said}");
}

/// Gli intenti privilegiati passano solo dal core: se il bundle dei
/// comandi ufficiali smettesse di essere registrato come tale,
/// `settings.export` fallirebbe con `PermissionDenied` e nessuno lo
/// vedrebbe finché un utente non prova a esportare.
#[test]
fn the_core_still_hands_its_privileged_intents_to_the_shell() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let outcome = host
        .invoke_user_command(
            None,
            "settings.export",
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
        .expect("l'export del core passa");
    let CommandEffect::Custom { ns, .. } = outcome.effect else {
        panic!("l'export consegna un intento")
    };
    assert_eq!(ns, fub_abi::ui::SETTINGS_EXPORT_NS);
}
