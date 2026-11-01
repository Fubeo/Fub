//! Il componente A: scrive un documento JSON e ne conta i byte.

use comune::{ABI, Descrizione, serde_json};

pub fn lavora(n: u64) -> u64 {
    comune::conta();
    let documento = serde_json::json!({ "componente": "a", "valori": (0..n).collect::<Vec<_>>() });
    serde_json::to_vec(&documento)
        .map(|b| b.len() as u64)
        .unwrap_or(0)
}

extern "C" fn lavora_c(n: u64) -> u64 {
    std::panic::catch_unwind(|| lavora(n)).unwrap_or(u64::MAX)
}

#[cfg(feature = "ingresso")]
#[unsafe(no_mangle)]
pub extern "C" fn fub_componente_v1() -> Descrizione {
    Descrizione {
        abi: ABI,
        nome: c"componente-a".as_ptr(),
        lavora: lavora_c,
    }
}
