//! L'invariante architetturale, resa un test.
//!
//! `fubmd-abi` è il contratto e `fubmd-kernel` è il core agnostico: nessuno dei
//! due deve sapere cosa sia il markdown, tauri, wasmtime o un motore di ricerca.
//! Finora l'invariante era vera ma **non protetta** — viveva in due commenti nei
//! `Cargo.toml`, e un `cargo add tantivy -p fubmd-kernel` sarebbe passato
//! inosservato (il PIANO la dichiarava "verificata coi test", e il test non
//! c'era).
//!
//! Due reti, con maglie diverse:
//!
//! 1. **Denylist transitiva** — nessun crate delle famiglie proibite può
//!    comparire nel grafo delle dipendenze *normali* di `fubmd-abi` e
//!    `fubmd-kernel`, nemmeno arrivandoci attraverso qualcun altro.
//! 2. **Allowlist delle dipendenze dirette** — ciò che i due `Cargo.toml`
//!    dichiarano è un elenco chiuso. Aggiungere una dipendenza diretta è una
//!    decisione architetturale, e va presa modificando anche questo file.
//!
//! Le maglie sono diverse di proposito: la seconda intercetta il gesto (`cargo
//! add`), la prima il contrabbando; e un `cargo update` che cambia il nome di
//! un crate di supporto lontano non deve rompere la build per niente.
//!
//! Si guardano solo le dipendenze **normali**: dev e build non finiscono nella
//! libreria (questo stesso test usa `serde_json` e `wit-parser` come dev-dep).
//!
//! Il test vive in `fubmd-abi` perché il workspace è virtuale e non ha un posto
//! proprio dove metterlo; interroga comunque l'intero workspace.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::process::Command;

use serde_json::Value;

/// I crate che il contratto e il core non devono vedere, per famiglia: il
/// confronto è per prefisso, così `tauri-build` o `tokio-util` non passano.
///
/// Non è un elenco di crate "brutti": è l'elenco di ciò che legherebbe il core
/// a una scelta che il progetto vuole poter cambiare — il parser markdown, il
/// toolkit dell'app, il runtime wasm, il motore di ricerca, l'I/O asincrono.
const FORBIDDEN: &[&str] = &[
    "comrak",
    "pulldown-cmark",
    "markdown",
    "tauri",
    "wry",
    "webkit2gtk",
    "wasmtime",
    "cranelift",
    "wasmer",
    "tantivy",
    "tokio",
    "async-std",
    "notify",
];

/// Le dipendenze normali che `fubmd-abi` e `fubmd-kernel` possono dichiarare.
/// Elenco chiuso: allungarlo è una decisione, non un incidente.
const ALLOWED_DIRECT: &[(&str, &[&str])] = &[
    // Il contratto: serializzazione e nient'altro.
    ("fubmd-abi", &["serde", "serde_json", "thiserror"]),
    // Il core: il contratto, serializzazione, path UTF-8.
    (
        "fubmd-kernel",
        &["fubmd-abi", "serde", "serde_json", "camino", "thiserror"],
    ),
];

// ---------------------------------------------------------------------------

fn metadata() -> Value {
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.toml");
    let out = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--format-version",
            "1",
            "--manifest-path",
            manifest,
        ])
        .output()
        .expect("impossibile eseguire `cargo metadata`");
    assert!(
        out.status.success(),
        "`cargo metadata` è fallito:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("output di `cargo metadata` non è JSON")
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("campo `{key}` assente da `cargo metadata`"))
        .as_slice()
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("campo `{key}` assente o non stringa in {v}"))
}

/// `true` se il nome appartiene a una delle famiglie proibite.
fn forbidden(name: &str) -> bool {
    FORBIDDEN.iter().any(|f| {
        name == *f || name.starts_with(&format!("{f}-")) || name.starts_with(&format!("{f}_"))
    })
}

#[test]
fn abi_and_kernel_stay_agnostic() {
    let meta = metadata();

    // id del package → nome
    let mut name_of: BTreeMap<&str, &str> = BTreeMap::new();
    for pkg in arr(&meta, "packages") {
        name_of.insert(str_of(pkg, "id"), str_of(pkg, "name"));
    }

    // grafo delle sole dipendenze NORMALI (kind assente/null; `dev` e `build`
    // non entrano nella libreria).
    let resolve = meta
        .get("resolve")
        .expect("`resolve` assente: serve il grafo");
    let mut normal_deps: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for node in arr(resolve, "nodes") {
        let id = str_of(node, "id");
        let mut deps = Vec::new();
        for dep in arr(node, "deps") {
            let is_normal = arr(dep, "dep_kinds")
                .iter()
                .any(|k| k.get("kind").map(Value::is_null).unwrap_or(true));
            if is_normal {
                deps.push(str_of(dep, "pkg"));
            }
        }
        normal_deps.insert(id, deps);
    }

    let id_of = |crate_name: &str| -> &str {
        name_of
            .iter()
            .find(|(_, n)| **n == crate_name)
            .map(|(id, _)| *id)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"))
    };

    // 1. denylist, transitiva.
    for (crate_name, _) in ALLOWED_DIRECT {
        let root = id_of(crate_name);
        let mut seen: BTreeSet<&str> = BTreeSet::from([root]);
        let mut queue = VecDeque::from([root]);
        let mut trespassers: Vec<&str> = Vec::new();

        while let Some(id) = queue.pop_front() {
            for dep in normal_deps.get(id).map(Vec::as_slice).unwrap_or_default() {
                if !seen.insert(dep) {
                    continue;
                }
                let dep_name = name_of[dep];
                if forbidden(dep_name) {
                    trespassers.push(dep_name);
                }
                queue.push_back(dep);
            }
        }

        assert!(
            trespassers.is_empty(),
            "`{crate_name}` raggiunge {trespassers:?} fra le dipendenze normali.\n\
             È il firewall anti-lock-in: markdown, UI, runtime wasm e motore di\n\
             ricerca stanno nei crate a valle, non qui. Vedi docs/PIANO.md."
        );
    }

    // 2. allowlist, sulle dipendenze dirette dichiarate.
    for (crate_name, allowed) in ALLOWED_DIRECT {
        let allowed: BTreeSet<&str> = allowed.iter().copied().collect();
        let pkg = arr(&meta, "packages")
            .iter()
            .find(|p| str_of(p, "name") == *crate_name)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"));

        let declared: BTreeSet<&str> = arr(pkg, "dependencies")
            .iter()
            .filter(|d| d.get("kind").map(Value::is_null).unwrap_or(true))
            .map(|d| str_of(d, "name"))
            .collect();

        let unexpected: Vec<&&str> = declared.difference(&allowed).collect();
        assert!(
            unexpected.is_empty(),
            "`{crate_name}` dichiara dipendenze normali non previste: {unexpected:?}.\n\
             Se è una scelta deliberata, aggiungila a ALLOWED_DIRECT in questo test\n\
             (e spiega perché nel Cargo.toml)."
        );

        let vanished: Vec<&&str> = allowed.difference(&declared).collect();
        assert!(
            vanished.is_empty(),
            "`{crate_name}` non dichiara più {vanished:?}: aggiorna ALLOWED_DIRECT\n\
             in questo test, così l'elenco resta una fotografia fedele."
        );
    }
}

/// Il test del test: la rete deve sapersi chiudere.
#[test]
fn forbidden_families_match_by_prefix() {
    assert!(forbidden("tauri"));
    assert!(forbidden("tauri-build"));
    assert!(forbidden("tokio-util"));
    assert!(forbidden("wasmtime_environ"));
    // Vicini di nome che non c'entrano nulla: nessun falso positivo.
    assert!(!forbidden("tauribbon"));
    assert!(!forbidden("serde"));
    assert!(!forbidden("camino"));
}
