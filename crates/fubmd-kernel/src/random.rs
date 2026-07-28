//! Il **caso**: da dove il kernel prende i byte con cui si generano le identità
//! (§12.3).
//!
//! # Perché non una dipendenza
//!
//! Il kernel non porta dipendenze che non siano il contratto — è la stessa
//! regola che ha fatto scrivere a mano l'aritmetica del calendario in
//! [`crate::time`] — e per il caso la regola vale con un argomento in più: un
//! generatore *crittografico* preso da un crate prometterebbe qui una qualità
//! che questa capacità dichiara di non avere
//! ([`HostEnv::random_bytes`](fubmd_abi::HostEnv::random_bytes): per
//! l'identità, non per i segreti). Una dipendenza che promette più di ciò che si
//! usa è il modo in cui una promessa vera a metà entra in un progetto: qualcuno,
//! più avanti, la userebbe per ciò che il nome del crate suggerisce.
//!
//! # Da dove viene l'imprevedibilità che c'è
//!
//! Da `RandomState`, che la libreria standard semina **dal sistema operativo**:
//! è ciò che rende non predicibile l'ordine di iterazione di una `HashMap`, e
//! nasce da `getrandom`/`BCryptGenRandom` a seconda della piattaforma. Il seme è
//! quindi buono; ciò che non è di qualità crittografica è il *flusso* che ne
//! deriviamo, perché SipHash non è pensato per quello.
//!
//! Il seme si prende **una volta per processo** e da lì si avanza con un
//! contatore: due chiamate non danno mai lo stesso valore — che è ciò che
//! l'identità chiede, e che l'orologio da solo non garantisce, perché due
//! chiamate nello stesso millisecondo lo trovano fermo.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use fubmd_abi::MAX_RANDOM_BYTES;

/// Il seme del processo: `RandomState` presa una volta, che la std ha già
/// seminato dal sistema operativo.
fn seed() -> &'static RandomState {
    static SEED: OnceLock<RandomState> = OnceLock::new();
    SEED.get_or_init(RandomState::new)
}

/// Il contatore che fa avanzare il flusso. Parte da zero: ciò che rende diverse
/// due chiamate è il contatore, ciò che le rende imprevedibili è il seme, e
/// tenerli distinti è il motivo per cui questo non è un orologio travestito.
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// `n` byte di caso, con il tetto di
/// [`MAX_RANDOM_BYTES`]: chi ne chiede di più ne riceve mille, e non un errore —
/// una richiesta assurda non deve far fallire la generazione di un id.
pub fn random_bytes(n: u32) -> Vec<u8> {
    let n = n.min(MAX_RANDOM_BYTES) as usize;
    let mut out = Vec::with_capacity(n);
    while out.len() < n {
        let mut h = seed().build_hasher();
        h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        // Il numero di byte già prodotti entra nello stato: senza, due chiamate
        // che partissero dallo stesso contatore darebbero lo stesso blocco.
        h.write_usize(out.len());
        out.extend_from_slice(&h.finish().to_le_bytes());
    }
    out.truncate(n);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn it_gives_exactly_what_was_asked() {
        for n in [0u32, 1, 7, 8, 9, 16, 64] {
            assert_eq!(random_bytes(n).len(), n as usize);
        }
    }

    #[test]
    fn the_ceiling_holds_and_does_not_fail() {
        assert_eq!(random_bytes(u32::MAX).len(), MAX_RANDOM_BYTES as usize);
    }

    /// La sola promessa vera: due chiamate non danno lo stesso valore. Diecimila
    /// UUID di fila senza una collisione è ciò che serve a un vault.
    #[test]
    fn two_calls_never_agree() {
        let mut visti = HashSet::new();
        for _ in 0..10_000 {
            assert!(
                visti.insert(random_bytes(16)),
                "due identità uguali: il flusso si ripete"
            );
        }
    }

    /// Un blocco lungo non è la stessa parola ripetuta: il contatore entra in
    /// ogni giro, non solo nel primo.
    #[test]
    fn a_long_block_does_not_repeat_itself() {
        let b = random_bytes(64);
        let primo = &b[..8];
        assert!(
            b.chunks(8).skip(1).any(|c| c != primo),
            "il blocco è otto byte ripetuti otto volte"
        );
    }
}
