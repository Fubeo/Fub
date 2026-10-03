//! Il disegno delle annotazioni di una pagina come Form XObject del PDF.
//!
//! `svg2pdf` converte l'albero di `usvg` in un pezzo di PDF con la radice in
//! uno XObject di un punto per un punto, come per l'export dei disegni. Il
//! pezzo passa dalla stessa forma canonica ([`pdf::canonical`]), così lo
//! stesso disegno dà sempre gli stessi oggetti, e diventa un piccolo file che
//! `lopdf` rilegge: gli oggetti si copiano poi nel PDF annotato con
//! [`Copier`], senza un secondo lettore di sintassi PDF.

use lopdf::{Document, LoadOptions, Object, ObjectId};
use resvg::usvg::Tree;

use super::copy::Copier;
use super::geometry::Matrix;
use crate::draw::pdf;

/// Converte `tree` e ne copia gli oggetti in `into`: il risultato è lo
/// XObject della radice, un quadrato di lato 1 con il disegno dentro.
pub(super) fn convert(tree: &Tree, into: &mut Document) -> Result<ObjectId, String> {
    let (chunk, root) = svg2pdf::to_chunk(tree, svg2pdf::ConversionOptions::default())
        .map_err(|error| format!("the annotations could not be converted to PDF: {error}"))?;
    let root = u32::try_from(root.get()).map_err(|_| "invalid root object".to_string())?;
    let mut objects = pdf::canonical(pdf::parse(chunk.as_bytes())?, root, 2)?;
    objects.insert(
        0,
        pdf::Object {
            id: 1,
            value: pdf::Value::Dict(vec![(
                b"/Type".to_vec(),
                pdf::Value::Raw(b"/Catalog".to_vec()),
            )]),
            stream: None,
        },
    );
    let file = pdf::file(&objects, "/Root 1 0 R");
    let piece = Document::load_mem_with_options(&file, LoadOptions::default())
        .map_err(|error| format!("the converted annotations could not be read back: {error}"))?;
    let mut copier = Copier::new(&piece, &[]);
    let copied = copier.value(&Object::Reference((2, 0)), into);
    copier.finish(into);
    copied
        .as_reference()
        .map_err(|_| "the converted annotations have no drawing".to_string())
}

/// Dal quadrato dello XObject allo spazio delle annotazioni di una pagina
/// misurata `(width, height)`: il quadrato ha l'asse y in su e il disegno in
/// piedi, le annotazioni l'origine in alto a sinistra.
pub(super) fn unit_to_annotations((width, height): (f64, f64)) -> Matrix {
    Matrix([width, 0.0, 0.0, -height, 0.0, height])
}

#[cfg(test)]
mod tests {
    use super::*;
    use resvg::usvg;

    #[test]
    fn the_unit_square_lands_upright_on_the_page() {
        let m = unit_to_annotations((600.0, 800.0));
        // L'angolo in alto a sinistra del disegno (0, 1 nel quadrato) è
        // l'origine delle annotazioni; quello in basso a destra è l'angolo
        // opposto della pagina.
        assert_eq!(m.apply(0.0, 1.0), (0.0, 0.0));
        assert_eq!(m.apply(1.0, 0.0), (600.0, 800.0));
    }

    #[test]
    fn the_same_tree_gives_the_same_objects() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">
            <rect x="10" y="10" width="30" height="20" fill="#f0e442" fill-opacity="0.4"/>
            <path d="M0 0 L100 50" stroke="#000" stroke-width="2"/>
        </svg>"##;
        let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
        let once = || {
            let mut doc = Document::with_version("1.7");
            doc.new_object_id();
            let root = convert(&tree, &mut doc).unwrap();
            (root, doc.objects)
        };
        let (root, objects) = once();
        assert_eq!(root, (2, 0));
        let Object::Stream(xobject) = &objects[&root] else {
            panic!("la radice è un flusso");
        };
        assert_eq!(
            xobject.dict.get(b"Subtype").unwrap(),
            &Object::Name(b"Form".to_vec())
        );
        assert_eq!(once().1, objects);
    }
}
