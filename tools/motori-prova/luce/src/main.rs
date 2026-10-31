//! LightCraft collegato a Fub da solo: una sessione del motore, una foto
//! importata e sviluppata a schermo intero una volta (freddo), poi una
//! seconda copia importata e sviluppata (scaldato), poi tutto tolto.
//!
//! Il motore lavora per percorsi: le due copie stanno in una cartella
//! temporanea, che a «tutto chiuso» esce dalla libreria.

use lightcraft_engine::Session;
use lightcraft_engine::catalog::PhotoId;
use motori_prova::{Referto, file_argument, trim};
use serde_json::{Value, json};

/// Lo schermo: 2880 × 1800, come per gli altri motori.
const W: usize = 2880;
const H: usize = 1800;

fn import_and_show(session: &mut Session, path: &std::path::Path) -> (u32, u32) {
    let shown: Value = session
        .execute("library.import", &json!({ "paths": [path.to_string_lossy()] }))
        .unwrap_or_else(|e| panic!("importazione di {}: {e}", path.display()));
    let id = shown["imported"][0].as_u64().unwrap_or_else(|| panic!("nessuna foto importata: {shown}"));
    let rendered = session.render_now(PhotoId(id), W, H).unwrap_or_else(|e| panic!("sviluppo: {e}"));
    // Il fotogramma va letto, o il compilatore può non farlo.
    std::hint::black_box(&rendered.image);
    (rendered.image.width as u32, rendered.image.height as u32)
}

fn main() {
    let path = file_argument();
    let bytes = std::fs::read(&path).expect("il file di prova");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.jpg").to_string();
    let file = fub_abi::DocId::new(name.clone());
    let dir = std::env::temp_dir().join(format!("prova-luce-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("la cartella temporanea");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    let (a, b) = (dir.join(format!("a.{ext}")), dir.join(format!("b.{ext}")));
    std::fs::write(&a, &bytes).expect("la prima copia");
    // Il motore riconosce un doppione dal contenuto: la seconda copia porta
    // un byte in coda, che i decodificatori ignorano.
    let mut other = bytes.clone();
    other.push(0);
    std::fs::write(&b, &other).expect("la seconda copia");

    let mut referto = Referto::new("LightCraft", "445dd31");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    let mut session = Session::new().with_fs();
    // Su questa macchina non c'è una scheda grafica: lo sviluppo va sul
    // processore, e il referto lo dice.
    let gpu = session.execute("app.gpu", &json!({ "enabled": false })).expect("app.gpu");
    referto.set("gpu", gpu["enabled"].clone());
    referto.step("avvio");
    let (w, h) = import_and_show(&mut session, &a);
    referto.set("schermo", json!([w, h]));
    referto.step("prima apertura");
    import_and_show(&mut session, &b);
    referto.step("seconda apertura");
    session
        .execute("library.removeFolder", &json!({ "path": dir.to_string_lossy() }))
        .expect("la cartella fuori dalla libreria");
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
    let _ = std::fs::remove_dir_all(&dir);
}
