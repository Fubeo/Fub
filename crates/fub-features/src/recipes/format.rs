//! Il formato di una ricetta: leggere il blocco `fub-recipe`, controllarlo,
//! farne l'impronta, la spec del comando che nasce e gli argomenti dei passi.
//!
//! Ogni problema ha un codice stabile ([`ProblemCode`]), il percorso del campo
//! (`steps[1].args.to`, gli indici da zero) e la riga nella nota: lo legge la
//! persona, e lo legge l'AI che corregge la ricetta. Il contratto è in
//! `docs/reference/ricette.md`.

use std::collections::BTreeSet;

use fub_abi::command::{
    validate_params, Choice, CommandReach, CommandScope, CommandSpec, CommandSurface, ParamKind,
    ParamSpec,
};
use fub_abi::locale::Locale;
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::rules::yaml as yaml_rule;
use fub_abi::text::{Arg, Strings, Text};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::{FENCE, ID_MAX};
use crate::vocabulary::{Ctx, DATE_NAMES};

/// La versione del formato che questo Fub legge.
pub const FORMAT_VERSION: u64 = 1;
/// Quanti passi al massimo.
pub const STEPS_MAX: usize = 20;
/// Quante ricette al massimo per vault, le prime in ordine di percorso.
pub const RECIPES_MAX: usize = 200;
/// Il prefisso degli id di bundle delle ricette: il comando di una ricetta è
/// `recipe.<id>:run`, e un passo che lo nomina lancerebbe un'altra ricetta.
pub const RECIPE_NS: &str = "recipe.";
/// Il nome del comando dentro il bundle di una ricetta.
const RUN: &str = "run";
/// Il più lungo nome di parametro.
const PARAM_MAX: usize = 48;

/// I campi del blocco.
const F_VERSION: &str = "fub-recipe";
const F_ID: &str = "id";
const F_TITLE: &str = "title";
const F_DESCRIPTION: &str = "description";
const F_KEYBINDING: &str = "keybinding";
const F_SURFACES: &str = "surfaces";
const F_PARAMS: &str = "params";
const F_STEPS: &str = "steps";
const TOP_FIELDS: &[&str] = &[
    F_VERSION,
    F_ID,
    F_TITLE,
    F_DESCRIPTION,
    F_KEYBINDING,
    F_SURFACES,
    F_PARAMS,
    F_STEPS,
];
const P_NAME: &str = "name";
const P_TITLE: &str = "title";
const P_KIND: &str = "kind";
const P_REQUIRED: &str = "required";
const P_OPTIONS: &str = "options";
const PARAM_FIELDS: &[&str] = &[P_NAME, P_TITLE, P_KIND, P_REQUIRED, P_OPTIONS];
const S_RUN: &str = "run";
const S_ARGS: &str = "args";
const STEP_FIELDS: &[&str] = &[S_RUN, S_ARGS];

/// I segnaposto che non vengono dalle date: la nota, la sua cartella, il suo
/// nome e la selezione.
const DOC: &str = "doc";
const TITLE: &str = "title";
const FOLDER: &str = "folder";
const SELECTION: &str = "selection";
/// I parametri dichiarati si citano come `{{param.<nome>}}`.
const PARAM_PREFIX: &str = "param.";
/// I parametri che la spec della ricetta dà da sé: un parametro dichiarato
/// con lo stesso nome li oscurerebbe.
const RESERVED_PARAMS: &[&str] = &[DOC, SELECTION];

/// Un problema che tiene una ricetta spenta. Il codice è stabile come l'id di
/// un comando: un codice nuovo si aggiunge, uno vecchio non cambia significato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProblemCode {
    /// La nota non ha nessun blocco `fub-recipe`: non è una ricetta.
    BloccoAssente,
    /// Più di un blocco `fub-recipe` nella stessa nota.
    BlocchiDoppi,
    /// Il blocco non si legge come YAML, o supera il budget.
    Yaml,
    CampoSconosciuto,
    CampoMancante,
    /// Un tipo o un limite sbagliato.
    ValoreNonValido,
    /// `fub-recipe` più grande della versione che questo Fub legge.
    VersioneFutura,
    SegnapostoSconosciuto,
    ComandoSconosciuto,
    /// Un passo che lancia un'altra ricetta.
    ComandoRicetta,
    /// Un passo che non si annulla.
    NonSiAnnulla,
    /// Un passo che cambia le impostazioni.
    Impostazioni,
    /// Gli argomenti di un passo che la spec del comando rifiuta.
    Argomenti,
    /// Due ricette dello stesso vault con lo stesso `id`.
    IdRipetuto,
    /// L'`id` è già di un comando che non è questa ricetta.
    IdOccupato,
    /// Il vault ha più ricette di [`RECIPES_MAX`].
    Troppe,
}

impl ProblemCode {
    /// Tutti i codici, nell'ordine della pagina.
    pub const ALL: &'static [ProblemCode] = &[
        ProblemCode::BloccoAssente,
        ProblemCode::BlocchiDoppi,
        ProblemCode::Yaml,
        ProblemCode::CampoSconosciuto,
        ProblemCode::CampoMancante,
        ProblemCode::ValoreNonValido,
        ProblemCode::VersioneFutura,
        ProblemCode::SegnapostoSconosciuto,
        ProblemCode::ComandoSconosciuto,
        ProblemCode::ComandoRicetta,
        ProblemCode::NonSiAnnulla,
        ProblemCode::Impostazioni,
        ProblemCode::Argomenti,
        ProblemCode::IdRipetuto,
        ProblemCode::IdOccupato,
        ProblemCode::Troppe,
    ];

    /// Il codice come si scrive: `campo-sconosciuto`.
    pub fn as_str(self) -> &'static str {
        match self {
            ProblemCode::BloccoAssente => "blocco-assente",
            ProblemCode::BlocchiDoppi => "blocchi-doppi",
            ProblemCode::Yaml => "yaml",
            ProblemCode::CampoSconosciuto => "campo-sconosciuto",
            ProblemCode::CampoMancante => "campo-mancante",
            ProblemCode::ValoreNonValido => "valore-non-valido",
            ProblemCode::VersioneFutura => "versione-futura",
            ProblemCode::SegnapostoSconosciuto => "segnaposto-sconosciuto",
            ProblemCode::ComandoSconosciuto => "comando-sconosciuto",
            ProblemCode::ComandoRicetta => "comando-ricetta",
            ProblemCode::NonSiAnnulla => "non-si-annulla",
            ProblemCode::Impostazioni => "impostazioni",
            ProblemCode::Argomenti => "argomenti",
            ProblemCode::IdRipetuto => "id-ripetuto",
            ProblemCode::IdOccupato => "id-occupato",
            ProblemCode::Troppe => "troppe",
        }
    }
}

impl std::fmt::Display for ProblemCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Un problema di una ricetta: che cosa (`code`), dove nel blocco (`field`,
/// vuoto per il blocco intero), su che riga della nota (`line`, da 1; `None`
/// quando la nota non ha un blocco) e la frase per chi la legge (`message`,
/// una chiave del catalogo delle ricette).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Problem {
    pub code: ProblemCode,
    pub field: String,
    pub line: Option<u32>,
    pub message: Text,
}

impl Problem {
    fn new(code: ProblemCode, field: impl Into<String>, line: Option<u32>, message: Text) -> Self {
        Problem {
            code,
            field: field.into(),
            line,
            message,
        }
    }

    /// `id-ripetuto`: un'altra ricetta del vault ha lo stesso `id`.
    pub fn repeated_id(recipe: &Recipe) -> Self {
        Problem::new(
            ProblemCode::IdRipetuto,
            F_ID,
            Some(recipe.line_of(F_ID)),
            said("id-ripetuto", &recipe.id),
        )
    }

    /// `id-occupato`: l'`id` è già di un comando che non è questa ricetta.
    pub fn occupied_id(recipe: &Recipe) -> Self {
        Problem::new(
            ProblemCode::IdOccupato,
            F_ID,
            Some(recipe.line_of(F_ID)),
            said("id-occupato", &recipe.id),
        )
    }

    /// `troppe`: il vault ha più di [`RECIPES_MAX`] ricette. È uno per vault, non
    /// per nota: non ha un campo né una riga.
    pub fn too_many() -> Self {
        Problem::new(
            ProblemCode::Troppe,
            "",
            None,
            Text::message(key("troppe"), vec![Arg::int("count", RECIPES_MAX as i64)]),
        )
    }
}

/// La chiave del catalogo di un messaggio.
fn key(reason: &str) -> String {
    format!("recipes.problem.{reason}")
}

/// Un messaggio con un solo valore, `{value}`.
fn said(reason: &str, value: &str) -> Text {
    Text::message(key(reason), vec![Arg::text("value", value)])
}

/// Un messaggio che nomina il campo, `{field}`.
fn on_field(reason: &str, field: &str) -> Text {
    Text::message(key(reason), vec![Arg::text("field", field)])
}

/// Una ricetta letta: ciò che il blocco dice, già controllato nella forma.
/// Serializzata dà il JSON da cui nasce l'[impronta](fingerprint), con i nomi
/// dei campi del blocco.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Recipe {
    #[serde(rename = "fub-recipe")]
    pub version: u64,
    pub id: String,
    pub title: String,
    pub description: String,
    pub keybinding: Option<String>,
    pub surfaces: Vec<CommandSurface>,
    pub params: Vec<RecipeParam>,
    pub steps: Vec<RecipeStep>,
    /// Dove sta il blocco nella nota: per le righe dei problemi, non per
    /// l'impronta.
    #[serde(skip)]
    located: Located,
}

/// Un parametro che la persona dà quando usa la ricetta.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecipeParam {
    pub name: String,
    pub title: String,
    pub kind: RecipeParamKind,
    pub required: bool,
    /// Le opzioni di una `choice`; vuoto per le altre specie.
    pub options: Vec<String>,
}

/// La specie di un parametro: un sottoinsieme di [`ParamKind`], quello che
/// una persona sa compilare in un modulo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecipeParamKind {
    Text,
    Number,
    Bool,
    Document,
    Choice,
}

impl RecipeParamKind {
    fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "text" => RecipeParamKind::Text,
            "number" => RecipeParamKind::Number,
            "bool" => RecipeParamKind::Bool,
            "document" => RecipeParamKind::Document,
            "choice" => RecipeParamKind::Choice,
            _ => return None,
        })
    }
}

/// Un passo: un comando del registro e i suoi argomenti, con i segnaposto.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecipeStep {
    pub run: String,
    pub args: Map<String, Value>,
}

impl Recipe {
    /// L'id del comando che la ricetta diventa: `recipe.<id>:run`.
    pub fn command_id(&self) -> String {
        command_id(&self.id)
    }

    /// La riga della nota (da 1) del campo `field` (`steps[1].args.to`), o
    /// quella del blocco se il campo non si trova riga per riga (una mappa
    /// fra graffe).
    pub fn line_of(&self, field: &str) -> u32 {
        self.located.line_of(field)
    }

    /// La ricetta usa questo segnaposto (senza graffe) in qualche passo?
    fn uses(&self, name: &str) -> bool {
        self.steps
            .iter()
            .any(|step| step.args.values().any(|v| mentions(v, name)))
    }
}

/// L'id del comando della ricetta `id`.
pub fn command_id(id: &str) -> String {
    format!("{RECIPE_NS}{id}:{RUN}")
}

/// Il blocco nella nota: la riga della recinzione d'apertura e il testo YAML.
#[derive(Clone, Debug, Default, PartialEq)]
struct Located {
    fence: u32,
    yaml: String,
}

impl Located {
    /// La riga YAML `k` (da zero) è la riga `fence + 1 + k` della nota.
    fn line_of(&self, field: &str) -> u32 {
        match locate(&self.yaml, field) {
            Some(k) => self.fence + 1 + k as u32,
            None => self.fence,
        }
    }
}

// ---------------------------------------------------------------------------
// La lettura
// ---------------------------------------------------------------------------

/// Legge la ricetta della nota `model`, letta da `source`.
///
/// `source` serve per le righe: lo span di un blocco è in byte, e solo il
/// testo dice su che riga cadono. Restituisce tutti i problemi della forma che
/// trova, non soltanto il primo; `blocco-assente` dice che la nota non è una
/// ricetta.
pub fn parse(model: &DocumentModel, source: &str) -> Result<Recipe, Vec<Problem>> {
    let mut blocks = Vec::new();
    collect(&model.body, &mut blocks);
    let line_at = |start: usize| -> u32 {
        let upto = &source.as_bytes()[..start.min(source.len())];
        1 + upto.iter().filter(|b| **b == b'\n').count() as u32
    };
    match blocks.as_slice() {
        [] => Err(vec![Problem::new(
            ProblemCode::BloccoAssente,
            "",
            None,
            Text::key(key("blocco-assente")),
        )]),
        [(code, start)] => read(code, line_at(*start)),
        many => Err(many
            .iter()
            .map(|(_, start)| {
                Problem::new(
                    ProblemCode::BlocchiDoppi,
                    "",
                    Some(line_at(*start)),
                    Text::message(
                        key("blocchi-doppi"),
                        vec![Arg::int("count", many.len() as i64)],
                    ),
                )
            })
            .collect()),
    }
}

/// I blocchi `fub-recipe` del corpo, anche dentro una citazione o un elenco:
/// `(codice, byte d'inizio)`.
fn collect<'m>(body: &'m [Block], out: &mut Vec<(&'m str, usize)>) {
    for block in body {
        match block {
            Block::CodeBlock {
                lang: Some(lang),
                code,
                span,
                ..
            } if lang.trim() == FENCE => out.push((code, span.start)),
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => collect(blocks, out),
            Block::List { items, .. } => {
                for item in items {
                    collect(&item.blocks, out);
                }
            }
            _ => {}
        }
    }
}

/// Il blocco `code`, la cui recinzione d'apertura sta sulla riga `fence`.
fn read(code: &str, fence: u32) -> Result<Recipe, Vec<Problem>> {
    let located = Located {
        fence,
        yaml: code.to_string(),
    };
    let yaml_problem = |line: Option<u32>, detail: &str| {
        vec![Problem::new(
            ProblemCode::Yaml,
            "",
            Some(line.unwrap_or(fence)),
            said("yaml", detail),
        )]
    };
    if !yaml_rule::within_budget(code) {
        return Err(yaml_problem(None, yaml_rule::OVER_BUDGET));
    }
    let value: serde_yaml_ng::Value = match serde_yaml_ng::from_str(code) {
        Ok(value) => value,
        Err(error) => {
            let line = error.location().map(|at| fence + at.line().max(1) as u32);
            return Err(yaml_problem(line, &error.to_string()));
        }
    };
    let object = match value {
        // Un blocco vuoto è una ricetta senza campi: i campi che mancano lo
        // dicono meglio di «non è YAML».
        serde_yaml_ng::Value::Null => Map::new(),
        serde_yaml_ng::Value::Mapping(_) => match serde_json::to_value(&value) {
            Ok(Value::Object(object)) => object,
            Ok(_) | Err(_) => {
                return Err(vec![Problem::new(
                    ProblemCode::Yaml,
                    "",
                    Some(fence),
                    Text::key(key("yaml-keys")),
                )])
            }
        },
        _ => {
            return Err(vec![Problem::new(
                ProblemCode::Yaml,
                "",
                Some(fence),
                Text::key(key("yaml-map")),
            )])
        }
    };
    let mut reader = Reader {
        located,
        problems: Vec::new(),
    };
    let recipe = reader.recipe(&object);
    match recipe {
        Some(recipe) if reader.problems.is_empty() => Ok(recipe),
        _ => Err(reader.problems),
    }
}

/// Raccoglie i problemi della forma, con la riga di ognuno.
struct Reader {
    located: Located,
    problems: Vec<Problem>,
}

impl Reader {
    fn push(&mut self, code: ProblemCode, field: &str, message: Text) {
        let line = self.located.line_of(field);
        self.problems
            .push(Problem::new(code, field, Some(line), message));
    }

    fn recipe(&mut self, object: &Map<String, Value>) -> Option<Recipe> {
        // La versione prima di tutto: un blocco di una versione più nuova può
        // avere campi che questo Fub non conosce, e dirli sconosciuti sarebbe
        // rumore. Resta spento, con un problema solo.
        let version = match object.get(F_VERSION) {
            None | Some(Value::Null) => {
                self.missing(F_VERSION);
                None
            }
            Some(raw) => match raw.as_u64() {
                Some(FORMAT_VERSION) => Some(FORMAT_VERSION),
                Some(newer) if newer > FORMAT_VERSION => {
                    self.problems.clear();
                    self.push(
                        ProblemCode::VersioneFutura,
                        F_VERSION,
                        said("versione-futura", &newer.to_string()),
                    );
                    return None;
                }
                _ => {
                    self.invalid(F_VERSION, Text::key(key("version")));
                    None
                }
            },
        };
        self.unknown_fields(object, TOP_FIELDS, "");
        let id = self.text(object, F_ID, F_ID, true);
        if let Some(id) = &id {
            let shaped = (1..=ID_MAX).contains(&id.chars().count())
                && id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !shaped {
                self.invalid(F_ID, said("id", id));
            }
        }
        let title = self.text(object, F_TITLE, F_TITLE, true);
        let description = self.text(object, F_DESCRIPTION, F_DESCRIPTION, true);
        let keybinding = self.text(object, F_KEYBINDING, F_KEYBINDING, false);
        if let Some(binding) = &keybinding {
            if fub_abi::rules::keys::chords(binding).is_none() {
                self.invalid(F_KEYBINDING, said("keybinding", binding));
            }
        }
        let surfaces = self.surfaces(object);
        let params = self.params(object);
        let declared: BTreeSet<String> = params.iter().map(|p| p.name.clone()).collect();
        let steps = self.steps(object, &declared);
        Some(Recipe {
            version: version?,
            id: id?,
            title: title?,
            description: description?,
            keybinding,
            surfaces,
            params,
            steps,
            located: self.located.clone(),
        })
    }

    fn missing(&mut self, field: &str) {
        self.push(
            ProblemCode::CampoMancante,
            field,
            on_field("campo-mancante", field),
        );
    }

    fn invalid(&mut self, field: &str, message: Text) {
        self.push(ProblemCode::ValoreNonValido, field, message);
    }

    fn unknown_fields(&mut self, object: &Map<String, Value>, known: &[&str], prefix: &str) {
        for name in object.keys() {
            if !known.contains(&name.as_str()) {
                let field = format!("{prefix}{name}");
                self.push(
                    ProblemCode::CampoSconosciuto,
                    &field,
                    on_field("campo-sconosciuto", &field),
                );
            }
        }
    }

    /// Un campo di testo non vuoto. `null` vale assente.
    fn text(
        &mut self,
        object: &Map<String, Value>,
        name: &str,
        field: &str,
        required: bool,
    ) -> Option<String> {
        match object.get(name) {
            None | Some(Value::Null) => {
                if required {
                    self.missing(field);
                }
                None
            }
            Some(Value::String(text)) if text.trim().is_empty() => {
                self.invalid(field, on_field("empty", field));
                None
            }
            Some(Value::String(text)) => Some(text.clone()),
            Some(_) => {
                self.invalid(field, on_field("wants-text", field));
                None
            }
        }
    }

    /// Un elenco facoltativo: vuoto se manca, `None` se non è un elenco.
    fn list<'v>(&mut self, object: &'v Map<String, Value>, name: &str) -> Option<&'v [Value]> {
        match object.get(name) {
            None | Some(Value::Null) => Some(&[]),
            Some(Value::Array(items)) => Some(items),
            Some(_) => {
                self.invalid(name, on_field("wants-list", name));
                None
            }
        }
    }

    fn surfaces(&mut self, object: &Map<String, Value>) -> Vec<CommandSurface> {
        let mut surfaces = Vec::new();
        for (i, raw) in self
            .list(object, F_SURFACES)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let field = format!("{F_SURFACES}[{i}]");
            let surface = match raw.as_str() {
                Some("slash") => CommandSurface::Slash,
                Some("slash_selection") => CommandSurface::SlashSelection,
                Some("toolbar") => CommandSurface::Toolbar,
                _ => {
                    let shown = raw.as_str().map_or_else(|| raw.to_string(), str::to_string);
                    self.invalid(&field, said("surface", &shown));
                    continue;
                }
            };
            if !surfaces.contains(&surface) {
                surfaces.push(surface);
            }
        }
        surfaces
    }

    fn params(&mut self, object: &Map<String, Value>) -> Vec<RecipeParam> {
        let mut params: Vec<RecipeParam> = Vec::new();
        let items = self.list(object, F_PARAMS).unwrap_or_default();
        for (i, raw) in items.iter().enumerate() {
            let at = format!("{F_PARAMS}[{i}]");
            let Value::Object(param) = raw else {
                self.invalid(&at, on_field("wants-map", &at));
                continue;
            };
            self.unknown_fields(param, PARAM_FIELDS, &format!("{at}."));
            let name_field = format!("{at}.{P_NAME}");
            let name = self.text(param, P_NAME, &name_field, true);
            if let Some(name) = &name {
                let shaped = name.len() <= PARAM_MAX
                    && name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                    && name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
                if !shaped {
                    self.invalid(&name_field, said("param-name", name));
                } else if RESERVED_PARAMS.contains(&name.as_str()) {
                    self.invalid(&name_field, said("param-reserved", name));
                } else if params.iter().any(|p| p.name == *name) {
                    self.invalid(&name_field, said("param-twice", name));
                }
            }
            let title = self.text(param, P_TITLE, &format!("{at}.{P_TITLE}"), true);
            let kind_field = format!("{at}.{P_KIND}");
            let kind = match self.text(param, P_KIND, &kind_field, true) {
                Some(raw) => match RecipeParamKind::parse(&raw) {
                    Some(kind) => Some(kind),
                    None => {
                        self.invalid(&kind_field, said("kind", &raw));
                        None
                    }
                },
                None => None,
            };
            let required_field = format!("{at}.{P_REQUIRED}");
            let required = match param.get(P_REQUIRED) {
                None | Some(Value::Null) => false,
                Some(Value::Bool(flag)) => *flag,
                Some(_) => {
                    self.invalid(&required_field, on_field("wants-bool", &required_field));
                    false
                }
            };
            let options = self.options(param, &at, kind, name.as_deref().unwrap_or_default());
            if let (Some(name), Some(title), Some(kind)) = (name, title, kind) {
                params.push(RecipeParam {
                    name,
                    title,
                    kind,
                    required,
                    options,
                });
            }
        }
        params
    }

    fn options(
        &mut self,
        param: &Map<String, Value>,
        at: &str,
        kind: Option<RecipeParamKind>,
        name: &str,
    ) -> Vec<String> {
        let field = format!("{at}.{P_OPTIONS}");
        let raw = match param.get(P_OPTIONS) {
            None | Some(Value::Null) => &[][..],
            Some(Value::Array(items)) => items.as_slice(),
            Some(_) => {
                self.invalid(&field, on_field("wants-list", &field));
                return Vec::new();
            }
        };
        let mut options: Vec<String> = Vec::new();
        for (j, option) in raw.iter().enumerate() {
            let option_field = format!("{field}[{j}]");
            match option.as_str().map(str::trim) {
                Some("") => self.invalid(&option_field, on_field("empty", &option_field)),
                Some(text) if options.iter().any(|o| o == text) => {
                    self.invalid(&option_field, said("option-twice", text))
                }
                Some(text) => options.push(text.to_string()),
                None => self.invalid(&option_field, on_field("wants-text", &option_field)),
            }
        }
        match kind {
            Some(RecipeParamKind::Choice) if raw.is_empty() => {
                self.invalid(&field, said("choice-empty", name));
            }
            Some(RecipeParamKind::Choice) | None => {}
            // `options: []` accanto a un `text` è lecito: è la forma di
            // chi ha copiato l'esempio. Delle opzioni vere no.
            Some(_) if !raw.is_empty() => {
                self.invalid(&field, said("options-not-choice", name));
            }
            Some(_) => {}
        }
        options
    }

    fn steps(
        &mut self,
        object: &Map<String, Value>,
        declared: &BTreeSet<String>,
    ) -> Vec<RecipeStep> {
        let items = match object.get(F_STEPS) {
            None | Some(Value::Null) => {
                self.missing(F_STEPS);
                return Vec::new();
            }
            Some(Value::Array(items)) => items,
            Some(_) => {
                self.invalid(F_STEPS, on_field("wants-list", F_STEPS));
                return Vec::new();
            }
        };
        if items.is_empty() || items.len() > STEPS_MAX {
            self.invalid(
                F_STEPS,
                Text::message(
                    key("steps-count"),
                    vec![Arg::int("count", items.len() as i64)],
                ),
            );
        }
        let mut steps = Vec::new();
        for (i, raw) in items.iter().enumerate() {
            let at = format!("{F_STEPS}[{i}]");
            let Value::Object(step) = raw else {
                self.invalid(&at, on_field("wants-map", &at));
                continue;
            };
            self.unknown_fields(step, STEP_FIELDS, &format!("{at}."));
            let run = self.text(step, S_RUN, &format!("{at}.{S_RUN}"), true);
            let args_field = format!("{at}.{S_ARGS}");
            let args = match step.get(S_ARGS) {
                None | Some(Value::Null) => Some(Map::new()),
                Some(Value::Object(args)) => Some(args.clone()),
                Some(_) => {
                    self.invalid(&args_field, on_field("wants-map", &args_field));
                    None
                }
            };
            if let Some(args) = &args {
                for (name, value) in args {
                    self.placeholders(value, &format!("{args_field}.{name}"), declared);
                }
            }
            if let (Some(run), Some(args)) = (run, args) {
                steps.push(RecipeStep {
                    run: run.trim().to_string(),
                    args,
                });
            }
        }
        steps
    }

    /// Ogni segnaposto di `value` (e dei valori dentro) è del vocabolario?
    fn placeholders(&mut self, value: &Value, field: &str, declared: &BTreeSet<String>) {
        match value {
            Value::String(text) => {
                for name in placeholders(text) {
                    if known(name, declared) {
                        continue;
                    }
                    let shown = format!("{{{{{name}}}}}");
                    let reason = if name == "random" {
                        "placeholder-random"
                    } else if name.starts_with(PARAM_PREFIX) {
                        "placeholder-param"
                    } else {
                        "placeholder"
                    };
                    self.push(
                        ProblemCode::SegnapostoSconosciuto,
                        field,
                        said(reason, &shown),
                    );
                }
            }
            Value::Array(items) => {
                for (j, item) in items.iter().enumerate() {
                    self.placeholders(item, &format!("{field}[{j}]"), declared);
                }
            }
            Value::Object(map) => {
                for (name, item) in map {
                    self.placeholders(item, &format!("{field}.{name}"), declared);
                }
            }
            _ => {}
        }
    }
}

/// `name` (senza graffe) è un segnaposto delle ricette, con questi parametri?
fn known(name: &str, declared: &BTreeSet<String>) -> bool {
    match name.strip_prefix(PARAM_PREFIX) {
        Some(param) => declared.contains(param),
        None => [DOC, TITLE, FOLDER, SELECTION].contains(&name) || DATE_NAMES.contains(&name),
    }
}

/// I nomi fra doppie graffe di `text`, nell'ordine: `"a {{date}} b"` dà
/// `date`. Una `{{` senza chiusura resta testo.
fn placeholders(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        let open = rest.find("{{")?;
        let after = &rest[open + 2..];
        let close = after.find("}}")?;
        rest = &after[close + 2..];
        Some(&after[..close])
    })
}

/// `value` cita il segnaposto `name`, a qualunque profondità?
fn mentions(value: &Value, name: &str) -> bool {
    match value {
        Value::String(text) => placeholders(text).any(|found| found == name),
        Value::Array(items) => items.iter().any(|v| mentions(v, name)),
        Value::Object(map) => map.values().any(|v| mentions(v, name)),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Le righe del blocco
// ---------------------------------------------------------------------------

/// Un pezzo del percorso di un campo.
enum Segment<'a> {
    Key(&'a str),
    Index(usize),
}

/// `steps[1].args.to` → `steps`, `[1]`, `args`, `to`.
fn segments(field: &str) -> Vec<Segment<'_>> {
    let mut out = Vec::new();
    for part in field.split('.').filter(|p| !p.is_empty()) {
        let (name, mut rest) = part.split_at(part.find('[').unwrap_or(part.len()));
        if !name.is_empty() {
            out.push(Segment::Key(name));
        }
        while let Some(open) = rest.strip_prefix('[') {
            let Some(close) = open.find(']') else { break };
            match open[..close].parse() {
                Ok(index) => out.push(Segment::Index(index)),
                Err(_) => break,
            }
            rest = &open[close + 1..];
        }
    }
    out
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

/// Una riga che porta qualcosa: né vuota né un commento.
fn content(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty() && !trimmed.starts_with('#')
}

/// Una voce d'elenco: `- …` o un `-` da solo.
fn dash(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed == "-" || trimmed.starts_with("- ")
}

/// La chiave di una riga `chiave: valore`, anche fra virgolette.
fn key_of(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    for quote in ['"', '\''] {
        if let Some(inner) = trimmed.strip_prefix(quote) {
            let close = inner.find(quote)?;
            return inner[close + 1..]
                .trim_start()
                .starts_with(':')
                .then_some(&inner[..close]);
        }
    }
    let colon = trimmed.find(':')?;
    let after = &trimmed[colon + 1..];
    (after.is_empty() || after.starts_with([' ', '\t'])).then(|| trimmed[..colon].trim_end())
}

/// La riga (da zero) del campo `field` nello YAML a blocchi, o quella del suo
/// antenato più vicino che si trova. Non è un parser: segue l'indentazione
/// della forma che si scrive a mano e che scrivono le AI; una mappa fra graffe
/// dà la riga della chiave che la apre.
fn locate(yaml: &str, field: &str) -> Option<usize> {
    let mut lines: Vec<String> = yaml.lines().map(str::to_string).collect();
    let (mut lo, mut hi) = (0, lines.len());
    let mut found = None;
    for segment in segments(field) {
        // Un valore sulla riga della chiave (`args: { … }`) non ha righe sue:
        // resta la riga dell'antenato.
        let Some(child) = (lo..hi)
            .filter(|&i| content(&lines[i]))
            .map(|i| indent(&lines[i]))
            .min()
        else {
            return found;
        };
        match segment {
            Segment::Key(name) => {
                let Some(at) = (lo..hi).find(|&i| {
                    content(&lines[i])
                        && indent(&lines[i]) == child
                        && key_of(&lines[i]) == Some(name)
                }) else {
                    return found;
                };
                found = Some(at);
                let own = indent(&lines[at]);
                // Il valore finisce alla prima riga meno rientrata, o rientrata
                // uguale e non voce d'elenco (`steps:` seguito da `- run:` allo
                // stesso rientro è YAML valido).
                hi = (at + 1..hi)
                    .find(|&j| {
                        content(&lines[j])
                            && (indent(&lines[j]) < own
                                || (indent(&lines[j]) == own && !dash(&lines[j])))
                    })
                    .unwrap_or(hi);
                lo = at + 1;
            }
            Segment::Index(index) => {
                let Some(at) = (lo..hi)
                    .filter(|&i| {
                        content(&lines[i]) && indent(&lines[i]) == child && dash(&lines[i])
                    })
                    .nth(index)
                else {
                    return found;
                };
                found = Some(at);
                hi = (at + 1..hi)
                    .find(|&j| content(&lines[j]) && indent(&lines[j]) <= child)
                    .unwrap_or(hi);
                lo = at;
                // La prima chiave della voce sta sulla riga del trattino: senza
                // il trattino ha il rientro delle altre chiavi della voce.
                lines[at].replace_range(child..child + 1, " ");
            }
        }
    }
    found
}

// ---------------------------------------------------------------------------
// Contro il registro, l'impronta, la spec e i passi espansi
// ---------------------------------------------------------------------------

/// I controlli contro il registro vivo: ogni passo nomina un comando che c'è,
/// che non è un'altra ricetta, che si annulla e che non cambia le
/// impostazioni; e i suoi argomenti, con valori d'esempio del tipo giusto al
/// posto dei segnaposto, passano la convalida della sua spec.
pub fn check_against(recipe: &Recipe, registry: &[CommandSpec]) -> Vec<Problem> {
    let mut problems = Vec::new();
    let mut push = |code, field: String, message| {
        let line = recipe.line_of(&field);
        problems.push(Problem::new(code, field, Some(line), message));
    };
    for (i, step) in recipe.steps.iter().enumerate() {
        let run_field = format!("{F_STEPS}[{i}].{S_RUN}");
        if step.run.starts_with(RECIPE_NS) {
            push(
                ProblemCode::ComandoRicetta,
                run_field,
                said("comando-ricetta", &step.run),
            );
            continue;
        }
        let Some(spec) = registry.iter().find(|spec| spec.id == step.run) else {
            push(
                ProblemCode::ComandoSconosciuto,
                run_field,
                said("comando-sconosciuto", &step.run),
            );
            continue;
        };
        if !spec.scope.reversible {
            push(
                ProblemCode::NonSiAnnulla,
                run_field.clone(),
                said("non-si-annulla", &step.run),
            );
        }
        if spec.scope.reach == CommandReach::Settings {
            push(
                ProblemCode::Impostazioni,
                run_field,
                said("impostazioni", &step.run),
            );
        }
        let sample = fill(&Value::Object(step.args.clone()), &|name| {
            sample_value(recipe, name)
        });
        let refused = match sample {
            Ok(args) => spec.validate_args(&args).err().map(|error| {
                let text = error.message();
                let locale = Locale::default();
                Strings::none(&locale).render(text)
            }),
            // Un segnaposto sconosciuto l'ha già detto la lettura.
            Err(_) => None,
        };
        if let Some(detail) = refused {
            push(
                ProblemCode::Argomenti,
                format!("{F_STEPS}[{i}].{S_ARGS}"),
                Text::message(
                    key("argomenti"),
                    vec![Arg::text("value", &step.run), Arg::text("detail", detail)],
                ),
            );
        }
    }
    problems
}

/// Le ricette di un vault il cui `id` torna più di una volta: per ognuna,
/// nell'ordine di `recipes`, `Some(id-ripetuto)` o `None`.
pub fn check_unique(recipes: &[&Recipe]) -> Vec<Option<Problem>> {
    recipes
        .iter()
        .map(|recipe| {
            let twice = recipes.iter().filter(|other| other.id == recipe.id).count() > 1;
            twice.then(|| Problem::repeated_id(recipe))
        })
        .collect()
}

/// Un valore d'esempio, del tipo che il segnaposto darà davvero.
fn sample_value(recipe: &Recipe, name: &str) -> Option<Value> {
    if let Some(param) = name.strip_prefix(PARAM_PREFIX) {
        let param = recipe.params.iter().find(|p| p.name == param)?;
        return Some(match param.kind {
            RecipeParamKind::Text => Value::from("testo"),
            RecipeParamKind::Number => Value::from(1),
            RecipeParamKind::Bool => Value::from(true),
            RecipeParamKind::Document => Value::from("Nota.md"),
            RecipeParamKind::Choice => Value::from(param.options.first()?.as_str()),
        });
    }
    Some(Value::from(match name {
        DOC => "Cartella/Nota.md",
        TITLE => "Nota",
        FOLDER => "Cartella",
        SELECTION => "testo",
        "date" => "2026-01-31",
        "time" => "09:30",
        "datetime" => "2026-01-31 09:30",
        "year" => "2026",
        "month" => "01",
        "day" => "31",
        "hour" => "09",
        "minute" => "30",
        _ => return None,
    }))
}

/// Sostituisce i segnaposto di `value` con i valori di `lookup`, in una
/// passata sola (un valore che contiene `{{…}}` resta com'è). Una stringa che
/// è **esattamente** un segnaposto prende il valore col suo tipo; altrimenti
/// il valore entra come testo. Un segnaposto che `lookup` non conosce è
/// l'errore, col suo nome.
fn fill(value: &Value, lookup: &dyn Fn(&str) -> Option<Value>) -> Result<Value, String> {
    Ok(match value {
        Value::String(text) => {
            let whole = text
                .strip_prefix("{{")
                .and_then(|t| t.strip_suffix("}}"))
                .filter(|inner| !inner.contains("{{") && !inner.contains("}}"));
            if let Some(name) = whole {
                return lookup(name).ok_or_else(|| name.to_string());
            }
            let mut out = String::new();
            let mut rest = text.as_str();
            while let Some(open) = rest.find("{{") {
                let after = &rest[open + 2..];
                let Some(close) = after.find("}}") else { break };
                let name = &after[..close];
                out.push_str(&rest[..open]);
                match lookup(name).ok_or_else(|| name.to_string())? {
                    Value::String(s) => out.push_str(&s),
                    Value::Null => {}
                    other => out.push_str(&other.to_string()),
                }
                rest = &after[close + 2..];
            }
            out.push_str(rest);
            Value::String(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| fill(item, lookup))
                .collect::<Result<_, _>>()?,
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| Ok((k.clone(), fill(v, lookup)?)))
                .collect::<Result<_, String>>()?,
        ),
        other => other.clone(),
    })
}

/// L'impronta: SHA-256, in esadecimale, del JSON canonico della ricetta letta
/// (chiavi in ordine, nessuno spazio). Non è l'impronta del testo della nota:
/// un commento fuori dal blocco, o dentro come commento YAML, non la cambia.
pub fn fingerprint(recipe: &Recipe) -> String {
    let json = serde_json::to_value(recipe).unwrap_or(Value::Null);
    let canonical = canonical(&json).to_string();
    Sha256::digest(canonical.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Lo stesso valore con le chiavi di ogni mappa in ordine.
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), canonical(&map[k])))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// I parametri della spec: prima `selection` se un passo usa `{{selection}}`,
/// poi `doc` se un passo usa `{{doc}}`, `{{title}}` o `{{folder}}`, poi i
/// dichiarati.
fn params_of(recipe: &Recipe) -> Vec<ParamSpec> {
    let mut params = Vec::new();
    if recipe.uses(SELECTION) {
        params.push(
            ParamSpec::new(
                SELECTION,
                Text::key("recipes.param.selection"),
                ParamKind::Text,
            )
            .describing(Text::key("recipes.param.selection.desc"))
            .required(),
        );
    }
    if [DOC, TITLE, FOLDER].iter().any(|name| recipe.uses(name)) {
        params.push(
            ParamSpec::new(DOC, Text::key("recipes.param.doc"), ParamKind::Document)
                .describing(Text::key("recipes.param.doc.desc"))
                .required(),
        );
    }
    for param in &recipe.params {
        let kind = match param.kind {
            RecipeParamKind::Text => ParamKind::Text,
            RecipeParamKind::Number => ParamKind::Number,
            RecipeParamKind::Bool => ParamKind::Bool,
            RecipeParamKind::Document => ParamKind::Document,
            RecipeParamKind::Choice => ParamKind::Choice(
                param
                    .options
                    .iter()
                    .map(|o| Choice::new(o.as_str(), Text::from(o.as_str())))
                    .collect(),
            ),
        };
        let mut spec = ParamSpec::new(param.name.as_str(), Text::from(param.title.as_str()), kind);
        spec.required = param.required;
        params.push(spec);
    }
    params
}

/// La spec del comando che la ricetta diventa: `recipe.<id>:run`, titolo e
/// descrizione così come sono scritti, scorciatoia e superfici dal blocco
/// (più `slash_selection` se usa la selezione), `writes` se un passo scrive,
/// la portata più larga dei passi, sempre reversibile.
///
/// Prende il registro perché la portata è quella dei comandi dei passi. Un
/// passo che il registro non conosce (una ricetta che non ha passato
/// [`check_against`] non si monta) conta come una scrittura sul vault: nel
/// dubbio la spec dichiara di più, mai di meno.
pub fn spec(recipe: &Recipe, registry: &[CommandSpec]) -> CommandSpec {
    let mut writes = false;
    let mut reach = CommandReach::Session;
    for step in &recipe.steps {
        let scope = registry
            .iter()
            .find(|spec| spec.id == step.run)
            .map_or(CommandScope::writing(CommandReach::Vault), |spec| {
                spec.scope
            });
        writes |= scope.writes;
        reach = reach.max(scope.reach);
    }
    let mut spec = CommandSpec::new(recipe.command_id(), Text::from(recipe.title.as_str()))
        .describing(Text::from(recipe.description.as_str()))
        .with_scope(CommandScope {
            writes,
            reach,
            reversible: true,
        });
    if let Some(binding) = &recipe.keybinding {
        spec = spec.with_keybinding(binding.as_str());
    }
    for surface in &recipe.surfaces {
        spec = spec.offered_in(*surface);
    }
    if recipe.uses(SELECTION) {
        spec = spec.offered_in(CommandSurface::SlashSelection);
    }
    spec.params = params_of(recipe);
    spec
}

/// I passi pronti da lanciare: `(id del comando, argomenti)`, con i
/// segnaposto sostituiti dagli `args` del comando della ricetta e dalle date
/// di `ctx`.
///
/// `{{doc}}` è `args.doc`, `{{title}}` il suo nome senza estensione,
/// `{{folder}}` la sua cartella (vuota alla radice), `{{selection}}`
/// `args.selection`, `{{param.<nome>}}` l'argomento dichiarato. Un parametro
/// facoltativo assente vale `null` quando è l'intero valore, e testo vuoto
/// dentro un testo. Gli `args` che la spec della ricetta rifiuta danno il
/// problema `argomenti`.
pub fn expand(recipe: &Recipe, args: &Value, ctx: &Ctx) -> Result<Vec<(String, Value)>, Problem> {
    let params = params_of(recipe);
    if let Err(error) = validate_params(&recipe.command_id(), &params, args) {
        let locale = Locale::default();
        let detail = Strings::none(&locale).render(error.message());
        return Err(Problem::new(
            ProblemCode::Argomenti,
            "",
            Some(recipe.located.fence),
            Text::message(
                key("argomenti"),
                vec![
                    Arg::text("value", recipe.command_id()),
                    Arg::text("detail", detail),
                ],
            ),
        ));
    }
    let doc = args.get(DOC).and_then(Value::as_str).map(DocId::new);
    let lookup = |name: &str| -> Option<Value> {
        if let Some(param) = name.strip_prefix(PARAM_PREFIX) {
            recipe.params.iter().find(|p| p.name == param)?;
            return Some(args.get(param).cloned().unwrap_or(Value::Null));
        }
        if let Some(date) = ctx.get(name) {
            return Some(Value::from(date));
        }
        match name {
            DOC => doc.as_ref().map(|d| Value::from(d.as_str())),
            TITLE => doc.as_ref().map(|d| Value::from(d.page_name())),
            FOLDER => doc
                .as_ref()
                .map(|d| Value::from(d.as_str().rsplit_once('/').map_or("", |(folder, _)| folder))),
            SELECTION => args.get(SELECTION).cloned(),
            _ => None,
        }
    };
    recipe
        .steps
        .iter()
        .enumerate()
        .map(|(i, step)| {
            let filled = fill(&Value::Object(step.args.clone()), &lookup).map_err(|name| {
                let field = format!("{F_STEPS}[{i}].{S_ARGS}");
                let line = recipe.line_of(&field);
                Problem::new(
                    ProblemCode::SegnapostoSconosciuto,
                    field,
                    Some(line),
                    said("placeholder", &format!("{{{{{name}}}}}")),
                )
            })?;
            Ok((step.run.clone(), filled))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::catalog;

    /// Ogni frase che questo modulo nomina (`said("…"`, `on_field("…"`,
    /// `key("…"`) sta nei due cataloghi: una chiave che manca arriverebbe alla
    /// persona come testo grezzo.
    #[test]
    fn ogni_motivo_ha_la_sua_frase_nelle_due_lingue() {
        let source = include_str!("format.rs");
        let catalogs = catalog();
        let mut seen = 0;
        for opener in ["said(\"", "on_field(\"", "key(\""] {
            for (at, _) in source.match_indices(opener) {
                let rest = &source[at + opener.len()..];
                let reason = &rest[..rest.find('"').expect("la stringa chiude")];
                // Solo i motivi veri: la prosa qui sopra cita gli stessi
                // nomi con un `…`.
                let named = reason.chars().all(|c| c.is_ascii_lowercase() || c == '-');
                if reason.is_empty() || !named {
                    continue;
                }
                seen += 1;
                for catalog in &catalogs {
                    let key = format!("recipes.problem.{reason}");
                    assert!(
                        catalog.entries.contains_key(&key),
                        "{key} manca in {}",
                        catalog.locale
                    );
                }
            }
        }
        assert!(seen > 30, "il presidio non vede le chiavi: {seen}");
    }
}
