//! **Il componente che parla per primo.**
//!
//! Il ping risponde: gli si chiede un job, torna un valore. Questo invece dice
//! qualcosa **mentre** lavora — a che punto è, che è successa una cosa, che ne
//! vorrebbe fare un'altra — ed è l'unico verso di chiamata che il primo passo di
//! M5 non aveva: dal guest verso l'host, dentro la chiamata dell'host.
//!
//! I quattro job sono quattro frasi, una per ciò che si vuole vedere arrivare
//! dall'altra parte:
//!
//! * `racconta` — due `report-progress` e un `emit`: il progresso di un lavoro
//!   lungo e un evento di dominio, sullo stesso job.
//! * `genera` — uno `spawn-job`, cioè l'unica delle tre che ha un esito, e
//!   restituisce l'identità che l'host gli ha dato: chi legge il risultato può
//!   confrontarla con quella del `job-done` che arriverà dopo.
//! * `figlio` — il corpo che `genera` chiede, e che si annuncia con un `emit`
//!   suo: senza, «il job è partito davvero» resterebbe una parola dell'host.
//! * `spazzatura` — un `emit` con un payload che JSON non è. Non serve a
//!   funzionare: serve a far vedere che un evento che non attraversa **non
//!   sparisce in silenzio**.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:eventi/eventi",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::events::{Event, EventCustom};
use fub::abi::host_events;
use fub::abi::jobs::{JobProgress, JobSpec};

/// L'id del plugin, che è anche il suo **spazio di nomi** (§7.4): i topic degli
/// eventi che emette cominciano di qui, e l'host rifiuta quelli che non lo
/// fanno. È l'unico posto del contratto in cui un nome si verifica quando lo si
/// usa invece che quando lo si registra — un evento `custom` non ha una
/// registrazione.
const ID: &str = "demo.eventi";

/// La versione del contratto contro cui è scritto: la confronta
/// `abi_compatible` al primo passo del montaggio.
const ABI: &str = "0.1.1";

struct Componente;

impl Guest for Componente {
    /// **Nessun permesso dichiarato, e non è una dimenticanza.**
    ///
    /// `host-events` è una delle famiglie che il §7.3 concede senza chiedere:
    /// nel `Guard` del kernel `Capability::Events` non ha un permesso da
    /// nominare. Un manifest vuoto è quindi la dichiarazione *giusta* per
    /// questo componente, e il fatto che parli lo stesso è metà di ciò che il
    /// test prova — l'altra metà la prova il ping senza `read-vault`, che
    /// invece trova il cancello chiuso.
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Demo Eventi (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: ABI.to_string(),
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

    fn run_job(job: String, payload: String) -> Result<String, PluginError> {
        match job.as_str() {
            "racconta" => {
                // Due passi e non uno: un progresso con una **fine** dichiarata
                // (`total`) è ciò che chi disegna trasforma in una barra, e due
                // chiamate fanno vedere che si può chiamare quante volte si
                // vuole — il contratto lo dice per iscritto.
                host_events::report_progress(&JobProgress {
                    done: 1,
                    total: Some(3),
                    label: Some("il primo passo".to_string()),
                });
                host_events::report_progress(&JobProgress {
                    done: 3,
                    total: Some(3),
                    label: Some("l'ultimo passo".to_string()),
                });
                // Il topic sta nel namespace dell'id: `demo.eventi:detto`. Con
                // un nome altrui l'host non emette e lo racconta come guasto.
                host_events::emit(&Event::Custom(EventCustom {
                    topic: format!("{ID}:detto"),
                    payload: "{\"passi\":3}".to_string(),
                }));
                Ok("{\"detto\":true}".to_string())
            }
            "genera" => {
                // L'unica delle tre con un esito, e l'esito è un'**identità**:
                // il lavoro non è girato, è stato accettato. Restituirla è ciò
                // che permette a chi legge di riconoscere il `job-done` che
                // arriverà più tardi.
                let figlio = host_events::spawn_job(&JobSpec {
                    job: "figlio".to_string(),
                    payload: payload.clone(),
                })?;
                Ok(format!("{{\"figlio\":{figlio}}}"))
            }
            "figlio" => {
                host_events::emit(&Event::Custom(EventCustom {
                    topic: format!("{ID}:nato"),
                    payload: "{\"chi\":\"figlio\"}".to_string(),
                }));
                Ok("{\"chi\":\"figlio\"}".to_string())
            }
            "spazzatura" => {
                // Il `payload` di un `custom` è JSON dentro una stringa, e
                // niente al confine può impedire a un componente di scriverci
                // dentro qualunque cosa: il tipo WIT è `string`. Questa riga è
                // quella qualunque cosa, e l'host la deve **raccontare**.
                host_events::emit(&Event::Custom(EventCustom {
                    topic: format!("{ID}:rotto"),
                    payload: "non sono JSON".to_string(),
                }));
                Ok("{\"provato\":true}".to_string())
            }
            altro => Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(
                altro.to_string(),
            ))),
        }
    }
}

export!(Componente);
