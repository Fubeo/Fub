//! Le misure di un JPEG, dalla sua intestazione.
//!
//! Il file è input ostile: si cammina fra i segmenti senza mai fidarsi di una
//! lunghezza che non sta nei byte, e al più per [`MAX_SEGMENTS`] segmenti.

/// I segmenti che si guardano al più, il `SOF` compreso.
pub const MAX_SEGMENTS: usize = 1000;

/// Il lato più lungo che un JPEG può dichiarare.
const MAX_SIDE: u32 = 65_535;

/// Larghezza e altezza di un JPEG: la firma `FF D8`, poi i segmenti uno dopo
/// l'altro fino al primo `SOF` (da `C0` a `CF`, tranne `C4`, `C8` e `CC`, che
/// sono tabelle e non intestazioni), che dice altezza e larghezza big endian.
///
/// Ogni lunghezza si controlla contro i byte, e i segmenti guardati sono al
/// più [`MAX_SEGMENTS`]. Un file che finisce, che arriva ai dati (`SOS`) o
/// alla fine (`EOI`) prima del `SOF`, o con misure a zero o oltre 65 535, non
/// ha misure.
pub fn size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut rest = bytes.strip_prefix(&[0xFF, 0xD8][..])?;
    for _ in 0..MAX_SEGMENTS {
        // Un marcatore è `FF` seguito da un byte che non è `FF`: i `FF` in più
        // sono riempimento.
        let mut at = 0;
        while rest.get(at) == Some(&0xFF) {
            at += 1;
        }
        if at == 0 {
            return None;
        }
        let marker = *rest.get(at)?;
        rest = rest.get(at + 1..)?;
        match marker {
            // I marcatori senza lunghezza: `TEM` e `RST0`–`RST7`.
            0x01 | 0xD0..=0xD7 => continue,
            // `SOI` di nuovo, `EOI`, i dati della scansione: niente `SOF`.
            0x00 | 0xD8 | 0xD9 | 0xDA => return None,
            _ => {}
        }
        let length = usize::from(u16::from_be_bytes([*rest.first()?, *rest.get(1)?]));
        if length < 2 {
            return None;
        }
        let segment = rest.get(2..length)?;
        if is_sof(marker) {
            // Precisione, altezza, larghezza.
            let height = u32::from(u16::from_be_bytes([*segment.get(1)?, *segment.get(2)?]));
            let width = u32::from(u16::from_be_bytes([*segment.get(3)?, *segment.get(4)?]));
            let lawful = |side: u32| side != 0 && side <= MAX_SIDE;
            return (lawful(width) && lawful(height)).then_some((width, height));
        }
        rest = rest.get(length..)?;
    }
    None
}

/// Un marcatore di inizio fotogramma: `C0`–`CF` tranne `DHT` (`C4`), `JPG`
/// (`C8`) e `DAC` (`CC`).
fn is_sof(marker: u8) -> bool {
    matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC)
}
