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
    let Some(roots) = children.iter().find_map(|child| match &child.kind {
        UiKind::Tree { roots } => Some(roots),
        _ => None,
    }) else {
        panic!("the outline has a tree")
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

/// Le etichette selezionate, in ordine di lettura.
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

/// Gli `expanded` delle voci, in ordine di lettura.
fn opened(node: &UiNode, out: &mut Vec<bool>) {
    if let UiKind::TreeItem {
        expanded, children, ..
    } = &node.kind
    {
        out.push(*expanded);
        for child in children {
            opened(child, out);
        }
    } else {
        for child in node.children() {
            opened(child, out);
        }
    }
}

fn filter_action(value: &str) -> UiAction {
    UiAction::new(FILTER).with_fields(vec![fub_abi::ui::FieldValue {
        field: FILTER_FIELD.to_string(),
        value: fub_abi::ui::UiValue::Text(value.to_string()),
    }])
}

fn replaced(update: ViewUpdate) -> UiNode {
    let ViewUpdate::Replace { root } = update else {
        panic!("the outline redraws itself")
    };
    root
}

#[test]
fn the_filter_keeps_matching_headings_with_their_ancestors() {
    let mut host = MemoryHost::new()
        .with_instance("struttura")
        .with_document("nota.md", "x")
        .with_outline(
            "nota.md",
            &[
                h(1, "Uno", 0, 1),
                h(2, "Mele rosse", 2, 3),
                h(2, "Pere", 4, 5),
                h(1, "Due", 6, 7),
                h(3, "Altre mele", 8, 9),
            ],
        );
    host.set_active(Some("nota.md"));
    let instance = ViewInstance::only(OUTLINE_VIEW);
    let tree = replaced(
        OutlineView
            .on_action(&instance, filter_action("MELE"), &mut host)
            .unwrap(),
    );
    assert_eq!(
        entries(&tree),
        [
            (0, "Uno".to_string(), false),
            (1, "Mele rosse".to_string(), false),
            (0, "Due".to_string(), false),
            (1, "Altre mele".to_string(), false),
        ]
    );
    let none = replaced(
        OutlineView
            .on_action(&instance, filter_action("kiwi"), &mut host)
            .unwrap(),
    );
    assert!(none
        .children()
        .iter()
        .any(|child| matches!(child.kind, UiKind::EmptyState { .. })));
    let all = replaced(
        OutlineView
            .on_action(&instance, filter_action("  "), &mut host)
            .unwrap(),
    );
    assert_eq!(entries(&all).len(), 5);
}

#[test]
fn collapse_all_closes_every_heading_and_toggles_back() {
    let mut host = MemoryHost::new()
        .with_instance("struttura")
        .with_document("nota.md", "x")
        .with_outline("nota.md", &[h(1, "Uno", 0, 1), h(2, "Due", 2, 3)]);
    host.set_active(Some("nota.md"));
    let instance = ViewInstance::only(OUTLINE_VIEW);
    let mut states = Vec::new();
    let drawn = OutlineView.render_view(&instance, &host).unwrap();
    opened(&drawn, &mut states);
    assert_eq!(states, [true, true]);
    let closed = replaced(
        OutlineView
            .on_action(&instance, UiAction::new(COLLAPSE), &mut host)
            .unwrap(),
    );
    let mut states = Vec::new();
    opened(&closed, &mut states);
    assert_eq!(states, [false, false]);
    // Un filtro apre quello che trova anche a pannello compresso.
    let found = replaced(
        OutlineView
            .on_action(&instance, filter_action("due"), &mut host)
            .unwrap(),
    );
    let mut states = Vec::new();
    opened(&found, &mut states);
    assert_eq!(states, [true, true]);
    OutlineView
        .on_action(&instance, filter_action(""), &mut host)
        .unwrap();
    let open = replaced(
        OutlineView
            .on_action(&instance, UiAction::new(COLLAPSE), &mut host)
            .unwrap(),
    );
    let mut states = Vec::new();
    opened(&open, &mut states);
    assert_eq!(states, [true, true]);
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
fn only_the_outline_follows_the_selection() {
    let follows = |view: &str| OutlineView.interests(&ViewInstance::only(view)).follows.0;
    assert_eq!(
        follows(OUTLINE_VIEW),
        vec![ContextKind::Document, ContextKind::Selection]
    );
    // Le note non segnano il cursore: una selezione che si sposta non le
    // riparsa.
    assert_eq!(follows(FOOTNOTES_VIEW), vec![ContextKind::Document]);
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

/// «In entrata» sotto la Struttura (S2 T13): chi punta alla nota aperta,
/// letto dall'indice del kernel con una domanda sola.
mod incoming {
    use super::*;
    use fub_abi::edit::EditRequest;
    use fub_abi::format::{DocumentFormat, LinkInsert};
    use fub_abi::locale::Locale;
    use fub_abi::model::{DocumentModel, TaskMarker};
    use fub_abi::session::ViewContext;
    use fub_abi::settings::SettingValue;
    use fub_abi::text::Strings;
    use fub_abi::traits::{
        DataRead, HostEnv, HostQuery, SettingsRead, TransferRead, TrashEntry, VaultRead,
        ViewStateRead,
    };
    use std::sync::Mutex;

    /// Un host che conta le domande all'indice e, a richiesta, fa fallire
    /// quella dei backlink. Il resto lo fa il `MemoryHost` che avvolge.
    struct Spy {
        inner: MemoryHost,
        asked: Mutex<Vec<IndexQuery>>,
        backlinks_fail: bool,
    }

    impl Spy {
        fn new(inner: MemoryHost) -> Self {
            Spy {
                inner,
                asked: Mutex::new(Vec::new()),
                backlinks_fail: false,
            }
        }
    }

    impl HostQuery for Spy {
        fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
            self.asked.lock().unwrap().push(query.clone());
            if self.backlinks_fail && matches!(query, IndexQuery::Backlinks { .. }) {
                return Err(PluginError::Io("l'indice non risponde".into()));
            }
            self.inner.query_index(query)
        }
    }

    impl VaultRead for Spy {
        fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
            self.inner.read_document(id)
        }
        fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
            self.inner.read_document_bytes(id)
        }
        fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
            self.inner.document_revision(id)
        }
        fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
            self.inner.list_documents(page)
        }
        fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
            self.inner.read_model(id)
        }
        fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
            self.inner.format_of(id)
        }
        fn free_name(&self, id: &DocId) -> DocId {
            self.inner.free_name(id)
        }
        fn format_link(
            &self,
            doc: &DocId,
            link: &LinkInsert,
        ) -> Result<Option<String>, PluginError> {
            self.inner.format_link(doc, link)
        }
        fn task_state_edit(
            &self,
            doc: &DocId,
            marker: &TaskMarker,
            done: bool,
        ) -> Result<Option<EditRequest>, PluginError> {
            self.inner.task_state_edit(doc, marker, done)
        }
        fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
            self.inner.list_trash()
        }
    }

    impl DataRead for Spy {
        fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
            self.inner.data_read(path)
        }
        fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
            self.inner.data_list(prefix)
        }
        fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
            self.inner.cache_read(path)
        }
    }

    impl SettingsRead for Spy {
        fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
            self.inner.setting(key)
        }
    }

    impl ViewStateRead for Spy {
        fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
            self.inner.view_state(key)
        }
    }

    impl HostEnv for Spy {
        fn now_unix_millis(&self) -> u64 {
            self.inner.now_unix_millis()
        }
        fn user_locale(&self) -> Locale {
            self.inner.user_locale()
        }
        fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
            self.inner.random_bytes(n)
        }
        fn active_context(&self) -> Option<ViewContext> {
            self.inner.active_context()
        }
    }

    impl TransferRead for Spy {
        fn read_source(
            &self,
            handle: fub_abi::transfer::SourceHandle,
            offset: u64,
            len: u32,
        ) -> Result<Vec<u8>, PluginError> {
            self.inner.read_source(handle, offset, len)
        }
    }

    /// La nota aperta, con due titoli, citata da `sources`.
    fn host(sources: &[&str]) -> MemoryHost {
        let host = MemoryHost::new()
            .with_document("nota.md", "# Uno\n\n## Due\n")
            .with_outline("nota.md", &[h(1, "Uno", 0, 5), h(2, "Due", 7, 13)])
            .with_backlink("nota.md", sources);
        host.set_active(Some("nota.md"));
        host
    }

    fn render(host: &dyn ReadApi) -> UiNode {
        OutlineView
            .render_view(&ViewInstance::only(OUTLINE_VIEW), host)
            .unwrap()
    }

    /// La sezione «In entrata», se c'è, fra i figli della radice.
    fn section(tree: &UiNode) -> Option<&UiNode> {
        let UiKind::Stack { children, .. } = &tree.kind else {
            return None;
        };
        children
            .iter()
            .find(|child| child.key.as_deref() == Some(INCOMING_SECTION))
    }

    fn rendered(text: &Text, language: &str) -> String {
        let catalogs = catalog();
        let locale = Locale {
            language: language.into(),
            ..Locale::default()
        };
        Strings::new(&catalogs, "en", &locale).render(text)
    }

    /// Titolo della sezione e righe `(titolo, sottotitolo)`, in italiano.
    fn read(section: &UiNode) -> (String, Vec<(String, Option<String>)>) {
        let UiKind::Section {
            title,
            collapsed,
            children,
        } = &section.kind
        else {
            panic!("«In entrata» è una sezione: {section:?}");
        };
        assert!(!collapsed, "la sezione nasce aperta");
        let [list] = children.as_slice() else {
            panic!("dentro c'è un elenco solo");
        };
        let UiKind::List { items } = &list.kind else {
            panic!("dentro c'è un elenco: {list:?}");
        };
        let rows = items
            .iter()
            .map(|item| match &item.kind {
                UiKind::ListItem {
                    title, subtitle, ..
                } => (
                    rendered(title, "it"),
                    subtitle.as_ref().map(|s| rendered(s, "it")),
                ),
                other => panic!("ogni riga è una voce: {other:?}"),
            })
            .collect();
        (rendered(title, "it"), rows)
    }

    #[test]
    fn without_incoming_links_there_is_no_section() {
        let tree = render(&host(&[]));
        assert!(section(&tree).is_none());
        assert_eq!(entries(&tree).len(), 2, "l'albero resta quello di prima");
    }

    #[test]
    fn three_incoming_notes_are_three_rows_under_the_tree() {
        let tree = render(&host(&[
            "Guida/Sintassi di Fub.md",
            "Progetti/Il banco che vede.md",
            "Benvenuto.md",
        ]));
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("la Struttura è una colonna");
        };
        let tree_at = children
            .iter()
            .position(|child| matches!(child.kind, UiKind::Tree { .. }))
            .unwrap();
        let section_at = children
            .iter()
            .position(|child| child.key.as_deref() == Some(INCOMING_SECTION))
            .unwrap();
        assert_eq!(
            section_at,
            tree_at + 1,
            "la sezione sta subito sotto l'albero"
        );
        let (title, rows) = read(&children[section_at]);
        assert_eq!(title, "In entrata · 3");
        assert_eq!(
            rows,
            [
                ("Sintassi di Fub".to_string(), Some("Guida".to_string())),
                (
                    "Il banco che vede".to_string(),
                    Some("Progetti".to_string())
                ),
                // Nella radice non c'è una cartella da dire.
                ("Benvenuto".to_string(), None),
            ]
        );
        let UiKind::Section { children, .. } = &children[section_at].kind else {
            unreachable!()
        };
        let UiKind::List { items } = &children[0].kind else {
            unreachable!()
        };
        // Ogni riga apre la sua nota e si trascina come la nota che nomina.
        let first = &items[0];
        assert_eq!(first.key.as_deref(), Some("Guida/Sintassi di Fub.md#0"));
        let json = serde_json::to_string(first).unwrap();
        assert!(
            json.contains(r#""drag":{"kind":"document","doc":"Guida/Sintassi di Fub.md"}"#),
            "{json}"
        );
        let UiKind::ListItem {
            action: Some(action),
            ..
        } = &first.kind
        else {
            panic!("la riga è attivabile");
        };
        let mut host = host(&["Guida/Sintassi di Fub.md"]);
        let update = OutlineView
            .on_action(
                &ViewInstance::only(OUTLINE_VIEW),
                UiAction::new(&action.action.0).with_payload(action.payload.clone()),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Navigate {
                doc_id: "Guida/Sintassi di Fub.md".into()
            }
        );
    }

    #[test]
    fn past_five_notes_a_row_says_how_many_more_and_leads_to_the_links() {
        let sources: Vec<String> = (1..=7).map(|n| format!("Diario/Giorno {n}.md")).collect();
        let sources: Vec<&str> = sources.iter().map(String::as_str).collect();
        let tree = render(&host(&sources));
        let (title, rows) = read(section(&tree).unwrap());
        assert_eq!(title, "In entrata · 7");
        assert_eq!(rows.len(), 6, "cinque note e «e altri»");
        assert_eq!(rows[5], ("e altri 2".to_string(), None));
        let mut host = host(&sources);
        let update = OutlineView
            .on_action(
                &ViewInstance::only(OUTLINE_VIEW),
                UiAction::new(SHOW_INCOMING),
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Custom {
                ns: INSPECTOR_TAB_NS.into(),
                payload: serde_json::json!({ "view": "backlinks" }),
            }
        );
    }

    #[test]
    fn exactly_five_notes_have_no_more_row() {
        let sources: Vec<String> = (1..=5).map(|n| format!("Giorno {n}.md")).collect();
        let sources: Vec<&str> = sources.iter().map(String::as_str).collect();
        let (title, rows) = read(section(&render(&host(&sources))).unwrap());
        assert_eq!(title, "In entrata · 5");
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|(title, _)| !title.starts_with("e altri")));
    }

    #[test]
    fn a_failed_read_leaves_the_outline_as_it_was() {
        let mut spy = Spy::new(host(&["Altra.md"]));
        spy.backlinks_fail = true;
        let tree = render(&spy);
        assert!(section(&tree).is_none());
        assert_eq!(entries(&tree).len(), 2);
    }

    /// La Struttura segue il cursore: ogni pausa la ridisegna. «In entrata»
    /// costa una domanda in più all'indice, una sola, con la finestra delle
    /// righe che si mostrano.
    #[test]
    fn each_render_asks_the_index_once_more_for_at_most_five_rows() {
        let spy = Spy::new(host(&["Uno.md", "Due.md"]));
        render(&spy);
        let asked = spy.asked.lock().unwrap();
        assert_eq!(asked.len(), 2, "i titoli e chi punta qui: {asked:?}");
        assert!(matches!(asked[0], IndexQuery::Outline { .. }));
        assert_eq!(
            asked[1],
            IndexQuery::Backlinks {
                target: DocId::new("nota.md"),
                page: Some(Page {
                    offset: 0,
                    limit: 5
                }),
            }
        );
    }

    #[test]
    fn a_note_that_links_to_itself_is_a_row_like_the_others() {
        let (title, rows) = read(section(&render(&host(&["nota.md"]))).unwrap());
        assert_eq!(title, "In entrata · 1");
        assert_eq!(rows, [("nota".to_string(), None)]);
    }

    #[test]
    fn a_note_without_headings_still_shows_who_links_to_it() {
        let host = MemoryHost::new()
            .with_document("nota.md", "solo testo\n")
            .with_backlink("nota.md", &["Disegni/Schizzo.svg", "Carte/Atto.pdf"]);
        host.set_active(Some("nota.md"));
        let tree = render(&host);
        let (title, rows) = read(section(&tree).unwrap());
        assert_eq!(title, "In entrata · 2");
        // Un link da un disegno o da un PDF è una nota in entrata come le altre.
        assert_eq!(
            rows,
            [
                ("Schizzo".to_string(), Some("Disegni".to_string())),
                ("Atto".to_string(), Some("Carte".to_string())),
            ]
        );
    }

    #[test]
    fn the_folder_of_a_folder_page_is_the_one_above() {
        assert_eq!(
            folder_of(&DocId::new("Progetti/Fub/_index.md")).as_deref(),
            Some("Progetti")
        );
        assert_eq!(folder_of(&DocId::new("Fub/_index.md")), None);
        assert_eq!(folder_of(&DocId::new("a/b/c.md")).as_deref(), Some("b"));
    }

    #[test]
    fn the_words_exist_in_english_too() {
        let sources: Vec<String> = (1..=6).map(|n| format!("N{n}.md")).collect();
        let sources: Vec<&str> = sources.iter().map(String::as_str).collect();
        let tree = render(&host(&sources));
        let UiKind::Section {
            title, children, ..
        } = &section(&tree).unwrap().kind
        else {
            unreachable!()
        };
        assert_eq!(rendered(title, "en"), "Incoming · 6");
        let UiKind::List { items } = &children[0].kind else {
            unreachable!()
        };
        let UiKind::ListItem { title, .. } = &items[5].kind else {
            unreachable!()
        };
        assert_eq!(rendered(title, "en"), "and 1 more");
    }
}
