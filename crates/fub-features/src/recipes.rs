//! Le ricette: note Markdown che dicono a Fub quali comandi fare, in fila, su
//! una nota.
//!
//! Una ricetta vive nella cartella dell'impostazione `recipes.folder` (di
//! serie `Recipes`, come `Templates` e `Daily`), con esattamente un blocco di
//! codice `fub-recipe` dentro: si legge, si copia e si manda a un amico come
//! ogni nota. Il contratto del blocco sta in `docs/reference/ricette.md`.
//!
//! Questo modulo dà alle ricette il loro componente (si spegne e si vede
//! nella mappa), l'impostazione della cartella, il punto di partenza per chi
//! non usa un'AI (`recipes.new`, che scrive una ricetta d'esempio) e, nel
//! sottomodulo `format`, la lettura e i controlli del blocco. L'esecuzione
//! arriva dopo, qui accanto.

mod format;

pub use format::{
    check_against, check_unique, command_id, expand, fingerprint, parse, spec, Problem,
    ProblemCode, Recipe, RecipeParam, RecipeParamKind, RecipeStep, FORMAT_VERSION, RECIPES_MAX,
    RECIPE_NS, STEPS_MAX,
};

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::path_policy::{check as check_name, Naming};
use fub_abi::settings::{SettingKind, SettingSpec, SettingValue};
use fub_abi::text::{Arg, StringCatalog, Strings, Text};
use fub_abi::traits::{CommandProvider, HostApi, ReadApi};

/// L'id del componente e del suo bundle.
pub const RECIPES_ID: &str = "fub.recipes";
/// Crea una ricetta d'esempio nella cartella delle ricette e la apre.
pub const RECIPES_NEW: &str = "recipes.new";
/// La cartella delle ricette del vault: viaggia con le note, come
/// `daily.folder`.
pub const RECIPES_FOLDER_KEY: &str = "recipes.folder";
/// La cartella di serie (D9).
pub const RECIPES_FOLDER_DEFAULT: &str = "Recipes";

/// L'inverso di «crea» è «cestina», come per `note.create`: un inverso
/// reversibile per un gesto reversibile. Id letterale e non import da
/// `crate::commands`: i moduli di feature non si nominano fra loro
/// (`tests/independent_modules.rs`).
const TRASH: &str = "note.trash";

/// Una ricetta è una nota Markdown con un blocco di codice: nasce `.md`
/// qualunque sia l'estensione scelta per le note nuove, perché il blocco
/// `fub-recipe` lo legge il formato Markdown.
const EXTENSION: &str = "md";
/// Il linguaggio del blocco che fa di una nota una ricetta.
const FENCE: &str = "fub-recipe";
/// Il più lungo `id` che il contratto accetta.
const ID_MAX: usize = 48;

const TITLE: &str = "title";

const S_GROUP: &str = "recipes.group";
const S_FOLDER: &str = "recipes.folder";
const S_FOLDER_DESC: &str = "recipes.folder.desc";
const N_UNTITLED: &str = "recipes.untitled";
/// L'id di serie quando il titolo non ha nessuna lettera o cifra latina.
const N_FALLBACK_ID: &str = "recipes.sample.id";
const N_INTRO: &str = "recipes.sample.intro";
const N_DESCRIPTION: &str = "recipes.sample.description";
const N_PROPERTY: &str = "recipes.sample.property";
const N_ARCHIVE: &str = "recipes.sample.archive";
const E_BAD_TITLE: &str = "e_bad_title";
const P_NEW: &str = "p_new";
const D_NEW: &str = "d_new";
const U_NEW: &str = "u_new";
const A_DOC: &str = "doc";
const A_VALUE: &str = "value";

/// Il catalogo delle ricette, in italiano e in inglese.
pub fn catalog() -> Vec<StringCatalog> {
    let mut it = StringCatalog::new("it");
    let mut en = StringCatalog::new("en");
    for (key, it_text, en_text) in STRINGS {
        it.entries.insert(key.to_string(), it_text.to_string());
        en.entries.insert(key.to_string(), en_text.to_string());
    }
    vec![it, en]
}

/// Chiave, italiano, inglese.
const STRINGS: &[(&str, &str, &str)] = &[
    ("recipes.new.title", "Nuova ricetta", "New recipe"),
    (
        "recipes.new.desc",
        "Scrive una ricetta d'esempio nella cartella delle ricette e la apre.",
        "Writes a sample recipe in the recipes folder and opens it.",
    ),
    ("recipes.new.title.title", "Titolo", "Title"),
    (
        "recipes.new.title.desc",
        "Il nome della nota e della ricetta. Senza, «Nuova ricetta».",
        "The name of the note and of the recipe. Without one, \"New recipe\".",
    ),
    (S_GROUP, "Ricette", "Recipes"),
    (S_FOLDER, "Cartella delle ricette", "Recipes folder"),
    (
        S_FOLDER_DESC,
        "Le note con un blocco fub-recipe in questa cartella, sottocartelle comprese, sono le ricette del vault.",
        "The notes with a fub-recipe block in this folder, subfolders included, are the vault's recipes.",
    ),
    (N_UNTITLED, "Nuova ricetta", "New recipe"),
    (N_FALLBACK_ID, "ricetta", "recipe"),
    (
        N_INTRO,
        "Questa nota è una ricetta: il blocco qui sotto dice a Fub quali comandi fare, in fila, sulla nota su cui la usi. Così com'è segna la data di oggi e sposta la nota in Archivio. Cambiala come ti serve: Fub la controlla, e te la fa guardare prima di accenderla.",
        "This note is a recipe: the block below tells Fub which commands to run, in order, on the note you use it on. As it is, it records today's date and moves the note to Archive. Change it as you need: Fub checks it, and shows it to you before turning it on.",
    ),
    (
        N_DESCRIPTION,
        "Segna la data e sposta la nota in Archivio.",
        "Records the date and moves the note to Archive.",
    ),
    (N_PROPERTY, "archiviata", "archived"),
    (N_ARCHIVE, "Archivio", "Archive"),
    (
        E_BAD_TITLE,
        "«{value}» non può essere il nome di una ricetta: niente «/», «\\», «..» né caratteri che un disco rifiuta.",
        "\"{value}\" cannot be a recipe name: no \"/\", \"\\\", \"..\" or characters a disk refuses.",
    ),
    (P_NEW, "Crea la ricetta {doc}", "Create the recipe {doc}"),
    (D_NEW, "Ricetta creata: {doc}", "Recipe created: {doc}"),
    (U_NEW, "Creazione della ricetta {doc}", "Creation of the recipe {doc}"),    (
        crate::vocabulary::E_BAD_ZONE,
        "Fuso orario «{zone}» non riconosciuto: scegli un nome IANA valido.",
        "Unknown time zone «{zone}»: choose a valid IANA name.",
    ),
    (
        crate::vocabulary::E_BAD_INSTANT,
        "L'istante dell'orologio non è rappresentabile nel fuso orario.",
        "The clock instant cannot be represented in this time zone.",
    ),
    (
        "recipes.param.selection",
        "Selezione",
        "Selection",
    ),
    (
        "recipes.param.selection.desc",
        "Il testo selezionato su cui lavora la ricetta.",
        "The selected text the recipe works on.",
    ),
    (
        "recipes.param.doc",
        "Nota",
        "Note",
    ),
    (
        "recipes.param.doc.desc",
        "La nota su cui si usa la ricetta.",
        "The note the recipe is used on.",
    ),
    // I problemi di una ricetta: una frase per codice, e per
    // `valore-non-valido` e `yaml` una per motivo. Il codice resta
    // stabile, le frasi si possono migliorare.
    (
        "recipes.problem.blocco-assente",
        "La nota non ha un blocco fub-recipe: non è una ricetta.",
        "The note has no fub-recipe block: it is not a recipe.",
    ),
    (
        "recipes.problem.blocchi-doppi",
        "La nota ha {count} blocchi fub-recipe: una ricetta ne ha uno solo. Tieni quello giusto e togli gli altri.",
        "The note has {count} fub-recipe blocks: a recipe has only one. Keep the right one and remove the others.",
    ),
    (
        "recipes.problem.yaml",
        "Il blocco non si legge come YAML: {value}",
        "The block cannot be read as YAML: {value}",
    ),
    (
        "recipes.problem.yaml-map",
        "Il blocco deve essere un elenco di campi «nome: valore», come fub-recipe: 1.",
        "The block must be a list of “name: value” fields, such as fub-recipe: 1.",
    ),
    (
        "recipes.problem.yaml-keys",
        "Il nome di ogni campo del blocco è un testo: un numero, un elenco o una mappa non possono esserlo.",
        "Every field name in the block is text: a number, a list or a map cannot be one.",
    ),
    (
        "recipes.problem.campo-sconosciuto",
        "«{field}» non è un campo delle ricette: toglilo o correggine il nome.",
        "“{field}” is not a recipe field: remove it or fix its name.",
    ),
    (
        "recipes.problem.campo-mancante",
        "Manca il campo «{field}».",
        "The field “{field}” is missing.",
    ),
    (
        "recipes.problem.versione-futura",
        "Questa ricetta è scritta per la versione {value} del formato, più nuova di questo Fub: aggiorna Fub per usarla.",
        "This recipe is written for version {value} of the format, newer than this Fub: update Fub to use it.",
    ),
    (
        "recipes.problem.version",
        "«fub-recipe» è il numero della versione del formato: scrivi 1.",
        "“fub-recipe” is the format version number: write 1.",
    ),
    (
        "recipes.problem.wants-text",
        "«{field}» vuole del testo.",
        "“{field}” wants text.",
    ),
    (
        "recipes.problem.wants-list",
        "«{field}» vuole un elenco, una voce per riga che comincia con «- ».",
        "“{field}” wants a list, one item per line starting with “- ”.",
    ),
    (
        "recipes.problem.wants-map",
        "«{field}» vuole dei campi «nome: valore».",
        "“{field}” wants “name: value” fields.",
    ),
    (
        "recipes.problem.wants-bool",
        "«{field}» vuole true o false.",
        "“{field}” wants true or false.",
    ),
    (
        "recipes.problem.empty",
        "«{field}» è vuoto: scrivi qualcosa o togli il campo.",
        "“{field}” is empty: write something or remove the field.",
    ),
    (
        "recipes.problem.id",
        "L'id «{value}» non va: da 1 a 48 caratteri fra minuscole latine, cifre e «-».",
        "The id “{value}” is not valid: 1 to 48 characters among lowercase Latin letters, digits and “-”.",
    ),
    (
        "recipes.problem.steps-count",
        "Una ricetta ha da 1 a 20 passi: questa ne ha {count}.",
        "A recipe has 1 to 20 steps: this one has {count}.",
    ),
    (
        "recipes.problem.keybinding",
        "«{value}» non è una scorciatoia che Fub sa premere: scrivila come Mod-Alt-a.",
        "“{value}” is not a shortcut Fub can press: write it like Mod-Alt-a.",
    ),
    (
        "recipes.problem.surface",
        "«{value}» non è un posto in cui offrire la ricetta: slash, slash_selection o toolbar.",
        "“{value}” is not a place to offer the recipe: slash, slash_selection or toolbar.",
    ),
    (
        "recipes.problem.kind",
        "«{value}» non è un tipo di parametro: text, number, bool, document o choice.",
        "“{value}” is not a parameter kind: text, number, bool, document or choice.",
    ),
    (
        "recipes.problem.choice-empty",
        "Il parametro «{value}» è una scelta senza opzioni: aggiungile in «options».",
        "The parameter “{value}” is a choice without options: add them under “options”.",
    ),
    (
        "recipes.problem.options-not-choice",
        "Il parametro «{value}» ha delle opzioni ma non è una scelta: scrivi kind: choice o togli le opzioni.",
        "The parameter “{value}” has options but is not a choice: write kind: choice or remove the options.",
    ),
    (
        "recipes.problem.option-twice",
        "L'opzione «{value}» è scritta due volte.",
        "The option “{value}” is written twice.",
    ),
    (
        "recipes.problem.param-name",
        "«{value}» non può essere il nome di un parametro: minuscole latine, cifre e «_», cominciando con una lettera.",
        "“{value}” cannot be a parameter name: lowercase Latin letters, digits and “_”, starting with a letter.",
    ),
    (
        "recipes.problem.param-reserved",
        "«{value}» è un parametro che Fub dà da sé: chiama il tuo in un altro modo.",
        "“{value}” is a parameter Fub provides by itself: name yours differently.",
    ),
    (
        "recipes.problem.param-twice",
        "Due parametri si chiamano «{value}».",
        "Two parameters are called “{value}”.",
    ),
    (
        "recipes.problem.placeholder",
        "«{value}» non è un segnaposto delle ricette: usa doc, title, folder, selection, le date (date, time…) o param.<nome>.",
        "“{value}” is not a recipe placeholder: use doc, title, folder, selection, the dates (date, time…) or param.<name>.",
    ),
    (
        "recipes.problem.placeholder-param",
        "«{value}» cita un parametro che la ricetta non dichiara in «params».",
        "“{value}” names a parameter the recipe does not declare under “params”.",
    ),
    (
        "recipes.problem.placeholder-random",
        "«{value}» non si usa nelle ricette: la prova deve mostrare ciò che succederà davvero.",
        "“{value}” cannot be used in recipes: the preview must show what will really happen.",
    ),
    (
        "recipes.problem.comando-sconosciuto",
        "Il comando «{value}» non c'è: controlla l'id nella palette, o accendi il componente che lo porta.",
        "The command “{value}” does not exist: check its id in the palette, or turn on the component that provides it.",
    ),
    (
        "recipes.problem.comando-ricetta",
        "Un passo non può lanciare un'altra ricetta («{value}»): copia qui i suoi passi.",
        "A step cannot run another recipe (“{value}”): copy its steps here.",
    ),
    (
        "recipes.problem.non-si-annulla",
        "Il comando «{value}» non si annulla, e una ricetta fa soltanto ciò che si può annullare.",
        "The command “{value}” cannot be undone, and a recipe only does what can be undone.",
    ),
    (
        "recipes.problem.impostazioni",
        "Il comando «{value}» cambia le impostazioni: una ricetta lavora sulle note, non sulle impostazioni.",
        "The command “{value}” changes the settings: a recipe works on notes, not on settings.",
    ),
    (
        "recipes.problem.argomenti",
        "Gli argomenti di «{value}» non vanno: {detail}",
        "The arguments of “{value}” are not valid: {detail}",
    ),
    (
        "recipes.problem.id-ripetuto",
        "Un'altra ricetta ha lo stesso id «{value}»: nessuna delle due si accende finché una non lo cambia.",
        "Another recipe has the same id “{value}”: neither turns on until one of them changes it.",
    ),
    (
        "recipes.problem.id-occupato",
        "L'id «{value}» è già usato da un comando che non è questa ricetta: scegline un altro.",
        "The id “{value}” is already used by a command that is not this recipe: choose another one.",
    ),
    (
        "recipes.problem.troppe",
        "Il vault ha più di {count} ricette: Fub legge soltanto le prime {count}, in ordine di percorso.",
        "The vault has more than {count} recipes: Fub reads only the first {count}, in path order.",
    ),
];

pub struct RecipesCommands;

impl RecipesCommands {
    /// Le spec, anche fuori dal trait, come `TemplateCommands::specs`.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(RECIPES_NEW, Text::key("recipes.new.title"))
                .describing(Text::key("recipes.new.desc"))
                .with_param(
                    ParamSpec::new(TITLE, Text::key("recipes.new.title.title"), ParamKind::Text)
                        .describing(Text::key("recipes.new.title.desc")),
                )
                // `Vault` e non `Document`: la nota che nasce non esiste ancora, e
                // la cartella può nascere con lei.
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    /// L'impostazione della cartella, dichiarata come `daily.folder`: un
    /// profilo di vault reversibile, che non tocca la privacy.
    pub fn settings() -> Vec<SettingSpec> {
        vec![SettingSpec::new(
            RECIPES_FOLDER_KEY,
            Text::key(S_FOLDER),
            SettingKind::Text {
                default: RECIPES_FOLDER_DEFAULT.into(),
            },
        )
        .describing(Text::key(S_FOLDER_DESC))
        .grouped(Text::key(S_GROUP))
        .program_writable()]
    }
}

impl CommandProvider for RecipesCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        RecipesCommands::specs()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            RECIPES_NEW => new_recipe(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

/// La cartella delle ricette: l'impostazione, se è una cartella che si può
/// creare, altrimenti quella di serie, come fa `daily.folder`.
pub fn recipes_folder(host: &dyn ReadApi) -> String {
    match host.setting(RECIPES_FOLDER_KEY) {
        Ok(SettingValue::Text(raw)) => {
            let folder = fub_abi::rules::folders::normalized(raw.trim());
            let creatable =
                !folder.is_empty() && check_name(&format!("{folder}/_"), Naming::New).is_ok();
            if creatable {
                folder.to_string()
            } else {
                RECIPES_FOLDER_DEFAULT.into()
            }
        }
        _ => RECIPES_FOLDER_DEFAULT.into(),
    }
}

fn new_recipe(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let catalogs = catalog();
    let locale = host.user_locale();
    let strings = Strings::new(&catalogs, "it", &locale);
    let say = |key: &str| strings.render(&Text::key(key));
    let title = match args.text(TITLE).map(str::trim).filter(|t| !t.is_empty()) {
        Some(title) => title.to_string(),
        None => say(N_UNTITLED),
    };
    let folder = recipes_folder(host);
    let wanted = format!("{folder}/{title}.{EXTENSION}");
    // Il titolo è un nome di file, non un percorso: una «/» porterebbe la
    // ricetta in un'altra cartella, un «..» fuori da quella delle ricette.
    let refused = title.contains(['/', '\\'])
        || title.starts_with('.')
        || check_name(&wanted, Naming::New).is_err();
    if refused {
        return Err(PluginError::BadArgs(Text::message(
            E_BAD_TITLE,
            vec![Arg::text(A_VALUE, &title)],
        )));
    }
    // Un nome libero, come `note.create` e `note.duplicate`: una seconda
    // «Nuova ricetta» diventa «Nuova ricetta 1», mai una sovrascrittura.
    let doc = host.free_name(&DocId::new(wanted));
    if mode.is_dry_run() {
        let plan = CommandPlan::of_edits(
            Text::message(P_NEW, vec![Arg::text(A_DOC, doc.as_str())]),
            Vec::new(),
        )
        .with_doc(doc);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    let stem = stem_of(&doc);
    let source = sample(&stem, &say);
    // `create_document`: se nel frattempo il nome si è occupato, fallisce
    // invece di sovrascrivere la nota di qualcuno. La cartella che manca la
    // crea l'host.
    host.create_document(&doc, &source)?;
    let undo = Undo::by_command(
        Text::message(U_NEW, vec![Arg::text(A_DOC, doc.as_str())]),
        TRASH,
        serde_json::json!({ "doc": doc.as_str() }),
    );
    Ok(
        CommandOutcome::notify(Text::message(D_NEW, vec![Arg::text(A_DOC, doc.as_str())]))
            .undoable(undo)
            .with_effect(CommandEffect::Navigate { doc }),
    )
}

/// Il nome del file senza cartella né estensione: il titolo che il nome
/// libero ha scelto («Nuova ricetta 1»).
fn stem_of(doc: &DocId) -> String {
    let name = doc.as_str().rsplit('/').next().unwrap_or_default();
    name.strip_suffix(&format!(".{EXTENSION}"))
        .unwrap_or(name)
        .to_string()
}

/// L'`id` di una ricetta che si chiama `title`: minuscole latine, cifre e
/// trattini, da 1 a 48 caratteri. Parte dallo slug dei titoli di sezione
/// ([`heading_slug`](fub_abi::model::heading_slug), che compone, piega il caso
/// e fa degli spazi un trattino), poi toglie gli accenti delle lettere latine
/// («Città» diventa `citta`) e lascia cadere ogni altro carattere. Un titolo
/// senza lettere né cifre latine prende `fallback`.
fn id_of(title: &str, fallback: &str) -> String {
    let mut id = String::new();
    for c in fub_abi::model::heading_slug(title).chars().map(unaccented) {
        if c.is_ascii_alphanumeric() {
            id.push(c);
        } else if c == '-' && !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    let mut id: String = id.chars().take(ID_MAX).collect();
    while id.ends_with('-') {
        id.pop();
    }
    if id.is_empty() {
        fallback.to_string()
    } else {
        id
    }
}

/// La lettera latina senza accento, per le lettere minuscole delle lingue di
/// Fub (lo slug è già minuscolo e composto).
fn unaccented(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        other => other,
    }
}

/// Uno scalare YAML su una riga. Senza virgolette soltanto quando non c'è
/// niente da fraintendere: comincia con una lettera, ha solo lettere, cifre,
/// spazi e `.`, `-`, `_`, `/`, e non è una parola latina di cinque lettere o
/// meno, la misura delle parole che YAML legge come booleano o nulla (`yes`,
/// `Off`, `false`, `null`). Altrimenti fra virgolette doppie con gli escape di
/// JSON, che sono anche quelli di YAML: un titolo con «: », «#» o «{» resta un
/// titolo.
fn scalar(value: &str) -> String {
    let short_word = value.len() <= 5 && value.chars().all(|c| c.is_ascii_alphabetic());
    let plain = value.chars().next().is_some_and(char::is_alphabetic)
        && !short_word
        && !value.ends_with(' ')
        && value
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '/'));
    if plain {
        value.to_string()
    } else {
        serde_json::Value::String(value.to_string()).to_string()
    }
}

/// La ricetta d'esempio, quella della pagina `ricette.md`: segna la data e
/// sposta la nota in Archivio. Titolo e `id` vengono dal nome della nota, così
/// due ricette nuove non si contendono lo stesso `id`. Gli `args` sono mappe a
/// blocchi e non `{ … }`, che vorrebbero le virgolette anche per una virgola.
fn sample(title: &str, say: &dyn Fn(&str) -> String) -> String {
    let id = id_of(title, &say(N_FALLBACK_ID));
    let to = format!("{}/{{{{title}}}}.{EXTENSION}", say(N_ARCHIVE));
    let lines = [
        "fub-recipe: 1".to_string(),
        format!("id: {id}"),
        format!("title: {}", scalar(title)),
        format!("description: {}", scalar(&say(N_DESCRIPTION))),
        "steps:".to_string(),
        "  - run: note.property.set".to_string(),
        "    args:".to_string(),
        format!("      doc: {}", scalar("{{doc}}")),
        format!("      key: {}", scalar(&say(N_PROPERTY))),
        format!("      value: {}", scalar("{{date}}")),
        "  - run: note.rename".to_string(),
        "    args:".to_string(),
        format!("      doc: {}", scalar("{{doc}}")),
        format!("      to: {}", scalar(&to)),
    ];
    format!(
        "{intro}\n\n```{FENCE}\n{block}\n```\n",
        intro = say(N_INTRO),
        block = lines.join("\n"),
    )
}

#[cfg(test)]
mod tests {
    //! Le regole che non hanno bisogno del kernel: l'`id` che nasce dal nome e
    //! la ricetta d'esempio che si rilegge come YAML. Il comando attraverso il
    //! kernel vero sta in `tests/recipes_e2e.rs`, perché monta anche i comandi
    //! di `fub.commands`, che questo modulo non può nominare.

    use super::*;
    use fub_abi::locale::Locale;

    fn say_in(language: &str) -> impl Fn(&str) -> String {
        let locale = Locale {
            language: language.to_string(),
            ..Locale::default()
        };
        move |key: &str| Strings::new(&catalog(), "it", &locale).render(&Text::key(key))
    }

    /// Il blocco `fub-recipe` della nota, letto come YAML.
    fn block_of(source: &str) -> serde_json::Value {
        let open = format!("```{FENCE}\n");
        let start = source.find(&open).expect("il blocco apre") + open.len();
        let end = start + source[start..].find("\n```").expect("il blocco chiude");
        serde_yaml_ng::from_str(&source[start..end]).expect("il blocco è YAML")
    }

    #[test]
    fn l_id_nasce_dal_nome_nella_forma_del_contratto() {
        assert_eq!(id_of("Nuova ricetta 1", "ricetta"), "nuova-ricetta-1");
        assert_eq!(id_of("Città -- più  bella!", "ricetta"), "citta-piu-bella");
        assert_eq!(id_of("Città: più bella!", "ricetta"), "citta-piu-bella");
        assert_eq!(id_of("ÀRCHIVIA_la nota", "ricetta"), "archivia-la-nota");
        assert_eq!(id_of("日記", "ricetta"), "ricetta");
        assert_eq!(id_of(&"a".repeat(90), "ricetta").len(), ID_MAX);
        let edge = id_of(&format!("{} b", "a".repeat(47)), "ricetta");
        assert_eq!(edge, "a".repeat(47), "nessun trattino in coda");
    }

    #[test]
    fn la_ricetta_d_esempio_e_quella_del_contratto() {
        let block = block_of(&sample("Archivia la nota", &say_in("it")));
        assert_eq!(
            block,
            serde_json::json!({
                "fub-recipe": 1,
                "id": "archivia-la-nota",
                "title": "Archivia la nota",
                "description": "Segna la data e sposta la nota in Archivio.",
                "steps": [
                    {
                        "run": "note.property.set",
                        "args": { "doc": "{{doc}}", "key": "archiviata", "value": "{{date}}" },
                    },
                    {
                        "run": "note.rename",
                        "args": { "doc": "{{doc}}", "to": "Archivio/{{title}}.md" },
                    },
                ],
            })
        );
    }

    /// Il blocco così come sta nella pagina `docs/reference/ricette.md`.
    #[test]
    fn il_blocco_d_esempio_e_quello_della_pagina() {
        let source = sample("Archivia la nota", &say_in("it"));
        let page = include_str!("../../../docs/reference/ricette.md");
        let start = page.find("```yaml\n").expect("la pagina mostra il blocco") + 8;
        let end = start + page[start..].find("```").expect("il blocco chiude");
        let block = &page[start..end];
        assert!(
            source.contains(&format!("```{FENCE}\n{block}```\n")),
            "la pagina e `recipes.new` non scrivono lo stesso blocco:\n{source}"
        );
    }

    #[test]
    fn un_titolo_con_i_segni_dello_yaml_resta_un_titolo() {
        for title in [
            "Idee: #bozze, {prima}",
            "- elenco",
            "'citata'",
            "yes",
            "Off",
            "12",
            "Dice \"ciao\"",
            "Riga\\storta",
        ] {
            let block = block_of(&sample(title, &say_in("it")));
            assert_eq!(block["title"], title, "«{title}»");
        }
    }

    #[test]
    fn la_ricetta_inglese_parla_inglese() {
        let source = sample("New recipe", &say_in("en"));
        assert!(source.starts_with("This note is a recipe"), "{source}");
        let block = block_of(&source);
        assert_eq!(block["id"], "new-recipe");
        assert_eq!(block["steps"][0]["args"]["key"], "archived");
        assert_eq!(block["steps"][1]["args"]["to"], "Archive/{{title}}.md");
    }
}
