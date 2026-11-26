use super::*;

/// I comandi che avviano programmi della macchina (`open_with`,
/// `craft_render`, `reveal_in_system`…) li chiede soltanto la shell
/// principale: una finestra di documento, il visore o una finestra
/// navigata su un remoto ricevono `permission_denied` prima del lavoro.
#[test]
fn only_the_local_main_shell_passes_the_main_shell_gate() {
    const LOCAL: &str = "tauri://localhost/";
    assert!(main_shell_only("main", LOCAL, "render").is_ok());
    assert!(main_shell_only("main", "http://tauri.localhost/", "render").is_ok());
    for (label, origin) in [
        ("document-1", LOCAL),
        ("fub-viewer", LOCAL),
        ("MAIN", LOCAL),
        ("main", "https://esempio.it/"),
        ("main", "fub-asset://localhost/3"),
    ] {
        assert!(
            matches!(
                main_shell_only(label, origin, "render"),
                Err(PluginError::PermissionDenied(_))
            ),
            "{label} su {origin} è passata"
        );
    }
}

/// Una scelta d'avvio di cui il disco non sa dire se c'è non vale «avvio
/// pieno»: illeggibile, vale limitato.
#[cfg(unix)]
#[test]
fn an_unreachable_limited_choice_starts_limited() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let config = Utf8Path::from_path(temp.path()).unwrap().join("config");
    std::fs::create_dir(&config).unwrap();
    std::fs::write(
        config.join("installed-limited.json"),
        br#"{"enabled":true}"#,
    )
    .unwrap();
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o600)).unwrap();
    let reachable = std::fs::metadata(config.join("installed-limited.json")).is_ok();
    let mode = limited_startup(Some(config.as_path()));
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o700)).unwrap();
    // Da root la cartella si attraversa lo stesso: non c'è niente da provare.
    if !reachable {
        assert!(mode.enabled, "an unreadable choice reopened the plugins");
    }
    let missing = config.with_file_name("assente");
    assert!(!limited_startup(Some(missing.as_path())).enabled);
}

/// `open` assente o `null` è una lettura semplice; una chiave malformata
/// è `BadArgs` prima che il comando tocchi l'host.
#[test]
fn the_open_key_is_optional_and_checked() {
    assert!(open_key(None).unwrap().is_none());
    assert_eq!(
        open_key(Some("sessione-1")).unwrap().unwrap().as_str(),
        "sessione-1"
    );
    for bad in ["", "a/b", "../x", "a b"] {
        assert!(matches!(open_key(Some(bad)), Err(PluginError::BadArgs(_))));
    }
}

#[test]
fn installation_ids_are_strict_decimal_u64_strings() {
    assert_eq!(parse_installation("0").unwrap(), 0);
    assert_eq!(
        parse_installation("18446744073709551615").unwrap(),
        u64::MAX
    );
    for invalid in ["", "-1", "+1", " 1", "1 ", "١", "18446744073709551616"] {
        assert!(
            matches!(parse_installation(invalid), Err(PluginError::BadArgs(_))),
            "{invalid:?} deve essere rifiutato"
        );
    }
}
