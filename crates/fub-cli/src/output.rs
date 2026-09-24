//! Output: envelope + sei formati, senza segreti.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputFormat {
    Text,
    Json,
    Jsonl,
    Tsv,
    Csv,
    Md,
}

impl OutputFormat {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.unwrap_or("text").trim().to_ascii_lowercase().as_str() {
            "json" => OutputFormat::Json,
            "jsonl" | "ndjson" => OutputFormat::Jsonl,
            "tsv" => OutputFormat::Tsv,
            "csv" => OutputFormat::Csv,
            "md" | "markdown" => OutputFormat::Md,
            _ => OutputFormat::Text,
        }
    }
    pub fn is_json(self) -> bool {
        matches!(self, OutputFormat::Json | OutputFormat::Jsonl)
    }
    pub fn is_human(self) -> bool {
        matches!(self, OutputFormat::Text | OutputFormat::Md)
    }
}

pub fn envelope_ok(data: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "ok": true, "data": data })
}

pub fn envelope_err(kind: &str, message: &str, code: i32) -> serde_json::Value {
    serde_json::json!({ "ok": false, "kind": kind, "message": redact(message), "code": code })
}

/// Redazione prima di stampare/loggare: le chiavi congelate con ServicesOwner.
pub fn redact(message: &str) -> String {
    // Chiavi semplici `k=v` / `k: v` con valore oscurato, senza toccare il resto.
    let mut out = message.to_string();
    for key in [
        "password",
        "token",
        "secret",
        "bearer",
        "wrap_b64",
        "ciphertext_b64",
        "nonce_b64",
    ] {
        out = redact_key(&out, key);
    }
    out
}

fn redact_key(message: &str, key: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let bytes = message.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes.len() - i >= key.len()
            && bytes[i..i + key.len()].eq_ignore_ascii_case(key.as_bytes())
        {
            let mut j = i + key.len();
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'=' || bytes[j] == b':') {
                j += 1;
                while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                    j += 1;
                }
                let quoted = j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'');
                let quote = if quoted { bytes[j] } else { 0 };
                if quoted {
                    j += 1;
                }
                let start = j;
                while j < bytes.len() {
                    if quoted {
                        if bytes[j] == quote {
                            break;
                        }
                    } else if bytes[j] == b' '
                        || bytes[j] == b'\t'
                        || bytes[j] == b'\n'
                        || bytes[j] == b','
                        || bytes[j] == b'}'
                    {
                        break;
                    }
                    j += 1;
                }
                out.push_str(&message[i..start]);
                out.push_str("[redacted]");
                i = j;
                continue;
            }
        }
        let ch = message[i..].chars().next().expect("valid UTF-8 boundary");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Chiavi da non mostrare mai in `config list` o diagnostica: valori oscurati.
pub fn redact_json_value(key: &str, value: serde_json::Value) -> serde_json::Value {
    let lower = key.to_ascii_lowercase();
    if [
        "password",
        "token",
        "secret",
        "bearer",
        "wrap_b64",
        "ciphertext_b64",
        "nonce_b64",
    ]
    .iter()
    .any(|k| lower.contains(k))
    {
        return serde_json::Value::String("[redacted]".to_string());
    }
    value
}

pub fn render(format: &OutputFormat, value: &serde_json::Value, color: bool) -> String {
    match format {
        OutputFormat::Json => {
            serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string())
        }
        OutputFormat::Jsonl => serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()),
        OutputFormat::Text => render_text(value, color),
        OutputFormat::Md => render_md(value),
        OutputFormat::Tsv => render_table(value, '\t'),
        OutputFormat::Csv => render_table(value, ','),
    }
}

fn render_text(value: &serde_json::Value, color: bool) -> String {
    if let Some(obj) = value.as_object() {
        if obj.get("ok") == Some(&serde_json::Value::Bool(false)) {
            let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("error");
            let message = obj.get("message").and_then(|v| v.as_str()).unwrap_or("");
            let code = obj.get("code").and_then(|v| v.as_i64()).unwrap_or(1);
            if color {
                return format!("\u{1b}[31merror[{kind}/{code}]\u{1b}[0m {message}");
            }
            return format!("error[{kind}/{code}]: {message}");
        }
        if let Some(data) = obj.get("data") {
            return render_data_text(data, color, 0);
        }
    }
    render_data_text(value, color, 0)
}

fn render_data_text(value: &serde_json::Value, _color: bool, indent: usize) -> String {
    let pad = "  ".repeat(indent);
    match value {
        serde_json::Value::Null => format!("{pad}—"),
        serde_json::Value::Bool(b) => format!("{pad}{b}"),
        serde_json::Value::Number(n) => format!("{pad}{n}"),
        serde_json::Value::String(s) => format!("{pad}{s}"),
        serde_json::Value::Array(items) => {
            if items.is_empty() {
                return format!("{pad}(vuoto)");
            }
            items
                .iter()
                .map(|item| match item {
                    serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                        render_data_text(item, _color, indent)
                    }
                    _ => format!("{pad}- {}", render_inline(item)),
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| match v {
                serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                    format!("{pad}{k}:\n{}", render_data_text(v, _color, indent + 1))
                }
                _ => format!("{pad}{k}: {}", render_inline(v)),
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn render_inline(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "—".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn render_md(value: &serde_json::Value) -> String {
    if let Some(obj) = value.as_object() {
        if let Some(data) = obj.get("data") {
            return render_md_data(data);
        }
    }
    render_md_data(value)
}

fn render_md_data(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Array(items) => {
            if items.is_empty() {
                return "(vuoto)".to_string();
            }
            items
                .iter()
                .map(|i| format!("- {}", render_inline(i)))
                .collect::<Vec<_>>()
                .join("\n")
        }
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| format!("- **{k}**: {}", render_inline(v)))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => render_inline(value),
    }
}

fn table_rows(value: &serde_json::Value) -> (Vec<String>, Vec<Vec<String>>) {
    // data | data.items | data.rows | riga singola.
    let rows_value = if let Some(obj) = value.as_object() {
        if let Some(data) = obj.get("data") {
            if let Some(data_obj) = data.as_object() {
                if let Some(items) = data_obj.get("items").or_else(|| data_obj.get("rows")) {
                    items
                } else {
                    data
                }
            } else {
                data
            }
        } else {
            value
        }
    } else {
        value
    };
    match rows_value {
        serde_json::Value::Array(items) => {
            let mut headers: Vec<String> = Vec::new();
            let mut rows: Vec<Vec<String>> = Vec::new();
            for item in items {
                match item {
                    serde_json::Value::Object(map) => {
                        for k in map.keys() {
                            if !headers.contains(k) {
                                headers.push(k.clone());
                            }
                        }
                    }
                    _ => {
                        if headers.is_empty() {
                            headers.push("value".to_string());
                        }
                    }
                }
            }
            for item in items {
                match item {
                    serde_json::Value::Object(map) => {
                        rows.push(
                            headers
                                .iter()
                                .map(|h| map.get(h).map(render_cell).unwrap_or_default())
                                .collect(),
                        );
                    }
                    _ => rows.push(vec![render_cell(item)]),
                }
            }
            (headers, rows)
        }
        serde_json::Value::Object(map) => {
            let headers = vec!["key".to_string(), "value".to_string()];
            let rows = map
                .iter()
                .map(|(k, v)| vec![k.clone(), render_cell(v)])
                .collect();
            (headers, rows)
        }
        _ => (
            vec!["value".to_string()],
            vec![vec![render_cell(rows_value)]],
        ),
    }
}

fn render_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.replace('\n', " "),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn escape_csv(cell: &str, sep: char) -> String {
    if cell.contains(sep) || cell.contains('"') || cell.contains('\n') {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell.to_string()
    }
}

fn render_table(value: &serde_json::Value, sep: char) -> String {
    let (headers, rows) = table_rows(value);
    let mut out = Vec::new();
    out.push(
        headers
            .iter()
            .map(|h| escape_csv(h, sep))
            .collect::<Vec<_>>()
            .join(&sep.to_string()),
    );
    for row in rows {
        out.push(
            row.iter()
                .map(|c| escape_csv(c, sep))
                .collect::<Vec<_>>()
                .join(&sep.to_string()),
        );
    }
    out.join("\n")
}
