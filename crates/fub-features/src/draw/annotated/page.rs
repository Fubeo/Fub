//! Disegnare sopra una pagina del PDF.
//!
//! Il disegno delle annotazioni di una pagina è un Form XObject. Per metterlo
//! sulla pagina se ne aggiunge il nome alle risorse e un flusso al contenuto,
//! senza toccare né le risorse condivise con altre pagine né i flussi che ci
//! sono già:
//!
//! - le risorse della pagina diventano un dizionario suo, copia di quelle che
//!   aveva o che ereditava, con un nome nuovo fra gli XObject;
//! - il contenuto diventa un elenco: un flusso che salva lo stato grafico, i
//!   flussi di prima, e un flusso che lo ripristina e disegna. Così la
//!   trasformazione o il colore che il contenuto originale lascia alla fine
//!   non spostano il disegno.
//!
//! Il disegno sta dentro `/Artifact`: in un PDF con la struttura per
//! l'accessibilità non è contenuto del documento, e un lettore di schermo non
//! lo legge in mezzo al testo.

use std::io::Write as _;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

use super::geometry::{inherited, Matrix};

/// Le risorse che la pagina usa: le sue o quelle che eredita, come un
/// dizionario da modificare. Un valore che non è un dizionario vale come
/// assente.
pub(super) fn resources(doc: &Document, page: ObjectId) -> Dictionary {
    inherited(doc, page, b"Resources")
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .cloned()
        .unwrap_or_default()
}

/// I flussi del contenuto della pagina, come riferimenti, in ordine. Ciò che
/// non è un riferimento non è un flusso del contenuto e non si porta.
pub(super) fn contents(doc: &Document, page: ObjectId) -> Vec<Object> {
    let Ok(dict) = doc.get_dictionary(page) else {
        return Vec::new();
    };
    match dict.get(b"Contents") {
        Ok(Object::Reference(id)) => match doc.get_object(*id) {
            Ok(Object::Array(items)) => references(items),
            Ok(_) => vec![Object::Reference(*id)],
            Err(_) => Vec::new(),
        },
        Ok(Object::Array(items)) => references(items),
        _ => Vec::new(),
    }
}

fn references(items: &[Object]) -> Vec<Object> {
    items
        .iter()
        .filter(|item| matches!(item, Object::Reference(_)))
        .cloned()
        .collect()
}

/// Un flusso nuovo, compresso.
pub(super) fn stream(doc: &mut Document, dict: Dictionary, bytes: &[u8]) -> ObjectId {
    let mut dict = dict;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(bytes)
        .expect("scrivere in un vettore non fallisce");
    let compressed = encoder
        .finish()
        .expect("scrivere in un vettore non fallisce");
    dict.set("Filter", "FlateDecode");
    doc.add_object(Stream::new(dict, compressed).with_compression(false))
}

/// Il primo nome libero di `dict` fra `base`, `base1`, `base2`…
pub(super) fn free_name(dict: &Dictionary, base: &str) -> Vec<u8> {
    (0u32..)
        .map(|n| match n {
            0 => base.as_bytes().to_vec(),
            n => format!("{base}{n}").into_bytes(),
        })
        .find(|name| !dict.has(name))
        .expect("la sequenza dei nomi è infinita")
}

/// Mette sulla pagina `page` di `doc` lo XObject `xobject`, con la
/// trasformazione `matrix` dallo spazio dello XObject a quello della pagina.
/// La pagina cambia al suo posto; gli altri oggetti che aveva restano come
/// sono.
pub(super) fn draw(doc: &mut Document, page: ObjectId, xobject: ObjectId, matrix: Matrix) {
    let mut resources = resources(doc, page);
    let mut xobjects = resources
        .get(b"XObject")
        .ok()
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    let name = free_name(&xobjects, "Fub");
    xobjects.set(name.clone(), Object::Reference(xobject));
    resources.set("XObject", Object::Dictionary(xobjects));

    let before = contents(doc, page);
    let drawing = format!(
        "/Artifact BMC q {} cm /{} Do Q EMC\n",
        operands(&matrix.0),
        String::from_utf8_lossy(&name)
    );
    let mut list = Vec::with_capacity(before.len() + 2);
    if before.is_empty() {
        list.push(Object::Reference(stream(
            doc,
            Dictionary::new(),
            drawing.as_bytes(),
        )));
    } else {
        list.push(Object::Reference(stream(doc, Dictionary::new(), b"q\n")));
        list.extend(before);
        let tail = format!("\nQ\n{drawing}");
        list.push(Object::Reference(stream(
            doc,
            Dictionary::new(),
            tail.as_bytes(),
        )));
    }

    let dict = doc
        .get_dictionary_mut(page)
        .expect("la pagina è un dizionario: se ne è appena letta la geometria");
    dict.set("Resources", Object::Dictionary(resources));
    dict.set("Contents", Object::Array(list));
}

/// Numeri separati da spazi, come gli operandi di un operatore.
pub(super) fn operands(values: &[f64]) -> String {
    values
        .iter()
        .map(|v| number(*v))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Un numero come lo scrive un PDF: senza esponente, al più sei decimali e
/// senza zeri in coda.
pub(super) fn number(value: f64) -> String {
    let value = if value.abs() < 5e-7 { 0.0 } else { value };
    let mut text = format!("{value:.6}");
    while text.contains('.') && (text.ends_with('0') || text.ends_with('.')) {
        text.pop();
    }
    if text == "-0" {
        text = "0".to_string();
    }
    text
}

/// Un numero reale per un dizionario.
pub(super) fn real(value: f64) -> Object {
    Object::Real(value as f32)
}

/// Il dizionario di un Form XObject, con le risorse date.
pub(super) fn form(bbox: [f64; 4], resources: Dictionary) -> Dictionary {
    dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "BBox" => bbox.iter().map(|v| real(*v)).collect::<Vec<_>>(),
        "Resources" => resources,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read as _;

    fn inflate(doc: &Document, id: &Object) -> String {
        let Object::Stream(stream) = doc.get_object(id.as_reference().unwrap()).unwrap() else {
            panic!("un flusso");
        };
        let mut out = String::new();
        ZlibDecoder::new(stream.content.as_slice())
            .read_to_string(&mut out)
            .unwrap();
        out
    }

    #[test]
    fn numbers_have_no_exponent_and_no_trailing_zeros() {
        assert_eq!(number(1.0), "1");
        assert_eq!(number(-0.0), "0");
        assert_eq!(number(1e-9), "0");
        assert_eq!(number(595.275_590_551), "595.275591");
        assert_eq!(number(-12.5), "-12.5");
        assert_eq!(number(1e7), "10000000");
        assert_eq!(
            operands(&[1.0, 0.0, 0.0, -1.0, 0.0, 842.0]),
            "1 0 0 -1 0 842"
        );
    }

    #[test]
    fn drawing_wraps_the_content_and_copies_shared_resources() {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font" });
        let shared = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font },
            "XObject" => dictionary! { "Fub" => Object::Null },
        });
        let content = doc.add_object(Stream::new(Dictionary::new(), b"BT ET".to_vec()));
        let page = doc
            .add_object(dictionary! { "Type" => "Page", "Parent" => pages, "Contents" => content });
        doc.objects.insert(
            pages,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Resources" => shared, "Kids" => vec![page.into()], "Count" => 1 }),
        );
        let xobject = doc.add_object(Stream::new(
            form([0.0, 0.0, 1.0, 1.0], Dictionary::new()),
            Vec::new(),
        ));

        draw(
            &mut doc,
            page,
            xobject,
            Matrix([2.0, 0.0, 0.0, 3.0, 4.0, 5.0]),
        );

        let dict = doc.get_dictionary(page).unwrap();
        let resources = dict.get(b"Resources").unwrap().as_dict().unwrap();
        assert_eq!(
            resources
                .get(b"Font")
                .unwrap()
                .as_dict()
                .unwrap()
                .get(b"F1")
                .unwrap(),
            &Object::Reference(font)
        );
        let xobjects = resources.get(b"XObject").unwrap().as_dict().unwrap();
        assert_eq!(
            xobjects.get(b"Fub1").unwrap(),
            &Object::Reference(xobject),
            "il nome preso resta"
        );
        // Le risorse ereditate e condivise non cambiano.
        let shared = doc.get_dictionary(shared).unwrap();
        assert!(!shared
            .get(b"XObject")
            .unwrap()
            .as_dict()
            .unwrap()
            .has(b"Fub1"));

        let list = dict.get(b"Contents").unwrap().as_array().unwrap().clone();
        assert_eq!(list.len(), 3);
        assert_eq!(inflate(&doc, &list[0]), "q\n");
        assert_eq!(list[1], Object::Reference(content));
        assert_eq!(
            inflate(&doc, &list[2]),
            "\nQ\n/Artifact BMC q 2 0 0 3 4 5 cm /Fub1 Do Q EMC\n"
        );
    }

    #[test]
    fn a_page_without_content_receives_only_the_drawing() {
        let mut doc = Document::with_version("1.7");
        let page = doc.add_object(dictionary! { "Type" => "Page" });
        let xobject = doc.add_object(Stream::new(
            form([0.0, 0.0, 1.0, 1.0], Dictionary::new()),
            Vec::new(),
        ));
        draw(&mut doc, page, xobject, Matrix::IDENTITY);
        let list = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Contents")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(list.len(), 1);
        assert_eq!(
            inflate(&doc, &list[0]),
            "/Artifact BMC q 1 0 0 1 0 0 cm /Fub Do Q EMC\n"
        );
    }
}
