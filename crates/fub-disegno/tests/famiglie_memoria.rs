//! Le tabelle globali del motore del disegno: quanto pesano e come si
//! svuotano (patch 0008 di `vendor/vectorcraft`, `vectorcraft_engine::tables`;
//! piano K6, T28).
//!
//! La misura si lancia a mano:
//!
//! ```text
//! cargo test -p fub-disegno --release --test famiglie_memoria -- --ignored --nocapture
//! ```
//!
//! Per ogni tabella fa ciò che la fa crescere (scritto in [`CRESCITA`]),
//! legge il suo peso prima, dopo e dopo averla svuotata, e lo mette accanto
//! alla crescita del processo (da `/proc/self/statm` su Linux; altrove dice
//! che non misura). Stampa una tabella e non scrive numeri: li scrive T29 in
//! `docs/misure/`. La prova che gira sempre controlla che le tabelle che si
//! svuotano, svuotate, siano vuote, e che il motore dopo lavori ancora.

mod common;

use std::sync::Mutex;

use fub_abi::{DrawingCommandRequest, DRAWING_COMMAND_STROKE_COLOR};
use serde_json::json;
use vectorcraft_engine::{tables, Session};

/// Ciò che fa crescere ogni tabella, e la famiglia della mappa che ci arriva.
/// Una tabella che Fub non fa ancora crescere lo dice, col task che la apre.
const CRESCITA: [(&str, &str); 8] = [
    (
        "image_cache",
        "document.export di un disegno con un'immagine (formati, T23; immagini, T20)",
    ),
    (
        "placed_bitmaps",
        "nessun comando di Fub adesso: documenti collocati disegnati a pezzi (formati, T23)",
    ),
    (
        "halftone_cache",
        "nessun comando di Fub adesso: l'effetto Mezzatinta vettoriale (immagini, T20)",
    ),
    (
        "placed_files",
        "nessun comando di Fub adesso: file.place di un documento collegato (formati, T23)",
    ),
    (
        "placed_reads",
        "nessun comando di Fub adesso: file.place, poi il disegno (formati, T23)",
    ),
    (
        "texture_cache",
        "nessun comando di Fub adesso: un effetto con una trama caricata (raster)",
    ),
    (
        "user_profiles",
        "nessun comando di Fub adesso: color.loadProfile con i byte (colore, T14)",
    ),
    (
        "font_faces",
        "i caratteri che Fub dà al motore come byte (testo, T16; K5 T7)",
    ),
];

/// Le prove toccano tabelle del processo: una alla volta.
fn in_fila() -> std::sync::MutexGuard<'static, ()> {
    static FILA: Mutex<()> = Mutex::new(());
    FILA.lock().unwrap_or_else(|e| e.into_inner())
}

/// Una BMP a 24 bit di `lato`×`lato`, a strisce: byte che Fub passerebbe al
/// motore, senza un file.
fn bmp(lato: u32) -> Vec<u8> {
    let riga = (lato * 3).div_ceil(4) * 4;
    let pixel = riga * lato;
    let mut b = Vec::with_capacity(54 + pixel as usize);
    b.extend_from_slice(b"BM");
    b.extend_from_slice(&(54 + pixel).to_le_bytes());
    b.extend_from_slice(&[0; 4]);
    b.extend_from_slice(&54u32.to_le_bytes());
    b.extend_from_slice(&40u32.to_le_bytes());
    b.extend_from_slice(&(lato as i32).to_le_bytes());
    b.extend_from_slice(&(lato as i32).to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(&[0; 4]);
    b.extend_from_slice(&pixel.to_le_bytes());
    b.extend_from_slice(&[0; 16]);
    for y in 0..lato {
        for x in 0..lato {
            b.extend_from_slice(&[
                (x % 256) as u8,
                (y % 256) as u8,
                ((x / 8 + y / 8) % 2 * 255) as u8,
            ]);
        }
        b.resize(b.len() + (riga - lato * 3) as usize, 0);
    }
    b
}

fn base64(byte: &[u8]) -> String {
    const ALFABETO: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(byte.len().div_ceil(3) * 4);
    for pezzo in byte.chunks(3) {
        let n = pezzo
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= pezzo.len() {
                s.push(ALFABETO[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

/// Fa crescere `image_cache`: apre un'immagine come byte in una sessione del
/// motore e la esporta (il motore la decodifica per disegnarla).
fn cresce_image_cache(lato: u32) {
    fub_disegno::disco::confina().expect("le radici del motore");
    let mut s = Session::new();
    s.execute(
        "document.open",
        &json!({ "name": "prova.bmp", "dataBase64": base64(&bmp(lato)) }),
    )
    .expect("l'immagine si apre dai byte");
    let esito = s
        .execute("document.export", &json!({ "format": "png" }))
        .expect("l'esportazione rende i byte");
    assert!(esito.get("path").is_none(), "{esito}");
}

/// Fa crescere `font_faces`: un carattere dato come byte, come fa Fub.
fn cresce_font_faces() {
    let carattere =
        include_bytes!("../../../vendor/vectorcraft/assets/fonts/JetBrainsMono-Regular.ttf");
    vectorcraft_text::FontDb::global().add_font(carattere.to_vec());
}

fn tabella(nome: &str) -> &'static tables::Table {
    tables::tables()
        .iter()
        .find(|t| t.name == nome)
        .unwrap_or_else(|| panic!("la tabella {nome} c'è"))
}

/// La memoria residente del processo, in byte; `None` dove non si misura.
fn residente() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pagine: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    // Le pagine di Linux su x86_64 e aarch64 di solito: 4 KiB.
    Some(pagine * 4096)
}

fn mib(byte: impl Into<f64>) -> String {
    format!("{:.1}", byte.into() / (1024.0 * 1024.0))
}

#[test]
fn ogni_tabella_ha_la_sua_crescita_scritta() {
    let nomi: Vec<_> = tables::tables().iter().map(|t| t.name).collect();
    let scritte: Vec<_> = CRESCITA.iter().map(|(n, _)| *n).collect();
    assert_eq!(
        nomi, scritte,
        "una tabella della patch 0008 senza la sua riga in CRESCITA, o il contrario"
    );
}

#[test]
fn una_tabella_svuotata_e_vuota_e_il_motore_lavora_ancora() {
    let _fila = in_fila();
    cresce_image_cache(256);
    assert!(
        (tabella("image_cache").bytes)() > 0,
        "l'esportazione non ha decodificato l'immagine"
    );
    tables::release_all();
    for t in tables::tables() {
        if t.release.is_some() {
            assert_eq!((t.bytes)(), 0, "{} svuotata pesa ancora", t.name);
        }
    }
    // Il comando dopo funziona: l'immagine si decodifica di nuovo, e un
    // disegno di Fub cambia come prima.
    cresce_image_cache(64);
    assert!((tabella("image_cache").bytes)() > 0);
    let modello = common::radice().join("crates/fub-features/templates/diagram.it.svg");
    let testo = std::fs::read_to_string(&modello)
        .expect("il modello di Fub")
        .replace("\r\n", "\n");
    let (mut d, _) = common::apri(&testo);
    let esito = d
        .comando(DrawingCommandRequest {
            revision: 0,
            id: DRAWING_COMMAND_STROKE_COLOR.into(),
            selection: vec!["oinizio01".into()],
            value: json!("#ff0000"),
            preview: false,
        })
        .expect("il comando vale");
    assert_eq!(esito.refused, None, "{esito:?}");
    tables::release_all();
}

#[test]
#[ignore = "misura a mano: cargo test -p fub-disegno --release --test famiglie_memoria -- --ignored --nocapture"]
fn misura_le_tabelle() {
    let _fila = in_fila();
    tables::release_all();
    println!("tabella\tcrate\tprima MiB\tdopo MiB\tsvuotata MiB\tprocesso +MiB\tcome cresce");
    for (nome, come) in CRESCITA {
        let t = tabella(nome);
        let prima = (t.bytes)();
        let processo_prima = residente();
        match nome {
            "image_cache" => cresce_image_cache(2048),
            "font_faces" => cresce_font_faces(),
            _ => {}
        }
        let dopo = (t.bytes)();
        let processo = match (processo_prima, residente()) {
            (Some(a), Some(b)) => mib(b.saturating_sub(a) as f64),
            _ => "non misura".into(),
        };
        let svuotata = match t.release {
            Some(svuota) => {
                svuota();
                mib((t.bytes)() as f64)
            }
            None => "non si svuota".into(),
        };
        println!(
            "{nome}\t{}\t{}\t{}\t{svuotata}\t{processo}\t{come}",
            t.krate,
            mib(prima as f64),
            mib(dopo as f64)
        );
    }
    println!("totale adesso: {} MiB", mib(tables::bytes() as f64));
}
