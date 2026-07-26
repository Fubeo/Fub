//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fubmd/abi.wit`, con la
//! **stessa forma** — non solo con lo stesso nome. Quattro pressioni:
//!
//! 1. **Il WIT deve essere valido** — il file viene dato in pasto a `wit-parser`.
//!    Un contratto che non parsa è un test rosso, non un file di testo che
//!    "sembra giusto".
//! 2. **Drift lato Rust** → i match e i destructuring esaustivi qui sotto NON
//!    compilano se un enum guadagna una variante o un record un campo; e le
//!    firme delle funzioni sono **cast dei metodi dei trait a puntatore a
//!    funzione**, quindi non compilano se un parametro o un tipo di ritorno
//!    cambia.
//! 3. **Drift lato WIT, nelle due direzioni** — si confrontano gli **insiemi
//!    ordinati di nomi e i tipi** estratti dal parse: campi di record, casi di
//!    variant col tipo del payload, destinazioni degli alias, parametri e
//!    risultati di ogni funzione. Un tipo dichiarato nel contratto e mai
//!    rivendicato dall'abi fallisce ugualmente (contratto morto).
//! 4. **`host` è eliso** — nessuna funzione del WIT può avere un parametro
//!    `host`: le capacità sono importate dal world, non passate a mano. Le firme
//!    Rust invece ce l'hanno, e il test verifica che spariscano *esattamente lì*.
//!
//! # Da dove vengono i tipi attesi
//!
//! Non sono scritti a mano. `wit(&campo)` deduce la forma WIT **dal tipo Rust
//! del campo destrutturato** ([`WitType`]): se `SearchHit::score` diventasse
//! `f64`, l'attesa diventerebbe `f64` e il confronto col contratto (`f32`)
//! fallirebbe. Lo stesso per le funzioni: [`WitFn`] deriva parametri e risultato
//! dal tipo del puntatore a funzione, che a sua volta è vincolato al metodo del
//! trait dal cast. È il "non compila su divergenza" chiesto dal piano, ottenuto
//! senza generare codice.
//!
//! # Alberi ricorsivi
//!
//! I tipi che al confine viaggiano come **arena** (`block`, `inline`, `ui-node`,
//! `document-tree`, `ui-tree`, `span`) si confrontano con
//! [`fubmd_abi::arena`], che è la loro forma al confine *scritta in Rust* — e la
//! catena verso gli alberi nativi la tiene il compilatore, perché
//! `DocumentTree::flatten`/`rebuild` sono match esaustivi su entrambi i lati
//! (round-trip provato in `arena`). Prima esisteva solo la prosa nei commenti.
//!
//! `wit-parser` è una **dev-dependency**: l'invariante architetturale di
//! `fubmd-abi` riguarda le dipendenze normali, ed è protetta da
//! `tests/dependency_invariant.rs`.
//!
//! L'**ordine** dei casi è confrontato in tutte e due le direzioni e in tutte
//! le sedi: il WIT contro l'elenco del test (`diff`), e l'elenco del test
//! contro la **dichiarazione dell'enum Rust**, parsata dal sorgente con `syn`
//! (`variant_src`/`enumeration_src`). Il compilatore garantisce l'esaustività
//! dei match qui sotto, non l'ordine — e l'ordine dei casi è il discriminante
//! ABI: un riordino è rosso da entrambi i lati, non solo da quello WIT.

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

use fubmd_abi::arena::{self, BlockRef, InlineRef, UiRef};
use fubmd_abi::command::{
    Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
use fubmd_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fubmd_abi::edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Actor, BatchId, Event, EventKind, EventMask, Notice, Origin};
use fubmd_abi::format::{
    DocumentFormat, DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider,
    ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use fubmd_abi::model::{
    Anchor, ColumnAlign, DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget,
    PropertyDate, PropertyScalar, PropertyTime, PropertyValue, Span, Tag,
};
use fubmd_abi::options::OptionMap;
use fubmd_abi::session::{ContextKind, ContextMask, PaneId, PaneMode, Selection, ViewContext};
use fubmd_abi::traits::{
    BacklinkRef, CommandProvider, DocumentProperties, EventHandler, HealthCheck, HealthIssue,
    HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobSpec, LinkDirection, NeighborRef,
    Page, Paged, Plugin, PluginManifest, PluginPermissions, PropertyCount, PropertyEntry,
    PropertyFilter, PropertySort, PropertyTest, SearchHit, SearchScope, TagCount, TrashEntry,
    ViewInstance, ViewProvider, ViewSpec, ViewSurface, ABI_VERSION,
};
use fubmd_abi::transfer::{
    ConflictPolicy, ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportRequest,
    ImportSource, ImportedDocument, NoteLevel, TransferNote,
};
use fubmd_abi::ui::{
    ActionId, ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction,
    UiNode, UiOption, UiValue, ViewUpdate,
};

// CARGO_MANIFEST_DIR = crates/fubmd-abi ; il contratto è alla radice del repo.
const WIT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/fubmd/abi.wit");

/// Segnaposto per il ricevitore (`&self`): non attraversa il confine.
const SELF: &str = "«self»";
/// Segnaposto per l'`HostApi`: nelle firme Rust c'è, nel WIT **non deve
/// esserci** — è importato dal world.
const HOST: &str = "«host»";

// ---------------------------------------------------------------------------
// La forma WIT di un tipo Rust, dedotta dal tipo
// ---------------------------------------------------------------------------

/// Come un tipo Rust si scrive nel WIT.
///
/// È il cuore del test: implementarla per un tipo è **dichiarare la sua forma al
/// confine**, e un tipo nuovo in una firma senza questa impl non compila —
/// quindi non passa inosservato.
trait WitType {
    fn wit() -> String;
}

/// La forma WIT del tipo di `v`. Si passa il valore e non il tipo perché così il
/// tipo lo deduce il compilatore dal campo destrutturato: nessuna occasione di
/// scriverne uno diverso da quello vero.
fn wit<T: WitType + ?Sized>(_v: &T) -> String {
    T::wit()
}

/// La forma WIT di un tipo di cui non si ha un valore sotto mano.
fn wit_of<T: WitType + ?Sized>() -> String {
    T::wit()
}

macro_rules! wit_type {
    ($($ty:ty => $name:expr),+ $(,)?) => {
        $(impl WitType for $ty {
            fn wit() -> String {
                $name.to_string()
            }
        })+
    };
}

wit_type! {
    // Primitivi e stringhe.
    bool => "bool",
    u8 => "u8",
    u16 => "u16",
    u32 => "u32",
    u64 => "u64",
    i16 => "s16",
    i32 => "s32",
    f32 => "f32",
    f64 => "f64",
    char => "char",
    str => "string",
    String => "string",
    // L'unità: nel WIT un `result` senza ok si scrive `result<_, e>`, e una
    // funzione che non restituisce niente non ha risultato affatto.
    () => "_",
    // Il JSON libero (frontmatter, attrs, args, payload, storage) attraversa il
    // confine come stringa: è la scelta deliberata dell'escape hatch.
    serde_json::Value => "json",
    serde_json::Map<String, serde_json::Value> => "json",

    // Alias del contratto: newtype qui, `type x = ...` là.
    DocId => "doc-id",
    Frontmatter => "frontmatter",
    ActionId => "action-id",
    JobId => "job-id",
    BatchId => "batch-id",
    EventMask => "event-mask",
    BlockRef => "block-ref",
    InlineRef => "inline-ref",
    UiRef => "ui-ref",

    // Record e variant del modello.
    Span => "span",
    arena::Span => "span",
    Heading => "heading",
    Tag => "tag",
    Anchor => "anchor",
    Link => "link",
    LinkTarget => "link-target",
    DocumentModel => "document-model",
    ColumnAlign => "column-align",
    PropertyValue => "property-value",
    PropertyScalar => "property-scalar",
    PropertyDate => "property-date",
    PropertyTime => "property-time",
    arena::Block => "block",
    arena::Inline => "inline",
    arena::ListItem => "list-item",
    arena::TaskMarker => "task-marker",
    arena::TableRow => "table-row",
    arena::TableCell => "table-cell",
    arena::UiNode => "ui-node",
    arena::UiKind => "ui-kind",
    arena::DocumentTree => "document-tree",
    arena::UiTree => "ui-tree",

    // UI: al confine un albero intero è la sua arena.
    UiNode => "ui-tree",
    Axis => "axis",
    Intent => "intent",
    UiAction => "ui-action",
    ActionRef => "action-ref",
    UiValue => "ui-value",
    FieldValue => "field-value",
    UiOption => "ui-option",
    KeyValueEntry => "key-value-entry",
    TableColumn => "table-column",
    Align => "align",
    ViewUpdate => "view-update",

    // Il resto del contratto.
    FormatDescriptor => "format-descriptor",
    FormatCapabilities => "format-capabilities",
    DocumentFormat => "document-format",
    ParseContext => "parse-context",
    RenderOptions => "render-options",
    RenderTarget => "render-target",
    SourceKind => "source-kind",
    DocumentSource => "document-source",
    FormatError => "format-error",

    // La mappa con namespace: al confine è una lista di coppie, perché WIT non
    // ha mappe. È lo stesso tipo in tutte e quattro le sedi del §3.5 — e che
    // sia lo STESSO è metà della risposta.
    OptionMap => "option-map",

    // I due innesti del §3.1 e del §3.2.
    SyntaxTrigger => "syntax-trigger",
    SyntaxRuleSpec => "syntax-rule-spec",
    SyntaxMatch => "syntax-match",
    SyntaxProduct => "syntax-product",
    CustomRendererSpec => "custom-renderer-spec",
    CustomBlock => "custom-block",
    CustomRendering => "custom-rendering",
    PluginError => "plugin-error",
    Event => "event",
    EventKind => "event-kind",
    Actor => "actor",
    Origin => "origin",
    Notice => "notice",
    JobSpec => "job-spec",

    // I comandi: la dichiarazione (decisione 0010) e l'invocazione (decisione 0009).
    CommandSpec => "command-spec",
    CommandOutcome => "command-outcome",
    CommandEffect => "command-effect",
    CommandPlan => "command-plan",
    PlannedEdit => "planned-edit",
    CommandScope => "command-scope",
    CommandReach => "command-reach",
    ParamSpec => "param-spec",
    ParamKind => "param-kind",
    Choice => "choice",
    InvokeMode => "invoke-mode",
    ViewSpec => "view-spec",
    ViewSurface => "view-surface",
    ViewInstance => "view-instance",

    // L'edit chirurgico: la coppia (span, testo) e la revisione su cui è stata
    // calcolata.
    Revision => "revision",
    TextEdit => "text-edit",
    EditRequest => "edit-request",
    AppliedEdit => "applied-edit",
    EditReport => "edit-report",

    // Il contesto di sessione: il pannello con il focus e ciò che contiene.
    PaneId => "pane-id",
    PaneMode => "pane-mode",
    Selection => "selection",
    ViewContext => "view-context",
    ContextKind => "context-kind",
    ContextMask => "context-mask",
    IndexQuery => "index-query",
    IndexResult => "index-result",
    BacklinkRef => "backlink-ref",
    NeighborRef => "neighbor-ref",
    SearchHit => "search-hit",
    TagCount => "tag-count",
    TrashEntry => "trash-entry",
    Page => "page",
    LinkDirection => "link-direction",
    SearchScope => "search-scope",
    PropertyTest => "property-test",
    PropertyFilter => "property-filter",
    PropertySort => "property-sort",
    PropertyEntry => "property-entry",
    DocumentProperties => "document-properties",
    PropertyCount => "property-count",
    HealthCheck => "health-check",
    HealthIssue => "health-issue",

    // Import ed export: la sorgente arriva a byte e gli artefatti escono a
    // byte, quindi al confine non compare nessun percorso di filesystem.
    NoteLevel => "note-level",
    TransferNote => "transfer-note",
    ImportSource => "import-source",
    ImportMode => "import-mode",
    ConflictPolicy => "conflict-policy",
    ImportRequest => "import-request",
    ImportOutcome => "import-outcome",
    ImportedDocument => "imported-document",
    ImportReport => "import-report",
    ExportTarget => "export-target",
    ExportSelection => "export-selection",
    ExportRequest => "export-request",
    ExportArtifact => "export-artifact",
    ExportReport => "export-report",

    // Le finestre: un solo `Paged<T>` in Rust, un record per istanza nel WIT
    // (i generici al confine non esistono). L'impl per ciascuna istanza è ciò
    // che rende impossibile paginarne una nuova senza dichiararla anche là.
    Paged<BacklinkRef> => "backlinks-page",
    Paged<SearchHit> => "search-page",
    Paged<TagCount> => "tags-page",
    Paged<NeighborRef> => "neighbors-page",
    Paged<DocumentProperties> => "properties-page",
    Paged<PropertyCount> => "property-values-page",
    Paged<HealthIssue> => "vault-health-page",
    PluginManifest => "plugin-manifest",
    PluginPermissions => "plugin-permissions",

    // Ciò che NON attraversa il confine: il ricevitore e le capacità dell'host.
    dyn HostApi => HOST,
    dyn FormatProvider => SELF,
    dyn CommandProvider => SELF,
    dyn ViewProvider => SELF,
    dyn IndexProvider => SELF,
    dyn EventHandler => SELF,
    dyn Plugin => SELF,
    dyn ImportProvider => SELF,
    dyn ExportProvider => SELF,
    dyn SyntaxRule => SELF,
    dyn CustomRenderer => SELF,
}

impl<T: WitType + ?Sized> WitType for &T {
    fn wit() -> String {
        T::wit()
    }
}

impl<T: WitType + ?Sized> WitType for &mut T {
    fn wit() -> String {
        T::wit()
    }
}

/// Un `Box` è una scelta di **layout**, non di forma al confine: `Box<UiNode>`
/// si serializza e si dichiara nel WIT esattamente come `UiNode`.
impl<T: WitType + ?Sized> WitType for Box<T> {
    fn wit() -> String {
        T::wit()
    }
}

impl<T: WitType> WitType for Option<T> {
    fn wit() -> String {
        format!("option<{}>", T::wit())
    }
}

impl<T: WitType> WitType for Vec<T> {
    fn wit() -> String {
        format!("list<{}>", T::wit())
    }
}

impl<T: WitType> WitType for [T] {
    fn wit() -> String {
        format!("list<{}>", T::wit())
    }
}

impl<T: WitType, E: WitType> WitType for Result<T, E> {
    fn wit() -> String {
        format!("result<{}, {}>", T::wit(), E::wit())
    }
}

/// Gli alberi nativi che al confine diventano l'**arena intera** e non una lista
/// di indici.
///
/// Serve un trait a parte perché la stessa `Vec<Block>` significa due cose
/// diverse a due profondità diverse: il corpo di un documento *è* l'arena
/// (`document-tree`), i figli di una citazione sono indici dentro di essa
/// (`list<block-ref>`, e quelli li porta `arena::Block`). Restando un trait, il
/// vincolo è comunque sul tipo: se `DocumentModel::body` cambiasse tipo, questa
/// impl non ci sarebbe e il test non compilerebbe.
trait TreeAtBoundary {
    fn wit_tree() -> String;
}

impl TreeAtBoundary for Vec<fubmd_abi::model::Block> {
    fn wit_tree() -> String {
        "document-tree".to_string()
    }
}

fn wit_tree<T: TreeAtBoundary + ?Sized>(_v: &T) -> String {
    T::wit_tree()
}

// ---------------------------------------------------------------------------
// La firma WIT di un metodo, dedotta dal puntatore a funzione
// ---------------------------------------------------------------------------

/// Una firma come il WIT la vedrebbe: parametri (ricevitore e `host` esclusi) e
/// risultato.
struct RustSig {
    params: Vec<String>,
    result: Option<String>,
    /// La firma Rust aveva un `host` da elidere?
    has_host: bool,
}

/// Un metodo di trait, visto come puntatore a funzione.
trait WitFn {
    fn sig() -> RustSig;
}

/// Costruisce la firma scartando il ricevitore e l'host.
fn sig_from(all: Vec<String>, result: String) -> RustSig {
    let mut it = all.into_iter();
    let receiver = it.next().expect("un metodo ha almeno il ricevitore");
    assert!(
        receiver == SELF || receiver == HOST,
        "il primo parametro dovrebbe essere il ricevitore, invece è `{receiver}`: \
         questo test va chiamato con un metodo di trait, non con una funzione libera"
    );
    let mut params = Vec::new();
    let mut has_host = false;
    for ty in it {
        if ty == HOST {
            has_host = true;
            continue;
        }
        assert_ne!(ty, SELF, "un provider non può comparire fra i parametri");
        params.push(ty);
    }
    RustSig {
        params,
        result: (result != "_").then_some(result),
        has_host,
    }
}

macro_rules! wit_fn {
    ($($p:ident),+) => {
        impl<$($p: WitType,)+ R: WitType> WitFn for fn($($p),+) -> R {
            fn sig() -> RustSig {
                sig_from(vec![$($p::wit()),+], R::wit())
            }
        }
    };
}

wit_fn!(A);
wit_fn!(A, B);
wit_fn!(A, B, C);
wit_fn!(A, B, C, D);
wit_fn!(A, B, C, D, E);

/// I due modi in cui l'`HostApi` compare in una firma Rust. Sono scritti con
/// lifetime `'static` solo perché un puntatore a funzione con lifetime elisi
/// sarebbe higher-ranked, e un tipo higher-ranked non può implementare [`WitFn`];
/// il cast dal metodo del trait resta valido, ed è quello che vincola la firma.
type Host = &'static mut dyn HostApi;
type HostRef = &'static dyn HostApi;

// ---------------------------------------------------------------------------
// Il WIT, parsato: nomi e tipi DICHIARATI, non sottostringhe
// ---------------------------------------------------------------------------

/// La forma di un tipo dichiarato nel WIT, ridotta a ciò che si confronta.
enum Shape {
    /// Campi in ordine: nome → tipo.
    Record(Vec<(String, String)>),
    /// Casi in ordine: nome → tipo del payload (`None` = caso nudo).
    Variant(Vec<(String, Option<String>)>),
    /// Casi di un `enum`, in ordine.
    Enum(Vec<String>),
    /// Destinazione di un alias (`type job-id = u64` → `u64`).
    Alias(String),
    /// Qualunque altra cosa: se compare, `finish` la segnala come non rivendicata.
    Other,
}

impl Shape {
    fn kind(&self) -> &'static str {
        match self {
            Shape::Record(_) => "record",
            Shape::Variant(_) => "variant",
            Shape::Enum(_) => "enum",
            Shape::Alias(_) => "alias",
            Shape::Other => "altro",
        }
    }
}

struct Decl {
    shape: Shape,
    /// Interfaccia che lo dichiara (solo per i messaggi d'errore).
    interface: String,
}

/// Una funzione dichiarata nel WIT.
struct WitSig {
    params: Vec<(String, String)>,
    result: Option<String>,
}

struct Wit {
    /// Tipi dichiarati (i `use` di altre interfacce sono esclusi: sono
    /// importazioni, non dichiarazioni).
    types: BTreeMap<String, Decl>,
    /// Interfaccia → funzioni dichiarate, con la loro firma.
    functions: BTreeMap<String, BTreeMap<String, WitSig>>,
    package: String,
    /// world → (interfacce importate, interfacce esportate).
    worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,

    /// Tipi già confrontati: ciò che resta a fine test è contratto morto.
    covered_types: BTreeSet<String>,
    /// Interfaccia → funzioni già confrontate.
    covered_fns: BTreeMap<String, BTreeSet<String>>,
    /// Divergenze accumulate: il test le riporta tutte insieme, non solo la prima.
    errors: Vec<String>,
}

/// Il nome WIT di un tipo: quello dichiarato se ce l'ha, altrimenti l'espressione
/// (`option<list<inline-ref>>`, `result<_, plugin-error>`, …).
fn render(resolve: &Resolve, ty: &Type) -> String {
    let id = match ty {
        Type::Bool => return "bool".into(),
        Type::U8 => return "u8".into(),
        Type::U16 => return "u16".into(),
        Type::U32 => return "u32".into(),
        Type::U64 => return "u64".into(),
        Type::S8 => return "s8".into(),
        Type::S16 => return "s16".into(),
        Type::S32 => return "s32".into(),
        Type::S64 => return "s64".into(),
        Type::F32 => return "f32".into(),
        Type::F64 => return "f64".into(),
        Type::Char => return "char".into(),
        Type::String => return "string".into(),
        Type::ErrorContext => return "error-context".into(),
        Type::Id(id) => *id,
    };
    let td = &resolve.types[id];
    if let Some(name) = &td.name {
        return name.clone();
    }
    let opt = |t: &Option<Type>| match t {
        Some(t) => render(resolve, t),
        None => "_".to_string(),
    };
    match &td.kind {
        TypeDefKind::Option(t) => format!("option<{}>", render(resolve, t)),
        TypeDefKind::List(t) => format!("list<{}>", render(resolve, t)),
        TypeDefKind::Result(r) => format!("result<{}, {}>", opt(&r.ok), opt(&r.err)),
        TypeDefKind::Tuple(t) => {
            let inner: Vec<String> = t.types.iter().map(|t| render(resolve, t)).collect();
            format!("tuple<{}>", inner.join(", "))
        }
        TypeDefKind::Type(t) => render(resolve, t),
        other => format!("<anonimo:{}>", other.as_str()),
    }
}

fn load(source: &str) -> Wit {
    let mut resolve = Resolve::new();
    // Se il contratto non è un WIT valido il test muore QUI, ed è il punto.
    if let Err(e) = resolve.push_str("wit/fubmd/abi.wit", source) {
        panic!("wit/fubmd/abi.wit non è un WIT valido: {e:?}");
    }

    let mut types: BTreeMap<String, Decl> = BTreeMap::new();
    let mut functions: BTreeMap<String, BTreeMap<String, WitSig>> = BTreeMap::new();

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

            let shape = match &td.kind {
                TypeDefKind::Record(r) => Shape::Record(
                    r.fields
                        .iter()
                        .map(|f| (f.name.clone(), render(&resolve, &f.ty)))
                        .collect(),
                ),
                TypeDefKind::Variant(v) => Shape::Variant(
                    v.cases
                        .iter()
                        .map(|c| (c.name.clone(), c.ty.as_ref().map(|t| render(&resolve, t))))
                        .collect(),
                ),
                TypeDefKind::Enum(e) => {
                    Shape::Enum(e.cases.iter().map(|c| c.name.clone()).collect())
                }
                TypeDefKind::Type(t) => Shape::Alias(render(&resolve, t)),
                TypeDefKind::List(t) => Shape::Alias(format!("list<{}>", render(&resolve, t))),
                TypeDefKind::Option(t) => Shape::Alias(format!("option<{}>", render(&resolve, t))),
                _ => Shape::Other,
            };

            let decl = Decl {
                shape,
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

        let sigs = iface
            .functions
            .iter()
            .map(|(name, f)| {
                let sig = WitSig {
                    params: f
                        .params
                        .iter()
                        .map(|p| (p.name.clone(), render(&resolve, &p.ty)))
                        .collect(),
                    result: f.result.as_ref().map(|t| render(&resolve, t)),
                };
                (name.clone(), sig)
            })
            .collect();
        functions.insert(iface_name, sigs);
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
        covered_fns: BTreeMap::new(),
        errors: Vec::new(),
    }
}

/// Confronta due elenchi ordinati di `nome → tipo`, e dice tutto ciò che non
/// combacia: nomi assenti, nomi di troppo, tipi diversi, ordine diverso.
///
/// L'ordine conta: in un record è la disposizione canonica al confine, in un
/// variant è il discriminante. Un riordino è un cambio di ABI, non di stile.
fn diff(
    what: &str,
    owner: &str,
    expected: &[(String, Option<String>)],
    declared: &[(String, Option<String>)],
) -> Vec<String> {
    let mut errors = Vec::new();
    let names = |v: &[(String, Option<String>)]| -> Vec<String> {
        v.iter().map(|(n, _)| n.clone()).collect()
    };
    let exp_names: BTreeSet<String> = names(expected).into_iter().collect();
    let dec_names: BTreeSet<String> = names(declared).into_iter().collect();

    let missing: Vec<&String> = exp_names.difference(&dec_names).collect();
    if !missing.is_empty() {
        errors.push(format!("`{owner}`: {what} assenti dal WIT {missing:?}"));
    }
    let extra: Vec<&String> = dec_names.difference(&exp_names).collect();
    if !extra.is_empty() {
        errors.push(format!(
            "`{owner}`: {what} nel WIT ma ignoti all'abi {extra:?} (contratto morto?)"
        ));
    }

    let declared_ty: BTreeMap<&String, &Option<String>> =
        declared.iter().map(|(n, t)| (n, t)).collect();
    for (name, ty) in expected {
        let Some(got) = declared_ty.get(name) else {
            continue; // già segnalato come assente
        };
        if *got != ty {
            let fmt = |t: &Option<String>| t.clone().unwrap_or_else(|| "(nessun payload)".into());
            errors.push(format!(
                "`{owner}.{name}`: nel WIT è `{}`, nell'abi è `{}`",
                fmt(got),
                fmt(ty)
            ));
        }
    }

    if missing.is_empty() && extra.is_empty() && names(expected) != names(declared) {
        errors.push(format!(
            "`{owner}`: l'ordine dei {what} diverge — abi {:?}, WIT {:?} \
             (l'ordine è ABI: in un record è la disposizione, in un variant il discriminante)",
            names(expected),
            names(declared)
        ));
    }
    errors
}

/// L'ordine di dichiarazione dei casi di un enum Rust, letto dal **sorgente**
/// (in kebab-case, come i nomi WIT).
///
/// È l'anello che mancava: i match esaustivi di questo test obbligano a
/// elencare *tutti* i casi, ma niente obbligava a elencarli *in fila* —  e
/// l'ordine dei casi è il discriminante ABI. Qui l'ordine atteso si deriva
/// dall'enum stesso, così riordinare l'enum Rust senza toccare WIT e test è
/// rosso quanto riordinare il WIT.
fn rust_enum_order(file: &str, enum_name: &str) -> Vec<String> {
    let path = format!("{}/src/{file}", env!("CARGO_MANIFEST_DIR"));
    let src = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("impossibile leggere {path}: {e}"));
    let ast: syn::File = syn::parse_file(&src).unwrap_or_else(|e| panic!("{path} non parsa: {e}"));
    for item in ast.items {
        if let syn::Item::Enum(e) = item {
            if e.ident == enum_name {
                return e
                    .variants
                    .iter()
                    .map(|v| kebab(&v.ident.to_string()))
                    .collect();
            }
        }
    }
    panic!("enum `{enum_name}` non trovato fra gli item top-level di {path}");
}

/// `CodeBlock` → `code-block`: la stessa convenzione di nome del WIT.
fn kebab(camel: &str) -> String {
    let mut out = String::new();
    for (i, c) in camel.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// Un caso di `variant`, con il tipo del payload e — se il payload è un record
/// dedicato — i suoi campi.
struct Case {
    name: &'static str,
    payload: Option<String>,
    fields: Option<Vec<(&'static str, String)>>,
}

/// Caso senza payload (`index-updated`, `none`).
fn case(name: &'static str) -> Case {
    Case {
        name,
        payload: None,
        fields: None,
    }
}

/// Caso con payload anonimo (`text(string)`, `emph(list<inline-ref>)`).
fn case_ty(name: &'static str, payload: String) -> Case {
    Case {
        name,
        payload: Some(payload),
        fields: None,
    }
}

/// Caso il cui payload è un record dedicato del WIT.
fn case_rec(name: &'static str, ty: &'static str, fields: Vec<(&'static str, String)>) -> Case {
    Case {
        name,
        payload: Some(ty.to_string()),
        fields: Some(fields),
    }
}

impl Wit {
    fn err(&mut self, msg: String) {
        self.errors.push(msg);
    }

    fn shape_of(&mut self, name: &str, atteso: &'static str) -> Option<&Shape> {
        self.covered_types.insert(name.to_string());
        let Some(decl) = self.types.get(name) else {
            self.errors
                .push(format!("`{name}` ({atteso}) manca dal WIT"));
            return None;
        };
        let got = decl.shape.kind();
        if got != atteso {
            self.errors.push(format!(
                "`{name}`: nel WIT è `{got}`, nell'abi è `{atteso}`"
            ));
            return None;
        }
        self.types.get(name).map(|d| &d.shape)
    }

    fn record(&mut self, name: &str, fields: &[(&'static str, String)]) {
        let expected: Vec<(String, Option<String>)> = fields
            .iter()
            .map(|(n, t)| (n.to_string(), Some(t.clone())))
            .collect();
        let Some(Shape::Record(declared)) = self.shape_of(name, "record") else {
            return;
        };
        let declared: Vec<(String, Option<String>)> = declared
            .iter()
            .map(|(n, t)| (n.clone(), Some(t.clone())))
            .collect();
        let errors = diff("campi", name, &expected, &declared);
        self.errors.extend(errors);
    }

    fn enumeration(&mut self, name: &str, cases: &[&str]) {
        let expected: Vec<(String, Option<String>)> =
            cases.iter().map(|c| (c.to_string(), None)).collect();
        let Some(Shape::Enum(declared)) = self.shape_of(name, "enum") else {
            return;
        };
        let declared: Vec<(String, Option<String>)> =
            declared.iter().map(|c| (c.clone(), None)).collect();
        let errors = diff("casi", name, &expected, &declared);
        self.errors.extend(errors);
    }

    /// Come [`variant`](Wit::variant), ma verifica ANCHE che l'ordine dei casi
    /// elencati dal test coincida con l'ordine di dichiarazione dell'enum Rust
    /// (`src` = `(file, nome dell'enum)`): l'enum è la verità, e un suo
    /// riordino deve far fallire il test anche se WIT e test restano uguali.
    fn variant_src(&mut self, name: &str, src: (&str, &str), cases: &[Case]) {
        let listed: Vec<String> = cases.iter().map(|c| c.name.to_string()).collect();
        let declared = rust_enum_order(src.0, src.1);
        if listed != declared {
            self.err(format!(
                "`{name}`: l'ordine dei casi diverge dalla dichiarazione Rust di \
                 `{}` ({}) — test/WIT {listed:?}, enum {declared:?} \
                 (l'ordine dei casi è il discriminante ABI)",
                src.1, src.0
            ));
        }
        self.variant(name, cases);
    }

    /// Il gemello di [`variant_src`](Wit::variant_src) per gli `enum` WIT.
    fn enumeration_src(&mut self, name: &str, src: (&str, &str), cases: &[&str]) {
        let listed: Vec<String> = cases.iter().map(|c| c.to_string()).collect();
        let declared = rust_enum_order(src.0, src.1);
        if listed != declared {
            self.err(format!(
                "`{name}`: l'ordine dei casi diverge dalla dichiarazione Rust di \
                 `{}` ({}) — test/WIT {listed:?}, enum {declared:?} \
                 (l'ordine dei casi è il discriminante ABI)",
                src.1, src.0
            ));
        }
        self.enumeration(name, cases);
    }

    fn variant(&mut self, name: &str, cases: &[Case]) {
        let expected: Vec<(String, Option<String>)> = cases
            .iter()
            .map(|c| (c.name.to_string(), c.payload.clone()))
            .collect();
        if let Some(Shape::Variant(declared)) = self.shape_of(name, "variant") {
            let declared = declared.clone();
            let errors = diff("casi", name, &expected, &declared);
            self.errors.extend(errors);
        }
        // I record di payload sono tipi a sé nel contratto: si verificano come
        // tali, altrimenti resterebbero "non rivendicati" alla fine.
        for c in cases {
            if let (Some(ty), Some(fields)) = (&c.payload, &c.fields) {
                self.record(ty, fields);
            }
        }
    }

    /// Un alias (`type doc-id = string`): qui il *tipo* è l'informazione, ed è
    /// ciò che tiene onesti gli indici dell'arena (`u32`) e la larghezza degli
    /// span al confine (`u64`).
    fn alias(&mut self, name: &str, target: String) {
        let Some(Shape::Alias(got)) = self.shape_of(name, "alias") else {
            return;
        };
        if *got != target {
            let got = got.clone();
            self.err(format!(
                "alias `{name}`: nel WIT è `{got}`, nell'abi è `{target}`"
            ));
        }
    }

    /// Un'interfaccia di soli tipi: dichiara che non ci si aspetta funzioni.
    fn types_only(&mut self, iface: &str) {
        self.covered_fns.entry(iface.to_string()).or_default();
    }

    /// Confronta la firma completa di una funzione con quella del metodo Rust
    /// da cui `f` è stato ricavato.
    ///
    /// `param_names` sono i nomi dei parametri nel WIT: i soli dati scritti a
    /// mano qui, perché il nome di un parametro non esiste a livello di tipo. I
    /// **tipi** vengono dal puntatore a funzione, e quello viene dal trait.
    fn method<F: WitFn>(&mut self, iface: &str, name: &str, _f: F, param_names: &[&str]) {
        self.covered_fns
            .entry(iface.to_string())
            .or_default()
            .insert(name.to_string());

        let rust = F::sig();
        assert_eq!(
            rust.params.len(),
            param_names.len(),
            "{iface}.{name}: la firma Rust ha {} parametri (host escluso) ma qui \
             sono stati nominati {} — è questo test da aggiornare",
            rust.params.len(),
            param_names.len()
        );

        let Some(sig) = self.functions.get(iface).and_then(|f| f.get(name)) else {
            self.err(format!("funzione `{iface}.{name}` assente dal WIT"));
            return;
        };
        let declared_params = sig.params.clone();
        let declared_result = sig.result.clone();

        // `host` non attraversa il confine: le capacità sono importate dal
        // world, non passate come argomento. Qui si verifica *sul metodo che ce
        // l'ha*, cioè dove una traduzione ingenua l'avrebbe tenuto; il
        // controllo generale (nessuna funzione, in nessuna interfaccia) è in
        // `finish`, e serve per le funzioni che questo test non nominasse.
        if rust.has_host {
            if let Some((n, t)) = declared_params.iter().find(|(n, _)| n == "host") {
                self.err(format!(
                    "funzione `{iface}.{name}`: il metodo Rust prende un `HostApi` e il WIT \
                     dichiara `{n}: {t}` — la capacità è importata dal world, va ELISA"
                ));
            }
        }

        let expected: Vec<(String, Option<String>)> = param_names
            .iter()
            .zip(&rust.params)
            .map(|(n, t)| (n.to_string(), Some(t.clone())))
            .collect();
        let declared: Vec<(String, Option<String>)> = declared_params
            .iter()
            .map(|(n, t)| (n.clone(), Some(t.clone())))
            .collect();
        let errors = diff(
            "parametri",
            &format!("{iface}.{name}"),
            &expected,
            &declared,
        );
        self.errors.extend(errors);

        if declared_result != rust.result {
            let fmt = |r: &Option<String>| r.clone().unwrap_or_else(|| "(nessuno)".into());
            self.err(format!(
                "funzione `{iface}.{name}`: risultato `{}` nel WIT, `{}` nell'abi",
                fmt(&declared_result),
                fmt(&rust.result)
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

        // Nessuna funzione, in nessuna interfaccia, può nominare un parametro
        // `host`: l'`HostApi` si importa, non si passa.
        let intrusi: Vec<String> = self
            .functions
            .iter()
            .flat_map(|(iface, sigs)| {
                sigs.iter()
                    .filter(|(_, sig)| sig.params.iter().any(|(p, _)| p == "host"))
                    .map(move |(name, _)| format!("{iface}.{name}"))
            })
            .collect();
        if !intrusi.is_empty() {
            self.err(format!(
                "funzioni del WIT con un parametro `host` {intrusi:?}: le capacità sono \
                 importate dal world (`import host-api`), non passate come argomento"
            ));
        }

        let ifaces: BTreeSet<String> = self.functions.keys().cloned().collect();
        let visited: BTreeSet<String> = self.covered_fns.keys().cloned().collect();
        let orphan: Vec<&String> = ifaces.difference(&visited).collect();
        if !orphan.is_empty() {
            self.err(format!("interfacce del WIT mai verificate qui: {orphan:?}"));
        }
        for (iface, sigs) in &self.functions {
            let Some(checked) = self.covered_fns.get(iface) else {
                continue;
            };
            let declared: BTreeSet<String> = sigs.keys().cloned().collect();
            let orphan: Vec<&String> = declared.difference(checked).collect();
            if !orphan.is_empty() {
                self.errors.push(format!(
                    "interfaccia `{iface}`: funzioni nel WIT ma ignote all'abi {orphan:?}"
                ));
            }
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

fn block_case(b: &arena::Block) -> Case {
    match b {
        arena::Block::Heading {
            level,
            inlines,
            anchor,
            span,
        } => case_rec(
            "heading",
            "block-heading",
            vec![
                ("level", wit(level)),
                ("inlines", wit(inlines)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Paragraph {
            inlines,
            anchor,
            span,
        } => case_rec(
            "paragraph",
            "block-paragraph",
            vec![
                ("inlines", wit(inlines)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::List {
            ordered,
            items,
            anchor,
            span,
        } => case_rec(
            "list",
            "block-list",
            vec![
                ("ordered", wit(ordered)),
                ("items", wit(items)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::CodeBlock {
            lang,
            code,
            anchor,
            span,
        } => case_rec(
            "code-block",
            "block-code-block",
            vec![
                ("lang", wit(lang)),
                ("code", wit(code)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Quote {
            blocks,
            anchor,
            span,
        } => case_rec(
            "quote",
            "block-quote",
            vec![
                ("blocks", wit(blocks)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::ThematicBreak { anchor, span } => case_rec(
            "thematic-break",
            "block-thematic-break",
            vec![("anchor", wit(anchor)), ("span", wit(span))],
        ),
        arena::Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span,
        } => case_rec(
            "custom",
            "block-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("blocks", wit(blocks)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Table {
            head,
            rows,
            align,
            anchor,
            span,
        } => case_rec(
            "table",
            "block-table",
            vec![
                ("head", wit(head)),
                ("rows", wit(rows)),
                ("align", wit(align)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
    }
}

fn property_value_case(p: &PropertyValue) -> Case {
    match p {
        PropertyValue::Empty => case("empty"),
        PropertyValue::Text(s) => case_ty("text", wit(s)),
        PropertyValue::Number(n) => case_ty("number", wit(n)),
        PropertyValue::Bool(b) => case_ty("bool", wit(b)),
        PropertyValue::Date(d) => case_ty("date", wit(d)),
        PropertyValue::Link(t) => case_ty("link", wit(t)),
        PropertyValue::List(v) => case_ty("list", wit(v)),
        PropertyValue::Unknown(v) => case_ty("unknown", wit(v)),
    }
}

fn property_scalar_case(p: &PropertyScalar) -> Case {
    match p {
        PropertyScalar::Empty => case("empty"),
        PropertyScalar::Text(s) => case_ty("text", wit(s)),
        PropertyScalar::Number(n) => case_ty("number", wit(n)),
        PropertyScalar::Bool(b) => case_ty("bool", wit(b)),
        PropertyScalar::Date(d) => case_ty("date", wit(d)),
        PropertyScalar::Link(t) => case_ty("link", wit(t)),
        PropertyScalar::Unknown(v) => case_ty("unknown", wit(v)),
    }
}

fn column_align_name(a: ColumnAlign) -> &'static str {
    match a {
        ColumnAlign::None => "none",
        ColumnAlign::Left => "left",
        ColumnAlign::Center => "center",
        ColumnAlign::Right => "right",
    }
}

fn inline_case(i: &arena::Inline) -> Case {
    match i {
        arena::Inline::Text(s) => case_ty("text", wit(s)),
        arena::Inline::Emph(v) => case_ty("emph", wit(v)),
        arena::Inline::Strong(v) => case_ty("strong", wit(v)),
        arena::Inline::Code(s) => case_ty("code", wit(s)),
        arena::Inline::Link {
            target,
            label,
            embed,
            span,
        } => case_rec(
            "link",
            "inline-link",
            vec![
                ("target", wit(target)),
                ("label", wit(label)),
                ("embed", wit(embed)),
                ("span", wit(span)),
            ],
        ),
        arena::Inline::TagRef { name, span } => case_rec(
            "tag-ref",
            "inline-tag-ref",
            vec![("name", wit(name)), ("span", wit(span))],
        ),
        arena::Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => case_rec(
            "custom",
            "inline-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("span", wit(span)),
            ],
        ),
    }
}

fn link_target_case(t: &LinkTarget) -> Case {
    match t {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => case_rec(
            "wiki",
            "link-target-wiki",
            vec![
                ("page", wit(page)),
                ("heading", wit(heading)),
                ("block", wit(block)),
            ],
        ),
        LinkTarget::Url(s) => case_ty("url", wit(s)),
        LinkTarget::Path(s) => case_ty("path", wit(s)),
    }
}

fn ui_kind_case(n: &arena::UiKind) -> Case {
    match n {
        arena::UiKind::Stack { dir, gap, children } => case_rec(
            "stack",
            "ui-stack",
            vec![
                ("dir", wit(dir)),
                ("gap", wit(gap)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Text { content } => case_ty("text", wit(content)),
        arena::UiKind::Heading { level, content } => case_rec(
            "heading",
            "ui-heading",
            vec![("level", wit(level)), ("content", wit(content))],
        ),
        arena::UiKind::List { items } => case_ty("list", wit(items)),
        arena::UiKind::ListItem {
            title,
            subtitle,
            action,
            selected,
        } => case_rec(
            "list-item",
            "ui-list-item",
            vec![
                ("title", wit(title)),
                ("subtitle", wit(subtitle)),
                ("action", wit(action)),
                ("selected", wit(selected)),
            ],
        ),
        arena::UiKind::Button {
            label,
            intent,
            action,
        } => case_rec(
            "button",
            "ui-button",
            vec![
                ("label", wit(label)),
                ("intent", wit(intent)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Html { html } => case_ty("html", wit(html)),
        arena::UiKind::WebView { url, height } => case_rec(
            "web-view",
            "ui-web-view",
            vec![("url", wit(url)), ("height", wit(height))],
        ),
        arena::UiKind::Section {
            title,
            collapsed,
            children,
        } => case_rec(
            "section",
            "ui-section",
            vec![
                ("title", wit(title)),
                ("collapsed", wit(collapsed)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Table { columns, rows } => case_rec(
            "table",
            "ui-table",
            vec![("columns", wit(columns)), ("rows", wit(rows))],
        ),
        arena::UiKind::Row { cells, action } => case_rec(
            "row",
            "ui-row",
            vec![("cells", wit(cells)), ("action", wit(action))],
        ),
        arena::UiKind::Tree { roots } => case_ty("tree", wit(roots)),
        arena::UiKind::TreeItem {
            label,
            expanded,
            action,
            selected,
            children,
        } => case_rec(
            "tree-item",
            "ui-tree-item",
            vec![
                ("label", wit(label)),
                ("expanded", wit(expanded)),
                ("action", wit(action)),
                ("selected", wit(selected)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Tabs { active, tabs } => case_rec(
            "tabs",
            "ui-tabs",
            vec![("active", wit(active)), ("tabs", wit(tabs))],
        ),
        arena::UiKind::Tab {
            label,
            action,
            children,
        } => case_rec(
            "tab",
            "ui-tab",
            vec![
                ("label", wit(label)),
                ("action", wit(action)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Badge { label, intent } => case_rec(
            "badge",
            "ui-badge",
            vec![("label", wit(label)), ("intent", wit(intent))],
        ),
        arena::UiKind::Icon { name } => case_ty("icon", wit(name)),
        arena::UiKind::Progress { value, label } => case_rec(
            "progress",
            "ui-progress",
            vec![("value", wit(value)), ("label", wit(label))],
        ),
        arena::UiKind::Separator => case("separator"),
        arena::UiKind::EmptyState {
            title,
            detail,
            action,
        } => case_rec(
            "empty-state",
            "ui-empty-state",
            vec![
                ("title", wit(title)),
                ("detail", wit(detail)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::KeyValue { entries } => case_ty("key-value", wit(entries)),
        arena::UiKind::TextInput {
            field,
            label,
            value,
            placeholder,
            action,
        } => case_rec(
            "text-input",
            "ui-text-input",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("placeholder", wit(placeholder)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::TextArea {
            field,
            label,
            value,
            rows,
            action,
        } => case_rec(
            "text-area",
            "ui-text-area",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("rows", wit(rows)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Number {
            field,
            label,
            value,
            min,
            max,
            step,
            action,
        } => case_rec(
            "number",
            "ui-number",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("min", wit(min)),
                ("max", wit(max)),
                ("step", wit(step)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Checkbox {
            field,
            label,
            value,
            action,
        } => case_rec(
            "checkbox",
            "ui-checkbox",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Select {
            field,
            label,
            value,
            options,
            multiple,
            action,
        } => case_rec(
            "select",
            "ui-select",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("options", wit(options)),
                ("multiple", wit(multiple)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Radio {
            field,
            label,
            value,
            options,
            action,
        } => case_rec(
            "radio",
            "ui-radio",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("options", wit(options)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Slider {
            field,
            label,
            value,
            min,
            max,
            step,
            action,
        } => case_rec(
            "slider",
            "ui-slider",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("min", wit(min)),
                ("max", wit(max)),
                ("step", wit(step)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::DatePicker {
            field,
            label,
            value,
            action,
        } => case_rec(
            "date-picker",
            "ui-date-picker",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Form {
            children,
            submit_label,
            submit,
        } => case_rec(
            "form",
            "ui-form",
            vec![
                ("children", wit(children)),
                ("submit-label", wit(submit_label)),
                ("submit", wit(submit)),
            ],
        ),
        arena::UiKind::Custom {
            ns,
            payload,
            fallback,
        } => case_rec(
            "custom",
            "ui-custom",
            vec![
                ("ns", wit(ns)),
                ("payload", wit(payload)),
                ("fallback", wit(fallback)),
            ],
        ),
        arena::UiKind::Pending { label } => case_ty("pending", wit(label)),
        arena::UiKind::Failed { message, retry } => case_rec(
            "failed",
            "ui-failed",
            vec![("message", wit(message)), ("retry", wit(retry))],
        ),
    }
}

fn ui_value_case(v: &UiValue) -> Case {
    match v {
        UiValue::Text(s) => case_ty("text", wit(s)),
        UiValue::Number(n) => case_ty("number", wit(n)),
        UiValue::Bool(b) => case_ty("bool", wit(b)),
        UiValue::Choices(c) => case_ty("choices", wit(c)),
    }
}

fn view_update_case(v: &ViewUpdate) -> Case {
    match v {
        // Il payload è l'arena `ui-tree`, non un record omonimo del caso.
        ViewUpdate::Replace { root } => case_ty("replace", wit(root)),
        ViewUpdate::None => case("none"),
        ViewUpdate::Navigate { doc_id } => case_ty("navigate", wit(doc_id)),
        ViewUpdate::Reveal { doc_id, span } => case_rec(
            "reveal",
            "view-update-reveal",
            vec![("doc-id", wit(doc_id)), ("span", wit(span))],
        ),
        ViewUpdate::RunSearch { query } => case_ty("run-search", wit(query)),
        ViewUpdate::Custom { ns, payload } => case_rec(
            "custom",
            "view-update-custom",
            vec![("ns", wit(ns)), ("payload", wit(payload))],
        ),
        // Il nodo è l'arena `ui-tree`, come la radice di `replace`.
        ViewUpdate::Patch { key, node } => case_rec(
            "patch",
            "view-update-patch",
            vec![("key", wit(key)), ("node", wit(node))],
        ),
    }
}

fn event_case(e: &Event) -> Case {
    match e {
        Event::VaultOpened { root } => case_rec(
            "vault-opened",
            "event-vault-opened",
            vec![("root", wit(root))],
        ),
        Event::DocumentChanged { id } => case_rec(
            "document-changed",
            "event-document-changed",
            vec![("id", wit(id))],
        ),
        Event::DocumentRemoved { id } => case_rec(
            "document-removed",
            "event-document-removed",
            vec![("id", wit(id))],
        ),
        // `from` è keyword WIT: nel contratto è `%from`, e l'identificatore
        // dichiarato resta `from`. Il campo Rust non si rinomina per una
        // questione di sintassi altrui.
        Event::DocumentRenamed { from, to } => case_rec(
            "document-renamed",
            "event-document-renamed",
            vec![("from", wit(from)), ("to", wit(to))],
        ),
        Event::IndexUpdated => case("index-updated"),
        // idem per `result` (`%result` nel WIT).
        Event::JobDone { id, job, result } => case_rec(
            "job-done",
            "event-job-done",
            vec![("id", wit(id)), ("job", wit(job)), ("result", wit(result))],
        ),
        Event::Overflow { dropped } => case_rec(
            "overflow",
            "event-overflow",
            vec![("dropped", wit(dropped))],
        ),
        Event::Custom { topic, payload } => case_rec(
            "custom",
            "event-custom",
            vec![("topic", wit(topic)), ("payload", wit(payload))],
        ),
        Event::BatchEnded { batch, changed } => case_rec(
            "batch-ended",
            "event-batch-ended",
            vec![("batch", wit(batch)), ("changed", wit(changed))],
        ),
        Event::ViewInvalidated { view, instance } => case_rec(
            "view-invalidated",
            "event-view-invalidated",
            vec![("view", wit(view)), ("instance", wit(instance))],
        ),
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
        EventKind::BatchEnded => "batch-ended",
        EventKind::ViewInvalidated => "view-invalidated",
    }
}

fn actor_case(a: &Actor) -> Case {
    match a {
        Actor::User => case("user"),
        Actor::Watcher => case("watcher"),
        Actor::Kernel => case("kernel"),
        Actor::Plugin { id } => case_rec("plugin", "actor-plugin", vec![("id", wit(id))]),
    }
}

fn index_query_case(q: &IndexQuery) -> Case {
    match q {
        IndexQuery::Backlinks { target, page } => case_rec(
            "backlinks",
            "index-query-backlinks",
            vec![("target", wit(target)), ("page", wit(page))],
        ),
        IndexQuery::FullText { query, scope, page } => case_rec(
            "full-text",
            "index-query-full-text",
            vec![
                ("query", wit(query)),
                ("scope", wit(scope)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::Outline { doc } => case_ty("outline", wit(doc)),
        IndexQuery::Tags { page } => {
            case_rec("tags", "index-query-tags", vec![("page", wit(page))])
        }
        IndexQuery::Neighbors {
            doc,
            direction,
            depth,
            page,
        } => case_rec(
            "neighbors",
            "index-query-neighbors",
            vec![
                ("doc", wit(doc)),
                ("direction", wit(direction)),
                ("depth", wit(depth)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::Properties {
            filter,
            sort,
            select,
            page,
        } => case_rec(
            "properties",
            "index-query-properties",
            vec![
                ("filter", wit(filter)),
                ("sort", wit(sort)),
                ("select", wit(select)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::PropertyValues { key, filter, page } => case_rec(
            "property-values",
            "index-query-property-values",
            vec![
                ("key", wit(key)),
                ("filter", wit(filter)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::VaultHealth { check, page } => case_rec(
            "vault-health",
            "index-query-vault-health",
            vec![("check", wit(check)), ("page", wit(page))],
        ),
        IndexQuery::Custom { ns, query } => case_rec(
            "custom",
            "index-query-custom",
            vec![("ns", wit(ns)), ("query", wit(query))],
        ),
    }
}

fn index_result_case(r: &IndexResult) -> Case {
    match r {
        IndexResult::Backlinks(v) => case_ty("backlinks", wit(v)),
        IndexResult::Search(v) => case_ty("search", wit(v)),
        IndexResult::Outline(v) => case_ty("outline", wit(v)),
        IndexResult::Tags(v) => case_ty("tags", wit(v)),
        IndexResult::Neighbors(v) => case_ty("neighbors", wit(v)),
        IndexResult::Properties(v) => case_ty("properties", wit(v)),
        IndexResult::PropertyValues(v) => case_ty("property-values", wit(v)),
        IndexResult::VaultHealth(v) => case_ty("vault-health", wit(v)),
        IndexResult::Custom(v) => case_ty("custom", wit(v)),
    }
}

fn property_test_case(t: &PropertyTest) -> Case {
    match t {
        PropertyTest::Exists => case("exists"),
        PropertyTest::Missing => case("missing"),
        PropertyTest::Equals(v) => case_ty("equals", wit(v)),
        PropertyTest::NotEquals(v) => case_ty("not-equals", wit(v)),
        PropertyTest::Contains(v) => case_ty("contains", wit(v)),
        PropertyTest::GreaterThan(v) => case_ty("greater-than", wit(v)),
        PropertyTest::LessThan(v) => case_ty("less-than", wit(v)),
    }
}

fn link_direction_name(d: LinkDirection) -> &'static str {
    match d {
        LinkDirection::Outbound => "outbound",
        LinkDirection::Inbound => "inbound",
        LinkDirection::Both => "both",
    }
}

fn health_check_name(c: HealthCheck) -> &'static str {
    match c {
        HealthCheck::BrokenLinks => "broken-links",
        HealthCheck::OrphanDocuments => "orphan-documents",
    }
}

fn command_reach_name(r: CommandReach) -> &'static str {
    match r {
        CommandReach::Session => "session",
        CommandReach::Document => "document",
        CommandReach::Documents => "documents",
        CommandReach::Vault => "vault",
        CommandReach::Settings => "settings",
    }
}

fn invoke_mode_name(m: InvokeMode) -> &'static str {
    match m {
        InvokeMode::Apply => "apply",
        InvokeMode::DryRun => "dry-run",
    }
}

fn command_effect_case(e: &CommandEffect) -> Case {
    match e {
        CommandEffect::Done => case("done"),
        CommandEffect::Navigate { doc } => case_ty("navigate", wit(doc)),
        CommandEffect::Reveal { doc, span } => case_rec(
            "reveal",
            "command-effect-reveal",
            vec![("doc", wit(doc)), ("span", wit(span))],
        ),
        CommandEffect::RunSearch { query } => case_ty("run-search", wit(query)),
        CommandEffect::Plan(plan) => case_ty("plan", wit(plan)),
        CommandEffect::Custom { ns, payload } => case_rec(
            "custom",
            "command-effect-custom",
            vec![("ns", wit(ns)), ("payload", wit(payload))],
        ),
        CommandEffect::OpenView { view, params } => case_rec(
            "open-view",
            "command-effect-open-view",
            vec![("view", wit(view)), ("params", wit(params))],
        ),
    }
}

fn pane_mode_name(m: PaneMode) -> &'static str {
    match m {
        PaneMode::Source => "source",
        PaneMode::LivePreview => "live-preview",
        PaneMode::Reading => "reading",
    }
}

fn context_kind_name(k: ContextKind) -> &'static str {
    match k {
        ContextKind::Document => "document",
        ContextKind::Selection => "selection",
        ContextKind::Mode => "mode",
    }
}

fn format_error_case(e: &FormatError) -> Case {
    match e {
        FormatError::Parse(s) => case_ty("parse", wit(s)),
        FormatError::Render(s) => case_ty("render", wit(s)),
        FormatError::Serialize(s) => case_ty("serialize", wit(s)),
        FormatError::Unsupported(s) => case_ty("unsupported", wit(s)),
    }
}

fn plugin_error_case(e: &PluginError) -> Case {
    match e {
        PluginError::UnknownCommand(s) => case_ty("unknown-command", wit(s)),
        PluginError::UnknownView(s) => case_ty("unknown-view", wit(s)),
        PluginError::UnknownJob(s) => case_ty("unknown-job", wit(s)),
        PluginError::BadArgs(s) => case_ty("bad-args", wit(s)),
        PluginError::PermissionDenied(s) => case_ty("permission-denied", wit(s)),
        PluginError::Internal(s) => case_ty("internal", wit(s)),
        PluginError::Conflict(s) => case_ty("conflict", wit(s)),
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

/// I campi di una finestra, col tipo di `items` dedotto dall'istanza: è così
/// che `backlinks-page` e `search-page` non possono finire per attendersi la
/// stessa lista.
fn paged_fields<T: WitType>(p: &Paged<T>) -> Vec<(&'static str, String)> {
    let Paged {
        items,
        offset,
        total,
    } = p;
    vec![
        ("items", wit(items)),
        ("offset", wit(offset)),
        ("total", wit(total)),
    ]
}

fn align_name(a: Align) -> &'static str {
    match a {
        Align::Start => "start",
        Align::Center => "center",
        Align::End => "end",
    }
}

fn view_surface_name(p: ViewSurface) -> &'static str {
    match p {
        ViewSurface::LeftSidebar => "left-sidebar",
        ViewSurface::RightSidebar => "right-sidebar",
        ViewSurface::Bottom => "bottom",
        ViewSurface::Main => "main",
        ViewSurface::Modal => "modal",
        ViewSurface::StatusBar => "status-bar",
        ViewSurface::Ribbon => "ribbon",
        ViewSurface::Menu => "menu",
        ViewSurface::ContextMenu => "context-menu",
        ViewSurface::SettingsTab => "settings-tab",
    }
}

fn note_level_name(l: NoteLevel) -> &'static str {
    match l {
        NoteLevel::Info => "info",
        NoteLevel::Warning => "warning",
        NoteLevel::Error => "error",
    }
}

fn import_mode_name(m: ImportMode) -> &'static str {
    match m {
        ImportMode::Preview => "preview",
        ImportMode::Apply => "apply",
    }
}

fn conflict_policy_name(p: ConflictPolicy) -> &'static str {
    match p {
        ConflictPolicy::Skip => "skip",
        ConflictPolicy::Replace => "replace",
        ConflictPolicy::Rename => "rename",
    }
}

fn import_outcome_case(o: &ImportOutcome) -> Case {
    match o {
        ImportOutcome::Created => case("created"),
        ImportOutcome::Replaced => case("replaced"),
        ImportOutcome::Skipped => case("skipped"),
        ImportOutcome::Failed(why) => case_ty("failed", wit(why)),
    }
}

fn export_selection_case(s: &ExportSelection) -> Case {
    match s {
        ExportSelection::Documents(ids) => case_ty("documents", wit(ids)),
        ExportSelection::Folder(f) => case_ty("folder", wit(f)),
        ExportSelection::Query(q) => case_ty("query", wit(q)),
    }
}

// ---------------------------------------------------------------------------
// Il confronto vero e proprio
// ---------------------------------------------------------------------------

/// Applica al WIT tutte le asserzioni derivate dall'abi. Separata dal test così
/// che `wit_conformance_actually_fails_on_drift` possa passarle un contratto
/// alterato ad arte e verificare che diventi rossa.
fn conform(source: &str) -> Result<(), String> {
    let mut contract = load(source);

    // Il numero del package è la stessa versione che i manifest dichiarano in
    // `abi-version` e che `abi_compatible` confronta: UNA fonte, `ABI_VERSION`.
    assert_eq!(
        contract.package,
        format!("fubmd:abi@{ABI_VERSION}"),
        "nome del package"
    );

    // --- variant/enum: un rappresentante per caso, esaustività dal compilatore

    let sp = arena::Span::default();
    let data = PropertyDate {
        year: 0,
        month: 1,
        day: 1,
        time: None,
    };
    contract.variant_src(
        "block",
        ("arena.rs", "Block"),
        &[
            block_case(&arena::Block::Heading {
                level: 1,
                inlines: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Paragraph {
                inlines: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::List {
                ordered: false,
                items: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::CodeBlock {
                lang: None,
                code: String::new(),
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Quote {
                blocks: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::ThematicBreak {
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Table {
                head: None,
                rows: vec![],
                align: vec![],
                anchor: None,
                span: sp,
            }),
        ],
    );

    contract.variant_src(
        "property-value",
        ("model.rs", "PropertyValue"),
        &[
            property_value_case(&PropertyValue::Empty),
            property_value_case(&PropertyValue::Text(String::new())),
            property_value_case(&PropertyValue::Number(0.0)),
            property_value_case(&PropertyValue::Bool(false)),
            property_value_case(&PropertyValue::Date(data)),
            property_value_case(&PropertyValue::Link(LinkTarget::wiki("p"))),
            property_value_case(&PropertyValue::List(vec![])),
            property_value_case(&PropertyValue::Unknown(serde_json::Value::Null)),
        ],
    );

    contract.variant_src(
        "property-scalar",
        ("model.rs", "PropertyScalar"),
        &[
            property_scalar_case(&PropertyScalar::Empty),
            property_scalar_case(&PropertyScalar::Text(String::new())),
            property_scalar_case(&PropertyScalar::Number(0.0)),
            property_scalar_case(&PropertyScalar::Bool(false)),
            property_scalar_case(&PropertyScalar::Date(data)),
            property_scalar_case(&PropertyScalar::Link(LinkTarget::wiki("p"))),
            property_scalar_case(&PropertyScalar::Unknown(serde_json::Value::Null)),
        ],
    );

    contract.enumeration_src(
        "column-align",
        ("model.rs", "ColumnAlign"),
        [
            ColumnAlign::None,
            ColumnAlign::Left,
            ColumnAlign::Center,
            ColumnAlign::Right,
        ]
        .map(column_align_name)
        .as_slice(),
    );

    contract.variant_src(
        "inline",
        ("arena.rs", "Inline"),
        &[
            inline_case(&arena::Inline::Text(String::new())),
            inline_case(&arena::Inline::Emph(vec![])),
            inline_case(&arena::Inline::Strong(vec![])),
            inline_case(&arena::Inline::Code(String::new())),
            inline_case(&arena::Inline::Link {
                target: LinkTarget::wiki("p"),
                label: None,
                embed: false,
                span: sp,
            }),
            inline_case(&arena::Inline::TagRef {
                name: String::new(),
                span: sp,
            }),
            inline_case(&arena::Inline::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                span: sp,
            }),
        ],
    );

    contract.variant_src(
        "link-target",
        ("model.rs", "LinkTarget"),
        &[
            link_target_case(&LinkTarget::wiki("p")),
            link_target_case(&LinkTarget::Url(String::new())),
            link_target_case(&LinkTarget::Path(String::new())),
        ],
    );

    contract.variant_src(
        "ui-kind",
        ("arena.rs", "UiKind"),
        &[
            ui_kind_case(&arena::UiKind::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Text {
                content: String::new(),
            }),
            ui_kind_case(&arena::UiKind::Heading {
                level: 1,
                content: String::new(),
            }),
            ui_kind_case(&arena::UiKind::List { items: vec![] }),
            ui_kind_case(&arena::UiKind::ListItem {
                title: String::new(),
                subtitle: None,
                action: None,
                selected: false,
            }),
            ui_kind_case(&arena::UiKind::Button {
                label: String::new(),
                intent: Intent::Neutral,
                action: ActionRef::new(""),
            }),
            ui_kind_case(&arena::UiKind::Html {
                html: String::new(),
            }),
            ui_kind_case(&arena::UiKind::WebView {
                url: String::new(),
                height: 0,
            }),
            ui_kind_case(&arena::UiKind::Section {
                title: String::new(),
                collapsed: false,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Table {
                columns: vec![],
                rows: vec![],
            }),
            ui_kind_case(&arena::UiKind::Row {
                cells: vec![],
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Tree { roots: vec![] }),
            ui_kind_case(&arena::UiKind::TreeItem {
                label: String::new(),
                expanded: false,
                action: None,
                selected: false,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Tabs {
                active: 0,
                tabs: vec![],
            }),
            ui_kind_case(&arena::UiKind::Tab {
                label: String::new(),
                action: None,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Badge {
                label: String::new(),
                intent: Intent::Neutral,
            }),
            ui_kind_case(&arena::UiKind::Icon {
                name: String::new(),
            }),
            ui_kind_case(&arena::UiKind::Progress {
                value: None,
                label: None,
            }),
            ui_kind_case(&arena::UiKind::Separator),
            ui_kind_case(&arena::UiKind::EmptyState {
                title: String::new(),
                detail: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::KeyValue { entries: vec![] }),
            ui_kind_case(&arena::UiKind::TextInput {
                field: String::new(),
                label: None,
                value: String::new(),
                placeholder: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::TextArea {
                field: String::new(),
                label: None,
                value: String::new(),
                rows: 0,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Number {
                field: String::new(),
                label: None,
                value: None,
                min: None,
                max: None,
                step: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Checkbox {
                field: String::new(),
                label: String::new(),
                value: false,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Select {
                field: String::new(),
                label: None,
                value: vec![],
                options: vec![],
                multiple: false,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Radio {
                field: String::new(),
                label: None,
                value: None,
                options: vec![],
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Slider {
                field: String::new(),
                label: None,
                value: 0.0,
                min: 0.0,
                max: 0.0,
                step: 0.0,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::DatePicker {
                field: String::new(),
                label: None,
                value: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Form {
                children: vec![],
                submit_label: String::new(),
                submit: ActionRef::new(""),
            }),
            ui_kind_case(&arena::UiKind::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
                fallback: vec![],
            }),
            ui_kind_case(&arena::UiKind::Pending { label: None }),
            ui_kind_case(&arena::UiKind::Failed {
                message: String::new(),
                retry: None,
            }),
        ],
    );

    contract.variant_src(
        "view-update",
        ("ui.rs", "ViewUpdate"),
        &[
            view_update_case(&ViewUpdate::Replace {
                root: UiNode::text(""),
            }),
            view_update_case(&ViewUpdate::None),
            view_update_case(&ViewUpdate::Navigate {
                doc_id: String::new(),
            }),
            view_update_case(&ViewUpdate::Reveal {
                doc_id: String::new(),
                span: Span::new(0, 0),
            }),
            view_update_case(&ViewUpdate::RunSearch {
                query: String::new(),
            }),
            view_update_case(&ViewUpdate::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
            }),
            view_update_case(&ViewUpdate::Patch {
                key: String::new(),
                node: UiNode::text(""),
            }),
        ],
    );

    contract.variant_src(
        "ui-value",
        ("ui.rs", "UiValue"),
        &[
            ui_value_case(&UiValue::Text(String::new())),
            ui_value_case(&UiValue::Number(0.0)),
            ui_value_case(&UiValue::Bool(false)),
            ui_value_case(&UiValue::Choices(vec![])),
        ],
    );

    contract.variant_src(
        "event",
        ("event.rs", "Event"),
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
            event_case(&Event::BatchEnded {
                batch: BatchId(0),
                changed: Vec::new(),
            }),
            event_case(&Event::ViewInvalidated {
                view: String::new(),
                instance: None,
            }),
        ],
    );

    contract.variant_src(
        "actor",
        ("event.rs", "Actor"),
        &[
            actor_case(&Actor::User),
            actor_case(&Actor::Watcher),
            actor_case(&Actor::Kernel),
            actor_case(&Actor::Plugin { id: String::new() }),
        ],
    );

    contract.variant_src(
        "index-query",
        ("traits.rs", "IndexQuery"),
        &[
            index_query_case(&IndexQuery::Backlinks {
                target: DocId::new("a"),
                page: None,
            }),
            index_query_case(&IndexQuery::FullText {
                query: String::new(),
                scope: SearchScope::default(),
                page: None,
            }),
            index_query_case(&IndexQuery::Outline {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::Tags { page: None }),
            index_query_case(&IndexQuery::Neighbors {
                doc: DocId::new("a"),
                direction: LinkDirection::Outbound,
                depth: 1,
                page: None,
            }),
            index_query_case(&IndexQuery::Properties {
                filter: Vec::new(),
                sort: None,
                select: Vec::new(),
                page: None,
            }),
            index_query_case(&IndexQuery::PropertyValues {
                key: String::new(),
                filter: Vec::new(),
                page: None,
            }),
            index_query_case(&IndexQuery::VaultHealth {
                check: HealthCheck::BrokenLinks,
                page: None,
            }),
            index_query_case(&IndexQuery::Custom {
                ns: String::new(),
                query: serde_json::Value::Null,
            }),
        ],
    );

    contract.variant_src(
        "index-result",
        ("traits.rs", "IndexResult"),
        &[
            index_result_case(&IndexResult::Backlinks(Paged::all(vec![]))),
            index_result_case(&IndexResult::Search(Paged::all(vec![]))),
            index_result_case(&IndexResult::Outline(vec![])),
            index_result_case(&IndexResult::Tags(Paged::all(vec![]))),
            index_result_case(&IndexResult::Neighbors(Paged::all(vec![]))),
            index_result_case(&IndexResult::Properties(Paged::all(vec![]))),
            index_result_case(&IndexResult::PropertyValues(Paged::all(vec![]))),
            index_result_case(&IndexResult::VaultHealth(Paged::all(vec![]))),
            index_result_case(&IndexResult::Custom(serde_json::Value::Null)),
        ],
    );

    contract.variant_src(
        "property-test",
        ("traits.rs", "PropertyTest"),
        &[
            property_test_case(&PropertyTest::Exists),
            property_test_case(&PropertyTest::Missing),
            property_test_case(&PropertyTest::Equals(PropertyValue::Empty)),
            property_test_case(&PropertyTest::NotEquals(PropertyValue::Empty)),
            property_test_case(&PropertyTest::Contains(PropertyScalar::Empty)),
            property_test_case(&PropertyTest::GreaterThan(PropertyValue::Empty)),
            property_test_case(&PropertyTest::LessThan(PropertyValue::Empty)),
        ],
    );

    contract.enumeration_src(
        "link-direction",
        ("traits.rs", "LinkDirection"),
        [
            LinkDirection::Outbound,
            LinkDirection::Inbound,
            LinkDirection::Both,
        ]
        .map(link_direction_name)
        .as_slice(),
    );

    contract.enumeration_src(
        "health-check",
        ("traits.rs", "HealthCheck"),
        [HealthCheck::BrokenLinks, HealthCheck::OrphanDocuments]
            .map(health_check_name)
            .as_slice(),
    );

    contract.variant_src(
        "format-error",
        ("error.rs", "FormatError"),
        &[
            format_error_case(&FormatError::Parse(String::new())),
            format_error_case(&FormatError::Render(String::new())),
            format_error_case(&FormatError::Serialize(String::new())),
            format_error_case(&FormatError::Unsupported(String::new())),
        ],
    );

    contract.variant_src(
        "plugin-error",
        ("error.rs", "PluginError"),
        &[
            plugin_error_case(&PluginError::UnknownCommand(String::new())),
            plugin_error_case(&PluginError::UnknownView(String::new())),
            plugin_error_case(&PluginError::UnknownJob(String::new())),
            plugin_error_case(&PluginError::BadArgs(String::new())),
            plugin_error_case(&PluginError::PermissionDenied(String::new())),
            plugin_error_case(&PluginError::Internal(String::new())),
            plugin_error_case(&PluginError::Conflict(String::new())),
        ],
    );

    contract.enumeration_src(
        "event-kind",
        ("event.rs", "EventKind"),
        [
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRemoved,
            EventKind::DocumentRenamed,
            EventKind::IndexUpdated,
            EventKind::JobDone,
            EventKind::Overflow,
            EventKind::Custom,
            EventKind::BatchEnded,
            EventKind::ViewInvalidated,
        ]
        .map(event_kind_name)
        .as_slice(),
    );
    contract.enumeration_src(
        "align",
        ("ui.rs", "Align"),
        [Align::Start, Align::Center, Align::End]
            .map(align_name)
            .as_slice(),
    );
    contract.enumeration_src(
        "axis",
        ("ui.rs", "Axis"),
        [Axis::Row, Axis::Column].map(axis_name).as_slice(),
    );
    contract.enumeration_src(
        "intent",
        ("ui.rs", "Intent"),
        [Intent::Neutral, Intent::Primary, Intent::Danger]
            .map(intent_name)
            .as_slice(),
    );
    contract.enumeration_src(
        "view-surface",
        ("traits.rs", "ViewSurface"),
        [
            ViewSurface::LeftSidebar,
            ViewSurface::RightSidebar,
            ViewSurface::Bottom,
            ViewSurface::Main,
            ViewSurface::Modal,
            ViewSurface::StatusBar,
            ViewSurface::Ribbon,
            ViewSurface::Menu,
            ViewSurface::ContextMenu,
            ViewSurface::SettingsTab,
        ]
        .map(view_surface_name)
        .as_slice(),
    );

    contract.enumeration_src(
        "note-level",
        ("transfer.rs", "NoteLevel"),
        [NoteLevel::Info, NoteLevel::Warning, NoteLevel::Error]
            .map(note_level_name)
            .as_slice(),
    );
    contract.enumeration_src(
        "import-mode",
        ("transfer.rs", "ImportMode"),
        [ImportMode::Preview, ImportMode::Apply]
            .map(import_mode_name)
            .as_slice(),
    );
    contract.enumeration_src(
        "conflict-policy",
        ("transfer.rs", "ConflictPolicy"),
        [
            ConflictPolicy::Skip,
            ConflictPolicy::Replace,
            ConflictPolicy::Rename,
        ]
        .map(conflict_policy_name)
        .as_slice(),
    );
    contract.variant_src(
        "import-outcome",
        ("transfer.rs", "ImportOutcome"),
        &[
            import_outcome_case(&ImportOutcome::Created),
            import_outcome_case(&ImportOutcome::Replaced),
            import_outcome_case(&ImportOutcome::Skipped),
            import_outcome_case(&ImportOutcome::Failed(String::new())),
        ],
    );
    contract.variant_src(
        "export-selection",
        ("transfer.rs", "ExportSelection"),
        &[
            export_selection_case(&ExportSelection::Documents(vec![])),
            export_selection_case(&ExportSelection::Folder(String::new())),
            export_selection_case(&ExportSelection::Query(IndexQuery::Tags { page: None })),
        ],
    );

    // --- record: destructuring esaustivo, un campo aggiunto non compila; e il
    //     tipo atteso lo deduce il compilatore dal campo stesso.

    let DocumentModel {
        id,
        frontmatter,
        body,
        outline,
        links,
        tags,
        anchors,
        text,
    } = DocumentModel::empty(DocId::new("x.md"));
    contract.record(
        "document-model",
        &[
            ("id", wit(&id)),
            ("frontmatter", wit(&frontmatter)),
            // L'unico campo la cui forma al confine non è quella del suo tipo:
            // l'albero diventa l'arena intera.
            ("body", wit_tree(&body)),
            ("outline", wit(&outline)),
            ("links", wit(&links)),
            ("tags", wit(&tags)),
            ("anchors", wit(&anchors)),
            ("text", wit(&text)),
        ],
    );

    // Lo `span` del WIT è quello del confine (`u64`), non quello nativo
    // (`usize`): la divergenza è deliberata e vive in `arena`, con le sue
    // conversioni e i suoi test.
    let arena::Span { start, end } = arena::Span::default();
    contract.record("span", &[("start", wit(&start)), ("end", wit(&end))]);

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
    contract.record(
        "heading",
        &[
            ("level", wit(&level)),
            ("text", wit(&text)),
            ("slug", wit(&slug)),
            ("span", wit(&span)),
        ],
    );

    let Tag { name, span } = Tag {
        name: String::new(),
        span: Span::EMPTY,
    };
    contract.record("tag", &[("name", wit(&name)), ("span", wit(&span))]);

    let Anchor { id, span, marker } = Anchor {
        id: String::new(),
        span: Span::EMPTY,
        marker: Span::EMPTY,
    };
    contract.record(
        "anchor",
        &[
            ("id", wit(&id)),
            ("span", wit(&span)),
            ("marker", wit(&marker)),
        ],
    );

    let Link {
        target,
        embed,
        span,
        context,
    } = Link {
        target: LinkTarget::wiki("p"),
        embed: false,
        span: Span::EMPTY,
        context: None,
    };
    contract.record(
        "link",
        &[
            ("target", wit(&target)),
            ("embed", wit(&embed)),
            ("span", wit(&span)),
            ("context", wit(&context)),
        ],
    );

    // Le forme della decisione 0003 che stanno *dentro* i blocchi: la voce di lista col suo
    // marcatore di task, e le righe/celle della tabella.
    let arena::ListItem { blocks, task, span } = arena::ListItem {
        blocks: Vec::new(),
        task: None,
        span: arena::Span::default(),
    };
    contract.record(
        "list-item",
        &[
            ("blocks", wit(&blocks)),
            ("task", wit(&task)),
            ("span", wit(&span)),
        ],
    );

    let arena::TaskMarker { symbol, span } = arena::TaskMarker {
        symbol: None,
        span: arena::Span::default(),
    };
    contract.record(
        "task-marker",
        &[("symbol", wit(&symbol)), ("span", wit(&span))],
    );

    let arena::TableRow { cells } = arena::TableRow { cells: Vec::new() };
    contract.record("table-row", &[("cells", wit(&cells))]);

    let arena::TableCell { inlines, span } = arena::TableCell {
        inlines: Vec::new(),
        span: arena::Span::default(),
    };
    contract.record(
        "table-cell",
        &[("inlines", wit(&inlines)), ("span", wit(&span))],
    );

    let PropertyDate {
        year,
        month,
        day,
        time,
    } = data;
    contract.record(
        "property-date",
        &[
            ("year", wit(&year)),
            ("month", wit(&month)),
            ("day", wit(&day)),
            ("time", wit(&time)),
        ],
    );

    let PropertyTime {
        hour,
        minute,
        second,
        offset_minutes,
    } = PropertyTime {
        hour: 0,
        minute: 0,
        second: 0,
        offset_minutes: None,
    };
    contract.record(
        "property-time",
        &[
            ("hour", wit(&hour)),
            ("minute", wit(&minute)),
            ("second", wit(&second)),
            ("offset-minutes", wit(&offset_minutes)),
        ],
    );

    let arena::DocumentTree {
        blocks,
        inlines,
        roots,
    } = arena::DocumentTree::default();
    contract.record(
        "document-tree",
        &[
            ("blocks", wit(&blocks)),
            ("inlines", wit(&inlines)),
            ("roots", wit(&roots)),
        ],
    );

    let arena::UiTree { nodes, root } = arena::UiTree {
        nodes: Vec::new(),
        root: UiRef(0),
    };
    contract.record("ui-tree", &[("nodes", wit(&nodes)), ("root", wit(&root))]);

    // La mappa con namespace: al confine una lista di coppie. È l'alias che
    // tiene onesto il §3.5 — se tornasse a essere `json`, l'entry sparirebbe e
    // il contratto smetterebbe di dire che le opzioni sono una STRUTTURA e non
    // una stringa da parsare.
    contract.record(
        "option-entry",
        &[
            ("key", wit_of::<String>()),
            ("value", wit_of::<serde_json::Value>()),
        ],
    );
    contract.alias("option-map", "list<option-entry>".to_string());

    contract.enumeration_src(
        "source-kind",
        ("format.rs", "SourceKind"),
        &["text", "bytes"],
    );

    let document_source_case = |s: &DocumentSource| match s {
        DocumentSource::Text(t) => case_ty("text", wit(t)),
        DocumentSource::Bytes(b) => case_ty("bytes", wit(b)),
    };
    contract.variant_src(
        "document-source",
        ("format.rs", "DocumentSource"),
        &[
            document_source_case(&DocumentSource::Text(String::new())),
            document_source_case(&DocumentSource::Bytes(vec![])),
        ],
    );

    let FormatDescriptor {
        id,
        name,
        extensions,
        source,
    } = FormatDescriptor::text("", "", &[]);
    contract.record(
        "format-descriptor",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("extensions", wit(&extensions)),
            ("source", wit(&source)),
        ],
    );

    let FormatCapabilities { syntax } = FormatCapabilities::default();
    contract.record("format-capabilities", &[("syntax", wit(&syntax))]);

    let DocumentFormat {
        descriptor,
        capabilities,
    } = DocumentFormat {
        descriptor: FormatDescriptor::text("", "", &[]),
        capabilities: FormatCapabilities::default(),
    };
    contract.record(
        "document-format",
        &[
            ("descriptor", wit(&descriptor)),
            ("capabilities", wit(&capabilities)),
        ],
    );

    let ParseContext { doc_id, options } = ParseContext::default();
    contract.record(
        "parse-context",
        &[("doc-id", wit(&doc_id)), ("options", wit(&options))],
    );

    contract.enumeration_src(
        "render-target",
        ("format.rs", "RenderTarget"),
        &["screen", "print", "pdf", "static-site"],
    );

    let RenderOptions { target, options } = RenderOptions::default();
    contract.record(
        "render-options",
        &[("target", wit(&target)), ("options", wit(&options))],
    );

    // --- i due innesti: chi aggiunge la sintassi (§3.1), chi disegna il blocco
    //     che ne esce (§3.2)

    let syntax_trigger_case = |t: &SyntaxTrigger| match t {
        SyntaxTrigger::Fence { info } => {
            case_rec("fence", "syntax-trigger-fence", vec![("info", wit(info))])
        }
        SyntaxTrigger::Inline { open, close } => case_rec(
            "inline",
            "syntax-trigger-inline",
            vec![("open", wit(open)), ("close", wit(close))],
        ),
    };
    contract.variant_src(
        "syntax-trigger",
        ("custom.rs", "SyntaxTrigger"),
        &[
            syntax_trigger_case(&SyntaxTrigger::Fence { info: vec![] }),
            syntax_trigger_case(&SyntaxTrigger::Inline {
                open: String::new(),
                close: String::new(),
            }),
        ],
    );

    let SyntaxRuleSpec {
        id,
        format,
        trigger,
        order,
        option,
        produces,
    } = SyntaxRuleSpec {
        id: String::new(),
        format: String::new(),
        trigger: SyntaxTrigger::Fence { info: vec![] },
        order: 0,
        option: None,
        produces: vec![],
    };
    contract.record(
        "syntax-rule-spec",
        &[
            ("id", wit(&id)),
            ("format", wit(&format)),
            ("trigger", wit(&trigger)),
            ("order", wit(&order)),
            ("option", wit(&option)),
            ("produces", wit(&produces)),
        ],
    );

    let SyntaxMatch {
        trigger,
        text,
        span,
    } = SyntaxMatch {
        trigger: String::new(),
        text: String::new(),
        span: Span::new(0, 0),
    };
    contract.record(
        "syntax-match",
        &[
            ("trigger", wit(&trigger)),
            ("text", wit(&text)),
            ("span", wit(&span)),
        ],
    );

    // `blocks` è l'ARENA e non una lista di indici: una regola produce un
    // sottoalbero intero, non riferimenti dentro un'arena che non possiede.
    let syntax_product_case = |p: &SyntaxProduct| match p {
        SyntaxProduct::Block {
            custom_kind,
            attrs,
            blocks,
        } => case_rec(
            "block",
            "syntax-product-block",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("blocks", wit_tree(blocks)),
            ],
        ),
        SyntaxProduct::Inline { custom_kind, attrs } => case_rec(
            "inline",
            "syntax-product-inline",
            vec![("custom-kind", wit(custom_kind)), ("attrs", wit(attrs))],
        ),
    };
    contract.variant_src(
        "syntax-product",
        ("custom.rs", "SyntaxProduct"),
        &[
            syntax_product_case(&SyntaxProduct::Block {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
            }),
            syntax_product_case(&SyntaxProduct::Inline {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
            }),
        ],
    );

    let CustomRendererSpec { id, kinds } = CustomRendererSpec {
        id: String::new(),
        kinds: vec![],
    };
    contract.record(
        "custom-renderer-spec",
        &[("id", wit(&id)), ("kinds", wit(&kinds))],
    );

    let CustomBlock {
        custom_kind,
        attrs,
        blocks,
        anchor,
        span,
    } = CustomBlock {
        custom_kind: String::new(),
        attrs: serde_json::Value::Null,
        blocks: vec![],
        anchor: None,
        span: Span::new(0, 0),
    };
    contract.record(
        "custom-block",
        &[
            ("custom-kind", wit(&custom_kind)),
            ("attrs", wit(&attrs)),
            ("blocks", wit_tree(&blocks)),
            ("anchor", wit(&anchor)),
            ("span", wit(&span)),
        ],
    );

    let custom_rendering_case = |r: &CustomRendering| match r {
        CustomRendering::Html(h) => case_ty("html", wit(h)),
        CustomRendering::Ui(n) => case_ty("ui", wit(n)),
        CustomRendering::Fallback => case("fallback"),
    };
    contract.variant_src(
        "custom-rendering",
        ("custom.rs", "CustomRendering"),
        &[
            custom_rendering_case(&CustomRendering::Html(String::new())),
            custom_rendering_case(&CustomRendering::Ui(Box::new(UiNode::text("")))),
            custom_rendering_case(&CustomRendering::Fallback),
        ],
    );

    // --- i comandi (decisione 0009 il registro, decisione 0010 il chiamante non umano)

    let CommandSpec {
        id,
        title,
        description,
        keybinding,
        params,
        scope,
    } = CommandSpec::new("", "");
    contract.record(
        "command-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("description", wit(&description)),
            ("keybinding", wit(&keybinding)),
            ("params", wit(&params)),
            ("scope", wit(&scope)),
        ],
    );

    let ParamSpec {
        name,
        title,
        description,
        kind,
        required,
    } = ParamSpec::new("", "", ParamKind::Text);
    contract.record(
        "param-spec",
        &[
            ("name", wit(&name)),
            ("title", wit(&title)),
            ("description", wit(&description)),
            ("kind", wit(&kind)),
            ("required", wit(&required)),
        ],
    );

    let Choice { value, title } = Choice::new("", "");
    contract.record("choice", &[("value", wit(&value)), ("title", wit(&title))]);

    contract.variant_src(
        "param-kind",
        ("command.rs", "ParamKind"),
        &[
            case("text"),
            case("number"),
            case("bool"),
            case("document"),
            case("documents"),
            case_ty("choice", wit(&Vec::<Choice>::new())),
        ],
    );

    let CommandScope {
        writes,
        reach,
        reversible,
    } = CommandScope::read_only();
    contract.record(
        "command-scope",
        &[
            ("writes", wit(&writes)),
            ("reach", wit(&reach)),
            ("reversible", wit(&reversible)),
        ],
    );

    contract.enumeration_src(
        "command-reach",
        ("command.rs", "CommandReach"),
        [
            CommandReach::Session,
            CommandReach::Document,
            CommandReach::Documents,
            CommandReach::Vault,
            CommandReach::Settings,
        ]
        .map(command_reach_name)
        .as_slice(),
    );

    contract.enumeration_src(
        "invoke-mode",
        ("command.rs", "InvokeMode"),
        [InvokeMode::Apply, InvokeMode::DryRun]
            .map(invoke_mode_name)
            .as_slice(),
    );

    let CommandOutcome { notify, effect } = CommandOutcome::done();
    contract.record(
        "command-outcome",
        &[("notify", wit(&notify)), ("effect", wit(&effect))],
    );

    contract.variant_src(
        "command-effect",
        ("command.rs", "CommandEffect"),
        &[
            command_effect_case(&CommandEffect::Done),
            command_effect_case(&CommandEffect::Navigate {
                doc: DocId::new(""),
            }),
            command_effect_case(&CommandEffect::Reveal {
                doc: DocId::new(""),
                span: Span::EMPTY,
            }),
            command_effect_case(&CommandEffect::RunSearch {
                query: String::new(),
            }),
            command_effect_case(&CommandEffect::Plan(CommandPlan::default())),
            command_effect_case(&CommandEffect::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
            }),
            command_effect_case(&CommandEffect::OpenView {
                view: String::new(),
                params: serde_json::Value::Null,
            }),
        ],
    );

    let CommandPlan {
        summary,
        docs,
        edits,
    } = CommandPlan::default();
    contract.record(
        "command-plan",
        &[
            ("summary", wit(&summary)),
            ("docs", wit(&docs)),
            ("edits", wit(&edits)),
        ],
    );

    let PlannedEdit { doc, edit } = PlannedEdit::new(
        DocId::new(""),
        EditRequest::new(Revision::default(), Vec::new()),
    );
    contract.record("planned-edit", &[("doc", wit(&doc)), ("edit", wit(&edit))]);

    let ViewSpec {
        id,
        title,
        surface,
        refresh,
        follows,
        params,
        icon,
        order,
        open_by_default,
        preferred_size,
        closable,
    } = ViewSpec::new("", "", ViewSurface::Bottom);
    contract.record(
        "view-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("surface", wit(&surface)),
            ("refresh", wit(&refresh)),
            ("follows", wit(&follows)),
            ("params", wit(&params)),
            ("icon", wit(&icon)),
            ("order", wit(&order)),
            ("open-by-default", wit(&open_by_default)),
            ("preferred-size", wit(&preferred_size)),
            ("closable", wit(&closable)),
        ],
    );

    let ViewInstance {
        view,
        instance,
        params,
    } = ViewInstance::only("");
    contract.record(
        "view-instance",
        &[
            ("view", wit(&view)),
            ("instance", wit(&instance)),
            ("params", wit(&params)),
        ],
    );

    // --- l'edit chirurgico (decisione 0008)

    let TextEdit { span, text } = TextEdit::insert(0, "");
    contract.record("text-edit", &[("span", wit(&span)), ("text", wit(&text))]);

    let EditRequest { base, edits } = EditRequest::new(Revision::default(), Vec::new());
    contract.record(
        "edit-request",
        &[("base", wit(&base)), ("edits", wit(&edits))],
    );

    let AppliedEdit { span, replaced } = AppliedEdit {
        span: Span::EMPTY,
        replaced: String::new(),
    };
    contract.record(
        "applied-edit",
        &[("span", wit(&span)), ("replaced", wit(&replaced))],
    );

    let EditReport { revision, applied } = EditReport::default();
    contract.record(
        "edit-report",
        &[("revision", wit(&revision)), ("applied", wit(&applied))],
    );

    // --- il contesto di sessione (decisione 0007)

    let Selection { span, text } = Selection::default();
    contract.record("selection", &[("span", wit(&span)), ("text", wit(&text))]);

    let ViewContext {
        pane,
        doc,
        selection,
        mode,
    } = ViewContext::new("main");
    contract.record(
        "view-context",
        &[
            ("pane", wit(&pane)),
            ("doc", wit(&doc)),
            ("selection", wit(&selection)),
            ("mode", wit(&mode)),
        ],
    );

    contract.enumeration_src(
        "pane-mode",
        ("session.rs", "PaneMode"),
        [PaneMode::Source, PaneMode::LivePreview, PaneMode::Reading]
            .map(pane_mode_name)
            .as_slice(),
    );

    contract.enumeration_src(
        "context-kind",
        ("session.rs", "ContextKind"),
        [
            ContextKind::Document,
            ContextKind::Selection,
            ContextKind::Mode,
        ]
        .map(context_kind_name)
        .as_slice(),
    );

    let TrashEntry {
        id,
        original,
        deleted_at,
        size,
    } = TrashEntry {
        id: DocId::new(".trash/a.2026"),
        original: DocId::new("a.md"),
        deleted_at: 0,
        size: 0,
    };
    contract.record(
        "trash-entry",
        &[
            ("id", wit(&id)),
            ("original", wit(&original)),
            ("deleted-at", wit(&deleted_at)),
            ("size", wit(&size)),
        ],
    );

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    contract.record(
        "backlink-ref",
        &[("source", wit(&source)), ("context", wit(&context))],
    );

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
    contract.record(
        "search-hit",
        &[
            ("doc", wit(&doc)),
            // La larghezza di un punteggio è parte del contratto: era il caso
            // che il vecchio confronto per soli nomi non avrebbe visto.
            ("score", wit(&score)),
            ("snippet", wit(&snippet)),
            ("highlights", wit(&highlights)),
        ],
    );

    let TagCount { name, count } = TagCount {
        name: String::new(),
        count: 0,
    };
    contract.record("tag-count", &[("name", wit(&name)), ("count", wit(&count))]);

    let NeighborRef { doc, via, depth } = NeighborRef {
        doc: DocId::new("a"),
        via: DocId::new("b"),
        depth: 1,
    };
    contract.record(
        "neighbor-ref",
        &[
            ("doc", wit(&doc)),
            ("via", wit(&via)),
            ("depth", wit(&depth)),
        ],
    );

    let Page { offset, limit } = Page::default();
    contract.record("page", &[("offset", wit(&offset)), ("limit", wit(&limit))]);

    let SearchScope { folders, tags } = SearchScope::default();
    contract.record(
        "search-scope",
        &[("folders", wit(&folders)), ("tags", wit(&tags))],
    );

    let PropertyFilter { key, test } = PropertyFilter {
        key: String::new(),
        test: PropertyTest::Exists,
    };
    contract.record(
        "property-filter",
        &[("key", wit(&key)), ("test", wit(&test))],
    );

    let PropertySort { key, descending } = PropertySort {
        key: String::new(),
        descending: false,
    };
    contract.record(
        "property-sort",
        &[("key", wit(&key)), ("descending", wit(&descending))],
    );

    let PropertyEntry { key, value } = PropertyEntry {
        key: String::new(),
        value: PropertyValue::Empty,
    };
    contract.record(
        "property-entry",
        &[("key", wit(&key)), ("value", wit(&value))],
    );

    let DocumentProperties { doc, properties } = DocumentProperties {
        doc: DocId::new("a"),
        properties: Vec::new(),
    };
    contract.record(
        "document-properties",
        &[("doc", wit(&doc)), ("properties", wit(&properties))],
    );

    let PropertyCount { value, count } = PropertyCount {
        value: PropertyValue::Empty,
        count: 0,
    };
    contract.record(
        "property-count",
        &[("value", wit(&value)), ("count", wit(&count))],
    );

    let HealthIssue {
        doc,
        check,
        detail,
        span,
    } = HealthIssue {
        doc: DocId::new("a"),
        check: HealthCheck::BrokenLinks,
        detail: None,
        span: None,
    };
    contract.record(
        "health-issue",
        &[
            ("doc", wit(&doc)),
            ("check", wit(&check)),
            ("detail", wit(&detail)),
            ("span", wit(&span)),
        ],
    );

    // Le sette finestre: un solo tipo in Rust, un record per istanza nel WIT.
    // Il destructuring è generico ma i tipi dei campi li deduce il compilatore
    // dall'istanza, quindi `items` porta davvero `list<backlink-ref>` e non una
    // forma scritta a mano.
    contract.record(
        "backlinks-page",
        &paged_fields(&Paged::all(Vec::<BacklinkRef>::new())),
    );
    contract.record(
        "search-page",
        &paged_fields(&Paged::all(Vec::<SearchHit>::new())),
    );
    contract.record(
        "tags-page",
        &paged_fields(&Paged::all(Vec::<TagCount>::new())),
    );
    contract.record(
        "neighbors-page",
        &paged_fields(&Paged::all(Vec::<NeighborRef>::new())),
    );
    contract.record(
        "properties-page",
        &paged_fields(&Paged::all(Vec::<DocumentProperties>::new())),
    );
    contract.record(
        "property-values-page",
        &paged_fields(&Paged::all(Vec::<PropertyCount>::new())),
    );
    contract.record(
        "vault-health-page",
        &paged_fields(&Paged::all(Vec::<HealthIssue>::new())),
    );

    let UiAction {
        action,
        payload,
        fields,
    } = UiAction::new("");
    contract.record(
        "ui-action",
        &[
            ("action", wit(&action)),
            ("payload", wit(&payload)),
            ("fields", wit(&fields)),
        ],
    );

    let ActionRef { action, payload } = ActionRef::new("");
    contract.record(
        "action-ref",
        &[("action", wit(&action)), ("payload", wit(&payload))],
    );

    let FieldValue { field, value } = FieldValue {
        field: String::new(),
        value: UiValue::Bool(false),
    };
    contract.record(
        "field-value",
        &[("field", wit(&field)), ("value", wit(&value))],
    );

    let UiOption { value, label } = UiOption::new("", "");
    contract.record(
        "ui-option",
        &[("value", wit(&value)), ("label", wit(&label))],
    );

    let KeyValueEntry { label, value } = KeyValueEntry {
        label: String::new(),
        value: String::new(),
    };
    contract.record(
        "key-value-entry",
        &[("label", wit(&label)), ("value", wit(&value))],
    );

    let TableColumn { title, align } = TableColumn::new("");
    contract.record(
        "table-column",
        &[("title", wit(&title)), ("align", wit(&align))],
    );

    let arena::UiNode { key, kind } = arena::UiNode {
        key: None,
        kind: arena::UiKind::Separator,
    };
    contract.record("ui-node", &[("key", wit(&key)), ("kind", wit(&kind))]);

    let PluginPermissions { granted } = PluginPermissions::default();
    contract.record("plugin-permissions", &[("granted", wit(&granted))]);

    let PluginManifest {
        id,
        name,
        version,
        abi_version,
        permissions,
    } = PluginManifest {
        id: String::new(),
        name: String::new(),
        version: String::new(),
        abi_version: String::new(),
        permissions: PluginPermissions::default(),
    };
    contract.record(
        "plugin-manifest",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("version", wit(&version)),
            ("abi-version", wit(&abi_version)),
            ("permissions", wit(&permissions)),
        ],
    );

    let JobSpec { job, payload } = JobSpec {
        job: String::new(),
        payload: serde_json::Value::Null,
    };
    contract.record(
        "job-spec",
        &[("job", wit(&job)), ("payload", wit(&payload))],
    );

    // L'origine di un evento (decisione 0012) e il lotto di cui fa parte (decisione 0011). I
    // record di payload dei due variant (`actor-plugin`, `event-batch-ended`)
    // se li rivendica `variant_src` qui sopra; questi due invece sono record a
    // sé, e senza rivendicarli il contratto li darebbe per morti.
    let Origin { actor, batch } = Origin::default();
    contract.record("origin", &[("actor", wit(&actor)), ("batch", wit(&batch))]);

    let Notice { event, origin } = Notice::of(Event::IndexUpdated);
    contract.record(
        "notice",
        &[("event", wit(&event)), ("origin", wit(&origin))],
    );

    // Import/export. Nessun campo porta un percorso di filesystem: la sorgente
    // è `bytes` e l'esito è `bytes`, e chi apre e chi posa è l'host.
    let TransferNote {
        level,
        message,
        entry,
    } = TransferNote::info("");
    contract.record(
        "transfer-note",
        &[
            ("level", wit(&level)),
            ("message", wit(&message)),
            ("entry", wit(&entry)),
        ],
    );

    let ImportSource {
        name,
        media_type,
        bytes,
    } = ImportSource::default();
    contract.record(
        "import-source",
        &[
            ("name", wit(&name)),
            ("media-type", wit(&media_type)),
            ("bytes", wit(&bytes)),
        ],
    );

    let ImportRequest {
        mode,
        folder,
        on_conflict,
        options,
    } = ImportRequest::preview();
    contract.record(
        "import-request",
        &[
            ("mode", wit(&mode)),
            ("folder", wit(&folder)),
            ("on-conflict", wit(&on_conflict)),
            ("options", wit(&options)),
        ],
    );

    let ImportedDocument {
        doc,
        outcome,
        entry,
    } = ImportedDocument {
        doc: DocId::new("x.md"),
        outcome: ImportOutcome::Created,
        entry: None,
    };
    contract.record(
        "imported-document",
        &[
            ("doc", wit(&doc)),
            ("outcome", wit(&outcome)),
            ("entry", wit(&entry)),
        ],
    );

    let ImportReport {
        mode,
        documents,
        log,
    } = ImportReport::default();
    contract.record(
        "import-report",
        &[
            ("mode", wit(&mode)),
            ("documents", wit(&documents)),
            ("log", wit(&log)),
        ],
    );

    let ExportTarget {
        id,
        name,
        extension,
    } = ExportTarget {
        id: String::new(),
        name: String::new(),
        extension: None,
    };
    contract.record(
        "export-target",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("extension", wit(&extension)),
        ],
    );

    let ExportRequest {
        selection,
        target,
        options,
    } = ExportRequest::default();
    contract.record(
        "export-request",
        &[
            ("selection", wit(&selection)),
            ("target", wit(&target)),
            ("options", wit(&options)),
        ],
    );

    let ExportArtifact {
        path,
        media_type,
        bytes,
    } = ExportArtifact {
        path: String::new(),
        media_type: String::new(),
        bytes: Vec::new(),
    };
    contract.record(
        "export-artifact",
        &[
            ("path", wit(&path)),
            ("media-type", wit(&media_type)),
            ("bytes", wit(&bytes)),
        ],
    );

    let ExportReport { artifacts, log } = ExportReport::default();
    contract.record(
        "export-report",
        &[("artifacts", wit(&artifacts)), ("log", wit(&log))],
    );

    // --- alias: la destinazione è dedotta dal tipo interno del newtype

    let DocId(path) = DocId::new("a");
    contract.alias("doc-id", wit(&path));

    let Frontmatter(map) = Frontmatter::default();
    contract.alias("frontmatter", wit(&map));

    let ActionId(raw) = ActionId(String::new());
    contract.alias("action-id", wit(&raw));

    let JobId(raw) = JobId(0);
    contract.alias("job-id", wit(&raw));

    let BatchId(raw) = BatchId(0);
    contract.alias("batch-id", wit(&raw));

    let EventMask(kinds) = EventMask::all();
    contract.alias("event-mask", wit(&kinds));

    let Revision(raw) = Revision::default();
    contract.alias("revision", wit(&raw));

    let PaneId(raw) = PaneId::new("main");
    contract.alias("pane-id", wit(&raw));

    let ContextMask(kinds) = ContextMask::all();
    contract.alias("context-mask", wit(&kinds));

    let BlockRef(raw) = BlockRef::default();
    contract.alias("block-ref", wit(&raw));
    let InlineRef(raw) = InlineRef::default();
    contract.alias("inline-ref", wit(&raw));
    let UiRef(raw) = UiRef::default();
    contract.alias("ui-ref", wit(&raw));

    // Il JSON libero attraversa il confine come stringa: è l'unico alias senza
    // controparte Rust, ed è la scelta deliberata dell'escape hatch.
    contract.alias("json", "string".to_string());

    // --- funzioni: firme complete, ricavate dai metodi dei trait
    //
    // Ogni riga fa due cose: il cast vincola la firma scritta a quella del
    // trait (se il trait cambia, non compila), e da quella firma si deducono i
    // tipi attesi nel WIT. `host` compare a sinistra e non a destra: è l'unica
    // verifica dell'elisione.

    contract.types_only("json");
    contract.types_only("options");
    contract.types_only("model");
    contract.types_only("ui");
    contract.types_only("jobs");
    contract.types_only("events");
    contract.types_only("errors");
    contract.types_only("session");
    contract.types_only("edit");
    contract.types_only("transfer");

    contract.method(
        "format",
        "descriptor",
        <dyn FormatProvider>::descriptor as fn(&'static dyn FormatProvider) -> FormatDescriptor,
        &[],
    );
    contract.method(
        "format",
        "capabilities",
        <dyn FormatProvider>::capabilities as fn(&'static dyn FormatProvider) -> FormatCapabilities,
        &[],
    );
    contract.method(
        "format",
        "parse",
        <dyn FormatProvider>::parse
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentSource,
                &'static ParseContext,
            ) -> Result<DocumentModel, FormatError>,
        &["source", "ctx"],
    );
    contract.method(
        "format",
        "render-html",
        <dyn FormatProvider>::render_html
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
                &'static RenderOptions,
            ) -> Result<String, FormatError>,
        &["model", "opts"],
    );
    contract.method(
        "format",
        "serialize",
        <dyn FormatProvider>::serialize
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
            ) -> Result<String, FormatError>,
        &["model"],
    );

    contract.method(
        "syntax",
        "spec",
        <dyn SyntaxRule>::spec as fn(&'static dyn SyntaxRule) -> SyntaxRuleSpec,
        &[],
    );
    contract.method(
        "syntax",
        "apply",
        <dyn SyntaxRule>::apply
            as fn(
                &'static dyn SyntaxRule,
                &'static SyntaxMatch,
                &'static ParseContext,
            ) -> Result<Option<SyntaxProduct>, FormatError>,
        &["m", "ctx"],
    );

    contract.method(
        "renderer",
        "spec",
        <dyn CustomRenderer>::spec as fn(&'static dyn CustomRenderer) -> CustomRendererSpec,
        &[],
    );
    contract.method(
        "renderer",
        "render",
        <dyn CustomRenderer>::render
            as fn(
                &'static dyn CustomRenderer,
                &'static CustomBlock,
                &'static RenderOptions,
            ) -> Result<CustomRendering, FormatError>,
        &["block", "opts"],
    );

    contract.method(
        "command",
        "commands",
        <dyn CommandProvider>::commands as fn(&'static dyn CommandProvider) -> Vec<CommandSpec>,
        &[],
    );
    contract.method(
        "command",
        "invoke",
        <dyn CommandProvider>::invoke
            as fn(
                &'static dyn CommandProvider,
                &'static str,
                serde_json::Value,
                InvokeMode,
                Host,
            ) -> Result<CommandOutcome, PluginError>,
        &["command", "args", "mode"],
    );

    contract.method(
        "view",
        "views",
        <dyn ViewProvider>::views as fn(&'static dyn ViewProvider) -> Vec<ViewSpec>,
        &[],
    );
    contract.method(
        "view",
        "render-view",
        <dyn ViewProvider>::render_view
            as fn(
                &'static dyn ViewProvider,
                &'static ViewInstance,
                HostRef,
            ) -> Result<UiNode, PluginError>,
        &["instance"],
    );
    contract.method(
        "view",
        "on-action",
        <dyn ViewProvider>::on_action
            as fn(
                &'static mut dyn ViewProvider,
                &'static ViewInstance,
                UiAction,
                Host,
            ) -> Result<ViewUpdate, PluginError>,
        &["instance", "action"],
    );

    contract.method(
        "index",
        "activate",
        <dyn IndexProvider>::activate
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "on-document-indexed",
        <dyn IndexProvider>::on_document_indexed
            as fn(&'static mut dyn IndexProvider, &'static DocumentModel),
        &["doc"],
    );
    contract.method(
        "index",
        "on-document-removed",
        <dyn IndexProvider>::on_document_removed
            as fn(&'static mut dyn IndexProvider, &'static DocId),
        &["id"],
    );
    contract.method(
        "index",
        "reconcile",
        <dyn IndexProvider>::reconcile as fn(&'static mut dyn IndexProvider, &'static [DocId]),
        &["ids"],
    );
    contract.method(
        "index",
        "flush",
        <dyn IndexProvider>::flush
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "query",
        <dyn IndexProvider>::query
            as fn(&'static dyn IndexProvider, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );

    contract.method(
        "host-api",
        "read-document",
        <dyn HostApi>::read_document
            as fn(&'static dyn HostApi, &'static DocId) -> Result<String, PluginError>,
        &["id"],
    );
    contract.method(
        "host-api",
        "write-document",
        <dyn HostApi>::write_document
            as fn(Host, &'static DocId, &'static str) -> Result<(), PluginError>,
        &["id", "source"],
    );
    contract.method(
        "host-api",
        "document-revision",
        <dyn HostApi>::document_revision
            as fn(&'static dyn HostApi, &'static DocId) -> Result<Revision, PluginError>,
        &["id"],
    );
    contract.method(
        "host-api",
        "apply-edit",
        <dyn HostApi>::apply_edit
            as fn(Host, &'static DocId, EditRequest) -> Result<EditReport, PluginError>,
        &["id", "request"],
    );
    contract.method(
        "host-api",
        "list-documents",
        <dyn HostApi>::list_documents
            as fn(&'static dyn HostApi) -> Result<Vec<DocId>, PluginError>,
        &[],
    );
    contract.method(
        "host-api",
        "free-name",
        <dyn HostApi>::free_name as fn(&'static dyn HostApi, &'static DocId) -> DocId,
        &["id"],
    );
    contract.method(
        "host-api",
        "read-model",
        <dyn HostApi>::read_model
            as fn(&'static dyn HostApi, &'static DocId) -> Result<DocumentModel, PluginError>,
        &["id"],
    );
    contract.method(
        "host-api",
        "format-of",
        <dyn HostApi>::format_of
            as fn(&'static dyn HostApi, &'static DocId) -> Option<DocumentFormat>,
        &["id"],
    );
    contract.method(
        "host-api",
        "create-document",
        <dyn HostApi>::create_document
            as fn(Host, &'static DocId, &'static str) -> Result<(), PluginError>,
        &["id", "source"],
    );
    contract.method(
        "host-api",
        "rename-document",
        <dyn HostApi>::rename_document
            as fn(Host, &'static DocId, &'static DocId) -> Result<(), PluginError>,
        &["from", "to"],
    );
    contract.method(
        "host-api",
        "trash-document",
        <dyn HostApi>::trash_document as fn(Host, &'static DocId) -> Result<DocId, PluginError>,
        &["id"],
    );
    contract.method(
        "host-api",
        "list-trash",
        <dyn HostApi>::list_trash
            as fn(&'static dyn HostApi) -> Result<Vec<TrashEntry>, PluginError>,
        &[],
    );
    contract.method(
        "host-api",
        "restore-document",
        <dyn HostApi>::restore_document
            as fn(Host, &'static DocId, Option<DocId>) -> Result<DocId, PluginError>,
        &["entry", "to"],
    );
    contract.method(
        "host-api",
        "empty-trash",
        <dyn HostApi>::empty_trash as fn(Host) -> Result<u64, PluginError>,
        &[],
    );
    contract.method(
        "host-api",
        "emit",
        <dyn HostApi>::emit as fn(Host, Event),
        &["event"],
    );
    contract.method(
        "host-api",
        "spawn-job",
        <dyn HostApi>::spawn_job as fn(Host, JobSpec) -> Result<JobId, PluginError>,
        &["spec"],
    );
    contract.method(
        "host-api",
        "data-read",
        <dyn HostApi>::data_read
            as fn(&'static dyn HostApi, &'static str) -> Result<Option<Vec<u8>>, PluginError>,
        &["path"],
    );
    contract.method(
        "host-api",
        "data-write",
        <dyn HostApi>::data_write
            as fn(Host, &'static str, &'static [u8]) -> Result<(), PluginError>,
        &["path", "bytes"],
    );
    contract.method(
        "host-api",
        "data-remove",
        <dyn HostApi>::data_remove as fn(Host, &'static str) -> Result<(), PluginError>,
        &["path"],
    );
    contract.method(
        "host-api",
        "data-list",
        <dyn HostApi>::data_list
            as fn(&'static dyn HostApi, &'static str) -> Result<Vec<String>, PluginError>,
        &["prefix"],
    );
    contract.method(
        "host-api",
        "now-unix-millis",
        <dyn HostApi>::now_unix_millis as fn(&'static dyn HostApi) -> u64,
        &[],
    );
    contract.method(
        "host-api",
        "query-index",
        <dyn HostApi>::query_index
            as fn(&'static dyn HostApi, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );
    contract.method(
        "host-api",
        "active-context",
        <dyn HostApi>::active_context as fn(&'static dyn HostApi) -> Option<ViewContext>,
        &[],
    );
    contract.method(
        "host-api",
        "run-command",
        <dyn HostApi>::run_command
            as fn(Host, &'static str, serde_json::Value) -> Result<CommandOutcome, PluginError>,
        &["command", "args"],
    );

    contract.method(
        "event-handler",
        "subscribed",
        <dyn EventHandler>::subscribed as fn(&'static dyn EventHandler) -> EventMask,
        &[],
    );
    contract.method(
        "event-handler",
        "handle",
        <dyn EventHandler>::handle
            as fn(&'static mut dyn EventHandler, &'static Notice, Host) -> Result<(), PluginError>,
        &["notice"],
    );

    contract.method(
        "plugin",
        "manifest",
        <dyn Plugin>::manifest as fn(&'static dyn Plugin) -> PluginManifest,
        &[],
    );
    contract.method(
        "plugin",
        "activate",
        <dyn Plugin>::activate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "deactivate",
        <dyn Plugin>::deactivate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "run-job",
        <dyn Plugin>::run_job
            as fn(
                &'static dyn Plugin,
                &'static str,
                serde_json::Value,
            ) -> Result<serde_json::Value, PluginError>,
        &["job", "payload"],
    );

    contract.method(
        "importer",
        "can-handle",
        <dyn ImportProvider>::can_handle
            as fn(&'static dyn ImportProvider, &'static ImportSource) -> bool,
        &["source"],
    );
    contract.method(
        "importer",
        "import",
        <dyn ImportProvider>::import
            as fn(
                &'static mut dyn ImportProvider,
                &'static ImportSource,
                &'static ImportRequest,
                Host,
            ) -> Result<ImportReport, PluginError>,
        &["source", "request"],
    );

    contract.method(
        "exporter",
        "targets",
        <dyn ExportProvider>::targets as fn(&'static dyn ExportProvider) -> Vec<ExportTarget>,
        &[],
    );
    contract.method(
        "exporter",
        "export",
        <dyn ExportProvider>::export
            as fn(
                &'static dyn ExportProvider,
                &'static ExportRequest,
                HostRef,
            ) -> Result<ExportReport, PluginError>,
        &["request"],
    );

    // --- il world

    let (imports, exports) = contract
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
        // I due innesti del §3.1 e del §3.2: separati da `format` perché un
        // plugin può implementarne uno senza l'altro — ed è esattamente ciò che
        // «mezzo plugin» significa.
        "syntax",
        "renderer",
        "command",
        "view",
        "index",
        "event-handler",
        "importer",
        "exporter",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        exports, expected_exports,
        "interfacce esportate da `plugin-world`"
    );

    contract.finish()
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

/// Il derivatore d'ordine legge davvero la dichiarazione Rust: se sa leggere
/// `Intent` (l'enum più piccolo), la stessa strada vale per tutti gli altri.
#[test]
fn the_expected_case_order_comes_from_the_rust_declaration() {
    assert_eq!(
        rust_enum_order("ui.rs", "Intent"),
        ["neutral", "primary", "danger"]
    );
    assert_eq!(
        rust_enum_order("ui.rs", "ViewUpdate")
            .first()
            .map(String::as_str),
        Some("replace")
    );
    assert_eq!(kebab("CodeBlock"), "code-block");
    assert_eq!(kebab("Url"), "url");
}

/// La forma al confine è quella di `arena`, non quella nativa: questo test lo
/// mette per iscritto, perché è la divergenza deliberata più facile da
/// dimenticare (e la sola presidiata da conversioni con dei test propri).
#[test]
fn the_boundary_shape_of_a_span_is_wider_than_the_native_one() {
    assert_eq!(wit_of::<arena::Span>(), "span");
    assert_eq!(wit_of::<Span>(), "span", "lo stesso record, due viste");
    assert!(
        std::mem::size_of::<usize>() <= std::mem::size_of::<u64>(),
        "il nativo non può essere più largo del confine: `usize`→`u64` deve \
         restare la direzione che non fallisce mai"
    );
}

// ---------------------------------------------------------------------------
// Il test del test (criterio di accettazione di M4)
// ---------------------------------------------------------------------------

/// Un test di conformità che non sa fallire non è un test. Qui si introducono
/// divergenze ad arte — una per ciascuna cosa che il test dovrebbe vedere — e si
/// pretende il rosso.
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
            base.replace("        thematic-break(block-thematic-break),\n", ""),
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
        // --- da qui in poi: ciò che il confronto per soli nomi non vedeva
        (
            "tipo di un campo cambiato (la larghezza di un punteggio)",
            base.replace("        score: f32,", "        score: f64,"),
            "score",
        ),
        (
            "tipo di un campo cambiato in un record annidato",
            base.replace("        highlights: list<span>,", "        highlights: list<string>,"),
            "highlights",
        ),
        (
            "payload di un caso di variant cambiato",
            base.replace(
                "        thematic-break(block-thematic-break),",
                "        thematic-break(string),",
            ),
            "thematic-break",
        ),
        (
            "risultato di una funzione cambiato",
            base.replace("    now-unix-millis: func() -> u64;", "    now-unix-millis: func() -> u32;"),
            "now-unix-millis",
        ),
        (
            "tipo di un parametro cambiato",
            base.replace(
                "    write-document: func(id: doc-id, source: string) -> result<_, plugin-error>;",
                "    write-document: func(id: doc-id, source: list<u8>) -> result<_, plugin-error>;",
            ),
            "source",
        ),
        (
            "parametro rinominato",
            base.replace(
                "    query: func(query: index-query) -> result<index-result, plugin-error>;",
                "    query: func(q: index-query) -> result<index-result, plugin-error>;",
            ),
            "query",
        ),
        (
            "l'host NON è eliso: riappare come parametro",
            base.replace(
                "    reconcile: func(ids: list<doc-id>);",
                "    reconcile: func(host: string, ids: list<doc-id>);",
            ),
            "host",
        ),
        (
            "campi di un record riordinati (è un cambio di ABI)",
            base.replace(
                "    record span {\n        start: u64,\n        end: u64,\n    }",
                "    record span {\n        end: u64,\n        start: u64,\n    }",
            ),
            "ordine",
        ),
        (
            "casi di un enum riordinati (cambia il discriminante)",
            base.replace(
                "enum intent { neutral, primary, danger }",
                "enum intent { primary, neutral, danger }",
            ),
            "ordine",
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
