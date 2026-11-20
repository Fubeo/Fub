//! I tipi di nota (E5, decisione D7 A): com'è fatto un tipo, quale tipo ha
//! una nota, quante note ha ogni tipo.
//!
//! Un tipo è una nota Markdown della cartella `files.types-folder` (di serie
//! `Tipi/`, sottocartelle comprese). Il frontmatter dice com'è fatto il tipo,
//! il testo è il modello delle note nuove:
//!
//! ```markdown
//! ---
//! icon: 📘
//! properties:
//!   autore: testo
//!   anno: numero
//!   letto: casella
//! featured: [autore, letto]
//! folder: Libri
//! ---
//! ## Di che cosa parla
//! ```
//!
//! Una nota dice il suo tipo con `tipo: "[[Tipi/Libro]]"`, un link vero; un
//! testo semplice (`tipo: Libro`) si legge lo stesso. Il tipo non possiede il
//! registro dei tipi di proprietà (`properties.types`), che resta uno per
//! vault: dove i due dicono cose diverse vale il registro, e
//! [`TypeProperty::conflict`] lo dice.
//!
//! Modulo **condiviso** (vedi `tests/independent_modules.rs`): lo usano i
//! modelli (creare una nota da un tipo) e le proprietà (cambiare tipo, dire
//! che il tipo manca). Non nomina nessuna feature; le parole che si leggono le
//! scelgono loro, da [`TypeState`].

use fub_abi::error::PluginError;
use fub_abi::model::{
    custom_kind, parse_wikilink_inner, Block, DocId, DocumentModel, LinkTarget, PropertyScalar,
    PropertyType, PropertyTypes, PropertyValue,
};
use fub_abi::query::{QueryExpr, QueryPredicate};
use fub_abi::rules::path_policy::{check as check_name, Naming};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    DocumentMatch, Excerpts, IndexQuery, PropertyFilter, PropertySelect, PropertyTest, ReadApi,
};

/// La chiave con cui una nota dice il suo tipo.
pub(crate) const TYPE_KEY: &str = "tipo";
/// La cartella dei tipi: un'impostazione del vault, dichiarata dal core
/// (`fub_host::settings::FILES_TYPES_FOLDER`). Vuota, i tipi sono spenti.
pub(crate) const TYPES_FOLDER_KEY: &str = "files.types-folder";
/// Il valore di serie di [`TYPES_FOLDER_KEY`]; vale anche su un host che non
/// dichiara la chiave, come un banco senza il bundle core.
pub(crate) const TYPES_FOLDER_DEFAULT: &str = "Tipi";

/// Le chiavi del frontmatter di un tipo.
const DEF_ICON: &str = "icon";
const DEF_PROPERTIES: &str = "properties";
const DEF_FEATURED: &str = "featured";
const DEF_FOLDER: &str = "folder";

/// La cartella dei tipi di adesso, senza `/` ai bordi. `None` se è vuota (i
/// tipi sono spenti) o se non è un percorso del vault (`..`, spazio
/// macchina): una parola illeggibile spegne i tipi invece di farli cercare
/// fuori dal vault.
pub(crate) fn types_folder(host: &dyn ReadApi) -> Option<String> {
    let raw = match host.setting(TYPES_FOLDER_KEY) {
        Ok(SettingValue::Text(raw)) => raw,
        // Chiave non dichiarata (un banco senza il core): vale il default.
        Err(_) => TYPES_FOLDER_DEFAULT.to_string(),
        Ok(_) => return None,
    };
    folder_path(&raw).ok().flatten()
}

/// Una cartella del vault scritta da una persona: senza spazi e `/` ai bordi,
/// `Ok(None)` se vuota, `Err` se risale (`..`) o nomina lo spazio macchina.
/// La sonda `{cartella}/_` la giudica come il nome di una nota che vi nasce.
fn folder_path(raw: &str) -> Result<Option<String>, ()> {
    let folder = raw.trim().trim_matches('/');
    if folder.is_empty() {
        return Ok(None);
    }
    check_name(&format!("{folder}/_"), Naming::New)
        .map(|_| Some(folder.to_string()))
        .map_err(|_| ())
}

/// Un tipo trovato nella cartella dei tipi, prima di leggerlo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TypeRef {
    pub(crate) doc: DocId,
    /// Il percorso senza estensione, quello che il link scrive: `Tipi/Libro`.
    pub(crate) link: String,
    /// Il nome che si legge: `Libro`.
    pub(crate) name: String,
}

impl TypeRef {
    fn of(doc: DocId) -> Self {
        let link = without_extension(doc.as_str()).to_string();
        let name = link.rsplit('/').next().unwrap_or(&link).to_string();
        TypeRef { doc, link, name }
    }

    /// Il valore che una nota scrive in `tipo`: un wikilink al percorso intero,
    /// così due tipi con lo stesso nome in due sottocartelle restano distinti.
    pub(crate) fn wikilink(&self) -> String {
        format!("[[{}]]", self.link)
    }
}

/// Il percorso senza l'estensione dell'ultimo segmento.
fn without_extension(path: &str) -> &str {
    let last = path.rsplit('/').next().unwrap_or(path);
    match last.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => &path[..path.len() - last.len() + stem.len()],
        _ => path,
    }
}

/// I tipi del vault, in ordine di percorso: le note della cartella dei tipi
/// (sottocartelle comprese) il cui formato ha un frontmatter. Vuoto se la
/// cartella non c'è o i tipi sono spenti.
pub(crate) fn type_refs(host: &dyn ReadApi) -> Result<Vec<TypeRef>, PluginError> {
    let Some(folder) = types_folder(host) else {
        return Ok(Vec::new());
    };
    let found = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Folder {
                path: folder,
                descendants: true,
            }),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?;
    let mut refs: Vec<TypeRef> = found
        .items
        .into_iter()
        .map(|row| row.doc)
        .filter(|doc| crate::formats::understands(host, doc, fub_abi::options::syntax::FRONTMATTER))
        .map(TypeRef::of)
        .collect();
    refs.sort_by(|a, b| a.doc.cmp(&b.doc));
    Ok(refs)
}

/// Una proprietà dichiarata da un tipo.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TypeProperty {
    pub(crate) key: String,
    /// La parola scritta nel tipo (`numero`, `number`), se ce n'è una.
    pub(crate) declared: Option<String>,
    /// Ciò che la parola vuol dire, se Fub la conosce.
    pub(crate) kind: Option<PropertyType>,
}

impl TypeProperty {
    /// Il tipo che vale davvero: quello del registro del vault, se ne dice
    /// uno; altrimenti quello del tipo di nota.
    pub(crate) fn effective(&self, registry: &PropertyTypes) -> Option<PropertyType> {
        registry.resolve(&self.key).or(self.kind)
    }

    /// Il registro dice un tipo diverso da quello scritto nel tipo di nota:
    /// vale il registro, e chi mostra il tipo lo deve dire.
    pub(crate) fn conflict(&self, registry: &PropertyTypes) -> Option<PropertyType> {
        match (registry.resolve(&self.key), self.kind) {
            (Some(registered), Some(own)) if registered != own => Some(registered),
            _ => None,
        }
    }

    /// Il valore con cui la proprietà nasce in una nota: falso per una
    /// casella, un elenco vuoto per un elenco, vuoto (`chiave:`) per il resto.
    pub(crate) fn empty_value(&self, registry: &PropertyTypes) -> serde_json::Value {
        match self.effective(registry) {
            Some(PropertyType::Checkbox) => serde_json::Value::Bool(false),
            Some(PropertyType::List | PropertyType::Tags) => serde_json::json!([]),
            _ => serde_json::Value::Null,
        }
    }
}

/// Un tipo letto.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NoteType {
    pub(crate) reference: TypeRef,
    pub(crate) icon: Option<String>,
    pub(crate) properties: Vec<TypeProperty>,
    /// Le proprietà in evidenza, nell'ordine scritto.
    pub(crate) featured: Vec<String>,
    /// La cartella delle note nuove, già controllata.
    pub(crate) folder: Option<String>,
    /// Il modello: il testo dopo il frontmatter, byte per byte.
    pub(crate) template: String,
}

/// Il perché un tipo non si legge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Unreadable {
    /// Il frontmatter non è YAML: la ragione è quella del provider.
    Yaml(String),
    /// Un campo ha la forma sbagliata.
    Field { field: String, expected: Expected },
    /// `folder` risale o nomina lo spazio macchina.
    Folder(String),
    /// Il file del tipo non si apre.
    File,
}

/// La forma che un campo del tipo doveva avere.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Expected {
    Text,
    /// Una mappa `proprietà: tipo`, o un elenco di nomi.
    Properties,
    /// Un elenco di nomi.
    Keys,
}

impl Unreadable {
    fn field(field: &str, expected: Expected) -> Self {
        Unreadable::Field {
            field: field.to_string(),
            expected,
        }
    }
}

/// Che cosa vuol dire la parola di un tipo di proprietà, in italiano o con
/// l'id del registro. Una parola che Fub non conosce (`persone`) resta
/// scritta nel tipo e non dà un tipo: decide il registro, o nessuno.
pub(crate) fn property_kind(word: &str) -> Option<PropertyType> {
    // Le parole sono ASCII: la corsia ASCII dà la stessa risposta della
    // piegatura piena, e una parola con altri caratteri non è nessuna di loro.
    let word = word.trim().to_ascii_lowercase();
    Some(match word.as_str() {
        "text" | "testo" => PropertyType::Text,
        "list" | "elenco" | "lista" => PropertyType::List,
        "number" | "numero" => PropertyType::Number,
        "checkbox" | "casella" => PropertyType::Checkbox,
        "date" | "data" => PropertyType::Date,
        "date_time" | "datetime" | "data e ora" | "data_ora" => PropertyType::DateTime,
        "tags" | "etichette" => PropertyType::Tags,
        "select" | "selezione" => PropertyType::Select,
        "status" | "stato" => PropertyType::Status,
        "url" | "indirizzo" => PropertyType::Url,
        _ => return None,
    })
}

/// Legge un tipo dal suo modello e dal suo sorgente.
pub(crate) fn read_type(
    reference: TypeRef,
    model: &DocumentModel,
    source: &str,
) -> Result<NoteType, Unreadable> {
    if let Some(Block::Custom {
        custom_kind, attrs, ..
    }) = model.body.first()
    {
        if custom_kind == custom_kind::FRONTMATTER_UNPARSED {
            let reason = attrs
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            return Err(Unreadable::Yaml(reason.to_string()));
        }
    }
    let fm = &model.frontmatter;
    let icon = match fm.get(DEF_ICON) {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(icon)) if icon.trim().is_empty() => None,
        Some(serde_json::Value::String(icon)) => Some(icon.trim().to_string()),
        Some(_) => return Err(Unreadable::field(DEF_ICON, Expected::Text)),
    };
    let properties = match fm.get(DEF_PROPERTIES) {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Object(map)) => {
            let mut out = Vec::with_capacity(map.len());
            for (key, word) in map {
                let declared = match word {
                    serde_json::Value::Null => None,
                    serde_json::Value::String(word) if word.trim().is_empty() => None,
                    serde_json::Value::String(word) => Some(word.trim().to_string()),
                    _ => {
                        return Err(Unreadable::field(
                            &format!("{DEF_PROPERTIES}.{key}"),
                            Expected::Text,
                        ))
                    }
                };
                out.push(TypeProperty {
                    key: key.clone(),
                    kind: declared.as_deref().and_then(property_kind),
                    declared,
                });
            }
            out
        }
        // Anche soltanto i nomi: `properties: [autore, anno]`.
        Some(serde_json::Value::Array(keys)) => {
            let mut out = Vec::with_capacity(keys.len());
            for key in keys {
                let Some(key) = key.as_str().filter(|k| !k.trim().is_empty()) else {
                    return Err(Unreadable::field(DEF_PROPERTIES, Expected::Properties));
                };
                out.push(TypeProperty {
                    key: key.trim().to_string(),
                    declared: None,
                    kind: None,
                });
            }
            out
        }
        Some(_) => return Err(Unreadable::field(DEF_PROPERTIES, Expected::Properties)),
    };
    let featured = match fm.get(DEF_FEATURED) {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::String(key)) => vec![key.trim().to_string()],
        Some(serde_json::Value::Array(keys)) => {
            let mut out = Vec::with_capacity(keys.len());
            for key in keys {
                let Some(key) = key.as_str() else {
                    return Err(Unreadable::field(DEF_FEATURED, Expected::Keys));
                };
                out.push(key.trim().to_string());
            }
            out
        }
        Some(_) => return Err(Unreadable::field(DEF_FEATURED, Expected::Keys)),
    };
    let folder = match fm.get(DEF_FOLDER) {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(raw)) => {
            folder_path(raw).map_err(|()| Unreadable::Folder(raw.clone()))?
        }
        Some(_) => return Err(Unreadable::field(DEF_FOLDER, Expected::Text)),
    };
    let template = match model.body_start(source) {
        Ok(Some(start)) => source[start..].to_string(),
        Ok(None) => source.to_string(),
        // Il modello non viene da questo sorgente: meglio niente modello che
        // un pezzo di frontmatter nel testo della nota nuova.
        Err(_) => return Err(Unreadable::File),
    };
    Ok(NoteType {
        reference,
        icon,
        properties,
        featured,
        folder,
        template,
    })
}

/// Legge un tipo dall'host. L'errore dell'host (il file non c'è più, non si
/// legge) torna com'è; un tipo che si apre ma non si capisce è `Ok(Err)`.
pub(crate) fn load_type(
    host: &dyn ReadApi,
    reference: TypeRef,
) -> Result<Result<NoteType, Unreadable>, PluginError> {
    let source = host.read_document(&reference.doc)?;
    let model = host.read_model(&reference.doc)?;
    Ok(read_type(reference, &model, &source))
}

/// Il tipo che un valore di `tipo` nomina, scritto come lo scrive Fub
/// (`"[[Tipi/Libro]]"`), come un link qualunque o come testo (`Libro`).
/// `None` se il valore non nomina niente (vuoto, un numero, un elenco di
/// più tipi).
pub(crate) fn wanted_of_json(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => wanted_of_text(text),
        serde_json::Value::Array(items) if items.len() == 1 => wanted_of_json(&items[0]),
        _ => None,
    }
}

/// Come [`wanted_of_json`], dal valore che l'indice restituisce.
pub(crate) fn wanted_of_value(value: &PropertyValue) -> Option<String> {
    match value {
        PropertyValue::Text(text) => wanted_of_text(text),
        PropertyValue::Link(target) => wanted_of_link(target),
        PropertyValue::List(items) if items.len() == 1 => match &items[0] {
            PropertyScalar::Text(text) => wanted_of_text(text),
            PropertyScalar::Link(target) => wanted_of_link(target),
            _ => None,
        },
        _ => None,
    }
}

fn wanted_of_link(target: &LinkTarget) -> Option<String> {
    match target {
        LinkTarget::Wiki { page, .. } => non_empty(page),
        LinkTarget::Path(path) => non_empty(without_extension(path)),
        LinkTarget::Url(_) => None,
    }
}

fn wanted_of_text(text: &str) -> Option<String> {
    let text = text.trim();
    if let Some(inner) = text.strip_prefix("[[").and_then(|t| t.strip_suffix("]]")) {
        return wanted_of_link(&parse_wikilink_inner(inner).target);
    }
    non_empty(text)
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// A chi porta un nome scritto in `tipo`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Resolution {
    Found(TypeRef),
    /// Nessun tipo con quel nome (o i tipi sono spenti).
    Missing,
    /// Più tipi con quel nome, in sottocartelle diverse: il nome da solo non
    /// sceglie, ci vuole il percorso.
    Ambiguous(Vec<DocId>),
}

/// Il tipo che `wanted` nomina fra `types`. Si confronta con la chiave dei
/// nomi di documento (`resolution_key`: NFC, senza badare alle maiuscole),
/// come un link: prima il percorso intero (`Tipi/Libro`, con o
/// senza estensione), poi il percorso dentro la cartella dei tipi
/// (`Lavoro/Progetto`), poi il solo nome, che deve essere di un tipo solo.
pub(crate) fn resolve(types: &[TypeRef], folder: Option<&str>, wanted: &str) -> Resolution {
    match Resolver::new(types, folder).position(wanted) {
        Picked::Missing => Resolution::Missing,
        Picked::Found(at) => Resolution::Found(types[at].clone()),
        Picked::Ambiguous(many) => {
            Resolution::Ambiguous(many.iter().map(|&at| types[at].doc.clone()).collect())
        }
    }
}

/// La risoluzione di [`resolve`] con le chiavi dei tipi calcolate una volta:
/// chi risolve il `tipo` di tutte le note del vault non rifà la chiave di ogni
/// tipo per ogni nota.
pub(crate) struct Resolver {
    /// Per ogni tipo, nello stesso ordine: la chiave del link, del percorso e
    /// del nome.
    keys: Vec<[String; 3]>,
    /// La chiave della cartella dei tipi, se c'è.
    folder: Option<String>,
}

/// A quale tipo porta un nome, per posizione in `types`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Picked {
    Found(usize),
    Missing,
    Ambiguous(Vec<usize>),
}

impl Resolver {
    pub(crate) fn new(types: &[TypeRef], folder: Option<&str>) -> Self {
        let key = fub_abi::rules::path::resolution_key;
        Resolver {
            keys: types
                .iter()
                .map(|t| [key(&t.link), key(t.doc.as_str()), key(&t.name)])
                .collect(),
            folder: folder.map(key),
        }
    }

    /// Il tipo che `wanted` nomina: prima il percorso intero, poi quello
    /// dentro la cartella dei tipi, poi il solo nome (vedi [`resolve`]).
    pub(crate) fn position(&self, wanted: &str) -> Picked {
        let wanted = fub_abi::rules::path::resolution_key(wanted);
        let pick = |hits: Vec<usize>| match hits.as_slice() {
            [] => None,
            [one] => Some(Picked::Found(*one)),
            _ => Some(Picked::Ambiguous(hits)),
        };
        let matching = |test: &dyn Fn(&[String; 3]) -> bool| -> Vec<usize> {
            (0..self.keys.len())
                .filter(|&at| test(&self.keys[at]))
                .collect()
        };
        if let Some(found) = pick(matching(&|[link, doc, _]| *link == wanted || *doc == wanted)) {
            return found;
        }
        if let Some(folder) = &self.folder {
            let inside = format!("{folder}/{wanted}");
            if let Some(found) = pick(matching(&|[link, _, _]| *link == inside)) {
                return found;
            }
        }
        if !wanted.contains('/') {
            if let Some(found) = pick(matching(&|[_, _, name]| *name == wanted)) {
                return found;
            }
        }
        Picked::Missing
    }
}

/// Il tipo di una nota, com'è adesso.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TypeState {
    /// La nota non dice un tipo.
    Untyped,
    Typed(NoteType),
    /// La nota nomina un tipo che non c'è.
    Missing {
        wanted: String,
    },
    /// Il nome è di più tipi.
    Ambiguous {
        wanted: String,
        candidates: Vec<DocId>,
    },
    /// Il tipo c'è ma non si legge.
    Unreadable {
        doc: DocId,
        why: Unreadable,
    },
    /// `tipo` c'è ma non nomina niente (un numero, un elenco di più valori).
    NotAName,
}

/// Il tipo di una nota dal suo modello. In tutti i casi la nota resta com'è:
/// è chi mostra lo stato a dire che cosa non va.
pub(crate) fn state_of(
    host: &dyn ReadApi,
    model: &DocumentModel,
) -> Result<TypeState, PluginError> {
    let Some(value) = model.frontmatter.get(TYPE_KEY) else {
        return Ok(TypeState::Untyped);
    };
    let Some(wanted) = wanted_of_json(value) else {
        return Ok(if value.is_null() {
            TypeState::Untyped
        } else {
            TypeState::NotAName
        });
    };
    state_of_wanted(host, wanted)
}

/// Il tipo che il nome `wanted` (già tolto dal valore di `tipo`, vedi
/// [`wanted_of_json`]) nomina, com'è adesso: la metà di [`state_of`] che non
/// guarda la nota.
pub(crate) fn state_of_wanted(
    host: &dyn ReadApi,
    wanted: String,
) -> Result<TypeState, PluginError> {
    let folder = types_folder(host);
    let types = type_refs(host)?;
    Ok(match resolve(&types, folder.as_deref(), &wanted) {
        Resolution::Missing => TypeState::Missing { wanted },
        Resolution::Ambiguous(candidates) => TypeState::Ambiguous { wanted, candidates },
        Resolution::Found(reference) => {
            let doc = reference.doc.clone();
            match load_type(host, reference) {
                Ok(Ok(found)) => TypeState::Typed(found),
                Ok(Err(why)) => TypeState::Unreadable { doc, why },
                // Sparito fra l'elenco e la lettura: per chi guarda non c'è.
                Err(PluginError::NotFound(_)) => TypeState::Missing { wanted },
                Err(_) => TypeState::Unreadable {
                    doc,
                    why: Unreadable::File,
                },
            }
        }
    })
}

/// Se `doc` è un tipo (sta nella cartella dei tipi e il suo formato ha un
/// frontmatter), com'è letto: è la pagina del tipo, che dice ciò che non va.
pub(crate) fn as_type(
    host: &dyn ReadApi,
    doc: &DocId,
    model: &DocumentModel,
    source: &str,
) -> Option<Result<NoteType, Unreadable>> {
    let folder = types_folder(host)?;
    if !doc.as_str().starts_with(&format!("{folder}/"))
        || !crate::formats::understands(host, doc, fub_abi::options::syntax::FRONTMATTER)
    {
        return None;
    }
    Some(read_type(TypeRef::of(doc.clone()), model, source))
}

/// Un tipo coi suoi numeri, per l'elenco dei tipi.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TypeCount {
    pub(crate) reference: TypeRef,
    /// Le note che lo nominano e che portano a lui solo.
    pub(crate) notes: u32,
    /// L'icona, se il tipo si legge e ne dice una.
    pub(crate) icon: Option<String>,
    /// Il tipo non si legge: si elenca lo stesso, perché lo si possa aprire
    /// e aggiustare.
    pub(crate) unreadable: Option<Unreadable>,
    /// Il tipo letto, se si legge: chi elenca i tipi ne mostra le proprietà.
    pub(crate) found: Option<NoteType>,
}

/// I tipi del vault con quante note ha ognuno, in ordine di percorso. Le
/// note si contano con [`typed_notes`]: un valore che non porta a un tipo
/// solo non conta per nessuno.
pub(crate) fn counts(host: &dyn ReadApi) -> Result<Vec<TypeCount>, PluginError> {
    let types = type_refs(host)?;
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let folder = types_folder(host);
    let notes: Vec<u32> = typed_notes(host, &types, folder.as_deref(), &[])?
        .iter()
        .map(|rows| u32::try_from(rows.len()).unwrap_or(u32::MAX))
        .collect();
    let mut out = Vec::with_capacity(types.len());
    for (reference, notes) in types.into_iter().zip(notes) {
        let (found, unreadable) = match load_type(host, reference.clone()) {
            Ok(Ok(found)) => (Some(found), None),
            Ok(Err(why)) => (None, Some(why)),
            Err(_) => (None, Some(Unreadable::File)),
        };
        out.push(TypeCount {
            reference,
            notes,
            icon: found.as_ref().and_then(|f| f.icon.clone()),
            unreadable,
            found,
        });
    }
    Ok(out)
}

/// Le note di ogni tipo di `types`, nello stesso ordine: una domanda sola
/// all'indice (`tipo` presente, con il suo valore e le chiavi `extra`), poi
/// la stessa risoluzione di [`state_of`]. Un valore che non porta a un tipo
/// solo non va a nessuno. Dentro ogni tipo le note stanno in ordine di
/// percorso.
pub(crate) fn typed_notes(
    host: &dyn ReadApi,
    types: &[TypeRef],
    folder: Option<&str>,
    extra: &[&str],
) -> Result<Vec<Vec<DocumentMatch>>, PluginError> {
    let mut out: Vec<Vec<DocumentMatch>> = vec![Vec::new(); types.len()];
    for (at, row) in typed_rows(host, types, folder, extra)? {
        out[at].push(row);
    }
    for rows in &mut out {
        rows.sort_by(|a, b| a.doc.cmp(&b.doc));
    }
    Ok(out)
}

/// Le note di un tipo solo, `types[of]`, per chi ne mostra le prime `shown`
/// (la pagina del tipo): quante sono in tutto e le prime in ordine di
/// percorso, con le chiavi `extra`. Le stesse note che [`typed_notes`] dà a
/// quel tipo, ma senza ordinare le note degli altri tipi e chiedendo le
/// chiavi `extra` soltanto per le righe che si mostrano.
pub(crate) fn notes_of_type(
    host: &dyn ReadApi,
    types: &[TypeRef],
    folder: Option<&str>,
    of: usize,
    extra: &[&str],
    shown: usize,
) -> Result<(usize, Vec<DocumentMatch>), PluginError> {
    let mut rows: Vec<DocumentMatch> = typed_rows(host, types, folder, &[])?
        .into_iter()
        .filter_map(|(at, row)| (at == of).then_some(row))
        .collect();
    let total = rows.len();
    if rows.len() > shown {
        if shown > 0 {
            rows.select_nth_unstable_by(shown - 1, |a, b| a.doc.cmp(&b.doc));
        }
        rows.truncate(shown);
    }
    rows.sort_by(|a, b| a.doc.cmp(&b.doc));
    let extra: Vec<&str> = extra
        .iter()
        .copied()
        .filter(|key| *key != TYPE_KEY)
        .collect();
    if extra.is_empty() || rows.is_empty() {
        return Ok((total, rows));
    }
    // Le colonne in evidenza, per le sole righe mostrate. Una nota sparita
    // fra le due domande resta col suo nome solo: il prossimo evento
    // dell'indice ridisegna la pagina.
    let mut columns: std::collections::HashMap<DocId, Vec<_>> = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Docs {
                docs: rows.iter().map(|row| row.doc.clone()).collect(),
            }),
            sort: None,
            select: PropertySelect::keys(&extra),
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?
        .items
        .into_iter()
        .map(|row| (row.doc, row.properties))
        .collect();
    for row in &mut rows {
        if let Some(properties) = columns.remove(&row.doc) {
            row.properties.extend(properties);
        }
    }
    Ok((total, rows))
}

/// Ogni nota col `tipo` e il tipo di `types` a cui porta, per posizione: una
/// domanda sola all'indice (`tipo` presente, con il suo valore e le chiavi
/// `extra`), poi la stessa risoluzione di [`state_of`]. Un valore che non
/// porta a un tipo solo non va a nessuno. Lo stesso valore scritto in molte
/// note si risolve una volta.
fn typed_rows(
    host: &dyn ReadApi,
    types: &[TypeRef],
    folder: Option<&str>,
    extra: &[&str],
) -> Result<Vec<(usize, DocumentMatch)>, PluginError> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let mut keys = vec![TYPE_KEY];
    keys.extend(extra.iter().copied().filter(|key| *key != TYPE_KEY));
    let typed = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Property {
                filter: PropertyFilter {
                    key: TYPE_KEY.to_string(),
                    test: PropertyTest::Exists,
                },
            }),
            sort: None,
            select: PropertySelect::keys(&keys),
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?;
    let resolver = Resolver::new(types, folder);
    let mut known: std::collections::HashMap<String, Option<usize>> =
        std::collections::HashMap::new();
    let mut out = Vec::with_capacity(typed.items.len());
    for row in typed.items {
        let Some(wanted) = row
            .properties
            .iter()
            .find(|p| p.key == TYPE_KEY)
            .and_then(|p| wanted_of_value(&p.value))
        else {
            continue;
        };
        let at = match known.get(&wanted) {
            Some(at) => *at,
            None => {
                let at = match resolver.position(&wanted) {
                    Picked::Found(at) => Some(at),
                    Picked::Missing | Picked::Ambiguous(_) => None,
                };
                known.insert(wanted, at);
                at
            }
        };
        if let Some(at) = at {
            out.push((at, row));
        }
    }
    Ok(out)
}

/// Una riga `chiave: valore` di frontmatter, scritta come la scriverebbe una
/// persona: la chiave nuda se YAML la legge così, il valore in JSON (che è
/// YAML), e niente dopo i due punti per un valore vuoto.
pub(crate) fn frontmatter_line(key: &str, value: &serde_json::Value) -> String {
    let plain = key.chars().enumerate().all(|(index, c)| {
        c == '_'
            || c == '-'
            || c == '.'
            || c.is_alphanumeric() && (index > 0 || !c.is_ascii_digit())
    }) && !key.is_empty()
        && !matches!(
            key.to_ascii_lowercase().as_str(),
            "null" | "true" | "false" | "~"
        );
    let key = if plain {
        key.to_string()
    } else {
        serde_json::to_string(key).unwrap_or_else(|_| format!("\"{key}\""))
    };
    if value.is_null() {
        format!("{key}:")
    } else {
        format!("{key}: {value}")
    }
}

// ---------------------------------------------------------------------------
// Le parole: ogni feature che usa questo modulo le porta nel suo catalogo con
// [`speaking`], come fa `formats` con le sue.
// ---------------------------------------------------------------------------

const E_NONE: &str = "note_type.e_none";
const E_OFF: &str = "note_type.e_off";
const E_MISSING: &str = "note_type.e_missing";
const E_AMBIGUOUS: &str = "note_type.e_ambiguous";
const E_YAML: &str = "note_type.e_yaml";
const E_TEXT: &str = "note_type.e_text";
const E_PROPERTIES: &str = "note_type.e_properties";
const E_KEYS: &str = "note_type.e_keys";
const E_FOLDER: &str = "note_type.e_folder";
const E_FILE: &str = "note_type.e_file";
const E_CHANGED: &str = "note_type.e_changed";
const S_MISSING: &str = "note_type.s_missing";
const S_NOT_A_NAME: &str = "note_type.s_not_a_name";
const S_CONFLICT: &str = "note_type.s_conflict";

const A_TYPE: &str = "type";
const A_FOLDER: &str = "folder";
const A_FIELD: &str = "field";
const A_REASON: &str = "reason";
const A_VALUE: &str = "value";
const A_CANDIDATES: &str = "candidates";
const A_KEY: &str = "key";

/// Le parole dei tipi, in italiano e in inglese, aggiunte ai cataloghi di
/// quelle due lingue (le altre ripiegano, come il resto del catalogo).
pub(crate) fn speaking(mut catalogs: Vec<StringCatalog>) -> Vec<StringCatalog> {
    for catalog in &mut catalogs {
        let (rows, kinds, conflict) = match catalog.locale.as_str() {
            "it" => (&IT, &KINDS_IT, CONFLICT_IT),
            "en" => (&EN, &KINDS_EN, CONFLICT_EN),
            _ => continue,
        };
        for (key, template) in rows.iter() {
            catalog
                .entries
                .insert(key.to_string(), template.to_string());
        }
        for (kind, label) in kinds.iter() {
            catalog.entries.insert(
                format!("{S_CONFLICT}.{kind}"),
                conflict.replace("{kind}", label),
            );
        }
    }
    catalogs
}

const IT: [(&str, &str); 13] = [
    (E_NONE, "Nessun tipo indicato."),
    (E_OFF, "I tipi di nota sono spenti: la loro cartella è vuota nelle impostazioni (File)."),
    (E_MISSING, "Il tipo «{type}» non c'è in {folder}/."),
    (E_AMBIGUOUS, "Ci sono più tipi «{type}» ({candidates}): scegli quello col percorso."),
    (E_YAML, "Il tipo «{type}» non si legge: il frontmatter ha un errore ({reason}). Aprilo e correggilo."),
    (E_TEXT, "Il tipo «{type}» non si legge: «{field}» deve essere un testo. Aprilo e correggilo."),
    (E_PROPERTIES, "Il tipo «{type}» non si legge: «{field}» deve dire le proprietà, una per riga col loro tipo. Aprilo e correggilo."),
    (E_KEYS, "Il tipo «{type}» non si legge: «{field}» deve essere un elenco di nomi di proprietà. Aprilo e correggilo."),
    (E_FOLDER, "Il tipo «{type}» non si legge: la cartella «{value}» risale o nomina lo spazio macchina. Aprilo e correggilo."),
    (E_FILE, "Il tipo «{type}» non si apre."),
    (E_CHANGED, "Il tipo «{type}» è cambiato mentre lo sceglievi: riprova."),
    (S_MISSING, "Il tipo «{type}» non c'è: la nota resta com'è."),
    (S_NOT_A_NAME, "«tipo» non nomina un tipo: scrivi un link, come \"[[Tipi/Libro]]\"."),
];

const EN: [(&str, &str); 13] = [
    (E_NONE, "No type given."),
    (E_OFF, "Note types are off: their folder is empty in the settings (Files)."),
    (E_MISSING, "There is no type «{type}» in {folder}/."),
    (E_AMBIGUOUS, "There are several types «{type}» ({candidates}): pick one by its path."),
    (E_YAML, "Type «{type}» can't be read: its frontmatter has an error ({reason}). Open it and fix it."),
    (E_TEXT, "Type «{type}» can't be read: «{field}» must be text. Open it and fix it."),
    (E_PROPERTIES, "Type «{type}» can't be read: «{field}» must list the properties, one per line with their type. Open it and fix it."),
    (E_KEYS, "Type «{type}» can't be read: «{field}» must be a list of property names. Open it and fix it."),
    (E_FOLDER, "Type «{type}» can't be read: folder «{value}» climbs out or names the machine space. Open it and fix it."),
    (E_FILE, "Type «{type}» can't be opened."),
    (E_CHANGED, "Type «{type}» changed while you were choosing it: try again."),
    (S_MISSING, "Type «{type}» doesn't exist: the note stays as it is."),
    (S_NOT_A_NAME, "«tipo» doesn't name a type: write a link, like \"[[Tipi/Libro]]\"."),
];

const CONFLICT_IT: &str =
    "«{key}» è {kind} in tutto il vault: vale quello, non il tipo scritto qui.";
const CONFLICT_EN: &str =
    "«{key}» is {kind} in the whole vault: that wins over the type written here.";

/// I nomi dei tipi di proprietà, per id del registro.
const KINDS_IT: [(&str, &str); 10] = [
    ("text", "Testo"),
    ("list", "Elenco"),
    ("number", "Numero"),
    ("checkbox", "Casella"),
    ("date", "Data"),
    ("date_time", "Data e ora"),
    ("tags", "Etichette"),
    ("select", "Selezione"),
    ("status", "Stato"),
    ("url", "Indirizzo"),
];
const KINDS_EN: [(&str, &str); 10] = [
    ("text", "Text"),
    ("list", "List"),
    ("number", "Number"),
    ("checkbox", "Checkbox"),
    ("date", "Date"),
    ("date_time", "Date and time"),
    ("tags", "Tags"),
    ("select", "Select"),
    ("status", "Status"),
    ("url", "Address"),
];

/// L'id del registro di un tipo di proprietà (`number`, `date_time`).
pub(crate) fn kind_id(kind: PropertyType) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Che cosa non va in un tipo che non si legge, detto a chi lo usa.
pub(crate) fn unreadable_text(name: &str, why: &Unreadable) -> Text {
    let ty = Arg::text(A_TYPE, name);
    match why {
        Unreadable::Yaml(reason) => {
            Text::message(E_YAML, vec![ty, Arg::text(A_REASON, reason.as_str())])
        }
        Unreadable::Field { field, expected } => Text::message(
            match expected {
                Expected::Text => E_TEXT,
                Expected::Properties => E_PROPERTIES,
                Expected::Keys => E_KEYS,
            },
            vec![ty, Arg::text(A_FIELD, field.as_str())],
        ),
        Unreadable::Folder(value) => {
            Text::message(E_FOLDER, vec![ty, Arg::text(A_VALUE, value.as_str())])
        }
        Unreadable::File => Text::message(E_FILE, vec![ty]),
    }
}

/// Che cosa dire del tipo di una nota, se c'è qualcosa da dire: un tipo che
/// manca, che è di più, che non si legge. `None` per una nota senza tipo o
/// con un tipo che va.
pub(crate) fn state_text(state: &TypeState) -> Option<Text> {
    match state {
        TypeState::Untyped | TypeState::Typed(_) => None,
        TypeState::Missing { wanted } => Some(Text::message(
            S_MISSING,
            vec![Arg::text(A_TYPE, wanted.as_str())],
        )),
        TypeState::Ambiguous { wanted, candidates } => Some(ambiguous(wanted, candidates)),
        TypeState::Unreadable { doc, why } => Some(unreadable_text(doc.page_name(), why)),
        TypeState::NotAName => Some(Text::key(S_NOT_A_NAME)),
    }
}

fn ambiguous(wanted: &str, candidates: &[DocId]) -> Text {
    let list = candidates
        .iter()
        .map(|doc| without_extension(doc.as_str()))
        .collect::<Vec<_>>()
        .join(", ");
    Text::message(
        E_AMBIGUOUS,
        vec![Arg::text(A_TYPE, wanted), Arg::text(A_CANDIDATES, list)],
    )
}

/// Le proprietà per cui il registro del vault dice un tipo diverso da quello
/// scritto nel tipo di nota, dette una per una: vale il registro.
pub(crate) fn conflict_texts(found: &NoteType, registry: &PropertyTypes) -> Vec<Text> {
    found
        .properties
        .iter()
        .filter_map(|property| {
            property.conflict(registry).map(|registered| {
                Text::message(
                    format!("{S_CONFLICT}.{}", kind_id(registered)),
                    vec![Arg::text(A_KEY, property.key.as_str())],
                )
            })
        })
        .collect()
}

/// Il tipo che un comando nomina, letto, o il perché no: nessun tipo, tipi
/// spenti, un tipo che non c'è, che è di più o che non si legge. È la porta
/// dei comandi che scrivono: un tipo guasto non scrive niente.
pub(crate) fn find_type(host: &dyn ReadApi, raw: &str) -> Result<NoteType, PluginError> {
    let wanted = wanted_of_text(raw).ok_or_else(|| PluginError::BadArgs(Text::key(E_NONE)))?;
    let folder = types_folder(host).ok_or_else(|| PluginError::BadArgs(Text::key(E_OFF)))?;
    let types = type_refs(host)?;
    match resolve(&types, Some(&folder), &wanted) {
        Resolution::Missing => Err(PluginError::BadArgs(Text::message(
            E_MISSING,
            vec![
                Arg::text(A_TYPE, wanted.as_str()),
                Arg::text(A_FOLDER, folder.as_str()),
            ],
        ))),
        Resolution::Ambiguous(candidates) => {
            Err(PluginError::BadArgs(ambiguous(&wanted, &candidates)))
        }
        Resolution::Found(reference) => {
            let name = reference.name.clone();
            match load_type(host, reference)? {
                Ok(found) => Ok(found),
                Err(why) => Err(PluginError::BadArgs(unreadable_text(&name, &why))),
            }
        }
    }
}

/// Il tipo deve essere ancora quello che chi chiede ha letto: `expected` è
/// la revisione del file del tipo. Senza, non si controlla niente.
pub(crate) fn check_revision(
    host: &dyn ReadApi,
    found: &NoteType,
    expected: Option<&str>,
) -> Result<(), PluginError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if host.document_revision(&found.reference.doc)?.0 != expected {
        return Err(PluginError::Conflict(Text::message(
            E_CHANGED,
            vec![Arg::text(A_TYPE, found.reference.name.as_str())],
        )));
    }
    Ok(())
}

/// Il vault finto dei test dei tipi: ogni documento col modello che gli dà
/// il Markdown vero, perché `tipo` e le proprietà dei tipi si leggono dal
/// frontmatter come nell'app.
#[cfg(test)]
pub(crate) fn vault(docs: &[(&str, &str)]) -> fub_sdk::testing::MemoryHost {
    let mut host = fub_sdk::testing::MemoryHost::new();
    for (id, source) in docs {
        host = host
            .with_document(id, source)
            .with_model(id, parsed(id, source));
    }
    host
}

/// Il modello che il Markdown vero dà di `source`.
#[cfg(test)]
pub(crate) fn parsed(id: &str, source: &str) -> DocumentModel {
    use fub_abi::format::ParseContext;
    use fub_abi::FormatProvider;
    fub_format_markdown::MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian(id))
        .expect("il markdown si legge sempre")
}

/// La cartella dei tipi, scritta dall'utente.
#[cfg(test)]
pub(crate) fn with_types_folder(
    host: fub_sdk::testing::MemoryHost,
    folder: &str,
) -> fub_sdk::testing::MemoryHost {
    use fub_abi::settings::{SettingKind, SettingSpec};
    host.with_value(
        SettingSpec::new(
            TYPES_FOLDER_KEY,
            "tipi",
            SettingKind::Text {
                default: TYPES_FOLDER_DEFAULT.to_string(),
            },
        ),
        SettingValue::Text(folder.to_string()),
    )
}

/// Il tipo Libro dei test: proprietà con parole italiane, un modello, una
/// cartella.
#[cfg(test)]
pub(crate) const LIBRO: &str = "---\nicon: book\nproperties:\n  autore: testo\n  letto: casella\n  generi: elenco\nfeatured: [autore]\nfolder: Biblioteca\n---\n# {{title}}\n\nNote di lettura.\n";

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::VaultRead;

    fn refs(paths: &[&str]) -> Vec<TypeRef> {
        paths.iter().map(|p| TypeRef::of(DocId::new(*p))).collect()
    }

    #[test]
    fn a_link_a_path_and_a_bare_name_find_the_same_type() {
        let types = refs(&["Tipi/Libro.md", "Tipi/Lavoro/Progetto.md"]);
        let libro = Resolution::Found(types[0].clone());
        for wanted in [
            "Tipi/Libro",
            "tipi/libro",
            "Tipi/Libro.md",
            "Libro",
            "libro",
        ] {
            assert_eq!(resolve(&types, Some("Tipi"), wanted), libro, "{wanted}");
        }
        assert_eq!(
            resolve(&types, Some("Tipi"), "Lavoro/Progetto"),
            Resolution::Found(types[1].clone())
        );
        assert_eq!(resolve(&types, Some("Tipi"), "Film"), Resolution::Missing);
        assert_eq!(
            resolve(&types, Some("Tipi"), "Altro/Libro"),
            Resolution::Missing
        );
    }

    #[test]
    fn two_types_with_one_name_need_the_path() {
        let types = refs(&["Tipi/Casa/Progetto.md", "Tipi/Lavoro/Progetto.md"]);
        assert_eq!(
            resolve(&types, Some("Tipi"), "Progetto"),
            Resolution::Ambiguous(vec![
                DocId::new("Tipi/Casa/Progetto.md"),
                DocId::new("Tipi/Lavoro/Progetto.md")
            ])
        );
        assert_eq!(
            resolve(&types, Some("Tipi"), "[[Tipi/Casa/Progetto]]"),
            Resolution::Missing,
            "resolve riceve un nome, non un link: lo toglie wanted_of_*"
        );
        assert_eq!(
            resolve(&types, Some("Tipi"), "Tipi/Casa/Progetto"),
            Resolution::Found(types[0].clone())
        );
    }

    #[test]
    fn the_value_of_tipo_reads_as_link_or_text() {
        let wanted = |v: serde_json::Value| wanted_of_json(&v);
        assert_eq!(
            wanted(serde_json::json!("[[Tipi/Libro]]")),
            Some("Tipi/Libro".into())
        );
        assert_eq!(
            wanted(serde_json::json!("[[Tipi/Libro|il libro]]")),
            Some("Tipi/Libro".into())
        );
        assert_eq!(wanted(serde_json::json!("Libro")), Some("Libro".into()));
        assert_eq!(
            wanted(serde_json::json!(["[[Tipi/Libro]]"])),
            Some("Tipi/Libro".into())
        );
        assert_eq!(wanted(serde_json::json!(["Libro", "Film"])), None);
        assert_eq!(wanted(serde_json::json!(3)), None);
        assert_eq!(wanted(serde_json::json!("  ")), None);
        assert_eq!(
            wanted_of_value(&PropertyValue::Link(LinkTarget::wiki("Tipi/Libro"))),
            Some("Tipi/Libro".into())
        );
    }

    #[test]
    fn property_words_in_italian_and_registry_ids() {
        assert_eq!(property_kind("Numero"), Some(PropertyType::Number));
        assert_eq!(property_kind("checkbox"), Some(PropertyType::Checkbox));
        assert_eq!(property_kind("data e ora"), Some(PropertyType::DateTime));
        assert_eq!(property_kind("persone"), None);
    }

    #[test]
    fn a_line_is_written_as_a_person_would() {
        assert_eq!(
            frontmatter_line("autore", &serde_json::Value::Null),
            "autore:"
        );
        assert_eq!(
            frontmatter_line("letto", &serde_json::json!(false)),
            "letto: false"
        );
        assert_eq!(
            frontmatter_line("tipo", &serde_json::json!("[[Tipi/Libro]]")),
            "tipo: \"[[Tipi/Libro]]\""
        );
        assert_eq!(
            frontmatter_line("data di uscita", &serde_json::json!([])),
            "\"data di uscita\": []"
        );
        assert_eq!(
            frontmatter_line("true", &serde_json::Value::Null),
            "\"true\":"
        );
    }

    fn key_of(state: &TypeState) -> String {
        state_text(state)
            .map(|t| match t {
                Text::Message(m) => m.key,
                Text::Literal(s) => s,
            })
            .unwrap_or_default()
    }

    fn state(host: &fub_sdk::testing::MemoryHost, doc: &str) -> TypeState {
        let model = host.read_model(&DocId::new(doc)).unwrap();
        state_of(host, &model).unwrap()
    }

    #[test]
    fn a_typed_note_reads_its_type_from_the_folder() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: \"[[Tipi/Libro]]\"\n---\n"),
        ]);
        let TypeState::Typed(found) = state(&host, "Dune.md") else {
            panic!("il tipo c'è e si legge")
        };
        assert_eq!(found.reference.link, "Tipi/Libro");
        assert_eq!(found.icon.as_deref(), Some("book"));
        assert_eq!(found.folder.as_deref(), Some("Biblioteca"));
        assert_eq!(found.featured, vec!["autore".to_string()]);
        let keys: Vec<_> = found.properties.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(keys, ["autore", "letto", "generi"]);
        assert_eq!(found.properties[1].kind, Some(PropertyType::Checkbox));
        assert_eq!(found.template, "# {{title}}\n\nNote di lettura.\n");
    }

    #[test]
    fn tipo_written_as_plain_text_is_still_read() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
        ]);
        assert!(matches!(state(&host, "Dune.md"), TypeState::Typed(_)));
    }

    #[test]
    fn a_missing_type_leaves_the_note_and_says_so() {
        // Senza la cartella dei tipi: è il caso «la cartella non c'è».
        let host = vault(&[("Dune.md", "---\ntipo: \"[[Tipi/Libro]]\"\n---\ntesto\n")]);
        let now = state(&host, "Dune.md");
        assert_eq!(
            now,
            TypeState::Missing {
                wanted: "Tipi/Libro".into()
            }
        );
        assert_eq!(key_of(&now), S_MISSING);
        assert!(counts(&host).unwrap().is_empty());
        assert!(
            matches!(find_type(&host, "Libro"), Err(PluginError::BadArgs(Text::Message(m))) if m.key == E_MISSING)
        );
    }

    #[test]
    fn two_types_with_one_name_are_ambiguous_until_the_path_says_which() {
        let host = vault(&[
            ("Tipi/Casa/Progetto.md", "---\nproperties: [stanza]\n---\n"),
            (
                "Tipi/Lavoro/Progetto.md",
                "---\nproperties: [cliente]\n---\n",
            ),
            ("Bagno.md", "---\ntipo: Progetto\n---\n"),
            ("Sito.md", "---\ntipo: \"[[Tipi/Lavoro/Progetto]]\"\n---\n"),
        ]);
        let bagno = state(&host, "Bagno.md");
        assert!(
            matches!(bagno, TypeState::Ambiguous { ref candidates, .. } if candidates.len() == 2)
        );
        assert_eq!(key_of(&bagno), E_AMBIGUOUS);
        let TypeState::Typed(found) = state(&host, "Sito.md") else {
            panic!("il percorso sceglie")
        };
        assert_eq!(found.properties[0].key, "cliente");
        assert!(
            matches!(find_type(&host, "Progetto"), Err(PluginError::BadArgs(Text::Message(m))) if m.key == E_AMBIGUOUS)
        );
    }

    #[test]
    fn a_type_whose_frontmatter_does_not_read_is_named_not_guessed() {
        let host = vault(&[
            ("Tipi/Rotto.md", "---\nproperties: [a\n---\n"),
            ("Tipi/Storto.md", "---\nproperties: 3\n---\n"),
            ("Tipi/Fuori.md", "---\nfolder: ../fuori\n---\n"),
            ("A.md", "---\ntipo: Rotto\n---\n"),
            ("B.md", "---\ntipo: Storto\n---\n"),
            ("C.md", "---\ntipo: Fuori\n---\n"),
        ]);
        assert!(matches!(
            state(&host, "A.md"),
            TypeState::Unreadable {
                why: Unreadable::Yaml(_),
                ..
            }
        ));
        assert_eq!(key_of(&state(&host, "A.md")), E_YAML);
        assert!(matches!(
            state(&host, "B.md"),
            TypeState::Unreadable {
                why: Unreadable::Field {
                    expected: Expected::Properties,
                    ..
                },
                ..
            }
        ));
        assert!(matches!(
            state(&host, "C.md"),
            TypeState::Unreadable {
                why: Unreadable::Folder(_),
                ..
            }
        ));
        let err = find_type(&host, "Rotto").unwrap_err();
        assert!(
            matches!(&err, PluginError::BadArgs(Text::Message(m)) if m.key == E_YAML),
            "{err:?}"
        );
    }

    #[test]
    fn tipo_that_names_nothing_is_said_too() {
        let host = vault(&[("A.md", "---\ntipo: 3\n---\n")]);
        assert_eq!(state(&host, "A.md"), TypeState::NotAName);
        assert_eq!(key_of(&TypeState::NotAName), S_NOT_A_NAME);
    }

    #[test]
    fn the_types_folder_follows_the_setting() {
        let docs = [
            ("Tipi/Libro.md", LIBRO),
            ("Modelli/Tipi/Film.md", "---\nproperties: [regista]\n---\n"),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
            ("Alien.md", "---\ntipo: \"[[Modelli/Tipi/Film]]\"\n---\n"),
        ];
        let moved = with_types_folder(vault(&docs), "/Modelli/Tipi/");
        assert_eq!(types_folder(&moved).as_deref(), Some("Modelli/Tipi"));
        assert!(matches!(state(&moved, "Alien.md"), TypeState::Typed(_)));
        assert!(matches!(
            state(&moved, "Dune.md"),
            TypeState::Missing { .. }
        ));
        let listed: Vec<_> = counts(&moved)
            .unwrap()
            .into_iter()
            .map(|c| c.reference.link)
            .collect();
        assert_eq!(listed, ["Modelli/Tipi/Film"]);

        let off = with_types_folder(vault(&docs), "  ");
        assert_eq!(types_folder(&off), None);
        assert!(
            matches!(find_type(&off, "Libro"), Err(PluginError::BadArgs(Text::Message(m))) if m.key == E_OFF)
        );
        assert!(counts(&off).unwrap().is_empty());
        let outside = with_types_folder(vault(&docs), "../Tipi");
        assert_eq!(types_folder(&outside), None);
    }

    #[test]
    fn the_list_of_types_counts_the_notes_of_each() {
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Film.md", "---\nicon: film\n---\n"),
            ("Tipi/Rotto.md", "---\nicon: [a\n---\n"),
            ("Dune.md", "---\ntipo: \"[[Tipi/Libro]]\"\n---\n"),
            ("Emma.md", "---\ntipo: libro\n---\n"),
            ("Alien.md", "---\ntipo: Film\n---\n"),
            ("Perso.md", "---\ntipo: Quadro\n---\n"),
            ("Libera.md", "senza tipo\n"),
        ]);
        let list = counts(&host).unwrap();
        let rows: Vec<_> = list
            .iter()
            .map(|c| {
                (
                    c.reference.name.as_str(),
                    c.notes,
                    c.icon.as_deref(),
                    c.unreadable.is_some(),
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                ("Film", 1, Some("film"), false),
                ("Libro", 2, Some("book"), false),
                ("Rotto", 0, None, true),
            ]
        );
    }

    #[test]
    fn the_registry_wins_over_the_type_and_the_page_says_so() {
        let host = vault(&[("Tipi/Libro.md", LIBRO)]);
        let found = find_type(&host, "[[Tipi/Libro]]").unwrap();
        let mut registry = PropertyTypes::default();
        registry.types.insert("autore".into(), PropertyType::List);
        assert_eq!(
            found.properties[0].effective(&registry),
            Some(PropertyType::List)
        );
        let said = conflict_texts(&found, &registry);
        assert_eq!(said.len(), 1);
        assert!(matches!(&said[0], Text::Message(m) if m.key == format!("{S_CONFLICT}.list")));
        assert_eq!(
            found.properties[0].empty_value(&registry),
            serde_json::json!([])
        );
        assert_eq!(
            found.properties[1].empty_value(&registry),
            serde_json::json!(false)
        );
    }

    #[test]
    fn a_type_that_changed_since_it_was_read_stops_the_command() {
        let host = vault(&[("Tipi/Libro.md", LIBRO)]);
        let found = find_type(&host, "Libro").unwrap();
        let now = host.document_revision(&found.reference.doc).unwrap();
        assert!(check_revision(&host, &found, Some(now.as_str())).is_ok());
        assert!(check_revision(&host, &found, None).is_ok());
        assert!(matches!(
            check_revision(&host, &found, Some("vecchia")),
            Err(PluginError::Conflict(_))
        ));
    }

    /// Un generatore piccolo e ripetibile (xorshift64*): seme fisso, così un
    /// rosso si rifà uguale.
    struct Dice(u64);

    impl Dice {
        fn roll(&mut self, faces: usize) -> usize {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) % faces as u64) as usize
        }
    }

    /// La risoluzione com'era scritta prima delle chiavi calcolate una volta:
    /// ogni chiave rifatta a ogni confronto.
    fn resolve_by_hand(types: &[TypeRef], folder: Option<&str>, wanted: &str) -> Resolution {
        let key = fub_abi::rules::path::resolution_key;
        let wanted = key(wanted);
        let pick = |hits: Vec<&TypeRef>| match hits.as_slice() {
            [] => None,
            [one] => Some(Resolution::Found((*one).clone())),
            many => Some(Resolution::Ambiguous(
                many.iter().map(|t| t.doc.clone()).collect(),
            )),
        };
        let full = types
            .iter()
            .filter(|t| key(&t.link) == wanted || key(t.doc.as_str()) == wanted)
            .collect();
        if let Some(found) = pick(full) {
            return found;
        }
        if let Some(folder) = folder {
            let inside = format!("{}/{wanted}", key(folder));
            if let Some(found) = pick(types.iter().filter(|t| key(&t.link) == inside).collect()) {
                return found;
            }
        }
        if !wanted.contains('/') {
            if let Some(found) = pick(types.iter().filter(|t| key(&t.name) == wanted).collect()) {
                return found;
            }
        }
        Resolution::Missing
    }

    /// I tipi del vault a caso: omonimi in sottocartelle, maiuscole diverse.
    const TYPE_PATHS: [&str; 6] = [
        "Tipi/Libro.md",
        "Tipi/Film.md",
        "Tipi/Lavoro/Progetto.md",
        "Tipi/Casa/Progetto.md",
        "Tipi/Casa/Libro.md",
        "Tipi/Quadro.md",
    ];

    /// Un valore di `tipo` a caso, nelle forme che una persona scrive.
    fn random_wanted(dice: &mut Dice) -> String {
        let names = [
            "Libro", "libro", "LIBRO", "Film", "Progetto", "Quadro", "Statua", "Casa/Libro",
            "Lavoro/Progetto", "Tipi/Libro", "Tipi/Casa/Progetto.md", "tipi/film", "Altro/Libro",
        ];
        names[dice.roll(names.len())].to_string()
    }

    #[test]
    fn the_resolver_names_the_type_the_hand_resolution_names() {
        let types = refs(&TYPE_PATHS);
        let mut dice = Dice(0x7E57_2026_1120_0001);
        for folder in [Some("Tipi"), Some("tipi"), None] {
            let resolver = Resolver::new(&types, folder);
            for _ in 0..200 {
                let wanted = random_wanted(&mut dice);
                let expected = resolve_by_hand(&types, folder, &wanted);
                assert_eq!(resolve(&types, folder, &wanted), expected, "{wanted}");
                let picked = match resolver.position(&wanted) {
                    Picked::Found(at) => Resolution::Found(types[at].clone()),
                    Picked::Missing => Resolution::Missing,
                    Picked::Ambiguous(many) => {
                        Resolution::Ambiguous(many.iter().map(|&at| types[at].doc.clone()).collect())
                    }
                };
                assert_eq!(picked, expected, "{wanted}");
            }
        }
    }

    #[test]
    fn the_notes_of_one_type_are_those_the_full_scan_gives_it() {
        let mut dice = Dice(0x7E57_2026_1120_0002);
        for round in 0..6 {
            let mut docs: Vec<(String, String)> = TYPE_PATHS
                .iter()
                .map(|path| ((*path).to_string(), LIBRO.to_string()))
                .collect();
            for i in 0..40 + round * 20 {
                let tipo = match dice.roll(4) {
                    0 => format!("\"[[{}]]\"", random_wanted(&mut dice)),
                    1 => format!("\"{}\"", random_wanted(&mut dice)),
                    2 => random_wanted(&mut dice),
                    _ => "3".to_string(),
                };
                let autore = match dice.roll(3) {
                    0 => String::new(),
                    n => format!("autore: Autore {n}\n"),
                };
                docs.push((
                    format!("Note/{}/N{}.md", dice.roll(4), dice.roll(1_000) * 100 + i),
                    format!("---\ntipo: {tipo}\n{autore}letto: true\n---\n"),
                ));
            }
            let pairs: Vec<(&str, &str)> =
                docs.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
            let host = vault(&pairs);
            let types = type_refs(&host).unwrap();
            let folder = types_folder(&host);
            let extra = ["autore", "letto"];
            let full = typed_notes(&host, &types, folder.as_deref(), &extra).unwrap();
            for (of, all) in full.iter().enumerate() {
                for shown in [0, 1, 3, 50] {
                    let (total, rows) =
                        notes_of_type(&host, &types, folder.as_deref(), of, &extra, shown)
                            .unwrap();
                    assert_eq!(total, all.len(), "round {round}, type {of}");
                    let expected: Vec<(String, Vec<(String, String)>)> = all
                        .iter()
                        .take(shown)
                        .map(|row| (row.doc.as_str().to_string(), columns(row)))
                        .collect();
                    let got: Vec<(String, Vec<(String, String)>)> = rows
                        .iter()
                        .map(|row| (row.doc.as_str().to_string(), columns(row)))
                        .collect();
                    assert_eq!(got, expected, "round {round}, type {of}, shown {shown}");
                }
            }
        }
    }

    /// Le colonne di una riga, in ordine di chiave: la pagina le cerca per
    /// chiave, l'ordine in cui arrivano non conta.
    fn columns(row: &DocumentMatch) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = row
            .properties
            .iter()
            .map(|p| (p.key.clone(), format!("{:?}", p.value)))
            .collect();
        out.sort();
        out
    }

    #[test]
    fn every_word_has_both_languages() {
        let catalogs = speaking(vec![StringCatalog::new("it"), StringCatalog::new("en")]);
        assert_eq!(catalogs[0].entries.len(), catalogs[1].entries.len());
        for kind in [
            PropertyType::Text,
            PropertyType::List,
            PropertyType::Number,
            PropertyType::Checkbox,
            PropertyType::Date,
            PropertyType::DateTime,
            PropertyType::Tags,
            PropertyType::Select,
            PropertyType::Status,
            PropertyType::Url,
        ] {
            let key = format!("{S_CONFLICT}.{}", kind_id(kind));
            assert!(catalogs[0].entries.contains_key(&key), "{key}");
            assert!(catalogs[1].entries.contains_key(&key), "{key}");
        }
    }
}
