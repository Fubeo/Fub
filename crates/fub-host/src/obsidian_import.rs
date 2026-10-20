//! Le impostazioni di un vault di Obsidian, lette da `.obsidian/` e scritte
//! come impostazioni di Fub.
//!
//! Chi migra apre in Fub il vault che aveva in Obsidian, e `.obsidian/` è già
//! lì: la cartella resta ignorata (non è parte del vault), ma tre suoi file
//! dicono scelte che Fub sa esprimere — dove vanno allegati e note nuove, che
//! forma hanno i link, come si comporta l'editor, la giornaliera, la luce.
//! Questo comando le traduce una per una e scrive soltanto quelle.
//!
//! Niente si perde in silenzio: ogni chiave dei file di Obsidian che non
//! diventa un'impostazione di Fub torna nell'esito per nome, con la ragione
//! (Fub non ha quella scelta, o non quel valore, o la feature che la possiede è
//! spenta). I file di Obsidian si leggono soltanto, e restano com'erano.
//!
//! Il comando gira solo a richiesta dell'utente: è dell'host, il kernel lo
//! riserva e un plugin non lo può chiamare. Scrive con la stessa porta del
//! pannello delle impostazioni, ognuna al suo livello (vault o macchina).

use std::collections::BTreeMap;
use std::io::Read;

use camino::Utf8Path;
use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec, InvokeMode,
};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::PluginError;
use serde_json::{Map, Value};

use crate::settings as keys;
use crate::Host;

/// L'id del comando.
pub const OBSIDIAN_IMPORT: &str = "settings.import_obsidian";

/// La cartella delle impostazioni di Obsidian, nella radice del vault.
const DIR: &str = ".obsidian";
/// I file letti: impostazioni generali, aspetto, giornaliera.
const APP: &str = "app.json";
const APPEARANCE: &str = "appearance.json";
const DAILY: &str = "daily-notes.json";
/// Oltre questa misura un file non è delle impostazioni di Obsidian.
const MAX_BYTES: u64 = 1024 * 1024;

/// Le impostazioni della giornaliera sono di `fub.template`, una feature che
/// si può spegnere: allora la chiave non c'è, e l'esito lo dice.
const DAILY_FOLDER: &str = "daily.folder";
const DAILY_FORMAT: &str = "daily.format";
const DAILY_TEMPLATE: &str = "daily.template";

pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(OBSIDIAN_IMPORT, Text::key("host.obsidian_import.title"))
        .describing(Text::key("host.obsidian_import.desc"))
        .with_scope(CommandScope::writing(CommandReach::Settings).irreversible())
}

/// Un'impostazione di Fub che una chiave di Obsidian dice.
#[derive(Debug, Clone, PartialEq)]
pub struct Write {
    /// La chiave di Obsidian, come la scrive il suo file (`app.json:useMarkdownLinks`).
    pub from: String,
    pub key: &'static str,
    pub value: SettingValue,
}

/// Perché una chiave di Obsidian non è diventata un'impostazione.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Why {
    /// Fub non ha questa scelta.
    NoEquivalent,
    /// La scelta c'è, ma non con questo valore.
    Value,
    /// L'impostazione è di una feature spenta.
    Unavailable,
    /// Fub l'ha rifiutata scrivendola.
    Refused,
}

impl Why {
    fn tag(self) -> &'static str {
        match self {
            Why::NoEquivalent => "no_equivalent",
            Why::Value => "value",
            Why::Unavailable => "unavailable",
            Why::Refused => "refused",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lost {
    pub from: String,
    pub why: Why,
}

/// Ciò che i file di Obsidian dicono, tradotto.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Translation {
    pub writes: Vec<Write>,
    pub lost: Vec<Lost>,
}

impl Translation {
    fn write(&mut self, file: &str, from: &str, key: &'static str, value: SettingValue) {
        self.writes.push(Write {
            from: format!("{file}:{from}"),
            key,
            value,
        });
    }

    fn lose(&mut self, file: &str, from: &str, why: Why) {
        self.lost.push(Lost {
            from: format!("{file}:{from}"),
            why,
        });
    }
}

/// Le scelte che hanno lo stesso nome di qua e di là: un interruttore di
/// Obsidian e il suo gemello.
const TOGGLES: [(&str, &str); 10] = [
    ("strictLineBreaks", keys::EDITOR_STRICT_LINE_BREAKS),
    ("showLineNumber", keys::EDITOR_LINE_NUMBERS),
    ("spellcheck", keys::EDITOR_SPELLCHECK),
    ("vimMode", keys::EDITOR_VIM),
    ("autoPairBrackets", keys::EDITOR_CLOSE_BRACKETS),
    ("smartIndentList", keys::EDITOR_SMART_LISTS),
    ("showIndentGuide", keys::EDITOR_INDENT_GUIDES),
    ("autoConvertHtml", keys::EDITOR_PASTE_HTML),
    ("rightToLeft", keys::EDITOR_RTL),
    ("promptDelete", keys::FILES_CONFIRM_TRASH),
];

/// Traduce i tre file, già letti. Una chiave che non si sa tradurre finisce
/// fra le perse, mai ignorata: Obsidian scrive solo ciò che l'utente ha
/// cambiato, quindi ogni chiave del file è una scelta.
pub fn translate(
    app: Option<&Map<String, Value>>,
    appearance: Option<&Map<String, Value>>,
    daily: Option<&Map<String, Value>>,
) -> Translation {
    let mut out = Translation::default();
    if let Some(app) = app {
        translate_app(app, &mut out);
    }
    if let Some(appearance) = appearance {
        for (name, value) in appearance {
            match (name.as_str(), value) {
                ("theme", Value::String(theme)) => match theme.as_str() {
                    "obsidian" => out.write(APPEARANCE, name, keys::APPEARANCE_THEME, text("dark")),
                    "moonstone" => {
                        out.write(APPEARANCE, name, keys::APPEARANCE_THEME, text("light"))
                    }
                    "system" => out.write(
                        APPEARANCE,
                        name,
                        keys::APPEARANCE_THEME,
                        text(fub_kernel::locale::AS_SYSTEM),
                    ),
                    _ => out.lose(APPEARANCE, name, Why::Value),
                },
                // La misura del testo: in Obsidian da 10 a 30 punti, in Fub da
                // 12 a 28. Fuori da lì Fub la rifiuta, e l'esito lo dice.
                ("baseFontSize", Value::Number(size)) => match size.as_f64() {
                    Some(size) => out.write(
                        APPEARANCE,
                        name,
                        keys::APPEARANCE_BODY,
                        SettingValue::Number(size),
                    ),
                    None => out.lose(APPEARANCE, name, Why::Value),
                },
                _ => out.lose(APPEARANCE, name, Why::NoEquivalent),
            }
        }
    }
    if let Some(daily) = daily {
        for (name, value) in daily {
            let key = match name.as_str() {
                "folder" => DAILY_FOLDER,
                "format" => DAILY_FORMAT,
                "template" => DAILY_TEMPLATE,
                _ => {
                    out.lose(DAILY, name, Why::NoEquivalent);
                    continue;
                }
            };
            match value {
                // Il formato vuoto, in Obsidian, è il suo predefinito, che è
                // anche quello di Fub.
                Value::String(raw) if name == "format" && raw.trim().is_empty() => {}
                Value::String(raw) => out.write(DAILY, name, key, text(raw.trim())),
                _ => out.lose(DAILY, name, Why::Value),
            }
        }
    }
    out
}

fn translate_app(app: &Map<String, Value>, out: &mut Translation) {
    // Due coppie di chiavi dicono una scelta sola: la posizione delle note
    // nuove (`newFileLocation` con `newFileFolderPath`), la modalità
    // (`defaultViewMode` con `livePreview`), il rientro (`useTab` con
    // `tabSize`), la piegatura (`foldHeading` con `foldIndent`).
    let mut handled: Vec<&str> = Vec::new();
    if let Some(location) = app.get("newFileLocation") {
        handled.extend(["newFileLocation", "newFileFolderPath"]);
        let folder = app.get("newFileFolderPath").and_then(Value::as_str);
        match (location.as_str(), folder) {
            (Some("root"), _) => out.write(APP, "newFileLocation", keys::NEW_NOTE_FOLDER, text("")),
            (Some("current"), _) => {
                out.write(APP, "newFileLocation", keys::NEW_NOTE_FOLDER, text("./"))
            }
            (Some("folder"), Some(folder)) => out.write(
                APP,
                "newFileLocation",
                keys::NEW_NOTE_FOLDER,
                text(fub_abi::rules::folders::normalized(folder.trim())),
            ),
            _ => out.lose(APP, "newFileLocation", Why::Value),
        }
    }
    if app.contains_key("defaultViewMode") || app.contains_key("livePreview") {
        handled.extend(["defaultViewMode", "livePreview"]);
        let view = app.get("defaultViewMode").and_then(Value::as_str);
        let live = app
            .get("livePreview")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        match view.unwrap_or("source") {
            "preview" => out.write(
                APP,
                "defaultViewMode",
                keys::EDITOR_DEFAULT_MODE,
                text("reading"),
            ),
            "source" => out.write(
                APP,
                if view.is_some() {
                    "defaultViewMode"
                } else {
                    "livePreview"
                },
                keys::EDITOR_DEFAULT_MODE,
                text(if live { "live_preview" } else { "source" }),
            ),
            _ => out.lose(APP, "defaultViewMode", Why::Value),
        }
    }
    if app.contains_key("useTab") || app.contains_key("tabSize") {
        handled.extend(["useTab", "tabSize"]);
        // In Obsidian il tabulatore è acceso di serie, e la misura è 4.
        let tab = app.get("useTab").and_then(Value::as_bool).unwrap_or(true);
        let size = app.get("tabSize").and_then(Value::as_u64).unwrap_or(4);
        let from = if app.contains_key("useTab") {
            "useTab"
        } else {
            "tabSize"
        };
        match (tab, size) {
            (true, _) => out.write(APP, from, keys::EDITOR_INDENT, text("tab")),
            (false, 2) => out.write(APP, from, keys::EDITOR_INDENT, text("2")),
            (false, 4) => out.write(APP, from, keys::EDITOR_INDENT, text("4")),
            (false, _) => out.lose(APP, "tabSize", Why::Value),
        }
    }
    if app.contains_key("foldHeading") || app.contains_key("foldIndent") {
        handled.extend(["foldHeading", "foldIndent"]);
        // Fub ha un margine solo per le due piegature: resta se ne resta una.
        let heading = app
            .get("foldHeading")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let indent = app
            .get("foldIndent")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let from = if app.contains_key("foldHeading") {
            "foldHeading"
        } else {
            "foldIndent"
        };
        out.write(
            APP,
            from,
            keys::EDITOR_FOLD_GUTTER,
            SettingValue::Toggle(heading || indent),
        );
    }
    for (name, value) in app {
        if handled.contains(&name.as_str()) {
            continue;
        }
        if let Some((_, key)) = TOGGLES.iter().find(|(from, _)| from == name) {
            match value.as_bool() {
                Some(on) => out.write(APP, name, key, SettingValue::Toggle(on)),
                None => out.lose(APP, name, Why::Value),
            }
            continue;
        }
        match name.as_str() {
            "attachmentFolderPath" => match value.as_str().map(str::trim) {
                // La radice: Fub deposita sempre in una cartella.
                Some("/") | Some("") | None => out.lose(APP, name, Why::Value),
                // `./` e `./sotto` si dicono uguali; un'altra è del vault.
                Some(folder) if folder == "." || folder.starts_with("./") => {
                    out.write(APP, name, keys::ATTACHMENT_FOLDER, text(folder))
                }
                Some(folder) => out.write(
                    APP,
                    name,
                    keys::ATTACHMENT_FOLDER,
                    text(fub_abi::rules::folders::normalized(folder)),
                ),
            },
            "useMarkdownLinks" => match value.as_bool() {
                Some(markdown) => out.write(
                    APP,
                    name,
                    keys::FILES_LINK_STYLE,
                    text(if markdown {
                        keys::FILES_LINK_MARKDOWN
                    } else {
                        keys::FILES_LINK_WIKI
                    }),
                ),
                None => out.lose(APP, name, Why::Value),
            },
            "newLinkFormat" => match value.as_str() {
                Some(
                    format @ (keys::FILES_LINK_SHORTEST
                    | keys::FILES_LINK_RELATIVE
                    | keys::FILES_LINK_ABSOLUTE),
                ) => out.write(APP, name, keys::FILES_LINK_FORMAT, text(format)),
                _ => out.lose(APP, name, Why::Value),
            },
            // Il cestino: quello del vault, quello del sistema. «Elimina per
            // sempre» Fub non lo fa senza passare da un cestino.
            "trashOption" => match value.as_str() {
                Some("local") => {
                    out.write(APP, name, keys::FILES_TRASH, text(keys::FILES_TRASH_VAULT))
                }
                Some("system") => {
                    out.write(APP, name, keys::FILES_TRASH, text(keys::FILES_TRASH_SYSTEM))
                }
                _ => out.lose(APP, name, Why::Value),
            },
            "propertiesInDocument" => match value.as_str() {
                Some(display @ ("visible" | "hidden" | "source")) => {
                    out.write(APP, name, keys::EDITOR_PROPERTIES, text(display))
                }
                _ => out.lose(APP, name, Why::Value),
            },
            // I filtri di Obsidian sono cartelle o espressioni regolari fra
            // due `/`: le cartelle diventano esclusioni, le espressioni no.
            "userIgnoreFilters" => match value.as_array() {
                Some(filters) => {
                    let mut folders = Vec::new();
                    let mut regex = false;
                    for filter in filters.iter().filter_map(Value::as_str) {
                        let filter = filter.trim();
                        if filter.len() > 1 && filter.starts_with('/') && filter.ends_with('/') {
                            regex = true;
                            continue;
                        }
                        let folder = fub_abi::rules::folders::normalized(filter);
                        if !folder.is_empty() {
                            folders.push(folder.to_owned());
                        }
                    }
                    if !folders.is_empty() {
                        out.write(
                            APP,
                            name,
                            fub_kernel::ignore::EXCLUDED_FOLDERS,
                            SettingValue::List(folders),
                        );
                    }
                    if regex {
                        out.lose(APP, name, Why::Value);
                    }
                }
                None => out.lose(APP, name, Why::Value),
            },
            _ => out.lose(APP, name, Why::NoEquivalent),
        }
    }
}

fn text(value: &str) -> SettingValue {
    SettingValue::Text(value.to_owned())
}

/// Un file di `.obsidian/`, se c'è e se è un oggetto JSON. La cartella si apre
/// dentro la radice del vault e non ne esce: un collegamento che porta fuori
/// non si segue.
fn read_config(root: &Utf8Path, file: &str) -> Result<Option<Map<String, Value>>, PluginError> {
    let unreadable = |why: String| {
        PluginError::BadArgs(Text::message(
            "host.obsidian_import.unreadable",
            vec![
                Arg::text("file", format!("{DIR}/{file}")),
                Arg::text("why", why),
            ],
        ))
    };
    let vault =
        cap_std::fs::Dir::open_ambient_dir(root.as_std_path(), cap_std::ambient_authority())
            .map_err(|why| unreadable(why.to_string()))?;
    let mut opened = match vault.open(format!("{DIR}/{file}")) {
        Ok(opened) => opened,
        Err(why) if why.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(why) => return Err(unreadable(why.to_string())),
    };
    let mut bytes = Vec::new();
    (&mut opened)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|why| unreadable(why.to_string()))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(unreadable(format!("più di {MAX_BYTES} byte")));
    }
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        Ok(_) => Err(unreadable("non è un oggetto JSON".into())),
        Err(why) => Err(unreadable(why.to_string())),
    }
}

/// Legge, traduce e — fuori dalla prova — scrive.
pub(crate) fn invoke(
    host: &Host,
    vault: Option<&str>,
    root: &Utf8Path,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    spec().validate_args(&args)?;
    let app = read_config(root, APP)?;
    let appearance = read_config(root, APPEARANCE)?;
    let daily = read_config(root, DAILY)?;
    if app.is_none() && appearance.is_none() && daily.is_none() {
        return Err(PluginError::NotFound(Text::key(
            "host.obsidian_import.none",
        )));
    }
    let mut translation = translate(app.as_ref(), appearance.as_ref(), daily.as_ref());
    let current: BTreeMap<String, SettingValue> =
        match host.query_index(vault, IndexQuery::Settings { plugin: None })? {
            IndexResult::Settings(entries) => entries
                .into_iter()
                .map(|entry| (entry.spec.key, entry.value))
                .collect(),
            _ => BTreeMap::new(),
        };
    // Una chiave che nessuno dichiara è di una feature spenta: non si scrive.
    let (writes, unavailable): (Vec<Write>, Vec<Write>) = std::mem::take(&mut translation.writes)
        .into_iter()
        .partition(|write| current.contains_key(write.key));
    translation
        .lost
        .extend(unavailable.into_iter().map(|write| Lost {
            from: write.from,
            why: Why::Unavailable,
        }));
    let (same, changes): (Vec<Write>, Vec<Write>) = writes
        .into_iter()
        .partition(|write| current.get(write.key) == Some(&write.value));
    if mode.is_dry_run() {
        let list = changes
            .iter()
            .map(|write| format!("{} = {}", write.key, shown(&write.value)))
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                Text::message(
                    "host.obsidian_import.plan",
                    vec![
                        Arg::int("count", changes.len() as i64),
                        Arg::text("list", list),
                        Arg::text("lost", lost_names(&translation.lost)),
                    ],
                ),
                Vec::new(),
            ))),
        );
    }
    let mut written = Vec::new();
    for write in changes {
        match host.set_setting_for_user(vault, write.key, write.value.clone()) {
            Ok(()) => written.push(write),
            Err(why) => {
                tracing::warn!(target: "fub.host", "{OBSIDIAN_IMPORT}: {} → {}: {why}", write.from, write.key);
                translation.lost.push(Lost {
                    from: write.from,
                    why: Why::Refused,
                });
            }
        }
    }
    let key = if translation.lost.is_empty() {
        "host.obsidian_import.done"
    } else {
        "host.obsidian_import.done_lost"
    };
    Ok(CommandOutcome::notify(Text::message(
        key,
        vec![
            Arg::int("written", written.len() as i64),
            Arg::int("same", same.len() as i64),
            Arg::text("lost", lost_names(&translation.lost)),
        ],
    ))
    .with_effect(CommandEffect::Custom {
        ns: "fub.settings.imported".into(),
        payload: serde_json::json!({
            "written": written.iter().map(|write| serde_json::json!({ "from": write.from, "key": write.key })).collect::<Vec<_>>(),
            "same": same.iter().map(|write| write.key).collect::<Vec<_>>(),
            "lost": translation.lost.iter().map(|lost| serde_json::json!({ "from": lost.from, "why": lost.why.tag() })).collect::<Vec<_>>(),
        }),
    }))
}

fn shown(value: &SettingValue) -> String {
    match value {
        SettingValue::Toggle(on) => on.to_string(),
        SettingValue::Number(n) => n.to_string(),
        SettingValue::Text(text) => format!("«{text}»"),
        SettingValue::List(items) => format!("[{}]", items.join(", ")),
    }
}

fn lost_names(lost: &[Lost]) -> String {
    lost.iter()
        .map(|lost| lost.from.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn object(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }

    fn written(translation: &Translation, key: &str) -> Option<SettingValue> {
        translation
            .writes
            .iter()
            .find(|write| write.key == key)
            .map(|write| write.value.clone())
    }

    #[test]
    fn files_and_links_say_the_same_choice_in_fub() {
        let app = object(json!({
            "attachmentFolderPath": "./allegati",
            "newFileLocation": "current",
            "useMarkdownLinks": true,
            "newLinkFormat": "relative",
            "promptDelete": false,
            "trashOption": "system",
            "userIgnoreFilters": ["Archivio/", "/\\.tmp$/"],
        }));
        let out = translate(Some(&app), None, None);
        assert_eq!(
            written(&out, keys::ATTACHMENT_FOLDER),
            Some(text("./allegati"))
        );
        assert_eq!(written(&out, keys::NEW_NOTE_FOLDER), Some(text("./")));
        assert_eq!(
            written(&out, keys::FILES_LINK_STYLE),
            Some(text("markdown"))
        );
        assert_eq!(
            written(&out, keys::FILES_LINK_FORMAT),
            Some(text("relative"))
        );
        assert_eq!(
            written(&out, keys::FILES_CONFIRM_TRASH),
            Some(SettingValue::Toggle(false))
        );
        assert_eq!(written(&out, keys::FILES_TRASH), Some(text("system")));
        assert_eq!(
            written(&out, fub_kernel::ignore::EXCLUDED_FOLDERS),
            Some(SettingValue::List(vec!["Archivio".into()]))
        );
        // L'espressione regolare non diventa un'esclusione, e lo si dice.
        assert_eq!(
            out.lost,
            vec![Lost {
                from: "app.json:userIgnoreFilters".into(),
                why: Why::Value
            }]
        );
    }

    #[test]
    fn a_fixed_folder_for_new_notes_and_the_root_for_attachments() {
        let app = object(json!({
            "newFileLocation": "folder",
            "newFileFolderPath": "Ingresso/",
            "attachmentFolderPath": "/",
        }));
        let out = translate(Some(&app), None, None);
        assert_eq!(written(&out, keys::NEW_NOTE_FOLDER), Some(text("Ingresso")));
        assert_eq!(written(&out, keys::ATTACHMENT_FOLDER), None);
        assert_eq!(out.lost[0].from, "app.json:attachmentFolderPath");
    }

    #[test]
    fn the_editor_pairs_become_one_choice_each() {
        let app = object(json!({
            "defaultViewMode": "source",
            "livePreview": false,
            "useTab": false,
            "tabSize": 2,
            "foldHeading": false,
            "foldIndent": false,
            "vimMode": true,
            "propertiesInDocument": "hidden",
        }));
        let out = translate(Some(&app), None, None);
        assert_eq!(
            written(&out, keys::EDITOR_DEFAULT_MODE),
            Some(text("source"))
        );
        assert_eq!(written(&out, keys::EDITOR_INDENT), Some(text("2")));
        assert_eq!(
            written(&out, keys::EDITOR_FOLD_GUTTER),
            Some(SettingValue::Toggle(false))
        );
        assert_eq!(
            written(&out, keys::EDITOR_VIM),
            Some(SettingValue::Toggle(true))
        );
        assert_eq!(written(&out, keys::EDITOR_PROPERTIES), Some(text("hidden")));
        assert!(out.lost.is_empty(), "{:?}", out.lost);
    }

    #[test]
    fn what_fub_cannot_say_comes_back_by_name() {
        let app = object(json!({ "readableLineLength": false, "tabSize": 3, "useTab": false }));
        let appearance = object(json!({ "theme": "moonstone", "cssTheme": "Minimal" }));
        let daily = object(json!({ "folder": "Diario", "format": "", "autorun": true }));
        let out = translate(Some(&app), Some(&appearance), Some(&daily));
        assert_eq!(written(&out, keys::APPEARANCE_THEME), Some(text("light")));
        assert_eq!(written(&out, DAILY_FOLDER), Some(text("Diario")));
        assert_eq!(
            written(&out, DAILY_FORMAT),
            None,
            "il formato vuoto è il predefinito"
        );
        let lost: Vec<&str> = out.lost.iter().map(|lost| lost.from.as_str()).collect();
        assert_eq!(
            lost,
            [
                "app.json:tabSize",
                "app.json:readableLineLength",
                "appearance.json:cssTheme",
                "daily-notes.json:autorun"
            ]
        );
    }
}
