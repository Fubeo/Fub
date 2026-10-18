//! I documenti nuovi: un disegno con radice, titolo, carta e «Livello 1»
//! (§2, §9), e le annotazioni di un PDF con radice e titolo; e il titolo di un
//! disegno che già c'è, [`retitle`], per chi lo copia da un modello.
//!
//! È generazione, non round-trip, come vuole il contratto: un documento che
//! esiste lo modifica la superficie con patch sulla sorgente, e il modello di
//! una scena non ne porta la geometria. Del modello si usano solo il titolo e
//! il nome del documento.

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::path::{relative_ref, resolve_against};
use fub_abi::{Fnv1a, FormatError};
use fub_scene::{Item, Scene, FUB_NS, SUPPORTED_VERSION, SVG_NS};

use crate::escape;
use crate::links::attribute_value;
use crate::render::title_of;

/// Le dimensioni della pagina di un disegno nuovo, in unità utente.
const WIDTH: u32 = 1600;
const HEIGHT: u32 = 1000;

/// Il nome del livello di un disegno nuovo (§3).
const FIRST_LAYER: &str = "Livello 1";

/// Il documento nuovo, in forma canonica (§7) e con righe LF.
///
/// Il titolo è quello del primo heading di livello 1 del modello, o della sua
/// `outline`; senza, il nome del file. Si rilegge prima di restituirlo: un
/// documento che `fub-scene` non legge come scena FubDraw modificabile, con
/// quel titolo e quel livello, è un errore e non un file scritto.
pub(crate) fn new_document(model: &DocumentModel) -> Result<String, FormatError> {
    let title = title(model);
    let layer = layer_id(model.id.as_str());
    let source = format!(
        concat!(
            "<svg xmlns=\"{svg}\" xmlns:fub=\"{fub}\" fub:version=\"{version}\" ",
            "viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n",
            "  <title>{title}</title>\n",
            "  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" ",
            "width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>\n",
            "  <g id=\"{layer}\" fub:layer=\"{name}\">\n",
            "  </g>\n",
            "</svg>\n",
        ),
        svg = SVG_NS,
        fub = FUB_NS,
        version = SUPPORTED_VERSION,
        w = WIDTH,
        h = HEIGHT,
        title = escape::text(&title),
        layer = layer,
        name = FIRST_LAYER,
    );

    let scene = fub_scene::read(&source).map_err(|error| {
        FormatError::Serialize(format!("il disegno nuovo non si legge: {error}"))
    })?;
    let read_title = scene.index.title.as_ref().map(|t| t.text.as_str());
    if !scene.editable()
        || read_title != Some(title.as_str()).filter(|t| !t.is_empty())
        || scene.summary.layers != [FIRST_LAYER]
    {
        return Err(FormatError::Serialize(format!(
            "il disegno nuovo «{title}» non si rilegge come è stato scritto"
        )));
    }
    Ok(source)
}

/// Le annotazioni nuove di un PDF, in forma canonica e con righe LF: la
/// radice con `fub:annotates` e il titolo, e nient'altro.
///
/// Il PDF annotato viene dal nome: `Bando.pdf.fubann` annota `Bando.pdf`
/// nella stessa cartella, come lo cerca chi apre il PDF. Un nome che non
/// finisce in `.pdf.fubann` dà annotazioni senza `fub:annotates`. Impronta,
/// numero di pagine e gruppi di pagina li scrive chi apre il PDF, che li
/// conosce: il provider ha solo il modello. Niente `viewBox` né carta, perché
/// ogni pagina ha le sue coordinate.
///
/// Si rilegge prima di restituirlo, come un disegno nuovo: deve essere
/// modificabile, con quel titolo, e il PDF annotato deve risolversi nel
/// documento accanto.
pub(crate) fn new_annotations(model: &DocumentModel) -> Result<String, FormatError> {
    let title = title(model);
    let pdf = annotated_of(&model.id);
    let annotates = match &pdf {
        Some(pdf) => format!(
            " fub:annotates=\"{}\"",
            attribute_value(&relative_ref(&model.id, pdf), '"')?
        ),
        None => String::new(),
    };
    let source = format!(
        concat!(
            "<svg xmlns=\"{svg}\" xmlns:fub=\"{fub}\" fub:version=\"{version}\"{annotates}>\n",
            "  <title>{title}</title>\n",
            "</svg>\n",
        ),
        svg = SVG_NS,
        fub = FUB_NS,
        version = SUPPORTED_VERSION,
        annotates = annotates,
        title = escape::text(&title),
    );

    let annotations = fub_scene::read_annotations(&source).map_err(|error| {
        FormatError::Serialize(format!("le annotazioni nuove non si leggono: {error}"))
    })?;
    let read_title = annotations
        .scene
        .index
        .title
        .as_ref()
        .map(|t| t.text.as_str());
    let read_pdf = annotations
        .annotates
        .as_ref()
        .and_then(|annotated| resolve_against(&model.id, &annotated.path));
    if !annotations.scene.editable()
        || read_title != Some(title.as_str()).filter(|t| !t.is_empty())
        || read_pdf.as_deref() != pdf.as_ref().map(DocId::as_str)
    {
        return Err(FormatError::Serialize(format!(
            "le annotazioni nuove «{title}» non si rileggono come sono state scritte"
        )));
    }
    Ok(source)
}

/// Il disegno `source` con `title` per titolo: la copia di un modello, o di
/// un disegno del vault, che nasce con il proprio nome come un disegno vuoto.
///
/// Del documento cambia soltanto il titolo, e il resto resta byte per byte:
/// la dichiarazione XML, il doctype e i commenti prima della radice, gli
/// attributi, le fine riga e il BOM. Se la radice ha un `<title>` con del
/// testo se ne sostituisce il testo, e gli attributi dell'elemento restano; se
/// manca o è vuoto, il titolo nuovo entra come **primo figlio** della radice,
/// con il rientro del figlio che segue, e un `<title>` vuoto in testa ne
/// prende il posto. Il titolo si scrive come lo legge l'indice (una riga sola,
/// spazi ridotti a uno, niente caratteri che XML 1.0 non ammette) ed è
/// escapato: un nome come `Mari & Monti` non apre un tag.
///
/// Si rilegge prima di restituirlo, come un disegno nuovo: la sorgente deve
/// essere una scena FubDraw modificabile, e il risultato deve esserlo ancora,
/// con quel titolo e gli stessi livelli, tavole e oggetti. Una sorgente che
/// non lo è (un SVG scritto da un altro programma, un file troncato, una
/// radice con un prefisso di namespace dove il titolo non entrerebbe) è un
/// errore, e non una copia sbagliata.
pub fn retitle(source: &str, title: &str) -> Result<String, FormatError> {
    let title = plain(title);
    if title.is_empty() {
        return Err(FormatError::Serialize("il titolo è vuoto".into()));
    }
    let before = fub_scene::read(source)
        .map_err(|error| FormatError::Serialize(format!("il disegno non si legge: {error}")))?;
    if !before.editable() {
        return Err(FormatError::Serialize(
            "non è una scena FubDraw che si possa modificare".into(),
        ));
    }
    let text = escape::text(&title);
    let written = match &before.index.title {
        Some(excerpt) => replace_title_text(source, excerpt.span.bytes, &text),
        None => insert_title(source, &before, &text),
    }
    .ok_or_else(|| {
        FormatError::Serialize("la radice del disegno non ha la forma di una scena FubDraw".into())
    })?;

    let after = fub_scene::read(&written)
        .map_err(|error| FormatError::Serialize(format!("il disegno non si rilegge: {error}")))?;
    let read_title = after.index.title.as_ref().map(|t| t.text.as_str());
    if !after.editable()
        || read_title != Some(title.as_str())
        || after.summary.layers != before.summary.layers
        || after.summary.boards != before.summary.boards
        || !same_objects(&before.summary.counts, &after.summary.counts)
    {
        return Err(FormatError::Serialize(format!(
            "il disegno con il titolo «{title}» non si rilegge come è stato scritto"
        )));
    }
    Ok(written)
}

/// Gli oggetti della scena sono gli stessi. I blocchi estranei possono
/// calare: un `<title>` con un commento o un `CDATA` dentro ne contava uno, e
/// con il testo nuovo non c'è più.
fn same_objects(before: &fub_scene::Counts, after: &fub_scene::Counts) -> bool {
    after.strokes == before.strokes
        && after.shapes == before.shapes
        && after.texts == before.texts
        && after.images == before.images
        && after.links == before.links
        && after.foreign <= before.foreign
}

/// Gli spazi di XML: i soli che il parser non conta come testo.
const XML_SPACE: [char; 4] = [' ', '\t', '\r', '\n'];

/// Dove finisce il tag di apertura che comincia in `element`: l'indice dopo il
/// `>`, saltando quelli dentro i valori fra virgolette.
fn open_tag_end(element: &str) -> Option<usize> {
    let mut quote = None;
    for (at, c) in element.char_indices() {
        match (quote, c) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(at + 1),
            _ => {}
        }
    }
    None
}

/// `source` con il testo del `<title>` che sta in `bytes` sostituito da `text`.
fn replace_title_text(source: &str, bytes: [usize; 2], text: &str) -> Option<String> {
    let [from, to] = bytes;
    let element = source.get(from..to)?;
    let open = open_tag_end(element)?;
    if element[..open].ends_with("/>") {
        return None;
    }
    let close = element.rfind("</")?;
    if close < open {
        return None;
    }
    Some(format!(
        "{}{text}{}",
        &source[..from + open],
        &source[from + close..]
    ))
}

/// Quanto è lungo, in testa a `rest`, un `<title>` senza testo: `<title/>` o
/// `<title></title>`, anche con gli spazi in mezzo.
fn empty_title_len(rest: &str) -> Option<usize> {
    let after = rest.strip_prefix("<title")?;
    if !after.starts_with(|c: char| XML_SPACE.contains(&c) || c == '>' || c == '/') {
        return None;
    }
    let open = open_tag_end(rest)?;
    if rest[..open].ends_with("/>") {
        return Some(open);
    }
    let close = rest[open..].find("</title>")?;
    rest[open..open + close]
        .trim_matches(XML_SPACE)
        .is_empty()
        .then_some(open + close + "</title>".len())
}

/// `source` con un `<title>` nuovo come primo figlio della radice.
fn insert_title(source: &str, scene: &Scene, text: &str) -> Option<String> {
    let [start, _] = scene.items.iter().find_map(|item| match item {
        Item::Root(root) => Some(root.span.bytes),
        _ => None,
    })?;
    let tag = source.get(start..)?;
    // La radice senza prefisso: è il solo caso in cui un `<title>` senza
    // prefisso sta nel namespace di SVG, che la rilettura poi verifica.
    let name = tag.strip_prefix("<svg")?;
    if !name.starts_with(|c: char| XML_SPACE.contains(&c) || c == '>' || c == '/') {
        return None;
    }
    let open_end = start + open_tag_end(tag)?;
    let eol = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    if source[..open_end].ends_with("/>") {
        // Una radice senza figli: si apre per dare posto al titolo.
        let head = source[..open_end - 2].trim_end_matches(XML_SPACE);
        return Some(format!(
            "{head}>{eol}  <title>{text}</title>{eol}</svg>{}",
            &source[open_end..]
        ));
    }
    let rest = &source[open_end..];
    let content = rest.trim_start_matches(XML_SPACE);
    let gap = &rest[..rest.len() - content.len()];
    if let Some(empty) = empty_title_len(content) {
        return Some(format!(
            "{}{gap}<title>{text}</title>{}",
            &source[..open_end],
            &content[empty..]
        ));
    }
    // Il rientro del primo figlio, se sta a capo; altrimenti il titolo si
    // attacca al tag.
    let indent = if gap.contains('\n') { gap } else { "" };
    Some(format!(
        "{}{indent}<title>{text}</title>{rest}",
        &source[..open_end]
    ))
}

/// Il titolo di un documento nuovo: il primo heading di livello 1 del
/// modello, o della sua `outline`; senza, il nome del file.
fn title(model: &DocumentModel) -> String {
    title_of(&model.body)
        .or_else(|| {
            model
                .outline
                .iter()
                .find(|heading| heading.level == 1)
                .map(|heading| heading.text.clone())
        })
        .map(|title| plain(&title))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| plain(model.id.page_name()))
}

/// Il PDF che le annotazioni `id` annotano per nome: `id` senza `.fubann`, se
/// quel che resta è un `.pdf`. Le estensioni si confrontano senza badare alle
/// maiuscole, e un nome che è solo `.pdf` non è un PDF: come per il vault
/// (`rules::media`).
///
/// È il PDF che un documento nuovo scrive in `fub:annotates`, e quello che vale
/// quando `fub:annotates` manca.
pub fn annotated_of(id: &DocId) -> Option<DocId> {
    let id = id.as_str();
    let cut = id.len().checked_sub(".fubann".len())?;
    let (pdf, extension) = (id.get(..cut)?, id.get(cut..)?);
    let name = pdf.rsplit('/').next().unwrap_or(pdf);
    let stem = name.len().checked_sub(".pdf".len())?;
    let named_pdf = stem > 0 && name.get(stem..)?.eq_ignore_ascii_case(".pdf");
    (extension.eq_ignore_ascii_case(".fubann") && named_pdf).then(|| DocId::new(pdf))
}

/// Il titolo come lo legge l'indice: una riga sola, con gli spazi XML ridotti
/// a uno e niente spazi ai bordi, senza i caratteri che XML 1.0 non ammette
/// nemmeno come riferimento.
fn plain(title: &str) -> String {
    title
        .split([' ', '\t', '\n', '\r'])
        .filter(|word| !word.is_empty())
        .map(|word| word.chars().filter(|&c| xml_char(c)).collect::<String>())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Un carattere che un documento XML 1.0 può contenere.
fn xml_char(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}')
        || c >= '\u{10000}'
}

/// L'id del primo livello: `l` e 8 caratteri base36 (§7).
///
/// Il contratto vuole id casuali perché due disegni non si somiglino; un
/// provider però è una funzione pura e non ha un generatore. L'id viene quindi
/// dal nome del documento, con l'impronta FNV-1a a 64 bit del contratto,
/// [`Fnv1a`]: due disegni diversi hanno livelli diversi, e lo stesso nome dà
/// sempre lo stesso file. L'unicità che conta, quella nel documento, è
/// garantita: il livello è l'unico id oltre alla carta.
fn layer_id(doc: &str) -> String {
    const BASE36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut hash = Fnv1a::hash(doc.as_bytes());
    let mut digits = [b'0'; 8];
    for digit in digits.iter_mut().rev() {
        *digit = BASE36[(hash % 36) as usize];
        hash /= 36;
    }
    let mut id = String::with_capacity(9);
    id.push('l');
    id.extend(digits.iter().map(|&b| char::from(b)));
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_layer_id_is_l_and_eight_base36_digits() {
        for doc in ["", "disegno.svg", "cartella/Ciclo dell'acqua.svg"] {
            let id = layer_id(doc);
            assert_eq!(id.len(), 9, "{id}");
            assert!(id.starts_with('l'));
            assert!(id[1..]
                .bytes()
                .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()));
        }
        assert_ne!(layer_id("a.svg"), layer_id("b.svg"));
        assert_eq!(layer_id("a.svg"), layer_id("a.svg"));
    }

    #[test]
    fn the_annotated_pdf_comes_from_the_name() {
        let pdf = |id: &str| annotated_of(&DocId::new(id)).map(|pdf| pdf.as_str().to_owned());
        assert_eq!(pdf("Bando.pdf.fubann").as_deref(), Some("Bando.pdf"));
        assert_eq!(
            pdf("atti/Bando.PDF.FubAnn").as_deref(),
            Some("atti/Bando.PDF")
        );
        assert_eq!(pdf("atti/è.pdf.fubann").as_deref(), Some("atti/è.pdf"));
        for other in [
            "Bando.fubann",
            "Bando.png.fubann",
            ".pdf.fubann",
            "atti/.pdf.fubann",
            "Bando.pdf",
            "fubann",
            "",
        ] {
            assert_eq!(pdf(other), None, "{other}");
        }
    }

    #[test]
    fn a_title_is_one_line_of_xml_characters() {
        assert_eq!(plain("  Ciclo\n\tdell'acqua  "), "Ciclo dell'acqua");
        assert_eq!(plain("a\u{1}b \u{fffe} c"), "ab c");
        assert_eq!(plain(" \n "), "");
    }
}
