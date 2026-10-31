//! PdfCraft collegato a Fub da solo: una sessione del motore, un PDF aperto e
//! mostrato pagina per pagina una volta (freddo), poi una seconda copia
//! aperta e mostrata (scaldato), poi tutto chiuso.

use std::sync::Arc;

use motori_prova::{Referto, file_argument, trim};
use pdfcraft_engine::{DocId, Session};
use pdfcraft_render::{PageRenderer, RenderRequest};
use serde_json::json;

/// Punti PDF per pixel: 2, come una pagina al 100% su uno schermo denso.
const SCALE: f32 = 2.0;

fn open_and_show(session: &mut Session, name: &str, bytes: &Arc<Vec<u8>>) -> (DocId, usize) {
    let id = session
        .open(name, None, bytes.clone(), None)
        .unwrap_or_else(|e| panic!("apertura di {name}: {e:?}"));
    let doc = session.get(id).expect("il documento aperto");
    let config = session.render_config(id).expect("la sua configurazione");
    let mut renderer = PageRenderer::new(doc.display.clone(), config);
    let pages = renderer.page_count();
    for page in 0..pages {
        let shown = renderer.render(RenderRequest { page, scale: SCALE, ..RenderRequest::default() });
        if let Some(error) = shown.error {
            panic!("pagina {page}: {error}");
        }
        // Il fotogramma va letto, o il compilatore può non farlo.
        std::hint::black_box(shown.width * shown.height);
    }
    (id, pages)
}

fn main() {
    let path = file_argument();
    let bytes = Arc::new(std::fs::read(&path).expect("il file di prova"));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.pdf").to_string();
    let file = fub_abi::DocId::new(name.clone());

    let mut referto = Referto::new("PdfCraft", "c735fb7");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    let mut session = Session::default();
    referto.step("avvio");
    let (first, pages) = open_and_show(&mut session, &name, &bytes);
    referto.set("pagine", json!(pages));
    referto.step("prima apertura");
    let (second, _) = open_and_show(&mut session, &name, &bytes);
    referto.step("seconda apertura");
    session.close(first);
    session.close(second);
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
