//! Gli strumenti dell'MCP: ognuno è una chiamata dell'host che la CLI fa già,
//! con le radici davanti.
//!
//! - **Un errore di uno strumento torna come risultato**, con `isError`, non
//!   come errore JSON-RPC: l'agente lo legge e può correggersi. Uno strumento
//!   che non esiste, invece, è un errore del protocollo.
//! - **Si scrive soltanto da una revisione.** `fub_write` vuole la `base`
//!   letta con `fub_read`, e via MCP non c'è `WriteBase::Dictated`: una
//!   revisione superata torna come conflitto, e l'agente rilegge.
//! - **`fub_invoke` parte in prova.** Restituisce il piano; per eseguire
//!   serve `"apply": true`, e un comando che scrive si esegue soltanto se il
//!   suo piano tocca documenti sotto le radici di scrittura.
//! - **I componenti** (`fub_components*`) seguono le regole di
//!   `fub-cli componenti` (`crate::componenti`): accendere e spegnere partono
//!   in prova, e con `"apply": true` vogliono una radice di scrittura.
//! - **Le risposte sono a pagine**, 50 per difetto e al più 200, per non
//!   riempire il contesto dell'agente.

use fub_abi::{
    CommandEffect, DocId, IndexQuery, IndexResult, InvokeMode, Page, QueryClause, QueryExpr,
    QueryLiteral, QueryPredicate, WriteBase,
};
use serde_json::{json, Value};

use super::access::{Access, Scope};
use super::RpcError;
use crate::commands::{doc_id, paginate, render_text_value, Connection, Failure};
use crate::componenti::{Orfani, Vista, OPZIONI_MCP};
use crate::local::{link_target, match_json, outcome_json, search_expr};

const LIMIT_DEFAULT: u32 = 50;
const LIMIT_MAX: u32 = 200;

/// Lo schema di `limit` e `offset`, uguale per ogni strumento a pagine.
fn paging() -> (Value, Value) {
    (
        json!({ "type": "integer", "minimum": 1, "maximum": LIMIT_MAX, "default": LIMIT_DEFAULT }),
        json!({ "type": "integer", "minimum": 0, "default": 0 }),
    )
}

/// Le spec di `tools/list`, nell'ordine in cui un agente le usa.
pub fn specs() -> Value {
    let (limit, offset) = paging();
    json!([
        {
            "name": "fub_search",
            "description": "Cerca nel testo delle note del vault di Fub. La riga usa la sintassi della barra di ricerca: parole, \"frase\", tag:x, path:x, -escludi, OR. Restituisce i documenti con un estratto.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Che cosa cercare" },
                    "tag": { "type": "string", "description": "Solo le note con questo tag, senza #" },
                    "folder": { "type": "string", "description": "Solo le note in questa cartella del vault" },
                    "limit": limit, "offset": offset
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_query",
            "description": "Backlink, vicini nel grafo, note con un tag, elenco dei tag e risoluzione di un link nel vault di Fub. Usa una sola chiave per chiamata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "backlinks": { "type": "string", "description": "Nota di cui cercare chi la cita" },
                    "neighbors": { "type": "string", "description": "Nota di cui cercare i vicini nel grafo" },
                    "tag": { "type": "string", "description": "Le note con questo tag, senza #" },
                    "tags": { "type": "boolean", "description": "L'elenco dei tag, con quante note li portano" },
                    "resolve": { "type": "string", "description": "Testo di un wikilink, [[così]], o un path da risolvere" },
                    "limit": limit, "offset": offset
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_read",
            "description": "Legge una nota: il testo e la sua revisione. La revisione è la base di fub_write.",
            "inputSchema": {
                "type": "object",
                "properties": { "doc": { "type": "string", "description": "Path della nota nel vault, per esempio Note/idea.md" } },
                "required": ["doc"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_read_model",
            "description": "Il modello strutturato di una nota: titoli, link, tag, proprietà e blocchi.",
            "inputSchema": {
                "type": "object",
                "properties": { "doc": { "type": "string", "description": "Path della nota nel vault" } },
                "required": ["doc"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_write",
            "description": "Riscrive una nota esistente partendo dalla revisione letta con fub_read. Se nel frattempo qualcuno l'ha cambiata torna un conflitto: rileggi e riprova. Per una nota nuova usa fub_create.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path della nota nel vault" },
                    "text": { "type": "string", "description": "Il testo intero della nota" },
                    "base": { "type": "string", "description": "La revisione su cui si scrive, da fub_read" }
                },
                "required": ["doc", "text", "base"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false }
        },
        {
            "name": "fub_create",
            "description": "Crea una nota nuova, vuota, con un testo o da un modello. Non sovrascrive mai: un nome già preso è un errore.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Path della nota nuova, per esempio Agente/riassunto.md" },
                    "text": { "type": "string", "description": "Il testo iniziale" },
                    "template": { "type": "string", "description": "Il modello da cui partire, al posto di text" },
                    "title": { "type": "string", "description": "Il titolo, con un modello" }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false }
        },
        {
            "name": "fub_commands",
            "description": "I comandi di Fub che fub_invoke può eseguire, con i loro argomenti e se scrivono.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": limit, "offset": offset },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_invoke",
            "description": "Esegue un comando di Fub. Senza apply è una prova: restituisce il piano, cioè le note che toccherebbe. Con \"apply\": true lo esegue. Le note cancellate vanno nel cestino.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "L'id del comando, da fub_commands" },
                    "args": { "type": "object", "description": "Gli argomenti del comando" },
                    "apply": { "type": "boolean", "default": false, "description": "Esegui davvero invece di provare" }
                },
                "required": ["command"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false }
        },
        {
            "name": "fub_components",
            "description": "I componenti di Fub nel vault: acceso o spento, se è scelto o serve a un altro, il nome e chi lo richiede.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": limit, "offset": offset },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_components_why",
            "description": "Perché un componente di Fub è acceso: scelto, richiesto da altri o parte del nucleo. O che è spento.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "L'id del componente, da fub_components" }
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_components_enable",
            "description": "Accende un componente di Fub, e con lui quelli senza cui non funziona. Senza apply è una prova: dice che cosa si accenderebbe. Con \"apply\": true lo fa.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "L'id del componente, da fub_components" },
                    "apply": { "type": "boolean", "default": false, "description": "Accendi davvero invece di provare" }
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true }
        },
        {
            "name": "fub_components_disable",
            "description": "Spegne un componente di Fub. Se altri lo richiedono rifiuta e dice chi, a meno di also_dependents. Ciò che non serve più a nessuno si toglie con orphans \"remove\" o resta con \"keep\". Senza apply è una prova. Il nucleo non si spegne.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "L'id del componente, da fub_components" },
                    "apply": { "type": "boolean", "default": false, "description": "Spegni davvero invece di provare" },
                    "also_dependents": { "type": "boolean", "default": false, "description": "Spegni anche i componenti che lo richiedono" },
                    "orphans": { "type": "string", "enum": ["remove", "keep"], "description": "Che cosa fare di ciò che non serve più a nessuno" }
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true }
        }
    ])
}

/// `tools/call`. Uno strumento che non c'è è un errore del protocollo; ogni
/// altro errore torna dentro il risultato.
pub fn call(c: &Connection, access: &Access, params: &Value) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let args = match params.get("arguments") {
        None | Some(Value::Null) => Value::Object(Default::default()),
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(_) => return Err(RpcError::invalid_params("`arguments` è un oggetto")),
    };
    let outcome = match name {
        "fub_search" => search(c, access, &args),
        "fub_query" => query(c, access, &args),
        "fub_read" => read(c, access, &args),
        "fub_read_model" => read_model(c, access, &args),
        "fub_write" => write(c, access, &args),
        "fub_create" => create(c, access, &args),
        "fub_commands" => commands(c, &args),
        "fub_invoke" => invoke(c, access, &args),
        "fub_components" => components(c, &args),
        "fub_components_why" => components_why(c, &args),
        "fub_components_enable" => components_enable(c, access, &args),
        "fub_components_disable" => components_disable(c, access, &args),
        other => {
            return Err(RpcError::invalid_params(&format!(
                "strumento sconosciuto: {other}"
            )))
        }
    };
    Ok(match outcome {
        Ok(data) => {
            json!({ "content": [{ "type": "text", "text": data.to_string() }], "structuredContent": data })
        }
        Err(failure) => json!({
            "content": [{ "type": "text", "text": format!("{}: {}", failure.kind, crate::output::redact(&failure.message)) }],
            "isError": true
        }),
    })
}

fn text_arg<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, Failure> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(Failure::bad_args(format!("`{key}` è un testo"))),
    }
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, Failure> {
    text_arg(args, key)?.ok_or_else(|| Failure::bad_args(format!("manca `{key}`")))
}

fn bool_arg(args: &Value, key: &str) -> Result<bool, Failure> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(Failure::bad_args(format!("`{key}` è vero o falso"))),
    }
}

fn page_of(args: &Value) -> Result<Page, Failure> {
    let number = |key: &str, default: u32| match args.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| Failure::bad_args(format!("`{key}` è un intero >= 0"))),
    };
    let limit = number("limit", LIMIT_DEFAULT)?;
    if !(1..=LIMIT_MAX).contains(&limit) {
        return Err(Failure::bad_args(format!("`limit` va da 1 a {LIMIT_MAX}")));
    }
    Ok(Page::new(number("offset", 0)?, limit))
}

fn plugin(error: fub_abi::PluginError) -> Failure {
    let mut failure = Failure::from_plugin(&error);
    if failure.kind == "conflict" {
        failure
            .message
            .push_str(" — rileggi la nota con fub_read e riprova sulla revisione nuova");
    }
    failure
}

fn doc(args: &Value, key: &str) -> Result<DocId, Failure> {
    doc_id(required(args, key)?)
}

/// `matching` ristretto alle cartelle che si leggono: ogni clausola, in AND
/// con una delle cartelle. `None` se non si legge niente.
fn scoped(matching: QueryExpr, scope: &Scope) -> Option<QueryExpr> {
    let folders = match scope {
        Scope::All => return Some(matching),
        Scope::Folders(folders) if folders.is_empty() => return None,
        Scope::Folders(folders) => folders,
    };
    let clauses = if matching.any.is_empty() {
        vec![QueryClause::default()]
    } else {
        matching.any
    };
    let any = clauses
        .iter()
        .flat_map(|clause| {
            folders.iter().map(move |folder| {
                let mut all = clause.all.clone();
                all.push(QueryLiteral {
                    negated: false,
                    predicate: QueryPredicate::Folder {
                        path: folder.clone(),
                        descendants: true,
                    },
                });
                QueryClause { all }
            })
        })
        .collect();
    Some(QueryExpr { any })
}

fn documents(
    c: &Connection,
    access: &Access,
    matching: QueryExpr,
    page: Page,
) -> Result<Value, Failure> {
    let Some(matching) = scoped(matching, &access.read) else {
        return Ok(json!({ "items": [], "offset": page.offset, "total": 0 }));
    };
    let query = IndexQuery::Documents {
        matching,
        sort: None,
        select: fub_abi::PropertySelect::None,
        page: Some(page),
        excerpts: fub_abi::Excerpts::Attach,
    };
    match c
        .host
        .query_index(c.vault_selector(), query)
        .map_err(plugin)?
    {
        IndexResult::Documents(paged) => {
            let items: Vec<Value> = paged.items.iter().map(match_json).collect();
            Ok(json!({ "items": items, "offset": paged.offset, "total": paged.total }))
        }
        other => Err(Failure::local(format!(
            "documents ha risposto {}",
            other.kind_name()
        ))),
    }
}

fn search(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let matching = search_expr(
        required(args, "query")?,
        &[],
        false,
        text_arg(args, "tag")?,
        text_arg(args, "folder")?,
    )?;
    documents(c, access, matching, page_of(args)?)
}

/// Una risposta del grafo a pagine. Con le radici di lettura si chiede
/// tutto, si tolgono le righe fuori e si impagina qui: il totale resta vero.
fn graph_page(
    c: &Connection,
    access: &Access,
    page: Page,
    ask: impl Fn(Option<Page>) -> IndexQuery,
    rows: impl Fn(IndexResult) -> Result<(Vec<(String, Value)>, u32, u32), Failure>,
) -> Result<Value, Failure> {
    if access.read.is_all() {
        let (items, offset, total) = rows(
            c.host
                .query_index(c.vault_selector(), ask(Some(page)))
                .map_err(plugin)?,
        )?;
        let items: Vec<Value> = items.into_iter().map(|(_, row)| row).collect();
        return Ok(json!({ "items": items, "offset": offset, "total": total }));
    }
    let (items, _, _) = rows(
        c.host
            .query_index(c.vault_selector(), ask(None))
            .map_err(plugin)?,
    )?;
    let visible: Vec<Value> = items
        .into_iter()
        .filter(|(doc, _)| access.read.contains(doc))
        .map(|(_, row)| row)
        .collect();
    let (items, total) = paginate(visible, page.offset, Some(page.limit));
    Ok(json!({ "items": items, "offset": page.offset, "total": total }))
}

fn query(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let keys = ["backlinks", "neighbors", "tag", "tags", "resolve"];
    let given: Vec<&str> = keys
        .iter()
        .copied()
        .filter(|key| {
            !matches!(
                args.get(*key),
                None | Some(Value::Null) | Some(Value::Bool(false))
            )
        })
        .collect();
    if given.len() != 1 {
        return Err(Failure::bad_args(
            "una sola chiave fra backlinks, neighbors, tag, tags e resolve",
        ));
    }
    let page = page_of(args)?;
    match given[0] {
        "backlinks" => {
            let target = doc(args, "backlinks")?;
            access.check_read(target.as_str())?;
            graph_page(
                c,
                access,
                page,
                |page| IndexQuery::Backlinks {
                    target: target.clone(),
                    page,
                },
                |result| match result {
                    IndexResult::Backlinks(paged) => Ok((
                        paged
                            .items
                            .into_iter()
                            .map(|b| {
                                (
                                    b.source.as_str().to_string(),
                                    json!({ "source": b.source.as_str(), "context": b.context }),
                                )
                            })
                            .collect(),
                        paged.offset,
                        paged.total,
                    )),
                    other => Err(Failure::local(format!(
                        "backlinks ha risposto {}",
                        other.kind_name()
                    ))),
                },
            )
        }
        "neighbors" => {
            let seed = doc(args, "neighbors")?;
            access.check_read(seed.as_str())?;
            graph_page(
                c,
                access,
                page,
                |page| IndexQuery::Neighbors {
                    seeds: QueryExpr::of(QueryPredicate::Docs {
                        docs: vec![seed.clone()],
                    }),
                    direction: fub_abi::LinkDirection::Both,
                    depth: 1,
                    page,
                },
                |result| match result {
                    IndexResult::Neighbors(paged) => Ok((
                        paged
                            .items
                            .into_iter()
                            .map(|n| {
                                (
                                    n.doc.as_str().to_string(),
                                    json!({ "doc": n.doc.as_str(), "via": n.via.as_str() }),
                                )
                            })
                            .collect(),
                        paged.offset,
                        paged.total,
                    )),
                    other => Err(Failure::local(format!(
                        "neighbors ha risposto {}",
                        other.kind_name()
                    ))),
                },
            )
        }
        "tag" => {
            let name = required(args, "tag")?
                .trim()
                .trim_start_matches('#')
                .to_string();
            documents(
                c,
                access,
                QueryExpr::of(QueryPredicate::Tag {
                    name,
                    descendants: true,
                }),
                page,
            )
        }
        "tags" => {
            let Some(matching) = scoped(QueryExpr::default(), &access.read) else {
                return Ok(json!({ "items": [], "offset": page.offset, "total": 0 }));
            };
            match c
                .host
                .query_index(
                    c.vault_selector(),
                    IndexQuery::Tags {
                        matching,
                        page: Some(page),
                    },
                )
                .map_err(plugin)?
            {
                IndexResult::Tags(paged) => {
                    let items: Vec<Value> = paged
                        .items
                        .iter()
                        .map(|t| json!({ "tag": t.name, "count": t.count }))
                        .collect();
                    Ok(json!({ "items": items, "offset": paged.offset, "total": paged.total }))
                }
                other => Err(Failure::local(format!(
                    "tags ha risposto {}",
                    other.kind_name()
                ))),
            }
        }
        _ => {
            let target = link_target(required(args, "resolve")?);
            match c
                .host
                .query_index(
                    c.vault_selector(),
                    IndexQuery::Resolve { target, from: None },
                )
                .map_err(plugin)?
            {
                // Un bersaglio fuori dalle radici non si dice: per l'agente
                // il link non porta da nessuna parte.
                IndexResult::Resolved(resolved) => Ok(json!({
                    "resolved": resolved.map(|r| r.doc.as_str().to_string()).filter(|doc| access.read.contains(doc))
                })),
                other => Err(Failure::local(format!(
                    "resolve ha risposto {}",
                    other.kind_name()
                ))),
            }
        }
    }
}

fn read(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let (text, revision) = c
        .host
        .read_document(c.vault_selector(), &id)
        .map_err(plugin)?;
    Ok(json!({ "doc": id.as_str(), "revision": revision.as_str(), "text": text }))
}

fn read_model(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let model = c.host.read_model(c.vault_selector(), &id).map_err(plugin)?;
    Ok(json!({ "doc": id.as_str(), "model": serde_json::to_value(&model).unwrap_or(Value::Null) }))
}

fn write(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_write(id.as_str())?;
    let text = required(args, "text")?;
    // Obbligatoria: via MCP niente scritture «alla cieca».
    let base = WriteBase::DescendsFrom(fub_abi::Revision::new(required(args, "base")?));
    let revision = c
        .host
        .write_document(c.vault_selector(), &id, text, base)
        .map_err(plugin)?;
    Ok(json!({ "doc": id.as_str(), "revision": revision.as_str() }))
}

/// I documenti che il piano di un comando toccherebbe, tutti sotto le radici
/// di scrittura. Un piano senza documenti raggiunge il vault: lo si esegue
/// soltanto se si scrive dappertutto.
fn check_plan(access: &Access, effect: &CommandEffect, what: &str) -> Result<Vec<DocId>, Failure> {
    let docs = match effect {
        CommandEffect::Plan(plan) => plan.docs.clone(),
        _ => Vec::new(),
    };
    if docs.is_empty() && !access.write.is_all() {
        return Err(Failure::new(
            4,
            "denied",
            format!("`{what}` non dice quali note tocca: si esegue soltanto con tutto il vault fra le radici di scrittura"),
        ));
    }
    for doc in &docs {
        access.check_write(doc.as_str())?;
    }
    Ok(docs)
}

fn create(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    access.check_writer()?;
    let text = text_arg(args, "text")?;
    let invoke = |command: &str, args: Value, mode| {
        c.host
            .invoke_user_command(c.vault_selector(), command, args, mode)
            .map_err(plugin)
    };
    if let Some(template) = text_arg(args, "template")? {
        if text.is_some() {
            return Err(Failure::bad_args("`text` o `template`, non tutti e due"));
        }
        // Come `create --template` della CLI: il titolo, o il nome, è il
        // nome della nota del modello.
        let mut command = json!({ "template": template });
        if let Some(title) = text_arg(args, "title")?.or(text_arg(args, "name")?) {
            command["name"] = json!(title);
        }
        let planned = invoke("note.from_template", command.clone(), InvokeMode::DryRun)?;
        let docs = check_plan(access, &planned.effect, "note.from_template")?;
        let outcome = invoke("note.from_template", command, InvokeMode::Apply)?;
        let doc = match &outcome.effect {
            CommandEffect::Navigate { doc } => Some(doc.clone()),
            _ => docs.into_iter().next(),
        };
        return Ok(
            json!({ "doc": doc.map(|doc| doc.as_str().to_string()), "outcome": outcome_json(&outcome) }),
        );
    }
    // `note.create` sceglie estensione e nome libero: la prova nomina la
    // nota, le radici la giudicano.
    let command = match text_arg(args, "name")? {
        Some(name) => json!({ "name": doc_id(name)?.as_str() }),
        None => json!({}),
    };
    let planned = invoke("note.create", command.clone(), InvokeMode::DryRun)?;
    let id = match planned.effect {
        CommandEffect::Plan(plan) => plan.docs.into_iter().next(),
        _ => None,
    }
    .ok_or_else(|| Failure::local("note.create non ha nominato la nota"))?;
    access.check_write(id.as_str())?;
    let revision = match text {
        // Col testo, la nota nasce già scritta e in modo esclusivo, come per
        // `write` della CLI su una nota che non c'è: niente nota vuota nel
        // mezzo, che per una lavagna non sarebbe nemmeno un file valido.
        Some(text) => c
            .host
            .write_document_bytes(c.vault_selector(), &id, text.as_bytes(), None)
            .map_err(plugin)?,
        None => {
            invoke("note.create", command, InvokeMode::Apply)?;
            c.host
                .read_document(c.vault_selector(), &id)
                .map_err(plugin)?
                .1
        }
    };
    Ok(json!({ "doc": id.as_str(), "revision": revision.as_str() }))
}

fn commands(c: &Connection, args: &Value) -> Result<Value, Failure> {
    let page = page_of(args)?;
    let specs = c.host.commands(c.vault_selector()).map_err(plugin)?;
    let (specs, total) = paginate(specs, page.offset, Some(page.limit));
    let items: Vec<Value> = specs
        .iter()
        .map(|spec| {
            let params: Vec<Value> = spec
                .params
                .iter()
                .map(|param| {
                    json!({
                        "name": param.name,
                        "description": render_text_value(&param.description),
                        "kind": serde_json::to_value(&param.kind).unwrap_or(Value::Null),
                        "required": param.required,
                    })
                })
                .collect();
            json!({
                "id": spec.id,
                "title": render_text_value(&spec.title),
                "description": render_text_value(&spec.description),
                "writes": spec.scope.writes,
                "params": params,
            })
        })
        .collect();
    Ok(json!({ "items": items, "offset": page.offset, "total": total }))
}

fn invoke(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let command = required(args, "command")?;
    let command_args = match args.get("args") {
        None | Some(Value::Null) => json!({}),
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(_) => return Err(Failure::bad_args("`args` è un oggetto")),
    };
    // Un comando raggiunge il vault intero, non una cartella: con radici di
    // lettura più strette non si invoca niente.
    if !access.read.is_all() {
        return Err(Failure::new(
            4,
            "denied",
            "fub_invoke vuole tutto il vault fra le radici di lettura",
        ));
    }
    let run = |mode| {
        c.host
            .invoke_user_command(c.vault_selector(), command, command_args.clone(), mode)
            .map_err(plugin)
    };
    if !bool_arg(args, "apply")? {
        let outcome = run(InvokeMode::DryRun)?;
        return Ok(json!({ "dry_run": true, "outcome": outcome_json(&outcome) }));
    }
    let writes = c
        .host
        .commands(c.vault_selector())
        .map_err(plugin)?
        .iter()
        .find(|spec| spec.id == command)
        .is_some_and(|spec| spec.scope.writes);
    if writes {
        access.check_writer()?;
        check_plan(access, &run(InvokeMode::DryRun)?.effect, command)?;
    }
    let outcome = run(InvokeMode::Apply)?;
    Ok(json!({ "dry_run": false, "outcome": outcome_json(&outcome) }))
}

fn components(c: &Connection, args: &Value) -> Result<Value, Failure> {
    let page = page_of(args)?;
    let (items, total) = paginate(Vista::leggi(c)?.elenco(), page.offset, Some(page.limit));
    Ok(json!({ "items": items, "offset": page.offset, "limit": page.limit, "total": total }))
}

fn components_why(c: &Connection, args: &Value) -> Result<Value, Failure> {
    Vista::leggi(c)?.perche(required(args, "id")?)
}

/// Senza `apply` una prova; con `apply` prima di tutto la radice di
/// scrittura, poi le scritture.
fn components_apply(
    c: &Connection,
    access: &Access,
    args: &Value,
    esito: impl FnOnce(&Vista) -> Result<crate::componenti::Esito, Failure>,
) -> Result<Value, Failure> {
    let apply = bool_arg(args, "apply")?;
    if apply {
        access.check_writer()?;
    }
    let esito = esito(&Vista::leggi(c)?)?;
    if !apply {
        return Ok(esito.json(true, &[]));
    }
    let avvisi = esito.applica(c)?;
    Ok(esito.json(false, &avvisi))
}

fn components_enable(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = required(args, "id")?;
    components_apply(c, access, args, |vista| vista.accendi(id, &OPZIONI_MCP))
}

fn components_disable(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = required(args, "id")?;
    let also = bool_arg(args, "also_dependents")?;
    let orfani = match text_arg(args, "orphans")? {
        None => Orfani::Chiedi,
        Some("remove") => Orfani::Togli,
        Some("keep") => Orfani::Tieni,
        Some(_) => return Err(Failure::bad_args("`orphans` è \"remove\" o \"keep\"")),
    };
    components_apply(c, access, args, |vista| {
        vista.spegni(id, also, orfani, &OPZIONI_MCP)
    })
}
