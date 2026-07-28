//! Le **forme** di un'identità: UUID, id corto, timbro Zettelkasten (§12.3).
//!
//! # Perché qui e non nel contratto
//!
//! Perché la capacità dell'host è **l'entropia**, non il formato:
//! [`HostEnv::random_bytes`](fubmd_abi::HostEnv::random_bytes) dà byte, che solo
//! l'host può dare, mentre disporli in un UUID è aritmetica che chiunque sa
//! fare. Le identità che FEATURES chiede sono quattro forme diverse — UUID per
//! nota (2.2), id Zettelkasten (8.3), id di blocco (5.2), id di annotazione
//! (13.3) — e un metodo del contratto che ne rendesse una avrebbe lasciato le
//! altre tre a reimplementarsi ognuna a modo suo. È la sesta domanda del piano:
//! non si paga aggiungendo la voce, si paga a ogni voce successiva.
//!
//! E sta nell'**SDK** e non nel kernel perché a M5 chi ne ha bisogno è il guest:
//! un plugin WASM linka questo crate e chiama `random_bytes` attraverso il
//! confine, esattamente come lo chiama un provider nativo.
//!
//! # Ciò che queste funzioni non sono
//!
//! Non sono un generatore crittografico, perché non lo è ciò da cui prendono i
//! byte: un UUID costruito qui è **unico**, non **imprevedibile**. Chi ne
//! ricavasse un token di sessione starebbe usando un contatore come se fosse un
//! segreto.

use fubmd_abi::HostEnv;

/// L'alfabeto degli id corti: le 32 cifre di Crockford base32 — le dieci cifre
/// e le lettere, meno `I`, `L`, `O` e `U`.
///
/// Le prime tre perché si confondono con `1` e `0` in ogni carattere di
/// larghezza fissa, la quarta perché toglie di mezzo l'unica parola che nessuno
/// vuole vedere comparire in un id generato a caso. Un id di blocco finisce
/// dentro una nota, e in una nota lo legge una persona.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Un UUID versione 4 (interamente casuale), nella forma canonica con i
/// trattini: `f81d4fae-7dec-41d0-a765-00a0c91e6bf6`.
///
/// I sedici byte vengono dall'host; i sei bit di versione e variante sono fissati
/// dopo, come vuole la RFC 9562. Un host che negasse
/// [`random_bytes`](fubmd_abi::HostEnv::random_bytes) — un `Guard` senza la
/// capacità `Env` — rende meno byte del necessario, e qui quel caso diventa
/// `None`: **un id che non si è potuto generare non è un id di zeri**, che
/// collide con ogni altro id non generato dallo stesso host.
pub fn uuid_v4(host: &dyn HostEnv) -> Option<String> {
    let mut b: [u8; 16] = host.random_bytes(16).try_into().ok()?;
    b[6] = (b[6] & 0x0F) | 0x40; // versione 4
    b[8] = (b[8] & 0x3F) | 0x80; // variante RFC 9562
    Some(format_uuid(&b))
}

/// Un UUID versione 7: i primi 48 bit sono i millisecondi UNIX, il resto è caso.
///
/// È la forma da preferire per l'identità di una **nota**, e la ragione è che si
/// ordina: due UUID v7 confrontati come stringhe stanno nell'ordine in cui sono
/// nati, quindi un indice che li usa come chiave scrive in coda invece che in
/// mezzo, e un elenco ordinato per id è un elenco ordinato per data. Un v4, che
/// è caso puro, sparpaglia le scritture su tutto l'albero.
///
/// L'orologio è quello dell'host, come i byte: le due capacità della stessa
/// famiglia, chiamate insieme.
pub fn uuid_v7(host: &dyn HostEnv) -> Option<String> {
    let ms = host.now_unix_millis();
    let rand: [u8; 10] = host.random_bytes(10).try_into().ok()?;
    let mut b = [0u8; 16];
    // 48 bit di millisecondi, big-endian: è l'ordine che rende il confronto
    // lessicografico uguale al confronto temporale.
    b[..6].copy_from_slice(&ms.to_be_bytes()[2..]);
    b[6..].copy_from_slice(&rand);
    b[6] = (b[6] & 0x0F) | 0x70; // versione 7
    b[8] = (b[8] & 0x3F) | 0x80; // variante RFC 9562
    Some(format_uuid(&b))
}

/// Un id corto di `len` caratteri, in base32 leggibile: `7K3MQ9`.
///
/// È la forma per ciò che finisce **dentro il testo di una nota** — l'id di
/// blocco del §5.2, l'ancora di un'annotazione — dove un UUID intero occuperebbe
/// più spazio della riga che identifica. Sei caratteri sono poco più di un
/// miliardo di valori: abbastanza per i blocchi di un vault, non abbastanza per
/// un identificatore globale, ed è per questo che le due forme restano due.
///
/// `len` a zero rende la stringa vuota, che è ciò che è stato chiesto.
pub fn short_id(host: &dyn HostEnv, len: usize) -> Option<String> {
    let bytes = host.random_bytes(len as u32);
    if bytes.len() < len {
        return None;
    }
    Some(
        bytes
            .iter()
            .map(|b| ALPHABET[(b & 0x1F) as usize] as char)
            .collect(),
    )
}

/// I sedici byte nella forma canonica `8-4-4-4-12`.
fn format_uuid(b: &[u8; 16]) -> String {
    let hex = |s: &[u8]| s.iter().map(|x| format!("{x:02x}")).collect::<String>();
    format!(
        "{}-{}-{}-{}-{}",
        hex(&b[0..4]),
        hex(&b[4..6]),
        hex(&b[6..8]),
        hex(&b[8..10]),
        hex(&b[10..16])
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Un host minimo: byte che avanzano, orologio che si può muovere. Non è
    /// `MemoryHost` perché quello sta in `fubmd-features`, che dipende da questo
    /// crate — e l'SDK non può dipendere da chi lo usa.
    struct Banco {
        seq: AtomicU64,
        now: AtomicU64,
        muto: bool,
    }

    impl Banco {
        fn new() -> Self {
            Banco {
                seq: AtomicU64::new(0),
                now: AtomicU64::new(1_700_000_000_000),
                muto: false,
            }
        }
    }

    impl fubmd_abi::HostEnv for Banco {
        fn now_unix_millis(&self) -> u64 {
            self.now.load(Ordering::Relaxed)
        }
        fn user_locale(&self) -> fubmd_abi::Locale {
            fubmd_abi::Locale::default()
        }
        fn random_bytes(&self, n: u32) -> Vec<u8> {
            if self.muto {
                return Vec::new();
            }
            // Il contatore in little-endian nei primi otto byte, l'indice negli
            // altri: deterministico e mai ripetuto, che è ciò che serve per
            // provare che gli id non collidono.
            let base = self.seq.fetch_add(1, Ordering::Relaxed).to_le_bytes();
            (0..n as usize)
                .map(|i| base.get(i).copied().unwrap_or(i as u8))
                .collect()
        }
        fn active_context(&self) -> Option<fubmd_abi::ViewContext> {
            None
        }
    }

    #[test]
    fn a_v4_has_the_shape_the_rfc_asks_for() {
        let id = uuid_v4(&Banco::new()).unwrap();
        assert_eq!(id.len(), 36);
        let parti: Vec<&str> = id.split('-').collect();
        assert_eq!(
            parti.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert_eq!(&parti[2][..1], "4", "il nibble di versione");
        assert!(
            ['8', '9', 'a', 'b'].contains(&parti[3].chars().next().unwrap()),
            "il nibble di variante: {id}"
        );
    }

    #[test]
    fn a_v7_carries_its_own_timestamp() {
        let banco = Banco::new();
        let id = uuid_v7(&banco).unwrap();
        let ms = u64::from_str_radix(&id.replace('-', "")[..12], 16).unwrap();
        assert_eq!(ms, 1_700_000_000_000);
        assert_eq!(&id.split('-').nth(2).unwrap()[..1], "7");
    }

    /// Il motivo per cui il v7 esiste: due id nati in ordine si confrontano in
    /// ordine, anche come stringhe.
    #[test]
    fn v7_sorts_the_way_time_does() {
        let banco = Banco::new();
        let primo = uuid_v7(&banco).unwrap();
        banco.now.fetch_add(1, Ordering::Relaxed);
        let secondo = uuid_v7(&banco).unwrap();
        assert!(primo < secondo, "{primo} non precede {secondo}");
    }

    #[test]
    fn short_ids_stay_in_the_readable_alphabet() {
        let banco = Banco::new();
        for _ in 0..200 {
            let id = short_id(&banco, 6).unwrap();
            assert_eq!(id.len(), 6);
            assert!(
                id.bytes().all(|b| ALPHABET.contains(&b)),
                "fuori alfabeto: {id}"
            );
            assert!(!id.contains('I') && !id.contains('L') && !id.contains('O'));
        }
    }

    #[test]
    fn a_thousand_ids_do_not_collide() {
        let banco = Banco::new();
        let visti: HashSet<String> = (0..1000).map(|_| uuid_v4(&banco).unwrap()).collect();
        assert_eq!(visti.len(), 1000);
    }

    /// Un host che nega l'entropia non produce un id di zeri: non produce un id.
    #[test]
    fn a_denied_capability_gives_no_id_instead_of_a_colliding_one() {
        let muto = Banco {
            muto: true,
            ..Banco::new()
        };
        assert_eq!(uuid_v4(&muto), None);
        assert_eq!(uuid_v7(&muto), None);
        assert_eq!(short_id(&muto, 6), None);
    }
}
