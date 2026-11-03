//! Le impostazioni della feature `lavagna` (`fub.lavagna`), accesa e spenta,
//! sul montaggio di produzione.
//!
//! Accesa, il vault ha due interruttori della macchina, spenti di serie:
//! `canvas.ink_mouse_remember` («Ricorda se scrivi col mouse») e
//! `canvas.finger_moves_card` («Il dito sposta le schede»). Si scrivono nel
//! file della macchina e non in quello del vault, e un valore di tipo
//! sbagliato scritto a mano nel file vale spento senza che le altre chiavi si
//! perdano. Spenta, le chiavi non ci sono: non si leggono e non si scrivono.
//!
//! Lo stesso file si compila nei due giri: `cargo test -p fub-host` prova il
//! ramo acceso (la feature è fra le `official-features`), e un giro senza
//! `lavagna` quello spento.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::SettingValue;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

const INK_MOUSE_REMEMBER: &str = "canvas.ink_mouse_remember";
const FINGER_MOVES_CARD: &str = "canvas.finger_moves_card";

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
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
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
        let keys: Vec<_> = entries
            .iter()
            .map(|entry| entry.spec.key.as_str())
            .filter(|key| key.starts_with("canvas."))
            .collect();
        assert_eq!(keys, [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD]);
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
            let entry = entries.iter().find(|entry| entry.spec.key == key).unwrap();
            // Spente di serie, e della macchina.
            assert_eq!(entry.value, SettingValue::Toggle(false), "{key}");
            assert_eq!(entry.spec.scope, SettingScope::Machine, "{key}");
            assert_eq!(ws.setting(key).unwrap(), SettingValue::Toggle(false));

            ws.set_setting(key, SettingValue::Toggle(true))
                .expect("l'interruttore si accende");
            assert_eq!(ws.setting(key).unwrap(), SettingValue::Toggle(true));
            assert!(
                ws.set_setting(key, SettingValue::Text("sì".into()))
                    .is_err(),
                "{key} prende solo un interruttore"
            );
            assert_eq!(ws.setting(key).unwrap(), SettingValue::Toggle(true));
        }

        // Sono della macchina: stanno nel suo file, non in quello del vault.
        let written = std::fs::read_to_string(&machine).expect("il file della macchina");
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
            assert!(written.contains(&format!("\"{key}\"")), "{key}: {written}");
        }
        let vault = root.join(".fub").join("settings.json");
        if vault.exists() {
            let vault = std::fs::read_to_string(&vault).unwrap();
            assert!(!vault.contains("canvas."), "{vault}");
        }

        // Un vault che si riapre sulla stessa macchina le ritrova.
        drop(mounted);
        let reopened = self::mounted(&root, &machine);
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
            assert_eq!(
                reopened.workspace.setting(key).unwrap(),
                SettingValue::Toggle(true),
                "{key}"
            );
        }
    }

    // Le impostazioni non toccano le note.
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "# Nota\n"
    );
}

/// Un valore che non è un interruttore, scritto a mano nel file della
/// macchina, vale spento; le altre chiavi del file restano com'erano, anche
/// dopo che un'altra chiave si scrive.
#[test]
fn a_hand_written_value_of_the_wrong_kind_reads_as_off_and_keeps_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let (root, machine) = places(&dir);
    std::fs::write(
        &machine,
        serde_json::json!({"version": 1, "values": {
            INK_MOUSE_REMEMBER: "sì",
            FINGER_MOVES_CARD: 7,
            "altro.programma": {"tiene": [1, null]},
        }})
        .to_string(),
    )
    .unwrap();
    let mut mounted = mounted(&root, &machine);
    let ws = &mut mounted.workspace;

    #[cfg(not(feature = "lavagna"))]
    {
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
            assert!(ws.setting(key).is_err(), "{key}");
        }
    }

    #[cfg(feature = "lavagna")]
    {
        for key in [INK_MOUSE_REMEMBER, FINGER_MOVES_CARD] {
            assert_eq!(
                ws.setting(key).unwrap(),
                SettingValue::Toggle(false),
                "{key}"
            );
        }
        ws.set_setting(FINGER_MOVES_CARD, SettingValue::Toggle(true))
            .unwrap();
        assert_eq!(
            ws.setting(FINGER_MOVES_CARD).unwrap(),
            SettingValue::Toggle(true)
        );
        assert_eq!(
            ws.setting(INK_MOUSE_REMEMBER).unwrap(),
            SettingValue::Toggle(false)
        );
    }

    // Ciò che Fub non sa leggere resta nel file, com'era.
    let written: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&machine).unwrap()).unwrap();
    let text = written.to_string();
    assert!(
        text.contains(r#""altro.programma":{"tiene":[1,null]}"#),
        "{text}"
    );
    assert!(
        text.contains(r#""canvas.ink_mouse_remember":"sì""#),
        "{text}"
    );
}
