//! Il pannello **outline** (struttura) come `ViewProvider`, secondo provider
//! vero dopo i backlink e sullo stesso giro.
//!
//! È il caso che ha portato nel contratto il **canale metadata**: una view non
//! ha un `FormatProvider` (è un plugin), quindi non può parsare un documento per
//! ricavarne gli heading. Li chiede al kernel — che il modello parsato ce l'ha —
//! con [`IndexQuery::Outline`], la stessa porta dei backlink
//! ([`HostApi::query_index`]). Il click su un heading torna come `on_action` e la
//! view risponde [`ViewUpdate::Reveal`], che la shell esegue portando l'editor
//! sull'intervallo. Nessun pezzo del giro è cablato nell'app.
//!
//! È anche il primo cliente della **selezione** nel contesto di sessione
//! ([`HostApi::active_context`]): la sezione in cui sta il cursore è segnata,
//! e lo è solo quando lo span è vero — a buffer sporco
//! ([`Selection::span`] assente) gli offset del modello sono di un altro testo,
//! e segnare la sezione sbagliata è peggio che non segnarne nessuna.

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::model::{Heading, Span};
use fubmd_abi::session::{ContextKind, ContextMask, Selection};
use fubmd_abi::traits::{HostApi, IndexQuery, IndexResult, ViewPlacement, ViewProvider, ViewSpec};
use fubmd_abi::ui::{ActionId, Axis, UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const OUTLINE_ID: &str = "fubmd.outline";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const OUTLINE_VIEW: &str = "outline";

/// Prefisso dell'azione di salto a un heading; porta l'intervallo in byte
/// (`start:end`) del titolo. Il documento è quello attivo — lo stesso di cui la
/// view mostra la struttura — e in `on_action` lo si chiede all'host, così un
/// path con caratteri strani non deve stare dentro l'`ActionId`.
const REVEAL: &str = "reveal:";

/// Un livello di rientro nel titolo, reso con uno spazio EM (i normali si
/// collassano nel DOM). L'albero `UiNode` non ha un campo "livello": la
/// gerarchia si vede così, in attesa di un eventuale `UiNode` ad albero.
const INDENT: &str = "\u{2003}";

/// Come si dice "il cursore è in questa sezione" con i nodi che il protocollo
/// ha: il sottotitolo di un `ListItem`. Un *evidenziato* vero vorrebbe una
/// nozione di elemento corrente in [`UiNode`] — che è roba del §1.2, non di
/// questo giro: qui la posizione attraversa il confine, che è la parte che
/// mancava.
const HERE: &str = "cursore qui";

/// Il pannello struttura. Senza stato: heading e documento attivo li chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct OutlineView;

impl ViewProvider for OutlineView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: OUTLINE_VIEW.to_string(),
            title: "Struttura".to_string(),
            placement: ViewPlacement::RightSidebar,
            // Gli heading cambiano quando cambia il documento: `IndexUpdated`
            // copre ogni scrittura (anche quelle arrivate dal watcher).
            refresh: EventMask(vec![EventKind::IndexUpdated]),
            // Del contesto segue il documento (di chi è la struttura) e la
            // selezione (in quale sezione sta il cursore). Non la modalità: in
            // lettura la selezione sparisce, e sparisce con lei il segno.
            follows: ContextMask(vec![ContextKind::Document, ContextKind::Selection]),
        }]
    }

    fn render_view(&self, _view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError> {
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
        &self,
        _view: &str,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // "reveal:START:END" → salta a quell'intervallo nel documento attivo.
        let Some(rest) = action.action.0.strip_prefix(REVEAL) else {
            return Ok(ViewUpdate::None);
        };
        let Some(span) = parse_span(rest) else {
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

/// `"start:end"` → `Span`, o `None` se malformato.
fn parse_span(s: &str) -> Option<Span> {
    let (start, end) = s.split_once(':')?;
    Some(Span::new(start.parse().ok()?, end.parse().ok()?))
}

fn placeholder(text: &str) -> UiNode {
    UiNode::Stack {
        dir: Axis::Column,
        gap: 4,
        children: vec![UiNode::Text {
            content: text.to_string(),
        }],
    }
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
pub fn build_outline_view(headings: &[Heading], caret: Option<usize>) -> UiNode {
    if headings.is_empty() {
        return placeholder("Nessun heading.");
    }
    let corrente = caret.and_then(|c| section_of(headings, c));

    let items = headings
        .iter()
        .enumerate()
        .map(|(i, h)| UiNode::ListItem {
            title: format!(
                "{}{}",
                INDENT.repeat(h.level.saturating_sub(1) as usize),
                h.text
            ),
            subtitle: (Some(i) == corrente).then(|| HERE.to_string()),
            action: Some(ActionId(format!("{REVEAL}{}:{}", h.span.start, h.span.end))),
        })
        .collect();

    UiNode::Stack {
        dir: Axis::Column,
        gap: 2,
        children: vec![UiNode::List { items }],
    }
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

    #[test]
    fn empty_shows_placeholder() {
        assert!(matches!(
            &build_outline_view(&[], None),
            UiNode::Stack { children, .. } if matches!(&children[0], UiNode::Text { .. })
        ));
    }

    #[test]
    fn nested_headings_are_indented_and_carry_reveal_actions() {
        let tree = build_outline_view(&[h(1, "Titolo", 0, 8), h(2, "Sezione", 20, 30)], None);
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains("Titolo"));
        // il secondo heading (livello 2) è rientrato di uno EM space
        assert!(json.contains(&format!("{INDENT}Sezione")));
        assert!(json.contains("reveal:0:8"));
        assert!(json.contains("reveal:20:30"));
    }

    /// I sottotitoli degli elementi, in ordine: è lì che finisce il segno
    /// della sezione corrente.
    fn subtitles(tree: &UiNode) -> Vec<Option<String>> {
        let UiNode::Stack { children, .. } = tree else {
            panic!("l'outline è uno stack")
        };
        let UiNode::List { items } = &children[0] else {
            panic!("il primo figlio è la lista")
        };
        items
            .iter()
            .map(|i| match i {
                UiNode::ListItem { subtitle, .. } => subtitle.clone(),
                other => panic!("elemento inatteso: {other:?}"),
            })
            .collect()
    }

    #[test]
    fn the_caret_marks_the_section_it_is_in() {
        let headings = [h(1, "Uno", 0, 5), h(2, "Due", 20, 25), h(1, "Tre", 40, 45)];

        // Dentro la seconda sezione: dopo il suo heading, prima del terzo.
        assert_eq!(
            subtitles(&build_outline_view(&headings, Some(30))),
            vec![None, Some(HERE.to_string()), None]
        );
        // Sull'heading stesso: la sezione è la sua.
        assert_eq!(
            subtitles(&build_outline_view(&headings, Some(40))),
            vec![None, None, Some(HERE.to_string())]
        );
        assert_eq!(
            subtitles(&build_outline_view(&headings, Some(0))),
            vec![Some(HERE.to_string()), None, None],
            "il byte 0 è l'inizio del primo heading: ci sta dentro"
        );
        // Nel preambolo, prima di ogni heading: nessuna sezione, non la prima.
        let dopo_preambolo = [h(1, "Uno", 10, 15)];
        assert_eq!(
            subtitles(&build_outline_view(&dopo_preambolo, Some(3))),
            vec![None],
            "il preambolo non appartiene alla sezione che lo segue"
        );
        // Nessun cursore (o buffer sporco): nessun segno.
        assert_eq!(
            subtitles(&build_outline_view(&headings, None)),
            vec![None, None, None]
        );
    }

    #[test]
    fn a_dirty_buffer_marks_nothing() {
        let host = MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 0, 5)]);
        host.set_active(Some("nota.md"));
        // Il cursore c'è, ma il buffer ha modifiche non salvate: lo span non
        // attraversa il confine, e la view non ha dove segnare.
        host.set_caret(None);
        let tree = OutlineView.render_view(OUTLINE_VIEW, &host).unwrap();
        assert_eq!(subtitles(&tree), vec![None]);

        // Salvato: lo span torna vero, e il segno con lui.
        host.set_caret(Some(2));
        let tree = OutlineView.render_view(OUTLINE_VIEW, &host).unwrap();
        assert_eq!(subtitles(&tree), vec![Some(HERE.to_string())]);
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        let host =
            MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 0, 5), h(2, "Due", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView.render_view(OUTLINE_VIEW, &host).unwrap();
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains("Uno"));
        assert!(json.contains("reveal:10:15"));
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder() {
        let host = MemoryHost::new();
        assert!(matches!(
            OutlineView.render_view(OUTLINE_VIEW, &host).unwrap(),
            UiNode::Stack { children, .. } if matches!(&children[0], UiNode::Text { .. })
        ));
    }

    #[test]
    fn clicking_a_heading_reveals_its_span_in_the_active_doc() {
        let mut host = MemoryHost::new();
        host.set_active(Some("nota.md"));
        let update = OutlineView
            .on_action(
                OUTLINE_VIEW,
                UiAction {
                    action: ActionId("reveal:10:15".into()),
                    payload: serde_json::Value::Null,
                },
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
}
