//! Le invarianti di dipendenza, rese test.
//!
//! `fubmd-abi` è il contratto e `fubmd-kernel` è il core agnostico: nessuno dei
//! due deve sapere cosa sia il markdown, tauri, wasmtime o un motore di ricerca.
//! E `fubmd-features` è il banco di prova del dogfooding: se la libreria delle
//! feature ufficiali dipendesse dal kernel, "sono scritte come le scriverebbe un
//! plugin" sarebbe un'affermazione e non una proprietà.
//!
//! Tre reti, con maglie diverse:
//!
//! 1. **Denylist transitiva** — nessun crate delle famiglie proibite può
//!    comparire nel grafo delle dipendenze *normali* di `fubmd-abi` e
//!    `fubmd-kernel`, nemmeno arrivandoci attraverso qualcun altro.
//! 2. **Allowlist delle dipendenze dirette** — ciò che i due `Cargo.toml`
//!    dichiarano è un elenco chiuso. Aggiungere una dipendenza diretta è una
//!    decisione architetturale, e va presa modificando anche questo file.
//! 3. **Allowlist transitiva per `fubmd-abi`** — il contratto ha tre dipendenze,
//!    quindi la sua chiusura si può *elencare per intero*. Una denylist per
//!    prefisso non vedrebbe un parser markdown con un nome nuovo; un elenco
//!    chiuso vede tutto ciò che compare, chiamato come vuole.
//!
//! Le maglie sono diverse di proposito: la seconda intercetta il gesto (`cargo
//! add`), la prima il contrabbando, la terza l'ignoto. Sul kernel — che ha una
//! chiusura più larga, con `camino` di mezzo — resta la denylist: un `cargo
//! update` che rinomina un crate di supporto lontano non deve rompere la build
//! per niente.
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

/// **Tutto** ciò che `fubmd-abi` raggiunge fra le dipendenze normali, sé stesso
/// escluso: serde, serde_json, thiserror e la loro coda di macro e utilità.
///
/// È una fotografia, e il test pretende che sia fedele nelle due direzioni: un
/// nome nuovo è rosso (guardalo: è arrivato qualcosa che nessuno ha chiesto), un
/// nome sparito è rosso (aggiorna l'elenco, così resta una fotografia e non un
/// ricordo). Un `cargo update` che aggiunge un crate di supporto è un cambio
/// piccolo da approvare a mano — che è esattamente il punto: il contratto è il
/// posto dove non vogliamo che entri nulla di soppiatto.
const ALLOWED_TRANSITIVE_ABI: &[&str] = &[
    "equivalent",
    "foldhash",
    "hashbrown",
    "indexmap",
    "itoa",
    "memchr",
    "proc-macro2",
    "quote",
    "serde",
    "serde_core",
    "serde_derive",
    "serde_json",
    "syn",
    "thiserror",
    "thiserror-impl",
    "unicode-ident",
    "zmij",
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

/// Il grafo delle sole dipendenze **normali** del workspace.
struct Graph<'a> {
    meta: &'a Value,
    name_of: BTreeMap<&'a str, &'a str>,
    deps: BTreeMap<&'a str, Vec<&'a str>>,
}

impl<'a> Graph<'a> {
    fn new(meta: &'a Value) -> Self {
        let mut name_of = BTreeMap::new();
        for pkg in arr(meta, "packages") {
            name_of.insert(str_of(pkg, "id"), str_of(pkg, "name"));
        }

        // kind assente/null = dipendenza normale; `dev` e `build` non entrano
        // nella libreria.
        let resolve = meta
            .get("resolve")
            .expect("`resolve` assente: serve il grafo");
        let mut deps: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for node in arr(resolve, "nodes") {
            let id = str_of(node, "id");
            let mut normal = Vec::new();
            for dep in arr(node, "deps") {
                let is_normal = arr(dep, "dep_kinds")
                    .iter()
                    .any(|k| k.get("kind").map(Value::is_null).unwrap_or(true));
                if is_normal {
                    normal.push(str_of(dep, "pkg"));
                }
            }
            deps.insert(id, normal);
        }

        Graph {
            meta,
            name_of,
            deps,
        }
    }

    fn id_of(&self, crate_name: &str) -> &'a str {
        self.name_of
            .iter()
            .find(|(_, n)| **n == crate_name)
            .map(|(id, _)| *id)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"))
    }

    /// Tutti i crate raggiungibili fra le dipendenze normali, per nome, radice
    /// esclusa.
    fn closure(&self, crate_name: &str) -> BTreeSet<&'a str> {
        let root = self.id_of(crate_name);
        let mut seen: BTreeSet<&str> = BTreeSet::from([root]);
        let mut queue = VecDeque::from([root]);
        let mut out = BTreeSet::new();
        while let Some(id) = queue.pop_front() {
            for dep in self.deps.get(id).map(Vec::as_slice).unwrap_or_default() {
                if !seen.insert(dep) {
                    continue;
                }
                out.insert(self.name_of[dep]);
                queue.push_back(dep);
            }
        }
        out
    }

    /// Le dipendenze normali **dichiarate** nel `Cargo.toml` di un crate.
    fn direct(&self, crate_name: &str) -> BTreeSet<&'a str> {
        let pkg = arr(self.meta, "packages")
            .iter()
            .find(|p| str_of(p, "name") == crate_name)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"));
        arr(pkg, "dependencies")
            .iter()
            .filter(|d| d.get("kind").map(Value::is_null).unwrap_or(true))
            .map(|d| str_of(d, "name"))
            .collect()
    }
}

#[test]
fn abi_and_kernel_stay_agnostic() {
    let meta = metadata();
    let graph = Graph::new(&meta);

    // 1. denylist, transitiva.
    for (crate_name, _) in ALLOWED_DIRECT {
        let trespassers: Vec<&str> = graph
            .closure(crate_name)
            .into_iter()
            .filter(|n| forbidden(n))
            .collect();
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
        let declared = graph.direct(crate_name);

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

/// La maglia più fine, e solo dove è sostenibile: sul contratto si elenca
/// **tutto** ciò che entra, non solo ciò che è vietato.
#[test]
fn the_contract_reaches_nothing_nobody_asked_for() {
    let meta = metadata();
    let graph = Graph::new(&meta);
    let allowed: BTreeSet<&str> = ALLOWED_TRANSITIVE_ABI.iter().copied().collect();
    let reached = graph.closure("fubmd-abi");

    let intruders: Vec<&&str> = reached.difference(&allowed).collect();
    assert!(
        intruders.is_empty(),
        "`fubmd-abi` raggiunge {intruders:?}, che non sono nell'allowlist transitiva.\n\
         Se è un crate di supporto arrivato con un `cargo update`, guardalo e\n\
         aggiungilo a ALLOWED_TRANSITIVE_ABI. Se non sai cos'è, è esattamente il\n\
         caso per cui questo elenco esiste."
    );

    let vanished: Vec<&&str> = allowed.difference(&reached).collect();
    assert!(
        vanished.is_empty(),
        "`fubmd-abi` non raggiunge più {vanished:?}: toglilo da ALLOWED_TRANSITIVE_ABI,\n\
         così l'elenco resta una fotografia e non un ricordo."
    );
}

/// Il confine feature↔kernel, che finora era **affermato** e non verificato.
///
/// Le feature ufficiali sono il dogfooding del contratto: implementano gli stessi
/// trait che implementerà un plugin di terzi, e un plugin di terzi non ha
/// `fubmd-kernel` fra le mani. Se la libreria ne avesse bisogno, la prossima
/// feature prenderebbe la scorciatoia senza che nessuno se ne accorga — e il
/// giorno del proxy WASM la scorciatoia sarebbe un muro.
///
/// I test end-to-end invece il kernel lo usano, e devono: è la loro ragione
/// d'essere. Per questo `fubmd-kernel` sta nei `[dev-dependencies]`, che qui non
/// si guardano.
#[test]
fn official_features_do_not_depend_on_the_kernel() {
    let meta = metadata();
    let graph = Graph::new(&meta);

    assert!(
        !graph.direct("fubmd-features").contains("fubmd-kernel"),
        "`fubmd-features` dichiara `fubmd-kernel` fra le dipendenze normali: \n\
         va nei [dev-dependencies], perché la libreria non lo usa (e non deve)."
    );
    assert!(
        !graph.closure("fubmd-features").contains("fubmd-kernel"),
        "`fubmd-features` raggiunge `fubmd-kernel` fra le dipendenze normali: \n\
         una feature ufficiale deve poter girare con ciò che avrà un plugin di terzi."
    );
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
