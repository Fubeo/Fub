//! Le configurazioni di Tauri di ogni piattaforma si leggono con lo schema di
//! `tauri-utils` del lockfile.
//!
//! Le config di Android e iOS le legge soltanto il build script compilato per
//! quel target, cioè il workflow mobile: un campo fuori schema (`ios` in cima
//! invece di `bundle.iOS`, un filtro d'intento scritto `Send`) restava verde
//! qui e rosso là. Questa prova le legge tutte, sul desktop, come le fonde
//! `tauri-build`: la config base più quella della piattaforma.

use tauri::utils::config::{parse, Config};
use tauri::utils::platform::Target;

/// La fusione di `tauri-build` (RFC 7396): un oggetto entra campo per campo,
/// il resto sostituisce.
fn merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base.as_object_mut(), patch.as_object()) {
        (Some(base), Some(patch)) => {
            for (key, value) in patch {
                if value.is_null() {
                    base.remove(key);
                } else {
                    merge(
                        base.entry(key.clone()).or_insert(serde_json::Value::Null),
                        value,
                    );
                }
            }
        }
        _ => *base = patch.clone(),
    }
}

fn config_for(target: Target) -> Config {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let (mut config, _) = parse::read_from(target, dir).expect("la config base si legge");
    if let Some((platform, _)) =
        parse::read_platform(target, dir).expect("la config della piattaforma si legge")
    {
        merge(&mut config, &platform);
    }
    serde_json::from_value(config)
        .unwrap_or_else(|e| panic!("la config di {target:?} esce dallo schema: {e}"))
}

#[test]
fn every_platform_config_fits_the_schema() {
    for target in [
        Target::Linux,
        Target::Windows,
        Target::MacOS,
        Target::Android,
        Target::Ios,
    ] {
        config_for(target);
    }
}

#[test]
fn the_mobile_settings_reach_their_platform() {
    let ios = config_for(Target::Ios);
    assert_eq!(ios.bundle.ios.minimum_system_version, "14.0");
    let android = config_for(Target::Android);
    assert_eq!(android.bundle.android.min_sdk_version, 24);
    assert!(!android.bundle.android.auto_increment_version_code);
}
