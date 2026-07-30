//! Il pannello backlink come **`ViewProvider`** — la prima feature ufficiale
//! che esercita il protocollo di view per intero, non solo il rendering.
//!
//! È dogfooding vero: il provider non riceve i dati già pronti dall'app, se li
//! prende dall'[`HostApi`] come dovrà fare un plugin di terzi. Le due capacità
//! che glielo permettono — [`HostEnv::active_context`] (quale nota guardo) e
//! [`HostQuery::query_index`] (i suoi backlink) — sono esattamente ciò che prima
//! mancava al contratto e costringeva l'app a fargli da tramite. Il giro
//! completo è: la shell imposta il documento attivo → chiama `render_view` →
//! il provider chiede i backlink all'host → un click torna come `on_action` e
//! il provider risponde [`ViewUpdate::Navigate`], che la shell esegue. Nessun
//! pezzo del percorso è cablato nell'app.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    BacklinkRef, HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const BACKLINKS_ID: &str = "fub.backlinks";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const BACKLINKS_VIEW: &str = "backlinks";

/// L'azione di navigazione emessa dai `ListItem` del pannello. L'id è **solo**
/// l'id (§2.7): quale documento aprire viaggia nel `payload` dell'[`ActionRef`],
/// sotto la chiave [`DOC`]. Prima era concatenato dentro l'id (`open:a/Uno.md`),
/// che funzionava e stava insegnando la stessa convenzione al provider
/// successivo.
const OPEN: &str = "open";
/// La chiave del payload che porta il `DocId` sorgente.
const DOC: &str = "doc";

/// Il pannello backlink. Senza stato: tutto ciò che gli serve lo chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct BacklinksView;

impl ViewProvider for BacklinksView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            BACKLINKS_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        // I backlink invecchiano quando il grafo cambia: ogni modifica
        // al vault arriva come `IndexUpdated`.
        .refreshing(EventMask::of([
            EventKind::IndexUpdated,
            EventKind::BatchEnded,
        ]))
        // …e quando cambia la nota guardata. Non dove ci si trova
        // dentro: i backlink di una nota sono gli stessi da ogni punto
        // di essa, e seguire la selezione qui sarebbe una query per
        // battuta di tasto.
        .following(ContextMask::document())
        .with_icon("backlink")
        .open_by_default()]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(active) = host.active_context().and_then(|c| c.doc) else {
            // Nessuna nota aperta: non è un errore, è uno stato.
            return Ok(placeholder(NO_ACTIVE_DOC));
        };
        // Senza finestra: il pannello elenca tutti i backlink della nota
        // aperta, e chi ne ha migliaia ha un problema di vault, non di pagina.
        let refs = match host.query_index(IndexQuery::Backlinks {
            target: active,
            page: None,
        })? {
            IndexResult::Backlinks(refs) => refs,
            other => {
                return Err(PluginError::Internal(
                    format!("query backlink: risposta fuori tema: {other:?}").into(),
                ))
            }
        };
        Ok(build_backlinks_view(&refs.items))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // L'unica azione del pannello è "apri la sorgente di un backlink", e
        // quale sia sta nel payload che il nodo si portava dietro.
        if action.action.0 != OPEN {
            return Ok(ViewUpdate::None);
        }
        match action.payload.get(DOC).and_then(|v| v.as_str()) {
            Some(id) => Ok(ViewUpdate::Navigate {
                doc_id: id.to_string(),
            }),
            None => Ok(ViewUpdate::None),
        }
    }
}

/// Il segnaposto (nessun backlink / nessuna nota aperta). Ora è ciò che dice di
/// essere — un `EmptyState` — invece di un testo dentro uno stack: la differenza
/// si vede quando è la shell a doverlo disegnare diversamente dal contenuto.
///
/// Prende una **chiave**, non una stringa: è il §12.1 applicato al primo dei
/// suoi clienti veri. La prosa sta nel [`catalog`], che è dato di manifest e non
/// codice.
fn placeholder(key: &str) -> UiNode {
    UiNode::empty_state(Text::key(key))
}

/// Le stringhe del pannello backlink, nelle due lingue che questo repo scrive.
///
/// Il catalogo sta **qui e non nella shell** perché è di chi lo scrive: un
/// plugin di terzi porterà il proprio nel proprio manifest, e la shell non deve
/// conoscere le chiavi di nessuno. Le chiavi sono nude — la qualifica è il
/// catalogo stesso, che appartiene a un componente solo.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Backlink")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessun backlink.")
            .with(COUNT, "Backlink: {count}"),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Backlinks")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(EMPTY, "No backlinks.")
            .with(COUNT, "Backlinks: {count}"),
    ]
}

/// Il titolo del pannello: si vede sempre, anche quando il pannello è vuoto.
const VIEW_TITLE: &str = "view_title";
/// Nessuna nota aperta: non è un errore, è uno stato.
const NO_ACTIVE_DOC: &str = "no_active_doc";
/// La nota aperta non ha backlink.
const EMPTY: &str = "empty";
/// L'intestazione dell'elenco, col numero. Era un `format!` italiano — l'ultima
/// riga di questo file a esserlo — e il numero attraversa adesso come numero.
const COUNT: &str = "count_heading";
const A_COUNT: &str = "count";

/// Costruisce l'albero `UiNode` del pannello backlink per un insieme di
/// riferimenti entranti. Separato da [`BacklinksView`] perché è pura
/// trasformazione dati→UI: si prova senza un host.
pub fn build_backlinks_view(refs: &[BacklinkRef]) -> UiNode {
    if refs.is_empty() {
        return placeholder(EMPTY);
    }

    let items = refs
        .iter()
        .map(|r| {
            UiNode::list_item(
                r.source.page_name(),
                r.context.clone().map(Text::from),
                // l'azione porta il DocId sorgente nel payload, così il
                // provider può navigare senza parsare il proprio id.
                Some(ActionRef::with(
                    OPEN,
                    serde_json::json!({ DOC: r.source.as_str() }),
                )),
            )
            // La chiave è l'identità della riga fra due ridisegni: il documento
            // sorgente, non la sua posizione nell'elenco.
            .with_key(r.source.as_str())
        })
        .collect();

    UiNode::column(
        6,
        vec![
            UiNode::heading(
                3,
                Text::message(COUNT, vec![Arg::int(A_COUNT, refs.len() as i64)]),
            ),
            UiNode::list(items),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::DocId;
    use fub_abi::ui::UiKind;
    use fub_sdk::testing::MemoryHost;

    fn istanza() -> ViewInstance {
        ViewInstance::only(BACKLINKS_VIEW)
    }

    #[test]
    fn empty_shows_placeholder() {
        assert!(matches!(
            build_backlinks_view(&[]).kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn lists_backlinks_with_actions() {
        let refs = vec![BacklinkRef {
            source: DocId::new("a/Nota.md"),
            context: Some("→ target".into()),
        }];
        let node = build_backlinks_view(&refs);
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("Nota"));
        assert!(json.contains(r#""doc":"a/Nota.md""#));
        assert!(
            !json.contains("open:a/Nota.md"),
            "il documento sta nel payload, non concatenato nell'id"
        );
        assert!(
            json.contains(r#""key":"a/Nota.md""#),
            "ogni riga porta la propria identità fra due ridisegni"
        );
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        // Il provider non riceve niente: il documento attivo e i backlink li
        // prende dall'host, esattamente come farà un plugin.
        let host = MemoryHost::new().con_backlink("target.md", &["a/Uno.md", "Due.md"]);
        host.set_active(Some("target.md"));

        let tree = BacklinksView.render_view(&istanza(), &host).unwrap();
        let json = serde_json::to_string(&tree).unwrap();
        // La testata porta il **numero**, non la frase: la frase la compone il
        // catalogo, e il numero è ciò che questo provider ha da dire.
        assert!(json.contains(r#""key":"count_heading""#), "{json}");
        assert!(json.contains(r#""value":2"#), "{json}");
        assert!(json.contains(r#""doc":"a/Uno.md""#));
        assert!(json.contains(r#""doc":"Due.md""#));
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder_not_an_error() {
        let host = MemoryHost::new();
        let tree = BacklinksView.render_view(&istanza(), &host).unwrap();
        assert!(matches!(tree.kind, UiKind::EmptyState { .. }));
    }

    #[test]
    fn clicking_a_backlink_asks_the_shell_to_navigate() {
        let mut host = MemoryHost::new();
        let update = BacklinksView
            .on_action(
                &istanza(),
                UiAction::new(OPEN).with_payload(serde_json::json!({DOC: "a/Uno.md"})),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Navigate {
                doc_id: "a/Uno.md".into()
            }
        );
    }

    /// Un'azione senza il payload che questo pannello attacca ai propri nodi non
    /// naviga da nessuna parte — e non è un errore.
    #[test]
    fn an_action_without_a_document_navigates_nowhere() {
        let mut host = MemoryHost::new();
        let update = BacklinksView
            .on_action(&istanza(), UiAction::new(OPEN), &mut host)
            .unwrap();
        assert_eq!(update, ViewUpdate::None);
    }
}
