//! La forma WIT di un tipo Rust dedotta dal tipo (`WitType`), e la firma WIT
//! di un metodo dedotta dal puntatore a funzione (`WitFn`).

use super::*;

// ---------------------------------------------------------------------------
// La forma WIT di un tipo Rust, dedotta dal tipo
// ---------------------------------------------------------------------------

/// Come un tipo Rust si scrive nel WIT.
///
/// È il cuore del test: implementarla per un tipo è **dichiarare la sua forma al
/// confine**, e un tipo nuovo in una firma senza questa impl non compila —
/// quindi non passa inosservato.
pub(super) trait WitType {
    fn wit() -> String;
}

/// La forma WIT del tipo di `v`. Si passa il valore e non il tipo perché così il
/// tipo lo deduce il compilatore dal campo destrutturato: nessuna occasione di
/// scriverne uno diverso da quello vero.
pub(super) fn wit<T: WitType + ?Sized>(_v: &T) -> String {
    T::wit()
}

/// La forma WIT di un tipo di cui non si ha un valore sotto mano.
pub(super) fn wit_of<T: WitType + ?Sized>() -> String {
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

    // Il giornale della griglia a byte attraversa il confine come il suo testo
    // canonico: chi lo riceve lo rilegge con `GridJournal::parse`.
    GridJournal => "string",

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
    dyn GridBytesProvider => SELF,
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
    // Lo stesso record visto dal lato delle porte, con lo span del modello.
    TaskMarker,
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
    UiDrag,
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
    LinkRewrite,
    LinkInsert,

    GridSurfaceSpec,
    GridSheet,
    GridRow,
    GridColumn,
    GridCellKey,
    GridHorizontalAlign,
    GridVerticalAlign,
    GridUnderline,
    GridScript,
    GridBorderStyle,
    GridBorder,
    GridBorders,
    GridCellStyle,
    GridWindowRequest,
    GridCellPatch,
    GridApplyRequest,
    GridInvalidation,
    GridSourceEdit,
    GridCommit,
    GridNotice,
    GridCalculation,
    GridBook,
    GridBytesSession,
    GridValue,
    GridDataBar,
    GridIcon,
    GridCommentReply,
    GridComment,
    GridLink,
    GridBytesCell,
    GridMerge,
    GridViewMode,
    GridSheetView,
    GridTable,
    GridObjectKind,
    GridShapeKind,
    GridShapeAlign,
    GridShapeAnchor,
    GridShape,
    GridMedia,
    GridObjectMissing,
    GridObject,
    GridBytesWindow,
    GridSelection,
    GridCommandState,
    GridCommand,
    GridCommandRequest,
    GridDialog,
    GridCommandOutcome,
    // La mappa con namespace: al confine è una lista di coppie, perché WIT non
    // ha mappe. È lo stesso tipo in tutte e quattro le sedi del §3.5 — e che
    // sia lo STESSO è metà della risposta.
    OptionMap,

    // I due innesti del §3.1 e del §3.2.
    SyntaxTrigger,
    SyntaxForm,
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
    ComponentKind,
    Delivery,
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
    CommandSurface,
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
    Gate,
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
    TaskStatus,
    TextScope,
    DueBound,
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

    // La resa di un documento (§16.6): l'anteprima composta e l'embed.
    RenderedDocument,
    RenderedPart,
    EmbedContent,
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
pub(super) trait TreeAtBoundary {
    fn wit_tree() -> String;
}

impl TreeAtBoundary for Vec<fub_abi::model::Block> {
    fn wit_tree() -> String {
        "document-tree".to_string()
    }
}

pub(super) fn wit_tree<T: TreeAtBoundary + ?Sized>(_v: &T) -> String {
    T::wit_tree()
}

// ---------------------------------------------------------------------------
// La firma WIT di un metodo, dedotta dal puntatore a funzione
// ---------------------------------------------------------------------------

/// Una firma come il WIT la vedrebbe: parametri (ricevitore e `host` esclusi) e
/// risultato.
pub(super) struct RustSig {
    pub(super) params: Vec<String>,
    pub(super) result: Option<String>,
    /// La firma Rust aveva un `host` da elidere?
    pub(super) has_host: bool,
}

/// Un metodo di trait, visto come puntatore a funzione.
pub(super) trait WitFn {
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
pub(super) type Host = &'static mut dyn HostApi;
/// Il sink di un export: vedi [`SINK`]. Sta fra i parametri Rust e non nel WIT.
pub(super) type Sink = &'static mut dyn ArtifactSink;
pub(super) type HostRef = &'static dyn ReadApi;
