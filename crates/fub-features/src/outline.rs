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

use std::collections::{HashMap, HashSet};

mod rename;
pub use rename::{OutlineCommands, HEADING_RENAME};

use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{custom_kind, Block, DocId, Heading, Inline, ListItem, Span};
use fub_abi::options::syntax;
use fub_abi::session::{ContextKind, ContextMask, SelectionSet};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    BacklinkRef, HostApi, IndexQuery, IndexResult, Page, Paged, ReadApi, ViewInstance,
    ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate, INSPECTOR_TAB_NS};

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
const FILTER: &str = "filter";
const FILTER_FIELD: &str = "outline_filter";
const FILTER_STATE: &str = "outline.filter";
const COLLAPSE: &str = "collapse";
const COLLAPSE_STATE: &str = "outline.collapsed";
const FILTER_LABEL: &str = "filter_label";
const COLLAPSE_ALL: &str = "collapse_all";
const EXPAND_ALL: &str = "expand_all";
const NO_MATCH: &str = "no_match";
/// La sezione «In entrata» sotto l'albero: chi punta alla nota aperta. La
/// chiave non è `incoming`, che è già della sezione dei Collegamenti.
pub const INCOMING_SECTION: &str = "outline-incoming";
/// Quante note in entrata si mostrano al più; le altre le conta «e altri N».
const INCOMING_SHOWN: u32 = 5;
const INCOMING_COUNT: &str = "incoming_count";
const INCOMING_MORE: &str = "incoming_more";
const A_COUNT: &str = "count";
/// Apre la nota di una riga «In entrata»: il documento viaggia nel payload
/// sotto [`DOC`], come nei Collegamenti.
const OPEN: &str = "open";
/// «e altri N»: porta alla scheda dei Collegamenti, che le elenca tutte.
const SHOW_INCOMING: &str = "show_incoming";
/// La scheda dell'ispettore che elenca tutti i collegamenti in entrata: l'id
/// della vista dei Collegamenti, scritto qui e non preso dalla feature. La
/// Struttura legge l'indice del kernel, e con `backlinks` spenta è la shell a
/// dire che quella scheda non c'è.
const LINKS_VIEW: &str = "backlinks";

/// Il pannello struttura. Senza stato: heading e documento attivo li chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct OutlineView;

impl ViewProvider for OutlineView {
    fn interests(&self, instance: &ViewInstance) -> ViewInterests {
        // Del contesto la struttura segue il documento (di chi è la struttura)
        // e la selezione (in quale sezione sta il cursore). Non la modalità: in
        // lettura la selezione sparisce, e sparisce con lei il segno. Le note
        // a piè di pagina non segnano il cursore: seguirlo le rileggeva e
        // riparsava a ogni pausa della tastiera.
        let follows = if instance.view == FOOTNOTES_VIEW {
            vec![ContextKind::Document]
        } else {
            vec![ContextKind::Document, ContextKind::Selection]
        };
        ViewInterests {
            // Gli heading cambiano quando cambia il documento: `IndexUpdated`
            // copre ogni scrittura (anche quelle arrivate dal watcher).
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask(follows),
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
            // Le note le legge il formato: la vista chiede solo se ne ha, e le
            // trova nel modello come `custom_kind` registrati.
            if !crate::formats::understands(host, &active, syntax::FOOTNOTES) {
                return Ok(placeholder(FOOTNOTES_EMPTY));
            }
            let base = host.document_revision(&active)?;
            let footnotes = footnotes_of(&host.read_model(&active)?.body);
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
        let incoming = incoming_of(host, &active);
        let tools = Tools {
            filter: host
                .view_state(FILTER_STATE)?
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            collapsed: host
                .view_state(COLLAPSE_STATE)?
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        };
        Ok(build_outline_view_at(
            &headings,
            caret_of(&context.selections),
            active.as_str(),
            Some(&host.document_revision(&active)?.0),
            Some(&tools),
            incoming,
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
        if instance.view == OUTLINE_VIEW && matches!(action.action.0.as_str(), FILTER | COLLAPSE) {
            if action.action.0 == FILTER {
                let value = action.text_field(FILTER_FIELD).unwrap_or_default();
                host.set_view_state(
                    FILTER_STATE,
                    (!value.trim().is_empty()).then(|| serde_json::json!(value)),
                )?;
            } else {
                let collapsed = host
                    .view_state(COLLAPSE_STATE)?
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                host.set_view_state(
                    COLLAPSE_STATE,
                    (!collapsed).then(|| serde_json::json!(true)),
                )?;
            }
            return Ok(ViewUpdate::Replace {
                root: self.render_view(instance, host)?,
            });
        }
        if instance.view == OUTLINE_VIEW && action.action.0 == OPEN {
            return Ok(match action.payload.get(DOC).and_then(|v| v.as_str()) {
                Some(id) => ViewUpdate::Navigate {
                    doc_id: id.to_string(),
                },
                None => ViewUpdate::None,
            });
        }
        if instance.view == OUTLINE_VIEW && action.action.0 == SHOW_INCOMING {
            return Ok(ViewUpdate::Custom {
                ns: INSPECTOR_TAB_NS.to_string(),
                payload: serde_json::json!({ "view": LINKS_VIEW }),
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

/// Il ruolo di una nota nel sorgente. Le note in linea portano la definizione
/// dove stanno; richiami e definizioni con etichetta si ritrovano per
/// etichetta.
#[derive(Clone, Debug, PartialEq, Eq)]
enum FootnoteKind {
    Reference(String),
    Definition(String),
    Inline(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FootnoteOccurrence {
    kind: FootnoteKind,
    span: Span,
}

/// Le note del modello, in ordine di sorgente: le definizioni sono
/// `custom_kind::FOOTNOTE_DEFINITION`, i richiami (anche in linea)
/// `custom_kind::FOOTNOTE_REFERENCE`. Codice, HTML e marcatori sotto escape non
/// ci arrivano: li ha già scartati il parse del formato.
fn footnotes_of(body: &[Block]) -> Vec<FootnoteOccurrence> {
    let mut found = Vec::new();
    blocks_footnotes(body, &mut found);
    found.sort_by_key(|item| (item.span.start, item.span.end));
    found.dedup_by(|right, left| right.span == left.span);
    found
}

fn label_of(attrs: &serde_json::Value) -> Option<String> {
    attrs
        .get("label")
        .and_then(|label| label.as_str())
        .map(str::to_string)
}

fn blocks_footnotes(blocks: &[Block], out: &mut Vec<FootnoteOccurrence>) {
    for block in blocks {
        match block {
            Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => {
                inlines_footnotes(inlines, out);
            }
            Block::List { items, .. } => {
                for ListItem { blocks, .. } in items {
                    blocks_footnotes(blocks, out);
                }
            }
            Block::Quote { blocks, .. } => blocks_footnotes(blocks, out),
            Block::Custom {
                custom_kind: kind,
                attrs,
                blocks,
                span,
                ..
            } => {
                if kind == custom_kind::FOOTNOTE_DEFINITION {
                    if let Some(label) = label_of(attrs) {
                        out.push(FootnoteOccurrence {
                            kind: FootnoteKind::Definition(label),
                            span: *span,
                        });
                    }
                }
                blocks_footnotes(blocks, out);
            }
            Block::Table { head, rows, .. } => {
                for row in head.iter().chain(rows) {
                    for cell in &row.cells {
                        inlines_footnotes(&cell.inlines, out);
                    }
                }
            }
            _ => {}
        }
    }
}

fn inlines_footnotes(inlines: &[Inline], out: &mut Vec<FootnoteOccurrence>) {
    for inline in inlines {
        match inline {
            Inline::Custom {
                custom_kind: kind,
                attrs,
                span,
            } if kind == custom_kind::FOOTNOTE_REFERENCE => {
                let Some(label) = label_of(attrs) else {
                    continue;
                };
                let inline = attrs.get("inline").and_then(|value| value.as_bool()) == Some(true);
                out.push(FootnoteOccurrence {
                    kind: if inline {
                        FootnoteKind::Inline(label)
                    } else {
                        FootnoteKind::Reference(label)
                    },
                    span: *span,
                });
            }
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Superscript(children)
            | Inline::Subscript(children)
            | Inline::Strikethrough(children) => inlines_footnotes(children, out),
            _ => {}
        }
    }
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
    // Il comando che rinomina un titolo usa le frasi comuni del nome scritto
    // in un campo «Documento» e dell'errore di formato.
    crate::formats::speaking(vec![
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
            .with(FILTER_LABEL, "Cerca nei titoli")
            .with(COLLAPSE_ALL, "Comprimi tutto")
            .with(EXPAND_ALL, "Espandi tutto")
            .with(NO_MATCH, "Nessun titolo corrisponde.")
            .with(INCOMING_COUNT, "In entrata · {count}")
            .with(INCOMING_MORE, "e altri {count}")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessun heading.")
            .with("heading.rename.title", "Rinomina titolo")
            .with(
                "heading.rename.desc",
                "Rinomina un titolo della nota e aggiorna i link [[nota#titolo]] che lo nominano.",
            )
            .with("heading.rename.doc.title", "Nota")
            .with(
                "heading.rename.doc.desc",
                "La nota del titolo; senza, quella aperta.",
            )
            .with("heading.rename.heading.title", "Titolo")
            .with(
                "heading.rename.heading.desc",
                "Il titolo da rinominare, com'è scritto.",
            )
            .with("heading.rename.new_heading.title", "Nuovo titolo")
            .with(
                "heading.rename.new_heading.desc",
                "Il testo nuovo del titolo.",
            )
            .with(
                rename::P_RENAME,
                "«{heading}» diventa «{new_heading}»: link aggiornati in {count} altre note.",
            )
            .with(
                rename::U_RENAME,
                "Rinomina di «{heading}» in «{new_heading}»",
            )
            .with(rename::E_NO_DOC, "Nessuna nota a cui rinominare il titolo.")
            .with(
                rename::E_MISSING,
                "Nessun titolo «{heading}» in questa nota.",
            )
            .with(
                rename::E_INVALID,
                "Il titolo nuovo è vuoto o contiene [ ] | # ^.",
            )
            .with(
                rename::E_SAME,
                "Il titolo nuovo è uguale a quello di adesso.",
            )
            .with(
                rename::E_FORMATTED,
                "«{heading}» ha formattazione nel testo: rinominalo a mano.",
            )
            .with(
                rename::E_TAKEN,
                "Un titolo precedente si chiama già «{new_heading}»: i link andrebbero a quello.",
            )
            .with(
                rename::E_SLUGS,
                "Con «{new_heading}» cambierebbe l'indirizzo di un titolo omonimo.",
            ),
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
            .with(FILTER_LABEL, "Search headings")
            .with(COLLAPSE_ALL, "Collapse all")
            .with(EXPAND_ALL, "Expand all")
            .with(NO_MATCH, "No heading matches.")
            .with(INCOMING_COUNT, "Incoming · {count}")
            .with(INCOMING_MORE, "and {count} more")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(EMPTY, "No headings.")
            .with("heading.rename.title", "Rename heading")
            .with(
                "heading.rename.desc",
                "Rename a heading of the note and update the [[note#heading]] links that name it.",
            )
            .with("heading.rename.doc.title", "Note")
            .with(
                "heading.rename.doc.desc",
                "The note of the heading; without it, the open one.",
            )
            .with("heading.rename.heading.title", "Heading")
            .with(
                "heading.rename.heading.desc",
                "The heading to rename, as written.",
            )
            .with("heading.rename.new_heading.title", "New heading")
            .with(
                "heading.rename.new_heading.desc",
                "The new text of the heading.",
            )
            .with(
                rename::P_RENAME,
                "“{heading}” becomes “{new_heading}”: links updated in {count} other notes.",
            )
            .with(rename::U_RENAME, "Rename of “{heading}” to “{new_heading}”")
            .with(rename::E_NO_DOC, "No note to rename the heading in.")
            .with(rename::E_MISSING, "No heading “{heading}” in this note.")
            .with(
                rename::E_INVALID,
                "The new heading is empty or contains [ ] | # ^.",
            )
            .with(
                rename::E_SAME,
                "The new heading is the same as the current one.",
            )
            .with(
                rename::E_FORMATTED,
                "“{heading}” has formatting in its text: rename it by hand.",
            )
            .with(
                rename::E_TAKEN,
                "An earlier heading is already called “{new_heading}”: links would go there.",
            )
            .with(
                rename::E_SLUGS,
                "With “{new_heading}” the address of a same-named heading would change.",
            ),
    ])
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
    build_outline_view_at(headings, caret, doc, None, None, None)
}

/// Le note che puntano a `doc`, lette dall'indice del kernel e non dalla
/// feature dei Collegamenti: con quella spenta la sezione c'è lo stesso.
///
/// Una lettura sola, con la finestra delle righe che si mostrano: la Struttura
/// segue anche il cursore, e ogni sua pausa la rifà. Una lettura che fallisce
/// lascia la Struttura com'è, senza sezione: i titoli non dipendono da lei.
fn incoming_of(host: &dyn ReadApi, doc: &DocId) -> Option<UiNode> {
    match host.query_index(IndexQuery::Backlinks {
        target: doc.clone(),
        page: Some(Page {
            offset: 0,
            limit: INCOMING_SHOWN,
        }),
    }) {
        Ok(IndexResult::Backlinks(refs)) => build_incoming_section(&refs),
        _ => None,
    }
}

/// La sezione «In entrata · N»: al più [`INCOMING_SHOWN`] righe, una per
/// riferimento come nei Collegamenti (il nome della nota, e la sua cartella
/// come sottotitolo), poi «e altri N» se ce ne sono di più. Senza riferimenti
/// non c'è. Pura trasformazione dati→UI: si prova senza un host.
pub fn build_incoming_section(refs: &Paged<BacklinkRef>) -> Option<UiNode> {
    if refs.total == 0 {
        return None;
    }
    let mut nth: HashMap<&DocId, usize> = HashMap::new();
    let mut items: Vec<UiNode> = refs
        .items
        .iter()
        .take(INCOMING_SHOWN as usize)
        .map(|r| {
            // Una riga per riferimento: due link dalla stessa nota sono due
            // righe, e la chiave le tiene distinte fra fratelli.
            let n = nth.entry(&r.source).or_insert(0);
            let key = format!("{}#{n}", r.source.as_str());
            *n += 1;
            UiNode::list_item(
                r.source.page_name(),
                folder_of(&r.source).map(Text::from),
                Some(ActionRef::with(
                    OPEN,
                    serde_json::json!({ DOC: r.source.as_str() }),
                )),
            )
            .with_key(key)
            .dragging_document(r.source.clone())
        })
        .collect();
    let hidden = (refs.total as usize).saturating_sub(items.len());
    if hidden > 0 {
        items.push(
            UiNode::list_item(
                Text::message(INCOMING_MORE, vec![Arg::int(A_COUNT, hidden as i64)]),
                None,
                Some(ActionRef::new(SHOW_INCOMING)),
            )
            .with_key(SHOW_INCOMING),
        );
    }
    Some(UiNode::keyed(
        INCOMING_SECTION,
        UiKind::Section {
            title: Text::message(
                INCOMING_COUNT,
                vec![Arg::int(A_COUNT, i64::from(refs.total))],
            ),
            collapsed: false,
            children: vec![UiNode::list(items)],
        },
    ))
}

/// La cartella che contiene una nota, col suo nome e basta: è il sottotitolo
/// di una riga in una colonna stretta. La pagina di una cartella
/// (`X/_index.md`) si chiama come la cartella, quindi la sua è quella sopra.
/// Nella radice del vault non c'è una cartella da dire.
fn folder_of(doc: &DocId) -> Option<String> {
    let (mut dir, _) = doc.as_str().rsplit_once('/')?;
    if doc.is_folder_page() {
        dir = dir.rsplit_once('/')?.0;
    }
    Some(dir.rsplit('/').next().unwrap_or(dir).to_string())
}

/// Il filtro e la compressione del pannello: stato della vista, non della
/// nota, quindi restano quando si cambia nota.
struct Tools {
    filter: String,
    collapsed: bool,
}

/// Quali titoli restano con un filtro: quelli che lo contengono e i loro
/// antenati, perché un titolo senza la strada che porta a lui non si capisce.
fn kept_by(headings: &[Heading], filter: &str) -> Vec<bool> {
    let needle = filter.trim().to_lowercase();
    let mut kept: Vec<bool> = headings
        .iter()
        .map(|h| needle.is_empty() || h.text.to_lowercase().contains(&needle))
        .collect();
    for at in (0..headings.len()).rev() {
        if !kept[at] {
            continue;
        }
        let mut level = headings[at].level;
        for up in (0..at).rev() {
            if headings[up].level < level {
                kept[up] = true;
                level = headings[up].level;
            }
        }
    }
    kept
}

fn build_outline_view_at(
    headings: &[Heading],
    caret: Option<usize>,
    doc: &str,
    base: Option<&str>,
    tools: Option<&Tools>,
    incoming: Option<UiNode>,
) -> UiNode {
    if headings.is_empty() {
        // Una nota senza titoli può essere citata lo stesso: chi la cita si
        // vede anche qui.
        return match incoming {
            Some(section) => UiNode::column(2, vec![placeholder(EMPTY), section]),
            None => placeholder(EMPTY),
        };
    }
    let current = caret.and_then(|c| section_of(headings, c));
    let filter = tools.map_or("", |t| t.filter.as_str());
    let kept = kept_by(headings, filter);
    // Un filtro apre quello che trova: comprimere e cercare insieme
    // nasconderebbero proprio i titoli trovati.
    let shape = Shape {
        current,
        doc,
        base,
        kept: &kept,
        expanded: !filter.trim().is_empty() || !tools.is_some_and(|t| t.collapsed),
    };
    let (roots, _) = subtree(headings, 0, 0, &shape);
    let mut children = Vec::new();
    if let Some(tools) = tools {
        children.push(UiNode::row(
            1,
            vec![
                UiNode::new(UiKind::TextInput {
                    field: FILTER_FIELD.to_string(),
                    label: Some(Text::key(FILTER_LABEL)),
                    value: tools.filter.clone(),
                    placeholder: None,
                    action: Some(ActionRef::new(FILTER)),
                }),
                UiNode::button(
                    Text::key(if tools.collapsed {
                        EXPAND_ALL
                    } else {
                        COLLAPSE_ALL
                    }),
                    Intent::Neutral,
                    ActionRef::new(COLLAPSE),
                ),
            ],
        ));
    }
    if roots.is_empty() {
        children.push(placeholder(NO_MATCH));
    } else {
        children.push(UiNode::new(UiKind::Tree { roots }));
    }
    // Sotto l'albero, chi punta qui: si vede senza cambiare scheda.
    children.extend(incoming);
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
/// Quello che ogni voce dell'albero condivide: la sezione del cursore, il
/// documento disegnato, i titoli tenuti dal filtro e se le voci nascono aperte.
struct Shape<'a> {
    current: Option<usize>,
    doc: &'a str,
    base: Option<&'a str>,
    kept: &'a [bool],
    expanded: bool,
}

fn subtree(
    headings: &[Heading],
    at: usize,
    parent_level: u8,
    shape: &Shape<'_>,
) -> (Vec<UiNode>, usize) {
    let Shape {
        current, doc, base, ..
    } = *shape;
    let mut nodes = Vec::new();
    let mut the = at;
    while let Some(h) = headings.get(the) {
        if h.level <= parent_level {
            break;
        }
        let (children, next) = subtree(headings, the + 1, h.level, shape);
        if !shape.kept[the] {
            the = next;
            continue;
        }
        nodes.push(
            UiNode::new(UiKind::TreeItem {
                label: h.text.clone().into(),
                // Aperto: un outline che nasce chiuso non è un outline, se
                // non lo si chiede con «comprimi tutto».
                expanded: shape.expanded,
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
mod tests;
