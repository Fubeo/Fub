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
//! - **Le lavagne** (`fub_canvas_*`) passano dai comandi del componente
//!   «Lavagna» (`canvas.create`, `canvas.apply`, e la lettura, il controllo, la
//!   guida e l'anteprima). A differenza di `fub_invoke` non vogliono tutto il
//!   vault leggibile: le radici si guardano sulla lavagna, e `fub_canvas_apply`
//!   vuole la `base` come `fub_write`, parte in prova come `fub_invoke`, e
//!   controlla la lista con `canvas.check` prima di scrivere: con un problema
//!   non tocca il file, e non chiede nemmeno la prova.
//! - **I componenti** (`fub_components*`) seguono le regole di
//!   `fub-cli componenti` (`crate::componenti`): accendere e spegnere partono
//!   in prova, e con `"apply": true` vogliono tutto il vault fra le radici
//!   di scrittura: un componente cambia il comportamento del vault intero,
//!   come un piano che non dice quali note tocca.
//! - **I file Craft** (`fub_preview`, `fub_external_editors`,
//!   `fub_open_with`) seguono le regole di chi scrive: vedere vuole la radice
//!   di lettura, passare un file a un'app vuole la sua radice di scrittura e
//!   `"apply": true`. L'anteprima passa da `craft.preview`, che legge e basta:
//!   nessuno strumento chiama `craft_render` né cambia `craft.cli-previews`,
//!   quindi un agente non fa partire la riga di comando di un'app.
//! - **Le risposte sono a pagine**, 50 per difetto e al più 200, per non
//!   riempire il contesto dell'agente.

use fub_abi::{
    CommandEffect, CommandOutcome, DocId, IndexQuery, IndexResult, InvokeMode, Page, QueryClause,
    QueryExpr, QueryLiteral, QueryPredicate, WriteBase,
};
use serde_json::{json, Value};

use super::access::{Access, Scope};
use super::RpcError;
use crate::commands::{doc_id, paginate, render_text_value, Connection, Failure};
use crate::componenti::{Orfani, Vista, OPZIONI_MCP};
use crate::local::{link_target, match_json, outcome_json, search_expr};

const LIMIT_DEFAULT: u32 = 50;

/// I comandi del componente «Lavagna» (`fub.lavagna`): ids del contratto,
/// come `note.create`, perché la CLI non dipende da `fub-features`. Leggono,
/// controllano, guardano e scrivono; `canvas.check` e `canvas.preview` non
/// scrivono, e stanno prima di `canvas.apply` in ogni scrittura.
const CANVAS_CREATE: &str = "canvas.create";
const CANVAS_APPLY: &str = "canvas.apply";
const CANVAS_READ: &str = "canvas.read";
const CANVAS_CHECK: &str = "canvas.check";
const CANVAS_GUIDE: &str = "canvas.guide";
const CANVAS_PREVIEW: &str = "canvas.preview";
/// Il componente che porta quei comandi, per dire che cosa manca quando è
/// spento; lo spazio dei nomi del loro effetto; la versione delle loro risposte
/// di lettura (`canvas.apply` non ne ha una: dice soltanto gli id e la revisione).
const LAVAGNA_COMPONENT: &str = "fub.lavagna";
const LAVAGNA_NS: &str = "fub.lavagna";
const LAVAGNA_VERSION: u64 = 1;
const LIMIT_MAX: u32 = 200;

/// Il comando del bundle `fub.craft` che risponde l'anteprima, e lo spazio dei
/// nomi del suo effetto. La CLI non dipende da `fub-format-craft`: legge il
/// `CraftPreview` come JSON, nella forma della versione 2.
const PREVIEW_COMMAND: &str = "craft.preview";
const CRAFT_NS: &str = "fub.craft";
const PREVIEW_VERSION: u64 = 2;

/// Le immagini che un'anteprima può portare, e che MCP passa all'agente.
const PREVIEW_MEDIA: &[&str] = &["image/png", "image/jpeg"];

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
            "name": "fub_preview",
            "description": "L'anteprima di un file delle app Craft (VectorCraft, PhotoCraft, FigCraft, un XMP di LightCraft, un RAW, un PDF, un documento) e i suoi dati: l'immagine se il file ne porta una, e da dove viene. Su una lavagna (.canvas) è il disegno della lavagna, 512 o 1024 pixel secondo size. Legge e basta: non avvia mai un'app per farne una.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path del file nel vault, per esempio Disegni/logo.vectorcraft" },
                    "size": { "type": "string", "enum": ["small", "large"], "default": "small", "description": "small per una miniatura, large per l'anteprima grande" }
                },
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
            "name": "fub_canvas_guide",
            "description": "La guida per scrivere una lavagna con fub_canvas_apply: come si legge, si controlla e si scrive, le operazioni con i loro campi, lo schema della lista e gli esempi. Con topic dà solo l'operazione di quel nome. Legge e basta.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "topic": { "type": "string", "description": "Il nome di un'operazione, per esempio move" }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_canvas_read",
            "description": "Legge una lavagna (.canvas) e la sua revisione, che è la base di fub_canvas_apply. form: outline (di serie, una riga per scheda con il suo numero), code (la lista di operazioni che la ricrea) o json (il modello). Con ids legge solo quelle schede; con max_chars taglia l'outline. Legge e basta.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path della lavagna nel vault, per esempio Agente/piano.canvas" },
                    "form": { "type": "string", "enum": ["outline", "code", "json"], "default": "outline", "description": "Come si legge la lavagna" },
                    "ids": { "type": ["array", "string"], "items": { "type": "string" }, "description": "Gli id delle schede da leggere, come lista o come testo JSON della lista" },
                    "max_chars": { "type": "integer", "minimum": 0, "description": "Il limite dell'outline, in caratteri (solo con form outline)" }
                },
                "required": ["doc"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_canvas_create",
            "description": "Crea una lavagna nuova e vuota (.canvas). Senza name prende il primo nome libero; un nome già preso è un errore. Restituisce la lavagna e la sua revisione, la base di fub_canvas_apply.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Nome o path della lavagna, per esempio Agente/piano o Agente/piano.canvas" },
                    "folder": { "type": "string", "description": "La cartella di un nome semplice; senza, la radice del vault" }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false }
        },
        {
            "name": "fub_canvas_apply",
            "description": "Cambia una lavagna con una lista di operazioni, tutte o nessuna: `add_card`, `connect`, `move`, `resize`, `set`, `remove`, `reorder`, `color`, `align`, `distribute`, `duplicate`, `reverse`, `group`. Con move e contents: true un gruppo porta dentro di sé le schede che ha dentro (al più 1000 schede per operazione); con resize e fit: \"content\" l'altezza viene dal contenuto; con reorder e to: \"back\" la scheda va in fondo; color dà un nome, un numero da 1 a 6 o #rrggbb, o null per toglierlo. align allinea le schede a un lato o al centro, distribute le mette a spazi uguali, duplicate le copia (con as gli id delle copie), reverse inverte il verso di un arco, group fa un gruppo attorno alle schede. I campi di ciascuna sono in fub_canvas_guide. Controlla la lista prima di scrivere: con un problema non scrive, e lo elenca. Parte dalla revisione letta con fub_canvas_read o fub_read, o data da fub_canvas_create: se nel frattempo è cambiata torna un conflitto. Senza apply è una prova: dice che cosa cambierebbe. Con \"apply\": true scrive e restituisce gli id creati e la revisione nuova. Con \"preview\": true mostra anche la lavagna di dopo. Le schede e gli archi senza id ne ricevono uno nuovo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path della lavagna nel vault, per esempio Agente/piano.canvas" },
                    "ops": {
                        "type": ["array", "string"],
                        "items": { "type": "object" },
                        "description": "Le operazioni, come lista o come testo JSON della lista: la forma di ciascuna è in fub_canvas_guide"
                    },
                    "base": { "type": "string", "description": "La revisione su cui si applica, da fub_canvas_read, fub_read o fub_canvas_create" },
                    "apply": { "type": "boolean", "default": false, "description": "Scrivi davvero invece di provare" },
                    "preview": { "type": "boolean", "default": false, "description": "Mostra anche la lavagna di dopo, come immagine" }
                },
                "required": ["doc", "ops", "base"],
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
            "name": "fub_external_editors",
            "description": "Le app Craft che aprono un file del vault, nell'ordine di Fub: se sono installate su questa macchina e se Fub le ha già aperte.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path del file nel vault" }
                },
                "required": ["doc"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "fub_open_with",
            "description": "Apre un file del vault con un'app Craft, da fub_external_editors. Senza apply è una prova: dice quale app lo riceverebbe, se è installata e come (forwarded: alla finestra già aperta; new_process: una finestra nuova). Con \"apply\": true lo apre davvero: vuole il file fra le radici di scrittura, perché l'app lo può cambiare.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "doc": { "type": "string", "description": "Path del file nel vault" },
                    "editor": { "type": "string", "description": "L'id dell'app, per esempio vectorcraft" },
                    "page": { "type": "integer", "minimum": 1, "description": "La pagina, per PdfCraft" },
                    "apply": { "type": "boolean", "default": false, "description": "Apri davvero invece di provare" }
                },
                "required": ["doc", "editor"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": true }
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
    let outcome: Result<Output, Failure> = match name {
        "fub_search" => search(c, access, &args).map(Output::from),
        "fub_query" => query(c, access, &args).map(Output::from),
        "fub_read" => read(c, access, &args).map(Output::from),
        "fub_read_model" => read_model(c, access, &args).map(Output::from),
        "fub_preview" => preview(c, access, &args),
        "fub_write" => write(c, access, &args).map(Output::from),
        "fub_create" => create(c, access, &args).map(Output::from),
        "fub_canvas_guide" => canvas_guide(c, &args).map(Output::from),
        "fub_canvas_read" => canvas_read(c, access, &args).map(Output::from),
        "fub_canvas_create" => canvas_create(c, access, &args).map(Output::from),
        "fub_canvas_apply" => canvas_apply(c, access, &args),
        "fub_commands" => commands(c, &args).map(Output::from),
        "fub_invoke" => invoke(c, access, &args).map(Output::from),
        "fub_external_editors" => external_editors(c, access, &args).map(Output::from),
        "fub_open_with" => open_with(c, access, &args).map(Output::from),
        "fub_components" => components(c, &args).map(Output::from),
        "fub_components_why" => components_why(c, &args).map(Output::from),
        "fub_components_enable" => components_enable(c, access, &args).map(Output::from),
        "fub_components_disable" => components_disable(c, access, &args).map(Output::from),
        other => {
            return Err(RpcError::invalid_params(&format!(
                "strumento sconosciuto: {other}"
            )))
        }
    };
    Ok(match outcome {
        Ok(Output {
            data,
            image,
            text,
            refused,
        }) => {
            // Il testo è il primo contenuto ed è uguale a `structuredContent`,
            // salvo un rifiuto che lo dice in una frase; un'immagine, se c'è, lo
            // segue.
            let text = text.unwrap_or_else(|| data.to_string());
            let mut content = vec![json!({ "type": "text", "text": text })];
            content.extend(image);
            let mut result = json!({ "content": content, "structuredContent": data });
            if refused {
                result["isError"] = json!(true);
            }
            result
        }
        Err(failure) => json!({
            "content": [{ "type": "text", "text": format!("{}: {}", failure.kind, crate::output::redact(&failure.message)) }],
            "isError": true
        }),
    })
}

/// Il risultato di uno strumento: i dati, che vanno nel testo e in
/// `structuredContent`, e un contenuto immagine di MCP quando lo strumento ne
/// porta uno. Un rifiuto che ha qualcosa da dire in una frase porta `text` al
/// posto del JSON, e `refused` lo segna con `isError`.
struct Output {
    data: Value,
    image: Option<Value>,
    text: Option<String>,
    refused: bool,
}

impl From<Value> for Output {
    fn from(data: Value) -> Output {
        Output {
            data,
            image: None,
            text: None,
            refused: false,
        }
    }
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

/// `fub_canvas_create`: come `fub_create`, con `canvas.create` del
/// componente «Lavagna». La prova nomina la lavagna che nascerebbe (nome
/// libero, estensione, cartella), le radici la giudicano, poi si crea.
fn canvas_create(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    access.check_writer()?;
    let mut command = json!({});
    for key in ["name", "folder"] {
        if let Some(value) = text_arg(args, key)? {
            command[key] = json!(value);
        }
    }
    let invoke = |mode| {
        c.host
            .invoke_user_command(c.vault_selector(), CANVAS_CREATE, command.clone(), mode)
            .map_err(plugin)
    };
    let id = match invoke(InvokeMode::DryRun)?.effect {
        CommandEffect::Plan(plan) => plan.docs.into_iter().next(),
        _ => None,
    }
    .ok_or_else(|| Failure::local(format!("{CANVAS_CREATE} non ha nominato la lavagna")))?;
    access.check_write(id.as_str())?;
    // La lavagna che nasce è quella che `Navigate` apre: di solito la stessa
    // della prova; se è un'altra, deve stare anche lei sotto le radici, ma a
    // quel punto è già scritta, e lo si dice invece di tacerlo.
    let id = match invoke(InvokeMode::Apply)?.effect {
        CommandEffect::Navigate { doc } if doc != id => {
            return Err(Failure::local(format!(
                "{CANVAS_CREATE} ha creato `{}` invece di `{}`",
                doc.as_str(),
                id.as_str()
            )))
        }
        _ => id,
    };
    let (_, revision) = c
        .host
        .read_document(c.vault_selector(), &id)
        .map_err(plugin)?;
    Ok(json!({ "doc": id.as_str(), "revision": revision.as_str() }))
}

/// `fub_canvas_apply`: la lista di operazioni, controllata prima di scrivere.
///
/// Il controllo (`canvas.check`) viene prima di tutto, anche della prova: con
/// un problema il file non si tocca e `canvas.apply` non parte. Una revisione
/// superata, da sola, è il conflitto di `canvas.apply`. Con la lista buona si
/// prova o si scrive; con `preview` la lavagna di dopo si disegna prima della
/// scrittura, con la stessa base, così l'immagine è quella che si scrive.
fn canvas_apply(c: &Connection, access: &Access, args: &Value) -> Result<Output, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    access.check_write(id.as_str())?;
    // Il comando le prende come testo (non c'è un parametro JSON): una lista
    // si riscrive, un testo passa com'è e lo legge il comando.
    let ops = list_text(args, "ops")?.ok_or_else(|| Failure::bad_args("manca `ops`"))?;
    let base = required(args, "base")?;
    let apply = bool_arg(args, "apply")?;
    let preview = bool_arg(args, "preview")?;
    let command = json!({ "doc": id.as_str(), "ops": ops, "base": base });

    let check = without_envelope(lavagna_payload(
        lavagna(c, CANVAS_CHECK, command.clone(), InvokeMode::Apply)?,
        CANVAS_CHECK,
    )?);
    match check["ok"].as_bool() {
        Some(true) => {}
        Some(false) => {
            let problems = check["problems"].clone();
            let only_stale = problems.as_array().is_some_and(
                |list| matches!(list.as_slice(), [only] if only["code"] == "stale_base"),
            );
            if only_stale {
                return Err(stale_conflict(c, &command));
            }
            return Ok(Output {
                data: json!({
                    "doc": id.as_str(),
                    "written": false,
                    "ok": false,
                    "problems": problems,
                    "warnings": check["warnings"],
                    "summary": check["summary"],
                }),
                image: None,
                text: Some(refusal_text(&problems)?),
                refused: true,
            });
        }
        None => {
            return Err(Failure::local(format!(
                "{CANVAS_CHECK} non ha detto se la lista si scrive"
            )))
        }
    }

    // La lavagna di dopo, con la stessa base, prima di scrivere.
    let picture = if preview {
        Some(drawn_after(c, &command)?)
    } else {
        None
    };
    let mode = if apply {
        InvokeMode::Apply
    } else {
        InvokeMode::DryRun
    };
    let outcome = lavagna(c, CANVAS_APPLY, command, mode)?;
    let mut data = if apply {
        let (created, revision) = applied(&outcome)?;
        json!({
            "doc": id.as_str(),
            "dry_run": false,
            "created": created,
            "revision": revision,
            "warnings": check["warnings"],
            "warnings_omitted": check["warnings_omitted"],
        })
    } else {
        json!({
            "doc": id.as_str(),
            "dry_run": true,
            "check": check,
            "outcome": outcome_json(&outcome),
        })
    };
    let image = picture.and_then(|(drawn, image)| {
        data["preview"] = drawn;
        image
    });
    Ok(Output {
        data,
        image,
        text: None,
        refused: false,
    })
}

/// La lista di operazioni, o un parametro di testo che è una lista: una lista
/// JSON si riscrive come testo, un testo passa com'è e lo legge il comando.
/// `None` se il parametro manca.
fn list_text(args: &Value, key: &str) -> Result<Option<String>, Failure> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(list @ Value::Array(_)) => Ok(Some(list.to_string())),
        Some(_) => Err(Failure::bad_args(format!(
            "`{key}` è una lista, o il suo testo JSON"
        ))),
    }
}

/// Un comando della lavagna. Col componente spento il comando non c'è: è
/// `unavailable`, come `craft.preview` senza il bundle `fub.craft`.
fn lavagna(
    c: &Connection,
    command: &str,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, Failure> {
    c.host
        .invoke_user_command(c.vault_selector(), command, args, mode)
        .map_err(|error| match error {
            fub_abi::PluginError::UnknownCommand(_) => Failure::new(
                3,
                "unavailable",
                format!(
                    "{command} non c'è: il componente {LAVAGNA_COMPONENT} è spento in questo vault"
                ),
            ),
            other => plugin(other),
        })
}

/// Il payload di una risposta di lettura della lavagna, se è di questa versione.
fn lavagna_payload(outcome: CommandOutcome, command: &str) -> Result<Value, Failure> {
    match outcome.effect {
        CommandEffect::Custom { ns, payload }
            if ns == LAVAGNA_NS && payload["version"].as_u64() == Some(LAVAGNA_VERSION) =>
        {
            Ok(payload)
        }
        _ => Err(Failure::local(format!(
            "{command} non ha risposto una lavagna della versione {LAVAGNA_VERSION}"
        ))),
    }
}

/// Il payload senza la sua intestazione (`version` e `kind`): la risposta di
/// MCP porta i dati, non il contratto del comando.
fn without_envelope(mut payload: Value) -> Value {
    if let Some(fields) = payload.as_object_mut() {
        fields.remove("version");
        fields.remove("kind");
    }
    payload
}

/// Gli id nati e la revisione dopo, dall'esito di `canvas.apply` scritto.
fn applied(outcome: &CommandOutcome) -> Result<(Value, Value), Failure> {
    let payload = match &outcome.effect {
        CommandEffect::Custom { payload, .. } => Some(payload),
        _ => None,
    };
    let created = payload
        .and_then(|payload| payload.get("created"))
        .filter(|created| created.is_array());
    let revision = payload
        .and_then(|payload| payload.get("revision"))
        .filter(|revision| revision.is_string());
    match (created, revision) {
        (Some(created), Some(revision)) => Ok((created.clone(), revision.clone())),
        _ => Err(Failure::local(format!(
            "{CANVAS_APPLY} non ha detto gli id creati e la revisione"
        ))),
    }
}

/// La revisione data non è quella del file. `canvas.apply` in prova, con la
/// stessa base, dice il conflitto di adesso: lo stesso codice e lo stesso testo
/// di sempre, e nessuna scrittura. Se nel frattempo la revisione è tornata quella
/// data, il conflitto resta, perché il controllo l'aveva vista superata.
fn stale_conflict(c: &Connection, command: &Value) -> Failure {
    match lavagna(c, CANVAS_APPLY, command.clone(), InvokeMode::DryRun) {
        Err(failure) => failure,
        Ok(_) => Failure::new(
            5,
            "conflict",
            "la lavagna è cambiata dalla revisione data: rileggi con fub_canvas_read e riprova",
        ),
    }
}

/// La frase di un rifiuto: quanti problemi, e il primo con dove sta e la sua
/// frase. Il testo dice il primo; il payload porta tutti.
fn refusal_text(problems: &Value) -> Result<String, Failure> {
    let list = problems.as_array().map(Vec::as_slice).unwrap_or(&[]);
    let Some(first) = list.first() else {
        return Err(Failure::local(format!(
            "{CANVAS_CHECK} ha detto no senza un problema"
        )));
    };
    let code = first["code"].as_str().unwrap_or("?");
    let place = if code == "stale_base" {
        "la revisione".to_string()
    } else if let Some(index) = first["index"].as_u64() {
        format!("l'operazione {}", index + 1)
    } else {
        "la lista".to_string()
    };
    let count = match list.len() {
        1 => "1 problema".to_string(),
        n => format!("{n} problemi"),
    };
    let mut text = format!(
        "{count}: niente è scritto. Il primo, {place} ({code}): {}",
        first["message"].as_str().unwrap_or_default()
    );
    if let Some(suggestion) = first["suggestion"].as_str() {
        text.push_str(&format!(" Più vicino: {suggestion}."));
    }
    Ok(text)
}

/// La lavagna di dopo, disegnata da `canvas.preview` con la stessa lista e la
/// stessa base di `canvas.apply`.
fn drawn_after(c: &Connection, command: &Value) -> Result<(Value, Option<Value>), Failure> {
    let payload = lavagna_payload(
        lavagna(c, CANVAS_PREVIEW, command.clone(), InvokeMode::Apply)?,
        CANVAS_PREVIEW,
    )?;
    Ok(canvas_picture(payload))
}

/// La parte dell'anteprima di una lavagna che va all'agente: il tipo e le misure
/// dell'immagine e la lettura delle schede (`info.outline`, con il suo tetto).
/// Un PNG o un JPEG passa come contenuto di MCP, senza i byte nel testo; un SVG
/// (senza `draw`) resta nel testo, perché MCP non ha un contenuto per lui.
fn canvas_picture(mut payload: Value) -> (Value, Option<Value>) {
    let mut image = payload["image"].take();
    let media = image["media_type"].as_str().unwrap_or_default().to_owned();
    let content = if PREVIEW_MEDIA.contains(&media.as_str()) {
        match image
            .as_object_mut()
            .and_then(|fields| fields.remove("data"))
        {
            Some(Value::String(data)) => {
                Some(json!({ "type": "image", "data": data, "mimeType": media }))
            }
            _ => None,
        }
    } else {
        None
    };
    let info = json!({
        "outline": payload["outline"].take(),
        "outline_omitted": payload["outline_omitted"].take(),
    });
    (json!({ "image": image, "info": info }), content)
}

/// `fub_canvas_guide`: la guida di `canvas.guide`, e con `topic` la sua operazione.
fn canvas_guide(c: &Connection, args: &Value) -> Result<Value, Failure> {
    guide(c, text_arg(args, "topic")?)
}

/// La guida della lavagna, com'è in `canvas.guide`: il testo, le operazioni, lo
/// schema e gli esempi. Non legge nessun documento. Serve anche alle risorse
/// `fub-guida://`.
pub(super) fn guide(c: &Connection, topic: Option<&str>) -> Result<Value, Failure> {
    let mut command = json!({});
    if let Some(topic) = topic {
        command["topic"] = json!(topic);
    }
    let payload = lavagna_payload(
        lavagna(c, CANVAS_GUIDE, command, InvokeMode::Apply)?,
        CANVAS_GUIDE,
    )?;
    Ok(without_envelope(payload))
}

/// `fub_canvas_read`: la lavagna come la legge `canvas.read`, con la sua revisione.
fn canvas_read(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let mut command = json!({ "doc": id.as_str() });
    if let Some(form) = text_arg(args, "form")? {
        command["form"] = json!(form);
    }
    if let Some(ids) = list_text(args, "ids")? {
        command["ids"] = json!(ids);
    }
    match args.get("max_chars") {
        None | Some(Value::Null) => {}
        Some(value) => {
            let max = value
                .as_u64()
                .ok_or_else(|| Failure::bad_args("`max_chars` è un intero da 0 in su"))?;
            command["max_chars"] = json!(max);
        }
    }
    let payload = lavagna_payload(
        lavagna(c, CANVAS_READ, command, InvokeMode::Apply)?,
        CANVAS_READ,
    )?;
    Ok(without_envelope(payload))
}

/// Un'anteprima di una lavagna (`.canvas`), come le altre: `canvas.preview` in
/// sola lettura, con `origin` `"canvas"` e senza `missing` né `limit_bytes`,
/// che sono di Craft.
fn canvas_preview(c: &Connection, id: &DocId, size: &str) -> Result<Output, Failure> {
    let side = if size == "large" { 1024 } else { 512 };
    let payload = lavagna_payload(
        lavagna(
            c,
            CANVAS_PREVIEW,
            json!({ "doc": id.as_str(), "size": side }),
            InvokeMode::Apply,
        )?,
        CANVAS_PREVIEW,
    )?;
    let revision = payload["revision"].clone();
    let (picture, image) = canvas_picture(payload);
    let data = json!({
        "doc": id.as_str(),
        "revision": revision,
        "size": size,
        "origin": "canvas",
        "missing": null,
        "limit_bytes": null,
        "image": picture["image"],
        "info": picture["info"],
    });
    Ok(Output {
        data,
        image,
        text: None,
        refused: false,
    })
}

/// Un documento è una lavagna se il nome finisce in `.canvas` in minuscole, come
/// quelli che Fub e Obsidian scrivono. Il routing di `fub_preview` si decide qui,
/// con il suffisso esatto: il registro dei formati, che legge anche le maiuscole,
/// non è interrogabile dalla CLI. Un `.CANVAS` va a Craft.
fn is_canvas(doc: &str) -> bool {
    doc.ends_with(".canvas")
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

/// `fub_preview`: il `CraftPreview` di `craft.preview`, che legge e basta, o il
/// disegno di una lavagna (`canvas.preview`). L'immagine, quando c'è, diventa un
/// contenuto immagine di MCP; il testo porta tutto il resto, senza i byte.
fn preview(c: &Connection, access: &Access, args: &Value) -> Result<Output, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let size = match text_arg(args, "size")? {
        None => "small",
        Some(size @ ("small" | "large")) => size,
        Some(_) => return Err(Failure::bad_args("`size` è \"small\" o \"large\"")),
    };
    if is_canvas(id.as_str()) {
        return canvas_preview(c, &id, size);
    }
    // Soltanto `doc` e `size`: niente che chieda all'app di farne una.
    let outcome = c
        .host
        .invoke_user_command(
            c.vault_selector(),
            PREVIEW_COMMAND,
            json!({ "doc": id.as_str(), "size": size }),
            InvokeMode::Apply,
        )
        .map_err(|error| match error {
            fub_abi::PluginError::UnknownCommand(_) => Failure::new(
                3,
                "unavailable",
                "craft.preview non c'è: il componente fub.craft è spento in questo vault",
            ),
            other => plugin(other),
        })?;
    let mut payload = match outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == CRAFT_NS => payload,
        _ => return Err(Failure::local("craft.preview non ha risposto un'anteprima")),
    };
    if payload["version"].as_u64() != Some(PREVIEW_VERSION) {
        return Err(Failure::local(format!(
            "craft.preview ha risposto la versione {}, non la {PREVIEW_VERSION}",
            payload["version"]
        )));
    }
    let image = preview_image(&mut payload);
    let data = json!({
        "doc": payload["doc"],
        "revision": payload["revision"],
        "size": payload["size"],
        "origin": payload["origin"],
        "missing": payload["missing"],
        "limit_bytes": payload["limit_bytes"],
        "image": payload["image"],
        "info": payload["info"],
    });
    Ok(Output {
        data,
        image,
        text: None,
        refused: false,
    })
}

/// Toglie i byte dall'immagine dell'anteprima (restano tipo, misure e
/// orientamento) e li restituisce come contenuto immagine di MCP. Un tipo che
/// non è PNG o JPEG non passa all'agente.
fn preview_image(payload: &mut Value) -> Option<Value> {
    let image = payload.get_mut("image")?.as_object_mut()?;
    let data = match image.remove("data")? {
        Value::String(data) => data,
        _ => return None,
    };
    let media = image.get("media_type")?.as_str()?;
    if !PREVIEW_MEDIA.contains(&media) {
        return None;
    }
    Some(json!({ "type": "image", "data": data, "mimeType": media }))
}

fn external_editors(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let editors = c
        .host
        .external_editors(c.vault_selector(), Some(id.as_str()))
        .map_err(plugin)?;
    Ok(json!({ "doc": id.as_str(), "items": editors }))
}

/// `fub_open_with`: senza `apply` la prova, con `apply` il file all'app.
fn open_with(c: &Connection, access: &Access, args: &Value) -> Result<Value, Failure> {
    let id = doc(args, "doc")?;
    access.check_read(id.as_str())?;
    let editor = required(args, "editor")?;
    let page = match args.get("page") {
        None | Some(Value::Null) => None,
        Some(value) => Some(
            value
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .filter(|n| *n >= 1)
                .ok_or_else(|| Failure::bad_args("`page` è un intero >= 1"))?,
        ),
    };
    if !bool_arg(args, "apply")? {
        return open_with_plan(c, &id, editor);
    }
    // L'app può cambiare il file: come una scrittura.
    access.check_write(id.as_str())?;
    let opened = c
        .host
        .open_with(c.vault_selector(), id.as_str(), editor, page)
        .map_err(plugin)?;
    Ok(json!({
        "dry_run": false,
        "doc": id.as_str(),
        "editor": opened.editor,
        "how": opened.how,
    }))
}

/// Che cosa farebbe `fub_open_with`, senza avviare niente: le stesse domande
/// di `Host::open_with`, nello stesso ordine, e il modo da `single_instance`
/// della tabella delle app.
fn open_with_plan(c: &Connection, id: &DocId, editor: &str) -> Result<Value, Failure> {
    use fub_abi::text::{Arg, Text};
    use fub_abi::PluginError;
    let vault = c.vault_selector();
    let listed = c
        .host
        .external_editors(vault, Some(id.as_str()))
        .map_err(plugin)?;
    let Some(app) = listed.into_iter().find(|app| app.id == editor) else {
        // Perché non c'è: il componente spento, un'app che Fub non conosce, o
        // un'app che non apre questo file. Gli errori sono quelli di
        // `Host::open_with`.
        let known = c.host.external_editors(vault, None).map_err(plugin)?;
        let error = if known.is_empty() {
            PluginError::Unserved(Text::key("host.open_with.off"))
        } else if let Some(app) = known.iter().find(|app| app.id == editor) {
            PluginError::BadArgs(Text::message(
                "host.open_with.wrong_kind",
                vec![Arg::text("app", &app.name), Arg::text("path", id.as_str())],
            ))
        } else {
            PluginError::BadArgs(Text::message(
                "host.open_with.unknown_editor",
                vec![Arg::text("editor", editor)],
            ))
        };
        return Err(plugin(error));
    };
    let root = c.host.root(vault).map_err(plugin)?;
    fub_host::vault_path::inside(root.as_std_path(), id.as_str()).map_err(plugin)?;
    let how = app.installed.then(|| {
        let single = fub_host::craft::editors::editor(&app.id).is_some_and(|known| {
            known
                .single_instance
                .contains(&fub_host::craft::editors::Os::current())
        });
        if single {
            fub_host::open_with::OpenHow::Forwarded
        } else {
            fub_host::open_with::OpenHow::NewProcess
        }
    });
    Ok(json!({
        "dry_run": true,
        "doc": id.as_str(),
        "editor": app.id,
        "name": app.name,
        "installed": app.installed,
        "running": app.running,
        "how": how,
    }))
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
        if !access.write.is_all() {
            return Err(Failure::new(
                4,
                "denied",
                "accendere o spegnere un componente cambia tutto il vault: si fa soltanto con tutto il vault fra le radici di scrittura",
            ));
        }
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
    components_apply(c, access, args, |vista| vista.accendi(c, id, &OPZIONI_MCP))
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
        vista.spegni(c, id, also, orfani, &OPZIONI_MCP)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un'anteprima come la dà `canvas.preview`, con un PNG o con un SVG.
    fn picture(media: &str) -> Value {
        json!({
            "version": 1,
            "kind": "preview",
            "doc": "Agente/piano.canvas",
            "revision": "r1",
            "image": { "media_type": media, "width": 512, "height": 256, "data": "AAAA" },
            "outline": [{ "n": 1, "id": "uno", "kind": "text", "clipped": false }],
            "outline_omitted": 0,
        })
    }

    #[test]
    fn un_png_passa_come_contenuto_e_il_testo_non_ha_i_byte() {
        let (part, content) = canvas_picture(picture("image/png"));
        let content = content.expect("un PNG è un contenuto immagine");
        assert_eq!(content["type"], "image");
        assert_eq!(content["mimeType"], "image/png");
        assert_eq!(content["data"], "AAAA");
        assert!(part["image"].get("data").is_none());
        assert_eq!(part["image"]["width"], 512);
        assert_eq!(part["info"]["outline"][0]["id"], "uno");
        assert_eq!(part["info"]["outline_omitted"], 0);
    }

    /// Senza `draw` la lavagna arriva come SVG: non è un tipo che MCP porta come
    /// immagine, quindi resta nel testo, con i suoi byte.
    #[test]
    fn un_svg_non_e_un_contenuto_e_resta_nel_testo() {
        let (part, content) = canvas_picture(picture("image/svg+xml"));
        assert!(content.is_none());
        assert_eq!(part["image"]["media_type"], "image/svg+xml");
        assert_eq!(part["image"]["data"], "AAAA");
    }

    #[test]
    fn il_rifiuto_dice_il_primo_problema_e_quanti_sono() {
        let one = json!([{ "code": "unknown_op", "index": 1, "message": "unknown operation" }]);
        assert_eq!(
            refusal_text(&one).unwrap(),
            "1 problema: niente è scritto. Il primo, l'operazione 2 (unknown_op): unknown operation"
        );
        let many = json!([
            { "code": "stale_base", "index": null, "message": "changed" },
            { "code": "unknown_op", "index": 0, "message": "unknown", "suggestion": "move" },
        ]);
        assert_eq!(
            refusal_text(&many).unwrap(),
            "2 problemi: niente è scritto. Il primo, la revisione (stale_base): changed"
        );
        let whole = json!([{ "code": "invalid", "index": null, "message": "empty" }]);
        assert!(refusal_text(&whole).unwrap().contains("la lista (invalid)"));
        assert!(refusal_text(&json!([])).is_err());
    }

    #[test]
    fn una_lavagna_e_un_nome_che_finisce_in_canvas() {
        assert!(is_canvas("Agente/piano.canvas"));
        assert!(!is_canvas("Agente/bozza.md"));
        assert!(!is_canvas("Agente/piano.canvas.md"));
        // Le maiuscole vanno a Craft: vedi `is_canvas`.
        assert!(!is_canvas("Agente/PIANO.CANVAS"));
    }

    #[test]
    fn la_lista_si_legge_come_lista_o_come_testo() {
        let text = list_text(&json!({ "ops": "[]" }), "ops").unwrap();
        assert_eq!(text.as_deref(), Some("[]"));
        let list = list_text(&json!({ "ops": [1] }), "ops").unwrap();
        assert_eq!(list.as_deref(), Some("[1]"));
        assert!(list_text(&json!({}), "ops").unwrap().is_none());
        assert!(list_text(&json!({ "ops": 3 }), "ops").is_err());
    }
}
