//! `fub-cli ricette`: controllare e provare una ricetta da fuori, prima di
//! proporla alla persona. Gli strumenti MCP `fub_recipe_check` e
//! `fub_recipe_try` (`mcp/tools.rs`) passano da qui: una sola definizione per
//! i due ingressi.
//!
//! - **Il formato è del componente.** La lettura (`parse`), i controlli contro
//!   il registro vivo (`check_against`) e la prova (`plan`) sono quelli di
//!   `fub_features::recipes`, ripresi da `fub_host::recipe_format`: la CLI non
//!   ha un secondo lettore delle ricette. Qui restano le parole e la forma JSON.
//! - **Tutto passa da [`Connection`]**: la nota si legge con `read_document` e
//!   `read_model`, i comandi con `commands`, i passi della prova con
//!   `invoke_user_command` in `DryRun`. Con il vault aperto nell'app le
//!   chiamate vanno a lei; senza, all'host locale.
//! - **Niente si accende da qui.** Controllare e provare non adottano: una
//!   ricetta la accende soltanto la persona, nell'app. La prova non scrive:
//!   ogni passo gira in simulazione.

use fub_abi::rules::path_policy::{check as check_name, Naming};
use fub_abi::{
    CommandSpec, DocId, IndexQuery, IndexResult, InvokeMode, Locale, PluginError, SettingValue,
    Strings,
};
use fub_host::recipe_format::{
    self as format, Problem, Recipe, RECIPES_FOLDER_DEFAULT, RECIPES_FOLDER_KEY,
};
use serde_json::{json, Map, Value};

use crate::cli::{GlobalArgs, RicetteAction, RicetteArgs};
use crate::commands::{doc_id, parse_json_object, Connection, Failure};
use crate::output::{envelope_ok, OutputFormat};

/// Il comando che il componente «Ricette» porta sempre: se il registro non
/// lo ha, il componente è spento in questo vault.
const RECIPES_NEW: &str = "recipes.new";

/// La lingua delle frasi dei problemi e della prova. La CLI non ha una shell
/// che le dica la lingua di chi guarda: parla quella di serie dei cataloghi.
const LANGUAGE: &str = "it";

/// Una ricetta letta e controllata: i problemi della lettura o, se si legge,
/// quelli contro il registro vivo; e dove sta rispetto alla cartella delle
/// ricette.
pub struct Checked {
    pub doc: DocId,
    /// La ricetta, se il blocco si legge.
    pub recipe: Option<Recipe>,
    pub problems: Vec<Problem>,
    /// La cartella delle ricette del vault (`recipes.folder`).
    pub folder: String,
    /// Se la nota sta nella cartella: fuori, Fub non la propone.
    pub in_folder: bool,
    /// Se il componente «Ricette» è acceso nel vault.
    pub component: bool,
    /// Il registro vivo su cui la ricetta è stata controllata.
    commands: Vec<CommandSpec>,
}

impl Checked {
    pub fn valid(&self) -> bool {
        self.problems.is_empty() && self.recipe.is_some()
    }

    /// Le note per chi la propone: ciò che non è un problema del blocco ma la
    /// terrebbe lontana dall'app.
    fn notes(&self) -> Vec<String> {
        let mut notes = Vec::new();
        if !self.in_folder {
            notes.push(format!(
                "La nota non è nella cartella delle ricette ({}): Fub non la propone finché non la sposti lì.",
                self.folder
            ));
        }
        if !self.component {
            notes.push(
                "Il componente Ricette è spento in questo vault: la ricetta compare soltanto dopo che la persona lo accende."
                    .to_string(),
            );
        }
        notes
    }

    pub fn to_json(&self) -> Value {
        let strings = catalogs();
        let locale = Locale::default();
        let strings = Strings::new(&strings, LANGUAGE, &locale);
        let problems: Vec<Value> = self
            .problems
            .iter()
            .map(|problem| problem_json(problem, &strings))
            .collect();
        let recipe = self.recipe.as_ref();
        json!({
            "doc": self.doc.as_str(),
            "valid": self.valid(),
            "id": recipe.map(|r| r.id.clone()),
            "title": recipe.map(|r| r.title.clone()),
            "command": recipe.map(Recipe::command_id),
            "steps": recipe.map(|r| r.steps.len()),
            "folder": self.folder,
            "in_folder": self.in_folder,
            "component": self.component,
            "problems": problems,
            "notes": self.notes(),
        })
    }
}

/// I cataloghi delle frasi delle ricette.
fn catalogs() -> Vec<fub_abi::StringCatalog> {
    format::catalog()
}

fn problem_json(problem: &Problem, strings: &Strings) -> Value {
    json!({
        "code": problem.code.as_str(),
        "field": problem.field,
        "line": problem.line,
        "message": strings.render(&problem.message),
    })
}

/// Un problema in una riga: «riga 7 · steps[1].run · comando-sconosciuto: …».
pub fn problem_line(problem: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(line) = problem["line"].as_u64() {
        parts.push(format!("riga {line}"));
    }
    if let Some(field) = problem["field"].as_str().filter(|f| !f.is_empty()) {
        parts.push(field.to_string());
    }
    let code = problem["code"].as_str().unwrap_or_default();
    let message = problem["message"].as_str().unwrap_or_default();
    parts.push(format!("{code}: {message}"));
    parts.join(" · ")
}

/// «La ricetta ha 2 problemi; il primo: riga 7 · …».
pub fn refusal(checked: &Value) -> String {
    let problems = checked["problems"].as_array().cloned().unwrap_or_default();
    let count = problems.len();
    let first = problems.first().map(problem_line).unwrap_or_default();
    match count {
        1 => format!("La ricetta ha un problema: {first}"),
        n => format!("La ricetta ha {n} problemi; il primo: {first}"),
    }
}

/// La cartella delle ricette come la decide il componente
/// (`fub_features::recipes::recipes_folder`): il valore dell'impostazione se
/// è una cartella che si può creare, altrimenti quella di serie.
fn recipes_folder(c: &Connection) -> Result<String, Failure> {
    let entries = match c
        .host
        .query_index(c.vault_selector(), IndexQuery::Settings { plugin: None })
    {
        Ok(IndexResult::Settings(entries)) => entries,
        Ok(other) => {
            return Err(Failure::local(format!(
                "le impostazioni hanno risposto {}",
                other.kind_name()
            )))
        }
        Err(error) => return Err(Failure::from_plugin(&error)),
    };
    let raw = entries
        .iter()
        .find(|entry| entry.spec.key == RECIPES_FOLDER_KEY)
        .and_then(|entry| match &entry.value {
            SettingValue::Text(raw) => Some(raw.clone()),
            _ => None,
        });
    let folder = raw
        .map(|raw| fub_abi::rules::folders::normalized(raw.trim()).to_string())
        .filter(|folder| {
            !folder.is_empty() && check_name(&format!("{folder}/_"), Naming::New).is_ok()
        });
    Ok(folder.unwrap_or_else(|| RECIPES_FOLDER_DEFAULT.to_string()))
}

/// Legge la nota `doc` e la controlla: la lettura del blocco e, se si legge,
/// i controlli contro i comandi del vault.
pub fn check(c: &Connection, doc: &DocId) -> Result<Checked, Failure> {
    let vault = c.vault_selector();
    let (source, _) = c
        .host
        .read_document(vault, doc)
        .map_err(|error| Failure::from_plugin(&error))?;
    let model = c
        .host
        .read_model(vault, doc)
        .map_err(|error| Failure::from_plugin(&error))?;
    let commands = c
        .host
        .commands(vault)
        .map_err(|error| Failure::from_plugin(&error))?;
    let (recipe, problems) = match format::parse(&model, &source) {
        Ok(recipe) => {
            let problems = format::check_against(&recipe, &commands);
            (Some(recipe), problems)
        }
        Err(problems) => (None, problems),
    };
    let folder = recipes_folder(c)?;
    let in_folder = doc
        .as_str()
        .strip_prefix(folder.as_str())
        .is_some_and(|rest| rest.starts_with('/'));
    let component = commands.iter().any(|spec| spec.id == RECIPES_NEW);
    Ok(Checked {
        doc: doc.clone(),
        recipe,
        problems,
        folder,
        in_folder,
        component,
        commands,
    })
}

/// L'esito di una prova: il piano, o la ricetta che non passa i controlli.
pub enum Tried {
    Plan(Value),
    Refused(Value),
}

/// Gli argomenti della prova: quelli dati, più `doc` se c'è una nota.
pub fn try_args(doc: Option<&str>, args: Option<Value>) -> Result<Value, Failure> {
    let mut map = match args {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map,
        Some(_) => {
            return Err(Failure::bad_args(
                "gli argomenti della prova sono un oggetto",
            ))
        }
    };
    if let Some(doc) = doc {
        if map.contains_key("doc") {
            return Err(Failure::bad_args(
                "la nota si dà una volta sola: --doc (o `doc`) oppure `doc` negli argomenti",
            ));
        }
        map.insert(
            "doc".into(),
            Value::String(doc_id(doc)?.as_str().to_string()),
        );
    }
    Ok(Value::Object(map))
}

/// L'errore detto con le frasi delle ricette (un argomento che manca, un
/// segnaposto senza valore), poi come ogni errore dell'host.
fn localized(mut error: PluginError) -> Failure {
    let catalogs = catalogs();
    let locale = Locale::default();
    Strings::new(&catalogs, LANGUAGE, &locale).localize(&mut error);
    Failure::from_plugin(&error)
}

/// **La prova**: la ricetta della nota `recipe`, controllata, poi ogni passo
/// in simulazione con `args` (`doc` compreso), come lo farebbe l'app dopo
/// l'adozione. Una ricetta con problemi non si prova: torna il controllo.
pub fn try_recipe(c: &Connection, recipe: &DocId, args: Value) -> Result<Tried, Failure> {
    let checked = check(c, recipe)?;
    let Some(read) = checked.recipe.as_ref().filter(|_| checked.valid()) else {
        return Ok(Tried::Refused(checked.to_json()));
    };
    // Gli argomenti come li controllerebbe il registro davanti al comando
    // della ricetta: la prova non accetta ciò che l'esecuzione rifiuta.
    format::spec(read, &checked.commands)
        .validate_args(&args)
        .map_err(localized)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default();
    let ctx = format::context_at(now, &Locale::default()).map_err(localized)?;
    let vault = c.vault_selector();
    let plan = format::plan(read, &args, &ctx, |command, step_args| {
        c.host
            .invoke_user_command(vault, command, step_args, InvokeMode::DryRun)
    })
    .map_err(localized)?;
    let catalogs = catalogs();
    let locale = Locale::default();
    let strings = Strings::new(&catalogs, LANGUAGE, &locale);
    let docs: Vec<&str> = plan.docs.iter().map(DocId::as_str).collect();
    Ok(Tried::Plan(json!({
        "recipe": recipe.as_str(),
        "id": read.id,
        "title": read.title,
        "command": read.command_id(),
        "args": args,
        "dry_run": true,
        // In simulazione niente si sposta: un passo dopo una rinomina vede la
        // nota dov'era.
        "approximate": read.steps.len() > 1,
        "summary": strings.render(&plan.summary),
        "docs": docs,
        "edits": serde_json::to_value(&plan.edits).unwrap_or(Value::Null),
        "notes": checked.notes(),
    })))
}

/// Stampa: righe di testo per chi legge, la busta per gli altri formati.
fn print(global: &GlobalArgs, format: &OutputFormat, data: Value, lines: &[String]) {
    if format.is_human() {
        if !global.quiet {
            for line in lines {
                println!("{line}");
            }
        }
        return;
    }
    crate::print_value(global, format, &envelope_ok(data));
}

fn notes_of(data: &Value) -> impl Iterator<Item = String> + '_ {
    data["notes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| n.as_str().map(str::to_string))
}

/// Il fallimento di una ricetta che ha problemi: uscita 1.
fn has_problems(data: &Value) -> Failure {
    let count = data["problems"].as_array().map_or(0, Vec::len);
    let message = match count {
        1 => "la ricetta ha un problema".to_string(),
        n => format!("la ricetta ha {n} problemi"),
    };
    Failure::new(1, "invalid", message)
}

fn checked_lines(data: &Value) -> Vec<String> {
    let mut lines = Vec::new();
    if data["valid"] == true {
        let steps = match data["steps"].as_u64().unwrap_or_default() {
            1 => "un passo".to_string(),
            n => format!("{n} passi"),
        };
        lines.push(format!(
            "«{}» ({}): nessun problema, {steps}. Diventa il comando {}.",
            data["title"].as_str().unwrap_or_default(),
            data["id"].as_str().unwrap_or_default(),
            data["command"].as_str().unwrap_or_default(),
        ));
    } else {
        for problem in data["problems"].as_array().into_iter().flatten() {
            lines.push(problem_line(problem));
        }
    }
    lines.extend(notes_of(data));
    lines
}

pub fn run(
    c: &Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    args: RicetteArgs,
) -> Result<(), Failure> {
    match args.action {
        RicetteAction::Controlla { recipe } => {
            let data = check(c, &doc_id(&recipe)?)?.to_json();
            let valid = data["valid"] == true;
            let lines = checked_lines(&data);
            print(global, format, data.clone(), &lines);
            if valid {
                Ok(())
            } else {
                Err(has_problems(&data))
            }
        }
        RicetteAction::Prova {
            recipe,
            doc,
            args_json,
        } => {
            let extra = args_json.as_deref().map(parse_json_object).transpose()?;
            let call = try_args(doc.as_deref(), extra)?;
            match try_recipe(c, &doc_id(&recipe)?, call)? {
                Tried::Refused(data) => {
                    let lines = checked_lines(&data);
                    print(global, format, data.clone(), &lines);
                    Err(has_problems(&data))
                }
                Tried::Plan(data) => {
                    let mut lines = vec![format!(
                        "Prova, senza scrivere niente. {}",
                        data["summary"].as_str().unwrap_or_default()
                    )];
                    let docs: Vec<&str> = data["docs"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect();
                    if !docs.is_empty() {
                        lines.push(format!("Note toccate: {}", docs.join(", ")));
                    }
                    if data["approximate"] == true {
                        lines.push(
                            "La prova è approssimata: in simulazione niente si sposta, quindi un passo dopo una rinomina vede la nota dov'era."
                                .to_string(),
                        );
                    }
                    lines.extend(notes_of(&data));
                    print(global, format, data, &lines);
                    Ok(())
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_problema_in_una_riga() {
        let problem = json!({ "code": "comando-sconosciuto", "field": "steps[1].run", "line": 9, "message": "Il comando «x» non c'è." });
        assert_eq!(
            problem_line(&problem),
            "riga 9 · steps[1].run · comando-sconosciuto: Il comando «x» non c'è."
        );
        let whole = json!({ "code": "blocco-assente", "field": "", "line": null, "message": "Nessun blocco." });
        assert_eq!(problem_line(&whole), "blocco-assente: Nessun blocco.");
    }

    #[test]
    fn il_rifiuto_dice_quanti_e_il_primo() {
        let one =
            json!({ "problems": [{ "code": "yaml", "field": "", "line": 3, "message": "M" }] });
        assert_eq!(refusal(&one), "La ricetta ha un problema: riga 3 · yaml: M");
        let two = json!({ "problems": [
            { "code": "yaml", "field": "", "line": 3, "message": "M" },
            { "code": "campo-mancante", "field": "id", "line": 4, "message": "N" }
        ] });
        assert!(refusal(&two).starts_with("La ricetta ha 2 problemi; il primo: riga 3"));
    }

    #[test]
    fn la_nota_si_da_una_volta_sola() {
        assert_eq!(
            try_args(Some("a.md"), None).unwrap(),
            json!({ "doc": "a.md" })
        );
        assert!(try_args(Some("a.md"), Some(json!({ "doc": "b.md" }))).is_err());
        assert!(try_args(None, Some(json!([1]))).is_err());
        assert_eq!(
            try_args(None, Some(json!({ "param": 1 }))).unwrap(),
            json!({ "param": 1 })
        );
    }
}
