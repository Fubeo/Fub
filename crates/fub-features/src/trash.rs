//! Il **cestino** come `ViewProvider` — e la prova che una view sa fare anche
//! ciò che finora aveva fatto solo un pannello cablato.
//!
//! Il §1.2 chiedeva di migrare cestino e cronologia al protocollo dichiarativo
//! come dogfooding, e il cestino è il primo dei due perché non gli manca niente:
//! l'elenco è una capacità di lettura del contratto
//! ([`VaultRead::list_trash`](fub_abi::traits::VaultRead::list_trash)), e le due
//! azioni che compie — ripristinare e svuotare — sono **comandi del registro**
//! che esistono da prima (`trash.restore`, `trash.empty`, in
//! [`crate::commands`]). Questa view non ha una capacità sua: chiede quello che
//! chiederebbe un plugin di terzi.
//!
//! # Una view non chiede con una finestra: chiede con l'albero che sta disegnando
//!
//! È la cosa che la migrazione ha trovato, e non era prevista. Il pannello
//! nativo aveva due domande da fare — *«svuoto davvero?»* e *«il path è di nuovo
//! occupato: la ripristino con un altro nome?»* — e le faceva con la modale
//! della shell, che è una capacità che un provider **non ha** e che non gli
//! serve avere: `ViewUpdate` non ha un `Confirm`, e aggiungerlo avrebbe messo
//! nel contratto un secondo modo di disegnare (una finestra descritta a parole,
//! fuori dall'albero) accanto a quello che c'è già.
//!
//! La domanda si disegna: [`ViewUpdate::Replace`] con un albero in cui, al posto
//! dell'elenco, c'è la domanda e i suoi due bottoni. Ciò che la rende possibile
//! è lo **stato di vista** (§11.2): la domanda in corso sta sotto la chiave
//! [`ASK`], che è per esemplare e non per provider — due cestini aperti non si
//! rubano la conferma a vicenda — e sparisce appena si risponde. La risposta
//! costa un giro in più di `on_action`, che è esattamente quello che costerebbe
//! una modale.
//!
//! Ne segue una proprietà che la modale non aveva: la domanda **è nel pannello**,
//! cioè accanto alle cose di cui parla, e chi la lascia lì aperta non blocca il
//! resto dell'app.
//!
//! # Il nome libero lo propone chi ripristina
//!
//! `trash.restore` senza `to` fallisce con
//! [`PluginError::AlreadyExists`](fub_abi::error::PluginError::AlreadyExists) se
//! il path d'origine è di nuovo occupato — «il kernel non inventa nomi al posto
//! dell'utente» (decisione 0058) — e questa view fa quel che faceva la shell:
//! chiede a [`VaultRead::free_name`](fub_abi::traits::VaultRead::free_name) un
//! nome che si può usare e lo mette **in un campo modificabile**, che è la
//! differenza fra proporre e decidere. La convenzione dei nomi resta una sola,
//! ed è del kernel.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::DocId;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    HostApi, ReadApi, TrashEntry, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};

/// I due comandi del registro che questa view invoca.
///
/// Sono **stringhe scritte qui** e non le costanti di [`crate::commands`], e la
/// prima stesura le importava: il presidio `i_moduli_non_si_parlano` l'ha
/// fermata dicendo che si stava sbloccando la §16.3, e aveva ragione a fermarla
/// — ma la riparazione non è lo split, è che quell'import era **la forma
/// sbagliata di dogfooding**. L'id di un comando è un nome del *registro*, cioè
/// del contratto: è ciò che scriverebbe un plugin di terzi, che non ha i nostri
/// `const` fra le mani e non li avrà mai. Importarlo dava a questa view una
/// dipendenza di compilazione che il suo modello — «chiedo quello che
/// chiederebbe un plugin» — non può avere.
///
/// Che le due stringhe restino i due comandi che esistono non è affidato a
/// questa prosa: `tests/trash_view_e2e.rs` le cerca fra le `CommandSpec`
/// registrate, ed è rosso se un id cambia. È lo stesso scambio del §16.6 — un
/// accoppiamento che diventa un presidio invece di un import.
const TRASH_RESTORE: &str = "trash.restore";
const TRASH_EMPTY: &str = "trash.empty";

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const TRASH_ID: &str = "fub.trash";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const TRASH_VIEW: &str = "trash";

/// Ripristina una voce: l'id della voce e il suo path d'origine stanno nel
/// payload, che è il proprietario giusto (§2.7).
const RESTORE: &str = "restore";
/// Ripristina con il nome che sta nel campo [`NAME_FIELD`]: è la risposta alla
/// domanda che nasce da un path di nuovo occupato.
const RESTORE_AS: &str = "restore_as";
/// Chiedi conferma prima di svuotare, e — al secondo giro — svuota.
const EMPTY: &str = "empty";
const EMPTY_CONFIRM: &str = "empty_confirm";
/// Rinuncia alla domanda in corso: la chiave [`ASK`] torna a non esserci.
const CANCEL: &str = "cancel";

/// Le chiavi del payload.
const ENTRY: &str = "entry";
const ORIGINAL: &str = "original";

/// Il campo in cui si legge (e si corregge) il nome proposto.
const NAME_FIELD: &str = "name";

/// La chiave sotto cui la **domanda in corso** sta nello stato di vista.
///
/// Sta lì e non in un campo di questa struct per la ragione del pannello tag: un
/// campo sarebbe uno per provider, cioè condiviso da tutti gli esemplari del
/// pannello, e due cestini aperti si passerebbero la conferma di svuotamento —
/// che è il modo peggiore di distruggere qualcosa.
const ASK: &str = "ask";
/// Le due forme che la domanda può avere, come stanno scritte nello stato.
const ASK_EMPTY: &str = "empty";
const ASK_RESTORE: &str = "restore";

const VIEW_TITLE: &str = "view_title";
const IS_EMPTY: &str = "is_empty";
const RESTORE_LABEL: &str = "restore";
const EMPTY_LABEL: &str = "empty";
const CANCEL_LABEL: &str = "cancel";
const DELETED_AT: &str = "deleted_at";
const CONFIRM_EMPTY: &str = "confirm_empty";
const EXISTS_AGAIN: &str = "exists_again";
const RESTORE_FAILED: &str = "restore_failed";
const EMPTY_FAILED: &str = "empty_failed";

/// Le stringhe del cestino. Vedi [`backlinks::catalog`](crate::backlinks::catalog)
/// per il perché stiano nel componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Cestino")
            .with(IS_EMPTY, "Il cestino è vuoto.")
            .with(RESTORE_LABEL, "Ripristina")
            .with(EMPTY_LABEL, "Svuota il cestino")
            .with(CANCEL_LABEL, "Annulla")
            .with(DELETED_AT, "Cestinata il {when}")
            .with(
                CONFIRM_EMPTY,
                "Distruggo definitivamente {count} voci del cestino? Non si torna indietro.",
            )
            .with(
                EXISTS_AGAIN,
                "«{doc}» esiste di nuovo. Con che nome la ripristino?",
            )
            .with(RESTORE_FAILED, "Non ho ripristinato «{doc}»: {reason}")
            .with(EMPTY_FAILED, "Non ho svuotato il cestino: {reason}"),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Trash")
            .with(IS_EMPTY, "The trash is empty.")
            .with(RESTORE_LABEL, "Restore")
            .with(EMPTY_LABEL, "Empty the trash")
            .with(CANCEL_LABEL, "Cancel")
            .with(DELETED_AT, "Trashed on {when}")
            .with(
                CONFIRM_EMPTY,
                "Permanently destroy {count} trash entries? There is no way back.",
            )
            .with(
                EXISTS_AGAIN,
                "«{doc}» exists again. What name should it take?",
            )
            .with(RESTORE_FAILED, "Could not restore «{doc}»: {reason}")
            .with(EMPTY_FAILED, "Could not empty the trash: {reason}"),
    ]
}

/// Il pannello cestino.
///
/// **Senza campi**, come il pannello tag e per la stessa ragione: ciò che deve
/// sopravvivere fra due `render_view` — la domanda in corso — sta nello stato di
/// vista dell'esemplare.
pub struct TrashView;

impl ViewProvider for TrashView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Il cestino può riempirsi o svuotarsi da un'altra finestra, o da
            // Obsidian che condivide `.trash/`: invecchia con l'indice.
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // Quali note ci sono dentro non dipende da quale nota si guarda.
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Chiuso di suo: il cestino è un posto in cui si va, non uno che si
            // guarda mentre si scrive. Era la stessa cosa che diceva la shell
            // tenendolo dietro un pulsante, detta dove la può leggere anche chi
            // non è questa shell.
            ViewSpec::new(TRASH_VIEW, Text::key(VIEW_TITLE), ViewSurface::LeftSidebar)
                .with_icon("trash")
                .ordered(3),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // Ripristina, e se il path è tornato occupato **chiedi** invece di
            // decidere: la domanda diventa un pezzo dell'albero.
            RESTORE => {
                let (entry, original) = match two_ids(&action.payload) {
                    Some(two) => two,
                    None => return Ok(ViewUpdate::None),
                };
                match host.run_command(TRASH_RESTORE, serde_json::json!({ ENTRY: entry })) {
                    Ok(_) => Ok(ViewUpdate::Navigate { doc_id: original }),
                    Err(PluginError::AlreadyExists(_)) => {
                        let proposed_name = host.free_name(&DocId::new(&original));
                        host.set_view_state(
                            ASK,
                            Some(serde_json::json!({
                                "kind": ASK_RESTORE,
                                ENTRY: entry,
                                ORIGINAL: original,
                                NAME_FIELD: proposed_name.0,
                            })),
                        )?;
                        Ok(ViewUpdate::Replace {
                            root: tree(host, None)?,
                        })
                    }
                    // Ogni altro guasto è **un altro guasto**, e dirlo con la
                    // domanda sbagliata è il difetto che il §12.2 aveva già
                    // trovato in questo stesso punto quando stava nella shell:
                    // con un disco pieno si vedeva «esiste già».
                    Err(and) => Ok(ViewUpdate::Replace {
                        root: tree(
                            host,
                            Some(Text::message(
                                RESTORE_FAILED,
                                vec![
                                    Arg::text("doc", display_name(&DocId::new(&original))),
                                    Arg::text("reason", and.to_string()),
                                ],
                            )),
                        )?,
                    }),
                }
            }
            // La risposta alla domanda: il nome sta nel campo, che l'utente può
            // aver corretto. Vuoto = il nome proposto non c'è più, e non si
            // ripristina niente a caso.
            RESTORE_AS => {
                let ask = host.view_state(ASK)?;
                let entry = ask
                    .as_ref()
                    .and_then(|a| a.get(ENTRY))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let new = action
                    .text_field(NAME_FIELD)
                    .unwrap_or_default()
                    .to_string();
                host.set_view_state(ASK, None)?;
                let (Some(entry), false) = (entry, new.is_empty()) else {
                    return Ok(ViewUpdate::Replace {
                        root: tree(host, None)?,
                    });
                };
                match host.run_command(
                    TRASH_RESTORE,
                    serde_json::json!({ ENTRY: entry, "to": new }),
                ) {
                    Ok(_) => Ok(ViewUpdate::Navigate { doc_id: new }),
                    Err(and) => Ok(ViewUpdate::Replace {
                        root: tree(
                            host,
                            Some(Text::message(
                                RESTORE_FAILED,
                                vec![
                                    Arg::text("doc", display_name(&DocId::new(&new))),
                                    Arg::text("reason", and.to_string()),
                                ],
                            )),
                        )?,
                    }),
                }
            }
            // Svuotare è l'unica cosa da cui non si torna indietro (lo dice la
            // `CommandScope` di `trash.empty`, che è `irreversible`): si chiede,
            // e la domanda porta il conto di ciò che sta per sparire.
            EMPTY => {
                let count = host.list_trash()?.len();
                if count == 0 {
                    return Ok(ViewUpdate::None);
                }
                host.set_view_state(ASK, Some(serde_json::json!({ "kind": ASK_EMPTY })))?;
                Ok(ViewUpdate::Replace {
                    root: tree(host, None)?,
                })
            }
            EMPTY_CONFIRM => {
                host.set_view_state(ASK, None)?;
                let outcome = host.run_command(TRASH_EMPTY, serde_json::Value::Null);
                let warning = outcome.err().map(|and| {
                    Text::message(EMPTY_FAILED, vec![Arg::text("reason", and.to_string())])
                });
                Ok(ViewUpdate::Replace {
                    root: tree(host, warning)?,
                })
            }
            CANCEL => {
                host.set_view_state(ASK, None)?;
                Ok(ViewUpdate::Replace {
                    root: tree(host, None)?,
                })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// I due id di un ripristino, dal payload del nodo che li portava.
fn two_ids(payload: &serde_json::Value) -> Option<(String, String)> {
    let entry = payload.get(ENTRY)?.as_str()?.to_string();
    let original = payload.get(ORIGINAL)?.as_str()?.to_string();
    Some((entry, original))
}

/// Il nome leggibile di un documento: l'ultimo segmento, senza estensione.
///
/// Il path intero è nel `title` di ciò che si passa il mouse sopra; qui serve
/// ciò che l'utente ha scritto in cima alla nota.
fn display_name(id: &DocId) -> String {
    let file = id.0.rsplit('/').next().unwrap_or(&id.0);
    file.strip_suffix(".md").unwrap_or(file).to_string()
}

/// L'albero del pannello: la domanda in corso se ce n'è una, l'elenco sempre.
///
/// `warning` è ciò che è appena andato storto, e non sta nello stato di vista: un
/// guasto non deve sopravvivere alla chiusura del vault né tornare a galla alla
/// riapertura, perché nel frattempo può essere stato riparato. Vive quanto
/// l'albero che lo mostra, che è quanto deve.
fn tree(host: &dyn ReadApi, warning: Option<Text>) -> Result<UiNode, PluginError> {
    let entries = host.list_trash()?;
    let mut children = Vec::new();

    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }
    if let Some(question) = question(host, &entries)? {
        children.push(question);
    }

    if entries.is_empty() {
        children.push(UiNode::empty_state(Text::key(IS_EMPTY)));
        return Ok(UiNode::column(1, children));
    }

    children.push(UiNode::list(entries.iter().map(row).collect::<Vec<_>>()));
    children.push(UiNode::button(
        Text::key(EMPTY_LABEL),
        Intent::Danger,
        ActionRef::new(EMPTY),
    ));
    Ok(UiNode::column(1, children))
}

/// Una voce del cestino: cosa era, quando è finita lì, e come tornare indietro.
///
/// La chiave è l'id nel cestino — che è unico e non cambia — perché una lista
/// che si riordina quando qualcuno cestina un'altra nota non deve spostare il
/// fuoco da sotto le dita di chi stava per premere «Ripristina» (§2.8).
fn row(entry: &TrashEntry) -> UiNode {
    UiNode::keyed(
        entry.id.0.clone(),
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Row,
            gap: 1,
            children: vec![
                UiNode::list_item(
                    Text::from(display_name(&entry.original)),
                    Some(Text::message(
                        DELETED_AT,
                        // I secondi del cestino diventano i millisecondi
                        // dell'argomento: la conversione sta qui e non nel
                        // catalogo, perché è chi ha il dato a sapere in che
                        // unità ce l'ha.
                        vec![Arg::timestamp("when", entry.deleted_at * 1000)],
                    )),
                    None,
                ),
                UiNode::button(
                    Text::key(RESTORE_LABEL),
                    Intent::Primary,
                    ActionRef::with(
                        RESTORE,
                        serde_json::json!({
                            ENTRY: entry.id.0,
                            ORIGINAL: entry.original.0,
                        }),
                    ),
                ),
            ],
        },
    )
}

/// La domanda in corso, disegnata — o niente, che è il caso normale.
fn question(host: &dyn ReadApi, entries: &[TrashEntry]) -> Result<Option<UiNode>, PluginError> {
    let Some(ask) = host.view_state(ASK)? else {
        return Ok(None);
    };
    let kind = ask.get("kind").and_then(|v| v.as_str()).unwrap_or_default();
    let node = match kind {
        ASK_EMPTY => UiNode::column(
            1,
            vec![
                UiNode::text(Text::message(
                    CONFIRM_EMPTY,
                    vec![Arg::int("count", entries.len() as i64)],
                )),
                UiNode::button(
                    Text::key(EMPTY_LABEL),
                    Intent::Danger,
                    ActionRef::new(EMPTY_CONFIRM),
                ),
                UiNode::button(
                    Text::key(CANCEL_LABEL),
                    Intent::Neutral,
                    ActionRef::new(CANCEL),
                ),
            ],
        ),
        ASK_RESTORE => {
            let original = ask
                .get(ORIGINAL)
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let proposed_name = ask
                .get(NAME_FIELD)
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            UiNode::column(
                1,
                vec![
                    UiNode::text(Text::message(
                        EXISTS_AGAIN,
                        vec![Arg::text("doc", display_name(&DocId::new(original)))],
                    )),
                    // Un `Form` e non un campo con un bottone accanto: inviare
                    // manda **tutti** i campi contenuti, ed è ciò che rende
                    // l'invio da tastiera la stessa cosa del click.
                    UiNode::new(UiKind::Form {
                        children: vec![UiNode::new(UiKind::TextInput {
                            field: NAME_FIELD.to_string(),
                            label: None,
                            value: proposed_name.to_string(),
                            placeholder: None,
                            action: None,
                        })],
                        submit_label: Text::key(RESTORE_LABEL),
                        submit: ActionRef::new(RESTORE_AS),
                    }),
                    UiNode::button(
                        Text::key(CANCEL_LABEL),
                        Intent::Neutral,
                        ActionRef::new(CANCEL),
                    ),
                ],
            )
        }
        // Una chiave che questo pannello non sa più leggere — perché la forma
        // della domanda è cambiata sotto uno stato salvato — non è un errore:
        // è una domanda che non si fa più.
        _ => return Ok(None),
    };
    Ok(Some(node.with_key("ask")))
}
