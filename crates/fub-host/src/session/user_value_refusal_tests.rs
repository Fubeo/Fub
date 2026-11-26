use std::sync::mpsc;
use std::time::Duration;

use super::*;

/// Il rifiuto di un valore aspetta il workspace e parla la lingua del
/// vault, anche mentre qualcun altro lo tiene: subito dopo l'apertura
/// l'indice lavora a fette, e sul runner Windows la risposta usciva nella
/// lingua del sistema (corsa 44420733378, `settings_user_values.rs:114`).
#[test]
fn the_refusal_waits_for_the_vault_and_speaks_its_language() {
    let vault = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let host = Host::without_watcher();
    // Il sistema parla italiano, il vault inglese: le due lingue si
    // distinguono nella frase.
    host.publish_locale(fub_abi::Locale {
        language: "it".to_owned(),
        ..fub_abi::Locale::default()
    });
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    host.set_setting_for_user(
        None,
        fub_kernel::locale::LANGUAGE,
        fub_abi::settings::SettingValue::Text("en".into()),
    )
    .unwrap();

    let workspace = host.debug_workspace(None).unwrap();
    let (held, is_held) = mpsc::channel();
    let holder = std::thread::spawn(move || {
        let guard = workspace.write().unwrap();
        held.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        drop(guard);
    });
    is_held.recv().unwrap();
    let refused = host.set_setting_for_user(
        None,
        fub_kernel::locale::TIMEZONE,
        fub_abi::settings::SettingValue::Text("Mars/Olympus".into()),
    );
    holder.join().unwrap();

    let Err(PluginError::BadArgs(message)) = refused else {
        panic!("atteso un BadArgs, non {refused:?}")
    };
    let said = message.as_literal().expect("una frase risolta");
    assert!(said.contains("is not a known time zone"), "{said}");
}
