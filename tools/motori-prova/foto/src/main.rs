//! PhotoCraft collegato a Fub da solo: una sessione del motore, un'immagine
//! aperta e mostrata intera una volta (freddo), poi una seconda copia aperta
//! e mostrata (scaldato), poi tutto chiuso.

use motori_prova::{Referto, file_argument, trim};
use photocraft_engine::{Session, file_cmds};
use serde_json::json;

/// La tela: un riquadro di 2880 × 1800, come per gli altri motori.
const W: u32 = 2880;
const H: u32 = 1800;

fn open_and_show(session: &mut Session, name: &str, bytes: &[u8]) -> (u32, u32) {
    file_cmds::open_bytes_as(session, name, bytes, None, None).unwrap_or_else(|e| panic!("apertura di {name}: {e}"));
    let doc = session.active().expect("un documento aperto").doc.clone();
    let shown = photocraft_compose::render_reduced(&doc, W, H);
    // Il fotogramma va letto, o il compilatore può non farlo.
    std::hint::black_box(shown.to_rgba8());
    let bounds = doc.bounds();
    ((bounds.x1 - bounds.x0) as u32, (bounds.y1 - bounds.y0) as u32)
}

fn main() {
    let path = file_argument();
    let bytes = std::fs::read(&path).expect("il file di prova");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.png").to_string();
    let file = fub_abi::DocId::new(name.clone());

    let mut referto = Referto::new("PhotoCraft", "b1cfff9");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    let mut session = Session::new();
    referto.step("avvio");
    let (w, h) = open_and_show(&mut session, &name, &bytes);
    referto.set("pixel", json!([w, h]));
    referto.step("prima apertura");
    open_and_show(&mut session, &name, &bytes);
    referto.step("seconda apertura");
    while session.close(0).is_some() {}
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
