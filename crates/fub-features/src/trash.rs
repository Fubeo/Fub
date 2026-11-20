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
//! del bottone che l'ha aperta, c'è la domanda e i suoi bottoni, dentro un nodo
//! [`UiNode::confirmation`] che le dà Esc e il fuoco. La domanda in corso sta in
//! [`TrashView`], **per esemplare** — due cestini aperti non si rubano la
//! conferma a vicenda — e sparisce appena si risponde, o col processo: non sta
//! nello stato di vista, che sopravvive al riavvio (IMP-110). La risposta costa
//! un giro in più di `on_action`, che è esattamente quello che costerebbe una
//! modale.
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

use std::collections::HashMap;

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
/// Rinuncia alla domanda in corso, dal bottone o da Esc.
const CANCEL: &str = "cancel";

/// Le chiavi del payload.
const ENTRY: &str = "entry";
const ORIGINAL: &str = "original";

/// Il campo in cui si legge (e si corregge) il nome proposto.
const NAME_FIELD: &str = "name";

/// La chiave sotto cui le versioni di prima ricordavano la domanda in corso
/// nello stato di vista. Non si scrive più (vedi [`TrashView`]): si legge solo
/// per toglierla, perché una domanda «Svuoto davvero?» rimasta lì da un avvio
/// di prima è a un clic dalla distruzione del cestino (IMP-110).
const LEGACY_ASK: &str = "ask";

/// La chiave del bottone «Svuota il cestino», che la sua domanda eredita:
/// chiusa la domanda, il fuoco torna al bottone.
const EMPTY_KEY: &str = "trash-empty";

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
/// # La domanda vive in memoria, e muore col processo
///
/// La domanda in corso deve sopravvivere fra due `render_view`, e per esemplare:
/// due cestini aperti non devono passarsi la conferma di svuotamento, che è il
/// modo peggiore di distruggere qualcosa. Per questo è una mappa per esemplare
/// e non un campo solo. Non sta nello stato di vista, che dura fra un avvio e
/// l'altro: ritrovare al riavvio «Distruggo definitivamente…?» con il sì pronto
/// sotto il dito vuol dire un clic da una distruzione che nessuno ricorda di
/// aver chiesto (IMP-110). Si chiude con una risposta o con la fine del
/// processo.
#[derive(Default)]
pub struct TrashView {
    /// esemplare → la domanda in corso.
    asking: HashMap<String, Ask>,
}

/// La domanda in corso in un esemplare del cestino.
enum Ask {
    /// «Svuoto davvero?»
    Empty,
    /// «Il path è di nuovo occupato: con che nome?», con il nome proposto.
    Restore {
        entry: String,
        original: String,
        name: String,
    },
}

impl TrashView {
    /// Ridisegna con la domanda di questo esemplare, se ce n'è una.
    fn redraw(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
        warning: Option<Text>,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::Replace {
            root: tree(host, warning, self.asking.get(&instance.instance))?,
        })
    }
}

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
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None, self.asking.get(&instance.instance))
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // La domanda che le versioni di prima avevano lasciato nello stato di
        // vista: al primo gesto sul pannello se ne va dal disco. Disegnata non
        // lo è più comunque, perché `tree` non la legge.
        if host.view_state(LEGACY_ASK)?.is_some() {
            host.set_view_state(LEGACY_ASK, None)?;
        }
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
                        self.asking.insert(
                            instance.instance.clone(),
                            Ask::Restore {
                                entry,
                                original,
                                name: proposed_name.0,
                            },
                        );
                        self.redraw(instance, host, None)
                    }
                    // Ogni altro guasto è **un altro guasto**, e dirlo con la
                    // domanda sbagliata è il difetto che il §12.2 aveva già
                    // trovato in questo stesso punto quando stava nella shell:
                    // con un disco pieno si vedeva «esiste già».
                    Err(and) => self.redraw(
                        instance,
                        host,
                        Some(Text::message(
                            RESTORE_FAILED,
                            vec![
                                Arg::text("doc", display_name(&DocId::new(&original))),
                                Arg::text("reason", and.to_string()),
                            ],
                        )),
                    ),
                }
            }
            // La risposta alla domanda: il nome sta nel campo, che l'utente può
            // aver corretto. Vuoto = il nome proposto non c'è più, e non si
            // ripristina niente a caso.
            RESTORE_AS => {
                let entry = match self.asking.remove(&instance.instance) {
                    Some(Ask::Restore { entry, .. }) => Some(entry),
                    _ => None,
                };
                let new = action
                    .text_field(NAME_FIELD)
                    .unwrap_or_default()
                    .to_string();
                let (Some(entry), false) = (entry, new.is_empty()) else {
                    return self.redraw(instance, host, None);
                };
                match host.run_command(
                    TRASH_RESTORE,
                    serde_json::json!({ ENTRY: entry, "to": new }),
                ) {
                    Ok(_) => Ok(ViewUpdate::Navigate { doc_id: new }),
                    Err(and) => self.redraw(
                        instance,
                        host,
                        Some(Text::message(
                            RESTORE_FAILED,
                            vec![
                                Arg::text("doc", display_name(&DocId::new(&new))),
                                Arg::text("reason", and.to_string()),
                            ],
                        )),
                    ),
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
                self.asking.insert(instance.instance.clone(), Ask::Empty);
                self.redraw(instance, host, None)
            }
            // Il sì vale solo per la domanda in corso in questo esemplare: un
            // `empty_confirm` arrivato senza — da un albero vecchio, da un
            // altro esemplare — non svuota niente.
            EMPTY_CONFIRM => {
                if !matches!(self.asking.remove(&instance.instance), Some(Ask::Empty)) {
                    return self.redraw(instance, host, None);
                }
                let outcome = host.run_command(TRASH_EMPTY, serde_json::Value::Null);
                let warning = outcome.err().map(|and| {
                    Text::message(EMPTY_FAILED, vec![Arg::text("reason", and.to_string())])
                });
                self.redraw(instance, host, warning)
            }
            // Il «no», dal bottone o da Esc (la shell manda la stessa azione).
            CANCEL => {
                self.asking.remove(&instance.instance);
                self.redraw(instance, host, None)
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

/// Il nome leggibile di un documento: l'ultimo segmento, senza estensione,
/// qualunque formato sia — la regola è quella di [`DocId::page_name`].
///
/// Il path intero è nel `title` di ciò che si passa il mouse sopra; qui serve
/// ciò che l'utente ha scritto in cima alla nota.
fn display_name(id: &DocId) -> String {
    id.page_name().to_string()
}

/// L'albero del pannello: l'elenco sempre, e la domanda in corso al posto del
/// bottone che l'ha aperta.
///
/// `warning` è ciò che è appena andato storto, e non sta nello stato di vista: un
/// guasto non deve sopravvivere alla chiusura del vault né tornare a galla alla
/// riapertura, perché nel frattempo può essere stato riparato. Vive quanto
/// l'albero che lo mostra, che è quanto deve. `ask` è la domanda in corso di
/// questo esemplare, che vive in [`TrashView`] per la stessa ragione.
fn tree(
    host: &dyn ReadApi,
    warning: Option<Text>,
    ask: Option<&Ask>,
) -> Result<UiNode, PluginError> {
    let entries = host.list_trash()?;
    let mut children = Vec::new();

    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }

    if entries.is_empty() {
        // Niente da svuotare né da ripristinare: una domanda rimasta, perché il
        // cestino si è vuotato da un'altra finestra, non ha più un oggetto.
        children.push(UiNode::empty_state(Text::key(IS_EMPTY)));
        return Ok(UiNode::column(1, children));
    }

    let restoring = match ask {
        Some(Ask::Restore {
            entry,
            original,
            name,
        }) => Some((entry.as_str(), original.as_str(), name.as_str())),
        _ => None,
    };
    children.push(UiNode::list(
        entries
            .iter()
            .map(|entry| row(entry, restoring.filter(|(asked, ..)| *asked == entry.id.0)))
            .collect::<Vec<_>>(),
    ));
    if matches!(ask, Some(Ask::Empty)) {
        // La domanda al posto del bottone, dove l'occhio già stava, e con la
        // sua chiave: chiusa la domanda, il fuoco torna al bottone.
        children.push(UiNode::confirmation(
            EMPTY_KEY,
            ActionRef::new(CANCEL),
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
        ));
    } else {
        children.push(
            UiNode::button(
                Text::key(EMPTY_LABEL),
                Intent::Danger,
                ActionRef::new(EMPTY),
            )
            .with_key(EMPTY_KEY),
        );
    }
    Ok(UiNode::column(1, children))
}

/// La chiave del bottone «Ripristina» di una voce, che la domanda del nome
/// eredita. Unica nel pannello, perché la shell rimette il fuoco al primo nodo
/// con quella chiave.
fn restore_key(entry: &str) -> String {
    format!("restore:{entry}")
}

/// Una voce del cestino: cosa era, quando è finita lì, e come tornare indietro.
///
/// La chiave è l'id nel cestino — che è unico e non cambia — perché una lista
/// che si riordina quando qualcuno cestina un'altra nota non deve spostare il
/// fuoco da sotto le dita di chi stava per premere «Ripristina» (§2.8).
///
/// `asking` è la domanda del nome per questa voce, se è in corso: `(id, path
/// d'origine, nome proposto)`. Prende il posto del bottone, sotto la voce di
/// cui parla.
fn row(entry: &TrashEntry, asking: Option<(&str, &str, &str)>) -> UiNode {
    let item = UiNode::list_item(
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
    );
    let (dir, action) = match asking {
        Some((_, original, proposed_name)) => (
            fub_abi::ui::Axis::Column,
            restore_question(&entry.id.0, original, proposed_name),
        ),
        None => (
            fub_abi::ui::Axis::Row,
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
            )
            .with_key(restore_key(&entry.id.0)),
        ),
    };
    UiNode::keyed(
        entry.id.0.clone(),
        UiKind::Stack {
            dir,
            gap: 1,
            children: vec![item, action],
        },
    )
}

/// La domanda del nome: il path d'origine è di nuovo occupato, e il nome
/// libero proposto sta in un campo che si può correggere.
fn restore_question(entry: &str, original: &str, proposed_name: &str) -> UiNode {
    UiNode::confirmation(
        restore_key(entry),
        ActionRef::new(CANCEL),
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
