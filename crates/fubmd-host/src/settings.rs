//! I due interruttori, finché le impostazioni sono variabili d'ambiente.
//!
//! Stanno qui e non nella colla Tauri per la stessa ragione del montaggio: sono
//! decisioni su **cosa si monta** e su **cosa si apre**, non su come lo si
//! disegna, e una CLI che leggesse un'altra variabile per accendere il
//! versioning avrebbe due configurazioni per la stessa cosa.
//!
//! Il §11.1 li assorbirà entrambi in uno store di configurazione dichiarativo.
//! Questo modulo è dove atterrerà — oggi sono due `std::env::var`, e sono
//! elencati in [strozzature.md](../../../../docs/roadmap/strozzature.md) come
//! tali.

/// Il versioning è acceso?
///
/// Fino ai settings dichiarativi di M3 l'interruttore è una variabile
/// d'ambiente. Acceso di default — è una rete di sicurezza, e una rete che va
/// accesa a mano non c'è quando serve — e spento da `FUBMD_VERSIONING` a `0`,
/// `off`, `no` o `false`.
pub fn versioning_enabled() -> bool {
    match std::env::var("FUBMD_VERSIONING") {
        Err(_) => true,
        Ok(v) => !matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "0" | "off" | "no" | "false"
        ),
    }
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot): chi
/// monta lo legge e apre il vault senza passare dal dialogo.
pub fn initial_vault() -> Option<String> {
    std::env::var("FUBMD_VAULT").ok().filter(|s| !s.is_empty())
}
