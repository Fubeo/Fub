//! Il componente B: legge un documento JSON e somma i suoi numeri.

use comune::{ABI, Descrizione, serde_json};

pub fn lavora(n: u64) -> u64 {
    comune::conta();
    let testo = format!(
        "[{}]",
        (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(",")
    );
    let valori: Vec<u64> = serde_json::from_str(&testo).unwrap_or_default();
    valori.iter().sum()
}

extern "C" fn lavora_c(n: u64) -> u64 {
    std::panic::catch_unwind(|| lavora(n)).unwrap_or(u64::MAX)
}

#[cfg(feature = "ingresso")]
#[unsafe(no_mangle)]
pub extern "C" fn fub_componente_v1() -> Descrizione {
    Descrizione {
        abi: ABI,
        nome: c"componente-b".as_ptr(),
        lavora: lavora_c,
    }
}
