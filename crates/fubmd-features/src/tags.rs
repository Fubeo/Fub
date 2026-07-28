//! Il pannello **tag** come `ViewProvider`, terzo provider vero.
//!
//! Come l'outline, legge dal kernel via il canale metadata: i tag dell'intero
//! vault con la loro frequenza li aggrega il kernel dai modelli
//! ([`IndexQuery::Tags`]) — una view non parsa e non conosce l'intero vault.
//! Cliccare un tag chiede una ricerca ([`ViewUpdate::RunSearch`]): il pannello
//! non ha un indice suo, riusa quello di ricerca com'è (i tag sono un campo
//! indicizzato).
//!
//! # È il collaudo del §2.4, e non per modo di dire
//!
//! Questo pannello ha un **filtro**, cioè un campo di testo il cui contenuto
//! deve sopravvivere fra due chiamate a `render_view`. Prima della seduta 2 non
//! era esprimibile in nessuna delle due metà del protocollo: non c'erano nodi di
//! input, e `on_action` prendeva `&self` — quindi il filtro corrente non aveva
//! dove stare se non dietro un `Mutex` che questo provider si sarebbe dovuto
//! inventare. Ora sta in un campo, come in qualunque oggetto vivo, e la firma lo
//! permette perché il kernel estrae il provider per la durata dell'azione.
//!
//! Il giro completo che ne esce è quello che il §2.8 esiste per proteggere: si
//! digita → `on_action` con i `fields` → il provider filtra e risponde
//! `Replace` → la shell **riconcilia** invece di ricostruire, e il campo di
//! testo non perde il focus. Con l'albero ricostruito da zero, scrivere due
//! lettere di fila sarebbe impossibile.

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::query::QueryExpr;
use fubmd_abi::session::ContextMask;
use fubmd_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, TagCount, ViewInstance, ViewProvider, ViewSpec,
    ViewSurface,
};
use fubmd_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const TAGS_ID: &str = "fubmd.tags";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const TAGS_VIEW: &str = "tags";

/// L'azione di ricerca per tag; il nome del tag (senza `#`) sta nel payload.
const SEARCH: &str = "search";
/// La chiave del payload di [`SEARCH`].
const TAG: &str = "tag";
/// L'azione del campo filtro, e il nome del campo che porta ciò che si è
/// digitato. Sono due cose diverse — *cosa è successo* e *da dove viene il
/// valore* — e la separazione è il §2.7.
const FILTER: &str = "filter";
const FILTER_FIELD: &str = "filter";

/// Il pannello tag.
///
/// Ha uno stato, ed è il primo provider ufficiale ad averne: il testo del
/// filtro. Non è una cache — i tag li richiede all'host a ogni render, perché
/// cambiano a ogni modifica del vault — è ciò che l'utente ha digitato, che non
/// sta da nessun'altra parte.
#[derive(Default)]
pub struct TagPanelView {
    filter: String,
}

impl ViewProvider for TagPanelView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Finché il posto era lettera morta la shell metteva il pannello a
            // destra per conoscenza privata; ora che il montaggio lo rispetta,
            // la dichiarazione dice la stessa cosa.
            ViewSpec::new(TAGS_VIEW, "Tag", ViewSurface::RightSidebar)
                // I tag sono aggregati vault-wide: invecchiano a ogni modifica
                // dell'indice, non al cambio di nota.
                .refreshing(EventMask::of([
                    EventKind::IndexUpdated,
                    EventKind::BatchEnded,
                ]))
                // …e non invecchiano per niente col contesto: la distribuzione
                // dei tag del vault è la stessa da qualunque nota la si guardi.
                // È il caso che la maschera esiste per servire — senza, questo
                // pannello si ridisegnerebbe a ogni movimento del cursore.
                .following(ContextMask::default())
                .with_icon("tag")
                .ordered(2)
                .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        self.tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // Il filtro è cambiato: lo si ricorda e si ridisegna. Il valore
            // arriva dai `fields`, che è dove la shell mette ciò che l'utente
            // ha digitato — il `payload` è dell'altro proprietario.
            FILTER => {
                self.filter = action.text_field(FILTER_FIELD).unwrap_or_default().into();
                Ok(ViewUpdate::Replace {
                    root: self.tree(host)?,
                })
            }
            // Un tag: cerca le note che lo portano. La query di ricerca è la
            // stessa che digiterebbe l'utente: `tags` è il campo indicizzato.
            SEARCH => match action.payload.get(TAG).and_then(|v| v.as_str()) {
                Some(name) => Ok(ViewUpdate::RunSearch {
                    query: format!("tags:{name}"),
                }),
                None => Ok(ViewUpdate::None),
            },
            _ => Ok(ViewUpdate::None),
        }
    }
}

impl TagPanelView {
    /// L'albero del pannello: i tag del vault, filtrati da ciò che si è
    /// digitato.
    ///
    /// Prende un `&dyn HostApi` e non un `&mut`: serve a entrambi i percorsi —
    /// il render (lettura) e la risposta a un'azione — e prenderlo in sola
    /// lettura è ciò che rende ovvio che disegnare non scrive.
    fn tree(&self, host: &dyn ReadApi) -> Result<UiNode, PluginError> {
        // Senza finestra: il pannello mostra la distribuzione intera, ed è la
        // ragione per cui la `Page` è opzionale invece che obbligatoria.
        let tags = match host.query_index(IndexQuery::Tags {
            matching: QueryExpr::all(),
            page: None,
        })? {
            IndexResult::Tags(t) => t,
            other => {
                return Err(PluginError::Internal(format!(
                    "query tag: risposta fuori tema: {other:?}"
                )))
            }
        };
        Ok(build_tags_view(&tags.items, &self.filter))
    }
}

/// Costruisce l'albero `UiNode` del pannello tag. Separato dal provider perché è
/// pura trasformazione dati→UI: si prova senza un host. I tag arrivano già
/// ordinati per nome dal kernel.
pub fn build_tags_view(tags: &[TagCount], filter: &str) -> UiNode {
    let cerca = filter.trim().to_lowercase();
    let visibili: Vec<&TagCount> = tags
        .iter()
        .filter(|t| cerca.is_empty() || t.name.to_lowercase().contains(&cerca))
        .collect();

    // Il campo c'è sempre, anche quando l'elenco è vuoto: se sparisse appena il
    // filtro non trova niente, cancellare l'ultima lettera sarebbe impossibile.
    let campo = UiNode::new(UiKind::TextInput {
        field: FILTER_FIELD.to_string(),
        label: None,
        value: filter.to_string(),
        placeholder: Some("filtra i tag".to_string()),
        action: Some(ActionRef::new(FILTER)),
    })
    // La chiave è ciò che dice al riconciliatore «questo campo è lo stesso di
    // prima»: senza, ogni ridisegno gli toglierebbe il focus di sotto.
    .with_key(FILTER_FIELD);

    let corpo = if visibili.is_empty() {
        UiNode::empty_state(if tags.is_empty() {
            "Nessun tag."
        } else {
            "Nessun tag col filtro."
        })
    } else {
        UiNode::list(
            visibili
                .iter()
                .map(|t| {
                    UiNode::list_item(
                        format!("#{}", t.name),
                        Some(t.count.to_string()),
                        Some(ActionRef::with(SEARCH, serde_json::json!({ TAG: t.name }))),
                    )
                    .with_key(t.name.clone())
                })
                .collect(),
        )
    };

    UiNode::column(4, vec![campo, corpo])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;

    fn tag(name: &str, count: u32) -> TagCount {
        TagCount {
            name: name.into(),
            count,
        }
    }

    /// I titoli delle voci, in ordine.
    fn voci(tree: &UiNode) -> Vec<String> {
        fn walk(node: &UiNode, out: &mut Vec<String>) {
            match &node.kind {
                UiKind::ListItem { title, .. } => out.push(title.clone()),
                UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
                UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }

    #[test]
    fn empty_shows_placeholder_and_keeps_the_filter_field() {
        let tree = build_tags_view(&[], "");
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        assert!(matches!(&children[0].kind, UiKind::TextInput { .. }));
        assert!(matches!(&children[1].kind, UiKind::EmptyState { .. }));
    }

    #[test]
    fn lists_tags_with_counts_and_search_payloads() {
        let tags = [tag("rust", 3), tag("a/b", 1)];
        let json = serde_json::to_string(&build_tags_view(&tags, "")).unwrap();
        assert!(json.contains("#rust"));
        assert!(json.contains("#a/b"));
        assert!(json.contains(r#""tag":"rust""#));
        assert!(!json.contains("tag:rust"), "l'id non porta più il nome");
    }

    #[test]
    fn render_asks_the_host_for_the_vault_tags() {
        let host = MemoryHost::new().con_tags(&[("rust", 2), ("note", 5)]);
        let tree = TagPanelView::default()
            .render_view(&ViewInstance::only(TAGS_VIEW), &host)
            .unwrap();
        assert_eq!(voci(&tree), ["#rust", "#note"]);
    }

    #[test]
    fn clicking_a_tag_asks_for_a_search() {
        let mut host = MemoryHost::new();
        let update = TagPanelView::default()
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(SEARCH).with_payload(serde_json::json!({TAG: "rust"})),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::RunSearch {
                query: "tags:rust".into()
            }
        );
    }

    /// Il collaudo del §2.4: ciò che si digita resta nel provider, e il
    /// ridisegno successivo lo mostra ancora. Con `&self` su `on_action` questo
    /// test non si sarebbe potuto nemmeno scrivere.
    #[test]
    fn the_filter_survives_between_two_renders() {
        let mut host = MemoryHost::new().con_tags(&[("rust", 2), ("ruggine", 1), ("note", 5)]);
        let mut view = TagPanelView::default();
        let istanza = ViewInstance::only(TAGS_VIEW);

        let update = view
            .on_action(
                &istanza,
                UiAction::new(FILTER).with_fields(vec![fubmd_abi::ui::FieldValue {
                    field: FILTER_FIELD.into(),
                    value: fubmd_abi::ui::UiValue::Text("rus".into()),
                }]),
                &mut host,
            )
            .unwrap();
        let ViewUpdate::Replace { root } = update else {
            panic!("filtrare ridisegna")
        };
        assert_eq!(voci(&root), ["#rust"]);

        // Il ridisegno che arriva dopo — un `IndexUpdated`, un cambio di nota —
        // non riparte da zero: il filtro è dove l'utente lo ha lasciato.
        let tree = view.render_view(&istanza, &host).unwrap();
        assert_eq!(voci(&tree), ["#rust"]);
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        let UiKind::TextInput { value, .. } = &children[0].kind else {
            panic!("il primo figlio è il campo")
        };
        assert_eq!(value, "rus", "il campo mostra ciò che si è digitato");
    }

    /// Un filtro che non trova niente non fa sparire il campo: senza, cancellare
    /// l'ultima lettera sarebbe impossibile.
    #[test]
    fn a_filter_that_matches_nothing_keeps_the_field() {
        let tree = build_tags_view(&[tag("rust", 1)], "zzz");
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        assert!(matches!(&children[0].kind, UiKind::TextInput { .. }));
        assert!(matches!(&children[1].kind, UiKind::EmptyState { .. }));
    }
}
