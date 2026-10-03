//! I documenti nuovi: un disegno con radice, titolo, carta e «Livello 1»
//! (§2, §9), e le annotazioni di un PDF con radice e titolo.
//!
//! È generazione, non round-trip, come vuole il contratto: un documento che
//! esiste lo modifica la superficie con patch sulla sorgente, e il modello di
//! una scena non ne porta la geometria. Del modello si usano solo il titolo e
//! il nome del documento.

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::path::{relative_ref, resolve_against};
use fub_abi::{Fnv1a, FormatError};
use fub_scene::{FUB_NS, SUPPORTED_VERSION, SVG_NS};

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
