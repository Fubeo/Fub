//! La **vista a grafo** come `ViewProvider`: l'ultima superficie privilegiata
//! di questa shell che smette di esserlo (§3.3).
//!
//! # Cosa era, e cosa resta di vero di quello che era
//!
//! Il grafo è nato pannello nativo della shell, disegnato su un `<canvas>` in un
//! overlay che si apriva sopra tutto. Di quella forma erano vere due cose
//! diverse, e la §3.3 esiste perché per anni sono state confuse in una sola:
//!
//!   - **il canvas è della shell**, e lo resta. `UiNode` non esprime un canvas,
//!     né deve: un protocollo dichiarativo che dovesse esprimere un
//!     force-directed sarebbe un motore grafico travestito da enum. Questo non
//!     era il debito.
//!   - **i dati erano della shell**, e questo sì che lo era. Chi decideva quali
//!     nodi e quali archi disegnare era `panels/graph.ts`, cioè del codice che un
//!     plugin di terzi non può scrivere. Finché è stato così, «vista a grafo» è
//!     stata una cosa che solo noi potevamo fare.
//!
//! Qui la seconda metà passa di là dal confine e la prima no. Il provider
//! risponde con un [`UiKind::Custom`] che porta i dati nel `payload`, la shell
//! riconosce [`GRAPH_NS`] e ci mette sopra il suo canvas — che è esattamente il
//! ramo che il contratto descrive dal §3.3 («la shell che conosce `ns` disegna il
//! suo widget») e che fino a oggi non aveva un cliente.
//!
//! # Perché il `payload` non è un canale privilegiato travestito
//!
//! È la domanda onesta da farsi, e la risposta sta nel confronto col codice di
//! prima. La shell faceva **due** domande al canale dati
//! ([`IndexQuery::Documents`] e [`IndexQuery::Neighbors`]) e ne componeva nodi e
//! archi. Adesso le stesse due domande le fa un provider, con la stessa
//! `HostApi` che avrà un plugin di terzi, e il risultato viaggia dentro il
//! `payload` di un nodo dell'albero. Non c'è nessuna porta in più: il §16.6 non
//! si muove, e il grafo attraversa il confine con `render_view` come ogni altra
//! view.
//!
//! Ciò che **resta** privilegiato è solo il disegno, e la misura di quanto lo sia
//! è precisa: lo `ns` che questa shell conosce. Un plugin di terzi può mandare il
//! suo `Custom`, e riceve il `fallback` finché nessuno gli scrive un renderer.
//! È l'asterisco di onestà di `../../../docs/architecture/frontend-and-ipc.md`, che questo file
//! non indebolisce — lo **circoscrive**: prima riguardava anche i dati, adesso
//! solo i pixel.
//!
//! # Cliccare un nodo non ha avuto bisogno di niente di nuovo
//!
//! Il gesto del grafo è uno: si clicca un nodo e si apre quella nota. Nel
//! pannello nativo era una chiamata diretta a chi apre i documenti; qui è
//! [`ViewUpdate::Navigate`], che il backlink usa dal primo giorno per la stessa
//! ragione. È il caso in cui la domanda «serve firma nuova?» ha trovato la
//! risposta già scritta nel contratto da un'altra decisione.
//!
//! # Il grafo non si ridisegna da solo, ed è dichiarato
//!
//! La maschera è **vuota**, e non per dimenticanza: la simulazione converge in
//! qualche secondo e ripartire significa far saltare i nodi sotto il mouse di
//! chi li sta guardando. Nel pannello nativo la stessa scelta viveva in un
//! `refreshOn()` senza argomenti, cioè in una riga della shell; qui è una
//! `ViewInterests` che il provider dichiara, e che un giorno può cambiare idea
//! senza che nessuno tocchi la shell.

use fub_abi::error::PluginError;
use fub_abi::event::EventMask;
use fub_abi::query::QueryExpr;
use fub_abi::session::ContextMask;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{
    HostApi, IndexQuery, IndexResult, LinkDirection, NeighborRef, ReadApi, ViewInstance,
    ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiKind, UiNode, ViewUpdate};
use serde_json::json;

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const GRAPH_ID: &str = "fub.graph";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const GRAPH_VIEW: &str = "graph";

/// Il namespace con cui il grafo arriva alla shell dentro [`UiKind::Custom`].
///
/// Stessa regola dei diagrammi (`blocks::DIAGRAM_NS`): chi manda e chi disegna
/// devono essere riconoscibili come **la stessa estensione**, quindi il nome è
/// quello del componente e non un'invenzione locale.
pub const GRAPH_NS: &str = "fub:graph";

/// L'azione «apri questa nota»; il documento sta nel payload sotto [`DOC`].
const OPEN: &str = "open";
/// La chiave del payload di [`OPEN`].
const DOC: &str = "doc";

/// Le due chiavi del payload del nodo custom: l'elenco dei documenti e quello
/// degli archi. Sono costanti perché la shell le legge dall'altra parte del
/// confine, cioè sono **protocollo fra due componenti** e non nomi di comodo.
const NODES: &str = "nodes";
const EDGES: &str = "edges";
/// Le due estremità di un arco.
const FROM: &str = "from";
const TO: &str = "to";

/// Il titolo della view, come si legge sulla tab del riquadro che la ospita.
const VIEW_TITLE: &str = "view_title";
/// Il ripiego: cosa legge chi apre questo grafo in una shell che non sa
/// disegnarlo. Dice **cosa** manca e non «non supportato», che è la stessa
/// regola con cui `ui/views.ts` nomina le superfici che non ospita.
const FALLBACK: &str = "fallback";

/// Le stringhe del grafo. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it").with(VIEW_TITLE, "Grafo").with(
            FALLBACK,
            "Questa shell non sa disegnare un grafo: le manca il renderer di «fub:graph».",
        ),
        StringCatalog::new("en").with(VIEW_TITLE, "Graph").with(
            FALLBACK,
            "This shell cannot draw a graph: it has no renderer for `fub:graph`.",
        ),
    ]
}

/// La vista a grafo.
///
/// **Senza campi**, come il pannello tag: la posizione dei nodi è della
/// simulazione, che vive nella shell e muore con la tab. Non è stato di vista e
/// non deve diventarlo — un layout di force-directed salvato è un layout che al
/// primo documento aggiunto è già sbagliato.
pub struct GraphView;

impl ViewProvider for GraphView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Vuota apposta: vedi la nota in testa al modulo. Il grafo si
            // rilegge quando lo si apre.
            refresh: EventMask::of([]),
            // …e non segue il contesto. Quale nota sia aperta il grafo lo
            // scoprirebbe volentieri — per accendere il nodo giusto — ma
            // ridisegnarsi a ogni movimento del cursore per una pallina colorata
            // è il baratto che la `ContextMask` esiste per non fare. Il nodo
            // acceso lo sa la shell, che il documento attivo ce l'ha in casa.
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // **La prima view di questo repo sulla superficie principale.**
            // Finché nessuno la dichiarava, `ViewSurface::Main` era una variante
            // del contratto che non aveva mai attraversato niente — e una
            // superficie dichiarata e mai ospitata è una promessa che non si sa
            // se regge.
            //
            // Niente `open_by_default`: un riquadro non è un pannello che nasce
            // aperto o chiuso, è un posto in cui qualcuno mette qualcosa. Ci
            // arriva col comando `shell.graph`, e `order` non ha nessuno con cui
            // ordinarsi.
            ViewSpec::new(GRAPH_VIEW, Text::key(VIEW_TITLE), ViewSurface::Main).with_icon("graph"),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // Il click su un nodo. `Navigate` e non un intento nuovo: è
            // letteralmente ciò che fa il backlink, e il grafo è un elenco di
            // riferimenti disegnato tondo.
            OPEN => match action.payload.get(DOC).and_then(|v| v.as_str()) {
                Some(doc) => Ok(ViewUpdate::Navigate {
                    doc_id: doc.to_string(),
                }),
                None => Ok(ViewUpdate::None),
            },
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// L'albero della view: un nodo custom col grafo dentro, e il ripiego per chi
/// non sa disegnarlo.
fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let nodes = documents(host)?;
    let edges = edges(host)?;
    Ok(UiNode::new(UiKind::Custom {
        ns: GRAPH_NS.to_string(),
        payload: json!({ NODES: nodes, EDGES: edges }),
        fallback: vec![UiNode::empty_state(Text::key(FALLBACK))],
    }))
}

/// I nodi: ogni documento del vault.
///
/// Senza finestra, come i tag: un grafo mostrato a pagine non è un grafo. È
/// anche il motivo per cui il §2.9 (virtualizzazione) non lo tocca — qui non c'è
/// una lista da tagliare, c'è una topologia che o si ha intera o si mente.
fn documents(host: &dyn ReadApi) -> Result<Vec<String>, PluginError> {
    Ok(host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::all(),
            sort: None,
            select: Default::default(),
            // Niente estratti: un grafo disegna nomi, e un estratto per nota su
            // tutto il vault è testo che attraversa il confine per essere
            // buttato via.
            excerpts: Default::default(),
            page: None,
        })?
        .documents()?
        .items
        .into_iter()
        .map(|d| d.doc.to_string())
        .collect())
}

/// Gli archi: i vicini a un passo di **tutto il vault**, in uscita.
///
/// È la domanda sola che la [0004](../../../docs/decisions/README.md)
/// ha messo nel contratto apposta — semi vuoti = tutto il vault — e la ragione
/// per cui esiste è esattamente questa: chiederli una nota alla volta sarebbe
/// stato mille viaggi, cioè un comando bespoke con un altro nome.
///
/// **Deduplicati**: due link fra le stesse due note disegnano una riga sola, e
/// mandarne due significa farne disegnare due sovrapposte a chi sta di là. Che a
/// dedurre sia il provider e non chi disegna è la regola generale — il confine si
/// attraversa una volta, quindi lo si attraversa già pulito.
fn edges(host: &dyn ReadApi) -> Result<Vec<serde_json::Value>, PluginError> {
    let neighbors = match host.query_index(IndexQuery::Neighbors {
        seeds: QueryExpr::all(),
        direction: LinkDirection::Outbound,
        depth: 1,
        page: None,
    })? {
        IndexResult::Neighbors(n) => n.items,
        other => {
            return Err(PluginError::Internal(
                format!("neighbors query: off-topic response: {}", other.kind_name()).into(),
            ))
        }
    };
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for NeighborRef { doc, via, .. } in neighbors {
        // `via` è il documento **da cui** si parte e `doc` quello a cui si
        // arriva: il verso è quello della query (`Outbound`), non l'ordine dei
        // campi.
        let edge = (via.to_string(), doc.to_string());
        if !seen.insert(edge.clone()) {
            continue;
        }
        out.push(json!({ FROM: edge.0, TO: edge.1 }));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_sdk::testing::MemoryHost;

    /// Il nodo custom dell'albero, con il suo payload.
    fn custom(tree: &UiNode) -> (&str, &serde_json::Value) {
        let UiKind::Custom { ns, payload, .. } = &tree.kind else {
            panic!("the graph is a custom node")
        };
        (ns, payload)
    }

    fn names(payload: &serde_json::Value, key: &str) -> Vec<String> {
        payload[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.to_string())
            .collect()
    }

    /// Il contratto con la shell: lo `ns` che riconosce e le due chiavi che
    /// legge. Se questo test cambia, cambia `apps/client/src/panels/graph.ts`.
    #[test]
    fn the_graph_is_a_custom_node_with_nodes_and_edges() {
        let host = MemoryHost::new()
            .with_document("a.md", "[[b]]")
            .with_document("b.md", "")
            .with_edge("a.md", "b.md");
        let tree = GraphView
            .render_view(&ViewInstance::only(GRAPH_VIEW), &host)
            .unwrap();
        let (ns, payload) = custom(&tree);
        assert_eq!(ns, GRAPH_NS);
        assert_eq!(names(payload, NODES), [r#""a.md""#, r#""b.md""#]);
        assert_eq!(
            payload[EDGES].as_array().unwrap(),
            &[json!({ FROM: "a.md", TO: "b.md" })]
        );
    }

    /// **Deduplicati**: due link fra le stesse due note sono una riga sola. È
    /// la regola che prima stava nella shell, e che passando di qua smette di
    /// essere una cosa che ogni chi-disegna deve rifarsi.
    #[test]
    fn two_links_between_the_same_notes_are_one_edge() {
        let host = MemoryHost::new()
            .with_document("a.md", "[[b]] and again [[b]]")
            .with_document("b.md", "")
            .with_edge("a.md", "b.md")
            .with_edge("a.md", "b.md");
        let tree = GraphView
            .render_view(&ViewInstance::only(GRAPH_VIEW), &host)
            .unwrap();
        let (_, payload) = custom(&tree);
        assert_eq!(payload[EDGES].as_array().unwrap().len(), 1);
    }

    /// Il ripiego c'è **sempre**, non solo a grafo vuoto: è ciò che vede una
    /// shell che non conosce `fub:graph`, e una shell che non lo conosce non lo
    /// conosce nemmeno quando il vault è pieno.
    #[test]
    fn the_fallback_says_what_is_missing() {
        let host = MemoryHost::new().with_document("a.md", "");
        let tree = GraphView
            .render_view(&ViewInstance::only(GRAPH_VIEW), &host)
            .unwrap();
        let UiKind::Custom { fallback, .. } = &tree.kind else {
            panic!("custom")
        };
        assert!(matches!(&fallback[0].kind, UiKind::EmptyState { .. }));
    }

    /// Cliccare un nodo naviga, e non con un intento nuovo.
    #[test]
    fn clicking_a_node_navigates() {
        let mut host = MemoryHost::new();
        let update = GraphView
            .on_action(
                &ViewInstance::only(GRAPH_VIEW),
                UiAction::new(OPEN).with_payload(json!({ DOC: "note.md" })),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Navigate {
                doc_id: "note.md".into()
            }
        );
    }

    /// Un'azione senza documento non fa niente invece di sbagliare: un payload
    /// storto arriva da chi disegna, e chi disegna può essere una shell che non
    /// è questa.
    #[test]
    fn an_open_without_a_document_does_nothing() {
        let mut host = MemoryHost::new();
        let update = GraphView
            .on_action(
                &ViewInstance::only(GRAPH_VIEW),
                UiAction::new(OPEN),
                &mut host,
            )
            .unwrap();
        assert_eq!(update, ViewUpdate::None);
    }

    /// La superficie che nessuno aveva mai dichiarato.
    #[test]
    fn it_declares_the_main_surface() {
        let spec = &GraphView.views()[0];
        assert_eq!(spec.surface, ViewSurface::Main);
        assert_eq!(spec.id, GRAPH_VIEW);
    }

    /// La maschera vuota è una **dichiarazione**, non un default caduto lì: un
    /// grafo che si ridisegna fa saltare i nodi sotto il mouse.
    #[test]
    fn the_graph_does_not_redraw_on_its_own() {
        let interests = GraphView.interests(&ViewInstance::only(GRAPH_VIEW));
        assert_eq!(interests.refresh, EventMask::of([]));
        assert_eq!(interests.follows, ContextMask::default());
    }
}
