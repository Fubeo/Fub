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
//! (insieme di selezioni non ancorato) gli offset del modello sono di un altro testo,
//! e segnare la sezione sbagliata è peggio che non segnarne nessuna.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{Heading, Span};
use fub_abi::session::{ContextKind, ContextMask, SelectionSet};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const OUTLINE_ID: &str = "fub.outline";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const OUTLINE_VIEW: &str = "outline";

/// L'azione di salto a un heading. L'intervallo viaggia nel payload
/// (`{"doc":…,"start":…,"end":…}`) e non concatenato nell'id (§2.7).
///
/// **Il documento viaggia con lui**, ed è il difetto 0047. Prima il payload
/// portava solo l'intervallo e `on_action` chiedeva il documento all'host: le due
/// metà di uno stesso salto venivano da due istanti diversi — gli offset dal
/// documento disegnato, l'id da quello attivo *adesso* — e fra i due ci sta il
/// tempo in cui l'albero vecchio è ancora sotto il dito di chi clicca, perché il
/// ridisegno che segue un cambio di documento arriva dopo.
const REVEAL: &str = "reveal";
/// Le tre chiavi del payload di [`REVEAL`].
const DOC: &str = "doc";
const START: &str = "start";
const END: &str = "end";

/// Il pannello struttura. Senza stato: heading e documento attivo li chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct OutlineView;

impl ViewProvider for OutlineView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Gli heading cambiano quando cambia il documento: `IndexUpdated`
            // copre ogni scrittura (anche quelle arrivate dal watcher).
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // Del contesto segue il documento (di chi è la struttura) e la
            // selezione (in quale sezione sta il cursore). Non la modalità: in
            // lettura la selezione sparisce, e sparisce con lei il segno.
            follows: ContextMask(vec![ContextKind::Document, ContextKind::Selection]),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            OUTLINE_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("struttura")
        .ordered(1)
        .open_by_default()]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(context) = host.active_context() else {
            return Ok(placeholder(NO_ACTIVE_DOC));
        };
        let Some(active) = context.doc else {
            return Ok(placeholder(NO_ACTIVE_DOC));
        };
        let headings = match host.query_index(IndexQuery::Outline {
            doc: active.clone(),
        })? {
            IndexResult::Outline(h) => h,
            other => {
                return Err(PluginError::Internal(
                    format!("query outline: risposta fuori tema: {other:?}").into(),
                ))
            }
        };
        Ok(build_outline_view(
            &headings,
            caret_of(&context.selections),
            active.as_str(),
        ))
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
        let Some(disegnato) = action.payload.get(DOC).and_then(|v| v.as_str()) else {
            return Ok(ViewUpdate::None);
        };
        // **Le due metà vengono dallo stesso istante, o non si va da nessuna
        // parte.** Il documento attivo può essere cambiato fra il disegno di
        // questo albero e il click: gli offset sono di quello disegnato, e
        // pagarli su un altro documento vuol dire portare chi legge in un punto
        // che non c'entra niente.
        //
        // Si **butta**, e non si porta con sé il documento vecchio: aprire
        // d'autorità la nota di prima è la risposta peggiore delle due, perché
        // porta via chi non ha chiesto di andarsene — e `ViewUpdate::Reveal` la
        // nota la apre, se non è aperta (`ui/intents.ts`). Un salto scaduto non
        // fa niente, e il click successivo — sull'albero giusto, che nel
        // frattempo è arrivato — lo fa.
        //
        // È la stessa scelta della 0134 sul lato shell, con l'identità al posto
        // del numero d'ordine: qui un contatore non servirebbe, perché ciò che
        // dice se la risposta è scaduta è già un dato del dominio.
        match host.active_context().and_then(|c| c.doc) {
            Some(attivo) if attivo.as_str() == disegnato => Ok(ViewUpdate::Reveal {
                doc_id: attivo.as_str().to_string(),
                span,
            }),
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// Dove sta il cursore, in byte del sorgente **che il kernel conosce**.
///
/// `None` in due casi che qui valgono lo stesso: non c'è selezione (modalità di
/// lettura, nessun documento) e l'insieme non è ancorato (il buffer ha
/// modifiche non salvate, quindi nessun offset di questo testo vale per
/// quello). Vedi [`SelectionSet`].
///
/// Con più cursori è quello della **primaria**: questa view evidenzia la
/// sezione in cui ci si trova, e in una sola ci si trova — evidenziarne tre
/// direbbe «sei in tre posti», che è vero della selezione e falso di dove sta
/// guardando chi legge la struttura. È la stessa ragione per cui l'editor
/// stesso ha una primaria.
fn caret_of(selections: &Option<SelectionSet>) -> Option<usize> {
    Some(selections.as_ref()?.placed()?.primary.span.start)
}

/// `{"start":…,"end":…}` → `Span`, o `None` se il payload non è quello che
/// questa view ha attaccato al nodo.
fn payload_span(payload: &serde_json::Value) -> Option<Span> {
    let start = payload.get(START)?.as_u64()? as usize;
    let end = payload.get(END)?.as_u64()? as usize;
    Some(Span::new(start, end))
}

/// Il segnaposto. Prende una **chiave**, non una stringa: la prosa sta nel
/// [`catalog`], che è dato di manifest e non codice.
fn placeholder(key: &str) -> UiNode {
    UiNode::empty_state(Text::key(key))
}

/// Il titolo del pannello, che è testo come il resto di ciò che ci sta dentro.
/// Era l'unica stringa di questo file a stare in una `ViewSpec` invece che in un
/// `UiNode`, ed è quella che si vede sempre — anche quando il pannello è vuoto.
const VIEW_TITLE: &str = "view_title";
/// Nessuna nota aperta: non è un errore, è uno stato.
const NO_ACTIVE_DOC: &str = "no_active_doc";
/// La nota aperta non ha heading.
const EMPTY: &str = "empty";

/// Le stringhe del pannello struttura. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Struttura")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessun heading."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Outline")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(EMPTY, "No headings."),
    ]
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
pub fn build_outline_view(headings: &[Heading], caret: Option<usize>, doc: &str) -> UiNode {
    if headings.is_empty() {
        return placeholder(EMPTY);
    }
    let corrente = caret.and_then(|c| section_of(headings, c));
    let (roots, _) = subtree(headings, 0, 0, corrente, doc);
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
    doc: &str,
) -> (Vec<UiNode>, usize) {
    let mut nodi = Vec::new();
    let mut i = at;
    while let Some(h) = headings.get(i) {
        if h.level <= parent_level {
            break;
        }
        let (children, next) = subtree(headings, i + 1, h.level, corrente, doc);
        nodi.push(
            UiNode::new(UiKind::TreeItem {
                label: h.text.clone().into(),
                // Aperto: un outline che nasce chiuso non è un outline.
                expanded: true,
                action: Some(ActionRef::with(
                    REVEAL,
                    serde_json::json!({ DOC: doc, START: h.span.start, END: h.span.end }),
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
    use fub_abi::model::Span;
    use fub_sdk::testing::MemoryHost;

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
            &build_outline_view(&[], None, "nota.md").kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn nested_headings_become_a_tree_and_carry_reveal_payloads() {
        let tree = build_outline_view(
            &[h(1, "Titolo", 0, 8), h(2, "Sezione", 20, 30)],
            None,
            "nota.md",
        );
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
            "nota.md",
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
            selezionate(&build_outline_view(&headings, Some(30), "nota.md")),
            ["Due"]
        );
        // Sull'heading stesso: la sezione è la sua.
        assert_eq!(
            selezionate(&build_outline_view(&headings, Some(40), "nota.md")),
            ["Tre"]
        );
        assert_eq!(
            selezionate(&build_outline_view(&headings, Some(0), "nota.md")),
            ["Uno"],
            "il byte 0 è l'inizio del primo heading: ci sta dentro"
        );
        // Nel preambolo, prima di ogni heading: nessuna sezione, non la prima.
        let dopo_preambolo = [h(1, "Uno", 10, 15)];
        assert!(
            selezionate(&build_outline_view(&dopo_preambolo, Some(3), "nota.md")).is_empty(),
            "il preambolo non appartiene alla sezione che lo segue"
        );
        // Nessun cursore (o buffer sporco): nessun segno.
        assert!(selezionate(&build_outline_view(&headings, None, "nota.md")).is_empty());
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
                UiAction::new(REVEAL)
                    .with_payload(serde_json::json!({DOC: "nota.md", START: 10, END: 15})),
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

    /// **Il documento sta nell'albero, non solo nella mano di chi lo scrive a
    /// mano in un banco.**
    ///
    /// Il banco qui sopra costruisce il payload da sé, quindi passerebbe verde
    /// anche se `render_view` il documento non ce lo mettesse — e sarebbe un
    /// presidio che prova metà di ciò che dichiara. Questo prende il payload
    /// **dall'albero disegnato**, che è l'unico modo di legare le due metà.
    #[test]
    fn the_drawn_tree_carries_the_document_it_was_drawn_from() {
        let host = MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView
            .render_view(&ViewInstance::only(OUTLINE_VIEW), &host)
            .unwrap();
        let azione = prima_azione(&tree).expect("l'albero ha un'azione");
        assert_eq!(
            azione.payload.get(DOC).and_then(|v| v.as_str()),
            Some("nota.md")
        );
    }

    /// **Un salto disegnato su un altro documento non porta via nessuno.**
    ///
    /// Il difetto 0047: gli offset sono di ciò che è disegnato, l'id lo si
    /// chiedeva all'host al momento del click, e fra i due ci sta la finestra in
    /// cui l'albero vecchio è ancora sotto il dito — il ridisegno che segue un
    /// cambio di documento arriva dopo. Ne usciva un `Reveal` con l'id di B e
    /// gli offset di A.
    ///
    /// Si butta invece di portarsi dietro A, e la ragione è che `ViewUpdate::Reveal`
    /// **apre** la nota se non è aperta: portarsi dietro il documento vecchio
    /// vorrebbe dire strappare via dalla nota B chi non ha chiesto di andarsene,
    /// che è la peggiore delle due risposte sbagliate.
    #[test]
    fn a_heading_clicked_after_the_document_changed_reveals_nothing() {
        let mut host = MemoryHost::new();
        host.set_active(Some("altra.md"));
        let update = OutlineView
            .on_action(
                &ViewInstance::only(OUTLINE_VIEW),
                // L'albero è quello di `nota.md`, l'attivo è `altra.md`.
                UiAction::new(REVEAL)
                    .with_payload(serde_json::json!({DOC: "nota.md", START: 10, END: 15})),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::None,
            "un salto scaduto non fa niente, e non porta via chi sta leggendo altro"
        );
    }

    /// La prima azione che si incontra scendendo l'albero.
    fn prima_azione(node: &UiNode) -> Option<&ActionRef> {
        if let UiKind::TreeItem {
            action, children, ..
        } = &node.kind
        {
            if let Some(a) = action {
                return Some(a);
            }
            for c in children {
                if let Some(a) = prima_azione(c) {
                    return Some(a);
                }
            }
        }
        for c in node.children() {
            if let Some(a) = prima_azione(c) {
                return Some(a);
            }
        }
        None
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
