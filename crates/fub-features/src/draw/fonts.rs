//! I caratteri del vault.
//!
//! Un file `.ttf`, `.otf`, `.woff` o `.woff2` del vault è un carattere che un
//! disegno può usare; i suoi byte possono anche essere una raccolta di facce,
//! come quelle che porta un WOFF2. Questo modulo ne è l'unica autorità,
//! per la superficie dell'editor, che lo interroga dall'indice `fub.draw`, e
//! per l'export, che lo chiama direttamente:
//!
//! - [`decode`] toglie la compressione del WOFF e del WOFF2 e dà i byte del
//!   carattere, con un tetto alla misura;
//! - [`describe`] dice che facce ha un file: la famiglia, il peso, lo stile,
//!   la larghezza, gli assi di un carattere variabile e la famiglia generica
//!   di ripiego. I nomi e le misure li legge `fontdb`, lo stesso che sceglie i
//!   caratteri dell'export, quindi sono quelli che l'export riconosce;
//! - [`choose`] sceglie la faccia di una famiglia per un peso, uno stile e una
//!   larghezza, con le regole di scelta dei CSS, e dice in che punto degli assi
//!   va fissata;
//! - [`instance`] fissa una faccia in quel punto e ne fa un carattere statico,
//!   un file solo con una faccia sola.
//!
//! # Perché un carattere statico
//!
//! Un carattere variabile disegna ogni peso fra il più leggero e il più nero,
//! e ogni larghezza o grandezza ottica che i suoi assi dicono. Il browser
//! sceglie il punto da sé: il peso dal `font-weight`, la grandezza ottica dal
//! corpo del testo. `usvg` 0.45 invece non sa scegliere un punto, e disegna il
//! punto di serie del file. Lo stesso testo uscirebbe in due modi.
//!
//! Così il punto lo sceglie [`choose`], una volta e per tutti e due, e
//! [`instance`] ne fa un carattere che ha soltanto quel punto: i contorni
//! ridisegnati lì da `skrifa` e scritti da `write-fonts`, le larghezze dei
//! glifi, le metriche (`MVAR`), la crenatura e gli attacchi dei segni (le
//! variazioni del `GPOS`) e le sostituzioni che dipendono dal punto (le
//! `FeatureVariations`). Gli assi se ne vanno, e con loro le tabelle delle
//! variazioni. La superficie registra quel file in una `FontFace` e l'export
//! lo dà a `usvg`: sono gli stessi byte, e il browser non ha un asse da
//! muovere né un peso da inventare. La grandezza ottica resta quella di serie
//! del file: un'istanza per ogni corpo sarebbe un carattere per ogni testo.
//!
//! I contorni nuovi sono semplici e senza istruzioni di hinting (le
//! istruzioni valgono per i contorni di serie, e né `resvg` né la webview le
//! usano): un glifo composto diventa un glifo semplice con i contorni dei suoi
//! pezzi, e una curva cubica di un CFF2 diventa una catena di quadratiche entro
//! un quarantesimo di unità.
//!
//! # Un file del vault è un dato
//!
//! Un carattere viene da chiunque abbia scritto nel vault, quindi si legge
//! come un dato qualunque: un file più grande di [`MAX_FONT_BYTES`] non si
//! legge, la decompressione di un WOFF si ferma allo stesso tetto prima di
//! allocare, e un carattere che non si legge è un errore, mai un panico.

use std::borrow::Cow;
use std::fmt;

use super::{MONO, SANS, SERIF};

mod choose;
mod describe;
mod instance;
mod settle;

#[cfg(test)]
pub(crate) use choose::family_generic;
pub(crate) use choose::{choose, choose_reserved, Request};
pub(crate) use describe::{describe, embeddable, Coordinate, Face, Style};
pub(crate) use instance::instance;

/// Il file più grande che si legge, e il carattere più grande che un WOFF o un
/// WOFF2 può diventare: un carattere CJK con tutti i suoi glifi ci sta.
pub(crate) const MAX_FONT_BYTES: usize = 64 * 1024 * 1024;

/// Le famiglie di Fub. Una faccia del vault con uno di questi nomi non conta:
/// il nome è già del carattere che l'app distribuisce, e quel carattere vince.
const RESERVED: [&str; 3] = [SANS, SERIF, MONO];

/// Se due nomi sono la stessa famiglia: come nei browser, senza badare a
/// maiuscole e minuscole, ma soltanto nell'ASCII (la risoluzione del CSSWG del
/// 2019 sui nomi di famiglia). È il confronto di tutti i nomi di famiglia di
/// questo modulo e dell'export, e quello del client.
pub(crate) fn same_family(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// La famiglia di Fub che `name` nomina, scritta come la scrive Fub.
pub(crate) fn reserved(name: &str) -> Option<&'static str> {
    RESERVED.into_iter().find(|fub| same_family(fub, name))
}

/// Perché un file non dà un carattere.
#[derive(Debug, PartialEq)]
pub(crate) enum FontError {
    /// Non comincia come un carattere, una collezione, un WOFF o un WOFF2.
    NotAFont,
    /// Il file, o il carattere che il WOFF promette, passa [`MAX_FONT_BYTES`].
    TooLarge,
    /// Comincia come un carattere, ma non si legge.
    Damaged(String),
    /// La faccia chiesta non c'è.
    NoFace(u32),
}

impl fmt::Display for FontError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FontError::NotAFont => f.write_str("not a font file"),
            FontError::TooLarge => write!(f, "font larger than {} MiB", MAX_FONT_BYTES >> 20),
            FontError::Damaged(reason) => write!(f, "damaged font: {reason}"),
            FontError::NoFace(index) => write!(f, "the font has no face {index}"),
        }
    }
}

fn damaged(error: impl fmt::Display) -> FontError {
    FontError::Damaged(error.to_string())
}

// --- decodificare ------------------------------------------------------------

/// I byte del carattere di un file: un TrueType, un OpenType o una collezione
/// così come sono, un WOFF o un WOFF2 decompresso.
pub(crate) fn decode(bytes: &[u8]) -> Result<Cow<'_, [u8]>, FontError> {
    if bytes.len() > MAX_FONT_BYTES {
        return Err(FontError::TooLarge);
    }
    match bytes.get(..4) {
        Some(b"\0\x01\0\0" | b"true" | b"OTTO" | b"ttcf") => Ok(Cow::Borrowed(bytes)),
        Some(b"wOFF") => {
            promised(bytes)?;
            // Lo zlib di ogni tabella scrive al più quanto la tabella dichiara,
            // e la somma delle dichiarazioni non passa il tetto: un WOFF che
            // promette poco e si gonfia si ferma prima di allocare.
            let mut left = MAX_FONT_BYTES;
            let mut inflate = |data: &[u8], size: usize| {
                if size > left {
                    return Err(Box::<dyn std::error::Error>::from(
                        FontError::TooLarge.to_string(),
                    ));
                }
                left -= size;
                let mut out = Vec::with_capacity(size);
                flate2::Decompress::new(true).decompress_vec(
                    data,
                    &mut out,
                    flate2::FlushDecompress::Finish,
                )?;
                Ok(out)
            };
            wuff::decompress_woff1_with_custom_z(bytes, &mut inflate)
                .map(Cow::Owned)
                .map_err(damaged)
        }
        Some(b"wOF2") => {
            promised(bytes)?;
            let sfnt = wuff::decompress_woff2(bytes).map_err(damaged)?;
            if sfnt.len() > MAX_FONT_BYTES {
                return Err(FontError::TooLarge);
            }
            Ok(Cow::Owned(sfnt))
        }
        _ => Err(FontError::NotAFont),
    }
}

/// Il carattere che un WOFF o un WOFF2 promette (`totalSfntSize`, a 16 byte
/// dall'inizio in tutti e due), che non passa il tetto.
fn promised(bytes: &[u8]) -> Result<(), FontError> {
    let size = bytes
        .get(16..20)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or_else(|| damaged("truncated header"))?;
    if size > MAX_FONT_BYTES {
        return Err(FontError::TooLarge);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests;
