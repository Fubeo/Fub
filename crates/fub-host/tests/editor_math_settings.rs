//! Le due preferenze delle formule (T60, T63) sul montaggio di produzione:
//! «Mostra il LaTeX» (`editor.math.source`) e i suoi aiuti
//! (`editor.math.help`). Sono della macchina: si scrivono nel suo file, non in
//! quello del vault, e restano dopo il riavvio. Un valore scritto a mano che
//! non è fra le tre misure vale `piene`, il valore di serie.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::SettingValue;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

const SOURCE: &str = "editor.math.source";
const HELP: &str = "editor.math.help";

/// Il vault in `root`, con le impostazioni della macchina nel file `machine`.
fn mounted(root: &Utf8Path, machine: &Utf8Path) -> fub_host::mount::Mounted {
    let (machine, _warning) = MachineSettings::open(machine);
    fub_host::mount::mount(
        root,
        machine,
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il vault si monta")
}

/// Un vault con una nota e il posto del file della macchina, fuori dal vault.
fn places(dir: &tempfile::TempDir) -> (Utf8PathBuf, Utf8PathBuf) {
    let base = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let root = base.join("vault");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("nota.md"), "# Nota\n\n$x^2$\n").unwrap();
    (root, base.join("machine.json"))
}

#[test]
fn the_math_settings_start_off_and_full_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let (root, machine) = places(&dir);
    {
        let mut mounted = mounted(&root, &machine);
        let ws = &mut mounted.workspace;
        assert_eq!(ws.setting(SOURCE).unwrap(), SettingValue::Toggle(false));
        assert_eq!(
            ws.setting(HELP).unwrap(),
            SettingValue::Text("piene".into())
        );

        ws.set_setting(SOURCE, SettingValue::Toggle(true)).unwrap();
        ws.set_setting(HELP, SettingValue::Text("spente".into()))
            .unwrap();
        // Una misura che non c'è non si scrive, e la scelta resta.
        assert!(ws
            .set_setting(HELP, SettingValue::Text("tante".into()))
            .is_err());
        assert!(ws.set_setting(HELP, SettingValue::Toggle(true)).is_err());
        assert_eq!(
            ws.setting(HELP).unwrap(),
            SettingValue::Text("spente".into())
        );
    }

    // Nel file della macchina, non in quello del vault.
    let machine_text = std::fs::read_to_string(&machine).expect("il file della macchina");
    assert!(
        machine_text.contains(&format!("\"{HELP}\"")),
        "{machine_text}"
    );
    assert!(
        machine_text.contains(&format!("\"{SOURCE}\"")),
        "{machine_text}"
    );
    let vault_file = root.join(".fub").join("settings.json");
    if let Ok(vault_text) = std::fs::read_to_string(&vault_file) {
        assert!(!vault_text.contains(HELP), "{vault_text}");
    }

    // Dopo il riavvio le scelte sono quelle di prima.
    let reopened = mounted(&root, &machine);
    assert_eq!(
        reopened.workspace.setting(SOURCE).unwrap(),
        SettingValue::Toggle(true)
    );
    assert_eq!(
        reopened.workspace.setting(HELP).unwrap(),
        SettingValue::Text("spente".into())
    );

    // Le preferenze non toccano le note.
    assert_eq!(
        std::fs::read_to_string(root.join("nota.md")).unwrap(),
        "# Nota\n\n$x^2$\n"
    );
}

#[test]
fn a_hand_written_help_that_is_not_a_level_reads_as_full() {
    let dir = tempfile::tempdir().unwrap();
    let (root, machine) = places(&dir);
    std::fs::write(
        &machine,
        serde_json::json!({"version": 1, "values": {
            HELP: "a metà",
            SOURCE: "sì",
        }})
        .to_string(),
    )
    .unwrap();
    let mounted = mounted(&root, &machine);
    assert_eq!(
        mounted.workspace.setting(HELP).unwrap(),
        SettingValue::Text("piene".into())
    );
    assert_eq!(
        mounted.workspace.setting(SOURCE).unwrap(),
        SettingValue::Toggle(false)
    );
    // Il valore scritto a mano resta nel file, com'era.
    let text = std::fs::read_to_string(&machine).unwrap();
    assert!(text.contains("a metà"), "{text}");
}
