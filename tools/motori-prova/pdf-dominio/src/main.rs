//! I crate di dominio di PdfCraft collegati a Fub da soli, senza la facciata:
//! un PDF letto e mostrato pagina per pagina una volta (freddo), poi una
//! seconda copia (scaldato), poi tutto chiuso. Come `../pdf`, ma con il
//! renderer preso direttamente, come lo prenderebbe `fub-format-pdf`.

use std::sync::Arc;

use motori_prova::{Referto, file_argument, trim};
use pdfcraft_render::{PageRenderer, RenderConfig, RenderRequest};
use serde_json::json;

/// Punti PDF per pixel: 2, come una pagina al 100% su uno schermo denso.
const SCALE: f32 = 2.0;

fn open_and_show(bytes: &Arc<Vec<u8>>) -> (PageRenderer, usize) {
    // Il grafo degli oggetti, come lo legge chi annota o organizza.
    let cos = pdfcraft_cos::Document::open_with_password(bytes.clone(), None).unwrap_or_else(|e| panic!("apertura: {e}"));
    std::hint::black_box(&cos);
    let mut renderer = PageRenderer::new(bytes.clone(), RenderConfig::default());
    let pages = renderer.page_count();
    for page in 0..pages {
        let shown = renderer.render(RenderRequest { page, scale: SCALE, ..RenderRequest::default() });
        if let Some(error) = shown.error {
            panic!("pagina {page}: {error}");
        }
        std::hint::black_box(shown.width * shown.height);
    }
    (renderer, pages)
}

fn main() {
    let path = file_argument();
    let bytes = Arc::new(std::fs::read(&path).expect("il file di prova"));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.pdf").to_string();
    let file = fub_abi::DocId::new(name);

    let mut referto = Referto::new("PdfCraft, crate di dominio", "c735fb7");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    referto.step("avvio");
    let (first, pages) = open_and_show(&bytes);
    referto.set("pagine", json!(pages));
    referto.step("prima apertura");
    let (second, _) = open_and_show(&bytes);
    referto.step("seconda apertura");
    drop(first);
    drop(second);
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
