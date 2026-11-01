//! Server MCP sopra la stessa `Connection` dei comandi: stdio, JSON-RPC 2.0,
//! un messaggio per riga. Nessun runtime asincrono, come `fub-host`. Se l'app
//! desktop tiene il vault, `HostPort` inoltra le chiamate a lei come per gli
//! altri comandi.
//!
//! - **Il protocollo è piccolo e scritto qui**: inizializzazione, strumenti
//!   (`tools.rs`) e risorse, cioè le note del vault come
//!   `fub://open?note=…`. Le notifiche non hanno risposta.
//! - **Le radici** (`access.rs`) si risolvono una volta, all'avvio, sul
//!   vault aperto: ogni strumento e ogni risorsa passa da loro.
//! - **Niente segreti in uscita**: un messaggio d'errore passa da `redact`,
//!   e il server non scrive log. Su stderr va soltanto l'errore che lo ferma.

mod access;
mod tools;

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::commands::{doc_id, Connection, Failure};

pub use access::Access;

/// Le versioni del protocollo che il server parla, dalla più nuova. Si
/// risponde con quella del client se è fra queste, altrimenti con la prima.
const PROTOCOLS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// Quante note per pagina di `resources/list`.
const RESOURCES_PAGE: u32 = 100;

/// Che cosa dice `initialize` a chi legge: le regole che un agente deve
/// sapere prima della prima chiamata.
const INSTRUCTIONS: &str = "Il vault di Fub: note Markdown e altri file. Cerca con fub_search e fub_query, leggi con fub_read. Per cambiare una nota passa a fub_write la revisione letta: se nel frattempo è cambiata torna un conflitto, rileggi e riprova. Le note nuove si fanno con fub_create. fub_invoke senza apply mostra il piano, con \"apply\": true lo esegue. I componenti si vedono con fub_components e fub_components_why; fub_components_enable e fub_components_disable senza apply mostrano l'effetto, con \"apply\": true lo applicano, e vogliono una radice di scrittura. Si scrive soltanto sotto le radici di scrittura.";

/// Un errore JSON-RPC: il messaggio non è arrivato a uno strumento.
#[derive(Debug)]
pub struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    fn new(code: i64, message: &str) -> Self {
        RpcError {
            code,
            message: message.to_string(),
        }
    }
    pub fn invalid_params(message: &str) -> Self {
        Self::new(-32602, message)
    }
    fn from_failure(failure: &Failure) -> Self {
        // Le richieste sbagliate dicono `invalid params`; il resto è
        // dell'host, ed è un errore interno con il suo tipo nel messaggio.
        let code = if failure.kind == "bad_args" {
            -32602
        } else {
            -32603
        };
        Self::new(
            code,
            &format!(
                "{}: {}",
                failure.kind,
                crate::output::redact(&failure.message)
            ),
        )
    }
    fn json(&self) -> Value {
        json!({ "code": self.code, "message": self.message })
    }
}

/// Il ciclo: una riga, una risposta, finché stdin non chiude o arriva SIGINT.
pub fn serve(
    connection: &Connection,
    access: &Access,
    input: impl BufRead,
    mut output: impl Write,
) -> Result<(), Failure> {
    let io = |error: std::io::Error| Failure::local(format!("stdio: {error}"));
    for line in input.lines() {
        if crate::interrupted() {
            break;
        }
        let line = line.map_err(io)?;
        if line.trim().is_empty() {
            continue;
        }
        let Some(reply) = answer(connection, access, &line) else {
            continue;
        };
        writeln!(output, "{reply}").map_err(io)?;
        output.flush().map_err(io)?;
    }
    Ok(())
}

/// La risposta a una riga, o niente per una notifica.
fn answer(connection: &Connection, access: &Access, line: &str) -> Option<Value> {
    let reply = |id: Value, result: Result<Value, RpcError>| match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error.json() }),
    };
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => {
            return Some(reply(
                Value::Null,
                Err(RpcError::new(-32700, "JSON non valido")),
            ))
        }
    };
    let Some(object) = request.as_object() else {
        // Anche un lotto: la versione del 2025-06-18 lo ha tolto.
        return Some(reply(
            Value::Null,
            Err(RpcError::new(-32600, "una richiesta è un oggetto")),
        ));
    };
    let id = object.get("id").cloned();
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        // Una risposta del client (non ne chiediamo) o un oggetto senza metodo.
        return id.map(|id| reply(id, Err(RpcError::new(-32600, "manca `method`"))));
    };
    // Le notifiche (`notifications/initialized`, `…/cancelled`) non hanno
    // risposta; il server non ha niente da annullare, perché risponde in
    // ordine e una alla volta.
    let id = id?;
    let params = object.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::specs() })),
        "tools/call" => tools::call(connection, access, &params),
        "resources/list" => resources_list(connection, access, &params),
        "resources/read" => resources_read(connection, access, &params),
        other => Err(RpcError::new(
            -32601,
            &format!("metodo sconosciuto: {other}"),
        )),
    };
    Some(reply(id, result))
}

fn initialize(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str);
    let version = asked
        .filter(|v| PROTOCOLS.contains(v))
        .unwrap_or(PROTOCOLS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {}, "resources": {} },
        "serverInfo": { "name": "fub", "title": "Fub", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

/// I byte che restano nudi in un parametro dell'URI: i non riservati di RFC
/// 3986 e la barra dei path.
fn encode(doc: &str) -> String {
    let mut out = String::with_capacity(doc.len());
    for byte in doc.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn resource_uri(doc: &str) -> String {
    format!("fub://open?note={}", encode(doc))
}

fn mime_of(doc: &str) -> &'static str {
    match doc
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown") => "text/markdown",
        Some("canvas" | "base" | "json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("csv") => "text/csv",
        _ => "text/plain",
    }
}

fn resources_list(c: &Connection, access: &Access, params: &Value) -> Result<Value, RpcError> {
    let offset = match params.get("cursor") {
        None | Some(Value::Null) => 0,
        Some(Value::String(cursor)) => cursor
            .parse::<u32>()
            .map_err(|_| RpcError::invalid_params("`cursor` non valido"))?,
        Some(_) => return Err(RpcError::invalid_params("`cursor` è un testo")),
    };
    let args = json!({ "query": "", "limit": RESOURCES_PAGE, "offset": offset });
    let data = tools::call(
        c,
        access,
        &json!({ "name": "fub_search", "arguments": args }),
    )?;
    if data.get("isError") == Some(&Value::Bool(true)) {
        let text = data["content"][0]["text"].as_str().unwrap_or_default();
        return Err(RpcError::new(-32603, text));
    }
    let page = &data["structuredContent"];
    let resources: Vec<Value> = page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["doc"].as_str())
        .map(|doc| json!({ "uri": resource_uri(doc), "name": doc, "mimeType": mime_of(doc) }))
        .collect();
    let next = offset + resources.len() as u32;
    let mut result = json!({ "resources": resources });
    if !resources.is_empty() && u64::from(next) < page["total"].as_u64().unwrap_or(0) {
        result["nextCursor"] = json!(next.to_string());
    }
    Ok(result)
}

fn resources_read(c: &Connection, access: &Access, params: &Value) -> Result<Value, RpcError> {
    let uri = params
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::invalid_params("manca `uri`"))?;
    // Lo stesso parser degli URI di Fub: traversal e chiavi ignote rifiutati.
    let note = match fub_host::automation::parse_fub_uri(uri) {
        Ok(fub_host::automation::FubUri::Open {
            note: Some(note),
            vault: None,
            heading: None,
            block: None,
            split: None,
            window: None,
        }) => note,
        _ => {
            return Err(RpcError::invalid_params(
                "una risorsa di Fub è fub://open?note=…",
            ))
        }
    };
    let id = doc_id(&note).map_err(|failure| RpcError::from_failure(&failure))?;
    access
        .check_read(id.as_str())
        .map_err(|failure| RpcError::from_failure(&failure))?;
    let (text, _) = c
        .host
        .read_document(c.vault_selector(), &id)
        .map_err(|error| RpcError::from_failure(&Failure::from_plugin(&error)))?;
    Ok(json!({ "contents": [{ "uri": uri, "mimeType": mime_of(id.as_str()), "text": text }] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l_uri_di_una_nota_si_rilegge_uguale() {
        for doc in ["Note/idea.md", "Città e mare/a b&c=d?.md", "100%.md"] {
            let uri = resource_uri(doc);
            match fub_host::automation::parse_fub_uri(&uri).unwrap() {
                fub_host::automation::FubUri::Open { note, .. } => {
                    assert_eq!(note.as_deref(), Some(doc))
                }
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn la_versione_del_client_vince_se_la_si_parla() {
        assert_eq!(
            initialize(&json!({ "protocolVersion": "2025-06-18" }))["protocolVersion"],
            "2025-06-18"
        );
        assert_eq!(
            initialize(&json!({ "protocolVersion": "1999-01-01" }))["protocolVersion"],
            PROTOCOLS[0]
        );
    }
}
