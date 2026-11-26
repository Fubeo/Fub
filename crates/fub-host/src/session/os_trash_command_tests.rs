use super::*;
use fub_kernel::JournalOp;

struct FakeTrash {
    destination: Utf8PathBuf,
    unsupported: bool,
    workspace: std::sync::OnceLock<Custody<Workspace>>,
}

impl OsTrashBackend for FakeTrash {
    fn move_file_to_os_trash(&self, from: &Utf8Path) -> std::io::Result<Utf8PathBuf> {
        assert!(
            crate::legacy_tests::read_comes_free(self.workspace.get().expect("workspace aperto")),
            "nessun prestito workspace attraversa il backend OS"
        );
        if self.unsupported {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "non supportato",
            ));
        }
        std::fs::rename(from, &self.destination)?;
        Ok(self.destination.clone())
    }
}

fn fixture(unsupported: bool) -> (tempfile::TempDir, tempfile::TempDir, Host) {
    let vault = tempfile::tempdir().expect("vault");
    let os = tempfile::tempdir().expect("cestino OS");
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).expect("utf8");
    let destination = Utf8PathBuf::from_path_buf(os.path().join("Nota.md")).expect("utf8");
    std::fs::write(root.join("Nota.md"), b"# bytes preziosi\n").expect("nota");
    let backend = Arc::new(FakeTrash {
        destination,
        unsupported,
        workspace: std::sync::OnceLock::new(),
    });
    let host = Host::without_watcher().with_os_trash_backend(backend.clone());
    host.open(&root).expect("vault aperto");
    host.wait_indexed(None).expect("indicizzazione");
    backend
        .workspace
        .set(
            host.with_session(None, |s| s.workspace.clone())
                .expect("sessione"),
        )
        .ok()
        .expect("unica sessione");
    (vault, os, host)
}

/// L'esito intero: la frase per l'utente e il payload tipizzato.
fn invoke_outcome(host: &Host) -> (Option<Text>, serde_json::Value) {
    let spec = host
        .commands(None)
        .expect("registro")
        .into_iter()
        .find(|spec| spec.id == OS_TRASH_COMMAND)
        .expect("comando OS elencato");
    assert_eq!(spec.params.len(), 1);
    let outcome = host
        .invoke_user_command(
            None,
            OS_TRASH_COMMAND,
            serde_json::json!({ "doc": "Nota.md" }),
            InvokeMode::Apply,
        )
        .expect("cestina");
    let CommandEffect::Custom { ns, payload } = outcome.effect else {
        panic!("l'esito deve essere tipizzato")
    };
    assert_eq!(ns, "fub.trash.os");
    (outcome.notify, payload)
}

#[test]
fn p01_os_trash_does_not_run_internal_trash_after_success() {
    let (vault, os, host) = fixture(false);
    let (said, outcome) = invoke_outcome(&host);
    assert_eq!(outcome["via"]["kind"], "os");
    assert!(said.is_none(), "a plain success says nothing: {said:?}");
    assert_eq!(
        std::fs::read(os.path().join("Nota.md")).unwrap(),
        b"# bytes preziosi\n"
    );
    assert!(!vault.path().join("Nota.md").exists());
    assert!(
        host.with_session(None, |s| s.workspace.read().unwrap().list_trash().unwrap())
            .unwrap()
            .is_empty(),
        "nessuna copia fittizia nel cestino interno"
    );
    let journal = host.journal(None).expect("registro");
    assert!(journal.records.iter().any(|r| matches!(
        &r.op,
        JournalOp::TrashedOs { doc, .. } if doc.as_str() == "Nota.md"
    )));
}

#[test]
fn p01_unsupported_backend_uses_full_internal_trash() {
    let (vault, _os, host) = fixture(true);
    let (said, outcome) = invoke_outcome(&host);
    assert_eq!(outcome["via"]["kind"], "internal_fallback");
    // La palette mostra solo il `notify`: il ripiego va detto lì (I66).
    let said = said.expect("the fallback is said to the user");
    assert!(said.to_string().contains("Nota.md"), "{said:?}");
    assert_eq!(outcome["via"]["reason"], "unsupported");
    let trashed = host
        .with_session(None, |s| s.workspace.read().unwrap().list_trash().unwrap())
        .unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].original.as_str(), "Nota.md");
    assert_eq!(
        std::fs::read(vault.path().join(trashed[0].id.as_str())).unwrap(),
        b"# bytes preziosi\n"
    );
    let journal = host.journal(None).expect("registro");
    assert!(journal.records.iter().any(|r| matches!(
        &r.op,
        JournalOp::Trashed { doc, .. } if doc.as_str() == "Nota.md"
    )));
}

/// Il campo «Documento» scritto a mano (#486): «nota» è la sola nota che
/// si chiama così; un nome che nessuno porta si dice con una frase.
#[test]
fn os_trash_takes_a_note_written_by_name() {
    let (vault, os, host) = fixture(false);
    let missing = host
        .invoke_user_command(
            None,
            OS_TRASH_COMMAND,
            serde_json::json!({ "doc": "Preventivo" }),
            InvokeMode::Apply,
        )
        .expect_err("nessun documento si chiama così");
    let PluginError::BadArgs(text) = missing else {
        panic!("atteso BadArgs, arrivato {missing:?}")
    };
    assert!(
        text.as_literal()
            .is_some_and(|t| t.contains("«Preventivo»") && t.contains("elenco del campo")),
        "{text:?}"
    );
    assert!(vault.path().join("Nota.md").exists());

    host.invoke_user_command(
        None,
        OS_TRASH_COMMAND,
        serde_json::json!({ "doc": "nota" }),
        InvokeMode::Apply,
    )
    .expect("il nome nomina la sola nota");
    assert!(!vault.path().join("Nota.md").exists());
    assert!(os.path().join("Nota.md").exists());
}
