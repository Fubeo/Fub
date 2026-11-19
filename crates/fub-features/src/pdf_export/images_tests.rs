//! Le prove delle immagini: piene o alleggerite, e quelle che non entrano.

use super::images::{alleggerisci, tipo_immagine, PUNTI_ALLEGGERITI};
use super::tests::{elenco, ridisegna, Banco};
use super::*;

/// Un'immagine con la grana di una foto (un colore di base e un rumore
/// pseudo-casuale), in PNG: si comprime male, come una foto vera.
fn foto(w: u32, h: u32, base: [u8; 3], alfa: bool) -> Vec<u8> {
    let mut seme: u32 = 0x9E37_79B9;
    let mut caso = move || {
        seme ^= seme << 13;
        seme ^= seme >> 17;
        seme ^= seme << 5;
        (seme % 41) as i32 - 20
    };
    let canali = if alfa { 4 } else { 3 };
    let mut dati = Vec::with_capacity((w * h) as usize * canali);
    for y in 0..h {
        for _ in 0..w {
            for c in base {
                dati.push((i32::from(c) + caso()).clamp(0, 255) as u8);
            }
            if alfa {
                dati.push(if y < h / 2 { 255 } else { 128 });
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(if alfa {
            png::ColorType::Rgba
        } else {
            png::ColorType::Rgb
        });
        enc.set_depth(png::BitDepth::Eight);
        let mut scrittore = enc.write_header().unwrap();
        scrittore.write_image_data(&dati).unwrap();
    }
    out
}

fn misura(byte: &[u8]) -> (usize, usize) {
    let m = imagesize::blob_size(byte).unwrap();
    (m.width, m.height)
}

#[test]
fn pdf_export_un_immagine_fitta_si_alleggerisce_in_jpeg() {
    let grande = foto(1200, 800, [200, 100, 50], false);
    // 200×133 pixel CSS sulla pagina: a 150 punti per pollice ne servono
    // 313×208.
    let (ridotta, tipo) = alleggerisci(&grande, "image/png", 200.0, 133.0).expect("si riduce");
    assert_eq!(tipo, "image/jpeg");
    assert_eq!(tipo_immagine(&ridotta), Some("image/jpeg"));
    let scala = PUNTI_ALLEGGERITI / 96.0;
    let (w, h) = misura(&ridotta);
    assert_eq!(w, (200.0 * scala).ceil() as usize);
    assert!((h as i64 - (133.0 * scala).ceil() as i64).abs() <= 1, "{h}");
    assert!(
        ridotta.len() * 10 < grande.len(),
        "{} su {}",
        ridotta.len(),
        grande.len()
    );
}

#[test]
fn pdf_export_un_immagine_con_trasparenza_resta_png() {
    let grande = foto(900, 600, [20, 120, 220], true);
    let (ridotta, tipo) = alleggerisci(&grande, "image/png", 100.0, 66.0).expect("si riduce");
    assert_eq!(tipo, "image/png");
    let decoder = png::Decoder::new(std::io::Cursor::new(&ridotta));
    let lettore = decoder.read_info().unwrap();
    assert_eq!(lettore.info().color_type, png::ColorType::Rgba);
}

#[test]
fn pdf_export_un_immagine_gia_leggera_o_che_non_si_riduce_resta_com_e() {
    // Già alla risoluzione che serve, o meno.
    let piccola = foto(100, 50, [10, 10, 10], false);
    assert_eq!(alleggerisci(&piccola, "image/png", 200.0, 100.0), None);
    // Una GIF può muoversi: resta com'è.
    assert_eq!(alleggerisci(b"GIF89a....", "image/gif", 10.0, 10.0), None);
    // Un PNG che non si decodifica: resta quello di prima, e lo scrittore
    // dirà che non si legge.
    let mut rotto = foto(800, 800, [0, 0, 0], false);
    rotto.truncate(200);
    assert_eq!(alleggerisci(&rotto, "image/png", 10.0, 10.0), None);
}

#[test]
fn pdf_export_alleggerite_il_pdf_pesa_meno_e_l_immagine_c_e() {
    let mut banco = Banco::default();
    banco.immagini.insert(
        "Foto/mare.png".into(),
        foto(1600, 1200, [40, 90, 200], false),
    );
    let pezzi = vec![Pezzo::Immagine {
        x: 50.0,
        y: 50.0,
        w: 200.0,
        h: 150.0,
        file: "Foto/mare.png".into(),
        nodo: None,
    }];
    let e = elenco(vec![], vec![pezzi]);
    let piene = scrivi(&e, &banco).unwrap();
    let alleggerite = scrivi_con(
        &e,
        &banco,
        &Opzioni {
            immagini: QualitaImmagini::Alleggerite,
            ..Opzioni::default()
        },
        &mut Sempre,
    )
    .unwrap();
    assert!(piene.avvisi.is_empty() && alleggerite.avvisi.is_empty());
    assert!(
        alleggerite.pdf.len() * 5 < piene.pdf.len(),
        "{} contro {}",
        alleggerite.pdf.len(),
        piene.pdf.len()
    );
    for pdf in [&piene.pdf, &alleggerite.pdf] {
        let img = ridisegna(pdf, 0);
        let i = ((125 * img.0 + 150) * 4) as usize;
        let colore = &img.2[i..i + 3];
        for (c, atteso) in colore.iter().zip([40u8, 90, 200]) {
            assert!(c.abs_diff(atteso) <= 40, "{colore:?}");
        }
    }
}

struct Sempre;

impl Controllo for Sempre {
    fn continua(&mut self, _: usize, _: usize) -> Result<(), Interruzione> {
        Ok(())
    }
}

#[test]
fn pdf_export_un_immagine_rotta_o_troppo_grande_lascia_il_posto_vuoto() {
    let mut banco = Banco::default();
    let mut rotta = foto(64, 64, [0, 0, 0], false);
    rotta.truncate(100);
    banco.immagini.insert("rotta.png".into(), rotta);
    banco
        .immagini
        .insert("strana.bin".into(), b"non sono un'immagine".to_vec());
    let mut enorme = b"\x89PNG\r\n\x1a\n".to_vec();
    enorme.resize(MAX_IMMAGINE_BYTE + 1, 0);
    banco.immagini.insert("enorme.png".into(), enorme);
    let pezzo = |file: &str| Pezzo::Immagine {
        x: 0.0,
        y: 0.0,
        w: 50.0,
        h: 50.0,
        file: file.into(),
        nodo: None,
    };
    let e = elenco(
        vec![],
        vec![vec![
            pezzo("rotta.png"),
            pezzo("strana.bin"),
            pezzo("enorme.png"),
        ]],
    );
    for immagini in [QualitaImmagini::Piene, QualitaImmagini::Alleggerite] {
        let scritto = scrivi_con(
            &e,
            &banco,
            &Opzioni {
                immagini,
                ..Opzioni::default()
            },
            &mut Sempre,
        )
        .unwrap();
        assert_eq!(
            scritto.avvisi,
            vec![
                Avviso::ImmagineMancante {
                    file: "rotta.png".into()
                },
                Avviso::ImmagineMancante {
                    file: "strana.bin".into()
                },
                Avviso::ImmagineTroppoGrande {
                    file: "enorme.png".into(),
                    byte: MAX_IMMAGINE_BYTE as u64 + 1
                },
            ]
        );
        lopdf::Document::load_mem(&scritto.pdf).expect("il resto del PDF si scrive");
    }
}
