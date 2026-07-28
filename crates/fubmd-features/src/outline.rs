//! Il pannello **outline** (struttura) come `ViewProvider`, secondo provider
//! vero dopo i backlink e sullo stesso giro.
//!
//! È il caso che ha portato nel contratto il **canale metadata**: una view non
//! ha un `FormatProvider` (è un plugin), quindi non può parsare un documento per
//! ricavarne gli heading. Li chiede al kernel — che il modello parsato ce l'ha —
//! con [`IndexQuery::Outline`], la stessa porta dei backlink
//! ([`HostQuery::query_index`]). Il click su un heading torna come `on_action` e la
//! view risponde [`ViewUpdate::Reveal`], che la shell esegue portando l'editor
//! sull'intervallo. Nessun pezzo del giro è cablato nell'app.
//!
//! È anche il primo cliente della **selezione** nel contesto di sessione
//! ([`HostEnv::active_context`]): la sezione in cui sta il cursore è segnata,
//! e lo è solo quando lo span è vero — a buffer sporco
//! ([`Selection::span`] assente) gli offset del modello sono di un altro testo,
//! e segnare la sezione sbagliata è peggio che non segnarne nessuna.

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::model::{Heading, Span};
use fubmd_abi::session::{ContextKind, ContextMask, Selection};
use fubmd_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const OUTLINE_ID: &str = "fubmd.outline";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const OUTLINE_VIEW: &str = "outline";

/// L'azione di salto a un heading. L'intervallo viaggia nel payload
/// (`{"start":…,"end":…}`) e non concatenato nell'id (§2.7). Il documento è
/// quello attivo — lo stesso di cui la view mostra la struttura — e in
/// `on_action` lo si chiede all'host.
const REVEAL: &str = "reveal";
/// Le due chiavi del payload di [`REVEAL`].
const START: &str = "start";
const END: &str = "end";

/// Il pannello struttura. Senza stato: heading e documento attivo li chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct OutlineView;

impl ViewProvider for OutlineView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(OUTLINE_VIEW, "Struttura", ViewSurface::RightSidebar)
                // Gli heading cambiano quando cambia il documento:
                // `IndexUpdated` copre ogni scrittura (anche quelle arrivate
                // dal watcher).
                .refreshing(EventMask::of([
                    EventKind::IndexUpdated,
                    EventKind::BatchEnded,
                ]))
                // Del contesto segue il documento (di chi è la struttura) e la
                // selezione (in quale sezione sta il cursore). Non la modalità:
                // in lettura la selezione sparisce, e sparisce con lei il segno.
                .following(ContextMask(vec![
                    ContextKind::Document,
                    ContextKind::Selection,
                ]))
                .with_icon("struttura")
                .ordered(1)
                .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(context) = host.active_context() else {
            return Ok(placeholder("Nessuna nota aperta."));
        };
        let Some(active) = context.doc else {
            return Ok(placeholder("Nessuna nota aperta."));
        };
        let headings = match host.query_index(IndexQuery::Outline { doc: active })? {
            IndexResult::Outline(h) => h,
            other => {
                return Err(PluginError::Internal(format!(
                    "query outline: risposta fuori tema: {other:?}"
                )))
            }
        };
        Ok(build_outline_view(&headings, caret_of(&context.selection)))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // `reveal` col suo intervallo → salta lì, nel documento attivo.
        if action.action.0 != REVEAL {
            return Ok(ViewUpdate::None);
        }
        let Some(span) = payload_span(&action.payload) else {
            return Ok(ViewUpdate::None);
        };
        // Il documento è quello di cui la view mostra la struttura: l'attivo.
        // Cliccare l'outline non cambia il documento attivo, quindi è ancora lui.
        match host.active_context().and_then(|c| c.doc) {
            Some(doc) => Ok(ViewUpdate::Reveal {
                doc_id: doc.as_str().to_string(),
                span,
            }),
            None => Ok(ViewUpdate::None),
        }
    }
}

/// Dove sta il cursore, in byte del sorgente **che il kernel conosce**.
///
/// `None` in tre casi che qui valgono lo stesso: non c'è selezione (modalità di
/// lettura, nessun documento) e non c'è uno span (il buffer ha modifiche non
/// salvate, quindi nessun offset di questo testo vale per quello). Vedi
/// [`Selection::span`].
fn caret_of(selection: &Option<Selection>) -> Option<usize> {
    selection.as_ref()?.span.as_ref().map(|s| s.start)
}

/// `{"start":…,"end":…}` → `Span`, o `None` se il payload non è quello che
/// questa view ha attaccato al nodo.
fn payload_span(payload: &serde_json::Value) -> Option<Span> {
    let start = payload.get(START)?.as_u64()? as usize;
    let end = payload.get(END)?.as_u64()? as usize;
    Some(Span::new(start, end))
}

fn placeholder(text: &str) -> UiNode {
    UiNode::empty_state(text)
}

/// L'indice dell'heading che **contiene** `caret`: l'ultimo che comincia prima
/// di lui.
///
/// Un cursore prima del primo heading non sta in nessuna sezione (`None`): il
/// preambolo di una nota non è la sezione del titolo che lo segue. Gli heading
/// arrivano in ordine di apparizione, che è il contratto di
/// [`IndexResult::Outline`].
fn section_of(headings: &[Heading], caret: usize) -> Option<usize> {
    headings
        .iter()
        .enumerate()
        .rfind(|(_, h)| h.span.start <= caret)
        .map(|(i, _)| i)
}

/// Costruisce l'albero `UiNode` dell'outline, segnando la sezione in cui sta il
/// cursore. Separato dal provider perché è pura trasformazione dati→UI: si
/// prova senza un host.
///
/// È un **albero**, e questo è il collaudo del §2.1: prima la gerarchia degli
/// heading si vedeva rientrando il titolo con uno spazio EM, perché il
/// protocollo aveva solo liste piatte — cioè la struttura di un documento
/// attraversava il confine come *spaziatura*. Ora attraversa come annidamento,
/// e la sezione col cursore è `selected` invece di essere un sottotitolo che
/// dice «cursore qui».
pub fn build_outline_view(headings: &[Heading], caret: Option<usize>) -> UiNode {
    if headings.is_empty() {
        return placeholder("Nessun heading.");
    }
    let corrente = caret.and_then(|c| section_of(headings, c));
    let (roots, _) = subtree(headings, 0, 0, corrente);
    UiNode::column(2, vec![UiNode::new(UiKind::Tree { roots })])
}

/// Gli heading da `at` in poi che stanno **sotto** `parent_level`, e l'indice
/// del primo che non ci sta più.
///
/// Gli heading arrivano in ordine di apparizione col loro livello, che è il
/// contratto di [`IndexResult::Outline`]; il documento può cominciare da un `h3`
/// o saltare un livello, quindi «figlio» qui vuol dire *di livello maggiore*, non
/// *di livello esattamente uno in più*. Una nota scritta a mano non è tenuta a
/// essere ben annidata, e un outline che perdesse gli heading di un documento
/// disordinato sarebbe peggio di uno piatto.
fn subtree(
    headings: &[Heading],
    at: usize,
    parent_level: u8,
    corrente: Option<usize>,
) -> (Vec<UiNode>, usize) {
    let mut nodi = Vec::new();
    let mut i = at;
    while let Some(h) = headings.get(i) {
        if h.level <= parent_level {
            break;
        }
        let (children, next) = subtree(headings, i + 1, h.level, corrente);
        nodi.push(
            UiNode::new(UiKind::TreeItem {
                label: h.text.clone().into(),
                // Aperto: un outline che nasce chiuso non è un outline.
                expanded: true,
                action: Some(ActionRef::with(
                    REVEAL,
                    serde_json::json!({ START: h.span.start, END: h.span.end }),
                )),
                selected: Some(i) == corrente,
                children,
            })
            // La chiave è lo slug dell'heading, che è la sua identità stabile
            // nel documento — non la posizione, che cambia a ogni riga scritta
            // sopra di lui.
            .with_key(h.slug.clone()),
        );
        i = next;
    }
    (nodi, i)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use fubmd_abi::model::Span;

    fn h(level: u8, text: &str, start: usize, end: usize) -> Heading {
        Heading {
            level,
            text: text.to_string(),
            slug: text.to_lowercase(),
            span: Span::new(start, end),
        }
    }

    /// Le voci dell'albero, in ordine di lettura, con il loro livello di
    /// annidamento: `(profondità, etichetta, selezionata)`.
    fn voci(tree: &UiNode) -> Vec<(usize, String, bool)> {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("l'outline è uno stack")
        };
        let UiKind::Tree { roots } = &children[0].kind else {
            panic!("il primo figlio è l'albero")
        };
        fn scendi(nodi: &[UiNode], depth: usize, out: &mut Vec<(usize, String, bool)>) {
            for n in nodi {
                let UiKind::TreeItem {
                    label,
                    selected,
                    children,
                    ..
                } = &n.kind
                else {
                    panic!("una voce d'albero è un tree-item")
                };
                out.push((depth, label.to_string(), *selected));
                scendi(children, depth + 1, out);
            }
        }
        let mut out = Vec::new();
        scendi(roots, 0, &mut out);
        out
    }

    #[test]
    fn empty_shows_placeholder() {
        assert!(matches!(
            &build_outline_view(&[], None).kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn nested_headings_become_a_tree_and_carry_reveal_payloads() {
        let tree = build_outline_view(&[h(1, "Titolo", 0, 8), h(2, "Sezione", 20, 30)], None);
        assert_eq!(
            voci(&tree),
            vec![
                (0, "Titolo".to_string(), false),
                (1, "Sezione".to_string(), false),
            ],
            "il livello è annidamento, non spaziatura nel titolo"
        );
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains(r#""start":20"#) && json.contains(r#""end":30"#));
        assert!(
            !json.contains("reveal:"),
            "l'id non porta più dati concatenati"
        );
    }

    /// Un documento disordinato — che comincia da un `h2` e salta un livello —
    /// non perde heading: «figlio» è *di livello maggiore*, non *di livello
    /// esattamente uno in più*.
    #[test]
    fn a_document_that_skips_levels_keeps_all_its_headings() {
        let tree = build_outline_view(
            &[
                h(2, "Due", 0, 5),
                h(4, "Quattro", 10, 15),
                h(3, "Tre", 20, 25),
                h(1, "Uno", 30, 35),
            ],
            None,
        );
        assert_eq!(
            voci(&tree)
                .into_iter()
                .map(|(d, l, _)| (d, l))
                .collect::<Vec<_>>(),
            vec![
                (0, "Due".to_string()),
                (1, "Quattro".to_string()),
                (1, "Tre".to_string()),
                (0, "Uno".to_string()),
            ]
        );
    }

    /// Le etichette selezionate, in ordine di lettura.
    fn selezionate(tree: &UiNode) -> Vec<String> {
        voci(tree)
            .into_iter()
            .filter(|(_, _, sel)| *sel)
            .map(|(_, l, _)| l)
            .collect()
    }

    #[test]
    fn the_caret_marks_the_section_it_is_in() {
        let headings = [h(1, "Uno", 0, 5), h(2, "Due", 20, 25), h(1, "Tre", 40, 45)];

        // Dentro la seconda sezione: dopo il suo heading, prima del terzo.
        assert_eq!(
            selezionate(&build_outline_view(&headings, Some(30))),
            ["Due"]
        );
        // Sull'heading stesso: la sezione è la sua.
        assert_eq!(
            selezionate(&build_outline_view(&headings, Some(40))),
            ["Tre"]
        );
        assert_eq!(
            selezionate(&build_outline_view(&headings, Some(0))),
            ["Uno"],
            "il byte 0 è l'inizio del primo heading: ci sta dentro"
        );
        // Nel preambolo, prima di ogni heading: nessuna sezione, non la prima.
        let dopo_preambolo = [h(1, "Uno", 10, 15)];
        assert!(
            selezionate(&build_outline_view(&dopo_preambolo, Some(3))).is_empty(),
            "il preambolo non appartiene alla sezione che lo segue"
        );
        // Nessun cursore (o buffer sporco): nessun segno.
        assert!(selezionate(&build_outline_view(&headings, None)).is_empty());
    }

    #[test]
    fn a_dirty_buffer_marks_nothing() {
        let host = MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 0, 5)]);
        host.set_active(Some("nota.md"));
        // Il cursore c'è, ma il buffer ha modifiche non salvate: lo span non
        // attraversa il confine, e la view non ha dove segnare.
        host.set_caret(None);
        let istanza = ViewInstance::only(OUTLINE_VIEW);
        let tree = OutlineView.render_view(&istanza, &host).unwrap();
        assert!(selezionate(&tree).is_empty());

        // Salvato: lo span torna vero, e il segno con lui.
        host.set_caret(Some(2));
        let tree = OutlineView.render_view(&istanza, &host).unwrap();
        assert_eq!(selezionate(&tree), ["Uno"]);
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        let host =
            MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 0, 5), h(2, "Due", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView
            .render_view(&ViewInstance::only(OUTLINE_VIEW), &host)
            .unwrap();
        assert_eq!(
            voci(&tree)
                .into_iter()
                .map(|(_, l, _)| l)
                .collect::<Vec<_>>(),
            ["Uno", "Due"]
        );
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder() {
        let host = MemoryHost::new();
        assert!(matches!(
            OutlineView
                .render_view(&ViewInstance::only(OUTLINE_VIEW), &host)
                .unwrap()
                .kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn clicking_a_heading_reveals_its_span_in_the_active_doc() {
        let mut host = MemoryHost::new();
        host.set_active(Some("nota.md"));
        let update = OutlineView
            .on_action(
                &ViewInstance::only(OUTLINE_VIEW),
                UiAction::new(REVEAL).with_payload(serde_json::json!({START: 10, END: 15})),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Reveal {
                doc_id: "nota.md".into(),
                span: Span::new(10, 15),
            }
        );
    }

    /// Un payload che non è quello che questa view attacca ai propri nodi non
    /// fa saltare niente — e non è un errore: è un click che non significa.
    #[test]
    fn a_payload_that_is_not_a_span_reveals_nothing() {
        let mut host = MemoryHost::new();
        host.set_active(Some("nota.md"));
        let update = OutlineView
            .on_action(
                &ViewInstance::only(OUTLINE_VIEW),
                UiAction::new(REVEAL).with_payload(serde_json::json!({"start": "dieci"})),
                &mut host,
            )
            .unwrap();
        assert_eq!(update, ViewUpdate::None);
    }
}
