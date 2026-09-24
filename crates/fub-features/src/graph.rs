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
use fub_abi::{UiAction, UiKind, UiNode, ViewUpdate};
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
/// Le chiavi opzionali del payload: i gruppi per nodo (cartella o tag), la
/// vista locale (seme, profondità, verso) e i filtri di disegno. Sono costanti
/// per la stessa ragione di [`NODES`]: la shell le legge di là dal confine.
/// Assenti = il grafo globale di sempre: una shell vecchia che legge solo
/// `nodes`/`edges` disegna lo stesso grafo, senza gruppi né locale.
const GROUPS: &str = "groups";
/// La vista locale dentro il payload: `{ seed, depth, direction }`.
const LOCAL: &str = "local";
/// I filtri dentro il payload: `{ show_orphans, show_attachments }`.
const FILTER: &str = "filter";
/// Ultima modifica indicizzata per nodo, millisecondi UNIX come stringa JSON
/// per non perdere la precisione degli interi oltre l'intervallo JS sicuro.
const MODIFIED: &str = "modified";
/// Il seme della vista locale: la nota da cui si cammina.
const SEED: &str = "seed";
/// La profondità della vista locale (1..=3).
const DEPTH: &str = "depth";
/// Il verso della camminata locale (`outbound`/`inbound`/`both`).
const DIRECTION: &str = "direction";
/// Mostra i nodi isolati (default vero: un orfano è un'informazione).
const SHOW_ORPHANS: &str = "show_orphans";
/// Mostra gli allegati linkati (default falso: il grafo è di note).
const SHOW_ATTACHMENTS: &str = "show_attachments";
/// Il gruppo da cui colorare: `"folder"` o `"tag"` (default cartella).
const GROUP_BY: &str = "group_by";
/// Raggruppa per cartella contenitrice.
const GROUP_FOLDER: &str = "folder";
/// Raggruppa per primo tag (forma canonica; senza tag = gruppo vuoto).
const GROUP_TAG: &str = "tag";
/// La chiave di stato di vista sotto cui il seme resta scritto.
const SEED_STATE: &str = "seed";
/// La profondità resta scritta qui.
const DEPTH_STATE: &str = "depth";
/// Il verso resta scritto qui.
const DIRECTION_STATE: &str = "direction";
/// Il raggruppamento resta scritto qui.
const GROUP_STATE: &str = "group_by";
/// I filtri restano scritti qui (un oggetto JSON, non due chiavi).
const FILTER_STATE: &str = "filter";
/// L'azione che sceglie il seme (il documento sta nel payload sotto [`DOC`]).
const SEED_ACTION: &str = "seed";
/// L'azione che sceglie la profondità (numero nel payload sotto [`DEPTH`]).
const DEPTH_ACTION: &str = "depth";
/// L'azione che sceglie il verso (stringa nel payload sotto [`DIRECTION`]).
const DIRECTION_ACTION: &str = "direction";
/// L'azione che sceglie il raggruppamento (stringa sotto [`GROUP_BY`]).
const GROUP_ACTION: &str = "group_by";
/// L'azione che commuta un filtro (chiave sotto `key`: `show_orphans` o
/// `show_attachments`).
const FILTER_ACTION: &str = "filter";
/// La chiave del payload di [`FILTER_ACTION`].
const FILTER_KEY: &str = "key";
/// Profondità massima della vista locale: oltre tre passi il vicinato è il
/// vault, e la «locale» mente.
const MAX_DEPTH: u8 = 3;

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
        host: &mut dyn HostApi,
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
            // Il seme della vista locale: la nota da cui si cammina. Si ricorda
            // in stato di vista (per esemplare, come il filtro dei tag) e si
            // ridisegna; vuoto si dimentica e torna il grafo globale.
            SEED_ACTION => {
                let seed = action.payload.get(DOC).and_then(|v| v.as_str());
                let value = seed
                    .filter(|s| !s.trim().is_empty())
                    .map(serde_json::Value::from);
                host.set_view_state(SEED_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // La profondità: 1..=3, il resto legge come il default (1). Un
            // numero che non è un numero non è un errore: è una riga scritta a
            // mano, e il pannello non smette di funzionare per quello.
            DEPTH_ACTION => {
                let depth = action.payload.get(DEPTH).and_then(|v| v.as_u64());
                let value = match depth {
                    Some(2) => Some(serde_json::Value::from(2)),
                    Some(3) => Some(serde_json::Value::from(3)),
                    Some(_) => None,
                    None => return Ok(ViewUpdate::None),
                };
                host.set_view_state(DEPTH_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Il verso: `outbound`/`inbound`/`both`, il resto è `None` (nessun
            // ridisegno, nessun errore: come il modo dei tag).
            DIRECTION_ACTION => {
                let direction = action.payload.get(DIRECTION).and_then(|v| v.as_str());
                let value = match direction {
                    Some("inbound") => Some(serde_json::Value::from("inbound")),
                    Some("both") => Some(serde_json::Value::from("both")),
                    Some("outbound") => None,
                    _ => return Ok(ViewUpdate::None),
                };
                host.set_view_state(DIRECTION_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Il raggruppamento: `folder` o `tag`, il resto è `None`.
            GROUP_ACTION => {
                let group = action.payload.get(GROUP_BY).and_then(|v| v.as_str());
                let value = match group {
                    Some(GROUP_TAG) => Some(serde_json::Value::from(GROUP_TAG)),
                    Some(GROUP_FOLDER) => None,
                    _ => return Ok(ViewUpdate::None),
                };
                host.set_view_state(GROUP_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Un filtro si commuta: la chiave sta nel payload sotto `key`, e lo
            // stato è un oggetto JSON unico (non due chiavi) così i due restano
            // d'accordo — un oggetto dimezzato legge come i default, non come
            // un errore.
            FILTER_ACTION => {
                let Some(key) = action.payload.get(FILTER_KEY).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let mut filter = filter_of(host)?;
                match key {
                    SHOW_ORPHANS => filter.show_orphans = !filter.show_orphans,
                    SHOW_ATTACHMENTS => filter.show_attachments = !filter.show_attachments,
                    _ => return Ok(ViewUpdate::None),
                }
                // I default non si scrivono: la chiave torna a non esserci come
                // per il filtro dei tag e la selezione — un file senza righe
                // per ogni pannello aperto e richiuso.
                let value = if filter.is_default() {
                    None
                } else {
                    Some(json!({
                        SHOW_ORPHANS: filter.show_orphans,
                        SHOW_ATTACHMENTS: filter.show_attachments,
                    }))
                };
                host.set_view_state(FILTER_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// L'albero della view: un nodo custom col grafo dentro, e il ripiego per chi
/// non sa disegnarlo.
fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let selection = LocalSelection::of(host)?;
    let filter = filter_of(host)?;
    let group_by = group_of(host)?;
    let (nodes, edges) = match selection.seed.clone() {
        // La vista locale: i vicini del seme fino a `depth` nel `direction`
        // chiesto — una domanda sola al canale dati, non una per nota. Il seme
        // che non c'è più dà un grafo vuoto col ripiego, non un errore: una
        // nota rinominata via da sotto non spegne il pannello.
        Some(seed) => local_graph(host, &seed, selection.depth, selection.direction)?,
        None => (
            documents(host)?,
            edge_values(host, QueryExpr::all(), LinkDirection::Outbound)?,
        ),
    };
    let (nodes, edges) = apply_filter(nodes, edges, &filter);
    let groups = groups_for(host, &nodes, &group_by)?;
    let visible = nodes
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: None,
    })? {
        IndexResult::Entries(page) => page.items,
        other => {
            return Err(PluginError::Internal(
                format!("entries query: off-topic response: {}", other.kind_name()).into(),
            ))
        }
    };
    let modified = entries
        .into_iter()
        .filter(|entry| visible.contains(entry.id.as_str()))
        .map(|entry| (entry.id.to_string(), entry.mtime.to_string()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut payload = json!({ NODES: nodes, EDGES: edges });
    if !groups.is_empty() {
        payload[GROUPS] = json!(groups);
    }
    payload[MODIFIED] = json!(modified);
    if let Some(seed) = selection.seed {
        payload[LOCAL] = json!({
            SEED: seed,
            DEPTH: selection.depth,
            DIRECTION: match selection.direction {
                LinkDirection::Outbound => "outbound",
                LinkDirection::Inbound => "inbound",
                LinkDirection::Both => "both",
            },
        });
    }
    payload[FILTER] = json!({
        SHOW_ORPHANS: filter.show_orphans,
        SHOW_ATTACHMENTS: filter.show_attachments,
    });
    payload[GROUP_BY] = json!(group_by);
    Ok(UiNode::new(UiKind::Custom {
        ns: GRAPH_NS.to_string(),
        payload,
        fallback: vec![UiNode::empty_state(Text::key(FALLBACK))],
    }))
}

/// Cosa la vista locale chiede: seme, profondità, verso. Profondità fuori
/// 1..=3 legge come 1; un seme vuoto è nessun seme (il grafo globale).
struct LocalSelection {
    seed: Option<String>,
    depth: u8,
    direction: LinkDirection,
}

impl LocalSelection {
    fn of(host: &dyn ReadApi) -> Result<Self, PluginError> {
        let seed = host
            .view_state(SEED_STATE)?
            .and_then(|v| v.as_str().map(str::to_string))
            .filter(|s| !s.trim().is_empty());
        let depth = host
            .view_state(DEPTH_STATE)?
            .and_then(|v| v.as_u64())
            .filter(|d| *d >= 1 && *d <= u64::from(MAX_DEPTH))
            .unwrap_or(1) as u8;
        let direction = match host
            .view_state(DIRECTION_STATE)?
            .and_then(|v| v.as_str().map(str::to_string))
            .as_deref()
        {
            Some("inbound") => LinkDirection::Inbound,
            Some("both") => LinkDirection::Both,
            _ => LinkDirection::Outbound,
        };
        Ok(LocalSelection {
            seed,
            depth,
            direction,
        })
    }
}

/// I filtri di disegno: orfani visibili di default, allegati no.
struct GraphFilter {
    show_orphans: bool,
    show_attachments: bool,
}

impl GraphFilter {
    fn is_default(&self) -> bool {
        self.show_orphans && !self.show_attachments
    }
}

/// Legge i filtri; un oggetto dimezzato o una sciocchezza scritta a mano legge
/// come i default, mai come un errore.
fn filter_of(host: &dyn ReadApi) -> Result<GraphFilter, PluginError> {
    let value = host.view_state(FILTER_STATE)?;
    let mut filter = GraphFilter {
        show_orphans: true,
        show_attachments: false,
    };
    if let Some(object) = value.as_ref().and_then(|v| v.as_object()) {
        if let Some(show) = object.get(SHOW_ORPHANS).and_then(|v| v.as_bool()) {
            filter.show_orphans = show;
        }
        if let Some(show) = object.get(SHOW_ATTACHMENTS).and_then(|v| v.as_bool()) {
            filter.show_attachments = show;
        }
    }
    Ok(filter)
}

/// Il raggruppamento: `"tag"` o `"folder"` (default). Come sopra: ciò che non
/// si capisce è il default.
fn group_of(host: &dyn ReadApi) -> Result<String, PluginError> {
    let group = host
        .view_state(GROUP_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| GROUP_FOLDER.to_string());
    if group == GROUP_TAG {
        Ok(GROUP_TAG.to_string())
    } else {
        Ok(GROUP_FOLDER.to_string())
    }
}

/// Il grafo locale: il seme più i suoi vicini fino a `depth`, con gli archi fra
/// loro. Due domande al canale dati (i vicini, poi i documenti per i gruppi) e
/// non una per nota: è la ragione per cui `Neighbors` prende un'espressione.
fn local_graph(
    host: &dyn ReadApi,
    seed: &str,
    depth: u8,
    direction: LinkDirection,
) -> Result<(Vec<String>, Vec<serde_json::Value>), PluginError> {
    let seeds = QueryExpr::of(fub_abi::query::QueryPredicate::Docs {
        docs: vec![fub_abi::model::DocId::new(seed)],
    });
    let neighbors = match host.query_index(IndexQuery::Neighbors {
        seeds,
        direction,
        depth,
        page: None,
    })? {
        IndexResult::Neighbors(n) => n.items,
        other => {
            return Err(PluginError::Internal(
                format!("neighbors query: off-topic response: {}", other.kind_name()).into(),
            ))
        }
    };
    let mut nodes: Vec<String> = vec![seed.to_string()];
    for neighbor in &neighbors {
        if !nodes.iter().any(|n| n == neighbor.doc.as_str()) {
            nodes.push(neighbor.doc.to_string());
        }
        if !nodes.iter().any(|n| n == neighbor.via.as_str()) {
            nodes.push(neighbor.via.to_string());
        }
    }
    nodes.sort();
    let mut seen = std::collections::BTreeSet::new();
    let mut edges = Vec::new();
    for neighbor in neighbors {
        let edge = match direction {
            LinkDirection::Inbound => (neighbor.doc.to_string(), neighbor.via.to_string()),
            _ => (neighbor.via.to_string(), neighbor.doc.to_string()),
        };
        if !seen.insert(edge.clone()) {
            continue;
        }
        edges.push(json!({ FROM: edge.0, TO: edge.1 }));
    }
    Ok((nodes, edges))
}

/// Applica i filtri di disegno: senza orfani si tolgono i nodi isolati (chi ha
/// un arco resta); senza allegati si tolgono gli archi verso non-documenti —
/// qui letti dall'estensione, perché il payload non porta le specie e il canale
/// `Entries` costerebbe una seconda topologia per un filtro di disegno.
fn apply_filter(
    nodes: Vec<String>,
    edges: Vec<serde_json::Value>,
    filter: &GraphFilter,
) -> (Vec<String>, Vec<serde_json::Value>) {
    let edges = if filter.show_attachments {
        edges
    } else {
        edges
            .into_iter()
            .filter(|e| {
                let from = e.get(FROM).and_then(|v| v.as_str()).unwrap_or("");
                let to = e.get(TO).and_then(|v| v.as_str()).unwrap_or("");
                is_note(from) && is_note(to)
            })
            .collect()
    };
    if filter.show_orphans {
        return (nodes, edges);
    }
    let mut linked = std::collections::BTreeSet::new();
    for e in &edges {
        if let Some(from) = e.get(FROM).and_then(|v| v.as_str()) {
            linked.insert(from.to_string());
        }
        if let Some(to) = e.get(TO).and_then(|v| v.as_str()) {
            linked.insert(to.to_string());
        }
    }
    let nodes = nodes.into_iter().filter(|n| linked.contains(n)).collect();
    (nodes, edges)
}

/// Un allegato, per il filtro di disegno: ciò che non è una nota per
/// estensione. La regola delle estensioni sta nel registry dei formati — qui
/// serve solo a non disegnare un PNG come una nota, e la lista è quella che il
/// markdown tratta da documento contro allegato.
fn is_note(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".txt")
        || !lower.rsplit('.').next().is_some_and(|ext| {
            matches!(
                ext,
                "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "svg"
                    | "pdf"
                    | "mp3"
                    | "wav"
                    | "ogg"
                    | "mp4"
                    | "webm"
                    | "zip"
            )
        })
}

/// Raggruppamento per tag esatto: la faccetta individua i tag presenti nel
/// grafo, poi ogni tag seleziona i propri documenti tramite lo stesso planner
/// di Documents. Non leggiamo N modelli né attribuiamo un tag di un'altra nota.
/// Il primo tag in ordine canonico prevale quando una nota ne ha più di uno.
fn groups_for(
    host: &dyn ReadApi,
    nodes: &[String],
    group_by: &str,
) -> Result<std::collections::BTreeMap<String, String>, PluginError> {
    use std::collections::BTreeMap;
    if group_by == GROUP_TAG {
        let matching = QueryExpr::of(fub_abi::query::QueryPredicate::Docs {
            docs: nodes.iter().map(fub_abi::model::DocId::new).collect(),
        });
        let mut counts = match host.query_index(IndexQuery::Tags {
            matching,
            page: None,
        })? {
            IndexResult::Tags(t) => t.items,
            other => {
                return Err(PluginError::Internal(
                    format!("tags query: off-topic response: {}", other.kind_name()).into(),
                ))
            }
        };
        counts.sort_by(|a, b| a.name.cmp(&b.name));
        let mut groups = BTreeMap::new();
        for tag in counts {
            if groups.len() == nodes.len() {
                break;
            }
            let matching = QueryExpr {
                any: vec![fub_abi::query::QueryClause {
                    all: vec![
                        fub_abi::query::QueryLiteral {
                            negated: false,
                            predicate: fub_abi::query::QueryPredicate::Tag {
                                name: tag.name.clone(),
                                descendants: false,
                            },
                        },
                        fub_abi::query::QueryLiteral {
                            negated: false,
                            predicate: fub_abi::query::QueryPredicate::Docs {
                                docs: nodes.iter().map(fub_abi::model::DocId::new).collect(),
                            },
                        },
                    ],
                }],
            };
            let matches = match host.query_index(IndexQuery::Documents {
                matching,
                sort: None,
                select: Default::default(),
                page: Some(fub_abi::traits::Page::new(0, nodes.len() as u32)),
                excerpts: fub_abi::traits::Excerpts::Omit,
            })? {
                IndexResult::Documents(page) => page,
                other => {
                    return Err(PluginError::Internal(
                        format!("documents query: off-topic response: {}", other.kind_name())
                            .into(),
                    ))
                }
            };
            for hit in matches.items {
                groups
                    .entry(hit.doc.as_str().to_string())
                    .or_insert_with(|| tag.name.clone());
            }
        }
        for node in nodes {
            groups.entry(node.clone()).or_default();
        }
        return Ok(groups);
    }
    let mut groups = BTreeMap::new();
    for node in nodes {
        let group = node
            .rsplit_once('/')
            .map(|(dir, _)| dir.to_string())
            .unwrap_or_default();
        groups.insert(node.clone(), group);
    }
    Ok(groups)
}
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

/// Gli archi dei semi nel verso chiesto, deduplicati. Nel grafo globale i
/// semi vuoti coprono tutto il vault; in quello locale `local_graph` legge i
/// vicini e i riferimenti da una sola query.
fn edge_values(
    host: &dyn ReadApi,
    seeds: QueryExpr,
    direction: LinkDirection,
) -> Result<Vec<serde_json::Value>, PluginError> {
    let neighbors = match host.query_index(IndexQuery::Neighbors {
        seeds,
        direction,
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
    use fub_abi::traits::ViewStateWrite;
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

    /// Il payload resta quello che la shell sa leggere: `nodes`/`edges` ci
    /// sono sempre, e le chiavi nuove sono opzionali — una shell vecchia che
    /// legge solo le due disegna lo stesso grafo globale.
    #[test]
    fn the_payload_stays_backward_compatible() {
        let host = MemoryHost::new()
            .with_document("a.md", "[[b]]")
            .with_document("b.md", "")
            .with_edge("a.md", "b.md");
        let tree = GraphView
            .render_view(&ViewInstance::only(GRAPH_VIEW), &host)
            .unwrap();
        let (_, payload) = custom(&tree);
        assert_eq!(names(payload, NODES), [r#""a.md""#, r#""b.md""#]);
        assert_eq!(
            payload[EDGES].as_array().unwrap(),
            &[json!({ FROM: "a.md", TO: "b.md" })]
        );
        assert!(payload.get(GROUPS).is_some(), "groups sempre presenti");
        assert!(payload.get(FILTER).is_some(), "filter sempre presente");
        assert!(payload.get(LOCAL).is_none(), "local solo col seme");
    }

    /// Senza orfani i nodi isolati spariscono, con gli orfani restano: è un
    /// filtro di disegno, non una seconda topologia.
    #[test]
    fn hiding_orphans_keeps_only_linked_nodes() {
        let nodes = vec![
            "a.md".to_string(),
            "b.md".to_string(),
            "solo.md".to_string(),
        ];
        let edges = vec![json!({ FROM: "a.md", TO: "b.md" })];
        let hidden = GraphFilter {
            show_orphans: false,
            show_attachments: true,
        };
        let (nodes, edges) = apply_filter(nodes, edges, &hidden);
        assert_eq!(nodes, vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(edges.len(), 1);
    }

    /// Senza allegati gli archi verso non-note spariscono e i nodi restano: il
    /// filtro taglia i fili, non le palline.
    #[test]
    fn hiding_attachments_cuts_edges_not_nodes() {
        let nodes = vec!["a.md".to_string(), "foto.png".to_string()];
        let edges = vec![json!({ FROM: "a.md", TO: "foto.png" })];
        let hidden = GraphFilter {
            show_orphans: true,
            show_attachments: false,
        };
        let (nodes, edges) = apply_filter(nodes, edges, &hidden);
        assert_eq!(nodes.len(), 2);
        assert!(edges.is_empty());
    }

    /// Profondità oltre il massimo e versi illeggibili leggono come i default:
    /// una riga scritta a mano non spegne il pannello.
    #[test]
    fn garbage_local_state_reads_as_defaults() {
        let mut host = MemoryHost::new().with_instance("uno");
        host.set_view_state(DEPTH_STATE, Some(serde_json::json!(99)))
            .unwrap();
        host.set_view_state(DIRECTION_STATE, Some(serde_json::json!("diagonale")))
            .unwrap();
        let selection = LocalSelection::of(&host).unwrap();
        assert!(selection.seed.is_none());
        assert_eq!(selection.depth, 1);
        assert!(matches!(selection.direction, LinkDirection::Outbound));
    }

    /// I gruppi per cartella sono puri path: la radice è il gruppo vuoto, una
    /// sottocartella il suo path. Nessuna interrogazione per nodo.
    #[test]
    fn groups_by_folder_are_parent_paths() {
        let host = MemoryHost::new();
        let groups = groups_for(
            &host,
            &["a.md".to_string(), "sub/b.md".to_string()],
            GROUP_FOLDER,
        )
        .unwrap();
        assert_eq!(groups["a.md"], "");
        assert_eq!(groups["sub/b.md"], "sub");
    }
}
