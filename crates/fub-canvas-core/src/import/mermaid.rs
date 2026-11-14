//! Il lettore di Mermaid: la parte di `flowchart` (o `graph`) che diventa una
//! lavagna. Si leggono l'intestazione col verso (`TD`, `TB`, `BT`, `LR`, `RL`),
//! i nodi con le loro forme, gli archi con le loro etichette, anche in catena e
//! con `&`, i `subgraph` (anche annidati, con `direction` dentro) e i commenti
//! `%%`. Ciò che una lavagna non tiene (una forma che non è un rettangolo, uno
//! stile, una riga `classDef`, `style`, `linkStyle`, `click`) diventa una nota;
//! una riga che non si capisce si salta, con una nota, e non cambia niente.
//! Le regole stanno in `docs/reference/canvas-import.md`.

use std::collections::HashMap;

use super::{
    lines, quote, End, ImportError, Notes, Sketch, SketchEdge, SketchGroup, SketchNode, MAX_DEPTH,
    MAX_IMPORTED, MAX_IMPORTED_EDGES,
};
use crate::layout::arrange::Direction;
use crate::ops::NoteCode;

/// Le forme di un nodo: il segno che apre, quelli che chiudono e il nome per la
/// nota. L'ordine conta: un segno più lungo si prova prima di quello che ne è
/// l'inizio. `None` come nome è il rettangolo, che la scheda tiene.
const SHAPES: &[(&str, &[&str], Option<&str>)] = &[
    ("(((", &[")))"], Some("double circle")),
    ("((", &["))"], Some("circle")),
    ("([", &["])"], Some("stadium")),
    ("[[", &["]]"], Some("subroutine")),
    ("[(", &[")]"], Some("cylinder")),
    ("[/", &["/]", "\\]"], Some("trapezoid")),
    ("[\\", &["\\]", "/]"], Some("trapezoid")),
    ("{{", &["}}"], Some("hexagon")),
    ("[", &["]"], None),
    ("(", &[")"], Some("rounded")),
    ("{", &["}"], Some("rhombus")),
    (">", &["]"], Some("asymmetric")),
];

/// Le parole che aprono una riga di soli stili: la riga si salta con una nota.
const STYLE_LINES: &[&str] = &["classDef", "class", "style", "linkStyle", "click"];

/// Legge un `flowchart`. Senza nodi è `Invalid`, con la prima riga che non si
/// capisce, se c'è.
pub(crate) fn read(text: &str) -> Result<Sketch, ImportError> {
    let mut reader = Reader::default();
    for (number, line) in lines(text) {
        for statement in statements(line) {
            reader.statement(number, line, statement.trim())?;
        }
    }
    if !reader.header {
        return Err(ImportError::Invalid(
            "the text has no `flowchart` or `graph` line".to_owned(),
        ));
    }
    reader.finish()
}

#[derive(Default)]
struct Reader {
    /// Se l'intestazione è già passata.
    header: bool,
    sketch: Sketch,
    notes: Notes,
    /// I nomi dei nodi e dei blocchi, ognuno col suo capo.
    names: HashMap<String, End>,
    /// Se un nodo ha avuto un testo scritto: il testo di serie è il nome.
    written: Vec<bool>,
    /// I blocchi aperti, il più dentro in fondo.
    open: Vec<usize>,
    /// Quanti elementi (schede e blocchi) finora: dà l'ordine.
    order: usize,
    /// La prima riga che non si capisce: il numero e la riga.
    first_bad: Option<(usize, String)>,
}

/// Un nodo come lo scrive un'istruzione: il nome, il testo e la forma, se ci
/// sono, e se ha una classe (`:::nome`).
struct NodeRef {
    name: String,
    text: Option<String>,
    shape: Option<&'static str>,
    class: bool,
}

/// Un arco come lo scrive un'istruzione.
struct Link {
    label: Option<String>,
    from_arrow: bool,
    to_arrow: bool,
    /// Lo stile che la lavagna non tiene (`dotted`, `thick`, una punta tonda…).
    style: Option<&'static str>,
    /// `~~~`: un arco invisibile, che non si disegna.
    invisible: bool,
}

impl Reader {
    fn statement(&mut self, number: usize, line: &str, statement: &str) -> Result<(), ImportError> {
        if statement.is_empty() || statement.starts_with("%%") {
            return Ok(());
        }
        let (word, rest) = split_word(statement);
        if !self.header {
            return self.header_line(number, line, word, rest);
        }
        match word {
            "subgraph" => self.subgraph(rest),
            "end" if rest.is_empty() => {
                if self.open.pop().is_none() {
                    self.skip(number, line);
                }
                Ok(())
            }
            "direction" if direction(rest).is_some() => {
                match self.open.last() {
                    Some(&group) => self.sketch.groups[group].direction = direction(rest),
                    None => self.sketch.direction = direction(rest),
                }
                Ok(())
            }
            word if STYLE_LINES.contains(&word) => {
                let what = if word == "click" {
                    "an action on click"
                } else {
                    "a style"
                };
                self.notes.push(
                    NoteCode::LineSkipped,
                    format!(
                        "line {number}: `{}` sets {what}, which a canvas does not keep",
                        quote(line)
                    ),
                );
                Ok(())
            }
            _ => match parse_chain(statement) {
                Some((groups, links)) => self.chain(number, groups, links),
                None => {
                    self.skip(number, line);
                    Ok(())
                }
            },
        }
    }

    /// La prima istruzione: `flowchart` o `graph`, col verso. Un altro diagramma
    /// non si legge.
    fn header_line(
        &mut self,
        number: usize,
        line: &str,
        word: &str,
        rest: &str,
    ) -> Result<(), ImportError> {
        if !matches!(word, "flowchart" | "graph" | "flowchart-elk") {
            return Err(ImportError::Invalid(format!(
                "from_mermaid reads only flowchart (or graph) diagrams, and line {number} is `{}`",
                quote(line)
            )));
        }
        self.header = true;
        let (way, after) = split_word(rest);
        if way.is_empty() {
            return Ok(());
        }
        match direction(way) {
            Some(found) => self.sketch.direction = Some(found),
            None => {
                self.notes.push(
                    NoteCode::LineSkipped,
                    format!("line {number}: the direction `{way}` is not TD, TB, BT, LR or RL: TB is used"),
                );
            }
        }
        if !after.is_empty() {
            return self.statement(number, line, after);
        }
        Ok(())
    }

    /// `subgraph id [titolo]`, `subgraph id`, `subgraph titolo con spazi` o
    /// `subgraph "titolo"`.
    fn subgraph(&mut self, rest: &str) -> Result<(), ImportError> {
        if self.open.len() >= MAX_DEPTH {
            return Err(ImportError::TooMany {
                what: "nested subgraphs",
                limit: MAX_DEPTH,
            });
        }
        self.room_for_one()?;
        let index = self.sketch.groups.len();
        let automatic = || format!("subGraph{index}");
        let rest = rest.trim();
        let (name, label) = if let Some(open) = rest.find('[').filter(|_| rest.ends_with(']')) {
            let name = rest[..open].trim();
            let title = text_of(&rest[open + 1..rest.len() - 1]);
            let name = if name.is_empty() || name.contains(char::is_whitespace) {
                automatic()
            } else {
                name.to_owned()
            };
            (name, title)
        } else if rest.starts_with('"') {
            (automatic(), text_of(rest))
        } else if rest.is_empty() {
            (automatic(), String::new())
        } else if rest.contains(char::is_whitespace) {
            (automatic(), rest.to_owned())
        } else {
            (rest.to_owned(), rest.to_owned())
        };
        let parent = self.open.last().copied();
        match self.names.get(&name) {
            Some(End::Group(_)) => {
                // Lo stesso id due volte: Mermaid apre un blocco nuovo, la
                // lavagna non può avere due id uguali.
                return Err(ImportError::Invalid(format!(
                    "the subgraph {name:?} is opened twice"
                )));
            }
            Some(End::Node(_)) | None => {}
        }
        self.names.insert(name.clone(), End::Group(index));
        self.sketch.groups.push(SketchGroup {
            name,
            label,
            parent,
            direction: None,
            order: self.order,
        });
        self.order += 1;
        self.open.push(index);
        Ok(())
    }

    /// Una catena di nodi e archi: `A --> B & C -- testo --> D`. I nodi si
    /// definiscono, poi ogni arco va da ogni nodo di un gruppo a ogni nodo del
    /// gruppo dopo.
    fn chain(
        &mut self,
        number: usize,
        groups: Vec<Vec<NodeRef>>,
        links: Vec<Link>,
    ) -> Result<(), ImportError> {
        let new_edges: usize = groups
            .windows(2)
            .zip(&links)
            .filter(|(_, link)| !link.invisible)
            .map(|(pair, _)| pair[0].len().saturating_mul(pair[1].len()))
            .fold(0_usize, usize::saturating_add);
        if self.sketch.edges.len().saturating_add(new_edges) > MAX_IMPORTED_EDGES {
            return Err(ImportError::TooMany {
                what: "edges in one import",
                limit: MAX_IMPORTED_EDGES,
            });
        }
        let mut ends: Vec<Vec<End>> = Vec::with_capacity(groups.len());
        for group in groups {
            let mut list = Vec::with_capacity(group.len());
            for node in group {
                list.push(self.node(number, node)?);
            }
            ends.push(list);
        }
        for (pair, link) in ends.windows(2).zip(links) {
            if let Some(style) = link.style {
                self.notes.push(
                    NoteCode::StyleDropped,
                    format!("line {number}: a {style} link is drawn as a plain line"),
                );
            }
            if link.invisible {
                continue;
            }
            for &from in &pair[0] {
                for &to in &pair[1] {
                    self.sketch.edges.push(SketchEdge {
                        from,
                        to,
                        label: link.label.clone(),
                        from_arrow: link.from_arrow,
                        to_arrow: link.to_arrow,
                    });
                }
            }
        }
        Ok(())
    }

    /// Il capo di un nodo nominato: nuovo, o quello che c'è col testo nuovo. Un
    /// nodo nominato per la prima volta dentro un blocco ci entra.
    fn node(&mut self, number: usize, node: NodeRef) -> Result<End, ImportError> {
        let end = match self.names.get(&node.name) {
            Some(&end) => end,
            None => {
                self.room_for_one()?;
                let index = self.sketch.nodes.len();
                self.sketch.nodes.push(SketchNode {
                    name: node.name.clone(),
                    text: node.name.clone(),
                    parent: None,
                    order: self.order,
                });
                self.written.push(false);
                self.order += 1;
                let end = End::Node(index);
                self.names.insert(node.name.clone(), end);
                end
            }
        };
        match end {
            End::Node(index) => {
                if self.sketch.nodes[index].parent.is_none() {
                    self.sketch.nodes[index].parent = self.open.last().copied();
                }
                if let Some(text) = node.text {
                    self.sketch.nodes[index].text = text;
                    self.written[index] = true;
                }
            }
            End::Group(_) => {
                if node.text.is_some() {
                    self.notes.push(
                        NoteCode::ShapeDropped,
                        format!(
                            "line {number}: {:?} is a subgraph, and its title stays the subgraph one",
                            node.name
                        ),
                    );
                }
            }
        }
        if let Some(shape) = node.shape {
            self.notes.push(
                NoteCode::ShapeDropped,
                format!(
                    "line {number}: the {shape} shape of {:?} becomes a rectangle",
                    node.name
                ),
            );
        }
        if node.class {
            self.notes.push(
                NoteCode::StyleDropped,
                format!(
                    "line {number}: the class of {:?} is a style, which a canvas does not keep",
                    node.name
                ),
            );
        }
        Ok(end)
    }

    /// C'è posto per una scheda o un blocco in più.
    fn room_for_one(&self) -> Result<(), ImportError> {
        if self.sketch.nodes.len() + self.sketch.groups.len() >= MAX_IMPORTED {
            return Err(ImportError::TooMany {
                what: "cards and groups in one import",
                limit: MAX_IMPORTED,
            });
        }
        Ok(())
    }

    /// Una riga che non si capisce: una nota, e la prima si ricorda.
    fn skip(&mut self, number: usize, line: &str) {
        if self.first_bad.is_none() {
            self.first_bad = Some((number, quote(line)));
        }
        self.notes.push(
            NoteCode::LineSkipped,
            format!("line {number}: `{}` is not understood", quote(line)),
        );
    }

    /// Lo schizzo, dopo l'ultima riga. Un nodo che ha lo stesso id di un blocco
    /// aperto dopo è quel blocco: gli archi vanno al gruppo.
    fn finish(mut self) -> Result<Sketch, ImportError> {
        let merged: Vec<(usize, usize)> = self
            .sketch
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(index, node)| match self.names.get(&node.name) {
                Some(&End::Group(group)) => Some((index, group)),
                _ => None,
            })
            .collect();
        if !merged.is_empty() {
            let gone: HashMap<usize, usize> = merged.iter().copied().collect();
            for &(index, _) in &merged {
                if self.written[index] {
                    self.notes.push(
                        NoteCode::ShapeDropped,
                        format!(
                            "{:?} is a subgraph, and its title stays the subgraph one",
                            self.sketch.nodes[index].name
                        ),
                    );
                }
            }
            // I nodi che restano, con l'indice nuovo.
            let mut renumber = vec![None; self.sketch.nodes.len()];
            let mut kept = Vec::with_capacity(self.sketch.nodes.len());
            for (index, node) in std::mem::take(&mut self.sketch.nodes)
                .into_iter()
                .enumerate()
            {
                if !gone.contains_key(&index) {
                    renumber[index] = Some(kept.len());
                    kept.push(node);
                }
            }
            self.sketch.nodes = kept;
            let fix = |end: End| match end {
                End::Node(index) => match gone.get(&index) {
                    Some(&group) => End::Group(group),
                    None => End::Node(renumber[index].unwrap_or(index)),
                },
                group => group,
            };
            for edge in &mut self.sketch.edges {
                edge.from = fix(edge.from);
                edge.to = fix(edge.to);
            }
        }
        if self.sketch.nodes.is_empty() {
            return Err(ImportError::Invalid(match self.first_bad {
                Some((number, line)) => {
                    format!("the diagram has no nodes: line {number} `{line}` is not understood")
                }
                None => "the diagram has no nodes".to_owned(),
            }));
        }
        self.sketch.notes = self.notes;
        Ok(self.sketch)
    }
}

/// Il verso di Mermaid come verso dell'albero.
fn direction(word: &str) -> Option<Direction> {
    match word.trim() {
        "TD" | "TB" => Some(Direction::Down),
        "BT" => Some(Direction::Up),
        "LR" => Some(Direction::Right),
        "RL" => Some(Direction::Left),
        _ => None,
    }
}

/// La prima parola (fino a uno spazio) e il resto, senza spazi ai lati.
fn split_word(text: &str) -> (&str, &str) {
    let text = text.trim();
    match text.find(char::is_whitespace) {
        Some(at) => (&text[..at], text[at..].trim()),
        None => (text, ""),
    }
}

/// Le istruzioni di una riga: si separano con `;`, fuori dalle virgolette e
/// dalle parentesi.
fn statements(line: &str) -> Vec<&str> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("%%") {
        return Vec::new();
    }
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    let mut depth = 0_usize;
    for (at, character) in line.char_indices() {
        match character {
            '"' => quoted = !quoted,
            '[' | '(' | '{' if !quoted => depth += 1,
            ']' | ')' | '}' if !quoted => depth = depth.saturating_sub(1),
            ';' if !quoted && depth == 0 && !ends_entity(&line[start..at]) => {
                parts.push(&line[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&line[start..]);
    parts
}

/// Se `before` finisce con l'inizio di un'entità (`#quot`, `#35`): il `;` che
/// viene dopo la chiude, e non separa due istruzioni.
fn ends_entity(before: &str) -> bool {
    before.rfind('#').is_some_and(|at| {
        let name = &before[at + 1..];
        !name.is_empty() && name.len() <= 8 && name.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

/// Il testo di un nodo, di un'etichetta o di un titolo: fra virgolette o no,
/// con le entità di Mermaid (`#quot;`, `#35;`) e `<br>` che va a capo.
fn text_of(raw: &str) -> String {
    let raw = raw.trim();
    let inner = raw
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(raw);
    unescape(inner.trim())
}

/// Le entità di Mermaid (`#quot;`, `#amp;`, `#lt;`, `#gt;`, `#35;`) e gli a
/// capo (`<br>`, `<br/>`, `<br />`). Un `#` che non apre un'entità resta.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(['#', '<']) {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        if let Some((replacement, used)) = entity(tail).or_else(|| line_break(tail)) {
            out.push(replacement);
            rest = &tail[used..];
        } else {
            let first = tail.chars().next().map_or(1, char::len_utf8);
            out.push_str(&tail[..first]);
            rest = &tail[first..];
        }
    }
    out.push_str(rest);
    out
}

/// L'entità all'inizio di `tail` (che comincia con `#`), e quanti byte occupa.
fn entity(tail: &str) -> Option<(char, usize)> {
    let body = tail.strip_prefix('#')?;
    let end = body.find(';').filter(|&end| end > 0 && end <= 8)?;
    let name = &body[..end];
    let character = match name {
        "quot" => '"',
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "apos" => '\'',
        digits if digits.bytes().all(|byte| byte.is_ascii_digit()) => {
            char::from_u32(digits.parse().ok()?)?
        }
        _ => return None,
    };
    Some((character, end + 2))
}

/// Un `<br>` all'inizio di `tail`, come a capo.
fn line_break(tail: &str) -> Option<(char, usize)> {
    ["<br>", "<br/>", "<br />", "<BR>", "<BR/>"]
        .iter()
        .find(|tag| tail.starts_with(**tag))
        .map(|tag| ('\n', tag.len()))
}

/// Una catena: gruppi di nodi (uniti da `&`) separati da archi. `None` se
/// l'istruzione non è tutta una catena.
fn parse_chain(statement: &str) -> Option<(Vec<Vec<NodeRef>>, Vec<Link>)> {
    let mut cursor = Cursor::new(statement);
    let mut groups = vec![cursor.group()?];
    let mut links = Vec::new();
    loop {
        cursor.spaces();
        if cursor.done() {
            break;
        }
        links.push(cursor.link()?);
        groups.push(cursor.group()?);
    }
    Some((groups, links))
}

/// Un cursore su un'istruzione.
struct Cursor<'a> {
    text: &'a str,
    at: usize,
}

impl<'a> Cursor<'a> {
    fn new(text: &'a str) -> Self {
        Self { text, at: 0 }
    }

    fn rest(&self) -> &'a str {
        &self.text[self.at..]
    }

    fn done(&self) -> bool {
        self.at >= self.text.len()
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn eat(&mut self, prefix: &str) -> bool {
        if self.rest().starts_with(prefix) {
            self.at += prefix.len();
            true
        } else {
            false
        }
    }

    fn spaces(&mut self) {
        let rest = self.rest();
        self.at += rest.len() - rest.trim_start().len();
    }

    /// Uno o più nodi uniti da `&`.
    fn group(&mut self) -> Option<Vec<NodeRef>> {
        let mut group = vec![self.node()?];
        loop {
            let save = self.at;
            self.spaces();
            if self.eat("&") {
                self.spaces();
                group.push(self.node()?);
            } else {
                self.at = save;
                return Some(group);
            }
        }
    }

    /// Un nodo: il nome, poi la forma col testo, poi `:::classe`.
    fn node(&mut self) -> Option<NodeRef> {
        self.spaces();
        let name = self.name()?;
        let mut node = NodeRef {
            name,
            text: None,
            shape: None,
            class: false,
        };
        if let Some((open, closes, shape)) = SHAPES
            .iter()
            .find(|(open, _, _)| self.rest().starts_with(open))
        {
            self.at += open.len();
            node.text = Some(self.shape_text(closes)?);
            node.shape = *shape;
        }
        if self.eat(":::") {
            self.name()?;
            node.class = true;
        }
        Some(node)
    }

    /// Un nome di nodo: lettere, cifre e `_`, e un `-` fra due di loro.
    fn name(&mut self) -> Option<String> {
        let start = self.at;
        let mut chars = self.rest().char_indices().peekable();
        let mut end = 0;
        while let Some((at, character)) = chars.next() {
            if is_name_char(character) {
                end = at + character.len_utf8();
            } else if character == '-'
                && end == at
                && end > 0
                && chars.peek().is_some_and(|&(_, next)| is_name_char(next))
            {
                continue;
            } else {
                break;
            }
        }
        if end == 0 {
            return None;
        }
        self.at = start + end;
        Some(self.text[start..self.at].to_owned())
    }

    /// Il testo di una forma, fino al segno che la chiude: fra virgolette, o
    /// fino al primo segno di chiusura.
    fn shape_text(&mut self, closes: &[&str]) -> Option<String> {
        self.spaces();
        if self.peek() == Some('"') {
            let body = &self.rest()[1..];
            let end = body.find('"')?;
            let text = text_of(&body[..end]);
            self.at += end + 2;
            self.spaces();
            closes.iter().find(|close| self.eat(close))?;
            return Some(text);
        }
        let rest = self.rest();
        let (end, close) = closes
            .iter()
            .filter_map(|close| rest.find(close).map(|end| (end, close)))
            .min_by_key(|(end, _)| *end)?;
        let text = text_of(&rest[..end]);
        self.at += end + close.len();
        Some(text)
    }

    /// Un arco, con l'etichetta in mezzo (`-- testo -->`) o dopo (`-->|testo|`).
    fn link(&mut self) -> Option<Link> {
        let from_arrow = self.eat("<");
        let mut link = if self.eat("~~~") {
            while self.eat("~") {}
            Link {
                label: None,
                from_arrow: false,
                to_arrow: false,
                style: None,
                invisible: true,
            }
        } else {
            self.body(from_arrow)?
        };
        let save = self.at;
        self.spaces();
        if self.eat("|") {
            let rest = self.rest();
            let end = if rest.starts_with('"') {
                let close = rest[1..].find('"')? + 1;
                close + rest[close..].find('|')?
            } else {
                rest.find('|')?
            };
            link.label = Some(text_of(&rest[..end])).filter(|label| !label.is_empty());
            self.at += end + 1;
        } else {
            self.at = save;
        }
        Some(link)
    }

    /// Il corpo di un arco: `--`, `==` o `-.`, con le sue punte, e l'etichetta
    /// in mezzo se c'è.
    fn body(&mut self, from_arrow: bool) -> Option<Link> {
        let rest = self.rest();
        let (stroke, style) = if rest.starts_with("-.") {
            ('.', Some("dotted"))
        } else if rest.starts_with("--") {
            ('-', None)
        } else if rest.starts_with("==") {
            ('=', Some("thick"))
        } else {
            return None;
        };
        // Il segno dell'arco, senza punta: `--`, `---`, `==`, `-.-`, `-..-`.
        let opening = self.stroke(stroke)?;
        let head = self.head();
        if head.is_none() && self.label_follows(stroke, opening) {
            // `-- testo -->`: l'etichetta fino al segno che chiude.
            self.spaces();
            let rest = self.rest();
            let (label, used) = middle_label(rest, stroke)?;
            self.at += used;
            self.stroke_close(stroke)?;
            let head = self.head();
            return Some(self.finish_link(Some(label), from_arrow, head, style));
        }
        Some(self.finish_link(None, from_arrow, head, style))
    }

    /// Il segno di un arco, e quanti caratteri ha.
    fn stroke(&mut self, stroke: char) -> Option<usize> {
        let start = self.at;
        match stroke {
            '-' | '=' => {
                while self.peek() == Some(stroke) {
                    self.at += 1;
                }
            }
            _ => {
                // `-` poi uno o più `.`, poi `-` facoltativo.
                self.eat("-");
                if !self.eat(".") {
                    self.at = start;
                    return None;
                }
                while self.eat(".") {}
                self.eat("-");
            }
        }
        Some(self.at - start)
    }

    /// Il segno che chiude un'etichetta in mezzo: `--…`, `==…` o `.-…`.
    fn stroke_close(&mut self, stroke: char) -> Option<()> {
        match stroke {
            '-' | '=' => {
                let mut count = 0;
                while self.peek() == Some(stroke) {
                    self.at += 1;
                    count += 1;
                }
                (count >= 2).then_some(())
            }
            _ => {
                if !self.eat(".") {
                    return None;
                }
                while self.eat(".") {}
                while self.eat("-") {}
                Some(())
            }
        }
    }

    /// La punta alla fine dell'arco: `>`, o `o` e `x` (punte che la lavagna
    /// disegna come frecce), se dopo non viene un nome.
    fn head(&mut self) -> Option<char> {
        let mut chars = self.rest().chars();
        let first = chars.next()?;
        match first {
            '>' => {
                self.at += 1;
                Some('>')
            }
            'o' | 'x' if !chars.next().is_some_and(is_name_char) => {
                self.at += 1;
                Some(first)
            }
            _ => None,
        }
    }

    /// Dopo `--`, `==` o `-.` senza punta viene un'etichetta: da soli non sono
    /// un arco (un arco senza punta è `---`, `===` o `-.-`).
    fn label_follows(&self, stroke: char, opening: usize) -> bool {
        match stroke {
            '.' => self.text[self.at - opening..self.at] == *"-.",
            _ => opening == 2,
        }
    }

    fn finish_link(
        &mut self,
        label: Option<String>,
        from_arrow: bool,
        head: Option<char>,
        style: Option<&'static str>,
    ) -> Link {
        let style = match head {
            Some('o') => Some("circle-ended"),
            Some('x') => Some("cross-ended"),
            _ => style,
        };
        Link {
            label: label.filter(|label| !label.is_empty()),
            from_arrow,
            to_arrow: head.is_some(),
            style,
            invisible: false,
        }
    }
}

/// L'etichetta in mezzo a un arco, fino al segno che la chiude (`--`, `==` o
/// `.-`), e quanti byte occupa (senza il segno). Il testo fra virgolette può
/// contenere il segno.
fn middle_label(rest: &str, stroke: char) -> Option<(String, usize)> {
    let close = match stroke {
        '-' => "--",
        '=' => "==",
        _ => ".-",
    };
    let search_from = if rest.starts_with('"') {
        rest[1..].find('"')? + 2
    } else {
        0
    };
    let end = search_from + rest[search_from..].find(close)?;
    let label = text_of(&rest[..end]);
    // Gli spazi prima del segno restano fuori dall'etichetta.
    Some((label, end))
}

fn is_name_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(text: &str) -> (Vec<Vec<String>>, Vec<(Option<String>, bool, bool)>) {
        let (groups, links) = parse_chain(text).expect("una catena");
        (
            groups
                .into_iter()
                .map(|group| group.into_iter().map(|node| node.name).collect())
                .collect(),
            links
                .into_iter()
                .map(|link| (link.label, link.from_arrow, link.to_arrow))
                .collect(),
        )
    }

    #[test]
    fn gli_archi_si_leggono() {
        let plain = (None, false, true);
        assert_eq!(chain("A-->B").1, vec![plain.clone()]);
        assert_eq!(chain("A --- B").1, vec![(None, false, false)]);
        assert_eq!(chain("A <--> B").1, vec![(None, true, true)]);
        assert_eq!(chain("A -.-> B").1, vec![plain.clone()]);
        assert_eq!(chain("A ==> B").1, vec![plain.clone()]);
        assert_eq!(
            chain("A -- porta a --> B").1,
            vec![(Some("porta a".to_owned()), false, true)]
        );
        assert_eq!(
            chain("A -->|porta a| B").1,
            vec![(Some("porta a".to_owned()), false, true)]
        );
        assert_eq!(
            chain("A -. forse .-> B").1,
            vec![(Some("forse".to_owned()), false, true)]
        );
        assert_eq!(
            chain("A == sì ==> B").1,
            vec![(Some("sì".to_owned()), false, true)]
        );
        assert_eq!(
            chain(r#"A -- "a -- b" --> B"#).1,
            vec![(Some("a -- b".to_owned()), false, true)]
        );
    }

    #[test]
    fn catene_e_gruppi() {
        let (groups, links) = chain("A --> B --> C");
        assert_eq!(groups, vec![vec!["A"], vec!["B"], vec!["C"]]);
        assert_eq!(links.len(), 2);
        let (groups, _) = chain("A & B --> C & D");
        assert_eq!(groups, vec![vec!["A", "B"], vec!["C", "D"]]);
    }

    #[test]
    fn i_nomi_col_trattino() {
        let (groups, _) = chain("nodo-uno --> nodo-due");
        assert_eq!(groups, vec![vec!["nodo-uno"], vec!["nodo-due"]]);
        let (groups, _) = chain("a-->b");
        assert_eq!(groups, vec![vec!["a"], vec!["b"]]);
    }

    #[test]
    fn le_forme_e_i_testi() {
        let (groups, _) = parse_chain(r#"A(["Ciao (mondo)"]) --> B{Scelta} --> C>Bandiera]"#)
            .expect("una catena");
        let texts: Vec<Option<String>> = groups.iter().map(|group| group[0].text.clone()).collect();
        assert_eq!(
            texts,
            vec![
                Some("Ciao (mondo)".to_owned()),
                Some("Scelta".to_owned()),
                Some("Bandiera".to_owned())
            ]
        );
        assert_eq!(groups[0][0].shape, Some("stadium"));
        assert_eq!(groups[1][0].shape, Some("rhombus"));
    }

    #[test]
    fn le_entita_e_gli_a_capo() {
        assert_eq!(unescape("Un #quot;sì#quot; #35;1"), "Un \"sì\" #1");
        assert_eq!(unescape("riga<br>due"), "riga\ndue");
        assert_eq!(unescape("C# e <b>"), "C# e <b>");
    }

    #[test]
    fn una_riga_storta_non_e_una_catena() {
        assert!(parse_chain("A --> ").is_none());
        assert!(parse_chain("A[testo").is_none());
        assert!(parse_chain("--> B").is_none());
    }
}
