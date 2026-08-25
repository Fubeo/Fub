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
//! ([`HostEnv::random_bytes`](fub_abi::HostEnv::random_bytes): per
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

use fub_abi::{PluginError, MAX_RANDOM_BYTES};

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

/// `n` byte di caso, o il rifiuto se `n` supera [`MAX_RANDOM_BYTES`].
///
/// Il tetto c'era già; ciò che è cambiato con la
/// [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md) è che si
/// **sente**. Prima chi ne chiedeva quattromila ne riceveva mille e l'unico modo
/// di accorgersene era misurare la lunghezza di ciò che era tornato: una perdita
/// che non si dichiara, cioè l'unico posto del progetto in cui l'invariante
/// della [0034](../../../docs/decisions/0184-eventi-accodati-e-job.md)
/// era falsa. Il criterio della 0039 — *una richiesta assurda non deve far
/// fallire la generazione di un id* — resta onorato: le identità chiedono
/// sedici, dieci, `len` byte, e nessuna di quelle richieste ha smesso di
/// riuscire.
pub fn random_bytes(n: u32) -> Result<Vec<u8>, PluginError> {
    if n > MAX_RANDOM_BYTES {
        return Err(PluginError::BadArgs(
            format!(
                "{n} random bytes were requested, but this host provides at \
                 most {MAX_RANDOM_BYTES}: an identity wanting more \
                 is not an identity"
            )
            .into(),
        ));
    }
    let n = n as usize;
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
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn it_gives_exactly_what_was_asked() {
        for n in [0u32, 1, 7, 8, 9, 16, 64, MAX_RANDOM_BYTES] {
            assert_eq!(random_bytes(n).unwrap().len(), n as usize);
        }
    }

    /// Si chiamava `the_ceiling_holds_and_does_not_fail`, e asseriva esattamente
    /// la frase che la §23.12 contesta: che il tetto reggesse **senza**
    /// fallire — cioè che il troncamento fosse muto. Adesso presidia il
    /// contrario, ed è il solo modo di provare che chi chiede troppo lo
    /// **sappia**: un `assert` sulla lunghezza avrebbe continuato a passare
    /// anche col difetto in piedi.
    #[test]
    fn the_ceiling_says_no_instead_of_truncating() {
        for n in [MAX_RANDOM_BYTES + 1, 4096, u32::MAX] {
            let err = random_bytes(n).expect_err("above the ceiling we do not truncate, we refuse");
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "asking for too much is the caller's fault: {err}"
            );
            assert!(
                err.message().to_string().contains(&n.to_string()),
                "the refusal must say how much was asked: {err}"
            );
        }
    }

    /// Il confine fra l'ultimo `Ok` e il primo rifiuto sta esattamente sul
    /// tetto, non uno di qua o uno di là.
    #[test]
    fn the_ceiling_itself_is_still_granted() {
        assert!(random_bytes(MAX_RANDOM_BYTES).is_ok());
        assert!(random_bytes(MAX_RANDOM_BYTES + 1).is_err());
    }

    /// La sola promessa vera: due chiamate non danno lo stesso valore. Diecimila
    /// UUID di fila senza una collisione è ciò che serve a un vault.
    #[test]
    fn two_calls_never_agree() {
        let mut seen = HashSet::new();
        for _ in 0..10_000 {
            assert!(
                seen.insert(random_bytes(16).unwrap()),
                "duplicate identity: the stream repeats"
            );
        }
    }

    /// Un blocco lungo non è la stessa parola ripetuta: il contatore entra in
    /// ogni giro, non solo nel primo.
    #[test]
    fn a_long_block_does_not_repeat_itself() {
        let b = random_bytes(64).unwrap();
        let first = &b[..8];
        assert!(
            b.chunks(8).skip(1).any(|c| c != first),
            "the block is eight bytes repeated eight times"
        );
    }
}
