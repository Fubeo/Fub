//! **Il plugin che non collabora.**
//!
//! `ping-wasm` è il componente che si comporta bene, e prova che il contratto
//! si attraversa. Questo è il suo contrario, e prova la cosa che l'altro non
//! può provare: che il confine regge **anche quando di là non torna nessuno**.
//! Ha tre job e ognuno è una domanda diversa all'host:
//!
//! - `eco` torna subito, ed è il controllo negativo *dentro lo stesso
//!   componente*: se anche lui venisse fermato, i limiti non distinguerebbero
//!   l'ostile dal normale, starebbero solo interrompendo tutto.
//! - `ciclo` non torna mai. Non chiama niente, non alloca niente, non passa mai
//!   dal confine: la sola cosa che può raggiungerlo è l'interruzione a epoche,
//!   cioè un contatore che il codice compilato guarda da sé a ogni giro.
//! - `mangia` chiede memoria e non smette, e **conta quanta gliene hanno data**
//!   prima del primo rifiuto. Non serve un ciclo lungo per fermarlo: serve un
//!   tetto, ed è `StoreLimits` a metterlo — e chiedendo con `alloc` invece che
//!   con un `Vec` il rifiuto torna come valore, così il numero che il job
//!   risponde *è* il tetto misurato dal di dentro.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi
//! — e a maggior ragione uno che fa finta di essere scritto male.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:ciclo/ciclo",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;

/// L'id del plugin. Suo è il namespace del §7.4, e sotto quel nome il test lo
/// monta accanto a `demo.ping` — i due stanno nello stesso host di proposito,
/// perché la prova che l'host è vivo dopo l'interruzione la deve dare qualcuno
/// che non è il componente interrotto.
const ID: &str = "demo.ciclo";

/// La versione del contratto contro cui è scritto, come in `ping-wasm`.
const ABI: &str = "0.1.1";

/// Il bersaglio della scrittura `volatile` del ciclo.
///
/// Serve solo a esistere. Un `loop {}` con il corpo vuoto è codice morto e
/// LLVM ha il diritto di trattarlo come tale; una scrittura `volatile`, no —
/// per definizione ha un effetto che il compilatore non può dedurre, e quindi
/// il ciclo resta nel `.wasm` esattamente come lo si è scritto. È la differenza
/// fra provare che l'host interrompe un ciclo e provare che l'host interrompe
/// un ciclo *che l'ottimizzatore ha già cancellato*.
static mut BRUCIATO: u64 = 0;

/// Quanta memoria chiede per volta il job che divora: 1 MiB.
///
/// Un morso grosso abbastanza da arrivare al tetto in poche decine di giri —
/// così è il **tetto** a fermare il job, e non la scadenza, e il test lo può
/// distinguere guardando l'orologio.
const MORSO: usize = 1024 * 1024;

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Demo Ciclo (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: ABI.to_string(),
            // Nessun permesso: questo plugin non chiede niente all'host. È il
            // punto — un componente ostile non ha bisogno di una capacità per
            // fare danno, gli basta non tornare, e i limiti devono valere anche
            // per chi non ha chiesto niente a nessuno.
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        match job.as_str() {
            // Il controllo negativo, dentro lo stesso componente che ospita i
            // due job ostili: gli stessi limiti, la stessa istanza, e una
            // risposta immediata.
            "eco" => Ok("{\"eco\":true}".to_string()),

            // Il ciclo che non finisce. Nessuna chiamata, nessuna allocazione:
            // se l'host lo ferma, lo ferma con l'unica cosa che arriva fin qui.
            "ciclo" => {
                let mut n: u64 = 0;
                loop {
                    n = n.wrapping_add(1);
                    // SAFETY: `BRUCIATO` è toccato solo da qui, e un componente
                    // WASM di questo bersaglio ha un thread solo — non esiste un
                    // secondo scrittore da cui difendersi. La `volatile` non
                    // serve alla correttezza: serve a essere non cancellabile.
                    unsafe { core::ptr::write_volatile(core::ptr::addr_of_mut!(BRUCIATO), n) };
                }
            }

            // La fame che non passa: chiede un morso dopo l'altro e non
            // restituisce mai niente, finché non glielo dicono.
            //
            // Chiede con `std::alloc::alloc` e non con un `Vec`, ed è la
            // differenza fra provare una cosa e provarne un'altra. Un `Vec` che
            // non riesce ad allocare chiama `handle_alloc_error`, che aborta,
            // che nel `.wasm` è un `unreachable`: si vedrebbe morire il plugin,
            // ma non si vedrebbe **dove** è il tetto. `alloc` invece restituisce
            // il puntatore nullo, cioè il `-1` di `memory.grow` raccontato in
            // Rust, e il plugin può contare quanto ha ottenuto e dirlo. È anche
            // la ragione per cui l'host lascia spento `trap_on_grow_failure`
            // (vedi `limiti::tetto`): «non c'è posto» è una cosa che un plugin
            // può rispondere, e questo job è il componente che la risponde.
            //
            // Le due scritture `volatile` toccano la prima e l'ultima pagina del
            // morso: un'allocazione che nessuno scrive potrebbe non far crescere
            // davvero la memoria lineare, e il tetto non lo incontrerebbe
            // nessuno. La memoria non si restituisce mai — è il punto.
            "mangia" => {
                // Il fiato per raccontarlo. Chi finisce la memoria e poi vuole
                // dire com'è andata deve essersi tenuto da parte il posto per la
                // risposta: senza questa riserva, il `format!` qui sotto
                // sarebbe la prima allocazione a fallire dopo il tetto, e il
                // plugin morirebbe con la notizia in bocca.
                let riserva: Vec<u8> = Vec::with_capacity(64 * 1024);

                let strato = core::alloc::Layout::from_size_align(MORSO, 16)
                    .expect("un morso da 1 MiB allineato a 16 è un `Layout` valido");
                let mut morsi: u64 = 0;
                loop {
                    // SAFETY: `strato` ha dimensione non nulla, ed è l'unica
                    // condizione che `alloc` pone. Ciò che torna non viene mai
                    // liberato di proposito.
                    let p = unsafe { std::alloc::alloc(strato) };
                    if p.is_null() {
                        break;
                    }
                    // SAFETY: `p` è appena stato allocato per `MORSO` byte, e i
                    // due indirizzi toccati sono il primo e l'ultimo di quelli.
                    unsafe {
                        core::ptr::write_volatile(p, 1u8);
                        core::ptr::write_volatile(p.add(MORSO - 1), 1u8);
                    }
                    morsi += 1;
                }

                drop(riserva);
                Ok(format!("{{\"mib\":{morsi}}}"))
            }

            altro => Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(
                altro.to_string(),
            ))),
        }
    }
}

export!(Componente);
