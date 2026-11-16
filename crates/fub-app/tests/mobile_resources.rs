//! Ogni risorsa Android che i template di `mobile/` nominano esiste dopo la
//! fusione di `install-mobile.sh`.
//!
//! AAPT li legge soltanto nel workflow mobile: un `@string/…` senza la sua
//! stringa restava verde qui e rompeva l'APK là. Questa prova li legge sul
//! desktop, con le destinazioni che lo script dà a ogni template.

use std::collections::BTreeSet;
use std::path::Path;

/// Le risorse che crea il progetto generato da Tauri, non i nostri template.
const FROM_TAURI: &[&str] = &["mipmap/ic_launcher"];

fn mobile() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/mobile"))
}

fn read(name: &str) -> String {
    std::fs::read_to_string(mobile().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// Le coppie `('sorgente', 'res/tipo/nome.xml')` dello script.
fn destinations() -> Vec<(String, String)> {
    let script = read("install-mobile.sh");
    script
        .lines()
        .filter_map(|line| {
            let line = line.trim().strip_prefix("('")?;
            let (src, rest) = line.split_once("', '")?;
            let dst = rest.split_once("')")?.0;
            dst.starts_with("res/")
                .then(|| (src.to_string(), dst["res/".len()..].to_string()))
        })
        .collect()
}

/// I nomi dopo ogni `prefix` che non chiude un identificatore, fino al primo
/// carattere fuori da un nome di risorsa.
fn names_after<'a>(text: &'a str, prefix: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    text.match_indices(prefix)
        .filter(move |(at, _)| {
            !text[..*at].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
        })
        .map(move |(at, _)| {
            let rest = &text[at + prefix.len()..];
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '/' | '.')))
                .unwrap_or(rest.len());
            &rest[..end]
        })
}

/// **Il guscio Android passa a Rust la cartella privata con il nome che Rust
/// legge** (issue #409). Kotlin e Rust non si vedono a compilazione: un nome
/// cambiato da una parte sola compilava, e sul telefono Fub tornava senza
/// cartella di configurazione. Il manifest deve dichiarare la classe e lo
/// script deve copiarla, o `Application.onCreate` non gira mai.
#[test]
fn android_shell_exports_the_private_folder_rust_reads() {
    let application = read("FubApplication.kt");
    let exported = format!(
        "Os.setenv(\"{}\", filesDir.absolutePath",
        fub_host::config::ANDROID_FILES_DIR_VAR
    );
    assert!(
        application.contains(&exported),
        "FubApplication.kt non esporta {}",
        fub_host::config::ANDROID_FILES_DIR_VAR
    );
    assert!(
        read("AndroidManifest.snippet.xml")
            .contains("<application android:name=\".FubApplication\">"),
        "lo snippet del manifest non dichiara FubApplication"
    );
    assert!(
        read("install-mobile.sh")
            .contains("('FubApplication.kt', 'java/dev/fub/app/FubApplication.kt')"),
        "lo script non copia FubApplication.kt"
    );
}

#[test]
fn every_resource_a_template_names_exists() {
    let destinations = destinations();
    assert!(
        destinations
            .iter()
            .any(|(_, dst)| dst.starts_with("values/")),
        "lo script non copia più le stringhe: {destinations:?}"
    );
    let mut defined: BTreeSet<String> = FROM_TAURI.iter().map(|s| s.to_string()).collect();
    let mut wanted = BTreeSet::new();
    for (src, dst) in &destinations {
        let text = read(src);
        let (kind, file) = dst.split_once('/').expect("res/<tipo>/<file>");
        if kind == "values" {
            defined.extend(names_after(&text, "<string name=\"").map(|n| format!("string/{n}")));
        } else {
            defined.insert(format!("{kind}/{}", file.trim_end_matches(".xml")));
        }
        defined.extend(names_after(&text, "@+id/").map(|n| format!("id/{n}")));
        // `@+id/…` definisce invece di nominare: il `+` lo lascia vuoto.
        wanted.extend(
            names_after(&text, "\"@")
                .filter(|n| !n.is_empty())
                .map(|n| (n.to_string(), src.clone())),
        );
    }
    for entry in std::fs::read_dir(mobile()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "kt") {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).unwrap();
            wanted.extend(names_after(&text, "R.").map(|n| (n.replace('.', "/"), name.clone())));
        }
    }
    let missing: Vec<_> = wanted
        .iter()
        .filter(|(name, _)| !defined.contains(name))
        .collect();
    assert!(
        missing.is_empty(),
        "risorse nominate e mai definite: {missing:?}"
    );
}
