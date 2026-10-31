//! GridCraft collegato a Fub da solo, con la facciata engine: una cartella
//! aperta e la sua prima schermata di celle scritta come la cella la mostra
//! (freddo), poi una seconda copia (scaldato), poi tutto chiuso. GridCraft
//! non disegna pixel: la griglia la disegna Fub.

use gridcraft_core::CellRef;
use gridcraft_engine::{DocState, Session};
use gridcraft_numfmt::{NumberFormat, format_value};
use motori_prova::{Referto, file_argument, trim};
use serde_json::json;

/// Una schermata: 60 righe per 26 colonne.
const ROWS: u32 = 60;
const COLS: u32 = 26;

fn open_and_show(session: &mut Session, name: &str, bytes: &[u8]) -> usize {
    let (workbook, _) = gridcraft_engine::io::open_bytes(name, bytes).unwrap_or_else(|e| panic!("apertura di {name}: {e}"));
    let index = session.add_document(DocState::new(workbook, None, name.to_string()));
    let doc = &session.documents()[index];
    let workbook = &doc.wb;
    let sheet = workbook.sheets.first().expect("almeno un foglio");
    let mut shown = 0;
    for row in 0..ROWS {
        for col in 0..COLS {
            let at = CellRef { row, col };
            let style = workbook.styles.get(sheet.style_id(at));
            let text = format_value(&sheet.value(at), &NumberFormat::parse_cached(style.num_fmt.as_str()), workbook.date_system).text;
            shown += std::hint::black_box(text).len();
        }
    }
    shown
}

fn main() {
    let path = file_argument();
    let bytes = std::fs::read(&path).expect("il file di prova");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("prova.xlsx").to_string();
    let file = fub_abi::DocId::new(name.clone());

    let mut referto = Referto::new("GridCraft", "ac8da7d");
    referto.set("file", json!(file.as_str()));
    referto.set("byte", json!(bytes.len()));
    let mut session = Session::new();
    referto.step("avvio");
    open_and_show(&mut session, &name, &bytes);
    referto.step("prima apertura");
    open_and_show(&mut session, &name, &bytes);
    referto.step("seconda apertura");
    while !session.documents().is_empty() {
        session.close_document(0);
    }
    referto.step("tutto chiuso");
    trim();
    referto.step("dopo malloc_trim");
    referto.print();
}
