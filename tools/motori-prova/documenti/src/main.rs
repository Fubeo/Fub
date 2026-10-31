//! WordCraft collegato a Fub da solo, con la facciata engine: un documento
//! aperto, impaginato e mostrato pagina per pagina una volta (freddo), poi una
//! seconda copia (scaldato), poi tutto chiuso. La facciata tiene un documento
//! per sessione: due documenti sono due sessioni.

use motori_prova::{Referto, file_argument, trim};
use serde_json::json;
use wordcraft_engine::Session;

/// Pixel per punto: 2, come una pagina al 100% su uno schermo denso.
const SCALE: f32 = 2.0;

fn open_and_show(name: &str, bytes: &[u8]) -> (Session, usize) {
    let doc = wordcraft_engine::io::open_bytes(name, bytes).unwrap_or_else(|e| panic!("apertura di {name}: {e}"));
    let mut session = Session::new(doc);
    let layout = session.layout();
    for page in &layout.pages {
        let shown = wordcraft_render::render_page(&session.doc, page, SCALE, &Default::default());
        // Il fotogramma va letto, o il compilatore può non farlo.
        std::hint::black_box(&shown);
    }
    let pages = layout.pages.len();
    (session, pages)
}

fn main() {
    let path = file_argument();
    let bytes = std::fs::read(&path).expect("il file di prova");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.docx").to_string();
    let file = fub_abi::DocId::new(name.clone());

    let mut referto = Referto::new("WordCraft", "9130181");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    referto.step("avvio");
    let (first, pages) = open_and_show(&name, &bytes);
    referto.set("pagine", json!(pages));
    referto.step("prima apertura");
    let (second, _) = open_and_show(&name, &bytes);
    referto.step("seconda apertura");
    drop(first);
    drop(second);
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
