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
        let mut command = Command::new(env!("CARGO_BIN_EXE_fub-cli"));
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
            "fub_write",
            "fub_create",
            "fub_commands",
            "fub_invoke"
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

    // Le risorse: le note come fub://open?note=…, a pagine.
    let list = server.request("resources/list", json!({}));
    let resources = list["result"]["resources"].as_array().unwrap();
    assert_eq!(resources.len(), 5);
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
        (
            "fub_invoke",
            json!({ "command": "note.create", "args": { "name": "Agente/nuova.md" }, "apply": true }),
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
    assert_eq!(
        std::fs::read_to_string(f.vault.join("Agente/bozza.md")).unwrap(),
        "# Bozza\n"
    );
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
