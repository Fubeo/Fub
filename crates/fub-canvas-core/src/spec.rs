//! Lo schema delle operazioni: il nome, i campi, il tipo e gli esempi di ogni
//! [`CanvasOp`], scritti una volta sola, nel nucleo.
//!
//! Da qui vengono tre cose che un modello legge prima di scrivere:
//! - [`OPS`]: una voce per operazione, con i suoi campi e i suoi esempi. I
//!   test di `tests/spec.rs` controllano che coincida con serde, campo per
//!   campo, e che ogni esempio compili su [`example_canvas`];
//! - [`json_schema`]: lo schema JSON 2020-12 della lista di operazioni;
//! - [`validate`]: i problemi di una lista, prima della lettura, con un codice,
//!   una posizione e, quando la correzione è una sola, l'operazione corretta.
//!
//! Le regole e i codici sono in `docs/reference/canvas-code.md`, «Lo schema».

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::model::{Canvas, CanvasError};
use crate::ops::color;

/// Quanto può differire un nome sbagliato da quello giusto, perché sia un
/// suggerimento: la distanza di Levenshtein al più di così.
const MAX_DISTANCE: usize = 2;

/// Un'operazione come la descrive il nucleo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpSpec {
    /// Il valore del campo `op`, come lo legge serde.
    pub name: &'static str,
    /// Una riga in italiano, per il modello e per la guida.
    pub summary_it: &'static str,
    /// I campi dell'operazione, senza `op`.
    pub fields: &'static [FieldSpec],
    /// Esempi in JSON. Ognuno si legge e compila sulla lavagna di
    /// [`example_canvas`].
    pub examples: &'static [&'static str],
}

/// Un campo di un'operazione.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FieldSpec {
    /// Il nome del campo nel JSON, come lo legge serde.
    pub name: &'static str,
    pub kind: FieldKind,
    /// Se serde lo vuole. Un campo facoltativo che manca non è un problema.
    pub required: bool,
    /// Il valore di serie, come testo JSON, se ce n'è uno.
    pub default: Option<&'static str>,
    /// Una frase in italiano che dice a che cosa serve il campo.
    pub doc_it: &'static str,
}

/// Il tipo JSON di un campo. Le varianti con un vocabolario lo portano con sé.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    /// Una stringa che è un id.
    Id,
    /// Una lista di stringhe che sono id.
    Ids,
    /// Un intero: anche `1.0` o `1e2` sono interi, `1.5` no.
    Number,
    /// Una stringa.
    Text,
    /// `true` o `false`.
    Bool,
    /// Una stringa presa da questo elenco.
    Enum(&'static [&'static str]),
    /// Un oggetto che è una scheda come nel file.
    Node,
    /// Un oggetto che è un arco come nel file.
    Edge,
    /// Un oggetto qualunque.
    Object,
    /// I campi nuovi di una scheda o di un arco (`set`): un oggetto, il cui
    /// `color` è un colore.
    Patch,
    /// Una lista di liste di numeri, `[[x, y], …]`.
    Points,
    /// Un colore di scheda o di arco: un nome, il numero da 1 a 6, o `#rrggbb`.
    Color,
    /// I lati di un arco: `"auto"`, o un oggetto con `from` e `to`, ognuno un lato.
    Sides,
    /// Due numeri, `[w, h]`.
    Pair,
    /// Un valore qualunque.
    Any,
}

/// Un campo obbligatorio senza valore di serie.
const fn required(name: &'static str, kind: FieldKind, doc_it: &'static str) -> FieldSpec {
    FieldSpec {
        name,
        kind,
        required: true,
        default: None,
        doc_it,
    }
}

/// Un campo facoltativo senza valore di serie. `null` vale come assente.
const fn optional(name: &'static str, kind: FieldKind, doc_it: &'static str) -> FieldSpec {
    FieldSpec {
        name,
        kind,
        required: false,
        default: None,
        doc_it,
    }
}

/// I lati di una scheda che sta accanto a un'altra.
const SIDES: &[&str] = &["top", "right", "bottom", "left"];
/// I tipi di una scheda nella forma breve.
const KINDS: &[&str] = &["text", "file", "link", "group"];
/// Le punte di un arco nella forma breve.
const ENDS: &[&str] = &["arrow", "none", "both"];
/// Dove va una scheda con `reorder`: in cima, o in fondo.
const LAYERS: &[&str] = &["front", "back"];
/// Il modo di prendere la misura da un contenuto, con `resize`.
const FITS: &[&str] = &["content"];

/// Le operazioni del nucleo, una voce per variante di [`CanvasOp`], nello
/// stesso ordine. Un'operazione nuova entra qui nello stesso task.
pub const OPS: &[OpSpec] = &[
    OpSpec {
        name: "add_card",
        summary_it: "Aggiunge una scheda in cima all'ordine: com'è nel file (`node`), o in forma breve (`text`, `file`, `url`, `label`).",
        fields: &[
            optional(
                "node",
                FieldKind::Node,
                "Una scheda come nel file, per intero. Non si mescola con la forma breve. `id` dentro la scheda è facoltativo: se manca lo dà il seme.",
            ),
            optional(
                "id",
                FieldKind::Id,
                "L'id della scheda nuova. Se manca lo dà il seme.",
            ),
            optional(
                "text",
                FieldKind::Text,
                "Il testo di una scheda di testo. Se manca è vuoto.",
            ),
            optional(
                "file",
                FieldKind::Text,
                "Il percorso di un file del vault: una scheda di file.",
            ),
            optional(
                "url",
                FieldKind::Text,
                "Il collegamento di una scheda link.",
            ),
            optional(
                "label",
                FieldKind::Text,
                "L'etichetta di un gruppo. Da sola fa un gruppo.",
            ),
            FieldSpec {
                name: "type",
                kind: FieldKind::Enum(KINDS),
                required: false,
                default: None,
                doc_it: "Il tipo della scheda, se non lo dice il campo che c'è.",
            },
            optional(
                "subpath",
                FieldKind::Text,
                "Il sottopercorso di un file, come `#page=3`.",
            ),
            optional(
                "x",
                FieldKind::Number,
                "La posizione, in unità della lavagna. Va con `y`, e non con `near`.",
            ),
            optional(
                "y",
                FieldKind::Number,
                "La posizione, in unità della lavagna. Va con `x`, e non con `near`.",
            ),
            optional(
                "width",
                FieldKind::Number,
                "La larghezza. Di serie quella di nascita del tipo e del testo.",
            ),
            optional(
                "height",
                FieldKind::Number,
                "L'altezza. Di serie quella di nascita del tipo e del testo.",
            ),
            optional(
                "color",
                FieldKind::Color,
                "Il colore: un nome, un numero da 1 a 6, o `#rrggbb`.",
            ),
            optional(
                "near",
                FieldKind::Id,
                "La scheda accanto alla quale nasce questa.",
            ),
            FieldSpec {
                name: "side",
                kind: FieldKind::Enum(SIDES),
                required: false,
                default: Some("\"right\""),
                doc_it: "Il lato di `near` dove nasce la scheda.",
            },
            optional(
                "gap",
                FieldKind::Number,
                "La distanza da `near`, non negativa. Di serie 48 a destra e a sinistra, 24 sopra e sotto.",
            ),
            optional(
                "content_size",
                FieldKind::Pair,
                "Le dimensioni del contenuto di un file: i pixel di un'immagine, o i punti della prima pagina di un PDF. Danno le misure di nascita.",
            ),
        ],
        examples: &[
            r#"{"op":"add_card","node":{"type":"text","text":"Nuova idea","x":400,"y":0,"width":320,"height":160}}"#,
            r#"{"op":"add_card","text":"Nuova idea","near":"t2","side":"bottom"}"#,
            r#"{"op":"add_card","file":"schemi/foto.png","x":400,"y":240,"content_size":[1600,1200]}"#,
        ],
    },
    OpSpec {
        name: "move",
        summary_it: "Sposta le schede `ids` di `dx` e `dy`. Un gruppo si sposta da solo, o con `contents` porta con sé le schede dentro.",
        fields: &[
            required("ids", FieldKind::Ids, "Le schede da spostare."),
            required(
                "dx",
                FieldKind::Number,
                "Di quanto si sposta in orizzontale, in unità della lavagna.",
            ),
            required(
                "dy",
                FieldKind::Number,
                "Di quanto si sposta in verticale, in unità della lavagna.",
            ),
            optional(
                "contents",
                FieldKind::Bool,
                "Con `true`, un gruppo di `ids` porta con sé le schede che stanno dentro di lui, una volta sola. Su una scheda che non è un gruppo non fa niente.",
            ),
        ],
        examples: &[r#"{"op":"move","ids":["t1","t2"],"dx":40,"dy":0}"#],
    },
    OpSpec {
        name: "resize",
        summary_it: "Dà alla scheda `id` le misure `width` e `height`, o con `fit: content` l'altezza del suo contenuto.",
        fields: &[
            required("id", FieldKind::Id, "La scheda da ridimensionare."),
            optional(
                "width",
                FieldKind::Number,
                "La larghezza, in unità della lavagna. Se manca resta quella che ha.",
            ),
            optional(
                "height",
                FieldKind::Number,
                "L'altezza, in unità della lavagna. Se manca resta quella che ha. Non si dà con `fit`.",
            ),
            FieldSpec {
                name: "fit",
                kind: FieldKind::Enum(FITS),
                required: false,
                default: None,
                doc_it: "`content`: l'altezza viene dal contenuto, con la larghezza data. Un testo si misura con la stima della lavagna; un'immagine o un PDF con le sue proporzioni.",
            },
            optional(
                "content_size",
                FieldKind::Pair,
                "Le dimensioni del contenuto di un'immagine o di un PDF, con `fit`: i pixel, o i punti della prima pagina. Se manca le legge il file.",
            ),
        ],
        examples: &[
            r#"{"op":"resize","id":"t1","width":400,"height":200}"#,
            r#"{"op":"resize","id":"t1","fit":"content"}"#,
        ],
    },
    OpSpec {
        name: "connect",
        summary_it: "Aggiunge un arco in fondo alla lista: com'è nel file (`edge`), o fra due schede (`from`, `to`).",
        fields: &[
            optional(
                "edge",
                FieldKind::Edge,
                "Un arco come nel file: `fromNode` e `toNode` sono due schede. `id` dentro l'arco è facoltativo.",
            ),
            optional(
                "id",
                FieldKind::Id,
                "L'id dell'arco nuovo. Se manca lo dà il seme.",
            ),
            optional("from", FieldKind::Id, "La scheda di partenza."),
            optional("to", FieldKind::Id, "La scheda di arrivo."),
            optional("label", FieldKind::Text, "L'etichetta dell'arco."),
            optional(
                "color",
                FieldKind::Color,
                "Il colore, come in `add_card`.",
            ),
            optional(
                "sides",
                FieldKind::Sides,
                "`\"auto\"` per i lati più vicini, o `{from, to}` con i lati scelti. Di serie nessun lato.",
            ),
            FieldSpec {
                name: "ends",
                kind: FieldKind::Enum(ENDS),
                required: false,
                default: Some("\"arrow\""),
                doc_it: "Le punte: `arrow` alla scheda di arrivo (di serie), `none` nessuna, `both` alle due.",
            },
        ],
        examples: &[
            r#"{"op":"connect","edge":{"fromNode":"t2","toNode":"f1","label":"usa"}}"#,
            r#"{"op":"connect","from":"t1","to":"t2","sides":"auto","label":"porta a"}"#,
        ],
    },
    OpSpec {
        name: "remove",
        summary_it: "Toglie schede e archi; con una scheda vanno via anche i suoi archi.",
        fields: &[required(
            "ids",
            FieldKind::Ids,
            "Gli id da togliere: schede o archi.",
        )],
        examples: &[
            r#"{"op":"remove","ids":["e1"]}"#,
            r#"{"op":"remove","ids":["f1"]}"#,
        ],
    },
    OpSpec {
        name: "set",
        summary_it: "Cambia i campi di una scheda o di un arco; `null` toglie un campo.",
        fields: &[
            required("id", FieldKind::Id, "La scheda o l'arco da cambiare."),
            required(
                "fields",
                FieldKind::Patch,
                "I campi nuovi. `id` non si cambia, né `type` di una scheda. Il `color` accetta i nomi di `add_card`.",
            ),
        ],
        examples: &[r#"{"op":"set","id":"t1","fields":{"color":"4","text":"Ciclo dell'acqua"}}"#],
    },
    OpSpec {
        name: "reorder",
        summary_it: "Porta le schede in cima all'ordine, o in fondo con `to: back`, nell'ordine dato.",
        fields: &[
            required(
                "ids",
                FieldKind::Ids,
                "Le schede da portare, nell'ordine dato.",
            ),
            FieldSpec {
                name: "to",
                kind: FieldKind::Enum(LAYERS),
                required: false,
                default: Some("\"front\""),
                doc_it: "`front`: in cima, sopra le altre (di serie). `back`: in fondo, sotto le altre.",
            },
        ],
        examples: &[
            r#"{"op":"reorder","ids":["t2","t1"]}"#,
            r#"{"op":"reorder","ids":["t1"],"to":"back"}"#,
        ],
    },
    OpSpec {
        name: "color",
        summary_it: "Colora più schede e archi in una volta, con un nome, un numero da 1 a 6, o `#rrggbb`; `null` toglie il colore.",
        fields: &[
            required("ids", FieldKind::Ids, "Le schede o gli archi da colorare."),
            required(
                "color",
                FieldKind::Color,
                "Il colore: un nome come in `add_card` (`red`, `note-blue`…), un numero da 1 a 6, o `#rrggbb`. `null` toglie il colore. Il campo c'è sempre.",
            ),
        ],
        examples: &[
            r#"{"op":"color","ids":["t1","t2"],"color":"red"}"#,
            r#"{"op":"color","ids":["e1"],"color":null}"#,
        ],
    },
];

/// La lavagna su cui girano gli esempi di [`OPS`]: due schede di testo, una
/// di file e un arco fra le due di testo.
const EXAMPLE_CANVAS: &str = r#"{
  "nodes": [
    {"id": "t1", "type": "text", "x": 0, "y": 0, "width": 320, "height": 160, "text": "Ciclo dell'acqua"},
    {"id": "t2", "type": "text", "x": 400, "y": 0, "width": 320, "height": 160, "text": "Evaporazione"},
    {"id": "f1", "type": "file", "x": 0, "y": 240, "width": 320, "height": 200, "file": "schemi/acqua.png"}
  ],
  "edges": [{"id": "e1", "fromNode": "t1", "toNode": "t2", "label": "porta a"}]
}"#;

/// La lavagna d'esempio di [`OPS`].
pub fn example_canvas() -> Result<Canvas, CanvasError> {
    crate::parse(EXAMPLE_CANVAS)
}

/// Un problema di una lista di operazioni, come lo dà [`validate`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Problem {
    /// Che cosa non va, come codice stabile.
    pub code: ProblemCode,
    /// La posizione dell'operazione nella lista, da zero. `None` se il
    /// problema riguarda la lista intera.
    pub index: Option<usize>,
    /// Dove sta, come puntatore JSON (RFC 6901): `/2/dx`. Per la lista intera
    /// è `""`.
    pub path: String,
    /// Una frase fissa in inglese, come i messaggi di
    /// [`crate::ops::OpError`]. Le frasi per le persone le fa chi mostra il
    /// problema.
    pub message: &'static str,
    /// Il nome o i nomi più vicini al valore sbagliato, a distanza al più 2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    /// L'operazione intera con la correzione. C'è solo quando la correzione è
    /// una sola, e il posto dove va è libero.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<Value>,
}

/// I codici dei problemi di [`validate`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemCode {
    /// La lista è vuota.
    Invalid,
    /// Manca `op`, o il suo valore non è il nome di un'operazione.
    UnknownOp,
    /// Un campo che l'operazione non ha.
    UnknownField,
    /// Un campo obbligatorio che manca.
    MissingField,
    /// Un tipo JSON sbagliato. Vale anche per la lista che non è una lista.
    WrongType,
    /// Un valore fuori dall'elenco ammesso.
    BadValue,
}

impl ProblemCode {
    fn message(self) -> &'static str {
        match self {
            Self::Invalid => "the list has no operations",
            Self::UnknownOp => "no operation has this name",
            Self::UnknownField => "the operation has no such field",
            Self::MissingField => "a required field is missing",
            Self::WrongType => "the value has the wrong JSON type",
            Self::BadValue => "the value is not one of the allowed values",
        }
    }
}

impl Problem {
    fn new(code: ProblemCode, index: Option<usize>, path: String) -> Self {
        Self {
            code,
            index,
            path,
            message: code.message(),
            suggestion: None,
            fix: None,
        }
    }
}

/// I problemi di una lista di operazioni, come li darebbe la lettura. Una
/// lista non vuota senza problemi è una lista che serde legge, e viceversa. La
/// lista vuota fa eccezione: serde la legge, `validate` la dà `invalid`.
///
/// Prima della lista: non è un array (`wrong_type`) o è vuoto (`invalid`).
/// Poi per ogni operazione, in ordine: il nome (`unknown_op`), i campi che
/// l'operazione ha (`missing_field`, `wrong_type`, `bad_value`), e quelli che
/// non ha (`unknown_field`). Un'operazione col nome sbagliato non ha i suoi
/// campi controllati: non si sa quali sono.
///
/// Il costo è lineare nel numero di operazioni e di campi.
pub fn validate(value: &Value) -> Vec<Problem> {
    let Some(list) = value.as_array() else {
        return vec![Problem::new(ProblemCode::WrongType, None, String::new())];
    };
    if list.is_empty() {
        return vec![Problem::new(ProblemCode::Invalid, None, String::new())];
    }
    let mut problems = Vec::new();
    for (index, op) in list.iter().enumerate() {
        check_op(index, op, &mut problems);
    }
    problems
}

fn check_op(index: usize, value: &Value, problems: &mut Vec<Problem>) {
    let op_path = format!("/{index}");
    let Some(object) = value.as_object() else {
        problems.push(Problem::new(ProblemCode::WrongType, Some(index), op_path));
        return;
    };
    let name_path = format!("{op_path}/op");
    let name = match object.get("op") {
        Some(Value::String(name)) => name.as_str(),
        Some(_) => {
            problems.push(Problem::new(ProblemCode::WrongType, Some(index), name_path));
            return;
        }
        None => {
            problems.push(Problem::new(ProblemCode::UnknownOp, Some(index), name_path));
            return;
        }
    };
    let Some(spec) = OPS.iter().find(|spec| spec.name == name) else {
        let mut problem = Problem::new(ProblemCode::UnknownOp, Some(index), name_path);
        let near = nearest(name, OPS.iter().map(|spec| spec.name));
        suggest(&mut problem, &near, |candidate| {
            Some(with(
                object,
                "op",
                "op",
                Value::String(candidate.to_owned()),
            ))
        });
        problems.push(problem);
        return;
    };
    for field in spec.fields {
        check_field(index, object, field, problems);
    }
    for (key, value) in object {
        if key == "op" || spec.fields.iter().any(|field| field.name == key) {
            continue;
        }
        let mut problem = Problem::new(
            ProblemCode::UnknownField,
            Some(index),
            format!("{op_path}/{}", escape(key)),
        );
        let near = nearest(key, spec.fields.iter().map(|field| field.name));
        suggest(&mut problem, &near, |candidate| {
            // Il posto è già preso: la correzione non sarebbe una sola.
            (!object.contains_key(candidate)).then(|| with(object, key, candidate, value.clone()))
        });
        problems.push(problem);
    }
}

/// Un campo dell'operazione `index`: presente e del tipo giusto, o un
/// problema.
fn check_field(
    index: usize,
    object: &Map<String, Value>,
    field: &FieldSpec,
    problems: &mut Vec<Problem>,
) {
    let path = format!("/{index}/{}", escape(field.name));
    let Some(value) = object.get(field.name) else {
        if field.required {
            problems.push(Problem::new(ProblemCode::MissingField, Some(index), path));
        }
        return;
    };
    // Un campo facoltativo `null` è un campo assente (come in serde).
    if value.is_null() && !field.required {
        return;
    }
    match field.kind {
        FieldKind::Any => {}
        FieldKind::Id | FieldKind::Text => {
            wrong_unless(value.is_string(), index, path, problems);
        }
        FieldKind::Bool => wrong_unless(value.is_boolean(), index, path, problems),
        FieldKind::Number => wrong_unless(is_integer(value), index, path, problems),
        FieldKind::Node | FieldKind::Edge | FieldKind::Object => {
            wrong_unless(value.is_object(), index, path, problems);
        }
        FieldKind::Patch => check_patch(index, object, field, path, value, problems),
        FieldKind::Enum(values) => check_enum(index, object, field, values, path, problems),
        FieldKind::Ids => check_ids(index, object, field.name, path, value, problems),
        FieldKind::Points => check_points(index, path, value, problems),
        FieldKind::Color => check_color(index, object, field, path, value, problems),
        FieldKind::Sides => check_sides(index, object, field, path, value, problems),
        FieldKind::Pair => check_pair(index, path, value, problems),
    }
}

/// Un colore: un nome, un numero da 1 a 6, o `#rrggbb`, o `null` (nessun
/// colore). Un nome sbagliato ha i nomi vicini, e la correzione se ce n'è uno
/// solo.
fn check_color(
    index: usize,
    object: &Map<String, Value>,
    field: &FieldSpec,
    path: String,
    value: &Value,
    problems: &mut Vec<Problem>,
) {
    check_color_at(index, path, value, problems, |candidate| {
        Some(with(
            object,
            field.name,
            field.name,
            Value::String(candidate.to_owned()),
        ))
    });
}

/// Un colore in un punto qualunque del JSON: `fix` costruisce l'operazione
/// corretta col nome scelto.
fn check_color_at(
    index: usize,
    path: String,
    value: &Value,
    problems: &mut Vec<Problem>,
    fix: impl Fn(&str) -> Option<Value>,
) {
    match value {
        Value::String(text) if color::parse(text).is_none() => {
            let mut problem = Problem::new(ProblemCode::BadValue, Some(index), path);
            let near = nearest(text, color::names());
            suggest(&mut problem, &near, fix);
            problems.push(problem);
        }
        Value::String(_) | Value::Null => {}
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), path)),
    }
}

/// I campi nuovi di `set`: un oggetto, e il suo `color` (se c'è) è un colore.
/// Gli altri campi li legge la scheda, e non si controllano qui.
fn check_patch(
    index: usize,
    object: &Map<String, Value>,
    field: &FieldSpec,
    path: String,
    value: &Value,
    problems: &mut Vec<Problem>,
) {
    let Value::Object(fields) = value else {
        problems.push(Problem::new(ProblemCode::WrongType, Some(index), path));
        return;
    };
    let Some(chosen) = fields.get("color") else {
        return;
    };
    check_color_at(
        index,
        format!("{path}/color"),
        chosen,
        problems,
        |candidate| {
            let mut changed = fields.clone();
            changed.insert("color".to_owned(), Value::String(candidate.to_owned()));
            Some(with(object, field.name, field.name, Value::Object(changed)))
        },
    );
}

/// I lati di un arco: la parola `auto`, o un oggetto con `from` e `to`, ognuno
/// un lato o `null`. Una chiave che non è `from` né `to` ha il suo vicino.
fn check_sides(
    index: usize,
    object: &Map<String, Value>,
    field: &FieldSpec,
    path: String,
    value: &Value,
    problems: &mut Vec<Problem>,
) {
    match value {
        Value::String(text) if text != "auto" => {
            let mut problem = Problem::new(ProblemCode::BadValue, Some(index), path);
            let near = nearest(text, ["auto"]);
            suggest(&mut problem, &near, |candidate| {
                Some(with(
                    object,
                    field.name,
                    field.name,
                    Value::String(candidate.to_owned()),
                ))
            });
            problems.push(problem);
        }
        Value::String(_) => {}
        Value::Object(pair) => {
            for (key, side) in pair {
                let at = format!("{path}/{}", escape(key));
                if key == "from" || key == "to" {
                    check_side(index, side, at, problems);
                    continue;
                }
                let mut problem = Problem::new(ProblemCode::UnknownField, Some(index), at);
                let near = nearest(key, ["from", "to"]);
                suggest(&mut problem, &near, |candidate| {
                    // Il posto è già preso: la correzione non sarebbe una sola.
                    if pair.contains_key(candidate) {
                        return None;
                    }
                    let mut renamed = pair.clone();
                    renamed.remove(key);
                    renamed.insert(candidate.to_owned(), side.clone());
                    Some(with(object, field.name, field.name, Value::Object(renamed)))
                });
                problems.push(problem);
            }
        }
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), path)),
    }
}

/// Un lato di `sides`: `null` (nessun lato), o uno dei quattro. Il lato
/// sbagliato ha il suo vicino, ma nessuna correzione: è dentro l'oggetto.
fn check_side(index: usize, side: &Value, at: String, problems: &mut Vec<Problem>) {
    match side {
        Value::Null => {}
        Value::String(text) if !SIDES.contains(&text.as_str()) => {
            let mut problem = Problem::new(ProblemCode::BadValue, Some(index), at);
            let near = nearest(text, SIDES.iter().copied());
            if !near.is_empty() {
                problem.suggestion = Some(near.join(", "));
            }
            problems.push(problem);
        }
        Value::String(_) => {}
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), at)),
    }
}

/// Due numeri, `[w, h]`: una lista di due numeri, e basta.
fn check_pair(index: usize, path: String, value: &Value, problems: &mut Vec<Problem>) {
    match value {
        Value::Array(items) if items.len() == 2 => {
            for (position, item) in items.iter().enumerate() {
                if !item.is_number() {
                    let at = format!("{path}/{position}");
                    problems.push(Problem::new(ProblemCode::WrongType, Some(index), at));
                }
            }
        }
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), path)),
    }
}

fn check_enum(
    index: usize,
    object: &Map<String, Value>,
    field: &FieldSpec,
    values: &[&'static str],
    path: String,
    problems: &mut Vec<Problem>,
) {
    let Some(value) = object.get(field.name) else {
        return;
    };
    match value {
        Value::String(text) if !values.iter().any(|value| *value == text) => {
            let mut problem = Problem::new(ProblemCode::BadValue, Some(index), path);
            let near = nearest(text, values.iter().copied());
            suggest(&mut problem, &near, |candidate| {
                Some(with(
                    object,
                    field.name,
                    field.name,
                    Value::String(candidate.to_owned()),
                ))
            });
            problems.push(problem);
        }
        Value::String(_) => {}
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), path)),
    }
}

/// Una lista di id. Una stringa sola è l'errore più comune: la correzione è
/// la lista con quella stringa, e si dà.
fn check_ids(
    index: usize,
    object: &Map<String, Value>,
    key: &str,
    path: String,
    value: &Value,
    problems: &mut Vec<Problem>,
) {
    match value {
        Value::Array(items) => {
            for (position, item) in items.iter().enumerate() {
                if !item.is_string() {
                    let at = format!("{path}/{position}");
                    problems.push(Problem::new(ProblemCode::WrongType, Some(index), at));
                }
            }
        }
        Value::String(text) => {
            let mut problem = Problem::new(ProblemCode::WrongType, Some(index), path);
            problem.fix = Some(with(object, key, key, json!([text])));
            problems.push(problem);
        }
        _ => problems.push(Problem::new(ProblemCode::WrongType, Some(index), path)),
    }
}

/// Una lista di punti: una lista di liste di numeri.
fn check_points(index: usize, path: String, value: &Value, problems: &mut Vec<Problem>) {
    let Value::Array(points) = value else {
        problems.push(Problem::new(ProblemCode::WrongType, Some(index), path));
        return;
    };
    for (position, point) in points.iter().enumerate() {
        let at = format!("{path}/{position}");
        let Value::Array(coordinates) = point else {
            problems.push(Problem::new(ProblemCode::WrongType, Some(index), at));
            continue;
        };
        for (axis, coordinate) in coordinates.iter().enumerate() {
            if !coordinate.is_number() {
                let at = format!("{at}/{axis}");
                problems.push(Problem::new(ProblemCode::WrongType, Some(index), at));
            }
        }
    }
}

fn wrong_unless(fits: bool, index: usize, path: String, problems: &mut Vec<Problem>) {
    if !fits {
        problems.push(Problem::new(ProblemCode::WrongType, Some(index), path));
    }
}

/// Un intero JSON: anche `1.0` o `1e2`, come le legge serde. Una frazione vera
/// no, e un numero non finito non c'è in un [`Value`].
fn is_integer(value: &Value) -> bool {
    match value {
        Value::Number(number) => {
            number.is_i64()
                || number.is_u64()
                || number
                    .as_f64()
                    .is_some_and(|float| float.is_finite() && float.fract() == 0.0)
        }
        _ => false,
    }
}

/// Il suggerimento e, se la correzione è una sola, la correzione.
fn suggest(problem: &mut Problem, near: &[&str], fix: impl Fn(&str) -> Option<Value>) {
    if near.is_empty() {
        return;
    }
    problem.suggestion = Some(near.join(", "));
    if let [only] = near {
        problem.fix = fix(only);
    }
}

/// I nomi più vicini a `given`, a distanza al più [`MAX_DISTANCE`]: quelli alla
/// distanza minima, nell'ordine dato.
fn nearest(given: &str, names: impl IntoIterator<Item = &'static str>) -> Vec<&'static str> {
    let mut best = MAX_DISTANCE + 1;
    let mut near = Vec::new();
    for name in names {
        let Some(d) = distance(given, name) else {
            continue;
        };
        if d < best {
            best = d;
            near.clear();
        }
        if d == best {
            near.push(name);
        }
    }
    near
}

/// La distanza di Levenshtein fra `given` e `name`, se è al più
/// [`MAX_DISTANCE`]. Il confronto ignora le maiuscole ASCII: `Add-Card` è vicino
/// a `add_card`. È solo un suggerimento: serde resta sensibile alle maiuscole, e
/// un nome che non è esatto non si legge.
pub(crate) fn distance(given: &str, name: &str) -> Option<usize> {
    let given: Vec<char> = given.to_ascii_lowercase().chars().collect();
    let name: Vec<char> = name.chars().collect();
    if given.len().abs_diff(name.len()) > MAX_DISTANCE {
        return None;
    }
    let mut previous: Vec<usize> = (0..=name.len()).collect();
    for (row, letter) in given.iter().enumerate() {
        let mut current = vec![row + 1; name.len() + 1];
        for (column, other) in name.iter().enumerate() {
            current[column + 1] = (previous[column] + usize::from(letter != other))
                .min(previous[column + 1] + 1)
                .min(current[column] + 1);
        }
        previous = current;
    }
    let d = previous[name.len()];
    (d <= MAX_DISTANCE).then_some(d)
}

/// La lista di chiavi di `object` con `key` rinominata in `to` e col valore
/// `value`, nello stesso posto.
fn with(object: &Map<String, Value>, key: &str, to: &str, value: Value) -> Value {
    Value::Object(
        object
            .iter()
            .map(|(name, old)| {
                if name == key {
                    (to.to_owned(), value.clone())
                } else {
                    (name.clone(), old.clone())
                }
            })
            .collect(),
    )
}

/// Un nome come segmento di puntatore JSON (RFC 6901).
fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// Lo schema JSON 2020-12 di una lista di operazioni: una lista non vuota, e
/// ogni elemento è una delle operazioni di [`OPS`]. Ogni ramo ha `op` costante,
/// `additionalProperties: false` e gli esempi.
pub fn json_schema() -> Value {
    let branches: Vec<Value> = OPS.iter().map(branch).collect();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Operazioni della lavagna",
        "description": "Una lista non vuota di operazioni: ognuna è un oggetto con il campo `op`.",
        "type": "array",
        "minItems": 1,
        "items": { "oneOf": branches },
    })
}

fn branch(spec: &OpSpec) -> Value {
    let mut properties = Map::new();
    properties.insert("op".to_owned(), json!({ "const": spec.name }));
    let mut required = vec!["op"];
    for field in spec.fields {
        properties.insert(field.name.to_owned(), field_schema(field));
        if field.required {
            required.push(field.name);
        }
    }
    let examples: Vec<Value> = spec
        .examples
        .iter()
        .filter_map(|text| serde_json::from_str(text).ok())
        .collect();
    json!({
        "type": "object",
        "description": spec.summary_it,
        "properties": properties,
        "required": required,
        "additionalProperties": false,
        "examples": examples,
    })
}

fn field_schema(field: &FieldSpec) -> Value {
    let mut schema = match field.kind {
        FieldKind::Id | FieldKind::Text => json!({ "type": "string" }),
        FieldKind::Ids => json!({ "type": "array", "items": { "type": "string" } }),
        FieldKind::Number => json!({ "type": "integer" }),
        FieldKind::Bool => json!({ "type": "boolean" }),
        FieldKind::Enum(values) => json!({ "type": "string", "enum": values }),
        FieldKind::Node | FieldKind::Edge | FieldKind::Object | FieldKind::Patch => {
            json!({ "type": "object" })
        }
        FieldKind::Points => json!({
            "type": "array",
            "items": { "type": "array", "items": { "type": "number" } },
        }),
        FieldKind::Color => json!({ "type": "string" }),
        FieldKind::Sides => json!({
            "oneOf": [
                { "const": "auto" },
                {
                    "type": "object",
                    "properties": { "from": { "enum": SIDES }, "to": { "enum": SIDES } },
                    "additionalProperties": false,
                },
            ],
        }),
        FieldKind::Pair => json!({
            "type": "array",
            "items": { "type": "number" },
            "minItems": 2,
            "maxItems": 2,
        }),
        FieldKind::Any => json!({}),
    };
    if let Value::Object(map) = &mut schema {
        map.insert("description".to_owned(), json!(field.doc_it));
        if let Some(default) = field
            .default
            .and_then(|text| serde_json::from_str(text).ok())
        {
            map.insert("default".to_owned(), default);
        }
    }
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un campo di prova, con un vocabolario.
    const COLOR: FieldSpec = FieldSpec {
        name: "color",
        kind: FieldKind::Enum(&["red", "blue"]),
        required: true,
        default: None,
        doc_it: "un colore di prova",
    };

    #[test]
    fn un_valore_fuori_dall_elenco_ha_il_vicino_e_la_correzione() {
        let object = json!({ "op": "move", "color": "gren" });
        let object = object.as_object().expect("un oggetto");
        let mut problems = Vec::new();
        check_field(0, object, &COLOR, &mut problems);
        assert_eq!(problems.len(), 1);
        let problem = &problems[0];
        assert_eq!(problem.code, ProblemCode::BadValue);
        assert_eq!(problem.path, "/0/color");
        assert_eq!(problem.suggestion.as_deref(), Some("red"));
        assert_eq!(problem.fix, Some(json!({ "op": "move", "color": "red" })));
    }

    #[test]
    fn la_distanza_ignora_le_maiuscole_ascii_e_ha_un_tetto() {
        assert_eq!(distance("ADD-CARD", "add_card"), Some(1));
        assert_eq!(distance("move", "move"), Some(0));
        assert_eq!(distance("dX", "dx"), Some(0));
        assert_eq!(distance("foo", "ids"), None);
        assert_eq!(distance("", "ab"), Some(2));
        assert_eq!(distance("", "abc"), None);
    }
}
