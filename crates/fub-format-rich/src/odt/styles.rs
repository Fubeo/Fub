//! Gli stili di un OpenDocument, quanto basta per vedere il documento come lo
//! vede chi legge: l'enfasi risolta di un tratto, l'allineamento e il ruolo di
//! un paragrafo, la specie di un elenco.
//!
//! Gli stili automatici di `content.xml` vengono prima di quelli comuni di
//! `styles.xml`, come in ogni lettore ODF. Una catena di stili genitori è
//! seguita fino in cima, con un limite di profondità contro i cicli.

use std::collections::{BTreeSet, HashMap};

use super::xml::{Element, Tree};
use crate::projection::{Align, Mark};

/// Le profondità oltre cui una catena di stili si considera un ciclo.
const MAX_CHAIN: usize = 32;

/// L'enfasi che uno stile scrive: `None` dove eredita.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TextProps {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub highlight: Option<bool>,
    pub position: Option<Position>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Position {
    Baseline,
    Super,
    Sub,
}

impl TextProps {
    fn over(&mut self, top: &TextProps) {
        self.bold = top.bold.or(self.bold);
        self.italic = top.italic.or(self.italic);
        self.underline = top.underline.or(self.underline);
        self.strike = top.strike.or(self.strike);
        self.highlight = top.highlight.or(self.highlight);
        self.position = top.position.or(self.position);
    }

    pub fn marks(&self) -> Vec<Mark> {
        let mut out = Vec::new();
        let on = |v: Option<bool>| v == Some(true);
        if on(self.bold) {
            out.push(Mark::B);
        }
        if on(self.italic) {
            out.push(Mark::I);
        }
        if on(self.underline) {
            out.push(Mark::U);
        }
        if on(self.strike) {
            out.push(Mark::S);
        }
        if on(self.highlight) {
            out.push(Mark::H);
        }
        match self.position {
            Some(Position::Super) => out.push(Mark::Sup),
            Some(Position::Sub) => out.push(Mark::Sub),
            _ => {}
        }
        out
    }

    fn read(props: &Element) -> TextProps {
        let attr = |name: &str| props.attr(name).map(str::trim);
        let bold = attr("fo:font-weight").map(|w| match w {
            "bold" | "bolder" => true,
            "normal" | "lighter" => false,
            n => n.parse::<u32>().is_ok_and(|n| n >= 600),
        });
        let italic = attr("fo:font-style").map(|s| matches!(s, "italic" | "oblique"));
        let underline = attr("style:text-underline-style").map(|s| s != "none");
        let strike = match attr("style:text-line-through-type") {
            Some("none") => Some(false),
            _ => attr("style:text-line-through-style").map(|s| s != "none"),
        };
        let highlight = attr("fo:background-color").map(|c| c != "transparent");
        let position = attr("style:text-position").map(|p| {
            let first = p.split_whitespace().next().unwrap_or("");
            match first {
                "super" => Position::Super,
                "sub" => Position::Sub,
                n => match n.trim_end_matches('%').parse::<f64>() {
                    Ok(v) if v > 0.0 => Position::Super,
                    Ok(v) if v < 0.0 => Position::Sub,
                    _ => Position::Baseline,
                },
            }
        });
        TextProps {
            bold,
            italic,
            underline,
            strike,
            highlight,
            position,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Def {
    pub parent: Option<String>,
    pub text: TextProps,
    pub align: Option<Align>,
    pub list_style: Option<String>,
    pub outline_level: Option<u8>,
    /// Uno stile automatico di `content.xml`.
    pub automatic: bool,
}

/// La specie di un livello d'elenco.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LevelKind {
    Number,
    /// Un numero senza cifre (`style:num-format=""`): il paragrafo non mostra
    /// niente.
    Unnumbered,
    Bullet,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Styles {
    styles: HashMap<(String, String), Def>,
    defaults: HashMap<String, Def>,
    lists: HashMap<String, HashMap<u8, LevelKind>>,
    /// Ogni nome di stile dei due file, di qualunque famiglia.
    pub names: BTreeSet<String>,
    pub lang: Option<String>,
}

impl Styles {
    pub fn read(content: &Tree, styles: Option<&Tree>) -> Styles {
        let mut out = Styles::default();
        // Prima i comuni, poi gli automatici, che li coprono.
        if let Some(tree) = styles {
            if let Some(common) = tree.child(tree.root, "office:styles") {
                out.collect(tree, common, false);
            }
            out.names_of(tree, tree.root);
        }
        if let Some(auto) = content.child(content.root, "office:automatic-styles") {
            out.collect(content, auto, true);
        }
        out.names_of(content, content.root);
        out
    }

    fn names_of(&mut self, tree: &Tree, root: usize) {
        let mut todo = vec![root];
        while let Some(id) = todo.pop() {
            if let Some(element) = tree.element(id) {
                if let Some(name) = element.attr("style:name") {
                    self.names.insert(name.to_string());
                }
                todo.extend(element.children.iter().copied());
            }
        }
    }

    fn collect(&mut self, tree: &Tree, container: usize, automatic: bool) {
        for (id, element) in tree.elements(container) {
            match element.name.as_str() {
                "style:style" | "style:default-style" => {
                    let family = element.attr("style:family").unwrap_or("").to_string();
                    let mut def = Def {
                        parent: element.attr("style:parent-style-name").map(str::to_string),
                        list_style: element.attr("style:list-style-name").map(str::to_string),
                        outline_level: element
                            .attr("style:default-outline-level")
                            .and_then(|l| l.trim().parse().ok()),
                        automatic,
                        ..Def::default()
                    };
                    for (_, props) in tree.elements(id) {
                        match props.name.as_str() {
                            "style:text-properties" => {
                                def.text = TextProps::read(props);
                                if element.name == "style:default-style" && family == "paragraph" {
                                    self.lang = lang(props);
                                }
                            }
                            "style:paragraph-properties" => {
                                def.align = props.attr("fo:text-align").and_then(align);
                            }
                            _ => {}
                        }
                    }
                    if element.name == "style:default-style" {
                        self.defaults.insert(family, def);
                    } else if let Some(name) = element.attr("style:name") {
                        self.styles.insert((family, name.to_string()), def);
                    }
                }
                "text:list-style" => {
                    let Some(name) = element.attr("style:name") else {
                        continue;
                    };
                    let mut levels = HashMap::new();
                    for (_, level) in tree.elements(id) {
                        let Some(n) = level.attr("text:level").and_then(|l| l.parse::<u8>().ok())
                        else {
                            continue;
                        };
                        let kind = match level.name.as_str() {
                            "text:list-level-style-number" => {
                                if level.attr("style:num-format").is_some_and(str::is_empty) {
                                    LevelKind::Unnumbered
                                } else {
                                    LevelKind::Number
                                }
                            }
                            _ => LevelKind::Bullet,
                        };
                        levels.insert(n, kind);
                    }
                    self.lists.insert(name.to_string(), levels);
                }
                _ => {}
            }
        }
    }

    pub fn get(&self, family: &str, name: &str) -> Option<&Def> {
        self.styles.get(&(family.to_string(), name.to_string()))
    }

    /// Lo stile e i suoi genitori, dalla foglia alla radice.
    pub fn chain(&self, family: &str, name: Option<&str>) -> Vec<(&str, &Def)> {
        let mut out = Vec::new();
        let mut next = name;
        while let Some(name) = next {
            if out.len() >= MAX_CHAIN {
                break;
            }
            let Some((key, def)) = self
                .styles
                .get_key_value(&(family.to_string(), name.to_string()))
            else {
                break;
            };
            out.push((key.1.as_str(), def));
            next = def.parent.as_deref();
        }
        out
    }

    /// L'enfasi di un testo nel paragrafo di stile `para`, dentro questi
    /// involucri (dal più esterno), ciascuno con i propri stili di tratto.
    pub fn text(&self, para: Option<&str>, wrappers: &[Vec<String>]) -> TextProps {
        let mut out = TextProps::default();
        if let Some(def) = self.defaults.get("paragraph") {
            out.over(&def.text);
        }
        for (_, def) in self.chain("paragraph", para).iter().rev() {
            out.over(&def.text);
        }
        for names in wrappers {
            for name in names {
                for (_, def) in self.chain("text", Some(name)).iter().rev() {
                    out.over(&def.text);
                }
            }
        }
        out
    }

    pub fn align(&self, para: Option<&str>) -> Option<Align> {
        self.chain("paragraph", para)
            .iter()
            .find_map(|(_, def)| def.align)
            .or_else(|| self.defaults.get("paragraph").and_then(|d| d.align))
    }

    /// Uno stile di citazione, o uno che ne eredita: `Quotations` è il nome
    /// che LibreOffice dà allo stile in ogni lingua.
    pub fn is_quote(&self, para: Option<&str>) -> bool {
        self.chain("paragraph", para)
            .iter()
            .any(|(name, _)| *name == "Quotations")
    }

    /// Lo stile d'elenco che un paragrafo di stile `para` porta con sé.
    pub fn para_list_style(&self, para: Option<&str>) -> Option<&str> {
        self.chain("paragraph", para)
            .iter()
            .find_map(|(_, def)| def.list_style.as_deref())
    }

    /// La specie del livello `level` (da 0) dello stile d'elenco `name`.
    pub fn level_kind(&self, name: Option<&str>, level: u8) -> LevelKind {
        name.and_then(|name| self.lists.get(name))
            .and_then(|levels| levels.get(&(level + 1)))
            .copied()
            .unwrap_or(LevelKind::Bullet)
    }

    /// Gli stili d'elenco, in ordine di nome: per scegliere quello da usare
    /// quando un paragrafo diventa voce d'elenco senza un elenco accanto.
    pub fn list_names(&self) -> Vec<&str> {
        let mut out: Vec<&str> = self.lists.keys().map(String::as_str).collect();
        out.sort_unstable();
        out
    }

    /// Lo stile comune del titolo di livello `level`: quello con il livello di
    /// struttura dato, preferendo il nome che gli dà LibreOffice.
    pub fn heading(&self, level: u8) -> Option<String> {
        let named = format!("Heading_20_{level}");
        if self
            .get("paragraph", &named)
            .is_some_and(|def| !def.automatic)
        {
            return Some(named);
        }
        let mut found: Vec<&str> = self
            .styles
            .iter()
            .filter(|((family, _), def)| {
                family == "paragraph" && !def.automatic && def.outline_level == Some(level)
            })
            .map(|((_, name), _)| name.as_str())
            .collect();
        found.sort_unstable();
        found.first().map(|name| name.to_string())
    }

    pub fn common(&self, family: &str, name: &str) -> bool {
        self.get(family, name).is_some_and(|def| !def.automatic)
    }

    /// Un nome di stile libero con questo prefisso.
    pub fn fresh(&mut self, prefix: &str) -> String {
        let mut n = 1;
        loop {
            let name = format!("{prefix}{n}");
            if self.names.insert(name.clone()) {
                return name;
            }
            n += 1;
        }
    }

    /// Registra uno stile scritto dal codec, perché le risoluzioni seguenti lo
    /// vedano.
    pub fn define(&mut self, family: &str, name: &str, def: Def) {
        self.names.insert(name.to_string());
        self.styles
            .insert((family.to_string(), name.to_string()), def);
    }

    /// Uno stile di tratto automatico già scritto dal codec con queste
    /// proprietà, da riusare invece di scriverne un altro uguale.
    pub fn find_text(&self, prefix: &str, props: &TextProps) -> Option<String> {
        let mut found: Vec<&str> = self
            .styles
            .iter()
            .filter(|((family, name), def)| {
                family == "text"
                    && name.starts_with(prefix)
                    && def.automatic
                    && def.parent.is_none()
                    && def.text == *props
            })
            .map(|((_, name), _)| name.as_str())
            .collect();
        found.sort_unstable();
        found.first().map(|name| name.to_string())
    }

    pub fn define_list(&mut self, name: &str, kind: LevelKind) {
        self.names.insert(name.to_string());
        self.lists
            .insert(name.to_string(), (1..=10).map(|l| (l, kind)).collect());
    }
}

fn lang(props: &Element) -> Option<String> {
    let language = props
        .attr("fo:language")
        .filter(|l| !l.is_empty() && *l != "zxx")?;
    match props
        .attr("fo:country")
        .filter(|c| !c.is_empty() && *c != "none")
    {
        Some(country) => Some(format!("{language}-{country}")),
        None => Some(language.to_string()),
    }
}

fn align(value: &str) -> Option<Align> {
    match value.trim() {
        "center" => Some(Align::Center),
        "end" | "right" => Some(Align::Right),
        "justify" => Some(Align::Justify),
        _ => None,
    }
}
