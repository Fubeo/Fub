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
//!
//! Le menzioni non collegate entranti si cercano nel testo delle note
//! (`QueryPredicate::Text`), che valuta soltanto la ricerca full-text
//! (`fub.search`). Il pannello non la richiede: senza di lei quella sezione
//! dice che la ricerca manca, e il resto del pannello funziona.
use fub_abi::command::{ParamKind, ParamSpec};
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::rules::path_policy::{check, Naming};
use std::collections::{BTreeSet, HashMap};

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{DocId, LinkTarget, PropertyScalar, PropertyValue, Span};
use fub_abi::query::{
    QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextField, TextMode, TextQuery,
};
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    BacklinkRef, DocumentMatch, Excerpts, HostApi, IndexQuery, IndexResult, LinkDirection, Page,
    PropertyEntry, PropertySelect, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const BACKLINKS_ID: &str = "fub.backlinks";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const BACKLINKS_VIEW: &str = "backlinks";
/// Vista leggera per incorporare i collegamenti nel documento aperto.
pub const BACKLINKS_INLINE_VIEW: &str = "document_links";

/// L'azione di navigazione emessa dai `ListItem` del pannello. L'id è **solo**
/// l'id (§2.7): quale documento aprire viaggia nel `payload` dell'[`ActionRef`],
/// sotto la chiave [`DOC`]. Prima era concatenato dentro l'id (`open:a/Uno.md`),
/// che funzionava e stava insegnando la stessa convenzione al provider
/// successivo.
const OPEN: &str = "open";
/// La chiave del payload che porta il `DocId` sorgente.
const DOC: &str = "doc";
/// L'azione esplicita che trasforma una menzione non collegata in un link: chi
/// la manda ha già letto la nota col testo in chiaro e sa dove scrivere.
const CONVERT: &str = "convert_to_link";
/// Il payload: la nota da modificare, la menzione da collegare, e — quando la
/// menzione non è un nome pagina chiaro — il bersaglio scelto; la base per la
/// concorrenza ottimistica.
const TARGET: &str = "target";
const MENTION: &str = "mention";
const BASE: &str = "base";
const START: &str = "start";
const END: &str = "end";
const PAGE_SIZE: u32 = 50;
const MAX_MENTION_BYTES: usize = 256 * 1024;
const OUTBOUND_UNLINKED: &str = "outbound_unlinked";
const FILTER_ACTION: &str = "filter";
const FILTER_STATE: &str = "query_filter";

/// Il pannello backlink. Senza stato: tutto ciò che gli serve lo chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct BacklinksView;

impl ViewProvider for BacklinksView {
    fn interests(&self, instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // I backlink invecchiano quando il grafo cambia: ogni modifica al
            // vault arriva come `IndexUpdated`.
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // …e quando cambia la nota guardata. Non dove ci si trova dentro: i
            // backlink di una nota sono gli stessi da ogni punto di essa, e
            // seguire la selezione qui sarebbe una query per battuta di tasto.
            follows: if instance.view == BACKLINKS_INLINE_VIEW {
                ContextMask::default()
            } else {
                ContextMask::document()
            },
        }
    }
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                BACKLINKS_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("backlink")
            .open_by_default(),
            ViewSpec::new(
                BACKLINKS_INLINE_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::Main,
            )
            .with_params(vec![ParamSpec::new(
                DOC,
                Text::key(VIEW_TITLE),
                ParamKind::Document,
            )
            .required()]),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let active = if instance.view == BACKLINKS_INLINE_VIEW {
            let raw = instance.text_param(DOC).ok_or_else(|| {
                PluginError::BadArgs("document_links requires a doc parameter".into())
            })?;
            check(raw, Naming::Existing).map_err(|fault| {
                PluginError::BadArgs(format!("invalid doc parameter: {fault}").into())
            })?;
            DocId::new(raw)
        } else {
            let Some(active) = host.active_context().and_then(|c| c.doc) else {
                return Ok(placeholder(NO_ACTIVE_DOC));
            };
            active
        };
        if instance.view == BACKLINKS_INLINE_VIEW {
            let incoming = match host.query_index(IndexQuery::Backlinks {
                target: active.clone(),
                page: None,
            })? {
                IndexResult::Backlinks(refs) => {
                    (refs.items.len(), build_backlinks_view(&refs.items))
                }
                other => return Err(unexpected("backlinks", &other)),
            };
            let (_, refs) = outgoing_refs(host, &active)?;
            return Ok(UiNode::column(
                4,
                vec![
                    part(INCOMING, INCOMING_COUNT, Ok(incoming)),
                    part(
                        OUTGOING,
                        OUTGOING_COUNT,
                        Ok((refs.len(), build_outgoing_view(&refs))),
                    ),
                ],
            ));
        }
        let incoming_result = host.query_index(IndexQuery::Backlinks {
            target: active.clone(),
            page: None,
        });
        let outgoing_result = outgoing_refs(host, &active);
        let incoming = part(
            INCOMING,
            INCOMING_COUNT,
            incoming_result
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|result| match result {
                    IndexResult::Backlinks(refs) => {
                        Ok((refs.items.len(), build_backlinks_view(&refs.items)))
                    }
                    other => Err(unexpected("backlinks", other)),
                }),
        );
        let outgoing = part(
            OUTGOING,
            OUTGOING_COUNT,
            outgoing_result
                .as_ref()
                .map_err(Clone::clone)
                .map(|(_, refs)| (refs.len(), build_outgoing_view(refs))),
        );
        let filter_result = filter_query(host);
        let unlinked = mentions(
            UNLINKED,
            UNLINKED_COUNT,
            (|| {
                let IndexResult::Backlinks(refs) = incoming_result? else {
                    return Err(PluginError::Internal(
                        "query backlink: risposta fuori tema".into(),
                    ));
                };
                let (targets, _) = outgoing_result.clone()?;
                let linked = refs
                    .items
                    .iter()
                    .map(|r| r.source.clone())
                    .chain(targets)
                    .collect::<BTreeSet<_>>();
                unlinked_mentions(host, &active, &linked, &filter_result.clone()?)
                    .map(|mentions| (mentions.len(), build_unlinked_view(&mentions)))
            })(),
        );
        let outbound_unlinked = part(
            OUTBOUND_UNLINKED,
            OUTBOUND_UNLINKED_COUNT,
            (|| {
                let (targets, _) = outgoing_result.clone()?;
                let linked = targets.into_iter().collect::<BTreeSet<_>>();
                outbound_unlinked_mentions(host, &active, &linked, &filter_result.clone()?)
                    .map(|mentions| (mentions.len(), build_unlinked_view(&mentions)))
            })(),
        );
        // Il filtro è un'espressione di query in JSON: uno strumento per chi
        // la sa scrivere, non la prima cosa del pannello. Sta in fondo, chiuso
        // finché non ce n'è uno attivo.
        let filter = filter_text(host)?;
        let mut filter_children = vec![UiNode::new(UiKind::TextInput {
            field: FILTER_STATE.to_string(),
            label: Some(Text::key(FILTER_STATE)),
            value: filter.clone(),
            placeholder: None,
            action: Some(ActionRef::new(FILTER_ACTION)),
        })
        .with_key(FILTER_STATE)];
        // Un filtro che non si legge lo dice accanto al campo, col punto in cui
        // si è fermato, invece di far fallire le sezioni con una frase generica.
        if let Err(PluginError::BadArgs(reason)) = &filter_result {
            filter_children.push(UiNode::failed(reason.clone(), None));
        }
        let filter_section = UiNode::keyed(
            FILTER_SECTION,
            UiKind::Section {
                title: Text::key(FILTER_SECTION),
                collapsed: filter.is_empty(),
                children: filter_children,
            },
        );
        Ok(UiNode::column(
            4,
            vec![
                incoming,
                outgoing,
                unlinked,
                outbound_unlinked,
                filter_section,
            ],
        ))
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if action.action.0 == CONVERT {
            return convert_to_link(&action, host);
        }
        if action.action.0 == FILTER_ACTION {
            let value = action.text_field(FILTER_STATE).unwrap_or_default();
            host.set_view_state(FILTER_STATE, (!value.is_empty()).then(|| value.into()))?;
            return Ok(ViewUpdate::Replace {
                root: self.render_view(instance, host)?,
            });
        }
        // L'unica altra azione del pannello è "apri la sorgente di un backlink",
        // e quale sia sta nel payload che il nodo si portava dietro.
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

/// Trasforma una menzione non collegata in un link al bersaglio, scritto dal
/// formato della nota (`[[bersaglio]]` in Markdown), con
/// `VaultWrite::apply_edit`, che `HostApi` espone via `VaultWrite` — nessuna
/// nuova porta, nessuna scrittura fuori contratto.
///
/// Il chiamante porta `doc` (la nota da modificare), `target` (il bersaglio
/// scelto), `mention` (il testo da collegare, in byte del sorgente corrente) e
/// `base` (la revisione su cui `mention` è stato calcolato). Il testo si
/// rilegge dall'host e la prima occorrenza di `mention` diventa il link;
/// assente = niente da collegare, e non è un errore. La concorrenza è quella
/// della firma: `base` non più corrente → `Conflict`.
fn convert_to_link(action: &UiAction, host: &mut dyn HostApi) -> Result<ViewUpdate, PluginError> {
    let (Some(id), Some(target), Some(mention), Some(base), Some(start), Some(end)) = (
        action.payload.get(DOC).and_then(|v| v.as_str()),
        action.payload.get(TARGET).and_then(|v| v.as_str()),
        action.payload.get(MENTION).and_then(|v| v.as_str()),
        action.payload.get(BASE).and_then(|v| v.as_str()),
        action.payload.get(START).and_then(|v| v.as_u64()),
        action.payload.get(END).and_then(|v| v.as_u64()),
    ) else {
        return Ok(ViewUpdate::None);
    };
    if mention.is_empty() || target.is_empty() {
        return Ok(ViewUpdate::None);
    }
    let doc = DocId::new(id);
    // Si sostituisce una parola: ha senso solo in un sorgente in prosa. Come
    // si scrive il link lo decide il formato della nota.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    if host.document_revision(&doc)? != Revision::new(base) {
        return Err(PluginError::Conflict(Text::key(MENTION_CHANGED)));
    }
    let source = host.read_document(&doc)?;
    let span = usize::try_from(start).ok().zip(usize::try_from(end).ok());
    let Some((start, end)) = span else {
        return Ok(ViewUpdate::None);
    };
    if source.get(start..end) != Some(mention) {
        return Err(PluginError::Conflict(Text::key(MENTION_CHANGED)));
    }
    // La parola resta quella che si leggeva: si collega, non si riscrive. Il
    // riferimento è il più corto che porta davvero alla nota, e se la parola
    // è scritta altrimenti (un alias) resta come testo del link.
    let reference = link_reference(host, &DocId::new(target))?;
    let link = crate::formats::link_text(
        host,
        &doc,
        &crate::formats::wikilink(&reference, Some(mention), false),
    )?;
    host.apply_edit(
        &doc,
        EditRequest::new(
            Revision::new(base),
            vec![TextEdit::replace(Span::new(start, end), link)],
        ),
    )?;
    Ok(ViewUpdate::None)
}

/// Il testo del wikilink che porta a `target`: il nome pagina se la
/// risoluzione del vault lo manda lì, poi il nome con la sua estensione, poi
/// il percorso senza estensione, e solo in ultimo il percorso intero. Chiede al
/// kernel invece di indovinare la regola: due note omonime in cartelle diverse,
/// o nella stessa cartella con formati diversi, sono esattamente il caso in cui
/// il nome da solo porterebbe altrove.
fn link_reference(host: &dyn ReadApi, target: &DocId) -> Result<String, PluginError> {
    let path = target.as_str();
    let file_name = path.rsplit('/').next().filter(|name| *name != path);
    let without_extension = path
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .filter(|stem| !stem.is_empty() && !stem.ends_with('/'));
    for candidate in [Some(target.page_name()), file_name, without_extension]
        .into_iter()
        .flatten()
    {
        let resolved = match host.query_index(IndexQuery::Resolve {
            target: LinkTarget::wiki(candidate),
            from: None,
        }) {
            Ok(resolved) => resolved,
            // Un host che non sa risolvere non ferma il gesto: il percorso
            // intero porta sempre alla nota, com'era prima.
            Err(PluginError::Unserved(_)) => break,
            Err(error) => return Err(error),
        };
        if matches!(resolved, IndexResult::Resolved(Some(ref found)) if found.doc == *target) {
            return Ok(candidate.to_string());
        }
    }
    Ok(path.to_string())
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
    crate::formats::speaking(vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Collegamenti")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(INCOMING, "Entranti")
            .with(OUTGOING, "Uscenti")
            .with(UNLINKED, "Menzioni non collegate")
            .with(OUTBOUND_UNLINKED, "Menzioni uscenti non collegate")
            .with(
                FILTER_STATE,
                "Filtra le menzioni (come nella ricerca: tag:progetto, path:note/…)",
            )
            .with(FILTER_INVALID, "Il filtro non si legge dal carattere {at}.")
            .with(
                FILTER_INVALID_JSON,
                "Il filtro JSON non si legge dal carattere {at}: {reason}",
            )
            .with(
                MENTION_CHANGED,
                "La menzione è cambiata: il pannello si aggiorna.",
            )
            .with(NOTE_CHANGED, "La nota è cambiata: il pannello si aggiorna.")
            .with(EMPTY, "Nessun backlink.")
            .with(EMPTY_OUTGOING, "Nessun collegamento uscente.")
            .with(EMPTY_UNLINKED, "Nessuna menzione non collegata.")
            .with(FAILED, "Impossibile caricare questa sezione.")
            .with(
                MENTIONS_NEED_SEARCH,
                "Le menzioni si cercano nel testo delle note: serve la ricerca, che \
                 in questo vault non è attiva.",
            )
            .with(CONVERT_LABEL, "Collega")
            .with(INCOMING_COUNT, "Entranti · {count}")
            .with(OUTGOING_COUNT, "Uscenti · {count}")
            .with(UNLINKED_COUNT, "Menzioni non collegate · {count}")
            .with(
                OUTBOUND_UNLINKED_COUNT,
                "Menzioni uscenti non collegate · {count}",
            )
            .with(FILTER_SECTION, "Filtro avanzato"),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Links")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(INCOMING, "Incoming")
            .with(OUTGOING, "Outgoing")
            .with(UNLINKED, "Unlinked mentions")
            .with(OUTBOUND_UNLINKED, "Outgoing unlinked mentions")
            .with(
                FILTER_STATE,
                "Filter mentions (as in search: tag:project, path:notes/…)",
            )
            .with(
                FILTER_INVALID,
                "The filter cannot be read from character {at}.",
            )
            .with(
                FILTER_INVALID_JSON,
                "The JSON filter cannot be read from character {at}: {reason}",
            )
            .with(
                MENTION_CHANGED,
                "The mention changed: the panel is refreshing.",
            )
            .with(NOTE_CHANGED, "The note changed: the panel is refreshing.")
            .with(EMPTY, "No backlinks.")
            .with(EMPTY_OUTGOING, "No outgoing links.")
            .with(EMPTY_UNLINKED, "No unlinked mentions.")
            .with(FAILED, "Could not load this section.")
            .with(
                MENTIONS_NEED_SEARCH,
                "Mentions are found in the notes' text: this needs search, which is \
                 not active in this vault.",
            )
            .with(CONVERT_LABEL, "Link")
            .with(INCOMING_COUNT, "Incoming · {count}")
            .with(OUTGOING_COUNT, "Outgoing · {count}")
            .with(UNLINKED_COUNT, "Unlinked mentions · {count}")
            .with(
                OUTBOUND_UNLINKED_COUNT,
                "Outgoing unlinked mentions · {count}",
            )
            .with(FILTER_SECTION, "Advanced filter"),
    ])
}

/// Il titolo del pannello: si vede sempre, anche quando il pannello è vuoto.
const VIEW_TITLE: &str = "view_title";
/// Nessuna nota aperta: non è un errore, è uno stato.
const NO_ACTIVE_DOC: &str = "no_active_doc";
/// La nota aperta non ha backlink.
const EMPTY: &str = "empty";
/// I titoli delle parti, col numero. Il numero attraversa come numero: la
/// frase la compone il catalogo.
const A_COUNT: &str = "count";
const INCOMING: &str = "incoming";
const INCOMING_COUNT: &str = "incoming_count";
const OUTGOING: &str = "outgoing";
const UNLINKED: &str = "unlinked";
const OUTBOUND_UNLINKED_COUNT: &str = "outbound_unlinked_count";
const FILTER_SECTION: &str = "filter_section";
const EMPTY_OUTGOING: &str = "empty_outgoing";
const EMPTY_UNLINKED: &str = "empty_unlinked";
const FAILED: &str = "failed";
/// Le menzioni non collegate senza la ricerca che valuta il testo.
const MENTIONS_NEED_SEARCH: &str = "mentions_need_search";
const CONVERT_LABEL: &str = "convert_label";
const FILTER_INVALID: &str = "filter_invalid";
const FILTER_INVALID_JSON: &str = "filter_invalid_json";
const MENTION_CHANGED: &str = "mention_changed";
const NOTE_CHANGED: &str = "note_changed";
const OUTGOING_COUNT: &str = "outgoing_count";
const UNLINKED_COUNT: &str = "unlinked_count";

/// Costruisce l'albero `UiNode` del pannello backlink per un insieme di
/// riferimenti entranti. Separato da [`BacklinksView`] perché è pura
/// trasformazione dati→UI: si prova senza un host.
///
/// **Una riga per riferimento, non per nota**: chi cita la nota aperta in tre
/// punti compare tre volte, con tre contesti diversi, ed è ciò che
/// [`IndexQuery::Backlinks`] promette — la risposta porta il frammento in cui il
/// link compare, e tre frammenti sono tre righe. Raggrupparli è la voce
/// «Backlink raggruppati» del §7.2, cioè un'altra vista.
pub fn build_backlinks_view(refs: &[BacklinkRef]) -> UiNode {
    if refs.is_empty() {
        return placeholder(EMPTY);
    }

    // Quante righe ha già prodotto ogni sorgente: serve alla chiave, sotto.
    let mut nth: HashMap<&DocId, usize> = HashMap::new();
    let items = refs
        .iter()
        .map(|r| {
            let n = nth.entry(&r.source).or_insert(0);
            // La chiave è l'identità della riga fra due ridisegni, e il
            // contratto di [`UiNode`] la vuole **unica fra i fratelli**. Il solo
            // `DocId` sorgente non lo era: due menzioni della stessa nota
            // davano due fratelli con la stessa chiave, e il riconciliatore
            // della shell — che accoppia per chiave e poi per posizione — non
            // riusciva più a riusare la seconda riga, ricostruendola a ogni
            // salvataggio (focus, scroll e selezione con lei). L'identità di una
            // riga qui è la coppia *sorgente + quale sua menzione*, e questa è
            // la sua scrittura; non è la posizione nell'elenco, che cambia
            // quando un'altra nota entra o esce.
            let key = format!("{}#{n}", r.source.as_str());
            *n += 1;
            UiNode::list_item(
                r.source.page_name(),
                r.context.as_deref().map(readable).map(Text::from),
                // l'azione porta il DocId sorgente nel payload, così il
                // provider può navigare senza parsare il proprio id.
                Some(ActionRef::with(
                    OPEN,
                    serde_json::json!({ DOC: r.source.as_str() }),
                )),
            )
            .with_key(key)
        })
        .collect();
    UiNode::list(items)
}

/// Costruisce l'albero `UiNode` dei link uscenti di un documento, una riga per
/// riferimento con il suo contesto — il gemello di [`build_backlinks_view`]
/// sul verso opposto del grafo.
///
/// Pura trasformazione dati→UI come la gemella: si prova senza un host. Le
/// coppie `(target, context)` sono quelle di `LinkGraph::outgoing_with_context`
/// del kernel, e la chiave di riga riusa la stessa scrittura `target+#n`
/// (una per riferimento, non per nota). Le righe navigano col `Navigate`
/// esistente: nessuna nuova azione di navigazione.
pub fn build_outgoing_view(targets: &[(DocId, Option<String>)]) -> UiNode {
    if targets.is_empty() {
        return placeholder(EMPTY_OUTGOING);
    }
    let mut nth: HashMap<&DocId, usize> = HashMap::new();
    let items = targets
        .iter()
        .map(|(target, context)| {
            let n = nth.entry(target).or_insert(0);
            let key = format!("{}#{n}", target.as_str());
            *n += 1;
            UiNode::list_item(
                target.page_name(),
                context.as_deref().map(readable).map(Text::from),
                Some(ActionRef::with(
                    OPEN,
                    serde_json::json!({ DOC: target.as_str() }),
                )),
            )
            .with_key(key)
        })
        .collect();
    UiNode::list(items)
}
/// Una parte del pannello: una sezione col numero nel titolo, chiusa quando
/// è vuota — «Uscenti · 0» dice già tutto in una riga, e un segnaposto sotto
/// ogni titolo riempiva il pannello di niente. Se la parte non si carica il
/// titolo resta senza numero e la sezione dice il guasto.
fn part(name: &str, counted: &str, result: Result<(usize, UiNode), PluginError>) -> UiNode {
    match result {
        Ok((count, body)) => section(
            name,
            Text::message(counted, vec![Arg::int(A_COUNT, count as i64)]),
            count == 0,
            body,
        ),
        Err(_) => section(
            name,
            Text::key(name),
            false,
            UiNode::failed(Text::key(FAILED), None),
        ),
    }
}

/// Le menzioni che si cercano nel testo. Se nessun provider valuta il testo la
/// risposta è `Unserved`, e non è un guasto: la ricerca non è montata. La
/// sezione lo dice, chiusa, invece di presentarsi come una sezione rotta.
fn mentions(name: &str, counted: &str, result: Result<(usize, UiNode), PluginError>) -> UiNode {
    match result {
        Err(PluginError::Unserved(_)) => section(
            name,
            Text::key(name),
            true,
            placeholder(MENTIONS_NEED_SEARCH),
        ),
        other => part(name, counted, other),
    }
}

fn section(name: &str, title: Text, collapsed: bool, body: UiNode) -> UiNode {
    UiNode::keyed(
        name,
        UiKind::Section {
            title,
            collapsed,
            children: vec![body],
        },
    )
}

/// Il contesto di un link come si legge, non come si scrive: `[[Nota|alias]]`
/// diventa `alias`, `[[Nota#Titolo]]` diventa `Nota › Titolo`, e
/// `[[Nota]]` diventa `Nota`. Il pannello mostra una frase, non la sintassi
/// che l'ha prodotta.
fn readable(context: &str) -> String {
    let mut out = String::with_capacity(context.len());
    let mut rest = context;
    while let Some(open) = rest.find("[[") {
        let Some(close) = rest[open + 2..].find("]]") else {
            break;
        };
        out.push_str(&rest[..open]);
        let inner = &rest[open + 2..open + 2 + close];
        match inner.split_once('|') {
            Some((_, alias)) => out.push_str(alias),
            None => {
                let (page, anchor) = inner.split_once('#').unwrap_or((inner, ""));
                let page = page.rsplit('/').next().unwrap_or(page);
                out.push_str(page);
                let anchor = anchor.trim_start_matches('^');
                if !anchor.is_empty() {
                    if !page.is_empty() {
                        out.push_str(" › ");
                    }
                    out.push_str(anchor);
                }
            }
        }
        rest = &rest[open + 2 + close + 2..];
    }
    out.push_str(rest);
    out
}

fn unexpected(expected: &str, actual: &IndexResult) -> PluginError {
    PluginError::Internal(format!("query {expected}: risposta fuori tema: {actual:?}").into())
}

/// Il contratto offre i vicini uscenti e i backlink con contesto, non una
/// seconda query per i riferimenti uscenti. Per ogni bersaglio ricaviamo le
/// righe del sorgente dai backlink; anche i self-link restano visibili.
#[allow(clippy::type_complexity)]
fn outgoing_refs(
    host: &dyn ReadApi,
    active: &DocId,
) -> Result<(Vec<DocId>, Vec<(DocId, Option<String>)>), PluginError> {
    let targets = match host.query_index(IndexQuery::Neighbors {
        seeds: QueryExpr::docs(vec![active.clone()]),
        direction: LinkDirection::Outbound,
        depth: 1,
        page: None,
    })? {
        IndexResult::Neighbors(page) => page
            .items
            .into_iter()
            .filter(|neighbor| neighbor.via == *active)
            // Gli allegati sono foglie del grafo, non note da aprire nel
            // pannello: e chi li nomina si chiede passando tutto il vault.
            .filter(|neighbor| host.format_of(&neighbor.doc).is_some())
            .map(|neighbor| neighbor.doc)
            .collect::<Vec<_>>(),
        other => return Err(unexpected("neighbors", &other)),
    };
    let mut refs = Vec::new();
    for target in targets.iter().chain(std::iter::once(active)) {
        let backlinks = match host.query_index(IndexQuery::Backlinks {
            target: target.clone(),
            page: None,
        })? {
            IndexResult::Backlinks(page) => page.items,
            other => return Err(unexpected("backlinks", &other)),
        };
        for reference in backlinks {
            if reference.source == *active {
                refs.push((target.clone(), reference.context));
            }
        }
    }
    Ok((targets, refs))
}

fn filter_text(host: &dyn ReadApi) -> Result<String, PluginError> {
    match host.view_state(FILTER_STATE)? {
        None => Ok(String::new()),
        Some(serde_json::Value::String(value)) => Ok(value),
        Some(_) => Err(PluginError::BadArgs("invalid unlinked filter state".into())),
    }
}

fn filter_query(host: &dyn ReadApi) -> Result<QueryExpr, PluginError> {
    let text = filter_text(host)?;
    if text.trim().is_empty() {
        return Ok(QueryExpr::all());
    }
    if text.len() > 16 * 1024 {
        return Err(PluginError::BadArgs(
            "unlinked filter exceeds 16 KiB".into(),
        ));
    }
    let text = text.trim();
    // Un filtro salvato quando il campo voleva JSON vale ancora.
    if text.starts_with('{') {
        return serde_json::from_str(text).map_err(|e| {
            PluginError::BadArgs(Text::message(
                FILTER_INVALID_JSON,
                vec![
                    Arg::int("at", e.column() as i64),
                    Arg::text("reason", e.to_string()),
                ],
            ))
        });
    }
    // La stessa grammatica della barra di ricerca: chi sa cercare sa filtrare.
    fub_abi::rules::search_syntax::parse(text, false).map_err(|fault| {
        let at = text
            .get(..fault.at)
            .map_or(text.chars().count(), |before| before.chars().count());
        PluginError::BadArgs(Text::message(
            FILTER_INVALID,
            vec![Arg::int("at", at as i64 + 1)],
        ))
    })
}

/// Distribuire AND sulle due DNF, mai ignorare un filtro o ridurre a una pagina
/// di hit già tagliata. Il limite è esplicito: una query più grande è rifiutata.
fn combine_queries(left: QueryExpr, right: &QueryExpr) -> Result<QueryExpr, PluginError> {
    let left = if left.any.is_empty() {
        vec![QueryClause::default()]
    } else {
        left.any
    };
    let right = if right.any.is_empty() {
        vec![QueryClause::default()]
    } else {
        right.any.clone()
    };
    if left.len().saturating_mul(right.len()) > 128 {
        return Err(PluginError::BadArgs(
            "unlinked filter expands beyond 128 clauses".into(),
        ));
    }
    let mut any = Vec::with_capacity(left.len() * right.len());
    for a in left {
        for b in &right {
            if a.all.len() + b.all.len() > 32 {
                return Err(PluginError::BadArgs(
                    "unlinked filter clause exceeds 32 leaves".into(),
                ));
            }
            let mut all = a.all.clone();
            all.extend(b.all.iter().cloned());
            any.push(QueryClause { all });
        }
    }
    Ok(QueryExpr { any })
}

fn mention_context(source: &str, start: usize, end: usize) -> String {
    let before = source[..start]
        .char_indices()
        .rev()
        .nth(40)
        .map_or(0, |(index, _)| index);
    let after = source[end..]
        .char_indices()
        .nth(40)
        .map_or(source.len(), |(index, _)| end + index);
    source[before..after].to_string()
}

struct UnlinkedMention {
    doc: DocId,
    target: DocId,
    outbound: bool,
    mention: String,
    context: String,
    base: String,
    start: usize,
    end: usize,
}

fn unlinked_mentions(
    host: &dyn ReadApi,
    active: &DocId,
    linked: &BTreeSet<DocId>,
    filter: &QueryExpr,
) -> Result<Vec<UnlinkedMention>, PluginError> {
    let model = host.read_model(active)?;
    let mut names = vec![active.page_name().to_string()];
    names.extend(model.frontmatter.aliases());
    names.retain(|name| !name.is_empty());
    names.sort();
    names.dedup();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    if names.len() > 32 {
        return Err(PluginError::BadArgs(
            "too many names/aliases for unlinked scan".into(),
        ));
    }
    let matching = combine_queries(
        QueryExpr {
            any: names
                .iter()
                .map(|name| QueryClause {
                    all: vec![QueryLiteral {
                        negated: false,
                        predicate: QueryPredicate::Text(TextQuery {
                            mode: TextMode::Phrase,
                            fields: vec![TextField::Body],
                            ..TextQuery::terms(name)
                        }),
                    }],
                })
                .collect(),
        },
        filter,
    )?;
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    // L'indice seleziona; lo span viene verificato sul sorgente che si andrà a
    // modificare. Una finestra alla volta, con un tetto anche sui falsi hit.
    for page_no in 0..4 {
        let page = match host.query_index(IndexQuery::Documents {
            matching: matching.clone(),
            sort: None,
            select: Default::default(),
            page: Some(Page::new(page_no * PAGE_SIZE, PAGE_SIZE)),
            excerpts: Excerpts::Omit,
        })? {
            IndexResult::Documents(page) => page,
            other => return Err(unexpected("documents", &other)),
        };
        for hit in page.items {
            if hit.doc == *active || linked.contains(&hit.doc) || !seen.insert(hit.doc.clone()) {
                continue;
            }
            let base = host.document_revision(&hit.doc)?;
            let source = host.read_document(&hit.doc)?;
            if source.len() > MAX_MENTION_BYTES {
                return Err(PluginError::BadArgs(
                    "unlinked source exceeds 256 KiB".into(),
                ));
            }
            if host.document_revision(&hit.doc)? != base {
                return Err(PluginError::Conflict(Text::key(MENTION_CHANGED)));
            }
            let mut spans = BTreeSet::new();
            for name in &names {
                for (start, _) in source.match_indices(name.as_str()) {
                    spans.insert((start, start + name.len(), name));
                }
            }
            for (start, end, name) in spans {
                rows.push(UnlinkedMention {
                    target: active.clone(),
                    outbound: false,
                    doc: hit.doc.clone(),
                    mention: name.clone(),
                    context: mention_context(&source, start, end),
                    base: base.as_str().to_string(),
                    start,
                    end,
                });
                if rows.len() == PAGE_SIZE as usize {
                    return Ok(rows);
                }
            }
        }
        if page.offset + PAGE_SIZE >= page.total {
            break;
        }
    }
    Ok(rows)
}

/// Menzioni nella nota attiva di pagine non ancora collegate. La selezione dei
/// candidati passa dall'indice e ha un limite di 200 note.
fn outbound_unlinked_mentions(
    host: &dyn ReadApi,
    active: &DocId,
    linked: &BTreeSet<DocId>,
    filter: &QueryExpr,
) -> Result<Vec<UnlinkedMention>, PluginError> {
    let base = host.document_revision(active)?;
    let source = host.read_document(active)?;
    if source.len() > MAX_MENTION_BYTES {
        return Err(PluginError::BadArgs(
            "active document exceeds 256 KiB".into(),
        ));
    }
    if host.document_revision(active)? != base {
        return Err(PluginError::Conflict(Text::key(NOTE_CHANGED)));
    }
    let mut excluded = linked.iter().cloned().collect::<Vec<_>>();
    excluded.push(active.clone());
    let matching = combine_queries(
        filter.clone(),
        &QueryExpr {
            any: vec![QueryClause {
                all: vec![QueryLiteral {
                    negated: true,
                    predicate: QueryPredicate::Docs { docs: excluded },
                }],
            }],
        },
    )?;
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    for page_no in 0..4 {
        let page = match host.query_index(IndexQuery::Documents {
            matching: matching.clone(),
            sort: None,
            select: PropertySelect::keys(&["alias", "aliases"]),
            page: Some(Page::new(page_no * PAGE_SIZE, PAGE_SIZE)),
            excerpts: Excerpts::Omit,
        })? {
            IndexResult::Documents(page) => page,
            other => return Err(unexpected("documents", &other)),
        };
        for hit in page.items {
            if !seen.insert(hit.doc.clone()) {
                continue;
            }
            let aliases = match indexed_aliases(&hit.properties) {
                Some(aliases) => aliases,
                None => host.read_model(&hit.doc)?.frontmatter.aliases(),
            };
            let mut names = vec![hit.doc.page_name().to_string()];
            names.extend(aliases);
            names.retain(|name| !name.is_empty());
            names.sort();
            names.dedup();
            if names.len() > 32 {
                return Err(PluginError::BadArgs(
                    "too many names/aliases for unlinked scan".into(),
                ));
            }
            let mut spans = BTreeSet::new();
            for name in &names {
                for (start, _) in source.match_indices(name.as_str()) {
                    spans.insert((start, start + name.len(), name));
                }
            }
            for (start, end, name) in spans {
                rows.push(UnlinkedMention {
                    doc: active.clone(),
                    target: hit.doc.clone(),
                    outbound: true,
                    mention: name.clone(),
                    context: mention_context(&source, start, end),
                    base: base.as_str().to_string(),
                    start,
                    end,
                });
                if rows.len() == PAGE_SIZE as usize {
                    return Ok(rows);
                }
            }
        }
        if page.offset + PAGE_SIZE >= page.total {
            break;
        }
    }
    Ok(rows)
}

/// Gli alias di una candidata come li dà [`Frontmatter::aliases`], letti dalle
/// proprietà che l'indice ha già: `aliases`, in sua assenza `alias`. Leggere il
/// modello di ogni candidata voleva dire rileggerla dal disco e riparsarla,
/// fino a ottocento volte per un disegno. `None` quando l'indice ha
/// normalizzato la chiave in una forma che non è il testo del file (un tipo
/// scelto dall'utente, un elemento che non è una stringa): lì decide il modello.
///
/// [`Frontmatter::aliases`]: fub_abi::model::Frontmatter::aliases
fn indexed_aliases(properties: &[PropertyEntry]) -> Option<Vec<String>> {
    let entry = properties
        .iter()
        .find(|entry| entry.key == "aliases")
        .or_else(|| properties.iter().find(|entry| entry.key == "alias"));
    match entry.map(|entry| &entry.value) {
        None | Some(PropertyValue::Empty) => Some(Vec::new()),
        Some(PropertyValue::List(items)) => items
            .iter()
            .map(|item| match item {
                PropertyScalar::Text(text) => Some(text.clone()),
                _ => None,
            })
            .collect(),
        Some(_) => None,
    }
}

fn build_unlinked_view(mentions: &[UnlinkedMention]) -> UiNode {
    if mentions.is_empty() {
        return placeholder(EMPTY_UNLINKED);
    }
    let rows = mentions
        .iter()
        .map(|mention| {
            UiNode::row(
                6,
                vec![
                    UiNode::list_item(
                        if mention.outbound { mention.target.page_name() } else { mention.doc.page_name() },
                        Some(Text::from(mention.context.clone())),
                        Some(ActionRef::with(
                            OPEN,
                            serde_json::json!({ DOC: if mention.outbound { mention.target.as_str() } else { mention.doc.as_str() } }),
                        )),
                    ),
                    UiNode::button(
                        Text::key(CONVERT_LABEL),
                        Default::default(),
                        ActionRef::with(
                            CONVERT,
                            serde_json::json!({
                                DOC: mention.doc.as_str(),
                                TARGET: mention.target.as_str(),
                                MENTION: mention.mention,
                                BASE: mention.base,
                                START: mention.start,
                                END: mention.end,
                            }),
                        ),
                    ),
                ],
            )
            .with_key(format!(
                "{}#{}:{}",
                mention.doc.as_str(),
                mention.start,
                mention.end
            ))
        })
        .collect();
    UiNode::list(rows)
}

/// Le menzioni non collegate di una nota: `Text` meno `Linked` meno self (P04),
/// senza scansioni proprie.
///
/// `name` e `aliases` sono la menzione cercata — il nome pagina e gli alias del
/// frontmatter della nota — e `text_hits` sono i `DocumentMatch` di una ricerca
/// `Text` su di essi; `linked` è l'insieme dei documenti già collegati in
/// qualunque verso (`LinkGraph::linked` con `Both`, una volta ciascuno);
/// `self_id` è la nota di cui si cercano le menzioni.
///
/// `name`/`aliases` non si scansionano qui: identificano la domanda che ha
/// prodotto `text_hits` (chi chiama li ha già usati per cercare) e restano in
/// firma perché il sito di chiamata dica cosa sta sottraendo. Il risultato è in
/// ordine di `DocId` — l'ordine del `BTreeSet`, stabile per la finestra — e va
/// poi tagliato con `Paged::window`/`from_source` dal chiamante, on-demand e
/// mai per battuta (con `Race` contro le risposte obsolete, lato shell).
///
/// Nessun secondo indice, nessuna scansione del vault qui dentro: il costo è
/// proporzionale agli hit, non alle note.
pub fn find_unlinked_candidates(
    name: &str,
    aliases: &[String],
    text_hits: &[DocumentMatch],
    linked: &BTreeSet<DocId>,
    self_id: &DocId,
) -> Vec<DocId> {
    let _ = (name, aliases);
    text_hits
        .iter()
        .map(|hit| &hit.doc)
        .filter(|doc| *doc != self_id && !linked.contains(*doc))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::DocId;
    use fub_abi::traits::VaultRead;
    use fub_abi::ui::UiKind;
    use fub_sdk::testing::MemoryHost;

    fn instance() -> ViewInstance {
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
            "the document is in the payload, not concatenated into the ID"
        );
        assert!(
            json.contains(r#""key":"a/Nota.md#0""#),
            "each row carries its own identity across redraws"
        );
    }

    /// Il contratto di [`UiNode`] vuole la chiave **unica fra i fratelli**, e
    /// una nota che ne cita un'altra due volte produce due fratelli: prima che
    /// l'ordinale entrasse nella chiave erano due righe con la stessa, e il
    /// riconciliatore della shell ne riusava una sola — l'altra la ricostruiva
    /// a ogni ridisegno, cioè a ogni salvataggio.
    ///
    /// Il banco guarda **le chiavi dei fratelli**, non la loro forma: se un
    /// giorno l'identità di una riga si scrivesse in un altro modo, questo
    /// resterebbe la domanda giusta.
    #[test]
    fn two_mentions_from_the_same_notes_are_two_rows_with_two_keys() {
        let refs = vec![
            BacklinkRef {
                source: DocId::new("a/Nota.md"),
                context: Some("the first place it cites it".into()),
            },
            BacklinkRef {
                source: DocId::new("a/Nota.md"),
                context: Some("the second, further down".into()),
            },
            BacklinkRef {
                source: DocId::new("b/Altra.md"),
                context: None,
            },
        ];
        let UiKind::List { items } = build_backlinks_view(&refs).kind else {
            panic!("the part is the list");
        };
        assert_eq!(items.len(), 3, "one row per reference, not per note");
        let keys: std::collections::BTreeSet<&str> =
            items.iter().filter_map(|n| n.key.as_deref()).collect();
        assert_eq!(
            keys.len(),
            items.len(),
            "sibling keys: {:?} — there must be as many as there are rows",
            items.iter().map(|n| n.key.as_deref()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        // Il provider non riceve niente: il documento attivo e i backlink li
        // prende dall'host, esattamente come farà un plugin.
        let host = MemoryHost::new().with_backlink("target.md", &["a/Uno.md", "Due.md"]);
        host.set_active(Some("target.md"));

        let tree = BacklinksView.render_view(&instance(), &host).unwrap();
        let json = serde_json::to_string(&tree).unwrap();
        // Il titolo della parte porta il **numero**, non la frase: la frase la
        // compone il catalogo, e il numero è ciò che questo provider ha da dire.
        assert!(json.contains(r#""key":"incoming_count""#), "{json}");
        assert!(json.contains(r#""value":2"#), "{json}");
        assert!(json.contains(r#""doc":"a/Uno.md""#));
        assert!(json.contains(r#""doc":"Due.md""#));
    }

    #[test]
    fn mentions_without_a_text_evaluator_say_search_is_missing_not_failed() {
        let unserved = mentions(
            UNLINKED,
            UNLINKED_COUNT,
            Err(PluginError::Unserved("text".into())),
        );
        let UiKind::Section {
            collapsed,
            children,
            ..
        } = &unserved.kind
        else {
            panic!("the part is a section");
        };
        assert!(*collapsed);
        assert!(
            matches!(&children[0].kind, UiKind::EmptyState { title, .. } if *title == Text::key(MENTIONS_NEED_SEARCH)),
            "{children:?}"
        );

        let broken = mentions(
            UNLINKED,
            UNLINKED_COUNT,
            Err(PluginError::Internal("disk".into())),
        );
        let UiKind::Section { children, .. } = &broken.kind else {
            panic!("the part is a section");
        };
        assert!(matches!(children[0].kind, UiKind::Failed { .. }));
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder_not_an_error() {
        let host = MemoryHost::new();
        let tree = BacklinksView.render_view(&instance(), &host).unwrap();
        assert!(matches!(tree.kind, UiKind::EmptyState { .. }));
    }

    #[test]
    fn inline_links_follow_each_instance_document_not_the_global_active_document() {
        let host = MemoryHost::new()
            .with_backlink("A.md", &["from_a.md"])
            .with_backlink("B.md", &["from_b.md"]);
        host.set_active(Some("B.md"));
        let left = ViewInstance::new(
            BACKLINKS_INLINE_VIEW,
            "pane-left",
            serde_json::json!({ DOC: "A.md" }),
        );
        let right = ViewInstance::new(
            BACKLINKS_INLINE_VIEW,
            "pane-right",
            serde_json::json!({ DOC: "B.md" }),
        );
        let left_json =
            serde_json::to_string(&BacklinksView.render_view(&left, &host).unwrap()).unwrap();
        let right_json =
            serde_json::to_string(&BacklinksView.render_view(&right, &host).unwrap()).unwrap();
        assert!(
            left_json.contains("from_a.md") && !left_json.contains("from_b.md"),
            "{left_json}"
        );
        assert!(
            right_json.contains("from_b.md") && !right_json.contains("from_a.md"),
            "{right_json}"
        );
        assert_eq!(
            BacklinksView.interests(&left).follows,
            ContextMask::default()
        );
        assert!(BacklinksView.views()[1]
            .validate_params(&left.params)
            .is_ok());
        let invalid = ViewInstance::new(
            BACKLINKS_INLINE_VIEW,
            "bad",
            serde_json::json!({ DOC: "../outside.md" }),
        );
        assert!(matches!(
            BacklinksView.render_view(&invalid, &host),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn clicking_a_backlink_asks_the_shell_to_navigate() {
        let mut host = MemoryHost::new();
        let update = BacklinksView
            .on_action(
                &instance(),
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
            .on_action(&instance(), UiAction::new(OPEN), &mut host)
            .unwrap();
        assert_eq!(update, ViewUpdate::None);
    }

    /// `build_outgoing_view` è una riga per riferimento come la gemella
    /// inbound: stessi contesti, stesse chiavi `target+#n`, stesso Navigate.
    #[test]
    fn outgoing_view_lists_targets_with_context_and_keys() {
        let targets = vec![
            (DocId::new("Nota.md"), Some("primo".to_string())),
            (DocId::new("Altra.md"), None),
            (DocId::new("Nota.md"), Some("terzo".to_string())),
        ];
        let node = build_outgoing_view(&targets);
        let UiKind::List { items } = node.kind else {
            panic!("the part is the list");
        };
        assert_eq!(items.len(), 3, "one row per reference, not per note");
        let keys: BTreeSet<&str> = items.iter().filter_map(|n| n.key.as_deref()).collect();
        assert_eq!(keys.len(), items.len(), "sibling keys are unique");
        assert!(keys.contains("Nota.md#0"));
        assert!(keys.contains("Nota.md#1"));
        let json = serde_json::to_string(&items).unwrap();
        assert!(json.contains("primo"));
        assert!(json.contains(r#""doc":"Nota.md""#));
        assert!(matches!(
            build_outgoing_view(&[]).kind,
            UiKind::EmptyState { .. }
        ));
    }

    fn hit(doc: &str) -> DocumentMatch {
        DocumentMatch::of(DocId::new(doc))
    }

    /// L'indice dà gli alias che dà il modello; dove li ha normalizzati in
    /// un'altra forma risponde `None` e decide il modello.
    #[test]
    fn indexed_aliases_are_the_frontmatter_aliases() {
        use fub_abi::model::{DateFormats, Frontmatter, PropertyTypes};
        use fub_abi::rules::properties::entries_with_types;
        let cases = [
            serde_json::json!({}),
            serde_json::json!({"aliases": "Uno"}),
            serde_json::json!({"aliases": ["Uno", "Due"]}),
            serde_json::json!({"aliases": null, "alias": "Uno"}),
            serde_json::json!({"alias": ["Uno"]}),
            serde_json::json!({"aliases": ["Uno", 3, true]}),
            serde_json::json!({"aliases": 7}),
            serde_json::json!({"aliases": {"a": 1}}),
            serde_json::json!({"aliases": [], "alias": "Uno"}),
        ];
        for case in cases {
            let serde_json::Value::Object(map) = case.clone() else {
                unreachable!()
            };
            let frontmatter = Frontmatter(map);
            let properties = entries_with_types(
                &frontmatter,
                &PropertySelect::keys(&["alias", "aliases"]),
                &DateFormats::default(),
                &PropertyTypes::default(),
            );
            let indexed = indexed_aliases(&properties);
            assert_eq!(
                indexed.clone().unwrap_or_else(|| frontmatter.aliases()),
                frontmatter.aliases(),
                "{case}"
            );
            // Le forme comuni non rileggono il documento.
            if !matches!(case.get("aliases"), Some(serde_json::Value::Array(items)) if items.iter().any(|item| !item.is_string()))
                && !matches!(
                    case.get("aliases"),
                    Some(serde_json::Value::Number(_) | serde_json::Value::Object(_))
                )
            {
                assert!(indexed.is_some(), "{case}");
            }
        }
    }

    /// Text meno Linked meno self, senza scansioni: gli hit di testo che sono
    /// già collegati o sono la nota stessa non sono candidati.
    #[test]
    fn unlinked_is_text_minus_linked_minus_self() {
        let hits = vec![hit("a.md"), hit("b.md"), hit("self.md"), hit("c.md")];
        let linked: BTreeSet<DocId> = BTreeSet::from([DocId::new("b.md"), DocId::new("d.md")]);
        assert_eq!(
            find_unlinked_candidates("Self", &[], &hits, &linked, &DocId::new("self.md")),
            vec![DocId::new("a.md"), DocId::new("c.md")]
        );
    }

    /// Il linked elenca documenti una volta sola: i duplicati di testo non
    /// passano, e l'ordine è di `DocId` per la finestra.
    #[test]
    fn unlinked_dedups_and_orders_by_doc_id() {
        let hits = vec![hit("c.md"), hit("a.md"), hit("c.md")];
        let linked = BTreeSet::new();
        assert_eq!(
            find_unlinked_candidates(
                "Self",
                &["Alias".to_string()],
                &hits,
                &linked,
                &DocId::new("self.md")
            ),
            vec![DocId::new("a.md"), DocId::new("c.md")]
        );
    }

    /// `convert_to_link` collega lo span dichiarato via `apply_edit`: il solo
    /// canale di scrittura, con revisione e span del chiamante.
    #[test]
    fn convert_to_link_rewrites_the_first_mention() {
        let mut host = MemoryHost::new().with_document("nota.md", "si parla di Mario Rossi qui");
        let base = host
            .document_revision(&DocId::new("nota.md"))
            .expect("revision")
            .as_str()
            .to_string();
        let action = UiAction::new(CONVERT).with_payload(serde_json::json!({
            DOC: "nota.md",
            TARGET: "people/Rossi.md",
            MENTION: "Mario Rossi",
            BASE: base,
            START: 12,
            END: 23,
        }));
        let update = BacklinksView
            .on_action(&instance(), action, &mut host)
            .unwrap();
        assert_eq!(update, ViewUpdate::None);
        // Senza chi risolve, il percorso intero; la parola scritta resta
        // quella che si leggeva.
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "si parla di [[people/Rossi.md|Mario Rossi]] qui"
        );
    }

    /// Menzione assente o vuota = niente da collegare, non un errore; payload
    /// incompleto = stessa risposta.
    #[test]
    fn convert_to_link_without_a_match_changes_nothing() {
        let mut host = MemoryHost::new().with_document("nota.md", "niente da dire");
        let base = host
            .document_revision(&DocId::new("nota.md"))
            .expect("revision")
            .as_str()
            .to_string();
        for mention in ["Assente", ""] {
            let action = UiAction::new(CONVERT).with_payload(serde_json::json!({
                DOC: "nota.md",
                TARGET: "people/Rossi.md",
                MENTION: mention,
                BASE: base,
            }));
            assert_eq!(
                BacklinksView
                    .on_action(&instance(), action, &mut host)
                    .unwrap(),
                ViewUpdate::None
            );
        }
        assert_eq!(
            BacklinksView
                .on_action(&instance(), UiAction::new(CONVERT), &mut host)
                .unwrap(),
            ViewUpdate::None
        );
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "niente da dire"
        );
    }

    #[test]
    fn a_context_reads_as_prose_not_as_link_syntax() {
        assert_eq!(readable("vedi [[Nota]] qui"), "vedi Nota qui");
        assert_eq!(readable("con [[a/b/Nota|l'alias]]."), "con l'alias.");
        assert_eq!(
            readable("[[Nota#Titolo]] e [[#Sezione]]"),
            "Nota › Titolo e Sezione"
        );
        assert_eq!(readable("[[Nota#^blocco]]"), "Nota › blocco");
        assert_eq!(readable("aperto [[ma non chiuso"), "aperto [[ma non chiuso");
    }

    #[test]
    fn an_empty_part_is_a_closed_section_with_its_count() {
        let host = MemoryHost::new().with_backlink("target.md", &["Uno.md"]);
        host.set_active(Some("target.md"));
        let tree = BacklinksView.render_view(&instance(), &host).unwrap();
        let UiKind::Stack { children, .. } = tree.kind else {
            panic!("the panel is a column");
        };
        let sections: Vec<(Option<&str>, bool)> = children
            .iter()
            .map(|child| match &child.kind {
                UiKind::Section { collapsed, .. } => (child.key.as_deref(), *collapsed),
                other => panic!("every part is a section: {other:?}"),
            })
            .collect();
        // Entranti ha una riga ed è aperta; il filtro, senza filtro attivo,
        // sta chiuso in fondo.
        assert_eq!(sections.first(), Some(&(Some(INCOMING), false)));
        assert_eq!(sections.last(), Some(&(Some(FILTER_SECTION), true)));
    }
}
