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
//!   una nuova, con il suo tipo di contenuto, se il file non l'ha); i
//!   segnalibri per nome, anche dove l'unità ne ha soltanto la fine; i
//!   commenti, le note e i permessi per **identità**, mai per contenuto (due
//!   note «Ivi» sono due note). L'identità passa dal modello: il k-esimo
//!   riferimento di una specie in un'unità del file è il k-esimo oggetto di
//!   quella specie nei blocchi della base che l'unità contiene, e lo stesso
//!   fra i byte del codec e il documento voluto ([`Identity`]). Gli altri
//!   numeri che devono essere unici (le revisioni, i disegni, i
//!   `w14:paraId`) ne prendono di nuovi, che il file non usa;
//! - un intervallo di uno spostamento che comincia in un'unità toccata e
//!   finisce fuori, o il contrario, non si innesta;
//! - gli elenchi (`w:numId`) restano quelli del file: l'innesto si fa
//!   soltanto quando fuori dal corpo niente è cambiato, e la prova
//!   all'apertura ha dimostrato che il codec riscrive la numerazione con gli
//!   stessi numeri. La rilettura del risultato lo verifica;
//! - gli spazi dei nomi che l'unità usa si dichiarano sulla radice, e quelli
//!   che il codec dichiara ignorabili si aggiungono a `mc:Ignorable`.
//!
//! L'innesto non decide da solo: chi lo chiama ([`crate::session`]) lo usa
//! soltanto quando fuori dal corpo niente è cambiato, e rilegge il risultato.
//! Ogni forma che non sa trattare è un [`GraftError`], e il salvataggio passa
//! alla scrittura intera con i suoi controlli.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::{Cursor, Write};
use std::sync::Arc;

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::{NsReader, Reader, Writer};

use wordcraft_doc::para::NoteKind;
use wordcraft_doc::{Block, Document, InlineObject};

use crate::fidelity::each_paragraph;
use crate::flow::{Main, ScanError};
use crate::inventory::{
    class_of, read_rels, resolve, sha256, Limits, NS_RELATIONSHIPS, NS_W, NS_W14,
};
use crate::parallel;

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

/// I prefissi che i frammenti usano: nei nomi degli elementi e degli
/// attributi, e nelle condizioni di `mc:Choice`.
fn used_prefixes(fragments: &[&[u8]]) -> Result<BTreeSet<String>, GraftError> {
    let mut out = BTreeSet::new();
    for fragment in fragments {
        let mut reader = Reader::from_reader(*fragment);
        loop {
            let start = match reader.read_event().map_err(xml)? {
                Event::Start(start) | Event::Empty(start) => start,
                Event::Eof => break,
                _ => continue,
            };
            let (prefix, local) = split_name(start.name().as_ref());
            out.insert(prefix.clone());
            for attr in start.attributes() {
                let attr = attr.map_err(xml)?;
                let (attr_prefix, attr_local) = split_name(attr.key.as_ref());
                if local == "Choice" && attr_prefix.is_empty() && attr_local == "Requires" {
                    let value = String::from_utf8_lossy(&attr.value).into_owned();
                    out.extend(value.split_whitespace().map(str::to_string));
                }
                if !matches!(attr_prefix.as_str(), "" | "xmlns" | "xml") {
                    out.insert(attr_prefix);
                }
            }
        }
    }
    Ok(out)
}

/// La radice del file con gli spazi dei nomi del codec che le unità scritte
/// usano e il file non dichiara, e i loro prefissi ignorabili. Un prefisso
/// che il file usa per un altro spazio dei nomi non si innesta.
fn merged_root(
    o_tag: &[u8],
    n_tag: &[u8],
    used: &BTreeSet<String>,
) -> Result<Option<Vec<u8>>, GraftError> {
    let (o_start, o_decl) = root_of(o_tag)?;
    let (n_start, n_decl) = root_of(n_tag)?;
    let mut added: Declarations = Vec::new();
    for (prefix, uri) in n_decl.iter().filter(|(prefix, _)| used.contains(prefix)) {
        match o_decl.iter().find(|(p, _)| p == prefix) {
            Some((_, ns)) if ns == uri => {}
            Some(_) => return Err(shape(format!("namespace prefix {prefix:?} differs"))),
            None => added.push((prefix.clone(), uri.clone())),
        }
    }
    let o_ignorable = ignorable(&o_start, &o_decl);
    let mut wanted = o_ignorable.clone();
    for prefix in ignorable(&n_start, &n_decl) {
        if used.contains(&prefix) && !wanted.contains(&prefix) {
            wanted.push(prefix);
        }
    }
    if added.is_empty() && wanted == o_ignorable {
        return Ok(None);
    }
    // Un prefisso ignorabile nuovo su un file che non dichiara la
    // compatibilità: la dichiarazione è quella del codec.
    if wanted != o_ignorable
        && prefix_of(&o_decl, NS_MC).is_none()
        && prefix_of(&added, NS_MC).is_none()
    {
        let mc =
            prefix_of(&n_decl, NS_MC).ok_or_else(|| shape("no markup-compatibility prefix"))?;
        if o_decl.iter().any(|(p, _)| p == mc) {
            return Err(shape(format!("namespace prefix {mc:?} differs")));
        }
        added.push((mc.to_string(), NS_MC.to_string()));
    }
    let mut all = o_decl.clone();
    all.extend(added.iter().cloned());
    let ignorable_name = prefix_of(&all, NS_MC).map(|mc| format!("{mc}:Ignorable"));
    let mut tag = BytesStart::new(String::from_utf8_lossy(o_start.name().as_ref()).into_owned());
    for attr in o_start.attributes() {
        let attr = attr.map_err(xml)?;
        if ignorable_name
            .as_ref()
            .is_some_and(|name| attr.key.as_ref() == name.as_bytes())
        {
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
        let name = ignorable_name.ok_or_else(|| shape("no markup-compatibility prefix"))?;
        tag.push_attribute((name.as_str(), wanted.join(" ").as_str()));
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

/// Gli elementi di una revisione tracciata, il cui `w:id` è unico nel
/// documento.
const REVISIONS: &[&str] = &[
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "rPrChange",
    "pPrChange",
    "sectPrChange",
    "tblPrChange",
    "tblGridChange",
    "trPrChange",
    "tcPrChange",
    "numberingChange",
    "cellIns",
    "cellDel",
    "cellMerge",
    "customXmlInsRangeStart",
    "customXmlInsRangeEnd",
    "customXmlDelRangeStart",
    "customXmlDelRangeEnd",
    "customXmlMoveFromRangeStart",
    "customXmlMoveFromRangeEnd",
    "customXmlMoveToRangeStart",
    "customXmlMoveToRangeEnd",
];

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

/// Un riferimento che il modello tiene come oggetto del paragrafo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Ref {
    CommentStart,
    CommentEnd,
    Footnote,
    Endnote,
    PermStart,
    PermEnd,
}

impl Ref {
    fn of_element(local: &str) -> Option<Ref> {
        Some(match local {
            "commentRangeStart" => Ref::CommentStart,
            "commentRangeEnd" => Ref::CommentEnd,
            "footnoteReference" => Ref::Footnote,
            "endnoteReference" => Ref::Endnote,
            "permStart" => Ref::PermStart,
            "permEnd" => Ref::PermEnd,
            _ => return None,
        })
    }

    /// La famiglia di numeri: inizio e fine di un intervallo ne condividono
    /// uno, e un `w:commentReference` è quello del suo commento.
    fn family(self) -> &'static str {
        match self {
            Ref::CommentStart | Ref::CommentEnd => "comment",
            Ref::Footnote => "footnote",
            Ref::Endnote => "endnote",
            Ref::PermStart | Ref::PermEnd => "perm",
        }
    }

    fn of_object(object: &InlineObject) -> Option<(Ref, u32)> {
        Some(match object {
            InlineObject::CommentStart { id } => (Ref::CommentStart, *id),
            InlineObject::CommentEnd { id } => (Ref::CommentEnd, *id),
            InlineObject::NoteRef { kind, id, .. } => match kind {
                NoteKind::Footnote => (Ref::Footnote, *id),
                NoteKind::Endnote => (Ref::Endnote, *id),
            },
            InlineObject::PermStart { id, .. } => (Ref::PermStart, *id),
            InlineObject::PermEnd { id } => (Ref::PermEnd, *id),
            _ => return None,
        })
    }
}

/// Visita gli elementi di un frammento dell'XML del documento, con il loro
/// spazio dei nomi, nell'ordine del file. `scope` sono le dichiarazioni della
/// radice. Il contenuto di `mc:Fallback` ripete quello della scelta e non si
/// visita.
fn each_element(
    bytes: &[u8],
    scope: &Declarations,
    f: &mut dyn FnMut(&str, &str, &BytesStart<'_>) -> Result<(), GraftError>,
) -> Result<(), GraftError> {
    let mut reader = Reader::from_reader(bytes);
    let mut scopes: Vec<Declarations> = vec![scope.clone()];
    loop {
        let event = reader.read_event().map_err(xml)?;
        let (start, empty) = match event {
            Event::Start(start) => (start, false),
            Event::Empty(start) => (start, true),
            Event::End(_) => {
                scopes.pop();
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let local_decl = declarations_of(&start)?;
        let (prefix, local) = split_name(start.name().as_ref());
        let ns = lookup(&prefix, &local_decl, &scopes).unwrap_or_default();
        if ns == NS_MC && local == "Fallback" && !empty {
            reader.read_to_end(start.name()).map_err(xml)?;
            continue;
        }
        f(&ns, &local, &start)?;
        if !empty {
            scopes.push(local_decl);
        }
    }
    Ok(())
}

/// Le dichiarazioni di spazi dei nomi di un tag.
fn declarations_of(start: &BytesStart<'_>) -> Result<Declarations, GraftError> {
    let mut out = Vec::new();
    for attr in start.attributes() {
        let attr = attr.map_err(xml)?;
        let key = attr.key.as_ref();
        let value = String::from_utf8_lossy(&attr.value).into_owned();
        if key == b"xmlns" {
            out.push((String::new(), value));
        } else if let Some(prefix) = key.strip_prefix(b"xmlns:") {
            out.push((String::from_utf8_lossy(prefix).into_owned(), value));
        }
    }
    Ok(out)
}

fn split_name(name: &[u8]) -> (String, String) {
    let name = String::from_utf8_lossy(name).into_owned();
    match name.split_once(':') {
        Some((prefix, local)) => (prefix.to_string(), local.to_string()),
        None => (String::new(), name),
    }
}

/// Lo spazio dei nomi di `prefix`, fra le dichiarazioni del tag e quelle in
/// vigore.
fn lookup(prefix: &str, local: &Declarations, scopes: &[Declarations]) -> Option<String> {
    local
        .iter()
        .rev()
        .chain(scopes.iter().rev().flat_map(|s| s.iter().rev()))
        .find(|(p, _)| p == prefix)
        .map(|(_, uri)| uri.clone())
}

/// Il valore di `w:id` di un tag del documento.
fn w_id(start: &BytesStart<'_>, scope: &[Declarations]) -> Result<Option<String>, GraftError> {
    let local = declarations_of(start)?;
    for attr in start.attributes() {
        let attr = attr.map_err(xml)?;
        let (prefix, name) = split_name(attr.key.as_ref());
        if name == "id"
            && !prefix.is_empty()
            && lookup(&prefix, &local, scope).as_deref() == Some(NS_W)
        {
            return Ok(Some(String::from_utf8_lossy(&attr.value).into_owned()));
        }
    }
    Ok(None)
}

/// I riferimenti di un frammento, nell'ordine del file.
fn file_refs(bytes: &[u8], scope: &Declarations) -> Result<Vec<(Ref, String)>, GraftError> {
    let mut out = Vec::new();
    let scopes = [scope.clone()];
    each_element(bytes, scope, &mut |ns, local, start| {
        if ns == NS_W {
            if let Some(kind) = Ref::of_element(local) {
                let id =
                    w_id(start, &scopes)?.ok_or_else(|| shape(format!("{local} without id")))?;
                out.push((kind, id));
            }
        }
        Ok(())
    })?;
    Ok(out)
}

/// I riferimenti dei blocchi di un documento, nell'ordine in cui il file li
/// scrive: i paragrafi in ordine, gli oggetti di ognuno in ordine, e dentro
/// una casella di testo i paragrafi della sua storia.
fn model_refs(document: &Document, blocks: &[Arc<Block>]) -> Vec<(Ref, u32)> {
    fn walk(document: &Document, block: &Block, depth: usize, out: &mut Vec<(Ref, u32)>) {
        each_paragraph(block, &mut |paragraph| {
            for object in &paragraph.objects {
                if let Some(found) = Ref::of_object(object) {
                    out.push(found);
                }
                // Una catena di caselle che torna su sé stessa si ferma.
                if depth < 16 {
                    for id in object.text_boxes() {
                        if let Some(part) = document.parts.get(&id) {
                            for block in &part.blocks {
                                walk(document, block, depth + 1, out);
                            }
                        }
                    }
                }
            }
        });
    }
    let mut out = Vec::new();
    for block in blocks {
        walk(document, block, 0, &mut out);
    }
    out
}

/// Il numero di ogni oggetto del modello nei byte di un pacchetto, per
/// famiglia: il k-esimo riferimento di una specie in un'unità è il k-esimo
/// oggetto di quella specie nei blocchi dell'unità. Una famiglia in cui i
/// conteggi non tornano, o in cui un oggetto avrebbe due numeri, è
/// **ambigua**: chi la incontra non innesta.
#[derive(Debug, Default)]
struct Identity {
    /// (famiglia, id del modello) → numero nel file.
    file: HashMap<(&'static str, u32), String>,
    /// (famiglia, numero nel file) → id del modello.
    model: HashMap<(&'static str, String), u32>,
    ambiguous: HashSet<&'static str>,
}

impl Identity {
    fn of(main: &Main, xml_bytes: &[u8], document: &Document) -> Result<Identity, GraftError> {
        let (_, scope) = root_of(&xml_bytes[main.scan.root.clone()])?;
        let mut out = Identity::default();
        for unit in &main.scan.units {
            let found = file_refs(&xml_bytes[unit.bytes.clone()], &scope)?;
            let blocks = document
                .body
                .get(unit.blocks.clone())
                .ok_or_else(|| shape("unit past the model body"))?;
            let wanted = model_refs(document, blocks);
            let kinds: HashSet<Ref> = found
                .iter()
                .map(|(k, _)| *k)
                .chain(wanted.iter().map(|(k, _)| *k))
                .collect();
            for kind in kinds {
                let in_file = found.iter().filter(|(k, _)| *k == kind).map(|(_, id)| id);
                let in_model = wanted.iter().filter(|(k, _)| *k == kind).map(|(_, id)| *id);
                if in_file.clone().count() != in_model.clone().count() {
                    out.ambiguous.insert(kind.family());
                    continue;
                }
                for (number, id) in in_file.zip(in_model) {
                    out.pair(kind.family(), id, number.clone());
                }
            }
        }
        Ok(out)
    }

    fn pair(&mut self, family: &'static str, id: u32, number: String) {
        let one = self
            .file
            .entry((family, id))
            .or_insert_with(|| number.clone());
        let other = self.model.entry((family, number.clone())).or_insert(id);
        if *one != number || *other != id {
            self.ambiguous.insert(family);
        }
    }
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
    /// L'identità degli oggetti nel file e nei byte del codec.
    o_identity: Identity,
    n_identity: Identity,
    /// I `w14:paraId` già presi nel documento innestato.
    para_ids: HashSet<String>,
    next_para: u32,
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
                        && class_of(&self.o.types.of(&resolve(&self.o.part, &o.target))).as_deref()
                            == Some(class.as_str())
                })
                .collect();
            return match same.as_slice() {
                [one] => Ok(one.id.clone()),
                _ => Err(shape(format!("relationship to the {class} part"))),
            };
        }
        let digest = sha256(bytes);
        // Le parti di un inchiostro sono soltanto sue: riprese da un'altra
        // relazione coi byte uguali, l'immagine di ripiego avrebbe il nome di
        // un'altra immagine, o di un inchiostro tolto. Si riprende soltanto
        // la parte col suo stesso nome.
        let own = path.starts_with("word/ink/");
        for o in &self.o.rels {
            if o.external || o.kind != rel.kind {
                continue;
            }
            let o_path = resolve(&self.o.part, &o.target);
            if own && o_path != path {
                continue;
            }
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
        if let Some(added) = self.additions.parts.iter().position(|(name, added)| {
            (!own || name.eq_ignore_ascii_case(&path)) && sha256(added) == digest
        }) {
            let name = self.additions.parts[added].0.clone();
            if let Some(found) = self.additions.rels.iter().find(|r| {
                r.kind == rel.kind && resolve(&self.o.part, &r.target) == name.to_ascii_lowercase()
            }) {
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
        let ext = key
            .rsplit_once('.')
            .map(|(_, e)| e.to_string())
            .unwrap_or_default();
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
                    let (start, local) = self.element(start, &scopes)?;
                    scopes.push(local);
                    writer.write_event(Event::Start(start)).map_err(xml)?;
                }
                Event::Empty(start) => {
                    let (start, _) = self.element(start, &scopes)?;
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
        scopes: &[Declarations],
    ) -> Result<(BytesStart<'b>, Declarations), GraftError> {
        // Le dichiarazioni di questo elemento valgono già per lui.
        let local = declarations_of(&start)?;
        let (prefix, element) = split_name(start.name().as_ref());
        let element_ns = lookup(&prefix, &local, scopes).unwrap_or_default();
        let mut out = BytesStart::new(String::from_utf8_lossy(start.name().as_ref()).into_owned());
        let mut changed = false;
        let mut attrs = Vec::new();
        for attr in start.attributes() {
            let attr = attr.map_err(xml)?;
            let key = attr.key.as_ref().to_vec();
            let (attr_prefix, attr_local) = split_name(&key);
            let attr_ns = match attr_prefix.as_str() {
                "" => String::new(),
                "xmlns" => "xmlns".into(),
                p => lookup(p, &local, scopes).unwrap_or_default(),
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

    /// Il numero nel file dell'oggetto che il codec ha scritto con `value`,
    /// per identità ([`Identity`]). Un oggetto che il file non ha prende un
    /// numero nuovo se `fresh`, altrimenti l'innesto non si fa.
    fn identical(
        &mut self,
        family: &'static str,
        value: &str,
        fresh: bool,
    ) -> Result<String, GraftError> {
        if self.n_identity.ambiguous.contains(family) || self.o_identity.ambiguous.contains(family)
        {
            return Err(shape(format!("ambiguous {family} identity")));
        }
        let found = self
            .n_identity
            .model
            .get(&(family, value.to_string()))
            .and_then(|id| self.o_identity.file.get(&(family, *id)))
            .cloned();
        match found {
            Some(number) => Ok(number),
            None if fresh => Ok(self.fresh_id(family, value)),
            None => Err(shape(format!("{family} {value} not in the file"))),
        }
    }

    /// Un `w14:paraId` unico nel documento innestato: quello del codec, se
    /// nessun altro paragrafo lo ha già.
    fn para_id(&mut self, value: &str) -> Result<Option<String>, GraftError> {
        if self.para_ids.insert(value.to_ascii_uppercase()) {
            return Ok(None);
        }
        loop {
            self.next_para += 1;
            // Il valore deve stare sotto 0x80000000.
            if self.next_para >= 0x8000_0000 {
                return Err(shape("no paragraph id left"));
            }
            let candidate = format!("{:08X}", self.next_para);
            if self.para_ids.insert(candidate.clone()) {
                return Ok(Some(candidate));
            }
        }
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
        if ns == NS_W14 && name == "paraId" {
            return self.para_id(value);
        }
        if element_ns == NS_WP && element == "docPr" && ns.is_empty() && name == "id" {
            self.next_drawing += 1;
            return Ok(Some(self.next_drawing.to_string()));
        }
        if element_ns != NS_W || ns != NS_W || name != "id" {
            return Ok(None);
        }
        let new = match element {
            "bookmarkStart" | "bookmarkEnd" => self.bookmark(value),
            "commentReference" => self.identical(Ref::CommentEnd.family(), value, false)?,
            "moveFromRangeStart" | "moveFromRangeEnd" => self.fresh_id("moveFrom", value),
            "moveToRangeStart" | "moveToRangeEnd" => self.fresh_id("moveTo", value),
            local if REVISIONS.contains(&local) => self.fresh_id("revision", value),
            local => match Ref::of_element(local) {
                Some(kind) => self.identical(kind.family(), value, kind.family() == "perm")?,
                // Un altro `w:id` (la disposizione asiatica, per esempio)
                // raggruppa e non deve essere unico: resta del codec.
                None => return Ok(None),
            },
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

/// Riscrive un XML di elenco (relazioni, tipi di contenuto): toglie gli
/// elementi `element` per cui `drop` dice sì e aggiunge `entries` prima della
/// chiusura della radice. Il resto resta com'è, evento per evento.
fn listing(
    bytes: &[u8],
    element: &[u8],
    drop: &dyn Fn(&BytesStart<'_>) -> bool,
    entries: &str,
) -> Result<Vec<u8>, GraftError> {
    let mut reader = Reader::from_reader(bytes);
    let mut writer = Writer::new(Vec::with_capacity(bytes.len() + entries.len()));
    let mut depth = 0usize;
    let mut skipping = 0usize;
    let mut closed = false;
    loop {
        let event = reader.read_event().map_err(xml)?;
        match &event {
            Event::Start(start)
                if skipping > 0
                    || (depth == 1 && start.local_name().as_ref() == element && drop(start)) =>
            {
                skipping += 1;
                depth += 1;
                continue;
            }
            Event::Empty(start)
                if skipping > 0
                    || (depth == 1 && start.local_name().as_ref() == element && drop(start)) =>
            {
                continue;
            }
            Event::End(_) if skipping > 0 => {
                skipping -= 1;
                depth -= 1;
                continue;
            }
            _ if skipping > 0 => continue,
            Event::Empty(start) if depth == 0 => {
                // Una radice vuota: si apre per le voci nuove.
                writer
                    .write_event(Event::Start(start.clone()))
                    .map_err(xml)?;
                writer.get_mut().extend_from_slice(entries.as_bytes());
                writer
                    .write_event(Event::End(start.to_end()))
                    .map_err(xml)?;
                closed = true;
                continue;
            }
            Event::Start(_) => depth += 1,
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    writer.get_mut().extend_from_slice(entries.as_bytes());
                    closed = true;
                }
            }
            Event::Eof => break,
            _ => {}
        }
        writer.write_event(event).map_err(xml)?;
    }
    if !closed {
        return Err(shape("listing without a root"));
    }
    Ok(writer.into_inner())
}

fn attribute_of(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    start
        .attributes()
        .flatten()
        .find(|attr| attr.key.as_ref() == name)
        .map(|attr| String::from_utf8_lossy(&attr.value).into_owned())
}

/// Le relazioni del documento principale, senza quelle tolte e con quelle
/// nuove.
fn rels_xml(
    existing: Option<&[u8]>,
    removed: &BTreeSet<String>,
    added: &[NewRel],
) -> Result<Vec<u8>, GraftError> {
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
        Some(bytes) => listing(
            bytes,
            b"Relationship",
            &|start| attribute_of(start, b"Id").is_some_and(|id| removed.contains(&id)),
            &entries,
        ),
        None => Ok(format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{entries}</Relationships>"#
        )
        .into_bytes()),
    }
}

/// I tipi di contenuto, senza le parti tolte e con le voci nuove.
fn types_xml(
    bytes: &[u8],
    additions: &Additions,
    rels: bool,
    removed: &BTreeSet<String>,
) -> Result<Vec<u8>, GraftError> {
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
    listing(
        bytes,
        b"Override",
        &|start| {
            attribute_of(start, b"PartName").is_some_and(|name| {
                removed.contains(&name.trim_start_matches('/').to_ascii_lowercase())
            })
        },
        &entries,
    )
}

/// Gli id delle relazioni che un XML nomina, in ogni suo attributo dello
/// spazio dei nomi delle relazioni.
fn rel_refs(xml_bytes: &[u8]) -> Result<BTreeSet<String>, GraftError> {
    let mut reader = NsReader::from_reader(xml_bytes);
    let mut out = BTreeSet::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf).map_err(xml)? {
            Event::Start(start) | Event::Empty(start) => {
                for attr in start.attributes() {
                    let attr = attr.map_err(xml)?;
                    let (ns, _) = reader.resolver().resolve_attribute(attr.key);
                    if namespace(&ns) == NS_RELATIONSHIPS {
                        out.insert(String::from_utf8_lossy(&attr.value).into_owned());
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

/// La sorgente di una parte di relazioni (`word/_rels/document.xml.rels` →
/// `word/document.xml`).
fn source_of_rels(name: &str) -> Option<String> {
    let (dir, file) = name.rsplit_once("_rels/")?;
    let file = file.strip_suffix(".rels")?;
    Some(format!("{dir}{file}"))
}

/// Ciò che il corpo innestato non nomina più: le relazioni del documento
/// principale che il file nominava dal contenuto, e le parti che soltanto
/// loro raggiungevano, con le loro relazioni e ciò che soltanto quelle
/// raggiungevano. Un'immagine cancellata non resta nel file.
fn unreferenced(
    o: &Main,
    o_xml: &[u8],
    body: &[u8],
    limits: &Limits,
) -> Result<(BTreeSet<String>, BTreeSet<String>), GraftError> {
    let before = rel_refs(o_xml)?;
    let after = rel_refs(body)?;
    let gone: BTreeSet<String> = before.difference(&after).cloned().collect();
    // Quante relazioni raggiungono ogni parte, nel pacchetto com'è.
    let mut incoming: HashMap<String, usize> = HashMap::new();
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for name in o.zip.parts.keys().filter(|name| name.ends_with(".rels")) {
        let Some(source) = source_of_rels(name) else {
            continue;
        };
        for rel in read_rels(&o.zip, &source, limits).map_err(|e| shape(e.to_string()))? {
            if rel.external {
                continue;
            }
            let target = resolve(&source, &rel.target);
            *incoming.entry(target.clone()).or_default() += 1;
            outgoing.entry(source.clone()).or_default().push(target);
        }
    }
    let mut todo: Vec<String> = o
        .rels
        .iter()
        .filter(|rel| gone.contains(&rel.id) && !rel.external)
        .map(|rel| resolve(&o.part, &rel.target))
        .collect();
    let mut parts = BTreeSet::new();
    while let Some(path) = todo.pop() {
        let Some(count) = incoming.get_mut(&path) else {
            continue;
        };
        *count -= 1;
        if *count > 0 || path == o.part || !o.zip.parts.contains_key(&path) {
            continue;
        }
        parts.insert(path.clone());
        parts.insert(crate::inventory::rels_of(&path));
        todo.extend(outgoing.get(&path).cloned().unwrap_or_default());
    }
    parts.retain(|name| o.zip.parts.contains_key(name));
    Ok((gone, parts))
}

/// I `w14:paraId` di un frammento.
fn para_ids_of(bytes: &[u8], scope: &Declarations) -> Result<Vec<String>, GraftError> {
    let mut out = Vec::new();
    let scopes = [scope.clone()];
    each_element(bytes, scope, &mut |_, _, start| {
        let local = declarations_of(start)?;
        for attr in start.attributes() {
            let attr = attr.map_err(xml)?;
            let (prefix, name) = split_name(attr.key.as_ref());
            if name == "paraId"
                && !prefix.is_empty()
                && lookup(&prefix, &local, &scopes).as_deref() == Some(NS_W14)
            {
                out.push(String::from_utf8_lossy(&attr.value).to_ascii_uppercase());
            }
        }
        Ok(())
    })?;
    Ok(out)
}

/// Gli intervalli di uno spostamento nelle unità scritte devono chiudersi lì:
/// i loro numeri sono nuovi, e un capo rimasto nel file non li avrebbe.
fn closed_moves(fragments: &[&[u8]], scope: &Declarations) -> Result<(), GraftError> {
    let mut open: HashMap<(String, String), i64> = HashMap::new();
    let scopes = [scope.clone()];
    for fragment in fragments {
        each_element(fragment, scope, &mut |ns, local, start| {
            if ns != NS_W {
                return Ok(());
            }
            let (family, step) = match local {
                "moveFromRangeStart" => ("moveFrom", 1),
                "moveFromRangeEnd" => ("moveFrom", -1),
                "moveToRangeStart" => ("moveTo", 1),
                "moveToRangeEnd" => ("moveTo", -1),
                _ => return Ok(()),
            };
            let id = w_id(start, &scopes)?.unwrap_or_default();
            *open.entry((family.to_string(), id)).or_default() += step;
            Ok(())
        })?;
    }
    match open.iter().find(|(_, count)| **count != 0) {
        Some(((family, id), _)) => Err(shape(format!(
            "{family} range {id} crosses an untouched unit"
        ))),
        None => Ok(()),
    }
}

/// Innesta nel file `original`, già letto in `o` e nella base `base`, le
/// unità toccate del pacchetto `n` che il codec ha scritto per il documento
/// voluto `wanted`, secondo `pieces` ([`plan`]).
pub(crate) fn graft(
    original: &[u8],
    o: &Main,
    n: &Main,
    base: &Document,
    wanted: &Document,
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
    let (_, o_scope) = root_of(&o_xml[o.scan.root.clone()])?;
    let (_, n_scope) = root_of(&n_xml[n.scan.root.clone()])?;
    let written: Vec<&[u8]> = pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Written(at) => Some(&n_xml[n.scan.units[*at].bytes.clone()]),
            Piece::Kept(_) => None,
        })
        .collect();
    closed_moves(&written, &n_scope)?;
    // Anche le unità del file che l'innesto sostituisce: un intervallo che vi
    // si chiude e comincia in un'unità che resta perderebbe un capo.
    let kept: HashSet<usize> = pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Kept(at) => Some(*at),
            Piece::Written(_) => None,
        })
        .collect();
    let replaced: Vec<&[u8]> = (0..o.scan.units.len())
        .filter(|at| !kept.contains(at))
        .map(|at| &o_xml[o.scan.units[at].bytes.clone()])
        .collect();
    closed_moves(&replaced, &o_scope)?;
    // Le letture dei due documenti non si parlano: insieme.
    let ((para_ids, (o_ids, n_ids)), (o_identity, n_identity)) = parallel::join(
        || {
            parallel::join(
                || -> Result<HashSet<_>, GraftError> {
                    let mut para_ids = HashSet::new();
                    for piece in pieces {
                        if let Piece::Kept(at) = piece {
                            para_ids.extend(para_ids_of(
                                &o_xml[o.scan.units[*at].bytes.clone()],
                                &o_scope,
                            )?);
                        }
                    }
                    Ok(para_ids)
                },
                || parallel::join(|| ids_of(o_xml, limits), || ids_of(n_xml, limits)),
            )
        },
        || {
            parallel::join(
                || Identity::of(o, o_xml, base),
                || Identity::of(n, n_xml, wanted),
            )
        },
    );
    let (para_ids, o_ids, n_ids) = (para_ids?, o_ids?, n_ids?);
    let (o_identity, n_identity) = (o_identity?, n_identity?);
    // Un numero nuovo non deve ripetere quello di una revisione o di un
    // segnalibro delle altre storie: intestazioni, note, commenti.
    let mut next_id = o_ids.max_id;
    for (name, bytes) in &o.zip.parts {
        let story = matches!(
            class_of(&o.types.of(name)).as_deref(),
            Some("header" | "footer" | "footnotes" | "endnotes" | "comments")
        );
        if story && *name != o.part {
            next_id = next_id.max(ids_of(bytes, limits)?.max_id);
        }
    }
    let mut remap = Remap {
        o,
        n,
        next_id,
        next_drawing: o_ids.max_drawing,
        o_ids,
        n_ids,
        o_identity,
        n_identity,
        para_ids,
        next_para: 0,
        rels: HashMap::new(),
        fresh: HashMap::new(),
        additions: Additions::default(),
        o_rel_ids: o.rels.iter().map(|rel| rel.id.clone()).collect(),
    };

    let mut body = Vec::with_capacity(o_xml.len());
    body.extend_from_slice(&o_xml[..o.scan.root.start]);
    let used = used_prefixes(&written)?;
    match merged_root(
        &o_xml[o.scan.root.clone()],
        &n_xml[n.scan.root.clone()],
        &used,
    )? {
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
    let tail = o
        .scan
        .units
        .last()
        .map_or(o.scan.head, |unit| unit.bytes.end);
    body.extend_from_slice(&o_xml[tail..]);

    // Le voci da sostituire, per nome in minuscolo, quelle nuove e quelle
    // da togliere.
    let (gone, removed) = unreferenced(o, o_xml, &body, limits)?;
    let mut replaced: HashMap<String, Vec<u8>> = HashMap::new();
    let mut added: Vec<(String, Vec<u8>)> = Vec::new();
    replaced.insert(o.part.clone(), body);
    let additions = std::mem::take(&mut remap.additions);
    if !additions.rels.is_empty() || !gone.is_empty() {
        let name = crate::inventory::rels_of(&o.part);
        let existing = o.zip.parts.get(&name).map(Vec::as_slice);
        let xml_bytes = rels_xml(existing, &gone, &additions.rels)?;
        match existing {
            Some(_) => {
                replaced.insert(name, xml_bytes);
            }
            None => added.push((name, xml_bytes)),
        }
    }
    let rels_type = !o.types.defaults.contains_key("rels")
        && added.iter().any(|(name, _)| name.ends_with(".rels"));
    if !additions.defaults.is_empty()
        || !additions.overrides.is_empty()
        || rels_type
        || !removed.is_empty()
    {
        let types = o
            .zip
            .parts
            .get("[content_types].xml")
            .ok_or_else(|| shape("no content types"))?;
        replaced.insert(
            "[content_types].xml".into(),
            types_xml(types, &additions, rels_type, &removed)?,
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
        if removed.contains(&key) {
            continue;
        }
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
