//! `fub-cli ricette` e gli strumenti MCP `fub_recipe_check` e `fub_recipe_try`
//! dal di fuori: il binario vero su un vault in una cartella temporanea.
//!
//! Il ciclo di chi scrive una ricetta con un'AI: controllarla (uscita 0, o 1
//! con i codici dei problemi), provarla senza scrivere niente, e le ricette di
//! `esempi/ricette/` che passano il controllo. In fondo i casi limite: le
//! radici di lettura dell'MCP, l'app che tiene il vault, il componente spento,
//! venti passi e ventuno.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio};
use std::time::Duration;

use serde_json::{json, Value};

const GOOD: &str = "# Archivia\n\nSegna la data e sposta in Archivio.\n\n```fub-recipe\nfub-recipe: 1\nid: archivia\ntitle: Archivia\ndescription: Segna la data e sposta la nota in Archivio.\nsteps:\n  - run: note.property.set\n    args:\n      doc: \"{{doc}}\"\n      key: archiviata\n      value: \"{{date}}\"\n  - run: note.rename\n    args:\n      doc: \"{{doc}}\"\n      to: \"Archivio/{{title}}.md\"\n```\n";

/// Il passo sconosciuto sta alla riga 11 della nota.
const UNKNOWN_STEP: &str = "# Sbagliata\n\n```fub-recipe\nfub-recipe: 1\nid: sbagliata\ntitle: Sbagliata\ndescription: Un passo che non c'è.\nsteps:\n  - run: note.property.set\n    args: { doc: \"{{doc}}\", key: k, value: v }\n  - run: note.non-esiste\n```\n";

struct Vault {
    _tmp: tempfile::TempDir,
    vault: PathBuf,
    config: PathBuf,
}

fn vault() -> Vault {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    for dir in ["Recipes", "Note", "Templates", "Bozze"] {
        std::fs::create_dir_all(vault.join(dir)).unwrap();
    }
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(vault.join("Note/piano.md"), "# Piano\n\nUna riga.\n").unwrap();
    std::fs::write(
        vault.join("Templates/Riunione.md"),
        "# Riunione\n\nPresenti:\n",
    )
    .unwrap();
    std::fs::write(vault.join("Recipes/Archivia.md"), GOOD).unwrap();
    std::fs::write(vault.join("Recipes/Sbagliata.md"), UNKNOWN_STEP).unwrap();
    Vault {
        vault: vault.canonicalize().unwrap(),
        config,
        _tmp: tmp,
    }
}

fn cli(v: &Vault, standalone: bool, args: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_fub-cli"));
    command
        .env_remove("FUB_CONFIG_DIR")
        .env_remove("FUB_VAULT")
        .args([
            "--vault",
            v.vault.to_str().unwrap(),
            "--config-dir",
            v.config.to_str().unwrap(),
        ]);
    if standalone {
        command.arg("--standalone");
    }
    command.args(args).output().unwrap()
}

/// Il `data` della busta JSON, e il codice d'uscita.
fn json_of(v: &Vault, standalone: bool, args: &[&str]) -> (i32, Value) {
    let mut all = vec!["--format", "json"];
    all.extend_from_slice(args);
    let output = cli(v, standalone, &all);
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "{args:?}: stdout non è JSON; stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    });
    assert_eq!(envelope["ok"], true, "{args:?}: {envelope}");
    (output.status.code().unwrap(), envelope["data"].clone())
}

fn codes(data: &Value) -> Vec<String> {
    data["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["code"].as_str().unwrap().to_string())
        .collect()
}

/// Ogni file del vault col suo contenuto, fuori dalla cartella `.fub`: per
/// dire che una prova non ha scritto niente.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path.strip_prefix(root).unwrap().to_path_buf();
            if rel.starts_with(".fub") {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(rel, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn controlla_una_ricetta_buona_esce_con_zero() {
    let v = vault();
    let output = cli(&v, true, &["ricette", "controlla", "Recipes/Archivia.md"]);
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("«Archivia» (archivia): nessun problema, 2 passi"),
        "{text}"
    );
    assert!(text.contains("recipe.archivia:run"), "{text}");

    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Archivia.md"]);
    assert_eq!(code, 0);
    assert_eq!(data["valid"], true);
    assert_eq!(data["id"], "archivia");
    assert_eq!(data["command"], "recipe.archivia:run");
    assert_eq!(data["in_folder"], true);
    assert_eq!(data["component"], true);
    assert_eq!(data["problems"], json!([]));
    assert_eq!(data["notes"], json!([]));
}

#[test]
fn controlla_un_passo_sconosciuto_esce_con_uno_e_il_codice() {
    let v = vault();
    let output = cli(&v, true, &["ricette", "controlla", "Recipes/Sbagliata.md"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("riga 11 · steps[1].run · comando-sconosciuto:"),
        "{text}"
    );
    assert!(text.contains("note.non-esiste"), "{text}");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("la ricetta ha un problema"), "{stderr}");

    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Sbagliata.md"]);
    assert_eq!(code, 1);
    assert_eq!(data["valid"], false);
    assert_eq!(codes(&data), ["comando-sconosciuto"]);
    let problem = &data["problems"][0];
    assert_eq!(problem["field"], "steps[1].run");
    assert_eq!(problem["line"], 11);
    // La frase è detta, non la chiave del catalogo.
    let message = problem["message"].as_str().unwrap();
    assert!(!message.starts_with("recipes.problem."), "{message}");
}

#[test]
fn una_nota_senza_blocco_e_un_problema() {
    let v = vault();
    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Note/piano.md"]);
    assert_eq!(code, 1);
    assert_eq!(codes(&data), ["blocco-assente"]);
    assert_eq!(data["id"], Value::Null);
    // Fuori dalla cartella delle ricette: lo dice una nota.
    assert_eq!(data["in_folder"], false);
    assert!(data["notes"][0].as_str().unwrap().contains("Recipes"));
}

#[test]
fn le_ricette_di_esempio_passano_il_controllo() {
    let v = vault();
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../esempi/ricette");
    let mut names: Vec<String> = std::fs::read_dir(&examples)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".md"))
        .collect();
    names.sort();
    assert_eq!(
        names,
        ["Archivia.md", "Riunione di oggi.md", "Segna come letta.md"]
    );
    for name in &names {
        std::fs::copy(
            examples.join(name),
            v.vault.join("Recipes").join(format!("Esempio {name}")),
        )
        .unwrap();
    }
    let before = snapshot(&v.vault);
    for name in &names {
        let doc = format!("Recipes/Esempio {name}");
        let (code, data) = json_of(&v, true, &["ricette", "controlla", &doc]);
        assert_eq!(code, 0, "{name}: {data}");
        assert_eq!(data["notes"], json!([]), "{name}");
        // E si provano senza scrivere: su una nota se la ricetta ne usa una.
        let mut call = vec!["ricette", "prova", doc.as_str()];
        if std::fs::read_to_string(examples.join(name))
            .unwrap()
            .contains("{{doc}}")
        {
            call.extend(["--doc", "Note/piano.md"]);
        }
        let (code, plan) = json_of(&v, true, &call);
        assert_eq!(code, 0, "{name}: {plan}");
        assert_eq!(plan["dry_run"], true);
        assert!(
            !plan["docs"].as_array().unwrap().is_empty(),
            "{name}: {plan}"
        );
    }
    assert_eq!(snapshot(&v.vault), before);
}

#[test]
fn prova_mostra_il_piano_e_non_scrive() {
    let v = vault();
    let before = snapshot(&v.vault);
    let (code, plan) = json_of(
        &v,
        true,
        &[
            "ricette",
            "prova",
            "Recipes/Archivia.md",
            "--doc",
            "Note/piano.md",
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(plan["id"], "archivia");
    assert_eq!(plan["args"], json!({ "doc": "Note/piano.md" }));
    assert_eq!(plan["docs"], json!(["Note/piano.md", "Archivio/piano.md"]));
    assert_eq!(plan["approximate"], true);
    let summary = plan["summary"].as_str().unwrap();
    assert!(summary.contains("archiviata"), "{summary}");
    assert!(!summary.contains("recipes.plan"), "{summary}");
    assert_eq!(snapshot(&v.vault), before);

    // In testo: il riassunto, le note toccate, che è approssimata.
    let text = String::from_utf8(
        cli(
            &v,
            true,
            &[
                "ricette",
                "prova",
                "Recipes/Archivia.md",
                "--doc",
                "Note/piano.md",
            ],
        )
        .stdout,
    )
    .unwrap();
    assert!(text.starts_with("Prova, senza scrivere niente."), "{text}");
    assert!(
        text.contains("Note toccate: Note/piano.md, Archivio/piano.md"),
        "{text}"
    );
    assert!(text.contains("approssimata"), "{text}");
}

#[test]
fn prova_rifiuta_una_ricetta_con_problemi_e_gli_argomenti_che_mancano() {
    let v = vault();
    let (code, data) = json_of(
        &v,
        true,
        &[
            "ricette",
            "prova",
            "Recipes/Sbagliata.md",
            "--doc",
            "Note/piano.md",
        ],
    );
    assert_eq!(code, 1);
    assert_eq!(codes(&data), ["comando-sconosciuto"]);

    // Senza --doc la ricetta che usa {{doc}} non si prova: come l'esecuzione.
    let output = cli(&v, true, &["ricette", "prova", "Recipes/Archivia.md"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("`doc`"));

    // La nota data due volte.
    let output = cli(
        &v,
        true,
        &[
            "ricette",
            "prova",
            "Recipes/Archivia.md",
            "--doc",
            "Note/piano.md",
            "--args",
            r#"{"doc":"Note/altro.md"}"#,
        ],
    );
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn venti_passi_si_e_ventuno_no() {
    let v = vault();
    let block = |n: usize| {
        let steps: String = (0..n)
            .map(|i| format!("  - run: note.property.set\n    args: {{ doc: \"{{{{doc}}}}\", key: k{i}, value: v }}\n"))
            .collect();
        format!("```fub-recipe\nfub-recipe: 1\nid: lunga-{n}\ntitle: Lunga\ndescription: Tanti passi.\nsteps:\n{steps}```\n")
    };
    std::fs::write(v.vault.join("Recipes/Venti.md"), block(20)).unwrap();
    std::fs::write(v.vault.join("Recipes/Ventuno.md"), block(21)).unwrap();
    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Venti.md"]);
    assert_eq!(code, 0, "{data}");
    assert_eq!(data["steps"], 20);
    let (code, plan) = json_of(
        &v,
        true,
        &[
            "ricette",
            "prova",
            "Recipes/Venti.md",
            "--doc",
            "Note/piano.md",
        ],
    );
    assert_eq!(code, 0, "{plan}");
    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Ventuno.md"]);
    assert_eq!(code, 1);
    assert_eq!(codes(&data), ["valore-non-valido"]);
}

#[test]
fn con_il_componente_spento_il_controllo_lo_dice() {
    let v = vault();
    let off = cli(
        &v,
        true,
        &["--yes", "componenti", "spegni", "fub.recipes", "--tieni"],
    );
    assert!(off.status.success(), "{off:?}");
    let (code, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Archivia.md"]);
    // Il blocco è giusto: il controllo passa, e una nota dice che non comparirà.
    assert_eq!(code, 0, "{data}");
    assert_eq!(data["component"], false);
    assert!(
        data["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n.as_str().unwrap().contains("componente Ricette è spento")),
        "{data}"
    );
}

#[test]
fn la_cartella_delle_ricette_e_quella_dell_impostazione() {
    let v = vault();
    std::fs::create_dir_all(v.vault.join("Automazioni")).unwrap();
    std::fs::write(v.vault.join("Automazioni/Archivia.md"), GOOD).unwrap();
    let set = cli(
        &v,
        true,
        &["--yes", "config", "--set", "recipes.folder=Automazioni"],
    );
    assert!(set.status.success(), "{set:?}");
    let (_, data) = json_of(
        &v,
        true,
        &["ricette", "controlla", "Automazioni/Archivia.md"],
    );
    assert_eq!(data["folder"], "Automazioni");
    assert_eq!(data["in_folder"], true);
    let (_, data) = json_of(&v, true, &["ricette", "controlla", "Recipes/Archivia.md"]);
    assert_eq!(data["in_folder"], false);
}

#[test]
fn con_l_app_aperta_controlla_e_prova_passano_da_lei() {
    let v = vault();
    let config = camino::Utf8Path::from_path(&v.config).unwrap();
    let host = std::sync::Arc::new(fub_host::Host::without_watcher().with_config_dir(config));
    host.open(camino::Utf8Path::from_path(&v.vault).unwrap())
        .unwrap();
    while !host
        .wait_indexed_for(None, Duration::from_millis(100))
        .unwrap()
    {}
    let served = std::sync::Arc::clone(&host);
    let _control = fub_host::control::ControlServer::start(config, move |call| {
        fub_host::control::answer(&served, call)
    })
    .unwrap();
    // L'app tiene il vault: senza --standalone la CLI passa dal canale.
    let (code, data) = json_of(&v, false, &["ricette", "controlla", "Recipes/Archivia.md"]);
    assert_eq!(code, 0, "{data}");
    let (code, data) = json_of(&v, false, &["ricette", "controlla", "Recipes/Sbagliata.md"]);
    assert_eq!(code, 1);
    assert_eq!(codes(&data), ["comando-sconosciuto"]);
    let before = snapshot(&v.vault);
    let (code, plan) = json_of(
        &v,
        false,
        &[
            "ricette",
            "prova",
            "Recipes/Archivia.md",
            "--doc",
            "Note/piano.md",
        ],
    );
    assert_eq!(code, 0, "{plan}");
    assert_eq!(plan["docs"], json!(["Note/piano.md", "Archivio/piano.md"]));
    assert_eq!(snapshot(&v.vault), before);
    let id = fub_host::doc_id("Note/piano.md").unwrap();
    assert_eq!(
        host.read_document(None, &id).unwrap().0,
        "# Piano\n\nUna riga.\n"
    );
}

// --- MCP ---

struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next: u64,
}

impl Server {
    fn start(v: &Vault, roots: &[(&str, &Path)]) -> Server {
        let mut command = Command::new(env!("CARGO_BIN_EXE_fub-cli"));
        command
            .env_remove("FUB_CONFIG_DIR")
            .env_remove("FUB_VAULT")
            .args([
                "--vault",
                v.vault.to_str().unwrap(),
                "--config-dir",
                v.config.to_str().unwrap(),
                "mcp",
            ]);
        for (flag, path) in roots {
            command.args([*flag, path.to_str().unwrap()]);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("avvia fub-cli mcp");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut server = Server {
            child,
            stdin,
            stdout,
            next: 1,
        };
        let init = server.request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {} }),
        );
        let instructions = init["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("fub_recipe_check"), "{instructions}");
        assert!(
            instructions.contains("la accende soltanto lei"),
            "{instructions}"
        );
        writeln!(
            server.stdin,
            r#"{{"jsonrpc":"2.0","method":"notifications/initialized"}}"#
        )
        .unwrap();
        server
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        writeln!(
            self.stdin,
            "{}",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        )
        .unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["id"], id);
        reply
    }

    fn call(&mut self, name: &str, arguments: Value) -> Value {
        self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        )["result"]
            .clone()
    }

    fn ok(&mut self, name: &str, arguments: Value) -> Value {
        let result = self.call(name, arguments);
        assert_ne!(result["isError"], true, "{name}: {result}");
        result["structuredContent"].clone()
    }

    fn refused(&mut self, name: &str, arguments: Value) -> (String, Value) {
        let result = self.call(name, arguments);
        assert_eq!(result["isError"], true, "{name} doveva fallire: {result}");
        (
            result["content"][0]["text"].as_str().unwrap().to_string(),
            result["structuredContent"].clone(),
        )
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn mcp_controlla_e_prova_senza_scritture() {
    let v = vault();
    let before = snapshot(&v.vault);
    let mut server = Server::start(&v, &[]);
    let tools = server.request("tools/list", json!({}));
    let tool = |name: &str| {
        tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == name)
            .unwrap_or_else(|| panic!("{name} non è fra gli strumenti"))
            .clone()
    };
    assert_eq!(
        tool("fub_recipe_check")["annotations"]["readOnlyHint"],
        true
    );
    assert_eq!(tool("fub_recipe_try")["annotations"]["readOnlyHint"], true);

    let good = server.ok(
        "fub_recipe_check",
        json!({ "recipe": "Recipes/Archivia.md" }),
    );
    assert_eq!(good["valid"], true);
    // Una ricetta con problemi è un controllo riuscito che li dice.
    let bad = server.ok(
        "fub_recipe_check",
        json!({ "recipe": "Recipes/Sbagliata.md" }),
    );
    assert_eq!(bad["valid"], false);
    assert_eq!(codes(&bad), ["comando-sconosciuto"]);

    let plan = server.ok(
        "fub_recipe_try",
        json!({ "recipe": "Recipes/Archivia.md", "doc": "Note/piano.md" }),
    );
    assert_eq!(plan["dry_run"], true);
    assert_eq!(plan["docs"], json!(["Note/piano.md", "Archivio/piano.md"]));
    let (text, data) = server.refused(
        "fub_recipe_try",
        json!({ "recipe": "Recipes/Sbagliata.md", "doc": "Note/piano.md" }),
    );
    assert!(
        text.starts_with("La ricetta ha un problema: riga 11 · steps[1].run · comando-sconosciuto"),
        "{text}"
    );
    assert_eq!(codes(&data), ["comando-sconosciuto"]);
    // Gli argomenti che il comando della ricetta rifiuta.
    let (text, _) = server.refused("fub_recipe_try", json!({ "recipe": "Recipes/Archivia.md" }));
    assert!(text.starts_with("bad_args:"), "{text}");
    drop(server);
    assert_eq!(snapshot(&v.vault), before);
}

#[test]
fn mcp_le_radici_di_lettura_valgono_per_le_ricette() {
    let v = vault();
    let note = v.vault.join("Note");
    let mut server = Server::start(&v, &[("--automation-read-root", &note)]);
    // La ricetta fuori dalle radici: l'errore dell'accesso, come gli altri.
    let (text, _) = server.refused(
        "fub_recipe_check",
        json!({ "recipe": "Recipes/Archivia.md" }),
    );
    assert!(text.starts_with("denied:"), "{text}");
    let (text, _) = server.refused(
        "fub_recipe_try",
        json!({ "recipe": "Recipes/Archivia.md", "doc": "Note/piano.md" }),
    );
    assert!(text.starts_with("denied:"), "{text}");
    drop(server);

    // La ricetta dentro, ma la prova lancia comandi: vuole tutto il vault.
    let recipes = v.vault.join("Recipes");
    let mut server = Server::start(
        &v,
        &[
            ("--automation-read-root", &recipes),
            ("--automation-read-root", &note),
        ],
    );
    let checked = server.ok(
        "fub_recipe_check",
        json!({ "recipe": "Recipes/Archivia.md" }),
    );
    assert_eq!(checked["valid"], true);
    let (text, _) = server.refused(
        "fub_recipe_try",
        json!({ "recipe": "Recipes/Archivia.md", "doc": "Note/piano.md" }),
    );
    assert!(text.contains("tutto il vault"), "{text}");
}
