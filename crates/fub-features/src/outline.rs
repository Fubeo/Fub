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

use std::collections::HashSet;

use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{DocId, Heading, Span};
use fub_abi::session::{ContextKind, ContextMask, SelectionSet};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};
use fub_format_markdown::{collect_footnotes, FootnoteKind, FootnoteOccurrence};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const OUTLINE_ID: &str = "fub.outline";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const OUTLINE_VIEW: &str = "outline";
/// The footnote projection shares this provider and its active document.
pub const FOOTNOTES_VIEW: &str = "footnotes";

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
const BASE: &str = "base";
const INDEX: &str = "index";
const MOVE_UP: &str = "move_up";
const MOVE_DOWN: &str = "move_down";
const FOOTNOTES_TITLE: &str = "footnotes_title";
const FOOTNOTES_EMPTY: &str = "footnotes_empty";
const REFERENCES: &str = "references";
const DEFINITIONS: &str = "definitions";
const ORPHANS: &str = "orphans";
const INLINE: &str = "inline";
const UP: &str = "up";
const DOWN: &str = "down";

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
        vec![
            ViewSpec::new(
                OUTLINE_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("struttura")
            .ordered(1)
            .open_by_default(),
            ViewSpec::new(
                FOOTNOTES_VIEW,
                Text::key(FOOTNOTES_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("footnote")
            .ordered(2),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(context) = host.active_context() else {
            return Ok(placeholder(NO_ACTIVE_DOC));
        };
        let Some(active) = context.doc else {
            return Ok(placeholder(NO_ACTIVE_DOC));
        };
        if instance.view == FOOTNOTES_VIEW {
            let markdown = host
                .format_of(&active)
                .is_some_and(|format| format.descriptor.id == "markdown");
            if !markdown {
                return Ok(placeholder(FOOTNOTES_EMPTY));
            }
            let base = host.document_revision(&active)?;
            let source = host.read_document(&active)?;
            let footnotes = collect_footnotes(&source)
                .map_err(|error| PluginError::BadArgs(error.to_string().into()))?;
            return Ok(build_footnotes_view(&footnotes, active.as_str(), &base.0));
        }
        let headings = match host.query_index(IndexQuery::Outline {
            doc: active.clone(),
        })? {
            IndexResult::Outline(h) => h,
            other => {
                return Err(PluginError::Internal(
                    format!("query outline: risposta fuori tema: {other:?}").into(),
                ));
            }
        };
        Ok(build_outline_view_at(
            &headings,
            caret_of(&context.selections),
            active.as_str(),
            Some(&host.document_revision(&active)?.0),
        ))
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if matches!(action.action.0.as_str(), MOVE_UP | MOVE_DOWN) {
            if instance.view != OUTLINE_VIEW {
                return Err(PluginError::BadArgs(
                    "Section moves belong to the outline.".into(),
                ));
            }
            move_section(&action, host)?;
            return Ok(ViewUpdate::Replace {
                root: self.render_view(instance, host)?,
            });
        }
        if action.action.0 != REVEAL {
            return Ok(ViewUpdate::None);
        }
        let Some(span) = payload_span(&action.payload) else {
            return Ok(ViewUpdate::None);
        };
        let Some(drawn) = action.payload.get(DOC).and_then(|v| v.as_str()) else {
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
            Some(active) if active.as_str() == drawn => {
                if let Some(base) = action.payload.get(BASE).and_then(|value| value.as_str()) {
                    if host.document_revision(&active)?.0 != base {
                        return Err(PluginError::Conflict("The shown span is stale.".into()));
                    }
                }
                Ok(ViewUpdate::Reveal {
                    doc_id: active.as_str().to_string(),
                    span,
                })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}
/// Adjacent sibling subtrees are swapped as one verified edit. The section
/// begins at its heading line and ends at the next heading of the same or a
/// shallower level; blank lines and child blocks travel with their section.
fn section_end(headings: &[Heading], index: usize) -> usize {
    let level = headings[index].level;
    (index + 1..headings.len())
        .find(|&next| headings[next].level <= level)
        .unwrap_or(headings.len())
}

fn sibling(headings: &[Heading], index: usize, up: bool) -> Option<usize> {
    let other = if up {
        (0..index)
            .rev()
            .find(|&candidate| headings[candidate].level <= headings[index].level)?
    } else {
        section_end(headings, index)
    };
    (other < headings.len() && headings[other].level == headings[index].level).then_some(other)
}

fn move_section(action: &UiAction, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let payload = &action.payload;
    let (Some(id), Some(base), Some(index), Some(span)) = (
        payload.get(DOC).and_then(|v| v.as_str()),
        payload.get(BASE).and_then(|v| v.as_str()),
        payload.get(INDEX).and_then(|v| v.as_u64()),
        payload_span(payload),
    ) else {
        return Err(PluginError::BadArgs("Invalid section move.".into()));
    };
    let index = usize::try_from(index)
        .map_err(|_| PluginError::BadArgs("Invalid section index.".into()))?;
    if host
        .active_context()
        .and_then(|c| c.doc)
        .as_ref()
        .map(DocId::as_str)
        != Some(id)
    {
        return Err(PluginError::Conflict("The active document changed.".into()));
    }
    let doc = DocId::new(id);
    let base = Revision::new(base);
    if host.document_revision(&doc)? != base {
        return Err(PluginError::Conflict("The outline is stale.".into()));
    }
    let model = host.read_model(&doc)?;
    let headings = &model.outline;
    if headings.get(index).map(|heading| heading.span) != Some(span) {
        return Err(PluginError::Conflict("The section changed.".into()));
    }
    let up = action.action.0 == MOVE_UP;
    let neighbor = sibling(headings, index, up)
        .ok_or_else(|| PluginError::BadArgs("Sections must be adjacent siblings.".into()))?;
    let first = index.min(neighbor);
    let second = index.max(neighbor);
    if section_end(headings, first) != second {
        return Err(PluginError::BadArgs("Sections overlap.".into()));
    }
    let source = host.read_document(&doc)?;
    let a = headings[first].span.start;
    let b = headings[second].span.start;
    let c = headings
        .get(section_end(headings, second))
        .map_or(source.len(), |h| h.span.start);
    // Non-root headings (e.g. in quotes/lists), invalid parser positions, or
    // cuts in the middle of a CRLF are not safe to move as whole source lines.
    let line_start = |offset: usize| {
        offset == 0
            || (source.starts_with('\u{feff}') && offset == '\u{feff}'.len_utf8())
            || source.as_bytes().get(offset - 1) == Some(&b'\n')
    };
    if !(a < b
        && b < c
        && c <= source.len()
        && [a, b, c].into_iter().all(|at| source.is_char_boundary(at))
        && [a, b].into_iter().all(line_start)
        && (c == source.len() || line_start(c))
        && headings[first].span.end <= b
        && headings[second].span.end <= c)
    {
        return Err(PluginError::BadArgs(
            "Section boundaries are invalid.".into(),
        ));
    }
    let replacement = format!("{}{}", &source[b..c], &source[a..b]);
    host.apply_edit(
        &doc,
        EditRequest::new(base, vec![TextEdit::replace(Span::new(a, c), replacement)]),
    )?;
    Ok(())
}

/// The footnote view groups each source occurrence by its actual role, not by
/// a text search: fenced code, HTML and escaped markers never enter this list.
fn build_footnotes_view(occurrences: &[FootnoteOccurrence], doc: &str, base: &str) -> UiNode {
    if occurrences.is_empty() {
        return placeholder(FOOTNOTES_EMPTY);
    }
    let defined: HashSet<String> = occurrences
        .iter()
        .filter_map(|item| match &item.kind {
            FootnoteKind::Definition(label) => Some(label.to_lowercase()),
            _ => None,
        })
        .collect();
    let used: HashSet<String> = occurrences
        .iter()
        .filter_map(|item| match &item.kind {
            FootnoteKind::Reference(label) => Some(label.to_lowercase()),
            _ => None,
        })
        .collect();
    let mut references = Vec::new();
    let mut definitions = Vec::new();
    let mut orphans = Vec::new();
    let mut inline = Vec::new();
    for item in occurrences {
        let (label, role, bucket) = match &item.kind {
            FootnoteKind::Reference(label) if defined.contains(&label.to_lowercase()) => {
                (label.as_str(), REFERENCES, &mut references)
            }
            FootnoteKind::Definition(label) if used.contains(&label.to_lowercase()) => {
                (label.as_str(), DEFINITIONS, &mut definitions)
            }
            FootnoteKind::Reference(label) => (label.as_str(), REFERENCES, &mut orphans),
            FootnoteKind::Definition(label) => (label.as_str(), DEFINITIONS, &mut orphans),
            FootnoteKind::Inline(label) => (label.as_str(), INLINE, &mut inline),
        };
        bucket.push(UiNode::new(UiKind::ListItem {
            title: label.into(),
            subtitle: Some(Text::key(role)),
            action: Some(ActionRef::with(
                REVEAL,
                serde_json::json!({ DOC: doc, BASE: base, START: item.span.start, END: item.span.end }),
            )),
            selected: false,
        }));
    }
    let mut sections = Vec::new();
    for (key, items) in [
        (REFERENCES, references),
        (DEFINITIONS, definitions),
        (ORPHANS, orphans),
        (INLINE, inline),
    ] {
        if !items.is_empty() {
            sections.push(UiNode::new(UiKind::Section {
                title: Text::key(key),
                collapsed: false,
                children: vec![UiNode::new(UiKind::List { items })],
            }));
        }
    }
    UiNode::column(2, sections)
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
    let start = usize::try_from(payload.get(START)?.as_u64()?).ok()?;
    let end = usize::try_from(payload.get(END)?.as_u64()?).ok()?;
    (start <= end).then(|| Span::new(start, end))
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
            .with(FOOTNOTES_TITLE, "Note a piè di pagina")
            .with(FOOTNOTES_EMPTY, "Nessuna nota a piè di pagina.")
            .with(REFERENCES, "Riferimenti")
            .with(DEFINITIONS, "Definizioni")
            .with(ORPHANS, "Orfani")
            .with(INLINE, "Note inline")
            .with(UP, "Su")
            .with(DOWN, "Giù")
            .with("reorder", "Riordina sezioni")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessun heading."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Outline")
            .with(FOOTNOTES_TITLE, "Footnotes")
            .with(FOOTNOTES_EMPTY, "No footnotes.")
            .with(REFERENCES, "References")
            .with(DEFINITIONS, "Definitions")
            .with(ORPHANS, "Orphans")
            .with(INLINE, "Inline notes")
            .with(UP, "Up")
            .with(DOWN, "Down")
            .with("reorder", "Reorder sections")
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
        .map(|(the, _)| the)
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
    build_outline_view_at(headings, caret, doc, None)
}

fn build_outline_view_at(
    headings: &[Heading],
    caret: Option<usize>,
    doc: &str,
    base: Option<&str>,
) -> UiNode {
    if headings.is_empty() {
        return placeholder(EMPTY);
    }
    let current = caret.and_then(|c| section_of(headings, c));
    let (roots, _) = subtree(headings, 0, 0, current, doc, base);
    let mut children = vec![UiNode::new(UiKind::Tree { roots })];
    if let Some(base) = base {
        let mut rows = Vec::new();
        for (index, heading) in headings.iter().enumerate() {
            let mut buttons = vec![UiNode::text(heading.text.clone())];
            for (up, label, id) in [(true, UP, MOVE_UP), (false, DOWN, MOVE_DOWN)] {
                if sibling(headings, index, up).is_some() {
                    buttons.push(UiNode::button(
                        Text::key(label),
                        Intent::Neutral,
                        ActionRef::with(
                            id,
                            serde_json::json!({
                                DOC: doc,
                                BASE: base,
                                INDEX: index,
                                START: heading.span.start,
                                END: heading.span.end,
                            }),
                        ),
                    ));
                }
            }
            if buttons.len() > 1 {
                rows.push(UiNode::row(1, buttons).with_key(heading.slug.clone()));
            }
        }
        if !rows.is_empty() {
            children.push(UiNode::new(UiKind::Section {
                title: Text::key("reorder"),
                collapsed: true,
                children: rows,
            }));
        }
    }
    UiNode::column(2, children)
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
    current: Option<usize>,
    doc: &str,
    base: Option<&str>,
) -> (Vec<UiNode>, usize) {
    let mut nodes = Vec::new();
    let mut the = at;
    while let Some(h) = headings.get(the) {
        if h.level <= parent_level {
            break;
        }
        let (children, next) = subtree(headings, the + 1, h.level, current, doc, base);
        nodes.push(
            UiNode::new(UiKind::TreeItem {
                label: h.text.clone().into(),
                // Aperto: un outline che nasce chiuso non è un outline.
                expanded: true,
                action: Some(ActionRef::with(
                    REVEAL,
                    serde_json::json!({ DOC: doc, BASE: base, START: h.span.start, END: h.span.end }),
                )),
                selected: Some(the) == current,
                children,
            })
            // La chiave è lo slug dell'heading, che è la sua identità stabile
            // nel documento — non la posizione, che cambia a ogni riga scritta
            // sopra di lui.
            .with_key(h.slug.clone()),
        );
        the = next;
    }
    (nodes, the)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::{VaultRead, VaultWrite};
    use fub_sdk::testing::MemoryHost;

    fn h(level: u8, text: &str, start: usize, end: usize) -> Heading {
        Heading {
            level,
            text: text.to_string(),
            slug: text.to_lowercase(),
            span: Span::new(start, end),
            explicit_anchor: None,
        }
    }

    /// Le voci dell'albero, in ordine di lettura, con il loro livello di
    /// annidamento: `(profondità, etichetta, selezionata)`.
    fn entries(tree: &UiNode) -> Vec<(usize, String, bool)> {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("l'outline è uno stack")
        };
        let UiKind::Tree { roots } = &children[0].kind else {
            panic!("the first child is the tree")
        };
        fn descend(nodes: &[UiNode], depth: usize, out: &mut Vec<(usize, String, bool)>) {
            for n in nodes {
                let UiKind::TreeItem {
                    label,
                    selected,
                    children,
                    ..
                } = &n.kind
                else {
                    panic!("a tree item is a tree-item")
                };
                out.push((depth, label.to_string(), *selected));
                descend(children, depth + 1, out);
            }
        }
        let mut out = Vec::new();
        descend(roots, 0, &mut out);
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
            entries(&tree),
            vec![
                (0, "Titolo".to_string(), false),
                (1, "Sezione".to_string(), false),
            ],
            "the level is nesting, not title indentation"
        );
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains(r#""start":20"#) && json.contains(r#""end":30"#));
        assert!(
            !json.contains("reveal:"),
            "the id no longer carries concatenated data"
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
            entries(&tree)
                .into_iter()
                .map(|(d, the, _)| (d, the))
                .collect::<Vec<_>>(),
            vec![
                (0, "Due".to_string()),
                (1, "Quattro".to_string()),
                (1, "Tre".to_string()),
                (0, "Uno".to_string()),
            ]
        );
    }

    /// Le etichette selected_labels, in ordine di lettura.
    fn selected_labels(tree: &UiNode) -> Vec<String> {
        entries(tree)
            .into_iter()
            .filter(|(_, _, sel)| *sel)
            .map(|(_, the, _)| the)
            .collect()
    }

    #[test]
    fn the_caret_marks_the_section_it_is_in() {
        let headings = [h(1, "Uno", 0, 5), h(2, "Due", 20, 25), h(1, "Tre", 40, 45)];

        // Dentro la seconda sezione: dopo il suo heading, prima del terzo.
        assert_eq!(
            selected_labels(&build_outline_view(&headings, Some(30), "nota.md")),
            ["Due"]
        );
        // Sull'heading stesso: la sezione è la sua.
        assert_eq!(
            selected_labels(&build_outline_view(&headings, Some(40), "nota.md")),
            ["Tre"]
        );
        assert_eq!(
            selected_labels(&build_outline_view(&headings, Some(0), "nota.md")),
            ["Uno"],
            "il byte 0 è l'inizio del primo heading: ci sta dentro"
        );
        // Nel preambolo, prima di ogni heading: nessuna sezione, non la prima.
        let after_preambolo = [h(1, "Uno", 10, 15)];
        assert!(
            selected_labels(&build_outline_view(&after_preambolo, Some(3), "nota.md")).is_empty(),
            "il preambolo non appartiene alla sezione che lo segue"
        );
        // Nessun cursore (o buffer sporco): nessun segno.
        assert!(selected_labels(&build_outline_view(&headings, None, "nota.md")).is_empty());
    }

    #[test]
    fn a_dirty_buffer_marks_nothing() {
        let host = MemoryHost::new()
            .with_document("nota.md", "# Uno\n")
            .with_outline("nota.md", &[h(1, "Uno", 0, 5)]);
        host.set_active(Some("nota.md"));
        // Il cursore c'è, ma il buffer ha modifiche non salvate: lo span non
        // attraversa il confine, e la view non ha dove segnare.
        host.set_caret(None);
        let instance = ViewInstance::only(OUTLINE_VIEW);
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        assert!(selected_labels(&tree).is_empty());

        // Salvato: lo span torna vero, e il segno con lui.
        host.set_caret(Some(2));
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        assert_eq!(selected_labels(&tree), ["Uno"]);
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        let host = MemoryHost::new()
            .with_document("nota.md", "# Uno\n\n## Due\n")
            .with_outline("nota.md", &[h(1, "Uno", 0, 5), h(2, "Due", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView
            .render_view(&ViewInstance::only(OUTLINE_VIEW), &host)
            .unwrap();
        assert_eq!(
            entries(&tree)
                .into_iter()
                .map(|(_, the, _)| the)
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
        let host = MemoryHost::new()
            .with_document("nota.md", "preambolo\n# Uno\n")
            .with_outline("nota.md", &[h(1, "Uno", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView
            .render_view(&ViewInstance::only(OUTLINE_VIEW), &host)
            .unwrap();
        let action = first_action(&tree).expect("l'albero ha un'azione");
        assert_eq!(
            action.payload.get(DOC).and_then(|v| v.as_str()),
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
    fn first_action(node: &UiNode) -> Option<&ActionRef> {
        if let UiKind::TreeItem {
            action, children, ..
        } = &node.kind
        {
            if let Some(a) = action {
                return Some(a);
            }
            for c in children {
                if let Some(a) = first_action(c) {
                    return Some(a);
                }
            }
        }
        for c in node.children() {
            if let Some(a) = first_action(c) {
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

    fn seeded_markdown(source: &str) -> MemoryHost {
        use fub_abi::format::ParseContext;
        use fub_abi::FormatProvider;
        let model = fub_format_markdown::MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian("nota.md"))
            .unwrap();
        let outline = model.outline.clone();
        let host = MemoryHost::new()
            .with_document("nota.md", source)
            .with_outline("nota.md", &outline)
            .with_model("nota.md", model);
        host.set_active(Some("nota.md"));
        host
    }

    fn action_named(node: &UiNode, id: &str, index: usize) -> Option<UiAction> {
        match &node.kind {
            UiKind::Button { action, .. }
                if action.action.0 == id
                    && action.payload.get(INDEX).and_then(|v| v.as_u64()) == Some(index as u64) =>
            {
                return Some(UiAction::new(id).with_payload(action.payload.clone()));
            }
            _ => {}
        }
        node.children()
            .iter()
            .find_map(|child| action_named(child, id, index))
    }

    #[test]
    fn nested_section_move_preserves_all_unmoved_bytes_and_crlf() {
        let before = "---\r\ntitle: été\r\n---\r\n\r\n# Uno\r\nintro\r\n## À\r\nA\r\n### Sotto\r\nx\r\n## B\r\nB\r\n```md\r\n## Ignora\r\n```\r\n# Due\r\nfine\r\n";
        let after = "---\r\ntitle: été\r\n---\r\n\r\n# Uno\r\nintro\r\n## B\r\nB\r\n```md\r\n## Ignora\r\n```\r\n## À\r\nA\r\n### Sotto\r\nx\r\n# Due\r\nfine\r\n";
        let mut host = seeded_markdown(before);
        let instance = ViewInstance::only(OUTLINE_VIEW);
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        let action = action_named(&tree, MOVE_DOWN, 1).expect("nested sibling can move down");
        assert!(matches!(
            OutlineView.on_action(&instance, action, &mut host).unwrap(),
            ViewUpdate::Replace { .. }
        ));
        assert_eq!(host.read_document(&DocId::new("nota.md")).unwrap(), after);
    }

    #[test]
    fn stale_and_non_sibling_section_moves_are_typed_and_do_not_write() {
        use fub_abi::edit::WriteBase;
        let before = "# Uno\n## A\n### Figlio\n## B\n# Due\n";
        let mut host = seeded_markdown(before);
        let instance = ViewInstance::only(OUTLINE_VIEW);
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        let action = action_named(&tree, MOVE_DOWN, 1).unwrap();
        host.write_document(&DocId::new("nota.md"), "# Altro\n", WriteBase::Dictated)
            .unwrap();
        assert!(matches!(
            OutlineView.on_action(&instance, action, &mut host),
            Err(PluginError::Conflict(_))
        ));
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "# Altro\n"
        );

        let mut host = seeded_markdown(before);
        let revision = host.document_revision(&DocId::new("nota.md")).unwrap();
        let model = host.read_model(&DocId::new("nota.md")).unwrap();
        let headings = &model.outline;
        let forged = UiAction::new(MOVE_DOWN).with_payload(serde_json::json!({
            DOC: "nota.md", BASE: revision.0.clone(), INDEX: 2,
            START: headings[2].span.start, END: headings[2].span.end,
        }));
        assert!(matches!(
            OutlineView.on_action(&instance, forged, &mut host),
            Err(PluginError::BadArgs(_))
        ));
        let wrong_span = UiAction::new(MOVE_DOWN).with_payload(serde_json::json!({
            DOC: "nota.md", BASE: revision.0, INDEX: 1,
            START: headings[1].span.start + 1, END: headings[1].span.end,
        }));
        assert!(matches!(
            OutlineView.on_action(&instance, wrong_span, &mut host),
            Err(PluginError::Conflict(_))
        ));
        assert_eq!(host.read_document(&DocId::new("nota.md")).unwrap(), before);
    }

    #[test]
    fn previously_drawn_reveal_rejects_changed_source_in_same_document() {
        use fub_abi::edit::WriteBase;
        let mut host = seeded_markdown("# Été\n\n## Segue\n");
        let instance = ViewInstance::only(OUTLINE_VIEW);
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        let action = first_action(&tree).unwrap();
        let click = UiAction::new(REVEAL).with_payload(action.payload.clone());
        host.write_document(
            &DocId::new("nota.md"),
            "preambolo\n# Été\n\n## Segue\n",
            WriteBase::Dictated,
        )
        .unwrap();
        assert!(matches!(
            OutlineView.on_action(&instance, click, &mut host),
            Err(PluginError::Conflict(_))
        ));
    }

    #[test]
    fn footnotes_view_reveals_utf8_byte_spans_and_groups_orphans() {
        let source = "# Été\nSee[^used] [^missing] and ^[emoji 🎯].\n\n[^used]: text\n[^alone]: text\n\n```\n[^code]\n```\n";
        let mut host = seeded_markdown(source);
        let instance = ViewInstance::only(FOOTNOTES_VIEW);
        let tree = OutlineView.render_view(&instance, &host).unwrap();
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("footnotes have sections")
        };
        let labels: Vec<&str> = children
            .iter()
            .filter_map(|node| match &node.kind {
                UiKind::Section {
                    title: Text::Message(message),
                    ..
                } => Some(message.key.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(labels, [REFERENCES, DEFINITIONS, ORPHANS, INLINE]);
        let inline = children
            .iter()
            .find_map(|node| match &node.kind {
                UiKind::Section {
                    title: Text::Message(message),
                    children,
                    ..
                } if message.key == INLINE => Some(&children[0]),
                _ => None,
            })
            .unwrap();
        let UiKind::List { items } = &inline.kind else {
            panic!("inline notes are list entries")
        };
        let UiKind::ListItem {
            action: Some(action),
            ..
        } = &items[0].kind
        else {
            panic!("inline note is actionable")
        };
        let start = source.find("^[emoji 🎯]").unwrap();
        assert_eq!(action.payload[START].as_u64(), Some(start as u64));
        assert_eq!(
            action.payload[END].as_u64(),
            Some((start + "^[emoji 🎯]".len()) as u64)
        );
        let update = OutlineView
            .on_action(
                &instance,
                UiAction::new(REVEAL).with_payload(action.payload.clone()),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Reveal {
                doc_id: "nota.md".into(),
                span: Span::new(start, start + "^[emoji 🎯]".len()),
            }
        );
    }
}
