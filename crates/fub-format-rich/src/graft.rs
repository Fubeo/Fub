//! L'**innesto**: un salvataggio che riscrive soltanto ciò che l'utente ha
//! toccato.
//!
//! Il codec riscrive il pacchetto intero dal suo modello. Ciò che il modello
//! non conosce, e i dettagli che riscrive in un altro modo (l'ordine degli
//! attributi, gli `rsid`, i nomi delle immagini), cambierebbero a ogni
//! salvataggio anche dove l'utente non ha messo mano. L'innesto parte invece dal
//! file com'è e sostituisce, nel corpo del documento principale, soltanto le
//! **unità** ([`crate::flow::Unit`]) con un blocco toccato, prendendole dai
//! byte che il codec ha scritto per il documento voluto:
//!
//! - ogni altra voce dello zip si copia così com'è, compressa compresa, e
//!   nell'ordine dello zip;
//! - un'unità non toccata resta i byte del file, come il prologo, la sezione
//!   finale e la chiusura del documento;
//! - in un'unità toccata, ogni riferimento del codec diventa quello del file:
//!   le relazioni (un link per tipo e indirizzo, un'immagine per contenuto, e
//!   una nuova se il file non l'ha), i segnalibri per nome, i commenti e le
//!   note per contenuto. Gli altri numeri che devono essere unici nel documento
//!   (le revisioni, i permessi, i disegni) ne prendono di nuovi, sopra quelli
//!   del file;
//! - gli spazi dei nomi che l'unità usa si dichiarano sulla radice, e quelli
//!   che il codec dichiara ignorabili si aggiungono a `mc:Ignorable`.
//!
//! L'innesto non decide da solo: chi lo chiama ([`crate::session`]) lo usa
//! soltanto quando fuori dal corpo niente è cambiato, e rilegge il risultato.
//! Ogni forma che non sa trattare è un [`GraftError`], e il salvataggio passa
//! alla scrittura intera con i suoi controlli.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::{Cursor, Write};

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::{NsReader, Reader, Writer};

use crate::flow::{Main, ScanError};
use crate::inventory::{class_of, read_rels, resolve, sha256, Limits, NS_RELATIONSHIPS, NS_W};

/// Perché l'innesto non si fa: il salvataggio passa alla scrittura intera.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GraftError {
    Scan(ScanError),
    /// Una forma che l'innesto non tratta.
    Shape(String),
    Zip(String),
}

impl From<ScanError> for GraftError {
    fn from(error: ScanError) -> GraftError {
        GraftError::Scan(error)
    }
}

impl std::fmt::Display for GraftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GraftError::Scan(error) => write!(f, "{error}"),
            GraftError::Shape(what) => write!(f, "graft: {what}"),
            GraftError::Zip(error) => write!(f, "graft zip: {error}"),
        }
    }
}

fn shape(what: impl Into<String>) -> GraftError {
    GraftError::Shape(what.into())
}

fn xml(error: impl std::fmt::Display) -> GraftError {
    GraftError::Shape(format!("xml: {error}"))
}

fn zip_error(error: impl std::fmt::Display) -> GraftError {
    GraftError::Zip(error.to_string())
}

/// Un pezzo del corpo innestato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Piece {
    /// L'unità del file, con i suoi byte.
    Kept(usize),
    /// L'unità che il codec ha scritto per il documento voluto.
    Written(usize),
}

/// Le unità del corpo innestato, in ordine. `pairs` sono le coppie (blocco
/// della base, blocco voluto) che l'utente non ha toccato: un'unità del file
/// resta se tutti i suoi blocchi lo sono e il codec li scrive, nell'ordine, in
/// un'unità sola. Un'unità del file senza blocchi va con l'unità che la
/// precede, o in testa.
pub(crate) fn plan(o: &Main, n: &Main, pairs: &[(usize, usize)]) -> Result<Vec<Piece>, GraftError> {
    let to: HashMap<usize, usize> = pairs.iter().copied().collect();
    let by_blocks: HashMap<(usize, usize), usize> = n
        .scan
        .units
        .iter()
        .enumerate()
        .filter(|(_, unit)| !unit.blocks.is_empty())
        .map(|(at, unit)| ((unit.blocks.start, unit.blocks.end), at))
        .collect();
    // Per unità scritta, l'unità del file che resta al suo posto.
    let mut kept: HashMap<usize, usize> = HashMap::new();
    // Le unità del file senza blocchi, per unità che le precede.
    let mut leading = Vec::new();
    let mut gaps: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut last = None;
    for (at, unit) in o.scan.units.iter().enumerate() {
        if unit.blocks.is_empty() {
            match last {
                None => leading.push(at),
                Some(previous) => gaps.entry(previous).or_default().push(at),
            }
            continue;
        }
        last = Some(at);
        let images: Option<Vec<usize>> = unit.blocks.clone().map(|b| to.get(&b).copied()).collect();
        let Some(images) = images else {
            continue;
        };
        let consecutive = images.windows(2).all(|pair| pair[1] == pair[0] + 1);
        let (Some(first), Some(end)) = (images.first(), images.last()) else {
            continue;
        };
        if let (true, Some(written)) = (consecutive, by_blocks.get(&(*first, end + 1))) {
            kept.insert(*written, at);
        }
    }
    let mut out: Vec<Piece> = leading.into_iter().map(Piece::Kept).collect();
    let mut placed = BTreeSet::new();
    for written in 0..n.scan.units.len() {
        match kept.get(&written) {
            Some(&at) => {
                out.push(Piece::Kept(at));
                placed.insert(at);
                if let Some(gaps) = gaps.get(&at) {
                    out.extend(gaps.iter().copied().map(Piece::Kept));
                }
            }
            None => out.push(Piece::Written(written)),
        }
    }
    if let Some((at, _)) = gaps.iter().find(|(at, _)| !placed.contains(at)) {
        return Err(shape(format!(
            "unit without blocks after the touched unit {at}"
        )));
    }
    Ok(out)
}

/// Uno spazio dei nomi dichiarato su un elemento: prefisso (vuoto per quello
/// predefinito) e URI.
type Declarations = Vec<(String, String)>;

/// Le dichiarazioni e gli altri attributi del tag di apertura `tag`.
fn root_of(tag: &[u8]) -> Result<(BytesStart<'static>, Declarations), GraftError> {
    let mut reader = Reader::from_reader(tag);
    loop {
        match reader.read_event().map_err(xml)? {
            Event::Start(start) => {
                let start = start.into_owned();
                let mut declarations = Vec::new();
                for attr in start.attributes() {
                    let attr = attr.map_err(xml)?;
                    let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
                    let value = attr
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map_err(xml)?
                        .into_owned();
                    if key == "xmlns" {
                        declarations.push((String::new(), value));
                    } else if let Some(prefix) = key.strip_prefix("xmlns:") {
                        declarations.push((prefix.to_string(), value));
                    }
                }
                return Ok((start, declarations));
            }
            Event::Eof => return Err(shape("no root tag")),
            _ => {}
        }
    }
}

const NS_MC: &str = crate::inventory::NS_MC;

/// Il prefisso di `uri` fra le dichiarazioni.
fn prefix_of<'a>(declarations: &'a Declarations, uri: &str) -> Option<&'a str> {
    declarations
        .iter()
        .find(|(prefix, ns)| ns == uri && !prefix.is_empty())
        .map(|(prefix, _)| prefix.as_str())
}

fn ignorable(tag: &BytesStart<'_>, declarations: &Declarations) -> Vec<String> {
    let Some(mc) = prefix_of(declarations, NS_MC) else {
        return Vec::new();
    };
    let name = format!("{mc}:Ignorable");
    tag.attributes()
        .flatten()
        .find(|attr| attr.key.as_ref() == name.as_bytes())
        .map(|attr| {
            String::from_utf8_lossy(&attr.value)
                .split_whitespace()
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// La radice del file con gli spazi dei nomi del codec che mancano, e i loro
/// prefissi ignorabili. Un prefisso che il file usa per un altro spazio dei
/// nomi non si innesta.
fn merged_root(o_tag: &[u8], n_tag: &[u8]) -> Result<Option<Vec<u8>>, GraftError> {
    let (o_start, o_decl) = root_of(o_tag)?;
    let (n_start, n_decl) = root_of(n_tag)?;
    let mut added: Declarations = Vec::new();
    for (prefix, uri) in &n_decl {
        match o_decl.iter().find(|(p, _)| p == prefix) {
            Some((_, ns)) if ns == uri => {}
            Some(_) => return Err(shape(format!("namespace prefix {prefix:?} differs"))),
            None => added.push((prefix.clone(), uri.clone())),
        }
    }
    let o_ignorable = ignorable(&o_start, &o_decl);
    let mut wanted = o_ignorable.clone();
    for prefix in ignorable(&n_start, &n_decl) {
        if !wanted.contains(&prefix) {
            wanted.push(prefix);
        }
    }
    if added.is_empty() && wanted == o_ignorable {
        return Ok(None);
    }
    let mut all = o_decl.clone();
    all.extend(added.iter().cloned());
    let mc = prefix_of(&all, NS_MC)
        .map(str::to_string)
        .ok_or_else(|| shape("no markup-compatibility prefix"))?;
    let ignorable_name = format!("{mc}:Ignorable");
    let mut tag = BytesStart::new(String::from_utf8_lossy(o_start.name().as_ref()).into_owned());
    for attr in o_start.attributes() {
        let attr = attr.map_err(xml)?;
        if attr.key.as_ref() == ignorable_name.as_bytes() {
            continue;
        }
        tag.push_attribute(attr);
    }
    for (prefix, uri) in &added {
        let key = match prefix.is_empty() {
            true => "xmlns".to_string(),
            false => format!("xmlns:{prefix}"),
        };
        tag.push_attribute((key.as_str(), uri.as_str()));
    }
    if !wanted.is_empty() {
        tag.push_attribute((ignorable_name.as_str(), wanted.join(" ").as_str()));
    }
    let mut writer = Writer::new(Vec::new());
    writer.write_event(Event::Start(tag)).map_err(xml)?;
    Ok(Some(writer.into_inner()))
}

/// I numeri del documento principale del file che l'innesto deve conoscere.
#[derive(Default)]
struct Ids {
    /// Il primo segnalibro con ogni nome, e il suo numero.
    bookmarks: HashMap<String, String>,
    /// Il nome di ogni segnalibro per numero.
    names: HashMap<String, String>,
    /// Il numero più alto fra i `w:id` e fra i `wp:docPr/@id`.
    max_id: u64,
    max_drawing: u64,
}

const NS_WP: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

fn ids_of(xml_bytes: &[u8], limits: &Limits) -> Result<Ids, GraftError> {
    let mut reader = NsReader::from_reader(xml_bytes);
    let mut ids = Ids::default();
    let mut buf = Vec::new();
    let mut elements = 0u64;
    loop {
        let event = reader.read_event_into(&mut buf).map_err(xml)?;
        let start = match &event {
            Event::Start(start) | Event::Empty(start) => start.clone().into_owned(),
            Event::Eof => break,
            _ => {
                buf.clear();
                continue;
            }
        };
        elements += 1;
        if elements > limits.elements {
            return Err(shape("too many elements"));
        }
        let (ns, local) = reader.resolver().resolve_element(start.name());
        let ns = namespace(&ns);
        let local = String::from_utf8_lossy(local.as_ref()).into_owned();
        let (mut id, mut name) = (None, None);
        for attr in start.attributes() {
            let attr = attr.map_err(xml)?;
            let (attr_ns, attr_local) = reader.resolver().resolve_attribute(attr.key);
            let value = attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(xml)?
                .into_owned();
            match (namespace(&attr_ns).as_str(), attr_local.as_ref()) {
                (NS_W, b"id") => id = Some(value),
                (NS_W, b"name") => name = Some(value),
                ("", b"id") if ns == NS_WP && local == "docPr" => {
                    if let Ok(n) = value.parse::<u64>() {
                        ids.max_drawing = ids.max_drawing.max(n);
                    }
                }
                _ => {}
            }
        }
        if let Some(id) = &id {
            if let Ok(n) = id.trim().parse::<i64>() {
                ids.max_id = ids.max_id.max(n.max(0) as u64);
            }
        }
        if ns == NS_W && local == "bookmarkStart" {
            if let (Some(id), Some(name)) = (id, name) {
                ids.bookmarks.entry(name.clone()).or_insert(id.clone());
                ids.names.insert(id, name);
            }
        }
        buf.clear();
    }
    Ok(ids)
}

fn namespace(result: &ResolveResult<'_>) -> String {
    match result {
        ResolveResult::Bound(ns) => String::from_utf8_lossy(ns.as_ref()).into_owned(),
        _ => String::new(),
    }
}

/// Le storie di una parte (commenti, note) per numero, con una chiave del loro
/// contenuto: il tipo, l'autore e il testo.
fn stories_of(xml_bytes: &[u8], element: &str) -> Result<Vec<(String, String)>, GraftError> {
    let mut reader = NsReader::from_reader(xml_bytes);
    let mut out = Vec::new();
    let mut buf = Vec::new();
    // La storia aperta: numero, chiave, profondità.
    let mut open: Option<(String, String, usize)> = None;
    let mut depth = 0usize;
    let mut in_text = false;
    loop {
        let event = reader.read_event_into(&mut buf).map_err(xml)?;
        match &event {
            Event::Start(start) | Event::Empty(start) => {
                let empty = matches!(event, Event::Empty(_));
                let (ns, local) = reader.resolver().resolve_element(start.name());
                let is_w = namespace(&ns) == NS_W;
                let local = local.as_ref().to_vec();
                if open.is_none() && is_w && local == element.as_bytes() {
                    let mut id = String::new();
                    let mut key = String::new();
                    for attr in start.attributes().flatten() {
                        let (attr_ns, attr_local) = reader.resolver().resolve_attribute(attr.key);
                        let value = String::from_utf8_lossy(&attr.value).into_owned();
                        match (namespace(&attr_ns).as_str(), attr_local.as_ref()) {
                            (NS_W, b"id") => id = value,
                            (NS_W, b"type" | b"author" | b"initials") => {
                                key.push_str(&value);
                                key.push('\u{1}');
                            }
                            _ => {}
                        }
                    }
                    if empty {
                        out.push((id, key));
                    } else {
                        open = Some((id, key, depth));
                    }
                } else if open.is_some() && is_w && local == b"t" && !empty {
                    in_text = true;
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::Text(text) if in_text => {
                if let (Some((_, key, _)), Ok(text)) = (
                    open.as_mut(),
                    text.xml_content(quick_xml::XmlVersion::Implicit1_0),
                ) {
                    key.push_str(&text);
                }
            }
            Event::GeneralRef(reference) if in_text => {
                if let (Some((_, key, _)), Ok(Some(ch))) = (open.as_mut(), reference.resolve_char_ref()) {
                    key.push(ch);
                } else if let (Some((_, key, _)), Ok(name)) = (open.as_mut(), reference.decode()) {
                    if let Some(entity) = quick_xml::escape::resolve_xml_entity(&name) {
                        key.push_str(entity);
                    }
                }
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                in_text = false;
                if open.as_ref().is_some_and(|(_, _, at)| *at == depth) {
                    if let Some((id, key, _)) = open.take() {
                        out.push((id, key));
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

/// Il numero nel file di ogni storia del codec, per contenuto: la k-esima
/// storia con una chiave va con la k-esima del file con la stessa chiave.
fn story_map(
    o: &Main,
    n: &Main,
    kind: &str,
    element: &str,
) -> Result<HashMap<String, String>, GraftError> {
    let part_of = |main: &Main| -> Option<String> {
        main.rels
            .iter()
            .find(|rel| !rel.external && rel.kind.ends_with(kind))
            .map(|rel| resolve(&main.part, &rel.target))
    };
    let (Some(o_part), Some(n_part)) = (part_of(o), part_of(n)) else {
        return Ok(HashMap::new());
    };
    let (Some(o_xml), Some(n_xml)) = (o.zip.parts.get(&o_part), n.zip.parts.get(&n_part)) else {
        return Ok(HashMap::new());
    };
    let mut by_key: HashMap<String, Vec<String>> = HashMap::new();
    for (id, key) in stories_of(o_xml, element)?.into_iter().rev() {
        by_key.entry(key).or_default().push(id);
    }
    let mut out = HashMap::new();
    for (id, key) in stories_of(n_xml, element)? {
        if let Some(o_id) = by_key.get_mut(&key).and_then(Vec::pop) {
            out.insert(id, o_id);
        }
    }
    Ok(out)
}

/// Una relazione nuova del documento principale innestato.
struct NewRel {
    id: String,
    kind: String,
    target: String,
    external: bool,
}

/// Ciò che l'innesto aggiunge al pacchetto del file.
#[derive(Default)]
struct Additions {
    rels: Vec<NewRel>,
    /// Le parti nuove: nome nello zip, byte.
    parts: Vec<(String, Vec<u8>)>,
    /// I tipi di contenuto nuovi: `Default` per estensione, `Override` per
    /// parte.
    defaults: Vec<(String, String)>,
    overrides: Vec<(String, String)>,
}

/// Come i riferimenti del codec diventano quelli del file.
struct Remap<'a> {
    o: &'a Main,
    n: &'a Main,
    o_ids: Ids,
    n_ids: Ids,
    comments: HashMap<String, String>,
    footnotes: HashMap<String, String>,
    endnotes: HashMap<String, String>,
    /// Le relazioni già decise, per id del codec.
    rels: HashMap<String, String>,
    /// I numeri nuovi, per famiglia e numero del codec.
    fresh: HashMap<(&'static str, String), String>,
    next_id: u64,
    next_drawing: u64,
    additions: Additions,
    o_rel_ids: BTreeSet<String>,
}

impl Remap<'_> {
    fn fresh_id(&mut self, family: &'static str, id: &str) -> String {
        if let Some(found) = self.fresh.get(&(family, id.to_string())) {
            return found.clone();
        }
        self.next_id += 1;
        let out = self.next_id.to_string();
        self.fresh.insert((family, id.to_string()), out.clone());
        out
    }

    fn bookmark(&mut self, id: &str) -> String {
        match self
            .n_ids
            .names
            .get(id)
            .and_then(|name| self.o_ids.bookmarks.get(name))
        {
            Some(found) => found.clone(),
            None => self.fresh_id("bookmark", id),
        }
    }

    fn new_rel_id(&mut self) -> String {
        let mut k = self.o_rel_ids.len() + 1;
        loop {
            let id = format!("rIdFub{k}");
            if self.o_rel_ids.insert(id.clone()) {
                return id;
            }
            k += 1;
        }
    }

    /// La relazione del file per la relazione `id` del codec.
    fn rel(&mut self, id: &str) -> Result<String, GraftError> {
        if let Some(found) = self.rels.get(id) {
            return Ok(found.clone());
        }
        let rel = self
            .n
            .rels
            .iter()
            .find(|rel| rel.id == id)
            .ok_or_else(|| shape(format!("dangling relationship {id}")))?
            .clone();
        let found = if rel.external {
            match self
                .o
                .rels
                .iter()
                .find(|o| o.external && o.kind == rel.kind && o.target == rel.target)
            {
                Some(o) => o.id.clone(),
                None => {
                    let new = self.new_rel_id();
                    self.additions.rels.push(NewRel {
                        id: new.clone(),
                        kind: rel.kind.clone(),
                        target: rel.target.clone(),
                        external: true,
                    });
                    new
                }
            }
        } else {
            self.internal(&rel)?
        };
        self.rels.insert(id.to_string(), found.clone());
        Ok(found)
    }

    fn internal(&mut self, rel: &crate::inventory::Relationship) -> Result<String, GraftError> {
        let path = resolve(&self.n.part, &rel.target);
        let bytes = self
            .n
            .zip
            .parts
            .get(&path)
            .ok_or_else(|| shape(format!("missing part {path}")))?;
        let content_type = self.n.types.of(&path);
        if let Some(class) = class_of(&content_type) {
            // Una parte che il codec riscrive (intestazioni, note): quella
            // del file della stessa specie, se è una sola.
            let same: Vec<&crate::inventory::Relationship> = self
                .o
                .rels
                .iter()
                .filter(|o| {
                    !o.external
                        && o.kind == rel.kind
                        && class_of(&self.o.types.of(&resolve(&self.o.part, &o.target)))
                            .as_deref()
                            == Some(class.as_str())
                })
                .collect();
            return match same.as_slice() {
                [one] => Ok(one.id.clone()),
                _ => Err(shape(format!("relationship to the {class} part"))),
            };
        }
        let digest = sha256(bytes);
        for o in &self.o.rels {
            if o.external || o.kind != rel.kind {
                continue;
            }
            let o_path = resolve(&self.o.part, &o.target);
            if self
                .o
                .zip
                .parts
                .get(&o_path)
                .is_some_and(|o_bytes| sha256(o_bytes) == digest)
            {
                return Ok(o.id.clone());
            }
        }
        if let Some(added) = self
            .additions
            .parts
            .iter()
            .position(|(_, added)| sha256(added) == digest)
        {
            let name = self.additions.parts[added].0.clone();
            if let Some(found) = self
                .additions
                .rels
                .iter()
                .find(|r| r.kind == rel.kind && resolve(&self.o.part, &r.target) == name.to_ascii_lowercase())
            {
                return Ok(found.id.clone());
            }
        }
        // Una parte nuova: soltanto se non ha relazioni sue.
        if !read_rels(&self.n.zip, &path, &crate::inventory::LIMITS)
            .map_err(|e| shape(e.to_string()))?
            .is_empty()
        {
            return Err(shape(format!("new part {path} with relationships")));
        }
        let original = self
            .n
            .zip
            .names
            .iter()
            .find(|name| name.trim_start_matches('/').eq_ignore_ascii_case(&path))
            .cloned()
            .unwrap_or_else(|| path.clone());
        let original = original.trim_start_matches('/').to_string();
        let taken = |name: &str, remap: &Remap<'_>| {
            let key = name.to_ascii_lowercase();
            remap.o.zip.parts.contains_key(&key)
                || remap
                    .additions
                    .parts
                    .iter()
                    .any(|(n, _)| n.to_ascii_lowercase() == key)
        };
        let name = if taken(&original, self) {
            let (dir, file) = original.rsplit_once('/').unwrap_or(("", original.as_str()));
            let ext = file.rsplit_once('.').map(|(_, e)| e).unwrap_or("bin");
            let base = format!("fub-{}.{ext}", &digest[..16]);
            match dir.is_empty() {
                true => base,
                false => format!("{dir}/{base}"),
            }
        } else {
            original
        };
        if taken(&name, self) {
            return Err(shape(format!("part name {name} taken")));
        }
        let key = name.to_ascii_lowercase();
        let ext = key.rsplit_once('.').map(|(_, e)| e.to_string()).unwrap_or_default();
        match self.o.types.defaults.get(&ext) {
            Some(ct) if *ct == content_type => {}
            Some(_) => self
                .additions
                .overrides
                .push((format!("/{name}"), content_type.clone())),
            None if self.additions.defaults.iter().any(|(e, _)| *e == ext) => {
                if !self
                    .additions
                    .defaults
                    .iter()
                    .any(|(e, ct)| *e == ext && *ct == content_type)
                {
                    self.additions
                        .overrides
                        .push((format!("/{name}"), content_type.clone()));
                }
            }
            None if !ext.is_empty() => self.additions.defaults.push((ext, content_type.clone())),
            None => self
                .additions
                .overrides
                .push((format!("/{name}"), content_type.clone())),
        }
        let id = self.new_rel_id();
        self.additions.rels.push(NewRel {
            id: id.clone(),
            kind: rel.kind.clone(),
            target: relative(&self.o.part, &name),
            external: false,
        });
        self.additions.parts.push((name, bytes.clone()));
        Ok(id)
    }

    /// Riscrive un'unità del codec con i riferimenti del file.
    fn unit(&mut self, bytes: &[u8], scope: &Declarations) -> Result<Vec<u8>, GraftError> {
        let mut reader = Reader::from_reader(bytes);
        let mut writer = Writer::new(Vec::with_capacity(bytes.len()));
        // Le dichiarazioni in vigore: la radice del codec, poi quelle degli
        // elementi aperti.
        let mut scopes: Vec<Declarations> = vec![scope.clone()];
        loop {
            let event = reader.read_event().map_err(xml)?;
            match event {
                Event::Start(start) => {
                    let (start, local) = self.element(start, &mut scopes)?;
                    scopes.push(local);
                    writer.write_event(Event::Start(start)).map_err(xml)?;
                }
                Event::Empty(start) => {
                    let (start, _) = self.element(start, &mut scopes)?;
                    writer.write_event(Event::Empty(start)).map_err(xml)?;
                }
                Event::End(end) => {
                    scopes.pop();
                    writer.write_event(Event::End(end)).map_err(xml)?;
                }
                Event::Eof => break,
                other => writer.write_event(other).map_err(xml)?,
            }
        }
        Ok(writer.into_inner())
    }

    fn element<'b>(
        &mut self,
        start: BytesStart<'b>,
        scopes: &mut [Declarations],
    ) -> Result<(BytesStart<'b>, Declarations), GraftError> {
        // Le dichiarazioni di questo elemento valgono già per lui.
        let mut local: Declarations = Vec::new();
        for attr in start.attributes() {
            let attr = attr.map_err(xml)?;
            let key = attr.key.as_ref();
            let value = String::from_utf8_lossy(&attr.value).into_owned();
            if key == b"xmlns" {
                local.push((String::new(), value));
            } else if let Some(prefix) = key.strip_prefix(b"xmlns:") {
                local.push((String::from_utf8_lossy(prefix).into_owned(), value));
            }
        }
        let lookup = |prefix: &str, local: &Declarations| -> Option<String> {
            local
                .iter()
                .rev()
                .chain(scopes.iter().rev().flat_map(|s| s.iter().rev()))
                .find(|(p, _)| p == prefix)
                .map(|(_, uri)| uri.clone())
        };
        let split = |name: &[u8]| -> (String, String) {
            let name = String::from_utf8_lossy(name).into_owned();
            match name.split_once(':') {
                Some((prefix, local)) => (prefix.to_string(), local.to_string()),
                None => (String::new(), name),
            }
        };
        let (prefix, element) = split(start.name().as_ref());
        let element_ns = lookup(&prefix, &local).unwrap_or_default();
        let mut out = BytesStart::new(String::from_utf8_lossy(start.name().as_ref()).into_owned());
        let mut changed = false;
        let mut attrs = Vec::new();
        for attr in start.attributes() {
            let attr = attr.map_err(xml)?;
            let key = attr.key.as_ref().to_vec();
            let (attr_prefix, attr_local) = split(&key);
            let attr_ns = match attr_prefix.as_str() {
                "" => String::new(),
                "xmlns" => "xmlns".into(),
                p => lookup(p, &local).unwrap_or_default(),
            };
            let value = attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(xml)?
                .into_owned();
            let replaced = self.attribute(&element_ns, &element, &attr_ns, &attr_local, &value)?;
            match replaced {
                Some(new) => {
                    changed = true;
                    attrs.push((key, Some(new)));
                }
                None => attrs.push((key, None)),
            }
            let _ = attr;
        }
        if !changed {
            return Ok((start, local));
        }
        for (attr, (key, new)) in start.attributes().zip(attrs) {
            let attr = attr.map_err(xml)?;
            match new {
                Some(value) => {
                    let key = String::from_utf8_lossy(&key).into_owned();
                    out.push_attribute((key.as_str(), value.as_str()));
                }
                None => out.push_attribute(attr),
            }
        }
        Ok((out, local))
    }

    /// Il valore nuovo di un attributo, se cambia.
    fn attribute(
        &mut self,
        element_ns: &str,
        element: &str,
        ns: &str,
        name: &str,
        value: &str,
    ) -> Result<Option<String>, GraftError> {
        if ns == NS_RELATIONSHIPS {
            return self.rel(value).map(Some);
        }
        if element_ns == NS_WP && element == "docPr" && ns.is_empty() && name == "id" {
            self.next_drawing += 1;
            return Ok(Some(self.next_drawing.to_string()));
        }
        if element_ns != NS_W || ns != NS_W || name != "id" {
            return Ok(None);
        }
        let story = |map: &HashMap<String, String>, what: &str| {
            map.get(value)
                .cloned()
                .ok_or_else(|| shape(format!("{what} {value} not in the file")))
        };
        let new = match element {
            "bookmarkStart" | "bookmarkEnd" => self.bookmark(value),
            "commentRangeStart" | "commentRangeEnd" | "commentReference" => {
                story(&self.comments, "comment")?
            }
            "footnoteReference" => story(&self.footnotes, "footnote")?,
            "endnoteReference" => story(&self.endnotes, "endnote")?,
            "permStart" | "permEnd" => self.fresh_id("perm", value),
            "moveFromRangeStart" | "moveFromRangeEnd" => self.fresh_id("moveFrom", value),
            "moveToRangeStart" | "moveToRangeEnd" => self.fresh_id("moveTo", value),
            _ => self.fresh_id("other", value),
        };
        Ok((new != value).then_some(new))
    }
}

/// Il riferimento relativo da `from` a `to`, come lo scrive una relazione.
fn relative(from: &str, to: &str) -> String {
    let from_dir: Vec<&str> = from.split('/').filter(|s| !s.is_empty()).collect();
    let from_dir = &from_dir[..from_dir.len().saturating_sub(1)];
    let to_parts: Vec<&str> = to.split('/').filter(|s| !s.is_empty()).collect();
    let to_dir = &to_parts[..to_parts.len().saturating_sub(1)];
    let common = from_dir
        .iter()
        .zip(to_dir)
        .take_while(|(a, b)| a.eq_ignore_ascii_case(b))
        .count();
    let mut out: Vec<&str> = vec![".."; from_dir.len() - common];
    out.extend(&to_parts[common..]);
    out.join("/")
}

fn escape(value: &str) -> String {
    quick_xml::escape::escape(value).into_owned()
}

/// Le relazioni del documento principale con quelle nuove.
fn rels_xml(existing: Option<&[u8]>, added: &[NewRel]) -> Result<Vec<u8>, GraftError> {
    let mut entries = String::new();
    for rel in added {
        entries.push_str(&format!(
            r#"<Relationship Id="{}" Type="{}" Target="{}"{}/>"#,
            escape(&rel.id),
            escape(&rel.kind),
            escape(&rel.target),
            if rel.external {
                r#" TargetMode="External""#
            } else {
                ""
            }
        ));
    }
    match existing {
        Some(bytes) => {
            let text = std::str::from_utf8(bytes).map_err(xml)?;
            let at = text
                .rfind("</")
                .ok_or_else(|| shape("relationships without a closing tag"))?;
            if text[at..].trim_end().ends_with("/>") || !text[at..].contains("Relationships") {
                return Err(shape("unexpected relationships part"));
            }
            Ok(format!("{}{entries}{}", &text[..at], &text[at..]).into_bytes())
        }
        None => Ok(format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{entries}</Relationships>"#
        )
        .into_bytes()),
    }
}

fn types_xml(bytes: &[u8], additions: &Additions, rels: bool) -> Result<Vec<u8>, GraftError> {
    let text = std::str::from_utf8(bytes).map_err(xml)?;
    let at = text
        .rfind("</")
        .ok_or_else(|| shape("content types without a closing tag"))?;
    let mut entries = String::new();
    let mut defaults = additions.defaults.clone();
    if rels {
        defaults.push((
            "rels".into(),
            "application/vnd.openxmlformats-package.relationships+xml".into(),
        ));
    }
    for (ext, ct) in &defaults {
        entries.push_str(&format!(
            r#"<Default Extension="{}" ContentType="{}"/>"#,
            escape(ext),
            escape(ct)
        ));
    }
    for (part, ct) in &additions.overrides {
        entries.push_str(&format!(
            r#"<Override PartName="{}" ContentType="{}"/>"#,
            escape(part),
            escape(ct)
        ));
    }
    Ok(format!("{}{entries}{}", &text[..at], &text[at..]).into_bytes())
}

/// Innesta nel file `original`, già letto in `o`, le unità toccate del
/// pacchetto `n` che il codec ha scritto per il documento voluto, secondo
/// `pieces` ([`plan`]).
pub(crate) fn graft(
    original: &[u8],
    o: &Main,
    n: &Main,
    pieces: &[Piece],
    limits: &Limits,
) -> Result<Vec<u8>, GraftError> {
    let o_xml = o
        .zip
        .parts
        .get(&o.part)
        .ok_or_else(|| shape("no main part"))?;
    let n_xml = n
        .zip
        .parts
        .get(&n.part)
        .ok_or_else(|| shape("no main part"))?;
    let (_, n_scope) = root_of(&n_xml[n.scan.root.clone()])?;
    let o_ids = ids_of(o_xml, limits)?;
    let n_ids = ids_of(n_xml, limits)?;
    let mut remap = Remap {
        o,
        n,
        next_id: o_ids.max_id,
        next_drawing: o_ids.max_drawing,
        o_ids,
        n_ids,
        comments: story_map(o, n, "/comments", "comment")?,
        footnotes: story_map(o, n, "/footnotes", "footnote")?,
        endnotes: story_map(o, n, "/endnotes", "endnote")?,
        rels: HashMap::new(),
        fresh: HashMap::new(),
        additions: Additions::default(),
        o_rel_ids: o.rels.iter().map(|rel| rel.id.clone()).collect(),
    };

    let mut body = Vec::with_capacity(o_xml.len());
    body.extend_from_slice(&o_xml[..o.scan.root.start]);
    match merged_root(&o_xml[o.scan.root.clone()], &n_xml[n.scan.root.clone()])? {
        Some(root) => body.extend_from_slice(&root),
        None => body.extend_from_slice(&o_xml[o.scan.root.clone()]),
    }
    body.extend_from_slice(&o_xml[o.scan.root.end..o.scan.head]);
    for piece in pieces {
        match *piece {
            Piece::Kept(at) => body.extend_from_slice(&o_xml[o.scan.units[at].bytes.clone()]),
            Piece::Written(at) => {
                let unit = remap.unit(&n_xml[n.scan.units[at].bytes.clone()], &n_scope)?;
                body.extend_from_slice(&unit);
            }
        }
    }
    let tail = o.scan.units.last().map_or(o.scan.head, |unit| unit.bytes.end);
    body.extend_from_slice(&o_xml[tail..]);

    // Le voci da sostituire, per nome in minuscolo, e quelle nuove.
    let mut replaced: HashMap<String, Vec<u8>> = HashMap::new();
    let mut added: Vec<(String, Vec<u8>)> = Vec::new();
    replaced.insert(o.part.clone(), body);
    let additions = std::mem::take(&mut remap.additions);
    if !additions.rels.is_empty() {
        let name = crate::inventory::rels_of(&o.part);
        let existing = o.zip.parts.get(&name).map(Vec::as_slice);
        let xml_bytes = rels_xml(existing, &additions.rels)?;
        match existing {
            Some(_) => {
                replaced.insert(name, xml_bytes);
            }
            None => added.push((name, xml_bytes)),
        }
    }
    let rels_type = !o.types.defaults.contains_key("rels")
        && added.iter().any(|(name, _)| name.ends_with(".rels"));
    if !additions.defaults.is_empty() || !additions.overrides.is_empty() || rels_type {
        let types = o
            .zip
            .parts
            .get("[content_types].xml")
            .ok_or_else(|| shape("no content types"))?;
        replaced.insert(
            "[content_types].xml".into(),
            types_xml(types, &additions, rels_type)?,
        );
    }
    added.extend(additions.parts);

    let mut archive = zip::ZipArchive::new(Cursor::new(original)).map_err(zip_error)?;
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::with_capacity(original.len())));
    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    for index in 0..archive.len() {
        let file = archive.by_index_raw(index).map_err(zip_error)?;
        let name = file.name().map_err(zip_error)?.to_string();
        let key = name.trim_start_matches('/').to_ascii_lowercase();
        match replaced.remove(&key) {
            Some(bytes) => {
                drop(file);
                out.start_file(name.as_str(), deflated).map_err(zip_error)?;
                out.write_all(&bytes).map_err(zip_error)?;
            }
            None => out.raw_copy_file(file).map_err(zip_error)?,
        }
    }
    if !replaced.is_empty() {
        return Err(shape("a replaced part is not in the zip"));
    }
    for (name, bytes) in added {
        out.start_file(name.as_str(), deflated).map_err(zip_error)?;
        out.write_all(&bytes).map_err(zip_error)?;
    }
    Ok(out.finish().map_err(zip_error)?.into_inner())
}
