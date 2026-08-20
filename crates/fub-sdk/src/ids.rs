//! Le **forme** di un'identità: UUID, id corto, timbro Zettelkasten (§12.3).
//!
//! # Perché qui e non nel contratto
//!
//! Perché la capacità dell'host è **l'entropia**, non il formato:
//! [`HostEnv::random_bytes`](fub_abi::HostEnv::random_bytes) dà byte, che solo
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

use fub_abi::{HostEnv, PluginError};

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
/// [`random_bytes`](fub_abi::HostEnv::random_bytes) — un `Guard` senza la
/// capacità `Env` — non rende byte, e qui quel caso diventa il **rifiuto che
/// l'host ha scritto**: *un id che non si è potuto generare non è un id di
/// zeri*, che collide con ogni altro id non generato dallo stesso host.
///
/// Rendeva `None`, e il `None` era la parte debole di un'ottima decisione: la
/// ragione la sapeva l'host e si perdeva qui, un livello prima di chi avrebbe
/// dovuto mostrarla. Con la [0094](../../../docs/decisions/0094-un-tetto-che-si-fa-sentire.md)
/// la ragione arriva intera fino a chi disegna — che per un errore, dalla
/// [0041](../../../docs/decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)
/// in poi, è tutto il punto.
pub fn uuid_v4(host: &dyn HostEnv) -> Result<String, PluginError> {
    let mut b: [u8; 16] = exact(host, 16)?;
    b[6] = (b[6] & 0x0F) | 0x40; // versione 4
    b[8] = (b[8] & 0x3F) | 0x80; // variante RFC 9562
    Ok(format_uuid(&b))
}

/// `N` byte esatti, o il rifiuto dell'host.
///
/// Esiste perché la protezione che c'era prima era la **forma dell'array**: un
/// `try_into` verso `[u8; 16]` fallisce se i byte sono meno, e questo bastava
/// finché ogni chiamante scriveva un array di dimensione fissa. Bastava per
/// caso, non per contratto — chi avesse tenuto i byte in un `Vec` non avrebbe
/// avuto niente che glielo dicesse. Adesso a proteggere è la firma; il
/// `try_into` resta come **presidio di un host che mentisse**, e diventa
/// `Internal` perché a quel punto la colpa non è più né di chi chiama né del
/// permesso: è di un'implementazione che ha detto `Ok` rendendo meno di quanto
/// il contratto le impone.
fn exact<const N: usize>(host: &dyn HostEnv, n: u32) -> Result<[u8; N], PluginError> {
    let bytes = host.random_bytes(n)?;
    bytes.try_into().map_err(|v: Vec<u8>| {
        PluginError::Internal(
            format!("asked for {n} random bytes, the host provided {}", v.len()).into(),
        )
    })
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
pub fn uuid_v7(host: &dyn HostEnv) -> Result<String, PluginError> {
    let ms = host.now_unix_millis();
    let rand: [u8; 10] = exact(host, 10)?;
    let mut b = [0u8; 16];
    // 48 bit di millisecondi, big-endian: è l'ordine che rende il confronto
    // lessicografico uguale al confronto temporale.
    b[..6].copy_from_slice(&ms.to_be_bytes()[2..]);
    b[6..].copy_from_slice(&rand);
    b[6] = (b[6] & 0x0F) | 0x70; // versione 7
    b[8] = (b[8] & 0x3F) | 0x80; // variante RFC 9562
    Ok(format_uuid(&b))
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
///
/// È l'unica delle tre forme con una lunghezza **variabile**, quindi la sola che
/// il tetto dell'host possa davvero mordere: un `len` che venisse da fuori — una
/// impostazione, un argomento di comando — poteva superarlo, e prima riceveva
/// silenziosamente meno caratteri di quanti ne aveva chiesti. Il controllo
/// `bytes.len() < len` che stava qui lo prendeva, ma rendeva `None` senza dire
/// se il problema fosse il tetto o il permesso: due cose che chi chiama
/// correggerebbe in modi opposti.
pub fn short_id(host: &dyn HostEnv, len: usize) -> Result<String, PluginError> {
    let len32 = u32::try_from(len).map_err(|_| {
        PluginError::BadArgs(format!("a short id of {len} characters is not valid").into())
    })?;
    let bytes = host.random_bytes(len32)?;
    Ok(bytes
        .iter()
        .map(|b| ALPHABET[(b & 0x1F) as usize] as char)
        .collect())
}

/// I sedici byte nella forma canonica `8-4-4-4-12`.
fn format_uuid(b: &[u8; 16]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(36);
    for (the, byte) in b.iter().enumerate() {
        write!(s, "{byte:02x}").expect("writing to a String never fails");
        if matches!(the, 3 | 5 | 7 | 9) {
            s.push('-');
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use std::collections::HashSet;

    // Il doppio è `MemoryHost`, che sta in questo crate dalla
    // [decisione 0054](../../../docs/decisions/0054-il-banco-del-lato-provider.md).
    // Qui ce n'era una copia scritta a mano, e il commento che la accompagnava
    // dava la ragione: «non è `MemoryHost` perché quello sta in
    // `fub-features`, che dipende da questo crate». La ragione è evaporata col
    // trasloco, e con lei quaranta righe — fra cui un `random_bytes` identico
    // riga per riga a quello del doppio vero.

    #[test]
    fn a_v4_has_the_shape_the_rfc_asks_for() {
        let id = uuid_v4(&MemoryHost::new()).unwrap();
        assert_eq!(id.len(), 36);
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert_eq!(&parts[2][..1], "4", "the version nibble");
        assert!(
            ['8', '9', 'a', 'b'].contains(&parts[3].chars().next().unwrap()),
            "the variant nibble: {id}"
        );
    }

    #[test]
    fn a_v7_carries_its_own_timestamp() {
        let bench = MemoryHost::new();
        let id = uuid_v7(&bench).unwrap();
        let ms = u64::from_str_radix(&id.replace('-', "")[..12], 16).unwrap();
        assert_eq!(ms, 1_700_000_000_000);
        assert_eq!(&id.split('-').nth(2).unwrap()[..1], "7");
    }

    /// Il motivo per cui il v7 esiste: due id nati in ordine si confrontano in
    /// ordine, anche come stringhe.
    #[test]
    fn v7_sorts_the_way_time_does() {
        let bench = MemoryHost::new();
        let first = uuid_v7(&bench).unwrap();
        bench.advance(1);
        let second = uuid_v7(&bench).unwrap();
        assert!(first < second, "{first} does not precede {second}");
    }

    #[test]
    fn short_ids_stay_in_the_readable_alphabet() {
        let bench = MemoryHost::new();
        for _ in 0..200 {
            let id = short_id(&bench, 6).unwrap();
            assert_eq!(id.len(), 6);
            assert!(
                id.bytes().all(|b| ALPHABET.contains(&b)),
                "out of alphabet: {id}"
            );
            assert!(!id.contains('I') && !id.contains('L') && !id.contains('O'));
        }
    }

    #[test]
    fn a_thousand_ids_do_not_collide() {
        let bench = MemoryHost::new();
        let seen: HashSet<String> = (0..1000).map(|_| uuid_v4(&bench).unwrap()).collect();
        assert_eq!(seen.len(), 1000);
    }

    /// Un host che nega l'entropia non produce un id di zeri: non produce un id.
    ///
    /// Asseriva `None`, e il `None` era vero ma povero: diceva che l'id non
    /// c'era, non **perché**. Adesso la ragione arriva fin qui, ed è quella che
    /// chi disegna deve poter mostrare a chi guarda.
    #[test]
    fn a_denied_capability_gives_no_id_instead_of_a_colliding_one() {
        let muted = MemoryHost::new().without_entropy();
        for result in [uuid_v4(&muted), uuid_v7(&muted), short_id(&muted, 6)] {
            let err = result.expect_err("without entropy no identity is born");
            assert!(
                matches!(err, PluginError::PermissionDenied(_)),
                "a denied permission must say permission denied: {err}"
            );
        }
    }

    /// I due modi di non ricevere byte **non si confondono**, ed è tutto ciò che
    /// la §23.12 chiedeva: prima erano lo stesso `None`, e chi lo leggeva non
    /// poteva sapere se chiedere meno sarebbe servito a qualcosa.
    #[test]
    fn asking_too_much_is_not_the_same_as_being_denied() {
        let bench = MemoryHost::new();
        let too_much = short_id(&bench, fub_abi::MAX_RANDOM_BYTES as usize + 1)
            .expect_err("above the cap it does not truncate");
        assert!(matches!(too_much, PluginError::BadArgs(_)), "{too_much}");

        let muted = MemoryHost::new().without_entropy();
        let denied = short_id(&muted, 6).expect_err("without entropy no identity is born");
        assert!(
            matches!(denied, PluginError::PermissionDenied(_)),
            "{denied}"
        );

        // Sotto il tetto e con la capacità, la richiesta grande riesce: il tetto
        // rifiuta ciò che è assurdo, non ciò che è grande.
        assert_eq!(
            short_id(&bench, fub_abi::MAX_RANDOM_BYTES as usize)
                .unwrap()
                .chars()
                .count(),
            fub_abi::MAX_RANDOM_BYTES as usize
        );
    }
}
