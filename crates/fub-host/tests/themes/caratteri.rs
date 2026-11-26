//! I caratteri del tema.

use super::*;

// --- i caratteri del tema ----------------------------------------------------

/// I byte di un WOFF2 finto: la firma e poi riempitivo fino a `size`.
fn woff2(size: usize) -> Vec<u8> {
    let mut bytes = b"wOF2".to_vec();
    bytes.resize(size.max(4), 0x2a);
    bytes
}

/// Un tema `theme-2` che parte dalla serie e porta i caratteri dati: `fonts`
/// è il JSON dell'elenco, `files` i file da scrivere con i loro byte.
fn write_font_theme(root: &Utf8Path, id: &str, fonts: &str, files: &[(&str, Vec<u8>)]) {
    std::fs::create_dir_all(root.join("fonts")).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Caratteri", "version": "1.0.0", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"], "extends": "fub.serie", "fonts": {fonts}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    std::fs::write(
        root.join("skin.css"),
        ".shell-tooltip { font-family: \"Carta Serif\", var(--font-ui); }\n",
    )
    .unwrap();
    for (name, bytes) in files {
        std::fs::write(root.join(name), bytes).unwrap();
    }
}

fn font(family: &str, file: &str, weight: u16, style: &str) -> String {
    format!(r#"{{"family": "{family}", "file": "{file}", "weight": {weight}, "style": "{style}"}}"#)
}

fn font_list(entries: &[String]) -> String {
    format!("[{}]", entries.join(", "))
}

/// Un tema che porta due facce: si installa, il manifest le nomina, e il fascio
/// porta i file anche se nessun CSS li cita (la regola la scrive la shell).
#[test]
fn a_theme_with_fonts_installs_and_carries_their_files() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_font_theme(
        &root,
        "test.carta",
        &font_list(&[
            font("Carta Serif", "fonts/carta.woff2", 400, "normal"),
            font("Carta Serif", "fonts/carta-italic.woff2", 400, "italic"),
        ]),
        &[
            ("fonts/carta.woff2", woff2(64)),
            ("fonts/carta-italic.woff2", woff2(32)),
        ],
    );
    fub_host::theme::install_theme(&config, &root).expect("a theme with fonts installs");

    let payload =
        fub_host::theme::read_theme(&config, "test.carta", fub_abi::theme::ThemeLight::Light)
            .expect("reads");
    assert_eq!(payload.manifest.fonts.len(), 2);
    assert_eq!(payload.manifest.fonts[0].family, "Carta Serif");
    assert_eq!(
        payload.manifest.fonts[1].style,
        fub_abi::theme::ThemeFontStyle::Italic
    );
    assert_eq!(
        payload.assets.get("theme://test.carta/fonts/carta.woff2"),
        Some(&woff2(64))
    );
    assert_eq!(
        payload
            .assets
            .get("theme://test.carta/fonts/carta-italic.woff2"),
        Some(&woff2(32))
    );
}

/// Un file che non è un asset del tema — un URL, un path che esce, un altro
/// formato, un file che non c'è — è rifiutato.
#[test]
fn a_font_file_must_be_a_woff2_asset_of_the_theme() {
    for (file, why) in [
        ("https://example.com/carta.woff2", "is not a theme asset"),
        (
            "theme://test.file/fonts/carta.woff2",
            "is not a theme asset",
        ),
        ("fonts/../manifest.woff2", "is not a theme asset"),
        ("fonts/sotto/carta.woff2", "is not a theme asset"),
        ("carta.woff2", "is not a theme asset"),
        ("fonts/carta.ttf", "is not a theme asset"),
        ("fonts/mancante.woff2", "is not among the theme assets"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.file",
            &font_list(&[font("Carta Serif", file, 400, "normal")]),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("`{file}` is refused"));
        malformed_because(error, why);
    }
}

/// Un `.ttf` rinominato in `.woff2` non ha la firma `wOF2`.
#[test]
fn a_renamed_ttf_is_refused_by_its_signature() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let mut ttf = vec![0x00, 0x01, 0x00, 0x00];
    ttf.resize(128, 0);
    write_font_theme(
        &root,
        "test.ttf",
        &font_list(&[font("Carta Serif", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", ttf)],
    );
    let error = fub_host::theme::install_theme(&config, &root).expect_err("not WOFF2");
    malformed_because(error, "does not start with `wOF2`");

    // Anche un file più corto della firma.
    let (_short_dir, short) = folders();
    write_font_theme(
        &short,
        "test.corto",
        &font_list(&[font("Carta Serif", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", b"wO".to_vec())],
    );
    let error = fub_host::theme::install_theme(&config, &short).expect_err("too short");
    malformed_because(error, "does not start with `wOF2`");
}

/// La famiglia: il nome di una di serie (in qualunque maiuscolo), una parola
/// chiave del CSS, caratteri fuori dall'alfabeto, troppo lunga.
#[test]
fn a_font_family_must_be_its_own_and_well_formed() {
    let too_long = "A".repeat(65);
    for (family, why) in [
        ("Newsreader Variable", "is a series family"),
        ("inter variable", "is a series family"),
        ("IBM Plex Mono", "is a series family"),
        ("serif", "is a CSS keyword"),
        ("Inherit", "is a CSS keyword"),
        ("Carta\\\"; src: url(x)", "must be 1 to 64 characters"),
        ("Carta_Serif", "must be 1 to 64 characters"),
        (" Carta", "must be 1 to 64 characters"),
        ("Carta  Serif", "must be 1 to 64 characters"),
        ("", "must be 1 to 64 characters"),
        (too_long.as_str(), "must be 1 to 64 characters"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.famiglia",
            &font_list(&[font(family, "fonts/carta.woff2", 400, "normal")]),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("family `{family}` is refused"));
        malformed_because(error, why);
    }

    // 64 caratteri esatti reggono.
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let longest = "B".repeat(64);
    write_font_theme(
        &root,
        "test.lunga",
        &font_list(&[font(&longest, "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(16))],
    );
    fub_host::theme::install_theme(&config, &root).expect("64 characters install");
}

/// Il peso sta fra 100 e 900, lo stile è `normal` o `italic`, e la stessa
/// faccia non si dichiara due volte.
#[test]
fn weight_style_and_duplicates_are_checked() {
    for (entries, why) in [
        (
            vec![font("Carta", "fonts/carta.woff2", 99, "normal")],
            "not between 100 and 900",
        ),
        (
            vec![font("Carta", "fonts/carta.woff2", 901, "normal")],
            "not between 100 and 900",
        ),
        (
            vec![font("Carta", "fonts/carta.woff2", 400, "oblique")],
            "unknown variant",
        ),
        (
            vec![
                font("Carta", "fonts/carta.woff2", 400, "normal"),
                font("carta", "fonts/carta.woff2", 400, "normal"),
            ],
            "twice",
        ),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.peso",
            &font_list(&entries),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root).expect_err("refused");
        malformed_because(error, why);
    }

    // Gli estremi reggono.
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_font_theme(
        &root,
        "test.estremi",
        &font_list(&[
            font("Carta", "fonts/carta.woff2", 100, "normal"),
            font("Carta", "fonts/carta.woff2", 900, "italic"),
        ]),
        &[("fonts/carta.woff2", woff2(16))],
    );
    fub_host::theme::install_theme(&config, &root).expect("100 and 900 install");
}

/// Al massimo otto caratteri: l'ottavo regge, il nono no.
#[test]
fn at_most_eight_fonts() {
    let names: Vec<String> = (1..=9).map(|n| format!("fonts/f{n}.woff2")).collect();
    let files: Vec<(&str, Vec<u8>)> = names
        .iter()
        .map(|name| (name.as_str(), woff2(16)))
        .collect();
    let entries: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(n, name)| font(&format!("Carta {n}"), name, 400, "normal"))
        .collect();

    let (_config_dir, config) = folders();
    let (_eight_dir, eight) = folders();
    write_font_theme(&eight, "test.otto", &font_list(&entries[..8]), &files[..8]);
    fub_host::theme::install_theme(&config, &eight).expect("eight fonts install");

    let (_nine_dir, nine) = folders();
    write_font_theme(&nine, "test.nove", &font_list(&entries), &files);
    let error = fub_host::theme::install_theme(&config, &nine).expect_err("the ninth is refused");
    malformed_because(error, "9 fonts declared, at most 8");
}

/// 2 MiB l'uno: un byte di più è rifiutato.
#[test]
fn a_font_file_weighs_at_most_two_mib() {
    let limit = fub_abi::theme::MAX_THEME_FONT_BYTES as usize;
    let (_config_dir, config) = folders();
    let (_ok_dir, ok) = folders();
    write_font_theme(
        &ok,
        "test.giusto",
        &font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(limit))],
    );
    fub_host::theme::install_theme(&config, &ok).expect("2 MiB install");

    let (_big_dir, big) = folders();
    write_font_theme(
        &big,
        "test.grosso",
        &font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(limit + 1))],
    );
    let error = fub_host::theme::install_theme(&config, &big).expect_err("2 MiB + 1 is refused");
    malformed_because(error, "exceeds 2097152 bytes");
}

/// 6 MiB in tutto: esatti reggono, 6 MiB e un byte no. Un file nominato da due
/// voci si conta una volta.
#[test]
fn the_fonts_weigh_at_most_six_mib_together() {
    let each = fub_abi::theme::MAX_THEME_FONT_BYTES as usize;
    let entries = |last: &str| {
        font_list(&[
            font("Carta", "fonts/a.woff2", 400, "normal"),
            font("Carta", "fonts/b.woff2", 700, "normal"),
            font("Carta", "fonts/c.woff2", 400, "italic"),
            font("Carta", "fonts/c.woff2", 700, "italic"),
            font("Carta", last, 300, "normal"),
        ])
    };

    let (_config_dir, config) = folders();
    let (_ok_dir, ok) = folders();
    write_font_theme(
        &ok,
        "test.sei",
        &entries("fonts/c.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each)),
        ],
    );
    fub_host::theme::install_theme(&config, &ok).expect("6 MiB exactly install");

    let (_big_dir, big) = folders();
    write_font_theme(
        &big,
        "test.troppo",
        &entries("fonts/d.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each)),
            ("fonts/d.woff2", woff2(4)),
        ],
    );
    let error = fub_host::theme::install_theme(&config, &big).expect_err("6 MiB + 4 is refused");
    malformed_because(error, "exceed 6291456 bytes together");

    // Un byte solo sopra il tetto.
    let (_byte_dir, byte) = folders();
    write_font_theme(
        &byte,
        "test.byte",
        &entries("fonts/d.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each - 3)),
            ("fonts/d.woff2", woff2(4)),
        ],
    );
    let error = fub_host::theme::install_theme(&config, &byte).expect_err("6 MiB + 1 is refused");
    malformed_because(error, "exceed 6291456 bytes together");
}

/// `theme-1` è congelato e non impara i caratteri.
#[test]
fn fonts_need_theme_2() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(
        &root,
        "test.vecchio",
        "theme-1",
        &format!(
            r#", "fonts": {}"#,
            font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")])
        ),
    );
    std::fs::create_dir_all(root.join("fonts")).unwrap();
    std::fs::write(root.join("fonts/carta.woff2"), woff2(16)).unwrap();
    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-1 has no fonts");
    malformed_because(error, "fonts need `theme-2`");
}
