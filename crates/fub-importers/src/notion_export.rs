//! L'export di Notion dentro un archivio («Export → Markdown & CSV»).
//!
//! Notion scrive un albero di file che non è ancora un vault:
//!
//! - ogni nome finisce con l'id della pagina, 32 cifre esadecimali
//!   (`Decisioni 1a2b….md`, `Specifiche 1a2b…/`), e i link lo ripetono;
//! - un database esce due volte: il `.csv` con una riga per voce e la cartella
//!   con una pagina `.md` per riga, che ripete in testa le proprietà come
//!   `Chiave: valore`;
//! - nel CSV le date sono in inglese (`December 8, 2026`) e i numeri testo;
//! - un callout è un blocco `<aside>`.
//!
//! Qui l'archivio diventa note di Markdown nativo, senza formati nuovi:
//!
//! - l'id si toglie da ogni nome; due pagine sorelle con lo stesso titolo
//!   diventano `Titolo` e `Titolo 2`, nell'ordine dei loro id, e i link
//!   seguono il nome nuovo;
//! - il `.csv` resta un file del vault, col suo nome pulito, così il link che
//!   lo chiama lo apre; ogni riga diventa **una** nota, nella cartella del
//!   database: la pagina della riga con le colonne del CSV come proprietà, o,
//!   se la pagina manca, una nota con le sole proprietà;
//! - una colonna in cui ogni valore è un numero diventa numeri, una in cui
//!   ogni valore è una data di Notion diventa date ISO, una di soli `Yes`/`No`
//!   diventa vero/falso; basta un valore che non si legge e la colonna resta
//!   testo, così nessun valore cambia o si perde;
//! - `<aside>` diventa il richiamo `> [!note]`.
//!
//! L'archivio grande che la finestra divide in parti arriva qui una parte
//! alla volta: il nome pulito di un file dipende solo dai suoi fratelli nella
//! stessa parte, e un link a un file di un'altra parte perde gli id con la
//! stessa regola.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use fub_abi::model::valid_civil_date;
use fub_abi::rules::path::resolution_key;

use crate::common::{sanitize_component, title_file_stem, yaml_key, yaml_scalar};
use crate::csv::{parse_table, CsvTable};
use crate::notion::percent_decode;

/// Il tipo di una colonna del CSV, deciso da tutti i suoi valori.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Text,
    Number,
    Date,
    Bool,
}

/// Un nome di Notion spezzato: `base`, l'id (vuoto se non c'è), la coda che
/// segue l'id (`_all` per il CSV con tutte le righe) e l'estensione.
struct Parts {
    base: String,
    id: String,
    tail: String,
    ext: Option<String>,
}

/// L'estensione di un nome dell'export, senza distinguere le maiuscole:
/// `ext` è scritta minuscola, e le estensioni che contano (`md`, `markdown`,
/// `csv`) sono ASCII. È l'unico confronto di nomi del modulo che piega il
/// caso; gli id e i titoli si confrontano come sono scritti.
pub(crate) fn has_extension(name: &str, ext: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(stem, found)| !stem.is_empty() && found.eq_ignore_ascii_case(ext))
}

fn is_notion_id(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

fn split_name(component: &str, is_file: bool) -> Parts {
    let (stem, ext) = match component.rsplit_once('.') {
        Some((stem, ext)) if is_file && !stem.is_empty() => (stem, Some(ext.to_string())),
        _ => (component, None),
    };
    let (stem, tail) = match stem.strip_suffix("_all") {
        Some(rest) if has_extension(component, "csv") => (rest, "_all"),
        _ => (stem, ""),
    };
    if let Some((base, id)) = stem.rsplit_once(' ') {
        if is_notion_id(id) && !base.trim().is_empty() {
            return Parts {
                base: base.trim_end().to_string(),
                id: id.to_string(),
                tail: tail.to_string(),
                ext,
            };
        }
    }
    Parts {
        base: format!("{stem}{tail}"),
        id: String::new(),
        tail: String::new(),
        ext,
    }
}

fn join_name(base: &str, tail: &str, ext: Option<&str>) -> String {
    match ext {
        Some(ext) => format!("{base}{tail}.{ext}"),
        None => format!("{base}{tail}"),
    }
}

/// Il nome senza id, per un path che l'archivio (o questa sua parte) non ha.
fn clean_component(component: &str, is_file: bool) -> String {
    let parts = split_name(component, is_file);
    join_name(&parts.base, &parts.tail, parts.ext.as_deref())
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

fn last(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

/// Un database: il CSV da cui vengono le righe e le note che ne nascono.
struct Database {
    /// Il CSV, così come è nell'archivio.
    csv: String,
    /// La cartella pulita delle sue righe.
    folder: String,
    table: Option<CsvTable>,
    kinds: Vec<Kind>,
    /// Per ogni riga, la pagina che la porta (voce dell'archivio).
    page_of_row: Vec<Option<String>>,
    /// Per ogni riga senza pagina, il path pulito della nota che nasce.
    note_of_row: Vec<Option<String>>,
    /// Il perché di un CSV che non si legge.
    error: Option<String>,
}

/// Il piano dell'export: i nomi nuovi e i database.
pub(crate) struct Layout {
    /// Ogni file dell'archivio → il path pulito, relativo alla destinazione.
    files: HashMap<String, String>,
    /// Ogni cartella dell'archivio → il path pulito.
    dirs: HashMap<String, String>,
    /// I database, per voce del CSV che porta le righe.
    databases: BTreeMap<String, Database>,
    /// Le pagine che sono la riga di un database: voce → (CSV, riga).
    rows: HashMap<String, (String, usize)>,
    /// Quante voci hanno perso l'id nel nome.
    renamed: usize,
}

/// Il risultato di una pagina convertita: il Markdown e ciò che va detto.
pub(crate) struct Converted {
    pub markdown: String,
    pub warnings: Vec<String>,
}

/// Una nota che nasce da una riga del CSV senza pagina.
pub(crate) struct RowNote {
    pub path: String,
    pub markdown: String,
    pub line: usize,
}

/// Il CSV di un database, pronto da scrivere.
pub(crate) struct DatabaseEntry {
    pub notes: Vec<RowNote>,
    pub info: Vec<String>,
    pub warnings: Vec<String>,
}

impl Layout {
    /// Un export di Notion si riconosce dai nomi: almeno una pagina `.md` o un
    /// database `.csv` col suo id in fondo. `names` sono le voci file, già
    /// passate dai controlli di sicurezza dell'archivio.
    pub(crate) fn detect(names: &[&str]) -> Option<Layout> {
        let notion = names.iter().any(|name| {
            let parts = split_name(last(name), true);
            !parts.id.is_empty() && (has_extension(name, "md") || has_extension(name, "csv"))
        });
        notion.then(|| Layout::plan(names))
    }

    fn plan(names: &[&str]) -> Layout {
        // Notion chiude tutto in `Export-<uuid>/`: una cartella che non dice
        // niente a chi legge, e che si toglie solo se contiene ogni voce.
        let root = names
            .first()
            .and_then(|name| name.split_once('/'))
            .map(|(top, _)| top.to_string())
            .filter(|top| is_export_root(top))
            .filter(|top| {
                names.iter().all(|name| {
                    name.strip_prefix(top.as_str())
                        .is_some_and(|r| r.starts_with('/'))
                })
            });
        // I figli di ogni cartella dell'archivio, file e cartelle.
        let mut children: BTreeMap<String, BTreeSet<(String, bool)>> = BTreeMap::new();
        for name in names {
            let mut dir = String::new();
            let components: Vec<&str> = name.split('/').collect();
            for (i, component) in components.iter().enumerate() {
                let is_file = i + 1 == components.len();
                children
                    .entry(dir.clone())
                    .or_default()
                    .insert((component.to_string(), is_file));
                dir = join(&dir, component);
            }
        }
        // Il nome nuovo di ogni figlio, deciso fra fratelli: pagina, cartella e
        // CSV dello stesso id restano insieme; id diversi con lo stesso titolo
        // prendono `Titolo 2`, `Titolo 3` nell'ordine degli id.
        let mut renamed_child: HashMap<(String, String, bool), String> = HashMap::new();
        let mut renamed = 0usize;
        for (dir, kids) in &children {
            let mut ids: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
            let mut bases: HashSet<String> = HashSet::new();
            for (component, is_file) in kids {
                let parts = split_name(component, *is_file);
                bases.insert(resolution_key(&parts.base));
                ids.entry(resolution_key(&parts.base))
                    .or_default()
                    .insert(parts.id.clone());
            }
            let mut chosen: HashMap<(String, String), String> = HashMap::new();
            for (key, ids) in &ids {
                // Un file senza id (vuoto) ordina per primo e tiene il suo nome.
                for (n, id) in ids.iter().enumerate() {
                    if n == 0 {
                        continue;
                    }
                    let mut k = n + 1;
                    let suffix = loop {
                        let candidate = format!("{key} {k}");
                        if !bases.contains(&candidate) {
                            bases.insert(candidate);
                            break k;
                        }
                        k += 1;
                    };
                    chosen.insert((key.clone(), id.clone()), suffix.to_string());
                }
            }
            for (component, is_file) in kids {
                let parts = split_name(component, *is_file);
                let base = match chosen.get(&(resolution_key(&parts.base), parts.id.clone())) {
                    Some(suffix) => format!("{} {suffix}", parts.base),
                    None => parts.base.clone(),
                };
                let name = join_name(&base, &parts.tail, parts.ext.as_deref());
                let name = sanitize_component(&name).unwrap_or_else(|| component.clone());
                if name != *component {
                    renamed += 1;
                }
                renamed_child.insert((dir.clone(), component.clone(), *is_file), name);
            }
        }
        let mut files = HashMap::new();
        let mut dirs = HashMap::new();
        for name in names {
            let components: Vec<&str> = name.split('/').collect();
            let mut original = String::new();
            let mut clean = String::new();
            for (i, component) in components.iter().enumerate() {
                let is_file = i + 1 == components.len();
                let key = (original.clone(), component.to_string(), is_file);
                let new = renamed_child
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| component.to_string());
                original = join(&original, component);
                let at_root = i == 0 && !is_file && root.as_deref() == Some(*component);
                if !at_root {
                    clean = join(&clean, &new);
                }
                if is_file {
                    files.insert(original.clone(), clean.clone());
                } else {
                    dirs.insert(original.clone(), clean.clone());
                }
            }
        }
        // I database: ogni CSV con l'id, e la cartella delle sue righe (lo
        // stesso nome senza estensione). Con `_all.csv` accanto, le righe
        // vengono da quello: è il CSV con tutte le voci, non solo la vista.
        let mut databases = BTreeMap::new();
        let mut by_folder: BTreeMap<String, String> = BTreeMap::new();
        for name in names {
            let parts = split_name(last(name), true);
            if parts.id.is_empty() || !has_extension(name, "csv") {
                continue;
            }
            let folder = join(parent(name), &format!("{} {}", parts.base, parts.id));
            match by_folder.get(&folder) {
                Some(existing) if !parts.tail.is_empty() => {
                    databases.remove(existing);
                }
                Some(_) => continue,
                None => {}
            }
            by_folder.insert(folder.clone(), name.to_string());
            let clean_csv = files.get(*name).cloned().unwrap_or_default();
            let clean_folder = dirs.get(&folder).cloned().unwrap_or_else(|| {
                let stem = clean_csv
                    .rsplit_once('.')
                    .map_or(clean_csv.as_str(), |(s, _)| s);
                stem.strip_suffix(parts.tail.as_str())
                    .unwrap_or(stem)
                    .to_string()
            });
            databases.insert(
                name.to_string(),
                Database {
                    csv: name.to_string(),
                    folder: clean_folder,
                    table: None,
                    kinds: Vec::new(),
                    page_of_row: Vec::new(),
                    note_of_row: Vec::new(),
                    error: None,
                },
            );
        }
        Layout {
            files,
            dirs,
            databases,
            rows: HashMap::new(),
            renamed,
        }
    }

    /// La cartella dell'archivio delle righe di un database.
    fn row_folder(csv: &str) -> String {
        let parts = split_name(last(csv), true);
        join(parent(csv), &format!("{} {}", parts.base, parts.id))
    }

    /// Le voci da leggere prima delle altre: i CSV dei database e le pagine
    /// nelle loro cartelle, che servono per unire righe e pagine.
    pub(crate) fn needs_content(&self, name: &str) -> bool {
        self.databases.contains_key(name)
            || self
                .databases
                .keys()
                .any(|csv| parent(name) == Layout::row_folder(csv) && has_extension(name, "md"))
    }

    /// Legge i database e unisce ogni riga alla sua pagina. `content` dà il
    /// testo di una voce letta prima (`None` se non c'è o non è UTF-8).
    pub(crate) fn read<'a>(&mut self, content: impl Fn(&str) -> Option<&'a str>) {
        let names: Vec<String> = self.files.keys().cloned().collect();
        let mut taken: HashSet<String> = self.files.values().map(|p| resolution_key(p)).collect();
        let mut rows = HashMap::new();
        for database in self.databases.values_mut() {
            let Some(text) = content(&database.csv) else {
                continue;
            };
            let table = match parse_table(text, None) {
                Ok(table) => table,
                Err(error) => {
                    database.error = Some(error.to_string());
                    continue;
                }
            };
            database.kinds = (0..table.headers.len())
                .map(|column| column_kind(table.rows.iter().map(|row| row[column].as_str())))
                .collect();
            // Le pagine della cartella, col loro titolo: l'H1 che Notion
            // scrive in cima, o il nome pulito se manca.
            let folder = Layout::row_folder(&database.csv);
            let mut pages: Vec<(String, String, String)> = names
                .iter()
                .filter(|name| parent(name) == folder && has_extension(name, "md"))
                .map(|name| {
                    let clean = self.files.get(name).cloned().unwrap_or_default();
                    let stem = last(&clean).trim_end_matches(".md").to_string();
                    let title = content(name)
                        .and_then(heading)
                        .unwrap_or_else(|| stem.clone());
                    (name.clone(), title, stem)
                })
                .collect();
            pages.sort();
            let mut free: Vec<bool> = vec![true; pages.len()];
            let mut page_of_row = Vec::with_capacity(table.rows.len());
            for row in &table.rows {
                let title = row.first().map(|t| t.trim()).unwrap_or("");
                let safe = title_file_stem(title).unwrap_or_default();
                let found = (0..pages.len())
                    .find(|&i| free[i] && pages[i].1 == title)
                    .or_else(|| {
                        (0..pages.len()).find(|&i| {
                            free[i] && resolution_key(&pages[i].2) == resolution_key(&safe)
                        })
                    });
                if let Some(i) = found {
                    free[i] = false;
                }
                page_of_row.push(found.map(|i| pages[i].0.clone()));
            }
            let mut note_of_row = Vec::with_capacity(table.rows.len());
            for (index, (row, page)) in table.rows.iter().zip(&page_of_row).enumerate() {
                if let Some(page) = page {
                    rows.insert(page.clone(), (database.csv.clone(), index));
                    note_of_row.push(None);
                    continue;
                }
                let title = row.first().map(|t| t.trim()).unwrap_or("");
                let stem = title_file_stem(title).unwrap_or_else(|| format!("row {}", index + 1));
                let mut path = join(&database.folder, &format!("{stem}.md"));
                let mut n = 2;
                while !taken.insert(resolution_key(&path)) {
                    path = join(&database.folder, &format!("{stem} {n}.md"));
                    n += 1;
                }
                note_of_row.push(Some(path));
            }
            database.table = Some(table);
            database.page_of_row = page_of_row;
            database.note_of_row = note_of_row;
        }
        self.rows = rows;
    }

    /// Il path pulito di una voce file dell'archivio.
    pub(crate) fn target(&self, name: &str) -> String {
        self.files.get(name).cloned().unwrap_or_else(|| {
            name.split('/')
                .enumerate()
                .map(|(i, c)| clean_component(c, i + 1 == name.split('/').count()))
                .collect::<Vec<_>>()
                .join("/")
        })
    }

    /// Le righe sostituite dal nome pulito: lo si dice una volta nel rapporto.
    pub(crate) fn renamed(&self) -> usize {
        self.renamed
    }

    pub(crate) fn is_database(&self, name: &str) -> bool {
        self.databases.contains_key(name)
    }

    /// Il CSV di un database: le note delle righe senza pagina e il rapporto.
    pub(crate) fn database(&self, name: &str) -> Option<DatabaseEntry> {
        let database = self.databases.get(name)?;
        let shown = self.target(name);
        if let Some(error) = &database.error {
            return Some(DatabaseEntry {
                notes: Vec::new(),
                info: Vec::new(),
                warnings: vec![format!(
                    "Notion database `{shown}` kept as a file, its rows did not become notes: {error}"
                )],
            });
        }
        let Some(table) = &database.table else {
            return Some(DatabaseEntry {
                notes: Vec::new(),
                info: Vec::new(),
                warnings: vec![format!(
                    "Notion database `{shown}` kept as a file, its rows did not become notes: it is not UTF-8 text"
                )],
            });
        };
        let mut notes = Vec::new();
        for (index, path) in database.note_of_row.iter().enumerate() {
            let Some(path) = path else { continue };
            let row = &table.rows[index];
            let title = row.first().map(|t| t.trim()).unwrap_or("");
            let (front, sections) = properties(table, &database.kinds, row);
            let mut body = format!("# {}\n", heading_text(title));
            for section in sections {
                body.push('\n');
                body.push_str(&section);
            }
            notes.push(RowNote {
                path: path.clone(),
                markdown: format!("{front}{body}"),
                line: table.lines.get(index).copied().unwrap_or(index + 2),
            });
        }
        let joined = database.page_of_row.iter().filter(|p| p.is_some()).count();
        let mut info = vec![format!(
            "Notion database `{shown}`: {} rows, {joined} joined with their page, {} from the CSV alone; the CSV stays as a file",
            table.rows.len(),
            notes.len()
        )];
        let typed = |kind: Kind| {
            table
                .headers
                .iter()
                .zip(&database.kinds)
                .skip(1)
                .filter(|(_, k)| **k == kind)
                .map(|(h, _)| format!("`{h}`"))
                .collect::<Vec<_>>()
        };
        for (kind, words) in [
            (Kind::Number, "numbers"),
            (Kind::Date, "dates"),
            (Kind::Bool, "true/false"),
        ] {
            let columns = typed(kind);
            if !columns.is_empty() {
                info.push(format!(
                    "Notion database `{shown}`: columns read as {words}: {}",
                    columns.join(", ")
                ));
            }
        }
        Some(DatabaseEntry {
            notes,
            info,
            warnings: Vec::new(),
        })
    }

    /// Una pagina Markdown dell'export: i link seguono i nomi puliti, i
    /// callout diventano richiami e una pagina riga prende le sue proprietà.
    pub(crate) fn page(&self, name: &str, text: &str) -> Converted {
        let mut warnings = Vec::new();
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let body = self.rewrite_links(name, text);
        let body = asides(&body, &mut warnings);
        let markdown = match self.rows.get(name) {
            Some((csv, index)) => {
                let database = &self.databases[csv];
                let table = database
                    .table
                    .as_ref()
                    .expect("a row comes from a read table");
                let row = &table.rows[*index];
                let (front, sections) = properties(table, &database.kinds, row);
                let mut body = without_property_lines(&body, &table.headers, row);
                for section in sections {
                    if !body.ends_with("\n\n") {
                        body.push_str(if body.ends_with('\n') { "\n" } else { "\n\n" });
                    }
                    body.push_str(&section);
                }
                format!("{front}{body}")
            }
            None => body,
        };
        Converted { markdown, warnings }
    }

    /// I link Markdown relativi che portano a una voce dell'export puntano al
    /// suo nome pulito, relativo alla pagina nella sua cartella nuova.
    fn rewrite_links(&self, from: &str, text: &str) -> String {
        let from_dir = parent(from);
        let new_dir = parent(&self.target(from)).to_string();
        let mut out = String::with_capacity(text.len());
        let mut fence: Option<String> = None;
        for line in text.split_inclusive('\n') {
            let trimmed = line.trim_start();
            if let Some(open) = &fence {
                if trimmed.starts_with(open.as_str()) {
                    fence = None;
                }
                out.push_str(line);
                continue;
            }
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                let mark = trimmed.chars().next().unwrap_or('`');
                fence = Some(trimmed.chars().take_while(|c| *c == mark).collect());
                out.push_str(line);
                continue;
            }
            out.push_str(&self.rewrite_line(line, from_dir, &new_dir));
        }
        out
    }

    fn rewrite_line(&self, line: &str, from_dir: &str, new_dir: &str) -> String {
        let mut out = String::with_capacity(line.len());
        let mut rest = line;
        while let Some(at) = rest.find("](") {
            out.push_str(&rest[..at + 2]);
            rest = &rest[at + 2..];
            let Some((dest, len)) = destination(rest) else {
                continue;
            };
            match self.relink(dest, from_dir, new_dir) {
                Some(new) => out.push_str(&new),
                None => out.push_str(&rest[..len]),
            }
            rest = &rest[len..];
        }
        out.push_str(rest);
        out
    }

    /// Il link nuovo di `dest`, o `None` se resta com'è (un URL, un'ancora,
    /// un path che non è dell'export e non ha id).
    fn relink(&self, dest: &str, from_dir: &str, new_dir: &str) -> Option<String> {
        let inner = dest
            .strip_prefix('<')
            .and_then(|d| d.strip_suffix('>'))
            .unwrap_or(dest);
        if inner.is_empty() || inner.starts_with(['#', '/']) || inner.contains(':') {
            return None;
        }
        let (path, fragment) = match inner.split_once('#') {
            Some((path, fragment)) => (path, Some(fragment)),
            None => (inner, None),
        };
        let decoded = percent_decode(path);
        let resolved = normalize(&join(from_dir, &decoded))?;
        let target = match self.files.get(&resolved) {
            Some(clean) => clean.clone(),
            None => match self.dirs.get(&resolved) {
                Some(clean) => clean.clone(),
                None => {
                    // Un file di un'altra parte dell'archivio: lo stesso nome
                    // senza id, che è quello che riceverà.
                    let components: Vec<&str> = decoded.split('/').collect();
                    let count = components.len();
                    let cleaned: Vec<String> = components
                        .iter()
                        .enumerate()
                        .map(|(i, c)| clean_component(c, i + 1 == count))
                        .collect();
                    if cleaned.iter().zip(&components).all(|(a, b)| a == b) {
                        return None;
                    }
                    let relative = cleaned.join("/");
                    return Some(link_text(&relative, fragment));
                }
            },
        };
        Some(link_text(&relative_path(new_dir, &target), fragment))
    }
}

fn is_export_root(top: &str) -> bool {
    let Some(rest) = top.strip_prefix("Export-") else {
        return false;
    };
    let hex: String = rest.chars().filter(|c| *c != '-').collect();
    is_notion_id(&hex) && rest.len() == 36
}

/// La destinazione di un link che comincia subito dopo `](`: il testo e
/// quanti byte occupa. Le parentesi annidate e la forma `<…>` contano.
fn destination(rest: &str) -> Option<(&str, usize)> {
    if rest.starts_with('<') {
        let end = rest.find('>')?;
        return Some((&rest[..=end], end + 1));
    }
    let mut depth = 0usize;
    for (i, c) in rest.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return Some((&rest[..i], i)),
            ')' => depth -= 1,
            ' ' | '\t' | '\n' if depth == 0 => return Some((&rest[..i], i)),
            _ => {}
        }
    }
    None
}

/// Un path relativo con `.` e `..` risolti; `None` se esce dalla radice.
fn normalize(path: &str) -> Option<String> {
    let mut out: Vec<&str> = Vec::new();
    for component in path.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                out.pop()?;
            }
            other => out.push(other),
        }
    }
    Some(out.join("/"))
}

/// Il path di `target` visto dalla cartella `dir` (entrambi dalla radice).
fn relative_path(dir: &str, target: &str) -> String {
    let from: Vec<&str> = dir.split('/').filter(|c| !c.is_empty()).collect();
    let to: Vec<&str> = target.split('/').filter(|c| !c.is_empty()).collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - common];
    parts.extend(&to[common..]);
    parts.join("/")
}

/// La destinazione scritta: gli spazi e i caratteri che chiuderebbero il link
/// in percentuale, come li scrive Notion; il resto com'è.
fn link_text(path: &str, fragment: Option<&str>) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '%' => out.push_str("%25"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            c => out.push(c),
        }
    }
    if let Some(fragment) = fragment {
        out.push('#');
        out.push_str(fragment);
    }
    out
}

/// Il titolo di una pagina di Notion: il primo `# ` in cima.
fn heading(text: &str) -> Option<String> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .find(|line| !line.trim().is_empty())
        .and_then(|line| line.strip_prefix("# "))
        .map(|title| title.trim().to_string())
}

/// Un titolo come testo di un H1: i caratteri che diventerebbero sintassi si
/// proteggono.
fn heading_text(title: &str) -> String {
    let escaped = crate::notion::escape(title);
    if escaped.is_empty() {
        "\\#".into()
    } else {
        escaped
    }
}

/// Il tipo di una colonna: quello che **ogni** valore non vuoto legge.
fn column_kind<'a>(values: impl Iterator<Item = &'a str>) -> Kind {
    let mut kinds = [true; 3];
    let mut any = false;
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        any = true;
        kinds[0] &= number(value).is_some();
        kinds[1] &= notion_date(value).is_some();
        kinds[2] &= matches!(value, "Yes" | "No");
    }
    match (any, kinds) {
        (false, _) => Kind::Text,
        (true, [true, _, _]) => Kind::Number,
        (true, [_, true, _]) => Kind::Date,
        (true, [_, _, true]) => Kind::Bool,
        _ => Kind::Text,
    }
}

/// Un numero scritto col punto, senza zeri in testa né separatori delle
/// migliaia, che un `f64` tiene senza perdite. `007` e `1,500` restano testo.
fn number(value: &str) -> Option<&str> {
    let digits = value.strip_prefix('-').unwrap_or(value);
    let (whole, fraction) = match digits.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (digits, None),
    };
    let plain = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let ok = plain(whole)
        && (whole == "0" || !whole.starts_with('0'))
        && fraction.is_none_or(plain)
        && whole.len() + fraction.map_or(0, str::len) <= 15;
    ok.then_some(value)
}

const MONTHS: [&str; 12] = [
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

/// Una data come la scrive Notion nel CSV, in ISO: `December 8, 2026` →
/// `2026-12-08`, `December 8, 2026 3:05 PM` → `2026-12-08T15:05`. Una data
/// già ISO resta com'è. Un intervallo (`… → …`) non è una data.
fn notion_date(value: &str) -> Option<String> {
    if value.len() == 10 && value.as_bytes()[4] == b'-' && value.as_bytes()[7] == b'-' {
        let year = value[..4].parse().ok()?;
        let month = value[5..7].parse().ok()?;
        let day = value[8..10].parse().ok()?;
        return valid_civil_date(year, month, day).then(|| value.to_string());
    }
    let (month_name, rest) = value.split_once(' ')?;
    let month = MONTHS.iter().position(|m| *m == month_name)? as u8 + 1;
    let (day, rest) = rest.split_once(", ")?;
    if day.is_empty() || day.len() > 2 || !day.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let day: u8 = day.parse().ok()?;
    let (year, time) = match rest.split_once(' ') {
        Some((year, time)) => (year, Some(time)),
        None => (rest, None),
    };
    if year.len() != 4 || !year.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i32 = year.parse().ok()?;
    if !valid_civil_date(year, month, day) {
        return None;
    }
    let date = format!("{year:04}-{month:02}-{day:02}");
    let Some(time) = time else {
        return Some(date);
    };
    let (clock, half) = match time.rsplit_once(' ') {
        Some((clock, half @ ("AM" | "PM"))) => (clock, Some(half)),
        Some(_) => return None,
        None => (time, None),
    };
    let (hour, minute) = clock.split_once(':')?;
    let digits = |s: &str, max: usize| {
        !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit())
    };
    if !digits(hour, 2) || minute.len() != 2 || !digits(minute, 2) {
        return None;
    }
    let mut hour: u8 = hour.parse().ok()?;
    let minute: u8 = minute.parse().ok()?;
    match half {
        Some(half) => {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour %= 12;
            if half == "PM" {
                hour += 12;
            }
        }
        None if hour > 23 => return None,
        None => {}
    }
    if minute > 59 {
        return None;
    }
    Some(format!("{date}T{hour:02}:{minute:02}"))
}

/// Il frontmatter di una riga e le celle che vanno nel corpo (lunghe o su più
/// righe, come per ogni CSV). La prima colonna è il titolo: sta nel nome del
/// file e nell'H1, non fra le proprietà.
fn properties(table: &CsvTable, kinds: &[Kind], row: &[String]) -> (String, Vec<String>) {
    let mut front = String::new();
    let mut sections = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (column, header) in table.headers.iter().enumerate().skip(1) {
        let cell = row.get(column).map(String::as_str).unwrap_or("");
        let value = cell.trim();
        if value.is_empty() {
            continue;
        }
        let mut key = if header.is_empty() {
            format!("col_{column}")
        } else {
            header.clone()
        };
        let mut n = 2;
        while !seen.insert(resolution_key(&key)) {
            key = format!("{header}_{n}");
            n += 1;
        }
        if cell.contains('\n') || cell.contains('\r') || cell.len() > 500 {
            sections.push(format!("## {key}\n\n{cell}\n"));
            continue;
        }
        let written = match kinds.get(column).copied().unwrap_or(Kind::Text) {
            Kind::Number => number(value).map(str::to_string),
            Kind::Date => notion_date(value),
            Kind::Bool => Some(if value == "Yes" { "true" } else { "false" }.to_string()),
            Kind::Text => None,
        }
        .unwrap_or_else(|| text_scalar(cell));
        front.push_str(&format!("{}: {written}\n", yaml_key(&key)));
    }
    let front = if front.is_empty() {
        String::new()
    } else {
        format!("---\n{front}---\n\n")
    };
    (front, sections)
}

/// Un testo come valore YAML che torna identico: le virgolette quando un `#`
/// o un carattere di controllo cambierebbero la lettura.
fn text_scalar(raw: &str) -> String {
    if raw.contains('#') || raw.chars().any(char::is_control) {
        serde_json::to_string(raw).expect("UTF-8 string is JSON-serializable")
    } else {
        yaml_scalar(raw)
    }
}

/// Le righe `Chiave: valore` che Notion scrive sotto il titolo di una pagina
/// riga (o in cima, prima del titolo), quando ripetono una colonna del CSV
/// col suo stesso valore: ora sono proprietà. Una riga che dice altro resta
/// nel corpo, e un paragrafo che non è fatto solo di `Chiave: valore` non si
/// tocca.
fn without_property_lines(body: &str, headers: &[String], row: &[String]) -> String {
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let Some(first) = lines.iter().position(|l| !l.trim().is_empty()) else {
        return body.to_string();
    };
    let mut start = first;
    if lines[first].starts_with("# ") {
        start += 1;
        while start < lines.len() && lines[start].trim().is_empty() {
            start += 1;
        }
    }
    let end = (start..lines.len())
        .find(|&i| lines[i].trim().is_empty())
        .unwrap_or(lines.len());
    let block = &lines[start..end];
    if block.is_empty() || !block.iter().all(|line| line.contains(": ")) {
        return body.to_string();
    }
    let kept: Vec<&str> = block
        .iter()
        .copied()
        .filter(|line| {
            let (key, value) = line.split_once(": ").expect("checked above");
            headers
                .iter()
                .position(|h| h == key.trim())
                .and_then(|column| row.get(column))
                .is_none_or(|cell| cell.trim() != value.trim())
        })
        .collect();
    let mut out: String = lines[..start].concat();
    out.push_str(&kept.concat());
    let mut rest = end;
    if kept.is_empty() {
        while rest < lines.len() && lines[rest].trim().is_empty() {
            rest += 1;
        }
    }
    out.push_str(&lines[rest..].concat());
    out
}

/// `<aside>…</aside>` (il callout dell'export) diventa `> [!note]`, col testo
/// citato. Un `<aside>` senza chiusura resta com'è, e lo si dice.
fn asides(text: &str, warnings: &mut Vec<String>) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let Some(first) = line.trim().strip_prefix("<aside>") else {
            out.push_str(line);
            i += 1;
            continue;
        };
        let mut inner: Vec<String> = Vec::new();
        let mut j = i;
        let mut current = first.to_string();
        let closed = loop {
            if let Some(before) = current.trim_end().strip_suffix("</aside>") {
                inner.push(before.trim_end().to_string());
                break true;
            }
            inner.push(current.trim_end().to_string());
            j += 1;
            if j >= lines.len() {
                break false;
            }
            current = lines[j].trim_end_matches(['\n', '\r']).to_string();
        };
        if !closed {
            warnings.push("a Notion callout (`<aside>`) has no end: kept as written".into());
            out.push_str(line);
            i += 1;
            continue;
        }
        while inner.first().is_some_and(|l| l.trim().is_empty()) {
            inner.remove(0);
        }
        while inner.last().is_some_and(|l| l.trim().is_empty()) {
            inner.pop();
        }
        out.push_str("> [!note]");
        for content in &inner {
            out.push('\n');
            if content.trim().is_empty() {
                out.push('>');
            } else {
                out.push_str("> ");
                out.push_str(content);
            }
        }
        out.push('\n');
        i = j + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID_A: &str = "0123456789abcdef0123456789abcdef";
    const ID_B: &str = "fedcba9876543210fedcba9876543210";

    #[test]
    fn the_id_leaves_the_name_and_same_titles_get_a_number() {
        let names = [
            format!("Note {ID_A}.md"),
            format!("Note {ID_B}.md"),
            format!("Note {ID_B}/Figlia {ID_A}.md"),
            "figura.png".to_string(),
        ];
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let layout = Layout::detect(&refs).expect("a Notion export");
        assert_eq!(layout.target(&names[0]), "Note.md");
        assert_eq!(layout.target(&names[1]), "Note 2.md");
        assert_eq!(layout.target(&names[2]), "Note 2/Figlia.md");
        assert_eq!(layout.target(&names[3]), "figura.png");
    }

    #[test]
    fn an_archive_without_ids_is_not_notion() {
        assert!(Layout::detect(&["a/b.md", "c.csv"]).is_none());
    }

    #[test]
    fn the_export_root_folder_goes_away() {
        let names = [
            format!("Export-3e9d1f0a-7b2c-4d6e-8f10-a5b6c7d8e9f0/Pagina {ID_A}.md"),
            "Export-3e9d1f0a-7b2c-4d6e-8f10-a5b6c7d8e9f0/foto.png".to_string(),
        ];
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let layout = Layout::detect(&refs).unwrap();
        assert_eq!(layout.target(&names[0]), "Pagina.md");
        assert_eq!(layout.target(&names[1]), "foto.png");
    }

    #[test]
    fn notion_dates_become_iso_and_anything_else_stays_out() {
        assert_eq!(
            notion_date("December 8, 2026").as_deref(),
            Some("2026-12-08")
        );
        assert_eq!(
            notion_date("October 2, 2026 3:05 PM").as_deref(),
            Some("2026-10-02T15:05")
        );
        assert_eq!(
            notion_date("October 2, 2026 12:00 AM").as_deref(),
            Some("2026-10-02T00:00")
        );
        assert_eq!(notion_date("2026-11-28").as_deref(), Some("2026-11-28"));
        assert_eq!(notion_date("February 30, 2026"), None);
        assert_eq!(notion_date("December 8, 2026 → December 9, 2026"), None);
        assert_eq!(notion_date("8 dicembre 2026"), None);
    }

    #[test]
    fn a_column_is_typed_only_when_every_value_reads() {
        assert_eq!(column_kind(["450", "", "12.5"].into_iter()), Kind::Number);
        assert_eq!(column_kind(["450", "n/d"].into_iter()), Kind::Text);
        assert_eq!(column_kind(["007"].into_iter()), Kind::Text);
        assert_eq!(column_kind(["1,500"].into_iter()), Kind::Text);
        assert_eq!(
            column_kind(["December 8, 2026", "2026-01-02"].into_iter()),
            Kind::Date
        );
        assert_eq!(column_kind(["Yes", "No"].into_iter()), Kind::Bool);
        assert_eq!(column_kind(["", ""].into_iter()), Kind::Text);
    }

    #[test]
    fn an_aside_becomes_a_note_callout() {
        let mut warnings = Vec::new();
        let out = asides(
            "Prima\n\n<aside>\n💡 Qui le specifiche.\n\nSeconda riga.\n</aside>\n\nDopo\n",
            &mut warnings,
        );
        assert_eq!(
            out,
            "Prima\n\n> [!note]\n> 💡 Qui le specifiche.\n>\n> Seconda riga.\n\nDopo\n"
        );
        assert!(warnings.is_empty());
        let open = asides("<aside>\nsenza fine\n", &mut warnings);
        assert_eq!(open, "<aside>\nsenza fine\n");
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn links_follow_the_clean_names_from_their_folder() {
        let names = [
            format!("Home {ID_A}.md"),
            format!("Home {ID_A}/Figlia {ID_B}.md"),
        ];
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let layout = Layout::detect(&refs).unwrap();
        let home = layout.page(
            &names[0],
            &format!(
                "[Figlia](Home%20{ID_A}/Figlia%20{ID_B}.md#parte) [sito](https://example.com/a%20b) [altrove](Altro%20{ID_B}.md)\n```\n[x](Home%20{ID_A}/Figlia%20{ID_B}.md)\n```\n"
            ),
        );
        assert_eq!(
            home.markdown,
            format!(
                "[Figlia](Home/Figlia.md#parte) [sito](https://example.com/a%20b) [altrove](Altro.md)\n```\n[x](Home%20{ID_A}/Figlia%20{ID_B}.md)\n```\n"
            )
        );
        let child = layout.page(&names[1], &format!("[su](../Home%20{ID_A}.md)\n"));
        assert_eq!(child.markdown, "[su](../Home.md)\n");
    }

    #[test]
    fn property_lines_that_repeat_the_csv_leave_the_body() {
        let headers = vec!["Nome".to_string(), "Stato".to_string(), "Nota".to_string()];
        let row = vec!["A".to_string(), "Fatto".to_string(), "x".to_string()];
        assert_eq!(
            without_property_lines(
                "# A\n\nStato: Fatto\nNota: diversa\n\nTesto\n",
                &headers,
                &row
            ),
            "# A\n\nNota: diversa\n\nTesto\n"
        );
        assert_eq!(
            without_property_lines("# A\n\nStato: Fatto\n\nTesto\n", &headers, &row),
            "# A\n\nTesto\n"
        );
        assert_eq!(
            without_property_lines("Stato: Fatto\n\n# A\n\nTesto\n", &headers, &row),
            "# A\n\nTesto\n"
        );
        // Un paragrafo che non è un elenco di proprietà resta intero.
        assert_eq!(
            without_property_lines("# A\n\nStato: Fatto\nil resto\n", &headers, &row),
            "# A\n\nStato: Fatto\nil resto\n"
        );
    }
}
