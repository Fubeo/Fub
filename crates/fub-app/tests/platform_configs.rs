//! Le configurazioni di Tauri di ogni piattaforma si leggono con lo schema di
//! `tauri-utils` del lockfile.
//!
//! Le config di Android e iOS le legge soltanto il build script compilato per
//! quel target, cioè il workflow mobile: un campo fuori schema (`ios` in cima
//! invece di `bundle.iOS`, un filtro d'intento scritto `Send`) restava verde
//! qui e rosso là. Questa prova le legge tutte, sul desktop, come le fonde
//! `tauri-build`: la config base più quella della piattaforma.

use tauri::utils::config::{parse, Config, Csp};
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

// La CSP della WebView (D-3 (a) del piano N3, decisione 0237): la WebView
// compila WebAssembly per il nucleo della lavagna, e nient'altro si apre.
// `'wasm-unsafe-eval'` permette di compilare un modulo WebAssembly; non
// permette di eseguire testo come JavaScript (`eval`, `new Function`,
// `setTimeout` con una stringa), che resta vietato.

/// Le sole fonti di `script-src`, senza guardare l'ordine.
const SCRIPT_SRC: [&str; 2] = ["'self'", "'wasm-unsafe-eval'"];

/// Le direttive che ridefinirebbero `script-src` per gli elementi o per gli
/// attributi, scavalcandolo: non devono esserci.
const SCRIPT_SRC_OVERRIDES: [&str; 2] = ["script-src-elem", "script-src-attr"];

/// Controlla una CSP direttiva per direttiva. Le parole chiave e i nomi delle
/// direttive della CSP non guardano le maiuscole, e le fonti si separano con
/// uno spazio bianco qualsiasi: il controllo fa lo stesso.
///
/// Rifiuta: `'unsafe-eval'` in una direttiva qualsiasi; `'wasm-unsafe-eval'`
/// fuori da `script-src`; `script-src` che manca, che compare due volte o
/// che non è esattamente `'self' 'wasm-unsafe-eval'`; `script-src-elem` e
/// `script-src-attr`.
fn check_csp(policy: &str) -> Result<(), String> {
    let mut script_src: Option<Vec<String>> = None;
    let mut seen: Vec<String> = Vec::new();
    for directive in policy.split(';') {
        let mut tokens = directive.split_ascii_whitespace();
        let Some(name) = tokens.next() else { continue };
        let name = name.to_ascii_lowercase();
        let sources: Vec<String> = tokens.map(str::to_ascii_lowercase).collect();
        if seen.contains(&name) {
            return Err(format!("la direttiva `{name}` compare due volte"));
        }
        seen.push(name.clone());
        if sources.iter().any(|s| s == "'unsafe-eval'") {
            return Err(format!("`'unsafe-eval'` in `{name}`"));
        }
        if name != "script-src" && sources.iter().any(|s| s == "'wasm-unsafe-eval'") {
            return Err(format!(
                "`'wasm-unsafe-eval'` fuori da `script-src`, in `{name}`"
            ));
        }
        if SCRIPT_SRC_OVERRIDES.contains(&name.as_str()) {
            return Err(format!("`{name}` scavalca `script-src`"));
        }
        if name == "script-src" {
            script_src = Some(sources);
        }
    }
    let Some(mut sources) = script_src else {
        return Err("manca `script-src`".into());
    };
    sources.sort();
    let mut expected: Vec<String> = SCRIPT_SRC.iter().map(|s| s.to_string()).collect();
    expected.sort();
    if sources != expected {
        return Err(format!(
            "`script-src` è `{}` invece di `'self' 'wasm-unsafe-eval'`",
            sources.join(" ")
        ));
    }
    Ok(())
}

/// La CSP come la scrive Tauri, sia come testo sia come mappa di direttive.
fn check(csp: &Csp) -> Result<(), String> {
    check_csp(&csp.to_string())
}

#[test]
fn every_platform_csp_compiles_webassembly_and_never_evaluates_text() {
    for target in [
        Target::Linux,
        Target::Windows,
        Target::MacOS,
        Target::Android,
        Target::Ios,
    ] {
        let security = config_for(target).app.security;
        let csp = security
            .csp
            .unwrap_or_else(|| panic!("la config di {target:?} non ha una CSP"));
        if let Err(why) = check(&csp) {
            panic!("la CSP di {target:?}: {why}");
        }
        if let Some(dev) = security.dev_csp {
            if let Err(why) = check(&dev) {
                panic!("la `devCsp` di {target:?}: {why}");
            }
        }
    }
}

#[test]
fn the_csp_check_accepts_the_shape_it_promises() {
    for policy in [
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'",
        "default-src 'self'; script-src 'wasm-unsafe-eval' 'self'",
        "DEFAULT-SRC 'self' ;\tSCRIPT-SRC  'SELF'\n'WASM-UNSAFE-EVAL' ;;",
    ] {
        assert_eq!(check_csp(policy), Ok(()), "{policy}");
    }
}

#[test]
fn the_csp_check_refuses_every_opening_beyond_webassembly() {
    for policy in [
        // I casi del piano.
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
        "default-src 'self' 'wasm-unsafe-eval'; script-src 'self' 'wasm-unsafe-eval'",
        "default-src 'self'; style-src 'self' 'unsafe-inline'",
        "default-src 'self';  script-src  'self'  'wasm-unsafe-eval'  'UNSAFE-EVAL'  ",
        // `'unsafe-eval'` in un'altra direttiva.
        "default-src 'self' 'unsafe-eval'; script-src 'self' 'wasm-unsafe-eval'",
        // `script-src` diverso da `'self' 'wasm-unsafe-eval'`.
        "default-src 'self'; script-src 'self'",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' data:",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' *",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.example",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'wasm-unsafe-eval'",
        // Due `script-src`, o una direttiva che lo scavalca.
        "script-src 'self' 'wasm-unsafe-eval'; script-src 'self' 'unsafe-inline'",
        "script-src 'self' 'wasm-unsafe-eval'; script-src-elem 'self' 'unsafe-inline'",
        "script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'unsafe-inline'",
        // `'wasm-unsafe-eval'` dove non serve.
        "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' 'wasm-unsafe-eval'",
    ] {
        assert!(check_csp(policy).is_err(), "passa: {policy}");
    }
}

#[test]
fn the_csp_check_reads_the_directive_map_form_too() {
    use std::collections::HashMap;
    use tauri::utils::config::CspDirectiveSources;

    let map = |script: &[&str]| {
        Csp::DirectiveMap(HashMap::from([
            (
                "default-src".to_string(),
                CspDirectiveSources::List(vec!["'self'".into()]),
            ),
            (
                "script-src".to_string(),
                CspDirectiveSources::List(script.iter().map(|s| s.to_string()).collect()),
            ),
        ]))
    };
    assert_eq!(check(&map(&["'self'", "'wasm-unsafe-eval'"])), Ok(()));
    assert!(check(&map(&["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'"])).is_err());
    assert!(check(&map(&["'self'"])).is_err());
}

#[test]
fn a_platform_config_that_opens_eval_is_caught() {
    // La config fusa di una piattaforma che un giorno ridefinisse la CSP: la
    // stessa strada di `config_for`, con la toppa scritta qui.
    let mut base = serde_json::json!({
        "app": { "security": { "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'" } }
    });
    merge(
        &mut base,
        &serde_json::json!({
            "app": { "security": { "csp": "default-src 'self'; script-src 'self' 'unsafe-eval'" } }
        }),
    );
    let csp: Csp =
        serde_json::from_value(base["app"]["security"]["csp"].clone()).expect("la CSP si legge");
    assert!(check(&csp).is_err());
}
