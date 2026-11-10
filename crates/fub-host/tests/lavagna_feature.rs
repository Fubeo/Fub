//! Le impostazioni della feature `lavagna` (`fub.lavagna`), accese e spente,
//! sul montaggio di produzione.
//!
//! Accesa, il gruppo «Lavagna» ha dodici impostazioni, nell'ordine del
//! pannello. Le prime cinque sono della macchina: si scrivono nel file della
//! macchina e non in quello del vault. Le altre sette sono del vault e stanno
//! in `<root>/.fub/settings.json`. Un valore scritto a mano che non regge la sua
//! specie (un interruttore con un testo, una scelta fuori lista, un testo dove
//! ci vuole un elenco) vale il default, e le altre chiavi non si perdono.
//! Spenta, le chiavi non ci sono: non si leggono e non si scrivono.
//!
//! Lo stesso file si compila nei due giri: `cargo test -p fub-host` prova il
//! ramo acceso (la feature è fra le `official-features`), e un giro senza
//! `lavagna` quello spento.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::SettingValue;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

/// Le cinque impostazioni della macchina, nell'ordine del pannello.
const MACHINE_KEYS: [&str; 5] = [
    "canvas.ink_mouse_remember",
    "canvas.finger_moves_card",
    "canvas.finger_writes",
    "canvas.pen_button",
    "canvas.wheel",
];

/// Le sette impostazioni del vault, nell'ordine del pannello.
const VAULT_KEYS: [&str; 7] = [
    "canvas.workspace",
    "canvas.toolbar",
    "canvas.grid",
    "canvas.snap",
    "canvas.parts_picker",
    "canvas.drop_folder",
    "canvas.drop_folder_path",
];

/// Le dodici chiavi, nell'ordine del pannello.
fn all_keys() -> Vec<&'static str> {
    MACHINE_KEYS.into_iter().chain(VAULT_KEYS).collect()
}

/// Il valore di serie di ciascuna chiave, nell'ordine di [`all_keys`].
#[cfg(feature = "lavagna")]
fn defaults() -> Vec<SettingValue> {
    vec![
        SettingValue::Toggle(false),
        SettingValue::Toggle(false),
        SettingValue::Toggle(false),
        SettingValue::Text("radial".into()),
        SettingValue::Text("pan".into()),
        SettingValue::Text("auto".into()),
        SettingValue::List(Vec::new()),
        SettingValue::Toggle(true),
        SettingValue::Toggle(true),
        SettingValue::Toggle(true),
        SettingValue::Text("notes".into()),
        SettingValue::Text("Allegati".into()),
    ]
}

/// Il vault in `root`, con le impostazioni della macchina nel file `machine`.
fn mounted(root: &Utf8Path, machine: &Utf8Path) -> fub_host::mount::Mounted {
    let (machine, warning) = MachineSettings::open(machine);
    assert!(
        warning.is_none(),
        "il file della macchina si legge: {warning:?}"
    );
    fub_host::mount::mount(
        root,
        machine,
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il vault si monta")
}

/// Un vault vuoto e il posto del file della macchina, fuori dal vault.
fn places(dir: &tempfile::TempDir) -> (Utf8PathBuf, Utf8PathBuf) {
    let base = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let root = base.join("vault");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("nota.md"), "# Nota\n").unwrap();
    (root, base.join("machine.json"))
}

#[test]
fn the_whiteboard_settings_exist_only_with_the_lavagna_feature() {
    let dir = tempfile::tempdir().unwrap();
    let (root, machine) = places(&dir);
    let mut mounted = mounted(&root, &machine);
    let ws = &mut mounted.workspace;

    #[cfg(not(feature = "lavagna"))]
    {
        for key in all_keys() {
            assert!(ws.setting(key).is_err(), "{key}");
            assert!(
                ws.set_setting(key, SettingValue::Toggle(true)).is_err(),
                "{key}"
            );
        }
        assert!(
            !machine.exists(),
            "nessuna scrittura nel file della macchina"
        );
        let vault = root.join(".fub").join("settings.json");
        if vault.exists() {
            let vault = std::fs::read_to_string(&vault).unwrap();
            assert!(!vault.contains("canvas."), "{vault}");
        }
    }

    #[cfg(feature = "lavagna")]
    {
        use fub_abi::settings::SettingScope;
        use fub_abi::traits::{IndexQuery, IndexResult};
        let Ok(IndexResult::Settings(entries)) = ws.query_index(IndexQuery::Settings {
            plugin: Some(fub_features::LAVAGNA_ID.into()),
        }) else {
            panic!("le impostazioni della lavagna rispondono")
        };
        // Il bundle porta anche le chiavi sintetiche dei permessi e delle
        // scorciatoie: qui contano le sue.
        let listed: Vec<_> = entries
            .iter()
            .map(|entry| entry.spec.key.as_str())
            .filter(|key| key.starts_with("canvas."))
            .collect();
        assert_eq!(listed, all_keys());
        let defaults = defaults();
        for (index, key) in all_keys().into_iter().enumerate() {
            let entry = entries.iter().find(|entry| entry.spec.key == key).unwrap();
            // Di serie, e nell'ambito che la specifica dichiara.
            let scope = if index < MACHINE_KEYS.len() {
                SettingScope::Machine
            } else {
                SettingScope::Vault
            };
            assert_eq!(entry.spec.scope, scope, "{key}");
            assert_eq!(entry.value, defaults[index], "{key}");
            assert_eq!(ws.setting(key).unwrap(), defaults[index], "{key}");
        }

        // Ogni specie prende il suo valore e rifiuta gli altri; un rifiuto
        // lascia il valore com'era.
        let cases = [
            (
                "canvas.ink_mouse_remember",
                SettingValue::Toggle(true),
                SettingValue::Text("sì".into()),
            ),
            (
                "canvas.finger_moves_card",
                SettingValue::Toggle(true),
                SettingValue::Text("sì".into()),
            ),
            (
                "canvas.finger_writes",
                SettingValue::Toggle(true),
                SettingValue::Text("sì".into()),
            ),
            (
                "canvas.pen_button",
                SettingValue::Text("eraser".into()),
                SettingValue::Text("laser".into()),
            ),
            (
                "canvas.wheel",
                SettingValue::Text("zoom".into()),
                SettingValue::Text("ruota".into()),
            ),
            (
                "canvas.workspace",
                SettingValue::Text("simple".into()),
                SettingValue::Text("gigante".into()),
            ),
            (
                "canvas.toolbar",
                SettingValue::List(vec!["pen".into(), "text".into()]),
                SettingValue::Toggle(true),
            ),
            (
                "canvas.grid",
                SettingValue::Toggle(false),
                SettingValue::Text("no".into()),
            ),
            (
                "canvas.snap",
                SettingValue::Toggle(false),
                SettingValue::Text("no".into()),
            ),
            (
                "canvas.parts_picker",
                SettingValue::Toggle(false),
                SettingValue::Text("no".into()),
            ),
            (
                "canvas.drop_folder",
                SettingValue::Text("folder".into()),
                SettingValue::Text("cestino".into()),
            ),
            (
                "canvas.drop_folder_path",
                SettingValue::Text("Materiali".into()),
                SettingValue::Toggle(true),
            ),
        ];
        for (key, good, bad) in &cases {
            ws.set_setting(key, good.clone())
                .expect("il valore giusto si scrive");
            assert_eq!(ws.setting(key).unwrap(), *good, "{key}");
            assert!(
                ws.set_setting(key, bad.clone()).is_err(),
                "{key} rifiuta un valore di specie sbagliata"
            );
            assert_eq!(ws.setting(key).unwrap(), *good, "{key}");
        }

        // Le cinque della macchina stanno nel suo file, le sette del vault in
        // quello del vault, e nessuna nell'altro.
        let machine_text = std::fs::read_to_string(&machine).expect("il file della macchina");
        let vault_file = root.join(".fub").join("settings.json");
        let vault_text = std::fs::read_to_string(&vault_file).expect("il file del vault");
        for key in MACHINE_KEYS {
            assert!(
                machine_text.contains(&format!("\"{key}\"")),
                "{key}: {machine_text}"
            );
            assert!(
                !vault_text.contains(&format!("\"{key}\"")),
                "{key}: {vault_text}"
            );
        }
        for key in VAULT_KEYS {
            assert!(
                vault_text.contains(&format!("\"{key}\"")),
                "{key}: {vault_text}"
            );
            assert!(
                !machine_text.contains(&format!("\"{key}\"")),
                "{key}: {machine_text}"
            );
        }

        // Un vault che si riapre sulla stessa macchina ritrova ciò che ha
        // scelto, sia nel file della macchina sia in quello del vault.
        drop(mounted);
        let reopened = self::mounted(&root, &machine);
        for (key, good, _) in &cases {
            assert_eq!(reopened.workspace.setting(key).unwrap(), *good, "{key}");
        }
    }

    // Le impostazioni non toccano le note.
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "# Nota\n"
    );
}

/// Un valore scritto a mano che non regge la sua specie vale il default; le
/// altre chiavi dei due file restano com'erano, anche quando un'altra si
/// scrive.
#[test]
fn a_hand_written_value_that_does_not_fit_reads_as_default_and_keeps_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let (root, machine) = places(&dir);
    std::fs::write(
        &machine,
        serde_json::json!({"version": 1, "values": {
            "canvas.ink_mouse_remember": "sì",
            "canvas.finger_moves_card": 7,
            "canvas.pen_button": "laser",
            "altro.programma": {"tiene": [1, null]},
        }})
        .to_string(),
    )
    .unwrap();
    std::fs::create_dir_all(root.join(".fub")).unwrap();
    let vault_file = root.join(".fub").join("settings.json");
    std::fs::write(
        &vault_file,
        serde_json::json!({"version": 1, "values": {
            "canvas.workspace": "gigante",
            "canvas.grid": "no",
            "canvas.toolbar": "pen",
            "canvas.drop_folder_path": 5,
        }})
        .to_string(),
    )
    .unwrap();
    let mut mounted = mounted(&root, &machine);
    let ws = &mut mounted.workspace;

    #[cfg(not(feature = "lavagna"))]
    {
        for key in all_keys() {
            assert!(ws.setting(key).is_err(), "{key}");
        }
    }

    #[cfg(feature = "lavagna")]
    {
        for (key, default) in all_keys().into_iter().zip(defaults()) {
            assert_eq!(ws.setting(key).unwrap(), default, "{key}");
        }
        ws.set_setting("canvas.finger_moves_card", SettingValue::Toggle(true))
            .unwrap();
        assert_eq!(
            ws.setting("canvas.finger_moves_card").unwrap(),
            SettingValue::Toggle(true)
        );
        assert_eq!(
            ws.setting("canvas.ink_mouse_remember").unwrap(),
            SettingValue::Toggle(false)
        );
        ws.set_setting("canvas.grid", SettingValue::Toggle(false))
            .unwrap();
    }

    // Ciò che Fub non sa leggere resta nel file, com'era.
    let machine_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&machine).unwrap()).unwrap();
    let text = machine_json.to_string();
    assert!(
        text.contains(r#""altro.programma":{"tiene":[1,null]}"#),
        "{text}"
    );
    assert!(
        text.contains(r#""canvas.ink_mouse_remember":"sì""#),
        "{text}"
    );
    let vault_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&vault_file).unwrap()).unwrap();
    assert_eq!(vault_json["values"]["canvas.workspace"], "gigante");
    assert_eq!(vault_json["values"]["canvas.drop_folder_path"], 5);
}
