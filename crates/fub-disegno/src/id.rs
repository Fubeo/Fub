//! Gli id che il disegno dà agli elementi nuovi e a quelli che ricevono un id
//! con `ident`, nel formato di `apps/client/src/editors/spatial/scene/ids.ts`
//! (decisione A5): un prefisso (`o` oggetto, `l` livello, `r` risorsa, `b`
//! tavola, `c` carta di una tavola) e 8 caratteri base36.
//!
//! Il caso viene da un UUID v4 (`uuid`, già nel grafo del workspace): dei suoi
//! 16 byte se ne usano i 14 interamente casuali, perché il byte 6 porta la
//! versione e il byte 8 la variante. Come nel client un byte vale solo sotto
//! 252, il più grande multiplo di 36 che sta in un byte, così ogni carattere è
//! uniforme; un id già usato si scarta e se ne genera un altro.

/// Che cosa riceve l'id.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Specie {
    /// Un oggetto qualunque: forma, testo, gruppo.
    Oggetto,
    /// Un livello.
    Livello,
    /// Una risorsa e ciò che contiene.
    Risorsa,
    /// Una tavola.
    Tavola,
    /// La carta di una tavola.
    Carta,
}

impl Specie {
    /// Il prefisso dell'id.
    pub fn prefisso(self) -> char {
        match self {
            Specie::Oggetto => 'o',
            Specie::Livello => 'l',
            Specie::Risorsa => 'r',
            Specie::Tavola => 'b',
            Specie::Carta => 'c',
        }
    }
}

/// Quanti caratteri casuali seguono il prefisso.
pub const LUNGHEZZA_CASUALE: usize = 8;

/// Il byte più grande che si usa, escluso: 7 × 36.
const SENZA_SBILANCIO: u8 = 252;

/// Quante volte si ritenta prima di arrendersi: con 36⁸ id possibili arrivarci
/// vuol dire una sorgente di caso guasta.
const MAX_TENTATIVI: usize = 1_000;

const BASE36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Una sorgente di caso: i 16 byte di un UUID v4.
pub type Caso<'a> = &'a mut dyn FnMut() -> [u8; 16];

/// Un id nuovo di `specie` che `preso` non conosce, dal caso del sistema.
/// `None` solo se mille tentativi di fila vanno a vuoto.
pub fn nuovo(specie: Specie, preso: &dyn Fn(&str) -> bool) -> Option<String> {
    nuovo_con(specie, preso, &mut || *uuid::Uuid::new_v4().as_bytes())
}

/// [`nuovo`] con una sorgente di caso data (per le prove).
pub fn nuovo_con(specie: Specie, preso: &dyn Fn(&str) -> bool, caso: Caso<'_>) -> Option<String> {
    for _ in 0..MAX_TENTATIVI {
        let mut id = String::with_capacity(LUNGHEZZA_CASUALE + 1);
        id.push(specie.prefisso());
        let mut giri = 0;
        while id.len() < LUNGHEZZA_CASUALE + 1 {
            giri += 1;
            if giri > MAX_TENTATIVI {
                return None;
            }
            for (i, b) in caso().into_iter().enumerate() {
                // Il byte 6 porta la versione, l'8 la variante.
                if i == 6 || i == 8 || b >= SENZA_SBILANCIO {
                    continue;
                }
                id.push(char::from(BASE36[usize::from(b % 36)]));
                if id.len() == LUNGHEZZA_CASUALE + 1 {
                    break;
                }
            }
        }
        if !preso(&id) {
            return Some(id);
        }
    }
    None
}

/// Vero se `id` ha la forma degli id nuovi di `specie`.
pub fn e_nuovo(id: &str, specie: Specie) -> bool {
    let mut c = id.chars();
    c.next() == Some(specie.prefisso())
        && id.len() == LUNGHEZZA_CASUALE + 1
        && c.all(|c| c.is_ascii_digit() || c.is_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forma_e_prefissi() {
        for specie in [
            Specie::Oggetto,
            Specie::Livello,
            Specie::Risorsa,
            Specie::Tavola,
            Specie::Carta,
        ] {
            let id = nuovo(specie, &|_| false).expect("un id");
            assert!(e_nuovo(&id, specie), "{id}");
        }
    }

    #[test]
    fn scarta_i_byte_sbilanciati_e_quelli_fissi() {
        // Tutti i byte a 255 tranne il 6 e l'8, scartati comunque: nessun
        // carattere esce, e la sorgente guasta finisce in `None`.
        let mut guasto = || {
            let mut b = [255u8; 16];
            b[6] = 1;
            b[8] = 1;
            b
        };
        assert_eq!(nuovo_con(Specie::Oggetto, &|_| false, &mut guasto), None);
        let mut zeri = || [0u8; 16];
        assert_eq!(
            nuovo_con(Specie::Oggetto, &|_| false, &mut zeri).as_deref(),
            Some("o00000000")
        );
        let mut alti = || [251u8; 16];
        assert_eq!(
            nuovo_con(Specie::Livello, &|_| false, &mut alti).as_deref(),
            Some("lzzzzzzzz")
        );
    }

    #[test]
    fn mai_uguale_a_uno_preso() {
        let mut n = 0u8;
        let mut caso = || {
            n = n.wrapping_add(1);
            [n; 16]
        };
        let preso = |id: &str| id == "o11111111";
        let id = nuovo_con(Specie::Oggetto, &preso, &mut caso).expect("un id");
        assert_eq!(id, "o22222222");
    }
}
