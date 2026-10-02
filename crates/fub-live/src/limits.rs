//! I limiti del protocollo (§8 di `sessione-live.md`) e quelli che l'host si
//! dà da solo per non crescere senza misura.
//!
//! I primi sono il contratto: lo scrittore li riceve nel `welcome` e li
//! rispetta. I secondi non escono dal processo, e ognuno dice quale risorsa
//! limita.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const KIB: usize = 1024;
const MIB: usize = 1024 * KIB;

/// Un messaggio WebSocket: deve contenere uno snapshot di 20 MiB con il suo
/// involucro, e il default di `tungstenite` (16 MiB per frame) non basterebbe.
pub const MAX_MESSAGE: usize = 24 * MIB;
/// Un frame WebSocket: come il messaggio, così uno snapshot può viaggiare in un
/// frame solo. Configurato su entrambi i lati.
pub const MAX_FRAME: usize = 24 * MIB;
/// Un `ink.pts`.
pub const MAX_INK_PTS: usize = 64 * KIB;
/// Un `commit`, come una sola operazione in `operazioni.md` §5.
pub const MAX_COMMIT: usize = 8 * MIB;
/// Il testo SVG di uno snapshot: un documento più grande non apre sessioni.
pub const MAX_SNAPSHOT: usize = 20 * MIB;
/// Ogni altro messaggio dello scrittore (`hello`, `ink.begin`, `view`, `ping`,
/// …): nessuno ha un campo che cresce, e 16 KiB lasciano un margine largo.
pub const MAX_CONTROL: usize = 16 * KIB;
/// Le operazioni di un commit, come quelle di un `batch` (`operazioni.md` §5).
pub const MAX_OPS_PER_COMMIT: usize = 10_000;
/// I messaggi al secondo di una connessione, frame di controllo compresi.
pub const RATE_PER_SECOND: usize = 240;
/// L'attesa del `hello`, contata dall'accettazione del socket: comprende il
/// handshake TLS e l'upgrade WebSocket.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// L'intervallo dell'heartbeat WebSocket.
pub const HEARTBEAT: Duration = Duration::from_secs(10);
/// Gli heartbeat senza risposta che chiudono la connessione.
pub const HEARTBEAT_MISSES: u32 = 2;
/// La validità del segreto di abbinamento.
pub const PAIRING_TTL: Duration = Duration::from_secs(5 * 60);
/// La finestra della ripresa, contata dalla caduta.
pub const RESUME_WINDOW: Duration = Duration::from_secs(2 * 60);
/// L'attesa dopo una chiusura 4006 prima di riprovare.
pub const RATE_COOLDOWN: Duration = Duration::from_secs(5);

/// I byte che una connessione può leggere prima che il suo `hello` sia
/// accettato, richiesta di upgrade compresa. Senza, ogni socket appena aperto
/// potrebbe far allocare all'host un messaggio da 24 MiB prima di essersi
/// presentato.
pub(crate) const HELLO_BUDGET: usize = 64 * KIB;
/// Le connessioni che stanno ancora negoziando: TLS, upgrade e `hello`. Oltre,
/// il socket si chiude appena accettato.
pub(crate) const MAX_HANDSHAKES: usize = 8;
/// I commit in attesa della shell, per tutta la sessione.
pub(crate) const MAX_PENDING_COMMITS: usize = 256;
/// I byte di JSON dei commit in attesa della shell.
pub(crate) const MAX_PENDING_BYTES: usize = 32 * MIB;
/// I `nack` che l'host ricorda per rimandarli alla ripresa.
pub(crate) const RETAINED_NACKS: usize = 64;
/// I byte delle operazioni accumulate dopo l'ultimo snapshot oltre i quali
/// l'host chiede uno snapshot nuovo alla shell.
pub(crate) const LOG_SOFT_BYTES: usize = 4 * MIB;
/// Oltre questa soglia il registro si butta: chi entra aspetta lo snapshot.
pub(crate) const LOG_HARD_BYTES: usize = 16 * MIB;
/// I byte in coda verso una connessione: uno snapshot intero più il margine.
pub(crate) const OUTBOX_BYTES: usize = 64 * MIB;
/// I messaggi in coda verso una connessione.
pub(crate) const OUTBOX_ITEMS: usize = 4096;
/// Il tempo massimo per scrivere un messaggio sul socket.
pub(crate) const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// Il tempo concesso a una chiusura ordinata prima di troncare il socket.
pub(crate) const CLOSE_GRACE: Duration = Duration::from_secs(2);
/// I campioni d'inchiostro (quattro numeri ciascuno) che la coda degli eventi
/// tiene per una shell che non legge. Oltre, l'inchiostro in coda si butta e
/// resta un `inkGap`: il commit lo sostituisce.
pub(crate) const EVENT_INK_POINTS: usize = 256 * 1024;

/// I limiti come li legge lo scrittore nel `welcome`. Le durate sono in
/// millisecondi.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    /// Byte di un messaggio WebSocket.
    pub message: u64,
    /// Byte di un frame WebSocket.
    pub frame: u64,
    /// Byte di un `ink.pts`.
    pub ink_pts: u64,
    /// Byte di un `commit`.
    pub commit: u64,
    /// Byte del testo di uno snapshot.
    pub snapshot: u64,
    /// Messaggi al secondo.
    pub rate: u64,
    /// Attesa del `hello`, in millisecondi.
    pub hello: u64,
    /// Intervallo dell'heartbeat, in millisecondi.
    pub heartbeat: u64,
}

impl Limits {
    /// I limiti della versione 1 del protocollo.
    pub const V1: Limits = Limits {
        message: MAX_MESSAGE as u64,
        frame: MAX_FRAME as u64,
        ink_pts: MAX_INK_PTS as u64,
        commit: MAX_COMMIT as u64,
        snapshot: MAX_SNAPSHOT as u64,
        rate: RATE_PER_SECOND as u64,
        hello: HELLO_TIMEOUT.as_millis() as u64,
        heartbeat: HEARTBEAT.as_millis() as u64,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_welcome_carries_the_numbers_of_the_table() {
        let json = serde_json::to_value(Limits::V1).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "message": 25_165_824,
                "frame": 25_165_824,
                "inkPts": 65_536,
                "commit": 8_388_608,
                "snapshot": 20_971_520,
                "rate": 240,
                "hello": 5000,
                "heartbeat": 10_000,
            })
        );
    }

    #[test]
    fn a_snapshot_fits_in_a_single_frame_with_its_envelope() {
        // Il margine copre l'escape di un SVG ordinario, dove le virgolette e
        // gli a capo sono una piccola parte del testo. Uno snapshot che l'escape
        // porta comunque oltre il messaggio lo rifiuta l'host, come documento
        // oltre i limiti.
        const { assert!(MAX_SNAPSHOT + MAX_SNAPSHOT / 5 <= MAX_FRAME) };
        const { assert!(MAX_FRAME <= MAX_MESSAGE) };
        const { assert!(MAX_COMMIT < MAX_MESSAGE) };
        const { assert!(HELLO_BUDGET >= MAX_CONTROL * 2) };
    }
}
