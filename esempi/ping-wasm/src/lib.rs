//! **Il ping, dall'altra parte del confine.**
//!
//! È lo stesso plugin di `crates/fub-host/tests/il_primo_plugin.rs` — stesso
//! id, stesso permesso, stesso job, stessa risposta — con una differenza sola:
//! quello è una `struct` Rust che il kernel chiama direttamente, questo è un
//! `.wasm` che il kernel chiama attraverso wasmtime. Se i due rispondono la
//! stessa cosa, «un trait, due backend» non è una frase del piano.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi.

#[cfg(not(feature = "con-rete"))]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:ping/ping",
    generate_all,
});

// Lo stesso componente, con un mondo che chiede anche la rete. Vedi
// `wit/ping.wit`: serve a far pronunciare il rifiuto dell'host, non a fare
// qualcosa.
#[cfg(feature = "con-rete")]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:ping/ping-con-rete",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::options::OptionEntry;

/// L'id del plugin: lo stesso del nativo. Il namespace del §7.4 è suo, e il
/// job che risponde si chiama `ping` come là.
const ID: &str = "demo.ping";

/// La versione del contratto contro cui è scritto. La confronta
/// `fub_abi::traits::abi_compatible` al primo passo del montaggio: major
/// diversa → rifiuto, minor più alta dell'host → rifiuto.
const ABI: &str = "0.1.1";

/// Quando ci siamo attivati, in millisecondi. Il diario del plugin nativo era
/// un `Arc<Mutex<Vec<String>>>` condiviso col test; qui il test non può
/// condividere niente — sta di là dal confine — e allora l'attivazione lascia
/// una traccia che il job può **restituire**, cioè l'unica forma di prova che
/// attraversa.
static mut ACCESO: u64 = 0;

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Demo Ping (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: ABI.to_string(),
            permissions: PluginPermissions {
                // `option-map` è una lista di coppie e il valore è JSON: un
                // permesso senza parametro è la voce accesa, cioè `true`.
                // Con la feature `senza-permessi` la lista è vuota, ed è
                // l'unica differenza fra i due `.wasm` che il test monta.
                granted: if cfg!(feature = "senza-permessi") {
                    vec![]
                } else {
                    vec![OptionEntry {
                        key: "fub:read-vault".to_string(),
                        value: "true".to_string(),
                    }]
                },
            },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        // L'orologio è una capacità SENZA permesso (§7.3), ed è la stessa riga
        // che il plugin nativo scrive nel proprio diario. Sta qui e non nel job
        // per la stessa ragione di là: un `activate` che leggesse il vault
        // fallirebbe **prima** del cancello che la seconda prova vuole vedere
        // chiudersi.
        let adesso = fub::abi::host_env::now_unix_millis();
        unsafe {
            ACCESO = adesso;
        }
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    /// Il ramo che tiene viva l'import della rete: senza una chiamata vera
    /// l'ottimizzatore la toglierebbe dal componente, e il componente non
    /// chiederebbe più la famiglia che il test vuole vedere rifiutata. Non gira
    /// mai — il job non esiste dall'altra parte — ma nessuno lo sa a compile
    /// time, ed è appunto il punto.
    #[cfg(feature = "con-rete")]
    fn run_job(job: String, payload: String) -> Result<String, PluginError> {
        if job == "scarica" {
            let risposta = fub::abi::host_network::fetch(&fub::abi::net::HttpRequest {
                url: payload,
                method: fub::abi::net::HttpMethod::Get,
                headers: vec![],
                body: None,
            })?;
            return Ok(format!("{{\"status\":{}}}", risposta.status));
        }
        Self::ping(job)
    }

    #[cfg(not(feature = "con-rete"))]
    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Self::ping(job)
    }
}

impl Componente {
    /// Il corpo del ping, uguale nei due mondi.
    fn ping(job: String) -> Result<String, PluginError> {
        match job.as_str() {
            "ping" => {
                let testo = fub::abi::host_vault_read::read_document("Nota.md")?;
                let caratteri = testo.chars().count();
                let acceso = unsafe { ACCESO };
                // JSON scritto a mano: `serde_json` sarebbe una dipendenza in
                // più in un componente che deve restare piccolo, e i tre valori
                // qui dentro non hanno niente da sfuggire — un nome di file
                // costante e due numeri.
                Ok(format!(
                    "{{\"nota\":\"Nota.md\",\"caratteri\":{caratteri},\"acceso\":{acceso}}}"
                ))
            }
            altro => Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(
                altro.to_string(),
            ))),
        }
    }
}

export!(Componente);
