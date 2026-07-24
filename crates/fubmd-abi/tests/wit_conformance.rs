//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fubmd/abi.wit`. La
//! pressione è su **tre** direzioni:
//!
//! 1. **Il WIT deve essere valido** — il file viene dato in pasto a `wit-parser`.
//!    Un contratto che non parsa è un test rosso, non un file di testo che
//!    "sembra giusto". (È il criterio di chiusura del punto 1 del piano di
//!    aggiustamento: prima di questo test il WIT era invalido e il test verde.)
//! 2. **Drift lato Rust** → i match/destructuring esaustivi qui sotto NON compilano
//!    se un enum guadagna una variante o un campo cambia nome: il compilatore
//!    obbliga ad aggiornare questo file (e quindi a riflettere il cambiamento nel
//!    WIT).
//! 3. **Drift lato WIT, nelle due direzioni** — il confronto è fra **insiemi di
//!    nomi dichiarati** estratti dal parse, non fra sottostringhe del sorgente.
//!    Un tipo/caso/campo atteso e assente fallisce; un tipo/caso/campo dichiarato
//!    nel WIT e ignoto all'abi fallisce ugualmente (codice morto del contratto).
//!
//! **Perché non basta il substring matching** (com'era prima): `wit.contains("tag")`
//! è vero grazie a `inline-tag-ref`, `wit.contains("text")` grazie a `full-text`.
//! Metà dei nomi risultava "coperta" gratis, e nessun campo era davvero verificato.
//!
//! `wit-parser` è una **dev-dependency**: l'invariante architetturale di
//! `fubmd-abi` riguarda le dipendenze normali (nulla di markdown/tauri/wasm nel
//! grafo di build della libreria), ed è protetta dal suo test in
//! `tests/dependency_invariant.rs`.
//!
//! Limite noto, dichiarato: si confrontano **nomi**, non ancora **tipi** dei campi
//! e firme delle funzioni (unica eccezione: gli alias, sotto, dove il tipo *è*
//! l'informazione). L'estensione ai tipi è prevista a
//! [M4](../../../docs/milestones/M4-wit-hardening.md).

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

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

// CARGO_MANIFEST_DIR = crates/fubmd-abi ; il contratto è alla radice del repo.
const WIT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/fubmd/abi.wit");

// ---------------------------------------------------------------------------
// Il WIT, parsato: nomi DICHIARATI, non sottostringhe
// ---------------------------------------------------------------------------

/// Un tipo dichiarato nel WIT, ridotto a ciò che questo test confronta.
struct Decl {
    /// `record` | `variant` | `enum` | `flags` | `type` | `list` | …
    kind: &'static str,
    /// Campi di un record, casi di un variant/enum. Vuoto per gli alias.
    members: BTreeSet<String>,
    /// Destinazione, se è un alias (`type job-id = u64` → `u64`).
    alias: Option<String>,
    /// Interfaccia che lo dichiara (solo per i messaggi d'errore).
    interface: String,
}

struct Wit {
    /// Tipi dichiarati (i `use` di altre interfacce sono esclusi: sono
    /// importazioni, non dichiarazioni).
    types: BTreeMap<String, Decl>,
    /// Interfaccia → funzioni dichiarate.
    functions: BTreeMap<String, BTreeSet<String>>,
    package: String,
    /// world → (interfacce importate, interfacce esportate).
    worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,

    /// Tipi già confrontati: ciò che resta a fine test è contratto morto.
    covered_types: BTreeSet<String>,
    /// Interfacce di cui si sono già confrontate le funzioni.
    covered_ifaces: BTreeSet<String>,
    /// Divergenze accumulate: il test le riporta tutte insieme, non solo la prima.
    errors: Vec<String>,
}

/// Nome leggibile di un tipo WIT, per confrontare le destinazioni degli alias.
fn type_name(resolve: &Resolve, ty: &Type) -> String {
    match ty {
        Type::Bool => "bool".into(),
        Type::U8 => "u8".into(),
        Type::U16 => "u16".into(),
        Type::U32 => "u32".into(),
        Type::U64 => "u64".into(),
        Type::S8 => "s8".into(),
        Type::S16 => "s16".into(),
        Type::S32 => "s32".into(),
        Type::S64 => "s64".into(),
        Type::F32 => "f32".into(),
        Type::F64 => "f64".into(),
        Type::Char => "char".into(),
        Type::String => "string".into(),
        Type::ErrorContext => "error-context".into(),
        Type::Id(id) => match &resolve.types[*id].name {
            Some(name) => name.clone(),
            None => format!("<anonimo:{}>", resolve.types[*id].kind.as_str()),
        },
    }
}

fn load(source: &str) -> Wit {
    let mut resolve = Resolve::new();
    // Se il contratto non è un WIT valido il test muore QUI, ed è il punto.
    if let Err(e) = resolve.push_str("wit/fubmd/abi.wit", source) {
        panic!("wit/fubmd/abi.wit non è un WIT valido: {e:?}");
    }

    let mut types: BTreeMap<String, Decl> = BTreeMap::new();
    let mut functions = BTreeMap::new();

    for (_, iface) in resolve.interfaces.iter() {
        let iface_name = iface.name.clone().unwrap_or_else(|| "<inline>".into());

        for (name, id) in &iface.types {
            let td = &resolve.types[*id];
            // Un `use altra-interfaccia.{x}` genera qui un alias omonimo verso
            // `x`: è un'importazione, non una dichiarazione. Un vero alias
            // locale (`type frontmatter = json`) ha un nome DIVERSO dal target.
            let is_import = match &td.kind {
                TypeDefKind::Type(Type::Id(target)) => {
                    resolve.types[*target].name.as_deref() == Some(name.as_str())
                }
                _ => false,
            };
            if is_import {
                continue;
            }

            let (members, alias): (BTreeSet<String>, Option<String>) = match &td.kind {
                TypeDefKind::Record(r) => (r.fields.iter().map(|f| f.name.clone()).collect(), None),
                TypeDefKind::Variant(v) => (v.cases.iter().map(|c| c.name.clone()).collect(), None),
                TypeDefKind::Enum(e) => (e.cases.iter().map(|c| c.name.clone()).collect(), None),
                TypeDefKind::Flags(f) => (f.flags.iter().map(|f| f.name.clone()).collect(), None),
                TypeDefKind::Type(t) => (BTreeSet::new(), Some(type_name(&resolve, t))),
                TypeDefKind::List(t) => (
                    BTreeSet::new(),
                    Some(format!("list<{}>", type_name(&resolve, t))),
                ),
                _ => (BTreeSet::new(), None),
            };

            let decl = Decl {
                kind: td.kind.as_str(),
                members,
                alias,
                interface: iface_name.clone(),
            };
            if let Some(prev) = types.insert(name.clone(), decl) {
                // Il test indicizza per nome nudo: due tipi omonimi in
                // interfacce diverse renderebbero ambigua ogni asserzione.
                panic!(
                    "tipo `{name}` dichiarato due volte ({} e {iface_name}): \
                     il contratto usa nomi globalmente unici, o questo test va riscritto",
                    prev.interface
                );
            }
        }

        functions.insert(
            iface_name,
            iface.functions.keys().cloned().collect::<BTreeSet<_>>(),
        );
    }

    let package = resolve
        .packages
        .iter()
        .map(|(_, p)| p.name.to_string())
        .next()
        .expect("nessun package nel WIT");

    let iface_name = |key: &WorldKey, item: &WorldItem| -> Option<String> {
        match item {
            WorldItem::Interface { id, .. } => resolve.interfaces[*id]
                .name
                .clone()
                .or_else(|| Some(format!("{key:?}"))),
            _ => None,
        }
    };
    let worlds = resolve
        .worlds
        .iter()
        .map(|(_, w)| {
            (
                w.name.clone(),
                (
                    w.imports
                        .iter()
                        .filter_map(|(k, v)| iface_name(k, v))
                        .collect(),
                    w.exports
                        .iter()
                        .filter_map(|(k, v)| iface_name(k, v))
                        .collect(),
                ),
            )
        })
        .collect();

    Wit {
        types,
        functions,
        package,
        worlds,
        covered_types: BTreeSet::new(),
        covered_ifaces: BTreeSet::new(),
        errors: Vec::new(),
    }
}

impl Wit {
    fn err(&mut self, msg: String) {
        self.errors.push(msg);
    }

    /// Confronta i membri dichiarati con quelli attesi, nelle due direzioni.
    fn check(&mut self, name: &str, kind: &'static str, expected: &[&str]) {
        self.covered_types.insert(name.to_string());
        let Some(decl) = self.types.get(name) else {
            self.err(format!("`{name}` ({kind}) manca dal WIT"));
            return;
        };
        let got = decl.kind;
        let declared = decl.members.clone();
        if got != kind {
            self.err(format!("`{name}`: nel WIT è `{got}`, nell'abi è `{kind}`"));
        }
        let expected: BTreeSet<String> = expected.iter().map(|s| s.to_string()).collect();
        let missing: Vec<&String> = expected.difference(&declared).collect();
        if !missing.is_empty() {
            let missing = format!("{missing:?}");
            self.err(format!("`{name}`: assenti dal WIT {missing}"));
        }
        let extra: Vec<&String> = declared.difference(&expected).collect();
        if !extra.is_empty() {
            let extra = format!("{extra:?}");
            self.err(format!(
                "`{name}`: nel WIT ma ignoti all'abi {extra} (contratto morto?)"
            ));
        }
    }

    fn record(&mut self, name: &str, fields: &[&str]) {
        self.check(name, "record", fields);
    }

    fn enumeration(&mut self, name: &str, cases: &[&str]) {
        self.check(name, "enum", cases);
    }

    /// Un `variant` più i record di payload dei suoi casi: è qui che il
    /// confronto smette di essere "il nome compare da qualche parte".
    fn variant(&mut self, name: &str, cases: &[Case]) {
        let case_names: Vec<&str> = cases.iter().map(|c| c.case).collect();
        self.check(name, "variant", &case_names);
        for c in cases {
            if let Some(rec) = &c.payload {
                self.record(rec.ty, rec.fields);
            }
        }
    }

    /// Un alias (`type doc-id = string`): qui il *tipo* è l'informazione, e va
    /// confrontato — è ciò che tiene onesti gli indici dell'arena (`u32`) e
    /// la larghezza degli span al confine (`u64`).
    fn alias(&mut self, name: &str, target: &str) {
        self.covered_types.insert(name.to_string());
        let Some(decl) = self.types.get(name) else {
            self.err(format!("alias `{name}` manca dal WIT"));
            return;
        };
        match decl.alias.as_deref() {
            Some(t) if t == target => {}
            Some(t) => self.err(format!(
                "alias `{name}`: nel WIT è `{t}`, atteso `{target}`"
            )),
            None => self.err(format!("`{name}` nel WIT è `{}`, non un alias", decl.kind)),
        }
    }

    fn interface_functions(&mut self, iface: &str, expected: &[&str]) {
        self.covered_ifaces.insert(iface.to_string());
        let Some(funcs) = self.functions.get(iface).cloned() else {
            self.err(format!("interfaccia `{iface}` assente dal WIT"));
            return;
        };
        let expected: BTreeSet<String> = expected.iter().map(|s| s.to_string()).collect();
        let missing: Vec<&String> = expected.difference(&funcs).collect();
        if !missing.is_empty() {
            let missing = format!("{missing:?}");
            self.err(format!("interfaccia `{iface}`: funzioni assenti {missing}"));
        }
        let extra: Vec<&String> = funcs.difference(&expected).collect();
        if !extra.is_empty() {
            let extra = format!("{extra:?}");
            self.err(format!(
                "interfaccia `{iface}`: funzioni nel WIT ma ignote all'abi {extra}"
            ));
        }
    }

    /// Direzione WIT→abi: ciò che il contratto dichiara e nessuno rivendica.
    fn finish(mut self) -> Result<(), String> {
        let declared: BTreeSet<String> = self.types.keys().cloned().collect();
        let orphan: Vec<&String> = declared.difference(&self.covered_types).collect();
        if !orphan.is_empty() {
            self.err(format!(
                "tipi dichiarati nel WIT e mai rivendicati dall'abi (contratto morto): {orphan:?}"
            ));
        }
        let ifaces: BTreeSet<String> = self.functions.keys().cloned().collect();
        let orphan: Vec<&String> = ifaces.difference(&self.covered_ifaces).collect();
        if !orphan.is_empty() {
            self.err(format!("interfacce del WIT mai verificate qui: {orphan:?}"));
        }
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(self.errors.join("\n  - "))
        }
    }
}

// ---------------------------------------------------------------------------
// Esaustività lato Rust: se un tipo abi cambia, questi non compilano più.
// ---------------------------------------------------------------------------

/// Un caso di `variant` WIT, con l'eventuale record del suo payload.
struct Case {
    case: &'static str,
    payload: Option<Rec>,
}
struct Rec {
    ty: &'static str,
    fields: &'static [&'static str],
}

/// Caso con payload anonimo (`text(string)`) o senza payload.
fn case(case: &'static str) -> Case {
    Case {
        case,
        payload: None,
    }
}
/// Caso il cui payload è un record dedicato del WIT.
fn case_rec(case: &'static str, ty: &'static str, fields: &'static [&'static str]) -> Case {
    Case {
        case,
        payload: Some(Rec { ty, fields }),
    }
}

fn block_case(b: &Block) -> Case {
    match b {
        Block::Heading {
            level,
            inlines,
            span,
        } => {
            let _ = (level, inlines, span);
            case_rec("heading", "block-heading", &["level", "inlines", "span"])
        }
        Block::Paragraph { inlines, span } => {
            let _ = (inlines, span);
            case_rec("paragraph", "block-paragraph", &["inlines", "span"])
        }
        Block::List {
            ordered,
            items,
            span,
        } => {
            let _ = (ordered, items, span);
            case_rec("list", "block-list", &["ordered", "items", "span"])
        }
        Block::CodeBlock { lang, code, span } => {
            let _ = (lang, code, span);
            case_rec("code-block", "block-code-block", &["lang", "code", "span"])
        }
        Block::Quote { blocks, span } => {
            let _ = (blocks, span);
            case_rec("quote", "block-quote", &["blocks", "span"])
        }
        Block::ThematicBreak { span } => {
            let _ = span;
            case("thematic-break")
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            span,
        } => {
            let _ = (custom_kind, attrs, blocks, span);
            case_rec(
                "custom",
                "block-custom",
                &["custom-kind", "attrs", "blocks", "span"],
            )
        }
    }
}

fn inline_case(i: &Inline) -> Case {
    match i {
        Inline::Text(s) => {
            let _ = s;
            case("text")
        }
        Inline::Emph(v) => {
            let _ = v;
            case("emph")
        }
        Inline::Strong(v) => {
            let _ = v;
            case("strong")
        }
        Inline::Code(s) => {
            let _ = s;
            case("code")
        }
        Inline::Link {
            target,
            label,
            span,
        } => {
            let _ = (target, label, span);
            case_rec("link", "inline-link", &["target", "label", "span"])
        }
        Inline::TagRef { name, span } => {
            let _ = (name, span);
            case_rec("tag-ref", "inline-tag-ref", &["name", "span"])
        }
        Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => {
            let _ = (custom_kind, attrs, span);
            case_rec("custom", "inline-custom", &["custom-kind", "attrs", "span"])
        }
    }
}

fn link_target_case(t: &LinkTarget) -> Case {
    match t {
        LinkTarget::Wiki {
            page,
            heading,
            block,
            embed,
        } => {
            let _ = (page, heading, block, embed);
            case_rec(
                "wiki",
                "link-target-wiki",
                &["page", "heading", "block", "embed"],
            )
        }
        LinkTarget::Url(s) => {
            let _ = s;
            case("url")
        }
        LinkTarget::Path(s) => {
            let _ = s;
            case("path")
        }
    }
}

fn ui_node_case(n: &UiNode) -> Case {
    match n {
        UiNode::Stack { dir, gap, children } => {
            let _ = (dir, gap, children);
            case_rec("stack", "ui-stack", &["dir", "gap", "children"])
        }
        UiNode::Text { content } => {
            let _ = content;
            case("text")
        }
        UiNode::Heading { level, content } => {
            let _ = (level, content);
            case_rec("heading", "ui-heading", &["level", "content"])
        }
        UiNode::List { items } => {
            let _ = items;
            case("list")
        }
        UiNode::ListItem {
            title,
            subtitle,
            action,
        } => {
            let _ = (title, subtitle, action);
            case_rec(
                "list-item",
                "ui-list-item",
                &["title", "subtitle", "action"],
            )
        }
        UiNode::Button {
            label,
            intent,
            action,
        } => {
            let _ = (label, intent, action);
            case_rec("button", "ui-button", &["label", "intent", "action"])
        }
        UiNode::Html { html } => {
            let _ = html;
            case("html")
        }
        UiNode::WebView { url, height } => {
            let _ = (url, height);
            case_rec("web-view", "ui-web-view", &["url", "height"])
        }
    }
}

fn view_update_case(v: &ViewUpdate) -> Case {
    match v {
        // Il payload è l'arena `ui-tree`, non un record omonimo del caso.
        ViewUpdate::Replace { root } => {
            let _ = root;
            case("replace")
        }
        ViewUpdate::None => case("none"),
        ViewUpdate::Navigate { doc_id } => {
            let _ = doc_id;
            case("navigate")
        }
    }
}

fn event_case(e: &Event) -> Case {
    match e {
        Event::VaultOpened { root } => {
            let _ = root;
            case_rec("vault-opened", "event-vault-opened", &["root"])
        }
        Event::DocumentChanged { id } => {
            let _ = id;
            case_rec("document-changed", "event-document-changed", &["id"])
        }
        Event::DocumentRemoved { id } => {
            let _ = id;
            case_rec("document-removed", "event-document-removed", &["id"])
        }
        // `from` è keyword WIT: nel contratto è `%from`, e l'identificatore
        // dichiarato resta `from`. Il campo Rust non si rinomina per una
        // questione di sintassi altrui.
        Event::DocumentRenamed { from, to } => {
            let _ = (from, to);
            case_rec(
                "document-renamed",
                "event-document-renamed",
                &["from", "to"],
            )
        }
        Event::IndexUpdated => case("index-updated"),
        // idem per `result` (`%result` nel WIT).
        Event::JobDone { id, job, result } => {
            let _ = (id, job, result);
            case_rec("job-done", "event-job-done", &["id", "job", "result"])
        }
        Event::Overflow { dropped } => {
            let _ = dropped;
            case_rec("overflow", "event-overflow", &["dropped"])
        }
        Event::Custom { topic, payload } => {
            let _ = (topic, payload);
            case_rec("custom", "event-custom", &["topic", "payload"])
        }
    }
}

fn event_kind_name(k: EventKind) -> &'static str {
    match k {
        EventKind::VaultOpened => "vault-opened",
        EventKind::DocumentChanged => "document-changed",
        EventKind::DocumentRemoved => "document-removed",
        EventKind::DocumentRenamed => "document-renamed",
        EventKind::IndexUpdated => "index-updated",
        EventKind::JobDone => "job-done",
        EventKind::Overflow => "overflow",
        EventKind::Custom => "custom",
    }
}

fn index_query_case(q: &IndexQuery) -> Case {
    match q {
        IndexQuery::Backlinks { target } => {
            let _ = target;
            case("backlinks")
        }
        IndexQuery::FullText { query, limit } => {
            let _ = (query, limit);
            case_rec("full-text", "index-query-full-text", &["query", "limit"])
        }
        IndexQuery::Custom { ns, query } => {
            let _ = (ns, query);
            case_rec("custom", "index-query-custom", &["ns", "query"])
        }
    }
}

fn index_result_case(r: &IndexResult) -> Case {
    match r {
        IndexResult::Backlinks(v) => {
            let _ = v;
            case("backlinks")
        }
        IndexResult::Search(v) => {
            let _ = v;
            case("search")
        }
        IndexResult::Custom(v) => {
            let _ = v;
            case("custom")
        }
    }
}

fn format_error_case(e: &FormatError) -> Case {
    match e {
        FormatError::Parse(s) => {
            let _ = s;
            case("parse")
        }
        FormatError::Render(s) => {
            let _ = s;
            case("render")
        }
        FormatError::Serialize(s) => {
            let _ = s;
            case("serialize")
        }
        FormatError::Unsupported(s) => {
            let _ = s;
            case("unsupported")
        }
    }
}

fn plugin_error_case(e: &PluginError) -> Case {
    match e {
        PluginError::UnknownCommand(s) => {
            let _ = s;
            case("unknown-command")
        }
        PluginError::UnknownView(s) => {
            let _ = s;
            case("unknown-view")
        }
        PluginError::UnknownJob(s) => {
            let _ = s;
            case("unknown-job")
        }
        PluginError::BadArgs(s) => {
            let _ = s;
            case("bad-args")
        }
        PluginError::PermissionDenied(s) => {
            let _ = s;
            case("permission-denied")
        }
        PluginError::Internal(s) => {
            let _ = s;
            case("internal")
        }
    }
}

fn axis_name(a: Axis) -> &'static str {
    match a {
        Axis::Row => "row",
        Axis::Column => "column",
    }
}

fn intent_name(i: Intent) -> &'static str {
    match i {
        Intent::Neutral => "neutral",
        Intent::Primary => "primary",
        Intent::Danger => "danger",
    }
}

fn view_placement_name(p: ViewPlacement) -> &'static str {
    match p {
        ViewPlacement::LeftSidebar => "left-sidebar",
        ViewPlacement::RightSidebar => "right-sidebar",
        ViewPlacement::Bottom => "bottom",
    }
}

// ---------------------------------------------------------------------------
// Il confronto vero e proprio
// ---------------------------------------------------------------------------

/// Applica al WIT tutte le asserzioni derivate dall'abi. Separata dal test così
/// che `wit_conformance_actually_fails_on_drift` possa passarle un contratto
/// alterato ad arte e verificare che diventi rossa.
fn conform(source: &str) -> Result<(), String> {
    let mut wit = load(source);

    assert_eq!(wit.package, "fubmd:abi@0.1.0", "nome del package");

    // --- variant/enum: un rappresentante per caso, esaustività dal compilatore

    wit.variant(
        "block",
        &[
            block_case(&Block::Heading {
                level: 1,
                inlines: vec![],
                span: Span::EMPTY,
            }),
            block_case(&Block::Paragraph {
                inlines: vec![],
                span: Span::EMPTY,
            }),
            block_case(&Block::List {
                ordered: false,
                items: vec![],
                span: Span::EMPTY,
            }),
            block_case(&Block::CodeBlock {
                lang: None,
                code: String::new(),
                span: Span::EMPTY,
            }),
            block_case(&Block::Quote {
                blocks: vec![],
                span: Span::EMPTY,
            }),
            block_case(&Block::ThematicBreak { span: Span::EMPTY }),
            block_case(&Block::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
                span: Span::EMPTY,
            }),
        ],
    );

    wit.variant(
        "inline",
        &[
            inline_case(&Inline::Text(String::new())),
            inline_case(&Inline::Emph(vec![])),
            inline_case(&Inline::Strong(vec![])),
            inline_case(&Inline::Code(String::new())),
            inline_case(&Inline::Link {
                target: LinkTarget::wiki("p"),
                label: None,
                span: Span::EMPTY,
            }),
            inline_case(&Inline::TagRef {
                name: String::new(),
                span: Span::EMPTY,
            }),
            inline_case(&Inline::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                span: Span::EMPTY,
            }),
        ],
    );

    wit.variant(
        "link-target",
        &[
            link_target_case(&LinkTarget::wiki("p")),
            link_target_case(&LinkTarget::Url(String::new())),
            link_target_case(&LinkTarget::Path(String::new())),
        ],
    );

    wit.variant(
        "ui-node",
        &[
            ui_node_case(&UiNode::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![],
            }),
            ui_node_case(&UiNode::Text {
                content: String::new(),
            }),
            ui_node_case(&UiNode::Heading {
                level: 1,
                content: String::new(),
            }),
            ui_node_case(&UiNode::List { items: vec![] }),
            ui_node_case(&UiNode::ListItem {
                title: String::new(),
                subtitle: None,
                action: None,
            }),
            ui_node_case(&UiNode::Button {
                label: String::new(),
                intent: Intent::Neutral,
                action: ActionId(String::new()),
            }),
            ui_node_case(&UiNode::Html {
                html: String::new(),
            }),
            ui_node_case(&UiNode::WebView {
                url: String::new(),
                height: 0,
            }),
        ],
    );

    wit.variant(
        "view-update",
        &[
            view_update_case(&ViewUpdate::Replace {
                root: UiNode::Text {
                    content: String::new(),
                },
            }),
            view_update_case(&ViewUpdate::None),
            view_update_case(&ViewUpdate::Navigate {
                doc_id: String::new(),
            }),
        ],
    );

    wit.variant(
        "event",
        &[
            event_case(&Event::VaultOpened {
                root: String::new(),
            }),
            event_case(&Event::DocumentChanged {
                id: DocId::new("a"),
            }),
            event_case(&Event::DocumentRemoved {
                id: DocId::new("a"),
            }),
            event_case(&Event::DocumentRenamed {
                from: DocId::new("a"),
                to: DocId::new("b"),
            }),
            event_case(&Event::IndexUpdated),
            event_case(&Event::JobDone {
                id: JobId(0),
                job: String::new(),
                result: Ok(serde_json::Value::Null),
            }),
            event_case(&Event::Overflow { dropped: 0 }),
            event_case(&Event::Custom {
                topic: String::new(),
                payload: serde_json::Value::Null,
            }),
        ],
    );

    wit.variant(
        "index-query",
        &[
            index_query_case(&IndexQuery::Backlinks {
                target: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::FullText {
                query: String::new(),
                limit: 0,
            }),
            index_query_case(&IndexQuery::Custom {
                ns: String::new(),
                query: serde_json::Value::Null,
            }),
        ],
    );

    wit.variant(
        "index-result",
        &[
            index_result_case(&IndexResult::Backlinks(vec![])),
            index_result_case(&IndexResult::Search(vec![])),
            index_result_case(&IndexResult::Custom(serde_json::Value::Null)),
        ],
    );

    wit.variant(
        "format-error",
        &[
            format_error_case(&FormatError::Parse(String::new())),
            format_error_case(&FormatError::Render(String::new())),
            format_error_case(&FormatError::Serialize(String::new())),
            format_error_case(&FormatError::Unsupported(String::new())),
        ],
    );

    wit.variant(
        "plugin-error",
        &[
            plugin_error_case(&PluginError::UnknownCommand(String::new())),
            plugin_error_case(&PluginError::UnknownView(String::new())),
            plugin_error_case(&PluginError::UnknownJob(String::new())),
            plugin_error_case(&PluginError::BadArgs(String::new())),
            plugin_error_case(&PluginError::PermissionDenied(String::new())),
            plugin_error_case(&PluginError::Internal(String::new())),
        ],
    );

    wit.enumeration(
        "event-kind",
        [
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRemoved,
            EventKind::DocumentRenamed,
            EventKind::IndexUpdated,
            EventKind::JobDone,
            EventKind::Overflow,
            EventKind::Custom,
        ]
        .map(event_kind_name)
        .as_slice(),
    );
    wit.enumeration("axis", [Axis::Row, Axis::Column].map(axis_name).as_slice());
    wit.enumeration(
        "intent",
        [Intent::Neutral, Intent::Primary, Intent::Danger]
            .map(intent_name)
            .as_slice(),
    );
    wit.enumeration(
        "view-placement",
        [
            ViewPlacement::LeftSidebar,
            ViewPlacement::RightSidebar,
            ViewPlacement::Bottom,
        ]
        .map(view_placement_name)
        .as_slice(),
    );

    // --- record: destructuring esaustivo, un campo aggiunto non compila

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
    wit.record(
        "document-model",
        &[
            "id",
            "frontmatter",
            "body",
            "outline",
            "links",
            "tags",
            "text",
        ],
    );

    let Span { start, end } = Span::EMPTY;
    let _ = (start, end);
    wit.record("span", &["start", "end"]);

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
    wit.record("heading", &["level", "text", "slug", "span"]);

    let Tag { name, span } = Tag {
        name: String::new(),
        span: Span::EMPTY,
    };
    let _ = (name, span);
    wit.record("tag", &["name", "span"]);

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
    wit.record("link", &["target", "span", "context"]);

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
    wit.record("format-descriptor", &["id", "name", "extensions"]);

    let FormatCapabilities {
        wikilinks,
        tags,
        frontmatter,
        callouts,
        embeds,
    } = FormatCapabilities::default();
    let _ = (wikilinks, tags, frontmatter, callouts, embeds);
    wit.record(
        "format-capabilities",
        &["wikilinks", "tags", "frontmatter", "callouts", "embeds"],
    );

    let ParseContext {
        doc_id,
        parse_tags,
        parse_wikilinks,
    } = ParseContext::default();
    let _ = (doc_id, parse_tags, parse_wikilinks);
    wit.record(
        "parse-context",
        &["doc-id", "parse-tags", "parse-wikilinks"],
    );

    let RenderOptions {
        wikilinks_as_data_attrs,
    } = RenderOptions::default();
    let _ = wikilinks_as_data_attrs;
    wit.record("render-options", &["wikilinks-as-data-attrs"]);

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
    wit.record("command-spec", &["id", "title", "keybinding"]);

    let CommandOutcome { notify } = CommandOutcome { notify: None };
    let _ = notify;
    wit.record("command-outcome", &["notify"]);

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
    wit.record("view-spec", &["id", "title", "placement"]);

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    let _ = (source, context);
    wit.record("backlink-ref", &["source", "context"]);

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
    wit.record("search-hit", &["doc", "score", "snippet", "highlights"]);

    let UiAction { action, payload } = UiAction {
        action: ActionId(String::new()),
        payload: serde_json::Value::Null,
    };
    let _ = (action, payload);
    wit.record("ui-action", &["action", "payload"]);

    let PluginPermissions {
        read_vault,
        write_vault,
        network,
    } = PluginPermissions::default();
    let _ = (read_vault, write_vault, network);
    wit.record(
        "plugin-permissions",
        &["read-vault", "write-vault", "network"],
    );

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
    wit.record("plugin-manifest", &["id", "name", "version", "permissions"]);

    let JobSpec { job, payload } = JobSpec {
        job: String::new(),
        payload: serde_json::Value::Null,
    };
    let _ = (job, payload);
    wit.record("job-spec", &["job", "payload"]);

    // --- alias

    let DocId(path) = DocId::new("a");
    let _ = path;
    wit.alias("doc-id", "string");

    let Frontmatter(map) = Frontmatter::default();
    let _ = map;
    wit.alias("frontmatter", "json");

    let ActionId(raw) = ActionId(String::new());
    let _ = raw;
    wit.alias("action-id", "string");

    let JobId(raw) = JobId(0);
    let _ = raw;
    wit.alias("job-id", "u64");

    let EventMask(kinds) = EventMask::all();
    let _ = kinds;
    wit.alias("event-mask", "list<event-kind>");

    // Il JSON libero (frontmatter, attrs, args, storage) attraversa il confine
    // come stringa: è la scelta deliberata dell'escape hatch.
    wit.alias("json", "string");

    // --- rappresentazione al confine degli alberi ricorsivi (nessuna
    // controparte Rust: gli alberi nativi restano alberi, l'arena vive nel
    // proxy WASM). Vedi docs/architecture/traits.md.

    wit.alias("block-ref", "u32");
    wit.alias("inline-ref", "u32");
    wit.alias("ui-ref", "u32");
    wit.record("document-tree", &["blocks", "inlines", "roots"]);
    wit.record("ui-tree", &["nodes", "root"]);

    // --- funzioni: la superficie dei trait

    wit.interface_functions("json", &[]);
    wit.interface_functions("model", &[]);
    wit.interface_functions("ui", &[]);
    wit.interface_functions("jobs", &[]);
    wit.interface_functions("events", &[]);
    wit.interface_functions("errors", &[]);
    wit.interface_functions(
        "format",
        &[
            "descriptor",
            "capabilities",
            "parse",
            "render-html",
            "serialize",
        ],
    );
    wit.interface_functions("command", &["commands", "invoke"]);
    wit.interface_functions(
        "index",
        &[
            "on-document-indexed",
            "on-document-removed",
            "reconcile",
            "flush",
            "query",
        ],
    );
    wit.interface_functions("view", &["views", "render-view", "on-action"]);
    wit.interface_functions(
        "host-api",
        &[
            "read-document",
            "write-document",
            "list-documents",
            "emit",
            "spawn-job",
            "storage-get",
            "storage-set",
            "data-read",
            "data-write",
            "data-remove",
            "data-list",
            "now-unix-millis",
        ],
    );
    wit.interface_functions("event-handler", &["subscribed", "handle"]);
    wit.interface_functions("plugin", &["manifest", "activate", "deactivate", "run-job"]);

    // --- il world

    let (imports, exports) = wit
        .worlds
        .get("plugin-world")
        .cloned()
        .expect("world `plugin-world` assente dal WIT");
    assert!(
        imports.contains("host-api"),
        "`plugin-world` deve importare host-api, importa {imports:?}"
    );
    let expected_exports: BTreeSet<String> = [
        "plugin",
        "format",
        "command",
        "view",
        "index",
        "event-handler",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        exports, expected_exports,
        "interfacce esportate da `plugin-world`"
    );

    wit.finish()
}

fn wit_source() -> String {
    std::fs::read_to_string(WIT_PATH)
        .unwrap_or_else(|e| panic!("impossibile leggere {WIT_PATH}: {e}"))
}

#[test]
fn abi_types_are_mirrored_in_wit() {
    if let Err(report) = conform(&wit_source()) {
        panic!("abi e wit/fubmd/abi.wit divergono:\n  - {report}");
    }
}

// ---------------------------------------------------------------------------
// Il test del test (criterio di accettazione di M4)
// ---------------------------------------------------------------------------

/// Un test di conformità che non sa fallire non è un test. Qui si introducono
/// divergenze ad arte — una per direzione — e si pretende il rosso.
#[test]
fn wit_conformance_actually_fails_on_drift() {
    let base = wit_source();

    let cases: &[(&str, String, &str)] = &[
        (
            "campo rinominato nel WIT",
            base.replace("slug: string,", "slugg: string,"),
            "slug",
        ),
        (
            "caso di variant rimosso dal WIT",
            base.replace("        thematic-break(span),\n", ""),
            "thematic-break",
        ),
        (
            "funzione rimossa da host-api",
            base.replace("    now-unix-millis: func() -> u64;", ""),
            "now-unix-millis",
        ),
        (
            "tipo in più nel WIT che l'abi non rivendica",
            base.replace(
                "interface errors {",
                "interface errors {\n    record contratto-morto { x: u32 }",
            ),
            "contratto-morto",
        ),
        (
            "alias con la larghezza sbagliata",
            base.replace("    type block-ref = u32;", "    type block-ref = u64;"),
            "block-ref",
        ),
    ];

    for (what, mutated, needle) in cases {
        assert_ne!(&base, mutated, "la mutazione «{what}» non ha toccato nulla");
        let report = conform(mutated).expect_err(&format!(
            "«{what}» non ha fatto fallire il test di conformità"
        ));
        assert!(
            report.contains(needle),
            "«{what}»: il report non nomina `{needle}`:\n{report}"
        );
    }
}

/// E un WIT che non parsa deve morire subito, non passare per verde.
#[test]
#[should_panic(expected = "non è un WIT valido")]
fn invalid_wit_is_not_silently_accepted() {
    // `list` senza escape: com'era il contratto prima del piano di aggiustamento.
    let broken = wit_source().replace("        %list(block-list),", "        list(block-list),");
    let _ = conform(&broken);
}
