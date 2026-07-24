//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fubmd/abi.wit`. La
//! pressione è **bidirezionale**:
//!
//! 1. **Drift lato Rust** → i match/destructuring esaustivi qui sotto NON compilano
//!    se un enum guadagna una variante o un campo cambia nome: il compilatore
//!    obbliga ad aggiornare questo file (e quindi a riflettere il cambiamento nel
//!    WIT).
//! 2. **Drift lato WIT** → [`assert_present`] verifica che ogni nome atteso esista
//!    nel `.wit`: rinominare/rimuovere un tipo, una variante o un campo rende il
//!    test rosso.
//!
//! È un check **strutturale** (std-only: nessuna dipendenza, l'invariante di
//! `fubmd-abi` resta intatta). La validazione con tooling WIT reale
//! (`wit-parser` / `wit-bindgen`) è cablata a M4 — vedi `wit/README.md`.

use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventKind, EventMask};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{
    Block, DocId, DocumentModel, Frontmatter, Heading, Inline, Link, LinkTarget, Span, Tag,
};
use fubmd_abi::traits::{
    BacklinkRef, CommandOutcome, CommandSpec, IndexQuery, IndexResult, JobId, JobSpec,
    PluginManifest, PluginPermissions, SearchHit, ViewPlacement, ViewSpec,
};
use fubmd_abi::ui::{ActionId, Axis, Intent, UiAction, UiNode, ViewUpdate};

// ---------------------------------------------------------------------------
// Caricamento del WIT
// ---------------------------------------------------------------------------

fn wit_source() -> String {
    // CARGO_MANIFEST_DIR = crates/fubmd-abi ; il contratto è alla radice del repo.
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/fubmd/abi.wit");
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("impossibile leggere {path}: {e}"))
}

/// Verifica che ogni identificatore atteso (nome di tipo, variante o campo, in
/// kebab-case) compaia nel WIT. Semplice ma sufficiente a intercettare
/// rinomini/rimozioni lato contratto.
#[track_caller]
fn assert_present(wit: &str, names: &[&str]) {
    let missing: Vec<&str> = names.iter().copied().filter(|n| !wit.contains(n)).collect();
    assert!(
        missing.is_empty(),
        "identificatori assenti da wit/fubmd/abi.wit: {missing:?}\n\
         (se hai rinominato/rimosso qualcosa nel contratto, aggiorna il WIT o questo test)"
    );
}

// ---------------------------------------------------------------------------
// Esaustività lato Rust: se un tipo abi cambia, questi non compilano più.
// Ogni arm/destructuring restituisce i nomi kebab attesi nel WIT.
// ---------------------------------------------------------------------------

fn block_names(b: &Block) -> &'static [&'static str] {
    match b {
        Block::Heading {
            level,
            inlines,
            span,
        } => {
            let _ = (level, inlines, span);
            &["block-heading", "level", "inlines", "span"]
        }
        Block::Paragraph { inlines, span } => {
            let _ = (inlines, span);
            &["block-paragraph", "inlines", "span"]
        }
        Block::List {
            ordered,
            items,
            span,
        } => {
            let _ = (ordered, items, span);
            &["block-list", "ordered", "items", "span"]
        }
        Block::CodeBlock { lang, code, span } => {
            let _ = (lang, code, span);
            &["block-code-block", "lang", "code", "span"]
        }
        Block::Quote { blocks, span } => {
            let _ = (blocks, span);
            &["block-quote", "blocks", "span"]
        }
        Block::ThematicBreak { span } => {
            let _ = span;
            &["thematic-break"]
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            span,
        } => {
            let _ = (custom_kind, attrs, blocks, span);
            &["block-custom", "custom-kind", "attrs"]
        }
    }
}

fn inline_names(i: &Inline) -> &'static [&'static str] {
    match i {
        Inline::Text(s) => {
            let _ = s;
            &["text"]
        }
        Inline::Emph(v) => {
            let _ = v;
            &["emph"]
        }
        Inline::Strong(v) => {
            let _ = v;
            &["strong"]
        }
        Inline::Code(s) => {
            let _ = s;
            &["code"]
        }
        Inline::Link {
            target,
            label,
            span,
        } => {
            let _ = (target, label, span);
            &["inline-link", "target", "label"]
        }
        Inline::TagRef { name, span } => {
            let _ = (name, span);
            &["inline-tag-ref", "tag-ref", "name"]
        }
        Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => {
            let _ = (custom_kind, attrs, span);
            &["inline-custom"]
        }
    }
}

fn link_target_names(t: &LinkTarget) -> &'static [&'static str] {
    match t {
        LinkTarget::Wiki {
            page,
            heading,
            block,
            embed,
        } => {
            let _ = (page, heading, block, embed);
            &[
                "link-target-wiki",
                "wiki",
                "page",
                "heading",
                "block",
                "embed",
            ]
        }
        LinkTarget::Url(s) => {
            let _ = s;
            &["url"]
        }
        LinkTarget::Path(s) => {
            let _ = s;
            &["path"]
        }
    }
}

fn ui_node_names(n: &UiNode) -> &'static [&'static str] {
    match n {
        UiNode::Stack { dir, gap, children } => {
            let _ = (dir, gap, children);
            &["ui-stack", "stack", "dir", "gap", "children"]
        }
        UiNode::Text { content } => {
            let _ = content;
            &["text", "content"]
        }
        UiNode::Heading { level, content } => {
            let _ = (level, content);
            &["ui-heading", "heading", "level"]
        }
        UiNode::List { items } => {
            let _ = items;
            &["list"]
        }
        UiNode::ListItem {
            title,
            subtitle,
            action,
        } => {
            let _ = (title, subtitle, action);
            &["ui-list-item", "list-item", "title", "subtitle", "action"]
        }
        UiNode::Button {
            label,
            intent,
            action,
        } => {
            let _ = (label, intent, action);
            &["ui-button", "button", "label", "intent"]
        }
        UiNode::Html { html } => {
            let _ = html;
            &["html"]
        }
        UiNode::WebView { url, height } => {
            let _ = (url, height);
            &["ui-web-view", "web-view", "url", "height"]
        }
    }
}

fn view_update_names(v: &ViewUpdate) -> &'static [&'static str] {
    match v {
        ViewUpdate::Replace { root } => {
            let _ = root;
            &["replace"]
        }
        ViewUpdate::None => &["none"],
        ViewUpdate::Navigate { doc_id } => {
            let _ = doc_id;
            &["navigate"]
        }
    }
}

fn event_names(e: &Event) -> &'static [&'static str] {
    match e {
        Event::VaultOpened { root } => {
            let _ = root;
            &["vault-opened", "event-vault-opened", "root"]
        }
        Event::DocumentChanged { id } => {
            let _ = id;
            &["document-changed", "event-document-changed"]
        }
        Event::DocumentRemoved { id } => {
            let _ = id;
            &["document-removed", "event-document-removed"]
        }
        Event::DocumentRenamed { from, to } => {
            let _ = (from, to);
            &["document-renamed", "event-document-renamed", "from", "to"]
        }
        Event::IndexUpdated => &["index-updated"],
        Event::JobDone { id, job, result } => {
            let _ = (id, job, result);
            &["event-job-done", "job-done", "job", "result"]
        }
        Event::Overflow { dropped } => {
            let _ = dropped;
            &["event-overflow", "overflow", "dropped"]
        }
        Event::Custom { topic, payload } => {
            let _ = (topic, payload);
            &["event-custom", "custom", "topic", "payload"]
        }
    }
}

fn event_kind_names(k: EventKind) -> &'static [&'static str] {
    match k {
        EventKind::VaultOpened => &["vault-opened"],
        EventKind::DocumentChanged => &["document-changed"],
        EventKind::DocumentRemoved => &["document-removed"],
        EventKind::DocumentRenamed => &["document-renamed"],
        EventKind::IndexUpdated => &["index-updated"],
        EventKind::JobDone => &["job-done"],
        EventKind::Overflow => &["overflow"],
        EventKind::Custom => &["custom"],
    }
}

fn index_query_names(q: &IndexQuery) -> &'static [&'static str] {
    match q {
        IndexQuery::Backlinks { target } => {
            let _ = target;
            &["backlinks", "target"]
        }
        IndexQuery::FullText { query, limit } => {
            let _ = (query, limit);
            &["index-query-full-text", "full-text", "query", "limit"]
        }
        IndexQuery::Custom { ns, query } => {
            let _ = (ns, query);
            &["index-query-custom", "custom", "ns"]
        }
    }
}

fn index_result_names(r: &IndexResult) -> &'static [&'static str] {
    match r {
        IndexResult::Backlinks(v) => {
            let _ = v;
            &["backlinks"]
        }
        IndexResult::Search(v) => {
            let _ = v;
            &["search"]
        }
        IndexResult::Custom(v) => {
            let _ = v;
            &["custom"]
        }
    }
}

fn format_error_names(e: &FormatError) -> &'static [&'static str] {
    match e {
        FormatError::Parse(s) => {
            let _ = s;
            &["parse"]
        }
        FormatError::Render(s) => {
            let _ = s;
            &["render"]
        }
        FormatError::Serialize(s) => {
            let _ = s;
            &["serialize"]
        }
        FormatError::Unsupported(s) => {
            let _ = s;
            &["unsupported"]
        }
    }
}

fn plugin_error_names(e: &PluginError) -> &'static [&'static str] {
    match e {
        PluginError::UnknownCommand(s) => {
            let _ = s;
            &["unknown-command"]
        }
        PluginError::UnknownView(s) => {
            let _ = s;
            &["unknown-view"]
        }
        PluginError::UnknownJob(s) => {
            let _ = s;
            &["unknown-job"]
        }
        PluginError::BadArgs(s) => {
            let _ = s;
            &["bad-args"]
        }
        PluginError::PermissionDenied(s) => {
            let _ = s;
            &["permission-denied"]
        }
        PluginError::Internal(s) => {
            let _ = s;
            &["internal"]
        }
    }
}

fn axis_names(a: Axis) -> &'static [&'static str] {
    match a {
        Axis::Row => &["row"],
        Axis::Column => &["column"],
    }
}

fn intent_names(i: Intent) -> &'static [&'static str] {
    match i {
        Intent::Neutral => &["neutral"],
        Intent::Primary => &["primary"],
        Intent::Danger => &["danger"],
    }
}

fn view_placement_names(p: ViewPlacement) -> &'static [&'static str] {
    match p {
        ViewPlacement::LeftSidebar => &["left-sidebar"],
        ViewPlacement::RightSidebar => &["right-sidebar"],
        ViewPlacement::Bottom => &["bottom"],
    }
}

// Struct: destructuring esaustivo — un campo aggiunto/rinominato non compila.

fn struct_names() -> Vec<&'static str> {
    let mut names = Vec::new();

    let DocumentModel {
        id,
        frontmatter,
        body,
        outline,
        links,
        tags,
        text,
    } = DocumentModel::empty(DocId::new("x.md"));
    let _ = (id, frontmatter, body, outline, links, tags, text);
    names.extend([
        "document-model",
        "id",
        "frontmatter",
        "body",
        "outline",
        "links",
        "tags",
        "text",
    ]);

    let Span { start, end } = Span::EMPTY;
    let _ = (start, end);
    names.extend(["span", "start", "end"]);

    let Heading {
        level,
        text,
        slug,
        span,
    } = Heading {
        level: 1,
        text: String::new(),
        slug: String::new(),
        span: Span::EMPTY,
    };
    let _ = (level, text, slug, span);
    names.extend(["heading", "slug"]);

    let Tag { name, span } = Tag {
        name: String::new(),
        span: Span::EMPTY,
    };
    let _ = (name, span);
    names.extend(["tag", "name"]);

    let Link {
        target,
        span,
        context,
    } = Link {
        target: LinkTarget::wiki("p"),
        span: Span::EMPTY,
        context: None,
    };
    let _ = (target, span, context);
    names.extend(["link", "target", "context"]);

    let Frontmatter(map) = Frontmatter::default();
    let _ = map;
    names.push("frontmatter");

    let FormatDescriptor {
        id,
        name,
        extensions,
    } = FormatDescriptor {
        id: String::new(),
        name: String::new(),
        extensions: vec![],
    };
    let _ = (id, name, extensions);
    names.extend(["format-descriptor", "extensions"]);

    let FormatCapabilities {
        wikilinks,
        tags,
        frontmatter,
        callouts,
        embeds,
    } = FormatCapabilities::default();
    let _ = (wikilinks, tags, frontmatter, callouts, embeds);
    names.extend(["format-capabilities", "wikilinks", "callouts", "embeds"]);

    let ParseContext {
        doc_id,
        parse_tags,
        parse_wikilinks,
    } = ParseContext::default();
    let _ = (doc_id, parse_tags, parse_wikilinks);
    names.extend(["parse-context", "doc-id", "parse-tags", "parse-wikilinks"]);

    let RenderOptions {
        wikilinks_as_data_attrs,
    } = RenderOptions::default();
    let _ = wikilinks_as_data_attrs;
    names.extend(["render-options", "wikilinks-as-data-attrs"]);

    let CommandSpec {
        id,
        title,
        keybinding,
    } = CommandSpec {
        id: String::new(),
        title: String::new(),
        keybinding: None,
    };
    let _ = (id, title, keybinding);
    names.extend(["command-spec", "title", "keybinding"]);

    let CommandOutcome { notify } = CommandOutcome { notify: None };
    let _ = notify;
    names.extend(["command-outcome", "notify"]);

    let ViewSpec {
        id,
        title,
        placement,
    } = ViewSpec {
        id: String::new(),
        title: String::new(),
        placement: ViewPlacement::Bottom,
    };
    let _ = (id, title, placement);
    names.extend(["view-spec", "placement", "view-placement"]);

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    let _ = (source, context);
    names.extend(["backlink-ref", "source"]);

    let SearchHit {
        doc,
        score,
        snippet,
        highlights,
    } = SearchHit {
        doc: DocId::new("a"),
        score: 0.0,
        snippet: String::new(),
        highlights: Vec::new(),
    };
    let _ = (doc, score, snippet, highlights);
    names.extend(["search-hit", "doc", "score", "snippet", "highlights"]);

    let UiAction { action, payload } = UiAction {
        action: ActionId(String::new()),
        payload: serde_json::Value::Null,
    };
    let _ = (action, payload);
    names.extend(["ui-action", "action-id", "payload"]);

    let PluginPermissions {
        read_vault,
        write_vault,
        network,
    } = PluginPermissions::default();
    let _ = (read_vault, write_vault, network);
    names.extend(["plugin-permissions", "read-vault", "write-vault", "network"]);

    let PluginManifest {
        id,
        name,
        version,
        permissions,
    } = PluginManifest {
        id: String::new(),
        name: String::new(),
        version: String::new(),
        permissions: PluginPermissions::default(),
    };
    let _ = (id, name, version, permissions);
    names.extend(["plugin-manifest", "version", "permissions"]);

    let EventMask(kinds) = EventMask::all();
    let _ = kinds;
    names.extend(["event-mask", "event-kind"]);

    let JobSpec { job, payload } = JobSpec {
        job: String::new(),
        payload: serde_json::Value::Null,
    };
    let _ = (job, payload);
    names.extend(["job-spec", "job", "payload"]);

    let JobId(raw) = JobId(0);
    let _ = raw;
    names.push("job-id");

    names
}

// ---------------------------------------------------------------------------
// Il test
// ---------------------------------------------------------------------------

#[test]
fn abi_types_are_mirrored_in_wit() {
    let wit = wit_source();
    let mut expected: Vec<&'static str> = Vec::new();

    // Variant/enum: un rappresentante per ogni variante (l'esaustività è forzata
    // dal compilatore nei match sopra).
    expected.extend(block_names(&Block::ThematicBreak { span: Span::EMPTY }));
    expected.extend(block_names(&Block::Heading {
        level: 1,
        inlines: vec![],
        span: Span::EMPTY,
    }));
    expected.extend(block_names(&Block::Paragraph {
        inlines: vec![],
        span: Span::EMPTY,
    }));
    expected.extend(block_names(&Block::List {
        ordered: false,
        items: vec![],
        span: Span::EMPTY,
    }));
    expected.extend(block_names(&Block::CodeBlock {
        lang: None,
        code: String::new(),
        span: Span::EMPTY,
    }));
    expected.extend(block_names(&Block::Quote {
        blocks: vec![],
        span: Span::EMPTY,
    }));
    expected.extend(block_names(&Block::Custom {
        custom_kind: String::new(),
        attrs: serde_json::Value::Null,
        blocks: vec![],
        span: Span::EMPTY,
    }));

    expected.extend(inline_names(&Inline::Text(String::new())));
    expected.extend(inline_names(&Inline::Emph(vec![])));
    expected.extend(inline_names(&Inline::Strong(vec![])));
    expected.extend(inline_names(&Inline::Code(String::new())));
    expected.extend(inline_names(&Inline::Link {
        target: LinkTarget::wiki("p"),
        label: None,
        span: Span::EMPTY,
    }));
    expected.extend(inline_names(&Inline::TagRef {
        name: String::new(),
        span: Span::EMPTY,
    }));
    expected.extend(inline_names(&Inline::Custom {
        custom_kind: String::new(),
        attrs: serde_json::Value::Null,
        span: Span::EMPTY,
    }));

    expected.extend(link_target_names(&LinkTarget::wiki("p")));
    expected.extend(link_target_names(&LinkTarget::Url(String::new())));
    expected.extend(link_target_names(&LinkTarget::Path(String::new())));

    expected.extend(ui_node_names(&UiNode::Stack {
        dir: Axis::Row,
        gap: 0,
        children: vec![],
    }));
    expected.extend(ui_node_names(&UiNode::Text {
        content: String::new(),
    }));
    expected.extend(ui_node_names(&UiNode::Heading {
        level: 1,
        content: String::new(),
    }));
    expected.extend(ui_node_names(&UiNode::List { items: vec![] }));
    expected.extend(ui_node_names(&UiNode::ListItem {
        title: String::new(),
        subtitle: None,
        action: None,
    }));
    expected.extend(ui_node_names(&UiNode::Button {
        label: String::new(),
        intent: Intent::Neutral,
        action: ActionId(String::new()),
    }));
    expected.extend(ui_node_names(&UiNode::Html {
        html: String::new(),
    }));
    expected.extend(ui_node_names(&UiNode::WebView {
        url: String::new(),
        height: 0,
    }));

    expected.extend(view_update_names(&ViewUpdate::Replace {
        root: UiNode::Text {
            content: String::new(),
        },
    }));
    expected.extend(view_update_names(&ViewUpdate::None));
    expected.extend(view_update_names(&ViewUpdate::Navigate {
        doc_id: String::new(),
    }));

    expected.extend(event_names(&Event::VaultOpened {
        root: String::new(),
    }));
    expected.extend(event_names(&Event::DocumentChanged {
        id: DocId::new("a"),
    }));
    expected.extend(event_names(&Event::DocumentRemoved {
        id: DocId::new("a"),
    }));
    expected.extend(event_names(&Event::DocumentRenamed {
        from: DocId::new("a"),
        to: DocId::new("b"),
    }));
    expected.extend(event_names(&Event::IndexUpdated));
    expected.extend(event_names(&Event::JobDone {
        id: JobId(0),
        job: String::new(),
        result: Ok(serde_json::Value::Null),
    }));
    expected.extend(event_names(&Event::Overflow { dropped: 0 }));
    expected.extend(event_names(&Event::Custom {
        topic: String::new(),
        payload: serde_json::Value::Null,
    }));

    for k in [
        EventKind::VaultOpened,
        EventKind::DocumentChanged,
        EventKind::DocumentRemoved,
        EventKind::DocumentRenamed,
        EventKind::IndexUpdated,
        EventKind::JobDone,
        EventKind::Overflow,
        EventKind::Custom,
    ] {
        expected.extend(event_kind_names(k));
    }

    expected.extend(index_query_names(&IndexQuery::Backlinks {
        target: DocId::new("a"),
    }));
    expected.extend(index_query_names(&IndexQuery::FullText {
        query: String::new(),
        limit: 0,
    }));
    expected.extend(index_query_names(&IndexQuery::Custom {
        ns: String::new(),
        query: serde_json::Value::Null,
    }));
    expected.extend(index_result_names(&IndexResult::Backlinks(vec![])));
    expected.extend(index_result_names(&IndexResult::Search(vec![])));
    expected.extend(index_result_names(&IndexResult::Custom(
        serde_json::Value::Null,
    )));

    for e in [
        FormatError::Parse(String::new()),
        FormatError::Render(String::new()),
        FormatError::Serialize(String::new()),
        FormatError::Unsupported(String::new()),
    ] {
        expected.extend(format_error_names(&e));
    }
    for e in [
        PluginError::UnknownCommand(String::new()),
        PluginError::UnknownView(String::new()),
        PluginError::UnknownJob(String::new()),
        PluginError::BadArgs(String::new()),
        PluginError::PermissionDenied(String::new()),
        PluginError::Internal(String::new()),
    ] {
        expected.extend(plugin_error_names(&e));
    }

    for a in [Axis::Row, Axis::Column] {
        expected.extend(axis_names(a));
    }
    for i in [Intent::Neutral, Intent::Primary, Intent::Danger] {
        expected.extend(intent_names(i));
    }
    for p in [
        ViewPlacement::LeftSidebar,
        ViewPlacement::RightSidebar,
        ViewPlacement::Bottom,
    ] {
        expected.extend(view_placement_names(p));
    }

    expected.extend(struct_names());

    // Le interfacce/host-api e il world attesi nel contratto.
    expected.extend([
        "package fubmd:abi",
        "world plugin-world",
        "interface model",
        "interface format",
        "interface ui",
        "interface events",
        "interface command",
        "interface index",
        "interface view",
        "interface host-api",
        "interface plugin",
        "interface event-handler",
        "interface errors",
        "interface jobs",
        "read-document",
        "write-document",
        "spawn-job",
        "run-job",
        "storage-get",
        "storage-set",
        "on-document-indexed",
        "on-document-removed",
        "reconcile",
        "flush",
    ]);

    expected.sort_unstable();
    expected.dedup();
    assert_present(&wit, &expected);
}
