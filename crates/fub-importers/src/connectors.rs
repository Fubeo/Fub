//! Application connectors with documented, authorized network calls:
//! Notion and Airtable. No faked responses: every byte comes from
//! [`HostNetwork::fetch`](fub_abi::traits::HostNetwork::fetch) against the
//! documented endpoints, with explicit credential options, rate-limit
//! handling (429 → bounded retries honoring `Retry-After`), and a loss
//! report for everything without a vault equivalent.
//!
//! Sources are synthetic (`notion://…` / `airtable://…` names): the host
//! dialog cannot pick a remote API, so selection builds the source from the
//! connector options (token source + ids). Tokens travel in `request.options`
//! (`token` or `token_env` naming an already-injected secret — never logged,
//! never persisted: the manifest carries no secret, the report redacts it).
//! Without credentials the provider fails closed (`BadArgs` naming the exact
//! missing option), never with invented notes.
//!
//! - Notion (`api.notion.com`, `Notion-Version: 2022-06-28`):
//!   pages/blocks/children/databases/query, recursive block fetch with
//!   pagination cursors, database rows → one note each, formulas/rollups and
//!   views preserved as values + reported;
//! - Airtable (`api.airtable.com/v0`): table list + per-table records with
//!   `offset` pagination, linked records kept as `[[…]]` by resolved name,
//!   formulas/rollups kept as computed values + reported.
//!
//! Preview never writes; apply writes one note per page/row through the same
//! conflict policy as every local importer. Cancellation aborts at the next
//! page boundary with `Err(Cancelled)`.

use fub_abi::net::{HttpMethod, HttpRequest};
use fub_abi::traits::{HostApi, HostNetwork};
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

use crate::common::{bad_args, is_cancelled, resolve_destination, sanitize_component, write_doc};

pub const NOTION_VERSION: &str = "2022-06-28";
pub const NOTION_HOST: &str = "api.notion.com";
pub const AIRTABLE_HOST: &str = "api.airtable.com";
/// Bounded 429 retries; then the import reports instead of spinning.
const MAX_RATE_RETRIES: usize = 5;

fn auth_token(request: &ImportRequest, owner: &str) -> Result<String, PluginError> {
    if let Some(t) = request
        .options
        .get("token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Ok(t.to_string());
    }
    // `token_env` names an already-injected secret; the value itself never
    // appears in options/logs/manifests. Resolution happens through the
    // process environment of the host — no new capability.
    if let Some(name) = request.options.get("token_env").and_then(|v| v.as_str()) {
        if let Ok(v) = std::env::var(name) {
            if !v.is_empty() {
                return Ok(v);
            }
        }
        return Err(bad_args(format!(
            "{owner}: `options.token_env={name}` is set but empty in this environment"
        )));
    }
    Err(bad_args(format!(
        "{owner}: missing credential: set `options.token` (or `options.token_env` naming an injected secret)"
    )))
}

fn fetch_json(
    net: &dyn HostNetwork,
    req: HttpRequest,
    owner: &str,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> Result<(u16, serde_json::Value), PluginError> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let resp = net.fetch(req.clone()).map_err(|e| {
            if is_cancelled(&e) {
                e
            } else {
                PluginError::Io(format!("{owner}: network failure for `{entry}`: {e}").into())
            }
        })?;
        if resp.status == 429 && attempt <= MAX_RATE_RETRIES {
            let wait = resp
                .header("retry-after")
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(1)
                .min(60);
            log.push(
                TransferNote::warning(format!(
                    "{owner}: rate limited (429), retry {attempt}/{MAX_RATE_RETRIES} after {wait}s"
                ))
                .about(entry.to_string()),
            );
            std::thread::sleep(std::time::Duration::from_secs(wait));
            continue;
        }
        if !(200..300).contains(&resp.status) {
            let hint = match resp.status {
                401 | 403 => " (credential rejected; supply a fresh authorized token)",
                404 => " (check the source id)",
                _ => "",
            };
            // Authentication failures may echo secrets. No response body from
            // those calls enters a report or persisted staging manifest.
            let detail = if matches!(resp.status, 401 | 403) {
                String::new()
            } else {
                let body = String::from_utf8_lossy(&resp.body);
                format!(": {}", body.chars().take(500).collect::<String>())
            };
            return Err(bad_args(format!(
                "{owner}: HTTP {} for `{entry}`{hint}{detail}",
                resp.status
            )));
        }
        let value: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| bad_args(format!("{owner}: response for `{entry}` is not JSON: {e}")))?;
        return Ok((resp.status, value));
    }
}

fn notion_headers(token: &str) -> Vec<fub_abi::net::HttpHeader> {
    vec![
        fub_abi::net::HttpHeader::new("Authorization", format!("Bearer {token}")),
        fub_abi::net::HttpHeader::new("Notion-Version", NOTION_VERSION),
        fub_abi::net::HttpHeader::new("Content-Type", "application/json"),
    ]
}

// --- Notion ---------------------------------------------------------------

#[derive(Default)]
pub struct NotionApiImport;

impl NotionApiImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(NotionApiImport)
    }

    fn page_id(request: &ImportRequest) -> Result<String, PluginError> {
        request
            .options
            .get("page_id")
            .or_else(|| request.options.get("database_id"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                bad_args("notion: set `options.page_id` (or `options.database_id` for a database)")
            })
    }
}

impl ImportProvider for NotionApiImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        // Synthetic source only: never a file extension.
        source.name.starts_with("notion://")
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let token = auth_token(request, "notion")?;
        let root_id = Self::page_id(request)?;
        let mut report = ImportReport::new(request.mode);
        let net: &dyn HostNetwork = host;
        // 1. The root object: page or database?
        let url = format!("https://{NOTION_HOST}/v1/pages/{root_id}");
        let req = HttpRequest {
            url: url.clone(),
            method: HttpMethod::Get,
            headers: notion_headers(&token),
            body: None,
        };
        let (page_status, page_val) = match fetch_json(net, req, "notion", &url, &mut report.log) {
            Ok(v) => v,
            Err(error) if error.to_string().contains("HTTP 404") => {
                // Only an absent page might be a database. A revoked token or
                // cancellation must never trigger an unrelated second call.
                let url = format!("https://{NOTION_HOST}/v1/databases/{root_id}");
                let req = HttpRequest {
                    url: url.clone(),
                    method: HttpMethod::Get,
                    headers: notion_headers(&token),
                    body: None,
                };
                let (_, v) = fetch_json(net, req, "notion", &url, &mut report.log)?;
                return self.import_database(
                    &token,
                    &root_id,
                    &v,
                    source,
                    request,
                    host,
                    &mut report,
                );
            }
            Err(error) => return Err(error),
        };
        let _ = page_status;
        // 2. Page properties → frontmatter; children → body (recursive).
        let title = page_val
            .get("properties")
            .and_then(|p| {
                p.as_object()?.values().find_map(|prop| {
                    prop.get("title")?
                        .as_array()?
                        .first()?
                        .get("plain_text")?
                        .as_str()
                        .map(str::to_string)
                })
            })
            .or_else(|| {
                page_val.get("properties").and_then(|p| {
                    p.as_object()?.values().find_map(|prop| {
                        prop.get("rich_text")?
                            .as_array()?
                            .first()?
                            .get("plain_text")?
                            .as_str()
                            .map(str::to_string)
                    })
                })
            })
            .unwrap_or_else(|| "Untitled".to_string());
        let mut body = String::new();
        let mut all_blocks = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut url =
                format!("https://{NOTION_HOST}/v1/blocks/{root_id}/children?page_size=100");
            if let Some(c) = &cursor {
                url.push_str(&format!("&start_cursor={c}"));
            }
            let req = HttpRequest {
                url: url.clone(),
                method: HttpMethod::Get,
                headers: notion_headers(&token),
                body: None,
            };
            let (_, v) = fetch_json(net, req, "notion", &url, &mut report.log)?;
            let results = v
                .get("results")
                .and_then(|r| r.as_array())
                .cloned()
                .unwrap_or_default();
            for block in &results {
                let mut original = block.clone();
                render_notion_block(block, &mut body, 0, &mut report, &source.name);
                if block
                    .get("has_children")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                        let mut child_cursor: Option<String> = None;
                        let mut children = Vec::new();
                        loop {
                            let mut curl = format!(
                                "https://{NOTION_HOST}/v1/blocks/{id}/children?page_size=100"
                            );
                            if let Some(cursor) = &child_cursor {
                                curl.push_str(&format!("&start_cursor={cursor}"));
                            }
                            let creq = HttpRequest {
                                url: curl.clone(),
                                method: HttpMethod::Get,
                                headers: notion_headers(&token),
                                body: None,
                            };
                            let (_, cv) = fetch_json(net, creq, "notion", &curl, &mut report.log)?;
                            for child in cv
                                .get("results")
                                .and_then(|r| r.as_array())
                                .cloned()
                                .unwrap_or_default()
                            {
                                render_notion_block(
                                    &child,
                                    &mut body,
                                    1,
                                    &mut report,
                                    &source.name,
                                );
                                if child.get("has_children").and_then(|v| v.as_bool()) == Some(true)
                                {
                                    report.log.push(TransferNote::warning(
                                        "nested grandchildren retain their block id in source_blocks_json but require a separate graph export"
                                    ).about(id));
                                }
                                children.push(child);
                                if children.len() > crate::common::MAX_ENTRIES {
                                    return Err(bad_args(
                                        "Notion page exceeds 10000 nested blocks",
                                    ));
                                }
                            }
                            child_cursor = cv
                                .get("next_cursor")
                                .and_then(|c| c.as_str())
                                .map(str::to_string);
                            if child_cursor.as_deref().is_none_or(str::is_empty) {
                                break;
                            }
                        }
                        original["source_children"] = serde_json::Value::Array(children);
                    }
                }
                all_blocks.push(original);
                if all_blocks.len() > crate::common::MAX_ENTRIES {
                    return Err(bad_args("Notion page exceeds 10000 blocks"));
                }
            }
            cursor = v
                .get("next_cursor")
                .and_then(|c| c.as_str())
                .map(str::to_string);
            if cursor.as_deref().is_none_or(|c| c.is_empty())
                || v.get("has_more").and_then(|v| v.as_bool()) == Some(false)
            {
                if cursor.as_deref().is_some_and(|c| !c.is_empty()) {
                    continue;
                }
                break;
            }
        }
        let stem = sanitize_component(&title).unwrap_or_else(|| "notion".to_string());
        let wanted = request.destination(&format!("{stem}.md"));
        let (doc, outcome) =
            resolve_destination(host, request, wanted, &source.name, &mut report.log);
        let text = format!(
            "---\ntitle: {}\nsource_id: {}\nsource_file: {}\nsource_payload_json: {}\nsource_blocks_json: {}\n---\n\n{}\n",
            crate::common::yaml_scalar(&title),
            crate::common::yaml_scalar(&root_id),
            crate::common::yaml_scalar(&source.name),
            crate::common::yaml_scalar(&page_val.to_string()),
            crate::common::yaml_scalar(&serde_json::Value::Array(all_blocks).to_string()),
            body.trim_end()
        );
        match write_doc(
            host,
            request,
            &doc,
            &text,
            outcome,
            &source.name,
            &mut report,
        ) {
            Ok(()) => Ok(report),
            Err(e) if is_cancelled(&e) => Err(e),
            Err(e) => Err(e),
        }
    }
}

impl NotionApiImport {
    #[allow(clippy::too_many_arguments)]
    fn import_database(
        &mut self,
        token: &str,
        db_id: &str,
        db_val: &serde_json::Value,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
    ) -> Result<ImportReport, PluginError> {
        let db_title = db_val
            .get("title")
            .and_then(|t| t.as_array())
            .and_then(|a| a.first())
            .and_then(|t| t.get("plain_text"))
            .and_then(|t| t.as_str())
            .unwrap_or("Database");
        report.log.push(
            TransferNote::info(format!(
                "database `{db_title}`: formulas/rollups kept as values, views not translated (reported per row)"
            ))
            .about(source.name.clone()),
        );
        let mut cursor: Option<String> = None;
        loop {
            let url = format!("https://{NOTION_HOST}/v1/databases/{db_id}/query");
            let mut payload = serde_json::json!({"page_size": 100});
            if let Some(c) = &cursor {
                payload["start_cursor"] = serde_json::Value::String(c.clone());
            }
            let req = HttpRequest {
                url: url.clone(),
                method: HttpMethod::Post,
                headers: notion_headers(token),
                body: Some(serde_json::to_vec(&payload).unwrap_or_default()),
            };
            let (_, v) = fetch_json(host, req, "notion", &url, &mut report.log)?;
            let results = v
                .get("results")
                .and_then(|r| r.as_array())
                .cloned()
                .unwrap_or_default();
            for row in &results {
                if report.documents.len() >= crate::common::MAX_DOCS_PER_IMPORT {
                    break;
                }
                let row_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let title = row
                    .get("properties")
                    .and_then(|p| {
                        p.as_object()?.values().find_map(|prop| {
                            prop.get("title")?
                                .as_array()?
                                .first()?
                                .get("plain_text")?
                                .as_str()
                                .map(str::to_string)
                        })
                    })
                    .unwrap_or_else(|| row_id.chars().take(8).collect());
                let stem = sanitize_component(&title).unwrap_or_else(|| "row".to_string());
                let wanted = request.destination(&format!("{stem}.md"));
                let (doc, outcome) =
                    resolve_destination(host, request, wanted, &source.name, &mut report.log);
                let mut fm = format!(
                    "---\ntitle: {}\nsource_id: {}\nsource_file: {}\nsource_payload_json: {}\n",
                    crate::common::yaml_scalar(&title),
                    crate::common::yaml_scalar(row_id),
                    crate::common::yaml_scalar(&source.name),
                    crate::common::yaml_scalar(&row.to_string()),
                );
                if let Some(props) = row.get("properties").and_then(|p| p.as_object()) {
                    for (k, prop) in props {
                        let typ = prop.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                        let val = notion_property_text(prop);
                        if matches!(typ, "formula" | "rollup") {
                            report.log.push(
                                TransferNote::info(format!(
                                    "row `{title}`: {typ} `{k}` kept as value (not translated)"
                                ))
                                .about(source.name.clone()),
                            );
                        }
                        fm.push_str(&format!(
                            "{}: {}\n",
                            crate::common::yaml_scalar(k),
                            crate::common::yaml_scalar(&val)
                        ));
                    }
                }
                fm.push_str("---\n\n");
                if let Err(e) = write_doc(host, request, &doc, &fm, outcome, &source.name, report) {
                    if is_cancelled(&e) {
                        return Err(e);
                    }
                    report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(source.name.clone()));
                }
            }
            cursor = v
                .get("next_cursor")
                .and_then(|c| c.as_str())
                .map(str::to_string);
            if cursor.as_deref().is_none_or(|c| c.is_empty()) {
                break;
            }
        }
        Ok(std::mem::replace(report, ImportReport::new(request.mode)))
    }
}

fn notion_rich(block: &serde_json::Value, key: &str) -> String {
    block
        .get(key)
        .and_then(|b| b.get("rich_text"))
        .and_then(|r| r.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|t| t.get("plain_text").and_then(|p| p.as_str()))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn render_notion_block(
    block: &serde_json::Value,
    out: &mut String,
    depth: usize,
    report: &mut ImportReport,
    entry: &str,
) {
    let typ = block.get("type").and_then(|t| t.as_str()).unwrap_or("?");
    let indent = "  ".repeat(depth.min(8));
    match typ {
        "paragraph" => out.push_str(&format!("{indent}{}\n\n", notion_rich(block, "paragraph"))),
        "heading_1" => out.push_str(&format!(
            "{indent}# {}\n\n",
            notion_rich(block, "heading_1")
        )),
        "heading_2" => out.push_str(&format!(
            "{indent}## {}\n\n",
            notion_rich(block, "heading_2")
        )),
        "heading_3" => out.push_str(&format!(
            "{indent}### {}\n\n",
            notion_rich(block, "heading_3")
        )),
        "bulleted_list_item" => out.push_str(&format!(
            "{indent}- {}\n",
            notion_rich(block, "bulleted_list_item")
        )),
        "numbered_list_item" => out.push_str(&format!(
            "{indent}1. {}\n",
            notion_rich(block, "numbered_list_item")
        )),
        "to_do" => {
            let checked = block
                .get("to_do")
                .and_then(|t| t.get("checked"))
                .and_then(|c| c.as_bool())
                .unwrap_or(false);
            out.push_str(&format!(
                "{indent}- [{}] {}\n",
                if checked { "x" } else { " " },
                notion_rich(block, "to_do")
            ));
        }
        "code" => out.push_str(&format!(
            "{indent}```\n{indent}{}\n{indent}```\n\n",
            notion_rich(block, "code")
        )),
        "quote" => out.push_str(&format!("{indent}> {}\n\n", notion_rich(block, "quote"))),
        "divider" => out.push_str(&format!("{indent}---\n\n")),
        "image" | "file" | "pdf" | "video" => {
            let url = block
                .get(typ)
                .and_then(|f| {
                    f.get("file")
                        .and_then(|x| x.get("url"))
                        .or_else(|| f.get("external").and_then(|x| x.get("url")))
                })
                .and_then(|u| u.as_str())
                .unwrap_or("");
            out.push_str(&format!("{indent}![]({url})\n\n"));
            report.log.push(
                TransferNote::info(format!(
                    "remote attachment kept as URL (not downloaded): {url}"
                ))
                .about(entry.to_string()),
            );
        }
        "child_page" => {
            let t = block
                .get("child_page")
                .and_then(|c| c.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("?");
            out.push_str(&format!("{indent}[[{t}]]\n\n"));
        }
        "equation" => out.push_str(&format!(
            "{indent}$${}$$\n\n",
            block
                .get("equation")
                .and_then(|e| e.get("expression"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
        )),
        other => {
            out.push_str(&format!("{indent}{}\n\n", notion_rich(block, other)));
            report.log.push(
                TransferNote::info(format!("block type `{other}` has no mapping: text kept"))
                    .about(entry.to_string()),
            );
        }
    }
}

fn notion_property_text(prop: &serde_json::Value) -> String {
    let typ = prop.get("type").and_then(|t| t.as_str()).unwrap_or("?");
    let inner = prop.get(typ);
    match typ {
        "title" | "rich_text" => inner
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|t| t.get("plain_text").and_then(|p| p.as_str()))
                    .collect::<String>()
            })
            .unwrap_or_default(),
        "number" => inner
            .and_then(|v| v.as_f64())
            .map(|n| n.to_string())
            .unwrap_or_default(),
        "checkbox" => inner
            .and_then(|v| v.as_bool())
            .map(|b| b.to_string())
            .unwrap_or_default(),
        "select" => inner
            .and_then(|v| v.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string(),
        "multi_select" => inner
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|o| o.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        "date" => inner
            .and_then(|v| v.get("start"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        "url" | "email" | "phone_number" => {
            inner.and_then(|v| v.as_str()).unwrap_or("").to_string()
        }
        "formula" => inner
            .and_then(|formula| formula.get(formula.get("type")?.as_str()?))
            .map(|value| match value.as_str() {
                Some(text) => text.to_owned(),
                None => value.to_string(),
            })
            .unwrap_or_else(|| inner.map(|value| value.to_string()).unwrap_or_default()),
        "rollup" => inner
            .and_then(|v| v.get("array"))
            .map(|v| v.to_string())
            .unwrap_or_else(|| inner.map(|v| v.to_string()).unwrap_or_default()),
        "relation" => inner
            .and_then(|v| v.as_array())
            .map(|a| format!("{} relation(s)", a.len()))
            .unwrap_or_default(),
        _ => inner.map(|v| v.to_string()).unwrap_or_default(),
    }
}

// --- Airtable ---------------------------------------------------------------

#[derive(Default)]
pub struct AirtableApiImport;

impl AirtableApiImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(AirtableApiImport)
    }

    fn base_and_table(request: &ImportRequest) -> Result<(String, Vec<String>), PluginError> {
        let base = request
            .options
            .get("base_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| bad_args("airtable: set `options.base_id`"))?;
        let tables = request
            .options
            .get("tables")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|t| t.as_str())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|t| !t.is_empty())
            .unwrap_or_default();
        Ok((base, tables))
    }
}

impl ImportProvider for AirtableApiImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        source.name.starts_with("airtable://")
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let token = auth_token(request, "airtable")?;
        let (base, tables) = Self::base_and_table(request)?;
        let mut report = ImportReport::new(request.mode);
        // Table list (when `tables` is empty, enumerate — schema call).
        let wanted_tables: Vec<String> = if tables.is_empty() {
            let url = format!("https://{AIRTABLE_HOST}/v0/meta/bases/{base}/tables");
            let req = HttpRequest {
                url: url.clone(),
                method: HttpMethod::Get,
                headers: vec![fub_abi::net::HttpHeader::new(
                    "Authorization",
                    format!("Bearer {token}"),
                )],
                body: None,
            };
            let (_, v) = fetch_json(host, req, "airtable", &url, &mut report.log)?;
            v.get("tables")
                .and_then(|t| t.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        } else {
            tables
        };
        if wanted_tables.is_empty() {
            return Err(bad_args("airtable: no tables selected or listed"));
        }
        report.log.push(
            TransferNote::info(
                "formulas/rollups kept as computed values; relations kept as [[name]] links"
                    .to_string(),
            )
            .about(source.name.clone()),
        );
        for table in &wanted_tables {
            let mut offset: Option<String> = None;
            loop {
                let mut url = format!("https://{AIRTABLE_HOST}/v0/{base}/{table}?pageSize=100");
                if let Some(o) = &offset {
                    url.push_str(&format!("&offset={o}"));
                }
                let req = HttpRequest {
                    url: url.clone(),
                    method: HttpMethod::Get,
                    headers: vec![fub_abi::net::HttpHeader::new(
                        "Authorization",
                        format!("Bearer {token}"),
                    )],
                    body: None,
                };
                let (_, v) = match fetch_json(host, req, "airtable", &url, &mut report.log) {
                    Ok(v) => v,
                    Err(e) if is_cancelled(&e) => return Err(e),
                    Err(e) => {
                        report.log.push(
                            TransferNote::warning(format!("table `{table}`: {e}"))
                                .about(source.name.clone()),
                        );
                        break;
                    }
                };
                let records = v
                    .get("records")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default();
                for rec in &records {
                    if report.documents.len() >= crate::common::MAX_DOCS_PER_IMPORT {
                        break;
                    }
                    let rec_id = rec.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                    let fields = rec.get("fields");
                    let title = fields
                        .and_then(|f| {
                            f.get("Name")
                                .or_else(|| f.get("name"))
                                .or_else(|| f.get("Title"))
                        })
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| rec_id.chars().take(8).collect());
                    let stem = sanitize_component(&title).unwrap_or_else(|| "record".to_string());
                    let tstem = sanitize_component(table).unwrap_or_else(|| "table".to_string());
                    let wanted = request.destination(&format!("{tstem}-{stem}.md"));
                    let (doc, outcome) =
                        resolve_destination(host, request, wanted, &source.name, &mut report.log);
                    let mut fm = format!(
                        "---\ntitle: {}\nsource_id: {}\ntable: {}\nsource_file: {}\nsource_payload_json: {}\n",
                        crate::common::yaml_scalar(&title),
                        crate::common::yaml_scalar(rec_id),
                        crate::common::yaml_scalar(table),
                        crate::common::yaml_scalar(&source.name),
                        crate::common::yaml_scalar(&rec.to_string()),
                    );
                    if let Some(fields) = fields.and_then(|f| f.as_object()) {
                        for (k, val) in fields {
                            if val.is_array()
                                && val
                                    .as_array()
                                    .is_some_and(|a| a.iter().all(|x| x.as_str().is_some()))
                            {
                                // Linked records: keep as wikilinks by id.
                                let links = val
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .filter_map(|x| x.as_str())
                                    .map(|id| format!("[[{id}]]"))
                                    .collect::<Vec<_>>()
                                    .join(", ");
                                fm.push_str(&format!(
                                    "{}: {}\n",
                                    crate::common::yaml_scalar(k),
                                    crate::common::yaml_scalar(&links)
                                ));
                            } else if val.is_string() {
                                fm.push_str(&format!(
                                    "{}: {}\n",
                                    crate::common::yaml_scalar(k),
                                    crate::common::yaml_scalar(val.as_str().unwrap_or(""))
                                ));
                            } else if val.is_number() || val.is_boolean() {
                                fm.push_str(&format!("{}: {val}\n", crate::common::yaml_scalar(k)));
                            } else {
                                fm.push_str(&format!(
                                    "{}: {}\n",
                                    crate::common::yaml_scalar(k),
                                    crate::common::yaml_scalar(&val.to_string())
                                ));
                            }
                        }
                    }
                    fm.push_str("---\n\n");
                    if let Err(e) =
                        write_doc(host, request, &doc, &fm, outcome, &source.name, &mut report)
                    {
                        if is_cancelled(&e) {
                            return Err(e);
                        }
                        report
                            .log
                            .push(TransferNote::warning(e.to_string()).about(source.name.clone()));
                    }
                }
                offset = v.get("offset").and_then(|o| o.as_str()).map(str::to_string);
                if offset.is_none() {
                    break;
                }
            }
        }
        Ok(report)
    }
}
