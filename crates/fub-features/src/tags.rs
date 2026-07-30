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
//! inventare. La seduta 2 lo mise in un campo di questa struct, come in
//! qualunque oggetto vivo, e la firma lo permette perché il kernel estrae il
//! provider per la durata dell'azione.
//!
//! # …ed è anche il primo cliente dello stato di vista (§11.2)
//!
//! Quel campo aveva due difetti che si vedevano solo usandolo. Moriva alla
//! chiusura: si ridigitava lo stesso filtro a ogni avvio. Ed era **uno per
//! provider e non per pannello**, perché il provider è uno solo: due esemplari
//! dello stesso pannello — che il §7.4 permette dal giorno in cui una view ha un
//! esemplare — avrebbero condiviso il filtro credendo di averne uno per uno.
//!
//! Ora il filtro sta nello stato di vista, dove la chiave la compone l'host con
//! dentro l'esemplare, e questa struct non ha più campi. È la stessa distinzione
//! che il §11.2 fa fra i tre stati: il filtro **non** è un'impostazione (non lo
//! decide l'utente in un pannello, si deposita mentre si guarda) e **non** è un
//! blob (non è un fatto sul vault: non deve viaggiare con lui).
//!
//! Il giro completo che ne esce è quello che il §2.8 esiste per proteggere: si
//! digita → `on_action` con i `fields` → il provider filtra e risponde
//! `Replace` → la shell **riconcilia** invece di ricostruire, e il campo di
//! testo non perde il focus. Con l'albero ricostruito da zero, scrivere due
//! lettere di fila sarebbe impossibile.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::query::QueryExpr;
use fub_abi::session::ContextMask;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, TagCount, ViewInstance, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const TAGS_ID: &str = "fub.tags";
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
/// La chiave sotto cui il filtro **resta scritto** nello stato di vista (§11.2).
///
/// Vale oggi la stessa stringa del campo, e resta una costante sua: quello è il
/// nome di un campo dentro un albero `UiNode` — roba di questo disegno, che si
/// rinomina il giorno che il pannello cambia forma — questa è una chiave che sta
/// su disco e che qualcuno ha già scritto. Con una costante sola, rinominare il
/// campo avrebbe cambiato in silenzio la chiave salvata, e il filtro di chiunque
/// sarebbe sparito senza che nessuno avesse toccato lo stato di vista.
const FILTER_STATE: &str = "filter";

/// Il titolo del pannello. Era l'unica stringa di questo file rimasta fuori dal
/// catalogo, ed era anche la più visibile: un pannello si vede sempre, il suo
/// segnaposto solo quando è vuoto.
const VIEW_TITLE: &str = "view_title";
/// Il testo grigio dentro il campo filtro.
const FILTER_PLACEHOLDER: &str = "filter_placeholder";
/// Il vault non ha nessun tag.
const EMPTY: &str = "empty";
/// I tag ci sono, ma nessuno passa il filtro. È un altro stato, e lo dice
/// diversamente: cancellare il filtro è un'azione, creare un tag è un'altra.
const NO_MATCH: &str = "no_match";

/// Le stringhe del pannello tag. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Tag")
            .with(FILTER_PLACEHOLDER, "filtra i tag")
            .with(EMPTY, "Nessun tag.")
            .with(NO_MATCH, "Nessun tag col filtro."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Tags")
            .with(FILTER_PLACEHOLDER, "filter tags")
            .with(EMPTY, "No tags.")
            .with(NO_MATCH, "No tags match the filter."),
    ]
}

/// Il pannello tag.
///
/// **Senza campi**: il filtro sta nello stato di vista dell'esemplare (§11.2),
/// che è il primo cliente vero di quella capacità. Prima stava in un campo di
/// questa struct, e quel campo aveva due difetti che si vedevano solo usandolo:
/// moriva alla chiusura — si ridigitava lo stesso filtro a ogni avvio — ed era
/// **uno per provider e non per pannello**, quindi due esemplari dello stesso
/// pannello avrebbero condiviso il filtro credendo di averne uno per uno. Lo
/// stato di vista li risolve entrambi perché la chiave che l'host compone porta
/// dentro l'esemplare.
pub struct TagPanelView;

impl ViewProvider for TagPanelView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Finché il posto era lettera morta la shell metteva il pannello a
            // destra per conoscenza privata; ora che il montaggio lo rispetta,
            // la dichiarazione dice la stessa cosa.
            ViewSpec::new(TAGS_VIEW, Text::key(VIEW_TITLE), ViewSurface::RightSidebar)
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
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // Il filtro è cambiato: lo si **ricorda** e si ridisegna. Il valore
            // arriva dai `fields`, che è dove la shell mette ciò che l'utente
            // ha digitato — il `payload` è dell'altro proprietario.
            //
            // Un filtro vuoto si **dimentica** invece di scrivere `""`: la
            // chiave torna a non esserci, che è ciò che significa, e il file non
            // si porta dietro una riga per ogni pannello che qualcuno ha aperto
            // e ripulito.
            FILTER => {
                let filter = action.text_field(FILTER_FIELD).unwrap_or_default();
                let value = (!filter.is_empty()).then(|| serde_json::Value::from(filter));
                host.set_view_state(FILTER_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
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

/// L'albero del pannello: i tag del vault, filtrati da ciò che si è digitato.
///
/// Prende un `&dyn ReadApi` e non un `&mut`: serve a entrambi i percorsi — il
/// render (lettura) e la risposta a un'azione — e prenderlo in sola lettura è
/// ciò che rende ovvio che disegnare non scrive. È anche la ragione per cui lo
/// stato di vista ha **due** famiglie invece di una: qui si rilegge il filtro da
/// sotto un prestito condiviso, e da qui non si deve poter scrivere.
///
/// Non è più un metodo: questo provider non ha più niente di suo da leggere.
fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    // Senza finestra: il pannello mostra la distribuzione intera, ed è la
    // ragione per cui la `Page` è opzionale invece che obbligatoria.
    let tags = match host.query_index(IndexQuery::Tags {
        matching: QueryExpr::all(),
        page: None,
    })? {
        IndexResult::Tags(t) => t,
        other => {
            return Err(PluginError::Internal(
                format!("query tag: risposta fuori tema: {other:?}").into(),
            ))
        }
    };
    Ok(build_tags_view(&tags.items, &filter_of(host)?))
}

/// Il filtro che questo esemplare aveva lasciato scritto.
///
/// Assente è vuoto — il caso normale del primo disegno — e **anche un valore che
/// non è una stringa lo è**: questo file lo si può aprire con un editor di testo
/// (è la stessa promessa fatta alle impostazioni nella 0036), e un numero
/// scritto a mano dentro `filter` non vale un pannello che smette di funzionare.
fn filter_of(host: &dyn ReadApi) -> Result<String, PluginError> {
    Ok(host
        .view_state(FILTER_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default())
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
        placeholder: Some(Text::key(FILTER_PLACEHOLDER)),
        action: Some(ActionRef::new(FILTER)),
    })
    // La chiave è ciò che dice al riconciliatore «questo campo è lo stesso di
    // prima»: senza, ogni ridisegno gli toglierebbe il focus di sotto.
    .with_key(FILTER_FIELD);

    let corpo = if visibili.is_empty() {
        UiNode::empty_state(Text::key(if tags.is_empty() { EMPTY } else { NO_MATCH }))
    } else {
        UiNode::list(
            visibili
                .iter()
                .map(|t| {
                    UiNode::list_item(
                        format!("#{}", t.name),
                        Some(Text::from(t.count.to_string())),
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
    use fub_abi::traits::{ViewStateRead, ViewStateWrite};
    use fub_sdk::testing::MemoryHost;

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
                UiKind::ListItem { title, .. } => out.push(title.to_string()),
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
        let tree = TagPanelView
            .render_view(&ViewInstance::only(TAGS_VIEW), &host)
            .unwrap();
        assert_eq!(voci(&tree), ["#rust", "#note"]);
    }

    #[test]
    fn clicking_a_tag_asks_for_a_search() {
        let mut host = MemoryHost::new();
        let update = TagPanelView
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

    /// Digita `text` nel campo filtro e torna l'albero ridisegnato.
    fn digita(view: &mut TagPanelView, host: &mut MemoryHost, text: &str) -> UiNode {
        let update = view
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(FILTER).with_fields(vec![fub_abi::ui::FieldValue {
                    field: FILTER_FIELD.into(),
                    value: fub_abi::ui::UiValue::Text(text.into()),
                }]),
                host,
            )
            .unwrap();
        let ViewUpdate::Replace { root } = update else {
            panic!("filtrare ridisegna")
        };
        root
    }

    /// Il valore mostrato dal campo di testo.
    fn campo(tree: &UiNode) -> String {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        let UiKind::TextInput { value, .. } = &children[0].kind else {
            panic!("il primo figlio è il campo")
        };
        value.clone()
    }

    /// Il collaudo del §2.4, ora sullo stato di vista: ciò che si digita
    /// sopravvive al ridisegno.
    #[test]
    fn the_filter_survives_between_two_renders() {
        let mut host = MemoryHost::new()
            .con_tags(&[("rust", 2), ("ruggine", 1), ("note", 5)])
            .con_esemplare("uno");
        let mut view = TagPanelView;
        let istanza = ViewInstance::only(TAGS_VIEW);

        assert_eq!(voci(&digita(&mut view, &mut host, "rus")), ["#rust"]);

        // Il ridisegno che arriva dopo — un `IndexUpdated`, un cambio di nota —
        // non riparte da zero: il filtro è dove l'utente lo ha lasciato.
        let tree = view.render_view(&istanza, &host).unwrap();
        assert_eq!(voci(&tree), ["#rust"]);
        assert_eq!(campo(&tree), "rus", "il campo mostra ciò che si è digitato");
    }

    /// Il guadagno del §11.2, e la ragione per cui la chiave porta l'esemplare:
    /// due pannelli aperti sullo stesso vault hanno **due filtri**. Col filtro in
    /// un campo del provider — che è uno solo — questa prova non poteva passare.
    #[test]
    fn two_instances_of_the_panel_filter_apart() {
        let mut host = MemoryHost::new()
            .con_tags(&[("rust", 2), ("note", 5)])
            .con_esemplare("uno");
        let mut view = TagPanelView;
        let istanza = ViewInstance::only(TAGS_VIEW);

        assert_eq!(voci(&digita(&mut view, &mut host, "rus")), ["#rust"]);

        // Lo stesso pannello, aperto una seconda volta: il filtro dell'altro non
        // è suo.
        host.passa_a_esemplare("due");
        let tree = view.render_view(&istanza, &host).unwrap();
        assert_eq!(voci(&tree), ["#rust", "#note"]);
        assert_eq!(campo(&tree), "");

        // …e filtrare qui non tocca quello di là.
        assert_eq!(voci(&digita(&mut view, &mut host, "not")), ["#note"]);
        host.passa_a_esemplare("uno");
        assert_eq!(
            voci(&view.render_view(&istanza, &host).unwrap()),
            ["#rust"],
            "il primo esemplare ha ancora il suo"
        );
    }

    /// Un filtro ripulito **dimentica** la chiave invece di scriverci `""`: è
    /// ciò che «nessun filtro» significa, e tiene il file dalla parte di chi lo
    /// pota. Provata dal di fuori — dal comportamento — perché il posto in cui
    /// finisce è dell'host.
    #[test]
    fn clearing_the_filter_forgets_it() {
        let mut host = MemoryHost::new()
            .con_tags(&[("rust", 2), ("note", 5)])
            .con_esemplare("uno");
        let mut view = TagPanelView;
        digita(&mut view, &mut host, "rus");
        assert_eq!(voci(&digita(&mut view, &mut host, "")), ["#rust", "#note"]);
        assert_eq!(host.view_state(FILTER_STATE).unwrap(), None);
    }

    /// Fuori da un esemplare **non si scrive**: il pannello dice che non ha
    /// ricordato, invece di far credere all'utente che il filtro sia salvo.
    #[test]
    fn filtering_outside_an_instance_says_so() {
        let mut host = MemoryHost::new().con_tags(&[("rust", 2)]);
        let e = TagPanelView
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(FILTER).with_fields(vec![fub_abi::ui::FieldValue {
                    field: FILTER_FIELD.into(),
                    value: fub_abi::ui::UiValue::Text("rus".into()),
                }]),
                &mut host,
            )
            .expect_err("nessun esemplare, nessuno stato di vista");
        assert!(matches!(e, PluginError::BadArgs(_)), "{e:?}");
    }

    /// Un valore scritto a mano che non è una stringa non fa cadere il pannello:
    /// il file si apre con un editor di testo, ed è una promessa che si mantiene
    /// anche quando qualcuno ci scrive dentro una sciocchezza.
    #[test]
    fn a_filter_that_is_not_a_string_reads_as_empty() {
        let mut host = MemoryHost::new()
            .con_tags(&[("rust", 2), ("note", 5)])
            .con_esemplare("uno");
        host.set_view_state(FILTER_STATE, Some(serde_json::json!(42)))
            .unwrap();
        let tree = TagPanelView
            .render_view(&ViewInstance::only(TAGS_VIEW), &host)
            .unwrap();
        assert_eq!(voci(&tree), ["#rust", "#note"]);
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
