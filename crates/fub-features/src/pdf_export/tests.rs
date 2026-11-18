//! Le prove dello scrittore della prova: il PDF si rilegge con `lopdf` (il
//! testo, i caratteri incorporati) e si ridisegna con `hayro` (dove stanno
//! l'inchiostro e i fondi).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::*;

/// I caratteri dell'app, come li nomina la vista nel banco.
fn carattere_app(file: &str) -> Option<Vec<u8>> {
    let nome = file.strip_prefix("/fonts/")?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/public/fonts")
        .join(nome);
    std::fs::read(path).ok()
}

#[derive(Default)]
struct Banco {
    caratteri: BTreeMap<String, Vec<u8>>,
    immagini: BTreeMap<String, Vec<u8>>,
}

impl Risorse for Banco {
    fn carattere(&self, file: &str) -> Option<Vec<u8>> {
        self.caratteri
            .get(file)
            .cloned()
            .or_else(|| carattere_app(file))
    }
    fn immagine(&self, file: &str) -> Option<Vec<u8>> {
        self.immagini.get(file).cloned()
    }
}

const NEWSREADER: &str = "/fonts/newsreader-latin-opsz-normal.woff2";
const MONO: &str = "/fonts/ibm-plex-mono-latin-400-normal.woff2";
const NERO: Colore = [0.0, 0.0, 0.0, 1.0];

fn faccia(famiglia: &str, file: &str, assi: &[(&str, f64)]) -> Faccia {
    Faccia {
        famiglia: famiglia.into(),
        file: file.into(),
        corsivo: false,
        assi: assi
            .iter()
            .map(|(tag, valore)| Asse {
                tag: (*tag).into(),
                valore: *valore,
            })
            .collect(),
    }
}

/// Un testo con le lettere a passo fisso, come le metterebbe una vista.
fn testo(x: f64, y: f64, faccia: usize, corpo: f64, testo: &str, passo: f64) -> Pezzo {
    let n = testo.chars().count();
    Pezzo::Testo {
        x,
        y,
        larghezza: passo * n as f64,
        faccia,
        corpo,
        colore: NERO,
        testo: testo.into(),
        posizioni: (0..n).map(|i| i as f64 * passo).collect(),
        sottolineato: false,
        barrato: false,
    }
}

fn elenco(facce: Vec<Faccia>, pagine: Vec<Vec<Pezzo>>) -> ElencoPagine {
    ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: "Prova".into(),
        facce,
        pagine: pagine.into_iter().map(|pezzi| Pagina { pezzi }).collect(),
    }
}

/// Il testo di ogni pagina, letto con `lopdf`, senza spazi né a capo: la
/// prova guarda le lettere, non come l'estrattore indovina gli spazi.
fn lettere(pdf: &[u8]) -> Vec<String> {
    let doc = lopdf::Document::load_mem(pdf).expect("il PDF si rilegge");
    let pagine = doc.get_pages();
    pagine
        .keys()
        .map(|n| {
            doc.extract_text(&[*n])
                .expect("il testo si estrae")
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect()
        })
        .collect()
}

/// La pagina `n` ridisegnata da `hayro` a un pixel per pixel CSS, in RGBA.
fn ridisegna(pdf: &[u8], n: usize) -> (u32, u32, Vec<u8>) {
    use hayro::hayro_interpret::InterpreterSettings;
    use hayro::hayro_syntax::Pdf;
    let pdf = Pdf::new(Arc::new(pdf.to_vec())).expect("hayro legge il PDF");
    let pagine = pdf.pages();
    let pagina = &pagine[n];
    let (w, h) = pagina.render_dimensions();
    let (lw, lh) = ((w / 0.75).round() as u32, (h / 0.75).round() as u32);
    let render = hayro::RenderSettings {
        x_scale: lw as f32 / w,
        y_scale: lh as f32 / h,
        width: Some(lw as u16),
        height: Some(lh as u16),
        bg_color: hayro::vello_cpu::color::palette::css::WHITE,
    };
    let pixmap = hayro::render(
        pagina,
        &hayro::RenderCache::new(),
        &InterpreterSettings::default(),
        &render,
    );
    (lw, lh, pixmap.data_as_u8_slice().to_vec())
}

/// Quanti pixel scuri ci sono nel riquadro.
fn inchiostro(img: &(u32, u32, Vec<u8>), x0: u32, y0: u32, x1: u32, y1: u32) -> usize {
    let (w, _, dati) = img;
    let mut n = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let i = ((y * w + x) * 4) as usize;
            if dati[i] < 128 && dati[i + 1] < 128 && dati[i + 2] < 128 {
                n += 1;
            }
        }
    }
    n
}

fn pixel(img: &(u32, u32, Vec<u8>), x: u32, y: u32) -> [u8; 3] {
    let (w, _, dati) = img;
    let i = ((y * w + x) * 4) as usize;
    [dati[i], dati[i + 1], dati[i + 2]]
}

#[test]
fn pdf_export_il_testo_si_rilegge_con_le_sue_lettere() {
    let facce = vec![
        faccia(
            "Newsreader Variable",
            NEWSREADER,
            &[("wght", 400.0), ("opsz", 16.0)],
        ),
        faccia("IBM Plex Mono", MONO, &[]),
    ];
    // Una riga con due caratteri: la prosa e il codice.
    let pezzi = vec![
        testo(20.0, 40.0, 0, 16.0, "Perché è così", 8.0),
        testo(130.0, 40.0, 1, 14.0, "let x = 1;", 8.4),
    ];
    let scritto = scrivi(&elenco(facce, vec![pezzi]), &Banco::default()).unwrap();
    assert!(scritto.avvisi.is_empty(), "{:?}", scritto.avvisi);
    assert_eq!(
        lettere(&scritto.pdf),
        vec!["Perchéècosìletx=1;".to_string()]
    );
}

#[test]
fn pdf_export_i_caratteri_sono_incorporati_in_sotto_insieme() {
    let facce = vec![faccia(
        "Newsreader Variable",
        NEWSREADER,
        &[("wght", 600.0)],
    )];
    let scritto = scrivi(
        &elenco(facce, vec![vec![testo(10.0, 30.0, 0, 20.0, "abc", 10.0)]]),
        &Banco::default(),
    )
    .unwrap();
    let doc = lopdf::Document::load_mem(&scritto.pdf).unwrap();
    let mut file = Vec::new();
    for (_, oggetto) in doc.objects.iter() {
        if let Ok(stream) = oggetto.as_stream() {
            if stream.dict.get(b"Length1").is_ok() {
                file.push(stream.decompressed_content().unwrap());
            }
        }
    }
    assert_eq!(file.len(), 1, "un carattere, incorporato una volta");
    let intero = per_il_pdf_decodificato(NEWSREADER);
    assert!(
        file[0].len() * 4 < intero.len(),
        "il sotto-insieme ({} byte) è molto più piccolo del carattere ({} byte)",
        file[0].len(),
        intero.len()
    );
    // Il sotto-insieme è un TrueType che si legge, coi glifi delle tre lettere
    // e il glifo vuoto.
    let font = skrifa::FontRef::new(&file[0]).unwrap();
    use skrifa::MetadataProvider;
    assert_eq!(
        font.metrics(
            skrifa::instance::Size::unscaled(),
            skrifa::instance::LocationRef::default()
        )
        .glyph_count,
        4
    );
}

fn per_il_pdf_decodificato(file: &str) -> Vec<u8> {
    crate::draw::per_il_pdf::decode(&carattere_app(file).unwrap())
        .unwrap()
        .into_owned()
}

#[test]
fn pdf_export_ogni_lettera_sta_dove_la_vista_la_mette() {
    // Le stesse quattro lettere, strette e poi larghe: l'inchiostro segue le
    // posizioni, non le larghezze dei glifi.
    let facce = vec![faccia("IBM Plex Mono", MONO, &[])];
    let stretto = testo(20.0, 50.0, 0, 20.0, "IIII", 12.0);
    let largo = testo(20.0, 120.0, 0, 20.0, "IIII", 80.0);
    let scritto = scrivi(
        &elenco(facce, vec![vec![stretto, largo]]),
        &Banco::default(),
    )
    .unwrap();
    let img = ridisegna(&scritto.pdf, 0);
    // La quarta lettera stretta sta prima di 20 + 3·12 + 12; quella larga
    // dopo 20 + 3·80.
    assert!(inchiostro(&img, 20, 30, 80, 55) > 0);
    assert_eq!(inchiostro(&img, 90, 30, 400, 55), 0);
    assert!(
        inchiostro(&img, 255, 100, 280, 125) > 0,
        "la quarta lettera larga"
    );
    assert_eq!(
        inchiostro(&img, 40, 100, 95, 125),
        0,
        "niente fra la prima e la seconda"
    );
}

#[test]
fn pdf_export_riquadri_e_trasparenze_nel_loro_posto() {
    let pezzi = vec![
        Pezzo::Riquadro {
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 50.0,
            colore: [255.0, 0.0, 0.0, 1.0],
        },
        Pezzo::Riquadro {
            x: 200.0,
            y: 20.0,
            w: 100.0,
            h: 50.0,
            colore: [0.0, 0.0, 255.0, 0.5],
        },
    ];
    let scritto = scrivi(&elenco(vec![], vec![pezzi]), &Banco::default()).unwrap();
    let img = ridisegna(&scritto.pdf, 0);
    assert_eq!(pixel(&img, 60, 45), [255, 0, 0]);
    assert_eq!(pixel(&img, 60, 80), [255, 255, 255], "sotto il riquadro");
    let mezzo = pixel(&img, 250, 45);
    assert!(
        mezzo[0] > 100 && mezzo[0] < 160 && mezzo[2] == 255,
        "{mezzo:?}"
    );
}

#[test]
fn pdf_export_il_vettore_resta_un_vettore() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect x="0" y="0" width="50" height="50" fill="#00ff00"/></svg>"##;
    let pezzi = vec![Pezzo::Vettore {
        x: 100.0,
        y: 100.0,
        w: 200.0,
        h: 100.0,
        svg: svg.into(),
    }];
    let scritto = scrivi(&elenco(vec![], vec![pezzi]), &Banco::default()).unwrap();
    let img = ridisegna(&scritto.pdf, 0);
    // Il vettore è largo il doppio: la metà sinistra è verde, l'altra no.
    assert_eq!(pixel(&img, 150, 150), [0, 255, 0]);
    assert_eq!(pixel(&img, 250, 150), [255, 255, 255]);
    assert_eq!(pixel(&img, 150, 95), [255, 255, 255], "sopra, niente");
    // E nel file non c'è nessuna immagine: è un vettore.
    let doc = lopdf::Document::load_mem(&scritto.pdf).unwrap();
    let immagini = doc
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .filter(|s| s.dict.get(b"Subtype").and_then(|v| v.as_name()).ok() == Some(b"Image"))
        .count();
    assert_eq!(immagini, 0);
}

fn png(w: u32, h: u32, colore: [u8; 3]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().unwrap();
        let dati: Vec<u8> = (0..w * h).flat_map(|_| colore).collect();
        writer.write_image_data(&dati).unwrap();
    }
    out
}

#[test]
fn pdf_export_l_immagine_nel_suo_riquadro_e_quella_che_manca() {
    let mut banco = Banco::default();
    banco
        .immagini
        .insert("Foto/blu.png".into(), png(8, 4, [0, 0, 255]));
    let pezzi = vec![
        Pezzo::Immagine {
            x: 50.0,
            y: 50.0,
            w: 160.0,
            h: 80.0,
            file: "Foto/blu.png".into(),
        },
        Pezzo::Immagine {
            x: 250.0,
            y: 50.0,
            w: 50.0,
            h: 50.0,
            file: "Foto/non-c-e.png".into(),
        },
    ];
    let scritto = scrivi(&elenco(vec![], vec![pezzi]), &banco).unwrap();
    let img = ridisegna(&scritto.pdf, 0);
    assert_eq!(pixel(&img, 130, 90), [0, 0, 255]);
    assert_eq!(pixel(&img, 130, 140), [255, 255, 255]);
    assert_eq!(
        scritto.avvisi,
        vec![Avviso::ImmagineMancante {
            file: "Foto/non-c-e.png".into()
        }]
    );
}

#[test]
fn pdf_export_un_immagine_grande_resta_intera() {
    // 3000×2000 pixel: nella prova l'immagine entra com'è, senza alleggerirla
    // (lo farà T77a); il PDF la porta compressa.
    let mut banco = Banco::default();
    banco
        .immagini
        .insert("grande.png".into(), png(3000, 2000, [200, 100, 50]));
    let pezzi = vec![Pezzo::Immagine {
        x: 0.0,
        y: 0.0,
        w: 400.0,
        h: 266.0,
        file: "grande.png".into(),
    }];
    let scritto = scrivi(&elenco(vec![], vec![pezzi]), &banco).unwrap();
    assert!(scritto.avvisi.is_empty());
    let img = ridisegna(&scritto.pdf, 0);
    assert_eq!(pixel(&img, 200, 100), [200, 100, 50]);
}

#[test]
fn pdf_export_un_carattere_che_non_si_incorpora_esce_in_literata() {
    let mut banco = Banco::default();
    let mono = crate::draw::per_il_pdf::decode(&carattere_app(MONO).unwrap())
        .unwrap()
        .into_owned();
    banco.caratteri.insert(
        "chiuso.ttf".into(),
        crate::draw::per_il_pdf::with_fs_type(&mono, 2),
    );
    let facce = vec![faccia("Chiuso", "chiuso.ttf", &[])];
    let scritto = scrivi(
        &elenco(facce, vec![vec![testo(10.0, 40.0, 0, 16.0, "Ciao", 9.0)]]),
        &banco,
    )
    .unwrap();
    assert_eq!(
        scritto.avvisi,
        vec![Avviso::CarattereNonIncorporabile {
            famiglia: "Chiuso".into()
        }]
    );
    assert_eq!(lettere(&scritto.pdf), vec!["Ciao".to_string()]);
    let doc = lopdf::Document::load_mem(&scritto.pdf).unwrap();
    let nomi: Vec<String> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter(|d| d.get(b"Type").and_then(|v| v.as_name()).ok() == Some(b"FontDescriptor"))
        .filter_map(|d| d.get(b"FontName").and_then(|v| v.as_name()).ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .collect();
    assert_eq!(nomi.len(), 1);
    assert!(nomi[0].contains("Literata"), "{nomi:?}");
}

#[test]
fn pdf_export_un_file_che_manca_e_le_lettere_che_nessuno_ha() {
    let facce = vec![
        faccia("Sparita", "/fonts/non-c-e.woff2", &[]),
        faccia("Newsreader Variable", NEWSREADER, &[]),
    ];
    // Newsreader è il sotto-insieme latino: l'ideogramma non c'è, e nemmeno
    // in Literata.
    let pezzi = vec![
        testo(10.0, 40.0, 0, 16.0, "Ciao", 9.0),
        testo(10.0, 80.0, 1, 16.0, "a中b", 9.0),
    ];
    let scritto = scrivi(&elenco(facce, vec![pezzi]), &Banco::default()).unwrap();
    assert_eq!(
        scritto.avvisi,
        vec![
            Avviso::CarattereMancante {
                famiglia: "Sparita".into(),
                file: "/fonts/non-c-e.woff2".into()
            },
            Avviso::LettereMancanti {
                famiglia: "Newsreader Variable".into(),
                lettere: "中".into()
            },
        ]
    );
    // La lettera che manca esce nel glifo vuoto, ma nel testo resta il
    // carattere di ripiego: chi copia non perde le altre.
    let testo = &lettere(&scritto.pdf)[0];
    assert!(testo.starts_with("Ciaoa"), "{testo}");
    assert!(testo.ends_with('b'), "{testo}");
}

#[test]
fn pdf_export_lo_stesso_elenco_da_lo_stesso_pdf() {
    let facce = vec![faccia("Newsreader Variable", NEWSREADER, &[("opsz", 12.0)])];
    let e = elenco(facce, vec![vec![testo(10.0, 40.0, 0, 12.0, "Uguale", 7.0)]]);
    let a = scrivi(&e, &Banco::default()).unwrap().pdf;
    let b = scrivi(&e, &Banco::default()).unwrap().pdf;
    assert_eq!(a, b);
}

#[test]
fn pdf_export_gli_elenchi_rotti_hanno_il_loro_errore() {
    let mut e = elenco(vec![], vec![vec![]]);
    e.versione = 2;
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::Versione { trovata: 2 }
    );
    let e = elenco(vec![], vec![]);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::NumeroPagine { pagine: 0 }
    );
    let e = elenco(vec![], vec![vec![testo(0.0, 0.0, 3, 12.0, "x", 1.0)]]);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::FacciaSconosciuta {
            pagina: 1,
            pezzo: 0
        }
    );
    let facce = vec![faccia("Newsreader Variable", NEWSREADER, &[])];
    let mut pezzo = testo(0.0, 0.0, 0, 12.0, "xy", 1.0);
    if let Pezzo::Testo { posizioni, .. } = &mut pezzo {
        posizioni.pop();
    }
    let e = elenco(facce.clone(), vec![vec![pezzo]]);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::Posizioni {
            pagina: 1,
            pezzo: 0
        }
    );
    let e = elenco(facce, vec![vec![testo(f64::NAN, 0.0, 0, 12.0, "x", 1.0)]]);
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::MisuraPezzo {
            pagina: 1,
            pezzo: 0
        }
    );
    let mut e = elenco(vec![], vec![vec![]]);
    e.larghezza = 0.0;
    assert_eq!(
        scrivi(&e, &Banco::default()).unwrap_err(),
        ErroreEsportazione::MisuraPagina
    );
}

#[test]
fn pdf_export_l_elenco_si_legge_dal_json_della_vista() {
    let json = r#"{
        "versione": 1, "larghezza": 794, "altezza": 1123, "titolo": "Nota",
        "facce": [{"famiglia": "Newsreader Variable", "file": "/fonts/newsreader-latin-opsz-normal.woff2",
                   "corsivo": false, "assi": [{"tag": "wght", "valore": 400}, {"tag": "opsz", "valore": 16}]}],
        "pagine": [{"pezzi": [
            {"tipo": "testo", "x": 72, "y": 90, "larghezza": 30, "faccia": 0, "corpo": 16,
             "colore": [42, 40, 38, 1], "testo": "Ciao", "posizioni": [0, 9.1, 13.2, 21.5]},
            {"tipo": "riquadro", "x": 72, "y": 100, "w": 300, "h": 1, "colore": [0, 0, 0, 0.2]}
        ]}]
    }"#;
    let e: ElencoPagine = serde_json::from_str(json).unwrap();
    let scritto = scrivi(&e, &Banco::default()).unwrap();
    assert_eq!(lettere(&scritto.pdf), vec!["Ciao".to_string()]);
    // Un campo sconosciuto è un elenco di un'altra versione, non un dettaglio.
    let sbagliato = json.replace("\"titolo\"", "\"intestazione\"");
    assert!(serde_json::from_str::<ElencoPagine>(&sbagliato).is_err());
}
