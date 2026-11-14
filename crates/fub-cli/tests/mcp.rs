//! Il server MCP di `fub-cli` (N2) dal di fuori: il binario vero su stdio,
//! un vault di prova in una cartella temporanea, e il test nella parte del
//! client. Inizializzazione, elenco, ogni strumento, gli errori, le radici e
//! i conflitti; in fondo il giro di un agente.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};

struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next: u64,
}

impl Server {
    fn start(vault: &Path, config: &Path, roots: &[(&str, &Path)]) -> Server {
        Server::start_with(vault, config, roots, &[])
    }

    /// Come [`Server::start`], con queste variabili d'ambiente in più.
    fn start_with(
        vault: &Path,
        config: &Path,
        roots: &[(&str, &Path)],
        envs: &[(&str, &Path)],
    ) -> Server {
        let mut command = Command::new(env!("CARGO_BIN_EXE_fub-cli"));
        command.envs(envs.iter().copied());
        command
            .env_remove("FUB_CONFIG_DIR")
            .env_remove("FUB_VAULT")
            .args([
                "--vault",
                vault.to_str().unwrap(),
                "--config-dir",
                config.to_str().unwrap(),
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
        Server {
            child,
            stdin,
            stdout,
            next: 1,
        }
    }

    fn line(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "il server ha chiuso stdout");
        serde_json::from_str(&line).unwrap()
    }

    fn send(&mut self, raw: &str) {
        writeln!(self.stdin, "{raw}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        self.send(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string(),
        );
        let reply = self.line();
        assert_eq!(reply["jsonrpc"], "2.0");
        assert_eq!(reply["id"], id);
        reply
    }

    fn initialized(mut self) -> Server {
        let reply = self.request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "prova", "version": "0" } }),
        );
        assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
        self.send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        self
    }

    /// Uno strumento che riesce: il suo `structuredContent`.
    fn ok(&mut self, name: &str, arguments: Value) -> Value {
        let reply = self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        let result = &reply["result"];
        assert_ne!(
            result["isError"], true,
            "{name}: {}",
            result["content"][0]["text"]
        );
        let data = result["structuredContent"].clone();
        assert_eq!(
            result["content"][0]["text"]
                .as_str()
                .map(|t| serde_json::from_str::<Value>(t).unwrap()),
            Some(data.clone())
        );
        data
    }

    /// Uno strumento che non riesce: il testo dell'errore.
    fn refused(&mut self, name: &str, arguments: Value) -> String {
        let reply = self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        assert_eq!(
            reply["result"]["isError"], true,
            "{name} doveva fallire: {reply}"
        );
        reply["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Fixture {
    _tmp: tempfile::TempDir,
    vault: PathBuf,
    config: PathBuf,
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir_all(vault.join("Note")).unwrap();
    std::fs::create_dir_all(vault.join("Agente")).unwrap();
    std::fs::create_dir_all(vault.join("Diario")).unwrap();
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(
        vault.join("Note/mercato.md"),
        "# Mercato\n\nIl mercato cresce. #analisi\n\nVedi [[prezzi]].\n",
    )
    .unwrap();
    std::fs::write(
        vault.join("Note/prezzi.md"),
        "# Prezzi\n\nI prezzi scendono. #analisi\n",
    )
    .unwrap();
    std::fs::write(
        vault.join("Note/ricetta.md"),
        "# Ricetta\n\nFarina e acqua. #cucina\n",
    )
    .unwrap();
    std::fs::write(
        vault.join("Diario/oggi.md"),
        "# Oggi\n\nUn segreto del diario, sul mercato.\n",
    )
    .unwrap();
    std::fs::write(vault.join("Agente/bozza.md"), "# Bozza\n").unwrap();
    Fixture {
        vault: vault.canonicalize().unwrap(),
        config,
        _tmp: tmp,
    }
}

fn writer(f: &Fixture) -> Server {
    let agent = f.vault.join("Agente");
    Server::start(
        &f.vault,
        &f.config,
        &[
            ("--automation-read-root", &f.vault),
            ("--automation-write-root", &agent),
        ],
    )
    .initialized()
}

/// Un agente che scrive in tutto il vault.
fn vault_writer(f: &Fixture) -> Server {
    Server::start(
        &f.vault,
        &f.config,
        &[("--automation-write-root", &f.vault)],
    )
    .initialized()
}

fn docs(page: &Value) -> Vec<String> {
    let mut docs: Vec<String> = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            item["doc"]
                .as_str()
                .or(item["source"].as_str())
                .unwrap()
                .to_string()
        })
        .collect();
    docs.sort();
    docs
}

#[test]
fn inizializzazione_elenco_e_errori_del_protocollo() {
    let f = fixture();
    let mut server = Server::start(&f.vault, &f.config, &[]);
    let init = server.request(
        "initialize",
        json!({ "protocolVersion": "2025-06-18", "capabilities": {} }),
    );
    let result = &init["result"];
    assert_eq!(result["serverInfo"]["name"], "fub");
    assert!(result["capabilities"]["tools"].is_object());
    assert!(result["capabilities"]["resources"].is_object());
    assert!(result["instructions"]
        .as_str()
        .unwrap()
        .contains("fub_write"));
    // Una notifica non ha risposta: la riga dopo è quella del ping.
    server.send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    assert_eq!(server.request("ping", json!({}))["result"], json!({}));

    let tools = server.request("tools/list", json!({}));
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "fub_search",
            "fub_query",
            "fub_read",
            "fub_read_model",
            "fub_preview",
            "fub_write",
            "fub_create",
            "fub_canvas_guide",
            "fub_canvas_read",
            "fub_canvas_create",
            "fub_canvas_apply",
            "fub_commands",
            "fub_invoke",
            "fub_external_editors",
            "fub_open_with",
            "fub_components",
            "fub_components_why",
            "fub_components_enable",
            "fub_components_disable"
        ]
    );
    for tool in tools["result"]["tools"].as_array().unwrap() {
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
        assert!(!tool["description"].as_str().unwrap().is_empty());
    }

    // Gli errori del protocollo.
    server.send("non è json");
    let parse = server.line();
    assert_eq!(parse["error"]["code"], -32700);
    assert_eq!(parse["id"], Value::Null);
    server.send("[1, 2]");
    assert_eq!(server.line()["error"]["code"], -32600);
    assert_eq!(
        server.request("cose/strane", json!({}))["error"]["code"],
        -32601
    );
    assert_eq!(
        server.request("tools/call", json!({ "name": "fub_vola" }))["error"]["code"],
        -32602
    );
    assert_eq!(
        server.request(
            "tools/call",
            json!({ "name": "fub_read", "arguments": [1] })
        )["error"]["code"],
        -32602
    );
    // Gli errori di uno strumento tornano nel risultato.
    assert!(server
        .refused("fub_read", json!({}))
        .starts_with("bad_args: manca `doc`"));
    assert!(server
        .refused("fub_read", json!({ "doc": "Note/manca.md" }))
        .starts_with("not_found"));
    assert!(server
        .refused("fub_read", json!({ "doc": "../fuori.md" }))
        .starts_with("bad_args"));
    assert!(server
        .refused("fub_search", json!({ "query": "x", "limit": 0 }))
        .contains("`limit`"));
    assert!(server
        .refused("fub_query", json!({ "tag": "a", "backlinks": "b" }))
        .contains("una sola chiave"));
}

#[test]
fn ogni_strumento_che_legge() {
    let f = fixture();
    let mut server = writer(&f);

    let found = server.ok("fub_search", json!({ "query": "mercato" }));
    assert_eq!(docs(&found), ["Diario/oggi.md", "Note/mercato.md"]);
    let tagged = server.ok(
        "fub_search",
        json!({ "query": "", "tag": "analisi", "limit": 1 }),
    );
    assert_eq!(tagged["total"], 2);
    assert_eq!(tagged["items"].as_array().unwrap().len(), 1);
    let folder = server.ok(
        "fub_search",
        json!({ "query": "mercato", "folder": "Note" }),
    );
    assert_eq!(docs(&folder), ["Note/mercato.md"]);

    assert_eq!(
        docs(&server.ok("fub_query", json!({ "tag": "#analisi" }))),
        ["Note/mercato.md", "Note/prezzi.md"]
    );
    assert_eq!(
        docs(&server.ok("fub_query", json!({ "backlinks": "Note/prezzi.md" }))),
        ["Note/mercato.md"]
    );
    assert_eq!(
        docs(&server.ok("fub_query", json!({ "neighbors": "Note/prezzi.md" }))),
        ["Note/mercato.md"]
    );
    assert_eq!(
        server.ok("fub_query", json!({ "resolve": "[[prezzi]]" }))["resolved"],
        "Note/prezzi.md"
    );
    let tags = server.ok("fub_query", json!({ "tags": true }));
    assert!(tags["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["tag"] == "analisi" && t["count"] == 2));

    let read = server.ok("fub_read", json!({ "doc": "Note/prezzi.md" }));
    assert_eq!(read["text"], "# Prezzi\n\nI prezzi scendono. #analisi\n");
    assert!(read["revision"].as_str().is_some_and(|r| !r.is_empty()));
    let model = server.ok("fub_read_model", json!({ "doc": "Note/mercato.md" }));
    assert!(model["model"].to_string().contains("prezzi"));

    let commands = server.ok("fub_commands", json!({ "limit": 200 }));
    let create = commands["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "note.create")
        .expect("note.create");
    assert_eq!(create["writes"], true);
    assert!(create["params"].is_array());

    // Le risorse: in testa le tre della guida della lavagna (il componente è
    // acceso di serie), poi le note come fub://open?note=…, a pagine.
    let list = server.request("resources/list", json!({}));
    let resources = list["result"]["resources"].as_array().unwrap();
    assert_eq!(resources.len(), 8);
    assert_eq!(
        resources[..3]
            .iter()
            .map(|r| r["uri"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "fub-guida://lavagna",
            "fub-guida://lavagna/schema",
            "fub-guida://lavagna/esempi"
        ]
    );
    assert_eq!(resources[0]["mimeType"], "text/markdown");
    assert_eq!(resources[1]["mimeType"], "application/json");
    assert_eq!(resources[2]["mimeType"], "application/json");
    let prezzi = resources
        .iter()
        .find(|r| r["name"] == "Note/prezzi.md")
        .unwrap();
    assert_eq!(prezzi["uri"], "fub://open?note=Note/prezzi.md");
    assert_eq!(prezzi["mimeType"], "text/markdown");
    let read = server.request(
        "resources/read",
        json!({ "uri": "fub://open?note=Note/prezzi.md" }),
    );
    assert_eq!(
        read["result"]["contents"][0]["text"],
        "# Prezzi\n\nI prezzi scendono. #analisi\n"
    );
    assert_eq!(
        server.request(
            "resources/read",
            json!({ "uri": "fub://open?note=..%2Fx.md" })
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        server.request("resources/read", json!({ "uri": "https://x" }))["error"]["code"],
        -32602
    );
}

#[test]
fn due_scritture_con_la_stessa_base_la_seconda_e_un_conflitto() {
    let f = fixture();
    let mut server = writer(&f);
    let base = server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }))["revision"].clone();
    let first = server.ok(
        "fub_write",
        json!({ "doc": "Agente/bozza.md", "text": "# Bozza\n\nprima\n", "base": base }),
    );
    let conflict = server.refused(
        "fub_write",
        json!({ "doc": "Agente/bozza.md", "text": "# Bozza\n\nseconda\n", "base": base }),
    );
    assert!(conflict.starts_with("conflict:"), "{conflict}");
    assert!(conflict.contains("rileggi"));
    // Nessun byte perso: c'è la prima, e la sua revisione è quella detta.
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/bozza.md")).unwrap(),
        "# Bozza\n\nprima\n"
    );
    let again = server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }));
    assert_eq!(again["revision"], first["revision"]);
    // Rileggere e riprovare va.
    server.ok("fub_write", json!({ "doc": "Agente/bozza.md", "text": "# Bozza\n\nseconda\n", "base": again["revision"] }));
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/bozza.md")).unwrap(),
        "# Bozza\n\nseconda\n"
    );
    // Senza base, niente.
    assert!(server
        .refused(
            "fub_write",
            json!({ "doc": "Agente/bozza.md", "text": "x" })
        )
        .contains("manca `base`"));
}

#[test]
fn senza_radice_di_scrittura_ogni_strumento_che_scrive_e_rifiutato() {
    let f = fixture();
    let mut server = Server::start(&f.vault, &f.config, &[]).initialized();
    let base = server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }))["revision"].clone();
    for (tool, args) in [
        (
            "fub_write",
            json!({ "doc": "Agente/bozza.md", "text": "x", "base": base }),
        ),
        ("fub_create", json!({ "name": "Agente/nuova.md" })),
        ("fub_canvas_create", json!({ "name": "Agente/tela" })),
        (
            "fub_canvas_apply",
            json!({ "doc": "Agente/tela.canvas", "ops": [{ "op": "remove", "ids": ["a"] }], "base": base, "apply": true }),
        ),
        (
            "fub_invoke",
            json!({ "command": "note.create", "args": { "name": "Agente/nuova.md" }, "apply": true }),
        ),
        (
            "fub_components_disable",
            json!({ "id": "fub.graph", "apply": true }),
        ),
        (
            "fub_components_enable",
            json!({ "id": "fub.graph", "apply": true }),
        ),
    ] {
        let refused = server.refused(tool, args);
        assert!(
            refused.starts_with("denied: sola lettura"),
            "{tool}: {refused}"
        );
    }
    // In prova un comando si può guardare: il piano non scrive.
    let plan = server.ok(
        "fub_invoke",
        json!({ "command": "note.create", "args": { "name": "Agente/nuova.md" } }),
    );
    assert_eq!(plan["dry_run"], true);
    assert!(!f.vault.join("Agente/nuova.md").exists());
    assert!(!f.vault.join("Agente/tela.canvas").exists());
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/bozza.md")).unwrap(),
        "# Bozza\n"
    );
}

/// Il componente nell'elenco di `fub_components`.
fn component(server: &mut Server, id: &str) -> Value {
    let list = server.ok("fub_components", json!({ "limit": 200 }));
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
        .unwrap_or_else(|| panic!("{id} non è nell'elenco"))
        .clone()
}

#[test]
fn i_componenti_senza_apply_sono_una_prova() {
    let f = fixture();
    let mut server = vault_writer(&f);
    let page = server.ok("fub_components", json!({ "limit": 3, "offset": 1 }));
    assert_eq!(page["items"].as_array().unwrap().len(), 3);
    assert_eq!(
        (page["offset"].clone(), page["limit"].clone()),
        (json!(1), json!(3))
    );

    // Acceso: spegnerlo in prova dice che cosa farebbe, e non cambia niente.
    assert_eq!(component(&mut server, "fub.graph")["enabled"], true);
    let why = server.ok("fub_components_why", json!({ "id": "fub.graph" }));
    assert_eq!(why["message"], "fub.graph è attivo perché l'hai scelto.");
    let dry = server.ok("fub_components_disable", json!({ "id": "fub.graph" }));
    assert_eq!(dry["dry_run"], true);
    assert_eq!(
        dry["writes"],
        json!([{ "id": "fub.graph", "enabled": false }])
    );
    assert_eq!(component(&mut server, "fub.graph")["enabled"], true);

    // Con apply si spegne.
    let off = server.ok(
        "fub_components_disable",
        json!({ "id": "fub.graph", "apply": true }),
    );
    assert_eq!(off["dry_run"], false);
    assert_eq!(component(&mut server, "fub.graph")["enabled"], false);
    let why = server.ok("fub_components_why", json!({ "id": "fub.graph" }));
    assert_eq!(why["reason"], "off");

    // Spento: accenderlo in prova non cambia niente; con apply sì.
    let dry = server.ok("fub_components_enable", json!({ "id": "fub.graph" }));
    assert_eq!(
        dry["writes"],
        json!([{ "id": "fub.graph", "enabled": true }])
    );
    assert_eq!(component(&mut server, "fub.graph")["enabled"], false);
    server.ok(
        "fub_components_enable",
        json!({ "id": "fub.graph", "apply": true }),
    );
    assert_eq!(component(&mut server, "fub.graph")["enabled"], true);

    // Chi serve ad altri si rifiuta e dice a chi, con il nome del parametro.
    let refused = server.refused(
        "fub_components_disable",
        json!({ "id": "fub.properties", "apply": true }),
    );
    assert!(refused.starts_with("conflict:"), "{refused}");
    assert!(refused.contains("fub.template"), "{refused}");
    assert!(refused.contains("also_dependents"), "{refused}");
    let both = server.ok(
        "fub_components_disable",
        json!({ "id": "fub.properties", "also_dependents": true }),
    );
    assert_eq!(both["dry_run"], true);
    assert_eq!(component(&mut server, "fub.properties")["enabled"], true);
    // Il nucleo no, e un id che non c'è nemmeno.
    let core = server.refused("fub_components_disable", json!({ "id": "fub.markdown" }));
    assert!(core.contains("fa parte del nucleo"), "{core}");
    let unknown = server.refused("fub_components_why", json!({ "id": "fub.niente" }));
    assert!(unknown.contains("nessun componente si chiama"), "{unknown}");
    let bad = server.refused(
        "fub_components_disable",
        json!({ "id": "fub.lavagna", "orphans": "forse" }),
    );
    assert!(bad.starts_with("bad_args"), "{bad}");
}

#[test]
fn senza_radice_di_scrittura_i_componenti_si_vedono_e_non_si_cambiano() {
    let f = fixture();
    // Il grafo spento da un agente che scrive in tutto il vault.
    {
        let mut server = vault_writer(&f);
        server.ok(
            "fub_components_disable",
            json!({ "id": "fub.graph", "apply": true }),
        );
    }
    let mut server = Server::start(&f.vault, &f.config, &[]).initialized();
    // Spento: accenderlo con apply è rifiutato, in prova si può.
    assert_eq!(component(&mut server, "fub.graph")["enabled"], false);
    let refused = server.refused(
        "fub_components_enable",
        json!({ "id": "fub.graph", "apply": true }),
    );
    assert!(refused.starts_with("denied: sola lettura"), "{refused}");
    let dry = server.ok("fub_components_enable", json!({ "id": "fub.graph" }));
    assert_eq!(dry["dry_run"], true);
    assert_eq!(component(&mut server, "fub.graph")["enabled"], false);
    // Acceso: spegnerlo con apply è rifiutato.
    assert_eq!(component(&mut server, "fub.stats")["enabled"], true);
    let refused = server.refused(
        "fub_components_disable",
        json!({ "id": "fub.stats", "apply": true }),
    );
    assert!(refused.starts_with("denied: sola lettura"), "{refused}");
    assert_eq!(component(&mut server, "fub.stats")["enabled"], true);
}

#[test]
fn con_una_radice_parziale_i_componenti_non_si_cambiano() {
    let f = fixture();
    // Il grafo spento da un agente che scrive in tutto il vault.
    {
        let mut server = vault_writer(&f);
        server.ok(
            "fub_components_disable",
            json!({ "id": "fub.graph", "apply": true }),
        );
    }
    let disabled = |server: &mut Server| {
        let mut off: Vec<String> = server.ok("fub_components", json!({ "limit": 200 }))["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["enabled"] == false)
            .map(|item| item["id"].as_str().unwrap().to_string())
            .collect();
        off.sort();
        off
    };
    // Una cartella sola fra le radici di scrittura.
    let mut server = writer(&f);
    let before = disabled(&mut server);
    assert!(before.contains(&"fub.graph".to_string()), "{before:?}");
    for (id, enabled) in [("fub.graph", false), ("fub.stats", true)] {
        assert_eq!(component(&mut server, id)["enabled"], enabled);
        for tool in ["fub_components_disable", "fub_components_enable"] {
            let refused = server.refused(tool, json!({ "id": id, "apply": true }));
            assert!(
                refused.starts_with("denied:") && refused.contains("tutto il vault"),
                "{tool} {id}: {refused}"
            );
        }
        assert_eq!(component(&mut server, id)["enabled"], enabled);
    }
    assert_eq!(disabled(&mut server), before);
    drop(server);
    // plugins.disabled sul disco, riletto da un server nuovo: com'era.
    let mut server = vault_writer(&f);
    assert_eq!(disabled(&mut server), before);
}

#[test]
fn le_radici_tengono_fuori_ciò_che_non_coprono() {
    let f = fixture();
    let notes = f.vault.join("Note");
    let agent = f.vault.join("Agente");
    let mut server = Server::start(
        &f.vault,
        &f.config,
        &[
            ("--automation-read-root", &notes),
            ("--automation-write-root", &agent),
        ],
    )
    .initialized();
    // Il diario non c'è: né nella ricerca, né nella lettura, né fra le risorse.
    assert_eq!(
        docs(&server.ok("fub_search", json!({ "query": "mercato" }))),
        ["Note/mercato.md"]
    );
    assert!(server
        .refused("fub_read", json!({ "doc": "Diario/oggi.md" }))
        .starts_with("denied"));
    let list = server.request("resources/list", json!({}));
    assert!(list["result"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["name"] != "Diario/oggi.md"));
    // Si legge anche sotto la radice di scrittura.
    server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }));
    // Si scrive soltanto lì.
    let base = server.ok("fub_read", json!({ "doc": "Note/prezzi.md" }))["revision"].clone();
    assert!(server
        .refused(
            "fub_write",
            json!({ "doc": "Note/prezzi.md", "text": "x", "base": base })
        )
        .starts_with("denied"));
    assert!(server
        .refused("fub_create", json!({ "name": "Note/nuova.md" }))
        .starts_with("denied"));
    assert!(!f.vault.join("Note/nuova.md").exists());
    // E un comando, che raggiunge il vault intero, non si invoca.
    assert!(server
        .refused("fub_invoke", json!({ "command": "note.create" }))
        .starts_with("denied"));
}

#[test]
fn fub_invoke_parte_in_prova_ed_esegue_soltanto_con_apply() {
    let f = fixture();
    let mut server = writer(&f);
    let plan = server.ok(
        "fub_invoke",
        json!({ "command": "note.create", "args": { "name": "Agente/piano.md" } }),
    );
    assert_eq!(plan["dry_run"], true);
    assert!(plan["outcome"].to_string().contains("Agente/piano.md"));
    assert!(!f.vault.join("Agente/piano.md").exists());
    let done = server.ok(
        "fub_invoke",
        json!({ "command": "note.create", "args": { "name": "Agente/piano.md" }, "apply": true }),
    );
    assert_eq!(done["dry_run"], false);
    assert!(f.vault.join("Agente/piano.md").exists());
    // Un piano fuori dalle radici di scrittura non si esegue.
    let refused = server.refused(
        "fub_invoke",
        json!({ "command": "note.create", "args": { "name": "Note/x.md" }, "apply": true }),
    );
    assert!(refused.starts_with("denied"), "{refused}");
    assert!(!f.vault.join("Note/x.md").exists());
    // Le cancellazioni vanno nel cestino.
    server.ok(
        "fub_invoke",
        json!({ "command": "note.trash", "args": { "doc": "Agente/piano.md" }, "apply": true }),
    );
    assert!(!f.vault.join("Agente/piano.md").exists());
}

#[test]
fn fub_create_non_sovrascrive_mai() {
    let f = fixture();
    let mut server = writer(&f);
    let made = server.ok(
        "fub_create",
        json!({ "name": "Agente/nuova.md", "text": "# Nuova\n" }),
    );
    assert_eq!(made["doc"], "Agente/nuova.md");
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/nuova.md")).unwrap(),
        "# Nuova\n"
    );
    let taken = server.refused(
        "fub_create",
        json!({ "name": "Agente/nuova.md", "text": "altro" }),
    );
    assert!(taken.starts_with("conflict"), "{taken}");
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/nuova.md")).unwrap(),
        "# Nuova\n"
    );
    assert!(server
        .refused("fub_create", json!({ "text": "x", "template": "t" }))
        .contains("non tutti e due"));
}

/// Il giro di un agente, scritto: trova le note col tag #analisi, scrive un
/// riassunto che le collega e lo mette su una lavagna. Il riassunto compare
/// fra i backlink delle note; la lavagna è un `.canvas` che lo nomina.
#[test]
fn il_giro_di_un_agente() {
    let f = fixture();
    let mut server = writer(&f);
    let found = docs(&server.ok("fub_query", json!({ "tag": "analisi" })));
    assert_eq!(found, ["Note/mercato.md", "Note/prezzi.md"]);
    let mut summary = String::from("# Riassunto delle analisi\n\n");
    for doc in &found {
        let text = server.ok("fub_read", json!({ "doc": doc }))["text"]
            .as_str()
            .unwrap()
            .to_string();
        let first = text
            .lines()
            .find(|line| !line.is_empty() && !line.starts_with('#'))
            .unwrap_or_default();
        let name = doc.trim_start_matches("Note/").trim_end_matches(".md");
        summary.push_str(&format!("- [[{name}]]: {first}\n"));
    }
    server.ok(
        "fub_create",
        json!({ "name": "Agente/riassunto.md", "text": summary }),
    );
    for doc in &found {
        let back = docs(&server.ok("fub_query", json!({ "backlinks": doc })));
        assert!(
            back.contains(&"Agente/riassunto.md".to_string()),
            "{doc}: {back:?}"
        );
    }
    let canvas = json!({
        "nodes": [{ "id": "riassunto", "type": "file", "file": "Agente/riassunto.md", "x": 0, "y": 0, "width": 400, "height": 300 }],
        "edges": []
    })
    .to_string();
    let board = server.ok(
        "fub_create",
        json!({ "name": "Agente/analisi.canvas", "text": canvas }),
    );
    assert_eq!(board["doc"], "Agente/analisi.canvas");
    let back = docs(&server.ok("fub_query", json!({ "backlinks": "Agente/riassunto.md" })));
    assert_eq!(back, ["Agente/analisi.canvas"]);
}

/// Con il vault aperto nell'app, l'MCP passa da lei come gli altri comandi.
#[test]
fn con_l_app_aperta_l_mcp_passa_da_lei() {
    let f = fixture();
    let config = camino::Utf8Path::from_path(&f.config).unwrap();
    let host = std::sync::Arc::new(fub_host::Host::without_watcher().with_config_dir(config));
    host.open(camino::Utf8Path::from_path(&f.vault).unwrap())
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
    let mut server = writer(&f);
    let read = server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }));
    server.ok("fub_write", json!({ "doc": "Agente/bozza.md", "text": "# Bozza\n\ndall'agente\n", "base": read["revision"] }));
    let id = fub_host::doc_id("Agente/bozza.md").unwrap();
    assert_eq!(
        host.read_document(None, &id).unwrap().0,
        "# Bozza\n\ndall'agente\n"
    );
}

/// Il vettore del cancello di N3, letto dove lo leggono il nucleo e la tela:
/// `apps/client/src/__fixtures__/canvas-ops/agent-board.json`.
fn agent_board() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-ops/agent-board.json");
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

/// Il sorgente di una lavagna vuota, come la scrive Fub (R6 di
/// `canvas-format.md`): rientrato di due spazi e chiuso da `"\n"`.
const EMPTY_CANVAS: &str = "{\n  \"nodes\": [],\n  \"edges\": []\n}\n";

/// Il cancello: un agente crea una lavagna, ci mette le schede e gli archi di
/// `agent-board.json` e, riletta, la lavagna è il testo atteso del vettore.
#[test]
fn il_cancello_della_lavagna() {
    let f = fixture();
    let mut server = writer(&f);
    let board = agent_board();
    assert_eq!(
        board["before"],
        json!({}),
        "il cancello parte da una lavagna vuota"
    );

    let made = server.ok(
        "fub_canvas_create",
        json!({ "name": "piano", "folder": "Agente" }),
    );
    assert_eq!(made["doc"], "Agente/piano.canvas");
    let path = f.vault.join("Agente/piano.canvas");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), EMPTY_CANVAS);
    let read = server.ok("fub_read", json!({ "doc": "Agente/piano.canvas" }));
    assert_eq!(read["revision"], made["revision"]);

    // Senza apply è una prova: il piano, e il file non cambia.
    let ops = board["ops"].clone();
    let dry = server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": ops, "base": made["revision"] }),
    );
    assert_eq!(dry["dry_run"], true);
    assert!(dry["outcome"].to_string().contains("Agente/piano.canvas"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), EMPTY_CANVAS);

    let done = server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": ops, "base": made["revision"], "apply": true }),
    );
    assert_eq!(done["dry_run"], false);
    assert_eq!(done["doc"], "Agente/piano.canvas");
    // Le schede tengono i loro id; gli archi ricevono id nuovi, di 16 cifre
    // esadecimali. Il seme del vettore non passa dall'MCP: gli id degli
    // archi vengono dalla revisione, e il testo si confronta con quelli.
    let created: Vec<String> = done["created"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_string())
        .collect();
    let expected_created = board["expect"]["created"].as_array().unwrap();
    assert_eq!(created.len(), expected_created.len());
    assert_eq!(created[..3], ["obiettivo", "passo-1", "passo-2"]);
    for id in &created[3..] {
        assert!(
            id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit()),
            "{id}"
        );
    }
    let mut after = board["expect"]["after"].clone();
    for (edge, id) in after["edges"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(&created[3..])
    {
        edge["id"] = json!(id);
    }
    // Il sorgente si ritocca, non si riscrive (A2 del piano N3): la forma
    // della lavagna vuota resta, e schede e archi entrano nelle sue liste
    // come li scrive `JSON.stringify`, uno dopo l'altro.
    let compact = |list: &Value| {
        list.as_array()
            .unwrap()
            .iter()
            .map(|item| serde_json::to_string(item).unwrap())
            .collect::<Vec<_>>()
            .join(",")
    };
    let expected = format!(
        "{{\n  \"nodes\": [{}],\n  \"edges\": [{}]\n}}\n",
        compact(&after["nodes"]),
        compact(&after["edges"])
    );

    let reread = server.ok("fub_read", json!({ "doc": "Agente/piano.canvas" }));
    assert_eq!(reread["text"], expected.as_str());
    let model: Value = serde_json::from_str(reread["text"].as_str().unwrap()).unwrap();
    assert_eq!(model, after);
    assert_eq!(reread["revision"], done["revision"]);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), expected);

    // Le operazioni anche come testo JSON, sulla revisione nuova.
    let moved = server.ok(
        "fub_canvas_apply",
        json!({
            "doc": "Agente/piano.canvas",
            "ops": r#"[{"op": "move", "ids": ["passo-1"], "dx": 10, "dy": 0}]"#,
            "base": done["revision"],
            "apply": true
        }),
    );
    assert_eq!(moved["created"], json!([]));
    let text = std::fs::read_to_string(&path).unwrap();
    assert_eq!(text, expected.replacen("\"x\":360", "\"x\":370", 1));
}

/// Una lista che `fub_canvas_apply` rifiuta con i suoi problemi: il testo della
/// risposta e il suo `structuredContent`, con `isError`.
fn rejected(server: &mut Server, arguments: Value) -> (String, Value) {
    let reply = server.request(
        "tools/call",
        json!({ "name": "fub_canvas_apply", "arguments": arguments }),
    );
    let result = &reply["result"];
    assert_eq!(result["isError"], true, "doveva essere rifiutata: {reply}");
    (
        result["content"][0]["text"].as_str().unwrap().to_string(),
        result["structuredContent"].clone(),
    )
}

/// Una lavagna `Agente/piano.canvas` con il vettore del cancello. Ritorna la
/// risposta della scrittura, con la revisione dopo.
fn board(server: &mut Server) -> Value {
    let made = server.ok("fub_canvas_create", json!({ "name": "Agente/piano" }));
    server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": agent_board()["ops"], "base": made["revision"], "apply": true }),
    )
}

/// La lettura e la guida: `fub_canvas_read` dà la lavagna con la sua revisione
/// nelle forme di `canvas.read`, `fub_canvas_guide` la guida con le operazioni.
#[test]
fn le_lavagne_si_leggono_e_si_guidano() {
    let f = fixture();
    let mut server = writer(&f);
    let done = board(&mut server);
    let after = agent_board()["expect"]["after"].clone();
    let cards = after["nodes"].as_array().unwrap().len();

    let read = server.ok("fub_canvas_read", json!({ "doc": "Agente/piano.canvas" }));
    assert_eq!(read["doc"], "Agente/piano.canvas");
    assert_eq!(read["revision"], done["revision"]);
    assert_eq!(read["form"], "outline");
    assert_eq!(read["counts"]["cards"], cards);
    assert!(read.get("version").is_none() && read.get("kind").is_none());
    let text = read["text"].as_str().unwrap();
    assert!(text.contains("obiettivo"), "{text}");
    let file = server.ok("fub_read", json!({ "doc": "Agente/piano.canvas" }));
    assert_eq!(read["revision"], file["revision"]);

    // `code` è la lista che ricrea la lavagna, `json` il modello.
    let code = server.ok(
        "fub_canvas_read",
        json!({ "doc": "Agente/piano.canvas", "form": "code" }),
    );
    let ops: Value = serde_json::from_str(code["text"].as_str().unwrap()).unwrap();
    assert!(ops.is_array(), "{ops}");
    let model = server.ok(
        "fub_canvas_read",
        json!({ "doc": "Agente/piano.canvas", "form": "json" }),
    );
    assert_eq!(model["model"]["nodes"].as_array().unwrap().len(), cards);

    // `ids`, come lista o come testo JSON, legge solo quelle schede.
    let one = server.ok(
        "fub_canvas_read",
        json!({ "doc": "Agente/piano.canvas", "ids": ["passo-1"] }),
    );
    assert_eq!(one["counts"]["cards"], 1);
    let one_text = server.ok(
        "fub_canvas_read",
        json!({ "doc": "Agente/piano.canvas", "ids": "[\"passo-1\"]" }),
    );
    assert_eq!(one_text["counts"]["cards"], 1);
    // `max_chars` taglia l'outline.
    let short = server.ok(
        "fub_canvas_read",
        json!({ "doc": "Agente/piano.canvas", "max_chars": 20 }),
    );
    assert!(short["text"].as_str().unwrap().chars().count() < text.chars().count());

    // Argomenti sbagliati, e un documento che non è una lavagna.
    assert!(server
        .refused(
            "fub_canvas_read",
            json!({ "doc": "Agente/piano.canvas", "form": "vola" })
        )
        .starts_with("bad_args"));
    assert!(server
        .refused(
            "fub_canvas_read",
            json!({ "doc": "Agente/piano.canvas", "ids": 3 })
        )
        .starts_with("bad_args: `ids`"));
    assert!(server
        .refused(
            "fub_canvas_read",
            json!({ "doc": "Agente/piano.canvas", "max_chars": "dodici" })
        )
        .starts_with("bad_args: `max_chars`"));
    assert!(server
        .refused("fub_canvas_read", json!({ "doc": "Agente/bozza.md" }))
        .starts_with("bad_args"));

    // La guida: il testo, le operazioni, lo schema e gli esempi.
    let guide = server.ok("fub_canvas_guide", json!({}));
    assert!(!guide["text"].as_str().unwrap().is_empty());
    let mut names: Vec<&str> = guide["ops"]
        .as_array()
        .unwrap()
        .iter()
        .map(|op| op["name"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(
        names,
        ["add_card", "color", "connect", "move", "remove", "reorder", "resize", "set"]
    );
    assert!(guide["schema"].is_object());
    assert!(!guide["examples"].as_array().unwrap().is_empty());
    assert!(guide.get("version").is_none() && guide.get("kind").is_none());
    let one_op = server.ok("fub_canvas_guide", json!({ "topic": "move" }));
    assert_eq!(one_op["ops"].as_array().unwrap().len(), 1);
    assert_eq!(one_op["ops"][0]["name"], "move");
    let unknown = server.refused("fub_canvas_guide", json!({ "topic": "vola" }));
    assert!(unknown.starts_with("bad_args"), "{unknown}");
}

/// Il controllo viene prima di tutto: una lista con problemi non tocca il file,
/// né con `apply` né in prova; una revisione superata è il conflitto di sempre.
#[test]
fn fub_canvas_apply_controlla_prima_di_scrivere() {
    let f = fixture();
    let mut server = writer(&f);
    let done = board(&mut server);
    let path = f.vault.join("Agente/piano.canvas");
    let written = std::fs::read_to_string(&path).unwrap();
    let base = done["revision"].clone();

    // Cinquecento operazioni sbagliate: il testo dice la prima, il payload tutte.
    let many = json!(vec![json!({ "op": "vola" }); 500]);
    for apply in [true, false] {
        let (text, data) = rejected(
            &mut server,
            json!({ "doc": "Agente/piano.canvas", "ops": many, "base": base, "apply": apply, "preview": true }),
        );
        assert!(
            text.starts_with(
                "500 problemi: niente è scritto. Il primo, l'operazione 1 (unknown_op)"
            ),
            "{text}"
        );
        assert_eq!(data["problems"].as_array().unwrap().len(), 500);
        assert_eq!(data["problems"][499]["index"], 499);
        assert_eq!(data["written"], false);
        assert_eq!(data["ok"], false);
        assert!(data.get("dry_run").is_none() && data.get("preview").is_none());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), written);
    }

    // Una base vecchia da sola è il conflitto di `canvas.apply`, con la stessa
    // parola e lo stesso codice; la lavagna non cambia.
    let stale = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": [{ "op": "remove", "ids": ["passo-2"] }], "base": "vecchia", "apply": true }),
    );
    assert!(stale.starts_with("conflict:"), "{stale}");
    assert!(stale.contains("rileggi"), "{stale}");
    assert!(server
        .refused(
            "fub_canvas_apply",
            json!({ "doc": "Agente/piano.canvas", "ops": [{ "op": "remove", "ids": ["passo-2"] }], "base": "vecchia" })
        )
        .starts_with("conflict:"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);

    // Con un altro problema accanto, la base vecchia è uno dei problemi.
    let (text, data) = rejected(
        &mut server,
        json!({ "doc": "Agente/piano.canvas", "ops": [{ "op": "vola" }], "base": "vecchia", "apply": true }),
    );
    assert!(text.starts_with("2 problemi"), "{text}");
    assert_eq!(data["problems"][0]["code"], "stale_base");
    assert_eq!(data["problems"][1]["code"], "unknown_op");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);
}

/// Con la lista buona: la prova dice che cosa cambierebbe, `apply` scrive con i
/// suoi avvisi, e `preview` mostra la lavagna di dopo prima di scrivere.
#[test]
fn fub_canvas_apply_con_la_prova_e_l_anteprima() {
    let f = fixture();
    let mut server = writer(&f);
    let made = server.ok("fub_canvas_create", json!({ "name": "Agente/prova" }));
    let path = f.vault.join("Agente/prova.canvas");
    let empty = std::fs::read_to_string(&path).unwrap();
    let card = json!([{ "op": "add_card", "node": { "id": "uno", "type": "text", "x": 0, "y": 0, "width": 240, "height": 100, "text": "Ciao" } }]);

    // La prova: il controllo, il piano, e il file uguale.
    let dry = server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/prova.canvas", "ops": card, "base": made["revision"] }),
    );
    assert_eq!(dry["dry_run"], true);
    assert_eq!(dry["check"]["ok"], true);
    assert!(dry["check"]["summary"].is_object());
    assert!(dry["outcome"].to_string().contains("Agente/prova.canvas"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), empty);

    // La prova con l'immagine di dopo: un PNG come contenuto, e la lettura delle
    // schede con il numero, senza i byte nel testo.
    let (content, data) = {
        let reply = server.request(
            "tools/call",
            json!({ "name": "fub_canvas_apply", "arguments": { "doc": "Agente/prova.canvas", "ops": card, "base": made["revision"], "preview": true } }),
        );
        assert_ne!(reply["result"]["isError"], true, "{reply}");
        (
            reply["result"]["content"].clone(),
            reply["result"]["structuredContent"].clone(),
        )
    };
    assert_eq!(content[1]["type"], "image");
    assert_eq!(content[1]["mimeType"], "image/png");
    assert!(content[1]["data"]
        .as_str()
        .unwrap()
        .starts_with("iVBORw0KGgo"));
    assert_eq!(data["preview"]["image"]["media_type"], "image/png");
    assert!(data["preview"]["image"].get("data").is_none());
    let outline = data["preview"]["info"]["outline"].as_array().unwrap();
    assert!(
        outline.iter().any(|entry| entry["id"] == "uno"),
        "{outline:?}"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), empty);

    // La scrittura: la risposta di adesso, con gli avvisi del controllo.
    let done = server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/prova.canvas", "ops": card, "base": made["revision"], "apply": true }),
    );
    assert_eq!(done["dry_run"], false);
    assert_eq!(done["created"], json!(["uno"]));
    assert!(done["warnings"].is_array(), "{done}");
    assert!(done.get("check").is_none());
    assert!(std::fs::read_to_string(&path).unwrap().contains("\"Ciao\""));
}

/// `fub_preview` su una lavagna disegna la lavagna: 512 pixel di lato lungo di
/// serie, 1024 con `large`, con la stessa revisione di `fub_read`.
#[test]
fn fub_preview_disegna_una_lavagna() {
    let f = fixture();
    let mut server = writer(&f);
    board(&mut server);
    let file = server.ok("fub_read", json!({ "doc": "Agente/piano.canvas" }));

    for (size, side) in [("small", 512), ("large", 1024)] {
        let reply = server.request(
            "tools/call",
            json!({ "name": "fub_preview", "arguments": { "doc": "Agente/piano.canvas", "size": size } }),
        );
        let result = &reply["result"];
        assert_ne!(result["isError"], true, "{reply}");
        let data = &result["structuredContent"];
        assert_eq!(data["origin"], "canvas");
        assert_eq!(data["size"], size);
        assert_eq!(data["revision"], file["revision"]);
        assert!(data["missing"].is_null() && data["limit_bytes"].is_null());
        let width = data["image"]["width"].as_u64().unwrap();
        let height = data["image"]["height"].as_u64().unwrap();
        assert_eq!(width.max(height), side, "{data}");
        assert!(data["image"].get("data").is_none());
        assert_eq!(result["content"][1]["mimeType"], "image/png");
        assert!(data["info"]["outline"].is_array());
    }
}

/// Le risorse della guida: in testa alla prima pagina, e assenti dalla seconda.
/// Il `cursor` resta l'offset delle note, a pagine da 100.
#[test]
fn le_guide_sono_in_testa_alla_prima_pagina_e_basta() {
    let f = fixture();
    for n in 0..100 {
        std::fs::write(f.vault.join(format!("Note/nota-{n:03}.md")), "# Nota\n").unwrap();
    }
    let mut server = writer(&f);
    let first = server.request("resources/list", json!({}));
    let resources = first["result"]["resources"].as_array().unwrap();
    assert_eq!(resources.len(), 103);
    assert!(resources[..3].iter().all(|r| r["uri"]
        .as_str()
        .unwrap()
        .starts_with("fub-guida://lavagna")));
    assert!(resources[3..]
        .iter()
        .all(|r| !r["uri"].as_str().unwrap().starts_with("fub-guida://")));
    assert_eq!(first["result"]["nextCursor"], "100");

    let second = server.request("resources/list", json!({ "cursor": "100" }));
    let rest = second["result"]["resources"].as_array().unwrap();
    assert_eq!(rest.len(), 5);
    assert!(rest
        .iter()
        .all(|r| !r["uri"].as_str().unwrap().starts_with("fub-guida://")));
    assert!(second["result"].get("nextCursor").is_none());
}

/// Le tre guide si leggono come risorse, e ogni altro `fub-guida://` è
/// `invalid_params`.
#[test]
fn la_guida_si_legge_come_risorsa() {
    let f = fixture();
    let mut server = writer(&f);
    let guide = server.ok("fub_canvas_guide", json!({}));
    let read =
        |server: &mut Server, uri: &str| server.request("resources/read", json!({ "uri": uri }));

    let text = read(&mut server, "fub-guida://lavagna");
    let contents = &text["result"]["contents"][0];
    assert_eq!(contents["mimeType"], "text/markdown");
    assert_eq!(contents["text"], guide["text"]);
    let schema = read(&mut server, "fub-guida://lavagna/schema");
    assert_eq!(
        schema["result"]["contents"][0]["mimeType"],
        "application/json"
    );
    let parsed: Value =
        serde_json::from_str(schema["result"]["contents"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed, guide["schema"]);
    let examples = read(&mut server, "fub-guida://lavagna/esempi");
    let parsed: Value =
        serde_json::from_str(examples["result"]["contents"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(parsed, guide["examples"]);

    for uri in [
        "fub-guida://lavagna/vola",
        "fub-guida://",
        "fub-guida://lavagna?x=1",
        "fub-guida://altro",
    ] {
        assert_eq!(read(&mut server, uri)["error"]["code"], -32602, "{uri}");
    }
}

/// La descrizione di `fub_canvas_apply` nomina ogni operazione di `canvas.guide`,
/// e nessuna che la guida non ha: un'operazione nuova senza il suo nome fa
/// fallire questa prova.
#[test]
fn la_descrizione_di_fub_canvas_apply_nomina_le_operazioni_della_guida() {
    let f = fixture();
    let mut server = writer(&f);
    let guide = server.ok("fub_canvas_guide", json!({}));
    let names: Vec<String> = guide["ops"]
        .as_array()
        .unwrap()
        .iter()
        .map(|op| op["name"].as_str().unwrap().to_string())
        .collect();
    let tools = server.request("tools/list", json!({}));
    let apply = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "fub_canvas_apply")
        .unwrap();
    let description = apply["description"].as_str().unwrap();
    for name in &names {
        assert!(
            description.contains(&format!("`{name}`")),
            "manca {name}: {description}"
        );
    }
    // I campi che T10 ha aggiunto: la guida li ha, e la descrizione dice come si
    // scrivono (senza backtick, che è riservato ai nomi delle operazioni).
    let fields_of = |op: &str| -> Vec<String> {
        guide["ops"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["name"] == op)
            .unwrap_or_else(|| panic!("la guida non ha {op}"))["fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|field| field["name"].as_str().unwrap().to_string())
            .collect()
    };
    for (op, field, shape) in [
        ("move", "contents", "contents: true"),
        ("resize", "fit", "fit: \"content\""),
        ("reorder", "to", "to: \"back\""),
    ] {
        assert!(
            fields_of(op).iter().any(|name| name == field),
            "la guida non ha {op}.{field}"
        );
        assert!(description.contains(shape), "manca {shape}: {description}");
    }
    // Ciò che sta fra backtick e ha la forma di un nome è un'operazione.
    for token in description.split('`').skip(1).step_by(2) {
        if token.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
            assert!(
                names.iter().any(|name| name == token),
                "`{token}` non è un'operazione"
            );
        }
    }
}

/// Con la lavagna spenta non ci sono né le sue guide né i suoi comandi: ogni
/// strumento dice `unavailable`, e la lista non ha le tre risorse.
#[test]
fn con_la_lavagna_spenta_nessuno_strumento_di_lavagna_risponde() {
    let f = fixture();
    std::fs::write(f.vault.join("Agente/tela.canvas"), EMPTY_CANVAS).unwrap();
    {
        let mut server = vault_writer(&f);
        server.ok(
            "fub_components_disable",
            json!({ "id": "fub.lavagna", "apply": true }),
        );
    }
    let mut server = writer(&f);
    for (tool, arguments) in [
        ("fub_canvas_read", json!({ "doc": "Agente/tela.canvas" })),
        ("fub_canvas_guide", json!({})),
        ("fub_preview", json!({ "doc": "Agente/tela.canvas" })),
        (
            "fub_canvas_apply",
            json!({ "doc": "Agente/tela.canvas", "ops": [{ "op": "remove", "ids": ["x"] }], "base": "x", "apply": true }),
        ),
    ] {
        let refused = server.refused(tool, arguments);
        assert!(refused.starts_with("unavailable:"), "{tool}: {refused}");
    }
    let list = server.request("resources/list", json!({}));
    assert!(list["result"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| !r["uri"].as_str().unwrap().starts_with("fub-guida://")));
    assert_eq!(
        server.request("resources/read", json!({ "uri": "fub-guida://lavagna" }))["error"]["code"],
        -32602
    );
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/tela.canvas")).unwrap(),
        EMPTY_CANVAS
    );
}

/// Senza radici di scrittura la lavagna si legge e si guida, e `fub_canvas_apply`
/// è `denied` prima del controllo, anche con una lista che non si legge. Una
/// lavagna fuori dalle radici di lettura è `denied`, come una nota.
#[test]
fn senza_radici_di_scrittura_la_lavagna_si_legge_e_non_si_scrive() {
    let f = fixture();
    {
        let mut server = vault_writer(&f);
        board(&mut server);
    }
    let path = f.vault.join("Agente/piano.canvas");
    let written = std::fs::read_to_string(&path).unwrap();

    let mut server = Server::start(&f.vault, &f.config, &[]).initialized();
    server.ok("fub_canvas_read", json!({ "doc": "Agente/piano.canvas" }));
    server.ok("fub_canvas_guide", json!({}));
    let denied = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": "non json", "base": "x", "apply": true }),
    );
    assert!(denied.starts_with("denied:"), "{denied}");
    let denied = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Agente/piano.canvas", "ops": [{ "op": "vola" }], "base": "x" }),
    );
    assert!(denied.starts_with("denied:"), "{denied}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);
    // Il vault è di un server solo alla volta: questo si chiude prima del prossimo.
    drop(server);

    // Con la lettura che copre solo Agente, una lavagna in Note è negata.
    std::fs::write(f.vault.join("Note/tela.canvas"), EMPTY_CANVAS).unwrap();
    let mut narrow = Server::start(
        &f.vault,
        &f.config,
        &[("--automation-read-root", &f.vault.join("Agente"))],
    )
    .initialized();
    let denied = narrow.refused("fub_canvas_read", json!({ "doc": "Note/tela.canvas" }));
    assert!(denied.starts_with("denied:"), "{denied}");
    let denied = narrow.refused("fub_preview", json!({ "doc": "Note/tela.canvas" }));
    assert!(denied.starts_with("denied:"), "{denied}");
    narrow.ok("fub_canvas_read", json!({ "doc": "Agente/piano.canvas" }));
}

/// I rifiuti di `fub_canvas_create` e `fub_canvas_apply`: radici che non
/// coprono la cartella, una base vecchia, operazioni sbagliate, un documento
/// che non è una lavagna. Nessuno scrive un byte.
#[test]
fn le_lavagne_rifiutano_senza_scrivere() {
    let f = fixture();
    std::fs::write(f.vault.join("Note/tela.canvas"), EMPTY_CANVAS).unwrap();
    let mut server = writer(&f);

    // Le radici di scrittura non coprono Note.
    let denied = server.refused(
        "fub_canvas_create",
        json!({ "name": "piano", "folder": "Note" }),
    );
    assert!(denied.starts_with("denied:"), "{denied}");
    assert!(!f.vault.join("Note/piano.canvas").exists());
    let denied = server.refused("fub_canvas_create", json!({ "name": "Note/piano.canvas" }));
    assert!(denied.starts_with("denied:"), "{denied}");
    let note = server.ok("fub_read", json!({ "doc": "Note/tela.canvas" }));
    let denied = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Note/tela.canvas", "ops": [{ "op": "add_card", "node": { "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "x" } }], "base": note["revision"], "apply": true }),
    );
    assert!(denied.starts_with("denied:"), "{denied}");
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Note/tela.canvas")).unwrap(),
        EMPTY_CANVAS
    );

    // Un nome preso è un conflitto, non una sovrascrittura.
    let made = server.ok("fub_canvas_create", json!({ "name": "Agente/tela" }));
    assert_eq!(made["doc"], "Agente/tela.canvas");
    let taken = server.refused("fub_canvas_create", json!({ "name": "Agente/tela" }));
    assert!(taken.starts_with("conflict"), "{taken}");
    // Senza nome, il primo libero.
    let free = server.ok("fub_canvas_create", json!({ "folder": "Agente" }));
    assert!(
        free["doc"]
            .as_str()
            .is_some_and(|doc| doc.starts_with("Agente/") && doc.ends_with(".canvas")),
        "{free}"
    );

    let path = f.vault.join("Agente/tela.canvas");
    let card = json!([{ "op": "add_card", "node": { "id": "uno", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "x" } }]);
    let first = server.ok(
        "fub_canvas_apply",
        json!({ "doc": "Agente/tela.canvas", "ops": card, "base": made["revision"], "apply": true }),
    );
    let written = std::fs::read_to_string(&path).unwrap();
    // Una base vecchia è un conflitto, e la lavagna resta com'è.
    let stale = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Agente/tela.canvas", "ops": [{ "op": "remove", "ids": ["uno"] }], "base": made["revision"], "apply": true }),
    );
    assert!(stale.starts_with("conflict:"), "{stale}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);

    // Un testo che non è JSON, o un valore che non è una lista: argomenti
    // sbagliati, come prima del controllo.
    let base = first["revision"].clone();
    for ops in [
        json!("non json"),
        json!(3),
        json!({ "op": "remove", "ids": ["uno"] }),
    ] {
        let bad = server.refused(
            "fub_canvas_apply",
            json!({ "doc": "Agente/tela.canvas", "ops": ops, "base": base, "apply": true }),
        );
        assert!(bad.starts_with("bad_args:"), "{ops}: {bad}");
    }
    // Una lista che il controllo rifiuta: niente scrittura, e il primo problema
    // nel testo, tutti nel payload.
    for (ops, code) in [
        (json!([]), "invalid"),
        (json!([{ "op": "vola" }]), "unknown_op"),
        (
            json!([{ "op": "remove", "ids": ["nessuno"] }]),
            "unknown_edge",
        ),
    ] {
        let (text, data) = rejected(
            &mut server,
            json!({ "doc": "Agente/tela.canvas", "ops": ops, "base": base, "apply": true }),
        );
        assert!(text.starts_with("1 problema: niente è scritto"), "{text}");
        assert!(text.contains(code), "{text}");
        assert_eq!(data["written"], false);
        assert_eq!(data["ok"], false);
        assert_eq!(data["problems"][0]["code"], code, "{data}");
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);
    assert!(server
        .refused(
            "fub_canvas_apply",
            json!({ "doc": "Agente/tela.canvas", "base": base })
        )
        .contains("manca `ops`"));
    assert!(server
        .refused(
            "fub_canvas_apply",
            json!({ "doc": "Agente/tela.canvas", "ops": card })
        )
        .contains("manca `base`"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), written);

    // Una nota non è una lavagna.
    let bozza = server.ok("fub_read", json!({ "doc": "Agente/bozza.md" }));
    let not_canvas = server.refused(
        "fub_canvas_apply",
        json!({ "doc": "Agente/bozza.md", "ops": card, "base": bozza["revision"], "apply": true }),
    );
    assert!(not_canvas.starts_with("bad_args:"), "{not_canvas}");
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/bozza.md")).unwrap(),
        "# Bozza\n"
    );
}

// --- I file Craft (N7) ---

// Le app finte sono script `/bin/sh`: come i test Craft di `fub-host`, la
// sezione gira solo su unix.
#[cfg(unix)]
mod craft {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Un PNG minimo: firma, `IHDR` e `IEND`.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(b"IHDR");
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }

    fn base64(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
                if i <= chunk.len() {
                    out.push(ALPHABET[((n >> shift) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    /// Uno ZIP senza compressione, scritto a mano: la CLI non ha `zip`.
    fn stored_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data) in entries {
            let offset = out.len() as u32;
            let crc = crc32(data);
            let size = data.len() as u32;
            let common = |head: &mut Vec<u8>| {
                head.extend_from_slice(&0u16.to_le_bytes()); // flag
                head.extend_from_slice(&0u16.to_le_bytes()); // stored
                head.extend_from_slice(&0u16.to_le_bytes()); // ora
                head.extend_from_slice(&0x21u16.to_le_bytes()); // data
                head.extend_from_slice(&crc.to_le_bytes());
                head.extend_from_slice(&size.to_le_bytes());
                head.extend_from_slice(&size.to_le_bytes());
                head.extend_from_slice(&(name.len() as u16).to_le_bytes());
                head.extend_from_slice(&0u16.to_le_bytes()); // extra
            };
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&20u16.to_le_bytes());
            common(&mut out);
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(data);
            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            common(&mut central);
            central.extend_from_slice(&0u16.to_le_bytes()); // commento
            central.extend_from_slice(&0u16.to_le_bytes()); // disco
            central.extend_from_slice(&0u16.to_le_bytes()); // attributi interni
            central.extend_from_slice(&0u32.to_le_bytes()); // attributi esterni
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let start = out.len() as u32;
        let count = entries.len() as u16;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }

    /// Un `.vectorcraft`, con l'anteprima PNG in `/preview/data` se c'è.
    fn vectorcraft(title: &str, preview: Option<&[u8]>) -> Vec<u8> {
        let mut doc = json!({ "format_version": 4, "title": title, "layers": [] });
        if let Some(png) = preview {
            doc["preview"] = json!({ "data": base64(png) });
        }
        serde_json::to_vec(&doc).unwrap()
    }

    /// Un PNG di esattamente `len` byte: l'intestazione e poi zeri.
    fn png_of(len: usize) -> Vec<u8> {
        let mut out = png(64, 64);
        out.resize(len, 0);
        out
    }

    const MIB8: usize = 8 * 1024 * 1024;

    /// Uno script `/bin/sh` che conta le sue chiamate (`calls`) e scrive il suo
    /// pid (`pids`), nella sua cartella; poi esce. Fa le veci della CLI e
    /// dell'app di VectorCraft: nessun test avvia un'app vera.
    struct Script {
        dir: tempfile::TempDir,
        path: PathBuf,
    }

    impl Script {
        fn new(name: &str) -> Script {
            let dir = tempfile::Builder::new()
                .prefix("fub-craft-test-")
                .tempdir_in(env!("CARGO_TARGET_TMPDIR"))
                .unwrap();
            let path = dir.path().join(name);
            std::fs::write(
                &path,
                "#!/bin/sh\nd=$(dirname \"$0\")\necho $$ >> \"$d/pids\"\necho x >> \"$d/calls\"\n",
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            Script { dir, path }
        }

        fn calls(&self) -> usize {
            std::fs::read_to_string(self.dir.path().join("calls"))
                .map(|text| text.lines().count())
                .unwrap_or(0)
        }

        /// Nessun pid scritto è ancora vivo: `kill -0` non lo trova, o è uno
        /// zombie.
        fn all_gone(&self) {
            let pids = std::fs::read_to_string(self.dir.path().join("pids")).unwrap_or_default();
            for pid in pids.lines().map(str::trim).filter(|pid| !pid.is_empty()) {
                wait_for("lo script esce", || {
                    let alive = Command::new("kill")
                        .args(["-0", pid])
                        .stderr(Stdio::null())
                        .status()
                        .is_ok_and(|status| status.success());
                    let zombie = std::fs::read_to_string(format!("/proc/{pid}/stat"))
                        .map(|stat| {
                            stat.rsplit(')')
                                .next()
                                .is_some_and(|rest| rest.trim_start().starts_with('Z'))
                        })
                        .unwrap_or(true);
                    !alive || zombie
                });
            }
        }
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let start = std::time::Instant::now();
        while !done() {
            assert!(start.elapsed() < Duration::from_secs(10), "{what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Il vault di prova con i file Craft, le due app finte in
    /// `craft.editor-paths` (la finestra e la riga di comando di VectorCraft) e
    /// il consenso alle anteprime con la CLI acceso: se uno strumento la facesse
    /// partire, `cli.calls()` lo direbbe.
    struct Craft {
        f: Fixture,
        gui: Script,
        cli: Script,
        home: PathBuf,
    }

    fn craft(craft_on: bool) -> Craft {
        use fub_abi::settings::SettingValue;
        use fub_host::settings::{CRAFT_CLI_PREVIEWS, CRAFT_EDITOR_PATHS};
        let f = fixture();
        let disegni = f.vault.join("Disegni");
        std::fs::create_dir_all(&disegni).unwrap();
        std::fs::write(disegni.join("logo.vectorcraft"), vectorcraft("logo", None)).unwrap();
        std::fs::write(
            disegni.join("grande.vectorcraft"),
            vectorcraft("grande", Some(&png_of(MIB8))),
        )
        .unwrap();
        std::fs::write(
            disegni.join("troppo.vectorcraft"),
            vectorcraft("troppo", Some(&png_of(MIB8 + 1))),
        )
        .unwrap();
        let document = br#"{"format_version":1,"title":"Scheda"}"#;
        std::fs::write(
            disegni.join("scheda.figcraft"),
            stored_zip(&[("document.json", document), ("thumbnail.png", &png(40, 20))]),
        )
        .unwrap();
        std::fs::write(
            f.vault.join("Agente/bozza.vectorcraft"),
            vectorcraft("bozza", None),
        )
        .unwrap();
        std::fs::write(
            f.vault.join("Diario/segreto.vectorcraft"),
            vectorcraft("segreto", None),
        )
        .unwrap();
        let gui = Script::new("fub-craft-test-gui.sh");
        let cli = Script::new("fub-craft-test-cli.sh");
        // Le impostazioni di macchina si scrivono prima, con un Host nel test che
        // poi si chiude: il server MCP le legge dalla stessa `--config-dir`.
        {
            let config = camino::Utf8Path::from_path(&f.config).unwrap();
            let host = fub_host::Host::without_watcher().with_config_dir(config);
            let root = camino::Utf8Path::from_path(&f.vault).unwrap();
            host.open(root).unwrap();
            host.set_setting_for_user(
                Some(root.as_str()),
                CRAFT_EDITOR_PATHS,
                SettingValue::List(vec![
                    format!("vectorcraft={}", gui.path.display()),
                    format!("vectorcraft-cli={}", cli.path.display()),
                ]),
            )
            .unwrap();
            host.set_setting_for_user(
                Some(root.as_str()),
                CRAFT_CLI_PREVIEWS,
                SettingValue::Text("on".into()),
            )
            .unwrap();
            if !craft_on {
                host.set_plugin_enabled(Some(root.as_str()), "fub.craft", false)
                    .unwrap();
            }
        }
        let home = f.vault.parent().unwrap().join("casa");
        std::fs::create_dir_all(&home).unwrap();
        Craft { f, gui, cli, home }
    }

    impl Craft {
        /// Legge `Disegni` e `Agente`, scrive in `Agente`. `HOME`, i dati e il
        /// `PATH` del server sono del test: un'app Craft installata sulla macchina
        /// non entra.
        fn server(&self) -> Server {
            self.server_reading(&self.f.vault.join("Disegni"))
        }

        /// Come [`Craft::server`], con `read` come radice di lettura.
        fn server_reading(&self, read: &Path) -> Server {
            let agente = self.f.vault.join("Agente");
            Server::start_with(
                &self.f.vault,
                &self.f.config,
                &[
                    ("--automation-read-root", read),
                    ("--automation-write-root", &agente),
                ],
                &[
                    ("HOME", &self.home),
                    ("XDG_DATA_HOME", &self.home),
                    ("PATH", Path::new("/usr/bin:/bin")),
                ],
            )
            .initialized()
        }
    }

    /// La risposta intera di uno strumento che riesce: i contenuti e i dati.
    fn call_full(server: &mut Server, name: &str, arguments: Value) -> Value {
        let reply = server.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        let result = reply["result"].clone();
        assert_ne!(
            result["isError"], true,
            "{name}: {}",
            result["content"][0]["text"]
        );
        assert_eq!(
            serde_json::from_str::<Value>(result["content"][0]["text"].as_str().unwrap()).unwrap(),
            result["structuredContent"]
        );
        result
    }

    #[test]
    fn nessuno_strumento_chiede_un_anteprima_a_un_app() {
        let f = fixture();
        let mut server = Server::start(&f.vault, &f.config, &[]).initialized();
        let tools = server.request("tools/list", json!({}));
        for tool in tools["result"]["tools"].as_array().unwrap() {
            let text = tool.to_string();
            // Né `craft_render` né `craft.cli-previews`, né un argomento che li
            // chieda.
            assert!(!text.contains("render"), "{}", tool["name"]);
            assert!(!text.contains("cli-previews"), "{}", tool["name"]);
        }
        let preview = tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "fub_preview")
            .unwrap();
        assert_eq!(preview["annotations"]["readOnlyHint"], true);
        let props: Vec<&String> = preview["inputSchema"]["properties"]
            .as_object()
            .unwrap()
            .keys()
            .collect();
        assert_eq!(props, ["doc", "size"]);
    }

    #[test]
    fn le_app_craft_si_vedono_si_provano_e_si_aprono_solo_con_apply() {
        let k = craft(true);
        let mut server = k.server();
        let listed = server.ok(
            "fub_external_editors",
            json!({ "doc": "Disegni/logo.vectorcraft" }),
        );
        let items = listed["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "{listed}");
        assert_eq!(items[0]["id"], "vectorcraft");
        assert_eq!(items[0]["installed"], true);
        // Senza l'app aperta la CLI non vede niente in esecuzione.
        assert_eq!(items[0]["running"], false);

        // La prova dice che cosa farebbe, e non avvia niente.
        let dry = server.ok(
            "fub_open_with",
            json!({ "doc": "Disegni/logo.vectorcraft", "editor": "vectorcraft" }),
        );
        assert_eq!(dry["dry_run"], true);
        assert_eq!(dry["editor"], "vectorcraft");
        assert_eq!(dry["installed"], true);
        assert_eq!(dry["running"], false);
        assert_eq!(dry["how"], "new_process");
        // Un'app che Fub non conosce, o che non apre quel file.
        assert!(server
            .refused(
                "fub_open_with",
                json!({ "doc": "Disegni/logo.vectorcraft", "editor": "paintcraft" })
            )
            .starts_with("bad_args"));
        assert!(server
            .refused(
                "fub_open_with",
                json!({ "doc": "Disegni/logo.vectorcraft", "editor": "figcraft" })
            )
            .starts_with("bad_args"));
        assert!(server
            .refused(
                "fub_open_with",
                json!({ "doc": "Disegni/manca.vectorcraft", "editor": "vectorcraft" })
            )
            .starts_with("not_found"));
        assert!(server
            .refused(
                "fub_open_with",
                json!({ "doc": "Disegni/logo.vectorcraft", "editor": "vectorcraft", "page": 0 })
            )
            .contains("`page`"));
        // `apply` fuori dalle radici di scrittura: rifiutato, prima dell'app.
        let refused = server.refused(
            "fub_open_with",
            json!({ "doc": "Disegni/logo.vectorcraft", "editor": "vectorcraft", "apply": true }),
        );
        assert!(refused.starts_with("denied"), "{refused}");
        assert_eq!(k.gui.calls(), 0);

        // Fuori dalle radici di lettura non si vede neanche quali app ci sono.
        for (tool, args) in [
            (
                "fub_external_editors",
                json!({ "doc": "Diario/segreto.vectorcraft" }),
            ),
            (
                "fub_open_with",
                json!({ "doc": "Diario/segreto.vectorcraft", "editor": "vectorcraft" }),
            ),
            (
                "fub_preview",
                json!({ "doc": "Diario/segreto.vectorcraft" }),
            ),
        ] {
            let refused = server.refused(tool, args);
            assert!(refused.starts_with("denied"), "{tool}: {refused}");
        }

        // Dentro le radici di scrittura `apply` passa il file all'app.
        let opened = server.ok(
            "fub_open_with",
            json!({ "doc": "Agente/bozza.vectorcraft", "editor": "vectorcraft", "apply": true }),
        );
        assert_eq!(opened["dry_run"], false);
        assert_eq!(opened["how"], "new_process");
        wait_for("l'app finta parte", || k.gui.calls() == 1);
        k.gui.all_gone();
        assert_eq!(k.cli.calls(), 0);
    }

    #[test]
    fn fub_preview_porta_l_immagine_del_file_e_non_avvia_mai_un_app() {
        let k = craft(true);
        let mut server = k.server();

        // FigCraft con la miniatura: un contenuto immagine dopo il testo.
        let fig = call_full(
            &mut server,
            "fub_preview",
            json!({ "doc": "Disegni/scheda.figcraft" }),
        );
        let content = fig["content"].as_array().unwrap();
        assert_eq!(content.len(), 2, "{fig}");
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["mimeType"], "image/png");
        assert_eq!(content[1]["data"], base64(&png(40, 20)));
        let data = &fig["structuredContent"];
        assert_eq!(data["origin"], "file");
        assert_eq!(data["image"]["width"], 40);
        assert_eq!(data["image"]["height"], 20);
        // I byte stanno solo nel contenuto immagine.
        assert!(data["image"].get("data").is_none(), "{data}");
        assert!(data["info"].is_object());

        // VectorCraft senza anteprima: solo testo, `origin: "none"`.
        let bare = call_full(
            &mut server,
            "fub_preview",
            json!({ "doc": "Disegni/logo.vectorcraft", "size": "large" }),
        );
        assert_eq!(bare["content"].as_array().unwrap().len(), 1, "{bare}");
        let data = &bare["structuredContent"];
        assert_eq!(data["origin"], "none");
        assert_eq!(data["missing"], "absent");
        assert_eq!(data["image"], Value::Null);
        assert_eq!(data["size"], "large");

        // 8 MiB passano, e sono il tetto.
        let big = call_full(
            &mut server,
            "fub_preview",
            json!({ "doc": "Disegni/grande.vectorcraft" }),
        );
        let content = big["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(
            content[1]["data"].as_str().unwrap().len(),
            MIB8.div_ceil(3) * 4
        );
        assert_eq!(big["structuredContent"]["origin"], "file");
        let over = call_full(
            &mut server,
            "fub_preview",
            json!({ "doc": "Disegni/troppo.vectorcraft" }),
        );
        assert_eq!(over["content"].as_array().unwrap().len(), 1);
        // Un byte in più e l'anteprima non passa: il file resta senza immagine.
        assert_eq!(over["structuredContent"]["image"], Value::Null);

        assert!(server
            .refused(
                "fub_preview",
                json!({ "doc": "Disegni/logo.vectorcraft", "size": "huge" })
            )
            .starts_with("bad_args"));

        // Nessuna strada fa partire la CLI, neanche chiedendolo: il consenso è
        // acceso e il disegno non ha anteprima.
        server.ok(
            "fub_preview",
            json!({ "doc": "Disegni/logo.vectorcraft", "render": true }),
        );
        // `fub_invoke` vuole tutto il vault fra le radici di lettura.
        drop(server);
        let mut server = k.server_reading(&k.f.vault);
        for apply in [false, true] {
            let out = server.ok(
                "fub_invoke",
                json!({
                    "command": "craft.preview",
                    "args": { "doc": "Disegni/logo.vectorcraft", "render": true },
                    "apply": apply
                }),
            );
            assert!(!out.to_string().contains(r#""queued":true"#), "{out}");
        }
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(k.cli.calls(), 0);
        assert_eq!(k.gui.calls(), 0);
        k.cli.all_gone();
    }

    #[test]
    fn con_fub_craft_spento_niente_app_e_niente_anteprima() {
        let k = craft(false);
        let mut server = k.server();
        let listed = server.ok(
            "fub_external_editors",
            json!({ "doc": "Disegni/logo.vectorcraft" }),
        );
        assert_eq!(listed["items"], json!([]));
        let refused = server.refused(
            "fub_open_with",
            json!({ "doc": "Disegni/logo.vectorcraft", "editor": "vectorcraft" }),
        );
        assert!(refused.starts_with("unavailable"), "{refused}");
        let refused = server.refused("fub_preview", json!({ "doc": "Disegni/logo.vectorcraft" }));
        assert!(
            refused.starts_with("unavailable: craft.preview non c'è"),
            "{refused}"
        );
        assert_eq!(k.gui.calls() + k.cli.calls(), 0);
    }
}
