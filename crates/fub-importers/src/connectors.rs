//! Application connectors with documented, authorized network calls:
//! Notion and Airtable. No faked responses: every byte comes from
//! [`HostNetwork::fetch`](fub_abi::traits::HostNetwork::fetch) against the
//! documented endpoints, with explicit credential options, rate-limit
//! handling (429 → bounded retries honoring `Retry-After`), and a loss
//! report for everything without a vault equivalent.
//!
//! Sources are synthetic (`notion://…` / `airtable://…` names): the host
//! dialog cannot pick a remote API, so selection builds the source from the
//! connector options (ids). The token comes, in order, from `options.token`
//! (direct callers only: `import.prepare` refuses it), from `options.token_env`
//! naming an already-injected secret, or from the token the user saved on this
//! machine ([`ConnectorSecrets`], read when the job runs). It is never logged,
//! never persisted by the import: the manifest carries no secret, the report
//! redacts it. Without credentials the provider fails closed (`BadArgs`
//! naming what is missing), never with invented notes.
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

use fub_abi::model::DocId;
use fub_abi::rules::path::resolution_key;

use crate::common::{
    bad_args, is_cancelled, resolve_destination, sanitize_component, write_asset, write_doc,
};
use crate::notion;

pub const NOTION_VERSION: &str = "2022-06-28";
pub const NOTION_HOST: &str = "api.notion.com";
pub const AIRTABLE_HOST: &str = "api.airtable.com";
/// Bounded 429 retries; then the import reports instead of spinning.
const MAX_RATE_RETRIES: usize = 5;

/// The connector ids, which are also the names under which a token is saved.
pub const NOTION: &str = "notion";
pub const AIRTABLE: &str = "airtable";
pub const CONNECTORS: [&str; 2] = [NOTION, AIRTABLE];

/// Il token che l'utente ha salvato per un connettore su questa macchina. Lo
/// fornisce l'host, che sa dov'è la configurazione; il connettore lo chiede
/// soltanto quando il job parte, così il segreto non passa mai per il payload
/// del job, per gli argomenti di un comando o per il manifesto dell'import.
pub trait ConnectorSecrets: Send + Sync {
    /// Il token salvato per `connector` ([`CONNECTORS`]), se c'è.
    fn token(&self, connector: &str) -> Option<String>;
}

/// Nessun token salvato: un host senza configurazione di macchina.
pub struct NoSecrets;

impl ConnectorSecrets for NoSecrets {
    fn token(&self, _connector: &str) -> Option<String> {
        None
    }
}

fn auth_token(
    request: &ImportRequest,
    owner: &str,
    secrets: &dyn ConnectorSecrets,
) -> Result<String, PluginError> {
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
    if let Some(saved) = secrets.token(owner) {
        return Ok(saved);
    }
    Err(bad_args(format!(
        "{owner}: missing credential: save a token for `{owner}` on this machine, or set `options.token_env` naming an injected secret"
    )))
}

fn fetch_json(
    net: &dyn HostNetwork,
    req: HttpRequest,
    owner: &str,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> Result<(u16, serde_json::Value), PluginError> {
    try_fetch_json(net, req, owner, entry, log).map_err(FetchError::into_error)
}

/// A failed fetch, with the refusing status kept apart from the message: a
/// fallback is chosen on the status, never on the error text, which quotes
/// the response body (I73).
enum FetchError {
    /// The server answered with a non-2xx status.
    Status(u16, PluginError),
    /// Transport, cancellation or a body that is not JSON.
    Other(PluginError),
}

impl FetchError {
    fn into_error(self) -> PluginError {
        match self {
            FetchError::Status(_, error) | FetchError::Other(error) => error,
        }
    }
}

fn try_fetch_json(
    net: &dyn HostNetwork,
    req: HttpRequest,
    owner: &str,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> Result<(u16, serde_json::Value), FetchError> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let resp = net.fetch(req.clone()).map_err(|e| {
            FetchError::Other(if is_cancelled(&e) {
                e
            } else {
                PluginError::Io(format!("{owner}: network failure for `{entry}`: {e}").into())
            })
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
            return Err(FetchError::Status(
                resp.status,
                bad_args(format!(
                    "{owner}: HTTP {} for `{entry}`{hint}{detail}",
                    resp.status
                )),
            ));
        }
        let value: serde_json::Value = serde_json::from_slice(&resp.body).map_err(|e| {
            FetchError::Other(bad_args(format!(
                "{owner}: response for `{entry}` is not JSON: {e}"
            )))
        })?;
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

pub struct NotionApiImport {
    secrets: std::sync::Arc<dyn ConnectorSecrets>,
}

impl Default for NotionApiImport {
    fn default() -> Self {
        Self {
            secrets: std::sync::Arc::new(NoSecrets),
        }
    }
}

impl NotionApiImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(NotionApiImport::default())
    }

    /// The connector reading the tokens saved on this machine.
    pub fn with_secrets(secrets: std::sync::Arc<dyn ConnectorSecrets>) -> Box<dyn ImportProvider> {
        Box::new(NotionApiImport { secrets })
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
        let token = auth_token(request, NOTION, self.secrets.as_ref())?;
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
        let (page_status, page_val) =
            match try_fetch_json(net, req, "notion", &url, &mut report.log) {
                Ok(v) => v,
                Err(FetchError::Status(404, _)) => {
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
                Err(error) => return Err(error.into_error()),
            };
        let _ = page_status;
        // 2. L'albero dei blocchi, sottopagine comprese (L5): ogni blocco con
        // dei figli li porta sotto `source_children`.
        let title = page_val
            .get("properties")
            .and_then(|p| {
                p.as_object()?
                    .values()
                    .find_map(|prop| prop.get("title").map(notion_plain))
            })
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Untitled".to_string());
        let mut budget = 0usize;
        let blocks = fetch_tree(net, &token, &root_id, 0, &mut budget, &mut report.log)?;
        // L'id come lo scrive l'API, che è quello con cui le menzioni la
        // chiamano; quello scritto da chi importa può avere un'altra forma.
        let id = page_val
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(&root_id)
            .to_string();
        let root = NotionPage::new(id, title, page_val, blocks);
        write_pages(root, source, request, host, &mut report)?;
        Ok(report)
    }
}

/// Quanto scende l'albero dei blocchi: oltre, il blocco resta senza figli e
/// il rapporto lo dice.
const MAX_DEPTH: usize = 32;

/// I figli di `id`, tutte le pagine dei cursori, e sotto ciascuno i suoi.
fn fetch_tree(
    net: &dyn HostNetwork,
    token: &str,
    id: &str,
    depth: usize,
    budget: &mut usize,
    log: &mut Vec<TransferNote>,
) -> Result<Vec<serde_json::Value>, PluginError> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut url = format!("https://{NOTION_HOST}/v1/blocks/{id}/children?page_size=100");
        if let Some(c) = &cursor {
            url.push_str(&format!("&start_cursor={c}"));
        }
        let req = HttpRequest {
            url: url.clone(),
            method: HttpMethod::Get,
            headers: notion_headers(token),
            body: None,
        };
        let (_, v) = fetch_json(net, req, "notion", &url, log)?;
        for mut block in v
            .get("results")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default()
        {
            *budget += 1;
            if *budget > crate::common::MAX_ENTRIES {
                return Err(bad_args("Notion page exceeds 10000 blocks"));
            }
            if block.get("has_children").and_then(|v| v.as_bool()) == Some(true) {
                let child = block.get("id").and_then(|v| v.as_str()).map(str::to_string);
                match child {
                    Some(child) if depth + 1 < MAX_DEPTH => {
                        let children = fetch_tree(net, token, &child, depth + 1, budget, log)?;
                        block[notion::CHILDREN] = serde_json::Value::Array(children);
                    }
                    Some(child) => log.push(
                        TransferNote::warning(format!(
                            "blocks nested deeper than {MAX_DEPTH} levels were not fetched"
                        ))
                        .about(child),
                    ),
                    None => {}
                }
            }
            out.push(block);
        }
        cursor = v
            .get("next_cursor")
            .and_then(|c| c.as_str())
            .filter(|c| !c.is_empty())
            .map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Una pagina dell'albero: la radice o una `child_page`, con i suoi blocchi
/// e, staccate da questi, le sue sottopagine.
struct NotionPage {
    id: String,
    title: String,
    payload: serde_json::Value,
    blocks: Vec<serde_json::Value>,
    children: Vec<NotionPage>,
}

impl NotionPage {
    fn new(
        id: String,
        title: String,
        payload: serde_json::Value,
        mut blocks: Vec<serde_json::Value>,
    ) -> Self {
        let mut children = Vec::new();
        split_pages(&mut blocks, &mut children);
        NotionPage {
            id,
            title,
            payload,
            blocks,
            children,
        }
    }

    fn count(&self) -> usize {
        1 + self.children.iter().map(NotionPage::count).sum::<usize>()
    }
}

/// Stacca ogni `child_page` (anche dentro un ripiegabile o una colonna) in
/// una pagina sua: nel genitore resta il blocco, che diventa il link.
fn split_pages(blocks: &mut [serde_json::Value], pages: &mut Vec<NotionPage>) {
    for block in blocks.iter_mut() {
        let children = block
            .as_object_mut()
            .and_then(|o| o.remove(notion::CHILDREN));
        let mut children = match children {
            Some(serde_json::Value::Array(children)) => children,
            _ => Vec::new(),
        };
        if block.get("type").and_then(|t| t.as_str()) == Some("child_page") {
            let id = block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = block
                .get("child_page")
                .and_then(|c| c.get("title"))
                .and_then(|t| t.as_str())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or("Untitled")
                .to_string();
            pages.push(NotionPage::new(id, title, block.clone(), children));
        } else {
            split_pages(&mut children, pages);
            if !children.is_empty() {
                block[notion::CHILDREN] = serde_json::Value::Array(children);
            }
        }
    }
}

/// Una pagina col suo posto nel vault.
struct Placed {
    page: NotionPage,
    doc: DocId,
    outcome: fub_abi::transfer::ImportOutcome,
}

/// Il posto di ogni pagina (K7): una pagina con sottopagine è la pagina della
/// sua cartella, `Titolo/_index.md`, e le sottopagine stanno dentro; le altre
/// sono `Titolo.md`. Due sorelle con lo stesso nome prendono `-2`, `-3`.
#[allow(clippy::too_many_arguments)]
fn place_pages(
    page: NotionPage,
    folder: &str,
    siblings: &mut std::collections::HashSet<String>,
    host: &dyn HostApi,
    request: &ImportRequest,
    entry: &str,
    log: &mut Vec<TransferNote>,
    out: &mut Vec<Placed>,
) {
    let base = sanitize_component(&page.title).unwrap_or_else(|| "Untitled".to_string());
    let mut stem = base.clone();
    let mut n = 1;
    while stem == FOLDER_PAGE || !siblings.insert(resolution_key(&stem)) {
        n += 1;
        stem = format!("{base}-{n}");
    }
    let join = |name: &str| {
        if folder.is_empty() {
            name.to_string()
        } else {
            format!("{folder}/{name}")
        }
    };
    let own = join(&stem);
    let wanted = if page.children.is_empty() {
        format!("{own}.md")
    } else {
        format!("{own}/{FOLDER_PAGE}.md")
    };
    let (doc, outcome) =
        resolve_destination(host, request, request.destination(&wanted), entry, log);
    let mut page = page;
    let children = std::mem::take(&mut page.children);
    out.push(Placed { page, doc, outcome });
    let mut names = std::collections::HashSet::from([resolution_key(FOLDER_PAGE)]);
    for child in children {
        place_pages(child, &own, &mut names, host, request, entry, log, out);
    }
}

/// Il nome fisso della pagina di una cartella.
const FOLDER_PAGE: &str = "_index";

/// Il link con cui le pagine dell'import si chiamano: `[[Titolo]]` quando il
/// nome basta a trovarla, il path intero quando nel vault c'è un omonimo.
fn page_links(
    placed: &[Placed],
    host: &dyn HostApi,
) -> std::collections::HashMap<String, notion::PageRef> {
    let mut docs: std::collections::HashSet<DocId> = host
        .list_documents(None)
        .map(|p| p.items.into_iter().collect())
        .unwrap_or_default();
    docs.extend(placed.iter().map(|p| p.doc.clone()));
    let mut names: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for doc in &docs {
        *names.entry(resolution_key(doc.page_name())).or_default() += 1;
    }
    placed
        .iter()
        .map(|p| {
            let name = p.doc.page_name();
            let link = if name == p.page.title && names.get(&resolution_key(name)) == Some(&1) {
                notion::wikilink(name, name)
            } else {
                let path = p.doc.as_str();
                let path = path.strip_suffix(".md").unwrap_or(path);
                notion::wikilink(path, &p.page.title)
            };
            (
                notion::plain_id(&p.page.id),
                notion::PageRef {
                    doc: p.doc.clone(),
                    link,
                },
            )
        })
        .collect()
}

/// Scrive le pagine dell'albero, ciascuna dopo i suoi allegati; nel rapporto
/// la nota viene prima dei suoi file.
fn write_pages(
    root: NotionPage,
    source: &ImportSource,
    request: &ImportRequest,
    host: &mut dyn HostApi,
    report: &mut ImportReport,
) -> Result<(), PluginError> {
    if root.count() > crate::common::MAX_DOCS_PER_IMPORT {
        return Err(bad_args(format!(
            "Notion page tree exceeds {} pages",
            crate::common::MAX_DOCS_PER_IMPORT
        )));
    }
    let mut placed = Vec::new();
    place_pages(
        root,
        "",
        &mut std::collections::HashSet::new(),
        host,
        request,
        &source.name,
        &mut report.log,
        &mut placed,
    );
    let pages = page_links(&placed, host);
    let conventions = notion::Conventions::of(host);
    let mut taken = std::collections::HashSet::new();
    for Placed { page, doc, outcome } in placed {
        let entry = format!("{}#{}", source.name, notion::plain_id(&page.id));
        let first = report.documents.len();
        let mut downloads = Downloads {
            host: &mut *host,
            request,
            note: doc.clone(),
            folder: fub_abi::rules::folders::for_note(&conventions.attachments, doc.as_str()),
            entry: entry.clone(),
            taken: &mut taken,
            report: ImportReport::new(request.mode),
        };
        let mut render = notion::Render {
            conventions: &conventions,
            pages: &pages,
            attachments: &mut downloads,
            log: Vec::new(),
            entry: entry.clone(),
        };
        let body = render.blocks(&page.blocks)?;
        let log = std::mem::take(&mut render.log);
        let written = std::mem::replace(&mut downloads.report, ImportReport::new(request.mode));
        report.documents.extend(written.documents);
        report.log.extend(written.log);
        report.log.extend(log);
        let text = format!(
            "---\ntitle: {}\nsource_id: {}\nsource_file: {}\nsource_payload_json: {}\nsource_blocks_json: {}\n---\n\n{}\n",
            crate::common::yaml_scalar(&page.title),
            crate::common::yaml_scalar(&page.id),
            crate::common::yaml_scalar(&source.name),
            crate::common::yaml_scalar(&page.payload.to_string()),
            crate::common::yaml_scalar(&serde_json::Value::Array(page.blocks).to_string()),
            body.trim_end()
        );
        write_doc(host, request, &doc, &text, outcome, &entry, report)?;
        report.documents[first..].rotate_right(1);
    }
    Ok(())
}

/// Gli allegati ospitati da Notion (L3): scaricati durante il job nella
/// cartella degli allegati del vault (`files.attachment-folder`, che con `./`
/// segue la nota), con un link relativo. Gli URL firmati scadono in un'ora:
/// quello che non si scarica resta un link all'URL, col perché nel rapporto.
struct Downloads<'h> {
    host: &'h mut dyn HostApi,
    request: &'h ImportRequest,
    note: DocId,
    folder: String,
    entry: String,
    /// I file già promessi in questo import: l'anteprima non li scrive, e due
    /// allegati omonimi non devono prendersi lo stesso posto.
    taken: &'h mut std::collections::HashSet<DocId>,
    report: ImportReport,
}

impl notion::Attachments for Downloads<'_> {
    fn place(
        &mut self,
        url: &str,
        name: &str,
        log: &mut Vec<TransferNote>,
    ) -> Result<Option<String>, PluginError> {
        let name = sanitize_component(name).unwrap_or_else(|| "attachment".to_string());
        let (stem, ext) = match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
                (stem.to_string(), format!(".{ext}"))
            }
            _ => (name.clone(), String::new()),
        };
        let at = |file: &str| {
            if self.folder.is_empty() {
                DocId::new(file)
            } else {
                DocId::new(format!("{}/{file}", self.folder))
            }
        };
        let mut wanted = at(&name);
        let mut n = 0;
        while self.taken.contains(&wanted) {
            n += 1;
            wanted = at(&format!("{stem} {n}{ext}"));
        }
        let asset_entry = format!("{}:{name}", self.entry);
        let (doc, outcome) = match crate::common::resolve_binary_destination(
            &*self.host,
            self.request,
            wanted,
            &asset_entry,
            log,
        ) {
            Ok(found) => found,
            Err(e) if is_cancelled(&e) => return Err(e),
            Err(e) => {
                log.push(
                    TransferNote::warning(format!(
                        "attachment `{name}` not placed ({e}): the note keeps its URL"
                    ))
                    .about(asset_entry),
                );
                return Ok(None);
            }
        };
        self.taken.insert(doc.clone());
        let writes = matches!(
            outcome,
            fub_abi::transfer::ImportOutcome::Created | fub_abi::transfer::ImportOutcome::Replaced
        );
        let bytes = if writes && self.request.mode == fub_abi::transfer::ImportMode::Apply {
            match download(&*self.host, url, &asset_entry, log)? {
                Some(bytes) => bytes,
                None => return Ok(None),
            }
        } else {
            Vec::new()
        };
        write_asset(
            &mut *self.host,
            self.request,
            &doc,
            &bytes,
            outcome,
            &asset_entry,
            &mut self.report,
        )?;
        if matches!(
            self.report.documents.last().map(|d| &d.outcome),
            Some(fub_abi::transfer::ImportOutcome::Failed(_))
        ) {
            return Ok(None);
        }
        Ok(Some(relative_url(&self.note, &doc)))
    }
}

/// I byte di un allegato, o `None` col perché nel rapporto. Nessun header:
/// l'URL firmato è la sua credenziale, e il token di Notion non va altrove.
/// Il rapporto lo nomina senza la query, che porta la firma.
fn download(
    net: &dyn HostNetwork,
    url: &str,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> Result<Option<Vec<u8>>, PluginError> {
    let shown = url.split('?').next().unwrap_or(url);
    let mut fail = |why: String| {
        log.push(
            TransferNote::warning(format!(
                "attachment `{shown}` not downloaded: {why}; the note keeps its URL"
            ))
            .about(entry.to_string()),
        );
    };
    let resp = match net.fetch(HttpRequest {
        url: url.to_string(),
        method: HttpMethod::Get,
        headers: Vec::new(),
        body: None,
    }) {
        Ok(resp) => resp,
        Err(e) if is_cancelled(&e) => return Err(e),
        Err(e) => {
            fail(e.to_string());
            return Ok(None);
        }
    };
    if !(200..300).contains(&resp.status) {
        let hint = if matches!(resp.status, 400 | 403) {
            " (the signed link has probably expired: import again)"
        } else {
            ""
        };
        fail(format!("HTTP {}{hint}", resp.status));
        return Ok(None);
    }
    if let Some(expected) = resp
        .header("content-length")
        .and_then(|v| v.trim().parse::<usize>().ok())
    {
        if expected != resp.body.len() {
            fail(format!(
                "the response was interrupted ({} of {expected} bytes)",
                resp.body.len()
            ));
            return Ok(None);
        }
    }
    if resp.body.len() as u64 > crate::common::MAX_ENTRY_BYTES {
        fail(format!(
            "larger than {} MiB",
            crate::common::MAX_ENTRY_BYTES / (1024 * 1024)
        ));
        return Ok(None);
    }
    Ok(Some(resp.body))
}

/// Il link da `from` a `to`, relativo alla cartella di `from`: il gemello di
/// `relative_url` in `crates/fub-host/src/resources.rs`.
fn relative_url(from: &DocId, to: &DocId) -> String {
    let from_dir: Vec<&str> = match from.as_str().rsplit_once('/') {
        Some((dir, _)) => dir.split('/').collect(),
        None => Vec::new(),
    };
    let to_parts: Vec<&str> = to.as_str().split('/').collect();
    let mut common = 0;
    while common < from_dir.len()
        && common < to_parts.len().saturating_sub(1)
        && from_dir[common] == to_parts[common]
    {
        common += 1;
    }
    let mut out = "../".repeat(from_dir.len() - common);
    let rest = to_parts[common..]
        .iter()
        .map(|part| percent_encode_segment(part))
        .collect::<Vec<_>>()
        .join("/");
    out.push_str(&rest);
    out
}

fn percent_encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn notion_plain(value: &serde_json::Value) -> String {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| t.get("plain_text").and_then(|p| p.as_str()))
                .collect::<String>()
        })
        .unwrap_or_default()
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

pub struct AirtableApiImport {
    secrets: std::sync::Arc<dyn ConnectorSecrets>,
}

impl Default for AirtableApiImport {
    fn default() -> Self {
        Self {
            secrets: std::sync::Arc::new(NoSecrets),
        }
    }
}

impl AirtableApiImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(AirtableApiImport::default())
    }

    /// The connector reading the tokens saved on this machine.
    pub fn with_secrets(secrets: std::sync::Arc<dyn ConnectorSecrets>) -> Box<dyn ImportProvider> {
        Box::new(AirtableApiImport { secrets })
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
        let token = auth_token(request, AIRTABLE, self.secrets.as_ref())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::net::HttpResponse;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;

    fn notion_request() -> ImportRequest {
        let mut request = ImportRequest::apply();
        request.options = serde_json::json!({ "token": "t", "page_id": "abc" });
        request
    }

    fn answer(status: u16, body: &str) -> HttpResponse {
        HttpResponse {
            status,
            headers: Vec::new(),
            body: body.as_bytes().to_vec(),
        }
    }

    // Only a 404 on the page tries the database; a 502 whose body happens to
    // quote "HTTP 404" is a server failure, not a fallback (I73).
    #[test]
    fn only_the_404_status_falls_back_to_the_database() {
        let source = ImportSource::from_bytes("notion://abc", Vec::new());
        let mut host = MemoryHost::new().with_response(answer(502, "upstream said HTTP 404"));
        let error = NotionApiImport::default()
            .import(&source, &notion_request(), &mut host)
            .unwrap_err();
        assert!(error.to_string().contains("HTTP 502"), "{error}");
        assert_eq!(host.network_requests().len(), 1, "no second call");

        let mut host = MemoryHost::new()
            .with_response(answer(404, "{}"))
            .with_response(answer(500, "down"));
        let error = NotionApiImport::default()
            .import(&source, &notion_request(), &mut host)
            .unwrap_err();
        let requests = host.network_requests();
        assert_eq!(requests.len(), 2, "{error}");
        assert!(requests[1].url.ends_with("/v1/databases/abc"));
    }

    fn json_answer(body: serde_json::Value) -> HttpResponse {
        answer(200, &body.to_string())
    }

    fn page(title: &str) -> serde_json::Value {
        serde_json::json!({"object": "page", "id": "abc", "properties": {
            "Name": {"type": "title", "title": [{"plain_text": title}]}
        }})
    }

    fn children(results: serde_json::Value) -> serde_json::Value {
        serde_json::json!({"object": "list", "results": results, "next_cursor": null, "has_more": false})
    }

    fn hosted_image(url: &str) -> serde_json::Value {
        serde_json::json!({"type": "image", "id": url, "has_children": false,
            "image": {"type": "file", "file": {"url": url}, "caption": []}})
    }

    fn bytes(status: u16, body: &[u8], length: Option<usize>) -> HttpResponse {
        HttpResponse {
            status,
            headers: length
                .map(|n| {
                    vec![fub_abi::net::HttpHeader::new(
                        "Content-Length",
                        n.to_string(),
                    )]
                })
                .unwrap_or_default(),
            body: body.to_vec(),
        }
    }

    const S3: &str = "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/file";

    // L3: il file ospitato da Notion si scarica negli allegati del vault col
    // link relativo; un URL scaduto, una risposta interrotta e un guasto della
    // rete lasciano l'URL e una riga nel rapporto.
    #[test]
    fn hosted_files_are_downloaded_and_failures_keep_the_url() {
        let source = ImportSource::from_bytes("notion://abc", Vec::new());
        let ok = format!("{S3}/uno.png?X-Amz-Signature=segreto");
        let expired = format!("{S3}/due.png?X-Amz-Signature=vecchia");
        let cut = format!("{S3}/tre.png");
        let offline = format!("{S3}/quattro.png");
        let mut host = MemoryHost::new()
            .with_response(json_answer(page("Mare")))
            .with_response(json_answer(children(serde_json::json!([
                hosted_image(&ok),
                hosted_image(&expired),
                hosted_image(&cut),
                hosted_image(&offline),
            ]))))
            .with_response(bytes(200, b"PNG1", Some(4)))
            .with_response(bytes(403, b"<Error>Request has expired</Error>", None))
            .with_response(bytes(200, b"PN", Some(4)))
            .with_network_fault("connection reset");
        let mut request = notion_request();
        request.folder = "Importati".into();
        let report = NotionApiImport::default()
            .import(&source, &request, &mut host)
            .unwrap();
        let note = host
            .read_document(&DocId::new("Importati/Mare.md"))
            .unwrap();
        assert!(note.contains("![](../attachments/uno.png)"), "{note}");
        assert!(note.contains(&format!("![]({expired})")), "{note}");
        assert!(note.contains(&format!("![]({cut})")), "{note}");
        assert!(note.contains(&format!("![]({offline})")), "{note}");
        assert_eq!(
            host.read_document_bytes(&DocId::new("attachments/uno.png"))
                .unwrap(),
            b"PNG1"
        );
        for missing in ["due.png", "tre.png", "quattro.png"] {
            assert!(host
                .read_document_bytes(&DocId::new(format!("attachments/{missing}")))
                .is_err());
        }
        let warnings: Vec<&str> = report.log.iter().map(|n| n.message.as_str()).collect();
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("due.png") && w.contains("expired")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("tre.png") && w.contains("interrupted")),
            "{warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("quattro.png") && w.contains("connection reset")),
            "{warnings:?}"
        );
        assert!(
            !warnings.iter().any(|w| w.contains("Signature")),
            "la firma dell'URL non entra nel rapporto: {warnings:?}"
        );
        let docs: Vec<&str> = report.documents.iter().map(|d| d.doc.as_str()).collect();
        assert_eq!(docs, ["Importati/Mare.md", "attachments/uno.png"]);
        let sent = host.network_requests();
        assert_eq!(sent.len(), 6);
        assert!(
            sent[2..].iter().all(|r| r.headers.is_empty()),
            "il token di Notion non va a chi ospita i file"
        );
    }

    // L3: l'annullamento a metà di un download ferma l'import, e la nota non
    // si scrive a metà.
    #[test]
    fn cancelling_during_a_download_stops_the_import() {
        let source = ImportSource::from_bytes("notion://abc", Vec::new());
        let mut host = MemoryHost::new()
            .with_response(json_answer(page("Mare")))
            .with_response(json_answer(children(serde_json::json!([
                hosted_image(&format!("{S3}/uno.png")),
                hosted_image(&format!("{S3}/due.png")),
            ]))))
            .with_response(bytes(200, b"PNG1", Some(4)))
            .with_network_cancelled();
        let error = NotionApiImport::default()
            .import(&source, &notion_request(), &mut host)
            .unwrap_err();
        assert!(is_cancelled(&error), "{error}");
        assert!(host.read_document(&DocId::new("Mare.md")).is_err());
        assert_eq!(host.network_requests().len(), 4, "nessuna chiamata dopo");
    }

    // L5: un albero di tre livelli diventa la struttura delle cartelle (K7),
    // ogni pagina col link alle sue sottopagine.
    #[test]
    fn a_three_level_tree_becomes_folders_with_wikilinks() {
        let source = ImportSource::from_bytes("notion://abc", Vec::new());
        let paragraph = |text: &str| {
            serde_json::json!({"type": "paragraph", "id": text, "has_children": false,
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": text}, "plain_text": text}]}})
        };
        let child_page = |id: &str, title: &str| {
            serde_json::json!({"type": "child_page", "id": id, "has_children": true,
                "child_page": {"title": title}})
        };
        let mut host = MemoryHost::new()
            .with_document("Roma.md", "un'altra Roma\n")
            .with_response(json_answer(page("Viaggio")))
            .with_response(json_answer(children(serde_json::json!([
                paragraph("Il piano."),
                child_page("t-1", "Tappe"),
            ]))))
            .with_response(json_answer(children(serde_json::json!([
                child_page("r-1", "Roma"),
                paragraph("Poi Napoli."),
            ]))))
            .with_response(json_answer(children(serde_json::json!([paragraph(
                "Il Colosseo."
            )]))));
        let report = NotionApiImport::default()
            .import(&source, &notion_request(), &mut host)
            .unwrap();
        let docs: Vec<&str> = report.documents.iter().map(|d| d.doc.as_str()).collect();
        assert_eq!(
            docs,
            [
                "Viaggio/_index.md",
                "Viaggio/Tappe/_index.md",
                "Viaggio/Tappe/Roma.md"
            ]
        );
        let read = |path: &str| host.read_document(&DocId::new(path)).unwrap();
        let root = read("Viaggio/_index.md");
        assert!(root.ends_with("Il piano.\n\n[[Tappe]]\n"), "{root}");
        let tappe = read("Viaggio/Tappe/_index.md");
        assert!(
            tappe.ends_with("[[Viaggio/Tappe/Roma|Roma]]\n\nPoi Napoli.\n"),
            "nel vault c'è già un'altra Roma, il link dice quale: {tappe}"
        );
        assert!(read("Viaggio/Tappe/Roma.md").ends_with("Il Colosseo.\n"));
        assert!(
            !tappe.contains("Il Colosseo"),
            "la sottopagina sta nella sua nota"
        );
    }

    struct Saved;

    impl ConnectorSecrets for Saved {
        fn token(&self, connector: &str) -> Option<String> {
            (connector == NOTION).then(|| "salvato".to_string())
        }
    }

    // Il token salvato sulla macchina basta: la richiesta porta soltanto gli
    // id, e il segreto arriva all'header senza passare per le opzioni.
    #[test]
    fn the_saved_token_reaches_the_header_and_its_absence_fails_closed() {
        let source = ImportSource::from_bytes("notion://abc", Vec::new());
        let mut request = ImportRequest::apply();
        request.options = serde_json::json!({ "page_id": "abc" });
        let mut host = MemoryHost::new().with_response(answer(500, "down"));
        let mut saved = NotionApiImport {
            secrets: std::sync::Arc::new(Saved),
        };
        saved.import(&source, &request, &mut host).unwrap_err();
        let sent = host.network_requests();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].headers.iter().any(|h| h.value == "Bearer salvato"));

        let mut host = MemoryHost::new();
        let error = NotionApiImport::default()
            .import(&source, &request, &mut host)
            .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error}");
        assert!(error.to_string().contains("save a token"), "{error}");
        assert!(
            host.network_requests().is_empty(),
            "nessuna chiamata senza token"
        );

        let source = ImportSource::from_bytes("airtable://base", Vec::new());
        let mut request = ImportRequest::apply();
        request.options = serde_json::json!({ "base_id": "app1" });
        let error = AirtableApiImport {
            secrets: std::sync::Arc::new(Saved),
        }
        .import(&source, &request, &mut MemoryHost::new())
        .unwrap_err();
        assert!(
            error.to_string().contains("airtable"),
            "il token di Notion non vale per Airtable: {error}"
        );
    }
}
