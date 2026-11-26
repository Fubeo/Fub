//! Le icone di un tema.

use super::*;

// --- le icone di un tema (PA T40) --------------------------------------------

/// Un tema `theme-2` che parte dalla serie e nomina un set di icone: `file` è
/// il valore di `icons` nel manifest, `set` il testo da scrivere in
/// `icons.json` (se c'è).
fn write_icon_theme(root: &Utf8Path, id: &str, file: &str, set: Option<&[u8]>) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Icone", "version": "1.0.0", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"], "extends": "fub.serie", "icons": "{file}"}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    if let Some(set) = set {
        std::fs::write(root.join("icons.json"), set).unwrap();
    }
}

/// Il testo di un set di `count` icone, ognuna con `paths` tracciati `d`.
fn icon_set(count: usize, paths: usize, d: &str) -> String {
    let list = vec![format!("\"{d}\""); paths].join(", ");
    let entries: Vec<String> = (0..count)
        .map(|n| format!("\"icona-{n}\": [{list}]"))
        .collect();
    format!("{{{}}}", entries.join(", "))
}

fn icons_refused(set: &str, why: &str) {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
    let error = fub_host::theme::install_theme(&config, &root)
        .expect_err(&format!("refused because {why}"));
    malformed_because(error, why);
}

/// Un tema che ridisegna qualche icona si installa, anche con un nome che oggi
/// nessuno disegna, e il fascio porta il set anche se nessun CSS lo nomina.
#[test]
fn a_theme_with_icons_installs_and_carries_the_set() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let set = r#"{"search": ["M4 4h16v16H4z", "M8 12h8"], "folder": ["M3 6h18v12H3z"], "modulo-spento": ["M12 3v18"]}"#;
    write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
    fub_host::theme::install_theme(&config, &root).expect("a theme with icons installs");

    let payload =
        fub_host::theme::read_theme(&config, "test.icone", fub_abi::theme::ThemeLight::Dark)
            .expect("reads");
    assert_eq!(payload.manifest.icons.as_deref(), Some("icons.json"));
    assert_eq!(
        payload.assets.get("theme://test.icone/icons.json"),
        Some(&set.as_bytes().to_vec())
    );
}

/// Il file del set è un `<nome>.json` minuscolo accanto al manifest, e c'è.
#[test]
fn the_icon_set_must_be_a_json_asset_beside_the_manifest() {
    for (file, why) in [
        ("manifest.json", "is not a theme asset"),
        ("Icons.json", "is not a theme asset"),
        ("icone/icons.json", "is not a theme asset"),
        ("../icons.json", "is not a theme asset"),
        ("theme://test.icone/icons.json", "is not a theme asset"),
        ("icons.svg", "is not a theme asset"),
        ("altre.json", "is not among the theme assets"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_icon_theme(
            &root,
            "test.icone",
            file,
            Some(br#"{"search": ["M0 0h1"]}"#),
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("`{file}` is refused"));
        malformed_because(error, why);
    }
}

/// Un `d` con markup, virgolette o un riferimento non è un tracciato.
#[test]
fn an_icon_accepts_only_path_data() {
    for set in [
        r#"{"search": ["M0 0\"/><script>alert(1)</script><path d=\""]}"#,
        r#"{"search": ["M0 0<"]}"#,
        r#"{"search": ["M0 0 url(#x)"]}"#,
        r#"{"search": [""]}"#,
        "{\"search\": [\"M0\u{a0}0\"]}",
    ] {
        icons_refused(set, "accepts only SVG path data");
    }
    icons_refused(r#"{"Search": ["M0 0h1"]}"#, "lowercase ASCII letters");
    icons_refused(r#"{"search": "M0 0h1"}"#, "is not a list of path data");
    icons_refused(r#"{"search": [1, 2]}"#, "is not a list of path data");
    icons_refused(r#"["search"]"#, "is not a JSON object");
    icons_refused("{ non è json", "is not a JSON object");
}

/// Al massimo 1024 nomi, 8 tracciati e 4 KB per nome, 256 KB in tutto.
#[test]
fn the_icon_set_limits_hold_at_their_edges() {
    let accepted = |set: &str| {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
        fub_host::theme::install_theme(&config, &root).expect("at the edge installs");
    };

    accepted(&icon_set(1024, 1, "M0 0h1"));
    icons_refused(&icon_set(1025, 1, "M0 0h1"), "at most 1024 are allowed");

    accepted(&icon_set(1, 8, "M0 0h1"));
    icons_refused(&icon_set(1, 9, "M0 0h1"), "must have 1 to 8 paths");
    icons_refused(r#"{"search": []}"#, "must have 1 to 8 paths");

    accepted(&icon_set(1, 1, &"M".repeat(4096)));
    accepted(&icon_set(1, 2, &"M".repeat(2048)));
    icons_refused(
        &icon_set(1, 1, &"M".repeat(4097)),
        "exceeds 4096 bytes of path data",
    );

    // 256 KB in tutto: spazi fra le voci portano il file al tetto esatto, poi
    // un byte oltre.
    let base = icon_set(100, 1, "M0 0h1");
    let full = format!("{}{}", " ".repeat(256 * 1024 - base.len()), base);
    assert_eq!(full.len(), 256 * 1024);
    accepted(&full);
    icons_refused(&format!(" {full}"), "exceeds 262144 bytes");
}

/// `theme-1` è congelato e non impara le icone.
#[test]
fn icons_need_theme_2() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(
        &root,
        "test.vecchio",
        "theme-1",
        r#", "icons": "icons.json""#,
    );
    std::fs::write(root.join("icons.json"), r#"{"search": ["M0 0h1"]}"#).unwrap();
    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-1 has no icons");
    malformed_because(error, "icons need `theme-2`");
}
