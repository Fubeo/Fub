//! L'oracolo a pixel (`fub_testkit::pixel`): lo stesso disegno dà gli stessi
//! pixel, una differenza si trova e si circoscrive, e i testi si disegnano
//! con i soli caratteri passati.

use std::path::PathBuf;

use fub_testkit::pixel::{confronta, disegna, Confronto, Immagine, Opzioni, LATO_MASSIMO};

fn qui(relativo: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relativo)
}

fn leggi(nome: &str) -> String {
    let percorso = qui(&format!("tests/pixel/{nome}"));
    std::fs::read_to_string(&percorso).unwrap_or_else(|e| panic!("{}: {e}", percorso.display()))
}

/// Inter 400 di Fub, letta dal disco come la leggerà il cancello.
fn inter() -> Vec<u8> {
    let percorso = qui("../fub-features/fonts/inter-400.ttf");
    std::fs::read(&percorso).unwrap_or_else(|e| panic!("{}: {e}", percorso.display()))
}

const SENZA_FACCE: Opzioni<'static> = Opzioni {
    larghezza: 100,
    facce: &[],
};

fn non_bianchi(immagine: &Immagine) -> usize {
    immagine
        .rgba
        .chunks_exact(4)
        .filter(|p| p[..3] != [255, 255, 255])
        .count()
}

#[test]
fn lo_stesso_svg_due_volte_da_zero_pixel_diversi() {
    let svg = leggi("rettangolo.svg");
    let a = disegna(&svg, &SENZA_FACCE).unwrap();
    let b = disegna(&svg, &SENZA_FACCE).unwrap();
    assert_eq!(
        (a.larghezza, a.altezza),
        (100, 50),
        "l'altezza segue il viewBox"
    );
    assert!(
        a.rgba.chunks_exact(4).all(|p| p[3] == 255),
        "lo sfondo è opaco"
    );
    assert!(non_bianchi(&a) > 0, "il rettangolo si vede");
    assert_eq!(
        confronta(&a, &b, 0, None).unwrap(),
        Confronto {
            diversi: 0,
            totali: 5000,
            riquadro: None
        }
    );
}

#[test]
fn un_rettangolo_spostato_di_un_pixel_e_circoscritto_ed_escluso_con_fuori() {
    let svg = leggi("rettangolo.svg");
    let spostato = svg.replace(r#"<rect x="20""#, r#"<rect x="21""#);
    assert_ne!(svg, spostato);
    let a = disegna(&svg, &SENZA_FACCE).unwrap();
    let b = disegna(&spostato, &SENZA_FACCE).unwrap();

    // A scala 1 il rettangolo cade sui pixel: cambiano la colonna 20 (non più
    // coperta) e la colonna 60 (coperta adesso), per le 30 righe del lato.
    let confronto = confronta(&a, &b, 8, None).unwrap();
    assert_eq!(confronto.diversi, 60);
    assert_eq!(confronto.riquadro, Some([20, 10, 41, 30]));

    // Il cerchio, che non si è mosso, resta fuori dal riquadro.
    let riquadro = confronto.riquadro.unwrap();
    let escluso = confronta(&a, &b, 8, Some(riquadro)).unwrap();
    assert_eq!(
        escluso,
        Confronto {
            diversi: 0,
            totali: 5000 - 41 * 30,
            riquadro: None
        }
    );
}

#[test]
fn la_soglia_ignora_le_differenze_piccole_di_un_canale() {
    let a = disegna(&leggi("rettangolo.svg"), &SENZA_FACCE).unwrap();
    let mut b = a.clone();
    b.rgba[0] = 250; // il pixel (0, 0): bianco, un canale di 5 più scuro
    assert_eq!(confronta(&a, &b, 5, None).unwrap().diversi, 0);
    let stretto = confronta(&a, &b, 4, None).unwrap();
    assert_eq!((stretto.diversi, stretto.riquadro), (1, Some([0, 0, 1, 1])));
}

#[test]
fn un_testo_con_le_facce_di_fub_si_disegna() {
    let svg = leggi("testo.svg");
    let inter = inter();
    let facce: &[&[u8]] = &[&inter];
    let opzioni = Opzioni {
        larghezza: 240,
        facce,
    };
    let a = disegna(&svg, &opzioni).unwrap();
    assert_eq!((a.larghezza, a.altezza), (240, 60));
    assert!(
        non_bianchi(&a) > 100,
        "il testo si vede: {} pixel",
        non_bianchi(&a)
    );
    let b = disegna(&svg, &opzioni).unwrap();
    assert_eq!(confronta(&a, &b, 0, None).unwrap().diversi, 0);

    // Una famiglia generica, o una che nessuna faccia ha, è la prima faccia.
    for famiglia in ["sans-serif", "Nessuna Famiglia Così"] {
        let altra = svg.replace(
            r#"font-family="Inter""#,
            &format!(r#"font-family="{famiglia}""#),
        );
        let c = disegna(&altra, &opzioni).unwrap();
        assert_eq!(confronta(&a, &c, 0, None).unwrap().diversi, 0, "{famiglia}");
    }
}

#[test]
fn senza_facce_i_testi_spariscono() {
    let svg = leggi("testo.svg");
    let immagine = disegna(
        &svg,
        &Opzioni {
            larghezza: 240,
            facce: &[],
        },
    )
    .unwrap();
    assert_eq!(non_bianchi(&immagine), 0);
}

#[test]
fn un_carattere_che_le_facce_non_hanno_si_disegna_uguale_nei_due_lati() {
    // Inter non ha gli ideogrammi: si disegna il glifo di ripiego.
    let svg = leggi("testo.svg").replace("Fub disegna", "Fub 漢字");
    let inter = inter();
    let facce: &[&[u8]] = &[&inter];
    let opzioni = Opzioni {
        larghezza: 240,
        facce,
    };
    let a = disegna(&svg, &opzioni).unwrap();
    let b = disegna(&svg, &opzioni).unwrap();
    assert!(non_bianchi(&a) > 0);
    assert_eq!(confronta(&a, &b, 0, None).unwrap().diversi, 0);
}

#[test]
fn senza_viewbox_valgono_width_e_height() {
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="black"/></svg>"#;
    let immagine = disegna(svg, &SENZA_FACCE).unwrap();
    assert_eq!((immagine.larghezza, immagine.altezza), (100, 25));
    assert_eq!(
        non_bianchi(&immagine),
        100 * 25,
        "il disegno è scalato alla larghezza"
    );
}

#[test]
fn un_svg_che_non_si_legge_e_un_errore() {
    for svg in [
        "",
        "non è un svg",
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect",
        "<html/>",
    ] {
        let errore = disegna(svg, &SENZA_FACCE).unwrap_err();
        assert!(errore.contains("SVG"), "{svg:?}: {errore}");
    }
}

#[test]
fn una_larghezza_fuori_misura_e_un_errore() {
    let svg = leggi("rettangolo.svg");
    for larghezza in [0, LATO_MASSIMO + 1, u32::MAX] {
        let errore = disegna(
            &svg,
            &Opzioni {
                larghezza,
                facce: &[],
            },
        )
        .unwrap_err();
        assert!(errore.contains("larghezza"), "{larghezza}: {errore}");
    }
    assert!(disegna(
        &svg,
        &Opzioni {
            larghezza: LATO_MASSIMO,
            facce: &[]
        }
    )
    .is_ok());

    // Un disegno stretto e alto: la larghezza va bene, l'altezza no.
    let alto = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 100"/>"#;
    let errore = disegna(
        alto,
        &Opzioni {
            larghezza: 100,
            facce: &[],
        },
    )
    .unwrap_err();
    assert!(errore.contains("alto"), "{errore}");
}

#[test]
fn immagini_di_misura_diversa_sono_un_errore() {
    let svg = leggi("rettangolo.svg");
    let a = disegna(&svg, &SENZA_FACCE).unwrap();
    let b = disegna(
        &svg,
        &Opzioni {
            larghezza: 99,
            facce: &[],
        },
    )
    .unwrap();
    assert!(confronta(&a, &b, 0, None)
        .unwrap_err()
        .contains("misure diverse"));

    let mut corta = a.clone();
    corta.rgba.pop();
    assert!(confronta(&a, &corta, 0, None).unwrap_err().contains("byte"));
}

#[test]
fn fuori_che_esce_dall_immagine_conta_solo_la_parte_dentro() {
    let a = disegna(&leggi("rettangolo.svg"), &SENZA_FACCE).unwrap();
    let confronto = confronta(&a, &a, 0, Some([90, 40, u32::MAX, u32::MAX])).unwrap();
    assert_eq!(confronto.totali, 5000 - 10 * 10);
}
