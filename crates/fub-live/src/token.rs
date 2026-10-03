//! I valori casuali della sessione: id, segreto di abbinamento, gettone di
//! ripresa, e l'impronta del certificato.
//!
//! Viaggiano in base64url senza padding (RFC 4648 §5): sono i caratteri che un
//! URL e un QR in modalità byte portano senza scappare niente, e la lettura è
//! stretta — lunghezza esatta, nessun padding, bit di coda a zero — così ogni
//! valore ha una grafia sola. I segreti si confrontano a tempo costante, si
//! azzerano quando escono di scena e non si stampano con `{:?}`.

use std::fmt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ring::rand::{SecureRandom, SystemRandom};
use subtle::ConstantTimeEq;
use zeroize::Zeroize;

/// Il generatore casuale del sistema non ha risposto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the system random generator is unavailable")]
pub struct RandomUnavailable;

fn random<const N: usize>(rng: &SystemRandom) -> Result<[u8; N], RandomUnavailable> {
    let mut bytes = [0u8; N];
    rng.fill(&mut bytes).map_err(|_| RandomUnavailable)?;
    Ok(bytes)
}

fn decode<const N: usize>(text: &str) -> Option<[u8; N]> {
    // La lunghezza si controlla prima di decodificare: un testo lungo non
    // alloca niente, e uno di lunghezza giusta decodifica in un array fisso.
    if text.len() != encoded_len(N) {
        return None;
    }
    let mut bytes = [0u8; N];
    let written = URL_SAFE_NO_PAD.decode_slice(text, &mut bytes).ok()?;
    (written == N).then_some(bytes)
}

const fn encoded_len(bytes: usize) -> usize {
    (bytes * 4).div_ceil(3)
}

/// L'id della sessione: 64 bit casuali. Non è un segreto — sta nel QR accanto
/// al segreto e torna in ogni `welcome` — ma non si indovina, così una
/// connessione verso la porta sbagliata finisce con 4001 prima di arrivare al
/// segreto.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId([u8; 8]);

impl SessionId {
    pub(crate) fn generate(rng: &SystemRandom) -> Result<Self, RandomUnavailable> {
        random(rng).map(SessionId)
    }

    /// Legge un id dalla sua grafia nel QR o nel `hello`.
    pub fn parse(text: &str) -> Option<Self> {
        decode(text).map(SessionId)
    }

    /// La grafia dell'id: 11 caratteri base64url.
    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }

    pub(crate) fn matches(&self, other: &SessionId) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl fmt::Debug for SessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "SessionId({})", self.encode())
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.encode())
    }
}

macro_rules! secret {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        pub struct $name([u8; 16]);

        impl $name {
            pub(crate) fn generate(rng: &SystemRandom) -> Result<Self, RandomUnavailable> {
                random(rng).map($name)
            }

            /// Legge il valore dalla sua grafia: 22 caratteri base64url.
            pub fn parse(text: &str) -> Option<Self> {
                decode(text).map($name)
            }

            /// La grafia del valore. È il segreto stesso: va solo nel QR o nel
            /// messaggio che lo porta, mai in un log.
            pub fn encode(&self) -> String {
                URL_SAFE_NO_PAD.encode(self.0)
            }

            /// Il confronto a tempo costante: chi misura i tempi di risposta
            /// non impara quanti byte del suo tentativo erano giusti.
            pub fn matches(&self, other: &$name) -> bool {
                self.0.ct_eq(&other.0).into()
            }
        }

        impl Clone for $name {
            fn clone(&self) -> Self {
                $name(self.0)
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                self.0.zeroize();
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(concat!(stringify!($name), "(…)"))
            }
        }
    };
}

secret!(
    /// Il segreto di abbinamento: 128 bit, monouso, valido 5 minuti. Lo porta il
    /// QR, fuori banda, e lo consuma il primo `hello` valido.
    PairingSecret
);

secret!(
    /// Il gettone di ripresa: 128 bit, cambia a ogni connessione accettata.
    ResumeToken
);

/// L'impronta SHA-256 del certificato effimero, come la porta il QR.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Fingerprint([u8; 32]);

impl Fingerprint {
    /// L'impronta di un certificato in DER.
    pub fn of_certificate(der: &[u8]) -> Self {
        let digest = ring::digest::digest(&ring::digest::SHA256, der);
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(digest.as_ref());
        Fingerprint(bytes)
    }

    /// Legge un'impronta dalla sua grafia: 43 caratteri base64url.
    pub fn parse(text: &str) -> Option<Self> {
        decode(text).map(Fingerprint)
    }

    /// La grafia dell'impronta.
    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }

    /// Il confronto a tempo costante con l'impronta di un certificato
    /// ricevuto.
    pub fn matches(&self, other: &Fingerprint) -> bool {
        self.0.ct_eq(&other.0).into()
    }

    /// I 32 byte dell'impronta.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for Fingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "Fingerprint({})", self.encode())
    }
}

impl fmt::Display for Fingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.encode())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_value_has_one_spelling_of_the_declared_length() {
        let rng = SystemRandom::new();
        let session = SessionId::generate(&rng).unwrap();
        assert_eq!(session.encode().len(), 11);
        assert_eq!(SessionId::parse(&session.encode()), Some(session));

        let secret = PairingSecret::generate(&rng).unwrap();
        assert_eq!(secret.encode().len(), 22);
        assert!(PairingSecret::parse(&secret.encode())
            .unwrap()
            .matches(&secret));

        let token = ResumeToken::generate(&rng).unwrap();
        assert_eq!(token.encode().len(), 22);

        let fingerprint = Fingerprint::of_certificate(b"certificato");
        assert_eq!(fingerprint.encode().len(), 43);
        assert_eq!(Fingerprint::parse(&fingerprint.encode()), Some(fingerprint));
    }

    #[test]
    fn a_non_canonical_spelling_is_refused() {
        // 16 byte a zero: 21 `A` e un'ultima cifra che porta solo i 2 bit di
        // coda. Con i bit di coda diversi da zero la stessa sequenza di byte
        // avrebbe due grafie.
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAA").is_some());
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAB").is_none());
        // Il padding, l'alfabeto standard e le lunghezze sbagliate.
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAA==").is_none());
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAA+/").is_none());
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAA").is_none());
        assert!(PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAAA").is_none());
        assert!(PairingSecret::parse("").is_none());
        assert!(SessionId::parse("AAAAAAAAAA=").is_none());
    }

    #[test]
    fn two_secrets_differ_and_a_secret_does_not_print() {
        let rng = SystemRandom::new();
        let first = PairingSecret::generate(&rng).unwrap();
        let second = PairingSecret::generate(&rng).unwrap();
        assert!(!first.matches(&second));
        assert_eq!(format!("{first:?}"), "PairingSecret(…)");
        let token = ResumeToken::generate(&rng).unwrap();
        assert!(!format!("{token:?}").contains(&token.encode()));
    }
}
