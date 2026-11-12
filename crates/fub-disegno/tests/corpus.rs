//! Ciò che il motore non sa modificare, file per file, nel corpus della scena
//! e nei modelli: l'elenco sta in `tests/corpus/perdite.tsv` e non cambia
//! senza che qualcuno lo veda. `UPDATE_PERDITE=1` lo riscrive; senza, la
//! prova lo confronta e dice le righe che cambiano.
//!
//! Una riga per parte, `file<TAB>elemento<TAB>tipo<TAB>dettaglio`; un file
//! senza parti ha una riga sola con `-` negli altri campi. Un tab o un a capo
//! in un campo diventa uno spazio.

mod common;

use std::path::{Path, PathBuf};

use fub_abi::{DrawingLoss, DrawingLossKind, DrawingRefusal, MAX_DRAWING_LOSSES};
use vectorcraft_doc::color::{Color, Paint};
use vectorcraft_doc::Scaling;
use vectorcraft_geom::Affine;

/// Le cartelle del corpus, dalla radice del repository.
const CARTELLE: [&str; 2] = [
    "crates/fub-scene/tests/corpus",
    "crates/fub-features/templates",
];

/// Il file dell'elenco, dalla cartella del crate.
const ELENCO: &str = "tests/corpus/perdite.tsv";

const INTESTAZIONE: &str = "# Ciò che il motore del disegno non sa modificare, file per file.\n# Generato: UPDATE_PERDITE=1 cargo test -p fub-disegno --test corpus\n# file\telemento\ttipo\tdettaglio\n";

/// I file del corpus, con il percorso dalla radice del repository.
fn corpus() -> Vec<(String, PathBuf)> {
    let radice = common::radice();
    let mut file = Vec::new();
    for dir in CARTELLE {
        for e in std::fs::read_dir(radice.join(dir)).expect("la cartella c'è") {
            let p = e.expect("voce").path();
            if p.extension().is_some_and(|e| e == "svg") {
                let nome = p.file_name().expect("nome").to_string_lossy();
                file.push((format!("{dir}/{nome}"), p));
            }
        }
    }
    file.sort();
    file
}

/// Un campo su una riga sola: tab e a capo diventano spazi.
fn campo(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ")
}

fn tipo(k: DrawingLossKind) -> &'static str {
    match k {
        DrawingLossKind::Unmapped => "unmapped",
        DrawingLossKind::Approximated => "approximated",
        DrawingLossKind::Unsupported => "unsupported",
    }
}

/// Le righe di un file: una per parte, o una sola con `-`.
fn righe(file: &str, perdite: &[DrawingLoss]) -> Vec<String> {
    if perdite.is_empty() {
        return vec![format!("{}\t-\t-\t-", campo(file))];
    }
    perdite
        .iter()
        .map(|p| {
            format!(
                "{}\t{}\t{}\t{}",
                campo(file),
                campo(&p.element),
                tipo(p.kind),
                campo(&p.detail)
            )
        })
        .collect()
}

#[test]
fn l_elenco_delle_perdite_del_corpus_non_cambia_di_nascosto() {
    let file = corpus();
    assert_eq!(file.len(), 5 + 14, "{file:?}");
    let disegni = common::disegni();
    let mut testo = String::from(INTESTAZIONE);
    for (nome, p) in &file {
        // Il client tiene il testo con gli a capo LF.
        let svg = std::fs::read_to_string(p)
            .expect("si legge")
            .replace("\r\n", "\n");
        let (disegno, aperto) = fub_disegno::motore::Disegno::apri_con(&disegni, &svg)
            .unwrap_or_else(|e| panic!("{nome}: {e}"));
        for r in righe(nome, &aperto.losses) {
            testo.push_str(&r);
            testo.push('\n');
        }
        drop(disegno);
    }
    // Ogni file ha almeno una riga, e ogni riga quattro campi.
    for (nome, _) in &file {
        let prefisso = format!("{nome}\t");
        assert!(testo.lines().any(|r| r.starts_with(&prefisso)), "{nome}");
    }
    for r in testo.lines().filter(|r| !r.starts_with('#')) {
        assert_eq!(r.split('\t').count(), 4, "quattro campi: {r:?}");
    }
    let percorso = Path::new(env!("CARGO_MANIFEST_DIR")).join(ELENCO);
    if std::env::var_os("UPDATE_PERDITE").is_some() {
        std::fs::write(&percorso, &testo).expect("scrivo l'elenco");
        return;
    }
    let prima = std::fs::read_to_string(&percorso)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    if prima == testo {
        return;
    }
    let vecchie: Vec<&str> = prima.lines().collect();
    let nuove: Vec<&str> = testo.lines().collect();
    let mut diff = String::new();
    for r in vecchie.iter().filter(|r| !nuove.contains(r)) {
        diff.push_str(&format!("- {r}\n"));
    }
    for r in nuove.iter().filter(|r| !vecchie.contains(r)) {
        diff.push_str(&format!("+ {r}\n"));
    }
    panic!(
        "l'elenco delle perdite è cambiato ({ELENCO}); se è voluto, riscrivilo con \
         UPDATE_PERDITE=1 cargo test -p fub-disegno --test corpus\n{diff}"
    );
}

#[test]
fn un_file_senza_perdite_e_nominato_con_un_trattino() {
    assert_eq!(righe("a.svg", &[]), vec!["a.svg\t-\t-\t-".to_string()]);
    let p = DrawingLoss {
        element: "rect[2/0]".into(),
        kind: DrawingLossKind::Approximated,
        detail: "un\tfiltro\nqui".into(),
    };
    assert_eq!(
        righe("a.svg", &[p]),
        vec!["a.svg\trect[2/0]\tapproximated\tun filtro qui".to_string()]
    );
}

const CON_FILTRO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <defs>\n    <filter id=\"fsfoca\"><feGaussianBlur stdDeviation=\"2\"/></filter>\n  </defs>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"ofiltrat\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" filter=\"url(#fsfoca)\"/>\n    <rect x=\"10\" y=\"10\" width=\"20\" height=\"20\" fill=\"#000000\" filter=\"url(#fsfoca)\"/>\n    <rect id=\"onormale\" x=\"250\" y=\"100\" width=\"50\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

#[test]
fn un_filtro_e_approssimato_e_si_puo_solo_spostare() {
    let (mut disegno, aperto) = common::apri(CON_FILTRO);
    let parte = |el: &str| aperto.losses.iter().find(|p| p.element == el);
    let filtrato = parte("ofiltrat").unwrap_or_else(|| panic!("{:?}", aperto.losses));
    assert_eq!(filtrato.kind, DrawingLossKind::Approximated);
    assert!(filtrato.detail.contains("filtro"), "{}", filtrato.detail);
    // Senza id si nomina col percorso.
    assert_eq!(
        parte("rect[1/1]").map(|p| p.kind),
        Some(DrawingLossKind::Approximated),
        "{:?}",
        aperto.losses
    );
    assert!(parte("onormale").is_none(), "{:?}", aperto.losses);
    // Il `<filter>` è una risorsa: il motore non ne fa un oggetto.
    assert_eq!(
        parte("fsfoca").map(|p| p.kind),
        Some(DrawingLossKind::Unmapped)
    );

    // Spostarlo: un `set` della sola `transform`, che passa.
    let esito = disegno
        .a_mano(|doc, trova| {
            let n = doc.node_mut(trova(&[1, 0]).expect("mappato")).expect("c'è");
            n.transform(Affine::translate((10.0, 0.0)), Scaling::from(true));
        })
        .expect("valido");
    assert_eq!(esito.refused, None, "{:?}", esito.ops);
    let ops = common::ops_di(&esito);
    assert_eq!(ops[0]["op"], "set", "{ops}");
    assert_eq!(ops[0]["id"], "ofiltrat", "{ops}");

    // Cambiargli il colore, toglierlo: rifiutati come `unmapped`.
    let esito = disegno
        .a_mano(|doc, trova| {
            let n = doc.node_mut(trova(&[1, 0]).expect("mappato")).expect("c'è");
            let pieno = n.appearance.fill_mut().expect("ha un riempimento");
            pieno.paint = Paint::solid(Color::from_hex("#0072b2").expect("colore"));
        })
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
    let esito = disegno
        .a_mano(|doc, trova| {
            doc.remove(trova(&[1, 1]).expect("mappato")).expect("tolto");
        })
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));

    // L'elemento accanto si cambia come sempre.
    let esito = disegno
        .a_mano(|doc, trova| {
            let n = doc.node_mut(trova(&[1, 2]).expect("mappato")).expect("c'è");
            let pieno = n.appearance.fill_mut().expect("ha un riempimento");
            pieno.paint = Paint::solid(Color::from_hex("#0072b2").expect("colore"));
        })
        .expect("valido");
    assert_eq!(esito.refused, None);
    assert_eq!(common::ops_di(&esito)[0]["attrs"]["fill"], "#0072b2");
}

#[test]
fn oltre_cinquantamila_parti_l_elenco_si_ferma_al_tetto() {
    // Più elementi di quanti la scena ne legga: sola lettura, e ogni risorsa
    // dentro `<defs>` è una parte. L'elenco resta nel contratto.
    let mut svg = String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 10 10\"><defs>");
    for i in 0..MAX_DRAWING_LOSSES + 10 {
        svg.push_str(&format!("<linearGradient id=\"g{i}\"/>"));
    }
    svg.push_str("</defs></svg>\n");
    let (_disegno, aperto) = common::apri(&svg);
    aperto.validate().expect("nel contratto");
    assert!(aperto.losses.len() <= MAX_DRAWING_LOSSES);
    assert_eq!(aperto.losses[0].element, "svg");
    assert_eq!(aperto.losses[0].kind, DrawingLossKind::Unsupported);
}
