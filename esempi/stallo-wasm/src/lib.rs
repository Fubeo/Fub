//! **Il componente che tiene l'istanza mentre chiede il turno.**
//!
//! Plugin e provider di formato di una stessa apertura condividono l'istanza
//! (un solo `Mutex`): è ciò che permette a un formato di vedere lo stato
//! costruito dall'attivazione. È anche ciò che chiude il ciclo che questo
//! componente esiste per mostrare:
//!
//! - il job `demo.stallo:scrivi` **tiene l'istanza** per tutta la chiamata e,
//!   quando il segnale arriva, chiede all'host di mettere in coda un altro job
//!   (`spawn-job`), cioè il turno di scrittura del vault: l'host WASM non serve
//!   `host-vault-write`, e le capacità che un guest ha per cambiare lo stato
//!   del vault sono `emit`, `spawn-job` e `report-progress`, che passano tutte
//!   dallo stesso turno;
//! - il salvataggio di una nota `.fubstallo` **tiene il turno** e chiama il
//!   parser, cioè chiede l'istanza.
//!
//! Il segnale è un documento che il test crea **fuori dal workspace**: leggerlo
//! non chiede nessun turno, quindi il job può aspettarlo restando dentro il
//! guest, e chi lo scrive decide il momento esatto in cui il job chiede il
//! turno. Nessun orologio: l'ordine dei due lati è fissato dal test.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi.

#[cfg(not(feature = "indice"))]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:stallo/stallo",
    generate_all,
});

// La variante dell'indice ha un mondo suo: vedi `wit/stallo.wit`.
#[cfg(feature = "indice")]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:stallo/stallo-indice",
    generate_all,
});

use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::events::{Event, EventCustom};
use fub::abi::jobs::JobSpec;
use fub::abi::options::OptionEntry;
use fub::abi::text::Text;
use fub::abi::{host_events, host_vault_read};

pub(crate) const ID: &str = "demo.stallo";

/// Quante letture del segnale al massimo, prima di rinunciare. Il tetto non è
/// una scadenza di prova: è ciò che impedisce a un test rotto di lasciare il
/// job a girare per sempre dentro l'istanza.
const GIRI: u32 = 20_000_000;

pub(crate) struct Componente;

pub(crate) fn literal(frase: &str) -> Text {
    Text::Literal(frase.to_string())
}

impl PluginGuest for Componente {
    fn manifest() -> PluginManifest {
        let permesso = |chiave: &str| OptionEntry {
            key: chiave.to_string(),
            value: "true".to_string(),
        };
        PluginManifest {
            id: ID.to_string(),
            name: "Stallo".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
            permissions: PluginPermissions {
                granted: vec![permesso("fub:read-vault")],
            },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    /// `demo.stallo:scrivi`, payload `{"segnale":"…"}`.
    ///
    /// Si annuncia, aspetta che il segnale esista (restando dentro l'istanza) e
    /// poi mette in coda `demo.stallo:vuoto`. L'esito di quella richiesta è
    /// l'esito del job: un conflitto dell'host torna com'è, perché il job
    /// **deve uscire** per restituire l'istanza. `demo.stallo:vuoto` non fa
    /// niente: esiste perché `spawn-job` ha un esito e quindi può dire di no.
    fn run_job(job: String, payload: String) -> Result<String, PluginError> {
        if job == format!("{ID}:vuoto") {
            return Ok("{}".to_string());
        }
        if job != format!("{ID}:scrivi") {
            return Err(PluginError::UnknownJob(literal(&job)));
        }
        let segnale = campo(&payload, "segnale")
            .ok_or_else(|| PluginError::BadArgs(literal("manca `segnale`")))?;

        host_events::emit(&Event::Custom(EventCustom {
            topic: format!("{ID}:dentro"),
            payload: "{}".to_string(),
        }));

        let mut arrivato = false;
        for _ in 0..GIRI {
            if host_vault_read::read_document(&segnale).is_ok() {
                arrivato = true;
                break;
            }
        }
        if !arrivato {
            return Err(PluginError::Internal(literal(
                "il segnale non è mai arrivato",
            )));
        }

        host_events::spawn_job(&JobSpec {
            job: format!("{ID}:vuoto"),
            payload: "{}".to_string(),
        })?;
        Ok("{\"accodato\":true}".to_string())
    }
}

/// Il valore di una chiave stringa in un JSON piatto. Basta per un payload che
/// il test scrive a mano: un parser JSON intero sarebbe più grosso del job.
fn campo(json: &str, chiave: &str) -> Option<String> {
    let cerca = format!("\"{chiave}\":\"");
    let inizio = json.find(&cerca)? + cerca.len();
    let fine = json[inizio..].find('"')? + inizio;
    Some(json[inizio..fine].to_string())
}

/// Il mondo `stallo`: formato, handler di eventi e comando.
#[cfg(not(feature = "indice"))]
mod mondo {
    use crate::exports::fub::abi::command::{
        CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec,
        Guest as CommandGuest, InvokeMode,
    };
    use crate::exports::fub::abi::event_handler::Guest as EventHandlerGuest;
    use crate::exports::fub::abi::format::{
        DocumentSource, FormatCapabilities, FormatDescriptor, FormatError, FormatErrorUnsupported,
        Guest as FormatGuest, ParseContext, RenderOptions, SourceKind,
    };
    use crate::fub::abi::errors::PluginError;
    use crate::fub::abi::events::{EventKind, EventMask, Notice};
    use crate::fub::abi::model::{
        Block, BlockParagraph, DocumentModel, DocumentTree, Inline, Span,
    };
    use crate::{literal, Componente, ID};

    impl FormatGuest for Componente {
        fn descriptor() -> FormatDescriptor {
            FormatDescriptor {
                id: ID.to_string(),
                name: "Stallo".to_string(),
                extensions: vec!["fubstallo".to_string()],
                source: SourceKind::Text,
            }
        }

        fn capabilities() -> FormatCapabilities {
            FormatCapabilities { syntax: vec![] }
        }

        fn parse(source: DocumentSource, ctx: ParseContext) -> Result<DocumentModel, FormatError> {
            let text = match source {
                DocumentSource::Text(text) => text,
                DocumentSource::Bytes(_) => {
                    return Err(FormatError::Unsupported(FormatErrorUnsupported {
                        format: ID.to_string(),
                        got: SourceKind::Bytes,
                    }))
                }
            };
            let span = Span {
                start: 0,
                end: text.len() as u64,
            };
            Ok(DocumentModel {
                id: ctx.doc_id,
                frontmatter: "{}".to_string(),
                body: DocumentTree {
                    blocks: vec![Block::Paragraph(BlockParagraph {
                        inlines: vec![0],
                        anchor: None,
                        span,
                    })],
                    inlines: vec![Inline::Text(text.clone())],
                    roots: vec![0],
                },
                outline: vec![],
                links: vec![],
                tags: vec![],
                anchors: vec![],
                text,
                frontmatter_present: false,
            })
        }

        fn render_html(_: DocumentModel, _: RenderOptions) -> Result<String, FormatError> {
            Err(FormatError::Render("lo stallo non disegna".to_string()))
        }

        fn serialize(model: DocumentModel) -> Result<String, FormatError> {
            Ok(model.text)
        }
    }

    impl EventHandlerGuest for Componente {
        fn subscribed() -> EventMask {
            EventMask {
                kinds: if cfg!(feature = "eventi") {
                    vec![EventKind::DocumentChanged]
                } else {
                    vec![]
                },
                topics: vec![],
                subjects: vec![],
                changes: vec![],
            }
        }

        /// È qui che un salvataggio chiede l'istanza per un evento.
        fn handle(_notice: Notice) -> Result<(), PluginError> {
            Ok(())
        }
    }

    impl CommandGuest for Componente {
        fn commands() -> Vec<CommandSpec> {
            if !cfg!(feature = "comando") {
                return vec![];
            }
            vec![CommandSpec {
                id: format!("{ID}:vuoto"),
                title: literal("Non fa niente"),
                description: literal(
                    "Esiste perché un gancio nativo prima della scrittura abbia un comando di \
                     questo componente da chiamare mentre il salvataggio tiene il turno.",
                ),
                keybinding: None,
                params: vec![],
                scope: CommandScope {
                    writes: false,
                    reach: CommandReach::Session,
                    reversible: false,
                },
                surfaces: vec![],
            }]
        }

        /// È qui che un gancio chiede l'istanza per un comando.
        fn invoke(
            command: String,
            _args: String,
            _mode: InvokeMode,
        ) -> Result<CommandOutcome, PluginError> {
            if command != format!("{ID}:vuoto") {
                return Err(PluginError::UnknownCommand(literal(&command)));
            }
            Ok(CommandOutcome {
                notify: None,
                effect: CommandEffect::Done,
                undo: None,
                partial: None,
            })
        }
    }
}

/// Il mondo `stallo-indice`: la porta dell'indice al posto del formato.
#[cfg(feature = "indice")]
mod indice {
    use crate::exports::fub::abi::index::{
        Guest as IndexGuest, IndexLoss, IndexQuery, IndexResult, QueryKind, QueryRoute, VaultEntry,
    };
    use crate::fub::abi::errors::PluginError;
    use crate::fub::abi::model::{DocId, DocumentModel};
    use crate::Componente;

    /// La rotta dell'indice, quando la feature `indice` lo accende.
    const ROTTA: &str = "demo.stallo:vuota";

    impl IndexGuest for Componente {
        fn routes() -> Vec<QueryRoute> {
            vec![QueryRoute::Query(QueryKind::Custom(ROTTA.to_string()))]
        }

        fn activate() -> Result<(), PluginError> {
            Ok(())
        }

        /// È qui che un salvataggio chiede l'istanza per l'indice.
        fn on_documents_indexed(_docs: Vec<DocumentModel>) -> Vec<IndexLoss> {
            vec![]
        }

        fn on_documents_removed(_ids: Vec<DocId>) -> Vec<IndexLoss> {
            vec![]
        }

        fn reconcile(_ids: Vec<DocId>) -> Vec<IndexLoss> {
            vec![]
        }

        fn flush() -> Result<(), PluginError> {
            Ok(())
        }

        fn close() -> Result<(), PluginError> {
            Ok(())
        }

        fn query(_query: IndexQuery) -> Result<IndexResult, PluginError> {
            Ok(IndexResult::Custom("{}".to_string()))
        }

        fn up_to_date(_entries: Vec<VaultEntry>) -> Vec<DocId> {
            vec![]
        }
    }
}

export!(Componente);
