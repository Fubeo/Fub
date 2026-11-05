//! Le misure di un JPEG, contro file costruiti a mano: un JPEG minimo base e
//! progressivo, un `SOF` che manca, una lunghezza che esce dai byte, i
//! segmenti oltre il tetto, un file di due byte.

use fub_format_craft::jpeg::{size, MAX_SEGMENTS};

/// Un segmento: il marcatore, la lunghezza (che conta sé stessa) e il resto.
fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, marker];
    out.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Un `SOF` di un componente, alto `height` e largo `width`.
fn sof(marker: u8, width: u16, height: u16) -> Vec<u8> {
    let mut payload = vec![8];
    payload.extend_from_slice(&height.to_be_bytes());
    payload.extend_from_slice(&width.to_be_bytes());
    payload.extend_from_slice(&[1, 1, 0x11, 0]);
    segment(marker, &payload)
}

/// `SOI`, i segmenti, poi una scansione finta e `EOI`.
fn jpeg(segments: &[Vec<u8>]) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    for part in segments {
        out.extend_from_slice(part);
    }
    out.extend_from_slice(&segment(0xDA, &[1, 1, 0, 0, 63, 0]));
    out.extend_from_slice(&[0x12, 0x34, 0xFF, 0xD9]);
    out
}

fn app0() -> Vec<u8> {
    segment(0xE0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0")
}

#[test]
fn un_jpeg_base_dice_le_sue_misure() {
    let dqt = segment(0xDB, &[0; 65]);
    let dht = segment(0xC4, &[0; 20]);
    let file = jpeg(&[app0(), dqt, sof(0xC0, 1620, 1080), dht]);
    assert_eq!(size(&file), Some((1620, 1080)));
}

#[test]
fn un_jpeg_progressivo_dice_le_sue_misure() {
    let dht = segment(0xC4, &[0; 20]);
    // Una tabella che sembra un SOF (C4) prima del SOF2 vero.
    let file = jpeg(&[app0(), dht, sof(0xC2, 3, 5)]);
    assert_eq!(size(&file), Some((3, 5)));
    // Il riempimento di FF prima di un marcatore è lecito.
    let mut padded = vec![0xFF, 0xD8, 0xFF, 0xFF];
    padded.extend_from_slice(&sof(0xC2, 7, 9));
    assert_eq!(size(&padded), Some((7, 9)));
}

#[test]
fn senza_sof_non_ci_sono_misure() {
    assert_eq!(size(&jpeg(&[app0()])), None);
    // DHT, JPG e DAC non sono intestazioni.
    for marker in [0xC4, 0xC8, 0xCC] {
        assert_eq!(size(&jpeg(&[sof(marker, 10, 10)])), None, "{marker:x}");
    }
    // Un file che non è un JPEG.
    assert_eq!(size(b"\x89PNG\r\n\x1a\n"), None);
    assert_eq!(size(&[]), None);
}

#[test]
fn una_lunghezza_che_esce_dai_byte_non_si_segue() {
    let mut file = vec![0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xF0];
    file.extend_from_slice(&[0; 32]);
    file.extend_from_slice(&sof(0xC0, 10, 10));
    assert_eq!(size(&file), None);
    // Un SOF troncato: la lunghezza dice 17, i byte sono meno.
    let mut short = vec![0xFF, 0xD8];
    short.extend_from_slice(&sof(0xC0, 10, 10)[..8]);
    assert_eq!(size(&short), None);
    // Una lunghezza sotto 2 non è un segmento.
    assert_eq!(size(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 0x00]), None);
}

#[test]
fn mille_segmenti_vuoti_fermano_la_ricerca() {
    let empty = segment(0xFE, &[]);
    let mut many = vec![empty.clone(); MAX_SEGMENTS];
    many.push(sof(0xC0, 10, 10));
    assert_eq!(MAX_SEGMENTS, 1000);
    assert_eq!(size(&jpeg(&many)), None);
    // Uno di meno, e il SOF è il millesimo.
    many.remove(0);
    assert_eq!(size(&jpeg(&many)), Some((10, 10)));
}

#[test]
fn un_file_di_due_byte_non_ha_misure() {
    assert_eq!(size(&[0xFF, 0xD8]), None);
    assert_eq!(size(&[0xFF, 0xD9]), None);
}

#[test]
fn misure_a_zero_non_sono_lecite() {
    assert_eq!(size(&jpeg(&[sof(0xC0, 0, 10)])), None);
    assert_eq!(size(&jpeg(&[sof(0xC0, 10, 0)])), None);
    assert_eq!(
        size(&jpeg(&[sof(0xC0, 65_535, 65_535)])),
        Some((65_535, 65_535))
    );
}
