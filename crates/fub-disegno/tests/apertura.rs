//! Aprire un disegno, seguire il file, rifiutare ciò che non torna.

mod common;

use std::time::{Duration, Instant};

use fub_abi::{
    DrawingChange, DrawingEdit, DrawingGesture, DrawingLossKind, DrawingPhase, DrawingPointer,
    DrawingPointerKind, DrawingRefusal, DrawingSnap, DrawingSync, DrawingTool, PluginError,
};
use fub_scene::{Item, Role};

/// Gli elementi che il motore potrebbe modificare: quelli della scena tranne
/// `title` e `desc`.
fn elementi(testo: &str) -> u32 {
    let scena = fub_scene::read(testo).expect("la scena si legge");
    scena
        .items
        .iter()
        .filter(|i| matches!(i, Item::Element(e) if !matches!(e.role, Role::Title | Role::Desc)))
        .count() as u32
}

const PICCOLO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <title>Prova</title>\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

fn gesto(revision: u64, tool: DrawingTool) -> DrawingGesture {
    let punto = |kind, x, y| DrawingPointer {
        kind,
        x,
        y,
        pressure: 0.5,
        shift: false,
        alt: false,
        cmd: false,
    };
    DrawingGesture {
        revision,
        phase: DrawingPhase::Commit,
        tool,
        layer: None,
        selection: Vec::new(),
        zoom: 1.0,
        snap: DrawingSnap {
            grid: None,
            free: false,
        },
        style: None,
        text: None,
        events: vec![
            punto(DrawingPointerKind::Down, 150.0, 125.0),
            punto(DrawingPointerKind::Drag, 170.0, 135.0),
            punto(DrawingPointerKind::Up, 170.0, 135.0),
        ],
    }
}

#[test]
fn apre_il_corpus_e_i_modelli_con_ogni_elemento_contato() {
    let radice = common::radice();
    let mut file = Vec::new();
    for dir in [
        "crates/fub-scene/tests/corpus",
        "crates/fub-features/templates",
    ] {
        for e in std::fs::read_dir(radice.join(dir)).expect("la cartella c'è") {
            let p = e.expect("voce").path();
            if p.extension().is_some_and(|e| e == "svg") {
                file.push(p);
            }
        }
    }
    file.sort();
    assert_eq!(file.len(), 5 + 14, "{file:?}");
    let disegni = common::disegni();
    for p in file {
        // Il client tiene il testo con gli a capo LF.
        let testo = std::fs::read_to_string(&p)
            .expect("si legge")
            .replace("\r\n", "\n");
        let (disegno, aperto) = fub_disegno::motore::Disegno::apri_con(&disegni, &testo)
            .unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        aperto.validate().expect("l'apertura è valida");
        assert_eq!(aperto.revision, 0);
        assert_eq!(
            aperto.mapped + aperto.unmapped,
            elementi(&testo),
            "{}",
            p.display()
        );
        let non_mappate = aperto
            .losses
            .iter()
            .filter(|l| l.kind == DrawingLossKind::Unmapped)
            .count() as u32;
        assert_eq!(
            non_mappate,
            aperto.unmapped,
            "{}: una parte per elemento non mappato",
            p.display()
        );
        if p.to_string_lossy().contains("templates") {
            // I modelli sono di Fub: il motore li sa modificare quasi tutti.
            assert!(aperto.mapped > 0, "{}", p.display());
        }
        drop(disegno);
    }
    assert_eq!(disegni.aperte(), 0, "ogni istanza ha reso la sua presa");
}

#[test]
fn un_sync_con_una_modifica_porta_la_revisione_a_uno() {
    let (mut disegno, aperto) = common::apri(PICCOLO);
    assert_eq!((aperto.mapped, aperto.unmapped), (3, 0));
    let da = PICCOLO.find("width=\"100\"").expect("c'è") as u32;
    let sync = DrawingSync {
        revision: 1,
        change: DrawingChange::Edits {
            edits: vec![DrawingEdit {
                from: da + 7,
                to: da + 10,
                deleted: "100".into(),
                inserted: "120".into(),
            }],
            length_before: PICCOLO.encode_utf16().count() as u32,
            length_after: PICCOLO.encode_utf16().count() as u32,
        },
    };
    assert_eq!(
        disegno.sincronizza(sync).expect("il sync passa").revision,
        1
    );
    assert_eq!(disegno.revisione(), 1);
    assert!(disegno.testo().contains("width=\"120\""));
    assert!(
        disegno.aspetta_il_reimport(Duration::from_secs(30)),
        "il reimport finisce"
    );
    assert_eq!(disegno.revisione_importata(), 1);
    // Il gesto alla revisione nuova passa (e lo strumento non c'è ancora).
    let esito = disegno
        .gesto(gesto(1, DrawingTool::Rect))
        .expect("il gesto è valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
}

#[test]
fn un_gesto_a_una_revisione_vecchia_e_stale() {
    let (mut disegno, _) = common::apri(PICCOLO);
    let sync = DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: PICCOLO.replace("100", "110"),
        },
    };
    disegno.sincronizza(sync).expect("il testo intero passa");
    let esito = disegno
        .gesto(gesto(0, DrawingTool::Select))
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Stale));
    assert_eq!(esito.revision, 0);
    let esito = disegno
        .gesto(gesto(2, DrawingTool::Select))
        .expect("valido");
    assert_eq!(
        esito.refused,
        Some(DrawingRefusal::Stale),
        "anche una revisione futura"
    );
}

#[test]
fn un_sync_con_lunghezze_che_non_tornano_e_bad_args() {
    let (mut disegno, _) = common::apri(PICCOLO);
    let lunghezza = PICCOLO.encode_utf16().count() as u32;
    let sbagliata = DrawingSync {
        revision: 1,
        change: DrawingChange::Edits {
            edits: vec![DrawingEdit {
                from: 0,
                to: 0,
                deleted: String::new(),
                inserted: " ".into(),
            }],
            length_before: lunghezza + 1,
            length_after: lunghezza + 2,
        },
    };
    assert!(matches!(
        disegno.sincronizza(sbagliata),
        Err(PluginError::BadArgs(_))
    ));
    let cancellato_diverso = DrawingSync {
        revision: 1,
        change: DrawingChange::Edits {
            edits: vec![DrawingEdit {
                from: 0,
                to: 4,
                deleted: "<xyz".into(),
                inserted: "<svg".into(),
            }],
            length_before: lunghezza,
            length_after: lunghezza,
        },
    };
    assert!(matches!(
        disegno.sincronizza(cancellato_diverso),
        Err(PluginError::BadArgs(_))
    ));
    assert_eq!(disegno.revisione(), 0, "il testo tenuto non cambia");
    assert_eq!(disegno.testo(), PICCOLO);
}

#[test]
fn un_reimport_che_fallisce_lascia_la_copia_vecchia_e_i_gesti_stale() {
    let (mut disegno, _) = common::apri(PICCOLO);
    let rotto = DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect".into(),
        },
    };
    disegno
        .sincronizza(rotto)
        .expect("il sync si tiene anche se l'XML è rotto");
    let esito = disegno
        .gesto(gesto(1, DrawingTool::Select))
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Stale));
    assert_eq!(
        disegno.revisione_importata(),
        0,
        "la copia resta alla revisione vecchia"
    );
    // Un testo buono la rimette in pari.
    let buono = DrawingSync {
        revision: 2,
        change: DrawingChange::Text {
            text: PICCOLO.into(),
        },
    };
    disegno.sincronizza(buono).expect("passa");
    let esito = disegno
        .gesto(gesto(2, DrawingTool::Select))
        .expect("valido");
    assert_ne!(
        esito.refused,
        Some(DrawingRefusal::Stale),
        "la copia è di nuovo in pari"
    );
    assert_eq!(disegno.revisione_importata(), 2);
}

#[test]
fn due_elementi_con_lo_stesso_id_aprono_in_sola_lettura() {
    let testo = PICCOLO.replace("<rect x=\"100\"", "<rect id=\"fub-paper\" x=\"100\"");
    let (mut disegno, aperto) = common::apri(&testo);
    assert!(
        aperto
            .losses
            .iter()
            .any(|l| l.element == "svg" && l.kind == DrawingLossKind::Unsupported),
        "{:?}",
        aperto.losses
    );
    let esito = disegno
        .gesto(gesto(0, DrawingTool::Select))
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
}

#[test]
fn un_elemento_in_defs_o_un_use_non_sono_mappati() {
    let testo = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <defs id=\"fub-defs\">\n    <rect id=\"rforma001\" width=\"10\" height=\"10\" fill=\"#ff0000\"/>\n  </defs>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <use id=\"ouso00001\" href=\"#rforma001\" x=\"50\" y=\"50\"/>\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";
    let (_, aperto) = common::apri(testo);
    assert_eq!(aperto.mapped + aperto.unmapped, elementi(testo));
    let non_mappati: Vec<&str> = aperto
        .losses
        .iter()
        .filter(|l| l.kind == DrawingLossKind::Unmapped)
        .map(|l| l.element.as_str())
        .collect();
    // Ogni elemento di Fub dentro `<defs>` o che è un'istanza resta fuori.
    let scena = fub_scene::read(testo).expect("si legge");
    let mut defs: Option<Vec<usize>> = None;
    let mut controllati = 0;
    for item in &scena.items {
        let Item::Element(e) = item else { continue };
        if e.role == Role::Defs {
            defs = Some(e.path.clone());
        }
        let dentro = defs.as_ref().is_some_and(|d| e.path.starts_with(d));
        if dentro || matches!(e.role, Role::Instance | Role::Copy) {
            let nome = e.id.clone().expect("con id");
            assert!(
                non_mappati.contains(&nome.as_str()),
                "{nome} non mappato: {:?}",
                aperto.losses
            );
            controllati += 1;
        }
    }
    assert!(controllati >= 1);
    assert!(!non_mappati.contains(&"oa1a1a1a1"), "{:?}", aperto.losses);
    assert!(!non_mappati.contains(&"l1a2b3c4d"), "{:?}", aperto.losses);
}

#[test]
fn un_testo_che_non_e_svg_non_si_apre() {
    let disegni = common::disegni();
    let errore = fub_disegno::motore::Disegno::apri_con(&disegni, "<html/>")
        .err()
        .expect("non si apre");
    assert!(matches!(errore, PluginError::BadArgs(_)), "{errore:?}");
    assert_eq!(disegni.aperte(), 0);
}

#[test]
fn senza_caratteri_il_motore_non_si_costruisce() {
    let servizi = fub_motori::Servizi::nuovi(fub_motori::Config {
        fili: Some(1),
        tetto: fub_motori::Tetto::fisso(1 << 20),
    });
    let disegni = fub_disegno::motore::Disegni::nuovi(servizi);
    let errore = fub_disegno::motore::Disegno::apri_con(&disegni, PICCOLO)
        .err()
        .expect("non si apre");
    assert!(matches!(errore, PluginError::Internal(_)), "{errore:?}");
}

#[test]
fn la_presa_conta_le_istanze() {
    use fub_motori::Voce;
    let disegni = common::disegni();
    assert!(!disegni.acceso());
    let (a, _) = fub_disegno::motore::Disegno::apri_con(&disegni, PICCOLO).expect("apre");
    let (b, _) = fub_disegno::motore::Disegno::apri_con(&disegni, PICCOLO).expect("apre");
    assert_ne!(a.istanza(), b.istanza());
    assert_eq!(disegni.aperte(), 2);
    drop(a);
    assert_eq!(disegni.aperte(), 1);
    drop(b);
    assert_eq!(disegni.aperte(), 0);
    assert!(
        disegni.acceso(),
        "il motore resta finché il budget non lo libera"
    );
    assert_eq!(disegni.byte(), 0);
}

#[test]
fn comandi_spenti_e_comando_non_supportato() {
    let (mut disegno, _) = common::apri(PICCOLO);
    let comandi = disegno.comandi(&[]);
    assert_eq!(comandi.len(), fub_abi::DRAWING_COMMANDS.len());
    assert!(comandi.iter().all(|c| !c.enabled));
    let esito = disegno
        .comando(fub_abi::DrawingCommandRequest {
            revision: 0,
            id: fub_abi::DRAWING_COMMAND_WIDTH.into(),
            selection: vec!["fub-paper".into()],
            value: serde_json::json!(2.0),
        })
        .expect("valido");
    assert_eq!(esito.refused, Some(DrawingRefusal::Unsupported));
}

/// Un file di 20 MiB e 50 000 elementi si apre; la misura si guarda con
/// `cargo test -p fub-disegno --test apertura -- --ignored --nocapture`.
#[test]
#[ignore = "misura: lenta in debug"]
fn un_file_grande_si_apre() {
    let mut testo = String::from(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 4000 4000\" width=\"4000\" height=\"4000\">\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n",
    );
    let elementi = fub_scene::MAX_ELEMENTS - 3;
    let riempi = (fub_abi::MAX_DRAWING_TEXT_BYTES - 200) / elementi;
    for i in 0..elementi {
        let riga = format!("    <rect id=\"o{i:08}\" x=\"{}\" y=\"{}\" width=\"3\" height=\"3\" fill=\"#000000\"/>", i % 4000, i / 4000);
        testo.push_str(&riga);
        for _ in riga.len()..riempi.saturating_sub(1) {
            testo.push(' ');
        }
        testo.push('\n');
    }
    testo.push_str("  </g>\n</svg>\n");
    assert!(
        testo.len() <= fub_abi::MAX_DRAWING_TEXT_BYTES,
        "{}",
        testo.len()
    );
    let inizio = Instant::now();
    let (_, aperto) = common::apri(&testo);
    println!(
        "{} byte, {} elementi: aperto in {:?} ({} mappati, {} no)",
        testo.len(),
        elementi + 1,
        inizio.elapsed(),
        aperto.mapped,
        aperto.unmapped
    );
    assert_eq!(aperto.mapped + aperto.unmapped, elementi as u32 + 1);
}
