use super::*;

/// Il motore spento nel vault arriva alla shell come `unserved` con una
/// frase: il client lo legge come «spento» e non come un guasto, e il
/// disegno riaperto offre «Accendi…» invece di restare «fermo».
#[test]
fn the_engine_off_reaches_the_shell_as_unserved_with_a_sentence() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
    std::fs::create_dir_all(root.join(".fub")).unwrap();
    std::fs::write(
        root.join(".fub").join("settings.json"),
        serde_json::json!({"version": 1, "values": {"components.off": ["fub.motore-vettoriale"]}})
            .to_string(),
    )
    .unwrap();
    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    host.open(&root).expect("il vault si apre");
    let doc = doc_id("Disegno.svg").unwrap();
    let text = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
    let vault = Some(root.as_str());

    // Dall'host, la chiave del catalogo: sul filo un oggetto.
    let raw = host.drawing_open(vault, &doc, text).unwrap_err();
    assert!(matches!(raw, PluginError::Unserved(_)), "{raw:?}");
    assert!(serde_json::to_value(&raw).unwrap()["message"].is_object());

    let shown = drawing_for_the_shell(&host, vault, |host, vault| {
        host.drawing_open(vault, &doc, text)
    })
    .unwrap_err();
    let wire = serde_json::to_value(&shown).unwrap();
    assert_eq!(wire["kind"], "unserved", "{wire}");
    assert!(
        wire["message"]
            .as_str()
            .is_some_and(|text| !text.is_empty()),
        "{wire}"
    );
}
