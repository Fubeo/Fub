//! VectorCraft collegato a Fub da solo: una sessione del motore, un disegno
//! aperto e mostrato intero una volta (freddo), poi una seconda copia aperta
//! e mostrata (scaldato), poi tutto chiuso.

use motori_prova::{Referto, file_argument, trim};
use serde_json::json;
use vectorcraft_engine::Session;
use vectorcraft_geom::Affine;
use vectorcraft_render::{RenderOptions, Renderer};

/// La tela: un riquadro di 2880 × 1800, come il banco del motore.
const W: u32 = 2880;
const H: u32 = 1800;

fn open_and_show(session: &mut Session, renderer: &mut Renderer, name: &str, bytes: &[u8]) -> usize {
    let data = vectorcraft_format::base64_encode(bytes);
    session
        .execute("document.open", &json!({ "name": name, "dataBase64": data }))
        .unwrap_or_else(|e| panic!("apertura di {name}: {e}"));
    let doc = session.doc().expect("un documento aperto").doc.clone();
    let rect = doc.artboards.first().map(|a| a.rect).expect("almeno una tavola");
    let zoom = (W as f64 / rect.width()).min(H as f64 / rect.height()) * 0.95;
    let view = Affine::translate((W as f64 / 2.0, H as f64 / 2.0))
        * Affine::scale(zoom)
        * Affine::translate(-rect.center().to_vec2());
    let shown = renderer.render(&doc, W, H, view, &RenderOptions::default());
    // Il fotogramma va letto, o il compilatore può non farlo.
    std::hint::black_box(shown.pixels.iter().fold(0u8, |a, b| a ^ b))
        as usize
}

fn main() {
    let path = file_argument();
    let bytes = std::fs::read(&path).expect("il file di prova");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.svg").to_string();
    // Il nome del file come lo vede Fub: la prova passa dal suo contratto.
    let id = fub_abi::DocId::new(name.clone());

    let mut referto = Referto::new("VectorCraft", "ed733b7");
    referto.set("file", json!(id.as_str()));
    referto.set("byte", json!(bytes.len()));
    let mut session = Session::new();
    let mut renderer = Renderer::new();
    referto.step("avvio");
    open_and_show(&mut session, &mut renderer, &name, &bytes);
    referto.step("prima apertura");
    open_and_show(&mut session, &mut renderer, &name, &bytes);
    referto.step("seconda apertura");
    while session.close_document(0) {}
    drop(renderer);
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
