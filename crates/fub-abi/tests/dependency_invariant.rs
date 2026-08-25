//! Invarianti di dipendenza del workspace.
//!
//! Il test verifica quattro proprietà:
//! 1. `fub-abi` e `fub-kernel` non raggiungono famiglie vietate;
//! 2. le loro dipendenze dirette e la chiusura transitiva di `fub-abi`
//!    coincidono con allowlist esplicite;
//! 3. SDK, feature, testkit, host e app rispettano i confini stabiliti;
//! 4. il grafo Mermaid canonico coincide con `cargo metadata`.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::process::Command;

use serde_json::Value;

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

const ALLOWED_DIRECT: &[(&str, &[&str])] = &[
    (
        "fub-abi",
        &["serde", "serde_json", "thiserror", "unicode-normalization"],
    ),
    (
        "fub-kernel",
        &[
            "fub-abi",
            "serde",
            "serde_json",
            "camino",
            "thiserror",
            "tracing",
            "windows-sys",
            "libc",
        ],
    ),
];

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
    "tinyvec",
    "tinyvec_macros",
    "unicode-ident",
    "unicode-normalization",
    "zmij",
];

fn metadata() -> Value {
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.toml");
    let output = Command::new(env!("CARGO"))
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
        output.status.success(),
        "`cargo metadata` è fallito:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("output di `cargo metadata` non valido")
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("campo `{key}` assente da `cargo metadata`"))
        .as_slice()
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("campo `{key}` assente o non stringa in {value}"))
}

fn forbidden(name: &str) -> bool {
    FORBIDDEN.iter().any(|family| {
        name == *family
            || name.starts_with(&format!("{family}-"))
            || name.starts_with(&format!("{family}_"))
    })
}

struct Graph<'a> {
    metadata: &'a Value,
    name_of: BTreeMap<&'a str, &'a str>,
    normal_dependencies: BTreeMap<&'a str, Vec<&'a str>>,
}

impl<'a> Graph<'a> {
    fn new(metadata: &'a Value) -> Self {
        let mut name_of = BTreeMap::new();
        for package in array(metadata, "packages") {
            name_of.insert(string(package, "id"), string(package, "name"));
        }

        let resolve = metadata
            .get("resolve")
            .expect("`resolve` assente da `cargo metadata`");
        let mut normal_dependencies = BTreeMap::new();

        for node in array(resolve, "nodes") {
            let id = string(node, "id");
            let mut dependencies = Vec::new();

            for dependency in array(node, "deps") {
                let is_normal = array(dependency, "dep_kinds")
                    .iter()
                    .any(|kind| kind.get("kind").map(Value::is_null).unwrap_or(true));
                if is_normal {
                    dependencies.push(string(dependency, "pkg"));
                }
            }

            normal_dependencies.insert(id, dependencies);
        }

        Self {
            metadata,
            name_of,
            normal_dependencies,
        }
    }

    fn id_of(&self, crate_name: &str) -> &'a str {
        self.name_of
            .iter()
            .find(|(_, name)| **name == crate_name)
            .map(|(id, _)| *id)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"))
    }

    fn closure(&self, crate_name: &str) -> BTreeSet<&'a str> {
        let root = self.id_of(crate_name);
        let mut seen = BTreeSet::from([root]);
        let mut queue = VecDeque::from([root]);
        let mut result = BTreeSet::new();

        while let Some(id) = queue.pop_front() {
            for dependency in self
                .normal_dependencies
                .get(id)
                .map(Vec::as_slice)
                .unwrap_or_default()
            {
                if !seen.insert(dependency) {
                    continue;
                }
                result.insert(self.name_of[dependency]);
                queue.push_back(dependency);
            }
        }

        result
    }

    fn declared(&self, crate_name: &str, kind: Option<&str>) -> BTreeSet<&'a str> {
        let package = array(self.metadata, "packages")
            .iter()
            .find(|package| string(package, "name") == crate_name)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"));

        array(package, "dependencies")
            .iter()
            .filter(|dependency| match kind {
                None => dependency
                    .get("kind")
                    .map(Value::is_null)
                    .unwrap_or(true),
                Some(expected) => dependency.get("kind").and_then(Value::as_str) == Some(expected),
            })
            .map(|dependency| string(dependency, "name"))
            .collect()
    }

    fn direct(&self, crate_name: &str) -> BTreeSet<&'a str> {
        self.declared(crate_name, None)
    }

    fn members(&self) -> BTreeSet<&'a str> {
        array(self.metadata, "workspace_members")
            .iter()
            .map(|id| {
                let id = id
                    .as_str()
                    .expect("`workspace_members` deve contenere stringhe");
                *self
                    .name_of
                    .get(id)
                    .unwrap_or_else(|| panic!("il membro `{id}` non ha un pacchetto"))
            })
            .collect()
    }
}

#[test]
fn abi_and_kernel_stay_agnostic() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    for (crate_name, allowed) in ALLOWED_DIRECT {
        let trespassers: Vec<&str> = graph
            .closure(crate_name)
            .into_iter()
            .filter(|name| forbidden(name))
            .collect();
        assert!(
            trespassers.is_empty(),
            "`{crate_name}` raggiunge famiglie vietate: {trespassers:?}"
        );

        let allowed: BTreeSet<&str> = allowed.iter().copied().collect();
        let declared = graph.direct(crate_name);

        let unexpected: Vec<&&str> = declared.difference(&allowed).collect();
        assert!(
            unexpected.is_empty(),
            "`{crate_name}` dichiara dipendenze normali non previste: {unexpected:?}"
        );

        let vanished: Vec<&&str> = allowed.difference(&declared).collect();
        assert!(
            vanished.is_empty(),
            "`{crate_name}` non dichiara più le dipendenze attese: {vanished:?}"
        );
    }
}

#[test]
fn the_contract_reaches_nothing_nobody_asked_for() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);
    let allowed: BTreeSet<&str> = ALLOWED_TRANSITIVE_ABI.iter().copied().collect();
    let reached = graph.closure("fub-abi");

    let intruders: Vec<&&str> = reached.difference(&allowed).collect();
    assert!(
        intruders.is_empty(),
        "`fub-abi` raggiunge dipendenze non approvate: {intruders:?}"
    );

    let vanished: Vec<&&str> = allowed.difference(&reached).collect();
    assert!(
        vanished.is_empty(),
        "la fotografia transitiva di `fub-abi` contiene dipendenze scomparse: {vanished:?}"
    );
}

#[test]
fn official_features_do_not_depend_on_the_kernel() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    assert!(
        !graph.direct("fub-features").contains("fub-kernel"),
        "`fub-features` non può dipendere normalmente da `fub-kernel`"
    );
    assert!(
        !graph.closure("fub-features").contains("fub-kernel"),
        "`fub-features` non può raggiungere `fub-kernel` transitivamente"
    );
}

#[test]
fn the_sdk_does_not_see_the_kernel() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    assert!(
        !graph.direct("fub-sdk").contains("fub-kernel"),
        "`fub-sdk` non può dipendere normalmente da `fub-kernel`"
    );
    assert!(
        !graph.closure("fub-sdk").contains("fub-kernel"),
        "`fub-sdk` non può raggiungere `fub-kernel` transitivamente"
    );
}

#[test]
fn the_test_bench_enters_no_library() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    let guilty: Vec<&str> = graph
        .members()
        .into_iter()
        .filter(|member| *member != "fub-testkit")
        .filter(|member| graph.direct(member).contains("fub-testkit"))
        .collect();

    assert!(
        guilty.is_empty(),
        "`fub-testkit` è una dipendenza normale di {guilty:?}; deve restare dev-only"
    );
}

#[test]
fn whoever_mounts_does_not_depend_on_whoever_draws() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    let ui: Vec<&str> = graph
        .closure("fub-host")
        .into_iter()
        .filter(|name| {
            ["tauri", "wry", "webkit2gtk"]
                .iter()
                .any(|family| name.starts_with(family))
        })
        .collect();

    assert!(
        ui.is_empty(),
        "`fub-host` raggiunge componenti della webview: {ui:?}"
    );
}

#[test]
fn the_glue_does_not_bypass_the_mounter() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    let guilty: Vec<&str> = graph
        .members()
        .into_iter()
        .filter(|member| *member != "fub-host" && *member != "fub-features")
        .filter(|member| graph.direct(member).contains("fub-host"))
        .filter(|member| graph.direct(member).contains("fub-features"))
        .collect();

    assert!(
        guilty.is_empty(),
        "{guilty:?} dipendono sia da `fub-host` sia da `fub-features`"
    );
}

const DIAGRAM_DOC: &str = "docs/architecture/components.md";
const DIAGRAM_MARKER: &str = "@grafo-dipendenze";

#[derive(Default)]
struct Diagram {
    crates: BTreeSet<String>,
    normal: BTreeSet<(String, String)>,
    dev: BTreeSet<(String, String)>,
}

fn read_diagram(source: &str) -> Diagram {
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    let mut current: Option<Vec<&str>> = None;

    for line in source.lines() {
        match (&mut current, line.trim()) {
            (None, "```mermaid") => current = Some(Vec::new()),
            (Some(_), "```") => blocks.push(current.take().expect("dentro un blocco")),
            (Some(body), _) => body.push(line),
            (None, _) => {}
        }
    }

    assert!(
        current.is_none(),
        "in {DIAGRAM_DOC} esiste un blocco Mermaid non chiuso"
    );

    let mut marked: Vec<Vec<&str>> = blocks
        .into_iter()
        .filter(|block| block.iter().any(|line| line.contains(DIAGRAM_MARKER)))
        .collect();

    assert_eq!(
        marked.len(),
        1,
        "in {DIAGRAM_DOC} deve esistere un solo blocco marcato `{DIAGRAM_MARKER}`"
    );

    let mut names: BTreeMap<&str, String> = BTreeMap::new();
    let mut result = Diagram::default();

    for line in marked.remove(0) {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("%%")
            || line.starts_with("flowchart")
            || line.starts_with("classDef")
        {
            continue;
        }

        if let Some((id, rest)) = line.split_once("[\"") {
            let (name, tail) = rest
                .split_once("\"]")
                .unwrap_or_else(|| panic!("{DIAGRAM_DOC}: dichiarazione incompleta: {line}"));
            let id = id.trim();
            assert!(
                tail.is_empty() || tail.starts_with(":::"),
                "{DIAGRAM_DOC}: coda non ammessa nella dichiarazione `{id}`: {tail}"
            );
            assert!(
                names.insert(id, name.to_string()).is_none(),
                "{DIAGRAM_DOC}: riquadro `{id}` dichiarato due volte"
            );
            result.crates.insert(name.to_string());
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        let resolve = |id: &str| -> String {
            names
                .get(id)
                .unwrap_or_else(|| {
                    panic!("{DIAGRAM_DOC}: l'arco usa `{id}` prima della dichiarazione")
                })
                .clone()
        };

        match parts.as_slice() {
            [from, "-->", to] => {
                result.normal.insert((resolve(from), resolve(to)));
            }
            [from, "-.->", to] => {
                result.dev.insert((resolve(from), resolve(to)));
            }
            _ => panic!("{DIAGRAM_DOC}: riga fuori dal dialetto verificato: {line}"),
        }
    }

    result
}

fn show_edges<'a>(edges: impl Iterator<Item = &'a (String, String)>) -> Vec<String> {
    edges.map(|(from, to)| format!("{from} -> {to}")).collect()
}

#[test]
fn the_diagram_declares_the_real_dependencies() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);
    let members = graph.members();

    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../",
        "docs/architecture/components.md"
    );
    let source = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("{DIAGRAM_DOC} non si legge: {error}"));
    let drawn = read_diagram(&source);

    let real_crates: BTreeSet<String> = members.iter().map(|name| name.to_string()).collect();

    let ghosts: Vec<&String> = drawn.crates.difference(&real_crates).collect();
    assert!(
        ghosts.is_empty(),
        "{DIAGRAM_DOC} contiene crate inesistenti: {ghosts:?}"
    );

    let missing: Vec<&String> = real_crates.difference(&drawn.crates).collect();
    assert!(
        missing.is_empty(),
        "{DIAGRAM_DOC} non contiene i crate: {missing:?}"
    );

    let mut real_normal = BTreeSet::new();
    let mut real_dev = BTreeSet::new();

    for &member in &members {
        let normal: BTreeSet<&str> = graph
            .declared(member, None)
            .intersection(&members)
            .copied()
            .collect();

        for dependency in &normal {
            real_normal.insert((member.to_string(), dependency.to_string()));
        }

        for dependency in graph.declared(member, Some("dev")).intersection(&members) {
            if !normal.contains(dependency) {
                real_dev.insert((member.to_string(), dependency.to_string()));
            }
        }
    }

    let invented = show_edges(drawn.normal.difference(&real_normal));
    assert!(
        invented.is_empty(),
        "dipendenze normali disegnate ma non dichiarate:\n  {}",
        invented.join("\n  ")
    );

    let missing = show_edges(real_normal.difference(&drawn.normal));
    assert!(
        missing.is_empty(),
        "dipendenze normali non disegnate:\n  {}",
        missing.join("\n  ")
    );

    let invented = show_edges(drawn.dev.difference(&real_dev));
    assert!(
        invented.is_empty(),
        "dipendenze dev-only disegnate ma non dichiarate:\n  {}",
        invented.join("\n  ")
    );

    let missing = show_edges(real_dev.difference(&drawn.dev));
    assert!(
        missing.is_empty(),
        "dipendenze dev-only non disegnate:\n  {}",
        missing.join("\n  ")
    );
}

#[test]
fn forbidden_families_match_by_prefix() {
    assert!(forbidden("tauri"));
    assert!(forbidden("tauri-build"));
    assert!(forbidden("tokio-util"));
    assert!(forbidden("wasmtime_environ"));
    assert!(!forbidden("tauribbon"));
    assert!(!forbidden("serde"));
    assert!(!forbidden("camino"));
}

#[test]
fn the_diagram_parser_reads_what_it_claims_to_read() {
    let source = "\
prosa\n\
```mermaid\n\
flowchart TB\n\
    Altro[\"un disegno che non c'entra\"]\n\
```\n\
altra prosa\n\
```mermaid\n\
flowchart TD\n\
    %% @grafo-dipendenze\n\
    classDef core fill:#000\n\
    a[\"fub-alfa\"]:::core\n\
    b[\"fub-beta\"]\n\
\n\
    a --> b\n\
    b -.-> a\n\
```\n";

    let diagram = read_diagram(source);
    assert_eq!(
        diagram.crates,
        BTreeSet::from(["fub-alfa".to_string(), "fub-beta".to_string()])
    );
    assert_eq!(
        diagram.normal,
        BTreeSet::from([("fub-alfa".to_string(), "fub-beta".to_string())])
    );
    assert_eq!(
        diagram.dev,
        BTreeSet::from([("fub-beta".to_string(), "fub-alfa".to_string())])
    );
}

#[test]
#[should_panic(expected = "fuori dal dialetto")]
fn the_diagram_parser_refuses_what_it_cannot_read() {
    read_diagram(
        "```mermaid\n    %% @grafo-dipendenze\n    a[\"x\"]\n    a ==>|\"parla con\"| a\n```\n",
    );
}
