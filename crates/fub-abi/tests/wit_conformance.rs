//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fub/abi.wit`, con la
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
//! [`fub_abi::arena`], che è la loro forma al confine *scritta in Rust* — e la
//! catena verso gli alberi nativi la tiene il compilatore, perché
//! `DocumentTree::flatten`/`rebuild` sono match esaustivi su entrambi i lati
//! (round-trip provato in `arena`). Prima esisteva solo la prosa nei commenti.
//!
//! `wit-parser` è una **dev-dependency**: l'invariante architetturale di
//! `fub-abi` riguarda le dipendenze normali, ed è protetta da
//! `tests/dependency_invariant.rs`.
//!
//! L'**ordine** dei casi è confrontato in tutte e due le direzioni e in tutte
//! le sedi: il WIT contro l'elenco del test (`diff`), e l'elenco del test
//! contro la **dichiarazione dell'enum Rust**, parsata dal sorgente con `syn`
//! (`variant_src`/`enumeration_src`). Il compilatore garantisce l'esaustività
//! dei match qui sotto, non l'ordine — e l'ordine dei casi è il discriminante
//! ABI: un riordino è rosso da entrambi i lati, non solo da quello WIT.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

use fub_abi::arena::{self, BlockRef, InlineRef, UiRef};
use fub_abi::command::{
    Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo, UndoStep, Undone,
};
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{
    Actor, BatchId, DocChange, DocChanges, Event, EventKind, EventMask, Notice, Origin, Severity,
    Subject,
};
use fub_abi::format::{
    DocumentFormat, DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider,
    ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use fub_abi::locale::{HourCycle, Locale, Weekday};
use fub_abi::model::{
    Anchor, ColumnAlign, DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget,
    PropertyDate, PropertyScalar, PropertyTime, PropertyValue, Span, Tag,
};
use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse};
use fub_abi::options::OptionMap;
use fub_abi::organization::Organization;
use fub_abi::query::{
    QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextField, TextMode, TextQuery,
    TextTolerance,
};
use fub_abi::session::{
    AnchoredSelection, AnchoredSelections, ContextKind, ContextMask, FloatingSelection,
    FloatingSelections, PaneId, PaneMode, SelectionSet, ViewContext,
};
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::text::{Arg, ArgValue, Message, StringCatalog, Text};
use fub_abi::traits::{
    BacklinkRef, CommandProvider, DocPosition, DocumentMatch, DraftInfo, EntryKind, EventHandler,
    Excerpts, FolderScope, HealthCheck, HealthIssue, HostApi, IndexLoss, IndexProvider, IndexQuery,
    IndexResult, IndexingState, JobId, JobProgress, JobSpec, JobStatus, LinkDirection, NeighborRef,
    Page, Paged, Plugin, PluginManifest, PluginPermissions, PredicateKind, PropertyCount,
    PropertyEntry, PropertyFilter, PropertySelect, PropertySort, PropertyTest, QueryKind,
    QueryRoute, ReadApi, ResolvedRef, ServiceProvider, TagCount, TimerSchedule, TimerSpec,
    TrashEntry, VaultEntry, VaultFolder, VaultStatus, ViewInstance, ViewInterests, ViewProvider,
    ViewSpec, ViewSurface, WallClock, ABI_VERSION,
};
use fub_abi::transfer::{
    ArtifactContent, ArtifactHandle, ArtifactSink, ConflictPolicy, ExportArtifact, ExportProvider,
    ExportReport, ExportRequest, ExportSelection, ExportTarget, ImportMode, ImportOutcome,
    ImportProvider, ImportReport, ImportRequest, ImportSource, ImportedDocument, NoteLevel,
    SourceContent, SourceHandle, StreamedSource, TransferNote,
};
use fub_abi::ui::{
    ActionId, ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction,
    UiNode, UiOption, UiValue, ViewUpdate,
};

// CARGO_MANIFEST_DIR = crates/fub-abi ; il contratto è alla radice del repo.
const WIT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/wit/fub/abi.wit");

/// Segnaposto per il ricevitore (`&self`): non attraversa il confine.
const SELF: &str = "«self»";
/// Segnaposto per l'`HostApi`: nelle firme Rust c'è, nel WIT **non deve
/// esserci** — è importato dal world.
const HOST: &str = "«host»";
/// Segnaposto per l'[`ArtifactSink`]: stessa sorte dell'host, e per la stessa
/// ragione, ma con un'asimmetria che vale nominare invece di nascondere.
///
/// In Rust il sink **non sta sull'host** ed è un parametro di
/// `ExportProvider::export`: un export gira sotto prestito condiviso, e mettere
/// una scrittura dentro [`ReadApi`] la regalerebbe a chi disegna una view e a
/// chi interroga l'indice — cioè a tutti quelli per cui `ReadApi` esiste per
/// **non** averla. Al confine WASM quella distinzione non è esprimibile: ogni
/// capacità arriva dal world, quindi il sink diventa `host-transfer-write` e
/// sparisce dai parametri di `export` esattamente come l'host. È il prezzo del
/// confine, ed è per questo che si elide qui e sta scritto nel verbale della
/// decisione 0102.
const SINK: &str = "«sink»";

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

/// Il gemello per la stragrande maggioranza dei tipi, il cui nome WIT **è** il
/// kebab del nome Rust (decisione 0053).
///
/// Prima erano 174 voci su 203 che riscrivevano a mano una stringa ricavabile
/// dall'identificatore, e `fn kebab` stava venti righe più in giù nello stesso
/// file. Il costo non era la riga: era che quella stringa **poteva essere
/// sbagliata** — dimenticare un trattino su un nome composto è una divergenza
/// che il test avrebbe segnalato come «manca dal WIT», cioè additandone il
/// posto sbagliato.
///
/// Qui resta da scrivere il **tipo**, che è l'informazione (dichiarare la sua
/// forma al confine); il nome non si scrive più. Le sedici che deviano — primitivi,
/// `json`, le istanze di `Paged<T>`, l'unico aliasing deliberato
/// (`UiNode => ui-tree`) — restano nel `wit_type!` qui sopra, ed è giusto che si
/// vedano: sono le eccezioni, e adesso l'elenco delle eccezioni è corto.
macro_rules! wit_kebab {
    ($($ty:ty),+ $(,)?) => {
        $(impl WitType for $ty {
            fn wit() -> String {
                // `stringify!` di un path mette gli spazi attorno a `::`.
                common::kebab(stringify!($ty).rsplit("::").next().unwrap().trim())
            }
        })+
    };
}

// Le eccezioni: i tipi il cui nome al confine NON è il kebab del nome Rust.
// Su 203 voci in tutto sono **sedici**, e ognuna è una scelta — un primitivo
// che si scrive diverso, un JSON opaco, un generico che al confine si sdoppia,
// un aliasing deliberato — più tredici che al confine non compaiono affatto
// (il ricevitore e le capacità dell'host). Le altre 174 stanno in `wit_kebab!`
// qui sotto, dove il nome non si scrive più (decisione 0053).
wit_type! {
    // Primitivi e stringhe.
    i16 => "s16",
    i32 => "s32",
    str => "string",

    // L'unità: nel WIT un `result` senza ok si scrive `result<_, e>`, e una
    // funzione che non restituisce niente non ha risultato affatto.
    () => "_",

    // Il JSON libero (frontmatter, attrs, args, payload, storage) attraversa il
    // confine come stringa: è la scelta deliberata dell'escape hatch.
    serde_json::Value => "json",
    serde_json::Map<String, serde_json::Value> => "json",

    // UI: al confine un albero intero è la sua arena.
    UiNode => "ui-tree",

    // Le finestre: un solo `Paged<T>` in Rust, un record per istanza nel WIT
    // (i generici al confine non esistono). L'impl per ciascuna istanza è ciò
    // che rende impossibile paginarne una nuova senza dichiararla anche là.
    Paged<BacklinkRef> => "backlinks-page",
    Paged<DocumentMatch> => "documents-page",
    Paged<DocId> => "doc-ids-page",
    Paged<TagCount> => "tags-page",
    Paged<NeighborRef> => "neighbors-page",
    Paged<PropertyCount> => "property-values-page",
    Paged<HealthIssue> => "vault-health-page",
    Paged<VaultEntry> => "entries-page",
    Paged<VaultFolder> => "folders-page",
    Paged<DraftInfo> => "drafts-page",

    // Ciò che NON attraversa il confine: il ricevitore e le capacità dell'host.
    SourceHandle => "source-handle",
    StreamedSource => "streamed-source",
    ArtifactHandle => "artifact-handle",
    SourceContent => "source-content",
    ArtifactContent => "artifact-content",

    dyn HostApi => HOST,
    dyn ReadApi => HOST,
    dyn ArtifactSink => SINK,
    dyn FormatProvider => SELF,
    dyn CommandProvider => SELF,
    dyn ViewProvider => SELF,
    dyn IndexProvider => SELF,
    dyn EventHandler => SELF,
    dyn Plugin => SELF,
    dyn ImportProvider => SELF,
    dyn ServiceProvider => SELF,
    dyn ExportProvider => SELF,
    dyn SyntaxRule => SELF,
    dyn CustomRenderer => SELF,
}

// Tutti gli altri: il nome WIT È il kebab del nome Rust, quindi qui si
// dichiara soltanto che il tipo attraversa il confine. Come si scriva di là
// non è una decisione di nessuno, ed è la ragione per cui non si scrive più
// (decisione 0053).
wit_kebab! {
    // La rete (§23.3).
    HttpMethod,
    HttpHeader,
    HttpRequest,
    HttpResponse,

    // Primitivi e stringhe.
    bool,
    u8,
    u16,
    u32,
    u64,
    f32,
    f64,
    char,
    String,

    // Alias del contratto: newtype qui, `type x = ...` là.
    DocId,
    Frontmatter,
    ActionId,
    JobId,
    BatchId,
    BlockRef,
    InlineRef,
    UiRef,

    // Record e variant del modello.
    Span,
    arena::Span,
    Heading,
    Tag,
    Anchor,
    Link,
    LinkTarget,
    DocumentModel,
    ColumnAlign,
    PropertyValue,
    PropertyScalar,
    PropertyDate,
    PropertyTime,
    arena::Block,
    arena::Inline,
    arena::ListItem,
    arena::TaskMarker,
    arena::TableRow,
    arena::TableCell,
    arena::UiNode,
    arena::UiKind,
    arena::DocumentTree,
    arena::UiTree,

    // UI: al confine un albero intero è la sua arena.
    Axis,
    Intent,
    UiAction,
    ActionRef,
    UiValue,
    FieldValue,
    UiOption,
    KeyValueEntry,
    TableColumn,
    Align,
    ViewUpdate,

    // Il resto del contratto.
    FormatDescriptor,
    FormatCapabilities,
    DocumentFormat,
    ParseContext,
    RenderOptions,
    RenderTarget,
    SourceKind,
    DocumentSource,
    FormatError,

    // La mappa con namespace: al confine è una lista di coppie, perché WIT non
    // ha mappe. È lo stesso tipo in tutte e quattro le sedi del §3.5 — e che
    // sia lo STESSO è metà della risposta.
    OptionMap,

    // I due innesti del §3.1 e del §3.2.
    SyntaxTrigger,
    SyntaxRuleSpec,
    SyntaxMatch,
    SyntaxProduct,
    CustomRendererSpec,
    CustomBlock,
    CustomRendering,
    PluginError,
    Event,
    EventKind,
    EventMask,
    Subject,
    DocChange,
    DocChanges,
    TimerSpec,
    TimerSchedule,
    WallClock,
    Actor,
    Origin,
    Notice,
    JobSpec,

    // I comandi: la dichiarazione (decisione 0010) e l'invocazione (decisione 0009).
    CommandSpec,
    CommandOutcome,
    Partial,
    Failure,
    Undo,
    Undone,
    UndoStep,
    CommandEffect,
    CommandPlan,
    PlannedEdit,
    CommandScope,
    CommandReach,
    ParamSpec,
    ParamKind,
    Choice,
    InvokeMode,
    ViewSpec,
    ViewSurface,
    ViewInstance,
    ViewInterests,

    // L'edit chirurgico: la coppia (span, testo) e la revisione su cui è stata
    // calcolata.
    Revision,
    TextEdit,
    EditRequest,
    AppliedEdit,
    EditReport,
    WriteBase,

    // Il contesto di sessione: il pannello con il focus e ciò che contiene.
    PaneId,
    PaneMode,
    FloatingSelection,
    AnchoredSelection,
    AnchoredSelections,
    FloatingSelections,
    SelectionSet,
    ViewContext,
    ContextKind,
    ContextMask,

    // Il locale (§12.3): chi legge, e da dove.
    Locale,
    Weekday,
    HourCycle,

    // Il testo che si legge (§12.1).
    Text,
    Message,
    Arg,
    ArgValue,
    StringCatalog,
    IndexQuery,
    IndexResult,
    BacklinkRef,
    NeighborRef,
    DocumentMatch,
    DocPosition,
    ResolvedRef,
    TagCount,
    VaultStatus,
    IndexingState,
    JobProgress,
    IndexLoss,
    Severity,
    JobStatus,
    TrashEntry,
    Page,
    LinkDirection,
    QueryExpr,
    QueryClause,
    QueryLiteral,
    QueryPredicate,
    TextQuery,
    TextMode,
    TextField,
    TextTolerance,
    QueryKind,
    PredicateKind,
    QueryRoute,
    PropertySelect,
    PropertyTest,
    PropertyFilter,
    PropertySort,
    PropertyEntry,
    PropertyCount,
    Excerpts,
    HealthCheck,
    HealthIssue,

    // Le bozze (§15.2): ciò che è rimasto non salvato.
    DraftInfo,

    // L'anagrafe (§14.1): che specie di file è, e cosa se ne sa senza aprirlo.
    EntryKind,
    VaultEntry,

    // Le cartelle (§14.3): il modello, e il raggio delle domande per cartella.
    VaultFolder,
    FolderScope,

    // Import ed export: la sorgente arriva a byte e gli artefatti escono a
    // byte, quindi al confine non compare nessun percorso di filesystem.
    NoteLevel,
    TransferNote,
    ImportSource,
    ImportMode,
    ConflictPolicy,
    ImportRequest,
    ImportOutcome,
    ImportedDocument,
    ImportReport,
    ExportTarget,
    ExportSelection,
    ExportRequest,
    ExportArtifact,
    ExportReport,

    // Le finestre: un solo `Paged<T>` in Rust, un record per istanza nel WIT
    // (i generici al confine non esistono). L'impl per ciascuna istanza è ciò
    // che rende impossibile paginarne una nuova senza dichiararla anche là.
    PluginManifest,
    PluginPermissions,

    // Le impostazioni (§11.1).
    SettingSpec,
    SettingKind,
    SettingValue,
    SettingScope,
    SettingSource,
    SettingEntry,

    // L'organizzazione del vault (§11.3).
    Organization,
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

/// Una mappa ordinata attraversa il confine come **lista di coppie**: il WIT non
/// ha un tipo mappa, e la lista è ciò che ogni binding genera comunque. Ordinata
/// (`BTreeMap`) e non a hash, perché al confine l'ordine deve essere lo stesso a
/// ogni chiamata — altrimenti due risposte identiche si serializzano diverse.
impl<K: WitType, V: WitType> WitType for BTreeMap<K, V> {
    fn wit() -> String {
        format!("list<tuple<{}, {}>>", K::wit(), V::wit())
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

impl TreeAtBoundary for Vec<fub_abi::model::Block> {
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
        receiver == SELF || receiver == HOST || receiver == SINK,
        "il primo parametro dovrebbe essere il ricevitore, invece è `{receiver}`: \
         questo test va chiamato con un metodo di trait, non con una funzione libera"
    );
    let mut params = Vec::new();
    let mut has_host = false;
    for ty in it {
        // I due che al confine WASM arrivano dal world invece che come
        // argomento. Sono **due** e non uno dalla decisione 0102; il commento su
        // [`SINK`] dice perché il secondo in Rust non sta sul primo.
        if ty == HOST || ty == SINK {
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

/// I due modi in cui l'host compare in una firma Rust. Sono scritti con
/// lifetime `'static` solo perché un puntatore a funzione con lifetime elisi
/// sarebbe higher-ranked, e un tipo higher-ranked non può implementare [`WitFn`];
/// il cast dal metodo del trait resta valido, ed è quello che vincola la firma.
///
/// Sono **due trait diversi** dal §7.1: chi può fare tutto riceve l'`HostApi`
/// intero, chi disegna o esporta riceve un [`ReadApi`], che le capacità di
/// scrittura non ce le ha affatto. Al confine WIT non si vede — l'host è
/// importato dal world, non passato come argomento — ed è per questo che
/// entrambi si elidono allo stesso modo; ma il cast qui sopra è ciò che
/// verifica che la firma Rust sia quella giusta, e se `render-view` tornasse a
/// prendere un `HostApi` questo file non compilerebbe.
type Host = &'static mut dyn HostApi;
/// Il sink di un export: vedi [`SINK`]. Sta fra i parametri Rust e non nel WIT.
type Sink = &'static mut dyn ArtifactSink;
type HostRef = &'static dyn ReadApi;

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
    if let Err(e) = resolve.push_str("wit/fub/abi.wit", source) {
        panic!("wit/fub/abi.wit non è un WIT valido: {e:?}");
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
///
/// Dalla [decisione 0053](../../../docs/decisions/0053-il-contratto-ha-una-sorgente.md)
/// il lettore del sorgente sta in `tests/common/`, perché non serve più a
/// questo test soltanto: la stessa dichiarazione Rust proietta di qua il WIT
/// (`kebab`) e di là le union del mirror TypeScript (`snake`, `ts_enums.rs`).
/// Una lettura, due confini.
fn rust_enum_order(file: &str, enum_name: &str) -> Vec<String> {
    common::read_enum(file, enum_name)
        .variants
        .iter()
        .map(|v| common::kebab(v))
        .collect()
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

    /// Un `enum` del WIT confrontato **direttamente** con la dichiarazione
    /// Rust (decisione 0053): i casi e il loro ordine si leggono dal sorgente,
    /// non si riscrivono qui.
    ///
    /// Sostituisce l'`enumeration_src` di prima, che chiedeva l'elenco a mano e
    /// poi lo confrontava con questo stesso `rust_enum_order` — cioè faceva
    /// scrivere una copia per poterla correggere. Non è un presidio più debole:
    /// l'altro lato del confronto è il WIT, che resta scritto a mano e parsato.
    /// È più forte, perché un caso aggiunto in Rust arriva **da solo** fino al
    /// diff col contratto, invece di aspettare che qualcuno si ricordi di
    /// questa riga — che è il difetto che il §16.7 nomina.
    fn enumeration_from(&mut self, name: &str, src: (&str, &str)) {
        let cases = rust_enum_order(src.0, src.1);
        let refs: Vec<&str> = cases.iter().map(String::as_str).collect();
        self.enumeration(name, &refs);
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
            if let Some((n, t)) = declared_params
                .iter()
                .find(|(n, _)| n == "host" || n == "out")
            {
                self.err(format!(
                    "funzione `{iface}.{name}`: il metodo Rust prende una capacità dell'host e \
                     il WIT dichiara `{n}: {t}` — la capacità è importata dal world, va ELISA"
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
                    .filter(|(_, sig)| sig.params.iter().any(|(p, _)| p == "host" || p == "out"))
                    .map(move |(name, _)| format!("{iface}.{name}"))
            })
            .collect();
        if !intrusi.is_empty() {
            self.err(format!(
                "funzioni del WIT con un parametro `host`/`out` {intrusi:?}: le capacità sono \
                 importate dal world, non passate come argomento"
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
            start,
        } => case_rec(
            "list",
            "block-list",
            vec![
                ("ordered", wit(ordered)),
                ("items", wit(items)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
                ("start", wit(start)),
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
        arena::Block::ReferenceDefinition {
            label,
            url,
            title,
            anchor,
            span,
        } => case_rec(
            "reference-definition",
            "block-reference-definition",
            vec![
                ("label", wit(label)),
                ("url", wit(url)),
                ("title", wit(title)),
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
        Event::DocumentChanged { id, changes } => case_rec(
            "document-changed",
            "event-document-changed",
            vec![("id", wit(id)), ("changes", wit(changes))],
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
        Event::VaultClosed { root } => case_rec(
            "vault-closed",
            "event-vault-closed",
            vec![("root", wit(root))],
        ),
        Event::JobStarted { id, job } => case_rec(
            "job-started",
            "event-job-started",
            vec![("id", wit(id)), ("job", wit(job))],
        ),
        Event::JobProgress { id, progress } => case_rec(
            "job-progress",
            "event-job-progress",
            vec![("id", wit(id)), ("progress", wit(progress))],
        ),
        Event::SettingChanged { key, scope } => case_rec(
            "setting-changed",
            "event-setting-changed",
            vec![("key", wit(key)), ("scope", wit(scope))],
        ),
        Event::EntryChanged { id, kind } => case_rec(
            "entry-changed",
            "event-entry-changed",
            vec![("id", wit(id)), ("kind", wit(kind))],
        ),
        Event::EntryRemoved { id, kind } => case_rec(
            "entry-removed",
            "event-entry-removed",
            vec![("id", wit(id)), ("kind", wit(kind))],
        ),
        Event::EntryRenamed { from, to, kind } => case_rec(
            "entry-renamed",
            "event-entry-renamed",
            vec![("from", wit(from)), ("to", wit(to)), ("kind", wit(kind))],
        ),
        Event::Trouble {
            severity,
            subject,
            error,
        } => case_rec(
            "trouble",
            "event-trouble",
            vec![
                ("severity", wit(severity)),
                ("subject", wit(subject)),
                ("error", wit(error)),
            ],
        ),
        Event::TimerFired { owner, timer } => case_rec(
            "timer-fired",
            "event-timer-fired",
            vec![("owner", wit(owner)), ("timer", wit(timer))],
        ),
    }
}

/// La specie di un'impostazione: ogni caso porta un record dedicato, come per
/// gli eventi — un payload anonimo con tre campi non si nomina in una diff.
fn setting_kind_case(k: &SettingKind) -> Case {
    match k {
        SettingKind::Toggle { default } => {
            case_rec("toggle", "setting-toggle", vec![("default", wit(default))])
        }
        SettingKind::Number { default, min, max } => case_rec(
            "number",
            "setting-number",
            vec![
                ("default", wit(default)),
                ("min", wit(min)),
                ("max", wit(max)),
            ],
        ),
        SettingKind::Text { default } => {
            case_rec("text", "setting-text", vec![("default", wit(default))])
        }
        SettingKind::Choice { default, options } => case_rec(
            "choice",
            "setting-choice",
            vec![("default", wit(default)), ("options", wit(options))],
        ),
        SettingKind::List { default } => {
            case_rec("list", "setting-list", vec![("default", wit(default))])
        }
    }
}

/// Il valore invece porta payload **nudi**: al confine JSON è `true`, `12`,
/// `"scuro"`, `["a"]`, e la ragione sta nel doc di `SettingValue`.
fn setting_value_case(v: &SettingValue) -> Case {
    match v {
        SettingValue::Toggle(b) => case_ty("toggle", wit(b)),
        SettingValue::Number(n) => case_ty("number", wit(n)),
        SettingValue::Text(t) => case_ty("text", wit(t)),
        SettingValue::List(l) => case_ty("list", wit(l)),
    }
}

fn subject_case(s: &Subject) -> Case {
    match s {
        Subject::Document { id } => case_rec("document", "subject-document", vec![("id", wit(id))]),
        Subject::Folder { path } => case_rec("folder", "subject-folder", vec![("path", wit(path))]),
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
        IndexQuery::Documents {
            matching,
            sort,
            select,
            page,
            excerpts,
        } => case_rec(
            "documents",
            "index-query-documents",
            vec![
                ("matching", wit(matching)),
                ("sort", wit(sort)),
                ("select", wit(select)),
                ("page", wit(page)),
                ("excerpts", wit(excerpts)),
            ],
        ),
        IndexQuery::Backlinks { target, page } => case_rec(
            "backlinks",
            "index-query-backlinks",
            vec![("target", wit(target)), ("page", wit(page))],
        ),
        IndexQuery::Outline { doc } => case_ty("outline", wit(doc)),
        IndexQuery::Tags { matching, page } => case_rec(
            "tags",
            "index-query-tags",
            vec![("matching", wit(matching)), ("page", wit(page))],
        ),
        IndexQuery::Neighbors {
            seeds,
            direction,
            depth,
            page,
        } => case_rec(
            "neighbors",
            "index-query-neighbors",
            vec![
                ("seeds", wit(seeds)),
                ("direction", wit(direction)),
                ("depth", wit(depth)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::PropertyValues {
            key,
            matching,
            page,
        } => case_rec(
            "property-values",
            "index-query-property-values",
            vec![
                ("key", wit(key)),
                ("matching", wit(matching)),
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
        IndexQuery::VaultStatus => case("vault-status"),
        IndexQuery::Jobs => case("jobs"),
        IndexQuery::Settings { plugin } => case_ty("settings", wit(plugin)),
        IndexQuery::Organization => case("organization"),
        IndexQuery::Resolve { target, from } => case_rec(
            "resolve",
            "index-query-resolve",
            vec![("target", wit(target)), ("from", wit(from))],
        ),
        IndexQuery::Entries {
            of_kind,
            within,
            page,
        } => case_rec(
            "entries",
            "index-query-entries",
            vec![
                ("of-kind", wit(of_kind)),
                ("within", wit(within)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::Folders { under, page } => case_rec(
            "folders",
            "index-query-folders",
            vec![("under", wit(under)), ("page", wit(page))],
        ),
        IndexQuery::Drafts { page } => {
            case_rec("drafts", "index-query-drafts", vec![("page", wit(page))])
        }
    }
}

fn query_predicate_case(p: &QueryPredicate) -> Case {
    match p {
        QueryPredicate::Text(q) => case_ty("text", wit(q)),
        QueryPredicate::Property { filter } => case_ty("property", wit(filter)),
        QueryPredicate::Tag { name, descendants } => case_rec(
            "tag",
            "tag-predicate",
            vec![("name", wit(name)), ("descendants", wit(descendants))],
        ),
        QueryPredicate::Folder { path, descendants } => case_rec(
            "folder",
            "folder-predicate",
            vec![("path", wit(path)), ("descendants", wit(descendants))],
        ),
        QueryPredicate::Linked { doc, direction } => case_rec(
            "linked",
            "linked-predicate",
            vec![("doc", wit(doc)), ("direction", wit(direction))],
        ),
        QueryPredicate::Docs { docs } => {
            case_rec("docs", "docs-predicate", vec![("docs", wit(docs))])
        }
        QueryPredicate::Custom { ns, predicate } => case_rec(
            "custom",
            "custom-predicate",
            vec![("ns", wit(ns)), ("predicate", wit(predicate))],
        ),
    }
}

fn property_select_case(s: &PropertySelect) -> Case {
    match s {
        PropertySelect::None => case("none"),
        PropertySelect::All => case("all"),
        PropertySelect::Keys { keys } => {
            case_rec("keys", "property-select-keys", vec![("keys", wit(keys))])
        }
    }
}

fn query_kind_case(k: &QueryKind) -> Case {
    match k {
        QueryKind::Documents => case("documents"),
        QueryKind::Backlinks => case("backlinks"),
        QueryKind::Outline => case("outline"),
        QueryKind::Tags => case("tags"),
        QueryKind::Neighbors => case("neighbors"),
        QueryKind::PropertyValues => case("property-values"),
        QueryKind::VaultHealth => case("vault-health"),
        QueryKind::Custom(ns) => case_ty("custom", wit(ns)),
        QueryKind::VaultStatus => case("vault-status"),
        QueryKind::Jobs => case("jobs"),
        QueryKind::Settings => case("settings"),
        QueryKind::Organization => case("organization"),
        QueryKind::Resolve => case("resolve"),
        QueryKind::Entries => case("entries"),
        QueryKind::Folders => case("folders"),
        QueryKind::Drafts => case("drafts"),
    }
}

fn predicate_kind_case(k: &PredicateKind) -> Case {
    match k {
        PredicateKind::Text => case("text"),
        PredicateKind::Property => case("property"),
        PredicateKind::Tag => case("tag"),
        PredicateKind::Folder => case("folder"),
        PredicateKind::Linked => case("linked"),
        PredicateKind::Custom(ns) => case_ty("custom", wit(ns)),
    }
}

fn query_route_case(r: &QueryRoute) -> Case {
    match r {
        QueryRoute::Query(k) => case_ty("query", wit(k)),
        QueryRoute::Predicate(k) => case_ty("predicate", wit(k)),
    }
}

fn index_result_case(r: &IndexResult) -> Case {
    match r {
        IndexResult::Backlinks(v) => case_ty("backlinks", wit(v)),
        IndexResult::Documents(v) => case_ty("documents", wit(v)),
        IndexResult::Outline(v) => case_ty("outline", wit(v)),
        IndexResult::Tags(v) => case_ty("tags", wit(v)),
        IndexResult::Neighbors(v) => case_ty("neighbors", wit(v)),
        IndexResult::PropertyValues(v) => case_ty("property-values", wit(v)),
        IndexResult::VaultHealth(v) => case_ty("vault-health", wit(v)),
        IndexResult::Custom(v) => case_ty("custom", wit(v)),
        IndexResult::VaultStatus(v) => case_ty("vault-status", wit(v)),
        IndexResult::Jobs(v) => case_ty("jobs", wit(v)),
        IndexResult::Settings(v) => case_ty("settings", wit(v)),
        IndexResult::Organization(v) => case_ty("organization", wit(v)),
        IndexResult::Resolved(v) => case_ty("resolved", wit(v)),
        IndexResult::Entries(v) => case_ty("entries", wit(v)),
        IndexResult::Folders(v) => case_ty("folders", wit(v)),
        IndexResult::Drafts(v) => case_ty("drafts", wit(v)),
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

fn undo_step_case(s: &UndoStep) -> Case {
    match s {
        UndoStep::Edit(planned) => case_ty("edit", wit(planned)),
        UndoStep::Command { command, args } => case_rec(
            "command",
            "undo-step-command",
            vec![("command", wit(command)), ("args", wit(args))],
        ),
    }
}

fn format_error_case(e: &FormatError) -> Case {
    match e {
        FormatError::Parse(s) => case_ty("parse", wit(s)),
        FormatError::Render(s) => case_ty("render", wit(s)),
        FormatError::Serialize(s) => case_ty("serialize", wit(s)),
        FormatError::Unsupported { format, got } => case_rec(
            "unsupported",
            "format-error-unsupported",
            vec![("format", wit(format)), ("got", wit(got))],
        ),
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
        PluginError::Unserved(s) => case_ty("unserved", wit(s)),
        PluginError::Cancelled(s) => case_ty("cancelled", wit(s)),
        PluginError::NotFound(s) => case_ty("not-found", wit(s)),
        PluginError::AlreadyExists(s) => case_ty("already-exists", wit(s)),
        PluginError::Io(s) => case_ty("io", wit(s)),
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
        format!("fub:abi@{ABI_VERSION}"),
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
                start: None,
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
            block_case(&arena::Block::ReferenceDefinition {
                label: String::new(),
                url: String::new(),
                title: None,
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

    contract.enumeration_from("column-align", ("model.rs", "ColumnAlign"));

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
                content: Text::default(),
            }),
            ui_kind_case(&arena::UiKind::Heading {
                level: 1,
                content: Text::default(),
            }),
            ui_kind_case(&arena::UiKind::List { items: vec![] }),
            ui_kind_case(&arena::UiKind::ListItem {
                title: Text::default(),
                subtitle: None,
                action: None,
                selected: false,
            }),
            ui_kind_case(&arena::UiKind::Button {
                label: Text::default(),
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
                title: Text::default(),
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
                label: Text::default(),
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
                label: Text::default(),
                action: None,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Badge {
                label: Text::default(),
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
                title: Text::default(),
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
                label: Text::default(),
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
                submit_label: Text::default(),
                submit: ActionRef::new(""),
            }),
            ui_kind_case(&arena::UiKind::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
                fallback: vec![],
            }),
            ui_kind_case(&arena::UiKind::Pending { label: None }),
            ui_kind_case(&arena::UiKind::Failed {
                message: Text::default(),
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
                changes: None,
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
            event_case(&Event::VaultClosed {
                root: String::new(),
            }),
            event_case(&Event::JobStarted {
                id: JobId(0),
                job: String::new(),
            }),
            event_case(&Event::JobProgress {
                id: JobId(0),
                progress: JobProgress::default(),
            }),
            event_case(&Event::SettingChanged {
                key: String::new(),
                scope: SettingScope::Vault,
            }),
            event_case(&Event::EntryChanged {
                id: DocId::new("a"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::EntryRemoved {
                id: DocId::new("a"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::EntryRenamed {
                from: DocId::new("a"),
                to: DocId::new("b"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::Trouble {
                severity: Severity::Warning,
                subject: Some(DocId::new("a")),
                error: PluginError::Internal("x".into()),
            }),
            event_case(&Event::TimerFired {
                owner: "com.acme.tasks".into(),
                timer: "sync".into(),
            }),
        ],
    );

    contract.variant_src(
        "subject",
        ("event.rs", "Subject"),
        &[
            subject_case(&Subject::document("")),
            subject_case(&Subject::folder("")),
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
            index_query_case(&IndexQuery::Documents {
                matching: QueryExpr::all(),
                sort: None,
                select: PropertySelect::None,
                page: None,
                excerpts: Excerpts::Attach,
            }),
            index_query_case(&IndexQuery::Backlinks {
                target: DocId::new("a"),
                page: None,
            }),
            index_query_case(&IndexQuery::Outline {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::Tags {
                matching: QueryExpr::all(),
                page: None,
            }),
            index_query_case(&IndexQuery::Neighbors {
                seeds: QueryExpr::all(),
                direction: LinkDirection::Outbound,
                depth: 1,
                page: None,
            }),
            index_query_case(&IndexQuery::PropertyValues {
                key: String::new(),
                matching: QueryExpr::all(),
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
            index_query_case(&IndexQuery::VaultStatus),
            index_query_case(&IndexQuery::Jobs),
            index_query_case(&IndexQuery::Settings { plugin: None }),
            index_query_case(&IndexQuery::Organization),
            index_query_case(&IndexQuery::Resolve {
                target: LinkTarget::wiki(""),
                from: None,
            }),
            index_query_case(&IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: None,
            }),
            index_query_case(&IndexQuery::Folders {
                under: None,
                page: None,
            }),
            index_query_case(&IndexQuery::Drafts { page: None }),
        ],
    );

    contract.variant_src(
        "index-result",
        ("traits.rs", "IndexResult"),
        &[
            index_result_case(&IndexResult::Documents(Paged::all(vec![]))),
            index_result_case(&IndexResult::Backlinks(Paged::all(vec![]))),
            index_result_case(&IndexResult::Outline(vec![])),
            index_result_case(&IndexResult::Tags(Paged::all(vec![]))),
            index_result_case(&IndexResult::Neighbors(Paged::all(vec![]))),
            index_result_case(&IndexResult::PropertyValues(Paged::all(vec![]))),
            index_result_case(&IndexResult::VaultHealth(Paged::all(vec![]))),
            index_result_case(&IndexResult::Custom(serde_json::Value::Null)),
            index_result_case(&IndexResult::VaultStatus(VaultStatus::default())),
            index_result_case(&IndexResult::Jobs(vec![])),
            index_result_case(&IndexResult::Settings(vec![])),
            index_result_case(&IndexResult::Organization(Organization::default())),
            index_result_case(&IndexResult::Resolved(None)),
            index_result_case(&IndexResult::Entries(Paged::all(vec![]))),
            index_result_case(&IndexResult::Folders(Paged::all(vec![]))),
            index_result_case(&IndexResult::Drafts(Paged::all(vec![]))),
        ],
    );

    contract.variant_src(
        "query-predicate",
        ("query.rs", "QueryPredicate"),
        &[
            query_predicate_case(&QueryPredicate::Text(TextQuery::terms(""))),
            query_predicate_case(&QueryPredicate::Property {
                filter: PropertyFilter {
                    key: String::new(),
                    test: PropertyTest::Exists,
                },
            }),
            query_predicate_case(&QueryPredicate::Tag {
                name: String::new(),
                descendants: false,
            }),
            query_predicate_case(&QueryPredicate::Folder {
                path: String::new(),
                descendants: false,
            }),
            query_predicate_case(&QueryPredicate::Linked {
                doc: DocId::new("a"),
                direction: LinkDirection::Outbound,
            }),
            query_predicate_case(&QueryPredicate::Docs { docs: vec![] }),
            query_predicate_case(&QueryPredicate::Custom {
                ns: String::new(),
                predicate: serde_json::Value::Null,
            }),
        ],
    );

    contract.variant_src(
        "property-select",
        ("traits.rs", "PropertySelect"),
        &[
            property_select_case(&PropertySelect::None),
            property_select_case(&PropertySelect::All),
            property_select_case(&PropertySelect::Keys { keys: vec![] }),
        ],
    );

    contract.variant_src(
        "query-kind",
        ("traits.rs", "QueryKind"),
        &[
            query_kind_case(&QueryKind::Documents),
            query_kind_case(&QueryKind::Backlinks),
            query_kind_case(&QueryKind::Outline),
            query_kind_case(&QueryKind::Tags),
            query_kind_case(&QueryKind::Neighbors),
            query_kind_case(&QueryKind::PropertyValues),
            query_kind_case(&QueryKind::VaultHealth),
            query_kind_case(&QueryKind::Custom(String::new())),
            query_kind_case(&QueryKind::VaultStatus),
            query_kind_case(&QueryKind::Jobs),
            query_kind_case(&QueryKind::Settings),
            query_kind_case(&QueryKind::Organization),
            query_kind_case(&QueryKind::Resolve),
            query_kind_case(&QueryKind::Entries),
            query_kind_case(&QueryKind::Folders),
            query_kind_case(&QueryKind::Drafts),
        ],
    );

    contract.variant_src(
        "predicate-kind",
        ("traits.rs", "PredicateKind"),
        &[
            predicate_kind_case(&PredicateKind::Text),
            predicate_kind_case(&PredicateKind::Property),
            predicate_kind_case(&PredicateKind::Tag),
            predicate_kind_case(&PredicateKind::Folder),
            predicate_kind_case(&PredicateKind::Linked),
            predicate_kind_case(&PredicateKind::Custom(String::new())),
        ],
    );

    contract.variant_src(
        "query-route",
        ("traits.rs", "QueryRoute"),
        &[
            query_route_case(&QueryRoute::Query(QueryKind::Documents)),
            query_route_case(&QueryRoute::Predicate(PredicateKind::Text)),
        ],
    );

    contract.enumeration_from("text-mode", ("query.rs", "TextMode"));

    contract.enumeration_from("text-field", ("query.rs", "TextField"));

    contract.enumeration_from("text-tolerance", ("query.rs", "TextTolerance"));

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

    // Quanto pesa ciò che è andato storto (§20.2): due gradini, come i due toni
    // del centro notifiche.
    contract.enumeration_from("severity", ("event.rs", "Severity"));

    contract.enumeration_from("link-direction", ("traits.rs", "LinkDirection"));

    contract.enumeration_from("health-check", ("traits.rs", "HealthCheck"));

    contract.enumeration_from("entry-kind", ("traits.rs", "EntryKind"));
    contract.enumeration_from("excerpts", ("traits.rs", "Excerpts"));

    contract.enumeration_from("indexing-state", ("traits.rs", "IndexingState"));

    contract.variant_src(
        "format-error",
        ("error.rs", "FormatError"),
        &[
            format_error_case(&FormatError::Parse(String::new())),
            format_error_case(&FormatError::Render(String::new())),
            format_error_case(&FormatError::Serialize(String::new())),
            format_error_case(&FormatError::Unsupported {
                format: String::new(),
                got: SourceKind::Text,
            }),
        ],
    );

    contract.variant_src(
        "plugin-error",
        ("error.rs", "PluginError"),
        &[
            plugin_error_case(&PluginError::UnknownCommand(String::new().into())),
            plugin_error_case(&PluginError::UnknownView(String::new().into())),
            plugin_error_case(&PluginError::UnknownJob(String::new().into())),
            plugin_error_case(&PluginError::BadArgs(String::new().into())),
            plugin_error_case(&PluginError::PermissionDenied(String::new().into())),
            plugin_error_case(&PluginError::Internal(String::new().into())),
            plugin_error_case(&PluginError::Conflict(String::new().into())),
            plugin_error_case(&PluginError::Unserved(String::new().into())),
            plugin_error_case(&PluginError::Cancelled(String::new().into())),
            plugin_error_case(&PluginError::NotFound(String::new().into())),
            plugin_error_case(&PluginError::AlreadyExists(String::new().into())),
            plugin_error_case(&PluginError::Io(String::new().into())),
        ],
    );

    contract.enumeration_from("event-kind", ("event.rs", "EventKind"));
    contract.enumeration_from("align", ("ui.rs", "Align"));
    contract.enumeration_from("axis", ("ui.rs", "Axis"));
    contract.enumeration_from("intent", ("ui.rs", "Intent"));
    contract.enumeration_from("view-surface", ("traits.rs", "ViewSurface"));

    contract.enumeration_from("note-level", ("transfer.rs", "NoteLevel"));
    contract.enumeration_from("import-mode", ("transfer.rs", "ImportMode"));
    contract.enumeration_from("conflict-policy", ("transfer.rs", "ConflictPolicy"));
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
            export_selection_case(&ExportSelection::Query(IndexQuery::Tags {
                matching: QueryExpr::all(),
                page: None,
            })),
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
        frontmatter_present,
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
            ("frontmatter-present", wit(&frontmatter_present)),
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

    contract.enumeration_from("source-kind", ("format.rs", "SourceKind"));

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

    contract.enumeration_from("render-target", ("format.rs", "RenderTarget"));

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

    contract.enumeration_from("command-reach", ("command.rs", "CommandReach"));

    contract.enumeration_from("invoke-mode", ("command.rs", "InvokeMode"));

    let CommandOutcome {
        notify,
        effect,
        undo,
        partial,
    } = CommandOutcome::done();
    contract.record(
        "command-outcome",
        &[
            ("notify", wit(&notify)),
            ("effect", wit(&effect)),
            ("undo", wit(&undo)),
            ("partial", wit(&partial)),
        ],
    );

    // L'esito parziale (§23.14): di N cose, quante e quali non sono riuscite.
    let Partial {
        attempted,
        done,
        failures,
    } = Partial {
        attempted: 0,
        done: 0,
        failures: vec![],
    };
    contract.record(
        "partial",
        &[
            ("attempted", wit(&attempted)),
            ("done", wit(&done)),
            ("failures", wit(&failures)),
        ],
    );
    let Failure { subject, error } = Failure::other(PluginError::Internal(Text::key("")));
    contract.record(
        "failure",
        &[("subject", wit(&subject)), ("error", wit(&error))],
    );

    // L'annullamento (§13.3): il record e le due specie di passo.
    let Undo { label, steps } = Undo::of_edits(Text::key(""), vec![]);
    contract.record("undo", &[("label", wit(&label)), ("steps", wit(&steps))]);
    let Undone {
        label,
        operation,
        replay,
    } = Undone::whole(Text::key(""));
    contract.record(
        "undone",
        &[
            ("label", wit(&label)),
            ("operation", wit(&operation)),
            ("replay", wit(&replay)),
        ],
    );
    contract.variant_src(
        "undo-step",
        ("command.rs", "UndoStep"),
        &[
            undo_step_case(&UndoStep::Edit(PlannedEdit::new(
                DocId::new(""),
                EditRequest::new(Revision::default(), vec![]),
            ))),
            undo_step_case(&UndoStep::Command {
                command: String::new(),
                args: serde_json::Value::Null,
            }),
        ],
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

    let ViewInterests { refresh, follows } = ViewInterests::default();
    contract.record(
        "view-interests",
        &[("refresh", wit(&refresh)), ("follows", wit(&follows))],
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

    contract.variant_src(
        "write-base",
        ("edit.rs", "WriteBase"),
        &[
            match &WriteBase::DescendsFrom(Revision::default()) {
                WriteBase::DescendsFrom(r) => case_ty("descends-from", wit(r)),
                WriteBase::Dictated => unreachable!(),
            },
            case("dictated"),
        ],
    );

    // --- il contesto di sessione (decisione 0007)

    // Le selezioni: cinque tipi dove ce n'era uno (decisione 0093).
    let FloatingSelection { text } = FloatingSelection::default();
    contract.record("floating-selection", &[("text", wit(&text))]);

    let AnchoredSelection { span, text } = AnchoredSelection::default();
    contract.record(
        "anchored-selection",
        &[("span", wit(&span)), ("text", wit(&text))],
    );

    let AnchoredSelections { primary, secondary } = AnchoredSelections::default();
    contract.record(
        "anchored-selections",
        &[("primary", wit(&primary)), ("secondary", wit(&secondary))],
    );

    let FloatingSelections { primary, secondary } = FloatingSelections::default();
    contract.record(
        "floating-selections",
        &[("primary", wit(&primary)), ("secondary", wit(&secondary))],
    );

    contract.variant_src(
        "selection-set",
        ("session.rs", "SelectionSet"),
        &[
            case_ty("anchored", wit(&AnchoredSelections::default())),
            case_ty("floating", wit(&FloatingSelections::default())),
        ],
    );

    let ViewContext {
        pane,
        doc,
        selections,
        mode,
    } = ViewContext::new("main");
    contract.record(
        "view-context",
        &[
            ("pane", wit(&pane)),
            ("doc", wit(&doc)),
            ("selections", wit(&selections)),
            ("mode", wit(&mode)),
        ],
    );

    contract.enumeration_from("pane-mode", ("session.rs", "PaneMode"));

    contract.enumeration_from("context-kind", ("session.rs", "ContextKind"));

    // --- il locale (§12.3)

    let Locale {
        language,
        timezone,
        utc_offset_minutes,
        first_day_of_week,
        hour_cycle,
    } = Locale::default();
    contract.record(
        "locale",
        &[
            ("language", wit(&language)),
            ("timezone", wit(&timezone)),
            ("utc-offset-minutes", wit(&utc_offset_minutes)),
            ("first-day-of-week", wit(&first_day_of_week)),
            ("hour-cycle", wit(&hour_cycle)),
        ],
    );

    // Il testo che si legge (§12.1). `text` è un tipo di CONTRATTO e non di
    // IPC: sul filo verso la shell un `literal` è una stringa nuda, perché
    // quando ci arriva il kernel ha già risolto tutto.
    contract.variant_src(
        "text",
        ("text.rs", "Text"),
        &[
            case_ty("literal", wit_of::<String>()),
            case_ty("message", wit_of::<Message>()),
        ],
    );
    let Message { key, args } = Message::default();
    contract.record("message", &[("key", wit(&key)), ("args", wit(&args))]);
    let arg = Arg::int("n", 0);
    contract.record(
        "arg",
        &[("name", wit(&arg.name)), ("value", wit(&arg.value))],
    );
    contract.variant_src(
        "arg-value",
        ("text.rs", "ArgValue"),
        &[
            case_ty("text", wit_of::<String>()),
            case_ty("int", "s64".to_string()),
            case_ty("float", wit_of::<f64>()),
            case_ty("timestamp", wit_of::<u64>()),
        ],
    );
    let StringCatalog { locale, entries } = StringCatalog::default();
    contract.record(
        "string-catalog",
        &[("locale", wit(&locale)), ("entries", wit(&entries))],
    );

    contract.enumeration_from("weekday", ("locale.rs", "Weekday"));

    contract.enumeration_from("hour-cycle", ("locale.rs", "HourCycle"));

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

    let VaultEntry {
        id,
        kind,
        size,
        mtime,
        fingerprint,
    } = VaultEntry {
        id: DocId::new("a.md"),
        kind: EntryKind::Document,
        size: 0,
        mtime: 0,
        fingerprint: None,
    };
    contract.record(
        "vault-entry",
        &[
            ("id", wit(&id)),
            ("kind", wit(&kind)),
            ("size", wit(&size)),
            ("mtime", wit(&mtime)),
            ("fingerprint", wit(&fingerprint)),
        ],
    );

    let VaultFolder {
        path,
        folders,
        entries,
    } = VaultFolder {
        path: "note".into(),
        folders: 0,
        entries: 0,
    };
    contract.record(
        "vault-folder",
        &[
            ("path", wit(&path)),
            ("folders", wit(&folders)),
            ("entries", wit(&entries)),
        ],
    );

    let FolderScope { path, descendants } = FolderScope::direct("note");
    contract.record(
        "folder-scope",
        &[("path", wit(&path)), ("descendants", wit(&descendants))],
    );

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    contract.record(
        "backlink-ref",
        &[("source", wit(&source)), ("context", wit(&context))],
    );

    let DocumentMatch {
        doc,
        score,
        snippet,
        highlights,
        properties,
        occurrences,
    } = DocumentMatch::of(DocId::new("a"));
    contract.record(
        "document-match",
        &[
            ("doc", wit(&doc)),
            // La larghezza di un punteggio è parte del contratto: era il caso
            // che il vecchio confronto per soli nomi non avrebbe visto.
            ("score", wit(&score)),
            ("snippet", wit(&snippet)),
            ("highlights", wit(&highlights)),
            ("properties", wit(&properties)),
            ("occurrences", wit(&occurrences)),
        ],
    );

    let DocPosition {
        span,
        anchor,
        revision,
    } = DocPosition::at(Span::EMPTY, Revision::default());
    contract.record(
        "doc-position",
        &[
            ("span", wit(&span)),
            ("anchor", wit(&anchor)),
            ("revision", wit(&revision)),
        ],
    );

    let ResolvedRef { doc, at } = ResolvedRef::doc(DocId::new("a"));
    contract.record("resolved-ref", &[("doc", wit(&doc)), ("at", wit(&at))]);

    let TagCount { name, count } = TagCount {
        name: String::new(),
        count: 0,
    };
    contract.record("tag-count", &[("name", wit(&name)), ("count", wit(&count))]);

    let VaultStatus {
        watching,
        sync_failures,
        last_sync_error,
        indexing,
    } = VaultStatus::default();
    contract.record(
        "vault-status",
        &[
            ("watching", wit(&watching)),
            ("sync-failures", wit(&sync_failures)),
            ("last-sync-error", wit(&last_sync_error)),
            ("indexing", wit(&indexing)),
        ],
    );

    // L'esito dell'alimentazione (§20.1): cosa un indice non ha preso.
    let IndexLoss { id, why } =
        IndexLoss::new(DocId::new("a.md"), PluginError::Internal("x".into()));
    contract.record("index-loss", &[("id", wit(&id)), ("why", wit(&why))]);

    // Il lavoro lungo che si racconta (§10.3): il progresso, e la riga che
    // `index-query.jobs` restituisce.
    let JobProgress { done, total, label } = JobProgress::default();
    contract.record(
        "job-progress",
        &[
            ("done", wit(&done)),
            ("total", wit(&total)),
            ("label", wit(&label)),
        ],
    );

    let JobStatus {
        id,
        job,
        plugin,
        since,
        progress,
    } = JobStatus {
        id: JobId(0),
        job: String::new(),
        plugin: String::new(),
        since: 0,
        progress: None,
    };
    contract.record(
        "job-status",
        &[
            ("id", wit(&id)),
            ("job", wit(&job)),
            ("plugin", wit(&plugin)),
            ("since", wit(&since)),
            ("progress", wit(&progress)),
        ],
    );

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

    let QueryExpr { any } = QueryExpr::all();
    contract.record("query-expr", &[("any", wit(&any))]);

    let QueryClause { all } = QueryClause::default();
    contract.record("query-clause", &[("all", wit(&all))]);

    let QueryLiteral { negated, predicate } = QueryLiteral {
        negated: false,
        predicate: QueryPredicate::Docs { docs: Vec::new() },
    };
    contract.record(
        "query-literal",
        &[("negated", wit(&negated)), ("predicate", wit(&predicate))],
    );

    let TextQuery {
        text,
        mode,
        fields,
        tolerance,
        partial_last_term,
    } = TextQuery::terms("");
    contract.record(
        "text-query",
        &[
            ("text", wit(&text)),
            ("mode", wit(&mode)),
            ("fields", wit(&fields)),
            ("tolerance", wit(&tolerance)),
            ("partial-last-term", wit(&partial_last_term)),
        ],
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

    let DraftInfo {
        doc,
        at,
        base,
        exists,
        current,
        text,
    } = DraftInfo {
        doc: DocId::new("a"),
        at: 0,
        base: None,
        exists: true,
        current: None,
        text: String::new(),
    };
    contract.record(
        "draft-info",
        &[
            ("doc", wit(&doc)),
            ("at", wit(&at)),
            ("base", wit(&base)),
            ("exists", wit(&exists)),
            ("current", wit(&current)),
            ("text", wit(&text)),
        ],
    );

    // Le finestre: un solo tipo in Rust, un record per istanza nel WIT.
    // Il destructuring è generico ma i tipi dei campi li deduce il compilatore
    // dall'istanza, quindi `items` porta davvero `list<backlink-ref>` e non una
    // forma scritta a mano.
    contract.record(
        "backlinks-page",
        &paged_fields(&Paged::all(Vec::<BacklinkRef>::new())),
    );
    contract.record(
        "documents-page",
        &paged_fields(&Paged::all(Vec::<DocumentMatch>::new())),
    );
    contract.record(
        "doc-ids-page",
        &paged_fields(&Paged::all(Vec::<DocId>::new())),
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
        "property-values-page",
        &paged_fields(&Paged::all(Vec::<PropertyCount>::new())),
    );
    contract.record(
        "vault-health-page",
        &paged_fields(&Paged::all(Vec::<HealthIssue>::new())),
    );
    contract.record(
        "entries-page",
        &paged_fields(&Paged::all(Vec::<VaultEntry>::new())),
    );
    contract.record(
        "drafts-page",
        &paged_fields(&Paged::all(Vec::<DraftInfo>::new())),
    );
    contract.record(
        "folders-page",
        &paged_fields(&Paged::all(Vec::<VaultFolder>::new())),
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
        label: Text::default(),
        value: Text::default(),
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

    // --- la rete (§23.3): due record, un enum, e il corpo che è byte
    contract.enumeration(
        "http-method",
        &["get", "head", "post", "put", "patch", "delete"],
    );
    let HttpHeader { name, value } = HttpHeader::new("content-type", "application/json");
    contract.record(
        "http-header",
        &[("name", wit(&name)), ("value", wit(&value))],
    );
    let HttpRequest {
        url,
        method,
        headers,
        body,
    } = HttpRequest::get("https://esempio.test/");
    contract.record(
        "http-request",
        &[
            ("url", wit(&url)),
            ("method", wit(&method)),
            ("headers", wit(&headers)),
            ("body", wit(&body)),
        ],
    );
    let HttpResponse {
        status,
        headers,
        body,
    } = HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: Vec::new(),
    };
    contract.record(
        "http-response",
        &[
            ("status", wit(&status)),
            ("headers", wit(&headers)),
            ("body", wit(&body)),
        ],
    );

    let PluginPermissions { granted } = PluginPermissions::default();
    contract.record("plugin-permissions", &[("granted", wit(&granted))]);

    let PluginManifest {
        id,
        name,
        version,
        abi_version,
        permissions,
        provides,
        requires,
        settings,
        strings,
        default_locale,
        timers,
    } = PluginManifest {
        id: String::new(),
        name: String::new(),
        version: String::new(),
        abi_version: String::new(),
        permissions: PluginPermissions::default(),
        provides: Vec::new(),
        requires: Vec::new(),
        settings: Vec::new(),
        strings: Vec::new(),
        default_locale: String::new(),
        timers: Vec::new(),
    };
    contract.record(
        "plugin-manifest",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("version", wit(&version)),
            ("abi-version", wit(&abi_version)),
            ("permissions", wit(&permissions)),
            // I due campi del §7.5, **in fondo**: è ciò che li rende additivi
            // per il presidio dell'additività, ed è la ragione per cui questa
            // voce non scade col freeze.
            ("provides", wit(&provides)),
            ("requires", wit(&requires)),
            // E lo schema delle impostazioni (§11.1), in fondo per la stessa
            // ragione: uno schema che arriva dopo il freeze deve poter arrivare
            // senza spostare niente di ciò che c'era.
            ("settings", wit(&settings)),
            // E il catalogo delle stringhe (§12.1), in fondo per la stessa
            // ragione ancora: chi si è congelato senza tradurre nulla non deve
            // spostarsi per far posto a chi traduce.
            ("strings", wit(&strings)),
            ("default-locale", wit(&default_locale)),
            // E le sveglie (§22.1, decisione 0069), in fondo per la stessa
            // ragione di tutte le altre: chi si è congelato senza dichiarare
            // timer non si sposta per far posto a chi ne dichiara.
            ("timers", wit(&timers)),
        ],
    );

    // Le sveglie (§22.1, decisione 0069). Il nome è nudo — vive dentro il
    // componente — e la regola di quando suona sta nel contratto perché due
    // host non abbiano due idee di cosa voglia dire «ogni ora».
    let TimerSpec { id, schedule } = TimerSpec {
        id: String::new(),
        schedule: TimerSchedule::Every { seconds: 0 },
    };
    contract.record(
        "timer-spec",
        &[("id", wit(&id)), ("schedule", wit(&schedule))],
    );
    // Il terzo caso è **in coda** (§22.4, decisione 0091): l'ordine dei casi è
    // il discriminante dell'ABI, quindi additivo vuol dire in fondo — ed è
    // `variant_src` a farlo rispettare, leggendo l'ordine dall'enum Rust.
    contract.variant_src(
        "timer-schedule",
        ("traits.rs", "TimerSchedule"),
        &[
            case_ty("every", wit_of::<u64>()),
            case_ty("after", wit_of::<u64>()),
            case_ty("at-wall-clock", wit_of::<WallClock>()),
        ],
    );
    let WallClock {
        hour,
        minute,
        days,
        zone,
        catch_up_seconds,
    } = WallClock::daily(0, 0);
    contract.record(
        "wall-clock",
        &[
            ("hour", wit(&hour)),
            ("minute", wit(&minute)),
            ("days", wit(&days)),
            ("zone", wit(&zone)),
            ("catch-up-seconds", wit(&catch_up_seconds)),
        ],
    );

    // Le impostazioni (§11.1): lo schema che un manifest dichiara, il valore
    // che ne esce, e la riga risolta che il canale dati restituisce.
    contract.enumeration_from("setting-scope", ("settings.rs", "SettingScope"));
    contract.enumeration_from("setting-source", ("settings.rs", "SettingSource"));
    contract.variant_src(
        "setting-kind",
        ("settings.rs", "SettingKind"),
        &[
            setting_kind_case(&SettingKind::Toggle { default: false }),
            setting_kind_case(&SettingKind::Number {
                default: 0.0,
                min: None,
                max: None,
            }),
            setting_kind_case(&SettingKind::Text {
                default: String::new(),
            }),
            setting_kind_case(&SettingKind::Choice {
                default: String::new(),
                options: Vec::new(),
            }),
            setting_kind_case(&SettingKind::List {
                default: Vec::new(),
            }),
        ],
    );
    contract.variant_src(
        "setting-value",
        ("settings.rs", "SettingValue"),
        &[
            setting_value_case(&SettingValue::Toggle(false)),
            setting_value_case(&SettingValue::Number(0.0)),
            setting_value_case(&SettingValue::Text(String::new())),
            setting_value_case(&SettingValue::List(Vec::new())),
        ],
    );

    let SettingSpec {
        key,
        label,
        description,
        group,
        scope,
        kind,
        program_writable,
    } = SettingSpec::toggle("", "", false);
    contract.record(
        "setting-spec",
        &[
            ("key", wit(&key)),
            ("label", wit(&label)),
            ("description", wit(&description)),
            ("group", wit(&group)),
            ("scope", wit(&scope)),
            ("kind", wit(&kind)),
            ("program-writable", wit(&program_writable)),
        ],
    );

    let SettingEntry {
        spec,
        value,
        source,
    } = SettingEntry {
        spec: SettingSpec::toggle("", "", false),
        value: SettingValue::Toggle(false),
        source: SettingSource::Default,
    };
    contract.record(
        "setting-entry",
        &[
            ("spec", wit(&spec)),
            ("value", wit(&value)),
            ("source", wit(&source)),
        ],
    );

    let Organization {
        icons,
        pinned,
        order,
        spaces,
    } = Organization::default();
    contract.record(
        "organization",
        &[
            ("icons", wit(&icons)),
            ("pinned", wit(&pinned)),
            ("order", wit(&order)),
            ("spaces", wit(&spaces)),
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

    // La maschera di un abbonamento (§10.1, decisione 0033). Era un alias su
    // `list<event-kind>`; adesso è un record a tre campi, e il terzo porta un
    // variant suo — i due record di payload (`subject-document`,
    // `subject-folder`) se li rivendica `variant_src` qui sotto.
    let EventMask {
        kinds,
        topics,
        subjects,
        changes,
    } = EventMask::all();
    contract.record(
        "event-mask",
        &[
            ("kinds", wit(&kinds)),
            ("topics", wit(&topics)),
            ("subjects", wit(&subjects)),
            // Il quarto asse (§22.2, decisione 0069), in fondo: chi ha scritto
            // una maschera prima di lui riceve esattamente ciò che riceveva.
            ("changes", wit(&changes)),
        ],
    );

    // Cosa è cambiato in un documento (§22.2, decisione 0069): gli aspetti, su
    // cui si filtra, e i nomi, che si leggono.
    contract.enumeration_from("doc-change", ("event.rs", "DocChange"));
    let DocChanges {
        aspects,
        properties,
        tags_added,
        tags_removed,
    } = DocChanges::everything();
    contract.record(
        "doc-changes",
        &[
            ("aspects", wit(&aspects)),
            ("properties", wit(&properties)),
            ("tags-added", wit(&tags_added)),
            ("tags-removed", wit(&tags_removed)),
        ],
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

    let SourceHandle(raw) = SourceHandle(0);
    contract.alias("source-handle", wit(&raw));

    let ArtifactHandle(raw) = ArtifactHandle(0);
    contract.alias("artifact-handle", wit(&raw));

    let StreamedSource {
        handle,
        len,
        prologue,
    } = StreamedSource {
        handle: SourceHandle(0),
        len: 0,
        prologue: Vec::new(),
    };
    contract.record(
        "streamed-source",
        &[
            ("handle", wit(&handle)),
            ("len", wit(&len)),
            ("prologue", wit(&prologue)),
        ],
    );

    contract.variant_src(
        "source-content",
        ("transfer.rs", "SourceContent"),
        &[
            case_ty("bytes", wit(&Vec::<u8>::new())),
            case_ty(
                "streamed",
                wit(&StreamedSource {
                    handle: SourceHandle(0),
                    len: 0,
                    prologue: Vec::new(),
                }),
            ),
        ],
    );

    let ImportSource {
        name,
        media_type,
        content,
    } = ImportSource::default();
    contract.record(
        "import-source",
        &[
            ("name", wit(&name)),
            ("media-type", wit(&media_type)),
            ("content", wit(&content)),
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

    contract.variant_src(
        "artifact-content",
        ("transfer.rs", "ArtifactContent"),
        &[
            case_ty("bytes", wit(&Vec::<u8>::new())),
            case_ty("delivered", wit(&0u64)),
        ],
    );

    let ExportArtifact {
        path,
        media_type,
        content,
    } = ExportArtifact::bytes("", "", Vec::new());
    contract.record(
        "export-artifact",
        &[
            ("path", wit(&path)),
            ("media-type", wit(&media_type)),
            ("content", wit(&content)),
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
    contract.types_only("intl");
    contract.types_only("text");
    contract.types_only("edit");
    contract.types_only("net");
    contract.types_only("transfer");
    contract.types_only("settings");
    contract.types_only("organization");

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
        "interests",
        <dyn ViewProvider>::interests
            as fn(&'static dyn ViewProvider, &'static ViewInstance) -> ViewInterests,
        &["instance"],
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
        "routes",
        <dyn IndexProvider>::routes as fn(&'static dyn IndexProvider) -> Vec<QueryRoute>,
        &[],
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
        "on-documents-indexed",
        <dyn IndexProvider>::on_documents_indexed
            as fn(&'static mut dyn IndexProvider, &'static [DocumentModel]) -> Vec<IndexLoss>,
        &["docs"],
    );
    contract.method(
        "index",
        "on-documents-removed",
        <dyn IndexProvider>::on_documents_removed
            as fn(&'static mut dyn IndexProvider, &'static [DocId]) -> Vec<IndexLoss>,
        &["ids"],
    );
    contract.method(
        "index",
        "reconcile",
        <dyn IndexProvider>::reconcile
            as fn(&'static mut dyn IndexProvider, &'static [DocId]) -> Vec<IndexLoss>,
        &["ids"],
    );
    contract.method(
        "index",
        "up-to-date",
        <dyn IndexProvider>::up_to_date
            as fn(&'static dyn IndexProvider, &'static [VaultEntry]) -> Vec<DocId>,
        &["entries"],
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
        "close",
        <dyn IndexProvider>::close
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
        "host-vault-read",
        "read-document",
        <dyn HostApi>::read_document
            as fn(&'static dyn HostApi, &'static DocId) -> Result<String, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "read-document-bytes",
        <dyn HostApi>::read_document_bytes
            as fn(&'static dyn HostApi, &'static DocId) -> Result<Vec<u8>, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-write",
        "write-document",
        <dyn HostApi>::write_document
            as fn(Host, &'static DocId, &'static str, WriteBase) -> Result<Revision, PluginError>,
        &["id", "source", "base"],
    );
    contract.method(
        "host-vault-read",
        "document-revision",
        <dyn HostApi>::document_revision
            as fn(&'static dyn HostApi, &'static DocId) -> Result<Revision, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-write",
        "apply-edit",
        <dyn HostApi>::apply_edit
            as fn(Host, &'static DocId, EditRequest) -> Result<EditReport, PluginError>,
        &["id", "request"],
    );
    contract.method(
        "host-vault-read",
        "list-documents",
        <dyn HostApi>::list_documents
            as fn(&'static dyn HostApi, Option<Page>) -> Result<Paged<DocId>, PluginError>,
        &["page"],
    );
    contract.method(
        "host-vault-read",
        "free-name",
        <dyn HostApi>::free_name as fn(&'static dyn HostApi, &'static DocId) -> DocId,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "read-model",
        <dyn HostApi>::read_model
            as fn(&'static dyn HostApi, &'static DocId) -> Result<DocumentModel, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "format-of",
        <dyn HostApi>::format_of
            as fn(&'static dyn HostApi, &'static DocId) -> Option<DocumentFormat>,
        &["id"],
    );
    contract.method(
        "host-vault-structure",
        "create-document",
        <dyn HostApi>::create_document
            as fn(Host, &'static DocId, &'static str) -> Result<(), PluginError>,
        &["id", "source"],
    );
    contract.method(
        "host-vault-structure",
        "rename-document",
        <dyn HostApi>::rename_document
            as fn(Host, &'static DocId, &'static DocId) -> Result<(), PluginError>,
        &["from", "to"],
    );
    contract.method(
        "host-vault-structure",
        "trash-document",
        <dyn HostApi>::trash_document as fn(Host, &'static DocId) -> Result<DocId, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "list-trash",
        <dyn HostApi>::list_trash
            as fn(&'static dyn HostApi) -> Result<Vec<TrashEntry>, PluginError>,
        &[],
    );
    contract.method(
        "host-vault-structure",
        "restore-document",
        <dyn HostApi>::restore_document
            as fn(Host, &'static DocId, Option<DocId>) -> Result<DocId, PluginError>,
        &["entry", "to"],
    );
    contract.method(
        "host-vault-structure",
        "empty-trash",
        <dyn HostApi>::empty_trash as fn(Host) -> Result<u64, PluginError>,
        &[],
    );
    contract.method(
        "host-events",
        "emit",
        <dyn HostApi>::emit as fn(Host, Event),
        &["event"],
    );
    contract.method(
        "host-events",
        "spawn-job",
        <dyn HostApi>::spawn_job as fn(Host, JobSpec) -> Result<JobId, PluginError>,
        &["spec"],
    );
    contract.method(
        "host-events",
        "report-progress",
        <dyn HostApi>::report_progress as fn(Host, JobProgress),
        &["progress"],
    );
    contract.method(
        "host-data-read",
        "data-read",
        <dyn HostApi>::data_read
            as fn(&'static dyn HostApi, &'static str) -> Result<Option<Vec<u8>>, PluginError>,
        &["path"],
    );
    contract.method(
        "host-data-write",
        "data-write",
        <dyn HostApi>::data_write
            as fn(Host, &'static str, &'static [u8]) -> Result<(), PluginError>,
        &["path", "bytes"],
    );
    contract.method(
        "host-data-write",
        "data-remove",
        <dyn HostApi>::data_remove as fn(Host, &'static str) -> Result<(), PluginError>,
        &["path"],
    );
    contract.method(
        "host-data-read",
        "data-list",
        <dyn HostApi>::data_list
            as fn(&'static dyn HostApi, &'static str) -> Result<Vec<String>, PluginError>,
        &["prefix"],
    );
    contract.method(
        "host-settings-read",
        "setting",
        <dyn HostApi>::setting
            as fn(&'static dyn HostApi, &'static str) -> Result<SettingValue, PluginError>,
        &["key"],
    );
    contract.method(
        "host-settings-write",
        "set-setting",
        <dyn HostApi>::set_setting
            as fn(Host, &'static str, SettingValue) -> Result<(), PluginError>,
        &["key", "value"],
    );
    contract.method(
        "host-settings-write",
        "reset-setting",
        <dyn HostApi>::reset_setting as fn(Host, &'static str) -> Result<(), PluginError>,
        &["key"],
    );
    contract.method(
        "host-view-state-read",
        "view-state",
        <dyn HostApi>::view_state
            as fn(
                &'static dyn HostApi,
                &'static str,
            ) -> Result<Option<serde_json::Value>, PluginError>,
        &["key"],
    );
    contract.method(
        "host-view-state-write",
        "set-view-state",
        <dyn HostApi>::set_view_state
            as fn(Host, &'static str, Option<serde_json::Value>) -> Result<(), PluginError>,
        &["key", "value"],
    );
    contract.method(
        "host-env",
        "now-unix-millis",
        <dyn HostApi>::now_unix_millis as fn(&'static dyn HostApi) -> u64,
        &[],
    );
    contract.method(
        "host-query",
        "query-index",
        <dyn HostApi>::query_index
            as fn(&'static dyn HostApi, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );
    contract.method(
        "host-env",
        "user-locale",
        <dyn HostApi>::user_locale as fn(&'static dyn HostApi) -> Locale,
        &[],
    );
    contract.method(
        "host-env",
        "random-bytes",
        <dyn HostApi>::random_bytes
            as fn(&'static dyn HostApi, u32) -> Result<Vec<u8>, PluginError>,
        &["n"],
    );
    contract.method(
        "host-env",
        "active-context",
        <dyn HostApi>::active_context as fn(&'static dyn HostApi) -> Option<ViewContext>,
        &[],
    );
    contract.method(
        "host-network",
        "fetch",
        <dyn HostApi>::fetch
            as fn(&'static dyn HostApi, HttpRequest) -> Result<HttpResponse, PluginError>,
        &["request"],
    );
    contract.method(
        "host-transfer-read",
        "read-source",
        <dyn HostApi>::read_source
            as fn(&'static dyn HostApi, SourceHandle, u64, u32) -> Result<Vec<u8>, PluginError>,
        &["handle", "offset", "len"],
    );
    contract.method(
        "host-transfer-write",
        "open-artifact",
        <dyn ArtifactSink>::open_artifact
            as fn(Sink, &'static str, &'static str) -> Result<ArtifactHandle, PluginError>,
        &["path", "media-type"],
    );
    contract.method(
        "host-transfer-write",
        "write-artifact",
        <dyn ArtifactSink>::write_artifact
            as fn(Sink, ArtifactHandle, &'static [u8]) -> Result<(), PluginError>,
        &["handle", "bytes"],
    );
    contract.method(
        "host-transfer-write",
        "close-artifact",
        <dyn ArtifactSink>::close_artifact
            as fn(Sink, ArtifactHandle) -> Result<ExportArtifact, PluginError>,
        &["handle"],
    );
    contract.method(
        "host-services",
        "call-service",
        <dyn HostApi>::call_service
            as fn(
                Host,
                &'static str,
                &'static str,
                serde_json::Value,
            ) -> Result<serde_json::Value, PluginError>,
        &["service", "method", "args"],
    );
    contract.method(
        "service",
        "call",
        <dyn ServiceProvider>::call
            as fn(
                &'static dyn ServiceProvider,
                &'static str,
                &'static str,
                serde_json::Value,
                Host,
            ) -> Result<serde_json::Value, PluginError>,
        &["service", "method", "args"],
    );

    contract.method(
        "host-commands",
        "run-command",
        <dyn HostApi>::run_command
            as fn(Host, &'static str, serde_json::Value) -> Result<CommandOutcome, PluginError>,
        &["command", "args"],
    );

    contract.method(
        "host-commands",
        "undo-last",
        <dyn HostApi>::undo_last as fn(Host) -> Result<Option<Undone>, PluginError>,
        &[],
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
                Host,
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
                Sink,
            ) -> Result<ExportReport, PluginError>,
        &["request"],
    );

    // --- il world

    let (imports, exports) = contract
        .worlds
        .get("plugin-world")
        .cloned()
        .expect("world `plugin-world` assente dal WIT");
    // Le quattordici famiglie del §7.1. Il confronto è per contenimento e non
    // per uguaglianza perché fra gli import risolti compaiono anche le
    // interfacce di soli **tipi** che quelle usano (`model`, `errors`, `index`,
    // …): sono dipendenze del grafo, non capacità concesse.
    for famiglia in [
        "host-vault-read",
        "host-vault-write",
        "host-vault-structure",
        "host-data-read",
        "host-data-write",
        "host-env",
        "host-events",
        "host-query",
        "host-commands",
        "host-services",
        "host-network",
        "host-settings-read",
        "host-settings-write",
        "host-view-state-read",
        "host-view-state-write",
        "host-transfer-read",
        "host-transfer-write",
    ] {
        assert!(
            imports.contains(famiglia),
            "`plugin-world` deve importare `{famiglia}`, importa {imports:?}"
        );
    }
    assert!(
        !imports.contains("host-api"),
        "`host-api` è stata divisa nelle quindici famiglie del §7.1: se riappare, \
         è tornata la superficie che si concede per intero o per niente"
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
        "service",
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
        panic!("abi e wit/fub/abi.wit divergono:\n  - {report}");
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
    assert_eq!(common::kebab("CodeBlock"), "code-block");
    assert_eq!(common::kebab("Url"), "url");
}

/// **Una lettura, due confini** (decisione 0053): lo stesso identificatore Rust
/// si scrive in due modi, e i due non si possono confondere perché non vanno
/// nello stesso posto.
///
/// `kebab` va nel WIT — il confine del component model, M5. `snake` va nel JSON
/// di serde, cioè nell'IPC che la webview attraversa **oggi**. Che siano due
/// funzioni e non una è la forma minima del fatto che regge tutta la decisione:
/// il WIT e il mirror TS non sono due grafie della stessa cosa, e nessuno dei
/// due si genera dall'altro.
#[test]
fn lo_stesso_nome_si_proietta_in_due_modi_diversi() {
    for (rust, wit, json) in [
        ("DryRun", "dry-run", "dry_run"),
        ("LeftSidebar", "left-sidebar", "left_sidebar"),
        ("StaticSite", "static-site", "static_site"),
        // Un caso di una parola sola: le due proiezioni coincidono, e va bene —
        // ciò che non deve coincidere è la REGOLA, non ogni suo risultato.
        ("Overflow", "overflow", "overflow"),
        // E uno che non ha maiuscole interne pur avendo due "pezzi".
        ("H23", "h23", "h23"),
    ] {
        assert_eq!(common::kebab(rust), wit, "{rust} verso il WIT");
        assert_eq!(common::snake(rust), json, "{rust} verso il JSON di serde");
    }
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
            base.replace("        score: option<f32>,", "        score: option<f64>,"),
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
                "    write-document: func(id: doc-id, source: string,\n                         base: write-base) -> result<revision, plugin-error>;",
                "    write-document: func(id: doc-id, source: list<u8>,\n                         base: write-base) -> result<revision, plugin-error>;",
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
                "    reconcile: func(ids: list<doc-id>) -> list<index-loss>;",
                "    reconcile: func(host: string, ids: list<doc-id>) -> list<index-loss>;",
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
