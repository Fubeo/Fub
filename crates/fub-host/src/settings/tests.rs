use super::*;
use fub_abi::settings::{SettingSource, SettingValue};
use fub_kernel::MachineSettings;

/// Senza la feature `craft` nessuna delle cinque di «App esterne» c'è.
#[cfg(not(feature = "craft"))]
#[test]
fn without_craft_no_craft_setting_is_declared() {
    let craft: Vec<String> = core_settings()
        .into_iter()
        .map(|spec| spec.key)
        .filter(|key| key.starts_with("craft."))
        .collect();
    assert!(craft.is_empty(), "{craft:?}");
}

/// Con la feature ci sono tutte e cinque, nel gruppo «App esterne» e di
/// macchina.
#[cfg(feature = "craft")]
#[test]
fn with_craft_the_five_external_app_settings_are_of_the_machine() {
    let craft: Vec<SettingSpec> = core_settings()
        .into_iter()
        .filter(|spec| spec.key.starts_with("craft."))
        .collect();
    let keys: Vec<&str> = craft.iter().map(|spec| spec.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            CRAFT_EDITOR_PATHS,
            CRAFT_CLI_PREVIEWS,
            CRAFT_PREVIEW_MAX_MIB,
            CRAFT_TREE_THUMBNAILS,
            CRAFT_TREE_SHOW_XMP,
        ]
    );
    for spec in &craft {
        assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
        assert_eq!(spec.group, Text::key(C_GROUP_EXTERNAL_APPS), "{}", spec.key);
    }
}

/// La cartella delle persone (K5) è del vault, viaggia con lui, e parte da
/// `Persone`: `@` propone le note che ci stanno.
#[test]
fn the_people_folder_is_a_vault_text_starting_at_persone() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == FILES_PEOPLE_FOLDER)
        .expect("la cartella delle persone è fra le impostazioni");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
    assert!(matches!(
        &spec.kind,
        SettingKind::Text { default } if default == "Persone"
    ));
}

/// La cartella dei tipi di nota (E5) è del vault, viaggia con lui, e
/// parte da `Tipi`.
#[test]
fn the_types_folder_is_a_vault_text_starting_at_tipi() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == FILES_TYPES_FOLDER)
        .expect("la cartella dei tipi è fra le impostazioni");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
    assert_eq!(spec.group, Text::key(C_GROUP_FILES));
    assert!(matches!(
        &spec.kind,
        SettingKind::Text { default } if default == DEFAULT_TYPES_FOLDER
    ));
}

fn map(rows: &[(&str, &str)]) -> BTreeMap<String, String> {
    rows.iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Il confronto è sul **valore**, non sulla presenza: un accordo cambiato su
/// una chiave già adottata è un accordo nuovo, e chiedere di nuovo è la sola
/// risposta che non dia per buono ciò che nessuno ha visto.
#[test]
fn is_that_changed_not_that_appeared() {
    let vault = map(&[
        ("keys.note.create", "Mod-Alt-k"),
        ("keys.trash.empty", "Mod-s"),
        ("keys.vault.undo", "Mod-z"),
    ]);
    let seen = map(&[
        // uguale: adottata e non cambiata
        ("keys.note.create", "Mod-Alt-k"),
        // diversa: adottata ieri, cambiata stanotte
        ("keys.trash.empty", "Mod-k"),
        // e una che il file non porta più: non è in discussione
        ("keys.note.rename", "Mod-r"),
    ]);
    let from_watch = keys_to_watch(&vault, &seen);
    assert_eq!(
        from_watch,
        BTreeSet::from([
            "keys.trash.empty".to_string(),
            "keys.vault.undo".to_string()
        ])
    );
}

/// Il caso di quasi tutti, e deve costare zero: un vault che non porta
/// scorciatoie non ha niente da guardare.
#[test]
fn a_vault_without_keys_not_asks_nothing() {
    assert!(keys_to_watch(&BTreeMap::new(), &BTreeMap::new()).is_empty());
    assert!(keys_to_watch(&BTreeMap::new(), &map(&[("keys.a", "Mod-a")])).is_empty());
}

#[test]
fn the_performance_probe_is_a_machine_switch_off_by_default() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == PERF_PROBE)
        .expect("il core dichiara la sonda delle prestazioni");
    // Diagnostica di questo PC: vale anche senza un vault aperto, e un
    // vault che la scrivesse non viene ascoltato.
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
    assert_eq!(spec.kind, SettingKind::Toggle { default: false });
    assert!(core_machine_settings()
        .iter()
        .any(|spec| spec.key == PERF_PROBE));
}

#[test]
fn developer_mode_is_a_machine_switch_off_by_default_that_no_program_writes() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == DEVELOPER_MODE)
        .expect("il core dichiara la modalità sviluppatore");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
    assert_eq!(spec.kind, SettingKind::Toggle { default: false });
    // Un programma che potesse accenderla aprirebbe da sé
    // l'installazione da cartella.
    assert!(!spec.program_writable);
    assert!(core_machine_settings()
        .iter()
        .any(|spec| spec.key == DEVELOPER_MODE));
}

#[test]
fn the_linked_theme_folder_is_machine_text_that_no_program_writes() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == DEVELOPER_THEME_FOLDER)
        .expect("il core dichiara la cartella del tema collegato");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
    assert_eq!(
        spec.kind,
        SettingKind::Text {
            default: String::new()
        }
    );
    // Un programma che potesse scriverla sceglierebbe da sé la cartella
    // che l'host legge.
    assert!(!spec.program_writable);
    assert!(crate::shell::SETTINGS_WITH_THEIR_OWN_GESTURE.contains(&DEVELOPER_THEME_FOLDER));
}

#[test]
fn the_live_port_is_a_machine_number_and_reads_back_as_a_port() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == LIVE_PORT)
        .expect("il core dichiara la porta della sessione live");
    // La porta è una regola del firewall di questo PC, non di un vault.
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
    let SettingKind::Number { default, min, max } = spec.kind else {
        panic!("la porta è un numero");
    };
    assert_eq!((default, min, max), (0.0, Some(0.0), Some(65535.0)));

    assert_eq!(live_port(None), 0);
    assert_eq!(live_port(Some(0.0)), 0);
    assert_eq!(live_port(Some(4000.0)), 4000);
    assert_eq!(live_port(Some(65535.0)), 65535);
    // Un valore che non è una porta vale «una porta libera», non un
    // troncamento a una porta che nessuno ha scelto.
    for invalid in [-1.0, 65536.0, 4000.5, f64::NAN, f64::INFINITY] {
        assert_eq!(live_port(Some(invalid)), 0, "{invalid}");
    }
}

#[test]
fn attachment_folder_is_a_vault_text_setting_with_a_real_default() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == ATTACHMENT_FOLDER)
        .expect("il core dichiara la cartella degli allegati");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
    let SettingKind::Text { default } = spec.kind else {
        panic!("la cartella degli allegati è testo");
    };
    assert_eq!(default, DEFAULT_ATTACHMENT_FOLDER);
}

#[test]
fn new_note_folder_is_a_vault_text_setting_defaulting_to_root() {
    let spec = core_settings()
        .into_iter()
        .find(|spec| spec.key == NEW_NOTE_FOLDER)
        .expect("il core dichiara la cartella delle nuove note");
    assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
    let SettingKind::Text { default } = spec.kind else {
        panic!("la cartella delle nuove note è testo");
    };
    assert_eq!(default, DEFAULT_NEW_NOTE_FOLDER);
}

#[test]
fn text_input_preferences_are_machine_settings_with_opt_in_vim() {
    let machine = core_machine_settings();
    for (key, expected) in [(EDITOR_SPELLCHECK, true), (EDITOR_VIM, false)] {
        let spec = machine
            .iter()
            .find(|spec| spec.key == key)
            .expect("preferenza testuale");
        assert!(matches!(&spec.kind, SettingKind::Toggle { default } if *default == expected));
        assert!(!spec.program_writable);
    }
}

/// La tipografia italiana è della macchina e spenta di serie (D8 A): chi
/// non la accende scrive i caratteri della tastiera, e un programma non
/// la cambia.
#[test]
fn typography_is_an_opt_in_machine_toggle_of_the_editor() {
    let machine = core_machine_settings();
    let spec = machine
        .iter()
        .find(|spec| spec.key == EDITOR_TYPOGRAPHY)
        .expect("la tipografia fra le impostazioni");
    assert!(matches!(&spec.kind, SettingKind::Toggle { default: false }));
    assert_eq!(spec.label, Text::key(C_EDITOR_TYPOGRAPHY));
    assert_eq!(spec.group, Text::key(C_GROUP_EDITOR));
    assert!(!spec.program_writable);
}

/// Gli aiuti del LaTeX delle formule sono una scelta della macchina, pieni
/// di serie, subito dopo gli interruttori dell'editor (fra cui «Mostra il
/// LaTeX»), con le tre misure nell'ordine del riquadro (T63).
#[test]
fn math_help_is_a_machine_choice_full_by_default() {
    let machine = core_machine_settings();
    let spec = machine
        .iter()
        .find(|spec| spec.key == EDITOR_MATH_HELP)
        .expect("gli aiuti delle formule fra le impostazioni");
    let SettingKind::Choice { default, options } = &spec.kind else {
        panic!("gli aiuti sono una scelta");
    };
    assert_eq!(default, "piene");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, ["piene", "discrete", "spente"]);
    assert_eq!(spec.label, Text::key(C_EDITOR_MATH_HELP));
    assert_eq!(spec.group, Text::key(C_GROUP_EDITOR));
    assert!(!spec.program_writable);
    assert!(machine.iter().any(|spec| spec.key == EDITOR_MATH_SOURCE));
}

/// La Live si scrive come in Word se nessuno sceglie altro: i segni si
/// vedono soltanto in Sorgente, e le Preferenze offrono le altre due
/// politiche, subito dopo la modalità iniziale.
#[test]
fn live_reveal_defaults_to_never_next_to_the_initial_mode() {
    let machine = core_machine_settings();
    let at = |key: &str| machine.iter().position(|spec| spec.key == key);
    assert_eq!(
        at(EDITOR_LIVE_REVEAL),
        at(EDITOR_DEFAULT_MODE).map(|i| i + 1)
    );
    let spec = &machine[at(EDITOR_LIVE_REVEAL).expect("la rivelazione in Live")];
    let SettingKind::Choice { default, options } = &spec.kind else {
        panic!("la rivelazione è una scelta");
    };
    assert_eq!(default, "mai");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, ["mai", "elemento", "riga"]);
    assert!(!spec.program_writable);
}

/// I blocchi sono una preferenza della macchina, accesa di serie, subito
/// dopo i segni di Scrittura: chi la spegne scrive come in un editor di
/// testo, e un programma non la cambia.
#[test]
fn blocks_are_a_machine_switch_on_by_default_after_the_writing_marks() {
    let machine = core_machine_settings();
    let at = |key: &str| machine.iter().position(|spec| spec.key == key);
    assert_eq!(at(EDITOR_BLOCKS), at(EDITOR_LIVE_REVEAL).map(|i| i + 1));
    let spec = &machine[at(EDITOR_BLOCKS).expect("i blocchi fra le impostazioni")];
    assert!(matches!(spec.kind, SettingKind::Toggle { default: true }));
    assert_eq!(spec.group, Text::key(C_GROUP_EDITOR));
    assert_eq!(spec.label, Text::key(C_EDITOR_BLOCKS));
    assert!(!spec.program_writable);
}

/// Chi firma i commenti (D11 A): il nome è della macchina, vuoto finché la
/// persona non lo sceglie; la firma è del vault, col nome di serie e le
/// iniziali o niente come scelte. Un programma non le cambia, e tutte e
/// due stanno nel gruppo «Profilo», con le parole nelle due lingue.
#[test]
fn the_comment_signature_is_a_machine_name_and_a_vault_choice() {
    let all = core_settings();
    let spec = |key: &str| {
        all.iter()
            .find(|spec| spec.key == key)
            .unwrap_or_else(|| panic!("{key} fra le impostazioni"))
    };
    let name = spec(PROFILE_NAME);
    assert_eq!(name.scope, fub_abi::settings::SettingScope::Machine);
    assert!(matches!(&name.kind, SettingKind::Text { default } if default.is_empty()));
    assert_eq!(name.group, Text::key(C_GROUP_PROFILE));
    assert!(!name.program_writable);
    assert!(core_machine_settings()
        .iter()
        .any(|spec| spec.key == PROFILE_NAME));

    let author = spec(COMMENTS_AUTHOR);
    assert_eq!(author.scope, fub_abi::settings::SettingScope::Vault);
    let SettingKind::Choice { default, options } = &author.kind else {
        panic!("la firma è una scelta");
    };
    assert_eq!(default, "nome");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, COMMENTS_AUTHOR_CHOICES);
    assert_eq!(author.group, Text::key(C_GROUP_PROFILE));
    assert!(!author.program_writable);
    assert!(!core_machine_settings()
        .iter()
        .any(|spec| spec.key == COMMENTS_AUTHOR));

    for catalog in core_catalog() {
        for key in [
            C_GROUP_PROFILE,
            C_PROFILE_NAME,
            C_PROFILE_NAME_DESC,
            C_COMMENTS_AUTHOR,
            C_COMMENTS_AUTHOR_DESC,
            C_COMMENTS_AUTHOR_NAME,
            C_COMMENTS_AUTHOR_INITIALS,
            C_COMMENTS_AUTHOR_NONE,
        ] {
            assert!(
                catalog.entries.contains_key(key),
                "{key} in {}",
                catalog.locale
            );
        }
    }
}

/// Le scelte della modalità iniziale sono Scrittura, Sorgente e Lettura;
/// `blocks` resta valido in fondo, con l'etichetta di Scrittura, perché il
/// pannello lo nasconda (due scelte con la stessa etichetta sono una) e la
/// shell lo apra in Scrittura.
#[test]
fn the_initial_mode_offers_writing_source_reading_and_keeps_blocks_as_writing() {
    let spec = core_machine_settings()
        .into_iter()
        .find(|spec| spec.key == EDITOR_DEFAULT_MODE)
        .expect("il core dichiara la modalità iniziale");
    let SettingKind::Choice { default, options } = &spec.kind else {
        panic!("la modalità iniziale è una scelta");
    };
    assert_eq!(default, "live_preview");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, ["live_preview", "source", "reading", "blocks"]);
    let label = |value: &str| {
        options
            .iter()
            .find(|option| option.value == value)
            .map(|option| option.label.clone())
    };
    assert_eq!(label("blocks"), label("live_preview"));
    assert_eq!(label("live_preview"), Some(Text::key(C_MODE_WRITING)));
    assert!(spec
        .kind
        .rejects(&fub_abi::settings::SettingValue::Text("blocks".into()))
        .is_none());
    let said = |locale: &str| {
        core_catalog()
            .into_iter()
            .find(|catalog| catalog.locale == locale)
            .and_then(|catalog| catalog.entries.get(C_MODE_WRITING).cloned())
    };
    assert_eq!(said("it").as_deref(), Some("Scrittura"));
    assert_eq!(said("en").as_deref(), Some("Writing"));
}

/// Il file della macchina di chi aveva scelto i Blocchi: `blocks` si legge
/// com'è scritto, da lui e non dal predefinito, e il file resta byte per
/// byte quello di prima, dopo l'apertura, la dichiarazione e la lettura.
/// Un valore sconosciuto vale il predefinito, come sempre, e nemmeno lui si
/// riscrive.
#[test]
fn blocks_in_the_machine_file_reads_back_as_written_and_the_file_stays_byte_for_byte() {
    use fub_abi::settings::{SettingSource, SettingValue};
    use fub_kernel::MachineSettings;

    let dir = tempfile::tempdir().expect("cartella temporanea");
    let path = camino::Utf8PathBuf::from_path_buf(dir.path().join("settings.json"))
        .expect("percorso UTF-8");
    // Il file come lo scriveva un Fub che aveva la modalità Blocchi.
    {
        let (old, warning) = MachineSettings::open(&path);
        assert_eq!(warning, None);
        old.declare(&core_machine_settings()).expect("schema");
        old.set(EDITOR_DEFAULT_MODE, SettingValue::Text("blocks".into()))
            .expect("`blocks` è una scelta valida");
    }
    let before = std::fs::read(&path).expect("il file della macchina");
    assert!(String::from_utf8_lossy(&before).contains("\"blocks\""));

    let read = |path: &camino::Utf8Path| {
        let (machine, warning) = MachineSettings::open(path);
        assert_eq!(warning, None);
        machine.declare(&core_machine_settings()).expect("schema");
        let entry = machine
            .entries()
            .into_iter()
            .find(|entry| entry.spec.key == EDITOR_DEFAULT_MODE)
            .expect("la riga della modalità iniziale");
        assert_eq!(
            machine.effective(EDITOR_DEFAULT_MODE).expect("dichiarata"),
            (entry.value.clone(), entry.source)
        );
        (entry.value, entry.source)
    };
    assert_eq!(
        read(&path),
        (SettingValue::Text("blocks".into()), SettingSource::Machine)
    );
    assert_eq!(std::fs::read(&path).expect("il file"), before);

    let unknown = String::from_utf8(before.clone())
        .expect("JSON")
        .replace("\"blocks\"", "\"pagine\"")
        .into_bytes();
    std::fs::write(&path, &unknown).expect("scrive il valore sconosciuto");
    assert_eq!(
        read(&path),
        (
            SettingValue::Text("live_preview".into()),
            SettingSource::Default
        )
    );
    assert_eq!(std::fs::read(&path).expect("il file"), unknown);
}

/// Il percorso di disegno si legge prima di GTK, senza host: senza file,
/// senza cartella o con un valore sconosciuto vale `auto`; una scelta
/// scritta si legge com'è; il file non cambia di un byte. Solo Linux
/// dichiara la chiave.
#[test]
fn rendering_is_read_before_the_host_and_unknown_values_are_auto() {
    use fub_abi::settings::SettingValue;
    use fub_kernel::MachineSettings;

    let keys = [APPEARANCE_RENDERING, APPEARANCE_MOTION];
    let dir = tempfile::tempdir().expect("cartella temporanea");
    let config =
        camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("percorso UTF-8");
    let rendering = |config: Option<&camino::Utf8Path>| {
        startup_machine_texts(config, &keys)
            .get(APPEARANCE_RENDERING)
            .cloned()
    };
    if !cfg!(target_os = "linux") {
        assert_eq!(rendering(Some(&config)), None);
        assert!(!core_machine_settings()
            .iter()
            .any(|spec| spec.key == APPEARANCE_RENDERING));
        return;
    }
    // Un file di prima, che la chiave non la conosce.
    assert_eq!(rendering(None).as_deref(), Some("auto"));
    assert_eq!(rendering(Some(&config)).as_deref(), Some("auto"));
    let path = crate::config::machine_settings_path(&config);
    {
        let (machine, _) = MachineSettings::open(&path);
        machine.declare(&core_machine_settings()).expect("schema");
        machine
            .set(APPEARANCE_MOTION, SettingValue::Text("calm".into()))
            .expect("motion");
    }
    assert_eq!(rendering(Some(&config)).as_deref(), Some("auto"));
    assert_eq!(
        startup_machine_texts(Some(&config), &keys)
            .get(APPEARANCE_MOTION)
            .map(String::as_str),
        Some("calm")
    );
    {
        let (machine, _) = MachineSettings::open(&path);
        machine.declare(&core_machine_settings()).expect("schema");
        machine
            .set(APPEARANCE_RENDERING, SettingValue::Text("cpu".into()))
            .expect("`cpu` è una scelta valida");
        assert!(machine
            .set(APPEARANCE_RENDERING, SettingValue::Text("never".into()))
            .is_err());
    }
    let before = std::fs::read(&path).expect("il file della macchina");
    assert_eq!(rendering(Some(&config)).as_deref(), Some("cpu"));
    assert_eq!(std::fs::read(&path).expect("il file"), before);

    let unknown = String::from_utf8(before)
        .expect("JSON")
        .replace("\"cpu\"", "\"never\"");
    std::fs::write(&path, &unknown).expect("valore sconosciuto");
    assert_eq!(rendering(Some(&config)).as_deref(), Some("auto"));
    std::fs::write(&path, b"{ rotto").expect("file rotto");
    assert_eq!(rendering(Some(&config)).as_deref(), Some("auto"));
    assert_eq!(std::fs::read(&path).expect("il file"), b"{ rotto");
}

/// Il default è il massimo dello schermo, e ogni tetto offerto dal pannello
/// si legge come tale: un'opzione che `frame_rate_cap` non riconoscesse
/// resterebbe nel menu e non limiterebbe niente.
#[test]
fn frame_rate_defaults_to_the_display_and_every_option_is_a_cap() {
    let spec = core_machine_settings()
        .into_iter()
        .find(|spec| spec.key == APPEARANCE_FRAME_RATE)
        .expect("il core dichiara il tetto dei fotogrammi");
    let SettingKind::Choice { default, options } = spec.kind else {
        panic!("il tetto dei fotogrammi è una scelta");
    };
    assert_eq!(default, "");
    assert_eq!(frame_rate_cap(&default), None);
    let caps: Vec<Option<u32>> = options
        .iter()
        .skip(1)
        .map(|option| frame_rate_cap(&option.value))
        .collect();
    assert_eq!(caps, FRAME_RATE_CAPS.map(Some).to_vec());
    assert_eq!(frame_rate_cap("59"), None);
    assert_eq!(frame_rate_cap("veloce"), None);
}

/// Le barre sono una scelta di macchina fra due, di serie il vassoio
/// chiaro, e la riga sta subito dopo «Densità», come nel prototipo.
#[test]
fn the_bars_are_a_machine_choice_of_light_or_marked_after_density() {
    let machine = core_machine_settings();
    let at = |key: &str| machine.iter().position(|spec| spec.key == key);
    assert_eq!(at(APPEARANCE_BARS), at(APPEARANCE_DENSITY).map(|i| i + 1));
    let spec = &machine[at(APPEARANCE_BARS).expect("le barre sono dichiarate")];
    let SettingKind::Choice { default, options } = &spec.kind else {
        panic!("le barre sono una scelta");
    };
    assert_eq!(default, "light");
    let values: Vec<&str> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(values, ["light", "marked"]);
    assert!(!spec.program_writable);
}

fn bars_file(dir: &tempfile::TempDir) -> camino::Utf8PathBuf {
    camino::Utf8PathBuf::from_path_buf(dir.path().join("settings.json"))
        .expect("una cartella di prova con un percorso UTF-8")
}

/// La scelta sopravvive al riavvio: la macchina la scrive sul suo file, e
/// aprendolo di nuovo la rilegge, senza che la shell la ricordi.
#[test]
fn the_marked_tray_survives_a_restart() {
    let dir = tempfile::tempdir().expect("una cartella di prova");
    let path = bars_file(&dir);
    {
        let (machine, _) = MachineSettings::open(&path);
        machine
            .declare(&core_machine_settings())
            .expect("lo schema della macchina");
        machine
            .set(APPEARANCE_BARS, SettingValue::Text("marked".into()))
            .expect("la scelta si scrive");
    }
    let (reopened, warning) = MachineSettings::open(&path);
    assert!(warning.is_none(), "{warning:?}");
    reopened
        .declare(&core_machine_settings())
        .expect("lo schema della macchina");
    assert_eq!(
        reopened.effective(APPEARANCE_BARS).expect("dichiarata"),
        (SettingValue::Text("marked".into()), SettingSource::Machine)
    );
}

/// Un valore che non è né `light` né `marked` (un file scritto a mano, o una
/// versione futura con un'altra scelta) vale il predefinito: non spegne il
/// vassoio, come per ogni scelta di macchina.
#[test]
fn an_unknown_bars_value_falls_back_to_the_light_tray() {
    let dir = tempfile::tempdir().expect("una cartella di prova");
    let path = bars_file(&dir);
    std::fs::write(
        &path,
        r#"{"version":2,"values":{"appearance.bars":"neon"}}"#,
    )
    .expect("il file di prova");
    let (machine, _) = MachineSettings::open(&path);
    machine
        .declare(&core_machine_settings())
        .expect("lo schema della macchina");
    assert_eq!(
        machine.effective(APPEARANCE_BARS).expect("dichiarata"),
        (SettingValue::Text("light".into()), SettingSource::Default)
    );
}

fn motion_spec(webview: Option<Webview>) -> SettingSpec {
    appearance_settings_on(webview)
        .into_iter()
        .find(|spec| spec.key == APPEARANCE_MOTION)
        .expect("l'aspetto dichiara le animazioni")
}

fn motion_spec_default(webview: Option<Webview>) -> String {
    let SettingKind::Choice { default, options } = motion_spec(webview).kind else {
        panic!("le animazioni sono una scelta");
    };
    assert!(
        options.iter().any(|option| option.value == default),
        "il default `{default}` è fra le scelte"
    );
    default
}

/// Sulla WebKitGTK che sfarfalla (dalla 2.54.0, senza limite superiore
/// finché nessuna versione corretta è verificata) le animazioni partono
/// ridotte; sulla 2.52 e su ogni webview non dichiarata seguono il sistema.
#[test]
fn motion_starts_reduced_only_on_the_flickering_webkitgtk() {
    for faulty in ["2.54.0", "2.54.3", "2.55.1", "2.56.0", "3.0.0"] {
        let webview = Webview::webkitgtk(faulty).expect("una versione");
        assert_eq!(motion_spec_default(Some(webview)), "reduced", "{faulty}");
    }
    for sound in ["2.52.3", "2.53.90", "2.50.0", "2.44.1"] {
        let webview = Webview::webkitgtk(sound).expect("una versione");
        assert_eq!(motion_spec_default(Some(webview)), "", "{sound}");
    }
    // Le altre piattaforme non dichiarano una webview: come prima.
    assert_eq!(motion_spec_default(None), "");
    // Il processo dei test non ne dichiara nessuna.
    assert_eq!(
        core_machine_settings()
            .into_iter()
            .find(|spec| spec.key == APPEARANCE_MOTION)
            .map(|spec| spec.kind),
        Some(motion_spec(None).kind)
    );
}

/// Solo tre numeri sono una versione: altrimenti la webview resta non
/// dichiarata e il default non cambia.
#[test]
fn a_webkitgtk_version_is_three_numbers() {
    assert_eq!(
        Webview::webkitgtk("2.54.0"),
        Some(Webview::WebKitGtk(2, 54, 0))
    );
    assert_eq!(
        Webview::webkitgtk(" 2.52.3\n"),
        Some(Webview::WebKitGtk(2, 52, 3))
    );
    for junk in [
        "",
        "2.54",
        "2.54.0.1",
        "2.54.x",
        "webkit 2.54.0",
        "130.0.2849.80x",
    ] {
        assert_eq!(Webview::webkitgtk(junk), None, "{junk:?}");
    }
}

/// Il default nuovo non scavalca una scelta: un valore scritto — anche
/// `""`, «segue il sistema» — si legge com'è, con la provenienza della
/// macchina; senza un valore si legge `reduced`, con la provenienza del
/// default.
#[test]
fn a_written_motion_value_beats_the_webkitgtk_default() {
    use fub_abi::settings::{SettingSource, SettingValue};
    use fub_kernel::MachineSettings;

    let specs: Vec<SettingSpec> = appearance_settings_on(Webview::webkitgtk("2.54.0"))
        .into_iter()
        .filter(|spec| spec.scope == fub_abi::settings::SettingScope::Machine)
        .collect();
    let machine = MachineSettings::in_memory();
    machine.declare(&specs).expect("schema");
    let read = || machine.effective(APPEARANCE_MOTION).expect("dichiarata");
    assert_eq!(
        read(),
        (SettingValue::Text("reduced".into()), SettingSource::Default)
    );
    for written in ["", "calm", "reduced"] {
        machine
            .set(APPEARANCE_MOTION, SettingValue::Text(written.into()))
            .expect("una scelta valida");
        assert_eq!(
            read(),
            (SettingValue::Text(written.into()), SettingSource::Machine),
            "{written:?}"
        );
    }
}
