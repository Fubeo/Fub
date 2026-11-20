//! #97 sul disco: un gesto sulla lavagna di un file CRLF, con BOM o con tutti
//! e due arriva ai byte del file così come la tela l'ha scritto.
//!
//! Il testo di ogni gesto viene dai vettori della tela
//! (`apps/client/src/__fixtures__/canvas-patches/46-*`…`61-*`): sono i byte che
//! il nucleo della tela emette, gli stessi che
//! `apps/client/src/editors/canvas/line-endings.test.ts` vede uscire dalla
//! sessione verso `write_document`. Qui fanno l'ultimo tratto, sull'host vero
//! col provider di produzione: il file sul disco è quel testo, byte per byte,
//! e si rilegge come lavagna.

use std::path::PathBuf;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_format_canvas::parse_canvas;
use fub_host::{Host, NoWatcher};
use serde_json::Value;

fn vector(name: &str) -> (String, String) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-patches")
        .join(name);
    let raw = std::fs::read_to_string(&path).expect("il vettore si legge");
    let value: Value = serde_json::from_str(&raw).expect("il vettore è JSON");
    assert_eq!(value["expect"]["outcome"], "applied", "{name}");
    (
        value["before"].as_str().expect("before").to_string(),
        value["expect"]["text"]
            .as_str()
            .expect("expect.text")
            .to_string(),
    )
}

#[test]
fn ogni_gesto_su_crlf_e_bom_arriva_sul_disco_con_i_terminatori_e_il_bom_del_file() {
    let gestures = ["move", "add-node", "remove-edge-and-node", "add-edge"];
    for (first, variant) in [(46, "lf"), (50, "crlf"), (54, "bom"), (58, "bom-crlf")] {
        for (offset, gesture) in gestures.iter().enumerate() {
            let name = format!("{}-{variant}-{gesture}.json", first + offset);
            let (before, after) = vector(&name);
            assert_eq!(
                after.starts_with('\u{feff}'),
                variant.starts_with("bom"),
                "{name}: il BOM resta"
            );
            assert_eq!(
                after.replace("\r\n", "").contains('\n'),
                !variant.ends_with("crlf"),
                "{name}: nessun terminatore mescolato"
            );

            let dir = tempfile::tempdir().expect("tempdir");
            let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
            let file = root.join("board.canvas");
            std::fs::write(&file, before.as_bytes()).expect("la lavagna si scrive");
            let host = Host::new().with_watcher(Box::new(NoWatcher));
            host.open(&root).expect("il vault si apre");
            host.wait_indexed(None).expect("l'indice è pronto");

            let board = DocId::new("board.canvas");
            let (read, revision) = host.read_document(None, &board).expect("si legge");
            assert_eq!(read, before, "{name}: l'host passa il file com'è");
            host.write_document(None, &board, &after, WriteBase::DescendsFrom(revision))
                .unwrap_or_else(|error| panic!("{name}: si scrive: {error:?}"));

            let disk = std::fs::read(&file).expect("si rilegge dal disco");
            assert_eq!(disk, after.as_bytes(), "{name}: i byte sul disco");
            let text = String::from_utf8(disk).expect("utf8");
            let canvas = parse_canvas(&text).expect("si rilegge come lavagna");
            if *gesture == "move" {
                let b = canvas.nodes.iter().find(|node| node.id == "b").expect("b");
                assert_eq!(b.x, 888, "{name}: lo spostamento è sul disco");
            }
        }
    }
}
