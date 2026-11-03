//! L'oracolo a pixel: disegnare un SVG nello stesso modo su ogni macchina, e
//! contare dove due disegni differiscono.
//!
//! Serve a chi confronta due versioni dello stesso disegno — il cancello dei
//! disegni apre un file, lo modifica, lo riporta indietro e guarda se si vede
//! qualcosa di diverso. Perché il confronto dica qualcosa del disegno e non
//! della macchina, il disegno non dipende da niente che la macchina abbia.
//!
//! # I caratteri
//!
//! Il database dei caratteri è costruito **solo** da [`Opzioni::facce`]: mai i
//! caratteri del sistema, che cambiano da una macchina all'altra, e la feature
//! `system-fonts` di `resvg` resta spenta. Le famiglie generiche (`serif`,
//! `sans-serif`, `monospace`, `cursive`, `fantasy`) sono tutte la famiglia
//! della prima faccia, e una famiglia che nessuna faccia ha ripiega su di lei:
//! quale carattere disegna un testo lo decidono le facce passate, non i nomi
//! scritti nel file. Un carattere che nessuna faccia ha si disegna con il
//! glifo di ripiego della faccia scelta, uguale nei due lati di un confronto.
//!
//! **Senza facce i testi spariscono**: non c'è niente con cui disegnarli, e
//! l'immagine non li contiene. Chi confronta disegni con dei testi passa le
//! facce di Fub (`crates/fub-features/fonts/`).
//!
//! Nemmeno i file esterni entrano: `resources_dir` è `None`, quindi
//! un'immagine collegata per percorso relativo non si carica. Le immagini
//! raster non si decodificano affatto (la feature `raster-images` di `resvg`
//! è spenta qui): l'oracolo confronta forme, tratti, colori e testi.
//!
//! # Lo sfondo
//!
//! Il disegno è fatto su bianco opaco, come lo si vede in Fub: ogni pixel di
//! [`Immagine::rgba`] ha alfa 255, e i canali sono quelli che si vedono.
//!
//! # La soglia
//!
//! [`confronta`] non chiede uguaglianza esatta: un pixel è diverso se uno dei
//! suoi canali cambia più di `soglia`. La ragione è l'antialiasing: una forma
//! spostata di una frazione di pixel, o lo stesso tracciato scritto con numeri
//! arrotondati in un altro modo, cambia di poco i pixel del bordo senza che
//! niente si veda. La soglia di colore toglie quel rumore, e ciò che resta si
//! conta; quanti pixel diversi si accettano lo decide chi confronta. Il banco
//! di fedeltà del client (`apps/client/bench/fidelity.mjs`) fa la stessa cosa
//! con `pixelmatch` e accetta al più lo 0,2% dei pixel diversi, e il cancello
//! dei disegni tiene la stessa misura.
//!
//! Con `fuori` si esclude la zona che un gesto ha toccato apposta: quello che
//! si conta è ciò che è cambiato **altrove**.

use std::sync::Arc;

use resvg::tiny_skia::{Color, Pixmap, Transform};
use resvg::usvg::{self, fontdb};

/// Il lato più lungo che [`disegna`] accetta, in pixel, per la larghezza e
/// per l'altezza che ne viene.
pub const LATO_MASSIMO: u32 = 8192;

/// Come disegnare un SVG.
#[derive(Clone, Copy, Debug)]
pub struct Opzioni<'a> {
    /// La larghezza dell'immagine in pixel, da 1 a [`LATO_MASSIMO`].
    /// L'altezza ne viene in proporzione alla misura del disegno.
    pub larghezza: u32,
    /// I caratteri, come byte di file TrueType, OpenType o collezioni. Gli
    /// unici che il disegno può usare: vedi la documentazione del modulo.
    pub facce: &'a [&'a [u8]],
}

/// Un disegno in pixel: RGBA a 8 bit, riga per riga dall'alto, opaco.
#[derive(Clone, PartialEq, Eq)]
pub struct Immagine {
    pub larghezza: u32,
    pub altezza: u32,
    /// `larghezza × altezza × 4` byte, non premoltiplicati (lo sfondo è
    /// opaco, quindi lo sarebbero comunque).
    pub rgba: Vec<u8>,
}

impl std::fmt::Debug for Immagine {
    // I byte non si stampano: in un `assert_eq!` fallito sarebbero milioni.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Immagine")
            .field("larghezza", &self.larghezza)
            .field("altezza", &self.altezza)
            .field("rgba", &format_args!("[{} byte]", self.rgba.len()))
            .finish()
    }
}

/// Quanto differiscono due immagini.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Confronto {
    /// I pixel diversi, fuori dalla zona esclusa.
    pub diversi: u64,
    /// I pixel contati: tutti, meno quelli della zona esclusa.
    pub totali: u64,
    /// Il rettangolo più piccolo che contiene i pixel diversi, come
    /// `[x, y, larghezza, altezza]` in pixel; `None` se non ce n'è nessuno.
    pub riquadro: Option<[u32; 4]>,
}

/// Disegna `svg` alla larghezza di `opzioni`, con i soli caratteri di
/// `opzioni`.
///
/// La misura del disegno è quella dell'elemento `<svg>`: `width` e `height`,
/// o il `viewBox` quando mancano (con un `viewBox` e senza misure, le
/// proporzioni sono quelle del `viewBox`). L'altezza dell'immagine è la
/// larghezza chiesta per il rapporto fra le due, arrotondata, almeno 1.
///
/// Un SVG che non si legge, una larghezza fuori da 1..=[`LATO_MASSIMO`] o
/// un'altezza che ne verrebbe fuori sono un errore, mai un panico.
pub fn disegna(svg: &str, opzioni: &Opzioni<'_>) -> Result<Immagine, String> {
    let larghezza = opzioni.larghezza;
    if larghezza == 0 || larghezza > LATO_MASSIMO {
        return Err(format!(
            "la larghezza dev'essere fra 1 e {LATO_MASSIMO} pixel, non {larghezza}"
        ));
    }

    let usvg_opzioni = usvg::Options {
        resources_dir: None,
        fontdb: Arc::new(caratteri(opzioni.facce)),
        ..usvg::Options::default()
    };
    let albero = usvg::Tree::from_str(svg, &usvg_opzioni)
        .map_err(|errore| format!("l'SVG non si legge: {errore}"))?;

    let misura = albero.size();
    let scala = larghezza as f32 / misura.width();
    let alta = (misura.height() * scala).round();
    if !alta.is_finite() || alta > LATO_MASSIMO as f32 {
        return Err(format!(
            "alla larghezza di {larghezza} pixel il disegno sarebbe alto più di {LATO_MASSIMO}"
        ));
    }
    // `alta` è finita, non negativa (una misura di `usvg` è positiva) e al più
    // `LATO_MASSIMO`: la conversione non tronca.
    let altezza = (alta as u32).max(1);

    let mut tela = Pixmap::new(larghezza, altezza)
        .ok_or_else(|| format!("non si crea un'immagine di {larghezza} × {altezza} pixel"))?;
    tela.fill(Color::WHITE);
    resvg::render(
        &albero,
        Transform::from_scale(scala, scala),
        &mut tela.as_mut(),
    );

    Ok(Immagine {
        larghezza,
        altezza,
        // Sullo sfondo opaco ogni pixel ha alfa 255, e i byte premoltiplicati
        // di `tiny-skia` sono già quelli diritti.
        rgba: tela.take(),
    })
}

/// Il database dei caratteri fatto delle sole `facce`, con le famiglie
/// generiche puntate sulla prima.
fn caratteri(facce: &[&[u8]]) -> fontdb::Database {
    let mut db = fontdb::Database::new();
    for faccia in facce {
        db.load_font_data(faccia.to_vec());
    }
    let prima = db
        .faces()
        .next()
        .and_then(|faccia| faccia.families.first())
        .map(|(nome, _)| nome.clone());
    if let Some(nome) = prima {
        db.set_serif_family(nome.clone());
        db.set_sans_serif_family(nome.clone());
        db.set_monospace_family(nome.clone());
        db.set_cursive_family(nome.clone());
        db.set_fantasy_family(nome);
    }
    db
}

/// Confronta due immagini della stessa misura.
///
/// Un pixel è diverso se almeno uno dei suoi quattro canali differisce più di
/// `soglia` (vedi «La soglia» nel modulo; con 0 conta ogni differenza). Con
/// `fuori = Some([x, y, larghezza, altezza])` i pixel dentro quel rettangolo
/// non si contano né fra i diversi né fra i totali; la parte del rettangolo
/// che esce dall'immagine non conta.
///
/// Due immagini di misura diversa, o con un `rgba` che non è lungo quanto la
/// misura dice, sono un errore.
pub fn confronta(
    a: &Immagine,
    b: &Immagine,
    soglia: u8,
    fuori: Option<[u32; 4]>,
) -> Result<Confronto, String> {
    if (a.larghezza, a.altezza) != (b.larghezza, b.altezza) {
        return Err(format!(
            "le immagini hanno misure diverse: {} × {} e {} × {}",
            a.larghezza, a.altezza, b.larghezza, b.altezza
        ));
    }
    for immagine in [a, b] {
        let attesi = u64::from(immagine.larghezza) * u64::from(immagine.altezza) * 4;
        if immagine.rgba.len() as u64 != attesi {
            return Err(format!(
                "un'immagine di {} × {} pixel ha {} byte invece di {attesi}",
                immagine.larghezza,
                immagine.altezza,
                immagine.rgba.len()
            ));
        }
    }

    let escluso = |x: u32, y: u32| {
        fuori.is_some_and(|[fx, fy, fl, fa]| {
            x >= fx
                && y >= fy
                && u64::from(x) < u64::from(fx) + u64::from(fl)
                && u64::from(y) < u64::from(fy) + u64::from(fa)
        })
    };

    let mut diversi = 0u64;
    let mut totali = 0u64;
    // [x minimo, y minimo, x massimo, y massimo], inclusi.
    let mut estremi: Option<[u32; 4]> = None;
    let larghezza = a.larghezza as usize;
    for (indice, (pa, pb)) in a
        .rgba
        .chunks_exact(4)
        .zip(b.rgba.chunks_exact(4))
        .enumerate()
    {
        // `indice` < larghezza × altezza, che sono due `u32`: x e y ci stanno.
        let x = (indice % larghezza) as u32;
        let y = (indice / larghezza) as u32;
        if escluso(x, y) {
            continue;
        }
        totali += 1;
        if pa.iter().zip(pb).any(|(ca, cb)| ca.abs_diff(*cb) > soglia) {
            diversi += 1;
            estremi = Some(match estremi {
                None => [x, y, x, y],
                Some([x0, y0, x1, y1]) => [x0.min(x), y0.min(y), x1.max(x), y1.max(y)],
            });
        }
    }

    Ok(Confronto {
        diversi,
        totali,
        riquadro: estremi.map(|[x0, y0, x1, y1]| [x0, y0, x1 - x0 + 1, y1 - y0 + 1]),
    })
}
