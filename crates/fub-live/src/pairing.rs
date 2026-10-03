//! L'abbinamento: il testo del QR e il suo disegno.
//!
//! Il QR dei percorsi B e C porta tutto ciò che serve per aprire la
//! connessione e fidarsi dell'host:
//!
//! ```text
//! fubdraw://live?h=<ip>:<porta>&s=<sessione>&k=<segreto>&f=<impronta>&n=<nome del PC>
//! ```
//!
//! - `h`: l'indirizzo IPv4 privato e la porta, in decimale;
//! - `s`, `k`, `f`: id di sessione (8 byte), segreto (16 byte) e impronta
//!   SHA-256 del certificato (32 byte), in base64url senza padding: 11, 22 e
//!   43 caratteri, tutti del sottoinsieme che un URL non scappa;
//! - `n`: il nome del PC, in UTF-8 con la codifica percentuale di RFC 3986
//!   per ogni byte che non è un carattere non riservato. Lo scrittore lo mostra
//!   prima di inviare qualunque dato («Abbinamento» in
//!   `docs/reference/live-session.md`), e senza `n` lo saprebbe solo dopo il
//!   handshake. È facoltativo in lettura.
//!
//! Il testo intero sta sotto i 200 byte con un nome corto, cioè un QR di
//! versione 8 o 9 con correzione M: leggibile da una fotocamera a un metro da
//! uno schermo.
//!
//! La lettura è stretta: ogni chiave una volta sola, nessuna chiave
//! sconosciuta, nessun frammento, ogni valore nella sua grafia canonica. Un
//! QR alterato non diventa una connessione verso un indirizzo che il QR non
//! diceva.

use std::fmt::Write as _;
use std::net::{Ipv4Addr, SocketAddrV4};

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};
use zeroize::Zeroizing;

use crate::token::{Fingerprint, PairingSecret, SessionId};

const PREFIX: &str = "fubdraw://live?";
/// Il testo più lungo che si legge: 64 caratteri di nome codificati costano al
/// più 768 byte, e il resto meno di 120.
const MAX_PAYLOAD: usize = 1024;
/// I caratteri del nome del PC.
const MAX_HOST_NAME: usize = 64;

/// Dove e come lo scrittore si collega: il contenuto del QR.
#[derive(Debug, Clone)]
pub struct PairingTarget {
    /// L'indirizzo privato e la porta dell'host.
    pub addr: SocketAddrV4,
    /// La sessione.
    pub session: SessionId,
    /// Il segreto monouso.
    pub secret: PairingSecret,
    /// L'impronta del certificato.
    pub fingerprint: Fingerprint,
    /// Il nome del PC, da mostrare prima di collegarsi.
    pub host_name: Option<String>,
}

/// Il testo letto non è un QR di abbinamento valido.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a valid pairing payload: {0}")]
pub struct PayloadError(&'static str);

/// Il nome del PC è nei limiti: da 1 a 64 caratteri, nessun carattere di
/// controllo.
pub fn valid_host_name(name: &str) -> bool {
    (1..=MAX_HOST_NAME).contains(&name.chars().count()) && !name.chars().any(char::is_control)
}

/// L'indirizzo è uno di quelli su cui un host può ascoltare.
pub(crate) fn allowed_host(ip: Ipv4Addr) -> bool {
    #[cfg(test)]
    if ip.is_loopback() {
        return true;
    }
    ip.is_private()
}

impl PairingTarget {
    /// Il testo del QR. Contiene il segreto: si mostra solo nel QR.
    pub fn to_payload(&self) -> Zeroizing<String> {
        let mut text = Zeroizing::new(String::with_capacity(160));
        // Scrivere su una `String` non fallisce.
        let _ = write!(
            text,
            "{PREFIX}h={}&s={}&k={}&f={}",
            self.addr,
            self.session.encode(),
            self.secret.encode(),
            self.fingerprint.encode()
        );
        if let Some(name) = &self.host_name {
            text.push_str("&n=");
            percent_encode(name, &mut text);
        }
        text
    }

    /// Legge il testo di un QR.
    pub fn parse(payload: &str) -> Result<PairingTarget, PayloadError> {
        if payload.len() > MAX_PAYLOAD {
            return Err(PayloadError("too long"));
        }
        let query = payload
            .strip_prefix(PREFIX)
            .ok_or(PayloadError("not a fubdraw://live link"))?;
        if query.contains('#') {
            return Err(PayloadError("a fragment is not allowed"));
        }
        let (mut h, mut s, mut k, mut f, mut n) = (None, None, None, None, None);
        for pair in query.split('&') {
            let (key, value) = pair
                .split_once('=')
                .ok_or(PayloadError("a parameter without `=`"))?;
            let slot = match key {
                "h" => &mut h,
                "s" => &mut s,
                "k" => &mut k,
                "f" => &mut f,
                "n" => &mut n,
                _ => return Err(PayloadError("unknown parameter")),
            };
            if slot.replace(value).is_some() {
                return Err(PayloadError("repeated parameter"));
            }
        }
        let addr = h
            .ok_or(PayloadError("missing h"))?
            .parse::<SocketAddrV4>()
            .map_err(|_| PayloadError("h is not an IPv4 address and port"))?;
        if !allowed_host(*addr.ip()) || addr.port() == 0 {
            return Err(PayloadError("h is not a private address with a port"));
        }
        let session = SessionId::parse(s.ok_or(PayloadError("missing s"))?)
            .ok_or(PayloadError("s is not a session id"))?;
        let secret = PairingSecret::parse(k.ok_or(PayloadError("missing k"))?)
            .ok_or(PayloadError("k is not a secret"))?;
        let fingerprint = Fingerprint::parse(f.ok_or(PayloadError("missing f"))?)
            .ok_or(PayloadError("f is not a fingerprint"))?;
        let host_name = match n {
            None => None,
            Some(encoded) => {
                let name = percent_decode(encoded)
                    .ok_or(PayloadError("n is not percent-encoded UTF-8"))?;
                if !valid_host_name(&name) {
                    return Err(PayloadError("n exceeds the limits of a PC name"));
                }
                Some(name)
            }
        };
        Ok(PairingTarget {
            addr,
            session,
            secret,
            fingerprint,
            host_name,
        })
    }
}

fn unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

fn percent_encode(text: &str, out: &mut String) {
    for byte in text.bytes() {
        if unreserved(byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%' {
            // Una sola grafia: cifre esadecimali maiuscole, e un carattere non
            // riservato non si codifica.
            let digit = |position: usize| match bytes.get(position)? {
                digit @ b'0'..=b'9' => Some(digit - b'0'),
                digit @ b'A'..=b'F' => Some(digit - b'A' + 10),
                _ => None,
            };
            let decoded = digit(index + 1)? << 4 | digit(index + 2)?;
            if unreserved(decoded) {
                return None;
            }
            out.push(decoded);
            index += 3;
        } else if unreserved(byte) {
            out.push(byte);
            index += 1;
        } else {
            return None;
        }
    }
    String::from_utf8(out).ok()
}

/// Il testo è troppo lungo per un QR.
#[derive(Debug, Clone, thiserror::Error)]
#[error("the pairing payload does not fit a QR code: {0}")]
pub struct QrTooLong(String);

/// Il QR del testo, in SVG: moduli neri su fondo bianco con il margine di
/// quattro moduli, un modulo per unità di `viewBox`. Chi lo mostra lo scala con
/// CSS; il testo comincia con `<svg` e si inserisce così com'è in una pagina.
pub(crate) fn qr_svg(payload: &str) -> Result<String, QrTooLong> {
    let code = QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::M)
        .map_err(|error| QrTooLong(error.to_string()))?;
    let image = code
        .render::<svg::Color<'_>>()
        .quiet_zone(true)
        .module_dimensions(1, 1)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    // Il renderer apre con la dichiarazione XML, che dentro una pagina HTML
    // non ha senso: il documento comincia dall'elemento.
    Ok(match image.find("<svg") {
        Some(start) => image[start..].to_owned(),
        None => image,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;

    fn target(name: Option<&str>) -> PairingTarget {
        let rng = SystemRandom::new();
        PairingTarget {
            addr: "192.168.1.20:52143".parse().unwrap(),
            session: SessionId::generate(&rng).unwrap(),
            secret: PairingSecret::generate(&rng).unwrap(),
            fingerprint: Fingerprint::of_certificate(b"cert"),
            host_name: name.map(str::to_owned),
        }
    }

    #[test]
    fn the_payload_goes_and_comes_back() {
        for name in [
            None,
            Some("PC di Ada"),
            Some("Aula 3 · LIM"),
            Some("a&b=c%d#e"),
        ] {
            let original = target(name);
            let payload = original.to_payload();
            assert!(payload.starts_with("fubdraw://live?h=192.168.1.20:52143&s="));
            assert!(!payload[PREFIX.len()..].contains([' ', '#', '+']));
            let back = PairingTarget::parse(&payload).unwrap();
            assert_eq!(back.addr, original.addr);
            assert_eq!(back.session, original.session);
            assert!(back.secret.matches(&original.secret));
            assert_eq!(back.fingerprint, original.fingerprint);
            assert_eq!(back.host_name.as_deref(), name);
        }
    }

    #[test]
    fn a_tampered_payload_is_refused() {
        let payload = target(Some("PC")).to_payload();
        let replace = |from: &str, to: &str| payload.replacen(from, to, 1);
        for bad in [
            replace("fubdraw://", "https://"),
            replace("fubdraw://live?", "FUBDRAW://live?"),
            replace("192.168.1.20", "8.8.8.8"),
            replace("192.168.1.20", "0.0.0.0"),
            replace("192.168.1.20", "192.168.001.20"),
            replace(":52143", ":0"),
            replace(":52143", ":65536"),
            replace(":52143", ""),
            replace("&s=", "&s=A"),
            replace("&k=", "&k=A"),
            replace("&f=", "&f=A"),
            replace("&n=PC", "&n=P%43"),
            replace("&n=PC", "&n=P C"),
            replace("&n=PC", "&n="),
            replace("&n=PC", "&n=%FF"),
            replace("&n=PC", "&n=%c3%a8"),
            replace("&n=PC", "&n=%+F"),
            replace("&n=PC", "&n=%C"),
            replace("&n=PC", "&n=%0A"),
            replace("&n=PC", "&n=PC&n=PC"),
            replace("&n=PC", "&n=PC&x=1"),
            replace("&n=PC", "&n=PC#frammento"),
            replace("&n=PC", "&n=PC&"),
            format!("{}&h=10.0.0.1:1", payload.as_str()),
        ] {
            assert!(PairingTarget::parse(&bad).is_err(), "{bad}");
        }
        let without_secret: String = payload
            .split('&')
            .filter(|pair| !pair.starts_with("k="))
            .collect::<Vec<_>>()
            .join("&");
        assert!(PairingTarget::parse(&without_secret).is_err());
        let long = format!("{}{}", payload.as_str(), "x".repeat(MAX_PAYLOAD));
        assert_eq!(
            PairingTarget::parse(&long).unwrap_err(),
            PayloadError("too long")
        );
    }

    #[test]
    fn the_longest_name_still_fits_the_payload() {
        let name = "è".repeat(MAX_HOST_NAME);
        let payload = target(Some(&name)).to_payload();
        assert!(payload.len() <= MAX_PAYLOAD);
        assert_eq!(
            PairingTarget::parse(&payload).unwrap().host_name.as_deref(),
            Some(name.as_str())
        );
        assert!(!valid_host_name(&"è".repeat(MAX_HOST_NAME + 1)));
        assert!(!valid_host_name(""));
    }

    #[test]
    fn the_qr_is_a_bare_svg_element() {
        let payload = target(Some("PC di Ada")).to_payload();
        let svg = qr_svg(&payload).unwrap();
        assert!(
            svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""),
            "{svg}"
        );
        assert!(svg.ends_with("</svg>"));
        assert!(svg.contains("fill=\"#000000\""));
        // Il QR codifica proprio il testo: la stessa matrice, rigenerata.
        let code = QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::M).unwrap();
        let side = code.width() + 8;
        assert!(svg.contains(&format!("viewBox=\"0 0 {side} {side}\"")));
        assert!(code.version().width() <= 61, "version {:?}", code.version());
    }
}
