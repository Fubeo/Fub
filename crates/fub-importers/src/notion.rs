//! Il Markdown delle pagine di Notion (L1–L5): il testo ricco con le sue
//! annotazioni, i blocchi con le forme di Fub, le menzioni, gli allegati.
//!
//! Il connettore ([`crate::connectors`]) scarica l'albero dei blocchi; qui lo
//! si scrive. Ogni forma è quella che l'editor scrive da sé:
//!
//! - grassetto `**`, corsivo `*`, barrato `~~`, codice `` ` ``, sottolineato
//!   `<u>`, colori `<span class="fub-color-*">` e `<mark class="fub-bg-*">`
//!   (K1, i nove nomi di Notion);
//! - ripiegabile `<details><summary>` (K2), colonne `[!columns]`/`[!column]`
//!   (K3), indice ```` ```toc ```` (K4), callout `> [!tipo]`;
//! - persone `[[Persone/Nome|Nome]]` (K5), date `[[Daily/2026-11-04|4 novembre
//!   2026]]` (K6), sottopagine `[[Titolo]]` nella struttura delle cartelle (K7);
//! - un segnalibro web è l'URL sulla sua riga (K8).
//!
//! Il testo semplice protegge i caratteri che diventerebbero sintassi; ciò che
//! non ha una forma va nel rapporto dell'import.

use std::collections::HashMap;

use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_abi::transfer::TransferNote;
use fub_abi::PluginError;
use serde_json::Value;

use crate::common::sanitize_component;

/// La chiave sotto cui il connettore appende i figli scaricati di un blocco.
pub const CHILDREN: &str = "source_children";

/// I nove colori di Notion, gli stessi del contenuto di Fub (K1).
const COLORS: [&str; 9] = [
    "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
];

/// Le lingue di Notion con un nome diverso dall'info string di Fub; le altre
/// passano in minuscolo, con i trattini al posto degli spazi.
const LANGUAGES: [(&str, &str); 14] = [
    ("plain text", ""),
    ("c++", "cpp"),
    ("c#", "csharp"),
    ("f#", "fsharp"),
    ("shell", "bash"),
    ("bash", "bash"),
    ("powershell", "powershell"),
    ("objective-c", "objectivec"),
    ("visual basic", "vb"),
    ("vb.net", "vb"),
    ("docker", "dockerfile"),
    ("markup", "html"),
    ("java/c/c++/c#", "java"),
    ("webassembly", "wasm"),
];

const MONTHS_IT: [&str; 12] = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
];
const MONTHS_EN: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const WEEKDAYS_IT: [&str; 7] = [
    "lunedì",
    "martedì",
    "mercoledì",
    "giovedì",
    "venerdì",
    "sabato",
    "domenica",
];
const WEEKDAYS_EN: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/// Le impostazioni del vault che decidono dove portano persone e date.
pub struct Conventions {
    /// `files.people-folder` (K5), di norma `Persone`.
    pub people: String,
    /// `daily.folder` di `fub.template` (K6), di norma `Daily`.
    pub daily_folder: String,
    /// `daily.format`, di norma `YYYY-MM-DD`.
    pub daily_format: String,
    /// `files.attachment-folder`, di norma `attachments`.
    pub attachments: String,
    /// La lingua di chi legge: `it` o, per ogni altra, l'inglese.
    pub language: String,
}

impl Default for Conventions {
    fn default() -> Self {
        Conventions {
            people: "Persone".into(),
            daily_folder: "Daily".into(),
            daily_format: "YYYY-MM-DD".into(),
            attachments: "attachments".into(),
            language: "en".into(),
        }
    }
}

impl Conventions {
    /// Le impostazioni di adesso; una chiave che nessuno dichiara (la feature
    /// spenta) lascia il valore di sempre.
    pub fn of(host: &dyn HostApi) -> Self {
        let text = |key: &str| match host.setting(key) {
            Ok(fub_abi::settings::SettingValue::Text(s)) if !s.trim().is_empty() => {
                Some(s.trim().to_string())
            }
            _ => None,
        };
        let folder = |key: &str| {
            text(key)
                .map(|s| fub_abi::rules::folders::normalized(&s).to_string())
                .filter(|s| !s.is_empty())
        };
        let base = Conventions::default();
        Conventions {
            people: folder("files.people-folder").unwrap_or(base.people),
            daily_folder: folder("daily.folder").unwrap_or(base.daily_folder),
            daily_format: text("daily.format").unwrap_or(base.daily_format),
            attachments: text("files.attachment-folder").unwrap_or(base.attachments),
            language: if host.user_locale().language_base() == "it" {
                "it".into()
            } else {
                "en".into()
            },
        }
    }

    fn italian(&self) -> bool {
        self.language == "it"
    }

    /// Il link alla giornaliera di `iso` (`YYYY-MM-DD`), col giorno scritto
    /// per esteso come lo scrive `@` (K6).
    pub fn daily_link(&self, iso: &str) -> String {
        let name = daily_name(&self.daily_format, iso, &self.language);
        wikilink(
            &format!("{}/{name}", self.daily_folder),
            &self.short_date(iso),
        )
    }

    /// «4 novembre 2026», «November 4, 2026».
    fn short_date(&self, iso: &str) -> String {
        let (year, month, day) = civil(iso);
        let index = usize::from(month.clamp(1, 12)) - 1;
        if self.italian() {
            format!("{day} {} {year}", MONTHS_IT[index])
        } else {
            format!("{} {day}, {year}", MONTHS_EN[index])
        }
    }
}

fn civil(iso: &str) -> (i32, u8, u8) {
    let year = iso.get(..4).and_then(|y| y.parse().ok()).unwrap_or(1970);
    let month = iso.get(5..7).and_then(|m| m.parse().ok()).unwrap_or(1);
    let day = iso.get(8..10).and_then(|d| d.parse().ok()).unwrap_or(1);
    (year, month, day)
}

/// Il nome della giornaliera di `iso` nel formato dichiarato: il gemello di
/// `daily_name` in `crates/fub-features/src/template.rs`, che una feature
/// non può prestare a un'altra.
pub fn daily_name(format: &str, iso: &str, language: &str) -> String {
    let (year, month, day) = civil(iso);
    let weekday = fub_abi::traits::CivilTime {
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
    }
    .weekday()
    .iso();
    let (months, weekdays) = if language == "it" {
        (MONTHS_IT, WEEKDAYS_IT)
    } else {
        (MONTHS_EN, WEEKDAYS_EN)
    };
    let month_name = months[usize::from(month.clamp(1, 12)) - 1];
    let weekday_name = weekdays[usize::from(weekday.clamp(1, 7)) - 1];
    let short = |name: &str| name.chars().take(3).collect::<String>();
    let mut out = String::new();
    let mut rest = format;
    while let Some(c) = rest.chars().next() {
        if c == '[' {
            if let Some(end) = rest.find(']') {
                out.push_str(&rest[1..end]);
                rest = &rest[end + 1..];
                continue;
            }
        }
        let value = [
            ("YYYY", format!("{year:04}")),
            ("YY", format!("{:02}", year.rem_euclid(100))),
            ("MMMM", month_name.to_string()),
            ("MMM", short(month_name)),
            ("MM", format!("{month:02}")),
            ("M", month.to_string()),
            ("DD", format!("{day:02}")),
            ("D", day.to_string()),
            ("dddd", weekday_name.to_string()),
            ("ddd", short(weekday_name)),
        ]
        .into_iter()
        .find(|(token, _)| rest.starts_with(token));
        match value {
            Some((token, value)) => {
                out.push_str(&value);
                rest = &rest[token.len()..];
            }
            None => {
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// Una pagina dell'albero importato: il documento che la tiene e il link con
/// cui le altre la chiamano.
pub struct PageRef {
    pub doc: DocId,
    pub link: String,
}

/// Chi mette gli allegati ospitati da Notion nel vault. `Ok(Some(link))` è il
/// link relativo al file scaricato; `Ok(None)` lascia l'URL, col perché già
/// nel rapporto; un `Err` è soltanto l'annullamento.
pub trait Attachments {
    fn place(
        &mut self,
        url: &str,
        name: &str,
        log: &mut Vec<TransferNote>,
    ) -> Result<Option<String>, PluginError>;
}

/// Nessun allegato si scarica: gli URL restano (i test del solo testo).
pub struct KeepUrls;

impl Attachments for KeepUrls {
    fn place(
        &mut self,
        _url: &str,
        _name: &str,
        _log: &mut Vec<TransferNote>,
    ) -> Result<Option<String>, PluginError> {
        Ok(None)
    }
}

/// `[[bersaglio|testo]]`, o `[[testo]]` quando coincidono. Le parentesi e la
/// barra che chiuderebbero il link si tolgono.
pub fn wikilink(target: &str, label: &str) -> String {
    let clean = |s: &str| {
        s.chars()
            .filter(|c| !matches!(c, '[' | ']' | '|'))
            .collect::<String>()
            .trim()
            .to_string()
    };
    let (target, label) = (clean(target), clean(label));
    if target == label || label.is_empty() {
        format!("[[{target}]]")
    } else {
        format!("[[{target}|{label}]]")
    }
}

/// L'id di Notion senza trattini: lo stesso blocco si scrive con e senza.
pub fn plain_id(id: &str) -> String {
    id.replace('-', "")
}

/// Chi scrive il Markdown di una pagina.
pub struct Render<'a> {
    pub conventions: &'a Conventions,
    /// Le pagine dell'import, per id ([`plain_id`]).
    pub pages: &'a HashMap<String, PageRef>,
    pub attachments: &'a mut dyn Attachments,
    pub log: Vec<TransferNote>,
    pub entry: String,
}

/// Il tipo di blocco quanto basta per sapere se due vicini sono la stessa
/// lista (una riga) o due blocchi (una riga vuota).
#[derive(Clone, Copy, PartialEq)]
enum Run {
    Dash,
    Number,
    Block,
}

impl Render<'_> {
    fn note(&mut self, text: String) {
        self.log
            .push(TransferNote::info(text).about(self.entry.clone()));
    }

    fn warn(&mut self, text: String) {
        self.log
            .push(TransferNote::warning(text).about(self.entry.clone()));
    }

    /// Una sequenza di blocchi fratelli: le voci della stessa lista stanno
    /// strette, il resto è separato da una riga vuota.
    pub fn blocks(&mut self, blocks: &[Value]) -> Result<String, PluginError> {
        let mut out = String::new();
        let mut previous = Run::Block;
        for block in blocks {
            let Some((run, text)) = self.block(block)? else {
                continue;
            };
            if !out.is_empty() {
                out.push_str(if run != Run::Block && run == previous {
                    "\n"
                } else {
                    "\n\n"
                });
            }
            out.push_str(&text);
            previous = run;
        }
        Ok(out)
    }

    fn children(&mut self, block: &Value) -> Result<String, PluginError> {
        match block.get(CHILDREN).and_then(Value::as_array) {
            Some(children) => self.blocks(children),
            None => Ok(String::new()),
        }
    }

    fn block(&mut self, block: &Value) -> Result<Option<(Run, String)>, PluginError> {
        let typ = block.get("type").and_then(Value::as_str).unwrap_or("?");
        let body = block.get(typ).unwrap_or(&Value::Null);
        let rich = |r: &mut Self| r.rich_text(body.get("rich_text"));
        let text = match typ {
            "paragraph" => {
                let text = guard_lines(&rich(self));
                let children = self.children(block)?;
                join_blocks(&[text, children])
            }
            "heading_1" | "heading_2" | "heading_3" => {
                let level = &typ[typ.len() - 1..];
                let marks = "#".repeat(level.parse().unwrap_or(1));
                let title = rich(self).replace("  \n", " ");
                let children = self.children(block)?;
                join_blocks(&[format!("{marks} {title}"), children])
            }
            "bulleted_list_item" | "numbered_list_item" | "to_do" => {
                let (run, marker) = match typ {
                    "bulleted_list_item" => (Run::Dash, "- ".to_string()),
                    "numbered_list_item" => (Run::Number, "1. ".to_string()),
                    _ => {
                        let done = body.get("checked").and_then(Value::as_bool) == Some(true);
                        (Run::Dash, format!("- [{}] ", if done { "x" } else { " " }))
                    }
                };
                // Le righe che seguono stanno sotto il testo della voce, non
                // sotto il segno: due spazi per `- `, tre per `1. `.
                let width = if run == Run::Number { 3 } else { 2 };
                let text = indent_rest(&guard_lines(&rich(self)), width);
                let children = self.children(block)?;
                let mut item = format!("{marker}{text}");
                if !children.is_empty() {
                    item.push('\n');
                    item.push_str(&indent_all(&children, width));
                }
                return Ok(Some((run, item)));
            }
            "quote" => {
                let text = guard_lines(&rich(self));
                let children = self.children(block)?;
                quote(&join_blocks(&[text, children]))
            }
            "callout" => {
                let kind = callout_kind(body.get("color").and_then(Value::as_str));
                let icon = body
                    .get("icon")
                    .filter(|i| i.get("type").and_then(Value::as_str) == Some("emoji"))
                    .and_then(|i| i.get("emoji"))
                    .and_then(Value::as_str)
                    .map(|e| format!("{e} "))
                    .unwrap_or_default();
                let text = guard_lines(&rich(self));
                let children = self.children(block)?;
                let inner = join_blocks(&[format!("{icon}{text}").trim().to_string(), children]);
                format!("> [!{kind}]\n{}", quote(&inner))
            }
            "toggle" => {
                let summary = html_escape(&plain(body.get("rich_text")));
                let children = self.children(block)?;
                format!("<details>\n<summary>{summary}</summary>\n\n{children}\n\n</details>")
            }
            "code" => {
                let language = code_language(body.get("language").and_then(Value::as_str));
                let code = plain(body.get("rich_text"));
                let fence = "`".repeat(longest_run(&code, '`').max(2) + 1);
                let caption = guard_lines(&self.rich_text(body.get("caption")));
                join_blocks(&[format!("{fence}{language}\n{code}\n{fence}"), caption])
            }
            "equation" => {
                let expression = body.get("expression").and_then(Value::as_str).unwrap_or("");
                format!("$$\n{}\n$$", expression.trim())
            }
            "divider" => "---".to_string(),
            "table_of_contents" => "```toc\n```".to_string(),
            "breadcrumb" => {
                self.note("block `breadcrumb` dropped: Fub shows the path in the header".into());
                return Ok(None);
            }
            "bookmark" | "embed" | "link_preview" => {
                let url = body.get("url").and_then(Value::as_str).unwrap_or("").trim();
                if url.is_empty() {
                    return Ok(None);
                }
                let caption = guard_lines(&self.rich_text(body.get("caption")));
                join_blocks(&[url.to_string(), caption])
            }
            "image" | "video" | "pdf" | "file" | "audio" => self.attachment(typ, body)?,
            "column_list" => self.columns(block)?,
            "column" | "synced_block" => {
                let children = self.children(block)?;
                if children.is_empty() {
                    return Ok(None);
                }
                children
            }
            "child_page" => {
                let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                let title = body.get("title").and_then(Value::as_str).unwrap_or("");
                self.page_link(id, title)
            }
            "link_to_page" => {
                let id = body
                    .get("page_id")
                    .or_else(|| body.get("database_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                match self.pages.get(&plain_id(id)) {
                    Some(page) => page.link.clone(),
                    None => format!("https://www.notion.so/{}", plain_id(id)),
                }
            }
            "child_database" => {
                let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                let title = body
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Database");
                let url = format!("https://www.notion.so/{}", plain_id(id));
                self.warn(format!(
                    "database `{title}` not imported with the page: import it on its own ({url})"
                ));
                let line = if self.conventions.italian() {
                    format!(
                        "Il database «{}» di Notion non è stato importato: {url}",
                        escape(title)
                    )
                } else {
                    format!(
                        "The Notion database “{}” was not imported: {url}",
                        escape(title)
                    )
                };
                format!("> [!warning]\n> {line}")
            }
            "table" => self.table(block)?,
            other => {
                let text = guard_lines(&rich(self));
                self.note(format!("block type `{other}` has no mapping: text kept"));
                let children = self.children(block)?;
                let text = join_blocks(&[text, children]);
                if text.is_empty() {
                    return Ok(None);
                }
                text
            }
        };
        if text.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some((Run::Block, text)))
    }

    fn page_link(&self, id: &str, title: &str) -> String {
        match self.pages.get(&plain_id(id)) {
            Some(page) => page.link.clone(),
            None => wikilink(title, title),
        }
    }

    /// Le colonne (K3): `[!columns]` con un `[!column]` per ciascuna.
    fn columns(&mut self, block: &Value) -> Result<String, PluginError> {
        let columns = block
            .get(CHILDREN)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut parts = Vec::new();
        for column in &columns {
            let inner = self.children(column)?;
            let body = if inner.is_empty() {
                "> >".to_string()
            } else {
                quote(&quote(&inner))
            };
            parts.push(format!("> > [!column]\n{body}"));
        }
        if parts.is_empty() {
            return Ok(String::new());
        }
        Ok(format!("> [!columns]\n{}", parts.join("\n>\n")))
    }

    /// Una tabella di Notion: le righe sono figli `table_row` con le celle in
    /// testo ricco. Senza intestazione la prima riga la fa comunque, perché
    /// una tabella di Markdown ne ha sempre una.
    fn table(&mut self, block: &Value) -> Result<String, PluginError> {
        let rows = block
            .get(CHILDREN)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let width = block
            .get("table")
            .and_then(|t| t.get("table_width"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let mut lines: Vec<Vec<String>> = Vec::new();
        for row in &rows {
            let cells = row
                .get("table_row")
                .and_then(|r| r.get("cells"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let cells = cells
                .iter()
                .map(|cell| {
                    self.rich_items(cell.as_array().map(Vec::as_slice).unwrap_or(&[]))
                        .replace("  \n", "<br>")
                        .replace('|', "\\|")
                })
                .collect::<Vec<_>>();
            lines.push(cells);
        }
        let width = lines
            .iter()
            .map(Vec::len)
            .max()
            .unwrap_or(0)
            .max(width)
            .max(1);
        if lines.is_empty() {
            return Ok(String::new());
        }
        let has_header = block
            .get("table")
            .and_then(|t| t.get("has_column_header"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !has_header {
            self.note("table without a header row: the first row became the header".into());
        }
        let row = |cells: &[String]| {
            let mut cells = cells.to_vec();
            cells.resize(width, String::new());
            format!("| {} |", cells.join(" | "))
        };
        let mut out = vec![row(&lines[0]), format!("|{}", " --- |".repeat(width))];
        out.extend(lines[1..].iter().map(|cells| row(cells)));
        Ok(out.join("\n"))
    }

    /// Immagini, video, PDF, file e audio. Quelli ospitati da Notion passano
    /// per [`Attachments`]; gli URL esterni restano.
    fn attachment(&mut self, typ: &str, body: &Value) -> Result<String, PluginError> {
        let hosted = body.get("type").and_then(Value::as_str) == Some("file");
        let url = body
            .get("file")
            .and_then(|x| x.get("url"))
            .or_else(|| body.get("external").and_then(|x| x.get("url")))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if url.is_empty() {
            return Ok(String::new());
        }
        let caption = plain(body.get("caption"));
        let name = body
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| url_file_name(&url))
            .unwrap_or_else(|| typ.to_string());
        let target = if hosted {
            let mut log = std::mem::take(&mut self.log);
            let placed = self.attachments.place(&url, &name, &mut log);
            self.log = log;
            placed?.unwrap_or_else(|| link_target(&url))
        } else {
            link_target(&url)
        };
        let label = if caption.is_empty() {
            name.clone()
        } else {
            caption.clone()
        };
        let label = escape(&label);
        Ok(match typ {
            "image" | "video" | "pdf" => {
                let alt = if caption.is_empty() {
                    String::new()
                } else {
                    label
                };
                format!("![{alt}]({target})")
            }
            _ => format!("[{label}]({target})"),
        })
    }

    /// Il testo ricco di un campo (`rich_text`, `caption`).
    pub fn rich_text(&mut self, items: Option<&Value>) -> String {
        let items = items
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        self.rich_items(items)
    }

    fn rich_items(&mut self, items: &[Value]) -> String {
        // Le voci vicine con le stesse annotazioni e lo stesso link si
        // fondono, perché `**a****b**` non è un grassetto.
        let mut runs: Vec<(Style, Piece)> = Vec::new();
        for item in items {
            let style = Style::of(item);
            let piece = self.piece(item);
            match (runs.last_mut(), &piece) {
                (Some((last, Piece::Text(text))), Piece::Text(more)) if *last == style => {
                    text.push_str(more)
                }
                _ => runs.push((style, piece)),
            }
        }
        runs.into_iter()
            .map(|(style, piece)| style.apply(piece))
            .collect()
    }

    fn piece(&mut self, item: &Value) -> Piece {
        let typ = item.get("type").and_then(Value::as_str).unwrap_or("text");
        let plain_text = item
            .get("plain_text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        match typ {
            "equation" => {
                let expression = item
                    .get("equation")
                    .and_then(|e| e.get("expression"))
                    .and_then(Value::as_str)
                    .unwrap_or(&plain_text);
                Piece::Raw(format!("${}$", expression.trim()))
            }
            "mention" => self.mention(item, &plain_text),
            _ => Piece::Text(
                item.get("text")
                    .and_then(|t| t.get("content"))
                    .and_then(Value::as_str)
                    .unwrap_or(&plain_text)
                    .to_string(),
            ),
        }
    }

    /// Le menzioni (L5): persona → K5, data → K6, pagina → wikilink.
    fn mention(&mut self, item: &Value, plain_text: &str) -> Piece {
        let mention = item.get("mention").unwrap_or(&Value::Null);
        let shown = plain_text.trim_start_matches('@').trim();
        match mention.get("type").and_then(Value::as_str).unwrap_or("") {
            "user" => {
                let name = mention
                    .get("user")
                    .and_then(|u| u.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or(shown)
                    .trim();
                match sanitize_component(name) {
                    Some(file) => Piece::Raw(wikilink(
                        &format!("{}/{file}", self.conventions.people),
                        name,
                    )),
                    None => Piece::Text(plain_text.to_string()),
                }
            }
            "date" => {
                let date = mention.get("date").unwrap_or(&Value::Null);
                let day = |key: &str| {
                    date.get(key)
                        .and_then(Value::as_str)
                        .filter(|d| is_iso_day(d))
                        .map(str::to_string)
                };
                let Some(start) = day("start") else {
                    return Piece::Text(plain_text.to_string());
                };
                let mut out = self.conventions.daily_link(&start[..10]);
                if let Some(time) = start.get(11..16).filter(|_| start.len() > 10) {
                    out.push(' ');
                    out.push_str(time);
                }
                if let Some(end) = day("end") {
                    out.push_str(" → ");
                    out.push_str(&self.conventions.daily_link(&end[..10]));
                    if let Some(time) = end.get(11..16).filter(|_| end.len() > 10) {
                        out.push(' ');
                        out.push_str(time);
                    }
                }
                Piece::Raw(out)
            }
            "page" | "database" => {
                let kind = mention
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("page");
                let id = mention
                    .get(kind)
                    .and_then(|p| p.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                Piece::Raw(self.page_link(id, shown))
            }
            "link_preview" | "link_mention" => {
                let kind = mention.get("type").and_then(Value::as_str).unwrap_or("");
                let url = mention
                    .get(kind)
                    .and_then(|l| l.get("url").or_else(|| l.get("href")))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if url.is_empty() {
                    Piece::Text(plain_text.to_string())
                } else {
                    Piece::Raw(format!("[{}]({})", escape(shown), link_target(url)))
                }
            }
            other => {
                if !other.is_empty() {
                    self.note(format!("mention `{other}` kept as its text"));
                }
                Piece::Text(plain_text.to_string())
            }
        }
    }
}

/// Un tratto di testo ricco: testo da proteggere, o Markdown già scritto.
enum Piece {
    Text(String),
    Raw(String),
}

#[derive(PartialEq)]
struct Style {
    bold: bool,
    italic: bool,
    strike: bool,
    underline: bool,
    code: bool,
    color: Option<String>,
    href: Option<String>,
}

impl Style {
    fn of(item: &Value) -> Self {
        let a = item.get("annotations").unwrap_or(&Value::Null);
        let flag = |k: &str| a.get(k).and_then(Value::as_bool) == Some(true);
        let color = a
            .get("color")
            .and_then(Value::as_str)
            .filter(|c| *c != "default")
            .map(str::to_string);
        let href = item
            .get("text")
            .and_then(|t| t.get("link"))
            .and_then(|l| l.get("url"))
            .and_then(Value::as_str)
            .or_else(|| {
                // Una menzione porta il suo href, che non è un link da scrivere.
                (item.get("type").and_then(Value::as_str) != Some("mention"))
                    .then(|| item.get("href").and_then(Value::as_str))
                    .flatten()
            })
            .filter(|h| !h.is_empty())
            .map(str::to_string);
        Style {
            bold: flag("bold"),
            italic: flag("italic"),
            strike: flag("strikethrough"),
            underline: flag("underline"),
            code: flag("code"),
            color,
            href,
        }
    }

    fn apply(&self, piece: Piece) -> String {
        let (raw, written) = match piece {
            Piece::Raw(raw) => (raw, true),
            Piece::Text(text) => (text, false),
        };
        if raw.is_empty() {
            return raw;
        }
        // Gli spazi ai bordi restano fuori dai segni: `** a**` non è grassetto.
        let start = raw.len() - raw.trim_start().len();
        let end = raw.trim_end().len().max(start);
        let (lead, core, tail) = (&raw[..start], &raw[start..end], &raw[end..]);
        if core.is_empty() {
            return breaks(&raw);
        }
        let mut inner = if written {
            core.to_string()
        } else if self.code {
            code_span(core)
        } else {
            breaks(&escape(core))
        };
        if let Some(href) = &self.href {
            inner = format!("[{inner}]({})", link_target(href));
        }
        if self.strike {
            inner = format!("~~{inner}~~");
        }
        if self.italic {
            inner = format!("*{inner}*");
        }
        if self.bold {
            inner = format!("**{inner}**");
        }
        if self.underline {
            inner = format!("<u>{inner}</u>");
        }
        if let Some(color) = &self.color {
            let (name, fill) = match color.strip_suffix("_background") {
                Some(name) => (name, true),
                None => (color.as_str(), false),
            };
            if COLORS.contains(&name) {
                inner = if fill {
                    format!("<mark class=\"fub-bg-{name}\">{inner}</mark>")
                } else {
                    format!("<span class=\"fub-color-{name}\">{inner}</span>")
                };
            }
        }
        format!("{}{inner}{}", breaks(lead), breaks(tail))
    }
}

/// Un a capo dentro un blocco di Notion è un a capo vero: due spazi in fondo.
fn breaks(text: &str) -> String {
    text.replace('\n', "  \n")
}

/// Protegge i caratteri che nel testo semplice diventerebbero sintassi: segni
/// di enfasi, link, HTML, apice e pedice, formule, evidenziato, commenti,
/// tag ed entità.
pub fn escape(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (i, &c) in chars.iter().enumerate() {
        let next = chars.get(i + 1).copied();
        let protect = match c {
            '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '~' | '^' | '$' => true,
            '=' => next == Some('='),
            '%' => next == Some('%'),
            '#' => next.is_some_and(|n| !n.is_whitespace()),
            '&' => {
                let rest: String = chars[i + 1..].iter().take(12).collect();
                rest.find(';').is_some_and(|end| {
                    end > 0
                        && rest[..end]
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '#')
                })
            }
            _ => false,
        };
        if protect {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// L'inizio di ogni riga che Markdown leggerebbe come un blocco: un titolo,
/// una citazione, una voce, un righello, un rientro di codice.
fn guard_lines(text: &str) -> String {
    text.split('\n')
        .map(guard_start)
        .collect::<Vec<_>>()
        .join("\n")
}

fn guard_start(line: &str) -> String {
    let line = line.trim_start_matches([' ', '\t']);
    let mut chars = line.chars();
    let first = chars.next();
    let second = chars.next();
    let block = match first {
        Some('#') | Some('>') => true,
        Some('-') | Some('+') | Some('*') => {
            second.is_none_or(|c| c == ' ')
                || line.chars().all(|c| c == first.unwrap_or(' ') || c == ' ')
        }
        Some('=') => line.trim_end().chars().all(|c| c == '='),
        Some(c) if c.is_ascii_digit() => {
            let digits = line.chars().take_while(char::is_ascii_digit).count();
            let rest = &line[digits..];
            (rest.starts_with(". ") || rest.starts_with(") ") || rest == "." || rest == ")")
                && digits <= 9
        }
        _ => false,
    };
    if !block {
        return line.to_string();
    }
    if first.is_some_and(|c| c.is_ascii_digit()) {
        let digits = line.chars().take_while(char::is_ascii_digit).count();
        return format!("{}\\{}", &line[..digits], &line[digits..]);
    }
    if line.starts_with('\\') {
        return line.to_string();
    }
    format!("\\{line}")
}

/// Un tratto di codice in riga: tanti apici inversi quanti ne servono perché
/// quelli del testo non lo chiudano.
fn code_span(code: &str) -> String {
    let fence = "`".repeat(longest_run(code, '`') + 1);
    let pad = if code.starts_with('`') || code.ends_with('`') {
        " "
    } else {
        ""
    };
    format!("{fence}{pad}{code}{pad}{fence}")
}

fn longest_run(text: &str, mark: char) -> usize {
    let mut best = 0;
    let mut run = 0;
    for c in text.chars() {
        run = if c == mark { run + 1 } else { 0 };
        best = best.max(run);
    }
    best
}

/// Il testo senza annotazioni (codice, sommari, didascalie).
fn plain(items: Option<&Value>) -> String {
    items
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| t.get("plain_text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn html_escape(text: &str) -> String {
    fub_abi::html::escape(&text.replace('\n', " "))
}

/// L'info string di un recinto per la lingua di Notion, che l'API scrive in
/// minuscolo (`plain text`, `c++`, `python`).
pub fn code_language(language: Option<&str>) -> String {
    let language = language.unwrap_or("plain text").trim();
    if let Some((_, fub)) = LANGUAGES.iter().find(|(notion, _)| *notion == language) {
        return fub.to_string();
    }
    language
        .chars()
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '+' | '#' | '.'))
        .collect()
}

/// Il tipo di callout per il colore di Notion.
fn callout_kind(color: Option<&str>) -> &'static str {
    let color = color.unwrap_or("default");
    match color.strip_suffix("_background").unwrap_or(color) {
        "blue" => "info",
        "green" => "success",
        "yellow" | "orange" => "warning",
        "red" => "danger",
        "purple" => "example",
        "pink" => "tip",
        _ => "note",
    }
}

fn is_iso_day(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() >= 10
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// Un URL come destinazione di un link: fra `<>` se ha spazi o parentesi.
fn link_target(url: &str) -> String {
    if url.contains([' ', '(', ')', '<', '>']) {
        format!("<{}>", url.replace(['<', '>'], ""))
    } else {
        url.to_string()
    }
}

/// L'ultimo pezzo del path di un URL, decodificato, senza la query.
pub fn url_file_name(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let path = path.split_once("://").map_or(path, |(_, rest)| rest);
    let last = path.split_once('/')?.1.rsplit('/').next()?;
    let decoded = percent_decode(last);
    (!decoded.trim().is_empty()).then_some(decoded)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Ogni riga dopo la prima, rientrata di `width` spazi.
fn indent_rest(text: &str, width: usize) -> String {
    let pad = " ".repeat(width);
    let mut lines = text.split('\n');
    let mut out = lines.next().unwrap_or("").to_string();
    for line in lines {
        out.push('\n');
        if !line.is_empty() {
            out.push_str(&pad);
        }
        out.push_str(line);
    }
    out
}

/// Ogni riga rientrata di `width` spazi; le vuote restano vuote.
fn indent_all(text: &str, width: usize) -> String {
    let pad = " ".repeat(width);
    text.split('\n')
        .map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!("{pad}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Ogni riga dentro una citazione.
fn quote(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            if line.is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn join_blocks(parts: &[String]) -> String {
    parts
        .iter()
        .filter(|p| !p.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conventions() -> Conventions {
        Conventions {
            language: "it".into(),
            ..Conventions::default()
        }
    }

    fn render_with(
        blocks: &[Value],
        pages: &HashMap<String, PageRef>,
    ) -> (String, Vec<TransferNote>) {
        let conventions = conventions();
        let mut keep = KeepUrls;
        let mut render = Render {
            conventions: &conventions,
            pages,
            attachments: &mut keep,
            log: Vec::new(),
            entry: "notion://t".into(),
        };
        let out = render.blocks(blocks).unwrap();
        (out, render.log)
    }

    fn render(blocks: Value) -> String {
        render_with(blocks.as_array().unwrap(), &HashMap::new()).0
    }

    fn text(content: &str) -> Value {
        json!({"type": "text", "text": {"content": content, "link": null}, "plain_text": content})
    }

    fn block(typ: &str, body: Value) -> Value {
        json!({"type": typ, "id": format!("id-{typ}"), "has_children": false, typ: body})
    }

    fn with_children(mut block: Value, children: Value) -> Value {
        block[CHILDREN] = children;
        block
    }

    fn fixture() -> Vec<Value> {
        let response: Value =
            serde_json::from_str(include_str!("../tests/fixtures/notion/rich-text.json")).unwrap();
        response["results"].as_array().unwrap().clone()
    }

    // L1: ogni annotazione con la forma di Fub, i colori con le classi di K1,
    // il link, e il testo semplice protetto.
    #[test]
    fn rich_text_keeps_the_annotations_and_protects_plain_text() {
        let (out, _) = render_with(&fixture(), &HashMap::new());
        let paragraphs: Vec<&str> = out.split("\n\n").collect();
        assert_eq!(
            paragraphs[0],
            "Plain **bold** and ***both*** ``a`b`` ~~gone~~ <u>under</u> \
             <span class=\"fub-color-red\">red</span> <mark class=\"fub-bg-yellow\">lit</mark> \
             [site](https://example.com/a) costs \\$5 \\* 2 \\[x\\] \\<b> \\~a\\^ \\#1 \
             \\==no\\== \\%%no\\%% \\&amp; 50%"
        );
        assert_eq!(
            paragraphs[1],
            "\\# not a heading  \n1\\. not a list  \n\\- nor this"
        );
        assert_eq!(paragraphs[2], "**one word** then $E = mc^2$");
    }

    #[test]
    fn spaces_stay_outside_the_marks() {
        let item = json!({"type": "text", "text": {"content": " spaced ", "link": null},
            "annotations": {"bold": true}, "plain_text": " spaced "});
        let out = render(json!([block(
            "paragraph",
            json!({"rich_text": [text("a"), item, text("b")]})
        )]));
        assert_eq!(out, "a **spaced** b");
    }

    // L2: la lingua diventa l'info string, e dentro una voce tutte le righe
    // del codice stanno sotto il testo della voce.
    #[test]
    fn code_keeps_its_language_and_every_line_under_the_item() {
        let code = block(
            "code",
            json!({"language": "c++", "rich_text": [text("int a;\nint b;\n``` not a fence")]}),
        );
        let item = with_children(
            block("numbered_list_item", json!({"rich_text": [text("Passo")]})),
            json!([code]),
        );
        let out = render(json!([item]));
        assert_eq!(
            out,
            "1. Passo\n   ````cpp\n   int a;\n   int b;\n   ``` not a fence\n   ````"
        );
        assert_eq!(code_language(Some("plain text")), "");
        assert_eq!(code_language(Some("python")), "python");
        assert_eq!(code_language(Some("c#")), "csharp");
        assert_eq!(code_language(Some("visual basic")), "vb");
        assert_eq!(code_language(Some("mermaid")), "mermaid");
    }

    #[test]
    fn lists_stay_tight_and_end_before_a_paragraph() {
        let out = render(json!([
            block("bulleted_list_item", json!({"rich_text": [text("uno")]})),
            block(
                "to_do",
                json!({"rich_text": [text("due")], "checked": true})
            ),
            block("paragraph", json!({"rich_text": [text("dopo")]})),
            block("numbered_list_item", json!({"rich_text": [text("tre")]})),
        ]));
        assert_eq!(out, "- uno\n- [x] due\n\ndopo\n\n1. tre");
    }

    // L4: un test per ogni blocco che prima non aveva una forma.
    #[test]
    fn toggle_becomes_details() {
        let toggle = with_children(
            block("toggle", json!({"rich_text": [text("Apri <qui>")]})),
            json!([block("paragraph", json!({"rich_text": [text("dentro")]}))]),
        );
        assert_eq!(
            render(json!([toggle])),
            "<details>\n<summary>Apri &lt;qui&gt;</summary>\n\ndentro\n\n</details>"
        );
    }

    #[test]
    fn callout_becomes_a_callout_with_its_icon() {
        let callout = with_children(
            block(
                "callout",
                json!({"rich_text": [text("Attenzione")], "color": "red_background",
                    "icon": {"type": "emoji", "emoji": "⚠️"}}),
            ),
            json!([block(
                "bulleted_list_item",
                json!({"rich_text": [text("punto")]})
            )]),
        );
        assert_eq!(
            render(json!([callout])),
            "> [!danger]\n> ⚠️ Attenzione\n>\n> - punto"
        );
    }

    #[test]
    fn column_list_becomes_columns() {
        let column = |word: &str| {
            with_children(
                block("column", json!({})),
                json!([block("paragraph", json!({"rich_text": [text(word)]}))]),
            )
        };
        let columns = with_children(
            block("column_list", json!({})),
            json!([column("sinistra"), column("destra")]),
        );
        assert_eq!(
            render(json!([columns])),
            "> [!columns]\n> > [!column]\n> > sinistra\n>\n> > [!column]\n> > destra"
        );
    }

    #[test]
    fn table_of_contents_equation_and_links_on_their_line() {
        let out = render(json!([
            block("table_of_contents", json!({"color": "default"})),
            block("equation", json!({"expression": "a^2 + b^2"})),
            block("bookmark", json!({"url": "https://fub.app", "caption": []})),
            block("embed", json!({"url": "https://example.com/e"})),
            block("link_preview", json!({"url": "https://github.com/x/y"})),
        ]));
        assert_eq!(
            out,
            "```toc\n```\n\n$$\na^2 + b^2\n$$\n\nhttps://fub.app\n\nhttps://example.com/e\n\nhttps://github.com/x/y"
        );
    }

    #[test]
    fn synced_block_is_its_content() {
        let synced = with_children(
            block("synced_block", json!({"synced_from": null})),
            json!([block(
                "paragraph",
                json!({"rich_text": [text("condiviso")]})
            )]),
        );
        assert_eq!(render(json!([synced])), "condiviso");
    }

    #[test]
    fn child_database_is_a_warning_with_its_link_and_a_report_line() {
        let mut db = block("child_database", json!({"title": "Compiti"}));
        db["id"] = json!("1234-abcd");
        let (out, log) = render_with(&[db], &HashMap::new());
        assert_eq!(
            out,
            "> [!warning]\n> Il database «Compiti» di Notion non è stato importato: https://www.notion.so/1234abcd"
        );
        assert!(log.iter().any(|n| n.message.contains("Compiti")), "{log:?}");
    }

    #[test]
    fn a_table_becomes_a_table_and_unknown_blocks_reach_the_report() {
        let row = |a: &str, b: &str| block("table_row", json!({"cells": [[text(a)], [text(b)]]}));
        let table = with_children(
            block(
                "table",
                json!({"table_width": 2, "has_column_header": true}),
            ),
            json!([row("Nome", "Voto"), row("a|b", "8")]),
        );
        let (out, log) = render_with(
            &[
                table,
                block("template", json!({"rich_text": [text("modello")]})),
            ],
            &HashMap::new(),
        );
        assert_eq!(
            out,
            "| Nome | Voto |\n| --- | --- |\n| a\\|b | 8 |\n\nmodello"
        );
        assert!(
            log.iter().any(|n| n.message.contains("`template`")),
            "{log:?}"
        );
    }

    // L5: persona, data e pagina con le forme di K5, K6 e del wikilink.
    #[test]
    fn mentions_become_people_days_and_pages() {
        let mention = |kind: &str, body: Value, plain: &str| json!({"type": "mention", "mention": {"type": kind, kind: body}, "plain_text": plain});
        let mut pages = HashMap::new();
        pages.insert(
            plain_id("aaaa-bbbb"),
            PageRef {
                doc: DocId::new("Viaggio/_index.md"),
                link: "[[Viaggio]]".into(),
            },
        );
        let para = block(
            "paragraph",
            json!({"rich_text": [
                mention("user", json!({"id": "u1", "name": "Ada Lovelace"}), "@Ada Lovelace"),
                text(" il "),
                mention("date", json!({"start": "2026-11-04", "end": null}), "@November 4, 2026"),
                text(" alle "),
                mention("date", json!({"start": "2026-11-05T10:30:00.000+01:00"}), "@x"),
                text(" per "),
                mention("page", json!({"id": "aaaabbbb"}), "Viaggio"),
                text(" e "),
                mention("page", json!({"id": "fuori"}), "Altrove"),
            ]}),
        );
        let (out, _) = render_with(&[para], &pages);
        assert_eq!(
            out,
            "[[Persone/Ada Lovelace|Ada Lovelace]] il [[Daily/2026-11-04|4 novembre 2026]] alle \
             [[Daily/2026-11-05|5 novembre 2026]] 10:30 per [[Viaggio]] e [[Altrove]]"
        );
    }

    #[test]
    fn the_daily_name_follows_the_declared_format() {
        assert_eq!(daily_name("YYYY-MM-DD", "2026-10-19", "it"), "2026-10-19");
        assert_eq!(
            daily_name("YYYY/MMMM/dddd D [del] MMM", "2026-10-19", "it"),
            "2026/ottobre/lunedì 19 del ott"
        );
        assert_eq!(
            daily_name("ddd, MMMM D", "2026-10-19", "en"),
            "Mon, October 19"
        );
    }

    #[test]
    fn hosted_files_go_through_the_attachments_and_external_ones_stay() {
        struct Here;
        impl Attachments for Here {
            fn place(
                &mut self,
                _url: &str,
                name: &str,
                _log: &mut Vec<TransferNote>,
            ) -> Result<Option<String>, PluginError> {
                Ok(Some(format!("attachments/{name}")))
            }
        }
        let conventions = conventions();
        let pages = HashMap::new();
        let mut here = Here;
        let mut render = Render {
            conventions: &conventions,
            pages: &pages,
            attachments: &mut here,
            log: Vec::new(),
            entry: "e".into(),
        };
        let out = render
            .blocks(&[
                block(
                    "image",
                    json!({"type": "file", "file": {"url": "https://prod-files-secure.s3.us-west-2.amazonaws.com/x/y/foto%20mare.png?X-Amz-Signature=s"},
                        "caption": [text("Il mare")]}),
                ),
                block("file", json!({"type": "external", "external": {"url": "https://example.com/doc.pdf"}, "caption": []})),
            ])
            .unwrap();
        assert_eq!(
            out,
            "![Il mare](attachments/foto mare.png)\n\n[doc.pdf](https://example.com/doc.pdf)"
        );
    }
}
