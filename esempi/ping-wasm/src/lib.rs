//! **Il ping, dall'altra parte del confine.**
//!
//! È lo stesso plugin di `crates/fub-host/tests/il_primo_plugin.rs` — stesso
//! id, stesso permesso, stesso job, stessa risposta — con una differenza sola:
//! quello è una `struct` Rust che il kernel chiama direttamente, questo è un
//! `.wasm` che il kernel chiama attraverso wasmtime. Se i due rispondono la
//! stessa cosa, «un trait, due backend» non è una frase del piano.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi.
//!
//! # Le due interfacce
//!
//! Esporta `fub:abi/plugin` e `fub:abi/command`, e la seconda non è un
//! accessorio: è il punto in cui il componente smette di essere una cosa che
//! l'host chiama quando gli pare e diventa una cosa che **la palette, la
//! tastiera, una macro e la CLI** chiamano senza sapere cos'è. I due comandi
//! qui sotto sono scelti per far attraversare le due metà del contratto dei
//! comandi: uno che lavora davvero, e uno che restituisce l'esito nella sua
//! forma più profonda.

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

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------
//
// Solo nel mondo `ping`: `ping-con-rete` esiste per farsi rifiutare al
// caricamento, e non arriva mai a un comando.

/// La nota su cui lavorano i due comandi. La stessa del job: un esempio con un
/// documento solo è un esempio in cui si vede cosa attraversa.
#[cfg(not(feature = "con-rete"))]
const NOTA: &str = "Nota.md";

#[cfg(not(feature = "con-rete"))]
mod comandi {
    use super::{Componente, NOTA};
    use crate::exports::fub::abi::command::{
        Choice, CommandEffect, CommandEffectReveal, CommandOutcome, CommandPlan, CommandReach,
        CommandScope, CommandSpec, Failure, Guest, InvokeMode, ParamKind, ParamSpec, Partial,
        PlannedEdit, Undo, UndoStep, UndoStepCommand,
    };
    use crate::fub::abi::edit::{EditRequest, TextEdit};
    use crate::fub::abi::errors::PluginError;
    use crate::fub::abi::model::Span;
    use crate::fub::abi::text::Text;

    /// Un letterale, che è l'unica specie di testo che un esempio può
    /// permettersi: un `message` vuole un catalogo di stringhe, e questo
    /// componente non ne dichiara.
    fn t(s: &str) -> Text {
        Text::Literal(s.to_string())
    }

    /// Il numero scritto sotto `chiave` in un oggetto JSON piatto.
    ///
    /// Scritto a mano per la stessa ragione per cui il ping scrive il proprio
    /// JSON a mano: `serde_json` in un componente che deve restare piccolo è
    /// una dipendenza che non paga. E può cavarsela con così poco perché **gli
    /// argomenti arrivano già convalidati** contro la `param-spec` — è il
    /// contratto di `invoke`, e qui si vede cosa vale: un comando non si difende
    /// da un chiamante distratto, perché non ne incontra.
    fn numero(args: &str, chiave: &str) -> Option<u32> {
        let dopo = args.split_once(&format!("\"{chiave}\":"))?.1;
        let cifre: String = dopo
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        cifre.parse().ok()
    }

    impl Guest for Componente {
        fn commands() -> Vec<CommandSpec> {
            vec![
                CommandSpec {
                    // Dentro il namespace del plugin (§7.4): il separatore è
                    // `:`, e ciò che sta prima è l'id del manifest. Il kernel
                    // rifiuta un id che esca dal proprio — e anche uno che non
                    // ne dichiari nessuno — prima di registrare: `demo.ping.conta`
                    // non è «conta di demo.ping», è un nome nudo.
                    id: "demo.ping:conta".to_string(),
                    title: t("Conta i caratteri della nota"),
                    description: t("Legge Nota.md attraverso il confine e dice quanto è lunga."),
                    keybinding: None,
                    params: vec![],
                    scope: CommandScope {
                        writes: false,
                        reach: CommandReach::Document,
                        reversible: false,
                    },
                },
                CommandSpec {
                    id: "demo.ping:esito-ricco".to_string(),
                    title: t("Restituisci un esito completo"),
                    description: t(
                        "Non fa niente al vault: fabbrica un esito con piano, annullamento e \
                         parziale, perché la forma più profonda del contratto abbia un componente \
                         che la pronuncia.",
                    ),
                    keybinding: None,
                    params: vec![
                        ParamSpec {
                            name: "quante".to_string(),
                            title: t("Quante cose"),
                            description: t("Il numero che finisce in `partial.attempted`."),
                            kind: ParamKind::Number,
                            required: true,
                        },
                        // L'unica specie di argomento che porta un carico, cioè
                        // l'unica che una traduzione può perdere per strada
                        // lasciando un `param-kind` che sembra a posto. Il
                        // comando non lo legge: sta qui perché **attraversi**.
                        ParamSpec {
                            name: "stile".to_string(),
                            title: t("Stile"),
                            description: t("Non cambia niente: serve a far viaggiare le scelte."),
                            kind: ParamKind::Choice(vec![
                                Choice {
                                    value: "corto".to_string(),
                                    title: t("Corto"),
                                },
                                Choice {
                                    value: "lungo".to_string(),
                                    title: t("Lungo"),
                                },
                            ]),
                            required: false,
                        },
                    ],
                    scope: CommandScope {
                        writes: false,
                        reach: CommandReach::Documents,
                        reversible: true,
                    },
                },
            ]
        }

        fn invoke(
            command: String,
            args: String,
            mode: InvokeMode,
        ) -> Result<CommandOutcome, PluginError> {
            match command.as_str() {
                "demo.ping:conta" => conta(),
                "demo.ping:esito-ricco" => esito_ricco(&args, mode),
                // Il kernel non ci arriva mai — sceglie il proprietario
                // dall'elenco che questo stesso componente ha dichiarato — ma la
                // risposta esiste lo stesso: un `match` senza ultimo ramo è un
                // panico che aspetta il primo chiamante che non sia il kernel.
                altro => Err(PluginError::UnknownCommand(t(altro))),
            }
        }
    }

    /// Legge la nota e dice dov'è. Prova che dentro `invoke` l'host prestato è
    /// vivo: è la **seconda** porta sulla stessa istanza, e se il prestito
    /// valesse solo per la prima questa lettura risponderebbe `internal`.
    fn conta() -> Result<CommandOutcome, PluginError> {
        let testo = crate::fub::abi::host_vault_read::read_document(NOTA)?;
        let caratteri = testo.chars().count();
        Ok(CommandOutcome {
            notify: Some(t(&format!("{caratteri} caratteri"))),
            // Uno `span` in byte, che è ciò che il contratto dichiara. È anche
            // il primo numero che viaggia dal componente all'host in una misura
            // che l'host deve **stringere** a `usize`: vedi `da_span`.
            effect: CommandEffect::Reveal(CommandEffectReveal {
                doc: NOTA.to_string(),
                span: Span {
                    start: 0,
                    end: testo.len() as u64,
                },
            }),
            undo: None,
            partial: None,
        })
    }

    /// L'esito nella sua forma più profonda, senza toccare niente.
    ///
    /// Non finge di aver fatto un lavoro: il suo titolo dice cos'è, ed è un
    /// **banco di prova** del contratto — la sola cosa che questo componente
    /// pretende sia vera è che ciò che scrive qui arrivi identico dall'altra
    /// parte. Un piano con un edit vero, un annullamento con un passo, un
    /// parziale con un guasto che nomina il suo documento: sono i tre rami che
    /// una traduzione a metà lascerebbe cadere in silenzio.
    fn esito_ricco(args: &str, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
        let quante = numero(args, "quante").unwrap_or(0);
        // La revisione vera del documento, chiesta all'host: un edit senza base
        // è la corsa che quella firma esiste per rendere visibile, e un esempio
        // che scrivesse una base inventata insegnerebbe a scriverla inventata.
        let base = crate::fub::abi::host_vault_read::document_revision(NOTA)?;
        Ok(CommandOutcome {
            // Il modo torna indietro come parola: è l'unica cosa dei comandi che
            // viaggia dall'host al componente, e senza un'eco nessuno saprebbe
            // se è arrivata.
            notify: Some(t(match mode {
                InvokeMode::Apply => "apply",
                InvokeMode::DryRun => "dry-run",
            })),
            effect: CommandEffect::Plan(CommandPlan {
                summary: t(&format!("{quante} cose, nessuna toccata")),
                docs: vec![NOTA.to_string()],
                edits: vec![PlannedEdit {
                    doc: NOTA.to_string(),
                    edit: EditRequest {
                        base,
                        edits: vec![TextEdit {
                            span: Span { start: 0, end: 0 },
                            text: "<!-- proposta -->\n".to_string(),
                        }],
                    },
                }],
            }),
            undo: Some(Undo {
                label: t("Il banco di prova"),
                steps: vec![UndoStep::Command(UndoStepCommand {
                    command: "demo.ping:conta".to_string(),
                    args: "{}".to_string(),
                })],
            }),
            partial: Some(Partial {
                attempted: quante,
                done: quante.saturating_sub(1),
                failures: vec![Failure {
                    subject: Some(NOTA.to_string()),
                    error: PluginError::Conflict(t("l'ultima non è andata")),
                }],
            }),
        })
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
