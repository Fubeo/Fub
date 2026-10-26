//! Gli stili di un OpenDocument, quanto basta per vedere il documento come lo
//! vede chi legge: l'enfasi risolta di un tratto, l'allineamento, la
//! disposizione e il ruolo di un paragrafo, la specie di un elenco.
//!
//! Gli stili automatici di `content.xml` vengono prima di quelli comuni di
//! `styles.xml`, come in ogni lettore ODF. Una catena di stili genitori è
//! seguita fino in cima, con un limite di profondità contro i cicli.

use std::collections::{BTreeSet, HashMap};

use super::xml::{Element, Tree};
use crate::projection::{self, Align, Layout, Line, Look, Mark};

/// Le profondità oltre cui una catena di stili si considera un ciclo.
const MAX_CHAIN: usize = 32;

/// L'enfasi e l'aspetto che uno stile scrive: `None` dove eredita.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TextProps {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub highlight: Option<bool>,
    pub position: Option<Position>,
    pub caps: Option<bool>,
    pub small_caps: Option<bool>,
    /// La famiglia del carattere.
    pub font: Option<String>,
    /// La dimensione in punti; una percentuale si risolve su quella ereditata.
    pub size: Option<Size>,
    /// `#rrggbb` minuscolo, o `auto`.
    pub color: Option<String>,
    /// Il colore dello sfondo, `#rrggbb` minuscolo, quando c'è.
    pub background: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Size {
    Points(f32),
    Percent(f32),
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
        self.caps = top.caps.or(self.caps);
        self.small_caps = top.small_caps.or(self.small_caps);
        if top.font.is_some() {
            self.font.clone_from(&top.font);
        }
        self.size = match (top.size, self.size) {
            (Some(Size::Percent(p)), Some(Size::Points(pt))) => Some(Size::Points(pt * p / 100.0)),
            (Some(size), _) => Some(size),
            (None, size) => size,
        };
        if top.color.is_some() {
            self.color.clone_from(&top.color);
        }
        if top.highlight.is_some() {
            self.background.clone_from(&top.background);
        }
    }

    /// I punti di una dimensione risolta; `None` se non è nota.
    pub fn points(&self) -> Option<f32> {
        match self.size {
            Some(Size::Points(pt)) => Some(pt),
            _ => None,
        }
    }

    /// Il carattere e la dimensione: la base di un paragrafo.
    pub fn base(&self) -> Look {
        Look {
            font: self.font.clone(),
            size: self.points(),
            ..Look::default()
        }
    }

    /// L'aspetto di questo testo dove differisce da quello di `plain`, il
    /// testo del suo paragrafo senza involucri.
    pub fn look(&self, plain: &TextProps) -> Look {
        let color = |p: &TextProps| {
            p.color
                .clone()
                .unwrap_or_else(|| projection::COLOR_AUTO.into())
        };
        let same_size = match (self.points(), plain.points()) {
            (Some(a), Some(b)) => projection::same_size(a, b),
            (a, b) => a.is_none() && b.is_none(),
        };
        Look {
            font: (self.font != plain.font)
                .then(|| self.font.clone())
                .flatten(),
            size: (!same_size).then(|| self.points()).flatten(),
            color: (color(self) != color(plain)).then(|| color(self)),
            hl: (self.highlight == Some(true))
                .then(|| self.background.clone())
                .flatten()
                .filter(|hex| hex != projection::HIGHLIGHT_DEFAULT),
        }
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
        if on(self.caps) {
            out.push(Mark::Caps);
        }
        if on(self.small_caps) {
            out.push(Mark::SmallCaps);
        }
        out
    }

    /// Le proprietà di `style:text-properties`. `faces` dà la famiglia di
    /// ogni carattere dichiarato, che `style:font-name` nomina.
    fn read(props: &Element, faces: &HashMap<String, String>) -> TextProps {
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
        let background = attr("fo:background-color");
        let highlight = background.map(|c| c != "transparent");
        let background = background.and_then(hex);
        let caps = attr("fo:text-transform").map(|t| t == "uppercase");
        let small_caps = attr("fo:font-variant").map(|v| v == "small-caps");
        let font = attr("fo:font-family")
            .map(unquote)
            .or_else(|| {
                attr("style:font-name")
                    .map(|name| faces.get(name).cloned().unwrap_or_else(|| name.to_string()))
            })
            .filter(|f| !f.is_empty());
        let size = attr("fo:font-size").and_then(|s| {
            if let Some(p) = s.strip_suffix('%') {
                return p.trim().parse().ok().map(Size::Percent);
            }
            length_points(s).map(Size::Points)
        });
        let color = if attr("style:use-window-font-color") == Some("true") {
            Some(projection::COLOR_AUTO.to_string())
        } else {
            attr("fo:color").and_then(hex)
        };
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
            caps,
            small_caps,
            font,
            size,
            color,
            background,
        }
    }
}

/// Una famiglia senza le virgolette che XSL ammette attorno al nome.
fn unquote(family: &str) -> String {
    family
        .trim()
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string()
}

/// Un colore `#rrggbb`, in minuscolo.
fn hex(value: &str) -> Option<String> {
    let digits = value.strip_prefix('#')?;
    (digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

/// Una lunghezza ODF in punti.
fn length_points(value: &str) -> Option<f32> {
    let value = value.trim();
    let split = value
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(value.len());
    let n: f32 = value[..split].trim().parse().ok()?;
    let per = match &value[split..] {
        "pt" => 1.0,
        "pc" => 12.0,
        "in" => 72.0,
        "cm" => 72.0 / 2.54,
        "mm" => 72.0 / 25.4,
        "px" => 0.75,
        _ => return None,
    };
    Some(n * per)
}

/// Rientri, spaziature e interlinea che uno stile scrive: `None` dove eredita.
/// Lunghezze in punti.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ParaProps {
    pub left: Option<f32>,
    pub right: Option<f32>,
    pub first: Option<f32>,
    pub before: Option<f32>,
    pub after: Option<f32>,
    pub line: Option<Line>,
}

impl ParaProps {
    fn over(&mut self, top: &ParaProps) {
        self.left = top.left.or(self.left);
        self.right = top.right.or(self.right);
        self.first = top.first.or(self.first);
        self.before = top.before.or(self.before);
        self.after = top.after.or(self.after);
        self.line = top.line.or(self.line);
    }

    /// Le proprietà di `style:paragraph-properties`. Una lunghezza in
    /// percentuale non si legge.
    fn read(props: &Element) -> ParaProps {
        let length = |name: &str| props.attr(name).and_then(length_points);
        let all = length("fo:margin");
        let line = match props.attr("fo:line-height").map(str::trim) {
            Some("normal") => Some(Line::Multiple(1.0)),
            Some(p) if p.ends_with('%') => p
                .trim_end_matches('%')
                .trim()
                .parse::<f32>()
                .ok()
                .map(|p| Line::Multiple(p / 100.0)),
            Some(l) => length_points(l).map(Line::Exactly),
            None => length("style:line-height-at-least").map(Line::AtLeast),
        };
        ParaProps {
            left: length("fo:margin-left").or(all),
            right: length("fo:margin-right").or(all),
            first: length("fo:text-indent"),
            before: length("fo:margin-top").or(all),
            after: length("fo:margin-bottom").or(all),
            line,
        }
    }

    /// Queste proprietà con i cambiamenti di `change` sopra.
    pub fn changed(&self, change: &ParaChange) -> ParaProps {
        ParaProps {
            left: change.left.unwrap_or(self.left),
            right: change.right.unwrap_or(self.right),
            first: change.first.unwrap_or(self.first),
            before: change.before.unwrap_or(self.before),
            after: change.after.unwrap_or(self.after),
            line: change.line.unwrap_or(self.line),
        }
    }
}

/// Un cambiamento della disposizione di uno stile automatico: per ogni campo
/// `Some` se cambia, col valore nuovo o `None` per ereditarlo.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ParaChange {
    pub align: Option<Option<Align>>,
    pub left: Option<Option<f32>>,
    pub right: Option<Option<f32>>,
    pub first: Option<Option<f32>>,
    pub before: Option<Option<f32>>,
    pub after: Option<Option<f32>>,
    pub line: Option<Option<Line>>,
}

impl ParaChange {
    pub fn is_empty(&self) -> bool {
        *self == ParaChange::default()
    }

    /// Nessun valore da scrivere: soltanto da togliere.
    pub fn only_clears(&self) -> bool {
        self.align.is_none_or(|a| a.is_none())
            && [self.left, self.right, self.first, self.before, self.after]
                .iter()
                .all(|c| c.is_none_or(|v| v.is_none()))
            && self.line.is_none_or(|l| l.is_none())
    }
}

/// Una lunghezza in punti come la scrive il codec: in punti, perché si
/// rilegge identica.
pub(crate) fn points(pt: f32) -> String {
    format!("{}pt", (pt * 100.0).round() / 100.0)
}

pub(crate) fn align_value(align: Align) -> &'static str {
    match align {
        Align::Left => "start",
        Align::Center => "center",
        Align::Right => "end",
        Align::Justify => "justify",
    }
}

/// La disposizione risolta di `full` dove differisce da quella di `plain`.
fn difference(full: &ParaProps, plain: &ParaProps) -> Layout {
    let length = |a: Option<f32>, b: Option<f32>| {
        let a = a.unwrap_or(0.0);
        (!projection::same_size(a, b.unwrap_or(0.0))).then_some(a)
    };
    let line = |l: Option<Line>| l.unwrap_or(Line::Multiple(1.0));
    Layout {
        left: length(full.left, plain.left),
        right: length(full.right, plain.right),
        first: length(full.first, plain.first),
        before: length(full.before, plain.before),
        after: length(full.after, plain.after),
        line: (!line(full.line).same(line(plain.line))).then(|| line(full.line)),
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Def {
    pub parent: Option<String>,
    pub text: TextProps,
    pub align: Option<Align>,
    pub para: ParaProps,
    /// Il nome da mostrare (`style:display-name`), quando non è il nome.
    pub display: Option<String>,
    /// `style:class`: `text`, `chapter`, `list`, `extra`, `index`, `html`.
    pub class: Option<String>,
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
    /// I caratteri dichiarati (`style:font-face`): nome → famiglia.
    faces: HashMap<String, String>,
}

impl Styles {
    pub fn read(content: &Tree, styles: Option<&Tree>) -> Styles {
        let mut out = Styles::default();
        for tree in styles.into_iter().chain([content]) {
            if let Some(decls) = tree.child(tree.root, "office:font-face-decls") {
                for (_, face) in tree.elements(decls) {
                    if let (Some(name), Some(family)) =
                        (face.attr("style:name"), face.attr("svg:font-family"))
                    {
                        out.faces.insert(name.to_string(), unquote(family));
                    }
                }
            }
        }
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
                        display: element.attr("style:display-name").map(str::to_string),
                        class: element.attr("style:class").map(str::to_string),
                        outline_level: element
                            .attr("style:default-outline-level")
                            .and_then(|l| l.trim().parse().ok()),
                        automatic,
                        ..Def::default()
                    };
                    for (_, props) in tree.elements(id) {
                        match props.name.as_str() {
                            "style:text-properties" => {
                                def.text = TextProps::read(props, &self.faces);
                                if element.name == "style:default-style" && family == "paragraph" {
                                    self.lang = lang(props);
                                }
                            }
                            "style:paragraph-properties" => {
                                def.align = props.attr("fo:text-align").and_then(align);
                                def.para = ParaProps::read(props);
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

    /// L'allineamento di un paragrafo di stile `para`; `None` a sinistra.
    pub fn align(&self, para: Option<&str>) -> Option<Align> {
        self.chain("paragraph", para)
            .iter()
            .find_map(|(_, def)| def.align)
            .or_else(|| self.defaults.get("paragraph").and_then(|d| d.align))
            .filter(|align| *align != Align::Left)
    }

    /// Rientri, spaziature e interlinea di un paragrafo di stile `para`.
    pub fn para(&self, para: Option<&str>) -> ParaProps {
        let mut out = ParaProps::default();
        if let Some(def) = self.defaults.get("paragraph") {
            out.over(&def.para);
        }
        for (_, def) in self.chain("paragraph", para).iter().rev() {
            out.over(&def.para);
        }
        out
    }

    /// Il primo stile comune della catena di `para`: quello che uno stile
    /// automatico, la formattazione diretta del paragrafo, deriva.
    pub fn common_of(&self, para: Option<&str>) -> Option<String> {
        self.chain("paragraph", para)
            .into_iter()
            .find(|(_, def)| !def.automatic)
            .map(|(name, _)| name.to_string())
    }

    /// La disposizione di un paragrafo di stile `para` dove differisce da
    /// quella del suo stile comune.
    pub fn layout(&self, para: Option<&str>) -> Layout {
        let common = self.common_of(para);
        difference(&self.para(para), &self.para(common.as_deref()))
    }

    /// L'aspetto dei titoli e delle citazioni, dagli stili che il salvataggio
    /// darebbe loro: quelli del documento, o quelli di LibreOffice che gli
    /// aggiungerebbe (`write::heading`).
    pub fn role_looks(&self) -> projection::RoleLooks {
        let plain = self.text(None, &[]).base();
        let h = (1..=9)
            .map(|level| match self.heading(level) {
                Some(name) => self.text(Some(&name), &[]).base(),
                None => Look {
                    size: plain.size.map(|size| size * heading_scale(level)),
                    ..plain.clone()
                },
            })
            .collect();
        let quote = if self.common("paragraph", "Quotations") {
            self.text(Some("Quotations"), &[]).base()
        } else {
            Look::default()
        };
        projection::RoleLooks::new(h, quote, Look::default())
    }

    /// Gli stili comuni di paragrafo da proporre a un paragrafo di corpo:
    /// quelli di testo e di capitolo, e quelli in uso, tranne titoli,
    /// citazioni e quelli che portano un elenco; in ordine di nome mostrato.
    pub fn gallery(&self, used: &BTreeSet<String>) -> Vec<projection::ParaStyle> {
        let mut out: Vec<projection::ParaStyle> = self
            .styles
            .iter()
            .filter(|((family, name), def)| {
                family == "paragraph"
                    && !def.automatic
                    && (matches!(def.class.as_deref(), Some("text" | "chapter"))
                        || used.contains(name))
                    && self.body_style(Some(name))
            })
            .map(|((_, name), def)| projection::ParaStyle {
                id: name.clone(),
                name: def
                    .display
                    .clone()
                    .unwrap_or_else(|| name.replace("_20_", " ")),
                f: self.text(Some(name), &[]).base(),
            })
            .collect();
        out.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        out
    }

    /// Uno stile che lascia un paragrafo nel corpo.
    pub fn body_style(&self, para: Option<&str>) -> bool {
        !self.is_quote(para)
            && self.para_list_style(para).is_none()
            && self
                .chain("paragraph", para)
                .iter()
                .all(|(_, def)| def.outline_level.is_none())
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

    /// Uno stile di paragrafo automatico già scritto dal codec con questo
    /// genitore e soltanto questa disposizione, da riusare.
    pub fn find_para(
        &self,
        prefix: &str,
        parent: Option<&str>,
        para: &ParaProps,
        align: Option<Align>,
    ) -> Option<String> {
        let mut found: Vec<&str> = self
            .styles
            .iter()
            .filter(|((family, name), def)| {
                family == "paragraph"
                    && name.starts_with(prefix)
                    && def.automatic
                    && def.parent.as_deref() == parent
                    && def.para == *para
                    && def.align == align
                    && def.text == TextProps::default()
                    && def.list_style.is_none()
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
        "start" | "left" => Some(Align::Left),
        "center" => Some(Align::Center),
        "end" | "right" => Some(Align::Right),
        "justify" => Some(Align::Justify),
        _ => None,
    }
}

/// Quanto il titolo di LibreOffice di livello `level` ingrandisce il testo,
/// come lo scrive `write::heading`.
pub(crate) fn heading_scale(level: u8) -> f32 {
    match level {
        1 => 1.30,
        2 => 1.15,
        3 => 1.01,
        4 => 0.95,
        _ => 0.85,
    }
}
